// Cosmos motion tuning — ONE source of truth for the theme's "more dynamic" animation, shared by the C1
// starfield and (later) the C2 orbital fleet. cosmos exposes two per-theme settings (ThemeDef.settings,
// the vapor precedent): an `orbitalMotion` on/off switch and a `motionSpeed` tempo. The numeric tempo lives
// here (not hardcoded at each canvas) so both surfaces animate at the same, centrally-tunable speed.
//
// Gating rule (set at each canvas): animate only when the GLOBAL `ui.motion` is "full" AND `orbitalMotion`
// is on — reduced-motion always wins for accessibility; the switch is an additional per-theme opt-out.

export type CosmosSpeed = "calm" | "normal" | "lively";

/** Tempo multiplier applied to the animation clock (1 = the prototype's baseline speed). `calm` is a
 *  strong slowdown on purpose: per-star twinkle speed ranges up to 0.021/ms, so even the fastest star
 *  only cycles ~every 2s at calm (vs a too-lively ~0.5s at higher multipliers). `normal` keeps the
 *  prototype baseline. */
export const COSMOS_SPEED: Record<CosmosSpeed, number> = {
  calm: 0.15,
  normal: 1,
  lively: 1.7,
};

export const COSMOS_SPEED_DEFAULT: CosmosSpeed = "normal";

/** Resolve a `motionSpeed` setting value to its multiplier, defaulting safely on an unknown value. */
export function speedMultiplier(speed: string | undefined): number {
  return COSMOS_SPEED[(speed as CosmosSpeed) ?? COSMOS_SPEED_DEFAULT] ?? 1;
}
