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

/** One accent chip: the variant's radial crown, then its brand trio. See the `accents` note below for why
 *  these are literals rather than `var(--gc-brand-fill)`, and `gachaChrome.test.ts` for the guard that
 *  keeps each chip's trio equal to the palette block it previews. */
const rampSwatch = (crown: string, [b1, b2, b3]: readonly string[]): string =>
  `linear-gradient(135deg, ${crown} 0 34%, ${b1} 34%, ${b2} 67%, ${b3})`;
/** Family 1 (arcade · midnight · indigo) keeps the brand trio — only the base ramp moves. */
const arcadeTrio = ["#ff6cae", "#805cff", "#54e5ff"] as const;

export const gacha: ThemeDef = {
  id: "gacha",
  label: "Gacha",
  Root,
  loadRoot: preload,
  // Dark-only, EIGHT accents (§4.4 as amended at the 2026-08-06 G6 pre-build rulings — all four family-2
  // shifter candidates kept, "a bunch of variety could be good"): family 1 re-tints only the base ramp
  // (arcade · midnight · indigo, the brand trio constant), family 2 moves the trio too (ember · glacier ·
  // nebula · eridu · jade). Each id is one `body[data-accent]` block in tokens.css and one row in
  // e2e/contrast-matrix.ts.
  //
  // JADE is G6.2 (owner, 2026-08-06 night): family 1's three "read too similar" — they share the trio BY
  // DESIGN — so the eighth is a GREEN-leaning family-2 variant, the app-wide cousin of the forest-green /
  // cyber-teal dossier palettes. Its derivation record (the hue walk, the gold/warn clearances and the
  // status-chrome carve-out it fires) is the comment on its tokens.css block.
  //
  // THE SWATCHES ARE LITERALS, and that is a deliberate REVERSAL of the Codex-G0 #4 note that used to sit
  // here. Reading `var(--gc-brand-fill)` previewed the ACTIVE accent — correct while there was exactly one,
  // and wrong with eight: every chip in the picker would show whichever palette is currently applied, so
  // the control could not preview what it picks. So each chip re-states its own trio, vapor's literal
  // gradient-string idiom (themes/vapor/index.tsx). The values are DATA in TS, not CSS, so gacha's
  // no-literal-colors stylelint fence — which governs the theme's .css files — is untouched; the risk the
  // old note guarded against (a chip drifting from the token) is covered by a unit test that reads
  // tokens.css and asserts every chip still names its palette's own three brand hexes.
  palettes: {
    modes: ["dark"],
    defaultMode: "dark",
    accents: [
      // Each chip is ITS OWN radial-crown stop for the first third, then its own trio: family 1's three
      // share the brand trio and differ only in the ramp, so a trio-only chip would draw three identical
      // circles; family 2's differ in both. One chip, both halves of what a variant actually changes.
      //
      // `accent` is the G6.3 addition (owner ruling 2026-08-06 device round): the OVAL chip's right band,
      // and it is the variant's flat `--accent` — the hue every switch, ring and fill in the app takes.
      // The gradient alone could not say it: family 1's three share their trio BY DESIGN, so their chips
      // differ only in the crown, and `--accent` is `var(--gc-brand-1)` for all three — the band is what
      // makes "these three keep the pink accent, ember takes the orange one" visible in the picker.
      // LITERALS, exactly like the trios above and for the same reason (`var(--accent)` would preview the
      // ACTIVE palette on all eight chips). Each is the value its `body[data-accent]` block in tokens.css
      // resolves `--accent` to: family 1 inherits the base `--gc-brand-1`, family 2 redefines it.
      {
        id: "arcade",
        label: "Arcade",
        swatch: rampSwatch("#3a205b", arcadeTrio),
        accent: "#ff6cae",
      },
      {
        id: "midnight",
        label: "Midnight",
        swatch: rampSwatch("#1d2450", arcadeTrio),
        accent: "#ff6cae",
      },
      {
        id: "indigo",
        label: "Indigo",
        swatch: rampSwatch("#26377f", arcadeTrio),
        accent: "#ff6cae",
      },
      {
        id: "ember",
        label: "Ember",
        swatch: rampSwatch("#5b2350", ["#ff6f52", "#ff4f93", "#c46bff"]),
        accent: "#ff6f52",
      },
      {
        id: "glacier",
        label: "Glacier",
        swatch: rampSwatch("#1d3f7a", ["#7c6cff", "#2fb8ff", "#79f2e6"]),
        accent: "#7c6cff",
      },
      {
        id: "nebula",
        label: "Nebula",
        swatch: rampSwatch("#43276b", ["#eb77ea", "#9c96f4", "#5ec7db"]),
        accent: "#eb77ea",
      },
      {
        id: "eridu",
        label: "Eridu",
        swatch: rampSwatch("#26305e", ["#3a86ff", "#2fd8f5", "#3fe9bd"]),
        accent: "#3a86ff",
      },
      {
        id: "jade",
        label: "Jade",
        swatch: rampSwatch("#0e5546", ["#5bae49", "#2fbc8d", "#06c5bf"]),
        accent: "#5bae49",
      },
    ],
    defaultAccent: "arcade",
  },
  // Two stylesheets: the token map (semantic contract) + gacha's bespoke structural CSS (the app backdrop,
  // the brand wordmark, the nav sub-label). Both are @scope([data-skin=gacha]) @layer theme.
  loadStyles: () => Promise.all([import("./tokens.css"), import("./gacha.css")]),
  // The COMMITTED subsets (§10.4) — see fonts.ts. Awaited by `ensureThemeLoaded` before the skin flips.
  loadFonts,
  // Per-theme settings (§14.3), auto-rendered by the Conf Appearance picker in DECLARATION order — which
  // is the whole reason THE DOSSIER PICKER LEADS (owner ruling, the 2026-08-06 G6 device round: "they go
  // hand in hand"). The Appearance group renders the accent Palette row and then this map, so declaring
  // `dossierPalette` first is what puts the two colour pickers ADJACENT — the only two controls in the
  // group that pick a palette, and the pair the owner tunes together. The shared kit axes follow (composer
  // pair still adjacent, the round-2 convention), then gacha's own remaining three.
  settings: {
    // THE DOSSIER PALETTE (§4.4 family 3 / THE PICKER CONTRACT, G6). The dark trial is signed off AS A
    // PICKER, not a flip: `slip` — the shipped G2 light sheet — survives as an option, which is what
    // dissolved the "one light surface is the identity" objection. Default `neon-purple`, the owner's own
    // pick ("the first top-left image… I like the button there"). The value lands on `body[data-gc-dossier]`
    // (GachaRoot) and every option except slip is one tokens.css block; slip is the ABSENCE of one.
    //
    // The `swatch` per option is the §4.9 ledger's additive seg slot, and each value is the thing the
    // option most visibly changes: a dark palette's ACTION-FILL start (the button the owner picked this
    // set for), and slip's paper top. Literals for the same reason the accent chips are — seven rows, one
    // active palette; `var()` would draw the active one seven times.
    //
    // G6.1 appended the two COOL palettes (cyber-teal · forest-green) from the same example sheet: the
    // shipped four are magenta/orange/rose/violet, i.e. the whole cool half of the wheel was unoccupied,
    // and these are the two remaining panels furthest from it (≥91° LCh hue clearance, where amber-gold's
    // fill sits 15° from sunset-orange's and midnight-blue's 31° from aurora-violet's).
    dossierPalette: {
      type: "seg",
      label: "Dossier",
      desc: GACHA_COPY.settingDossierDesc,
      options: [
        { val: "slip", label: "Slip", swatch: "#f9f8ff" },
        { val: "neon-purple", label: "Neon", swatch: "#511cab" },
        { val: "sunset-orange", label: "Sunset", swatch: "#d97943" },
        { val: "rose-pink", label: "Rose", swatch: "#da7b7a" },
        { val: "aurora-violet", label: "Aurora", swatch: "#7e37a5" },
        { val: "cyber-teal", label: "Teal", swatch: "#007c8c" },
        { val: "forest-green", label: "Forest", swatch: "#337848" },
      ],
      default: "neon-purple",
    },
    // THE NAME FACE (the R17 rider, owner 2026-08-06 — declared second so the two IDENTITY pickers sit
    // together, right under the accent Palette row the group opens with). It sets the face for the
    // MACHINE NAME on the DOSSIER — the sheet's `h2` — and deliberately not the banner/promo titles,
    // which are the ROSTER's copy rather than a machine's. It started as one face on BOTH name-carrying
    // surfaces; the owner's 2026-08-07 ruling split them, and the capsule plate is `cardNameFont` below.
    //
    // A PICKER rather than a token default because the owner tried the alternative live and ruled on it:
    // Bungee "reads too bulky as a default", so it stays on offer and `mincho` — the theme's own Shippori
    // serif, now UPRIGHT (R17: the italic was a synthetic shear of a face that publishes no italic) —
    // remains the shipped look. Same mechanism as `dossierPalette` above, end to end: the value lands on
    // `body[data-gc-namefont]` (GachaRoot) and each option is a tokens.css block declaring the pair
    // `--gc-name-font` / `--gc-name-weight`; `mincho` is the ABSENCE of one (slip's precedent — it is the
    // `:scope` base). No `swatch`: these options differ by SHAPE, and a colour chip would say nothing —
    // the labels are the preview, and the surfaces re-render live.
    nameFont: {
      type: "seg",
      label: "Name face",
      desc: GACHA_COPY.settingNameFontDesc,
      options: [
        { val: "mincho", label: "Mincho" },
        { val: "bungee", label: "Bungee" },
        { val: "maru", label: "Zen Maru" },
      ],
      default: "mincho",
    },
    // THE CARD NAME FACE (owner 2026-08-07) — the same role on the OTHER surface that prints a machine's
    // name, declared immediately after its sibling so the identity pickers stay one block. The owner ruled
    // the two surfaces apart at the device round: the cards want Bungee's arcade signage over art, the
    // dossier wants whatever `nameFont` says (maru, at the time of the ruling). One shared `--gc-name-*`
    // pair cannot express that, so the plate carried a PINNED `font-family: "Bungee"` as the owner-ruled
    // interim — and this axis is the clean shape that pin was written to anticipate. It dissolves here.
    //
    // Default `bungee` because that is what the pin shipped, and a picker must not move the look it is
    // extracted from. Which makes the DEFAULT the absence of a block on this axis: the `:scope` base
    // declares the Bungee pair and each of the other two is one `body[data-gc-cardnamefont]` block —
    // `mincho`'s idiom on the sibling axis, one value over (slip's precedent, three axes deep now).
    //
    // Same three options as `nameFont`, and deliberately not a superset: the values name FACES, the
    // tokens.css blocks are per-value, and `fonts.ts` warms per-value across both axes from ONE map. A
    // fourth face is one entry in each of those three places, for both surfaces at once.
    cardNameFont: {
      type: "seg",
      label: "Card face",
      desc: GACHA_COPY.settingCardNameFontDesc,
      options: [
        { val: "mincho", label: "Mincho" },
        { val: "bungee", label: "Bungee" },
        { val: "maru", label: "Zen Maru" },
      ],
      default: "bungee",
    },
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
    // ── gacha's own remaining three (§6.1 / R6) — the fourth, the dossier picker, leads the map above ──
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
