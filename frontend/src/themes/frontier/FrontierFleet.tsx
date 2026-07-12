import { useEffect } from "react";

import { useFleet } from "../../hooks/useFleet";
import { setFrontierSelection, useFrontierSelection } from "../../store/frontierSelection";
import { ART, assets } from "./art";
import { present } from "./present";

// The frontier badlands Fleet (F2, D29 §14.4) — the theme's bespoke signature surface, injected into
// DefaultRoot's `fleet` body slot (FrontierRoot passes it). A hero MAP card with each host as a scattered
// beacon, over a 2-col rig grid — the prototype's `.map`/`.beacon`/`.rigs`, ported to real data. A PURE
// CONSUMER of the headless `useFleet` controller (same hosts data as every other Fleet) + the manual
// `frontierSelection` store (the owner directive: the bespoke fleets ignore the global auto-cycle and track
// their own selection). Placement + presentation come from `present()` (R2 scatter, indexed rig art, plate).
//
// Deliberately STATIC layout — no canvas, no ResizeObserver/measurement (the map is a fixed-height card, the
// grid is CSS): pure math that renders safely in jsdom (the B2 contract test mounts this). The sweep + beacon
// ping are CSS-only and gated by data-motion in frontier.css; off-tab the panel is display:none, so they cost
// nothing when hidden — no JS motion-gating needed here (unlike cosmos's WAAPI orbit).

export function FrontierFleet({ active }: { active: boolean }) {
  const { hosts, isLoading, error } = useFleet();
  const selected = useFrontierSelection();

  // Clear a selection whose host has left the fleet (config change / removal) — no stale `.sel` ghost, and
  // F3's sheet (which reads this store) won't reference a gone host. Mirrors the cosmos precedent.
  useEffect(() => {
    if (selected && !hosts.some((h) => h.id === selected)) setFrontierSelection(null);
  }, [selected, hosts]);

  // Resolve each host's placement + presentation ONCE per hosts array (a plain map, like CosmosFleet): R2 is
  // deterministic, so beacons never jitter across the 5s poll. `present` maps the host's own appearance blob.
  const placements = hosts.map((host, i) => {
    const enc = present(host, i, host.appearance?.frontier);
    const { x, y } = enc.position as { x: number; y: number };
    return {
      host,
      x,
      y,
      art: assets[enc.asset as string], // asset is a validated rig key → its hashed URL
      plate: enc.plate as string,
      online: !!host.status?.online,
    };
  });
  const onlineCount = placements.filter((p) => p.online).length;

  // The label subtitle honestly reflects the fleet; while the first poll is in flight (no hosts yet) it reads
  // as a scan so the fixed-height card renders immediately with no layout jump (the loading state).
  const subtitle =
    isLoading && hosts.length === 0
      ? "scanning the badlands…"
      : `${hosts.length} rigs staked across the badlands`;

  return (
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-fleet"
      data-screen-label="01 frontier"
      role="tabpanel"
      aria-labelledby="tabbtn-fleet"
    >
      {/* THE MAP — always rendered (even at zero hosts: hero + an honest "0 live"), fixed height so the
          initial/loading paint never jumps. */}
      <div className="frontier-map">
        <div className="pic" style={{ backgroundImage: `url(${ART.hero})` }} />
        <div className="scrim" />
        <div className="frontier-sweep" aria-hidden />

        <div className="frontier-map-label">
          <div className="t">THE FRONTIER</div>
          <div className="s">{subtitle}</div>
        </div>
        <div className="frontier-count">
          <span className="led" />
          {onlineCount} live
        </div>

        {placements.map((p) => {
          const isSel = p.host.id === selected;
          return (
            <button
              type="button"
              key={p.host.id}
              className={"frontier-beacon" + (p.online ? "" : " off") + (isSel ? " sel" : "")}
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
              onClick={() => setFrontierSelection(isSel ? null : p.host.id)}
              aria-pressed={isSel}
              aria-label={`${p.host.name} — ${p.online ? "online" : "asleep"}`}
            >
              <span className="pin">
                {/* ping ring: online only (fewer live layers when asleep); animation is data-motion-gated */}
                {p.online && <span className="ring" aria-hidden />}
                <span className="dot" />
              </span>
              <span className="tag">{p.host.name}</span>
            </button>
          );
        })}
      </div>

      {/* THE RIG GRID — or one of the three explicit states (cosmos precedent). Error + empty replace the
          grid; while the FIRST poll is in flight nothing renders below the map (its subtitle already reads
          "scanning…" — an empty grid under a "tap to select" header would be dishonest chrome, audit F2).
          The map card above always stands, so the surface never blanks. */}
      {error ? (
        <div className="frontier-msg">// backend unreachable — {error.message}</div>
      ) : !hosts.length ? (
        !isLoading && <div className="frontier-msg">// no rigs in config.yaml</div>
      ) : (
        <>
          <div className="kit-sec">
            <span className="t">Your Rigs</span>
            <span className="grow" />
            <span className="hint">tap to select</span>
          </div>
          <div className="frontier-rigs">
            {placements.map((p) => {
              const isSel = p.host.id === selected;
              return (
                <button
                  type="button"
                  key={p.host.id}
                  className={"frontier-rig" + (p.online ? " on" : " dim") + (isSel ? " sel" : "")}
                  onClick={() => setFrontierSelection(isSel ? null : p.host.id)}
                  aria-pressed={isSel}
                  aria-label={`${p.host.name} — ${p.online ? "online" : "asleep"}`}
                >
                  <span className="led" aria-hidden />
                  <div className="art" style={{ backgroundImage: `url(${p.art})` }} />
                  <span className="plate">{p.plate}</span>
                  <div className="meta">
                    <div className="nm">{p.host.name}</div>
                    <div className="ro">{p.host.role ?? p.host.os_type}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div style={{ height: 16 }} />
    </div>
  );
}
