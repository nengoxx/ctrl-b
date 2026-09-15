// THE UPLINK PACER (Phase 24 / D71 §3.1 · §7-S2.5; the intermission wave, evidence docs/research/R71) —
// the ONE meter both consumers of `WS /api/voice/live` ship microphone audio through.
//
// Two hooks feed the same relay: streaming dictation (`useDictation`) and the call (`useLiveCall`). S2.5
// built this bucket for the first, and the second shipped every frame the instant the worklet handed it
// over — one relay, two uplink DISCIPLINES, which is the ownership defect class this subsystem names
// everywhere else. The arithmetic lives here now; each caller only says which BACKLOG RULE it lives
// under, and dictation's behaviour is unchanged by the move (the functions are the ones it had).
//
// WHY A CLOCK AND NOT A PER-CALLBACK RATIO (S2.5 review F5): the worklet's MessagePort deliveries QUEUE
// while the main thread is stalled (heavy jank, a large decode, an app-switch race) and then dispatch in
// one burst, so anything paced per CALLBACK ships at dispatch speed — fifty queued callbacks are fifty
// sends in one tick, straight through the relay's rolling window and into a protocol close mid-session
// (`services/voice_live.py::_note_frame`). A budget earned from `performance.now()` cannot be outrun by a
// burst: the burst carries no wall clock with it.
//
// THE TWO BACKLOG RULES, and the difference between them is a CLOCK (R71 §5.3):
//   · LOSSLESS (`enqueue` — dictation). A phrase that reaches the draft late is still the owner's words
//     in the right place; losing one is the only real failure. Dictation bounds its queue by throwing the
//     whole LEG away at `buffered_ceiling_ms` (the clip underneath still carries every word), so nothing
//     here has to drop a frame for it.
//   · DROP-OLDEST at a ms bound (`enqueueBounded` — the call). A call has a clock on BOTH sides, so late
//     audio is not merely late, it is WRONG: it endpoints a turn the owner has moved past and makes
//     barge-in decisions on an old world. The relay already bounds its own queue exactly this way
//     (`relay_queue_ms`, drop-oldest, one `degraded` per burst), so a lossless client bucket would not
//     prevent the loss — it would RELOCATE it to where the owner cannot see it, later and less visibly.
//
// OWNERSHIP: a pacer belongs to ONE leg. Both callers make a fresh one per leg and drop it with the leg,
// because a bucket that outlived its socket would carry the old session's banked budget — and its queued
// audio — into a session that knows nothing about either.

/** How much audio-time the queue earns per millisecond of WALL CLOCK. 1.5× realtime sustained clears a
 *  full ceiling of backlog in a couple of seconds while staying under the relay's own budget with margin:
 *  `_note_frame` closes the leg past 2× realtime in a rolling 2 s window, and draining at exactly 2×
 *  would sit ON that bound, where one retained boundary frame is a protocol close.
 *
 *  Do NOT raise it to "catch up" (R71 §5.6): the catch-up lever is the CAP, not the rate — the field's own
 *  answer to a deep backlog is time-compression, which we cannot use because the ear transcribes what we
 *  send. */
export const DRAIN_PACE = 1.5;

/** …and the bucket's CEILING, which is what bounds a post-stall burst. The most the wire can take in one
 *  dispatch is `BUCKET_CAP_MS` of banked audio, so over any rolling relay window the total is at most
 *  `cap + DRAIN_PACE × window`. Against the relay's 2 s window that is 500 + 1.5×2000 = 3500 ms under its
 *  2×-realtime budget of 4000 ms — and the same margin holds for its FRAME-count budget at any `frame_ms`,
 *  because both sides scale by the frame size (3500/frame_ms frames against an allowance of
 *  4000/frame_ms). */
export const BUCKET_CAP_MS = 500;

/** One leg's pacer: the FIFO its frames wait in, oldest first, and the wall-clock bucket that empties it.
 *
 *  ONE QUEUE CARRIES EVERY PHASE (S2.5 review F5) — the handshake's buffer and every live frame — because
 *  audio ORDER is the contract, and a second path for "the live frame" is how a dispatched burst gets to
 *  overtake the backlog. */
export interface PacerState {
  backlog: ArrayBuffer[];
  /** Audio-time the uplink may ship right now, and the `performance.now()` the last grant was measured
   *  from. A pacer starts EMPTY: budget banked across a slow handshake would be spent in one dispatch,
   *  which is the very burst the cap exists to bound. */
  budgetMs: number;
  lastTick: number;
}

/** A fresh pacer for a fresh leg, its clock starting now and its budget at zero (see `budgetMs`). */
export function newPacer(): PacerState {
  return { backlog: [], budgetMs: 0, lastTick: performance.now() };
}

/** THE LOSSLESS ENQUEUE — dictation's rule: every frame waits its turn, however deep the queue gets. Its
 *  caller owns what happens when that is too deep (the `buffered_ceiling_ms` leg abort), which is a
 *  decision about the LEG rather than about a frame. */
export function enqueue(s: PacerState, buf: ArrayBuffer): void {
  s.backlog.push(buf);
}

/** THE BOUNDED ENQUEUE — the call's rule: never hold more than `boundMs` of audio, and lose it from the
 *  HEAD (the relay's own `_enqueue(drop_oldest=True)` posture, R71 §5.4 — not RVC's drop-newest, which
 *  discards exactly the phrase end the endpointer needs).
 *
 *  RETURNS WHETHER ANYTHING WAS DROPPED, so the caller can report it the way the relay does: once per
 *  overflow BURST, not once per frame (`voice_live.py::_overflow_flagged`). The length guard is
 *  load-bearing rather than defensive: without it a bound that ever read below zero would spin on an
 *  empty array. */
export function enqueueBounded(
  s: PacerState,
  buf: ArrayBuffer,
  frameMs: number,
  boundMs: number,
): boolean {
  s.backlog.push(buf);
  let dropped = false;
  while (s.backlog.length > 0 && s.backlog.length * frameMs > boundMs) {
    s.backlog.shift();
    dropped = true;
  }
  return dropped;
}

/** Earn audio-time from the WALL CLOCK. Always paired with `pump` — `accrue` is what the burst cannot
 *  outrun, `pump` is what spends it. */
export function accrue(s: PacerState): void {
  const now = performance.now();
  s.budgetMs = Math.min(BUCKET_CAP_MS, s.budgetMs + (now - s.lastTick) * DRAIN_PACE);
  s.lastTick = now;
}

/** …and spend it on the head of the FIFO. `send` is the leg's own `sendAudio`: this module never holds a
 *  socket, so a pacer cannot outlive one or ship into the wrong leg. */
export function pump(s: PacerState, frameMs: number, send: (buf: ArrayBuffer) => void): void {
  while (s.backlog.length > 0 && s.budgetMs >= frameMs) {
    const head = s.backlog.shift();
    if (head) send(head);
    s.budgetMs -= frameMs;
  }
}
