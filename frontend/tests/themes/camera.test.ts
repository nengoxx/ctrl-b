import { describe, expect, it } from "vitest";

import { damp, followTarget, planetXY } from "../../src/themes/cosmos/camera";
import { orbitParams } from "../../src/themes/cosmos/orbit";

// Cosmos camera (C2b-2) — the jsdom-safe pure math (target + damping + analytic position). The rAF loop +
// DOM transform writes are exercised live in the browser.

describe("followTarget", () => {
  it("centers (px,py) at the origin, scaled by the zoom", () => {
    expect(followTarget(50, -20, 2)).toEqual({ s: 2, tx: -100, ty: 40 });
  });
  it("origin planet → only zoom (no translate)", () => {
    const t = followTarget(0, 0, 2.2);
    expect(t.s).toBe(2.2);
    expect(t.tx).toBeCloseTo(0, 10); // ±0 either way (renders "0.00")
    expect(t.ty).toBeCloseTo(0, 10);
  });
  it("applies the live-zone center offset to ty (lifts the system above the composer)", () => {
    expect(followTarget(50, -20, 2, -30)).toEqual({ s: 2, tx: -100, ty: -30 + 40 });
    expect(followTarget(0, 0, 2.2, -16).ty).toBeCloseTo(-16, 10);
  });
});

describe("damp", () => {
  it("returns cur at dt=0 and approaches target as dt grows", () => {
    expect(damp(0, 10, 7, 0)).toBe(0);
    expect(damp(0, 10, 7, 100000)).toBeCloseTo(10, 6);
  });
  it("moves monotonically toward the target", () => {
    const a = damp(0, 10, 7, 50);
    const b = damp(a, 10, 7, 50);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(10);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(10);
  });
  it("is frame-rate independent (two half-steps ≈ one full step)", () => {
    const full = damp(0, 10, 7, 100);
    const half1 = damp(0, 10, 7, 50);
    const half2 = damp(half1, 10, 7, 50);
    expect(half2).toBeCloseTo(full, 6);
  });
});

describe("planetXY", () => {
  it("at t=0 is the planet's static position (R·cosφ, R·sinφ)", () => {
    const spec = orbitParams(3, 120, "perPlanet");
    const { x, y } = planetXY(spec, 0);
    expect(x).toBeCloseTo(Math.cos(spec.phaseRad) * 120, 10);
    expect(y).toBeCloseTo(Math.sin(spec.phaseRad) * 120, 10);
  });
  it("after a quarter period it has moved off the start point", () => {
    const spec = orbitParams(0, 100, "perPlanet"); // phase 0
    const start = planetXY(spec, 0);
    const quarter = planetXY(spec, spec.periodMs / 4);
    expect(Math.hypot(quarter.x - start.x, quarter.y - start.y)).toBeGreaterThan(1);
  });
});
