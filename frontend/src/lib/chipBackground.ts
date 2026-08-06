import type { CSSProperties } from "react";

// The COLOUR-CHIP paint rule, shared by the two controls that render one (D52 G6 / the §4.9 ledger).
//
// `Swatches` (the Palette radiogroup, D29 §14.4) has drawn these since it landed; `Seg` gained an optional
// per-option `swatch` for gacha's dossier picker. Extracted to `lib/` at that point rather than imported
// component-to-component — the `lib/hostDetail.ts` / `lib/viewTransition.ts` precedent (a rule two
// surfaces share belongs beside neither of them) — so the two chips can never end up interpreting the
// same DATA two different ways.
//
// The shape is the one `PaletteModel.accents[].swatch` and the seg option both declare: a single CSS
// colour or gradient → one chip; a `string[]` → an equal-wedge conic "pie" previewing each colour of a
// multi-token palette (the seam for richer design-framework palettes). Omitted → a neutral surface chip.
//
// `accent` is the optional SECOND half (G6.3, owner ruling 2026-08-06): the palette's flat `--accent`,
// banded down the right of the chip over the swatch. It is composed HERE rather than by a second element
// in `Swatches` for the reason this module exists at all — the chip is one paint rule, and a control that
// grew its own overlay span would be the second interpretation of the same data. One background LIST does
// it: a hard-stop gradient (transparent up to the split, the accent from it) as the top layer, the swatch
// underneath. A plain colour swatch stays legal as the list's last item, which is where the shorthand
// requires a `<color>` to sit.
const ACCENT_SPLIT = "65%";

export function chipBackground(swatch?: string | string[], accent?: string): CSSProperties {
  const base = !swatch
    ? "var(--surface-2)"
    : Array.isArray(swatch)
      ? `conic-gradient(${wedges(swatch)})`
      : swatch;
  if (accent === undefined) return { background: base };
  // Both stops sit at the split, so there is no transparent→colour interpolation to grey the seam.
  return {
    background: `linear-gradient(90deg, transparent 0 ${ACCENT_SPLIT}, ${accent} ${ACCENT_SPLIT}), ${base}`,
  };
}

function wedges(swatch: string[]): string {
  const n = swatch.length;
  return swatch
    .map((c, i) => `${c} ${((i / n) * 100).toFixed(2)}% ${(((i + 1) / n) * 100).toFixed(2)}%`)
    .join(", ");
}
