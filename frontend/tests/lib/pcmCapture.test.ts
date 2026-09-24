import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listAudioInputs,
  micConstraints,
  openMicStream,
  ROUTE_CALL,
  ROUTE_MEDIA,
  startPcmCapture,
  wantsAec,
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
  /** Every gain this context ever made: the uplink's silent sink, and (D73 S6 ③) the keepalive's. */
  gains: { gain: { value: number }; disconnects: number }[] = [];
  createGain() {
    const node = {
      gain: { value: 1 },
      disconnects: 0,
      connect: () => {},
      disconnect: () => {
        node.disconnects += 1;
      },
    };
    this.gains.push(node);
    return node;
  }
  /** …and every constant source — the keepalive's, started while the page is hidden. */
  sources: { started: number; stopped: number }[] = [];
  createConstantSource() {
    const src = {
      started: 0,
      stopped: 0,
      start: () => {
        src.started += 1;
      },
      stop: () => {
        src.stopped += 1;
      },
      connect: () => {},
      disconnect: () => {},
    };
    this.sources.push(src);
    return src;
  }
  destination = {};
}

class FakeTrack {
  stopped = 0;
  enabled = true;
  /** What `getSettings().echoCancellation` READS BACK — the D75 ③ detector's whole input, so a case
   *  that is about the flip not taking sets it. `"all"` is the platform-AEC grant, i.e. the default
   *  every AEC-asking case here expects. */
  ec: string | boolean | undefined = "all";
  listeners: Record<string, (() => void)[]> = {};
  /** Fire one of the track's own events the way the platform does (D73 S6 ② uses `mute`/`unmute`). */
  fire(type: string) {
    for (const cb of this.listeners[type] ?? []) cb();
  }
  stop() {
    this.stopped += 1;
  }
  getSettings() {
    return { echoCancellation: this.ec };
  }
  addEventListener(type: string, cb: () => void) {
    (this.listeners[type] ||= []).push(cb);
  }
}

/** What the worklet posts up: pcm16 bytes + the RMS of the same samples. */
interface PcmFrameLike {
  buf: ArrayBuffer;
  rms: number;
}

let track: FakeTrack;
/** The installed worklet's PORT — the case plays the audio thread through it (D73 S6 ②). */
let workletPort: { onmessage: ((e: { data: PcmFrameLike }) => void) | null } | null = null;
let minted: string[] = [];
let revoked: string[] = [];
/** The stubbed `getUserMedia` — what the ROUTE cases assert against (the constraints are the whole
 *  mechanism: on Chrome Android they decide the device's audio mode, R74 §1.3). */
let gum: ReturnType<typeof vi.fn<(constraints: unknown) => Promise<unknown>>>;
/** What a case wants `enumerateDevices()` to answer, in order of the reads it takes. */
let enumerated: { kind: string; deviceId: string; label: string }[][] = [];

/** The audio constraints of the `getUserMedia` call at `i`, as a plain object. */
const askedAt = (i: number): Record<string, unknown> =>
  (gum.mock.calls[i][0] as { audio: Record<string, unknown> }).audio;

