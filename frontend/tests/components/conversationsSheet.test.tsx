import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { relativeTime } from "../../src/lib/relativeTime";
import type { StagedAttachment } from "../../src/store/attachments";
import type { ChatMessage, ThreadSummary } from "../../src/types";

// D84 §7 (Phase 27 S9b) — THE PER-HOME CONVERSATIONS SHEET, opened by the chat header's button, against
// the REAL chat + composer stores (a fresh module graph per case) and a fake server behind `fetch`:
//   · the row anatomy (label · `You: ` / `Name: ` preview · time · the §5 dot) and the open row marked;
//   · a row tap = `openThread(id, row.agent)` (the door contract, a string home) and the sheet closes;
//   · "New conversation" = `/new` for the HOME, with the O28 "already new" note; R36 (the HOME's rows);
//   · "Show older" after a FULL page, on the last row's cursor; gone after a short page;
//   · Rename (the prompt seeded with the title, `PATCH {title}` trimmed, `""` → null) and Delete (the
//     danger confirm → `DELETE` → `conversationRemoved`: a non-open row's slots dropped; the OPEN row →
//     the home's next latest with the draft + rail carried, B8/E6); a 409 / a failed rename → a TOAST,
//     the row stays; a 404 delete = done; in a call the open row's Delete → the hang-up note (M8);
//   · the sheet closes when the tab leaves the chat; the running dot's pulse sits in the motion gate.

const h = vi.hoisted(() => ({
  call: false,
  toasts: [] as [string, string | undefined][],
}));
vi.mock("../../src/store/liveCall", () => ({ callLive: () => h.call }));
vi.mock("../../src/store/toast", () => ({
  pushToast: (text: string, kind?: string) => h.toasts.push([text, kind]),
  useToasts: () => [],
}));

const T0 = "2026-10-10T09:00:00+00:00";
const summary = (id: string, over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id,
  title: null,
  agent: "lynette",
  created_at: T0,
  updated_at: T0,
  archived: false,
  label: null,
  preview: null,
  running: false,
  awaiting: false,
  unread: false,
  ...over,
});
const msg = (thread: string, id: string, role: "user" | "assistant"): ChatMessage => ({
  id,
  thread_id: thread,
  role,
  parts: [{ type: "text", text: `${id} text` }],
  actor: role === "user" ? "user" : "agent",
  ts: "2026-10-10T08:00:00+00:00",
  tokens: null,
  compacted: false,
});

/** The fake server: each agent's conversations, newest first, with their summary fields. */
let server: Record<string, ThreadSummary[]>;
let histories: Record<string, ChatMessage[]>;
/** Every non-GET request, as `METHOD url body`. */
let writes: { method: string; url: string; body: unknown }[];
/** Every `?agent=` LIST read (the sheet's / the dot's — `limit=50`), as its url. */
let listReads: string[];
let renameStatus: number;
let deleteStatus: number;

const json = (v: unknown, status = 200): Response =>
  ({
    ok: status < 400,
    status,
    statusText: "",
    json: async () => v,
    text: async () => JSON.stringify(v),
  }) as unknown as Response;
const AGENTS = {
  agents: ["lynette", "emma"],
  default: "lynette",
  summaries: {
    default: { title: "", avatar: "" },
    lynette: { title: "Lynette", avatar: "lynette.png" },
    emma: { title: "Emma", avatar: "" },
  },
};
const MEDIA = {
  ns: "agents",
  collation: "library-v1",
  slots: {},
  roles: {
    avatars: [
      {
        name: "lynette",
        file: "lynette.png",
        url: "/api/media/agents/files/avatars/lynette.png",
        format: "png",
        size_bytes: 100,
        revision: "r1",
        width: 64,
        height: 64,
        unusable: false,
        unusable_reason: null,
      },
    ],
    backgrounds: [],
  },
};

