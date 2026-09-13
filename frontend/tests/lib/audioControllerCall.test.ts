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
    expect(callVoiceSpeaks("m1")).toBe(false);
  });

  it("speaks every message EXCEPT the one already streaming at call start", async () => {
    const { callVoiceSpeaks, setCallVoice } = await controller();
    setCallVoice(true, "m-already-streaming");
    expect(callVoiceSpeaks("m-already-streaming")).toBe(false);
    expect(callVoiceSpeaks("m-next")).toBe(true);
  });

  it("with no turn in flight at call start, it speaks everything", async () => {
    const { callVoiceSpeaks, setCallVoice } = await controller();
    setCallVoice(true, null);
    expect(callVoiceSpeaks("m1")).toBe(true);
  });

  it("clearing it forgets the since-id too — a redial must not inherit an exclusion", async () => {
    const { callVoiceSpeaks, setCallVoice } = await controller();
    setCallVoice(true, "m1");
    setCallVoice(false, null);
    setCallVoice(true, null);
    expect(callVoiceSpeaks("m1")).toBe(true);
  });

  it("is REACTIVE: arming it re-runs the feeder's gates instead of waiting for the next delta", async () => {
    const { setCallVoice, useCallVoice } = await controller();
    const { result } = renderHook(() => useCallVoice());
    expect(result.current).toBe(false);
    act(() => setCallVoice(true, null));
    expect(result.current).toBe(true);
    act(() => setCallVoice(false, null));
    expect(result.current).toBe(false);
  });
});
