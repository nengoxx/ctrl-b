// Tiny UI store (DESIGN.md §13: "UI-only state"). Dependency-free external store on the shared
// `createStore` binding (D23), persisted via `persist` helpers and mirrored to <html>/<body> data-attrs.
// (Composer visibility is no longer a core concern — the `useSections` controller exposes `hasComposer`
// from the theme's tab set, and each theme owns its composer + any `.no-composer`-style padding hook.)
//
// Theme-engine generalization (Phase 11 / D28 §9.8): the single conflated `theme` field splits into
// **{theme, mode, accent}** — `theme` is the SKIN id ("vapor"|"minimal"|…, the slot+CSS identity),
// `mode` the light/dark axis, `accent` the named-palette/hue id. `applyBodyAttrs` writes the NEW
// `body[data-skin]` identity (§13.1) and keeps `body[data-theme]` meaning vapor's FROZEN accent axis
// (dark/aqua/ember) — set only when skin=vapor, cleared otherwise. Non-vapor themes additionally get
// `body[data-mode]`/`body[data-accent]` (the prototypes scope palettes by attribute).

import type { Mode, ThemeId, ThemeSettingValue } from "../theme-engine/types";
import { createStore } from "./createStore";
import { loadPersisted, savePersisted } from "./persist";

export type { Mode, ThemeId } from "../theme-engine/types";
export type Tab = "fleet" | "agent" | "utils" | "conf";
export type Motion = "full" | "reduced";
export type Perf = "full" | "lite";
/** Top-bar / navigation chrome mode (global, per-device). `visible` = appbar + bottom tab bar; `off` = no
 *  appbar, tab bar only; `minimal` = no appbar in layout + no tab bar, navigation via the floating NavMenu.
 *  DefaultRoot themes honor all three; bespoke Roots (vapor) honor visible/off and treat minimal as off for
 *  now (THEME_ENGINE §14.13 — the bespoke-Root minimal contract + the vapor TODO). */
export type AppbarMode = "visible" | "off" | "minimal";

// Open per-theme settings (D29 §14.3): `{ themeId: { key: value } }`. Open so a theme adds an option
// additively (no new top-level field). Values resolve via `useThemeSetting(id, key)`, which falls back
// to the theme's declared `ThemeDef.settings[key].default` when there's no override here.
export type ThemeSettingsMap = Record<string, Record<string, ThemeSettingValue>>;

export interface UIState {
  theme: ThemeId; // the active SKIN ("vapor" in v1) — drives slot resolution + body[data-skin]
  mode: Mode; // light/dark axis — vapor is dark-only (unused for vapor); non-vapor sets body[data-mode]
  accent: string; // named palette OR hue id — vapor: "dark"|"aqua"|"ember" on body[data-theme]
  tab: Tab;
  ttsAuto: boolean;
  // ambient animations (LED pulse, equalizer, sun bob, grid scroll, …). SYNCED via the appearance
  // channel (owner directive 2026-06-26: consistent across devices) — see useAppearance.
  motion: Motion;
  // backdrop-blur on the frosted bars: "full" (the glass look) vs "lite" (blur off → opaque bars). A
  // per-device speed lever (`backdrop-filter: blur()` is ~10× slower on Firefox-Android than Chrome),
  // but SYNCED with the rest of appearance (owner directive: consistent across devices).
  perf: Perf;
  // Theme-namespaced options (skyline/loz/hero/waveform for vapor; "density" for minimal, …). The
  // theme owns the schema (`ThemeDef.settings`); this is the override store. SYNCED via appearance.
  themeSettings: ThemeSettingsMap;
  // The top-bar / nav chrome mode — a GLOBAL, cross-theme display lever, per-DEVICE (persisted locally, NOT
  // synced — a layout choice that can differ per screen). `visible`/`off`/`minimal` (see AppbarMode): every
  // theme's Root honors it (DefaultRoot via the `appbarMode` prop; vapor maps it to its own AppBar render).
  // Migrated from the old boolean `hideAppbar` (and an earlier per-theme `minimal` setting) by
  // `migrateAppbarMode`.
  appbarMode: AppbarMode;
}