function route(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? "GET";
  const answer = (): Response => {
    if (method !== "GET") {
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
      writes.push({ method, url, body });
      if (method === "POST" && url === "/api/threads") {
        const agent = (body as { agent: string }).agent;
        const id = `new-${agent}`;
        server[agent] = [summary(id, { agent }), ...(server[agent] ?? [])];
        histories[id] = [msg(id, `${id}-g`, "assistant")];
        return json({ id, title: null, agent, archived: false });
      }
      const id = decodeURIComponent(url.split("/")[3]);
      if (method === "PATCH") {
        const patch = body as { title?: string | null };
        if (!("title" in patch)) return json({}); // the seen write
        if (renameStatus !== 200) return json({ detail: `unknown thread '${id}'` }, renameStatus);
        for (const rows of Object.values(server))
          for (const r of rows)
            if (r.id === id) {
              r.title = patch.title ?? null;
              r.label = patch.title ?? null;
            }
        return json({});
      }
      if (method === "DELETE") {
        if (deleteStatus === 409)
          return json({ detail: "a turn is running on this thread — wait for it" }, 409);
        for (const k of Object.keys(server)) server[k] = server[k].filter((r) => r.id !== id);
        return deleteStatus === 404
          ? json({ detail: `unknown thread '${id}'` }, 404)
          : json({ deleted: true });
      }
      return json({}, 404);
    }
    if (url === "/api/agents") return json(AGENTS);
    if (url.startsWith("/api/media/agents")) return json(MEDIA);
    if (url.startsWith("/api/threads?agent=")) {
      const params = new URLSearchParams(url.slice("/api/threads?".length));
      const rows = server[params.get("agent")!] ?? [];
      const limit = Number(params.get("limit"));
      if (limit === 1) return json(rows.slice(0, 1));
      listReads.push(url);
      const before = params.get("before");
      const from = before ? rows.findIndex((r) => r.id === before.split(",").at(-1)) + 1 : 0;
      return json(rows.slice(from, from + limit));
    }
    if (url.startsWith("/api/threads/") && url.endsWith("/messages"))
      return json(histories[url.split("/")[3]] ?? []);
    if (url.includes("/api/agent/turns/")) return json({ active: false });
    return json({}, 404);
  };
  return Promise.resolve().then(answer);
}

async function fresh() {
  vi.resetModules();
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const ui = await import("../../src/store/ui");
  ui.setUI({ tab: "agent" });
  const chat = await import("../../src/store/chat");
  const lc = await import("../../src/lib/composer");
  const draft = await import("../../src/store/composer");
  const att = await import("../../src/store/attachments");
  const prompt = await import("../../src/store/prompt");
  const confirm = await import("../../src/store/confirm");
  const { ChatHeaderActions } = await import("../../src/components/ChatHeaderActions");
  const { ConversationsSheet } = await import("../../src/components/ConversationsSheet");
  act(() => lc.installAgents(AGENTS, lc.beginAgentsLoad()));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <ChatHeaderActions />
      <ConversationsSheet />
    </QueryClientProvider>,
  );
  const chatView = renderHook(() => chat.useChat());
  const promptView = renderHook(() => prompt.usePrompt());
  const confirmView = renderHook(() => confirm.useConfirm());
  const c = view.container;
  const flush = () =>
    act(async () => {
      for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
    });
  const button = () => c.querySelector<HTMLButtonElement>("button.cvs-btn")!;
  const sheetOpen = () => button().getAttribute("aria-expanded") === "true";
  const rows = () => Array.from(c.querySelectorAll<HTMLElement>(".cvs-list > li:has(.cvs-more)"));
  const rowOf = (label: string) =>
    rows().find((li) => li.querySelector(".cvs-label")?.textContent === label)!;
  const ids = () => rows().map((li) => li.querySelector(".cvs-label")?.textContent);
  async function openSheet(n: number) {
    fireEvent.click(button());
    await waitFor(() => expect(rows()).toHaveLength(n));
  }
  async function openId(id: string, home: string) {
    await act(async () => {
      await chat.openThread(id, home);
    });
    await flush();
    expect(chatView.result.current.threadId).toBe(id);
  }
  const notes = () =>
    chatView.result.current.messages
      .filter((m) => m.role === "system")
      .map((m) => (m.parts[0] as { text: string }).text);
  return {
    qc,
    chat,
    ui,
    draft,
    att,
    prompt,
    confirm,
    c,
    flush,
    button,
    sheetOpen,
    rows,
    rowOf,
    ids,
    openSheet,
    openId,
    notes,
    chatView,
    promptView,
    confirmView,
  };
}
type F = Awaited<ReturnType<typeof fresh>>;

