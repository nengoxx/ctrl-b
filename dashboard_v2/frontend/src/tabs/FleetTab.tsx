import { DeviceRow } from "../components/DeviceRow";
import { FleetSummary } from "../components/FleetSummary";
import { Hero } from "../components/Hero";
import { useFleet } from "../hooks/useFleet";
import { useUISlice } from "../store/ui";

// The ⭐ Phase 1 deliverable: the Vapor Fleet tab. M2 (D29 §14.2) made this a PURE CONSUMER of the
// headless `useFleet` controller — all the carousel/expand state + the auto-advance engine now live in
// the controller (store-backed) + App, so other themes' FleetViews reuse them. This component is now
// just vapor's presentation.

interface Props {
  active: boolean;
}

export function FleetTab({ active }: Props) {
  // heroOn/waveformOn are vapor-specific appearance toggles → still read from the ui store here.
  const heroOn = useUISlice((s) => s.heroOn);
  const waveformOn = useUISlice((s) => s.waveformOn);
  const { hosts, svcByHost, featured, open, poll, isLoading, error, busy, run, feature, toggleRow } =
    useFleet();

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
        featured={featured}
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
        {error && <div className="no-svc">// backend unreachable — {error.message}</div>}
        {!error && !hosts.length && !isLoading && (
          <div className="no-svc">// no hosts in config.yaml</div>
        )}
        {hosts.map((h, i) => (
          <DeviceRow
            key={h.id}
            host={h}
            services={svcByHost.get(h.id) ?? []}
            index={i}
            featured={i === featured}
            open={open.has(h.id)}
            busy={busy.has(h.id)}
            onToggle={() => toggleRow(h.id, i)}
            onAction={(action) => run(action, h)}
          />
        ))}
      </div>

      <FleetSummary hosts={hosts} pollSeconds={poll} />

      <div style={{ height: 20 }} />
    </div>
  );
}