// First-load default for `motion`: honor the OS `prefers-reduced-motion` preference once.
// After the user touches the toggle the persisted value wins; this only affects the very
// first paint on a fresh install / cleared localStorage.
function defaultMotion(): Motion {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full";
  } catch {
    return "full";
  }
}

const DEFAULTS: UIState = {
  theme: "vapor",
  mode: "dark",
  accent: "dark", // vapor's default accent = the bare :root (vapor.css), matching the old `theme:"dark"`
  tab: "fleet",
  ttsAuto: true,
  motion: defaultMotion(),
  perf: "full", // default to the full glass look; the owner opts into "lite" on a slow device
  themeSettings: {}, // per-theme overrides resolve against each ThemeDef.settings default
  appbarMode: "visible", // global per-device chrome lever; every theme's Root honors it
};

const KEY = "ctrlb.ui";

// vapor's former top-level decorative toggles, now its `ThemeDef.settings` (M3 / §14.3). Listed here
// only so the one-time migration can fold a pre-M3 persisted shape into `themeSettings.vapor`.
const LEGACY_VAPOR_SETTINGS = ["skyline", "loz", "heroOn", "waveformOn"] as const;

// One-time persisted-shape remap (§13.4). The pre-Phase-11 shape stored the conflated
// `theme ∈ {dark,aqua,ember}` (the vapor accent). `loadPersisted`'s field-fill merge can't VALUE-remap,
// so a stored `theme:"aqua"` would read back as an invalid ThemeId. Remap it to {theme:"vapor",accent}.
// (Single-user, low-stakes — just so the owner's own localStorage doesn't reset on this update.)
// Exported for unit testing (the store loads/migrates once at module import, so the remap is tested
// directly rather than via a re-import dance).
export function migrateLegacyTheme(s: UIState): UIState {
  const legacy = s.theme as string;
  if (legacy === "dark" || legacy === "aqua" || legacy === "ember") {
    return { ...s, theme: "vapor", mode: "dark", accent: legacy };
  }
  return s;
}

// One-time M3 remap (§14.3): a pre-M3 persisted state carried `skyline/loz/heroOn/waveformOn` as
// top-level fields. `loadPersisted` keeps them as extras (its merge is `{...defaults, ...parsed}`), so
// fold any present ones into `themeSettings.vapor` (never overwriting an already-migrated value) and
// drop the stale top-level keys. Idempotent; exported for unit testing.
export function migrateVaporSettings(s: UIState): UIState {
  const loose = s as UIState & Record<string, ThemeSettingValue>;
  const present = LEGACY_VAPOR_SETTINGS.filter((k) => k in loose);
  if (present.length === 0) return s;
  const vapor = { ...s.themeSettings.vapor };
  for (const k of present) {
    if (!(k in vapor)) vapor[k] = loose[k];
  }
  const next: Record<string, unknown> = { ...s, themeSettings: { ...s.themeSettings, vapor } };
  for (const k of present) delete next[k];
  return next as unknown as UIState;
}

/** Strip the legacy per-theme `hideAppbar` from a themeSettings map (it's now the global `appbarMode`),
 *  pruning any entry left empty. Returns the SAME ref when nothing changed (so callers can detect a change).
 *  The old key was SYNCED in the appearance doc, so it keeps coming back — hence we strip it every load. */
export function stripLegacyAppbar(ts: ThemeSettingsMap): ThemeSettingsMap {
  let changed = false;
  const out: ThemeSettingsMap = {};
  for (const [id, opts] of Object.entries(ts)) {
    if (opts && "hideAppbar" in opts) {
      changed = true;
      const { hideAppbar: _drop, ...rest } = opts;
      if (Object.keys(rest).length) out[id] = rest;
    } else {
      out[id] = opts;
    }
  }
  return changed ? out : ts;
}

