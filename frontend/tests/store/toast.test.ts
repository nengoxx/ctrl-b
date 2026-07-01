import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dismissToast, pushToast, useToasts } from "../../src/store/toast";

// store/toast — transient activity toasts (D23 binding). Auto-dismiss after the TTL; sticky toasts +
// inline actions (F26). The module list is a singleton, so tests find their own toast by text and clean
// up; fake timers drive the TTL deterministically.

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("toast store", () => {
  it("pushToast adds a toast useToasts sees (kind + text), dismissToast removes it by id", () => {
    const { result } = renderHook(() => useToasts());
    act(() => pushToast("hello", "ok"));
    const t = result.current.find((x) => x.text === "hello");
    expect(t).toBeTruthy();
    expect(t!.kind).toBe("ok");
    act(() => dismissToast(t!.id));
    expect(result.current.find((x) => x.text === "hello")).toBeFalsy();
  });

  it("auto-dismisses a non-sticky toast after the TTL", () => {
    const { result } = renderHook(() => useToasts());
    act(() => pushToast("ephemeral"));
    expect(result.current.some((x) => x.text === "ephemeral")).toBe(true);
    act(() => vi.advanceTimersByTime(3200));
    expect(result.current.some((x) => x.text === "ephemeral")).toBe(false);
  });

  it("a sticky toast survives the TTL until explicitly dismissed", () => {
    const { result } = renderHook(() => useToasts());
    act(() => pushToast("stuck", "info", { sticky: true }));
    act(() => vi.advanceTimersByTime(10_000));
    const t = result.current.find((x) => x.text === "stuck");
    expect(t).toBeTruthy();
    act(() => dismissToast(t!.id));
    expect(result.current.find((x) => x.text === "stuck")).toBeFalsy();
  });

  it("carries an inline action through to the rendered toast", () => {
    const { result } = renderHook(() => useToasts());
    act(() =>
      pushToast("act", "info", { action: { label: "Go", onClick: () => {} }, sticky: true }),
    );
    const t = result.current.find((x) => x.text === "act");
    expect(t!.action?.label).toBe("Go");
    act(() => dismissToast(t!.id));
  });

  it("assigns distinct ids to successive toasts", () => {
    const { result } = renderHook(() => useToasts());
    act(() => {
      pushToast("one", "info", { sticky: true });
      pushToast("two", "info", { sticky: true });
    });
    const a = result.current.find((x) => x.text === "one")!;
    const b = result.current.find((x) => x.text === "two")!;
    expect(a.id).not.toBe(b.id);
    act(() => {
      dismissToast(a.id);
      dismissToast(b.id);
    });
  });
});
