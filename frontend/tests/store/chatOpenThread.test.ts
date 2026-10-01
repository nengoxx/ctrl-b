import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "../../src/types";

// A3 slice 3 (post-14c review, HIGH) — the chat view's LOAD GENERATION.
//
// Three loaders can be in flight against one view: `initChat` (first Agent-tab mount), `reloadChat`
// (F16, on every SSE reconnect) and `openThread` (the automations run history). Each awaits a fetch and
// then writes `threadId`/`messages`/`loaded`, so without a generation the SLOWEST wins by landing last.
// These tests hold each fetch open deliberately and resolve them out of order — the only way to prove
// the guard, since in the happy path every ordering looks identical.
//
// They also pin the two shape fixes that came with it: a FAILED open leaves the current view intact
// (fetch-first, swap-second), and re-opening the thread you are already in still re-probes for a live
// turn instead of being a silent no-op.
//
// And `/new` (ISS-31): it MINTS through D70 §4.2 seam ① (`POST /api/threads {agent}`) and opens the
// minted thread through the same fetch-first swap — so it races the same loaders, under the same
// tickets and generations, and its tandem-rule cases live here too.

function msg(id: string, threadId: string, text: string): ChatMessage {
  return {
    id,
    thread_id: threadId,
    role: "assistant",
    parts: [{ type: "text", text }],
    actor: "agent",
    ts: new Date().toISOString(),
    tokens: null,
    compacted: false,
  };
}

function json(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as unknown as Response;
}

/** A message the OWNER authored — what makes a thread worth leaving for a fresh one (`/new`'s no-op rule). */
function userMsg(id: string, threadId: string, text: string): ChatMessage {
  return { ...msg(id, threadId, text), role: "user", actor: "user" };
}

/** What `GET /api/threads` answers — the LIST route, which since wave 1c is read by `openThread` too
 *  (for the opened thread's D11 `agent` pin). Mutable so an arm can pin a thread; the default is the one
 *  unpinned record every earlier test was written against. */
let threadList: { id: string; agent?: string | null }[] = [{ id: "recent-thread", agent: null }];

/** Per-thread history overrides for `GET /api/threads/{id}/messages`. Absent → the one generic
 *  assistant message every earlier test was written against (an agent-authored message: a thread holding
 *  only that is "fresh" to `/new`, so an arm that needs a thread worth leaving seeds a user turn here). */
let histories: Record<string, ChatMessage[]> = {};

/** What `POST /api/threads` (seam ①) answers — the minted `Thread` dump. The server persists the RESOLVED
 *  agent, so `mintAgent` can make it differ from what was asked; `undefined` → echo the requested agent. */
const MINT_ID = "fresh";
let mintAgent: string | null | undefined;

/** What the D39 re-attach probe (`GET /api/agent/turns/{id}`) reports as the still-QUEUED steers (D41) —
 *  `undefined` → the field is absent (every earlier test). `reconcileSteerQueue` renders it as queued
 *  user bubbles, and drops local ones the server no longer lists. */
let probeQueue: { entry_id: string; kind: string; text: string }[] | undefined;

/** ISS-49 — when set, `PUT /api/threads/{id}/opening` REFUSES with this status + `{detail}` sentence;
 *  `null` → it re-seats (the new pin, a one-row greeting `greet-<agent>`). */
let reopenRefusal: { status: number; detail: string } | null = null;

/** A `fetch` stub whose per-URL responses can be DEFERRED: `hold(url)` parks every request for EXACTLY
 *  that URL (a POST is keyed `POST <url>`) until `release(url)`, which is how a slow loader is made to
 *  land after a fast one. Exact
 *  matching, not substring: `/api/threads` (the list read) is a prefix of every by-id read, and holding
 *  those too would park the very fetch the race is supposed to let through.
 *
 *  The parked requests are a QUEUE per URL, not one slot (wave 1c): `openThread` now reads the LIST too
 *  (for the thread's D11 pin), so two loaders can be parked on `/api/threads` at once — with a single
 *  slot the second registration silently orphaned the first, and the loader under test never resolved. */
function deferrableFetch() {
  const pending = new Map<string, (() => void)[]>();
  const rejecters = new Map<string, ((e: Error) => void)[]>();
  const held = new Set<string>();
  const calls: string[] = [];
  /** Every `POST /api/threads` body, parsed (`null` = a bodyless POST) — what `/new` minted with. */
  const mints: ({ agent?: string } | null)[] = [];
  /** Every `PUT /api/threads/{id}/opening` (ISS-49's re-seat), with its parsed body. */
  const reopens: { url: string; body: { agent: string; discard_edited: boolean } }[] = [];
  const impl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    // A write is keyed `<METHOD> <url>` — `/api/threads` is BOTH the list read and the mint, and an arm
    // must be able to park one without the other.
    const url = String(input);
    const method = init?.method ?? "GET";
    const key = method === "GET" ? url : `${method} ${url}`;
    calls.push(key);
    let payload: unknown;
    if (method === "PUT" && url.endsWith("/opening")) {
      // ISS-49's re-seat: the server re-pins and seeds the new agent's greeting — or refuses.
      const body = JSON.parse(String(init?.body)) as { agent: string; discard_edited: boolean };
      reopens.push({ url, body });
      const id = url.split("/")[3];
      if (reopenRefusal) {
        const { status, detail } = reopenRefusal;
        return Promise.resolve({
          ok: false,
          status,
          json: async () => ({ detail }),
        } as unknown as Response);
      }
      histories[id] = [msg(`greet-${body.agent}`, id, `${body.agent} says hello`)];
      threadList = threadList.map((t) => (t.id === id ? { ...t, agent: body.agent } : t));
      payload = {
        thread: {
          id,
          title: null,
          agent: body.agent,
          created_at: "",
          updated_at: "",
          archived: false,
        },
        messages: histories[id],
      };
    } else if (method !== "GET" && url.includes("/messages/")) {
      // A D81 sync route (edit/delete/swap): it answers with the thread's floor.
      payload = { messages: histories[url.split("/")[3]] ?? [] };
    } else if (key === "POST /api/threads") {
      const body = init?.body ? (JSON.parse(String(init.body)) as { agent?: string }) : null;
      mints.push(body);
      payload = {
        id: MINT_ID,
        title: null,
        agent: mintAgent !== undefined ? mintAgent : (body?.agent ?? null),
        created_at: "",
        updated_at: "",
        archived: false,
      };
    } else if (url.endsWith("/messages")) {
      const id = url.split("/")[3];
      payload = histories[id] ?? [msg(`m-${url}`, id, url)];
    } else if (url.includes("/api/agent/turns/")) {
      // the D39 cold-load re-attach probe
      payload = { active: false, ...(probeQueue ? { steer_queue: probeQueue } : {}) };
    } else if (url.includes("/api/exec")) {
      payload = { threadId: "minted" }; // a `!cmd` on an empty view MINTS a thread (a wire thread write)
    } else payload = threadList;
    if (held.has(key)) {
      return new Promise<Response>((resolve, reject) => {
        (pending.get(key) ?? pending.set(key, []).get(key)!).push(() => resolve(json(payload)));
        (rejecters.get(key) ?? rejecters.set(key, []).get(key)!).push(reject);
      });
    }
    return Promise.resolve(json(payload));
  });
  return {
    impl,
    calls,
    mints,
    reopens,
    hold: (url: string) => held.add(url),
    release: (url: string) => {
      for (const resolve of pending.get(url) ?? []) resolve();
      pending.delete(url);
      rejecters.delete(url);
      held.delete(url);
    },
    /** Release every parked request for a URL as a FAILURE — the backend went away mid-load. */
    fail: (url: string) => {
      for (const reject of rejecters.get(url) ?? []) reject(new Error("backend down"));
      pending.delete(url);
      rejecters.delete(url);
      held.delete(url);
    },
  };
}

