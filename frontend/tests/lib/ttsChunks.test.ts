import { describe, expect, it } from "vitest";

import { chunkPlan, ttsChunks, type ChunkCfg } from "../../src/lib/ttsChunks";
import { toSpeech } from "../../src/lib/toSpeech";

// lib/ttsChunks (D63) — the pure TTS chunker: `toSpeech` prose in, an ordered chunk list out. Pins the
// three rules in order (split · merge floor · cap, incl. the hard-cut fallback) and the per-message
// budget, because everything the playback queue does downstream assumes this list is already correct.

const cfg = (over: Partial<ChunkCfg> = {}): ChunkCfg => ({
  mode: "sentence",
  minWords: 4,
  minChars: 50,
  maxChars: 400,
  maxTextChars: 4096,
  ...over,
});

/** Floors low enough that the merge rule never fires — isolates whatever the case is about. */
const noFloor = (over: Partial<ChunkCfg> = {}): ChunkCfg =>
  cfg({ minWords: 1, minChars: 1, ...over });

describe("ttsChunks — splitting", () => {
  it("sentence mode splits on . ! ? … and on any newline", () => {
    expect(ttsChunks("One. Two! Three? Four… Five", noFloor())).toEqual([
      "One.",
      "Two!",
      "Three?",
      "Four…",
      "Five",
    ]);
    expect(ttsChunks("a heading\nand a line", noFloor())).toEqual(["a heading", "and a line"]);
  });

  it("paragraph mode splits on blank lines only — a sentence end mid-paragraph does not", () => {
    const text = "One. Two.\nStill here.\n\nSecond block.";
    expect(ttsChunks(text, noFloor({ mode: "paragraph" }))).toEqual([
      "One. Two.\nStill here.",
      "Second block.",
    ]);
  });

  it("off mode is the whole message, one chunk, uncapped (the pre-D63 request)", () => {
    const long = "word ".repeat(500).trim();
    expect(ttsChunks(long, cfg({ mode: "off", maxChars: 10, maxTextChars: 20 }))).toEqual([long]);
  });
});

describe("ttsChunks — the merge floor", () => {
  it("a piece under EITHER floor keeps accumulating forward", () => {
    // "Sure." is 1 word / 5 chars — both floors — so it merges with what follows.
    expect(ttsChunks("Sure. I can wake corsair for you right now, no problem.", cfg())).toEqual([
      "Sure. I can wake corsair for you right now, no problem.",
    ]);
  });

  it("clears the floor only when BOTH are met, then starts a fresh chunk", () => {
    // 5 words but only 24 chars → still under minChars, so it keeps accumulating.
    const c = cfg({ minWords: 4, minChars: 24 });
    expect(ttsChunks("One two three four. Five.", c)).toEqual(["One two three four. Five."]);
    // …and at 24 chars exactly it closes.
    expect(ttsChunks("One two three four five. Six seven eight nine ten.", c)).toEqual([
      "One two three four five.",
      "Six seven eight nine ten.",
    ]);
  });

  it("a trailing piece that never clears the floor is still emitted (nothing left to merge with)", () => {
    const text = "Waking corsair now, which usually takes about a minute. Done.";
    expect(text.indexOf("Done.")).toBeGreaterThan(50); // the first piece clears both floors on its own
    expect(ttsChunks(text, cfg())).toEqual([
      "Waking corsair now, which usually takes about a minute.",
      "Done.",
    ]);
  });
});

describe("ttsChunks — the cap", () => {
  it("splits an over-long piece at the last word boundary under maxChars", () => {
    const chunks = ttsChunks("ab cd ef gh ij kl", noFloor({ maxChars: 8 }));
    expect(chunks).toEqual(["ab cd ef", "gh ij kl"]);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(8);
  });

  it("hard-cuts an unbroken token that has no word boundary under the cap (progress guaranteed)", () => {
    expect(ttsChunks("aaaaaaaaaa", noFloor({ maxChars: 4 }))).toEqual(["aaaa", "aaaa", "aa"]);
    // …and a boundary that exists only past the cap doesn't rescue it either.
    expect(ttsChunks("aaaaaa bb", noFloor({ maxChars: 4 }))).toEqual(["aaaa", "aa", "bb"]);
  });

  it("one giant sentence with no punctuation still becomes a playable queue", () => {
    const giant = "word ".repeat(300).trim(); // 1499 chars, zero sentence ends
    const chunks = ttsChunks(giant, cfg());
    expect(chunks.length).toBe(4);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(400);
    expect(chunks.join(" ")).toBe(giant); // nothing lost, nothing duplicated
  });
});

describe("ttsChunks — the per-message budget", () => {
  it("drops the tail at maxTextChars and reports it", () => {
    const plan = chunkPlan("ab cd ef gh ij kl", noFloor({ maxChars: 8, maxTextChars: 12 }));
    expect(plan.chunks).toEqual(["ab cd ef"]); // the next chunk would take it to 16
    expect(plan.dropped).toBe(true);
  });

  it("a message that fits is not reported as dropped", () => {
    const plan = chunkPlan("ab cd ef gh ij kl", noFloor({ maxChars: 8, maxTextChars: 16 }));
    expect(plan.chunks).toEqual(["ab cd ef", "gh ij kl"]);
    expect(plan.dropped).toBe(false);
  });
});

describe("ttsChunks — degenerate input", () => {
  it("empty / whitespace-only input yields no chunks in every mode", () => {
    for (const mode of ["off", "paragraph", "sentence"] as const) {
      expect(ttsChunks("", cfg({ mode }))).toEqual([]);
      expect(ttsChunks("   \n\n  ", cfg({ mode }))).toEqual([]);
    }
  });

  it("an all-emoji reply chunks to nothing once toSpeech has had it", () => {
    expect(ttsChunks(toSpeech("🎉 ✅ 👋"), cfg())).toEqual([]);
  });

  it("a lone table chunks to nothing (toSpeech drops every row)", () => {
    const table = "| host | state |\n| --- | --- |\n| emma | up |";
    expect(ttsChunks(toSpeech(table), cfg())).toEqual([]);
  });

  it("a realistic reply survives the whole toSpeech → chunk pipeline", () => {
    const md =
      "## Fleet\n\n- **emma** is up ✅\n- corsair is asleep\n\n| a | b |\n| - | - |\n\nWake it?";
    // The table is gone, the emoji is gone, and the four short lines merge up to the floor as one
    // chunk — merging re-joins with a space, so a chunk is always a single speakable run.
    expect(ttsChunks(toSpeech(md), cfg())).toEqual(["Fleet emma is up corsair is asleep Wake it?"]);
  });
});
