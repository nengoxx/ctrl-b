import { useLayoutEffect } from "react";

import { DefaultRoot } from "../../theme-engine/kit/DefaultRoot";
import { useThemeSetting } from "../../theme-engine/settings";
import { useUISlice } from "../../store/ui";
import { GACHA_COPY } from "./copy";
import { GachaFleet } from "./GachaFleet";
import { GachaReel } from "./GachaReel";
import { defaultRoster, wallpaperArt } from "./roster";

// gacha's Root ("Capsule Arcade", D52 / GACHA_PLAN §3). A scaffold Root at G0: it maps the arcade palette
// onto the REUSED Kit shell (DefaultRoot, colored by gacha's tokens.css) and fills the two appbar brand
// slots the theme's identity needs — the gradient katakana WORDMARK (`brandText`, the §4.3 ruling) and the
// Japanese subtitle (`brandMeta`). The bespoke Fleet (G1) and Agent (G3) bodies arrive through DefaultRoot's
// `bodies` override map; the reel overlay (G0's mechanism) mounts as a Root SIBLING after DefaultRoot.
// Honors the global `ui.appbarMode` lever (all themes). gacha omits `layouts` (offers every preset) and
// declares `defaultLayout: "3-tab"` (registry) — the prototype's own Fleet/Agent/Settings shape.
//
// The two cosmetic settings are applied as body ATTRS (the MinimalRoot/VaporRoot precedent: settings →
// pre-paint body attr → CSS), not as props: they change how things LOOK, never what is rendered. Both are
// cleared on unmount so a switched-to skin can never inherit gacha's stale attrs (the §10.5 switch-out
// cleanup ledger — `applyBodyAttrs` doesn't own these).
// The theme's composer addons. gacha fills exactly one field: the input's PLACEHOLDER, which the prototype
// writes in Japanese (index.html: `<input placeholder="コマンド入力…">`). It rides `composerSlots` rather
// than a new Root prop because that object IS the theme's channel into whichever composer VARIANT is active,
// so one string covers stacked/sheet/line with no per-variant table — and every other theme, filling nothing,
// keeps its variant's own default byte-for-byte.
//
// MODULE-LEVEL, not an inline literal: DefaultRoot memoizes the slot MERGE on this object's identity, and a
// fresh literal each render would re-merge (and re-render the composer) on every Root render for nothing.
const COMPOSER_SLOTS = { placeholder: GACHA_COPY.composerPlaceholder };

// The theme's bespoke section bodies (G1: Fleet; G3 adds Agent). MODULE-LEVEL for the same reason as the
// composer slots above: DefaultRoot merges this map over its defaults, and a fresh literal per render would
// rebuild the merge — and remount the body — on every Root render.
const BODIES = { fleet: GachaFleet };

// The fleet wallpaper's resolved art (M10). Module-level for the same reason `GachaFleet`'s roster is: until
// G5's media index lands the bundled default set cannot change at runtime, so resolving it once keeps the
// layout effect's dependency list honest (the attrs it stamps are the only things that vary).
const WALLPAPER = wallpaperArt(defaultRoster());

export function GachaRoot() {
  const appbarMode = useUISlice((s) => s.appbarMode);
  // R6: both ship ON (the prototype defaults them OFF — a deliberate, owner-ruled flip).
  const wallpaper = useThemeSetting<boolean>("gacha", "wallpaper");
  const oracle = useThemeSetting<boolean>("gacha", "oracle");

  useLayoutEffect(() => {
    const b = document.body;
    b.dataset.wallpaper = wallpaper ? "on" : "off";
    b.dataset.oracle = oracle ? "fade" : "scroll";
    // The fleet wallpaper's ART (M10). It is published as a custom property on `body` rather than rendered,
    // because the layer itself is a BACKGROUND on `.kit-main` — a node DefaultRoot owns — and a custom
    // property only reaches it from an ancestor. Same resolver as every other gacha surface, so a G5
    // `wallpaper:` pin moves this with everything else. The focal crop is set only when the entry declares
    // one; otherwise tokens.css's default (the prototype's own 56% 30%) stands.
    b.style.setProperty("--gc-wallpaper-img", `url("${WALLPAPER.url}")`);
    if (WALLPAPER.focus === undefined) b.style.removeProperty("--gc-wallpaper-pos");
    else b.style.setProperty("--gc-wallpaper-pos", WALLPAPER.focus);
    return () => {
      delete b.dataset.wallpaper;
      delete b.dataset.oracle;
      b.style.removeProperty("--gc-wallpaper-img");
      b.style.removeProperty("--gc-wallpaper-pos");
    };
  }, [wallpaper, oracle]);

  return (
    <>
      <DefaultRoot
        appbarMode={appbarMode}
        brandText={<span className="gc-word">{GACHA_COPY.brandWordmark}</span>}
        brandMeta={GACHA_COPY.brandMeta}
        composerSlots={COMPOSER_SLOTS}
        bodies={BODIES}
      />
      {/* The tab reel mounts as a Root SIBLING (the CosmosStarfield pattern) — AFTER DefaultRoot, because
          unlike the starfield it paints OVER the shell. Being outside `.kit` is what lets a
          `position: fixed` overlay escape the shell's overflow/isolation; gacha deliberately does NOT copy
          cosmos's `.kit { position: relative; z-index: 1 }` idiom, which would make `.kit` a stacking unit
          and lift the reel above the confirm/prompt modals (the §10.1 z-rung ruling: reel = 45). */}
      <GachaReel />
    </>
  );
}
