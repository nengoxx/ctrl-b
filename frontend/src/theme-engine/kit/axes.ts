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

// ── axis: `composerSkin` (Slice B, D37 — widened past the composer in W2) ──────────────────────────────
// The COMPOSER's chrome as a cross-theme choice, ORTHOGONAL to the composer LAYOUT (the `composer` variant
// seg): where `outlines` owns the chat thread, this axis owns the input bar AND the floating panels that
// belong to it — its popovers, the TTS mini-player, the pinned plan head (kit.css's `--skin-*` vocabulary,
// §14.16). The KEY stays `composerSkin`: the bar is still what the choice is named and picked for.
// UNLIKE `outlines`, the five skins
// are NOT axes.css strips — they are FIRST-CLASS kit.css chrome (`@layer base`) keyed on `body[data-composer-
// skin]`, because a skin carries fills/shadows and the axes layer forbids fills (it outranks theme CSS). Same
// resolver machinery: a validated override, else the theme's declared default; an undeclared theme → the
// kit-native `outline` look. No theme-id branching — the per-theme DEFAULT carries the distinction
// (frontier's `bezel`; minimal/cosmos `outline`).

/** The composer chrome skins (D37 catalog): `outline` = the Kit's native bordered bar (the base kit.css
 *  chrome — no stamp keying, so pre-mount/no-stamp renders it); `glass` = the old Borderless look (frost +
 *  deep elevation + icon-forward stacked controls); `bezel` = frontier's F4 composer sweep; `sleek` = the old
 *  Ghost (fully transparent bar + extended readability scrim); `arcade` = an opaque CABINET PANEL — no
 *  frost, no outline anywhere, one hard zero-blur accent drop, tight corners and squared-off controls
 *  (D52 G3, born of gacha's
 *  prototype, but LOOK-NAMED and authored on semantic tokens so it is a real catalog member every theme can
 *  wear — never a theme-scoped bypass of D37). */
export type ComposerSkin = "outline" | "glass" | "bezel" | "sleek" | "arcade";

// The SHARED `composerSkin` setting spec (D29 §14.3). Themes spread it into `ThemeDef.settings` with their own
// default — one source of the option list. A `seg` → the Appearance picker auto-renders a Seg (ConfTab), synced
// via `ui.themeSettings`. Mirrors `composerLayoutSetting`: value = the skin id, label display-only.
export function composerSkinSetting(def: ComposerSkin = "outline"): ThemeSettingField {
  return {
    type: "seg",
    label: "Composer skin",
    desc: "chrome for the input bar and its panels",
    options: [
      { val: "outline", label: "Outline" },
      { val: "glass", label: "Glass" },
      { val: "bezel", label: "Bezel" },
      { val: "sleek", label: "Sleek" },
      { val: "arcade", label: "Arcade" },
    ],
    default: def,
  };
}

// Resolve the EFFECTIVE composer skin for a theme. Routes through `useThemeSetting` → `resolveThemeSetting`
// (validated override, else the declared default), so a stale/corrupt synced value — e.g. a LEGACY `borderless`
// or `ghost` left over from when those were composer LAYOUTS — degrades to the default instead of casting
// through. A theme that declares NO `composerSkin` (vapor / any frozen theme) resolves to `undefined` → coerced
// to `"outline"` here: an undeclared theme keeps the kit-native bordered bar (and — belt to the `.kit`-scoped
// chrome — vapor can never match the skin selectors anyway). No theme-id branching: the per-theme DEFAULT
// carries the distinction (frontier's `bezel`).
export function useComposerSkin(themeId: ThemeId): ComposerSkin {
  return useThemeSetting<ComposerSkin>(themeId, "composerSkin") ?? "outline";
}
