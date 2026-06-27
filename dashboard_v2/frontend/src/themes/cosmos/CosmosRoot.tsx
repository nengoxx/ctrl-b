import { DefaultRoot } from "../../theme-engine/kit/DefaultRoot";
import { useUISlice } from "../../store/ui";

// cosmos's Root (D29 §14.4 / §14.13). C0 SCAFFOLD: cosmos is a bespoke theme, but for now its presentation
// IS the Kit scaffold — so the whole app renders in the cosmos palette (the reused chrome/Agent/Conf/Utils,
// colored by cosmos's tokens.css). Later slices replace this with a bespoke Root that layers the starfield
// (C1) and the orbital FleetView via DefaultRoot's `Fleet` slot (C2) while still reusing the Kit bodies.
// Honors the global `ui.hideAppbar` lever (all themes); motion uses the global Appearance toggle.
export function CosmosRoot() {
  const hideAppbar = useUISlice((s) => s.hideAppbar);
  return <DefaultRoot hideAppbar={hideAppbar} />;
}
