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

/** Emoji, as a RUN of code points: `\p{RGI_Emoji}` is a property-of-STRINGS, so it needs the `v` flag
 *  to match a whole ZWJ/skin-tone sequence rather than its pieces (the same regex open-webui landed on
 *  after its code-point version missed the entire BMP emoji block). */
const EMOJI = /\p{RGI_Emoji}/gv;

export function toSpeech(md: string): string {
  let s = md;
  s = s.replace(/```[\s\S]*?```/g, " "); // fenced code blocks — don't read code aloud
  s = s.replace(/`([^`]+)`/g, "$1"); // inline code → its text
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
  s = s.replace(/(\*|_)(.*?)\1/g, "$2"); // italic
  s = s.replace(/~~(.*?)~~/g, "$1"); // strikethrough
  s = s.replace(EMOJI, " "); // emoji — a space, not "", so "hi🎉there" doesn't become one word
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
 *  case is a stray delimiter in one chunk of a rare shape (accepted residual, owner-ruled). */
const REWRITES: { closed: RegExp; opener: RegExp }[] = [
  { closed: /```[\s\S]*?```/g, opener: /```/ }, // fenced code blocks
  { closed: /`[^`]*`/g, opener: /`/ }, // inline code
  { closed: /<[^>]*>/g, opener: /</ }, // inline HTML tags
  { closed: /!?\[[^\]]*\]\([^)]*\)/g, opener: /!?\[/ }, // images + links
  { closed: /(\*\*|__)(.*?)\1/g, opener: /\*\*|__/ }, // bold
  { closed: /~~(.*?)~~/g, opener: /~~/ }, // strikethrough
];

/** Blank a closed construct WITHOUT moving anything: same length, same line breaks, so the next pass's
 *  indices still address the original string and `.` (which never matches `\n`) still can't span lines. */
const blank = (s: string, re: RegExp): string => s.replace(re, (m) => m.replace(/[^\n]/g, " "));

/** The longest prefix of a streaming markdown buffer that `toSpeech` will still read the same way once
 *  the reply is finished — the buffer cut at the EARLIEST opener that is still unclosed. */
export function stableMarkdownPrefix(md: string): string {
  let mask = md;
  for (const { closed, opener } of REWRITES) {
    mask = blank(mask, closed);
    const at = mask.search(opener);
    if (at >= 0) mask = mask.slice(0, at); // later passes only ever look INSIDE the safe prefix
  }
  return md.slice(0, mask.length);
}
