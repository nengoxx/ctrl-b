import { useLayoutEffect } from "react";

import { DefaultRoot } from "../../theme-engine/kit/DefaultRoot";
import { useThemeSetting } from "../../theme-engine/settings";
import { useUISlice } from "../../store/ui";
import { GACHA_COPY } from "./copy";
import { GachaAgent } from "./GachaAgent";
import { GachaFleet } from "./GachaFleet";
import { GachaReel } from "./GachaReel";
import { wallpaperArt } from "./roster";
import { useGachaRoster } from "./useGachaRoster";

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

// The theme's bespoke section bodies (G1: Fleet; G3: Agent). MODULE-LEVEL for the same reason as the
// composer slots above: DefaultRoot merges this map over its defaults, and a fresh literal per render would
// rebuild the merge — and remount the body — on every Root render.
const BODIES = { fleet: GachaFleet, agent: GachaAgent };

export function GachaRoot() {
  const appbarMode = useUISlice((s) => s.appbarMode);
  // R6: both ship ON (the prototype defaults them OFF — a deliberate, owner-ruled flip).
  const wallpaper = useThemeSetting<boolean>("gacha", "wallpaper");
  const oracle = useThemeSetting<boolean>("gacha", "oracle");
  // The DOSSIER PALETTE (G6 / §4.4 family 3) — a third body ATTR on exactly the same terms as the two
  // above: it changes how the unit dossier LOOKS, never what is rendered, so it is a CSS axis
  // (`body[data-gc-dossier]`) and not a prop threaded down to GachaHostDetail. `useThemeSetting` validates
  // against the declared options, so a stale/corrupt synced value can only ever stamp a palette that
  // exists — and `slip` stamps a value no tokens.css block matches, which IS how slip is expressed.
  const dossier = useThemeSetting<string>("gacha", "dossierPalette");
  // The fleet wallpaper's resolved art (M10), through the theme's ONE art seam (G5): a `wallpaper:` pin,
  // else the owner's `media/gacha/wallpaper/` pick, else the bundled scene. The layout effect below
  // depends on the two VALUES rather than the object, so a re-fetch that resolves to the same art cannot
  // re-stamp `body` for nothing.
  const art = wallpaperArt(useGachaRoster());
  const artUrl = art.url;
  const artFocus = art.focus;

  useLayoutEffect(() => {
    const b = document.body;
    b.dataset.wallpaper = wallpaper ? "on" : "off";
    b.dataset.oracle = oracle ? "fade" : "scroll";
    b.dataset.gcDossier = dossier;
    // The fleet wallpaper's ART (M10). It is published as a custom property on `body` rather than rendered,
    // because the layer itself is a BACKGROUND on `.kit-main` — a node DefaultRoot owns — and a custom
    // property only reaches it from an ancestor. Same resolver as every other gacha surface, so a
    // `wallpaper:` pin moves this with everything else. The focal crop is set only when the entry declares
    // one; otherwise tokens.css's default (the prototype's own 56% 30%) stands.
    b.style.setProperty("--gc-wallpaper-img", `url("${artUrl}")`);
    if (artFocus === undefined) b.style.removeProperty("--gc-wallpaper-pos");
    else b.style.setProperty("--gc-wallpaper-pos", artFocus);
    return () => {
      delete b.dataset.wallpaper;
      delete b.dataset.oracle;
      delete b.dataset.gcDossier;
      b.style.removeProperty("--gc-wallpaper-img");
      b.style.removeProperty("--gc-wallpaper-pos");
    };
  }, [wallpaper, oracle, dossier, artUrl, artFocus]);

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
