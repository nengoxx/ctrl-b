import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getUI,
  loadUIState,
  migrateAppbarMode,
  migrateLegacyTheme,
  migrateVaporSettings,
  setThemeSetting,
  setUI,
  useUISlice,
  type UIState,
} from "../../src/store/ui";
import { coerceBootTheme, DEFAULT_THEME } from "../../src/theme-engine/resolve";

const KEY = "ctrlb.ui";
const seed = (blob: unknown) => localStorage.setItem(KEY, JSON.stringify(blob));

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
    appbarMode: "visible",
    layout: "auto",
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

  describe("migrateAppbarMode", () => {
    // PRE-migration states (the persisted blob had no `appbarMode` → hasAppbarMode=false) seed it from legacy.
    it("seeds appbarMode from the old global hideAppbar boolean + drops it (pre-migration)", () => {
      const off = migrateAppbarMode({ ...base, hideAppbar: true } as unknown as UIState, false);
      expect(off.appbarMode).toBe("off");
      expect("hideAppbar" in off).toBe(false);
      const vis = migrateAppbarMode({ ...base, hideAppbar: false } as unknown as UIState, false);
      expect(vis.appbarMode).toBe("visible");
      expect("hideAppbar" in vis).toBe(false);
    });

    it("seeds from an older per-theme hideAppbar + drops the per-theme key (pre-migration)", () => {
      const legacy = {
        ...base,
        themeSettings: { minimal: { hideAppbar: true, density: "compact" } },
      } as unknown as UIState;
      const out = migrateAppbarMode(legacy, false);
      expect(out.appbarMode).toBe("off");
      expect(out.themeSettings.minimal).toEqual({ density: "compact" }); // hideAppbar dropped, density kept
    });

    it("is a no-op on an already-enum state with no legacy keys", () => {
      const clean = {
        ...base,
        appbarMode: "minimal" as const,
        themeSettings: { minimal: { density: "comfortable" } },
      };
      expect(migrateAppbarMode(clean, true)).toEqual(clean);
    });

    // The regression: a stale per-theme hideAppbar is SYNCED, so it keeps returning. Once the user has an
    // explicit appbarMode, the migration must STRIP the stale key but NEVER override the chosen mode.
    it("keeps an explicit appbarMode + strips a stale synced per-theme hideAppbar (post-migration)", () => {
      const dirty = {
        ...base,
        appbarMode: "minimal" as const,
        themeSettings: { minimal: { hideAppbar: true, density: "compact" } },
      } as unknown as UIState;
      const out = migrateAppbarMode(dirty, true);
      expect(out.appbarMode).toBe("minimal"); // NOT clobbered to "off"
      expect(out.themeSettings.minimal).toEqual({ density: "compact" }); // stale key stripped
    });

    it("prefers the global legacy boolean over a per-theme one + prunes an emptied entry (pre-migration)", () => {
      const both = {
        ...base,
        hideAppbar: true,
        themeSettings: { minimal: { hideAppbar: false } },
      } as unknown as UIState;
      const out = migrateAppbarMode(both, false);
      expect(out.appbarMode).toBe("off"); // global true wins
      expect(out.themeSettings.minimal).toBeUndefined(); // sole per-theme key dropped → entry pruned
    });
  });

  // §14.15.1 rider (a) — the versioned load. `v` is the persisted-schema stamp; a missing `v` = v0 (legacy)
  // and runs the migrateLegacyTheme→migrateVaporSettings→migrateAppbarMode chain; `v >= UI_PERSIST_V` gates
  // it OFF (already-current shape). Exercised through the real loadUIState() so the merge + gating + v-strip
  // are covered together, not just the migrate helpers in isolation.
  describe("versioned persistence (loadUIState)", () => {
    it("(a) keeps an explicit appbarMode on an UNVERSIONED blob + strips a stale synced hideAppbar", () => {
      // THE regression: no `v`, but the blob already has `appbarMode` (every real device today). Key-presence
      // inference must treat it as post-appbar and NOT re-seed from the stale synced themeSettings.hideAppbar.
      seed({
        theme: "vapor",
        accent: "dark",
        appbarMode: "off",
        themeSettings: { vapor: { hideAppbar: false } },
      });
      const s = loadUIState();
      expect(s.appbarMode).toBe("off"); // not clobbered back to "visible" by a re-seed
      expect(s.themeSettings.vapor).toBeUndefined(); // stale synced key stripped, emptied entry pruned
    });

    it("(b) seeds appbarMode from a top-level legacy hideAppbar on a pre-appbar unversioned blob", () => {
      seed({ theme: "vapor", accent: "dark", hideAppbar: true }); // no `appbarMode`, no `v` → genuine v0
      const s = loadUIState();
      expect(s.appbarMode).toBe("off"); // seeded from hideAppbar:true
      expect("hideAppbar" in s).toBe(false); // legacy key dropped
    });

    it("(c) runs the legacy theme remap on an unversioned blob (chain preserved)", () => {
      seed({ theme: "aqua" }); // pre-Phase-11 conflated accent-as-theme
      const s = loadUIState();
      expect(s.theme).toBe("vapor");
      expect(s.accent).toBe("aqua");
    });

    it("(d) SKIPS the v0 chain when the blob is already at the current version", () => {
      // Crafted-impossible shape (a real v1 blob never carries theme:"aqua") to prove the gate: with v:1 the
      // migrate chain must not run, so the legacy remap does NOT fire and the value loads verbatim.
      seed({ v: 1, theme: "aqua", accent: "dark" });
      const s = loadUIState();
      expect(s.theme).toBe("aqua"); // migrateLegacyTheme skipped → NOT remapped to vapor
    });

    it("(e) treats a NEWER version (post-rollback) as current — loaded verbatim, no down-migrate", () => {
      seed({ v: 99, theme: "aqua", accent: "dark" });
      expect(loadUIState().theme).toBe("aqua");
    });

    it("(f) the save path stamps v on the wire", () => {
      act(() => setUI({ accent: "aqua" }));
      expect(JSON.parse(localStorage.getItem(KEY)!).v).toBe(1);
    });

    it("(g) the reserved `v` never leaks into the loaded in-memory state", () => {
      seed({ v: 1, theme: "vapor", accent: "dark" });
      expect("v" in loadUIState()).toBe(false);
    });

    it("treats a corrupt non-integer v (1e999 → Infinity) as v0 and still runs the chain", () => {
      // JSON.parse("1e999") === Infinity, and a bare typeof-number check would read it as "newer than
      // current" and SKIP the migrations (verification F3, 2026-07-10). Number.isSafeInteger rejects it.
      localStorage.setItem(KEY, '{"v":1e999,"theme":"aqua"}');
      const s = loadUIState();
      expect(s.theme).toBe("vapor"); // the legacy remap RAN (not skipped as post-current)
      expect(s.accent).toBe("aqua");
    });

    it("falls back to defaults on an array blob — no numeric-index junk keys", () => {
      // {...defaults, ...["junk"]} would spread to a junk {0:"junk"} key that setUI then re-persists
      // (verification F5, 2026-07-10); the merge helper now rejects non-plain-object blobs outright.
      seed(["junk"]);
      const s = loadUIState();
      expect(s.theme).toBe("vapor");
      expect("0" in s).toBe(false);
    });
  });

  // Item ⑥ (§14.15.1) — the every-boot registered-skin validity check (parse-don't-validate). It heals an
  // unregistered persisted `theme` (a deregistered/newer-build skin) to DEFAULT_THEME + that theme's default
  // mode/accent, self-healing localStorage via setUI's persist; it NEVER touches the server. Lives at the
  // engine boundary (resolve.ts) because the store can't import the registry (import cycle) — exercised here
  // against the real ui store it reads/writes.
  describe("coerceBootTheme (item ⑥)", () => {
    it("heals an unregistered persisted skin to DEFAULT_THEME + its default mode/accent", () => {
      act(() => setUI({ theme: "nope" as never, mode: "light", accent: "indigo" }));
      act(() => coerceBootTheme());
      const s = getUI();
      expect(s.theme).toBe(DEFAULT_THEME); // "vapor"
      expect(s.mode).toBe("dark"); // vapor declares no mode axis → the "dark" fallback
      expect(s.accent).toBe("dark"); // vapor's defaultAccent
      // self-heals the persisted blob for the next boot
      expect(JSON.parse(localStorage.getItem(KEY)!).theme).toBe(DEFAULT_THEME);
    });

    it("is a no-op for a registered skin (state ref preserved → setUI not called)", () => {
      act(() => setUI({ theme: "minimal", mode: "light", accent: "indigo" }));
      const before = getUI(); // setUI builds a fresh state object; an unchanged ref proves it wasn't called
      act(() => coerceBootTheme());
      expect(getUI()).toBe(before); // same reference → no write
      expect(getUI().theme).toBe("minimal");
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
