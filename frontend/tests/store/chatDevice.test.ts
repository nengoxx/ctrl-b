import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// S11 (c) — the reply's DEVICE, the store half (owner ruling 2026-10-14: only the device that started a
// turn auto-speaks it). `streamTurn` names this device on every own turn (`X-Ctrlb-Device`), and every
// writer that puts an assistant reply on screen keeps the device the server stamped on it — the live
// `message.start` (adopting the placeholder AND a fresh bubble), the `turn.sync` snapshot's open message,
// the durable history rows — so `useAutoTts` judges the reply actually on screen, whatever path loaded it.

const h = vi.hoisted(() => {
  /** THIS device's id as `lib/device` answers it; `null` = storage refused one. */
  const own: { device: string | null } = { device: "a".repeat(32) };
  return own;
});
vi.mock("../../src/lib/device", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/device")>()),
  deviceId: () => h.device,
}));

import type { ChatMessage } from "../../src/types";
import {
  reattachTurn,
  reloadChat,
  resetToThreadless,
  sendMessage,
  useChat,
} from "../../src/store/chat";

const OWN = "a".repeat(32);
const OTHER = "b".repeat(32);

type Frame = { event: string; data: unknown; id?: string };

function sseResponse(frames: Frame[]): Response {
  const text = frames
    .map(
      (f) =>
        `${f.id ? `id: ${f.id}\r\n` : ""}event: ${f.event}\r\ndata: ${JSON.stringify(f.data)}\r\n\r\n`,
    )
    .join("");
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
  return {
    ok: true,
    status: 200,
    body,
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
    },
  } as unknown as Response;
}

const json = (body: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as unknown as Response;

/** Every fetch this file makes: the turn POSTs and the `…/stream` re-attach answer `frames`; anything
 *  else (the durable floor's re-read) answers `floor`. */
function mockFetch(frames: Frame[], floor: unknown[] = []) {
  const fetchMock = vi.fn((url: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(String(url).includes("/agent/") ? sseResponse(frames) : json(floor)),
  );
  globalThis.fetch = fetchMock;
  return fetchMock;
}

/** Mount the store recording EVERY state it renders: a completed turn re-reads the durable floor at its
 *  end (stubbed empty here), so the reducer's own writes are read from the renders that showed them. */
function mountRecording() {
  const seen: ChatMessage[][] = [];
  renderHook(() => {
    const s = useChat();
    seen.push(s.messages);
    return s;
  });
  /** The last rendered version of message `id`. */
  return (id: string): ChatMessage | undefined =>
    seen
      .map((ms) => ms.find((m) => m.id === id))
      .filter(Boolean)
      .at(-1);
}

/** The headers the turn POST carried. */
function postHeaders(fetchMock: ReturnType<typeof mockFetch>): Record<string, string> {
  const call = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
  return (call?.[1]?.headers ?? {}) as Record<string, string>;
}

beforeEach(() => {
  h.device = OWN;
  resetToThreadless();
});

describe("S11 (c) · the request names this device", () => {
  it("`streamTurn` sends `X-Ctrlb-Device` = this device's id", async () => {
    const f = mockFetch([
      { event: "thread", data: { threadId: "t1" } },
      { event: "done", data: { state: "completed" } },
    ]);
    await act(async () => {
      await sendMessage("q");
    });
    expect(postHeaders(f)["X-Ctrlb-Device"]).toBe(OWN);
  });

  it("…and NO header at all when this device has no id (storage refused) — the unknown arm", async () => {
    h.device = null;
    const f = mockFetch([
      { event: "thread", data: { threadId: "t1" } },
      { event: "done", data: { state: "completed" } },
    ]);
    await act(async () => {
      await sendMessage("q");
    });
    expect(postHeaders(f)).not.toHaveProperty("X-Ctrlb-Device");
  });
});

describe("S11 (c) · every writer keeps the reply's device", () => {
  it("`message.start` stamps it on the ADOPTED placeholder and on a FRESH bubble", async () => {
    mockFetch([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1", role: "assistant", device: OWN } },
      { event: "text.delta", data: { messageId: "m1", delta: "Let me check." } },
      { event: "message.end", data: { messageId: "m1" } },
      // the next step's message — a fresh bubble (no placeholder left to adopt)
      { event: "message.start", data: { messageId: "m2", role: "assistant", device: OTHER } },
      { event: "text.delta", data: { messageId: "m2", delta: "Done." } },
      { event: "done", data: { state: "completed" } },
    ]);
    const byId = mountRecording();
    await act(async () => {
      await sendMessage("q");
    });
    expect(byId("m1")?.device).toBe(OWN);
    expect(byId("m1")?.local).toBeUndefined(); // it IS the adopted placeholder
    expect(byId("m2")?.device).toBe(OTHER);
  });

  it("a `message.start` naming no device (an older server) leaves it null", async () => {
    mockFetch([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" } },
      { event: "done", data: { state: "completed" } },
    ]);
    const byId = mountRecording();
    await act(async () => {
      await sendMessage("q");
    });
    expect(byId("m1")).toBeDefined();
    expect(byId("m1")?.device).toBeNull();
  });

  it("a `turn.sync` snapshot's open message carries it onto the bubble it creates", async () => {
    mockFetch([
      {
        event: "turn.sync",
        id: "turn-a:3",
        data: {
          mode: null,
          seq: 3,
          terminal: { state: "completed" },
          message: {
            id: "m9",
            role: "assistant",
            agent: null,
            device: OTHER,
            text: "From the desktop.",
            reasoning: "",
          },
          calls: [],
        },
      },
    ]);
    const byId = mountRecording();
    await act(async () => {
      await reattachTurn("t1", "turn-a:1");
    });
    const m9 = byId("m9");
    expect(m9?.parts).toEqual([{ type: "text", text: "From the desktop." }]);
    expect(m9?.device).toBe(OTHER);
  });

  it("history rows keep it (the durable `Message` dump)", async () => {
    mockFetch(
      [
        { event: "thread", data: { threadId: "t1" } },
        { event: "done", data: { state: "completed" } },
      ],
      [],
    );
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("q");
    });
    mockFetch(
      [],
      [
        {
          id: "m1",
          thread_id: "t1",
          role: "assistant",
          parts: [{ type: "text", text: "hi" }],
          actor: "agent",
          ts: new Date().toISOString(),
          tokens: null,
          compacted: false,
          agent: null,
          device: OTHER,
        },
      ],
    );
    await act(async () => {
      await reloadChat();
    });
    expect(result.current.messages[0].device).toBe(OTHER);
  });
});
