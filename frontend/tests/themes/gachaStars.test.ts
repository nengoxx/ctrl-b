/// <reference types="node" />
// ^ the rarity-ladder guard below reads gacha's tokens.css from disk (fs/path/process); the tests tsconfig
//   pins `types:["vitest"]`, so node's globals are pulled in explicitly (the gachaChrome precedent).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isHighStar,
  MAX_STARS,
  rarityToken,
  starsFor,
  toStarMode,
} from "../../src/themes/gacha/stars";

// The ruled star ladders (D52 / GACHA_PLAN §6.1) — the owner's verbatim tables, transcribed as a data-driven
// case list so the test reads like the spec table it enforces. The input is CONFIGURED services (not live
// ones), the zero cell is the ruled ★1 floor, and the mode's single home is the `starMode` ThemeDef setting.

// [configured services, 5★ result, 3★ result] — GACHA_PLAN §6.1's table, row for row. The 3★ column
// carries the G1-eyeball re-rule (owner, 2026-08-02): ≥3 services → ★3 (the lock table's "two or
// three → ★2" collapsed a real 2-vs-3 difference on the owner's fleet).
const LADDER: [number, number, number][] = [
  [0, 1, 1], // the ruled zero floor: a unit never renders starless
  [1, 1, 1],
  [2, 2, 2],
  [3, 3, 3], // 3★'s top rung starts here now
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

// ── rarityToken — the alt-fleet POSTER's hue ladder (GACHA_PLAN §12.6 rulings 8 + 11) ──────────────────
// MODE-RELATIVE, which is the whole ruling: the top rung must read GOLD on both scales (the `isHighStar`
// precedent), so 3★ mode walks the SAME five-rung token set at 1 / 3 / 5 rather than stopping at cyan.
describe("rarityToken — the mode-relative rarity ladder", () => {
  it("5★ mode walks silver → green → cyan → purple → gold, one rung per star", () => {
    expect([1, 2, 3, 4, 5].map((n) => rarityToken(n, "five"))).toEqual([
      "var(--gc-rar-1)",
      "var(--gc-rar-2)",
      "var(--gc-rar-3)",
      "var(--gc-rar-4)",
      "var(--gc-rar-5)",
    ]);
  });

  it("3★ mode is silver → cyan → GOLD (the top rung is gold on both scales)", () => {
    expect([1, 2, 3].map((n) => rarityToken(n, "three"))).toEqual([
      "var(--gc-rar-1)",
      "var(--gc-rar-3)",
      "var(--gc-rar-5)",
    ]);
  });

  it("the top rung of BOTH modes is the same token — a ★5 and a ★3 flagship read alike", () => {
    expect(rarityToken(MAX_STARS.five, "five")).toBe(rarityToken(MAX_STARS.three, "three"));
  });

  it("clamps at both ends and survives impossible input (it is on a render path)", () => {
    expect(rarityToken(0, "five")).toBe("var(--gc-rar-1)");
    expect(rarityToken(-4, "three")).toBe("var(--gc-rar-1)");
    expect(rarityToken(9, "five")).toBe("var(--gc-rar-5)");
    expect(rarityToken(9, "three")).toBe("var(--gc-rar-5)");
    expect(rarityToken(Number.NaN, "five")).toBe("var(--gc-rar-1)");
    expect(rarityToken(3.9, "five")).toBe("var(--gc-rar-3)"); // floored, like starsFor
  });

  it("every token it can name is declared in tokens.css EXACTLY ONCE", () => {
    // TWO silent failure modes, one assertion. Missing: `var(--gc-rar-6)` resolves to the empty value and
    // the slice loses its keyline, its drop and its name colour at once, with no error anywhere.
    // DUPLICATED (Codex E1 review, LOW-6 — a real one shipped in this slice's own first pass): two
    // declarations in the same scope means the later one wins, so an E5 retune edits the documented
    // ladder and the UI silently keeps the old colours. Counting is what catches the second case, which
    // is why this asserts a count rather than presence.
    const tokens = readFileSync(resolve(process.cwd(), "src/themes/gacha/tokens.css"), "utf8");
    const named = new Set(
      [1, 2, 3, 4, 5]
        .flatMap((n) => [rarityToken(n, "five"), rarityToken(n, "three")])
        .concat("var(--gc-rar-off)"),
    );
    for (const value of named) {
      const name = value.slice("var(".length, -1);
      const hits = tokens.split(`${name}:`).length - 1;
      expect(hits, `${name} must be declared exactly once in gacha's tokens.css`).toBe(1);
    }
  });
});
