/// <reference types="node" />
// ^ this file reads a stylesheet from disk (fs/path/process); the tests tsconfig pins `types:["vitest"]`,
//   so node's globals are pulled in explicitly (the gradientRim/gachaChrome/themeContract precedent).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// THE MIC GESTURE'S PURELY-VISUAL FEEL-ROUND FINDINGS (Phase 24 / S0.5, owner 2026-09-13) — OF-1, the
// record circle's size, and OF-2, the lock pill compressing into a circle. Both live entirely in kit.css,
// so this is a SOURCE-level check, the same shape and for the same reason as
// `tests/themes/gradientRim.test.ts`: the failure mode is a DELETED or DUPLICATED declaration, which
// reading the sheet proves directly, while observing the geometry itself needs a real engine with a real
// layout (the e2e suite is where the cascade actually runs).
//
// WHY IT IS WORTH PINNING AT ALL. OF-1's whole content is "the size is stated ONCE": the 2.2× the owner
// asked to bring down to 1.8× was written as a literal in TWO places — the grow keyframe's end state and
// the reduced-motion static fallback — so an edit to one of them would have left the reduced-motion path
// painting the old size, invisibly, for exactly the users who cannot see the animation that would have
// given it away. The knob exists so that cannot happen; this says so. OF-2's invariant is the §14.11 one:
// the pill→circle morph must be transform/opacity ONLY, and the cheapest way to write it would have been
// `height`/`padding`, which animates the layout.

const kit = readFileSync(resolve(process.cwd(), "src/theme-engine/kit/kit.css"), "utf8");

/** Strip comments so a value NAMED in prose can't satisfy a check for the declaration itself. */
const css = kit.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every flat rule in the sheet, as (normalized selector list, declarations). Nested at-rules contribute
 *  their inner rules (`@keyframes`'s `from`/`to`), which is exactly what the keyframe check below wants. */
const RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1]
    .split(",")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean),
  body: m[2],
}));

/** Every declaration the sheet gives `selector`, across all of its rules — so a check is never fooled by
 *  a grouped rule that happens to be written first (`ruleBlock`'s indexOf problem). */
function declarationsFor(selector: string): string {
  const want = selector.trim().replace(/\s+/g, " ");
  const bodies = RULES.filter((r) => r.selectors.includes(want)).map((r) => r.body);
  if (bodies.length === 0) throw new Error(`no rule for ${selector}`);
  return bodies.join("\n");
}

describe("OF-1 · the record circle's grow is ONE knob", () => {
  it("declares `--mg-grow-scale` exactly once, on the chrome host", () => {
    const declarations = css.match(/--mg-grow-scale:\s*[^;]+;/g) ?? [];
    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toContain("1.8"); // owner-tuned down from Telegram's 2.2× (R69 §1.6)
    expect(declarationsFor(".mic-gesture")).toContain("--mg-grow-scale");
  });

  it("BOTH the keyframe end state and the reduced-motion fallback read it — no second literal", () => {
    // `to` is the grow keyframe's end state; nothing else in the sheet writes a `to {}` with a scale.
    expect(declarationsFor("to")).toContain("scale(var(--mg-grow-scale))");
    expect(declarationsFor('body[data-motion="reduced"] .mg-grow')).toContain(
      "scale(var(--mg-grow-scale))",
    );
    expect(css).not.toContain("scale(2.2)"); // the old literal is gone from the sheet entirely
  });

  it("…and the hint bubble hangs off the same knob rather than a re-tuned offset", () => {
    // OF-4's bubble sits just clear of the GROWN circle, so changing the grow must move the bubble.
    expect(declarationsFor(".mg-hint")).toContain("var(--mg-grow-scale)");
  });
});

describe("OF-2 · the lock pill compresses into a circle, on transform alone", () => {
  it("the SKIN is the only thing that scales, and it scales on Y off `--mg-lift`", () => {
    const skin = declarationsFor(".mg-rail-skin");
    expect(skin).toContain("scaleY(");
    expect(skin).toContain("--mg-lift");
    expect(skin).toContain("--mg-pill-scale");
    // §14.11: nothing that lays out. The cheap version of this morph is a height/padding animation.
    expect(skin).not.toMatch(/(^|[\s;])(height|width|padding|margin)\s*:/);
  });

  it("the glyph and the tail are SIBLINGS of the skin, so the squeeze never distorts them", () => {
    // Stacked in one grid cell — a column would move the flow as the tail collapses.
    expect(declarationsFor(".mg-rail-glyph")).toContain("grid-area: 1 / 1");
    expect(declarationsFor(".mg-rail-tail")).toContain("grid-area: 1 / 1");
    const tail = declarationsFor(".mg-rail-tail");
    expect(tail).toContain("--mg-lift");
    expect(tail).toContain("opacity:"); // it fades out with the chevron it carries
  });

  it("reduced motion gets DISCRETE states — pill, then circle — through body[data-motion]", () => {
    // Never a raw `@media (prefers-reduced-motion)`: the house axis is the UIState/Appearance switch.
    expect(declarationsFor('body[data-motion="reduced"] .mg-rail-skin')).toContain(
      "scaleY(var(--mg-pill-scale))",
    );
    expect(declarationsFor('body[data-motion="reduced"] .mg-rail.armed .mg-rail-skin')).toContain(
      "scaleY(1)",
    );
    expect(css).not.toContain("prefers-reduced-motion");
  });
});

describe("OF-3/OF-5 · the two rules JS writes into", () => {
  it("the halo reads `--mg-level` and rests exactly on the grown circle's rim", () => {
    const halo = declarationsFor(".mg-halo");
    expect(halo).toContain("var(--mg-level, 0)");
    expect(halo).toContain("var(--mg-grow-scale)");
    expect(halo).toContain("var(--mg-bulge)"); // R69 §1.6's +30dp over 41dp
    // ONLY transform is transitioned — the level arrives ten times a second.
    expect(halo).toMatch(/transition:\s*transform/);
  });

  it("the morphed tools trigger cross-fades on opacity/transform alone", () => {
    const morph = declarationsFor(".kit .kit-cbtn.tools .tools-x");
    expect(morph).toMatch(/transition:\s*opacity 150ms linear,\s*transform 150ms linear/);
    expect(declarationsFor(".kit .kit-cbtn.tools.cancelling .tools-x")).toContain("opacity: 1");
    // the floating twin it replaced is gone from the sheet
    expect(css).not.toContain(".mg-cancel");
  });
});
