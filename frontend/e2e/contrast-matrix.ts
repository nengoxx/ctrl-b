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
// WCAG gate measures them. It still carries the `kit-structure` waiver (bespoke chrome, no `.kit` marker
// until the V4 DefaultRoot pivot) → `kitShell: false` keeps it out of the kit-render sweep only. BOTH
// retire at V4 (D51 §7 R25), not at the V6 tail.

export interface ThemeMatrix {
  theme: string;
  modes: string[]; // a single-mode theme lists its one implicit mode
  accents: string[]; // accent ids, in palette order
  // The on-bar section ids under the theme's DEFAULT layout (D35 §F0) — the tab buttons the kit-render sweep
  // drives. Today every theme defaults to `4-tab` → all four; a future theme with a 3-/2-tab default lists
  // fewer here (utils/conf move off-bar into Conf/the menu). Drift-guarded against the registry-resolved bar
  // in tests/theme-engine/themeContract.test.ts, so a `defaultLayout` change breaks the GUARD, not the sweep.
  bar: string[];
  /** `false` while the theme still ships BESPOKE chrome (= CONTRACT_WAIVERS "kit-structure"): the
   *  kit-render sweep waits on `.kit-appbar`, which such a theme never renders, so it skips those rows.
   *  The TOKEN-level gate (contrast.spec) still runs — it only needs <body> + `#app-scroll`. Omitted =
   *  true. Drift-guarded against CONTRACT_WAIVERS in tests/theme-engine/themeContract.test.ts: both flip
   *  together at **D51 V4**, when the DefaultRoot pivot gives vapor real kit chrome (drop this line and
   *  retire the waiver in the same commit — the guard fails until they agree). */
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
    // body[data-accent] axis (D51 V2), all measured against themes/vapor/tokens.css (V3).
    theme: "vapor",
    modes: ["dark"],
    accents: ["dark", "aqua", "ember"],
    bar: FULL_BAR,
    kitShell: false, // bespoke chrome until the V4 DefaultRoot pivot — no `.kit-appbar` to wait on;
    // delete this line at V4 together with the `kit-structure` waiver (they are drift-guarded as a pair)
  },
];
