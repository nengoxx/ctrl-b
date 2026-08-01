import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { setThemeSetting, setUI } from "../../src/store/ui";
import {
  composerSkinSetting,
  outlinesSetting,
  useComposerSkin,
  useOutlines,
} from "../../src/theme-engine/kit/axes";

// Slice A — the Kit-wide `outlines` axis (promoted out of frontier's F4 no-outlines chat sweep). The factory
// is the shared spec themes spread into `ThemeDef.settings` (per-theme default); `useOutlines` resolves the
// EFFECTIVE boolean through the generic `useThemeSetting`/`resolveThemeSetting` (no duplicated validation),
// defaulting an UNDECLARED theme to ON. Reads the REAL registry, so the per-theme defaults asserted below
// are the ones each ThemeDef declares (minimal/cosmos/vapor ON, frontier OFF).
//
// The UNDECLARED arm used to be vapor — until D51 V4, when the DefaultRoot pivot made it declare all four
// kit axis/seg descriptors (R19). Every REGISTERED theme declares them now, so the arm uses `phosphor`: a
// valid `ThemeId` with no registry row, which is exactly the shape the fallback exists for (an unregistered/
// stale id from a synced blob).

beforeEach(() => {
  setUI({ themeSettings: {} }); // clear overrides (module state persists between tests)
});

describe("outlinesSetting factory", () => {
  it("builds a switch spec with the given default", () => {
    expect(outlinesSetting(true)).toMatchObject({
      type: "switch",
      label: "Outlines",
      default: true,
    });
    expect(outlinesSetting(false)).toMatchObject({ type: "switch", default: false });
  });
});

describe("useOutlines", () => {
  it("resolves each theme's DECLARED default (minimal/cosmos/vapor ON, frontier OFF)", () => {
    expect(renderHook(() => useOutlines("minimal")).result.current).toBe(true);
    expect(renderHook(() => useOutlines("cosmos")).result.current).toBe(true);
    expect(renderHook(() => useOutlines("vapor")).result.current).toBe(true); // D51 V4 — declared ON
    expect(renderHook(() => useOutlines("frontier")).result.current).toBe(false);
  });

  it("a valid user override wins over the declared default", () => {
    setThemeSetting("frontier", "outlines", true); // borderless theme, borders back on
    expect(renderHook(() => useOutlines("frontier")).result.current).toBe(true);
    setThemeSetting("minimal", "outlines", false);
    expect(renderHook(() => useOutlines("minimal")).result.current).toBe(false);
  });

  it("an UNDECLARED theme (unregistered id) resolves to ON — it keeps the kit's native chrome", () => {
    expect(renderHook(() => useOutlines("phosphor")).result.current).toBe(true);
    // a stray non-boolean override for an undeclared key can't force it off (resolveThemeSetting → undefined)
    setThemeSetting("phosphor", "outlines", false);
    expect(renderHook(() => useOutlines("phosphor")).result.current).toBe(true);
  });
});

// Slice B — the `composerSkin` axis (the COMPOSER's chrome, orthogonal to the composer LAYOUT). Same shape as
// `outlines`: a shared seg factory + a `useComposerSkin` resolver on the generic `useThemeSetting`, defaulting
// an UNDECLARED theme to the kit-native `outline` skin. Reads the REAL registry (frontier declares `bezel`,
// minimal/cosmos/vapor `outline`; the undeclared arm uses the unregistered `phosphor` — see above).

describe("composerSkinSetting factory", () => {
  it("builds a seg spec (options Outline/Glass/Bezel/Sleek, default from the arg)", () => {
    const spec = composerSkinSetting();
    expect(spec).toMatchObject({
      type: "seg",
      label: "Composer skin",
      desc: "input bar chrome",
      default: "outline",
      options: [
        { val: "outline", label: "Outline" },
        { val: "glass", label: "Glass" },
        { val: "bezel", label: "Bezel" },
        { val: "sleek", label: "Sleek" },
      ],
    });
    expect(spec.type === "seg" && spec.options).toHaveLength(4);
    expect(composerSkinSetting("bezel").default).toBe("bezel");
    expect(composerSkinSetting("glass").default).toBe("glass");
    expect(composerSkinSetting("sleek").default).toBe("sleek");
  });
});

describe("useComposerSkin", () => {
  it("resolves each theme's DECLARED default (frontier→bezel, minimal/cosmos/vapor→outline)", () => {
    expect(renderHook(() => useComposerSkin("frontier")).result.current).toBe("bezel");
    expect(renderHook(() => useComposerSkin("minimal")).result.current).toBe("outline");
    expect(renderHook(() => useComposerSkin("cosmos")).result.current).toBe("outline");
    // D51 V4 — vapor DECLARES `outline` now (its dock is the kit's bordered bar), so this is its declared
    // default, not the undeclared fallback that used to answer here.
    expect(renderHook(() => useComposerSkin("vapor")).result.current).toBe("outline");
  });

  it("a valid user override wins over the declared default", () => {
    setThemeSetting("frontier", "composerSkin", "sleek");
    expect(renderHook(() => useComposerSkin("frontier")).result.current).toBe("sleek");
    setThemeSetting("minimal", "composerSkin", "glass");
    expect(renderHook(() => useComposerSkin("minimal")).result.current).toBe("glass");
  });

  it("an UNDECLARED theme (unregistered id) resolves to the kit-native `outline`", () => {
    expect(renderHook(() => useComposerSkin("phosphor")).result.current).toBe("outline");
    // a stray override for an undeclared key can't take effect (resolveThemeSetting → undefined → default)
    setThemeSetting("phosphor", "composerSkin", "bezel");
    expect(renderHook(() => useComposerSkin("phosphor")).result.current).toBe("outline");
  });

  it("a corrupt/stale value degrades to the theme's declared default (validation via the option list)", () => {
    // e.g. a legacy `borderless` (a composer LAYOUT before F5) synced into the skin key — not a declared skin
    // option, so `resolveThemeSetting` drops it to the default rather than casting an off-catalog id through.
    setThemeSetting("minimal", "composerSkin", "borderless");
    expect(renderHook(() => useComposerSkin("minimal")).result.current).toBe("outline");
    setThemeSetting("frontier", "composerSkin", "not-a-skin");
    expect(renderHook(() => useComposerSkin("frontier")).result.current).toBe("bezel");
  });
});