/** Disclose a row's actions and press one. */
function act_(f: F, label: string, action: "Rename" | "Delete") {
  fireEvent.click(f.rowOf(label).querySelector(".cvs-more")!);
  const btn = Array.from(f.rowOf(label).querySelectorAll<HTMLButtonElement>(".cvs-act")).find(
    (b) => b.textContent === action,
  )!;
  fireEvent.click(btn);
}
const photo = (id: string): StagedAttachment => ({
  localId: `local-${id}`,
  name: `${id}.webp`,
  kind: "image",
  status: "staged",
  attachmentId: id,
});

beforeEach(() => {
  localStorage.clear();
  h.call = false;
  h.toasts = [];
  server = {
    lynette: [
      summary("L3", {
        label: null,
        preview: { role: "user", agent: null, text: "hello there", ts: T0 },
      }),
      summary("L2", {
        title: "Trip plans",
        label: "Trip plans",
        preview: { role: "assistant", agent: "emma", text: "sure thing", ts: T0 },
        unread: true,
      }),
      summary("L1", {
        label: "Old chat",
        preview: { role: "assistant", agent: null, text: "my own words", ts: T0 },
        running: true,
        awaiting: true,
      }),
      summary("L0", {
        label: "Older",
        preview: { role: "assistant", agent: "lynette", text: "named home", ts: T0 },
        running: true,
        updated_at: "2026-10-01T09:00:00+00:00",
      }),
      summary("Lx", {
        label: "Ghostly",
        preview: { role: "assistant", agent: "ghost", text: "boo", ts: T0 },
      }),
    ],
    emma: [summary("E1", { agent: "emma", label: "Emma's" })],
  };
  histories = {
    L3: [msg("L3", "L3-u", "user"), msg("L3", "L3-a", "assistant")],
    L2: [msg("L2", "L2-u", "user"), msg("L2", "L2-a", "assistant")],
    L1: [msg("L1", "L1-a", "assistant")],
    L0: [msg("L0", "L0-a", "assistant")],
    Lx: [msg("Lx", "Lx-a", "assistant")],
    E1: [msg("E1", "E1-a", "assistant")],
  };
  writes = [];
  listReads = [];
  renameStatus = 200;
  deleteStatus = 200;
  vi.stubGlobal("fetch", vi.fn(route));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the sheet — head, rows, the open row", () => {
  it("the HOME's face + name; New conversation first; the rows newest first with their anatomy", async () => {
    const f = await fresh();
    await f.openId("L2", "lynette");
    await f.openSheet(5);
    await waitFor(() => expect(f.c.querySelector(".cvs-title")?.textContent).toBe("Lynette"));
    await waitFor(() => expect(f.c.querySelector(".cvs-head .cvs-face")).not.toBeNull());
    expect(f.c.querySelector(".cvs-list > li:first-child .cvs-new")?.textContent).toBe(
      "New conversation",
    );
    expect(f.ids()).toEqual(["New conversation", "Trip plans", "Old chat", "Older", "Ghostly"]);
    const preview = (label: string) =>
      f.rowOf(label).querySelector(".cvs-preview")?.textContent ?? null;
    expect(preview("New conversation")).toBe("You: hello there"); // the label fallback; the owner
    expect(preview("Trip plans")).toBe("Emma: sure thing"); // a NON-home speaker, by display name
    expect(preview("Old chat")).toBe("my own words"); // `agent` null = the home's own (L4)
    expect(preview("Older")).toBe("named home"); // the home, named: no prefix either
    expect(preview("Ghostly")).toBe("ghost: boo"); // a vanished agent → its slug
    expect(f.rowOf("Older").querySelector(".cvs-time")?.textContent).toBe(
      relativeTime("2026-10-01T09:00:00+00:00"),
    );
  });

  it("the row dots: needs-you over running over unread; none → no element; the OPEN row marked", async () => {
    const f = await fresh();
    await f.openId("L2", "lynette");
    await f.openSheet(5);
    const dot = (label: string) =>
      f.rowOf(label).querySelector<HTMLElement>(".cvs-dot")?.dataset.state ?? null;
    expect(dot("Old chat")).toBe("needs-you");
    expect(dot("Older")).toBe("running");
    expect(dot("Trip plans")).toBe("unread"); // the open one still shows its own row dot
    expect(dot("Ghostly")).toBeNull();
    expect(dot("New conversation")).toBeNull();
    const current = f.rows().filter((li) => li.querySelector('.cvs-row[aria-current="true"]'));
    expect(current.map((li) => li.querySelector(".cvs-label")?.textContent)).toEqual([
      "Trip plans",
    ]);
    expect(f.rowOf("Old chat").querySelector(".cvs-row")?.getAttribute("aria-description")).toBe(
      "needs you",
    );
  });

  it("the PEEK fold marks the third row (head + New + up to three)", async () => {
    const f = await fresh();
    await f.openId("L2", "lynette");
    await f.openSheet(5);
    const marked = Array.from(f.c.querySelectorAll(".cvs-list > li[data-bs-peek]"));
    expect(marked).toHaveLength(1);
    expect(marked[0].querySelector(".cvs-label")?.textContent).toBe("Old chat");
  });

  it("R36 — switched to Emma in Lynette's conversation, the sheet is LYNETTE's", async () => {
    const f = await fresh();
    await f.openId("L2", "lynette");
    act(() => f.chat.setResponder("emma"));
    await f.openSheet(5);
    await waitFor(() => expect(f.c.querySelector(".cvs-title")?.textContent).toBe("Lynette"));
    expect(listReads.every((u) => u.includes("agent=lynette"))).toBe(true);
  });
});

