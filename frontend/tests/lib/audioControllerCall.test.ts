import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeContext } from "./audioFakes";

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

describe("primeAudio — the latch goes up only on a FULFILLED play (ISS-73 ①, Sol confirm §3)", () => {
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });

  it("a REFUSED first prime leaves the latch down — the next gesture tries again, and then it holds", async () => {
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
    primeAudio();
    await settle();
    const el = FakeAudio.made[0];
    expect(el.plays).toBe(1);
    el.playRejects = false; // the engine wanted a real gesture; this one is
    primeAudio();
    await settle();
    expect(el.plays).toBe(2); // retried — the old latch would have made this a no-op forever
    primeAudio();
    await settle();
    expect(el.plays).toBe(2); // …and now it is latched
  });

  it("a gesture landing while a prime is IN FLIGHT is a no-op (no second silent play)", async () => {
    const { primeAudio } = await controller();
    primeAudio();
    primeAudio(); // before the first play's promise settled
    await settle();
    expect(FakeAudio.made[0].plays).toBe(1);
  });
});

describe("primeAudio — a BUSY mouth is skipped but retried (ISS-73 ① §3.7 · code round row 5a)", () => {
  it("skips while a reply holds the element, without latching, so the gesture after it unloads primes", async () => {
    const { primeAudio, toggle, dismiss } = await controller();
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          blob: async () => new Blob(["a"]),
          headers: { get: () => null },
        }) as unknown as Response,
    );
    URL.createObjectURL = vi.fn(() => "blob:reply");
    await act(async () => {
      await toggle("m1", "A reply.", { agent: null, actions: false }); // a reply loads the element
    });
    const el = FakeAudio.made[0];
    const before = el.plays;
    primeAudio(); // busy (the reply is playing): nothing touched
    expect(el.src).toBe("blob:reply");
    expect(el.plays).toBe(before);
    act(() => dismiss()); // unloaded
    primeAudio(); // NOT latched by the skip — this one runs the silent play
    expect(el.plays).toBe(before + 1);
  });

  it("…a reply still LOADING (its synth in flight, nothing on the element yet) is busy too — the reverse order (Opus LOW-2)", async () => {
    const { primeAudio, toggle } = await controller();
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})); // the synth never answers
    void toggle("m1", "A reply.", { agent: null, actions: false });
    const el = FakeAudio.made[0];
    primeAudio();
    expect(el.plays).toBe(0); // the reply owns the element, src or no src
    expect(el.src).toBe("");
  });
});

describe("primeAudio — a prime still settling never touches the reply that superseded it (code round row 5b, Sol M3)", () => {
  it("prime first, then the reply takes the element: the late settlement unloads nothing, and the mute is lifted", async () => {
    /** A play whose promise the case settles by hand — the prime's, still pending when the reply lands. */
    let rejectPrime: ((e: unknown) => void) | null = null;
    vi.stubGlobal(
      "Audio",
      class extends FakeAudio {
        async play() {
          if (this.plays === 0) {
            this.plays += 1;
            return new Promise<void>((_, reject) => {
              rejectPrime = reject;
            });
          }
          return super.play();
        }
      },
    );
    const { primeAudio, toggle, usePlayback } = await controller();
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          blob: async () => new Blob(["a"]),
          headers: { get: () => null },
        }) as unknown as Response,
    );
    URL.createObjectURL = vi.fn(() => "blob:reply");
    const { result } = renderHook(() => usePlayback((p) => p.status));
    primeAudio(); // the gesture's silent play — pending
    const el = FakeAudio.made[0];
    expect(el.muted).toBe(true);
    await act(async () => {
      await toggle("m1", "A reply.", { agent: null, actions: false }); // the reply takes the element
    });
    expect(el.src).toBe("blob:reply");
    expect(el.muted).toBe(false); // the prime's mute does not ride into the reply
    await act(async () => {
      rejectPrime!(new DOMException("interrupted by a new load", "AbortError"));
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    expect(el.src).toBe("blob:reply"); // the old `done()` unloaded it here
    expect(result.current).toBe("playing");
    primeAudio(); // unlatched (the prime never played) — but busy now, so still nothing touched
    expect(el.src).toBe("blob:reply");
  });
});

