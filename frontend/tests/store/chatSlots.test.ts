import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StagedAttachment } from "../../src/store/attachments";
import type { ChatMessage } from "../../src/types";

// Phase 27 S8 — DRAFTS + STAGED RAILS PER CONVERSATION, driven through the real `store/chat`
// (CONVERSATIONS_PLAN §6 "Drafts and staged files — one per conversation", R31/R34/R35; "Deleted
// elsewhere", E6; §12.2 ⑦; §12.3 H2/H4/L6/L7; §12.4 Q6; §2 B13). What is pinned here is what only the
// chat store can do to the two composer stores:
//   · the SLOT follows the view at its three identity writers (`swapView`, `setWireThread`, the cold
//     `loadThread` — B13 across a reload, H2);
//   · the thread-less `""` draft/rail MOVES into a conversation whose slots are empty (the lazy mint,
//     `mintAndOpen`, an existing conversation opened from the thread-less view — Q6) and never merges;
//   · E6 — every move off a deleted conversation carries its draft + rail into what opened (the R29
//     fallback, N3, both arms of the call's teardown runner, the boot's H7 arm), after a stopped
//     dictation's words have landed (L7);
//   · the boot prune (§12.2 ⑦, L6) and the id-addressed rail mutations across a hop (H4).
// The harvest and the left-send return landing in their ORIGIN slot are pinned in `chatHop.test.ts`.

const h = vi.hoisted(() => ({ call: false, toasts: [] as string[] }));
vi.mock("../../src/store/liveCall", () => ({ callLive: () => h.call }));
vi.mock("../../src/store/toast", () => ({
  pushToast: (text: string) => h.toasts.push(text),
  useToasts: () => [],
}));

type ThreadRow = { id: string; agent: string | null; archived?: boolean };
let threadList: ThreadRow[];
let byAgent: Record<string, string[]>;
let gone: Set<string>;
/** When set, every chat POST parks here until the case answers it. */
let parkChat: boolean;
let posts: { resolve: (r: Response) => void }[];
/** When set, the boot's list read parks here. */
let parkList: { resolve: () => void } | null;
/** Threads whose history read parks until the case releases it. */
let parkHistory: Map<string, () => void>;
/** The roster door's `?agent=` read fails (the backend went away mid-boot). */
let failAgentRead: boolean;
/** Agents whose `?agent=` read parks until the case releases it. */
let parkAgent: Map<string, () => void>;

const row = (id: string, thread: string): ChatMessage => ({
  id,
  thread_id: thread,
  role: "assistant",
  parts: [{ type: "text", text: `${id} says hi` }],
  actor: "agent",
  ts: "2026-01-01T00:00:00+00:00",
  tokens: null,
  compacted: false,
});
const json = (v: unknown, status = 200): Response =>
  ({ ok: status < 400, status, json: async () => v }) as unknown as Response;
const sse = (thread: string): Response => {
  const frames = [
    { event: "thread", data: { threadId: thread, agent: "lynette" } },
    { event: "message.start", data: { messageId: `r-${thread}` } },
    { event: "done", data: { state: "completed" } },
  ];
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
  if (method === "POST" && url === "/api/agent/chat") {
    const body = JSON.parse(String(init?.body)) as { thread_id: string | null };
    const thread = body.thread_id ?? "lazy";
    if (gone.has(thread))
      return Promise.resolve(json({ detail: `unknown thread '${thread}'` }, 404));
    if (parkChat) return new Promise((resolve) => posts.push({ resolve }));
    return Promise.resolve(sse(thread));
  }
  if (method === "POST" && url === "/api/threads") {
    const body = JSON.parse(String(init?.body)) as { agent: string };
    return Promise.resolve(
      json({ id: `new-${body.agent}`, title: null, agent: body.agent, archived: false }),
    );
  }
  if (method === "PATCH") return Promise.resolve(json({}));
  if (url === "/api/threads?include_archived=true") {
    const answer = () => json(threadList.filter((t) => !gone.has(t.id)));
    if (parkList) {
      const parked = parkList;
      return new Promise((resolve) => {
        parked.resolve = () => resolve(answer());
      });
    }
    return Promise.resolve(answer());
  }
  if (url.startsWith("/api/threads?agent=") && failAgentRead) return Promise.resolve(json({}, 500));
  if (url.startsWith("/api/threads?agent=")) {
    const agent = decodeURIComponent(url.slice("/api/threads?agent=".length).split("&")[0]);
    const answer = () => {
      const ids = (byAgent[agent] ?? []).filter((id) => !gone.has(id));
      return json(ids.slice(0, 1).map((id) => ({ id, agent })));
    };
    if (parkAgent.has(agent))
      return new Promise((resolve) => parkAgent.set(agent, () => resolve(answer())));
    return Promise.resolve(answer());
  }
  if (url.startsWith("/api/threads/") && url.endsWith("/messages")) {
    const thread = url.split("/")[3];
    if (parkHistory.has(thread))
      return new Promise((resolve) =>
        parkHistory.set(thread, () => resolve(json([row(`${thread}-a`, thread)]))),
      );
    return Promise.resolve(
      gone.has(thread) ? json({ detail: "gone" }, 404) : json([row(`${thread}-a`, thread)]),
    );
  }
  if (url.includes("/api/agent/turns/")) return Promise.resolve(json({ active: false }));
  return Promise.resolve(json({}, 404));
}

