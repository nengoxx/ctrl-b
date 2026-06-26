// Pure tab-set data (Phase 11 / D28 §13.6). NO component imports — this module is read by `store/ui`
// (composer-visibility on first paint) as well as App + the BASE TabBar, so it must stay free of any
// import that would pull components back into `store/ui` (which would be a runtime cycle). `types.ts`
// imports only the `Tab` TYPE from store/ui (erased at runtime), so this chain has no runtime cycle.
//
// v1: every theme returns the standard 4 tabs (D28 #4). The registry is genuinely flexible — a future
// theme can register a different `TabDef[]` here without touching any other theme or the frozen vapor.

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
