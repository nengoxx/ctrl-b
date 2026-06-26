// The vapor theme module (Phase 11 v2 / D29). vapor is a normal theme now (no longer "frozen +
// separate") — it owns its whole presentation via `VaporRoot` and stays the DEFAULT until each other
// theme is verified. Its CSS is loaded eagerly (theme/index.css, the default — see §14.6), so
// `loadStyles` is a no-op; its fonts come from index.html. Palette = the named accents (dark/aqua/
// ember) on the `body[data-theme]` axis; no `mode` axis (vapor is dark-only).

import type { ThemeDef } from "../../theme-engine/types";
import { VaporRoot } from "./VaporRoot";

export const vapor: ThemeDef = {
  id: "vapor",
  label: "Vapor",
  Root: VaporRoot,
  palettes: {
    accents: [
      { id: "dark", label: "Vapor" },
      { id: "aqua", label: "Aqua" },
      { id: "ember", label: "Ember" },
    ],
    defaultAccent: "dark",
  },
  loadStyles: () => Promise.resolve(), // vapor.css is eager (the default theme), already loaded
};
