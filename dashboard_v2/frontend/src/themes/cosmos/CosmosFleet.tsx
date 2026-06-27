import { useFleet } from "../../hooks/useFleet";
import type { Service } from "../../types";
import { present } from "./present";

// The cosmos orbital FleetView (C2) — the theme's signature surface, slotted into DefaultRoot's `Fleet`
// prop (CosmosRoot passes it). C2a: a STATIC solar system — each host is a DOM planet (free hit-testing +
// focus + a11y; canvas would only win at hundreds of nodes, per the rendering research) placed by
// `present()` (golden-angle), sized by service health, colored + tappable. A PURE CONSUMER of the headless
// `useFleet` controller — same hosts/services/featured data as vapor's FleetTab, zero new data plumbing.
// C2b adds the orbit animation (compositor rotate on `.cosmos-solar`, gated by the cosmos motion settings)
// + the planet indicators (breathing-pulse latency, moons/arc for services); C3 opens a bottom sheet on tap.

const BASE_SIZE = 48; // planet diameter (px) at full service health
const MIN_HEALTH_SCALE = 0.58; // a host with ALL services down shrinks to this fraction (size = health)

function serviceHealth(services: Service[]): number {
  if (!services.length) return 1; // no declared services → full size (nothing to be missing)
  return services.filter((s) => s.status?.online).length / services.length;
}

export function CosmosFleet({ active }: { active: boolean }) {
  const { hosts, svcByHost, featured, feature, isLoading, error } = useFleet();

  return (
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-fleet"
      data-screen-label="01 Fleet"
      role="tabpanel"
      aria-labelledby="tabbtn-fleet"
    >
      <div className="cosmos-stage">
        <div className="cosmos-core" aria-hidden />
        {/* `.cosmos-solar` is the orbit origin (stage center); C2b rotates THIS element. */}
        <div className="cosmos-solar">
          {hosts.map((host, i) => {
            const enc = present(host, i);
            const { angle, radius } = enc.position as { angle: number; radius: number };
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            const services = svcByHost.get(host.id) ?? [];
            const upCount = services.filter((s) => s.status?.online).length;
            const size = Math.round(BASE_SIZE * (MIN_HEALTH_SCALE + (1 - MIN_HEALTH_SCALE) * serviceHealth(services)));
            const online = !!host.status?.online;
            return (
              <button
                key={host.id}
                type="button"
                className={"cosmos-planet" + (online ? " on" : " off") + (i === featured ? " sel" : "")}
                style={{
                  transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                  width: `${size}px`,
                  height: `${size}px`,
                  fontSize: `${Math.round(size * 0.42)}px`, // symbol scales with the planet (.sym = 1em)
                  // The planet's coin color (present() hashes it from host id); read by cosmos.css.
                  ["--planet" as string]: enc.color,
                }}
                onClick={() => feature(i)}
                aria-pressed={i === featured}
                aria-label={
                  `${host.name} — ${online ? "online" : "asleep"}` +
                  (services.length ? `, ${upCount}/${services.length} services up` : "")
                }
              >
                <span className="sym" aria-hidden>
                  {enc.symbol}
                </span>
              </button>
            );
          })}
        </div>

        {error && <div className="no-svc cosmos-msg">// backend unreachable — {error.message}</div>}
        {!error && !hosts.length && !isLoading && (
          <div className="no-svc cosmos-msg">// no hosts in config.yaml</div>
        )}
      </div>
    </div>
  );
}