let net: ReturnType<typeof deferrableFetch>;

/** A FRESH copy of the store per test. `loaded` and `loadGen` are module-level by design (they are the
 *  app-owned cross-generation state under test), so re-importing is the only honest way to start each
 *  race from the same place — resetting the view alone would leave `loaded` from the previous test. */
async function freshChat() {
  vi.resetModules();
  return await import("../../src/store/chat");
}

beforeEach(() => {
  localStorage.clear(); // the sticky pick is persisted (D75 amendment) and every `freshChat` hydrates it
  threadList = [{ id: "recent-thread", agent: null }];
  histories = {};
  mintAgent = undefined;
  probeQueue = undefined;
  reopenRefusal = null;
  net = deferrableFetch();
  vi.stubGlobal("fetch", net.impl);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("openThread vs the reconciling loaders", () => {
  it("a slow initChat cannot overwrite the thread the owner just opened", async () => {
    const { initChat, openThread, useChat } = await freshChat();
    net.hold("/api/threads"); // the LIST read initChat starts with — parked (exact: not the by-id reads)
    const init = initChat();
    const { result } = renderHook(() => useChat());

    expect(await openThread("run-thread")).toBe(true);
    await waitFor(() => expect(result.current.threadId).toBe("run-thread"));

    net.release("/api/threads"); // …and only now does the cold load come back
    await init;
    expect(result.current.threadId).toBe("run-thread"); // the explicit open still owns the view
  });

  it("an in-flight reloadChat cannot write the OLD thread's messages under the NEW threadId", async () => {
    const { openThread, reloadChat, useChat } = await freshChat();
    await openThread("first");
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.threadId).toBe("first"));

    net.hold("/api/threads/first/messages");
    const reload = reloadChat(); // reads `first`… and is parked mid-fetch
    expect(await openThread("second")).toBe(true);
    await waitFor(() => expect(result.current.threadId).toBe("second"));

    net.release("/api/threads/first/messages");
    await reload;
    expect(result.current.threadId).toBe("second");
    // The discarded write is the point: `second`'s log must not contain `first`'s messages.
    for (const m of result.current.messages) expect(m.thread_id).not.toBe("first");
  });

  it("a stale initChat's FAILURE does not un-latch `loaded` behind a deliberate open", async () => {
    const { initChat, openThread, resetToThreadless, useChat } = await freshChat();
    net.hold("/api/threads");
    const init = initChat(); // …parked mid-fetch
    const { result } = renderHook(() => useChat());

    expect(await openThread("run-thread")).toBe(true);
    await waitFor(() => expect(result.current.threadId).toBe("run-thread"));

    net.fail("/api/threads"); // the cold load finally errors — AFTER the open won
    await init;

    // `loaded` is not observable directly, so read it through the behaviour it gates: drop the view to
    // thread-less (`/new`'s fallback) and mount again. A stale reset would make this load the
    // most-recent thread, i.e. undo the fresh view the owner just asked for.
    resetToThreadless(null);
    await initChat();
    expect(result.current.threadId).toBeNull();
  });
});