describe("the sheet — doors", () => {
  it("a row tap opens THAT conversation with its home (a string), and the sheet closes", async () => {
    const f = await fresh();
    await f.openId("L2", "lynette");
    act(() => f.chat.setResponder("emma"));
    await f.openSheet(5);
    fireEvent.click(f.rowOf("Old chat").querySelector(".cvs-row")!);
    expect(f.sheetOpen()).toBe(false);
    await f.flush();
    expect(f.chatView.result.current.threadId).toBe("L1");
    expect(f.chatView.result.current.threadAgent).toBe("lynette");
    expect(f.chatView.result.current.responder).toBeNull(); // leaving: the responder clears
  });

  it("New conversation → `/new` for the HOME once; the sheet closes", async () => {
    const f = await fresh();
    await f.openId("L2", "lynette"); // L2 has an owner turn
    act(() => f.chat.setResponder("emma"));
    await f.openSheet(5);
    fireEvent.click(f.c.querySelector(".cvs-new")!);
    expect(f.sheetOpen()).toBe(false);
    await f.flush();
    expect(writes.filter((w) => w.method === "POST")).toEqual([
      { method: "POST", url: "/api/threads", body: { agent: "lynette" } },
    ]);
    expect(f.chatView.result.current.threadId).toBe("new-lynette");
  });

  it("O28 — on a conversation with no owner turn: the 'already new' note, NO mint, the sheet closes", async () => {
    const f = await fresh();
    await f.openId("L1", "lynette"); // greeting-only
    await f.openSheet(5);
    fireEvent.click(f.c.querySelector(".cvs-new")!);
    expect(f.sheetOpen()).toBe(false);
    await f.flush();
    expect(writes.filter((w) => w.method === "POST")).toEqual([]);
    expect(f.notes()).toContain("// this conversation is already new");
    expect(f.chatView.result.current.threadId).toBe("L1");
  });

  it("leaving the chat tab closes the sheet", async () => {
    const f = await fresh();
    await f.openId("L2", "lynette");
    await f.openSheet(5);
    act(() => f.ui.setUI({ tab: "fleet" }));
    await waitFor(() => expect(f.sheetOpen()).toBe(false));
  });
});

