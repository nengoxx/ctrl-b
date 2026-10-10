import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "../../src/types";

// Phase 27 S10 — THE BOOT with a notification tap's `?thread=` (D84 §6 N1, §5 O2; the dead-page arm the
// worker opens as `/?tab=agent&thread=<id>`). Through the REAL `store/ui` boot (module scope: validate,
// strip, park) and the REAL `store/chat#initChat` against a routed `fetch`:
//   · the TARGET = the tapped conversation when it LISTS, else the stored one;
//   · the stored responder is KEPT only when the target IS the stored conversation (the device never
//     left — R45); a tap that opens ANOTHER conversation opens it with NO responder;
//   · a tapped id that does NOT list is not an R29 source (this device never held it): no toast, the
//     stored conversation / the newest opens exactly as with no tap;
//   · the param is gone from the URL either way.

const h = vi.hoisted(() => ({ toasts: [] as string[] }));
vi.mock("../../src/store/liveCall", () => ({ callLive: () => false }));
vi.mock("../../src/store/toast", () => ({
  pushToast: (text: string) => h.toasts.push(text),
  useToasts: () => [],
}));

const L2 = "a2".repeat(16); // Lynette's newest
const L1 = "a1".repeat(16); // Lynette's older
const E1 = "e1".repeat(16); // Emma's
const GONE = "dd".repeat(16); // a conversation deleted while this device was dead

type ThreadRow = { id: string; agent: string | null; archived?: boolean };
let threadList: ThreadRow[];
let calls: string[];
/** History reads that FAIL once: `"down"` → a transport failure (a rejected fetch), `404` → deleted. */
let historyFails: Map<string, "down" | 404>;

const msg = (id: string, thread: string, role: "user" | "assistant"): ChatMessage => ({
  id,
  thread_id: thread,
  role,
  parts: [{ type: "text", text: id }],
  actor: role === "user" ? "user" : "agent",
  ts: "2026-01-01T00:00:00Z",
  tokens: null,
  compacted: false,
});
const json = (v: unknown): Response =>
  ({ ok: true, status: 200, json: async () => v }) as unknown as Response;

function route(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  calls.push(`${init?.method ?? "GET"} ${url}`);
  return Promise.resolve().then(() => {
    if (url === "/api/threads?include_archived=true") return json(threadList);
    if (url.startsWith("/api/threads?agent=")) {
      const agent = decodeURIComponent(url.slice("/api/threads?agent=".length).split("&")[0]);
      return json(threadList.filter((t) => t.agent === agent).slice(0, 1));
    }
    if (url.startsWith("/api/threads/") && url.endsWith("/messages")) {
      const id = url.split("/")[3];
      const fail = historyFails.get(id);
      historyFails.delete(id);
      if (fail === "down") throw new Error("network down");
      if (fail === 404)
        return {
          ok: false,
          status: 404,
          json: async () => ({ detail: "gone" }),
        } as unknown as Response;
      return json([msg(`${id}-u`, id, "user"), msg(`${id}-a`, id, "assistant")]);
    }
    if (url.includes("/api/agent/turns/")) return json({ active: false });
    return json({});
  });
}

/** A cold page open at `url` with `stored` as this device's `ctrlb.chat`: a fresh module graph (the ui
 *  store's boot reads the URL at import), then the chat's boot. */
async function bootAt(url: string, stored: Record<string, unknown> | null) {
  if (stored) localStorage.setItem("ctrlb.chat", JSON.stringify({ overrides: {}, ...stored }));
  window.history.replaceState(null, "", url);
  vi.resetModules();
  const chat = await import("../../src/store/chat");
  const view = renderHook(() => chat.useChat());
  await act(async () => {
    await chat.initChat();
  });
  return { chat, view, state: () => view.result.current };
}

