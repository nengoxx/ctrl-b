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
  stale: new Set<() => void>(),
  returnToChat: vi.fn(async () => {}),
}));
vi.mock("../../src/api/client", async (importActual) => ({
  ...(await importActual<typeof import("../../src/api/client")>()),
  getJSON: h.getJSON,
}));
vi.mock("../../src/store/chat", () => ({
  onThreadListsStale: (cb: () => void) => {
    h.stale.add(cb);
    return () => h.stale.delete(cb);
  },
  returnToChat: h.returnToChat,
}));

import {
  beforeCursor,
  threadsPath,
  useThreadListsBridge,
  useThreads,
} from "../../src/hooks/useThreads";
import { setUI } from "../../src/store/ui";

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: qc }, children);

let visibility: DocumentVisibilityState;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.stale.clear();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  setUI({ tab: "fleet" });
});
afterEach(() => {
  cleanup(); // no globals → no auto-cleanup: a bridge left mounted would answer the next test's events
  qc.clear();
});

describe("useThreads — one agent's conversations, the first page (§4)", () => {
  it("is keyed ['threads', agent] and reads ?agent=<slug>&limit=50, encoded", async () => {
    h.getJSON.mockResolvedValue([{ id: "L2", agent: "lynette" }]);
    const { result } = renderHook(() => useThreads("lynette"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.getJSON).toHaveBeenCalledWith("/api/threads?agent=lynette&limit=50");
    expect(qc.getQueryData(["threads", "lynette"])).toEqual([{ id: "L2", agent: "lynette" }]);
    expect(threadsPath("a b/c")).toBe("/api/threads?agent=a%20b%2Fc&limit=50");
  });

  it("an off-roster slug answers the server's [] — an empty list, not an error (M7)", async () => {
    h.getJSON.mockResolvedValue([]);
    const { result } = renderHook(() => useThreads("ghost"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
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
