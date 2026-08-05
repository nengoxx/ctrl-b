// The gacha theme module ("Capsule Arcade", D52 — Phase 17 / GACHA_PLAN). The FIFTH built kit theme and the
// first built from a finished standalone prototype rather than an in-repo variation: a gacha-capsule prize
// parlour over the fleet, with a Japanese identity (katakana wordmark, JP nav sub-labels, serif accents).
//
// A BESPOKE theme: G1/G3 give it its own Fleet (capsule track + pickup banner + dossier) and Agent (the
// oracle header) bodies, but it REUSES the Kit's chrome/Conf/Utils under `.kit`, colored entirely by its
// tokens.css. G0 = registration + palette + the shell, so every gate runs against the theme from day one.
//
// CSS + fonts are LAZY (loaded by switchTheme before the skin flips); dark-only — the dossier's light sheet
// (G2) is a SURFACE, not a mode (a light MODE would additionally owe an explicit `--accent-ink`).

import { composerSkinSetting, outlinesSetting } from "../../theme-engine/kit/axes";
import { planPlacementSetting } from "../../theme-engine/kit/composer/plan/placement";
import { composerLayoutSetting } from "../../theme-engine/kit/composer/setting";
import { preloadableRoot } from "../../theme-engine/lazyRoot";
import type { ThemeDef } from "../../theme-engine/types";
import { assets } from "./art";
import { GACHA_COPY } from "./copy";
import { loadFonts } from "./fonts";

// Code-split the Root so a non-gacha user never bundles gacha's presentation (the bespoke Fleet/Agent
// surfaces + the reel overlay); `loadRoot` (= preload) warms the chunk in switchTheme before the skin flips.
// `preloadableRoot` renders synchronously once loaded → no one-tick Suspense flash inside the View-Transition
// flushSync (see lazyRoot.ts). Only the descriptor below stays in the initial bundle.
const { Root, preload } = preloadableRoot(() =>
  import("./GachaRoot").then((m) => ({ default: m.GachaRoot })),
);

export const gacha: ThemeDef = {
  id: "gacha",
  label: "Gacha",
  Root,
  loadRoot: preload,
  // Dark-only. ONE accent today: §4.4 rules five palette variants (arcade · midnight · indigo + two
  // accent-shifting picks) but they stay UNEXPOSED until G6 — declaring them early would put empty chips in
  // the owner's picker and rows in the e2e contrast matrix for tokens that don't exist yet. The swatch is the
  // prototype's own 92° brand gradient (the cosmos/frontier "a swatch is DATA for the chip" precedent).
  palettes: {
    modes: ["dark"],
    defaultMode: "dark",
    accents: [
      // The swatch READS THE TOKEN rather than re-typing the trio's hexes (Codex G0 #4): the chip is an
      // inline background on an element inside gacha's own `@scope`, so `var()` resolves there — and the
      // picker then previews the live brand identity instead of a copy that can silently drift from it.
      { id: "arcade", label: "Arcade", swatch: "var(--gc-brand-fill)" },
    ],
    defaultAccent: "arcade",
  },
  // Two stylesheets: the token map (semantic contract) + gacha's bespoke structural CSS (the app backdrop,
  // the brand wordmark, the nav sub-label). Both are @scope([data-skin=gacha]) @layer theme.
  loadStyles: () => Promise.all([import("./tokens.css"), import("./gacha.css")]),
  // The COMMITTED subsets (§10.4) — see fonts.ts. Awaited by `ensureThemeLoaded` before the skin flips.
  loadFonts,
  // Per-theme settings (§14.3), auto-rendered by the Conf Appearance picker in DECLARATION order: the shared
  // kit axes first (composer pair adjacent, the round-2 convention), then gacha's own three.
  settings: {
    composer: composerLayoutSetting("stacked"),
    // The prototype's composer is a flat, opaque panel with a hairline edge, tight corners and no shadow
    // at all — measured against every existing skin at G3, four of its five defining properties differ
    // from the closest (`outline`), so the CATALOG gained the look-named `arcade` value (D37: composer
    // chrome is a SHARED catalog value, never theme CSS) and gacha declares it as its default.
    composerSkin: composerSkinSetting("arcade"),
    planPlacement: planPlacementSetting("inline"),
    // The prototype's chat bubbles are borderless (fill + a hard offset shadow, no outline), so gacha takes
    // the kit's no-outlines chat; the toggle restores the bordered chrome live. Confirmed at the G3 eyeball.
    outlines: outlinesSetting(false),
    // ── gacha's own three (§6.1 / R6) ──
    // The star ladder's SINGLE config home (council M5: nothing star-shaped lives in the roster YAML).
    // Default 5★ (ruled Q8.4): emma already carries 5–6 configured services, so the flagship rolls a full
    // row on day one; 3★ is one seg-tap away for a calmer track.
    // Every non-ASCII string below comes from `copy.ts` — the descriptors are production copy, so their
    // glyphs must ride the frozen subset (★ U+2605 is in no Latin subset; Codex G0 #1).
    starMode: {
      type: "seg",
      label: "Stars",
      desc: GACHA_COPY.settingStarsDesc,
      options: [
        { val: "five", label: GACHA_COPY.starModeFive },
        { val: "three", label: GACHA_COPY.starModeThree },
      ],
      default: "five",
    },
    // R6 — both ship ON, flipping the prototype's own OFF defaults (owner-ruled).
    wallpaper: {
      type: "switch",
      label: "Banner wallpaper",
      desc: GACHA_COPY.settingWallpaperDesc,
      default: true,
    },
    oracle: {
      type: "switch",
      label: "Sticky operator art",
      desc: GACHA_COPY.settingOracleDesc,
      default: true,
    },
  },
  // Section-layout capability (D35 §F0): the prototype is a THREE-tab design (Fleet / Agent / Settings), so
  // gacha DEFAULTS to `3-tab` (utils hosted in Conf) — without this it would boot into the kit's 4-tab
  // default, the wrong navigation shape. No `layouts` restriction: every preset stays on offer (the D35
  // ideal every registered theme follows), and the JP sub-label for Utils exists precisely so the 4-tab
  // preset is a real, complete look rather than a fallback.
  defaultLayout: "3-tab",
  // Owner art (G5 / §5.4's ruled option (b)): the owner drops files into `$CTRLB_HOME/media/gacha/<role>/`
  // from any machine and the folder IS the assignment. Only the LINK lives here — the roles, their gallery
  // copy, the pins and the advisory bounds are the `theme-engine/mediaRegistry` row (D53 §5's inversion:
  // a namespace need not belong to a theme, so the registry is where they all live).
  media: { ns: "gacha" },
  // The bundled art manifest (the eager `import.meta.glob` URL map, §9.3) — the DEFAULT roster the theme
  // resolves against until G5's owner directory exists, keyed by bare filename.
  assets,
};
