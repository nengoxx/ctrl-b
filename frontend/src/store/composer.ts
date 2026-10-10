// Persistent drafts for the shared composer textarea. Solves two problems at once:
//   1. The composer is conditionally rendered (`{showComposer && <Composer />}` in App.tsx) —
//      switching to Conf/Utils unmounts it, which discards whatever was in the textarea if
//      the value lived in component-local state or the DOM ref. Hoisting the draft into a
//      store keeps it alive across that unmount.
//   2. Refreshing the page (or closing/reopening the PWA) used to clear the draft too. By
//      persisting to localStorage we survive a full reload as well.
//
// ONE DRAFT PER CONVERSATION (Phase 27 S8, D84 §6 R31/R34/R35). This header used to say "single global
// slot … if per-thread drafts ever become a real need, add a `Record<threadId, string>`; the seam is
// the store shape, not the consuming component" — that change happened under D84, exactly there: the
// drafts are keyed by THREAD ID (`""` = the thread-less view), the current SLOT is the view's
// conversation, and every public function keeps its signature and acts on the current slot — so
// `useComposer`, `lib/composer`, `useLiveCall` and the composer surfaces did not change. The slot is
// set by `setComposerSlot`, which `store/chat` calls wherever the view's `threadId` is written (its
// three identity writers, §12.3 H2) and which the staged rail (`store/attachments`) mirrors. This
// module is also the FACADE over both per-conversation stores: `moveSlots` (E6 + the `""` move) and
// `pruneSlots` (the boot prune) carry a conversation's draft and rail together.
//
// Dependency-free external store on the shared `createStore` binding + `persist` helpers (D23),
// same shape as store/ui.ts.

import { moveRail, pruneRails, railEmpty, setRailSlot } from "./attachments";
import { createStore } from "./createStore";
import { isRecord, loadPersisted, patchPersisted } from "./persist";

const KEY = "ctrlb.composer";

/** THE LOAD-BOUNDARY FOLD: `{drafts: {<thread id | "">: string}}`, with the legacy single draft
 *  `{draft}` under `""` (unless `""` already has one). Applied at load AND to the fresh blob inside
 *  every write — so the first write after an upgrade carries the legacy draft over instead of deleting
 *  it with the old key — and type-guarded entry by entry (a non-string or empty entry is dropped). The
 *  old shape is never written back: every write deletes `draft`. */
function foldDrafts(blob: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (isRecord(blob.drafts))
    for (const [k, v] of Object.entries(blob.drafts)) if (typeof v === "string" && v) out[k] = v;
  if (typeof blob.draft === "string" && blob.draft && !("" in out)) out[""] = blob.draft;
  return out;
}

const { emit, useStore } = createStore();
/** Every conversation's draft (an empty draft has no key). */
let drafts: Record<string, string> = foldDrafts(loadPersisted<Record<string, unknown>>(KEY, {}));
/** The view's conversation (`""` thread-less) — not persisted; set only through `setComposerSlot`. */
let slot = "";

/** Write the given entries (`""` deletes one) — memory, then ONE `patchPersisted` that changes only
 *  those entries of the freshly read map (§12.3 M4: two tabs race only on the same conversation's
 *  draft; a stale sibling another tab wrote survives). */
function writeDrafts(entries: Record<string, string>): void {
  const next = { ...drafts };
  for (const [k, v] of Object.entries(entries)) {
    if (v) next[k] = v;
    else delete next[k];
  }
  drafts = next;
  patchPersisted(KEY, (stored) => {
    const kept = foldDrafts(stored);
    for (const [k, v] of Object.entries(entries)) {
      if (v) kept[k] = v;
      else delete kept[k];
    }
    return { draft: undefined, drafts: kept };
  });
  emit();
}

export function setDraft(draft: string): void {
  // No-op guard: skip the localStorage round-trip + emit when nothing changed.
  // Belt-and-braces — onChange normally only fires on real change anyway.
  if ((drafts[slot] ?? "") === draft) return;
  writeDrafts({ [slot]: draft });
}

