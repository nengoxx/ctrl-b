import { DefaultRoot } from "../../theme-engine/kit/DefaultRoot";
import { useUISlice } from "../../store/ui";
import { CosmosStarfield } from "./CosmosStarfield";

// cosmos's Root (D29 §14.4 / §14.13). C1: a BESPOKE Root that layers the deep-space starfield behind the
// REUSED Kit shell — the chrome/Agent/Conf/Utils render via DefaultRoot (colored by cosmos's tokens.css),
// while cosmos.css makes that shell see-through so the fixed starfield canvas shows in the gaps. The Fleet
// is still the Kit's default device list; the bespoke ORBITAL FleetView (via DefaultRoot's `Fleet` slot)
// + per-host `present()` land in C2. Honors the global `ui.hideAppbar` lever (all themes).
export function CosmosRoot() {
  const hideAppbar = useUISlice((s) => s.hideAppbar);
  return (
    <>
      <CosmosStarfield />
      <DefaultRoot hideAppbar={hideAppbar} />
    </>
  );
}
