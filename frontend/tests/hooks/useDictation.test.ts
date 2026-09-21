import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// hooks/useDictation — the tap-to-start/stop mic state machine. We replace MediaRecorder + getUserMedia
// + fetch with fakes and drive the recorder lifecycle, asserting the transcript lands (fill vs
// auto-send) and the failure modes (502 → reactive "unavailable"; insecure-context → distinct toast).
// The composer draft store is REAL (so we assert the hand-off); toast/runComposer/chat-status mocked.

vi.mock("../../src/store/toast", () => ({ pushToast: vi.fn() }));
// `runComposer` answers whether it ROUTED (D68 MED-2): the auto-send clears the draft on `true` and
// keeps it on `false` (a send held behind an in-flight upload). The routing cases here are all
// "it routed"; the HELD case rides the real seam in `tests/hooks/attachmentDictation.test.ts`.
vi.mock("../../src/lib/composer", () => ({ runComposer: vi.fn(() => true) }));
vi.mock("../../src/store/chat", () => ({ getChatStatus: vi.fn(() => "idle") }));

import { useDictation } from "../../src/hooks/useDictation";
import { FakeMediaRecorder, mockStt, recordOnce, setMediaDevices } from "./dictationFakes";
import { runComposer } from "../../src/lib/composer";
import { getChatStatus } from "../../src/store/chat";
import { clearDraft, getDraft } from "../../src/store/composer";
import { releaseMic } from "../../src/store/micRelease";
import { pushToast } from "../../src/store/toast";

const opts = (autoSend = false) => ({ sttReady: true, statusStamp: 1, autoSend });

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  FakeMediaRecorder.deferStop = false; // the queued-events window is opt-in, per case
  setMediaDevices(true);
  clearDraft();
  mockStt(200, { text: "hello world" });
  vi.mocked(pushToast).mockClear();
});

// `globals: false` means RTL's auto-cleanup never registers, so a hook would otherwise stay mounted
// for the rest of the file — and a case that ends mid-recording would leave its visibility listener
// on the shared `document`, stopping the NEXT case's recording. Unmount each hook with its case.
afterEach(cleanup);

describe("useDictation", () => {
  it("fill mode: records → transcribes → appends to the composer draft", async () => {
    const { result } = renderHook(() => useDictation(opts(false)));
    expect(result.current.status).toBe("idle");
    await recordOnce(result);
    await waitFor(() => expect(getDraft()).toBe("hello world"));
    expect(result.current.status).toBe("idle");
    expect(runComposer).not.toHaveBeenCalled();
  });

  it("auto-send mode: routes the transcript through runComposer and clears the draft", async () => {
    mockStt(200, { text: "send this" });
    const { result } = renderHook(() => useDictation(opts(true)));
    await recordOnce(result);
    await waitFor(() => expect(runComposer).toHaveBeenCalledWith("send this"));
    expect(getDraft()).toBe("");
  });

  it("a 502 (whole STT chain down) greys the mic reactively", async () => {
    mockStt(502, {});
    const { result } = renderHook(() => useDictation(opts(false)));
    await recordOnce(result);
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(pushToast).toHaveBeenCalledWith("Voice servers unreachable", "err");
  });

  it("insecure context (no getUserMedia) reports `insecure` and re-explains the fix on tap", async () => {
    setMediaDevices(false);
    const { result } = renderHook(() => useDictation(opts(false)));
    // Distinct status (greyed-but-tappable), NOT "idle" (looks dead) nor "unavailable" (a server 502).
    expect(result.current.status).toBe("insecure");
    act(() => result.current.toggle());
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("secure"), "info"),
    );
    // A tap never starts a recording or wedges the control — it stays in the insecure state.
    expect(result.current.status).toBe("insecure");
  });

  it("auto-send STEERS during a live turn (HIGH-1/D41): routes through runComposer, not held back", async () => {
    // The old gate held voice back while streaming; D41 lifts it — a voice message during a live turn
    // QUEUES as a steer (voice is the owner's primary mobile input; the queued bubble is visible).
    vi.mocked(getChatStatus).mockReturnValue("streaming"); // a turn is in flight — no longer a barrier
    mockStt(200, { text: "steer line" });
    const { result } = renderHook(() => useDictation(opts(true)));
    await recordOnce(result);
    await waitFor(() => expect(runComposer).toHaveBeenCalledWith("steer line")); // steered, not stranded
    expect(getDraft()).toBe(""); // cleared like any auto-send (the steer bubble carries it now)
  });

  it("an empty transcript prompts a retry rather than appending nothing", async () => {
    mockStt(200, { text: "   " });
    const { result } = renderHook(() => useDictation(opts(false)));
    await recordOnce(result);
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Didn't catch"), "info"),
    );
    expect(getDraft()).toBe("");
  });
});