describe("the sheet — Show older", () => {
  it("shown only after a FULL page; reads the last row's cursor; hidden after a short page", async () => {
    server.lynette = Array.from({ length: 53 }, (_, i) =>
      summary(`P${i}`, { label: `chat ${i}`, updated_at: T0 }),
    );
    const f = await fresh();
    await f.openId("P0", "lynette");
    await f.openSheet(50);
    const older = () => f.c.querySelector<HTMLButtonElement>(".cvs-older");
    expect(older()).not.toBeNull();
    fireEvent.click(older()!);
    await waitFor(() => expect(f.rows()).toHaveLength(53));
    expect(listReads.at(-1)).toBe(
      `/api/threads?agent=lynette&limit=50&before=${encodeURIComponent(`${T0},P49`)}`,
    );
    expect(older()).toBeNull();
  });

  it("Show older → close → after the exit, ONE page cached (the close path's trim, Opus F3)", async () => {
    server.lynette = Array.from({ length: 53 }, (_, i) =>
      summary(`P${i}`, { label: `chat ${i}`, updated_at: T0 }),
    );
    const f = await fresh();
    await f.openId("P0", "lynette");
    await f.openSheet(50);
    fireEvent.click(f.c.querySelector<HTMLButtonElement>(".cvs-older")!);
    await waitFor(() => expect(f.rows()).toHaveLength(53));
    const pages = () => f.qc.getQueryData<{ pages: unknown[] }>(["threads", "lynette"])?.pages;
    expect(pages()).toHaveLength(2);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(f.sheetOpen()).toBe(false);
    await waitFor(() => expect(f.c.querySelector(".cvs-sheet")).toBeNull(), { timeout: 2000 });
    await waitFor(() => expect(pages()).toHaveLength(1));
  });

  it("no button after a short first page", async () => {
    const f = await fresh();
    await f.openId("L2", "lynette");
    await f.openSheet(5);
    expect(f.c.querySelector(".cvs-older")).toBeNull();
  });
});

describe("the sheet — Rename", () => {
  it("the prompt is seeded with the TITLE; the PATCH carries the trimmed text; the list refetches", async () => {
    const f = await fresh();
    await f.openId("L3", "lynette");
    await f.openSheet(5);
    act_(f, "Trip plans", "Rename");
    await waitFor(() => expect(f.promptView.result.current).not.toBeNull());
    expect(f.promptView.result.current).toMatchObject({ kind: "text", value: "Trip plans" });
    const reads = listReads.length;
    act(() => f.prompt.resolvePrompt("  Summer trip  "));
    await waitFor(() => expect(f.rowOf("Summer trip")).toBeDefined());
    expect(writes.filter((w) => w.method === "PATCH" && "title" in (w.body as object))).toEqual([
      { method: "PATCH", url: "/api/threads/L2", body: { title: "Summer trip" } },
    ]);
    expect(listReads.length).toBeGreaterThan(reads);
  });

  it("an EMPTY rename sends null (back to the derived label); a cancelled one sends nothing", async () => {
    const f = await fresh();
    await f.openId("L3", "lynette");
    await f.openSheet(5);
    act_(f, "Trip plans", "Rename");
    await waitFor(() => expect(f.promptView.result.current).not.toBeNull());
    act(() => f.prompt.resolvePrompt(null)); // cancel
    await f.flush();
    act_(f, "Trip plans", "Rename");
    await waitFor(() => expect(f.promptView.result.current).not.toBeNull());
    act(() => f.prompt.resolvePrompt("   "));
    await f.flush();
    expect(writes.filter((w) => w.method === "PATCH" && "title" in (w.body as object))).toEqual([
      { method: "PATCH", url: "/api/threads/L2", body: { title: null } },
    ]);
  });

  it("a failed rename → an error TOAST; the row stays", async () => {
    renameStatus = 404;
    const f = await fresh();
    await f.openId("L3", "lynette");
    await f.openSheet(5);
    act_(f, "Trip plans", "Rename");
    await waitFor(() => expect(f.promptView.result.current).not.toBeNull());
    act(() => f.prompt.resolvePrompt("x"));
    await waitFor(() => expect(h.toasts).toEqual([["unknown thread 'L2'", "err"]]));
    expect(f.rowOf("Trip plans")).toBeDefined();
  });
});

