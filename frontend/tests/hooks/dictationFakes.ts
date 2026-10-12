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
  /** Opt-in (F2): model the REAL queued-events window. `stop()` flips `state` to "inactive"
   *  synchronously, exactly as the spec says, but holds the final `dataavailable`/`stop` events until
   *  the test calls `flush()` — which is the window a too-early next recording can be started in. Off
   *  by default, so every existing case keeps the synchronous lifecycle it was written against. */
  static deferStop = false;
  state = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** What the hook constructed it with (Phase 26 SP, T-1 — the bitrate rides BOTH ctor branches). */
  options: MediaRecorderOptions | undefined;
  private pendingStop = false;
  constructor(_stream: unknown, opts?: MediaRecorderOptions) {
    this.mimeType = opts?.mimeType ?? "audio/webm";
    this.options = opts;
    FakeMediaRecorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    if (FakeMediaRecorder.deferStop) {
      this.pendingStop = true;
      return;
    }
    this.fire();
  }
  /** Deliver the terminal events `stop()` deferred. */
  flush() {
    if (!this.pendingStop) return;
    this.pendingStop = false;
    this.fire();
  }
  private fire() {
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

/** A `getUserMedia` the TEST opens by hand: every call parks until `open()` is called, so a suite can
 *  hold one attempt inside the acquisition window while another gesture runs (F1). Returns the opener
 *  plus the `stop` spy every handed-over track shares. */
export function gateMediaDevices(): { open: () => void; trackStop: ReturnType<typeof vi.fn> } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
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
  return { open: () => release(), trackStop };
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

/** An STT door that holds its answer until the test gives it (ISS-83): the window a clip spends
 *  `sending` — its POST in flight with the recorder already released — made something a case can sit
 *  in. `answer()` lands the transcript. */
export function pendingStt(body: unknown = { text: "hello world" }) {
  let answer: (() => void) | undefined;
  globalThis.fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        answer = () =>
          resolve({ status: 200, ok: true, json: async () => body } as unknown as Response);
      }),
  );
  return { answer: () => answer?.() };
}

/** One scripted answer of the clip door (ISS-84): an HTTP answer — whose body may be a parsed `body`,
 *  or `json: "syntax"` (a COMPLETE body that is not JSON), `"transport"` (the body dies in transit) or
 *  `"hang"` (the body never arrives) — or the whole request `"hang"`ing / `"reject"`ing like a dead
 *  network. */
export type SttStep =
  "hang" | "reject" | { status: number; body?: unknown; json?: "syntax" | "transport" | "hang" };

/** Answer `POST /api/voice/stt` attempt by attempt from `steps` (then the ordinary transcript), and
 *  record each attempt's `RequestInit`. The fake HONOURS the abort signal on the request AND on the
 *  body read, exactly as a real `fetch` does — the loop's deadline is only a deadline if the request
 *  dies with it. */
export function scriptStt(...steps: SttStep[]): { calls: RequestInit[] } {
  const calls: RequestInit[] = [];
  const aborted = (signal: AbortSignal | null | undefined): Promise<never> =>
    new Promise((_, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  globalThis.fetch = vi.fn((_path: unknown, init?: RequestInit) => {
    const req = init ?? {};
    calls.push(req);
    const step = steps.shift() ?? { status: 200, body: { text: "hello world" } };
    if (step === "hang") return aborted(req.signal);
    if (step === "reject") return Promise.reject(new TypeError("Failed to fetch"));
    const json = (): Promise<unknown> => {
      if (step.json === "hang") return aborted(req.signal);
      if (step.json === "syntax") return Promise.reject(new SyntaxError("Unexpected token <"));
      if (step.json === "transport") return Promise.reject(new TypeError("network error"));
      return Promise.resolve(step.body ?? {});
    };
    return Promise.resolve({
      status: step.status,
      ok: step.status >= 200 && step.status < 300,
      json,
    } as unknown as Response);
  });
  return { calls };
}

/** Tap to start, wait until recording, tap to stop (which kicks off the async upload).
 *
 *  HELD PAST THE 1000 ms FLOOR by default (S0.5): `useDictation` now discards a clip shorter than
 *  `MIN_CLIP_MS` before any POST, and every case in these two files is about what happens to a real
 *  recording. The clock is NUDGED rather than waited on — the fake recorder's `stop()` fires `onstop`
 *  synchronously, and `onstop` is where the duration is STAMPED onto the clip (A-F1), so restoring the
 *  clock right after the `act` is safe (and under fake timers the captured `Date.now` is the faked one,
 *  which goes back unchanged). Pass a shorter `heldMs` to drive the floor itself. */
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
