import { describe, expect, it } from "vitest";

import {
  autoFloor,
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
  pinCeiling,
  resetNoise,
  rmsToDbfs,
  SEED_MARGINS,
  seedBinds,
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
  ): number => effectiveFloor({ noise, settled, voiceLevel, voiceSeed: null, pin, cfg });

  it("a PIN wins over everything below its ceiling — the owner's explicit choice", () => {
    expect(floor(-50, true, -20, -70)).toBe(-70);
    expect(floor(null, false, null, -30)).toBe(-30);
  });

  it("…and is CLAMPED to the learned voice − its margin once that is known (D80 ⑤, the owner's ruling)", () => {
    // The car trail: the pin at −20 sat above the owner's own learned −21 and dropped their words.
    expect(floor(-42, true, -21, -20)).toBe(-31); // min(−20, max(−21 − 10, Auto −31))
    expect(floor(-42, true, -21, -40)).toBe(-40); // a pin already under it is untouched
    // no voice level yet ⇒ nothing to clamp against: the range's own top is the only bound
    expect(floor(-42, true, null, -20)).toBe(-20);
    // …and never clamped BELOW Auto (O-MED-1): a noisy cabin puts Auto over V − vm
    expect(floor(-38, true, -21, -20)).toBe(-28); // Auto = max(−28, −31) = −28
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

describe("autoFloor + pinCeiling — the column's top never under Auto (D80 ⑤ + the code round's O-MED-1)", () => {
  const inputs = (
    noise: number | null,
    settled: boolean,
    voiceLevel: number | null,
    voiceSeed: number | null = null,
  ) => ({
    noise,
    settled,
    voiceLevel,
    voiceSeed,
    cfg: CFG,
  });

  it("is `max_dbfs` until the voice level is known", () => {
    expect(pinCeiling(inputs(-42, true, null))).toBe(-20);
    expect(pinCeiling(inputs(null, false, null))).toBe(-20);
  });

  it("then the voice − `voice_margin_db` in a quiet cabin (N −42, V −21): the ceiling EQUALS Auto (−31)", () => {
    expect(autoFloor(inputs(-42, true, -21))).toBe(-31); // max(−32, −31)
    expect(pinCeiling(inputs(-42, true, -21))).toBe(-31); // the 'less' end equals Auto, never below
  });

  it("…and follows Auto UP in a noisy cabin (N −38, V −21): Auto −28 stays on the column", () => {
    expect(autoFloor(inputs(-38, true, -21))).toBe(-28);
    expect(pinCeiling(inputs(-38, true, -21))).toBe(-28);
  });

  it("only ever LOWERS the top to where Auto stands — a loud voice never lifts it past `max_dbfs`", () => {
    expect(pinCeiling(inputs(-60, true, -2))).toBe(-20); // −12 would be above the range
  });

  it("never drops below `min_dbfs` — Auto never does, and the ceiling never drops below Auto", () => {
    expect(pinCeiling(inputs(-90, true, -75))).toBe(-60); // V − vm = −85, Auto clamps to −60
  });

  it("a BORROWED seed is not V (D8): the top stays `max_dbfs`, never under the seeded Auto", () => {
    expect(autoFloor(inputs(-74, true, null, -25))).toBe(-45);
    expect(pinCeiling(inputs(-74, true, null, -25))).toBe(-20); // read as V it would be −35
    expect(pinCeiling(inputs(null, false, null, 5))).toBe(-20); // Auto clamped at the top: equal, not under
  });
});

describe("the BORROWED SEED (D8) — another key's level, at SEED_MARGINS × the voice margin", () => {
  const seeded = (
    noise: number | null,
    settled: boolean,
    voiceLevel: number | null,
    voiceSeed: number | null,
    pin: number | null = null,
    cfg: GateCfg = CFG,
  ) => ({ noise, settled, voiceLevel, voiceSeed, pin, cfg });
  const floor = (...a: Parameters<typeof seeded>): number => effectiveFloor(seeded(...a));

  it("is the policy constant 2 — twice the distance a known level binds at", () => {
    expect(SEED_MARGINS).toBe(2);
  });

  it("with V unknown, raises the floor to seed − 2·vm from the FIRST frame (no estimate, provisional)", () => {
    expect(floor(null, false, null, -20)).toBe(-40); // max(−45 ceiling, −20 − 20)
    expect(floor(-70, false, null, -25)).toBe(-45); // max(min(−60, −45) = −60, −45)
    expect(floor(-70, false, null, null)).toBe(-60); // …the same room unseeded: the clamp
  });

  it("is IGNORED once this key's own V is known — V − vm, never the seed", () => {
    expect(floor(null, false, -25, -10)).toBe(-35); // V − vm; the seed's −30 would be stricter
    expect(floor(-55, true, -40, -10)).toBe(-45); // max(N + nm, V − vm): the seed lifts nothing
  });

  it("SETTLED, measured noise still wins UP — a car over the seed", () => {
    expect(floor(-40, true, null, -30)).toBe(-30); // max(−30, −50)
  });

  it("SETTLED in a QUIET room it keeps binding (L2) — the floor goes DOWN only on this key's own V", () => {
    expect(floor(-74, true, null, -25)).toBe(-45); // max(−64, −45): not the −60 clamp
    expect(floor(-74, true, null, null)).toBe(-60); // …which is what the room alone gives
    expect(floor(-74, true, -40, -25)).toBe(-50); // the LEARNED −40 takes it under the seed's −45
  });

  it("is CLAMPED like every Auto answer, and a quiet seed under the base changes nothing", () => {
    expect(floor(null, false, null, -5)).toBe(-25); // −5 − 20, inside the range
    expect(floor(null, false, null, 10)).toBe(-20); // −10 → `max_dbfs`
    expect(floor(null, false, null, -95)).toBe(-45); // −115: the ceiling wins
    expect(floor(-90, true, null, -95)).toBe(-60); // …and the clamp under it
  });

  it("`voice_margin_db` 0 ⇒ the seed itself", () => {
    expect(floor(null, false, null, -30, null, { ...CFG, voice_margin_db: 0 })).toBe(-30);
  });

  it("a PIN still wins (the escape from a too-strict borrow), below its ceiling", () => {
    expect(floor(-74, true, null, -10, -70)).toBe(-70);
  });

  it("seedBinds: true only when the seed SET the floor", () => {
    expect(seedBinds(seeded(null, false, null, -10))).toBe(true); // −30 over −45
    expect(seedBinds(seeded(-74, true, null, -25))).toBe(true); // −45 over the −60 clamp
    expect(seedBinds(seeded(null, false, null, 10))).toBe(true); // clamped at the top, still over −45
    expect(seedBinds(seeded(null, false, null, null))).toBe(false); // no seed
    expect(seedBinds(seeded(null, false, -25, -10))).toBe(false); // V known: the seed is ignored
    expect(seedBinds(seeded(-40, true, null, -30))).toBe(false); // noise stands higher
    expect(seedBinds(seeded(null, false, null, -95))).toBe(false); // under the ceiling
    expect(seedBinds(seeded(null, false, null, -10, -30))).toBe(false); // a pin stands, even at −30
  });
});
