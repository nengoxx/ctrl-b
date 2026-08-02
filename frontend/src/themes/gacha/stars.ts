// The gacha STAR LADDER (D52 / GACHA_PLAN §6.1 / §6.2) — pure, and the single source for every star the
// theme draws: capsule cards (G1), the dossier's portrait badge (G2) and the banner's `★N RATE` pill (G1)
// all read it, because a card showing ★★★ beside a pill promising ★5 would read as a bug.
//
// THE INPUT IS CONFIGURED SERVICES, NOT LIVE ONES (the owner's ruling): `(host.services ?? []).length`,
// which arrives ON the host object with the hosts query — no join, no second loading state, and no star
// flicker when a service goes down. Stars change only when the owner edits a machine's services.
//
// THE LADDERS ARE DESIGN CONSTANTS, the MODE is the one configurable (council M5 / Codex R4-8): its single
// home is the `starMode` ThemeDef setting. Nothing star-shaped lives in the roster.
//
//   configured │ 5★ mode │ 3★ mode
//   ───────────┼─────────┼────────
//        0     │   ★1    │   ★1     ← the zero floor, ruled at lock: a unit never renders starless
//        1     │   ★1    │   ★1
//        2     │   ★2    │   ★2
//        3     │   ★3    │   ★2
//        4     │   ★4    │   ★3
//       ≥5     │   ★5    │   ★3

/** The rarity scale — the `starMode` setting's two values. */
export type StarMode = "five" | "three";

/** The top of each scale. Also the `★N` the rate pill announces (§6.3). */
export const MAX_STARS: Record<StarMode, number> = { five: 5, three: 3 };

/** Narrow a raw setting value to a `StarMode`. `useThemeSetting` already validates against the declared
 *  options, so this is the type bridge (and the last line of defence for a non-hook caller), not a second
 *  validation layer. */
export function toStarMode(raw: string | boolean | undefined): StarMode {
  return raw === "three" ? "three" : "five";
}

/** Stars for a host, from its CONFIGURED service count. Clamped into [1, MAX] at both ends: the ★1 floor is
 *  the ruled zero-services behavior (gacha logic — every unit is worth something), and a fleet machine with
 *  twenty services still tops out at the scale's maximum. A negative/fractional count (impossible from the
 *  DTO, cheap to survive) resolves to the floor. */
export function starsFor(configuredServices: number, mode: StarMode): number {
  const max = MAX_STARS[mode];
  if (!Number.isFinite(configuredServices) || configuredServices <= 1) return 1;
  const n = Math.floor(configuredServices);
  // 5★ walks 1:1 up to the cap; 3★ compresses the middle — "two or three → ★2, more than three → ★3".
  const raw = mode === "five" ? n : n <= 3 ? 2 : 3;
  return Math.min(raw, max);
}

/** Whether the star at `index` (0-based, left to right) is a ROSE-gold star rather than a plain gold one
 *  (§6.2): the top TWO in 5★ mode, the top ONE in 3★ mode. The caller paints `--gc-star-hi` vs `--gc-star`
 *  — the colors are tokens, never literals, so the G6 palette variants re-tint them. */
export function isHighStar(index: number, mode: StarMode): boolean {
  return index >= MAX_STARS[mode] - (mode === "five" ? 2 : 1);
}
