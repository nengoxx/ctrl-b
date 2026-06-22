import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { setUI, useUISlice } from "../../src/store/ui";

// store/ui — UI-only state (theme/tab/…), persisted to localStorage and mirrored onto <body> data-attrs
// (the Vapor CSS keys off body[data-theme|data-tab|…] + body.no-composer).

beforeEach(() => {
  setUI({ theme: "dark", tab: "fleet" }); // baseline (module state persists across tests)
  localStorage.clear();
});

describe("ui store", () => {
  it("setUI updates the selected slice", () => {
    const { result } = renderHook(() => useUISlice((s) => s.theme));
    expect(result.current).toBe("dark");
    act(() => setUI({ theme: "aqua" }));
    expect(result.current).toBe("aqua");
  });

  it("mirrors theme + tab onto <body> data-attrs (Vapor CSS hooks)", () => {
    setUI({ theme: "ember", tab: "agent" });
    expect(document.body.dataset.theme).toBe("ember");
    expect(document.body.dataset.tab).toBe("agent");
  });

  it("toggles body.no-composer for tabs without a composer (Conf/Utils)", () => {
    setUI({ tab: "agent" });
    expect(document.body.classList.contains("no-composer")).toBe(false);
    setUI({ tab: "conf" });
    expect(document.body.classList.contains("no-composer")).toBe(true);
  });

  it("persists to localStorage", () => {
    setUI({ theme: "aqua" });
    expect(JSON.parse(localStorage.getItem("ctrlb.ui")!).theme).toBe("aqua");
  });

  it("a slice selector ignores unrelated changes", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useUISlice((s) => s.tab);
    });
    const before = renders;
    act(() => setUI({ theme: "aqua" })); // unrelated to the `tab` slice
    expect(result.current).toBe("fleet");
    expect(renders).toBe(before); // no re-render for an unrelated field
  });
});
