// Active-theme resolution (Phase 11 v2 / D29 §14.1). The theme owns its whole presentation, so the
// engine resolves ONE thing: the active theme's `Root` component. App renders it. (This replaces T0's
// 7-slot resolution — the slot idea now lives inside the Kit's DefaultRoot as an impl detail, §14.9.)

import type { ComponentType } from "react";

import { registry } from "./registry";
import type { ThemeId } from "./types";

// Fallback when the persisted theme id isn't registered (e.g. a theme removed between builds): render
// the default (vapor). vapor is always registered, so this never returns undefined in practice.
const DEFAULT_THEME: ThemeId = "vapor";

export function rootFor(theme: ThemeId): ComponentType {
  return (registry[theme] ?? registry[DEFAULT_THEME])!.Root;
}
