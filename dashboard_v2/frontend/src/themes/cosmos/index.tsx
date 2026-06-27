// The cosmos theme module (D29 §14.4 — the deep-space / orbital-fleet theme, T4). A BESPOKE theme: later
// slices give it its own Root with a starfield + an orbital FleetView (via `present()`), but it REUSES the
// Kit's chrome/Agent/Conf/Utils bodies (under `.kit`), colored entirely by its tokens.css — so cosmos =
// "Kit-reused everything + a bespoke orbital Fleet". C0 ships the palette + the scaffold (CosmosRoot →
// DefaultRoot); `present` + the Fleet land in C2.
//
// CSS + fonts are LAZY (loaded by switchTheme before the skin flips); dark-only for now (deep space).

import type { ThemeDef } from "../../theme-engine/types";
import { CosmosRoot } from "./CosmosRoot";
import { loadFonts } from "./fonts";

export const cosmos: ThemeDef = {
  id: "cosmos",
  label: "Cosmos",
  Root: CosmosRoot,
  // Dark-only for now; 4 named accent swatches (the prototype's --acc indirection). The Conf Appearance
  // picker auto-renders these as color chips via the shared Swatches component (planet-coin gradients).
  palettes: {
    modes: ["dark"],
    defaultMode: "dark",
    accents: [
      { id: "violet", label: "Violet", swatch: "radial-gradient(circle at 33% 28%, #d7d0ff, #7b66f0)" },
      { id: "cyan", label: "Cyan", swatch: "radial-gradient(circle at 33% 28%, #e0fbff, #56cfee)" },
      { id: "green", label: "Green", swatch: "radial-gradient(circle at 33% 28%, #d9fbe9, #4fd6a0)" },
      { id: "amber", label: "Amber", swatch: "radial-gradient(circle at 33% 28%, #ffe6ad, #ff9433)" },
    ],
    defaultAccent: "violet",
  },
  loadStyles: () => import("./tokens.css"),
  loadFonts,
  // `present` (per-host orbital encoding, §9.9) + the bespoke FleetView land in C2.
};
