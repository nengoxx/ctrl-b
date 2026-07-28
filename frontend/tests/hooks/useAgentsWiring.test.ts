import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// SYS-9.2: an agent create/overwrite/delete must refresh the composer's module-level `/agent` set
// (loadAgents, populated once at import) — mirrors the way a skill CRUD refreshes loadSkills and a
// settings save refreshes loadProviders (useSkills.test.ts is the precedent). Without it a
// renamed/added/removed agent isn't seen by the verb router until a full page reload.

const h = vi.hoisted(() => ({
  del: vi.fn(),
  put: vi.fn(),
  loadAgents: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../src/api/client", async (importActual) => {
  const actual = await importActual<typeof import("../../src/api/client")>();
  return { ...actual, del: h.del, putJSON: h.put, getJSON: vi.fn() };
});
vi.mock("../../src/lib/composer", () => ({ loadAgents: h.loadAgents }));
vi.mock("../../src/store/toast", () => ({ pushToast: h.toast }));

import { useDeleteAgent, useSaveAgent } from "../../src/hooks/useAgents";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { mutations: { retry: false } } }) },
    children,
  );

afterEach(() => {
  h.del.mockReset();
  h.put.mockReset();
  h.loadAgents.mockReset();
  h.toast.mockReset();
});

describe("useAgents invalidation wiring (SYS-9.2)", () => {
  it("an agent SAVE (create/overwrite) refreshes the composer's `/agent` set", async () => {
    h.put.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSaveAgent(), { wrapper });
    result.current.mutate({ name: "vaultkeeper", agent: {} });
    await waitFor(() => expect(h.loadAgents).toHaveBeenCalled());
  });

  it("an agent DELETE refreshes the composer's `/agent` set", async () => {
    h.del.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteAgent(), { wrapper });
    result.current.mutate("vaultkeeper");
    await waitFor(() => expect(h.loadAgents).toHaveBeenCalled());
  });
});
