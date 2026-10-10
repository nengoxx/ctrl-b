import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// D84 §6 "Query vs store" — the thread LIST is ordinary server state (`useQuery(['threads', agent])`,
// `hooks/useThreads`), and the ONE bridge (`useThreadListsBridge`, shell-mounted) joins the chat store to
// it: the store's "lists are stale" bus → `['threads']` + `['agents']` (S6's recorded obligation), and the
// seen write's return trigger (visibility / back to the chat tab → `returnToChat`).

const h = vi.hoisted(() => ({
  getJSON: vi.fn(),
  patchJSON: vi.fn(),
  del: vi.fn(),
  stale: new Set<() => void>(),
  returnToChat: vi.fn(async () => {}),
  removed: vi.fn(),
  toasts: [] as [string, string | undefined][],
}));
vi.mock("../../src/api/client", async (importActual) => ({
  ...(await importActual<typeof import("../../src/api/client")>()),
  getJSON: h.getJSON,
  patchJSON: h.patchJSON,
  del: h.del,
}));
vi.mock("../../src/store/chat", () => ({
  onThreadListsStale: (cb: () => void) => {
    h.stale.add(cb);
    return () => h.stale.delete(cb);
  },
  returnToChat: h.returnToChat,
  conversationRemoved: h.removed,
}));
vi.mock("../../src/store/toast", () => ({
  pushToast: (text: string, kind?: string) => h.toasts.push([text, kind]),
}));

import { ApiError } from "../../src/api/client";
import {
  THREADS_PAGE,
  beforeCursor,
  flattenThreads,
  headerDot,
  threadDot,
  threadsPath,
  trimThreads,
  useDeleteThread,
  useRenameThread,
  useThreadListsBridge,
  useThreads,
  type ThreadPages,
} from "../../src/hooks/useThreads";
import { setUI } from "../../src/store/ui";
import type { ThreadSummary } from "../../src/types";

/** One summary row; `i` orders `updated_at` (higher = newer). */
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
/** A FULL page of `n` rows (`THREADS_PAGE` by default), ids `<prefix>0…`. */
const page = (prefix: string, n = THREADS_PAGE): ThreadSummary[] =>
  Array.from({ length: n }, (_, i) =>
    summary(`${prefix}${i}`, { updated_at: `2026-10-0${prefix === "a" ? 9 : 8}T00:00:${i}+00:00` }),
  );

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: qc }, children);

let visibility: DocumentVisibilityState;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.stale.clear();
  h.getJSON.mockReset();
  h.patchJSON.mockReset();
  h.del.mockReset();
  h.removed.mockReset();
  h.toasts = [];
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  setUI({ tab: "fleet" });
});
afterEach(() => {
  cleanup(); // no globals → no auto-cleanup: a bridge left mounted would answer the next test's events
  qc.clear();
});

