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
// snapshot. Three halves, matching the controller's paths:
//   • `chunking: off` — the pre-D63 whole-blob path: play/switch/seek/dismiss + the reqSeq race fixes.
//   • `chunking: sentence` — the D63 queue: advance-on-`ended`, the waiting latch, error-skip, cancel,
//     the stale-completion revoke, single-message retention, the failover pin and its serve flash.
//   • the D63-amendment VIRTUAL TIMELINE — the estimator, the whole-message position/duration, and the
//     global seek's three landings (synthesized / pending / failed).

let lastAudio: FakeAudio;
let probes: FakeAudio[] = [];
class FakeAudio {
  preload = "";
  src = "";
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  ended = false;
  private listeners: Record<string, (() => void)[]> = {};
  constructor() {
    // The controller builds its ONE player element lazily and then keeps it forever, so the FIRST
    // instance is the player and every later one is a throwaway duration PROBE (D63 amendment). Probes
    // stay inert until a test answers them with `meta()`.
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- test mock captures its own instance for assertions
    const made: FakeAudio = this;
    if (lastAudio) probes.push(made);
    else lastAudio = made;
  }
  addEventListener(type: string, cb: () => void) {
    (this.listeners[type] ||= []).push(cb);
  }
  removeEventListener(type: string, cb: () => void) {
    this.listeners[type] = (this.listeners[type] || []).filter((l) => l !== cb);
  }
  removeAttribute() {
    this.src = "";
  }
  load() {}
  /** Answer a duration probe: its blob's metadata reads. */
  meta(d: number) {
    this.duration = d;
    this.emit("loadedmetadata");
  }
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

/** A successful /voice/tts response carrying the D63 target header (+ the degraded marker, which the
 *  backend emits ONLY when a hop failed before this one answered). */
function okRes(target = "emma/kokoro", opts: { degraded?: boolean } = {}): Response {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob(["a"]),
    headers: {
      get: (k: string) => {
        if (k === "X-Voice-Target") return target;
        return k === "X-Voice-Degraded" && opts.degraded ? "1" : null;
      },
    },
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

/** Answer the duration probe the controller fired for a given chunk blob. */
function metaFor(url: string, seconds: number): void {
  const p = probes.find((x) => x.src === url);
  if (!p) throw new Error(`no duration probe for ${url}`);
  p.meta(seconds);
}

beforeEach(() => {
  vi.stubGlobal("Audio", FakeAudio);
  urlSeq = 0;
  revoked = [];
  probes = [];
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

  it("a pause taken under the latch survives it: the late chunk loads but does not play", async () => {
    const calls = deferredFetch();
    const { result } = renderHook(() => usePlayback((p) => p));
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    await act(async () => lastAudio.finish()); // chunk 2 still in flight → latched, still "playing"
    await flush();

    act(() => togglePlay()); // the user pauses WHILE the latch holds — the element is already ended
    expect(result.current.status).toBe("paused");

    await act(async () => calls[1].resolve(okRes()));
    await flush();
    expect(lastAudio.src).toBe("blob:2"); // loaded and held...
    expect(lastAudio.paused).toBe(true); // ...never played over the pause
    expect(result.current.status).toBe("paused");

    act(() => togglePlay()); // resume → the held chunk plays
    expect(result.current.status).toBe("playing");
    expect(lastAudio.paused).toBe(false);
  });

  it("resuming while the latch still holds re-arms it: the pending chunk plays on arrival", async () => {
    const calls = deferredFetch();
    const { result } = renderHook(() => usePlayback((p) => p));
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    await act(async () => lastAudio.finish());
    await flush();
    act(() => togglePlay()); // pause under the latch...
    act(() => togglePlay()); // ...then change your mind before the chunk lands
    expect(result.current.status).toBe("playing");

    await act(async () => calls[1].resolve(okRes()));
    await flush();
    expect(lastAudio.src).toBe("blob:2");
    expect(lastAudio.paused).toBe(false);
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

  it("an all-failed message is not kept as a dead queue: the next tap re-synthesizes", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    globalThis.fetch = vi.fn(async () => errRes(502));
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await flush();
    await flush();
    expect(result.current.id).toBeNull(); // every chunk failed → the player is back to idle
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);

    globalThis.fetch = vi.fn(async () => okRes()); // the TTS server came back
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await flush();
    expect(globalThis.fetch).toHaveBeenCalled(); // fresh requests, not an instant replay of the corpse
    expect(result.current.status).toBe("playing");
  });

  it("a partly-failed message is not kept for replay: the next tap re-requests the failed chunk", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    await act(async () => calls[1].resolve(errRes(500))); // chunk 2 fails while chunk 1 plays
    await flush();
    await act(async () => calls[2].resolve(okRes()));
    await flush();
    await act(async () => lastAudio.finish()); // chunk 1 ends → skip 2 → chunk 3
    await flush();
    await act(async () => lastAudio.finish()); // chunk 3 ends → end of the queue
    await flush();

    expect(result.current.id).toBeNull(); // a failed chunk means no retained queue — back to idle
    expect(revoked).toContain("blob:1"); // the retained blobs went with it

    globalThis.fetch = vi.fn(async () => okRes()); // the TTS server came back
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await flush();
    const fresh = globalThis.fetch as ReturnType<typeof vi.fn>;
    const texts = fresh.mock.calls.map(
      ([, init]) => (JSON.parse(String((init as RequestInit).body)) as { text: string }).text,
    );
    expect(texts).toContain("Two."); // the previously failed chunk is on the wire again
    expect(result.current.status).toBe("playing");
  });

  it("a straggler synth failing after the queue parked drops it too — no stale replay survives", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    act(() => metaFor("blob:1", 2)); // 2 chars/s → 0–2 · 2–4 · 4–7
    act(() => seekFraction(5 / 7)); // forward into chunk 3 — chunk 2 stays in flight
    await act(async () => calls[2].resolve(okRes()));
    await flush();
    await act(async () => lastAudio.finish()); // chunk 3 ends → end of queue, chunk 2 still pending
    await flush();
    expect(result.current.id).toBe("m1"); // a benign hole parks the queue for replay
    expect(result.current.status).toBe("paused");

    await act(async () => calls[1].resolve(errRes(500))); // ...and then the straggler fails
    await flush();
    expect(result.current.id).toBeNull(); // the parked queue is dropped — the finish() drop, late
    expect(revoked).toContain("blob:1");
  });

  it("a straggler synth landing OK after the park enriches the retained queue instead", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    act(() => metaFor("blob:1", 2));
    act(() => seekFraction(5 / 7));
    await act(async () => calls[2].resolve(okRes()));
    await flush();
    await act(async () => lastAudio.finish());
    await flush();

    await act(async () => calls[1].resolve(okRes())); // the straggler lands fine
    await flush();
    expect(result.current.id).toBe("m1"); // retention intact — the hole simply filled in
    expect(result.current.status).toBe("paused");
    expect(lastAudio.src).toBe("blob:1"); // still rewound, ready to replay from the top
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

  it("bootstraps the pin: chunk 1 goes alone, then the window opens and the rest carry `prefer`", async () => {
    setChunkPolicy(chunked({ lookahead: 3 }));
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    expect(calls).toHaveLength(1); // lookahead 3, but nobody past chunk 1 may go out unpinned yet
    await act(async () => calls[0].resolve(okRes("emma/kokoro")));
    await flush();
    expect(calls).toHaveLength(3); // pin known → the full window opens at once
    expect(calls[1].body.prefer).toBe("emma/kokoro");
    expect(calls[2].body.prefer).toBe("emma/kokoro");
  });

  it("a failed chunk 1 gives up on pinning rather than stalling the window", async () => {
    setChunkPolicy(chunked({ lookahead: 3 }));
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(errRes(500)));
    await flush();
    expect(calls).toHaveLength(3); // the window opened anyway — the message still gets read
    expect(calls[1].body.prefer).toBeUndefined(); // nothing to echo: no chunk ever named a target
  });

  it("says nothing about who served on the happy path (the flash is exception-only)", async () => {
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await flush();
    await act(async () => lastAudio.finish());
    await flush();
    expect(h.toast.mock.calls.filter(([t]) => String(t).startsWith("Read aloud by"))).toHaveLength(
      0,
    );
  });

  it("flashes the first target only when the chain was DEGRADED to reach it", async () => {
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes("vault/alltalk", { degraded: true })));
    await flush();
    const flashes = h.toast.mock.calls.filter(([text]) => String(text).startsWith("Read aloud by"));
    expect(flashes.map(([t]) => t)).toEqual(["Read aloud by vault/alltalk"]);
  });

  it("flashes again when the pin actually moves mid-reply", async () => {
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes("emma/kokoro"))); // happy first serve → silent
    await flush();
    await act(async () => calls[1].resolve(okRes("emma/kokoro"))); // same endpoint → silent
    await flush();
    await act(async () => lastAudio.finish());
    await flush();
    await act(async () => calls[2].resolve(okRes("vault/alltalk"))); // failed over mid-reply → flash
    await flush();

    const flashes = h.toast.mock.calls.filter(([text]) => String(text).startsWith("Read aloud by"));
    expect(flashes.map(([t]) => t)).toEqual(["Read aloud by vault/alltalk"]);
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