/** A fresh page: every module (the chat store, both composer stores) reads storage anew. */
async function fresh() {
  vi.resetModules();
  const ui = await import("../../src/store/ui");
  ui.setUI({ tab: "fleet" });
  const chat = await import("../../src/store/chat");
  const lc = await import("../../src/lib/composer");
  const draft = await import("../../src/store/composer");
  const att = await import("../../src/store/attachments");
  const view = renderHook(() => chat.useChat());
  act(() =>
    lc.installAgents(
      {
        agents: ["lynette", "emma"],
        default: "lynette",
        summaries: { lynette: { title: "Lynette" }, emma: { title: "Emma" } },
      },
      lc.beginAgentsLoad(),
    ),
  );
  const flush = () =>
    act(async () => {
      for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    });
  const at = () => view.result.current.threadId;
  const chips = () => att.stagedFiles().map((f) => `${f.attachmentId ?? f.localId}:${f.status}`);
  return { chat, lc, draft, att, view, flush, at, chips };
}
type F = Awaited<ReturnType<typeof fresh>>;

async function open(f: F, agent: string, expected: string) {
  await act(async () => {
    await f.chat.openAgentConversation(agent);
  });
  await f.flush();
  expect(f.at()).toBe(expected);
}
async function openId(f: F, id: string, home: string) {
  await act(async () => {
    await f.chat.openThread(id, home);
  });
  await f.flush();
  expect(f.at()).toBe(id);
}

const photo = (id: string, over: Partial<StagedAttachment> = {}): StagedAttachment => ({
  localId: `local-${id}`,
  name: `${id}.webp`,
  kind: "image",
  status: "staged",
  attachmentId: id,
  ...over,
});

