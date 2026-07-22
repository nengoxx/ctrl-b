// Agent chat state (Phase 4a + 4b). Dependency-free external store, same shape as store/ui.ts.
// Chat is not TanStack Query — it's a streaming reducer (DESIGN §13): a single active thread,
// messages appended/patched by id as SSE events arrive. The shared composer and the Agent tab both
// read it. 4b adds the tool-call loop: assistant turns can span multiple messages (a tool step then
// a summary step), tool calls render as command bubbles, and a confirm-gated call suspends the turn
// until `resumeCall(execute|dismiss)` reopens the stream (DESIGN §5.3, §12).

import { clearAudioCache } from "../lib/audioController";
import { currentPlanOf } from "../lib/plan";
import type { Privilege } from "../lib/privilege";
import type { ChatMessage, Part, Plan, PlanStep, RunState, Thread, ToolResult } from "../types";
import { appendDraft, setDraft } from "./composer";
import { createStore } from "./createStore";
import { setConnection } from "./connection";

export type ChatStatus = "idle" | "streaming" | "error";

interface ChatState {
  threadId: string | null;
  messages: ChatMessage[];
  status: ChatStatus;
  streamingId: string | null; // the message currently receiving deltas (drives caret/dots)
  // `/privilege <level>` session override (A1/D16), null → follow the agent's own privilege. Reactive
  // (unlike sessionMode/sessionAgent) so the chip reflects it; session-scoped, so `/clear` keeps it.
  sessionPrivilege: Privilege | null;
}