beforeEach(() => {
  track = new FakeTrack();
  workletPort = null;
  minted = [];
  revoked = [];
  FakeContext.last = null;
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      port = { onmessage: null as ((e: { data: PcmFrameLike }) => void) | null };
      connect() {}
      constructor() {
        workletPort = this.port;
      }
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
    const cap = await startPcmCapture({
      frameMs: 20,
      route: ROUTE_CALL,
      onFrame: () => {},
      onEnded: () => {},
    });
    expect(cap.sampleRate).toBe(48000);
    expect(cap.readback.echoCancellation).toBe("all");
    expect(track.stopped).toBe(0);
  });

  it("MUTE disables the TRACK and nothing else — the frames must keep flowing (D71 F3)", async () => {
    // The one mechanism: disabling the track silences the samples while the worklet keeps shipping
    // them, because Speaches has to OBSERVE the silence to endpoint a half-spoken phrase. Stopping
    // the uplink instead would leave that utterance open to merge with whatever is said after.
    const cap = await startPcmCapture({
      frameMs: 20,
      route: ROUTE_CALL,
      onFrame: () => {},
      onEnded: () => {},
    });
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

  it("the EAR-HOLD never touches the track — `track.enabled` is MUTE's alone (D76 §B.1)", async () => {
    // Since D76 the hold is uplink SILENCE SUBSTITUTION, not a closed track: the client has to keep
    // hearing (the leak probe measures held frames), and the OS mic indicator stays the owner's
    // privacy switch — which only mute drives.
    const cap = await startPcmCapture({
      frameMs: 20,
      route: ROUTE_CALL,
      onFrame: () => {},
      onEnded: () => {},
    });
    cap.setHeld(true);
    expect(track.enabled).toBe(true);
    cap.setMuted(true);
    expect(track.enabled).toBe(false);
    cap.setHeld(false); // the reply ended — but the owner is still muted
    expect(track.enabled).toBe(false);
    cap.setMuted(false);
    expect(track.enabled).toBe(true);
    cap.setHeld(true);
    cap.setMuted(false); // an unmute under a live hold opens the TRACK; the frames stay held
    expect(track.enabled).toBe(true);
    expect(track.stopped).toBe(0); // held, never released
  });

  it("CLASSIFIES every frame `uplinked = !(muted || held)`, with its real level (D76 §B.1)", async () => {
    const got: { rms: number; uplinked: boolean; bytes: number }[] = [];
    const cap = await startPcmCapture({
      frameMs: 20,
      route: ROUTE_CALL,
      onFrame: (f) => got.push({ rms: f.rms, uplinked: f.uplinked, bytes: f.buf.byteLength }),
      onEnded: () => {},
    });
    const post = (rms: number): void =>
      workletPort?.onmessage?.({ data: { buf: new ArrayBuffer(8), rms } });
    post(0.2);
    cap.setHeld(true);
    post(0.3); // the reply leaking back in: HEARD, at its real level, but not uplinked
    cap.setMuted(true);
    post(0.4);
    cap.setHeld(false);
    post(0.5); // muted alone still keeps it off the uplink
    cap.setMuted(false);
    post(0.6);
    expect(got).toEqual([
      { rms: 0.2, uplinked: true, bytes: 8 },
      { rms: 0.3, uplinked: false, bytes: 8 },
      { rms: 0.4, uplinked: false, bytes: 8 },
      { rms: 0.5, uplinked: false, bytes: 8 },
      { rms: 0.6, uplinked: true, bytes: 8 },
    ]);
  });

  it("exposes its OWN running context — the drop cue plays there (D76 §C.5)", async () => {
    const cap = await startPcmCapture({
      frameMs: 20,
      route: ROUTE_CALL,
      onFrame: () => {},
      onEnded: () => {},
    });
    expect(cap.context).toBe(FakeContext.last);
  });

  it("a released capture is not an open one — neither setter re-enables it", async () => {
    const cap = await startPcmCapture({
      frameMs: 20,
      route: ROUTE_CALL,
      onFrame: () => {},
      onEnded: () => {},
    });
    cap.setMuted(true);
    cap.stop();
    cap.setMuted(false);
    cap.setHeld(false);
    expect(track.enabled).toBe(false);
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
    await startPcmCapture({ frameMs: 20, route: ROUTE_CALL, onFrame: () => {}, onEnded: () => {} });
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
      startPcmCapture({ frameMs: 20, route: ROUTE_CALL, onFrame: () => {}, onEnded: () => {} }),
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
      startPcmCapture({ frameMs: 20, route: ROUTE_CALL, onFrame: () => {}, onEnded: () => {} }),
    ).rejects.toThrow();
    expect(track.stopped).toBe(1);
    expect(FakeContext.last?.closed).toBe(1);
    expect(revoked).toEqual(["blob:worklet"]);
  });
});

// ── D73 S6 · THE EAR'S LIVENESS + THE KEEPALIVE (evidence docs/research/R75) ─────────────────────

