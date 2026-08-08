// A tiny stylesheet reader for the enumeration tests (Codex E2 MED-4, hardened at the confirm round).
//
// WHY IT EXISTS. The gacha layout tests make ENUMERATION claims — "every rule keyed on `data-gc-fleet` is
// poster's and none of them paints a background", "every banner rule the cover adds is scoped to its own
// seat". Those claims were first checked with a line-anchored regex, which only ever saw SINGLE-LINE
// headers at one indent, so an ordinary multi-line selector list walked straight past the guard. That is a
// false NEGATIVE in a test whose entire job is to fail.
//
// THE SCANNER IS LEXICAL, and it has to be: CSS text is not safely readable with brace counting alone.
// Three shapes defeat a naive scan, and all three are real selectors a future rule could carry —
//
//   body[data-gc-fleet="cover"][data-probe="}"] .gc-banner { … }   a QUOTED brace ends the header early
//   body[data-gc-fleet="poster"] :is(.x, .kit-main) { … }          a nested comma splits one selector in two
//   body[data-gc-fleet="poster"] .x { content: "}"; background: red }   a quoted brace truncates the body
//
// — so this tracks string state (both quote characters, with backslash escapes) and comment state on one
// pass, splits selector lists only at TOP-LEVEL commas, and reads declarations at brace depth zero.
//
// NOT PostCSS: it is not a declared dependency of this project (it arrives only transitively under
// stylelint), and the repo's CI has already been bitten once by leaning on an undeclared tool. A scanner
// is all the claim needs — the tests assert on selector TEXT and declaration TEXT, never on computed
// values.

/** One rule: its complete selector header (whitespace normalized) and its own declarations. */
export interface CssRule {
  /** The whole header as authored, comma-separated list included, newlines collapsed to single spaces. */
  selector: string;
  /** Everything between this rule's braces — nested rules included. */
  body: string;
  /** The body at brace depth ZERO: nested rules and their headers removed, quoted braces preserved, so a
   *  `background` found here is unambiguously this rule's own declaration. */
  declarations: string;
}

/** Where the scanner is: ordinary text, inside a string, or inside a comment. */
type Lex = { quote: string | null };

/**
 * Advance past whatever non-code construct starts at `i`, returning the next index to read — or `i`
 * itself when the character is ordinary code. ONE place that knows how strings, escapes and comments
 * consume text, so every walk below stays in agreement about what is code.
 */
function skip(src: string, i: number, lex: Lex): number {
  const ch = src[i];
  if (lex.quote !== null) {
    if (ch === "\\") return i + 2; // an escaped anything, including the quote itself
    if (ch === lex.quote) lex.quote = null;
    return i + 1;
  }
  if (ch === '"' || ch === "'") {
    lex.quote = ch;
    return i + 1;
  }
  if (ch === "/" && src[i + 1] === "*") {
    const end = src.indexOf("*/", i + 2);
    return end < 0 ? src.length : end + 2;
  }
  return i;
}

/** Strip comments from a selector header (they are legal there and say nothing about what it matches). */
const cleanSelector = (raw: string): string =>
  raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim()
    .replace(/\s+/g, " ");

/**
 * Every rule in a stylesheet, at every nesting depth, with multi-line selector lists collected whole.
 * At-rules (`@layer`, `@scope`, `@media`, `@keyframes`) come back too — their "selector" is the at-rule
 * header — and their children are emitted as their own entries, which is what lets a caller filter by
 * selector text without caring how deeply the file nests.
 */
export function cssRules(css: string): CssRule[] {
  const out: CssRule[] = [];
  const open: { selector: string; bodyStart: number }[] = [];
  const lex: Lex = { quote: null };
  let headStart = 0;
  let i = 0;
  while (i < css.length) {
    const next = skip(css, i, lex);
    if (next !== i) {
      i = next;
      continue;
    }
    const ch = css[i];
    if (ch === "{") {
      open.push({ selector: cleanSelector(css.slice(headStart, i)), bodyStart: i + 1 });
      headStart = i + 1;
    } else if (ch === "}") {
      const rule = open.pop();
      if (rule && rule.selector !== "") {
        const body = css.slice(rule.bodyStart, i);
        out.push({ selector: rule.selector, body, declarations: declarationsOf(body) });
      }
      headStart = i + 1;
    }
    i++;
  }
  return out;
}

/** A rule body reduced to its OWN declarations: everything at brace depth zero, with the headers of
 *  nested rules dropped. Quote-aware, so `content: "}"` neither closes a block nor truncates what
 *  follows it. */
function declarationsOf(body: string): string {
  const lex: Lex = { quote: null };
  let out = "";
  let seg = "";
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const next = skip(body, i, lex);
    if (next !== i) {
      // a string's contents belong to the declaration; a comment's do not
      if (lex.quote !== null || body[i] === '"' || body[i] === "'") seg += body.slice(i, next);
      i = next;
      continue;
    }
    const ch = body[i];
    if (ch === "{") {
      depth++;
      seg = ""; // whatever we had accumulated was a NESTED rule's header, not a declaration
    } else if (ch === "}") {
      depth--;
      seg = "";
    } else if (depth === 0) {
      seg += ch;
      if (ch === ";") {
        out += seg;
        seg = "";
      }
    }
    i++;
  }
  return out + seg; // a trailing declaration with no semicolon
}

/** Split a selector list at TOP-LEVEL commas only — the ones that separate selectors. A comma inside
 *  `:is(…)` / `:where(…)` / `:not(…)` or an attribute bracket belongs to that selector and must not tear
 *  it in half, or a `.kit-main` hidden inside `:is()` walks out of the list unexamined. */
export function splitSelectors(list: string): string[] {
  const lex: Lex = { quote: null };
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let i = 0;
  while (i < list.length) {
    const next = skip(list, i, lex);
    if (next !== i) {
      cur += list.slice(i, next);
      i = next;
      continue;
    }
    const ch = list[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
    i++;
  }
  if (cur.trim() !== "") out.push(cur.trim());
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
      splitSelectors(rule.selector)
        .filter((s) => s.includes(needle))
        .map((selector) => ({ selector, rule })),
    );
}
