import { act, cleanup, renderHook } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// F1 — the agent-side source. The turn reducer publishes to `lib/notifyBus` from four frames:
// `tool.permission` + `tool.question` (class `agent_input`) and `done` + `error` (class `turn_done`).
// Driven through the REAL reducer over a mocked SSE `fetch` (the house pattern from chat.test.ts), so
// what's pinned is the actual wire → signal mapping, not a re-implementation of it.
//
// Codex final round (MED-1): the live SSE reducer is only ONE of four transports a turn occurrence
// reaches the store through. The other three — the buffered JSON reply, a `turn.sync` re-attach
// snapshot, and the `{active:false}` terminal answer — must publish the SAME signal under the SAME
// key, so a device that MISSED the live frame still learns, and one that SAW it doesn't buzz twice.
// The last section mounts the real engine to prove both halves end to end.

// The engine's prefs come from an always-on query; mocked so these tests need no QueryClient.
const h = vi.hoisted(() => ({
  prefs: {
    enabled: true,
    events: { agent_input: true, turn_done: true, action_failed: true },
  },
}));
vi.mock("../../src/hooks/useNotificationPrefs", () => ({
  useNotificationPrefs: () => ({ data: h.prefs }),
}));

import { useForegroundNotifications } from "../../src/hooks/useForegroundNotifications";
import { reattachTurn, sendMessage, startNewThread } from "../../src/store/chat";
import { onNotify, type NotifySignal } from "../../src/lib/notifyBus";

type Frame = { event: string; data: unknown; id?: string };

function sseResponse(frames: Frame[]): Response {
  const text = frames
    .map(
      (f) =>
        `event: ${f.event}\r\n${f.id ? `id: ${f.id}\r\n` : ""}data: ${JSON.stringify(f.data)}\r\n\r\n`,
    )
    .join("");
  const bytes = new TextEncoder().encode(text);
  return {
    ok: true,
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    }),
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
    },
  } as unknown as Response;
}

function mockStream(frames: Frame[]) {
  globalThis.fetch = vi.fn(() => Promise.resolve(sseResponse(frames)));
}

/** A fake buffered (D17) reply for `/agent/chat` + the thread re-read `reloadChat` fires after it. */
function mockBuffered(payload: Record<string, unknown>) {
  globalThis.fetch = vi.fn((url: RequestInfo | URL) =>
    Promise.resolve(
      String(url).includes("/agent/")
        ? ({
            ok: true,
            body: {},
            headers: { get: () => "application/json" },
            json: async () => payload,
          } as unknown as Response)
        : ({ ok: true, json: async () => [] } as unknown as Response),
    ),
  );
}

/** A fake re-attach: `…/stream` yields `frames` (a `turn.sync` + its terminal); anything else is the
 *  forced `reloadChat(true)` re-read of the durable floor. */
function mockReattach(frames: Frame[]) {
  globalThis.fetch = vi.fn((url: RequestInfo | URL) =>
    Promise.resolve(
      String(url).includes("/stream")
        ? sseResponse(frames)
        : ({ ok: true, json: async () => [] } as unknown as Response),
    ),
  );
}

/** The `turn.sync` frame both re-attach tests use: one call parked on a confirm, no terminal yet. */
const SYNC_AWAITING_CONFIRM: Frame = {
  event: "turn.sync",
  id: "turn-a:7",
  data: {
    mode: null,
    seq: 7,
    terminal: null,
    message: { id: "m1", role: "assistant", agent: null, text: "", reasoning: "" },
    calls: [
      {
        call_id: "c1",
        tool: "shutdown_host",
        args: {},
        state: "awaiting_confirm",
        permission: { token: "t", prompt: "Shutdown: confirm to proceed." },
      },
    ],
  },
};

const captured: NotifySignal[] = [];
const unsub = onNotify((s) => captured.push(s));

beforeEach(() => {
  startNewThread();
  captured.length = 0;
});
afterEach(() => {
  captured.length = 0;
});
afterAll(unsub);

const byClass = (cls: NotifySignal["cls"]) => captured.filter((s) => s.cls === cls);

