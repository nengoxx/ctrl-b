import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// useFleet × the pending-transition store (2026-08-30) — the three seams that make an assumed state
// visible to every FleetView at once, and that live nowhere else:
//
//  1. `hosts` is presented THROUGH `overlayPending`, so a machine the owner just shut down reads offline
//     while the poll is still finding it pingable (the old optimistic cache flip bounced back online at
//     the settle-time refetch; this replaces it rather than patching it).
//  2. `busy` is the request-busy set UNIONED with the pending hosts (sol MED-3), so a machine inside its
//     grace window stays action-disabled after the HTTP request has settled.
//  3. every hosts answer runs `reconcilePending`, which is what ends a record early when the polls agree.
//
// The transport is mocked per path; the pending store is the REAL one, because the point of each claim
// is what the store does to the view.

const h = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../../src/api/client", async (importActual) => {
  const actual = await importActual<typeof import("../../src/api/client")>();
  return { ...actual, getJSON: h.get, postJSON: vi.fn() };
});

import { useFleet } from "../../src/hooks/useFleet";
import { beginPending, pendingSnapshot, reconcilePending } from "../../src/store/fleetPending";
import type { Host } from "../../src/types";

const host = (id: string, online: boolean): Host => ({
  id,
  name: id,
  ip: "10.0.0.7",
  mac: null,
  ssh_username: null,
  ssh_port: 22,
  os_type: "linux",
  role: "workstation",
  tags: [],
  status: {
    host_id: id,
    online,
    ping_ms: online ? 18 : null,
    last_seen: null,
    checked_at: "2026-01-01T00:00:00Z",
    error: null,
  },
});

/** Route the app's four GETs; `hosts` is what the cases actually drive. */
function serve(hosts: Host[]): void {
  h.get.mockImplementation((path: string) => {
    if (path === "/api/hosts") return Promise.resolve(hosts);
    if (path === "/api/health")
      return Promise.resolve({
        status: "ok",
        version: "test",
        schema_version: 7,
        // no polling in a test: the fleet is driven by re-serving and refetching, not by a timer
        server: { poll_seconds: 3600, feature_cycle_seconds: 3600 },
      });
    return Promise.resolve([]); // /api/services, /api/actions
  });
}

/** The hook, mounted and settled on its first hosts answer. The client is handed back so a case can
 *  publish the NEXT poll's answer (`setQueryData`) — the honest stand-in for a poll landing, and the
 *  only way to move `hostsQ.data`, which is what the reconcile effect keys on. */
async function mounted(hosts: Host[]) {
  serve(hosts);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  const { result } = renderHook(() => useFleet(), { wrapper });
  await waitFor(() => expect(result.current.hasData).toBe(true));
  /** The next hosts answer lands. Async, and yielding a full task rather than a microtask: TanStack
   *  batches its observer notifications, so the re-render — and with it the reconcile EFFECT this file
   *  is about — happens well after `setQueryData` returns. */
  const poll = async (next: Host[]) => {
    await act(async () => {
      qc.setQueryData(["hosts"], next);
      await new Promise((r) => setTimeout(r, 0));
    });
  };
  return { result, poll };
}

afterEach(() => reconcilePending([])); // the sanctioned reset: every entry's host is gone

describe("useFleet presents the fleet THROUGH the pending assumptions", () => {
  it("shows a pending-SHUTDOWN host as offline while the poll still says it is up", async () => {
    const { result } = await mounted([host("atlas", true), host("relay", true)]);
    expect(result.current.hosts[0].status?.online).toBe(true);

    act(() => void beginPending("atlas", "shutdown"));
    expect(result.current.hosts[0].status?.online).toBe(false); // assumed down — the owner said so
    expect(result.current.hosts[1].status?.online).toBe(true); // …and only that one
  });

  it("leaves a pending WAKE alone — that machine IS offline, and the chip ranks the poll above it", async () => {
    const { result } = await mounted([host("atlas", false), host("relay", true)]);
    const before = result.current.hosts;
    act(() => void beginPending("atlas", "wake"));
    // identity-stable, so every downstream memo() keeps bailing exactly as it did
    expect(result.current.hosts).toBe(before);
  });

  it("keeps a pending host BUSY for the whole window, of either kind", async () => {
    // Offering Wake on a still-pingable machine mid-shutdown would fire a packet its NIC is not parked
    // to hear; offering it again mid-boot is a duplicate, not a retry. Both stay disabled.
    const { result } = await mounted([host("atlas", false), host("relay", true)]);
    expect(result.current.busy.size).toBe(0);

    act(() => void beginPending("atlas", "wake"));
    act(() => void beginPending("relay", "shutdown"));
    expect([...result.current.busy].sort()).toEqual(["atlas", "relay"]);
  });
});

describe("useFleet reconciles the records with every hosts answer", () => {
  it("clears a pending WAKE the moment a poll observes the machine ONLINE", async () => {
    const { result, poll } = await mounted([host("atlas", false)]);
    act(() => void beginPending("atlas", "wake"));
    expect(result.current.busy.has("atlas")).toBe(true);

    await poll([host("atlas", true)]); // the machine came up, and the next answer says so
    expect(pendingSnapshot().has("atlas")).toBe(false);
    expect(result.current.busy.has("atlas")).toBe(false); // …and it is actionable again
    expect(result.current.hosts[0].status?.online).toBe(true);
  });

  it("holds the record while the polls still CONTRADICT the dispatch", async () => {
    // The whole reason the grace period exists: the freshest poll actively disagrees with what the user
    // just did, and for a bounded while the user wins.
    const { result, poll } = await mounted([host("atlas", true)]);
    act(() => void beginPending("atlas", "shutdown"));

    await poll([host("atlas", true)]); // still pingable, seconds after accepting the shutdown
    expect(pendingSnapshot().get("atlas")?.kind).toBe("shutdown");
    expect(result.current.hosts[0].status?.online).toBe(false); // and it still reads as going down
  });

  it("prunes the record of a machine that LEFT the fleet", async () => {
    const { result, poll } = await mounted([host("atlas", false), host("relay", true)]);
    act(() => void beginPending("atlas", "wake"));

    await poll([host("relay", true)]); // atlas was removed from the config mid-window
    expect(pendingSnapshot().has("atlas")).toBe(false);
    expect(result.current.busy.size).toBe(0);
  });
});
