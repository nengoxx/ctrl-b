import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveDown } from "../../src/lib/liveSocket";

// hooks/useDictation · PHRASE-BY-PHRASE STREAMING DICTATION (Phase 24 / S2.5, D71 §7-S2.5; evidence
// docs/research/R70). The recorder machine's own arms live in `useDictation.test.ts` and are untouched
// — what is pinned HERE is the optional leg beside it: when it arms, what reaches the wire and in what
// ORDER, which of the two transcripts wins (the either/or), and every way it is allowed to fail.
//
// The two modules the leg is made of are mocked to module state the cases drive (`useLiveCallWiring`'s
// pattern, one layer down): `openLiveSocket` hands back a spy whose UPLINK VOCABULARY is recorded in
// order, and `attachPcmUplink` hands back the worklet's `onFrame` so a case can ship exact frames. The
// recorder, the AudioContext and `/api/voice/stt` are the same fakes the mic's own suite drives, so a
// case can always ask the one question that matters: did the CLIP go out, or did the phrases?

const h = vi.hoisted(() => ({
  /** Every uplink WORD, in order — the release choreography's whole assertion. */
  sent: [] as string[],
  /** Every binary frame the leg shipped, in order — the backlog drain's whole assertion. */
  audio: [] as ArrayBuffer[],
  /** The relay's downlink door, and its close — the case IS the relay. */
  frame: null as ((f: LiveDown) => void) | null,
  close: null as (() => void) | null,
  /** The worklet's door: the case IS the microphone. */
  onFrame: null as ((f: { buf: ArrayBuffer; rms: number }) => void) | null,
  /** How many sockets were opened, and with what — "did it stream at all" is a count. */
  opens: [] as { sampleRate: number; ceilingMs: number }[],
  uplinkStops: 0,
  /** Holds `attachPcmUplink` open when an arm needs the install window itself. */
  attachGate: Promise.resolve(),
}));

vi.mock("../../src/store/toast", () => ({ pushToast: vi.fn() }));
vi.mock("../../src/lib/composer", () => ({ runComposer: vi.fn(() => true) }));
vi.mock("../../src/lib/liveSocket", () => ({
  liveSocketUrl: () => "ws://x/api/voice/live",
  openLiveSocket: (opts: {
    sampleRate: number;
    ceilingMs: number;
    onFrame: (f: LiveDown) => void;
    onClose: (code: number, reason: string) => void;
  }) => {
    h.opens.push({ sampleRate: opts.sampleRate, ceilingMs: opts.ceilingMs });
    h.frame = opts.onFrame;
    h.close = () => opts.onClose(1006, "");
    return {
      sendAudio: (buf: ArrayBuffer) => h.audio.push(buf),
      flush: () => h.sent.push("flush"),
      stop: () => h.sent.push("stop"),
      close: () => h.sent.push("close"),
      unknown: () => 0,
    };
  },
}));
vi.mock("../../src/lib/pcmCapture", () => ({
  attachPcmUplink: async (
    _ctx: unknown,
    _stream: unknown,
    opts: { onFrame: (f: { buf: ArrayBuffer; rms: number }) => void },
  ) => {
    await h.attachGate;
    h.onFrame = opts.onFrame;
    return {
      stop: () => {
        h.uplinkStops += 1;
        h.onFrame = null;
      },
    };
  },
}));

import { useDictation } from "../../src/hooks/useDictation";
import { FakeMediaRecorder, mockStt, setMediaDevices } from "./dictationFakes";
import { runComposer } from "../../src/lib/composer";
import { clearDraft, getDraft, setDraft } from "../../src/store/composer";
import { pushToast } from "../../src/store/toast";

// ── the Web Audio stand-in (the mic suite's, trimmed to what the streaming branch needs) ───────────

let micLevel = 0;
let contexts: FakeAudioContext[] = [];

class FakeAnalyser {
  fftSize = 32;
  disconnect = vi.fn();
  getFloatTimeDomainData(buf: Float32Array) {
    buf.fill(micLevel);
  }
}

