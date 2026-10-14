import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage, Part } from "../../src/types";

// hooks/useAutoTts — auto read-aloud's FEEDER (C3 S2). The hook is deliberately thin: four gates, the
// un-fed-suffix boundary test, the per-turn "the user stopped it" latch, and ONE turn-end entry point.
// Everything it decides is expressed as a call to the controller, so the controller is mocked and the
// assertions are on those calls. The queue mechanics themselves live in tests/lib/audioController.
//
// Its inputs are four hooks, all mocked to read module state the tests drive: the chat store (a new
// `messages` array per delta, exactly like the real store), the auto-TTS switch, the voice probe (which
// carries the chunk policy), and the docked message id (the only signal that says "the user stopped").

type Status = "idle" | "streaming" | "error";
interface VoiceProbe {
  tts?: boolean;
  tts_chunking?: { mode: "off" | "paragraph" | "sentence"; read_along: boolean };
  /** ISS-73 ① — the hidden-page hold's switch + bound; absent = an older backend = no hold. */
  tts_background?: { keepalive: boolean; idle_s: number };
}

const h = vi.hoisted(() => {
  // `foreignTurn` — the visible M11 attach's mark (owner ruling 2026-10-10): the other device's turn.
  const chat: { messages: ChatMessage[]; status: Status; foreignTurn: boolean } = {
    messages: [],
    status: "idle",
    foreignTurn: false,
  };
  const voice: VoiceProbe = {};
  const player: { id: string | null } = { id: null };
  return {
    chat,
    voice,
    player,
    ui: { ttsAuto: true },
    // D71 §4.5 — the CALL's read-along override, driven the way the real one is: ARMED plus a GATE
    // that stays shut while a pre-call turn is still streaming (the controller owns both; the hook
    // only ever reads the one composite answer).
    call: { active: false, waiting: false },
    feed: vi.fn(),
    endTurn: vi.fn(),
    dismiss: vi.fn(),
    /** The controller's turn-stop count (LIVE-001 — a call's stop bumps it). */
    stops: 0,
    // ISS-73 ① — the reply hold's seams on the controller: the hold itself, its progress feed, which
    // message's audio is still pending (`audioPending`), and the playback store's listeners (the hook
    // re-evaluates the hold on the mouth's status edges without a render).
    hold: vi.fn<(reason: string, on: boolean, idleS?: number) => void>(),
    touch: vi.fn(),
    pendingId: null as string | null,
    /** The message whose audio the controller reports STOPPED (`paused`: refused, or the owner's pause). */
    stoppedId: null as string | null,
    /** …and the one it reports `playing` (row 16: a platform pause Chrome resumed). */
    playingId: null as string | null,
    playbackSubs: [] as (() => void)[],
    /** The agent resolver, ONE stable function (the real one is memoized): `lynette` is the
     *  conversational agent here, every other turn (the default included) an `agent`-duties one. */
    art: (name: string | null) => ({ actions: name === "lynette" }),
    /** S11 (c) — THIS device's id (`lib/device`); `null` = storage refused one. */
    own: null as string | null,
  };
});

vi.mock("../../src/store/chat", () => ({ useChat: () => h.chat }));
vi.mock("../../src/store/ui", () => ({
  useUISlice: (sel: (s: { ttsAuto: boolean }) => unknown) => sel(h.ui),
}));
vi.mock("../../src/hooks/useVoiceStatus", () => ({ useVoiceStatus: () => ({ data: h.voice }) }));
// The one agent resolver (session-51 polish #6) — `h.art`, stable across renders like the real one.
vi.mock("../../src/hooks/useAgentArt", () => ({ useAgentArt: () => h.art }));
// S11 (c) — this device's id, driven per case; the shape check stays the real one.
vi.mock("../../src/lib/device", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/device")>()),
  deviceId: () => h.own,
}));
vi.mock("../../src/lib/audioController", () => ({
  feedReadAlong: h.feed,
  endTurnSpeak: h.endTurn,
  dismiss: h.dismiss,
  getTurnStops: () => h.stops,
  usePlayback: (sel: (p: { id: string | null }) => unknown) => sel(h.player),
  useCallVoice: () => h.call.active && !h.call.waiting,
  holdWhileHidden: h.hold,
  touchHoldProgress: h.touch,
  audioPending: (id: string) => h.pendingId === id,
  audioStopped: (id: string) => h.stoppedId === id,
  audioPlaying: (id: string) => h.playingId === id,
  subscribePlayback: (cb: () => void) => {
    h.playbackSubs.push(cb);
    return () => {
      h.playbackSubs = h.playbackSubs.filter((c) => c !== cb);
    };
  },
}));

import { useAutoTts } from "../../src/hooks/useAutoTts";

/** The speaker of a default turn: the global voice, and not conversational. */
const AGENT = { agent: null, actions: false };

function message(id: string, role: "user" | "assistant", parts: Part[]): ChatMessage {
  return {
    id,
    thread_id: "t1",
    role,
    parts,
    actor: role === "user" ? "user" : "agent",
    ts: "2026-09-04T00:00:00Z",
    tokens: null,
    compacted: false,
  };
}
const user = message("u1", "user", [{ type: "text", text: "hi" }]);
const said = (id: string, text: string): ChatMessage =>
  message(id, "assistant", [{ type: "text", text }]);
