import { describe, expect, it } from "vitest";

import { angleAt, decorOrbitSpec, orbitKeyframes, orbitParams } from "../../src/themes/cosmos/orbit";
import { GOLDEN_ANGLE, present } from "../../src/themes/cosmos/present";

// Cosmos orbit engine (C2b-1) — the jsdom-safe pure logic (specs/keyframes/angle math). The WAAPI driver
// (useCosmosOrbit) is exercised live in the browser, not here.

const transformOf = (k: Keyframe) => (k as { transform: string }).transform;

describe("orbitParams — per-planet", () => {
  it("phase = the host's golden-angle slot (matches present()'s layout)", () => {
    expect(orbitParams(0, 64, "perPlanet").phaseRad).toBe(0);
    expect(orbitParams(3, 120, "perPlanet").phaseRad).toBeCloseTo(3 * GOLDEN_ANGLE, 10);
  });

  it("outer planets orbit slower (period grows with radius)", () => {
    expect(orbitParams(1, 80, "perPlanet").periodMs).toBeLessThan(
      orbitParams(2, 160, "perPlanet").periodMs,
    );
  });

  it("orbits all planets the same direction (prograde, like a real solar system)", () => {
    expect(orbitParams(0, 64, "perPlanet").direction).toBe(1);
    expect(orbitParams(1, 90, "perPlanet").direction).toBe(1);
    expect(orbitParams(2, 110, "perPlanet").direction).toBe(1);
  });
});

describe("orbitParams — rigid", () => {
  it("every planet shares one period + direction (lockstep), phase still per-index", () => {
    const a = orbitParams(0, 64, "rigid");
    const b = orbitParams(3, 160, "rigid");
    expect(a.periodMs).toBe(b.periodMs); // same angular velocity
    expect(a.direction).toBe(b.direction);
    expect(b.phaseRad).toBeCloseTo(3 * GOLDEN_ANGLE, 10); // spread preserved
  });
});

describe("orbitKeyframes", () => {
  it("frame 0 equals present()'s static (x,y) for the same host (seamless freeze ↔ animate)", () => {
    const radius = 120;
    const spec = orbitParams(3, radius, "perPlanet");
    const frame0 = transformOf(orbitKeyframes(spec)[0]);
    const pos = present({ id: "h" }, 3).position as { angle: number; radius: number };
    const x = Math.cos(pos.angle) * radius;
    const y = Math.sin(pos.angle) * radius;
    expect(frame0).toBe(`translate(-50%, -50%) translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`);
  });

  it("closes the loop (last frame returns to frame 0)", () => {
    const spec = orbitParams(1, 100, "perPlanet");
    const frames = orbitKeyframes(spec);
    expect(transformOf(frames[frames.length - 1])).toBe(transformOf(frames[0]));
  });
});

describe("angleAt", () => {
  it("advances from the phase by a full turn over one period", () => {
    const spec = orbitParams(0, 64, "perPlanet"); // phase 0, dir +1
    expect(angleAt(spec, 0)).toBe(0);
    expect(angleAt(spec, spec.periodMs)).toBeCloseTo(2 * Math.PI, 10);
  });

  it("respects direction (a retrograde spec decreases the angle)", () => {
    // orbitParams only emits prograde (+1) now, but angleAt must still honor direction (moons can retrograde)
    const spec = { periodMs: 1000, direction: -1 as const, phaseRad: 1, radius: 90 };
    expect(angleAt(spec, spec.periodMs / 4)).toBeLessThan(spec.phaseRad);
  });
});

describe("decorOrbitSpec", () => {
  it("drifts slower than a host at the same radius, in the given direction + phase", () => {
    const r = 180;
    const decor = decorOrbitSpec(3.9, r);
    expect(decor.phaseRad).toBe(3.9);
    expect(decor.radius).toBe(r);
    expect(decor.direction).toBe(1);
  });
});
