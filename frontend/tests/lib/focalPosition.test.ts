import { describe, expect, it } from "vitest";

import {
  centredFocal,
  focalAxis,
  focalPosition,
  proportionalFocal,
  shiftFocalX,
  FOCAL_EPSILON,
} from "../../src/lib/focalPosition";
import { COVER_HERO_SHIFT } from "../../src/themes/gacha/fleet";
import { defaultRoster } from "../../src/themes/gacha/roster";

// The FOCAL POINT's math (D65 / MEDIA_MANAGER_PLAN §11's focal arms, R57 §5) — the whole module is
// pure, so every arm the plan names is an ordinary assertion here: exact-1 · near-1 · clamps both ends
// · proportional mode · missing w/h. Plus the two the S4 rewrite is ACCEPTED on: the shipped bundled
// values come back byte-identical, and so does every output the retired `coverHeroFocus` produced.

describe("focalAxis — P(f, s), the guard included", () => {
  it("centres the point when the box really crops (R57 §5.4's own worked checks)", () => {
    // s = 2, f = 0.25 -> (0.5 − 0.5)/1 = 0: the image's left edge at the box's left edge, which puts
    // the focal point dead centre.
    expect(focalAxis(0.25, 2)).toBe(0);
    expect(focalAxis(0.5, 3)).toBe(0.5);
    // s = 2, f = 0.75 -> (1.5 − 0.5)/1 = 1.
    expect(focalAxis(0.75, 2)).toBe(1);
    expect(focalAxis(0.6, 2)).toBeCloseTo(0.7, 10);
  });

  it("EXACT 1 answers 0.5 rather than dividing by zero (Emma #1 — the guard IS the contract)", () => {
    // Under `object-fit: cover` at least one axis always has s = 1, so this is not an edge case: it is
    // every single call. The bare formula would be 0/0 = NaN, and one NaN voids the WHOLE
    // `object-position` declaration — taking the other axis's correct value down with it.
    expect(focalAxis(0.2, 1)).toBe(0.5);
    expect(focalAxis(0.9, 1)).toBe(0.5);
  });

  it("NEAR 1 answers 0.5 too — measured floats never land on exactly 1", () => {
    expect(focalAxis(0.2, 1 + FOCAL_EPSILON / 2)).toBe(0.5);
    expect(focalAxis(0.2, 1.0000000000000002)).toBe(0.5);
    // …and just outside the band the real formula takes over, where an f that is not 0.5 clamps hard.
    expect(focalAxis(0.25, 1 + FOCAL_EPSILON * 10)).toBe(0);
  });

  it("CLAMPS at both ends", () => {
    expect(focalAxis(0.9, 2)).toBe(1);
    expect(focalAxis(0.1, 2)).toBe(0);
    expect(focalAxis(-5, 4)).toBe(0);
    expect(focalAxis(5, 4)).toBe(1);
  });

  it("answers 0.5 for non-finite inputs — this is a render path", () => {
    expect(focalAxis(Number.NaN, 2)).toBe(0.5);
    expect(focalAxis(0.3, Number.POSITIVE_INFINITY)).toBe(0.5);
  });
});

describe("focalPosition — one item's framing in one window", () => {
  const box = { width: 300, height: 300 };

  it("PROPORTIONAL mode passes its hand-tuned string through untouched, box or no box", () => {
    const art = proportionalFocal("50% 12%");
    expect(focalPosition(art, box)).toBe("50% 12%");
    expect(focalPosition(art, null)).toBe("50% 12%");
    // Including values the centred path could not have produced — the mode means "whatever the browser
    // has always done with this", not "a pair of percentages".
    expect(focalPosition(proportionalFocal("center top"), box)).toBe("center top");
  });

  it("CENTRED maps through the box's own overflow, per axis", () => {
    // A 600x300 source in a 300x300 box: sx = 2 (cropped), sy = 1 (exact — the guard's axis).
    const art = centredFocal({ x: 0.25, y: 0.25 }, 600, 300);
    expect(focalPosition(art, box)).toBe("0% 50%");
    // The SAME item in a window of a different shape is a different answer — which is the whole
    // reason this is computed per window rather than published once. A 300x600 portrait window of the
    // same 600x300 source crops the OTHER axis: sx = 4, sy = 1, so the guard swaps sides too.
    expect(focalPosition(art, { width: 300, height: 600 })).toBe("16.6667% 50%");
  });

  it("degrades to PROPORTIONAL with no box (the unmeasurable-surface case, §5)", () => {
    expect(focalPosition(centredFocal({ x: 0.42, y: 0.18 }, 600, 300), null)).toBe("42% 18%");
  });

  it("degrades to PROPORTIONAL when the source's own size is MISSING", () => {
    // The index could not `stat`/probe the file, or nothing has loaded it yet: without the source
    // pixels there is no `s` to compute, and guessing one would move the picture for a reason nobody
    // could see.
    expect(focalPosition(centredFocal({ x: 0.42, y: 0.18 }, null, null), box)).toBe("42% 18%");
    expect(focalPosition(centredFocal({ x: 0.42, y: 0.18 }, 600, null), box)).toBe("42% 18%");
  });

  it("degrades on a DEGENERATE box or source rather than emitting NaN", () => {
    const art = centredFocal({ x: 0.3, y: 0.7 }, 600, 300);
    expect(focalPosition(art, { width: 0, height: 0 })).toBe("30% 70%");
    expect(focalPosition(centredFocal({ x: 0.3, y: 0.7 }, 0, 300), box)).toBe("30% 70%");
  });

  it("emits no trailing zeros, so a round trip is byte-identical", () => {
    expect(focalPosition(centredFocal({ x: 0.5, y: 0.12 }, null, null), null)).toBe("50% 12%");
    expect(focalPosition(centredFocal({ x: 0.1425, y: 1 }, null, null), null)).toBe("14.25% 100%");
  });
});

