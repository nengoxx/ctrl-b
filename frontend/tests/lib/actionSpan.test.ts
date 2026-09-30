import { describe, expect, it } from "vitest";

import { ACTION_OPEN, ACTION_OPENER, ACTION_SPAN } from "../../src/lib/actionSpan";

// lib/actionSpan — the ONE single-asterisk pairing rule the eye (lib/markdown) and the ear
// (lib/toSpeech) share (session-51 polish #2). Pinned as behavior: what counts as a span, an unclosed
// tail, and an opener.

const spans = (s: string) => [...s.matchAll(ACTION_SPAN)].map((m) => m[0]);

describe("ACTION_SPAN — a closed `*…*` span", () => {
  it("pairs an opener with the next single `*`, across line and paragraph breaks", () => {
    expect(spans("a *b* c")).toEqual(["*b*"]);
    expect(spans("*one\ntwo*")).toEqual(["*one\ntwo*"]);
    expect(spans("*one\n\ntwo*")).toEqual(["*one\n\ntwo*"]);
  });

  it("needs a non-space after the opener, so arithmetic never pairs", () => {
    expect(spans("3 * 4 * 5")).toEqual([]);
  });

  it("never opens glued to a word or a `*`, and never closes on half of a `**` (fix wave 1)", () => {
    expect(spans("**CPU**: 12%\n**RAM**: 40%")).toEqual([]);
    expect(spans("**one\n two**")).toEqual([]);
    expect(spans("2*3 and f*ck*")).toEqual([]);
  });
});

describe("ACTION_OPEN — an opener nothing closed, at end of input", () => {
  it("matches an unclosed tail, including one that runs over lines", () => {
    expect("She smiles. *walks away\nslowly".match(ACTION_OPEN)?.[0]).toBe("*walks away\nslowly");
  });

  it("ignores a closed span, a spaced `*`, and half of a `**`", () => {
    expect(ACTION_OPEN.test("a *b* c")).toBe(false);
    expect(ACTION_OPEN.test("3 * 4")).toBe(false);
    expect(ACTION_OPEN.test("an **unclosed bold")).toBe(false);
    expect(ACTION_OPEN.test("2*3 = 6")).toBe(false); // intraword — never the rest of the reply
  });
});

describe("ACTION_OPENER — where an em opener sits", () => {
  it("finds the first `*` + non-space that is not half of a `**`", () => {
    expect("x **b** *y".search(ACTION_OPENER)).toBe(8);
    expect("3 * 4".search(ACTION_OPENER)).toBe(-1);
    expect("2*3 *go".search(ACTION_OPENER)).toBe(4);
  });
});