describe("two explicit opens — intent order, not completion order (R2 verify, M5)", () => {
  it("of two rapid opens, the LATER tap wins even when the earlier fetch resolves last", async () => {
    const { openThread, useChat } = await freshChat();
    net.hold("/api/threads/slow-a/messages");
    const openA = openThread("slow-a"); // …parked mid-fetch
    const { result } = renderHook(() => useChat());

    expect(await openThread("fast-b")).toBe(true);
    await waitFor(() => expect(result.current.threadId).toBe("fast-b"));

    net.release("/api/threads/slow-a/messages"); // A's fetch finally lands — AFTER the B tap
    expect(await openA).toBe(false); // superseded: A must report not-opened, not swap in
    expect(result.current.threadId).toBe("fast-b");
  });

  it("re-opening the CURRENT thread supersedes a pending open of another", async () => {
    const { openThread, useChat } = await freshChat();
    await openThread("home");
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.threadId).toBe("home"));

    net.hold("/api/threads/other/messages");
    const openOther = openThread("other"); // …parked
    expect(await openThread("home")).toBe(true); // the owner's newest decision: stay here

    net.release("/api/threads/other/messages");
    expect(await openOther).toBe(false);
    expect(result.current.threadId).toBe("home");
  });

  it("a superseded open failing LATE stays silent — no stray note in the winning view (R3 L2)", async () => {
    const { openThread, useChat } = await freshChat();
    const { result } = renderHook(() => useChat());
    net.hold("/api/threads/doomed/messages");
    const openDoomed = openThread("doomed"); // …parked

    expect(await openThread("winner")).toBe(true);
    await waitFor(() => expect(result.current.threadId).toBe("winner"));

    net.fail("/api/threads/doomed/messages"); // the superseded fetch errors AFTER the winner swapped in
    expect(await openDoomed).toBe(false);
    // The failure belongs to an intent the owner has already replaced — it must not speak.
    expect(result.current.messages.some((m) => m.role === "system")).toBe(false);
  });

  it("a /new supersedes a pending open — its fetch must not swap in afterwards", async () => {
    const { openThread, startNewThread, useChat } = await freshChat();
    const { result } = renderHook(() => useChat());
    net.hold("/api/threads/late/messages");
    const openLate = openThread("late"); // …parked

    await startNewThread({ keepAgent: false, defaultAgent: "default" }); // the owner's newer intent
    expect(result.current.threadId).toBe("fresh");
    net.release("/api/threads/late/messages");
    expect(await openLate).toBe(false);
    expect(result.current.threadId).toBe("fresh"); // the minted view stands
  });

  it("…and a NEWER open supersedes a /new still minting — its thread stays behind, unopened", async () => {
    const { openThread, startNewThread, useChat } = await freshChat();
    const { result } = renderHook(() => useChat());
    net.hold("POST /api/threads"); // the mint, parked
    const mint = startNewThread({ keepAgent: false, defaultAgent: "default" });

    expect(await openThread("later")).toBe(true); // the owner opens a run thread meanwhile
    net.release("POST /api/threads");
    await mint;
    expect(result.current.threadId).toBe("later");
    expect(result.current.messages.some((m) => m.role === "system")).toBe(false); // superseded = silent
  });
});

describe("openThread's own contract", () => {
  it("a failed open leaves the current view intact (fetch first, swap second)", async () => {
    const { openThread, useChat } = await freshChat();
    await openThread("good");
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.threadId).toBe("good"));
    const before = result.current.messages;

    net.impl.mockImplementationOnce(() => Promise.reject(new Error("unreachable")));
    expect(await openThread("bad")).toBe(false);

    expect(result.current.threadId).toBe("good"); // NOT an emptied view the owner never asked to lose
    expect(result.current.messages.filter((m) => m.role !== "system")).toEqual(before);
  });

  it("a NON-OK history answer is a failed open too — its `{detail}` body never becomes the log", async () => {
    const { openThread, useChat } = await freshChat();
    await openThread("good");
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.threadId).toBe("good"));
    const before = result.current.messages;

    net.impl.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({ detail: "unknown thread" }),
      } as unknown as Response),
    );
    expect(await openThread("gone")).toBe(false);
    expect(result.current.threadId).toBe("good");
    expect(result.current.messages.filter((m) => m.role !== "system")).toEqual(before);
  });

  it("re-opening the thread you are already in still re-probes for a live turn", async () => {
    const { openThread } = await freshChat();
    await openThread("rolling");
    const probesBefore = net.calls.filter((u) => u.includes("rolling")).length;

    expect(await openThread("rolling")).toBe(true);
    // A rolling automation's thread can have gone live since it was last looked at, so the no-op path
    // must still ask — it just must not re-fetch history or churn the per-thread caches.
    await waitFor(() =>
      expect(net.calls.filter((u) => u.includes("rolling")).length).toBeGreaterThan(probesBefore),
    );
    expect(net.calls.filter((u) => u.endsWith("/api/threads/rolling/messages"))).toHaveLength(1);
  });
});

// ── the thread's own pinned agent (wave 1c) ───────────────────────────────────────────────────────────
// The server routes a turn by `agent_name or thread.agent` (D11), and the FE had no notion of the second
// rung: booting into — or opening — a thread pinned to a character replied as that character while every
// "which agent is active" surface showed the default (owner glance 2026-09-08). `threadAgent` is that
// field, and it is written wherever `threadId` is, because the two describe one conversation.
describe("the open thread's pinned agent", () => {
  it("the COLD load carries the most-recent thread's pin — no second read for it", async () => {
    threadList = [{ id: "recent-thread", agent: "lynette" }];
    const { initChat, useChat } = await freshChat();
    const { result } = renderHook(() => useChat());
    await initChat();
    await waitFor(() => expect(result.current.threadId).toBe("recent-thread"));
    expect(result.current.threadAgent).toBe("lynette");
    // `initChat` already holds the RECORD it picked, so the pin costs it nothing extra.
    expect(net.calls.filter((u) => u.endsWith("/api/threads"))).toHaveLength(1);
  });

  it("an explicit open learns the pin from the list — and never WAITS on it", async () => {
    threadList = [{ id: "run-thread", agent: "ops" }];
    const { openThread, useChat } = await freshChat();
    const { result } = renderHook(() => useChat());
    net.hold("/api/threads"); // the pin read, parked: the list can be slow, or a cold load can own it
    expect(await openThread("run-thread")).toBe(true); // …the history still swapped in
    expect(result.current.threadId).toBe("run-thread");
    expect(result.current.threadAgent).toBeNull(); // honest: not known yet, never the LEFT thread's pin
    net.release("/api/threads");
    await waitFor(() => expect(result.current.threadAgent).toBe("ops")); // …and it lands late
  });

  it("a same-thread RE-OPEN does not orphan the pin still in flight", async () => {
    // The audit's finding on wave 1c: `openThread` claims an open TICKET unconditionally at entry —
    // before the same-id early return — and that early return starts no pin read of its own. Guarding
    // the late write on the ticket therefore discarded the only pin fetch that would ever run, and a
    // pinned thread stayed unpinned in the view until the next real navigation. Re-tapping the thread
    // you are already in is an ordinary gesture (the automations panel's own "open thread" row).
    threadList = [{ id: "rolling", agent: "lynette" }];
    const { openThread, useChat } = await freshChat();
    const { result } = renderHook(() => useChat());
    net.hold("/api/threads"); // the pin read, parked
    expect(await openThread("rolling")).toBe(true);
    await waitFor(() => expect(result.current.threadId).toBe("rolling"));
    expect(await openThread("rolling")).toBe(true); // …the early-return path, claiming a newer ticket
    net.release("/api/threads");
    await waitFor(() => expect(result.current.threadAgent).toBe("lynette"));
  });

  it("a pin that arrives after the owner has moved on is DISCARDED", async () => {
    threadList = [
      { id: "slow", agent: "lynette" },
      { id: "fast", agent: null },
    ];
    const { openThread, useChat } = await freshChat();
    const { result } = renderHook(() => useChat());
    net.hold("/api/threads");
    const slow = openThread("slow"); // its pin read is parked…
    await waitFor(() => expect(result.current.threadId).toBe("slow"));
    net.release("/api/threads"); // …released only after the view has moved
    expect(await openThread("fast")).toBe(true);
    await slow;
    await waitFor(() => expect(result.current.threadId).toBe("fast"));
    expect(result.current.threadAgent).toBeNull(); // `slow`'s pin must not paint `fast`
  });

  it("a /new carries the MINTED thread's pin — never the left thread's", async () => {
    threadList = [{ id: "pinned", agent: "lynette" }];
    histories = { pinned: [userMsg("u1", "pinned", "hi")] };
    const { openThread, startNewThread, useChat } = await freshChat();
    const { result } = renderHook(() => useChat());
    await openThread("pinned");
    await waitFor(() => expect(result.current.threadAgent).toBe("lynette"));
    await startNewThread({ keepAgent: false, defaultAgent: "default" });
    expect(result.current.threadId).toBe("fresh");
    expect(result.current.threadAgent).toBe("default"); // seam ① pins the thread to the agent it opens as
  });
});

