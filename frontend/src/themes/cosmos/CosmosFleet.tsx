import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { BottomSheet } from "../../components/BottomSheet";
import type { Host } from "../../types";
import { useFleet } from "../../hooks/useFleet";
import { CosmosHostDetail } from "./CosmosHostDetail";
import { setCosmosSelection, useCosmosSelection } from "../../store/cosmosSelection";
import { getSheetSnap, setSheetSnap } from "../../store/sheetSnap";
import type { SheetDetent } from "../../components/BottomSheet";
import { useCosmosDive } from "../../store/cosmosDive";
import { setPlanSheetOpen } from "../../store/planSheet";
import { useTabActive, useUISlice } from "../../store/ui";
import { useThemeSetting } from "../../theme-engine/settings";
import { useCameraFollow } from "./camera";
import { CosmosMoon } from "./CosmosMoon";
import { livenessParts, pulsePeriodMs } from "./liveness";
import { orbitPlaybackRate } from "./motion";
import {
  moonOrbits,
  serviceCue,
  visualMoonCounts,
  type ServiceCue,
  type ServiceCueMode,
} from "./serviceCue";
import {
  decorOrbitSpec,
  orbitParams,
  useCosmosOrbit,
  type OrbitStyle,
  type OrbitTarget,
} from "./orbit";
import { decorativePlanetSize, planetSize, present, serviceHealth } from "./present";
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

