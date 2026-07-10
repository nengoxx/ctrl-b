import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { safeRafLoop } from "../../src/theme-engine/safeRafLoop";

// safeRafLoop (§14.15.1-A rider c) — the engine-owned crash-safe rAF loop every canvas theme adopts. jsdom
// has no real animation frame scheduler, so we stub requestAnimationFrame / cancelAnimationFrame with a
// controllable fake and pump frames manually (one generation per `pump`): a callback that reschedules during
// a pump is captured for the NEXT pump, so the number of pending frames after a pump tells us whether the
// loop kept scheduling or stopped. The non-negotiables under test: throttle/void keeps looping, `false`
// stops cleanly, a THROW stops permanently + reports ONCE (a boundary can't reach a rAF fault), and start()
// is single-flight while stop() cancels the pending frame.

/** A deterministic rAF scheduler: `pump(now)` drains the frames scheduled so far, running each once. */
function fakeRaf() {
  const scheduled = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  const raf = vi.fn((cb: FrameRequestCallback) => {
    nextId += 1;
    scheduled.set(nextId, cb);
    return nextId;
  });
  const cancel = vi.fn((handle: number) => {
    scheduled.delete(handle);
  });
  function pump(now: number): void {
    const generation = [...scheduled.values()]; // snapshot: reschedules land in `scheduled` for the next pump
    scheduled.clear();
    for (const cb of generation) cb(now);
  }
  return {
    raf,
    cancel,
    pump,
    get pending(): number {
      return scheduled.size;
    },
  };
}

let fake: ReturnType<typeof fakeRaf>;

beforeEach(() => {
  fake = fakeRaf();
  vi.stubGlobal("requestAnimationFrame", fake.raf);
  vi.stubGlobal("cancelAnimationFrame", fake.cancel);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("safeRafLoop — (a) ticks receive timestamps and keep scheduling", () => {
  it("passes each frame's `now` to the tick and reschedules on a void return", () => {
    const tick = vi.fn<(now: number) => void>();
    const loop = safeRafLoop(tick);

    loop.start();
    expect(loop.running).toBe(true);
    expect(fake.raf).toHaveBeenCalledTimes(1);

    fake.pump(100);
    expect(tick).toHaveBeenLastCalledWith(100);
    expect(fake.pending).toBe(1); // rescheduled

    fake.pump(116);
    expect(tick).toHaveBeenLastCalledWith(116);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(fake.pending).toBe(1);
    expect(loop.running).toBe(true);
  });
});

describe("safeRafLoop — (b) a `false` return stops the loop", () => {
  it("does not schedule another frame once the tick returns false", () => {
    const tick = vi
      .fn<(now: number) => boolean | void>()
      .mockReturnValueOnce(undefined) // frame 1: keep going
      .mockReturnValueOnce(false); // frame 2: settled → stop
    const loop = safeRafLoop(tick);

    loop.start();
    fake.pump(0);
    expect(fake.pending).toBe(1);

    fake.pump(16);
    expect(fake.pending).toBe(0);
    expect(loop.running).toBe(false);

    fake.pump(32); // nothing scheduled — the loop is done
    expect(tick).toHaveBeenCalledTimes(2);
  });
});

describe("safeRafLoop — (c) a throwing tick stops permanently and reports once", () => {
  it("routes the error to reportError, stops, and never schedules another frame", () => {
    const reportSpy = vi.fn();
    vi.stubGlobal("reportError", reportSpy);
    const err = new Error("boom");
    const tick = vi.fn(() => {
      throw err;
    });
    const loop = safeRafLoop(tick);

    loop.start();
    fake.pump(0);

    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy).toHaveBeenCalledWith(err);
    expect(loop.running).toBe(false);
    expect(fake.pending).toBe(0);

    fake.pump(16); // pump keeps going, but the loop must not
    expect(tick).toHaveBeenCalledTimes(1);
    expect(reportSpy).toHaveBeenCalledTimes(1); // no error-per-frame
  });

  it("falls back to console.error when reportError is unavailable (feature-detect)", () => {
    vi.stubGlobal("reportError", undefined);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("boom");
    const loop = safeRafLoop(() => {
      throw err;
    });

    loop.start();
    fake.pump(0);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(err);
    expect(loop.running).toBe(false);
  });
});

describe("safeRafLoop — (d) start() is single-flight; stop() cancels", () => {
  it("start() twice runs a single loop", () => {
    const tick = vi.fn();
    const loop = safeRafLoop(tick);

    loop.start();
    loop.start();
    expect(fake.raf).toHaveBeenCalledTimes(1); // no second, parallel loop
    expect(loop.running).toBe(true);
  });

  it("stop() cancels the pending frame and halts ticking", () => {
    const tick = vi.fn();
    const loop = safeRafLoop(tick);

    loop.start();
    loop.stop();
    expect(fake.cancel).toHaveBeenCalledTimes(1);
    expect(loop.running).toBe(false);

    fake.pump(0); // the scheduled frame was canceled → tick never runs
    expect(tick).not.toHaveBeenCalled();
  });
});

describe("re-entrant stop()+start() inside a tick (verification F2, 2026-07-10)", () => {
  it("keeps exactly ONE loop — no orphaned frame handle", () => {
    let restarted = false;
    // The tick closes over `loop` (initialized before any frame runs — ticks only fire on pump()).
    const loop: ReturnType<typeof safeRafLoop> = safeRafLoop(() => {
      if (!restarted) {
        restarted = true;
        loop.stop();
        loop.start(); // schedules its own frame — the frame body must NOT schedule a second one
      }
    });
    loop.start();
    expect(fake.pending).toBe(1);
    fake.pump(16); // the tick does stop()+start()
    expect(fake.pending).toBe(1); // one pending frame, not two
    loop.stop();
    expect(fake.pending).toBe(0); // and stop() cancels it — nothing orphaned
  });
});
