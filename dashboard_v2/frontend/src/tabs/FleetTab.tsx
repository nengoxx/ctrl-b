import { useEffect, useState } from "react";

import { DeviceRow } from "../components/DeviceRow";
import { FleetSummary } from "../components/FleetSummary";
import { Hero } from "../components/Hero";
import { useHosts, useServerInfo } from "../hooks/useFleet";
import { useUI } from "../store/ui";

// The ⭐ Phase 1 deliverable: the Vapor Fleet tab wired to the live API. Owns `featured`
// (auto-cycles among online hosts, like vapor.html) + the open-row set.

interface Props {
  active: boolean;
}

export function FleetTab({ active }: Props) {
  const { heroOn, waveformOn } = useUI();
  const { data: server } = useServerInfo();
  const poll = server?.poll_seconds ?? 5;
  const { data: hosts = [], isLoading, error } = useHosts(poll);

  const [featured, setFeatured] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Keep featured in range as the fleet changes.
  const clamped = hosts.length ? Math.min(featured, hosts.length - 1) : 0;

  // Auto-cycle the featured host among those online (6s), matching the prototype.
  useEffect(() => {
    const id = setInterval(() => {
      setFeatured((f) => {
        const onIdx = hosts.map((h, i) => (h.status?.online ? i : -1)).filter((i) => i >= 0);
        if (!onIdx.length) return f;
        const cur = onIdx.indexOf(f);
        return onIdx[(cur + 1) % onIdx.length];
      });
    }, 6000);
    return () => clearInterval(id);
  }, [hosts]);

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
            index={i}
            featured={i === clamped}
            open={open.has(h.id)}
            onToggle={() => toggle(h.id, i)}
          />
        ))}
      </div>

      <FleetSummary hosts={hosts} pollSeconds={poll} />

      <div style={{ height: 20 }} />
    </div>
  );
}
