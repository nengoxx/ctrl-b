import { useLayoutEffect } from "react";

import { focalPosition } from "../../lib/focalPosition";
import { DefaultRoot } from "../../theme-engine/kit/DefaultRoot";
import { useKitBackgroundArt } from "../../theme-engine/kit/ownerArt";
import { useThemeSetting } from "../../theme-engine/settings";
import { useUISlice } from "../../store/ui";
import { GACHA_COPY } from "./copy";
import { GachaAgent } from "./GachaAgent";
import { GachaFleet } from "./GachaFleet";
import { GachaReel } from "./GachaReel";
import { fleetSurface } from "./fleetSurface";
import { wallpaperArt } from "./roster";
import { useGachaRoster } from "./useGachaRoster";

// gacha's Root ("Capsule Arcade", D52 / GACHA_PLAN §3). A scaffold Root at G0: it maps the arcade palette
// onto the REUSED Kit shell (DefaultRoot, colored by gacha's tokens.css) and fills the appbar brand slots
// the theme's identity needs — the gradient katakana WORDMARK (`brandText`, the §4.3 ruling) and the
// Japanese subtitle (`brandMeta`, ネットワーク景品所). The subtitle is TOGGLE-GATED, not unconditional: the
// kit renders it only under the synced "Bar subtitle" switch, which ships OFF (the refined G6.3 ruling,
// owner 2026-08-06 — icon + title only by default, the line available to whoever wants it). gacha passes it
// always; the owner's one switch decides, for every theme at once. The bespoke Fleet (G1) and Agent (G3) bodies arrive through DefaultRoot's
// `bodies` override map; the reel overlay (G0's mechanism) mounts as a Root SIBLING after DefaultRoot.
// Honors the global `ui.appbarMode` lever (all themes). gacha omits `layouts` (offers every preset) and
// declares `defaultLayout: "3-tab"` (registry) — the prototype's own Fleet/Agent/Settings shape.
//
// The SEVEN cosmetic axes are applied as body ATTRS (the MinimalRoot/VaporRoot precedent: settings →
// pre-paint body attr → CSS), not as props: they change how things LOOK, never what is rendered. Every one
// is cleared on unmount so a switched-to skin can never inherit gacha's stale attrs (the §10.5 switch-out
// cleanup ledger — `applyBodyAttrs` doesn't own these). The sixth, `data-gc-fleet`, is the RESOLVED fleet
// layout: it is the hook the pickup banner's per-layout SKIN keys off, and the banner lives above the fleet
// body, so a body-scoped prop could never have reached it. The seventh, `data-gc-banner`, is the resolved
// PICKUP BANNER form, and it is the one axis with a non-cosmetic twin: the CSS it carries is purely a look
// (the strip geometry under `minimal`, the track head's top space under `off`), but the `off` value is ALSO
// read in `GachaFleet`, where it unmounts the banner outright. Two readers of ONE validated setting — the
// `fleetLayout` shape exactly — never two sources of truth.
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
  // The NAME FACE (the R17 rider) — a fourth body ATTR on exactly the terms of the three above: it changes
  // which face the machine name is SET IN on the dossier, never what is rendered, so it is a CSS axis
  // (`body[data-gc-namefont]`) rather than a prop threaded into a body. `mincho` is the theme's own serif
  // and stamps a value no tokens.css block matches — the `slip` idiom: the default IS the base
  // declaration, and the two alternates are one block each.
  const nameFont = useThemeSetting<string>("gacha", "nameFont");
  // …and the CARD name face (owner 2026-08-07, the per-surface split): the same role for the capsule
  // plate, landed as its own attr because the two surfaces are now independently pickable. Identical
  // mechanism, opposite default — `bungee` is this axis's base declaration, so it is the value that
  // stamps an attr no tokens.css block matches.
  const cardNameFont = useThemeSetting<string>("gacha", "cardNameFont");
  // The RESOLVED fleet layout, as a sixth body attr (§12.6 ruling 7). It is stamped — rather than passed —
  // for the same reason the five above are: the rules that key on it live OUTSIDE the variant's own render
  // (today: the poster's head/seam spacing in gacha.css; the owner REVERTED the banner skin and page ground
  // that first motivated it, so the banner renders identically under every layout — do not re-dress it).
  // Read through the Surface's own resolver at RENDER time (never at module scope — surface.ts's
  // import-cycle rule), so it is the same validated value `Themed` renders and the two cannot disagree.
  const fleetLayout = fleetSurface.useVariantId();
  // …and the RESOLVED banner form, as the seventh (§12.6 ruling 6). Stamped rather than passed for the
  // same reason `data-gc-fleet` is: its consumers are rules on boxes OUTSIDE the variant's own render —
  // the flow-seated banner itself, and the capsule track's head, whose top space is the banner's absence.
  // `useThemeSetting` validates against the declared options, so only `on`/`minimal`/`off` can ever be
  // stamped, and it is the SAME resolution `GachaFleet` reads for the unmount — one setting, one resolver,
  // two consumers that cannot disagree.
  const bannerMode = useThemeSetting<string>("gacha", "banner");
  // The fleet wallpaper's resolved art (M10), through the theme's ONE art seam (G5). THREE rungs since
  // G6.3: a `wallpaper:` pin naming a character, else the SHARED kit background, else the bundled scene —
  // gacha's own `wallpaper/` drop folder was removed at the same ruling, so the shared one is the drop-in
  // home. The kit rung comes from the kit's own hook (one shared `["media","kit"]` query, so this costs
  // no extra request) and is passed IN, because the resolver is pure. The layout effect below depends on
  // the two VALUES rather than the object, so a re-fetch that resolves to the same art cannot re-stamp
  // `body` for nothing.
  const art = wallpaperArt(useGachaRoster(), useKitBackgroundArt());
  // PAINT-READY from the resolver (D65 defect #1, and its S2 review rider #8): `ResolvedArt.url` already
  // carries its `?rev=` — the wallpaper is a background with no element to re-key, so an in-place
  // overwrite must move the URL or the stale decode survives the repair, and the ladder is where that is
  // spelled ONCE. Stamping again here would give the same bytes a second cache key.
  const artUrl = art.url;
  // THE ONE SURFACE THAT CANNOT MEASURE ITSELF, and the recorded degrade §5 names for exactly it: the
  // backdrop is a `background-image` on `.kit-main` — a node `DefaultRoot` owns and this component has no
  // ref to — so a focal point here is resolved with NO box and falls back to PROPORTIONAL alignment (the
  // subject roughly over there, rather than centred). It is a weaker promise, it is visible, and it is the
  // right trade here: this surface paints under `--gc-wallpaper-scrim`, which is between 72% and fully
  // opaque over the picture. A bundled entry's hand-tuned string is unaffected — proportional is what it
  // already meant — so the shipped paint is byte-identical. (The recorded fix, if the owner ever wants it:
  // a ref threaded from `DefaultRoot`, i.e. a kit-layer seam, not a gacha edit.)
  const artFocus = art.focus === undefined ? undefined : focalPosition(art.focus, null);

  useLayoutEffect(() => {
    const b = document.body;
    b.dataset.wallpaper = wallpaper ? "on" : "off";
    b.dataset.oracle = oracle ? "fade" : "scroll";
    b.dataset.gcDossier = dossier;
    b.dataset.gcNamefont = nameFont;
    b.dataset.gcCardnamefont = cardNameFont;
    b.dataset.gcFleet = fleetLayout;
    b.dataset.gcBanner = bannerMode;
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
      delete b.dataset.gcNamefont;
      delete b.dataset.gcCardnamefont;
      delete b.dataset.gcFleet;
      delete b.dataset.gcBanner;
      b.style.removeProperty("--gc-wallpaper-img");
      b.style.removeProperty("--gc-wallpaper-pos");
    };
  }, [
    wallpaper,
    oracle,
    dossier,
    nameFont,
    cardNameFont,
    fleetLayout,
    bannerMode,
    artUrl,
    artFocus,
  ]);

  return (
    <>
      <DefaultRoot
        appbarMode={appbarMode}
        // gacha's own WALLPAPER is the full-app scenery here (published as `--gc-wallpaper-img` above), so
        // the theme does not mount the shared kit background LAYER — scenery is exclusive by default (A5),
        // and the sibling reel overlay is one of the shapes `.kit`'s mounted-layer isolation would trap.
        // G6.3 does not change that; it changes what the wallpaper RESOLVES to. `media/kit/background/`
        // is now gacha's drop-in rung (above), so one shared drop dresses gacha too — painted by gacha's
        // surface, under gacha's own switch, rather than by a second layer or a second folder.
        kitBackground={false}
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
