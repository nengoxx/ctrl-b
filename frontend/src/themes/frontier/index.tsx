// The frontier theme module (T5, D29 §14.4 — the Mœbius badlands-comic western, night/day). A BESPOKE theme:
// later slices give it its own bespoke surfaces (the badlands Fleet MAP via `present()` in F2, the
// floating-rig Agent in F4), but it REUSES the Kit's chrome/Agent/Conf/Utils bodies (under `.kit`), colored
// entirely by its tokens.css. FRONTIER_PLAN.md is the plan; F1 = the shell reskin (the Kit reused wholesale
// under the frontier tokens + the live-rig brand subtitle).
//
// CSS + fonts are LAZY (loaded by switchTheme before the skin flips); night (dark) + day (light) modes.

import { outlinesSetting } from "../../theme-engine/kit/axes";
import { planPlacementSetting } from "../../theme-engine/kit/composer/plan/placement";
import { composerLayoutSetting } from "../../theme-engine/kit/composer/setting";
import { preloadableRoot } from "../../theme-engine/lazyRoot";
import type { ThemeDef } from "../../theme-engine/types";
import { assets } from "./art";
import { loadFonts } from "./fonts";
import { present } from "./present";

// Code-split the Root so a non-frontier user never bundles frontier's presentation (esp. the bespoke
// Fleet/Agent surfaces landing F2/F4); `loadRoot` (= preload) warms the chunk in switchTheme before the skin
// flips. `preloadableRoot` renders synchronously once loaded → no one-tick Suspense flash inside the
// View-Transition flushSync (see lazyRoot.ts). Only the descriptor below stays in the initial bundle.
const { Root, preload } = preloadableRoot(() =>
  import("./FrontierRoot").then((m) => ({ default: m.FrontierRoot })),
);

export const frontier: ThemeDef = {
  id: "frontier",
  label: "Frontier",
  Root,
  loadRoot: preload,
  // Two axes the Conf Appearance picker auto-renders: a Night/Day mode toggle + 4 named accent swatches. The
  // swatches are the prototype's picker GRADIENTS (the cosmos gradient-swatch precedent — a swatch is DATA
  // for the chip, not a token); the applied --accent is a flat literal per body[data-accent] (tokens.css).
  palettes: {
    modes: ["dark", "light"],
    defaultMode: "dark",
    accents: [
      { id: "coral", label: "Coral", swatch: "linear-gradient(150deg, #ff9d7a, #ff6f7d)" },
      { id: "amber", label: "Amber", swatch: "linear-gradient(150deg, #ffd27a, #ffb24c)" },
      { id: "magenta", label: "Magenta", swatch: "linear-gradient(150deg, #ff8fc0, #d65a9c)" },
      { id: "violet", label: "Violet", swatch: "linear-gradient(150deg, #c0a8ff, #9a7bf0)" },
    ],
    defaultAccent: "coral",
  },
  // Two stylesheets: the token map (semantic contract) + frontier's bespoke structural CSS (the dusk-glow
  // page background + the gradient brand mark). frontier is a BESPOKE theme → entitled to structural CSS
  // beyond tokens (the cosmos.css/vapor.css escape hatch); both are @scope([data-skin=frontier]) @layer theme.
  loadStyles: () => Promise.all([import("./tokens.css"), import("./frontier.css")]),
  loadFonts,
  // Per-theme settings (§14.3), auto-rendered in the Appearance picker.
  //  - composer (Surface, D31/A3) → the shared layout catalog; FIRST so it reads above theme-specific rows.
  //  - planPlacement (D31/A4) → the shared inline/pinned catalog (default inline = the composer pill+sheet).
  settings: {
    composer: composerLayoutSetting("stacked"),
    planPlacement: planPlacementSetting("inline"),
    // Outlines axis (Slice A) — frontier defaults OFF: its F4 look IS the no-outlines chat (the borderless
    // bubbles/plan/priv chrome now lives in kit/axes.css, keyed on body[data-outlines]). The toggle lets the
    // owner restore the Kit's resting borders live.
    outlines: outlinesSetting(false),
  },
  // Section-layout capability (D35 §F0): frontier DEFAULTS to `3-tab` (utils hosted in Conf) and declares NO
  // `layouts` field, so ALL presets stay on offer — the D35 ideal ("themes default, never restrict"; vapor's
  // `["4-tab"]` waiver is the only restriction).
  defaultLayout: "3-tab",
  // Per-host badlands-MAP encoding (§9.9) — R2-scattered beacon position + indexed rig art + plate. The
  // bespoke FrontierFleet (F2, injected via FrontierRoot → DefaultRoot's `fleet` slot) consumes it.
  present,
  // The art manifest (eager `import.meta.glob` URL map, §9.3) — frontier's map/rig/rig-stack PNGs by name.
  assets,
};
