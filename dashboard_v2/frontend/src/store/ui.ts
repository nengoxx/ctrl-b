// Tiny UI store (DESIGN.md §13: "UI-only state"). Dependency-free external store via
// useSyncExternalStore, persisted to localStorage and mirrored to document.body data-attrs
// (the Vapor CSS keys off body[data-theme|data-skyline|data-loz|data-tab] + body.no-composer).
//
// Theme value "dark" = the default vapor palette (vapor.css :root); "aqua"/"ember" are the
// [data-theme] overrides — matching vapor.html's seg buttons exactly.

import { useSyncExternalStore } from "react";

export type Theme = "dark" | "aqua" | "ember";
export type Tab = "fleet" | "agent" | "utils" | "conf";
export type Skyline = "city" | "mountains";
export type Loz = "logo" | "ring";

export interface UIState {
  theme: Theme;
  tab: Tab;
  skyline: Skyline;
  loz: Loz;
  ttsAuto: boolean;
  heroOn: boolean; // animated sun/grid/skyline scene
  waveformOn: boolean; // live ping waveform on the hero
}

const DEFAULTS: UIState = {
  theme: "dark",
  tab: "fleet",
  skyline: "city",
  loz: "logo",
  ttsAuto: true,
  heroOn: true,
  waveformOn: true,
};

const KEY = "ctrlb.ui";

function load(): UIState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let state: UIState = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

// Mirror the UI store onto <body> data-attrs + the .no-composer class. Vapor's CSS keys off
// body[data-theme|data-tab|data-skyline|data-loz] for theme/skyline/lozenge variants, and
// .no-composer for the layout shift when the composer is hidden (Utils/Conf tabs).
//
// Slice 4: this runs SYNCHRONOUSLY inside setUI() so the DOM reflects the new state in the
// same tick a control is toggled — instead of waiting for App.tsx to commit a re-render and
// then run a useEffect. Net effect: theme/tab switches paint a frame or two earlier, and
// App.tsx no longer needs to subscribe to theme/skyline/loz at all (it still reads `tab` for
// conditional rendering, but the body-attr concern lives entirely in the store).
function applyBodyAttrs(s: UIState): void {
  const b = document.body;
  b.dataset.theme = s.theme;
  b.dataset.tab = s.tab;
  b.dataset.skyline = s.skyline;
  b.dataset.loz = s.loz;
  const showComposer = s.tab === "fleet" || s.tab === "agent";
  b.classList.toggle("no-composer", !showComposer);
}

// One-time apply at module load so first paint has the correct attrs (no flash of un-themed
// content). Module scripts run after the body is parsed (Vite injects them at end-of-body),
// so document.body is guaranteed to exist here.
applyBodyAttrs(state);

export function setUI(patch: Partial<UIState>): void {
  state = { ...state, ...patch };
  applyBodyAttrs(state);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota — non-fatal, state still lives in memory */
  }
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): UIState {
  return state;
}

export function useUI(): UIState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Returns whether `tab` is the currently active one. Used by tab-scoped server queries
 * (`useScopedQuery`) to pause polling/work when the user isn't looking. Returns a plain
 * boolean so the subscription only fires a re-render when the *boolean* changes, not on
 * every UI store change — avoids the F4 over-subscription issue ahead of the Slice 7
 * selector refactor.
 */
export function useTabActive(tab: Tab): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.tab === tab,
    () => state.tab === tab,
  );
}
