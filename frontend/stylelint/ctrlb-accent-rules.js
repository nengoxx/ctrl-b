// ctrlb-accent-rules — two bespoke stylelint rules that guard the theme-engine accent contract.
//
// Why a custom plugin (§14.15.1-A ⑨ settled): no off-the-shelf stylelint plugin expresses
// "a value-token is restricted to a specific property SET" or "a custom-property DECLARATION must
// parse as a <color>". `stylelint-declaration-strict-value` only covers the INVERSE direction
// (must-USE-a-token) and is deliberately ruled OUT of this slice (smallest correct slice — it is a
// documented future option, not a need here). So we author the two rules directly on the PostCSS
// walkDecls primitive, reusing `culori` (already a devDep from item ⑧'s contrast gate) for the
// <color> parse — one source of color-parsing truth, no second parser.
//
// Placed here (frontend/stylelint/) — a sibling to the config, out of `src/**` so the app graph,
// tsc, and eslint's src type-aware zone never see it; stylelint loads it by relative path.
//
// This module default-exports an ARRAY of two plugins (the supported multi-rule plugin shape).

import stylelint from "stylelint";
import { parse as parseColor } from "culori";

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint;

// ── Rule 1: ctrlb/accent-fill-contexts ────────────────────────────────────────────────────────
// `--accent-fill` is the GRADIENT-UNSAFE accent token (a theme may define it as a linear-gradient for
// a filled control's face). A gradient is only valid on an <image>-accepting property — `background` /
// `background-image` / the `mask` family — so it must NEVER reach a <color>-only property
// (color/border/outline/box-shadow/…): there it silently collapses to the property's `initial`,
// killing the fill. Correctness rule → error severity (zero current violations).
//
// The rule checks EVERY `--*-fill` READ, not just `--accent-fill` (Codex G6 F2 — the alias hole). The
// `-fill` suffix is the repo's own declared convention for "the <image>-capable channel"
// (`--accent-fill`, `--gc-brand-fill`, `--gc-online-fill`, `--gc-switch-fill`, `--gc-dossier-act-fill`),
// and a custom property is an untyped substitution, so a gradient survives an ALIAS hop intact —
// `--foo-fill: var(--accent-fill)` is legal and useful (the theme's own naming for the same channel).
// What that means is that the mistake this rule exists to catch can be made ONE HOP LATER: the old
// value-side check only looked for `--accent-fill` by name, so `color: var(--foo-fill)` walked straight
// past it and the fill died exactly as it would have directly. Checking the SUFFIX at the consumer
// closes that with no extra bookkeeping — no cross-file alias graph, no ordering assumptions.
//
// So a `--*-fill` read is allowed in exactly two places: an <image>-capable property, or the
// declaration of ANOTHER `--*-fill` custom property (the alias hop, which is checked at ITS consumer).
// Aliasing a fill into a token NOT named `*-fill` (say `--gc-dossier-ink`) is still reported at the
// declaration, which is the naming mistake worth catching.
const fillRuleName = "ctrlb/accent-fill-contexts";
const fillMessages = ruleMessages(fillRuleName, {
  rejected: (prop, token) =>
    `Unexpected var(${token}) on "${prop}" — an <image>-capable *-fill token may only be read on ` +
    `background / background-image / mask-* or aliased into another --*-fill custom property ` +
    `(a <color>-only property silently drops a gradient fill).`,
});
// EXACTLY the <image>-capable paint properties: the background/mask shorthands + their -image longhands
// (incl. the -webkit- mask prefix). An EXACT list, not a prefix match (Codex fix-set R2 #2): the old
// `background…` prefix also matched `background-color` — a <color>-only property where a gradient dies,
// i.e. the precise mistake this rule exists to catch — and the non-image mask longhands (mask-mode,
// mask-size, …), where a fill token is never meaningful.
const ALLOWED_FILL_PROP =
  /^(?:background|background-image|(?:-webkit-)?mask|(?:-webkit-)?mask-image)$/i;
// A custom property whose own name ends in `-fill` — the alias hop (see the header).
const FILL_ALIAS_PROP = /^--[a-z0-9-]*-fill$/i;
// A READ of any `--*-fill` token: `var(--x-fill)` or `var(--x-fill, <fallback>)`, at any nesting depth
// inside the value (a stop inside a `linear-gradient()`, a layer of a `background` shorthand, …).
const FILL_READ = /var\(\s*(--[a-z0-9-]*-fill)\s*[,)]/gi;

const accentFillContexts = createPlugin(fillRuleName, (primary) => (root, result) => {
  const valid = validateOptions(result, fillRuleName, { actual: primary, possible: [true] });
  if (!valid) return;
  root.walkDecls((decl) => {
    const tokens = new Set([...decl.value.matchAll(FILL_READ)].map((m) => m[1]));
    if (tokens.size === 0) return;
    if (ALLOWED_FILL_PROP.test(decl.prop) || FILL_ALIAS_PROP.test(decl.prop)) return;
    for (const token of tokens) {
      report({
        message: fillMessages.rejected(decl.prop, token),
        node: decl,
        result,
        ruleName: fillRuleName,
      });
    }
  });
});
accentFillContexts.ruleName = fillRuleName;
accentFillContexts.messages = fillMessages;

// ── Rule 2: ctrlb/accent-is-color ─────────────────────────────────────────────────────────────
// A DECLARATION of `--accent:` must resolve to a plain <color>, never a gradient. `--accent` feeds
// focus rings, borders, and every `color-mix(… var(--accent) …)`; a gradient value makes all of
// those silently `initial` (invisible ring, no border, dead mix). We can't fully resolve a value
// statically, so the guard is conservative + precise: parse with culori — if it parses, it's a
// color (OK). If it DOESN'T parse we only reject when the value literally contains `gradient(`
// (an unambiguous gradient). A `var()` indirection to another token (e.g. minimal's
// `oklch(var(--accent-l) var(--accent-c) var(--accent-h))`, which culori can't statically parse
// because of the nested vars) is ALLOWED — we can't prove it isn't a color, and the specific
// failure we defend against is a gradient, so a plain var-chain passes. Correctness rule → error.
const colorRuleName = "ctrlb/accent-is-color";
const colorMessages = ruleMessages(colorRuleName, {
  rejected: (value) =>
    `A --accent declaration must be a <color>, not a gradient (got "${value}") — a gradient --accent ` +
    `silently kills every focus ring / border / color-mix that reads it.`,
});

const accentIsColor = createPlugin(colorRuleName, (primary) => (root, result) => {
  const valid = validateOptions(result, colorRuleName, { actual: primary, possible: [true] });
  if (!valid) return;
  root.walkDecls("--accent", (decl) => {
    const value = decl.value.trim();
    if (parseColor(value)) return; // parses as a color → OK
    if (!/gradient\(/i.test(value)) return; // var-chain / unresolvable-but-not-a-gradient → allowed
    report({
      message: colorMessages.rejected(value),
      node: decl,
      result,
      ruleName: colorRuleName,
    });
  });
});
accentIsColor.ruleName = colorRuleName;
accentIsColor.messages = colorMessages;

export default [accentFillContexts, accentIsColor];