export function clearDraft(): void {
  setDraft("");
}

/** How dictated phrases join — the ONE rule, read by `appendDraft`'s default and by dictation's held
 *  `max_segment` text (S7a), which joins its parts before the single append. */
export const PHRASE_JOIN = " ";

/** Append text to a draft, separated from existing content by `separator` (Phase 6b dictation
 *  hand-off; the D41 Stop-harvest passes `"\n"` to newline-join restored steer lines). Defaults to a
 *  space so a dictated transcript lands after whatever the user already typed rather than clobbering it.
 *  `target` is the conversation whose draft it is (Phase 27 S8) — the CURRENT slot when omitted; a
 *  writer that belongs to another conversation names it: a harvest its own thread, a left send's
 *  return its ORIGIN, a dictation the slot it started in (R35). Reads state imperatively (no stale
 *  closure). Empty input → no-op. */
export function appendDraft(text: string, separator = PHRASE_JOIN, target = slot): void {
  const add = text.trim();
  if (!add) return;
  const live = followSlot(target); // a writer still holding a MOVED slot writes where it went (S8-03)
  const cur = (drafts[live] ?? "").trimEnd();
  writeDrafts({ [live]: cur ? `${cur}${separator}${add}` : add });
}

/** Read the current draft imperatively (non-reactive) — for callers outside render that need the live
 *  value without a stale closure (e.g. the mic auto-send path reading what it just appended). */
export function getDraft(): string {
  return drafts[slot] ?? "";
}

/** Read the current composer draft. Survives tab-switch unmount + full page reload. */
export function useDraft(): string {
  return useStore(() => drafts[slot] ?? "");
}

/** The current slot (`""` = the thread-less view) — what a dictation captures when it starts (R35). */
export function composerSlot(): string {
  return slot;
}

/** THE FORWARD MAP (S8 fix wave — Sol S8-03, Opus F1/F4): every conversation `moveSlots` emptied, to
 *  the one its content went to. A writer that captured a slot BEFORE it moved — a streaming leg that
 *  started in `""` when a lazy mint or a door moved `""` into X, a clip pending for a conversation E6
 *  carried away — still names the old slot; `appendDraft` follows the chain, so its words join the
 *  moved draft instead of re-creating a key nobody sees (and the next boot prunes). An entry ends when
 *  the view enters its key again: from then on that slot is live (a fresh thread-less view's `""`). */
const movedTo = new Map<string, string>();

/** Where `k`'s words go now — `k` itself unless it was moved (the chain followed, cycle-safe). Read by
 *  `appendDraft`. */
export function followSlot(k: string): string {
  const seen = new Set<string>();
  for (let to = movedTo.get(k); to !== undefined && !seen.has(k); to = movedTo.get(k)) {
    seen.add(k);
    k = to;
  }
  return k;
}

/** The conversation the owner's own Send LAZILY MINTED from the thread-less view (`setWireThread`'s
 *  `mint` flag) while the view is still on it — `null` after any other transition. Not the forward map:
 *  a door from `""` into an empty conversation forwards `""` too, and a door is a hop (Opus N1). */
let threadlessMint: string | null = null;

/** DICTATION'S AUTO-SEND GATE (§12.1 ④ as amended): may a recording that STARTED in `start` auto-send
 *  into the view on screen? Only when the view is still there, or when it started thread-less and the
 *  view is the conversation the owner's own Send lazily minted from it (the view never left). A door —
 *  a roster row, `/new`, a sheet row — is a hop and never sends; neither does a slot an E6 CARRY moved
 *  (involuntary — its words wait, visible, in the opened conversation's draft). */
export function sendsInView(start: string): boolean {
  return start === slot || (start === "" && threadlessMint === slot);
}

/** E6's PENDING CARRY (S8 fix wave — Opus F2): the deleted conversation a move off it has STARTED for
 *  (`carryOnLeave`), consumed by the first slot change to any other conversation — so the carry lands in
 *  whatever actually opened (the fallback's target, or the owner's own door that superseded it), and a
 *  fallback that failed leaves it armed for the next door. */
