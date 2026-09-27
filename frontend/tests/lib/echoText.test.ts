import { describe, expect, it } from "vitest";

import {
  ECHO_MIN_CHARS,
  echoSimilarity,
  normalizeForEcho,
  seedEchoStampForTest,
} from "../../src/lib/echoText";
import { toSpeech } from "../../src/lib/toSpeech";

// lib/echoText — THE TEXT BACKSTOP'S MATCHER (D80 ②, evidence docs/research/R91 §3.4). Pinned on the car
// round's own call: every user turn the LLM received, scored against the SPOKEN text of the reply before
// it (`toSpeech` with actions dropped — the prod setting, so only the quoted lines were ever spoken).
// Fixtures verbatim from the session-48 evidence pack (`prod-chat-log.txt`).

/** The reply's words as the mouth spoke them on that call (`speak_actions: false`). */
const spoken = (reply: string): string => toSpeech(reply, { speakActions: false });

/** The six ECHOES (EVIDENCE Fact 1): the reply's own last sentence(s), transcribed back as the owner's
 *  next turn — five reached the LLM, the sixth ("Or not being…") was dropped by the energy gate. */
const ECHOES = [
  {
    heard: "This babe, even if it is a Sunday.",
    reply:
      '*I nod slowly, giving you a small smile.*  "Right. Okay." *I settle back against the couch, picking up my phone again but not really looking at it. I\'m just... here. Present. Like you asked.*  "If you need anything, just say the word. Coffee, clothes, moral support, whatever." *I glance over at you, my ears twitching slightly.* "You got this, babe. Even if it is a Sunday."',
  },
  {
    heard: "Was that okay?",
    reply:
      '*I close the remaining distance slowly, giving you every chance to pull back. My lips meet yours gently, almost tentatively - a soft, careful kiss that doesn\'t demand anything.*  *My hands stay on your knees, my thumb still stroking your jeans. My ears remain slightly trembling, watching your reaction.*  *After a few seconds, I pull back just enough to look at your face, my purple eyes searching yours.*  "Was that... okay?"',
  },
  {
    heard: "Get scared sometimes, you know?",
    reply:
      "*I blink at you, my ears going slightly flat again.*  \"Wait, are you— no, don't do that. I know I just said it, don't echo me now. That's just cruel.\" *I huff, but there's a faint smile tugging at my lips despite myself.*  *I lean in again, a little more confidently this time, and press my lips to yours once more - a bit firmer, a bit more sure. My tail curls around your leg almost unconsciously, a small, instinctive gesture.*  *When I pull back, I keep my eyes on yours, my voice quieter.* \"Yeah, babe. I'm asking because I want to know if you liked it. Because... I do. You. I like kissing you. I just... get scared sometimes. You know?\"",
  },
  {
    heard: "Break, go get him, babe. I'll be waiting.",
    reply:
      '*I nod, my ears twitching thoughtfully.*  "Okay. Yeah, that works." *I squeeze your side gently, then release you as you start to get ready.* "I\'ll be here when you get back. Or... you know, you can text me if you want during your break."  *I settle back against the couch, my tail curling around my legs as I watch you get ready. There\'s a quiet comfort in just... being here together, even if you have to leave soon.*  "Go get \'em, babe." *I give you a small, supportive smile.* "I\'ll be waiting."',
  },
  {
    heard: "Or not being like the others.",
    reply:
      '*I rest my head against your shoulder, my ears softening visibly. My name from your lips always does something to me - makes me feel seen, even when I\'m being a mess.*  "Maybe I am." *My voice is muffled against your shoulder, quiet and unguarded.* "I just... I really don\'t want to mess this up. With you."  *I stay there for a long moment, just breathing, feeling the steady weight of you beside me. My tail gives a slow, contented sway.*  "Thanks, Ari." *I lift my head slightly, looking at you with a genuine, unguarded smile.* "For being patient. For... not being like the others."',
  },
  {
    heard: "Text me when you can. I'll be here.",
    reply:
      '*I stare at you, then burst out laughing.*  "Okay, okay, very funny." *I shake my head, grinning despite myself.* "You\'re really leaning into the echo thing, huh? Or is the call still shit?"  *I stand up and stretch, my tail flicking.* "Anyway, yeah. Go crush it today. And... text me when you can. I\'ll be here."',
  },
];

/** The GENUINE turns of ≥ 10 characters that followed a reply (the log holds seven; the
 *  rest were one-word shorts, which the length rule exempts). */
