// Active-theme resolution (Phase 11 v2 / D29 §14.1). The theme owns its whole presentation, so the
// engine resolves ONE thing: the active theme's `Root` component. App renders it. (This replaces T0's
// 7-slot resolution — the slot idea now lives inside the Kit's DefaultRoot as an impl detail, §14.9.)

import type { ComponentType } from "react";

import { getUI, setUI } from "../store/ui";
import { registry } from "./registry";
import type { Mode, ThemeId } from "./types";

// The default theme (cosmos since D51/V0 — vapor held this through v1.4) — the fresh-boot skin AND the
// fallback when a persisted/served theme id isn't registered (e.g. a theme removed between builds).
// Exported as the single shared constant: every "reset/coerce to the default skin" path (this module,
// item ②'s boundary Reset, ⑥'s boot coercion) reads it from here rather than hardcoding an id.
//
// D51 AMENDED the standing "no theme literal outside this module" guarantee to a **documented-mirror
// allowlist** — the three spots that CANNOT import this constant, each carrying a comment naming D51:
//   • `index.html`'s FOUC script (pre-JS: the static `html[data-skin]` stamp, the bootstrap default, and
//     the corrupt-storage fallback) — it runs before any module loads;
//   • `store/ui.ts` DEFAULTS (the first-boot triple) — the store can't import the registry/this module's
//     graph (the module-eval cycle documented on `coerceBootTheme` below);
//   • backend `AppearanceCfg` (another process) — pinned to THIS declaration by
//     `backend/tests/test_arch_invariants_sys10.py`, so the two can only move together.
// cosmos is always registered, so `rootFor` never returns undefined in practice.
export const DEFAULT_THEME: ThemeId = "cosmos";

export function rootFor(theme: ThemeId): ComponentType {
  return (registry[theme] ?? registry[DEFAULT_THEME])!.Root;
}

// The default skin-triple mode/accent for a theme, derived from its declared `palettes` (§9.8). A skin
// change adopts these when it doesn't carry an explicit mode/accent — the target the picker sends and the
// value the boot coercion falls back to. Single source of truth: `ConfTab.pickTheme` and `coerceBootTheme`
// both consume this instead of re-deriving the `?? "dark"` fallbacks. Missing axes default to
// dark/"dark" (vapor's shape: dark-only, `defaultAccent:"dark"`, no declared `defaultMode`).
export function defaultSwitchTarget(id: ThemeId): { mode: Mode; accent: string } {
  const def = registry[id];
  return {
    mode: def?.palettes.defaultMode ?? "dark",
    accent: def?.palettes.defaultAccent ?? "dark",
  };
}

// Every-boot validity check for the persisted active skin (item ⑥ / §14.15.1 + §14.15.1-A ⑥+). This is
// parse-don't-validate at the app boundary (zod-`.catch` semantics), NOT a migration: registry membership
// is ORTHOGONAL to the persisted-schema `v` (a theme can be deregistered between builds with zero shape
// change), so it runs on EVERY boot, ungated by `v`, after the store's versioned migration chain.
//
// If the persisted `theme` isn't in the registry (a skin this build can't render), heal to DEFAULT_THEME.
// The skin-triple {theme,mode,accent} is atomic per skin, so mode/accent adopt the default theme's defaults
// rather than keeping the removed theme's persisted accent (which may be meaningless for the default skin).
// `setUI`'s persist self-heals localStorage for the next boot. It NEVER touches the server (no PUT) — the
// §14.15.2 invariant: the appearance doc is written only by explicit user action.
//
// Placement note: this lives HERE (the engine boundary) and not in store/ui.ts because the store can't
// import the registry — `registry.ts` statically pulls `themes/vapor` → VaporRoot → components/stores, so
// a store→registry edge would be a module-eval import cycle (store/ui runs at module scope). resolve.ts
// already depends on the registry, so the coercion sits at the layer that legitimately knows it. main.tsx
// calls this once before the first React paint, so the only possible wrong-skin frame is the pre-JS FOUC
// window (index.html applies the raw id with no allowlist — the accepted next-themes-standard self-heal).
export function coerceBootTheme(): void {
  const { theme } = getUI();
  if (registry[theme] == null) {
    setUI({ theme: DEFAULT_THEME, ...defaultSwitchTarget(DEFAULT_THEME) });
  }
}
