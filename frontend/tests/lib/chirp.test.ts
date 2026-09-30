import { describe, expect, it } from "vitest";

import {
  CHIRP_MIN_PEAK,
  CHIRP_MS,
  CHIRP_SEARCH_MS,
  ChirpMatcher,
  chirpTemplate,
  type ChirpResult,
} from "../../src/lib/chirp";

// lib/chirp — THE CONNECT CHIRP's matcher (D80 ⑦, evidence docs/research/R93 §V). A synthetic mic stream
// at the device rate, cut into the worklet's frames with the context time of each frame's first sample
// — exactly what the capture hands the wiring — built around the car round's own numbers: a return
// ~2.3 s late, as loud as the owner (−15 dBFS), over a −42 dBFS cabin.

const RATE = 48000;
const FRAME = 1920; // 40 ms at 48 kHz, the shipped `frame_ms`
const WHEN = 10; // the sweep's scheduled start, in context seconds

/** A seeded PRNG (mulberry32), so every stream is the same stream. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dbToAmp = (db: number): number => 10 ** (db / 20);
const rms = (x: Float32Array): number => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

/** The whole mic stream from `WHEN − 0.2 s` to past the window: the sweep returned `lagMs` late at
 *  `echoDb` RMS (or not at all), white noise at `noiseDb` RMS, and an optional extra layer — at the
 *  device's 48 kHz unless a case asks for another capture `rate` (K6's 16 kHz). */
function stream(opts: {
  lagMs: number | null;
  echoDb?: number;
  noiseDb?: number;
  extra?: (t: number) => number;
  rate?: number;
}): { start: number; x: Float32Array; rate: number } {
  const rate = opts.rate ?? RATE;
  const start = WHEN - 0.2;
  const n = Math.ceil((0.2 + (CHIRP_SEARCH_MS + CHIRP_MS) / 1000 + 0.2) * rate);
  const x = new Float32Array(n);
  const rand = rng(7);
  const noiseAmp = dbToAmp(opts.noiseDb ?? -42) * Math.sqrt(3); // uniform ±a has RMS a/√3
  for (let i = 0; i < n; i++)
    x[i] = (rand() * 2 - 1) * noiseAmp + (opts.extra?.(start + i / rate) ?? 0);
  if (opts.lagMs !== null) {
    const tpl = chirpTemplate(rate);
    const gain = dbToAmp(opts.echoDb ?? -15) / rms(tpl);
    const at = Math.round((0.2 + opts.lagMs / 1000) * rate);
    for (let i = 0; i < tpl.length && at + i < n; i++) x[at + i] += tpl[i] * gain;
  }
  return { start, x, rate };
}

/** Feed `x` to the matcher frame by frame, as pcm16 LE with each frame's context time; the results it
 *  returned, in order (it must return exactly one). */
function run(
  s: { start: number; x: Float32Array; rate?: number },
  m = new ChirpMatcher(s.rate ?? RATE, WHEN),
): ChirpResult[] {
  const rate = s.rate ?? RATE;
  const frame = (FRAME * rate) / RATE; // the same 40 ms at whatever rate the capture runs
  const out: ChirpResult[] = [];
  for (let f = 0; f * frame < s.x.length; f++) {
    const len = Math.min(frame, s.x.length - f * frame);
    const buf = new ArrayBuffer(len * 2);
    const view = new DataView(buf);
    for (let i = 0; i < len; i++) {
      const v = Math.max(-1, Math.min(1, s.x[f * frame + i]));
      view.setInt16(i * 2, Math.round(v < 0 ? v * 32768 : v * 32767), true);
    }
    const r = m.feed(buf, s.start + (f * frame) / rate);
    if (r !== undefined) out.push(r);
  }
  return out;
}

describe("ChirpMatcher — the car's return, found (R93 §V)", () => {
  it("finds a return 2300 ms late at −15 dBFS over −42 dBFS noise, within ±5 ms", () => {
    const [r] = run(stream({ lagMs: 2300 }));
    expect(r.lagMs).not.toBeNull();
    expect(Math.abs(r.lagMs! - 2300)).toBeLessThanOrEqual(5);
    expect(r.peak).toBeGreaterThanOrEqual(CHIRP_MIN_PEAK);
    expect(r.peak).toBeGreaterThanOrEqual(3 * r.second);
  });

  it("…still found with the owner TALKING over it — a voiced, syllabic band at the echo's own level", () => {
    // 150 Hz voice, harmonics through 3 kHz (a sine's weakness is that speech shares its harmonics; a
    // sweep's is not), syllables at 4 Hz, over the whole window.
    const voice = (t: number): number => {
      let s = 0;
      for (let k = 1; k <= 20; k++) s += Math.sin(2 * Math.PI * 150 * k * t) / k;
      return s * 0.12 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t));
    };
    const [r] = run(stream({ lagMs: 2300, extra: voice }));
    expect(r.lagMs).not.toBeNull();
    expect(Math.abs(r.lagMs! - 2300)).toBeLessThanOrEqual(5);
  });

  it("K6 — at the 16 kHz capture rate (factor 1, nothing decimated) the same return is found", () => {
    const [r] = run(stream({ lagMs: 2300, rate: 16000 }));
    expect(r.lagMs).not.toBeNull();
    expect(Math.abs(r.lagMs! - 2300)).toBeLessThanOrEqual(5);
    expect(r.peak).toBeGreaterThanOrEqual(CHIRP_MIN_PEAK);
    expect(r.peak).toBeGreaterThanOrEqual(3 * r.second);
    // …and no return is still `null` there — never a guess
    expect(run(stream({ lagMs: null, rate: 16000 }))[0].lagMs).toBeNull();
  });

  it("finds a headphone-short return too — the lag is whatever the path is", () => {
    const [r] = run(stream({ lagMs: 180, echoDb: -30 }));
    expect(Math.abs(r.lagMs! - 180)).toBeLessThanOrEqual(5);
  });

  it("NO return (headphones, a muted car) ⇒ `lagMs: null` — never a guess", () => {
    const [r] = run(stream({ lagMs: null }));
    expect(r.lagMs).toBeNull();
    expect(r.peak).toBeLessThan(CHIRP_MIN_PEAK);
  });

  it("…and digital silence (a muted track) concludes `null` without dividing by nothing", () => {
    const [r] = run({ start: WHEN - 0.2, x: new Float32Array(7 * RATE) });
    expect(r).toEqual({ lagMs: null, peak: 0, second: 0 });
  });

  it("delivers its conclusion EXACTLY ONCE, on the frame that closes the window", () => {
    const m = new ChirpMatcher(RATE, WHEN);
    const results = run(stream({ lagMs: 2300 }), m);
    expect(results).toHaveLength(1);
    const late = new ArrayBuffer(FRAME * 2);
    expect(m.feed(late, WHEN + 8)).toBeUndefined(); // ever after: nothing
  });

  it("frames that stop short of the window conclude nothing — the caller drops the matcher", () => {
    const s = stream({ lagMs: 2300 });
    const results = run({ start: s.start, x: s.x.subarray(0, 3 * RATE) });
    expect(results).toEqual([]);
  });

  it("stays cheap at frame cadence — the whole 6 s window's work, measured", () => {
    const s = stream({ lagMs: 2300 });
    const t0 = performance.now();
    run(s);
    const ms = performance.now() - t0;
    // ~150 frames: this is the TOTAL for all of them (see the report for the per-frame figure).
    expect(ms).toBeLessThan(3000);
  });
});
