import { describe, expect, it } from "vitest";

import {
  PLANET_PALETTE,
  planetSize,
  present,
  serviceHealth,
} from "../../src/themes/cosmos/present";
import { RUNE_IDS, runeIdFor } from "../../src/themes/cosmos/runes";

// cosmos present() (§9.9) + its pure encoding helpers — the jsdom-safe parts to lock (the planet rendering
// is exercised visually). Covers golden-angle layout, id-stable color, index glyphs, and the size math.

const host = (id: string, name?: string) => ({ id, name });
const pos = (e: ReturnType<typeof present>) => e.position as { angle: number; radius: number };

describe("present()", () => {
  it("places index 0 at angle 0, and the angle is linear in index (golden-angle spacing)", () => {
    expect(pos(present(host("a"), 0)).angle).toBe(0);
    // angle = index · GOLDEN_ANGLE → index 2's angle is exactly twice index 1's.
    expect(pos(present(host("a"), 2)).angle).toBeCloseTo(2 * pos(present(host("a"), 1)).angle, 10);
  });

  it("grows the orbit radius with index (no host at the dead center)", () => {
    expect(pos(present(host("a"), 0)).radius).toBeGreaterThan(0);
    expect(pos(present(host("a"), 4)).radius).toBeGreaterThan(pos(present(host("a"), 1)).radius);
  });

  it("assigns the planet color by index from the palette (independent of host id)", () => {
    expect(present(host("a"), 0).color).toBe(PLANET_PALETTE[0]);
    expect(present(host("b"), 3).color).toBe(PLANET_PALETTE[3]);
    expect(present(host("x"), 2).color).toBe(present(host("y"), 2).color); // same index → same color
  });

  it("wraps the palette for fleets larger than it", () => {
    expect(present(host("a"), PLANET_PALETTE.length).color).toBe(PLANET_PALETTE[0]);
    expect(present(host("a"), PLANET_PALETTE.length + 1).color).toBe(PLANET_PALETTE[1]);
  });

  it("uses a per-index rune id (independent of host id/name)", () => {
    expect(present(host("a", "corsair"), 0).symbol).toBe(RUNE_IDS[0]);
    expect(present(host("x"), 1).symbol).toBe(RUNE_IDS[1]);
    expect(present(host("a", "corsair"), 1).symbol).toBe(present(host("z"), 1).symbol); // index, not id
  });

  it("shallow-merges a per-host override on top (additive, C4)", () => {
    const e = present(host("a", "vega"), 0, { color: "#123456", size: 2 });
    expect(e.color).toBe("#123456"); // override wins
    expect(e.size).toBe(2); // additive channel
    expect(e.symbol).toBe(RUNE_IDS[0]); // untouched base field survives
  });
});

describe("PLANET_PALETTE", () => {
  it("is the 10-color index (owner's first four kept; red last so a new host won't mimic Pluto)", () => {
    expect(PLANET_PALETTE).toEqual([
      "#ff9d3c", // amber
      "#56cfee", // cyan
      "#a855f7", // purple
      "#4fd6a0", // green
      "#f472b6", // pink
      "#ffd84d", // yellow
      "#9fe04a", // lime
      "#2bd4c4", // teal
      "#4f8ff5", // blue
      "#ff5d6c", // red
    ]);
    expect(new Set(PLANET_PALETTE).size).toBe(10); // all distinct
  });
});

describe("runeIdFor()", () => {
  it("returns the rune id at the index", () => {
    expect(runeIdFor(0)).toBe(RUNE_IDS[0]);
    expect(runeIdFor(3)).toBe(RUNE_IDS[3]);
  });

  it("wraps for fleets larger than the set", () => {
    expect(runeIdFor(RUNE_IDS.length)).toBe(RUNE_IDS[0]);
    expect(runeIdFor(RUNE_IDS.length + 2)).toBe(RUNE_IDS[2]);
  });
});

describe("serviceHealth()", () => {
  it("is the up/total fraction, and 1 when there are no declared services", () => {
    expect(serviceHealth(3, 4)).toBe(0.75);
    expect(serviceHealth(0, 0)).toBe(1); // nothing to be missing
    expect(serviceHealth(0, 2)).toBe(0);
  });
});

describe("planetSize()", () => {
  it("scales the base from SIZE_MIN (0 services) up to SIZE_MAX (cap), all healthy", () => {
    expect(planetSize(0, 1)).toBe(20);
    expect(planetSize(5, 1)).toBe(48);
    expect(planetSize(10, 1)).toBe(48); // saturates at the cap
  });

  it("grows monotonically with service count at full health", () => {
    expect(planetSize(1, 1)).toBeLessThan(planetSize(3, 1));
    expect(planetSize(3, 1)).toBeLessThan(planetSize(5, 1));
  });

  it("shrinks with declining health toward the MIN_HEALTH_SCALE floor", () => {
    expect(planetSize(5, 0)).toBeLessThan(planetSize(5, 1));
    expect(planetSize(5, 0)).toBe(Math.round(48 * 0.58)); // all-down = base × floor
  });

  it("clamps an out-of-range health into [0,1]", () => {
    expect(planetSize(5, 2)).toBe(planetSize(5, 1));
    expect(planetSize(5, -1)).toBe(planetSize(5, 0));
  });
});
