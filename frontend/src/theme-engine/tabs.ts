// Pure tab-set data (Phase 11 / D28 §13.6). NO component imports — this module is read by the
// `useSections` controller and the TabBar (active section list + composer-visibility), so it must stay
// free of any import that would pull components in (which would risk a runtime cycle via `store/ui`).
// `types.ts` imports only the `Tab` TYPE from store/ui (erased at runtime), so this chain has no cycle.
//
// v1: every theme returns the standard 4 tabs (D28 #4). Scope of the flexibility (right-sized in the
// 2026-07-06 final review, D34): this registry drives the section NAV + composer-visibility flexibly
// (useSections/NavMenu/KitNavBar are pure consumers), but the tab BODIES are fixed — DefaultRoot hardwires
// Fleet/Agent/Utils/Conf with literal `tab === "…"` gates. Reordering the same 4 tabs works today;
// adding/removing/renaming a section additionally needs an id→body registry in DefaultRoot — a future seam,
// deliberately NOT built until a theme actually needs a different section (D31: no speculative registry).

import type { TabDef, TabId, ThemeId } from "./types";

// The standard 4-tab set, matching the frozen vapor TabBar (TabBar.tsx) exactly, plus the `hasComposer`
// flag distilled from today's `showComposer = tab==="fleet"||"agent"` hardcode (App.tsx / ui.ts).
export const STANDARD_TABS: TabDef[] = [
  { id: "fleet", glyph: "◆", lbl: "fleet", hasComposer: true },
  { id: "agent", glyph: "▲", lbl: "chat", hasComposer: true },
  { id: "utils", glyph: "⌬", lbl: "tools", hasComposer: false },
  { id: "conf", glyph: "●", lbl: "conf", hasComposer: false },
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
