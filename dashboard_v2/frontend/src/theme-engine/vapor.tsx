// The vapor theme module (Phase 11 / D28). ⛔ FROZEN: vapor registers its EXISTING components as
// slots verbatim — no edits to any vapor component or to vapor.css/extras.css (D7). vapor is a fully
// self-contained module that overrides EVERY slot (never leans on BASE), so with only vapor
// registered the app renders byte-for-byte identically — the T0 acceptance test.
//
// vapor's CSS is already always-loaded (theme/index.css → layer(frozen)) and its fonts come from
// index.html, so `loadStyles`/`loadFonts` are no-ops. Its palette = the named accents (dark/aqua/
// ember) on the frozen `body[data-theme]` axis; it declares NO mode axis (dark-only).

import { AppBar } from "../components/AppBar";
import { Composer } from "../components/Composer";
import { TabBar } from "../components/TabBar";
import { AgentTab } from "../tabs/AgentTab";
import { ConfTabLazy } from "../tabs/ConfTab.lazy";
import { FleetTab } from "../tabs/FleetTab";
import { UtilsTab } from "../tabs/UtilsTab";
import { STANDARD_TABS } from "./tabs";
import type { ThemeDef } from "./types";

export const vapor: ThemeDef = {
  id: "vapor",
  label: "Vapor",
  // Named accents on vapor's frozen `body[data-theme]` axis. "dark" = the bare :root default (vapor.css);
  // aqua/ember = the [data-theme] override blocks. No `modes` axis — vapor is dark-only.
  palettes: {
    accents: [
      { id: "dark", label: "Vapor" },
      { id: "aqua", label: "Aqua" },
      { id: "ember", label: "Ember" },
    ],
    defaultAccent: "dark",
  },
  tabs: STANDARD_TABS,
  slots: {
    AppBar,
    Composer,
    TabBar,
    FleetView: FleetTab,
    AgentView: AgentTab,
    UtilsView: UtilsTab,
    // ConfShell is the lazy Conf body; App wraps the rendered slot in its ErrorBoundary→Suspense
    // (the lazy chunk isn't fetched until rendered, so importing the lazy ref here is free).
    ConfShell: ConfTabLazy,
  },
  loadStyles: () => Promise.resolve(), // vapor.css is in layer(frozen), already loaded
};
