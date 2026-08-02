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

/** The presentation-order chokepoint (owner directives 2026-07-12): the DEFAULT is a stable self-first
 *  sort, so the machine ctrl-b runs on (the `self` DTO fact) takes slot 0 coherently across the default-
 *  order consumers — vapor's + the Kit's + frontier's FleetViews (vapor reads useFleet, so this is data,
 *  not a code change), the featured-host cycle (same query → same indexes), the Conf editor, the brand
 *  meta. Config order is the stable-sort tiebreak; no self flag → a no-op. `"config"` = the wire (YAML)
 *  order untransformed — a VIEW that composes by its own visual logic opts out (cosmos: planet size makes
 *  a big self planet innermost read wrong, so its layout lever stays the owner-curated YAML order; SAFE
 *  there because cosmos is manual-selection and never reads the shared `featured` index). MODULE-LEVEL fn
 *  on purpose: TanStack memoizes `select` on the function's identity — an inline closure would re-run per
 *  render and hand downstream effects a fresh array identity every time. Copy-before-sort: select must
 *  never mutate the cached data (the cache itself always holds wire order — "config" just reads it raw). */
export type FleetOrder = "self-first" | "config";
function selfFirst(hosts: Host[]): Host[] {
  return [...hosts].sort((a, b) => Number(b.self ?? false) - Number(a.self ?? false));
}

/** Fleet + derived status, polled at the configured cadence (DESIGN.md §13). Presentation-ordered per
 *  `order` — see `FleetOrder` above (default self-first). */
export function useHosts(pollSeconds: number, order: FleetOrder = "self-first") {
  return useQuery({
    queryKey: ["hosts"],
    queryFn: () => getJSON<Host[]>("/api/hosts"),
    refetchInterval: Math.max(1, pollSeconds) * 1000,
    select: order === "config" ? undefined : selfFirst,
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
  /** Whether the hosts query has EVER produced a payload. Distinct from `!isLoading && !error`: a fleet that
   *  answered with an empty list and then hit a background refetch error still has data, and a view that
   *  infers "answered" from `hosts.length > 0` cannot tell that apart from "never answered". Additive — a
   *  view that doesn't care simply ignores it. */
  hasData: boolean;
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
 *  auto-advance timer is NOT here (it's the singleton `useFleetCycle`); this is pure read + user actions.
 *  `order` (default self-first) is the view's presentation-order choice — see `FleetOrder`. ⚠ A view that
 *  passes `"config"` must NOT consume `featured` (the cycle indexes the self-first order); cosmos qualifies
 *  because its selection is manual. Promote this param to ThemeDef data if a third policy ever appears. */
export function useFleet(order: FleetOrder = "self-first"): FleetView {
  const { data: server } = useServerInfo();
  const poll = server?.poll_seconds ?? 5;
  // The raw query result is kept (rather than destructured to `data`) so the view can distinguish "answered
  // with nothing" from "never answered" — `data === undefined` is the only honest source for that.
  const hostsQ = useHosts(poll, order);
  const hosts = hostsQ.data ?? [];
  const { isLoading, error } = hostsQ;
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

  return {
    hosts,
    hasData: hostsQ.data !== undefined,
    svcByHost,
    featured: clamped,
    open,
    poll,
    isLoading,
    error,
    busy,
    run,
    feature,
    toggleRow,
  };
}
