import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "../../src/types";

// Phase 27 S7b — THE SEEN WRITE (CONVERSATIONS_PLAN §6 "Seen write": R30, O11, O10; §12.3 H3, Sol F2) and
// the view's `archived` flag. Through the real `store/chat` (+ `store/ui`'s tab, `lib/composer`'s roster
// installer) against a routed `fetch`:
//   · `PATCH /api/threads/{id} {seen_at}` after history lands, when a turn settles, on the return to the
//     chat tab AFTER its refetch — each only visible + on the chat tab, never for an archived view or one
//     whose `archived` is not known yet; deduped per thread; success publishes "lists stale";
//   · `archived` on the view: a handed home implies `false`; a door that knew nothing gets the RECORD
//     read (`{agent, archived}`); the boot installs it from the record it holds.

const h = vi.hoisted(() => ({ call: false, toasts: [] as string[] }));
vi.mock("../../src/store/liveCall", () => ({ callLive: () => h.call }));
vi.mock("../../src/store/toast", () => ({
  pushToast: (text: string) => h.toasts.push(text),
  useToasts: () => [],
}));

type ThreadRow = { id: string; agent: string | null; archived?: boolean };
let threadList: ThreadRow[];
let byAgent: Record<string, string[]>;
/** Each thread's durable history (the `/messages` answer) — tests append newer rows. */
let histories: Record<string, ChatMessage[]>;
let calls: string[];
let patches: { thread: string; body: Record<string, unknown> }[];
/** How `PATCH /api/threads/{id}` answers. */
let patchStatus: number;
/** How many of the next record reads (`?include_archived=true`) fail at the transport. */
let failRecord: number;
/** Threads whose history read answers 500 (a failed refetch). */
let historyDown: Set<string>;
let held: Map<string, (() => void)[]>;
let holdKeys: Set<string>;
let visibility: DocumentVisibilityState;

