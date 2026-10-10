import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StagedAttachment } from "../../src/store/attachments";
import type { ChatMessage } from "../../src/types";

// Phase 27 S9b — `conversationRemoved`: THIS device deleted a conversation from the sheet (CONVERSATIONS_PLAN
// §2 B8, §6 "Drafts and staged files"). The LOCAL sibling of the R29 path, driven through the real
// `store/chat` + both composer stores (the `chatSlots`/`chatDeleted` harness):
//   · a NON-open conversation → ITS draft + rail are dropped (memory + storage) and nothing else's; the
//     view is untouched;
//   · the OPEN conversation → the home's next latest opens with the dead draft + rail carried (E6) — no
//     toast (the owner just did it);
//   · a 404 racing the move (the seen PATCH / a floor read on the dead id) neither toasts nor moves twice;
//   · S9b fix wave (Opus F1 ∪ Sol S9B-01): the COMMIT's facts are latched (`armConversationRemoval`) and the
//     success rules by them — an owner door during the round trip, a door still in flight at the 200, a
//     carry deferred behind a dictation stop, a stale latch from a failed attempt.

const h = vi.hoisted(() => ({ call: false, toasts: [] as string[] }));
vi.mock("../../src/store/liveCall", () => ({ callLive: () => h.call }));
vi.mock("../../src/store/toast", () => ({
  pushToast: (text: string) => h.toasts.push(text),
  useToasts: () => [],
}));

let byAgent: Record<string, string[]>;
let gone: Set<string>;
let agentReads: string[];
/** Agents whose `?agent=` read parks until the case releases it. */
let parkAgent: Map<string, () => void>;
/** Threads whose history read parks until the case releases it. */
let parkHistory: Map<string, () => void>;

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

