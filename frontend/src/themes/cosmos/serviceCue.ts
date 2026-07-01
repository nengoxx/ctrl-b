// Cosmos service cue (C2b-4) — a per-host moon/ring cue, chosen by the `serviceCue` setting:
//  • DATA  — real per-service status: ≤2 services → "moons" (one per service, lit=up / dim=down) on two
//            slightly different radii; ≥3 → a full ring whose STROKE-WIDTH = the up-fraction (besides size,
//            which encodes aggregate health).
//  • VISUAL — purely decorative: exactly THREE moons across the whole fleet (one host 2, one host 1, rest 0),
//            re-rolled per page load; never a ring; ignores service data.
//  • OFF   — nothing.
// One pure function returns a discriminated union so the render layer never branches on the setting. The
// moons ROTATE (Motion-gated, like the orbit); the ring is static.

import type { Service } from "../../types";

export const MOON_MAX = 2; // ≤ this many services → orbiting moons; more → the fill-arc (DATA mode)

/** The `serviceCue` setting: data-driven cue, decorative moons only, or hidden. (A legacy "auto" → data.) */
export type ServiceCueMode = "data" | "visual" | "off";

export type ServiceCue =
  | { kind: "none" }
  | { kind: "moons"; states: boolean[] } // per-service up/down (data) — or all-up muted (visual)
  | { kind: "arc"; up: number; total: number };

/**
 * The cue for a host. DATA: per-service status — moons (≤MOON_MAX, lit=up/dim=down) or a fill-ring (more).
 * VISUAL: purely decorative — `visualCount` muted moons (0–2, NEVER a ring), ignoring service data; the
 * fleet-wide assignment lives in `visualMoonCounts`. OFF: none.
 */
export function serviceCue(
  services: Service[],
  mode: ServiceCueMode,
  visualCount: number,
): ServiceCue {
  if (mode === "off") return { kind: "none" };
  if (mode === "visual") {
    return visualCount > 0
      ? { kind: "moons", states: Array<boolean>(visualCount).fill(true) }
      : { kind: "none" };
  }
  // data
  if (services.length === 0) return { kind: "none" };
  if (services.length <= MOON_MAX) {
    return { kind: "moons", states: services.map((s) => !!s.status?.online) };
  }
  return {
    kind: "arc",
    up: services.filter((s) => s.status?.online).length,
    total: services.length,
  };
}

/** djb2 — stable per-id hash (for the pseudo-random, jitter-free visual pick). */
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Decorative-moon assignment for VISUAL mode — exactly THREE moons across the whole fleet: one host gets 2,
 * one gets 1, the rest 0. The two hosts are picked by hashing `id + salt`: pass a fresh `salt` per page load
 * (CosmosFleet does) → different planets each refresh, but STABLE within the session (no jitter across the
 * 5s-poll re-renders). Pure given (ids, salt). Returns a host-id → count map (default 0).
 */
export function visualMoonCounts(ids: string[], salt = ""): Map<string, number> {
  const counts = new Map<string, number>(ids.map((id) => [id, 0]));
  // XOR each id's hash with the salt's hash — XOR isn't order-preserving, so a different salt genuinely
  // re-orders (appending the salt wouldn't: equal-length ids keep their order under a linear hash).
  const sh = hashStr(salt);
  const key = (id: string): number => (hashStr(id) ^ sh) >>> 0;
  const ranked = [...ids].sort((a, b) => key(a) - key(b));
  if (ranked[0] !== undefined) counts.set(ranked[0], 2);
  if (ranked[1] !== undefined) counts.set(ranked[1], 1);
  return counts;
}

// Per-moon orbit tuning — the (up to 2) moons ride DIFFERENT radii + drift at DIFFERENT speeds so they read
// as distinct little satellites, starting on opposite sides. Named consts; px gaps are past the coin edge.
const MOON_GAPS = [5, 12]; // inner + outer orbit (px beyond the coin edge)
const MOON_DUR_MS = [9000, 12500]; // base drift periods (then de-synced per host, see below)
const MOON_PHASE_DEG = [0, 180]; // the two moons of a host stay ~opposite; the host's base phase rotates

const GOLDEN = 0.6180339887; // low-discrepancy multiplier — `frac(n·GOLDEN)` spreads sequential seeds evenly
const frac = (x: number): number => x - Math.floor(x);

export interface MoonOrbit {
  r: number; // orbit radius (px from planet center)
  durMs: number; // revolution period
  phaseDeg: number; // starting angle (0 = top)
  dir: 1 | -1; // spin direction (some moons counter-orbit → unmistakably de-synced)
  up: boolean;
}

/**
 * Resolve each service's moon orbit (radius/period/phase/dir/up) for a coin of radius `coinRadius`. EVERY
 * moon across ALL planets is de-synced: `k = seed·2 + i` is globally unique per (host, moon), so each gets a
 * distinct PERIOD (~0.7–1.4×) and a seeded DIRECTION (≈half counter-orbit); plus a per-host base phase. No
 * two moons rotate in lockstep, yet a host's own two moons keep their ~180° start separation + distinct
 * radii. Deterministic (stable across reloads). `seed` = the host index. Caps at MOON_MAX.
 */
export function moonOrbits(states: boolean[], coinRadius: number, seed: number): MoonOrbit[] {
  const hostPhase = frac((seed + 1) * GOLDEN) * 360; // per-host start offset
  return states.slice(0, MOON_MAX).map((up, i) => {
    const k = seed * 2 + i; // globally unique per (host, moon)
    const f = frac((k + 1) * GOLDEN * 1.3); // period jitter
    const d = frac((k + 1) * GOLDEN * 2.1 + 0.19); // direction bit
    return {
      r: coinRadius + MOON_GAPS[i],
      durMs: Math.round(MOON_DUR_MS[i] * (0.7 + f * 0.7)), // 0.7×–1.4× → clearly distinct periods
      phaseDeg: Math.round((MOON_PHASE_DEG[i] + hostPhase) % 360),
      dir: d < 0.5 ? -1 : 1,
      up,
    };
  });
}
