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
//
// The ONE cross-package import below is `themes/gacha/copy.ts` — a dependency-FREE string module (the
// theme's frozen JP copy, which also derives its committed font subset). It pulls in no component and no
// store, so the no-cycle invariant above is intact; the alternative (re-typing gacha's four sub-labels here)
// would be a second source of truth the font-subset guard could not see.

import { GACHA_COPY } from "../themes/gacha/copy";
import type { TabDef, TabId, ThemeId } from "./types";

// The standard 4-tab set, matching the frozen vapor TabBar (TabBar.tsx), plus the `hasComposer`
// flag distilled from today's `showComposer = tab==="fleet"||"agent"` hardcode (App.tsx / ui.ts).
// The fleet↔utils glyphs are SWAPPED vs the vapor prototype (owner directive 2026-07-12, "for all
// themes" — explicitly including vapor): the hex ⌬ marks the fleet, the diamond ◆ the tools.
export const STANDARD_TABS: TabDef[] = [
  { id: "fleet", glyph: "⌬", lbl: "fleet", hasComposer: true },
  { id: "agent", glyph: "▲", lbl: "chat", hasComposer: true },
  { id: "utils", glyph: "◆", lbl: "tools", hasComposer: false },
  // `lazy`: Conf is the one code-split section (its editor chunk). DefaultRoot mounts it after first
  // activation, then keeps it mounted (drafts survive) — the generalized latch (was a bespoke Conf-only flag).
  { id: "conf", glyph: "●", lbl: "conf", hasComposer: false, lazy: true },
];

// Per-theme tab sets. T0 = vapor only; unregistered themes fall back to the standard set.
const TAB_SETS: Partial<Record<ThemeId, TabDef[]>> = {
  vapor: STANDARD_TABS,
  // frontier (F1) — themed copy only: `TabDef.lbl` is per-theme DATA; glyphs (the swapped standard set,
  // see above)/`hasComposer`/`lazy` are identical to the standard set.
  frontier: [
    { id: "fleet", glyph: "⌬", lbl: "frontier", hasComposer: true },
    { id: "agent", glyph: "▲", lbl: "comms", hasComposer: true },
    { id: "utils", glyph: "◆", lbl: "tools", hasComposer: false },
    { id: "conf", glyph: "●", lbl: "settings", hasComposer: false, lazy: true },
  ],
  // gacha (D52 / Q8.6b) — themed labels PLUS the ruled Japanese `subLabel` line (the kit seam landed with
  // G0's seams unit). All four are real words, kanji-first: 編成 hensei "formation" · 案内 annai "guidance" ·
  // ツール tsūru, the standard katakana loanword for "tools" · 設定 settei "settings". Utils carries one even
  // though gacha defaults to 3-tab (utils hosted in Conf) — the layout fence says every theme must genuinely
  // honor EVERY preset, so the 4-tab bar has to be a complete look, not a fallback. Strings come from the
  // theme's frozen-copy module so the committed font subset and this row can never disagree.
  gacha: [
    { id: "fleet", glyph: "⌬", lbl: "fleet", subLabel: GACHA_COPY.tabFleet, hasComposer: true },
    { id: "agent", glyph: "▲", lbl: "agent", subLabel: GACHA_COPY.tabAgent, hasComposer: true },
    { id: "utils", glyph: "◆", lbl: "tools", subLabel: GACHA_COPY.tabUtils, hasComposer: false },
    {
      id: "conf",
      glyph: "●",
      lbl: "settings",
      subLabel: GACHA_COPY.tabConf,
      hasComposer: false,
      lazy: true,
    },
  ],
};

export function tabsFor(theme: ThemeId): TabDef[] {
  return TAB_SETS[theme] ?? STANDARD_TABS;
}

// Whether the composer shows for (active theme, tab) — the flexible-tab-registry replacement for the
// two `showComposer` hardcodes (§13.6). Unknown tab → false (no composer).
export function hasComposer(theme: ThemeId, tab: TabId): boolean {
  return tabsFor(theme).find((t) => t.id === tab)?.hasComposer ?? false;
}
