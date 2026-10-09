import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "../../src/types";

// Phase 27 S7b — DELETED ELSEWHERE (CONVERSATIONS_PLAN §6 "Deleted elsewhere": R29, R42, §12.3 M8; §2
// B11, B12, B18) and the open-home move after an agent delete (N3). Through the real `store/chat`:
//   · a 404 from each thread-scoped source on the OPEN live conversation — a send, the seen PATCH, a
//     history read (the reconnect's `reconcileChat`, the return's floor, the boot's `loadThread`) — →
//     the toast "this conversation was deleted" → the HOME's latest (`openAgentConversation`); an unknown
//     home → the configured default; an ARCHIVED view is never a source;
//   · in a call the 404 is LATCHED (no toast, no swap) and the call's teardown runner swaps ONCE — not
//     when the view already moved;
//   · N3 (`leaveDeletedHome`): the deleted agent was the open home → the default's latest, no toast;
//     latched in a call (M8), as is the roster sweep's move.

const h = vi.hoisted(() => ({ call: false, toasts: [] as string[] }));
vi.mock("../../src/store/liveCall", () => ({ callLive: () => h.call }));
vi.mock("../../src/store/toast", () => ({
  pushToast: (text: string) => h.toasts.push(text),
  useToasts: () => [],
}));

type ThreadRow = { id: string; agent: string | null; archived?: boolean };
let threadList: ThreadRow[];
let byAgent: Record<string, string[]>;
/** Threads deleted on "the other device": every thread-scoped route answers 404 for them. */
let gone: Set<string>;
let calls: string[];
let patchStatus: number;
/** The lazy mint's `thread` frame home (`undefined` = the head names none). */
let lazyHome: string | undefined;
let visibility: DocumentVisibilityState;

const row = (id: string, thread: string, ts = "2026-01-01T00:00:00+00:00"): ChatMessage => ({
  id,
  thread_id: thread,
  role: "assistant",
  parts: [{ type: "text", text: `${id} says hi` }],
  actor: "agent",
  ts,
  tokens: null,
  compacted: false,
});
const json = (v: unknown, status = 200): Response =>
  ({ ok: status < 400, status, json: async () => v }) as unknown as Response;
const sse = (frames: { event: string; data: unknown }[]): Response => {
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
};

function route(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? "GET";
  calls.push(method === "GET" ? url : `${method} ${url}`);
  const answer = (): Response => {
    if (method === "PATCH") {
      const thread = decodeURIComponent(url.split("/")[3]);
      return gone.has(thread) ? json({ detail: "gone" }, 404) : json({}, patchStatus);
    }
    if (method === "POST" && url === "/api/threads") {
      const body = JSON.parse(String(init?.body)) as { agent: string };
      return json({ id: `new-${body.agent}`, title: null, agent: body.agent, archived: false });
    }
    if (method === "POST" && url === "/api/agent/chat") {
      const body = JSON.parse(String(init?.body)) as { thread_id: string | null };
      if (body.thread_id && gone.has(body.thread_id))
        return json({ detail: `unknown thread '${body.thread_id}'` }, 404);
      const thread = body.thread_id ?? "lazy";
      return sse([
        { event: "thread", data: { threadId: thread, ...(lazyHome ? { agent: lazyHome } : {}) } },
        { event: "message.start", data: { messageId: `r-${calls.length}` } },
        { event: "done", data: { state: "completed" } },
      ]);
    }
    if (url === "/api/threads?include_archived=true")
      return json(threadList.filter((t) => !gone.has(t.id)));
    if (url.startsWith("/api/threads?agent=")) {
      const agent = decodeURIComponent(url.slice("/api/threads?agent=".length).split("&")[0]);
      const ids = (byAgent[agent] ?? []).filter((id) => !gone.has(id));
      return json(ids.slice(0, 1).map((id) => ({ id, agent })));
    }
    if (url.startsWith("/api/threads/") && url.endsWith("/messages")) {
      const thread = url.split("/")[3];
      return gone.has(thread) ? json({ detail: "gone" }, 404) : json([row(`${thread}-a`, thread)]);
    }
    if (url.includes("/api/agent/turns/")) return json({ active: false });
    return json({}, 404);
  };
  return Promise.resolve().then(answer);
}

