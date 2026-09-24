// THE RELATIVE LEVEL GATE (Phase 24 / D76 §C, evidence docs/research/R83 · R85) — the call's one
// answer to "was that loud enough to be the owner", in dBFS and RELATIVE to the room it is heard in.
//
// WHAT IT REPLACES. The near-speech gate and the barge floor used to be ABSOLUTE LINEAR RMS numbers
// (Tier 0's dictation threshold, and a call knob falling back to it) — calibrated on one mic, in one
// room, for a different job. The owner's S4 rounds found both faces of that: shouting in the car (the
// floor above a quiet voice on a noisy line) and short false turns at home (the floor below a TV).
// So the floor now FOLLOWS what the microphone hears: a minimum-tracking noise estimate from below,
// the owner's own learned voice level from above, a clamp around both.
//
// PURE BY CONSTRUCTION. Everything here is a function or a small mutable record the call's wiring
// owns — no React, no clocks, no storage — so the three estimators and the floor are pinned by unit
// tests alone (`tests/lib/levelGate.test.ts`), and the hook only decides WHEN to feed them. The
// partition that decides WHICH frames feed them (D76 §B.2: only UPLINKED frames; the held ones belong
// to the leak probe) is the hook's, stated where the frames arrive.
//
// THE UNITS ARE THE CONTRACT: every level here is dBFS (0 = full scale, more negative = quieter) and
// every margin is a dB DIFFERENCE. `rmsToDbfs` is the ONE conversion; nothing else in the call
// compares a linear RMS against anything.

/** The linear RMS the conversion never goes below, i.e. the dBFS every silent frame reads as (−120).
 *  A property of the arithmetic (log of zero), not a preference — digital silence has to land on SOME
 *  finite number, and one far below every floor anyone could configure is the honest choice. */
const RMS_EPSILON = 1e-6;

/** The level a digitally silent frame reads as: `rmsToDbfs(0)`. */
export const DBFS_SILENCE = 20 * Math.log10(RMS_EPSILON);

/** The ONE conversion (D76 §C.1): the worklet's linear RMS (0..1 of full scale) as dBFS. */
export function rmsToDbfs(rms: number): number {
  return 20 * Math.log10(Math.max(rms, RMS_EPSILON));
}

// ── C.2 · the noise floor (WebRTC's minimum-tracking shape, R83) ─────────────────────────────────

/** A full noise window, ms — WebRTC AGC2's own period (R83 ④: min over 5 s, instant down, half-way
 *  up): long enough that talking cannot raise it (speech has gaps, the minimum finds them), short
 *  enough to follow a car that pulled onto the motorway. Owner: estimator policy. */
export const NOISE_WINDOW_MS = 5000;
/** The FIRST window after a (re)capture, ms — a provisional floor fast, before a final can exist
 *  (speech + `silence_ms`), so the bootstrap ceiling rules for one second, not five (Maya F5). Owner:
 *  estimator policy. */
export const NOISE_BOOTSTRAP_MS = 1000;
/** Frames quieter than this are not noise, they are a muted or dead input (R83: WebRTC's own −84 dBFS
 *  discard) — a floor learned from them would sit below any real room and admit everything. Owner:
 *  estimator policy. */
export const NOISE_DISCARD_DBFS = -84;
/** How far one accepted utterance moves the learned voice level (an EMA weight, C.3): three or four
 *  turns to follow a new posture, never one cough to jump. Owner: estimator policy. */
export const VOICE_EMA_ALPHA = 0.3;

/** The minimum tracker's state — mutated in place by `trackNoise`, like the ear meter beside it (a
 *  frame arrives 25–50 times a second; allocating a record per frame buys nothing). */
export interface NoiseTracker {
  /** The quietest admitted frame in the window being collected (`+Infinity` while it is empty). */
  windowMin: number;
  /** How much admitted audio the current window holds, ms. */
  windowMs: number;
  /** The estimate, dBFS — `null` until the first window closes. */
  floor: number | null;
  /** A FULL (5 s) window has closed since the last reset. Until then `floor` is PROVISIONAL (the 1 s
   *  bootstrap's) and the effective floor treats it permissively (C.4); the voice learner waits on it. */
  settled: boolean;
}

export function newNoiseTracker(): NoiseTracker {
  return { windowMin: Infinity, windowMs: 0, floor: null, settled: false };
}

/** Forget everything — a recapture is a different microphone, or the same one somewhere else. */
export function resetNoise(t: NoiseTracker): void {
  t.windowMin = Infinity;
  t.windowMs = 0;
  t.floor = null;
  t.settled = false;
}

/** One UPLINKED frame into the tracker. A window closes when it has collected its length of admitted
 *  audio: a LOWER minimum replaces the floor at once (the room went quiet — believe it), a HIGHER one
 *  moves it halfway (the room got louder — or someone talked for five straight seconds; don't jump). */
