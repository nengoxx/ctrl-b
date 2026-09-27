/// <reference types="node" />
// ^ reads a stylesheet from disk; the tests tsconfig pins `types:["vitest"]` (the micGestureCss precedent).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { cssRules } from "../themes/cssRules";

// Two one-rule Kit polish items (session 50, vault STYLE-001 + COMPOSER-001). Both live entirely in
// kit.css, so this is a SOURCE-level pin in the micGestureCss / gradientRim shape: the failure mode is a
// deleted or forked declaration, which reading the sheet proves directly. The em's CONTRAST is measured
// where the cascade really runs — the e2e contrast matrix (`e2e/contrast.spec.ts`, the bot-italics probe);
// the scrollbar's absence is the owner's eyeball.

const kit = readFileSync(resolve(process.cwd(), "src/theme-engine/kit/kit.css"), "utf8");
const RULES = cssRules(kit);

/** Every declaration the sheet gives exactly `selector` (whitespace-normalized), across all its rules. */
function declarationsFor(selector: string): string {
  const bodies = RULES.filter((r) => r.selector === selector).map((r) => r.declarations);
  if (bodies.length === 0) throw new Error(`no rule for ${selector}`);
  return bodies.join("\n").replace(/\s+/g, " ");
}

describe("STYLE-001 · bot-bubble italics carry a subtle accent tint", () => {
  it("the ONE em rule mixes the accent toward the surrounding ink, behind the --kit-em-tint dial", () => {
    const d = declarationsFor(".kit .b.bot .md em");
    expect(d).toContain("font-style: italic");
    expect(d).toContain(
      "color: color-mix(in oklch, var(--accent) var(--kit-em-tint, 40%), currentColor)",
    );
  });

  it("no second rule forks it — the dial is the only per-theme lever", () => {
    const forks = RULES.filter(
      (r) => r.selector.includes(".md em") && r.selector !== ".kit .b.bot .md em",
    );
    expect(forks.map((r) => r.selector)).toEqual([]);
  });
});

describe("COMPOSER-001 · the composer textarea hides its scrollbar and keeps scrolling", () => {
  it("the SHARED textarea rule (every variant + skin) sets the standard property", () => {
    const d = declarationsFor(".kit-composer textarea");
    expect(d).toContain("scrollbar-width: none");
    expect(d).not.toMatch(/overflow(-y)?:\s*hidden/); // hiding the bar must not stop the scroll
  });

  it("…and the legacy WebKit pseudo-element is hidden too", () => {
    expect(declarationsFor(".kit-composer textarea::-webkit-scrollbar")).toContain("display: none");
  });
});