// Persisted host-detail sheet detent (ISSUES #1): a stable key into the shared, theme-agnostic `sheetSnap`
// store + a stable module-level setter (so `onSnapChange` keeps a constant identity per the prop's contract).
const SHEET_KEY = "cosmos-host-detail";
const persistSheetSnap = (snap: SheetDetent) => setSheetSnap(SHEET_KEY, snap);
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
  // CONFIG (YAML) order, opting out of the self-first default (owner 2026-07-12): cosmos composes by
  // planet SIZE (services × health), and a service-heavy self planet on the innermost orbit reads wrong —
  // the owner curates the visual rhythm via the `computers:` YAML order instead (small first, etc.).
  // Safe here alone: cosmos is manual-selection and never reads the shared `featured` index (see useFleet).
  const { hosts, svcByHost, isLoading, error, run, busy } = useFleet("config");
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
  // The chrome mode — so the live-zone measure re-runs when the appbar appears/disappears (toggling to/from
  // `minimal` adds/removes `.kit-appbar`, which the stage ResizeObserver wouldn't otherwise catch → stale
  // layout that reserves the old appbar space).
  const appbarMode = useUISlice((s) => s.appbarMode);
  const orbitStyle = useThemeSetting<string>("cosmos", "orbitStyle") as OrbitStyle;
  const speed = useThemeSetting<string>("cosmos", "motionSpeed");
  const live = livenessParts(useThemeSetting<string>("cosmos", "liveness"));
  // serviceCue mode (a legacy "auto" → "data"); validated to the union so an odd stored value is safe.
  const cueRaw = useThemeSetting<string>("cosmos", "serviceCue");
  const cueMode: ServiceCueMode = cueRaw === "off" || cueRaw === "visual" ? cueRaw : "data";
  // Visual mode: a fleet-wide decorative assignment (3 moons total — one host 2, one host 1, rest 0). The
  // salt re-rolls the pick each page load (random per refresh) but is fixed for the session (lazy useState),
  // so it never jitters across the 5s-poll re-renders.
  const [moonSalt] = useState(() =>
    typeof Math.random === "function" ? Math.random().toString(36).slice(2) : "",
  );
  const visualCounts =
    cueMode === "visual"
      ? visualMoonCounts(
          hosts.map((h) => h.id),
          moonSalt,
        )
      : null;
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
  // Store the RAW geometry (not a pre-baked offsetY) so the sheet-aware lift can re-derive the center each
  // render without re-measuring: `liveH` (closed zone) feeds fitScale unchanged; the rest feeds offsetY.
  const [layout, setLayout] = useState({
    w: 0,
    liveH: 0,
    liveTop: 0,
    liveBottomClosed: 0,
    stageTop: 0,
    stageH: 0,
    innerH: 0,
  });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const s = el.getBoundingClientRect();
      const appbar = document.querySelector(".kit-appbar");
      const composer = document.querySelector(".kit-composer");
      const liveTop = appbar ? Math.max(0, appbar.getBoundingClientRect().bottom - s.top) : 0;
      const liveBottomClosed = composer ? composer.getBoundingClientRect().top - s.top : s.height;
      const liveH = Math.max(0, liveBottomClosed - liveTop);
      setLayout({
        w: s.width,
        liveH,
        liveTop,
        liveBottomClosed,
        stageTop: s.top,
        stageH: s.height,
        innerH: window.innerHeight,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const appbar = document.querySelector(".kit-appbar");
    if (appbar) ro.observe(appbar);
    const composer = document.querySelector(".kit-composer");
    if (composer) ro.observe(composer);
    return () => ro.disconnect();
    // Re-measure + re-observe when the appbar appears/disappears (minimal mode) so the system uses the
    // freed height instead of reserving the old appbar band.
  }, [appbarMode]);

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
      ping: host.status?.ping_ms ?? null,
      services,
      upCount,
      // Size = the cue's third channel (owner 2026-07-12): truthful in `data` (services × health),
      // the decorative golden ladder in `visual`/`off` — no service info leaks through size there.
      size:
        cueMode === "data"
          ? planetSize(services.length, serviceHealth(upCount, services.length))
          : decorativePlanetSize(i),
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
    ...placements.map((p) => ({
      key: p.host.id,
      spec: orbitParams(p.index, p.radius, orbitStyle),
    })),
    { key: "__pluto", spec: decorOrbitSpec(DECOR_PLANET.angle, decorRadius) },
  ];
  const { register, animationsRef } = useCosmosOrbit(targets, animate, playbackRate);

  // C3 bottom sheet — open when the Fleet tab is showing AND a planet is selected. `displayHost` retains the
  // last host through the slide-OUT so the content doesn't blank while the sheet eases closed (selected→null).
  // `body[data-sheet=open]` drives the scoped cosmos rule that hides the Kit composer while the sheet is up.
  const selectedHost = selected ? (hosts.find((h) => h.id === selected) ?? null) : null;
  const sheetOpen = active && !!selectedHost;
  const titleId = useId();
  const [sheetH, setSheetH] = useState(0); // the sheet's resting height (reported by <BottomSheet>) for the lift
  const [displayHost, setDisplayHost] = useState<Host | null>(null);
  useEffect(() => {
    if (selectedHost) setDisplayHost(selectedHost);
  }, [selectedHost]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (sheetOpen) document.body.dataset.sheet = "open";
    else delete document.body.dataset.sheet;
    return () => {
      delete document.body.dataset.sheet;
    };
  }, [sheetOpen]);
  // When the host detail sheet opens, collapse the composer plan sheet (D30) — otherwise it pokes out above
  // the host sheet. Its close is a downward slide+fade, so it slides away in step with the kit composer
  // (which cosmos hides via body[data-sheet=open] above). Cosmos drives this since it owns the host sheet;
  // the plan sheet is kit chrome (so this reaches into the kit `planSheet` store, which cosmos already does
  // for the moon-dive). The pill rides inside the composer, so it hides with it.
  useEffect(() => {
    if (sheetOpen) setPlanSheetOpen(false);
  }, [sheetOpen]);

  // Sheet-aware camera lift (C3b): when the sheet is open it covers the lower stage, so move the live-zone
  // BOTTOM up to the sheet's resting top (innerH − sheetH) and re-center — lifting the focused planet into the
  // clear gap above the sheet (the prototype's "focused ≈ upper area" feel). fitScale stays on the CLOSED zone
  // (above), so the zoom magnification — the planet's on-screen SIZE — never changes when the sheet opens; only
  // the vertical centre shifts. Pure per-render math; the camera rAF just reads the resulting centerOffsetY,
  // so there's no per-frame layout work. The camera eases between the two centres via its existing damping.
  const liveBottom =
    sheetOpen && sheetH ? layout.innerH - sheetH - layout.stageTop : layout.liveBottomClosed;
  const offsetY = layout.stageH ? (layout.liveTop + liveBottom) / 2 - layout.stageH / 2 : 0;

  // Camera zoom-follow (C2b-2): selecting a planet eases the camera to center + track it (reads the orbit
  // animation's currentTime analytically). The hook owns `.cosmos-camera`'s transform (fit-scale + zoom).
  const cameraRef = useRef<HTMLDivElement>(null);
  const specByKey = new Map(targets.map((t) => [t.key, t.spec]));
  const diving = useCosmosDive();
  useCameraFollow(cameraRef, {
    active,
    selected,
    specByKey,
    animationsRef,
    fitScale,
    zoomMult: FOLLOW_ZOOM,
    centerOffsetY: offsetY,
    orbitAnimating: animate,
    dive: diving,
  });

  return (
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-fleet"
      data-screen-label="01 Fleet"
      role="tabpanel"
      aria-labelledby="tabbtn-fleet"
    >
      {/* Tap empty sky → clear selection (close the sheet). Only a DIRECT stage-background click counts
          (target === the stage div) — a planet/moon click has a deeper target, so it reaches the planet and
          SWAPS selection (or the moon clears it) instead of being swallowed. This is why cosmos passes
          `catchOutside={false}` to the sheet — the orbital stage stays interactive behind it. */}
      <div
        className={"cosmos-stage" + (diving ? " diving" : "")}
        ref={stageRef}
        onClick={(e) => {
          if (e.target === e.currentTarget) setCosmosSelection(null);
        }}
      >
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
                  {/* liveness (C2b-3): glow/ring behind the coin for ONLINE planets only, gated by the
                      `liveness` setting; cosmos.css gates the animation on the global Motion lever. */}
                  {p.online && live.pulse && (
                    <span
                      className="cosmos-pulse"
                      aria-hidden
                      style={{ ["--pulse-dur" as string]: `${pulsePeriodMs(p.ping)}ms` }}
                    />
                  )}
                  {p.online && live.halo && <span className="cosmos-halo" aria-hidden />}
                  <ServiceCueLayer
                    cue={serviceCue(p.services, cueMode, visualCounts?.get(p.host.id) ?? 0)}
                    size={p.size}
                    seed={p.index}
                  />
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

      {/* C3 host-detail sheet — rendered OUTSIDE `.cosmos-stage`/`.cosmos-camera` (the camera owns its own
          transform; the sheet is fixed-positioned and must not be clipped by the stage's overflow). C3a
          ships the glass/dotted/rounded primitive + placeholder content; C3b swaps in CosmosHostDetail. */}
      <BottomSheet
        open={sheetOpen}
        onClose={() => setCosmosSelection(null)}
        labelledBy={titleId}
        closeLabel="Close host detail"
        catchOutside={false}
        onHeightChange={setSheetH}
        initialSnap={getSheetSnap(SHEET_KEY)}
        onSnapChange={persistSheetSnap}
      >
        {/* `selectedHost ?? displayHost`: live host while open (so polls update the sheet), the retained last
            host through the slide-out (so content doesn't blank as it eases closed). */}
        {(selectedHost ?? displayHost) && (
          <CosmosHostDetail
            host={(selectedHost ?? displayHost)!}
            services={svcByHost.get((selectedHost ?? displayHost)!.id) ?? []}
            busy={busy.has((selectedHost ?? displayHost)!.id)}
            run={run}
            titleId={titleId}
          />
        )}
      </BottomSheet>
    </div>
  );
}

