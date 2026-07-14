import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { setThemeSetting, setUI } from "../../src/store/ui";
import { outlinesSetting, useOutlines } from "../../src/theme-engine/kit/axes";

// Slice A — the Kit-wide `outlines` axis (promoted out of frontier's F4 no-outlines chat sweep). The factory
// is the shared spec themes spread into `ThemeDef.settings` (per-theme default); `useOutlines` resolves the
// EFFECTIVE boolean through the generic `useThemeSetting`/`resolveThemeSetting` (no duplicated validation),
// defaulting an UNDECLARED theme (vapor / any frozen theme) to ON. Reads the REAL registry, so the per-theme
// defaults asserted below are the ones each ThemeDef declares (minimal/cosmos ON, frontier OFF).

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
  it("resolves each theme's DECLARED default (minimal/cosmos ON, frontier OFF)", () => {
    expect(renderHook(() => useOutlines("minimal")).result.current).toBe(true);
    expect(renderHook(() => useOutlines("cosmos")).result.current).toBe(true);
    expect(renderHook(() => useOutlines("frontier")).result.current).toBe(false);
  });

  it("a valid user override wins over the declared default", () => {
    setThemeSetting("frontier", "outlines", true); // borderless theme, borders back on
    expect(renderHook(() => useOutlines("frontier")).result.current).toBe(true);
    setThemeSetting("minimal", "outlines", false);
    expect(renderHook(() => useOutlines("minimal")).result.current).toBe(false);
  });

  it("an undeclared theme (vapor / frozen) resolves to ON — it keeps its native chrome", () => {
    expect(renderHook(() => useOutlines("vapor")).result.current).toBe(true);
    // a stray non-boolean override for an undeclared key can't force it off (resolveThemeSetting → undefined)
    setThemeSetting("vapor", "outlines", false);
    expect(renderHook(() => useOutlines("vapor")).result.current).toBe(true);
  });
});
