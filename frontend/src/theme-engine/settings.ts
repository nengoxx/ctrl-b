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

/** Validate a raw (possibly stale/corrupt-synced) per-theme setting value against the theme's declared
 *  spec — pure, no store read (§14.15.1 ⑦ / COMPOSER_SURFACE_PLAN §2.0, audit B4). A `seg` value resolves
 *  only if it is one of the declared `options` (this enforces D31's per-theme capability list for free — a
 *  value can only resolve to a variant the theme declared); a `switch` coerces to boolean; an undeclared
 *  key → `undefined`. On any invalid value we fall back to the spec's default. The Surface resolver reads a
 *  setting to decide *which component renders*, so the value must be validated, not cast. */
export function resolveThemeSetting(
  themeId: ThemeId,
  key: string,
  raw: ThemeSettingValue | undefined,
): ThemeSettingValue | undefined {
  const spec = registry[themeId]?.settings?.[key];
  if (!spec) return undefined; // unknown/undeclared key
  if (spec.type === "switch") return typeof raw === "boolean" ? raw : spec.default;
  // seg: keep the raw value only if it names a declared option, else the default
  return typeof raw === "string" && spec.options.some((o) => o.val === raw) ? raw : spec.default;
}

/** Resolve one per-theme setting: the stored override validated against the theme's spec, else the theme's
 *  declared default. Routes through `resolveThemeSetting` (§14.15.1 ⑦ / COMPOSER_SURFACE_PLAN §2.0) so a
 *  stale/corrupt synced value degrades to the default instead of casting through. Generic over the value
 *  type so call sites stay typed (`useThemeSetting<boolean>("vapor", "heroOn")`). */
export function useThemeSetting<T extends ThemeSettingValue = ThemeSettingValue>(
  themeId: ThemeId,
  key: string,
): T {
  const raw = useUISlice((s) => s.themeSettings[themeId]?.[key]);
  return resolveThemeSetting(themeId, key, raw) as T; // validated override, declared default, or undefined
}
