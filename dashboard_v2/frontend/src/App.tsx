import { Suspense, useEffect, useRef } from "react";

import { AppBar } from "./components/AppBar";
import { Composer } from "./components/Composer";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { TabBar } from "./components/TabBar";
import { Toasts } from "./components/Toasts";
import { useEventStream } from "./hooks/useEvents";
import { prefetchOnIdle } from "./lib/prefetch";
import { useUI, type Tab } from "./store/ui";
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
// tab switch). All four tabs stay mounted (the .tab CSS shows only the active one).

export default function App() {
  const { tab } = useUI();
  const scrollRef = useRef<HTMLDivElement>(null);
  useEventStream(); // live activity feed → refresh fleet on any recorded action

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
  // the first ~800ms before idle fires.
  useEffect(() => {
    const cancel = prefetchOnIdle(preloadConfTab);
    return cancel;
  }, []);

  // Map of tab-name → preload function. The Conf tab is the only one currently lazy-loaded; future
  // lazy tabs slot in here without touching TabBar's shape. Each call is safe to invoke repeatedly
  // (the importer is cached at the ES-module layer, so subsequent calls resolve instantly).
  const prefetch = (t: Tab): void => {
    if (t === "conf") void preloadConfTab();
  };

  const showComposer = tab === "fleet" || tab === "agent";

  return (
    <div className="app-shell">
      <div className="app-scroll" id="app-scroll" ref={scrollRef}>
        <AppBar />
        <FleetTab active={tab === "fleet"} />
        <AgentTab active={tab === "agent"} />
        <UtilsTab active={tab === "utils"} />
        <Suspense fallback={<ConfLoading />}>
          <ConfTabLazy active={tab === "conf"} />
        </Suspense>
      </div>
      {showComposer && <Composer />}
      <TabBar onPrefetch={prefetch} />
      <Toasts />
      <ConfirmDialog />
    </div>
  );
}

// Vapor-styled Suspense fallback for the Conf chunk. Shape mirrors the real Conf tab's section
// header so there's no layout shift when the chunk resolves and ConfTab takes over. Only ever
// visible in the worst case (cold cache + immediate click before idle prefetch lands); in normal
// use the chunk is already warm via prefetch.
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

