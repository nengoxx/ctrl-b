import { describe, expect, it } from "vitest";

import { isHighStar, MAX_STARS, starsFor, toStarMode } from "../../src/themes/gacha/stars";

// The ruled star ladders (D52 / GACHA_PLAN §6.1) — the owner's verbatim tables, transcribed as a data-driven
// case list so the test reads like the spec table it enforces. The input is CONFIGURED services (not live
// ones), the zero cell is the ruled ★1 floor, and the mode's single home is the `starMode` ThemeDef setting.

// [configured services, 5★ result, 3★ result] — GACHA_PLAN §6.1's table, row for row.
const LADDER: [number, number, number][] = [
  [0, 1, 1], // the ruled zero floor: a unit never renders starless
  [1, 1, 1],
  [2, 2, 2],
  [3, 3, 2],
  [4, 4, 3],
  [5, 5, 3],
  [6, 5, 3], // ≥5 tops out
  [20, 5, 3],
];

describe("starsFor — the ruled ladders", () => {
  it.each(LADDER)("%i configured services → ★%i (5★ mode) / ★%i (3★ mode)", (n, five, three) => {
    expect(starsFor(n, "five")).toBe(five);
    expect(starsFor(n, "three")).toBe(three);
  });

  it("never returns outside [1, MAX] for either mode", () => {
    for (let n = 0; n <= 30; n++) {
      for (const mode of ["five", "three"] as const) {
        const s = starsFor(n, mode);
        expect(s).toBeGreaterThanOrEqual(1);
        expect(s).toBeLessThanOrEqual(MAX_STARS[mode]);
      }
    }
  });

  it("survives impossible inputs at the floor rather than throwing (it is on a render path)", () => {
    expect(starsFor(-3, "five")).toBe(1);
    expect(starsFor(Number.NaN, "five")).toBe(1);
    expect(starsFor(2.7, "five")).toBe(2); // floored, not rounded up
  });
});

describe("MAX_STARS — what the rate pill announces", () => {
  it("is 5 / 3, matching the two modes", () => {
    expect(MAX_STARS.five).toBe(5);
    expect(MAX_STARS.three).toBe(3);
  });
});

describe("toStarMode — the setting bridge", () => {
  it("defaults to the ruled `five` for anything that isn't `three`", () => {
    expect(toStarMode("five")).toBe("five");
    expect(toStarMode("three")).toBe("three");
    expect(toStarMode(undefined)).toBe("five");
    expect(toStarMode("garbage")).toBe("five"); // a corrupt synced value can't invent a third scale
    expect(toStarMode(true)).toBe("five");
  });
});

describe("isHighStar — the rose-gold rungs (§6.2)", () => {
  it("5★ mode: the top TWO are rose, the first three gold", () => {
    expect([0, 1, 2, 3, 4].map((i) => isHighStar(i, "five"))).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it("3★ mode: only the third is rosy", () => {
    expect([0, 1, 2].map((i) => isHighStar(i, "three"))).toEqual([false, false, true]);
  });
});
