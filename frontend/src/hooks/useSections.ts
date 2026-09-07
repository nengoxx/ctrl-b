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
import { runNavTransition } from "../lib/viewTransition";
import {
  composeLayout,
  HOSTED_GROUP_IDS,
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
  /** The resolved SATELLITE composition as a stable semantic string ("agents:conf") — D70 §8.4a. Effects
   *  that must re-run when the page reshapes under an UNCHANGED preset id (DefaultRoot's scroll-cache
   *  clear, its hosted-coercion effect) key on this rather than on a per-render object identity. */
  placementKey: string;
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
  // A stable reference (the store only replaces it on a real placement change), so the selector contract
  // holds — the same posture `themeSettings` takes.
  const placement = useUISlice((s) => s.sectionPlacement);

  const sections = tabsFor(theme);
  const layout = resolveLayout(theme, lever);
  // The SATELLITE composition (D70 §8.4a) — the per-section placement levers applied to the resolved preset
  // BEFORE the partition, in a pure function that is this hook's only policy call. A `conf`-placed satellite
  // becomes a hosting-map entry, a `tab`-placed one is spliced onto the bar, `button` adds nothing — so the
  // three buckets the partition already has are the whole vocabulary, and the buckets stay disjoint by
  // construction (the owner's never-in-two-places constraint).
  const { preset, key: placementKey } = composeLayout(LAYOUT_PRESETS[layout], placement);
  // `appbarMode: "minimal"` == the all-off-bar endpoint (the "1-tab mode IS minimal" unification) — the
  // partition treats the effective bar as [] so every unhosted section falls to the menu. A `tab`-placed
  // satellite degrades through that same path, with no special case.
  const { bar, menu, hosted } = partitionSections(sections, preset, appbarMode === "minimal");

  const navigate = (id: TabId): void => {
    const host = hosted[id];
    if (host) {
      // Hosting supersedes the menu: land on the host section, then arm the scroll-to-group handoff so the
      // host body (ConfTab) expands + scrolls to the hosted group once it's mounted. The hosted-id →
      // group-id map this comment reserved is real since D70 §8.4a: the curated `utils` pair plus every
      // satellite placed in `conf`.
      setUI({ tab: host });
      const group = HOSTED_GROUP_IDS[id];
      if (group) setGroupScrollTarget(group);
    } else {
      // Any ordinary navigation DISARMS a stale handoff: if the user tapped away while the host's lazy
      // chunk was still loading, the armed target was never consumed — left alone it would (a) keep the
      // scroll-reset skipped and (b) surprise-scroll the NEXT Conf visit to the Tools group.
      clearGroupScrollTarget();
      // …and a SAME-TAB tap stops here (G6.3). `setUI({ tab })` on the tab we are already on is a no-op for
      // every theme — the ui store is a value-subscriber — but `runNavTransition` is NOT: under gacha it
      // starts a real root View Transition, so re-tapping the active tab replayed the whole cross-fade over
      // a screen that never changed (owner device round). The guard lives HERE rather than in the decorator
      // because "did anything change?" is the chokepoint's question, not the transition's. Deliberately NOT
      // in the hosted branch above: re-tapping a hosted section RE-SCROLLS its host to the group, which is
      // the feature, and that branch has already re-armed the handoff by this point.
      if (id === active) return;
      // `runNavTransition` is the navigation-transition decorator (D52 / GACHA_PLAN §10.1 M2): a plain
      // `setUI({ tab: id })` for every theme but gacha, which wraps it in a root View Transition so its
      // tab reel sweeps over a cross-fade rather than over a hard swap. The gate lives in the decorator,
      // not here — this chokepoint stays theme-agnostic.
      // Deliberately NOT applied to the hosted branch above: that one is also driven by DefaultRoot's
      // coercion EFFECT, and `flushSync` inside an effect is a React warning.
      runNavTransition(() => setUI({ tab: id }));
    }
  };

  return {
    sections,
    bar,
    menu,
    hosted,
    layout,
    placementKey,
    active,
    navigate,
    hasComposer: sectionHasComposer(theme, active),
  };
}
