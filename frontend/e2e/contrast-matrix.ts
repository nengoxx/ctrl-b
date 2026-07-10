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
}

export const CONTRAST_MATRIX: ThemeMatrix[] = [
  { theme: "minimal", modes: ["dark", "light"], accents: ["cyan", "moss", "iris", "amber"] },
  { theme: "cosmos", modes: ["dark"], accents: ["violet", "cyan", "green", "amber"] },
];