describe("startPcmCapture — the ear's own liveness (S6 ② / A2)", () => {
  /** One frame from the audio thread, through the worklet's port exactly as the real one arrives. */
  const heard = (): void =>
    workletPort?.onmessage?.({ data: { buf: new ArrayBuffer(8), rms: 0.1 } });

  it("measures the gap since the last frame it actually HEARD", async () => {
    // The failure this exists for is SILENT: a frozen renderer pauses the AudioContext, so `process()`
    // stops being called and no frames are minted — while the track stays `live`, the permission stays
    // granted and the socket stays open. The missing frames are the only tell there is.
    let clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const cap = await startPcmCapture({
      frameMs: 20,
      route: ROUTE_CALL,
      onFrame: () => {},
      onEnded: () => {},
    });
    heard();
    expect(cap.earGapMs()).toBe(0);
    clock += 90_000; // the page was frozen for a minute and a half
    expect(cap.earGapMs()).toBe(90_000);
    heard(); // …and the graph resumed
    expect(cap.earGapMs()).toBe(0);
  });

  it("a stretch of OS-MUTED frames is exactly as deaf as a paused graph", async () => {
    // `track.muted` is the OS handing the mic to a phone call — NOT our own `track.enabled`, and not
    // `ended`: the track comes back. The frames keep arriving and they are digital silence, so
    // counting them as hearing would claim the ear was awake through the stretch it slept.
    let clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const cap = await startPcmCapture({
      frameMs: 20,
      route: ROUTE_CALL,
      onFrame: () => {},
      onEnded: () => {},
    });
    heard();
    track.fire("mute");
    clock += 30_000;
    heard();
    expect(cap.earGapMs()).toBe(30_000);
    track.fire("unmute"); // the call ended and the mic is ours again
    heard();
    expect(cap.earGapMs()).toBe(0);
  });
});

describe("startPcmCapture — the background keepalive (S6 ③ / Maya F2)", () => {
  it("runs a constant source at an inaudible-but-NONZERO level, and retires it", async () => {
    // Blink's audibility test is literally `energy > 0` on the destination bus, and an audible page is
    // neither frozen nor background-throttled. Raising the uplink chain's own sink gain does nothing —
    // the worklet writes no output at all, so that path multiplies zero.
    const cap = await startPcmCapture({
      frameMs: 20,
      route: ROUTE_CALL,
      onFrame: () => {},
      onEnded: () => {},
    });
    const ctx = FakeContext.last;
    expect(ctx?.sources).toHaveLength(0); // a foreground call needs nothing
    cap.setKeepalive(true);
    expect(ctx?.sources).toHaveLength(1);
    expect(ctx?.sources[0].started).toBe(1);
    const gain = ctx?.gains.at(-1)?.gain.value ?? 0;
    expect(gain).toBeGreaterThan(0); // NONZERO is the whole requirement…
    expect(gain).toBeLessThan(0.01); // …and inaudible is the other half of it

    cap.setKeepalive(true); // idempotent: one node, however often the page says it is hidden
    expect(ctx?.sources).toHaveLength(1);
    cap.setKeepalive(false);
    expect(ctx?.sources[0].stopped).toBe(1);
    // A `ConstantSourceNode` cannot be restarted, so the next ON mints a fresh one.
    cap.setKeepalive(true);
    expect(ctx?.sources).toHaveLength(2);
  });

  it("dies with the capture — a page held audible by a call that is over is a leak", async () => {
    const cap = await startPcmCapture({
      frameMs: 20,
      route: ROUTE_CALL,
      onFrame: () => {},
      onEnded: () => {},
    });
    cap.setKeepalive(true);
    cap.stop();
    expect(FakeContext.last?.sources[0].stopped).toBe(1);
    cap.setKeepalive(true); // …and a released capture cannot be woken back up
    expect(FakeContext.last?.sources).toHaveLength(1);
  });
});

// ── D73 S5 → D76 §A · THE ROUTE (evidence docs/research/R74) ─────────────────────────────────────

