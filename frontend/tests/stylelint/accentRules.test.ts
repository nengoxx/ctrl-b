// @vitest-environment node
import { fileURLToPath } from "node:url";

import stylelint from "stylelint";
import { describe, expect, it } from "vitest";

// Regression tests for `ctrlb/accent-fill-contexts` — the ALIAS HOLE the G6 Codex round found (F2).
//
// The rule's whole job is that a gradient-capable `--*-fill` token can only be READ where a gradient
// survives. Before this it matched `--accent-fill` BY NAME in the value, so one legal alias hop
// (`--foo-fill: var(--accent-fill)`, which the rule itself permits) produced a token the rule had never
// heard of, and `color: var(--foo-fill)` smuggled the gradient onto a <color>-only property — the exact
// failure the rule exists to prevent, one indirection later. The three cases below pin the fix: the
// direct form still fails, the aliased form now fails too, and the legitimate alias→background path
// still passes (that path is real — gacha's `--gc-dossier-act-fill: var(--accent-fill)`).
//
// Driven through stylelint's Node API on inline CSS rather than by importing the plugin's rule function:
// that exercises the plugin exactly as the config loads it (default-exported ARRAY, relative path), so a
// packaging mistake fails here too. The plugin path is absolute so the run is cwd-independent.

const PLUGIN = fileURLToPath(new URL("../../stylelint/ctrlb-accent-rules.js", import.meta.url));

/** Lint a CSS string with ONLY the fill rule on; returns its warnings. */
async function lint(code: string) {
  const { results } = await stylelint.lint({
    code,
    config: {
      plugins: [PLUGIN],
      rules: { "ctrlb/accent-fill-contexts": true },
    },
  });
  return results[0].warnings;
}

describe("ctrlb/accent-fill-contexts", () => {
  it("rejects a DIRECT read of --accent-fill on a <color>-only property", async () => {
    const warnings = await lint(`.a { color: var(--accent-fill); }`);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].rule).toBe("ctrlb/accent-fill-contexts");
    expect(warnings[0].severity).toBe("error");
    expect(warnings[0].text).toContain("--accent-fill");
    expect(warnings[0].text).toContain("color");
  });

  it("rejects a ONE-HOP ALIAS read — the hole: the alias declaration is legal, its consumer is not", async () => {
    const warnings = await lint(
      `:root { --foo-fill: var(--accent-fill); } .a { color: var(--foo-fill); }`,
    );
    // Exactly one: the alias DECLARATION is allowed (a `--*-fill` custom property), the consumer is not.
    expect(warnings).toHaveLength(1);
    expect(warnings[0].text).toContain("--foo-fill");
    expect(warnings[0].line).toBe(1);
  });

  it("passes a legitimate alias read on an <image>-capable property", async () => {
    const warnings = await lint(
      `:root { --foo-fill: var(--accent-fill); }\n` +
        `.a { background: var(--foo-fill); }\n` +
        `.b { background-image: linear-gradient(var(--foo-fill), var(--accent-fill)); }\n` +
        `.c { mask-image: var(--foo-fill); }`,
    );
    expect(warnings).toEqual([]);
  });

  it("rejects background-COLOR — a <color>-only property the old prefix match let through", async () => {
    // Codex fix-set R2 #2: `background-color` starts with "background", so a prefix-shaped allowlist
    // admitted exactly the property where a gradient fill dies. The list is exact now; the longhand that
    // looked most like an allowed one is the regression worth pinning.
    const warnings = await lint(`.a { background-color: var(--accent-fill); }`);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].text).toContain("background-color");
  });
});
