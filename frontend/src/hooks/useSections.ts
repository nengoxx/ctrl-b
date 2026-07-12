// Sections controller (D29 §14.2 / D35 §F0) — headless: the app's functional navigation (the active
// section, the section list, HOW those sections are laid out, and how to switch), generalizing `ui.tab`.
// "Sections" not "tabs" because a theme renders them however it likes — vapor draws a bottom tab bar,
// another theme could use a drawer, a rail, or nothing. This owns the CAPABILITY (what areas exist · which
// is active · how they partition under the active layout · navigate), never the presentation.
//
// The section list is the active theme's `tabsFor()` (the theme-engine tab registry); the active section
// lives in the `ui` store (so it survives a theme switch). The layout LEVER (`ui.layout`, device-local) +
// the theme's declared capability set resolve to a preset (`layout.ts`), which partitions the sections into
// `bar` (on-bar), `menu` (off-bar-and-unhosted, the menu affordance), and `hosted` (rendered inside a host
// section). Nav/tab-bar/menu components consume the partitions; DefaultRoot consumes `sections` + `hosted`
// to mount bodies. `hasComposer` is the ACTIVE section's composer flag (per-section, automatically correct
// per preset). `navigate` is the single nav chokepoint every consumer shares — so the hosted-section
// coercion (→ host + scroll-to-group) lives here, once.

import { setUI, useUISlice } from "../store/ui";
import { clearGroupScrollTarget, setGroupScrollTarget } from "../store/groupScroll";
import {
  HOSTED_UTILS_GROUP_ID,
  partitionSections,
  resolveLayout,
  LAYOUT_PRESETS,
} from "../theme-engine/layout";
import { hasComposer as sectionHasComposer, tabsFor } from "../theme-engine/tabs";
import type { LayoutId, TabDef, TabId } from "../theme-engine/types";

export interface SectionsController {
  /** The active theme's FULL section list (stable per theme — `tabsFor` returns a shared array). Consumers
   *  that mount bodies (DefaultRoot) iterate this; nav components consume the partitions below. */
  sections: TabDef[];
  /** The on-bar sections under the resolved layout (bar order). */
  bar: TabDef[];
  /** The off-bar-AND-unhosted sections — the NavMenu affordance lists exactly these (def order). */
  menu: TabDef[];
  /** The hosting map: a section id → the host section it renders inside (utils→conf today). */
  hosted: Partial<Record<TabId, TabId>>;
  /** The resolved layout id (the Conf Layout picker + DefaultRoot need the concrete preset). */
  layout: LayoutId;
  /** The current section id. */
  active: TabId;
  /** Switch to a section. A hosted section coerces to its host + arms the scroll-to-group handoff. */
  navigate: (id: TabId) => void;
  /** Whether the active section shows the composer (the theme gates its composer + padding on this). */
  hasComposer: boolean;
}

export function useSections(): SectionsController {
  const theme = useUISlice((s) => s.theme);
  const active = useUISlice((s) => s.tab);
  const lever = useUISlice((s) => s.layout);
  const appbarMode = useUISlice((s) => s.appbarMode);

  const sections = tabsFor(theme);
  const layout = resolveLayout(theme, lever);
  // `appbarMode: "minimal"` == the all-off-bar endpoint (the "1-tab mode IS minimal" unification) — the
  // partition treats the effective bar as [] so every unhosted section falls to the menu.
  const { bar, menu, hosted } = partitionSections(
    sections,
    LAYOUT_PRESETS[layout],
    appbarMode === "minimal",
  );

  const navigate = (id: TabId): void => {
    const host = hosted[id];
    if (host) {
      // Hosting supersedes the menu: land on the host section, then arm the scroll-to-group handoff so the
      // host body (ConfTab) expands + scrolls to the hosted group once it's mounted. One curated pair today
      // (utils→conf) → one group id; a second hosting pair would map its own hosted-id → group-id here.
      setUI({ tab: host });
      setGroupScrollTarget(HOSTED_UTILS_GROUP_ID);
    } else {
      // Any ordinary navigation DISARMS a stale handoff: if the user tapped away while the host's lazy
      // chunk was still loading, the armed target was never consumed — left alone it would (a) keep the
      // scroll-reset skipped and (b) surprise-scroll the NEXT Conf visit to the Tools group.
      clearGroupScrollTarget();
      setUI({ tab: id });
    }
  };

  return {
    sections,
    bar,
    menu,
    hosted,
    layout,
    active,
    navigate,
    hasComposer: sectionHasComposer(theme, active),
  };
}
