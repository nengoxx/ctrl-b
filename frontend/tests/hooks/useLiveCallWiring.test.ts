import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveDown } from "../../src/lib/liveSocket";

// hooks/useLiveCall — THE WIRING, as opposed to the rules. `callReduce` is pinned signal-by-signal in
// `useLiveCall.test.ts`; what is pinned here is the layer that turns the world into those signals and
// keeps its own latches: the read-along GATE (armed shut when a turn was already streaming, opened on
// that turn's settle), the mouth's failure tick and its mid-reply synthesis gap, and the held-upload
// retry latch that has to re-arm per HOLD. Everything the hook imports is mocked to module state the
// cases drive — the `useAutoTts.test.ts` pattern, one layer up.

const h = vi.hoisted(() => ({
  voice: {
    data: {
      live: true,
      live_call: {
        frame_ms: 20,
        buffered_ceiling_ms: 1000,
        call_backlog_ms: 1000, //     = 50 frames at 20 ms before the pacer drops its oldest
        min_speech_ms: 300,
        barge_threshold: 0,
        barge_in: true,
        ring: "none",
        echo_workaround: "auto",
        route: "speaker", //          D73 S5 — the capture pair; a case flips it to "headphones"
        input_device: "",
        // D73 S6 — the background three. Defaults as the backend ships them; the S6 cases move them.
        background: true,
        background_keepalive: true,
        background_idle_s: 600,
        max_session_s: 600,
        // D74 — the transcript gate's floor, OFF unless a case arms it.
        min_final_ms: 0,
        // The server-VAD knob the slider seeds from (2026-09-22).
        vad_threshold: 0.9,
      },
      stt_auto_stop: { threshold: 0 },
    },
  },
  play: { status: "idle" },
  /** The controller's store listeners (S3: the wiring subscribes; it no longer reads status on
   *  render). `setPlay` below is the one way the cases move the status — assignment alone would
   *  change a value nobody is told about, exactly like the real store without its `emit`. */
  playbackSubs: new Set<() => void>(),
  chat: { status: "idle" },
  confirm: false,
  failures: 0,
  staged: [] as { status: string }[],
  liveTurn: null as { threadId: string; turnId: string | null } | null,
  /** The socket the hook opened: the test drives the relay through its `onFrame`. */
  frame: null as ((f: LiveDown) => void) | null,
  /** …and that leg's close, so a case can drop it the way a flaky link does. */
  close: null as (() => void) | null,
  /** How many times the CLIENT asked to close a leg (S6 ② closes one; so does every teardown). In a
   *  browser that close IS what calls `onClose`; here the case drives that half itself, so the two
   *  halves of the reconnect stay separately visible. */
  closes: 0,
  /** …and the CAPTURE's own door: the case IS the microphone (A-F2's pacer cases). */
  mic: null as ((f: { buf: ArrayBuffer; rms: number }) => void) | null,
  /** Every frame that actually reached the WIRE, by its identifying first byte and in order — the
   *  pacer's whole assertion is what the uplink shipped and what it dropped. */
  audio: [] as number[],
  /** The acquisition TIMELINE, in order: what reached the track, and when the leg opened. The ear-hold's
   *  whole assertion is an ORDERING — a rule that reaches the track one render late is a rule that was
   *  not applied while the first frames went out. */
  order: [] as string[],
  /** What each opened leg DECLARED as its `start` threshold, in order (the in-call slider's wire). */
  vadSent: [] as (number | undefined)[],
  sendCall: vi.fn<(text: string) => Promise<string>>(),
  setCallVoice: vi.fn(),
  openGate: vi.fn(),
  dismiss: vi.fn(),
  cancelTurn: vi.fn(async () => {}),
  appendDraft: vi.fn(),
  endCall: vi.fn(),
  setMuted: vi.fn(),
  setHeld: vi.fn((held: boolean) => {
    h.order.push(`held:${String(held)}`);
  }),
  /** The controller's registered pre-play tap (S3 confirm F2) — null when nothing is registered. */
  prePlay: null as (() => void) | null,
  /** Is the opened track a boolean-only AEC (Fennec: `getSettings().echoCancellation === true`, and no
   *  string modes at all) rather than Chromium's subtractive `"all"`? The ONE input to both the
   *  trigger-A arming and the S3 ear-hold decision. */
  fennec: false,
  /** D73 S5 — did the picked `input_device` refuse to open, so the DEFAULT route took the call? */
  fellBack: false,
  /** D73 S6 ② — how long ago the ear last heard a frame, in ms (the capture's own liveness). */
  earGap: 0,
  /** …and every `setKeepalive` the wiring asked for, in order (S6 ③): the node is invisible to the
   *  machine by construction, so the CALLS are the only thing a test can hold it to. */
  keepalive: [] as boolean[],
  /** …and what `startPcmCapture` was actually asked for, so a case can pin that the route reaches it. */
  capOpts: null as { route?: string; deviceId?: string } | null,
  /** How many captures this call has RELEASED (D74 S2): a route cycle must not leave the old ear open
   *  beside the new one — overlapping captures pin the platform's echo mode (R78 §2.3). */
  capStops: 0,
  /** Holds `startPcmCapture` open when an arm needs the acquisition GAP itself. */
  capGate: Promise.resolve(),
}));

vi.mock("../../src/lib/audioController", () => ({
  dismiss: h.dismiss,
  openCallVoiceGate: h.openGate,
  setCallVoice: h.setCallVoice,
  useMouthFailures: () => h.failures,
  setCallPrePlay: (cb: (() => void) | null) => {
    h.prePlay = cb;
  },
  getPlayStatus: () => h.play.status,
  subscribePlayback: (cb: () => void) => {
    h.playbackSubs.add(cb);
    return () => h.playbackSubs.delete(cb);
  },
}));
vi.mock("../../src/lib/composer", () => ({ sendCallTranscript: h.sendCall }));
vi.mock("../../src/lib/liveSocket", () => ({
  liveSocketUrl: () => "ws://x/api/voice/live",
  openLiveSocket: (opts: {
    vadThreshold?: number;
    onFrame: (f: LiveDown) => void;
    onClose: (code: number, reason: string) => void;
  }) => {
    h.vadSent.push(opts.vadThreshold);
    h.frame = opts.onFrame;
    // The leg's own unannounced close — a dropped tailnet link, the one close the machine reconnects
    // through. Bound per leg, so a case can drop THIS leg and watch the ladder open the next one.
    h.close = () => opts.onClose(1006, "");
    h.order.push("socket");
    return {
      sendAudio: (buf: ArrayBuffer) => h.audio.push(new Uint8Array(buf)[0]),
      flush: () => {},
      stop: () => {},
      close: () => {
        h.closes += 1;
      },
      unknown: () => 0,
    };
  },
}));
vi.mock("../../src/lib/pcmCapture", async (importActual) => ({
  // `onHeadphones` stays REAL: the route predicate is the thing under test in the D73 cases, and a
  // mocked one would pin the harness's opinion of the string rather than the module's.
  onHeadphones: (await importActual<typeof import("../../src/lib/pcmCapture")>()).onHeadphones,
  startPcmCapture: async (opts: {
    onFrame: (f: { buf: ArrayBuffer; rms: number }) => void;
    route?: string;
    deviceId?: string;
  }) => {
    await h.capGate; // resolved by default; an arm swaps in a deferred to hold acquisition open
    h.mic = opts.onFrame;
    h.capOpts = { route: opts.route, deviceId: opts.deviceId };
    return {
      sampleRate: 48000,
      readback: {
        echoCancellation: h.fennec ? true : "all",
        echoCapabilities: h.fennec ? [true] : [true, "all"],
        label: "Speakerphone",
        deviceId: h.voice.data.live_call.input_device,
      },
      fellBack: h.fellBack,
      setMuted: h.setMuted,
      setHeld: h.setHeld,
      earGapMs: () => h.earGap,
      setKeepalive: (on: boolean) => h.keepalive.push(on),
      stop: () => {
        h.capStops += 1;
      },
    };
  },
}));
vi.mock("../../src/store/attachments", () => ({ useStagedFiles: () => h.staged }));
vi.mock("../../src/store/chat", () => ({
  cancelTurn: h.cancelTurn,
  confirmOutstanding: () => h.confirm,
  getLiveTurn: () => h.liveTurn,
  useChatSlice: (sel: (s: { status: string }) => unknown) => sel(h.chat),
}));
vi.mock("../../src/store/composer", () => ({ appendDraft: h.appendDraft }));
vi.mock("../../src/store/liveCall", () => ({ endCall: h.endCall }));
vi.mock("../../src/hooks/useVoiceStatus", () => ({ useVoiceStatus: () => h.voice }));

