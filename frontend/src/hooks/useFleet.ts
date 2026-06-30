import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import { getJSON } from "../api/client";
import { useTabActive } from "../store/ui";
import {
  feature,
  featureAuto,
  fleetState,
  holdRemainingMs,
  toggleRow,
  useFeatured,
  useOpenRows,
} from "../store/fleet";
import type { Host, Service, ServerInfo } from "../types";
import { useFleetActions } from "./useActions";
import { useServices } from "./useServices";

interface Health {
  status: string;
  version: string;
  schema_version: number;
  server: ServerInfo;
}

/** Server info (poll cadence, port). Rarely changes — long stale time. */
export function useServerInfo() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => getJSON<Health>("/api/health"),
    select: (h) => h.server,
    staleTime: 60_000,
  });
}

/** Fleet + derived status, polled at the configured cadence (DESIGN.md §13). */
export function useHosts(pollSeconds: number) {
  return useQuery({
    queryKey: ["hosts"],
    queryFn: () => getJSON<Host[]>("/api/hosts"),
    refetchInterval: Math.max(1, pollSeconds) * 1000,
  });
}

// ── Fleet controller (D29 §14.2) — headless: state+actions, no markup. Two parts: a SINGLETON
//    auto-advance engine (call once, above the theme Root) + a consumer hook any FleetView reads.

/**
 * The featured-host auto-advance engine. **Call ONCE, above the theme Root** (App) — it owns the timer
 * and writes the shared fleet store, so a second instance would double-advance (§14.5). Self-rescheduling
 * timeout (not a fixed interval) so a manual selection cleanly defers the next advance: each tick, if the
 * carousel is held (a recent tap), it reschedules to exactly the hold's remaining time, then advances among
 * the online hosts. `hosts` is read through a ref so a poll (new array ref) doesn't churn the timer.
 */
export function useFleetCycle(): void {
  const { data: server } = useServerInfo();
  const cycleMs = Math.max(1, server?.feature_cycle_seconds ?? 6) * 1000;
  const { data: hosts = [] } = useHosts(server?.poll_seconds ?? 5);
  const hostsRef = useRef(hosts);
  hostsRef.current = hosts;
  // Only advance the carousel while the Fleet tab is showing — off-tab it's display:none, so each tick
  // would `featureAuto` → re-render the (invisible) Hero now-dots + featured row for nothing. Gating the
  // timer here (an effect dep) suspends it cleanly and resumes on return (the next tick re-features).
  const onFleet = useTabActive("fleet");

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rescheduleRef = useRef<(delayMs: number) => void>(() => {});
  useEffect(() => {
    if (!onFleet) return; // paused off-tab — no timer scheduled
    const advance = () => {
      const held = holdRemainingMs();
      if (held > 0) {
        rescheduleRef.current(held); // wait out the manual hold, don't advance
        return;
      }
      const cur = hostsRef.current;
      const onIdx = cur.map((h, i) => (h.status?.online ? i : -1)).filter((i) => i >= 0);
      if (onIdx.length) {
        const pos = onIdx.indexOf(fleetState().featured);
        featureAuto(onIdx[(pos + 1) % onIdx.length]);
      }
      rescheduleRef.current(cycleMs);
    };
    const reschedule = (delayMs: number) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(advance, delayMs);
    };
    rescheduleRef.current = reschedule;
    reschedule(cycleMs);
    return () => clearTimeout(timer.current);
  }, [cycleMs, onFleet]);
}

export interface FleetView {
  hosts: Host[];
  svcByHost: Map<string, Service[]>;
  featured: number; // clamped to the current host range
  open: ReadonlySet<string>;
  poll: number;
  isLoading: boolean;
  error: Error | null;
  busy: ReadonlySet<string>;
  run: ReturnType<typeof useFleetActions>["run"];
  feature: (i: number) => void; // user picks a host (now-dots) — holds the carousel
  toggleRow: (id: string, i: number) => void; // user taps a row — features + holds + toggles expand
}

/** Consumer hook for any FleetView — the fleet data + the carousel/expand state & actions. The
 *  auto-advance timer is NOT here (it's the singleton `useFleetCycle`); this is pure read + user actions. */
export function useFleet(): FleetView {
  const { data: server } = useServerInfo();
  const poll = server?.poll_seconds ?? 5;
  const { data: hosts = [], isLoading, error } = useHosts(poll);
  const { data: services = [] } = useServices(poll);
  const { run, busy } = useFleetActions();
  const featured = useFeatured();
  const open = useOpenRows();

  // Group services by host. Memoized on the `services` query-data ref (stable across renders unless a
  // poll changes it) so each host's array keeps a STABLE identity — that's what lets `memo(DeviceRow)`
  // actually bail: the row's `services` prop only changes when that host's services really change.
  const svcByHost = useMemo(() => {
    const m = new Map<string, Service[]>();
    for (const s of services) {
      const list = m.get(s.host_id);
      list ? list.push(s) : m.set(s.host_id, [s]);
    }
    return m;
  }, [services]);
  const clamped = hosts.length ? Math.min(featured, hosts.length - 1) : 0;

  return { hosts, svcByHost, featured: clamped, open, poll, isLoading, error, busy, run, feature, toggleRow };
}
