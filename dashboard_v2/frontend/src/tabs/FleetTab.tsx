import { useCallback, useEffect, useRef, useState } from "react";

import { DeviceRow } from "../components/DeviceRow";
import { FleetSummary } from "../components/FleetSummary";
import { Hero } from "../components/Hero";
import { useFleetActions } from "../hooks/useActions";
import { useHosts, useServerInfo } from "../hooks/useFleet";
import { useServices } from "../hooks/useServices";
import { useUISlice } from "../store/ui";
import type { Service } from "../types";

// The ⭐ Phase 1 deliverable: the Vapor Fleet tab wired to the live API. Owns `featured`
// (auto-cycles among online hosts, like vapor.html) + the open-row set.

interface Props {
  active: boolean;
}

// After the user manually features a host (taps a row or a now-dot), suspend the auto-cycle for this
// long so their selection stays put instead of being cycled away on the next tick. A UX nicety; could
// later be promoted to a config field (sibling of `server.feature_cycle_seconds`) if tuning is wanted.
// NOTE: this Fleet auto-cycle (+ pause) logic moves into the `useFleet` controller in M2 (D29 §14.2).
const INTERACTION_PAUSE_MS = 5000;

export function FleetTab({ active }: Props) {
  // Two slices, one per field — each subscription is independent and only fires when
  // *its* field changes. A toggle of one doesn't wake up consumers of the other.
  const heroOn = useUISlice((s) => s.heroOn);
  const waveformOn = useUISlice((s) => s.waveformOn);
  const { data: server } = useServerInfo();
  const poll = server?.poll_seconds ?? 5;
  const cycleMs = Math.max(1, server?.feature_cycle_seconds ?? 6) * 1000;
  const { data: hosts = [], isLoading, error } = useHosts(poll);
  const { data: services = [] } = useServices(poll);
  const { run, busy } = useFleetActions();

  // Group services by host once per render so each row gets only its own (Vapor's `mine`).
  const svcByHost = new Map<string, Service[]>();
  for (const s of services) {
    const list = svcByHost.get(s.host_id);
    list ? list.push(s) : svcByHost.set(s.host_id, [s]);
  }

  const [featured, setFeatured] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Keep featured in range as the fleet changes.
  const clamped = hosts.length ? Math.min(featured, hosts.length - 1) : 0;

  // Auto-cycle the featured host among those online. Period is `server.feature_cycle_seconds`
  // (configurable in Conf → Server). `hosts` is read through a ref so the interval only resets
  // when the period itself changes — depending on `hosts` here would reset the timer on every
  // poll (TanStack returns a new array reference when `checked_at` changes), and the cycle
  // would never reliably fire.
  const hostsRef = useRef(hosts);
  hostsRef.current = hosts;
  // Timestamp until which the auto-cycle is paused (set when the user manually features a host).
  const pauseUntilRef = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() < pauseUntilRef.current) return; // paused after a manual selection
      setFeatured((f) => {
        const cur = hostsRef.current;
        const onIdx = cur.map((h, i) => (h.status?.online ? i : -1)).filter((i) => i >= 0);
        if (!onIdx.length) return f;
        const curPos = onIdx.indexOf(f);
        return onIdx[(curPos + 1) % onIdx.length];
      });
    }, cycleMs);
    return () => clearInterval(id);
  }, [cycleMs]);

  // Feature a host from a user action — pauses the auto-cycle so the selection isn't cycled away.
  // Stable identity (used by the Hero dots + the row toggle).
  const feature = useCallback((i: number) => {
    pauseUntilRef.current = Date.now() + INTERACTION_PAUSE_MS;
    setFeatured(i);
  }, []);

  function toggle(id: string, i: number) {
    feature(i);
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-fleet"
      data-screen-label="01 Fleet"
      role="tabpanel"
      aria-labelledby="tabbtn-fleet"
    >
      <Hero
        hosts={hosts}
        featured={clamped}
        onFeature={feature}
        heroOn={heroOn}
        waveformOn={waveformOn}
      />

      <div className="sec">
        <span className="num">01</span>
        <b>Fleet</b>
        <span className="right">{isLoading ? "polling…" : "tap to expand"}</span>
      </div>

      <div className="devs" id="devices">
        {error && <div className="no-svc">// backend unreachable — {(error as Error).message}</div>}
        {!error && !hosts.length && !isLoading && (
          <div className="no-svc">// no hosts in config.yaml</div>
        )}
        {hosts.map((h, i) => (
          <DeviceRow
            key={h.id}
            host={h}
            services={svcByHost.get(h.id) ?? []}
            index={i}
            featured={i === clamped}
            open={open.has(h.id)}
            busy={busy.has(h.id)}
            onToggle={() => toggle(h.id, i)}
            onAction={(action) => run(action, h)}
          />
        ))}
      </div>

      <FleetSummary hosts={hosts} pollSeconds={poll} />

      <div style={{ height: 20 }} />
    </div>
  );
}
