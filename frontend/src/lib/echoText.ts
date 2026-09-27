// THE TEXT BACKSTOP'S MATCHER (Phase 24 / D80 ②, evidence docs/research/R91 §3) — is this transcript the
// reply's own words, heard back through the microphone?
//
// WHY A TEXT RULE AT ALL. The tail hold (D80 ①) closes the ear until the room is quiet, and that is the
// mechanism; but it measures LEVEL, and two things escape a level rule by construction — a pause of
// ≥ `tail_quiet_ms` inside the reply's not-yet-heard tail (a synthesis gap between its last two chunks
// is exactly that), and a tail that outlives the cap. Both come back as a final whose words are the
// reply's. The client knows what it just spoke, so it can recognise them: the one reference-class
// implementation is Hermes' `is_tts_echo` (R91 §3.1), and this is that matcher.
//
// THE ALGORITHM, exactly Hermes' (R91 §3.1, `voice_mode_transcript.py:67-102`): Ratcliff/Obershelp —
// `difflib.SequenceMatcher.ratio()`, i.e. 2·M/T with M the characters in the recursively-found longest
// common blocks — over the whole normalised strings first; and, when the transcript is the shorter, the
// best ratio over every window of the spoken text as long as the transcript, stepped one character at a
// time (an echo is usually the reply's LAST sentence, not all of it). No autojunk heuristic (difflib's
// "popular element" pruning only engages past 200 characters and would make short and long replies score
// by different rules) and no dependency: the whole thing is a few loops.
//
// THE NORMALISATION is R91's, with one ruling folded: lowercase, punctuation (apostrophes included) to
// spaces, whitespace collapsed. The ASR punctuates differently from the reply ("For..." vs "Or"), and on
// the call's own log stripping it turned the echoes' 0.93s into 1.0s and cost the genuine turns nothing.
//
// PURE AND SMALL: no React, no store — the wiring decides WHEN to ask (the post-reply window) and hands
// the reducer a number, the transcript gate's split (`energyMs`).

/** Below this many normalised characters a transcript is NEVER judged (Hermes'
 *  `MIN_FRAGMENT_LENGTH_FOR_ECHO`, #75792): a genuine "yes" or "no" landing verbatim inside a longer reply
 *  scores a trivial 1.0 in the window test, and dropping the owner's one-word answer as an echo is the
 *  worst error this rule can make. The SHAPE of the matcher, like `BARGE_HIT_RATIO` — not a knob: the
 *  owner tunes the threshold (`echo_similarity`), not what a sentence is. */
export const ECHO_MIN_CHARS = 10;

/** The comparable form of a transcript or a reply: lowercase, every run of anything that is not a letter
 *  or a digit (punctuation, apostrophes, whitespace, emoji) collapsed to ONE space, trimmed. */
