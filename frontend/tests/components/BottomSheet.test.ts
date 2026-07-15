import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BottomSheet, pickSnap } from "../../src/components/BottomSheet";

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

// data-settling STATE stamp (Gate B, 2026-07-15). The primitive marks the sheet element while a programmatic
// slide plays so a skin can react (cosmos.css drops its Gecko backdrop blur only for this window). Unlike the
// pure `pickSnap` cases above these mount the real component: jsdom reports offsetHeight 0 (no peek detent),
// so the sheet is a plain full sheet — enough to observe the stamp lifecycle. The enter slide is scheduled in
// a rAF and the stamp self-clears after SNAP_MS (420) + 60 slack; fake timers drive both deterministically.
const SETTLE_MS = 420 + 60; // SNAP_MS + slack (BottomSheet.markSettling — SNAP_MS isn't exported)

describe("data-settling stamp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom doesn't implement Pointer Capture — onPointerDown calls setPointerCapture; stub it to a no-op so
    // the handler runs to completion (we only care about its `data-settling` clear, not the capture itself).
    HTMLElement.prototype.setPointerCapture = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // No `act()` wrapping the timer advances: the settling path is purely IMPERATIVE (rAF/timeout mutate
  // `dataset` directly; `settle()`→`syncGrip` bails with no state change here), so advancing fires no React
  // update — nothing to flush. children go in the props object (createElement's 3rd arg doesn't satisfy the
  // component's required `children` prop for the typechecker).
  const renderOpenSheet = () =>
    render(
      createElement(BottomSheet, {
        open: true,
        onClose: () => {},
        children: createElement("div", null, "content"),
      }),
    );

  it("stamps data-settling on open, and clears it after SNAP_MS+60", () => {
    const { container } = renderOpenSheet();
    const sheet = container.querySelector<HTMLElement>(".bs-sheet")!;
    vi.advanceTimersByTime(20); // fire the enter-slide rAF that marks the motion
    expect(sheet.dataset.settling).toBe("true");
    vi.advanceTimersByTime(SETTLE_MS); // let the self-clear timeout elapse
    expect(sheet.dataset.settling).toBeUndefined();
  });

  it("pointerdown on the handle clears a pending data-settling (a drag has its own rules)", () => {
    const { container } = renderOpenSheet();
    const sheet = container.querySelector<HTMLElement>(".bs-sheet")!;
    const handle = container.querySelector<HTMLElement>(".bs-handle")!;
    vi.advanceTimersByTime(20);
    expect(sheet.dataset.settling).toBe("true");
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    expect(sheet.dataset.settling).toBeUndefined();
  });
});
