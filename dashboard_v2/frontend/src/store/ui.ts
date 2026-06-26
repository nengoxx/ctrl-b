// Tiny UI store (DESIGN.md §13: "UI-only state"). Dependency-free external store on the shared
// `createStore` binding (D23), persisted via `persist` helpers and mirrored to document.body
// data-attrs + body.no-composer.
//
// Theme-engine generalization (Phase 11 / D28 §9.8): the single conflated `theme` field splits into
// **{theme, mode, accent}** — `theme` is the SKIN id ("vapor"|"minimal"|…, the slot+CSS identity),
// `mode` the light/dark axis, `accent` the named-palette/hue id. `applyBodyAttrs` writes the NEW
// `body[data-skin]` identity (§13.1) and keeps `body[data-theme]` meaning vapor's FROZEN accent axis
// (dark/aqua/ember) — set only when skin=vapor, cleared otherwise. Non-vapor themes additionally get
// `body[data-mode]`/`body[data-accent]` (the prototypes scope palettes by attribute).

import { hasComposer } from "../theme-engine/tabs";
import type { Mode, ThemeId } from "../theme-engine/types";
import { createStore } from "./createStore";
import { loadPersisted, savePersisted } from "./persist";

export type { Mode, ThemeId } from "../theme-engine/types";
export type Tab = "fleet" | "agent" | "utils" | "conf";
export type Skyline = "city" | "mountains";
export type Loz = "logo" | "ring";
export type Motion = "full" | "reduced";

export interface UIState {
  theme: ThemeId; // the active SKIN ("vapor" in v1) — drives slot resolution + body[data-skin]
  mode: Mode; // light/dark axis — vapor is dark-only (unused for vapor); non-vapor sets body[data-mode]
  accent: string; // named palette OR hue id — vapor: "dark"|"aqua"|"ember" on body[data-theme]
  tab: Tab;
  skyline: Skyline;
  loz: Loz;
  ttsAuto: boolean;
  heroOn: boolean; // animated sun/grid/skyline scene
  waveformOn: boolean; // live ping waveform on the hero
  motion: Motion; // ambient animations (LED pulse, equalizer, sun bob, grid scroll, …)
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
  skyline: "city",
  loz: "logo",
  ttsAuto: true,
  heroOn: true,
  waveformOn: true,
  motion: defaultMotion(),
};

const KEY = "ctrlb.ui";

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

const { emit, useStore } = createStore();
let state: UIState = migrateLegacyTheme(loadPersisted(KEY, DEFAULTS));

// Mirror the UI store onto <body> data-attrs + the .no-composer class. Theme-engine model (§9.8/§13.1):
// - `body[data-skin]` = the SKIN id (NEW identity attr for slot + CSS scoping).
// - `body[data-theme]` keeps its FROZEN vapor meaning — the accent axis (dark/aqua/ember) — and is set
//   ONLY when skin=vapor (from `accent`), and actively CLEARED for non-vapor skins (attrs are rebuilt
//   each call, so a stale `aqua` would otherwise leak and re-tint a non-vapor theme).
// - Non-vapor skins additionally get `body[data-mode]`/`body[data-accent]` (their palettes scope by attr).
// - skyline/loz/motion/tab keep their current meaning (vapor's frozen attribute contract, §13.1).
//
// Slice 4: runs SYNCHRONOUSLY inside setUI() so the DOM reflects the new state in the same tick a
// control toggles — App.tsx doesn't subscribe to theme/skyline/loz (only `tab`, for conditional render).
function applyBodyAttrs(s: UIState): void {
  const b = document.body;
  b.dataset.skin = s.theme;
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
  b.dataset.skyline = s.skyline;
  b.dataset.loz = s.loz;
  b.dataset.motion = s.motion;
  const showComposer = hasComposer(s.theme, s.tab);
  b.classList.toggle("no-composer", !showComposer);
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