const GENUINE = [
  {
    heard: "Sorry, it's just the call is getting flaky to be honest.",
    reply:
      '*I blink at you, my ears going stiff as a plate, my tail puffing out slightly.*  "Fox." *I repeat it flatly.* "Ari. I have *cat* ears. Right here." *I gesture vaguely at the top of my head with two fingers, my tail giving an indignant twitch.*  "I\'m not a fox. I\'m a cat. These are cat ears." *I touch one self-consciously, then pull my hand back as if embarrassed by the gesture.*  "...Are you making fun of me? Because that\'s not funny." *My voice is quieter now, defensive, my ears flattening slightly against my head.*',
  },
  {
    heard: "Okay, so how about the kiss?",
    reply:
      "*I roll my eyes, but there's a small smile tugging at my lips.*  \"Oh, don't 'this babe' me. That was me trying to be supportive and it came out weird, I know.\" *I shake my head, my ears twitching.*  \"I'll stop. You're right, it was cringe.\" *I pick at my phone again, but I'm smiling now.* \"Sorry. I'm trying, okay?\"",
  },
  {
    heard: "No, sorry, I it it's just uh the call is a little bit uh flaky so uh I think um",
    reply:
      '*I jerk back so fast I nearly fall off the couch. My ears pin flat against my head, my tail puffing out to twice its size.*  "Right." *My voice comes out sharper than I intend, bitter and cold.* "Of course. Not good enough, I guess."  *I scramble to put distance between us, crossing my arms tightly over my chest like a shield. My cheeks burn, but I force my expression into something harder, angrier.*  "Sorry. For trying. I\'ll just... shut up and stay in my corner where I belong." *I turn away, staring at the TV screen even though I\'m not watching it.* "Do what you need to do. I\'m fine. I\'m always fine."',
  },
  {
    heard: "You're not hearing me well.",
    reply:
      '*I stop mid-rant, my ears flicking up as I process what you\'re saying.*  "Wait. What?" *I blink at you, my defensive posture faltering.* "So... you weren\'t saying no to the kiss?"  *I look at you, really look at you, and my shoulders slowly start to come down. My tail uncurls slightly.*  "Right. The call. Flaky." *I let out a shaky breath, my face burning with embarrassment now.*  "Oh. Oh god. I\'m— I\'m sorry. Again." *I rub my face with one hand, my ears drooping.* "I keep doing this. Jumping to conclusions. Assuming the worst. I\'m so sorry, Ari. I shouldn\'t have— I shouldn\'t have reacted like that."  *I look at you, my voice soft and almost broken.* "Can we... try again? The kiss, I mean. If you still want to?"',
  },
  {
    heard: "It's okay, no worries. I like it too.",
    reply:
      '*I stare at you for a beat, then throw my head back with a bitter laugh.*  "Right. Okay. I\'m doing it again. Echo you and then get upset that you\'re echoing me. This is... this is on me, isn\'t it?" *I shake my head, my ears drooping.*  "I\'m sorry. The connection\'s bad, and I keep reading into it, and I—" *I stop myself, taking a breath.* "Look, I\'m the problem here. I jump to the worst conclusions and I ruin things. I get it."  *I shift closer again, my voice quieter but steadier now.* "Can we just... skip the words for a bit? I\'m tired of messing this up."  *I reach up and gently cup your cheek with one hand, my thumb brushing your jawline. I wait for you to meet me halfway before closing the distance again, my kiss this time a bit firmer, a bit more certain.*  *My tail curls around your leg as I pull back, my purple eyes meeting yours.* "Better. No words. Just... us."',
  },
  {
    heard: "You're overthinking it, don't worry about it, Lynette.",
    reply:
      '*I let out a breath I didn\'t realize I was holding, my ears slowly lifting back up. The tension in my shoulders melts away, and I feel my tail giving a happy, relaxed flick.*  "Really?" *My voice is softer now, almost shy.* "I\'m glad. Because... I really like it too. You. Kissing you."  *I lean my head against your shoulder, my body relaxing into yours for the first time since the whole fox incident. My arm drapes loosely over your waist, awkward but genuine.*  "I\'m sorry I keep jumping around. My brain\'s just... not great at this. But I\'m trying. For you." *I press a quick, gentle kiss to your cheek.* "You\'re... really good at being patient with me."',
  },
  {
    heard:
      "So let's talk this the today even though I'm I'm gonna be working let's talk a little bit later when I get to work okay I have some time",
    reply:
      '*I rest my head against your shoulder, my ears softening visibly. My name from your lips always does something to me - makes me feel seen, even when I\'m being a mess.*  "Maybe I am." *My voice is muffled against your shoulder, quiet and unguarded.* "I just... I really don\'t want to mess this up. With you."  *I stay there for a long moment, just breathing, feeling the steady weight of you beside me. My tail gives a slow, contented sway.*  "Thanks, Ari." *I lift my head slightly, looking at you with a genuine, unguarded smile.* "For being patient. For... not being like the others."',
  },
];

