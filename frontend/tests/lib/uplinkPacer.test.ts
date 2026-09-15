import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  accrue,
  BUCKET_CAP_MS,
  DRAIN_PACE,
  enqueue,
  enqueueBounded,
  newPacer,
  pump,
  type PacerState,
} from "../../src/lib/uplinkPacer";

// lib/uplinkPacer — the ONE meter both relay consumers ship audio through (Phase 24 / A-F2, evidence
// docs/research/R71). The hooks' own suites pin what each does WITH it (`dictationStreaming.test.ts`
// for the lossless leg and its release drain, `useLiveCallWiring.test.ts` for the call's bounded one);
// what is pinned here is the arithmetic itself, with no hook, no socket and no recorder:
//   · the budget is earned from the WALL CLOCK, so a burst carrying none of it cannot spend,
//   · the cap is what bounds a post-stall dispatch — and the bound is the relay's own budget,
//   · the two backlog rules are genuinely two: lossless keeps every frame, bounded drops the OLDEST.
//
// Fake timers because `performance.now()` is the input under test: advancing them IS the passage of
// wall clock, exactly as the streaming suite drives the same functions one layer up.

const FRAME_MS = 40;

/** A frame identified by its first byte, so a case can pin ORDER rather than merely count. */
function frame(n: number): ArrayBuffer {
  const buf = new ArrayBuffer(8);
  new Uint8Array(buf)[0] = n;
  return buf;
}

/** The sink every case pumps into: which frames reached the wire, in order. */
function sink(): { sent: number[]; send: (buf: ArrayBuffer) => void } {
  const sent: number[] = [];
  return { sent, send: (buf) => sent.push(new Uint8Array(buf)[0]) };
}

/** One frame's worth of microphone: the wall clock a real worklet callback carries with it. */
function realtime(s: PacerState, n: number, out: ReturnType<typeof sink>, rule = enqueue): void {
  vi.advanceTimersByTime(FRAME_MS);
  rule(s, frame(n));
  accrue(s);
  pump(s, FRAME_MS, out.send);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("uplinkPacer — the bucket is a wall clock", () => {
  it("a fresh pacer is EMPTY: a burst with no elapsed time behind it ships nothing", () => {
    const s = newPacer();
    const out = sink();
    for (let i = 1; i <= 10; i++) enqueue(s, frame(i));
    accrue(s);
    pump(s, FRAME_MS, out.send);
    expect(out.sent).toEqual([]);
    expect(s.backlog).toHaveLength(10);
  });

  it("at the ordinary cadence it ships one frame per callback, plus the catch-up half", () => {
    const s = newPacer();
    const out = sink();
    // Each 40 ms callback banks 1.5 × 40 = 60 ms, so it spends one frame and half of a second one —
    // the pace that drains a backlog without ever sitting on the relay's 2× ceiling.
    for (let i = 1; i <= 6; i++) realtime(s, i, out);
    expect(out.sent).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.backlog).toEqual([]);
  });

  it("a backlog drains AHEAD of the live frame, in order", () => {
    const s = newPacer();
    const out = sink();
    for (let i = 1; i <= 5; i++) enqueue(s, frame(i)); // a dispatch with no clock behind it
    expect(out.sent).toEqual([]);
    for (let i = 6; i <= 10; i++) realtime(s, i, out);
    // Oldest first, always: audio ORDER is the contract, and a live frame that overtook the backlog
    // would hand the ear a sentence with its middle missing.
    expect(out.sent).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("the CAP bounds what one dispatch may spend — the relay's rolling budget, in the client", () => {
    const s = newPacer();
    const out = sink();
    // Five seconds of stall: the worklet kept producing, its MessagePort deliveries queued, and they
    // arrive in ONE tick carrying no wall clock at all.
    vi.advanceTimersByTime(5000);
    for (let i = 1; i <= 125; i++) enqueue(s, frame(i));
    accrue(s);
    pump(s, FRAME_MS, out.send);
    // Paced per callback that is 125 sends at one instant. Paced by the clock it is the CAP, and only
    // the cap: 500 ms of banked audio ⇒ 12 frames at 40 ms.
    expect(out.sent).toHaveLength(Math.floor(BUCKET_CAP_MS / FRAME_MS));
    // …and the cap is what keeps the whole window under the relay's 2×-realtime budget: the worst it
    // can see is `cap + DRAIN_PACE × window` = 500 + 1.5 × 2000 = 3500 ms against an allowance of 4000.
    expect(BUCKET_CAP_MS + DRAIN_PACE * 2000).toBeLessThan(2 * 2000);
  });
});

describe("uplinkPacer — the two backlog rules", () => {
  it("LOSSLESS keeps every frame, however deep (dictation's rule)", () => {
    const s = newPacer();
    for (let i = 1; i <= 200; i++) enqueue(s, frame(i));
    expect(s.backlog).toHaveLength(200);
    const out = sink();
    vi.advanceTimersByTime(60_000);
    accrue(s);
    pump(s, FRAME_MS, out.send);
    // It drains at the cap, not at the whole minute it waited — but the FIRST frame is still frame 1.
    expect(out.sent[0]).toBe(1);
  });

  it("BOUNDED drops the OLDEST past the bound, and says so once per burst (the call's rule)", () => {
    const s = newPacer();
    const boundMs = 200; // = 5 frames at 40 ms
    // Under the bound: nothing is lost and nothing is reported.
    for (let i = 1; i <= 5; i++) expect(enqueueBounded(s, frame(i), FRAME_MS, boundMs)).toBe(false);
    expect(s.backlog).toHaveLength(5);
    // The sixth is one frame too many: the queue keeps its depth by losing its HEAD — the stale end,
    // not the phrase end the endpointer needs.
    expect(enqueueBounded(s, frame(6), FRAME_MS, boundMs)).toBe(true);
    expect(s.backlog).toHaveLength(5);
    const out = sink();
    vi.advanceTimersByTime(1000);
    accrue(s);
    pump(s, FRAME_MS, out.send);
    expect(out.sent).toEqual([2, 3, 4, 5, 6]);
  });

  it("…and at the ordinary cadence the bounded rule drops NOTHING — the pump keeps ahead of it", () => {
    const s = newPacer();
    const out = sink();
    let drops = 0;
    for (let i = 1; i <= 50; i++) {
      vi.advanceTimersByTime(FRAME_MS);
      if (enqueueBounded(s, frame(i), FRAME_MS, 1000)) drops += 1;
      accrue(s);
      pump(s, FRAME_MS, out.send);
    }
    expect(drops).toBe(0);
    expect(out.sent).toHaveLength(50);
  });

  it("a bound of zero or below cannot spin: the loop is guarded on the queue's own length", () => {
    // Not a configuration we ship (the knob is bounded server-side) — pinned because the drop loop's
    // exit condition is arithmetic on a value that arrives over the wire.
    const s = newPacer();
    expect(enqueueBounded(s, frame(1), FRAME_MS, 0)).toBe(true);
    expect(s.backlog).toEqual([]);
    expect(enqueueBounded(s, frame(2), FRAME_MS, -5)).toBe(true);
    expect(s.backlog).toEqual([]);
  });
});