describe("chat reducer → notifyBus", () => {
  it("a confirm bubble publishes agent_input keyed on thread+callId, routed to the Agent tab", async () => {
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" } },
      {
        event: "part.added",
        data: {
          messageId: "m1",
          part: { type: "tool_call", callId: "c1", name: "shutdown_host", args: {} },
        },
      },
      {
        event: "tool.permission",
        data: {
          callId: "c1",
          tool: "shutdown_host",
          prompt: "Shutdown: confirm to proceed.",
          token: "t",
        },
      },
      { event: "done", data: { state: "suspended" }, id: "turn-a:9" },
    ]);
    await act(async () => {
      await sendMessage("shut it down");
    });

    const inputs = byClass("agent_input");
    expect(inputs).toHaveLength(1);
    // Namespaced `<kind>:<threadId>:<callId>` (Codex LOW) — the same key the `turn.sync`
    // reconstruction of this call computes, which is what lets the engine collapse the two.
    expect(inputs[0].key).toBe("perm:t1:c1");
    expect(inputs[0].title).toBe("Approval needed");
    expect(inputs[0].body).toBe("Shutdown: confirm to proceed.");
    expect(inputs[0].focus).toBe("agent");
    // `suspended` is the terminal that ALWAYS accompanies a permission frame — notifying for it too
    // would double-buzz the same moment, under a preference the owner may have turned off.
    expect(byClass("turn_done")).toHaveLength(0);
  });

  it("a question bubble publishes agent_input keyed on its callId", async () => {
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" } },
      {
        event: "part.added",
        data: {
          messageId: "m1",
          part: { type: "tool_call", callId: "q1", name: "question", args: {} },
        },
      },
      { event: "tool.question", data: { callId: "q1", tool: "question", question: "which host?" } },
      { event: "done", data: { state: "suspended" } },
    ]);
    await act(async () => {
      await sendMessage("do a thing");
    });

    const inputs = byClass("agent_input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0].key).toBe("ask:t1:q1");
    expect(inputs[0].title).toBe("The agent has a question");
    expect(inputs[0].body).toBe("which host?");
  });

  it("a completed turn publishes turn_done keyed on the thread + the wire turn id", async () => {
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" }, id: "turn-a:1" },
      { event: "text.delta", data: { messageId: "m1", delta: "hi" }, id: "turn-a:2" },
      { event: "done", data: { state: "completed" }, id: "turn-a:3" },
    ]);
    await act(async () => {
      await sendMessage("hello");
    });

    const done = byClass("turn_done");
    expect(done).toHaveLength(1);
    expect(done[0].key).toBe("turn-done:t1:turn-a");
    expect(done[0].title).toBe("The agent finished");
    expect(done[0].focus).toBe("agent");
  });

  it("a capped turn says so", async () => {
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" }, id: "turn-b:1" },
      { event: "done", data: { state: "capped" }, id: "turn-b:2" },
    ]);
    await act(async () => {
      await sendMessage("big job");
    });
    expect(byClass("turn_done")[0].title).toBe("The agent hit its step limit");
  });

  it("an `error` frame and the `done(error)` that follows it share ONE key (de-duped to one buzz)", async () => {
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" }, id: "turn-c:1" },
      { event: "error", data: { message: "endpoint unreachable" }, id: "turn-c:2" },
      { event: "done", data: { state: "error" }, id: "turn-c:3" },
    ]);
    await act(async () => {
      await sendMessage("go");
    });

    const done = byClass("turn_done");
    // Both publish (the bus is dumb); the ENGINE's seen-set collapses them, and the FIRST one — the
    // `error` frame, carrying the real message — is the one that reaches the tray.
    expect(done.map((s) => s.key)).toEqual(["turn-error:t1:turn-c", "turn-error:t1:turn-c"]);
    expect(done[0].body).toBe("endpoint unreachable");
    expect(done[0].title).toBe("The agent stopped");
  });

  it("a `done(error)` with no preceding error frame still produces exactly one signal", async () => {
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" }, id: "turn-e:1" },
      { event: "done", data: { state: "error" }, id: "turn-e:2" },
    ]);
    await act(async () => {
      await sendMessage("go");
    });
    const done = byClass("turn_done");
    expect(done).toHaveLength(1);
    expect(done[0].key).toBe("turn-error:t1:turn-e");
    expect(done[0].title).toBe("The agent stopped");
  });

  it("a plain text turn publishes NOTHING for the agent_input class", async () => {
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" }, id: "turn-d:1" },
      { event: "text.delta", data: { messageId: "m1", delta: "ok" }, id: "turn-d:2" },
      { event: "done", data: { state: "completed" }, id: "turn-d:3" },
    ]);
    await act(async () => {
      await sendMessage("hi");
    });
    expect(byClass("agent_input")).toHaveLength(0);
  });
});