/** The stored blobs, as the next page load would read them. */
function storedDrafts(): Record<string, string> {
  return (
    (
      JSON.parse(localStorage.getItem("ctrlb.composer") ?? "{}") as {
        drafts?: Record<string, string>;
      }
    ).drafts ?? {}
  );
}
function storedRails(): Record<string, { attachmentId: string }[]> {
  return (
    (
      JSON.parse(localStorage.getItem("ctrlb.attachments") ?? "{}") as {
        rails?: Record<string, { attachmentId: string }[]>;
      }
    ).rails ?? {}
  );
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
  gone = new Set();
  parkChat = false;
  posts = [];
  parkList = null;
  parkHistory = new Map();
  failAgentRead = false;
  parkAgent = new Map();
  vi.stubGlobal("fetch", vi.fn(route));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const DELETED = "this conversation was deleted";

describe("B13 — each conversation keeps its own draft + staged rail", () => {
  it("type + stage in L2, Emma's E1 starts empty, back to L2 — and both survive a reload (H2)", async () => {
    const f = await fresh();
    await open(f, "lynette", "L2");
    act(() => {
      f.draft.setDraft("hello");
      f.att.addStaged(photo("p1"));
    });
    await open(f, "emma", "E1");
    expect(f.draft.getDraft()).toBe("");
    expect(f.chips()).toEqual([]);
    act(() => f.draft.setDraft("hi"));
    await open(f, "lynette", "L2");
    expect(f.draft.getDraft()).toBe("hello");
    expect(f.chips()).toEqual(["p1:staged"]);

    // A RELOAD: the stored tuple names L2, and the cold load (`loadThread`) points the slot at it.
    const g = await fresh();
    await act(async () => {
      await g.chat.initChat();
    });
    await g.flush();
    expect(g.at()).toBe("L2");
    expect(g.draft.getDraft()).toBe("hello");
    expect(g.chips()).toEqual(["p1:staged"]);
    await open(g, "emma", "E1");
    expect(g.draft.getDraft()).toBe("hi");
    expect(g.chips()).toEqual([]);
  });

  it("sending clears only that conversation's draft + rail", async () => {
    const f = await fresh();
    await open(f, "emma", "E1");
    act(() => {
      f.draft.setDraft("hi");
      f.att.addStaged(photo("e-photo"));
    });
    await open(f, "lynette", "L2");
    act(() => {
      f.draft.setDraft("hello");
      f.att.addStaged(photo("p1"));
    });
    // the composer's send: route the text (reserving L2's chips), then clear its draft
    await act(async () => {
      expect(f.lc.runComposer("hello")).toBe(true);
      f.draft.clearDraft();
    });
    await f.flush();
    expect(f.draft.getDraft()).toBe("");
    expect(f.chips()).toEqual([]); // consumed on the accept
    await open(f, "emma", "E1");
    expect(f.draft.getDraft()).toBe("hi");
    expect(f.chips()).toEqual(["e-photo:staged"]);
  });

  it("a draft typed with no conversation open moves into the conversation the first send creates", async () => {
    const f = await fresh();
    expect(f.at()).toBeNull();
    act(() => {
      f.draft.setDraft("typed before any conversation");
      f.att.addStaged(photo("loose"));
    });
    await act(async () => {
      await f.chat.sendMessage("first words"); // a store-level send: the lazy mint ("lazy")
    });
    await f.flush();
    expect(f.at()).toBe("lazy");
    expect(f.draft.getDraft()).toBe("typed before any conversation");
    expect(f.chips()).toEqual(["loose:staged"]);
    expect(storedDrafts()).toEqual({ lazy: "typed before any conversation" });
    expect(Object.keys(storedRails())).toEqual(["lazy"]);
  });
});

describe('the thread-less `""` move (§6, §12.4 Q6)', () => {
  it("into a conversation `mintAndOpen` creates", async () => {
    const f = await fresh();
    act(() => f.draft.setDraft("loose words"));
    await act(async () => {
      await f.chat.mintAndOpen("emma");
    });
    await f.flush();
    expect(f.at()).toBe("new-emma");
    expect(f.draft.getDraft()).toBe("loose words");
    expect(storedDrafts()).toEqual({ "new-emma": "loose words" });
  });

  it("into an EXISTING conversation opened from the thread-less view (a roster door)", async () => {
    const f = await fresh();
    act(() => {
      f.draft.setDraft("loose words");
      f.att.addStaged(photo("loose"));
    });
    await open(f, "lynette", "L2");
    expect(f.draft.getDraft()).toBe("loose words");
    expect(f.chips()).toEqual(["loose:staged"]);
    act(() => f.chat.resetToThreadless());
    expect(f.draft.getDraft()).toBe(""); // `""` gave its content away
  });

  it('NOT into a conversation whose slot already holds content — `""` keeps its own', async () => {
    const f = await fresh();
    await open(f, "lynette", "L2");
    act(() => f.draft.setDraft("mine"));
    act(() => f.chat.resetToThreadless());
    act(() => f.draft.setDraft("loose"));
    await open(f, "lynette", "L2");
    expect(f.draft.getDraft()).toBe("mine"); // nothing merged unasked
    act(() => f.chat.resetToThreadless());
    expect(f.draft.getDraft()).toBe("loose");
  });
});

describe("E6 — a deleted conversation's draft + rail move into what opened", () => {
  /** L1 holds its own draft; L2 (Lynette's latest) holds a draft + a chip; then L2 is deleted elsewhere. */
  async function l2WithContent(f: F) {
    await openId(f, "L1", "lynette");
    act(() => f.draft.setDraft("own L1"));
    await open(f, "lynette", "L2");
    act(() => {
      f.draft.setDraft("in L2");
      f.att.addStaged(photo("p1"));
    });
    gone.add("L2");
  }
  function expectCarriedIntoL1(f: F) {
    expect(f.at()).toBe("L1");
    expect(f.draft.getDraft()).toBe("own L1\n\nin L2"); // after its own draft, a blank line between
    expect(f.chips()).toEqual(["p1:staged"]);
    expect(storedDrafts()).toEqual({ L1: "own L1\n\nin L2" });
    expect(Object.keys(storedRails())).toEqual(["L1"]);
  }

  it("on the R29 fallback (B11)", async () => {
    const f = await fresh();
    await l2WithContent(f);
    await act(async () => {
      await f.chat.reconcileChat();
    });
    await f.flush();
    expect(h.toasts).toEqual([DELETED]);
    expectCarriedIntoL1(f);
  });

  it("a SEND that hit the 404 returns its words to the dead draft first, and the carry takes them", async () => {
    const f = await fresh();
    await l2WithContent(f);
    await act(async () => {
      await f.chat.sendMessage("unsent words");
    });
    await f.flush();
    expect(f.at()).toBe("L1");
    expect(f.draft.getDraft()).toBe("own L1\n\nin L2\nunsent words");
  });

  it("on the call's teardown runner — the latched R29 arm (R42)", async () => {
    const f = await fresh();
    await l2WithContent(f);
    h.call = true;
    await act(async () => {
      await f.chat.reconcileChat(); // latched
    });
    expect(f.at()).toBe("L2");
    h.call = false;
    act(() => f.chat.runAfterCall());
    await f.flush();
    expectCarriedIntoL1(f);
  });

  it("on N3 — the open HOME deleted (B18), and on the teardown runner's home-move arm (M8)", async () => {
    const f = await fresh();
    await open(f, "lynette", "L2");
    act(() => f.draft.setDraft("own L2"));
    await open(f, "emma", "E1");
    act(() => {
      f.draft.setDraft("in E1");
      f.att.addStaged(photo("e1"));
    });
    gone.add("E1");
    byAgent.emma = [];
    act(() => f.chat.leaveDeletedHome("emma"));
    await f.flush();
    expect(f.at()).toBe("L2");
    expect(f.draft.getDraft()).toBe("own L2\n\nin E1");
    expect(f.chips()).toEqual(["e1:staged"]);
    expect(storedDrafts()).toEqual({ L2: "own L2\n\nin E1" });
  });

  it("on the teardown runner's home-move arm (N3 latched in a call, M8)", async () => {
    const f = await fresh();
    await open(f, "emma", "E1");
    act(() => f.draft.setDraft("in E1"));
    h.call = true;
    act(() => f.chat.leaveDeletedHome("emma"));
    await f.flush();
    expect(f.at()).toBe("E1");
    byAgent.emma = [];
    h.call = false;
    act(() => f.chat.runAfterCall());
    await f.flush();
    expect(f.at()).toBe("L2");
    expect(f.draft.getDraft()).toBe("in E1");
    expect(storedDrafts()).toEqual({ L2: "in E1" });
  });

  it("on the boot's H7 arm — carried BEFORE the prune (which would drop the unlisted key)", async () => {
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({ thread: "L9", home: "lynette", responder: null, overrides: {} }),
    );
    localStorage.setItem(
      "ctrlb.composer",
      JSON.stringify({ drafts: { L9: "orphan words", L2: "L2 own" } }),
    );
    localStorage.setItem(
      "ctrlb.attachments",
      JSON.stringify({ rails: { L9: [{ attachmentId: "p9", name: "p9.webp", kind: "image" }] } }),
    );
    const f = await fresh();
    await act(async () => {
      await f.chat.initChat();
    });
    await f.flush();
    expect(h.toasts).toEqual([DELETED]);
    expect(f.at()).toBe("L2");
    expect(f.draft.getDraft()).toBe("L2 own\n\norphan words");
    expect(f.chips()).toEqual(["p9:staged"]);
    expect(storedDrafts()).toEqual({ L2: "L2 own\n\norphan words" });
    expect(Object.keys(storedRails())).toEqual(["L2"]);
  });

  it("the boot prune WAITS for the H7 carry — a dictation stopped by the fallback's swap included (L7)", async () => {
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({ thread: "L9", home: "lynette", responder: null, overrides: {} }),
    );
    localStorage.setItem("ctrlb.composer", JSON.stringify({ drafts: { L9: "orphan words" } }));
    const f = await fresh();
    const unregister = f.draft.registerLiveDictation(async () => {
      await new Promise((r) => setTimeout(r, 0)); // its words land a task later
      unregister();
    });
    await act(async () => {
      await f.chat.initChat();
    });
    await f.flush();
    expect(f.at()).toBe("L2");
    expect(f.draft.getDraft()).toBe("orphan words"); // carried, not pruned as unlisted
  });

  it("Opus N2 — a door tapped DURING the boot read lands with the dead conversation's draft carried", async () => {
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({ thread: "L9", home: "lynette", responder: null, overrides: {} }),
    );
    localStorage.setItem("ctrlb.composer", JSON.stringify({ drafts: { L9: "orphan words" } }));
    parkList = { resolve: () => {} };
    parkAgent.set("emma", () => {});
    const f = await fresh();
    let boot!: Promise<void>;
    let door!: Promise<boolean>;
    await act(async () => {
      boot = f.chat.initChat();
      door = f.chat.openAgentConversation("emma"); // in flight across the boot read
    });
    await act(async () => {
      parkList?.resolve();
      await boot; // L9 is gone — the door outranks the fallback, but the carry is armed
    });
    await act(async () => {
      parkAgent.get("emma")?.();
      await door;
    });
    await f.flush();
    expect(f.at()).toBe("E1");
    expect(f.draft.getDraft()).toBe("orphan words");
    expect(storedDrafts()).toEqual({ E1: "orphan words" });
  });

  it("a boot fallback that FAILS keeps the dead slot (no carry, no prune) for the next boot to retry", async () => {
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({ thread: "L9", home: "lynette", responder: null, overrides: {} }),
    );
    localStorage.setItem("ctrlb.composer", JSON.stringify({ drafts: { L9: "orphan words" } }));
    failAgentRead = true;
    const f = await fresh();
    await act(async () => {
      await f.chat.initChat();
    });
    await f.flush();
    expect(h.toasts).toEqual([DELETED]);
    expect(f.at()).toBeNull(); // the view stayed where it was (thread-less)
    expect(storedDrafts()).toEqual({ L9: "orphan words" });
    // …and the carry stays ARMED: the owner's next door takes the dead conversation's words (F2)
    failAgentRead = false;
    await open(f, "emma", "E1");
    expect(f.draft.getDraft()).toBe("orphan words");
    expect(storedDrafts()).toEqual({ E1: "orphan words" });
  });

  it("F2 — a fallback SUPERSEDED by the owner's own door carries into the door's conversation", async () => {
    const f = await fresh();
    await l2WithContent(f);
    parkAgent.set("lynette", () => {}); // the fallback's `?agent=lynette` read parks
    await act(async () => {
      await f.chat.reconcileChat(); // 404 → the toast → the fallback starts (parked)
    });
    expect(h.toasts).toEqual([DELETED]);
    await openId(f, "E1", "emma"); // the owner's door wins
    await act(async () => {
      parkAgent.get("lynette")?.(); // the superseded fallback lands — and abandons
    });
    await f.flush();
    expect(f.at()).toBe("E1");
    expect(f.draft.getDraft()).toBe("in L2");
    expect(f.chips()).toEqual(["p1:staged"]);
    expect(storedDrafts()).toEqual({ L1: "own L1", E1: "in L2" });
  });

  it("F5 — the roster sweep's M7 move (the open home left the roster elsewhere) carries too", async () => {
    const f = await fresh();
    await open(f, "lynette", "L2");
    act(() => f.draft.setDraft("own L2"));
    await open(f, "emma", "E1");
    act(() => {
      f.draft.setDraft("in E1");
      f.att.addStaged(photo("e1"));
    });
    act(() =>
      f.lc.installAgents(
        { agents: ["lynette"], default: "lynette", summaries: { lynette: { title: "Lynette" } } },
        f.lc.beginAgentsLoad(),
      ),
    );
    await f.flush();
    expect(f.at()).toBe("L2");
    expect(f.draft.getDraft()).toBe("own L2\n\nin E1");
    expect(f.chips()).toEqual(["e1:staged"]);
  });

  it("L7 — the carry WAITS for a stopped streaming dictation's words, and carries them too", async () => {
    const f = await fresh();
    await l2WithContent(f);
    // A live streaming dictation started in L2 (the hook's registration, faked at the store seam): the
    // swap stops it with `navigated`, and its words land in L2 only when the release is done.
    const reasons: string[] = [];
    let land!: () => void;
    const unregister = f.draft.registerLiveDictation(async (reason) => {
      reasons.push(reason);
      await new Promise<void>((resolve) => {
        land = resolve;
      });
      f.draft.appendDraft("late words", " ", "L2");
      unregister();
    });
    await act(async () => {
      await f.chat.reconcileChat();
    });
    await f.flush();
    expect(reasons).toEqual(["navigated"]);
    expect(f.at()).toBe("L1");
    expect(f.draft.getDraft()).toBe("own L1"); // the carry is still waiting…
    expect(storedDrafts().L2).toBe("in L2");
    await act(async () => {
      land();
    });
    await f.flush();
    expect(f.draft.getDraft()).toBe("own L1\n\nin L2 late words"); // …and carried the finals with it
    expect(storedDrafts().L2).toBeUndefined();
  });
});

