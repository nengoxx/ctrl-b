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
// `var(--accent-fill)` is the GRADIENT-UNSAFE accent token (a theme may define it as a
// linear-gradient for a filled control's face). A gradient is only valid on an <image>-accepting
// property — `background` / `background-image` / the `mask` family — so `--accent-fill` must NEVER
// reach a <color>-only property (color/border/outline/box-shadow/…): there it silently collapses
// to the property's `initial`, killing the fill. This rule reports any `var(--accent-fill)` read
// outside the allowed property set. Correctness rule → error severity (zero current violations).
const fillRuleName = "ctrlb/accent-fill-contexts";
const fillMessages = ruleMessages(fillRuleName, {
  rejected: (prop) =>
    `Unexpected var(--accent-fill) on "${prop}" — the gradient-unsafe accent token may only appear on ` +
    `background / background-image / mask-* (a <color>-only property silently drops a gradient fill).`,
});
// background (shorthand), background-image, and the full mask family incl. the -webkit- prefix.
const ALLOWED_FILL_PROP = /^(?:background|background-image|(?:-webkit-)?mask(?:-|$))/i;

const accentFillContexts = createPlugin(fillRuleName, (primary) => (root, result) => {
  const valid = validateOptions(result, fillRuleName, { actual: primary, possible: [true] });
  if (!valid) return;
  root.walkDecls((decl) => {
    if (!/var\(\s*--accent-fill\b/i.test(decl.value)) return;
    if (ALLOWED_FILL_PROP.test(decl.prop)) return;
    report({
      message: fillMessages.rejected(decl.prop),
      node: decl,
      result,
      ruleName: fillRuleName,
    });
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
