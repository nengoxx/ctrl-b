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
import { useUISlice } from "../../store/ui";
import { prefetchOnIdle } from "../../lib/prefetch";
import { AgentTab } from "../../tabs/AgentTab";
import { ConfTabLazy, preloadConfTab } from "../../tabs/ConfTab.lazy";
import { FleetTab } from "../../tabs/FleetTab";
import { UtilsTab } from "../../tabs/UtilsTab";
import { useThemeSetting } from "../../theme-engine/settings";
import type { Loz, Skyline } from "./index";

// The vapor theme's Root (Phase 11 v2 / D29 §14.7 M0). This is today's App body verbatim — the
// `.app-shell` dvh flex column (a scrolling `.app-scroll` with the appbar + tabs, then composer +
// tab bar in-flow at the bottom) — extracted out of App.tsx so the theme owns its whole presentation.
// App is now a thin host that renders the active theme's Root + runs app-global effects.
//
// M0 = pure extraction: vapor's rendered DOM + behaviour are UNCHANGED (the byte-identical acceptance
// test). vapor's components are rendered directly here (no slot indirection). The layout-specific
// effects (lazy-Conf latch, scroll-reset, `--appbar-h`) live here (theme-owned layout); the app-global
// effects (event stream, appearance sync, `--app-h` viewport, beforeunload) stay in App. The overlays
// (MiniPlayer/Toasts/…) stay inside `.app-shell` for byte-identical DOM — they become Kit/token-driven
// + hoisted to App in the Kit slice.
//
// Vapor CSS keys off body data-attrs (theme/tab/skyline/loz) + body.no-composer (written synchronously
// by store/ui.ts). Fleet/Agent/Utils are always mounted (`.tab` CSS shows only the active one); Conf is
// lazy — mounted after its first activation, once-and-stays so its draft state survives tab switches.

export function VaporRoot() {
  // Active section + composer-visibility from the headless sections controller (D29 §14.2). `active` is
  // aliased to `tab` (vapor's local vocabulary) since the whole body keys off it; `showComposer` is the
  // active section's composer flag (was the `tab==='fleet'||'agent'` hardcode).
  const { active: tab, hasComposer: showComposer } = useSections();
  // The global chrome lever (visible/off/minimal). vapor renders its OWN AppBar, so it maps the mode here:
  // appbar shows only in `visible`. vapor's `minimal` is DEFERRED — it behaves like `off` (no appbar) and
  // keeps vapor's bottom TabBar (no floating NavMenu yet — THEME_ENGINE §14.13, the bespoke-Root TODO).
  const appbarMode = useUISlice((s) => s.appbarMode);
  const showAppbar = appbarMode === "visible";
  const scrollRef = useRef<HTMLDivElement>(null);

  // Lazy Conf tab: conditional mount, strictly false→true, stays mounted to preserve form drafts.
  const [confMounted, setConfMounted] = useState(() => tab === "conf");
  useEffect(() => {
    if (tab === "conf" && !confMounted) setConfMounted(true);
  }, [tab, confMounted]);

  // Reset the content pane to the top on tab switch (Agent is the exception — it scrolls itself).
  useEffect(() => {
    if (tab !== "agent") scrollRef.current?.scrollTo(0, 0);
  }, [tab]);

  // Expose vapor's sticky appbar height as `--appbar-h` so the Agent plan tab pins just below it.
  // vapor's Root definitively renders `.appbar`, so a direct query is correct (no cross-theme concern —
  // a different skin unmounts this Root). A wrapper-ref is unusable (the appbar is position:sticky).
  useEffect(() => {
    const bar = scrollRef.current?.querySelector<HTMLElement>(".appbar");
    if (!bar) {
      // appbar hidden → pin content at the top (0), not a stale height (matches DefaultRoot).
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

  // Warm the Conf chunk after first paint so the first Conf click is typically zero-wait.
  useEffect(() => {
    const cancel = prefetchOnIdle(preloadConfTab);
    return cancel;
  }, []);

  // Tab → preload map (Conf is the only lazy tab). Stable reference for TabBar.
  const prefetch = useCallback((t: string): void => {
    if (t === "conf") void preloadConfTab();
  }, []);

  // `.no-composer` is vapor's OWN layout hook (vapor.css `body.no-composer { padding-bottom }`) — theme-
  // owned now, not written by the core store. useLayoutEffect so the padding flips before paint (no flash
  // on a tab switch / first load), in the same commit the composer mounts/unmounts below.
  useLayoutEffect(() => {
    document.body.classList.toggle("no-composer", !showComposer);
  }, [showComposer]);

  // vapor's decorative `body[data-skyline]`/`body[data-loz]` axes are THEME-OWNED (M3 §14.3): they come
  // from vapor's `ThemeDef.settings`, written here (not by the core ui store) so the core stops knowing
  // vapor-specific attrs. useLayoutEffect → set before paint (the CSS keys hard off both values, so a
  // missing attr would show both skylines for a frame). Cleared on unmount so a switched-to skin can't
  // inherit a stale vapor attr.
  const skyline = useThemeSetting<Skyline>("vapor", "skyline");
  const loz = useThemeSetting<Loz>("vapor", "loz");
  useLayoutEffect(() => {
    const b = document.body;
    b.dataset.skyline = skyline;
    b.dataset.loz = loz;
    return () => {
      delete b.dataset.skyline;
      delete b.dataset.loz;
    };
  }, [skyline, loz]);

  return (
    <div className="app-shell">
      <div className="app-scroll" id="app-scroll" ref={scrollRef}>
        {showAppbar && <AppBar />}
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
      {/* Floating TTS mini-player (6b-2): fixed-position pill just below the appbar (its own CSS),
          so JSX placement here doesn't affect layout. Self-hides when nothing's playing. */}
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

// Vapor-styled Suspense fallback for the Conf chunk. Shape mirrors the real Conf tab's section header
// so there's no layout shift when the chunk resolves. Only rendered once Conf is the active tab.
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

// Error fallback for the lazy Conf chunk (most common: a stale chunk URL after a deploy → 404).
// React.lazy caches its rejection, so only a page reload recovers — the button does exactly that.
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
