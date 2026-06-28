import { describe, expect, it } from "vitest";

import { shouldDismiss } from "../../src/components/BottomSheet";

// BottomSheet snap-decision (Cosmos C3a). The drag/transform itself is verified live (jsdom can't render the
// gesture); this covers the pure helper: dismiss on a fast downward flick OR a drag past ~25% of the sheet.

const H = 400; // sheet height → 25% threshold = 100px

describe("shouldDismiss", () => {
  it("keeps the sheet open for a small slow drag", () => {
    expect(shouldDismiss(40, H, 0.1)).toBe(false);
    expect(shouldDismiss(99, H, 0)).toBe(false);
  });

  it("dismisses past the 25% distance threshold", () => {
    expect(shouldDismiss(101, H, 0)).toBe(true);
    expect(shouldDismiss(250, H, 0)).toBe(true);
  });

  it("dismisses on a fast downward flick regardless of distance", () => {
    expect(shouldDismiss(20, H, 0.6)).toBe(true); // barely moved, but flicked hard
  });

  it("does not dismiss on a slow flick under the velocity threshold", () => {
    expect(shouldDismiss(20, H, 0.4)).toBe(false);
  });

  it("never dismisses on an upward (or zero) drag", () => {
    expect(shouldDismiss(0, H, 5)).toBe(false);
    expect(shouldDismiss(-200, H, 5)).toBe(false);
  });

  it("scales the distance threshold with the sheet height", () => {
    expect(shouldDismiss(120, 800, 0)).toBe(false); // 120 < 25% of 800 (=200)
    expect(shouldDismiss(120, 400, 0)).toBe(true); // 120 > 25% of 400 (=100)
  });
});
