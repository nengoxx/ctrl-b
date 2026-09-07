import { describe, expect, it } from "vitest";

import { ORACLE_P_VAR, ORACLE_RAMP_VAR } from "../../src/themes/gacha/oracle";
import { parsePx, progressValue, scrollProgress } from "../../src/theme-engine/kit/scrollProgress";

// The SCROLL-WALK's pure half. Authored for gacha's M7 (D52 G3 / GACHA_PLAN §4.2 + §10.2) and LIFTED to the
// kit at D70 S6 when the shared agent backdrop grew the same walk over the same scroller — hence the move of
// this file and the plain names; every assertion below is the one it shipped with. The DOM halves are
// exercised in gachaAgent.test.tsx and agentBackdrop.test.tsx; what lives here is the arithmetic both are
// built on — the one part that can be wrong SILENTLY (an off-by-a-scroller walk just looks "a bit early",
// never throws). The two gacha PROPERTY NAMES stay imported from the theme: the pin below is about gacha's
// CSS contract, which did not move.

describe("scrollProgress — the ramp", () => {
  const BASE = 120; // the oracle sits 120px into the scroller (below the appbar)
  const RAMP = 240; // the prototype's own ramp

  it("is 0 before the oracle reaches the top edge, and at exactly that moment", () => {
    expect(scrollProgress(0, BASE, RAMP)).toBe(0);
    expect(scrollProgress(BASE, BASE, RAMP)).toBe(0);
  });

  it("walks linearly across the ramp and pins at 1 past its end", () => {
    expect(scrollProgress(BASE + 60, BASE, RAMP)).toBeCloseTo(0.25, 6);
    expect(scrollProgress(BASE + 120, BASE, RAMP)).toBeCloseTo(0.5, 6);
    expect(scrollProgress(BASE + RAMP, BASE, RAMP)).toBe(1);
    expect(scrollProgress(BASE + 4000, BASE, RAMP)).toBe(1);
  });

  it("clamps at 0 on overscroll/bounce (a negative scrollTop is a real iOS/Gecko reading)", () => {
    expect(scrollProgress(-80, BASE, RAMP)).toBe(0);
  });

  it("MEASURES FROM THE OFFSET, not from absolute scrollTop (the §4.2 ruling)", () => {
    // The same scroll position means different things for two different bases — which is exactly why the
    // shared `#app-scroll` cannot be read raw: another tab's scroll would boot the oracle half-ghosted.
    expect(scrollProgress(240, 0, RAMP)).toBe(1);
    expect(scrollProgress(240, 240, RAMP)).toBe(0);
  });

  it("a zeroed or negative ramp means NO fade rather than NaN/Infinity", () => {
    expect(scrollProgress(500, BASE, 0)).toBe(0);
    expect(scrollProgress(500, BASE, -10)).toBe(0);
    expect(scrollProgress(500, BASE, Number.NaN)).toBe(0);
  });
});

describe("parsePx — the ramp token", () => {
  it("reads a px length, with or without the whitespace getPropertyValue leaves", () => {
    expect(parsePx("240px")).toBe(240);
    expect(parsePx(" 240px ")).toBe(240);
    expect(parsePx("12.5px")).toBe(12.5);
  });

  it("returns null for anything that is not a px length — the token is the only source", () => {
    // An absent token (stylesheet not loaded yet) must NOT silently become some hardcoded default: the
    // driver simply does not write, and the ramp stays at its CSS `var(…, 0)` — sharp art, no fade.
    expect(parsePx("")).toBeNull();
    expect(parsePx("240")).toBeNull();
    expect(parsePx("30%")).toBeNull();
    expect(parsePx("15rem")).toBeNull();
    expect(parsePx("calc(240px + 1px)")).toBeNull();
  });
});

describe("progressValue", () => {
  it("quantizes to 1/1000 so a sub-perceptual scroll cannot dirty style", () => {
    expect(progressValue(0)).toBe("0.000");
    expect(progressValue(1)).toBe("1.000");
    expect(progressValue(0.123456)).toBe("0.123");
    expect(progressValue(0.1234)).toBe(progressValue(0.12344));
  });
});

describe("the custom-property contract", () => {
  it("names the properties the CSS ramp reads (one source for both halves)", () => {
    // A rename on one side only is the failure this pins: gacha.css derives opacity/scale/crossfade from
    // `--gc-oracle-p` and declares `--gc-oracle-ramp` in tokens.css.
    expect(ORACLE_P_VAR).toBe("--gc-oracle-p");
    expect(ORACLE_RAMP_VAR).toBe("--gc-oracle-ramp");
  });
});
