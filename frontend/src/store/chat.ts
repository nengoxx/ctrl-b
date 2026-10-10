// Agent chat state (Phase 4a + 4b). Dependency-free external store, same shape as store/ui.ts.
// Chat is not TanStack Query — it's a streaming reducer (DESIGN §13): a single active thread,
// messages appended/patched by id as SSE events arrive. The shared composer and the Agent tab both
// read it. 4b adds the tool-call loop: assistant turns can span multiple messages (a tool step then
// a summary step), tool calls render as command bubbles, and a confirm-gated call suspends the turn
// until `resumeCall(execute|dismiss)` reopens the stream (DESIGN §5.3, §12).

import type { CoreMemoryStatus } from "../hooks/useMemory";
import { clearAudioCache, forgetMessage } from "../lib/audioController";
import { publishNotify } from "../lib/notifyBus";
import { DEFAULT_AGENT } from "../lib/agentSlug";
import { currentPlanOf } from "../lib/plan";
import { PRIVILEGE_VALUES, type Privilege } from "../lib/privilege";
import { displayName, offRoster, onRoster, rosterDefault, rosterLanded } from "../lib/roster";
import type {
  CallUsage,
  ChatMessage,
  MessageSource,
  Part,
  Plan,
  PlanStep,
  RunState,
  Thread,
  ToolCallPart,
  ToolResult,
} from "../types";
import { consumeStaged, releaseStaged, stagedPreviews } from "./attachments";
import {
  appendDraft,
  carryOnLeave,
  moveSlots,
  pruneSlots,
  setComposerSlot,
  slotsCarried,
  stopLiveDictation,
} from "./composer";
import { requestConfirm } from "./confirm";
import { createStore } from "./createStore";
import { setConnection } from "./connection";
import { callLive } from "./liveCall";
import { isRecord, loadPersisted, patchPersisted } from "./persist";
import { pushToast } from "./toast";
import { getUI, takeBootThread } from "./ui";

export type ChatStatus = "idle" | "streaming" | "error";

/** One HOME agent's session overrides (D84 R40 + ON4): `/privilege <lvl>` / the `PrivilegeChip`, and a
 *  bare `/<provider>` (the inference mode). An absent field = the home agent's own AgentDef value. */
export interface HomeOverride {
  privilege?: Privilege;
  mode?: ChatMode;
}
/** The overrides, keyed by HOME agent slug (never by the responder — R40: the conversation's stance). */
export type Overrides = Readonly<Record<string, HomeOverride>>;

interface ChatState {
  threadId: string | null;
  messages: ChatMessage[];
  status: ChatStatus;
  streamingId: string | null; // the message currently receiving deltas (drives caret/dots)
  // The session OVERRIDES per HOME agent (D84 R40, ON4) — `/privilege <lvl>`, the chip, a bare
  // `/<provider>`; a home with no entry follows its own AgentDef. Keyed by the HOME, so they follow the
  // conversation's home agent whoever answers (a responder's turn runs at its home's overrides) and are
  // shared by every conversation of that home. PERSISTED PER DEVICE in `ctrlb.chat` (ON4, owner
  // 2026-10-06 — "both of them should be survivable for a reload"; this superseded the old session-only
  // contract, SECURITY_MODEL §2.2). Reactive because the chip renders the open home's privilege.
  overrides: Overrides;
  // THE RESPONDER (D84 §2, R45) — a per-device override set by `/agent <name>`: WHO ANSWERS in the open
  // conversation (persona, prompt, memory), sent as `body.agent` on every send. `null` = the home agent
  // answers ("the home agent is the rule; the responder is the exception"). Its LIFETIME is the view:
  // leaving the conversation on this device (another conversation, `/new`, the thread-less reset) clears
  // it in `swapView`; landing on the SAME conversation (a reload, a same-id open) keeps it; a roster
  // door onto the open conversation's own home clears it in place (B5). Persisted with the view tuple in
  // `ctrlb.chat`. Never anyone's home (THE INVARIANT, R22): a send carries it, nothing re-pins a thread.
  responder: string | null;
  // The open conversation's HOME agent (D84 — `threads.agent`, written once at mint, never moved): its
  // list, its name, its checked roster row, its overrides. `null` with a `threadId` = UNKNOWN (a door
  // that knew nothing and a late read that failed, §12.3 H6) — then no override rides a send. `null`
  // with no `threadId` = the thread-less view, whose home-to-be is the configured default. Written
  // wherever `threadId` is (`swapView`, `setWireThread`, `loadThread`): the two describe ONE
  // conversation and must never disagree.
  threadAgent: string | null;
  // Is the open conversation ARCHIVED (§12.3 H3)? The automations panel opens an automation's run
  // thread in chat (by design), and an archived id answers 404 to `PATCH /api/threads/{id}` — so an
  // archived view writes no `seen_at` and is never an R29 "deleted elsewhere" source. `null` = NOT YET
  // KNOWN (a door that knew nothing, before its record read lands; the thread-less view) — treated as
  // "not known to be live": no seen write, no R29. Written wherever `threadId` is (`swapView`,
  // `setWireThread`, `loadThread`) and by the late record read — a door that hands a HOME implies
  // `false` (a sheet row, the roster door's `?agent=` read and a notification frame all name
  // non-archived conversations only; a wire mint is fresh).
  archived: boolean | null;
}

//: The chat store's persisted slice (D23 chokepoint, `store/persist`) — `{thread, home, responder,
//: overrides}` (D84 R45 + ON4 + §12.3 H7). The VIEW TUPLE (`thread`, its `home`, the `responder`) is
//: written together wherever the view identity changes and by `setResponder`; one home's `overrides`
//: entry is patched alone by the override writers — every write goes through `patchPersisted`, never a
//: whole-blob write of in-memory state (§12.3 M4). `home` rides with `thread` so a boot whose thread was
//: deleted elsewhere still knows whose latest to open (H7).
const KEY = "ctrlb.chat";
interface PersistedChat {
  thread: string | null;
  home: string | null;
  responder: string | null;
  overrides: Overrides;
}
const NO_CHAT: PersistedChat = { thread: null, home: null, responder: null, overrides: {} };

/** A provider/mode name's syntax (`backend/app/config.py` `_PROVIDER_SLUG_RE`) — the wire's own check, so
 *  a stored `mode` that could never route is dropped at the load boundary. */
const MODE_SLUG = /^[a-z0-9][a-z0-9_+.-]{0,31}$/;

const slugOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** The `overrides` map, type-guarded ENTRY BY ENTRY (ON4): a non-object entry, or a `privilege`/`mode`
 *  outside the known values, drops THAT entry — never the blob, never another home's. */
function foldOverrides(v: unknown): Overrides {
  if (!isRecord(v)) return {};
  const out: Record<string, HomeOverride> = {};
  for (const [home, e] of Object.entries(v)) {
    if (!home || !isRecord(e)) continue;
    const { privilege, mode } = e;
    if (
      privilege !== undefined &&
      !(typeof privilege === "string" && PRIVILEGE_VALUES.has(privilege))
    )
      continue;
    if (mode !== undefined && !(typeof mode === "string" && MODE_SLUG.test(mode))) continue;
    const entry: HomeOverride = {};
    if (privilege !== undefined) entry.privilege = privilege as Privilege;
    if (mode !== undefined) entry.mode = mode;
    if (entry.privilege !== undefined || entry.mode !== undefined) out[home] = entry;
  }
  return out;
}

/** THE load-boundary fold of `ctrlb.chat` (one, here). A blob whose `thread` is neither a string nor an
 *  explicit `null` — the legacy D75 `{agent}` sticky pick, a corrupt value — loads as NO_CHAT: the old
 *  pick is DROPPED, never carried into `responder` (R4), and written back folded so the `agent` key is
 *  never seen again. An explicit `thread: null` is the thread-less view's own tuple — its responder
 *  survives (the boot rule, N1). `home`/`responder` are slug-or-null; `overrides` is guarded per entry. */
function readPersistedChat(): PersistedChat {
  const raw = loadPersisted<unknown>(KEY, null);
  if (raw === null) return NO_CHAT;
  if (!isRecord(raw)) {
    patchPersisted(KEY, () => ({ ...NO_CHAT }));
    return NO_CHAT;
  }
  const thread = raw.thread;
  const folded: PersistedChat =
    typeof thread === "string" || thread === null
      ? {
          thread: slugOrNull(thread),
          home: slugOrNull(raw.home),
          responder: slugOrNull(raw.responder),
          overrides: foldOverrides(raw.overrides),
        }
      : NO_CHAT;
  // The load boundary's ONE write-back: what was read, folded — the legacy key and any dropped entry go.
  patchPersisted(KEY, () => ({ agent: undefined, ...folded }));
  return folded;
}

let state: ChatState = {
  threadId: null,
  messages: [],
  status: "idle",
  streamingId: null,
  overrides: readPersistedChat().overrides,
  responder: null,
  threadAgent: null,
  archived: null,
};
let loaded = false;
//: The chat view's LOAD GENERATION — app-owned cross-generation state (the D39/ACA precedent).
//:
//: Three loaders can be in flight against this one view at once: `initChat` (first Agent-tab mount),
//: `reloadChat` (F16, on every SSE reconnect) and `openThread` (14c, from the automations run
//: history). Each of them `await`s a fetch and then writes `threadId`/`messages`/`loaded` — so without
//: a generation, a slow one lands AFTER a newer one and wins by arriving last: a stale `initChat`
//: overwrites the thread the owner just opened, an in-flight `reloadChat` writes the OLD thread's
//: messages under the NEW `threadId`, and a stale `initChat`'s `catch` resets `loaded` so the next
//: mount reloads over a deliberate open.
//:
//: The rule is one line at each site: capture `gen` on entry, and discard every post-`await` write
//: unless it still matches. Only an explicit `openThread` BUMPS it — it is the only load that is a
//: user decision rather than a reconciliation, so it is the only one allowed to invalidate the others.
let loadGen = 0;
//: The explicit-navigation ticket (R2 verify, M5). `loadGen` orders loads by COMPLETION — whichever
//: swap happens last owns the view — which is right for reconciliations but wrong between two USER
//: decisions: of two rapid "open thread" taps, the LATER intent must win even if its fetch resolves
//: first. Every `openThread` claims a ticket at ENTRY (same-thread opens included — re-opening the
//: current thread is also a decision that supersedes a pending open), `/new` claims one too, and a
//: swap is abandoned when its ticket has been superseded.
let openSeq = 0;
const { emit, useStore } = createStore();
// Confirm tokens from `tool.permission`, keyed by callId — sent back on resume(execute).
const confirmTokens: Record<string, string> = {};
// The inference mode of the turn each suspended call belongs to (ACA-16). Keyed like
// `confirmTokens` and cleaned with it: `turnMode` alone is overwritten by the NEXT send, so
// resuming an older confirm after an interleaved message would carry the wrong turn's mode.
const modeByCall: Record<string, ChatMode | null> = {};
// The active skills of the turn each suspended call belongs to (C5-M1). Mirrors `modeByCall`
// exactly: `turnSkills` alone is overwritten by the NEXT send, so resuming an older confirm after an
// interleaved message would re-activate the wrong turn's skills (or none) — the per-call pin survives
// it. Sent on resume/answer so the resumed half runs under the SAME narrowed toolset the owner
// confirmed against. Since M2/C-12 the SERVER is the source: the suspend event carries its active set
// (selector picks included), the turn snapshot pins it per call id so a re-attach/reload re-seeds this
// map, and `/agent/resume` prefers its own pin over whatever we send — this is now the fallback for
// the one case the server can't answer (its terminal record lingered out or the process restarted).
const skillsByCall: Record<string, string[]> = {};
// Whether a suspended confirm call is eligible for a bubble 'always allow' grant (D44 W3), keyed like
// `confirmTokens`. Ephemeral — set from `tool.permission`'s `alwaysEligible` (the backend already
// gates it: only an args-expressible, non-forced-confirm call is true), read by CmdBubble to show the
// affordance, cleaned with the token when the call resolves. Absent/false → the affordance is hidden.
const alwaysEligibleByCall: Record<string, boolean> = {};

/** True iff the suspended call may show the 'always allow' affordance (D44 W3) — the backend's
 *  `alwaysEligible` flag from `tool.permission`, defaulting false when unset (older bubbles, a
 *  non-eligible call). CmdBubble reads this in render, populated by the same reducer that flips the
 *  call to `awaiting_confirm`, so the flag is in place before the confirm row paints. */
export function alwaysEligibleFor(callId: string): boolean {
  return alwaysEligibleByCall[callId] === true;
}

// ── D41/Slice 5: the steering queue (client side) ────────────────────────────────────────────────
// A queued steer's RAW composer line (WITH any `/prefix` or leading `!`), keyed by the server-assigned
// `entry_id`. The server stores the STRIPPED text + resolved params; the raw line is what belongs back
// in the composer on Stop (harvest fidelity — D41 §6). Populated on the 202, cleared when the entry
// drains (`steer.applied`/`turn.sync` fold), is harvested (Stop), or is removed (DELETE). Survives a
// `reloadChat` (the durable floor never carries raw lines).
//
// THREAD-SCOPED (Codex FE FIX C / reviewer LOW-9): a per-thread map so a stale harvest can never append
// another thread's raw lines into the current composer. A view swap does NOT prune it (Phase 27 O22):
// since a swap may leave a turn running in the background (R9), the conversation left still owns its
// queued steers, and their raw lines must survive until THAT thread's own drain (`steer.applied` /
// `turn.sync`), harvest (Stop) or re-entry reconcile (`pruneRaw`, from the probe) retires them. entry_ids
// are server-unique, but the nesting keeps the scoping honest rather than relying on that uniqueness.
const rawByEntry: Record<string, Record<string, string>> = {};
function setRaw(threadId: string, entryId: string, raw: string): void {
  (rawByEntry[threadId] ??= {})[entryId] = raw;
}
function getRaw(threadId: string, entryId: string): string | undefined {
  return rawByEntry[threadId]?.[entryId];
}
function delRaw(threadId: string, entryId: string): void {
  const m = rawByEntry[threadId];
  if (m) delete m[entryId];
}
/** Prune a thread's raw lines to only those still queued server-side (reconcile). */
function pruneRaw(threadId: string, keep: Set<string>): void {
  const m = rawByEntry[threadId];
  if (m) for (const e of Object.keys(m)) if (!keep.has(e)) delete m[e];
}
/** Build an optimistic QUEUED steer bubble (D41 §3/§1). `text` is the stripped body; an exec entry
 *  renders its command with the `!` sigil restored so the bubble reads like the `!cmd` the owner typed. */
function makeQueuedBubble(entryId: string, kind: "message" | "exec", text: string): ChatMessage {
  return {
    id: `steer-${entryId}`,
    thread_id: state.threadId ?? "",
    role: "user",
    parts: [{ type: "text", text: kind === "exec" ? `!${text}` : text }],
    actor: "user",
    ts: new Date().toISOString(),
    tokens: null,
    compacted: false,
    queued: entryId,
    fresh: true,
    local: true,
  };
}

/** Resolve a queued steer bubble once it DRAINS (`steer.applied` or the `turn.sync` `steers` fold): the
 *  entry is now a durable user message. PURE (messages in → out). If a durable message with `messageId`
 *  is already present (the re-attach reload brought it), drop the local queued dup; otherwise adopt the
 *  real id + clear the marker (and, for a message steer, the carried text). No local queued bubble → a
 *  no-op (the durable floor carries it). */
function resolveSteerBubble(
  messages: ChatMessage[],
  entryId: string,
  messageId: string | undefined,
  kind: "message" | "exec",
  text: string | undefined,
): ChatMessage[] {
  const idx = messages.findIndex((m) => m.queued === entryId);
  if (idx < 0) return messages;
  const dup = !!messageId && messages.some((m) => m.id === messageId && m.queued !== entryId);
  if (dup) return messages.filter((_, i) => i !== idx);
  return messages.map((m, i) => {
    if (i !== idx) return m;
    const parts =
      kind === "message" && text !== undefined ? [{ type: "text", text } as Part] : m.parts;
    // Adopting the durable id makes the row a real one (D81 `local` cleared). Without an id it stays the
    // client's `steer-…` stand-in — but a DRAINED one: the server holds its durable form now, so it is
    // `landed`, and the next floor supersedes it against that row (the N2 rule) instead of keeping it
    // beside it forever (Maya's wave-2 addendum).
    return messageId !== undefined
      ? { ...m, id: messageId, queued: undefined, parts, local: undefined }
      : { ...m, queued: undefined, parts, landed: true as const };
  });
}

// ── D39/S3-D: the ONE total-order seq entry gate ────────────────────────────────────────────────
// Server turn events are totally ordered by a per-turn monotonic `seq` (wire id `turn_id:seq`), so a
// single "seq <= lastSeq → drop" at the reducer's entry dedupes EVERY branch — a re-attach's
// tail-replay/snapshot prefix that overlaps events already applied, or a live frame seen twice. A new
// `turn_id` resets the gate (each turn counts from 1). Frames with no id (the `thread` head frame,
// events-feed traffic) carry no seq to order and bypass. Do NOT add per-branch guards — this is it.
// `lastTurnId`/`lastSeq` also give the re-attach cursor (`lastTurnId:lastSeq`).
let lastTurnId: string | null = null;
let lastSeq = 0;

// ── FIX A / Slice 5: client stream OWNERSHIP (overlapping streams defeat the seq gate) ────────────
// Two client streams can be live at once — a steer-race 200 adopting a fresh turn B while turn A's
// socket still drains its trailing `done`; an interrupt/adopt re-attach opened beside a stale stream —
// and the per-turn seq gate alone can't tell them apart: turn A's DELAYED terminal (a new turn_id to
// the gate) would reset `lastTurnId` and settle status idle UNDER turn B. So every stream consumer
// (streamTurn's live-adopt, reattachTurn) captures a monotonically-increasing generation the instant it
// becomes THE live stream (`claimStream`); a frame whose reducer belongs to a STALE generation is
// dropped WHOLESALE — no content, no terminal handling, and it never touches the seq gate / `lastTurnId`
// (so the gate + `lastTurnId` are effectively PER-GENERATION: only the current generation's frames
// reach them, and a new generation's first frame — a new turn_id — resets the gate as before). A stale
// stream also never re-attaches or fails on drop (its owner has moved on). `claimStream` is called at
// the exact live-adopt point, NOT at reducer construction, so a 202/409/buffered reply that never
// streams does not bump the generation and orphan the genuinely-live turn.
//
// A VIEW SWAP bumps it too (Phase 27 S6, R9 — `swapView`): a swap while a turn streams is allowed, and the
// left turn simply continues server-side as a background conversation. The bump is what makes every
// stream claimed BEFORE the swap stale at once — its frames, its terminal, its re-attach-on-drop — through
// the same checks above, never a second mechanism. A turn whose POST was still in flight at the swap had
// no generation to go stale; the adopt guard (`viewMoved`, below) covers it instead.
let streamGeneration = 0;
/** Claim THE live stream for `ctx` — refused (`false`, nothing bumped) when the turn's view moved since
 *  its send (O6's first adopt point): adopting would hand the left conversation's stream to the view the
 *  owner swapped to. A re-attach is bound the same way to the view it was started from (M1 — a hop during
 *  a drop's recovery must not hand the left turn's frames to the view swapped in). */
function claimStream(ctx: TurnCtx): boolean {
  if (viewMoved(ctx)) return false;
  ctx.gen = ++streamGeneration;
  return true;
}

/** A VIEW's identity (O6): its thread and its view generation (`loadGen`), captured at the moment a turn,
 *  a re-attach or a Stop starts on it (`viewHere`). The ONE guard identity of the hop kernel. */
type ViewRef = { thread: string | null; gen: number };
function viewHere(): ViewRef {
  return { thread: state.threadId, gen: loadGen };
}

/** O6 — has the view this turn was SENT from moved since? `ctx.view` is captured before the POST's
 *  `fetch` (`streamTurn`; a re-attach before its own, `runCancel` at the Stop): the view's thread and its
 *  VIEW generation. The view generation is `loadGen` —
 *  bumped by `swapView` and by a wire mint, i.e. by exactly the changes of view identity — and NOT
 *  `streamGeneration`, which also moves on a same-view claim (a re-attach, a steer-race adoption): a
 *  steer's late 202 must still mark its bubble in the view it never left. The thread comparison backs it
 *  up for a write that changes `threadId` without a swap. Always `false` for a ctx with no `view`. */
function viewMoved(ctx: { view?: ViewRef }): boolean {
  return ctx.view !== undefined && (ctx.view.gen !== loadGen || ctx.view.thread !== state.threadId);
}

/** O6's wire-thread adopt point (the reducer's `thread` frame and the buffered payload's `threadId`):
 *  install the id unless the turn's view moved. A lazy mint IS this turn's own move — the thread-less
 *  view becomes the minted conversation — so on adoption the turn's view follows it, and the turn's
 *  later guards compare against the conversation it created rather than the null it left. `agent` is the
 *  head's home (S3's `{threadId, title, agent}`, on BOTH transports) — `setWireThread` installs it. */
function adoptWireThread(ctx: TurnCtx, id: string, agent?: string): boolean {
  if (viewMoved(ctx)) return false;
  setWireThread(id, agent);
  if (ctx.view) ctx.view = { thread: id, gen: loadGen };
  return true;
}

/** Parse a `turn_id:seq` wire id → `{turnId, seq}` or null (absent/malformed). `turn_id` is uuid4
 *  hex (no colons), so a split on the LAST colon is unambiguous — mirrors the backend `_parse_cursor`. */
function parseFrameId(id: string | undefined): { turnId: string; seq: number } | null {
  if (!id) return null;
  const i = id.lastIndexOf(":");
  if (i <= 0) return null;
  const seq = Number(id.slice(i + 1));
  const turnId = id.slice(0, i);
  return Number.isInteger(seq) && turnId ? { turnId, seq } : null;
}

/** The seq entry gate: true → DROP this frame (already applied for this turn). Updates the gate as a
 *  side effect. A frame with no/invalid id bypasses (returns false) — the `thread` head + tests that
 *  don't stamp ids flow through untouched. */
function seqGateDrop(id: string | undefined): boolean {
  const p = parseFrameId(id);
  if (!p) return false;
  if (p.turnId !== lastTurnId) {
    lastTurnId = p.turnId; // new turn → reset the gate to this turn's floor, then apply
    lastSeq = p.seq;
    return false;
  }
  if (p.seq <= lastSeq) return true;
  lastSeq = p.seq;
  return false;
}

// ── F1 notification signals — ONE builder set, shared by EVERY transport ─────────────────────────
// A turn occurrence reaches this store through FOUR transports: the live SSE reducer, the buffered
// (non-streaming) JSON reply, a `turn.sync` re-attach snapshot, and the re-attach `{active:false}`
// terminal answer. The same occurrence MUST produce the same signal — same class, same key — from any
// of them, because the engine's bounded seen-set is what collapses live + replay into a single buzz
// (Codex final round, MED-1: publishing only from the live reducer meant a phone that missed the live
// frame was never told, while one that saw it and then re-attached risked a second buzz). So every
// turn-side `publishNotify` goes through these three builders; do NOT inline one anywhere else.
// (Phase 27 S10 adds the FIFTH transport — the `thread` frame of a BACKGROUND conversation, D84 §5 —
// which reuses the terminal builder as is and adds the one signal no other transport can produce, the
// frame-level needs-you, `notifyNeedsYou`.)
//
// NAMES + TAPS (D84 §5, R37 · O2): every builder takes the conversation's HOME — the open view's own
// stream passes `state.threadAgent`, the frame its `agent` — and names it in the title ("<Name>
// finished", the ONE vanished-home paint), and every agent-class signal carries `thread` + `home` so its
// tap opens THAT conversation (`applyNotificationFocus` → `openThread(thread, home)`).
//
// Keys are namespaced `<kind>:<threadId>:<id>` (Codex LOW): call ids and turn ids are server-unique
// already, but the thread segment makes a snapshot's key provably identical to the live frame's
// without leaning on that uniqueness, and keeps two threads' turns out of one de-dupe bucket.

/** Key segment for a signal published before any thread id is known (only reachable in isolated
 *  tests — production always has a `thread` frame or a payload `threadId` first). */
const NOTIFY_NO_THREAD = "thread";

function notifyScope(threadId: string | null | undefined): string {
  return threadId ?? state.threadId ?? NOTIFY_NO_THREAD;
}

/** The thread an agent-class signal's TAP opens (D84 §5 O2, the notification's `data.thread`) — the same
 *  thread `notifyScope` keys it under, `undefined` only in the thread-less test case. */
function notifyThreadOf(threadId: string | null | undefined): string | undefined {
  return threadId ?? state.threadId ?? undefined;
}

/** WHO a signal names (R37): the conversation's HOME agent's display name, through the ONE vanished-home
 *  paint (`homeName` — a home off the landed roster reads as the configured default, §12.1 ①); a home this
 *  device does not know yet (`null`) reads as the configured default too. */
function signalName(home: string | null): string {
  return homeName(home ?? rosterDefault());
}

/** F1 — the agent is now BLOCKED on the owner (a confirm-gated call). This is the class that makes
 *  notifications worth having: an unattended turn parks here indefinitely otherwise. Keyed on the
 *  durable `callId`, so a re-attach that REPLAYS or RECONSTRUCTS the same call resolves to the same
 *  key and is swallowed by the engine's seen-set. */
function notifyAwaitingConfirm(
  threadId: string | null | undefined,
  callId: string,
  prompt: string | undefined,
  tool: string | undefined,
  home: string | null,
): void {
  publishNotify({
    cls: "agent_input",
    key: `perm:${notifyScope(threadId)}:${callId}`,
    title: `${signalName(home)} needs approval`,
    body: prompt ?? `${tool ?? "a tool"} is waiting for your approval`,
    focus: "agent",
    thread: notifyThreadOf(threadId),
    home: home ?? undefined,
  });
}

/** F1 — same class as the confirm bubble: the turn is parked on the owner's reply (the `question`
 *  builtin, A2). */
function notifyAwaitingAnswer(
  threadId: string | null | undefined,
  callId: string,
  question: string | undefined,
  home: string | null,
): void {
  publishNotify({
    cls: "agent_input",
    key: `ask:${notifyScope(threadId)}:${callId}`,
    title: `${signalName(home)} has a question`,
    body: question ?? "open the chat to answer",
    focus: "agent",
    thread: notifyThreadOf(threadId),
    home: home ?? undefined,
  });
}

/** F1 — the turn reached a terminal state. `suspended` is deliberately EXCLUDED (the standing rule,
 *  enforced HERE so no transport can forget it): it is the terminal that always accompanies a
 *  `tool.permission`/`tool.question`, so notifying for it too would double-buzz the exact case
 *  `agent_input` already covers — and under a preference the owner may have turned off.
 *
 *  `error` publishes under a distinct `turn-error:` key shared by the `error` frame AND the
 *  `done(error)` that follows it: the server emits both for one failure, so the pair de-dupes to ONE
 *  notification carrying the first frame's real message — and a lone `done(error)` still produces one.
 *
 *  The turn segment falls back to the thread when the transport carries no turn id (the buffered
 *  reply; a stream whose frames aren't stamped). Bounded + accepted: two consecutive id-less turns on
 *  one thread collapse into a single buzz — see the test that pins it.
 *
 *  An ABSENT state (`undefined`/`null`) is not a terminal at all and publishes NOTHING (verify-5, fix
 *  2). The re-attach `{active:false}` answer carries `terminal_status: null` whenever the turn is
 *  unknown/expired — nothing was learned about how it ended — and the old `st !== "suspended"` test
 *  read that as a finish, announcing "The agent finished" for a turn we know nothing about (and, on a
 *  cold load, for one that may still be parked on the owner). Only a real state speaks. */
function notifyTurnTerminal(
  threadId: string | null | undefined,
  turnId: string | null,
  st: string | null | undefined,
  message: string | undefined,
  home: string | null,
  pressure = true,
): void {
  if (!st || st === "suspended") return;
  // D61 ② — a turn just ended, so the owner is back in the loop: the moment to tell them the
  // core-memory index is filling up. It rides THIS helper, not the `done` frame, for exactly the
  // reason the notifications do — it is the one point every transport's terminal passes through.
  // NOT for a BACKGROUND conversation's frame (`pressure = false`, S10 fix ⑨): the hint is a system note
  // pushed into the OPEN view, and a background frame never touches the open view (§12.4 Q8).
  if (pressure) checkMemoryPressure();
  const scope = notifyScope(threadId);
  const failed = st === "error";
  publishNotify({
    cls: "turn_done",
    key: `${failed ? "turn-error" : "turn-done"}:${scope}:${turnId ?? scope}`,
    title: `${signalName(home)} ${failed ? "stopped" : st === "capped" ? "hit the step limit" : "finished"}`,
    body: failed
      ? (message ?? "the turn ended with an error")
      : st === "capped"
        ? "send a message to continue"
        : "your reply is ready in the chat",
    focus: "agent",
    thread: notifyThreadOf(threadId),
    home: home ?? undefined,
  });
}

/** F1 (verify-5, fix 1) — announce the call(s) a SUSPENDED turn is parked on, reconstructed from the
 *  DURABLE messages a reload just restored. This is the fourth transport's missing half: the re-attach
 *  `{active:false, terminal_status:"suspended"}` answer says only "the turn ended, parked" — the
 *  terminal builder is (correctly) silent on `suspended`, so a device that missed the live
 *  `tool.permission`/`tool.question` — the app-killed phone, the cold load — was never told about the
 *  block at all. That is exactly the case the feature exists for, so it is reconstructed here through
 *  the SAME builders/keys as every other transport; a device that DID see the live frame collapses the
 *  two in the engine's seen-set instead of buzzing twice.
 *
 *  Scope = the current turn: walk back to the last user message (a turn's boundary) so an ancient
 *  unanswered suspend further up the thread isn't re-announced on every cold load; a suspend is the
 *  LAST thing a turn does, so any steered user bubble mid-turn sits before the parked call. A call with
 *  a `tool_result` is resolved (the resume flips the durable state and appends the result) and stays
 *  silent — mirrors the bubble's own `!result && state === "awaiting_*"` test.
 *
 *  The durable floor carries `call_id` + `tool` + `args` + `state`; the confirm PROMPT is not persisted
 *  (it lives only on the live `tool.permission` frame / the in-memory snapshot), so a reconstructed
 *  confirm falls back to the builder's "<tool> is waiting for your approval" body — same key, so the
 *  de-dupe is unaffected. A question's text IS durable (`args.prompt`, the `question` builtin's input). */