export function normalizeForEcho(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** WHERE each character sits in the spoken text — difflib's `b2j`: per character code, its positions in
 *  ascending order. Built once per `echoSimilarity` call and shared by the whole-string ratio and every
 *  window, so a window costs only the cells where the two strings actually MATCH (~1 in 12 for English)
 *  rather than the full `|a|·|window|` grid — the same sparse walk difflib takes, which is what keeps a
 *  long genuine turn against a long reply a few milliseconds instead of a main-thread stall. */
type Positions = Map<number, Int32Array>;

function positionsOf(b: string): Positions {
  const lists = new Map<number, number[]>();
  for (let j = 0; j < b.length; j++) {
    const c = b.charCodeAt(j);
    const list = lists.get(c);
    if (list) list.push(j);
    else lists.set(c, [j]);
  }
  const out: Positions = new Map();
  for (const [c, list] of lists) out.set(c, Int32Array.from(list));
  return out;
}

/** The first index in the ascending `list` whose value is `>= lo`. */
function lowerBound(list: Int32Array, lo: number): number {
  let l = 0;
  let r = list.length;
  while (l < r) {
    const m = (l + r) >> 1;
    if (list[m] < lo) l = m + 1;
    else r = m;
  }
  return l;
}

/** difflib's `j2len`/`newj2len` pair, as two stamped arrays over `b`'s positions (grown on demand and
 *  reused — the matcher runs once per final, and each `longestMatch` finishes before its caller
 *  recurses). A slot counts only when its stamp is the PREVIOUS row's, which is what makes the sparse
 *  walk equal to the dictionaries it replaces. `row` only ever grows, so no stale stamp can match. */
let lenA = new Int32Array(0);
let stampA = new Int32Array(0);
let lenB = new Int32Array(0);
let stampB = new Int32Array(0);
let row = 0;

/** Where the stamp counter starts over (the code round's O-LOW-1): the stamps are Int32, and a counter
 *  that ran on past 2³¹ would wrap and match stale stamps — the backstop silently scoring ~0 for the
 *  rest of the page's life. One call advances it by at most a few million rows, so resetting past 2³⁰
 *  (at the top of a call, never inside one) keeps every stamp comparison exact. Bookkeeping, not a
 *  knob. */
const ROW_RESET_AT = 1 << 30;

/** TEST SEAM: move the stamp counter, so a test can stand it at the wrap point without 2³⁰ calls. The
 *  counter is module state by design (the scratch rows are reused across calls); this is the one door
 *  to it from outside, and nothing in the app calls it. */
export function seedEchoStampForTest(n: number): void {
  row = n;
}

/** difflib's `find_longest_match` with no junk: the longest common block of `a[alo:ahi]` and
 *  `b[blo:bhi]`, found by the same walk in the same order (rows of `a` ascending, positions of `b`
 *  ascending, a strictly longer block replacing the best) — so its tie-break, on which the ratio's exact
 *  value depends, is difflib's. Returns `[i, j, size]`. */
function longestMatch(
  a: string,
  alo: number,
  ahi: number,
  pos: Positions,
  blo: number,
  bhi: number,
): [number, number, number] {
  let bestI = alo;
  let bestJ = blo;
  let bestSize = 0;
  row += 1; // the row before this call's first is nobody's: no stamp from an earlier call can match
  for (let i = alo; i < ahi; i++) {
    row += 1;
    const odd = (row & 1) === 1;
    const curLen = odd ? lenA : lenB;
    const curStamp = odd ? stampA : stampB;
    const prevLen = odd ? lenB : lenA;
    const prevStamp = odd ? stampB : stampA;
    const list = pos.get(a.charCodeAt(i));
    if (list === undefined) continue;
    for (let n = lowerBound(list, blo); n < list.length; n++) {
      const j = list[n];
      if (j >= bhi) break;
      const k = j > blo && prevStamp[j - 1] === row - 1 ? prevLen[j - 1] + 1 : 1;
      curLen[j] = k;
      curStamp[j] = row;
      if (k > bestSize) {
        bestI = i - k + 1;
        bestJ = j - k + 1;
        bestSize = k;
      }
    }
  }
  return [bestI, bestJ, bestSize];
}

/** M: how many characters the recursively-found longest common blocks cover (difflib's
 *  `get_matching_blocks`, summed). */
function matchedChars(
  a: string,
  alo: number,
  ahi: number,
  pos: Positions,
  blo: number,
  bhi: number,
): number {
  if (alo >= ahi || blo >= bhi) return 0;
  const [i, j, k] = longestMatch(a, alo, ahi, pos, blo, bhi);
  if (k === 0) return 0;
  return k + matchedChars(a, alo, i, pos, blo, j) + matchedChars(a, i + k, ahi, pos, j + k, bhi);
}

/** Ratcliff/Obershelp similarity of `a` and `b[blo:bhi]`, `2·M / (|a| + |window|)` — difflib's
 *  `ratio()`. */
function ratio(a: string, pos: Positions, blo: number, bhi: number): number {
  return (2 * matchedChars(a, 0, a.length, pos, blo, bhi)) / (a.length + bhi - blo);
}

/**
 * How much `transcript` looks like `spoken` (0…1): Hermes' `is_tts_echo` score — the whole-string ratio,
 * or, when the transcript is the shorter, the best ratio over every transcript-length window of the
 * spoken text. Both are normalised first (`normalizeForEcho`); an empty side scores 0. The caller owns
 * the `ECHO_MIN_CHARS` rule and the threshold.
 */
export function echoSimilarity(transcript: string, spoken: string): number {
  const a = normalizeForEcho(transcript);
  const b = normalizeForEcho(spoken);
  if (a === "" || b === "") return 0;
  if (lenA.length < b.length) {
    lenA = new Int32Array(b.length);
    stampA = new Int32Array(b.length);
    lenB = new Int32Array(b.length);
    stampB = new Int32Array(b.length);
    row = 0; // fresh arrays carry no stamps, so the counter may start over
  } else if (row > ROW_RESET_AT) {
    stampA.fill(0);
    stampB.fill(0);
    row = 0;
  }
  const pos = positionsOf(b);
  let best = ratio(a, pos, 0, b.length);
  if (a.length < b.length) {
    for (let s = 0; s + a.length <= b.length && best < 1; s++) {
      best = Math.max(best, ratio(a, pos, s, s + a.length));
    }
  }
  return best;
}
