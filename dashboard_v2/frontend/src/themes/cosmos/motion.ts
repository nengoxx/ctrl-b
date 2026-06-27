// Cosmos motion tuning — ONE source of truth for the theme's "more dynamic" animation, shared by the C1
// starfield and (later) the C2 orbital fleet. cosmos exposes two per-theme settings (ThemeDef.settings,
// the vapor precedent): an `orbitalMotion` on/off switch and a `motionSpeed` tempo. The numeric tempo lives
// here (not hardcoded at each canvas) so both surfaces animate at the same, centrally-tunable speed.
//
// Gating rule (set at each canvas): animate only when the GLOBAL `ui.motion` is "full" AND `orbitalMotion`
// is on — reduced-motion always wins for accessibility; the switch is an additional per-theme opt-out.

export type CosmosSpeed = "calm" | "normal" | "lively";

/** Tempo multiplier applied to the animation clock (1 = the prototype's baseline speed). */
export const COSMOS_SPEED: Record<CosmosSpeed, number> = {
  calm: 0.55,
  normal: 1,
  lively: 1.7,
};

export const COSMOS_SPEED_DEFAULT: CosmosSpeed = "normal";

/** Resolve a `motionSpeed` setting value to its multiplier, defaulting safely on an unknown value. */
export function speedMultiplier(speed: string | undefined): number {
  return COSMOS_SPEED[(speed as CosmosSpeed) ?? COSMOS_SPEED_DEFAULT] ?? 1;
}
