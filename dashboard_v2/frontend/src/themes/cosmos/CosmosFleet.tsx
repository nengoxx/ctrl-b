import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useFleet } from "../../hooks/useFleet";
import { setCosmosSelection, useCosmosSelection } from "../../store/cosmosSelection";
import { useTabActive, useUISlice } from "../../store/ui";
import { useThemeSetting } from "../../theme-engine/settings";
import { useCameraFollow } from "./camera";
import { CosmosMoon } from "./CosmosMoon";
import { orbitPlaybackRate } from "./motion";
import { decorOrbitSpec, orbitParams, useCosmosOrbit, type OrbitStyle, type OrbitTarget } from "./orbit";
import { planetSize, present, serviceHealth } from "./present";
import { Rune } from "./runes";

// The cosmos orbital FleetView (C2) — the theme's signature surface, slotted into DefaultRoot's `Fleet`
// prop (CosmosRoot passes it). A STATIC solar system: each host is a DOM planet (free hit-testing + focus +
// a11y; canvas would only win at hundreds of nodes, per the rendering research) placed by `present()`
// (golden-angle), SIZED by service count × health (planetSize), colored + glyphed, on a few faint ambient
// rings. A PURE CONSUMER of the headless `useFleet` controller — same hosts/services data as vapor's
// FleetTab. Selection is MANUAL (owner directive): cosmos ignores the global auto-cycle `featured` and uses
// its own `cosmosSelection` store (tap a planet to select; tap the moon to clear).
//
// C2b adds the orbit animation (compositor rotate on `.cosmos-solar`) + indicators (breathing-pulse
// latency, service moons/arc) + camera zoom-follow on select; C3 opens a bottom sheet on the selected host.

// A purely DECORATIVE outer planet — a "Pluto": not a host, just ambiance. Non-interactive (aria-hidden,
// pointer-events: none); reuses the .cosmos-planet coin look via a non-button span, colored the palette
// red. Named consts so it's easy to retune/remove. Its orbit sits a fixed GAP beyond the outermost real
// planet, with a floor so it's clearly outer even for a tiny fleet — so it fits in view when there's room
// and only extends past the edge if a large fleet leaves no space (owner directive). Angled into the open
// upper-left. (C2b's fit-to-stage scale will rescale the whole system for large fleets.)
const DECOR_PLANET = { color: "#ff5a6a", angle: 3.9, size: 16 };
const DECOR_MIN_RADIUS = 150; // keep it visibly outer even for a 1–2 host fleet
const DECOR_GAP = 45; // clearance beyond the outermost real planet's orbit

// Fit-to-stage scale (the "scale-to-fit" pattern; the prototype's `fit = min(vw,vh)/…` generalized so it
// also scales UP on a big desktop viewport, not just down). The fixed-px system is tuned for a ~390px
// phone; on a large viewport it would sit tiny in the empty stage, so we measure the stage and scale the
// whole system to fill the smaller dimension. C2b's camera (orbit rotate + zoom-follow) composes onto this.
// Per-axis fill fractions (independent margins). Phone is WIDTH-bound (tall live zone) → FILL_W governs it;
// desktop is HEIGHT-bound (short, wide live zone) → FILL_H governs it. FILL_H is the smaller value so the
// desktop keeps top/bottom padding within the live zone — phone is unaffected (width still binds).
const FIT_FILL_W = 0.95; // fraction of stage WIDTH the system spans
const FIT_FILL_H = 0.85; // fraction of the LIVE-ZONE height the system spans (top/bottom padding)
const FIT_MIN = 0.4; // never shrink below this (very small stage / huge fleet still legible)
const FIT_MAX = 2.2; // never blow up past this on a giant monitor
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const FOLLOW_ZOOM = 2.2; // selected planet's camera scale = fitScale × this (C2b-2 zoom-follow)

