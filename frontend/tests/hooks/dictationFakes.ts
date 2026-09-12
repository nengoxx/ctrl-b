import { act, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

// The MediaRecorder/getUserMedia fakes `useDictation` is driven with — shared by the mic's own suite
// (`useDictation.test.ts`) and by the D68 §7 pin that the auto-send path carries staged attachments
// (`attachmentDictation.test.ts`). Extracted rather than copied: the two files must be driving the
// same recorder lifecycle, or "the auto-send path" in one of them is a different path.
//
// NOT a `.test.ts` file, so vitest's `include` never collects it as a suite.

export class FakeMediaRecorder {
  static isTypeSupported() {
    return true;
  }
  /** The instance the hook is currently driving — the handle a suite needs to fire `onerror` (a
   *  recorder failure is not reachable through the public toggle). */
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

export function setMediaDevices(present: boolean) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: present
      ? { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) }
      : undefined,
  });
}

/** Answer `POST /api/voice/stt` with `body` under `status`. */
export function mockStt(status: number, body: unknown) {
  globalThis.fetch = vi.fn(
    async () =>
      ({
        status,
        ok: status >= 200 && status < 300,
        json: async () => body,
      }) as unknown as Response,
  );
}

/** Tap to start, wait until recording, tap to stop (which kicks off the async upload).
 *
 *  HELD PAST THE 1000 ms FLOOR by default (S0.5): `useDictation` now discards a clip shorter than
 *  `MIN_CLIP_MS` before any POST, and every case in these two files is about what happens to a real
 *  recording. The clock is NUDGED rather than waited on — the fake recorder's `stop()` is synchronous
 *  and `upload()` reads `Date.now()` in its synchronous prefix, so restoring it right after the `act`
 *  is safe (and under fake timers the captured `Date.now` is the faked one, which goes back unchanged).
 *  Pass a shorter `heldMs` to drive the floor itself. */
export async function recordOnce(
  result: { current: { toggle: () => void; status: string } },
  heldMs = 1200,
) {
  const realNow = Date.now;
  act(() => result.current.toggle());
  await waitFor(() => expect(result.current.status).toBe("recording"));
  const at = realNow() + heldMs;
  Date.now = () => at;
  try {
    act(() => result.current.toggle());
  } finally {
    Date.now = realNow;
  }
}
