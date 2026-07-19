import { renderHook, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearDraft, getDraft, setDraft } from "../../src/store/composer";
import {
  answerQuestion,
  initChat,
  reattachTurn,
  removeSteer,
  resumeCall,
  retryLastTurn,
  runShell,
  sendMessage,
  startNewThread,
  stopTurn,
  useChat,
} from "../../src/store/chat";
import type { Part } from "../../src/types";

/** A fake 409 "turn busy" response (D38): the thread-mutating endpoints return `{detail}` on collision. */
function status409(detail?: string): Response {
  return {
    ok: false,
    status: 409,
    body: null,
    headers: { get: () => null },
    json: async () => (detail !== undefined ? { detail } : {}),
  } as unknown as Response;
}

// store/chat — the streaming reducer (the most intricate frontend logic). We drive the REAL public API
// (sendMessage / resumeCall) through a mocked SSE `fetch`, so the real byte-parser + reducer run
// end-to-end and we assert the resulting message list / status. This locks in the SSE wire protocol
// handling (incl. the historical \n-vs-\r\n framing) without forking the reducer.

type Frame = { event: string; data: unknown; id?: string };

/** A fake `fetch` Response whose body streams the given SSE frames (one chunk, then close). A frame's
 *  optional `id` is emitted as the `id:` line (the D39 `turn_id:seq` cursor the seq gate reads). */
function sseResponse(frames: Frame[]): Response {
  const text = frames
    .map(
      (f) =>
        `event: ${f.event}\r\n${f.id ? `id: ${f.id}\r\n` : ""}data: ${JSON.stringify(f.data)}\r\n\r\n`,
    )
    .join("");
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
  return {
    ok: true,
    body,
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
    },
  } as unknown as Response;
}

function mockStream(frames: Frame[]) {
  globalThis.fetch = vi.fn(() => Promise.resolve(sseResponse(frames)));
}

/** Stream arbitrary raw text chunks (to test framing/splitting the structured helper can't express). */
function mockChunks(chunks: string[]) {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      body,
      headers: {
        get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
      },
    } as unknown as Response),
  );
}

function textOf(parts: Part[]): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
}

beforeEach(() => {
  startNewThread(); // reset the module-level store between cases
});

