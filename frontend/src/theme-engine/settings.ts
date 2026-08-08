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
import type { ThemeId, ThemeSettingField, ThemeSettingsSpec, ThemeSettingValue } from "./types";

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

/** The value the Conf Appearance picker DISPLAYS for one declared settings row — the same resolution the
 *  app itself uses, so a row can never report a state the app isn't in.
 *
 *  Extracted from ConfTab's render loop (Codex G0 #7) so it is testable as a value rather than as the
 *  presence of a call: the bug it fixes is a corrupt or stale synced override (a seg id this build no
 *  longer declares, a string where a switch belongs) being rendered RAW while every consumer had already
 *  coerced it to the default. The `?? field.default` tail is a belt for the impossible case of an
 *  undeclared key reaching the loop — `resolveThemeSetting` returns `undefined` only then. */
export function themeRowValue(
  themeId: ThemeId,
  key: string,
  raw: ThemeSettingValue | undefined,
  field: ThemeSettingField,
): ThemeSettingValue {
  return resolveThemeSetting(themeId, key, raw) ?? field.default;
}

/** Is one declared settings ROW currently visible? The `showWhen` predicate (GACHA_PLAN §12.6 — the ONE
 *  engine change the alt-fleet port needs), pure and exported for the same reason `themeRowValue` above is:
 *  the claim is about a VALUE, so it is tested as one rather than as the presence of a call in ConfTab.
 *
 *  `rawSibling` is the CONTROLLING setting's stored override, straight off the same `themeSettings[theme]`
 *  map the row's own value comes from — resolved here through `resolveThemeSetting`, never compared raw.
 *  That is the whole reason this is a function: a stale or corrupt sibling value (a seg id this build no
 *  longer declares) has already been coerced to the sibling's default everywhere else, so gating on the raw
 *  string would hide a row the app's own state says belongs on screen.
 *
 *  Two deliberate degradations, both FAIL-OPEN — a row that cannot be evaluated is shown, never silently
 *  lost: a `showWhen` naming an undeclared sibling (`resolveThemeSetting` → undefined), and a
 *  self-reference, which could otherwise hide the only control able to un-hide it. `themeContract.test.ts`
 *  makes both unreachable for a registered theme; these are the belts, in the `?? field.default` idiom.
 *
 *  A DECLARED sibling that is not a `seg` is a different case and is NOT fail-open: `is` is string-only, so
 *  a switch's boolean can never match and the row stays hidden. The contract test bans that shape too — a
 *  boolean controller would be a different feature (an enable toggle), not this one.
 *
 *  Visibility is a RENDER concern only. Nothing here writes, and a hidden row's stored value is never
 *  pruned: it keeps syncing in the appearance doc and reappears with its old pick when the controller
 *  returns (the explicit §12.6 contract). */
export function settingRowVisible(
  themeId: ThemeId,
  key: string,
  field: ThemeSettingField,
  rawSibling: ThemeSettingValue | undefined,
): boolean {
  const cond = field.showWhen;
  if (!cond) return true; // unconditional — the shape every existing row has
  if (cond.key === key) return true; // self-reference: unhonorable, so it is not honored
  const sibling = resolveThemeSetting(themeId, cond.key, rawSibling);
  if (sibling === undefined) return true; // the sibling isn't declared by this theme
  return (
    typeof sibling === "string" && (Array.isArray(cond.is) ? cond.is : [cond.is]).includes(sibling)
  );
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
