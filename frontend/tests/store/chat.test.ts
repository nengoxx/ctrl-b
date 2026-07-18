import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearDraft, getDraft } from "../../src/store/composer";
import {
  answerQuestion,
  initChat,
  reattachTurn,
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
