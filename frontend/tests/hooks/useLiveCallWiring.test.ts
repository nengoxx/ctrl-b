import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
        min_speech_ms: 300,
        barge_threshold: 0,
        barge_in: true,
        ring: "none",
        echo_workaround: "auto",
        max_session_s: 600,
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
  /** The acquisition TIMELINE, in order: what reached the track, and when the leg opened. The ear-hold's
   *  whole assertion is an ORDERING — a rule that reaches the track one render late is a rule that was
   *  not applied while the first frames went out. */
  order: [] as string[],
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
  /** Is the opened track a boolean-only AEC (Fennec: `getSettings().echoCancellation === true`, and no
   *  string modes at all) rather than Chromium's subtractive `"all"`? The ONE input to both the
   *  trigger-A arming and the S3 ear-hold decision. */
  fennec: false,
  /** Holds `startPcmCapture` open when an arm needs the acquisition GAP itself. */
  capGate: Promise.resolve(),
}));

vi.mock("../../src/lib/audioController", () => ({
  dismiss: h.dismiss,
  openCallVoiceGate: h.openGate,
  setCallVoice: h.setCallVoice,
  useMouthFailures: () => h.failures,
  getPlayStatus: () => h.play.status,
  subscribePlayback: (cb: () => void) => {
    h.playbackSubs.add(cb);
    return () => h.playbackSubs.delete(cb);
  },
}));
vi.mock("../../src/lib/composer", () => ({ sendCallTranscript: h.sendCall }));
vi.mock("../../src/lib/liveSocket", () => ({
  liveSocketUrl: () => "ws://x/api/voice/live",
  openLiveSocket: (opts: { onFrame: (f: LiveDown) => void }) => {
    h.frame = opts.onFrame;
    h.order.push("socket");
    return {
      sendAudio: () => {},
      flush: () => {},
      stop: () => {},
      close: () => {},
      unknown: () => 0,
    };
  },
}));
vi.mock("../../src/lib/pcmCapture", () => ({
  startPcmCapture: async () => {
    await h.capGate; // resolved by default; an arm swaps in a deferred to hold acquisition open
    return {
      sampleRate: 48000,
      echoCancellation: h.fennec ? true : "all",
      setMuted: h.setMuted,
      setHeld: h.setHeld,
      stop: () => {},
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

import { useLiveCall } from "../../src/hooks/useLiveCall";

/** Move the playback status the way the real store does: write, then tell the listeners — in the same
 *  task, which is the whole S3 contract the wiring now rides (see the sync-hold suite). */
const setPlay = (status: string): void => {
  h.play = { status };
  for (const cb of h.playbackSubs) cb();
};

beforeEach(() => {
  h.play = { status: "idle" };
  h.playbackSubs.clear();
  h.chat = { status: "idle" };
  h.confirm = false;
  h.failures = 0;
  h.staged = [];
  h.liveTurn = null;
  h.frame = null;
  h.order = [];
  h.fennec = false;
  h.voice.data.live_call.echo_workaround = "auto";
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
    expect(view.result.current.note).toBe("voice failed — the reply is in the chat");
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
