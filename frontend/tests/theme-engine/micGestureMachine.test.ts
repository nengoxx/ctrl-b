import { describe, expect, it } from "vitest";

import {
  ACTIVATE_MS,
  CANCEL_MAX_PX,
  CANCEL_RELEASE,
  CANCEL_SHARE,
  LOCK_PX,
  MIC_IDLE,
  SLOP_PX,
  cancelDistance,
  cancelProgress,
  liftProgress,
  micReduce,
  type MicGestureState,
  type MicOut,
  type MicSignal,
} from "../../src/theme-engine/kit/composer/useMicGesture";

// THE DUAL-MODE MIC GESTURE'S PURE MACHINE (Phase 24 / S0.5 — LIVE_VOICE_PLAN §6, D71; parameters from
// R69 §9). Every arm of `micReduce` is exercised here, with no DOM and no recorder: the machine takes
// coordinates and returns a state plus outcomes, which is exactly why jsdom's total absence of layout
// costs these pins nothing. The wiring — what the outcomes actually DO to `useDictation` — is pinned
// separately in `micGesture.test.tsx`.
//
// The literals below are all IMPORTED. R69's table lives in one place (the hook), and a test that
// re-typed 56 or 0.55 would pin the test's copy rather than the ship's.

const PID = 7;

/** Drive a signal sequence from idle, collecting every outcome in order. */
function run(...signals: MicSignal[]): { state: MicGestureState; out: MicOut[] } {
  let state = MIC_IDLE;
  const out: MicOut[] = [];
  for (const sig of signals) {
    const step = micReduce(state, sig);
    state = step.state;
    out.push(...step.out);
  }
  return { state, out };
}

const down = (x = 300, y = 700, mode: "mic" | "call" = "mic", cancelDist = 126): MicSignal => ({
  type: "down",
  pid: PID,
  t: 0,
  x,
  y,
  mode,
  cancelDist,
});
const move = (x: number, y: number): MicSignal => ({ type: "move", pid: PID, x, y });
const up = (t: number): MicSignal => ({ type: "up", pid: PID, t });

describe("micReduce · the tap window (R69 §1.1/§1.2)", () => {
  it("a release inside 150 ms with no travel is a TAP", () => {
    const { state, out } = run(down(), up(ACTIVATE_MS - 1));
    expect(out).toEqual(["tap"]);
    expect(state.stage).toBe("idle");
  });

  it("a release AT the activation window is no longer a tap — the timer owns that instant", () => {
    expect(run(down(), up(ACTIVATE_MS)).out).toEqual([]);
  });

  it("a release inside the window but PAST the slop is not a tap either", () => {
    const { out } = run(down(300, 700), move(300 - SLOP_PX - 1, 700), up(ACTIVATE_MS - 1));
    expect(out).toEqual([]);
  });

  it("travel of exactly the slop still taps — 8 px is the disqualifying threshold, not the limit", () => {
    const { out } = run(down(300, 700), move(300 - SLOP_PX, 700), up(ACTIVATE_MS - 1));
    expect(out).toEqual(["tap"]);
  });

  it("activation starts the recording — and only from `press`", () => {
    const { state, out } = run(down(), { type: "activate" });
    expect(out).toEqual(["start"]);
    expect(state.stage).toBe("hold");
    // A second activation (a stale timer) does nothing at all.
    expect(micReduce(state, { type: "activate" }).out).toEqual([]);
  });

  it("call mode activates into `callArm` and records NOTHING", () => {
    const { state, out } = run(down(300, 700, "call"), { type: "activate" });
    expect(out).toEqual([]);
    expect(state.stage).toBe("callArm");
  });
});

describe("micReduce · the relative cancel distance (R69 §1.3, risk 8)", () => {
  it("is 35% of the viewport, capped at 140 px", () => {
    expect(cancelDistance(360)).toBeCloseTo(360 * CANCEL_SHARE); // the owner's phone: 126
    expect(cancelDistance(1440)).toBe(CANCEL_MAX_PX); // wide: saturates at the cap
  });

  it("cancels DURING the drag the moment the full distance is reached — no release needed", () => {
    const { state, out } = run(down(300, 700), { type: "activate" }, move(300 - 126, 700));
    expect(out).toEqual(["start", "cancel"]);
    expect(state.stage).toBe("idle");
  });

  it("a release past 55% of the way is a cancel; short of it, a send", () => {
    const past = -(126 * CANCEL_RELEASE) - 1;
    const shy = -(126 * CANCEL_RELEASE) + 1;
    expect(run(down(300, 700), { type: "activate" }, move(300 + past, 700), up(900)).out).toEqual([
      "start",
      "cancel",
    ]);
    expect(run(down(300, 700), { type: "activate" }, move(300 + shy, 700), up(900)).out).toEqual([
      "start",
      "stop",
    ]);
  });

  it("progress is continuous and clamped — the track can follow the finger", () => {
    const { state } = run(down(300, 700), { type: "activate" }, move(300 - 63, 700));
    expect(cancelProgress(state)).toBeCloseTo(0.5);
    // Clamped on a HAND-BUILT state: the machine itself can never hold an over-full slide (reaching
    // the full distance mid-drag IS the cancel), so the ceiling is asserted on the selector directly.
    expect(cancelProgress({ ...MIC_IDLE, axis: "x", dx: -500, cancelDist: 126 })).toBe(1);
    expect(cancelProgress({ ...MIC_IDLE, axis: "x", dx: 80, cancelDist: 126 })).toBe(0); // rightward
  });
});

