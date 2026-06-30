// Cosmos liveness (C2b-3) — the per-planet "online" indicator. Two glow treatments, chosen by the
// `liveness` setting (Pulse / Halo / Both / Off): a breathing glow whose CADENCE = ping (the graphless
// "ping" — fast breath = low latency) and/or an expanding halo ring. Both are child elements of the planet
// (so they orbit with it) drawn behind the coin; the visuals live in cosmos.css. This module is the pure,
// testable logic: the ping→period mapping and the setting parse. Online-only + Motion-gating are applied at
// the render/CSS layer (CosmosFleet renders them only for online planets; cosmos.css animates only when the
// global Motion lever is "full", and shows a static glow under reduced-motion).

export type Liveness = "pulse" | "halo" | "both" | "off";

// Breathing-pulse period (ms) from ping latency: snappy breath for a healthy low-latency host, slow for a
// laggy one. Named tunables; clamped so a wild ping never produces an out-of-range cadence.
const PULSE_MS_FAST = 1600; // breath period at/under PING_FAST ms (healthy)
const PULSE_MS_SLOW = 4200; // breath period at/over PING_SLOW ms (laggy)
const PING_FAST = 2; // ms — at/below → fastest breath
const PING_SLOW = 120; // ms — at/above → slowest breath

/** Map ping (ms) → breath period (ms). null/undefined (unknown) → the slow (calm) end. Clamped + monotonic. */
export function pulsePeriodMs(pingMs: number | null | undefined): number {
  if (pingMs == null) return PULSE_MS_SLOW;
  const t = Math.max(0, Math.min(1, (pingMs - PING_FAST) / (PING_SLOW - PING_FAST)));
  return Math.round(PULSE_MS_FAST + (PULSE_MS_SLOW - PULSE_MS_FAST) * t);
}

/** Which indicator parts the `liveness` setting enables. Undefined (no override) resolves to the default
 *  (pulse); "off" → neither. */
export function livenessParts(value: string | undefined): { pulse: boolean; halo: boolean } {
  const v = value ?? "pulse";
  return { pulse: v === "pulse" || v === "both", halo: v === "halo" || v === "both" };
}