class FakeAudioContext {
  /** Emulates a context the browser refuses to run — the degrade path the leg shares with the meter. */
  static stuckSuspended = false;
  state: string;
  sampleRate = 48000;
  analyser = new FakeAnalyser();
  source = { connect: vi.fn(), disconnect: vi.fn() };
  resume = vi.fn(async () => {
    if (!FakeAudioContext.stuckSuspended && this.state !== "closed") this.state = "running";
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

/** `/voice/status.live_call`, in wire spelling — EVERY number the branch uses arrives from here. */
const KNOBS = {
  frame_ms: 40,
  buffered_ceiling_ms: 1000, //     = 25 frames of backlog before the ceiling abort
  min_speech_ms: 300,
  barge_threshold: 0,
  barge_in: true,
  ring: true,
  echo_workaround: "auto",
  max_session_s: 1800,
  dictation: true,
  tail_wait_ms: 2000,
  dictation_idle_s: 15, //          = 150 readings of the 100 ms poll
  dictation_max_s: 120, //          = 1200 readings
};

const AUTO_STOP = { enabled: false, silence_s: 3, threshold: 0.01 };

function opts(over: Record<string, unknown> = {}) {
  return {
    sttReady: true,
    statusStamp: 1,
    autoSend: false,
    autoStop: AUTO_STOP,
    liveEar: true,
    liveCall: KNOBS,
    ...over,
  } as Parameters<typeof useDictation>[0];
}

type Mic = { current: ReturnType<typeof useDictation> };

/** Start a HELD recording (the gesture's verb) and let the leg's async install settle. */
async function hold(result: Mic): Promise<void> {
  await act(async () => {
    await result.current.start();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(result.current.status).toBe("recording");
}

/** …and the same, hands-free: the keyboard path, which R69 §8.1 makes locked from its first keystroke. */
async function tapStart(result: Mic): Promise<void> {
  await act(async () => {
    result.current.toggle();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(result.current.status).toBe("recording");
}

/** The relay answers the handshake. */
function ready(): void {
  act(() => h.frame?.({ type: "state", state: "ready" }));
}

/** One phrase, endpointed. */
function phrase(text: string): void {
  act(() => {
    h.frame?.({ type: "speech_stopped" });
    h.frame?.({ type: "transcript", text, final: true });
  });
}

/** One `frame_ms` worth of microphone audio. The BYTE VALUE identifies the frame, so a case can pin
 *  the drain's ORDER rather than merely its count. */
function mic(n: number): void {
  const buf = new ArrayBuffer(8);
  new Uint8Array(buf)[0] = n;
  act(() => h.onFrame?.({ buf, rms: micLevel }));
}

const shipped = (): number[] => h.audio.map((b) => new Uint8Array(b)[0]);

/** Release, and let the whole choreography (flush → tail wait → stop → the either/or) complete.
 *
 *  HELD PAST THE 1000 ms FLOOR first: every case in this file is about a REAL recording, and the floor
 *  is the mic's own pre-flight (its arms live in `useDictation.test.ts`). Under fake timers the clock
 *  moves with the timers, so advancing IS holding — and it has to be a real advance rather than
 *  `recordOnce`'s `Date.now` swap, because the streaming path reaches `upload()` long after the
 *  release, when a swapped clock would already be back. */
async function release(result: Mic): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(1200);
  });
  act(() => result.current.stop());
  await act(async () => {
    vi.advanceTimersByTime(KNOBS.tail_wait_ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Advance the 100 ms detector poll and let anything it kicked off settle. */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  FakeMediaRecorder.deferStop = false;
  FakeMediaRecorder.last = null;
  FakeAudioContext.stuckSuspended = false;
  setMediaDevices(true);
  clearDraft();
  mockStt(200, { text: "the whole clip" });
  micLevel = 0.5; // speaking, unless a case says otherwise
  contexts = [];
  h.sent = [];
  h.audio = [];
  h.opens = [];
  h.frame = null;
  h.close = null;
  h.onFrame = null;
  h.uplinkStops = 0;
  h.attachGate = Promise.resolve();
  vi.mocked(pushToast).mockClear();
  vi.mocked(runComposer).mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ── the degrade NOTICE (rule ⑧) ───────────────────────────────────────────────────────────────────
//
// ⚠ THIS DESCRIBE MUST RUN FIRST, and the reason is the thing it pins: the notice is latched at MODULE
// level — once per page load, exactly like the plain-HTTP nudge it copies — and a test file is one
// page load. So this owns the assertion, and every other degrade case below asserts BEHAVIOUR (the
// clip still carries the recording) rather than re-asserting a toast that has already been spent.

/** How many times the degrade NOTICE went out — counted rather than `toHaveBeenCalledTimes`, because
 *  the mic's own plain-HTTP nudge rides the same toast rail (and the same once-per-page-load latch). */
const saidUnavailable = (): number =>
  vi.mocked(pushToast).mock.calls.filter((c) => String(c[0]).includes("Live dictation unavailable"))
    .length;

describe("useDictation · streaming ⑧ a leg that never opens says so ONCE per page load", () => {
  it("says it, and then never again", async () => {
    const first = renderHook(() => useDictation(opts()));
    await hold(first.result);
    await act(async () => {
      h.close?.(); // refused at the handshake (the route's 403, or a busy relay's 1013)
    });
    expect(pushToast).toHaveBeenCalledWith(
      expect.stringContaining("Live dictation unavailable"),
      "info",
    );
    expect(saidUnavailable()).toBe(1);
    await release(first.result);
    first.unmount();

    vi.mocked(pushToast).mockClear();
    const second = renderHook(() => useDictation(opts()));
    await hold(second.result);
    await act(async () => {
      h.close?.();
    });
    // A misconfigured ear degrades every recording forever; saying so every time would be the noise
    // the latch exists to prevent.
    expect(saidUnavailable()).toBe(0);
    await release(second.result);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2); // …and BOTH recordings landed as clips
  });
});

// ── arming ────────────────────────────────────────────────────────────────────────────────────────

describe("useDictation · streaming arms only when BOTH toggles say so", () => {
  it("arms per recording when the ear is up and `dictation` is on, on the DETECTOR's own context", async () => {
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result);
    expect(h.opens).toEqual([{ sampleRate: 48000, ceilingMs: 1000 }]);
    // never a second getUserMedia and never a second context: ONE of each, shared with the recorder
    // and the meter (R70 §8's third consumer).
    expect(contexts).toHaveLength(1);
    expect(h.onFrame).toBeTypeOf("function");
  });

  it("…and NOT with `dictation` off — the whole-feature toggle, and the mic is the shipped one", async () => {
    const { result } = renderHook(() =>
      useDictation(opts({ liveCall: { ...KNOBS, dictation: false } })),
    );
    await hold(result);
    expect(h.opens).toEqual([]);
    await release(result);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // the clip, exactly as before S2.5
    expect(getDraft()).toBe("the whole clip");
  });

  it("…nor with the EAR down, whatever the toggle says", async () => {
    const { result } = renderHook(() => useDictation(opts({ liveEar: false })));
    await hold(result);
    expect(h.opens).toEqual([]);
  });

  it("…nor with no `live_call` at all (a pre-S1 backend / a stub)", async () => {
    const { result } = renderHook(() => useDictation(opts({ liveCall: undefined })));
    await hold(result);
    expect(h.opens).toEqual([]);
  });
});

// ── rule ① · the pre-`ready` backlog ───────────────────────────────────────────────────────────────

describe("useDictation · streaming ① frames buffer until `ready`, then drain IN ORDER, paced", () => {
  it("ships nothing before `ready` — the handshake must not eat the first words", async () => {
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result);
    mic(1);
    mic(2);
    expect(shipped()).toEqual([]); // buffered, not dropped and not sent early
    ready();
    mic(3);
    // The BACKLOG goes first: audio order is the contract, so the live frame queues behind it.
    expect(shipped()).toEqual([1]);
    mic(4);
    // …and the catch-up frame rides every second live frame (1.5× realtime, under the relay's 2×).
    expect(shipped()).toEqual([1, 2, 3]);
    mic(5);
    expect(shipped()).toEqual([1, 2, 3, 4]);
    mic(6);
    expect(shipped()).toEqual([1, 2, 3, 4, 5, 6]); // drained; from here it is one for one
    mic(7);
    expect(shipped()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("a backlog past `buffered_ceiling_ms` is a handshake that is not coming: clip-only, one notice", async () => {
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result);
    // 25 frames = exactly the ceiling at 40 ms; the 26th crosses it.
    for (let i = 0; i < 26; i++) mic(i);
    expect(h.sent).toEqual(["close"]);
    expect(shipped()).toEqual([]);
    // (the notice itself is ⑧'s, above — it is latched per page load and a file is one page load)
    // …and the recording underneath never noticed: the clip is the whole answer (R70 §8).
    expect(result.current.status).toBe("recording");
    await release(result);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(getDraft()).toBe("the whole clip");
  });
});

// ── rules ② + ③ · the release, and which transcript wins ──────────────────────────────────────────

describe("useDictation · streaming ② the release is flush → tail → stop, and NEVER a commit", () => {
  it("flushes, WAITS for the tail final, and only then stops + closes", async () => {
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result);
    ready();
    phrase("first phrase");

    act(() => result.current.stop());
    await act(async () => {
      await Promise.resolve();
    });
    // The flush is out and NOTHING else is: `stop` discards unendpointed audio, so it may not go
    // until the tail has had its chance.
    expect(h.sent).toEqual(["flush"]);
    expect(result.current.status).toBe("sending"); // the existing phase carries the wait

    phrase("and the tail");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.sent).toEqual(["flush", "stop", "close"]);
    expect(getDraft()).toBe("first phrase and the tail");
    expect(result.current.status).toBe("idle");
  });

  it("…and gives up after `tail_wait_ms` rather than hanging the mic on a dead ear", async () => {
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result);
    ready();
    phrase("all there is");

    act(() => result.current.stop());
    await act(async () => {
      vi.advanceTimersByTime(KNOBS.tail_wait_ms - 100);
      await Promise.resolve();
    });
    expect(h.sent).toEqual(["flush"]); // still waiting, one reading short
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.sent).toEqual(["flush", "stop", "close"]);
    expect(result.current.status).toBe("idle");
  });

  it("③ ≥1 phrase appended ⇒ the CLIP is discarded — the words are never said twice", async () => {
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result);
    ready();
    phrase("wake corsair");
    await release(result);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(getDraft()).toBe("wake corsair");
  });

  it("③ 0 phrases ⇒ the clip uploads exactly as it always has", async () => {
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result);
    ready();
    await release(result);
    expect(h.sent).toEqual(["flush", "stop", "close"]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(getDraft()).toBe("the whole clip");
  });

  it("an EMPTY final ends the wait but does not count — the clip still carries the words", async () => {
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result);
    ready();
    await tick(1200); // past the clip floor: this case ends on the CLIP, so it must be a real one
    act(() => result.current.stop());
    await act(async () => {
      await Promise.resolve();
    });
    phrase("   "); // the ear answered, with nothing
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.sent).toEqual(["flush", "stop", "close"]); // resolved without the timeout
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // …and it did NOT count as a phrase
  });
});

