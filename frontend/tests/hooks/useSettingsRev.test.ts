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

// `useSettings` is section-scoped (`useScopedQuery(CONF_SECTIONS, …)`) — the gate is `useTabActive`,
// so that is what has to report Conf as active, or the query never runs and this test would prove
// nothing. Since D70 §10-S4 the scope is a SET (Conf + the agents gallery share these reads), so the
// stub answers for either arity.
vi.mock("../../src/store/ui", async (importActual) => {
  const actual = await importActual<typeof import("../../src/store/ui")>();
  return {
    ...actual,
    useTabActive: (tab: string | readonly string[]) =>
      typeof tab === "string" ? tab === "conf" : tab.includes("conf"),
  };
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

describe("useSaveSettings · a cancelled in-flight GET cannot write its stale rev header", () => {
  it("aborts the deferred GET so its late resolution does NOT clobber the fresh post-save rev (Fix 4)", async () => {
    // The regression Codex found: `useSettings`'s queryFn writes the rev header as a SIDE EFFECT. A save's
    // `cancelQueries(["settings"])` stops TanStack adopting the stale DOCUMENT, but the underlying fetch
    // carried no AbortSignal — so a GET that started before the save still resolves afterwards and its
    // `setQueryData(providers-rev, staleRev)` overwrites the fresh post-save rev. The next save then sends
    // a stale base and falsely 409s. The fix threads TanStack's `signal` into the fetch: an aborted read
    // rejects BEFORE the setQueryData line. This models a browser fetch that honours the signal.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);

    let resolveGet!: (r: Response) => void;
    const getReady = new Promise<Response>((res) => {
      resolveGet = res;
    });
    let getCount = 0;
    globalThis.fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PUT") {
        // the PUT echo — the server is now at rev B
        return Promise.resolve(
          new Response(
            JSON.stringify({
              settings: { server: { port: 5433 } },
              providers_rev: "revB",
              warnings: [],
              restart_required: [],
            }),
            { status: 200, headers: {} },
          ),
        );
      }
      getCount += 1;
      if (getCount > 1) return new Promise<Response>(() => {}); // any refetch stays pending — no spurious write
      // the first GET is deferred AND honours abort exactly like a real fetch (rejects on abort)
      const signal = init?.signal;
      return new Promise<Response>((resolve, reject) => {
        if (signal) {
          if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }
        void getReady.then(resolve); // resolves (with the STALE rev A) only when the test lets it
      });
    });

    const { result } = renderHook(
      () => ({ s: useSettings(), save: useSaveSettings(), rev: useSettingsProvidersRev() }),
      { wrapper },
    );
    // wait until the deferred settings GET is actually in flight (its fetch has been invoked)…
    await waitFor(() => expect(getCount).toBe(1));
    // …then fire the save — onMutate cancels ["settings"], aborting that in-flight read.
    result.current.save.mutate({ server: { port: 5433 } });
    // the PUT echo lands → rev B is the fresh, authoritative base.
    await waitFor(() => expect(qc.getQueryData(["settings", "providers-rev"])).toBe("revB"));
    // NOW the stale GET resolves (rev A) — but with the signal wired the queryFn already rejected on abort,
    // so its setQueryData never runs. Flush microtasks and confirm the rev is STILL B.
    resolveGet(
      new Response(JSON.stringify({ server: { port: 5433 } }), {
        status: 200,
        headers: { "X-Providers-Rev": "revA" },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(qc.getQueryData(["settings", "providers-rev"])).toBe("revB");
  });

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
