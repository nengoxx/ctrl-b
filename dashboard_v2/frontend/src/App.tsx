import { useEffect } from "react";

import { AppBar } from "./components/AppBar";
import { Composer } from "./components/Composer";
import { TabBar } from "./components/TabBar";
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
    </>
  );
}
