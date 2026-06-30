import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { setCosmosSelection, useCosmosSelection } from "../../src/store/cosmosSelection";

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
