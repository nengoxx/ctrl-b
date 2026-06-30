import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { setThemeSetting, setUI } from "../../src/store/ui";
import { themeSettingsSpec, useThemeSetting } from "../../src/theme-engine/settings";

// D29 §14.3 — per-theme settings resolution: the stored override, else the theme's declared default
// (the VS Code `configuration` model). Reads vapor's real ThemeDef.settings from the registry.

beforeEach(() => {
  setUI({ themeSettings: {} }); // clear overrides (module state persists between tests)
});

describe("useThemeSetting", () => {
  it("falls back to the theme's declared default when there's no override", () => {
    const { result } = renderHook(() => useThemeSetting<boolean>("vapor", "heroOn"));
    expect(result.current).toBe(true); // vapor's declared default
    const { result: sky } = renderHook(() => useThemeSetting<string>("vapor", "skyline"));
    expect(sky.current).toBe("city");
  });

  it("returns the override when one is set", () => {
    setThemeSetting("vapor", "heroOn", false);
    const { result } = renderHook(() => useThemeSetting<boolean>("vapor", "heroOn"));
    expect(result.current).toBe(false);
  });

  it("returns undefined for an unknown key with no override", () => {
    const { result } = renderHook(() => useThemeSetting("vapor", "nope"));
    expect(result.current).toBeUndefined();
  });
});

describe("themeSettingsSpec", () => {
  it("exposes the active theme's declared schema (vapor → 4 decorative options)", () => {
    const spec = themeSettingsSpec("vapor");
    expect(Object.keys(spec ?? {})).toEqual(["loz", "heroOn", "skyline", "waveformOn"]);
    expect(spec?.heroOn).toMatchObject({ type: "switch", default: true });
  });
});
