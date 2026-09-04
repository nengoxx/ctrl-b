import { describe, expect, it } from "vitest";

import { chunkPlan, chunkPlanFrom, ttsChunks, type ChunkCfg } from "../../src/lib/ttsChunks";
import { stableMarkdownPrefix, toSpeech } from "../../src/lib/toSpeech";

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

// ── C3 S2 — the incremental (read-along) plan ─────────────────────────────────────────────────────
// Read-along speaks a reply WHILE it streams: every sentence boundary re-plans a longer PREFIX of the
// same markdown and enqueues whatever is new. The one contract that makes that sound is that the queue
// must never diverge from the plan the FINISHED reply would have produced — a chunk spoken is spoken.
// So these cases drive the real feeder pipeline, `stableMarkdownPrefix → toSpeech → chunkPlanFrom`:
// the chunker alone cannot see the half of this that markdown owns.

/** Reply shapes that actually occur, each carrying a construct `toSpeech` rewrites destructively once
 *  it closes, and each long enough that the finished plan is more than one chunk. */
const FIXTURES: Record<string, string> = {
  prose:
    "Waking corsair now, which usually takes about a minute. I will ping it again once it answers, " +
    "and everything else in the fleet is already up.",
  fence:
    "Here is the systemd unit file you asked me for earlier.\n\n```ini\n[Service]\n" +
    "ExecStart=/usr/bin/uvicorn app.main:app\n```\n\nDrop that in and reload the daemon, then it " +
    "starts at boot.",
  image:
    "The gallery already holds that shot of the whole rack.\n\n" +
    "![a wide photograph of the rack with every drive bay lit](/api/media/fleet/rack.jpg)\n\n" +
    "I can crop it to the card's aspect ratio if you like.",
  link:
    "The release steps are all in [the linux deploy runbook](/docs/deploy/linux/README.md#release), " +
    "and I would follow them in order. Nothing else is needed.",
  inlineCode:
    "Restart the dev unit before you poke at anything else. Run " +
    "`systemctl --user restart ctrl-b-dashboard-dev` and then reload the page. " +
    "The mini player should dock again straight away.",
  emphasis:
    "**emma** is up and answering every probe I have thrown at it today. corsair is ~~asleep and " +
    "unreachable right now, so nothing answers there. I will try again in a minute~~ awake after " +
    "all. Both hosts are green.",
  table:
    "Here is where every host in the fleet stands right now.\n\n| host | state |\n| --- | --- |\n" +
    "| emma | up |\n| corsair | asleep |\n\nWake corsair whenever you like, it takes about a minute.\n" +
    "I will ping it again once it answers the tailnet.",
  list:
    "Three things are left before the release.\n\n- tag the commit and push it\n" +
    "- wait for the CI release gate\n- re-pin the prod tree at the tag\n\n" +
    "Then the health check should answer.",
};

/** Replay a reply one character at a time, exactly as the feeder will: cut the buffer at the first
 *  unclosed construct, speak that, plan from what the queue already holds. Asserts at EVERY step that
 *  the queue is still a prefix of the finished reply's plan, and hands the queue back for the flush. */
function replay(md: string, c: ChunkCfg): string[] {
  const whole = chunkPlan(toSpeech(md), c).chunks;
  const queue: string[] = [];
  for (let i = 1; i <= md.length; i++) {
    const step = chunkPlanFrom(toSpeech(stableMarkdownPrefix(md.slice(0, i))), c, queue.length);
    queue.push(...step.chunks);
    expect(queue, `after ${i} of ${md.length} chars`).toEqual(whole.slice(0, queue.length));
  }
  return queue;
}

describe("ttsChunks — incremental (read-along)", () => {
  it.each(Object.entries(FIXTURES))(
    "%s: every prefix speaks a prefix of the finished plan, and the flush completes it",
    (_name, md) => {
      const whole = chunkPlan(toSpeech(md), cfg()).chunks;
      expect(whole.length).toBeGreaterThan(1); // a one-chunk fixture would prove nothing
      const queue = replay(md, cfg());
      // The flush is the only call that sees the finished reply, so it is the only one that may emit
      // the tail — and after it the queue is the whole-message plan, chunk for chunk.
      queue.push(...chunkPlanFrom(toSpeech(md), cfg(), queue.length, true).chunks);
      expect(queue).toEqual(whole);
    },
  );

  it("withholds the LAST chunk mid-stream — the trailing merge buffer is what growth rewrites", () => {
    // "Sure." is under both floors, so it keeps accumulating; enqueue it and the queue says "Sure."
    // while the finished plan says "Sure. I can wake corsair…" — the divergence the rule exists for.
    expect(chunkPlanFrom("Sure.", cfg(), 0).chunks).toEqual([]);
    expect(
      chunkPlanFrom("Sure. I can wake corsair for you right now, no problem.", cfg(), 0).chunks,
    ).toEqual([]);
    expect(chunkPlanFrom("One. Two. Three.", noFloor(), 0).chunks).toEqual(["One.", "Two."]);
    // …and the turn-end flush is the one call that emits it.
    expect(chunkPlanFrom("One. Two. Three.", noFloor(), 0, true).chunks).toEqual([
      "One.",
      "Two.",
      "Three.",
    ]);
  });

  it("never re-emits an index, and a buffer that SHRANK emits nothing at all", () => {
    expect(chunkPlanFrom("One. Two. Three.", noFloor(), 2).chunks).toEqual([]);
    expect(chunkPlanFrom("One. Two. Three. Four.", noFloor(), 2).chunks).toEqual(["Three."]);
    // A reconnect overlays the streaming message wholesale and the text can come back SHORTER than
    // what was fed (the controller abandons the turn on that; the slice must not re-speak meanwhile).
    expect(chunkPlanFrom("One.", noFloor(), 2).chunks).toEqual([]);
  });

  it("a capped prefix stays capped for every extension of it (`dropped` is prefix-stable too)", () => {
    const c = noFloor({ maxChars: 8, maxTextChars: 12 });
    expect(chunkPlanFrom("ab cd ef gh ij kl", c, 0)).toEqual({ chunks: [], dropped: true });
    expect(chunkPlanFrom("ab cd ef gh ij kl mn op", c, 0)).toEqual({ chunks: [], dropped: true });
    // the truncated plan is what the flush speaks — the tail past the budget is never enqueued
    expect(chunkPlanFrom("ab cd ef gh ij kl", c, 0, true)).toEqual({
      chunks: ["ab cd ef"],
      dropped: true,
    });
    expect(chunkPlanFrom("ab cd", c, 0, true).dropped).toBe(false); // still inside the budget
  });

  it("is inert under `off` — one chunk of the whole message is not knowable mid-stream", () => {
    expect(chunkPlanFrom("One. Two. Three.", cfg({ mode: "off" }), 0).chunks).toEqual([]);
    expect(chunkPlanFrom("One. Two. Three.", cfg({ mode: "off" }), 0, true).chunks).toEqual([
      "One. Two. Three.",
    ]);
  });
});
