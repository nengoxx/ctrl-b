import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { AppBar } from "./components/AppBar";
import { Composer } from "./components/Composer";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TabBar } from "./components/TabBar";
import { Toasts } from "./components/Toasts";
import { useEventStream } from "./hooks/useEvents";
import { prefetchOnIdle } from "./lib/prefetch";
import { useUISlice, type Tab } from "./store/ui";
import { AgentTab } from "./tabs/AgentTab";
import { ConfTabLazy, preloadConfTab } from "./tabs/ConfTab.lazy";
import { FleetTab } from "./tabs/FleetTab";
import { UtilsTab } from "./tabs/UtilsTab";

// The Vapor SPA shell. App-shell layout (extras.css): a 100dvh flex column — a scrolling content
// pane (`.app-scroll`) with the appbar + tabs, then the composer + tab bar in-flow at the bottom.
// This replaces window-scroll + fixed bottom bars, which broke on Android: with the bars in normal
// flow inside a dvh-sized shell, they always sit at the visible bottom (tracking the browser
// toolbar/keyboard) and the chat scrolls in its own pane — no body padding, no fixed/viewport
// mismatch. Visuals are identical to the prototype (D7).
//
// Vapor CSS keys off body data-attrs (theme/tab/skyline/loz) + body.no-composer. The store
// (store/ui.ts) writes those attrs synchronously inside setUI(), so this shell only needs to
// subscribe to `tab` for its own conditional rendering (composer visibility + scroll reset on
// tab switch). Fleet/Agent/Utils are always mounted (the .tab CSS shows only the active one);
// Conf is lazy — only mounted after its first activation (Slice 6 / F6), once-and-stays-mounted
// so its draft state survives subsequent tab switches.

export default function App() {
  const tab = useUISlice((s) => s.tab);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEventStream(); // live activity feed → refresh fleet on any recorded action

  // Conditional mount for the lazy Conf tab (Slice 6 audit fixes — see UI_AUDIT.md). The
  // initializer reads `tab` (resolved from localStorage at module load) so a hard reload while
  // the user is on Conf mounts it immediately — otherwise the dvh layout would briefly show no
  // active tab between first paint and the useEffect upgrade. State transitions are strictly
  // false → true; ConfTab, once mounted, stays mounted to preserve form drafts across tab
  // switches.
  const [confMounted, setConfMounted] = useState(() => tab === "conf");
  useEffect(() => {
    if (tab === "conf" && !confMounted) setConfMounted(true);
  }, [tab, confMounted]);

  // Reset the content pane to the top on tab switch (the pane scrolls now, not the window). The
  // Agent tab is the exception — it scrolls itself to the newest message (AgentTab, on `active`).
  useEffect(() => {
    if (tab !== "agent") scrollRef.current?.scrollTo(0, 0);
  }, [tab]);

  // Expose the (sticky) appbar's height as `--appbar-h` so other sticky elements — the Agent tab's
  // plan tab — can pin just *below* the menu bar instead of riding up over it. Re-measured on resize
  // (theme/content/orientation changes shift it).
  useEffect(() => {
    const bar = document.querySelector(".appbar") as HTMLElement | null;
    if (!bar) return;
    const set = () =>
      document.documentElement.style.setProperty("--appbar-h", `${bar.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  // Size the app-shell to the VISUAL viewport. `100dvh` (CSS fallback) tracks the browser toolbar
  // but NOT the on-screen keyboard, so a pure-dvh shell leaves the in-flow composer hidden behind
  // the keyboard. `visualViewport.height` shrinks when the keyboard opens, so the shell (and its
  // bottom composer) stays above it. `--app-h` overrides the dvh fallback once JS runs.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => document.documentElement.style.setProperty("--app-h", `${vv.height}px`);
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, []);

  // Slice 6 / F6: warm the Conf chunk after first paint so the first click on the Conf tab is
  // typically zero-wait. Idle-scheduled — never competes with the critical render path. The
  // hover/touch handlers below are the belt-and-suspenders fallback for users who click within
  // the first ~800ms before idle fires. Meaningful only because ConfTab is conditionally
  // mounted: without that, React.lazy would have already kicked off the fetch on App mount.
  useEffect(() => {
    const cancel = prefetchOnIdle(preloadConfTab);
    return cancel;
  }, []);

  // Map of tab-name → preload function. The Conf tab is the only one currently lazy-loaded; future
  // lazy tabs slot in here without touching TabBar's shape. Each call is safe to invoke repeatedly
  // (the importer is cached at the ES-module layer, so subsequent calls resolve instantly).
  // `useCallback` with empty deps so TabBar receives a stable reference — future memoization of
  // TabBar (or strict prop-identity checks) won't churn.
  const prefetch = useCallback((t: Tab): void => {
    if (t === "conf") void preloadConfTab();
  }, []);

  const showComposer = tab === "fleet" || tab === "agent";

  return (
    <div className="app-shell">
      <div className="app-scroll" id="app-scroll" ref={scrollRef}>
        <AppBar />
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
      {showComposer && <Composer />}
      <TabBar onPrefetch={prefetch} />
      <Toasts />
      <ConfirmDialog />
    </div>
  );
}

// Vapor-styled Suspense fallback for the Conf chunk. Shape mirrors the real Conf tab's section
// header so there's no layout shift when the chunk resolves and ConfTab takes over. Only rendered
// when ConfTab is the active tab (the outer `{confMounted && ...}` guard means we only enter the
// Suspense boundary after the user has clicked Conf at least once), so `className="tab active"`
// is correct in context.
function ConfLoading() {
  return (
    <div className="tab active" id="tab-conf" data-screen-label="04 Conf">
      <div className="sec">
        <span className="num">04</span>
        <b>Conf</b>
        <span className="right">// loading…</span>
      </div>
    </div>
  );
}

// Error fallback for the lazy Conf chunk. The most common failure mode is a stale chunk URL
// after a deploy (the user has the old `index.html` loaded, a new build was deployed, the lazy
// chunk hash changed → 404). React.lazy caches its rejection so the boundary can't recover by
// clearing state — only a page reload picks up the new manifest. The button does exactly that.
function confErrorFallback(error: Error, reload: () => void) {
  return (
    <div className="tab active" id="tab-conf" data-screen-label="04 Conf">
      <div className="sec">
        <span className="num">04</span>
        <b>Conf</b>
        <span className="right">// failed to load</span>
      </div>
      <div className="no-svc" style={{ padding: "16px 14px" }}>
        // {error.message || "unknown error"}
        <br />
        <button
          className="conf-save"
          style={{ marginTop: 12 }}
          onClick={reload}
        >
          Reload page
        </button>
      </div>
    </div>
  );
}

