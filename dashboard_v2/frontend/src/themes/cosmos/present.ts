// cosmos per-host visual encoding (D29 §9.9 — the ThemeDef.present seam). Maps each host to its place in
// the orbital fleet: a golden-angle (Vogel/sunflower) position so any host count spreads evenly with no
// spokes or overlaps, an index-based planet color, and an index-based rune glyph. All three are INDEX-driven
// so appending a host yields the next color/symbol/position and existing planets are untouched (owner's
// "add a computer → new planet pops up, others as-is"). SIZE is NOT set here — it needs the fleet's per-host
// service list, which lives in CosmosFleet; the pure size math is the exported `planetSize` helper below
// (called there). A per-host `override` (C4) shallow-merges on top, so a user tweak is purely additive.

import type { Present, VisualEncoding } from "../../theme-engine/types";
import { runeIdFor } from "./runes";

// ── Layout tuning (kept as named constants — the owner may expose these as settings later). ──
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈137.5° — the sunflower angle for even, spoke-free spread
// px; radius = RING_SPACING·√(index+1) → rings grow outward, none at the dead center. Tuned to fit ~6 hosts
// within a phone width; a fit-to-stage responsive scale (measure the stage, scale .cosmos-solar) is a C2b
// refinement so larger fleets never clip.
const RING_SPACING = 64;

// Planet coin hues — a fixed index of 10 distinct colors (owner directive, Option 1). Assigned BY INDEX
// (the host's position in the fleet) like the symbol + position, so appending a host gives the next color
// while existing hosts keep theirs. The first four are the owner's current view (amber, cyan, purple,
// green); the rest are distinct hues. The Pluto-like red is LAST so a newly-added host won't mimic the
// decorative red. Wraps after 10 (repeats are fine past 10 — owner). The modulo adapts if the set changes.
export const PLANET_PALETTE = [
  "#ff9d3c", // amber
  "#56cfee", // cyan
  "#a855f7", // purple
  "#4fd6a0", // green
  "#f472b6", // pink
  "#ffd84d", // yellow
  "#9fe04a", // lime
  "#2bd4c4", // teal
  "#4f8ff5", // blue
  "#ff5d6c", // red
];

// Decorative per-planet glyphs are astronomical/alchemical-style "runes" (circles/points/radii), drawn as
// inline SVG and assigned by index — see runes.tsx (the set + `runeIdFor`). present() stores the rune ID;
// CosmosFleet renders it via <Rune>. Assigned BY INDEX so the visible fleet's glyphs stay distinct.

// ── Planet size (px diameter) ── varied base by service count × service health (owner: "size = service
// health", plus a varied base so sizes spread like the prototype's 22–48px). The basis is a clean named
// function so the owner can retune the range or swap the basis (e.g. include role) later.
const SIZE_MIN = 20; // diameter (px) for a host with 0 declared services
const SIZE_MAX = 48; // diameter (px) for a host with ≥ SIZE_COUNT_CAP services, all healthy
const SIZE_COUNT_CAP = 5; // service count at which the base saturates to SIZE_MAX
const MIN_HEALTH_SCALE = 0.58; // a host with ALL services down shrinks to this fraction of its base

/** Per-host service health in [0,1]: fraction of the host's declared services that are online.
 *  No declared services → 1 (nothing can be missing; the host sits at its base size). */
export function serviceHealth(upCount: number, total: number): number {
  return total > 0 ? upCount / total : 1;
}

/**
 * Planet diameter (px) = a base scaled by service COUNT (more services → bigger), then by service HEALTH
 * (services down → shrink). Both inputs come from the fleet's per-host service list (CosmosFleet), which is
 * why this is a standalone helper rather than part of the pure host+index `present()`.
 *
 * Note (C2b follow-up): small/unhealthy planets can fall below a 44px tap target — the prototype's separate
 * larger hit-area (`.hit`) is deferred to the C2b interaction slice.
 */
export function planetSize(serviceCount: number, health: number): number {
  const base = SIZE_MIN + (SIZE_MAX - SIZE_MIN) * (Math.min(serviceCount, SIZE_COUNT_CAP) / SIZE_COUNT_CAP);
  const clampedHealth = Math.max(0, Math.min(1, health));
  return Math.round(base * (MIN_HEALTH_SCALE + (1 - MIN_HEALTH_SCALE) * clampedHealth));
}

// All three channels are INDEX-driven (host position in the fleet), so appending a host yields the next
// color/symbol/position and existing planets are untouched (owner's "add a computer → new planet pops up,
// others as-is"). `host` is unused today but kept for the Present contract (C4 per-host override is merged
// on top below).
export const present: Present = (_host, index, override) => {
  const enc: VisualEncoding = {
    // Polar position (the VisualEncoding {angle, radius} variant); CosmosFleet converts to x/y.
    position: { angle: index * GOLDEN_ANGLE, radius: RING_SPACING * Math.sqrt(index + 1) },
    color: PLANET_PALETTE[index % PLANET_PALETTE.length],
    symbol: runeIdFor(index),
  };
  return override ? { ...enc, ...override } : enc; // per-host override (C4) — additive
};