describe("micConstraints — the route IS the constraint (R74 §1.3)", () => {
  it("call asks for the subtractive mode; media clears the ask entirely", () => {
    // Clearing AEC empties Android's platform-effects mask, which is the single bit that decides
    // whether Chrome puts the device into MODE_IN_COMMUNICATION and re-tags its own output as
    // voice-communication. `noiseSuppression` runs in software and survives both routes.
    expect(micConstraints({ route: ROUTE_CALL })).toMatchObject({
      echoCancellation: { ideal: "all" },
      noiseSuppression: true,
      channelCount: 1,
    });
    expect(micConstraints({ route: ROUTE_MEDIA })).toMatchObject({
      echoCancellation: false,
      noiseSuppression: true,
      channelCount: 1,
    });
  });

  it("an absent or unknown route is the MEDIA route — the backend's own default", () => {
    expect(micConstraints({})).toMatchObject({ echoCancellation: false });
    expect(micConstraints({ route: "earpiece" })).toMatchObject({ echoCancellation: false });
  });

  it("wantsAec is TRUE for the call route alone — the one predicate every consumer asks (D76 §A)", () => {
    // The route is the EC ask and nothing else now: whether the ear is held under the reply is
    // `mic_hold`'s question (D76 §B), so there is no second predicate over the same string.
    expect(ROUTE_CALL).toBe("call");
    expect(ROUTE_MEDIA).toBe("media");
    expect(wantsAec(ROUTE_CALL)).toBe(true);
    expect(wantsAec(ROUTE_MEDIA)).toBe(false);
    expect(wantsAec(undefined)).toBe(false); // absent ⇒ media, the backend's default
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
    const opened = await openMicStream({ route: ROUTE_MEDIA, deviceId: "gone" });
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
    track.ec = false; // the EC-off ask took — no D75 ③ re-open in this case's way
    gum.mockRejectedValueOnce(gumError("NotReadableError"));
    const cap = await startPcmCapture({
      frameMs: 20,
      route: ROUTE_MEDIA,
      deviceId: "gone",
      onFrame: () => {},
      onEnded: () => {},
    });
    expect(cap.fellBack).toBe(true);
    expect(askedAt(0)).toMatchObject({ echoCancellation: false });
  });
});

