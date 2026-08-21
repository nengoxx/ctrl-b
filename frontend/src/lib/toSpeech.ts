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
  s = s.replace(/~~(.*?)~~/g, "$2"); // strikethrough
  s = s.replace(EMOJI, " "); // emoji — a space, not "", so "hi🎉there" doesn't become one word
  s = s.replace(/[^\S\n]+/g, " "); // collapse HORIZONTAL whitespace only (newlines survive)
  s = s.replace(/ ?\n ?/g, "\n"); // …and drop the spaces left hugging a newline
  s = s.replace(/\n{3,}/g, "\n\n"); // 3+ newlines → one paragraph break
  return s.trim();
}
