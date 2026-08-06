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
export type ThemeId =
  "vapor" | "minimal" | "phosphor" | "cosmos" | "frontier" | "observatory" | "gacha";

// Light/dark axis — generalizes today's vapor dark-only default. A theme opts in via `palettes.modes`.
export type Mode = "dark" | "light";

// Reuse the existing Tab union (store/ui.ts) — don't redefine the tab id space.
export type TabId = Tab;

// One tab in a theme's tab set. Extends today's hardcoded TabBar `{id,glyph,lbl}` with `hasComposer`
// (§13.6 — moves the `showComposer = tab==="fleet"||"agent"` hardcode out of App.tsx + ui.ts so a
// theme's tab set drives composer visibility, the flexible-tab-registry requirement, D28 #4).
//
// Stays PURE DATA (D35 body-registry ruling: "eager DATA, lazy COMPONENTS") — NO component field. The
// id→body map lives in kit space (DefaultRoot), so this module keeps `tabs.ts`'s component-free invariant.
export interface TabDef {
  id: TabId;
  glyph: string;
  lbl: string;
  // Optional SECOND label line under `lbl` on the tab bar (D52 / GACHA_PLAN §4.9 ledger — gacha's ruled
  // Japanese nav sub-labels 編成/案内/設定/ツール). Purely additive DATA, exactly like `lbl`: a theme that
  // omits it renders byte-identically (KitNavBar emits no node at all), and the CSS-attribute alternative was
  // rejected because labels are data, not decoration. The floating NavMenu stays icon-only — it does NOT
  // render this.
  subLabel?: string;
  hasComposer: boolean;
  // Generic lazy-mount flag (D35 §F0) — generalizes the one-off Conf latch. A `lazy` body is mounted only
  // after its section first becomes active, then kept mounted (draft state survives), and DefaultRoot wraps
  // it in an ErrorBoundary+Suspense. Omitted → eager (always mounted, `.active`-gated). Conf is the only
  // `lazy` section today.
  lazy?: boolean;
}

// A theme declares WHICH palette axes it supports; the Conf picker renders only the declared axes.
// vapor → named accents only (aqua/ember, no mode axis). minimal → mode toggle + 4 OKLCH hues.
export interface PaletteModel {
  modes?: Mode[]; // omitted → theme is single-mode (vapor: dark-only)
  // Each accent/palette option carries an optional `swatch` for the Conf color-swatch picker (the theme
  // owns its palette identity, co-located here). A single CSS color/gradient → one chip (minimal's hues,
  // vapor's per-accent gradient); a string[] → a conic multi-token preview (the seam for richer "design
  // framework" palettes — additive, no app/registry change). Omitted → a neutral chip.
  //
  // `accent` is the OPTIONAL second half of the chip (G6.3, owner ruling 2026-08-06): the variant's FLAT
  // `--accent` — the colour the app actually tints its controls with — shown as a hard band down the right
  // of the oval, over the `swatch` gradient. A gradient chip previews the SCENERY a palette paints; it does
  // not say which single hue every switch, ring and fill will take, and on gacha's eight variants that is
  // the difference the owner picks between (family 1's three share their brand trio and differ only in the
  // ramp). Declared per option, so a theme that omits it keeps the plain gradient oval and nothing about
  // its picker changes. A LITERAL by the same convention as `swatch`: `var(--accent)` would preview the
  // ACTIVE palette on every chip in the group, so the control could not preview what it picks.
  accents?: { id: string; label: string; swatch?: string | string[]; accent?: string }[];
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
      // `swatch` is the ADDITIVE slot the D52 §4.9 ledger committed for gacha's dossier picker (G6): a
      // colour CHIP rendered inside the seg option beside its label, so a palette row previews what it
      // picks. Typed exactly like `PaletteModel.accents[].swatch` above and read by the same
      // `chipBackground()` helper — a single CSS colour/gradient → one chip, a string[] → the conic
      // multi-token preview. "A swatch is DATA for the chip", so it lives on the option, not in CSS.
      // Omitted → `Seg` emits NO extra DOM node at all, so every existing seg row renders byte-identically.
      options: { val: string; label: string; swatch?: string | string[] }[];
      default: string;
    };

