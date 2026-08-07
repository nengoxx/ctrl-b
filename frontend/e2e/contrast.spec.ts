import { calcAPCA } from "apca-w3";
import { rgb, wcagContrast } from "culori";

import { CONTRAST_MATRIX, SETTINGS_MATRIX } from "./contrast-matrix";
import { expect, test } from "./fixtures";

// The WCAG contrast GATE (§14.15.1 item 8 · §14.15.1-A ⑧ settled). This RIDES the existing e2e suite (the
// `--e2e` release gate), NOT a new Playwright project — a project would re-run the axe scans per theme×mode×
// accent (combinatorial). It boots the REAL built app per palette combo and measures COMPUTED colors, because
// jsdom/culori can't replay the @layer/@scope/body-formula cascade and a hand-kept palette table would be a
// second source of truth (both rejected in ⑧).
//
// THE PROBE-ELEMENT TECHNIQUE (the verified CSSOM gotcha): `getComputedStyle(el).getPropertyValue("--x")`
// returns the AUTHORED var chain (e.g. `oklch(var(--accent-l) …)`), not a concrete color. So instead we set a
// token onto a REAL property of a probe div and read the computed value back — the engine resolves oklch()/
// color-mix()/relative-color to concrete rgb strings, which we parse with culori on the Node side. The probe
// property is the `background` SHORTHAND (not `color` — fixed 2026-07-16): a token may be an <image> under
// the §14.15.1-⑨ two-channel contract (K2's gradient `--accent-fill`), which is invalid for `color:` and
// silently devolves to the inherited text color; through `background` a flat token lands in backgroundColor
// and a gradient in backgroundImage, whose stops are gated individually (worst stop wins).
//
// GATES (WCAG 2.1, FAIL the spec) + APCA (advisory, report-only, never gates — ⑧).

// ── The matrix — expanded from CONTRAST_MATRIX (the shared list the jsdom drift guard verifies against the
//    registry palettes). minimal → dark+light × 4 hues (8); cosmos → dark × 4 accents (4); frontier →
//    dark+light × 4 (8); vapor → dark × 3 accents (3, joined at D51 V3 with themes/vapor/tokens.css —
//    it has bespoke chrome but the probe only needs <body> + `#app-scroll`, both of which VaporRoot has). ──
interface Combo {
  theme: string;
  mode: string;
  accent: string;
  /** Per-theme settings this combo is probed under (D52 G6) — see `ThemeMatrix.settings`. */
  settings?: Record<string, string>;
}

const COMBOS: Combo[] = [...CONTRAST_MATRIX, ...SETTINGS_MATRIX].flatMap((t) =>
  t.modes.flatMap((mode) =>
    t.accents.map((accent) => ({ theme: t.theme, mode, accent, settings: t.settings })),
  ),
);

/** A combo's human name — the test title AND the failure prefix. */
const comboId = (c: Combo): string =>
  `${c.theme} ${c.mode}/${c.accent}` +
  (c.settings
    ? ` [${Object.entries(c.settings)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")}]`
    : "");

// Token pairs to gate. `fg`/`bg` are semantic tokens; `min` is the WCAG 2.1 floor for that role (4.5:1 for
// body text / ink on fill; 3:1 for large/secondary/status affordances). All are resolved via the probe.
interface Pair {
  fg: string;
  bg: string;
  min: number;
  /** BAND-SAMPLE mode (D52 §4.4's own gate method, learned the hard way). The default rule gates every
   *  stop of a gradient `bg` — right when the ink runs edge to edge, wrong when the ink is a CENTRED label
   *  on a two-stop fill: there the text never touches the extremes, and gating them failed four dossier
   *  palettes spuriously. With `band`, a gradient `bg` contributes the MIDPOINT of its stop list instead —
   *  the band the label actually covers. Flat `bg` tokens are unaffected either way. */
  band?: boolean;
  /** THE BACKDROP STACK for a TRANSLUCENT token (D52 G6.3). Gacha's dark dossier cards became translucent
   *  LIFTS over the sheet gradient — which is the mock's own construction, and it means the colour a user
   *  sees is not the token: it is the token composited over whatever is under it. `wcagContrast` reads a
   *  colour's alpha as opaque, so an un-composited probe would measure `rgb(171 145 253)` — a light
   *  lavender — where the screen shows near-black, and every pair on that card would go blind.
   *
   *  Each entry is one LAYER *under `bg`*, bottom-first; each layer lists the alternative tokens that can
   *  be there (a sheet spans two stops, so the layer names both), and the WORST resulting composite gates —
   *  the same "worst stop wins" discipline the gradient handling already uses, one dimension further. The
   *  bottom layer must be opaque. A translucent `fg` is then flattened over the flattened `bg`, which is
   *  exactly where it is painted (gacha's Shut-down outline is a color-mix with the card, so it inherits
   *  the card's alpha). */
  over?: string[][];
}
const PAIRS: Pair[] = [
  { fg: "--accent-ink", bg: "--accent-fill", min: 4.5 }, // ink on the accent-filled controls (item ①)
  { fg: "--text", bg: "--surface", min: 4.5 }, // body text on cards
  { fg: "--text", bg: "--bg", min: 4.5 }, // body text on the page
  { fg: "--text-2", bg: "--surface", min: 3 }, // secondary text on cards
  { fg: "--ok", bg: "--surface", min: 3 }, // status affordances on cards
  { fg: "--warn", bg: "--surface", min: 3 },
  { fg: "--danger", bg: "--surface", min: 3 },
];

