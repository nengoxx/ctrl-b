import { act, render, renderHook, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// D81 — the owner's message actions in the STORE (`store/chat`): retry as a new variant (`regenerate`,
// I4-confirmed, the F20 reroute), swap variants (`selectAlternate`), edit, delete, and the one floor
// installer they all end on (`applyFloor`, reached at the end of every turn through `reloadFloor`).
//
// Driven through the REAL public API with a URL-routed `fetch` mock (the chat.test.ts harness shape):
// the send → SSE → end-of-turn floor chain runs for real, so every case starts from a view the server's
// floor built — which is exactly where the `reply` annotation the controls read comes from.

import { getDraft, clearDraft } from "../../src/store/composer";
import { resolveConfirm, useConfirm } from "../../src/store/confirm";
import { useToasts } from "../../src/store/toast";
import {
  applyFloor,
  deleteMessage,
  editMessage,
  pushSystemNote,
  reattachTurn,
  regenerate,
  resetToThreadless,
  selectAlternate,
  sendMessage,
  useChat,
} from "../../src/store/chat";
import type { ChatMessage, Part } from "../../src/types";

vi.mock("../../src/lib/audioController", async (orig) => ({
  ...(await orig<typeof import("../../src/lib/audioController")>()),
  forgetMessage: vi.fn(),
}));
import { forgetMessage } from "../../src/lib/audioController";
// The N1 case renders the REAL transcript (the F20 pill's gate lives in ChatThread) — its two query
// hooks are stubbed so no QueryClient is needed (the chatThread.test.tsx precedent).
vi.mock("../../src/hooks/useActions", () => ({ useActionSpecs: () => ({ data: [] }) }));
vi.mock("../../src/hooks/useAgentArt", () => ({
  useAgentArt: () => (name: string | null) => ({
    name: name ?? "default",
    title: name ?? "default",
  }),
}));
import { ChatThread } from "../../src/components/ChatThread";

type Frame = { event: string; data: unknown };

function sse(frames: Frame[]): Response {
  const text = frames
    .map((f) => `event: ${f.event}\r\ndata: ${JSON.stringify(f.data)}\r\n\r\n`)
    .join("");
  const bytes = new TextEncoder().encode(text);
  return {
    ok: true,
    status: 200,
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

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: null,
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => body,
  } as unknown as Response;
}

const row = (over: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role">): ChatMessage => ({
  thread_id: "t1",
  parts: [],
  actor: over.role === "user" ? "user" : "agent",
  ts: "2026-09-27T10:00:00Z",
  tokens: null,
  compacted: false,
  ...over,
});
const text = (t: string): Part[] => [{ type: "text", text: t }];
const said = (m: ChatMessage | undefined) =>
  (m?.parts ?? []).map((p) => (p.type === "text" ? p.text : "")).join("");

/** The durable rows a first turn leaves: the owner's question + the reply it got (the host, `1/1`). */
const U1 = row({ id: "u1", role: "user", parts: text("hello") });
const A1 = row({
  id: "a1",
  role: "assistant",
  parts: text("first take"),
  reply: { ids: ["a1"], n: 1, count: 1 },
});

/** Router state: what GET /messages serves now, and every request seen. */
let floor: ChatMessage[];
let calls: { url: string; method: string; body: unknown }[];
let routes: Record<string, (body: unknown) => Response | Promise<Response>>;

function install() {
  calls = [];
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, method, body });
    for (const [key, answer] of Object.entries(routes)) {
      const [m, path] = key.split(" ");
      if (m === method && url === path) return Promise.resolve(answer(body));
    }
    if (method === "GET" && url === "/api/threads/t1/messages") return Promise.resolve(json(floor));
    return Promise.resolve(json({}));
  });
}

