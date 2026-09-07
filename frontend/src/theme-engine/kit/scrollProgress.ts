// The SCROLL-WALK's pure half (D70 §8.3a item 4) — a ramp of progress read off the shared scroller, and
// nothing else. The DOM half (the passive listener, the guarded rAF, the custom-property write) lives with
// each surface that walks: `themes/gacha/GachaAgent.tsx`'s oracle fade and `kit/AgentBackdrop.tsx`'s
// full-bleed backdrop. Everything that can be reasoned about without a browser is a function here.
//
// LIFTED FROM `themes/gacha/oracle.ts`, unchanged (D70 S6): gacha authored this math for M7, and the kit
// backdrop's opacity walk is the same ramp over the same scroller — so it is ONE definition both read
// rather than a near-duplicate in the kit. What stayed gacha's is what is gacha's: the `--gc-oracle-*`
// property names, the ghosting hysteresis and its stamp, and the driver that writes them.
//
// ── WHY PROGRESS COMES FROM AN OFFSET, NOT FROM scrollTop ────────────────────────────────────────────────
// The gacha prototype read `agentScreen.scrollTop` because every screen there is its own scroll container.
// This app has ONE scroller for all bodies (`#app-scroll`), so absolute scrollTop is a different number
// depending on which tab last scrolled it. Progress is therefore measured from the walking element's OWN
// position in the scroller — `base` below. (A surface whose walk really does start at the top of the tab
// passes `base` 0; that is a caller's fact, not a second function.)

/**
 * Parse a CSS px length into a number. Returns null for anything that is not a finite px value — an absent
 * token (the stylesheet has not loaded yet, or a future variant dropped it), a percentage, an empty string.
 *
 * NULL IS THE SAFE ANSWER, not a fallback constant: with no ramp the driver simply does not write, the ramp
 * stays at its `var(…, 0)` default and the surface renders at rest. A hardcoded fallback here would be a
 * second home for the tunable — the exact drift the token exists to prevent.
 */
export function parsePx(value: string): number | null {
  const m = /^\s*(-?\d*\.?\d+)px\s*$/.exec(value);
  if (m === null) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * The ramp: how far the surface has walked, 0 (untouched) → 1 (fully walked), from the scroller's position
 * and the surface's own offset within it.
 *
 * `base` is the scrollTop at which the surface's top edge reaches the scroller's top edge — i.e. the moment
 * a per-screen `scrollTop` would read 0. Above it (a bounce/overscroll, or a pinned plan panel pushing the
 * surface down) progress is 0; `ramp` px past it, 1.
 *
 * A non-positive ramp yields 0 rather than dividing: a zeroed tunable means "no walk", not NaN.
 */
export function scrollProgress(scrollTop: number, base: number, ramp: number): number {
  if (!(ramp > 0)) return 0;
  const p = (scrollTop - base) / ramp;
  return p <= 0 ? 0 : p >= 1 ? 1 : p;
}

/** The written form of the progress — quantized to 1/1000 so a scroll burst that moves the ramp by a
 *  sub-perceptual amount does not dirty style. Presentation precision, not a tunable. */
export function progressValue(p: number): string {
  return p.toFixed(3);
}