describe("the dimensions the mapping trusts are the PAINTED ones (Emma's S4 review #3)", () => {
  it("crops the axis the BROWSER crops, for a quarter-turn JPEG dropped in over SSH", () => {
    // A phone portrait shot lands on disk as a 400x200 frame with EXIF Orientation=6, and every engine
    // lays it out 200x400. The server now reports the PAINTED size (`core/media.py#_exif_orientation`),
    // so this is what reaches the mapper — and in a 200-wide, 200-tall window that means the picture
    // overflows VERTICALLY (s = 2 down, 1 across), which is the opposite of what the frame header says.
    const painted = centredFocal({ x: 0.5, y: 0.25 }, 200, 400);
    expect(focalPosition(painted, { width: 200, height: 200 })).toBe("50% 0%");
    // …and had the raw frame been reported instead, the SAME point would have moved the picture along
    // the axis that is not cropping and left the one that is at the guard's centre. That is the whole
    // defect, stated as the value it would have produced.
    const raw = centredFocal({ x: 0.5, y: 0.25 }, 400, 200);
    expect(focalPosition(raw, { width: 200, height: 200 })).toBe("50% 50%");
  });
});

describe("shiftFocalX — the per-window offset that replaced `coverHeroFocus`", () => {
  // Every arm below is the retired function's own, with the SAME expected strings: the S4 rewrite is
  // accepted on producing byte-identical output for every state that exists today.
  const shift = (pos: string) => shiftFocalX(pos, -COVER_HERO_SHIFT);

  it("shifts the X left by the constant and leaves the Y alone", () => {
    expect(shift("50% 26%")).toBe("30% 26%");
    // the bundled entries carry real focal points, and the shift STACKS on top of them
    expect(shift("50% 12%")).toBe("30% 12%");
    expect(shift("50% 8%")).toBe("30% 8%");
  });

  it("clamps at zero rather than going negative", () => {
    expect(shift("10% 40%")).toBe("0% 40%");
    expect(shift("0% 40%")).toBe("0% 40%");
  });

  it("degrades junk to the INPUT rather than throwing (it is on a render path)", () => {
    for (const junk of ["center top", "", "50%", "left 20%", "not a focus at all"])
      expect(shift(junk)).toBe(junk);
  });

  it("keeps a fractional X fractional", () => {
    expect(shift("50.5% 30%")).toBe("30.5% 30%");
  });

  it("refuses a percentage that PARSES but is not finite (Codex E2 LOW-8)", () => {
    // A 400-digit percentage matches the shape and converts through `Number()` to Infinity, and
    // `Infinity% 20%` is not a crop — it is an invalid declaration the browser drops, taking the
    // entry's own framing down with it. Degrade to the input, like every other junk case.
    const huge = `${"9".repeat(400)}% 20%`;
    expect(Number("9".repeat(400)), "the fixture must really overflow").toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(shift(huge)).toBe(huge);
    expect(shift(`-${"9".repeat(400)}% 20%`)).toBe(`-${"9".repeat(400)}% 20%`);
  });

  it("shifts a CENTRED value too — it works on the resolved position, not on the point", () => {
    const art = centredFocal({ x: 0.75, y: 0.5 }, 600, 300);
    expect(focalPosition(art, { width: 300, height: 300 })).toBe("100% 50%");
    expect(shift(focalPosition(art, { width: 300, height: 300 }))).toBe("80% 50%");
  });
});

describe("THE PARITY LINE — the shipped bundled art is byte-identical through the rewrite", () => {
  it("every bundled roster entry's hand-tuned value survives the new formatter exactly", () => {
    // The acceptance line for the ~10-paint-site rewrite (MEDIA_MANAGER_PLAN §12's S4 gate): until an
    // owner sets a framing point, every surface must paint what it painted before. The bundled cast is
    // the only art in the app that carries a value at all, so this is that whole state.
    const shipped = new Map([
      ["pegasus", "50% 12%"],
      ["3", "50% 14%"],
      ["4", "50% 8%"],
    ]);
    const entries = defaultRoster().entries;
    expect(
      entries
        .filter((e) => e.focus !== undefined)
        .map((e) => e.name)
        .sort(),
    ).toEqual([...shipped.keys()].sort());
    for (const entry of entries) {
      const expected = shipped.get(entry.name);
      if (expected === undefined) {
        expect(entry.focus, `${entry.name} declares no focus`).toBeUndefined();
        continue;
      }
      expect(entry.focus).toEqual({ mode: "proportional", value: expected });
      // …in EVERY window shape, measured or not, and through the hero's shift.
      for (const win of [null, { width: 160, height: 213 }, { width: 390, height: 700 }])
        expect(focalPosition(entry.focus!, win)).toBe(expected);
      expect(shiftFocalX(expected, -COVER_HERO_SHIFT)).toBe(expected.replace("50%", "30%"));
    }
  });
});