// An open record keyed by setting name. Open (not a closed union) so a theme adds an option additively
// — no app/core/backend change (owner directive: shape data to extend, not migrate).
export type ThemeSettingsSpec = Record<string, ThemeSettingField>;

// A resolved setting value — a switch (boolean) or a seg (string).
export type ThemeSettingValue = string | boolean;

// The curated section-layout presets (D35 / FRONTIER_PLAN §1). Each preset recomposes WHERE the standard
// sections live — never removes functionality. `4-tab` = today; `3-tab` hosts utils inside Conf; `2-tab`
// additionally moves Conf off-bar (reached via the menu). The lever (`ui.layout`) picks one; a theme
// declares its default + supported set below.
export type LayoutId = "4-tab" | "3-tab" | "2-tab";

// A layout preset (adversarial-review schema, 2026-07-07): `bar` = the on-bar sections (in bar order);
// `hosted` maps a section → the host section it renders INSIDE (Axis B, one curated pair today: utils→conf).
// Sections in neither `bar` nor `hosted` are off-bar-and-unhosted → the menu affordance (Axis A). See
// `theme-engine/layout.ts` for the preset table + the partition/coercion logic.
export interface LayoutPreset {
  bar: TabId[];
  hosted?: Partial<Record<TabId, TabId>>;
}

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
  // Lazy-load the Root COMPONENT module, so a non-active theme's presentation — esp. a bespoke theme's
  // canvas / orbital Fleet — never enters the default user's initial bundle. `switchTheme` preloads it
  // (alongside loadStyles/loadFonts) before the skin flips, so the `lazy(Root)` resolves with no Suspense
  // flash. OMIT for an EAGER theme whose Root must render on first paint without Suspense (vapor — still
  // eager after D51 V0 made cosmos the default; cosmos itself keeps its lazy Root, plan §3 V0/V6).
  loadRoot?: () => Promise<unknown>;
  present?: Present; // §9.9 — per-host visual encoding (cosmos/frontier); omit → no spatial layout
  settings?: ThemeSettingsSpec; // §14.3 — theme-namespaced options auto-rendered by the Appearance picker
  // Eager `import.meta.glob` URL map keyed by bare asset name (frontier's art.ts). EAGER strings, not lazy
  // thunks: the images are URLs REFERENCED BY CSS (the bytes stay lazy — the browser only fetches an asset
  // when its background-image is painted), so a thunk bought nothing; and Vite 8's non-eager globs don't
  // reach the build manifest. The prior lazy-thunk shape was speculative (zero consumers) — settled here on
  // frontier's first real use (§9.3).
  assets?: Record<string, string>;
  // Section-layout capability declaration (D35 §F0) — additive, purely a per-theme capability list the
  // global `ui.layout` lever is resolved against (NOT synced state). `defaultLayout` = the preset `auto`
  // adopts (omit → `4-tab`). `layouts` = the supported set the picker's pick is coerced into (omit → ALL
  // presets — the ratified ideal "all themes can offer all modes"). NO registered theme restricts the set
  // today: vapor's ladder-owned `["4-tab"]` waiver retired at D51 V6, so the field is a seam for a future
  // theme whose presentation genuinely can't express a preset. Resolved by `layout.ts#resolveLayout`.
  defaultLayout?: LayoutId;
  layouts?: LayoutId[];
  // Owner-supplied art (D52/G5): the media NAMESPACE this theme's surfaces read.
  media?: ThemeMedia;
}

/** A theme's owner-media LINK (D53 / MEDIA_PLAN §5 — the registry inversion). Everything DESCRIPTIVE about
 *  a namespace (its roles, the gallery's copy for them, the `slots` pins, the advisory bounds) lives in
 *  `theme-engine/mediaRegistry`, because a namespace need not belong to a theme at all — `kit` belongs to
 *  none. A ThemeDef says only which namespace it reads. */
export interface ThemeMedia {
  /** The `/api/media/{ns}` namespace, and a key of `MEDIA_NS`. `gacha` is the first. */
  ns: string;
}

// Only BUILT themes appear here (a Partial record) — `rootFor` falls back to `DEFAULT_THEME` for an
// unregistered id. Adding a theme = one row here + its module (D29 §14). M0 = `{ vapor }`.
export type ThemeRegistry = Partial<Record<ThemeId, ThemeDef>>;
