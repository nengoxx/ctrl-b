// Sections controller (D29 §14.2) — headless: the app's functional navigation (the active section, the
// section list, and how to switch), generalizing `ui.tab`. "Sections" not "tabs" because a theme renders
// them however it likes — vapor draws a bottom tab bar, another theme could use a drawer, a rail, or
// nothing. This owns the CAPABILITY (what areas exist · which is active · navigate), never the presentation.
//
// The section list is the active theme's `tabsFor()` (the theme-engine tab registry); the active section
// lives in the `ui` store (so it survives a theme switch). `hasComposer` is the active section's composer
// flag — the theme reads it to decide whether to render its composer (and its own composer-padding hook),
// replacing the old `showComposer = tab==='fleet'||'agent'` hardcode + the core `.no-composer` body write.

import { setUI, useUISlice } from "../store/ui";
import { hasComposer as sectionHasComposer, tabsFor } from "../theme-engine/tabs";
import type { TabDef, TabId } from "../theme-engine/types";

export interface SectionsController {
  /** The active theme's section list (stable per theme — `tabsFor` returns a shared array). */
  sections: TabDef[];
  /** The current section id. */
  active: TabId;
  /** Switch to a section. */
  navigate: (id: TabId) => void;
  /** Whether the active section shows the composer (the theme gates its composer + padding on this). */
  hasComposer: boolean;
}

export function useSections(): SectionsController {
  const theme = useUISlice((s) => s.theme);
  const active = useUISlice((s) => s.tab);
  return {
    sections: tabsFor(theme),
    active,
    navigate: (id) => setUI({ tab: id }),
    hasComposer: sectionHasComposer(theme, active),
  };
}