function notifyRestoredAwaiting(threadId: string, home: string | null): void {
  const msgs = state.messages;
  let from = 0;
  for (let i = msgs.length - 1; i >= 0; i--)
    if (msgs[i].role === "user") {
      from = i + 1;
      break;
    }
  const resolved = new Set<string>();
  for (let i = from; i < msgs.length; i++)
    for (const p of msgs[i].parts) if (p.type === "tool_result") resolved.add(p.call_id);
  for (let i = from; i < msgs.length; i++)
    for (const p of msgs[i].parts) {
      if (p.type !== "tool_call" || resolved.has(p.call_id)) continue;
      if (p.state === "awaiting_confirm")
        notifyAwaitingConfirm(threadId, p.call_id, undefined, p.tool, home);
      else if (p.state === "awaiting_answer")
        notifyAwaitingAnswer(threadId, p.call_id, str(p.args.prompt), home);
    }
}

/** D84 §5 — a BACKGROUND conversation parked on the owner (its `suspended` terminal frame): the frame says
 *  only that the turn parked, not on which call (that detail is the open view's own `tool.permission` /
 *  `tool.question`, which this device never streamed) — so the signal names the HOME and sends the owner
 *  to the conversation. Keyed on the TURN (`agent-input:<thread>:<turn>`): one buzz per parked turn. */
function notifyNeedsYou(threadId: string, turnId: string | null, home: string | null): void {
  publishNotify({
    cls: "agent_input",
    key: `agent-input:${threadId}:${turnId ?? threadId}`,
    title: `${signalName(home)} needs you`,
    body: "open the conversation to continue",
    focus: "agent",
    thread: threadId,
    home: home ?? undefined,
  });
}

/** One live `thread` frame (D84 §5, R8/R26 — backend `core/events.ThreadFrame`, `event: thread`), as
 *  `hooks/useEvents` parsed it off the wire: `state` ∈ running · completed · suspended · capped · error ·
 *  cancelled · seen (an unknown one is simply not acted on); `agent` = the conversation's HOME; `chained` =
 *  the terminal handed off to a drain-B steer turn, whose own frames follow. */
export interface ThreadFrame {
  threadId: string;
  state: string;
  turnId: string | null;
  agent: string | null;
  chained: boolean;
}

/** THE FRAME CONSUMER'S POLICY (D84 §5) — called by `useEventStream` AFTER it has invalidated
 *  `['threads']` + `['agents']` (the dots, both lists; unconditional, whatever this does). It lives here
 *  because it reads the open view and its stream, and owns the notify builders:
 *    · a terminal (`completed`/`capped`/`error`) of a conversation that is NOT the open view, and not
 *      `chained` → the turn-done signal through the ONE builder (its key `turn-done:<thread>:<turn>` is
 *      the open view's own, so the conversation that IS open — whose stream already announced it — is
 *      skipped here and could not double-buzz anyway);
 *    · `suspended` (not open, not chained) → the needs-you signal (`notifyNeedsYou`);
 *    · `cancelled` / `seen` → nothing (the invalidation IS their effect: a seen on device A clears device
 *      B's dot through the refetch); `chained` → nothing (the steer turn's own frames follow);
 *    · `running` for the OPEN view's own conversation while this view is NOT streaming and the page is
 *      VISIBLE (the other device sent there, B9 — §12.3 M11) → probe + re-attach, so the visible device
 *      shows the turn; every other `running` → nothing (the dots carry it; a hidden page probes on return).
 *  "Open" also covers a thread-less view that is STREAMING (a lazy mint not yet adopted — fix ⑦).
 *  Whether a signal becomes an OS notification is the engine's gate, unchanged (R39: visible ⇒ the dots
 *  only; hidden ⇒ the notification). Nothing here plays audio: read-along rides the OPEN view's stream
 *  alone (§12.4 Q8). Synchronous — no await, so the view read cannot go stale under it. */
export function applyThreadFrame(frame: ThreadFrame): void {
  // A thread-less view that is STREAMING may be about to adopt THIS conversation (a lazy mint whose head
  // has not landed yet — the buffered transport learns the id only from its JSON answer): its own transport
  // announces the turn, so the frame must not (S10 fix ⑦ — else "needs you" beside "needs approval").
  const open =
    frame.threadId === state.threadId ||
    (state.threadId === null && getChatStatus() === "streaming");
  if (frame.state === "running") {
    // M11 on a VISIBLE page only (S10 fix ⑥ — "so the VISIBLE device shows the turn"): a hidden page
    // re-attaching would cross the view's streaming → idle edge in a pocket (auto-TTS speaks it); nothing
    // is lost — the bridge's `returnToChat` probes when the page comes back.
    if (
      frame.threadId === state.threadId &&
      getChatStatus() !== "streaming" &&
      (typeof document === "undefined" || document.visibilityState === "visible") // `markSeen`'s guard
    )
      void probeAndReattach(frame.threadId);
    return;
  }
  if (open || frame.chained) return;
  if (frame.state === "completed" || frame.state === "capped" || frame.state === "error")
    notifyTurnTerminal(frame.threadId, frame.turnId, frame.state, undefined, frame.agent, false);
  else if (frame.state === "suspended") notifyNeedsYou(frame.threadId, frame.turnId, frame.agent);
}

// ── D61 ② the core-memory pressure hint ─────────────────────────────────────────────────────────
// The OWNER's channel for index cap pressure (the model's header carries none — D61 ③): one system
// note in the chat, at a turn boundary, telling them a `/consolidate` is due. Config owns the
// threshold; the status route reports both it and the fill, so this reads one endpoint and compares.

/** Down while a pressure episode has already been announced; re-armed the moment fill drops back
 *  under the threshold. Module-level, so the accepted semantic is ONCE PER PAGE LIFETIME per
 *  episode — a reload also drops the note it would repeat (client-only, never persisted). */
let memoryPressureNoted = false;
/** One check at a time: terminals can arrive back to back (a live `done` plus the re-attach answer
 *  that observes the same turn), and two overlapping fetches could both clear the latch. */
let memoryPressureChecking = false;
/** A terminal was DISCARDED by the guard above, so the in-flight answer is already stale — the fill
 *  it reports predates that turn. It matters in exactly the case that matters most: the
 *  consolidation turn's own terminal (the one calm reading guaranteed to exist) landing while a
 *  pressured check is still open would otherwise be dropped, the stale pressured answer would keep
 *  the latch down, and the NEXT episode would never be announced. So the discarded terminals
 *  coalesce into ONE follow-up check after the current one settles. */
let memoryPressurePending = false;

/** Best-effort look at `GET /api/memory/core/status` after a terminal; pushes the hint at most once
 *  per episode. Silent on every failure — a convenience must never surface as an error in the log. */
function checkMemoryPressure(): void {
  if (memoryPressureChecking) {
    memoryPressurePending = true;
    return;
  }
  memoryPressureChecking = true;
  void (async () => {
    try {
      const res = await fetch("/api/memory/core/status");
      if (!res.ok) return;
      const s = (await res.json()) as Partial<CoreMemoryStatus>;
      if (!s.enabled || typeof s.index_pct !== "number") return;
      if (typeof s.consolidation_nudge_pct !== "number") return;
      if (s.index_pct < s.consolidation_nudge_pct) {
        memoryPressureNoted = false; // the episode passed — the next one earns its own note
        return;
      }
      if (memoryPressureNoted) return;
      memoryPressureNoted = true;
      pushSystemNote(`// memory index at ${s.index_pct}% — run /consolidate when convenient`);
    } catch {
      /* best-effort */
    } finally {
      memoryPressureChecking = false;
      if (memoryPressurePending) {
        memoryPressurePending = false;
        checkMemoryPressure(); // one coalesced re-read, whatever the discarded terminals numbered
      }
    }
  })();
}

// The inference mode (A11/D48 C7): a provider name end-to-end (syntax-only validated on the wire; the
// registry coerces an unknown one → default). The STICKY one is a HOME override — `overrides[home].mode`,
// set by a bare `/<provider>` (D84 R40, persisted per device by ON4); a `/<provider> <msg>` forces ONE
// message through sendMessage's `mode` arg without touching it. `null` → the server's configured default.
export type ChatMode = string;

// The inference mode the CURRENT turn was sent with (ACA-16 / S2-D). `sendMessage` stashes its derived
// per-turn mode here — a per-message `/cloud <msg>` overrides the home's sticky mode for that one turn,
// so a resume/answer must carry the *turn's* mode, not re-read the override. Module-level + non-reactive
// (no UI reflects it); a chained resume keeps the original turn's mode until the next send overwrites it.
// `null` → the server's configured default.
let turnMode: ChatMode | null = null;

// The active skills the CURRENT turn was sent with (C5-M1). `sendMessage` stashes the turn's explicit
// `/skill-name` invocations here so a resume/answer can pin them per-call (see `skillsByCall`).
// Module-level + non-reactive like `turnMode`; `null`-equivalent is the empty list.
let turnSkills: string[] = [];

// ── THE HOME, THE RESPONDER, THE OVERRIDES (D84 §2, §6 — R40, R45, ON4) ───────────────────────────
// THE PRINCIPLE (owner): the home agent is the rule; the responder is the exception. Everything about a
// conversation — its overrides included — follows its HOME; the responder changes only who answers.

/** The view's HOME: the open conversation's `threadAgent` when known; with no conversation open, the
 *  home-to-be = the CONFIGURED default (what the lazy mint pins, F4/B17) — known only once a roster has
 *  LANDED (before that `rosterDefault()` is the root's placeholder, and the root's overrides must not ride
 *  the configured default's mint, S7A-02); `null` while the home is UNKNOWN (that, or a door that knew
 *  nothing and a late read that failed, §12.3 H6). */
function homeOf(s: ChatState): string | null {
  if (s.threadAgent !== null) return s.threadAgent;
  return s.threadId === null && rosterLanded() ? rosterDefault() : null;
}

/** The DISPLAY name a note gives a home: a home OFF the landed roster reads as the configured default —
 *  the client's one vanished-home paint (§12.1 ①, ISS-51 as built) — else its title-or-slug. */
function homeName(home: string): string {
  return displayName(offRoster(home) ? rosterDefault() : home);
}

/** The open home's overrides — `undefined` when it has none OR the home is UNKNOWN: a persisted, uncapped
 *  elevation never rides a conversation whose home this device cannot name (§12.3 H6). The ONE reader
 *  every send path takes (`sendMessage`, and the regenerate / answer / resume carries). */
function homeOverride(): HomeOverride | undefined {
  const home = homeOf(state);
  return home === null ? undefined : state.overrides[home];
}

/** The open home's sticky inference mode, non-reactively — the composer's attachment rail needs to know
 *  whether a `/<provider>` override is in force, because the vision hint it can render (D68 §7) is only
 *  true of the CONFIGURED chain: a forced provider resolves server-side and is not reported. */
export function getHomeMode(): ChatMode | null {
  return homeOverride()?.mode ?? null;
}

/** The open home's privilege override, REACTIVELY — the `PrivilegeChip`. `null` = none set ("Default":
 *  the home AgentDef's own); `undefined` = the home is UNKNOWN (the chip reads "…", §12.3 H6). A slice of
 *  primitives, so the chip re-renders only when its value changes, never per streamed token. */
export function useHomePrivilege(): Privilege | null | undefined {
  return useChatSlice((s) => {
    const home = homeOf(s);
    return home === null ? undefined : (s.overrides[home]?.privilege ?? null);
  });
}

/** The view's HOME, REACTIVELY — the ONE definition the chat header's conversations button and its sheet
 *  read (D84 §7, R36: the button always opens the HOME's sheet, whoever answers). `homeOf`, the chip's
 *  own rule: `null` while the home is UNKNOWN — a door that knew nothing and a failed late read, or a
 *  thread-less view before the roster lands (S7A-02) — and no surface runs against an unknown home. */
export function useViewHome(): string | null {
  return useChatSlice(homeOf);
}

/** Write ONE field of the open home's override (`null` clears it), in memory and in `ctrlb.chat` — that
 *  home's entry patched alone (§12.3 M4). Returns the home written for, or `null` when the home is
 *  UNKNOWN (nothing is written: an override keyed by a guess could land on the wrong home). */
function writeHomeOverride<K extends keyof HomeOverride>(
  field: K,
  value: HomeOverride[K] | null,
): string | null {
  const home = homeOf(state);
  if (home === null) return null;
  const entry: HomeOverride = { ...state.overrides[home] };
  if (value === null) delete entry[field];
  else entry[field] = value;
  const overrides: Record<string, HomeOverride> = { ...state.overrides };
  if (entry.privilege === undefined && entry.mode === undefined) delete overrides[home];
  else overrides[home] = entry;
  set({ overrides });
  persistOverride(home);
  return home;
}

/** `/privilege <lvl>` (bare/`default`/`clear` → `null`) and the chip: the open HOME's privilege override
 *  (R40). Allowed during a live call (§12.4 Q4 — an override is the home's setting, not a switch; it
 *  applies from the next utterance). Returns the home written for, `null` when the home is unknown. */
export function setHomePrivilege(p: Privilege | null): string | null {
  return writeHomeOverride("privilege", p);
}

/** A bare `/<provider>`: the open HOME's sticky inference mode (R40). Allowed in a call, like the
 *  privilege. Returns the home written for, `null` when the home is unknown. (No verb clears a sticky
 *  mode today — a bare `/<provider>` naming the default chain's provider is the way back.) */
export function setHomeMode(mode: ChatMode): string | null {
  return writeHomeOverride("mode", mode);
}

/** Persist ONE home's override entry (`ctrlb.chat` `overrides[home]`), read fresh and patched alone. */
function persistOverride(home: string): void {
  const entry = state.overrides[home];
  patchPersisted(KEY, (stored) => {
    const overrides = isRecord(stored.overrides) ? { ...stored.overrides } : {};
    if (entry) overrides[home] = entry;
    else delete overrides[home];
    return { overrides };
  });
}

/** Persist the VIEW TUPLE `{thread, home, responder}` — together, wherever the view identity changes
 *  (`swapView`, `setWireThread`, `loadThread`, a late home read) and by every responder write. The
 *  tuple's fields only; the overrides beside them are untouched (§12.3 M4). */
function persistView(): void {
  patchPersisted(KEY, () => ({
    thread: state.threadId,
    home: state.threadAgent,
    responder: state.responder,
  }));
}

/** §12.2 (a) — the NORMALISATION: whenever the view's HOME becomes known or changes, a responder EQUAL to
 *  it is redundant and is dropped, so a redundant override never lingers (B17 with the configured default
 *  picked thread-less: the mint is that agent's own conversation, with no responder). */
function normalised(responder: string | null, home: string | null): string | null {
  return home !== null && responder === home ? null : responder;
}

/** Install the view's HOME when it becomes known after the swap (a door's handed home on a same-id open,
 *  the late list read, B5) — normalised and persisted with the tuple. */
function installHome(home: string): void {
  set({ threadAgent: home, responder: normalised(state.responder, home) });
  persistView();
}

/** The RESPONDER, REACTIVELY — for a surface that must repaint when it changes (`useActiveAgent`: the
 *  backdrop and every active-agent surface). A slice: it changes a handful of times a session. */
export function useResponder(): string | null {
  return useChatSlice((s) => s.responder);
}

/** Set (or clear) the responder and persist the tuple — the ONE writer behind every responder change. */
function commitResponder(responder: string | null): void {
  set({ responder });
  persistView();
}

// The two live-call refusal notes (R20, §2's table): a swap would `clearAudioCache()` (the mouth) and the
// next utterance (`sendCallTranscript`) would land in another conversation or another voice.
const HANG_UP_SWITCH_CONVERSATION = "// hang up to switch conversations";
const HANG_UP_SWITCH_RESPONDER = "// hang up to switch who answers";

/** R20 — refuse a navigation / a responder change while a call is up: the note, and `true`. */
function refusedInCall(note: string): boolean {
  if (!callLive()) return false;
  pushSystemNote(note);
  return true;
}

/** R20 for a surface OUTSIDE this store whose action ends in a conversation switch — the sheet's Delete of
 *  the OPEN conversation (§12.3 M8: its fallback is a swap): while a call is up, the hang-up note, and
 *  `true` (refused). The rule, `callLive()` and the note text stay here with every other R20 site. */
export function refuseSwitchInCall(): boolean {
  return refusedInCall(HANG_UP_SWITCH_CONVERSATION);
}

/** `/agent <name>` — set WHO ANSWERS in the open conversation on this device (D84 §2, R45, THE RESPONDER
 *  door). Validity = THE ROSTER (`lib/roster`, agents ∪ the root — `/agent default` is valid): a name the
 *  LANDED roster does not hold changes nothing and toasts (`No agent named "x"` — §12.1 ③, owner-ruled
 *  2026-10-07, which superseded §2's note row); before the roster lands a name passes UNJUDGED (the first
 *  landing's sweep judges it, N2). The notes are §2's, verbatim, with `Name` = the display name:
 *    · the HOME's own name → the responder clears (`// Lynette answers again`);
 *    · the current responder → `// Emma already answers here`;
 *    · another → `// Emma answers in Lynette's conversation — /agent lynette switches back`;
 *    · no conversation open (B17) → the home-to-be is the configured default:
 *      `// Emma will answer — the conversation starts as Lynette's`, or `// Lynette will answer` when the
 *      pick IS the default (no responder — the mint is her own conversation, §12.2 a).
 *  A send already streaming finishes as whoever started it; a send WHILE it streams steers that reply —
 *  the responder applies from the next TURN (§12.3 M10). Refused in a live call (R20). */
export function setResponder(name: string): void {
  if (refusedInCall(HANG_UP_SWITCH_RESPONDER)) return;
  if (offRoster(name)) {
    pushToast(`No agent named "${name}"`, "err");
    return;
  }
  const label = displayName(name);
  const home = homeOf(state);
  if (state.threadId === null) {
    // B17 — the home-to-be is the configured default (`homeOf`).
    const homeToBe = home ?? rosterDefault();
    if (name === homeToBe) {
      commitResponder(null);
      pushSystemNote(`// ${label} will answer`);
      return;
    }
    if (state.responder === name) {
      pushSystemNote(`// ${label} already answers here`);
      return;
    }
    commitResponder(name);
    pushSystemNote(`// ${label} will answer — the conversation starts as ${homeName(homeToBe)}'s`);
    return;
  }
  if (home !== null && name === home) {
    if (state.responder === null) pushSystemNote(`// ${label} already answers here`);
    else {
      commitResponder(null);
      pushSystemNote(`// ${label} answers again`);
    }
    return;
  }
  if (state.responder === name) {
    pushSystemNote(`// ${label} already answers here`);
    return;
  }
  commitResponder(name);
  // An UNKNOWN home (H6) cannot be named — the note says only what is known; the late read normalises.
  pushSystemNote(
    home === null
      ? `// ${label} answers in this conversation`
      : `// ${label} answers in ${homeName(home)}'s conversation — /agent ${home} switches back`,
  );
}

/** Bare `/agent` — who answers here, as §2's two "talking to" notes (and B17's form with no conversation
 *  open). Changes nothing. */
export function reportResponder(): void {
  const home = homeOf(state);
  const where = home === null ? null : homeName(home);
  const r = state.responder;
  if (r === null) {
    pushSystemNote(
      where === null ? "// talking to this conversation's agent" : `// talking to ${where}`,
    );
    return;
  }
  const label = displayName(r);
  if (state.threadId === null && where !== null)
    pushSystemNote(`// ${label} will answer — the conversation starts as ${where}'s`);
  else
    pushSystemNote(
      where === null
        ? `// talking to ${label} in this conversation`
        : `// talking to ${label} in ${where}'s conversation`,
    );
}

/** THE ROSTER SWEEP (D84 §6 N2 + §12.3 M7) — ONE place, run on every LANDED roster read
 *  (`lib/composer#installAgents`, the one installer both readers of `GET /api/agents` go through; a failed
 *  read installs nothing, so it judges nothing — M3) and once more when the boot installs its stored tuple
 *  (a roster that landed BEFORE the boot read is otherwise never applied to it):
 *    1. a RESPONDER off the roster is cleared at once — the tuple rewritten, the note
 *       `// <slug> is gone — <Home> answers` (never a silent fallback while the UI still shows the name);
 *    2. every OVERRIDES slot whose HOME is off the roster is pruned (memory + `ctrlb.chat`), so a
 *       re-created slug never inherits an old elevation (ON4); clearing a responder never touches its
 *       home's slot;
 *    3. a VIEW whose HOME is off the roster moves to the configured default's latest
 *       (`openAgentConversation`) — on whichever device holds it (M7), the left view's draft + rail carried
 *       into it (E6, `carryOnLeave`); the deleting device's own immediate move is the delete's success
 *       handler (`leaveDeletedHome`, N3), so here it has usually already happened. In a live call the
 *       move is not made here — it LATCHES (`pendingHomeMove`) and the call's teardown runs it
 *       (`runAfterCall`, §12.3 M8).
 *  Import direction: `lib/composer` (the installer) → `store/chat` (this) → `lib/roster` (the data) —
 *  the edge that already runs composer → chat, never back. */
export function sweepRoster(): void {
  if (!rosterLanded()) return;
  const gone = state.responder;
  if (gone !== null && !onRoster(gone)) {
    commitResponder(null);
    const home = homeOf(state);
    pushSystemNote(
      `// ${gone} is gone — ${home === null ? "this conversation's agent" : homeName(home)} answers`,
    );
  }
  // §12.2 (a) — a THREAD-LESS view's home-to-be just became known (the configured default, `homeOf`):
  // a responder equal to it is redundant, normalised here rather than only at the mint's head.
  if (state.threadId === null) {
    const kept = normalised(state.responder, rosterDefault());
    if (kept !== state.responder) commitResponder(kept);
  }
  const dead = Object.keys(state.overrides).filter((h) => !onRoster(h));
  if (dead.length) {
    const overrides: Record<string, HomeOverride> = { ...state.overrides };
    for (const h of dead) delete overrides[h];
    set({ overrides });
    patchPersisted(KEY, (stored) => {
      const kept = isRecord(stored.overrides) ? { ...stored.overrides } : {};
      for (const h of dead) delete kept[h];
      return { overrides: kept };
    });
  }
  const home = state.threadAgent;
  if (state.threadId !== null && home !== null && !onRoster(home)) {
    if (callLive()) pendingHomeMove = home;
    else {
      carryOnLeave(state.threadId); // E6 — into whatever opens
      void openAgentConversation(rosterDefault());
    }
  }
  // A landing makes a thread-less view's home KNOWN (`homeOf`, S7A-02) without any chat-state write:
  // one emit, so the chip leaves "…" (its slice re-renders only if its value changed).
  emit();
}

// The OPEN THREAD's HOME agent (see its field note). Read-only to the app: it is not a pick anyone
// makes here, it is what the open conversation already carries, so the writes live at the load seams.
/** The home, REACTIVELY — for every surface that must follow it: the composer menu's checked row (the
 *  HOME, R38), and `useActiveAgent`'s fallback rung. Never a render-time snapshot of the store: the value
 *  can arrive on its own from `openThread`'s late list read, so a snapshot taken at render time can be
 *  stale while the surface is still up. A slice: it changes once per conversation switch, while
 *  the store emits on every streamed token. */
export function useThreadAgent(): string | null {
  return useChatSlice((s) => s.threadAgent);
}

/** Write a thread id learned from the WIRE — the stream's `thread` frame, a buffered turn's payload, an
 *  exec response: the three places a send can MINT a thread. A DIFFERENT id is exactly that mint: the
 *  thread agent becomes the head's `agent` (Phase 27 S3 put the minted conversation's HOME on the head —
 *  §12.3 H6: no surface runs against an unknown home), or `null` when the wire carried none. The SAME id
 *  is the ordinary echo of the conversation we are already in and must leave a KNOWN home alone —
 *  clearing it there would repaint every active-agent surface the moment the owner sends into a pinned
 *  thread — while an UNKNOWN one (`null`: a failed late read) is repaired from the head.
 *
 *  The RESPONDER survives the lazy mint (B17 — the thread-less view becoming its first conversation is
 *  not leaving it), normalised against the home it learns (§12.2 a); from any other view it clears. The
 *  tuple is rewritten with it. */
function setWireThread(id: string, agent?: string): void {
  if (id === state.threadId) {
    if (agent && state.threadAgent === null) installHome(agent);
    return;
  }
  // A MINT is a change of view identity, exactly like an open or a `/new` — so it invalidates every
  // parked reconciliation too (the S6 review's F3). Without this a cold `initChat` that started before
  // the send lands the OLD thread's history, and its pin, over the conversation just created.
  loadGen++;
  const home = agent ?? null;
  // The responder survives ONLY the originating lazy mint — a THREAD-LESS view becoming its first
  // conversation is not leaving it (B17); any other id change is a swap like any other (S7A-01).
  const responder = state.threadId === null ? normalised(state.responder, home) : null;
  // A wire mint is a FRESH conversation, never an archived one (H3).
  set({ threadId: id, threadAgent: home, responder, archived: false });
  persistView();
  // The per-conversation composer slot follows the view HERE too (§12.3 H2, Phase 27 S8) — and a lazy
  // mint from the thread-less view carries the `""` draft/rail into the conversation it created (Q6).
  setComposerSlot(id, true); // the wire MINT — from `""`, the auto-send gate's one non-hop (N1)
}

// ── the optimistic bubbles' object URLs (D68 MED-6) ──────────────────────────────────────────────
// A `pending_attachments` preview is a LIVE object URL handed over by the composer rail the moment a
// send is accepted (`sendMessage`'s transfer point). From then on the message list owns it, so the
// message list is where it dies: every wholesale replacement of `messages` — `reloadChat` swapping in
// the durable bubble, a steer rollback, `/new`, a thread switch — revokes whatever the new list no
// longer carries. One rule, at the single chokepoint every message write already goes through.

const livePreviews = new Set<string>();

/** Take ownership of one accepted send's previews (called at the transfer point, nowhere else). */
function ownPreviews(urls: readonly string[]): void {
  for (const url of urls) livePreviews.add(url);
}

/** Revoke every OWNED preview the next message list does not carry. One `size` read on every set
 *  where nothing is owned — which is every set on a view that has not just sent an attachment, and
 *  that matters because streamed deltas come through here token by token. While a preview IS owned
 *  (the accept → the durable swap) it is one scan of the list per set, beside the scan the reducer
 *  is already doing to build that list. */
function sweepPreviews(next: readonly ChatMessage[]): void {
  if (livePreviews.size === 0) return;
  const kept = new Set<string>();
  for (const m of next)
    for (const a of m.pending_attachments ?? []) if (a.previewUrl) kept.add(a.previewUrl);
  for (const url of livePreviews) {
    if (kept.has(url)) continue;
    URL.revokeObjectURL(url);
    livePreviews.delete(url);
  }
}

function set(next: Partial<ChatState>) {
  if (next.messages !== undefined) sweepPreviews(next.messages);
  state = { ...state, ...next };
  emit();
}

export function useChat(): ChatState {
  return useStore(() => state);
}

/** Subscribe to ONE slice of chat state (mirror of `useUISlice`). The store `emit()`s on every streamed
 *  token, so a consumer that needs only `status`/`responder` must NOT use `useChat()` (the whole
 *  object changes each token → re-render). A sliced primitive is stable across tokens, so the consumer
 *  re-renders only when ITS value changes. (`useAgentChat` legitimately needs `messages`, which change per
 *  token regardless — it keeps `useChat`.) Selector must return a primitive/stable ref (createStore contract). */
export function useChatSlice<T>(selector: (s: ChatState) => T): T {
  return useStore(() => selector(state));
}

// `useCurrentPlan` — the current task_plan, for the composer's plan pill. Memo-STABLE: the snapshot returns
// the SAME `Plan` reference unless the plan's steps actually change, so the shared composer (which mounts on
// every composer-bearing tab) does NOT re-render on every streamed token — `messages` changes each delta,
// but the plan rarely does. The createStore contract requires a primitive/stable snapshot ref; a content
// signature provides it. Keyed first on the `messages` ref so an unchanged thread is an O(1) early-out.
let planMsgsRef: ChatMessage[] | null = null;
let planRef: Plan | null = null;
let planSig = "";
function currentPlanSnapshot(): Plan | null {
  if (state.messages === planMsgsRef) return planRef;
  planMsgsRef = state.messages;
  const p = currentPlanOf(state.messages);
  const sig = p ? p.steps.map((s) => `${s.status}\x00${s.text}`).join("\x01") : "";
  if (sig !== planSig) {
    planRef = p;
    planSig = sig;
  }
  return planRef;
}
export function useCurrentPlan(): Plan | null {
  return useStore(currentPlanSnapshot);
}

/** Read the current chat status imperatively (non-reactive) — for callers outside render, e.g. the
 *  mic auto-send guarding against firing into an in-flight turn (which would be silently dropped). */
export function getChatStatus(): ChatStatus {
  return state.status;
}

// ── D71 §4.2 — THE LIVE-TURN SEAM (council F3) ───────────────────────────────────────────────────
// Turn identity used to exist only INSIDE this file, as three private slots that `stopTurn` composed on
// the spot: `state.threadId`, the seq gate's `lastTurnId`, and `state.streamingId`. That was fine while
// text Stop was the only caller; the call machine is a second one, and the wrong answer to "who else
// needs this" is a second set of slots tracking the same turn from the outside. So the composition is
// stated ONCE here, and both callers take it: `stopTurn` is now a thin composite over `cancelTurn`, and
// the call's barge-in passes the same ref with the other harvest disposition.

