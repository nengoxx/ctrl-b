import { describe, expect, it } from "vitest";

import {
  DBFS_SILENCE,
  effectiveFloor,
  type GateCfg,
  learnVoice,
  newNoiseTracker,
  NOISE_BOOTSTRAP_MS,
  NOISE_DISCARD_DBFS,
  NOISE_WINDOW_MS,
  type NoiseTracker,
  p90,
  resetNoise,
  rmsToDbfs,
  trackNoise,
  VOICE_EMA_ALPHA,
} from "../../src/lib/levelGate";

// lib/levelGate — the relative level gate's pure core (D76 §C, evidence docs/research/R83): the ONE
// dB conversion, the minimum-tracking noise floor, the guarded own-voice learner and the effective
// floor's truth table. No React, no clocks — frames in, numbers out.

/** The shipped `LiveCfg` gate defaults. */
const CFG: GateCfg = {
  floor_dbfs: -45,
  noise_margin_db: 10,
  voice_margin_db: 10,
  min_dbfs: -60,
  max_dbfs: -20,
};
const FRAME = 20;

/** Feed `ms` of frames at `db` into `t`. */
function feed(t: NoiseTracker, db: number, ms: number): void {
  for (let i = 0; i < ms / FRAME; i++) trackNoise(t, db, FRAME);
}

describe("rmsToDbfs — the one conversion (§C.1)", () => {
  it("maps the linear RMS to dBFS", () => {
    expect(rmsToDbfs(0.06)).toBeCloseTo(-24.4, 1);
    expect(rmsToDbfs(1)).toBe(0);
    expect(rmsToDbfs(0.1)).toBeCloseTo(-20, 10);
  });

  it("lands digital silence on a finite floor, never −Infinity", () => {
    expect(rmsToDbfs(0)).toBeCloseTo(-120, 10);
    expect(DBFS_SILENCE).toBeCloseTo(-120, 10);
  });
});

describe("the noise tracker (§C.2 — WebRTC AGC2's minimum tracker)", () => {
  it("closes the 1 s BOOTSTRAP window with a PROVISIONAL floor", () => {
    const t = newNoiseTracker();
    feed(t, -50, NOISE_BOOTSTRAP_MS - FRAME);
    expect(t.floor).toBeNull(); // one frame short
    trackNoise(t, -52, FRAME);
    expect(t.floor).toBe(-52); // the window's MINIMUM, not its mean
    expect(t.settled).toBe(false);
  });

  it("SETTLES once a full 5 s window has closed", () => {
    const t = newNoiseTracker();
    feed(t, -50, NOISE_BOOTSTRAP_MS);
    feed(t, -50, NOISE_WINDOW_MS - FRAME);
    expect(t.settled).toBe(false);
    trackNoise(t, -50, FRAME);
    expect(t.settled).toBe(true);
    expect(t.floor).toBe(-50);
  });

  it("goes DOWN instantly and UP halfway per window", () => {
    const t = newNoiseTracker();
    feed(t, -50, NOISE_BOOTSTRAP_MS);
    feed(t, -60, NOISE_WINDOW_MS);
    expect(t.floor).toBe(-60); // quieter room: believed at once
    feed(t, -40, NOISE_WINDOW_MS);
    expect(t.floor).toBe(-50); // louder room: half the way
    feed(t, -40, NOISE_WINDOW_MS);
    expect(t.floor).toBe(-45);
  });

  it("a window's minimum is what counts — talking through it cannot raise the floor", () => {
    const t = newNoiseTracker();
    feed(t, -60, NOISE_BOOTSTRAP_MS);
    // Five seconds of speech with ONE gap at the room level: the gap is the window's minimum.
    feed(t, -20, NOISE_WINDOW_MS / 2);
    trackNoise(t, -60, FRAME);
    feed(t, -20, NOISE_WINDOW_MS / 2 - FRAME);
    expect(t.floor).toBe(-60);
  });

  it("IGNORES frames below the −84 dBFS discard — a muted or dead input is not a room", () => {
    const t = newNoiseTracker();
    feed(t, NOISE_DISCARD_DBFS - 1, NOISE_WINDOW_MS * 2);
    expect(t.floor).toBeNull();
    expect(t.windowMs).toBe(0); // not even counted toward the window
    feed(t, NOISE_DISCARD_DBFS, NOISE_BOOTSTRAP_MS); // the discard bound itself is admitted
    expect(t.floor).toBe(NOISE_DISCARD_DBFS);
  });

  it("RESET forgets everything — the next window is a bootstrap again", () => {
    const t = newNoiseTracker();
    feed(t, -50, NOISE_BOOTSTRAP_MS + NOISE_WINDOW_MS);
    expect(t.settled).toBe(true);
    resetNoise(t);
    expect(t).toEqual(newNoiseTracker());
    feed(t, -30, NOISE_BOOTSTRAP_MS);
    expect(t.floor).toBe(-30); // the fresh bootstrap takes its own minimum, not a half-step
    expect(t.settled).toBe(false);
  });
});