describe("micReduce · the lock (R69 §1.4)", () => {
  it("latches ON CROSSING 56 px of lift — the user never releases to lock", () => {
    const { state, out } = run(down(300, 700), { type: "activate" }, move(300, 700 - LOCK_PX));
    expect(out).toEqual(["start", "lock"]);
    expect(state.stage).toBe("locked");
  });

  it("one pixel short does not lock", () => {
    const { state } = run(down(300, 700), { type: "activate" }, move(300, 700 - LOCK_PX + 1));
    expect(state.stage).toBe("hold");
    expect(liftProgress(state)).toBeCloseTo((LOCK_PX - 1) / LOCK_PX);
  });

  it("the LOCKING pointer's own release does nothing — the recording is hands-free now", () => {
    const { state } = run(down(300, 700), { type: "activate" }, move(300, 700 - LOCK_PX), up(900));
    expect(state.stage).toBe("locked");
  });

  it("a FRESH pointer tapping the locked button stops it (the tap twin of tap-to-stop)", () => {
    const locked = run(
      down(300, 700),
      { type: "activate" },
      move(300, 700 - LOCK_PX),
      up(900),
    ).state;
    const adopted = micReduce(locked, {
      type: "down",
      pid: 9,
      t: 1000,
      x: 300,
      y: 700,
      mode: "mic",
      cancelDist: 126,
    });
    expect(adopted.state.stage).toBe("locked");
    const stopped = micReduce(adopted.state, { type: "up", pid: 9, t: 1050 });
    expect(stopped.out).toEqual(["stop"]);
    expect(stopped.state.stage).toBe("idle");
  });

  it("the visible CANCEL button discards a locked recording", () => {
    const locked = run(down(300, 700), { type: "activate" }, move(300, 700 - LOCK_PX)).state;
    expect(micReduce(locked, { type: "cancelTap" }).out).toEqual(["cancel"]);
  });
});

describe("micReduce · AXIS COMMIT (delta round F6 — the diagonal thumb arc)", () => {
  it("a diagonal that leaves the slop horizontally can NEVER lock, however far up it goes", () => {
    // dx = -20, dy = -12 → |dx| > |dy| ⇒ the gesture is a cancel gesture for the rest of its life.
    const armed = run(down(300, 700), { type: "activate" }, move(280, 688)).state;
    expect(armed.axis).toBe("x");
    const wayUp = micReduce(armed, move(280, 700 - 400));
    expect(wayUp.state.stage).toBe("hold"); // 400 px of lift, and still not locked
    expect(wayUp.out).toEqual([]);
    expect(liftProgress(wayUp.state)).toBe(0);
  });

  it("…and a vertically-committed gesture can never cancel, however far left it goes", () => {
    const armed = run(down(300, 700), { type: "activate" }, move(288, 680)).state;
    expect(armed.axis).toBe("y");
    const wayLeft = micReduce(armed, move(-500, 680));
    expect(wayLeft.out).toEqual([]);
    expect(cancelProgress(wayLeft.state)).toBe(0);
    // …and releasing there SENDS, because there is no cancel progress to read.
    expect(micReduce(wayLeft.state, up(2000)).out).toEqual(["stop"]);
  });

  it("the axis is committed ONCE and never re-evaluated", () => {
    const armed = run(down(300, 700), { type: "activate" }, move(280, 700)).state;
    expect(micReduce(armed, move(300, 600)).state.axis).toBe("x");
  });

  it("inside the slop no axis exists yet, so neither threshold can fire", () => {
    const { state } = run(down(300, 700), { type: "activate" }, move(297, 696));
    expect(state.axis).toBeNull();
    expect(state.stage).toBe("hold"); // no lock, no cancel — nothing has committed
    // CANCEL progress needs the X commit, so the track stays full…
    expect(cancelProgress(state)).toBe(0);
    // …while the rail is free to follow the finger from the first pixel (it is feedback, not a
    // threshold; the latch itself is gated on `axis === "y"` in the move arm above).
    expect(liftProgress(state)).toBeCloseTo(4 / LOCK_PX);
  });
});

