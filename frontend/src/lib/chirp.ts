import { CUE_GAIN, CUE_LATENCY_MS, CUE_RAMP_MS } from "./callCue";

// THE CONNECT CHIRP (Phase 24 / D80 ⑦, evidence docs/research/R93 §V · R91 §1) — a short sweep the call
// plays once per capture, and the microphone listens for, to MEASURE how late this output path really
// plays: the one number the web cannot read (Android's Bluetooth drivers discard delay reports ≥ 1 s,
// R91 §1.4, so `outputLatency` says ~0.28 s over a car that plays ~2.3 s late).
//
// WHY A SWEEP. Every calibrator of this kind uses a DEDICATED TEST SIGNAL matched by normalised
// cross-correlation (WebRTC AEC3's matched filter, OboeTester's pulse, jack_iodelay's tones, BeepBeep's
// chirps — R93 §V.b3). A 1→3 kHz linear sweep is found every time in R93's car model — under cabin
// noise louder than the echo, and with the owner talking over it (voiced speech shares a sine's
// harmonics; it does not share a sweep's) — with sub-millisecond lag error, and it doubles as the
// call's "connected" sound (the owner: "it's only once, no problem at all").
//
// THIS WAVE PLAYS AND LOGS IT, NOTHING MORE (D80 ⑦): the lag goes to the trail and the debug readout;
// nothing reads it for policy. Wave 1.5 — after one car round shows the chirp's lag agrees with each
// reply's measured tail — lets it SET the tail hold (see the seam in `useLiveCall`).
//
// ONE CLOCK. The chirp is scheduled on the CAPTURE's own AudioContext (the drop cue's context — already
// running, already gesture-unlocked), and every mic frame carries that same context's time for its first
// sample (the worklet stamps it, `pcmWorklet`), so "when it played" and "when the mic heard it" are
// read off one clock with no `performance.now()` jitter between them (R93 §V.d's timing rule).

/** The sweep's length, ms (R93 §V: 150 ms). Owner: the sweep's own shape (fixed). */
export const CHIRP_MS = 150;
/** Its start and end frequency, Hz — inside every phone speaker's and car speaker's band and far from
 *  the cabin's low rumble (R93 §V: a 1→3 kHz linear up-sweep). Owner: the sweep's own shape. */
export const CHIRP_F0_HZ = 1000;
export const CHIRP_F1_HZ = 3000;
/** Its level: the drop cue's own — audible over a car, well under the reply (R93 §V: peak 0.15). */
export const CHIRP_GAIN = CUE_GAIN;
/** How far ahead of `currentTime` it is scheduled, ms: a start in the past plays truncated, and the
 *  matcher's window must open before the sweep's first sample. A property of scheduling, not a knob. */
export const CHIRP_LEAD_MS = 50;
/** How long the EAR treats frames as not-uplinked around the chirp — its own window, the way
 *  `CUE_HOLD_MS` covers the cue (the lead, the sweep, and the same output-latency allowance), so the
 *  gate, the noise tracker and the learner never take our own sound for the owner. The MATCHER sees
 *  every frame regardless. A car's echo of it returns later than this (that is what is measured); the
 *  relay's gap cut (D80 ④) is what disposes of a flap it may raise. */
export const CHIRP_HOLD_MS = CHIRP_LEAD_MS + CHIRP_MS + CUE_LATENCY_MS;
/** How long after the sweep's start the matcher looks for its return, ms (R91 §1.5: car head units
 *  1–3 s, some 6 s). Past it: no return — nothing changes (R93 §V's safety rule: never "no hold"). */
export const CHIRP_SEARCH_MS = 6000;
/** THE DETECTION CRITERION (R93 §V.d, the Opus-verified numbers): a return is FOUND only when the
 *  normalised cross-correlation peak is ≥ 0.35 — the modelled no-return (null) maximum was 0.07–0.13,
 *  the weakest modelled hit 0.40 (under −15 dBFS rumble) — AND ≥ 3× the second-best peak outside
 *  ±20 ms (a chance match in speech is broad and repeats; a real return is one sharp lobe). The shape
 *  of the detector, not a preference: nothing about the owner changes it. */
