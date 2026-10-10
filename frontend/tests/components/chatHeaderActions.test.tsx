import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ThreadSummary } from "../../src/types";

// D84 §7 — the one chat-header action cluster every chat body (AgentTab, FrontierAgent, GachaAgent)
// renders: S9a's factor (the `.right` span, the privilege chip at its end) + S9b's CONVERSATIONS button —
// disabled while the view's home is UNKNOWN, opening the HOME's sheet (R36, whoever answers), its §5 dot
// = the strongest state among the home's OTHER conversations. Through the REAL chat store (a fresh module
// graph per case, so "the roster has not landed" is a real state) and a mocked `fetch`.

vi.mock("../../src/store/liveCall", () => ({ callLive: () => false }));

const summary = (id: string, over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id,
  title: null,
  agent: "lynette",
  created_at: "2026-10-01T00:00:00+00:00",
  updated_at: "2026-10-01T00:00:00+00:00",
  archived: false,
  label: null,
  preview: null,
  running: false,
  awaiting: false,
  unread: false,
  ...over,
});

/** The sheet's list per agent (`?agent=<name>&limit=50`). */
let lists: Record<string, ThreadSummary[]>;
/** Every `?agent=` list read, by agent. */
let listReads: string[];
const json = (v: unknown, status = 200): Response =>
  ({ ok: status < 400, status, json: async () => v }) as unknown as Response;

function route(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.startsWith("/api/threads?agent=")) {
    const agent = decodeURIComponent(url.slice("/api/threads?agent=".length).split("&")[0]);
    if (url.includes("&limit=50")) {
      listReads.push(agent);
      return Promise.resolve(json(lists[agent] ?? []));
    }
    return Promise.resolve(json((lists[agent] ?? []).slice(0, 1)));
  }
  if (url.startsWith("/api/threads/") && url.endsWith("/messages"))
    return Promise.resolve(json([]));
  if (url.includes("/api/agent/turns/")) return Promise.resolve(json({ active: false }));
  return Promise.resolve(json({}, 404));
}

async function fresh({ landed = true }: { landed?: boolean } = {}) {
  vi.resetModules();
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const chat = await import("../../src/store/chat");
  const lc = await import("../../src/lib/composer");
  const sheet = await import("../../src/store/conversationsSheet");
  const { ChatHeaderActions } = await import("../../src/components/ChatHeaderActions");
  const land = () =>
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
  if (landed) land();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <ChatHeaderActions />
    </QueryClientProvider>,
  );
  const button = () => view.container.querySelector<HTMLButtonElement>("button.cvs-btn")!;
  const dot = () => button().querySelector<HTMLElement>(".thread-dot");
  return { chat, sheet, view, button, dot, land };
}
type F = Awaited<ReturnType<typeof fresh>>;

async function openId(f: F, id: string, home: string) {
  await act(async () => {
    await f.chat.openThread(id, home);
  });
}

beforeEach(() => {
  localStorage.clear();
  lists = {
    lynette: [summary("L2"), summary("L1")],
    emma: [summary("E1", { agent: "emma", unread: true })],
  };
  listReads = [];
  vi.stubGlobal("fetch", vi.fn(route));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatHeaderActions — the cluster", () => {
  it("the `.right` span holds the conversations button, then the privilege chip at the end", async () => {
    const f = await fresh();
    const right = f.view.container.firstElementChild!;
    expect(right.tagName).toBe("SPAN");
    expect(right.className).toBe("right");
    expect(Array.from(right.children).map((c) => c.className)).toEqual([
      "cvs-btn",
      "priv-chip-wrap",
    ]);
    expect(right.querySelector(":scope > .priv-chip-wrap > .priv-chip")).not.toBeNull();
    const b = f.button();
    expect(b.getAttribute("aria-haspopup")).toBe("dialog");
    expect(b.querySelector("svg path")).not.toBeNull(); // the hand-inlined lucide glyph
  });
});

describe("ChatHeaderActions — the conversations button", () => {
  it("is DISABLED while the home is unknown (thread-less, the roster not landed) — and reads nothing", async () => {
    const f = await fresh({ landed: false });
    expect(f.button().disabled).toBe(true);
    fireEvent.click(f.button());
    expect(f.button().getAttribute("aria-expanded")).toBe("false");
    expect(listReads).toEqual([]);
    f.land(); // the roster lands → the home-to-be = the configured default
    await waitFor(() => expect(f.button().disabled).toBe(false));
    await waitFor(() => expect(listReads).toEqual(["lynette"]));
  });

  it("thread-less with the roster landed: enabled, opens the sheet (the default's, R36)", async () => {
    const f = await fresh();
    expect(f.button().disabled).toBe(false);
    fireEvent.click(f.button());
    expect(f.button().getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(listReads).toEqual(["lynette"]));
  });

  it("R36 — with a responder set, the dot's list (and the sheet) is the HOME's, never the responder's", async () => {
    const f = await fresh();
    await openId(f, "L2", "lynette");
    act(() => f.chat.setResponder("emma"));
    fireEvent.click(f.button());
    await waitFor(() => expect(listReads.length).toBeGreaterThan(0));
    expect(new Set(listReads)).toEqual(new Set(["lynette"]));
    expect(f.dot()).toBeNull(); // Emma's unread E1 is not the home's: no dot here
  });
});

describe("ChatHeaderActions — the §5 dot", () => {
  it("needs-you over running over unread, among the OTHER rows; the open view's own never lights it", async () => {
    lists.lynette = [
      summary("L3", { awaiting: true }), // the OPEN one: ignored
      summary("L2", { unread: true }),
      summary("L1", { running: true }),
    ];
    const f = await fresh();
    await openId(f, "L3", "lynette");
    await waitFor(() => expect(f.dot()?.dataset.state).toBe("running"));
    expect(f.button().getAttribute("aria-label")).toBe("Conversations — a reply is running");
  });

  it("needs-you wins", async () => {
    lists.lynette = [
      summary("L3"),
      summary("L2", { unread: true }),
      summary("L1", { awaiting: true, running: true }),
    ];
    const f = await fresh();
    await openId(f, "L3", "lynette");
    await waitFor(() => expect(f.dot()?.dataset.state).toBe("needs-you"));
    expect(f.button().getAttribute("aria-label")).toBe("Conversations — one needs you");
  });

  it("unread alone", async () => {
    lists.lynette = [summary("L3"), summary("L2", { unread: true })];
    const f = await fresh();
    await openId(f, "L3", "lynette");
    await waitFor(() => expect(f.dot()?.dataset.state).toBe("unread"));
    expect(f.button().getAttribute("aria-label")).toBe("Conversations — unread");
  });

  it("no state on another row → NO dot element, the plain name", async () => {
    lists.lynette = [summary("L3", { unread: true, running: true }), summary("L2")];
    const f = await fresh();
    await openId(f, "L3", "lynette");
    await waitFor(() => expect(listReads).toContain("lynette"));
    await act(async () => {});
    expect(f.dot()).toBeNull();
    expect(f.button().getAttribute("aria-label")).toBe("Conversations");
  });
});
