// Frontier per-host visual encoding (D29 §9.9 — the ThemeDef.present seam). Maps each host to its beacon on
// the badlands MAP: a scattered position, an indexed rig image, and a license-plate tag. All three are
// INDEX-driven so appending a host yields the next slot and existing beacons are untouched (the same "add a
// computer → a new beacon appears, others as-is" contract cosmos's present() honors). A per-host override
// (the `appearance.frontier` blob) is mapped on top — EXPLICITLY, per-field, validated (see below).

import type { Present, VisualEncoding } from "../../theme-engine/types";
import { RIG_KEYS } from "./art";

// ── R2 quasirandom scatter (Roberts 2018, "The Unreasonable Effectiveness of Quasirandom Sequences") — the
//    2D low-discrepancy analog of cosmos's 1D golden-angle. The plastic constant g is the 2D generalization
//    of the golden ratio; the pair of additive recurrences below spreads N points with near-uniform gaps and
//    no visible lattice/clumping, deterministically (index → the same (u,v) every time), so beacons never
//    jitter across the 5s poll. ──
// ρ, the plastic number (real root of x³ = x + 1) ≈ 1.32471795724474602596… — stored at double precision
// (a fuller literal would silently lose its trailing digits at runtime; the double is exact to ~16 figures).
const PLASTIC = 1.324717957244746;
const A1 = 1 / PLASTIC; // ≈0.7549
const A2 = 1 / (PLASTIC * PLASTIC); // ≈0.5698

// The beacon-SAFE region of the map card, in % of the card box. Insets clear the top-left map label + the
// top-right count pill and keep beacons off the extreme edges (the tag hangs below the pin). VERIFIED by
// construction: across i = 0..11 the R2 scatter keeps a ≥15%-of-width minimum separation, so NO post-hoc
// separation/relaxation pass is needed (and none is added — adding one would break the determinism above).
const SAFE_X0 = 12; // left inset (%)
const SAFE_XW = 76; // usable width (%) → x ∈ [12, 88]
const SAFE_Y0 = 30; // top inset (%) — clears the label/count band
const SAFE_YH = 55; // usable height (%) → y ∈ [30, 85]

// The sequence WINDOW (owner directive 2026-07-12): start the R2 sequence 2 points in, so presentation
// slot 0 lands at ≈(70, 42) — beside the hero art's figure on the cliff ledge. The self host (useHosts
// sorts it first) therefore "stands with the agent" BY DEFAULT, no config, no special case: slot 0 is
// just the window's first point. Offsetting a low-discrepancy sequence ("burn-in") preserves all its
// properties — determinism + the ≥15%-of-width min separation re-verified through N=12 at this window.
const R2_OFFSET = 2;

const fract = (v: number): number => v - Math.floor(v);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** The license-plate tag: `0x` + the first 3 chars of the host name (uppercased) + the 1-based index,
 *  zero-padded to 2 digits (e.g. pegasus,0 → `0xPEG01`). Short names are guarded — a name under 3 chars
 *  yields a shorter prefix rather than crashing (empty → `RIG`). Sliced by CODE POINT (spread), not code
 *  unit — `.slice(0,3)` on a unicode/emoji name would split a surrogate pair into plate mojibake. */
function plateFor(name: string, index: number): string {
  const prefix = [...name].slice(0, 3).join("").toUpperCase() || "RIG";
  return `0x${prefix}${String(index + 1).padStart(2, "0")}`;
}

// The override blob is `host.appearance.frontier` — the FLAT vocabulary `{ image?, x?, y? }` (the theme owns
// this schema; §9.9). This is the first end-to-end run of the UNVALIDATED appearance pass-through, so the
// mapping is EXPLICIT, never a blind `{...enc, ...override}` spread (which — as the review found — would let
// a config typo like `x: 900` fling a beacon off-card, and couldn't map the flat `image` onto the nested
// `asset`/`position` anyway). Each field is validated independently and a bad/absent field is IGNORED (the
// indexed default stands), so a hand-edited config can never crash or corrupt the layout.
export const present: Present = (host, index, override) => {
  const name = (host as { name?: string }).name ?? "";
  let x = SAFE_X0 + fract(0.5 + A1 * (index + 1 + R2_OFFSET)) * SAFE_XW;
  let y = SAFE_Y0 + fract(0.5 + A2 * (index + 1 + R2_OFFSET)) * SAFE_YH;
  let asset: string = RIG_KEYS[index % RIG_KEYS.length];

  if (override) {
    // image → asset ONLY if it names a real rig key; a dangling image keeps the indexed default.
    const img = override.image;
    if (typeof img === "string" && (RIG_KEYS as readonly string[]).includes(img)) asset = img;
    // numeric x/y → position, CLAMPED into the safe region (so a typo can't push the beacon off-card).
    // Non-numeric / NaN / absent → ignored per-field (the scatter default stands).
    if (typeof override.x === "number" && Number.isFinite(override.x)) {
      x = clamp(override.x, SAFE_X0, SAFE_X0 + SAFE_XW);
    }
    if (typeof override.y === "number" && Number.isFinite(override.y)) {
      y = clamp(override.y, SAFE_Y0, SAFE_Y0 + SAFE_YH);
    }
  }

  const enc: VisualEncoding = {
    position: { x, y }, // the {x,y} VisualEncoding variant (% of the map card); FrontierFleet places it
    asset, // a RIG_KEYS entry → ART.rigs image (the modulo pool never includes hero/stack)
    plate: plateFor(name, index), // theme-specific extra (VisualEncoding is open)
  };
  return enc;
};
