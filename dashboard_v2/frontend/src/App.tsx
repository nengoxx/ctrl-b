import { useEffect, useRef } from "react";

import { AppBar } from "./components/AppBar";
import { Composer } from "./components/Composer";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { TabBar } from "./components/TabBar";
import { Toasts } from "./components/Toasts";
import { useEventStream } from "./hooks/useEvents";
import { useUI } from "./store/ui";
import { AgentTab } from "./tabs/AgentTab";
import { ConfTab } from "./tabs/ConfTab";
import { FleetTab } from "./tabs/FleetTab";
import { UtilsTab } from "./tabs/UtilsTab";

// The Vapor SPA shell. App-shell layout (extras.css): a 100dvh flex column — a scrolling content
// pane (`.app-scroll`) with the appbar + tabs, then the composer + tab bar in-flow at the bottom.
// This replaces window-scroll + fixed bottom bars, which broke on Android: with the bars in normal
// flow inside a dvh-sized shell, they always sit at the visible bottom (tracking the browser
// toolbar/keyboard) and the chat scrolls in its own pane — no body padding, no fixed/viewport
// mismatch. Visuals are identical to the prototype (D7).
//
// Vapor CSS keys off body data-attrs (theme/tab/skyline/loz) + body.no-composer; we mirror the UI
// store onto <body>. All four tabs stay mounted (the .tab CSS shows only the active one).

export default function App() {
  const { theme, tab, skyline, loz } = useUI();
  const scrollRef = useRef<HTMLDivElement>(null);
  useEventStream(); // live activity feed → refresh fleet on any recorded action

  useEffect(() => {
    const b = document.body;
    b.dataset.theme = theme;
    b.dataset.tab = tab;
    b.dataset.skyline = skyline;
    b.dataset.loz = loz;
    const showComposer = tab === "fleet" || tab === "agent";
    b.classList.toggle("no-composer", !showComposer);
  }, [theme, tab, skyline, loz]);

  // Reset the content pane to the top on tab switch (the pane scrolls now, not the window). The
  // Agent tab is the exception — it scrolls itself to the newest message (AgentTab, on `active`).
  useEffect(() => {
    if (tab !== "agent") scrollRef.current?.scrollTo(0, 0);
  }, [tab]);

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

  const showComposer = tab === "fleet" || tab === "agent";

  return (
    <div className="app-shell">
      <div className="app-scroll" id="app-scroll" ref={scrollRef}>
        <AppBar />
        <FleetTab active={tab === "fleet"} />
        <AgentTab active={tab === "agent"} />
        <UtilsTab active={tab === "utils"} />
        <ConfTab active={tab === "conf"} />
      </div>
      {showComposer && <Composer />}
      <TabBar />
      <Toasts />
      <ConfirmDialog />
    </div>
  );
}
