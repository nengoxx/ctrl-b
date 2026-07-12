import {
  type ComponentType,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { MiniPlayer } from "../../components/MiniPlayer";
import { NavHome, NavMenu } from "../../components/NavMenu";
import { PromptModal } from "../../components/PromptModal";
import { SwUpdatePrompt } from "../../components/SwUpdatePrompt";
import { Toasts } from "../../components/Toasts";
import { useSections } from "../../hooks/useSections";
import { getGroupScrollTarget } from "../../store/groupScroll";
import { prefetchOnIdle } from "../../lib/prefetch";
import { AgentTab } from "../../tabs/AgentTab";
import { ConfTabLazy, preloadConfTab } from "../../tabs/ConfTab.lazy";
import { UtilsTab } from "../../tabs/UtilsTab";
import type { TabDef, TabId } from "../types";
import { KitAppBar } from "./AppBar";
import { kitPlanComposerSlots } from "./composer/plan";
import { usePlanPlacement } from "./composer/plan/placement";
import { ThemedComposer, useComposerLayout } from "./composer/ThemedComposer";
import type { ComposerSlots } from "./composer/types";
import { KitFleet } from "./Fleet";
import { KitNavBar } from "./NavBar";
import type { AppbarMode } from "../../store/ui";

// The Kit's DEFAULT root scaffold (D29 §14.4 / D35 §F0) — the standard appbar + scrolling sections +
// floating composer + bottom-nav layout, used by reskin themes (minimal/phosphor) so a theme's `Root` is
// just `<DefaultRoot/>` + a `tokens.css`. It owns the theme-agnostic LAYOUT plumbing: the `.kit` dvh flex
// column, the `.kit-main` positioning context (the composer floats over the scroller so content shows in the
// gaps around it), the generalized lazy-body latch, scroll-reset on section change, lazy-chunk prefetch, and
// the `--appbar-h`/`--composer-h` measurements.
//
// Section bodies (D35's "eager DATA, lazy COMPONENTS" ruling): this module owns the id→body DEFAULT map in
// component space (`DEFAULT_BODIES`) and mounts bodies DATA-DRIVEN from `useSections().sections` — every
// non-hosted section stays keep-mounted and `active`-gated (NEVER conditional-rendered on layout grounds),
// exactly as the old hardwired four were. A theme injects per-theme body OVERRIDES via the `bodies` prop
// (cosmos: `bodies={{ fleet: CosmosFleet }}`), which merges over the defaults — this replaces + generalizes
// the old one-off `Fleet` prop. Curated layout presets recompose WHERE sections live: an on-bar section
// renders in the tab bar, an off-bar one in the floating `<NavMenu/>`, and a HOSTED section (utils→conf)
// renders inside its host body (ConfTab) rather than standalone here (the mount loop skips it).
//
// `appbarMode` is a STRUCTURAL toggle (it changes what's rendered) → an explicit prop the theme passes down.
// It's the GLOBAL `ui.appbarMode` lever (all themes share it); each theme's Root reads it (`useUISlice`) and
// hands it here. Cosmetic settings never reach here — they're token/attr-driven (e.g. minimal's `density`
// → body[data-density]).

interface Props {
  /** The chrome/nav mode (the GLOBAL `ui.appbarMode` lever; the theme reads it + passes it here).
   *  `visible` = appbar + tab bar; `off` = no appbar, tab bar only; `minimal` = no appbar in layout + no
   *  tab bar, navigation via the floating `<NavMenu/>`. */
  appbarMode?: AppbarMode;
  /** Per-theme section-body OVERRIDES (D35 §F0), merged over `DEFAULT_BODIES` by section id — the theme's
   *  bespoke surfaces (cosmos's orbital Fleet, frontier's Agent). Eager data / lazy components: a theme's
   *  bodies always co-load with its lazy Root chunk, so they need no extra code-split. Omitted → all Kit
   *  defaults. Replaces + generalizes the old single-purpose `Fleet` prop. */
  bodies?: Partial<Record<TabId, ComponentType<{ active: boolean }>>>;
  /** Composer ADDONS composed into the variant — the FEATURE axis (D30). Since A4, DefaultRoot OWNS the
   *  inline plan composition (see below), so a theme no longer passes the plan here; this prop is the
   *  future theme-addon seam and is unused today. Omitted → the bare composer (when the plan is `pinned`). */
  composerSlots?: ComposerSlots;
  /** The appbar brand-subtitle slot (D30 slot composition), threaded to KitAppBar — a theme's live/bespoke
   *  subtitle (frontier's rig count). Omitted → the Kit default ("dashboard"). */
  brandMeta?: ReactNode;
}

// The Kit's DEFAULT id→body map (component space — this is the "lazy COMPONENTS" home the pure `tabs.ts`
// deliberately can't hold). fleet→the Kit device list, agent/utils→their tabs, conf→the lazy Conf chunk
// (the mount loop wraps a `lazy`-flagged body in ErrorBoundary+Suspense). A theme's `bodies` prop overrides
// entries by id.
const DEFAULT_BODIES: Record<TabId, ComponentType<{ active: boolean }>> = {
  fleet: KitFleet,
  agent: AgentTab,
  utils: UtilsTab,
  conf: ConfTabLazy,
};

export function DefaultRoot({ appbarMode = "visible", bodies, composerSlots, brandMeta }: Props) {
  // The headless sections controller (D35): the full section list (mount loop), the resolved layout, the
  // on-/off-bar/hosted partitions, the active section, and the shared `navigate` chokepoint. `active` is
  // aliased to `tab` (the body-mount vocabulary); `layout` (the SECTION layout) is aliased to
  // `sectionLayout` to disambiguate from the COMPOSER layout local below.
  const {
    sections,
    hosted,
    menu,
    layout: sectionLayout,
    active: tab,
    navigate,
    hasComposer: showComposer,
  } = useSections();
  // The composer VARIANT is the STYLE axis (D30) — a user-selectable Surface resolved from the active
  // theme's `composer` setting (registry lookup, fallback-safe). Read the layout once here so the
  // `--composer-h` effect can key on it (re-measure on a live swap) and pass it down (one subscription).
  const composerLayout = useComposerLayout();
  // The plan PLACEMENT axis (A4). DefaultRoot OWNS the inline plan composition: when the active theme's
  // placement is `inline` it composes the Kit plan pill+sheet into the composer here (themes no longer pass
  // it). When `pinned`, the plan renders as AgentTab's PinnedPlanPanel and the composer gets NO plan slots.
  // The `composerSlots` prop stays the future theme-addon axis (D30); a real slot-MERGE (inline plan + a
  // theme's own addon) arrives with the first SECOND contributor (ROADMAP A7 / rule of three), not before —
  // so a LIMITATION holds until then: when inline, a theme-passed `composerSlots` is NOT merged with the plan
  // slots (no theme passes any today). DefaultRoot renders NO pinned panel — that's AgentTab's.
  const planPlacement = usePlanPlacement();
  const composerAddons = planPlacement === "inline" ? kitPlanComposerSlots : composerSlots;
  const scrollRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  const bodyMap = { ...DEFAULT_BODIES, ...bodies };

  // Generalized lazy latch (was the Conf-only flag): a per-section mounted map, seeded so eager sections are
  // always mounted and a `lazy` section is mounted only if it's the active one. It flips strictly false→true
  // the first time a lazy section becomes active, then stays mounted (drafts survive). `sections` is a
  // stable per-theme array (a theme switch remounts this Root, reseeding), so it's a safe dep.
  const [mounted, setMounted] = useState<Partial<Record<TabId, boolean>>>(() => {
    const seed: Partial<Record<TabId, boolean>> = {};
    for (const def of sections) if (def.lazy) seed[def.id] = def.id === tab;
    return seed;
  });
  useEffect(() => {
    const def = sections.find((d) => d.id === tab);
    if (def?.lazy && !mounted[tab]) setMounted((prev) => ({ ...prev, [tab]: true }));
  }, [tab, sections, mounted]);

  // Layout coercion (D35): if the active section is HOSTED under the resolved layout (boot with a stale
  // persisted tab, or a live layout switch while a hosted section is active, or any programmatic navigate
  // that bypassed useSections), route through `navigate` — the same chokepoint that lands on the host AND
  // arms the scroll-to-group handoff. Keyed on [tab, sectionLayout] (the identity-stable inputs); `hosted`/
  // `navigate` are fresh each render but only ACT when `hosted[tab]` is set, so re-running is harmless.
  useEffect(() => {
    if (hosted[tab]) navigate(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sectionLayout]);

  // Reset the content pane to the top on section switch (Agent scrolls itself). SKIP when a scroll-to-group
  // handoff is pending (a coerced hosted navigate) — otherwise this parent effect, which runs AFTER the host
  // body's child effect, would cancel the group scroll. Read via getState (a peek), not a subscription.
  useEffect(() => {
    if (tab !== "agent" && !getGroupScrollTarget()) scrollRef.current?.scrollTo(0, 0);
  }, [tab]);

  // Expose the sticky appbar height as `--appbar-h` so the Agent plan tab pins just below it. When the
  // appbar is hidden there's no `.kit-appbar` node → pin content at the top (0), not a stale height.
  useEffect(() => {
    const bar = scrollRef.current?.querySelector<HTMLElement>(".kit-appbar");
    if (!bar) {
      document.documentElement.style.setProperty("--appbar-h", "0px");
      return;
    }
    const set = () =>
      document.documentElement.style.setProperty("--appbar-h", `${bar.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [appbarMode]);

  // The composer floats OVER the scrolling content (so the content shows in the gaps around it). Measure
  // its height → `--composer-h` so the scroller pads its bottom enough for the last content to scroll clear
  // (the textarea auto-grows, so a ResizeObserver keeps the padding in sync). 0 when no composer.
  useEffect(() => {
    const root = document.documentElement;
    const comp = showComposer ? mainRef.current?.querySelector<HTMLElement>(".kit-composer") : null;
    if (!comp) {
      root.style.setProperty("--composer-h", "0px");
      return;
    }
    const set = () => root.style.setProperty("--composer-h", `${comp.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(comp);
    return () => ro.disconnect();
    // `showComposer` fully captures composer mount/unmount; the node is identical across composer-bearing
    // sections (fleet↔agent), so it needn't re-run on `tab`. `composerLayout` IS a dep (EDGE #10): a live
    // variant swap remounts the composer node, so the observer must re-attach to the new node.
  }, [showComposer, composerLayout]);

  // Warm the Conf chunk after first paint so the first Conf click is typically zero-wait. Conf-specific:
  // Conf is the one lazy section, and `TabDef` (pure data) holds no preload thunk — generalizing to any
  // lazy def would need a per-id thunk registry (D35's deferred "option B"), so this stays targeted.
  useEffect(() => {
    const cancel = prefetchOnIdle(preloadConfTab);
    return cancel;
  }, []);

  const prefetch = useCallback((t: string): void => {
    if (t === "conf") void preloadConfTab();
  }, []);

  // No `.no-composer` padding hook here: the Kit shell is an in-flow flex column, so a hidden composer is
  // simply an absent flex child (the column reflows) — no bottom-padding bookkeeping needed (that hook is
  // vapor-only, in VaporRoot).

  return (
    <div className="kit">
      {/* `.kit-main` is the positioning context: the scroller fills it, the composer floats over it (so
          the content scrolls behind the composer and shows in the gaps around it). The nav bar stays an
          in-flow bar below. Per-tab CSS hooks: `body[data-tab]` (ui.ts) — cosmos/frontier tune the Fleet
          edge-scrims through it. */}
      <div className={"kit-main" + (showComposer ? " has-composer" : "")} ref={mainRef}>
        <div className="kit-scroll" id="app-scroll" ref={scrollRef}>
          {appbarMode === "visible" && <KitAppBar brandMeta={brandMeta} />}
          {/* Data-driven body mount (D35): every non-hosted section stays keep-mounted + `active`-gated;
              hosted sections (utils→conf) render inside their host body, not here. A `lazy` body mounts only
              after first activation (the latch) and wraps in ErrorBoundary+Suspense. Index in the FULL list
              drives the fallback's `.sec` number. */}
          {sections.map((def, index) => {
            if (def.id in hosted) return null; // hosted → rendered inside its host (ConfTab), not standalone
            const Body = bodyMap[def.id];
            if (!Body) return null; // defensive: a section with no registered body (future custom id)
            const active = tab === def.id;
            if (def.lazy) {
              if (!mounted[def.id]) return null; // not yet latched
              return (
                <ErrorBoundary
                  key={def.id}
                  fallback={(e, r) => lazyErrorFallback(def, index, e, r)}
                >
                  <Suspense fallback={<LazyLoading def={def} index={index} />}>
                    <Body active={active} />
                  </Suspense>
                </ErrorBoundary>
              );
            }
            return <Body key={def.id} active={active} />;
          })}
        </div>
        <MiniPlayer />
        {showComposer && <ThemedComposer layout={composerLayout} {...(composerAddons ?? {})} />}
      </div>
      {/* Nav (D35 §F0 + the 2026-07-12 docking rule): the in-flow tab bar shows whenever there's an
          appbar-bearing layout (visible/off). The nav menu DOCKS to the chrome that exists — under `visible`
          it's an appbar trailing action (KitAppBar renders it), so the FLOATING launcher mounts only when
          there's no appbar to dock into (`off`/`minimal`) and a section is off-bar-and-unhosted. In 2-tab
          `visible` the docked button + tab bar coexist; in `minimal` the bar is gone and the menu carries all
          nav. */}
      {appbarMode !== "minimal" && <KitNavBar onPrefetch={prefetch} />}
      {appbarMode !== "visible" && menu.length > 0 && <NavMenu />}
      {/* Nav-home quick-jump (F0 follow-up): a top-LEFT companion to the floating orbit menu. It OWNS its
          visibility (minimal-only + self-hides on the primary section) given the chrome mode, so it mounts
          unconditionally here — the single source for "when is the home button shown". */}
      <NavHome appbarMode={appbarMode} />
      <Toasts />
      <ConfirmDialog />
      <PromptModal />
      <SwUpdatePrompt />
    </div>
  );
}

// Suspense fallback for a lazy section's chunk — mirrors the real section header (`.sec` num + label) so
// there's no layout shift. Parameterized from the def (label = `def.lbl`) + its index in the full section
// list (the `.sec` number), keeping the exact DOM shape of the old Conf-specific placeholder.
function LazyLoading({ def, index }: { def: TabDef; index: number }) {
  const num = String(index + 1).padStart(2, "0");
  return (
    <div
      className="tab active"
      id={`tab-${def.id}`}
      data-screen-label={`${num} ${def.lbl}`}
      role="tabpanel"
      aria-labelledby={`tabbtn-${def.id}`}
    >
      <div className="sec">
        <span className="num">{num}</span>
        <b>{def.lbl}</b>
        <span className="right">// loading…</span>
      </div>
    </div>
  );
}

// Error fallback for a lazy section chunk (most common: a stale chunk URL after a deploy → 404). React.lazy
// caches its rejection, so only a reload recovers — the button does exactly that. Parameterized like
// `LazyLoading`.
function lazyErrorFallback(def: TabDef, index: number, error: Error, reload: () => void) {
  const num = String(index + 1).padStart(2, "0");
  return (
    <div
      className="tab active"
      id={`tab-${def.id}`}
      data-screen-label={`${num} ${def.lbl}`}
      role="tabpanel"
      aria-labelledby={`tabbtn-${def.id}`}
    >
      <div className="sec">
        <span className="num">{num}</span>
        <b>{def.lbl}</b>
        <span className="right">// failed to load</span>
      </div>
      <div className="no-svc" style={{ padding: "16px 14px" }}>
        // {error.message || "unknown error"}
        <br />
        <button className="conf-save" style={{ marginTop: 12 }} onClick={reload}>
          Reload page
        </button>
      </div>
    </div>
  );
}
