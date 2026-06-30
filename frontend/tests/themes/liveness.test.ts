import { describe, expect, it } from "vitest";

import { livenessParts, pulsePeriodMs } from "../../src/themes/cosmos/liveness";

// Cosmos liveness (C2b-3) — pure logic: the ping→breath-period mapping + the setting parse. The visuals
// (glow/ring) + Motion gating are CSS, reviewed live.

describe("pulsePeriodMs", () => {
  it("is fast (short period) for low latency, slow for high", () => {
    expect(pulsePeriodMs(1)).toBe(1600); // at/under the fast threshold
    expect(pulsePeriodMs(200)).toBe(4200); // at/over the slow threshold
    expect(pulsePeriodMs(50)).toBeGreaterThan(1600);
    expect(pulsePeriodMs(50)).toBeLessThan(4200);
  });

  it("is monotonic in ping (higher ping → longer/slower breath)", () => {
    expect(pulsePeriodMs(10)).toBeLessThan(pulsePeriodMs(60));
    expect(pulsePeriodMs(60)).toBeLessThan(pulsePeriodMs(110));
  });

  it("falls back to the slow end for unknown ping (null/undefined)", () => {
    expect(pulsePeriodMs(null)).toBe(4200);
    expect(pulsePeriodMs(undefined)).toBe(4200);
  });

  it("clamps out-of-range ping into [fast, slow]", () => {
    expect(pulsePeriodMs(-5)).toBe(1600);
    expect(pulsePeriodMs(99999)).toBe(4200);
  });
});

describe("livenessParts", () => {
  it("maps each setting value to the enabled parts", () => {
    expect(livenessParts("pulse")).toEqual({ pulse: true, halo: false });
    expect(livenessParts("halo")).toEqual({ pulse: false, halo: true });
    expect(livenessParts("both")).toEqual({ pulse: true, halo: true });
    expect(livenessParts("off")).toEqual({ pulse: false, halo: false });
  });

  it("defaults undefined (no override) to pulse", () => {
    expect(livenessParts(undefined)).toEqual({ pulse: true, halo: false });
  });
});