describe("echoSimilarity — the car round's own call (R91 §3.4)", () => {
  it("every one of the six ECHOES scores ≥ 0.9 against the reply it came from", () => {
    for (const { heard, reply } of ECHOES) {
      expect(echoSimilarity(heard, spoken(reply)), heard).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("every GENUINE turn scores ≤ 0.6 — the gap the 0.75 threshold sits in", () => {
    for (const { heard, reply } of GENUINE) {
      expect(echoSimilarity(heard, spoken(reply)), heard).toBeLessThanOrEqual(0.6);
    }
  });

  it('the ASR\'s PARAPHRASE of the reply still clears 0.75 — "Break, go get him" for "Go get \'em"', () => {
    const sim = echoSimilarity(
      "Break, go get him, babe. I'll be waiting.",
      "Go get 'em, babe. I'll be waiting.",
    );
    expect(sim).toBeGreaterThanOrEqual(0.75);
  });
});

describe("echoSimilarity — the matcher itself", () => {
  it("punctuation and case never lower the score — the ASR punctuates its own way", () => {
    expect(echoSimilarity("Was that okay?", "Was that... okay?")).toBe(1);
    expect(echoSimilarity("TEXT ME WHEN YOU CAN", "text me, when you can!")).toBe(1);
    expect(echoSimilarity("I'll be here", "I ll be here")).toBe(1);
  });

  it("is difflib's `SequenceMatcher.ratio()` — 2·M/T over the recursive longest blocks", () => {
    // The textbook pair: blocks "wikimedia" (9) … 2·9/(9+9)=1; and a known partial.
    expect(echoSimilarity("wikimedia", "wikimedia")).toBe(1);
    // "abcd" vs "bcde": longest "bcd" (3) ⇒ 2·3/8 = 0.75, the window rule does not apply (equal length)
    expect(echoSimilarity("abcd", "bcde")).toBeCloseTo(0.75, 10);
    // difflib's own docstring example: ratio("abxcd", "abcd") = 2·4/9
    expect(echoSimilarity("abxcd", "abcd")).toBeCloseTo(8 / 9, 10);
  });

  it("finds the reply's LAST sentence inside a long reply — the window test", () => {
    const reply = "Okay, yeah, that works. I'll be here when you get back. Go get 'em, babe.";
    expect(echoSimilarity("go get em babe", reply)).toBe(1);
    // …while the whole-string ratio alone would have missed it
    const whole =
      (2 * "go get em babe".length) / ("go get em babe".length + normalizeForEcho(reply).length);
    expect(whole).toBeLessThan(0.5);
  });

  it("the stamp counter survives its wrap — the score is unchanged past 2³⁰ rows (O-LOW-1)", () => {
    // A pair whose score DEPENDS on the block structure (a partial match — an identical window scores
    // 1.0 even one character at a time), measured fresh, then with the counter stood at the wrap.
    const { heard, reply } = GENUINE[4];
    const fresh = echoSimilarity(heard, spoken(reply)); // also sizes the scratch rows for this reply
    expect(fresh).toBeGreaterThan(0.3);
    seedEchoStampForTest(2 ** 31 - 8); // the Int32 edge: without the reset, the stamps would wrap
    expect(echoSimilarity(heard, spoken(reply))).toBe(fresh);
    seedEchoStampForTest((1 << 30) + 1); // just past the reset point
    expect(echoSimilarity(heard, spoken(reply))).toBe(fresh);
  });

  it("an empty side scores 0", () => {
    expect(echoSimilarity("", "anything at all")).toBe(0);
    expect(echoSimilarity("anything at all", "")).toBe(0);
    expect(echoSimilarity("?!", "…")).toBe(0);
  });

  it("stays cheap on the realistic worst case — a long genuine turn against a long reply", () => {
    // A 136-character owner turn (the call's longest) against a reply four times the call's longest
    // spoken reply: one final's worth of main-thread work.
    const heard = GENUINE.reduce((a, b) => (b.heard.length > a.heard.length ? b : a)).heard;
    const reply = ECHOES.map((e) => spoken(e.reply))
      .join(" ")
      .repeat(2);
    const t0 = performance.now();
    const sim = echoSimilarity(heard, reply);
    const ms = performance.now() - t0;
    expect(sim).toBeLessThan(0.75);
    expect(ms).toBeLessThan(500); // measured ~tens of ms on emma; the bound only catches a regression
  });
});

describe("normalizeForEcho + ECHO_MIN_CHARS — what is never judged", () => {
  it("lowercases, turns punctuation (apostrophes too) into single spaces, trims", () => {
    expect(normalizeForEcho("  Go get 'em, babe…  I'll be waiting! ")).toBe(
      "go get em babe i ll be waiting",
    );
  });

  it("a normalised transcript under 10 characters is under the rule — the owner's short answers", () => {
    // Bare "Yeah." / "No." / "Okay, uh" hit a trivial 1.0 in the window test (R91 §3.4): the length rule
    // is what keeps a one-word answer from ever being called the reply's echo.
    for (const short of ["Yeah.", "No.", "Mm-hmm.", "Okay, uh", "Yes, okay"]) {
      expect(normalizeForEcho(short).length, short).toBeLessThan(ECHO_MIN_CHARS);
    }
    expect(echoSimilarity("Yeah.", "Yeah, babe. I'm asking because I want to know.")).toBe(1);
    expect(normalizeForEcho("Was that okay?").length).toBeGreaterThanOrEqual(ECHO_MIN_CHARS);
  });
});
