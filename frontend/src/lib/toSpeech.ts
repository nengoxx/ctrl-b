// Strip Markdown to plain prose for TTS, so the synth reads words rather than syntax
// ("**bold**" → "bold", a fenced code block → nothing). Hand-rolled + dependency-free, matching the
// project's no-dep markdown renderer (lib/markdown.tsx) — we render markdown for the eye there and
// speak the prose here. Intentionally lossy: code, images, rule lines, TABLE ROWS, and emoji are
// dropped, not voiced.
//
// D63 — the output is the CHUNKER's input (lib/ttsChunks), so this pass is newline-PRESERVING: the
// old collapse-everything-to-spaces erased every paragraph and line boundary the splitter needs.
// Horizontal whitespace still collapses; a run of 3+ blank lines flattens to one paragraph break.
// The table/emoji strips are ours on purpose rather than the TTS server's — Speaches happens to strip
// some of this, a different OpenAI-compatible endpoint in the failover chain would not.

import { ACTION_OPEN, ACTION_OPENER, ACTION_SPAN } from "./actionSpan";

/** Emoji, as a RUN of code points: `\p{RGI_Emoji}` is a property-of-STRINGS, so it needs the `v` flag
 *  to match a whole ZWJ/skin-tone sequence rather than its pieces (the same regex open-webui landed on
 *  after its code-point version missed the entire BMP emoji block). */
const EMOJI = /\p{RGI_Emoji}/gv;

/** D74 — the one speech-shaping option, so this stays a PURE function (the policy lives on the
 *  `ChunkPolicy` the server publishes; nothing here reads module state). `speakActions: false` drops
 *  single-asterisk `*…*` spans — the roleplay ACTION convention — instead of unwrapping them; bold
 *  still unwraps, because emphasis is speech and an action is not. A ONE-WORD span (no whitespace
 *  inside: `*really*`, `*sighs*`) is emphasis and is read (session-51 polish #3). Absent = today's
 *  behavior. */
export interface SpeechOpts {
  speakActions?: boolean;
}

export function toSpeech(md: string, opts: SpeechOpts = {}): string {
  let s = md;
  s = s.replace(/```[\s\S]*?```/g, " "); // fenced code blocks — don't read code aloud
  // Inline code → its text, MINUS its asterisks (session-51 polish #3, wave 2). Unwrapped, a code `*`
  // is loose in the prose, and under `speakActions: false` "Delete `*.tmp` files, then reboot" read as
  // an unclosed action at `*.tmp` and lost the rest of the sentence. A code `*` is never an action
  // delimiter (the eye masks it, read-along blanks the span first), and the residual `*` scrub below
  // would blank it anyway — so blanking it here, to a SPACE like that scrub (`2*3` reads "2 3", not
  // "23"; the collapse below tidies it), changes nothing audible except that dropped tail (wave 4).
  s = s.replace(/`([^`]+)`/g, (_, c: string) => c.replace(/\*/g, " "));
  s = s.replace(/<[^>]+>/g, " "); // stray inline HTML tags — don't voice "<div>"
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " "); // images → nothing
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // links → the link text
  // Line-prefix passes. Every `\s` here is HORIZONTAL-only (`[^\S\n]`) on purpose: plain `\s*` after a
  // multiline `^` happily eats the blank line ABOVE a list item, which silently erased the paragraph
  // boundaries this pass now has to preserve.
  s = s.replace(/^[^\S\n]{0,3}#{1,6}[^\S\n]+/gm, ""); // heading markers
  s = s.replace(/^[^\S\n]{0,3}>[^\S\n]?/gm, ""); // blockquote markers
  s = s.replace(/^[^\S\n]*[-*+][^\S\n]+/gm, ""); // unordered list markers
  s = s.replace(/^[^\S\n]*\d+\.[^\S\n]+/gm, ""); // ordered list markers
  s = s.replace(/^[^\S\n]*([-*_])(?:[^\S\n]*\1){2,}[^\S\n]*$/gm, " "); // horizontal rules
  s = s.replace(/^[^\S\n]*\|.*\|[^\S\n]*$/gm, " "); // whole table rows (header/separator/body)
  s = s.replace(/(\*\*|__)(.*?)\1/g, "$2"); // bold
  if (opts.speakActions === false) {
    // D74 — ACTIONS ARE NOT SPEECH. Runs AFTER the bold pass (every closed `**…**` is already
    // unwrapped, so a `*` left here is a single-asterisk one) and BEFORE the italic unwrap, which
    // then handles `_…_` and anything these two deliberately don't match.
    // Session-51 polish #3 (owner ruling Q3): only a span with WHITESPACE inside is an action. A
    // one-word span (`*really*`, `*don't*`, `*self-aware*`) is emphasis inside the dialogue, so it is
    // spoken inline — a genuine one-word action (`*sighs*`) is spoken too, the accepted price of the
    // simple rule. `\s` includes `\n`, so a span crossing a line still drops. The one-word span is
    // returned as-is for the italic pass below (the ONE unwrap path).
    s = s.replace(ACTION_SPAN, (m) => (/\s/.test(m) ? " " : m));
    // The UNCLOSED tail keeps dropping whatever its length: mid-stream, a one-word tail is
    // indistinguishable from an action's start. It is searched on a MASK with every closed span still
    // standing blanked — the eye's and read-along's order (closed spans first, then the tail) is the
    // invariant — because a kept span's closer can itself look like an opener: in `"*Really?*" she
    // asked` the closer follows `?`, not a word character, so the boundary guard doesn't refuse it, and
    // a bare `replace(ACTION_OPEN)` deleted the rest of the reply (wave 3, confirm N1). Same-length
    // mask, so its index addresses `s`.
    const at = s.replace(ACTION_SPAN, (m) => " ".repeat(m.length)).search(ACTION_OPEN);
    if (at >= 0) s = s.slice(0, at) + " ";
  }
  s = s.replace(/(\*|_)(.*?)\1/g, "$2"); // italic
  s = s.replace(/~~(.*?)~~/g, "$1"); // strikethrough
  s = s.replace(EMOJI, " "); // emoji — a space, not "", so "hi🎉there" doesn't become one word
  // D74/S1 — the RESIDUAL asterisk scrub. An asterisk is never speakable, and the passes above leave
  // one behind whenever a span didn't pair: read-along deliberately cuts mid-span for single `*`
  // (see the REWRITES note below), so a multi-sentence roleplay action sheds a literal `*` into the
  // synth text at the cut. A space, not "", so "a*b" doesn't become one word; the collapse below
  // tidies up. The price is "3 * 4" losing its star — accepted: it was never spoken as "times".
  s = s.replace(/\*/g, " ");
  s = s.replace(/[^\S\n]+/g, " "); // collapse HORIZONTAL whitespace only (newlines survive)
  s = s.replace(/ ?\n ?/g, "\n"); // …and drop the spaces left hugging a newline
  s = s.replace(/\n{3,}/g, "\n\n"); // 3+ newlines → one paragraph break
  return s.trim();
}

