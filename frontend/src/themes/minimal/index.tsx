// The minimal theme module (D29 §14.4 — the FIRST "reskin" theme + the Kit's first consumer). A calm,
// modern-minimalist skin (warm dark/light, one quiet OKLCH accent) ported from
// prototypes/project/variations/minimal.html. Unlike vapor (bespoke Root), minimal's whole presentation is
// the Kit's `DefaultRoot`; it supplies only a `tokens.css`, self-hosted fonts, a palette, and settings.
//
// CSS + fonts are LAZY (loaded by switchTheme before the skin flips); vapor stays the eager default.

import { composerSkinSetting, outlinesSetting } from "../../theme-engine/kit/axes";
import { planPlacementSetting } from "../../theme-engine/kit/composer/plan/placement";
import { composerLayoutSetting } from "../../theme-engine/kit/composer/setting";
import { preloadableRoot } from "../../theme-engine/lazyRoot";
import type { ThemeDef } from "../../theme-engine/types";
import { loadFonts } from "./fonts";

// Code-split the Root so a non-minimal user never bundles minimal's presentation; `loadRoot` (= preload)
// warms the chunk in switchTheme before the skin flips. `preloadableRoot` renders synchronously once
// loaded → no one-tick Suspense flash inside the View-Transition flushSync (see lazyRoot.ts). The
// descriptor below stays in the initial bundle (tiny: palettes/loaders); only the Root module splits out.
const { Root, preload } = preloadableRoot(() =>
  import("./MinimalRoot").then((m) => ({ default: m.MinimalRoot })),
);

export const minimal: ThemeDef = {
  id: "minimal",
  label: "Minimal",
  Root,
  loadRoot: preload,
  // Two axes the Conf Appearance picker auto-renders: a Dark/Light mode toggle + 4 OKLCH accent hues
  // (the mode×4-accent matrix is `--accent-l/-c` per mode × `--accent-h` per accent, in tokens.css).
  palettes: {
    modes: ["dark", "light"],
    defaultMode: "dark",
    // Swatches mirror each accent's hue but at a LEGIBLE chroma (~0.13) — the applied accent is
    // intentionally quiet (--accent-c 0.07, near-grey), so the picker boosts saturation purely so the four
    // hues are distinguishable as chips. Hues match the --accent-h matrix in tokens.css (195/155/280/60).
    accents: [
      { id: "cyan", label: "Cyan", swatch: "oklch(0.74 0.13 195)" },
      { id: "moss", label: "Moss", swatch: "oklch(0.74 0.13 155)" },
      { id: "iris", label: "Iris", swatch: "oklch(0.74 0.13 280)" },
      { id: "amber", label: "Amber", swatch: "oklch(0.78 0.13 60)" },
    ],
    defaultAccent: "cyan",
  },
  loadStyles: () => import("./tokens.css"),
  loadFonts,
  // Per-theme settings (§14.3), auto-rendered in the Appearance picker. ("Hide app bar" used to live here
  // but is now the GLOBAL `ui.hideAppbar` lever — all themes get it; see store/ui + ConfTab Appearance.)
  //  - composer (Surface, D31/A3) → the shared layout catalog; FIRST so it reads above theme-specific rows.
  //  - density (cosmetic) → body[data-density] → minimal's tokens.css scales --density-pad.
  settings: {
    composer: composerLayoutSetting("stacked"),
    planPlacement: planPlacementSetting("inline"),
    // Outlines axis (Slice A) — minimal leans on the Kit's bordered chat chrome, so it defaults ON; the
    // toggle offers the borderless look (kit/axes.css strips the chat borders under body[data-outlines=off]).
    outlines: outlinesSetting(true),
    // Composer-skin axis (Slice B) — minimal keeps the Kit's native bordered input bar → defaults `outline`;
    // the seg offers glass/bezel/sleek (kit.css chrome keyed on body[data-composer-skin]).
    composerSkin: composerSkinSetting("outline"),
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