/** The live turn, as anything outside this file may name it. */
export interface LiveTurnRef {
  threadId: string;
  /** The turn the seq gate is watching — `null` when a stream is live but no frame has carried an id
   *  yet, which is exactly the unscoped (legacy) cancel the backend still accepts. */
  turnId: string | null;
  /** The assistant bubble receiving deltas. Carried for the deferred §4.4 truncate, which is
   *  message-scoped; nothing in S2a reads or writes through it. (The call's read-along override
   *  deliberately does NOT: this id is RENAMED mid-stream when `message.start` adopts the server's,
   *  so it cannot key anything that must survive the adoption.) */
  assistantMessageId: string | null;
}

/** The live turn, or `null` when there is nothing to cancel. NON-NULL IFF `status === "streaming"` —
 *  the same authority `stopTurn` has always used, so "is there a turn" cannot be answered two ways. */
export function getLiveTurn(): LiveTurnRef | null {
  if (state.status !== "streaming" || !state.threadId) return null;
  return {
    threadId: state.threadId,
    turnId: lastTurnId,
    assistantMessageId: state.streamingId,
  };
}

/** Is a tool call on this thread still waiting on the owner — a confirm gate or a question with no
 *  result beside it (D71 §4.5's delta-round F1)? Derived from the message shapes the reducer already
 *  writes, beside `RUN_STATES`, so there is no parallel "suspended" flag to keep in step. The call
 *  machine reads it as a submit HOLD: a suspended turn leaves chat status `idle`, so an utterance sent
 *  into it would take the optimistic fresh-turn path and strand on the held turn's 202. */
export function confirmOutstanding(): boolean {
  return awaitingCall("awaiting_confirm", "awaiting_answer") !== null;
}

/** The FIRST tool call on this thread still waiting on the owner in one of `states`, or `null`. The one
 *  scan behind both readers below — "is anything waiting" and "what exactly is waiting" are the same
 *  question asked twice, and two copies of this walk is how one of them stops matching the reducer. */
function awaitingCall(...states: RunState[]): ToolCallPart | null {
  for (const m of state.messages) {
    for (const p of m.parts) {
      if (p.type !== "tool_call" || !states.includes(p.state)) continue;
      if (!m.parts.some((r) => r.type === "tool_result" && r.call_id === p.call_id)) return p;
    }
  }
  return null;
}

/** WHAT is waiting for an Allow/Deny, for a surface that renders its own two buttons — the call
 *  overlay's in-overlay confirm row (D71 §4.5 · §6). `awaiting_answer` is deliberately NOT included:
 *  a suspended `question` wants typed words, and the chat card is where those are given; the overlay
 *  still HOLDS its utterances for it (`confirmOutstanding`, which does count it) and simply offers no
 *  row. The decision itself rides `resumeCall` — the same chokepoint and the same single-use token as
 *  the chat card, so no consumer of this ever touches a confirm token.
 *
 *  REFERENCE-STABLE by contract, like `Playback.chunks`: the `createStore` snapshot rule requires a
 *  primitive or a stable reference, and a fresh `{callId, tool}` on every read would re-render forever.
 *  The memo returns the SAME object while the same call is waiting for the same tool. */
export interface AwaitingConfirm {
  callId: string;
  /** The tool's raw name — the row formats it exactly as the chat card's summary does. */
  tool: string;
}
let awaitingMemo: AwaitingConfirm | null = null;
export function confirmAwaiting(): AwaitingConfirm | null {
  const p = awaitingCall("awaiting_confirm");
  if (p === null) awaitingMemo = null;
  else if (
    awaitingMemo === null ||
    awaitingMemo.callId !== p.call_id ||
    awaitingMemo.tool !== p.tool
  )
    awaitingMemo = { callId: p.call_id, tool: p.tool };
  return awaitingMemo;
}

/** A message's VISIBLE prose: its text parts, joined in order. Reasoning and tool parts are excluded
 *  by construction — the store keeps those as parts of their own, and everything that renders "what was
 *  said" means this one. Lives here rather than in either reader because it has two: the transcript
 *  bubbles (`components/ChatThread`) and the call screen's captions (`kit/CallOverlay`, through
 *  `lastReply` below), and two copies of a filter is how one of them starts including reasoning. */
export function textOf(parts: Part[]): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** The thread's LAST assistant message — its id and its prose — or `null` when there is none. The call
 *  captions' whole source (owner ask 2026-09-22), and a non-reactive reader in the family of
 *  `getChatStatus`/`getLiveTurn`: the caption block takes it through `useChatSlice` for the live text
 *  and calls it directly to latch its mount-time floor.
 *
 *  The ID rides along because the caller needs to tell one reply from another — the captions may only
 *  show a turn that STARTED after the call did (§4.5), and "is this still the reply that was already
 *  there" is an identity question. Deliberately NOT scanned back to the user boundary
 *  (`useAutoTts.finalReply`'s rule, whose question is a different one): a turn's later step is still
 *  the last thing the agent said, and that is what the screen should be showing. */
export function lastReply(): { id: string; text: string } | null {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m.role === "assistant") return { id: m.id, text: textOf(m.parts) };
  }
  return null;
}

/** What a view swap installs: the conversation's identity — its id, its history, its HOME, and whether
 *  it is ARCHIVED (`null` = not yet known, H3). */
type ViewSwap = Pick<ChatState, "threadId" | "messages" | "threadAgent" | "archived">;

/** Swap the chat view to another conversation — THE one place the per-conversation client state is
 *  dropped. Every entry is keyed to the conversation being left (its TTS blobs, the turn-event ordering,
 *  harvested raw lines, the last harvest receipt), and three doors change the view's identity this way:
 *  an explicit `openThread`, `/new`'s minted thread, and `/new`'s thread-less fallback. They used to
 *  carry this block as copies; a third copy is how one of them stops dropping something.
 *
 *  Bumps the LOAD GENERATION (see `loadGen`): a swap is a change of view identity, so every
 *  reconciliation parked against the identity it replaces is stale by definition — a cold `initChat` or
 *  a `reloadChat` must not land the OLD thread's history (and its pin) on the view just swapped in.
 *  Returns the new generation so a caller can guard a follow-up on it. Claims NO open ticket
 *  (`openSeq`): tickets order user DECISIONS, and each caller claimed its own at entry.
 *
 *  HOP WHILE STREAMING (Phase 27 S6, R9): a swap is allowed while a turn streams. It also bumps the
 *  STREAM generation, so the left turn's live stream (and any re-attach) goes stale at once and never
 *  writes into the view swapped in — the turn itself continues server-side as a background conversation,
 *  and a later visit re-attaches to it (`probeAndReattach`). A send whose POST is still in flight is
 *  held off by the adopt guard instead (`viewMoved`). Only the VIEW's optimistic state goes with the
 *  swap (its messages, queued bubbles included, are replaced); the left thread's raw steer lines stay
 *  with that thread (O22, see `rawByEntry`).
 *
 *  THE RESPONDER'S LIFETIME (R45): every swap LEAVES the conversation on this device — the responder
 *  clears. (Every caller changes the thread — an open, a mint — or is the thread-less RESET, which leaves
 *  by definition; the same-conversation landings that KEEP it never swap: `openThread`'s same-id branch,
 *  B5, the cold load. So the §12.2 (a) normalisation lives at the non-swap installs — `setWireThread`,
 *  `loadThread`, `installHome` — and a swap needs none: it clears outright.) The view tuple is rewritten with the swap (the one
 *  `ctrlb.chat` write per view change).
 *
 *  THE COMPOSER (Phase 27 S8): a live STREAMING dictation is stopped FIRST, by every swap (§12.2 ④,
 *  §12.3 L7 — a door, `/new`, the delete fallbacks, the thread-less reset): the recorder is global, and
 *  its words land in the slot it started in (R35), never in the view swapped in; the stop resolves
 *  later, and the E6 carry waits for it (`carryOnLeave`). Then the per-conversation draft + rail follow
 *  the view (`setComposerSlot`, H2 — with the thread-less `""` move, Q6). */
function swapView(view: ViewSwap): number {
  void stopLiveDictation();
  const gen = ++loadGen;
  ++streamGeneration; // S6 — every stream claimed against the view being left is stale from here
  clearAudioCache(); // 6b-2: revoke the left thread's TTS blobs + stop any playback
  lastTurnId = null; // D39: a new view starts a fresh per-turn event ordering
  lastSeq = 0;
  lastHarvestSig = null; // FIX E — forget the last harvest receipt (mirrors the backend clear)
  set({ ...view, responder: null, status: "idle", streamingId: null });
  persistView();
  setComposerSlot(view.threadId ?? "");
  return gen;
}

/** Drop to a fresh, THREAD-LESS view — the next send mints the conversation lazily (D70 §4.2 seam ②:
 *  the server creates one, pinned to the configured default, when `thread_id` is null). Where a FAILED
 *  `/new` mint falls back to (`mintAndOpen`). A RESET is a swap that always LEAVES: the responder clears
 *  (R45), even from a thread-less view — `/new` asked for a fresh start.
 *
 *  No open ticket: that is the CALLER's decision. Exported for the test suites, whose singleton store
 *  needs a SYNCHRONOUS reset between cases that performs no mint (the "exported for tests" idiom,
 *  `store/ui.ts`). */
export function resetToThreadless(): void {
  swapView({ threadId: null, messages: [], threadAgent: null, archived: null });
}

/** Fetch one thread's persisted history. Split from the state write so a caller can decide what to do
 *  with a FAILED fetch before it has touched the view (see `openThread`). A non-OK answer IS a failed
 *  fetch (ISS-31): its `{detail}` body is not a message list, and handed back as one it would be set as
 *  `messages` by whichever loader asked — every caller already has a failure path for a throw. It throws
 *  an `HttpRefusal` so a caller can tell the server's definite answer (`openThread`'s 404 = the
 *  conversation was deleted, M6) from an unreachable backend; the message keeps the old shape. */
async function fetchMessages(threadId: string): Promise<ChatMessage[]> {
  const url = `/api/threads/${threadId}/messages`;
  const res = await fetch(url);
  if (!res.ok) throw new HttpRefusal(url, res.status, "");
  return (await res.json()) as ChatMessage[];
}

// ── the thread lists' staleness signal (Phase 27 M6) ─────────────────────────────────────────────
// The thread LIST is ordinary server state (DESIGN §13 as amended: `useQuery(['threads', agent])`, with
// the per-agent status on `['agents']`), but this store learns things about it first — an open that
// answers 404 means a conversation the lists still show is gone. A plain module cannot reach the
// QueryClient (it lives in the React tree), so the store PUBLISHES and a mounted hook invalidates — the
// `notifyBus` shape (an event, delivered once; no state to snapshot). S7's thread-list hook is its
// subscriber; until one mounts there is no cached list to invalidate, so a publish into no listener is
// correct, not lost.
const threadListListeners = new Set<() => void>();
/** Subscribe to "the thread lists are stale" — returns the unsubscribe (a `useEffect` cleanup). */
export function onThreadListsStale(cb: () => void): () => void {
  threadListListeners.add(cb);
  return () => threadListListeners.delete(cb);
}
function threadListsStale(): void {
  for (const cb of threadListListeners) cb();
}

/** What the late RECORD read learns about one thread (§12.3 H6 + H3): its HOME (`null` = the record
 *  names none) and whether it is ARCHIVED. */
interface ThreadRecord {
  agent: string | null;
  archived: boolean;
}

/** ONE thread's RECORD — its HOME (D11's pin) and its `archived` flag — read from the LIST
 *  (`GET /api/threads` publishes whole `Thread` dumps and is the only thread-record route there is — no
 *  by-id read exists, and an explicit open is rare enough that adding one would be a backend endpoint
 *  bought for two fields the list already carries). The repair for a door that KNEW NOTHING (H6): the
 *  automations run history, a `?thread=` cold start (S10).
 *
 *  `include_archived` because of WHO opens threads that way: the automations run history, and an A3 run
 *  mints an ARCHIVED thread pinned to the automation's agent (a terminal per-run thread is deliberately
 *  continuable in chat). The bare list hides those, so this read — the one that has already been told
 *  which thread it wants — would ask for a row it could never see (the S6 review's F1). It is also how
 *  such a view learns it is archived (H3): no seen write, no R29. `initChat` reads the same flagged list
 *  (an archived run the owner left open must still count as present at boot) and picks its "newest"
 *  among the NON-archived rows, so the boot view never adopts an automation's thread on its own.
 *
 *  BEST-EFFORT by design: a thread that opens with its history intact must not fail because this second
 *  read did — `null` leaves the view's home and `archived` UNKNOWN (no override rides a send, no seen
 *  write fires), and the SERVER still routes the turn by the thread's own field either way. */
async function fetchThreadRecord(threadId: string): Promise<ThreadRecord | null> {
  try {
    const res = await fetch("/api/threads?include_archived=true");
    const threads = (await res.json()) as Thread[];
    const row = threads.find((t) => t.id === threadId);
    return row ? { agent: row.agent ?? null, archived: row.archived === true } : null;
  } catch {
    return null;
  }
}

/** Install a RECORD the read returned — only on the view STILL on its thread (the read's whole guard):
 *  its home (a `null` agent needs no write) and its `archived` flag. */
function installRecord(threadId: string, rec: ThreadRecord | null): void {
  if (rec === null || state.threadId !== threadId) return;
  if (rec.agent !== null) installHome(rec.agent);
  set({ archived: rec.archived });
}

/** The record repair RETRIED (S7B-04): a view whose `archived` is still UNKNOWN — its door's first record
 *  read failed — re-reads it (the same guarded `fetchThreadRecord`) before a trigger decides. Never
 *  inferred: an archived automation run is continuable, so no wire echo can say `false`. Called by the
 *  seen write's entry and a same-id `openThread`; a no-op once known. */
async function repairRecord(): Promise<void> {
  const threadId = state.threadId;
  if (threadId === null || state.archived !== null) return;
  installRecord(threadId, await fetchThreadRecord(threadId));
}

// ── the seen write (D84 §6 "Seen write" — R30, O11, O10, §12.3 H3, Sol F2) ────────────────────────
// `PATCH /api/threads/{id} {seen_at}` = "the owner has SEEN this conversation up to its newest row" —
// the server's unread predicate's floor, read on every device (the `seen` frame, S10). ONE writer,
// `markSeen`, fired from three places:
//   (a) after a conversation's history lands (`loadThread`; `openThread`'s swap, or its late record read
//       for a door that knew nothing);
//   (b) when a turn settles in the OPEN view — `reloadFloor`, the one installer every turn end this view
//       started or attached to goes through (and every sync route's floor);
//   (c) on regaining visibility / switching back to the chat tab — `returnToChat`, AFTER its refetch (F2).
// Each ONLY while the page is visible AND the chat tab is on screen, and NEVER for an archived view (H3:
// its PATCH 404s) or one whose `archived` is not known yet (the next trigger retries). On success the
// thread lists are stale (O10: the row's dot and the roster's `status`); a 404 on the open view is R29.

/** The newest `ts` this device WROTE per thread, in epoch ms — a cheap dedupe, not persisted (a reload
 *  simply writes once more; the server keeps the max anyway). */
const lastSeen = new Map<string, number>();

/** The view's newest DURABLE row's `ts` (client-only rows — notes, optimistic bubbles, the "…"
 *  placeholder — carry the device's clock and no server row), or `null` when the view holds none. */
function newestDurableTs(messages: readonly ChatMessage[]): { ts: string; ms: number } | null {
  let best: { ts: string; ms: number } | null = null;
  for (const m of messages) {
    if (m.local) continue;
    const ms = Date.parse(m.ts);
    if (Number.isFinite(ms) && (best === null || ms > best.ms)) best = { ts: m.ts, ms };
  }
  return best;
}

/** The seen write's screen gate: the page is visible AND the chat tab is on screen. */
function chatOnScreen(): boolean {
  return (
    (typeof document === "undefined" || document.visibilityState === "visible") &&
    getUI().tab === "agent"
  );
}

/** THE SEEN WRITE — see the block note above. Resolves when the PATCH settled (or nothing was sent); it
 *  never throws. A write that fails rolls this device's dedupe back, so the next trigger retries. */
export async function markSeen(): Promise<void> {
  if (!chatOnScreen()) return;
  if (state.archived === null) {
    // S7B-04 — a failed first read is retried here. The gate is re-checked after the await (S7B-C01): a
    // page hidden, a tab switched or a view moved while the record read was in flight writes nothing.
    const at = viewHere();
    await repairRecord();
    if (!chatOnScreen() || viewMoved({ view: at })) return;
  }
  const threadId = state.threadId;
  if (threadId === null || state.archived !== false) return; // H3 — archived, or still not known
  const newest = newestDurableTs(state.messages);
  if (newest === null) return;
  const prior = lastSeen.get(threadId);
  if (prior !== undefined && newest.ms <= prior) return; // nothing newer than this device already wrote
  lastSeen.set(threadId, newest.ms);
  const rollback = (): void => {
    if (lastSeen.get(threadId) !== newest.ms) return; // a newer write owns the slot now
    if (prior === undefined) lastSeen.delete(threadId);
    else lastSeen.set(threadId, prior);
  };
  try {
    const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seen_at: newest.ts }),
    });
    if (res.status === 404) {
      rollback();
      conversationDeleted(threadId); // R29 — only if the view is still on it (and still live)
      return;
    }
    if (!res.ok) {
      rollback();
      return;
    }
    threadListsStale(); // O10 — the bridge invalidates `['threads']` + `['agents']`
  } catch {
    rollback(); // unreachable — the next trigger retries
  }
}

/** (c) — the page became visible, or the chat tab came back on screen (`useThreadListsBridge`, the ONE
 *  listener): refetch the open view; the seen write follows a SUCCESSFUL floor install ONLY (Sol F2 —
 *  the REFRESHED newest row, never a stale pre-background floor): it is `reloadFloor`'s own success arm,
 *  so a refetch that FAILED, or was SKIPPED because the view streams (its rows carry the device's
 *  clock), writes nothing — the next trigger retries (S7B-01). The refetch is the D81 floor installer —
 *  the durable history, keeping what only this view holds (its notes, an unsent bubble, an error's
 *  retry), which a tab switch must not wipe — then `reconcileChat`'s other half, the re-attach probe for
 *  a turn that went live meanwhile, guarded by the view identity (S6's `viewHere`). */
export async function returnToChat(): Promise<void> {
  const at = viewHere();
  const threadId = at.thread;
  if (threadId === null) return;
  await reloadFloor();
  if (viewMoved({ view: at })) return;
  if (getChatStatus() !== "streaming") void probeAndReattach(threadId);
}

// ── deleted elsewhere (D84 §6 — R29, R42, §12.3 M6/M8; B11, B12) ─────────────────────────────────
// A thread-scoped request on the OPEN conversation answering 404 — a send (`streamTurn`), the seen
// PATCH, a history read (`reloadFloor`, `reloadChat`, the boot's `loadThread`) — means another device
// deleted it. Outside a call: the toast, the lists stale, the HOME's latest (`openAgentConversation`,
// which resolves a home off the roster to the configured default — Q2). DURING a call the 404 is
// LATCHED: no toast, no swap (B12 — the call goes on; its utterances keep failing), and the call's
// teardown runs the path once (`runAfterCall`). An ARCHIVED view (or one not known to be live) is never
// a source (H3). Every one of these moves carries the left conversation's draft + staged rail into what
// opened (E6, `carryOnLeave`) — a send that hit the 404 has already returned its words to that draft.

/** The open conversation found deleted DURING a call (R42) — run at the call's teardown. */
let pendingDeleted: string | null = null;
/** The open view's HOME deleted DURING a call (§12.3 M8 — a Conf → Agents delete of it on this device,
 *  N3, or a roster refresh on any device, M7) — the move to the configured default's latest, run at the
 *  call's teardown. Holds the deleted slug. */
let pendingHomeMove: string | null = null;
/** The thread whose R29 move is in flight — two 404 sources racing (the seen PATCH beside a floor read)
 *  toast and move once. */
let r29InFlight: string | null = null;

function conversationDeleted(threadId: string): void {
  if (state.threadId !== threadId || state.archived !== false) return;
  if (r29InFlight === threadId) return;
  if (callLive()) {
    pendingDeleted = threadId; // R42 — latched, nothing shown
    return;
  }
  pushToast("this conversation was deleted");
  threadListsStale();
  moveOffDeleted(threadId);
}

/** THE MOVE OFF A DELETED OPEN CONVERSATION — shared by the remote path (`conversationDeleted`, R29) and
 *  the local one (`conversationRemoved`, B8): claim the `r29InFlight` guard (between a DELETE's answer and
 *  the swap the view still sits on the dead id, and a concurrent 404 — a `markSeen`, a floor read — must
 *  neither toast "deleted" nor start a second move), arm the E6 carry, open the HOME's next latest (or a
 *  fresh greeted one). */
function moveOffDeleted(threadId: string): void {
  r29InFlight = threadId;
  // E6 — the dead conversation's draft + staged rail (and a 404'd send's words, already returned to
  // that draft by `returnToOrigin`) move into whatever opens next — this fallback's target, or the
  // owner's own door if it supersedes it (`store/composer#carryOnLeave`, consumed at the slot setter).
  carryOnLeave(threadId);
  void openAgentConversation(state.threadAgent ?? rosterDefault()).finally(() => {
    if (r29InFlight === threadId) r29InFlight = null;
  });
}

// ── THE SHEET'S DELETE (D84 §2 B8) — Phase 27 S9b grows this store's public surface by FOUR exports:
// `useViewHome`, `refuseSwitchInCall`, `armConversationRemoval` and `conversationRemoved`.
//
// The sheet judges "the OPEN row" at its COMMIT; the DELETE's success lands a round trip later, and the
// owner can take a door in between (the sheet stays open after a Delete) — or a remote 404 can move the
// view with its E6 carry deferred behind a dictation stop. So the commit's facts are LATCHED here and the
// success rules by them, never by the view it happens to find.

/** The commit's facts for the sheet's last Delete: the id, the navigation ticket at the commit, and
 *  whether it was the open conversation then. ONE slot — every commit overwrites it, so a failed
 *  attempt's latch is harmless (re-armed by the next commit, consumed only for its own id). */
let removal: { id: string; seq: number; wasOpen: boolean } | null = null;
// (Its `seq` is REFRESHED by the two navigations that do not leave the open conversation — `openThread`'s
// same-id branch and `openAgentConversation`'s B5 in-place arm. RECORDED: a DELETE success landing BEFORE
// such a tap commits still arms only the carry; the next 404 on the dead id moves the view.)

/** Called by the sheet AT THE COMMIT of a Delete (after the confirm and the second M8 check, right before
 *  the request) — latches what `conversationRemoved` rules by. */
export function armConversationRemoval(threadId: string): void {
  removal = { id: threadId, seq: openSeq, wasOpen: state.threadId === threadId };
}

/** THIS DEVICE deleted `threadId` on purpose — the conversations sheet's Delete (D84 §2 B8), called by the
 *  delete mutation's success (a 404 answer counts: the row is gone either way). The LOCAL sibling of
 *  `conversationDeleted`: no toast (the owner just did it), no call latch (the sheet refuses an open-row
 *  delete in a call BEFORE the request, M8; a call started DURING the request makes the move refuse, and
 *  the next 404 latches). It consumes the commit's latch (`armConversationRemoval`) and rules:
 *    · the view is STILL on it — a navigation started since the commit (another door in flight) → only
 *      arm the E6 carry: that door's swap consumes it, and its ticket stays the owner's newest intent;
 *      otherwise → the home's next latest with the draft + rail carried (`moveOffDeleted`), once;
 *    · the view already LEFT it — after any pending carry has finished (`slotsCarried`: a carry deferred
 *      behind a dictation stop goes FIRST, after which the source's keys are gone and this is a no-op):
 *      it WAS open at the commit → its draft + rail follow the owner into the view they are in NOW (E6,
 *      their own door included); it was not → its draft + rail are DROPPED (`pruneSlots`).
 *  The lists' refresh is the mutation's (`onSettled`). */
export function conversationRemoved(threadId: string): void {
  const latch = removal?.id === threadId ? removal : null;
  if (latch) removal = null;
  if (state.threadId === threadId) {
    if (latch && latch.seq !== openSeq) carryOnLeave(threadId);
    else if (r29InFlight !== threadId) moveOffDeleted(threadId); // a racing 404 already moved: once
    return;
  }
  void slotsCarried().then(() => {
    if (latch?.wasOpen) moveSlots(threadId, state.threadId ?? "");
    else pruneSlots((k) => k !== threadId);
  });
}

/** N3 (D84 §4, §2 B18) — the agent this device just DELETED was the open view's HOME: move to the
 *  configured default's latest (or a fresh greeted one), the responder clearing with the swap. No toast
 *  — the owner just did it (the delete's own toast speaks). Called by the delete's success handler on
 *  BOTH branches of the second confirm (the conversations deleted, or left orphaned and listed nowhere)
 *  — never through the 404 path, whose target would be the deleted slug. In a call it LATCHES (M8). */
export function leaveDeletedHome(name: string): void {
  if (state.threadId === null || state.threadAgent !== name) return;
  if (callLive()) {
    pendingHomeMove = name;
    return;
  }
  carryOnLeave(state.threadId); // E6 — into whatever opens
  void openAgentConversation(afterDeleteOf(name));
}

/** Where N3 lands (S7B-03): the configured default — unless the deleted agent WAS the configured default
 *  (the roster that still names it has not refetched yet), then the ROOT, never the deleted slug. */
function afterDeleteOf(deleted: string): string {
  const dflt = rosterDefault();
  return dflt === deleted ? DEFAULT_AGENT : dflt;
}

/** THE CALL'S TEARDOWN RUNNER (R42, M8) — what a call latched, run ONCE when it is over: the move off a
 *  deleted HOME, or the deleted-elsewhere path for the conversation the call was in — each only if the
 *  view is STILL there. A pending HOME MOVE takes PRECEDENCE (S7B-02): both latches are consumed by ONE
 *  N3 move with no toast — the R29 path would toast a remote delete for a local one and resolve the
 *  deleted home's latest; R29 runs only when no home move matches the view. Called from the one place every call's teardown completes
 *  (`useLiveCall`'s unmount cleanup — `endCall()`'s unmount IS the teardown). A redial remounts with the
 *  call still up (and StrictMode's simulated cleanup runs mid-call): the latch then waits for the real end. */
export function runAfterCall(): void {
  if (callLive()) return;
  const dead = pendingDeleted;
  const home = pendingHomeMove;
  pendingDeleted = null;
  pendingHomeMove = null;
  if (home !== null && state.threadId !== null && state.threadAgent === home) {
    leaveDeletedHome(home); // N3, with its E6 carry (`callLive()` is false here)
    return;
  }
  if (dead !== null && state.threadId === dead) conversationDeleted(dead);
}

/** Hydrate ONE thread into the chat view: its persisted history, then the D39/M4 re-attach probe.
 *
 *  The cold-load seam (`initChat`). The last turn of the thread we are opening may still be running
 *  detached (the mobile app-kill headline case — the socket died, the server-owned task did not), so the
 *  probe runs AFTER the initial paint (non-blocking, snapshot path, so a live turn resumes streaming
 *  instead of looking dead).
 *
 *  `gen` is the caller's load generation: the write is DISCARDED if a newer load has started since (see
 *  `loadGen`), so a slow fetch can never land on top of a view that has moved on. `agent` is the HOME
 *  and `archived` its flag (from the record the caller already holds — H6, H3), and `responder` the one
 *  the boot rule decided to keep (N1: only when this is the conversation the device was last in),
 *  normalised against the home. The history landing is a seen trigger (a). */
async function loadThread(
  threadId: string,
  gen: number,
  agent: string | null,
  archived: boolean,
  responder: string | null,
): Promise<void> {
  const msgs = await fetchMessages(threadId);
  if (gen !== loadGen) return; // superseded mid-fetch — this result belongs to a view that is gone
  // The cold load writes `threadId` through neither `swapView` nor `setWireThread`, so it is the third
  // place the view's identity is installed (§12.3 H2): the HOME arrives with it, the view tuple is
  // rewritten with it, and the per-conversation composer slot follows it (`setComposerSlot`, S8 — B13
  // across a reload: the draft and the rail the device left in this conversation come back with it).
  set({
    threadId,
    messages: msgs,
    threadAgent: agent,
    archived,
    responder: normalised(responder, agent),
  });
  persistView();
  setComposerSlot(threadId);
  void markSeen();
  void probeAndReattach(threadId);
}

/** Open a SPECIFIC thread in the chat view — the automations run history's "open thread" (14c/§D-6).
 *
 *  Deliberately built from the SAME parts as `loadThread` (`fetchMessages` + the post-swap
 *  `probeAndReattach`) rather than as a second loader stack: an automation's run thread is an ordinary
 *  (archived) thread, and it must arrive with the same history + re-attach behaviour as the one
 *  `initChat` picks. It cannot call `loadThread` itself — fetch-first-swap-second and the cache drops
 *  have to happen BETWEEN those two parts. The per-thread client caches are dropped when the swap
 *  actually happens, through `swapView` — the one place every view swap (this, `/new`'s mint, its
 *  thread-less fallback) drops them.
 *
 *  **Fetch first, swap second** (post-14c review): the earlier shape cleared the view and then fetched,
 *  so an unreachable backend left the owner staring at an emptied chat they had not asked to lose. The
 *  current view is only touched once the replacement is in hand.
 *
 *  NOT refused while a turn is streaming (Phase 27 S6, R9 — it was, ACA-10/S2-C): the swap goes ahead,
 *  the left turn continues server-side as a background conversation, and coming back re-attaches to it
 *  (the post-swap probe). `swapView` makes the left stream stale; `streamTurn`'s adopt guard keeps a send
 *  still in flight out of the new view.
 *
 *  `home` (§12.3 H6): the conversation's HOME agent when the door already knows it — a sheet row's
 *  `agent`, `openAgentConversation`'s name, a notification frame's `agent`. It is installed AT the swap,
 *  so no surface (and no send) ever runs against an unknown home — and a handed home implies the view is
 *  NOT archived (H3: every door that knows a home names a live conversation). Only a door that knows
 *  nothing (the automations run history, a `?thread=` cold start) falls back to the late RECORD read,
 *  which installs both the home and `archived` (and then marks the view seen — trigger (a)).
 *
 *  A 404 means the conversation is gone (§12.3 M6 — a stale row, a tap after a delete elsewhere): the
 *  "deleted" toast, the thread lists marked stale, and the view STAYS where it was. Any other failure
 *  keeps the "unreachable" note. Returns whether the thread was opened, so the caller can skip the tab
 *  switch it would otherwise make. */
