import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A FRESH module per case, deliberately: `primeAudio` is once-per-page and `el` is a page-lifetime
// singleton, so a second case in the same module instance would be asserting against an element that is
// already unlocked. `vi.resetModules()` + a dynamic import is what gives each arm a real first prime.
async function controller() {
  vi.resetModules();
  return await import("../../src/lib/audioController");
}

// lib/audioController — THE CALL's three touches on the playback singleton (D71 §6 / §4.5): the gesture
// PRIME, the client-local read-along OVERRIDE, and the kill it already had. A file of its own because
// `primeAudio` is once-per-page by design: the arms below have to run against a module that has never
// been primed, and `tests/lib/audioController.test.ts` plays audio in its very first case.

/** The <audio> stand-in. Only what the prime path touches — plus the event plumbing, because the whole
 *  point of the `priming` latch is that these events must NOT publish while it is up. */
class FakeAudio {
  static made: FakeAudio[] = [];
  preload = "";
  src = "";
  currentSrc = "";
  muted = false;
  paused = true;
  ended = false;
  duration = Number.NaN;
  currentTime = 0;
  plays = 0;
  loads = 0;
  playRejects = false;
  private listeners: Record<string, (() => void)[]> = {};
  constructor() {
    FakeAudio.made.push(this);
  }
  addEventListener(type: string, cb: () => void) {
    (this.listeners[type] ||= []).push(cb);
  }
  removeEventListener() {}
  getAttribute(name: string): string | null {
    return name === "src" && this.src ? this.src : null;
  }
  removeAttribute() {
    this.src = "";
  }
  load() {
    this.loads += 1;
  }
  async play() {
    this.plays += 1;
    if (this.playRejects) throw new DOMException("blocked", "NotAllowedError");
    this.paused = false;
    this.emit("play");
  }
  pause() {
    this.paused = true;
    this.emit("pause");
  }
  emit(type: string) {
    (this.listeners[type] || []).forEach((cb) => cb());
  }
}

beforeEach(() => {
  FakeAudio.made = [];
  vi.stubGlobal("Audio", FakeAudio);
});

describe("primeAudio — the gesture unlock (§6)", () => {
  it("plays a decodable SILENT source and puts the element straight back", async () => {
    const { primeAudio } = await controller();
    primeAudio();
    const el = FakeAudio.made[0];
    expect(el.src).toMatch(/^data:audio\/wav;base64,/); // a src-less `play()` rejects and unlocks nothing
    expect(el.muted).toBe(true);
    expect(el.plays).toBe(1);

    await act(async () => {
      await Promise.resolve();
    });
    expect(el.src).toBe(""); // handed back exactly as it was found
    expect(el.muted).toBe(false);
    expect(el.paused).toBe(true);
    expect(el.loads).toBeGreaterThan(0);
  });

  it("is IDEMPOTENT — a redial costs nothing and never re-touches the element", async () => {
    const { primeAudio } = await controller();
    primeAudio();
    await act(async () => {
      await Promise.resolve();
    });
    const el = FakeAudio.made[0];
    primeAudio();
    primeAudio();
    expect(el.plays).toBe(1);
    expect(FakeAudio.made).toHaveLength(1);
  });

  it("publishes NO phantom transport state — an unlock is not playback", async () => {
    const { primeAudio, usePlayback } = await controller();
    const { result } = renderHook(() => usePlayback((p) => p.status));
    expect(result.current).toBe("idle");
    await act(async () => {
      primeAudio();
      await Promise.resolve();
    });
    expect(result.current).toBe("idle");
  });
});

describe("primeAudio — the call's chunk-start signal ignores it (D76 §B.3)", () => {
  it("the silent unlock's `playing` is no chunk — the probe's clock never hears it", async () => {
    const { primeAudio, setCallChunkStart } = await controller();
    const seen: number[] = [];
    setCallChunkStart((idx) => seen.push(idx));
    primeAudio();
    FakeAudio.made[0].emit("playing"); // still priming: the unlock's promise has not settled
    expect(seen).toEqual([]);
    setCallChunkStart(null);
  });
});

describe("primeAudio — when it must do nothing", () => {
  it("a rejected unlock leaves exactly today's behaviour, and never throws into the gesture", async () => {
    vi.stubGlobal(
      "Audio",
      class extends FakeAudio {
        constructor() {
          super();
          this.playRejects = true;
        }
      },
    );
    const { primeAudio } = await controller();
    expect(() => primeAudio()).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });
    const el = FakeAudio.made[0];
    expect(el.src).toBe("");
    expect(el.muted).toBe(false);
  });
});

describe("setCallVoice — the call's read-along override (§4.5)", () => {
  it("is off until a call arms it", async () => {
    const { callVoiceSpeaks } = await controller();
    expect(callVoiceSpeaks()).toBe(false);
  });

  it("with NO turn in flight at call start, the gate is open immediately", async () => {
    const { callVoiceSpeaks, setCallVoice } = await controller();
    setCallVoice(true, false);
    expect(callVoiceSpeaks()).toBe(true);
  });

  it("a turn already streaming HOLDS it shut until that turn settles", async () => {
    const { callVoiceSpeaks, openCallVoiceGate, setCallVoice } = await controller();
    setCallVoice(true, true);
    expect(callVoiceSpeaks()).toBe(false); // the pre-call reply is not picked up mid-sentence
    openCallVoiceGate();
    expect(callVoiceSpeaks()).toBe(true); // …and everything from here is the call's own
  });

  it("opening the gate is inert with no call up — a later call still waits for its own settle", async () => {
    const { callVoiceSpeaks, openCallVoiceGate, setCallVoice } = await controller();
    openCallVoiceGate();
    setCallVoice(true, true);
    expect(callVoiceSpeaks()).toBe(false);
  });

  it("clearing it forgets the gate too — a redial must not inherit an open one", async () => {
    const { callVoiceSpeaks, openCallVoiceGate, setCallVoice } = await controller();
    setCallVoice(true, true);
    openCallVoiceGate();
    setCallVoice(false, false);
    setCallVoice(true, true);
    expect(callVoiceSpeaks()).toBe(false);
  });

  it("is REACTIVE: arming it — and OPENING it — re-runs the feeder's gates", async () => {
    const { openCallVoiceGate, setCallVoice, useCallVoice } = await controller();
    const { result } = renderHook(() => useCallVoice());
    expect(result.current).toBe(false);
    act(() => setCallVoice(true, true));
    expect(result.current).toBe(false); // armed, but still gated
    act(() => openCallVoiceGate());
    expect(result.current).toBe(true);
    act(() => setCallVoice(false, false));
    expect(result.current).toBe(false);
  });
});