// ── ISS-73 ① — THE HIDDEN-PAGE HOLD (car-wave design §3.2) ─────────────────────────────────────────
// `primeReplyHold` (the gesture half: one context, resumed, and the element's real play) and
// `holdWhileHidden` (a reason SET: overlapping reasons share ONE node; the last OFF retires it and
// suspends the context), the idle bound (from the last progress, re-armed by progress), and the probe
// lines (the call trail's machinery, `mode: "mouth"`). Fresh module per case, for the page-lifetime
// context and element.
describe("the hidden-page hold (ISS-73 ①)", () => {
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
  beforeEach(() => {
    FakeContext.last = null;
    FakeContext.all = [];
    vi.stubGlobal("AudioContext", FakeContext);
  });

  it("primeReplyHold makes ONE context, resumes it inside each gesture, suspends it with nothing held, and primes the element", async () => {
    const { primeReplyHold } = await controller();
    primeReplyHold();
    await settle();
    expect(FakeContext.all).toHaveLength(1);
    const ctx = FakeContext.last!;
    expect(ctx.options).toBeUndefined(); // the default rate — a mouth context, not a capture one
    expect(ctx.resumes).toBe(1);
    expect(ctx.suspends).toBe(1); // unlocked, then quiet: nothing renders between holds
    expect(ctx.sources).toHaveLength(0);
    expect(FakeAudio.made[0].plays).toBe(1); // the element's real gesture-started play
    primeReplyHold(); // a second gesture
    await settle();
    expect(FakeContext.all).toHaveLength(1);
    expect(ctx.resumes).toBe(2);
    expect(FakeAudio.made[0].plays).toBe(1); // already primed
  });

  it("with no context yet (no gesture this page) an ON renders nothing — and builds nothing", async () => {
    const { holdWhileHidden } = await controller();
    holdWhileHidden("reply", true, 600);
    await settle();
    expect(FakeContext.all).toHaveLength(0);
  });

  it("a reason armed BEFORE any context is applied by the prime's settle, not stranded (row 11)", async () => {
    const { primeReplyHold, holdWhileHidden } = await controller();
    holdWhileHidden("upload", true, 0); // no context yet: recorded, nothing renders
    primeReplyHold();
    await settle();
    const ctx = FakeContext.last!;
    expect(ctx.sources).toHaveLength(1); // the old settle suspended instead
    expect(ctx.sources[0].stopped).toBe(0);
    expect(ctx.state).toBe("running");
  });

  it("two reasons overlapping run ONE node; the LAST off retires it and suspends", async () => {
    const { primeReplyHold, holdWhileHidden } = await controller();
    primeReplyHold();
    await settle();
    const ctx = FakeContext.last!;
    holdWhileHidden("reply", true, 600);
    await settle();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.state).toBe("running");
    holdWhileHidden("upload", true, 600);
    holdWhileHidden("reply", true, 600); // a re-assert is not an edge
    expect(ctx.sources).toHaveLength(1);
    holdWhileHidden("reply", false);
    await settle();
    expect(ctx.sources[0].stopped).toBe(0); // the upload still holds the page
    expect(ctx.state).toBe("running");
    const suspends = ctx.suspends;
    holdWhileHidden("upload", false);
    await settle();
    expect(ctx.sources[0].stopped).toBe(1);
    expect(ctx.suspends).toBe(suspends + 1);
    expect(ctx.state).toBe("suspended");
    holdWhileHidden("upload", false); // an OFF for a reason not held is nothing
    expect(ctx.suspends).toBe(suspends + 1);
  });

  describe("the idle bound (ruling 15)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("lapses after `idle_s` with NO progress, and the next progress brings the node back", async () => {
      const { primeReplyHold, holdWhileHidden, touchHoldProgress } = await controller();
      primeReplyHold();
      await settle();
      const ctx = FakeContext.last!;
      touchHoldProgress(); // a stream frame
      holdWhileHidden("reply", true, 10);
      expect(ctx.sources).toHaveLength(1);
      await act(async () => {
        vi.advanceTimersByTime(9_000);
      });
      expect(ctx.sources[0].stopped).toBe(0);
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      await settle();
      expect(ctx.sources[0].stopped).toBe(1); // lapsed: the hung page is let go
      expect(ctx.state).toBe("suspended");
      touchHoldProgress(); // the link came back: a frame applied
      await settle();
      expect(ctx.sources).toHaveLength(2); // re-armed — a fresh node (a stopped one cannot restart)
      expect(ctx.state).toBe("running");
    });

    it("is measured from the LAST progress — never from arming — and progress pushes it out", async () => {
      const { primeReplyHold, holdWhileHidden, touchHoldProgress } = await controller();
      primeReplyHold();
      await settle();
      const ctx = FakeContext.last!;
      touchHoldProgress();
      await act(async () => {
        vi.advanceTimersByTime(6_000); // a stall that began while the page was still in front
      });
      holdWhileHidden("reply", true, 10); // the page hides now
      await act(async () => {
        vi.advanceTimersByTime(4_000);
      });
      expect(ctx.sources[0].stopped).toBe(1); // 10 s since the last frame, not since the hide
      holdWhileHidden("reply", false);
      touchHoldProgress();
      holdWhileHidden("reply", true, 10); // a fresh hold
      expect(ctx.sources).toHaveLength(2);
      await act(async () => {
        vi.advanceTimersByTime(8_000);
      });
      touchHoldProgress(); // playback moved
      await act(async () => {
        vi.advanceTimersByTime(8_000);
      });
      expect(ctx.sources[1].stopped).toBe(0); // 16 s since arming, 8 s since progress: still held
      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });
      expect(ctx.sources[1].stopped).toBe(1);
    });

    it("a reason added with a DIFFERENT bound re-arms the running node's timer (row 3, Sol M2)", async () => {
      const { primeReplyHold, holdWhileHidden, touchHoldProgress } = await controller();
      primeReplyHold();
      await settle();
      const ctx = FakeContext.last!;
      touchHoldProgress();
      holdWhileHidden("upload", true, 0); // no bound
      holdWhileHidden("reply", true, 10); // a newly added reason, a 10 s bound
      await act(async () => {
        vi.advanceTimersByTime(11_000);
      });
      expect(ctx.sources[0].stopped).toBe(1); // the old code left it on with no timer at all
    });

    it("0 means NO bound", async () => {
      const { primeReplyHold, holdWhileHidden } = await controller();
      primeReplyHold();
      await settle();
      holdWhileHidden("upload", true, 0);
      await act(async () => {
        vi.advanceTimersByTime(24 * 3600_000);
      });
      expect(FakeContext.last!.sources[0].stopped).toBe(0);
    });
  });

  it("a LIVE CALL releases every reason (row 6, Opus LOW-1); its END re-arms nothing by itself — an owner's next edge does", async () => {
    const { primeReplyHold, holdWhileHidden, setCallVoice } = await controller();
    primeReplyHold();
    await settle();
    const ctx = FakeContext.last!;
    holdWhileHidden("reply", true, 0);
    holdWhileHidden("upload", true, 0);
    expect(ctx.sources).toHaveLength(1);
    setCallVoice(true, true); // armed — even with its gate still shut
    await settle();
    expect(ctx.sources[0].stopped).toBe(1);
    expect(ctx.state).toBe("suspended");
    holdWhileHidden("upload", true, 0); // an owner re-asserting DURING the call renders nothing
    expect(ctx.sources).toHaveLength(1);
    setCallVoice(false, false); // the call ends
    await settle();
    expect(ctx.sources).toHaveLength(1); // not by itself
    holdWhileHidden("reply", true, 0); // the owner's next edge
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[1].started).toBe(1);
  });

  it("the probe trail (§3.7 ②): one `mouth` trail per page, every line stamped with the page's visibility", async () => {
    const posted: { call_id: string; mode: string; entries: Record<string, unknown>[] }[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      posted.push(JSON.parse(String(init?.body)) as (typeof posted)[number]);
      return new Response(null, { status: 204 });
    });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    try {
      const { primeReplyHold, holdWhileHidden, setMouthTrail } = await controller();
      setMouthTrail(true);
      primeReplyHold();
      await settle();
      holdWhileHidden("reply", true, 0);
      await settle();
      holdWhileHidden("reply", false);
      await settle();
      FakeAudio.made[0].emit("loadstart"); // the element's own media events ride the trail too
      setMouthTrail(false); // ends the page's trail: flushed
      await settle();
      expect(posted.length).toBeGreaterThan(0);
      expect(new Set(posted.map((b) => b.mode))).toEqual(new Set(["mouth"]));
      expect(new Set(posted.map((b) => b.call_id)).size).toBe(1); // ONE trail per page
      const lines = posted.flatMap((b) => b.entries);
      for (const l of lines) expect(l).toMatchObject({ vis: "hidden" });
      const evs = lines.map((l) => l.ev);
      expect(evs).toContain("prime");
      expect(lines.find((l) => l.ev === "prime")).toMatchObject({ branch: "played" });
      expect(lines.filter((l) => l.ev === "hold").map((l) => l.on)).toEqual([true, false]);
      expect(lines.filter((l) => l.ev === "ctx_state").map((l) => [l.op, l.state])).toEqual([
        ["prime", "running"],
        ["suspend", "suspended"],
        ["resume", "running"],
        ["suspend", "suspended"],
      ]);
      expect(lines.filter((l) => l.ev === "el").map((l) => l.type)).toContain("loadstart");
    } finally {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    }
  });

  it("a REFUSED play is recorded with its error name; the gate off writes nothing at all", async () => {
    const posted: { entries: Record<string, unknown>[] }[] = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes("/voice/tts"))
        return {
          ok: true,
          status: 200,
          blob: async () => new Blob(["a"]),
          headers: { get: () => null },
        } as unknown as Response;
      posted.push(JSON.parse(String(init?.body)) as (typeof posted)[number]);
      return new Response(null, { status: 204 });
    });
    URL.createObjectURL = vi.fn(() => "blob:reply");
    const { setMouthTrail, toggle } = await controller();
    await act(async () => {
      await toggle("m0", "Before the gate.", { agent: null, actions: false });
    });
    expect(posted).toHaveLength(0); // the gate is off: not one line, not one request
    setMouthTrail(true);
    FakeAudio.made[0].playRejects = true;
    await act(async () => {
      await toggle("m1", "Hidden reply.", { agent: null, actions: false });
    });
    await settle();
    setMouthTrail(false);
    await settle();
    const lines = posted.flatMap((b) => b.entries);
    expect(lines.find((l) => l.ev === "play")).toMatchObject({ id: "m1" });
    expect(lines.find((l) => l.ev === "play_result")).toMatchObject({
      ok: false,
      err: "NotAllowedError",
    });
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
