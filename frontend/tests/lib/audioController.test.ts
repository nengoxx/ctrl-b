import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ toast: vi.fn<(text: string, kind?: string) => void>() }));
vi.mock("../../src/store/toast", () => ({ pushToast: h.toast }));

import {
  clearAudioCache,
  dismiss,
  seekFraction,
  setChunkPolicy,
  toggle,
  togglePlay,
  usePlayback,
  type ChunkPolicy,
} from "../../src/lib/audioController";

// lib/audioController — the shared TTS playback singleton. We replace the DOM <audio> with a
// controllable fake (so we can drive media events) and mock `fetch`, then assert the reactive playback
// snapshot. Two halves, matching the controller's two paths:
//   • `chunking: off` — the pre-D63 whole-blob path: play/switch/seek/dismiss + the reqSeq race fixes.
//   • `chunking: sentence` — the D63 queue: advance-on-`ended`, the waiting latch, error-skip, cancel,
//     the stale-completion revoke, single-message retention, the failover pin and its serve flash.

let lastAudio: FakeAudio;
class FakeAudio {
  preload = "";
  src = "";
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  ended = false;
  private listeners: Record<string, (() => void)[]> = {};
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- test mock captures its own instance for assertions
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
    this.ended = false;
    this.emit("play");
  }
  pause() {
    this.paused = true;
    this.emit("pause");
  }
  /** Reach the end of the current clip — the spec's order is `pause` THEN `ended`. */
  finish() {
    this.ended = true;
    this.paused = true;
    this.emit("pause");
    this.emit("ended");
  }
  emit(type: string) {
    (this.listeners[type] || []).forEach((cb) => cb());
  }
}

const OFF: ChunkPolicy = {
  mode: "off",
  minWords: 4,
  minChars: 50,
  maxChars: 400,
  maxTextChars: 4096,
  lookahead: 1,
  format: "opus",
};
/** Floors off so one sentence = one chunk; that keeps the queue cases about the QUEUE. */
const chunked = (over: Partial<ChunkPolicy> = {}): ChunkPolicy => ({
  ...OFF,
  mode: "sentence",
  minWords: 1,
  minChars: 1,
  ...over,
});

/** A successful /voice/tts response carrying the D63 target header. */
function okRes(target = "emma/kokoro"): Response {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob(["a"]),
    headers: { get: (k: string) => (k === "X-Voice-Target" ? target : null) },
  } as unknown as Response;
}
function errRes(status: number): Response {
  return { ok: false, status, headers: { get: () => null } } as unknown as Response;
}

interface Call {
  body: { text: string; format?: string; prefer?: string };
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
}
/** Install a fetch whose every call stays pending until the test resolves it. `abortRejects: false`
 *  models a response that had already settled when the abort landed — the MED-7 race. */
function deferredFetch(opts: { abortRejects?: boolean } = {}): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn((_url: unknown, init: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      calls.push({ body: JSON.parse(String(init.body)) as Call["body"], resolve, reject });
      if (opts.abortRejects !== false) {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }
    });
  }) as unknown as typeof fetch;
  return calls;
}

/** Drain microtasks + timers inside act(), so pending synths land and the queue advances. */
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

let urlSeq = 0;
let revoked: string[] = [];

beforeEach(() => {
  vi.stubGlobal("Audio", FakeAudio);
  urlSeq = 0;
  revoked = [];
  URL.createObjectURL = vi.fn(() => `blob:${++urlSeq}`);
  URL.revokeObjectURL = vi.fn((u: string) => void revoked.push(u));
  globalThis.fetch = vi.fn(async () => okRes());
  clearAudioCache(); // reset the singleton's state + blob cache between cases
  setChunkPolicy(OFF);
});