// ── C3 S2 (read-along) ─────────────────────────────────────────────────────────────────────────────
// Speaking a reply WHILE it streams means running `toSpeech` over a half-arrived buffer, and several of
// the passes above are destructive the moment their construct CLOSES: a fenced block, an image and a
// tag become nothing, a link/inline-code/emphasis span loses its delimiters. Mid-stream that text is
// still open, so it reads as prose — and once the closer lands the final pass deletes or reshapes it,
// after the queue has already spoken it. The cure is to feed only the part of the buffer no unclosed
// construct can still rewrite; the withheld remainder is spoken by the turn-end flush, which sees the
// whole reply. Conservative by construction: cutting early only ever DELAYS speech, never mis-speaks.

/** The destructive rewrites, in the ORDER `toSpeech` applies them: each pass blanks what has already
 *  closed (so a later pass never reads a delimiter that belongs to an earlier construct), then looks
 *  for an opener that has not. Single-char `*`/`_` are deliberately absent — lone asterisks and
 *  snake_case pervade ordinary prose, so cutting on them would stall read-along constantly; the worst
 *  case is a stray delimiter in one chunk of a rare shape (accepted residual, owner-ruled).
 *
 *  D74 — that ruling now stands on the SCRUB rather than on tolerance: a delimiter leaked across a cut
 *  is deleted by the final `*` pass in `toSpeech`, so the residual is INAUDIBLE (it was the owner's
 *  measured "scratching"). The no-stall rule therefore keeps costing nothing. The one exception is
 *  `speakActions: false`, where the words after an opener are the ones being dropped — there the end
 *  of the span IS load-bearing and unknowable mid-stream, so `ACTION_REWRITE` below holds for it. */
const REWRITES: { closed: RegExp; opener: RegExp }[] = [
  { closed: /```[\s\S]*?```/g, opener: /```/ }, // fenced code blocks
  { closed: /`[^`]*`/g, opener: /`/ }, // inline code
  { closed: /<[^>]*>/g, opener: /</ }, // inline HTML tags
  { closed: /!?\[[^\]]*\]\([^)]*\)/g, opener: /!?\[/ }, // images + links
  { closed: /(\*\*|__)(.*?)\1/g, opener: /\*\*|__/ }, // bold
  { closed: /~~(.*?)~~/g, opener: /~~/ }, // strikethrough
];

/** The single-asterisk pair, added to the list ONLY under `speakActions: false` (see the note above).
 *  It sits last because it must read a buffer whose `**…**` pairs are already blanked; its opener is
 *  the `em` opener — a `*` followed by a non-space that is not half of a `**` — so ordinary prose
 *  ("3 * 4", a bullet, an unclosed bold) still costs read-along nothing.
 *  `closed` masks EVERY closed span, the one-word ones `toSpeech` now speaks included (session-51
 *  polish #3): this is a mask, not the drop rule — narrowed to multi-word spans, a closed `*really*`
 *  would leave its opener visible and read-along would cut there until the turn-end flush. */
const ACTION_REWRITE = { closed: ACTION_SPAN, opener: ACTION_OPENER };

/** Blank a closed construct WITHOUT moving anything: same length, same line breaks, so the next pass's
 *  indices still address the original string and `.` (which never matches `\n`) still can't span lines. */
const blank = (s: string, re: RegExp): string => s.replace(re, (m) => m.replace(/[^\n]/g, " "));

/** The longest prefix of a streaming markdown buffer that `toSpeech` will still read the same way once
 *  the reply is finished — the buffer cut at the EARLIEST opener that is still unclosed. Takes the same
 *  options `toSpeech` does, because the two halves of read-along must agree on what a span IS. */
export function stableMarkdownPrefix(md: string, opts: SpeechOpts = {}): string {
  let mask = md;
  const rewrites = opts.speakActions === false ? [...REWRITES, ACTION_REWRITE] : REWRITES;
  for (const { closed, opener } of rewrites) {
    mask = blank(mask, closed);
    const at = mask.search(opener);
    if (at >= 0) mask = mask.slice(0, at); // later passes only ever look INSIDE the safe prefix
  }
  return md.slice(0, mask.length);
}
