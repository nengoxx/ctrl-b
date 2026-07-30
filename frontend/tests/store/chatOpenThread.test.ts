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

/** A `fetch` stub whose per-URL responses can be DEFERRED: `hold(url)` parks every request for EXACTLY
 *  that URL until `release(url)`, which is how a slow loader is made to land after a fast one. Exact
 *  matching, not substring: `/api/threads` (the list read) is a prefix of every by-id read, and holding
 *  those too would park the very fetch the race is supposed to let through. */
function deferrableFetch() {
  const pending = new Map<string, () => void>();
  const rejecters = new Map<string, (e: Error) => void>();
  const held = new Set<string>();
  const calls: string[] = [];
  const impl = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const payload: unknown = url.endsWith("/messages")
      ? [msg(`m-${url}`, url.split("/")[3], url)]
      : url.includes("/api/agent/turns/") // the D39 cold-load re-attach probe
        ? { active: false }
        : [{ id: "recent-thread" }];
    if (held.has(url)) {
      return new Promise<Response>((resolve, reject) => {
        pending.set(url, () => resolve(json(payload)));
        rejecters.set(url, reject);
      });
    }
    return Promise.resolve(json(payload));
  });
  return {
    impl,
    calls,
    hold: (url: string) => held.add(url),
    release: (url: string) => {
      pending.get(url)?.();
      pending.delete(url);
      rejecters.delete(url);
      held.delete(url);
    },
    /** Release a parked request as a FAILURE — the backend went away mid-load. */
    fail: (url: string) => {
      rejecters.get(url)?.(new Error("backend down"));
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
