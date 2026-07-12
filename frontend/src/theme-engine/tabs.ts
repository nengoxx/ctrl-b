// Pure tab-set data (Phase 11 / D28 §13.6). NO component imports — this module is read by the
// `useSections` controller and the TabBar (active section list + composer-visibility), so it must stay
// free of any import that would pull components in (which would risk a runtime cycle via `store/ui`).
// `types.ts` imports only the `Tab` TYPE from store/ui (erased at runtime), so this chain has no cycle.
//
// v1: every theme returns the standard 4 tabs (D28 #4). Scope of the flexibility (widened by the
// SECTION LAYOUT SYSTEM v1, D35 §F0): this registry drives the section NAV + composer-visibility flexibly
// (useSections/NavMenu/KitNavBar are pure consumers). Tab BODIES now resolve in KIT space — DefaultRoot owns
// the id→body DEFAULT map + a per-theme `bodies` override prop, and mounts them data-driven (keep-mounted,
// `active`-gated), replacing the old hardwired `tab === "…"` branch. This module stays PURE DATA: a section
// carries only its id/glyph/label/`hasComposer` + the generic `lazy` flag (no component field — the
// "eager DATA, lazy COMPONENTS" ruling). Curated layout presets (`layout.ts`) recompose where these
// sections live (on-bar / menu / hosted-in-Conf) without changing this set.

import type { TabDef, TabId, ThemeId } from "./types";

// The standard 4-tab set, matching the frozen vapor TabBar (TabBar.tsx) exactly, plus the `hasComposer`
// flag distilled from today's `showComposer = tab==="fleet"||"agent"` hardcode (App.tsx / ui.ts).
export const STANDARD_TABS: TabDef[] = [
  { id: "fleet", glyph: "◆", lbl: "fleet", hasComposer: true },
  { id: "agent", glyph: "▲", lbl: "chat", hasComposer: true },
  { id: "utils", glyph: "⌬", lbl: "tools", hasComposer: false },
  // `lazy`: Conf is the one code-split section (its editor chunk). DefaultRoot mounts it after first
  // activation, then keeps it mounted (drafts survive) — the generalized latch (was a bespoke Conf-only flag).
  { id: "conf", glyph: "●", lbl: "conf", hasComposer: false, lazy: true },
];

// Per-theme tab sets. T0 = vapor only; unregistered themes fall back to the standard set.
const TAB_SETS: Partial<Record<ThemeId, TabDef[]>> = {
  vapor: STANDARD_TABS,
};

export function tabsFor(theme: ThemeId): TabDef[] {
  return TAB_SETS[theme] ?? STANDARD_TABS;
}

// Whether the composer shows for (active theme, tab) — the flexible-tab-registry replacement for the
// two `showComposer` hardcodes (§13.6). Unknown tab → false (no composer).
export function hasComposer(theme: ThemeId, tab: TabId): boolean {
  return tabsFor(theme).find((t) => t.id === tab)?.hasComposer ?? false;
}