/** The sheet stops gacha's dossier CARD is painted over (D52 G6.3) — see the `over` doc + the card-stack
 *  note on the pairs below for why `--gc-dossier-from` is not among them. */
const CARD_UNDER = ["--gc-dossier-mid", "--gc-dossier-to"];
/** THE DOT TEXTURE (G6.5, Codex's G6.4 contrast finding). `.bs-sheet::after` paints a 1px white dot on a
 *  13px grid ABOVE the sheet's own gradient and BELOW everything in `.gc-dossier` — so it is a layer in
 *  every dossier stack, and the pairs that were gated straight on a sheet stop or on the card were reading
 *  a backdrop that does not exist on screen (neon's `ink-2` measured 5.02 that way and 4.07 in truth).
 *  The token is an `<image>`, so `colorsOf` hands back BOTH of its stops and the worst wins: that worst is
 *  a full-strength dot, i.e. the gate models the pixel a glyph edge can land on rather than the field's
 *  average. Slip's texture is `none` ⇒ a transparent layer ⇒ the whole stack is a no-op there, exactly as
 *  its opaque card already made the layer below it one. */
const TEXTURE = ["--gc-dossier-texture"];
/** THE CHARACTER WATERMARK, as THREE modelled bands — see the tokens' own derivation for why white, why a
 *  token, and where each transmission was measured on the shipped render. `--gc-dossier-mark-head` is the
 *  full owner knob (the band the close disc sits in); the other two are the mask's weaker tail over the
 *  metric tiles, at the VALUE row (0.66) and the CAPTION row (0.26) respectively. All three are `0`-alpha
 *  on slip.
 *
 *  THE VALUE/CAPTION SPLIT IS G6.8 (Codex wave-12 #1, a DO-NOT-SHIP): one shared token carrying the
 *  caption's 0.26 was gating both tile inks, so the 16px VALUE text — 21px higher, under 2.5x more art —
 *  was measured against a backdrop 6.4 points of alpha weaker than the one it is painted on. A palette
 *  could clear the gate while the real metric row failed, which is the false-pass direction. */
const MARK_HEAD = ["--gc-dossier-mark-head"];
const MARK_VALUE = ["--gc-dossier-mark-value"];
const MARK_CAPTION = ["--gc-dossier-mark-caption"];
/** The dossier CARD stacks, bottom-first. `CARD_STACK` is a card-bearing block CLEAR of the watermark
 *  (the action bar at 224px and the service rows below it, against a 210px mark); the two GRID stacks are
 *  the metric tiles, which are not (152-224px) — one per tile ROW, because the mask's transmission changes
 *  across them. Text painted straight on the sheet takes none of them — see the pairs. */
const CARD_STACK = [CARD_UNDER, TEXTURE];
const VALUE_STACK = [CARD_UNDER, TEXTURE, MARK_VALUE];
const CAPTION_STACK = [CARD_UNDER, TEXTURE, MARK_CAPTION];

/** THEME-SPECIFIC pairs beyond the kit's semantic set — surfaces only that theme paints, gated at the
 *  same floors. Gacha's UNIT DOSSIER (G2) is the theme's ONE light surface: its tokens are gacha-private
 *  (`--gc-*`, resolvable only inside the theme's @scope — hence the probe mounting in `#app-scroll`,
 *  the vapor-tokens.spec precedent), but the sheet is body text + affordances like any other surface. */
