import type { ThemeSettingField } from "../../types";

// The SHARED composer-layout setting spec (D31). Themes spread it into `ThemeDef.settings` with their own
// default — one source of the option list, no per-theme duplication. Value = the variant id (registry key);
// the user-facing label is display-only ("Sleek" for the `ghost` variant, "Docked" for the `sheet` variant).
export function composerLayoutSetting(
  def: "stacked" | "ghost" | "sheet" = "stacked",
): ThemeSettingField {
  return {
    type: "seg",
    label: "Composer",
    desc: "input bar layout",
    options: [
      { val: "stacked", label: "Stacked" },
      { val: "ghost", label: "Sleek" },
      { val: "sheet", label: "Docked" },
    ],
    default: def,
  };
}