async function fresh(opts: { tab?: "agent" | "fleet" } = {}) {
  vi.resetModules();
  const ui = await import("../../src/store/ui");
  ui.setUI({ tab: opts.tab ?? "fleet" });
  const chat = await import("../../src/store/chat");
  const composer = await import("../../src/lib/composer");
  const draft = await import("../../src/store/composer");
  const view = renderHook(() => chat.useChat());
  const land = (agents = ["lynette", "emma"]) =>
    act(() =>
      composer.installAgents(
        {
          agents,
          default: "lynette",
          summaries: Object.fromEntries(
            agents.map((a) => [a, { title: a[0].toUpperCase() + a.slice(1) }]),
          ),
        },
        composer.beginAgentsLoad(),
      ),
    );
  land();
  const flush = () => act(async () => {});
  const at = () => view.result.current.threadId;
  return { chat, ui, view, draft, land, flush, at };
}
type F = Awaited<ReturnType<typeof fresh>>;

async function open(f: F, agent: string, expected: string) {
  await act(async () => {
    await f.chat.openAgentConversation(agent);
  });
  await f.flush();
  expect(f.at()).toBe(expected);
}
/** "The owner deletes it on the desktop." */
const deleteElsewhere = (id: string) => gone.add(id);

beforeEach(() => {
  localStorage.clear();
  h.call = false;
  h.toasts = [];
  threadList = [
    { id: "L2", agent: "lynette" },
    { id: "E1", agent: "emma" },
    { id: "L1", agent: "lynette" },
    { id: "R1", agent: "emma", archived: true },
  ];
  byAgent = { lynette: ["L2", "L1"], emma: ["E1"] };
  gone = new Set();
  calls = [];
  patchStatus = 200;
  lazyHome = "lynette";
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.stubGlobal("fetch", vi.fn(route));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const DELETED = "this conversation was deleted";

describe("B11 — a 404 on the OPEN conversation → the toast → the HOME's latest (R29)", () => {
  it("from a SEND: the toast, Lynette's latest (L2) opens, the unsent words back in the composer", async () => {
    const f = await fresh();
    await open(f, "lynette", "L2");
    // L2 is open; L1 too old to matter — the desktop deletes L2, so Lynette's latest is now L1
    deleteElsewhere("L2");
    await act(async () => {
      await f.chat.sendMessage("draft text");
    });
    await f.flush();
    expect(h.toasts).toEqual([DELETED]);
    expect(f.at()).toBe("L1");
    expect(f.view.result.current.threadAgent).toBe("lynette");
    expect(f.draft.getDraft()).toBe("draft text"); // returned to L2's draft, then carried into L1 (E6)
    // no failed bubble rode into the conversation that opened
    expect(f.view.result.current.messages.map((m) => m.id)).toEqual(["L1-a"]);
  });

  it("from the SEEN PATCH (the return to the chat tab)", async () => {
    const f = await fresh();
    await open(f, "lynette", "L2");
    // the history read still answers (the desktop's delete raced it) — only the PATCH 404s
    act(() => f.ui.setUI({ tab: "agent" }));
    gone.add("L2");
    await act(async () => {
      await f.chat.markSeen();
    });
    await f.flush();
    expect(h.toasts).toEqual([DELETED]);
    expect(f.at()).toBe("L1");
  });

  it("from a history read — the SSE reconnect's `reconcileChat`", async () => {
    const f = await fresh();
    await open(f, "lynette", "L2");
    deleteElsewhere("L2");
    await act(async () => {
      await f.chat.reconcileChat();
    });
    await f.flush();
    expect(h.toasts).toEqual([DELETED]);
    expect(f.at()).toBe("L1");
  });

  it("from a history read — the return's floor refetch, the toast ONCE though the PATCH 404s too", async () => {
    const f = await fresh({ tab: "agent" });
    await open(f, "lynette", "L2");
    deleteElsewhere("L2");
    await act(async () => {
      await f.chat.returnToChat();
    });
    await f.flush();
    expect(h.toasts).toEqual([DELETED]);
    expect(f.at()).toBe("L1");
  });

  it("from the boot's `loadThread` (listed, then deleted before its history read)", async () => {
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({ thread: "L2", home: "lynette", responder: null, overrides: {} }),
    );
    const f = await fresh();
    // the list still names L2 (the delete lands between the two reads)
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/threads?include_archived=true") {
          gone.add("L2");
          return Promise.resolve(json(threadList));
        }
        return route(input, init);
      }),
    );
    await act(async () => {
      await f.chat.initChat();
    });
    await f.flush();
    expect(h.toasts).toEqual([DELETED]);
    expect(f.at()).toBe("L1");
  });

  it("an UNKNOWN home → the configured default's latest", async () => {
    const f = await fresh();
    lazyHome = undefined; // the head names no home — the view's home stays unknown (H6)
    await act(async () => {
      await f.chat.sendMessage("hi"); // the thread-less view mints "lazy"
    });
    await f.flush();
    expect(f.at()).toBe("lazy");
    expect(f.view.result.current.threadAgent).toBeNull();
    deleteElsewhere("lazy");
    await act(async () => {
      await f.chat.reconcileChat();
    });
    await f.flush();
    expect(h.toasts).toEqual([DELETED]);
    expect(f.at()).toBe("L2"); // Lynette = the configured default
  });

  it("an ARCHIVED view is never a source: its history 404 changes nothing", async () => {
    const f = await fresh();
    await act(async () => {
      await f.chat.openThread("R1");
    });
    await f.flush();
    expect(f.view.result.current.archived).toBe(true);
    deleteElsewhere("R1");
    await act(async () => {
      await f.chat.reconcileChat();
    });
    await f.flush();
    expect(h.toasts).toEqual([]);
    expect(f.at()).toBe("R1");
  });

  it("a failure that is not a 404 is not a delete", async () => {
    const f = await fresh({ tab: "agent" });
    await open(f, "lynette", "L2");
    patchStatus = 500;
    await act(async () => {
      await f.chat.markSeen();
    });
    expect(h.toasts).toEqual([]);
    expect(f.at()).toBe("L2");
  });
});

