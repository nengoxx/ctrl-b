/// <reference types="node" />
// ^ this file reads gacha's stylesheets from disk (fs/path/process); the tests tsconfig pins
//   `types:["vitest"]`, so node's globals are pulled in explicitly (the themeContract precedent).
import { readdirSync, readFileSync } from "node:fs";
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
//   · …and would get its dead air back (gacha's own `padding: 14px 16px` outranks the mode's slimmer pads),
//   · perf-lite would keep its backdrop-filters (the §14.11 Fennec speed lever) — on the painted bar AND
//     on the clear one, whose gate gacha's own `.kit-appbar.transparent` block re-arms the frost over,
//   · reduced motion would slide the indicator instead of jumping it,
//   · the small `.svc-auto` switch variant would inflate to the full 48×28 toggle.
// Each of those is invisible in a screenshot of the DEFAULT state, which is exactly why it needs a test.
// A source-level check, deliberately: the failure mode is a DELETED rule, which reading the sheet proves
// directly, while the alternative (booting the axis combinations in Playwright to observe a computed
// style) is a much heavier test of the same few lines. The VISUAL claims — the floating pill, the white
// indicator, the two-stop switch, the dissolving bar, the flush appbar→content seam — are measured on
// computed styles in `e2e/layout.spec.ts`, the only place the @layer/@scope cascade actually runs.
//
// A member is a SOURCE NEEDLE, not always a selector: the clear mode's slimmer pads are re-stated as
// DECLARATIONS inside a selector this list already carries, so what can go missing is the declaration.

const css = readFileSync(resolve(process.cwd(), "src/themes/gacha/gacha.css"), "utf8");
const tokens = readFileSync(resolve(process.cwd(), "src/themes/gacha/tokens.css"), "utf8");