// ── the view's identity vs the loaders parked against the OLD one (the 1c review's F3) ────────────────
// `loadGen` is what makes a reconciliation discard itself when the view has moved on, and only
// `openThread` used to bump it — so a `/new` and a wire MINT changed the view's identity while a cold
// `initChat` (or a `reloadChat`) sat parked mid-fetch, and that load then landed the OLD thread's history
// AND its pin on the conversation the owner had just started.
describe("a changed view identity invalidates the loads parked against the old one", () => {
  // D75 amendment — `/new` with `keepAgent` (no default configured) keeps "the agent I was talking to":
  // in a character thread nothing was sticky, so the THREAD's pin is promoted to the sticky pick.
  it("a /new with keepAgent PROMOTES the thread's pin when nothing is sticky", async () => {
    threadList = [{ id: "pinned", agent: "lynette" }];
    histories = { pinned: [userMsg("u1", "pinned", "hi")] };
    const { openThread, startNewThread, useChat } = await freshChat();
    const { result } = renderHook(() => useChat());
    await openThread("pinned");
    await waitFor(() => expect(result.current.threadAgent).toBe("lynette"));
    expect(result.current.stickyAgent).toBeNull();
    await startNewThread({ keepAgent: true, defaultAgent: "default" });
    expect(net.mints).toEqual([{ agent: "lynette" }]); // minted WITH the promoted agent (ISS-31)…
    expect(result.current.threadId).toBe("fresh");
    expect(result.current.threadAgent).toBe("lynette"); // …so the fresh thread is pinned to her…
    expect(result.current.stickyAgent).toBe("lynette"); // …and the pick carries the agent over
    expect(JSON.parse(localStorage.getItem("ctrlb.chat")!)).toEqual({ agent: "lynette" });
  });

  it("a /new kills a parked cold load — history and pin alike", async () => {
    threadList = [{ id: "recent-thread", agent: "lynette" }];
    histories = { fresh: [] }; // the root greets nobody: the minted thread opens empty
    const { initChat, startNewThread, useChat } = await freshChat();
    const { result } = renderHook(() => useChat());
    net.hold("/api/threads/recent-thread/messages"); // the cold load's HISTORY fetch, parked
    const init = initChat();
    await startNewThread({ keepAgent: false, defaultAgent: "default" }); // the owner's /new meanwhile
    net.release("/api/threads/recent-thread/messages");
    await init;
    expect(result.current.threadId).toBe("fresh");
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.threadAgent).toBe("default"); // never `recent-thread`'s lynette pin
  });

  it("a MINTED thread kills one too — the send that created it owns the view now", async () => {
    threadList = [{ id: "recent-thread", agent: "lynette" }];
    const { initChat, runShell, useChat } = await freshChat();
    const { result } = renderHook(() => useChat());
    net.hold("/api/threads/recent-thread/messages");
    const init = initChat();
    await runShell("ls"); // `/api/exec` answers with a NEW thread id — a wire thread write
    await waitFor(() => expect(result.current.threadId).toBe("minted"));
    net.release("/api/threads/recent-thread/messages");
    await init;
    expect(result.current.threadId).toBe("minted");
    expect(result.current.threadAgent).toBeNull(); // …and never `recent-thread`'s pin
  });
});