describe("B12 — deleted elsewhere DURING a call: latched, then once at the teardown (R42)", () => {
  it("no toast, no swap while the call is up; the teardown runner swaps ONCE", async () => {
    const f = await fresh();
    await open(f, "lynette", "L2");
    h.call = true;
    deleteElsewhere("L2");
    await act(async () => {
      await f.chat.sendMessage("an utterance"); // fails, as B12 says — no toast, no swap
    });
    await act(async () => {
      await f.chat.reconcileChat();
    });
    await f.flush();
    expect(h.toasts).toEqual([]);
    expect(f.at()).toBe("L2");
    act(() => f.chat.runAfterCall()); // a redial's remount: the call is still up — it waits
    expect(h.toasts).toEqual([]);
    h.call = false; // hung up
    act(() => f.chat.runAfterCall());
    await f.flush();
    expect(h.toasts).toEqual([DELETED]);
    expect(f.at()).toBe("L1");
    act(() => f.chat.runAfterCall()); // once
    await f.flush();
    expect(h.toasts).toEqual([DELETED]);
  });

  it("not when the view already moved by the teardown", async () => {
    const f = await fresh();
    await open(f, "lynette", "L2");
    h.call = true;
    deleteElsewhere("L2");
    await act(async () => {
      await f.chat.reconcileChat();
    });
    h.call = false;
    await open(f, "emma", "E1");
    act(() => f.chat.runAfterCall());
    await f.flush();
    expect(h.toasts).toEqual([]);
    expect(f.at()).toBe("E1");
  });
});

