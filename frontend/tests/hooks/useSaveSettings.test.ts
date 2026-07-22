import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../src/api/client";

// FX15 (Codex#12) — the providers-conflict 409 handling applies ONLY when the mutation patch actually
// carried the `providers` map. An agent-busy 409 (a tool_overrides save mid-turn) keeps the generic toast.

const h = vi.hoisted(() => ({ put: vi.fn(), toast: vi.fn() }));

vi.mock("../../src/api/client", async (importActual) => {
  const actual = await importActual<typeof import("../../src/api/client")>();
  return { ...actual, putJSON: h.put, getJSON: vi.fn() };
});
vi.mock("../../src/lib/composer", () => ({ loadProviders: vi.fn() }));
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
