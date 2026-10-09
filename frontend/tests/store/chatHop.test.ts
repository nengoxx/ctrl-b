import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "../../src/types";

// Phase 27 S6 — HOP WHILE STREAMING (CONVERSATIONS_PLAN §6 "Hop while streaming", R9): the `store/chat`
// swap kernel the S7 doors will call. A swap is allowed while a turn streams; the left turn continues
// server-side as a background conversation. What these pin, through the real public API against a routed
// `fetch` (the real reducer, seq gate, generations and adopt guard run):
//   · `swapView` bumps the stream generation — a live reducer's frames never touch the new view;
//   · the adopt guard (O6) at its three points — `claimStream`, the reducer's `thread` frame, the
//     buffered branch — refuses a send whose POST was still in flight when the view moved; the POST is
//     never aborted;
//   · every arm (M1): a LEFT send that is refused or fails writes nothing into the new view and returns
//     its words to the origin slot (its ORIGIN conversation's draft, S8); a left-send 404 is dropped;
//   · the raw steer lines stay with their thread across a swap (O22);
//   · `openThread` / `/new` (`newConversation` → `mintAndOpen`) no longer refuse while streaming; `openThread(id, home)` installs the
//     home at the swap (H6); an open that 404s toasts "deleted", marks the lists stale and stays (M6).

type Frame = { event: string; data: unknown; id?: string };

const frameText = (f: Frame): string =>
  `event: ${f.event}\r\n${f.id ? `id: ${f.id}\r\n` : ""}data: ${JSON.stringify(f.data)}\r\n\r\n`;

/** An SSE response whose body stays OPEN until `end()` — what a live turn is. `cancelled` resolves once
 *  the CLIENT cancels its reader (the refused adopt lets go of the left stream instead of holding it). */
function openStream(frames: Frame[] = []) {
  const enc = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let markCancelled!: () => void;
  const cancelled = new Promise<void>((r) => (markCancelled = r));
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      for (const f of frames) c.enqueue(enc.encode(frameText(f)));
    },
  });
  // What the client reads: pulled ONLY on the client's own reads (high-water mark 0); a client-side
  // `cancel()` lands here.
  const inner = body.getReader();
  const tee = new ReadableStream<Uint8Array>(
    {
      async pull(c) {
        const { value, done } = await inner.read();
        if (done) c.close();
        else c.enqueue(value);
      },
      cancel() {
        markCancelled();
      },
    },
    { highWaterMark: 0 },
  );
  return {
    res: {
      ok: true,
      status: 200,
      body: tee,
      headers: {
        get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
      },
    } as unknown as Response,
    push: (f: Frame) => controller.enqueue(enc.encode(frameText(f))),
    end: () => controller.close(),
    /** Cut the stream with a read error (a TCP reset) rather than a clean close. */
    fail: (e: unknown) => controller.error(e),
    cancelled,
  };
}

const json = (status: number, payload: unknown): Response =>
  ({
    ok: status < 300,
    status,
    body: {}, // truthy, like a real JSON response's stream (`streamTurn` reaches the buffered branch through it)
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => payload,
  }) as unknown as Response;

function row(id: string, threadId: string, role: "user" | "assistant", text: string): ChatMessage {
  return {
    id,
    thread_id: threadId,
    role,
    parts: [{ type: "text", text }],
    actor: role === "user" ? "user" : "agent",
    ts: new Date().toISOString(),
    tokens: null,
    compacted: false,
  };
}

// ── the routed fetch ─────────────────────────────────────────────────────────────────────────────
/** Per-thread histories for `GET /api/threads/{id}/messages`; a thread in `gone` answers 404. */
let histories: Record<string, ChatMessage[]>;
let gone: Set<string>;
/** The D39 probe (`GET /api/agent/turns/{id}`) per thread; absent → `{active:false}`. */
let probes: Record<string, unknown>;
/** The re-attach stream (`GET /api/agent/turns/{id}/stream`) per thread. */
let reattach: Record<string, () => Response>;
/** What `POST /api/agent/turns/{id}/cancel` answers. */
let cancelAnswer: unknown;
/** Every turn POST (`/api/agent/chat`) parks here until the test answers it — the window a hop lands in. */
interface Parked {
  init: RequestInit | undefined;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
}
let posts: Parked[];
let calls: string[];

/** The router itself — `vi.mocked(fetch).mockImplementation` arms fall through to it. */
function route(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    if (method === "POST" && url === "/api/agent/chat")
      return new Promise<Response>((resolve, reject) => posts.push({ init, resolve, reject }));
    if (method === "POST" && url === "/api/threads")
      return Promise.resolve(json(200, { id: "fresh", title: null, agent: "default" }));
    const hist = /^\/api\/threads\/([^/]+)\/messages$/.exec(url);
    if (method === "GET" && hist) {
      const id = hist[1];
      return Promise.resolve(
        gone.has(id) ? json(404, { detail: "unknown thread" }) : json(200, histories[id] ?? []),
      );
    }
    if (method === "GET" && url.startsWith("/api/threads"))
      return Promise.resolve(json(200, [{ id: "A", agent: "lynette" }]));
    const stream = /^\/api\/agent\/turns\/([^/?]+)\/stream/.exec(url);
    if (method === "GET" && stream) {
      const make = reattach[stream[1]];
      return Promise.resolve(make ? make() : json(200, { active: false }));
    }
    if (method === "POST" && url.includes("/cancel"))
      return Promise.resolve(json(200, cancelAnswer));
    const probe = /^\/api\/agent\/turns\/([^/?]+)$/.exec(url);
    if (method === "GET" && probe)
      return Promise.resolve(json(200, probes[probe[1]] ?? { active: false }));
    return Promise.resolve(json(200, {}));
  }
}

