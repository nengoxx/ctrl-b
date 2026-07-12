// The cosmos theme module (D29 §14.4 — the deep-space / orbital-fleet theme, T4). A BESPOKE theme: later
// slices give it its own Root with a starfield + an orbital FleetView (via `present()`), but it REUSES the
// Kit's chrome/Agent/Conf/Utils bodies (under `.kit`), colored entirely by its tokens.css — so cosmos =
// "Kit-reused everything + a bespoke orbital Fleet". C0 ships the palette + the scaffold (CosmosRoot →
// DefaultRoot); `present` + the Fleet land in C2.
//
// CSS + fonts are LAZY (loaded by switchTheme before the skin flips); dark-only for now (deep space).

import { planPlacementSetting } from "../../theme-engine/kit/composer/plan/placement";
import { composerLayoutSetting } from "../../theme-engine/kit/composer/setting";
import { preloadableRoot } from "../../theme-engine/lazyRoot";
import type { ThemeDef } from "../../theme-engine/types";
import { loadFonts } from "./fonts";
import { present } from "./present";

// Code-split the Root so the cosmos presentation — its bespoke starfield canvas + orbital Fleet (C1/C2) —
// never enters a vapor/minimal user's initial bundle; `loadRoot` (= preload) warms the chunk in switchTheme
// before the skin flips. `preloadableRoot` renders synchronously once loaded → no one-tick Suspense flash
// inside the View-Transition flushSync (see lazyRoot.ts). Only the descriptor stays in the initial bundle.
const { Root, preload } = preloadableRoot(() =>
  import("./CosmosRoot").then((m) => ({ default: m.CosmosRoot })),
);

export const cosmos: ThemeDef = {
  id: "cosmos",
  label: "Cosmos",
  Root,
  loadRoot: preload,
  // Dark-only for now; 4 named accent swatches (the prototype's --acc indirection). The Conf Appearance
  // picker auto-renders these as color chips via the shared Swatches component (planet-coin gradients).
  palettes: {
    modes: ["dark"],
    defaultMode: "dark",
    accents: [
      {
        id: "violet",
        label: "Violet",
        swatch: "radial-gradient(circle at 33% 28%, #d7d0ff, #7b66f0)",
      },
      { id: "cyan", label: "Cyan", swatch: "radial-gradient(circle at 33% 28%, #e0fbff, #56cfee)" },
      {
        id: "green",
        label: "Green",
        swatch: "radial-gradient(circle at 33% 28%, #d9fbe9, #4fd6a0)",
      },
      {
        id: "amber",
        label: "Amber",
        swatch: "radial-gradient(circle at 33% 28%, #ffe6ad, #ff9433)",
      },
    ],
    defaultAccent: "violet",
  },
  // Two stylesheets: the token map (semantic contract) + cosmos's bespoke structural CSS (deep-space
  // gradient, see-through Kit shell, starfield canvas). cosmos is a BESPOKE theme → entitled to structural
  // CSS beyond tokens (the vapor.css escape hatch); both are @scope([data-skin=cosmos]) @layer theme.
  loadStyles: () => Promise.all([import("./tokens.css"), import("./cosmos.css")]),
  loadFonts,
  // Per-theme settings (§14.3), auto-rendered in the Conf Appearance picker. The MASTER motion on/off is the
  // GLOBAL "Motion" lever (ui.motion, accessibility-aware) — cosmos does NOT duplicate it (there's no
  // "global motion on but cosmos off" case, since only the active theme renders). Cosmos owns only the
  // motion PARAMETERS: tempo + the orbit pattern (which includes "Off" to freeze just the orbit, keeping the
  // starfield + the global setting untouched).
  settings: {
    // The composer Surface (D31/A3) — the shared layout catalog; FIRST so it reads above theme rows.
    composer: composerLayoutSetting("stacked"),
    // Plan placement (D31/A4) — the shared inline/pinned catalog (default inline = the composer pill+sheet).
    planPlacement: planPlacementSetting("inline"),
    // Central-body style (C2a-fix) — two variants the owner compares live: the prototype's see-through "D"
    // coin (cutout) vs the matte ball with the D engraved into it (carved). Auto-rendered as a Seg.
    moonStyle: {
      type: "seg",
      label: "Moon",
      desc: "central body style",
      options: [
        { val: "cutout", label: "Cutout" },
        { val: "carved", label: "Carved" },
      ],
      default: "cutout",
    },
    motionSpeed: {
      type: "seg",
      label: "Motion speed",
      desc: "animation tempo",
      options: [
        { val: "calm", label: "Calm" },
        { val: "normal", label: "Normal" },
        { val: "lively", label: "Lively" },
      ],
      default: "normal",
    },
    // C2b: how the planets orbit — each at its own speed/direction (per-planet), all in lockstep (rigid), or
    // frozen (off — planets static, starfield still twinkles under the global Motion lever).
    orbitStyle: {
      type: "seg",
      label: "Orbit",
      desc: "planet motion",
      options: [
        { val: "perPlanet", label: "Per-planet" },
        { val: "rigid", label: "Rigid" },
        { val: "off", label: "Off" },
      ],
      default: "perPlanet",
    },
    // C2b-3: the online "alive" indicator — a breathing glow whose cadence = ping (Pulse), an expanding halo
    // ring (Halo), Both, or Off. Gated by the global Motion lever (reduced-motion → a static glow).
    liveness: {
      type: "seg",
      label: "Liveness",
      desc: "online indicator",
      options: [
        { val: "pulse", label: "Pulse" },
        { val: "halo", label: "Halo" },
        { val: "both", label: "Both" },
        { val: "off", label: "Off" },
      ],
      default: "pulse",
    },
    // C2b-4: the per-host moon/ring cue. Data = real per-service status (moons ≤2, lit=up / fill-ring ≥3).
    // Visual = decorative moons only (1–2 per planet, no rings, ignores data). Off = hidden.
    // MERGED 2026-07-12 (owner): planet SIZE is the cue's third channel — truthful (services × health)
    // in `data`; the decorative golden ladder (decorativePlanetSize) in `visual`/`off`, so those modes
    // show NO service information anywhere on the planet.
    serviceCue: {
      type: "seg",
      label: "Service cue",
      desc: "moons / ring / size",
      options: [
        { val: "data", label: "Data" },
        { val: "visual", label: "Visual" },
        { val: "off", label: "Off" },
      ],
      default: "data",
    },
  },
  // Per-host orbital encoding (§9.9) — index-based golden-angle position + color + rune symbol. CosmosFleet
  // (the bespoke FleetView, passed via CosmosRoot → DefaultRoot's Fleet slot) consumes it.
  present,
};
