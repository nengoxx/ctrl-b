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
import { reattachTurn, sendMessage, startNewThread, useChat } from "../../src/store/chat";
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

/** A fake re-attach whose `…/stream` answers the JSON `{active:false, …}` terminal shape, with `floor`
 *  standing in for the durable messages the forced `reloadChat(true)` then re-reads. */
function mockTerminalReattach(body: Record<string, unknown>, floor: unknown[] = []) {
  globalThis.fetch = vi.fn((url: RequestInfo | URL) =>
    Promise.resolve(
      String(url).includes("/stream")
        ? ({
            ok: true,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => body,
          } as unknown as Response)
        : ({ ok: true, json: async () => floor } as unknown as Response),
    ),
  );
}

/** The durable floor of a turn parked on a confirm — what `/api/threads/t1/messages` returns after the
 *  turn suspended. This is ALL a cold-loaded device has: `call_id` + `tool` + `args` + `state`; the
 *  permission PROMPT was never persisted (it rides the live `tool.permission` frame only). */
const FLOOR_AWAITING_CONFIRM = [
  {
    id: "u1",
    thread_id: "t1",
    role: "user",
    parts: [{ type: "text", text: "shut it down" }],
    actor: "user",
    ts: "2026-07-29T00:00:00Z",
    tokens: null,
    compacted: false,
  },
  {
    id: "m1",
    thread_id: "t1",
    role: "assistant",
    parts: [
      {
        type: "tool_call",
        call_id: "c1",
        tool: "shutdown_host",
        args: {},
        state: "awaiting_confirm",
      },
    ],
    actor: "agent",
    ts: "2026-07-29T00:00:01Z",
    tokens: null,
    compacted: false,
  },
];

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

