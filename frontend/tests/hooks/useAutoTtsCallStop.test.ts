import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "../../src/types";

// hooks/useAutoTts × lib/audioController — THE CALL'S STOP, across the seam (LIVE-001 · D71 amendment
// №3). `useAutoTts.test.ts` mocks the controller module-wide (the hook is thin and its assertions are
// the calls it makes); the hazard this pins lives BETWEEN the two, so here the controller is REAL and
// only its inputs are faked (the <audio> element, `fetch`, the chat store, the switches):
//
//   a thinking-phase stop lands before anything docked, so the feeder's undock latch never arms — and
//   the cancelled turn's idle edge then calls `endTurnSpeak`, which with no session falls through to
//   `toggle` and reads the partial reply aloud right after the owner stopped it. `dismissTurn` closes
//   that door for the whole TURN (fix wave 1: an id-keyed refusal missed the placeholder's rename on
//   `message.start` and a second round's message); a composer Stop takes no door, and its partial is
//   still spoken (owner ruling 1).

const h = vi.hoisted(() => ({
  chat: { messages: [] as ChatMessage[], status: "idle" },
  /** The agent resolver, ONE stable function (the real one is memoized): `lynette` is the routed
   *  conversational specialist, every other turn an `agent`-duties one (session-51 polish #6). */
  art: (name: string | null) => ({ actions: name === "lynette" }),
}));

vi.mock("../../src/store/toast", () => ({ pushToast: vi.fn() }));
vi.mock("../../src/store/chat", () => ({ useChat: () => h.chat }));
vi.mock("../../src/store/ui", () => ({
  useUISlice: (sel: (s: { ttsAuto: boolean }) => unknown) => sel({ ttsAuto: true }),
}));
vi.mock("../../src/hooks/useVoiceStatus", () => ({
  useVoiceStatus: () => ({
    data: { tts: true, tts_chunking: { mode: "sentence", read_along: true } },
  }),
}));

// The agent resolver reads the roster query; no roster here — `h.art` answers for it.
vi.mock("../../src/hooks/useAgentArt", () => ({ useAgentArt: () => h.art }));

import { useAutoTts } from "../../src/hooks/useAutoTts";
import {
  clearAudioCache,
  dismissTurn,
  setChunkPolicy,
  usePlayback,
} from "../../src/lib/audioController";

/** The controller's one <audio> element, reduced to what its listeners and transport touch. */
class FakeAudio {
  preload = "";
  src = "";
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  ended = false;
  private listeners: Record<string, (() => void)[]> = {};
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
  async play() {
    this.paused = false;
    (this.listeners.play || []).forEach((cb) => cb());
  }
  pause() {
    this.paused = true;
    (this.listeners.pause || []).forEach((cb) => cb());
  }
}

let synths = 0;
/** What reached the wire, per synth — the speaker's agent and the words its policy kept. */
let bodies: { text: string; agent?: string }[] = [];

function msg(id: string, role: "user" | "assistant", text: string): ChatMessage {
  return {
    id,
    thread_id: "t1",
    role,
    parts: [{ type: "text", text }],
    actor: role === "user" ? "user" : "agent",
    ts: "2026-09-27T00:00:00Z",
    tokens: null,
    compacted: false,
  };
}
const user = msg("u1", "user", "hi");

/** Mount the feeder before the turn starts (so the streaming EDGE is real) and drive the chat store. */
function mount() {
  const view = renderHook(() => {
    useAutoTts();
    return usePlayback((p) => p);
  });
  const step = async (status: "idle" | "streaming", messages: ChatMessage[]) => {
    await act(async () => {
      h.chat = { messages, status };
      view.rerender();
      await new Promise((r) => setTimeout(r, 0));
    });
  };
  return { view, step };
}

beforeEach(() => {
  vi.stubGlobal("Audio", FakeAudio);
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  synths = 0;
  bodies = [];
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    synths += 1;
    bodies.push(JSON.parse(String(init?.body)) as { text: string; agent?: string });
    return {
      ok: true,
      status: 200,
      blob: async () => new Blob(["a"]),
      headers: { get: () => null },
    } as unknown as Response;
  });
  clearAudioCache();
  setChunkPolicy({
    mode: "sentence",
    minWords: 1,
    minChars: 1,
    maxChars: 400,
    maxTextChars: 4096,
    lookahead: 1,
    format: "opus",
    readAlong: true,
    speakActions: false, // the prod setting — so a speaker's duties are visible on the wire
  });
  h.chat = { messages: [], status: "idle" };
});