function route(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? "GET";
  if (method === "PATCH") {
    const thread = decodeURIComponent(url.split("/")[3]);
    return Promise.resolve(gone.has(thread) ? json({ detail: "gone" }, 404) : json({}));
  }
  if (method === "POST" && url === "/api/threads") {
    const body = JSON.parse(String(init?.body)) as { agent: string };
    return Promise.resolve(
      json({ id: `new-${body.agent}`, title: null, agent: body.agent, archived: false }),
    );
  }
  if (url.startsWith("/api/threads?agent=")) {
    const agent = decodeURIComponent(url.slice("/api/threads?agent=".length).split("&")[0]);
    agentReads.push(agent);
    const answer = () =>
      json(
        (byAgent[agent] ?? [])
          .filter((id) => !gone.has(id))
          .slice(0, 1)
          .map((id) => ({ id, agent })),
      );
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

async function fresh() {
  vi.resetModules();
  const ui = await import("../../src/store/ui");
  ui.setUI({ tab: "agent" });
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
  return { chat, draft, att, view, flush, at, chips };
}
type F = Awaited<ReturnType<typeof fresh>>;

async function openId(f: F, id: string, home: string) {
  await act(async () => {
    await f.chat.openThread(id, home);
  });
  await f.flush();
  expect(f.at()).toBe(id);
}
const photo = (id: string): StagedAttachment => ({
  localId: `local-${id}`,
  name: `${id}.webp`,
  kind: "image",
  status: "staged",
  attachmentId: id,
});
function stored(key: "ctrlb.composer" | "ctrlb.attachments"): Record<string, unknown> {
  const blob = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<
    string,
    Record<string, unknown>
  >;
  return (key === "ctrlb.composer" ? blob.drafts : blob.rails) ?? {};
}

beforeEach(() => {
  localStorage.clear();
  h.call = false;
  h.toasts = [];
  byAgent = { lynette: ["L2", "L1"], emma: ["E1"] };
  gone = new Set();
  agentReads = [];
  parkAgent = new Map();
  parkHistory = new Map();
  vi.stubGlobal("fetch", vi.fn(route));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** L1 and E1 each hold a draft + a chip; L2 (Lynette's latest) is open with its own. */
async function threeDrafted(f: F) {
  await openId(f, "L1", "lynette");
  act(() => {
    f.draft.setDraft("in L1");
    f.att.addStaged(photo("p1"));
  });
  await openId(f, "E1", "emma");
  act(() => {
    f.draft.setDraft("in E1");
    f.att.addStaged(photo("e1"));
  });
  await openId(f, "L2", "lynette");
  act(() => {
    f.draft.setDraft("in L2");
    f.att.addStaged(photo("p2"));
  });
}

describe("conversationRemoved — a NON-open conversation deleted from the sheet", () => {
  it("drops ITS draft + rail (memory and storage) and nobody else's; the view stays", async () => {
    const f = await fresh();
    await threeDrafted(f);
    const before = f.view.result.current;
    gone.add("L1");
    act(() => f.chat.conversationRemoved("L1"));
    await f.flush();
    expect(f.at()).toBe("L2");
    expect(f.view.result.current.messages).toBe(before.messages); // no view state touched
    expect(f.draft.getDraft()).toBe("in L2");
    expect(f.chips()).toEqual(["p2:staged"]);
    expect(Object.keys(stored("ctrlb.composer")).sort()).toEqual(["E1", "L2"]);
    expect(Object.keys(stored("ctrlb.attachments")).sort()).toEqual(["E1", "L2"]);
    expect(h.toasts).toEqual([]);
    expect(agentReads).toEqual([]); // nothing navigated
    // the dropped conversation is really empty: re-opening its id (were it listed) shows nothing
    await openId(f, "E1", "emma");
    expect(f.draft.getDraft()).toBe("in E1");
    expect(f.chips()).toEqual(["e1:staged"]);
  });

  it("an id that is not the view touches no view state (thread, home, responder, messages)", async () => {
    const f = await fresh();
    await openId(f, "L2", "lynette");
    act(() => f.chat.setResponder("emma"));
    const before = f.view.result.current;
    act(() => f.chat.conversationRemoved("never-seen"));
    await f.flush();
    const after = f.view.result.current;
    expect(after.threadId).toBe("L2");
    expect(after.threadAgent).toBe("lynette");
    expect(after.responder).toBe("emma");
    expect(after.messages).toBe(before.messages);
  });
});

describe("conversationRemoved — the OPEN conversation (B8)", () => {
  it("opens the home's next latest and carries the draft + rail into it (E6), no toast", async () => {
    const f = await fresh();
    await threeDrafted(f);
    gone.add("L2"); // the DELETE answered: L1 is Lynette's latest now
    act(() => f.chat.conversationRemoved("L2"));
    await f.flush();
    expect(f.at()).toBe("L1");
    expect(f.view.result.current.threadAgent).toBe("lynette");
    expect(f.draft.getDraft()).toBe("in L1\n\nin L2"); // after its own, a blank line between
    expect(f.chips()).toEqual(["p1:staged", "p2:staged"]);
    expect(Object.keys(stored("ctrlb.composer")).sort()).toEqual(["E1", "L1"]);
    expect(h.toasts).toEqual([]);
  });

  it("the home's LAST conversation → a fresh greeted one, the draft carried into it", async () => {
    const f = await fresh();
    await openId(f, "E1", "emma");
    act(() => f.draft.setDraft("unsent"));
    gone.add("E1");
    act(() => f.chat.conversationRemoved("E1"));
    await f.flush();
    expect(f.at()).toBe("new-emma");
    expect(f.draft.getDraft()).toBe("unsent");
  });

  it("a 404 racing the move (the seen PATCH on the dead id) neither toasts nor moves twice", async () => {
    const f = await fresh();
    await openId(f, "L2", "lynette");
    act(() => f.draft.setDraft("in L2"));
    gone.add("L2");
    parkAgent.set("lynette", () => undefined); // the move's `?agent=` read is in flight
    act(() => f.chat.conversationRemoved("L2"));
    await act(async () => {
      await f.chat.markSeen(); // still on L2 → its PATCH answers 404
    });
    act(() => f.chat.conversationRemoved("L2")); // a duplicate success, too: once
    expect(h.toasts).toEqual([]);
    expect(agentReads).toEqual(["lynette"]); // ONE move
    act(() => parkAgent.get("lynette")!());
    await f.flush();
    expect(f.at()).toBe("L1");
    expect(f.draft.getDraft()).toBe("in L2");
  });
});

describe("the commit-time latch (S9b fix wave — Opus F1 ∪ Sol S9B-01)", () => {
  /** L1 holds its own draft; L2 (open) holds a draft + a chip. */
  async function l2Drafted(f: F) {
    await openId(f, "L1", "lynette");
    act(() => f.draft.setDraft("in L1"));
    await openId(f, "L2", "lynette");
    act(() => {
      f.draft.setDraft("in L2");
      f.att.addStaged(photo("p2"));
    });
  }

  it("(a) the owner taps another row DURING the request → the dead draft + chip land in it, never pruned", async () => {
    const f = await fresh();
    await l2Drafted(f);
    act(() => f.chat.armConversationRemoval("L2")); // the commit: L2 is open
    await openId(f, "L1", "lynette"); // the owner's door, before the 200
    gone.add("L2");
    act(() => f.chat.conversationRemoved("L2")); // the 200
    await f.flush();
    expect(f.at()).toBe("L1");
    expect(f.draft.getDraft()).toBe("in L1\n\nin L2");
    expect(f.chips()).toEqual(["p2:staged"]);
    expect(Object.keys(stored("ctrlb.composer"))).toEqual(["L1"]);
    expect(agentReads).toEqual([]); // no fallback move of its own
  });

  it("(b) a door still READING history at the 200 wins — no `?agent=` move; its swap carries the slots", async () => {
    const f = await fresh();
    await l2Drafted(f);
    act(() => f.chat.armConversationRemoval("L2"));
    parkHistory.set("L1", () => undefined);
    let opened: Promise<boolean> = Promise.resolve(false);
    act(() => {
      opened = f.chat.openThread("L1", "lynette"); // in flight
    });
    gone.add("L2");
    act(() => f.chat.conversationRemoved("L2")); // the 200 lands first
    await f.flush();
    expect(f.at()).toBe("L2"); // the door has not swapped yet…
    expect(agentReads).toEqual([]); // …and nothing superseded it
    act(() => parkHistory.get("L1")!());
    await act(async () => {
      expect(await opened).toBe(true); // the owner's tap is the view
    });
    await f.flush();
    expect(f.at()).toBe("L1");
    expect(f.draft.getDraft()).toBe("in L1\n\nin L2");
    expect(f.chips()).toEqual(["p2:staged"]);
  });

  it("(c) Sol's race — a 404 moved the view with its carry DEFERRED behind a dictation stop; the 200 then lands", async () => {
    const f = await fresh();
    await l2Drafted(f);
    let finish: () => void = () => undefined;
    const stopped = new Promise<void>((r) => (finish = r));
    act(() => {
      f.draft.registerLiveDictation(() => stopped);
    });
    act(() => f.chat.armConversationRemoval("L2"));
    gone.add("L2");
    await act(async () => {
      await f.chat.reconcileChat(); // the history read 404s → R29: the toast, the move, the carry armed
    });
    await f.flush();
    expect(f.at()).toBe("L1"); // moved — the carry waits on the stop
    act(() => f.chat.conversationRemoved("L2")); // the DELETE's success, late
    await f.flush();
    act(() => finish());
    await f.flush();
    expect(f.draft.getDraft()).toBe("in L1\n\nin L2");
    expect(f.chips()).toEqual(["p2:staged"]);
    expect(Object.keys(stored("ctrlb.composer"))).toEqual(["L1"]);
  });

  it("(d) a NON-open row (latched as such) → exactly its slots dropped, after any pending carry", async () => {
    const f = await fresh();
    await l2Drafted(f);
    act(() => f.chat.armConversationRemoval("L1"));
    gone.add("L1");
    act(() => f.chat.conversationRemoved("L1"));
    await f.flush();
    expect(f.at()).toBe("L2");
    expect(f.draft.getDraft()).toBe("in L2");
    expect(Object.keys(stored("ctrlb.composer"))).toEqual(["L2"]);
    expect(f.chips()).toEqual(["p2:staged"]);
  });

  it("(e) a failed attempt (409) then a successful retry of the SAME id → the FRESH latch rules", async () => {
    const f = await fresh();
    await l2Drafted(f);
    act(() => f.chat.armConversationRemoval("L2")); // attempt 1, L2 open — answered 409: no success
    await openId(f, "L1", "lynette"); // the owner moved on
    act(() => f.chat.armConversationRemoval("L2")); // the retry, from L1's sheet: L2 is NOT open now
    gone.add("L2");
    act(() => f.chat.conversationRemoved("L2"));
    await f.flush();
    expect(f.at()).toBe("L1");
    expect(f.draft.getDraft()).toBe("in L1"); // nothing moved in: the stale "was open" did not rule
    expect(Object.keys(stored("ctrlb.composer"))).toEqual(["L1"]); // L2's slots dropped
  });
});

describe("the micro-wave (Sol S9B-05 · the same-id residual)", () => {
  async function l2Drafted(f: F) {
    await openId(f, "L1", "lynette");
    act(() => f.draft.setDraft("in L1"));
    await openId(f, "L2", "lynette");
    act(() => {
      f.draft.setDraft("in L2");
      f.att.addStaged(photo("p2"));
    });
  }
  function storedDraft(k: string): string | undefined {
    return (stored("ctrlb.composer") as Record<string, string>)[k];
  }

  it("⑧ an already-carried source KEEPS its forward: the late L2 writer follows the content to L1, never E1", async () => {
    const f = await fresh();
    await l2Drafted(f);
    let finish: () => void = () => undefined;
    const stopped = new Promise<void>((r) => (finish = r));
    act(() => {
      f.draft.registerLiveDictation(() => stopped);
    });
    act(() => f.chat.armConversationRemoval("L2"));
    gone.add("L2");
    await act(async () => {
      await f.chat.reconcileChat(); // R29 → L1, the carry deferred behind the stop
    });
    await f.flush();
    expect(f.at()).toBe("L1");
    act(() => f.chat.conversationRemoved("L2")); // the DELETE's success
    await openId(f, "E1", "emma"); // the owner moves on before the stop resolves
    act(() => finish());
    await f.flush();
    expect(storedDraft("L1")).toBe("in L1\n\nin L2"); // the content went to L1…
    act(() => f.draft.appendDraft("late final", " ", "L2")); // …and a late writer addressed to L2
    expect(storedDraft("L1")).toBe("in L1\n\nin L2 late final"); // follows it there
    expect(storedDraft("E1")).toBeUndefined(); // never into E1
  });

  it("⑩ a tap on the very row being deleted (same-id) does not read as a door: the home's next latest opens", async () => {
    const f = await fresh();
    await l2Drafted(f);
    act(() => f.chat.armConversationRemoval("L2"));
    await act(async () => {
      await f.chat.openThread("L2", "lynette"); // the re-tap, during the request
    });
    gone.add("L2");
    act(() => f.chat.conversationRemoved("L2")); // the 200
    await f.flush();
    expect(f.at()).toBe("L1");
    expect(f.draft.getDraft()).toBe("in L1\n\nin L2");
    expect(f.chips()).toEqual(["p2:staged"]);
  });

  it("⑩ the roster door's B5 in-place arm (the home's latest IS the view) does not either", async () => {
    const f = await fresh();
    await l2Drafted(f);
    act(() => f.chat.armConversationRemoval("L2"));
    await act(async () => {
      await f.chat.openAgentConversation("lynette"); // B5: L2 is her latest — no leave
    });
    expect(f.at()).toBe("L2");
    gone.add("L2");
    act(() => f.chat.conversationRemoved("L2"));
    await f.flush();
    expect(f.at()).toBe("L1");
    expect(f.draft.getDraft()).toBe("in L1\n\nin L2");
  });
});