describe("openMicStream — the STEERING RULE (D74 S3, evidence docs/research/R77)", () => {
  /** Chrome Android's synthetic communication-device list, as `enumerateDevices()` returns it: the
   *  localized default entry, then the fixed English route names. `bt` is the whole fork. */
  const android = (opts: { bt?: boolean; earpiece?: boolean } = {}) => [
    { kind: "audioinput", deviceId: "default", label: "Default" },
    { kind: "audioinput", deviceId: "spk", label: "Speakerphone" },
    ...(opts.earpiece === false
      ? []
      : [{ kind: "audioinput", deviceId: "ear", label: "Headset earpiece" }]),
    ...(opts.bt ? [{ kind: "audioinput", deviceId: "bt", label: "Bluetooth headset" }] : []),
  ];

  it("steers the DEFAULT away from Bluetooth on the media route — to the earpiece", async () => {
    // The trap: the default selection prefers the BT row, SCO starts, AOSP suspends the A2DP output,
    // and its frames are discarded — so the media-path TTS the media route exists for is not
    // degraded but SILENT, with no mode exit to restore anything afterwards. The trap belongs to
    // EC-OFF capture (the empty effects mask), which is exactly what `media` is.
    enumerated = [android({ bt: true })];
    await openMicStream({ route: ROUTE_MEDIA });
    expect(askedAt(0)).toMatchObject({ deviceId: { ideal: "ear" }, echoCancellation: false });
  });

  it("…and to the SPEAKERPHONE when the phone offers no earpiece row", async () => {
    // Speakerphone always exists in that list, which is what makes "never fall through to the
    // default while the BT row stands" a structural guarantee rather than a hope. It forces
    // FOR_COMMUNICATION only — a slot STRATEGY_MEDIA never reads — so A2DP keeps the reply.
    enumerated = [android({ bt: true, earpiece: false })];
    await openMicStream({ route: ROUTE_MEDIA });
    expect(askedAt(0)).toMatchObject({ deviceId: { ideal: "spk" } });
  });

  it("steers NOWHERE when the Bluetooth row is absent — there is nothing to avoid", async () => {
    enumerated = [android()];
    await openMicStream({ route: ROUTE_MEDIA });
    expect(askedAt(0)).not.toHaveProperty("deviceId");
  });

  it("an EXPLICIT pick always wins, and the call route is never steered", async () => {
    enumerated = [android({ bt: true }), android({ bt: true })];
    await openMicStream({ route: ROUTE_MEDIA, deviceId: "bt" });
    expect(askedAt(0)).toMatchObject({ deviceId: { ideal: "bt" } });
    // The call route is already in communication mode by construction (R74 §1) — moving its
    // device would change a shipped behaviour this rule has no evidence about.
    await openMicStream({ route: ROUTE_CALL });
    expect(askedAt(1)).not.toHaveProperty("deviceId");
    expect(gum).toHaveBeenCalledTimes(2);
  });

  it("a list that is NOT Chrome's synthetic five steers nothing (a desktop, Fennec)", async () => {
    // Capability-shaped, not UA-sniffed: the evidence is the list itself, and any label outside the
    // fixed set means this is a real device enumeration, where none of R77's mechanism applies.
    enumerated = [
      [
        { kind: "audioinput", deviceId: "default", label: "Default - Microphone (Realtek)" },
        { kind: "audioinput", deviceId: "m1", label: "Microphone (Realtek Audio)" },
        { kind: "audioinput", deviceId: "bt", label: "Bluetooth headset" },
      ],
    ];
    await openMicStream({ route: ROUTE_MEDIA });
    expect(askedAt(0)).not.toHaveProperty("deviceId");
  });

  it("a steer rung that will not open falls to the NEXT rung, never the bare default (F3)", async () => {
    // The earpiece is momentarily unopenable (`MakeLowLatencyInputStream` answers a null stream as a
    // failed getUserMedia, R74 §2.2(b)). The walk moves to the guaranteed Speakerphone rung — a bare
    // default here would be the SCO trap the whole ladder exists to avoid, and the old shape threw
    // instead, ending a call over a transient the next rung survives.
    enumerated = [android({ bt: true })];
    gum.mockRejectedValueOnce(gumError("NotReadableError"));
    const opened = await openMicStream({ route: ROUTE_MEDIA });
    expect(askedAt(0)).toMatchObject({ deviceId: { ideal: "ear" } });
    expect(askedAt(1)).toMatchObject({ deviceId: { ideal: "spk" } });
    expect(opened.fellBack).toBe(false); // the owner picked nothing — no note to show them

    // …while a DENIED permission aborts the walk: no rung improves on "no".
    enumerated = [android({ bt: true })];
    gum.mockRejectedValueOnce(gumError("NotAllowedError"));
    await expect(openMicStream({ route: ROUTE_MEDIA })).rejects.toMatchObject({
      name: "NotAllowedError",
    });
  });

  it("the picked-device FALLBACK is steered too — it must not fall back into the trap", async () => {
    enumerated = [android({ bt: true })];
    gum.mockRejectedValueOnce(gumError("NotReadableError"));
    const opened = await openMicStream({ route: ROUTE_MEDIA, deviceId: "usb-gone" });
    expect(opened.fellBack).toBe(true);
    expect(askedAt(0)).toMatchObject({ deviceId: { ideal: "usb-gone" } });
    expect(askedAt(1)).toMatchObject({ deviceId: { ideal: "ear" } }); // …not the bare default
  });

  it("an EXHAUSTED ladder is the plain failure — the bare default is never asked (F3)", async () => {
    // Every rung refused (code round F3 reshaped the old one-attempt pin into this walk): the caller
    // gets the failure, and not one of the attempts was the un-steered default — falling back into
    // it would be falling back into the silent SCO route the ladder exists to avoid.
    enumerated = [android({ bt: true })];
    gum.mockRejectedValue(gumError("NotReadableError"));
    await expect(openMicStream({ route: ROUTE_MEDIA })).rejects.toThrow();
    expect(gum).toHaveBeenCalledTimes(2); // ear, then the guaranteed speakerphone — nothing else
    expect(askedAt(0)).toMatchObject({ deviceId: { ideal: "ear" } });
    expect(askedAt(1)).toMatchObject({ deviceId: { ideal: "spk" } });
  });
});

