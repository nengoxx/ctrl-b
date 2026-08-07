/// <reference types="node" />
// ^ this file reads gacha's stylesheets from disk (fs/path/process); the tests tsconfig pins
//   `types:["vitest"]`, so node's globals are pulled in explicitly (the themeContract precedent).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { GACHA_COPY, gachaGlyphSet } from "../../src/themes/gacha/copy";
import { gacha } from "../../src/themes/gacha";

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
/** The KIT sheet — read only to pin the arcade-drop signature gacha mirrors (see that describe). */
const kit = readFileSync(resolve(process.cwd(), "src/theme-engine/kit/kit.css"), "utf8");
/** The e2e contrast gate — read to prove a modelled token is actually MEASURED, not just declared. */
const contrast = readFileSync(resolve(process.cwd(), "e2e/contrast.spec.ts"), "utf8");

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
    // --gc-dossier-accent). The pin now guards the MEASURED value against drifting back. RENAMED at G6:
    // it was `--gc-unit-no`, which was not a `--gc-dossier-*` name and so escaped the dossier picker's
    // family sweep — the value is the same rose, minted into the family it belongs to.
    ["--gc-dossier-kicker", "#b03578"],
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

// ── G6: THE TWO PALETTE PICKERS (D52 §4.4) ────────────────────────────────────────────────────────
// Eight accent variants (G6.2 appended `jade`) + seven dossier options, and the failure mode both share
// is SILENT: a variant
// block that skips one of the recipe's derived tokens does not break — it inherits arcade's value, so a
// new trio ships with arcade's pink caption and arcade's cyan ribbon beside it, and only an eyeball on
// the right screen would ever notice. So the completeness of each block is machine-checked here, against
// the registry rows that expose them.

/** The DECLARATION BLOCK for one selector, from the raw stylesheet (values contain no braces, so scanning
 *  to the next `}` is exact). Returns null when the selector has no block at all — which is itself a
 *  meaningful answer for `slip`. */
function blockFor(css: string, selector: string): string | null {
  // A selector may also appear as the LAST MEMBER of a group (the shared dark-dossier block lists every
  // dark palette, so `…"aurora-violet" {` matches there too). Take the occurrence whose preceding
  // non-whitespace character is not a comma — i.e. the one that starts its own rule.
  for (let at = css.indexOf(selector + " {"); at >= 0; at = css.indexOf(selector + " {", at + 1)) {
    if (/,\s*$/.test(css.slice(0, at))) continue;
    const open = css.indexOf("{", at);
    return css.slice(open + 1, css.indexOf("}", open));
  }
  return null;
}
/** The declaration block of the first RULE whose selector list contains `selector` (comments stripped). */
function ruleBlock(source: string, selector: string): string {
  const at = source.indexOf(selector);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  return /\{([^{}]*)\}/.exec(source.slice(at))![1];
}

const declared = (block: string): string[] =>
  [...block.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]);

// Every token that is a FUNCTION of the six base values (§4.4's recipe). A block that moves the base and
// omits one of these ships a half-repainted theme.
const RAMP_DERIVED = [
  "--bg",
  "--surface",
  "--surface-2",
  "--gc-backdrop",
  "--gc-bar",
  "--gc-bar-grad",
  "--gc-bar-grad-wall",
  "--gc-pill-bg",
  "--gc-wallpaper-scrim",
  "--gc-slide-scrim",
  "--gc-card-wall",
  "--gc-composer",
  "--gc-card-scrim",
  "--gc-bubble-bot",
  // not a formula in the recipe — each variant states its own deep tint in its radial's family
  "--gc-display-shadow",
];
const TRIO_DERIVED = [
  "--gc-brand-1",
  "--gc-brand-2",
  "--gc-brand-3",
  "--gc-heading",
  "--gc-caption",
  "--gc-online-fill",
  "--gc-reel-slat",
  "--gc-switch-fill",
  "--gc-ind-shadow",
  "--gc-bubble-user-shadow",
  "--gc-dot-shadow",
  "--gc-banner-glow",
];
/** family 1 keeps the brand trio (only the ramp moves), family 2 moves both. */
const RAMP_ONLY = new Set(["midnight", "indigo"]);