export function CosmosFleet({ active }: { active: boolean }) {
  const { hosts, svcByHost, isLoading, error } = useFleet();
  const selected = useCosmosSelection();

  // Clear a selection whose host has left the fleet (config change / removal) — so the camera eases back to
  // idle and no stale `.sel` ghost lingers.
  useEffect(() => {
    if (selected && !hosts.some((h) => h.id === selected)) setCosmosSelection(null);
  }, [selected, hosts]);

  // Orbit gating (mirrors the starfield, §14.11): animate only when the GLOBAL Motion lever is "full" AND
  // the orbit isn't set to "off" AND the Fleet tab is showing AND the PWA isn't backgrounded. Reduced-motion
  // (motion !== "full") always wins. Tempo (playbackRate) is live-tunable without rebuilding the animations.
  const motion = useUISlice((s) => s.motion);
  const orbitStyle = useThemeSetting<string>("cosmos", "orbitStyle") as OrbitStyle;
  const speed = useThemeSetting<string>("cosmos", "motionSpeed");
  const onFleet = useTabActive("fleet");
  const [docVisible, setDocVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  useEffect(() => {
    const on = () => setDocVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  const animate = motion === "full" && orbitStyle !== "off" && onFleet && docVisible;
  const playbackRate = orbitPlaybackRate(speed);

  // Measure the LIVE ZONE so the system fits + centers between the chrome, even though the stage itself is
  // full-bleed (it bleeds behind the appbar/composer for continuity + glass, but the system must sit in the
  // clear area between them — not page-centered, which would tuck planets behind the composer). We measure
  // the stage + the Kit's appbar/composer rects (the chrome publishes --appbar-h/--composer-h for exactly
  // this alignment) and derive the live height + the vertical offset to the live-zone center. A synchronous
  // first measure avoids a pop; the ResizeObserver tracks stage resize AND composer growth (textarea).
  const stageRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ w: 0, liveH: 0, offsetY: 0 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const s = el.getBoundingClientRect();
      const appbar = document.querySelector(".kit-appbar");
      const composer = document.querySelector(".kit-composer");
      const liveTop = appbar ? Math.max(0, appbar.getBoundingClientRect().bottom - s.top) : 0;
      const liveBottom = composer ? composer.getBoundingClientRect().top - s.top : s.height;
      const liveH = Math.max(0, liveBottom - liveTop);
      const offsetY = (liveTop + liveBottom) / 2 - s.height / 2; // lift the system to the live-zone center
      setLayout({ w: s.width, liveH, offsetY });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const appbar = document.querySelector(".kit-appbar");
    if (appbar) ro.observe(appbar);
    const composer = document.querySelector(".kit-composer");
    if (composer) ro.observe(composer);
    return () => ro.disconnect();
  }, []);

  // Resolve each host's placement + presentation once.
  const placements = hosts.map((host, i) => {
    const enc = present(host, i);
    const { angle, radius } = enc.position as { angle: number; radius: number };
    const services = svcByHost.get(host.id) ?? [];
    const upCount = services.filter((s) => s.status?.online).length;
    return {
      host,
      index: i,
      color: enc.color,
      symbol: enc.symbol,
      radius,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      online: !!host.status?.online,
      services,
      upCount,
      size: planetSize(services.length, serviceHealth(upCount, services.length)),
    };
  });

  // Pluto's orbit: a fixed gap beyond the outermost real planet, floored so it's always clearly outer.
  const maxHostRadius = placements.reduce((m, p) => Math.max(m, p.radius), 0);
  const decorRadius = Math.max(DECOR_MIN_RADIUS, maxHostRadius + DECOR_GAP);
  // One orbit ring per planet, sized to ITS orbit radius (so each planet sits on its ring) — plus the
  // decorative Pluto's outer orbit. The golden-angle layout makes each radius distinct.
  const ringRadii = [...placements.map((p) => p.radius), decorRadius];
  const decorX = Math.cos(DECOR_PLANET.angle) * decorRadius;
  const decorY = Math.sin(DECOR_PLANET.angle) * decorRadius;

  // System extent (center → outermost edge) = Pluto's orbit + its half-size; scale to fill the smaller of
  // the stage WIDTH and the LIVE-ZONE height (so the whole system, incl Pluto's orbit, fits in the clear
  // area and isn't cropped behind the composer). Falls back to 1 until measured (no pre-measure flash).
  const contentRadius = decorRadius + DECOR_PLANET.size / 2;
  const fitScale =
    layout.w && layout.liveH
      ? clamp(
          Math.min(layout.w * FIT_FILL_W, layout.liveH * FIT_FILL_H) / (2 * contentRadius),
          FIT_MIN,
          FIT_MAX,
        )
      : 1;

  // Orbit targets — each host (spec from orbitParams) + the decorative Pluto. The hook drives a WAAPI
  // translate animation on each registered element; each animation's frame 0 == the static (x,y) used below,
  // so freeze ↔ animate is seamless. `register(key)` returns a stable ref-callback per element.
  const targets: OrbitTarget[] = [
    ...placements.map((p) => ({ key: p.host.id, spec: orbitParams(p.index, p.radius, orbitStyle) })),
    { key: "__pluto", spec: decorOrbitSpec(DECOR_PLANET.angle, decorRadius) },
  ];
  const { register, animationsRef } = useCosmosOrbit(targets, animate, playbackRate);

  // Camera zoom-follow (C2b-2): selecting a planet eases the camera to center + track it (reads the orbit
  // animation's currentTime analytically). The hook owns `.cosmos-camera`'s transform (fit-scale + zoom).
  const cameraRef = useRef<HTMLDivElement>(null);
  const specByKey = new Map(targets.map((t) => [t.key, t.spec]));
  useCameraFollow(cameraRef, {
    active,
    selected,
    specByKey,
    animationsRef,
    fitScale,
    zoomMult: FOLLOW_ZOOM,
    centerOffsetY: layout.offsetY,
    orbitAnimating: animate,
  });

  return (
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-fleet"
      data-screen-label="01 Fleet"
      role="tabpanel"
      aria-labelledby="tabbtn-fleet"
    >
      <div className="cosmos-stage" ref={stageRef}>
        {/* `.cosmos-camera` carries ONE transform (fit-to-stage scale + the zoom-follow translate) for the
            whole system — moon + orbits — so they scale together. useCameraFollow owns that transform
            imperatively (no React inline transform → no fight); the moon stays here, the orbiting planets
            are in `.cosmos-solar`. */}
        <div className="cosmos-camera" ref={cameraRef}>
          <CosmosMoon />
          {/* `.cosmos-solar` is the orbit origin (camera center); C2b rotates THIS element. */}
          <div className="cosmos-solar">
            {/* one faint orbit ring per planet, sized to its orbit radius (each planet sits on its ring) */}
            {ringRadii.map((r, i) => (
              <div
                key={"orbit-" + i}
                className="cosmos-orbit"
                aria-hidden
                style={{ width: `${Math.round(2 * r)}px`, height: `${Math.round(2 * r)}px` }}
              />
            ))}
            {/* decorative outer "Pluto" — non-interactive ambiance, reuses the planet coin look; orbits too */}
            <span
              ref={register("__pluto")}
              className="cosmos-planet decor"
              aria-hidden
              style={{
                transform: `translate(-50%, -50%) translate(${decorX}px, ${decorY}px)`,
                width: `${DECOR_PLANET.size}px`,
                height: `${DECOR_PLANET.size}px`,
                ["--planet" as string]: DECOR_PLANET.color,
              }}
            />
            {placements.map((p) => {
              const isSel = p.host.id === selected;
              return (
                <button
                  key={p.host.id}
                  ref={register(p.host.id)}
                  type="button"
                  className={"cosmos-planet" + (p.online ? " on" : " off") + (isSel ? " sel" : "")}
                  style={{
                    transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`,
                    width: `${p.size}px`,
                    height: `${p.size}px`,
                    fontSize: `${Math.round(p.size * 0.52)}px`, // rune glyph scales with the planet (.sym = 1em)
                    ["--planet" as string]: p.color, // index-based coin color from present(); read by cosmos.css
                  }}
                  onClick={() => setCosmosSelection(isSel ? null : p.host.id)}
                  aria-pressed={isSel}
                  aria-label={
                    `${p.host.name} — ${p.online ? "online" : "asleep"}` +
                    (p.services.length ? `, ${p.upCount}/${p.services.length} services up` : "")
                  }
                >
                  <Rune id={p.symbol} />
                </button>
              );
            })}
          </div>
        </div>

        {error && <div className="no-svc cosmos-msg">// backend unreachable — {error.message}</div>}
        {!error && !hosts.length && !isLoading && (
          <div className="no-svc cosmos-msg">// no hosts in config.yaml</div>
        )}
      </div>
    </div>
  );
}
