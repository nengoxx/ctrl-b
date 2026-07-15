import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { setCosmosSelection, stepId, useCosmosSelection } from "../../src/store/cosmosSelection";

// Cosmos manual-selection store (C2a-fix) — set/clear + React notification. Module state persists between
// tests, so each test clears it.

afterEach(() => setCosmosSelection(null));

describe("cosmosSelection", () => {
  it("starts with nothing selected", () => {
    const { result } = renderHook(() => useCosmosSelection());
    expect(result.current).toBeNull();
  });

  it("selects a host id and notifies subscribers", () => {
    const { result } = renderHook(() => useCosmosSelection());
    act(() => setCosmosSelection("pegasus"));
    expect(result.current).toBe("pegasus");
  });

  it("clears the selection with null", () => {
    const { result } = renderHook(() => useCosmosSelection());
    act(() => setCosmosSelection("titan"));
    act(() => setCosmosSelection(null));
    expect(result.current).toBeNull();
  });
});

describe("stepId (host-sheet chevrons)", () => {
  const ids = ["a", "b", "c"];

  it("steps forward through the middle", () => {
    expect(stepId(ids, "a", 1)).toBe("b");
    expect(stepId(ids, "b", 1)).toBe("c");
  });

  it("steps backward through the middle", () => {
    expect(stepId(ids, "c", -1)).toBe("b");
    expect(stepId(ids, "b", -1)).toBe("a");
  });

  it("wraps forward from the last to the first", () => {
    expect(stepId(ids, "c", 1)).toBe("a");
  });

  it("wraps backward from the first to the last", () => {
    expect(stepId(ids, "a", -1)).toBe("c");
  });

  it("falls back to the first id when current is null", () => {
    expect(stepId(ids, null, 1)).toBe("a");
    expect(stepId(ids, null, -1)).toBe("a");
  });

  it("falls back to the first id when current is not in the list", () => {
    expect(stepId(ids, "gone", 1)).toBe("a");
  });

  it("returns null for an empty list", () => {
    expect(stepId([], "a", 1)).toBeNull();
    expect(stepId([], null, -1)).toBeNull();
  });

  it("returns the same id for a single-item list (wrap onto itself)", () => {
    expect(stepId(["solo"], "solo", 1)).toBe("solo");
    expect(stepId(["solo"], "solo", -1)).toBe("solo");
  });
});
