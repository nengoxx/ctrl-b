import { type ComponentType, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { MiniPlayer } from "../../components/MiniPlayer";
import { PromptModal } from "../../components/PromptModal";
import { SwUpdatePrompt } from "../../components/SwUpdatePrompt";
import { Toasts } from "../../components/Toasts";
import { useSections } from "../../hooks/useSections";
import { prefetchOnIdle } from "../../lib/prefetch";
import { AgentTab } from "../../tabs/AgentTab";
import { ConfTabLazy, preloadConfTab } from "../../tabs/ConfTab.lazy";
import { UtilsTab } from "../../tabs/UtilsTab";
import { KitAppBar } from "./AppBar";
import { KitComposer } from "./Composer";
import { KitFleet } from "./Fleet";
import { KitNavBar } from "./NavBar";

// The Kit's DEFAULT root scaffold (D29 §14.4) — the standard appbar + scrolling sections + floating
// composer + bottom-nav layout, used by reskin themes (minimal/phosphor) so a theme's `Root` is just
// `<DefaultRoot/>` + a `tokens.css`. It owns the theme-agnostic LAYOUT plumbing: the `.kit` dvh flex column,
// the `.kit-main` positioning context (the composer floats over the scroller so content shows in the gaps
// around it), the lazy-Conf latch, scroll-reset on section change, Conf-chunk prefetch, and the
// `--appbar-h`/`--composer-h` measurements. It renders the token-driven Kit chrome (AppBar/NavBar/Composer)
// + the shared tab bodies; theme-SPECIFIC decoration stays in a bespoke Root (e.g. vapor's hero).
//
// `hideAppbar` is a STRUCTURAL toggle (it changes what's rendered) → an explicit prop the theme passes down.
// It's the GLOBAL `ui.hideAppbar` lever (all themes share it); each theme's Root reads it (`useUISlice`) and
// hands it here. The Fleet view is the one per-theme "signature" surface → the `Fleet` prop (defaults to the
// Kit's `KitFleet`). Cosmetic settings never reach here — they're token/attr-driven (e.g. minimal's
// `density` → body[data-density]).

interface Props {
  /** Hide the top app bar (a structural per-theme setting — e.g. minimal's `hideAppbar`). */
  hideAppbar?: boolean;
  /** The Fleet section view (the one per-theme "signature" surface, §14.4). Defaults to the Kit's
   *  device-list `KitFleet`; a theme with a bespoke Fleet (cosmos/frontier) passes its own. */
  Fleet?: ComponentType<{ active: boolean }>;
}

export function DefaultRoot({ hideAppbar = false, Fleet = KitFleet }: Props) {
  const { active: tab, hasComposer: showComposer } = useSections();
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
  }, [hideAppbar]);

  // The composer floats OVER the scrolling content (so the content shows in the gaps around it). Measure
  // its height → `--composer-h` so the scroller pads its bottom enough for the last content to scroll clear
  // (the textarea auto-grows, so a ResizeObserver keeps the padding in sync). 0 when no composer.
  useEffect(() => {
    const root = document.documentElement;
    const comp = showComposer
      ? mainRef.current?.querySelector<HTMLElement>(".kit-composer")
      : null;
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
    // sections (fleet↔agent), so it needn't re-run on `tab`.
  }, [showComposer]);

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
          {!hideAppbar && <KitAppBar />}
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
        {showComposer && <KitComposer />}
      </div>
      <KitNavBar onPrefetch={prefetch} />
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
