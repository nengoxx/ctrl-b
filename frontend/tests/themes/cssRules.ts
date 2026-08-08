// A tiny stylesheet reader for the enumeration tests (Codex E2 MED-4).
//
// WHY IT EXISTS. The gacha layout tests make ENUMERATION claims — "every rule keyed on `data-gc-fleet` is
// poster's and none of them paints a background", "every banner rule the cover adds is scoped to its own
// seat". Those claims were checked with a line-anchored regex (`\n {4}(selector) {`), which only ever saw
// SINGLE-LINE headers at one indent. An ordinary multi-line selector list walks straight past it:
//
//     body[data-gc-fleet="cover"] .gc-banner,
//     .some-other-selector {
//       background: ...;
//     }
//
// …and the test reports green while the invariant is broken. That is a false NEGATIVE in a guard whose
// entire job is to fail, so the reader below collects complete headers across newlines instead.
//
// NOT PostCSS: it is not a declared dependency of this project (it arrives only transitively under
// stylelint), and the repo's CI has already been bitten once by leaning on an undeclared tool. This is a
// brace scanner, which is all the claim needs — the tests assert on selector TEXT and declaration TEXT,
// never on computed values.

/** One rule: its complete selector header (newlines collapsed to single spaces) and its own declarations. */
export interface CssRule {
  /** The whole header as authored, comma-separated list included, whitespace normalized. */
  selector: string;
  /** Everything between this rule's braces — nested rules included, which is why callers that care about
   *  DECLARATIONS should read `declarations` instead. */
  body: string;
  /** The body with any NESTED rule stripped, so a `background` found here really is this rule's own. */
  declarations: string;
}

/** Blank out comments in place (keeping newlines) so a brace inside one cannot open a phantom rule. */
const decomment = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

/**
 * Every rule in a stylesheet, at every nesting depth, with multi-line selector lists collected whole.
 * At-rules (`@layer`, `@scope`, `@media`, `@keyframes`) come back too — their "selector" is the at-rule
 * header — and their children are emitted as their own entries, which is what lets a caller filter by
 * selector text without caring how deeply the file nests.
 */
export function cssRules(css: string): CssRule[] {
  const src = decomment(css);
  const out: CssRule[] = [];
  let headStart = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      const selector = src.slice(headStart, i).trim().replace(/\s+/g, " ");
      let depth = 1;
      let j = i + 1;
      for (; j < src.length && depth > 0; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
      }
      const body = src.slice(i + 1, Math.max(i + 1, j - 1));
      // strip nested `header { … }` pairs (header text included) until nothing nested is left, so a
      // `background` surviving here is unambiguously THIS rule's own declaration
      let declarations = body;
      for (let prev = ""; declarations !== prev;)
        [prev, declarations] = [declarations, declarations.replace(/[^{};]*\{[^{}]*\}/g, "")];
      if (selector !== "") out.push({ selector, body, declarations });
      headStart = i + 1;
    } else if (ch === "}") headStart = i + 1;
  }
  return out;
}

/** Every rule whose selector header mentions `needle`, SPLIT into its individual selectors — so a rule
 *  that hides one offending selector inside a longer list is judged on that selector, not on the list. */
export function selectorsMentioning(
  css: string,
  needle: string,
): { selector: string; rule: CssRule }[] {
  return cssRules(css)
    .filter((r) => r.selector.includes(needle))
    .flatMap((rule) =>
      rule.selector
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.includes(needle))
        .map((selector) => ({ selector, rule })),
    );
}
