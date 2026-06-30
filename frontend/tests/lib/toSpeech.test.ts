import { describe, expect, it } from "vitest";

import { toSpeech } from "../../src/lib/toSpeech";

// lib/toSpeech — strips Markdown to plain prose for TTS (so the synth reads words, not syntax).

describe("toSpeech", () => {
  it("strips inline emphasis, code, and links to their text", () => {
    expect(toSpeech("**bold** and `code` and [link](http://x) and _em_")).toBe(
      "bold and code and link and em",
    );
  });

  it("strips block syntax (headings, lists, quotes) and collapses whitespace", () => {
    const md = "## Heading\n\n- one\n- two\n\n> a quote\n\n1. first";
    expect(toSpeech(md)).toBe("Heading one two a quote first");
  });

  it("drops fenced code blocks entirely", () => {
    expect(toSpeech("before\n\n```js\nconst x = 1;\n```\n\nafter")).toBe("before after");
  });

  it("returns empty for code-only content (→ caller skips synth, no playback)", () => {
    expect(toSpeech("```\nonly code\n```")).toBe("");
    expect(toSpeech("   ")).toBe("");
  });

  it("strips stray inline HTML tags so TTS never voices '<div>'", () => {
    expect(toSpeech("hello <b>there</b> <br/> world")).toBe("hello there world");
  });

  it("leaves plain prose untouched", () => {
    expect(toSpeech("Just a normal sentence.")).toBe("Just a normal sentence.");
  });
});
