import { describe, expect, it } from "vitest";

import {
  MOON_MAX,
  moonOrbits,
  serviceCue,
  visualMoonCounts,
} from "../../src/themes/cosmos/serviceCue";
import type { Service } from "../../src/types";

// Cosmos service cue (C2b-4) — pure logic: representation choice (moons ≤3 / arc >3 / none) + moon layout.
// The visuals are CSS, reviewed live.

const svc = (online: boolean): Service => ({ status: { online } }) as unknown as Service;

describe("serviceCue — data mode", () => {
  it("is none when off or there are no services", () => {
    expect(serviceCue([svc(true)], "off", 0)).toEqual({ kind: "none" });
    expect(serviceCue([], "data", 0)).toEqual({ kind: "none" });
  });

  it("uses moons for ≤ MOON_MAX (=2) services (per-service up/down)", () => {
    expect(MOON_MAX).toBe(2);
    expect(serviceCue([svc(true)], "data", 0)).toEqual({ kind: "moons", states: [true] });
    expect(serviceCue([svc(true), svc(false)], "data", 0)).toEqual({
      kind: "moons",
      states: [true, false],
    });
  });

  it("uses a fill-arc for ≥3 services (up/total)", () => {
    expect(serviceCue([svc(true), svc(true), svc(false)], "data", 0)).toEqual({
      kind: "arc",
      up: 2,
      total: 3,
    });
    const four = [svc(true), svc(false), svc(true), svc(true)];
    expect(serviceCue(four, "data", 0)).toEqual({ kind: "arc", up: 3, total: 4 });
  });
});

describe("serviceCue — visual mode", () => {
  it("shows `visualCount` decorative moons (all up), NEVER a ring, ignoring service data", () => {
    const many = [svc(false), svc(false), svc(false), svc(false)]; // would be an arc in data mode
    expect(serviceCue(many, "visual", 2)).toEqual({ kind: "moons", states: [true, true] });
    expect(serviceCue(many, "visual", 1)).toEqual({ kind: "moons", states: [true] });
    expect(serviceCue(many, "visual", 0)).toEqual({ kind: "none" }); // unassigned host → no moons
  });
});

describe("visualMoonCounts", () => {
  it("assigns exactly 3 moons across the fleet — one host 2, one host 1, the rest 0", () => {
    const counts = visualMoonCounts(["a", "b", "c", "d"]);
    const vals = [...counts.values()].sort();
    expect(vals).toEqual([0, 0, 1, 2]);
    expect([...counts.values()].reduce((s, v) => s + v, 0)).toBe(3);
  });

  it("is deterministic (stable per fleet) but picks distinct hosts for the 2 and the 1", () => {
    const a = visualMoonCounts(["x", "y", "z"]);
    expect(visualMoonCounts(["x", "y", "z"])).toEqual(a); // stable
    const two = [...a].find(([, v]) => v === 2)?.[0];
    const one = [...a].find(([, v]) => v === 1)?.[0];
    expect(two).toBeDefined();
    expect(one).toBeDefined();
    expect(two).not.toBe(one);
  });

  it("handles tiny fleets (1 host → just the 2-moon; 0 → empty)", () => {
    expect([...visualMoonCounts(["solo"]).values()]).toEqual([2]);
    expect(visualMoonCounts([]).size).toBe(0);
  });

  it("re-picks with a different salt (random per refresh), stable for a given salt", () => {
    const ids = ["a", "b", "c", "d", "e"];
    expect(visualMoonCounts(ids, "s1")).toEqual(visualMoonCounts(ids, "s1")); // stable per salt
    const twoHost = (salt: string) =>
      [...visualMoonCounts(ids, salt)].find(([, v]) => v === 2)?.[0];
    const picks = new Set(["s1", "s2", "s3", "s4", "s5", "s6"].map(twoHost));
    expect(picks.size).toBeGreaterThan(1); // different salts move the moons to different planets
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
