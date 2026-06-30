// Cosmos motion tuning — ONE source of truth for the theme's "more dynamic" animation, shared by the C1
// starfield and (later) the C2 orbital fleet. cosmos exposes two per-theme settings (ThemeDef.settings,
// the vapor precedent): an `orbitalMotion` on/off switch and a `motionSpeed` tempo. The numeric tempo lives
// here (not hardcoded at each canvas) so both surfaces animate at the same, centrally-tunable speed.
//
// Gating rule (set at each canvas): animate only when the GLOBAL `ui.motion` is "full" AND `orbitalMotion`
// is on — reduced-motion always wins for accessibility; the switch is an additional per-theme opt-out.

export type CosmosSpeed = "calm" | "normal" | "lively";

/** Tempo multiplier applied to the animation clock. The whole scale is deliberately gentle (the
 *  prototype's baseline of 1.0 read as too lively across all tiers — owner). Per-star twinkle speed
 *  ranges up to 0.021/ms, so these give a calm progression for the FASTEST star: calm ~2s, normal ~1s,
 *  lively ~0.6s per cycle (vs the old strobing ~0.3s/0.18s). Clear, distinguishable tiers, none jarring. */
export const COSMOS_SPEED: Record<CosmosSpeed, number> = {
  calm: 0.15,
  normal: 0.3,
  lively: 0.5,
};

export const COSMOS_SPEED_DEFAULT: CosmosSpeed = "normal";

/** Resolve a `motionSpeed` setting value to its multiplier. Both undefined (no override) and an
 *  unrecognized/corrupted value fall back to the normal tempo — never to an out-of-range value. */
export function speedMultiplier(speed: string | undefined): number {
  return COSMOS_SPEED[speed as CosmosSpeed] ?? COSMOS_SPEED[COSMOS_SPEED_DEFAULT];
}

/** Orbit speed as a WAAPI `playbackRate`, normalized so "normal" = 1× (calm ≈0.5×, lively ≈1.67×). Reuses
 *  the single COSMOS_SPEED tempo source so the orbit and the starfield share one speed setting — change the
 *  tempo live (playbackRate) without recreating the animations. */
export function orbitPlaybackRate(speed: string | undefined): number {
  return speedMultiplier(speed) / COSMOS_SPEED[COSMOS_SPEED_DEFAULT];
}