describe("the sheet — Delete", () => {
  it("a NON-open row: the danger confirm → DELETE → the row gone, ITS slots dropped, nothing else's", async () => {
    const f = await fresh();
    await f.openId("L1", "lynette");
    act(() => {
      f.draft.setDraft("in L1");
      f.att.addStaged(photo("p1"));
    });
    await f.openId("L3", "lynette");
    act(() => f.draft.setDraft("in L3"));
    await f.openSheet(5);
    act_(f, "Old chat", "Delete");
    await waitFor(() => expect(f.confirmView.result.current).not.toBeNull());
    expect(f.confirmView.result.current).toMatchObject({ danger: true, confirmLabel: "Delete" });
    act(() => f.confirm.resolveConfirm(true));
    await waitFor(() => expect(f.rows()).toHaveLength(4));
    expect(writes.filter((w) => w.method === "DELETE")).toEqual([
      { method: "DELETE", url: "/api/threads/L1", body: undefined },
    ]);
    expect(f.chatView.result.current.threadId).toBe("L3"); // the view stays
    expect(f.draft.getDraft()).toBe("in L3");
    const drafts = (
      JSON.parse(localStorage.getItem("ctrlb.composer") ?? "{}") as {
        drafts: Record<string, string>;
      }
    ).drafts;
    expect(drafts).toEqual({ L3: "in L3" });
    expect(h.toasts).toEqual([]);
  });

  it("a cancelled confirm deletes nothing", async () => {
    const f = await fresh();
    await f.openId("L3", "lynette");
    await f.openSheet(5);
    act_(f, "Old chat", "Delete");
    await waitFor(() => expect(f.confirmView.result.current).not.toBeNull());
    act(() => f.confirm.resolveConfirm(false));
    await f.flush();
    expect(writes.filter((w) => w.method === "DELETE")).toEqual([]);
  });

  it("B8 — the OPEN row: DELETE → the home's next latest opens with the draft + rail CARRIED", async () => {
    const f = await fresh();
    await f.openId("L3", "lynette");
    act(() => {
      f.draft.setDraft("unsent words");
      f.att.addStaged(photo("p3"));
    });
    await f.openSheet(5);
    act_(f, "New conversation", "Delete"); // L3's label is null → "New conversation"
    await waitFor(() => expect(f.confirmView.result.current).not.toBeNull());
    act(() => f.confirm.resolveConfirm(true));
    await waitFor(() => expect(f.chatView.result.current.threadId).toBe("L2"));
    await f.flush();
    expect(f.draft.getDraft()).toBe("unsent words");
    expect(f.att.stagedFiles().map((s) => s.attachmentId)).toEqual(["p3"]);
    expect(h.toasts).toEqual([]); // no "deleted" toast: the owner just did it
  });

  it("409 (a turn running) → the server's sentence TOASTED, the row stays, nothing moved", async () => {
    deleteStatus = 409;
    const f = await fresh();
    await f.openId("L3", "lynette");
    act(() => f.draft.setDraft("keep me"));
    await f.openSheet(5);
    act_(f, "New conversation", "Delete");
    await waitFor(() => expect(f.confirmView.result.current).not.toBeNull());
    act(() => f.confirm.resolveConfirm(true));
    await waitFor(() =>
      expect(h.toasts).toEqual([["a turn is running on this thread — wait for it", "err"]]),
    );
    await f.flush();
    expect(f.rows()).toHaveLength(5);
    expect(f.chatView.result.current.threadId).toBe("L3");
    expect(f.draft.getDraft()).toBe("keep me");
  });

  it("404 (deleted elsewhere) → treated as removed: no error toast, the open view moves on", async () => {
    deleteStatus = 404;
    const f = await fresh();
    await f.openId("L3", "lynette");
    await f.openSheet(5);
    act_(f, "New conversation", "Delete");
    await waitFor(() => expect(f.confirmView.result.current).not.toBeNull());
    act(() => f.confirm.resolveConfirm(true));
    await waitFor(() => expect(f.chatView.result.current.threadId).toBe("L2"));
    expect(h.toasts).toEqual([]);
  });

  it("M8 — in a call, the OPEN row's Delete: the hang-up note, no confirm, no request; the sheet closes", async () => {
    const f = await fresh();
    await f.openId("L3", "lynette");
    await f.openSheet(5);
    h.call = true;
    act_(f, "New conversation", "Delete");
    await f.flush();
    expect(f.confirmView.result.current).toBeNull();
    expect(writes.filter((w) => w.method === "DELETE")).toEqual([]);
    expect(f.notes()).toContain("// hang up to switch conversations");
    expect(f.sheetOpen()).toBe(false);
  });

  it("M8 — a call that starts DURING the confirm refuses at the commit point too", async () => {
    const f = await fresh();
    await f.openId("L3", "lynette");
    await f.openSheet(5);
    act_(f, "New conversation", "Delete");
    await waitFor(() => expect(f.confirmView.result.current).not.toBeNull());
    h.call = true;
    act(() => f.confirm.resolveConfirm(true));
    await f.flush();
    expect(writes.filter((w) => w.method === "DELETE")).toEqual([]);
    expect(f.notes()).toContain("// hang up to switch conversations");
  });
});