export async function openThread(threadId: string, home?: string): Promise<boolean> {
  // R20 — no conversation switch while a call is up (the swap would silence the mouth and send the next
  // utterance elsewhere). Refused BEFORE the ticket: a refused door supersedes nothing.
  if (refusedInCall(HANG_UP_SWITCH_CONVERSATION)) return false;
  // Claimed unconditionally at entry — even an open that goes on to fail supersedes an older pending
  // one (the owner's newest intent is the one that counts).
  const ticket = ++openSeq;
  if (state.threadId === threadId) {
    // A tap on the open conversation does not LEAVE it: a sheet Delete of it latched before this tap
    // must not read the bumped ticket as "a door in flight" (S9b micro-wave ⑩).
    if (removal?.id === state.threadId) removal.seq = openSeq;
    // Already here, so no reload and no cache churn — and the RESPONDER STAYS (R45: a notification tap or
    // a sheet-row tap on the open conversation is not leaving it). But DO re-probe: an automation's
    // rolling thread can have gone live since the owner last looked at it, and the probe is what
    // re-attaches to it. A home the door knows repairs a view whose home is still unknown (a failed late
    // read) — and says the view is live (H3).
    if (home) {
      if (state.threadAgent !== home) installHome(home);
      if (state.archived === null) set({ archived: false });
    } else if (state.archived === null) void repairRecord().then(() => markSeen()); // S7B-04
    void probeAndReattach(threadId);
    return true;
  }
  try {
    // The record read starts BESIDE the history and never gates it. `GET /api/threads` is the LIST route, so
    // an open that awaited it would inherit the list's latency — and a parked list read (a cold `initChat`
    // in flight against a slow backend) would hang the open outright, which is exactly the coupling
    // explicit navigation is kept free of. It lands late instead, under this file's usual post-await
    // guards — and only for a door that did not hand the home in (H6).
    const history = fetchMessages(threadId); // …started FIRST: the history is what the open lives or dies by
    const record = home ? null : fetchThreadRecord(threadId);
    const msgs = await history;
    if (ticket !== openSeq) return false; // a newer open (or /new) superseded this one mid-fetch
    // R20 at the COMMIT point too (S7A-03): a call started while the history was in flight.
    if (refusedInCall(HANG_UP_SWITCH_CONVERSATION)) return false;
    // An explicit open is a user DECISION, so it invalidates any reconciliation in flight (a slow
    // initChat/reloadChat landing after this must be discarded) — the swap's generation bump.
    // With no home handed in, `threadAgent: null` is the HONEST value at the swap — the home is not known
    // yet, and a stale one from the thread being left would be worse than none. The DOOR CONTRACT
    // (§12.4 F2): `home` is `undefined` when the door does not know it, a slug when it does — never
    // `null` (the root is `"default"`).
    const gen = swapView({
      threadId,
      messages: msgs,
      threadAgent: home ?? null,
      archived: home ? false : null,
    });
    loaded = true; // a later `initChat` must not replace this with the most-recent thread
    if (gen === loadGen) {
      if (home) void markSeen(); // (a) — a door that knew nothing marks seen when its record lands
      void probeAndReattach(threadId);
    }
    // …and the RECORD when it arrives, if the VIEW IS STILL ON THIS THREAD (the H6 repair): its home (a
    // `null` agent needs no write — the swap already said null) and its `archived` flag (H3), then the
    // seen write the swap could not make yet. A failed read leaves both unknown.
    //
    // `threadId` alone is the whole guard, deliberately — an open ticket must NOT be part of it (the
    // main-seat audit of wave 1c). Every navigation the ticket would have caught moves `threadId` first
    // (another open's swap, a `/new`, a wire mint), so this comparison already refuses every stale
    // write; and a pin that is "stale" by ticket for the thread STILL ON SCREEN is by definition the
    // right value for what the owner is looking at. Including the ticket actively broke the same-thread
    // RE-OPEN: `openThread` claims a ticket unconditionally at entry, before the same-id early return —
    // and that early return starts no pin read of its own, so re-tapping the thread you are already
    // opening invalidated the only pin fetch that would ever run, and a pinned thread sat at `null`
    // until the next real navigation.
    void record?.then((rec) => {
      installRecord(threadId, rec);
      if (rec !== null && state.threadId === threadId) void markSeen();
    });
    return true;
  } catch (e) {
    // Nothing was cleared — the view the owner was looking at is still intact. The note only speaks
    // for the CURRENT intent (R3, L2): a superseded open failing late must not drop a misleading
    // "unreachable" note into the view of the open that won.
    if (ticket !== openSeq) return false;
    if (e instanceof HttpRefusal && e.status === 404) {
      // M6 — the conversation is gone; the lists that offered it are stale. The view stays.
      pushToast("this conversation was deleted");
      threadListsStale(); // `useThreadListsBridge` invalidates the cached lists
    } else pushSystemNote("// could not open that thread — the backend is unreachable");
    return false;
  }
}

/** THE BOOT'S TAP TARGET (Phase 27 S10, fix ②) — `store/ui`'s one-shot `?thread=` is taken ONCE, then
 *  kept HERE across `initChat` retries (a transient history failure must not spend it — the retry would
 *  boot the stored conversation, responder and all), until the boot resolves it (opened, or proven
 *  unopenable) or a newer navigation supersedes it (`openSeq` moved since the take). */
let bootTap: { id: string; seq: number } | null = null;
let bootTapTaken = false;

/** The boot's tap target, if it still stands (see `bootTap`). */
function takeBootTap(): string | null {
  if (!bootTapTaken) {
    bootTapTaken = true;
    const id = takeBootThread();
    if (id !== null) bootTap = { id, seq: openSeq };
  }
  if (bootTap !== null && bootTap.seq !== openSeq) bootTap = null; // superseded by a newer door
  return bootTap?.id ?? null;
}

/** THE BOOT — ONE rule (D84 §6 N1; first Agent-tab mount, and `reloadChat` with no thread yet).
 *
 *  Load the stored view tuple (`ctrlb.chat`, folded); the TARGET = a notification tap's validated
 *  `?thread=` (`takeBootTap`, S10 — kept across this boot's retries) when it lists, else the stored
 *  `thread`. A tapped conversation OTHER than the stored one opens with no responder and is never an R29
 *  source: deleted between the list and its history read, the boot falls back QUIETLY to the stored
 *  conversation, else the newest (fix ③); a stored conversation that no longer lists while a tap opens
 *  another has its draft + rail carried into what opens, untoasted (fix ⑧). ONE list
 *  read, `GET /api/threads?include_archived=true` (§12.3 H3: an archived automation run the owner left
 *  open still counts as present); "the newest" = the newest NON-archived row of it.
 *    · the target is listed → open it with its record's HOME, KEEPING the stored responder only when
 *      the target IS the stored thread (the same conversation = the device never left, R45; a tap on
 *      another conversation opens it with none, N1) — UNJUDGED until the roster lands (M3; the landing's
 *      sweep judges it, and so does the sweep run here when a roster already landed);
 *    · the target is NOT listed — deleted elsewhere while this device was dead (Android process death),
 *      or its history 404s right after the list (deleted in between; a live record only, H3) —
 *      the R29 path, never a silent fallback (§12.3 H7): the "deleted" toast, then the stored HOME's
 *      latest (`openAgentConversation`, which resolves a home off the roster to the configured default,
 *      Q2), and the dead conversation's draft + rail move into what opened (E6) — BEFORE the prune;
 *    · no stored thread → the newest, with no responder;
 *    · nothing at all → the thread-less view — a stored responder survives there only because the stored
 *      `thread` was null (B17 across a reload).
 *  The tuple is rewritten after boot (by whichever install ran).
 *
 *  THE BOOT PRUNE (Phase 27 S8, §12.2 ⑦, §12.3 L6): this list is the one GLOBAL list the client ever
 *  sees, so it is where dead per-conversation drafts and rails are reclaimed — every key that is
 *  neither `""`, nor listed here (archived rows count), nor the OPEN view's is dropped (`pruneSlots`),
 *  after the H7 carry, and only while the boot's own generation still holds: a door the owner used
 *  during the boot (a roster-door mint, a lazy mint from typing) moves it, and then nothing is pruned.
 *  (A tapped `?thread=` target is just the open view here — the prune keeps it either way.)
 *  The cold load's identity install stays
 *  as it was (S6's Qwen F1, settled): it bumps no generation — the thread half of `viewMoved` already
 *  refuses a thread-less send's frames once this install moves `threadId`. */
export async function initChat(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const gen = loadGen;
  // Don't clobber a session already in flight (e.g. local-only /help notes or a send that beat the
  // first Agent-tab mount) — only hydrate history into an empty log.
  if (state.messages.length || state.threadId) return;
  const stored = readPersistedChat();
  const navAtEntry = openSeq; // a door the owner uses DURING the boot read outranks its R29 fallback
  // A notification tap's `?thread=` (S10 — validated + stripped by `store/ui`'s boot): kept across this
  // boot's retries until it is resolved (S10 fix ②, `takeBootTap`).
  const tap = takeBootTap();
  try {
    const threads = (await (await fetch("/api/threads?include_archived=true")).json()) as Thread[];
    if (gen !== loadGen) {
      bootTap = null; // a door that won the race spends the tap too — the owner's newer intent
      return; // an explicit open won the race — leave it alone
    }
    const listedIds = new Set(threads.map((t) => t.id));
    const listed = (id: string): boolean => listedIds.has(id);
    /** The generation the prune is allowed under — the boot's own; the R29 arm's swap re-issues it. */
    let pruneGen = gen;
    // THE TARGET (N1) = the TAPPED conversation when it lists, else the stored one. A tap ON the stored
    // conversation is simply the stored path (the device never left it). A tap on ANOTHER conversation
    // opens it with NO responder; it is never an R29 source — this device never held it: unlisted, or
    // deleted between the list and its history (S10 fix ③), the boot falls back QUIETLY (no toast, no
    // carry) to the stored conversation, else the newest.
    const tapRecord =
      tap !== null && tap !== stored.thread ? threads.find((t) => t.id === tap) : undefined;
    let tapOpened = false;
    let tapFailed = false;
    /** S10 fix ⑧ — the STORED conversation deleted elsewhere while this device was dead, superseded by a
     *  tap: its draft + rail follow into what opens (E6), with NO toast (the tap is the owner's intent). */
    const carryDeadStored =
      tapRecord !== undefined && stored.thread !== null && !listed(stored.thread);
    if (tapRecord) {
      if (carryDeadStored && stored.thread !== null) carryOnLeave(stored.thread);
      try {
        await loadThread(
          tapRecord.id,
          gen,
          tapRecord.agent ?? null,
          tapRecord.archived === true,
          null, // N1 — the device LEFT its stored conversation: no responder
        );
        tapOpened = true;
      } catch (e) {
        if (!(e instanceof HttpRefusal && e.status === 404) || gen !== loadGen) throw e; // ② retried
        tapFailed = true; // ③ — the quiet fallback below
      }
    }
    if (!tapOpened) {
      const target = stored.thread;
      const record = target === null ? undefined : threads.find((t) => t.id === target);
      // The target can also vanish BETWEEN the list and its history read (a delete elsewhere in that
      // window): its history 404s — the same R29 answer as a target that did not list. Not for an
      // archived record (H3 — never an R29 source): its failure keeps the plain retry below. After a
      // failed TAP an unlisted stored conversation is not toasted either (③ — quiet; ⑧ armed its carry).
      let dead = record === undefined && target !== null && !tapFailed;
      if (record) {
        try {
          await loadThread(
            record.id,
            gen,
            record.agent ?? null,
            record.archived === true,
            stored.responder, // the stored conversation — the device never left it (R45)
          );
        } catch (e) {
          if (!(e instanceof HttpRefusal && e.status === 404) || record.archived || gen !== loadGen)
            throw e;
          dead = true;
        }
      }
      if (dead) {
        // R29 at boot (H7) — unless the owner already navigated during the boot read (a roster door's own
        // ticket: theirs is the newer intent, L8's posture). The dead conversation's draft + rail move into
        // what opens (E6) — before the prune below, which would otherwise drop them as unlisted.
        pruneGen = -1;
        // E6 — armed whichever door opens next: this fallback's, a failed one's next door, or the owner's
        // own door already in flight (Opus N2 — it consumes the carry at its swap).
        if (target !== null) carryOnLeave(target);
        if (openSeq === navAtEntry && target !== null) {
          pushToast("this conversation was deleted");
          if (await openAgentConversation(record?.agent ?? stored.home ?? rosterDefault())) {
            pruneGen = loadGen; // this boot's own swap — a door used after it moves the generation on
            await slotsCarried();
          }
        }
      } else if (!record) {
        const newest = threads.find((t) => !t.archived);
        if (newest) await loadThread(newest.id, gen, newest.agent ?? null, false, null);
        // the thread-less view keeps its own responder — only a stored thread-less one (B17)
        else if (gen === loadGen && target === null) commitResponder(stored.responder);
      }
    }
    if (carryDeadStored) await slotsCarried(); // ⑧ — the carry lands before the prune reads the slots
    if (pruneGen === loadGen) {
      const open = state.threadId ?? "";
      pruneSlots((k) => k === "" || k === open || listed(k));
    }
    bootTap = null; // resolved — opened, or proven unopenable (③)
    sweepRoster(); // a roster that landed BEFORE this boot judges what it installed (M3)
  } catch {
    // Backend was down at load time. Reset `loaded` so the next initChat (or the F16
    // reconnect-triggered reloadChat) can retry — otherwise the chat would be stuck empty
    // until a full page refresh. NOT if a thread was opened while we were failing: that reset would
    // let the next mount reload over a deliberate open. The tap stays for the retry (②).
    if (gen === loadGen) loaded = false;
    else bootTap = null;
  }
}

/** Reconcile the chat after the SSE feed reconnects (hooks/useEvents.ts, F16). Re-fetches the
 *  current thread's messages so anything that arrived during the drop reappears; falls back to
 *  `initChat()` when there's no thread yet (cold start during a disconnect). Skips entirely while
 *  a turn is streaming so we don't yank messages out from under an in-flight reply.
 *
 *  `force` bypasses the streaming skip (D39): the ONLY caller passing it is the re-attach `turn.sync`
 *  overlay, which deliberately reloads the durable per-step messages (the floor) and then overlays
 *  the still-in-flight message on top — so it must run even though it has just set status "streaming".
 *  `stopTurn`'s stream-already-gone fallback also forces a settle-from-durable reconcile. */
export async function reloadChat(force = false): Promise<void> {
  if (!force && state.status === "streaming") return;
  const gen = loadGen;
  const threadId = state.threadId;
  try {
    if (threadId) {
      const msgs = await fetchMessages(threadId);
      // Discard if the view moved on mid-fetch: without this, an in-flight reconcile writes the OLD
      // thread's messages under the NEW `threadId` — a chat log belonging to a different conversation.
      if (gen !== loadGen || state.threadId !== threadId) return;
      set({ messages: msgs });
    } else {
      loaded = false;
      await initChat();
    }
  } catch (e) {
    // R29 — the open conversation's history answered 404: deleted elsewhere (only while the view is
    // still on it; `conversationDeleted` re-checks, and latches in a call). Anything else: still
    // unreachable — the next reconnect signal will try again.
    if (threadId && gen === loadGen && e instanceof HttpRefusal && e.status === 404)
      conversationDeleted(threadId);
  }
}

/** D81 — install a DURABLE FLOOR (the list every history route returns: the thread's messages, the tail
 *  reply's host carrying `reply`) as the view's log, keeping what only this view holds.
 *
 *  ONE installer for the four places a floor lands after the owner acted: the end of every turn this view
 *  started or attached to (`reloadFloor`), and the three sync routes (swap a variant, edit, delete — each
 *  answers `{messages}` with the same floor). A floor can never carry a CLIENT-ONLY row (`local`), so the
 *  ones it must not cost the owner are KEPT, each re-seated right after the durable row it followed (the
 *  head of the log if none):
 *    · the view's notes (`/help`, the step-limit line, a failover breadcrumb);
 *    · the owner's bubbles the server does not hold yet — a queued steer, a steer whose POST is still in
 *      flight, a send the server refused. NOT a `landed` bubble whose durable row the floor holds (its
 *      POST was accepted — keeping it would show the message twice); one the floor does NOT hold was
 *      accepted but never saved, and is kept as unsent (wave 2);
 *    · a client-side ERROR bubble (an error the server never persisted — the F20 retry hangs off it), but
 *      only while it is the log's LAST row (notes aside), and only until the floor shows the agent
 *      answered past the point it stood at (its durable host appeared). It is then re-seated at the very
 *      end, so it stays the last row; an older one is simply gone — errors never stack.
 *  What is dropped is every other assistant STAND-IN (the "…" placeholder, a re-attach's `sync-` call
 *  bubble): each one only ever stood in for a server row, which the floor now carries.
 *
 *  A durable row the floor no longer has (deleted, or a variant swapped out) is forgotten by the audio
 *  controller: a clip docked for it is dismissed, its blob revoked (`forgetMessage`).
 *
 *  `reloadChat` (the reconnect reconcile) deliberately stays a plain replace — its documented contract is
 *  that client-only rows are gone on reload, and the re-attach overlay relies on that wipe to de-dupe. */
export function applyFloor(floor: ChatMessage[]): void {
  const msgs = state.messages;
  const onFloor = new Set(floor.map((m) => m.id));
  let last = msgs.length - 1; // the last non-note row — the only place an error bubble may stand
  while (last >= 0 && msgs[last].role === "system") last--;
  const kept = new Map<string | null, ChatMessage[]>(); // anchor id (null = the head) → rows after it
  const keep = (at: string | null, m: ChatMessage) => {
    const after = kept.get(at);
    if (after) after.push(m);
    else kept.set(at, [m]);
  };
  let anchor: string | null = null;
  let erred: { m: ChatMessage; anchor: string | null } | null = null;
  // Wave 2 · N2 — `landed` means ACCEPTED, not persisted: a 200 turn can fail before it saves the user
  // row. So a landed bubble is dropped only against a durable OWNER row the floor holds after its anchor
  // (each such row answers one bubble); with none left it is kept and becomes UNSENT again (its `landed`
  // cleared), so the F20 retry hands its words back instead of rewriting the reply before it.
  // Matched by KIND: a plain message only against a durable user row; an EXEC bubble (a drained `!cmd`
  // steer, rendered with its `!` sigil — `makeQueuedBubble`) only against the call row of an owner
  // `!exec` pair, its durable form (Maya's wave-2 addendum). A message never matches an exec row.
  type Kind = "message" | "exec";
  const bubbleKind = (m: ChatMessage): Kind =>
    textOf(m.parts).startsWith("!") ? "exec" : "message";
  const rowKind = (f: ChatMessage): Kind | null =>
    f.role === "user" ? "message" : f.role === "assistant" && f.actor === "user" ? "exec" : null;
  const claimed = new Map<string, number>(); // `${kind}|${anchor}` → floor owner rows already matched
  const ownerRowsAfter = (at: string | null, kind: Kind) => {
    const from = at === null ? 0 : floor.findIndex((f) => f.id === at) + 1;
    return floor.slice(from).filter((f) => rowKind(f) === kind).length;
  };
  msgs.forEach((m, i) => {
    if (m.local) {
      if (m.parts.some((p) => p.type === "error")) {
        if (i === last) erred = { m, anchor };
      } else if (m.landed) {
        const kind = bubbleKind(m);
        const key = `${kind}|${anchor}`;
        const used = claimed.get(key) ?? 0;
        if (used < ownerRowsAfter(anchor, kind)) claimed.set(key, used + 1);
        else keep(anchor, { ...m, landed: undefined });
      } else if (m.role !== "assistant") keep(anchor, m);
    } else if (onFloor.has(m.id)) anchor = m.id;
    else forgetMessage(m.id);
  });
  if (erred !== null) {
    const { m, anchor: at } = erred as { m: ChatMessage; anchor: string | null };
    const from = at === null ? 0 : floor.findIndex((f) => f.id === at) + 1;
    const answered = floor
      .slice(from)
      .some((f) => (f.role === "assistant" || f.role === "tool") && f.actor !== "user");
    if (!answered) keep(floor.length ? floor[floor.length - 1].id : null, m);
  }
  const next = [...(kept.get(null) ?? [])];
  for (const m of floor) {
    next.push(m);
    const after = kept.get(m.id);
    if (after) next.push(...after);
  }
  set({ messages: next });
}

/** D81 — re-read the open thread's durable floor and install it (`applyFloor`). Run at the END of every
 *  turn this view started or attached to (the buffered path's and the attachment send's old reload, made
 *  universal): the wire has no user-message frame, so this is what replaces the just-sent bubble with its
 *  durable row (so it can be edited or deleted), and what delivers the tail's fresh `reply` annotation
 *  (so the retry and the `‹ n/N ›` controls describe the take just produced). One GET per turn.
 *
 *  Never while a turn streams (a floor would yank the live bubble), and discarded if the view moved on
 *  mid-fetch — the `reloadChat` guards. Best-effort: an unreachable backend leaves the view as it is;
 *  a 404 is the conversation deleted elsewhere (R29). An installed floor is seen trigger (b). */
async function reloadFloor(): Promise<void> {
  const threadId = state.threadId;
  if (!threadId || getChatStatus() === "streaming") return;
  const gen = loadGen;
  try {
    const floor = await fetchMessages(threadId);
    if (gen !== loadGen || state.threadId !== threadId || getChatStatus() === "streaming") return;
    applyFloor(floor);
  } catch (e) {
    // R29 — a 404 on the open conversation's history: deleted elsewhere. Otherwise unreachable — the
    // next turn / reconnect reconciles.
    if (gen === loadGen && e instanceof HttpRefusal && e.status === 404)
      conversationDeleted(threadId);
    return;
  }
  // (b) — a turn settled (or a sync route's floor landed) in the OPEN view: the owner is looking at it.
  void markSeen();
}

/** Append a client-only message (system note or shell echo) — not persisted; gone on reload. Used
 *  by the composer router for `/help`, mode-switch notes, and unknown-verb replies (lib/composer), and
 *  by `runShell` for its non-fatal outcomes (shell disabled / thread busy / backend unreachable).
 *  NOTE: a real `!<cmd>` result is NOT a local note — it persists server-side; see `runShell`. */
