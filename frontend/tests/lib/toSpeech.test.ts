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

  it("speaks strikethrough as its inner text (the one-group regex must use $1, not $2)", () => {
    expect(toSpeech("emma is ~~offline~~ online")).toBe("emma is offline online");
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

  // ── D74/S1 — the residual asterisk scrub ───────────────────────────────────────────────────────
  // An asterisk is never speakable. Read-along deliberately does NOT cut on a single `*` (stalling
  // beats muting, owner-ruled), so a multi-sentence roleplay action is cut mid-span and both halves
  // used to carry a literal `*` into the synth text — the owner's measured "scratching".

  it("scrubs a residual `*` from BOTH halves of a mid-span cut (the roleplay-action bug)", () => {
    // the cut the feeder actually makes: the opener rides the first half, the closer the second
    expect(toSpeech("*He leans in. ")).toBe("He leans in.");
    expect(toSpeech("Then he smiles.* Hello.")).toBe("Then he smiles. Hello.");
    expect(toSpeech("*He leans in.\nThen he smiles.*")).toBe("He leans in.\nThen he smiles.");
  });

  it("still unwraps a paired italic — the scrub only ever sees what pairing left behind", () => {
    expect(toSpeech("that is *really* bad")).toBe("that is really bad");
    expect(toSpeech("**emma** is *up*")).toBe("emma is up");
  });

  it("'3 * 4' loses its star to a space (accepted: it was never spoken as 'times' either)", () => {
    expect(toSpeech("3 * 4")).toBe("3 4");
  });

  it("leaves a residual underscore alone — snake_case is out of the scrub's scope (D74/S1)", () => {
    // Only `*` is scrubbed. An UNPAIRED `_` rides through untouched, exactly as before; a paired one
    // is unwrapped by the italic pass above, which is pre-D74 behavior this slice does not touch.
    expect(toSpeech("check auto_stop now")).toBe("check auto_stop now");
  });

  // ── D74/S2 — `speakActions: false` ─────────────────────────────────────────────────────────────
  // An action is a stage direction, not speech. Pairing matches lib/markdown.tsx's `em` rule, so the
  // ear drops exactly what the eye italicizes; bold still unwraps, because emphasis IS speech.

  const skip = { speakActions: false } as const;

  it("drops a closed action span, including one that runs over several lines", () => {
    expect(toSpeech("*He leans in.* Hello there.", skip)).toBe("Hello there.");
    expect(toSpeech("*He leans in.\nThen he smiles.* Hello.", skip)).toBe("Hello.");
  });

  it("drops an action the model never CLOSED, from its `*` to the end", () => {
    expect(toSpeech("Hello. *He leans in and never stops", skip)).toBe("Hello.");
  });

  it("keeps bold, and keeps a lone `*` in prose from eating the rest of the reply", () => {
    expect(toSpeech("**emma** is up. *He nods.* Done.", skip)).toBe("emma is up. Done.");
    expect(toSpeech("The answer is 3 * 4. Done.", skip)).toBe("The answer is 3 4. Done.");
    expect(toSpeech("Hello. **bold never closed", skip)).toBe("Hello. bold never closed");
  });

  it("an all-action reply speaks NOTHING (→ the caller never synthesizes, no empty POST)", () => {
    expect(toSpeech("*He smiles.*", skip)).toBe("");
    expect(toSpeech("*He smiles.*")).toBe("He smiles."); // …and is spoken in full by default
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
    // constantly. The price used to be an audible one: a span that closed across a feed boundary spoke
    // its opening delimiter. D74's scrub deletes it, so the cut now costs nothing you can HEAR — which
    // is what keeps the no-stall ruling standing. This is the ONE construct excluded from the pipeline
    // property test in tests/lib/ttsChunks.test.ts.
    expect(stableMarkdownPrefix("that is *really")).toBe("that is *really");
    expect(stableMarkdownPrefix("check auto_stop_sil")).toBe("check auto_stop_sil");
    expect(toSpeech("that is *really")).toBe("that is really"); // …and the delimiter is scrubbed
    expect(toSpeech("that is *really* bad")).toBe("that is really bad"); // …as it is at the flush
  });

  // ── D74/S2 — under `speakActions: false` the single-asterisk pair JOINS the list ────────────────
  // The exclusion above holds because a leaked delimiter is inaudible. Under skip mode the WORDS are
  // what a span decides, and where it ends is unknowable mid-stream — so this mode has to hold.

  it("holds at an unclosed action opener under skip mode, and is identity once it closes", () => {
    const skip = { speakActions: false } as const;
    expect(stableMarkdownPrefix("Hello. *He leans", skip)).toBe("Hello. ");
    expect(stableMarkdownPrefix("Hello. *He leans.* Ok", skip)).toBe("Hello. *He leans.* Ok");
    // …and it is still an `em` opener it holds on, so ordinary prose costs read-along nothing.
    expect(stableMarkdownPrefix("3 * 4 is twelve", skip)).toBe("3 * 4 is twelve");
    expect(stableMarkdownPrefix("check auto_stop_sil", skip)).toBe("check auto_stop_sil");
    // an unclosed BOLD is still cut by bold's own rule, one pass earlier — not read as an action
    expect(stableMarkdownPrefix("emma is **up and re", skip)).toBe("emma is ");
  });
});