const thought = (id: string, text: string): ChatMessage =>
  message(id, "assistant", [{ type: "reasoning", text }]);

/** S11 (c) — the two devices: this one, and the desktop beside it. */
const OWN = "a".repeat(32);
const OTHER = "b".repeat(32);
/** A message stamped with the device that asked for it (the server's `message.start` / row `device`). */
const from = (device: string, m: ChatMessage): ChatMessage => ({ ...m, device });

/** Mount the hook the way the app does — before the turn starts, so the streaming EDGE is real. */
function mount() {
  const view = renderHook(() => useAutoTts());
  /** One store update: a fresh `messages` array (as every delta produces) + a status, then a render.
   *  `foreignTurn` = the store's flag for the turn (true only for a visible M11 attach). */
  return (status: Status, messages: ChatMessage[], foreignTurn = false) => {
    act(() => {
      h.chat = { messages, status, foreignTurn };
      view.rerender();
    });
  };
}

beforeEach(() => {
  h.chat = { messages: [], status: "idle", foreignTurn: false };
  h.ui = { ttsAuto: true };
  h.voice = { tts: true, tts_chunking: { mode: "sentence", read_along: true } };
  h.player.id = null;
  h.call = { active: false, waiting: false };
  h.feed.mockClear();
  h.endTurn.mockClear();
  h.dismiss.mockClear();
  h.stops = 0;
  h.pendingId = null;
  h.stoppedId = null;
  h.playingId = null;
  h.playbackSubs = [];
  h.own = OWN;
  setVisibility("visible");
});
// `globals: false` means RTL's auto-cleanup never registers: unmount each case's hook, or a previous
// case's visibility listener would answer this case's `visibilitychange` (ISS-73 ①).
afterEach(() => {
  cleanup();
  setVisibility("visible");
});

/** The page hiding / returning (ISS-73 ①). jsdom has no visibility model, so the property is redefined
 *  and the event dispatched by hand — exactly the pair a browser delivers (`useLiveCallWiring`'s). */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("useAutoTts — the read-along feed (C3 S2)", () => {
  it("waits for a boundary in the UN-FED suffix, then hands the whole markdown over", () => {
    const step = mount();
    step("streaming", [user, said("a1", "Sure thing")]);
    expect(h.feed).not.toHaveBeenCalled();

    step("streaming", [user, said("a1", "Sure thing.")]);
    expect(h.feed).toHaveBeenCalledExactlyOnceWith("a1", "Sure thing.", AGENT);

    // The suffix is what carries the boundary — text past the last feed with none in it is not a feed.
    step("streaming", [user, said("a1", "Sure thing. Let me")]);
    expect(h.feed).toHaveBeenCalledTimes(1);
    step("streaming", [user, said("a1", "Sure thing. Let me look.")]);
    expect(h.feed).toHaveBeenCalledTimes(2);
    expect(h.feed).toHaveBeenLastCalledWith("a1", "Sure thing. Let me look.", AGENT);
  });

  it("never feeds REASONING — only the message's text part is ever spoken", () => {
    const step = mount();
    step("streaming", [user, thought("a1", "Let me think about this. Right.")]);
    expect(h.feed).not.toHaveBeenCalled();

    // ...and the text part of the same message still feeds, without the reasoning riding along.
    step("streaming", [
      user,
      message("a1", "assistant", [
        { type: "reasoning", text: "Let me think about this. Right." },
        { type: "text", text: "Done." },
      ]),
    ]);
    expect(h.feed).toHaveBeenCalledExactlyOnceWith("a1", "Done.", AGENT);
  });

  it("feeds nothing when auto-TTS is muted", () => {
    h.ui = { ttsAuto: false };
    const step = mount();
    step("streaming", [user, said("a1", "Sure thing.")]);
    expect(h.feed).not.toHaveBeenCalled();
  });

  it("feeds nothing when TTS is not configured", () => {
    h.voice = { tts: false, tts_chunking: { mode: "sentence", read_along: true } };
    const step = mount();
    step("streaming", [user, said("a1", "Sure thing.")]);
    expect(h.feed).not.toHaveBeenCalled();
  });

  it("feeds nothing under `chunking: off` — the plan is one chunk, unknowable mid-stream", () => {
    h.voice = { tts: true, tts_chunking: { mode: "off", read_along: true } };
    const step = mount();
    step("streaming", [user, said("a1", "Sure thing.")]);
    expect(h.feed).not.toHaveBeenCalled();
  });

  it("feeds nothing with the owner's toggle off — and turn end still speaks the finished reply", () => {
    h.voice = { tts: true, tts_chunking: { mode: "sentence", read_along: false } };
    const step = mount();
    step("streaming", [user, said("a1", "Sure thing.")]);
    expect(h.feed).not.toHaveBeenCalled();
    step("idle", [user, said("a1", "Sure thing.")]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "Sure thing.", AGENT);
  });
});

