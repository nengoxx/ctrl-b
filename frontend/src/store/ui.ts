// Tiny UI store (DESIGN.md §13: "UI-only state"). Dependency-free external store on the shared
// `createStore` binding (D23), persisted via `persist` helpers and mirrored to <html>/<body> data-attrs.
// (Composer visibility is no longer a core concern — the `useSections` controller exposes `hasComposer`
// from the theme's tab set, and each theme owns its composer + any `.no-composer`-style padding hook.)
//
// Theme-engine generalization (Phase 11 / D28 §9.8): the single conflated `theme` field splits into
// **{theme, mode, accent}** — `theme` is the SKIN id ("vapor"|"minimal"|…, the slot+CSS identity),
// `mode` the light/dark axis, `accent` the named-palette/hue id. `applyBodyAttrs` writes the
// `html[data-skin]` identity (§13.1) plus `body[data-mode]`/`body[data-accent]` for EVERY skin —
// since D51 V2 vapor has no private axis: its accents (dark/aqua/ember) ride the same `data-accent`
// attribute as every other theme's (the legacy `body[data-theme]` axis is RETIRED, only cleared).

import type { LayoutId, Mode, ThemeId, ThemeSettingValue } from "../theme-engine/types";
import { createStore } from "./createStore";
import { loadPersistedVersioned, savePersisted } from "./persist";

export type { Mode, ThemeId } from "../theme-engine/types";
export type Tab = "fleet" | "agent" | "utils" | "conf";
export type Motion = "full" | "reduced";
export type Perf = "full" | "lite";
/** Top-bar / navigation chrome mode (global, per-device). `visible` = appbar + bottom tab bar; `transparent`
 *  = the SAME appbar + tab bar but the bar paints NOTHING (no fill/border/shadow/backdrop-filter — it floats
 *  over the page like the prototype, with squared icon buttons); `off` = no appbar, tab bar only; `minimal` =
 *  no appbar in layout + no tab bar, navigation via the floating NavMenu. **Every registered theme honors all
 *  four** since D51 V4 put vapor on DefaultRoot too — the old "bespoke Roots (vapor) treat minimal as off"
 *  carve-out is GONE (vapor gets the floating NavMenu + NavHome for free). The bespoke-Root minimal contract
 *  (THEME_ENGINE §14.13) still governs any FUTURE Root that hand-rolls its own chrome. */
export type AppbarMode = "visible" | "transparent" | "off" | "minimal";

/** Whether a top app bar is PRESENT (rendered + measured into `--appbar-h`) for a given mode. True for
 *  `visible` and `transparent` (both render the bar — transparent just null-paints it); false for `off` and
 *  `minimal` (no bar). The single source for the "is a bar present" test — consumers (Roots, the floating
 *  NavMenu gate) call this instead of scattering `=== "visible"` triples that would miss `transparent`. */
export function appbarShown(m: AppbarMode): boolean {
  return m === "visible" || m === "transparent";
}

// Open per-theme settings (D29 §14.3): `{ themeId: { key: value } }`. Open so a theme adds an option
// additively (no new top-level field). Values resolve via `useThemeSetting(id, key)`, which falls back
// to the theme's declared `ThemeDef.settings[key].default` when there's no override here.
export type ThemeSettingsMap = Record<string, Record<string, ThemeSettingValue>>;