// ── rule ④ · auto-send ────────────────────────────────────────────────────────────────────────────

describe("useDictation · streaming ④ auto-send fires ONCE, at the end of the session", () => {
  it("not per phrase — three phrases are one thought and one turn", async () => {
    const { result } = renderHook(() => useDictation(opts({ autoSend: true })));
    await hold(result);
    ready();
    phrase("wake corsair");
    phrase("and check its uptime");
    expect(runComposer).not.toHaveBeenCalled(); // …not once yet
    await release(result);
    expect(runComposer).toHaveBeenCalledTimes(1);
    expect(runComposer).toHaveBeenCalledWith("wake corsair and check its uptime");
    expect(getDraft()).toBe("");
  });

  it("…and the whole-clip path still sends exactly once through the same helper", async () => {
    const { result } = renderHook(() =>
      useDictation(opts({ autoSend: true, liveCall: { ...KNOBS, dictation: false } })),
    );
    await hold(result);
    await release(result);
    expect(runComposer).toHaveBeenCalledTimes(1);
    expect(runComposer).toHaveBeenCalledWith("the whole clip");
  });

  it("a HELD send (D68 MED-2) keeps the phrases in the composer", async () => {
    vi.mocked(runComposer).mockReturnValue(false); // an upload is still in flight
    const { result } = renderHook(() => useDictation(opts({ autoSend: true })));
    await hold(result);
    ready();
    phrase("carry this");
    await release(result);
    expect(getDraft()).toBe("carry this"); // not cleared — the next send carries both
  });
});