beforeEach(() => {
  localStorage.clear();
  h.toasts = [];
  calls = [];
  historyFails = new Map();
  threadList = [
    { id: L2, agent: "lynette" },
    { id: E1, agent: "emma" },
    { id: L1, agent: "lynette" },
  ];
  vi.stubGlobal("fetch", vi.fn(route));
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("the boot with a tapped `?thread=` (N1)", () => {
  it("EQUAL to the stored thread → it opens and the stored responder is KEPT (the device never left)", async () => {
    const f = await bootAt(`/?tab=agent&thread=${L2}`, {
      thread: L2,
      home: "lynette",
      responder: "emma",
    });
    expect(f.state()).toMatchObject({ threadId: L2, threadAgent: "lynette", responder: "emma" });
    expect(window.location.search).toBe(""); // stripped
    expect(h.toasts).toEqual([]);
  });

  it("a DIFFERENT listed one → it opens, with its home and NO responder (the device left)", async () => {
    // The stored responder is NOT the tapped conversation's home (a responder equal to the home would be
    // normalised away anyway — §12.2 a — and could not tell the rule apart).
    const f = await bootAt(`/?tab=agent&thread=${L1}`, {
      thread: L2,
      home: "lynette",
      responder: "emma",
    });
    expect(f.state()).toMatchObject({ threadId: L1, threadAgent: "lynette", responder: null });
    expect(window.location.search).toBe("");
    expect(h.toasts).toEqual([]);
    // …and the rewritten tuple says so.
    expect(JSON.parse(localStorage.getItem("ctrlb.chat")!)).toMatchObject({
      thread: L1,
      home: "lynette",
      responder: null,
    });
  });

  it("an UNLISTED one → no toast; the STORED thread opens as with no tap (its responder kept)", async () => {
    const f = await bootAt(`/?tab=agent&thread=${GONE}`, {
      thread: E1,
      home: "emma",
      responder: "lynette",
    });
    expect(h.toasts).toEqual([]);
    expect(f.state()).toMatchObject({ threadId: E1, threadAgent: "emma", responder: "lynette" });
    expect(window.location.search).toBe("");
  });

  it("an UNLISTED one with no stored thread → no toast; the NEWEST opens with no responder", async () => {
    const f = await bootAt(`/?tab=agent&thread=${GONE}`, null);
    expect(h.toasts).toEqual([]);
    expect(f.state()).toMatchObject({ threadId: L2, responder: null });
  });

  it("an invalid `?thread=` is never read as a target — stripped, and the stored thread opens", async () => {
    const f = await bootAt("/?tab=agent&thread=not-a-thread", {
      thread: E1,
      home: "emma",
      responder: null,
    });
    expect(f.state()).toMatchObject({ threadId: E1 });
    expect(window.location.search).toBe("");
    expect(calls.some((c) => c.includes("not-a-thread"))).toBe(false);
  });

  it("the tap is read ONCE: a later boot (a reconnect's `reloadChat` on a thread-less view) never replays it", async () => {
    threadList = [{ id: L1, agent: "lynette" }];
    const f = await bootAt(`/?tab=agent&thread=${L1}`, null);
    expect(f.state().threadId).toBe(L1);
    // Back to thread-less, then the reconnect path re-runs the boot: the newest — not the spent tap.
    act(() => f.chat.resetToThreadless());
    threadList = [
      { id: L2, agent: "lynette" },
      { id: L1, agent: "lynette" },
    ];
    await act(async () => {
      await f.chat.reloadChat();
    });
    expect(f.state().threadId).toBe(L2);
  });
});

// ── the S10 fix wave (②, ③, ⑧) ──────────────────────────────────────────────────────────────────────

const draftOf = (id: string): string | undefined =>
  (
    JSON.parse(localStorage.getItem("ctrlb.composer") ?? "{}") as {
      drafts?: Record<string, string>;
    }
  ).drafts?.[id];

describe("the tap target across failures (S10 fix wave)", () => {
  it("② a TRANSIENT history failure keeps the tap: the retry opens the TAPPED conversation, no responder", async () => {
    historyFails.set(L1, "down");
    const f = await bootAt(`/?tab=agent&thread=${L1}`, {
      thread: L2,
      home: "lynette",
      responder: "emma",
    });
    expect(f.state().threadId).toBeNull(); // the first boot failed…
    await act(async () => {
      await f.chat.initChat(); // …the retry (a mount / the reconnect path)
    });
    expect(f.state()).toMatchObject({ threadId: L1, threadAgent: "lynette", responder: null });
    expect(h.toasts).toEqual([]);
  });

  it("…but a NEWER navigation supersedes it: a door used before the retry wins, the tap is dropped", async () => {
    historyFails.set(L1, "down");
    historyFails.set(E1, 404); // the door fails too (deleted — a toast, no note): the view stays empty
    const f = await bootAt(`/?tab=agent&thread=${L1}`, {
      thread: L2,
      home: "lynette",
      responder: null,
    });
    await act(async () => {
      await f.chat.openThread(E1, "emma");
    });
    await act(async () => {
      await f.chat.initChat();
    });
    expect(f.state().threadId).toBe(L2); // the stored conversation — never the superseded tap
    expect(h.toasts).toEqual(["this conversation was deleted"]); // the door's own 404, nothing else
  });

  it("③ a tapped conversation deleted between the list and its history → QUIET: no toast, the STORED one opens with its responder", async () => {
    historyFails.set(L1, 404);
    localStorage.setItem("ctrlb.composer", JSON.stringify({ drafts: { [L2]: "my L2 words" } }));
    const f = await bootAt(`/?tab=agent&thread=${L1}`, {
      thread: L2,
      home: "lynette",
      responder: "emma",
    });
    expect(h.toasts).toEqual([]);
    expect(f.state()).toMatchObject({ threadId: L2, responder: "emma" });
    expect(draftOf(L2)).toBe("my L2 words"); // nothing carried anywhere
  });

  it("③ …and with no stored conversation → the newest, quietly", async () => {
    historyFails.set(L1, 404);
    const f = await bootAt(`/?tab=agent&thread=${L1}`, null);
    expect(h.toasts).toEqual([]);
    expect(f.state()).toMatchObject({ threadId: L2, responder: null });
  });

  it("⑧ the STORED conversation was deleted while the device was dead: a tap on a listed one carries its draft in — no toast", async () => {
    localStorage.setItem(
      "ctrlb.composer",
      JSON.stringify({ drafts: { [GONE]: "unsent words", [L1]: "L1's own" } }),
    );
    const f = await bootAt(`/?tab=agent&thread=${L1}`, {
      thread: GONE,
      home: "emma",
      responder: null,
    });
    expect(h.toasts).toEqual([]);
    expect(f.state().threadId).toBe(L1);
    expect(draftOf(L1)).toBe("L1's own\n\nunsent words"); // E6: appended after its own draft
    expect(draftOf(GONE)).toBeUndefined();
  });
});
