import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { isAnyDirty, setDirty, useAnyDirty, useRegisterDirty } from "../../src/store/dirty";

// store/dirty — the cross-editor unsaved-changes registry (D23 binding). `isAnyDirty()` is a direct read
// for the beforeunload guard; `useRegisterDirty` registers a key for a component's lifetime. The state is
// a `Set` mutated in place + a derived-bool snapshot — each test uses unique keys (module singleton).

describe("dirty store", () => {
  it("setDirty toggles isAnyDirty; stays dirty until every key clears", () => {
    setDirty("d1-a", true);
    expect(isAnyDirty()).toBe(true);
    setDirty("d1-b", true);
    setDirty("d1-a", false);
    expect(isAnyDirty()).toBe(true); // d1-b still dirty
    setDirty("d1-b", false);
    expect(isAnyDirty()).toBe(false);
  });

  it("useAnyDirty re-renders only when the any-dirty bool crosses true/false", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useAnyDirty();
    });
    expect(result.current).toBe(false);
    const start = renders;
    act(() => setDirty("d2-a", true)); // false → true
    expect(result.current).toBe(true);
    const afterFirst = renders;
    expect(afterFirst).toBeGreaterThan(start);
    act(() => setDirty("d2-b", true)); // true → true (still any-dirty): no re-render
    expect(renders).toBe(afterFirst);
    act(() => {
      setDirty("d2-a", false);
      setDirty("d2-b", false);
    }); // → false
    expect(result.current).toBe(false);
  });

  it("setDirty is a no-op when the key's membership doesn't change", () => {
    let renders = 0;
    renderHook(() => {
      renders++;
      return useAnyDirty();
    });
    setDirty("d3", true);
    const before = renders;
    act(() => setDirty("d3", true)); // already present → no emit
    expect(renders).toBe(before);
    setDirty("d3", false); // cleanup
  });

  it("useRegisterDirty registers on mount and clears on unmount", () => {
    const { unmount } = renderHook(() => useRegisterDirty("d4", true));
    expect(isAnyDirty()).toBe(true);
    unmount();
    expect(isAnyDirty()).toBe(false); // cleanup removed the key
  });
});