/** A first turn through the real send path, ending on `floor` (the server's view of it). */
async function firstTurn(end: ChatMessage[] = [U1, A1]) {
  routes["POST /api/agent/chat"] = () =>
    sse([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "a1" } },
      { event: "text.delta", data: { messageId: "a1", delta: said(end.at(-1)) } },
      { event: "done", data: { state: "completed" } },
    ]);
  floor = end;
  const hook = renderHook(() => useChat());
  await act(async () => {
    await sendMessage("hello");
  });
  return hook;
}

const SAFE = () => true;

beforeEach(() => {
  localStorage.clear();
  resetToThreadless(null);
  routes = {};
  floor = [];
  install();
  vi.mocked(forgetMessage).mockClear();
  clearDraft();
});
afterEach(() => resolveConfirm(false)); // never leave a dialog open across cases

describe("D81 · the end-of-turn floor", () => {
  it("adopts the sent bubble's server id and the host's `reply` — no client-only row survives", async () => {
    const { result } = await firstTurn();
    expect(result.current.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(result.current.messages.find((m) => m.id === "a1")?.reply).toEqual({
      ids: ["a1"],
      n: 1,
      count: 1,
    });
    expect(result.current.messages.some((m) => m.local)).toBe(false);
  });

  it("keeps the view's own notes, each after the durable row it followed", async () => {
    pushSystemNote("// before anything"); // the head of the log
    routes["POST /api/agent/chat"] = () =>
      sse([
        { event: "thread", data: { threadId: "t1" } },
        { event: "message.start", data: { messageId: "a1" } },
        { event: "text.delta", data: { messageId: "a1", delta: "first take" } },
        { event: "done", data: { state: "capped" } }, // pushes the step-limit note after a1
      ]);
    floor = [U1, A1];
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("hello");
    });
    const order = result.current.messages.map((m) => (m.local ? said(m) : m.id));
    expect(order).toEqual([
      "// before anything",
      "u1",
      "a1",
      "// reached the step limit — send a message to continue",
    ]);
  });

  it("keeps a send the server never took — its bubble and its client-side error — across a floor", async () => {
    const { result } = await firstTurn();
    routes["POST /api/agent/chat"] = () => json({ detail: "boom" }, 500);
    await act(async () => {
      await sendMessage("lost words");
    });
    act(() => applyFloor([U1, A1])); // e.g. a delete/edit elsewhere lands a fresh floor
    const tail = result.current.messages.slice(2);
    expect(tail.map((m) => [m.role, m.local])).toEqual([
      ["user", true],
      ["assistant", true],
    ]);
    expect(said(tail[0])).toBe("lost words");
    expect(tail[1].parts.some((p) => p.type === "error")).toBe(true);
  });

  it("forgets the audio of a durable row a floor no longer carries", async () => {
    await firstTurn();
    act(() => applyFloor([U1]));
    expect(forgetMessage).toHaveBeenCalledWith("a1");
  });
});