describe("useAutoTts × audioController — a call stop in THINKING speaks nothing (LIVE-001)", () => {
  it("the cancelled turn's idle edge does not read the partial aloud", async () => {
    const { view, step } = mount();
    await step("streaming", [user, msg("a1", "assistant", "Sure, let me")]); // no chunk closed yet
    expect(view.result.current.id).toBeNull(); // nothing docked — the abandon latch cannot arm
    act(() => dismissTurn()); // the call's kill effect
    await step("idle", [user, msg("a1", "assistant", "Sure, let me")]); // done{cancelled}
    expect(synths).toBe(0);
    expect(view.result.current.id).toBeNull();
  });

  it("…nor can a boundary still streaming in before the cancel lands start it", async () => {
    const { view, step } = mount();
    await step("streaming", [user, msg("a2", "assistant", "Sure")]);
    act(() => dismissTurn());
    await step("streaming", [user, msg("a2", "assistant", "Sure. Let me look.")]);
    await step("idle", [user, msg("a2", "assistant", "Sure. Let me look.")]);
    expect(synths).toBe(0);
    expect(view.result.current.id).toBeNull();
  });

  it("a stop on the PLACEHOLDER, then `message.start` renames it: neither feeder speaks", async () => {
    // The optimistic placeholder is the live turn's `assistantMessageId` until the server's id is
    // adopted — the exact window an id-keyed refusal missed (review round №1, Maya MED / Opus LOW-2).
    const { view, step } = mount();
    await step("streaming", [user, msg("assist-1", "assistant", "")]);
    act(() => dismissTurn());
    await step("streaming", [user, msg("srv-1", "assistant", "Sure. Let me look.")]); // renamed + text
    await step("streaming", [user, msg("srv-1", "assistant", "Sure. Let me look. Found it.")]);
    await step("idle", [user, msg("srv-1", "assistant", "Sure. Let me look. Found it.")]);
    expect(synths).toBe(0);
    expect(view.result.current.id).toBeNull();
  });

  it("a stop during a TOOL call: the second round's reply (a new message id) stays silent", async () => {
    const { view, step } = mount();
    await step("streaming", [user, msg("r1", "assistant", "")]); // round 1: no text, a tool running
    act(() => dismissTurn());
    await step("streaming", [
      user,
      msg("r1", "assistant", ""),
      msg("r2", "assistant", "Done. It is on."),
    ]);
    await step("idle", [
      user,
      msg("r1", "assistant", ""),
      msg("r2", "assistant", "Done. It is on."),
    ]);
    expect(synths).toBe(0);
    expect(view.result.current.id).toBeNull();
  });

  it("the latch is per TURN — the owner's re-said question, the next turn, speaks", async () => {
    const { view, step } = mount();
    await step("streaming", [user, msg("a4", "assistant", "Sure")]);
    act(() => dismissTurn());
    await step("idle", [user, msg("a4", "assistant", "Sure")]);
    const again = msg("u2", "user", "the right question");
    // the next turn is ROUTED to the conversational specialist (Maya M3): its speaker — agent AND
    // duties — must cross the real feeder → controller seam, so its action is dropped on the wire
    const routed = (text: string) => ({ ...msg("a5", "assistant", text), agent: "lynette" });
    await step("streaming", [user, again, routed("")]);
    await step("idle", [user, again, routed("*She nods.* Right. Here it is.")]);
    expect(synths).toBeGreaterThan(0);
    expect(view.result.current.id).toBe("a5");
    expect(bodies.every((b) => b.agent === "lynette")).toBe(true);
    expect(bodies.map((b) => b.text).join(" ")).not.toContain("nods");
    expect(bodies.map((b) => b.text).join(" ")).toContain("Here it is.");
  });

  it("a composer Stop (no stop door) still speaks its partial — owner ruling 1 stands", async () => {
    const { view, step } = mount();
    await step("streaming", [user, msg("a3", "assistant", "Sure, let me")]);
    // `stopTurn` cancels without touching the player; the turn settles on its partial text.
    await step("idle", [user, msg("a3", "assistant", "Sure, let me")]);
    expect(synths).toBeGreaterThan(0);
    expect(view.result.current.id).toBe("a3");
  });
});