describe("audioController — the whole-message virtual timeline (D63 amendment)", () => {
  const REPLY = "One. Two. Three."; // → "One." (4 chars) · "Two." (4) · "Three." (6) = 14 characters

  beforeEach(() => setChunkPolicy(chunked()));

  /** A message whose three chunks have ALL landed and been probed: 2 s / 4 s / 4.5 s, so the timeline is
   *  exactly 0–2 · 2–6 · 6–10.5. `lookahead 3` puts every chunk on the wire once the pin settles. */
  async function timeline3(): Promise<Call[]> {
    setChunkPolicy(chunked({ lookahead: 3 }));
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    await act(async () => {
      calls[1].resolve(okRes());
      calls[2].resolve(okRes());
    });
    await flush();
    act(() => {
      metaFor("blob:1", 2);
      metaFor("blob:2", 4);
      metaFor("blob:3", 4.5);
    });
    return calls;
  }

  // ── the estimator ──

  it("spans the whole reply from the constant fallback rate before any audio exists", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    expect(result.current.duration).toBeCloseTo(14 / 15, 6); // 14 chars at the display-only fallback
    expect(result.current.estimated).toBe(true);
    expect(result.current.chunks?.map((c) => c.ok)).toEqual([false, false, false]);
  });

  it("learns chars/sec from the chunks that landed and refines the rest", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    expect(result.current.duration).toBeCloseTo(14 / 15, 6); // blob exists, metadata hasn't read yet

    act(() => metaFor("blob:1", 2)); // 4 chars in 2 s → 2 chars/s
    expect(result.current.duration).toBeCloseTo(7, 6); // 2 + 4/2 + 6/2
    expect(result.current.chunks?.map((c) => c.ok)).toEqual([true, false, false]);

    await act(async () => calls[1].resolve(okRes()));
    await flush();
    act(() => metaFor("blob:2", 4)); // 8 chars in 6 s → 4/3 chars/s
    expect(result.current.duration).toBeCloseTo(10.5, 6); // 2 + 4 + 6/(4/3)
    expect(result.current.estimated).toBe(true); // chunk 3 is still a guess
  });

  it("drops the estimate flag once every chunk has an exact duration", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    await timeline3();
    expect(result.current.duration).toBeCloseTo(10.5, 6);
    expect(result.current.estimated).toBe(false);
  });

  // ── the global snapshot ──

  it("position is whole-message: the playing chunk's slot plus the element's own time", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    await timeline3();
    act(() => {
      lastAudio.currentTime = 1;
      lastAudio.emit("timeupdate");
    });
    expect(result.current.current).toBeCloseTo(1, 6);

    await act(async () => lastAudio.finish()); // → chunk 2, whose slot starts at 2 s
    await flush();
    expect(result.current.current).toBeCloseTo(2, 6);
    act(() => {
      lastAudio.currentTime = 1.5;
      lastAudio.emit("timeupdate");
    });
    expect(result.current.current).toBeCloseTo(3.5, 6);
  });

  it("the chunk map is ONE reference across position ticks, a new one when the timeline moves", async () => {
    const { result } = renderHook(() => usePlayback((p) => p.chunks));
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    const ref = result.current;
    act(() => {
      lastAudio.currentTime = 1;
      lastAudio.emit("timeupdate");
    });
    expect(result.current).toBe(ref); // a `timeupdate` must never rebuild it
    act(() => metaFor("blob:1", 2));
    expect(result.current).not.toBe(ref); // an exact duration does
  });

  // ── the global seek ──

  it("seeks across the whole message: a global fraction lands on (chunk, offset)", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    await timeline3();
    act(() => seekFraction(7 / 10.5)); // 7 s in → chunk 3 (slot 6–10.5), 1 s into it
    expect(lastAudio.src).toBe("blob:3");
    expect(lastAudio.currentTime).toBeCloseTo(1, 6);
    expect(result.current.current).toBeCloseTo(7, 6);
    expect(result.current.status).toBe("playing");

    act(() => seekFraction(1 / 10.5)); // backward onto a RETAINED blob — instant
    expect(lastAudio.src).toBe("blob:1");
    expect(lastAudio.currentTime).toBeCloseTo(1, 6);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3); // nothing re-synthesized
  });

  it("clamps the seek to the timeline's ends and to the target chunk's own length", async () => {
    await timeline3();
    act(() => seekFraction(2)); // past the end
    expect(lastAudio.src).toBe("blob:3");
    expect(lastAudio.currentTime).toBeCloseTo(4.5, 6); // the last chunk's length, not the total
    act(() => seekFraction(-1)); // before the start
    expect(lastAudio.src).toBe("blob:1");
    expect(lastAudio.currentTime).toBe(0);
  });

  it("a seek into a FAILED chunk hands off to the next playable one, from its start", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    setChunkPolicy(chunked({ lookahead: 3 }));
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    await act(async () => {
      calls[1].resolve(errRes(500)); // chunk 2 never makes a blob
      calls[2].resolve(okRes());
    });
    await flush();
    act(() => {
      metaFor("blob:1", 2);
      metaFor("blob:2", 3); // 10 real chars in 5 s → 2 chars/s
    });
    expect(result.current.duration).toBeCloseTo(7, 6); // the failed chunk keeps a 2 s hole: 0–2·2–4·4–7

    act(() => seekFraction(3 / 7)); // straight into the hole
    expect(lastAudio.src).toBe("blob:2"); // chunk 3's blob — chunk 2 never made one
    expect(lastAudio.currentTime).toBe(0);
    expect(result.current.current).toBeCloseTo(4, 6);
  });

  it("a forward seek past synthesis requests the target and plays it from the offset", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    const calls = deferredFetch(); // lookahead 1: chunk 3 is nowhere near the window
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    act(() => metaFor("blob:1", 2)); // 2 chars/s → 0–2 · 2–4 · 4–7
    expect(calls).toHaveLength(2); // chunk 2 in flight, chunk 3 not requested

    act(() => seekFraction(5 / 7)); // a third of the way into chunk 3
    expect(calls).toHaveLength(3);
    expect(calls[2].body.text).toBe("Three."); // the synth window followed the cursor
    expect(result.current.status).toBe("playing"); // latched, exactly like a mid-queue catch-up
    expect(result.current.current).toBeCloseTo(5, 6);

    await act(async () => calls[2].resolve(okRes()));
    await flush();
    expect(lastAudio.src).toBe("blob:2"); // chunk 3's blob is the SECOND one made
    expect(lastAudio.currentTime).toBe(0); // nothing lands until the REAL length is known
    act(() => lastAudio.meta(3)); // ...and the estimate was right: 3 s
    expect(lastAudio.currentTime).toBeCloseTo(1, 6); // a third of 3 s
    expect(lastAudio.paused).toBe(false);

    // ...and the seek is one-shot: the end-of-queue rewind starts its chunk at 0, not a third in.
    await act(async () => lastAudio.finish());
    await flush();
    expect(lastAudio.src).toBe("blob:1");
    expect(lastAudio.currentTime).toBe(0);
  });

  it("banks the seek as a FRACTION, so an over-long estimate can't overshoot the real chunk", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    act(() => metaFor("blob:1", 2)); // 2 chars/s → chunk 3 is ESTIMATED at 3 s (0–2 · 2–4 · 4–7)

    act(() => seekFraction(1)); // hard to the end — fraction 1 of the target span
    await act(async () => calls[2].resolve(okRes()));
    await flush();
    act(() => lastAudio.meta(1)); // the chunk is really only 1 s

    // Seconds would have set 3 s on a 1 s clip: an instant `ended` cascading into the rewind. The end
    // guard keeps the playhead just inside the tail instead, and the chunk is still the one loaded.
    expect(lastAudio.currentTime).toBeCloseTo(0.95, 6);
    expect(lastAudio.src).toBe("blob:2");
    expect(result.current.status).toBe("playing");
  });

  it("banks the seek as a FRACTION, so an under-long estimate still lands proportionally", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    act(() => metaFor("blob:1", 2));

    act(() => seekFraction(5 / 7)); // a third into a span ESTIMATED at 3 s
    await act(async () => calls[2].resolve(okRes()));
    await flush();
    act(() => lastAudio.meta(6)); // the chunk is really 6 s

    expect(lastAudio.currentTime).toBeCloseTo(2, 6); // a third of 6 s — not the 1 s of the estimate
    expect(result.current.current).toBeCloseTo(6, 6); // ...and the published position follows it
  });

  it("the metadata one-shot fires once, and a stale one is inert after the message changes", async () => {
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    act(() => metaFor("blob:1", 2));
    act(() => seekFraction(5 / 7));
    await act(async () => calls[2].resolve(okRes()));
    await flush();

    act(() => lastAudio.meta(6));
    expect(lastAudio.currentTime).toBeCloseTo(2, 6);
    act(() => lastAudio.meta(12)); // a LATER metadata event must not re-apply the spent seek
    expect(lastAudio.currentTime).toBeCloseTo(2, 6);
  });

  it("a metadata one-shot left dangling by a message switch touches nothing", async () => {
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    act(() => metaFor("blob:1", 2));
    act(() => seekFraction(5 / 7));
    await act(async () => calls[2].resolve(okRes()));
    await flush();
    expect(lastAudio.currentTime).toBe(0); // loaded + armed, but metadata has not read yet

    await act(async () => {
      await toggle("m2", REPLY); // ...and the user moves to another message first
    });
    const parked = lastAudio.currentTime;
    act(() => lastAudio.meta(6));
    expect(lastAudio.currentTime).toBe(parked);
  });

  it("a NEWER same-chunk drag disarms the pending payout — the stale fraction can't snap back", async () => {
    // The confirm-round catch: the generation/index guards can't see a second seek into the SAME chunk.
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    act(() => metaFor("blob:1", 2)); // 0–2 · 2–4 · 4–7, chunk 3 estimated at 3 s
    act(() => seekFraction(1)); // pending seek A: fraction 1 of chunk 3, payout armed on arrival
    await act(async () => calls[2].resolve(okRes()));
    await flush();
    expect(lastAudio.currentTime).toBe(0); // armed, metadata not read yet

    act(() => seekFraction(5 / 7)); // B: the user drags AGAIN into the same chunk (fast path, ~1 s in)
    expect(lastAudio.currentTime).toBeCloseTo(1, 6);
    act(() => lastAudio.meta(6)); // A's metadata finally reads — its payout must be DISARMED
    expect(lastAudio.currentTime).toBeCloseTo(1, 6); // B's landing survives (A would have snapped to 5.95)
  });

  it("a play() interrupted by a newer seek never publishes 'paused' over the live one", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    await timeline3();
    // Seek A's play() is the one that loses the race: hold its rejection until B is already running.
    const realPlay = lastAudio.play.bind(lastAudio);
    let rejectA!: (e: unknown) => void;
    lastAudio.play = () =>
      new Promise<void>((_resolve, reject) => {
        rejectA = reject;
      });
    act(() => seekFraction(7 / 10.5)); // A — src swapped, play() left hanging
    lastAudio.play = realPlay;
    act(() => seekFraction(1 / 10.5)); // B — swaps src again and really plays
    expect(result.current.status).toBe("playing");

    await act(async () => {
      rejectA(new DOMException("interrupted by a new load request", "AbortError"));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.status).toBe("playing"); // A's stale rejection did NOT settle the transport
    expect(lastAudio.src).toBe("blob:1"); // ...and B is still the clip on the element
  });

  it("a forward seek taken while PAUSED loads the target at its offset and holds it", async () => {
    const { result } = renderHook(() => usePlayback((p) => p));
    const calls = deferredFetch();
    await act(async () => {
      await toggle("m1", REPLY);
    });
    await act(async () => calls[0].resolve(okRes()));
    await flush();
    act(() => metaFor("blob:1", 2));
    act(() => togglePlay()); // pause BEFORE seeking
    expect(result.current.status).toBe("paused");

    act(() => seekFraction(5 / 7));
    expect(result.current.status).toBe("paused"); // a seek never resumes playback

    await act(async () => calls[2].resolve(okRes()));
    await flush();
    expect(lastAudio.src).toBe("blob:2");
    act(() => lastAudio.meta(3)); // the offset lands off the real length, playing or not
    expect(lastAudio.currentTime).toBeCloseTo(1, 6);
    expect(lastAudio.paused).toBe(true); // loaded and held, the latch's pause semantics
    expect(result.current.status).toBe("paused");
  });

  it("`off` keeps the element-local scrubber and publishes no chunk map", async () => {
    setChunkPolicy(OFF);
    const { result } = renderHook(() => usePlayback((p) => p));
    await act(async () => {
      await toggle("m1", "hello");
    });
    act(() => {
      lastAudio.duration = 10;
      lastAudio.emit("durationchange");
    });
    act(() => seekFraction(0.25));
    expect(lastAudio.currentTime).toBe(2.5);
    expect(result.current.current).toBe(2.5);
    expect(result.current.chunks).toBeNull();
    expect(result.current.estimated).toBe(false);
  });
});
