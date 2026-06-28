import { describe, expect, it } from "vitest";

import { MOON_MAX, moonOrbits, serviceCue } from "../../src/themes/cosmos/serviceCue";
import type { Service } from "../../src/types";

// Cosmos service cue (C2b-4) — pure logic: representation choice (moons ≤3 / arc >3 / none) + moon layout.
// The visuals are CSS, reviewed live.

const svc = (online: boolean): Service =>
  ({ status: { online } }) as unknown as Service;

describe("serviceCue", () => {
  it("is none when disabled or there are no services", () => {
    expect(serviceCue([svc(true)], false)).toEqual({ kind: "none" });
    expect(serviceCue([], true)).toEqual({ kind: "none" });
  });

  it("uses moons for ≤ MOON_MAX (=2) services (per-service up/down)", () => {
    expect(MOON_MAX).toBe(2);
    expect(serviceCue([svc(true)], true)).toEqual({ kind: "moons", states: [true] });
    expect(serviceCue([svc(true), svc(false)], true)).toEqual({
      kind: "moons",
      states: [true, false],
    });
  });

  it("uses a fill-arc for ≥3 services (up/total)", () => {
    const three = [svc(true), svc(true), svc(false)];
    expect(serviceCue(three, true)).toEqual({ kind: "arc", up: 2, total: 3 });
    const four = [svc(true), svc(false), svc(true), svc(true)];
    expect(serviceCue(four, true)).toEqual({ kind: "arc", up: 3, total: 4 });
  });
});

describe("moonOrbits", () => {
  it("returns one orbit per service (≤2), carrying up/down", () => {
    const orbits = moonOrbits([true, false], 20, 0);
    expect(orbits).toHaveLength(2);
    expect(orbits.map((o) => o.up)).toEqual([true, false]);
  });

  it("puts a host's two moons on different radii + periods + ~180° apart", () => {
    const [a, b] = moonOrbits([true, true], 20, 0);
    expect(a.r).not.toBe(b.r); // distinct orbit radii
    expect(a.durMs).not.toBe(b.durMs); // distinct speeds
    expect(Math.abs(a.phaseDeg - b.phaseDeg)).toBe(180); // opposite sides within the host
    expect(a.r).toBeGreaterThan(20); // beyond the coin edge
  });

  it("de-syncs EVERY moon across ALL planets — globally distinct periods + seeded directions, deterministic", () => {
    // gather all moons from a few hosts
    const all = [0, 1, 2, 3].flatMap((seed) => moonOrbits([true, true], 20, seed));
    const periods = all.map((m) => m.durMs);
    expect(new Set(periods).size).toBe(periods.length); // no two moons share a period
    expect(all.some((m) => m.dir === 1) && all.some((m) => m.dir === -1)).toBe(true); // both directions occur
    expect(moonOrbits([true, true], 20, 1)).toEqual(moonOrbits([true, true], 20, 1)); // stable per seed
  });
});
