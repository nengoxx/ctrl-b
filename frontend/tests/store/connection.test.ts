import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { setConnection, useConnection } from "../../src/store/connection";

// store/connection — the SSE connection badge state (D23 binding). Drives the "reconnecting…/offline"
// indicator in AppBar.

beforeEach(() => setConnection("connected"));

describe("connection store", () => {
  it("useConnection reflects setConnection across all transitions", () => {
    const { result } = renderHook(() => useConnection());
    expect(result.current).toBe("connected");
    act(() => setConnection("reconnecting"));
    expect(result.current).toBe("reconnecting");
    act(() => setConnection("disconnected"));
    expect(result.current).toBe("disconnected");
    act(() => setConnection("connected"));
    expect(result.current).toBe("connected");
  });

  it("no-op guard: setting the current state does not notify (no re-render)", () => {
    let renders = 0;
    renderHook(() => {
      renders++;
      return useConnection();
    });
    const before = renders;
    act(() => setConnection("connected")); // already connected
    expect(renders).toBe(before);
  });
});