/** Park every request `match` picks until the test answers it; everything else goes to the router. */
function parkWhere(match: (method: string, url: string) => boolean): Parked[] {
  const parked: Parked[] = [];
  vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (!match(method, url)) return route(input, init);
    calls.push(`${method} ${url}`);
    return new Promise<Response>((resolve, reject) => parked.push({ init, resolve, reject }));
  });
  return parked;
}

/** A JSON answer whose HEADERS arrive now and whose BODY only on `release()` — the window inside an
 *  arm's own body read. */
function lateJson(status: number, payload: unknown) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const res = {
    ok: status < 300,
    status,
    body: {},
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => {
      await gate;
      return payload;
    },
  } as unknown as Response;
  return { res, release };
}

/** A FRESH store graph per test: `loaded`, `loadGen`, `streamGeneration` and the raw-line map are
 *  module-level by design, and the composer/toast stores must be the instances THIS chat module writes. */
async function fresh() {
  vi.resetModules();
  const chat = await import("../../src/store/chat");
  const composer = await import("../../src/store/composer");
  const toast = await import("../../src/store/toast");
  const view = renderHook(() => chat.useChat());
  return { chat, composer, toast, view };
}

/** One conversation's draft as stored (Phase 27 S8 — the drafts are per conversation, and the M1 return
 *  lands in the ORIGIN's, never in the view the owner hopped to). */
function draftOf(thread: string): string {
  const blob = JSON.parse(localStorage.getItem("ctrlb.composer") ?? "{}") as {
    drafts?: Record<string, string>;
  };
  return blob.drafts?.[thread] ?? "";
}