describe("the own-voice learner (§C.3 — Maya F4's three guards)", () => {
  /** A settled tracker at `floor`. */
  const settled = (floor: number): NoiseTracker => {
    const t = newNoiseTracker();
    feed(t, floor, NOISE_BOOTSTRAP_MS + NOISE_WINDOW_MS);
    return t;
  };
  const said = (db: number, n = 20, duringPlayback = false) => ({
    samples: Array.from({ length: n }, () => db),
    duringPlayback,
  });

  it("p90 is the loud part of an utterance (nearest rank), null for none", () => {
    const tenths = Array.from({ length: 10 }, (_, i) => -50 + i); // −50 … −41
    expect(p90(tenths)).toBe(-42);
    expect(p90([-30])).toBe(-30);
    expect(p90([])).toBeNull();
  });

  it("learns the first level outright once the room is settled and the margin is clear", () => {
    expect(learnVoice(null, said(-25), settled(-60), CFG)).toBe(-25);
  });

  it("…then moves by the EMA", () => {
    expect(learnVoice(-25, said(-15), settled(-60), CFG)).toBeCloseTo(
      -25 + VOICE_EMA_ALPHA * 10,
      10,
    );
  });

  it("does NOT learn on a provisional (unsettled) floor", () => {
    const t = newNoiseTracker();
    feed(t, -60, NOISE_BOOTSTRAP_MS);
    expect(t.floor).toBe(-60);
    expect(learnVoice(null, said(-25), t, CFG)).toBeNull();
    expect(learnVoice(null, said(-25), newNoiseTracker(), CFG)).toBeNull();
  });

  it("does NOT learn from an utterance that only barely cleared the room", () => {
    // noise −60 + 10 + 10 = −40 is the bar; −41 is an interferer that passed the gate, not the owner.
    expect(learnVoice(-30, said(-41), settled(-60), CFG)).toBe(-30);
    expect(learnVoice(null, said(-40), settled(-60), CFG)).toBe(-40); // the bar itself teaches
  });

  it("does NOT learn from an utterance heard while the reply was playing", () => {
    expect(learnVoice(null, said(-25, 20, true), settled(-60), CFG)).toBeNull();
  });

  it("does NOT learn from an utterance with no uplinked samples at all", () => {
    expect(learnVoice(-30, said(-25, 0), settled(-60), CFG)).toBe(-30);
  });
});

describe("effectiveFloor — the truth table (§C.4)", () => {
  const floor = (
    noise: number | null,
    settled: boolean,
    voiceLevel: number | null,
    pin: number | null = null,
    cfg: GateCfg = CFG,
  ): number => effectiveFloor({ noise, settled, voiceLevel, pin, cfg });

  it("a PIN wins over everything, unclamped — the owner's explicit choice", () => {
    expect(floor(-50, true, -20, -70)).toBe(-70);
    expect(floor(null, false, null, -30)).toBe(-30);
  });

  it("no estimate, no voice ⇒ the bootstrap ceiling", () => {
    expect(floor(null, false, null)).toBe(-45);
  });

  it("no estimate, a KNOWN voice ⇒ the own-voice term applies from the first frame", () => {
    expect(floor(null, false, -25)).toBe(-35); // max(−45, −25 − 10)
    expect(floor(null, false, -60)).toBe(-45); // a quiet voice never lowers it below the ceiling
  });

  it("PROVISIONAL noise ⇒ min(noise + margin, ceiling) — permissive, never stricter than the ceiling", () => {
    expect(floor(-70, false, null)).toBe(-60); // min(−60, −45)
    expect(floor(-40, false, null)).toBe(-45); // min(−30, −45): a noisy car's first second admits
  });

  it("PROVISIONAL noise with a KNOWN voice ⇒ the own-voice term still applies (the micro-confirm fold)", () => {
    expect(floor(-40, false, -20)).toBe(-30); // max(min(−30, −45), −30)
    expect(floor(-65, false, -60)).toBe(-55); // max(min(−55, −45), −70)
  });

  it("SETTLED noise ⇒ noise + margin, and max() with the voice term", () => {
    expect(floor(-55, true, null)).toBe(-45);
    expect(floor(-40, true, null)).toBe(-30); // settled: the ceiling no longer caps it
    expect(floor(-55, true, -25)).toBe(-35); // max(−45, −35)
    expect(floor(-55, true, -60)).toBe(-45); // max(−45, −70)
  });

  it("CLAMPS every Auto answer into [min_dbfs, max_dbfs]", () => {
    expect(floor(-90, true, null)).toBe(-60); // −80 → the lower bound
    expect(floor(-10, true, null)).toBe(-20); // 0 → the upper bound
    expect(floor(null, false, -5)).toBe(-20); // a loud seeded voice, clamped too
    expect(floor(null, false, null, null, { ...CFG, floor_dbfs: -75 })).toBe(-60);
  });
});