// ── `/new` mints through seam ① (ISS-31, owner ruling 2026-09-27) ─────────────────────────────────────
// Two symptoms, one root: `/new` only nulled `threadId` in memory, so a reload came back to the LAST
// thread, and a character's greeting — a real message seeded WITH the thread — only appeared after the
// owner spoke first. `/new` now mints the thread (`POST /api/threads {agent}`), then opens it through the
// same fetch-first swap `openThread` uses; the tandem rule (D75 amendment) decides WHICH agent.
describe("`/new` mints the thread through seam ① (ISS-31)", () => {
  /** Open a thread the owner has already TALKED in, so `/new` has a reason to leave it. */
  async function talkedIn(
    chat: Awaited<ReturnType<typeof freshChat>>,
    id = "old",
    agent: string | null = null,
  ) {
    threadList = [{ id, agent }];
    histories[id] = [userMsg("u1", id, "hi"), msg("a1", id, "hello")];
    await chat.openThread(id);
  }

  it("a default SET → minted once WITH the default, greeting in view, the pick cleared (persisted)", async () => {
    histories = { fresh: [msg("greet", "fresh", "*Lynette looks up from her tea.*")] };
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    await talkedIn(chat);
    chat.setStickyAgent("ops"); // the owner had picked a specialist…
    await chat.startNewThread({ keepAgent: false, defaultAgent: "lynette" }); // …but a default is set

    expect(net.mints).toEqual([{ agent: "lynette" }]);
    expect(result.current.threadId).toBe("fresh");
    expect(result.current.messages.map((m) => m.id)).toEqual(["greet"]); // the server's history, as-is
    expect(result.current.threadAgent).toBe("lynette");
    expect(result.current.stickyAgent).toBeNull(); // the tandem rule's clear…
    expect(JSON.parse(localStorage.getItem("ctrlb.chat")!)).toEqual({ agent: null }); // …persisted
    expect(result.current.status).toBe("idle");
  });

  it("NO default + a sticky pick → minted WITH the pick, and the pick is kept (persisted)", async () => {
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    await talkedIn(chat, "old", "lynette"); // the pick outranks the thread's own pin
    chat.setStickyAgent("ops");
    await chat.startNewThread({ keepAgent: true, defaultAgent: "default" });

    expect(net.mints).toEqual([{ agent: "ops" }]);
    expect(result.current.threadAgent).toBe("ops");
    expect(result.current.stickyAgent).toBe("ops");
    expect(JSON.parse(localStorage.getItem("ctrlb.chat")!)).toEqual({ agent: "ops" });
  });

  it("the server's RESOLVED name is the pin — a since-deleted pick lands where the session would run", async () => {
    mintAgent = "default"; // seam ① persists `resolve_agent(name).name`: an unknown name → the root
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    await talkedIn(chat);
    chat.setStickyAgent("ghost");
    await chat.startNewThread({ keepAgent: true, defaultAgent: "default" });

    expect(net.mints).toEqual([{ agent: "ghost" }]);
    expect(result.current.threadAgent).toBe("default");
    expect(result.current.stickyAgent).toBe("ghost"); // the pick itself is not rewritten (D75: typos stay sticky)
  });

  it("no resolvable agent → a BODYLESS mint: unpinned, no greeting", async () => {
    histories = { fresh: [] };
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    await talkedIn(chat); // an unpinned thread, nothing sticky, no default set: nobody to keep
    await chat.startNewThread({ keepAgent: true, defaultAgent: "default" });

    expect(net.mints).toEqual([null]);
    expect(result.current.threadId).toBe("fresh");
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.threadAgent).toBeNull();
  });

  it("a thread-less view mints (there is nothing to keep, and nothing fresh to stay on)", async () => {
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    expect(result.current.threadId).toBeNull();
    await chat.startNewThread({ keepAgent: false, defaultAgent: "lynette" });
    expect(net.mints).toEqual([{ agent: "lynette" }]);
    expect(result.current.threadId).toBe("fresh");
  });

  it("a thread with NO user turn, pinned to the agent `/new` would mint, is already fresh — a silent no-op", async () => {
    threadList = [
      { id: "greeted", agent: "lynette" },
      { id: "empty", agent: null },
    ];
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    await chat.openThread("greeted"); // the generic history: ONE agent-authored message (a greeting)
    await waitFor(() => expect(result.current.threadAgent).toBe("lynette"));
    const before = result.current;
    await chat.startNewThread({ keepAgent: false, defaultAgent: "lynette" });
    expect(net.mints).toHaveLength(0);
    expect(result.current).toBe(before); // not a single write — no note, no swap

    histories = { empty: [] };
    await chat.openThread("empty"); // the root greets nobody: a minted thread can hold zero messages
    // none set, nothing sticky → the agent to keep is the thread's own (none) — the pin it already has
    await chat.startNewThread({ keepAgent: true, defaultAgent: "default" });
    expect(net.mints).toHaveLength(0);
    expect(result.current.threadId).toBe("empty");
  });

  // Fix wave 2 (O-LOW, confirm round): "fresh" is only fresh for the agent it is pinned to.
  it("…but a fresh thread pinned to ANOTHER agent is not the thread asked for — `/new` mints", async () => {
    threadList = [{ id: "sera", agent: "seraphina" }];
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    await chat.openThread("sera"); // Seraphina's greeting thread, nothing said yet
    await waitFor(() => expect(result.current.threadAgent).toBe("seraphina"));
    chat.setStickyAgent("ops"); // `/agent ops`…
    await chat.startNewThread({ keepAgent: true, defaultAgent: "default" }); // …then `/new`, none set
    expect(net.mints).toEqual([{ agent: "ops" }]);
    expect(result.current.threadId).toBe("fresh");
    expect(result.current.threadAgent).toBe("ops");
  });

  it("…and so does one pinned to the OLD default after the configured default changed", async () => {
    threadList = [{ id: "maya-fresh", agent: "maya" }];
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    await chat.openThread("maya-fresh");
    await waitFor(() => expect(result.current.threadAgent).toBe("maya"));
    await chat.startNewThread({ keepAgent: false, defaultAgent: "lynette" }); // the default is lynette now
    expect(net.mints).toEqual([{ agent: "lynette" }]);
    expect(result.current.threadAgent).toBe("lynette");
  });

  it("…yet the tandem rule still applies to the PICK there: a default set clears it, none set keeps it", async () => {
    // Fix wave 1 (O-LOW-4): before ISS-31 every `/new` cleared a standing pick when a default was set,
    // so `/agent ops` then `/new` on a fresh default thread must still mean "back to the default".
    threadList = [{ id: "greeted", agent: "lynette" }];
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    await chat.openThread("greeted"); // lynette's greeting-only thread: `/new` for lynette mints nothing
    await waitFor(() => expect(result.current.threadAgent).toBe("lynette"));
    chat.setStickyAgent("lynette"); // (Talk) — none set: the pick IS the pin, so it is kept
    await chat.startNewThread({ keepAgent: true, defaultAgent: "default" });
    expect(result.current.stickyAgent).toBe("lynette");
    chat.setStickyAgent("ops"); // `/agent ops`, then `/new` with lynette the configured default
    await chat.startNewThread({ keepAgent: false, defaultAgent: "lynette" }); // a default set → clear
    expect(net.mints).toHaveLength(0);
    expect(result.current.threadId).toBe("greeted");
    expect(result.current.stickyAgent).toBeNull();
    expect(JSON.parse(localStorage.getItem("ctrlb.chat")!)).toEqual({ agent: null });
  });

  it("…while a command the owner RAN (`!cmd`, persisted as actor=user rows) is a turn worth leaving", async () => {
    histories = {
      shell: [{ ...msg("x1", "shell", "ls"), actor: "user" }], // the exec pair's assistant row
    };
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    await chat.openThread("shell");
    await chat.startNewThread({ keepAgent: false, defaultAgent: "lynette" });
    expect(net.mints).toHaveLength(1);
    expect(result.current.threadId).toBe("fresh");
  });

  it("`/new` twice mints ONCE — the second lands on the fresh thread, and a double Enter mid-mint is one POST", async () => {
    const chat = await freshChat();
    await talkedIn(chat);
    net.hold("POST /api/threads");
    const first = chat.startNewThread({ keepAgent: false, defaultAgent: "lynette" });
    const second = chat.startNewThread({ keepAgent: false, defaultAgent: "lynette" }); // the double Enter
    net.release("POST /api/threads");
    await Promise.all([first, second]);
    expect(net.mints).toHaveLength(1);

    await chat.startNewThread({ keepAgent: false, defaultAgent: "lynette" }); // on the greeting-only thread
    expect(net.mints).toHaveLength(1);
  });

  it("a FAILED mint falls back to the thread-less view + a note — and never touches the view before", async () => {
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    await talkedIn(chat);
    chat.setStickyAgent("ops");
    await waitFor(() => expect(result.current.stickyAgent).toBe("ops")); // rendered before the snapshot
    const inFlight = result.current;
    net.hold("POST /api/threads");
    const mint = chat.startNewThread({ keepAgent: false, defaultAgent: "lynette" });
    await Promise.resolve(); // let the request go out…
    expect(result.current).toBe(inFlight); // …and the view the owner is looking at is untouched
    expect(result.current.threadId).toBe("old");

    net.fail("POST /api/threads");
    await mint;
    expect(result.current.threadId).toBeNull(); // the lazy mint on the next send (seam ②)
    expect(result.current.threadAgent).toBeNull();
    expect(result.current.stickyAgent).toBeNull(); // the tandem rule still applies to the fallback
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe("system");
    expect(result.current.messages[0].parts).toEqual([
      { type: "text", text: "// couldn't start a new thread — your next message will start one" },
    ]);
  });

  it("a non-OK mint (a 5xx) is a failure too — never a swap onto a thread that does not exist", async () => {
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    await talkedIn(chat);
    net.impl.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as unknown as Response),
    );
    await chat.startNewThread({ keepAgent: false, defaultAgent: "lynette" });
    expect(result.current.threadId).toBeNull();
    expect(result.current.messages.map((m) => m.role)).toEqual(["system"]);
  });

  it("a mint whose HISTORY read answers non-OK falls back too — a `{detail}` body is never the log", async () => {
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    await talkedIn(chat);
    const base = net.impl.getMockImplementation()!;
    net.impl.mockImplementation((input, init) =>
      String(input) === "/api/threads/fresh/messages"
        ? Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({ detail: "boom" }),
          } as unknown as Response)
        : base(input, init),
    );
    await chat.startNewThread({ keepAgent: false, defaultAgent: "lynette" });
    expect(net.mints).toHaveLength(1); // the thread WAS minted (it stays in the list, unopened)…
    expect(result.current.threadId).toBeNull(); // …but the view falls back, it does not swap garbage in
    expect(result.current.messages.map((m) => m.role)).toEqual(["system"]);
  });

  // Fix wave 1 (the code round's HIGH): the owner can keep using the view while the mint is in flight.
  // A send that starts AND settles meanwhile leaves the status idle, so a streaming check alone let the
  // swap hide the turn they had just taken. The fence compares the view's identity instead — silently.
  it("a send that COMPLETES mid-mint keeps the view — no swap, the turn stays, no note", async () => {
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    await talkedIn(chat);
    const base = net.impl.getMockImplementation()!;
    net.impl.mockImplementation((input, init) => {
      if (String(input) !== "/api/agent/chat") return base(input, init);
      // The server took the turn (buffered, D17): its durable floor now carries it.
      histories.old = [...histories.old, userMsg("u2", "old", "again"), msg("a2", "old", "sure")];
      return Promise.resolve({
        ok: true,
        status: 200,
        body: {},
        headers: { get: () => "application/json" },
        json: async () => ({ threadId: "old", state: "completed" }),
      } as unknown as Response);
    });
    net.hold("POST /api/threads");
    const mint = chat.startNewThread({ keepAgent: false, defaultAgent: "lynette" });
    await chat.sendMessage("again"); // starts AND settles while the mint is parked
    expect(chat.getChatStatus()).toBe("idle");
    net.release("POST /api/threads");
    await mint;

    expect(net.mints).toHaveLength(1); // minted — and left behind, unopened
    expect(result.current.threadId).toBe("old");
    expect(result.current.messages.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(result.current.messages.some((m) => m.role === "system")).toBe(false);
  });

  // Fix wave 2 (O-LOW, confirm round): a QUEUED steer bubble comes and goes on the server's schedule —
  // a probe or a reconnect reload can drop it mid-mint without the owner doing anything.
  it("a QUEUED steer bubble dropped mid-mint is not a turn taken — the mint still opens", async () => {
    probeQueue = [{ entry_id: "e1", kind: "message", text: "later" }];
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    await talkedIn(chat); // …and its re-attach probe renders the still-queued steer
    await waitFor(() => expect(result.current.messages.some((m) => m.queued === "e1")).toBe(true));
    net.hold("POST /api/threads");
    const mint = chat.startNewThread({ keepAgent: false, defaultAgent: "lynette" });
    probeQueue = []; // it drained / was removed server-side…
    await chat.reconcileChat(); // …and a reconnect's reconcile drops the bubble while the mint is out
    expect(result.current.messages.some((m) => m.queued)).toBe(false);
    net.release("POST /api/threads");
    await mint;
    expect(result.current.threadId).toBe("fresh");
  });

  it("a send still STREAMING when the mint lands keeps the view too — silently", async () => {
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    await talkedIn(chat);
    const base = net.impl.getMockImplementation()!;
    net.impl.mockImplementation((input, init) =>
      String(input) === "/api/agent/chat"
        ? new Promise<Response>(() => {}) // the turn is still going
        : base(input, init),
    );
    net.hold("POST /api/threads");
    const mint = chat.startNewThread({ keepAgent: false, defaultAgent: "lynette" });
    void chat.sendMessage("again");
    expect(chat.getChatStatus()).toBe("streaming");
    net.release("POST /api/threads");
    await mint;

    await waitFor(() => expect(result.current.status).toBe("streaming"));
    expect(result.current.threadId).toBe("old");
    expect(result.current.messages.some((m) => m.role === "system")).toBe(false);
  });

  it("a pick the owner changes WHILE the mint is in flight is the newer intent and survives the swap", async () => {
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    await talkedIn(chat);
    net.hold("POST /api/threads");
    const mint = chat.startNewThread({ keepAgent: false, defaultAgent: "lynette" }); // would clear the pick…
    chat.setStickyAgent("ops"); // …but the owner picks ops before it lands
    net.release("POST /api/threads");
    await mint;
    expect(result.current.threadId).toBe("fresh");
    expect(result.current.stickyAgent).toBe("ops");
    expect(JSON.parse(localStorage.getItem("ctrlb.chat")!)).toEqual({ agent: "ops" });
  });
});