function pushLocal(role: "system" | "user", text: string): void {
  set({
    messages: [
      ...state.messages,
      {
        id: `${role[0]}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        thread_id: state.threadId ?? "",
        role,
        parts: [{ type: "text", text }],
        actor: role === "user" ? "user" : "system",
        ts: new Date().toISOString(),
        tokens: null,
        compacted: false,
        fresh: true,
        local: true,
      },
    ],
  });
}
export function pushSystemNote(text: string): void {
  pushLocal("system", text);
}
export function pushUserEcho(text: string): void {
  pushLocal("user", text);
}

/** Has anyone TAKEN A TURN in this view — `/new`'s no-op question (ISS-31)? A turn is a message the
 *  owner authored: `role: "user"` (a typed, steered or dictated message — an automation's injected
 *  prompt is one too, and a thread carrying one is not fresh either) OR `actor: "user"`, because the
 *  `!cmd` exec pair persists as assistant + tool rows stamped with the owner as actor
 *  (`services/agent/exec.py`), and a thread holding a command the owner ran is not a fresh one. What
 *  is left is the agent's own opening (the seeded greeting, `actor: "agent"`) and client-only notes
 *  (`role: "system"`) — neither makes a thread worth leaving for another fresh one. (The server's twin,
 *  `is_owner_turn`, left with the ISS-49 re-seat route, D84 R27.) */
function isUserTurn(m: ChatMessage): boolean {
  return m.role === "user" || m.actor === "user";
}
function hasUserTurn(messages: readonly ChatMessage[]): boolean {
  return messages.some(isUserTurn);
}
/** The open ticket (`openSeq`) the in-flight mint claimed, or `null` when no mint is in flight. */
let mintTicket: number | null = null;

/** How one mint ended (`mintWith`): the minted conversation is OPEN, a newer navigation SUPERSEDED it
 *  or a call started meanwhile REFUSED it (either way the mint stays behind in the list, unopened), or it
 *  FAILED (network, a non-OK answer, a malformed body, a failed history read) with the view untouched —
 *  each caller decides what a failure means. */
type MintOutcome = "opened" | "superseded" | "refused" | "failed";

/** MINT a conversation for `agent` through D70 §4.2 **seam ①** (`POST /api/threads {agent}` — the server
 *  pins the RESOLVED agent, ISS-51's rungs, so a since-deleted name never mints a phantom, §12.4 Q2) and
 *  open it under `ticket`. The minted thread's `agent` is the HOME it installs; a greeting (when the agent
 *  has one, §12.1 ⑩) is ordinary history, read back like any open.
 *
 *  **Fetch first, swap second** (the `openThread` pattern): the mint AND the minted thread's history are
 *  in hand before the view is touched, so the owner never stares at an emptied chat while the request is
 *  in flight. **THE FENCE (O7) is the supersession check ALONE** — a newer navigation wins and this mint
 *  stays behind in the list; the old silent give-ups on a changed turn count / a moved view are gone: a
 *  mint while another view streams, or after a send, still swaps (S6 — the left turn runs on in the
 *  background, R9). The swap leaves the conversation the view was in, so the responder clears (R45). */
async function mintWith(agent: string, ticket: number): Promise<MintOutcome> {
  mintTicket = ticket;
  let opened: { thread: Thread; messages: ChatMessage[] } | null = null;
  try {
    const res = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent }),
    });
    if (!res.ok) throw new Error(`/api/threads → ${res.status}`);
    const thread = (await res.json()) as Thread;
    if (!nonEmpty(thread.id)) throw new Error("/api/threads → no thread id");
    opened = { thread, messages: await fetchMessages(thread.id) };
  } catch {
    /* `opened` stays null → "failed" */
  } finally {
    if (mintTicket === ticket) mintTicket = null;
  }
  if (ticket !== openSeq) return "superseded";
  // R20 at the COMMIT point (S7A-03): a call started while the mint was in flight.
  if (refusedInCall(HANG_UP_SWITCH_CONVERSATION)) return "refused";
  if (opened === null) return "failed";
  swapView({
    threadId: opened.thread.id,
    messages: opened.messages,
    threadAgent: opened.thread.agent ?? agent,
    archived: false, // seam ① mints a live conversation (H3)
  });
  loaded = true; // a later `initChat` must not replace this with the most-recent thread
  // No re-attach probe (`openThread` runs one): a thread minted this instant has no turn to rejoin.
  return "opened";
}

/** Mint a fresh conversation for `agent` and open it (D84 §6 "Shared mint + navigation") — `/new`'s
 *  body, and what a roster door does for an agent with no conversation yet. Always names an agent.
 *  Refused in a live call (R20). A FAILED mint falls back to the thread-less view — the lazy mint on the
 *  next send — and says so in the log. Resolves whether the minted conversation opened. */
export async function mintAndOpen(agent: string): Promise<boolean> {
  if (refusedInCall(HANG_UP_SWITCH_CONVERSATION)) return false;
  const outcome = await mintWith(agent, ++openSeq);
  if (outcome === "failed") {
    resetToThreadless();
    pushSystemNote("// couldn't start a new conversation — your next message will start one");
  }
  return outcome === "opened";
}

/** `/new` (R22b) — a fresh conversation for the open view's HOME agent (`threadAgent ?? the configured
 *  default`), never for the responder: THE INVARIANT (R22) — nothing inside a conversation writes another
 *  agent's conversations. Leaving, so the responder clears. Refuses, in order:
 *    · in a live call (R20) — `// hang up to switch conversations`;
 *    · while a mint is still in flight AND still the newest intent — it will deliver the fresh
 *      conversation; a second POST (the double Enter) would only mint a twin into the list;
 *    · the ISS-31 NO-OP: the open conversation has no owner turn (`hasUserTurn` — a greeting-only or
 *      empty conversation IS new) → `// this conversation is already new`, nothing minted, and the
 *      responder STAYS (the owner did not leave). A thread-less view mints (there is nothing to keep). */
export async function newConversation(): Promise<void> {
  if (refusedInCall(HANG_UP_SWITCH_CONVERSATION)) return;
  if (mintTicket === openSeq) return; // the in-flight mint is still the owner's newest intent
  if (state.threadId !== null && !hasUserTurn(state.messages)) {
    pushSystemNote("// this conversation is already new");
    return;
  }
  await mintAndOpen(state.threadAgent ?? rosterDefault());
}

/** THE ROSTER DOOR (D84 §2 R16, R38, O4) — the tools menu's agent rows (every activation) and the
 *  gallery's Talk: open `name`'s LATEST conversation, or mint it a greeted one when it has none.
 *    · claims its open ticket AT ENTRY, before the read, and abandons if a later navigation superseded it
 *      after any await (§12.3 L8 — a slow roster tap never overrides a later sheet-row tap);
 *    · a name OFF the LANDED roster (a stored home whose agent was deleted while the device was dead, a
 *      stale door) resolves to the configured default BEFORE the read — never a mint for a dead slug
 *      (§12.4 Q2); before the roster lands it passes unjudged (seam ① pins the RESOLVED agent anyway);
 *    · `GET /api/threads?agent=<name>&limit=1` (S2a's route, newest first) → the OPEN view's own id = B5
 *      IN PLACE: nothing reloads, the responder clears ("back to the rule" — the roster is the door from
 *      elsewhere even when it lands where you are, F1), the home is installed; another id →
 *      `openThread(id, name)` (leaving: the responder clears); none → mint for `name` (seam ①);
 *    · a failed read, or a failed mint → the "unreachable" note, the view untouched.
 *  Refused in a live call (R20). Resolves whether `name`'s conversation is the view now. */
export async function openAgentConversation(name: string): Promise<boolean> {
  if (refusedInCall(HANG_UP_SWITCH_CONVERSATION)) return false;
  const ticket = ++openSeq;
  const home = offRoster(name) ? rosterDefault() : name;
  let latest: string | null;
  try {
    const res = await fetch(`/api/threads?agent=${encodeURIComponent(home)}&limit=1`);
    if (!res.ok) throw new Error(`/api/threads?agent → ${res.status}`);
    const rows = (await res.json()) as { id?: unknown }[];
    if (!Array.isArray(rows)) throw new Error("/api/threads?agent → not a list");
    latest = nonEmpty(rows[0]?.id) ?? null;
  } catch {
    if (ticket === openSeq)
      pushSystemNote("// could not open that thread — the backend is unreachable");
    return false;
  }
  if (ticket !== openSeq) return false; // a later navigation won while the read was in flight (L8)
  // R20 at the COMMIT point (S7A-03) — the B5 in-place arm included: a call started during the read.
  if (refusedInCall(HANG_UP_SWITCH_CONVERSATION)) return false;
  if (latest !== null && latest === state.threadId) {
    // B5 — the open conversation IS that agent's latest: no reload; back to the rule. Not a leave: a
    // latched sheet Delete of it keeps reading its own commit as the newest intent (S9b micro-wave ⑩).
    if (removal?.id === state.threadId) removal.seq = openSeq;
    if (state.threadAgent !== home) installHome(home);
    if (state.archived === null) set({ archived: false }); // a `?agent=` latest is never archived
    if (state.responder !== null) commitResponder(null);
    return true;
  }
  if (latest !== null) return openThread(latest, home);
  const outcome = await mintWith(home, ticket);
  if (outcome === "failed")
    pushSystemNote("// could not open that thread — the backend is unreachable");
  return outcome === "opened";
}

function emptyAssistant(id: string, agent: string | null = null): ChatMessage {
  return {
    id,
    thread_id: state.threadId ?? "",
    role: "assistant",
    parts: [{ type: "text", text: "" }],
    actor: "agent",
    ts: new Date().toISOString(),
    tokens: null,
    compacted: false,
    agent,
    fresh: true,
  };
}

/** The OPTIMISTIC assistant stand-in a turn shows before its first `message.start` (the "…" bubble) —
 *  `emptyAssistant` marked client-only (D81 `local`), so no message action renders on it. The first
 *  `message.start` adopts it under the server's id and clears the mark. */
function placeholder(id: string, agent: string | null = null): ChatMessage {
  return { ...emptyAssistant(id, agent), local: true };
}

/** Append a text/reasoning delta onto the named message's matching part (creating it if absent). */
function appendDelta(id: string, kind: "text" | "reasoning", delta: string) {
  set({
    messages: state.messages.map((m) => {
      if (m.id !== id) return m;
      const parts = m.parts.slice();
      const idx = parts.findIndex((p) => p.type === kind);
      if (idx >= 0) {
        const cur = parts[idx] as { type: string; text: string };
        parts[idx] = { ...cur, text: cur.text + delta } as Part;
      } else if (kind === "reasoning") {
        parts.unshift({ type: "reasoning", text: delta });
      } else {
        parts.push({ type: "text", text: delta });
      }
      return { ...m, parts };
    }),
  });
}

/** Append a streamed part (a tool_call) to the named message. */
function addPart(id: string, part: Part) {
  set({
    messages: state.messages.map((m) => (m.id === id ? { ...m, parts: [...m.parts, part] } : m)),
  });
}

/** Attach the D62 serve attribution to the named message (`message.end`). Skipped entirely when the
 *  frame carried neither fact, so the message identity is preserved and the memoized bubble doesn't
 *  re-render for nothing — and so a pre-D62 backend leaves the bubble exactly as it is today. */
function setAttribution(id: string, source: MessageSource | null, usage: CallUsage | null) {
  if (!source && !usage) return;
  set({
    messages: state.messages.map((m) =>
      m.id === id ? { ...m, ...(source ? { source } : {}), ...(usage ? { usage } : {}) } : m,
    ),
  });
}

/** Flip the lifecycle state of the tool_call with this callId (wherever it lives). */
function setCallState(callId: string, runState: RunState) {
  set({
    messages: state.messages.map((m) => ({
      ...m,
      parts: m.parts.map((p) =>
        p.type === "tool_call" && p.call_id === callId ? { ...p, state: runState } : p,
      ),
    })),
  });
}

/** Resolve a call: flip its tool_call state and attach the result part beside it. */
function addToolResult(callId: string, result: ToolResult) {
  delete confirmTokens[callId];
  delete modeByCall[callId];
  delete skillsByCall[callId];
  delete alwaysEligibleByCall[callId];
  set({
    messages: state.messages.map((m) => {
      if (!m.parts.some((p) => p.type === "tool_call" && p.call_id === callId)) return m;
      const parts = m.parts.map((p) =>
        p.type === "tool_call" && p.call_id === callId ? { ...p, state: result.state } : p,
      );
      parts.push({ type: "tool_result", call_id: callId, result });
      return { ...m, parts };
    }),
  });
}

/** Put an error into the streaming message (or a fresh bubble if none is in flight). Preserves the
 *  turn's existing parts (any tool_calls it ran, partial text) and *appends* the error — both for
 *  transparency (you see what happened before it failed) and so the risk-aware retry (I4) can tell
 *  whether the failed turn ran a non-retry-safe tool. */
function failStream(message: string) {
  const id = state.streamingId;
  // Idempotent on a second terminal signal: once the turn has failed + settled (status "error", no
  // live stream), a follow-up failure (e.g. an `error` frame, then the socket resetting mid-close)
  // must not spawn a second standalone error bubble — the first failStream already recorded it.
  if (!id && state.status === "error") return;
  const errPart: Part = { type: "error", message, retryable: true };
  if (id && state.messages.some((m) => m.id === id)) {
    set({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, parts: [...m.parts, errPart] } : m,
      ),
      status: "error",
      streamingId: null,
    });
  } else {
    const m = placeholder(`err-${Date.now()}`); // a client-side error: no server row stands behind it
    m.parts = [errPart];
    set({ messages: [...state.messages, m], status: "error", streamingId: null });
  }
}

// ── SSE wire validators (J2 / robustness) ─────────────────────────────────────────────────────
// The frame is trusted only HERE: every event's `data` is checked against the wire shapes (types.ts)
// before it mutates state, so a malformed-but-valid-JSON frame (a backend serialization edge, or a
// proxy/gateway mangling/concatenating chunks — the documented SSE failure mode) can't push a garbage
// Part/ToolResult that white-screens the renderer. Behaviour matches how streaming-agent clients
// (Vercel AI SDK, OpenAI/Anthropic SDKs) handle this: **drop the bad frame and keep the stream** —
// never crash, never fail the turn. Validators are passthrough-tolerant (unknown/extra fields ignored
// → forward-compatible) and return a normalized value or `null`. Hand-written (no dep): the delta
// events fire per-token, so a schema lib's per-call + bundle cost isn't worth it here.
const RUN_STATES: readonly RunState[] = [
  "pending",
  "awaiting_confirm",
  "awaiting_answer",
  "running",
  "ok",
  "error",
  "denied",
  "skipped",
  "timeout",
  "cancelled",
];

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const nonEmpty = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
// A finite non-negative wire integer (token counts, durations, windows — D62). `undefined` for
// anything else, so an absent/garbage number omits its segment instead of rendering NaN.
const int = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
const isRunState = (v: unknown): v is RunState =>
  typeof v === "string" && (RUN_STATES as readonly string[]).includes(v);
// A plain object (NOT an array — `typeof [] === "object"`), narrowing the wire value so the fields
// below need no cast and an array can't masquerade as a `data`/`args` record.
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
// The skill ids a suspend payload pins for its call (M2/C-12). `undefined` when the field is absent
// or malformed — the caller must distinguish "the server pinned nothing" from "no pin at all", since
// an empty pin is itself authoritative (that turn ran with no skill active).
const skillIds = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((s) => typeof s === "string") ? v : undefined;

/** Coerce a wire object into a renderer-safe `ToolResult` (requires a valid `state`; defaults the
 *  rest so downstream reads like `result.data.plan` never hit `undefined`). `null` if unusable. */
function asToolResult(v: unknown): ToolResult | null {
  if (!isObj(v)) return null;
  if (!isRunState(v.state)) return null;
  return {
    state: v.state,
    summary: str(v.summary) ?? "",
    data: isObj(v.data) ? v.data : {},
    output: typeof v.output === "string" ? v.output : null,
    error: typeof v.error === "string" ? v.error : null,
    artifacts: Array.isArray(v.artifacts) ? v.artifacts : [],
    duration_ms: typeof v.duration_ms === "number" ? v.duration_ms : null,
  };
}

/** Validate a wire object into a `Part` (per-variant required fields). `null` if the shape is unusable
 *  — the caller drops the frame rather than pushing a garbage part the message renderer would crash on. */
function asPart(v: unknown): Part | null {
  if (!isObj(v)) return null;
  const o = v;
  if (o.type === "text" || o.type === "reasoning") {
    const text = str(o.text);
    if (text === undefined) return null;
    return o.type === "text" ? { type: "text", text } : { type: "reasoning", text };
  }
  if (o.type === "tool_call") {
    const call_id = nonEmpty(o.call_id);
    const tool = str(o.tool);
    if (!call_id || tool === undefined || !isRunState(o.state)) return null;
    const args = isObj(o.args) ? o.args : {};
    return { type: "tool_call", call_id, tool, args, state: o.state };
  }
  if (o.type === "tool_result") {
    const call_id = nonEmpty(o.call_id);
    const result = asToolResult(o.result);
    if (!call_id || !result) return null;
    return { type: "tool_result", call_id, result };
  }
  if (o.type === "error") {
    const message = str(o.message);
    if (message === undefined) return null;
    return { type: "error", message, retryable: o.retryable === true };
  }
  return null;
}

/** Validate the D62 `message.end` routing record. `served` is the one required fact (the chip's whole
 *  content); the rest are optional and dropped individually when malformed, so a partial payload
 *  degrades to fewer segments rather than to no attribution. `null` if unusable / absent. */
function asSource(v: unknown): MessageSource | null {
  if (!isObj(v)) return null;
  const served = nonEmpty(v.served);
  if (!served) return null;
  const from = nonEmpty(v.from);
  const hops = int(v.failed_hops);
  const win = int(v.context_window);
  return {
    served,
    degraded: v.degraded === true,
    ...(from ? { from } : {}),
    ...(hops !== undefined ? { failed_hops: hops } : {}),
    ...(win !== undefined ? { context_window: win } : {}),
  };
}

/** Validate the `message.end` usage object (C-9 + D62). Every field is independently optional — the
 *  endpoint reports what it reports — so a garbage field drops itself, never the whole object.
 *  `null` when nothing usable survived (the disclosure then has no metrics to show). */
function asUsage(v: unknown): CallUsage | null {
  if (!isObj(v)) return null;
  const usage: CallUsage = {
    model: nonEmpty(v.model) ?? null,
    input_tokens: int(v.input_tokens) ?? null,
    output_tokens: int(v.output_tokens) ?? null,
    cached_tokens: int(v.cached_tokens) ?? null,
    duration_ms: int(v.duration_ms) ?? null,
  };
  return Object.values(usage).some((x) => x !== null) ? usage : null;
}

/** A dropped/unknown frame is a bug or transport glitch, not a user-facing event — warn in dev only. */
function dropWarn(event: string, why: string): void {
  if (import.meta.env.DEV) console.warn(`[chat] dropped SSE "${event}": ${why}`);
}

// The canonical "turn already running" text (D38) — the fallback when a 409 body isn't the expected
// `{detail}` shape. Kept in sync with the backend's `_TURN_BUSY_DETAIL`.
const TURN_BUSY_FALLBACK = "a turn is already running on this thread — wait for it to finish";

/** Read the actionable detail off a 409 "turn busy" response (D38). A thread-mutating endpoint that
 *  409s returns `{"detail": "<why>"}`; surface that verbatim, falling back to the canonical text if
 *  the body isn't JSON / lacks a string detail. Used by every non-SSE endpoint + the stream open. The
 *  D81 message routes refuse with other statuses too (422/404/403) and pass their own `fallback`. */
async function busyDetail(res: Response, fallback = TURN_BUSY_FALLBACK): Promise<string> {
  try {
    const j = (await res.json()) as { detail?: unknown };
    if (typeof j.detail === "string" && j.detail) return j.detail;
  } catch {
    /* non-JSON body → canonical fallback */
  }
  return fallback;
}

/** A DEFINITE non-OK answer to a turn POST (D81 fix wave 1) — the server answered and no turn started,
 *  which the catch must tell apart from a dropped stream (that one re-attaches). The message keeps the
 *  `<url> → <status>` shape `isLikelyUnreachable` reads; `detail` is the server's `{detail}` sentence,
 *  or "" when it sent none. `fetchMessages` throws it too (a history read's definite answer — the 404
 *  `openThread` reads as "deleted", Phase 27 M6). */
class HttpRefusal extends Error {
  readonly status: number;
  readonly detail: string;
  constructor(url: string, status: number, detail: string) {
    super(`${url} → ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

/** Parse an SSE byte stream, invoking `onFrame(event, data, id)` per frame until the stream closes
 *  (D39). ONE frame parser, shared by the live turn stream (`streamTurn`) and the re-attach stream
 *  (`reattachTurn`) — so the `event:`/`data:`/`id:` handling never forks. sse-starlette frames end in
 *  a blank line with CRLF (`\r\n\r\n`); bare `\n` is tolerated too (the bug that hid live replies in
 *  4a). `id:` is the D39 reconnect cursor (`turn_id:seq`). `onFrame` may be async (the re-attach
 *  `turn.sync` overlay awaits a reload); it is awaited so frames apply in order. */
async function parseSSE(
  body: ReadableStream<Uint8Array>,
  onFrame: (
    event: string,
    data: Record<string, unknown>,
    id: string | undefined,
  ) => void | Promise<void>,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const FRAME = /\r?\n\r?\n/;
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let m: RegExpExecArray | null;
    while ((m = FRAME.exec(buf))) {
      const frame = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      let ev = "message";
      let id: string | undefined;
      const dataLines: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith("event:")) ev = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        else if (line.startsWith("id:")) id = line.slice(3).trim();
      }
      if (!dataLines.length) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
      } catch {
        continue; // keepalive/ping or non-JSON frame — ignore
      }
      await onFrame(ev, parsed, id);
    }
  }
}

/** The mutable per-turn reducer context. `claimed` tracks whether the empty assistant placeholder has
 *  been adopted (chat send only); `settled` records that a terminal `done`/`error` was reduced. Held
 *  in an object so the shared reducer (`makeTurnReducer`) can mutate it and both `streamTurn` and
 *  `reattachTurn` can read `settled` after the stream drains. */
interface TurnCtx {
  claimed: boolean;
  placeholderId?: string;
  settled: boolean;
  // The stream generation this reducer belongs to (FIX A). `-1` until `claimStream` runs at the
  // live-adopt point; a reducer only ever runs via `parseSSE`, which is always AFTER the claim, so a
  // frame's `ctx.gen` is set by the time it is checked. A stale generation (`ctx.gen !== streamGeneration`)
  // is dropped at the reducer's very top — before the seq gate — so it can never settle state.
  gen: number;
  // The VIEW a turn entered on (Phase 27 O6): its thread id and the view generation (`loadGen`), both
  // captured BEFORE the first `fetch` — the POST's (`streamTurn`) or the re-attach's (`reattachTurn`).
  // See `viewMoved`.
  view?: ViewRef;
}

/** The turn-event reducer, factored out of `streamTurn` so the re-attach stream reduces LIVE events
 *  through the identical branch set (D39). The seq entry gate (S3-D) runs at the very top — one
 *  total-order guard for every branch below. */
function makeTurnReducer(ctx: TurnCtx) {
  return (event: string, data: Record<string, unknown>, frameId?: string): void => {
    if (ctx.gen !== streamGeneration) return; // FIX A — a stale stream: drop wholesale, never touch the gate/state
    if (seqGateDrop(frameId)) return; // D39/S3-D — already applied for this turn; drop before any branch
    switch (event) {
      case "thread": {
        const id = nonEmpty(data.threadId);
        if (!id) return dropWarn(event, "missing threadId");
        adoptWireThread(ctx, id, nonEmpty(data.agent)); // O6 — never into a view the owner moved to
        break;
      }
      case "message.start": {
        const id = nonEmpty(data.messageId);
        if (!id) return dropWarn(event, "missing messageId");
        // Per-turn agent attribution (7e-c): the server stamps which AgentDef is producing this
        // turn so a live specialist turn is labelled immediately, not only after a reload.
        const agent = str(data.agent) ?? null; // optional (server may send null)
        if (!ctx.claimed && ctx.placeholderId) {
          const pid = ctx.placeholderId;
          set({
            messages: state.messages.map((m) =>
              m.id === pid ? { ...m, id, agent, local: undefined } : m,
            ),
            streamingId: id,
          });
          ctx.claimed = true;
        } else {
          set({ messages: [...state.messages, emptyAssistant(id, agent)], streamingId: id });
        }
        break;
      }
      case "reasoning.delta":
      case "text.delta": {
        const id = nonEmpty(data.messageId);
        const delta = str(data.delta);
        if (!id || delta === undefined) return dropWarn(event, "missing messageId/delta");
        appendDelta(id, event === "reasoning.delta" ? "reasoning" : "text", delta);
        break;
      }
      case "part.added": {
        const id = nonEmpty(data.messageId);
        const part = asPart(data.part);
        if (!id || !part) return dropWarn(event, "invalid messageId/part");
        addPart(id, part);
        break;
      }
      case "tool.permission": {
        const callId = nonEmpty(data.callId);
        if (!callId) return dropWarn(event, "missing callId");
        const token = str(data.token);
        if (token) confirmTokens[callId] = token;
        alwaysEligibleByCall[callId] = data.alwaysEligible === true; // D44 W3: gate the affordance
        modeByCall[callId] = turnMode; // pin THIS turn's mode for the eventual resume (ACA-16)
        // …and its active skills (C5-M1). The SERVER's list (M2/C-12) when it sent one: it includes
        // the selector's own picks, which `turnSkills` (the /skill-name invocations we asked for) never
        // had. `turnSkills` stays the fallback for a backend that predates the field.
        skillsByCall[callId] = skillIds(data.skills) ?? turnSkills;
        setCallState(callId, "awaiting_confirm");
        // F1 — announce the block through the shared builder (the same one the buffered reply and the
        // `turn.sync` reconstruction use, so all three collapse onto one key in the engine).
        notifyAwaitingConfirm(
          state.threadId,
          callId,
          str(data.prompt),
          str(data.tool),
          state.threadAgent,
        );
        break;
      }
      case "tool.question": {
        // A2 — the `question` builtin is asking the owner. The prompt is already on the tool_call's
        // args (from part.added); just flip the state so the answer bubble renders its input.
        const callId = nonEmpty(data.callId);
        if (!callId) return dropWarn(event, "missing callId");
        modeByCall[callId] = turnMode; // pin THIS turn's mode for the eventual answer (ACA-16)
        skillsByCall[callId] = skillIds(data.skills) ?? turnSkills; // …and its skills (C5-M1, M2/C-12)
        setCallState(callId, "awaiting_answer");
        // F1 — same class as the confirm bubble: the turn is parked on the owner's reply.
        notifyAwaitingAnswer(state.threadId, callId, str(data.question), state.threadAgent);
        break;
      }
      case "tool.result": {
        const callId = nonEmpty(data.callId);
        const result = asToolResult(data.result);
        if (!callId || !result) return dropWarn(event, "invalid callId/result");
        addToolResult(callId, result);
        break;
      }
      case "compaction":
        // Older turns were folded into a summary to stay within the context window (4e). Full
        // history stays in SQLite; surface a sys breadcrumb so the trim is visible, not silent.
        // Validate-or-drop (like tool.result): a malformed frame (array/null, or a missing count)
        // is dropped rather than emit a misleading "// nothing to compact yet" for a real compaction.
        if (!isObj(data) || typeof data.removed !== "number")
          return dropWarn(event, "invalid compaction");
        pushSystemNote(compactionNote(data.removed, data.truncated === true));
        break;
      case "notice": {
        // A server-side breadcrumb (D18: inference fell over to a fallback endpoint). Client-only,
        // like compaction — a transient FYI; the failure is also logged + persisted server-side.
        const text = str(data.text);
        if (text) pushSystemNote(text);
        break;
      }
      case "inference.retry": {
        // D43/A6 — a transient error triggered a same-endpoint retry that is now backing off before
        // the next attempt. Surface it live in the house voice (byte-for-byte the buffered
        // `collect_turn` parity line). Validate-or-drop like compaction: a malformed frame (missing
        // endpoint/category, non-numeric attempt/max/delay) is dropped, never half-rendered.
        const endpoint = str(data.endpoint);
        const category = str(data.category);
        const { attempt, max, delaySeconds } = data;
        if (
          endpoint === undefined ||
          category === undefined ||
          typeof attempt !== "number" ||
          typeof max !== "number" ||
          typeof delaySeconds !== "number"
        )
          return dropWarn(event, "invalid inference.retry");
        pushSystemNote(
          `// retrying ${endpoint} in ${delaySeconds}s (attempt ${attempt}/${max} — ${category})`,
        );
        break;
      }
      case "inference.failover": {
        // D43/A6 — the failover chain dropped to the next endpoint. Live house-voice breadcrumb
        // (matches the buffered parity line); the superseded post-hoc degraded `notice` is gone.
        const to = str(data.to);
        const category = str(data.category);
        if (to === undefined || category === undefined)
          return dropWarn(event, "invalid inference.failover");
        pushSystemNote(`// failover → ${to} (${category})`);
        break;
      }
      case "steer.applied": {
        // D41 §4 — a queued steer just drained into the running turn (as a durable user message, or an
        // exec pair). Swap the optimistic queued bubble (keyed by entryId) to its sent form.
        const entryId = nonEmpty(data.entryId);
        if (!entryId) return dropWarn(event, "missing entryId");
        const kind = data.kind === "exec" ? "exec" : "message";
        delRaw(state.threadId ?? "", entryId);
        set({
          messages: resolveSteerBubble(
            state.messages,
            entryId,
            nonEmpty(data.messageId),
            kind,
            str(data.text),
          ),
        });
        break;
      }
      case "message.end": {
        // D62 — the serve attribution lands here and nowhere else: `served`/`degraded` are unknown at
        // `message.start`. Same shape the durable reload serves, so a live bubble and a reloaded one
        // render identically; a frame without either key leaves the message untouched.
        const id = nonEmpty(data.messageId);
        if (!id) return dropWarn(event, "missing messageId");
        setAttribution(id, asSource(data.source), asUsage(data.usage));
        break;
      }
      case "error":
        failStream(str(data.message) ?? "agent error");
        ctx.settled = true;
        // F1 — a turn that ENDED, badly. Same class as `done` (the user's attention is wanted back
        // either way) and the same key the `done(error)` that follows it publishes under, so the pair
        // collapses to one buzz carrying THIS frame's real message. `lastTurnId` is the wire `turn_id`
        // the seq gate just latched — per-turn, and identical on a replay of the same frame.
        notifyTurnTerminal(
          state.threadId,
          lastTurnId,
          "error",
          str(data.message) ?? "agent error",
          state.threadAgent,
        );
        break;
      case "done": {
        ctx.settled = true;
        // suspended / capped / completed all return the user to an interactive state. `capped` means
        // the loop hit its step limit mid-task — say so, so a long fan-out never looks silently stuck.
        const st = str(data.state);
        if (st === "capped") {
          pushSystemNote("// reached the step limit — send a message to continue");
        }
        set({ status: st === "error" ? "error" : "idle", streamingId: null });
        // F1 — the turn reached a terminal state (the builder owns the `suspended` exclusion and the
        // error-key sharing; see its docstring).
        notifyTurnTerminal(state.threadId, lastTurnId, st, undefined, state.threadAgent);
        break;
      }
      default:
        // Forward-compatible by construction: an unknown event type is ignored, not an error — so a
        // newer server can add events without breaking this client (matches Vercel AI SDK's
        // `unknown_chunk` handling). Warned in dev so a genuine typo/regression is still visible.
        dropWarn(event, "unknown event type");
        break;
    }
  };
}

/**
 * Open an SSE turn (chat or resume) and reduce its events into the store. `placeholderId`, when
 * given (chat send), is an empty assistant bubble already shown for instant feedback — the first
 * `message.start` adopts it; later steps push fresh assistant messages.
 */
async function streamTurn(
  url: string,
  body: Record<string, unknown>,
  placeholderId?: string,
  pendingUserId?: string,
  raw?: string,
  /** Called the moment the server ACCEPTS this POST — a 202 (steer queued) or any non-409 OK — and
   *  never on a refusal or a failure. The one thing that has to happen at the ACCEPT rather than at
   *  the end of the stream is releasing the staged attachments (D68 §7): the ids are consumed
   *  server-side by then, and the rail must clear WITH the send instead of sitting under a
   *  minute-long turn. A callback rather than a return value for exactly that reason — `streamTurn`
   *  resolves when the STREAM ends, which is far too late. */
  onAccepted?: () => void,
): Promise<SendOutcome> {
  // O6 — the view this send ENTERED on, captured before the `fetch`: a swap may land while the POST is
  // in flight (R9), and from then on this turn belongs to the conversation it was sent from, not to the
  // view on screen. The POST itself is never aborted (the server may already hold the message).
  const ctx: TurnCtx = {
    claimed: !placeholderId,
    placeholderId,
    settled: false,
    gen: -1,
    view: viewHere(),
  };
  const handle = makeTurnReducer(ctx);
  /** M1 — a LEFT send the server refused, or that failed at the transport, writes NOTHING into the view
   *  the owner moved to (no note, no rollback, no error bubble, no status): its words go back to the
   *  composer slot of the conversation it was sent from, silently (Phase 27 S8: the ORIGIN's draft —
   *  `""` for a thread-less send). A resume / regenerate carries no text, so returns nothing.
   *
   *  A LIVE-CALL utterance can no longer reach this arm "after a swap" (S7, R20): no swap is possible
   *  while a call is up — every navigation door and `setResponder` refuse in a call, at entry AND at the
   *  commit point after their awaits (an open/mint/roster read started before `startCall()` and landing
   *  after it was the one window, S7A-03 — closed) — so the call's own refusal handling is the only one
   *  that ever sees its text, which closes S6's recorded double-return. */
  const returnToOrigin = (): void => {
    const text = raw ?? (typeof body.text === "string" ? body.text : "");
    appendDraft(text, "\n", ctx.view?.thread ?? "");
  };
  /** Past the 200: the server holds this send, so a later throw never returns its words (M1 is for a
   *  send the server did NOT take). */
  let taken = false;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
    });
    // 409 = another turn already holds this thread's marker (D38 busy-truth). This is NOT an error —
    // there's nothing to retry — so it must not become a retryable error bubble via `failStream`.
    // Surface the server's actionable detail as a sys-note, drop the unclaimed placeholder, and
    // return to idle. (Slice 5's steer queue upgrades chat-while-busy; 409 stays for plan/apply/
    // compact/second-stream collisions.) Both optimistic bubbles are removed — the unclaimed
    // assistant placeholder AND the user's own message (it was rejected, never persisted; leaving it
    // would render as sent-then-vanished on the next reload).
    if (res.status === 409) {
      const detail = await busyDetail(res);
      // Checked AFTER the body read — the arm's one await, which a hop can land in.
      if (viewMoved(ctx)) {
        returnToOrigin(); // M1 — refused, and the owner has moved on: no view write
        return "refused";
      }
      // Drop BOTH optimistic bubbles — the unclaimed assistant placeholder AND the user's own
      // message (it was rejected, never persisted; leaving it renders as sent-then-vanished).
      const rejected = new Set(
        [placeholderId && !ctx.claimed ? placeholderId : null, pendingUserId].filter(Boolean),
      );
      // D41 — a STEER (no placeholder, has a pending user bubble) that 409s (cap overflow / a sync
      // holder) rolls the steer bubble back WITHOUT settling status: the LIVE turn still owns the view
      // and is streaming on its own socket. A fresh (non-steer) send settles to idle as before (D38).
      const isSteer = !placeholderId && !!pendingUserId;
      set({
        messages: rejected.size
          ? state.messages.filter((m) => !rejected.has(m.id))
          : state.messages,
        ...(isSteer ? {} : { status: "idle", streamingId: null }),
      });
      pushSystemNote("// " + detail);
      return "refused";
    }
    // 202 = the live holder is a chat/resume turn that ACCEPTS a steer (D41): this POST was ENQUEUED,
    // not rejected. Mark the optimistic user bubble QUEUED (keyed by the server's entry_id) and stash
    // its RAW line for a Stop harvest; the live turn keeps the view, so do NOT touch status/streamingId.
    // A `steer.applied` (drain) later swaps it to a normal bubble; Stop harvests it back to the composer.
    if (res.status === 202) {
      onAccepted?.(); // ENQUEUED with its attachment ids — the drain claims them (D41 / §3's steer arm)
      const info = (await res.json().catch(() => ({}))) as { entry_id?: string; turn_id?: string };
      if (viewMoved(ctx)) {
        // A LEFT steer (M1): nothing in this view is its to mark, strip or settle. A queued one keeps its
        // raw line under the thread it was queued on (O22) — the drain, a Stop harvest there, or the
        // re-entry reconcile retires it; an untrackable one is a refusal, its words go home.
        if (!info.entry_id) {
          returnToOrigin();
          return "refused";
        }
        const origin = ctx.view?.thread;
        if (origin)
          setRaw(origin, info.entry_id, raw ?? (typeof body.text === "string" ? body.text : ""));
        return "accepted";
      }
      // NORMALIZE-ON-202 (D71 §4.5, the recorded pre-existing defect — wider than the call). A send
      // taken while chat status is `idle` builds the FRESH-turn shape: an optimistic assistant
      // placeholder plus `status: "streaming"`. A suspended turn (a confirm gate) leaves the status idle
      // while still HOLDING the thread, so the server answers that optimistic send with a 202 — and the
      // placeholder then waits for a `message.start` no stream will ever deliver, with the composer
      // wedged on Stop. The queued-steer bubble below is the whole truth of what happened, so the
      // fresh-turn shape is undone here: placeholder removed, status settled, bubble left to be marked.
      // TYPED text during `awaiting_confirm` hits this exact path, which is why the fix lives at the
      // shared seam and not in the call's send door.
      if (placeholderId !== undefined && !ctx.claimed) {
        const stranded = placeholderId;
        set({
          messages: state.messages.filter((m) => m.id !== stranded),
          status: "idle",
          streamingId: null,
        });
      }
      if (info.entry_id && pendingUserId) {
        const entryId = info.entry_id;
        setRaw(
          state.threadId ?? "",
          entryId,
          raw ?? (typeof body.text === "string" ? body.text : ""),
        );
        set({
          messages: state.messages.map((m) =>
            m.id === pendingUserId ? { ...m, queued: entryId } : m,
          ),
        });
        // FIX B — a LATE 202: while this POST round-tripped the live turn that accepted the steer may
        // have ENDED and spawned a drain-B turn for it (invisible until probed). If no stream is live
        // anymore — OR the turn we are watching (`lastTurnId`) is a DIFFERENT one than the holder that
        // took the steer — the settled-turn discovery already ran (before this bubble was marked queued),
        // so run it NOW against the freshly-marked bubble. When still streaming with `lastTurnId` unset
        // we ARE on the accepting turn (just no id recorded yet): its own stream delivers the drain.
        if (
          getChatStatus() !== "streaming" ||
          (lastTurnId !== null && info.turn_id !== undefined && info.turn_id !== lastTurnId)
        )
          discoverSpawnedSteerTurn();
      } else if (pendingUserId) {
        // Defensive (audit LOW): a 202 with NO entry_id can't be tracked (no queued marker → no
        // Stop-harvest, no drain reconcile). Rather than strand a permanent unmarked bubble, drop the
        // optimistic user bubble and surface a sys-note so the owner knows to resend.
        set({ messages: state.messages.filter((m) => m.id !== pendingUserId) });
        pushSystemNote("// steer not queued — try again");
      }
      // An UNTRACKABLE 202 (no `entry_id`) is a refusal in outcome terms however the server meant it:
      // nothing queued that a drain can deliver, and the bubble was just dropped — so a call-origin
      // utterance harvests to the draft instead of vanishing (F8).
      return info.entry_id ? "accepted" : "refused";
    }
    // A non-OK answer is a DEFINITE refusal (D81 fix wave 1): the server answered, no turn started — so it
    // must never reach the catch's re-attach ladder, which would attach to the PREVIOUS turn's cursor.
    if (!res.ok) throw new HttpRefusal(url, res.status, await busyDetail(res, ""));
    if (!res.body) throw new Error(`${url} → ${res.status}`);
    // Past the 409 and past `!res.ok`: the turn is RUNNING (or already ran, buffered), so whatever
    // this POST named is the server's now. Everything below is about rendering it.
    onAccepted?.();
    taken = true;
    // D81 fix wave 1 — the optimistic user bubble LANDED: its durable row exists, so every floor from
    // here supersedes it (even one that runs long after this turn — a failed end-of-turn read must not
    // leave a ghost that later floors keep beside the real row). Not after a swap: the bubble left with
    // the view, and its durable row is in the floor the owner will see on coming back.
    if (pendingUserId !== undefined && !viewMoved(ctx))
      set({
        messages: state.messages.map((m) => (m.id === pendingUserId ? { ...m, landed: true } : m)),
      });

    // D17 — buffered (non-streaming) turn: the server returned one JSON payload instead of an SSE
    // stream (agent.streaming=off, or a non-streaming client). The turn already persisted its
    // message, so re-read the thread to render the bot reply + any confirm/question bubble (both
    // render from the persisted call state) — seeding the confirm token from the payload so a
    // buffered confirm stays resumable (it's the one thing not persisted). No parallel render path.
    if (res.headers.get("content-type")?.includes("application/json")) {
      const payload = (await res.json()) as Record<string, unknown>;
      // O6's buffered adopt point: the turn already ran; after a swap its thread, floor, notes and status
      // are the LEFT conversation's (the per-call pins below still seed — they are keyed by call id, not
      // by view, and a buffered confirm's token is the one thing a visit back could not re-read).
      const left = viewMoved(ctx);
      if (payload.threadId)
        adoptWireThread(ctx, payload.threadId as string, nonEmpty(payload.agent)); // refused when `left`
      const perm = payload.permission as
        | {
            callId?: string;
            token?: string;
            alwaysEligible?: boolean;
            prompt?: string;
            tool?: string;
            skills?: unknown;
          }
        | undefined;
      if (perm?.callId && perm.token) {
        confirmTokens[perm.callId] = perm.token;
        alwaysEligibleByCall[perm.callId] = perm.alwaysEligible === true; // D44 W3, mirrors the SSE branch
        modeByCall[perm.callId] = turnMode; // buffered confirm: pin the turn's mode too (ACA-16)
        skillsByCall[perm.callId] = skillIds(perm.skills) ?? turnSkills; // …and its skills (C5-M1, M2/C-12)
      }
      // C3-M4: a buffered turn can also suspend on a `tool.question` (no token) — seed its per-call
      // mode + skills too, else a newer send overwriting `turnMode`/`turnSkills` strands the answer
      // with the wrong turn's context. Mirrors the live `tool.question` reducer branch.
      const q = payload.question as
        { callId?: string; question?: string; skills?: unknown } | undefined;
      if (q?.callId) {
        modeByCall[q.callId] = turnMode;
        skillsByCall[q.callId] = skillIds(q.skills) ?? turnSkills;
      }
      if (left) return "accepted";
      // The thread THIS turn belongs to, captured BEFORE the reload await (verify-5, fix 3). The
      // notify calls below used to read `state.threadId` after it, so a `/new` interleaving during
      // the reload (the view is idle by then — `/new` is allowed) re-namespaced this turn's
      // signals under the NEW thread (or the no-thread fallback), breaking the live↔replay collapse.
      const notifyThread = str(payload.threadId) ?? state.threadId;
      // …and its HOME, for the signals' names (R37) and their taps (O2) — the head's `agent` when the
      // payload named one (S3), else the view's, captured beside the thread for the same reason.
      const notifyHome = nonEmpty(payload.agent) ?? state.threadAgent;
      // Clear the streaming placeholder so the floor reload (which skips while "streaming") runs.
      set({ status: "idle", streamingId: null });
      await reloadFloor();
      // A hop during the floor read (M1): `reloadFloor` discards its own floor, and the VIEW writes below —
      // the capped note, the error status, the steer discovery — are the left conversation's too. The
      // notifications are not view writes: they are keyed by the turn's own thread (`notifyThread`,
      // captured before the await — verify-5 fix 3), so they still publish.
      const here = !viewMoved(ctx);
      if (here && payload.state === "capped")
        pushSystemNote("// reached the step limit — send a message to continue");
      if (here && payload.state === "error") set({ status: "error" });
      // F1 (Codex MED-1) — the buffered transport announces the SAME occurrences the live reducer
      // does, through the SAME builders/keys: a turn that suspends on a confirm/question is exactly as
      // unattended here as it is over SSE. Published AFTER the reload so the announcement follows the
      // state it describes. The payload's `turn_id` (Phase 27 S10 fix ① — the handle's, the same id the
      // turn's `thread` frames carry) keys the terminal exactly as the frame consumer keys it, so a turn
      // this device LEFT before the buffered answer resolved collapses to ONE notification; a server that
      // predates the field sends none and the key falls back to the thread scope (the bounded case).
      if (perm?.callId)
        notifyAwaitingConfirm(notifyThread, perm.callId, perm.prompt, perm.tool, notifyHome);
      if (q?.callId) notifyAwaitingAnswer(notifyThread, q.callId, q.question, notifyHome);
      notifyTurnTerminal(
        notifyThread,
        nonEmpty(payload.turn_id) ?? null,
        str(payload.state),
        isObj(payload.error) ? str(payload.error.message) : undefined,
        notifyHome,
      );
      if (here) discoverSpawnedSteerTurn(); // D41 §3 — a buffered turn can also leave queued steers to a drain-B turn
      return "accepted";
    }

    // D41 — a STEER send (no placeholder) races the turn ending: the marker released before our POST
    // landed, so the server started a FRESH turn and streamed it (200, not 202). Adopt it as a live
    // turn — the reducer's message.start creates the bubble; we just need the view in "streaming" so it
    // renders + the Stop control appears. A normal/resume send is already streaming here (no-op).
    // FIX A — this 200 IS the live stream now (a fresh send's own turn, or a steer-race adoption of a
    // just-started turn B). Claim a fresh generation at the adopt point so a stale sibling stream (turn
    // A's trailing `done`) is dropped by the reducer and can never settle status under this turn.
    // O6 — unless the view moved while the POST was in flight: the claim is refused, the view is not
    // touched, and the reader is CANCELLED rather than held open for the whole left turn. The POST was
    // never aborted — past the 200 the turn is detached server-side (D39) and runs on regardless; its
    // terminal is cached there, and coming back re-attaches through the probe, not through this reader.
    if (!claimStream(ctx)) {
      await res.body.cancel().catch(() => {});
      return "accepted";
    }
    if (getChatStatus() !== "streaming") set({ status: "streaming" });
    // Reduce the SSE stream through the shared byte-parser (each frame carries `id: turn_id:seq`,
    // fed to the seq gate + the re-attach cursor).
    await parseSSE(res.body, handle);
    // FIX A — if a NEWER stream superseded us mid-reduce (a steer-race adopted turn B on another
    // socket), do NOT settle/re-attach/fail off this now-stale stream: its owner has moved on.
    if (ctx.gen !== streamGeneration) return "accepted";
    // The loop exits when the underlying stream closes. If the server sent a `done`/`error` before
    // closing, `settled` is true and there's nothing more to do. Otherwise the connection was cut
    // mid-flight (phone lock / backend killed / network drop / proxy timeout). D39: the turn is now
    // SERVER-OWNED — the drain task keeps running detached — so try to RE-ATTACH to it before
    // surfacing the F20 retry affordance. Signal the connection store first so the F16 badge appears
    // immediately (the re-attach `open` clears it), then re-attach from the last-seen cursor; only if
    // that fails (no live turn / repeated disconnect) fall back to `failStream`.
    if (!ctx.settled) {
      setConnection("reconnecting");
      const cursor = lastTurnId ? `${lastTurnId}:${lastSeq}` : undefined;
      const tid = state.threadId;
      const reattached = tid ? await reattachTurn(tid, cursor) : false;
      // (A re-attach that drove the turn home reloads the floor itself — D81, `reattachTurn`.) A hop
      // during the recovery (M1): the re-attach bailed, and the failure is not the new view's to show.
      if (!reattached && !viewMoved(ctx)) failStream("connection interrupted");
    } else {
      // D81 — the turn settled: re-read the durable floor (the sent bubble's server id + the tail's
      // `reply`). BEFORE the steer discovery, which reads the queued bubbles the floor carries over.
      await reloadFloor();
      // D41 §3 — the turn settled cleanly; if queued steers remain, a drain-B turn may have spawned
      // for them (invisible until probed). Discover + re-attach (reuses the D39 probe path).
      discoverSpawnedSteerTurn();
    }
    // Past the 200: the server TOOK this send, whatever the stream then did with it (F8 — the outcome
    // describes the ACCEPTANCE, not the turn's fate; a turn that fails mid-stream renders its own error).
    return "accepted";
  } catch (e) {
    // Cross-channel reconnect signal (F16): if this looks like a backend-unreachable error
    // (fetch network failure, or a 502/503/504 from Vite's proxy when the upstream is gone),
    // flip the connection state so the badge appears at the same time the chat error does.
    // The SSE event stream is authoritative — its own `open` will clear "reconnecting" the
    // moment it reconnects, so a transient false-positive here is self-healing. We don't
    // signal on 4xx (it's a real semantic error from the backend, not unreachability).
    if (isLikelyUnreachable(e)) setConnection("reconnecting");
    // FIX A — a stream that WENT LIVE (claimed a generation) but has since been superseded by a newer
    // stream must not re-attach or failStream off its own drop: the newer generation owns the view. A
    // never-claimed stream (gen −1: the fetch/setup threw before going live) still fails normally.
    if (ctx.gen >= 0 && ctx.gen !== streamGeneration) return "accepted";
    // M1 — a send that never went live (the POST was refused or failed at the transport) after the view
    // moved: no `failStream` into the view the owner is in. A 404 is dropped — the conversation it was
    // sent to is gone, and the next visit there 404s and runs R29; anything else returns its words to the
    // origin slot.
    const leftOutcome = (): SendOutcome => {
      if (taken) return "accepted";
      if (!(e instanceof HttpRefusal && e.status === 404)) returnToOrigin();
      return e instanceof TypeError ? "unknown" : "refused";
    };
    if (viewMoved(ctx)) return leftOutcome();
    // A THROWN read error (abrupt network loss, TCP reset) is the other half of the drop
    // case — the clean-EOF branch above already re-attaches; this one must too (final-review
    // CONCERN-1: without it a transient blip that recovers in seconds still failStreams a
    // turn that is alive and well server-side). Same fallback ladder: re-attach, else fail.
    if (!ctx.settled && state.status === "streaming" && !(e instanceof HttpRefusal)) {
      const cursor = lastTurnId ? `${lastTurnId}:${lastSeq}` : undefined;
      const tid = state.threadId;
      const reattached = tid ? await reattachTurn(tid, cursor).catch(() => false) : false;
      if (reattached) return "accepted";
      if (viewMoved(ctx)) return leftOutcome(); // a hop during the recovery — the same M1 disposition
    }
    // R29 — a SEND into the conversation still on screen answered 404: it was deleted elsewhere (the
    // left-send 404 above is the other case, dropped). Outside a call the send's words go back to the
    // dead conversation's draft (M1's origin slot), its optimistic bubbles go with the view, and
    // `conversationDeleted` toasts, opens the home's latest and carries that draft into it (E6). In a call (B12) the 404 is latched there and the utterance fails as
    // today, below — no toast, no swap. Only a live view is a source (H3).
    const origin = ctx.view?.thread;
    if (
      e instanceof HttpRefusal &&
      e.status === 404 &&
      url === "/api/agent/chat" &&
      origin &&
      body.thread_id === origin &&
      state.archived === false
    ) {
      if (!callLive()) {
        const dropped = new Set([placeholderId, pendingUserId].filter(Boolean));
        set({
          messages: state.messages.filter((m) => !dropped.has(m.id)),
          // a fresh send settles; a steer leaves the status to the turn it steered (the 409 arm's rule)
          ...(placeholderId !== undefined ? { status: "idle" as const, streamingId: null } : {}),
        });
        returnToOrigin();
        conversationDeleted(origin);
        return "refused";
      }
      conversationDeleted(origin); // latches (R42)
    }
    // A 4xx refusal speaks the server's own sentence when it sent one (a 5xx keeps `<url> → <status>`,
    // which is also what flags the connection badge above).
    failStream(
      e instanceof HttpRefusal && e.status < 500 && e.detail ? e.detail : (e as Error).message,
    );
    // F8 — the ONE indeterminate case, and it must stay distinguishable: a native fetch failure
    // (TypeError) can mean the request never left, or that it landed and the ANSWER was lost. A caller
    // that re-sends on that would risk an invisible duplicate, so the call overlay labels it instead.
    // Everything else here is the server having answered (`<url> → <status>`): a definite refusal.
    return e instanceof TypeError ? "unknown" : "refused";
  }
}