/** Strip comments so a rule NAMED in prose can't satisfy a check for the rule itself. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

const REDECLARED: [name: string, needle: string, why: string][] = [
  [
    "the transparent appbar mode",
    ".kit-appbar.transparent",
    "gacha's `.kit-appbar` fill would win on layer order and the `transparent` appbarMode would paint a bar",
  ],
  [
    "the transparent mode's slimmer pads",
    "padding: calc(8px * var(--density-pad)) 16px calc(6px * var(--density-pad))",
    "gacha's own `padding: 14px 16px` would win on layer order and hand the clear bar back exactly the " +
      "dead air the mode exists to remove (its `margin-bottom: -14px` rides the same declaration block)",
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
    "the CLEAR mode's perf-lite frost drop",
    'body[data-perf="lite"] .kit-appbar.transparent',
    "gacha gives the clear bar the prototype's dissolve BACKING plus its own blur, in a rule that also " +
      "re-arms the frost the base perf-lite gate had dropped — without this second, narrower gate the " +
      "clear bar would keep its backdrop-filter under perf-lite",
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
  it.each(REDECLARED)("re-declares %s", (_name, needle, why) => {
    expect(
      rules.includes(needle),
      `gacha.css must re-declare \`${needle}\`: without it, ${why}.`,
    ).toBe(true);
  });
});

describe("gacha chrome — the values live in tokens.css (council M7)", () => {
  // The stylelint override already makes a literal in gacha.css an ERROR; this asserts the other half —
  // that the role was actually DECLARED here rather than silently inherited from the kit's neutral
  // fallbacks, which is what G6's five palette variants re-tint in one place.
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
    ["--gc-brand-fill"],
  ])("declares %s, and gacha.css or a token actually consumes it", (token) => {
    expect(tokens).toContain(`${token}:`);
    expect(
      rules.includes(`var(${token})`) || tokens.includes(`var(${token})`),
      `${token} is declared but never used`,
    ).toBe(true);
  });

  // The EXPECTED-VALUE guard (Codex G0 #3): the generic contract arm in themeContract.test.ts only proves
  // a token EXISTS. These are prototype values with a fidelity mandate on them, and several are consumed
  // by slices that have not been built yet — so without this a drift (or a well-meaning "cleanup") between
  // now and G2/G3 would land silently. Each entry is the prototype's own literal, cited to its source.
  it.each([
    // theme.css — the semantic tier
    ["--bg", "#0a0b19"],
    ["--surface", "#14172f"], // .capsule-card
    ["--surface-2", "#16182f"], // .setting-group
    ["--text", "#f7f6ff"],
    ["--line", "#ffffff10"], // the hairline ladder's floor, in the prototype's own hex-alpha notation
    ["--line-2", "#ffffff2e"], // …and its ceiling
    ["--ok", "#74f3ad"],
    ["--warn", "#ffc76a"],
    // the brand trio + the deliberately-near-trio siblings (§1: tokened separately, never unified)
    ["--gc-brand-1", "#ff6cae"],
    ["--gc-brand-2", "#805cff"],
    ["--gc-brand-3", "#54e5ff"],
    ["--gc-reel-slat", "linear-gradient(#ff6caf, #755cff, #57e7ff)"],
    ["--gc-ind-shadow", "5px 5px 0 #ff6cb1"],
    // chrome
    ["--gc-bar", "#11142ee8"],
    ["--gc-bar-line", "#ffffff18"],
    ["--gc-nav-shadow", "0 18px 45px #0009"],
    ["--gc-nav-ink", "#17172b"],
    ["--gc-switch-off", "#ffffff15"],
    ["--gc-switch-fill", "linear-gradient(90deg, #ff6cae, #725bff)"],
    // the fleet (G1) — the pickup banner + the capsule track
    ["--gc-hair", "#ffffff14"], // .banner's own hairline rung
    ["--gc-banner-shadow", "0 20px 50px #0009"],
    ["--gc-banner-shadow-wall", "0 20px 50px #000c"],
    ["--gc-tag-ink", "#161329"],
    ["--gc-display-shadow", "0 3px 0 #1b1030, 0 10px 24px #000"],
    ["--gc-pill-bg", "#0a0b19cc"],
    ["--gc-pill-line", "#ffffff26"],
    ["--gc-pill-ink", "#ffffffc4"],
    ["--gc-chip-ink", "#ffffffb0"],
    ["--gc-dot", "#ffffff4d"],
    ["--gc-dot-shadow", "0 2px 8px #ff6cae99"],
    // stars (§6.2) + the ONLINE ribbon
    ["--gc-star", "#ffd464"],
    ["--gc-star-dim", "#b9b3d6"],
    ["--gc-online-fill", "linear-gradient(92deg, #74f3ad, #54e5ff)"],
    // RESERVED for G2/G3 — the ones most at risk of drifting, since nothing paints them yet
    ["--gc-composer", "#15172e"],
    ["--gc-bubble-bot", "#222541"],
    ["--gc-bubble-user-shadow", "5px 5px 0 #ff6cae"],
    ["--gc-dossier-from", "#f9f8ff"],
    ["--gc-dossier-to", "#dfe4ff"],
    ["--gc-dossier-ink", "#17172c"],
    ["--gc-dossier-line", "#c9d0ef"],
    // NOT the prototype's #c8438b: that literal measures 4.30 on the light sheet — under the small-text
    // 4.5 floor — so it deepened within the same rose (the owner-override/measured-floor precedent, like
    // --gc-dossier-accent). The pin now guards the MEASURED value against drifting back.
    ["--gc-unit-no", "#b03578"],
    ["--gc-caption", "#9ff0ff"],
    ["--gc-heading", "#ff8ec2"],
  ])("%s is the prototype's %s", (token, value) => {
    expect(
      tokens,
      `${token} drifted from the prototype's ${value} — the fidelity mandate is on these values`,
    ).toContain(`${token}: ${value}`);
  });

  it("keeps the switch's two-stop OFF the ink-bearing --accent-fill (the contrast pair)", () => {
    // `--accent-ink` (the var(--bg) fallback) on `--accent-fill`'s worst stop measures 4.57 against a 4.5
    // floor. The switch's darker `#725bff` would drop it to 4.34 and FAIL the e2e gate, so the control
    // fill uses the BRAND violet instead — visually the same gradient, verified contrast.
    expect(tokens).toContain("--gc-switch-fill: linear-gradient(90deg, #ff6cae, #725bff)");
    const accentFill = /--accent-fill:\s*linear-gradient\(([^;]*?)\);/.exec(tokens)?.[1] ?? "";
    expect(accentFill).toContain("--gc-brand-2");
    expect(accentFill).not.toContain("725bff");
    // …and the owner's round-2 item C/D: the generic control fill is the TWO-stop, so the cyan third stop
    // is reserved for BRAND surfaces (`--gc-brand-fill`) and no longer paints every seg/send/save button.
    expect(accentFill).not.toContain("--gc-brand-3");
    expect(tokens).toMatch(/--gc-brand-fill:[\s\S]*?--gc-brand-3/);
  });
});

// ── The NON-ASCII FENCE (Codex G0 #1) ────────────────────────────────────────────────────────────────
// gacha ships a FROZEN font subset derived from `copy.ts`. A non-ASCII character that lives anywhere else
// in the theme is therefore a character the shipped font cannot draw — it silently falls back to the
// system face, mid-string, at the wrong weight. That is exactly what happened to the ★ in the star-mode
// seg labels and to the JP words in the settings descriptions, and the glyph guard could not see it
// because it only ever looked at copy.ts.
//
// The fence is absolute rather than a list of allowed exceptions: outside `copy.ts`, gacha's TypeScript
// contains no non-ASCII at all. Comments are stripped first — prose about 編成 or a `→` in a diagram is
// documentation, not shipped text.
describe("gacha sources — no non-ASCII outside copy.ts", () => {
  const dir = resolve(process.cwd(), "src/themes/gacha");
  const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && f !== "copy.ts")
    .sort();

  it("finds the theme's source files (the fence is not vacuously passing)", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(files).toContain("index.tsx");
  });

  it.each(files.map((f) => [f] as const))("%s carries no non-ASCII outside comments", (file) => {
    const src = readFileSync(resolve(dir, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const offenders = [...new Set([...src].filter((c) => c.codePointAt(0)! > 0x7f))];
    expect(
      offenders,
      `${file} contains non-ASCII outside comments: ${offenders.join(" ")}\n` +
        `  Every shipped non-ASCII character must live in src/themes/gacha/copy.ts, or the frozen font\n` +
        `  subset will not contain it and it will render in the system fallback face.\n` +
        `  Fix: move the string into GACHA_COPY, then run \`npm run fonts:gacha\` and commit the outputs.`,
    ).toEqual([]);
  });
});