// One-time (§13.4): the appbar lever was the boolean `hideAppbar` (global, after an earlier per-theme→global
// fold); it's now the tri-state `appbarMode` ("visible"|"off"|"minimal"). SEED it from a legacy boolean — the
// old global `hideAppbar`, or (older still) a per-theme `themeSettings.<id>.hideAppbar` — ONLY for a genuine
// pre-migration state (`hasAppbarMode` = the persisted blob had no `appbarMode` key). Once the user has an
// explicit `appbarMode`, NEVER override it (the per-theme key is synced + keeps returning — that bug forced
// the choice back to "off" every reload). The stale `hideAppbar` keys are always stripped. Exported for tests.
export function migrateAppbarMode(s: UIState, hasAppbarMode: boolean): UIState {
  const loose = s as UIState & { hideAppbar?: boolean };
  const themeSettings = stripLegacyAppbar(s.themeSettings);
  const hadGlobalLegacy = "hideAppbar" in loose;
  const hadThemeLegacy = themeSettings !== s.themeSettings;
  if (!hadGlobalLegacy && !hadThemeLegacy) return s; // no legacy keys anywhere → nothing to do
  let appbarMode = s.appbarMode;
  if (!hasAppbarMode) {
    // pre-migration: derive from the first legacy boolean found (global wins, then per-theme)
    let legacy = typeof loose.hideAppbar === "boolean" ? loose.hideAppbar : undefined;
    if (legacy === undefined) {
      for (const opts of Object.values(s.themeSettings)) {
        if (opts && typeof opts.hideAppbar === "boolean") {
          legacy = opts.hideAppbar;
          break;
        }
      }
    }
    appbarMode = legacy ? "off" : "visible";
  }
  const next: Record<string, unknown> = { ...s, appbarMode, themeSettings };
  delete next.hideAppbar;
  return next as unknown as UIState;
}

const { emit, useStore } = createStore();
// Whether the PERSISTED blob already carried the new `appbarMode` (vs being filled by DEFAULTS) — read the raw
// value, since `loadPersisted` merges over defaults. Distinguishes a pre-migration state (seed appbarMode from
// the legacy hideAppbar) from a user who has set it (keep their choice; the synced legacy key must not override).
function rawHasAppbarMode(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    return raw != null && typeof JSON.parse(raw) === "object" && "appbarMode" in JSON.parse(raw);
  } catch {
    return false;
  }
}
let state: UIState = migrateAppbarMode(
  migrateVaporSettings(migrateLegacyTheme(loadPersisted(KEY, DEFAULTS))),
  rawHasAppbarMode(),
);

// Mirror the UI store onto <html>/<body> data-attrs. Theme-engine model:
// - `html[data-skin]` = the SKIN id (the `@scope ([data-skin=…])` identity for theme CSS isolation, §14.6).
// - `body[data-theme]` keeps its FROZEN vapor meaning — the accent axis (dark/aqua/ember) — and is set
//   ONLY when skin=vapor (from `accent`), and actively CLEARED for non-vapor skins (attrs are rebuilt
//   each call, so a stale `aqua` would otherwise leak and re-tint a non-vapor theme).
// - Non-vapor skins additionally get `body[data-mode]`/`body[data-accent]` (their palettes scope by attr).
// - motion/tab keep their current (global) meaning. The vapor-specific `data-skyline`/`data-loz` attrs
//   are now THEME-OWNED — VaporRoot writes them from its `themeSettings` (M3 §14.3), like `.no-composer`.
//
// Slice 4: runs SYNCHRONOUSLY inside setUI() so the DOM reflects the new state in the same tick a
// control toggles — App.tsx doesn't subscribe to theme (only `tab`, for conditional render).
function applyBodyAttrs(s: UIState): void {
  const b = document.body;
  // `data-skin` (the @scope identity, §14.6) lives on <html> so a theme's `:root`/`html,body`/
  // page-background rules all sit inside its scope. The accent axis + the other global attrs stay on <body>.
  document.documentElement.dataset.skin = s.theme;
  if (s.theme === "vapor") {
    b.dataset.theme = s.accent; // dark/aqua/ember — "dark" is inert (no [data-theme=dark] rule → :root)
    delete b.dataset.mode;
    delete b.dataset.accent;
  } else {
    delete b.dataset.theme; // clear vapor's stale accent so it can't leak onto a non-vapor skin
    b.dataset.mode = s.mode;
    b.dataset.accent = s.accent;
  }
  b.dataset.tab = s.tab;
  b.dataset.motion = s.motion;
  b.dataset.perf = s.perf;
}