function isLikelyUnreachable(e: unknown): boolean {
  // Native fetch network errors (DNS, connection refused, abort) surface as TypeError.
  if (e instanceof TypeError) return true;
  // Our own `throw new Error('<url> → <status>')` for !res.ok. Any 5xx is a
  // backend-side problem (in dev, Vite's proxy returns 500 when the upstream is down —
  // I empirically verified this — not 502 like a typical reverse proxy). Treating all
  // 5xx as "unreachable for badge purposes" is honest: even a legit 500 means the
  // backend is in trouble, and the SSE event stream's authoritative `open` event will
  // clear the badge the moment things recover. A 4xx is a real semantic error — leave
  // the badge alone.
  if (e instanceof Error && /→ 5\d\d$/.test(e.message)) return true;
  return false;
}

// ── Re-attach to a server-owned turn (ACA Slice 3, D39) ─────────────────────────────────────────
// The turn now outlives its SSE socket (the drain task keeps running). These reduce a re-attach
// stream (`GET …/turns/{id}/stream`) back into the store: a `turn.sync` snapshot with REPLACE
// semantics, or a tail-replay whose frames flow through the SAME reducer + seq gate as live events.

/** Overlay a snapshot's open message (D39): claim-or-create the assistant bubble `id` and SET its
 *  text/reasoning parts WHOLESALE (never append — the snapshot carries the full accumulated text).
 *  Any tool_call/tool_result/error parts already on the bubble are preserved; the seq gate then drops
 *  the live deltas the snapshot already covered, so only genuinely-new deltas append on top.
 *  PURE (messages in → messages out) so `applyTurnSync` folds it with `overlaySyncCall` into ONE
 *  `set()` instead of one rebuild+render per call (review fix). */
function overlaySyncMessage(
  messages: ChatMessage[],
  id: string,
  text: string,
  reasoning: string,
  agent: string | null,
): ChatMessage[] {
  const setParts = (parts: Part[]): Part[] => {
    const next = parts.slice();
    const ri = next.findIndex((p) => p.type === "reasoning");
    if (reasoning) {
      if (ri >= 0) next[ri] = { type: "reasoning", text: reasoning };
      else next.unshift({ type: "reasoning", text: reasoning });
    }
    const ti = next.findIndex((p) => p.type === "text");
    if (ti >= 0) next[ti] = { type: "text", text };
    else next.push({ type: "text", text });
    return next;
  };
  if (messages.some((m) => m.id === id)) {
    return messages.map((m) =>
      m.id === id ? { ...m, parts: setParts(m.parts), agent: m.agent ?? agent } : m,
    );
  }
  const bubble = emptyAssistant(id, agent);
  bubble.parts = setParts([]);
  return [...messages, bubble];
}

/** Overlay one snapshot call (D39): ensure the tool_call for `call.call_id` exists with its snapshot
 *  state, seed the ephemeral confirm token (the one thing not persisted), re-pin the turn's mode for a
 *  resume, and attach a resolved result if present. Idempotent against the just-reloaded persisted
 *  messages — a suspended confirm is usually already persisted (the suspend fires after message.end),
 *  so this mostly re-seeds the token; the create branch covers a still-streaming open message. */
function overlaySyncCall(
  messages: ChatMessage[],
  call: Record<string, unknown>,
  mode: ChatMode | null,
  openId: string | null,
): ChatMessage[] {
  const callId = nonEmpty(call.call_id);
  if (!callId) return messages;
  const tool = str(call.tool) ?? "";
  const args = isObj(call.args) ? call.args : {};
  const runState: RunState = isRunState(call.state) ? call.state : "running";
  const perm = isObj(call.permission) ? call.permission : null;
  const question = isObj(call.question) ? call.question : null;
  const result = asToolResult(call.result);
  if (perm) {
    const token = str(perm.token);
    if (token) confirmTokens[callId] = token; // ephemeral — the snapshot is the only carrier
    alwaysEligibleByCall[callId] = perm.alwaysEligible === true; // D44 W3: carry the affordance gate across re-attach
  }
  if (result) {
    delete confirmTokens[callId];
    delete modeByCall[callId];
    delete skillsByCall[callId];
    delete alwaysEligibleByCall[callId];
  } else {
    modeByCall[callId] = mode; // pending call → pin its turn's mode for the eventual resume (ACA-16)
    // …and its skills (M2/C-12): the suspend payload carries the set the server had active, so a
    // re-attach that lost `skillsByCall` (a reload) recovers it instead of falling back to the
    // module-level `turnSkills`, which may be empty or belong to a LATER turn.
    const pinned = skillIds((perm ?? question)?.skills);
    if (pinned) skillsByCall[callId] = pinned;
  }
  const hasCall = messages.some((m) =>
    m.parts.some((p) => p.type === "tool_call" && p.call_id === callId),
  );
  let msgs = messages.map((m) => {
    if (!m.parts.some((p) => p.type === "tool_call" && p.call_id === callId)) return m;
    let parts = m.parts.map((p) =>
      p.type === "tool_call" && p.call_id === callId ? { ...p, state: runState } : p,
    );
    if (result) {
      parts = parts.some((p) => p.type === "tool_result" && p.call_id === callId)
        ? parts.map((p) =>
            p.type === "tool_result" && p.call_id === callId ? { ...p, result } : p,
          )
        : [...parts, { type: "tool_result", call_id: callId, result }];
    }
    return { ...m, parts };
  });
  if (!hasCall) {
    const newParts: Part[] = [{ type: "tool_call", call_id: callId, tool, args, state: runState }];
    if (result) newParts.push({ type: "tool_result", call_id: callId, result });
    if (openId && msgs.some((m) => m.id === openId)) {
      msgs = msgs.map((m) => (m.id === openId ? { ...m, parts: [...m.parts, ...newParts] } : m));
    } else {
      const bubble = placeholder(`sync-${callId}`); // a client-made id — the floor carries the real row
      bubble.parts = newParts;
      msgs = [...msgs, bubble];
    }
  }
  return msgs;
}

/**
 * Re-attach to a live server-owned turn (D39/S3-D). Opens `GET …/turns/{id}/stream` (with
 * `?cursor=turn_id:seq` when the seq gate has state for this thread), reusing the SHARED SSE parser +
 * reducer. Two server replies:
 *   • a `turn.sync` snapshot → the pinned sequence: forced reload (durable floor) → REPLACE-semantics
 *     overlay → go live (the seq gate dedupes the snapshot/live overlap);
 *   • a tail-replay → frames flow straight through the reducer + gate, no special handling.
 * A JSON `{active:false}` body → returns false (caller falls back to reload/failStream). Returns true
 * only once the stream drove the turn to a terminal (`done`/`error`); a disconnect mid-re-attach
 * retries ONCE, then returns false.
 *
 * `requireIdle` (C4-M1) — the cold-probe caller (`probeAndReattach`) passes true. The probe→attach
 * gap contains this function's `fetch` await, during which a user `sendMessage` can flip status to
 * "streaming" (a live stream now owns the turn). Attaching then would add a SECOND subscriber whose
 * `turn.sync` snapshot rewinds the seq gate MID-STREAM, corrupting the live reduce. So when set, after
 * the fetch resolves and BEFORE applying ANY frame (JSON branch or first SSE frame), bail out
 * (returning false, cancelling the body) if we're already streaming. Interrupt-path re-attaches
 * (`streamTurn`) pass false — there the drop is real and re-attach is the recovery.
 */
export async function reattachTurn(
  threadId: string,
  cursor?: string,
  requireIdle = false,
): Promise<boolean> {
  const url = `/api/agent/turns/${threadId}/stream${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
  // No placeholder — a fresh message.start creates a bubble. Bound to the VIEW it starts on (Phase 27 S6,
  // M1): a hop while this re-attach is in flight (a drop's recovery, a probe) must not let it claim — its
  // frames, its terminal, or its caller's `failStream` would land in the view swapped in.
  const ctx: TurnCtx = { claimed: true, settled: false, gen: -1, view: viewHere() };
  const reduce = makeTurnReducer(ctx);
  // FIX C — the thread this re-attach operates on. Every await below re-checks the view still sits on it
  // (an async re-attach can resolve after a `/new` or a new-thread switch) and bails before mutating,
  // so a stale re-attach never reloads/settles ANOTHER thread. Captured at entry (== `threadId` in
  // production; tolerant of an isolated call where the store thread was never set).
  const enteredOn = state.threadId;

  const applyTurnSync = async (
    snap: Record<string, unknown>,
    frameId: string | undefined,
  ): Promise<void> => {
    // FIX A — a stale generation's snapshot must never reset the gate / overlay (its owner has moved on).
    if (ctx.gen !== streamGeneration) return;
    // (a) forced reload — the durable per-step messages (the floor); bypasses the streaming-skip.
    await reloadChat(true);
    // FIX A/C — the forced reload awaited: bail if a newer stream superseded us, OR the owner switched
    // threads under us (this re-attach's floor/overlay belongs to the thread it entered on).
    if (ctx.gen !== streamGeneration || state.threadId !== enteredOn) return;
    // Reset the seq gate to the snapshot's turn+seq so overlapping LIVE deltas are deduped (S3-D).
    const parsed = parseFrameId(frameId);
    if (parsed) lastTurnId = parsed.turnId;
    lastSeq = typeof snap.seq === "number" ? snap.seq : (parsed?.seq ?? 0);
    // Re-pin the turn's inference mode for any resume (re-attach bypasses sendMessage, D39). The mode
    // is an arbitrary provider slug (A11/D48) — preserve any string snapshot, coerce non-strings → null.
    const mode: ChatMode | null = typeof snap.mode === "string" ? snap.mode : null;
    turnMode = mode;
    // (b) overlay with REPLACE semantics — the open message first, then each call — folded into ONE
    // `set()` (the helpers are pure: messages in → messages out), so a snapshot with N calls is a
    // single rebuild+render, not N+2 (review fix). Read `state.messages` AFTER the forced reload.
    let openId: string | null = null;
    let msgs = state.messages;
    const msg = snap.message;
    if (isObj(msg)) {
      const mid = nonEmpty(msg.id);
      if (mid) {
        openId = mid;
        msgs = overlaySyncMessage(
          msgs,
          mid,
          str(msg.text) ?? "",
          str(msg.reasoning) ?? "",
          str(msg.agent) ?? null,
        );
      }
    }
    for (const c of Array.isArray(snap.calls) ? snap.calls : [])
      if (isObj(c)) msgs = overlaySyncCall(msgs, c, mode, openId);
    // D41 §4 — the snapshot FOLDS drained steers (`steers: [{entryId,messageId,kind,text}]`) so a
    // re-attach renders steered user messages without a reload. Reconcile each against the just-reloaded
    // durable floor: drop the local queued dup if the durable message is present, else adopt its id.
    for (const s of Array.isArray(snap.steers) ? snap.steers : []) {
      if (!isObj(s)) continue;
      const eid = nonEmpty(s.entryId);
      if (!eid) continue;
      delRaw(threadId, eid);
      msgs = resolveSteerBubble(
        msgs,
        eid,
        nonEmpty(s.messageId),
        s.kind === "exec" ? "exec" : "message",
        str(s.text),
      );
    }
    set({ messages: msgs });
    // D41 MED-1 — the snapshot ALSO carries the still-PENDING queue (`steer_queue`, disjoint from the
    // drained `steers` folded above): reconcile it AFTER the reload+fold so a cold-load / re-attach
    // re-renders queued bubbles instead of the reload wiping them. Empty/absent → drops any stale
    // local bubble (server truth). Runs after the `set` so it reconciles against the folded floor.
    reconcileSteerQueue(
      threadId,
      Array.isArray(snap.steer_queue) ? (snap.steer_queue as SteerQueueEntry[]) : [],
    );
    // D43/A6 (review M4) — a re-attach DURING a same-endpoint retry backoff: the snapshot carries
    // `retry_status {endpoint, attempt, max, untilTs}` set by the session around the sleep. If the
    // backoff is still pending (untilTs — epoch SECONDS — is in the future), surface the retry line so
    // a reconnect mid-backoff shows the pending retry instead of a dead spinner. An already-expired
    // untilTs renders nothing (the retry has fired — the live stream carries what came next).
    // Dedup: the forced `reloadChat(true)` above already dropped any client-only note (the retry line
    // included), so a replayed snapshot re-renders exactly ONE note rather than stacking; the
    // content-presence guard backs that up so any render not preceded by a wipe can't duplicate it.
    const rs = snap.retry_status;
    if (isObj(rs)) {
      const endpoint = str(rs.endpoint);
      const { attempt, max, untilTs } = rs;
      if (
        endpoint !== undefined &&
        typeof attempt === "number" &&
        typeof max === "number" &&
        typeof untilTs === "number" &&
        untilTs * 1000 > Date.now()
      ) {
        const note = `// retrying ${endpoint} (attempt ${attempt}/${max})…`;
        if (
          !state.messages.some(
            (m) => m.role === "system" && m.parts.some((p) => p.type === "text" && p.text === note),
          )
        )
          pushSystemNote(note);
      }
    }
    // (c) go live — OR settle if the turn already ended in the tiny window before we attached (a
    // trailing/absent live `done` would otherwise strand the chat in "streaming").
    // A turn TERMINAL carries `completed|suspended|capped|error` — TURN states, not tool-call
    // RunStates (the old `isRunState` narrowing here was semantically wrong and would have missed
    // `completed`/`capped`; near-unreachable since the endpoints' terminal guard routes ended turns
    // to the JSON path, but wrong — final-review fix). Compare the raw string.
    const termState =
      isObj(snap.terminal) && typeof snap.terminal.state === "string" ? snap.terminal.state : null;
    if (termState) {
      ctx.settled = true;
      // The one snapshot path that can land on a capped terminal — mirror the live `done`
      // handler's note (final-review INFO: the other two paths emit it; this one didn't).
      if (termState === "capped")
        pushSystemNote("// reached the step limit — send a message to continue");
      set({ status: termState === "error" ? "error" : "idle", streamingId: null });
    } else {
      set({ status: "streaming", streamingId: openId });
    }
    // (d) F1 (Codex MED-1) — ANNOUNCE what the snapshot reconstructed, through the shared builders.
    // This is the transport that matters most for notifications: a phone that slept through the live
    // `tool.permission` frame learns about the block ONLY from here. Same keys as the live reducer, so
    // a device that DID see the live frame collapses the two onto one entry in the engine's seen-set
    // instead of buzzing twice. Published after the state above is applied; a suspended terminal
    // publishes nothing (the builder's standing rule) — the awaiting call below IS that moment.
    for (const c of Array.isArray(snap.calls) ? snap.calls : []) {
      if (!isObj(c)) continue;
      const callId = nonEmpty(c.call_id);
      if (!callId) continue;
      const p = isObj(c.permission) ? c.permission : null;
      const qn = isObj(c.question) ? c.question : null;
      // The accumulator stamps these RunStates on the call when it folds the suspend event, and drops
      // the ephemeral payload once a result lands — so an already-resolved call never re-announces.
      if (c.state === "awaiting_confirm")
        notifyAwaitingConfirm(threadId, callId, str(p?.prompt), str(c.tool), state.threadAgent);
      else if (c.state === "awaiting_answer")
        notifyAwaitingAnswer(threadId, callId, str(qn?.question), state.threadAgent);
    }
    if (termState)
      notifyTurnTerminal(threadId, lastTurnId, termState, undefined, state.threadAgent);
  };

  const onFrame = async (
    event: string,
    data: Record<string, unknown>,
    frameId?: string,
  ): Promise<void> => {
    if (event === "turn.sync") return applyTurnSync(data, frameId);
    reduce(event, data, frameId); // tail-replay + live: the normal reducer, deduped by the gate
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    // S6 — the retry re-checks: a view that moved during the first attempt is not re-fetched for.
    if (viewMoved(ctx)) return false;
    try {
      const res = await fetch(url, { headers: { Accept: "text/event-stream" } });
      // C4-M1: a cold-probe re-attach must not attach if a user send flipped us to "streaming" during
      // the fetch await above — a second subscriber whose snapshot would rewind the seq gate
      // mid-stream. Bail BEFORE applying any frame (JSON branch or first SSE frame); close the body.
      // FIX A — otherwise from here this re-attach IS the live stream: claim a fresh generation so a
      // stale sibling stream is dropped, and so our own settle below is guarded. S6 — the claim is
      // REFUSED when the view moved during the fetch: the same bail, before any frame.
      if ((requireIdle && getChatStatus() === "streaming") || !claimStream(ctx)) {
        await res.body?.cancel().catch(() => {});
        return false;
      }
      // Not live → JSON {active:false, terminal_status}: the turn ENDED (or lingered out) — the
      // durable floor has the truth, so reconcile from it and report handled (Slice-3 audit MED-2:
      // returning false here made a turn that COMPLETED during the drop render as a false
      // "connection interrupted" with a duplicate-send retry trap; D39 pins active:false → reload).
      if (res.headers.get("content-type")?.includes("application/json")) {
        // Trust the JSON "turn ended" answer ONLY when it's genuine: res.ok AND an explicit
        // active:false. A JSON 404/409/503 (version skew, a proxy error page carrying a JSON
        // content-type) would otherwise be read as a completed turn — reloading + settling idle +
        // dropping the Stop affordance while the turn is actually still running. Anything else →
        // return false so the caller's reload/failStream fallback handles it.
        const body = (await res.json()) as {
          active?: boolean;
          terminal_status?: string;
          turn_id?: string;
        };
        if (!res.ok || body.active !== false) return false;
        // FIX A/C — the `res.json()` awaited: bail if a newer stream superseded us or the owner
        // switched threads, so a stale terminal answer can't settle status under the current view.
        if (ctx.gen !== streamGeneration || state.threadId !== enteredOn) return false;
        // Mirror the live `done` handler's per-state settle so a re-attach landing on a terminal
        // doesn't drop the terminal_status (review fix): `capped` gets the step-limit note; `error`
        // settles to the error status; everything else goes idle as before.
        await reloadChat(true);
        // S6 (M1) — and again AFTER the forced read: a hop during it leaves the terminal note / status /
        // `failStream` below to the conversation left, never the view swapped in.
        if (viewMoved(ctx) || ctx.gen !== streamGeneration) return false;
        const st = body.terminal_status;
        if (st === "capped")
          pushSystemNote("// reached the step limit — send a message to continue");
        if (st === "error") {
          // A bare status flip is inert (no error Part → no bubble, no retry affordance —
          // final-review finding). failStream renders both; the reloaded floor sits above it.
          failStream("the turn failed while disconnected");
        } else {
          set({ status: "idle", streamingId: null });
        }
        // F1 (Codex MED-1) — the third reconstruction transport: the turn ended while we were
        // disconnected, and this JSON answer is the only place we learn it. The endpoint carries
        // `turn_id` (verified — `turn_stream`'s not-live replies all include it, from the handle or the
        // linger cache), so the key matches the live `done`'s and a device that saw both buzzes once.
        // A `suspended` terminal publishes nothing, as everywhere else — the awaiting call below IS
        // that moment (verify-5, fix 1: reconstructed from the floor the reload above just applied,
        // through the shared builders). An absent/null terminal_status (an unknown/expired turn)
        // publishes nothing at all: nothing was learned about how it ended.
        notifyTurnTerminal(
          threadId,
          nonEmpty(body.turn_id) ?? null,
          st,
          undefined,
          state.threadAgent,
        );
        if (st === "suspended") notifyRestoredAwaiting(threadId, state.threadAgent);
        return true;
      }
      if (!res.ok || !res.body) return false;
      await parseSSE(res.body, onFrame);
      if (ctx.settled) {
        // D81 — a turn this view ATTACHED to (a cut stream's recovery, a cold-load probe, a drain-B steer
        // turn) ends on the floor like one it started: the reply's `reply` annotation arrives with it.
        if (ctx.gen === streamGeneration && state.threadId === enteredOn) await reloadFloor();
        discoverSpawnedSteerTurn(); // D41 §3 — a re-attached (incl. drain-B) turn may chain another
        return true; // reached a terminal — fully handled
      }
      if (attempt === 0) continue; // disconnected mid-re-attach → retry ONCE
      return false; // repeated drop → caller falls back
    } catch {
      if (attempt === 0) continue; // transient network error → retry ONCE
      return false;
    }
  }
  return false;
}