describe("the boot prune (§12.2 ⑦, §12.3 L6)", () => {
  function seed() {
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({ thread: "L2", home: "lynette", responder: null, overrides: {} }),
    );
    localStorage.setItem(
      "ctrlb.composer",
      JSON.stringify({
        drafts: { "": "loose", L2: "open one", R1: "archived run", E1: "emma's", X9: "dead" },
      }),
    );
    localStorage.setItem(
      "ctrlb.attachments",
      JSON.stringify({
        rails: {
          X9: [{ attachmentId: "x", name: "x.webp", kind: "image" }],
          E1: [{ attachmentId: "e", name: "e.webp", kind: "image" }],
        },
      }),
    );
  }

  it('drops every key not `""`, not listed (archived included) and not the open view\'s', async () => {
    seed();
    const f = await fresh();
    await act(async () => {
      await f.chat.initChat();
    });
    await f.flush();
    expect(f.at()).toBe("L2");
    expect(storedDrafts()).toEqual({
      "": "loose",
      L2: "open one",
      R1: "archived run",
      E1: "emma's",
    });
    expect(Object.keys(storedRails())).toEqual(["E1"]);
    expect(f.draft.getDraft()).toBe("open one");
    await open(f, "emma", "E1");
    expect(f.chips()).toEqual(["e:staged"]); // the in-memory rails are pruned to the same keys
  });

  it("is SKIPPED when a door moved the generation during the cold load — even off the minted view", async () => {
    seed();
    parkHistory.set("L2", () => {}); // the stored thread's history read parks
    const f = await fresh();
    let boot!: Promise<void>;
    await act(async () => {
      boot = f.chat.initChat();
    });
    await f.flush();
    await act(async () => {
      await f.chat.mintAndOpen("emma"); // a roster-door mint during the boot…
    });
    act(() => f.draft.setDraft("typing during boot")); // …typed in…
    await openId(f, "L1", "lynette"); // …and left again before the boot finished
    await act(async () => {
      parkHistory.get("L2")?.();
      await boot;
    });
    await f.flush();
    expect(f.at()).toBe("L1");
    expect(storedDrafts()["new-emma"]).toBe("typing during boot"); // unlisted, not open — kept
    expect(storedDrafts().X9).toBe("dead"); // nothing pruned under a moved generation
  });

  it("is SKIPPED when the boot generation moved — a roster-door mint + typing during the boot read", async () => {
    seed();
    parkList = { resolve: () => {} };
    const f = await fresh();
    let boot!: Promise<void>;
    await act(async () => {
      boot = f.chat.initChat();
    });
    await act(async () => {
      await f.chat.mintAndOpen("emma"); // the owner's door during the boot read
    });
    expect(f.at()).toBe("new-emma");
    act(() => f.draft.setDraft("typing during boot"));
    await act(async () => {
      parkList?.resolve();
      await boot;
    });
    await f.flush();
    expect(f.at()).toBe("new-emma");
    expect(storedDrafts()["new-emma"]).toBe("typing during boot");
    expect(storedDrafts().X9).toBe("dead"); // nothing pruned under a moved generation
  });
});