/** Seed thread t1 with one completed turn, so a re-attach has somewhere to attach. */
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

  // ── verify-5 ──────────────────────────────────────────────────────────────────────────────────

  it("a SUSPENDED `{active:false}` answer reconstructs the awaiting call from the reloaded floor", async () => {
    // The headline case F1 exists for: the app was killed while the agent was parked on an approval.
    // The cold-load probe gets `{active:false, terminal_status:"suspended"}` — and the terminal builder
    // is (correctly) silent on `suspended`, so before fix 1 this device was told NOTHING at all.
    await seedThread();
    captured.length = 0;

    mockTerminalReattach(
      { active: false, terminal_status: "suspended", turn_id: "turn-s" },
      FLOOR_AWAITING_CONFIRM,
    );
    await act(async () => {
      await reattachTurn("t1", "turn-s:1");
    });

    const inputs = byClass("agent_input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0].key).toBe("perm:t1:c1"); // identical to the live frame's key ⇒ collapses on replay
    // The prompt isn't durable, so the body degrades to the builder's tool-name fallback. The KEY is
    // what the de-dupe rides on, so this costs nothing but wording.
    expect(inputs[0].body).toBe("shutdown_host is waiting for your approval");
    expect(byClass("turn_done")).toHaveLength(0); // suspended stays silent, as everywhere
  });

  it("a suspended reattach announces a parked QUESTION with its durable prompt", async () => {
    await seedThread();
    captured.length = 0;

    mockTerminalReattach({ active: false, terminal_status: "suspended", turn_id: "turn-s" }, [
      FLOOR_AWAITING_CONFIRM[0],
      {
        ...FLOOR_AWAITING_CONFIRM[1],
        parts: [
          {
            type: "tool_call",
            call_id: "q1",
            tool: "question",
            args: { prompt: "which host?" },
            state: "awaiting_answer",
          },
        ],
      },
    ]);
    await act(async () => {
      await reattachTurn("t1", "turn-s:1");
    });
    const inputs = byClass("agent_input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0].key).toBe("ask:t1:q1");
    expect(inputs[0].body).toBe("which host?"); // the question builtin's `args.prompt` IS durable
  });

  it("an ALREADY-RESOLVED call in the floor is never re-announced", async () => {
    // The resume flips the durable state and appends a `tool_result`; the reconstruction mirrors the
    // bubble's own `!result && awaiting_*` test, so a resolved call stays silent.
    await seedThread();
    captured.length = 0;

    mockTerminalReattach({ active: false, terminal_status: "suspended", turn_id: "turn-s" }, [
      FLOOR_AWAITING_CONFIRM[0],
      FLOOR_AWAITING_CONFIRM[1],
      {
        ...FLOOR_AWAITING_CONFIRM[1],
        id: "m2",
        role: "tool",
        parts: [
          {
            type: "tool_result",
            call_id: "c1",
            result: { state: "ok", summary: "done", data: {}, output: null, error: null },
          },
        ],
      },
    ]);
    await act(async () => {
      await reattachTurn("t1", "turn-s:1");
    });
    expect(captured).toHaveLength(0);
  });

  it("an UNKNOWN/EXPIRED reattach (null terminal_status) publishes NOTHING", async () => {
    // No handle and no linger record ⇒ the server can say only "not live". Nothing was learned about
    // how the turn ended, so a `turn_done` here would be a fabricated "The agent finished" (fix 2) —
    // and the floor's awaiting call may be an ancient unanswered one, so it is not announced either.
    await seedThread();
    captured.length = 0;

    mockTerminalReattach(
      { active: false, terminal_status: null, turn_id: "turn-x" },
      FLOOR_AWAITING_CONFIRM,
    );
    let handled = false;
    await act(async () => {
      handled = await reattachTurn("t1", "turn-x:1");
    });
    expect(handled).toBe(true); // the JSON terminal path really ran (it just had nothing to say)
    expect(captured).toHaveLength(0);
  });

  it("a buffered turn keys its signals under the ORIGINATING thread when a `/clear` lands mid-reload", async () => {
    // The buffered path publishes AFTER `await reloadChat()`. A `/clear` is legal in that window (the
    // view is already idle), and it nulls `state.threadId` — so reading the scope after the await
    // filed this turn's signals under the NEW thread (here: the no-thread fallback), and a device that
    // saw the live frame would have buzzed a second time. Fix 3 captures the scope BEFORE the await.
    let cleared = false;
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      if (String(url).includes("/agent/"))
        return Promise.resolve({
          ok: true,
          body: {},
          headers: { get: () => "application/json" },
          json: async () => ({
            threadId: "t1",
            state: "suspended",
            permission: { callId: "c1", token: "t", tool: "shutdown_host", prompt: "confirm?" },
          }),
        } as unknown as Response);
      startNewThread(); // the owner taps /clear exactly while the reload's re-read is in flight
      cleared = true;
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    await act(async () => {
      await sendMessage("shut it down");
    });

    expect(cleared).toBe(true); // the interleave really happened (the reload was reached)
    const inputs = byClass("agent_input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0].key).toBe("perm:t1:c1"); // NOT `perm:thread:c1`
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

  it("(c) a SUSPENDED cold reattach: one buzz when the live frame was missed…", async () => {
    await seedThread();
    renderHook(() => useForegroundNotifications());
    shown = []; // ignore the seed turn's own turn_done

    mockTerminalReattach(
      { active: false, terminal_status: "suspended", turn_id: "turn-s" },
      FLOOR_AWAITING_CONFIRM,
    );
    await act(async () => {
      await reattachTurn("t1", "turn-s:1");
    });
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe("Approval needed");
    expect(shown[0].options.tag).toBe("perm:t1:c1");
  });

  it("(d) …and STILL one when it wasn't — the reconstruction collapses onto the live key", async () => {
    renderHook(() => useForegroundNotifications());
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" }, id: "turn-s:1" },
      {
        event: "tool.permission",
        id: "turn-s:2",
        data: {
          callId: "c1",
          tool: "shutdown_host",
          prompt: "Shutdown: confirm to proceed.",
          token: "t",
        },
      },
      { event: "done", data: { state: "suspended" }, id: "turn-s:3" },
    ]);
    await act(async () => {
      await sendMessage("shut it down");
    });
    expect(shown).toHaveLength(1);

    // The socket dies and the app is re-opened later: the probe's terminal answer + the durable floor
    // rebuild the SAME call. Same key ⇒ the seen-set swallows it (this is the pair fix 1 must not
    // trade a missed notification for a double one).
    mockTerminalReattach(
      { active: false, terminal_status: "suspended", turn_id: "turn-s" },
      FLOOR_AWAITING_CONFIRM,
    );
    await act(async () => {
      await reattachTurn("t1", "turn-s:3");
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

// ── D61 ② the core-memory pressure hint ─────────────────────────────────────────────────────────
// A second thing rides `notifyTurnTerminal`, for the same reason the signals above do: it is the ONE
// point every transport's terminal passes through (the draft's `done`-only hook would have missed
// buffered turns and reattach completions entirely — §16b-3). This is the OWNER's channel for index
// cap pressure; the model's own header carries none (D61 ③). Pinned here: all four transports run
// the check, the enable flag AND the threshold come from the server, the latch fires once per
// pressure episode and re-arms on a drop, a failed read is silent, and overlapping terminals collapse
// to one status request.

const PRESSED = { enabled: true, index_pct: 91, consolidation_nudge_pct: 80 };
const CALM = { enabled: true, index_pct: 12, consolidation_nudge_pct: 80 };
const PRESSURE_NOTE = "// memory index at 91% — run /consolidate when convenient";

/** Wrap whatever transport mock is installed so `/api/memory/core/status` answers `body` — or
 *  fails, when it is `null`. Everything else still goes to the transport underneath. */
function withCoreStatus(body: unknown): void {
  const inner = globalThis.fetch;
  globalThis.fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) =>
    String(url).includes("/memory/core/status")
      ? body === null
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ ok: true, json: async () => body } as unknown as Response)
      : inner(url, init),
  );
}

/** The status check is fire-and-forget off the terminal, so let its microtasks land. */
const flush = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

/** One completed STREAMING turn whose status read answers `body`. */
async function pressuredTurn(body: unknown): Promise<void> {
  mockStream([
    { event: "thread", data: { threadId: "t1" } },
    { event: "message.start", data: { messageId: "m1" } },
    { event: "done", data: { state: "completed" } },
  ]);
  withCoreStatus(body);
  await act(async () => {
    await sendMessage("hello");
  });
  await flush();
}

describe("the core-memory pressure hint (D61 ②)", () => {
  const notes = () =>
    renderHook(() => useChat())
      .result.current.messages.filter((m) => m.role === "system")
      .flatMap((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")))
      .filter((t) => t.includes("memory index at"));

  // Every test starts from a re-armed latch (it is module state, and a calm reading is exactly what
  // re-arms it) — which is also the "a drop below the threshold re-arms" behaviour, exercised here
  // on every single case rather than once.
  beforeEach(async () => {
    await pressuredTurn(CALM);
  });
  afterEach(cleanup);

  it("pushes ONE note naming the fill when the index is at or over the threshold", async () => {
    await pressuredTurn(PRESSED);
    expect(notes()).toEqual([PRESSURE_NOTE]);
  });

  it("says nothing below the threshold, and nothing at all while the slot is off", async () => {
    await pressuredTurn(CALM);
    await pressuredTurn({ enabled: false, index_pct: 99, consolidation_nudge_pct: 80 });
    expect(notes()).toEqual([]);
  });

  it("compares against the SERVER's threshold, not a client constant", async () => {
    // 12% is calm at the shipped 80 and pressured at an owner-lowered 10 — config stays the one
    // source of truth for when the hint fires.
    await pressuredTurn({ ...CALM, consolidation_nudge_pct: 10 });
    expect(notes()).toEqual(["// memory index at 12% — run /consolidate when convenient"]);
  });

  it("once per pressure episode — and a drop below the threshold arms the next one", async () => {
    // Also the REPLAY case: a second observation of the same pressure (a re-attach onto a turn this
    // client already saw end) reads the same status and must stay silent.
    await pressuredTurn(PRESSED);
    await pressuredTurn(PRESSED); // still the same episode: silent
    expect(notes()).toEqual([PRESSURE_NOTE]);
    await pressuredTurn(CALM); // the owner consolidated → re-armed
    await pressuredTurn(PRESSED);
    expect(notes()).toEqual([PRESSURE_NOTE, PRESSURE_NOTE]);
  });

  it("a failed status read is silent — the hint is a convenience, never an error", async () => {
    await pressuredTurn(null);
    expect(notes()).toEqual([]);
  });

  it("the BUFFERED transport's terminal runs the check too", async () => {
    mockBuffered({ threadId: "t1", state: "completed" });
    withCoreStatus(PRESSED);
    await act(async () => {
      await sendMessage("hello");
    });
    await flush();
    expect(notes()).toEqual([PRESSURE_NOTE]);
  });

  it("a `turn.sync` snapshot carrying a terminal runs the check too", async () => {
    mockReattach([
      {
        event: "turn.sync",
        id: "turn-z:4",
        data: { mode: null, seq: 4, terminal: { state: "completed" }, calls: [] },
      },
    ]);
    withCoreStatus(PRESSED);
    await act(async () => {
      await reattachTurn("t1", "turn-z:1");
    });
    await flush();
    expect(notes()).toEqual([PRESSURE_NOTE]);
  });

  it("an `{active:false}` reattach runs the check too", async () => {
    // The transport a phone that slept through the turn lands on. The note is pushed AFTER that
    // path's forced re-read of the durable floor — which would otherwise drop a client-only note.
    mockTerminalReattach({ active: false, terminal_status: "completed", turn_id: "turn-y" });
    withCoreStatus(PRESSED);
    await act(async () => {
      await reattachTurn("t1", "turn-y:2");
    });
    await flush();
    expect(notes()).toEqual([PRESSURE_NOTE]);
  });

  it("a SUSPENDED terminal is not a terminal for this either", async () => {
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" } },
      { event: "done", data: { state: "suspended" } },
    ]);
    withCoreStatus(PRESSED);
    await act(async () => {
      await sendMessage("shut it down");
    });
    await flush();
    expect(notes()).toEqual([]); // the owner is being asked something — not the moment for a chore
  });

  it("EXACTLY at the threshold the note fires (the comparison is `<`, not `<=`)", async () => {
    await pressuredTurn({ enabled: true, index_pct: 80, consolidation_nudge_pct: 80 });
    expect(notes()).toEqual(["// memory index at 80% — run /consolidate when convenient"]);
  });

  /** A status route that answers the FIRST read from `held` and every later one with `later`. */
  function heldThenLater(later: unknown): { land: (r: Response) => void; reads: () => number } {
    let reads = 0;
    let land!: (r: Response) => void;
    const held = new Promise<Response>((resolve) => (land = resolve));
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      if (!String(url).includes("/memory/core/status"))
        return Promise.resolve(
          sseResponse([
            { event: "thread", data: { threadId: "t1" } },
            { event: "message.start", data: { messageId: "m1" } },
            { event: "done", data: { state: "completed" } },
          ]),
        );
      reads++;
      return reads === 1
        ? held // the first check stays open across the terminals that follow
        : Promise.resolve({ ok: true, json: async () => later } as unknown as Response);
    });
    return { land, reads: () => reads };
  }

  it("terminals landing while a check is in flight collapse to ONE read plus ONE follow-up", async () => {
    const { land, reads } = heldThenLater(CALM);
    for (const text of ["one", "two", "three"])
      await act(async () => {
        await sendMessage(text);
      });
    expect(reads()).toBe(1); // three terminals, one request

    land({ ok: true, json: async () => PRESSED } as unknown as Response);
    await flush();
    expect(reads()).toBe(2); // the discarded terminals coalesce into a SINGLE follow-up, not two
    expect(notes()).toEqual([PRESSURE_NOTE]); // …and the first read still delivered its note
  });

  it("a calm terminal discarded during a pressured check still re-arms the latch", async () => {
    // The race the follow-up exists for: the CONSOLIDATION turn's own terminal — the one calm
    // reading guaranteed to exist — landing while a pressured check is open. Dropping it would let
    // the stale pressured answer hold the latch down and silence the next episode forever.
    await pressuredTurn(PRESSED);
    expect(notes()).toEqual([PRESSURE_NOTE]);

    const { land } = heldThenLater(CALM); // the corpus is calm by the time the follow-up reads it
    for (const text of ["consolidate", "and on"])
      await act(async () => {
        await sendMessage(text);
      });
    land({ ok: true, json: async () => PRESSED } as unknown as Response); // the STALE answer
    await flush();

    await pressuredTurn(PRESSED); // the next episode
    expect(notes()).toEqual([PRESSURE_NOTE, PRESSURE_NOTE]);
  });
});
