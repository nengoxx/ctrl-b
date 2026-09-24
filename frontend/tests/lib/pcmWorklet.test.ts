import { describe, expect, it } from "vitest";

import { PCM_WORKLET_NAME, PCM_WORKLET_SOURCE } from "../../src/lib/pcmWorklet";

// lib/pcmWorklet — the capture processor's arithmetic (D71 §3.1/§4.3), tested as the browser will run
// it. The processor ships as a SOURCE STRING (see the module's own note on why), so these arms EVALUATE
// that exact string against a fake `AudioWorkletProcessor` + `registerProcessor` and drive the real
// `process()`. Nothing is re-implemented beside it: the frame arithmetic, the pcm16 clamp and the RMS
// have one definition, and this is it.

interface Posted {
  buf: ArrayBuffer;
  rms: number;
}

/** Instantiate the SHIPPED processor source in a fake worklet scope. */
function processor(frameSamples: number): {
  feed: (block: Float32Array) => void;
  process: (inputs: unknown) => boolean;
  posted: Posted[];
  name: string;
} {
  const posted: Posted[] = [];
  let registered: {
    name: string;
    ctor: new (o: unknown) => { process: (i: unknown) => boolean };
  } | null = null;
  class FakeWorkletProcessor {
    port = {
      postMessage: (msg: Posted, transfer?: unknown[]) => {
        // The real port TRANSFERS the buffer; assert the shipped code actually asks for it, then keep
        // a copy the way a real `message` event would deliver one.
        expect(transfer).toEqual([msg.buf]);
        posted.push(msg);
      },
    };
  }
  const register = (name: string, ctor: unknown): void => {
    registered = { name, ctor: ctor as never };
  };
  // Evaluating the shipped source IS the subject: a worklet global scope is exactly a function body
  // handed `AudioWorkletProcessor` + `registerProcessor`, and re-implementing the processor beside it
  // would test a copy instead of the code the browser runs.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  new Function("AudioWorkletProcessor", "registerProcessor", PCM_WORKLET_SOURCE)(
    FakeWorkletProcessor,
    register,
  );
  if (registered === null) throw new Error("the worklet source registered nothing");
  const { name, ctor } = registered as {
    name: string;
    ctor: new (o: unknown) => { process: (i: unknown) => boolean };
  };
  const node = new ctor({ processorOptions: { frameSamples } });
  return {
    feed: (block) => void node.process([[block]]),
    process: (inputs) => node.process(inputs),
    posted,
    name,
  };
}

/** The pcm16 samples of one posted frame, read back as the wire reads them: LITTLE-ENDIAN. */
const samplesOf = (p: Posted): number[] => {
  const view = new DataView(p.buf);
  return Array.from({ length: p.buf.byteLength / 2 }, (_, i) => view.getInt16(i * 2, true));
};

describe("the pcm worklet — framing", () => {
  it("registers under the name the capture asks for", () => {
    expect(processor(4).name).toBe(PCM_WORKLET_NAME);
  });

  it("accumulates 128-sample render quanta into ONE frame of the configured size", () => {
    const { feed, posted } = processor(320); // 40 ms at 8 kHz
    for (let i = 0; i < 2; i++) feed(new Float32Array(128));
    expect(posted).toHaveLength(0); // 256 < 320
    feed(new Float32Array(128));
    expect(posted).toHaveLength(1); // 384 crosses it — and the remainder is CARRIED
    expect(posted[0].buf.byteLength).toBe(640);
    for (let i = 0; i < 2; i++) feed(new Float32Array(128));
    expect(posted).toHaveLength(2); // 64 carried + 256 = 320 exactly
  });

  it("carries the remainder rather than dropping it — no sample is ever lost at a frame edge", () => {
    const { feed, posted } = processor(4);
    feed(Float32Array.from([1, 1, 1, 1, 1, 1]));
    expect(posted).toHaveLength(1);
    feed(Float32Array.from([1, 1]));
    // The two carried samples plus these two make the second frame: 8 samples in, 8 samples out.
    expect(posted).toHaveLength(2);
    expect(posted.flatMap(samplesOf)).toHaveLength(8);
  });

  it("an ABSENT input keeps the processor alive — returning false would retire it for the call", () => {
    const p = processor(4);
    // The graph still connecting, or a track that produced no channel this quantum.
    expect(p.process([[]])).toBe(true);
    expect(p.process([])).toBe(true);
    expect(p.posted).toHaveLength(0);
    // …and it still frames normally afterwards.
    p.feed(Float32Array.from([1, 1, 1, 1]));
    expect(p.posted).toHaveLength(1);
  });
});

describe("the pcm worklet — float32 → pcm16 LE", () => {
  it("maps the full-scale ends without wrapping, and rounds", () => {
    const { feed, posted } = processor(4);
    feed(Float32Array.from([1, -1, 0, 0.5]));
    expect(samplesOf(posted[0])).toEqual([32767, -32768, 0, Math.round(0.5 * 32767)]);
  });

  it("CLAMPS out-of-range samples (Web Audio does not promise −1..1 after a gain)", () => {
    const { feed, posted } = processor(2);
    feed(Float32Array.from([2.5, -9]));
    expect(samplesOf(posted[0])).toEqual([32767, -32768]);
  });

  it("writes LITTLE-ENDIAN bytes, whatever the platform's typed-array order is", () => {
    const { feed, posted } = processor(1);
    feed(Float32Array.from([1]));
    const bytes = new Uint8Array(posted[0].buf);
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0x7f]); // 32767 = 0x7FFF, low byte first
  });
});

describe("the pcm worklet — the RMS the barge-in gate reads", () => {
  it("is the root-mean-square of the frame's own samples", () => {
    const { feed, posted } = processor(4);
    feed(Float32Array.from([0.5, -0.5, 0.5, -0.5]));
    expect(posted[0].rms).toBeCloseTo(0.5, 10);
  });

  it("is 0 for silence and 1 for full scale — the linear RMS `rmsToDbfs` converts (D76 §C.1)", () => {
    const { feed, posted } = processor(2);
    feed(Float32Array.from([0, 0]));
    feed(Float32Array.from([1, -1]));
    expect(posted[0].rms).toBe(0);
    expect(posted[1].rms).toBeCloseTo(1, 10);
  });

  it("measures the RAW float, NOT the clamped integer — a hot mic reads over the floor honestly", () => {
    const { feed, posted } = processor(2);
    feed(Float32Array.from([2, 2]));
    expect(posted[0].rms).toBeCloseTo(2, 10);
  });
});