describe("D81 · regenerate (retry as a new variant)", () => {
  it("removes exactly `reply.ids`, streams the new take, and lands on the `2/2` floor", async () => {
    const { result } = await firstTurn();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    routes["POST /api/agent/regenerate"] = async () => {
      await held;
      return sse([
        { event: "thread", data: { threadId: "t1" } },
        { event: "message.start", data: { messageId: "a2" } },
        { event: "text.delta", data: { messageId: "a2", delta: "second take" } },
        { event: "done", data: { state: "completed" } },
      ]);
    };
    let run!: Promise<void>;
    act(() => {
      run = regenerate("a1", SAFE);
    });
    // Optimistic: a1 left, the owner's row stayed, and a client-only placeholder streams in its place.
    expect(result.current.status).toBe("streaming");
    expect(result.current.messages.map((m) => m.id)).not.toContain("a1");
    expect(result.current.messages[0].id).toBe("u1");
    expect(result.current.messages.at(-1)?.local).toBe(true);
    expect(forgetMessage).toHaveBeenCalledWith("a1"); // a docked clip of the displaced take is stopped

    floor = [
      U1,
      row({
        id: "a2",
        role: "assistant",
        parts: text("second take"),
        reply: { ids: ["a2"], n: 2, count: 2 },
      }),
    ];
    await act(async () => {
      release();
      await run;
    });
    const post = calls.find((c) => c.url === "/api/agent/regenerate");
    expect(post?.body).toMatchObject({ thread_id: "t1", message_id: "a1", stream: true });
    expect(result.current.status).toBe("idle");
    expect(result.current.messages.map((m) => m.id)).toEqual(["u1", "a2"]);
    expect(result.current.messages[1].reply).toEqual({ ids: ["a2"], n: 2, count: 2 });
  });

  it("a NON-409 refusal (403 rolling thread) is a real error: a toast, no re-attach, the log put back", async () => {
    const { result } = await firstTurn();
    const toasts = renderHook(() => useToasts());
    routes["POST /api/agent/regenerate"] = () =>
      json({ detail: "this is an automation's rolling thread" }, 403);
    await act(async () => {
      await regenerate("a1", SAFE);
    });
    expect(calls.some((c) => c.url.includes("/stream"))).toBe(false); // never the re-attach ladder
    expect(result.current.status).toBe("idle");
    expect(result.current.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(toasts.result.current.at(-1)?.text).toBe(
      "Retry failed — this is an automation's rolling thread",
    );
  });

  it("refuses to retry a reply an UNSENT message follows (the store's own guard)", async () => {
    const { result } = await firstTurn();
    routes["POST /api/agent/chat"] = () => json({ detail: "boom" }, 500);
    await act(async () => {
      await sendMessage("lost words");
    });
    await act(async () => {
      await regenerate("a1", SAFE);
    });
    expect(calls.some((c) => c.url === "/api/agent/regenerate")).toBe(false);
    expect(
      result.current.messages.some((m) => said(m) === "// retry the unsent message below first"),
    ).toBe(true);
  });

  it("a refusal (409 stale) puts the log back and says the server's sentence", async () => {
    const { result } = await firstTurn();
    routes["POST /api/agent/regenerate"] = () => json({ detail: "the conversation changed" }, 409);
    await act(async () => {
      await regenerate("a1", SAFE);
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.messages.filter((m) => !m.local).map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(result.current.messages.some((m) => said(m) === "// the conversation changed")).toBe(
      true,
    );
  });

  it("I4 — a reply that ran a non-retry-safe tool asks ONE confirm first; declining sends nothing", async () => {
    const risky = row({
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "rebooted" },
        { type: "tool_call", call_id: "c1", tool: "reboot_host", args: {}, state: "ok" },
      ],
      reply: { ids: ["a1"], n: 1, count: 1 },
    });
    await firstTurn([U1, risky]);
    routes["POST /api/agent/regenerate"] = () =>
      sse([{ event: "done", data: { state: "completed" } }]);
    const dialog = renderHook(() => useConfirm());
    let run!: Promise<void>;
    act(() => {
      run = regenerate("a1", (tool) => tool !== "reboot_host");
    });
    await act(async () => {});
    expect(dialog.result.current?.title).toBe("Retry this reply?");
    expect(dialog.result.current?.body).toContain("reboot host");
    await act(async () => {
      resolveConfirm(false);
      await run;
    });
    expect(calls.some((c) => c.url === "/api/agent/regenerate")).toBe(false);

    act(() => {
      run = regenerate("a1", (tool) => tool !== "reboot_host");
    });
    await act(async () => {});
    await act(async () => {
      resolveConfirm(true);
      await run;
    });
    expect(calls.some((c) => c.url === "/api/agent/regenerate")).toBe(true);
  });

  it("a retry-safe reply regenerates with no confirm", async () => {
    await firstTurn();
    routes["POST /api/agent/regenerate"] = () =>
      sse([{ event: "done", data: { state: "completed" } }]);
    const dialog = renderHook(() => useConfirm());
    await act(async () => {
      await regenerate("a1", SAFE);
    });
    expect(dialog.result.current).toBeNull();
    expect(calls.some((c) => c.url === "/api/agent/regenerate")).toBe(true);
  });
});

describe("D81 · the F20 inline retry, rerouted", () => {
  it("a server-side error host retries IN PLACE — nothing is re-sent", async () => {
    const errored = row({
      id: "a1",
      role: "assistant",
      parts: [{ type: "error", message: "upstream 502", retryable: true }],
      reply: { ids: ["a1"], n: 1, count: 1 },
    });
    await firstTurn([U1, errored]);
    routes["POST /api/agent/regenerate"] = () =>
      sse([{ event: "done", data: { state: "completed" } }]);
    const sends = calls.filter((c) => c.url === "/api/agent/chat").length;
    await act(async () => {
      await regenerate("a1", SAFE);
    });
    expect(calls.filter((c) => c.url === "/api/agent/chat").length).toBe(sends); // no second user row
    expect(calls.find((c) => c.url === "/api/agent/regenerate")?.body).toMatchObject({
      message_id: "a1",
    });
  });

  it("a cut stream (no floor yet) re-reads the floor and retries the host it finds there", async () => {
    await firstTurn();
    // A second turn whose stream dies with no `done` and no re-attach: the error lands on a2 client-side.
    routes["POST /api/agent/chat"] = () =>
      sse([
        { event: "thread", data: { threadId: "t1" } },
        { event: "message.start", data: { messageId: "a2" } },
      ]);
    routes["GET /api/agent/turns/t1/stream"] = () => json({ detail: "gone" }, 404);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("again");
    });
    expect(result.current.status).toBe("error");
    // …but the server did finish it: its floor has the turn, a2 as the host.
    floor = [
      U1,
      A1,
      row({ id: "u2", role: "user", parts: text("again") }),
      row({
        id: "a2",
        role: "assistant",
        parts: text("late"),
        reply: { ids: ["a2"], n: 1, count: 1 },
      }),
    ];
    // The accepted send's bubble is LANDED (fix wave 1): no floor may keep it beside its durable row.
    expect(result.current.messages.find((m) => m.local && m.role === "user")?.landed).toBe(true);
    routes["POST /api/agent/regenerate"] = () => {
      floor = [
        U1,
        A1,
        row({ id: "u2", role: "user", parts: text("again") }),
        row({
          id: "a3",
          role: "assistant",
          parts: text("better"),
          reply: { ids: ["a3"], n: 2, count: 2 },
        }),
      ];
      return sse([
        { event: "thread", data: { threadId: "t1" } },
        { event: "message.start", data: { messageId: "a3" } },
        { event: "done", data: { state: "completed" } },
      ]);
    };
    await act(async () => {
      await regenerate("a2", SAFE);
    });
    expect(calls.find((c) => c.url === "/api/agent/regenerate")?.body).toMatchObject({
      message_id: "a2",
    });
    // The RENDERED log: the question once (durable), the new take, no client-only leftovers.
    expect(result.current.messages.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a3"]);
    expect(result.current.messages.some((m) => m.local)).toBe(false);
    expect(result.current.status).toBe("idle");
  });

  it("an accepted send whose end-of-turn read FAILED is superseded by the next floor — never shown twice", async () => {
    const { result } = await firstTurn();
    routes["POST /api/agent/chat"] = () =>
      sse([
        { event: "thread", data: { threadId: "t1" } },
        { event: "message.start", data: { messageId: "a2" } },
        { event: "done", data: { state: "completed" } },
      ]);
    routes["GET /api/threads/t1/messages"] = () => json({ detail: "boom" }, 500); // the floor read fails
    await act(async () => {
      await sendMessage("again");
    });
    expect(result.current.messages.filter((m) => said(m) === "again")).toHaveLength(1);
    delete routes["GET /api/threads/t1/messages"];
    const u2 = row({ id: "u2", role: "user", parts: text("again") });
    act(() => applyFloor([U1, A1, u2, row({ id: "a2", role: "assistant", parts: text("x") })]));
    expect(result.current.messages.filter((m) => said(m) === "again").map((m) => m.id)).toEqual([
      "u2",
    ]);
  });

  it("a client error bubble stays only as the LAST row, and goes once the floor shows the agent answered", async () => {
    const { result } = await firstTurn();
    routes["POST /api/agent/chat"] = () => json({ detail: "boom" }, 500);
    await act(async () => {
      await sendMessage("lost words");
    });
    const errBubble = () =>
      result.current.messages.filter((m) => m.local && m.parts.some((p) => p.type === "error"));
    act(() => applyFloor([U1, A1])); // nothing new on the floor → it stays, still last
    expect(errBubble()).toHaveLength(1);
    expect(result.current.messages.at(-1)?.parts.some((p) => p.type === "error")).toBe(true);
    // The floor now shows an AGENT row past where the error stood (another device retried, say).
    act(() =>
      applyFloor([
        U1,
        A1,
        row({ id: "u2", role: "user", parts: text("lost words") }),
        row({ id: "a2", role: "assistant", parts: text("answered") }),
      ]),
    );
    expect(errBubble()).toHaveLength(0);
  });

  it("an error before the first row keeps its bubble LAST (after the durable question); its retry takes it away", async () => {
    const plain = { ...A1, reply: undefined };
    const { result } = await firstTurn([U1, plain]);
    const u2 = row({ id: "u2", role: "user", parts: text("again") });
    routes["POST /api/agent/chat"] = () => {
      floor = [U1, plain, u2]; // the server kept the question; the turn died before any assistant row
      return sse([
        { event: "thread", data: { threadId: "t1" } },
        { event: "error", data: { message: "no endpoint" } },
      ]);
    };
    await act(async () => {
      await sendMessage("again");
    });
    expect(result.current.messages.map((m) => (m.local ? "err" : m.id))).toEqual([
      "u1",
      "a1",
      "u2",
      "err",
    ]);
    const errId = result.current.messages.at(-1)!.id;
    routes["POST /api/agent/regenerate"] = () => {
      floor = [U1, plain, u2, row({ id: "a2", role: "assistant", parts: text("ok now") })];
      return sse([
        { event: "thread", data: { threadId: "t1" } },
        { event: "message.start", data: { messageId: "a2" } },
        { event: "done", data: { state: "completed" } },
      ]);
    };
    await act(async () => {
      await regenerate(errId, SAFE);
    });
    expect(calls.find((c) => c.url === "/api/agent/regenerate")?.body).toMatchObject({
      message_id: "u2", // the answerless anchor (wave 1)
    });
    expect(result.current.messages.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("wave 2 · N1 — a REFUSED retry restores the error bubble it retried (the one door stays)", async () => {
    const plain = { ...A1, reply: undefined };
    const { result } = await firstTurn([U1, plain]);
    const u2 = row({ id: "u2", role: "user", parts: text("again") });
    routes["POST /api/agent/chat"] = () => {
      floor = [U1, plain, u2];
      return sse([
        { event: "thread", data: { threadId: "t1" } },
        { event: "error", data: { message: "no endpoint" } },
      ]);
    };
    await act(async () => {
      await sendMessage("again");
    });
    const errId = result.current.messages.at(-1)!.id;
    routes["POST /api/agent/regenerate"] = () =>
      json({ detail: "a turn is already running on this thread — wait for it to finish" }, 409);
    await act(async () => {
      await regenerate(errId, SAFE);
    });
    const tail = result.current.messages.filter((m) => m.role !== "system").at(-1);
    expect(tail?.id).toBe(errId); // still the last row, still carrying its error…
    expect(tail?.parts.some((p) => p.type === "error")).toBe(true);
    expect(result.current.status).toBe("error"); // …and the status it had, which the pill is gated on
    // The pill itself, in the real transcript — the refusal's NOTE follows the error, and must not hide it.
    globalThis.ResizeObserver ??= class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
    const { messages, status } = result.current;
    render(
      createElement(ChatThread, {
        active: true,
        chat: {
          messages,
          status,
          streamingId: null,
          resultByCall: {},
          currentPlan: null,
          resolvedDefault: undefined,
          ttsOn: false,
        },
      }),
    );
    expect(screen.getByRole("button", { name: "Retry the last message" })).toBeTruthy();
  });

  it("wave 2 · N2 — a send ACCEPTED but never saved stays as unsent, and its retry hands the words back", async () => {
    const { result } = await firstTurn();
    routes["POST /api/agent/chat"] = () =>
      sse([
        { event: "thread", data: { threadId: "t1" } },
        { event: "error", data: { message: "lorebook failed" } }, // before `messages.add` ran
      ]);
    await act(async () => {
      await sendMessage("never saved");
    }); // the end floor is still [u1, a1] — the server has no row for it
    const bubble = result.current.messages.find((m) => said(m) === "never saved");
    expect(bubble?.local).toBe(true);
    expect(bubble?.landed).toBeUndefined(); // unsent again: the floor did not hold it
    const errId = result.current.messages.at(-1)!.id;
    await act(async () => {
      await regenerate(errId, SAFE);
    });
    expect(calls.some((c) => c.url === "/api/agent/regenerate")).toBe(false); // a1 NOT rewritten
    expect(getDraft()).toBe("never saved");
  });

  it("wave 2 · N3 — two refused sends in a row: ONE retry hands both back, nothing is left orphaned", async () => {
    const { result } = await firstTurn();
    routes["POST /api/agent/chat"] = () => json({ detail: "boom" }, 500);
    await act(async () => {
      await sendMessage("first try");
    });
    await act(async () => {
      await sendMessage("second try");
    });
    act(() => applyFloor([U1, A1])); // any floor — the older error is gone (errors never stack)
    const errId = result.current.messages.filter((m) => m.role !== "system").at(-1)!.id;
    await act(async () => {
      await regenerate(errId, SAFE);
    });
    expect(getDraft()).toBe("first try\nsecond try");
    expect(result.current.messages.filter((m) => !m.local).map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(result.current.messages.some((m) => m.local && m.role !== "system")).toBe(false);
  });

  it("wave 2 · N2 — a landed MESSAGE never matches an owner `!exec` row (same kind only)", async () => {
    const { result } = await firstTurn();
    routes["POST /api/agent/chat"] = () =>
      sse([
        { event: "thread", data: { threadId: "t1" } },
        { event: "done", data: { state: "completed" } },
      ]);
    routes["GET /api/threads/t1/messages"] = () => json({ detail: "boom" }, 500); // floor read fails
    await act(async () => {
      await sendMessage("plain words");
    });
    delete routes["GET /api/threads/t1/messages"];
    const exec = row({ id: "x1", role: "assistant", actor: "user", parts: text("") });
    act(() => applyFloor([U1, A1, exec]));
    const bubble = result.current.messages.find((m) => said(m) === "plain words");
    expect(bubble?.local).toBe(true); // kept — the exec row is not its durable form…
    expect(bubble?.landed).toBeUndefined(); // …so it is unsent again
  });

  it("Maya's wave-2 addendum — a steer drained WITHOUT an id is superseded by its durable row (never twice)", async () => {
    await firstTurn();
    let live!: ReadableStreamDefaultController<Uint8Array>;
    const enc = new TextEncoder();
    const frame = (event: string, data: unknown) =>
      enc.encode(`event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`);
    let sends = 0;
    routes["POST /api/agent/chat"] = () => {
      if (++sends === 2) return json({ entry_id: "e1", turn_id: "T" }, 202); // the steer is queued
      return {
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(c) {
            live = c;
            c.enqueue(frame("thread", { threadId: "t1" }));
            c.enqueue(frame("message.start", { messageId: "a2" }));
          },
        }),
        headers: { get: (k: string) => (k === "content-type" ? "text/event-stream" : null) },
      } as unknown as Response;
    };
    const { result } = renderHook(() => useChat());
    let turn!: Promise<unknown>;
    await act(async () => {
      turn = sendMessage("go on");
    });
    await act(async () => {
      await sendMessage("and also");
    });
    expect(result.current.messages.find((m) => m.queued === "e1")).toBeTruthy();
    floor = [
      U1,
      A1,
      row({ id: "u2", role: "user", parts: text("go on") }),
      row({ id: "a2", role: "assistant", parts: text("ok") }),
      row({ id: "u3", role: "user", parts: text("and also") }),
    ];
    await act(async () => {
      live.enqueue(frame("steer.applied", { entryId: "e1", kind: "message", text: "and also" }));
      live.enqueue(frame("done", { state: "completed" }));
      live.close();
      await turn;
    });
    expect(result.current.messages.filter((m) => said(m) === "and also").map((m) => m.id)).toEqual([
      "u3",
    ]);
  });

  it("a retry takes the error bubble with it — errors never stack", async () => {
    const errored = row({
      id: "a1",
      role: "assistant",
      parts: [{ type: "error", message: "upstream 502", retryable: true }],
      reply: { ids: ["a1"], n: 1, count: 1 },
    });
    const { result } = await firstTurn([U1, errored]);
    // First retry: refused with a non-409 → a toast, the log put back, no stacked error bubble.
    routes["POST /api/agent/regenerate"] = () => json({ detail: "boom" }, 500);
    await act(async () => {
      await regenerate("a1", SAFE);
    });
    await act(async () => {
      await regenerate("a1", SAFE);
    });
    expect(result.current.messages.filter((m) => m.local)).toHaveLength(0);
    expect(result.current.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
  });

  it("an ANSWERLESS message (its error take already gone) regenerates by its own id — take 1 (wave 1)", async () => {
    const { result } = await firstTurn([U1]); // the server kept the question, nothing after it
    expect(result.current.messages.map((m) => m.id)).toEqual(["u1"]);
    routes["POST /api/agent/regenerate"] = () =>
      sse([{ event: "done", data: { state: "completed" } }]);
    await act(async () => {
      await regenerate("err-gone", SAFE);
    });
    expect(calls.find((c) => c.url === "/api/agent/regenerate")?.body).toMatchObject({
      message_id: "u1",
    });
    expect(result.current.messages.some((m) => m.id === "u1")).toBe(true); // nothing was displaced
  });

  it("a send that never reached the server goes back to the composer — never a retry of the turn before it", async () => {
    const { result } = await firstTurn();
    routes["POST /api/agent/chat"] = () => json({ detail: "boom" }, 500);
    await act(async () => {
      await sendMessage("lost words");
    });
    expect(result.current.status).toBe("error");
    const errId = result.current.messages.at(-1)!.id;
    await act(async () => {
      await regenerate(errId, SAFE);
    });
    expect(calls.some((c) => c.url === "/api/agent/regenerate")).toBe(false); // a1 was NOT rewritten
    expect(getDraft()).toBe("lost words");
    expect(result.current.status).toBe("idle");
    expect(result.current.messages.some((m) => said(m) === "lost words")).toBe(false);
  });
});

describe("D81 · the sync routes (swap · edit · delete)", () => {
  it("selectAlternate PUTs `{n}` on the host and installs the floor it answers", async () => {
    const two = row({
      id: "a2",
      role: "assistant",
      parts: text("second"),
      reply: { ids: ["a2"], n: 2, count: 2 },
    });
    const { result } = await firstTurn([U1, two]);
    const back = row({
      id: "a1",
      role: "assistant",
      parts: text("first take"),
      reply: { ids: ["a1"], n: 1, count: 2 },
    });
    routes["PUT /api/threads/t1/messages/a2/alternate"] = () => json({ messages: [U1, back] });
    await act(async () => {
      await selectAlternate("a2", 1);
    });
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ n: 1 });
    expect(result.current.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(result.current.messages[1].reply).toMatchObject({ n: 1, count: 2 });
  });

  it("editMessage resolves whether it SAVED — a refusal or a local one is `false`", async () => {
    await firstTurn();
    routes["PATCH /api/threads/t1/messages/a1"] = () =>
      json({ detail: "a message needs text" }, 422);
    let saved: boolean | undefined;
    await act(async () => {
      saved = await editMessage("a1", "");
    });
    expect(saved).toBe(false);
    routes["PATCH /api/threads/t1/messages/a1"] = () => json({ messages: [U1, A1] });
    await act(async () => {
      saved = await editMessage("a1", "fine");
    });
    expect(saved).toBe(true);
  });

  it("a re-attached turn ends on the floor too (its `reply` arrives with it)", async () => {
    const { result } = await firstTurn();
    routes["GET /api/agent/turns/t1/stream"] = () => {
      floor = [
        U1,
        row({ id: "a1", role: "assistant", parts: text("first take") }),
        row({ id: "u2", role: "user", parts: text("steer") }),
        row({
          id: "a2",
          role: "assistant",
          parts: text("drain-B"),
          reply: { ids: ["a1", "a2"], n: 1, count: 1 },
        }),
      ];
      return sse([
        { event: "message.start", data: { messageId: "a2" } },
        { event: "text.delta", data: { messageId: "a2", delta: "drain-B" } },
        { event: "done", data: { state: "completed" } },
      ]);
    };
    await act(async () => {
      await reattachTurn("t1");
    });
    expect(result.current.messages.find((m) => m.id === "a2")?.reply).toMatchObject({ count: 1 });
  });

  it("editMessage PATCHes the text, drops the id's cached clip, installs the floor", async () => {
    const { result } = await firstTurn();
    const edited = { ...A1, parts: text("better take"), edited: "2026-09-27T11:00:00Z" };
    routes["PATCH /api/threads/t1/messages/a1"] = () => json({ messages: [U1, edited] });
    await act(async () => {
      await editMessage("a1", "better take");
    });
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ text: "better take" });
    expect(forgetMessage).toHaveBeenCalledWith("a1");
    expect(said(result.current.messages[1])).toBe("better take");
    expect(result.current.messages[1].edited).toBe("2026-09-27T11:00:00Z");
  });

  it("deleteMessage asks one confirm; only a yes sends the DELETE", async () => {
    const { result } = await firstTurn();
    routes["DELETE /api/threads/t1/messages/a1"] = () => json({ messages: [U1] });
    const dialog = renderHook(() => useConfirm());
    let run!: Promise<void>;
    act(() => {
      run = deleteMessage("a1");
    });
    await act(async () => {});
    expect(dialog.result.current).toMatchObject({ title: "Delete this reply?", danger: true });
    expect(dialog.result.current?.body).toBe(
      "The whole reply leaves the conversation, its tool steps too.",
    );
    await act(async () => {
      resolveConfirm(false);
      await run;
    });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    act(() => {
      run = deleteMessage("a1");
    });
    await act(async () => {});
    await act(async () => {
      resolveConfirm(true);
      await run;
    });
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    expect(result.current.messages.map((m) => m.id)).toEqual(["u1"]);
  });

  it("a refusal says the server's sentence and re-reads the floor", async () => {
    const { result } = await firstTurn();
    routes["PATCH /api/threads/t1/messages/a1"] = () =>
      json({ detail: "a turn is already running on this thread — wait for it to finish" }, 409);
    await act(async () => {
      await editMessage("a1", "x");
    });
    expect(
      result.current.messages.some(
        (m) => said(m) === "// a turn is already running on this thread — wait for it to finish",
      ),
    ).toBe(true);
    expect(calls.filter((c) => c.url === "/api/threads/t1/messages").length).toBeGreaterThan(1);
    expect(forgetMessage).not.toHaveBeenCalledWith("a1");
  });
});