describe("chat streaming reducer", () => {
  it("a completed text turn yields user + assistant messages and goes idle", async () => {
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1", agent: null } },
      { event: "text.delta", data: { messageId: "m1", delta: "po" } },
      { event: "text.delta", data: { messageId: "m1", delta: "ng" } },
      { event: "done", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("ping");
    });

    expect(result.current.threadId).toBe("t1");
    expect(result.current.status).toBe("idle");
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].role).toBe("user");
    expect(textOf(result.current.messages[0].parts)).toBe("ping");
    expect(result.current.messages[1].role).toBe("assistant");
    expect(result.current.messages[1].id).toBe("m1"); // placeholder adopted the real id
    expect(textOf(result.current.messages[1].parts)).toBe("pong");
  });

  it("separates reasoning from the answer text", async () => {
    mockStream([
      { event: "message.start", data: { messageId: "m1" } },
      { event: "reasoning.delta", data: { messageId: "m1", delta: "let me think" } },
      { event: "text.delta", data: { messageId: "m1", delta: "the answer" } },
      { event: "done", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    const parts = result.current.messages[1].parts;
    expect(parts.find((p) => p.type === "reasoning")).toMatchObject({ text: "let me think" });
    expect(textOf(parts)).toBe("the answer");
  });

  it("a confirm-gated tool call suspends: the call goes awaiting_confirm, chat returns idle", async () => {
    mockStream([
      { event: "message.start", data: { messageId: "m1" } },
      {
        event: "part.added",
        data: {
          messageId: "m1",
          part: {
            type: "tool_call",
            call_id: "c1",
            tool: "wake_host",
            args: { host: "vault" },
            state: "pending",
          },
        },
      },
      { event: "tool.permission", data: { callId: "c1", token: "tok-1" } },
      { event: "done", data: { state: "suspended" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("wake vault");
    });

    expect(result.current.status).toBe("idle");
    const call = result.current.messages
      .flatMap((m) => m.parts)
      .find((p) => p.type === "tool_call" && p.call_id === "c1");
    expect(call).toMatchObject({ state: "awaiting_confirm" });
  });

  it("resolves a suspended call: resumeCall(execute) re-opens the stream and finishes", async () => {
    // First turn: suspend on confirm.
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" } },
      {
        event: "part.added",
        data: {
          messageId: "m1",
          part: { type: "tool_call", call_id: "c1", tool: "wake_host", args: {}, state: "pending" },
        },
      },
      { event: "tool.permission", data: { callId: "c1", token: "tok-1" } },
      { event: "done", data: { state: "suspended" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("wake");
    });

    // Resume: the tool result lands + a final answer + done completed.
    mockStream([
      {
        event: "tool.result",
        data: { callId: "c1", result: { state: "ok", summary: "woke vault" } },
      },
      { event: "message.start", data: { messageId: "m2" } },
      { event: "text.delta", data: { messageId: "m2", delta: "done" } },
      { event: "done", data: { state: "completed" } },
    ]);
    await act(async () => {
      await resumeCall("c1", "execute");
    });

    expect(result.current.status).toBe("idle");
    const toolResult = result.current.messages
      .flatMap((m) => m.parts)
      .find((p) => p.type === "tool_result" && p.call_id === "c1");
    expect(toolResult).toMatchObject({ result: { state: "ok", summary: "woke vault" } });
    expect(textOf(result.current.messages.at(-1)!.parts)).toBe("done");
  });

  it("an error event flips status to error with a retryable error part", async () => {
    mockStream([{ event: "error", data: { message: "boom" } }]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("x");
    });

    expect(result.current.status).toBe("error");
    const err = result.current.messages.at(-1)!.parts.find((p) => p.type === "error");
    expect(err).toMatchObject({ message: "boom", retryable: true });
  });

  // ── SSE byte-parser robustness (the historical \n-framing bug + multi-chunk reassembly) ──

  it("tolerates bare \\n frame separators (not only \\r\\n)", async () => {
    const f = (event: string, data: unknown) =>
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    mockChunks([
      f("message.start", { messageId: "m1" }),
      f("text.delta", { messageId: "m1", delta: "hi" }),
      f("done", { state: "completed" }),
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    expect(textOf(result.current.messages[1].parts)).toBe("hi");
    expect(result.current.status).toBe("idle");
  });

  it("reassembles a single frame split across two stream chunks", async () => {
    const frame = `event: text.delta\r\ndata: ${JSON.stringify({ messageId: "m1", delta: "spliced" })}\r\n\r\n`;
    const cut = Math.floor(frame.length / 2);
    mockChunks([
      `event: message.start\r\ndata: ${JSON.stringify({ messageId: "m1" })}\r\n\r\n` +
        frame.slice(0, cut),
      frame.slice(cut) + `event: done\r\ndata: ${JSON.stringify({ state: "completed" })}\r\n\r\n`,
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    expect(textOf(result.current.messages[1].parts)).toBe("spliced");
  });

  it("a notice event surfaces a system breadcrumb (D18 inference failover)", async () => {
    mockStream([
      { event: "message.start", data: { messageId: "m1" } },
      { event: "notice", data: { text: "// inference failover → cloud (primary unavailable)" } },
      { event: "text.delta", data: { messageId: "m1", delta: "answer" } },
      { event: "done", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    const sys = result.current.messages.find((m) => m.role === "system");
    expect(sys && textOf(sys.parts)).toContain("inference failover");
  });

  it("buffered (D17) JSON response re-reads the thread + seeds a confirm token", async () => {
    const msg = (id: string, role: string, text: string) => ({
      id,
      thread_id: "t1",
      role,
      parts: [{ type: "text", text }],
      actor: role === "user" ? "user" : "agent",
      ts: new Date().toISOString(),
      tokens: null,
      compacted: false,
    });
    globalThis.fetch = vi.fn((url: RequestInfo | URL) =>
      Promise.resolve(
        String(url).includes("/agent/chat")
          ? ({
              ok: true,
              body: {},
              headers: { get: () => "application/json" },
              json: async () => ({ threadId: "t1", state: "completed" }),
            } as unknown as Response)
          : ({
              ok: true,
              json: async () => [msg("u1", "user", "q"), msg("a1", "assistant", "buffered answer")],
            } as unknown as Response),
      ),
    );
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    expect(result.current.status).toBe("idle");
    expect(textOf(result.current.messages.at(-1)!.parts)).toBe("buffered answer");
  });
});

// ── J2: malformed-frame resilience. A valid-JSON but wrong-shape frame (backend edge / proxy mangling)
// must be DROPPED — never crash the reducer, never fail the turn — while valid frames still apply.
describe("malformed frame resilience (J2)", () => {
  it("drops a part.added with a garbage part but finishes the turn", async () => {
    mockStream([
      { event: "message.start", data: { messageId: "m1" } },
      { event: "part.added", data: { messageId: "m1", part: { type: "bogus" } } }, // unknown Part type
      { event: "part.added", data: { messageId: "m1", part: { nope: true } } }, // not a Part at all
      { event: "text.delta", data: { messageId: "m1", delta: "ok" } },
      { event: "done", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    const parts = result.current.messages[1].parts;
    expect(parts.some((p) => p.type === "tool_call" || p.type === "tool_result")).toBe(false);
    expect(textOf(parts)).toBe("ok"); // the valid frame still applied
    expect(result.current.status).toBe("idle"); // no crash, turn completed
  });

  it("drops a tool.result with an invalid state (no garbage result attached, call kept)", async () => {
    mockStream([
      { event: "message.start", data: { messageId: "m1" } },
      {
        event: "part.added",
        data: {
          messageId: "m1",
          part: { type: "tool_call", call_id: "c1", tool: "wake_host", args: {}, state: "pending" },
        },
      },
      { event: "tool.result", data: { callId: "c1", result: { state: "NOPE", summary: "x" } } },
      { event: "done", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    const flat = result.current.messages.flatMap((m) => m.parts);
    expect(flat.some((p) => p.type === "tool_result")).toBe(false); // bad result dropped
    expect(flat.some((p) => p.type === "tool_call" && p.call_id === "c1")).toBe(true); // call intact
    expect(result.current.status).toBe("idle");
  });

  it("drops a malformed compaction frame instead of a misleading 'nothing to compact' note", async () => {
    mockStream([
      { event: "message.start", data: { messageId: "m1" } },
      { event: "compaction", data: { removed: "lots" } }, // count not a number → drop, don't note
      { event: "text.delta", data: { messageId: "m1", delta: "ok" } },
      { event: "done", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    expect(result.current.messages.some((m) => m.role === "system")).toBe(false); // no breadcrumb
    expect(result.current.status).toBe("idle"); // valid frames still applied, turn completed
  });

  it("surfaces a well-formed compaction frame as a system breadcrumb", async () => {
    mockStream([
      { event: "message.start", data: { messageId: "m1" } },
      { event: "compaction", data: { removed: 3, truncated: false } },
      { event: "done", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    expect(result.current.messages.some((m) => m.role === "system")).toBe(true);
  });

  it("accepts a well-formed tool.result carrying unknown extra fields (passthrough-tolerant)", async () => {
    mockStream([
      { event: "message.start", data: { messageId: "m1" } },
      {
        event: "part.added",
        data: {
          messageId: "m1",
          part: { type: "tool_call", call_id: "c1", tool: "t", args: {}, state: "pending" },
        },
      },
      {
        event: "tool.result",
        data: { callId: "c1", result: { state: "ok", summary: "done", futureField: 2 } },
      },
      { event: "done", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    const tr = result.current.messages
      .flatMap((m) => m.parts)
      .find((p) => p.type === "tool_result");
    expect(tr).toMatchObject({ result: { state: "ok", summary: "done" } });
  });

  it("ignores an unknown event type and still processes the turn (forward-compat)", async () => {
    mockStream([
      { event: "message.start", data: { messageId: "m1" } },
      { event: "future.thing", data: { anything: [1, 2, 3] } }, // unknown → ignored, not an error
      { event: "text.delta", data: { messageId: "m1", delta: "hi" } },
      { event: "done", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    expect(textOf(result.current.messages[1].parts)).toBe("hi");
    expect(result.current.status).toBe("idle");
  });

  it("normalizes a non-object result.data / tool_call args to {} (no array masquerade)", async () => {
    mockStream([
      { event: "message.start", data: { messageId: "m1" } },
      {
        event: "part.added",
        data: {
          messageId: "m1",
          part: { type: "tool_call", call_id: "c1", tool: "t", args: [1, 2], state: "pending" },
        },
      },
      {
        event: "tool.result",
        data: { callId: "c1", result: { state: "ok", summary: "s", data: [1, 2, 3] } },
      },
      { event: "done", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    const flat = result.current.messages.flatMap((m) => m.parts);
    const call = flat.find((p) => p.type === "tool_call");
    if (call?.type === "tool_call") {
      expect(Array.isArray(call.args)).toBe(false);
      expect(typeof call.args).toBe("object");
    }
    const tr = flat.find((p) => p.type === "tool_result");
    if (tr?.type === "tool_result") expect(Array.isArray(tr.result.data)).toBe(false);
  });

  it("drops a message.start / delta with no messageId without crashing", async () => {
    mockStream([
      { event: "message.start", data: { agent: null } }, // no messageId → dropped
      { event: "text.delta", data: { delta: "orphan" } }, // no messageId → dropped
      { event: "done", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    expect(result.current.status).toBe("idle"); // graceful: turn produced no text, no crash
  });
});

// ── I4: risk-aware retry. A failed turn that ran a NON-retry-safe tool must not one-click auto-resend
// (it could silently repeat a reboot/restart/shell); it's copied to the composer for a conscious re-send.
// A read-only/idempotent turn auto-resends as before. `retryLastTurn(isRetrySafe)` takes the predicate.
describe("risk-aware retry (I4)", () => {
  async function failedTurnWith(tool: string) {
    // A turn that runs `tool`, then errors — leaving a retryable errored assistant bubble.
    mockStream([
      { event: "message.start", data: { messageId: "m1" } },
      {
        event: "part.added",
        data: {
          messageId: "m1",
          part: { type: "tool_call", call_id: "c1", tool, args: {}, state: "ok" },
        },
      },
      { event: "error", data: { message: "boom" } },
    ]);
    const hook = renderHook(() => useChat());
    await act(async () => {
      await sendMessage(`do ${tool}`);
    });
    expect(hook.result.current.status).toBe("error");
    return hook;
  }

  it("copies to the composer (no auto-resend) when the failed turn ran a mutating tool", async () => {
    clearDraft();
    const { result } = await failedTurnWith("reboot_host");
    const before = vi.mocked(globalThis.fetch).mock.calls.length;

    act(() => {
      retryLastTurn((tool) => tool !== "reboot_host"); // reboot_host is NOT retry-safe
    });

    expect(getDraft()).toBe("do reboot_host"); // handed to the composer for review
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(before); // did NOT auto-resend
    expect(result.current.messages.some((m) => m.parts.some((p) => p.type === "error"))).toBe(
      false,
    );
  });

  it("auto-resends (no draft copy) when the failed turn only ran retry-safe tools", async () => {
    clearDraft();
    await failedTurnWith("ping_host");
    const before = vi.mocked(globalThis.fetch).mock.calls.length;

    await act(async () => {
      retryLastTurn(() => true); // ping_host is retry-safe → auto-resend
    });

    expect(getDraft()).toBe(""); // NOT copied to the composer
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBeGreaterThan(before); // a resend fired
  });

  it("treats an unknown tool as unsafe (conservative — catalog gaps copy to the composer)", async () => {
    clearDraft();
    const { result } = await failedTurnWith("some_future_tool");
    const before = vi.mocked(globalThis.fetch).mock.calls.length;

    act(() => {
      retryLastTurn(() => false); // predicate: nothing known-safe (e.g. catalog not loaded)
    });

    expect(getDraft()).toBe("do some_future_tool");
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(before);
    // errored turn cleared; only the "review and send" system breadcrumb remains.
    expect(result.current.messages.some((m) => m.parts.some((p) => p.type === "error"))).toBe(
      false,
    );
  });
});

// ── Slice 2 (D38 turn integrity) — the client half: 409 as a sys-note (not a retryable error bubble),
// streaming guards, and the turn's inference `mode` carried across a resume (ACA-16). ──
describe("turn integrity — client (Slice 2)", () => {
  it("a 409 (thread busy) surfaces the server detail as a sys-note and returns idle — no error bubble", async () => {
    const detail = "a turn is already running on this thread — wait for it to finish";
    globalThis.fetch = vi.fn(() => Promise.resolve(status409(detail)));
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("hi");
    });

    expect(result.current.status).toBe("idle"); // NOT "error"
    // No retryable error bubble anywhere (failStream must not fire on a 409).
    expect(result.current.messages.some((m) => m.parts.some((p) => p.type === "error"))).toBe(
      false,
    );
    // The server's actionable detail landed as a system breadcrumb.
    const sys = result.current.messages.find((m) => m.role === "system");
    expect(sys && textOf(sys.parts)).toContain("a turn is already running");
    // BOTH optimistic bubbles were dropped — the unclaimed assistant placeholder AND the rejected
    // user message (never persisted; leaving it would render as sent-then-vanished). Only the sys
    // note remains (C6-a regression guard).
    expect(result.current.messages.some((m) => m.role === "assistant")).toBe(false);
    expect(result.current.messages.some((m) => m.role === "user")).toBe(false);
    expect(result.current.messages).toHaveLength(1); // just the sys note
  });

  it("a 409 with a non-JSON body falls back to the canonical busy text", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 409,
        body: null,
        headers: { get: () => null },
        json: async () => {
          throw new Error("not json");
        },
      } as unknown as Response),
    );
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("hi");
    });
    const sys = result.current.messages.find((m) => m.role === "system");
    expect(sys && textOf(sys.parts)).toContain("a turn is already running on this thread");
    expect(result.current.status).toBe("idle");
  });

  it("startNewThread is blocked while a turn is streaming (does not clear)", async () => {
    // Hold the SSE body open so the turn stays in "streaming" while we try to clear.
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body,
        headers: {
          get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
        },
      } as unknown as Response),
    );

    const { result } = renderHook(() => useChat());
    let sendP!: Promise<void>;
    await act(async () => {
      sendP = sendMessage("hi"); // sets status "streaming" synchronously, then holds on the open body
    });
    expect(result.current.status).toBe("streaming");

    act(() => {
      startNewThread(); // must be refused: a turn is live
    });
    expect(result.current.status).toBe("streaming"); // NOT reset to idle
    expect(
      result.current.messages.some(
        (m) => m.role === "system" && textOf(m.parts).includes("a turn is running"),
      ),
    ).toBe(true);
    expect(result.current.messages.some((m) => m.role === "user")).toBe(true); // log not wiped

    // Let the held turn finish so nothing leaks into the next case.
    const enc = new TextEncoder();
    controller.enqueue(
      enc.encode(`event: done\r\ndata: ${JSON.stringify({ state: "completed" })}\r\n\r\n`),
    );
    controller.close();
    await act(async () => {
      await sendP;
    });
  });

  it("a resume carries the turn's stashed inference mode (ACA-16)", async () => {
    // Turn 1: a `/cloud` send that suspends on a confirm bubble — stashes turnMode = "cloud".
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" } },
      {
        event: "part.added",
        data: {
          messageId: "m1",
          part: { type: "tool_call", call_id: "c1", tool: "wake_host", args: {}, state: "pending" },
        },
      },
      { event: "tool.permission", data: { callId: "c1", token: "tok-1" } },
      { event: "done", data: { state: "suspended" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("wake", { mode: "cloud" });
    });
    expect(result.current.status).toBe("idle"); // suspended → interactive

    // Resume: capture the POST body and assert the stashed mode rode along.
    let resumeBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      resumeBody = JSON.parse(init!.body as string) as Record<string, unknown>;
      return Promise.resolve(sseResponse([{ event: "done", data: { state: "completed" } }]));
    });
    await act(async () => {
      await resumeCall("c1", "execute");
    });
    expect(resumeBody.mode).toBe("cloud");
  });

  it("a resume of a default (no /mode) turn carries mode: null", async () => {
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" } },
      {
        event: "part.added",
        data: {
          messageId: "m1",
          part: { type: "tool_call", call_id: "c1", tool: "wake_host", args: {}, state: "pending" },
        },
      },
      { event: "tool.permission", data: { callId: "c1", token: "tok-1" } },
      { event: "done", data: { state: "suspended" } },
    ]);
    renderHook(() => useChat());
    await act(async () => {
      await sendMessage("wake"); // no mode → turnMode = null
    });
    let resumeBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      resumeBody = JSON.parse(init!.body as string) as Record<string, unknown>;
      return Promise.resolve(sseResponse([{ event: "done", data: { state: "completed" } }]));
    });
    await act(async () => {
      await resumeCall("c1", "dismiss");
    });
    expect(resumeBody.mode).toBeNull();
  });
});

// ── Slice 7 (D43) — inference retry/failover LIVE notes + the retry_status re-attach render. ──
describe("inference retry/failover notes (Slice 7, D43)", () => {
  const sysNotes = (msgs: { role: string; parts: Part[] }[]) =>
    msgs.filter((m) => m.role === "system").map((m) => textOf(m.parts));

  it("an inference.retry event renders the house-voice retry note", async () => {
    mockStream([
      { event: "message.start", data: { messageId: "m1" } },
      {
        event: "inference.retry",
        data: { endpoint: "local", attempt: 1, max: 2, delaySeconds: 2, category: "transient" },
      },
      { event: "text.delta", data: { messageId: "m1", delta: "ok" } },
      { event: "done", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    expect(sysNotes(result.current.messages)).toContain(
      "// retrying local in 2s (attempt 1/2 — transient)",
    );
    expect(result.current.status).toBe("idle");
  });

  it("an inference.failover event renders the house-voice failover note", async () => {
    mockStream([
      { event: "message.start", data: { messageId: "m1" } },
      { event: "inference.failover", data: { from: "local", to: "cloud", category: "other" } },
      { event: "text.delta", data: { messageId: "m1", delta: "ok" } },
      { event: "done", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    expect(sysNotes(result.current.messages)).toContain("// failover → cloud (other)");
  });

  it("drops a malformed inference.retry / inference.failover instead of half-rendering", async () => {
    mockStream([
      { event: "message.start", data: { messageId: "m1" } },
      { event: "inference.retry", data: { endpoint: "local", category: "transient" } }, // no numbers → drop
      { event: "inference.failover", data: { from: "local", category: "other" } }, // no `to` → drop
      { event: "text.delta", data: { messageId: "m1", delta: "ok" } },
      { event: "done", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    expect(result.current.messages.some((m) => m.role === "system")).toBe(false);
    expect(result.current.status).toBe("idle"); // valid frames still applied
  });
});

describe("retry_status re-attach render (Slice 7, D43)", () => {
  /** Seed thread t1 (a completed turn) so a subsequent reattachTurn has a thread to attach to. */
  async function seedThread() {
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "seed" } },
      { event: "done", data: { state: "completed" } },
    ]);
    await act(async () => {
      await sendMessage("hello");
    });
  }

  /** A re-attach fetch: `/stream` yields a `turn.sync` carrying `retry_status` (with the given absolute
   *  `untilTs`, epoch SECONDS) then a suspended `done`; the durable-floor reload returns one user msg. */
  function mockReattach(untilTs: number) {
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/stream")) {
        return Promise.resolve(
          sseResponse([
            {
              event: "turn.sync",
              id: "T9:5",
              data: {
                seq: 5,
                terminal: null,
                retry_status: { endpoint: "local", attempt: 1, max: 2, untilTs },
              },
            },
            { event: "done", id: "T9:6", data: { state: "suspended" } },
          ]),
        );
      }
      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "u1",
            thread_id: "t1",
            role: "user",
            parts: [{ type: "text", text: "q" }],
            actor: "user",
            ts: "",
            tokens: null,
            compacted: false,
          },
        ],
      } as unknown as Response);
    });
  }

  it("renders the retry line once for a future backoff — no duplicate on a snapshot replay", async () => {
    const { result } = renderHook(() => useChat());
    await seedThread();
    const untilTs = Date.now() / 1000 + 60; // 60s in the future — backoff still pending

    mockReattach(untilTs);
    await act(async () => {
      await reattachTurn("t1", "T1:2");
    });
    mockReattach(untilTs); // the SAME backoff replayed on a second re-attach
    await act(async () => {
      await reattachTurn("t1", "T1:2");
    });

    const notes = result.current.messages.filter(
      (m) => m.role === "system" && textOf(m.parts).includes("retrying local"),
    );
    expect(notes).toHaveLength(1); // the forced reload wipes the prior client note → exactly one, never stacked
    expect(textOf(notes[0].parts)).toBe("// retrying local (attempt 1/2)…");
  });

  it("renders nothing for an already-expired untilTs", async () => {
    const { result } = renderHook(() => useChat());
    await seedThread();
    mockReattach(Date.now() / 1000 - 60); // backoff already elapsed
    await act(async () => {
      await reattachTurn("t1", "T1:2");
    });
    expect(
      result.current.messages.some(
        (m) => m.role === "system" && textOf(m.parts).includes("retrying"),
      ),
    ).toBe(false);
  });
});

// ── Slice 3 (D39 durable turns) — the client half: the seq entry gate, the `turn.sync` re-attach
// overlay (REPLACE semantics + token/mode re-pin), the interrupt-path re-attach, the cold-load probe,
// and the Stop button. ──

/** A live-stream fetch that streams `frames` then closes WITHOUT settling (no `done`) — models a
 *  socket cut mid-turn (the ACA-1 case). */
function sseResponseUnterminated(frames: Frame[]): Response {
  return sseResponse(frames); // sseResponse never appends `done`; omit it for the unterminated case
}

describe("durable turns — client (Slice 3, D39)", () => {
  it("the seq gate drops a duplicate-seq frame and resets on a new turn_id", async () => {
    // Turn T1: seq 2 arrives twice ('a' then a duplicate 'b') — the second is dropped; 'c' at seq 3 applies.
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", id: "T1:1", data: { messageId: "m1" } },
      { event: "text.delta", id: "T1:2", data: { messageId: "m1", delta: "a" } },
      { event: "text.delta", id: "T1:2", data: { messageId: "m1", delta: "b" } }, // dup seq → dropped
      { event: "text.delta", id: "T1:3", data: { messageId: "m1", delta: "c" } },
      { event: "done", id: "T1:4", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    expect(textOf(result.current.messages[1].parts)).toBe("ac"); // 'b' deduped by the gate

    // Turn T2: a NEW turn_id resets the gate, so seq 1/2 apply even though they are ≤ T1's last seq (4).
    mockStream([
      { event: "message.start", id: "T2:1", data: { messageId: "m2" } },
      { event: "text.delta", id: "T2:2", data: { messageId: "m2", delta: "x" } },
      { event: "done", id: "T2:3", data: { state: "completed" } },
    ]);
    await act(async () => {
      await sendMessage("q2");
    });
    expect(textOf(result.current.messages.at(-1)!.parts)).toBe("x"); // new turn → gate reset, applied
  });

  it("turn.sync overlay REPLACES the open message text (no double-append) + seeds the confirm token & mode", async () => {
    // Establish thread t1.
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "seed" } },
      { event: "done", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("hello");
    });

    // Re-attach: the forced reload returns m1 with a PARTIAL "Hel"; the snapshot carries the FULL
    // "Hello" (must replace, not append) + a pending confirm call with a token + mode "cloud".
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/stream")) {
        return Promise.resolve(
          sseResponse([
            {
              event: "turn.sync",
              id: "T9:5",
              data: {
                mode: "cloud",
                seq: 5,
                terminal: null,
                message: { id: "m1", role: "assistant", agent: null, text: "Hello", reasoning: "" },
                calls: [
                  {
                    call_id: "c1",
                    tool: "wake_host",
                    args: { host: "vault" },
                    state: "awaiting_confirm",
                    permission: { token: "tok-9" },
                  },
                ],
              },
            },
            { event: "done", id: "T9:6", data: { state: "suspended" } },
          ]),
        );
      }
      // reloadChat(true) → the durable floor: a persisted user msg + a PARTIAL m1.
      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "u1",
            thread_id: "t1",
            role: "user",
            parts: [{ type: "text", text: "q" }],
            actor: "user",
            ts: "",
            tokens: null,
            compacted: false,
          },
          {
            id: "m1",
            thread_id: "t1",
            role: "assistant",
            parts: [{ type: "text", text: "Hel" }],
            actor: "agent",
            ts: "",
            tokens: null,
            compacted: false,
          },
        ],
      } as unknown as Response);
    });

    await act(async () => {
      await reattachTurn("t1", "T1:2");
    });
    const m1 = result.current.messages.find((m) => m.id === "m1")!;
    expect(textOf(m1.parts)).toBe("Hello"); // REPLACED wholesale (not "HelHello")
    const call = m1.parts.find((p) => p.type === "tool_call" && p.call_id === "c1");
    expect(call).toMatchObject({ state: "awaiting_confirm" });

    // The token + the snapshot's mode were re-pinned: a resume of c1 carries both.
    let resumeBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      resumeBody = JSON.parse(init!.body as string) as Record<string, unknown>;
      return Promise.resolve(sseResponse([{ event: "done", data: { state: "completed" } }]));
    });
    await act(async () => {
      await resumeCall("c1", "execute");
    });
    expect(resumeBody.confirm_token).toBe("tok-9"); // seeded from the snapshot permission payload
    expect(resumeBody.mode).toBe("cloud"); // modeByCall / turnMode re-pinned from snapshot.mode
  });

  it("an interrupted stream re-attaches (turn.sync + done) BEFORE surfacing a failure — no error bubble", async () => {
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/agent/chat")) {
        // Dies mid-turn: message.start + a partial delta, then close with NO `done`.
        return Promise.resolve(
          sseResponseUnterminated([
            { event: "thread", data: { threadId: "t1" } },
            { event: "message.start", id: "T1:1", data: { messageId: "m1" } },
            { event: "text.delta", id: "T1:2", data: { messageId: "m1", delta: "Hel" } },
          ]),
        );
      }
      if (u.includes("/stream")) {
        return Promise.resolve(
          sseResponse([
            {
              event: "turn.sync",
              id: "T1:2",
              data: {
                mode: null,
                seq: 2,
                terminal: null,
                message: { id: "m1", role: "assistant", agent: null, text: "Hello", reasoning: "" },
                calls: [],
              },
            },
            { event: "done", id: "T1:3", data: { state: "completed" } },
          ]),
        );
      }
      // reloadChat(true) during the overlay → the persisted floor (m1 not yet persisted).
      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "u1",
            thread_id: "t1",
            role: "user",
            parts: [{ type: "text", text: "q" }],
            actor: "user",
            ts: "",
            tokens: null,
            compacted: false,
          },
        ],
      } as unknown as Response);
    });

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });

    // The re-attach endpoint was hit, the turn completed, and NO retryable error bubble was shown.
    const hitStream = vi
      .mocked(globalThis.fetch)
      .mock.calls.some((c) => String(c[0]).includes("/stream"));
    expect(hitStream).toBe(true);
    expect(result.current.status).toBe("idle");
    expect(result.current.messages.some((m) => m.parts.some((p) => p.type === "error"))).toBe(
      false,
    );
    expect(textOf(result.current.messages.find((m) => m.id === "m1")!.parts)).toBe("Hello");
  });

  it("a turn that COMPLETED during the drop reloads from the durable floor — no false error, no retry trap (audit MED-2)", async () => {
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/agent/chat")) {
        // Dies mid-turn with NO `done` — but server-side the turn actually finished + released.
        return Promise.resolve(
          sseResponseUnterminated([
            { event: "thread", data: { threadId: "t1" } },
            { event: "message.start", id: "T1:1", data: { messageId: "m1" } },
            { event: "text.delta", id: "T1:2", data: { messageId: "m1", delta: "Hel" } },
          ]),
        );
      }
      if (u.includes("/stream")) {
        // The re-attach finds no live turn: the D39 JSON terminal answer.
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ active: false, terminal_status: "completed", turn_id: "T1" }),
        } as unknown as Response);
      }
      // The forced reload → the persisted floor carries the COMPLETED assistant message.
      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "u1",
            thread_id: "t1",
            role: "user",
            parts: [{ type: "text", text: "q" }],
            actor: "user",
            ts: "",
            tokens: null,
            compacted: false,
          },
          {
            id: "m1",
            thread_id: "t1",
            role: "assistant",
            parts: [{ type: "text", text: "Hello — done." }],
            actor: "agent",
            ts: "",
            tokens: null,
            compacted: false,
          },
        ],
      } as unknown as Response);
    });

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });

    // Reconciled from the durable floor: the persisted answer renders, status settles idle, and
    // there is NO retryable error bubble (the pre-fix behavior was failStream("connection
    // interrupted") — a duplicate-send retry trap over a turn that had actually succeeded).
    expect(result.current.status).toBe("idle");
    expect(result.current.messages.some((m) => m.parts.some((p) => p.type === "error"))).toBe(
      false,
    );
    expect(textOf(result.current.messages.find((m) => m.id === "m1")!.parts)).toBe("Hello — done.");
  });

  it("cold-load probe re-attaches to a still-running detached turn (active:true)", async () => {
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/turns/t1/stream")) {
        return Promise.resolve(
          sseResponse([
            {
              event: "turn.sync",
              id: "T1:3",
              data: {
                mode: null,
                seq: 3,
                terminal: null,
                message: {
                  id: "m9",
                  role: "assistant",
                  agent: null,
                  text: "resumed",
                  reasoning: "",
                },
                calls: [],
              },
            },
            { event: "done", id: "T1:4", data: { state: "completed" } },
          ]),
        );
      }
      if (u.includes("/agent/turns/t1"))
        return Promise.resolve({
          ok: true,
          json: async () => ({ active: true, turn_id: "T1", seq: 3 }),
        } as unknown as Response);
      if (u.includes("/messages"))
        return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
      if (u.includes("/threads"))
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: "t1", title: "t", agent: null }],
        } as unknown as Response);
      return Promise.resolve({ ok: true, json: async () => ({}) } as unknown as Response);
    });

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await initChat();
    });
    // The probe re-attaches non-blockingly after paint — wait for the resumed turn to land.
    await waitFor(() => expect(result.current.messages.some((m) => m.id === "m9")).toBe(true));
    expect(textOf(result.current.messages.find((m) => m.id === "m9")!.parts)).toBe("resumed");
    expect(result.current.status).toBe("idle");
  });

  it("stopTurn posts cancel once (double-tap guarded) and settles on the streamed done{cancelled}", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        // Emit `thread` up front so state.threadId is set (Stop needs it), then hold open.
        c.enqueue(
          new TextEncoder().encode(
            `event: thread\r\ndata: ${JSON.stringify({ threadId: "t1" })}\r\n\r\n`,
          ),
        );
      },
    });
    let cancelCalls = 0;
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      if (String(url).includes("/cancel")) {
        cancelCalls++;
        return Promise.resolve({
          ok: true,
          json: async () => ({ cancelled: true, terminal_status: "cancelled" }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        body,
        headers: {
          get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
        },
      } as unknown as Response);
    });

    const { result } = renderHook(() => useChat());
    let sendP!: Promise<void>;
    await act(async () => {
      sendP = sendMessage("hi"); // status → streaming, holds on the open body
    });
    expect(result.current.status).toBe("streaming");

    await act(async () => {
      await Promise.all([stopTurn(), stopTurn()]); // double-tap
    });
    expect(cancelCalls).toBe(1); // guarded — exactly one cancel POST

    // The server's done{cancelled} arrives via the still-attached stream → settles normally.
    const enc = new TextEncoder();
    controller.enqueue(
      enc.encode(`event: done\r\ndata: ${JSON.stringify({ state: "cancelled" })}\r\n\r\n`),
    );
    controller.close();
    await act(async () => {
      await sendP;
    });
    expect(result.current.status).toBe("idle");
  });

  it("stopTurn ALWAYS reloads from the durable floor so an attached call renders cancelled (item 3)", async () => {
    // A streaming turn with a still-pending tool_call bubble. The live-cancel reply carries NO
    // active:false (the drain task's done{cancelled} settles status), so the pre-fix stopTurn never
    // reloaded — leaving the local call part spinning forever even though the DB was reconciled. The
    // fix forces reloadChat(true) on every OK cancel; the reloaded floor shows c1 CANCELLED.
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        c.enqueue(
          enc.encode(`event: thread\r\ndata: ${JSON.stringify({ threadId: "t1" })}\r\n\r\n`),
        );
        c.enqueue(
          enc.encode(
            `event: message.start\r\nid: T1:1\r\ndata: ${JSON.stringify({ messageId: "m1" })}\r\n\r\n`,
          ),
        );
        c.enqueue(
          enc.encode(
            `event: part.added\r\nid: T1:2\r\ndata: ${JSON.stringify({
              messageId: "m1",
              part: {
                type: "tool_call",
                call_id: "c1",
                tool: "wake_host",
                args: {},
                state: "running",
              },
            })}\r\n\r\n`,
          ),
        );
      },
    });
    let reloadCalls = 0;
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/cancel")) {
        // LIVE cancel reply — no active:false (the stream's done{cancelled} settles status).
        return Promise.resolve({
          ok: true,
          json: async () => ({ cancelled: true, terminal_status: "cancelled" }),
        } as unknown as Response);
      }
      if (u.includes("/messages")) {
        reloadCalls++;
        // The durable floor: the drain task's cancel path already reconciled c1 → CANCELLED.
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "m1",
              thread_id: "t1",
              role: "assistant",
              parts: [
                {
                  type: "tool_call",
                  call_id: "c1",
                  tool: "wake_host",
                  args: {},
                  state: "cancelled",
                },
              ],
              actor: "agent",
              ts: "",
              tokens: null,
              compacted: false,
            },
          ],
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        body,
        headers: {
          get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
        },
      } as unknown as Response);
    });

    const { result } = renderHook(() => useChat());
    let sendP!: Promise<void>;
    await act(async () => {
      sendP = sendMessage("hi");
    });
    // the pending call bubble is showing (spinning)
    await waitFor(() =>
      expect(
        result.current.messages.some((m) =>
          m.parts.some((p) => p.type === "tool_call" && p.call_id === "c1"),
        ),
      ).toBe(true),
    );

    await act(async () => {
      await stopTurn();
    });
    expect(reloadCalls).toBeGreaterThan(0); // the forced reload fired even on the live-cancel path

    // the stream's own done{cancelled} then settles status; the reloaded call renders cancelled
    controller.enqueue(
      enc.encode(
        `event: done\r\nid: T1:3\r\ndata: ${JSON.stringify({ state: "cancelled" })}\r\n\r\n`,
      ),
    );
    controller.close();
    await act(async () => {
      await sendP;
    });
    const call = result.current.messages
      .flatMap((m) => m.parts)
      .find((p) => p.type === "tool_call" && p.call_id === "c1");
    expect(call).toMatchObject({ state: "cancelled" });
    expect(result.current.status).toBe("idle");
  });

  it("reattachTurn ignores a non-ok / non-active JSON re-attach reply (item 7)", async () => {
    // A JSON 409 (version skew / a proxy error page with a JSON content-type) must NOT be read as a
    // completed turn — that would reload + settle idle + drop the Stop affordance while the turn is
    // still running. The JSON branch now requires res.ok AND active:false; anything else → false.
    let reloads = 0;
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/stream")) {
        return Promise.resolve({
          ok: false,
          status: 409,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ detail: "a turn is already running" }),
        } as unknown as Response);
      }
      reloads++;
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });

    const ok = await reattachTurn("t1", "T1:2");
    expect(ok).toBe(false); // not treated as a completed turn — the caller falls back
    expect(reloads).toBe(0); // no forced reload / settle fired off the bad JSON

    // A genuine terminal reply (res.ok + active:false) still reloads and reports handled.
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/stream")) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ active: false, terminal_status: "completed", turn_id: "T1" }),
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    expect(await reattachTurn("t1", "T1:2")).toBe(true);
  });

  // NOTE: the Slice-5 (D41) steering-queue tests live in their own describe block at the end of this file.

  // Item 6 (probe races a user-started stream): the guard MOVED into `reattachTurn(requireIdle=true)`
  // (C4-M1) — it now re-checks status AFTER its own fetch await, closing the second race window the
  // old probe-only check missed. `reattachTurn` is exported, so the guard is now directly testable
  // (see "the client half — formal-audit wave C" below); the old "document, don't test" note is
  // superseded. `probeAndReattach` itself stays a private fire-and-forget off `initChat`.
});