let state: ChatState = {
  threadId: null,
  messages: [],
  status: "idle",
  streamingId: null,
  sessionPrivilege: null,
};
let loaded = false;
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
// confirmed against. (Not recoverable after a cold reload — skills aren't persisted/snapshotted;
// falls back to `turnSkills`, same known limit as a pre-pin persisted bubble's mode.)
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
// another thread's raw lines into the current composer, and a `/clear` / thread switch prunes the old
// thread's entries wholesale (`dropAllRaw`). entry_ids are server-unique, but the nesting makes the
// pruning trivial + keeps the scoping honest rather than relying on that uniqueness.
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
/** Drop EVERY thread's raw lines — a `/clear` full reset (no queued steer survives it). */
function dropAllRaw(): void {
  for (const k of Object.keys(rawByEntry)) delete rawByEntry[k];
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
    return { ...m, id: messageId ?? m.id, queued: undefined, parts };
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
let streamGeneration = 0;
function claimStream(ctx: TurnCtx): void {
  ctx.gen = ++streamGeneration;
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

// Sticky inference backend for this session, set by a bare `/<provider>` verb (A11/D48 C7). `null` →
// the server's configured default. A `/<provider> <msg>` form forces one message via sendMessage's
// `mode` arg without touching this. Module-level (not reactive). The mode string IS a provider name
// end-to-end (syntax-only validated on the wire); the registry coerces an unknown one → default.
export type ChatMode = string;
let sessionMode: ChatMode | null = null;
export function setSessionMode(mode: ChatMode | null): void {
  sessionMode = mode;
}

// The inference mode the CURRENT turn was sent with (ACA-16 / S2-D). `sendMessage` stashes its derived
// per-turn mode here — a per-message `/cloud <msg>` overrides the sticky `sessionMode` for that one
// turn, so a resume/answer must carry the *turn's* mode, not re-read `sessionMode`. Module-level +
// non-reactive like `sessionMode`/`sessionAgent` (no UI reflects it); a chained resume keeps the
// original turn's mode until the next send overwrites it. `null` → the server's configured default.
let turnMode: ChatMode | null = null;

// The active skills the CURRENT turn was sent with (C5-M1). `sendMessage` stashes the turn's explicit
// `/skill-name` invocations here so a resume/answer can pin them per-call (see `skillsByCall`).
// Module-level + non-reactive like `turnMode`; `null`-equivalent is the empty list.
let turnSkills: string[] = [];

// Sticky agent for this session, set by `/agent <name>` (7d). `null` → the thread's / configured
// default AgentDef. Per-message only (not persisted on the thread) — like sessionMode, a resume
// finishes on the default agent.
let sessionAgent: string | null = null;
export function setSessionAgent(name: string | null): void {
  sessionAgent = name;
}

// Sticky session privilege override, set by `/privilege <level>` (A1/D16). Reactive (lives in
// ChatState) so the PrivilegeChip can render it; `null` → the resolved agent's own privilege.
export function setSessionPrivilege(p: Privilege | null): void {
  set({ sessionPrivilege: p });
}

function set(next: Partial<ChatState>) {
  state = { ...state, ...next };
  emit();
}

export function useChat(): ChatState {
  return useStore(() => state);
}

/** Subscribe to ONE slice of chat state (mirror of `useUISlice`). The store `emit()`s on every streamed
 *  token, so a consumer that needs only `status`/`sessionPrivilege` must NOT use `useChat()` (the whole
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

/** Load the most-recent thread + its history once (on first Agent-tab mount). */
export async function initChat(): Promise<void> {
  if (loaded) return;
  loaded = true;
  // Don't clobber a session already in flight (e.g. local-only /help notes or a send that beat the
  // first Agent-tab mount) — only hydrate history into an empty log.
  if (state.messages.length || state.threadId) return;
  try {
    const threads = (await (await fetch("/api/threads")).json()) as Thread[];
    if (!threads.length) return;
    const t = threads[0];
    const msgs = (await (await fetch(`/api/threads/${t.id}/messages`)).json()) as ChatMessage[];
    set({ threadId: t.id, messages: msgs });
    // D39/M4 cold-load re-attach: the last turn may still be running detached (the mobile
    // app-kill headline case — the socket died, the server-owned task did not). Probe + re-attach
    // AFTER the initial paint (non-blocking, snapshot path so a live turn resumes streaming instead
    // of looking dead). There is NO separate thread-switch path in this SPA (single active thread,
    // most-recent; `initChat` is the only load), so this one seam covers cold load + switch.
    void probeAndReattach(t.id);
  } catch {
    // Backend was down at load time. Reset `loaded` so the next initChat (or the F16
    // reconnect-triggered reloadChat) can retry — otherwise the chat would be stuck empty
    // until a full page refresh.
    loaded = false;
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
  try {
    if (state.threadId) {
      const msgs = (await (
        await fetch(`/api/threads/${state.threadId}/messages`)
      ).json()) as ChatMessage[];
      set({ messages: msgs });
    } else {
      loaded = false;
      await initChat();
    }
  } catch {
    /* still unreachable — next reconnect signal will try again */
  }
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

/** `/clear`: drop back to a fresh, thread-less view. History stays in SQLite; the next send mints a
 *  new thread (the server creates one when `thread_id` is null). */
export function startNewThread(): void {
  // ACA-10 / S2-C: don't clear out from under a live turn — the reset would strand the streaming
  // reply (and the server would 409 the next send onto the abandoned thread). Ask the owner to wait.
  if (state.status === "streaming") {
    pushSystemNote("// a turn is running — stop it or wait before clearing");
    return;
  }
  clearAudioCache(); // 6b-2: revoke this thread's TTS blobs + stop any playback
  lastTurnId = null; // D39: a fresh thread view starts a fresh per-turn event ordering
  lastSeq = 0;
  dropAllRaw(); // FIX C — prune every thread's harvested raw lines (no queued steer survives a /clear)
  lastHarvestSig = null; // FIX E — a fresh view forgets the last harvest receipt (mirrors the backend clear)
  set({ threadId: null, messages: [], status: "idle", streamingId: null });
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
  };
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
    const m = emptyAssistant(`err-${Date.now()}`);
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
const isRunState = (v: unknown): v is RunState =>
  typeof v === "string" && (RUN_STATES as readonly string[]).includes(v);
// A plain object (NOT an array — `typeof [] === "object"`), narrowing the wire value so the fields
// below need no cast and an array can't masquerade as a `data`/`args` record.
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

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

/** A dropped/unknown frame is a bug or transport glitch, not a user-facing event — warn in dev only. */
function dropWarn(event: string, why: string): void {
  if (import.meta.env.DEV) console.warn(`[chat] dropped SSE "${event}": ${why}`);
}

// The canonical "turn already running" text (D38) — the fallback when a 409 body isn't the expected
// `{detail}` shape. Kept in sync with the backend's `_TURN_BUSY_DETAIL`.
const TURN_BUSY_FALLBACK = "a turn is already running on this thread — wait for it to finish";

/** Read the actionable detail off a 409 "turn busy" response (D38). A thread-mutating endpoint that
 *  409s returns `{"detail": "<why>"}`; surface that verbatim, falling back to the canonical text if
 *  the body isn't JSON / lacks a string detail. Used by every non-SSE endpoint + the stream open. */
async function busyDetail(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { detail?: unknown };
    if (typeof j.detail === "string" && j.detail) return j.detail;
  } catch {
    /* non-JSON body → canonical fallback */
  }
  return TURN_BUSY_FALLBACK;
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
        set({ threadId: id });
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
            messages: state.messages.map((m) => (m.id === pid ? { ...m, id, agent } : m)),
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
        skillsByCall[callId] = turnSkills; // …and its active skills (C5-M1)
        setCallState(callId, "awaiting_confirm");
        break;
      }
      case "tool.question": {
        // A2 — the `question` builtin is asking the owner. The prompt is already on the tool_call's
        // args (from part.added); just flip the state so the answer bubble renders its input.
        const callId = nonEmpty(data.callId);
        if (!callId) return dropWarn(event, "missing callId");
        modeByCall[callId] = turnMode; // pin THIS turn's mode for the eventual answer (ACA-16)
        skillsByCall[callId] = turnSkills; // …and its active skills (C5-M1)
        setCallState(callId, "awaiting_answer");
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
      case "message.end":
        break;
      case "error":
        failStream(str(data.message) ?? "agent error");
        ctx.settled = true;
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
): Promise<void> {
  const ctx: TurnCtx = { claimed: !placeholderId, placeholderId, settled: false, gen: -1 };
  const handle = makeTurnReducer(ctx);

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
      return;
    }
    // 202 = the live holder is a chat/resume turn that ACCEPTS a steer (D41): this POST was ENQUEUED,
    // not rejected. Mark the optimistic user bubble QUEUED (keyed by the server's entry_id) and stash
    // its RAW line for a Stop harvest; the live turn keeps the view, so do NOT touch status/streamingId.
    // A `steer.applied` (drain) later swaps it to a normal bubble; Stop harvests it back to the composer.
    if (res.status === 202) {
      const info = (await res.json().catch(() => ({}))) as { entry_id?: string; turn_id?: string };
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
      return;
    }
    if (!res.ok || !res.body) throw new Error(`${url} → ${res.status}`);

    // D17 — buffered (non-streaming) turn: the server returned one JSON payload instead of an SSE
    // stream (agent.streaming=off, or a non-streaming client). The turn already persisted its
    // message, so re-read the thread to render the bot reply + any confirm/question bubble (both
    // render from the persisted call state) — seeding the confirm token from the payload so a
    // buffered confirm stays resumable (it's the one thing not persisted). No parallel render path.
    if (res.headers.get("content-type")?.includes("application/json")) {
      const payload = (await res.json()) as Record<string, unknown>;
      if (payload.threadId) set({ threadId: payload.threadId as string });
      const perm = payload.permission as
        { callId?: string; token?: string; alwaysEligible?: boolean } | undefined;
      if (perm?.callId && perm.token) {
        confirmTokens[perm.callId] = perm.token;
        alwaysEligibleByCall[perm.callId] = perm.alwaysEligible === true; // D44 W3, mirrors the SSE branch
        modeByCall[perm.callId] = turnMode; // buffered confirm: pin the turn's mode too (ACA-16)
        skillsByCall[perm.callId] = turnSkills; // …and its skills (C5-M1)
      }
      // C3-M4: a buffered turn can also suspend on a `tool.question` (no token) — seed its per-call
      // mode + skills too, else a newer send overwriting `turnMode`/`turnSkills` strands the answer
      // with the wrong turn's context. Mirrors the live `tool.question` reducer branch.
      const q = payload.question as { callId?: string } | undefined;
      if (q?.callId) {
        modeByCall[q.callId] = turnMode;
        skillsByCall[q.callId] = turnSkills;
      }
      // Clear the streaming placeholder so reloadChat (which skips while "streaming") runs.
      set({ status: "idle", streamingId: null });
      await reloadChat();
      if (payload.state === "capped")
        pushSystemNote("// reached the step limit — send a message to continue");
      if (payload.state === "error") set({ status: "error" });
      discoverSpawnedSteerTurn(); // D41 §3 — a buffered turn can also leave queued steers to a drain-B turn
      return;
    }

    // D41 — a STEER send (no placeholder) races the turn ending: the marker released before our POST
    // landed, so the server started a FRESH turn and streamed it (200, not 202). Adopt it as a live
    // turn — the reducer's message.start creates the bubble; we just need the view in "streaming" so it
    // renders + the Stop control appears. A normal/resume send is already streaming here (no-op).
    if (getChatStatus() !== "streaming") set({ status: "streaming" });
    // FIX A — this 200 IS the live stream now (a fresh send's own turn, or a steer-race adoption of a
    // just-started turn B). Claim a fresh generation at the adopt point so a stale sibling stream (turn
    // A's trailing `done`) is dropped by the reducer and can never settle status under this turn.
    claimStream(ctx);
    // Reduce the SSE stream through the shared byte-parser (each frame carries `id: turn_id:seq`,
    // fed to the seq gate + the re-attach cursor).
    await parseSSE(res.body, handle);
    // FIX A — if a NEWER stream superseded us mid-reduce (a steer-race adopted turn B on another
    // socket), do NOT settle/re-attach/fail off this now-stale stream: its owner has moved on.
    if (ctx.gen !== streamGeneration) return;
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
      if (!reattached) failStream("connection interrupted");
    } else {
      // D41 §3 — the turn settled cleanly; if queued steers remain, a drain-B turn may have spawned
      // for them (invisible until probed). Discover + re-attach (reuses the D39 probe path).
      discoverSpawnedSteerTurn();
    }
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
    if (ctx.gen >= 0 && ctx.gen !== streamGeneration) return;
    // A THROWN read error (abrupt network loss, TCP reset) is the other half of the drop
    // case — the clean-EOF branch above already re-attaches; this one must too (final-review
    // CONCERN-1: without it a transient blip that recovers in seconds still failStreams a
    // turn that is alive and well server-side). Same fallback ladder: re-attach, else fail.
    if (!ctx.settled && state.status === "streaming") {
      const cursor = lastTurnId ? `${lastTurnId}:${lastSeq}` : undefined;
      const tid = state.threadId;
      const reattached = tid ? await reattachTurn(tid, cursor).catch(() => false) : false;
      if (reattached) return;
    }
    failStream((e as Error).message);
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
  const result = asToolResult(call.result);
  if (perm) {
    const token = str(perm.token);
    if (token) confirmTokens[callId] = token; // ephemeral — the snapshot is the only carrier
    alwaysEligibleByCall[callId] = perm.alwaysEligible === true; // D44 W3: carry the affordance gate across re-attach
  }
  if (result) {
    delete confirmTokens[callId];
    delete modeByCall[callId];
    delete alwaysEligibleByCall[callId];
  } else {
    modeByCall[callId] = mode; // pending call → pin its turn's mode for the eventual resume (ACA-16)
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
      const bubble = emptyAssistant(`sync-${callId}`);
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
  const ctx: TurnCtx = { claimed: true, settled: false, gen: -1 }; // no placeholder — a fresh message.start creates a bubble
  const reduce = makeTurnReducer(ctx);
  // FIX C — the thread this re-attach operates on. Every await below re-checks the view still sits on it
  // (an async re-attach can resolve after a `/clear` or a new-thread switch) and bails before mutating,
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
    try {
      const res = await fetch(url, { headers: { Accept: "text/event-stream" } });
      // C4-M1: a cold-probe re-attach must not attach if a user send flipped us to "streaming" during
      // the fetch await above — a second subscriber whose snapshot would rewind the seq gate
      // mid-stream. Bail BEFORE applying any frame (JSON branch or first SSE frame); close the body.
      if (requireIdle && getChatStatus() === "streaming") {
        await res.body?.cancel().catch(() => {});
        return false;
      }
      // FIX A — from here this re-attach IS the live stream (it survived the requireIdle gate). Claim a
      // fresh generation so a stale sibling stream is dropped, and so our own settle below is guarded.
      claimStream(ctx);
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
        const body = (await res.json()) as { active?: boolean; terminal_status?: string };
        if (!res.ok || body.active !== false) return false;
        // FIX A/C — the `res.json()` awaited: bail if a newer stream superseded us or the owner
        // switched threads, so a stale terminal answer can't settle status under the current view.
        if (ctx.gen !== streamGeneration || state.threadId !== enteredOn) return false;
        // Mirror the live `done` handler's per-state settle so a re-attach landing on a terminal
        // doesn't drop the terminal_status (review fix): `capped` gets the step-limit note; `error`
        // settles to the error status; everything else goes idle as before.
        await reloadChat(true);
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
        return true;
      }
      if (!res.ok || !res.body) return false;
      await parseSSE(res.body, onFrame);
      if (ctx.settled) {
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
 *  (an async probe/re-attach can resolve after a `/clear` or a new-thread send): a stale queue must
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
    // FIX C — the probe awaited; bail if the owner switched threads under us (a `/clear` or a new-thread
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

// Guards a double-tap of Stop: the cancel POST isn't instant, and the button stays mounted until the
// resulting `done{cancelled}` settles status through the attached stream.
let cancelling = false;

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
    appendDraft(lines.join("\n"), "\n");
    lastHarvestSig = sig;
  }
}

/** Stop the running turn (D39/S3-C, D41 §6). While streaming, the composer's send control becomes Stop →
 *  `POST /api/agent/turns/{id}/cancel?turn_id=<scoped>`. On the happy path the server-owned drain task's
 *  CancelledError path emits a `done{state:"cancelled"}` through the ATTACHED stream, which settles
 *  status normally; undrained steers are harvested to the composer. If nothing was live (the stream
 *  already ended / the POST fails), settle from the durable floor so the button never wedges "streaming".
 *
 *  FIX E — three contract behaviours:
 *   • SCOPED MISMATCH (`{cancelled:false, active:true, turn_id:<live>}`): our scoped turn has finished
 *     and a successor is live. The response's `steer_queue` is a READ-ONLY PEEK of the successor's queue,
 *     NOT a harvest — do NOT restore/remove. Adopt the live turn instead (re-attach; its generation
 *     supersedes our stale stream via `streamGeneration`).
 *   • REPLAYED HARVEST (`harvest_replayed:true`): restore is idempotent (`harvestToDraft` signature).
 *   • LOST RESPONSE (the POST/read threw): retry the Stop ONCE — the backend replays the harvest receipt
 *     — before falling back to a durable-floor settle. */
export async function stopTurn(): Promise<void> {
  if (state.status !== "streaming" || !state.threadId || cancelling) return;
  cancelling = true;
  const threadId = state.threadId;
  // A6/C4-H2: scope the cancel to THIS turn (the seq gate's current `lastTurnId`) so a delayed Stop can't
  // cancel/harvest a successor turn — the server refuses/peeks a turn_id that doesn't match the live handle.
  const scopedTurn = lastTurnId;
  try {
    const res = await postCancel(threadId, scopedTurn);
    if (!res.ok) throw new Error(`cancel → ${res.status}`);
    const data = (await res.json()) as CancelResp;
    // SCOPED MISMATCH — a successor turn is live; the peeked queue is NOT ours to harvest. Adopt it.
    if (data.cancelled === false && data.active === true) {
      const ok = await reattachTurn(threadId, undefined, false);
      // Couldn't attach (the successor ended in the gap) → settle from the durable floor.
      if (!ok && state.threadId === threadId) {
        await reloadChat(true);
        set({ status: "idle", streamingId: null });
      }
      return;
    }
    harvestToDraft(threadId, data);
    // No live turn (active:false) → no stream will deliver a `done`, so settle status here. Either way
    // ALWAYS reload from the durable floor: the drain task's cancel path already reconciled the in-flight
    // calls to CANCELLED server-side, but the ATTACHED client's local call parts still render pending —
    // the live-cancel reply carries no active:false to trigger a reload, so without this a stopped-but-
    // attached turn would spin those parts forever. The stream's own `done{cancelled}` still settles.
    if (data.active === false) set({ status: "idle", streamingId: null });
    await reloadChat(true);
  } catch {
    // LOST RESPONSE (socket drop) — retry the Stop ONCE: the backend REPLAYS the harvest receipt, so the
    // harvest is not lost (that is what the receipt is for). `harvestToDraft`'s signature keeps it single.
    try {
      const res = await postCancel(threadId, scopedTurn);
      if (res.ok) {
        const data = (await res.json()) as CancelResp;
        if (!(data.cancelled === false && data.active === true)) harvestToDraft(threadId, data);
        if (data.active === false) set({ status: "idle", streamingId: null });
        await reloadChat(true);
        return;
      }
    } catch {
      /* the retry also failed — fall back to a durable-floor settle below */
    }
    await reloadChat(true);
    set({ status: "idle", streamingId: null });
  } finally {
    cancelling = false;
  }
}

/**
 * Send a user message and stream the assistant turn. Appends the user bubble + an empty assistant
 * placeholder (instant "…" feedback through the slow cold-load), then reduces the SSE turn — which
 * may run tools, suspend on a confirm bubble, or just answer.
 */
export async function sendMessage(
  text: string,
  opts?: { mode?: ChatMode; skills?: string[]; raw?: string },
): Promise<void> {
  const body = text.trim();
  if (!body) return;
  // D41 — the send-while-streaming guard is LIFTED: a send during a live turn is a STEER (enqueued via a
  // 202, drained into the running turn or spawned at its end). Per-message `/cloud <msg>` wins; else the
  // sticky session mode; else the server default (null). Only a FRESH (non-steer) send stashes
  // turnMode/turnSkills — those pin the LIVE turn's resume/answer context (ACA-16/C5-M1); a steer must
  // not re-point them (its own captured params ride the POST for a turn-end spawn instead).
  const steering = state.status === "streaming";
  const mode = opts?.mode ?? sessionMode ?? null;
  const skills = opts?.skills ?? []; // explicit /skill-name invocations (4.5)
  if (!steering) {
    turnMode = mode;
    turnSkills = skills;
  }

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
  };
  const reqBody = {
    text: body,
    thread_id: state.threadId,
    mode,
    skills,
    agent: sessionAgent,
    privilege: state.sessionPrivilege,
    stream: true, // the PWA always prefers streaming; the server's agent.streaming=off can override (D17)
  };
  // The RAW composer line (WITH any `/prefix`) for a Stop harvest — falls back to the body when the
  // caller didn't thread it through (direct sends, retry). Captured before prefix-stripping upstream.
  const raw = opts?.raw ?? body;

  if (steering) {
    // A STEER: append ONLY the user bubble (no assistant placeholder — the live turn owns the stream),
    // leave status/streamingId untouched, and POST. streamTurn's 202 branch marks the bubble queued; a
    // 409 (cap overflow / a sync holder) rolls it back; a 200 (the turn just ended) adopts it live.
    set({ messages: [...state.messages, tempUser] });
    await streamTurn("/api/agent/chat", reqBody, undefined, tempUser.id, raw);
    return;
  }

  const placeholderId = `assist-${Date.now()}`;
  set({
    messages: [...state.messages, tempUser, emptyAssistant(placeholderId)],
    status: "streaming",
    streamingId: placeholderId,
  });
  await streamTurn("/api/agent/chat", reqBody, placeholderId, tempUser.id, raw);
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
  // Codex FIX C — capture the target thread at entry. `/compact` is async; a `/clear`+new-thread in
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
    const data = (await res.json()) as { removed: number; truncated?: boolean; rejected?: boolean };
    // Compaction only shrinks the model's *working* context; the visible chat log keeps the full
    // history (the summary lives server-side for the next turn), so just drop a breadcrumb — same
    // as the auto path. No re-read: that would surface the raw summary mid-log beside the originals.
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
  try {
    const res = await fetch("/api/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, thread_id: state.threadId }),
    });
    if (res.status === 403) {
      pushSystemNote("// shell exec is disabled (Conf → Shell → user exec)");
      return;
    }
    // 409 = the thread's turn marker is held (D38) — busy, not broken; don't fall through to the
    // "backend unreachable" catch (misleading) — surface the server's actionable detail instead.
    if (res.status === 409) {
      pushSystemNote("// " + (await busyDetail(res)));
      return;
    }
    // 202 = a chat/resume turn is live and ACCEPTED this `!cmd` as a queued exec steer (D41). Render an
    // optimistic queued `!cmd` bubble (keyed by entry_id) + stash its raw line for a Stop harvest; the
    // durable tool_call/result pair arrives on a later reload. `steer.applied{kind:exec}` resolves it.
    if (res.status === 202) {
      const info = (await res.json().catch(() => ({}))) as { entry_id?: string; turn_id?: string };
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
    const data = (await res.json()) as { threadId: string };
    if (data.threadId) set({ threadId: data.threadId });
    // FIX B — a 200 means the exec RAN (the marker was free server-side: a live chat/resume turn returns
    // 202, a sync holder 409). A prior stream may still read "streaming" locally (a race where the turn
    // released server-side but our socket hasn't drained), which would make a NON-forced reload skip and
    // hide the persisted exec pair. FORCE the reload — safe here precisely because a 200 guarantees no
    // live server turn to yank.
    await reloadChat(true);
  } catch {
    pushSystemNote("// shell exec failed — backend unreachable?");
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

/**
 * F20 — retry the most recent failed turn (e.g. when the chat SSE dropped mid-stream because
 * of a network flake or backend restart). Re-runs the user's last message from scratch.
 *
 * Not a byte-level resume: the partial assistant work (intermediate tool results, half-written
 * replies) from the failed turn is discarded. The matching backend "resume" endpoint
 * (/api/agent/resume) is specifically for confirm-gated suspension; there's no
 * resume-from-drop endpoint. Phase B (server-side Last-Event-Id) would close that gap but is
 * not in this slice.
 *
 * Walks back to the user message that started the failed turn, truncates the message log to
 * before it, and re-runs. **I4 — risk-aware retry:** if the failed turn ran any *non-retry-safe*
 * tool (mutating + non-idempotent — reboot/restart/run_shell/spawn/memory), we do NOT auto-resend
 * (a re-run could silently repeat it). Instead we copy the message to the composer draft for a
 * conscious re-send. A read-only/idempotent turn auto-resends as before. `isRetrySafe(tool)` is
 * supplied by the caller from the action catalog (an unknown tool → treated as unsafe).
 *
 * No-op while streaming (you'd be double-firing). The button is only rendered on the LAST
 * message when status === "error", so this should never see a non-error tail.
 */
export function retryLastTurn(isRetrySafe: (tool: string) => boolean): void {
  if (state.status === "streaming") return;
  const lastIdx = state.messages.length - 1;
  const last = state.messages[lastIdx];
  if (!last || last.role !== "assistant") return;
  const errPart = last.parts.find((p) => p.type === "error");
  if (!errPart || errPart.type !== "error" || !errPart.retryable) return;
  // Walk back to the user message that started this turn.
  let userIdx = lastIdx - 1;
  while (userIdx >= 0 && state.messages[userIdx].role !== "user") userIdx--;
  if (userIdx < 0) return;
  const userMsg = state.messages[userIdx];
  const textPart = userMsg.parts.find((p) => p.type === "text");
  if (!textPart || textPart.type !== "text") return;

  // Did the failed turn (the assistant message[s] after the user message) run a non-retry-safe tool?
  const turn = state.messages.slice(userIdx + 1);
  const ranUnsafe = turn.some((m) =>
    m.parts.some((p) => p.type === "tool_call" && !isRetrySafe(p.tool)),
  );

  // Truncate to just before the user message — the retry starts fresh either way.
  set({ messages: state.messages.slice(0, userIdx), status: "idle", streamingId: null });

  if (ranUnsafe) {
    // Don't auto-repeat a side effect: hand the message back to the composer for a conscious re-send.
    setDraft(textPart.text);
    pushSystemNote("// last turn ran an action — review the message and send again to retry");
    return;
  }
  void sendMessage(textPart.text);
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
    privilege: state.sessionPrivilege,
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
    // Carry the session privilege across the resume (A1/D16) so the continuation gates at the same
    // level the suspended turn used — a lowered session can't silently revert to the agent default.
    privilege: state.sessionPrivilege,
    // The suspended call's own turn mode (ACA-16), not the last-send `turnMode` — see answerQuestion.
    mode: modeByCall[callId] ?? turnMode,
    // …and its active skills (C5-M1), pinned per-call for the same reason as `mode`.
    skills: skillsByCall[callId] ?? turnSkills,
    stream: true,
  });
}