describe("useThreads — one agent's conversations, paged (§4, S9b's infinite query)", () => {
  it("is keyed ['threads', agent] and reads ?agent=<slug>&limit=50, encoded — {pages, pageParams}", async () => {
    h.getJSON.mockResolvedValue([{ id: "L2", agent: "lynette" }]);
    const { result } = renderHook(() => useThreads("lynette"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.getJSON).toHaveBeenCalledWith("/api/threads?agent=lynette&limit=50");
    expect(qc.getQueryData(["threads", "lynette"])).toEqual({
      pages: [[{ id: "L2", agent: "lynette" }]],
      pageParams: [undefined],
    });
    expect(threadsPath("a b/c")).toBe("/api/threads?agent=a%20b%2Fc&limit=50");
  });

  it("an off-roster slug answers the server's [] — an empty list, not an error (M7)", async () => {
    h.getJSON.mockResolvedValue([]);
    const { result } = renderHook(() => useThreads("ghost"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(flattenThreads(result.current.data)).toEqual([]);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("a FULL page has a next page, read with the LAST row's cursor; a short page is the end", async () => {
    const first = page("a");
    const second = page("b", 3);
    h.getJSON.mockImplementation((path: string) =>
      Promise.resolve(path.includes("before=") ? second : first),
    );
    const { result } = renderHook(() => useThreads("lynette"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(flattenThreads(result.current.data)).toHaveLength(THREADS_PAGE + 3));
    expect(h.getJSON).toHaveBeenLastCalledWith(
      threadsPath("lynette", { before: beforeCursor(first[THREADS_PAGE - 1]) }),
    );
    expect(flattenThreads(result.current.data).map((r) => r.id)).toEqual([
      ...first.map((r) => r.id),
      "b0",
      "b1",
      "b2",
    ]);
    expect(result.current.hasNextPage).toBe(false); // 3 < 50: the end
  });

  it("trimThreads cuts the cached list back to its FIRST page (the sheet's close path)", async () => {
    const d: ThreadPages = {
      pages: [page("a"), page("b", 2)],
      pageParams: [undefined, "c"],
    };
    qc.setQueryData(["threads", "lynette"], d);
    await trimThreads(qc, "lynette");
    expect(qc.getQueryData(["threads", "lynette"])).toEqual({
      pages: [d.pages[0]],
      pageParams: [undefined],
    });
    await trimThreads(qc, "nobody"); // nothing cached → nothing written
    expect(qc.getQueryData(["threads", "nobody"])).toBeUndefined();
  });

  it("a sheet showing the list again (`keep`) → the pages are left alone", async () => {
    const d: ThreadPages = { pages: [page("a"), page("b", 2)], pageParams: [undefined, "c"] };
    qc.setQueryData(["threads", "lynette"], d);
    await trimThreads(qc, "lynette", () => true);
    expect((qc.getQueryData(["threads", "lynette"]) as ThreadPages).pages).toHaveLength(2);
  });

  it("S9B-02 — a refetch IN FLIGHT at the trim cannot write its pages back: ONE page after it settles", async () => {
    const first = page("a");
    const second = page("b", 3);
    h.getJSON.mockImplementation((path: string) =>
      Promise.resolve(path.includes("before=") ? second : first),
    );
    const { result } = renderHook(() => useThreads("lynette"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    const cached = () => qc.getQueryData<ThreadPages>(["threads", "lynette"]);
    await waitFor(() => expect(cached()?.pages).toHaveLength(2));
    // a focus / invalidation refetch starts — and parks on the network
    const parked: (() => void)[] = [];
    h.getJSON.mockImplementation(
      (path: string) =>
        new Promise((resolve) =>
          parked.push(() => resolve(path.includes("before=") ? second : first)),
        ),
    );
    void qc.invalidateQueries({ queryKey: ["threads", "lynette"] });
    await waitFor(() => expect(parked).toHaveLength(1));
    // the sheet closes
    const before = h.getJSON.mock.calls.length;
    await act(async () => {
      await trimThreads(qc, "lynette");
    });
    // the network answers everything it was asked (the cancelled refetch's page included)
    for (let i = 0; i < 5; i++)
      await act(async () => {
        parked.splice(0).forEach((go) => go());
        await new Promise((r) => setTimeout(r, 0));
      });
    await waitFor(() => expect(qc.isFetching()).toBe(0));
    expect(cached()?.pages).toHaveLength(1);
    expect(flattenThreads(cached())).toHaveLength(THREADS_PAGE);
    // the cancelled refetch's rows were thrown away, so the list is re-read — at ONE page
    expect(h.getJSON.mock.calls.slice(before).map(([p]) => String(p))).toContain(
      "/api/threads?agent=lynette&limit=50",
    );
  });

  it("S9B-04 — IDLE at the close: trimmed synchronously, so an invalidation right after cannot restore pages", async () => {
    const first = page("a");
    const second = page("b", 3);
    h.getJSON.mockImplementation((path: string) =>
      Promise.resolve(path.includes("before=") ? second : first),
    );
    const { result } = renderHook(() => useThreads("lynette"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    const cached = () => qc.getQueryData<ThreadPages>(["threads", "lynette"]);
    await waitFor(() => expect(cached()?.pages).toHaveLength(2));
    expect(qc.isFetching()).toBe(0); // idle
    await act(async () => {
      const closing = trimThreads(qc, "lynette");
      // two microtasks: past the StrictMode hop — where the pre-fix code sat in its idle cancel's await
      await Promise.resolve();
      await Promise.resolve();
      void qc.invalidateQueries({ queryKey: ["threads", "lynette"] }); // lands right after the trim
      await closing;
    });
    await waitFor(() => expect(qc.isFetching()).toBe(0));
    expect(cached()?.pages).toHaveLength(1);
  });

  it("flattenThreads: every page in order; a malformed page contributes nothing", () => {
    expect(flattenThreads(undefined)).toEqual([]);
    const weird = { pages: [[summary("x")], {} as unknown as ThreadSummary[]], pageParams: [] };
    expect(flattenThreads(weird as ThreadPages).map((r) => r.id)).toEqual(["x"]);
  });

  it("`enabled: false` reads nothing (the sheet reads while open)", () => {
    renderHook(() => useThreads("lynette", { enabled: false }), { wrapper });
    expect(h.getJSON).not.toHaveBeenCalled();
  });

  it("the paging seam: the keyset cursor from the last row, encoded (the ISO's `+00:00`)", () => {
    const cursor = beforeCursor({ updated_at: "2026-10-09T10:00:00+00:00", id: "L1" });
    expect(cursor).toBe("2026-10-09T10:00:00+00:00,L1");
    expect(threadsPath("lynette", { before: cursor })).toBe(
      "/api/threads?agent=lynette&limit=50&before=2026-10-09T10%3A00%3A00%2B00%3A00%2CL1",
    );
  });
});

describe("the §5 dots — needs-you > running > unread", () => {
  it("threadDot: one state per row, by priority; none → null", () => {
    expect(threadDot({ awaiting: true, running: true, unread: true })).toBe("needs-you");
    expect(threadDot({ awaiting: false, running: true, unread: true })).toBe("running");
    expect(threadDot({ awaiting: false, running: false, unread: true })).toBe("unread");
    expect(threadDot({ awaiting: false, running: false, unread: false })).toBeNull();
  });

  it("headerDot: the strongest among the OTHER rows — the open view's own never lights it", () => {
    const rows = [
      summary("open", { awaiting: true }),
      summary("u", { unread: true }),
      summary("r", { running: true }),
    ];
    expect(headerDot(rows, "open")).toBe("running");
    expect(headerDot(rows, null)).toBe("needs-you");
    expect(
      headerDot([summary("open", { running: true }), summary("u", { unread: true })], "open"),
    ).toBe("unread");
    expect(headerDot([summary("open", { unread: true })], "open")).toBeNull();
    expect(headerDot([], null)).toBeNull();
  });
});

describe("useRenameThread / useDeleteThread — the Query-layer mutations (S9b)", () => {
  it("rename PATCHes {title}; the lists refetch on settle; a failure toasts as an error", async () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    h.patchJSON.mockResolvedValue({});
    const { result } = renderHook(() => useRenameThread(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "L 1", title: null });
    });
    expect(h.patchJSON).toHaveBeenCalledWith("/api/threads/L%201", { title: null });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["threads"] });
    spy.mockClear();
    h.patchJSON.mockRejectedValue(new ApiError("unknown thread 'L1'", 404));
    await act(async () => {
      await result.current.mutateAsync({ id: "L1", title: "x" }).catch(() => undefined);
    });
    expect(h.toasts).toEqual([["unknown thread 'L1'", "err"]]);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["threads"] }); // the stale row refreshes too
  });

  it("delete: success → conversationRemoved(id), the lists AND the roster refetch", async () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    h.del.mockResolvedValue({ deleted: true });
    const { result } = renderHook(() => useDeleteThread(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("L1");
    });
    expect(h.del).toHaveBeenCalledWith("/api/threads/L1");
    expect(h.removed).toHaveBeenCalledWith("L1");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["threads"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["agents"] });
    expect(h.toasts).toEqual([]);
  });

  it("delete: a 404 is DONE (gone either way) — removed, no error toast", async () => {
    h.del.mockRejectedValue(new ApiError("unknown thread 'L1'", 404));
    const { result } = renderHook(() => useDeleteThread(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("L1");
    });
    expect(h.removed).toHaveBeenCalledWith("L1");
    expect(h.toasts).toEqual([]);
  });

  it("delete: a 409 (a turn running) toasts the server's sentence; nothing removed; lists refetch", async () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    h.del.mockRejectedValue(new ApiError("a turn is running on this thread", 409));
    const { result } = renderHook(() => useDeleteThread(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("L1").catch(() => undefined);
    });
    expect(h.removed).not.toHaveBeenCalled();
    expect(h.toasts).toEqual([["a turn is running on this thread", "err"]]);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["threads"] });
  });
});

