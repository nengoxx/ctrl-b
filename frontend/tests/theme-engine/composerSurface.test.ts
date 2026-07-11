import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setThemeSetting, setUI } from "../../src/store/ui";
import { KitComposer } from "../../src/theme-engine/kit/composer/Composer";
import { SheetComposer } from "../../src/theme-engine/kit/composer/SheetComposer";
import { composerLayoutSetting } from "../../src/theme-engine/kit/composer/setting";
import { useComposerLayout } from "../../src/theme-engine/kit/composer/ThemedComposer";
import {
  composerVariants,
  DEFAULT_COMPOSER_LAYOUT,
} from "../../src/theme-engine/kit/composer/variants";
import { registeredThemes } from "../../src/theme-engine/registry";

// COMPOSER_SURFACE_PLAN §7 — A1 characterization tests. Lock the current (no-visual-change) behavior of the
// composer Surface mechanism BEFORE A2/A3 refactor it: the variant registry identity, the layout resolver's
// per-theme default + fallbacks, and the shared setting spec's shape. `sheet` still delegates to KitComposer
// (the stub) and NO theme declares the `composer` setting yet (A3 does) — so every theme resolves to
// `stacked`; these tests fail the moment that invariant is broken.

beforeEach(() => {
  setUI({ themeSettings: {} }); // clear overrides (module state persists between tests)
});
afterEach(() => {
  setUI({ themeSettings: {} });
});

describe("composerVariants registry", () => {
  it("maps stacked→KitComposer and sheet→SheetComposer (stable module refs)", () => {
    expect(composerVariants.stacked).toBe(KitComposer);
    expect(composerVariants.sheet).toBe(SheetComposer);
  });

  it("DEFAULT_COMPOSER_LAYOUT is stacked", () => {
    expect(DEFAULT_COMPOSER_LAYOUT).toBe("stacked");
  });

  it("falls back to KitComposer for an unknown variant id (the resolver's ?? net)", () => {
    expect("nope" in composerVariants).toBe(false);
    expect(composerVariants["nope"] ?? KitComposer).toBe(KitComposer);
  });
});

describe("useComposerLayout", () => {
  it.each(registeredThemes().map((d) => [d.id] as const))(
    "resolves to stacked (the fallback) when %s declares no composer setting → KitComposer",
    (id) => {
      setUI({ theme: id, themeSettings: {} });
      const { result } = renderHook(() => useComposerLayout());
      expect(result.current).toBe("stacked");
      expect(composerVariants[result.current]).toBe(KitComposer);
    },
  );

  it("keeps falling back to stacked when a value is stored for an undeclared setting", () => {
    // No theme declares `composer` yet (A3 wires it), so even a synced/stale override does not resolve —
    // `resolveThemeSetting` returns undefined for the unknown key → the hook's `?? stacked` fallback holds.
    setUI({ theme: "cosmos", themeSettings: {} });
    setThemeSetting("cosmos", "composer", "sheet");
    const { result } = renderHook(() => useComposerLayout());
    expect(result.current).toBe("stacked");
  });
});

describe("composerLayoutSetting", () => {
  it("builds the shared seg spec (options Stacked/Docked, default from the arg)", () => {
    const spec = composerLayoutSetting();
    expect(spec).toMatchObject({
      type: "seg",
      label: "Composer",
      desc: "input bar layout",
      default: "stacked",
      options: [
        { val: "stacked", label: "Stacked" },
        { val: "sheet", label: "Docked" },
      ],
    });
    expect(composerLayoutSetting("sheet").default).toBe("sheet");
  });
});
