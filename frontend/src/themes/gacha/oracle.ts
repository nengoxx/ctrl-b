// M7 — the oracle's fade-on-scroll, the gacha-OWNED half (D52 / GACHA_PLAN §4.2 + §10.2). The DOM half (the
// passive listener, the rAF, the property write) lives in GachaAgent.tsx, exactly the split GachaBanner and
// `carousel.ts` use: everything that can be reasoned about without a browser is a function here.
//
// THE RAMP MATH ITSELF NOW LIVES IN THE KIT (`theme-engine/kit/scrollProgress.ts`, D70 S6): `parsePx` /
// `scrollProgress` / `progressValue` moved there unchanged when the shared agent backdrop grew the same
// walk over the same scroller — one definition, two drivers. What stays here is what is gacha's: the
// property names its CSS reads, and the GHOSTING hysteresis nothing else has.

import type { AgentBackdropMode } from "../../theme-engine/types";

/** Whether the M7 fade is LIVE: the "Sticky operator art" setting AND the operator mode (D70 §8.3a
 *  item 5 — `gacha.oracle` governs OPERATOR-mode scroll ONLY, and the three-state backdrop decides
 *  what paints there at all).
 *
 *  ONE derivation with TWO readers that cannot disagree (the S6 fix wave): `GachaAgent` gates the
 *  driver and the ghost copy on it, and `GachaRoot` stamps `body[data-oracle]` from it — the CSS half
 *  of the same behavior (sticky + the scroll-fade ramp). Stamping from the setting alone left `off`'s
 *  imageless plate sticky and fading, which is operator-mode scroll behavior applied to a surface that
 *  is deliberately a plain in-flow header there. `full` mounts no `.gc-oracle` at all, so the stamp is
 *  inert either way and reads honestly rather than describing a block that is not on screen. */
export function oracleFadeActive(sticky: boolean, mode: AgentBackdropMode): boolean {
  return sticky && mode === "operator";
}

/** The custom property the driver writes and the whole M7 ramp derives from — opacity, scale and the
 *  sharp↔blurred crossfade are all `calc()`s over this ONE number (§10.2: per-frame work stays
 *  opacity/transform). Written on the oracle element, so it is visible in devtools and readable by a probe. */
export const ORACLE_P_VAR = "--gc-oracle-p";

/** The ramp LENGTH token (the prototype's 240px). Read from CSS rather than hardcoded here: it is a tunable,
 *  and tokens.css is where gacha's tunables live — one edit moves the ramp for every variant. */
export const ORACLE_RAMP_VAR = "--gc-oracle-ramp";

/** The `data-gc-ghosting` stamp's dataset key (the DOM half writes `el.dataset[…]`; CSS sees
 *  `[data-gc-ghosting]`). It marks "the block has STARTED ghosting" — the one boolean the bottom-dissolve
 *  mask keys on, so the block keeps its designed crisp bottom edge while it is fully visible at rest
 *  (owner ruling 2026-08-06). It is a separate signal from `--gc-oracle-p` on purpose: a mask whose
 *  GEOMETRY tracked the ramp would re-rasterize a gradient every scroll frame, which is the paint cost
 *  M7's whole one-write-per-frame design exists to avoid. */
export const ORACLE_GHOST_DATA = "gcGhosting";

/** The ramp positions the stamp flips at, as a hysteresis pair.
 *
 *  AT THE END OF THE RAMP, not the start (owner, 2026-08-06, revising the first cut): keyed near p=0 the
 *  mask's arrival was a visible POP — it appears on a still-bright picture, where an edge that goes from
 *  crisp to soft is exactly what the eye is watching. At 0.95 the block's own opacity is already
 *  `1 − 0.95·(1 − --gc-oracle-floor)` ≈ 0.32, i.e. at the floor: the edge it softens is barely there, so
 *  the change lands under the threshold of noticing while still removing the hard cut for the whole of
 *  the state the owner actually looks at.
 *
 *  THE TWO NUMBERS DIFFER because the pair is a Schmitt trigger, not a threshold: a scroller parked at
 *  the flip point wobbles by a pixel either way, and a single value would toggle the attribute — and
 *  therefore the mask — on every one of those frames. The 0.07 gap is wide enough to swallow that wobble
 *  and narrow enough that scrolling back up releases the mask while the block is still near the floor,
 *  so neither direction shows a jump. Same discipline the `--gc-oracle-p` write applies with its
 *  quantized-value guard, one axis over. */
const GHOST_ON = 0.95;
const GHOST_OFF = 0.88;

/** Whether the block counts as fully ghosted at progress `p`, given whether it already did. Pure, so the
 *  hysteresis is testable without a scroller. */
export function oracleGhosting(p: number, was: boolean): boolean {
  return was ? p >= GHOST_OFF : p >= GHOST_ON;
}