describe("Opus N1 — the auto-send gate tells the lazy MINT from a DOOR (real paths)", () => {
  it('a real `sendMessage` from `""` mints X: a recording started thread-less may auto-send in X', async () => {
    const f = await fresh();
    await act(async () => {
      await f.chat.sendMessage("first words"); // the wire mint → `setWireThread`
    });
    await f.flush();
    expect(f.at()).toBe("lazy");
    expect(f.draft.sendsInView("")).toBe(true);
  });

  it('a roster door from `""` into an empty conversation is a hop: nothing started thread-less sends', async () => {
    const f = await fresh();
    await open(f, "lynette", "L2");
    expect(f.draft.sendsInView("")).toBe(false);
    expect(f.draft.sendsInView("L2")).toBe(true); // what started here still may
  });
});

describe("the swap stops a live streaming dictation FIRST (§12.2 ④, §12.3 L7)", () => {
  /** The hook's registration, faked at the store seam: records each stop, resolves at once. */
  function liveDictation(f: F): string[] {
    const reasons: string[] = [];
    const unregister = f.draft.registerLiveDictation(async (reason) => {
      reasons.push(reason);
      unregister();
    });
    return reasons;
  }

  it("a roster door, `/new` and the thread-less reset each stop it", async () => {
    const f = await fresh();
    await open(f, "lynette", "L2");
    let reasons = liveDictation(f);
    await open(f, "emma", "E1");
    expect(reasons).toEqual(["navigated"]);
    act(() => f.draft.setDraft("an owner turn")); // (irrelevant to the stop — /new mints from E1)
    await act(async () => {
      await f.chat.sendMessage("so /new is not a no-op");
    });
    await f.flush();
    reasons = liveDictation(f);
    await act(async () => {
      await f.chat.newConversation();
    });
    await f.flush();
    expect(f.at()).toBe("new-emma");
    expect(reasons).toEqual(["navigated"]);
    reasons = liveDictation(f);
    act(() => f.chat.resetToThreadless());
    expect(reasons).toEqual(["navigated"]);
  });
});

