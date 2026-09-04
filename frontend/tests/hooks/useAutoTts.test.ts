import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
}

const h = vi.hoisted(() => {
  const chat: { messages: ChatMessage[]; status: Status } = { messages: [], status: "idle" };
  const voice: VoiceProbe = {};
  const player: { id: string | null } = { id: null };
  return { chat, voice, player, ui: { ttsAuto: true }, feed: vi.fn(), endTurn: vi.fn() };
});

vi.mock("../../src/store/chat", () => ({ useChat: () => h.chat }));
vi.mock("../../src/store/ui", () => ({
  useUISlice: (sel: (s: { ttsAuto: boolean }) => unknown) => sel(h.ui),
}));
vi.mock("../../src/hooks/useVoiceStatus", () => ({ useVoiceStatus: () => ({ data: h.voice }) }));
vi.mock("../../src/lib/audioController", () => ({
  feedReadAlong: h.feed,
  endTurnSpeak: h.endTurn,
  usePlayback: (sel: (p: { id: string | null }) => unknown) => sel(h.player),
}));

import { useAutoTts } from "../../src/hooks/useAutoTts";

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

/** Mount the hook the way the app does — before the turn starts, so the streaming EDGE is real. */
function mount() {
  const view = renderHook(() => useAutoTts());
  /** One store update: a fresh `messages` array (as every delta produces) + a status, then a render. */
  return (status: Status, messages: ChatMessage[]) => {
    act(() => {
      h.chat = { messages, status };
      view.rerender();
    });
  };
}

beforeEach(() => {
  h.chat = { messages: [], status: "idle" };
  h.ui = { ttsAuto: true };
  h.voice = { tts: true, tts_chunking: { mode: "sentence", read_along: true } };
  h.player.id = null;
  h.feed.mockClear();
  h.endTurn.mockClear();
});

describe("useAutoTts — the read-along feed (C3 S2)", () => {
  it("waits for a boundary in the UN-FED suffix, then hands the whole markdown over", () => {
    const step = mount();
    step("streaming", [user, said("a1", "Sure thing")]);
    expect(h.feed).not.toHaveBeenCalled();

    step("streaming", [user, said("a1", "Sure thing.")]);
    expect(h.feed).toHaveBeenCalledExactlyOnceWith("a1", "Sure thing.");

    // The suffix is what carries the boundary — text past the last feed with none in it is not a feed.
    step("streaming", [user, said("a1", "Sure thing. Let me")]);
    expect(h.feed).toHaveBeenCalledTimes(1);
    step("streaming", [user, said("a1", "Sure thing. Let me look.")]);
    expect(h.feed).toHaveBeenCalledTimes(2);
    expect(h.feed).toHaveBeenLastCalledWith("a1", "Sure thing. Let me look.");
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
    expect(h.feed).toHaveBeenCalledExactlyOnceWith("a1", "Done.");
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
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "Sure thing.");
  });
});

describe("useAutoTts — the turn-end flush", () => {
  it("speaks a buffered turn (no deltas were ever fed) through the same entry point", () => {
    const step = mount();
    step("streaming", [user]); // D17: nothing streams, the reply lands whole at the end
    expect(h.feed).not.toHaveBeenCalled();
    step("idle", [user, said("a1", "The whole reply.")]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "The whole reply.");
  });

  it("flushes a Stop mid-stream: what was generated is what gets read", () => {
    const step = mount();
    step("streaming", [user, said("a1", "Half a reply.")]);
    expect(h.feed).toHaveBeenCalledTimes(1);
    step("idle", [user, said("a1", "Half a reply. And a bi")]); // stopTurn settles on idle
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "Half a reply. And a bi");
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
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "Half a reply.");
    step("error", [user, failed]); // the `done{state:"error"}` frame right behind it
    expect(h.endTurn).toHaveBeenCalledTimes(1);
  });

  it("flushes the session it OWNS when the turn's last message never became text-bearing", () => {
    const step = mount();
    step("streaming", [user, said("a1", "Let me check the fleet.")]);
    expect(h.feed).toHaveBeenCalledExactlyOnceWith("a1", "Let me check the fleet.");
    // The tool step opens a second assistant message that only ever holds a tool_call — `finalReply`
    // reads null there, which would strand the preamble already being read aloud.
    const toolOnly = message("a2", "assistant", [
      { type: "tool_call", call_id: "c1", tool: "fleet", args: {}, state: "ok" },
    ]);
    step("idle", [user, said("a1", "Let me check the fleet."), toolOnly]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "Let me check the fleet.");
  });

  it("a later text-bearing message wins the flush (per-message superseding)", () => {
    const step = mount();
    step("streaming", [user, said("a1", "Let me check.")]);
    step("idle", [user, said("a1", "Let me check."), said("a2", "It is awake.")]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a2", "It is awake.");
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

  it("a pause (the player stays docked) is not an abandon", () => {
    const step = mount();
    step("streaming", [user, said("a1", "One sentence.")]);
    h.player.id = "a1";
    step("streaming", [user, said("a1", "One sentence. Two sentences.")]);
    expect(h.feed).toHaveBeenCalledTimes(2);
    step("idle", [user, said("a1", "One sentence. Two sentences.")]);
    expect(h.endTurn).toHaveBeenCalledExactlyOnceWith("a1", "One sentence. Two sentences.");
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
    expect(h.feed).toHaveBeenLastCalledWith("a2", "A new reply.");
  });
});
