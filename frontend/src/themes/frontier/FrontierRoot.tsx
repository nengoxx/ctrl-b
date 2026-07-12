import { DefaultRoot } from "../../theme-engine/kit/DefaultRoot";
import { useHosts, useServerInfo } from "../../hooks/useFleet";
import { useUISlice } from "../../store/ui";
import { FrontierAgent } from "./FrontierAgent";
import { FrontierFleet } from "./FrontierFleet";

// frontier's Root (D29 §14.4 / §14.13). A thin scaffold Root: it maps the palette onto the REUSED Kit shell
// (DefaultRoot, colored by frontier's tokens.css) and fills the appbar's brand-subtitle slot with a live rig
// count. F2/F4 inject the bespoke surfaces — the badlands Fleet MAP + the floating-rig Agent — via
// DefaultRoot's `bodies` override map; a body co-loads with this lazy Root chunk (a static import, the
// cosmos pattern), so it needs no extra code-split. Honors the global `ui.appbarMode` lever (all themes).
// frontier omits `layouts` (offers all presets) and defaults to `3-tab` (registry).
export function FrontierRoot() {
  const appbarMode = useUISlice((s) => s.appbarMode);
  return (
    <DefaultRoot
      appbarMode={appbarMode}
      bodies={{ fleet: FrontierFleet, agent: FrontierAgent }}
      brandMeta={<FrontierBrandMeta />}
    />
  );
}

// The appbar brand subtitle — the prototype's live "N/M rigs · online" (frontier fills the Kit's `brandMeta`
// slot, the D30 slot-composition pattern applied to the appbar; owner-ratified at the F1 pre-flight). Reads
// the SAME query pair `useFleet` itself composes (useServerInfo → poll cadence, useHosts → the fleet), so it
// shares the fleet query cache with no new wiring. While the fleet is loading or empty it renders the Kit's
// default "dashboard" copy (no invented text).
function FrontierBrandMeta() {
  const { data: server } = useServerInfo();
  const { data: hosts = [] } = useHosts(server?.poll_seconds ?? 5);
  if (hosts.length === 0) return <>dashboard</>;
  const on = hosts.filter((h) => h.status?.online).length;
  return (
    <>
      {on}/{hosts.length} rigs · online
    </>
  );
}
