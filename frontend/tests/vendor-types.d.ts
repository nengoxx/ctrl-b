// Minimal ambient types for culori as used ONLY by the B2 OKLCH gamut advisory in
// tests/theme-engine/themeContract.test.ts. culori ships no declarations (no @types either); per the
// repo's vendor-types convention (see e2e/vendor-types.d.ts — the sibling scope, declaring the disjoint
// contrast-math surface e2e calls) each tsconfig program declares JUST the surface it calls, so the app
// type graph still never sees culori. Auto-included via this tsconfig's `include: ["./"]`.

declare module "culori" {
  /** A parsed culori color object (only `mode` is relied on here). */
  export interface CuloriColor {
    mode: string;
  }
  /** Parse any CSS color string; `undefined` for an unparseable one. */
  export function parse(color: string): CuloriColor | undefined;
  /** Returns a predicate testing whether a color lies inside the given gamut (e.g. "rgb" = sRGB). */
  export function inGamut(mode: string): (color: string | CuloriColor) => boolean;
  /** Reduce chroma (in `mode`'s space) until the color fits the sRGB gamut. */
  export function clampChroma(color: string | CuloriColor, mode?: string): CuloriColor;
  /** Serialize a color to an sRGB hex string. */
  export function formatHex(color: string | CuloriColor): string;
}
