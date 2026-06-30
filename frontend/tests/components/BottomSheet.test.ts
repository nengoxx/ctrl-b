import { describe, expect, it } from "vitest";

import { pickSnap } from "../../src/components/BottomSheet";

// BottomSheet snap selection (Cosmos C3c). The drag/transform itself is verified live (jsdom can't render the
// gesture); this covers the pure helper. snaps ascending: [0 = full, peekTy, fullH = closed].

const SNAPS = [0, 300, 500]; // full · peek (fullH−peekH) · closed (fullH)

describe("pickSnap", () => {
  it("slow release snaps to the nearest point", () => {
    expect(pickSnap(40, 0, SNAPS)).toBe(0); // near full
    expect(pickSnap(280, 0, SNAPS)).toBe(300); // near peek
    expect(pickSnap(470, 0.1, SNAPS)).toBe(500); // near closed
  });

  it("a fast flick DOWN steps one snap toward closed", () => {
    expect(pickSnap(10, 0.8, SNAPS)).toBe(300); // full → peek
    expect(pickSnap(300, 0.8, SNAPS)).toBe(500); // peek → closed (dismiss)
  });

  it("a fast flick UP steps one snap toward full", () => {
    expect(pickSnap(300, -0.8, SNAPS)).toBe(0); // peek → full
    expect(pickSnap(500, -0.8, SNAPS)).toBe(300); // closed-ish → peek
  });

  it("a flick UP at full stays full (clamped at the first snap)", () => {
    expect(pickSnap(0, -0.8, SNAPS)).toBe(0);
  });

  it("a slow drag that doesn't pass the midpoint bounces back", () => {
    expect(pickSnap(120, 0.1, SNAPS)).toBe(0); // 120 closer to 0 than 300 → back to full
    expect(pickSnap(360, 0.1, SNAPS)).toBe(300); // 360 closer to 300 than 500 → back to peek
  });

  it("two-state sheet (no peek detent): nearest / flick to close", () => {
    const s2 = [0, 500];
    expect(pickSnap(40, 0, s2)).toBe(0); // bounce back to full
    expect(pickSnap(300, 0, s2)).toBe(500); // past midpoint → closed
    expect(pickSnap(10, 0.8, s2)).toBe(500); // flick down → closed
  });
});