export interface UIState {
  theme: ThemeId; // the active SKIN (cosmos on a fresh boot, D51 V0) — drives slot resolution + data-skin
  mode: Mode; // light/dark axis → body[data-mode]; vapor is dark-only (declares no `modes`, always "dark")
  accent: string; // named palette OR hue id → body[data-accent] (vapor: "dark"|"aqua"|"ember", D51 V2)
  tab: Tab;
  ttsAuto: boolean;
  // ambient animations (LED pulse, equalizer, sun bob, grid scroll, …). SYNCED via the appearance
  // channel (owner directive 2026-06-26: consistent across devices) — see useAppearance.
  motion: Motion;
  // backdrop-blur on the frosted bars: "full" (the glass look) vs "lite" (blur off → opaque bars). A
  // per-device speed lever (`backdrop-filter: blur()` is ~10× slower on Firefox-Android than Chrome),
  // but SYNCED with the rest of appearance (owner directive: consistent across devices).
  perf: Perf;
  // The SHARED owner background layer (`media/kit/background/`) — whether a participating theme paints
  // it at all. SYNCED with the rest of appearance rather than device-local, because the asset it governs
  // is one shared image: the owner's answer to "do I want my picture behind the app" should not depend on
  // which phone they are holding. Default ON, so dropping a file in is the whole action; themes with
  // scenery of their own never mount the layer and are unaffected either way (the Kit Art System / A4).
  kitBackgroundVisible: boolean;
  // The app bar's BRAND SUBTITLE — whether the bar renders the active theme's own subtitle line beside the
  // wordmark (gacha's Japanese line, frontier's live rig count). SYNCED with the rest of appearance, not
  // per-device: it is one answer to "how much text do I want in my bar", not a per-screen layout choice
  // (unlike `appbarMode` below, which really is one). Default OFF — G6.3's ruling (icon + title only) is
  // the resting state and this switch is how the subtitle comes back. A theme that fills no subtitle shows
  // nothing in either state: there is no default text (the kit's old "dashboard" literal is dead).
  appbarSubtitleVisible: boolean;
  // The INSTALLED home-screen icon's baked-in backdrop (D59 / W5) — one id from the backend's
  // `PWA_ICON_VARIANTS` (`app/core/pwa.py`), which is what `/manifest.webmanifest` turns into the maskable
  // icon's `src`. Nothing in the running app reads it: the value's only consumer is the manifest the
  // browser fetches, so this store slot exists to hold the Conf row's state and ride the appearance sync.
  // SYNCED for that reason too — it describes the ONE app icon, not a per-screen preference. `null` = never
  // picked → the backend serves its own default (today's transparent icon).
  pwaIconBackground: string | null;
  // Theme-namespaced options (skyline/loz/hero/waveform for vapor; "density" for minimal, …). The
  // theme owns the schema (`ThemeDef.settings`); this is the override store. SYNCED via appearance.
  themeSettings: ThemeSettingsMap;
  // The top-bar / nav chrome mode — a GLOBAL, cross-theme display lever, per-DEVICE (persisted locally, NOT
  // synced — a layout choice that can differ per screen). `visible`/`off`/`minimal` (see AppbarMode): every
  // theme's Root honors it (DefaultRoot via the `appbarMode` prop; vapor maps it to its own AppBar render).
  // Migrated from the old boolean `hideAppbar` (and an earlier per-theme `minimal` setting) by
  // `migrateAppbarMode`.
  appbarMode: AppbarMode;
  // The section-layout lever (D35 §F0) — a GLOBAL, cross-theme display lever, per-DEVICE (persisted locally,
  // NOT synced — the appearance doc is untouched; a synced promotion is a possible later additive step),
  // exactly like `appbarMode`. `auto` = the active theme's declared default (`ThemeDef.defaultLayout`); an
  // explicit `LayoutId` is coerced to the theme's nearest supported preset by `layout.ts#resolveLayout`.
  layout: "auto" | LayoutId;
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
  // The FIRST-BOOT skin triple — a DOCUMENTED MIRROR (D51 allowlist, see `resolve.ts` DEFAULT_THEME) of
  // `DEFAULT_THEME` + that theme's declared ThemeDef defaults (cosmos: `palettes.defaultMode:"dark"` /
  // `defaultAccent:"violet"`, themes/cosmos/index.tsx). Deriving it from the registry is impossible here:
  // `registry.ts` → `themes/vapor` → components → back to this store would be a module-eval import cycle
  // (this file runs at module scope), which is the same reason `coerceBootTheme` lives in resolve.ts.
  theme: "cosmos",
  mode: "dark",
  accent: "violet",
  tab: "fleet",
  ttsAuto: true,
  motion: defaultMotion(),
  perf: "full", // default to the full glass look; the owner opts into "lite" on a slow device
  kitBackgroundVisible: true, // a dropped background shows without a second step (it is off until one exists)
  appbarSubtitleVisible: false, // G6.3's icon + title only stands as the default; the switch opts back in
  pwaIconBackground: null, // unpicked → the backend's DEFAULT_PWA_ICON_BG (the unchanged transparent icon)
  themeSettings: {}, // per-theme overrides resolve against each ThemeDef.settings default
  appbarMode: "visible", // global per-device chrome lever; every theme's Root honors it
  layout: "auto", // global per-device section-layout lever (NOT synced); auto = the active theme's default
};

const KEY = "ctrlb.ui";

// Persisted-schema version for `ctrlb.ui` (§13.4 / §14.15.1 rider a). The three legacy remaps below
// (migrateLegacyTheme → migrateVaporSettings → migrateAppbarMode) collectively ARE the v0→1 upgrade step.
// A missing `v` on a persisted blob means v0 (legacy). Every save stamps `v: UI_PERSIST_V` (see setUI), so
// once a device has written under this build the chain never re-runs (the loader gates on `from >= version`).
// Adding a future migration = bump this to 2, append a `from < 2` step to the migrate callback, keep order.
const UI_PERSIST_V = 1;