// ── Formal-audit wave C (client) — skills carried across resume (C5-M1), buffered-question mode/skills
// pinning (C3-M4), the cold-probe requireIdle guard (C4-M1), and the missing-regression batch (C6). ──
describe("the client half — formal-audit wave C", () => {
  /** Suspend a fresh turn on a confirm bubble for call `c1`, sent with the given opts. */
  async function sendAndSuspend(
    text: string,
    opts?: { mode?: "local" | "cloud"; skills?: string[] },
  ) {
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" } },
      {
        event: "part.added",
        data: {
          messageId: "m1",
          part: { type: "tool_call", call_id: "c1", tool: "wake_host", args: {}, state: "pending" },
        },
      },
      { event: "tool.permission", data: { callId: "c1", token: "tok-1" } },
      { event: "done", data: { state: "suspended" } },
    ]);
    await act(async () => {
      await sendMessage(text, opts);
    });
  }

  it("a resume carries the turn's PINNED skills after an interleaved send changed turnSkills (C5-M1)", async () => {
    const { result } = renderHook(() => useChat());
    await sendAndSuspend("wake", { skills: ["deploy"] }); // pins skillsByCall[c1] = ["deploy"]
    expect(result.current.status).toBe("idle");

    // An interleaved send with DIFFERENT skills overwrites the module-level turnSkills.
    mockStream([
      { event: "message.start", data: { messageId: "m2" } },
      { event: "text.delta", data: { messageId: "m2", delta: "ok" } },
      { event: "done", data: { state: "completed" } },
    ]);
    await act(async () => {
      await sendMessage("hi", { skills: ["backups"] });
    });

    // Resume c1: the payload must carry the ORIGINAL turn's skills, not the interleaved send's.
    let resumeBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      resumeBody = JSON.parse(init!.body as string) as Record<string, unknown>;
      return Promise.resolve(sseResponse([{ event: "done", data: { state: "completed" } }]));
    });
    await act(async () => {
      await resumeCall("c1", "execute");
    });
    expect(resumeBody.skills).toEqual(["deploy"]);
  });

  it("a buffered question pins the turn's mode + skills across an interleaved send (C3-M4)", async () => {
    // Turn 1: a BUFFERED (JSON) response carrying a `question` (no token), sent with /cloud + a skill.
    globalThis.fetch = vi.fn((url: RequestInfo | URL) =>
      Promise.resolve(
        String(url).includes("/agent/chat")
          ? ({
              ok: true,
              body: {},
              headers: { get: () => "application/json" },
              json: async () => ({
                threadId: "t1",
                state: "suspended",
                question: { callId: "cq" },
              }),
            } as unknown as Response)
          : ({ ok: true, json: async () => [] } as unknown as Response),
      ),
    );
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("ask", { mode: "cloud", skills: ["deploy"] });
    });
    expect(result.current.status).toBe("idle");

    // An interleaved send with different mode/skills overwrites the module-level turnMode/turnSkills.
    mockStream([
      { event: "message.start", data: { messageId: "m2" } },
      { event: "done", data: { state: "completed" } },
    ]);
    await act(async () => {
      await sendMessage("hi", { mode: "local", skills: ["backups"] });
    });

    // answerQuestion cq must carry the ORIGINAL buffered turn's mode + skills, not the interleave's.
    let body: Record<string, unknown> = {};
    globalThis.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(init!.body as string) as Record<string, unknown>;
      return Promise.resolve(sseResponse([{ event: "done", data: { state: "completed" } }]));
    });
    await act(async () => {
      await answerQuestion("cq", "yes");
    });
    expect(body.mode).toBe("cloud");
    expect(body.skills).toEqual(["deploy"]);
  });

  it("reattachTurn(requireIdle) bails without applying frames when a send flipped to streaming (C4-M1)", async () => {
    // Hold a send open so status is "streaming" (mirrors the startNewThread-blocked test's pattern).
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const held = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/stream")) {
        // The re-attach stream WOULD apply a message.start for "zzz" if not bailed.
        return Promise.resolve(
          sseResponse([
            { event: "message.start", id: "T9:1", data: { messageId: "zzz" } },
            { event: "done", id: "T9:2", data: { state: "completed" } },
          ]),
        );
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        body: held,
        headers: {
          get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
        },
      } as unknown as Response);
    });

    const { result } = renderHook(() => useChat());
    let sendP!: Promise<void>;
    await act(async () => {
      sendP = sendMessage("hi"); // sets status "streaming", then holds on the open body
    });
    expect(result.current.status).toBe("streaming");

    // A cold-probe re-attach with requireIdle must NOT attach while a live stream owns the turn.
    let ok: boolean | undefined;
    await act(async () => {
      ok = await reattachTurn("t1", undefined, true);
    });
    expect(ok).toBe(false);
    expect(result.current.messages.some((m) => m.id === "zzz")).toBe(false); // no frame leaked in

    // Let the held turn finish so nothing leaks into the next case.
    const enc = new TextEncoder();
    controller.enqueue(
      enc.encode(`event: done\r\ndata: ${JSON.stringify({ state: "completed" })}\r\n\r\n`),
    );
    controller.close();
    await act(async () => {
      await sendP;
    });
  });

  it("runShell surfaces a 409 as the busy sys-note (not 'backend unreachable') (C6-b)", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        status409("a turn is already running on this thread — wait for it to finish"),
      ),
    );
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await runShell("ls");
    });
    const sys = result.current.messages.find((m) => m.role === "system");
    expect(sys && textOf(sys.parts)).toContain("a turn is already running");
    // The generic catch ("shell exec failed — backend unreachable?") must NOT fire on a 409.
    expect(
      result.current.messages.some(
        (m) => m.role === "system" && textOf(m.parts).includes("backend unreachable"),
      ),
    ).toBe(false);
  });

  it("a thrown read error (TCP reset) re-attaches BEFORE failing (C6-f)", async () => {
    // First a completed turn so `threadId` is set (the re-attach needs it).
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" } },
      { event: "done", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("first");
    });
    expect(result.current.threadId).toBe("t1");

    // Second send: the body's reader.read() REJECTS mid-stream (abrupt TCP reset). The catch branch
    // must ATTEMPT a re-attach (which reports the turn completed) before ever calling failStream.
    let streamCalls = 0;
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/stream")) {
        streamCalls++;
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ active: false, terminal_status: "completed", turn_id: "T1" }),
        } as unknown as Response);
      }
      if (u.includes("/messages")) {
        return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
      }
      const body = {
        getReader: () => ({
          read: () => Promise.reject(new Error("ECONNRESET")),
          cancel: async () => {},
        }),
      };
      return Promise.resolve({
        ok: true,
        body,
        headers: {
          get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
        },
      } as unknown as Response);
    });
    await act(async () => {
      await sendMessage("second");
    });
    expect(streamCalls).toBeGreaterThan(0); // the re-attach was attempted
    // It reported the turn completed → NO retryable error bubble (the drop was recovered).
    expect(result.current.messages.some((m) => m.parts.some((p) => p.type === "error"))).toBe(
      false,
    );
  });

  it("a JSON re-attach on a `capped` terminal surfaces the step-limit note (C6-g)", async () => {
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/stream")) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ active: false, terminal_status: "capped", turn_id: "T1" }),
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    const { result } = renderHook(() => useChat());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await reattachTurn("t1");
    });
    expect(ok).toBe(true);
    expect(
      result.current.messages.some(
        (m) => m.role === "system" && textOf(m.parts).includes("reached the step limit"),
      ),
    ).toBe(true);
  });

  it("a JSON re-attach on an `error` terminal renders a failStream error part (C6-g)", async () => {
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/stream")) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ active: false, terminal_status: "error", turn_id: "T1" }),
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    const { result } = renderHook(() => useChat());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await reattachTurn("t1");
    });
    expect(ok).toBe(true);
    expect(result.current.messages.some((m) => m.parts.some((p) => p.type === "error"))).toBe(true);
    expect(result.current.status).toBe("error");
  });
});

