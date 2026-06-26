// Theme-engine types (Phase 11 / D28, THEME_ENGINE.md §9.3). The typed descriptor model — one
// `ThemeDef` per theme, registered in `ThemeRegistry` — mirroring the backend action-registry pattern.
// Adding a theme = one registry row + one self-contained module (the "natively add new themes" goal).
//
// ⛔ vapor is FROZEN: it registers its existing components as slots verbatim (no edits). Non-vapor
// themes are self-contained modules built in their own Tn slice. T0 registers ONLY vapor.

import type { ComponentType } from "react";

import type { Tab } from "../store/ui";

// The set of themes the picker/types know about. The *registry* only contains BUILT themes (T0 =
// vapor); the rest are declared here so the palette picker + ui-store stay type-safe as they land.
export type ThemeId = "vapor" | "minimal" | "phosphor" | "cosmos" | "frontier" | "observatory";

// Light/dark axis — generalizes today's vapor dark-only default. A theme opts in via `palettes.modes`.
export type Mode = "dark" | "light";

// Reuse the existing Tab union (store/ui.ts) — don't redefine the tab id space.
export type TabId = Tab;

// One tab in a theme's tab set. Extends today's hardcoded TabBar `{id,glyph,lbl}` with `hasComposer`
// (§13.6 — moves the `showComposer = tab==="fleet"||"agent"` hardcode out of App.tsx + ui.ts so a
// theme's tab set drives composer visibility, the flexible-tab-registry requirement, D28 #4).
export interface TabDef {
  id: TabId;
  glyph: string;
  lbl: string;
  hasComposer: boolean;
}

// A theme declares WHICH palette axes it supports; the Conf picker renders only the declared axes.
// vapor → named accents only (aqua/ember, no mode axis). minimal → mode toggle + 4 OKLCH hues.
export interface PaletteModel {
  modes?: Mode[]; // omitted → theme is single-mode (vapor: dark-only)
  accents?: { id: string; label: string; value?: string }[]; // hue swatches OR named palettes
  defaultMode?: Mode;
  defaultAccent?: string;
}

// Per-host visual encoding (§9.9) — the neutral output contract (data-viz "channels"). A theme owns
// its `present()`; derive-by-default from neutral host fields, optional override merged on top.
// Declared now for type stability; first CONSUMED at T3/T4 (no spatial theme exists yet in T0).
export interface VisualEncoding {
  position?: { x: number; y: number } | { angle: number; radius: number };
  size?: number;
  color?: string;
  symbol?: string;
  asset?: string;
  motion?: { speed: number; angle: number };
  [k: string]: unknown; // open — theme-specific extras
}

// host typed loosely here (the engine's Host DTO lives in ../types) to avoid a circular import; the
// concrete signature is pinned when a theme first implements present() (T3/T4).
export type Present = (
  host: unknown,
  index: number,
  override?: Record<string, unknown>,
) => VisualEncoding;

// Per-theme settings (D29 §14.3) — the "minimal hides the appbar" mechanism. A theme declares a small
// schema of namespaced options; the Appearance picker auto-renders it (switch→Switch, seg→Seg); values
// live in the open `ui.themeSettings[id]` map and sync via the appearance channel. Mirrors VS Code's
// `configuration` contribution points (each entry = {type, default, label/desc}; resolve to `default`
// when there's no override) — the dominant external convention for plugin-namespaced settings.
export type ThemeSettingField =
  | { type: "switch"; label: string; desc?: string; default: boolean }
  | {
      type: "seg";
      label: string;
      desc?: string;
      options: { val: string; label: string }[];
      default: string;
    };

// An open record keyed by setting name. Open (not a closed union) so a theme adds an option additively
// — no app/core/backend change (owner directive: shape data to extend, not migrate).
export type ThemeSettingsSpec = Record<string, ThemeSettingField>;

// A resolved setting value — a switch (boolean) or a seg (string).
export type ThemeSettingValue = string | boolean;

export interface ThemeDef {
  id: ThemeId;
  label: string;
  // The theme owns its WHOLE presentation (D29 §14.3) — App renders the active theme's Root. Reskin
  // themes set `Root = <DefaultRoot …/>` (the Kit scaffold); bespoke themes write their own.
  Root: ComponentType;
  palettes: PaletteModel; // §9.8 — declared mode/accent/named axes the Appearance picker renders
  // Lazy-load the theme's CSS bundle (code-split <link>) + activate its fonts. The DEFAULT theme is
  // eager-loaded (no first-paint FOUC), so its `loadStyles` is a no-op (§14.6).
  loadStyles: () => Promise<unknown>;
  loadFonts?: () => Promise<void>;
  present?: Present; // §9.9 — per-host visual encoding (cosmos/frontier); omit → no spatial layout
  settings?: ThemeSettingsSpec; // §14.3 — theme-namespaced options auto-rendered by the Appearance picker
  assets?: Record<string, () => Promise<string>>; // import.meta.glob map keyed by name (frontier art)
}

// Only BUILT themes appear here (a Partial record) — `rootFor` falls back to the default (vapor) for an
// unregistered id. Adding a theme = one row here + its module (D29 §14). M0 = `{ vapor }`.
export type ThemeRegistry = Partial<Record<ThemeId, ThemeDef>>;
