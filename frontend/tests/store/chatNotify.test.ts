import { act } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// F1 — the agent-side source. The turn reducer publishes to `lib/notifyBus` from four frames:
// `tool.permission` + `tool.question` (class `agent_input`) and `done` + `error` (class `turn_done`).
// Driven through the REAL reducer over a mocked SSE `fetch` (the house pattern from chat.test.ts), so
// what's pinned is the actual wire → signal mapping, not a re-implementation of it.

import { sendMessage, startNewThread } from "../../src/store/chat";
import { onNotify, type NotifySignal } from "../../src/lib/notifyBus";

type Frame = { event: string; data: unknown; id?: string };

function mockStream(frames: Frame[]) {
  const text = frames
    .map(
      (f) =>
        `event: ${f.event}\r\n${f.id ? `id: ${f.id}\r\n` : ""}data: ${JSON.stringify(f.data)}\r\n\r\n`,
    )
    .join("");
  const bytes = new TextEncoder().encode(text);
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
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
    } as unknown as Response),
  );
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
  it("a confirm bubble publishes agent_input keyed on the callId, routed to the Agent tab", async () => {
    mockStream([
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
    expect(inputs[0].key).toBe("perm:c1");
    expect(inputs[0].title).toBe("Approval needed");
    expect(inputs[0].body).toBe("Shutdown: confirm to proceed.");
    expect(inputs[0].focus).toBe("agent");
    // `suspended` is the terminal that ALWAYS accompanies a permission frame — notifying for it too
    // would double-buzz the same moment, under a preference the owner may have turned off.
    expect(byClass("turn_done")).toHaveLength(0);
  });

  it("a question bubble publishes agent_input keyed on its callId", async () => {
    mockStream([
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
    expect(inputs[0].key).toBe("ask:q1");
    expect(inputs[0].title).toBe("The agent has a question");
    expect(inputs[0].body).toBe("which host?");
  });

  it("a completed turn publishes turn_done keyed on the wire turn id", async () => {
    mockStream([
      { event: "message.start", data: { messageId: "m1" }, id: "turn-a:1" },
      { event: "text.delta", data: { messageId: "m1", delta: "hi" }, id: "turn-a:2" },
      { event: "done", data: { state: "completed" }, id: "turn-a:3" },
    ]);
    await act(async () => {
      await sendMessage("hello");
    });

    const done = byClass("turn_done");
    expect(done).toHaveLength(1);
    expect(done[0].key).toBe("turn-done:turn-a");
    expect(done[0].title).toBe("The agent finished");
    expect(done[0].focus).toBe("agent");
  });

  it("a capped turn says so", async () => {
    mockStream([
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
    expect(done.map((s) => s.key)).toEqual(["turn-error:turn-c", "turn-error:turn-c"]);
    expect(done[0].body).toBe("endpoint unreachable");
    expect(done[0].title).toBe("The agent stopped");
  });

  it("a `done(error)` with no preceding error frame still produces exactly one signal", async () => {
    mockStream([
      { event: "message.start", data: { messageId: "m1" }, id: "turn-e:1" },
      { event: "done", data: { state: "error" }, id: "turn-e:2" },
    ]);
    await act(async () => {
      await sendMessage("go");
    });
    const done = byClass("turn_done");
    expect(done).toHaveLength(1);
    expect(done[0].key).toBe("turn-error:turn-e");
    expect(done[0].title).toBe("The agent stopped");
  });

  it("a plain text turn publishes NOTHING for the agent_input class", async () => {
    mockStream([
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
