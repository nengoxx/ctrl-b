import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAudioCache,
  dismiss,
  seekFraction,
  toggle,
  togglePlay,
  usePlayback,
} from "../../src/lib/audioController";

// lib/audioController — the shared TTS playback singleton. We replace the DOM <audio> with a
// controllable fake (so we can drive media events) and mock `fetch` to return a blob, then assert the
// reactive playback snapshot. Locks in the play/switch/seek/dismiss logic + the race fixes.

let lastAudio: FakeAudio;
class FakeAudio {
  preload = "";
  src = "";
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  private listeners: Record<string, (() => void)[]> = {};
  constructor() {
    lastAudio = this;
  }
  addEventListener(type: string, cb: () => void) {
    (this.listeners[type] ||= []).push(cb);
  }
  removeAttribute() {
    this.src = "";
  }
  load() {}
  async play() {
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
  vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);
  global.fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob(["a"]) }) as unknown as Response);
  clearAudioCache(); // reset the singleton's state + blob cache between cases
});

describe("audioController", () => {
  it("toggle synthesizes once and plays the message", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    await act(async () => {
      await toggle("m1", "hello");
    });
    expect(result.current.id).toBe("m1");
    expect(result.current.status).toBe("playing");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("toggling the same message pauses then resumes — no re-synth (cache hit)", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    await act(async () => {
      await toggle("m1", "hello");
    });
    await act(async () => {
      await toggle("m1", "hello"); // playing → pause
    });
    expect(result.current.status).toBe("paused");
    await act(async () => {
      await toggle("m1", "hello"); // paused → resume
    });
    expect(result.current.status).toBe("playing");
    expect(global.fetch).toHaveBeenCalledTimes(1); // synthesized once, replayed from cache
  });

  it("switching to a different message re-synths and swaps the active id", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    await act(async () => {
      await toggle("m1", "one");
    });
    await act(async () => {
      await toggle("m2", "two");
    });
    expect(result.current.id).toBe("m2");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("togglePlay pauses/resumes the active clip", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    await act(async () => {
      await toggle("m1", "hello");
    });
    act(() => togglePlay());
    expect(result.current.status).toBe("paused");
    act(() => togglePlay());
    expect(result.current.status).toBe("playing");
  });

  it("seekFraction maps to currentTime once duration is known", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    await act(async () => {
      await toggle("m1", "hello");
    });
    act(() => {
      lastAudio.duration = 10;
      lastAudio.emit("durationchange");
    });
    expect(result.current.duration).toBe(10);
    act(() => seekFraction(0.5));
    expect(lastAudio.currentTime).toBe(5);
    expect(result.current.current).toBe(5);
  });

  it("ended resets to the start, paused (ready to replay)", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    await act(async () => {
      await toggle("m1", "hello");
    });
    act(() => {
      lastAudio.currentTime = 9;
      lastAudio.emit("ended");
    });
    expect(result.current.status).toBe("paused");
    expect(result.current.current).toBe(0);
  });

  it("dismiss clears the player back to idle", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    await act(async () => {
      await toggle("m1", "hello");
    });
    act(() => dismiss());
    expect(result.current.id).toBeNull();
    expect(result.current.status).toBe("idle");
  });
});