const THEME_PAIRS: Record<string, Pair[]> = {
  gacha: [
    // THE CARD STACK (G6.3, deepened at G6.5): the metric tiles / service rows / secondary button are a
    // translucent lift over the sheet, and the sheet under them runs from `--gc-dossier-mid` (its 30% knee)
    // down to `--gc-dossier-to`. `--gc-dossier-from` is deliberately NOT in the stack: no card-bearing block
    // exists in the sheet's top 30% — the head (portrait + kicker + name + role line) occupies all of it, in
    // the mock and in our own layout — so naming it here would gate these pairs against a backdrop they
    // never touch. The DOT TEXTURE sits between the sheet and the card (see `TEXTURE`), and the METRIC TILES
    // sit over the watermark's tail on top of that (`VALUE_STACK`/`CAPTION_STACK`, one per tile row)
    // while every other card-bearing block
    // clears it. Slip's card is opaque, so all three stacks are a no-op there.
    //
    // `ink` and `ink-2` on the card are gated at their own TILE ROW because the tiles are their worst home:
    // the same two tokens paint the service rows and the button labels one layer down (no watermark), so
    // the tighter row covers both rather than duplicating every pair per block. The two rows take DIFFERENT
    // stacks — `ink` paints the 16px values at the mask's 0.66 band, `ink-2` the captions at its 0.26 band
    // (G6.8; sharing the caption's band under-modelled the values by 6.4 points of alpha).
    { fg: "--gc-dossier-ink", bg: "--gc-dossier-card", min: 4.5, over: VALUE_STACK }, // metric values, row names, button labels
    { fg: "--gc-dossier-ink-2", bg: "--gc-dossier-card", min: 4.5, over: CAPTION_STACK }, // metric captions + service ports — small text
    // ── TEXT PAINTED STRAIGHT ON THE SHEET (the head: title, role line, kicker, name). These rows are
    // gated on the sheet STOP, with NO texture and NO watermark layer, and the line is deliberate.
    // `over` models a BACKDROP — what shows THROUGH a translucent token — which is exactly what the dot
    // field is for a card (it is under it) and exactly what it is NOT for the head's glyphs: there the dots
    // and the art are painted straight ONTO the sheet, a 1px dot per 13px tile and a masked picture over
    // the head's right-hand zone, i.e. a RENDERED-PIXEL question — and this theme already has an
    // owner-signed answer for it: the G6.4 role-line trade, where the art stays at the owner's 0.16 and the
    // text takes a sheet-coloured halo instead. Modelling either here would re-open that ruling and would
    // demand near-white inks and kickers on five palettes to pass (measured, texture alone: neon ink-2
    // 3.77 · sunset 3.81 + kicker 3.79 · rose 3.84 · aurora 3.82 + kicker 3.98 · forest 3.95 — it is an
    // open main-seat question in §7.7's G6.5 addendum, not an oversight). The metric grid gets the
    // watermark layer because there the art is under a TRANSLUCENT card — a true backdrop — with no halo
    // and no ruling.
    { fg: "--gc-dossier-ink", bg: "--gc-dossier-from", min: 4.5 }, // title on the sheet's top stop
    { fg: "--gc-dossier-ink", bg: "--gc-dossier-mid", min: 4.5 }, // …its 30% knee (G6.3)…
    { fg: "--gc-dossier-ink", bg: "--gc-dossier-to", min: 4.5 }, // …and its bottom stop
    { fg: "--gc-dossier-ink-2", bg: "--gc-dossier-from", min: 4.5 }, // the role line under the name
    { fg: "--gc-dossier-ink-2", bg: "--gc-dossier-mid", min: 4.5 },
    { fg: "--gc-dossier-ink-2", bg: "--gc-dossier-to", min: 4.5 },
    { fg: "--gc-dossier-kicker", bg: "--gc-dossier-from", min: 4.5 }, // the UNIT DOSSIER kicker
    { fg: "--gc-dossier-kicker", bg: "--gc-dossier-mid", min: 4.5 },
    { fg: "--gc-dossier-kicker", bg: "--gc-dossier-to", min: 4.5 },
    // The host NAME (G6.3) — 27px at weight 900 is WCAG LARGE text, so its floor is 3:1, not 4.5. It is
    // gated at all because the darks tint it toward their own palette instead of painting it white.
    { fg: "--gc-dossier-name", bg: "--gc-dossier-from", min: 3 },
    { fg: "--gc-dossier-name", bg: "--gc-dossier-mid", min: 3 },
    { fg: "--gc-dossier-name", bg: "--gc-dossier-to", min: 3 },
    // The SECONDARY (Shut down) pair — its label AND its outline. The outline became a token at G6
    // precisely so it could be gated: as an inline color-mix it was invisible here. At G6.3 that mix has a
    // TRANSLUCENT second term on the darks (the card), so the outline itself is translucent and rides the
    // same stack — one layer further down than its own background. The action bar starts 224px into the
    // dossier against a 210px watermark, so this block takes the card stack, not the grid's.
    { fg: "--gc-dossier-accent", bg: "--gc-dossier-card", min: 4.5, over: CARD_STACK },
    { fg: "--gc-dossier-act-line", bg: "--gc-dossier-card", min: 3, over: CARD_STACK },
    // The PRIMARY's label over the band it actually covers (band-sample — the label is centred).
    { fg: "--gc-dossier-act-ink", bg: "--gc-dossier-act-fill", min: 4.5, band: true },
    // The service LED, both states. Non-text affordances, and on a port-bearing row the ONLY visible
    // status cue — so the DIM state is gated at the same floor as the bright one, no exemption.
    { fg: "--gc-dossier-led", bg: "--gc-dossier-card", min: 3, over: CARD_STACK },
    { fg: "--gc-dossier-led-dim", bg: "--gc-dossier-card", min: 3, over: CARD_STACK },
    // ── THE HOVERED SERVICE ROW (G6.5). The rows became links at G6.4 and their hover swaps the row's
    // background for `--gc-dossier-row-hover` — a whole second backdrop that shipped ungated, on the
    // reasoning (recorded in the token, now retired) that a small accent mix moves less luminance than the
    // sheet gradient does. It does not: `color-mix` is premultiplied against an OPAQUE accent, so the mix
    // multiplies the card's alpha as well as tinting it, and every pair on the row rides it up.
    // Same four fg tokens the resting row carries — the name (`ink`), the port (`ink-2`) and both LED
    // states — over the same stack, because a hovered row is a resting row with one layer swapped.
    // The row's hover BORDER (`act-line`) is deliberately not a row here: it is the state CHANGE that
    // identifies the affordance, adjacent to the sheet on its outer edge as much as to the fill on its
    // inner one, and gating it against its own fill would pin the hover mix at a share too small to see.
    { fg: "--gc-dossier-ink", bg: "--gc-dossier-row-hover", min: 4.5, over: CARD_STACK },
    { fg: "--gc-dossier-ink-2", bg: "--gc-dossier-row-hover", min: 4.5, over: CARD_STACK },
    { fg: "--gc-dossier-led", bg: "--gc-dossier-row-hover", min: 3, over: CARD_STACK },
    { fg: "--gc-dossier-led-dim", bg: "--gc-dossier-row-hover", min: 3, over: CARD_STACK },
    // The close disc's glyph on its own disc (the pair that exists because the old composition inverted).
    // G6.4 THINNED the dark palettes' disc (the owner wanted the watermark to show through it; the
    // 2026-08-07 re-look thinned it further, 78%→55% of the badge — the token holds the current share),
    // so the disc joined the translucent club and needs its own backdrop stack — the sheet's TOP band, not
    // the card's: the corner sits in the head, above the 30% knee. G6.5 completes that stack with the two
    // layers the token's own derivation always named but the gate did not carry: the dot texture and a
    // full-strength watermark pixel (the head is where the mark's mask is solid). Slip's disc is opaque, so
    // the stack is a no-op there, exactly as it is for slip's card.
    {
      fg: "--gc-dossier-close-ink",
      bg: "--gc-dossier-close-bg",
      min: 4.5,
      over: [["--gc-dossier-from", "--gc-dossier-mid"], TEXTURE, MARK_HEAD],
    },
    // ── THE CAPSULE PLATE's CLIPPED NAME (C6, owner's pick 2026-08-06). The name is painted with
    // `--accent-fill` clipped to its glyphs, so the INK is the accent ramp — and `--gc-fill-spread` means
    // only the ramp's calm middle is ever visible, which is why the fg is `--gc-name-fill-window` (the
    // modelled slice) and not `--accent-fill` (two stops the glyphs cannot show). Both of its stops are
    // gated, worst wins, by the same <image> handling every gradient token here gets.
    //
    // THE BED is the card's own `--surface` — deliberately the scrim's TRANSPARENT end composited over the
    // card rather than its opaque one. The plate sits where the scrim is nearly solid (`#0a0817e6` at 92%),
    // which is DARKER and therefore kinder to a light accent ink; taking the light end is the conservative
    // direction. What is NOT modelled is the ARTWORK under the scrim — art is not a token (the boundary the
    // G6.5 addendum drew for the dossier head), and losing the plate's dark halo to the clip is precisely
    // the trade the owner picked C6 knowing.
    //
    // FLOOR: 3.0 (large text). The plate reads `--gc-card-name-weight` since the per-surface split
    // (owner 2026-08-07): the DEFAULT is now Bungee at 400, where a 20px pair/wide card's name is NOT
    // WCAG-large and its real floor is 4.5 — reported in §7.7 rather than gated here, because the
    // treatment and the face are both owner picks. Under the axis's mincho/maru (900) the 20px name is
    // ≥18.66px AND bold — WCAG large — and the feature card's 27px clears the ≥24px rule outright.
    { fg: "--gc-name-fill-window", bg: "--surface", min: 3 },
    // The two things the dossier surface reads off the OTHER axis — the bounded cross-axis checks (§4.4).
    // The star tab is GATED on every dossier sheet. The sheet's top brand STRIP is the other one, and it
    // is ADVISORY-ONLY — see THEME_ADVISORIES below for why a hard floor is not available to it.
    //
    // RE-STACKED at G7 (the R16 star redesign), and for the same reason G6.5 re-stacked everything else:
    // these two used to be measured against `--gc-dossier-badge`, the filled dark lozenge — a backdrop the
    // screen no longer paints. The lozenge is now a HAIRLINE TAB whose fill is `--gc-dossier-rar-bg`, the
    // sheet's own top stop at 72%, i.e. TRANSLUCENT — so the stars are painted over that mix composited
    // over the head band: the sheet's `from`→`mid` range, its dot texture, and a full-strength watermark
    // pixel. Exactly the close disc's stack one element over, because the two sit in the same band.
    //
    // NOT modelled, and recorded rather than hidden: the tab is deliberately off-centre, so roughly its
    // left half laps the PORTRAIT. Art is not a token and cannot be a layer (the same boundary the G6.5
    // addendum drew for the head's text over the watermark) — what carries the stars there is the drawn
    // star's own dark CONTOUR, which is R16 §2's whole point and is why the plaque could go.
    {
      fg: "--gc-star",
      bg: "--gc-dossier-rar-bg",
      min: 3,
      over: [["--gc-dossier-from", "--gc-dossier-mid"], TEXTURE, MARK_HEAD],
    },
    {
      fg: "--gc-star-hi",
      bg: "--gc-dossier-rar-bg",
      min: 3,
      over: [["--gc-dossier-from", "--gc-dossier-mid"], TEXTURE, MARK_HEAD],
    },
    // Slip's STICKER button is the paint that varies on both axes, so it is probed on every ACCENT row
    // too — it is the same `--accent-ink`/`--accent-fill` pair the kit set above already gates, which is
    // why no extra row is needed for it here.
  ],
};

