import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { setThemeSetting, setUI } from "../../src/store/ui";
import {
  resolveThemeSetting,
  themeSettingsSpec,
  useThemeSetting,
} from "../../src/theme-engine/settings";

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

// §14.15.1 ⑦ / COMPOSER_SURFACE_PLAN §2.0 — the pure read-validation resolver (audit B4). A seg value is
// kept only if it names a declared option (else default); a switch coerces to boolean; an undeclared key
// → undefined. Reads vapor's real ThemeDef.settings (loz/skyline = seg, heroOn/waveformOn = switch).
describe("resolveThemeSetting", () => {
  it("returns a seg value when it names a declared option", () => {
    expect(resolveThemeSetting("vapor", "skyline", "mountains")).toBe("mountains");
    expect(resolveThemeSetting("vapor", "loz", "ring")).toBe("ring");
  });

  it("falls back to the seg default when the value is not a declared option", () => {
    expect(resolveThemeSetting("vapor", "skyline", "atlantis")).toBe("city"); // stale/corrupt option
    expect(resolveThemeSetting("vapor", "loz", "")).toBe("logo");
    expect(resolveThemeSetting("vapor", "skyline", true)).toBe("city"); // wrong type → default
    expect(resolveThemeSetting("vapor", "skyline", undefined)).toBe("city"); // no override → default
  });

  it("coerces a switch to boolean, keeping only real booleans", () => {
    expect(resolveThemeSetting("vapor", "heroOn", true)).toBe(true);
    expect(resolveThemeSetting("vapor", "heroOn", false)).toBe(false);
    expect(resolveThemeSetting("vapor", "heroOn", undefined)).toBe(true); // → declared default
    expect(resolveThemeSetting("vapor", "heroOn", "yes")).toBe(true); // wrong type → default
    expect(resolveThemeSetting("vapor", "waveformOn", "")).toBe(true); // falsy-but-not-bool → default
  });

  it("returns undefined for an undeclared key", () => {
    expect(resolveThemeSetting("vapor", "nope", "whatever")).toBeUndefined();
    expect(resolveThemeSetting("vapor", "nope", undefined)).toBeUndefined();
  });

  it("returns undefined for a theme with no declared settings (unregistered/empty)", () => {
    expect(resolveThemeSetting("phosphor", "heroOn", true)).toBeUndefined(); // not in registry
  });
});

describe("themeSettingsSpec", () => {
  it("exposes the active theme's declared schema (vapor → 4 decorative options)", () => {
    const spec = themeSettingsSpec("vapor");
    expect(Object.keys(spec ?? {})).toEqual(["loz", "heroOn", "skyline", "waveformOn"]);
    expect(spec?.heroOn).toMatchObject({ type: "switch", default: true });
  });
});
