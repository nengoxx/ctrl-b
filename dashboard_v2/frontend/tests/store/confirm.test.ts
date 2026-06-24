import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { requestConfirm, resolveConfirm, useConfirm } from "../../src/store/confirm";

// store/confirm — the imperative confirm dialog (D23 binding): `await requestConfirm({...})` resolves
// when the host calls `resolveConfirm(ok)`. Single dialog at a time (single-user). beforeEach clears any
// leftover active request (a no-op if none).

beforeEach(() => resolveConfirm(false));

describe("confirm store", () => {
  it("requestConfirm exposes the active request and resolves true on accept", async () => {
    const { result } = renderHook(() => useConfirm());
    let resolved: boolean | undefined;
    act(() => {
      void requestConfirm({ title: "Shut down?", danger: true }).then((r) => (resolved = r));
    });
    expect(result.current?.title).toBe("Shut down?");
    expect(result.current?.danger).toBe(true);
    await act(async () => {
      resolveConfirm(true);
    });
    expect(resolved).toBe(true);
    expect(result.current).toBeNull(); // active cleared (dismiss-then-resolve)
  });

  it("resolveConfirm(false) resolves the promise to false", async () => {
    let resolved: boolean | undefined;
    act(() => {
      void requestConfirm({ title: "X" }).then((r) => (resolved = r));
    });
    await act(async () => {
      resolveConfirm(false);
    });
    expect(resolved).toBe(false);
  });

  it("a second request declines the one already open", async () => {
    let first: boolean | undefined;
    act(() => {
      void requestConfirm({ title: "A" }).then((r) => (first = r));
    });
    await act(async () => {
      void requestConfirm({ title: "B" }); // replaces A → A resolves false
    });
    expect(first).toBe(false);
  });
});
