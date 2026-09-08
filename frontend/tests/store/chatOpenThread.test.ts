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

/** What `GET /api/threads` answers — the LIST route, which since wave 1c is read by `openThread` too
 *  (for the opened thread's D11 `agent` pin). Mutable so an arm can pin a thread; the default is the one
 *  unpinned record every earlier test was written against. */
let threadList: { id: string; agent?: string | null }[] = [{ id: "recent-thread", agent: null }];

/** A `fetch` stub whose per-URL responses can be DEFERRED: `hold(url)` parks every request for EXACTLY
 *  that URL until `release(url)`, which is how a slow loader is made to land after a fast one. Exact
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
  const impl = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const payload: unknown = url.endsWith("/messages")
      ? [msg(`m-${url}`, url.split("/")[3], url)]
      : url.includes("/api/agent/turns/") // the D39 cold-load re-attach probe
        ? { active: false }
        : url.includes("/api/exec")
          ? { threadId: "minted" } // a `!cmd` on an empty view MINTS a thread (a wire thread write)
          : threadList;
    if (held.has(url)) {
      return new Promise<Response>((resolve, reject) => {
        (pending.get(url) ?? pending.set(url, []).get(url)!).push(() => resolve(json(payload)));
        (rejecters.get(url) ?? rejecters.set(url, []).get(url)!).push(reject);
      });
    }
    return Promise.resolve(json(payload));
  });
  return {
    impl,
    calls,
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
  threadList = [{ id: "recent-thread", agent: null }];
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
    const { initChat, openThread, startNewThread, useChat } = await freshChat();
    net.hold("/api/threads");
    const init = initChat(); // …parked mid-fetch
    const { result } = renderHook(() => useChat());

    expect(await openThread("run-thread")).toBe(true);
    await waitFor(() => expect(result.current.threadId).toBe("run-thread"));

    net.fail("/api/threads"); // the cold load finally errors — AFTER the open won
    await init;

    // `loaded` is not observable directly, so read it through the behaviour it gates: clear the view
    // (which leaves `threadId` null) and mount again. A stale reset would make this load the
    // most-recent thread, i.e. undo a `/clear` the owner just performed.
    startNewThread();
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

  it("a /clear supersedes a pending open — its fetch must not swap in afterwards", async () => {
    const { openThread, startNewThread, useChat } = await freshChat();
    const { result } = renderHook(() => useChat());
    net.hold("/api/threads/late/messages");
    const openLate = openThread("late"); // …parked

    startNewThread(); // the owner clears while the open is in flight
    net.release("/api/threads/late/messages");
    expect(await openLate).toBe(false);
    expect(result.current.threadId).toBeNull(); // the cleared view stands
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

  it("a /clear resets the pin — a fresh thread is minted unpinned", async () => {
    threadList = [{ id: "pinned", agent: "lynette" }];
    const { openThread, startNewThread, useChat } = await freshChat();
    const { result } = renderHook(() => useChat());
    await openThread("pinned");
    await waitFor(() => expect(result.current.threadAgent).toBe("lynette"));
    startNewThread();
    await waitFor(() => expect(result.current.threadId).toBeNull());
    expect(result.current.threadAgent).toBeNull();
  });
});

// ── the view's identity vs the loaders parked against the OLD one (the 1c review's F3) ────────────────
// `loadGen` is what makes a reconciliation discard itself when the view has moved on, and only
// `openThread` used to bump it — so a `/clear` and a wire MINT changed the view's identity while a cold
// `initChat` (or a `reloadChat`) sat parked mid-fetch, and that load then landed the OLD thread's history
// AND its pin on the conversation the owner had just started.
describe("a changed view identity invalidates the loads parked against the old one", () => {
  it("a /clear kills a parked cold load — history and pin alike", async () => {
    threadList = [{ id: "recent-thread", agent: "lynette" }];
    const { initChat, startNewThread, useChat } = await freshChat();
    const { result } = renderHook(() => useChat());
    net.hold("/api/threads/recent-thread/messages"); // the cold load's HISTORY fetch, parked
    const init = initChat();
    startNewThread(); // the owner clears while it is in flight
    net.release("/api/threads/recent-thread/messages");
    await init;
    await waitFor(() => expect(result.current.threadId).toBeNull());
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.threadAgent).toBeNull(); // the pin rode with the history and must die with it
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
