import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// useFleetActions.run — the OUTCOME contract (2026-08-30). `run` used to be fire-and-forget with an
// optimistic cache flip; it resolves `true`/`false` now and owns the pending-transition record instead:
// begun at DISPATCH for the two power actions, handed back — token-guarded — the moment the request
// fails. That record is what holds a machine's assumed state through its boot/shutdown window, so the
// exact moments it starts and stops are the thing worth pinning, and they are pinned against the REAL
// `store/fleetPending` (mocking it would only re-assert the calls, never the record).
//
// The transport and the two stores `run` writes to for FEEDBACK (toast, confirm) are mocked, in the
// `useSaveSettings.test.ts` house style.

const h = vi.hoisted(() => ({
  post: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("../../src/api/client", async (importActual) => {
  const actual = await importActual<typeof import("../../src/api/client")>();
  // The action REGISTRY answers with nothing: `run` then falls back to its own confirm policy
  // (shutdown/reboot ask, wake/ping do not), which is the deterministic path for these cases.
  return { ...actual, getJSON: vi.fn(() => Promise.resolve([])), postJSON: h.post };
});
vi.mock("../../src/store/toast", () => ({ pushToast: h.toast }));
vi.mock("../../src/store/confirm", () => ({ requestConfirm: h.confirm }));

import { useFleetActions } from "../../src/hooks/useActions";
import { pendingSnapshot, reconcilePending } from "../../src/store/fleetPending";
import type { Host, InvokeResponse, ToolResult } from "../../src/types";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    children,
  );

const HOST: Host = {
  id: "atlas",
  name: "atlas",
  ip: "10.0.0.7",
  mac: "aa:bb:cc:dd:ee:ff",
  ssh_username: null,
  ssh_port: 22,
  os_type: "linux",
  role: "workstation",
  tags: [],
  status: {
    host_id: "atlas",
    online: false,
    ping_ms: null,
    last_seen: null,
    checked_at: "2026-01-01T00:00:00Z",
    error: null,
  },
};

/** An `InvokeResponse` carrying a result in the given state — the only field `run` reads. */
const answer = (state: ToolResult["state"], summary = "sent"): InvokeResponse => ({
  needs_confirm: false,
  result: { state, summary, data: {}, output: null, error: null, artifacts: [], duration_ms: 1 },
});

const kindOf = (id: string) => pendingSnapshot().get(id)?.kind;
const runHook = () => renderHook(() => useFleetActions(), { wrapper }).result;

beforeEach(() => {
  h.confirm.mockImplementation(() => Promise.resolve(true));
});
afterEach(() => reconcilePending([])); // the sanctioned reset: every entry's host is gone

describe("run() reports its outcome, and owns the pending record", () => {
  it("an OK'd wake resolves true, and its record OUTLIVES the response", async () => {
    h.post.mockResolvedValue(answer("ok", "magic packet sent"));
    const result = runHook();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.run("wake", HOST);
    });
    expect(ok).toBe(true);
    // The window, not the round trip, is what ends it — the machine is still booting.
    expect(kindOf("atlas")).toBe("wake");
    expect(h.toast).toHaveBeenCalledWith("magic packet sent", "ok");
  });

  it("the record begins at DISPATCH, before the response", async () => {
    // A WOL round trip says nothing about the transition, and gacha's develop ceremony gates its very
    // first beat on the record — so it cannot wait for the answer.
    let respond = (_r: InvokeResponse) => {};
    h.post.mockReturnValue(new Promise<InvokeResponse>((r) => (respond = r)));
    const result = runHook();
    let settled: Promise<boolean>;
    act(() => {
      settled = result.current.run("wake", HOST);
    });
    expect(kindOf("atlas")).toBe("wake"); // in flight, already assumed
    await act(async () => {
      respond(answer("ok"));
      await settled;
    });
    expect(kindOf("atlas")).toBe("wake");
  });

  it("a REFUSED wake resolves false and hands the record straight back", async () => {
    h.post.mockResolvedValue(answer("error", "no MAC configured"));
    const result = runHook();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.run("wake", HOST);
    });
    expect(ok).toBe(false);
    expect(pendingSnapshot().has("atlas")).toBe(false); // nothing is coming up — assume nothing
    expect(h.toast).toHaveBeenCalledWith("no MAC configured", "err");
  });

  it("a THROWN request resolves false too — the error is handled here, never rethrown", async () => {
    h.post.mockRejectedValue(new Error("network down"));
    const result = runHook();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.run("wake", HOST);
    });
    expect(ok).toBe(false);
    expect(pendingSnapshot().has("atlas")).toBe(false);
    expect(h.toast).toHaveBeenCalledWith("network down", "err");
  });

  it("a CONFIRMED shutdown records the other direction", async () => {
    h.post.mockResolvedValue(answer("ok", "shutting down"));
    const result = runHook();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.run("shutdown", HOST);
    });
    expect(ok).toBe(true);
    expect(kindOf("atlas")).toBe("shutdown");
  });

  it("a CANCELLED confirm resolves false, sends nothing and records nothing", async () => {
    // The gate is upstream of the dispatch, so a refusal must leave no trace: no request, and above all
    // no assumed state about a machine the owner decided not to touch.
    h.confirm.mockImplementation(() => Promise.resolve(false));
    const result = runHook();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.run("shutdown", HOST);
    });
    expect(ok).toBe(false);
    expect(h.post).not.toHaveBeenCalled();
    expect(pendingSnapshot().has("atlas")).toBe(false);
  });

  it("PING gets no record — only the two power actions have a grace window", async () => {
    h.post.mockResolvedValue(answer("ok", "18 ms"));
    const result = runHook();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.run("ping", HOST);
    });
    expect(ok).toBe(true);
    expect(pendingSnapshot().size).toBe(0);
  });
});