// ── Slice 5 (D41 steering queue) — the client half: the streaming send-guard is LIFTED (a send during a
// live turn is a STEER, enqueued via a 202), the 3-exit optimistic-bubble lifecycle, `steer.applied`
// swaps by entryId, the `turn.sync` steers fold, probe-on-done discovery of a drain-B turn, reload
// reconcile, Stop→draft harvest (raw-line fidelity), and the queued-bubble DELETE. ──

/** A 202 "queued steer" response (D41): the chat/exec endpoints return this while a chat/resume turn
 *  holds the marker. `res.ok` is true (2xx) — streamTurn's `status===202` branch catches it first. */
function resp202(entryId: string): Response {
  return {
    ok: true,
    status: 202,
    headers: { get: () => null },
    json: async () => ({ queued: true, turn_id: "T1", entry_id: entryId, position: 1, depth: 1 }),
  } as unknown as Response;
}

/** JSON helper for the probe / cancel / delete responses. */
function json(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as unknown as Response;
}

describe("steering queue — client (Slice 5, D41)", () => {
  const enc = new TextEncoder();

  // Probe-on-done discovery (`void probeAndReattach`) is fire-and-forget; drain any pending probe /
  // re-attach chain after each case so a floating promise can't inject a queued bubble into the NEXT
  // test's shared module state (the store is a singleton). `startNewThread` in the global beforeEach
  // then resets messages, so a drained probe settles harmlessly against the finishing test. The drain
  // waits past HIGH-2's ~250ms re-probe delay (probeAndReattach's drain-B window bridge) so that timer
  // fires + completes here, never inside the next case (its threadId guard also bails a stale reload).
  afterEach(async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 320));
    });
  });

  /** Open a turn whose FIRST /agent/chat POST is a held-open SSE stream (status → streaming, thread t1).
   *  All other fetches route through `dispatch`; an unmatched URL returns an empty messages array (the
   *  durable-floor default). Returns the held stream's controller + the held send promise. */
  async function heldTurn(dispatch: (u: string, init?: RequestInit) => Response | undefined) {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        c.enqueue(
          enc.encode(`event: thread\r\ndata: ${JSON.stringify({ threadId: "t1" })}\r\n\r\n`),
        );
      },
    });
    let chatCalls = 0;
    globalThis.fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/agent/chat")) {
        chatCalls++;
        if (chatCalls === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            body,
            headers: {
              get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
            },
          } as unknown as Response);
        }
      }
      const r = dispatch(u, init);
      if (r) return Promise.resolve(r);
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    const hook = renderHook(() => useChat());
    let sendP!: Promise<void>;
    await act(async () => {
      sendP = sendMessage("first");
    });
    expect(hook.result.current.status).toBe("streaming");
    const pushDone = () =>
      controller.enqueue(
        enc.encode(`event: done\r\ndata: ${JSON.stringify({ state: "completed" })}\r\n\r\n`),
      );
    return { hook, controller, sendP, pushDone };
  }

  it("202 → the optimistic user bubble becomes a queued steer (chip); the live turn is untouched", async () => {
    const { hook, controller, sendP, pushDone } = await heldTurn(() => undefined);
    // steer while streaming — the send-guard is lifted; the POST returns 202
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/agent/chat")) return Promise.resolve(resp202("e1"));
      // the post-done discovery probe keeps e1 queued (server-present); everything else → empty floor
      if (u.includes("/agent/turns/t1"))
        return Promise.resolve(
          json({
            active: false,
            steer_queue: [{ entry_id: "e1", kind: "message", text: "steer me" }],
          }),
        );
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    await act(async () => {
      await sendMessage("steer me", { raw: "steer me" });
    });
    const steer = hook.result.current.messages.find(
      (m) => m.role === "user" && textOf(m.parts) === "steer me",
    );
    expect(steer?.queued).toBe("e1"); // marked queued by entry_id
    expect(hook.result.current.status).toBe("streaming"); // the live turn kept the view

    await act(async () => {
      pushDone();
      controller.close();
      await sendP;
    });
    // the live turn settled; the queued steer survives the discovery reconcile (still server-present)
    await waitFor(() => expect(hook.result.current.status).toBe("idle"));
    expect(hook.result.current.messages.some((m) => m.queued === "e1")).toBe(true);
  });

  it("409 while steering rolls the steer bubble back with a sys-note; the live turn keeps streaming", async () => {
    const { hook, controller, sendP, pushDone } = await heldTurn(() => undefined);
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/agent/chat")) return Promise.resolve(status409("steer queue full"));
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    await act(async () => {
      await sendMessage("overflow", { raw: "overflow" });
    });
    // the rejected steer bubble is gone; a sys-note carries the detail; the live turn is still streaming
    expect(hook.result.current.messages.some((m) => textOf(m.parts) === "overflow")).toBe(false);
    expect(
      hook.result.current.messages.some(
        (m) => m.role === "system" && textOf(m.parts).includes("steer queue full"),
      ),
    ).toBe(true);
    expect(hook.result.current.status).toBe("streaming");

    pushDone();
    controller.close();
    await act(async () => {
      await sendP;
    });
  });

  it("steer.applied swaps a queued message bubble to its sent form (by entryId)", async () => {
    const { hook, controller, sendP } = await heldTurn(() => undefined);
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/agent/chat")) return Promise.resolve(resp202("e1"));
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    await act(async () => {
      await sendMessage("steer me", { raw: "steer me" });
    });
    expect(hook.result.current.messages.find((m) => m.queued === "e1")).toBeTruthy();

    // the running turn drains the steer → steer.applied on the live stream
    await act(async () => {
      controller.enqueue(
        enc.encode(
          `event: steer.applied\r\nid: T1:5\r\ndata: ${JSON.stringify({
            entryId: "e1",
            messageId: "u-real",
            kind: "message",
            text: "steer me",
          })}\r\n\r\n`,
        ),
      );
    });
    const swapped = hook.result.current.messages.find((m) => m.id === "u-real");
    expect(swapped).toBeTruthy();
    expect(swapped!.queued).toBeUndefined(); // no longer queued
    expect(hook.result.current.messages.some((m) => m.queued === "e1")).toBe(false);

    controller.enqueue(
      enc.encode(`event: done\r\ndata: ${JSON.stringify({ state: "completed" })}\r\n\r\n`),
    );
    controller.close();
    await act(async () => {
      await sendP;
    });
  });

  it("a queued `!exec` steer (runShell 202) resolves on steer.applied{kind:exec}", async () => {
    const { hook, controller, sendP } = await heldTurn(() => undefined);
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/api/exec")) return Promise.resolve(resp202("x1"));
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    await act(async () => {
      await runShell("ls -la");
    });
    const q = hook.result.current.messages.find((m) => m.queued === "x1");
    expect(q).toBeTruthy();
    expect(textOf(q!.parts)).toBe("!ls -la"); // the `!` sigil restored on the bubble

    await act(async () => {
      controller.enqueue(
        enc.encode(
          `event: steer.applied\r\nid: T1:6\r\ndata: ${JSON.stringify({
            entryId: "x1",
            messageId: "u-exec",
            kind: "exec",
          })}\r\n\r\n`,
        ),
      );
    });
    expect(hook.result.current.messages.some((m) => m.queued === "x1")).toBe(false); // resolved

    controller.enqueue(
      enc.encode(`event: done\r\ndata: ${JSON.stringify({ state: "completed" })}\r\n\r\n`),
    );
    controller.close();
    await act(async () => {
      await sendP;
    });
  });

  it("a turn.sync snapshot's `steers` fold dedups a queued bubble against the durable floor", async () => {
    // held turn (t1) → steer 202 (e1 queued) → close EOF w/o done → interrupt re-attach: the snapshot
    // folds steers[e1→u1] and the reload floor already carries the durable u1, so the queued dup drops.
    const { hook, controller, sendP } = await heldTurn((u) => {
      if (u.includes("/stream")) {
        return json({}); // replaced below via a full re-stub after the steer
      }
      return undefined;
    });
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/agent/chat")) return Promise.resolve(resp202("e1"));
      if (u.includes("/stream")) {
        return Promise.resolve(
          sseResponse([
            {
              event: "turn.sync",
              id: "T1:2",
              data: {
                mode: null,
                seq: 2,
                terminal: null,
                message: null,
                calls: [],
                steers: [{ entryId: "e1", messageId: "u1", kind: "message", text: "steered" }],
              },
            },
            { event: "done", id: "T1:3", data: { state: "completed" } },
          ]),
        );
      }
      // the forced reload floor carries the durable steered user message u1
      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "u1",
            thread_id: "t1",
            role: "user",
            parts: [{ type: "text", text: "steered" }],
            actor: "user",
            ts: "",
            tokens: null,
            compacted: false,
          },
        ],
      } as unknown as Response);
    });
    await act(async () => {
      await sendMessage("steered", { raw: "steered" });
    });
    expect(hook.result.current.messages.find((m) => m.queued === "e1")).toBeTruthy();

    controller.close(); // EOF w/o done → the clean-EOF re-attach path folds the steers
    await act(async () => {
      await sendP;
    });
    // the local queued dup was dropped; the durable u1 renders once; no leftover queued bubble
    expect(hook.result.current.messages.filter((m) => m.id === "u1")).toHaveLength(1);
    expect(hook.result.current.messages.some((m) => m.queued)).toBe(false);
    expect(hook.result.current.status).toBe("idle");
  });

  it("a turn.sync snapshot's `steer_queue` re-renders a PENDING queued bubble after the reload (MED-1, cold-load-with-pending-steers)", async () => {
    // Establish thread t1 with a prior completed reply.
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m0" } },
      { event: "text.delta", data: { messageId: "m0", delta: "prior reply" } },
      { event: "done", data: { state: "completed" } },
    ]);
    const hook = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });

    // Re-attach: the snapshot carries a PENDING steer (`steer_queue`, disjoint from any drained
    // `steers`). The forced reload returns the durable floor (the prior reply) — WITHOUT the client-only
    // queued bubble. MED-1: applyTurnSync must reconcile `steer_queue` AFTER the reload so the pending
    // bubble re-renders instead of being wiped by the floor.
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/stream")) {
        return Promise.resolve(
          sseResponse([
            {
              event: "turn.sync",
              id: "T7:3",
              data: {
                mode: null,
                seq: 3,
                terminal: null,
                message: null,
                calls: [],
                steer_queue: [{ entry_id: "p1", kind: "message", text: "pending steer" }],
              },
            },
            { event: "done", id: "T7:4", data: { state: "completed" } },
          ]),
        );
      }
      // durable floor — the prior reply only; the pending steer is NOT persisted (client-only until drain)
      return Promise.resolve(
        json([
          {
            id: "m0",
            thread_id: "t1",
            role: "assistant",
            parts: [{ type: "text", text: "prior reply" }],
            actor: "agent",
            ts: "",
            tokens: null,
            compacted: false,
          },
        ]),
      );
    });
    await act(async () => {
      await reattachTurn("t1", "T7:1");
    });
    // both survive: the durable floor reply AND the re-rendered pending steer bubble
    expect(
      hook.result.current.messages.some((m) => m.id === "m0" && textOf(m.parts) === "prior reply"),
    ).toBe(true);
    const pending = hook.result.current.messages.find((m) => m.queued === "p1");
    expect(pending).toBeTruthy();
    expect(textOf(pending!.parts)).toBe("pending steer");
  });

  it("probe-on-done discovers a spawned drain-B turn when queued bubbles remain", async () => {
    const spawned = {
      active: true,
      turn_id: "T2",
      seq: 1,
      steer_queue: [{ entry_id: "e1", kind: "message", text: "later" }],
    };
    const { hook, controller, sendP, pushDone } = await heldTurn((u) => {
      if (u.includes("/agent/turns/t1/stream")) {
        return sseResponse([
          {
            event: "turn.sync",
            id: "T2:1",
            data: {
              mode: null,
              seq: 1,
              terminal: null,
              message: {
                id: "m9",
                role: "assistant",
                agent: null,
                text: "spawned reply",
                reasoning: "",
              },
              calls: [],
              steers: [{ entryId: "e1", messageId: "u1", kind: "message", text: "later" }],
            },
          },
          { event: "done", id: "T2:2", data: { state: "completed" } },
        ]);
      }
      if (u.includes("/agent/turns/t1")) return json(spawned);
      return undefined;
    });
    // steer while streaming
    const dispatch = (u: string): Response | undefined => {
      if (u.includes("/agent/chat")) return resp202("e1");
      if (u.includes("/agent/turns/t1/stream")) {
        return sseResponse([
          {
            event: "turn.sync",
            id: "T2:1",
            data: {
              mode: null,
              seq: 1,
              terminal: null,
              message: {
                id: "m9",
                role: "assistant",
                agent: null,
                text: "spawned reply",
                reasoning: "",
              },
              calls: [],
              steers: [{ entryId: "e1", messageId: "u1", kind: "message", text: "later" }],
            },
          },
          { event: "done", id: "T2:2", data: { state: "completed" } },
        ]);
      }
      if (u.includes("/agent/turns/t1")) return json(spawned);
      return undefined;
    };
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const r = dispatch(String(url));
      return Promise.resolve(r ?? ({ ok: true, json: async () => [] } as unknown as Response));
    });
    await act(async () => {
      await sendMessage("later", { raw: "later" });
    });
    expect(hook.result.current.messages.find((m) => m.queued === "e1")).toBeTruthy();

    // the live turn completes → discovery probes, finds the spawned turn active, re-attaches
    await act(async () => {
      pushDone();
      controller.close();
      await sendP;
    });
    await waitFor(() => expect(hook.result.current.messages.some((m) => m.id === "m9")).toBe(true));
    expect(textOf(hook.result.current.messages.find((m) => m.id === "m9")!.parts)).toBe(
      "spawned reply",
    );
    expect(hook.result.current.messages.some((m) => m.queued)).toBe(false); // e1 drained via the fold
  });

  it("reload reconcile (HIGH-2): a drained steer's durable content RENDERS after the re-probe reload; a still-queued one survives", async () => {
    // e1 ("gone") drains while the turn runs; the discovery probe reports it ABSENT (drained) + a new
    // e2 still queued. HIGH-2: because we held queued bubbles, the probe path re-probes after ~250ms
    // and — still inactive — RELOADS the durable floor so e1's sent message actually renders (the
    // pre-fix bug: the bubble merely dropped and the durable content silently vanished). e2 (still
    // server-present) survives the reconcile against the reloaded floor.
    const floor = [
      {
        id: "u-gone",
        thread_id: "t1",
        role: "user",
        parts: [{ type: "text", text: "gone" }],
        actor: "user",
        ts: "",
        tokens: null,
        compacted: false,
      },
    ];
    const { hook, controller, sendP, pushDone } = await heldTurn(() => undefined);
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/agent/chat")) return Promise.resolve(resp202("e1"));
      // the durable floor: e1's persisted "gone" user message (the reload target)
      if (u.includes("/threads/t1/messages")) return Promise.resolve(json(floor));
      // the probe (and re-probe): e1 drained (absent), e2 still queued
      if (u.includes("/agent/turns/t1"))
        return Promise.resolve(
          json({ active: false, steer_queue: [{ entry_id: "e2", kind: "exec", text: "whoami" }] }),
        );
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    await act(async () => {
      await sendMessage("gone", { raw: "gone" });
    });
    expect(hook.result.current.messages.find((m) => m.queued === "e1")).toBeTruthy();

    await act(async () => {
      pushDone();
      controller.close();
      await sendP;
    });
    // After the re-probe reload: e1's DURABLE "gone" message renders (not silently lost) …
    await waitFor(() =>
      expect(
        hook.result.current.messages.some((m) => m.id === "u-gone" && textOf(m.parts) === "gone"),
      ).toBe(true),
    );
    // … the drained e1 bubble is gone, and e2 (server-present) survives as `!whoami`.
    expect(hook.result.current.messages.some((m) => m.queued === "e1")).toBe(false);
    await waitFor(() =>
      expect(hook.result.current.messages.some((m) => m.queued === "e2")).toBe(true),
    );
    expect(textOf(hook.result.current.messages.find((m) => m.queued === "e2")!.parts)).toBe(
      "!whoami",
    );
  });

  it("all-exec drain-B (HIGH-2): a queued `!cmd` whose exec pair persisted RENDERS via the re-probe reload; the bubble is gone", async () => {
    // The deterministic silent-loss case: a lone `!cmd` steer is drained by an all-exec drain-B turn
    // that runs the command INLINE and only persists the durable tool_call/result pair — no live
    // stream, no `steer.applied`. The probe then reports {active:false, steer_queue:[]} (committed).
    // Pre-fix: the reconcile dropped the queued bubble and NOTHING reloaded the pair → it vanished.
    // HIGH-2: the re-probe reload renders the persisted pair.
    const pair = [
      {
        id: "m-exec",
        thread_id: "t1",
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            call_id: "x9",
            tool: "run_shell",
            args: { command: "id" },
            state: "ok",
          },
          {
            type: "tool_result",
            call_id: "x9",
            result: {
              state: "ok",
              summary: "uid=1000",
              data: {},
              output: "uid=1000",
              error: null,
              artifacts: [],
              duration_ms: 1,
            },
          },
        ],
        actor: "agent",
        ts: "",
        tokens: null,
        compacted: false,
      },
    ];
    const { hook, controller, sendP, pushDone } = await heldTurn(() => undefined);
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/api/exec")) return Promise.resolve(resp202("x9"));
      if (u.includes("/threads/t1/messages")) return Promise.resolve(json(pair));
      // the exec already committed off the queue → empty steer_queue, still inactive
      if (u.includes("/agent/turns/t1"))
        return Promise.resolve(json({ active: false, steer_queue: [] }));
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    await act(async () => {
      await runShell("id");
    });
    expect(hook.result.current.messages.find((m) => m.queued === "x9")).toBeTruthy();

    await act(async () => {
      pushDone();
      controller.close();
      await sendP;
    });
    // the durable exec pair renders …
    await waitFor(() =>
      expect(
        hook.result.current.messages.some((m) =>
          m.parts.some((p) => p.type === "tool_call" && p.call_id === "x9"),
        ),
      ).toBe(true),
    );
    // … and the optimistic queued `!id` bubble is gone (no silent loss, no lingering chip)
    expect(hook.result.current.messages.some((m) => m.queued)).toBe(false);
  });

  it("Stop harvests undrained steers to the composer draft (raw-line fidelity, newline-join, no clobber)", async () => {
    clearDraft();
    setDraft("existing note"); // pre-existing draft must NOT be clobbered
    const { hook, controller, sendP } = await heldTurn((u) => {
      if (u.includes("/cancel"))
        return json({
          cancelled: true,
          active: false,
          steer_queue: [
            { entry_id: "e1", kind: "message", text: "do X" },
            { entry_id: "e2", kind: "exec", text: "ls" },
          ],
        });
      if (u.includes("/stream")) return json({ active: false, terminal_status: "cancelled" });
      return undefined;
    });
    // queue two steers: a `/cloud do X` (raw with prefix) + a `!ls` exec
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/agent/chat")) return Promise.resolve(resp202("e1"));
      if (u.includes("/api/exec")) return Promise.resolve(resp202("e2"));
      if (u.includes("/cancel"))
        return Promise.resolve(
          json({
            cancelled: true,
            active: false,
            steer_queue: [
              { entry_id: "e1", kind: "message", text: "do X" },
              { entry_id: "e2", kind: "exec", text: "ls" },
            ],
          }),
        );
      if (u.includes("/stream"))
        return Promise.resolve(json({ active: false, terminal_status: "cancelled" }));
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    await act(async () => {
      await sendMessage("do X", { mode: "cloud", raw: "/cloud do X" });
    });
    await act(async () => {
      await runShell("ls");
    });
    expect(hook.result.current.messages.filter((m) => m.queued)).toHaveLength(2);

    await act(async () => {
      await stopTurn();
    });
    // the RAW lines (with `/cloud` prefix + `!` sigil) restored, newline-joined, APPENDED after the draft
    expect(getDraft()).toBe("existing note\n/cloud do X\n!ls");

    controller.close();
    await act(async () => {
      await sendP;
    });
  });

  it("Stop with an empty harvest appends nothing (draft untouched)", async () => {
    clearDraft();
    setDraft("keep me");
    const { hook, controller, sendP } = await heldTurn((u) => {
      if (u.includes("/cancel")) return json({ cancelled: true, active: false, steer_queue: [] });
      if (u.includes("/stream")) return json({ active: false, terminal_status: "cancelled" });
      return undefined;
    });
    await act(async () => {
      await stopTurn();
    });
    expect(getDraft()).toBe("keep me"); // nothing to harvest → unchanged
    void hook;
    controller.close();
    await act(async () => {
      await sendP;
    });
  });

  it("DELETE a queued steer: {removed:true} drops the bubble; {removed:false} drops the FAKE bubble (FIX D)", async () => {
    // FIX D — pre-fix `{removed:false}` merely cleared the queued marker, leaving a fake "sent" bubble
    // (a client-only `steer-<id>` / `local-<id>` id) that vanishes on the next reload. Now BOTH branches
    // DROP the optimistic bubble; `removed:false` additionally reconciles the durable truth (covered by
    // the idle test below — here the live turn is still streaming so no reload fires, and we assert the
    // fake bubble is gone rather than lingering as a phantom sent message).
    const { hook, controller, sendP, pushDone } = await heldTurn(() => undefined);
    // queue two steers e1 + e2 (e2 via a second chat POST)
    let chat = 0;
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/agent/chat")) {
        chat++;
        return Promise.resolve(resp202(chat === 1 ? "e1" : "e2"));
      }
      if (u.includes("/steer/e1")) return Promise.resolve(json({ removed: true }));
      if (u.includes("/steer/e2"))
        return Promise.resolve(json({ removed: false, reason: "already sent" }));
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    await act(async () => {
      await sendMessage("first steer", { raw: "first steer" });
    });
    await act(async () => {
      await sendMessage("second steer", { raw: "second steer" });
    });
    expect(hook.result.current.messages.filter((m) => m.queued)).toHaveLength(2);

    await act(async () => {
      await removeSteer("e1"); // removed:true → bubble dropped
    });
    expect(hook.result.current.messages.some((m) => textOf(m.parts) === "first steer")).toBe(false);

    await act(async () => {
      await removeSteer("e2"); // removed:false (already drained) → drop the FAKE bubble (no phantom sent)
    });
    // No lingering bubble with a cleared queued marker (the pre-fix fake sent bubble) and no queued chip.
    expect(hook.result.current.messages.some((m) => m.queued === "e2")).toBe(false);
    expect(
      hook.result.current.messages.some(
        (m) => textOf(m.parts) === "second steer" && m.queued === undefined,
      ),
    ).toBe(false);

    pushDone();
    controller.close();
    await act(async () => {
      await sendP;
    });
  });

  it("DELETE {removed:false} on an idle thread renders the DURABLE truth (FIX D)", async () => {
    // A queued steer lingers while idle (a drain-B entry committed into a spawned turn). The owner taps
    // remove; the server says removed:false (already drained). FIX D drops the optimistic bubble AND
    // force-probes → reloads the durable floor so the PERSISTED user row renders — not a fake bubble.
    // First render a PENDING queued bubble (p1) via a re-attach snapshot on an idle thread.
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m0" } },
      { event: "text.delta", data: { messageId: "m0", delta: "prior" } },
      { event: "done", data: { state: "completed" } },
    ]);
    const hook = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    // durable floor as the turn ended: just the prior reply (p1 is client-only until it drains)
    const priorFloor = [
      {
        id: "m0",
        thread_id: "t1",
        role: "assistant",
        parts: [{ type: "text", text: "prior" }],
        actor: "agent",
        ts: "",
        tokens: null,
        compacted: false,
      },
    ];
    // the floor AFTER p1 drained: the durable user row for "later"
    const drainedFloor = [
      ...priorFloor,
      {
        id: "u-later",
        thread_id: "t1",
        role: "user",
        parts: [{ type: "text", text: "later" }],
        actor: "user",
        ts: "",
        tokens: null,
        compacted: false,
      },
    ];
    // Re-attach snapshot carrying p1 as a PENDING steer → renders the queued bubble on the idle thread.
    // The probe (`/agent/turns/t1`) keeps p1 STILL queued and the floor is priorFloor (NO u-later), so
    // the re-attach's own discover machinery can NOT be what renders u-later — only removeSteer can.
    const setupFetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/stream"))
        return Promise.resolve(
          sseResponse([
            {
              event: "turn.sync",
              id: "T7:3",
              data: {
                mode: null,
                seq: 3,
                terminal: null,
                message: null,
                calls: [],
                steer_queue: [{ entry_id: "p1", kind: "message", text: "later" }],
              },
            },
            { event: "done", id: "T7:4", data: { state: "completed" } },
          ]),
        );
      if (u.includes("/agent/turns/t1"))
        return Promise.resolve(
          json({
            active: false,
            steer_queue: [{ entry_id: "p1", kind: "message", text: "later" }],
          }),
        );
      return Promise.resolve(json(priorFloor)); // the floor has NO u-later yet
    });
    globalThis.fetch = setupFetch;
    await act(async () => {
      await reattachTurn("t1", "T7:1");
    });
    // Fully drain the re-attach's fire-and-forget discover probe (past the ~250ms re-probe) against the
    // NO-u-later floor, so u-later can only appear from the removeSteer path below.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 320));
    });
    expect(hook.result.current.messages.some((m) => m.queued === "p1")).toBe(true);
    expect(hook.result.current.messages.some((m) => m.id === "u-later")).toBe(false);
    expect(hook.result.current.status).toBe("idle");

    // Now DELETE p1 → the server says removed:false (already drained). The probe now reports it absent +
    // inactive; the durable floor NOW carries the persisted "later" user row. FIX D drops the fake bubble
    // and force-probes → the reload renders u-later. (Reverting FIX D leaves the fake bubble + no reload.)
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/steer/p1"))
        return Promise.resolve(json({ removed: false, reason: "already sent" }));
      if (u.includes("/agent/turns/t1"))
        return Promise.resolve(json({ active: false, steer_queue: [] }));
      if (u.includes("/threads/t1/messages")) return Promise.resolve(json(drainedFloor));
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    await act(async () => {
      await removeSteer("p1");
      await new Promise((r) => setTimeout(r, 320)); // let the force-probe's re-probe + reload land
    });
    // the fake bubble is gone AND the durable "later" user row rendered (via the force-probe reload)
    expect(hook.result.current.messages.some((m) => m.id === "u-later")).toBe(true);
    expect(hook.result.current.messages.some((m) => m.queued === "p1")).toBe(false);
    expect(hook.result.current.messages.filter((m) => textOf(m.parts) === "later")).toHaveLength(1); // exactly the durable row, no phantom
  });

  // ── Codex FE fix wave (FIX A/B/C/E): client stream ownership, late-202 discovery, thread-scoped
  // async flows, and the cancel-contract adoption (query scope · mismatch adopt · replay · retry). ──

  /** A 200 held SSE Response whose body is `body`. */
  const streamResp = (body: ReadableStream<Uint8Array>): Response =>
    ({
      ok: true,
      status: 200,
      body,
      headers: {
        get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
      },
    }) as unknown as Response;

  it("a stale generation's late `done` does not settle a newer stream (FIX A)", async () => {
    // Turn A streams on socket A (gen1, lastTurnId=A). A steer-race send returns a fresh 200 for turn B
    // on socket B → adopts B (gen2). A's DELAYED terminal, arriving on its now-stale socket, must be
    // dropped: it must NOT settle status idle nor repoint the view under turn B.
    let ctrlA!: ReadableStreamDefaultController<Uint8Array>;
    let ctrlB!: ReadableStreamDefaultController<Uint8Array>;
    const bodyA = new ReadableStream<Uint8Array>({
      start(c) {
        ctrlA = c;
        c.enqueue(
          enc.encode(`event: thread\r\ndata: ${JSON.stringify({ threadId: "t1" })}\r\n\r\n`),
        );
        c.enqueue(
          enc.encode(
            `event: message.start\r\nid: A:1\r\ndata: ${JSON.stringify({ messageId: "mA" })}\r\n\r\n`,
          ),
        );
      },
    });
    const bodyB = new ReadableStream<Uint8Array>({
      start(c) {
        ctrlB = c;
        c.enqueue(
          enc.encode(
            `event: message.start\r\nid: B:1\r\ndata: ${JSON.stringify({ messageId: "mB" })}\r\n\r\n`,
          ),
        );
      },
    });
    let chat = 0;
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/agent/chat")) {
        chat++;
        return Promise.resolve(streamResp(chat === 1 ? bodyA : bodyB));
      }
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    const { result } = renderHook(() => useChat());
    let sendA!: Promise<void>;
    let sendB!: Promise<void>;
    await act(async () => {
      sendA = sendMessage("first");
    });
    await waitFor(() => expect(result.current.messages.some((m) => m.id === "mA")).toBe(true));
    await act(async () => {
      sendB = sendMessage("go B", { raw: "go B" }); // steer-race → 200 adopts turn B
    });
    await waitFor(() => expect(result.current.messages.some((m) => m.id === "mB")).toBe(true));
    expect(result.current.streamingId).toBe("mB");

    // A's delayed `done` on the STALE socket — must be dropped, not settle idle under B.
    ctrlA.enqueue(
      enc.encode(
        `event: done\r\nid: A:2\r\ndata: ${JSON.stringify({ state: "completed" })}\r\n\r\n`,
      ),
    );
    ctrlA.close();
    await act(async () => {
      await sendA; // A's stream tail bails (stale generation) — no settle, no re-attach
    });
    expect(result.current.status).toBe("streaming"); // B still owns the view
    expect(result.current.streamingId).toBe("mB");

    // Finish B cleanly — its own `done` (current generation) settles.
    ctrlB.enqueue(
      enc.encode(
        `event: done\r\nid: B:2\r\ndata: ${JSON.stringify({ state: "completed" })}\r\n\r\n`,
      ),
    );
    ctrlB.close();
    await act(async () => {
      await sendB;
    });
    expect(result.current.status).toBe("idle");
  });

  it("a late 202 (the turn already ended) triggers drain-B discovery (FIX B)", async () => {
    // A steer sent while streaming, whose 202 lands AFTER the live turn settled (the response gap). The
    // settled-turn discovery already ran (no queued bubble then), so the LATE 202 must run discovery
    // itself against the freshly-marked bubble, or the spawned drain-B turn is never found.
    let ctrlA!: ReadableStreamDefaultController<Uint8Array>;
    const bodyA = new ReadableStream<Uint8Array>({
      start(c) {
        ctrlA = c;
        c.enqueue(
          enc.encode(`event: thread\r\ndata: ${JSON.stringify({ threadId: "t1" })}\r\n\r\n`),
        );
        c.enqueue(
          enc.encode(
            `event: message.start\r\nid: A:1\r\ndata: ${JSON.stringify({ messageId: "mA" })}\r\n\r\n`,
          ),
        );
      },
    });
    let resolveSteer!: (r: Response) => void;
    const steerP = new Promise<Response>((res) => (resolveSteer = res));
    const floor = [
      {
        id: "u1",
        thread_id: "t1",
        role: "user",
        parts: [{ type: "text", text: "later" }],
        actor: "user",
        ts: "",
        tokens: null,
        compacted: false,
      },
    ];
    const drainB = () =>
      sseResponse([
        {
          event: "turn.sync",
          id: "T2:1",
          data: {
            mode: null,
            seq: 1,
            terminal: null,
            message: { id: "m9", role: "assistant", agent: null, text: "spawned", reasoning: "" },
            calls: [],
            steers: [{ entryId: "e1", messageId: "u1", kind: "message", text: "later" }],
          },
        },
        { event: "done", id: "T2:2", data: { state: "completed" } },
      ]);
    let chat = 0;
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/agent/chat")) {
        chat++;
        return chat === 1 ? Promise.resolve(streamResp(bodyA)) : steerP;
      }
      if (u.includes("/agent/turns/t1/stream")) return Promise.resolve(drainB());
      if (u.includes("/agent/turns/t1"))
        return Promise.resolve(
          json({
            active: true,
            turn_id: "T2",
            seq: 1,
            steer_queue: [{ entry_id: "e1", kind: "message", text: "later" }],
          }),
        );
      if (u.includes("/threads/t1/messages")) return Promise.resolve(json(floor));
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    const { result } = renderHook(() => useChat());
    let sendA!: Promise<void>;
    let steerSend!: Promise<void>;
    await act(async () => {
      sendA = sendMessage("first");
    });
    await waitFor(() => expect(result.current.messages.some((m) => m.id === "mA")).toBe(true));
    await act(async () => {
      steerSend = sendMessage("later", { raw: "later" }); // POST deferred (steerP)
    });
    // The live turn ends BEFORE the 202 resolves — the response gap.
    ctrlA.enqueue(
      enc.encode(
        `event: done\r\nid: A:2\r\ndata: ${JSON.stringify({ state: "completed" })}\r\n\r\n`,
      ),
    );
    ctrlA.close();
    await act(async () => {
      await sendA;
    });
    expect(result.current.status).toBe("idle"); // A settled; the "later" bubble is not queued yet
    // Now the 202 lands late → FIX B: status is idle → discover the spawned drain-B turn.
    await act(async () => {
      resolveSteer(resp202("e1"));
      await steerSend;
    });
    await waitFor(() => expect(result.current.messages.some((m) => m.id === "m9")).toBe(true));
    expect(textOf(result.current.messages.find((m) => m.id === "m9")!.parts)).toBe("spawned");
    await waitFor(() => expect(result.current.messages.some((m) => m.queued)).toBe(false));
  });

  it("a stale re-attach does not settle/reload another thread after a switch (FIX C)", async () => {
    // Establish t1, then start a re-attach whose JSON terminal is DEFERRED; switch threads (/clear)
    // before it resolves. The thread-switch guard must bail so the fresh view is never mutated.
    mockStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m0" } },
      { event: "done", data: { state: "completed" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    expect(result.current.threadId).toBe("t1");

    let resolveJson!: (v: unknown) => void;
    const jsonP = new Promise((res) => (resolveJson = res));
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/stream"))
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => jsonP,
        } as unknown as Response);
      // If the guard FAILED, a reload would inject this "leak" row into the fresh view.
      return Promise.resolve(
        json([
          {
            id: "leak-t1",
            thread_id: "t1",
            role: "assistant",
            parts: [{ type: "text", text: "leaked" }],
            actor: "agent",
            ts: "",
            tokens: null,
            compacted: false,
          },
        ]),
      );
    });
    let p!: Promise<boolean>;
    await act(async () => {
      p = reattachTurn("t1"); // enteredOn = "t1"; parks on the deferred json()
    });
    act(() => {
      startNewThread(); // switch away → threadId null, messages cleared
    });
    expect(result.current.threadId).toBeNull();

    let ok!: boolean;
    await act(async () => {
      resolveJson({ active: false, terminal_status: "completed" });
      ok = await p;
    });
    expect(ok).toBe(false); // bailed on the thread-switch guard
    expect(result.current.messages.some((m) => m.id === "leak-t1")).toBe(false); // fresh view untouched
    expect(result.current.status).toBe("idle");
  });

  it("startNewThread prunes rawByEntry: a later harvest falls back to server text (FIX C)", async () => {
    clearDraft();
    // 1) queue a steer carrying a `/cloud` RAW line on t1 (populates rawByEntry[t1][e1]); end + close.
    {
      const { hook, controller, sendP, pushDone } = await heldTurn(() => undefined);
      globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
        const u = String(url);
        if (u.includes("/agent/chat")) return Promise.resolve(resp202("e1"));
        return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
      });
      await act(async () => {
        await sendMessage("do X", { mode: "cloud", raw: "/cloud do X" });
      });
      expect(hook.result.current.messages.some((m) => m.queued === "e1")).toBe(true);
      await act(async () => {
        pushDone();
        controller.close();
        await sendP;
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 320)); // drain the post-done discovery probe
      });
    }
    // 2) /clear prunes rawByEntry (dropAllRaw).
    act(() => {
      startNewThread();
    });
    // 3) a fresh streaming turn; Stop harvests the SAME entry — the raw line was pruned, so the harvest
    //    reconstructs the PLAIN server text ("do X"), NOT the "/cloud do X" raw that would survive a leak.
    {
      const { hook, controller, sendP } = await heldTurn((u) => {
        if (u.includes("/cancel"))
          return json({
            cancelled: true,
            active: false,
            steer_queue: [{ entry_id: "e1", kind: "message", text: "do X" }],
          });
        if (u.includes("/stream")) return json({ active: false, terminal_status: "cancelled" });
        return undefined;
      });
      await act(async () => {
        await stopTurn();
      });
      expect(getDraft()).toBe("do X"); // reconstructed from server text — the raw "/cloud" line was pruned
      void hook;
      controller.close();
      await act(async () => {
        await sendP;
      });
    }
  });

  it("stopTurn scopes the cancel via the ?turn_id= query param (FIX E)", async () => {
    // A held turn whose message.start carries an id so `lastTurnId` (the Stop scope) is set.
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c;
        c.enqueue(
          enc.encode(`event: thread\r\ndata: ${JSON.stringify({ threadId: "t1" })}\r\n\r\n`),
        );
        c.enqueue(
          enc.encode(
            `event: message.start\r\nid: TZ:1\r\ndata: ${JSON.stringify({ messageId: "m1" })}\r\n\r\n`,
          ),
        );
      },
    });
    let cancelUrl = "";
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/cancel")) {
        cancelUrl = u;
        return Promise.resolve(json({ cancelled: true, terminal_status: "cancelled" }));
      }
      if (u.includes("/agent/chat")) return Promise.resolve(streamResp(body));
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    const { result } = renderHook(() => useChat());
    let sendP!: Promise<void>;
    await act(async () => {
      sendP = sendMessage("hi");
    });
    await waitFor(() => expect(result.current.messages.some((m) => m.id === "m1")).toBe(true));
    await act(async () => {
      await stopTurn();
    });
    expect(cancelUrl).toContain("turn_id=TZ"); // the scope rides the query param (D41 FIX 3)

    ctrl.enqueue(
      enc.encode(`event: done\r\ndata: ${JSON.stringify({ state: "cancelled" })}\r\n\r\n`),
    );
    ctrl.close();
    await act(async () => {
      await sendP;
    });
  });

  it("stopTurn on a scoped MISMATCH adopts the live turn without harvesting the peek (FIX E)", async () => {
    // The scoped turn A finished; a successor B is live. The cancel returns {cancelled:false,active:true,
    // turn_id:B, steer_queue:[peek]} — the peek is NOT a harvest. FE must not restore the draft; it must
    // re-attach to B (adopt the live turn).
    clearDraft();
    setDraft("keep me");
    let ctrlA!: ReadableStreamDefaultController<Uint8Array>;
    const bodyA = new ReadableStream<Uint8Array>({
      start(c) {
        ctrlA = c;
        c.enqueue(
          enc.encode(`event: thread\r\ndata: ${JSON.stringify({ threadId: "t1" })}\r\n\r\n`),
        );
        c.enqueue(
          enc.encode(
            `event: message.start\r\nid: A:1\r\ndata: ${JSON.stringify({ messageId: "mA" })}\r\n\r\n`,
          ),
        );
      },
    });
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/cancel"))
        return Promise.resolve(
          json({
            cancelled: false,
            active: true,
            turn_id: "B",
            steer_queue: [{ entry_id: "peek1", kind: "message", text: "not mine" }],
          }),
        );
      if (u.includes("/agent/turns/t1/stream"))
        return Promise.resolve(
          sseResponse([
            {
              event: "turn.sync",
              id: "B:2",
              data: {
                mode: null,
                seq: 2,
                terminal: null,
                message: {
                  id: "mB",
                  role: "assistant",
                  agent: null,
                  text: "B reply",
                  reasoning: "",
                },
                calls: [],
              },
            },
            { event: "done", id: "B:3", data: { state: "completed" } },
          ]),
        );
      if (u.includes("/agent/chat")) return Promise.resolve(streamResp(bodyA));
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    const { result } = renderHook(() => useChat());
    let sendA!: Promise<void>;
    await act(async () => {
      sendA = sendMessage("first");
    });
    await waitFor(() => expect(result.current.messages.some((m) => m.id === "mA")).toBe(true));

    await act(async () => {
      await stopTurn(); // mismatch → adopt B via re-attach
    });
    await waitFor(() => expect(result.current.messages.some((m) => m.id === "mB")).toBe(true));
    expect(textOf(result.current.messages.find((m) => m.id === "mB")!.parts)).toBe("B reply");
    expect(getDraft()).toBe("keep me"); // the PEEK was not harvested — no draft restore
    expect(result.current.messages.some((m) => m.queued === "peek1")).toBe(false); // no bubble from the peek

    ctrlA.close(); // A's stale socket closes → its tail bails (superseded generation)
    await act(async () => {
      await sendA;
    });
  });

  it("a replayed harvest restores to the draft only once (FIX E)", async () => {
    clearDraft();
    const { hook, controller, sendP } = await heldTurn(() => undefined);
    let cancels = 0;
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/agent/chat")) return Promise.resolve(resp202("e1"));
      if (u.includes("/cancel")) {
        cancels++;
        return Promise.resolve(
          cancels === 1
            ? json({
                cancelled: true,
                terminal_status: "cancelled", // no active:false → status stays streaming for a 2nd Stop
                steer_queue: [{ entry_id: "e1", kind: "message", text: "X" }],
              })
            : json({
                cancelled: false,
                active: false,
                harvest_replayed: true,
                steer_queue: [{ entry_id: "e1", kind: "message", text: "X" }],
              }),
        );
      }
      if (u.includes("/stream"))
        return Promise.resolve(json({ active: false, terminal_status: "cancelled" }));
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    await act(async () => {
      await sendMessage("X", { mode: "cloud", raw: "/cloud X" });
    });
    expect(hook.result.current.messages.some((m) => m.queued === "e1")).toBe(true);
    await act(async () => {
      await stopTurn(); // harvests "/cloud X"
    });
    expect(getDraft()).toBe("/cloud X");
    await act(async () => {
      await stopTurn(); // the REPLAYED receipt (same entries) must not double-append
    });
    expect(getDraft()).toBe("/cloud X"); // idempotent — not "/cloud X\n/cloud X"
    controller.close();
    await act(async () => {
      await sendP;
    });
  });

  it("a lost Stop response retries once and the replayed harvest is restored (FIX E)", async () => {
    clearDraft();
    const { hook, controller, sendP } = await heldTurn(() => undefined);
    let cancels = 0;
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/agent/chat")) return Promise.resolve(resp202("e1"));
      if (u.includes("/cancel")) {
        cancels++;
        if (cancels === 1) return Promise.reject(new TypeError("network")); // the response is LOST
        return Promise.resolve(
          json({
            cancelled: false,
            active: false,
            harvest_replayed: true, // the backend replays the receipt on the retry
            steer_queue: [{ entry_id: "e1", kind: "message", text: "X" }],
          }),
        );
      }
      if (u.includes("/stream"))
        return Promise.resolve(json({ active: false, terminal_status: "cancelled" }));
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    });
    await act(async () => {
      await sendMessage("X", { mode: "cloud", raw: "/cloud X" });
    });
    expect(hook.result.current.messages.some((m) => m.queued === "e1")).toBe(true);
    await act(async () => {
      await stopTurn();
    });
    expect(cancels).toBe(2); // retried exactly once
    expect(getDraft()).toBe("/cloud X"); // the replayed receipt (raw-fidelity) was restored on retry
    controller.close();
    await act(async () => {
      await sendP;
    });
  });
});