export const CHIRP_MIN_PEAK = 0.35;
export const CHIRP_PEAK_RATIO = 3;
export const CHIRP_EXCLUDE_MS = 20;
/** The rate the matcher correlates at, Hz: the capture runs at the DEVICE rate (44.1/48 kHz), where
 *  direct correlation over the 6 s window is ~2×10⁹ multiply-adds; boxcar-decimated to ~16 kHz it is
 *  ~2×10⁸ spread across 6 s of frames, and the 3 kHz top of the sweep keeps its phase (a coarser grid
 *  would cost up to a third of the peak at the worst sub-sample offset). R93 §V ran its detection at
 *  16 kHz. A property of the arithmetic, not a knob. */
export const CHIRP_MATCH_RATE = 16000;

/** The sweep at `sampleRate`, unit peak: a linear 1→3 kHz chirp under raised-cosine ramps (a sweep
 *  switched on or off at full gain clicks — the cue's `CUE_RAMP_MS`, shaped as a Hann edge). The ONE
 *  definition of the signal: `playChirp` plays exactly these samples and the matcher correlates
 *  against them, so the template cannot drift from what came out of the speaker. */
export function chirpTemplate(sampleRate: number): Float32Array<ArrayBuffer> {
  const n = Math.max(1, Math.round((CHIRP_MS * sampleRate) / 1000));
  const ramp = Math.max(1, Math.round((CUE_RAMP_MS * sampleRate) / 1000));
  const dur = n / sampleRate;
  const sweep = (CHIRP_F1_HZ - CHIRP_F0_HZ) / dur; // Hz per second
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const phase = 2 * Math.PI * (CHIRP_F0_HZ * t + (sweep * t * t) / 2);
    const edge = Math.min(i, n - 1 - i);
    const w = edge >= ramp ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * edge) / ramp);
    out[i] = Math.sin(phase) * w;
  }
  return out;
}

/** Play the chirp once on `ctx`, starting at context time `when`. `false` when the context is not
 *  running (a teardown race, a platform suspend) — nothing played, so there is nothing to listen for. */
export function playChirp(ctx: AudioContext, when: number): boolean {
  if (ctx.state !== "running") return false;
  const samples = chirpTemplate(ctx.sampleRate);
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = CHIRP_GAIN;
  src.connect(gain);
  gain.connect(ctx.destination);
  // The pair retires itself, the drop cue's rule: a finished one-shot left connected is graph litter.
  src.onended = () => {
    src.disconnect();
    gain.disconnect();
  };
  src.start(when);
  return true;
}

/** What the matcher concluded, once: the return's lag after the sweep's scheduled start, ms — `null`
 *  when nothing cleared the criterion — with the correlation peak and the best peak outside ±20 ms of
 *  it (the criterion's two numbers, kept for the trail). */
export interface ChirpResult {
  lagMs: number | null;
  peak: number;
  second: number;
}

/** Box-average `x` down by `factor` (the decimation's anti-alias: crude, but applied identically to the
 *  template and to the mic, so it is part of the matched filter rather than an error in it). */
function decimate(x: Float32Array<ArrayBuffer>, factor: number): Float32Array<ArrayBuffer> {
  if (factor === 1) return x;
  const out = new Float32Array(Math.floor(x.length / factor));
  for (let k = 0; k < out.length; k++) {
    let s = 0;
    for (let i = 0; i < factor; i++) s += x[k * factor + i];
    out[k] = s / factor;
  }
  return out;
}

/**
 * THE MATCHER: fed every mic frame (pcm16 LE, with the context time of its first sample), it keeps the
 * window `[when, when + CHIRP_SEARCH_MS + CHIRP_MS)` decimated to ~16 kHz, correlates the sweep's
 * template at every lag as soon as that lag's samples are in (so the work is spread across the frames
 * that arrive, a few hundred lags each), and — once the window has closed — returns its conclusion
 * EXACTLY ONCE; every call after that returns `undefined`.
 *
 * Local normalised cross-correlation: `Σ t·x / (‖t‖·‖x_window‖)` per lag, so a loud cabin cannot fake a
 * match by energy alone and the peak reads 0…1 against R93's numbers. The allocation is two arrays per
 * CAPTURE (the window and its per-lag scores, ~0.8 MB at 16 kHz), released with the matcher.
 */
