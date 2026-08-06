// The theme × mode × accent matrix the WCAG contrast gate covers (§14.15.1 item 8). Mirrored from the
// registry palettes as a PLAIN data list because importing the registry into Playwright drags the whole app
// graph — each theme's `index.tsx` does a lazy `import("./…Root")`, and tsc/node follow it into css/`virtual:`
// modules the e2e config has no ambients for. Instead this list is a single source shared by the contrast
// spec AND a DRIFT GUARD in tests/theme-engine/themeContract.test.ts, which imports the real registry and
// asserts this matches `registeredThemes()` palettes exactly — so it can never silently drift (item 8: "a
// hand-duplicated palette table needs a drift meta-test").
//
// vapor WAS waived (CONTRACT_WAIVERS.vapor ⊇ ["semantic-tokens"]): its accents ride the shared
// body[data-accent] axis since D51 V2, but over a non-contract token vocabulary, so it still isn't the
// surface the Kit contrast gate measures — it contributed no rows here.
//
// vapor JOINED at D51 V3 (2026-08-01), when `themes/vapor/tokens.css` landed and the `semantic-tokens`
// waiver retired: its three accents now resolve the same semantic contract every other skin does, so the
// WCAG gate measures them. At D51 V4 the DefaultRoot pivot gave it real kit chrome, so its `kitShell: false`
// line went with the `kit-structure` waiver (they were drift-guarded as a pair) — vapor is now swept by
// e2e/kit-render.spec.ts like every other theme, and NO row here carries the flag.

export interface ThemeMatrix {
  theme: string;
  modes: string[]; // a single-mode theme lists its one implicit mode
  accents: string[]; // accent ids, in palette order
  // The on-bar section ids under the theme's DEFAULT layout (D35 §F0) — the tab buttons the kit-render sweep
  // drives. Today every theme defaults to `4-tab` → all four; a future theme with a 3-/2-tab default lists
  // fewer here (utils/conf move off-bar into Conf/the menu). Drift-guarded against the registry-resolved bar
  // in tests/theme-engine/themeContract.test.ts, so a `defaultLayout` change breaks the GUARD, not the sweep.
  bar: string[];
  /** An optional PER-THEME SETTINGS SEED (D52 G6): the `ui.themeSettings[<theme>]` overrides this row is
   *  probed under. It exists because a theme can own a palette axis of its own — gacha's dossier picker
   *  (`body[data-gc-dossier]`, seven options) re-tints a whole surface without touching mode or accent, so
   *  before this the harness had NO WAY TO EXPRESS it and four of five palettes went unmeasured.
   *
   *  The rows deliberately do NOT form a product: §4.4's "Gate coverage" ruling is 7 accent rows (dossier
   *  at its default) + 7 dossier rows (accent at its default) + bounded cross-axis pairs, not a 7x7 matrix
   *  — the only paints that vary on BOTH axes are the sheet's top strip, the star badge and slip's sticker
   *  button, and those are covered by pairs rather than by combinations.
   *
   *  Drift-guarded in tests/theme-engine/themeContract.test.ts: every seeded key must be a declared `seg`
   *  setting of that theme and every value one of its declared options. */
  settings?: Record<string, string>;
  /** `false` while a theme still ships BESPOKE chrome (= CONTRACT_WAIVERS "kit-structure"): the kit-render
   *  sweep waits on `.kit-appbar`, which such a theme never renders, so it skips those rows. The
   *  TOKEN-level gate (contrast.spec) still runs — it only needs <body> + `#app-scroll`. Omitted = true,
   *  which is EVERY row today (vapor's `false` retired with its waiver at D51 V4). Kept as the seam for a
   *  future bespoke-chrome theme, and drift-guarded against CONTRACT_WAIVERS in
   *  tests/theme-engine/themeContract.test.ts — the flag and the waiver must always agree. */
  kitShell?: boolean;
}

const FULL_BAR = ["fleet", "agent", "utils", "conf"]; // the 4-tab default every theme carries today

export const CONTRAST_MATRIX: ThemeMatrix[] = [
  {
    theme: "minimal",
    modes: ["dark", "light"],
    accents: ["cyan", "moss", "iris", "amber"],
    bar: FULL_BAR,
  },
  {
    theme: "cosmos",
    modes: ["dark"],
    accents: ["violet", "cyan", "green", "amber"],
    bar: FULL_BAR,
  },
  {
    // frontier defaults to 3-tab (D35), so utils is HOSTED in Conf → off-bar (FULL_BAR doesn't apply): the
    // on-bar set is fleet/agent/conf. Drift-guarded against the registry-resolved default-layout bar.
    theme: "frontier",
    modes: ["dark", "light"],
    accents: ["coral", "amber", "magenta", "violet"],
    bar: ["fleet", "agent", "conf"],
  },
  {
    // vapor: no mode axis (dark-only) → its one implicit mode; three accents on the shared
    // body[data-accent] axis (D51 V2), all measured against themes/vapor/tokens.css (V3). Kit-shelled
    // since V4 (DefaultRoot hosting), so it sweeps like the rest — no `kitShell` flag.
    theme: "vapor",
    modes: ["dark"],
    accents: ["dark", "aqua", "ember"],
    bar: FULL_BAR,
  },
  {
    // gacha (D52 G6): dark-only, SEVEN accents on the shared body[data-accent] axis. Like frontier it
    // defaults to 3-tab (the prototype's Fleet/Agent/Settings shape), so utils is hosted in Conf → off-bar.
    // No `settings` seed → the theme's own default dossier palette (`neon-purple`) is what these seven rows
    // are measured under, which is the §4.4 "7 accent rows, dossier at default" half of the promise.
    theme: "gacha",
    modes: ["dark"],
    accents: ["arcade", "midnight", "indigo", "ember", "glacier", "nebula", "eridu"],
    bar: ["fleet", "agent", "conf"],
  },
];

/** The extra rows the ACCENT-cross-MODE product cannot express: a theme's own palette axis, seeded through
 *  `ThemeMatrix.settings` (D52 G6, §4.4 "Gate coverage"). Each is the theme's DEFAULT accent + one value of
 *  its private axis — the other half of "7 accent rows + 7 dossier rows" (§4.4 ruled five; G6.1
 *  appended two).
 *
 *  Kept as a separate export rather than folded into `CONTRAST_MATRIX` because that list has three other
 *  consumers (the kit-render sweep's `bar`, and two drift guards that assert it equals the registry's
 *  palettes exactly) — a settings row is not a palette row and must not appear in those. */
export const SETTINGS_MATRIX: ThemeMatrix[] = [
  // gacha's DOSSIER picker (§4.4 family 3). `neon-purple` is the theme default and is therefore already
  // covered by the seven accent rows above, so it is NOT repeated here — these are the other six (G6.1
  // appended cyber-teal + forest-green, which the coverage guard in themeContract.test.ts demands).
  ...["slip", "sunset-orange", "rose-pink", "aurora-violet", "cyber-teal", "forest-green"].map(
    (p) => ({
      theme: "gacha",
      modes: ["dark"],
      accents: ["arcade"], // the default accent: the dossier rows vary ONE axis at a time
      bar: ["fleet", "agent", "conf"],
      settings: { dossierPalette: p },
    }),
  ),
];