describe("useAutoTts — the turn-end flush", () => {
  it("speaks a buffered turn (no deltas were ever fed) through the same entry point", () => {
    const step = mount();
    step("streaming", [user]); // D17: nothing streams, the reply lands whole at the end
    expect(h.feed).not.toHaveBeenCalled();
    step("idle", [user, said("a1", "The whole reply.")]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "The whole reply.", AGENT);
  });

  it("flushes a Stop mid-stream: what was generated is what gets read", () => {
    const step = mount();
    step("streaming", [user, said("a1", "Half a reply.")]);
    expect(h.feed).toHaveBeenCalledTimes(1);
    step("idle", [user, said("a1", "Half a reply. And a bi")]); // stopTurn settles on idle
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "Half a reply. And a bi", AGENT);
  });

  it("flushes an ERRORED turn exactly once — the `done(error)` behind it is not a second turn", () => {
    const step = mount();
    step("streaming", [user, said("a1", "Half a reply.")]);
    // `failStream` appends an error part to the same bubble and settles on "error" (never "idle").
    const failed = message("a1", "assistant", [
      { type: "text", text: "Half a reply." },
      { type: "error", message: "agent error", retryable: true },
    ]);
    step("error", [user, failed]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "Half a reply.", AGENT);
    step("error", [user, failed]); // the `done{state:"error"}` frame right behind it
    expect(h.endTurn).toHaveBeenCalledTimes(1);
  });

  it("flushes the session it OWNS when the turn's last message never became text-bearing", () => {
    const step = mount();
    step("streaming", [user, said("a1", "Let me check the fleet.")]);
    expect(h.feed).toHaveBeenCalledExactlyOnceWith("a1", "Let me check the fleet.", AGENT);
    // The tool step opens a second assistant message that only ever holds a tool_call — `finalReply`
    // reads null there, which would strand the preamble already being read aloud.
    const toolOnly = message("a2", "assistant", [
      { type: "tool_call", call_id: "c1", tool: "fleet", args: {}, state: "ok" },
    ]);
    step("idle", [user, said("a1", "Let me check the fleet."), toolOnly]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "Let me check the fleet.", AGENT);
  });

  // D70 §8.5 (ruling 21) — the turn's AGENT rides both entry points, so read-along and the turn-end
  // flush speak in that agent's voice; `null` (a default turn, every case above) omits the field. Its
  // duties ride beside it as `actions` (session-51 polish #6) — resolved by the one agent resolver.
  it("carries a specialist turn's speaker (agent + duties gate) through both the feed and the flush", () => {
    const spoken = message("a1", "assistant", [{ type: "text", text: "Sure thing." }]);
    spoken.agent = "lynette";
    const step = mount();
    step("streaming", [user, spoken]);
    expect(h.feed).toHaveBeenCalledExactlyOnceWith("a1", "Sure thing.", {
      agent: "lynette",
      actions: true,
    });
    step("idle", [user, spoken]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "Sure thing.", {
      agent: "lynette",
      actions: true,
    });
  });

  it("a later text-bearing message wins the flush (per-message superseding)", () => {
    const step = mount();
    step("streaming", [user, said("a1", "Let me check.")]);
    step("idle", [user, said("a1", "Let me check."), said("a2", "It is awake.")]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a2", "It is awake.", AGENT);
  });
});

