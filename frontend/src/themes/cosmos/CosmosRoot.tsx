import { DefaultRoot } from "../../theme-engine/kit/DefaultRoot";
import { useUISlice } from "../../store/ui";
import { CosmosFleet } from "./CosmosFleet";
import { CosmosStarfield } from "./CosmosStarfield";

// cosmos's Root (D29 §14.4 / §14.13). A BESPOKE Root that layers the deep-space starfield (C1) behind the
// REUSED Kit shell — Agent/Conf/Utils render via DefaultRoot (colored by cosmos's tokens.css), while
// cosmos.css makes that shell see-through so the fixed starfield shows in the gaps. The Fleet is cosmos's
// signature surface: the bespoke ORBITAL FleetView (C2) is injected via DefaultRoot's `bodies` body-override
// map (D35 §F0 — the generalized replacement for the old single-purpose `Fleet` prop; theme-pinning-as-data,
// NOT a Surface graduation) — the rest of the Kit is reused unchanged. Honors the global `ui.appbarMode`
// lever (all themes). cosmos omits `defaultLayout`/`layouts`, so it defaults to 4-tab and supports all.
export function CosmosRoot() {
  const appbarMode = useUISlice((s) => s.appbarMode);
  return (
    <>
      <CosmosStarfield />
      {/* The orbital Fleet stays cosmos's signature view. Since A4, DefaultRoot OWNS the plan composition
          (the `planPlacement` setting picks inline pill+sheet vs. the pinned panel) — cosmos defaults to
          `inline`, so this is render-identical to the old explicit `composerSlots={kitPlanComposerSlots}`. */}
      {/* `kitBackground={false}`: cosmos HAS full-bleed scenery (the starfield above), and full-app
          scenery is exclusive by default (the Kit Art System / Codex A5) — the shared kit background layer
          would paint straight through this theme's deliberately transparent `.kit`. */}
      <DefaultRoot appbarMode={appbarMode} bodies={{ fleet: CosmosFleet }} kitBackground={false} />
    </>
  );
}