/** An ADVISORY cross-axis probe: measured and ATTACHED to the report on every row of the theme, never
 *  gated. `fg` is read over each of `bgs` (every stop × every stop; worst wins).
 *
 *  Gacha's dossier top STRIP is the one paint that needs this. The strip is `--gc-brand-fill` — an ACCENT-
 *  axis token — laid over the sheet's own `--gc-dossier-from`/`-to` gradient, i.e. the two axes meet on it
 *  and neither owns both sides. A hard floor is therefore impossible BY DESIGN: making it pass would mean
 *  per-dossier normalisation of an accent token, which violates the write-disjointness rule the dossier
 *  blocks are built on (every declaration under `body[data-gc-dossier]` is a `--gc-dossier-*` name). It is
 *  also a 4px decorative band with no text and no state — nothing WCAG has a floor for. Slip ships at
 *  ~1.4 against its own top stop deliberately (a brand band that reads as part of the sheet, not a rule
 *  across it); whether any palette wants a louder strip is an owner device-round call, and the numbers
 *  this annotation prints are the input to it. */
interface Advisory {
  fg: string;
  bgs: string[];
}
const THEME_ADVISORIES: Record<string, Advisory[]> = {
  gacha: [{ fg: "--gc-brand-fill", bgs: ["--gc-dossier-from", "--gc-dossier-to"] }],
};

