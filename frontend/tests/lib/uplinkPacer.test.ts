import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  accrue,
  BUCKET_CAP_MS,
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
    // the pace that drains a backlog in seconds, and only ever of audio the mic already produced.
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

  it("the CAP bounds what one dispatch may spend — a term of the relay's uplink allowance", () => {
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
    // …and that cap is what the relay's allowance counts for this dispatch: one TERM of its load-time
    // inequality (ASR_PLAN §3.3 — keepalive horizon + backlog + send buffer + this cap + two frames,
    // 12 580 ms at the defaults, against 30 000). The rest leaves at `DRAIN_PACE`, late, never early.
    expect(out.sent).toHaveLength(Math.floor(BUCKET_CAP_MS / FRAME_MS));
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

  it("BOUNDED drops the OLDEST past the bound, and says how many (the call's rule)", () => {
    const s = newPacer();
    const boundMs = 200; // = 5 frames at 40 ms
    // Under the bound: nothing is lost and nothing is reported.
    for (let i = 1; i <= 5; i++) expect(enqueueBounded(s, frame(i), FRAME_MS, boundMs)).toBe(0);
    expect(s.backlog).toHaveLength(5);
    // The sixth is one frame too many: the queue keeps its depth by losing its HEAD — the stale end,
    // not the phrase end the endpointer needs.
    expect(enqueueBounded(s, frame(6), FRAME_MS, boundMs)).toBe(1);
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
      drops += enqueueBounded(s, frame(i), FRAME_MS, 1000);
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
    expect(enqueueBounded(s, frame(1), FRAME_MS, 0)).toBe(1);
    expect(s.backlog).toEqual([]);
    expect(enqueueBounded(s, frame(2), FRAME_MS, -5)).toBe(1);
    expect(s.backlog).toEqual([]);
  });

  it("the return is the NUMBER dropped, not a flag — every head frame lost is counted (Phase 26 S1, T6)", () => {
    // One push over a steady bound loses one frame; a tighter bound than the queue already holds loses
    // the whole excess at once, and the count says so — the call trail's `uplink` line sums these.
    const s = newPacer();
    for (let i = 1; i <= 5; i++) enqueueBounded(s, frame(i), FRAME_MS, 200);
    expect(enqueueBounded(s, frame(6), FRAME_MS, 80)).toBe(4); // 6 queued, room for 2
    const out = sink();
    vi.advanceTimersByTime(1000);
    accrue(s);
    pump(s, FRAME_MS, out.send);
    expect(out.sent).toEqual([5, 6]);
  });
});
