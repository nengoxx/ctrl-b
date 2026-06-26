// The minimal theme module (D29 §14.4 — the FIRST "reskin" theme + the Kit's first consumer). A calm,
// modern-minimalist skin (warm dark/light, one quiet OKLCH accent) ported from
// prototypes/project/variations/minimal.html. Unlike vapor (bespoke Root), minimal's whole presentation is
// the Kit's `DefaultRoot`; it supplies only a `tokens.css`, self-hosted fonts, a palette, and settings.
//
// CSS + fonts are LAZY (loaded by switchTheme before the skin flips); vapor stays the eager default.

import type { ThemeDef } from "../../theme-engine/types";
import { loadFonts } from "./fonts";
import { MinimalRoot } from "./MinimalRoot";

export const minimal: ThemeDef = {
  id: "minimal",
  label: "Minimal",
  Root: MinimalRoot,
  // Two axes the Conf Appearance picker auto-renders: a Dark/Light mode toggle + 4 OKLCH accent hues
  // (the mode×4-accent matrix is `--accent-l/-c` per mode × `--accent-h` per accent, in tokens.css).
  palettes: {
    modes: ["dark", "light"],
    defaultMode: "dark",
    accents: [
      { id: "cyan", label: "Cyan" },
      { id: "moss", label: "Moss" },
      { id: "iris", label: "Iris" },
      { id: "amber", label: "Amber" },
    ],
    defaultAccent: "cyan",
  },
  loadStyles: () => import("./tokens.css"),
  loadFonts,
  // Per-theme settings (§14.3), auto-rendered in the Appearance picker:
  //  - hideAppbar (structural) → DefaultRoot drops the app bar.
  //  - density (cosmetic) → body[data-density] → minimal's tokens.css scales --density-pad.
  settings: {
    hideAppbar: {
      type: "switch",
      label: "Hide app bar",
      desc: "more screen for content",
      default: false,
    },
    density: {
      type: "seg",
      label: "Density",
      desc: "spacing of rows & cards",
      options: [
        { val: "comfortable", label: "Comfortable" },
        { val: "compact", label: "Compact" },
      ],
      default: "comfortable",
    },
  },
};
