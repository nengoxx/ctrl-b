import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { migrateLegacyTheme, setUI, useUISlice, type UIState } from "../../src/store/ui";

// store/ui — UI-only state, persisted to localStorage and mirrored onto <body> data-attrs. Theme-engine
// model (Phase 11 / D28 §9.8): {theme(skin), mode, accent}. `body[data-skin]` is the skin identity;
// `body[data-theme]` keeps vapor's frozen accent axis (dark/aqua/ember), set only when skin=vapor.

beforeEach(() => {
  setUI({ theme: "vapor", mode: "dark", accent: "dark", tab: "fleet" }); // baseline (module state persists)
  localStorage.clear();
});

describe("ui store", () => {
  it("setUI updates the selected slice", () => {
    const { result } = renderHook(() => useUISlice((s) => s.accent));
    expect(result.current).toBe("dark");
    act(() => setUI({ accent: "aqua" }));
    expect(result.current).toBe("aqua");
  });

  it("vapor: mirrors accent onto body[data-theme] + sets html[data-skin] (@scope identity)", () => {
    setUI({ theme: "vapor", accent: "ember", tab: "agent" });
    expect(document.documentElement.dataset.skin).toBe("vapor");
    expect(document.body.dataset.theme).toBe("ember"); // vapor's accent axis on <body>
    expect(document.body.dataset.tab).toBe("agent");
    expect(document.body.dataset.mode).toBeUndefined(); // vapor declares no mode axis
    expect(document.body.dataset.accent).toBeUndefined();
  });

  it("non-vapor skin: clears the stale vapor data-theme, sets data-mode/data-accent (§13.1)", () => {
    setUI({ theme: "vapor", accent: "aqua" }); // leave a vapor accent behind
    expect(document.body.dataset.theme).toBe("aqua");
    setUI({ theme: "minimal", mode: "light", accent: "indigo" });
    expect(document.documentElement.dataset.skin).toBe("minimal");
    expect(document.body.dataset.theme).toBeUndefined(); // vapor's accent must not leak onto another skin
    expect(document.body.dataset.mode).toBe("light");
    expect(document.body.dataset.accent).toBe("indigo");
  });

  // (`body.no-composer` is no longer written here — it moved to the theme `Root` (VaporRoot), driven by
  //  the `useSections` controller's `hasComposer`. See tests/hooks/useSections.test.ts.)

  it("persists to localStorage", () => {
    setUI({ accent: "aqua" });
    expect(JSON.parse(localStorage.getItem("ctrlb.ui")!).accent).toBe("aqua");
  });

  it("a slice selector ignores unrelated changes", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useUISlice((s) => s.tab);
    });
    const before = renders;
    act(() => setUI({ accent: "aqua" })); // unrelated to the `tab` slice
    expect(result.current).toBe("fleet");
    expect(renders).toBe(before); // no re-render for an unrelated field
  });

  // §13.4 — the one-time persisted-shape remap: legacy `theme ∈ {dark,aqua,ember}` (the conflated vapor
  // accent) → {theme:"vapor", accent}. The field-fill merge already added mode/accent defaults.
  describe("migrateLegacyTheme", () => {
    const base: UIState = {
      theme: "vapor",
      mode: "dark",
      accent: "dark",
      tab: "fleet",
      skyline: "city",
      loz: "logo",
      ttsAuto: true,
      heroOn: true,
      waveformOn: true,
      motion: "full",
      perf: "full",
    };

    it("remaps a legacy accent-as-theme to {vapor, accent}", () => {
      expect(migrateLegacyTheme({ ...base, theme: "aqua" as never })).toMatchObject({
        theme: "vapor",
        mode: "dark",
        accent: "aqua",
      });
      expect(migrateLegacyTheme({ ...base, theme: "ember" as never }).accent).toBe("ember");
      expect(migrateLegacyTheme({ ...base, theme: "dark" as never })).toMatchObject({
        theme: "vapor",
        accent: "dark",
      });
    });

    it("leaves an already-migrated (new-shape) state untouched", () => {
      const migrated = { ...base, theme: "vapor" as const, accent: "aqua" };
      expect(migrateLegacyTheme(migrated)).toEqual(migrated);
    });
  });
});
