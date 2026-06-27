// cosmos per-host visual encoding (D29 §9.9 — the ThemeDef.present seam). Maps each host to its place in
// the orbital fleet: a golden-angle (Vogel/sunflower) position so any host count spreads evenly with no
// spokes or overlaps, a stable per-host planet color, and a one-glyph symbol. SIZE (= service health) is
// NOT set here — it needs the fleet's per-host service list, which lives in CosmosFleet (this stays a pure
// host+index function). A per-host `override` (C4) shallow-merges on top, so a user tweak is purely additive.

import type { Present, VisualEncoding } from "../../theme-engine/types";

// ── Layout tuning (kept as named constants — the owner may expose these as settings later). ──
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈137.5° — the sunflower angle for even, spoke-free spread
// px; radius = RING_SPACING·√(index+1) → rings grow outward, none at the dead center. Tuned to fit ~6 hosts
// within a phone width; a fit-to-stage responsive scale (measure the stage, scale .cosmos-solar) is a C2b
// refinement so larger fleets never clip.
const RING_SPACING = 64;

// Planet coin hues, assigned by a stable hash of the host id (not index) so a host keeps its color as the
// fleet changes. Distinct, theme-fitting tones; extend freely (the modulo adapts).
const PLANET_PALETTE = ["#7b66f0", "#56cfee", "#4fd6a0", "#ff9d3c", "#e85d9a", "#c9b6ff", "#ffd36b"];

/** Tiny deterministic string hash (djb2) — stable across reloads so a host's planet color/identity holds. */
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export const present: Present = (host, index, override) => {
  const h = host as { id: string; name?: string };
  const enc: VisualEncoding = {
    // Polar position (the VisualEncoding {angle, radius} variant); CosmosFleet converts to x/y.
    position: { angle: index * GOLDEN_ANGLE, radius: RING_SPACING * Math.sqrt(index + 1) },
    color: PLANET_PALETTE[hashStr(h.id) % PLANET_PALETTE.length],
    symbol: (h.name?.[0] ?? "?").toUpperCase(),
  };
  return override ? { ...enc, ...override } : enc; // per-host override (C4) — additive
};