describe("useThreadListsBridge — the ONE bridge (S6's obligation)", () => {
  it("subscribes once; a stale publish invalidates ['threads'] (every agent) + ['agents']", () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    const view = renderHook(() => useThreadListsBridge(), { wrapper });
    expect(h.stale.size).toBe(1);
    act(() => {
      for (const cb of h.stale) cb();
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["threads"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["agents"] });
    view.unmount();
    expect(h.stale.size).toBe(0); // one mount, one teardown
  });

  it("back to the chat tab while visible → returnToChat; another tab, or hidden → nothing", () => {
    renderHook(() => useThreadListsBridge(), { wrapper });
    expect(h.returnToChat).not.toHaveBeenCalled(); // mounting is not a return
    act(() => setUI({ tab: "agent" }));
    expect(h.returnToChat).toHaveBeenCalledTimes(1);
    act(() => setUI({ tab: "fleet" }));
    visibility = "hidden";
    act(() => setUI({ tab: "agent" }));
    expect(h.returnToChat).toHaveBeenCalledTimes(1); // hidden: the visibility return will do it
  });

  it("becoming visible ON the chat tab → returnToChat; on another tab → nothing", () => {
    setUI({ tab: "agent" });
    renderHook(() => useThreadListsBridge(), { wrapper });
    visibility = "hidden";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(h.returnToChat).not.toHaveBeenCalled();
    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(h.returnToChat).toHaveBeenCalledTimes(1);
    act(() => setUI({ tab: "fleet" }));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(h.returnToChat).toHaveBeenCalledTimes(1);
  });

  it("the unmount removes the visibility listener (one mount, one teardown)", () => {
    setUI({ tab: "agent" });
    const view = renderHook(() => useThreadListsBridge(), { wrapper });
    view.unmount();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(h.returnToChat).not.toHaveBeenCalled();
  });
});
