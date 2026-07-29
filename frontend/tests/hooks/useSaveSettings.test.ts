import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../src/api/client";

// FX15 (Codex#12) — the providers-conflict 409 handling applies ONLY when the mutation patch actually
// carried the `providers` map. An agent-busy 409 (a tool_overrides save mid-turn) keeps the generic toast.

const h = vi.hoisted(() => ({
  put: vi.fn(),
  toast: vi.fn(),
  loadProviders: vi.fn(),
  loadAgents: vi.fn(),
}));

vi.mock("../../src/api/client", async (importActual) => {
  const actual = await importActual<typeof import("../../src/api/client")>();
  return { ...actual, putJSON: h.put, getJSON: vi.fn() };
});
vi.mock("../../src/lib/composer", () => ({
  loadProviders: h.loadProviders,
  loadAgents: h.loadAgents,
}));
vi.mock("../../src/store/toast", () => ({ pushToast: h.toast }));

import { useSaveSettings } from "../../src/hooks/useSettings";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { mutations: { retry: false } } }) },
    children,
  );

afterEach(() => {
  h.put.mockReset();
  h.toast.mockReset();
  h.loadProviders.mockReset();
  h.loadAgents.mockReset();
});

describe("useSaveSettings · 409 handling (FX15)", () => {
  it("a providers-carrying 409 shows the providers-conflict toast", async () => {
    h.put.mockRejectedValue(new ApiError("conflict", 409));
    const { result } = renderHook(() => useSaveSettings(), { wrapper });
    result.current.mutate({ providers: {}, providers_base: "revA" });
    await waitFor(() => expect(h.toast).toHaveBeenCalled());
    expect(h.toast.mock.calls[0][0]).toMatch(/changed elsewhere — reload the tab/);
  });

  it("a NON-providers 409 (agent busy) keeps the generic toast", async () => {
    h.put.mockRejectedValue(new ApiError("agent is busy — try again in a moment", 409));
    const { result } = renderHook(() => useSaveSettings(), { wrapper });
    result.current.mutate({ tool_overrides: { some_tool: {} } });
    await waitFor(() => expect(h.toast).toHaveBeenCalled());
    expect(h.toast.mock.calls[0][0]).toBe("agent is busy — try again in a moment");
  });
});

// SYS-9.2: a save may change the default-agent selection (edited through PUT /api/settings), so the
// success path refreshes the composer's module-level `/agent` set + resolved default — alongside the
// existing `/<provider>` verb refresh — so a change is live without a page reload.
describe("useSaveSettings · composer refresh on success (SYS-9.2)", () => {
  it("a successful save refreshes both the provider verbs and the `/agent` set", async () => {
    h.put.mockResolvedValue({
      settings: {},
      restart_required: [],
      warnings: [],
      providers_rev: "r",
    });
    const { result } = renderHook(() => useSaveSettings(), { wrapper });
    result.current.mutate({ agent: { default_agent: "vaultkeeper" } });
    await waitFor(() => expect(h.loadAgents).toHaveBeenCalled());
    expect(h.loadProviders).toHaveBeenCalled();
  });
});

// F1 — the notification engine reads its prefs from the ALWAYS-ON `["notification-prefs"]` query, not
// from the Conf-scoped settings doc. A save that flips notifications must therefore invalidate that key
// too, or the owner turns notifications on and nothing changes until a reload.
describe("useSaveSettings · notification prefs invalidation (F1)", () => {
  it("a successful save invalidates the always-on notification-prefs query", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const localWrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);

    h.put.mockResolvedValue({
      settings: {},
      restart_required: [],
      warnings: [],
      providers_rev: "r",
    });
    const { result } = renderHook(() => useSaveSettings(), { wrapper: localWrapper });
    result.current.mutate({ notifications: { enabled: true } });
    await waitFor(() => expect(h.loadProviders).toHaveBeenCalled());

    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(["notification-prefs"]));
  });
});
