// Minimal ambient types for the two untyped contrast-math deps used ONLY by e2e/contrast.spec.ts (§14.15.1-A
// ⑧). Neither ships/`@types`-has declarations; we declare just the surface we call. Scoped to the e2e
// tsconfig (`include: ["./"]`), so the app + vitest type graphs never see culori/apca-w3.

declare module "culori" {
  /** WCAG 2.1 contrast ratio (1–21) between two colors (concrete color strings resolve fine). */
  export function wcagContrast(a: string, b: string): number;
  /** Parse + convert any CSS color to the sRGB gamut; `undefined` for an unparseable string. r/g/b in [0,1].
   *  `alpha` is present only when the source color carried one (culori omits it for opaque colors) — the
   *  G6.3 translucent-token compositing reads it, defaulting to 1. */
  export function rgb(
    color: string,
  ): { r: number; g: number; b: number; alpha?: number } | undefined;
}

declare module "apca-w3" {
  /** APCA lightness contrast (Lc, signed) between a text and a background color. Returns a number for a
   *  color-pair input; the string overload (a debug form) is unused here. */
  export function calcAPCA(text: string, bg: string): number | string;
}
