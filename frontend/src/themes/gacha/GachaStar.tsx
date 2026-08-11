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
// ── ONE PRIMITIVE, TWO TREATMENTS — and the split is entirely CSS's (owner rulings, final 2026-08-07) ─
// The component draws the same polygon everywhere; each SURFACE then says how it is painted, the way this
// theme does everything else. Nothing here branches, and there is no second component:
//
//   · the DOSSIER's tab wants the clean mark — self-coloured stroke (so it fattens and rounds the
//     silhouette into one solid, plumper star rather than outlining it) and nothing else. "The dossier
//     looks good."
//   · the ROWS THAT SIT ON ARTWORK are CARVED — the capsule CARD's row and, since the E5 device round
//     (owner finding), the COVER HERO's row, one GROUPED rule in gacha.css: the R19 blurred inner shadow
//     (`filter: url(#gc-star-carve)`). The owner walked the 2026-08-06/07 rounds through a contrasting
//     dark contour ("reads as an outline"), an accent edge + arcade drop, then outline-only — and settled
//     on the carve off `research-sheets/star-carved-candidates.html`, variant E ("I like it that much").
//     The drop machinery those rounds left dormant is REMOVED with the pick; git holds it if a surface
//     ever wants an offset copy again.
//
// ── THE CARVE FILTER (R19 E) — and the §14.11 waiver it ships under ───────────────────────────────────
// The canonical SVG inner shadow: offset the star's alpha down, blur it, keep the part of the original
// alpha the blurred copy no longer covers (`feComposite out` — the top-facing inner band), flood it with
// the carve ink and merge it over the star. A per-star filter is an offscreen rasterization on a
// scrolling track — the class §14.11 bans and R16 retired the glyph's glow for — so this ships as an
// OWNER-GRANTED WAIVER, scoped to exactly this def (recorded in THEME_ENGINE §14.11; the contrast test
// pins the sheet to ONE svg-filter reference). The buffers are star-sized (~14px), not card-sized; the
// banked fallback if a device round ever finds jank is the sheet's variant C, the same carve as layered
// geometry.
//
// ── THAT FALLBACK, BANKED (variant C, "deep carve" — geometry + one shared mask, no filter) ────────────
// The candidate sheet lives under `design/prototypes/gacha/research-sheets/`, which is GITIGNORED — so
// every citation above points somewhere git cannot follow, and a waiver whose retreat exists on exactly
// one machine is not a retreat. C is copied here from the sheet so backing out is a diff rather than an
// excavation. Three moves: swap the GROUPED fleet-star rule's `filter: url(#gc-star-carve)` (gacha.css —
// it names the card row AND the cover hero's row) for the layered draw below, delete `GachaStarDefs`
// and its mount in GachaFleet, and strike the §14.11 waiver entry.
//
// The construction is the SAME polygon painted twice: a darkened copy of the star's own colour underneath,
// and the ordinary star on top pushed DOWN 9 user units, clipped back to the true stroked silhouette by a
// shared mask. What the drop leaves uncovered along the top inner edge IS the carve band (~1.3px at 14px
// ink) — the same cue the filter blurs, except the offset is geometry, so it costs no offscreen buffer.
// The silhouette never moves: the mask carries the same 9-unit round-joined stroke the star already has.
//
//   <mask id="sil" maskUnits="userSpaceOnUse" x="-30" y="-30" width="160" height="160">   ← one shared def
//     <polygon points={POINTS} fill="#fff" stroke="#fff" strokeWidth="9" strokeLinejoin="round" />
//   </mask>
//   .gc-star .carve { fill: color-mix(in srgb, currentColor 34%, #1a0e2c); stroke: <same>; }   ← the mix
//   <polygon className="carve" points={POINTS} />              ← under: the recessed copy
//   <g mask="url(#sil)"><polygon points={POINTS} transform="translate(0 9)" /></g>   ← over: the star
//
// The dark end of that mix is the sheet's own literal and would become a token beside
// `--gc-star-carve-ink` on the way in — it is NOT that token: the filter floods one flat ink through an
// alpha band, while C mixes the star's live colour toward a dark, so the two values are not interchangeable.
// (A and B are the same stack at 5 units with a lighter mix — a quieter carve; D drops the mask for a 0.94
// scale-down, the cheapest of the four. C is banked because the sheet measured it most legible at 14px.)
//
// `primitiveUnits="objectBoundingBox"` is what makes the def SIZE-BLIND: dy 0.0622 and stdDeviation
// 0.0363 are the sheet's own 6 and 3.5 user units as fractions of its 96.5-unit box, so the carve scales
// with whatever `--gc-star-size` a row asks for — the same property the stroke gets from user units.
// The flood ink is a TOKEN (`--gc-star-carve-ink`, council M7) referenced through a style var; one dark
// mixed over whatever the star's own colour is, which is how gold, rose-gold and the sleep row's dim all
// carve without per-colour rules (the construction is alpha-based, so `.hi` keeps re-tinting the STAR).
//
// Colour is CSS's throughout: `fill: currentColor` inherits the row's `color`, so the existing
// `--gc-star` / `--gc-star-hi` / `--gc-star-dim` tinting keeps working unchanged and `isHighStar` still
// decides WHICH star is rose-gold.

/** C2's round star: 5 points, inner/outer ≈ 0.47, in the sheet's own 100-unit coordinate space. */
const POINTS =
  "50.00,8.40 63.52,35.79 93.75,40.19 71.87,61.51 77.04,91.61 " +
  "50.00,77.40 22.96,91.61 28.13,61.51 6.25,40.19 36.48,35.79";

/** One star. `hi` marks a top-rung (rose-gold) star — `isHighStar` (stars.ts) decides which; this only
 *  carries the class the theme colours it through. The row above it owns `aria-hidden`, so no ARIA here. */
export function GachaStar({ hi }: { hi?: boolean }) {
  return (
    <svg className={"gc-star" + (hi ? " hi" : "")} viewBox="1.75 1.75 96.5 96.5">
      <polygon points={POINTS} strokeLinejoin="round" />
    </svg>
  );
}

/** The carve filter's ONE document-wide definition — mounted by GachaFleet, whose star rows on artwork
 *  are the carved ones (the grouped card + cover-hero rule in gacha.css consumes it; the dossier's plain
 *  mark needs no def). Mounted as a 0×0 absolutely-positioned svg, deliberately NOT `display: none`: a hidden-subtree
 *  def is the classic way engines drop filter references, and a broken `filter: url(#…)` does not degrade
 *  to "no filter" everywhere — Gecko has historically not painted the referencing element at all, which
 *  would vanish every card star. The def must live exactly as long as any card can. */
export function GachaStarDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden focusable="false">
      <defs>
        <filter
          id="gc-star-carve"
          x="-0.3"
          y="-0.3"
          width="1.6"
          height="1.6"
          primitiveUnits="objectBoundingBox"
        >
          <feOffset dy="0.0622" in="SourceAlpha" result="o" />
          <feGaussianBlur stdDeviation="0.0363" in="o" result="b" />
          <feComposite operator="out" in="SourceAlpha" in2="b" result="band" />
          <feFlood style={{ floodColor: "var(--gc-star-carve-ink)" }} result="ink" />
          <feComposite operator="in" in="ink" in2="band" result="carve" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="carve" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}
