/// <reference types="node" />
// ^ this file reads stylesheets from disk (fs/path/process); the tests tsconfig pins `types:["vitest"]`,
//   so node's globals are pulled in explicitly (the gachaChrome/themeContract precedent).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// THE GRADIENT-RIM CLASS (OF-2, the owner's S4 round 2026-09-07) — third occurrence, now pinned.
//
// THE MECHANISM. A background gradient is POSITIONED against the padding box (`background-origin`'s
// default) but PAINTED across the border box (`background-clip`'s default), and the paint repeats — so the
// strip the border occupies is filled by tiling the ramp: the left strip renders the gradient's LAST stop,
// the right strip its FIRST. With `border-color: transparent` (which every control here uses to keep the
// base rule's metrics while dropping its line) those strips read as two SOLID rims in the ramp's end
// colours — the owner's original report on the gacha dossier act was "pink one side, violet the other".
// The fix is one declaration: `background-clip: padding-box`.
//
// WHY A TEST. The class recurred three times because the defect is invisible in the source — a rule that
// sets a gradient and a border looks complete, and the rim only appears once the two are rendered
// together. It is also invisible in a screenshot review at phone width, where a 1px rim on a rounded edge
// reads as anti-aliasing. Pinning the swept sites means a future edit that rewrites one of these fills
// cannot silently drop the clip, and a reader who deletes it "because nothing paints there" is told why.
//
// A SOURCE-LEVEL check, deliberately, and for the same reason gachaChrome's layer-trap guard is one: the
// failure mode is a DELETED declaration, which reading the sheet proves directly, while observing the rim
// itself needs a per-theme pixel comparison of a 1px strip. The kit banner's own clip is additionally
// measured in `e2e/layout.spec.ts` (D54), the only place the cascade actually runs.

const kit = readFileSync(resolve(process.cwd(), "src/theme-engine/kit/kit.css"), "utf8");
const cosmos = readFileSync(resolve(process.cwd(), "src/themes/cosmos/cosmos.css"), "utf8");
const vapor = readFileSync(resolve(process.cwd(), "src/themes/vapor/vapor.css"), "utf8");
const vaporExtras = readFileSync(resolve(process.cwd(), "src/themes/vapor/extras.css"), "utf8");
const gacha = readFileSync(resolve(process.cwd(), "src/themes/gacha/gacha.css"), "utf8");

/** Strip comments so a declaration NAMED in prose can't satisfy a check for the declaration itself. */
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** One rule's own declarations, found by its authored header (the gachaChrome helper). */
function ruleBlock(source: string, selector: string): string {
  const at = source.indexOf(selector);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  return /\{([^{}]*)\}/.exec(source.slice(at))![1];
}

// Every control that fills itself with a gradient AND carries a border on the same element — the pair that
// produces the rim. A member is a [file, header, what it is] triple; the header is the anchor, newline-led
// where a longer selector above would otherwise match first.
const SWEPT: [name: string, css: string, header: string][] = [
  ["the agents/machine detail SAVE button", kit, ".kit .mconf .mfoot button.save {"],
  ["the Conf textarea save pill", kit, ".kit .conf-save {"],
  ["the tool/skill allowlist chips", kit, ".kit .tick-grid .tick.on {"],
  ["the switch knob, on", kit, ".kit .switch.on .knob {"],
  ["cosmos's primary host action", cosmos, ".cosmos-hd .hd-act.primary {"],
  ["vapor's plan-pin tab", vaporExtras, "\n.plan-pin-head {"],
  ["vapor's fleet summary card", vapor, "\n  .summary {"],
  ["gacha's ONLINE ribbon", gacha, ".gc-card .state.on {"],
];

// The two sites that already carry the clip — the precedents this sweep generalizes. They are pinned here
// too, so the class stays closed from both ends: 57e106a (the gacha dossier act, the owner's first report)
// and the D54 kit banner (the same clip, arrived at from the art side).
const PRECEDENTS: [name: string, css: string, header: string][] = [
  ["gacha's dossier act (57e106a)", gacha, ".gc-act.primary {"],
  ["the kit owner-art banner (D54)", kit, ".kit .kit-svc-banner {"],
];

describe("OF-2 — a gradient fill under a border is clipped to the padding box", () => {
  it.each([...SWEPT, ...PRECEDENTS])("%s", (_name, css, header) => {
    const block = ruleBlock(strip(css), header);
    // the pair that makes the rim: this rule paints a gradient — literal, or a `*-fill` token that
    // resolves to one on the themes that ship a ramp (vapor/frontier/gacha)…
    expect(block).toMatch(/background(-image)?:[^;]*(gradient|-fill)/);
    // …so it must not let that paint reach the border strip.
    expect(block).toContain("background-clip: padding-box");
    // …and the clip must FOLLOW every `background:` shorthand in the block — the shorthand resets
    // background-clip to border-box, so an appended fill after the clip would silently re-open the rim
    // (the same local ordering hazard gachaChrome pins for background-origin).
    expect(block.lastIndexOf("background:")).toBeLessThan(
      block.indexOf("background-clip: padding-box"),
    );
  });
});
