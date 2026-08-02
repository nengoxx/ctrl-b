import { useLayoutEffect } from "react";

import { DefaultRoot } from "../../theme-engine/kit/DefaultRoot";
import { useThemeSetting } from "../../theme-engine/settings";
import { useUISlice } from "../../store/ui";
import { GACHA_COPY } from "./copy";
import { GachaReel } from "./GachaReel";

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
export function GachaRoot() {
  const appbarMode = useUISlice((s) => s.appbarMode);
  // R6: both ship ON (the prototype defaults them OFF — a deliberate, owner-ruled flip).
  const wallpaper = useThemeSetting<boolean>("gacha", "wallpaper");
  const oracle = useThemeSetting<boolean>("gacha", "oracle");

  useLayoutEffect(() => {
    const b = document.body;
    b.dataset.wallpaper = wallpaper ? "on" : "off";
    b.dataset.oracle = oracle ? "fade" : "scroll";
    return () => {
      delete b.dataset.wallpaper;
      delete b.dataset.oracle;
    };
  }, [wallpaper, oracle]);

  return (
    <>
      <DefaultRoot
        appbarMode={appbarMode}
        brandText={<span className="gc-word">{GACHA_COPY.brandWordmark}</span>}
        brandMeta={GACHA_COPY.brandMeta}
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
