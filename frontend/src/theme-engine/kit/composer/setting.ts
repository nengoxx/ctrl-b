import type { ThemeSettingField } from "../../types";

// The SHARED composer-LAYOUT setting spec (D31) — the input bar's SHAPE (the three REAL variant components),
// ORTHOGONAL to the composer CHROME (the `composerSkin` axis, kit/axes.ts). Themes spread it into
// `ThemeDef.settings` with their own default — one source of the option list, no per-theme duplication. Value =
// the variant id (registry key); the user-facing label is display-only ("Docked" for `sheet`, "Line" for
// `line`). The old `borderless`/`ghost` options SPLIT OUT into the `composerSkin` axis (F5 slice B) — they were
// pure-CSS chrome wrappers, not layout; a stale stored `borderless`/`ghost` degrades to the default via
// `resolveThemeSetting` (validated against these options).
export function composerLayoutSetting(
  def: "stacked" | "sheet" | "line" = "stacked",
): ThemeSettingField {
  return {
    type: "seg",
    label: "Composer",
    desc: "input bar layout",
    options: [
      { val: "stacked", label: "Stacked" },
      { val: "sheet", label: "Docked" },
      { val: "line", label: "Line" },
    ],
    default: def,
  };
}