let pendingCarry: string | null = null;
/** …the last carry's completion (it waits for a stopped dictation's words first, L7). */
let carrying: Promise<void> = Promise.resolve();

/** Arm the E6 carry off `from` (D84 §6 "Deleted elsewhere") — `store/chat`'s R29 fallback, N3, the
 *  roster sweep's M7 move and the boot's H7 arm call it as their move STARTS. */
export function carryOnLeave(from: string): void {
  pendingCarry = from;
}

/** Resolves when the last E6 carry has moved its slots — the boot prune waits for it (H7 before ⑦). */
export function slotsCarried(): Promise<void> {
  return carrying;
}

/** Does conversation `k` hold nothing — no draft, no chip — in this tab's memory AND in fresh storage
 *  (Qwen F1: another tab may have drafted there since this one loaded; the `""` move must never write
 *  over it)? Read only at the `""` → conversation transition. */
function slotEmpty(k: string): boolean {
  return (
    !drafts[k] && !foldDrafts(loadPersisted<Record<string, unknown>>(KEY, {}))[k] && railEmpty(k)
  );
}

/** THE SLOT SETTER (Phase 27 S8, §12.3 H2) — ONE, called by `store/chat` wherever the view's `threadId`
 *  is written (`swapView`, `setWireThread`, `loadThread`) with `threadId ?? ""`; the rail mirrors it.
 *
 *  THE THREAD-LESS `""` MOVE (§6, §12.4 Q6), implemented HERE once rather than per door: on a
 *  transition from `""` to a conversation whose slots are EMPTY, `""`'s draft + rail move in — the lazy
 *  mint, `mintAndOpen`, and an EXISTING conversation opened from the thread-less view through any door
 *  (a roster door, a sheet row, the boot's cold load from the initial thread-less state). A target that
 *  already holds content keeps its own and `""` keeps its own: nothing is merged unasked.
 *
 *  …and the armed E6 carry (`carryOnLeave`) runs on the first change to another slot: AFTER a stopped
 *  streaming dictation's words have landed in their origin (§12.3 L7 — the swap stopped it first), the
 *  dead conversation's draft + rail move into `next`. */
export function setComposerSlot(next: string, mint = false): void {
  const prev = slot;
  if (prev === next) return;
  slot = next;
  threadlessMint = prev === "" && mint ? next : null; // only `setWireThread`'s lazy mint passes `mint`
  movedTo.delete(next); // the view is here: this slot is live again
  setRailSlot(next);
  // (Run even when `""` is empty: the move then carries nothing but still FORWARDS `""` to `next` — a
  // locked dictation whose Send just cleared `""` and lazily minted `next` keeps landing there, F1.)
  if (prev === "" && slotEmpty(next)) moveSlots("", next);
  const from = pendingCarry;
  if (from !== null && from !== next) {
    pendingCarry = null;
    carrying = stopLiveDictation().then(() => moveSlots(from, next));
  }
  emit();
}

/** CARRY one conversation's draft + rail into another (D84 §6 "Deleted elsewhere", E6; and the `""`
 *  move): `from`'s draft is appended AFTER `to`'s own, separated by a blank line; `from`'s chips are
 *  appended to `to`'s rail with their ids and status (`store/attachments#moveRail`); `from`'s keys go,
 *  and `from` FORWARDS to `to` (`followSlot`) for every writer still holding it. Called by
 *  `setComposerSlot` (the `""` move; the armed E6 carry of the R29 fallback, N3, the call's teardown
 *  runner, the roster sweep's M7 move and the boot's H7 arm). S9's sheet delete of the OPEN
 *  conversation (B8) carries through the same fallback; its delete of a NON-open row drops that
 *  conversation's slots instead (`pruneSlots`, the seam). */
