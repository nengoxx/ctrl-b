// THE EAR, HANDED OVER (Phase 24 / D74 S6 ⑧) — one slot, so a starting call can take the microphone
// from a live dictation BEFORE it opens its own.
//
// WHY IT HAS TO EXIST. A capture that is already live PINS the platform's echo-cancellation mode for
// the next one on the same device (R78 §2.3): Chromium resolves the mode from the enumeration-time
// effects mask, and an existing source on that device decides it. Since D73 the two features can ASK
// for different things — dictation on the Conf route, a call on whatever the call screen is set to —
// so two overlapping captures means one of them silently gets the other's AEC, with a readback that
// is honest about a mode nobody asked for. Stop, then open; never both open at once.
//
// WHY A STORE AND NOT A PROP (the `micCancel.ts` reasoning, one surface over): the recorder lives in
// `useDictation`, inside the composer's tree, and the call machine lives in the overlay mounted at
// the shell root. A module-level slot is the smallest thing that joins them.
//
// NO `createStore` HERE, deliberately: nothing RENDERS off this. It is an imperative handover, the
// shape `store/composer`'s `getDraft` and `store/liveCall`'s `callLive` already use — a subscription
// would buy a re-render nobody wants.
//
// LAST WRITER WINS, and that is safe by construction: there is exactly ONE recorder in the app
// (`useDictation`'s own rule), so there is only ever one publisher.

let release: (() => Promise<void>) | null = null;

/** Offer `fn` as the way to make the microphone free again, or `null` to withdraw the offer. The
 *  publisher withdraws on unmount, so a dead composer can never leave a live handover behind. */
export function setMicRelease(fn: (() => Promise<void>) | null): void {
  release = fn;
}

/**
 * Ask whoever holds the microphone to let go, and WAIT for it.
 *
 * Resolves immediately when nobody does, which is the ordinary case. It never REJECTS: a call must
 * not fail to start because the thing it was taking the ear from had a bad day — and the acquisition
 * on the other side of this await is what reports a microphone that will not open, in the owner's
 * own words.
 */
export async function releaseMic(): Promise<void> {
  try {
    await release?.();
  } catch {
    // See above: the caller's own failure path is the one that speaks.
  }
}
