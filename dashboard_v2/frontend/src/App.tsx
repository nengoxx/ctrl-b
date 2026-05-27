import { useEffect } from "react";

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

// The Vapor SPA shell. The Vapor CSS keys off body data-attrs (theme/tab/skyline/loz) and
// body.no-composer, so we mirror the UI store onto <body>. All four tabs stay mounted (the .tab
// CSS shows only the active one) — keeps the Fleet waveform/poll alive across tab switches.

export default function App() {
  const { theme, tab, skyline, loz } = useUI();
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

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  const showComposer = tab === "fleet" || tab === "agent";

  return (
    <>
      <AppBar />
      <FleetTab active={tab === "fleet"} />
      <AgentTab active={tab === "agent"} />
      <UtilsTab active={tab === "utils"} />
      <ConfTab active={tab === "conf"} />
      {showComposer && <Composer />}
      <TabBar />
      <Toasts />
      <ConfirmDialog />
    </>
  );
}
