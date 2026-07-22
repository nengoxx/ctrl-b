import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// FR2-2 (Codex#8 residual): a skill create/overwrite/delete refreshes the composer's module-level SKILL
// set (loadSkills) AND its PROVIDER-verb set (loadProviders) — deleting a skill that shadowed a provider
// name re-frees that `/<provider>` verb, so the composer must reload both without a page refresh.

const h = vi.hoisted(() => ({
  del: vi.fn(),
  put: vi.fn(),
  loadSkills: vi.fn(),
  loadProviders: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../src/api/client", async (importActual) => {
  const actual = await importActual<typeof import("../../src/api/client")>();
  return { ...actual, del: h.del, putJSON: h.put, getJSON: vi.fn() };
});
vi.mock("../../src/lib/composer", () => ({
  loadSkills: h.loadSkills,
  loadProviders: h.loadProviders,
}));
vi.mock("../../src/store/toast", () => ({ pushToast: h.toast }));

import { useDeleteSkill, useSaveSkill } from "../../src/hooks/useSkills";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { mutations: { retry: false } } }) },
    children,
  );

afterEach(() => {
  h.del.mockReset();
  h.put.mockReset();
  h.loadSkills.mockReset();
  h.loadProviders.mockReset();
  h.toast.mockReset();
});

describe("useSkills invalidation wiring (FR2-2)", () => {
  it("a skill DELETE refreshes BOTH the composer skill set and the provider-verb set", async () => {
    h.del.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteSkill(), { wrapper });
    result.current.mutate("shadowing-skill");
    await waitFor(() => expect(h.loadSkills).toHaveBeenCalled());
    expect(h.loadProviders).toHaveBeenCalled(); // FR2-2 — the freed provider verb goes live without a reload
  });

  it("a skill SAVE (create/overwrite) also refreshes both sets", async () => {
    h.put.mockResolvedValue({ name: "s", content: "x" });
    const { result } = renderHook(() => useSaveSkill(), { wrapper });
    result.current.mutate({ name: "s", content: "x" });
    await waitFor(() => expect(h.loadSkills).toHaveBeenCalled());
    expect(h.loadProviders).toHaveBeenCalled();
  });
});
