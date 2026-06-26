import { DeviceRow } from "../components/DeviceRow";
import { FleetSummary } from "../components/FleetSummary";
import { Hero } from "../components/Hero";
import { useFleet } from "../hooks/useFleet";
import { useThemeSetting } from "../theme-engine/settings";

// The ⭐ Phase 1 deliverable: the Vapor Fleet tab. M2 (D29 §14.2) made this a PURE CONSUMER of the
// headless `useFleet` controller — all the carousel/expand state + the auto-advance engine now live in
// the controller (store-backed) + App, so other themes' FleetViews reuse them. This component is now
// just vapor's presentation.

interface Props {
  active: boolean;
}

export function FleetTab({ active }: Props) {
  // heroOn/waveformOn are vapor's per-theme settings (M3 §14.3) — resolved against vapor's declared
  // ThemeDef.settings defaults (FleetTab is a vapor-only component, so reading "vapor" directly is correct).
  const heroOn = useThemeSetting<boolean>("vapor", "heroOn");
  const waveformOn = useThemeSetting<boolean>("vapor", "waveformOn");
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