const pairsFor = (theme: string): Pair[] => [...PAIRS, ...(THEME_PAIRS[theme] ?? [])];
const advisoriesFor = (theme: string): Advisory[] => THEME_ADVISORIES[theme] ?? [];
const probeTokensFor = (theme: string): string[] => [
  ...new Set([
    ...pairsFor(theme).flatMap((p) => [p.fg, p.bg, ...(p.over ?? []).flat()]),
    ...advisoriesFor(theme).flatMap((a) => [a.fg, ...a.bgs]),
  ]),
];

/** WCAG 2.1 contrast ratio (1–21) between two concrete color strings, via culori. */
function wcag(a: string, b: string): number {
  return wcagContrast(a, b);
}
/** Normalize any CSS color (incl. `oklch()`/`color-mix()`) to a plain sRGB `rgb(r,g,b)` string via culori —
 *  apca-w3's parser only understands sRGB forms, so oklch tokens would otherwise read Lc 0. */
function toSrgb(color: string): string {
  const c = rgb(color);
  if (!c) return color;
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${to(c.r)}, ${to(c.g)}, ${to(c.b)})`;
}
/** APCA Lc (advisory, report-only) — signed lightness contrast; we report its magnitude. */
function apcaLc(text: string, bg: string): number {
  return Math.abs(Number(calcAPCA(toSrgb(text), toSrgb(bg))));
}

for (const c of COMBOS) {
  test(`contrast — ${comboId(c)}`, async ({ page }) => {
    // Seed the persisted UI blob BEFORE any page script (the flows.spec addInitScript pattern). `v:1` stamps
    // the current persisted-schema version so the migration chain is skipped and mode/accent apply directly.
    // `themeSettings` carries the row's own per-theme seed (D52 G6) through the SAME persisted key the app
    // reads, so the theme's Root stamps its private axis exactly as it would for the owner.
    await page.addInitScript(
      (ui) => {
        localStorage.setItem("ctrlb.ui", JSON.stringify(ui));
      },
      {
        theme: c.theme,
        mode: c.mode,
        accent: c.accent,
        tab: "fleet",
        v: 1,
        ...(c.settings ? { themeSettings: { [c.theme]: c.settings } } : {}),
      },
    );

    // ARM the appearance-reconcile wait BEFORE navigating (Codex F3). The assertion below proves the seed
    // SURVIVED that reconcile — but the reconcile is an async round-trip, so without this the assertion can
    // read `ctrlb.ui` in the window between boot and the response landing and pass on a race. The route is
    // mocked by the `mockApi` fixture, so the response always arrives.
    const appearanceDone = page.waitForResponse("**/api/appearance");
    await page.goto("/");
    await appearanceDone;

    // Wait until the theme's SCOPED tokens.css (@layer theme :scope) has applied — it sets `color-scheme`
    // on <html>, flipping the computed value off the "normal" default — AND the Kit Root has mounted.
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
      .not.toBe("normal");
    await page.waitForSelector("#app-scroll");

    // The seed's SURFACE must be stamped before anything is measured (Codex F3): `body[data-gc-dossier]`
    // is the selector tokens.css actually matches on, so a Root that failed to stamp it would leave this
    // row measuring the default palette. `toHaveAttribute` auto-waits, so the stamping layout effect is
    // free to land after the reconcile. (The full seed-SURVIVAL assertion runs AFTER the probes — see
    // below for why that placement is the race-free one.)
    if (c.settings) {
      for (const [k, v] of Object.entries(c.settings)) {
        if (k === "dossierPalette")
          await expect(page.locator("body")).toHaveAttribute("data-gc-dossier", v);
      }
    }

    // Probe: resolve each token to concrete color(s) by reading it back off a real CSS property.
    // TWO channels (the §14.15.1-⑨ two-channel contract, exercised by K2): a token may be a flat <color>
    // OR an <image> (frontier's gradient `--accent-fill`). `color: var(--x)` is INVALID for an <image> —
    // it silently devolves to the inherited text color (the pre-K2 probe measured ink-vs-ink and the gate
    // went blind on frontier, both modes). So resolve through the `background` shorthand instead: a flat
    // color lands in backgroundColor, a gradient in backgroundImage — whose computed value serializes its
    // stops as concrete rgb() strings we can extract.
    const resolved = await page.evaluate((names) => {
      const probe = document.createElement("div");
      // INSIDE the app subtree, not on <body>: theme-private tokens live under the theme's @scope, which
      // a body-level probe can sit outside of (the vapor-tokens.spec precedent). Kit tokens inherit down
      // regardless, so the kit pairs resolve identically from here.
      (document.querySelector("#app-scroll") ?? document.body).appendChild(probe);
      const out: Record<string, { bgImage: string; bgColor: string }> = {};
      for (const n of names) {
        probe.style.background = `var(${n})`;
        const cs = getComputedStyle(probe);
        out[n] = { bgImage: cs.backgroundImage, bgColor: cs.backgroundColor };
        probe.style.background = "";
      }
      probe.remove();
      return out;
    }, probeTokensFor(c.theme));

    // A token's concrete color list: a gradient contributes EVERY stop (each gated individually — for a
    // two-stop linear gradient the interpolated band sits between the endpoints, so the worst stop is the
    // worst point); a flat token contributes its one color.
    const colorsOf = (name: string): string[] => {
      const r = resolved[name];
      if (r.bgImage !== "none") {
        const stops = r.bgImage.match(/(?:rgba?|oklch|color)\([^)]*\)/g);
        expect(
          stops,
          `${name} resolved to an image with no parseable stops: ${r.bgImage}`,
        ).toBeTruthy();
        return stops as string[];
      }
      return [r.bgColor];
    };

    /** BAND-SAMPLE (§4.4's gate method): the single colour under a CENTRED label — the midpoint of the
     *  gradient's stops. sRGB channel-average, because a CSS gradient with no interpolation hint
     *  interpolates in sRGB, so for the two-stop fills this theme uses it IS the exact 50% colour. A flat
     *  token passes through untouched. */
    const bandOf = (stops: string[], token: string): string[] => {
      if (stops.length < 2) return stops;
      // FAIL LOUDLY rather than silently mis-measuring (Codex F4). The channel-average IS the 50% colour
      // only for a TWO-stop, unpositioned, sRGB-interpolated gradient — the shape every band-sampled token
      // has today. Give a third stop (or a positioned/hinted one) to the same average and the number it
      // returns is not the colour under the label any more, and the gate would keep passing on it.
      expect(
        stops.length,
        `band-sample assumes a two-stop unpositioned gradient — ${token} now has ${stops.length} stops; ` +
          `re-derive the band`,
      ).toBeLessThanOrEqual(2);
      const parsed = stops.map((s) => rgb(s)).filter((v) => v !== undefined);
      if (parsed.length < 2) return stops;
      const avg = (k: "r" | "g" | "b") => parsed.reduce((a, v) => a + v[k], 0) / parsed.length;
      return [toSrgb(`rgb(${avg("r") * 255}, ${avg("g") * 255}, ${avg("b") * 255})`)];
    };

    /** SOURCE-OVER composite of `top` onto the opaque `base`, in sRGB — what the screen shows when a
     *  translucent token is painted on something (D52 G6.3). An opaque `top` passes straight through, so
     *  every non-translucent token in the matrix is untouched by this. */
    const composite = (top: string, base: string): string => {
      const t = rgb(top);
      const b = rgb(base);
      if (!t || !b) return top;
      const a = t.alpha ?? 1;
      if (a >= 1) return top;
      const mix = (k: "r" | "g" | "b") => a * t[k] + (1 - a) * b[k];
      return toSrgb(`rgb(${mix("r") * 255}, ${mix("g") * 255}, ${mix("b") * 255})`);
    };
    /** Flatten a token's colours down a backdrop stack (bottom-first), keeping every combination — the
     *  worst of them is what gates, exactly as with gradient stops. */
    const flatten = (colors: string[], stack: string[][]): string[] => {
      let bases = stack.length ? stack[0].flatMap((n) => colorsOf(n)) : [];
      for (const layer of stack.slice(1))
        bases = layer.flatMap((n) =>
          colorsOf(n).flatMap((cc) => bases.map((b) => composite(cc, b))),
        );
      return bases.length ? colors.flatMap((cc) => bases.map((b) => composite(cc, b))) : colors;
    };

    for (const p of pairsFor(c.theme)) {
      // Gate the WORST fg-stop × bg-stop pairing (fg tokens are flat today; bg may be a gradient). A `bg`
      // with an `over` stack is flattened onto it first, and the fg onto the flattened bg (G6.3).
      const rawBg = p.band ? bandOf(colorsOf(p.bg), p.bg) : colorsOf(p.bg);
      const bgColors = p.over ? flatten(rawBg, p.over) : rawBg;
      let worst = { ratio: Infinity, fg: "", bg: "" };
      for (const fgRaw of colorsOf(p.fg))
        for (const bg of bgColors) {
          const fg = p.over ? composite(fgRaw, bg) : fgRaw;
          const ratio = wcag(fg, bg);
          if (ratio < worst.ratio) worst = { ratio, fg, bg };
        }
      const lc = apcaLc(worst.fg, worst.bg);
      // APCA is ADVISORY — attach to the report, never gate on it (⑧).
      test.info().annotations.push({
        type: "apca",
        description: `${comboId(c)}  ${p.fg}(${worst.fg}) vs ${p.bg}(${worst.bg})${p.band ? " [band]" : ""} → WCAG ${worst.ratio.toFixed(2)}:1 · APCA Lc ${lc.toFixed(1)}`,
      });
      expect(
        worst.ratio,
        `${comboId(c)}: ${p.fg} (${worst.fg}) vs ${p.bg} (${p.band ? "label band" : "worst stop"} ${worst.bg}) — WCAG ${worst.ratio.toFixed(2)}:1 < ${p.min}:1`,
      ).toBeGreaterThanOrEqual(p.min);
    }

    // The ADVISORY cross-axis probes — measured on the same resolved token set, attached to the report on
    // the SAME channel APCA uses, and never asserted (see `THEME_ADVISORIES` for why the strip has no
    // floor). Worst stop × worst stop, over every listed background token. NON-THROWING by contract
    // (Codex fix-set R2 #1): `colorsOf` asserts on an unparseable image and `wcag` can throw on a
    // malformed color — legitimate guards for the GATED pairs, but an advisory that can fail the run IS
    // a gate. An unresolvable advisory annotates itself as such instead.
    for (const a of advisoriesFor(c.theme)) {
      try {
        let worst = { ratio: Infinity, fg: "", bg: "", bgName: "" };
        for (const fg of colorsOf(a.fg))
          for (const bgName of a.bgs)
            for (const bg of colorsOf(bgName)) {
              const ratio = wcag(fg, bg);
              if (ratio < worst.ratio) worst = { ratio, fg, bg, bgName };
            }
        test.info().annotations.push({
          type: "strip-advisory",
          description: `${comboId(c)}  ${a.fg}(${worst.fg}) vs ${worst.bgName}(${worst.bg}) → WCAG ${worst.ratio.toFixed(2)}:1 · APCA Lc ${apcaLc(worst.fg, worst.bg).toFixed(1)}`,
        });
      } catch (err) {
        test.info().annotations.push({
          type: "strip-advisory",
          description: `${comboId(c)}  ${a.fg}: unresolved (${err instanceof Error ? err.message : String(err)})`,
        });
      }
    }

    // …and NOW prove the settings seed survived (D52 G6). The app reconciles its appearance against
    // `GET /api/appearance` on every load; a server doc with a real `updated_at` wins LWW and REPLACES
    // `themeSettings` wholesale — the seeded palette would be silently swapped for the theme's default
    // while the row kept passing. (Found live against the real dev backend.) The e2e mock is deliberately
    // unseeded (`updated_at: null`), so LOCAL holds — this asserts it still does. Placed AFTER the probes
    // on purpose (Codex fix-set R2 #3): awaiting the response alone does not order this against React
    // Query's reconcile write, and no observable sentinel exists when LOCAL wins — but from HERE, a wipe
    // that landed BEFORE the probes shows up as a wrong body attribute above, and a wipe that landed
    // after them still fails the row loudly, naming the fixture trap either way.
    if (c.settings) {
      const applied = await page.evaluate(
        (theme) =>
          (
            JSON.parse(localStorage.getItem("ctrlb.ui") ?? "{}") as {
              themeSettings?: Record<string, Record<string, unknown>>;
            }
          ).themeSettings?.[theme] ?? {},
        c.theme,
      );
      for (const [k, v] of Object.entries(c.settings)) {
        expect(
          applied[k],
          `${comboId(c)}: the seeded ${k}="${v}" did not survive the appearance reconcile — this row ` +
            `would be measuring the theme's DEFAULT, not the palette it names`,
        ).toBe(v);
      }
    }
  });
}