describe("micReduce · `pointercancel` NEVER loses audio (R69 §1.5/risk 2 — the iron rule)", () => {
  it("an unlocked in-progress recording is PROMOTED TO LOCKED, not discarded", () => {
    const { state, out } = run(down(), { type: "activate" }, { type: "pointercancel", pid: PID });
    expect(out).toEqual(["start", "lock"]);
    expect(state.stage).toBe("locked");
  });

  it("…even mid-slide, where the user was visibly heading for cancel", () => {
    const { state, out } = run(down(300, 700), { type: "activate" }, move(300 - 60, 700), {
      type: "pointercancel",
      pid: PID,
    });
    expect(out).toEqual(["start", "lock"]);
    expect(state.stage).toBe("locked");
  });

  it("a cancel DURING acquisition latches the same intent: the arriving recording is locked", () => {
    // `start` has been dispatched (activation) but the recorder has not armed yet — the machine is in
    // `hold` either way, so this is the same arm, and it is what makes the F5 latch work.
    const { state, out } = run(down(), { type: "activate" }, { type: "pointercancel", pid: PID });
    expect(state.stage).toBe("locked");
    expect(out).not.toContain("cancel");
  });

  it("a cancel BEFORE activation simply ends — nothing was recorded", () => {
    const { state, out } = run(down(), { type: "pointercancel", pid: PID });
    expect(out).toEqual([]);
    expect(state.stage).toBe("idle");
  });
});

describe("micReduce · call mode commits on RELEASE (the recorded deviation)", () => {
  it("crossing 56 px does NOT commit — the escape back down stays open", () => {
    const { state, out } = run(down(300, 700, "call"), { type: "activate" }, move(300, 700 - 200));
    expect(out).toEqual([]);
    expect(state.stage).toBe("callArm");
  });

  it("releasing past the threshold commits the call", () => {
    const { out } = run(
      down(300, 700, "call"),
      { type: "activate" },
      move(300, 700 - LOCK_PX),
      up(900),
    );
    expect(out).toEqual(["callCommit"]);
  });

  it("releasing short of it leaves a standing chip, which OWNS the next tap", () => {
    const parked = run(down(300, 700, "call"), { type: "activate" }, up(900));
    expect(parked.out).toEqual(["callChip"]);
    expect(parked.state.stage).toBe("chip");
    const tapped = micReduce(parked.state, down(300, 700, "call"));
    expect(tapped.out).toEqual(["callCommit"]);
    expect(tapped.state.stage).toBe("idle");
  });

  it("the chip expires back to idle on its own", () => {
    const parked = run(down(300, 700, "call"), { type: "activate" }, up(900)).state;
    expect(micReduce(parked, { type: "chipExpire" }).state.stage).toBe("idle");
  });
});

describe("micReduce · the keyboard door + the external close-outs", () => {
  it("keyboard activation starts HANDS-FREE — there is no hand to free", () => {
    const { state, out } = run({ type: "keyStart" });
    expect(out).toEqual(["start"]);
    expect(state.stage).toBe("locked"); // so Esc and the visible CANCEL are live immediately
  });

  it("a second keyboard activation stops it", () => {
    expect(micReduce(run({ type: "keyStart" }).state, { type: "keyStop" }).out).toEqual(["stop"]);
  });

  it("Esc cancels a recording, in either recording stage", () => {
    const held = run(down(), { type: "activate" }).state;
    expect(micReduce(held, { type: "escape" }).out).toEqual(["cancel"]);
    const locked = run({ type: "keyStart" }).state;
    expect(micReduce(locked, { type: "escape" }).out).toEqual(["cancel"]);
  });

  it("Esc before activation cancels nothing — there is nothing to cancel", () => {
    const pressed = run(down()).state;
    const { state, out } = micReduce(pressed, { type: "escape" });
    expect(out).toEqual([]);
    expect(state.stage).toBe("idle");
  });

  it("a recording ending WITHOUT the gesture (auto-stop, hidden page, a failed start) closes it", () => {
    const held = run(down(), { type: "activate" }).state;
    const { state, out } = micReduce(held, { type: "stopped" });
    expect(out).toEqual([]); // nothing to ask the recorder for — it already stopped
    expect(state.stage).toBe("idle");
    // …and from idle it is inert, so an already-closed gesture is never re-closed.
    expect(micReduce(MIC_IDLE, { type: "stopped" }).state).toBe(MIC_IDLE);
  });
});

describe("micReduce · one gesture owns one pointer", () => {
  it("a second finger never joins a gesture in flight", () => {
    const held = run(down(), { type: "activate" }).state;
    const second = micReduce(held, {
      type: "down",
      pid: 99,
      t: 400,
      x: 10,
      y: 10,
      mode: "mic",
      cancelDist: 126,
    });
    expect(second.state).toBe(held);
  });

  it("moves and releases from a foreign pointer are ignored", () => {
    const held = run(down(), { type: "activate" }).state;
    expect(micReduce(held, { type: "move", pid: 99, x: 0, y: 0 }).state).toBe(held);
    expect(micReduce(held, { type: "up", pid: 99, t: 900 }).out).toEqual([]);
  });
});