// ── D75 ③ · THE EC-RELEASE RACE (evidence docs/research/R80 §5) ──────────────────────────────────

describe("startPcmCapture — the readback-mismatch detector + its ONE retry", () => {
  /** An EC-off capture, opened. The cases below differ only in what the track READS BACK. */
  const openMedia = () =>
    startPcmCapture({ frameMs: 20, route: ROUTE_MEDIA, onFrame: () => {}, onEnded: () => {} });

  it("re-opens ONCE when an EC-off ask comes back EC-ON, and says so when it stays stuck", async () => {
    // The race: Android evaluates the communication mode only for the FIRST input stream and restores
    // it only when the LAST is released — in the audio service, after our renderer-side `stop()`. Lose
    // that race and the new capture inherits both the mode AND (R78 §2.3) the old source's pinned
    // echo-cancellation mode, so the EC-off media route comes up EC-on and the crackle survives the flip.
    // The readback is the free detector; the release + one beat is the only barrier the platform offers.
    track.ec = "all"; // …and it stays stuck across both opens
    const cap = await openMedia();
    expect(gum).toHaveBeenCalledTimes(2);
    expect(askedAt(0)).toMatchObject({ echoCancellation: false });
    expect(askedAt(1)).toMatchObject({ echoCancellation: false });
    expect(cap.ecStuck).toBe(true);
  });

  it("…and the retry is ONE: a second result is ACCEPTED either way", async () => {
    // A flip that takes on the re-open is the ordinary case this exists for, and it reports nothing —
    // there is no news in a route that worked. A second wait would be a delay dressed as a fix.
    const clean = new FakeTrack();
    clean.ec = false;
    track.ec = "all";
    gum.mockImplementationOnce(async () => ({
      getAudioTracks: () => [track],
      getTracks: () => [track],
    }));
    gum.mockImplementation(async () => ({
      getAudioTracks: () => [clean],
      getTracks: () => [clean],
    }));
    const cap = await openMedia();
    expect(gum).toHaveBeenCalledTimes(2);
    expect(track.stopped).toBe(1); // the stuck stream is RELEASED — that release IS the barrier
    expect(cap.ecStuck).toBe(false);
  });

  it("a clean EC-off open opens ONCE — nothing waits unless the flip is seen to have failed", async () => {
    // Detection-driven, never an unconditional delay: the single `getUserMedia` is the whole proof,
    // because the beat only exists on the path a mismatch takes.
    track.ec = false;
    const cap = await openMedia();
    expect(gum).toHaveBeenCalledTimes(1);
    expect(cap.ecStuck).toBe(false);
  });

  it("the OPPOSITE mismatch is a legitimate degrade and must NOT trip it", async () => {
    // A route that asked for AEC and got none is a phone with no platform canceller — which is what a
    // `false` readback under an AEC ask MEANS (R78 §1.3), and the capture-ready resolution already
    // answers it by arming the protective ear-hold. Re-opening would cost a beat and change nothing.
    track.ec = false;
    const cap = await startPcmCapture({
      frameMs: 20,
      route: ROUTE_CALL,
      onFrame: () => {},
      onEnded: () => {},
    });
    expect(gum).toHaveBeenCalledTimes(1);
    expect(cap.ecStuck).toBe(false);
  });

  it("a retry that cannot open propagates exactly as the first attempt's failure does", async () => {
    // The retry lives inside the existing error shape: nothing new is caught here, so a denied or
    // unavailable second open reaches the caller as the call's error terminal, like any other.
    track.ec = "all";
    gum.mockImplementationOnce(async () => ({
      getAudioTracks: () => [track],
      getTracks: () => [track],
    }));
    gum.mockRejectedValue(gumError("NotReadableError"));
    await expect(openMedia()).rejects.toThrow();
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

  it("drops Chrome's virtual default/communications rows — the picker's empty pick IS that choice (owner, 2026-09-23)", async () => {
    // Offering "Default" beside the empty pick showed one decision twice, and the explicit id is the
    // worse spelling: it wins the constraint ladder outright and would skip the SCO steer.
    enumerated = [
      [
        dev("default", "Default - Microphone (Realtek)"),
        dev("communications", "Communications - Microphone (Realtek)"),
        dev("m1", "Microphone (Realtek Audio)"),
      ],
    ];
    expect(await listAudioInputs()).toEqual([
      { deviceId: "m1", label: "Microphone (Realtek Audio)" },
    ]);
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

  it("openMicStream WAITS for a probe in flight — the throwaway grab never races a real capture (S5 review F1)", async () => {
    // The probe's instant of holding the Android communication device must be over before a real
    // capture asks for a route — or the capture fails over to the default for no true reason.
    enumerated = [
      [dev("a", ""), dev("b", "")],
      [dev("a", "Wired headset"), dev("b", "Bluetooth headset")],
    ];
    const order: string[] = [];
    let releaseProbe!: () => void;
    gum.mockImplementationOnce(() => {
      order.push("probe-open");
      return new Promise((res) => {
        releaseProbe = () => {
          order.push("probe-done");
          res({ getAudioTracks: () => [track], getTracks: () => [track] });
        };
      });
    });
    const listing = listAudioInputs(true);
    // The probe branch sits behind the enumeration's own microtasks — wait for ITS gUM, not a count.
    await vi.waitFor(() => expect(order).toContain("probe-open"));
    gum.mockImplementationOnce(() => {
      order.push("real-open");
      return Promise.resolve({ getAudioTracks: () => [track], getTracks: () => [track] });
    });
    const opening = openMicStream({ deviceId: "b" });
    await Promise.resolve();
    expect(order).toEqual(["probe-open"]); // the real capture is parked behind the latch
    releaseProbe();
    await listing;
    await opening;
    expect(order).toEqual(["probe-open", "probe-done", "real-open"]);
  });

  it("SERIALIZES a second probe onto the first instead of overwriting the latch (D74 S6 ⑧)", async () => {
    // Two pickers opening in the same breath used to mint two throwaway captures AND leave the latch
    // pointing at the newer one — so a real capture would wait on that and open while the OLDER
    // probe still held the Android communication device, which is the exact race the latch exists
    // to close. One probe, one grab, both callers answered.
    enumerated = [
      [dev("a", "")],
      [dev("a", "")],
      [dev("a", "Speakerphone")],
      [dev("a", "Speakerphone")],
    ];
    let releaseProbe!: () => void;
    gum.mockImplementationOnce(
      () =>
        new Promise((res) => {
          releaseProbe = () => res({ getAudioTracks: () => [track], getTracks: () => [track] });
        }),
    );
    const first = listAudioInputs(true);
    await vi.waitFor(() => expect(gum).toHaveBeenCalledTimes(1));
    const second = listAudioInputs(true);
    await Promise.resolve();
    expect(gum).toHaveBeenCalledTimes(1); // …the second one opened no microphone of its own
    releaseProbe();
    expect(await first).toEqual([{ deviceId: "a", label: "Speakerphone" }]);
    expect(await second).toEqual([{ deviceId: "a", label: "Speakerphone" }]);
    expect(gum).toHaveBeenCalledTimes(1);
  });

  it("a browser with no enumerateDevices answers with nothing", async () => {
    vi.stubGlobal("navigator", { mediaDevices: undefined });
    expect(await listAudioInputs(true)).toEqual([]);
  });
});
