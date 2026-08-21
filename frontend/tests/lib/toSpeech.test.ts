import { describe, expect, it } from "vitest";

import { toSpeech } from "../../src/lib/toSpeech";

// lib/toSpeech — strips Markdown to plain prose for TTS (so the synth reads words, not syntax).
// D63 re-pinned the whitespace pass: it is NEWLINE-PRESERVING now, because its output is the chunker's
// input and the old collapse-everything erased every boundary the splitter needs. Table rows and emoji
// are dropped here (not left to the TTS server — a different endpoint in the failover chain won't).

describe("toSpeech", () => {
  it("strips inline emphasis, code, and links to their text", () => {
    expect(toSpeech("**bold** and `code` and [link](http://x) and _em_")).toBe(
      "bold and code and link and em",
    );
  });

  it("strips block syntax (headings, lists, quotes) and KEEPS their line boundaries", () => {
    const md = "## Heading\n\n- one\n- two\n\n> a quote\n\n1. first";
    expect(toSpeech(md)).toBe("Heading\n\none\ntwo\n\na quote\n\nfirst");
  });

  it("drops fenced code blocks entirely", () => {
    expect(toSpeech("before\n\n```js\nconst x = 1;\n```\n\nafter")).toBe("before\n\nafter");
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

  // ── D63 ────────────────────────────────────────────────────────────────────────────────────────

  it("collapses horizontal whitespace but keeps newlines, capping blank runs at one break", () => {
    expect(toSpeech("one   two\t\tthree")).toBe("one two three");
    expect(toSpeech("a\nb")).toBe("a\nb");
    expect(toSpeech("a   \n   b")).toBe("a\nb"); // spaces hugging a newline go with it
    expect(toSpeech("a\n\n\n\n\nb")).toBe("a\n\nb"); // 3+ → one paragraph break
    expect(toSpeech("\n\n  padded  \n\n")).toBe("padded"); // still trimmed at the ends
  });

  it("drops whole table rows — header, separator and body alike", () => {
    const md = "Results:\n\n| host | state |\n| --- | --- |\n| emma | up |\n\nDone.";
    expect(toSpeech(md)).toBe("Results:\n\nDone.");
  });

  it("strips emoji including multi-codepoint sequences, without gluing the words together", () => {
    expect(toSpeech("done ✅")).toBe("done");
    expect(toSpeech("hi🎉there")).toBe("hi there");
    expect(toSpeech("family 👨‍👩‍👧‍👦 and wave 👋🏽 done")).toBe("family and wave done");
  });

  it("an all-emoji reply speaks nothing (→ the caller never synthesizes)", () => {
    expect(toSpeech("🎉 ✅ 👋")).toBe("");
  });
});