// ── the OTHER three transports (Codex final round, MED-1) ───────────────────────────────────────

describe("the non-live transports publish the same signals", () => {
  it("a buffered (non-streaming) COMPLETED turn publishes turn_done", async () => {
    mockBuffered({ threadId: "t1", state: "completed" });
    await act(async () => {
      await sendMessage("hello");
    });
    const done = byClass("turn_done");
    expect(done).toHaveLength(1);
    expect(done[0].title).toBe("The agent finished");
    // The buffered reply carries no turn id (`collect_turn` folds state/messageId/permission/
    // question/error/notices only), so the key degrades to the thread scope — see the bounded-fallback
    // test below.
    expect(done[0].key).toBe("turn-done:t1:t1");
    expect(byClass("agent_input")).toHaveLength(0);
  });

  it("a buffered SUSPENDED turn publishes only agent_input — never a terminal", async () => {
    mockBuffered({
      threadId: "t1",
      state: "suspended",
      permission: { callId: "c1", token: "t", tool: "shutdown_host", prompt: "confirm?" },
    });
    await act(async () => {
      await sendMessage("shut it down");
    });
    const inputs = byClass("agent_input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0].key).toBe("perm:t1:c1"); // identical to the live frame's key
    expect(inputs[0].body).toBe("confirm?");
    expect(byClass("turn_done")).toHaveLength(0);
  });

  it("a buffered ERRORED turn carries the server's message", async () => {
    mockBuffered({ threadId: "t1", state: "error", error: { message: "endpoint unreachable" } });
    await act(async () => {
      await sendMessage("go");
    });
    const done = byClass("turn_done");
    expect(done).toHaveLength(1);
    expect(done[0].key).toBe("turn-error:t1:t1");
    expect(done[0].body).toBe("endpoint unreachable");
  });

  it("a buffered turn with a QUESTION publishes agent_input under the live key", async () => {
    mockBuffered({
      threadId: "t1",
      state: "suspended",
      question: { callId: "q1", question: "which host?" },
    });
    await act(async () => {
      await sendMessage("do a thing");
    });
    const inputs = byClass("agent_input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0].key).toBe("ask:t1:q1");
    expect(inputs[0].body).toBe("which host?");
  });

  it("a `turn.sync` snapshot RECONSTRUCTS the awaiting confirm under the live frame's key", async () => {
    // Establish the thread, then re-attach onto a snapshot whose call is parked on a confirm — the
    // phone-slept-through-the-frame case. The key must match what the live `tool.permission` computed.
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "seed" } },
      { event: "done", data: { state: "completed" } },
    ]);
    await act(async () => {
      await sendMessage("shut it down");
    });
    captured.length = 0;

    mockReattach([
      SYNC_AWAITING_CONFIRM,
      { event: "done", id: "turn-a:8", data: { state: "suspended" } },
    ]);
    await act(async () => {
      await reattachTurn("t1", "turn-a:1");
    });
    const inputs = byClass("agent_input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0].key).toBe("perm:t1:c1");
    expect(inputs[0].body).toBe("Shutdown: confirm to proceed.");
    expect(byClass("turn_done")).toHaveLength(0); // the suspended terminal stays silent, as everywhere
  });

  it("a `turn.sync` snapshot carrying a TERMINAL publishes turn_done under the live `done` key", async () => {
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "seed" } },
      { event: "done", data: { state: "completed" } },
    ]);
    await act(async () => {
      await sendMessage("hello");
    });
    captured.length = 0;

    mockReattach([
      {
        event: "turn.sync",
        id: "turn-z:4",
        data: { mode: null, seq: 4, terminal: { state: "completed" }, calls: [] },
      },
    ]);
    await act(async () => {
      await reattachTurn("t1", "turn-z:1");
    });
    const done = byClass("turn_done");
    expect(done).toHaveLength(1);
    expect(done[0].key).toBe("turn-done:t1:turn-z"); // == what the live `done` on turn-z would publish
  });

  it("the `{active:false}` re-attach answer publishes turn_done keyed on its `turn_id`", async () => {
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "seed" } },
      { event: "done", data: { state: "completed" } },
    ]);
    await act(async () => {
      await sendMessage("hello");
    });
    captured.length = 0;

    globalThis.fetch = vi.fn((url: RequestInfo | URL) =>
      Promise.resolve(
        String(url).includes("/stream")
          ? ({
              ok: true,
              headers: new Headers({ "content-type": "application/json" }),
              json: async () => ({
                active: false,
                terminal_status: "capped",
                turn_id: "turn-y",
              }),
            } as unknown as Response)
          : ({ ok: true, json: async () => [] } as unknown as Response),
      ),
    );
    await act(async () => {
      await reattachTurn("t1", "turn-y:2");
    });
    const done = byClass("turn_done");
    expect(done).toHaveLength(1);
    expect(done[0].key).toBe("turn-done:t1:turn-y");
    expect(done[0].title).toBe("The agent hit its step limit");
  });
});

