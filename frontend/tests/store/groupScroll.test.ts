import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearGroupScrollTarget,
  getGroupScrollTarget,
  setGroupScrollTarget,
  useGroupScrollTarget,
} from "../../src/store/groupScroll";

// store/groupScroll — the transient scroll-handoff channel (D35 §F0): the one-hop "after you land on the host
// section, scroll to (and expand) this group" target carried from `useSections.navigate` to ConfTab. A
// dep-free external store on the shared `createStore` binding (D23); NEVER persisted (no localStorage assertion
// here, unlike collapse/sheetSnap). Module singleton → reset between cases.

beforeEach(() => clearGroupScrollTarget());

describe("groupScroll store", () => {
  it("defaults to null with nothing armed", () => {
    expect(getGroupScrollTarget()).toBeNull();
  });

  it("arms + reads back a target, then clears it", () => {
    setGroupScrollTarget("utils-hosted");
    expect(getGroupScrollTarget()).toBe("utils-hosted");
    clearGroupScrollTarget();
    expect(getGroupScrollTarget()).toBeNull();
  });

  it("clearing when already clear is a no-op (no emit)", () => {
    // useGroupScrollTarget subscribes; a redundant clear must not re-notify (the store's early-return guard).
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useGroupScrollTarget();
    });
    expect(result.current).toBeNull();
    const before = renders;
    act(() => clearGroupScrollTarget()); // already null → no-op emit
    expect(result.current).toBeNull();
    expect(renders).toBe(before); // no re-render
  });

  it("the reactive hook reflects arm + clear", () => {
    const { result } = renderHook(() => useGroupScrollTarget());
    expect(result.current).toBeNull();
    act(() => setGroupScrollTarget("utils-hosted"));
    expect(result.current).toBe("utils-hosted");
    act(() => clearGroupScrollTarget());
    expect(result.current).toBeNull();
  });
});