/** The still-queued (undrained) steer entries a probe / cancel response carries (D41 §3/§7). The server
 *  stores the STRIPPED text; the raw line lives in the client `rawByEntry` map. */
interface SteerQueueEntry {
  entry_id?: string;
  kind?: string;
  text?: string;
}

/** D41 §3 — reconcile the local queued bubbles against the server's authoritative `steer_queue` (from
 *  the status probe / a cold load). Server-present + locally-missing → create a queued bubble (a reload
 *  must never DROP a still-queued steer — the vanished-steer double-send hazard). Locally-queued +
 *  server-absent → the entry DRAINED (or was removed): drop the local bubble; the durable floor carries
 *  the sent message. Also prunes this thread's `rawByEntry` of anything no longer queued.
 *
 *  FIX C — takes the `threadId` it was fetched FOR and no-ops if the owner has switched threads since
 *  (an async probe/re-attach can resolve after a `/new` or a new-thread send): a stale queue must
 *  never mutate a different thread's message list. */
function reconcileSteerQueue(threadId: string, queue: SteerQueueEntry[]): void {
  if (state.threadId !== threadId) return; // FIX C — thread switched under this async reconcile
  const serverIds = new Set(queue.map((e) => e.entry_id).filter((x): x is string => !!x));
  // drop drained/removed local bubbles; then append any server entry we don't have locally
  let msgs = state.messages.filter((m) => !(m.queued && !serverIds.has(m.queued)));
  const localQueued = new Set(msgs.filter((m) => m.queued).map((m) => m.queued));
  for (const e of queue) {
    if (!e.entry_id || localQueued.has(e.entry_id)) continue;
    msgs = [
      ...msgs,
      makeQueuedBubble(e.entry_id, e.kind === "exec" ? "exec" : "message", e.text ?? ""),
    ];
  }
  set({ messages: msgs });
  pruneRaw(threadId, serverIds);
}

/** D41 §3 — after a turn settles, if queued steer bubbles remain a drain-B turn may have spawned for
 *  them (invisible until probed). Probe + reconcile + re-attach (reuses the D39 path). No-op if none.
 *  `force` (FIX D — the DELETE `{removed:false}` reconcile) probes even with no queued bubbles left, so
 *  a just-drained entry's durable truth is reloaded rather than left to the next natural reload. */
function discoverSpawnedSteerTurn(threadId: string | null = state.threadId, force = false): void {
  if (threadId && (force || state.messages.some((m) => m.queued)))
    void probeAndReattach(threadId, force);
}

// D41 HIGH-2 — the re-probe delay covering the backend's reserve→spawn `task=None` window (below). A
// drain-B turn is reserved SYNCHRONOUSLY in the settling turn's done-callback, then its body runs on a
// fresh task; between the reserve and the body recording its terminal (all-exec) or attaching a task
// (message steer), the handle reads `task=None` → the probe sees active:false for a turn that is about
// to render. One short re-probe bridges it. Module constant (no magic number).
const DRAIN_B_REPROBE_MS = 250;

/** Re-attach if the probe says the turn is live; else settle from the durable floor. Shared by the
 *  first probe and the HIGH-2 re-probe. Returns nothing; the caller has already reconciled the queue. */
async function attachOrSettle(threadId: string): Promise<void> {
  const ok = await reattachTurn(threadId, undefined, true);
  // FIX C — the re-attach awaited; bail if the owner switched threads meanwhile (never settle/reload a
  // thread we have left). The settle only fires when WE left the view streaming and couldn't attach.
  if (state.threadId !== threadId) return;
  if (!ok && getChatStatus() === "streaming") {
    set({ status: "idle", streamingId: null });
    await reloadChat();
  }
}

/** Cold page-load re-attach (D39/M4): probe the thread's turn status and, if a turn is still running
 *  detached (the mobile app-kill case), re-attach via the snapshot path (no cursor). Non-blocking of
 *  the initial paint. If the re-attach set the view streaming but couldn't reach a terminal, reconcile
 *  from the durable floor so the cold view never hangs spinning. Also reconciles the D41 steer_queue so
 *  a reload / cold load re-renders any still-queued steers instead of dropping them (§3). */
async function probeAndReattach(threadId: string, force = false): Promise<void> {
  try {
    const probe = (await (await fetch(`/api/agent/turns/${threadId}`)).json()) as {
      active?: boolean;
      steer_queue?: SteerQueueEntry[];
    };
    // FIX C — the probe awaited; bail if the owner switched threads under us (a `/new` or a new-thread
    // send resolving before this fire-and-forget probe). A stale probe must never mutate another thread.
    if (state.threadId !== threadId) return;
    // Track BEFORE the reconcile (HIGH-2): did we hold optimistic queued bubbles going in? If so, a
    // just-settled turn that left steers may have spawned a drain-B turn whose durable output isn't
    // rendered yet — the reconcile below may DROP those bubbles without ever reloading the floor.
    // `force` (FIX D) counts as "had queued" so a DELETE-triggered probe still reloads the drained
    // entry's durable floor even after its own optimistic bubble was dropped.
    const hadQueued = force || state.messages.some((m) => m.queued);
    // Re-render queued steers from server truth BEFORE any streaming bail — the reconcile is truthful
    // regardless of the attach decision (kills the vanished-steer double-send hazard on a reload).
    if (Array.isArray(probe.steer_queue)) reconcileSteerQueue(threadId, probe.steer_queue);
    // The probe is fire-and-forget from initChat; if the owner sent a message while it round-tripped,
    // a live stream is already attached to the (new) turn. Re-attaching now would add a SECOND
    // subscriber whose `turn.sync` snapshot rewinds the seq gate mid-stream (corrupting the live
    // reduce). Bail on any in-flight turn — checked here after the probe await, AND re-checked inside
    // `reattachTurn(requireIdle=true)` after ITS fetch await (C4-M1): the fetch is a second window
    // where a send can flip us to "streaming" between this check and the first applied frame.
    if (getChatStatus() === "streaming") return;
    if (!probe.active) {
      // HIGH-2 (+ its MED racy variant): we saw an inactive turn while we HELD queued bubbles. The
      // reconcile just aligned the bubbles to server truth, but an all-exec drain-B renders NOTHING
      // (it runs the execs inline and only persists the durable exec pair — no live stream, no
      // `steer.applied`), so without a reload the drained command silently vanishes. Close two
      // windows with ONE short re-probe: (a) the reserve→spawn `task=None` gap where a drain-B turn
      // is about to go live (→ attach), and (b) the all-exec drain that already finished (→ reload the
      // durable floor so the exec pair renders). Status is idle here, so the reload is safe.
      if (hadQueued) {
        await new Promise((r) => setTimeout(r, DRAIN_B_REPROBE_MS));
        // The owner may have sent / navigated during the wait — never reload a thread we left, and
        // never add a subscriber onto a now-live stream (both would corrupt the live view).
        if (getChatStatus() === "streaming" || state.threadId !== threadId) return;
        const re = (await (await fetch(`/api/agent/turns/${threadId}`)).json()) as {
          active?: boolean;
          steer_queue?: SteerQueueEntry[];
        };
        // FIX C — the re-probe awaited; bail if the thread switched under us before mutating.
        if (state.threadId !== threadId) return;
        if (re.active) {
          if (Array.isArray(re.steer_queue)) reconcileSteerQueue(threadId, re.steer_queue);
          await attachOrSettle(threadId);
          return;
        }
        // Still not live → the durable floor is the truth. Reload it (renders the exec pair / a
        // completed drain-B turn's messages), THEN reconcile the queue against the reloaded floor so
        // any still-pending steer re-renders and any drained one drops.
        await reloadChat();
        if (state.threadId !== threadId) return; // FIX C — reload awaited; thread may have switched
        if (Array.isArray(re.steer_queue)) reconcileSteerQueue(threadId, re.steer_queue);
      }
      return;
    }
    await attachOrSettle(threadId);
  } catch {
    /* probe / re-attach failed — the plain history is already shown */
  }
}

/** Reconcile the chat after the events feed reconnects (F16 → D39): reload the durable floor, then —
 *  because a reconnect often means the CHAT stream also died — probe for a still-running detached
 *  turn and re-attach live (final-review CONCERN-1: `reloadChat` alone leaves a live turn rendering
 *  as a static snapshot until it ends). Skips while a stream is already attached. */
export async function reconcileChat(): Promise<void> {
  await reloadChat();
  if (state.threadId && getChatStatus() !== "streaming") void probeAndReattach(state.threadId);
}

// THE ONE IN-FLIGHT CANCEL. A double-tap of Stop must not POST twice (the cancel isn't instant and the
// button stays mounted until the resulting `done{cancelled}` settles status through the attached
// stream) — and the second caller must not be told it is DONE while the turn is still being cancelled,
// because `cancelTurn` resolving means "settled" and D71 §4.3 step ② submits on that promise. So the
// re-entry guard is the PROMISE itself: everyone shares the first cancel's settlement.
let cancelInFlight: Promise<void> | null = null;

/** The signature of the last harvest actually restored to the draft (FIX E — `harvest_replayed`
 *  idempotency). A REPEAT Stop within the backend's linger replays the SAME entries with
 *  `harvest_replayed:true`; the retry-on-lost-response path also re-reads them. Comparing the entry-id
 *  signature makes the restore idempotent so a replayed receipt never double-appends to the composer.
 *  entry_ids are session-unique, so the signature is stable across a lost-response retry. */
let lastHarvestSig: string | null = null;

interface CancelResp {
  cancelled?: boolean;
  active?: boolean;
  turn_id?: string;
  steer_queue?: SteerQueueEntry[];
  harvest_replayed?: boolean;
}

/** POST the scoped cancel (FIX E). The turn scope now rides the `?turn_id=` QUERY PARAM (the backend
 *  reads it synchronously, BEFORE its harvest, so a delayed Stop for a finished turn A neither cancels
 *  nor harvests a successor turn B). The legacy JSON body is still sent for back-compat; the query wins.
 *  `null` (no turn seen yet) → unscoped (legacy). */
function postCancel(threadId: string, turnId: string | null): Promise<Response> {
  const q = turnId ? `?turn_id=${encodeURIComponent(turnId)}` : "";
  return fetch(`/api/agent/turns/${threadId}/cancel${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turn_id: turnId }),
  });
}

/** Harvest undrained steers back to the composer draft (D41 §6), idempotent across a replayed receipt
 *  (FIX E). Restores each RAW line from this thread's `entry_id → raw` map (with its `/prefix` / `!`
 *  intact — the server only stored the stripped text); falls back to reconstructing from the entry.
 *  Newline-joined + APPENDED (never clobbers an existing draft). A response whose entry-id signature
 *  matches the last-restored harvest (a `harvest_replayed` receipt / a lost-response retry) is skipped. */
function harvestToDraft(threadId: string, data: CancelResp): void {
  const harvested = Array.isArray(data.steer_queue) ? data.steer_queue : [];
  if (!harvested.length) return;
  const sig = harvested.map((e) => e.entry_id ?? "").join(",");
  if (sig === lastHarvestSig) return; // already restored this receipt (replay / retry) — idempotent
  const lines: string[] = [];
  for (const e of harvested) {
    if (!e.entry_id) continue;
    const line =
      getRaw(threadId, e.entry_id) ?? (e.kind === "exec" ? `!${e.text ?? ""}` : (e.text ?? ""));
    if (line) lines.push(line);
    delRaw(threadId, e.entry_id);
  }
  if (lines.length) {
    appendDraft(lines.join("\n"), "\n", threadId); // its OWN thread's draft (S8), wherever the view is
    lastHarvestSig = sig;
  }
}

/** Consume a harvest receipt WITHOUT restoring it (D71 §4.3): a call-origin steer the cancel harvested
 *  was spoken INTO the turn being interrupted, and the owner is already saying the thing that replaces
 *  it — dropping it into the composer would leave stale words behind the live conversation. The raw
 *  lines are dropped exactly as a restore drops them, and the signature is stamped for the same reason
 *  `harvestToDraft` stamps it: a replayed receipt (the retry) must not then restore what this discarded. */
function discardHarvest(threadId: string, data: CancelResp): void {
  const harvested = Array.isArray(data.steer_queue) ? data.steer_queue : [];
  if (!harvested.length) return;
  const sig = harvested.map((e) => e.entry_id ?? "").join(",");
  if (sig === lastHarvestSig) return;
  for (const e of harvested) if (e.entry_id) delRaw(threadId, e.entry_id);
  lastHarvestSig = sig;
}

/** The receipt's disposition, the ONE place the two callers differ. */
function applyHarvest(threadId: string, data: CancelResp, harvest: HarvestMode): void {
  if (harvest === "draft") harvestToDraft(threadId, data);
  else discardHarvest(threadId, data);
}

/** What a cancel does with the steers the server hands back: `"draft"` = today's text-Stop restore;
 *  `"discard"` = the call's barge-in (§4.3 — consumed, not restored). */
export type HarvestMode = "draft" | "discard";

/** Cancel ONE named turn and settle the view — the primitive behind both text Stop and the call's
 *  ordered kill (D71 §4.2's F3 seam). Resolves only when the cancel has SETTLED, which is what makes
 *  §4.3 step ② awaitable: the barge-in may not submit the interrupting utterance until the turn it
 *  interrupted is actually gone.
 *
 *  FIX E — three contract behaviours, unchanged by the extraction:
 *   • SCOPED MISMATCH (`{cancelled:false, active:true, turn_id:<live>}`): our scoped turn has finished
 *     and a successor is live. The response's `steer_queue` is a READ-ONLY PEEK of the successor's queue,
 *     NOT a harvest — do NOT restore/remove. Adopt the live turn instead (re-attach; its generation
 *     supersedes our stale stream via `streamGeneration`).
 *   • REPLAYED HARVEST (`harvest_replayed:true`): restore is idempotent (`harvestToDraft` signature).
 *   • LOST RESPONSE (the POST/read threw): retry the Stop ONCE — the backend replays the harvest receipt
 *     — before falling back to a durable-floor settle.
 *
 *  RE-ENTRY shares the in-flight cancel rather than resolving early: a second caller awaits the same
 *  settlement, and the FIRST caller's harvest disposition is the one that applies (a `discard` racing a
 *  `draft` cannot un-consume what the first already took). */
export function cancelTurn(ref: LiveTurnRef, harvest: HarvestMode): Promise<void> {
  if (cancelInFlight) return cancelInFlight;
  cancelInFlight = runCancel(ref, harvest);
  return cancelInFlight;
}

async function runCancel(ref: LiveTurnRef, harvest: HarvestMode): Promise<void> {
  const threadId = ref.threadId;
  // A6/C4-H2: scope the cancel to THIS turn (the ref's own id) so a delayed Stop can't cancel/harvest a
  // successor turn — the server refuses/peeks a turn_id that doesn't match the live handle.
  const scopedTurn = ref.turnId;
  // Phase 27 S6 (M1) — the VIEW this Stop was pressed in: the ref's thread at the current view generation.
  // A hop is allowed while the cancel is pending (R9), so every VIEW write below — the status settle, the
  // floor reload, the successor re-attach — is guarded on it; a cancel answering after the owner left
  // never settles or reloads the view swapped in. The harvest is not a view write: it still applies to
  // its ORIGIN thread's raw lines (and that thread's draft — `harvestToDraft`, like `returnToOrigin`).
  const at = { view: { thread: threadId, gen: loadGen } };
  const settleIdle = () => {
    if (!viewMoved(at)) set({ status: "idle", streamingId: null });
  };
  const reloadHere = async () => {
    if (!viewMoved(at)) await reloadChat(true);
  };
  try {
    const res = await postCancel(threadId, scopedTurn);
    if (!res.ok) throw new Error(`cancel → ${res.status}`);
    const data = (await res.json()) as CancelResp;
    // SCOPED MISMATCH — a successor turn is live; the peeked queue is NOT ours to harvest. Adopt it —
    // unless the owner left the view: a re-attach is a view write, so never one into the view swapped in.
    if (data.cancelled === false && data.active === true) {
      if (viewMoved(at)) return;
      const ok = await reattachTurn(threadId, undefined, false);
      // Couldn't attach (the successor ended in the gap) → settle from the durable floor.
      if (!ok) {
        await reloadHere();
        settleIdle();
      }
      return;
    }
    applyHarvest(threadId, data, harvest);
    // No live turn (active:false) → no stream will deliver a `done`, so settle status here. Either way
    // ALWAYS reload from the durable floor: the drain task's cancel path already reconciled the in-flight
    // calls to CANCELLED server-side, but the ATTACHED client's local call parts still render pending —
    // the live-cancel reply carries no active:false to trigger a reload, so without this a stopped-but-
    // attached turn would spin those parts forever. The stream's own `done{cancelled}` still settles.
    if (data.active === false) settleIdle();
    await reloadHere();
  } catch {
    // LOST RESPONSE (socket drop) — retry the Stop ONCE: the backend REPLAYS the harvest receipt, so the
    // harvest is not lost (that is what the receipt is for). `harvestToDraft`'s signature keeps it single.
    try {
      const res = await postCancel(threadId, scopedTurn);
      if (res.ok) {
        const data = (await res.json()) as CancelResp;
        if (!(data.cancelled === false && data.active === true))
          applyHarvest(threadId, data, harvest);
        if (data.active === false) settleIdle();
        await reloadHere();
        return;
      }
    } catch {
      /* the retry also failed — fall back to a durable-floor settle below */
    }
    await reloadHere();
    settleIdle();
  } finally {
    cancelInFlight = null;
  }
}

/** Stop the running turn (D39/S3-C, D41 §6) — the composer's Stop control. The guard is the whole of
 *  what text Stop adds to the seam: only a STREAMING turn is stoppable from the composer (the button is
 *  not even mounted otherwise), and its steers go back to the composer where the owner can edit them. */
export async function stopTurn(): Promise<void> {
  const ref = getLiveTurn();
  if (ref === null) return;
  await cancelTurn(ref, "draft");
}

/** What the chat door did with a send (D71 §4.5's F8). `runComposer`'s boolean means "routing started"
 *  and every existing caller discards this promise, so the signal had to be BUILT: a call transcript
 *  that is definitely refused goes back to the owner as draft text, and one whose fate is UNKNOWN is
 *  labelled rather than re-sent (an invisible duplicate is worse than a manual retry).
 *
 *  · `accepted` — the server took it: a 200 stream, a buffered JSON turn, or a 202 with an entry id.
 *  · `refused`  — the server ANSWERED and did not take it: 409, any non-OK status, an untrackable 202.
 *  · `unknown`  — the request failed at the transport (a native fetch TypeError) with no answer and no
 *                 successful re-attach, so whether it landed is genuinely not knowable from here. */
export type SendOutcome = "accepted" | "refused" | "unknown";

/**
 * Send a user message and stream the assistant turn. Appends the user bubble + an empty assistant
 * placeholder (instant "…" feedback through the slow cold-load), then reduces the SSE turn — which
 * may run tools, suspend on a confirm bubble, or just answer.
 */
export async function sendMessage(
  text: string,
  opts?: {
    mode?: ChatMode;
    skills?: string[];
    raw?: string;
    /** Staged `attachment_id`s the server claims into this thread (D68 §3). Supplied by
     *  `runComposer`'s natural-language branch — the ONE place that reads the staging store — so
     *  every send path carries them without knowing about them. They arrive RESERVED (their rows are
     *  `sending`): this function is the other end of that reservation and must either consume them
     *  (the accept) or release them (anything else). */
    attachments?: string[];
  },
): Promise<SendOutcome> {
  const body = text.trim();
  const attachments = opts?.attachments ?? [];
  // Empty text is a legal send WITH files (D68 §7): the server injects `ATTACHMENT_ONLY_TEXT` as the
  // wire text and titles the thread from the filenames. With neither there is nothing to send — which
  // is a refusal from the caller's side: nothing was queued, and nothing will arrive later.
  if (!body && !attachments.length) return "refused";
  // D41 — the send-while-streaming guard is LIFTED: a send during a live turn is a STEER (enqueued via a
  // 202, drained into the running turn or spawned at its end). Per-message `/cloud <msg>` wins; else the
  // HOME's sticky mode (R40); else the server default (null). Only a FRESH (non-steer) send stashes
  // turnMode/turnSkills — those pin the LIVE turn's resume/answer context (ACA-16/C5-M1); a steer must
  // not re-point them (its own captured params ride the POST for a turn-end spawn instead).
  const steering = state.status === "streaming";
  // THE HOME's overrides (D84 R40, ON4) ride every turn in its conversation, whoever answers — and NONE
  // while the home is unknown (§12.3 H6: an uncapped elevation never rides another home's conversation).
  const override = homeOverride();
  const mode = opts?.mode ?? override?.mode ?? null;
  const skills = opts?.skills ?? []; // explicit /skill-name invocations (4.5)
  // The agent is the RESPONDER (`/agent <name>`, R45), else the server's ladder (null → the thread's
  // home). NOT stashed per-turn like turnMode/turnSkills: the resume/answer payloads carry no `agent`
  // (the server resolves the suspended turn's own), so there is nothing a steer could re-point — a
  // steer's agent rides its own POST (and a mid-loop drain ignores it — the responder applies from the
  // next TURN, §12.3 M10).
  const agent = state.responder;
  if (!steering) {
    turnMode = mode;
    turnSkills = skills;
  }

  // D68 MED-6 — the PRESENTATIONAL snapshot of what this send is carrying, read from the rail before
  // the chips are consumed. Never a wire field (`reqBody` below names its own fields, and this is not
  // one of them) and never a fabricated `AttachmentPart` — the server authors those at claim (E2).
  // What it buys is the half-second-to-a-minute the durable floor takes to arrive: the bubble shows
  // the photo it sent immediately, and an attachment-only send has a bubble at all.
  const previews = attachments.length ? stagedPreviews(attachments) : [];
  const tempUser: ChatMessage = {
    // A random suffix (not just `Date.now()`) so back-to-back STEERS queued within the same millisecond
    // get DISTINCT ids — the 202 marks the bubble by this id, and two colliding ids would mark/drop both
    // (D41: multiple queued steers must be independently addressable). Mirrors `pushLocal`'s id scheme.
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    thread_id: state.threadId ?? "",
    role: "user",
    parts: [{ type: "text", text: body }],
    actor: "user",
    ts: new Date().toISOString(),
    tokens: null,
    compacted: false,
    fresh: true,
    local: true, // D81 — no server id until the end-of-turn floor hands it one
    ...(previews.length ? { pending_attachments: previews } : {}),
  };
  const reqBody = {
    text: body,
    thread_id: state.threadId,
    mode,
    skills,
    agent,
    privilege: override?.privilege ?? null,
    stream: true, // the PWA always prefers streaming; the server's agent.streaming=off can override (D17)
    // Omitted when empty so the request shape of every pre-D68 send is byte-identical (the field
    // defaults to `[]` server-side).
    ...(attachments.length ? { attachments } : {}),
  };
  // The RAW composer line (WITH any `/prefix`) for a Stop harvest — falls back to the body when the
  // caller didn't thread it through (direct sends). Captured before prefix-stripping upstream.
  const raw = opts?.raw ?? body;

  // D68 §7 — the staged chips are released the moment the POST is ACCEPTED (never on a 409: a
  // refused send keeps them so the owner can act on the server's own sentence, which names
  // re-attaching as the fix). ONE owner for both halves of the reservation: what is not consumed here
  // is handed back by `releaseUnspent` below.
  let claimed = false;
  const onAccepted = attachments.length
    ? () => {
        claimed = true;
        // THE OBJECT-URL HAND-OFF (MED-6). Until this line the rail owns those previews and revokes
        // them on remove/clear; from this line the optimistic bubble above owns them, `consumeStaged`
        // drops the rows WITHOUT revoking, and `sweepPreviews` finishes the job when the durable
        // bubble replaces the optimistic one. A send that is never accepted never gets here, so a
        // refused send's chips keep both their rows and their thumbnails.
        ownPreviews(previews.flatMap((p) => (p.previewUrl === undefined ? [] : [p.previewUrl])));
        consumeStaged(attachments);
      }
    : undefined;
  /** The reservation's other half (MED-1): rows the server never took go back to `staged`, so the
   *  owner can re-send them instead of finding them stuck spoken-for. In a `finally` because a
   *  reservation that survives a thrown send would be exactly that.
   *
   *  The BUBBLE sheds its snapshot too (the confirm round's MED): a never-accepted send's bubble
   *  must not claim its files were sent — the chips (and their object URLs, which the rail never
   *  stopped owning) are back in the rail, and a bubble still rendering the same URL would break
   *  the moment the owner removes the restored chip. A text bubble keeps its text + failure state;
   *  an attachment-only bubble, empty without the snapshot, is REMOVED — the chips in the rail are
   *  the whole truth of what remains. (A 409's own rollback already removed the bubble; this map
   *  then matches nothing, and `sweepPreviews` revokes nothing because ownership never moved.) */
  const releaseUnspent = () => {
    if (claimed) return;
    releaseStaged(attachments);
    // Only while the bubble is still in the view: after a hop (S6) it left with the view it was sent
    // from, and the view swapped in is not this send's to rewrite.
    if (previews.length && state.messages.some((m) => m.id === tempUser.id)) {
      const messages = state.messages.flatMap((m) => {
        if (m.id !== tempUser.id) return [m];
        if (!body) return []; // attachment-only: nothing left to say
        const { pending_attachments: _dropped, ...rest } = m;
        return [rest];
      });
      set({ messages });
    }
  };

  if (steering) {
    // A STEER: append ONLY the user bubble (no assistant placeholder — the live turn owns the stream),
    // leave status/streamingId untouched, and POST. streamTurn's 202 branch marks the bubble queued; a
    // 409 (cap overflow / a sync holder) rolls it back; a 200 (the turn just ended) adopts it live.
    set({ messages: [...state.messages, tempUser] });
    try {
      return await streamTurn("/api/agent/chat", reqBody, undefined, tempUser.id, raw, onAccepted);
    } finally {
      releaseUnspent();
    }
  }

  const placeholderId = `assist-${Date.now()}`;
  set({
    // Session-51 #1c — the placeholder wears the agent that WILL answer, so the "working…" bubble has
    // the right name + avatar from its first frame (the regenerate path's mirror): the responder this
    // POST names, else the thread's home — the server's own fallback order. DISPLAY ONLY: `reqBody` is
    // untouched. Neither ⇒ `null` (the default) until `message_start` stamps the server's.
    messages: [...state.messages, tempUser, placeholder(placeholderId, agent ?? state.threadAgent)],
    status: "streaming",
    streamingId: placeholderId,
  });
  // Once the turn has settled, `streamTurn` re-reads the durable floor (D81 `reloadFloor`, every
  // turn) — which is also what shows the user bubble what it actually sent. The optimistic bubble
  // carries the text plus a PRESENTATIONAL snapshot (MED-6); the real `AttachmentPart`s are built by
  // the SERVER at claim (E2 — it resolves the final collision-suffixed name), so the client cannot
  // invent them, and the wire has no user-message frame to deliver them on. That read is therefore
  // what turns the snapshot into the durable bubble — and what revokes the previews it was rendering.
  // (A STEER returns above: its floor arrives with the next reconcile.)
  try {
    return await streamTurn(
      "/api/agent/chat",
      reqBody,
      placeholderId,
      tempUser.id,
      raw,
      onAccepted,
    );
  } finally {
    releaseUnspent();
  }
}

/** One-line sys breadcrumb for a compaction event (auto or manual). `rejected` (D42, manual only)
 *  = the produced summary wouldn't shrink the context, so nothing was folded. */
function compactionNote(removed: number, truncated: boolean, rejected = false): string {
  if (rejected) return "// nothing folded — the summary wouldn't shrink the context";
  if (!removed) return "// nothing to compact yet";
  const tail = truncated ? " (summarizer unavailable — older messages dropped)" : "";
  return `// compacted ${removed} message${removed === 1 ? "" : "s"} into a summary${tail}`;
}

/** `/compact [instructions]`: fold this thread's older turns into a summary now (manual compaction,
 *  4e). Full history stays in SQLite; only the live working context shrinks. `instructions` (D42) is
 *  the `/compact <text>` steer passed through to the summarizer prompt (null = no steer). */
export async function compactThread(instructions: string | null = null): Promise<void> {
  // Codex FIX C — capture the target thread at entry. `/compact` is async; a `/new`+new-thread in
  // the response gap would otherwise land this thread's breadcrumb in the now-current thread's view.
  // The compaction itself succeeds server-side regardless; only the client note is thread-scoped.
  const threadId = state.threadId;
  if (!threadId) {
    pushSystemNote("// nothing to compact yet");
    return;
  }
  try {
    const res = await fetch("/api/agent/compact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: threadId, instructions }),
    });
    // Switched threads while the request was in flight → drop every breadcrumb (no cross-thread routing).
    if (state.threadId !== threadId) return;
    if (res.status === 409) {
      pushSystemNote("// " + (await busyDetail(res)));
      return;
    }
    if (!res.ok) throw new Error(`compact → ${res.status}`);
    const data = (await res.json()) as {
      removed: number;
      truncated?: boolean;
      rejected?: boolean;
      noop?: boolean;
      detail?: string;
    };
    // Compaction only shrinks the model's *working* context; the visible chat log keeps the full
    // history (the summary lives server-side for the next turn), so just drop a breadcrumb — same
    // as the auto path. No re-read: that would surface the raw summary mid-log beside the originals.
    // A too-small thread is a benign no-op (A5-x): the server labels it with an informational `detail`,
    // rendered as-is rather than the failure-ish "wouldn't shrink the context" wording.
    if (data.noop && data.detail) pushSystemNote(`// ${data.detail}`);
    else
      pushSystemNote(compactionNote(data.removed, Boolean(data.truncated), Boolean(data.rejected)));
  } catch {
    if (state.threadId === threadId) pushSystemNote("// compaction failed — try again");
  }
}

