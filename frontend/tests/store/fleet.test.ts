import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  feature,
  featureAuto,
  fleetState,
  holdRemainingMs,
  toggleRow,
} from "../../src/store/fleet";

// store/fleet — the Fleet controller's carousel/expand state (D29 §14.2/§14.5). The auto-advance engine
// (hooks/useFleet `useFleetCycle`) reads `holdRemainingMs` to defer advancing after a manual pick.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("fleet store", () => {
  it("feature() sets the featured host and holds the carousel; featureAuto() does NOT hold", () => {
    feature(2);
    expect(fleetState().featured).toBe(2);
    expect(holdRemainingMs()).toBeGreaterThan(7000); // ~8s hold

    vi.advanceTimersByTime(9000);
    expect(holdRemainingMs()).toBe(0); // hold expired

    featureAuto(3);
    expect(fleetState().featured).toBe(3);
    expect(holdRemainingMs()).toBe(0); // auto-advance never holds
  });

  it("the hold reschedules cleanly: a later tap extends the hold from the new tap", () => {
    feature(1);
    vi.advanceTimersByTime(5000);
    expect(holdRemainingMs()).toBeGreaterThan(2000); // ~3s left of the first hold
    feature(1); // tap again
    expect(holdRemainingMs()).toBeGreaterThan(7000); // re-armed to ~8s from now
  });

  it("toggleRow() features + holds + toggles the row's expanded state", () => {
    const before = fleetState().open.has("vault");
    toggleRow("vault", 1);
    expect(fleetState().featured).toBe(1);
    expect(fleetState().open.has("vault")).toBe(!before);
    expect(holdRemainingMs()).toBeGreaterThan(0);

    toggleRow("vault", 1); // toggle back
    expect(fleetState().open.has("vault")).toBe(before);
  });
});
