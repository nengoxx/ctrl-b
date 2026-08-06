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
export function chipBackground(swatch?: string | string[]): CSSProperties {
  if (!swatch) return { background: "var(--surface-2)" };
  if (!Array.isArray(swatch)) return { background: swatch };
  const n = swatch.length;
  const stops = swatch
    .map((c, i) => `${c} ${((i / n) * 100).toFixed(2)}% ${(((i + 1) / n) * 100).toFixed(2)}%`)
    .join(", ");
  return { background: `conic-gradient(${stops})` };
}
