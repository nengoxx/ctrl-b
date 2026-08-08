import { useCallback, useEffect, useRef, useState } from "react";

import { useUISlice } from "../../store/ui";

// THE CEREMONY RUNNER (GACHA_PLAN §12.6 ruling 10 / R24 §B.3) — a short, skippable sequence of timed BEATS.
// The alt fleet layouts dramatize a request with one: the poster's wake parts the stack and sweeps a
// flashline (E1), the cover's promote and develop follow at E2. This is the React-idiomatic port of the
// lab's `runCeremony` (`design/prototypes/gacha/alt-fleet-finalists/app.js`), and it exists as a hook — not
// as three hand-rolled `setTimeout` chains in three components — because the three hard parts are the same
// every time: the motion gate, tap-anywhere-skip, and never leaking a timer.
//
// THREE RULES IT OWNS, each of which the lab's version got right and a hand-rolled one gets wrong:
//
//  1. THE MOTION GATE IS `UIState.motion`, NEVER an OS media query. The lab's `matchMedia("(prefers-
//     reduced-motion)")` is prototype scaffolding; this app models the preference itself (the Appearance
//     Switch → `body[data-motion]`), and an OS query beside it is the repo's named parallel-implementation
//     trap. Under `reduced` the beats do not shrink — they COLLAPSE: every beat fires at once, so the
//     ceremony lands on its end state instantly and whatever it announces is still announced.
//  2. TAP-ANYWHERE-SKIP IS MANDATORY, and it means "complete", not "abandon": a skip fires every beat that
//     has not run yet, in order, so the sequence can never leave half of its state applied. A `pointerdown`
//     capture listener on the document is what makes it ANYWHERE (the lab appends a full-screen catcher
//     element; a listener needs no z-index rung of its own, and gacha's ladder is already crowded — §10.1).
//     It does not preventDefault: swallowing a tap is the caller's business, and a document-level swallow
//     would eat the tab bar too.
//
//     ⚠ A SKIP GESTURE SPANS TWO BROWSER EVENTS, and a caller that swallows by reading `running` in its
//     CLICK handler will not swallow anything (Codex E1 MED-1, found in the poster). This listener skips on
//     `pointerdown`; React then commits `running: false`; the browser dispatches `click` afterwards, by
//     which time the flag says the ceremony is over — so the finger that stopped the theatre also fires the
//     control it landed on. The fix belongs to the CALLER because only it knows what its controls do:
//     record `running` in an `onPointerDownCapture` (which runs inside the pointerdown's own dispatch,
//     still pre-skip) and consume that record in `onClick`. `GachaPoster#skippedGesture` is the worked
//     example, keyboard belt included — Enter/Space produce a click with no pointerdown to record.
//  3. EVERY TIMER IS CLEARED — on skip, on finish, and on unmount. A ceremony that outlives its component
//     would call `setState` on a dead tree, and (worse) a wake ceremony's beats close over a host id that
//     may have left the fleet.
//
// It is deliberately NOT a state machine over named phases: what a beat DOES is the caller's (a class, a
// live-region announce, a piece of state), and the runner only owns WHEN.

/** One beat: the offset in milliseconds from the ceremony's start, and what happens then. */
export type CeremonyBeat = readonly [at: number, fn: () => void];

export interface Ceremony {
  /** Is a ceremony in flight? The caller renders its own busy/skip affordances off this. */
  running: boolean;
  /** Start one. A no-op while another is already running (the lab's `ceremonyBusy` — two overlapping
   *  sequences on one stack read as a glitch, not as two ceremonies). `total` is the budget after the last
   *  beat, i.e. when `running` drops; R24 caps a ceremony at 900 ms. */
  start(beats: readonly CeremonyBeat[], total: number): void;
  /** Complete every remaining beat NOW and end. Idempotent, and safe to call when nothing is running. */
  skip(): void;
}

export function useCeremony(): Ceremony {
  // The app's own motion preference, not the OS's (rule 1). `full` is the only value that buys real beats.
  const reduced = useUISlice((s) => s.motion) !== "full";
  const [running, setRunning] = useState(false);
  // The live sequence + its timers, as refs: `skip` is called from a document listener and from event
  // handlers that close over an older render, so both have to read what is CURRENTLY in flight.
  const steps = useRef<{ fn: () => void; ran: boolean }[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const busy = useRef(false);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  /** Fire every beat that has not run, in declaration order. `ran` is flipped BEFORE the call so a beat
   *  that throws still counts as spent — a re-entrant skip must not run it twice. */
  const fireRest = useCallback(() => {
    for (const s of steps.current) {
      if (s.ran) continue;
      s.ran = true;
      s.fn();
    }
  }, []);

  const finish = useCallback(() => {
    clearTimers();
    steps.current = [];
    busy.current = false;
    setRunning(false);
  }, [clearTimers]);

  const skip = useCallback(() => {
    if (!busy.current) return;
    clearTimers();
    fireRest();
    finish();
  }, [clearTimers, fireRest, finish]);

  const start = useCallback(
    (beats: readonly CeremonyBeat[], total: number) => {
      if (busy.current) return;
      const seq = beats.map(([, fn]) => ({ fn, ran: false }));
      steps.current = seq;
      if (reduced) {
        // COLLAPSE (rule 1): the end state, immediately. Nothing is scheduled, so `running` never turns on
        // and no skip listener is mounted — there is nothing left to skip.
        fireRest();
        steps.current = [];
        return;
      }
      busy.current = true;
      setRunning(true);
      beats.forEach(([at], i) => {
        timers.current.push(
          setTimeout(() => {
            const s = seq[i];
            if (s.ran) return;
            s.ran = true;
            s.fn();
          }, at),
        );
      });
      timers.current.push(setTimeout(finish, total));
    },
    [reduced, fireRest, finish],
  );

  // TAP ANYWHERE (rule 2). Mounted only while a ceremony is in flight, in the CAPTURE phase so a tap on a
  // stopPropagation-ing surface still skips. Added by an effect, so the very gesture that started the
  // ceremony — whose `pointerdown` has already fired — can never skip it on its own click.
  useEffect(() => {
    if (!running) return;
    const onDown = () => skip();
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [running, skip]);

  // Rule 3: unmount kills the sequence outright — the beats close over state and ids this tree no longer
  // owns, so they are dropped rather than fired.
  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
      steps.current = [];
      busy.current = false;
    },
    [],
  );

  return { running, start, skip };
}
