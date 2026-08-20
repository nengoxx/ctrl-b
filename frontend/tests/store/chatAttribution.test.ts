import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  duration,
  kTokens,
  metricRows,
  tokensPerSecond,
  windowShare,
} from "../../src/components/chatAttribution";
import { reloadChat, sendMessage, startNewThread, useChat } from "../../src/store/chat";
import type { CallUsage, MessageSource } from "../../src/types";

// D62 — per-message serve attribution, the data half: what the reducer folds off `message.end`, that a
// RELOADED thread arrives carrying the identical fields (the two paths must never disagree — one renders
// a live bubble, the other the same bubble after a refresh), and the formatters/segment rules the
// disclosure reads. The render half lives in tests/components/chatThread.test.tsx.

type Frame = { event: string; data: unknown };

function sseResponse(frames: Frame[]): Response {
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

const SOURCE: MessageSource = { served: "corsair", degraded: false, context_window: 262144 };
const USAGE: CallUsage = {
  model: "qwen3.6-max",
  input_tokens: 8100,
  output_tokens: 512,
  cached_tokens: 6900,
  duration_ms: 12300,
};

/** One completed turn whose `message.end` carries the given attribution payload. */
async function streamTurn(end: Record<string, unknown>) {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve(
      sseResponse([
        { event: "thread", data: { threadId: "t1" } },
        { event: "message.start", data: { messageId: "m1" } },
        { event: "text.delta", data: { messageId: "m1", delta: "hi" } },
        { event: "message.end", data: { messageId: "m1", ...end } },
        { event: "done", data: { state: "completed" } },
      ]),
    ),
  );
  const { result } = renderHook(() => useChat());
  await act(async () => {
    await sendMessage("q");
  });
  return result;
}

beforeEach(() => {
  startNewThread();
});

describe("D62 · the message.end fold", () => {
  it("attaches the routing record + the call usage to the assistant message", async () => {
    const result = await streamTurn({ source: SOURCE, usage: USAGE });
    const bot = result.current.messages[1];
    expect(bot.source).toEqual(SOURCE);
    expect(bot.usage).toEqual(USAGE);
  });

  it("carries a degraded serve's `from`/`failed_hops` through", async () => {
    const result = await streamTurn({
      source: { served: "openrouter", degraded: true, from: "corsair", failed_hops: 2 },
    });
    expect(result.current.messages[1].source).toEqual({
      served: "openrouter",
      degraded: true,
      from: "corsair",
      failed_hops: 2,
    });
  });

  it("leaves the message untouched when the frame carries neither fact (a pre-D62 backend)", async () => {
    const result = await streamTurn({});
    const bot = result.current.messages[1];
    expect(bot.source).toBeUndefined();
    expect(bot.usage).toBeUndefined();
  });

  it("drops malformed facts instead of the whole frame", async () => {
    const result = await streamTurn({
      source: { served: "corsair", degraded: false, context_window: "lots" },
      usage: { input_tokens: "many", duration_ms: 900 },
    });
    const bot = result.current.messages[1];
    expect(bot.source).toEqual({ served: "corsair", degraded: false }); // the junk window is gone
    expect(bot.usage).toMatchObject({ duration_ms: 900, input_tokens: null });
  });

  it("ignores a source with no `served` — the chip has nothing to say", async () => {
    const result = await streamTurn({ source: { degraded: true } });
    expect(result.current.messages[1].source).toBeUndefined();
  });

  it("a reloaded thread arrives with the same fields the live turn folded (parity)", async () => {
    const live = await streamTurn({ source: SOURCE, usage: USAGE });
    const durable = [
      {
        id: "m1",
        thread_id: "t1",
        role: "assistant",
        parts: [{ type: "text", text: "hi" }],
        actor: "agent",
        ts: new Date().toISOString(),
        tokens: null,
        compacted: false,
        source: SOURCE,
        usage: USAGE,
      },
    ];
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(durable) } as unknown as Response),
    );
    await act(async () => {
      await reloadChat();
    });
    const reloaded = live.current.messages[0];
    expect(reloaded.source).toEqual(SOURCE);
    expect(reloaded.usage).toEqual(USAGE);
  });
});

describe("D62 · the formatters", () => {
  it("keeps the token register short: 512 · 8.1k · 262k", () => {
    expect(kTokens(512)).toBe("512");
    expect(kTokens(8100)).toBe("8.1k");
    expect(kTokens(8000)).toBe("8k"); // no dangling .0
    expect(kTokens(262144)).toBe("262k"); // ≥10k drops the decimal
  });

  it("formats a duration in the unit that reads", () => {
    expect(duration(840)).toBe("840ms");
    expect(duration(12300)).toBe("12.3s");
  });

  it("computes throughput and window share only when both halves are known", () => {
    expect(tokensPerSecond(512, 12300)).toBe("42 tok/s"); // 512 ÷ 12.3s
    expect(tokensPerSecond(512, 0)).toBeNull();
    expect(tokensPerSecond(null, 12300)).toBeNull();
    expect(windowShare(8100, 262144)).toBe("3% of 262k");
    expect(windowShare(8100, null)).toBeNull();
  });
});

describe("D62 · the disclosure rows", () => {
  it("builds the three lines from a full report", () => {
    const rows = metricRows(
      {
        served: "openrouter",
        degraded: true,
        from: "corsair",
        failed_hops: 2,
        context_window: 8192,
      },
      USAGE,
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].segs.map((s) => s.text)).toEqual(["qwen3.6-max", "8.1k (6.9k cached)", "512"]);
    expect(rows[0].segs[1].sr).toBe("input tokens"); // the arrow's words, for a screen reader
    expect(rows[1].segs.map((s) => s.text)).toEqual(["99% of 8.2k", "12.3s", "42 tok/s"]);
    expect(rows[2]).toMatchObject({ warn: true });
    expect(rows[2].segs.map((s) => s.text)).toEqual(["fallback from corsair", "2 failed hops"]);
  });

  it("omits every segment whose datum is absent", () => {
    const rows = metricRows({ served: "corsair", degraded: false }, { duration_ms: 900 });
    expect(rows).toHaveLength(1);
    expect(rows[0].segs.map((s) => s.text)).toEqual(["900ms"]);
  });

  it("has nothing to disclose for a message with no attribution at all", () => {
    expect(metricRows(null, null)).toEqual([]);
    expect(metricRows({ served: "corsair", degraded: false }, null)).toEqual([]);
  });

  it("says what it knows when a fallback served but the primary is unknown", () => {
    const rows = metricRows({ served: "openrouter", degraded: true }, null);
    expect(rows[0].segs.map((s) => s.text)).toEqual(["served by a fallback"]);
  });
});
