import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  state = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? "audio/webm";
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
  global.fetch = vi.fn(
    async () =>
      ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response,
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

  it("insecure context (no getUserMedia) toasts and stays idle — NOT unavailable", async () => {
    setMediaDevices(false);
    const { result } = renderHook(() => useDictation(opts(false)));
    act(() => result.current.toggle());
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("secure"), "err"),
    );
    expect(result.current.status).toBe("idle");
  });

  it("auto-send is held back when a turn is already streaming (left in the draft, not dropped)", async () => {
    vi.mocked(getChatStatus).mockReturnValue("streaming"); // a turn is in flight
    mockStt(200, { text: "queued line" });
    const { result } = renderHook(() => useDictation(opts(true)));
    await recordOnce(result);
    await waitFor(() => expect(getDraft()).toBe("queued line")); // appended for review
    expect(runComposer).not.toHaveBeenCalled(); // NOT sent into the streaming turn (would be dropped)
  });

  it("an empty transcript prompts a retry rather than appending nothing", async () => {
    mockStt(200, { text: "   " });
    const { result } = renderHook(() => useDictation(opts(false)));
    await recordOnce(result);
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Didn't catch"), "info"));
    expect(getDraft()).toBe("");
  });
});