/** Let parked microtasks / stream reads run. */
async function flush(n = 4) {
  await act(async () => {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  localStorage.clear();
  histories = {
    A: [row("a-u", "A", "user", "on A"), row("a-r", "A", "assistant", "A replies")],
    B: [row("b-u", "B", "user", "on B"), row("b-r", "B", "assistant", "B replies")],
  };
  gone = new Set();
  probes = {};
  reattach = {};
  cancelAnswer = { cancelled: true, active: false };
  posts = [];
  calls = [];
  vi.stubGlobal("fetch", vi.fn(route));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Open A, send `text` there — its POST parked — and hop to B before the response headers. */
async function sendOnAThenHop(f: Awaited<ReturnType<typeof fresh>>, text = "hello") {
  await act(async () => {
    await f.chat.openThread("A", "lynette");
  });
  let sent!: Promise<string>;
  await act(async () => {
    sent = f.chat.sendMessage(text);
  });
  expect(posts).toHaveLength(1);
  expect(f.view.result.current.status).toBe("streaming");
  await act(async () => {
    expect(await f.chat.openThread("B", "emma")).toBe(true);
  });
  expect(f.view.result.current.threadId).toBe("B");
  return { sent }; // boxed: an async function returning the promise itself would await it here
}

/** The new view, untouched: B's own history, idle, no note / error / placeholder from the left send. */
function expectBUntouched(f: Awaited<ReturnType<typeof fresh>>) {
  const v = f.view.result.current;
  expect(v.threadId).toBe("B");
  expect(v.threadAgent).toBe("emma");
  expect(v.status).toBe("idle");
  expect(v.streamingId).toBeNull();
  expect(v.messages.map((m) => m.id)).toEqual(["b-u", "b-r"]);
}

describe("a swap between Send and the response headers (O6)", () => {
  it("never adopts the left turn's STREAM — the POST is never aborted, the refused reader is cancelled", async () => {
    const f = await fresh();
    const { sent } = await sendOnAThenHop(f);
    expect(posts[0].init?.signal).toBeUndefined(); // nothing could abort it
    const s = openStream([
      { event: "thread", data: { threadId: "A" } },
      { event: "message.start", data: { messageId: "left-m" }, id: "TL:1" },
      { event: "text.delta", data: { messageId: "left-m", delta: "leaked?" }, id: "TL:2" },
    ]);
    posts[0].resolve(s.res);
    await act(async () => {
      expect(await sent).toBe("accepted"); // resolves without the left turn ever ending
    });
    await s.cancelled; // the reader was let go (D39: the turn runs on server-side regardless)
    expectBUntouched(f);
  });

  it("never adopts the left turn's WIRE THREAD — a lazy mint from the thread-less view stays out of B", async () => {
    const f = await fresh();
    let sent!: Promise<string>;
    await act(async () => {
      sent = f.chat.sendMessage("first words"); // thread-less: the server will mint
    });
    await act(async () => {
      await f.chat.openThread("B", "emma");
    });
    const s = openStream([
      { event: "thread", data: { threadId: "minted" } },
      { event: "message.start", data: { messageId: "mint-m" } },
      { event: "done", data: { state: "completed" } },
    ]);
    posts[0].resolve(s.res);
    s.end();
    await act(async () => {
      expect(await sent).toBe("accepted");
    });
    expectBUntouched(f);
  });

  it("never adopts the left turn's BUFFERED floor, thread or status", async () => {
    const f = await fresh();
    const { sent } = await sendOnAThenHop(f);
    const before = calls.length;
    posts[0].resolve(
      json(200, {
        threadId: "A",
        state: "suspended",
        permission: { callId: "c-left", token: "tok-left", prompt: "wake?", tool: "wake_host" },
      }),
    );
    await act(async () => {
      expect(await sent).toBe("accepted");
    });
    expectBUntouched(f);
    // No floor read for A landed after the hop (the buffered branch's `reloadFloor` is the view's).
    expect(calls.slice(before).filter((c) => c.includes("/api/threads/A/messages"))).toEqual([]);
  });
});

describe("after a swap, the left turn's live frames never touch the new view", () => {
  it("a stream claimed BEFORE the swap goes stale with it", async () => {
    const f = await fresh();
    await act(async () => {
      await f.chat.openThread("A", "lynette");
    });
    let sent!: Promise<string>;
    await act(async () => {
      sent = f.chat.sendMessage("hello");
    });
    const s = openStream([
      { event: "thread", data: { threadId: "A" } },
      { event: "message.start", data: { messageId: "m1" }, id: "T:1" },
    ]);
    posts[0].resolve(s.res);
    await waitFor(() =>
      expect(f.view.result.current.messages.some((m) => m.id === "m1")).toBe(true),
    );
    expect(f.view.result.current.status).toBe("streaming");

    await act(async () => {
      expect(await f.chat.openThread("B", "emma")).toBe(true); // no refusal: the hop is allowed
    });
    expectBUntouched(f);

    s.push({ event: "text.delta", data: { messageId: "m1", delta: "more" }, id: "T:2" });
    s.push({ event: "message.start", data: { messageId: "m2" }, id: "T:3" });
    s.push({ event: "error", data: { message: "boom" }, id: "T:4" });
    s.end();
    await act(async () => {
      expect(await sent).toBe("accepted");
    });
    expectBUntouched(f); // no delta, no new bubble, no error bubble, no status flip
    expect(f.chat.getLiveTurn()).toBeNull();
  });

  it("re-entry to the left thread re-attaches to its running turn", async () => {
    const f = await fresh();
    await act(async () => {
      await f.chat.openThread("A", "lynette");
    });
    let sent!: Promise<string>;
    await act(async () => {
      sent = f.chat.sendMessage("hello");
    });
    const left = openStream([
      { event: "thread", data: { threadId: "A" } },
      { event: "message.start", data: { messageId: "m1" }, id: "T:1" },
    ]);
    posts[0].resolve(left.res);
    await waitFor(() => expect(f.view.result.current.status).toBe("streaming"));
    await act(async () => {
      await f.chat.openThread("B", "emma");
    });

    // Back to A: the probe finds the turn still running and the re-attach picks it up.
    probes.A = { active: true };
    const back = openStream([
      {
        event: "turn.sync",
        id: "T:5",
        data: {
          seq: 5,
          terminal: null,
          message: { id: "m1", role: "assistant", agent: null, text: "still going", reasoning: "" },
          calls: [],
        },
      },
    ]);
    reattach.A = () => back.res;
    await act(async () => {
      await f.chat.openThread("A", "lynette");
    });
    await waitFor(() => expect(f.view.result.current.status).toBe("streaming"));
    const m1 = () => f.view.result.current.messages.find((m) => m.id === "m1");
    await waitFor(() => expect(m1()?.parts).toEqual([{ type: "text", text: "still going" }]));
    expect(f.view.result.current.threadId).toBe("A");

    back.push({ event: "text.delta", data: { messageId: "m1", delta: " — done" }, id: "T:6" });
    back.push({ event: "done", data: { state: "completed" }, id: "T:7" });
    back.end();
    await waitFor(() => expect(f.view.result.current.status).toBe("idle"));
    left.end();
    await act(async () => {
      await sent;
    });
  });
});

describe("raw steer lines stay with their thread across a swap (O22)", () => {
  /** A live turn on A with one queued `/cloud` steer — `ack` decides when its 202 lands. */
  async function steerOnA(f: Awaited<ReturnType<typeof fresh>>) {
    await act(async () => {
      await f.chat.openThread("A", "lynette");
    });
    let sent!: Promise<string>;
    await act(async () => {
      sent = f.chat.sendMessage("first");
    });
    const live = openStream([
      { event: "thread", data: { threadId: "A" } },
      { event: "message.start", data: { messageId: "m1" }, id: "T:1" },
    ]);
    posts[0].resolve(live.res);
    await waitFor(() => expect(f.view.result.current.status).toBe("streaming"));
    let steered!: Promise<string>;
    await act(async () => {
      steered = f.chat.sendMessage("do X", { mode: "cloud", raw: "/cloud do X" });
    });
    expect(posts).toHaveLength(2);
    return { live, sent, steered, ack: () => posts[1].resolve(json(202, { entry_id: "e1" })) };
  }

  /** Back on A with e1 still queued server-side, then Stop: the harvest restores what the map holds. */
  async function returnAndStop(f: Awaited<ReturnType<typeof fresh>>) {
    probes.A = { active: true, steer_queue: [{ entry_id: "e1", kind: "message", text: "do X" }] };
    const back = openStream([
      {
        event: "turn.sync",
        id: "T:9",
        data: {
          seq: 9,
          terminal: null,
          message: { id: "m1", role: "assistant", agent: null, text: "…", reasoning: "" },
          calls: [],
          steer_queue: [{ entry_id: "e1", kind: "message", text: "do X" }],
        },
      },
    ]);
    reattach.A = () => back.res;
    await act(async () => {
      await f.chat.openThread("A", "lynette");
    });
    await waitFor(() => expect(f.view.result.current.status).toBe("streaming"));
    expect(f.view.result.current.messages.some((m) => m.queued === "e1")).toBe(true);
    cancelAnswer = {
      cancelled: true,
      active: false,
      steer_queue: [{ entry_id: "e1", kind: "message", text: "do X" }],
    };
    await act(async () => {
      await f.chat.stopTurn();
    });
    back.end();
  }

  it("a steer queued BEFORE the swap: the view's queued bubble goes with the view, the raw line stays with A", async () => {
    const f = await fresh();
    const { live, sent, steered, ack } = await steerOnA(f);
    ack();
    await act(async () => {
      expect(await steered).toBe("accepted");
    });
    expect(f.view.result.current.messages.some((m) => m.queued === "e1")).toBe(true);

    await act(async () => {
      await f.chat.openThread("B", "emma");
    });
    expectBUntouched(f); // only the view's optimistic queue was dropped
    await returnAndStop(f);
    expect(f.composer.getDraft()).toBe("/cloud do X"); // the RAW line — kept across the hop
    live.end();
    await act(async () => {
      await sent;
    });
  });

  it("a steer whose 202 lands AFTER the swap is stored under ITS thread, never marked in the new view", async () => {
    const f = await fresh();
    const { live, sent, steered, ack } = await steerOnA(f);
    await act(async () => {
      await f.chat.openThread("B", "emma");
    });
    ack();
    await act(async () => {
      expect(await steered).toBe("accepted");
    });
    expectBUntouched(f);
    expect(f.composer.getDraft()).toBe(""); // accepted — nothing to return
    await returnAndStop(f);
    expect(f.composer.getDraft()).toBe("/cloud do X");
    live.end();
    await act(async () => {
      await sent;
    });
  });
});

describe("every arm after a swap (M1) — no view write; the words go back to the origin slot", () => {
  it("the 409 arm: no note, no rollback, the text back in the composer", async () => {
    const f = await fresh();
    const { sent } = await sendOnAThenHop(f, "are you there");
    posts[0].resolve(json(409, { detail: "a turn is already running on this thread" }));
    await act(async () => {
      expect(await sent).toBe("refused");
    });
    expectBUntouched(f);
    expect(f.composer.getDraft()).toBe(""); // B's draft is not where A's words go (S8)
    expect(draftOf("A")).toBe("are you there"); // …they go back to A's
  });

  it("the network-failure arm: no error bubble in the new view, the text back, the fate `unknown`", async () => {
    const f = await fresh();
    const { sent } = await sendOnAThenHop(f, "did this land");
    posts[0].reject(new TypeError("Failed to fetch"));
    await act(async () => {
      expect(await sent).toBe("unknown");
    });
    expectBUntouched(f);
    expect(f.composer.getDraft()).toBe(""); // B's draft is not where A's words go (S8)
    expect(draftOf("A")).toBe("did this land"); // …they go back to A's
  });

  it("a non-OK refusal (5xx) after a swap: no failStream into the new view, the text back", async () => {
    const f = await fresh();
    const { sent } = await sendOnAThenHop(f, "try again");
    posts[0].resolve(json(500, {}));
    await act(async () => {
      expect(await sent).toBe("refused");
    });
    expectBUntouched(f);
    expect(f.composer.getDraft()).toBe(""); // B's draft is not where A's words go (S8)
    expect(draftOf("A")).toBe("try again"); // …they go back to A's
  });

  it("the untrackable 202 after a swap: no note, the text back", async () => {
    const f = await fresh();
    const { sent } = await sendOnAThenHop(f, "queue me");
    posts[0].resolve(json(202, {})); // no entry_id
    await act(async () => {
      expect(await sent).toBe("refused");
    });
    expectBUntouched(f);
    expect(f.composer.getDraft()).toBe(""); // B's draft is not where A's words go (S8)
    expect(draftOf("A")).toBe("queue me"); // …they go back to A's
  });

  it("a left-send 404 is dropped silently — nothing written, nothing returned", async () => {
    const f = await fresh();
    const { sent } = await sendOnAThenHop(f, "into the void");
    posts[0].resolve(json(404, { detail: "unknown thread" }));
    await act(async () => {
      expect(await sent).toBe("refused");
    });
    expectBUntouched(f);
    expect(f.composer.getDraft()).toBe("");
  });

  it("the words APPEND to the origin's draft (never clobber it), and B's own draft is untouched", async () => {
    const f = await fresh();
    await act(async () => {
      await f.chat.openThread("A", "lynette");
    });
    act(() => f.composer.setDraft("typed in A")); // a store-level send leaves the draft as it was
    const { sent } = await sendOnAThenHop(f, "left words");
    act(() => f.composer.setDraft("typed in B"));
    posts[0].resolve(json(409, {}));
    await act(async () => {
      await sent;
    });
    expect(f.composer.getDraft()).toBe("typed in B");
    expect(draftOf("A")).toBe("typed in A\nleft words");
  });

  it("without a swap the arms are unchanged — the 409 still notes and rolls back in its own view", async () => {
    const f = await fresh();
    await act(async () => {
      await f.chat.openThread("A", "lynette");
    });
    let sent!: Promise<string>;
    await act(async () => {
      sent = f.chat.sendMessage("busy?");
    });
    posts[0].resolve(json(409, { detail: "a turn is already running on this thread" }));
    await act(async () => {
      expect(await sent).toBe("refused");
    });
    const v = f.view.result.current;
    expect(v.threadId).toBe("A");
    expect(v.messages.some((m) => m.role === "system")).toBe(true);
    expect(f.composer.getDraft()).toBe(""); // its words stay where the owner sees them: the note
  });
});

describe("the doors no longer refuse while streaming (R9)", () => {
  async function streamingOnA(f: Awaited<ReturnType<typeof fresh>>) {
    await act(async () => {
      await f.chat.openThread("A", "lynette");
    });
    let sent!: Promise<string>;
    await act(async () => {
      sent = f.chat.sendMessage("long job");
    });
    const s = openStream([{ event: "thread", data: { threadId: "A" } }]);
    posts[0].resolve(s.res);
    await waitFor(() => expect(f.view.result.current.status).toBe("streaming"));
    return { s, sent };
  }
  const refusalNote = (f: Awaited<ReturnType<typeof fresh>>) =>
    f.view.result.current.messages.some(
      (m) =>
        m.role === "system" &&
        m.parts.some((p) => p.type === "text" && p.text.includes("a turn is running")),
    );

  it("openThread while streaming (the pre-fetch check) swaps", async () => {
    const f = await fresh();
    const { s, sent } = await streamingOnA(f);
    await act(async () => {
      expect(await f.chat.openThread("B", "emma")).toBe(true);
    });
    expectBUntouched(f);
    expect(refusalNote(f)).toBe(false);
    s.end();
    await act(async () => {
      await sent;
    });
  });

  it("a turn that STARTS during the open's fetch (the post-fetch check) no longer cancels the open", async () => {
    const f = await fresh();
    await act(async () => {
      await f.chat.openThread("A", "lynette");
    });
    // Park B's history so a send can start on A while the open is in flight.
    let releaseB!: () => void;
    vi.mocked(globalThis.fetch).mockImplementation((input, init) =>
      String(input) === "/api/threads/B/messages"
        ? new Promise<Response>((r) => (releaseB = () => r(json(200, histories.B))))
        : route(input, init),
    );
    let opened!: Promise<boolean>;
    await act(async () => {
      opened = f.chat.openThread("B", "emma");
    });
    let sent!: Promise<string>;
    await act(async () => {
      sent = f.chat.sendMessage("started mid-open");
    });
    expect(f.view.result.current.status).toBe("streaming");
    releaseB();
    await act(async () => {
      expect(await opened).toBe(true);
    });
    expectBUntouched(f);
    expect(refusalNote(f)).toBe(false);
    // The send that started on A lands after the hop: its stream stays out of B.
    const s = openStream([
      { event: "thread", data: { threadId: "A" } },
      { event: "message.start", data: { messageId: "late" } },
      { event: "done", data: { state: "completed" } },
    ]);
    posts[0].resolve(s.res);
    s.end();
    await act(async () => {
      expect(await sent).toBe("accepted");
    });
    expectBUntouched(f);
  });

  it("`/new` while streaming mints and swaps; the left turn runs on unseen", async () => {
    const f = await fresh();
    const { s, sent } = await streamingOnA(f);
    await act(async () => {
      await f.chat.newConversation();
    });
    const v = f.view.result.current;
    expect(v.threadId).toBe("fresh");
    expect(v.status).toBe("idle");
    expect(refusalNote(f)).toBe(false);
    s.push({ event: "message.start", data: { messageId: "left-m" } });
    s.push({ event: "done", data: { state: "completed" } });
    s.end();
    await act(async () => {
      expect(await sent).toBe("accepted");
    });
    expect(f.view.result.current.threadId).toBe("fresh");
    expect(f.view.result.current.messages.some((m) => m.id === "left-m")).toBe(false);
  });
});

describe("openThread(id, home) — H6, and the 404 arm — M6", () => {
  it("installs the home AT the swap, and never reads the list for it", async () => {
    const f = await fresh();
    await act(async () => {
      await f.chat.openThread("B", "emma");
    });
    expect(f.view.result.current.threadAgent).toBe("emma");
    expect(calls.some((c) => c.startsWith("GET /api/threads?") || c === "GET /api/threads")).toBe(
      false,
    );
  });

  it("…while a door that knows nothing still repairs it late from the list", async () => {
    const f = await fresh();
    await act(async () => {
      await f.chat.openThread("A");
    });
    await waitFor(() => expect(f.view.result.current.threadAgent).toBe("lynette"));
  });

  it("a same-thread re-open with a known home repairs an unknown one in place", async () => {
    const f = await fresh();
    // The list read fails → the home stays unknown.
    vi.mocked(globalThis.fetch).mockImplementation((input, init) =>
      String(input).startsWith("/api/threads?")
        ? Promise.reject(new TypeError("down"))
        : route(input, init),
    );
    await act(async () => {
      await f.chat.openThread("A");
    });
    await flush();
    expect(f.view.result.current.threadAgent).toBeNull();
    await act(async () => {
      expect(await f.chat.openThread("A", "lynette")).toBe(true);
    });
    expect(f.view.result.current.threadAgent).toBe("lynette");
  });

  it("a 404 toasts 'deleted', marks the thread lists stale, and STAYS on the current view", async () => {
    const f = await fresh();
    await act(async () => {
      await f.chat.openThread("A", "lynette");
    });
    const stale = vi.fn();
    const off = f.chat.onThreadListsStale(stale);
    const toasts = renderHook(() => f.toast.useToasts());
    gone.add("dead");
    await act(async () => {
      expect(await f.chat.openThread("dead", "lynette")).toBe(false);
    });
    expect(toasts.result.current.map((t) => t.text)).toEqual(["this conversation was deleted"]);
    expect(stale).toHaveBeenCalledTimes(1);
    const v = f.view.result.current;
    expect(v.threadId).toBe("A");
    expect(v.messages.map((m) => m.id)).toEqual(["a-u", "a-r"]); // no "unreachable" note either
    off();
  });

  it("an unreachable backend keeps its own note — and a superseded 404 says nothing", async () => {
    const f = await fresh();
    await act(async () => {
      await f.chat.openThread("A", "lynette");
    });
    const toasts = renderHook(() => f.toast.useToasts());
    vi.mocked(globalThis.fetch).mockImplementationOnce(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    await act(async () => {
      expect(await f.chat.openThread("B")).toBe(false);
    });
    const notes = f.view.result.current.messages.filter((m) => m.role === "system");
    expect(notes).toHaveLength(1);
    expect(toasts.result.current).toEqual([]);

    // A 404 whose open was superseded by a newer one is silent (the R3 L2 rule).
    gone.add("dead");
    let stale!: Promise<boolean>;
    await act(async () => {
      stale = f.chat.openThread("dead");
      await f.chat.openThread("B", "emma");
    });
    await act(async () => {
      expect(await stale).toBe(false);
    });
    expect(toasts.result.current).toEqual([]);
    expect(f.view.result.current.threadId).toBe("B");
  });
});

describe("a hop DURING a re-attach (M1 — the not-settled re-attach writes nothing)", () => {
  /** A turn live on A whose stream is cut before it settles (a clean EOF, or a read error) — the
   *  recovery's re-attach GET parks, ready for the owner to hop while it is in flight. */
  async function cutOnA(f: Awaited<ReturnType<typeof fresh>>, cut: "eof" | "error") {
    await act(async () => {
      await f.chat.openThread("A", "lynette");
    });
    let sent!: Promise<string>;
    await act(async () => {
      sent = f.chat.sendMessage("hello");
    });
    const s = openStream([
      { event: "thread", data: { threadId: "A" } },
      { event: "message.start", data: { messageId: "m1" }, id: "T:1" },
    ]);
    const parked = parkWhere((m, u) => m === "GET" && u.startsWith("/api/agent/turns/A/stream"));
    posts[0].resolve(s.res);
    await waitFor(() =>
      expect(f.view.result.current.messages.some((m) => m.id === "m1")).toBe(true),
    );
    if (cut === "eof") s.end();
    else s.fail(new TypeError("network error"));
    await waitFor(() => expect(parked).toHaveLength(1));
    return { sent, parked };
  }
  async function hopToB(f: Awaited<ReturnType<typeof fresh>>) {
    await act(async () => {
      expect(await f.chat.openThread("B", "emma")).toBe(true);
    });
    expectBUntouched(f);
  }

  it("headers delayed past the hop: the re-attach never claims — A's frames never land, B untouched", async () => {
    const f = await fresh();
    const { sent, parked } = await cutOnA(f, "eof");
    await hopToB(f);
    const back = openStream([
      { event: "message.start", data: { messageId: "left-r" }, id: "T:2" },
      { event: "text.delta", data: { messageId: "left-r", delta: "LEFT FRAME" }, id: "T:3" },
      { event: "done", data: { state: "completed" }, id: "T:4" },
    ]);
    parked[0].resolve(back.res);
    await act(async () => {
      expect(await sent).toBe("accepted");
    });
    await back.cancelled; // bailed before any frame, like the requireIdle bail
    expectBUntouched(f);
    expect(parked).toHaveLength(1); // and never retried for the view it left
  });

  it("a re-attach that FAILS after the hop: no `connection interrupted` failStream into B", async () => {
    const f = await fresh();
    const { sent, parked } = await cutOnA(f, "eof");
    await hopToB(f);
    parked[0].resolve(json(503, {}));
    await act(async () => {
      expect(await sent).toBe("accepted");
    });
    expectBUntouched(f);
  });

  it("the catch arm's re-attach (a read error) likewise — B untouched, nothing returned (the server took it)", async () => {
    const f = await fresh();
    const { sent, parked } = await cutOnA(f, "error");
    await hopToB(f);
    parked[0].resolve(json(503, {}));
    await act(async () => {
      expect(await sent).toBe("accepted");
    });
    expectBUntouched(f);
    expect(f.composer.getDraft()).toBe("");
  });

  it.each(["capped", "error"])(
    "a re-attach answering `%s` whose forced history read resolves after a hop + a send on B: B stays live",
    async (st) => {
      const f = await fresh();
      const { sent, parked } = await cutOnA(f, "eof");
      const floor = parkWhere((m, u) => m === "GET" && u === "/api/threads/A/messages");
      parked[0].resolve(json(200, { active: false, terminal_status: st, turn_id: "T" }));
      await waitFor(() => expect(floor).toHaveLength(1)); // the forced read is in flight, view on A
      await hopToB(f);
      await act(async () => {
        void f.chat.sendMessage("on B");
      });
      floor[0].resolve(json(200, histories.A));
      await act(async () => {
        expect(await sent).toBe("accepted");
      });
      const v = f.view.result.current;
      expect(v.threadId).toBe("B");
      expect(v.status).toBe("streaming"); // not settled idle, no failStream
      expect(v.messages.slice(0, 2).map((m) => m.id)).toEqual(["b-u", "b-r"]);
      expect(v.messages).toHaveLength(4); // B's send + placeholder, no step-limit note, no error bubble
    },
  );

  it("a re-attach claimed BEFORE the hop that then drops: the retry re-checks and never re-fetches", async () => {
    const f = await fresh();
    const { sent, parked } = await cutOnA(f, "eof");
    const back = openStream([
      { event: "text.delta", data: { messageId: "m1", delta: " more" }, id: "T:2" },
    ]);
    parked[0].resolve(back.res);
    await waitFor(() =>
      expect(
        f.view.result.current.messages
          .find((m) => m.id === "m1")
          ?.parts.some((p) => p.type === "text" && p.text.includes("more")),
      ).toBe(true),
    ); // the re-attach is THE live stream on A
    await hopToB(f);
    back.end(); // it drops before a terminal — attempt 0 would retry
    await flush();
    expect(parked).toHaveLength(1);
    await act(async () => {
      expect(await sent).toBe("accepted");
    });
    expectBUntouched(f);
  });
});

describe("the late windows inside an arm's own await (M1)", () => {
  it("a 409 whose BODY resolves after the hop: no note or settle in B, the text back once", async () => {
    const f = await fresh();
    await act(async () => {
      await f.chat.openThread("A", "lynette");
    });
    let sent!: Promise<string>;
    await act(async () => {
      sent = f.chat.sendMessage("are you there");
    });
    const late = lateJson(409, { detail: "A is busy" });
    posts[0].resolve(late.res);
    await flush(); // the arm is inside its body read, the view still on A
    expect(f.view.result.current.threadId).toBe("A");
    await act(async () => {
      await f.chat.openThread("B", "emma");
    });
    late.release();
    await act(async () => {
      expect(await sent).toBe("refused");
    });
    expectBUntouched(f);
    expect(f.composer.getDraft()).toBe(""); // B's draft is not where A's words go (S8)
    expect(draftOf("A")).toBe("are you there"); // …they go back to A's
  });

  it.each(["capped", "error"])(
    "a buffered `%s` reply whose FLOOR read resolves after the hop: no note, no status in B",
    async (st) => {
      const f = await fresh();
      await act(async () => {
        await f.chat.openThread("A", "lynette");
      });
      let sent!: Promise<string>;
      await act(async () => {
        sent = f.chat.sendMessage("go");
      });
      const floor = parkWhere((m, u) => m === "GET" && u === "/api/threads/A/messages");
      posts[0].resolve(json(200, { threadId: "A", state: st }));
      await waitFor(() => expect(floor).toHaveLength(1));
      await act(async () => {
        await f.chat.openThread("B", "emma");
      });
      floor[0].resolve(json(200, histories.A));
      await act(async () => {
        expect(await sent).toBe("accepted");
      });
      expectBUntouched(f);
    },
  );
});

describe("Stop on A, then a hop to B while the cancel is pending (M1)", () => {
  /** A turn live on A → Stop (its cancel POST parked) → hop to B → a send on B goes live. */
  async function stopOnAThenLiveOnB(f: Awaited<ReturnType<typeof fresh>>) {
    await act(async () => {
      await f.chat.openThread("A", "lynette");
    });
    let sent!: Promise<string>;
    await act(async () => {
      sent = f.chat.sendMessage("long job");
    });
    const s = openStream([
      { event: "thread", data: { threadId: "A" } },
      { event: "message.start", data: { messageId: "m1" }, id: "T:1" },
    ]);
    posts[0].resolve(s.res);
    await waitFor(() => expect(f.view.result.current.status).toBe("streaming"));
    const cancels = parkWhere((m, u) => m === "POST" && u.startsWith("/api/agent/turns/A/cancel"));
    let stopped!: Promise<void>;
    await act(async () => {
      stopped = f.chat.stopTurn();
    });
    expect(cancels).toHaveLength(1);
    await act(async () => {
      await f.chat.openThread("B", "emma");
    });
    await act(async () => {
      void f.chat.sendMessage("on B");
    });
    expect(posts).toHaveLength(2);
    const before = calls.length;
    return { s, sent, stopped, cancels, before };
  }
  /** B, live: its own history + the send's user bubble + its placeholder, still streaming. */
  function expectBLive(f: Awaited<ReturnType<typeof fresh>>) {
    const v = f.view.result.current;
    expect(v.threadId).toBe("B");
    expect(v.status).toBe("streaming");
    expect(v.messages.slice(0, 2).map((m) => m.id)).toEqual(["b-u", "b-r"]);
    expect(v.messages).toHaveLength(4);
  }

  it("the cancel's answer settles nothing in B and reloads nothing — the harvest still comes home", async () => {
    const f = await fresh();
    const { stopped, cancels, before } = await stopOnAThenLiveOnB(f);
    cancels[0].resolve(
      json(200, {
        cancelled: true,
        active: false,
        steer_queue: [{ entry_id: "e9", kind: "message", text: "later" }],
      }),
    );
    await act(async () => {
      await stopped;
    });
    expectBLive(f);
    expect(calls.slice(before).filter((c) => c.includes("/messages"))).toEqual([]);
    expect(f.composer.getDraft()).toBe(""); // a real harvest is not a view write — it goes to A's draft
    expect(draftOf("A")).toBe("later");
  });

  it("a scoped mismatch never starts a re-attach for the view it left", async () => {
    const f = await fresh();
    const { stopped, cancels, before } = await stopOnAThenLiveOnB(f);
    cancels[0].resolve(json(200, { cancelled: false, active: true, turn_id: "T2" }));
    await act(async () => {
      await stopped;
    });
    expectBLive(f);
    expect(calls.slice(before).filter((c) => c.includes("/api/agent/turns/A/stream"))).toEqual([]);
  });

  it("a lost response, retried and lost again: the fallback settle stays out of B", async () => {
    const f = await fresh();
    const { stopped, cancels } = await stopOnAThenLiveOnB(f);
    cancels[0].reject(new TypeError("Failed to fetch"));
    await waitFor(() => expect(cancels).toHaveLength(2)); // the ONE retry
    cancels[1].reject(new TypeError("Failed to fetch"));
    await act(async () => {
      await stopped;
    });
    expectBLive(f);
  });
});

describe("the stream head's `agent` — the minted conversation's home (H6, S3's head)", () => {
  it("a thread-less send whose SSE head carries `agent` installs it at the mint", async () => {
    const f = await fresh();
    let sent!: Promise<string>;
    await act(async () => {
      sent = f.chat.sendMessage("first words");
    });
    const s = openStream([
      { event: "thread", data: { threadId: "minted", title: null, agent: "lynette" } },
      { event: "message.start", data: { messageId: "m1" } },
      { event: "done", data: { state: "completed" } },
    ]);
    posts[0].resolve(s.res);
    s.end();
    await act(async () => {
      expect(await sent).toBe("accepted");
    });
    expect(f.view.result.current.threadId).toBe("minted");
    expect(f.view.result.current.threadAgent).toBe("lynette");
  });

  it("…and the buffered payload's `agent` likewise", async () => {
    const f = await fresh();
    let sent!: Promise<string>;
    await act(async () => {
      sent = f.chat.sendMessage("first words");
    });
    posts[0].resolve(
      json(200, { threadId: "minted", title: null, agent: "lynette", state: "completed" }),
    );
    await act(async () => {
      expect(await sent).toBe("accepted");
    });
    expect(f.view.result.current.threadId).toBe("minted");
    expect(f.view.result.current.threadAgent).toBe("lynette");
  });

  it("an echo never clears — or overwrites — a KNOWN home", async () => {
    const f = await fresh();
    await act(async () => {
      await f.chat.openThread("A", "lynette");
    });
    let sent!: Promise<string>;
    await act(async () => {
      sent = f.chat.sendMessage("hello");
    });
    const s = openStream([
      { event: "thread", data: { threadId: "A" } }, // agent-less
      { event: "thread", data: { threadId: "A", agent: "someone-else" } },
      { event: "message.start", data: { messageId: "m1" } },
      { event: "done", data: { state: "completed" } },
    ]);
    posts[0].resolve(s.res);
    s.end();
    await act(async () => {
      await sent;
    });
    expect(f.view.result.current.threadAgent).toBe("lynette");
  });

  it("…while an UNKNOWN home is repaired from the echo's head", async () => {
    const f = await fresh();
    vi.mocked(globalThis.fetch).mockImplementation((input, init) =>
      String(input).startsWith("/api/threads?")
        ? Promise.reject(new TypeError("down"))
        : route(input, init),
    );
    await act(async () => {
      await f.chat.openThread("A"); // the late list read fails → the home stays unknown
    });
    await flush();
    expect(f.view.result.current.threadAgent).toBeNull();
    let sent!: Promise<string>;
    await act(async () => {
      sent = f.chat.sendMessage("hello");
    });
    const s = openStream([
      { event: "thread", data: { threadId: "A", agent: "lynette" } },
      { event: "done", data: { state: "completed" } },
    ]);
    posts[0].resolve(s.res);
    s.end();
    await act(async () => {
      await sent;
    });
    expect(f.view.result.current.threadAgent).toBe("lynette");
  });
});