describe("H4 — a hop mid-send / mid-upload never strands L2's chips", () => {
  async function sendOnL2ThenHop(f: F) {
    await open(f, "lynette", "L2");
    act(() => f.att.addStaged(photo("p1")));
    parkChat = true;
    await act(async () => {
      expect(f.lc.runComposer("look")).toBe(true); // reserves p1 and sends
    });
    expect(f.chips()).toEqual(["p1:sending"]);
    await open(f, "emma", "E1");
    // the send-building reads are slot-scoped: E1 has nothing to offer
    expect(f.chips()).toEqual([]);
    expect(f.att.hasStaged()).toBe(false);
    expect(f.att.stagedIds()).toEqual([]);
    expect(posts).toHaveLength(1);
  }

  it("a refusal after the hop releases L2's chip back to `staged` (by id, across rails)", async () => {
    const f = await fresh();
    await sendOnL2ThenHop(f);
    await act(async () => {
      posts[0].resolve(json({ detail: "busy" }, 409));
    });
    await f.flush();
    expect(f.chips()).toEqual([]); // E1 untouched
    await open(f, "lynette", "L2");
    expect(f.chips()).toEqual(["p1:staged"]);
    expect(f.draft.getDraft()).toBe("look"); // the left send's words went home too (M1)
  });

  it("an accept after the hop consumes L2's chip (by id, across rails)", async () => {
    const f = await fresh();
    await sendOnL2ThenHop(f);
    await act(async () => {
      posts[0].resolve(sse("L2"));
    });
    await f.flush();
    await open(f, "lynette", "L2");
    expect(f.chips()).toEqual([]);
    expect(storedRails()).toEqual({});
  });

  it("an upload that finishes after the hop lands in L2's rail; E1's send is not held by it", async () => {
    const f = await fresh();
    await open(f, "lynette", "L2");
    act(() =>
      f.att.addStaged({ localId: "u1", name: "big.png", kind: "image", status: "uploading" }),
    );
    expect(f.att.isUploading()).toBe(true);
    await open(f, "emma", "E1");
    expect(f.att.isUploading()).toBe(false); // a send waits for ITS conversation's upload only
    act(() => f.att.updateStaged("u1", { status: "staged", attachmentId: "p9" }));
    expect(f.chips()).toEqual([]);
    await open(f, "lynette", "L2");
    expect(f.chips()).toEqual(["p9:staged"]);
  });
});
