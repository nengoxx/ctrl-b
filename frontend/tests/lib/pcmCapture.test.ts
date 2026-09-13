import { beforeEach, describe, expect, it, vi } from "vitest";

import { startPcmCapture } from "../../src/lib/pcmCapture";

// lib/pcmCapture — the call's EAR, opened. The worklet's arithmetic is pinned by `pcmWorklet.test.ts`
// (which evaluates the shipped source against a fake processor); what is pinned HERE is the chain's
// failure contract: a capture that cannot actually run must FAIL the start rather than hand back a
// silent ear, and nothing it allocated on the way may be left behind.

/** The Web Audio stand-ins, minimal and driveable. `state` is the whole point of the suspended case. */
class FakeContext {
  static last: FakeContext | null = null;
  state: AudioContextState = "running";
  sampleRate = 48000;
  closed = 0;
  resumes = 0;
  /** What `resume()` leaves the context in — a policy that refuses the resume leaves it suspended. */
  resumesTo: AudioContextState = "running";
  audioWorklet = { addModule: vi.fn(async () => {}) };
  constructor() {
    FakeContext.last = this;
  }
  async resume(): Promise<void> {
    this.resumes += 1;
    this.state = this.resumesTo;
  }
  async close(): Promise<void> {
    this.closed += 1;
    this.state = "closed";
  }
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  createGain() {
    return { gain: { value: 1 }, connect: () => {} };
  }
  destination = {};
}

class FakeTrack {
  stopped = 0;
  listeners: Record<string, (() => void)[]> = {};
  stop() {
    this.stopped += 1;
  }
  getSettings() {
    return { echoCancellation: "all" };
  }
  addEventListener(type: string, cb: () => void) {
    (this.listeners[type] ||= []).push(cb);
  }
}

let track: FakeTrack;
let minted: string[] = [];
let revoked: string[] = [];

beforeEach(() => {
  track = new FakeTrack();
  minted = [];
  revoked = [];
  FakeContext.last = null;
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      port = { onmessage: null };
      connect() {}
    },
  );
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => ({
        getAudioTracks: () => [track],
        getTracks: () => [track],
      })),
    },
  });
  URL.createObjectURL = vi.fn(() => {
    minted.push("blob:worklet");
    return "blob:worklet";
  });
  URL.revokeObjectURL = vi.fn((u: string) => void revoked.push(u));
});

describe("startPcmCapture — the context has to actually RUN", () => {
  it("opens the chain when the context is running, and reads the echo capability back", async () => {
    const cap = await startPcmCapture({ frameMs: 20, onFrame: () => {}, onEnded: () => {} });
    expect(cap.sampleRate).toBe(48000);
    expect(cap.echoCancellation).toBe("all");
    expect(track.stopped).toBe(0);
  });

  it("resumes a suspended context — the ordinary autoplay-policy case", async () => {
    vi.stubGlobal(
      "AudioContext",
      class extends FakeContext {
        constructor() {
          super();
          this.state = "suspended";
        }
      },
    );
    await startPcmCapture({ frameMs: 20, onFrame: () => {}, onEnded: () => {} });
    expect(FakeContext.last?.resumes).toBe(1);
  });

  it("FAILS the start when it stays suspended, and releases everything it took", async () => {
    // The silent call: the graph builds, the worklet installs, and not one render quantum is ever
    // pulled — the overlay would reach "Listening" with a dead ear and sit there forever.
    vi.stubGlobal(
      "AudioContext",
      class extends FakeContext {
        constructor() {
          super();
          this.state = "suspended";
          this.resumesTo = "suspended";
        }
      },
    );
    await expect(
      startPcmCapture({ frameMs: 20, onFrame: () => {}, onEnded: () => {} }),
    ).rejects.toThrow();
    expect(track.stopped).toBe(1); // the mic light goes out
    expect(FakeContext.last?.closed).toBe(1);
    expect(minted).toEqual([]); // it fails before the worklet Blob is even minted
  });

  it("a failure PAST the worklet releases its Blob URL too", async () => {
    vi.stubGlobal(
      "AudioContext",
      class extends FakeContext {
        constructor() {
          super();
          this.audioWorklet = { addModule: vi.fn(async () => Promise.reject(new Error("nope"))) };
        }
      },
    );
    await expect(
      startPcmCapture({ frameMs: 20, onFrame: () => {}, onEnded: () => {} }),
    ).rejects.toThrow();
    expect(track.stopped).toBe(1);
    expect(FakeContext.last?.closed).toBe(1);
    expect(revoked).toEqual(["blob:worklet"]);
  });
});
