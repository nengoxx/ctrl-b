import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listAudioInputs,
  micConstraints,
  openMicStream,
  startPcmCapture,
} from "../../src/lib/pcmCapture";

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
  enabled = true;
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
/** The stubbed `getUserMedia` — what the ROUTE cases assert against (the constraints are the whole
 *  mechanism: on Chrome Android they decide the device's audio mode, R74 §1.3). */
let gum: ReturnType<typeof vi.fn>;
/** What a case wants `enumerateDevices()` to answer, in order of the reads it takes. */
let enumerated: { kind: string; deviceId: string; label: string }[][] = [];

/** The audio constraints of the `getUserMedia` call at `i`, as a plain object. */
const askedAt = (i: number): Record<string, unknown> =>
  (gum.mock.calls[i][0] as { audio: Record<string, unknown> }).audio;

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
  gum = vi.fn(async () => ({
    getAudioTracks: () => [track],
    getTracks: () => [track],
  }));
  enumerated = [];
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: gum,
      enumerateDevices: vi.fn(async () => enumerated.shift() ?? []),
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

  it("MUTE disables the TRACK and nothing else — the frames must keep flowing (D71 F3)", async () => {
    // The one mechanism: disabling the track silences the samples while the worklet keeps shipping
    // them, because Speaches has to OBSERVE the silence to endpoint a half-spoken phrase. Stopping
    // the uplink instead would leave that utterance open to merge with whatever is said after.
    const cap = await startPcmCapture({ frameMs: 20, onFrame: () => {}, onEnded: () => {} });
    cap.setMuted(true);
    expect(track.enabled).toBe(false);
    expect(track.stopped).toBe(0); // the ear is closed, not released
    expect(FakeContext.last?.closed).toBe(0);
    cap.setMuted(false);
    expect(track.enabled).toBe(true);

    // …and a released capture is not a muted one: re-enabling a torn-down track would be a lie.
    cap.stop();
    cap.setMuted(false);
    expect(track.enabled).toBe(true);
    cap.setMuted(true);
    expect(track.enabled).toBe(true);
  });

  it("the EAR-HOLD is the same mechanism, and the two never answer for each other (S3)", async () => {
    // Mute is the owner's and the hold is the machine's (§5.1's `echo_workaround`), so they overlap
    // freely: whichever is standing keeps the track disabled, and only BOTH being clear reopens it. A
    // setter writing `track.enabled` on its own would silently revoke the other's decision.
    const cap = await startPcmCapture({ frameMs: 20, onFrame: () => {}, onEnded: () => {} });
    cap.setHeld(true);
    expect(track.enabled).toBe(false);
    cap.setMuted(true);
    cap.setHeld(false); // the reply ended — but the owner is still muted
    expect(track.enabled).toBe(false);
    cap.setMuted(false);
    expect(track.enabled).toBe(true);

    // …and the other way round: an unmute under a live hold does not reopen the ear either.
    cap.setHeld(true);
    cap.setMuted(true);
    cap.setMuted(false);
    expect(track.enabled).toBe(false);
    expect(track.stopped).toBe(0); // closed, never released

    cap.stop();
    cap.setHeld(false);
    expect(track.enabled).toBe(false); // a released capture is not an open one
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

// ── D73 S5 · THE ROUTE (evidence docs/research/R74) ──────────────────────────────────────────────

describe("micConstraints — the route IS the constraint (R74 §1.3)", () => {
  it("speaker asks for the subtractive mode; headphones clear the ask entirely", () => {
    // Clearing AEC empties Android's platform-effects mask, which is the single bit that decides
    // whether Chrome puts the device into MODE_IN_COMMUNICATION and re-tags its own output as
    // voice-communication. `noiseSuppression` runs in software and survives both routes.
    expect(micConstraints({ route: "speaker" })).toMatchObject({
      echoCancellation: { ideal: "all" },
      noiseSuppression: true,
      channelCount: 1,
    });
    expect(micConstraints({ route: "headphones" })).toMatchObject({
      echoCancellation: false,
      noiseSuppression: true,
      channelCount: 1,
    });
  });

  it("an absent or unknown route is the SPEAKER route — a pre-S5 backend keeps today's ear", () => {
    expect(micConstraints({})).toMatchObject({ echoCancellation: { ideal: "all" } });
    expect(micConstraints({ route: "earpiece" })).toMatchObject({
      echoCancellation: { ideal: "all" },
    });
  });

  it("a device rides as IDEAL, never exact — and an empty one is not a constraint at all", () => {
    expect(micConstraints({ deviceId: "dev-7" })).toMatchObject({ deviceId: { ideal: "dev-7" } });
    expect(micConstraints({ deviceId: "" })).not.toHaveProperty("deviceId");
  });
});

/** What `getUserMedia` rejects with. A browser throws a `DOMException`, which inherits from `Error`
 *  there (WebIDL) — jsdom's deliberately does not, so a literal `new DOMException(...)` would be a
 *  double the production code never meets. The NAME is the whole payload either way. */
const gumError = (name: string): Error => Object.assign(new Error(name), { name });

describe("openMicStream — the picked device's ONE retry (R74 §2.2(b))", () => {
  it("falls back to the default when the picked device will not open, and SAYS so", async () => {
    // The Android failure is not a constraint the browser relaxes: an unavailable communication
    // device makes the stream come back null, i.e. getUserMedia rejects. `ideal` cannot save it —
    // this retry can.
    gum.mockRejectedValueOnce(gumError("NotReadableError"));
    const opened = await openMicStream({ route: "headphones", deviceId: "gone" });
    expect(opened.fellBack).toBe(true);
    expect(askedAt(0)).toMatchObject({ deviceId: { ideal: "gone" } });
    expect(askedAt(1)).not.toHaveProperty("deviceId"); // …and the ROUTE survived the fallback
    expect(askedAt(1)).toMatchObject({ echoCancellation: false });
  });

  it("a REFUSED permission is never retried — one prompt, one answer", async () => {
    gum.mockRejectedValue(gumError("NotAllowedError"));
    await expect(openMicStream({ deviceId: "dev-7" })).rejects.toThrow();
    expect(gum).toHaveBeenCalledTimes(1);
  });

  it("a failure with NO device picked is the plain failure it always was", async () => {
    gum.mockRejectedValue(gumError("NotFoundError"));
    await expect(openMicStream({})).rejects.toThrow();
    expect(gum).toHaveBeenCalledTimes(1);
  });

  it("startPcmCapture opens with the route and carries the fallback up", async () => {
    gum.mockRejectedValueOnce(gumError("NotReadableError"));
    const cap = await startPcmCapture({
      frameMs: 20,
      route: "headphones",
      deviceId: "gone",
      onFrame: () => {},
      onEnded: () => {},
    });
    expect(cap.fellBack).toBe(true);
    expect(askedAt(0)).toMatchObject({ echoCancellation: false });
  });
});

describe("listAudioInputs — the picker's list (Maya F4)", () => {
  const dev = (deviceId: string, label: string) => ({ kind: "audioinput", deviceId, label });

  it("returns the labelled audio inputs and drops everything else", async () => {
    enumerated = [
      [dev("a", "Speakerphone"), { kind: "audiooutput", deviceId: "o", label: "Default" }],
    ];
    expect(await listAudioInputs()).toEqual([{ deviceId: "a", label: "Speakerphone" }]);
    expect(gum).not.toHaveBeenCalled(); // enumeration alone opens no microphone
  });

  it("PROBES once for labels when every entry is nameless — and only when asked to", async () => {
    // Labels are permission-gated: before this origin has been granted a capture the list is real but
    // unnameable, which is not a list anyone can choose from.
    enumerated = [
      [dev("a", ""), dev("b", "")],
      [dev("a", "Wired headset"), dev("b", "Bluetooth headset")],
    ];
    expect(await listAudioInputs(true)).toEqual([
      { deviceId: "a", label: "Wired headset" },
      { deviceId: "b", label: "Bluetooth headset" },
    ]);
    expect(gum).toHaveBeenCalledTimes(1);
    expect(track.stopped).toBe(1); // the probe releases the mic it borrowed

    // …and the same list WITHOUT the probe is simply empty: a nameless route is never an offer.
    enumerated = [[dev("a", ""), dev("b", "")]];
    gum.mockClear();
    expect(await listAudioInputs()).toEqual([]);
    expect(gum).not.toHaveBeenCalled();
  });

  it("a refused probe leaves the list empty rather than throwing at the picker", async () => {
    enumerated = [[dev("a", "")]];
    gum.mockRejectedValue(gumError("NotAllowedError"));
    expect(await listAudioInputs(true)).toEqual([]);
  });

  it("a browser with no enumerateDevices answers with nothing", async () => {
    vi.stubGlobal("navigator", { mediaDevices: undefined });
    expect(await listAudioInputs(true)).toEqual([]);
  });
});