import { CALL_COPY, useLiveCall } from "../../src/hooks/useLiveCall";
// REAL, deliberately (D74 S6 ⑧): the handover is the seam under test, and a mocked one would pin the
// harness's opinion of it rather than the module both sides actually share.
import { setMicRelease } from "../../src/store/micRelease";

/** Move the playback status the way the real store does: write, then tell the listeners — in the same
 *  task, which is the whole S3 contract the wiring now rides (see the sync-hold suite). */
const setPlay = (status: string): void => {
  h.play = { status };
  for (const cb of h.playbackSubs) cb();
};

/** The page going away and coming back (D73 S6). jsdom has no visibility model, so the property is
 *  redefined and the event dispatched by hand — which is exactly the pair a browser delivers. */
const visibility = (state: DocumentVisibilityState): void => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

/** An in-memory `sessionStorage` (D73 S6 ⑦). Two reasons, both real: the marker's whole story is
 *  "what the PREVIOUS document left behind", which a case has to be able to seed — and jsdom's own
 *  Storage schedules a `setTimeout(0)` per write, which would land in every fake-timer assertion in
 *  this file as a timer nothing here owns. */
const sessionStore = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  getItem: (k: string) => sessionStore.get(k) ?? null,
  setItem: (k: string, v: string) => void sessionStore.set(k, v),
  removeItem: (k: string) => void sessionStore.delete(k),
});

beforeEach(() => {
  h.play = { status: "idle" };
  h.playbackSubs.clear();
  h.prePlay = null;
  h.chat = { status: "idle" };
  h.confirm = false;
  h.failures = 0;
  h.staged = [];
  h.liveTurn = null;
  h.frame = null;
  h.close = null;
  h.closes = 0;
  h.mic = null;
  h.earGap = 0;
  h.keepalive = [];
  sessionStore.clear();
  visibility("visible");
  h.voice.data.live_call.background = true;
  h.voice.data.live_call.background_keepalive = true;
  h.voice.data.live_call.background_idle_s = 600;
  h.audio = [];
  h.order = [];
  h.vadSent = [];
  h.fennec = false;
  h.fellBack = false;
  h.capOpts = null;
  h.capStops = 0;
  h.voice.data.live_call.route = "speaker";
  h.voice.data.live_call.input_device = "";
  h.voice.data.live_call.echo_workaround = "auto";
  h.voice.data.live_call.barge_threshold = 0; // trigger A DISARMED unless a case calibrates a floor
  h.voice.data.live_call.min_final_ms = 0; // …and the transcript gate OFF unless a case arms it
  setMicRelease(null); // nobody holds the ear unless a case says so
  h.voice.data.stt_auto_stop.threshold = 0;
  h.capGate = Promise.resolve();
  h.sendCall.mockReset();
  h.sendCall.mockResolvedValue("accepted");
  h.setCallVoice.mockClear();
  h.openGate.mockClear();
  h.dismiss.mockClear();
  h.appendDraft.mockClear();
  h.setMuted.mockClear();
  h.setHeld.mockClear();
});

// Every case mounts a MACHINE that listens on the document itself (visibility, the Lifecycle resume,
// pagehide — D73 S6). `globals: false` means Testing Library's auto-cleanup never registers, so
// without this a call from an earlier case is still mounted and still answering those events, and
// "what did the page hiding do" stops being a question about one machine.
afterEach(cleanup);

