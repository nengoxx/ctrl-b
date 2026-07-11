import { type ComponentType, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { MiniPlayer } from "../../components/MiniPlayer";
import { NavMenu } from "../../components/NavMenu";
import { PromptModal } from "../../components/PromptModal";
import { SwUpdatePrompt } from "../../components/SwUpdatePrompt";
import { Toasts } from "../../components/Toasts";
import { useSections } from "../../hooks/useSections";
import { prefetchOnIdle } from "../../lib/prefetch";
import { AgentTab } from "../../tabs/AgentTab";
import { ConfTabLazy, preloadConfTab } from "../../tabs/ConfTab.lazy";
import { UtilsTab } from "../../tabs/UtilsTab";
import { KitAppBar } from "./AppBar";
import { kitPlanComposerSlots } from "./composer/plan";
import { usePlanPlacement } from "./composer/plan/placement";
import { ThemedComposer, useComposerLayout } from "./composer/ThemedComposer";
import type { ComposerSlots } from "./composer/types";
import { KitFleet } from "./Fleet";
import { KitNavBar } from "./NavBar";
import type { AppbarMode } from "../../store/ui";

// The Kit's DEFAULT root scaffold (D29 §14.4) — the standard appbar + scrolling sections + floating
// composer + bottom-nav layout, used by reskin themes (minimal/phosphor) so a theme's `Root` is just
// `<DefaultRoot/>` + a `tokens.css`. It owns the theme-agnostic LAYOUT plumbing: the `.kit` dvh flex column,
// the `.kit-main` positioning context (the composer floats over the scroller so content shows in the gaps
// around it), the lazy-Conf latch, scroll-reset on section change, Conf-chunk prefetch, and the
// `--appbar-h`/`--composer-h` measurements. It renders the token-driven Kit chrome (AppBar/NavBar/Composer)
// + the shared tab bodies; theme-SPECIFIC decoration stays in a bespoke Root (e.g. vapor's hero).
//
// `appbarMode` is a STRUCTURAL toggle (it changes what's rendered) → an explicit prop the theme passes down.
// It's the GLOBAL `ui.appbarMode` lever (all themes share it); each theme's Root reads it (`useUISlice`) and
// hands it here. The Fleet view is the one per-theme "signature" surface → the `Fleet` prop (defaults to the
// Kit's `KitFleet`). Cosmetic settings never reach here — they're token/attr-driven (e.g. minimal's
// `density` → body[data-density]).

interface Props {
  /** The chrome/nav mode (the GLOBAL `ui.appbarMode` lever; the theme reads it + passes it here).
   *  `visible` = appbar + tab bar; `off` = no appbar, tab bar only; `minimal` = no appbar in layout + no
   *  tab bar, navigation via the floating `<NavMenu/>`. */
  appbarMode?: AppbarMode;
  /** The Fleet section view (the one per-theme "signature" surface, §14.4). Defaults to the Kit's
   *  device-list `KitFleet`; a theme with a bespoke Fleet (cosmos/frontier) passes its own. */
  Fleet?: ComponentType<{ active: boolean }>;
  /** Composer ADDONS composed into the variant — the FEATURE axis (D30). Since A4, DefaultRoot OWNS the
   *  inline plan composition (see below), so a theme no longer passes the plan here; this prop is the
   *  future theme-addon seam and is unused today. Omitted → the bare composer (when the plan is `pinned`). */
  composerSlots?: ComposerSlots;
}

export function DefaultRoot({ appbarMode = "visible", Fleet = KitFleet, composerSlots }: Props) {
  const { active: tab, hasComposer: showComposer } = useSections();
  // The composer VARIANT is the STYLE axis (D30) — now a user-selectable Surface resolved from the active
  // theme's `composer` setting (registry lookup, fallback-safe). Read the layout once here so the
  // `--composer-h` effect can key on it (re-measure on a live swap) and pass it down (one subscription).
  const layout = useComposerLayout();
  // The plan PLACEMENT axis (A4). DefaultRoot now OWNS the inline plan composition: when the active theme's
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

  // Lazy Conf tab: conditional mount, strictly false→true, stays mounted to preserve form drafts.
  const [confMounted, setConfMounted] = useState(() => tab === "conf");
  useEffect(() => {
    if (tab === "conf" && !confMounted) setConfMounted(true);
  }, [tab, confMounted]);

  // Reset the content pane to the top on section switch (Agent scrolls itself).
  useEffect(() => {
    if (tab !== "agent") scrollRef.current?.scrollTo(0, 0);
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
    // sections (fleet↔agent), so it needn't re-run on `tab`. `layout` IS a dep (EDGE #10): a live variant
    // swap remounts the composer node, so the observer must re-attach to the new node.
  }, [showComposer, layout]);

  // Warm the Conf chunk after first paint so the first Conf click is typically zero-wait.
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
          in-flow bar below. */}
      <div className={"kit-main" + (showComposer ? " has-composer" : "")} ref={mainRef}>
        <div className="kit-scroll" id="app-scroll" ref={scrollRef}>
          {appbarMode === "visible" && <KitAppBar />}
          <Fleet active={tab === "fleet"} />
          <AgentTab active={tab === "agent"} />
          <UtilsTab active={tab === "utils"} />
          {confMounted && (
            <ErrorBoundary fallback={confErrorFallback}>
              <Suspense fallback={<ConfLoading />}>
                <ConfTabLazy active={tab === "conf"} />
              </Suspense>
            </ErrorBoundary>
          )}
        </div>
        <MiniPlayer />
        {showComposer && <ThemedComposer layout={layout} {...(composerAddons ?? {})} />}
      </div>
      {/* minimal → the floating NavMenu replaces the bottom tab bar (and there's no appbar); visible/off keep
          the in-flow tab bar. The lunar/fleet view fills the freed height (CosmosFleet measures `--appbar-h`,
          which is 0 with no appbar). */}
      {appbarMode === "minimal" ? <NavMenu /> : <KitNavBar onPrefetch={prefetch} />}
      <Toasts />
      <ConfirmDialog />
      <PromptModal />
      <SwUpdatePrompt />
    </div>
  );
}

// Suspense fallback for the Conf chunk — mirrors the real Conf header so there's no layout shift.
function ConfLoading() {
  return (
    <div
      className="tab active"
      id="tab-conf"
      data-screen-label="04 Conf"
      role="tabpanel"
      aria-labelledby="tabbtn-conf"
    >
      <div className="sec">
        <span className="num">04</span>
        <b>Conf</b>
        <span className="right">// loading…</span>
      </div>
    </div>
  );
}

// Error fallback for the lazy Conf chunk (most common: a stale chunk URL after a deploy → 404). React.lazy
// caches its rejection, so only a reload recovers — the button does exactly that.
function confErrorFallback(error: Error, reload: () => void) {
  return (
    <div
      className="tab active"
      id="tab-conf"
      data-screen-label="04 Conf"
      role="tabpanel"
      aria-labelledby="tabbtn-conf"
    >
      <div className="sec">
        <span className="num">04</span>
        <b>Conf</b>
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
