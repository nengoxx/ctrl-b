import { describe, expect, it } from "vitest";

import {
  CROP_RATIOS,
  cropReducer,
  cropResult,
  initialCropState,
  MAX_ZOOM,
  MIN_ZOOM,
  SOURCE_RATIO,
  type CropState,
} from "../../src/components/media/CropModal";

// The CROP STATE MACHINE (D65 / MEDIA_MANAGER_PLAN §4) — the part of the crop step that is OURS.
//
// The gestures belong to `react-easy-crop`; what belongs here is when a crop counts as TOUCHED and
// what an untouched confirm produces, and that is exactly the half that can be silently wrong: the
// library reports a rect as soon as it has measured its container, so a machine that treated a report
// as an edit would make "use as is" unreachable — every confirm would submit a rect the owner never
// chose, one rounding away from the whole picture, on every upload.

const natural = { width: 4000, height: 3000 };
const rect = { x: 100, y: 200, width: 800, height: 600 };

describe("cropReducer", () => {
  it("starts at the picture's own proportions, untouched", () => {
    expect(initialCropState.ratio).toBe(SOURCE_RATIO);
    expect(initialCropState.touched).toBe(false);
    expect(initialCropState.zoom).toBe(MIN_ZOOM);
  });

  it("NOTHING the library reports counts as an edit — rect, pan or zoom", () => {
    // Caught in a real browser: react-easy-crop emits all three while it MEASURES, so a fresh modal
    // was already offering "Use this crop". Reading any of them as an edit makes "use as is"
    // unreachable on every upload forever.
    const reported = cropReducer(initialCropState, { t: "rect", rect });
    expect(reported.rect).toEqual(rect);
    expect(reported.touched).toBe(false);
    expect(cropReducer(initialCropState, { t: "move", crop: { x: 5, y: 0 } }).touched).toBe(false);
    expect(cropReducer(initialCropState, { t: "zoom", zoom: 2 }).touched).toBe(false);
  });

  it("…what the OWNER does counts: a gesture, the slider, a shape change", () => {
    expect(cropReducer(initialCropState, { t: "interact" }).touched).toBe(true);
    expect(cropReducer(initialCropState, { t: "ratio", ratio: "1:1" }).touched).toBe(true);
  });

  it("clamps zoom to the range the library was given", () => {
    expect(cropReducer(initialCropState, { t: "zoom", zoom: 99 }).zoom).toBe(MAX_ZOOM);
    expect(cropReducer(initialCropState, { t: "zoom", zoom: -1 }).zoom).toBe(MIN_ZOOM);
  });

  it("resets the pan when the shape changes", () => {
    // Leaving the old offset under a differently-shaped window puts the subject somewhere the owner
    // did not put it.
    const panned: CropState = { ...initialCropState, crop: { x: 40, y: -20 } };
    expect(cropReducer(panned, { t: "ratio", ratio: "16:9" }).crop).toEqual({ x: 0, y: 0 });
  });

  it("offers ordinary shapes, none of them the destination's — free ratio is the ruling", () => {
    expect(CROP_RATIOS.map((r) => r.id)).toEqual(["1:1", "4:3", "3:4", "16:9", "9:16"]);
    expect(CROP_RATIOS.every((r) => r.value > 0)).toBe(true);
  });
});

describe("cropResult", () => {
  it("untouched = the WHOLE picture, stated exactly", () => {
    // Not the reported rect, which is a rounding away — and still the same export, so "as is" is
    // never the one path that skips the re-encode, the pixel cap and the EXIF strip (R54's warning).
    const reported = cropReducer(initialCropState, { t: "rect", rect });
    expect(cropResult(reported, natural)).toEqual({ x: 0, y: 0, width: 4000, height: 3000 });
  });

  it("touched = the rect the library reported, in SOURCE pixels", () => {
    const state = cropReducer(cropReducer(initialCropState, { t: "interact" }), {
      t: "rect",
      rect,
    });
    expect(cropResult(state, natural)).toEqual(rect);
  });

  it("falls back to the whole picture when a gesture happened but no rect was ever reported", () => {
    // A container that never measured (a zero-height parent, a modal closed mid-gesture). The honest
    // answer is the whole picture; the alternative is a crop of nothing.
    const state = cropReducer(initialCropState, { t: "interact" });
    expect(cropResult(state, natural)).toEqual({ x: 0, y: 0, width: 4000, height: 3000 });
  });
});
