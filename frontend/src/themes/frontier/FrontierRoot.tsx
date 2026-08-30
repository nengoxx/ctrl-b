import { DefaultRoot } from "../../theme-engine/kit/DefaultRoot";
import { useHosts, useServerInfo } from "../../hooks/useFleet";
import { overlayPending, usePendingFleet } from "../../store/fleetPending";
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
  const brandMeta = useFrontierBrandMeta();
  return (
    <DefaultRoot
      appbarMode={appbarMode}
      bodies={{ fleet: FrontierFleet, agent: FrontierAgent }}
      brandMeta={brandMeta}
      // frontier owns its own full-bleed art (the badlands map cover + the rig stack), so it opts out of
      // the shared kit background: full-app scenery is exclusive by default (the Kit Art System / A5).
      kitBackground={false}
    />
  );
}

// The appbar brand subtitle — the prototype's live "N/M rigs · online" (frontier fills the Kit's `brandMeta`
// slot, the D30 slot-composition pattern applied to the appbar; owner-ratified at the F1 pre-flight). Reads
// the SAME query pair `useFleet` itself composes (useServerInfo → poll cadence, useHosts → the fleet), so it
// shares the fleet query cache with no new wiring. While the fleet is loading or empty it renders NOTHING —
// the G6.3 owner ruling retired every decorative subtitle ("dashboard" included); this slot survives only
// because its filled state is live DATA.
//
// A HOOK, not a component (G6.5, Codex's LOW-1). It used to be `<FrontierBrandMeta />` — an element, which
// is never `null` however the component renders — so the Kit's `brandMeta != null` test saw a filled slot
// whatever the fleet was doing, and with the subtitle switch on an empty/loading fleet still emitted an
// empty `<span class="meta">`. Resolving the data HERE makes the slot value itself the answer: a string when
// there are rigs, `null` when there are none, which is exactly what that conditional was written to read.
// The cost is a Root render per fleet poll (the query notifies its subscriber wherever it lives); the
// shell's expensive leaves — the chat bubbles, the markdown — are `memo`'d against precisely that.
function useFrontierBrandMeta(): string | null {
  const { data: server } = useServerInfo();
  const { data: hosts = [] } = useHosts(server?.poll_seconds ?? 5);
  // Counted THROUGH the pending overlay (sol confirm round MED-1, 2026-08-30): this is the one raw
  // `useHosts` consumer that reads LIVENESS, and the old optimistic cache flip it silently relied on
  // is gone — without the overlay the app bar keeps saying 4/4 while the fleet below already shows a
  // shutdown-pending rig as offline. Reactive read + the store's own overlay helper, never a second
  // pending implementation.
  const pending = usePendingFleet();
  if (hosts.length === 0) return null;
  const shown = overlayPending(hosts, pending);
  return `${shown.filter((h) => h.status?.online).length}/${shown.length} rigs · online`;
}
