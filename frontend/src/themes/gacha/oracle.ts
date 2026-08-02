// M7 — the oracle's fade-on-scroll, the PURE half (D52 / GACHA_PLAN §4.2 + §10.2). The DOM half (the
// passive listener, the rAF, the property write) lives in GachaAgent.tsx, exactly the split GachaBanner and
// `carousel.ts` use: everything that can be reasoned about without a browser is a function here.
//
// ── WHY PROGRESS COMES FROM AN OFFSET, NOT FROM scrollTop ────────────────────────────────────────────────
// The prototype reads `agentScreen.scrollTop` because every screen there is its own scroll container. This
// app has ONE scroller for all bodies (`#app-scroll`), so absolute scrollTop is a different number depending
// on which tab last scrolled it — the oracle would boot half-ghosted after a long fleet scroll. Progress is
// therefore measured from the oracle's OWN position in the scroller (§4.2's ruling).

/** The custom property the driver writes and the whole M7 ramp derives from — opacity, scale and the
 *  sharp↔blurred crossfade are all `calc()`s over this ONE number (§10.2: per-frame work stays
 *  opacity/transform). Written on the oracle element, so it is visible in devtools and readable by a probe. */
export const ORACLE_P_VAR = "--gc-oracle-p";

/** The ramp LENGTH token (the prototype's 240px). Read from CSS rather than hardcoded here: it is a tunable,
 *  and tokens.css is where gacha's tunables live — one edit moves the ramp for every variant. */
export const ORACLE_RAMP_VAR = "--gc-oracle-ramp";

/**
 * Parse a CSS px length into a number. Returns null for anything that is not a finite px value — an absent
 * token (the stylesheet has not loaded yet, or a future variant dropped it), a percentage, an empty string.
 *
 * NULL IS THE SAFE ANSWER, not a fallback constant: with no ramp the driver simply does not write, the ramp
 * stays at its `var(…, 0)` default and the oracle renders sharp. A hardcoded fallback here would be a second
 * home for the tunable — the exact drift the token exists to prevent.
 */
export function parsePx(value: string): number | null {
  const m = /^\s*(-?\d*\.?\d+)px\s*$/.exec(value);
  if (m === null) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * The ramp: how far the oracle has ghosted, 0 (untouched) → 1 (fully ghosted), from the scroller's position
 * and the oracle's own offset within it.
 *
 * `base` is the scrollTop at which the oracle's top edge reaches the scroller's top edge — i.e. the moment
 * the prototype's own `scrollTop` would read 0. Above it (a bounce/overscroll, or a pinned plan panel pushing
 * the oracle down) progress is 0; `ramp` px past it, 1.
 *
 * A non-positive ramp yields 0 rather than dividing: a zeroed tunable means "no fade", not NaN.
 */
export function oracleProgress(scrollTop: number, base: number, ramp: number): number {
  if (!(ramp > 0)) return 0;
  const p = (scrollTop - base) / ramp;
  return p <= 0 ? 0 : p >= 1 ? 1 : p;
}

/** The written form of the progress — quantized to 1/1000 so a scroll burst that moves the ramp by a
 *  sub-perceptual amount does not dirty style. Presentation precision, not a tunable. */
export function oracleProgressValue(p: number): string {
  return p.toFixed(3);
}