describe("the CSS — the running dot's pulse sits inside the reduced-motion gate", () => {
  it("S9B-03 — every `all: unset` cvs control gets the keyboard ring back (the tools-row recipe)", () => {
    const kit = readFileSync(resolve(process.cwd(), "src/theme-engine/kit/kit.css"), "utf8");
    const rule =
      /((?:\.kit \.cvs-[a-z]+:focus-visible,?\s*)+)\{\s*outline: 2px solid var\(--accent\);\s*outline-offset: -2px;\s*\}/.exec(
        kit,
      );
    expect(rule).not.toBeNull();
    const ringed = new Set(rule![1].match(/\.cvs-[a-z]+/g));
    const unset = new Set(
      Array.from(kit.matchAll(/\.kit (\.cvs-[a-z]+) \{[^}]*all: unset;/g), ([, c]) => c),
    );
    expect(unset.size).toBeGreaterThan(0);
    expect([...unset].filter((c) => !ringed.has(c))).toEqual([]);
  });

  it("`body[data-motion=reduced] … .cvs-dot[data-state=running]` → animation: none", () => {
    const kit = readFileSync(resolve(process.cwd(), "src/theme-engine/kit/kit.css"), "utf8");
    const gate = /([^{}]*)\{\s*animation:\s*none;\s*\}/g;
    const gated = Array.from(kit.matchAll(gate)).some(([, sel]) =>
      sel.includes('body[data-motion="reduced"] .kit .cvs-dot[data-state="running"]'),
    );
    expect(gated).toBe(true);
    expect(kit).toMatch(/\.kit \.cvs-dot\[data-state="running"\] \{[^}]*kit-tag-pulse/);
  });

  it("the `cvs-` family is the kit's alone: no theme stylesheet other than kit.css names a `cvs-` class", () => {
    const root = resolve(process.cwd(), "src/themes");
    const sheets = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) =>
      f.endsWith(".css"),
    );
    expect(sheets.length).toBeGreaterThan(0);
    const offenders = sheets.filter((f) =>
      /\.cvs-(?!bs\b)[a-z]/.test(readFileSync(resolve(root, f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