// One-time apply at module load so first paint has the correct attrs (no flash of un-themed
// content). Module scripts run after the body is parsed (Vite injects them at end-of-body),
// so document.body is guaranteed to exist here.
applyBodyAttrs(state);

export function setUI(patch: Partial<UIState>): void {
  state = { ...state, ...patch };
  applyBodyAttrs(state); // synchronous, in the same tick the control toggled (before the React re-render)
  savePersisted(KEY, state);
  emit();
}

/** Set one per-theme setting override (M3 §14.3). Immutably patches `themeSettings[themeId][key]` so the
 *  selector subscription on that theme's slice fires. The Appearance picker calls this, then writes the
 *  full appearance doc through `useSaveAppearance` (cross-device sync, like the theme/mode/accent picks). */
export function setThemeSetting(themeId: string, key: string, value: ThemeSettingValue): void {
  const forTheme = { ...state.themeSettings[themeId], [key]: value };
  setUI({ themeSettings: { ...state.themeSettings, [themeId]: forTheme } });
}

/** Non-reactive snapshot of the current UI state, for plain (non-hook) call sites — e.g. the
 *  `switchTheme` View-Transition path reads `motion` to gate the animation. */
export function getUI(): UIState {
  return state;
}

/**
 * Subscribe to one slice of the UI store (Slice 7 / F4 in docs/UI_AUDIT.md). The component
 * re-renders only when the selected value changes (`Object.is` equality), so toggling an
 * unrelated UI field — e.g. TTS auto, or a theme change — doesn't wake up consumers that
 * only read `tab` or `heroOn`.
 *
 * ⚠️  Contract for selectors:
 *   - **Return a primitive or a stable reference.** A selector that builds a fresh
 *     object/array on every call (`s => ({ a: s.a, b: s.b })`) creates a new reference
 *     each tick and will trigger an infinite re-render loop. For multi-field reads, call
 *     `useUISlice` once per field — each subscription is independent and only fires when
 *     *its* slice changes.
 *   - **Keep selectors cheap.** They run on every store notification, so this is just for
 *     field reads or primitive comparisons. Expensive derivations belong in the consuming
 *     component behind `useMemo`.
 *   - The selector's *function identity* doesn't need to be stable. React reads the
 *     snapshot fresh each time without memoizing on the selector itself, so inline
 *     arrow-function selectors are the expected idiom (`useUISlice((s) => s.tab)`).
 *
 * If you ever need a composite/object selector with custom equality, add a sibling
 * `useUISliceWith(selector, equalityFn)` modelled on Zustand's `useStoreWithEqualityFn`.
 * Out of scope today (no consumer needs it).
 */
export function useUISlice<T>(selector: (s: UIState) => T): T {
  return useStore(() => selector(state));
}

/**
 * @deprecated Prefer `useUISlice((s) => s.field)` for any new code — `useUI()` returns the
 * whole state object and triggers a re-render on *every* UI change, even fields the
 * caller doesn't read (F4). Kept as an escape hatch for a future debug/console panel that
 * legitimately wants to inspect or stream the whole state.
 */
export function useUI(): UIState {
  return useStore(() => state);
}

/**
 * Returns whether `tab` is the currently active one. Used by tab-scoped server queries
 * (`useScopedQuery`) to pause polling/work when the user isn't looking. A thin wrapper
 * over `useUISlice` — kept as a named primitive because it appears in many hook files
 * and the call-site reads more clearly than the equivalent inline selector.
 */
export function useTabActive(tab: Tab): boolean {
  return useUISlice((s) => s.tab === tab);
}
