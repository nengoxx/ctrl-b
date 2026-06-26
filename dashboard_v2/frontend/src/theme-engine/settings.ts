// Per-theme settings access (D29 §14.3). A theme declares `ThemeDef.settings` (a small namespaced
// schema); the override values live in the open `ui.themeSettings[id]` map. `useThemeSetting(id, key)`
// reads the override and falls back to the theme's declared default — the VS Code `configuration`
// contribution-point model (resolve to `default` when there's no user override).
//
// The registry is read at CALL time (inside the hook body), never at module init — so the
// settings→registry→theme→Root→settings import cycle is benign (live ESM bindings; the same pattern
// `resolve.ts#rootFor` already uses).

import { useUISlice } from "../store/ui";
import { registry } from "./registry";
import type { ThemeId, ThemeSettingsSpec, ThemeSettingValue } from "./types";

/** The active theme's declared settings schema (or undefined if it has none) — drives the Appearance
 *  picker's auto-render. */
export function themeSettingsSpec(themeId: ThemeId): ThemeSettingsSpec | undefined {
  return registry[themeId]?.settings;
}

/** Resolve one per-theme setting: the stored override, else the theme's declared default. Generic over
 *  the value type so call sites stay typed (`useThemeSetting<boolean>("vapor", "heroOn")`). */
export function useThemeSetting<T extends ThemeSettingValue = ThemeSettingValue>(
  themeId: ThemeId,
  key: string,
): T {
  const override = useUISlice((s) => s.themeSettings[themeId]?.[key]);
  if (override !== undefined) return override as T;
  return registry[themeId]?.settings?.[key]?.default as unknown as T; // declared default, or undefined
}
