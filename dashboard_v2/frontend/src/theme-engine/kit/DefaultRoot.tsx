import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { AppBar } from "../../components/AppBar";
import { Composer } from "../../components/Composer";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { MiniPlayer } from "../../components/MiniPlayer";
import { PromptModal } from "../../components/PromptModal";
import { SwUpdatePrompt } from "../../components/SwUpdatePrompt";
import { TabBar } from "../../components/TabBar";
import { Toasts } from "../../components/Toasts";
import { useSections } from "../../hooks/useSections";
import { prefetchOnIdle } from "../../lib/prefetch";
import { AgentTab } from "../../tabs/AgentTab";
import { ConfTabLazy, preloadConfTab } from "../../tabs/ConfTab.lazy";
import { FleetTab } from "../../tabs/FleetTab";
import { UtilsTab } from "../../tabs/UtilsTab";

// The Kit's DEFAULT root scaffold (D29 §14.4) — the standard appbar + scrolling sections + composer +
// bottom-nav layout, generalized out of VaporRoot so a reskin theme's `Root` is just `<DefaultRoot/>` + a
// `tokens.css`. It owns the theme-agnostic LAYOUT plumbing every standard theme shares: the `.app-shell`
// dvh flex column, the lazy-Conf latch, scroll-reset on section change, the `--appbar-h` measurement, Conf
// chunk prefetch, and the `.no-composer` padding hook. Theme-SPECIFIC decoration (vapor's hero/skyline)
// stays in that theme's own Root; cosmetic options (minimal's density) stay attribute/token-driven.
//
// `hideAppbar` is a STRUCTURAL per-theme setting (it changes what's rendered), so it's an explicit prop the
// theme passes down (e.g. minimal reads `useThemeSetting("minimal","hideAppbar")`). Cosmetic settings never
// reach here — they're token/attr-driven, so the scaffold stays ignorant of any one theme's options.
//
// K1 NOTE: this reuses the existing (vapor-authored) chrome components — proven layout, but they carry
// vapor's class vocabulary, so under a non-vapor skin they render unstyled until the Bucket-A token CSS +
// Kit token-driven chrome land (K2/K3). The scaffold STRUCTURE is final; only which leaf components it
// mounts evolves.

interface Props {
  /** Hide the top app bar (a structural per-theme setting — e.g. minimal's `hideAppbar`). */
  hideAppbar?: boolean;
}

export function DefaultRoot({ hideAppbar = false }: Props) {
  const { active: tab, hasComposer: showComposer } = useSections();
  const scrollRef = useRef<HTMLDivElement>(null);

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
  // appbar is hidden there's no `.appbar` node → the effect no-ops and the var stays unset (0 fallback).
  useEffect(() => {
    const bar = scrollRef.current?.querySelector<HTMLElement>(".appbar");
    if (!bar) {
      // No app bar (hidden, or a theme that omits it) → pin content at the top, not a stale height.
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

  // Warm the Conf chunk after first paint so the first Conf click is typically zero-wait.
  useEffect(() => {
    const cancel = prefetchOnIdle(preloadConfTab);
    return cancel;
  }, []);

  const prefetch = useCallback((t: string): void => {
    if (t === "conf") void preloadConfTab();
  }, []);

  // `.no-composer` padding hook — layout-owned, written before paint (no flash on a section switch / first
  // load), in the same commit the composer mounts/unmounts below.
  useLayoutEffect(() => {
    document.body.classList.toggle("no-composer", !showComposer);
  }, [showComposer]);

  return (
    <div className="app-shell">
      <div className="app-scroll" id="app-scroll" ref={scrollRef}>
        {!hideAppbar && <AppBar />}
        <FleetTab active={tab === "fleet"} />
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
      {showComposer && <Composer />}
      <TabBar onPrefetch={prefetch} />
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
