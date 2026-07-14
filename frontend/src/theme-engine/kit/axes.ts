// Kit AXES (Slice A) — cross-theme "presentation axes" resolved to a `body[data-*]` stamp that a small,
// layer-elevated stylesheet (`axes.css`) keys off. An axis is a per-theme SETTING (D29 §14.3, the VS Code
// `configuration` model) whose resolved boolean is projected onto the DOM once, so the Kit's shared chrome
// can honor it uniformly WITHOUT any theme-id branching (THEME_ENGINE §14.14 invariant: no `if (theme ===
// …)` in the engine). The FIRST axis is `outlines` — promoted out of frontier's theme-wide no-outlines sweep
// (F4) into a Kit-wide toggle so every theme can offer "resting borders on/off" for the chat surfaces.
//
// Shape mirrors the composer/plan settings (`composerLayoutSetting` / `planPlacementSetting` +
// `usePlanPlacement`): a shared spec FACTORY themes spread into `ThemeDef.settings` (one source of the option
// list, per-theme default), plus a RESOLVER hook built on the generic `useThemeSetting` — no duplicated
// validation. The stamp itself lives in <AppEngines/> (App.tsx), NOT in `store/ui.ts#applyBodyAttrs`: the
// store must never import the theme registry (the store↛registry circular-import hazard), and axis resolution
// reads the registry (the theme's declared default).

import { useThemeSetting } from "../settings";
import type { ThemeId, ThemeSettingField } from "../types";

// The SHARED `outlines` setting spec (D29 §14.3). Themes spread it into `ThemeDef.settings` with their own
// default: reskin themes that lean on the Kit's bordered chrome default ON (minimal/cosmos); a borderless
// bespoke theme defaults OFF (frontier, whose F4 look IS the no-outlines chat). A `switch` → the Appearance
// picker auto-renders a Switch (ConfTab), synced via `ui.themeSettings` — zero Conf/store schema change.
export function outlinesSetting(defaultOn: boolean): ThemeSettingField {
  return {
    type: "switch",
    label: "Outlines",
    desc: "resting borders on chat surfaces",
    default: defaultOn,
  };
}

// Resolve the EFFECTIVE outlines boolean for a theme. Routes through `useThemeSetting` → `resolveThemeSetting`
// (validated override, else the theme's declared default), so a stale/corrupt synced value degrades to the
// default instead of casting through. A theme that declares NO `outlines` setting (vapor / any frozen theme)
// resolves to `undefined` → coerced to `true` here: an undeclared theme keeps its native (bordered) chrome,
// and — belt to the `.kit`-scoped braces in axes.css — vapor (no `.kit` marker) can never match the axis
// selectors anyway. No theme-id branching: the per-theme DEFAULT carries the distinction (frontier's `false`).
export function useOutlines(themeId: ThemeId): boolean {
  return useThemeSetting<boolean>(themeId, "outlines") ?? true;
}