describe("useAutoTts — the per-turn abandon latch", () => {
  it("stops feeding AND skips the flush once the user takes the player away", () => {
    const step = mount();
    step("streaming", [user, said("a1", "One sentence.")]);
    expect(h.feed).toHaveBeenCalledTimes(1);
    h.player.id = "a1"; // the queue docked our message
    step("streaming", [user, said("a1", "One sentence. Two")]);

    h.player.id = null; // ...and the user dismissed it (or muted, or tapped another bubble)
    step("streaming", [user, said("a1", "One sentence. Two sentences.")]);
    expect(h.feed).toHaveBeenCalledTimes(1); // nothing more is fed

    step("idle", [user, said("a1", "One sentence. Two sentences. Three.")]);
    expect(h.endTurn).not.toHaveBeenCalled(); // and the turn end does not restart it
  });

  it("a call's STOP mid-turn arms the same latch — nothing docked, no message id needed (LIVE-001)", () => {
    const step = mount();
    step("streaming", [user, said("a1", "Sure")]); // nothing closed yet, nothing ever docked
    h.stops += 1; // the call's `dismissTurn`
    step("streaming", [user, said("a1", "Sure. Let me look.")]);
    expect(h.feed).not.toHaveBeenCalled();
    step("idle", [user, said("a1", "Sure. Let me look.")]);
    expect(h.endTurn).not.toHaveBeenCalled();
    // …and only for THAT turn: the next one reads along again.
    step("streaming", [user, said("a2", "Here. Now.")]);
    expect(h.feed).toHaveBeenCalledExactlyOnceWith("a2", "Here. Now.", AGENT);
  });

  it("losing TTS mid-turn stops the open session instead of stranding it", () => {
    // The `ttsOk` gate skips the terminal flush as well as the feed, so without this the queue would
    // sit on the read-along latch showing "playing" forever (review MED-2).
    const step = mount();
    step("streaming", [user, said("a1", "One sentence.")]);
    h.player.id = "a1";
    step("streaming", [user, said("a1", "One sentence. Two sentences.")]);
    expect(h.feed).toHaveBeenCalledTimes(2);

    h.voice = { tts: false, tts_chunking: { mode: "sentence", read_along: true } };
    step("streaming", [user, said("a1", "One sentence. Two sentences. Three.")]);
    expect(h.dismiss).toHaveBeenCalledTimes(1);
    expect(h.feed).toHaveBeenCalledTimes(2); // nothing more is fed

    h.player.id = null; // the dismiss undocked it
    step("idle", [user, said("a1", "One sentence. Two sentences. Three.")]);
    expect(h.endTurn).not.toHaveBeenCalled(); // ...and the turn end does not try to speak it either
  });

  it("a pause (the player stays docked) is not an abandon", () => {
    const step = mount();
    step("streaming", [user, said("a1", "One sentence.")]);
    h.player.id = "a1";
    step("streaming", [user, said("a1", "One sentence. Two sentences.")]);
    expect(h.feed).toHaveBeenCalledTimes(2);
    step("idle", [user, said("a1", "One sentence. Two sentences.")]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "One sentence. Two sentences.", AGENT);
  });

  it("a FOREIGN turn (the visible M11 attach — `foreignTurn`) whose replies name NO device is silent: no feed, no flush; the NEXT turn speaks again", () => {
    // Owner ruling 2026-10-10: two devices side by side must not both speak the turn one of them sent.
    // S11 (c): these replies carry no device (an older server) — the UNKNOWN arm, where the flag decides.
    const step = mount();
    step("streaming", [user, said("d1", "From the desktop.")], true);
    step("streaming", [user, said("d1", "From the desktop. Still going.")], true);
    expect(h.feed).not.toHaveBeenCalled();
    step("idle", [user, said("d1", "From the desktop. Still going.")], true);
    expect(h.endTurn).not.toHaveBeenCalled();

    // …the owner's own next turn (the store resets the flag at its streaming edge) reads along again.
    const turn2 = [user, said("d1", "From the desktop. Still going."), user, said("a2", "Mine.")];
    step("streaming", turn2);
    expect(h.feed).toHaveBeenCalledExactlyOnceWith("a2", "Mine.", AGENT);
    step("idle", turn2);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a2", "Mine.", AGENT);
  });

  it("the latch is per TURN — the next turn reads along again", () => {
    const step = mount();
    step("streaming", [user, said("a1", "One.")]);
    h.player.id = "a1";
    step("streaming", [user, said("a1", "One. Two.")]);
    h.player.id = null;
    step("streaming", [user, said("a1", "One. Two. Three.")]);
    step("idle", [user, said("a1", "One. Two. Three.")]);
    expect(h.endTurn).not.toHaveBeenCalled();

    const turn2 = [user, said("a1", "One. Two. Three."), user, said("a2", "A new reply.")];
    step("streaming", turn2);
    expect(h.feed).toHaveBeenLastCalledWith("a2", "A new reply.", AGENT);
  });
});

