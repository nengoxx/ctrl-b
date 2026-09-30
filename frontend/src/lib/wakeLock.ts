// THE SCREEN WAKE LOCK (Phase 26 SP · P3, ASR_PLAN §3.9 ③ — T-12) — the ONE acquisition both hooks that
// hold the microphone in the foreground take: the call (`useLiveCall`, since D73 S6) and dictation
// (`useDictation`, since SP — the owner's R21 P3: a screen that slept mid-dictation took the dictation
// with it, since a hidden page stops a streaming one).
//
// LIFTED, NOT REWRITTEN: the body is the call's own `takeWakeLock` and its teardown's release, moved
// here verbatim with the one thing that was the call's alone PARAMETERIZED — the fence that decides
// whether a sentinel resolving LATE still belongs to what asked for it. The call fences on its
// generation + a non-terminal phase; dictation on "this recording is still the current one". Each
// caller captures its own identity in the `stillWanted` closure, so nothing here knows what a call or a
// recording is.
//
// EACH HOLDER OWNS ITS OWN `WakeLockState`. Two holders are two sentinels, and the platform keeps the
// screen on while ANY is held — so a call opening while a dictation hands the ear over (`yieldMic`)
// takes its own lock and the dictation releases ONLY its own (the handover order, T-12). Feature-
// detected, never UA-sniffed: a browser without the API keeps its ordinary screen behaviour.

/** One holder's lock: the sentinel it holds (or null), and whether a request is in flight. Mutated in
 *  place by the two functions below — a ref's `.current` in both hooks. */
export interface WakeLockState {
  lock: WakeLockSentinel | null;
  /** One request in flight at a time (A1): a holder that re-takes (the call, on every return to the
   *  foreground) would otherwise leave the loser of two overlapping requests held by nothing that can
   *  release it. */
  pending: boolean;
}

export function newWakeLockState(): WakeLockState {
  return { lock: null, pending: false };
}

/** Take the screen lock for `state`'s holder. Idempotent: a lock still held, or one already being
 *  requested, is not re-requested.
 *
 *  @param stillWanted evaluated when the request RESOLVES — `false` releases the fresh sentinel at once
 *  instead of storing it. The CALLER captures its identity in the closure (the call's generation, the
 *  recording's recorder), because a lock resolving after its owner ended must never become the NEXT
 *  owner's sentinel: a stale one makes the re-take guard above skip the acquisition the fresh owner
 *  actually needs (S6 code-review F2). */
export function takeWakeLock(state: WakeLockState, stillWanted: () => boolean): void {
  if (state.pending) return;
  if (state.lock !== null && !state.lock.released) return;
  // The request is taken BEFORE the latch is set, deliberately: an optional chain that found no API
  // short-circuits the `then`/`catch` with it, and a latch armed on a promise that will never settle
  // would refuse every later attempt for the life of the holder.
  // (Explicit `=== undefined`, never a truthiness test: a Promise in a boolean conditional is the
  // `no-misused-promises` trap, and the same line is written this way in `useForegroundNotifications`.)
  const request: Promise<WakeLockSentinel> | undefined = navigator.wakeLock?.request("screen");
  if (request === undefined) return;
  state.lock = null;
  state.pending = true;
  void request
    .then((lock) => {
      state.pending = false;
      if (!stillWanted()) void lock.release().catch(() => {});
      else state.lock = lock;
    })
    .catch(() => {
      state.pending = false;
    });
}

/** Give the holder's lock back: the slot is emptied first (so a re-take sees nothing held), then the
 *  sentinel released — a rejection (already released by the platform on a hidden page) is swallowed.
 *  A request still in flight is NOT cancelled here — the API has no cancel — its `stillWanted` fence is
 *  what releases it when it lands. */
export function releaseWakeLock(state: WakeLockState): void {
  const lock = state.lock;
  state.lock = null;
  void lock?.release().catch(() => {});
}
