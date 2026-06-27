import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { setUI } from "../../src/store/ui";
import { useThemeSetting } from "../../src/theme-engine/settings";
import { cosmos } from "../../src/themes/cosmos";
import { COSMOS_SPEED, speedMultiplier } from "../../src/themes/cosmos/motion";

// Cosmos C1 — the regression-prone, jsdom-safe parts: the motion-tempo resolver (shared by the C1
// starfield + the C2 fleet) and the theme's declared animation settings. The canvas itself (rAF) isn't
// rendered here — it's exercised visually.

beforeEach(() => {
  setUI({ themeSettings: {} }); // clear overrides (module state persists between tests)
});

describe("speedMultiplier", () => {
  it("maps each tempo to its declared multiplier", () => {
    expect(speedMultiplier("calm")).toBe(COSMOS_SPEED.calm);
    expect(speedMultiplier("normal")).toBe(COSMOS_SPEED.normal);
    expect(speedMultiplier("lively")).toBe(COSMOS_SPEED.lively);
  });

  it("falls back to the normal tempo for undefined (no override) OR an unrecognized value", () => {
    expect(speedMultiplier(undefined)).toBe(COSMOS_SPEED.normal);
    expect(speedMultiplier("warp-9")).toBe(COSMOS_SPEED.normal); // never an out-of-range multiplier
  });
});

describe("cosmos animation settings", () => {
  it("declares moonStyle (default cutout) + orbitalMotion (default on) + motionSpeed (default normal)", () => {
    expect(cosmos.settings?.moonStyle).toMatchObject({ type: "seg", default: "cutout" });
    const moonOpts = (cosmos.settings?.moonStyle as { options: { val: string }[] }).options.map(
      (o) => o.val,
    );
    expect(moonOpts).toEqual(["cutout", "carved"]);
    expect(cosmos.settings?.orbitalMotion).toMatchObject({ type: "switch", default: true });
    expect(cosmos.settings?.motionSpeed).toMatchObject({ type: "seg", default: "normal" });
    const speedOpts = (cosmos.settings?.motionSpeed as { options: { val: string }[] }).options.map(
      (o) => o.val,
    );
    expect(speedOpts).toEqual(["calm", "normal", "lively"]);
  });

  it("resolves to its declared defaults via useThemeSetting (animation on out of the box)", () => {
    const { result: orbital } = renderHook(() =>
      useThemeSetting<boolean>("cosmos", "orbitalMotion"),
    );
    expect(orbital.current).toBe(true);
    const { result: speed } = renderHook(() => useThemeSetting<string>("cosmos", "motionSpeed"));
    expect(speed.current).toBe("normal");
  });
});
