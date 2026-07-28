import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A11 pre-release FE audit, MED — the riskiest contract was the one the tests mocked away. The Conf
// concurrency test asserted that a rev it had itself stubbed came back out again, so nothing covered
// the part that can actually break: EXTRACTING `X-Providers-Rev` from the settings response and pairing
// it with the snapshot the draft seeds from (FR2-1). This drives the real hook, over a real
// QueryClient, against a fetch whose HEADERS are the thing under test.

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockFetch(body: unknown, headers: Record<string, string>) {
  globalThis.fetch = vi.fn(async () =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers })),
  );
}

// `useSettings` is tab-scoped (`useScopedQuery("conf", …)`) — the gate is `useTabActive`, so that is
// what has to report Conf as active, or the query never runs and this test would prove nothing.
vi.mock("../../src/store/ui", async (importActual) => {
  const actual = await importActual<typeof import("../../src/store/ui")>();
  return { ...actual, useTabActive: (tab: string) => tab === "conf" };
});

import { useSaveSettings, useSettings, useSettingsProvidersRev } from "../../src/hooks/useSettings";

describe("useSettings · the providers rev rides the settings response", () => {
  let qc: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it("stashes the X-Providers-Rev header under the settings-paired key", async () => {
    mockFetch({ server: { port: 5433 } }, { "X-Providers-Rev": "abc123def456" });
    const { result } = renderHook(() => ({ s: useSettings(), rev: useSettingsProvidersRev() }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.s.data).toBeTruthy());
    // the doc body stays the query data (C9 naked) …
    expect(result.current.s.data).toEqual({ server: { port: 5433 } });
    // … and the fingerprint reached the paired key, which is what the Conf draft binds its base to.
    await waitFor(() => expect(result.current.rev).toBe("abc123def456"));
    expect(qc.getQueryData(["settings", "providers-rev"])).toBe("abc123def456");
  });

  it("stores null when the response carries no header, rather than a stale value", async () => {
    // A base of `null` makes a providers-carrying PUT 409 rather than silently overwriting with an
    // unverifiable base — the safe direction. (An older rev must never survive a header-less read.)
    qc.setQueryData(["settings", "providers-rev"], "stale-rev");
    mockFetch({ server: { port: 5433 } }, {});
    const { result } = renderHook(() => ({ s: useSettings(), rev: useSettingsProvidersRev() }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.s.data).toBeTruthy());
    await waitFor(() => expect(qc.getQueryData(["settings", "providers-rev"])).toBeNull());
  });
});

describe("useSaveSettings · a stale in-flight GET cannot overwrite the echo", () => {
  it("cancels the settings query before adopting the PUT echo", async () => {
    // A read that STARTED before the save can land after `setQueryData` and restore the pre-save doc
    // and its old rev; a draft that just went clean then reseeds from that stale snapshot and shows old
    // values while the server holds the new ones — with the bar saying "Saved" (Codex).
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const cancel = vi.spyOn(qc, "cancelQueries");
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    mockFetch(
      {
        settings: { server: { port: 5433 } },
        providers_rev: "revB",
        warnings: [],
        restart_required: [],
      },
      {},
    );
    const { result } = renderHook(() => useSaveSettings(), { wrapper });
    result.current.mutate({ server: { port: 5433 } });
    await waitFor(() => expect(cancel).toHaveBeenCalled());
    expect(cancel.mock.calls[0][0]).toEqual({ queryKey: ["settings"] });
    // …and the echo is what ends up in the cache, with its paired rev
    await waitFor(() => expect(qc.getQueryData(["settings", "providers-rev"])).toBe("revB"));
  });
});
