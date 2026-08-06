import { describe, expect, it } from "vitest";

import { ORACLE_GHOST_DATA, oracleGhosting } from "../../src/themes/gacha/oracle";

// The GHOSTING stamp's pure half (M7, owner reports 2026-08-06). The block's bottom-dissolve mask keys on a
// BOOLEAN rather than on the ramp, because a mask whose geometry tracked `--gc-oracle-p` would re-rasterize
// a gradient every scroll frame — the paint cost M7's one-write-per-frame design exists to avoid. Two
// things have to hold, and both were owner-reported before they were tested:
//   · it flips at the END of the ramp, where the block is already at its opacity floor and the softening
//     edge is imperceptible. Keyed near p=0 the mask's arrival POPPED on a still-bright picture.
//   · HYSTERESIS: a scroller parked at the flip point wobbles by a pixel, and a single threshold would
//     toggle the attribute — and the mask — on every one of those frames.
describe("the oracle's ghosting stamp", () => {
  it("turns on only at the END of the ramp, where the block is at its floor", () => {
    expect(oracleGhosting(0, false)).toBe(false);
    expect(oracleGhosting(0.5, false)).toBe(false); // mid-ramp: still the crisp designed edge
    expect(oracleGhosting(0.94, false)).toBe(false);
    expect(oracleGhosting(0.95, false)).toBe(true);
    expect(oracleGhosting(1, false)).toBe(true);
  });

  it("releases LOWER than it engages — the Schmitt gap that stops boundary flicker", () => {
    // Once on it survives the whole deadband, so scrolling back up releases it while the block is still
    // near the floor rather than toggling across the engage point.
    expect(oracleGhosting(0.94, true)).toBe(true);
    expect(oracleGhosting(0.88, true)).toBe(true);
    expect(oracleGhosting(0.87, true)).toBe(false);
    expect(oracleGhosting(0, true)).toBe(false);
  });

  it("names the dataset key the CSS gate reads", () => {
    // `el.dataset[ORACLE_GHOST_DATA]` ⇒ `[data-gc-ghosting]`, which is what gacha.css matches.
    expect(ORACLE_GHOST_DATA).toBe("gcGhosting");
  });
});
