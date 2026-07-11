import { useUISlice } from "../../../../store/ui";
import { useThemeSetting } from "../../../settings";
import type { ThemeSettingField } from "../../../types";

// COMPOSER_SURFACE_PLAN §0 (A4) — the plan PLACEMENT axis. Where a theme's live task-plan renders:
//   • "inline"  — the pill + peek sheet composed INTO the composer (the D30 `kitPlanComposerSlots`),
//                 mounted by DefaultRoot around the composer.
//   • "pinned"  — a kit-tokened panel pinned to the top of the AGENT TAB's scroll flow (PinnedPlanPanel),
//                 mounted by AgentTab.
// A placement is HETEROGENEOUS — the two options mount DIFFERENT components in DIFFERENT DOM sites (a
// composer slot vs. an agent-tab panel). That mount-site discriminator is the whole point of the axis, so
// this stays two explicit branches at the call sites, NOT a variant registry (the composer STYLE axis is a
// registry because every variant is one interchangeable composer component; placements are not). Concrete-
// first (rule of three): a registry would hide the mount site in optional fields for no second consumer.
//
// As-built key delta from the plan doc: the setting key is `planPlacement`, not the doc's `planPill` — the
// pinned option is a full panel, not a pill, so "placement" names the axis without implying a pill.

export type PlanPlacement = "inline" | "pinned";

// The SHARED plan-placement setting spec (D31) — the exact pattern as `composerLayoutSetting`. Themes spread
// it into `ThemeDef.settings` with their own default; one source of the option list, no per-theme dup. The
// key is chosen by the theme (they use `planPlacement`); the value is the placement id.
export function planPlacementSetting(def: PlanPlacement = "inline"): ThemeSettingField {
  return {
    type: "seg",
    label: "Plan",
    desc: "task plan placement",
    options: [
      { val: "inline", label: "Inline" },
      { val: "pinned", label: "Pinned" },
    ],
    default: def,
  };
}

// Resolve the active theme's chosen plan placement. Mirrors `useComposerLayout`: reads the per-theme
// `planPlacement` setting (undefined when the theme declares none — vapor, or any not-yet-declaring theme →
// the "inline" fallback). `resolveThemeSetting` already coerces a declared-but-invalid value to the theme's
// default, so the only values reaching here are `"inline"`, `"pinned"`, or `undefined` (undeclared key); the
// guard below folds an undeclared-theme `undefined` (and any stray non-placement string) to "inline".
export function usePlanPlacement(): PlanPlacement {
  const theme = useUISlice((s) => s.theme);
  const v = useThemeSetting<string>(theme, "planPlacement");
  return v === "inline" || v === "pinned" ? v : "inline";
}
