import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { createStore } from "../../src/store/createStore";
import { loadPersisted, savePersisted } from "../../src/store/persist";

// store/createStore — the shared external-store binding (D23). Owns no state; each consumer keeps its
// own value + supplies its snapshot. These cover the binding contract + the persist helpers directly
// (the 10 real stores exercise it indirectly; ui.test.ts covers the selector-isolation path end-to-end).

describe("createStore binding", () => {
  it("useStore reflects state after emit", () => {
    const store = createStore();
    let value = 1;
    const { result } = renderHook(() => store.useStore(() => value));
    expect(result.current).toBe(1);
    act(() => {
      value = 2;
      store.emit();
    });
    expect(result.current).toBe(2);
  });

  it("a primitive selector snapshot only re-renders when its slice changes", () => {
    const store = createStore();
    let state = { a: 0, b: 0 };
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return store.useStore(() => state.a);
    });
    const before = renders;
    act(() => {
      state = { ...state, b: 9 }; // unrelated to the `a` slice
      store.emit();
    });
    expect(result.current).toBe(0);
    expect(renders).toBe(before); // Object.is on the primitive → no re-render
  });

  it("subscribe receives notifications and unsubscribe stops them", () => {
    const store = createStore();
    let hits = 0;
    const off = store.subscribe(() => hits++);
    store.emit();
    store.emit();
    expect(hits).toBe(2);
    off();
    store.emit();
    expect(hits).toBe(2); // no longer notified
  });

  it("two stores are independent (no cross-notification)", () => {
    const a = createStore();
    const b = createStore();
    let aHits = 0;
    a.subscribe(() => aHits++);
    b.emit(); // must not reach a's listeners
    expect(aHits).toBe(0);
    a.emit();
    expect(aHits).toBe(1);
  });
});

describe("persist helpers", () => {
  beforeEach(() => localStorage.clear());

  it("loadPersisted merges a stored object over the defaults", () => {
    localStorage.setItem("k", JSON.stringify({ a: 2 }));
    expect(loadPersisted("k", { a: 1, b: 1 })).toEqual({ a: 2, b: 1 }); // new default `b` preserved
  });

  it("loadPersisted falls back to defaults when missing or corrupt", () => {
    expect(loadPersisted("missing", { a: 1 })).toEqual({ a: 1 });
    localStorage.setItem("bad", "{not json");
    expect(loadPersisted("bad", { a: 1 })).toEqual({ a: 1 });
  });

  it("loadPersisted of a stored null yields the defaults (spread no-op)", () => {
    localStorage.setItem("n", "null");
    expect(loadPersisted("n", { a: 1 })).toEqual({ a: 1 });
  });

  it("savePersisted round-trips through loadPersisted", () => {
    savePersisted("k", { a: 5 });
    expect(loadPersisted("k", { a: 0 })).toEqual({ a: 5 });
  });
});