// ── rule ⑥ · cancel ───────────────────────────────────────────────────────────────────────────────

describe("useDictation · streaming ⑥ cancel drops the leg NOW, and never retracts the draft", () => {
  it("closes without a flush, uploads nothing, and leaves what already landed", async () => {
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result);
    ready();
    phrase("keep me");
    await act(async () => {
      result.current.cancel();
    });
    expect(h.sent).toEqual(["close"]); // no flush: the utterance in flight is dropped on purpose
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(getDraft()).toBe("keep me"); // rule ⑤ — never retracted
    expect(result.current.status).toBe("idle");
  });
});

// ── rule ⑦ · the leg dies mid-session ─────────────────────────────────────────────────────────────

describe("useDictation · streaming ⑦ a death past `ready` is decided by what is already in the draft", () => {
  it("0 phrases ⇒ SILENT: the recording runs on and the clip carries every word", async () => {
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result);
    ready();
    await act(async () => {
      h.close?.();
    });
    expect(result.current.status).toBe("recording"); // it never noticed
    expect(pushToast).not.toHaveBeenCalled(); // …and neither did the owner
    await release(result);
    expect(h.sent).toEqual(["close"]); // no flush on a dead leg
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(getDraft()).toBe("the whole clip");
  });

  it("≥1 phrase ⇒ the recording ENDS here, the clip is discarded, and the loss is named", async () => {
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result);
    ready();
    phrase("half of it");
    await act(async () => {
      h.close?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("idle");
    expect(h.sent).toEqual(["close"]); // dead: nothing to flush
    expect(globalThis.fetch).not.toHaveBeenCalled(); // uploading would say "half of it" twice
    expect(getDraft()).toBe("half of it");
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Voice connection lost"), "err");
  });

  it("a close BEFORE `ready` is a misconfiguration, not a failure: one notice, clip-only", async () => {
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result);
    await act(async () => {
      h.close?.(); // e.g. the route's 403, or a busy relay's 1013
    });
    expect(result.current.status).toBe("recording");
    // SILENT for the recording — the loud copy is reserved for a leg that died with words already in
    // the draft (the case above); the notice itself is ⑧'s, once per page load.
    expect(pushToast).not.toHaveBeenCalledWith(
      expect.stringContaining("Voice connection lost"),
      "err",
    );
    await release(result);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

// ── rule ⑨ · the interplay with the mic's own rules ───────────────────────────────────────────────

describe("useDictation · streaming ⑨ the three §9.3 rules", () => {
  const withAutoStop = (over: Record<string, unknown> = {}) =>
    opts({ autoStop: { enabled: true, silence_s: 3, threshold: 0.01 }, ...over });

  it("(a) Tier 0's STOP is SUSPENDED while a leg is live — a pause is the point", async () => {
    const { result } = renderHook(() => useDictation(withAutoStop()));
    await hold(result);
    ready();
    micLevel = 0; // dead silence, far past the configured 3 s window
    await tick(10_000);
    expect(result.current.status).toBe("recording");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("…and the moment the leg dies the policy resumes, with a FRESH run", async () => {
    const { result } = renderHook(() => useDictation(withAutoStop()));
    await hold(result);
    ready();
    micLevel = 0;
    await tick(10_000); // a long silence the suspension swallowed
    await act(async () => {
      h.close?.(); // 0 phrases ⇒ the silent degrade; Tier 0 is the mic's rule again
    });
    await tick(2900); // one reading short of a WHOLE fresh window
    expect(result.current.status).toBe("recording");
    await tick(100);
    expect(result.current.status).toBe("idle"); // …the ordinary stop path, and the clip lands
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("(b) the hidden-page stop is armed even with the auto-stop POLICY OFF, while streaming", async () => {
    // Pre-S2.5 (feel-round F1) the listener existed only under the policy. A live WebSocket plus an
    // open mic behind a locked phone is strictly worse than the recorder that rule was written for.
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result);
    ready();
    phrase("said before the lock");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    // It ran the ORDINARY release — the leg is flushed and closed, not abandoned.
    expect(h.sent[0]).toBe("flush");
    await act(async () => {
      vi.advanceTimersByTime(KNOBS.tail_wait_ms);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("idle");
    expect(getDraft()).toBe("said before the lock");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("…and with streaming OFF a hidden page still does NOT stop a policy-off recording (F1 holds)", async () => {
    const { result } = renderHook(() =>
      useDictation(opts({ liveCall: { ...KNOBS, dictation: false } })),
    );
    await hold(result);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.status).toBe("recording");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("(c) a HELD recording never idles out — the finger is the timeout", async () => {
    const { result } = renderHook(() => useDictation(withAutoStop()));
    await hold(result); // hand on the button: `handsFree` stays false
    ready();
    micLevel = 0;
    await tick(60_000); // four times the configured idle window
    expect(result.current.status).toBe("recording");
  });

  it("…and a HANDS-FREE one does, through the ordinary release (the trailing phrase is kept)", async () => {
    const { result } = renderHook(() => useDictation(withAutoStop()));
    await tapStart(result); // the keyboard path IS hands-free (R69 §8.1)
    ready();
    phrase("left running");
    micLevel = 0;
    await tick(14_900); // one reading short of `dictation_idle_s`
    expect(result.current.status).toBe("recording");
    await tick(100);
    expect(h.sent[0]).toBe("flush"); // the ORDINARY release, not a drop
    await act(async () => {
      vi.advanceTimersByTime(KNOBS.tail_wait_ms);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("idle");
    expect(getDraft()).toBe("left running");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("…and speech RESETS the idle run: it is continuous silence, not elapsed time", async () => {
    const { result } = renderHook(() => useDictation(withAutoStop()));
    await tapStart(result);
    ready();
    micLevel = 0;
    await tick(14_000);
    micLevel = 0.5; // a word
    await tick(200);
    micLevel = 0;
    await tick(14_000); // 28 s elapsed, under 15 s of unbroken silence
    expect(result.current.status).toBe("recording");
  });

  it("(c) `dictation_max_s` caps EVERY session — the held one included", async () => {
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result); // hand down: only the hard cap can end this
    ready();
    phrase("a long one");
    micLevel = 0.5; // still talking the whole time
    await tick(119_900);
    expect(result.current.status).toBe("recording");
    await tick(100);
    expect(h.sent[0]).toBe("flush"); // …through the ordinary release, so the tail is kept
  });
});

// ── rule ⑩ · every exit ───────────────────────────────────────────────────────────────────────────

describe("useDictation · streaming ⑩ every exit tears the leg down", () => {
  it("an unmount mid-recording runs the release, and the choreography completes without a tree", async () => {
    const { result, unmount } = renderHook(() => useDictation(opts()));
    await hold(result);
    ready();
    phrase("typed while leaving");
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(KNOBS.tail_wait_ms);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.sent).toEqual(["flush", "stop", "close"]);
    expect(getDraft()).toBe("typed while leaving"); // a store write needs no component
  });

  it("…and an install landing after the recording is over releases the graph nobody owns", async () => {
    // The worklet finishes installing into a leg that has already been dropped — the same shape as the
    // arming latch's ownerless stream, one layer up.
    let install!: () => void;
    h.attachGate = new Promise<void>((done) => {
      install = done;
    });
    const { result } = renderHook(() => useDictation(opts()));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      result.current.cancel(); // the leg is dropped while the worklet is still installing
    });
    await act(async () => {
      install();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.sent).toEqual(["close"]);
    expect(h.uplinkStops).toBe(1);
  });

  it("the PARKED clip survives a next recording arming inside the tail wait (F2, widened)", async () => {
    // S2.5 stretched F2's ownership window: `onstop` releases the recorder, and the either/or decision
    // then waits on the flush for up to `tail_wait_ms`. A clip read back off the refs at THAT point
    // would be the next recording's (empty, and cleared out from under it). The clip travels by value
    // from the one terminal that owns it, so this upload is still THIS recording's.
    //
    // The window is not reachable through the UI — every variant disables the mic button while the
    // status is `sending` — which is exactly why it wants an arm rather than a shrug.
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result);
    ready();
    await tick(1200); // a real recording, past the clip floor
    act(() => result.current.stop());
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.sent).toEqual(["flush"]); // the wait is open
    await act(async () => {
      await result.current.start(); // …and a NEXT recording arms inside it
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(KNOBS.tail_wait_ms);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // the parked clip, not an empty one
    expect(getDraft()).toBe("the whole clip");
  });

  it("a recorder ERROR drops the leg unflushed, and keeps what already landed", async () => {
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result);
    ready();
    phrase("survivor");
    await act(async () => {
      FakeMediaRecorder.last?.onerror?.();
      FakeMediaRecorder.last?.stop();
      await Promise.resolve();
    });
    expect(h.sent).toEqual(["close"]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(getDraft()).toBe("survivor");
  });

  it("a context that will not run degrades to the clip, with the one notice", async () => {
    FakeAudioContext.stuckSuspended = true;
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result);
    expect(h.opens).toEqual([]); // no context to hang an uplink off ⇒ no leg was ever opened
    await release(result);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

// ── the join ──────────────────────────────────────────────────────────────────────────────────────

describe("useDictation · streaming appends through the EXISTING draft seam", () => {
  it("lands after whatever was already typed, one space between phrases (R70 §3)", async () => {
    setDraft("already typed");
    const { result } = renderHook(() => useDictation(opts()));
    await hold(result);
    ready();
    phrase("Okay, so I need you to wake up.");
    phrase("Course air and then check its uptime.");
    expect(getDraft()).toBe(
      "already typed Okay, so I need you to wake up. Course air and then check its uptime.",
    );
  });
});