// --- Phase 24 / S0.5: the three verbs the hold gesture drives ------------------------------------
// `useDictation` WIDENED rather than gaining a sibling recorder (LIVE_VOICE_PLAN §6): `start`/`stop`/
// `cancel` are what the gesture calls, `toggle` stays the keyboard path, and there is still exactly one
// MediaRecorder behind all four. What is pinned here is everything the gesture DEPENDS ON but the
// gesture's own machine cannot state.

describe("useDictation · the gesture verbs (S0.5)", () => {
  it("`cancel` discards the clip: no POST, no draft, and the mic is released", async () => {
    const { result } = renderHook(() => useDictation(opts(false)));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe("recording");
    await act(async () => {
      result.current.cancel();
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(getDraft()).toBe("");
    expect(result.current.status).toBe("idle");
  });

  it("a clip under the 1000 ms floor is discarded BEFORE any POST, with a teaching toast", async () => {
    const { result } = renderHook(() => useDictation(opts(false)));
    await recordOnce(result, 300); // a mis-timed hold: 300 ms of audio
    expect(globalThis.fetch).not.toHaveBeenCalled(); // a blip costs no round trip (R69 §2)
    expect(getDraft()).toBe("");
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("hold"), "info");
  });

  // OF-4 — the too-short TEACHING is the one part of the floor a consumer may take over: the composer
  // shows it in the gesture's own bubble instead of the toast rail. The RULE (and `MIN_CLIP_MS`) did not
  // move, which is what these two cases together state.
  it("a registered `onTooShort` takes the teaching INSTEAD of the toast (OF-4)", async () => {
    const { result } = renderHook(() => useDictation(opts(false)));
    const taught = vi.fn();
    result.current.onTooShort.current = taught;
    await recordOnce(result, 300);
    expect(taught).toHaveBeenCalledTimes(1);
    expect(pushToast).not.toHaveBeenCalledWith(expect.stringContaining("hold"), "info");
    expect(globalThis.fetch).not.toHaveBeenCalled(); // the floor RULE is untouched — still no POST
  });

  it("…and with nobody registered the toast is still the fallback (OF-4)", async () => {
    const { result } = renderHook(() => useDictation(opts(false)));
    result.current.onTooShort.current = null; // explicit: this is the shipped-before state
    await recordOnce(result, 300);
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("hold"), "info");
  });

  it("…and one just over it uploads normally — the floor is 1000 ms, not a general brake", async () => {
    const { result } = renderHook(() => useDictation(opts(false)));
    await recordOnce(result, 1001);
    await waitFor(() => expect(getDraft()).toBe("hello world"));
  });

  it("`start` RESOLVES to whether a recorder actually armed", async () => {
    const { result } = renderHook(() => useDictation(opts(false)));
    let armed: boolean | undefined;
    await act(async () => {
      armed = await result.current.start();
    });
    expect(armed).toBe(true);
  });

  it("…and false when the mic is denied, so the gesture can close its own affordance", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw new Error("NotAllowedError");
        }),
      },
    });
    const { result } = renderHook(() => useDictation(opts(false)));
    let armed: boolean | undefined;
    await act(async () => {
      armed = await result.current.start();
    });
    expect(armed).toBe(false);
    expect(result.current.status).toBe("idle");
  });

  it("THE ARMING LATCH (F5): a release inside the getUserMedia window aborts the pending start", async () => {
    // The window the old boolean latch could only BLOCK: the gesture ends while the browser is still
    // opening the mic. The stream that arrives afterwards must be released at once — an ownerless
    // recording is the one outcome this window may never produce.
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const trackStop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          await gate;
          return { getTracks: () => [{ stop: trackStop }] };
        }),
      },
    });
    const { result } = renderHook(() => useDictation(opts(false)));
    let armed: boolean | undefined;
    await act(async () => {
      void result.current.start().then((v) => {
        armed = v;
      });
    });
    act(() => result.current.stop()); // released mid-acquisition
    await act(async () => {
      open(); // …and only now does the browser hand over the stream
      await Promise.resolve();
    });
    expect(armed).toBe(false);
    expect(trackStop).toHaveBeenCalled(); // released immediately, never recorded from
    expect(result.current.status).toBe("idle");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("…and a `cancel` in the same window aborts it too, with nothing to discard", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const trackStop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          await gate;
          return { getTracks: () => [{ stop: trackStop }] };
        }),
      },
    });
    const { result } = renderHook(() => useDictation(opts(false)));
    await act(async () => {
      void result.current.start();
    });
    act(() => result.current.cancel());
    await act(async () => {
      open();
      await Promise.resolve();
    });
    expect(trackStop).toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("…and an ABORTED attempt's late REJECTION reports nothing — the user let go (F1)", async () => {
    // The other half of the abort: the browser answers the permission prompt with a REJECTION after
    // the gesture already ended. That is the user's own release, not a fact to report — and the toast
    // and the detector teardown on that path both belong to whatever attempt is current NOW.
    let deny!: () => void;
    const gate = new Promise<void>((_resolve, reject) => {
      deny = () => reject(new Error("NotAllowedError"));
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          await gate;
          return { getTracks: () => [] };
        }),
      },
    });
    const { result } = renderHook(() => useDictation(opts(false)));
    let armed: boolean | undefined;
    await act(async () => {
      void result.current.start().then((v) => {
        armed = v;
      });
    });
    act(() => result.current.stop()); // released inside the window → the attempt is aborted
    await act(async () => {
      deny(); // …and only now is the prompt answered, too late to matter
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(armed).toBe(false);
    expect(pushToast).not.toHaveBeenCalledWith("Microphone permission denied", "err");
  });

  it("a recorder whose TERMINAL EVENTS are still queued refuses the next start (F2)", async () => {
    // `stop()`/`cancel()` flip `state` to "inactive" synchronously while the final `dataavailable`/
    // `stop` are queued. A recording started inside that window used to overwrite the chunks, the
    // discard flag and the stamp the late callback then read — a CANCELLED clip would upload.
    FakeMediaRecorder.deferStop = true;
    const { result } = renderHook(() => useDictation(opts(false)));
    await act(async () => {
      await result.current.start(); // A
    });
    const a = FakeMediaRecorder.last!;
    await act(async () => {
      result.current.cancel(); // A is discarded — but its `onstop` has not run yet
    });
    let armed: boolean | undefined;
    await act(async () => {
      armed = await result.current.start(); // B, inside A's queued window
    });
    expect(armed).toBe(false); // refused: A still owns the recorder
    expect(FakeMediaRecorder.last).toBe(a); // …so no second recorder was ever constructed
    await act(async () => {
      a.flush(); // A's terminal events finally land
      await Promise.resolve();
    });
    expect(globalThis.fetch).not.toHaveBeenCalled(); // the cancelled clip stayed cancelled
    expect(getDraft()).toBe("");
    expect(pushToast).not.toHaveBeenCalledWith(expect.stringContaining("Too short"), "info");
  });

  it("an `error` followed by its queued `stop` uploads NOTHING (F4)", async () => {
    // Browsers may deliver `error`, then the final `dataavailable`, then `stop`. The stamp cannot be
    // what suppresses that upload (a missing stamp deliberately reads as "no floor to apply"), so the
    // error arms the existing discard flag instead.
    const { result } = renderHook(() => useDictation(opts(false)));
    await act(async () => {
      await result.current.start();
    });
    const rec = FakeMediaRecorder.last!;
    const realNow = Date.now;
    const at = realNow() + 5000; // far past the 1000 ms floor: only the discard can explain silence
    Date.now = () => at;
    try {
      await act(async () => {
        rec.onerror?.();
        rec.stop(); // the queued terminal events, arriving after the error
        await Promise.resolve();
      });
    } finally {
      Date.now = realNow;
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(getDraft()).toBe("");
    expect(result.current.status).toBe("idle");
  });

  it("an errored recorder still OWNS the lifecycle until its queued `stop` lands (confirm sweep)", async () => {
    // `onerror` must NOT release `recRef`: the platform's inactivate steps fire the final
    // `dataavailable`/`stop` AFTER the error, so a `start()` admitted between the two would reset the
    // shared discard/chunks/stamp the late `onstop` is about to read — reopening the exact F2/F4 race.
    // The error arms the discard flag; the following `onstop` is the ONE releasing terminal.
    FakeMediaRecorder.deferStop = true;
    const { result } = renderHook(() => useDictation(opts(false)));
    await act(async () => {
      await result.current.start(); // A
    });
    const a = FakeMediaRecorder.last!;
    await act(async () => {
      a.onerror?.(); // the failure — A's terminal events are still queued
    });
    let armed: boolean | undefined;
    await act(async () => {
      armed = await result.current.start(); // B, between A's error and A's stop
    });
    expect(armed).toBe(false); // refused: the errored recorder still owns the lifecycle
    expect(FakeMediaRecorder.last).toBe(a);
    await act(async () => {
      a.stop();
      a.flush(); // A's queued terminal events finally land
      await Promise.resolve();
    });
    expect(globalThis.fetch).not.toHaveBeenCalled(); // the failed clip stayed discarded (F4)
    await act(async () => {
      armed = await result.current.start(); // the terminal `onstop` released ownership
    });
    expect(armed).toBe(true);
    expect(FakeMediaRecorder.last).not.toBe(a);
  });
});

