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

export function setUI(patch: Partial<UIState>): void {
  state = { ...state, ...patch };
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