describe("audioController — whole-message path (chunking: off)", () => {
  it("toggle synthesizes once and plays the message", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    await act(async () => {
      await toggle("m1", "hello");
    });
    expect(result.current.id).toBe("m1");
    expect(result.current.status).toBe("playing");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("sends only `text` — no chunk format, no pin (byte-identical to the pre-D63 request)", async () => {
    await act(async () => {
      await toggle("m1", "hello");
    });
    const init = vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ text: "hello" });
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
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // synthesized once, replayed from cache
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
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
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

  // ── race fixes (this session's hardening) — exercised with a DEFERRED fetch so we can act during
  //    the "loading" window, which the instant-resolve fetch above can't reach. ──

  it("dismiss during load cancels the pending play (reqSeq guard)", async () => {
    const calls = deferredFetch();
    const { result } = renderHook(() => usePlayback((p) => p));

    let pending!: Promise<void>;
    await act(async () => {
      pending = toggle("m1", "hello"); // synth starts, status → loading, awaits the (pending) fetch
    });
    expect(result.current.status).toBe("loading");

    act(() => dismiss()); // bumps reqSeq while the synth is still in flight
    await act(async () => {
      calls[0].resolve(okRes());
      await pending; // the resolved synth must hit the seq !== reqSeq guard and NOT play
    });

    expect(result.current.id).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("switching during load: the superseded clip never clobbers the new one", async () => {
    const calls = deferredFetch();
    const { result } = renderHook(() => usePlayback((p) => p));

    await act(async () => {
      void toggle("m1", "one"); // fetch[0] pending
    });
    let p2!: Promise<void>;
    await act(async () => {
      p2 = toggle("m2", "two"); // pauses m1, bumps reqSeq, fetch[1] pending
    });
    expect(result.current.id).toBe("m2");

    await act(async () => {
      calls[0].resolve(okRes()); // stale m1 resolves
    });
    await act(async () => {
      calls[1].resolve(okRes()); // m2 resolves
      await p2;
    });

    expect(result.current.id).toBe("m2"); // m1's late synth did not win
    expect(result.current.status).toBe("playing");
  });
});

describe("audioController — the chunk queue (D63)", () => {
  const REPLY = "One. Two. Three."; // → 3 chunks with the floors off

  beforeEach(() => setChunkPolicy(chunked()));

  it("plays chunk 1 as soon as it lands and synthesizes exactly `lookahead` ahead", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await flush();
    expect(result.current.status).toBe("playing");
    expect(lastAudio.src).toBe("blob:1");
    // chunk 1 playing + chunk 2 in flight; chunk 3 is NOT requested yet (depth 1).
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("advances on `ended` by swapping src, and rewinds to the top when the queue drains", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await flush();
    expect(lastAudio.src).toBe("blob:1");

    await act(async () => lastAudio.finish());
    await flush();
    expect(lastAudio.src).toBe("blob:2");
    expect(result.current.status).toBe("playing"); // the seam is not reported as a pause

    await act(async () => lastAudio.finish());
    await flush();
    expect(lastAudio.src).toBe("blob:3");
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);

    await act(async () => lastAudio.finish()); // end of the queue
    await flush();
    expect(result.current.status).toBe("paused");
    expect(result.current.current).toBe(0);
    expect(lastAudio.src).toBe("blob:1"); // rewound — a re-tap replays the message from the top
  });

  it("holds the latch when playback catches up, and resumes when the late chunk arrives", async () => {
    const calls = deferredFetch();
    const { result } = renderHook(() => usePlayback((p) => p));
    await act(async () => {
      await toggle("m1", REPLY);
    });
    expect(result.current.status).toBe("loading"); // latched on chunk 1

    await act(async () => calls[0].resolve(okRes()));
    await flush();
    expect(result.current.status).toBe("playing");

    // chunk 2 is still in flight when chunk 1 ends → latch, then resume on arrival.
    await act(async () => lastAudio.finish());
    await flush();
    expect(lastAudio.src).toBe("blob:1"); // still on chunk 1's blob — nothing to swap to yet
    await act(async () => calls[1].resolve(okRes()));
    await flush();
    expect(lastAudio.src).toBe("blob:2");
    expect(result.current.status).toBe("playing");
  });

  it("skips a failed chunk and keeps reading — one toast for the whole message", async () => {
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    await act(async () => calls[1].resolve(errRes(500))); // chunk 2 fails while chunk 1 plays
    await flush();
    await act(async () => lastAudio.finish()); // chunk 1 ends → skip 2, latch on 3
    await flush();
    await act(async () => calls[2].resolve(okRes()));
    await flush();

    expect(lastAudio.src).toBe("blob:2"); // the 2nd BLOB is chunk 3 (chunk 2 never made one)
    const errs = h.toast.mock.calls.filter(([, kind]) => kind === "err");
    expect(errs).toHaveLength(1);
    expect(errs[0][0]).toBe("Read-aloud failed (500)");
  });

  it("cancelling mid-flight aborts the queue: nothing plays, nothing is retained", async () => {
    const calls = deferredFetch();
    const { result } = renderHook(() => usePlayback((p) => p));
    await act(async () => {
      await toggle("m1", REPLY);
    });
    act(() => dismiss()); // reqSeq++ and the AbortController fires
    await flush();
    expect(result.current.id).toBeNull();
    expect(calls).toHaveLength(1); // ≤ lookahead wasted synths, by construction
    expect(lastAudio.src).toBe("");
  });

  it("a synth landing after the queue was superseded revokes its URL instead of retaining it", async () => {
    const calls = deferredFetch({ abortRejects: false }); // the response had already settled
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => {
      await toggle("m2", REPLY); // new message: m1's queue is dropped mid-flight
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    expect(revoked).toContain("blob:1"); // created, found stale BEFORE insertion, revoked on the spot
    expect(lastAudio.src).not.toBe("blob:1");
  });

  it("retention is ONE message: starting a new one revokes the previous queue's blobs", async () => {
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await flush();
    await act(async () => lastAudio.finish());
    await flush(); // m1 now holds 3 blobs
    revoked = [];

    await act(async () => {
      await toggle("m2", REPLY);
    });
    expect(revoked).toEqual(expect.arrayContaining(["blob:1", "blob:2"]));
  });

  it("`/clear` reaps the queue too", async () => {
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await flush();
    revoked = [];
    act(() => clearAudioCache());
    expect(revoked).toContain("blob:1");
  });

  it("echoes the pin: chunk 1 discovers the target, chunks 2..N ask for it by `prefer`", async () => {
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    expect(calls[0].body).toEqual({ text: "One.", format: "opus" }); // no pin to echo yet
    await act(async () => calls[0].resolve(okRes("emma/kokoro")));
    await flush();
    expect(calls[1].body).toEqual({ text: "Two.", format: "opus", prefer: "emma/kokoro" });
  });

  it("flashes who served once per message, and again only when the pin actually moves", async () => {
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes("emma/kokoro")));
    await flush();
    await act(async () => calls[1].resolve(okRes("emma/kokoro"))); // same endpoint → silent
    await flush();
    await act(async () => lastAudio.finish());
    await flush();
    await act(async () => calls[2].resolve(okRes("vault/alltalk"))); // failed over mid-reply → flash
    await flush();

    const flashes = h.toast.mock.calls.filter(([text]) => String(text).startsWith("Read aloud by"));
    expect(flashes.map(([t]) => t)).toEqual([
      "Read aloud by emma/kokoro",
      "Read aloud by vault/alltalk",
    ]);
  });

  it("drops the tail past the per-message budget and says so once", async () => {
    setChunkPolicy(chunked({ maxTextChars: 5 })); // only "One." fits
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await flush();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(h.toast.mock.calls.filter(([t]) => String(t).startsWith("Reply too long"))).toHaveLength(
      1,
    );
  });

  it("a reply with nothing speakable never reaches the wire", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    await act(async () => {
      await toggle("m1", "```\nonly code\n```");
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.current.id).toBeNull();
  });
});