export class ChirpMatcher {
  private readonly factor: number;
  private readonly rate: number;
  private readonly template: Float32Array;
  private readonly templateNorm: number;
  /** The decimated window, and how many of its samples are complete. */
  private readonly x: Float32Array;
  private avail = 0;
  /** Per-lag scores, the next lag to score, and the energy of the samples under that lag's window —
   *  kept as a RUNNING sum (one sample in, one out per lag), so a lag costs one pass of multiply-adds,
   *  not two. */
  private readonly ncc: Float32Array;
  private next = 0;
  private energy = 0;
  private done = false;

  /** @param sampleRate the capture context's own rate. @param when the sweep's scheduled start, in
   *  that context's time (`playChirp`'s `when`). */
  constructor(
    private readonly sampleRate: number,
    private readonly when: number,
  ) {
    this.factor = Math.max(1, Math.round(sampleRate / CHIRP_MATCH_RATE));
    this.rate = sampleRate / this.factor;
    this.template = decimate(chirpTemplate(sampleRate), this.factor);
    let e = 0;
    for (const v of this.template) e += v * v;
    this.templateNorm = Math.sqrt(e);
    const lags = Math.floor((CHIRP_SEARCH_MS * this.rate) / 1000) + 1;
    this.ncc = new Float32Array(lags);
    this.x = new Float32Array(lags + this.template.length - 1);
  }

  /** One mic frame: `buf` = pcm16 LE samples, `t` = the context time of its first sample. Returns the
   *  conclusion on the frame that closes the window, `undefined` before it and ever after. */
  feed(buf: ArrayBuffer, t: number): ChirpResult | undefined {
    if (this.done) return undefined;
    const view = new DataView(buf);
    const count = buf.byteLength >> 1;
    const first = Math.round((t - this.when) * this.sampleRate);
    const { factor, x } = this;
    for (let i = 0; i < count; i++) {
      const full = first + i;
      if (full < 0) continue; // before the sweep's start: not the window
      const k = Math.floor(full / factor);
      if (k >= x.length) break;
      x[k] += view.getInt16(i * 2, true) / 32768 / factor;
    }
    // A decimated sample is complete once its last full-rate sample has arrived.
    const through = Math.min(x.length, Math.floor((first + count) / factor));
    if (through > this.avail) this.avail = through;
    this.score();
    if (this.next < this.ncc.length) return undefined;
    this.done = true;
    return this.conclude();
  }

  /** Score every lag whose window of samples is now complete. */
  private score(): void {
    const { template, x, ncc } = this;
    const n = template.length;
    while (this.next < ncc.length && this.next + n <= this.avail) {
      const lag = this.next;
      if (lag === 0) {
        for (let i = 0; i < n; i++) this.energy += x[i] * x[i];
      } else {
        const out = x[lag - 1];
        const inn = x[lag + n - 1];
        this.energy += inn * inn - out * out;
      }
      let dot = 0;
      for (let i = 0; i < n; i++) dot += template[i] * x[lag + i];
      // A window of (near-)digital silence has no direction to correlate — and the running sum can
      // land a hair under zero there, which the guard also absorbs.
      ncc[lag] = this.energy > 1e-12 ? dot / (this.templateNorm * Math.sqrt(this.energy)) : 0;
      this.next += 1;
    }
  }

  private conclude(): ChirpResult {
    const { ncc } = this;
    let best = 0;
    for (let i = 1; i < ncc.length; i++) if (ncc[i] > ncc[best]) best = i;
    const exclude = Math.round((CHIRP_EXCLUDE_MS * this.rate) / 1000);
    let second = 0;
    for (let i = 0; i < ncc.length; i++)
      if (Math.abs(i - best) > exclude && ncc[i] > second) second = ncc[i];
    const peak = ncc[best];
    const found = peak >= CHIRP_MIN_PEAK && peak >= CHIRP_PEAK_RATIO * second;
    return { lagMs: found ? (best * 1000) / this.rate : null, peak, second };
  }
}
