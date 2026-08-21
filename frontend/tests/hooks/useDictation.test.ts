import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// hooks/useDictation — the tap-to-start/stop mic state machine. We replace MediaRecorder + getUserMedia
// + fetch with fakes and drive the recorder lifecycle, asserting the transcript lands (fill vs
// auto-send) and the failure modes (502 → reactive "unavailable"; insecure-context → distinct toast).
// The composer draft store is REAL (so we assert the hand-off); toast/runComposer/chat-status mocked.

vi.mock("../../src/store/toast", () => ({ pushToast: vi.fn() }));
vi.mock("../../src/lib/composer", () => ({ runComposer: vi.fn() }));
vi.mock("../../src/store/chat", () => ({ getChatStatus: vi.fn(() => "idle") }));

import { useDictation } from "../../src/hooks/useDictation";
import { runComposer } from "../../src/lib/composer";
import { getChatStatus } from "../../src/store/chat";
import { clearDraft, getDraft } from "../../src/store/composer";
import { pushToast } from "../../src/store/toast";

class FakeMediaRecorder {
  static isTypeSupported() {
    return true;
  }
  /** The instance the hook is currently driving — the handle the auto-stop suite needs to fire
   *  `onerror` (a recorder failure is not reachable through the public toggle). */
  static last: FakeMediaRecorder | null = null;
  state = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? "audio/webm";
    FakeMediaRecorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function setMediaDevices(present: boolean) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: present
      ? { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) }
      : undefined,
  });
}

function mockStt(status: number, body: unknown) {
  globalThis.fetch = vi.fn(
    async () =>
      ({
        status,
        ok: status >= 200 && status < 300,
        json: async () => body,
      }) as unknown as Response,
  );
}

const opts = (autoSend = false) => ({ sttReady: true, statusStamp: 1, autoSend });

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  setMediaDevices(true);
  clearDraft();
  mockStt(200, { text: "hello world" });
});

/** Tap to start, wait until recording, tap to stop (which kicks off the async upload). */
async function recordOnce(result: { current: { toggle: () => void; status: string } }) {
  act(() => result.current.toggle());
  await waitFor(() => expect(result.current.status).toBe("recording"));
  act(() => result.current.toggle());
}

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
  state: string;
  analyser = new FakeAnalyser();
  source = { connect: vi.fn(), disconnect: vi.fn() };
  resume = vi.fn(async () => {
    if (!FakeAudioContext.stuckSuspended) this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  constructor() {
    this.state = FakeAudioContext.stuckSuspended ? "suspended" : "running";
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

  it("toggle OFF constructs nothing — the recording is byte-identical to push-to-talk", async () => {
    const off = stopOpts(false, { ...AUTO_STOP, enabled: false });
    const { result } = renderHook(() => useDictation(off));
    await startRecording(result);
    await tick(30_000);
    expect(contexts).toHaveLength(0); // no AudioContext, no analyser, no timer
    expect(result.current.status).toBe("recording"); // still waiting for the tap, as always
  });

  it("an ABSENT policy (older backend / stub) reads as disabled — LOW-4", async () => {
    // No `autoStop` prop at all — exactly what an older backend's `/voice/status` produces.
    const { result } = renderHook(() => useDictation(opts(false)));
    await startRecording(result);
    await tick(30_000);
    expect(contexts).toHaveLength(0);
    expect(result.current.status).toBe("recording");
  });

  it("a hidden page stops the recording outright (MED-1) — the mic never runs untended", async () => {
    const { result } = renderHook(() => useDictation(stopOpts()));
    await startRecording(result);
    micLevel = 0.5; // mid-sentence: only the visibility rule can end this recording
    await tick(500);
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
    expect(vi.getTimerCount()).toBe(0);
    expect(pushToast).not.toHaveBeenCalled(); // no error surface: it is just push-to-talk again
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange")); // the listener is scoped WITH the feature
    });
    expect(result.current.status).toBe("recording");
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
