import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  migrateHideAppbar,
  migrateLegacyTheme,
  migrateVaporSettings,
  setThemeSetting,
  setUI,
  useUISlice,
  type UIState,
} from "../../src/store/ui";

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
  const base: UIState = {
    theme: "vapor",
    mode: "dark",
    accent: "dark",
    tab: "fleet",
    ttsAuto: true,
    motion: "full",
    perf: "full",
    themeSettings: {},
    hideAppbar: false,
  };

  describe("migrateLegacyTheme", () => {
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

  // §14.3 — the M3 remap: pre-M3 persisted state carried skyline/loz/heroOn/waveformOn as TOP-LEVEL
  // fields (loadPersisted keeps them as extras). Fold them into themeSettings.vapor; drop the top-levels.
  describe("migrateVaporSettings", () => {
    it("folds legacy vapor toggles into themeSettings.vapor and drops the top-level keys", () => {
      const legacy = {
        ...base,
        skyline: "mountains",
        loz: "ring",
        heroOn: false,
        waveformOn: false,
      } as unknown as UIState;
      const out = migrateVaporSettings(legacy);
      expect(out.themeSettings.vapor).toEqual({
        skyline: "mountains",
        loz: "ring",
        heroOn: false,
        waveformOn: false,
      });
      expect("skyline" in out).toBe(false);
      expect("loz" in out).toBe(false);
      expect("heroOn" in out).toBe(false);
      expect("waveformOn" in out).toBe(false);
    });

    it("is a no-op on an already-migrated state (no legacy keys)", () => {
      const migrated = { ...base, themeSettings: { vapor: { heroOn: true } } };
      expect(migrateVaporSettings(migrated)).toEqual(migrated);
    });

    it("never overwrites an already-present themeSettings.vapor value", () => {
      const mixed = {
        ...base,
        skyline: "mountains",
        themeSettings: { vapor: { skyline: "city" } },
      } as unknown as UIState;
      expect(migrateVaporSettings(mixed).themeSettings.vapor.skyline).toBe("city"); // existing wins
    });
  });

  describe("migrateHideAppbar", () => {
    it("folds a per-theme hideAppbar up into the global field and drops the per-theme key", () => {
      const legacy: UIState = {
        ...base,
        hideAppbar: false,
        themeSettings: { minimal: { hideAppbar: true, density: "compact" } },
      };
      const out = migrateHideAppbar(legacy);
      expect(out.hideAppbar).toBe(true);
      expect(out.themeSettings.minimal).toEqual({ density: "compact" }); // hideAppbar dropped, density kept
    });

    it("is a no-op when no theme carries hideAppbar", () => {
      const clean = { ...base, themeSettings: { minimal: { density: "comfortable" } } };
      expect(migrateHideAppbar(clean)).toEqual(clean);
    });

    it("does not override a global hideAppbar that's already set", () => {
      const both: UIState = {
        ...base,
        hideAppbar: true,
        themeSettings: { minimal: { hideAppbar: false } },
      };
      expect(migrateHideAppbar(both).hideAppbar).toBe(true); // global wins; the per-theme key is still dropped
    });
  });

  describe("setThemeSetting", () => {
    it("patches one key under the theme's open map without disturbing others", () => {
      act(() => setUI({ themeSettings: { vapor: { heroOn: true } } }));
      const { result } = renderHook(() => useUISlice((s) => s.themeSettings.vapor));
      act(() => setThemeSetting("vapor", "skyline", "mountains"));
      expect(result.current).toEqual({ heroOn: true, skyline: "mountains" });
      act(() => setThemeSetting("vapor", "heroOn", false));
      expect(result.current).toEqual({ heroOn: false, skyline: "mountains" });
    });
  });
});