/** Mount the machine and connect it — `ready` is what makes the call `listening`. */
async function call() {
  const view = renderHook(() => useLiveCall());
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    h.frame?.({ type: "state", state: "ready" });
  });
  /** One store update the hook reads through its mocked hooks, then a render. */
  const step = async (fn: () => void) => {
    await act(async () => {
      fn();
      view.rerender();
      await Promise.resolve();
    });
  };
  /** The ear delivering one finished utterance. */
  const say = async (text: string) => {
    await act(async () => {
      h.frame?.({ type: "speech_started" });
      h.frame?.({ type: "speech_stopped" });
      h.frame?.({ type: "transcript", text, final: true });
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  return { view, step, say };
}

const texts = () => h.sendCall.mock.calls.map(([t]) => t);

describe("useLiveCall — the read-along gate (§4.5)", () => {
  it("arms the override OPEN when nothing was streaming at call start", async () => {
    await call();
    expect(h.setCallVoice).toHaveBeenCalledWith(true, false);
  });

  it("arms it SHUT when a turn was already streaming, and opens it on that turn's settle", async () => {
    h.liveTurn = { threadId: "t1", turnId: "turn-1" };
    h.chat = { status: "streaming" };
    const { step } = await call();
    expect(h.setCallVoice).toHaveBeenCalledWith(true, true);
    expect(h.openGate).not.toHaveBeenCalled();

    // The pre-call turn settles — the one edge no message RENAME can move.
    await step(() => {
      h.chat = { status: "idle" };
      h.liveTurn = null;
    });
    expect(h.openGate).toHaveBeenCalled();
  });
});

describe("useLiveCall — the mouth, watched", () => {
  it("a mid-reply synthesis GAP is not the reply ending", async () => {
    const { step, say } = await call();
    await step(() => setPlay("playing"));
    await say("queue this");
    expect(texts()).toEqual([]); // held while the mouth is open

    await step(() => setPlay("loading")); // the read-along queue caught up mid-reply
    expect(texts()).toEqual([]); // …which is NOT a drain: nothing goes out yet
    await step(() => setPlay("playing")); // the next chunk lands
    expect(texts()).toEqual([]);

    await step(() => setPlay("paused")); // NOW the reply is over
    expect(texts()).toEqual(["queue this"]);
  });

  it("…and a reply that ENDS inside such a gap still drains", async () => {
    const { step, say } = await call();
    await step(() => setPlay("playing"));
    await say("after you");
    await step(() => setPlay("loading"));
    await step(() => setPlay("paused")); // the flush found nothing left to speak
    expect(texts()).toEqual(["after you"]);
  });

  it("an explicit mouth FAILURE tick says so — the transport alone cannot", async () => {
    const { view, step, say } = await call();
    await say("say something");
    await step(() => setPlay("playing"));
    expect(view.result.current.phase).toBe("speaking");

    // A rejected play() publishes "paused" — an ordinary-looking transition. The counter is the signal.
    await step(() => {
      setPlay("paused");
      h.failures = 1;
    });
    expect(view.result.current.phase).toBe("listening");
    expect(view.result.current.note).toBe("voice failed — the reply is text only");
  });
});

describe("useLiveCall — the held-upload retry latch (§4.5)", () => {
  it("re-arms per HOLD: a SECOND held upload in one call is released too", async () => {
    h.sendCall.mockImplementation(async (text: string) =>
      h.sendCall.mock.calls.filter(([t]) => t === text).length === 1 ? "held" : "accepted",
    );
    const { say } = await call();

    // Each utterance is HELD on its first attempt; the settled upload retries it once.
    await say("look at this");
    expect(texts()).toEqual(["look at this", "look at this"]);

    await say("and this one");
    // Without the per-hold re-arm the latch is spent and this second utterance wedges the queue until
    // hang-up — every later one piling up behind it.
    expect(texts()).toEqual(["look at this", "look at this", "and this one", "and this one"]);
  });

  it("holds while the upload is genuinely in flight, and retries ONCE when it settles", async () => {
    h.staged = [{ status: "uploading" }];
    h.sendCall.mockResolvedValueOnce("held").mockResolvedValue("accepted");
    const { step, say } = await call();

    await say("with the file");
    expect(texts()).toEqual(["with the file"]);
    await step(() => {}); // still uploading: no retry
    expect(texts()).toEqual(["with the file"]);

    await step(() => (h.staged = []));
    expect(texts()).toEqual(["with the file", "with the file"]);
    await step(() => (h.staged = [{ status: "uploading" }]));
    await step(() => (h.staged = []));
    expect(texts()).toHaveLength(2); // the hold is over — a second settle retries nothing
  });
});

describe("useLiveCall — the degraded note's hold (S2b)", () => {
  it("stands, re-arms on a second burst, and clears itself when the link stays quiet", async () => {
    vi.useFakeTimers();
    try {
      const { view, step } = await call();
      await step(() => h.frame?.({ type: "state", state: "degraded" }));
      expect(view.result.current.note).toBe("connection strained");

      // Not yet: the relay emits one frame per overflow BURST, so the note has to outlive a gap
      // between bursts or it would flicker on a link that is genuinely struggling.
      await step(() => vi.advanceTimersByTime(5000));
      expect(view.result.current.note).toBe("connection strained");
      // A second burst RE-ARMS rather than accumulating…
      await step(() => h.frame?.({ type: "state", state: "degraded" }));
      await step(() => vi.advanceTimersByTime(5000));
      expect(view.result.current.note).toBe("connection strained");

      // …and past the full hold with nothing more arriving, the note goes: the relay never says
      // "recovered", so this timer is the only thing that can stop the screen claiming otherwise.
      await step(() => vi.advanceTimersByTime(2000));
      expect(view.result.current.note).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is torn down with the call — a hold cannot outlive the machine that armed it", async () => {
    vi.useFakeTimers();
    try {
      const { view, step } = await call();
      await step(() => h.frame?.({ type: "state", state: "degraded" }));
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      view.unmount();
      // The teardown releases EVERYTHING (§6) — a hold armed by a call that is over has nothing left
      // to be honest about, and a timer outliving its machine is how a stale note reaches the next one.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useLiveCall — mute (§6)", () => {
  it("flips the live TRACK and the machine together, and back", async () => {
    const { view, step } = await call();
    expect(view.result.current.muted).toBe(false);

    await step(() => view.result.current.toggleMute());
    expect(h.setMuted).toHaveBeenLastCalledWith(true);
    expect(view.result.current.muted).toBe(true);

    await step(() => view.result.current.toggleMute());
    expect(h.setMuted).toHaveBeenLastCalledWith(false);
    expect(view.result.current.muted).toBe(false);
  });

  it("a final heard while muted never reaches the chat door", async () => {
    const { view, step, say } = await call();
    await step(() => view.result.current.toggleMute());
    await say("the doorbell, not you");
    expect(texts()).toEqual([]);
  });

  it("a mute tapped DURING acquisition reaches the track the moment it exists (S2b confirm F1)", async () => {
    // The rule flips while `getUserMedia` is still pending — there is no track to disable yet, so the
    // install must apply the machine's answer, or audio flows to the relay under a screen saying Muted.
    let open = (): void => {};
    h.capGate = new Promise<void>((r) => {
      open = r;
    });
    const view = renderHook(() => useLiveCall());
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      view.result.current.toggleMute();
    });
    expect(h.setMuted).not.toHaveBeenCalled(); // nothing to mute yet — the tell that the gap is real
    await act(async () => {
      open();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.setMuted).toHaveBeenCalledWith(true);
  });
});

describe("useLiveCall — the Fennec EAR-HOLD, applied to the track (S3 · §5.1)", () => {
  /** A browser whose AEC has no string modes and does not subtract the page's own playback. */
  const fennec = () => {
    h.fennec = true;
  };

  it("resolves the mode ONCE from the TRACK — `auto` holds where the readback is not `all`", async () => {
    fennec();
    const { view, step, say } = await call();
    expect(h.setHeld).toHaveBeenLastCalledWith(false); // nothing is speaking yet
    await step(() => setPlay("playing"));
    expect(h.setHeld).toHaveBeenLastCalledWith(true); // the reply is audible ⇒ the ear closes

    // …and what the ear still delivers from that stretch is the phone hearing ITSELF.
    await say("and then the dragon said");
    expect(texts()).toEqual([]);
    expect(view.result.current.heard).toBe("");

    await step(() => setPlay("paused")); // the reply ends…
    expect(h.setHeld).toHaveBeenLastCalledWith(false);
    await say("what happened next");
    expect(texts()).toEqual(["what happened next"]); // …and the ear is the owner's again
  });

  it("a SUBTRACTIVE track holds nothing — the ear stays open under the reply", async () => {
    const { step, say } = await call(); // `echoCancellation: "all"` by default
    await step(() => setPlay("playing"));
    expect(h.setHeld).not.toHaveBeenCalledWith(true);
    await say("wait, stop"); // walkie-talkie: it queues, and drains when the reply ends
    await step(() => setPlay("paused"));
    expect(texts()).toEqual(["wait, stop"]);
  });

  it("`on` and `off` are the owner's override of that reading, not a second reading", async () => {
    h.voice.data.live_call.echo_workaround = "on";
    const forced = await call(); // …on a track that reads `all` and would otherwise hold nothing
    await forced.step(() => setPlay("playing"));
    expect(h.setHeld).toHaveBeenLastCalledWith(true);
    forced.view.unmount();

    h.setHeld.mockClear();
    h.play = { status: "idle" };
    h.voice.data.live_call.echo_workaround = "off";
    fennec();
    const never = await call();
    await never.step(() => setPlay("playing"));
    expect(h.setHeld).not.toHaveBeenCalledWith(true);
  });

  it("reaches the track BEFORE the leg opens — a rule applied a render late is a leak", async () => {
    // The S2b confirm-F1 lesson, in the other direction: the hold can be TRUE the moment the capture
    // exists (a reply was already audible while `getUserMedia` was pending), and the uplink starts
    // flowing as soon as the socket opens in the very same continuation. An install that left the hold
    // to the next render would ship exactly that stretch of leaked reply to the ear.
    fennec();
    h.play = { status: "playing" }; // the mouth is already open when the machine mounts
    let open = (): void => {};
    h.capGate = new Promise<void>((r) => {
      open = r;
    });
    const view = renderHook(() => useLiveCall());
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.order).toEqual([]); // no track, no leg — the acquisition gap is real
    await act(async () => {
      open();
      await Promise.resolve();
      await Promise.resolve();
    });
    // The install applied it first; the effect's own (idempotent) apply trails behind, which is exactly
    // the render the track must not have spent open.
    expect(h.order.slice(0, 2)).toEqual(["held:true", "socket"]);
    view.unmount();
  });

  it("registers the PRE-PLAY tap on a held-mode track, and the teardown clears it (confirm F2)", async () => {
    // The tap is what closes the ear BEFORE the mouth asks the element to play — the subscription
    // below is the reducer's answer catching up, not the thing standing between output and the mic.
    fennec();
    const { view } = await call();
    expect(h.prePlay).not.toBeNull();
    h.setHeld.mockClear();
    h.prePlay?.();
    expect(h.setHeld).toHaveBeenCalledWith(true); // a bare "close now"
    view.unmount();
    expect(h.prePlay).toBeNull(); // the tap dies with the capture it closes over
  });

  it("a SUBTRACTIVE track registers no tap — its ear never closes", async () => {
    const { view } = await call(); // `echoCancellation: "all"` by default
    expect(h.prePlay).toBeNull();
    view.unmount();
  });

  it("HEADPHONES resolve `auto` OFF on a leaking track — there is no path to leak down", async () => {
    // Maya F1's first half. The `"all"` readback is a statement about how much of the page's own
    // output the canceller subtracts from the mic; headphones have no acoustic path to carry any of
    // it, so the readback stops being the question. The Fennec track — the one that ALWAYS holds on
    // the speaker route — is deliberately the one used here.
    h.voice.data.live_call.route = "headphones";
    fennec();
    const { step } = await call();
    expect(h.capOpts?.route).toBe("headphones"); // …and the route reached the capture, not just the rule
    await step(() => setPlay("playing"));
    expect(h.setHeld).not.toHaveBeenCalledWith(true);
    expect(h.prePlay).toBeNull(); // no hold mode ⇒ nothing to tap the mouth with
  });

  it("…but an EXPLICIT `on` still outranks the route — it moves what `auto` means, no more", async () => {
    h.voice.data.live_call.route = "headphones";
    h.voice.data.live_call.echo_workaround = "on";
    const { step } = await call();
    await step(() => setPlay("playing"));
    expect(h.setHeld).toHaveBeenLastCalledWith(true);
  });

  it("…and an EXPLICIT `off` outranks the SPEAKER route's leaking track the same way (S5 review)", async () => {
    // The symmetric half of the override pin, on the route where `auto` would have held: the owner
    // who says `off` has answered the leak question themselves, and the route must not re-ask it.
    h.voice.data.live_call.route = "speaker";
    h.voice.data.live_call.echo_workaround = "off";
    fennec();
    const { step } = await call();
    await step(() => setPlay("playing"));
    expect(h.setHeld).not.toHaveBeenCalledWith(true);
  });

  it("the ENGAGE is synchronous with the play edge — before React renders (review F2)", async () => {
    // The physics the subscription exists for: the controller's `emit` runs inside the media `play`
    // handler's own `set()`, and the hold must reach `track.enabled` in that SAME task — a hold that
    // waits for a render lets the reply's first frames into the mic (and, on a short reply, their
    // transcript back in through a reopened ear). So the assertion sits INSIDE the synchronous
    // window: the listeners have fired and nothing has rendered or flushed an effect yet.
    fennec();
    await call();
    h.setHeld.mockClear();
    act(() => {
      setPlay("playing");
      expect(h.setHeld).toHaveBeenCalledWith(true); // same task — no render happened yet
    });
  });
});

describe("useLiveCall — THE UPLINK PACER (A-F2, evidence docs/research/R71)", () => {
  /** One worklet frame, identified by its first byte so a case can pin ORDER, not just a count. */
  const frame = (n: number, rms = 0): { buf: ArrayBuffer; rms: number } => {
    const buf = new ArrayBuffer(8);
    new Uint8Array(buf)[0] = n;
    return { buf, rms };
  };

  /** `n` frames delivered in ONE dispatch, carrying no wall clock at all — the queued MessagePort
   *  deliveries a stalled main thread releases in a single tick, which is the whole hazard. */
  const burst = async (from: number, n: number, rms = 0): Promise<void> => {
    await act(async () => {
      for (let i = 0; i < n; i++) h.mic?.(frame(from + i, rms));
      await Promise.resolve();
    });
  };

  it("bounds a post-stall dispatch instead of firing it at the relay in one tick", async () => {
    vi.useFakeTimers();
    try {
      const { view } = await call();
      // Five seconds of stall: the bucket banks its CAP (500 ms) and not a millisecond more…
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      // …and 125 frames (2.5 s of audio at 20 ms) arrive at once. Shipped raw, that is a rolling window
      // far past the relay's 2×-realtime budget — `error{code:"protocol"}` + close 1008, a call that
      // simply ends mid-sentence with no reconnect.
      await burst(1, 125);
      expect(h.audio).toHaveLength(500 / 20); // the cap, exactly — 25 frames
      expect(h.audio[0]).toBe(1); // …from the head: order is the contract

      // What is over the bound is gone from the OLDEST end (the relay's own drop rule): the burst left
      // the last 50 frames queued (76…125), and the live frame 126 arriving pushed 76 out in its turn.
      // So the next thing the wire sees is 77 — the tail of what the owner said, never its stale head.
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      await burst(126, 1);
      expect(h.audio[25]).toBe(77);
      // …and the loss wears the SAME note the relay's own overflow does: one loss chain, one signal.
      expect(view.result.current.note).toBe("connection strained");
    } finally {
      vi.useRealTimers();
    }
  });

  it("raises that note ONCE per burst, the way the relay does", async () => {
    vi.useFakeTimers();
    try {
      const { view, step } = await call();
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      await burst(1, 125); // one overflow burst → one note
      expect(view.result.current.note).toBe("connection strained");
      // The note is held by a client timer (the relay never says "recovered"), and a link that stops
      // dropping lets it expire instead of standing for the rest of the call.
      await step(() => vi.advanceTimersByTime(7000));
      expect(view.result.current.note).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("TRIGGER A is measured on the CAPTURE, not on what the pacer found room for", async () => {
    // What the owner said is a fact about the microphone. A frame the bound dropped is one the ear will
    // never transcribe — but it is still speech over an audible reply, and it must still count toward
    // the interrupt, or a stalled phone would be exactly when tap-to-interrupt stops being optional.
    vi.useFakeTimers();
    try {
      h.voice.data.live_call.barge_threshold = 0.01;
      const { step } = await call(); // the default track reads `echoCancellation: "all"` ⇒ armed
      await step(() => setPlay("playing")); // there is now something to interrupt
      h.dismiss.mockClear();
      // Fifteen frames = the configured 300 ms of sustained energy, delivered with NO clock behind
      // them: the bucket is empty, so not one of them reaches the wire.
      await burst(1, 15, 0.5);
      expect(h.audio).toEqual([]);
      expect(h.dismiss).toHaveBeenCalled(); // …and the kill fired anyway
    } finally {
      vi.useRealTimers();
    }
  });

  it("a fresh leg gets a fresh pacer — a reconnect inherits no stale audio", async () => {
    vi.useFakeTimers();
    try {
      await call();
      await burst(1, 40); // queued: nothing has been banked since the leg opened
      expect(h.audio).toEqual([]);
      // The leg drops and the ladder redials. §4.5 already declares the in-flight utterance lost, so
      // the queue that outlived its socket is stale speech by definition.
      await act(async () => {
        h.close?.();
        vi.advanceTimersByTime(400); // the first rung
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(5000); // a full bucket on the NEW leg
      });
      await burst(100, 1);
      expect(h.audio).toEqual([100]); // …and not one frame of the dead leg's backlog
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useLiveCall — THE ROUTE-RESOLVED CAPTURE POLICY (D73 S5 / Maya F1)", () => {
  /** Sustained speech over an audible reply: `min_speech_ms` worth of above-floor frames. */
  const shout = async (): Promise<void> => {
    const frame = (): { buf: ArrayBuffer; rms: number } => ({ buf: new ArrayBuffer(8), rms: 0.5 });
    await act(async () => {
      for (let i = 0; i < 15; i++) h.mic?.(frame()); // 15 × 20 ms = the configured 300 ms
      await Promise.resolve();
    });
  };

  /** Drive trigger A to the edge of a kill on a track whose AEC readback is NOT `"all"`. */
  const bargeOnFennec = async (route: string): Promise<void> => {
    h.voice.data.live_call.route = route;
    h.voice.data.live_call.barge_threshold = 0.01;
    h.fennec = true;
    const { step } = await call();
    await step(() => setPlay("playing"));
    h.dismiss.mockClear();
    await shout();
  };

  it("arms voice barge-in on HEADPHONES regardless of the AEC readback", async () => {
    // Maya F1's second half, and the reason the two halves are resolved together: with the ear held
    // open by the route, the interrupt must be armed by the route too — an install that read `"all"`
    // for this half would ship an open mic that voice can never interrupt through.
    vi.useFakeTimers();
    try {
      await bargeOnFennec("headphones");
      expect(h.dismiss).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("…and the SPEAKER route keeps the S0 readback rule exactly as it was", async () => {
    vi.useFakeTimers();
    try {
      await bargeOnFennec("speaker");
      expect(h.dismiss).not.toHaveBeenCalled(); // the tap is the interrupt there (§4.3 trigger B)
    } finally {
      vi.useRealTimers();
    }
  });

  it("`barge_in` off still holds everything — the route is not a second master switch", async () => {
    vi.useFakeTimers();
    try {
      h.voice.data.live_call.barge_in = false;
      await bargeOnFennec("headphones");
      expect(h.dismiss).not.toHaveBeenCalled();
    } finally {
      h.voice.data.live_call.barge_in = true;
      vi.useRealTimers();
    }
  });

  it("carries the picked device down, and SAYS SO when the default had to take the call", async () => {
    // R74 §2.2(b) — the Android failure is a null stream, so the capture retries without the device
    // and the call proceeds on the default route. What must not happen is that it proceeds silently.
    h.voice.data.live_call.input_device = "bt-headset";
    h.fellBack = true;
    const { view } = await call();
    expect(h.capOpts?.deviceId).toBe("bt-headset");
    expect(view.result.current.note).toBe(CALL_COPY.deviceFallback);
    expect(view.result.current.phase).toBe("listening"); // …and the call is up regardless
  });

  it("a capture that opened what it asked for says nothing", async () => {
    h.voice.data.live_call.input_device = "bt-headset";
    const { view } = await call();
    expect(view.result.current.note).toBeNull();
  });
});

describe("useLiveCall — the ear is TAKEN before it is opened (D74 S6 ⑧)", () => {
  it("stops a live dictation capture FIRST, and does not open its own until it lets go", async () => {
    // Overlapping captures pin the echo mode for each other (R78 §2.3): a call opening beside a live
    // dictation gets whatever dictation asked for, and reports it honestly — which is the worst
    // shape of this bug, because the readback is then right about the wrong thing.
    const order: string[] = [];
    let free!: () => void;
    setMicRelease(() => {
      order.push("dictation-stop");
      return new Promise<void>((res) => {
        free = () => {
          order.push("dictation-free");
          res();
        };
      });
    });

    const view = renderHook(() => useLiveCall());
    await act(async () => {
      await Promise.resolve();
    });
    expect(order).toEqual(["dictation-stop"]);
    expect(h.capOpts).toBeNull(); // …and the call's own capture has NOT been asked for

    await act(async () => {
      free();
      await Promise.resolve();
    });
    expect(order).toEqual(["dictation-stop", "dictation-free"]);
    expect(h.capOpts).not.toBeNull();
    view.unmount();
  });
});

describe("useLiveCall — TRIGGER A's m-of-n window (D74 S4 ⑥)", () => {
  const frame = (rms: number): { buf: ArrayBuffer; rms: number } => ({
    buf: new ArrayBuffer(8),
    rms,
  });
  const speak = async (pattern: number[]): Promise<void> => {
    await act(async () => {
      for (const rms of pattern) h.mic?.(frame(rms));
      await Promise.resolve();
    });
  };
  const loud = (n: number): number[] => Array.from({ length: n }, () => 0.5);

  /** A call with the floor calibrated and a reply audible — the only state trigger A measures in. */
  const overAReply = async () => {
    h.voice.data.live_call.barge_threshold = 0.01;
    const c = await call();
    await c.step(() => setPlay("playing"));
    h.dismiss.mockClear();
    return c;
  };

  it("survives the holes inside a spoken word — a consecutive run could not", async () => {
    // 15 frames = the configured 300 ms window at 20 ms, with ONE under the floor where a stop
    // consonant or a breath lands. The old rule zeroed the clock there and demanded 15 more unbroken
    // frames, which is why a real interruption could be held down by its own consonants.
    await overAReply();
    await speak([...loud(7), 0.001, ...loud(7)]);
    expect(h.dismiss).toHaveBeenCalled();
  });

  it("…but a window that is mostly silence still does nothing", async () => {
    // The floor's whole job: a cough, a door, one loud syllable in a quiet room must not kill a reply.
    await overAReply();
    await speak(Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 0.5 : 0.001)));
    expect(h.dismiss).not.toHaveBeenCalled();
  });

  it("tolerates the floor's full share of holes — 11 of 15 fires (code round F1)", async () => {
    // floor(15 × 0.75) = 11, and the rounding is the finding: ceil demanded 12, which at small
    // windows walks all the way back to consecutive-frames — the exact brittleness this rule
    // replaced. Four holes in fifteen frames is a word's worth of stop consonants, not silence.
    await overAReply();
    await speak([...loud(3), 0.001, ...loud(3), 0.001, ...loud(3), 0.001, ...loud(2), 0.001]);
    expect(h.dismiss).toHaveBeenCalled();
  });

  it("CLEARS on the mouth's RISING EDGE — the reply's own start may not pre-fill it (review F3)", async () => {
    await overAReply();
    await speak(loud(10)); // one frame short of the 11 the window needs
    expect(h.dismiss).not.toHaveBeenCalled();
    // A read-along chunk boundary: the mouth pauses for synthesis and starts again. `mouthLive` never
    // went down, so nothing else clears the window — and without this rule the reply's own attack
    // transient would be counted as the owner interrupting.
    await act(async () => {
      setPlay("loading");
      setPlay("playing");
    });
    await speak(loud(1));
    expect(h.dismiss).not.toHaveBeenCalled();
    await speak(loud(11)); // …and a genuine interruption still lands
    expect(h.dismiss).toHaveBeenCalled();
  });
});

describe("useLiveCall — THE TRANSCRIPT GATE's epochs (D74 S5, evidence docs/research/R76)", () => {
  const mic = (rms: number, n: number): void => {
    for (let i = 0; i < n; i++) h.mic?.({ buf: new ArrayBuffer(8), rms });
  };

  /** A gated call: 200 ms of above-floor energy owed per utterance, with a real silence floor. */
  const gated = async () => {
    h.voice.data.live_call.min_final_ms = 200;
    h.voice.data.stt_auto_stop.threshold = 0.01; // the SILENCE floor — never the barge one
    return call();
  };

  /** One utterance, with `n` frames of `rms` between the ear's own start and stop. */
  const utterance = async (text: string, rms: number, n: number): Promise<void> => {
    await act(async () => {
      h.frame?.({ type: "speech_started" });
      mic(rms, n);
      h.frame?.({ type: "speech_stopped" });
      h.frame?.({ type: "transcript", text, final: true });
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it("DROPS a final the microphone cannot account for", async () => {
    const { view } = await gated();
    await utterance("Thank you for watching.", 0.001, 30); // 600 ms of near-silence
    expect(texts()).toEqual([]);
    expect(view.result.current.note).toBe(CALL_COPY.tooQuiet);
    expect(view.result.current.heard).toBe("");
  });

  it("…and takes one it CAN — the same 600 ms, actually spoken", async () => {
    const { view } = await gated();
    await utterance("what time is it", 0.2, 30);
    expect(texts()).toEqual(["what time is it"]);
    expect(view.result.current.note).toBeNull();
  });

  it("the epoch OPENS at speech-start: energy before it is not this utterance's", async () => {
    // Room noise while the reply was playing, a throat clear before the ear armed — none of it is
    // evidence that the sentence the relay just produced was said.
    const { view } = await gated();
    await act(async () => {
      mic(0.5, 50); // a full second of loud, BEFORE the ear said the owner started
      await Promise.resolve();
    });
    await utterance("mm-hmm", 0.001, 5);
    expect(texts()).toEqual([]);
    expect(view.result.current.note).toBe(CALL_COPY.tooQuiet);
  });

  it("a leg that DIED voids the evidence, and the gate then fails OPEN (review F2)", async () => {
    // Post-reconnect finals are not noise evidence: the accrual belonged to a session that is gone,
    // and absence of evidence must never cost the owner their words. Both edges clear it — the death
    // and the `ready` that follows — which is why neither of them needs the other to be right.
    const { view } = await gated();
    await act(async () => {
      h.frame?.({ type: "speech_started" });
      mic(0.5, 20);
    });
    await act(async () => {
      h.close?.(); // the link drops mid-utterance
    });
    await act(async () => {
      h.frame?.({ type: "state", state: "ready" }); // …and the ladder's leg comes up
      h.frame?.({ type: "transcript", text: "are you there", final: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(texts()).toEqual(["are you there"]);
    expect(view.result.current.note).not.toBe(CALL_COPY.tooQuiet);
  });

  it("a REFUSED route change voids nothing — the meter keys on ACCEPTED edges (code round F2)", async () => {
    // `setRoute` to the route the call is already on is a reducer no-op, and the meter must follow
    // the machine, not the signal: an edge that closed the epoch here turned a near-silent
    // hallucinated final into a fail-open PASS — no evidence beating bad evidence.
    const { view } = await gated();
    await act(async () => {
      h.frame?.({ type: "speech_started" });
      mic(0.001, 30); // 600 ms the microphone can NOT account for
      await Promise.resolve();
    });
    await act(async () => {
      view.result.current.setRoute("speaker"); // already the route — the reducer refuses it
    });
    await act(async () => {
      h.frame?.({ type: "speech_stopped" });
      h.frame?.({ type: "transcript", text: "Yeah.", final: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(texts()).toEqual([]); // the gate kept its evidence, and the evidence says no
    expect(view.result.current.note).toBe(CALL_COPY.tooQuiet);
  });
});

describe("useLiveCall — THE IN-CALL ROUTE CYCLE (D74 S2, evidence docs/research/R77 · R78 §8)", () => {
  /** Let the re-acquisition's promise chain settle — the capture resolves a microtask or two later,
   *  exactly as the mount path's does. */
  const settle = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it("closes the leg, RELEASES the old ear, and re-acquires under the new route", async () => {
    // In-place `applyConstraints` is refused by the platform on an AEC-using Android source (R78 §8),
    // so the only honest route change is a new track — and the old one must be gone before the new one
    // opens, or the two overlap and the loser pins the echo mode for both (R78 §2.3).
    const { view, step } = await call();
    expect(h.capOpts?.route).toBe("speaker");
    const closes = h.closes;

    await step(() => view.result.current.setRoute("headphones"));
    expect(view.result.current.phase).toBe("connecting"); // the screen says what is happening
    expect(h.closes).toBe(closes + 1);
    expect(h.capStops).toBe(1);

    await settle();
    expect(h.capOpts?.route).toBe("headphones");
    await act(async () => {
      h.frame?.({ type: "state", state: "ready" });
    });
    expect(view.result.current.phase).toBe("listening");
    expect(view.result.current.route).toBe("headphones");
  });

  it("the DEVICE half rides the same cycle, and the route it was on survives", async () => {
    const { view, step } = await call();
    await step(() => view.result.current.setInputDevice("bt-headset"));
    await settle();
    expect(h.capOpts).toEqual({ route: "speaker", deviceId: "bt-headset" });
    expect(view.result.current.inputDevice).toBe("bt-headset");
  });

  it("is refused while the leg is down — and says so through `canRoute`", async () => {
    const { view, step } = await call();
    await act(async () => {
      h.close?.(); // the link dropped: the ladder owns the phase now
    });
    expect(view.result.current.canRoute).toBe(false);
    await step(() => view.result.current.setRoute("headphones"));
    await settle();
    expect(h.capOpts?.route).toBe("speaker"); // …nothing re-acquired
    expect(h.capStops).toBe(0);
  });
});

describe("useLiveCall — StrictMode's simulated remount (S4's phone-round defect)", () => {
  it("setup → cleanup → setup still connects: the re-run must re-arm the machine", async () => {
    // React's dev-only StrictMode runs every effect's setup, cleanup, setup on the SAME instance —
    // state survives, only the effects re-run. The cleanup's `unmounted` deliberately lands the
    // machine terminal with the generation moved (the ghost fence), so the SETUP must be its
    // symmetric partner and re-arm from terminal, or every call on the Vite dev server dies at
    // birth: "Call ended", no note, and each "Call again" repeats it. The production build never
    // double-invokes and the e2e layer drives that build, which is exactly why only this wrapper
    // can pin the path.
    const view = renderHook(() => useLiveCall(), { wrapper: StrictMode });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      h.frame?.({ type: "state", state: "ready" });
    });
    expect(view.result.current.phase).toBe("listening");
  });
});

describe("useLiveCall — THE BACKGROUND WAVE (D73 S6, evidence docs/research/R75)", () => {
  /** A minimal Screen Wake Lock API — jsdom has none, which is also the degrade the code promises
   *  (feature-detected, never UA-sniffed). Every sentinel it hands out is remembered. */
  const locks: { released: boolean; release: () => Promise<void> }[] = [];
  const installWakeLock = (): void => {
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: () => {
          const lock = {
            released: false,
            release: async () => {
              lock.released = true;
            },
          };
          locks.push(lock);
          return Promise.resolve(lock);
        },
      },
    });
  };

  beforeEach(() => {
    locks.length = 0;
  });
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).wakeLock;
  });

  /** Hide the page and let the effects settle. */
  const hide = async () => {
    await act(async () => {
      visibility("hidden");
      await Promise.resolve();
    });
  };
  const show = async () => {
    await act(async () => {
      visibility("visible");
      await Promise.resolve();
    });
  };

  it("① a hidden page KEEPS the call — the old end was a policy, and this is its switch", async () => {
    const { view } = await call();
    await hide();
    expect(view.result.current.phase).toBe("listening"); // still up, still listening
    expect(h.endCall).not.toHaveBeenCalled();
    await show();
    expect(view.result.current.phase).toBe("listening");
  });

  it("…and with `background` OFF it ends cleanly, exactly as it always did", async () => {
    h.voice.data.live_call.background = false;
    const { view } = await call();
    await hide();
    expect(view.result.current.phase).toBe("ended");
    expect(h.endCall).toHaveBeenCalled();
  });

  it("① `pagehide` tears down whatever the knob says — the document is really dying (A7)", async () => {
    // Installed on its own for a reason: a closed tab can deliver `pagehide` with no visibility edge
    // in front of it, and a teardown that rode the policy branch would then never run at all.
    const { view } = await call();
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });
    expect(view.result.current.phase).toBe("ended");
  });

  it("③ the keepalive runs only while the page is away, and only when it is asked for", async () => {
    const { view } = await call();
    expect(h.keepalive).toEqual([]); // a visible page is audible on its own terms
    await hide();
    expect(h.keepalive).toEqual([true]);
    await show();
    expect(h.keepalive).toEqual([true, false]);
    view.unmount();

    h.keepalive = [];
    h.voice.data.live_call.background_keepalive = false;
    await call();
    await hide();
    expect(h.keepalive).toEqual([]); // …and the knob off means the freeze is simply accepted
  });

  it("③ …and a call backgrounded inside the ACQUISITION GAP still gets one", async () => {
    // The S2b confirm-F1 lesson again: the only thing that starts the keepalive is a hidden edge, and
    // this call's has already passed by the time there is a graph to start it on. Without the install
    // applying the answer, the call would run with no keepalive and freeze ninety seconds later.
    let open = (): void => {};
    h.capGate = new Promise<void>((r) => {
      open = r;
    });
    renderHook(() => useLiveCall());
    await act(async () => {
      await Promise.resolve();
    });
    await hide();
    expect(h.keepalive).toEqual([]); // no graph yet — the tell that the gap is real
    await act(async () => {
      open();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.keepalive).toEqual([true]);
  });

  it("a capture resolving AFTER a terminal never opens a leg (S6 review F1)", async () => {
    // A close-class exit lands the machine terminal synchronously, but `disposed` waits for React's
    // unmount commit — a capture resolving inside that window used to install itself, dial a fresh
    // socket and re-write the busy marker on a call that was already over.
    let open = (): void => {};
    h.capGate = new Promise<void>((r) => {
      open = r;
    });
    renderHook(() => useLiveCall());
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      window.dispatchEvent(new Event("pagehide")); // the document dies while acquisition is pending
    });
    await act(async () => {
      open();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.order).not.toContain("socket"); // the dead call never dialled
  });

  it("a wake lock resolving for a PREVIOUS generation is released, never stored (S6 review F2)", async () => {
    // StrictMode's simulated remount is the real producer of this race: the first setup's request is
    // still pending when `unmounted` moves the generation, and a sentinel stored then would make the
    // re-take guard skip the acquisition the re-armed call actually needs.
    const pending: ((lock: { released: boolean; release: () => Promise<void> }) => void)[] = [];
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: () => new Promise((res) => pending.push(res)) },
    });
    renderHook(() => useLiveCall(), { wrapper: StrictMode });
    await act(async () => {
      await Promise.resolve();
    });
    expect(pending.length).toBeGreaterThan(0);
    const stale = {
      released: false,
      release: async () => {
        stale.released = true;
      },
    };
    await act(async () => {
      pending[0](stale); // the FIRST request belongs to the generation the cleanup moved past
      await Promise.resolve();
    });
    expect(stale.released).toBe(true);
  });

  it("⑤ the wake lock is RE-TAKEN on the way back — the platform released it when we hid", async () => {
    installWakeLock();
    await call();
    expect(locks).toHaveLength(1);
    // Android releases the sentinel the moment the page hides; today's single request at mount would
    // leave the returned call running without one.
    await hide();
    locks[0].released = true;
    await show();
    expect(locks).toHaveLength(2);
    expect(locks[1].released).toBe(false);
    // …and a lock still genuinely held is not re-requested.
    await show();
    expect(locks).toHaveLength(2);
  });

  it("② the ear-outage check: a gap past the threshold redials, a small one says nothing", async () => {
    const { view } = await call();
    await hide();
    // The frames never stopped — a hidden page that was merely throttled hears everything.
    h.earGap = 500;
    await show();
    expect(view.result.current.phase).toBe("listening");
    expect(view.result.current.note).toBeNull();

    // …and the freeze case: the graph was paused, so nothing was minted for the whole stretch.
    await hide();
    h.earGap = 90_000;
    const before = h.closes;
    await show();
    expect(view.result.current.phase).toBe("connecting");
    expect(view.result.current.note).toBe(CALL_COPY.earAsleep);
    expect(h.closes).toBe(before + 1); // the LEG is closed — and nothing else is driven from here
  });

  it("② …and the close is what redials: one outage spends ONE rung of the existing ladder", async () => {
    vi.useFakeTimers();
    try {
      const { view } = await call();
      await hide();
      h.earGap = 90_000;
      await show();
      // In a browser the close above IS this callback; here the case plays the socket's half.
      await act(async () => {
        h.close?.();
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(400); // the FIRST rung — the ladder kept its own accounting
        await Promise.resolve();
      });
      await act(async () => {
        h.frame?.({ type: "state", state: "ready" });
        await Promise.resolve();
      });
      expect(view.result.current.phase).toBe("listening");
      // The fresh leg retracts CONNECTION news; what the owner missed is not that, and stands.
      expect(view.result.current.note).toBe(CALL_COPY.earAsleep);
    } finally {
      vi.useRealTimers();
    }
  });

  it("② one outage, however many wake events arrive for it", async () => {
    const { view } = await call();
    await hide();
    h.earGap = 90_000;
    const before = h.closes;
    await act(async () => {
      visibility("visible");
      document.dispatchEvent(new Event("resume")); // the Lifecycle half of the same wake
      await Promise.resolve();
    });
    expect(view.result.current.phase).toBe("connecting");
    expect(h.closes).toBe(before + 1);
  });

  it("④ a backgrounded call that nobody is in ends itself — and says why", async () => {
    vi.useFakeTimers();
    try {
      const { view } = await call();
      await act(async () => {
        visibility("hidden");
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(599_000);
        await Promise.resolve();
      });
      expect(view.result.current.phase).toBe("listening"); // not yet — the window is the owner's
      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
      });
      expect(view.result.current.phase).toBe("ended");
      expect(view.result.current.note).toBe(CALL_COPY.idleBackground);
    } finally {
      vi.useRealTimers();
    }
  });

  it("④ …speech RE-ARMS it, a confirm gate PAUSES it, and coming back clears it", async () => {
    vi.useFakeTimers();
    try {
      const { view, step, say } = await call();
      await act(async () => {
        visibility("hidden");
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(500_000);
        await Promise.resolve();
      });
      await say("still here"); // the owner spoke into their pocket: the window starts over
      await act(async () => {
        vi.advanceTimersByTime(500_000);
        await Promise.resolve();
      });
      expect(view.result.current.phase).toBe("thinking");

      // An approval gate PAUSES the clock: ending the call while the owner is being asked something
      // destroys the interaction the `agent_input` notification just asked them for.
      await step(() => (h.confirm = true));
      await act(async () => {
        vi.advanceTimersByTime(3_600_000);
        await Promise.resolve();
      });
      expect(view.result.current.phase).toBe("thinking"); // an hour later, still waiting for them

      // …and coming back to the app takes the bound off entirely.
      await act(async () => {
        h.confirm = false;
        visibility("visible");
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(3_600_000);
        await Promise.resolve();
      });
      expect(view.result.current.phase).toBe("thinking");
    } finally {
      vi.useRealTimers();
    }
  });

  it("④ `background_idle_s: 0` is off, and so is a backend that never sent the knob", async () => {
    vi.useFakeTimers();
    try {
      h.voice.data.live_call.background_idle_s = 0;
      const { view } = await call();
      await act(async () => {
        visibility("hidden");
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(7_200_000);
        await Promise.resolve();
      });
      expect(view.result.current.phase).toBe("listening");
      view.unmount();

      // A pre-S6 backend sends nothing at all, which arrives as NaN — the one value that must not
      // become a `setTimeout(NaN)` firing on the next tick.
      (h.voice.data.live_call as { background_idle_s?: number }).background_idle_s = undefined;
      const older = await call();
      await act(async () => {
        visibility("hidden");
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
      });
      expect(older.view.result.current.phase).toBe("listening");
    } finally {
      h.voice.data.live_call.background_idle_s = 600;
      vi.useRealTimers();
    }
  });

  it("⑦ the tab's marker turns a first-dial `busy` into the ladder, and only then", async () => {
    // WITHOUT the marker — the shipped story, e2e-pinned: another device holds the call, terminal.
    const first = renderHook(() => useLiveCall());
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      h.frame?.({ type: "error", code: "busy", message: "a live call is already running" });
      await Promise.resolve();
    });
    expect(first.result.current.phase).toBe("error");
    expect(first.result.current.note).toBe(CALL_COPY.busy);
    first.unmount();

    // WITH it — a discarded tab coming back to the slot IT left behind (R75 §9.2). The teardown above
    // cleared the key, so the case seeds it the way a tab that never ran one leaves it.
    sessionStore.set("ctrlb-live-call", "1");
    const back = renderHook(() => useLiveCall());
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      h.frame?.({ type: "error", code: "busy", message: "a live call is already running" });
      await Promise.resolve();
    });
    expect(back.result.current.phase).toBe("connecting");
    expect(back.result.current.note).toBe(CALL_COPY.busyRetrying);
    back.unmount();
  });

  it("⑦ …the marker is written at the leg and cleared by the teardown", async () => {
    const { view } = await call();
    expect(sessionStore.get("ctrlb-live-call")).toBe("1");
    view.unmount();
    expect(sessionStore.has("ctrlb-live-call")).toBe(false);
  });
});

describe("useLiveCall — the speech-threshold redial (2026-09-22)", () => {
  it("every leg declares the knob's threshold; a `setVad` redial declares the override — same ear", () =>
    (async () => {
      const { view } = await call();
      expect(h.vadSent).toEqual([0.9]);
      await act(async () => {
        view.result.current.setVad(0.5);
        await Promise.resolve();
      });
      // A SECOND leg opened carrying the override — and the capture was never touched: this is a
      // redial, not the route cycle's recapture.
      expect(h.vadSent).toEqual([0.9, 0.5]);
      expect(h.capStops).toBe(0);
      await act(async () => {
        h.frame?.({ type: "state", state: "ready" });
      });
      expect(view.result.current.phase).toBe("listening");
      expect(view.result.current.vad).toBe(0.5);
      // (That a reconnect re-declares it follows from the same line the second leg just proved:
      // `openLeg` reads the LIVE state — and the override's survival across `socketLost` is pinned
      // in the reducer suite.)
      view.unmount();
    })());

  it("a mid-call Conf save moves NOTHING — the base is seeded at call start (§4.5, Maya F1)", async () => {
    const { view, step } = await call();
    expect(view.result.current.vad).toBe(0.9);
    // The owner saves voice.live.vad_threshold in Conf and /voice/status refetches: the SAME knobs
    // object the hook reads changes under it. Neither the pill nor a later leg may move.
    await step(() => {
      h.voice.data.live_call.vad_threshold = 0.5;
    });
    expect(view.result.current.vad).toBe(0.9);
    view.unmount();
  });

  it("a threshold redial CLEARS trigger A's window — old-floor hits cannot finish a kill (Maya F2)", async () => {
    h.voice.data.live_call.barge_threshold = 0.01;
    const { view, step } = await call(); // `all` readback ⇒ armed
    await step(() => setPlay("playing")); // something to interrupt, straight through the redial
    h.dismiss.mockClear();
    const loud = (n: number) => {
      for (let i = 0; i < n; i++) h.mic?.({ buf: new ArrayBuffer(8), rms: 0.5 });
    };
    // 8 above-floor frames: under the 11-of-15 bar, so nothing fires yet…
    await act(async () => {
      loud(8);
    });
    expect(h.dismiss).not.toHaveBeenCalled();
    await act(async () => {
      view.result.current.setVad(0.5);
      await Promise.resolve();
    });
    // …and the ear keeps delivering across the leg swap. WITHOUT the meter edge these 5 land on the
    // old 8 (13 ≥ 11) and a ghost kill fires off hits judged by the floor the owner just left.
    await act(async () => {
      loud(5);
    });
    expect(h.dismiss).not.toHaveBeenCalled();
    view.unmount();
  });
});

describe("useLiveCall — the unmount fence (S2b audit)", () => {
  it("a final already in flight when the component unmounts never submits", async () => {
    // The shell's `endCall` exit (and a redial's key bump) unmount the machine WITHOUT a hang-up
    // signal — and `close()` only starts the socket's handshake, so a frame dispatched before it can
    // still be delivered after the cleanup ran. The cleanup's `unmounted` signal moves the generation
    // first, which is the only thing standing between that frame and a §4.3-violating submit.
    const { view } = await call();
    view.unmount();
    await act(async () => {
      h.frame?.({ type: "speech_started" });
      h.frame?.({ type: "speech_stopped" });
      h.frame?.({ type: "transcript", text: "after the door closed", final: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(texts()).toEqual([]);
  });
});
