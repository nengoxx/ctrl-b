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

// The slot surfaces the engine resolves per-theme. `Partial<ThemeSlots>` in a ThemeDef — a theme
// fills only what it overrides; the rest falls back to BASE (§9.4). vapor fills ALL of these.
//
// T0 models the SHELL + tab-body slots that App.tsx (the slot host) renders directly. Finer
// overridable sub-slots that live *inside* a tab body — NowMonitoring (T1), HostDetail (T4/T5,
// inline vs slide-panel vs bottom-sheet), ChatBubble, Hero, TabIndicator — are added to this
// interface in their OWNING slice, once their prop contracts can be finalized against the real BASE
// implementation (D28 open sub-decision (a)). They're purely additive optional fields; vapor never
// uses them (its tab bodies are self-contained + frozen).
export interface ThemeSlots {
  // Shell chrome — hosted directly by App.tsx.
  AppBar: ComponentType;
  Composer: ComponentType;
  TabBar: ComponentType<{ onPrefetch?: (t: TabId) => void }>;
  // Tab bodies — one per tab; each takes `{ active }`. The FleetView is the signature surface a
  // theme most often restructures (vapor: FleetTab incl. Hero+rows+summary; cosmos: orbital;
  // frontier: art-map). The others restyle via tokens by default but can be overridden.
  FleetView: ComponentType<{ active: boolean }>;
  AgentView: ComponentType<{ active: boolean }>;
  UtilsView: ComponentType<{ active: boolean }>;
  ConfShell: ComponentType<{ active: boolean }>;
}

export type SlotName = keyof ThemeSlots;

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

export interface ThemeDef {
  id: ThemeId;
  label: string;
  palettes: PaletteModel;
  tabs: TabDef[]; // v1: every theme returns the standard 4 (§9.8); the registry supports non-4.
  slots: Partial<ThemeSlots>; // vapor = complete; others = only the surfaces they restructure.
  // Lazy-load the theme's CSS bundle (code-split <link>) + activate its fonts. vapor's CSS is in
  // `layer(frozen)` (always loaded) and its fonts are in index.html → both are no-ops for vapor.
  loadStyles: () => Promise<unknown>;
  loadFonts?: () => Promise<void>;
  present?: Present; // omit → theme has no spatial/per-host layout
  assets?: Record<string, () => Promise<string>>; // import.meta.glob map keyed by name (frontier art)
}

// Only BUILT themes appear here, so a Partial record — resolution falls back to BASE for any
// missing theme/slot (§9.4). T0 = `{ vapor }`.
export type ThemeRegistry = Partial<Record<ThemeId, ThemeDef>>;

// Which REGISTERED theme is structurally closest to BASE, for the rare future case an exotic theme
// omits a slot BASE can't render generically (owner: minimal). Inert until T1 — T0's resolution
// fallback is BASE.slots directly; nothing in T0 reads this. (§9.3 "BASE vs FALLBACK".)
export const FALLBACK: ThemeId = "minimal";
