import type { ThemeSettingField } from "../../types";

// The SHARED composer-layout setting spec (D31). Themes spread it into `ThemeDef.settings` with their own
// default — one source of the option list, no per-theme duplication. Value = the variant id (registry key);
// the user-facing label is display-only ("Borderless" for `borderless`, "Sleek" for `ghost`, "Docked" for
// `sheet`, "Line" for `line`).
export function composerLayoutSetting(
  def: "stacked" | "borderless" | "ghost" | "sheet" | "line" = "stacked",
): ThemeSettingField {
  return {
    type: "seg",
    label: "Composer",
    desc: "input bar layout",
    options: [
      { val: "stacked", label: "Stacked" },
      { val: "borderless", label: "Borderless" },
      { val: "ghost", label: "Sleek" },
      { val: "sheet", label: "Docked" },
      { val: "line", label: "Line" },
    ],
    default: def,
  };
}
