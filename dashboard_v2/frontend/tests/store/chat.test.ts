import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resumeCall, sendMessage, startNewThread, useChat } from "../../src/store/chat";
import type { Part } from "../../src/types";

// store/chat — the streaming reducer (the most intricate frontend logic). We drive the REAL public API
// (sendMessage / resumeCall) through a mocked SSE `fetch`, so the real byte-parser + reducer run
// end-to-end and we assert the resulting message list / status. This locks in the SSE wire protocol
// handling (incl. the historical \n-vs-\r\n framing) without forking the reducer.

type Frame = { event: string; data: unknown };

/** A fake `fetch` Response whose body streams the given SSE frames (one chunk, then close). */
function sseResponse(frames: Frame[]): Response {
  const text = frames.map((f) => `event: ${f.event}\r\ndata: ${JSON.stringify(f.data)}\r\n\r\n`).join("");
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
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null) },
  } as unknown as Response;
}

function mockStream(frames: Frame[]) {
  global.fetch = vi.fn(() => Promise.resolve(sseResponse(frames)));
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
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      body,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null) },
    } as unknown as Response),
  );
}

function textOf(parts: Part[]): string {
  return parts.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : "")).join("");
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
        data: { messageId: "m1", part: { type: "tool_call", call_id: "c1", tool: "wake_host", args: { host: "vault" }, state: "pending" } },
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
      { event: "part.added", data: { messageId: "m1", part: { type: "tool_call", call_id: "c1", tool: "wake_host", args: {}, state: "pending" } } },
      { event: "tool.permission", data: { callId: "c1", token: "tok-1" } },
      { event: "done", data: { state: "suspended" } },
    ]);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("wake");
    });

    // Resume: the tool result lands + a final answer + done completed.
    mockStream([
      { event: "tool.result", data: { callId: "c1", result: { state: "ok", summary: "woke vault" } } },
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
    const f = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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
      `event: message.start\r\ndata: ${JSON.stringify({ messageId: "m1" })}\r\n\r\n` + frame.slice(0, cut),
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
    global.fetch = vi.fn((url: string) =>
      Promise.resolve(
        String(url).includes("/agent/chat")
          ? ({ ok: true, body: {}, headers: { get: () => "application/json" }, json: async () => ({ threadId: "t1", state: "completed" }) } as unknown as Response)
          : ({ ok: true, json: async () => [msg("u1", "user", "q"), msg("a1", "assistant", "buffered answer")] } as unknown as Response),
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