export function trackNoise(t: NoiseTracker, dbfs: number, frameMs: number): void {
  if (dbfs < NOISE_DISCARD_DBFS) return;
  if (dbfs < t.windowMin) t.windowMin = dbfs;
  t.windowMs += frameMs;
  const bootstrap = t.floor === null;
  if (t.windowMs < (bootstrap ? NOISE_BOOTSTRAP_MS : NOISE_WINDOW_MS)) return;
  const min = t.windowMin;
  t.floor = t.floor === null || min < t.floor ? min : t.floor + (min - t.floor) / 2;
  if (!bootstrap) t.settled = true;
  t.windowMin = Infinity;
  t.windowMs = 0;
}

// ── C.3 · the own-voice level ────────────────────────────────────────────────────────────────────

/** The gate's configuration — `LiveCfg`'s D76 §C fields, structurally (the wire type satisfies it;
 *  `lib` does not import from `hooks`). */
export interface GateCfg {
  floor_dbfs: number;
  noise_margin_db: number;
  voice_margin_db: number;
  min_dbfs: number;
  max_dbfs: number;
}

/** One utterance's evidence for the learner: the level of every UPLINKED frame between its speech
 *  start and its final, and whether any of them arrived while the reply was audible. */
export interface UtteranceLevels {
  samples: number[];
  duringPlayback: boolean;
}

/** The 90th-percentile level of an utterance (nearest-rank), or `null` for no samples. The loud part
 *  of what was said — the pauses between words would drag a mean toward the room. */
export function p90(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)];
}

/**
 * The learned voice level after one ACCEPTED final (the caller decides acceptance — the reducer took
 * it). Learns ONLY when all three guards hold (Maya F4):
 *  · the noise tracker is SETTLED — the margin below needs a real noise term, not the provisional one;
 *  · the utterance's p90 clears noise + `noise_margin_db` + `voice_margin_db` — an interferer that
 *    barely passed the gate must not teach the gate that it is the owner;
 *  · no frame of it arrived while the reply was audible — the reply's own leak is not the owner's voice.
 * Otherwise the level is returned unchanged. First sample seeds it; later ones move it by the EMA.
 */
export function learnVoice(
  voiceLevel: number | null,
  u: UtteranceLevels,
  noise: NoiseTracker,
  cfg: GateCfg,
): number | null {
  if (!noise.settled || noise.floor === null || u.duringPlayback) return voiceLevel;
  const level = p90(u.samples);
  if (level === null || level < noise.floor + cfg.noise_margin_db + cfg.voice_margin_db) {
    return voiceLevel;
  }
  return voiceLevel === null ? level : voiceLevel + VOICE_EMA_ALPHA * (level - voiceLevel);
}

// ── C.4 · the effective floor ────────────────────────────────────────────────────────────────────

/**
 * THE EFFECTIVE FLOOR (D76 §C.4), dBFS — the ONE normalize every consumer reads (the gate's accrual,
 * the barge floor under `playback_margin_db`, the debug readout, S1's meter marker).
 *
 * Truth table (N = noise floor, V = voice level, nm/vm = the margins, F = `floor_dbfs`,
 * clamp = into [`min_dbfs`, `max_dbfs`]):
 *
 *   pin   | N     | settled | V     | floor
 *   ------+-------+---------+-------+------------------------------------------------
 *   P     | any   | any     | any   | P                     (the owner's per-call pin)
 *   null  | null  | —       | null  | clamp(F)              (no estimate yet: the ceiling)
 *   null  | null  | —       | V     | clamp(max(F, V − vm))
 *   null  | N     | no      | null  | clamp(min(N + nm, F)) (provisional: never stricter than F)
 *   null  | N     | no      | V     | clamp(max(min(N + nm, F), V − vm))
 *   null  | N     | yes     | null  | clamp(N + nm)
 *   null  | N     | yes     | V     | clamp(max(N + nm, V − vm))
 *
 * The own-voice term applies as soon as V is KNOWN — seeded from the device store or learned —
 * including before any noise estimate exists (the micro-confirm fold: "with a seeded voice level it
 * fails V − vm from the first frame"); only LEARNING waits for a settled tracker. The pin is taken as
 * given: it is the owner's explicit choice for this call, and S1's control bounds it.
 */
export function effectiveFloor(args: {
  noise: number | null;
  settled: boolean;
  voiceLevel: number | null;
  pin: number | null;
  cfg: GateCfg;
}): number {
  const { noise, settled, voiceLevel, pin, cfg } = args;
  if (pin !== null) return pin;
  let base: number;
  if (noise === null) base = cfg.floor_dbfs;
  else if (settled) base = noise + cfg.noise_margin_db;
  else base = Math.min(noise + cfg.noise_margin_db, cfg.floor_dbfs);
  if (voiceLevel !== null) base = Math.max(base, voiceLevel - cfg.voice_margin_db);
  return Math.min(Math.max(base, cfg.min_dbfs), cfg.max_dbfs);
}