// ── end to end: the mounted engine collapses live + replay (the acceptance bar) ──────────────────

describe("a hidden device + a turn.sync snapshot → exactly one notification", () => {
  interface FakeNotification {
    title: string;
    options: NotificationOptions;
  }
  let shown: FakeNotification[] = [];

  beforeEach(() => {
    shown = [];
    class Fake {
      onclick: (() => void) | null = null;
      close = vi.fn();
      constructor(
        public title: string,
        public options: NotificationOptions = {},
      ) {
        shown.push(this);
      }
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn(() => Promise.resolve("granted" as NotificationPermission));
    }
    Object.defineProperty(window, "Notification", { value: Fake, configurable: true });
    // The whole point of the feature: the phone is in a pocket.
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  });
  afterEach(() => {
    cleanup(); // `globals: false` ⇒ no auto-cleanup; an engine left mounted bleeds into the next test
    delete (window as unknown as Record<string, unknown>).Notification;
  });

  /** Seed thread t1 with a completed turn, so a re-attach has somewhere to attach. */
  async function seedThread(): Promise<void> {
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "seed" } },
      { event: "done", data: { state: "completed" } },
    ]);
    await act(async () => {
      await sendMessage("shut it down");
    });
  }

  it("(a) the live frame was MISSED — the snapshot alone raises exactly one", async () => {
    await seedThread();
    renderHook(() => useForegroundNotifications());
    shown = []; // ignore the seed turn's own turn_done

    mockReattach([
      SYNC_AWAITING_CONFIRM,
      { event: "done", id: "turn-a:8", data: { state: "suspended" } },
    ]);
    await act(async () => {
      await reattachTurn("t1", "turn-a:1");
    });
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe("Approval needed");
    expect(shown[0].options.tag).toBe("perm:t1:c1");
  });

  it("(b) the live frame was SEEN — the snapshot's replay collapses onto it (still one)", async () => {
    renderHook(() => useForegroundNotifications());
    // The LIVE frame, seen by a mounted engine: one notification.
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" }, id: "turn-a:1" },
      {
        event: "tool.permission",
        id: "turn-a:2",
        data: {
          callId: "c1",
          tool: "shutdown_host",
          prompt: "Shutdown: confirm to proceed.",
          token: "t",
        },
      },
      { event: "done", data: { state: "suspended" }, id: "turn-a:3" },
    ]);
    await act(async () => {
      await sendMessage("shut it down");
    });
    expect(shown).toHaveLength(1);

    // …then a reconnect re-attaches and the snapshot RECONSTRUCTS the same call. Same key ⇒ the
    // engine's seen-set swallows it. This is the pair that a per-transport key would double-buzz.
    mockReattach([
      SYNC_AWAITING_CONFIRM,
      { event: "done", id: "turn-a:8", data: { state: "suspended" } },
    ]);
    await act(async () => {
      await reattachTurn("t1", "turn-a:3");
    });
    expect(shown).toHaveLength(1);
  });

  it("two consecutive ID-LESS turns collapse into one buzz — the accepted bounded fallback", async () => {
    renderHook(() => useForegroundNotifications());
    // The buffered transport carries no turn id, so both turns key on the thread alone and the second
    // is suppressed. ACCEPTED (Codex final round, LOW): buffered mode is a non-default config the PWA
    // never uses (it always streams), the fallback is bounded to that one degenerate transport, and
    // the alternative — a timestamp/counter in the key — would break the live↔replay collapse that is
    // the whole point of the shared keys. Asserted here so the trade-off is visible, not incidental.
    mockBuffered({ threadId: "t1", state: "completed" });
    await act(async () => {
      await sendMessage("one");
    });
    expect(shown).toHaveLength(1);

    mockBuffered({ threadId: "t1", state: "completed" });
    await act(async () => {
      await sendMessage("two");
    });
    expect(shown).toHaveLength(1); // the second turn's identical key is swallowed
  });
});
