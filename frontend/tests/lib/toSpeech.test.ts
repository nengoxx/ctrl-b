import { describe, expect, it } from "vitest";

import { stableMarkdownPrefix, toSpeech } from "../../src/lib/toSpeech";

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

// C3 S2 — `stableMarkdownPrefix`: the half of read-along that decides how much of a STILL-STREAMING
// buffer is safe to speak. Every case below is a construct `toSpeech` rewrites destructively once it
// closes, so speaking it while open would voice text the finished reply then deletes. Cutting early
// only delays speech to the turn-end flush; NOT cutting mis-speaks, so the cases are the contract.

describe("stableMarkdownPrefix", () => {
  it("cuts at the last ``` when the fence count is odd, and is identity when it is even", () => {
    const closed = "Here is the fix.\n\n```js\nconst x = 1;\n```\n\nRun it.";
    expect(stableMarkdownPrefix(closed)).toBe(closed);
    // the second fence has only opened — everything from it on would be spoken and then deleted
    expect(stableMarkdownPrefix(`${closed}\n\n\`\`\`py\nprint(`)).toBe(`${closed}\n\n`);
  });

  it("cuts an unclosed image at its `!`, so no stray '!' is left to end a sentence", () => {
    expect(stableMarkdownPrefix("Look: ![a very long alt describing the ch")).toBe("Look: ");
    expect(stableMarkdownPrefix("Look: ![alt](/media/a.png) done")).toBe(
      "Look: ![alt](/media/a.png) done",
    );
  });

  it("cuts an unclosed link at its `[` (the label is about to lose its brackets)", () => {
    expect(stableMarkdownPrefix("See [the runbook")).toBe("See ");
    expect(stableMarkdownPrefix("See [the runbook](/docs) now")).toBe(
      "See [the runbook](/docs) now",
    );
  });

  it("cuts an unclosed inline-code span at its backtick", () => {
    expect(stableMarkdownPrefix("Run `systemctl --user sta")).toBe("Run ");
    expect(stableMarkdownPrefix("Run `systemctl` now")).toBe("Run `systemctl` now");
  });

  it("cuts an unclosed tag at its `<` — any `<`, since toSpeech drops everything up to the next `>`", () => {
    expect(stableMarkdownPrefix("hello <b")).toBe("hello ");
    expect(stableMarkdownPrefix("hello <b>there</b> world")).toBe("hello <b>there</b> world");
  });

  it("cuts the multi-char emphasis pairs — ** __ ~~ — whose delimiters vanish on close", () => {
    expect(stableMarkdownPrefix("emma is **up and re")).toBe("emma is ");
    expect(stableMarkdownPrefix("emma is __up and re")).toBe("emma is ");
    expect(stableMarkdownPrefix("emma is ~~down~~ and __up and re")).toBe("emma is ~~down~~ and ");
    const closed = "emma is **up** and ~~not asleep~~";
    expect(stableMarkdownPrefix(closed)).toBe(closed);
  });

  it("cuts at the EARLIEST unclosed opener when several constructs are in flight", () => {
    // the fence opened first, so the `[` inside it is not what decides the cut
    expect(stableMarkdownPrefix("intro\n\n```\nsee [the doc")).toBe("intro\n\n");
  });

  it("leaves construct-free prose exactly alone (the common case costs nothing)", () => {
    const md = "Waking corsair now. It usually takes about a minute, then I'll check the fleet.";
    expect(stableMarkdownPrefix(md)).toBe(md);
    expect(stableMarkdownPrefix("")).toBe("");
  });

  it("does NOT cut single-char `*` / `_` — the accepted residual (owner-ruled)", () => {
    // Lone asterisks and snake_case pervade ordinary prose, so cutting on them would stall read-along
    // constantly. The price: an emphasis span that closes across a feed boundary can speak its opening
    // delimiter once — a few-word glitch at one chunk boundary, in a rare shape. This is the ONE
    // construct excluded from the pipeline property test in tests/lib/ttsChunks.test.ts.
    expect(stableMarkdownPrefix("that is *really")).toBe("that is *really");
    expect(stableMarkdownPrefix("check auto_stop_sil")).toBe("check auto_stop_sil");
    expect(toSpeech("that is *really")).toBe("that is *really"); // spoken with the delimiter…
    expect(toSpeech("that is *really* bad")).toBe("that is really bad"); // …and without it at the flush
  });
});
