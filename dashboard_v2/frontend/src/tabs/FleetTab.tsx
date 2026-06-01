import { useEffect, useRef, useState } from "react";

import { DeviceRow } from "../components/DeviceRow";
import { FleetSummary } from "../components/FleetSummary";
import { Hero } from "../components/Hero";
import { useFleetActions } from "../hooks/useActions";
import { useHosts, useServerInfo } from "../hooks/useFleet";
import { useServices } from "../hooks/useServices";
import { useUI } from "../store/ui";
import type { Service } from "../types";

// The ⭐ Phase 1 deliverable: the Vapor Fleet tab wired to the live API. Owns `featured`
// (auto-cycles among online hosts, like vapor.html) + the open-row set.

interface Props {
  active: boolean;
}

export function FleetTab({ active }: Props) {
  const { heroOn, waveformOn } = useUI();
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
  useEffect(() => {
    const id = setInterval(() => {
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

  function toggle(id: string, i: number) {
    setFeatured(i);
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className={"tab" + (active ? " active" : "")} id="tab-fleet" data-screen-label="01 Fleet">
      <Hero
        hosts={hosts}
        featured={clamped}
        onFeature={setFeatured}
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
