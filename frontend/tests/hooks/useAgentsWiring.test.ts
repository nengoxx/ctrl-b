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
  leaveDeletedHome: vi.fn(),
  getJSON: vi.fn(),
}));

vi.mock("../../src/api/client", async (importActual) => {
  const actual = await importActual<typeof import("../../src/api/client")>();
  return { ...actual, del: h.del, putJSON: h.put, getJSON: h.getJSON };
});
vi.mock("../../src/lib/composer", () => ({ loadAgents: h.loadAgents }));
vi.mock("../../src/store/toast", () => ({ pushToast: h.toast }));
vi.mock("../../src/store/chat", () => ({ leaveDeletedHome: h.leaveDeletedHome }));

import { ApiError } from "../../src/api/client";
import { countAgentConversations, useDeleteAgent, useSaveAgent } from "../../src/hooks/useAgents";

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
  h.leaveDeletedHome.mockReset();
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
    result.current.mutate({ name: "vaultkeeper", conversations: false });
    await waitFor(() => expect(h.loadAgents).toHaveBeenCalled());
  });
});

// D84 R41/F6 + N3 (CONVERSATIONS_PLAN §4 "Agent delete", §2 B18) — the mutation variable carries the
// cascade flag; success toasts the report and runs the open-home move on BOTH branches; a 409 (a reply
// running — nothing was deleted) toasts the SERVER's sentence and moves nothing.
describe("useDeleteAgent — the conversations flag, the toast, N3", () => {
  it("OK on the second confirm → `?conversations=true`; the report's count in the toast; N3 runs", async () => {
    h.del.mockResolvedValue({ deleted: 3, folder: "ok", memory: "ok", attachments: "ok" });
    const { result } = renderHook(() => useDeleteAgent(), { wrapper });
    result.current.mutate({ name: "emma", conversations: true });
    await waitFor(() => expect(h.leaveDeletedHome).toHaveBeenCalledWith("emma"));
    expect(h.del).toHaveBeenCalledWith("/api/agents/emma?conversations=true");
    expect(h.toast).toHaveBeenCalledWith("Agent removed · 3 conversations deleted", "ok", {
      sticky: false,
    });
  });

  it("Cancel → no flag — and N3 STILL runs (the open home's conversations are orphaned either way)", async () => {
    h.del.mockResolvedValue({ deleted: true });
    const { result } = renderHook(() => useDeleteAgent(), { wrapper });
    result.current.mutate({ name: "emma", conversations: false });
    await waitFor(() => expect(h.leaveDeletedHome).toHaveBeenCalledWith("emma"));
    expect(h.del).toHaveBeenCalledWith("/api/agents/emma");
  });

  it("a failed count → no flag, and the toast says the conversations were not counted", async () => {
    h.del.mockResolvedValue({ deleted: true });
    const { result } = renderHook(() => useDeleteAgent(), { wrapper });
    result.current.mutate({ name: "emma", conversations: false, uncounted: true });
    await waitFor(() => expect(h.toast).toHaveBeenCalled());
    expect(h.del).toHaveBeenCalledWith("/api/agents/emma");
    expect(h.toast.mock.calls[0][0]).toBe(
      "Agent removed · its conversations could not be counted, so none were deleted",
    );
    expect(h.leaveDeletedHome).toHaveBeenCalledWith("emma");
  });

  it("a 409 → the server's own sentence as the toast; nothing moves (B18)", async () => {
    const detail = "1 of emma's conversations are busy — nothing was deleted";
    h.del.mockRejectedValue(new ApiError(detail, 409));
    const { result } = renderHook(() => useDeleteAgent(), { wrapper });
    result.current.mutate({ name: "emma", conversations: true });
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(detail, "err"));
    expect(h.leaveDeletedHome).not.toHaveBeenCalled();
    expect(h.loadAgents).not.toHaveBeenCalled();
  });
});

// D84 R41 — the second confirm's number: the agent's non-archived conversations, read at the route's
// ceiling, the slug encoded; the array's length. Not a list → a throw (no second confirm, no flag).
describe("countAgentConversations", () => {
  it("reads ?agent=<encoded>&limit=200 and answers the array's length", async () => {
    h.getJSON.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
    await expect(countAgentConversations("emma w")).resolves.toBe(3);
    expect(h.getJSON).toHaveBeenCalledWith("/api/threads?agent=emma%20w&limit=200");
  });

  it("a body that is not a list throws (the caller asks nothing, sends no flag)", async () => {
    h.getJSON.mockResolvedValue({ detail: "nope" });
    await expect(countAgentConversations("emma")).rejects.toThrow();
  });
});