// vapor's former top-level decorative toggles, now its `ThemeDef.settings` (M3 / §14.3). Listed here
// only so the one-time migration can fold a pre-M3 persisted shape into `themeSettings.vapor`.
const LEGACY_VAPOR_SETTINGS = ["skyline", "loz", "heroOn", "waveformOn"] as const;

// One-time persisted-shape remap (§13.4). The pre-Phase-11 shape stored the conflated
// `theme ∈ {dark,aqua,ember}` (the vapor accent). The loader's field-fill merge can't VALUE-remap,
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
// top-level fields. The loader keeps them as extras (its merge is `{...defaults, ...parsed}`), so
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

// Load + migrate the persisted UI blob (§14.15.1 rider a). The versioned loader does one read + one parse,
// merges over DEFAULTS, and — because the blob's `v` is < UI_PERSIST_V (or absent) — hands us the v0→1 chain.
// `raw` is the pre-merge blob, needed for the appbar seed's KEY-PRESENCE inference: every real device today
// carries `appbarMode` but no `v`, so a naive "unversioned ⇒ run all" would re-seed and CLOBBER the user's
// explicit choice from a stale synced `hideAppbar`. Instead migrateAppbarMode only seeds when the blob lacked
// an `appbarMode` key (`hasAppbarMode = false`) — the accepted idempotency escape hatch for this one
// non-idempotent step over mixed-stage unversioned data. Exported so the load path is unit-testable without a
// module re-import dance (mirrors the "exported for tests" idiom on the migrate helpers above).
export function loadUIState(): UIState {
  return loadPersistedVersioned(KEY, DEFAULTS, UI_PERSIST_V, (merged, raw) => {
    const hasAppbarMode = typeof raw === "object" && raw != null && "appbarMode" in raw;
    return migrateAppbarMode(migrateVaporSettings(migrateLegacyTheme(merged)), hasAppbarMode);
  });
}
let state: UIState = loadUIState();

// Mirror the UI store onto <html>/<body> data-attrs. Theme-engine model:
// - `html[data-skin]` = the SKIN id (the `@scope ([data-skin=…])` identity for theme CSS isolation, §14.6).
// - `body[data-mode]`/`body[data-accent]` = the SHARED palette axes, written for EVERY skin (each theme's
//   sheet scopes its palettes by attribute under its own `data-skin`, so the values never collide).
// - `body[data-theme]` is the RETIRED vapor-private accent axis (D51 V2 moved vapor onto `data-accent`).
//   Nothing writes it any more; it is DELETED on every apply as DEFENSIVE cleanup against any stale or
//   manually-set stamp (the SW update path can't actually produce one — Workbox installs the old/new build
//   atomically and reloads on activation — but attrs are rebuilt each call, so the delete costs nothing and
//   is the same idiom the cross-skin cleanup always used; asserted by the themeContract switch-chain test).
// - motion/tab keep their current (global) meaning. The vapor-specific `data-skyline`/`data-loz` attrs
//   are now THEME-OWNED — VaporRoot writes them from its `themeSettings` (M3 §14.3), like `.no-composer`.
//
// Slice 4: runs SYNCHRONOUSLY inside setUI() so the DOM reflects the new state in the same tick a
// control toggles. App.tsx subscribes to `theme` (via `useActiveRoot` + item ②'s ErrorBoundary key,
// §14.15.1) so it re-renders on a skin change; it does not subscribe to `tab`.
function applyBodyAttrs(s: UIState): void {
  const b = document.body;
  // `data-skin` (the @scope identity, §14.6) lives on <html> so a theme's `:root`/`html,body`/
  // page-background rules all sit inside its scope. The accent axis + the other global attrs stay on <body>.
  document.documentElement.dataset.skin = s.theme;
  delete b.dataset.theme; // the retired vapor axis — clear any pre-V2 residue (see the header note)
  b.dataset.mode = s.mode; // vapor is dark-only, so its value is always "dark" (and it styles nothing)
  b.dataset.accent = s.accent; // vapor: dark/aqua/ember — "dark" is inert (no rule → the :scope defaults)
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
  // Stamp the schema version on the wire (never in `state` — `v` is envelope metadata, UIState stays clean).
  // The loader reads it back as `from` and skips the v0→1 chain once it's current (§14.15.1 rider a).
  savePersisted(KEY, { ...state, v: UI_PERSIST_V });
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