/** `!<cmd>` — the guarded shell escape hatch (Phase 5). POST the command to `/api/exec`; the server
 *  runs it on the backend host and persists the command + result into the thread as a tool_call +
 *  tool result pair, so a re-read renders it as a command bubble (and the agent sees it next turn).
 *  Mirrors the D17 buffered path: set the thread id, then `reloadChat()` — no parallel render path. */
export async function runShell(command: string): Promise<void> {
  // O6/M1 (S7A-01) — the view this `!cmd` was typed in, captured before the POST: a swap may land while
  // it is in flight, and from then on the exec belongs to the conversation it was sent from.
  const view = viewHere();
  try {
    const res = await fetch("/api/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, thread_id: state.threadId }),
    });
    // M1 — a LEFT exec writes nothing into the view swapped in: no refusal note (403/409) either.
    if (res.status === 403) {
      if (!viewMoved({ view }))
        pushSystemNote("// shell exec is disabled (Conf → Shell → user exec)");
      return;
    }
    // 409 = the thread's turn marker is held (D38) — busy, not broken; don't fall through to the
    // "backend unreachable" catch (misleading) — surface the server's actionable detail instead.
    if (res.status === 409) {
      const detail = await busyDetail(res);
      if (!viewMoved({ view })) pushSystemNote("// " + detail); // checked AFTER the body read's await
      return;
    }
    // 202 = a chat/resume turn is live and ACCEPTED this `!cmd` as a queued exec steer (D41). Render an
    // optimistic queued `!cmd` bubble (keyed by entry_id) + stash its raw line for a Stop harvest; the
    // durable tool_call/result pair arrives on a later reload. `steer.applied{kind:exec}` resolves it.
    if (res.status === 202) {
      const info = (await res.json().catch(() => ({}))) as { entry_id?: string; turn_id?: string };
      if (info.entry_id && viewMoved({ view })) {
        // A LEFT exec steer (M1, chat's own 202 arm): no bubble in the moved view — its raw line stays
        // under the thread it was queued on (O22), retired by that thread's drain / harvest / reconcile.
        if (view.thread) setRaw(view.thread, info.entry_id, `!${command}`);
        return;
      }
      if (info.entry_id) {
        setRaw(state.threadId ?? "", info.entry_id, `!${command}`);
        set({ messages: [...state.messages, makeQueuedBubble(info.entry_id, "exec", command)] });
        // FIX B — a LATE 202: the live turn that accepted this exec steer may have ended + spawned a
        // drain-B turn in the response gap. If no stream is live — or we are watching a DIFFERENT turn
        // than the holder that took it — discover the spawned turn now (mirrors the chat 202 branch).
        if (
          getChatStatus() !== "streaming" ||
          (lastTurnId !== null && info.turn_id !== undefined && info.turn_id !== lastTurnId)
        )
          discoverSpawnedSteerTurn();
      }
      return;
    }
    if (!res.ok) throw new Error(`exec → ${res.status}`);
    const data = (await res.json()) as { threadId: string; agent?: string | null };
    // The exec RAN server-side in its own conversation; a view the owner moved away from writes nothing
    // (the next visit shows the pair). Otherwise the wire thread — with its HOME (F2: a `!cmd` on a
    // thread-less view MINTS, and the 200 names the minted home) — then the forced floor read.
    if (viewMoved({ view })) return;
    if (data.threadId) setWireThread(data.threadId, data.agent ?? undefined);
    // FIX B — a 200 means the exec RAN (the marker was free server-side: a live chat/resume turn returns
    // 202, a sync holder 409). A prior stream may still read "streaming" locally (a race where the turn
    // released server-side but our socket hasn't drained), which would make a NON-forced reload skip and
    // hide the persisted exec pair. FORCE the reload — safe here precisely because a 200 guarantees no
    // live server turn to yank.
    await reloadChat(true);
  } catch {
    if (!viewMoved({ view })) pushSystemNote("// shell exec failed — backend unreachable?");
  }
}

/** D41 §5 — remove a queued steer (the owner tapped its chip). DELETE the entry: `{removed:true}` drops
 *  the bubble + its raw line. `{removed:false}` (it already DRAINED) does NOT just clear the queued marker
 *  — that would leave a fake "sent" bubble carrying a client-only `steer-<id>` id that vanishes on the
 *  next reload (Codex FE FIX D). Instead DROP the optimistic bubble and reconcile from the server so the
 *  DURABLE truth renders (a message steer → the persisted user row; an exec steer → the persisted
 *  tool_call/result pair). Single tap — a queued draft is not destructive, so no confirm. Best-effort:
 *  on failure the chip stays and a later probe/reload reconciles from the server's steer_queue. */
export async function removeSteer(entryId: string): Promise<void> {
  if (!state.threadId) return;
  const threadId = state.threadId;
  try {
    const res = await fetch(`/api/agent/turns/${threadId}/steer/${encodeURIComponent(entryId)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`steer delete → ${res.status}`);
    const data = (await res.json()) as { removed?: boolean };
    delRaw(threadId, entryId);
    // Both branches drop the optimistic bubble (no fake sent bubble); `removed:false` ALSO reconciles
    // the durable truth into view via the probe/reload path (force so it reloads even when this was the
    // last queued bubble).
    set({ messages: state.messages.filter((m) => m.queued !== entryId) });
    if (!data.removed) discoverSpawnedSteerTurn(threadId, true);
  } catch {
    /* best-effort — the chip stays; a reload reconciles from the server's steer_queue */
  }
}

/** Apply a plan edit to the latest task_plan call+result in the local message list (immutably).
 *  Mirrors the backend's in-place update so the pinned panel re-derives instantly (optimistic). */
function applyPlanEdit(messages: ChatMessage[], steps: PlanStep[]): ChatMessage[] {
  let callId: string | null = null;
  for (const m of messages)
    for (const p of m.parts)
      if (p.type === "tool_call" && p.tool === "task_plan") callId = p.call_id;
  if (!callId) return messages;
  const done = steps.filter((s) => s.status === "done").length;
  const summary = steps.length ? `plan · ${done}/${steps.length} done` : "plan cleared";
  return messages.map((m) => ({
    ...m,
    parts: m.parts.map((p) => {
      if (p.type === "tool_call" && p.call_id === callId)
        return { ...p, args: { steps }, state: "ok" as RunState };
      if (p.type === "tool_result" && p.call_id === callId)
        return {
          ...p,
          result: { ...p.result, state: "ok", summary, data: { plan: { steps } } },
        };
      return p;
    }),
  }));
}

/** Toggle/edit the working plan from the UI (clicking a step's dot). Optimistically updates the
 *  latest task_plan call+result locally, then persists; the agent sees it on its next turn. */
export async function editPlan(steps: PlanStep[]): Promise<void> {
  // S2-C: don't offer a plan edit the server will 409 mid-turn (the live loop owns the plan row).
  // Silent early-return like `resumeCall`/`answerQuestion` — the server stays authoritative.
  if (!state.threadId || state.status === "streaming") return;
  const prev = state.messages;
  set({ messages: applyPlanEdit(state.messages, steps) });
  try {
    const res = await fetch("/api/agent/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: state.threadId, steps }),
    });
    if (res.status === 409) {
      set({ messages: prev }); // rollback the optimistic edit
      pushSystemNote("// " + (await busyDetail(res)));
      return;
    }
    if (!res.ok) throw new Error(`plan → ${res.status}`);
  } catch {
    set({ messages: prev }); // rollback the optimistic edit
    pushSystemNote("// could not update the plan");
  }
}

// ── D81 — the owner's message actions: retry (a new variant) · swap variants · edit · delete ────────
// The server owns every rule here (which rows form the unit, which variant is live, what the model sees):
// each action is one route, and the three sync ones answer with the whole durable floor, which
// `applyFloor` installs — the client never derives reply membership, it reads `reply` off the host row.
// All four refuse while a turn streams (the routes 409 then anyway — the controls are not even shown).

/** Whether the view may take a message action right now: a thread, and no live turn. */
function actionable(): boolean {
  return state.threadId !== null && state.status !== "streaming";
}

/** One sync message route in flight at a time: a double-tap of `‹` would otherwise send the second swap
 *  with the host id the first one just replaced (an honest 409, but a pointless one). */
let syncInFlight = false;

/** Run ONE of the sync routes (swap/edit/delete) and install the floor it answers with. A refusal (409 stale/busy/folded, 422, 404, 403) says the server's own sentence and
 *  re-reads the floor — the usual cause is a view that no longer matches the thread (another device
 *  acted), and the fresh floor is the fix. `before` runs just ahead of the install (the edit's audio
 *  forget). Resolves whether the route TOOK the change — `false` for a refusal, a failure, or a local one (a turn
 *  streaming, a route already in flight): the editor uses it to hand the owner's typed text back. */
async function syncMessageRoute(
  url: string,
  init: RequestInit,
  failure: string,
  before?: () => void,
): Promise<boolean> {
  if (!actionable() || syncInFlight) return false;
  const threadId = state.threadId;
  syncInFlight = true;
  try {
    const res = await fetch(url, init);
    if (state.threadId !== threadId) return false; // the view moved on — this floor is another thread's
    if (!res.ok) {
      pushSystemNote("// " + (await busyDetail(res, failure)));
      await reloadFloor();
      return false;
    }
    const data = (await res.json()) as { messages?: unknown };
    if (!Array.isArray(data.messages)) throw new Error("no floor");
    before?.();
    // A turn that started meanwhile will land its own floor; the change itself was taken either way.
    if (getChatStatus() !== "streaming") applyFloor(data.messages as ChatMessage[]);
    return true;
  } catch {
    if (state.threadId === threadId) pushSystemNote(`// ${failure} — try again`);
    return false;
  } finally {
    syncInFlight = false;
  }
}

const threadPath = (threadId: string, messageId: string) =>
  `/api/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`;

/** An UNSENT bubble (D81): the owner's client-only message the server never took — a refused POST, a
 *  transport failure, or a steer still in flight. Not a queued steer (the server holds it) and not a
 *  `landed` one (its POST was accepted). While one follows a reply, that reply is not the thread's tail
 *  from the owner's point of view, so it is not retried (the view hides the controls too). */
export function isUnsent(m: ChatMessage): boolean {
  return m.role === "user" && m.local === true && !m.landed && !m.queued;
}

/** The floor's tail host (the row carrying `reply`) — but NOT when an unsent bubble follows it: retrying
 *  the reply BEFORE a send the server never took would rewrite the wrong turn. */
function landedHost(): ChatMessage | undefined {
  const at = state.messages.findIndex((m) => m.reply);
  if (at < 0) return undefined;
  return state.messages.slice(at + 1).some(isUnsent) ? undefined : state.messages[at];
}

/** The owner's last message, when it is durable and nothing the agent said follows it on the floor — the
 *  one case the regenerate wire takes a USER row's id (D81 wave 1: an answerless anchor writes take 1).
 *  `undefined` when that message is client-only (it never reached the server) or already answered. */
function answerless(): ChatMessage | undefined {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m.role === "user" && !m.queued) return m.local ? undefined : m;
    // A durable AGENT row answers it (an owner `!exec` pair is `actor: "user"` and does not).
    if (!m.local && m.role !== "system" && m.actor !== "user") return undefined;
  }
  return undefined;
}

/** F20 on sends that never reached the server (their bubbles are still client-only — a refused POST, a
 *  transport failure, a turn accepted but never saved): there is no server turn to regenerate, and
 *  re-sending blind could duplicate a message whose fate is unknown. So their words go back to the
 *  composer for the owner to send again, and the stand-ins (the bubbles, their errors) leave the log.
 *  EVERY unsent bubble in one pass (wave 2 · N3): after two refused sends the older one has no error
 *  left (errors never stack), and recovering only the newest would leave it orphaned — no retry of its
 *  own, and locking the retry above it. `false` when the last user message is durable. */
function recoverUnsent(): boolean {
  let lastUser = -1;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m.role === "user" && !m.queued) {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0 || !isUnsent(state.messages[lastUser])) return false;
  const unsent = state.messages.filter(isUnsent);
  const first = state.messages.indexOf(unsent[0]);
  set({
    messages: state.messages.filter(
      (m, i) => !isUnsent(m) && !(i > first && m.local && m.role !== "system" && !m.queued),
    ),
    status: "idle",
    streamingId: null,
  });
  appendDraft(unsent.map((m) => textOf(m.parts)).join("\n"), "\n");
  pushSystemNote(
    unsent.length === 1
      ? "// that message didn't reach the server — it's back in the composer"
      : "// those messages didn't reach the server — they're back in the composer",
  );
  return true;
}

/**
 * RETRY — regenerate the tail reply as a new variant (D81; ST's swipe-right-past-the-end). `hostId` names
 * the tail's host row, the one carrying `reply`. The displaced take is kept by the server as a variant
 * (an error-only one is discarded), and the new take streams in as an ordinary turn.
 *
 * Also the F20 inline retry on an error bubble — rerouted here, so a failed turn is re-run in place
 * rather than re-SENT (the old FE resend duplicated the user row server-side). An error the view has no
 * floor for (a cut stream) re-reads the floor first and retries the tail host it finds there — unless the
 * failed send never reached the server at all, whose words go back to the composer (`recoverUnsent`).
 *
 * **I4 — risk-aware.** Alternates rewind the transcript, not the world: a displaced reply that ran a
 * non-`retry_safe` tool (a reboot, a shell command, a memory write) has already done it, and a new take
 * may do it again — so that case asks one confirm tap first. `isRetrySafe(tool)` comes from the action
 * catalog (an unknown tool → unsafe).
 *
 * Optimistic: the reply's rows (exactly `reply.ids`) leave the log and the "…" placeholder takes their
 * place at once. A refusal (409 stale/busy/folded) puts the log back and says why.
 */
export async function regenerate(
  hostId: string,
  isRetrySafe: (tool: string) => boolean,
): Promise<void> {
  if (!actionable()) return;
  let host = state.messages.find((m) => m.id === hostId && m.reply);
  let target = host?.id;
  if (host && state.messages.slice(state.messages.indexOf(host) + 1).some(isUnsent)) {
    // (The view hides retry/`›` here; this is the store's own guard.) The unsent message's error pill
    // is the door: it hands those words back first.
    pushSystemNote("// retry the unsent message below first");
    return;
  }
  if (!host) {
    // F20 on an error the view never got a floor for (a stream cut short, a send that failed): read the
    // floor first — the turn may well have landed server-side.
    await reloadFloor();
    if (!actionable()) return;
    host = state.messages.find((m) => m.id === hostId && m.reply) ?? landedHost();
    // No reply to rewrite: the owner's last message may still be ANSWERLESS on the server (its error
    // take dropped, its reply deleted, a turn stopped before its first row) — then the wire takes the
    // message's own id and writes take 1 (D81 wave 1). A send that never got there goes back instead.
    target = host?.id ?? answerless()?.id;
    if (target === undefined) {
      if (!recoverUnsent()) pushSystemNote("// there is no reply to retry here");
      return;
    }
  }
  if (target === undefined) return;
  const ids = new Set(host?.reply?.ids ?? []);
  const displaced = state.messages.filter((m) => ids.has(m.id));
  const risky = displaced
    .flatMap((m) => m.parts)
    .find((p): p is ToolCallPart => p.type === "tool_call" && !isRetrySafe(p.tool));
  if (risky) {
    const ok = await requestConfirm({
      title: "Retry this reply?",
      body: `It ran ${risky.tool.replace(/_/g, " ")}. A new take doesn't undo that — and may run it again.`,
      confirmLabel: "Retry",
      danger: true,
    });
    if (!ok || !actionable()) return; // the confirm is an await: re-check the view it would act on
  }
  const threadId = state.threadId as string;
  // A regenerate is a FRESH turn on this view: it pins the turn's context for any resume it suspends on
  // (ACA-16/C5-M1), like a send. No explicit skills — the server re-activates the anchor's own.
  // The HOME's overrides (R40) — a regenerate speaks as the reply's own speaker, at its home's stance.
  const override = homeOverride();
  const mode = override?.mode ?? null;
  turnMode = mode;
  turnSkills = [];
  // Whatever is docked for the displaced take is stopped now: it is leaving the log.
  for (const id of ids) forgetMessage(id);
  // A client error bubble is RETRIED by this — it leaves with the take it failed (errors never stack) —
  // but only from the OPTIMISTIC view: a refusal restores the unfiltered `before`, so a message with no
  // reply keeps its one retry door (wave 2 · N1).
  const before = state.messages;
  const statusBefore = state.status; // "error" keeps the restored error bubble's retry pill (F20 gate)
  const placeholderId = `assist-${Date.now()}`;
  // The speaker is the server's (the agent that gave the displaced reply) — mirrored on the placeholder
  // so the bubble is labelled right from its first frame.
  const agent = displaced.find((m) => m.role === "assistant")?.agent ?? null;
  set({
    messages: [
      ...before.filter(
        (m) => !ids.has(m.id) && !(m.local && m.parts.some((p) => p.type === "error")),
      ),
      placeholder(placeholderId, agent),
    ],
    status: "streaming",
    streamingId: placeholderId,
  });
  const outcome = await streamTurn(
    "/api/agent/regenerate",
    {
      thread_id: threadId,
      message_id: target,
      mode,
      privilege: override?.privilege ?? null,
      stream: true,
    },
    placeholderId,
  );
  if (outcome === "accepted" || state.threadId !== threadId) return;
  // Refused or lost: nothing was displaced server-side that the view should stop showing. A 409 (stale,
  // busy, folded) has already said so as a note; any OTHER refusal (403 rolling thread, 404, 422, 5xx) or
  // a transport loss left its words on the placeholder as an error — that becomes a toast (fix wave 1:
  // a real error, never the re-attach ladder), and the placeholder goes. Then the log is put back as it
  // was, plus the notes said since, and reconciled from the floor.
  const failed = state.messages
    .find((m) => m.id === placeholderId)
    ?.parts.find((p) => p.type === "error");
  if (failed?.type === "error") pushToast(`Retry failed — ${failed.message}`, "err");
  const said = state.messages.filter(
    (m) => m.local && !before.includes(m) && m.id !== placeholderId,
  );
  set({ messages: [...before, ...said], status: statusBefore, streamingId: null });
  await reloadFloor();
}

/** Swap the tail reply to variant `n` (1-based; D81). `hostId` = the host the view shows. Swapped
 *  variants keep their own row ids, so the audio cache stays true for them. */
export async function selectAlternate(hostId: string, n: number): Promise<void> {
  const threadId = state.threadId;
  if (!threadId) return;
  await syncMessageRoute(
    `${threadPath(threadId, hostId)}/alternate`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ n }),
    },
    "could not switch replies",
  );
}

/** Replace a message's text (D81 — ST parity: an edit in place, no regenerate; user or assistant rows).
 *  Tool calls, reasoning and attachments stay as they were. The edited id's cached clip is dropped
 *  (`forgetMessage`) — it spoke the old words. Resolves whether the edit was SAVED (the editor re-opens
 *  on the typed text when it was not). */
export function editMessage(messageId: string, text: string): Promise<boolean> {
  const threadId = state.threadId;
  if (!threadId) return Promise.resolve(false);
  return syncMessageRoute(
    threadPath(threadId, messageId),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    },
    "could not save the edit",
    () => forgetMessage(messageId),
  );
}

/** Delete a message (D81), behind ONE confirm tap (no undo in v1 — owner ruling ②). The server resolves
 *  the unit from the id: a user row alone; an agent row → its whole reply (on the tail with alternates,
 *  only the variant shown — its neighbour comes back). */
export async function deleteMessage(messageId: string): Promise<void> {
  if (!actionable()) return;
  const m = state.messages.find((x) => x.id === messageId);
  if (!m) return;
  const own = m.role === "user";
  // The tail reply's variant count, read off its host (any row of the reply names it in `reply.ids`).
  const variants = state.messages.find((x) => x.reply?.ids.includes(messageId))?.reply?.count ?? 1;
  const ok = await requestConfirm({
    title: own ? "Delete this message?" : "Delete this reply?",
    body: own
      ? "Your message leaves the conversation. The reply to it stays."
      : variants > 1
        ? "This version of the reply goes; another take comes back."
        : "The whole reply leaves the conversation, its tool steps too.",
    confirmLabel: "Delete",
    danger: true,
  });
  const threadId = state.threadId;
  if (!ok || !threadId) return;
  await syncMessageRoute(
    threadPath(threadId, messageId),
    { method: "DELETE" },
    "could not delete the message",
  );
}

// Proposals being applied/dismissed right now — guards a double-tap of Approve/Dismiss (the POST is
// not instant and the bubble stays mounted until the result patch lands).
const applyingProposals = new Set<string>();

/** Patch the tool_result (and, when applied, its tool_call state) for `callId` with the server's
 *  resolved result — clears `data.proposed`, so the bubble's Approve/Dismiss affordance disappears. */
function patchResult(callId: string, result: ToolResult, applied: boolean): void {
  set({
    messages: state.messages.map((m) => ({
      ...m,
      parts: m.parts.map((p) => {
        if (p.type === "tool_result" && p.call_id === callId) return { ...p, result };
        if (applied && p.type === "tool_call" && p.call_id === callId)
          return { ...p, state: "ok" as RunState };
        return p;
      }),
    })),
  });
}

/**
 * Approve or dismiss a proposed write (7e-f-3) — the chat bubble's affordance for a `memory` /
 * `skill_manage` call that returned `data.proposed` (its auto-write switch is off). Approve performs
 * the write the agent proposed; dismiss drops it. Both resolve the proposal server-side (so a reload
 * doesn't resurrect the buttons) and patch the local result. A failed apply (over cap / stale memory)
 * leaves the proposal pending and drops a breadcrumb.
 */
export async function applyProposal(callId: string, decision: "apply" | "dismiss"): Promise<void> {
  // S2-C: gate on streaming like `resumeCall`/`answerQuestion` — the server 409s a proposal
  // resolution mid-turn, so don't offer it (server stays authoritative). Silent early-return.
  if (!state.threadId || state.status === "streaming" || applyingProposals.has(callId)) return;
  applyingProposals.add(callId);
  try {
    const res = await fetch("/api/agent/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: state.threadId, call_id: callId, decision }),
    });
    // 409 here is EITHER the turn-busy marker (D38) or apply's own "no pending proposal for this
    // call" — busyDetail reads the server's actual detail, so the right text surfaces either way.
    if (res.status === 409) {
      pushSystemNote("// " + (await busyDetail(res)));
      return;
    }
    if (!res.ok) throw new Error(`apply → ${res.status}`);
    const data = (await res.json()) as { result: ToolResult; applied: boolean };
    if (decision === "apply" && !data.applied) {
      // Gate denied / write failed (over cap, stale old_text) — proposal stays pending.
      pushSystemNote(`// not applied — ${data.result.error ?? data.result.summary}`);
      return;
    }
    patchResult(callId, data.result, data.applied);
  } catch {
    pushSystemNote(`// could not ${decision} the proposal — try again`);
  } finally {
    applyingProposals.delete(callId);
  }
}

/** Answer a suspended `question` (A2) and continue the turn — the owner's reply becomes the call's
 *  result the model reads next. Mirrors `resumeCall` (dismiss a question reuses that path). */
export async function answerQuestion(callId: string, answer: string): Promise<void> {
  if (state.status === "streaming" || !state.threadId || !answer.trim()) return;
  set({ status: "streaming" });
  await streamTurn("/api/agent/resume", {
    thread_id: state.threadId,
    call_id: callId,
    decision: "answer",
    answer,
    // The HOME's privilege override (R40) — today's carry rule, keyed by the home now.
    privilege: homeOverride()?.privilege ?? null,
    // The suspended call's own turn mode (ACA-16) — `turnMode` alone can belong to a NEWER
    // interleaved send; the per-call pin survives it. Fallback covers pre-pin persisted bubbles.
    mode: modeByCall[callId] ?? turnMode,
    // …and its active skills (C5-M1), same per-call-pin-over-last-send reasoning as `mode`.
    skills: skillsByCall[callId] ?? turnSkills,
    stream: true,
  });
}

/** Resolve a suspended tool call (the command bubble's execute/dismiss/always-allow) and continue the
 *  turn. `execute_always` (D44 W3) runs the call AND has the server persist an args-exact 'always
 *  allow' grant so future identical calls auto-run — the WHOLE FE grant path is this verb; no settings
 *  write, no rule serialization here (the server owns it). */
export async function resumeCall(
  callId: string,
  decision: "execute" | "execute_always" | "dismiss",
): Promise<void> {
  if (state.status === "streaming" || !state.threadId) return;
  set({ status: "streaming" });
  await streamTurn("/api/agent/resume", {
    thread_id: state.threadId,
    call_id: callId,
    decision,
    confirm_token: confirmTokens[callId],
    // Carry the HOME's privilege override across the resume (A1/D16, R40) so the continuation gates at
    // the same level the suspended turn used — a lowered override can't silently revert to the default.
    privilege: homeOverride()?.privilege ?? null,
    // The suspended call's own turn mode (ACA-16), not the last-send `turnMode` — see answerQuestion.
    mode: modeByCall[callId] ?? turnMode,
    // …and its active skills (C5-M1), pinned per-call for the same reason as `mode`.
    skills: skillsByCall[callId] ?? turnSkills,
    stream: true,
  });
}
