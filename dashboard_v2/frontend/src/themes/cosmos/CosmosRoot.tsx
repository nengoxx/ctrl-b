import { DefaultRoot } from "../../theme-engine/kit/DefaultRoot";
import { useUISlice } from "../../store/ui";
import { CosmosFleet } from "./CosmosFleet";
import { CosmosStarfield } from "./CosmosStarfield";

// cosmos's Root (D29 §14.4 / §14.13). A BESPOKE Root that layers the deep-space starfield (C1) behind the
// REUSED Kit shell — Agent/Conf/Utils render via DefaultRoot (colored by cosmos's tokens.css), while
// cosmos.css makes that shell see-through so the fixed starfield shows in the gaps. The Fleet is cosmos's
// signature surface: the bespoke ORBITAL FleetView (C2) is passed into DefaultRoot's `Fleet` slot — the
// rest of the Kit is reused unchanged. Honors the global `ui.hideAppbar` lever (all themes).
export function CosmosRoot() {
  const appbarMode = useUISlice((s) => s.appbarMode);
  return (
    <>
      <CosmosStarfield />
      <DefaultRoot appbarMode={appbarMode} Fleet={CosmosFleet} />
    </>
  );
}