const row = (
  id: string,
  thread: string,
  ts: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id,
  thread_id: thread,
  role: "assistant",
  parts: [{ type: "text", text: `${id} says hi` }],
  actor: "agent",
  ts,
  tokens: null,
  compacted: false,
  ...extra,
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
  const key = method === "GET" ? url : `${method} ${url}`;
  calls.push(key);
  const answer = (): Response => {
    if (method === "PATCH") {
      const thread = decodeURIComponent(url.split("/")[3]);
      patches.push({ thread, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return json({ id: thread }, patchStatus);
    }
    if (method === "POST" && url === "/api/agent/chat") {
      const body = JSON.parse(String(init?.body)) as { thread_id: string };
      // the turn persists a reply newer than anything the view held
      histories[body.thread_id] = [
        ...(histories[body.thread_id] ?? []),
        row("reply", body.thread_id, "2026-01-03T00:00:00+00:00"),
      ];
      return Promise.resolve(
        sse([
          { event: "message.start", data: { messageId: "reply" } },
          { event: "done", data: { state: "completed" } },
        ]),
      ) as unknown as Response;
    }
    if (url === "/api/threads?include_archived=true") {
      if (failRecord > 0) {
        failRecord--;
        throw new TypeError("network");
      }
      return json(threadList);
    }
    if (url.startsWith("/api/threads?agent=")) {
      const agent = decodeURIComponent(url.slice("/api/threads?agent=".length).split("&")[0]);
      return json((byAgent[agent] ?? []).slice(0, 1).map((id) => ({ id, agent })));
    }
    if (url.startsWith("/api/threads/") && url.endsWith("/messages")) {
      const thread = url.split("/")[3];
      if (historyDown.has(thread)) return json({ detail: "down" }, 500);
      const msgs = histories[thread];
      return msgs ? json(msgs) : json({ detail: "gone" }, 404);
    }
    if (url.includes("/api/agent/turns/")) return json({ active: false });
    return json({}, 404);
  };
  if (holdKeys.has(key))
    return new Promise((resolve) => {
      (held.get(key) ?? held.set(key, []).get(key)!).push(() => resolve(answer()));
    });
  return Promise.resolve().then(answer);
}
const hold = (key: string) => holdKeys.add(key);
const release = async (key: string) => {
  holdKeys.delete(key);
  for (const r of held.get(key) ?? []) r();
  held.delete(key);
  await act(async () => {});
};

async function fresh(opts: { tab?: "agent" | "fleet" } = {}) {
  vi.resetModules();
  const ui = await import("../../src/store/ui");
  ui.setUI({ tab: opts.tab ?? "agent" });
  const chat = await import("../../src/store/chat");
  const composer = await import("../../src/lib/composer");
  const view = renderHook(() => chat.useChat());
  act(() =>
    composer.installAgents(
      {
        agents: ["lynette", "emma"],
        default: "lynette",
        summaries: { lynette: { title: "Lynette" }, emma: { title: "Emma" } },
      },
      composer.beginAgentsLoad(),
    ),
  );
  const stale = vi.fn();
  chat.onThreadListsStale(stale);
  const flush = () => act(async () => {});
  return { chat, ui, view, stale, flush };
}
type F = Awaited<ReturnType<typeof fresh>>;

async function inL2(f: F) {
  await act(async () => {
    await f.chat.openAgentConversation("lynette");
  });
  await f.flush();
  expect(f.view.result.current.threadId).toBe("L2");
}

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
  histories = {
    L2: [
      row("L2-u", "L2", "2026-01-01T00:00:00+00:00", { role: "user", actor: "user" }),
      row("L2-a", "L2", "2026-01-02T00:00:00+00:00"),
    ],
    L1: [row("L1-a", "L1", "2026-01-01T00:00:00+00:00")],
    E1: [row("E1-a", "E1", "2026-01-01T12:00:00+00:00")],
    R1: [row("R1-a", "R1", "2026-01-01T06:00:00+00:00")],
  };
  calls = [];
  patches = [];
  patchStatus = 200;
  failRecord = 0;
  historyDown = new Set();
  held = new Map();
  holdKeys = new Set();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.stubGlobal("fetch", vi.fn(route));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("(a) the seen write after a conversation's history lands", () => {
  it("a door's open → PATCH {seen_at: the newest row's ts}; success publishes 'lists stale' (O10)", async () => {
    const f = await fresh();
    await inL2(f);
    expect(patches).toEqual([{ thread: "L2", body: { seen_at: "2026-01-02T00:00:00+00:00" } }]);
    expect(f.stale).toHaveBeenCalledTimes(1);
  });

  it("the newest DURABLE row — a local note newer than it is not a seen floor", async () => {
    const f = await fresh();
    await inL2(f);
    act(() => f.chat.pushSystemNote("// a local note"));
    await act(async () => {
      await f.chat.markSeen();
    });
    expect(patches).toHaveLength(1); // nothing durable newer → no second write (the dedupe)
  });

  it("skipped OFF the chat tab, and while hidden", async () => {
    const off = await fresh({ tab: "fleet" });
    await inL2(off);
    expect(patches).toEqual([]);
    visibility = "hidden";
    const hidden = await fresh();
    await inL2(hidden);
    expect(patches).toEqual([]);
  });

  it("a failed PATCH rolls the dedupe back — the next trigger retries; no staleness published", async () => {
    patchStatus = 500;
    const f = await fresh();
    await inL2(f);
    expect(patches).toHaveLength(1);
    expect(f.stale).not.toHaveBeenCalled();
    patchStatus = 200;
    await act(async () => {
      await f.chat.markSeen();
    });
    expect(patches).toHaveLength(2);
    expect(f.stale).toHaveBeenCalledTimes(1);
  });

  it("the boot installs `archived` from the record it holds and marks the stored conversation seen", async () => {
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({ thread: "L2", home: "lynette", responder: null, overrides: {} }),
    );
    const f = await fresh();
    await act(async () => {
      await f.chat.initChat();
    });
    await f.flush();
    expect(f.view.result.current.archived).toBe(false);
    expect(patches.map((p) => p.thread)).toEqual(["L2"]);
  });
});

describe("`archived` on the view (§12.3 H3) — the doors and the record read", () => {
  it("a door that HANDS a home implies archived: false at the swap", async () => {
    const f = await fresh({ tab: "fleet" });
    hold("/api/threads?include_archived=true"); // no record read may be what decides it
    await act(async () => {
      await f.chat.openThread("E1", "emma");
    });
    expect(f.view.result.current.archived).toBe(false);
    expect(calls).not.toContain("/api/threads?include_archived=true");
  });

  it("a door that knew nothing: `null` until the RECORD read lands, then {agent, archived}", async () => {
    const f = await fresh();
    hold("/api/threads?include_archived=true");
    await act(async () => {
      await f.chat.openThread("L1");
    });
    expect(f.view.result.current.archived).toBeNull();
    expect(f.view.result.current.threadAgent).toBeNull();
    expect(patches).toEqual([]); // unknown → no write (the next trigger retries)
    await release("/api/threads?include_archived=true");
    expect(f.view.result.current.threadAgent).toBe("lynette");
    expect(f.view.result.current.archived).toBe(false);
    expect(patches).toEqual([{ thread: "L1", body: { seen_at: "2026-01-01T00:00:00+00:00" } }]);
  });

  it("an ARCHIVED automation run opened from the panel: installed, and never PATCHed", async () => {
    const f = await fresh();
    await act(async () => {
      await f.chat.openThread("R1"); // `AutomationsPanel` knows nothing — the record answers
    });
    await f.flush();
    expect(f.view.result.current.archived).toBe(true);
    expect(f.view.result.current.threadAgent).toBe("emma");
    await act(async () => {
      await f.chat.returnToChat();
    });
    expect(patches).toEqual([]);
  });
});

describe("(b) the seen write when a turn settles in the open view", () => {
  it("the end-of-turn floor carries the reply → PATCH on the floor's newest row", async () => {
    const f = await fresh();
    await inL2(f);
    await act(async () => {
      await f.chat.sendMessage("hi");
    });
    await f.flush();
    expect(patches.map((p) => p.body.seen_at)).toEqual([
      "2026-01-02T00:00:00+00:00",
      "2026-01-03T00:00:00+00:00",
    ]);
  });
});

describe("(c) the return to the chat tab — AFTER the refetch (Sol F2)", () => {
  it("writes the REFRESHED view's newest row, never the stale pre-background floor", async () => {
    const f = await fresh();
    await inL2(f);
    // a reply landed while the owner was away
    histories.L2 = [...histories.L2, row("late", "L2", "2026-01-05T00:00:00+00:00")];
    hold("/api/threads/L2/messages");
    const back = act(async () => {
      await f.chat.returnToChat();
    });
    await f.flush();
    expect(patches).toHaveLength(1); // nothing written before the refetch resolves
    await release("/api/threads/L2/messages");
    await back;
    expect(patches.at(-1)).toEqual({
      thread: "L2",
      body: { seen_at: "2026-01-05T00:00:00+00:00" },
    });
    expect(patches).toHaveLength(2);
  });

  it("a swap DURING the refetch drops the write (the view identity guard)", async () => {
    const f = await fresh();
    await inL2(f);
    histories.L2 = [...histories.L2, row("late", "L2", "2026-01-05T00:00:00+00:00")];
    hold("/api/threads/L2/messages");
    const back = act(async () => {
      await f.chat.returnToChat();
    });
    await f.flush();
    await act(async () => {
      await f.chat.openThread("E1", "emma");
    });
    await f.flush();
    await release("/api/threads/L2/messages");
    await back;
    // E1's own open wrote E1; nothing more was written for L2 (its refreshed floor never installed)
    expect(patches.map((p) => p.thread)).toEqual(["L2", "E1"]);
  });

  it("nothing on a thread-less view", async () => {
    const f = await fresh();
    await act(async () => {
      await f.chat.returnToChat();
    });
    expect(patches).toEqual([]);
  });
});

// ── the S7b fix wave (Sol S7B-01 / S7B-04, Opus F2) ──────────────────────────────────────────────
const recordReads = () => calls.filter((c) => c === "/api/threads?include_archived=true").length;

describe("S7B-01 — the return's seen write follows a SUCCESSFUL floor install only", () => {
  /** L2 opened while OFF the chat tab — never marked seen — then the owner comes back to the chat. */
  async function unseenL2() {
    const f = await fresh({ tab: "fleet" });
    await inL2(f);
    expect(patches).toEqual([]);
    act(() => f.ui.setUI({ tab: "agent" }));
    histories.L2 = [...histories.L2, row("late", "L2", "2026-01-05T00:00:00+00:00")];
    return f;
  }

  it("a FAILED refetch writes nothing (not the unrefreshed floor) — the next trigger retries", async () => {
    const f = await unseenL2();
    historyDown.add("L2");
    await act(async () => {
      await f.chat.returnToChat();
    });
    await f.flush();
    expect(patches).toEqual([]);
    historyDown.delete("L2");
    await act(async () => {
      await f.chat.returnToChat();
    });
    await f.flush();
    expect(patches).toEqual([{ thread: "L2", body: { seen_at: "2026-01-05T00:00:00+00:00" } }]);
  });

  it("a refetch SKIPPED because the view streams writes nothing", async () => {
    const f = await unseenL2();
    hold("POST /api/agent/chat");
    const sent = act(async () => {
      await f.chat.sendMessage("hi"); // the view streams while the POST is in flight
    });
    await f.flush();
    expect(f.view.result.current.status).toBe("streaming");
    await act(async () => {
      await f.chat.returnToChat();
    });
    await f.flush();
    expect(patches).toEqual([]);
    await release("POST /api/agent/chat");
    await sent;
  });
});

describe("S7B-04 — a failed first record read is RETRIED, never left unknown", () => {
  it("a failed first read, then a return to the chat → ONE record read → the seen write proceeds", async () => {
    const f = await fresh();
    failRecord = 1;
    await act(async () => {
      await f.chat.openThread("L1"); // a door that knew nothing; its record read fails
    });
    await f.flush();
    expect(recordReads()).toBe(1);
    expect(f.view.result.current.archived).toBeNull();
    expect(patches).toEqual([]);
    await act(async () => {
      await f.chat.returnToChat();
    });
    await f.flush();
    await f.flush();
    expect(recordReads()).toBe(2); // the one retry
    expect(f.view.result.current.archived).toBe(false);
    expect(f.view.result.current.threadAgent).toBe("lynette");
    expect(patches).toEqual([{ thread: "L1", body: { seen_at: "2026-01-01T00:00:00+00:00" } }]);
  });

  it("a same-id open with no home retries it too", async () => {
    const f = await fresh();
    failRecord = 1;
    await act(async () => {
      await f.chat.openThread("L1");
    });
    await f.flush();
    await act(async () => {
      await f.chat.openThread("L1"); // the panel's row tapped again
    });
    await f.flush();
    await f.flush();
    expect(recordReads()).toBe(2);
    expect(f.view.result.current.archived).toBe(false);
  });

  it("Opus F2 — the roster door's in-place arm (B5) says the view is live", async () => {
    const f = await fresh({ tab: "fleet" });
    hold("/api/threads?include_archived=true");
    await act(async () => {
      await f.chat.openThread("L2"); // no home, the record read parked
    });
    expect(f.view.result.current.archived).toBeNull();
    await act(async () => {
      await f.chat.openAgentConversation("lynette"); // L2 IS her latest → in place
    });
    expect(f.view.result.current.archived).toBe(false);
  });
});

// S7B-C01 — the screen gate is re-checked AFTER the record repair's await.
describe("S7B-C01 — a page hidden or a tab switched during the record retry writes nothing", () => {
  async function retryParked() {
    const f = await fresh();
    failRecord = 1;
    await act(async () => {
      await f.chat.openThread("L1"); // its first record read fails → `archived` unknown
    });
    await f.flush();
    hold("/api/threads?include_archived=true");
    const seen = act(async () => {
      await f.chat.markSeen(); // the retry parks
    });
    await f.flush();
    return { f, seen };
  }

  it("hidden during the await → no PATCH", async () => {
    const { seen } = await retryParked();
    visibility = "hidden";
    await release("/api/threads?include_archived=true");
    await seen;
    expect(patches).toEqual([]);
  });

  it("switched to Fleet during the await → no PATCH", async () => {
    const { f, seen } = await retryParked();
    act(() => f.ui.setUI({ tab: "fleet" }));
    await release("/api/threads?include_archived=true");
    await seen;
    expect(patches).toEqual([]);
  });

  it("still visible, same view → one PATCH", async () => {
    const { seen } = await retryParked();
    await release("/api/threads?include_archived=true");
    await seen;
    expect(patches).toEqual([{ thread: "L1", body: { seen_at: "2026-01-01T00:00:00+00:00" } }]);
  });
});
