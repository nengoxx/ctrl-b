// THE RARITY STAR — one drawn primitive for every star the theme paints (the R16 redesign, owner ruling
// 2026-08-06 off `design/prototypes/gacha/research-sheets/star-candidates.html`: "off-center tab with SVG
// round fill + contour").
//
// It replaces the ★ text GLYPH on both surfaces — the capsule card's corner row (G1) and the dossier's
// portrait badge (G2) — for the reasons R16 measured rather than for novelty:
//   · the reference field draws a SQUAT, thick-limbed star (inner/outer ≈ 0.5), not U+2605's long-pointed
//     silhouette. The glyph's sharp points are the first thing that furs up at card size.
//   · legibility comes from the star ITSELF, never from a plaque behind it (R16 §2) — which is what let
//     the dossier's filled lozenge become a hairline tab.
//   · a glyph's size and spacing are `font-size` + `letter-spacing`, so the row could never be tuned to
//     the pitch÷ink ratio the field uses; drawn, both are plain lengths and both are tokens.
//
// THE `star` TEXT GLYPH IS NOT RETIRED. `GACHA_COPY.star` still spells the banner's `★N RATE` pill, which
// is a STRING (fleet.ts) and rides the frozen JP subset. Only the two ROWS are drawn.
//
// ── THE GEOMETRY, and the one thing about it worth knowing ────────────────────────────────────────────
// The polygon is candidate C2's, verbatim from the sheet, so what the owner picked is what ships. Its
// STROKE WIDTH is a token in USER UNITS (gacha.css / `--gc-star-stroke`), and the unit choice is the load-
// bearing part: 9 units of a 96.5-unit box is 7.3% of whatever size the row asks for, so the stroke scales
// WITH the star and one primitive serves both rows with no per-size table. (It is also, verified by a
// pixel probe, exactly what the candidate sheet rendered: its CSS `stroke-width` on the `<use>` never
// reached the polygon inside the shadow tree — three wildly different CSS widths produced byte-identical
// PNGs — so the sheet was always drawing its symbol's own `stroke-width="9"`. Reproducing the pick meant
// reproducing that number; putting it in CSS is what lets a surface tune it.)
//
// The viewBox is cropped to exactly the STROKED extent (x 1.75…98.25), which is what makes
// `--gc-star-size` mean the star's real INK width — so the row's pitch÷ink ratio is a number you can read
// off the CSS and compare with R16's table.
//
// ── ONE PRIMITIVE, TWO TREATMENTS — and the split is entirely CSS's (owner rulings, 2026-08-06) ───────
// The component draws the same two polygons everywhere; each SURFACE then says how they are painted, the
// way this theme does everything else. Nothing here branches, and there is no second component:
//
//   · the DOSSIER's tab wants a clean mark — self-coloured stroke (so it fattens and rounds the
//     silhouette into one solid, plumper star rather than outlining it) and NO drop. "They look better
//     without."
//   · the CARD's row sits on ARTWORK, so its stroke is ACCENT-coloured: an edge for visibility over a
//     bright frame, thin enough to read as an edge and not a ring (`paint-order` hides its inner half
//     under the fill). Its drop was retired on the owner's 2026-08-07 round ("only the outline").
//
// The sheet's original contrasting DARK contour is retired on both — the owner read it as an outline.
//
// ── THE DROP: the arcade signature, at star scale — ⚠ DORMANT since 2026-08-07 ────────────────────────
// The same hard, unblurred offset the capsule cards and the dossier portrait wear. It is a SECOND POLYGON
// rather than `filter: drop-shadow()` — the cheaper and crisper form: a filter would rasterize an
// offscreen buffer per star on a scrolling track (the §14.11 class this theme converts away from), while
// a translated copy is plain geometry the same rasterizer already walks. Painted FIRST so the star sits
// on top of it; hidden by default and switched on per-surface. NO surface switches it on any more: the
// dossier never wore it ("they look better without", 2026-08-06) and the card's rule went on the owner's
// 2026-08-07 round ("only the outline"). Kept with its `--gc-star-drop` token while that round settles —
// strip both together if outline-only sticks through the v1.5.0 device pass.
//
// Colour is CSS's throughout: `fill: currentColor` inherits the row's `color`, so the existing
// `--gc-star` / `--gc-star-hi` / `--gc-star-dim` tinting keeps working unchanged (the drop and the card's
// edge read accent tokens instead, so `.hi` re-tints the STAR without dragging either along) and
// `isHighStar` still decides WHICH.

/** C2's round star: 5 points, inner/outer ≈ 0.47, in the sheet's own 100-unit coordinate space. */
const POINTS =
  "50.00,8.40 63.52,35.79 93.75,40.19 71.87,61.51 77.04,91.61 " +
  "50.00,77.40 22.96,91.61 28.13,61.51 6.25,40.19 36.48,35.79";

/** One star. `hi` marks a top-rung (rose-gold) star — `isHighStar` (stars.ts) decides which; this only
 *  carries the class the theme colours it through. The row above it owns `aria-hidden`, so no ARIA here. */
export function GachaStar({ hi }: { hi?: boolean }) {
  return (
    <svg className={"gc-star" + (hi ? " hi" : "")} viewBox="1.75 1.75 96.5 96.5">
      <polygon className="drop" points={POINTS} strokeLinejoin="round" />
      <polygon points={POINTS} strokeLinejoin="round" />
    </svg>
  );
}