describe("gacha G6 — the ACCENT axis (§4.4 families 1+2)", () => {
  const accents = (gacha.palettes.accents ?? []).map((a) => a.id);

  it("declares the eight ruled variants, arcade first + default", () => {
    expect(accents).toEqual([
      "arcade",
      "midnight",
      "indigo",
      "ember",
      "glacier",
      "nebula",
      "eridu",
      // G6.2 — APPENDED after eridu, so an existing owner selection keeps its position in the picker
      "jade",
    ]);
    expect(gacha.palettes.defaultAccent).toBe("arcade");
  });

  it.each(accents.filter((id) => id !== "arcade").map((id) => [id] as const))(
    "%s has a tokens.css block carrying every token the recipe derives",
    (id) => {
      const block = blockFor(tokens, `body[data-accent="${id}"]`);
      expect(block, `no body[data-accent="${id}"] block in tokens.css`).toBeTruthy();
      const has = new Set(declared(block!));
      const need = RAMP_ONLY.has(id) ? RAMP_DERIVED : [...RAMP_DERIVED, ...TRIO_DERIVED];
      for (const token of need) {
        expect(
          has.has(token),
          `body[data-accent="${id}"] omits ${token} — it is a FUNCTION of the base six, so the variant ` +
            `would silently inherit arcade's value beside its own ramp/trio (§4.4's recipe)`,
        ).toBe(true);
      }
    },
  );

  it.each(accents.map((id) => [id] as const))(
    "%s's block writes NO --gc-dossier-* token (the two axes are disjoint in writes)",
    (id) => {
      const block = blockFor(tokens, `body[data-accent="${id}"]`) ?? "";
      expect(
        declared(block).filter((t) => t.startsWith("--gc-dossier-")),
        `body[data-accent="${id}"] writes a dossier token — that is the other picker's scope (§4.4)`,
      ).toEqual([]);
    },
  );

  it("each picker chip re-states its OWN palette's trio (the literal-swatch trade-off)", () => {
    // The chips are LITERALS on purpose: `var(--gc-brand-fill)` would preview the ACTIVE accent, so all
    // eight chips would show one palette. The cost of literals is drift, and this is the guard that pays
    // it — every chip's three brand hexes must equal the ones its own block declares (family 1 inherits
    // the base trio from `:scope`, so those three are checked against that).
    const baseTrio = ["--gc-brand-1", "--gc-brand-2", "--gc-brand-3"].map(
      (t) => /--gc-brand-[123]:\s*(#[0-9a-f]{6})/i.exec(tokens.slice(tokens.indexOf(t)))![1],
    );
    for (const a of gacha.palettes.accents ?? []) {
      const block = blockFor(tokens, `body[data-accent="${a.id}"]`) ?? "";
      const own = ["--gc-brand-1", "--gc-brand-2", "--gc-brand-3"].map(
        (t) => new RegExp(`${t}:\\s*(#[0-9a-f]{6})`, "i").exec(block)?.[1],
      );
      const trio = own.every(Boolean) ? (own as string[]) : baseTrio;
      for (const hex of trio) {
        expect(
          String(a.swatch).includes(hex),
          `the "${a.id}" picker chip does not contain ${hex} — it has drifted from the palette it previews`,
        ).toBe(true);
      }
    }
  });
});

describe("gacha G6 — the DOSSIER axis (§4.4 family 3 / THE PICKER CONTRACT)", () => {
  const field = gacha.settings?.dossierPalette;
  const options = field?.type === "seg" ? field.options : [];

  it("is the contract's seg: key, order, labels, swatches and default", () => {
    expect(field?.type).toBe("seg");
    expect(options.map((o) => o.val)).toEqual([
      "slip",
      "neon-purple",
      "sunset-orange",
      "rose-pink",
      "aurora-violet",
      // G6.1 — appended IN ORDER after aurora, so an existing owner selection keeps its position
      "cyber-teal",
      "forest-green",
    ]);
    expect(options.map((o) => o.label)).toEqual([
      "Slip",
      "Neon",
      "Sunset",
      "Rose",
      "Aurora",
      "Teal",
      "Forest",
    ]);
    expect(field?.type === "seg" && field.default).toBe("neon-purple");
    // every option carries its chip — the whole reason the §4.9 `swatch` slot was committed
    expect(options.every((o) => typeof o.swatch === "string")).toBe(true);
    // …and each DARK chip is its own palette's action-fill START, the literal that tokens.css ships (the
    // same literal-swatch trade-off the accent chips make: a `var()` would preview the ACTIVE palette on
    // every row). Pinned because the chip and the block are two copies of one value.
    for (const [val, swatch] of [
      ["neon-purple", "#511cab"],
      ["sunset-orange", "#d97943"],
      ["rose-pink", "#da7b7a"],
      ["aurora-violet", "#7e37a5"],
      ["cyber-teal", "#007c8c"],
      ["forest-green", "#337848"],
    ]) {
      expect(options.find((o) => o.val === val)?.swatch, `${val} chip`).toBe(swatch);
      const block = blockFor(tokens, `body[data-gc-dossier="${val}"]`) ?? "";
      expect(block, `${val}'s chip is not its own act-fill start`).toContain(
        `--gc-dossier-act-fill: linear-gradient(180deg, ${swatch},`,
      );
    }
  });

  it("slip has NO tokens.css block — it is the absence of an override, not another copy", () => {
    expect(blockFor(tokens, 'body[data-gc-dossier="slip"]')).toBeNull();
  });

  it.each(options.filter((o) => o.val !== "slip").map((o) => [o.val] as const))(
    "%s sets its full per-palette token row",
    (id) => {
      const block = blockFor(tokens, `body[data-gc-dossier="${id}"]`);
      expect(block, `no body[data-gc-dossier="${id}"] block`).toBeTruthy();
      const has = new Set(declared(block!));
      for (const token of [
        "--gc-dossier-from",
        // G6.3: the sheet is a 3-STOP gradient (front-loaded, per the re-sampled panel profiles), the
        // panel carries its own 1px rim, and five roles the mock states per palette left the shared block
        // — the row a dark palette must fill grew by six names.
        "--gc-dossier-mid",
        "--gc-dossier-to",
        "--gc-dossier-outline",
        "--gc-dossier-outline-top",
        "--gc-dossier-card",
        "--gc-dossier-ink-2",
        "--gc-dossier-name",
        "--gc-dossier-accent",
        "--gc-dossier-kicker",
        "--gc-dossier-led",
        "--gc-dossier-led-dim",
        "--gc-dossier-act-fill",
        "--gc-dossier-act-ink",
        "--gc-dossier-act-rim",
        "--gc-dossier-act-hi",
        "--gc-dossier-shadow",
        "--gc-dossier-blank",
      ]) {
        expect(has.has(token), `body[data-gc-dossier="${id}"] omits ${token}`).toBe(true);
      }
      // …and writes NOTHING outside the family (the disjointness rule's other half)
      expect(
        declared(block!).filter((t) => !t.startsWith("--gc-dossier-")),
        `body[data-gc-dossier="${id}"] writes a non-dossier token`,
      ).toEqual([]);
    },
  );

  it("the darks share one block for the values the §4.4 table lists as shared", () => {
    // The selector list is EQUAL-specificity with the per-palette blocks on purpose (a
    // `:not([data-gc-dossier="slip"])` shorthand would outrank them), so it grows by one member per
    // palette — G6.1 took it from four to six, and this pin is what makes a forgotten member fail loudly
    // instead of silently dropping that palette back to slip's ink/line/badge.
    const block = blockFor(
      tokens,
      [
        'body[data-gc-dossier="neon-purple"]',
        'body[data-gc-dossier="sunset-orange"]',
        'body[data-gc-dossier="rose-pink"]',
        'body[data-gc-dossier="aurora-violet"]',
        'body[data-gc-dossier="cyber-teal"]',
        'body[data-gc-dossier="forest-green"]',
      ].join(",\n    "),
    );
    expect(block, "the shared dark-dossier block is missing").toBeTruthy();
    const has = new Set(declared(block!));
    for (const token of [
      "--gc-dossier-ink",
      // `--gc-dossier-ink-2` LEFT this list at G6.3: the mock's role line is palette-tinted on every panel,
      // so all six state their own and a shared value here would be dead code.
      "--gc-dossier-line",
      "--gc-dossier-badge",
      "--gc-dossier-art-shadow",
      "--gc-dossier-close-bg",
      "--gc-dossier-close-ink",
      "--gc-dossier-act-line",
    ]) {
      expect(has.has(token), `the shared dark block omits ${token}`).toBe(true);
    }
  });

  it("the flat dark button REPLACES the sticker press for BOTH buttons, and slip is excluded", () => {
    // The generic `.gc-act:active` slides 3px into a shadow the dark palettes do not have. Overriding it
    // on `.primary` alone would leave the SECONDARY sliding — the §4.4 note this guard exists for.
    expect(rules).toContain(
      'body[data-gc-dossier]:not([data-gc-dossier="slip"]) .gc-act:active:not(:disabled)',
    );
    // slip keeps the sticker ticket, so its shadow token must stay LIVE
    expect(tokens).toContain("--gc-act-shadow:");
    expect(rules).toContain("var(--gc-act-shadow)");
  });

  it("the service dots are the vapor-style led pair, and the glow is dark-only", () => {
    expect(rules).toContain("var(--gc-dossier-led-dim)");
    expect(rules).toContain("var(--gc-dossier-led)");
    expect(rules).toContain('body[data-gc-dossier]:not([data-gc-dossier="slip"]) .gc-svc.on i');
    // the replaced pair must be GONE from the sheet AND from the token map (no dead tokens)
    expect(rules).not.toContain("--gc-dossier-ok");
    expect(rules).not.toContain("--gc-dossier-warn");
    expect(tokens).not.toContain("--gc-dossier-ok:");
    expect(tokens).not.toContain("--gc-dossier-warn:");
  });

  it("the close disc reads its own pair (the white-blob inversion is structurally impossible now)", () => {
    expect(rules).toContain("background: var(--gc-dossier-close-bg)");
    expect(rules).toContain("color: var(--gc-dossier-close-ink)");
  });
});

describe("gacha G6 — the wordmark (§4.3 re-ruling)", () => {
  it("ships コントロール・ビー, keeping カプセルアーケード as the alternative", () => {
    expect(GACHA_COPY.brandWordmark).toBe("コントロール・ビー");
    expect(GACHA_COPY.brandWordmarkAlt).toBe("カプセルアーケード");
  });

  it("costs no font regeneration — both readings were already in the frozen glyph set", () => {
    // the swap is a VALUE move inside copy.ts, and `gachaGlyphSet()` walks the whole object, so the
    // committed subset is untouched by which key is shipped. Same for the new dossier row's 紙, which
    // rides `settingWallpaperDesc`'s 壁紙.
    const glyphs = new Set(gachaGlyphSet());
    for (const ch of GACHA_COPY.brandWordmark + GACHA_COPY.brandWordmarkAlt) {
      if (ch.codePointAt(0)! > 0x7f) expect(glyphs.has(ch)).toBe(true);
    }
    expect(glyphs.has("紙")).toBe(true);
    expect(GACHA_COPY.settingWallpaperDesc).toContain("紙");
  });
});

describe("gacha — the NAME-FACE axes (`nameFont` + `cardNameFont`, the R17 rider and its 08-07 split)", () => {
  const field = gacha.settings?.nameFont;
  const options = field?.type === "seg" ? field.options : [];
  // The CARD axis (owner 2026-08-07): the same role on the capsule plate, split off so the two surfaces
  // are pickable apart. Asserted BESIDE its sibling throughout this group rather than in a group of its
  // own, because the property worth pinning is that the two axes are the same mechanism with one
  // difference — which VALUE is the base, i.e. which one ships no tokens.css block.
  const cardField = gacha.settings?.cardNameFont;
  const cardOptions = cardField?.type === "seg" ? cardField.options : [];

  it("is a seg of three, defaulting to the theme's own serif", () => {
    expect(field?.type).toBe("seg");
    expect(options.map((o) => o.val)).toEqual(["mincho", "bungee", "maru"]);
    expect(options.map((o) => o.label)).toEqual(["Mincho", "Bungee", "Zen Maru"]);
    // `mincho` and not `bungee`: the owner saw Bungee live and ruled it too bulky as a DEFAULT — it stays
    // on offer, which is the whole reason this is a picker rather than a token edit.
    expect(field?.type === "seg" && field.default).toBe("mincho");
    // No swatches: these options differ by SHAPE, so a colour chip would preview nothing (the dossier
    // picker's `swatch` slot is deliberately unused here).
    expect(options.every((o) => o.swatch === undefined)).toBe(true);
  });

  it("the CARD axis offers the SAME three, defaulting to the face the plate pin shipped", () => {
    expect(cardField?.type).toBe("seg");
    // Same values as the sibling and deliberately not a superset: the values name FACES, and one face is
    // one entry in each of tokens.css / `NAME_FACE` / both option lists.
    expect(cardOptions.map((o) => o.val)).toEqual(options.map((o) => o.val));
    expect(cardOptions.map((o) => o.label)).toEqual(options.map((o) => o.label));
    // `bungee`, because the axis was extracted from an owner-ruled PIN on the plate — a picker must not
    // move the look it is extracted from, so an untouched install keeps painting Bungee cards.
    expect(cardField?.type === "seg" && cardField.default).toBe("bungee");
    expect(cardOptions.every((o) => o.swatch === undefined)).toBe(true);
  });

  it("`mincho` has NO tokens.css block — it is the `:scope` base, the `slip` idiom one axis over", () => {
    expect(blockFor(tokens, 'body[data-gc-namefont="mincho"]')).toBeNull();
    const base = blockFor(tokens, ":scope")!;
    expect(base).toContain("--gc-name-font: var(--font-display)");
    expect(base).toContain("--gc-name-weight: 900");
  });

  it("…and on the CARD axis it is `bungee` that has no block — the same idiom, the other value", () => {
    // The mirror of the test above, and the ONE way the two axes differ: each axis's DEFAULT is the
    // absence of a block, and their defaults differ, so the base declares the serif pair for the dossier
    // and the Bungee pair for the card.
    expect(blockFor(tokens, 'body[data-gc-cardnamefont="bungee"]')).toBeNull();
    const base = blockFor(tokens, ":scope")!;
    expect(base).toContain('--gc-card-name-font: "Bungee", var(--font-display)');
    expect(base).toContain("--gc-card-name-weight: 400");
  });

  it("each ALTERNATE declares exactly the pair, and nothing else", () => {
    for (const id of ["bungee", "maru"]) {
      const block = blockFor(tokens, `body[data-gc-namefont="${id}"]`);
      expect(block, `no body[data-gc-namefont="${id}"] block`).toBeTruthy();
      // Exactly the two role tokens: a palette or a size leaking in here would make the FACE picker move
      // something a face has no business moving.
      expect(declared(block!).sort()).toEqual(["--gc-name-font", "--gc-name-weight"]);
      // …and `--font-display` stays the TAIL of every stack, which is what makes a runtime JAPANESE
      // machine name fall through to the system JP serif (the §10.4 degradation contract) — both
      // alternates are latin-only subsets.
      expect(block).toContain("var(--font-display)");
    }
  });

  it("…and so does each CARD alternate — face and weight, never a size or a palette", () => {
    for (const id of ["mincho", "maru"]) {
      const block = blockFor(tokens, `body[data-gc-cardnamefont="${id}"]`);
      expect(block, `no body[data-gc-cardnamefont="${id}"] block`).toBeTruthy();
      expect(declared(block!).sort()).toEqual(["--gc-card-name-font", "--gc-card-name-weight"]);
      // The plate's 20/27px sizing and its C6 gradient clip stay with the SURFACE (gacha.css): this axis
      // may only change which face the name is set in.
      expect(block).toContain("var(--font-display)");
    }
  });

  it("names only faces the committed manifest actually ships", () => {
    // A typo'd family is silent: the stack simply falls through to `--font-display` and the picker looks
    // like it does nothing. The manifest is the list of faces that exist.
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "src/themes/gacha/fonts/manifest.json"), "utf8"),
    ) as { faces: { family: string; weights: number[] }[] };
    const shipped = new Map(manifest.faces.map((f) => [f.family, f.weights]));
    for (const [id, family, weight] of [
      ["bungee", "Bungee", 400],
      ["maru", "Zen Maru Gothic", 900],
    ] as const) {
      const block = blockFor(tokens, `body[data-gc-namefont="${id}"]`)!;
      expect(block, `${id} must name ${family}`).toContain(`"${family}"`);
      expect(shipped.get(family), `${family} is not in the committed manifest`).toContain(weight);
      expect(block).toContain(`--gc-name-weight: ${weight}`);
    }
    // The CARD axis, same check against the same manifest — but read from where each value LIVES: its
    // `bungee` is the `:scope` base (no block), and `mincho` resolves through `--font-display` to
    // Shippori, which needs no row here for the same reason the sibling axis omits it — the token is one
    // definition, already covered by the base's own stack.
    for (const [selector, family, weight] of [
      [":scope", "Bungee", 400],
      ['body[data-gc-cardnamefont="maru"]', "Zen Maru Gothic", 900],
    ] as const) {
      const block = blockFor(tokens, selector)!;
      expect(block, `${selector} must name ${family}`).toContain(`"${family}"`);
      expect(shipped.get(family), `${family} is not in the committed manifest`).toContain(weight);
      expect(block).toContain(`--gc-card-name-weight: ${weight}`);
    }
  });

  it("each SURFACE reads its own pair — the dossier `h2` the name one, the plate the card one", () => {
    // The axis started as one face on two surfaces; the owner's 2026-08-07 ruling split them (CARDS in
    // Bungee while the dossier followed the picker), which the plate first wore as a literal `"Bungee"`
    // PIN because one shared pair cannot express a per-surface choice. `cardNameFont` is the clean shape
    // that pin anticipated, so the pin is gone and both surfaces are token-driven again — each from its
    // own pair. The banner/promo titles are roster copy and deliberately read neither.
    const dossier = ruleBlock(rules, ".gc-dossier-title h2");
    expect(dossier, "the dossier name must read --gc-name-font").toContain(
      "font-family: var(--gc-name-font)",
    );
    expect(dossier, "the dossier name must read --gc-name-weight").toContain(
      "font-weight: var(--gc-name-weight)",
    );
    const plate = ruleBlock(rules, ".gc-card .plate b");
    expect(plate, "the plate must read --gc-card-name-font").toContain(
      "font-family: var(--gc-card-name-font)",
    );
    expect(plate, "the plate must read --gc-card-name-weight").toContain(
      "font-weight: var(--gc-card-name-weight)",
    );
    // …and no literal face survives on either surface: a hardcoded family here is a picker that silently
    // does nothing, which is exactly what the interim pin was.
    expect(plate, "the plate must not pin a family").not.toContain('"Bungee"');
    // Synthetic ITALIC is retired on BOTH surfaces (R17's headline: no shipped face publishes one — the
    // plate's prototype skew went with the Bungee pin, upright is the true face whichever face is picked).
    expect(dossier).toContain("font-style: normal");
    expect(plate).toContain("font-style: normal");
  });
});