// ── ISS-49 — a pick on a FRESH thread re-seats its opening (pin + greeting) ───────────────────────────
// `/new` mints for the default (the tandem rule), so the owner's pick right after it must replace the
// thread's opening too — or the who-line keeps the old agent and the picked agent's model reads that
// greeting as its own turn. The store's `reseatOpening` runs the PUT through the D81 `syncMessageRoute`
// (same thread id: no view swap); the trigger is re-derived from LIVE state on every call.
describe("a pick on a fresh thread re-seats its opening (ISS-49)", () => {
  /** Open lynette's greeting-only thread (the generic history = ONE agent-authored message). */
  async function greeted(chat: Awaited<ReturnType<typeof freshChat>>, history?: ChatMessage[]) {
    threadList = [{ id: "greeted", agent: "lynette" }];
    if (history) histories.greeted = history;
    const hook = renderHook(() => chat.useChat());
    await chat.openThread("greeted");
    await waitFor(() => expect(hook.result.current.threadAgent).toBe("lynette"));
    return hook;
  }

  it("the trigger: a real name, a thread, no turn taken, a different pin", async () => {
    const chat = await freshChat();
    expect(chat.wouldReseat("emma")).toBe(false); // no thread in view
    await greeted(chat);
    expect(chat.wouldReseat("emma")).toBe(true);
    expect(chat.wouldReseat("lynette")).toBe(false); // the pin it already has
    expect(chat.wouldReseat("")).toBe(false); // a bare `/agent` clear never re-seats

    const talked = await freshChat();
    await greeted(talked, [msg("g", "greeted", "hi"), userMsg("u1", "greeted", "hello")]);
    expect(talked.wouldReseat("emma")).toBe(false); // the owner spoke

    const ran = await freshChat();
    await greeted(ran, [
      msg("g", "greeted", "hi"),
      { ...msg("x1", "greeted", "ls"), actor: "user" },
    ]);
    expect(ran.wouldReseat("emma")).toBe(false); // a `!cmd` the owner ran is a turn too
  });

  it("re-seats in place: the PUT, the new floor, the new pin — same thread, the pick untouched", async () => {
    const chat = await freshChat();
    const { result } = await greeted(chat);
    chat.setStickyAgent("emma");
    await chat.reseatOpening("emma");

    expect(net.reopens).toEqual([
      { url: "/api/threads/greeted/opening", body: { agent: "emma", discard_edited: false } },
    ]);
    expect(result.current.threadId).toBe("greeted");
    expect(result.current.messages.map((m) => m.id)).toEqual(["greet-emma"]);
    expect(result.current.threadAgent).toBe("emma");
    expect(result.current.stickyAgent).toBe("emma"); // KEPT after a re-seat
    expect(result.current.messages.some((m) => m.role === "system")).toBe(false);
  });

  it("an EDITED opening is never discarded silently — only with the caller's confirm", async () => {
    const chat = await freshChat();
    await greeted(chat, [
      { ...msg("g", "greeted", "tea, with honey?"), edited: "2026-10-01T10:00:00Z" },
    ]);
    expect(chat.openingEdited()).toBe(true);
    await chat.reseatOpening("emma");
    expect(net.reopens).toHaveLength(0);

    await chat.reseatOpening("emma", "elsewhere"); // a confirm given for ANOTHER thread is no confirm
    expect(net.reopens).toHaveLength(0);
    await chat.reseatOpening("emma", "greeted");
    expect(net.reopens.map((r) => r.body)).toEqual([{ agent: "emma", discard_edited: true }]);
  });

  it("the new pin lands even when a turn is streaming at landing; the floor waits for that turn", async () => {
    const chat = await freshChat();
    const { result } = await greeted(chat);
    const base = net.impl.getMockImplementation()!;
    net.impl.mockImplementation((input, init) =>
      String(input) === "/api/agent/chat"
        ? new Promise<Response>(() => {}) // the turn is still going
        : base(input, init),
    );
    net.hold("PUT /api/threads/greeted/opening");
    const reseat = chat.reseatOpening("emma");
    void chat.sendMessage("hello");
    expect(chat.getChatStatus()).toBe("streaming");
    net.release("PUT /api/threads/greeted/opening");
    await reseat;

    expect(result.current.threadAgent).toBe("emma"); // the server DID re-seat
    expect(result.current.messages.some((m) => m.id === "greet-emma")).toBe(false); // not installed
  });

  it("a refusal says the server's sentence and re-reads the floor", async () => {
    reopenRefusal = {
      status: 409,
      detail: "this conversation has started — the pick applies from the next reply",
    };
    const chat = await freshChat();
    const { result } = await greeted(chat);
    // Another device spoke meanwhile — the floor the refusal re-reads carries the turn.
    histories.greeted = [msg("g", "greeted", "hi"), userMsg("u9", "greeted", "from the phone")];
    await chat.reseatOpening("emma");

    expect(net.reopens).toHaveLength(1);
    expect(result.current.threadAgent).toBe("lynette");
    // The note is the server's sentence verbatim (an addendum to the pick note), and it survives the
    // re-read: `applyFloor` keeps client-only notes around the durable rows it installs.
    const notes = result.current.messages.filter((m) => m.role === "system");
    expect(notes.map((m) => (m.parts[0].type === "text" ? m.parts[0].text : ""))).toEqual([
      "// this conversation has started — the pick applies from the next reply",
    ]);
    expect(result.current.messages.filter((m) => !m.local).map((m) => m.id)).toEqual(["g", "u9"]);
    expect(chat.wouldReseat("emma")).toBe(false);
  });

  it("two rapid picks: the second waits for the first, then runs ONCE for the LATEST pick", async () => {
    const chat = await freshChat();
    const { result } = await greeted(chat);
    net.hold("PUT /api/threads/greeted/opening");
    chat.setStickyAgent("emma");
    const first = chat.reseatOpening("emma");
    chat.setStickyAgent("seraphina");
    await chat.reseatOpening("seraphina"); // a sync route is in flight → parked, no second PUT yet
    chat.setStickyAgent("frieren");
    await chat.reseatOpening("frieren"); // still parked — the latest pick is what runs
    expect(net.reopens).toHaveLength(1);
    net.release("PUT /api/threads/greeted/opening");
    await first;

    await waitFor(() => expect(result.current.threadAgent).toBe("frieren"));
    expect(net.reopens.map((r) => r.body.agent)).toEqual(["emma", "frieren"]);
    expect(result.current.messages.map((m) => m.id)).toEqual(["greet-frieren"]);
  });

  // Fix wave (Maya MED-1 ∥ Opus L1): a parked re-seat keeps its thread AND its confirmed discard.
  it("a CONFIRMED discard parked behind an in-flight D81 route survives and is sent", async () => {
    const edited = { ...msg("g", "greeted", "tea, with honey?"), edited: "2026-10-01T10:00:00Z" };
    const chat = await freshChat();
    await greeted(chat, [edited]);
    net.hold("PATCH /api/threads/greeted/messages/g");
    const edit = chat.editMessage("g", "tea, with lemon?");
    chat.setStickyAgent("emma");
    await chat.reseatOpening("emma", "greeted"); // parked behind the edit
    expect(net.reopens).toHaveLength(0);
    net.release("PATCH /api/threads/greeted/messages/g");
    await edit;

    await waitFor(() => expect(net.reopens).toHaveLength(1));
    expect(net.reopens[0].body).toEqual({ agent: "emma", discard_edited: true });
  });

  it("a re-seat parked, then the view moves to another thread → the other thread is NOT re-seated", async () => {
    const chat = await freshChat();
    const { result } = await greeted(chat);
    threadList = [...threadList, { id: "other", agent: "lynette" }]; // fresh too: re-seatable
    net.hold("PUT /api/threads/greeted/opening");
    chat.setStickyAgent("emma");
    const first = chat.reseatOpening("emma");
    chat.setStickyAgent("frieren");
    await chat.reseatOpening("frieren"); // parked for `greeted`
    await chat.openThread("other");
    await waitFor(() => expect(result.current.threadAgent).toBe("lynette"));
    net.release("PUT /api/threads/greeted/opening");
    await first;

    expect(net.reopens.map((r) => r.url)).toEqual(["/api/threads/greeted/opening"]);
    expect(result.current.threadId).toBe("other");
    expect(result.current.threadAgent).toBe("lynette");
  });

  // Fix wave (Maya MED-2): the confirm is bound to the thread it was asked about. The pick seam
  // snapshots the id before its dialog (`lib/composer` test); here the view moved while it was open.
  it("a confirm asked on one thread never discards an edited opening on the thread the view moved to", async () => {
    const chat = await freshChat();
    const { result } = await greeted(chat);
    const askedFor = chat.getThreadId(); // what `pinStickyAgent` snapshots before `requestConfirm`
    threadList = [...threadList, { id: "other", agent: "lynette" }];
    histories.other = [{ ...msg("o", "other", "my own words"), edited: "2026-10-01T10:00:00Z" }];
    await chat.openThread("other"); // the view moved while the dialog was open…
    await waitFor(() => expect(result.current.threadAgent).toBe("lynette"));
    chat.setStickyAgent("emma"); // …then Switch: the pin lands…
    await chat.reseatOpening("emma", askedFor); // …but the discard was for `greeted`

    expect(net.reopens).toHaveLength(0);
    expect(result.current.messages.map((m) => m.id)).toEqual(["o"]); // the edited opening stays
  });

  it("a pick made WHILE `/new` mints re-seats the minted thread to it", async () => {
    histories = { fresh: [msg("greet", "fresh", "*Lynette looks up from her tea.*")] };
    const chat = await freshChat();
    const { result } = renderHook(() => chat.useChat());
    net.hold("POST /api/threads");
    const mint = chat.startNewThread({ keepAgent: false, defaultAgent: "lynette" });
    chat.setStickyAgent("emma"); // the pick lands before the mint does
    net.release("POST /api/threads");
    await mint;

    await waitFor(() => expect(result.current.threadAgent).toBe("emma"));
    expect(net.mints).toEqual([{ agent: "lynette" }]);
    expect(net.reopens.map((r) => r.body)).toEqual([{ agent: "emma", discard_edited: false }]);
    expect(result.current.threadId).toBe("fresh");
    expect(result.current.messages.map((m) => m.id)).toEqual(["greet-emma"]);
  });

  it("…but an UNCHANGED pick the server resolved elsewhere (a since-deleted name) is not re-seated", async () => {
    mintAgent = "default";
    const chat = await freshChat();
    chat.setStickyAgent("ghost");
    await chat.startNewThread({ keepAgent: true, defaultAgent: "default" });
    expect(net.mints).toEqual([{ agent: "ghost" }]);
    expect(net.reopens).toHaveLength(0);
  });

  it("opening a thread never re-seats, whatever the standing pick", async () => {
    localStorage.setItem("ctrlb.chat", JSON.stringify({ agent: "emma" })); // a persisted pick
    const chat = await freshChat();
    await greeted(chat);
    expect(net.reopens).toHaveLength(0);
  });
});