describe("N3 — the deleted agent was the open HOME (B18): the default's latest, no toast", () => {
  it("moves at once — the responder cleared with the swap; never the 404 path", async () => {
    const f = await fresh();
    await open(f, "emma", "E1");
    act(() => f.chat.setResponder("lynette"));
    // the delete succeeded server-side (either branch of the second confirm)
    gone.add("E1");
    byAgent.emma = [];
    calls = [];
    act(() => f.chat.leaveDeletedHome("emma"));
    await f.flush();
    expect(f.at()).toBe("L2");
    expect(f.view.result.current.responder).toBeNull();
    expect(h.toasts).toEqual([]); // the delete's own toast speaks
    expect(calls).toContain("/api/threads?agent=lynette&limit=1"); // the configured default's latest
    expect(calls).not.toContain("/api/threads?agent=emma&limit=1"); // never the deleted slug
  });

  it("another agent's delete moves nothing", async () => {
    const f = await fresh();
    await open(f, "lynette", "L2");
    act(() => f.chat.leaveDeletedHome("emma"));
    await f.flush();
    expect(f.at()).toBe("L2");
  });

  it("M8 — in a call the move LATCHES and runs at the teardown", async () => {
    const f = await fresh();
    await open(f, "emma", "E1");
    h.call = true;
    act(() => f.chat.leaveDeletedHome("emma"));
    await f.flush();
    expect(f.at()).toBe("E1");
    h.call = false;
    act(() => f.chat.runAfterCall());
    await f.flush();
    expect(f.at()).toBe("L2");
    expect(h.toasts).toEqual([]);
  });

  it("M8 via the roster sweep (a delete on another device, seen in a call) latches the same way", async () => {
    const f = await fresh();
    await open(f, "emma", "E1");
    h.call = true;
    f.land(["lynette"]); // emma left the roster
    await f.flush();
    expect(f.at()).toBe("E1");
    h.call = false;
    act(() => f.chat.runAfterCall());
    await f.flush();
    expect(f.at()).toBe("L2");
  });
});

// ── the S7b fix wave (Sol S7B-02, S7B-03) ────────────────────────────────────────────────────────
describe("S7B-02 — two latches on the open view: the HOME MOVE takes precedence", () => {
  it("a 404 latched, then its home deleted before hang-up → ONE N3 move, no toast, never the dead slug", async () => {
    const f = await fresh();
    await open(f, "emma", "E1");
    h.call = true;
    deleteElsewhere("E1");
    await act(async () => {
      await f.chat.reconcileChat(); // latches R29 (pendingDeleted)
    });
    act(() => f.chat.leaveDeletedHome("emma")); // then the home goes on this device (M8)
    byAgent.emma = [];
    calls = [];
    h.call = false;
    act(() => f.chat.runAfterCall());
    await f.flush();
    expect(h.toasts).toEqual([]); // a LOCAL delete — never the remote-delete toast
    expect(f.at()).toBe("L2");
    expect(calls).not.toContain("/api/threads?agent=emma&limit=1");
    expect(calls).not.toContain("POST /api/threads"); // no mint for the dead slug
  });
});

describe("S7B-03 — N3 never targets a deleted CONFIGURED DEFAULT", () => {
  it("deleting the configured default with its conversation open → the ROOT's latest (no mint)", async () => {
    const f = await fresh();
    byAgent.default = ["D1"];
    await open(f, "lynette", "L2");
    calls = [];
    act(() => f.chat.leaveDeletedHome("lynette")); // the cached roster still names her the default
    await f.flush();
    expect(f.at()).toBe("D1");
    expect(calls).toContain("/api/threads?agent=default&limit=1");
    expect(calls).not.toContain("/api/threads?agent=lynette&limit=1");
    expect(calls).not.toContain("POST /api/threads");
  });

  it("…and the same choice at the call's teardown", async () => {
    const f = await fresh();
    byAgent.default = ["D1"];
    await open(f, "lynette", "L2");
    h.call = true;
    act(() => f.chat.leaveDeletedHome("lynette"));
    h.call = false;
    act(() => f.chat.runAfterCall());
    await f.flush();
    expect(f.at()).toBe("D1");
  });
});
