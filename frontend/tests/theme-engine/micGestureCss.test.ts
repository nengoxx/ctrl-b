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
// given it away. The knob exists so that cannot happen; this says so. OF-2 (as re-ruled in the owner's
// ROUND 2, 2026-09-13): the pill is a TRUE STADIUM — a real box whose HEIGHT tracks the lift under
// `border-radius: 999px` (the round-1 scaleY gave an ellipse at rest, rejected by eye). The height is a
// RECORDED exception to §14.11's transform-only rule (the composer auto-grow precedent; the kit.css block
// comment carries the justification), fenced by `contain: layout` on the rail — which is exactly what
// these pins hold in place.

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
    expect(declarations[0]).toContain("1.65"); // owner-tuned: 2.2× (Telegram) → 1.8 → 1.65 (round 2)
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

describe("OF-2 · the lock pill is a TRUE STADIUM compressing into a circle (owner round 2)", () => {
  it("the SKIN's HEIGHT tracks the lift under a full radius — straight sides, semicircular caps", () => {
    const skin = declarationsFor(".mg-rail-skin");
    expect(skin).toMatch(/height:\s*calc\(/);
    expect(skin).toContain("--mg-lift");
    expect(skin).toContain("--mg-pill-scale");
    expect(skin).toContain("border-radius: 999px");
    // the round-1 ellipse mechanism is gone — a returning scaleY would re-ship the rejected shape
    expect(skin).not.toContain("scaleY(");
    // the recorded §14.11 exception travels with its fence: the rail contains its own reflow
    expect(declarationsFor(".mg-rail")).toContain("contain: layout");
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
      "height: calc(var(--mg-dot) * var(--mg-pill-scale))",
    );
    expect(declarationsFor('body[data-motion="reduced"] .mg-rail.armed .mg-rail-skin')).toContain(
      "height: var(--mg-dot)",
    );
    expect(css).not.toContain("prefers-reduced-motion");
  });
});

describe("round 2 · the composer placeholder yields to the slide-to-cancel track", () => {
  it("both RECORDING stages hide it, and only through the chrome's own data-stage", () => {
    // The chrome is the composer's SIBLING, so the reach is body:has() (the seam-scrim precedent).
    const rule = declarationsFor(
      'body:has(.mic-gesture[data-stage="hold"]) .kit-composer textarea::placeholder',
    );
    expect(rule).toContain("color: transparent");
    expect(
      declarationsFor(
        'body:has(.mic-gesture[data-stage="locked"]) .kit-composer textarea::placeholder',
      ),
    ).toContain("color: transparent");
  });

  it("the cancel ✕ carries its own thicker stroke, scoped to the morph face", () => {
    expect(declarationsFor(".kit .kit-cbtn.tools .tools-x svg")).toContain("stroke-width: 2.6");
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
