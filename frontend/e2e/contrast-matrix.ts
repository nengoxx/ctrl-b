// The theme × mode × accent matrix the WCAG contrast gate covers (§14.15.1 item 8). Mirrored from the
// registry palettes as a PLAIN data list because importing the registry into Playwright drags the whole app
// graph — each theme's `index.tsx` does a lazy `import("./…Root")`, and tsc/node follow it into css/`virtual:`
// modules the e2e config has no ambients for. Instead this list is a single source shared by the contrast
// spec AND a DRIFT GUARD in tests/theme-engine/themeContract.test.ts, which imports the real registry and
// asserts this matches `registeredThemes()` palettes exactly — so it can never silently drift (item 8: "a
// hand-duplicated palette table needs a drift meta-test").
//
// vapor is WAIVED (CONTRACT_WAIVERS.vapor ⊇ ["semantic-tokens","accent-axis"]): its accent rides
// body[data-theme] over a non-contract token vocabulary, so it isn't the surface the Kit contrast gate
// measures — it contributes no rows here (the drift guard skips waived themes too).

export interface ThemeMatrix {
  theme: string;
  modes: string[]; // a single-mode theme lists its one implicit mode
  accents: string[]; // accent ids, in palette order
  // The on-bar section ids under the theme's DEFAULT layout (D35 §F0) — the tab buttons the kit-render sweep
  // drives. Today every theme defaults to `4-tab` → all four; a future theme with a 3-/2-tab default lists
  // fewer here (utils/conf move off-bar into Conf/the menu). Drift-guarded against the registry-resolved bar
  // in tests/theme-engine/themeContract.test.ts, so a `defaultLayout` change breaks the GUARD, not the sweep.
  bar: string[];
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
];
