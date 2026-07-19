import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { compactThread, sendMessage, startNewThread, useChat } from "../../src/store/chat";
import type { Part } from "../../src/types";

// store/chat → compactThread (D42 manual `/compact`). The endpoint isn't SSE — it returns a JSON
// `{removed, rejected?, truncated?}`. We open a real thread (one SSE turn sets the module threadId),
// then drive compactThread against a plain-JSON fetch mock and assert the body sent + the breadcrumb.

/** A fake SSE Response streaming the given frames (minimal copy of the chat.test harness). */
function sseResponse(frames: { event: string; data: unknown }[]): Response {
  const text = frames
    .map((f) => `event: ${f.event}\r\ndata: ${JSON.stringify(f.data)}\r\n\r\n`)
    .join("");
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
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

/** A plain JSON Response (the /compact endpoint's shape). */
function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => data,
  } as unknown as Response;
}

function noteText(parts: Part[]): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
}

/** Open a thread (threadId = "t1") so compactThread has a target. Returns the live hook result. */
async function openThread() {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve(
      sseResponse([
        { event: "thread", data: { threadId: "t1" } },
        { event: "message.start", data: { messageId: "m1" } },
        { event: "text.delta", data: { messageId: "m1", delta: "ok" } },
        { event: "done", data: { state: "completed" } },
      ]),
    ),
  );
  const { result } = renderHook(() => useChat());
  await act(async () => {
    await sendMessage("hi");
  });
  return result;
}

beforeEach(() => startNewThread()); // reset the module-level store between cases
afterEach(() => vi.clearAllMocks());

describe("compactThread (D42 manual /compact)", () => {
  it("with no thread, notes 'nothing to compact' and never fetches", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await compactThread();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(noteText(result.current.messages.at(-1)!.parts)).toContain("nothing to compact");
  });

  it("threads the `/compact` instructions into the POST body — present AND absent", async () => {
    const result = await openThread();
    type CompactBody = { thread_id: string; instructions: string | null };
    let sentBody: CompactBody | undefined;
    globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body)) as CompactBody;
      return Promise.resolve(jsonResponse({ removed: 2, truncated: false }));
    });

    await act(async () => {
      await compactThread(null);
    });
    expect(sentBody).toEqual({ thread_id: "t1", instructions: null });

    await act(async () => {
      await compactThread("focus on the deploy steps");
    });
    expect(sentBody).toEqual({ thread_id: "t1", instructions: "focus on the deploy steps" });
    // The optimistic chat log is untouched by these two mocked calls (result stays a valid hook).
    expect(result.current.threadId).toBe("t1");
  });

  it("a rejected fold gets a distinct note — NOT the 'nothing to compact' text", async () => {
    const result = await openThread();
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ removed: 0, rejected: true, truncated: false })),
    );
    await act(async () => {
      await compactThread();
    });
    const text = noteText(result.current.messages.at(-1)!.parts);
    expect(text).toContain("wouldn't shrink the context");
    expect(text).not.toContain("nothing to compact");
  });

  it("a successful fold notes the compacted count", async () => {
    const result = await openThread();
    globalThis.fetch = vi.fn(() => Promise.resolve(jsonResponse({ removed: 3, truncated: false })));
    await act(async () => {
      await compactThread();
    });
    expect(noteText(result.current.messages.at(-1)!.parts)).toContain("compacted 3 messages");
  });

  // Codex FIX C: a /compact whose response lands AFTER a /clear+new-thread must not write its note
  // into the now-current thread. The threadId is captured at entry; a mismatch drops the breadcrumb.
  it("drops the note when the thread changed while the request was in flight", async () => {
    const result = await openThread(); // threadId "t1"
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    globalThis.fetch = vi.fn(async () => {
      await gate;
      return jsonResponse({ removed: 3, truncated: false });
    });
    await act(async () => {
      const done = compactThread();
      startNewThread(); // switch away (threadId → null) before the fetch resolves
      release();
      await done;
    });
    expect(result.current.threadId).toBeNull();
    // No compaction breadcrumb leaked into the fresh (empty) thread view.
    expect(result.current.messages.some((m) => noteText(m.parts).includes("compacted"))).toBe(
      false,
    );
    expect(result.current.messages).toHaveLength(0);
  });
});