describe("useAutoTts — the CALL's read-along override (D71 §4.5)", () => {
  it("speaks a call's turn with BOTH owner toggles off — the Conf rows are never written", () => {
    h.ui = { ttsAuto: false };
    h.voice = { tts: true, tts_chunking: { mode: "sentence", read_along: false } };
    h.call = { active: true, waiting: false };
    const step = mount();
    step("streaming", [user, said("a1", "On my way.")]);
    expect(h.feed).toHaveBeenCalledExactlyOnceWith("a1", "On my way.", AGENT);
    step("idle", [user, said("a1", "On my way.")]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "On my way.", AGENT);
  });

  it("does NOT pick up the turn that was already streaming — not even after it is RENAMED", () => {
    h.ui = { ttsAuto: false };
    h.call = { active: true, waiting: true }; // a turn was live when the call started
    const step = mount();
    step("streaming", [user, said("assist-1", "Half-read already.")]);
    expect(h.feed).not.toHaveBeenCalled();
    // `message.start` adoption renames the optimistic placeholder to the SERVER's id mid-stream. An
    // exclusion keyed to the id captured at call start stops matching right here and picks the reply
    // up half-way through; the gate is on the status timeline, which no rename can move.
    step("streaming", [user, said("m-real", "Half-read already. And more.")]);
    expect(h.feed).not.toHaveBeenCalled();
    step("idle", [user, said("m-real", "Half-read already. And more.")]);
    expect(h.endTurn).not.toHaveBeenCalled();
  });

  it("…and the NEXT turn, begun inside the call, is spoken once that settle opens the gate", () => {
    h.ui = { ttsAuto: false };
    h.call = { active: true, waiting: true };
    const step = mount();
    step("streaming", [user, said("m1", "Half-read already.")]);
    step("idle", [user, said("m1", "Half-read already.")]);
    h.call = { active: true, waiting: false }; // the machine opens it on exactly that edge
    const next = [user, said("m1", "Half-read already."), user, said("m2", "This one is yours.")];
    step("streaming", next);
    expect(h.feed).toHaveBeenCalledExactlyOnceWith("m2", "This one is yours.", AGENT);
  });

  it("the GATE never silences: with auto-TTS on and the gate shut, the feeder still feeds", () => {
    // The override only ever ADDS a voice — the FEEDER-level half of the ruling, tested in isolation.
    // In the real flow the call DOOR's one-time `dismiss()` at start silences the in-flight pre-call
    // reply and its undock arms `abandoned` (micro-confirm №2/№3); this arm pins that the gate itself
    // contributes no silencing on top of that.
    h.ui = { ttsAuto: true };
    h.call = { active: true, waiting: true };
    const step = mount();
    step("streaming", [user, said("m1", "Half-read already.")]);
    expect(h.feed).toHaveBeenCalledExactlyOnceWith("m1", "Half-read already.", AGENT);
    step("idle", [user, said("m1", "Half-read already.")]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("m1", "Half-read already.", AGENT);
  });

  it("with chunking OFF the reply still speaks — whole, at turn end (§4.5's stated fallback)", () => {
    h.ui = { ttsAuto: false };
    h.voice = { tts: true, tts_chunking: { mode: "off", read_along: false } };
    h.call = { active: true, waiting: false };
    const step = mount();
    step("streaming", [user, said("a1", "Nothing to split.")]);
    expect(h.feed).not.toHaveBeenCalled();
    step("idle", [user, said("a1", "Nothing to split.")]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "Nothing to split.", AGENT);
  });

  it("does not override TTS being unconfigured — there is no mouth to force on", () => {
    h.voice = { tts: false, tts_chunking: { mode: "sentence", read_along: true } };
    h.call = { active: true, waiting: false };
    const step = mount();
    step("streaming", [user, said("a1", "Silence.")]);
    step("idle", [user, said("a1", "Silence.")]);
    expect(h.feed).not.toHaveBeenCalled();
    expect(h.endTurn).not.toHaveBeenCalled();
  });

  it("the user taking the player away still stops the call's reply (the abandon latch holds)", () => {
    h.ui = { ttsAuto: false };
    h.call = { active: true, waiting: false };
    const step = mount();
    step("streaming", [user, said("a1", "One.")]);
    h.player.id = "a1";
    step("streaming", [user, said("a1", "One. Two.")]);
    h.player.id = null; // the call's own kill undocks it
    step("streaming", [user, said("a1", "One. Two. Three.")]);
    expect(h.feed).toHaveBeenCalledTimes(2);
    step("idle", [user, said("a1", "One. Two. Three.")]);
    expect(h.endTurn).not.toHaveBeenCalled();
  });
});

// --- ISS-73 ① — the reply hold: armed from the feeder's OWN eligibility (car-wave design §3.3) --------
// The hook decides "pending ∧ hidden ∧ eligible" and says so to the controller (`holdWhileHidden`), which
// owns the node, the context and the idle bound. So the assertions are on the LAST thing it said for the
// "reply" reason — re-assertion is idempotent at the controller, which only acts on an edge.

describe("useAutoTts — the reply hold (ISS-73 ①)", () => {
  const BG = { keepalive: true, idle_s: 600 };
  beforeEach(() => {
    h.voice = { ...h.voice, tts_background: BG };
    h.hold.mockClear();
    h.touch.mockClear();
  });
  /** What the hook last told the controller about its reason: true = held, false = released. */
  const held = (): boolean | undefined =>
    h.hold.mock.calls.filter((c) => c[0] === "reply").at(-1)?.[1];
  /** The mouth's status moved (the playback store emitted) — the hook re-evaluates without a render. */
  const mouthMoved = (): void => {
    act(() => {
      for (const cb of [...h.playbackSubs]) cb();
    });
  };

  it("hidden + streaming + eligible → HELD, with the knob's idle bound", () => {
    const step = mount();
    step("streaming", [user, said("a1", "Working on it")]);
    expect(held()).toBe(false); // in front: nothing to hold
    setVisibility("hidden");
    expect(held()).toBe(true);
    expect(h.hold).toHaveBeenLastCalledWith("reply", true, 600);
  });

  it("is never held while the page is VISIBLE, and the return releases it", () => {
    const step = mount();
    step("streaming", [user, said("a1", "One.")]);
    step("streaming", [user, said("a1", "One. Two.")]);
    expect(h.hold.mock.calls.some((c) => c[1] === true)).toBe(false);
    setVisibility("hidden");
    expect(held()).toBe(true);
    setVisibility("visible");
    expect(held()).toBe(false);
  });

  it("a FOREIGN turn (`foreignTurn`, device-less replies — the unknown arm) is never held", () => {
    setVisibility("hidden");
    const step = mount();
    step("streaming", [user, said("a1", "The other device's reply.")], true);
    step("idle", [user, said("a1", "The other device's reply.")], true);
    expect(h.hold.mock.calls.some((c) => c[1] === true)).toBe(false);
  });

  // (A LIVE CALL's exclusion lives in the CONTROLLER since the code round's row 6 — one place for both
  // reasons; pinned in `audioControllerCall.test.ts`, not here.)

  it("the owned reply REFUSED (or owner-paused) while the turn still streams releases it — and later frames do not re-arm it (row 2)", () => {
    setVisibility("hidden");
    const step = mount();
    step("streaming", [user, said("a1", "One.")]);
    h.pendingId = "a1";
    mouthMoved();
    expect(held()).toBe(true);
    h.pendingId = null;
    h.stoppedId = "a1"; // `play()` refused → the controller publishes `paused`
    mouthMoved();
    expect(held()).toBe(false);
    step("streaming", [user, said("a1", "One. Two.")]);
    step("streaming", [user, said("a1", "One. Two. Three.")]);
    expect(held()).toBe(false); // latched for the turn: the stream alone does not hold a stopped reply
    h.stoppedId = null;
    step("idle", [user, said("a1", "One. Two. Three.")]);
    step("streaming", [user, said("a1", "One. Two. Three."), user, said("a2", "Next")]);
    expect(held()).toBe(true); // …and only for that turn
  });

  it("auto-TTS muted → never held (the owner's 'unless auto-TTS is off')", () => {
    h.ui = { ttsAuto: false };
    setVisibility("hidden");
    const step = mount();
    step("streaming", [user, said("a1", "Quiet.")]);
    expect(h.hold.mock.calls.some((c) => c[1] === true)).toBe(false);
  });

  it("the knob ABSENT (an older backend) or OFF → never held", () => {
    setVisibility("hidden");
    h.voice = { tts: true, tts_chunking: { mode: "sentence", read_along: true } };
    const absent = mount();
    absent("streaming", [user, said("a1", "Old server.")]);
    expect(h.hold.mock.calls.some((c) => c[1] === true)).toBe(false);
    h.voice = { ...h.voice, tts_background: { keepalive: false, idle_s: 600 } };
    const off = mount();
    off("streaming", [user, said("a2", "Switch off.")]);
    expect(h.hold.mock.calls.some((c) => c[1] === true)).toBe(false);
  });

  it("a TEXTLESS end releases it — nothing was handed to the mouth", () => {
    setVisibility("hidden");
    const step = mount();
    step("streaming", [user, thought("a1", "Thinking it over.")]);
    expect(held()).toBe(true);
    step("idle", [user, thought("a1", "Thinking it over.")]);
    expect(h.endTurn).not.toHaveBeenCalled();
    expect(held()).toBe(false);
  });

  it("a user STOP mid-turn releases it (the abandon latch), and it stays released for the turn", () => {
    setVisibility("hidden");
    const step = mount();
    step("streaming", [user, said("a1", "One.")]);
    expect(held()).toBe(true);
    h.stops = 1; // the call's stop / `dismissTurn`
    step("streaming", [user, said("a1", "One. Two.")]);
    expect(held()).toBe(false);
  });

  it("holds THROUGH the turn end while the owned reply is pending, and releases at the CONTROLLER's end — not a chunk's", () => {
    setVisibility("hidden");
    const step = mount();
    step("streaming", [user, said("a1", "One.")]);
    expect(h.feed).toHaveBeenCalledTimes(1);
    h.pendingId = "a1"; // the read-along queue is loading/playing a1
    step("idle", [user, said("a1", "One. Two.")]);
    expect(h.endTurn).toHaveBeenCalledOnce();
    expect(held()).toBe(true); // the stream is over, the reply is not
    mouthMoved(); // a chunk seam: the controller is still `playing`/`loading` for a1
    expect(held()).toBe(true);
    h.pendingId = null; // the queue finished (parked → `paused`), or failed (`idle`)
    mouthMoved();
    expect(held()).toBe(false);
  });

  it("a buffered turn (no read-along) holds through its whole-reply synth and playback", () => {
    h.voice = { ...h.voice, tts_chunking: { mode: "off", read_along: false } };
    setVisibility("hidden");
    const step = mount();
    step("streaming", [user, said("a1", "All at once.")]);
    expect(held()).toBe(true);
    h.pendingId = "a1";
    step("idle", [user, said("a1", "All at once.")]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "All at once.", AGENT);
    expect(held()).toBe(true);
    h.pendingId = null;
    mouthMoved();
    expect(held()).toBe(false);
  });

  it("an OLDER reply still playing is not this turn's: a later textless turn does not hold for it", () => {
    setVisibility("hidden");
    const step = mount();
    step("streaming", [user, said("a1", "First.")]);
    h.pendingId = "a1";
    step("idle", [user, said("a1", "First.")]);
    expect(held()).toBe(true);
    step("streaming", [user, said("a1", "First."), user, thought("a2", "Hmm.")]);
    step("idle", [user, said("a1", "First."), user, thought("a2", "Hmm.")]);
    expect(held()).toBe(false); // a2 handed nothing over; a1 belongs to the previous turn
  });

  it("feeds the idle bound PROGRESS on each applied stream frame — and only on a frame", () => {
    const step = mount();
    step("streaming", [user, said("a1", "One")]);
    step("streaming", [user, said("a1", "One two")]);
    expect(h.touch).toHaveBeenCalledTimes(2);
    // a re-render that carries no new frame (the player docking) is not progress
    act(() => {
      h.player.id = "a1";
    });
    step("streaming", h.chat.messages);
    expect(h.touch).toHaveBeenCalledTimes(2);
    step("idle", h.chat.messages);
    expect(h.touch).toHaveBeenCalledTimes(2); // the end is not a frame of the stream
  });

  it("a turn it would NOT hold for feeds no progress — a foreign (unknown-arm) turn's frames cannot keep another reason's hold alive (row 13)", () => {
    const step = mount();
    step("streaming", [user, said("a1", "Theirs")], true);
    step("streaming", [user, said("a1", "Theirs, still")], true);
    expect(h.touch).not.toHaveBeenCalled();
    h.voice = { ...h.voice, tts_background: { keepalive: false, idle_s: 600 } };
    step("idle", [user, said("a1", "Theirs, still")], true);
    step("streaming", [user, said("a1", "Theirs, still"), user, said("a2", "Mine")]);
    step("streaming", [user, said("a1", "Theirs, still"), user, said("a2", "Mine, too")]);
    expect(h.touch).not.toHaveBeenCalled(); // the switch off: not this hook's hold either
  });

  it("a PLATFORM pause the browser resumes unlatches it — the reply playing again re-arms the hold (row 16)", () => {
    setVisibility("hidden");
    const step = mount();
    step("streaming", [user, said("a1", "One.")]);
    h.pendingId = h.playingId = "a1";
    mouthMoved();
    expect(held()).toBe(true);
    h.pendingId = h.playingId = null;
    h.stoppedId = "a1"; // audio focus lost (a nav prompt): the element's own `pause`
    mouthMoved();
    expect(held()).toBe(false); // latched, exactly like a refusal…
    step("streaming", [user, said("a1", "One. Two.")]);
    expect(held()).toBe(false);
    h.stoppedId = null;
    h.pendingId = h.playingId = "a1"; // …but focus came back and Chrome resumed it
    mouthMoved();
    expect(held()).toBe(true);
  });

  it("unmount releases the reason", () => {
    setVisibility("hidden");
    const view = renderHook(() => useAutoTts());
    act(() => {
      h.chat = { messages: [user, said("a1", "Going.")], status: "streaming", foreignTurn: false };
      view.rerender();
    });
    expect(held()).toBe(true);
    view.unmount();
    expect(held()).toBe(false);
    expect(h.playbackSubs).toHaveLength(0);
  });
});

// --- S11 (c) — WHOSE REPLY: only the device that started a turn auto-speaks it (owner ruling 2026-10-14) ---
// Each reply carries the device that asked for it; the hook judges the reply actually on screen, every
// pass. The cases above use device-less replies (the unknown arm — the S10-C01 behaviour, unchanged).

describe("useAutoTts — whose reply (S11 (c))", () => {
  const BG = { keepalive: true, idle_s: 600 };
  const held = (): boolean | undefined =>
    h.hold.mock.calls.filter((c) => c[0] === "reply").at(-1)?.[1];
  beforeEach(() => {
    h.hold.mockClear();
    h.touch.mockClear();
  });

  it("THIS device's reply is fed and flushed", () => {
    const step = mount();
    step("streaming", [user, from(OWN, said("a1", "Mine."))]);
    expect(h.feed).toHaveBeenCalledExactlyOnceWith("a1", "Mine.", AGENT);
    step("idle", [user, from(OWN, said("a1", "Mine. All of it"))]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "Mine. All of it", AGENT);
  });

  it("ANOTHER device's reply is silent — no feed, no flush, no hold, no hold progress", () => {
    h.voice = { ...h.voice, tts_background: BG };
    setVisibility("hidden");
    const step = mount();
    step("streaming", [user, from(OTHER, said("d1", "From the desktop."))]);
    step("streaming", [user, from(OTHER, said("d1", "From the desktop. Still going."))]);
    step("idle", [user, from(OTHER, said("d1", "From the desktop. Still going."))]);
    expect(h.feed).not.toHaveBeenCalled();
    expect(h.endTurn).not.toHaveBeenCalled();
    expect(h.hold.mock.calls.some((c) => c[1] === true)).toBe(false);
    expect(h.touch).not.toHaveBeenCalled();
  });

  it("a known device decides UNCONDITIONALLY: this device's reply under the M11 attach's `foreignTurn` still speaks (Sol H1)", () => {
    const step = mount();
    step("streaming", [user, from(OWN, said("a1", "Mine, re-attached."))], true);
    expect(h.feed).toHaveBeenCalledExactlyOnceWith("a1", "Mine, re-attached.", AGENT);
    step("idle", [user, from(OWN, said("a1", "Mine, re-attached."))], true);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "Mine, re-attached.", AGENT);
  });

  it("…and another device's reply is silent even with NO `foreignTurn` (the hidden page's return probe attaches loud)", () => {
    const step = mount();
    step("streaming", [user, from(OTHER, said("d1", "Theirs."))], false);
    step("idle", [user, from(OTHER, said("d1", "Theirs."))], false);
    expect(h.feed).not.toHaveBeenCalled();
    expect(h.endTurn).not.toHaveBeenCalled();
  });

  it("this device with NO id (storage refused) is the unknown arm for every reply — never 'every device is foreign' (v4.1 Sol 3b)", () => {
    h.own = null;
    const step = mount();
    step("streaming", [user, from(OTHER, said("d1", "Someone's."))]);
    expect(h.feed).toHaveBeenCalledExactlyOnceWith("d1", "Someone's.", AGENT);
    step("idle", [user, from(OTHER, said("d1", "Someone's."))]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("d1", "Someone's.", AGENT);
  });

  it("the LAST reply switching own → foreign mid-episode goes silent there, and the flush finishes the OWN reply with its CURRENT text (v4.1 Sol 3 ∥ Opus M1)", () => {
    const step = mount();
    step("streaming", [user, from(OWN, said("a1", "One."))]);
    expect(h.feed).toHaveBeenCalledExactlyOnceWith("a1", "One.", AGENT);
    // a dropped own stream's recovery hands the desktop's successor: it is now the last reply
    const a1 = from(OWN, said("a1", "One. And the tail"));
    step("streaming", [user, a1, from(OTHER, said("d2", "Theirs. Long."))]);
    step("streaming", [user, a1, from(OTHER, said("d2", "Theirs. Long. Longer."))]);
    expect(h.feed).toHaveBeenCalledTimes(1); // the foreign reply is never fed
    step("idle", [user, a1, from(OTHER, said("d2", "Theirs. Long. Longer."))]);
    // a1's read-along queue is CLOSED, with the text a1 has now — never d2
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "One. And the tail", AGENT);
  });

  it("…and foreign → own speaks: the reply that is this device's is fed and flushed", () => {
    const step = mount();
    const d1 = from(OTHER, said("d1", "Theirs."));
    step("streaming", [user, d1]);
    expect(h.feed).not.toHaveBeenCalled();
    step("streaming", [user, d1, from(OWN, said("a2", "Mine."))]);
    expect(h.feed).toHaveBeenCalledExactlyOnceWith("a2", "Mine.", AGENT);
    step("idle", [user, d1, from(OWN, said("a2", "Mine."))]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a2", "Mine.", AGENT);
  });

  it("a reload landing another device's COMPLETED reply under an own episode does not flush it", () => {
    const step = mount();
    step("streaming", [user, from(OWN, said("a1", "Part one."))]);
    // the episode's end re-reads the floor: the desktop's finished reply now sits last
    step("idle", [
      user,
      from(OWN, said("a1", "Part one. Part two")),
      from(OTHER, said("d9", "The desktop's whole reply.")),
    ]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "Part one. Part two", AGENT);
    expect(h.endTurn).not.toHaveBeenCalledWith("d9", expect.anything(), expect.anything());
  });

  it("a foreign turn still THINKING (no text yet) holds nothing and feeds no progress — ownership does not wait for text (v4.1 Sol 2 ∥ Opus M2)", () => {
    h.voice = { ...h.voice, tts_background: BG };
    setVisibility("hidden");
    const step = mount();
    step("streaming", [user, from(OTHER, thought("d1", "Hmm."))]); // the probe's attach: not `foreignTurn`
    step("streaming", [user, from(OTHER, thought("d1", "Hmm. Let me see."))]);
    expect(h.hold.mock.calls.some((c) => c[1] === true)).toBe(false);
    expect(h.touch).not.toHaveBeenCalled();
    // …while this device's own thinking turn IS held (the same shape, the other owner)
    step("idle", [user, from(OTHER, thought("d1", "Hmm. Let me see."))]);
    step("streaming", [
      user,
      from(OTHER, thought("d1", "Hmm. Let me see.")),
      user,
      from(OWN, thought("a2", "Mine.")),
    ]);
    expect(held()).toBe(true);
  });

  it("own audio PLAYING on a hidden page keeps the hold when a reload lands another device's finished turn under it (code round MED (a))", () => {
    h.voice = { ...h.voice, tts_background: BG };
    setVisibility("hidden");
    const step = mount();
    const a1 = from(OWN, said("a1", "Mine."));
    step("streaming", [user, a1]);
    h.pendingId = "a1"; // a1's read-along is loading/playing
    step("idle", [user, a1]);
    expect(held()).toBe(true);
    // the floor re-read lands the desktop's whole turn after a1 — still a1's audio pending
    step("idle", [user, a1, user, from(OTHER, said("d9", "The desktop's reply."))]);
    expect(held()).toBe(true);
    h.pendingId = null; // …until a1's audio ends
    step("idle", [user, a1, user, from(OTHER, said("d9", "The desktop's reply."))]);
    expect(held()).toBe(false);
  });

  it("own stream DROPS while hidden and the recovery hands the other device's successor: a1's pending chunks keep the hold, the foreign frames feed no progress (code round MED (b))", () => {
    h.voice = { ...h.voice, tts_background: BG };
    setVisibility("hidden");
    const step = mount();
    const a1 = from(OWN, said("a1", "One."));
    step("streaming", [user, a1]);
    h.pendingId = "a1";
    expect(held()).toBe(true);
    h.touch.mockClear();
    step("streaming", [user, a1, from(OTHER, thought("d2", "Hmm."))]);
    step("streaming", [user, a1, from(OTHER, said("d2", "Theirs."))]);
    expect(held()).toBe(true); // a1's chunks are still pending
    expect(h.touch).not.toHaveBeenCalled(); // the foreign stream's frames are never progress
    h.pendingId = null; // a1 finished: the foreign stream alone does not hold the page
    step("streaming", [user, a1, from(OTHER, said("d2", "Theirs. More."))]);
    expect(held()).toBe(false);
  });

  it("an owner STOP still latches across a same-reply reconnect (`abandoned` = the owner's stop alone)", () => {
    const step = mount();
    step("streaming", [user, from(OWN, said("a1", "One."))]);
    expect(h.feed).toHaveBeenCalledTimes(1);
    h.stops += 1; // the owner's stop
    // the dropped stream's re-attach: a re-read floor + the snapshot — a NEW array, the SAME own reply
    step("streaming", [user, from(OWN, said("a1", "One. Two."))]);
    step("streaming", [user, from(OWN, said("a1", "One. Two. Three."))]);
    expect(h.feed).toHaveBeenCalledTimes(1);
    step("idle", [user, from(OWN, said("a1", "One. Two. Three."))]);
    expect(h.endTurn).not.toHaveBeenCalled();
  });
});
