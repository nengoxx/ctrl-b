import type { ReactNode } from "react";

// Decorative planet glyphs — astronomical/alchemical-style "runes" built from circles, points and radii
// (owner's brief). DRAWN as inline SVG, never fonted: the astronomical/alchemical Unicode blocks live in
// the SMP and render inconsistently across platforms (missing glyphs / auto-emoji coloring) — worst on
// Android — so per THEME_ENGINE §14.12 ("draw symbols, don't font them") we own the vector. Monochrome:
// the <svg> sets fill:none / stroke:currentColor, so the coin's engrave tone (color on .sym) drives the
// strokes; filled "points" override with fill="currentColor" stroke="none". viewBox 0 0 24 24, center
// (12,12), base radius ~7. Assigned BY INDEX (runeIdFor) so the visible fleet's glyphs stay distinct.
//
// The set is intentionally easy to extend/reorder (owner will experiment): add an entry to RUNES — its key
// becomes its id and its order its index slot.

const C = 12; // glyph center (viewBox units)

export const RUNES: Record<string, ReactNode> = {
  // a filled point — the simplest mark (good for the smallest planets)
  dot: <circle cx={C} cy={C} r="4" fill="currentColor" stroke="none" />,
  // a point riding the circumference (a moon on its orbit)
  orbit: (
    <>
      <circle cx={C} cy={C} r="7" />
      <circle cx={C} cy="5" r="1.8" fill="currentColor" stroke="none" />
    </>
  ),
  // ☉ — circle + center point
  sun: (
    <>
      <circle cx={C} cy={C} r="7" />
      <circle cx={C} cy={C} r="1.8" fill="currentColor" stroke="none" />
    </>
  ),
  // concentric circumferences
  concentric: (
    <>
      <circle cx={C} cy={C} r="7.5" />
      <circle cx={C} cy={C} r="3.4" />
    </>
  ),
  // ⊕ — circle + crossed radii
  cross: (
    <>
      <circle cx={C} cy={C} r="7" />
      <line x1={C} y1="5" x2={C} y2="19" />
      <line x1="5" y1={C} x2="19" y2={C} />
    </>
  ),
  // circle + a single radius (up) + center point
  radius: (
    <>
      <circle cx={C} cy={C} r="7" />
      <line x1={C} y1={C} x2={C} y2="5" />
      <circle cx={C} cy={C} r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  // three radii at 120° (a spoke)
  spokes: (
    <>
      <circle cx={C} cy={C} r="7" />
      <line x1={C} y1={C} x2={C} y2="5" />
      <line x1={C} y1={C} x2="18.06" y2="15.5" />
      <line x1={C} y1={C} x2="5.94" y2="15.5" />
    </>
  ),
  // circle + a triad of inner points
  triad: (
    <>
      <circle cx={C} cy={C} r="7.5" />
      <circle cx={C} cy="8.4" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="9" cy="13.8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13.8" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  // an upper arc over a point (a rising body)
  arc: (
    <>
      <path d="M5 13 A7 7 0 0 1 19 13" />
      <circle cx={C} cy="17" r="1.8" fill="currentColor" stroke="none" />
    </>
  ),
  // circle + horizontal diameter + center point
  bisect: (
    <>
      <circle cx={C} cy={C} r="7" />
      <line x1="5" y1={C} x2="19" y2={C} />
      <circle cx={C} cy={C} r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  // a binary pair inside a circumference (two points)
  binary: (
    <>
      <circle cx={C} cy={C} r="7" />
      <circle cx="9" cy={C} r="1.6" fill="currentColor" stroke="none" />
      <circle cx="15" cy={C} r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  // a plain circumference (kept available for future planets)
  ring: <circle cx={C} cy={C} r="7" />,
};

export const RUNE_IDS = Object.keys(RUNES);

/** The rune id for a planet at `index` — wraps for fleets larger than the set. */
export function runeIdFor(index: number): string {
  const n = RUNE_IDS.length;
  return RUNE_IDS[((index % n) + n) % n];
}

/** Render a rune by id as the planet's `.sym` glyph (monochrome SVG; falls back to the first rune for an
 *  unknown id, e.g. a future per-host override). */
export function Rune({ id }: { id?: string }) {
  return (
    <svg
      className="sym"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {(id && RUNES[id]) ?? RUNES[RUNE_IDS[0]]}
    </svg>
  );
}