describe("gacha G7 — the DRAWN rarity star (R16)", () => {
  /** `--gc-star-*: 7px` → 7. */
  const px = (token: string): number =>
    Number(new RegExp(`${token}:\\s*([\\d.]+)px`).exec(tokens)![1]);

  it("keeps the ★ GLYPH for the rate pill and drops it from the two rows", () => {
    // R16 redesigned the ROWS, not the copy: `★N RATE` is a string (fleet.ts) and still rides the frozen
    // JP subset. What must not survive is the rows' glyph typography — a `font-size`/`letter-spacing` pair
    // on `.rar` would mean someone put the glyph back beside the drawn mark.
    expect(GACHA_COPY.star).toBe("★");
    const card = ruleBlock(rules, ".gc-card .rar {");
    expect(card).not.toContain("font-size");
    expect(card).not.toContain("letter-spacing");
    // …and the glow went with it: legibility is the star's own contour now (R16 §2), and a per-star
    // drop-shadow on a scrolling track is the §14.11 repaint class this theme avoids.
    for (const dead of ["--gc-star-glow", "--gc-star-shadow"]) {
      expect(tokens, `${dead} has no consumer left`).not.toContain(dead);
      expect(rules).not.toContain(dead);
    }
  });

  it("splits the treatment per SURFACE from one primitive — clean tab, CARVED card (R19)", () => {
    const star = ruleBlock(rules, ".gc-star {");
    // THE DEFAULT is the clean mark (and IS the dossier tab's treatment, so that surface needs no rule):
    // both paints from `currentColor`, so the stroke is SHAPE — it fattens and rounds the silhouette — and
    // the existing `--gc-star`/`-hi`/`-dim` tinting still drives it through the row's `color`. The
    // candidate sheet's contrasting dark contour is retired: the owner read it as an outline.
    expect(star).toContain("fill: currentColor");
    expect(star).toContain("stroke: currentColor");
    expect(star).toContain("paint-order: stroke fill"); // only the stroke's OUTER half ever shows
    expect(tokens, "the dark-contour token has no consumer left").not.toContain(
      "--gc-star-contour",
    );
    // The 2026-08-06 card treatments are GONE WITH THEIR MACHINERY — the accent edge, the arcade drop
    // polygon and the drop's dormant remains all fell to the owner's R19 carve pick. Dead tokens must
    // not linger (the --gc-star-glow precedent, one describe up).
    for (const dead of [".gc-star .drop", "--gc-star-drop", "--gc-star-edge"]) {
      expect(rules, `${dead} has no business in the sheet any more`).not.toContain(dead);
      expect(tokens).not.toContain(dead);
    }
    // …the CARD — the row that sits on artwork — is CARVED: the R19-E blurred inner shadow, switched on
    // per-surface exactly as every retired treatment was. The def lives in GachaStar (GachaStarDefs,
    // mounted by GachaFleet — its presence is pinned in gachaFleet.test.tsx, because a dangling
    // `url(#…)` does not degrade to "no filter" on every engine).
    expect(ruleBlock(rules, ".gc-card .rar .gc-star {")).toContain("filter: url(#gc-star-carve)");
    // The DOSSIER tab takes no override at all — owner: "the dossier looks good".
    expect(rules).not.toContain(".gc-dossier .art-rar .gc-star");
    // THE WAIVER SCOPE (§14.11): a per-star filter ships as an owner-granted waiver scoped to exactly
    // ONE def — a second `url(#` filter reference in this sheet would widen that waiver silently.
    expect(rules.match(/filter: url\(#/g)).toHaveLength(1);
    // The carve's flood ink is a TOKEN (council M7), so the palette owns it, not the filter def.
    expect(tokens).toContain("--gc-star-carve-ink:");
    // USER units for the stroke (the viewBox is 96.5 wide), so it scales with the row.
    expect(tokens).toMatch(/--gc-star-stroke:\s*\d+px/);
    expect(star).toContain("stroke-width: var(--gc-star-stroke)");
    // …and the base mark itself still carries no filter: the waiver is the card row's alone.
    expect(star).not.toContain("filter");
  });

  it("sizes the rows by the owner's eye — CARD above dossier — and both pack at ~1.3", () => {
    // R16's finding was the RATIO: the field packs small rows tight and lets big ones breathe at ~1.3
    // (Arknights 1.32 · Epic Seven 1.31 · Genshin detail 1.33) — what shipped before the slice was 1.23
    // card / 1.37 dossier, looser at the smaller size, which no measured reference does. The ratio band
    // is the durable invariant here. The size RELATION is the owner's: R16 first un-inverted it
    // (dossier > card, equal-measured), then the fourth device round deliberately re-inverted it — the
    // card row sits over ART at arm's length, the dossier on a calm sheet up close, so equal-PERCEIVED
    // put the card above the dossier's 11.5 (tokens.css walks the whole size history). The primitive's
    // viewBox is cropped to the star's stroked extent, so `-size` IS ink and this arithmetic is the real
    // rendered ratio.
    const [size, gap, sizeLg, gapLg, sizeFull, gapFull] = [
      px("--gc-star-size"),
      px("--gc-star-gap"),
      px("--gc-star-size-lg"),
      px("--gc-star-gap-lg"),
      px("--gc-star-size-full"),
      px("--gc-star-gap-full"),
    ];
    expect(size).toBeGreaterThan(sizeLg); // the owner's equal-perceived ruling, 2026-08-06
    // …extended by the sixth round: the FULL-WIDTH shapes (feat/wide) carry ~twice a pair card's art, so
    // their row steps above the card base — same reasoning, one more rung. The rule itself must re-bind
    // the pair on the ROW (the dossier idiom), never restate a size on the star.
    expect(sizeFull).toBeGreaterThan(size);
    expect(ruleBlock(rules, ".gc-card.feat .rar,")).toContain(
      "--gc-star-size: var(--gc-star-size-full)",
    );
    for (const [what, s, g] of [
      ["card", size, gap],
      ["dossier", sizeLg, gapLg],
      ["full-width card", sizeFull, gapFull],
    ] as const) {
      const ratio = (s + g) / s;
      expect(ratio, `${what} pitch÷ink`).toBeGreaterThan(1.25);
      expect(ratio, `${what} pitch÷ink`).toBeLessThan(1.35);
    }
  });

  it("gives the dossier a HAIRLINE tab straddling the portrait's edge — no filled plaque", () => {
    // anchored on the line start: a bare `.gc-dossier .art-rar` also matches the VT-naming rule above it.
    const tab = ruleBlock(rules, "\n    .gc-dossier .art-rar {");
    // R16 §2: nobody in the field puts a filled plaque behind rarity stars. The lozenge's fill is gone…
    expect(tab).not.toContain("--gc-dossier-badge");
    // …replaced by a 1px rim + a translucent, palette-derived fill the contrast gate can see.
    expect(tab).toContain("border: 1px solid var(--gc-dossier-line)");
    expect(tab).toContain("background: var(--gc-dossier-rar-bg)");
    // …and it STRADDLES the frame's trailing edge rather than pinning a fixed right offset: the tab's
    // width tracks the star count (★1 31.5px → ★5 91.5px at 393px), so a fixed offset makes a ★2 tab miss
    // the portrait entirely. Measured on device-width renders before the change.
    expect(tab).toContain("left: 100%");
    expect(tab).toContain("translate: -50% 0");
    // The element identity is load-bearing elsewhere: the `dossier-rar` view-transition-name is declared
    // on this selector, and GachaFleet's lingering-badge suppression queries it.
    expect(rules).toContain('[data-transition="detail"] .gc-dossier .art-rar');
  });
});

describe("gacha — the ARCADE DROP on the two art surfaces (owner ask 2026-08-06)", () => {
  it("borrows kit.css's signature through gacha's OWN token pair", () => {
    // `--arcade-lift` is declared ON `.kit-composer` by the arcade composer skin, so it resolves nowhere
    // else — and the skin is a picker value, so a card must not lose its drop when the owner picks a
    // different composer. Same 3px, same 60% accent mix, independent lifetime.
    // the DISTANCES are owner-tuned per surface and move; what is pinned is that gacha owns a PAIR and
    // that the portrait's is the heavier one (its device round: 3px read "a little too slim" there).
    expect(tokens).toMatch(/--gc-lift:\s*(\d+)px/);
    expect(tokens).toMatch(/--gc-lift-lg:\s*(\d+)px/);
    const [lift, liftLg] = [/--gc-lift:\s*(\d+)px/, /--gc-lift-lg:\s*(\d+)px/].map((re) =>
      Number(re.exec(tokens)![1]),
    );
    expect(liftLg).toBeGreaterThan(lift);
    // THE COLOUR is the theme's FLAT ACCENT, solid (owner 2026-08-06: "the actual same colour for all of
    // those things"). It shipped for a day as the kit's own 60%-transparent mix, which reads as a washed
    // accent rather than the accent. Bound to the existing derivation — never a parallel literal — so all
    // eight variants re-tint it, and measured to land ON the active tab indicator's hard shadow: exactly
    // equal on ember/glacier/nebula/eridu/jade, and 3/255 of blue apart on the arcade trio, whose
    // `--gc-ind-shadow` is a deliberate near-trio value the palette note says not to unify.
    expect(tokens).toContain("--gc-lift-color: var(--accent)");
    expect(tokens, "the drop must not be a washed mix again").not.toMatch(
      /--gc-lift-color:\s*color-mix/,
    );
    expect(kit, "the kit block this mirrors must still be the 3px/60% signature").toContain(
      "--arcade-lift: 3px",
    );
    expect(kit).toContain(
      "var(--arcade-lift) var(--arcade-lift) 0 color-mix(in oklch, var(--accent) 60%, transparent)",
    );
  });

  it("declares the COLOUR on `body`, never `:scope` (the §14.6 substitution trap)", () => {
    // Caught by measurement, not review: a custom property substitutes its `var()` where it is DECLARED
    // and is inherited already-substituted, so on `html` this took the KIT's base `--accent` and the cards'
    // drop rendered TEAL under every gacha accent. The DISTANCE is a constant and may stay on `:scope`.
    const base = blockFor(tokens, ":scope")!;
    // the `body`-scoped formula block (tokens.css declares `:scope, body` then a `body`-only block)
    const body = tokens.slice(tokens.indexOf("\n    body {"));
    expect(base).toMatch(/--gc-lift:\s*\d+px/);
    expect(base).not.toContain("--gc-lift-color");
    expect(body).toContain("--gc-lift-color");
  });

  it("paints the CARD's drop from the button's pseudo, wearing the face's own mask", () => {
    // The face is masked AND `overflow: hidden`, and a mask is applied after filters — pixel-probed:
    // `box-shadow` and `filter: drop-shadow()` on a masked element both paint NOTHING in the offset band.
    // The drop therefore lives on a box outside it — the BUTTON's own pseudo (Codex wave-12 #5 put the
    // button on the outside so the visible drop is tappable) — wearing the SAME mask, so the 315° notch is
    // cut in the shadow too.
    const drop = ruleBlock(rules, ".gc-card::before {");
    expect(drop).toContain("background: var(--gc-lift-color)");
    expect(drop).toContain("mask: var(--gc-card-mask)"); // the capsule silhouette, not a rectangle
    expect(drop).toContain("inset: var(--gc-lift) 0 0 var(--gc-lift)"); // the face's box, moved by the lift
    // …and the FIT ruling: the button keeps the footprint the track always gave a card, the FACE is inset
    // inside it, so the grid can never clip the shadow and the track's rhythm is unchanged.
    // …and the BUTTON is the box that owns the footprint, with the masked FACE inset inside it.
    const card = ruleBlock(rules, "\n    .gc-card {");
    expect(card).toContain("aspect-ratio: 3/4");
    expect(card).not.toContain("mask"); // unmasked, which is the only reason its ::before survives
    const face = ruleBlock(rules, ".gc-card-face {");
    expect(face).toContain("inset: 0 var(--gc-lift) var(--gc-lift) 0");
    expect(face).toContain("mask: var(--gc-card-mask)");
  });

  it("…and the DOSSIER portrait takes a plain box-shadow, because nothing masks it", () => {
    // anchored on the line start: `.gc-dossier .avatar` also opens the VT-naming rule above it.
    const av = ruleBlock(rules, "\n    .gc-dossier .avatar {");
    // …at the LARGER lift: the owner's device round read the cards' 3px as "a little too slim" on a
    // 104x138 picture. Two tokens, one family — never a literal on the rule.
    expect(av).toContain("var(--gc-lift-lg) var(--gc-lift-lg) 0 var(--gc-lift-color)");
    expect(tokens).toMatch(/--gc-lift:\s*\d+px/);
    expect(tokens).toMatch(/--gc-lift-lg:\s*\d+px/);
    // the soft contact shadow survives UNDER it — one crisp offset over one broad haze
    expect(av).toContain("var(--gc-dossier-art-shadow)");
  });
});

describe("gacha M7 — the oracle's BOTTOM DISSOLVE, split in two (owner reports 2026-08-06)", () => {
  it("dissolves the COMB always, and the ART only once it starts ghosting", () => {
    // ① the scanline's own mask runs for the whole of fade mode — the owner likes the softened comb at
    // rest too. On the scan LAYER, because a mask is applied to an element's own rendering BEFORE it is
    // blended into its parent: the comb's alpha ramps down first and `mix-blend-mode: screen` then
    // contributes nothing at the bottom.
    expect(ruleBlock(rules, 'body[data-oracle="fade"] .gc-oracle-scan {')).toContain(
      "mask-image: var(--gc-oracle-edge-mask)",
    );
    // ② the BLOCK's mask is gated on the driver's boolean stamp, so at rest the art keeps the designed
    // crisp bottom edge and only the ghosting state dissolves it.
    const gated = ruleBlock(rules, 'body[data-oracle="fade"] .gc-oracle[data-gc-ghosting] {');
    expect(gated).toContain("mask-image: var(--gc-oracle-edge-mask)");
    expect(gated).toContain("-webkit-mask-image: var(--gc-oracle-edge-mask)");
    // …and the UNGATED fade rule must NOT carry one, or the gate would be decorative.
    expect(ruleBlock(rules, 'body[data-oracle="fade"] .gc-oracle {')).not.toContain("mask-image");
    // MODE-SCOPED: outside fade mode the block is a header you scroll past — nothing to dissolve into.
    expect(ruleBlock(rules, "\n    .gc-oracle {")).not.toContain("mask");
  });

  it("keys on a BOOLEAN, never on the ramp — the per-frame re-raster M7 exists to avoid", () => {
    // A mask whose GEOMETRY tracked `--gc-oracle-p` would re-rasterize a gradient every scroll frame; the
    // stamp flips at most twice per gesture and the driver writes it only on a flip.
    const mask = /--gc-oracle-edge-mask:([\s\S]*?);/.exec(tokens)![1];
    expect(mask).not.toContain("--gc-oracle-p");
    expect(mask).toContain("var(--gc-oracle-edge-fade)"); // the band is the tunable, and it is one token
    expect(tokens).toMatch(/--gc-oracle-edge-fade:\s*\d+px/);
  });
});

describe("gacha — the capsule plate's CLIPPED NAME (C6, owner's pick 2026-08-06)", () => {
  it("paints the accent fill through the glyphs, at the theme's calm-window spread", () => {
    const b = ruleBlock(rules, ".gc-card .plate b {");
    expect(b).toContain("background-image: var(--accent-fill)");
    // `--gc-fill-spread` is this theme's own convention for a small element: a gradient fills its box, so a
    // four-letter name would run the whole pink→violet sweep. 240% shows the ramp's calm MIDDLE instead —
    // the same treatment the seg chips and the composer's mic/send pair take.
    expect(b).toContain("background-size: var(--gc-fill-spread) 100%");
    expect(b).toContain("background-position: 50% 0");
    expect(b).toContain("-webkit-background-clip: text");
    expect(b).toContain("background-clip: text");
    expect(b).toContain("color: transparent");
  });

  it("ships SHADOWLESS, explicitly — a clipped fill and a text-shadow are mutually exclusive", () => {
    // VERIFIED on both engines by the candidate sheet (§4.3): `text-shadow` paints ON TOP of a
    // `background-clip: text` fill, so the plate's halo would flood the letterforms it should sit behind.
    // The kit has the same gotcha from the other direction — an INHERITED text-shadow paints inside
    // gradient-clipped glyphs, which is why the clear-appbar wordmark nulls the kit's halo — so the rule
    // states `none` rather than trusting that nothing upstream sets one.
    const b = ruleBlock(rules, ".gc-card .plate b {");
    expect(b).toContain("text-shadow: none");
    expect(b).not.toContain("var(--gc-plate-shadow)");
  });

  it("gates the VISIBLE slice of the ramp, derived from the same brand stops", () => {
    // Gating against `--accent-fill` would measure two colours the glyphs can never show (the spread hides
    // both ends) — the "modelled a paint the screen does not make" class, one axis over: here it is the INK.
    expect(tokens).toContain("--gc-name-fill-window");
    const win = /--gc-name-fill-window:([\s\S]*?);/.exec(tokens)![1];
    // derived from the SAME two brand tokens the ramp is built from, so every accent re-derives it
    expect(win).toContain("var(--gc-brand-1)");
    expect(win).toContain("var(--gc-brand-2)");
    expect(win, "the window must not be a literal").not.toMatch(/#[0-9a-f]{3,8}/i);
    // …and the gate must actually read it (a token nothing measures is decoration)
    expect(contrast).toContain('fg: "--gc-name-fill-window"');
  });
});