// --- R51 Tier 0: auto-stop dictation --------------------------------------------------------------
// The detector is a timer over an AnalyserNode, so it is driven with FAKE timers + a fake Web Audio
// graph whose readings the test dictates (`micLevel` is the RMS every sample carries). What is pinned
// is the CONTRACT the council closed on: the silence run ends the recording through the ordinary stop
// path, speech resets the run, a hidden page ends it outright, a context that won't run degrades to
// plain push-to-talk, and the ONE cleanup runs on every terminal path — before the upload.

let micLevel = 0; // 0 = silence; ≥ the configured floor = speech
let contexts: FakeAudioContext[] = [];

class FakeAnalyser {
  fftSize = 32;
  disconnect = vi.fn();
  getFloatTimeDomainData(buf: Float32Array) {
    buf.fill(micLevel); // a constant sample block → RMS === micLevel
  }
}

class FakeAudioContext {
  /** Emulates a context the browser refuses to run (autoplay policy) — the degrade-to-manual path. */
  static stuckSuspended = false;
  /** When set, the NEXT context starts `suspended` and its resume() parks on this gate (consumed by
   *  that one context) — how a test holds one recording's async arm open across the next recording. */
  static resumeGate: Promise<void> | null = null;
  state: string;
  gate: Promise<void> | null;
  analyser = new FakeAnalyser();
  source = { connect: vi.fn(), disconnect: vi.fn() };
  resume = vi.fn(async () => {
    if (this.gate) await this.gate;
    // A closed context stays closed — the real resume() rejects on one (the hook swallows it).
    if (!FakeAudioContext.stuckSuspended && this.state !== "closed") this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  constructor() {
    this.gate = FakeAudioContext.resumeGate;
    FakeAudioContext.resumeGate = null;
    this.state = FakeAudioContext.stuckSuspended || this.gate ? "suspended" : "running";
    contexts.push(this);
  }
  createAnalyser() {
    return this.analyser;
  }
  createMediaStreamSource() {
    return this.source;
  }
}

const AUTO_STOP = { enabled: true, silence_s: 3, threshold: 0.01 }; // 3 s window = 30 readings
const stopOpts = (autoSend = false, autoStop = AUTO_STOP) => ({
  sttReady: true,
  statusStamp: 1,
  autoSend,
  autoStop,
});

/** Tap to start and flush the async start flow (getUserMedia + the context resume) under fake timers,
 *  where `waitFor` cannot poll. */
async function startRecording(result: { current: { toggle: () => void; status: string } }) {
  await act(async () => {
    result.current.toggle();
  });
  expect(result.current.status).toBe("recording");
}

/** Advance the detector's clock and let anything it kicked off (stop → upload) settle. */
async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useDictation · auto-stop (R51 Tier 0)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    micLevel = 0;
    contexts = [];
    FakeAudioContext.stuckSuspended = false;
    FakeAudioContext.resumeGate = null;
    FakeMediaRecorder.last = null;
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.mocked(pushToast).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a silence run spanning the window stops the recording — and transcribes it", async () => {
    const { result } = renderHook(() => useDictation(stopOpts()));
    await startRecording(result);
    await tick(2900); // one reading short of the window
    expect(result.current.status).toBe("recording");
    await tick(100);
    expect(getDraft()).toBe("hello world"); // the ORDINARY stop path ran: onstop → upload → fill
    expect(result.current.status).toBe("idle");
  });

  it("speech resets the run — the window is CONTINUOUS silence, not elapsed time", async () => {
    const { result } = renderHook(() => useDictation(stopOpts()));
    await startRecording(result);
    await tick(2000);
    micLevel = 0.5; // a word
    await tick(200);
    micLevel = 0;
    await tick(2000); // 4.2 s elapsed, but only 2 s of unbroken silence
    expect(result.current.status).toBe("recording");
    await tick(1000);
    expect(result.current.status).toBe("idle");
  });

  it("a manual stop wins: the detector is gone, so the window never fires a second stop", async () => {
    const { result } = renderHook(() => useDictation(stopOpts()));
    await startRecording(result);
    await tick(1000);
    await act(async () => {
      result.current.toggle(); // tap stop before the window closes
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(contexts[0].close).toHaveBeenCalled(); // the detector died with the recording…
    await tick(10_000); // …so the window it was counting down can never fire a second stop
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  // OF-3 — METERING IS SPLIT FROM POLICY (S0.5 feel round). The detector now arms for EVERY recording,
  // because the record circle's level halo needs a level whatever the auto-stop switch says; the STOP
  // decision is still gated on `enabled`. These two cases are the split, stated from both sides: the
  // meter runs with the policy OFF, and the policy OFF still never ends a recording — note the case
  // below keeps the REAL window/threshold numbers (a `/voice/status` carries them whether or not the
  // feature is enabled), so a lost gate would stop this recording at 3 s.
  it("toggle OFF still METERS — the level is not the policy's to withhold (OF-3)", async () => {
    const off = stopOpts(false, { ...AUTO_STOP, enabled: false });
    const { result } = renderHook(() => useDictation(off));
    const levels: number[] = [];
    result.current.meter.current = (v) => levels.push(v);
    await startRecording(result);
    micLevel = 0.06; // half of METER_FULL_RMS
    await tick(300);
    expect(contexts).toHaveLength(1); // the analyser IS armed now, auto-stop off or not
    expect(levels.length).toBeGreaterThan(0);
    expect(levels.at(-1)).toBeCloseTo(0.5, 2); // 0.06 / 0.12 — normalized, clamped at 1
  });

  it("…and with the policy OFF nothing in the detector ever stops the recording (OF-3)", async () => {
    const off = stopOpts(false, { ...AUTO_STOP, enabled: false });
    const { result } = renderHook(() => useDictation(off));
    await startRecording(result);
    micLevel = 0; // dead silence, far longer than the configured 3 s window
    await tick(30_000);
    expect(result.current.status).toBe("recording"); // still waiting for the tap, as always
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("an ABSENT policy (older backend / stub) reads as disabled — LOW-4", async () => {
    // No `autoStop` prop at all — exactly what an older backend's `/voice/status` produces.
    const { result } = renderHook(() => useDictation(opts(false)));
    await startRecording(result);
    await tick(30_000);
    expect(result.current.status).toBe("recording");
  });

  it("with the POLICY OFF a hidden page does NOT stop the recording (feel-round F1)", async () => {
    // Pre-OF-3, plain push-to-talk had no visibility listener at all — the metering split arms the
    // detector for every recording, but the hidden-page stop is the POLICY's rule and must not have
    // ridden along with the meter.
    const off = stopOpts(false, { ...AUTO_STOP, enabled: false });
    const { result } = renderHook(() => useDictation(off));
    await startRecording(result);
    await tick(1500);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.status).toBe("recording"); // exactly what shipped before the wave
    expect(globalThis.fetch).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("a hidden page stops the recording outright (MED-1) — the mic never runs untended", async () => {
    const { result } = renderHook(() => useDictation(stopOpts()));
    await startRecording(result);
    micLevel = 0.5; // mid-sentence: only the visibility rule can end this recording
    await tick(1500); // …and held past the 1000 ms floor, so the clip is a real one
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.status).toBe("idle");
    expect(getDraft()).toBe("hello world"); // stopped through the same path — the clip still lands
    expect(contexts[0].close).toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("a context that will not run degrades to manual recording, silently (MED-2)", async () => {
    FakeAudioContext.stuckSuspended = true;
    const { result } = renderHook(() => useDictation(stopOpts()));
    await startRecording(result);
    await tick(30_000);
    expect(result.current.status).toBe("recording"); // no auto-stop…
    expect(contexts[0].close).toHaveBeenCalled(); // …and no context left open
    expect(vi.getTimerCount()).toBe(0); // the AUDIO half alone was released
    expect(pushToast).not.toHaveBeenCalled(); // no error surface: it is just push-to-talk again
  });

  it("the hidden-page stop survives a dead context — MED-1 does not ride on Web Audio", async () => {
    // The unattended-mic rule is not part of the degrade: a suspended context loses the energy
    // detector, never the visibility listener, or a failed AudioContext would leave the mic live.
    FakeAudioContext.stuckSuspended = true;
    const { result } = renderHook(() => useDictation(stopOpts()));
    await startRecording(result);
    await tick(1500); // past the 1000 ms floor — this case is about the listener, not the clip length
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.status).toBe("idle");
    expect(getDraft()).toBe("hello world"); // the same stop path — the clip still lands
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("a stale arm never tears down the NEXT recording's detector", async () => {
    // Recording A parks inside resume(); by the time that promise settles, A has been stopped and
    // recording B owns the interval/listener/context. A's continuation must close only its own.
    let openA!: () => void;
    FakeAudioContext.resumeGate = new Promise<void>((resolve) => {
      openA = resolve;
    });
    const { result } = renderHook(() => useDictation(stopOpts()));
    await startRecording(result); // A — its arm is stuck mid-resume
    await act(async () => {
      result.current.toggle(); // stop A: its detector (such as it is) is torn down
    });
    await startRecording(result); // B — arms its own context, interval and listener
    const unlisten = vi.spyOn(document, "removeEventListener");
    const unpoll = vi.spyOn(globalThis, "clearInterval");
    await act(async () => {
      openA(); // …and only now does A's resume settle, one recording too late
    });
    expect(contexts).toHaveLength(2);
    // A's continuation touches nothing global — B's listener, poll and context all stand…
    expect(unlisten).not.toHaveBeenCalled();
    expect(unpoll).not.toHaveBeenCalled();
    expect(contexts[1].close).not.toHaveBeenCalled();
    await tick(3000); // …and B's detector still works: its own silence run ends its own recording
    expect(result.current.status).toBe("idle");
  });

  it("a recorder error runs the full cleanup (interval · nodes · context · listener)", async () => {
    const { result } = renderHook(() => useDictation(stopOpts()));
    await startRecording(result);
    await tick(500);
    await act(async () => {
      FakeMediaRecorder.last?.onerror?.();
    });
    expect(result.current.status).toBe("idle");
    expect(vi.getTimerCount()).toBe(0);
    expect(contexts[0].close).toHaveBeenCalled();
    expect(contexts[0].source.disconnect).toHaveBeenCalled();
    expect(contexts[0].analyser.disconnect).toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange")); // the listener went with it
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("the cleanup completes BEFORE the upload starts sending", async () => {
    let timersAtUpload = -1;
    let ctxStateAtUpload = "";
    globalThis.fetch = vi.fn(async () => {
      timersAtUpload = vi.getTimerCount();
      ctxStateAtUpload = contexts[0].state;
      return { status: 200, ok: true, json: async () => ({ text: "hi" }) } as unknown as Response;
    });
    const { result } = renderHook(() => useDictation(stopOpts()));
    await startRecording(result);
    await tick(3000);
    expect(timersAtUpload).toBe(0);
    expect(ctxStateAtUpload).toBe("closed");
  });

  it("composes with auto-send: the silence run sends the transcript, hands-free end to end", async () => {
    mockStt(200, { text: "wake corsair" });
    const { result } = renderHook(() => useDictation(stopOpts(true)));
    await startRecording(result);
    await tick(3000);
    expect(runComposer).toHaveBeenCalledWith("wake corsair");
    expect(getDraft()).toBe("");
  });
});

describe("useDictation — the capture rides the ROUTE (D73 S5; closes the R51 §6.1 residual)", () => {
  /** `/voice/status.live_call`, reduced to the two fields this suite is about. */
  const knobs = (over: Record<string, unknown>) =>
    ({ ...opts(false), liveCall: over }) as unknown as Parameters<typeof useDictation>[0];
  /** The suite owns its own `getUserMedia` (rather than reading the shared fake's method back off
   *  `navigator`) because the CONSTRAINTS are what these cases assert, and a handle beats a reach. */
  let gum: ReturnType<typeof vi.fn>;
  const stubMic = (fn: ReturnType<typeof vi.fn>) => {
    gum = fn;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: fn },
    });
  };
  const asked = () => (gum.mock.calls[0][0] as { audio: Record<string, unknown> }).audio;

  beforeEach(() => {
    stubMic(vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })));
  });

  const arm = async (o: Parameters<typeof useDictation>[0]) => {
    const view = renderHook(() => useDictation(o));
    await act(async () => {
      await view.result.current.start();
    });
    return view;
  };

  it("asks with the ROUTE's constraints and the picked device — never a bare `audio: true`", async () => {
    // R74 §0.3: an unconstrained request is not neutral. It resolves to the platform AEC, which is
    // exactly what drops the phone into communication mode — dictation was in the same trap the call
    // was, and one builder now keeps the two asking identically.
    await arm(knobs({ route: "headphones", input_device: "bt-headset" }));
    expect(asked()).toMatchObject({
      echoCancellation: false,
      noiseSuppression: true,
      channelCount: 1,
      deviceId: { ideal: "bt-headset" },
    });
  });

  it("no knobs at all (a pre-S5 backend) is the SPEAKER route, asked for explicitly", async () => {
    await arm(opts(false));
    expect(asked()).toMatchObject({ echoCancellation: { ideal: "all" }, channelCount: 1 });
    expect(asked()).not.toHaveProperty("deviceId");
  });

  it("a device that will not open falls back to the default, records anyway, and SAYS so", async () => {
    stubMic(
      vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error("no"), { name: "NotReadableError" }))
        .mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    );
    const view = await arm(knobs({ route: "speaker", input_device: "gone" }));
    expect(view.result.current.status).toBe("recording"); // the recording is the point; the route is not
    expect(vi.mocked(pushToast)).toHaveBeenCalledWith(
      "That microphone wasn't available — using the default",
      "info",
    );
  });
});

describe("useDictation — handing the EAR to a call (D74 S6 ⑧, evidence docs/research/R78 §2.3)", () => {
  it("stops a live recording, WAITS for the microphone, and harvests by its own rules", async () => {
    // A live capture pins the platform's echo-cancellation mode for the next one on the same device,
    // so the call must not open beside this one. The stop is dictation's OWN — which is what keeps
    // the recorded clip on its ordinary path into the draft instead of being thrown away by a second
    // mechanism bolted on for the call's benefit. (The clock is nudged past the 1000 ms floor exactly
    // as `recordOnce` does: what this case is about is a REAL recording being taken over.)
    mockStt(200, { text: "mid sentence" });
    const { result } = renderHook(() => useDictation(opts(false)));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.status).toBe("recording"));

    const realNow = Date.now;
    const at = realNow() + 1200;
    Date.now = () => at;
    try {
      await act(async () => {
        await releaseMic();
      });
    } finally {
      Date.now = realNow;
    }
    expect(result.current.status).not.toBe("recording");
    await waitFor(() => expect(getDraft()).toBe("mid sentence"));
  });

  it("resolves at once when nothing is recording — every ordinary call", async () => {
    renderHook(() => useDictation(opts(false)));
    let settled = false;
    await act(async () => {
      await releaseMic().then(() => {
        settled = true;
      });
    });
    expect(settled).toBe(true);
  });

  it("withdraws the offer on unmount — a dead composer leaves no live handover behind", async () => {
    const { result, unmount } = renderHook(() => useDictation(opts(false)));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.status).toBe("recording"));
    unmount();
    await act(async () => {
      await releaseMic(); // nobody is offering: this must neither hang nor throw
    });
  });
});
