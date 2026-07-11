import type { ThemeSettingField } from "../../types";

// The SHARED composer-layout setting spec (D31). Themes spread it into `ThemeDef.settings` with their own
// default — one source of the option list, no per-theme duplication. Value = the variant id (registry key);
// the user-facing label is display-only ("Docked" for the "sheet" variant). (A2b adds a third option
// "Sleek" for the `ghost` variant — NOT this slice.)
export function composerLayoutSetting(def: "stacked" | "sheet" = "stacked"): ThemeSettingField {
  return {
    type: "seg",
    label: "Composer",
    desc: "input bar layout",
    options: [
      { val: "stacked", label: "Stacked" },
      { val: "sheet", label: "Docked" },
    ],
    default: def,
  };
}
