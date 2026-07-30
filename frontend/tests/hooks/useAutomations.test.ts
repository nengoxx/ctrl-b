import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A3 slice 3 — the automations hooks' INVALIDATION wiring, and (post-14c review) the POLL CADENCE.
//
// Invalidation matters because the list and the per-automation run history are two separate caches: a
// write that forgot one of them would leave a stale unread badge or a run that never appears in the
// history. The write path also deliberately does NOT touch ["settings"] — automations live in SQLite,
// not in config.yaml (§D-1) — so a settings invalidation here would mean the two paths had been
// conflated.
//
// The cadence matters because run-now is 202-DETACHED: the request returns the moment the run is
// claimed, so nothing client-side ever learns that it finished. The interval must be armed while a run
// is live and OFF otherwise — a flat interval would poll an idle tab forever.

const h = vi.hoisted(() => ({
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../src/api/client", async (importActual) => {
  const actual = await importActual<typeof import("../../src/api/client")>();
  return { ...actual, postJSON: h.post, putJSON: h.put, del: h.del, getJSON: vi.fn() };
});
vi.mock("../../src/store/toast", () => ({ pushToast: h.toast }));

import {
  useCreateAutomation,
  useDeleteAutomation,
  useMarkRunRead,
  useRunAutomationNow,
  useSetAutomationEnabled,
  useUpdateAutomation,
  useAutomationRuns,
  useAutomations,
  automationsSummary,
  draftOf,
  type AutomationsDoc,
  type AutomationView,
} from "../../src/hooks/useAutomations";

function harness() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidated: unknown[][] = [];
  const real = qc.invalidateQueries.bind(qc);
  vi.spyOn(qc, "invalidateQueries").mockImplementation((filters) => {
    invalidated.push((filters?.queryKey ?? []) as unknown[]);
    return real(filters);
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return { wrapper, invalidated };
}

afterEach(() => {
  h.post.mockReset();
  h.put.mockReset();
  h.del.mockReset();
  h.toast.mockReset();
  vi.restoreAllMocks();
});

describe("automation mutations invalidate the right caches", () => {
  it("a create refreshes the list (and nothing per-automation — there is no history yet)", async () => {
    h.post.mockResolvedValue({ id: "a1", name: "nightly" });
    const { wrapper, invalidated } = harness();
    const { result } = renderHook(() => useCreateAutomation(), { wrapper });
    result.current.mutate(draftOf(null));
    await waitFor(() => expect(h.toast).toHaveBeenCalled());
    expect(h.post).toHaveBeenCalledWith(
      "/api/automations",
      expect.objectContaining({ enabled: true }),
    );
    expect(invalidated).toEqual([["automations"]]);
  });

  it("an update refreshes the list AND that automation's history", async () => {
    h.put.mockResolvedValue({ id: "a1", name: "nightly" });
    const { wrapper, invalidated } = harness();
    const { result } = renderHook(() => useUpdateAutomation(), { wrapper });
    result.current.mutate({ id: "a1", draft: draftOf(null) });
    await waitFor(() => expect(h.toast).toHaveBeenCalled());
    expect(h.put).toHaveBeenCalledWith("/api/automations/a1", expect.any(Object));
    expect(invalidated).toEqual([["automations"], ["automation-runs", "a1"]]);
  });

  it("the enable switch posts the tiny body and refreshes silently (no toast)", async () => {
    h.post.mockResolvedValue({ id: "a1", name: "nightly" });
    const { wrapper, invalidated } = harness();
    const { result } = renderHook(() => useSetAutomationEnabled(), { wrapper });
    result.current.mutate({ id: "a1", enabled: false });
    await waitFor(() => expect(invalidated.length).toBe(2));
    expect(h.post).toHaveBeenCalledWith("/api/automations/a1/enabled", { enabled: false });
    expect(h.toast).not.toHaveBeenCalled(); // a switch that worked needs no announcement
  });

  it("run-now refreshes the history of the automation the run belongs to", async () => {
    h.post.mockResolvedValue({ id: "r1", automation_id: "a1" });
    const { wrapper, invalidated } = harness();
    const { result } = renderHook(() => useRunAutomationNow(), { wrapper });
    result.current.mutate("a1");
    await waitFor(() => expect(h.toast).toHaveBeenCalled());
    expect(h.post).toHaveBeenCalledWith("/api/automations/a1/run-now", {});
    expect(invalidated).toEqual([["automations"], ["automation-runs", "a1"]]);
  });

  it("mark-read is silent and refreshes both caches (the badge lives on the list)", async () => {
    h.post.mockResolvedValue({ id: "r1", automation_id: "a1", read_at: "now" });
    const { wrapper, invalidated } = harness();
    const { result } = renderHook(() => useMarkRunRead(), { wrapper });
    result.current.mutate({ runId: "r1", automationId: "a1" });
    await waitFor(() => expect(invalidated.length).toBe(2));
    expect(h.post).toHaveBeenCalledWith("/api/automations/runs/r1/read", {});
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("a delete surfaces the server's refusal verbatim (409 = a run is active)", async () => {
    h.del.mockRejectedValue(
      new Error("a run of 'nightly' is active — stop or wait for it, then delete"),
    );
    const { wrapper } = harness();
    const { result } = renderHook(() => useDeleteAutomation(), { wrapper });
    result.current.mutate("a1");
    await waitFor(() => expect(h.toast).toHaveBeenCalled());
    expect(h.toast).toHaveBeenCalledWith(expect.stringContaining("is active"), "err");
  });
});

describe("the running-poll cadence", () => {
  /** `refetchInterval` is a FUNCTION of the query's own data, so it can be read off the live query
   *  rather than by waiting out real timers (which would make the suite slow and flaky). It is not on
   *  TanStack's STORED `QueryOptions` type (it belongs to the observer's), though the value we set is
   *  carried through — so it is read through a narrow local shape rather than `any`. */
  type Pollable = { refetchInterval?: ((query: unknown) => number | false) | number | false };
  function intervalOf(qc: QueryClient, key: unknown[]): number | false | undefined {
    const q = qc.getQueryCache().find({ queryKey: key });
    const fn = (q?.options as Pollable | undefined)?.refetchInterval;
    return typeof fn === "function" ? fn(q) : fn;
  }

  it("the list polls ONLY while the server says a run is executing", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);

    qc.setQueryData(["automations"], { automations: [], enabled: true, busy: false });
    renderHook(() => useAutomations(), { wrapper });
    await waitFor(() => expect(intervalOf(qc, ["automations"])).toBe(false)); // idle → no polling at all

    qc.setQueryData(["automations"], { automations: [], enabled: true, busy: true });
    await waitFor(() => expect(intervalOf(qc, ["automations"])).toBeGreaterThan(0));
  });

  it("the run history polls only while one of ITS rows is still running", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);

    qc.setQueryData(["automation-runs", "a1"], [{ id: "r1", status: "ok" }]);
    renderHook(() => useAutomationRuns("a1"), { wrapper });
    await waitFor(() => expect(intervalOf(qc, ["automation-runs", "a1"])).toBe(false));

    qc.setQueryData(["automation-runs", "a1"], [{ id: "r2", status: "running" }]);
    await waitFor(() => expect(intervalOf(qc, ["automation-runs", "a1"])).toBeGreaterThan(0));
  });

  it("a disabled history query (no open sheet) does not poll", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useAutomationRuns(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ── A3 14d — the Conf group header's collapsed summary. A pure function of the list envelope, so the
// precedence rule (unread ▸ scheduler off ▸ count) is pinned without rendering the 2300-line Conf tab.

describe("automationsSummary · what the collapsed group says", () => {
  const view = (unread: number): AutomationView =>
    ({ unread_runs: unread }) as unknown as AutomationView;
  const doc = (over: Partial<AutomationsDoc>): AutomationsDoc =>
    ({ automations: [], enabled: true, busy: false, ...over }) as AutomationsDoc;

  it("says nothing at all until the list has loaded", () => {
    expect(automationsSummary(undefined)).toBeUndefined();
  });

  it("degrades to no summary on a MALFORMED payload — never a throw in ConfTab's render", () => {
    // The v1.4.2 release-gate catch: an `{}` answer (a mock's unmocked-GET default, a proxy error
    // body) reached `.reduce` on undefined and crashed the ENTIRE Conf tab behind the error screen.
    expect(automationsSummary({} as AutomationsDoc)).toBeUndefined();
    expect(
      automationsSummary({ automations: "nope" } as unknown as AutomationsDoc),
    ).toBeUndefined();
  });

  it("counts automations while everything is read", () => {
    expect(automationsSummary(doc({ automations: [view(0), view(0)] }))).toBe("2 automations");
    expect(automationsSummary(doc({ automations: [view(0)] }))).toBe("1 automation");
    expect(automationsSummary(doc({}))).toBe("0 automations");
  });

  it("says the scheduler is off when it is — that outranks the count", () => {
    expect(automationsSummary(doc({ automations: [view(0)], enabled: false }))).toBe(
      "scheduler off",
    );
  });

  it("SUMS the unread runs and leads with them, even while the scheduler is off", () => {
    expect(automationsSummary(doc({ automations: [view(2), view(1)] }))).toBe("3 new");
    expect(automationsSummary(doc({ automations: [view(1)], enabled: false }))).toBe("1 new");
  });
});
