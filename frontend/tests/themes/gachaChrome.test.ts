/// <reference types="node" />
// ^ this file reads gacha's stylesheets from disk (fs/path/process); the tests tsconfig pins
//   `types:["vitest"]`, so node's globals are pulled in explicitly (the themeContract precedent).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// gacha's CHROME re-skin — the LAYER-TRAP guard (the owner's G0 eyeball wave).
//
// gacha.css re-skins kit surfaces (`.kit-appbar`, `.kit-tabbar`, `.kit-tab-ind`, `.kit .switch`) from
// `@layer theme`, which beats `@layer base` BY LAYER ORDER — so a plain `.kit-appbar` rule here outranks
// kit.css's far more specific `.kit-appbar.transparent` and `body[data-perf="lite"] .kit-appbar`. Every
// base rule that CONDITIONS one of those surfaces must therefore be re-declared inside the theme, or a
// global lever silently stops working under gacha only:
//   · the `transparent` appbar MODE would paint a bar,
//   · perf-lite would keep its backdrop-filters (the §14.11 Fennec speed lever),
//   · reduced motion would slide the indicator instead of jumping it,
//   · the small `.svc-auto` switch variant would inflate to the full 48×28 toggle.
// Each of those is invisible in a screenshot of the DEFAULT state, which is exactly why it needs a test.
// A source-level check, deliberately: the failure mode is a DELETED rule, which reading the sheet proves
// directly, while the alternative (booting four axis combinations in Playwright to observe a computed
// style) is a much heavier test of the same four lines. The VISUAL claims — the floating pill, the white
// indicator, the two-stop switch, the dissolving bar — are measured on computed styles in
// `e2e/layout.spec.ts`, the only place the @layer/@scope cascade actually runs.

const css = readFileSync(resolve(process.cwd(), "src/themes/gacha/gacha.css"), "utf8");
const tokens = readFileSync(resolve(process.cwd(), "src/themes/gacha/tokens.css"), "utf8");

/** Strip comments so a rule NAMED in prose can't satisfy a check for the rule itself. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

const REDECLARED: [string, string, string][] = [
  [
    "the transparent appbar mode",
    ".kit-appbar.transparent",
    "gacha's `.kit-appbar` fill would win on layer order and the `transparent` appbarMode would paint a bar",
  ],
  [
    "the perf-lite frost gate",
    'body[data-perf="lite"] .kit-appbar',
    "gacha's bar/nav backdrop-filters would survive perf-lite — the §14.11 Fennec speed lever",
  ],
  [
    "the perf-lite nav gate",
    'body[data-perf="lite"] .kit-tabbar',
    "the floating nav would keep its blur under perf-lite",
  ],
  [
    "the reduced-motion indicator",
    'body[data-motion="reduced"] .kit-tab-ind',
    "the indicator would SLIDE under reduced motion instead of jumping (position is information)",
  ],
  [
    "the small switch variant",
    ".kit .svc-auto .switch .knob",
    "the per-service auto rows' small toggle would inflate to the full 48×28 switch",
  ],
];

describe("gacha chrome — the @layer trap re-declarations", () => {
  it.each(REDECLARED)("re-declares %s", (_name, selector, why) => {
    expect(
      rules.includes(selector),
      `gacha.css must re-declare \`${selector}\`: without it, ${why}.`,
    ).toBe(true);
  });
});

describe("gacha chrome — the values live in tokens.css (council M7)", () => {
  // The chrome wave added nine color/shadow roles. The stylelint override already makes a literal in
  // gacha.css an ERROR; this asserts the other half — that the roles were actually DECLARED rather than
  // silently inherited from the kit's neutral fallbacks, which is what G6's palette variants re-tint.
  it.each([
    ["--gc-bar-grad"],
    ["--gc-bar-grad-wall"],
    ["--gc-nav-shadow"],
    ["--gc-nav-ink"],
    ["--gc-ind-fill"],
    ["--gc-ind-shadow"],
    ["--gc-switch-off"],
    ["--gc-switch-fill"],
    ["--gc-switch-knob"],
  ])("declares %s", (token) => {
    expect(tokens).toContain(`${token}:`);
    expect(rules, `${token} is declared but never used`).toContain(`var(${token})`);
  });

  it("keeps the switch's two-stop OFF the ink-bearing --accent-fill (the contrast pair)", () => {
    // `--accent-ink` (the var(--bg) fallback) on `--accent-fill`'s worst stop measures 4.57 against a
    // 4.5 floor. The switch's darker `#725bff` would drop that to 4.34 and FAIL the e2e gate, so the two
    // gradients stay separate tokens — a switch track carries no ink and is free to be the darker one.
    expect(tokens).toContain("--gc-switch-fill: linear-gradient(90deg, #ff6cae, #725bff)");
    const accentFill = /--accent-fill:\s*linear-gradient\(([\s\S]*?)\);/.exec(tokens)?.[1] ?? "";
    expect(accentFill).toContain("--gc-brand-3"); // the tri-gradient keeps its cyan stop
    expect(accentFill).not.toContain("725bff");
  });
});
