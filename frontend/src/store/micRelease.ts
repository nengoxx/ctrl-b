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

// THE TAB'S ONE WANTED LEG (Phase 26 D5, ASR_PLAN §3.9 ④) — beside the ear's slot, because it is the
// same handover one step later. Since D5 the relay keys its session slot by the TAB (`liveClientId`):
// a newer leg from this tab SUPERSEDES the holder, so a dictation leg still in its release (flush → tail
// wait → close) would lose its tail phrase to the next leg this tab opens — a recording or a call. The
// relay can only trust "same id ⇒ the holder is stale" while this tab never opens a leg beside one of
// its own that is still wanted, and THIS is where that is kept: a promise that settles at the closing
// leg's `close()`, or null.
//
// MODULE SCOPE ON PURPOSE: the release survives its composer's unmount (`useDictation`'s `finishStream`
// runs to completion — Conf/Utils unmount the composer), and the id is per TAB, so the latch must
// outlive the hook instance that set it. A remounted hook's `start()` reads it here (`legClosing`), and
// `releaseMic` waits it out whether or not any composer is mounted to publish a `release`.
let closing: Promise<void> | null = null;

/** A dictation leg has started closing out (its recorder stopped, its release running): hold the tab's
 *  next leg until it has. Returns the ONE idempotent settle — call it the moment that leg is closed (and
 *  again as a belt when the release returns or throws: a latch left standing would refuse every
 *  recording and park every call on this page). A newer hold replaces an older one; an older settle
 *  never clears a newer hold. */
export function holdLeg(): () => void {
  let settle = (): void => {};
  const p = new Promise<void>((res) => {
    settle = res;
  });
  closing = p;
  return () => {
    if (closing === p) closing = null;
    settle();
  };
}

/** Is a leg of this tab still closing out? `useDictation.start()` refuses while it is. */
export function legClosing(): boolean {
  return closing !== null;
}

/** TESTS ONLY — drop a hold a finished case left standing (a release parked on a fake clock that the
 *  case never ran out), so the next case starts with no leg closing. Never called by the app. */
export function resetLegHold(): void {
  closing = null;
}

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
 *
 * …AND (Phase 26 D5) only once no leg of this tab is closing out (`holdLeg`): the call's first leg
 * carries the tab's `client_id` and would supersede a dictation leg still waiting for its tail. The
 * microphone itself is back at the recorder's `onstop`; the relay's slot is back at the leg's close —
 * ≤ `tail_wait_ms` + the drain bound later. Read AFTER the release resolves: `onstop` frees the ear and
 * raises the hold in the same synchronous callback, so the hold is up by the time this continues.
 */
export async function releaseMic(): Promise<void> {
  try {
    await release?.();
  } catch {
    // See above: the caller's own failure path is the one that speaks.
  }
  const leg = closing;
  if (leg) await leg;
}