// Service cue (C2b-4): the moon/ring cue drawn on a planet — orbiting moons or a fill-ring. Children of the
// planet button, so they orbit the moon with it; positioned/styled by cosmos.css. Each moon rides a rotating
// "arm" (transform-origin = planet center) — the arm spins (Motion-gated; cosmos.css), the dot is pinned at
// its radius. Start angle = the arm's static `rotate(phase)` (reduced-motion) and, when animating, its
// negative animation-delay; a host's two moons still read as distinct (different radii + periods + some
// counter-orbit). The ring is static, full-circle, width = up-fraction.
const ARC_R = 46; // SVG ring radius in the 0..100 viewBox
const ARC_W_MIN = 1.2; // ring stroke-width when all services are down
const ARC_W_MAX = 4; // ring stroke-width when all services are up (thinner overall than before)

function ServiceCueLayer({ cue, size, seed }: { cue: ServiceCue; size: number; seed: number }) {
  if (cue.kind === "moons") {
    return (
      <>
        {moonOrbits(cue.states, size / 2, seed).map((m, i) => (
          <span
            key={i}
            aria-hidden
            className="cosmos-moon-arm"
            style={{
              transform: `rotate(${m.phaseDeg}deg)`, // static phase (reduced-motion)
              animationDuration: `${m.durMs}ms`,
              animationDelay: `${-(m.phaseDeg / 360) * m.durMs}ms`, // animated phase
              animationDirection: m.dir === -1 ? "reverse" : "normal", // some moons counter-orbit
            }}
          >
            <span
              className={"cosmos-moon" + (m.up ? " up" : "")}
              style={{ transform: `translate(-50%, -50%) translateY(-${m.r.toFixed(1)}px)` }}
            />
          </span>
        ))}
      </>
    );
  }
  if (cue.kind === "arc") {
    const frac = cue.total ? cue.up / cue.total : 0;
    const w = ARC_W_MIN + (ARC_W_MAX - ARC_W_MIN) * frac; // full ring; width encodes up-fraction
    return (
      <svg className="cosmos-arc" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={ARC_R} style={{ strokeWidth: w.toFixed(2) }} />
      </svg>
    );
  }
  return null;
}
