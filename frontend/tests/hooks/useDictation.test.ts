import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

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

import { TOO_SHORT_MSG, useDictation } from "../../src/hooks/useDictation";
import {
  FakeMediaRecorder,
  mockStt,
  recordOnce,
  pendingStt,
  scriptStt,
  setMediaDevices,
} from "./dictationFakes";
import { runComposer } from "../../src/lib/composer";
import { getChatStatus } from "../../src/store/chat";
import {
  carryOnLeave,
  clearDraft,
  getDraft,
  pruneSlots,
  setComposerSlot,
  setDraft,
  stopLiveDictation,
} from "../../src/store/composer";
import {
  captureOwned,
  releaseMic,
  resetCaptureOwners,
  resetLegHold,
} from "../../src/store/micRelease";
import { resetUploadActivity } from "../../src/store/uploadActivity";
import { pushToast, type ToastOptions } from "../../src/store/toast";
import type { VoiceStatus } from "../../src/hooks/useVoiceStatus";

const opts = (autoSend = false) => ({ sttReady: true, statusStamp: 1, autoSend });

beforeEach(() => {
  resetLegHold(); // D5 — no leg of the tab is closing out at the start of a case
  resetCaptureOwners(); // ISS-84 — nor is a capture owned (a case that ended mid-recording/upload)
  resetUploadActivity(); // …and its upload ACTIVITY (W1), which every instance's status paints
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

  it("a 502 (whole STT chain down) greys the mic reactively — and PARKS the clip (ISS-84)", async () => {
    mockStt(502, {});
    const { result } = renderHook(() => useDictation(opts(false)));
    await recordOnce(result);
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    // The greying is the chain's verdict and stays; the clip is no longer dropped with it.
    expect(pushToast).toHaveBeenCalledWith(
      "Clip didn't send",
      "err",
      expect.objectContaining({ persist: true }),
    );
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
    expect(captureOwned()).toBe(false); // ISS-84 — a denied start gives the tab back (no leak)
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
    act(() => result.current.stop("user")); // released mid-acquisition
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
    act(() => result.current.stop("user")); // released inside the window → the attempt is aborted
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
    expect(captureOwned()).toBe(false); // ISS-84 — `onerror` → `onstop` releases the tab's ownership
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
    expect(captureOwned()).toBe(false); // ISS-84 — the terminal `onstop` gave the tab back too
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
  /** When set, the next context starts `suspended` and the first resume() parks on this gate (consumed
   *  by the context that RESUMES — since K6 a context the probe rejected is made first and never
   *  resumed) — how a test holds one recording's async arm open across the next recording. */
  static resumeGate: Promise<void> | null = null;
  /** K6 — Firefox/Fennec before 148: `createMediaStreamSource` THROWS on a context whose rate is not
   *  the track's (R96 §2.3). The track here runs at the device's 48 kHz. */
  static foreignRateThrows = false;
  state: string;
  gate: Promise<void> | null = null;
  /** What the constructor was handed — the K6 ask, recorded. */
  options: AudioContextOptions | undefined;
  /** The rate it RUNS at: the requested one, as a real context honours it; else the device's. */
  sampleRate: number;
  analyser = new FakeAnalyser();
  source = { connect: vi.fn(), disconnect: vi.fn() };
  resume = vi.fn(async () => {
    if (!this.gate && FakeAudioContext.resumeGate) {
      this.gate = FakeAudioContext.resumeGate;
      FakeAudioContext.resumeGate = null;
    }
    if (this.gate) await this.gate;
    // A closed context stays closed — the real resume() rejects on one (the hook swallows it).
    if (!FakeAudioContext.stuckSuspended && this.state !== "closed") this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  constructor(options?: AudioContextOptions) {
    this.options = options;
    this.sampleRate = options?.sampleRate ?? 48000;
    this.state =
      FakeAudioContext.stuckSuspended || FakeAudioContext.resumeGate ? "suspended" : "running";
    contexts.push(this);
  }
  createAnalyser() {
    return this.analyser;
  }
  createMediaStreamSource() {
    if (FakeAudioContext.foreignRateThrows && this.sampleRate !== 48000)
      throw new DOMException("different sample-rate", "NotSupportedError");
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
    FakeAudioContext.foreignRateThrows = false;
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

  it("K6 — a stop during the FALLBACK context's resume closes the context the probe left parked", async () => {
    // THE NATIVE PATH (pre-148 Firefox): the 16 kHz context is rejected by the probe and released at
    // once, and the device-rate context that replaces it is the ownership token parked before the
    // await — so a stop landing inside that await still finds, and closes, the right one.
    FakeAudioContext.foreignRateThrows = true;
    let openA!: () => void;
    FakeAudioContext.resumeGate = new Promise<void>((resolve) => {
      openA = resolve;
    });
    const { result } = renderHook(() => useDictation(stopOpts()));
    await startRecording(result); // its arm is stuck mid-resume, on the FALLBACK context
    expect(contexts).toHaveLength(2);
    expect(contexts[0].options).toEqual({ sampleRate: 16000 });
    expect(contexts[0].close).toHaveBeenCalled();
    expect(contexts[0].resume).not.toHaveBeenCalled(); // the probe needs no running context
    expect(contexts[1].options).toBeUndefined();
    expect(contexts[1].resume).toHaveBeenCalledTimes(1); // the ONE resume path, on the survivor
    await act(async () => {
      result.current.toggle(); // stop DURING the await
    });
    expect(contexts[1].close).toHaveBeenCalledTimes(1);
    await act(async () => {
      openA(); // …and the stale continuation adds nothing: no poll, no second close
    });
    expect(contexts[1].close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.status).toBe("idle");
  });

  it("K6 — a FALLBACK context that will not run degrades exactly as today's suspended one (council 25)", async () => {
    // The stuck-suspended contract on the NATIVE path: the probe rejects the 16 kHz context, the
    // device-rate one goes through the ONE resume path, refuses to run, and the recording carries on
    // as plain push-to-talk on the clip — the live leg's degrade noted, only the AUDIO half released.
    FakeAudioContext.foreignRateThrows = true;
    FakeAudioContext.stuckSuspended = true;
    const streaming = {
      ...stopOpts(),
      liveEar: true,
      liveCall: { frame_ms: 40, buffered_ceiling_ms: 1000, tail_wait_ms: 2000, dictation: true },
    } as unknown as Parameters<typeof useDictation>[0];
    const { result } = renderHook(() => useDictation(streaming));
    await startRecording(result);
    expect(contexts).toHaveLength(2);
    expect(contexts[0].close).toHaveBeenCalled(); // the 16 kHz one, released by the probe
    expect(contexts[0].resume).not.toHaveBeenCalled();
    expect(contexts[1].resume).toHaveBeenCalledTimes(1);
    expect(contexts[1].close).toHaveBeenCalledTimes(1); // `teardownAudio` — the audio half only
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Live dictation"), "info");
    expect(result.current.status).toBe("recording"); // …and the recording carries on
    await tick(1500);
    await act(async () => {
      result.current.toggle();
    });
    expect(result.current.status).toBe("idle");
    expect(getDraft()).toBe("hello world"); // the clip carried it
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
    // jsdom's Storage schedules a timer per WRITE, and the upload loop writes its lost-clip mark
    // (ISS-84) before the POST — so storage writes are no-ops here: this case counts the DETECTOR's
    // timers, and only those.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
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
    await arm(knobs({ route: "media", input_device: "bt-headset" }));
    expect(asked()).toMatchObject({
      echoCancellation: false,
      noiseSuppression: true,
      channelCount: 1,
      deviceId: { ideal: "bt-headset" },
    });
  });

  it("no knobs at all (a pre-S5 backend) is the MEDIA route, asked for explicitly", async () => {
    await arm(opts(false));
    expect(asked()).toMatchObject({ echoCancellation: false, channelCount: 1 });
    expect(asked()).not.toHaveProperty("deviceId");
  });

  it("a device that will not open falls back to the default, records anyway, and SAYS so", async () => {
    stubMic(
      vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error("no"), { name: "NotReadableError" }))
        .mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    );
    const view = await arm(knobs({ route: "call", input_device: "gone" }));
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

// --- S11 (BUG-001) — the release post-roll (T1) and the honest go-signal (H1/H2) -------------------
describe("useDictation · S11 the release post-roll + the go seam (whole-clip path)", () => {
  /** `/voice/status.live_call` carrying ONLY the post-roll: no ear, so every recording is whole-clip —
   *  which is exactly the point: the tail governs the whole-clip path too. */
  const tailOpts = (release_tail_ms = 400) =>
    ({
      ...opts(false),
      liveCall: { release_tail_ms },
    }) as unknown as Parameters<typeof useDictation>[0];

  beforeEach(() => {
    vi.useFakeTimers();
    micLevel = 0;
    contexts = [];
    FakeAudioContext.stuckSuspended = false;
    FakeAudioContext.resumeGate = null;
    FakeAudioContext.foreignRateThrows = false;
    FakeMediaRecorder.last = null;
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.mocked(pushToast).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a USER stop keeps RECORDING for `release_tail_ms`, painted as `sending`, then uploads", async () => {
    const { result } = renderHook(() => useDictation(tailOpts()));
    await startRecording(result);
    await tick(1200);
    await act(async () => {
      result.current.toggle(); // the keyboard's stop — a user stop
    });
    expect(result.current.status).toBe("sending"); // the release is painted at once…
    expect(FakeMediaRecorder.last!.state).toBe("recording"); // …while the recorder runs on
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await tick(399);
    expect(FakeMediaRecorder.last!.state).toBe("recording");
    await tick(1);
    expect(FakeMediaRecorder.last!.state).toBe("inactive");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await tick(10);
    expect(getDraft()).toBe("hello world");
  });

  it("the 1000 ms FLOOR is measured to the RELEASE — the post-roll cannot carry a blip past it", async () => {
    const { result } = renderHook(() => useDictation(tailOpts()));
    await startRecording(result);
    await tick(700); // a 700 ms blip…
    act(() => result.current.stop("user"));
    await tick(400); // …plus the 400 ms tail is 1100 ms of recording, but the HOLD was 700
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(TOO_SHORT_MSG, "info");
  });

  // Phase 26 S1 (T4): the settle is DERIVED from the reason — `user` is the only one that settles.
  it.each([
    "idle",
    "max_duration",
    "page_hidden",
    "socket_lost",
    "client_backlog",
    "send_buffer",
    "call_handover",
    "unmount",
  ] as const)(
    "every NON-user stop is immediate — `%s` stops the recorder on the call",
    async (reason) => {
      const { result } = renderHook(() => useDictation(tailOpts()));
      await startRecording(result);
      await tick(1200);
      act(() => result.current.stop(reason));
      expect(FakeMediaRecorder.last!.state).toBe("inactive");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("a CANCEL inside the tail discards at once — no POST, and the timer is gone", async () => {
    const { result } = renderHook(() => useDictation(tailOpts()));
    await startRecording(result);
    await tick(1200);
    act(() => result.current.stop("user"));
    act(() => result.current.cancel());
    expect(FakeMediaRecorder.last!.state).toBe("inactive");
    await tick(2000);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("a CALL taking the ear inside the tail does not wait for it (`yieldMic` is immediate)", async () => {
    const { result } = renderHook(() => useDictation(tailOpts()));
    await startRecording(result);
    await tick(1200);
    act(() => result.current.stop("user"));
    let freed = false;
    await act(async () => {
      await releaseMic().then(() => {
        freed = true;
      });
    });
    expect(freed).toBe(true);
    expect(FakeMediaRecorder.last!.state).toBe("inactive");
  });

  it("a re-press during the tail gets `false` — one recording at a time", async () => {
    const { result } = renderHook(() => useDictation(tailOpts()));
    await startRecording(result);
    await tick(1200);
    act(() => result.current.stop("user"));
    let armed: boolean | undefined;
    await act(async () => {
      armed = await result.current.start();
    });
    expect(armed).toBe(false);
  });

  it("a Conf save that changes the tail MID-RECORDING neither ends the recording nor loses the new value", async () => {
    // `stop` keeps its identity (the tail rides a ref): the unmount sweep is keyed on it, and a
    // re-identified `stop` would run the sweep — i.e. stop a live recording on a status refetch.
    const { result, rerender } = renderHook(
      (o: Parameters<typeof useDictation>[0]) => useDictation(o),
      {
        initialProps: tailOpts(400),
      },
    );
    await startRecording(result);
    await tick(1200);
    rerender(tailOpts(800));
    expect(FakeMediaRecorder.last!.state).toBe("recording");
    act(() => result.current.stop("user"));
    await tick(799);
    expect(FakeMediaRecorder.last!.state).toBe("recording");
    await tick(1);
    expect(FakeMediaRecorder.last!.state).toBe("inactive");
  });

  it("`release_tail_ms: 0` (or absent) is the pre-S11 immediate stop", async () => {
    const { result } = renderHook(() => useDictation(tailOpts(0)));
    await startRecording(result);
    await tick(1200);
    act(() => result.current.stop("user"));
    expect(FakeMediaRecorder.last!.state).toBe("inactive");
  });

  it("the meter goes quiet at the release — the post-roll records, but the gesture has closed", async () => {
    const meter = vi.fn();
    const { result } = renderHook(() => useDictation(tailOpts()));
    result.current.meter.current = meter;
    await startRecording(result);
    micLevel = 0.06;
    await tick(1200);
    expect(meter).toHaveBeenCalled();
    act(() => result.current.stop("user"));
    meter.mockClear();
    await tick(300);
    expect(meter).not.toHaveBeenCalled();
  });

  it("GO fires once, on the first meter poll — the clip is the carrier and the stream is proven running", async () => {
    const onLive = vi.fn();
    const { result } = renderHook(() => useDictation(tailOpts()));
    result.current.onLive.current = onLive;
    await startRecording(result);
    expect(onLive).not.toHaveBeenCalled();
    await tick(100);
    expect(onLive).toHaveBeenCalledTimes(1);
    await tick(1000);
    expect(onLive).toHaveBeenCalledTimes(1);
  });

  it("…at once where the context will not run — the recorder has been capturing since `rec.start()`", async () => {
    FakeAudioContext.stuckSuspended = true;
    const onLive = vi.fn();
    const { result } = renderHook(() => useDictation(tailOpts()));
    result.current.onLive.current = onLive;
    await startRecording(result);
    expect(onLive).toHaveBeenCalledTimes(1);
  });

  it("…and never once the owner has let go", async () => {
    const onLive = vi.fn();
    const { result } = renderHook(() => useDictation(tailOpts()));
    result.current.onLive.current = onLive;
    await startRecording(result);
    act(() => result.current.stop("user")); // released before the first poll
    await tick(500);
    expect(onLive).not.toHaveBeenCalled();
  });
});

// S11 fix wave 1 — every real NON-user trigger, fired from INSIDE a running tail: the recorder stops at
// once, the tail's timer is gone (running the clock past it changes nothing), exactly one upload.
describe("useDictation · S11 the non-user stops CUT a running tail (whole-clip path)", () => {
  const TAIL_MS = 400;
  const withTail = (autoStop?: typeof AUTO_STOP) =>
    ({
      ...opts(false),
      ...(autoStop ? { autoStop } : {}),
      liveCall: { release_tail_ms: TAIL_MS },
    }) as unknown as Parameters<typeof useDictation>[0];

  beforeEach(() => {
    vi.useFakeTimers();
    micLevel = 0.5; // speaking until the case says otherwise
    contexts = [];
    FakeAudioContext.stuckSuspended = false;
    FakeAudioContext.resumeGate = null;
    FakeAudioContext.foreignRateThrows = false;
    FakeMediaRecorder.last = null;
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.mocked(pushToast).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Start, hold past the floor, release as the OWNER — the tail is now running. */
  async function intoTail(result: { current: ReturnType<typeof useDictation> }) {
    await startRecording(result);
    await tick(1200);
    act(() => result.current.stop("user"));
    expect(FakeMediaRecorder.last!.state).toBe("recording"); // settling
  }

  /** The cut's whole contract: stopped NOW, one upload, and nothing left for the timer to do. */
  async function expectCutOnce(result: { current: ReturnType<typeof useDictation> }) {
    expect(FakeMediaRecorder.last!.state).toBe("inactive");
    await tick(TAIL_MS * 3);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("idle");
  }

  it("a HIDDEN page inside the tail stops at once", async () => {
    const { result } = renderHook(() => useDictation(withTail(AUTO_STOP))); // the policy arms the listener
    await intoTail(result);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await expectCutOnce(result);
  });

  it("the silence AUTO-STOP landing inside the tail stops at once", async () => {
    const quick = { enabled: true, silence_s: 0.2, threshold: 0.01 }; // 2 readings — inside the 400 ms tail
    const { result } = renderHook(() => useDictation(withTail(quick)));
    await intoTail(result);
    micLevel = 0; // the owner fell silent after letting go
    await tick(200);
    await expectCutOnce(result);
  });

  it("a CALL taking the ear inside the tail stops at once", async () => {
    const { result } = renderHook(() => useDictation(withTail()));
    await intoTail(result);
    await act(async () => {
      await releaseMic();
    });
    await expectCutOnce(result);
  });

  it("an UNMOUNT inside the tail stops at once (the clip still uploads by value)", async () => {
    const { result, unmount } = renderHook(() => useDictation(withTail()));
    await intoTail(result);
    const rec = FakeMediaRecorder.last!;
    unmount();
    expect(rec.state).toBe("inactive");
    await tick(TAIL_MS * 3);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('a DOUBLE `stop("user")` is one tail and one upload', async () => {
    const { result } = renderHook(() => useDictation(withTail()));
    await intoTail(result);
    await tick(300);
    act(() => result.current.stop("user")); // a second release (a stray tap) must not restart the tail
    await tick(100); // the FIRST tail's deadline
    await expectCutOnce(result);
  });
});

// ── Phase 27 S8 — the clip door's slot (R35) ──────────────────────────────────────────────────────────
// A whole-clip (push-to-talk) recording captures the conversation at the PRESS, in its closure: the
// transcript lands in that draft wherever the view went, and an auto-send across the hop sends nothing
// (§12.1 ④). A view swap does not stop it — only a STREAMING dictation is the live one a swap ends
// (§12.2 ④; those arms are in `dictationStreaming.test.ts`).
describe("useDictation · Phase 27 S8 — the clip door lands in the slot captured at the press", () => {
  afterEach(() => {
    setComposerSlot("");
    pruneSlots(() => false);
  });

  it("press in L2, hop to E1, release → L2's draft, E1 untouched, no auto-send across the hop", async () => {
    setComposerSlot("L2");
    const { result } = renderHook(() => useDictation(opts(true)));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.status).toBe("recording"));
    // the hop: the swap's stop is a no-op for the clip door, and the slot follows the view
    await act(async () => {
      await stopLiveDictation();
      setComposerSlot("E1");
    });
    act(() => setDraft("E1's own words")); // what an auto-send reading the VIEW's draft would send
    expect(result.current.status).toBe("recording");
    const realNow = Date.now;
    const at = realNow() + 1200; // past the 1000 ms floor (`recordOnce`'s nudge)
    Date.now = () => at;
    try {
      act(() => result.current.toggle());
    } finally {
      Date.now = realNow;
    }
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(getDraft()).toBe("E1's own words");
    expect(runComposer).not.toHaveBeenCalled();
    setComposerSlot("L2");
    expect(getDraft()).toBe("hello world");
  });

  it("F1 — pressed thread-less, a Send while held lazily mints X: the transcript lands in X", async () => {
    const { result } = renderHook(() => useDictation(opts(false)));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.status).toBe("recording"));
    act(() => setComposerSlot("X", true)); // the lazy mint (`setWireThread`'s flag; nothing to carry)
    const realNow = Date.now;
    const at = realNow() + 1200;
    Date.now = () => at;
    try {
      act(() => result.current.toggle());
    } finally {
      Date.now = realNow;
    }
    await waitFor(() => expect(getDraft()).toBe("hello world"));
    setComposerSlot("");
    expect(getDraft()).toBe(""); // nothing stranded in the thread-less view
  });

  it("a clip pending across an E6 carry lands in the opened draft and does NOT auto-send (involuntary move)", async () => {
    setComposerSlot("D");
    let answer!: () => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = () =>
            resolve({
              status: 200,
              ok: true,
              json: async () => ({ text: "late clip words" }),
            } as unknown as Response);
        }),
    );
    const { result } = renderHook(() => useDictation(opts(true)));
    await recordOnce(result);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    act(() => {
      carryOnLeave("D");
      setComposerSlot("A");
    });
    await act(async () => {
      answer();
    });
    await waitFor(() => expect(getDraft()).toBe("late clip words"));
    expect(runComposer).not.toHaveBeenCalled();
  });

  it("F4 — a clip pending when E6 carries its conversation lands in what opened, nothing re-created", async () => {
    setComposerSlot("D");
    let answer!: () => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = () =>
            resolve({
              status: 200,
              ok: true,
              json: async () => ({ text: "late clip words" }),
            } as unknown as Response);
        }),
    );
    const { result } = renderHook(() => useDictation(opts(false)));
    await recordOnce(result); // released — the upload is in flight
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    act(() => {
      carryOnLeave("D"); // D deleted elsewhere: the fallback starts…
      setComposerSlot("A"); // …and opens A
    });
    await act(async () => {
      answer();
    });
    await waitFor(() => expect(getDraft()).toBe("late clip words"));
    const stored = JSON.parse(localStorage.getItem("ctrlb.composer") ?? "{}") as {
      drafts?: Record<string, string>;
    };
    expect(stored.drafts?.D).toBeUndefined();
  });

  it("without a hop the auto-send is unchanged — it sends from the conversation it started in", async () => {
    setComposerSlot("L2");
    const { result } = renderHook(() => useDictation(opts(true)));
    await recordOnce(result);
    await waitFor(() => expect(runComposer).toHaveBeenCalledWith("hello world"));
    expect(getDraft()).toBe("");
  });
});

// --- ISS-84: the bounded, retried, never-dropped clip upload (car-wave design §2) --------------------
// The loop is ONE chokepoint (`sendClip`), so it is driven through the public verbs under FAKE timers:
// the attempt's deadline is an `AbortController` + `setTimeout` precisely so this clock can run it. The
// clip door is scripted attempt by attempt (`scriptStt`), and its fake honours the abort signal exactly
// as a real `fetch` does — the deadline is only real if the request actually dies with it.

describe("useDictation · ISS-84 the clip upload loop", () => {
  const KNOBS = { timeout_s: 5, attempts: 3 };
  const loopOpts = (over: Record<string, unknown> = {}) =>
    ({ ...opts(false), upload: KNOBS, ...over }) as Parameters<typeof useDictation>[0];
  type Mic = { current: ReturnType<typeof useDictation> };

  /** Record a clip held `heldMs` and release it — the upload starts on the release. */
  async function recordClip(result: Mic, heldMs = 1200): Promise<void> {
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe("recording");
    await act(async () => {
      vi.advanceTimersByTime(heldMs);
    });
    await act(async () => {
      result.current.stop("user");
    });
  }

  /** Run the clock and let what it kicked off (an abort, a backoff, an answer) settle. */
  async function tick(ms: number): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  /** The parked clip's toast options (the LAST one pushed), or undefined. */
  function parked(): ToastOptions | undefined {
    const calls = vi.mocked(pushToast).mock.calls.filter((c) => c[0] === "Clip didn't send");
    return calls.at(-1)?.[2];
  }

  const marks = (): string[] =>
    Object.keys(JSON.parse(localStorage.getItem("ctrlb.pendingClips") ?? "{}") as object);

  let online: MockInstance<() => boolean> | null = null;
  function setOnline(on: boolean): void {
    online ??= vi.spyOn(navigator, "onLine", "get");
    online.mockReturnValue(on);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.removeItem("ctrlb.pendingClips");
    vi.mocked(runComposer).mockClear();
  });
  afterEach(() => {
    online?.mockRestore();
    online = null;
    vi.useRealTimers();
  });

  it("timeout → retry → success: the text lands ONCE, auto-sends ONCE, with no toast and no greying", async () => {
    const door = scriptStt("hang", "hang", { status: 200, body: { text: "late words" } });
    const { result } = renderHook(() => useDictation(loopOpts({ autoSend: true })));
    await recordClip(result);
    expect(door.calls).toHaveLength(1);
    expect(marks()).toHaveLength(1); // marked at the loop's ENTRY (W4) — a hang is the usual failure
    expect(result.current.status).toBe("sending");
    expect(result.current.sendingAttempt).toBeUndefined(); // the first attempt keeps the plain label
    await tick(5000); // attempt 1's horizon (max(5 s, 2 × the 1.2 s clip)) — aborted
    expect(door.calls[0].signal?.aborted).toBe(true);
    expect(door.calls).toHaveLength(1); // …and the backoff is REAL: no instant re-send (W9)
    await tick(1000); // backoff min(5 s, 1 s · 2^0)
    expect(door.calls).toHaveLength(2);
    expect(result.current.sendingAttempt).toEqual({ attempt: 2, of: 3 });
    await tick(5000);
    expect(door.calls).toHaveLength(2); // the second backoff is real too
    await tick(2000); // backoff min(5 s, 1 s · 2^1)
    expect(door.calls).toHaveLength(3);
    expect(runComposer).toHaveBeenCalledTimes(1);
    expect(runComposer).toHaveBeenCalledWith("late words");
    expect(result.current.status).toBe("idle");
    expect(result.current.sendingAttempt).toBeUndefined();
    expect(pushToast).not.toHaveBeenCalled(); // ruling 6: no toast per attempt…
    expect(marks()).toHaveLength(0); // …and the landed clip is no longer at risk
  });

  it("a retryable failure never greys the mic and never toasts (ruling 6)", async () => {
    scriptStt("reject", "reject", { status: 200, body: { text: "ok" } });
    const statuses: string[] = [];
    const { result } = renderHook(() => {
      const mic = useDictation(loopOpts());
      statuses.push(mic.status);
      return mic;
    });
    await recordClip(result);
    await tick(1000);
    await tick(2000);
    expect(getDraft()).toBe("ok");
    expect(statuses).not.toContain("unavailable");
    expect(pushToast).not.toHaveBeenCalled();
  });

  it("a body-read TRANSPORT failure is retried — a 200 whose body never arrives is not a success", async () => {
    const door = scriptStt(
      { status: 200, json: "transport" },
      { status: 200, body: { text: "x" } },
    );
    const { result } = renderHook(() => useDictation(loopOpts()));
    await recordClip(result);
    await tick(1000);
    expect(door.calls).toHaveLength(2);
    expect(getDraft()).toBe("x");
  });

  it("a body that never arrives is ended by the SAME deadline as the request (one signal)", async () => {
    const door = scriptStt({ status: 200, json: "hang" }, { status: 200, body: { text: "y" } });
    const { result } = renderHook(() => useDictation(loopOpts()));
    await recordClip(result);
    await tick(5000);
    await tick(1000);
    expect(door.calls).toHaveLength(2);
    expect(getDraft()).toBe("y");
  });

  it("a SyntaxError on a COMPLETE body parks — never retried", async () => {
    const door = scriptStt({ status: 200, json: "syntax" });
    const { result } = renderHook(() => useDictation(loopOpts()));
    await recordClip(result);
    await tick(10_000);
    expect(door.calls).toHaveLength(1);
    expect(parked()).toMatchObject({ persist: true });
    expect(result.current.status).toBe("idle");
    expect(marks()).toHaveLength(1);
  });

  it("a 5xx parks without a retry — and only a 502 greys the mic", async () => {
    const door = scriptStt({ status: 503 });
    const { result } = renderHook(() => useDictation(loopOpts()));
    await recordClip(result);
    await tick(10_000);
    expect(door.calls).toHaveLength(1);
    expect(parked()).toBeDefined();
    expect(result.current.status).toBe("idle"); // a 503 is not the chain's verdict
    scriptStt({ status: 502 });
    await recordClip(result);
    await tick(10_000);
    expect(result.current.status).toBe("unavailable");
    expect(vi.mocked(pushToast).mock.calls.filter((c) => c[0] === "Clip didn't send")).toHaveLength(
      2,
    );
  });

  it("a 4xx keeps the old toast and drops the clip — no park, no mark", async () => {
    const door = scriptStt({ status: 422 });
    const { result } = renderHook(() => useDictation(loopOpts()));
    await recordClip(result);
    await tick(10_000);
    expect(door.calls).toHaveLength(1);
    expect(pushToast).toHaveBeenCalledWith("Transcription failed (422)", "err");
    expect(parked()).toBeUndefined();
    expect(marks()).toHaveLength(0);
  });

  it("OFFLINE spends no attempt: `online` wakes it, and the listener goes with the wake", async () => {
    setOnline(false);
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const door = scriptStt({ status: 200, body: { text: "back" } });
    const { result } = renderHook(() => useDictation(loopOpts()));
    await recordClip(result);
    await tick(10_000); // well inside the total horizon (3 × 5 s)
    expect(door.calls).toHaveLength(0); // nothing spent on a link the browser knows is down
    expect(result.current.status).toBe("sending");
    expect(marks()).toHaveLength(1); // …but the clip is at risk, so it is marked
    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await tick(0);
    expect(door.calls).toHaveLength(1);
    expect(getDraft()).toBe("back");
    const listener = add.mock.calls.find((c) => c[0] === "online")?.[1];
    expect(remove).toHaveBeenCalledWith("online", listener);
  });

  it("…and OFFLINE through the whole TOTAL horizon parks, the listener removed on the timer's path too", async () => {
    setOnline(false);
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const door = scriptStt();
    const { result } = renderHook(() => useDictation(loopOpts()));
    await recordClip(result);
    await tick(15_000); // attempts × horizon = 3 × 5 s
    expect(door.calls).toHaveLength(0);
    expect(parked()).toBeDefined();
    expect(result.current.status).toBe("idle");
    const listener = add.mock.calls.find((c) => c[0] === "online")?.[1];
    expect(listener).toBeDefined();
    expect(remove).toHaveBeenCalledWith("online", listener); // `{once}` alone would have leaked it
  });

  it("a fast rejection while OFFLINE is not an attempt either (Chrome rejects at once with no network)", async () => {
    const door = scriptStt("reject", { status: 200, body: { text: "z" } });
    // The radio dies AS the clip leaves: online at the loop's top, offline by the rejection.
    const scripted = globalThis.fetch;
    globalThis.fetch = vi.fn((...args: Parameters<typeof fetch>) => {
      if (door.calls.length === 0) setOnline(false);
      return scripted(...args);
    });
    const { result } = renderHook(() =>
      useDictation(loopOpts({ upload: { timeout_s: 5, attempts: 1 } })),
    );
    await recordClip(result);
    await tick(0);
    expect(door.calls).toHaveLength(1);
    expect(parked()).toBeUndefined(); // ONE attempt configured, yet nothing parked: it was not spent
    expect(result.current.status).toBe("sending"); // …it waits for the link instead
    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await tick(0);
    expect(door.calls).toHaveLength(2);
    expect(getDraft()).toBe("z");
  });

  it("the horizon follows the clip's length — TWICE it (W5) — so a long dictation is not aborted at the floor", async () => {
    const door = scriptStt("hang");
    const { result } = renderHook(() =>
      useDictation(loopOpts({ upload: { timeout_s: 1, attempts: 1 } })),
    );
    await recordClip(result, 4000);
    await tick(1000); // the knob's floor alone would have aborted here
    expect(door.calls[0].signal?.aborted).toBe(false);
    await tick(3000); // the clip's own 4 s — a slow-but-alive 32 kbps link would be cut off here
    expect(door.calls[0].signal?.aborted).toBe(false);
    await tick(4000); // max(1 s, 2 × the 4 s clip)
    expect(door.calls[0].signal?.aborted).toBe(true);
  });

  it("a LATE wake gets its attempt's FULL horizon (X3); past the total, the gate parks without a new one", async () => {
    setOnline(false);
    const door = scriptStt("hang", "hang");
    const { result } = renderHook(() => useDictation(loopOpts())); // total = 3 × 5 s
    await recordClip(result);
    await tick(13_000); // a tunnel eats most of the total…
    expect(door.calls).toHaveLength(0);
    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online")); // …and the link returns with 2 s left
    });
    await tick(0);
    expect(door.calls).toHaveLength(1);
    await tick(2000); // a cap to what is left would have aborted the returning link's try here
    expect(door.calls[0].signal?.aborted).toBe(false);
    await tick(3000); // the full 5 s horizon
    expect(door.calls[0].signal?.aborted).toBe(true);
    await tick(0);
    await tick(0);
    expect(door.calls).toHaveLength(1); // attempts remain, but no NEW one starts past the total
    expect(parked()).toBeDefined();
    expect(result.current.status).toBe("idle");
  });

  it("a remount DURING the pre-attempt offline wait already shows `sending` (X1)", async () => {
    setOnline(false);
    const door = scriptStt();
    const first = renderHook(() => useDictation(loopOpts()));
    await recordClip(first.result);
    first.unmount();
    const second = renderHook(() => useDictation(loopOpts()));
    expect(door.calls).toHaveLength(0); // still waiting for the link — no attempt yet…
    expect(second.result.current.status).toBe("sending"); // …and the tab already paints it
    expect(second.result.current.sendingAttempt).toBeUndefined(); // attempt 1: the plain label
  });

  it("a parked 502's Retry paints `sending` over the greying (X2), which returns once it settles", async () => {
    scriptStt({ status: 502 });
    const { result } = renderHook(() => useDictation(loopOpts()));
    await recordClip(result);
    await tick(0);
    expect(result.current.status).toBe("unavailable");
    const toast = parked()!;
    const answer = pendingStt(); // the Retry's POST waits for the case
    await act(async () => {
      toast.action!.onClick();
    });
    expect(result.current.status).toBe("sending"); // the upload outranks the flag…
    await act(async () => {
      answer.answer();
    });
    await tick(0);
    expect(getDraft()).toBe("hello world");
    expect(result.current.status).toBe("unavailable"); // …which is preserved for after it
  });

  it("…and a clip with NO stamp (`Infinity`) never reaches the timer — the knob alone is the horizon", async () => {
    vi.setSystemTime(0); // `rec.start()` stamps 0 → the clip carries `Infinity` (the deliberate default)
    const door = scriptStt("hang");
    const { result } = renderHook(() =>
      useDictation(loopOpts({ upload: { timeout_s: 2, attempts: 1 } })),
    );
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      result.current.stop("user"); // no time passes: only `Infinity` gets this clip past the floor
    });
    await tick(0);
    expect(door.calls).toHaveLength(1);
    expect(door.calls[0].signal?.aborted).toBe(false); // `setTimeout(Infinity)` would have fired at once
    await tick(2000);
    expect(door.calls[0].signal?.aborted).toBe(true);
  });

  it("knobs ABSENT (an older server) → one attempt, no deadline at all", async () => {
    const door = scriptStt("hang");
    const { result } = renderHook(() => useDictation(opts(false)));
    await recordClip(result);
    await tick(600_000);
    expect(door.calls).toHaveLength(1);
    expect(door.calls[0].signal?.aborted).toBe(false);
    expect(result.current.status).toBe("sending");
  });

  it("…and its one failed shot PARKS rather than dropping the clip", async () => {
    const door = scriptStt("reject");
    const { result } = renderHook(() => useDictation(opts(false)));
    await recordClip(result);
    await tick(0);
    expect(door.calls).toHaveLength(1);
    expect(parked()).toBeDefined();
    expect(result.current.status).toBe("idle"); // never `unavailable` for a link failure
  });

  it("exhaustion parks → Retry REFUSED while a recording owns the tab (toast kept) → Retry lands", async () => {
    const door = scriptStt("reject", "reject", { status: 200, body: { text: "kept words" } });
    const { result } = renderHook(() =>
      useDictation(loopOpts({ upload: { timeout_s: 5, attempts: 2 } })),
    );
    await recordClip(result);
    await tick(1000);
    expect(door.calls).toHaveLength(2);
    const toast = parked()!;
    expect(toast).toMatchObject({ persist: true });
    expect(toast.action?.label).toBe("Retry");
    expect(toast.secondary?.label).toBe("Discard");
    expect(result.current.status).toBe("idle"); // the mic is usable again
    // A NEW recording owns the tab's capture: Retry refuses, says so, and keeps its toast.
    await act(async () => {
      await result.current.start();
    });
    let kept: unknown;
    act(() => {
      kept = toast.action!.onClick();
    });
    expect(kept).toBe(false);
    expect(pushToast).toHaveBeenCalledWith("The mic is busy — try again in a moment", "info");
    expect(door.calls).toHaveLength(2);
    act(() => result.current.cancel());
    // Free again → the SAME clip re-enters the loop and lands.
    await act(async () => {
      toast.action!.onClick();
    });
    await tick(0);
    expect(door.calls).toHaveLength(3);
    expect(getDraft()).toBe("kept words");
    expect(marks()).toHaveLength(0);
  });

  it("Discard drops the parked clip and clears its mark", async () => {
    scriptStt({ status: 503 });
    const { result } = renderHook(() => useDictation(loopOpts()));
    await recordClip(result);
    await tick(0);
    expect(marks()).toHaveLength(1);
    act(() => {
      parked()!.secondary!.onClick();
    });
    expect(marks()).toHaveLength(0);
  });

  it("UNMOUNT never aborts (ruling 18): a composer gone mid-upload still lands its clip", async () => {
    const door = scriptStt("hang", { status: 200, body: { text: "after the tab switch" } });
    const { result, unmount } = renderHook(() => useDictation(loopOpts()));
    await recordClip(result);
    unmount();
    expect(door.calls[0].signal?.aborted).toBe(false);
    await tick(5000);
    await tick(1000);
    expect(getDraft()).toBe("after the tab switch");
  });

  it("a REMOUNTED composer SHOWS its predecessor's upload and cannot start over it (C4 + W1)", async () => {
    const door = pendingStt();
    const first = renderHook(() => useDictation(loopOpts()));
    await recordClip(first.result);
    first.unmount();
    const second = renderHook(() => useDictation(loopOpts()));
    // Its own phase is idle, but the TAB is sending: the spinner (and ISS-83's door) follow the tab.
    expect(second.result.current.status).toBe("sending");
    let armed: boolean | undefined;
    await act(async () => {
      armed = await second.result.current.start();
    });
    expect(armed).toBe(false); // the tab's ownership refuses it…
    expect(pushToast).toHaveBeenCalledWith("Still sending the last clip", "info"); // …and SAYS so
    await act(async () => {
      door.answer();
    });
    await tick(0);
    expect(second.result.current.status).toBe("idle");
    await act(async () => {
      armed = await second.result.current.start();
    });
    expect(armed).toBe(true);
  });

  it.each([
    ["{}", {}],
    ["null", null],
    ['{"text": 42}', { text: 42 }],
  ])(
    "a 200 whose JSON is not a transcript (%s) PARKS — never the silent drop (W6)",
    async (_n, body) => {
      const door = scriptStt({ status: 200, body });
      const { result } = renderHook(() => useDictation(loopOpts()));
      await recordClip(result);
      await tick(10_000);
      expect(door.calls).toHaveLength(1); // not retried
      expect(parked()).toBeDefined();
      expect(pushToast).not.toHaveBeenCalledWith("Didn't catch that — try again", "info");
    },
  );

  it('…while `{"text": ""}` is legitimate silence: "didn\'t catch that", nothing parked', async () => {
    scriptStt({ status: 200, body: { text: "" } });
    const { result } = renderHook(() => useDictation(loopOpts()));
    await recordClip(result);
    await tick(0);
    expect(pushToast).toHaveBeenCalledWith("Didn't catch that — try again", "info");
    expect(parked()).toBeUndefined();
    expect(marks()).toHaveLength(0);
  });

  it("a Retry reads the LIVE policy from the query cache (W2): auto-send turned on while parked is honoured", async () => {
    const qc = new QueryClient();
    const status = (autoSend: boolean): VoiceStatus => ({
      stt: true,
      tts: false,
      stt_auto_send: autoSend,
      stt_upload: { timeout_s: 5, attempts: 1 },
    });
    qc.setQueryData(["voice-status"], status(false));
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    scriptStt("reject", { status: 200, body: { text: "parked words" } });
    // The PROPS say auto-send OFF and no knobs throughout: only the cache can turn it on.
    const { result } = renderHook(() => useDictation(opts(false)), { wrapper });
    await recordClip(result);
    await tick(0);
    const toast = parked()!;
    expect(toast).toBeDefined(); // the cache's ONE attempt was spent (props alone would also be one)
    act(() => {
      qc.setQueryData(["voice-status"], status(true)); // the owner flips Conf meanwhile
    });
    await act(async () => {
      toast.action!.onClick();
    });
    await tick(0);
    expect(runComposer).toHaveBeenCalledWith("parked words");
  });
});