export function moveSlots(from: string, target: string): void {
  // The destination as it is NOW (Sol's confirm): a carry deferred behind a stopped dictation may
  // execute after its target itself moved on (`""` → X) — draft and rail then both land in X.
  const to = followSlot(target);
  if (from === to) return;
  // AN ALREADY-CARRIED SOURCE KEEPS ITS FORWARD (S9b micro-wave — Sol S9B-05). Predicate: `from` is
  // already forwarded AND holds nothing (no draft, an empty rail) — its content left with that earlier
  // move, so its late writers (a dictation final, a clip transcript) must follow the CONTENT, not be
  // retargeted to wherever a later, empty move points. (Nothing to move either, so nothing else runs.)
  if (movedTo.has(from) && !drafts[from] && railEmpty(from)) return;
  movedTo.set(from, to);
  const carried = drafts[from];
  if (carried) {
    const own = (drafts[to] ?? "").trimEnd();
    writeDrafts({ [from]: "", [to]: own ? `${own}\n\n${carried}` : carried });
  }
  moveRail(from, to);
}

/** THE BOOT PRUNE (§12.2 ⑦, §12.3 L6) — drop every conversation's draft + rail whose key `keep` refuses,
 *  from memory and from storage (a key only storage holds included: a conversation deleted on another
 *  device that this one only ever drafted in never 404s here). The caller (`store/chat#initChat`) keeps
 *  `""`, every listed thread (archived included) and the open view's key. */
export function pruneSlots(keep: (slot: string) => boolean): void {
  const dead = Object.keys(drafts).filter((k) => !keep(k));
  const storedDead = Object.keys(
    foldDrafts(loadPersisted<Record<string, unknown>>(KEY, {})),
  ).filter((k) => !keep(k));
  if (dead.length || storedDead.length)
    writeDrafts(Object.fromEntries([...dead, ...storedDead].map((k) => [k, ""])));
  pruneRails(keep);
}

// ── the live streaming dictation's stop (Phase 27 S8 — §12.2 ④, §12.3 L7) ──────────────────────────
// The recorder is global, so a view swap while a STREAMING dictation is live would leave a hot mic in the
// new view whose words land elsewhere. Every swap stops it first; its finals land in the slot it started
// in (R35). ONE registration (the `onThreadListsStale` shape): `hooks/useDictation` registers its stopper
// while a streaming session is live and unregisters when the session's release has finished.

/** A live dictation's stopper: stop the recording with this reason, and resolve when its leg's words
 *  (finals, or the clip that replaces them) have landed in the slot it started in. */
export type LiveDictationStop = (reason: "navigated") => Promise<void>;
let liveStop: LiveDictationStop | null = null;
/** The stop in flight and the REGISTRATION it stopped — every caller while that same leg is being
 *  stopped shares it (the swap starts it, the E6 carry awaits the same one), so a leg is stopped once;
 *  a newer leg's registration clears it, so a second swap stops the newer leg (Sol S8-04). Whoever
 *  awaited the old stop still holds its promise. */
let stopping: { stop: LiveDictationStop; done: Promise<void> } | null = null;

/** Register the live streaming dictation's stopper — returns the unregister (only ever removes its own). */
export function registerLiveDictation(stop: LiveDictationStop): () => void {
  liveStop = stop;
  stopping = null;
  return () => {
    if (liveStop === stop) liveStop = null;
  };
}

/** Stop the live streaming dictation, if one is up — `store/chat#swapView` calls it FIRST on every swap
 *  — and resolve when its words have landed in their origin slot (at once when none is live). The E6
 *  carry awaits it before moving a slot (L7), so a stopped leg's finals are carried too. */
export function stopLiveDictation(): Promise<void> {
  const stop = liveStop;
  if (!stop) return Promise.resolve();
  if (stopping?.stop === stop) return stopping.done;
  const done: Promise<void> = stop("navigated")
    .catch(() => {}) // a stopper that throws must never wedge a carry waiting on it
    .finally(() => {
      if (stopping?.done === done) stopping = null;
    });
  stopping = { stop, done };
  return done;
}
