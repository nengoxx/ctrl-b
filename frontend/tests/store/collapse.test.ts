import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useCollapsed } from "../../src/store/collapse";

// store/collapse — persisted Conf-section collapse state (D23 binding + persist helpers). Keyed by a
// stable section id; absent → the caller's default. Each test uses a unique id (module singleton).

beforeEach(() => localStorage.clear());

describe("collapse store", () => {
  it("uses the caller's default until toggled, then flips and persists", () => {
    const { result } = renderHook(() => useCollapsed("c-A", true)); // default collapsed
    expect(result.current[0]).toBe(true);
    act(() => result.current[1]()); // toggle
    expect(result.current[0]).toBe(false);
    expect(JSON.parse(localStorage.getItem("ctrlb.collapsed")!)["c-A"]).toBe(false);
  });

  it("a stored value overrides the default on a fresh mount", () => {
    const { result } = renderHook(() => useCollapsed("c-B", false));
    act(() => result.current[1]()); // false → true, persisted to the store
    // a new consumer of the same id reads the stored value (true), ignoring its own default (false)
    const { result: r2 } = renderHook(() => useCollapsed("c-B", false));
    expect(r2.current[0]).toBe(true);
  });

  it("distinct ids are independent", () => {
    const { result: a } = renderHook(() => useCollapsed("c-C", false));
    const { result: b } = renderHook(() => useCollapsed("c-D", false));
    act(() => a.current[1]()); // toggle only c-C
    expect(a.current[0]).toBe(true);
    expect(b.current[0]).toBe(false);
  });
});
