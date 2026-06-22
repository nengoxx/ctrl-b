// Strip Markdown to plain prose for TTS, so the synth reads words rather than syntax
// ("**bold**" → "bold", a fenced code block → nothing). Hand-rolled + dependency-free, matching the
// project's no-dep markdown renderer (lib/markdown.tsx) — we render markdown for the eye there and
// speak the prose here. Intentionally lossy: code, images, and rule lines are dropped, not voiced.

export function toSpeech(md: string): string {
  let s = md;
  s = s.replace(/```[\s\S]*?```/g, " "); // fenced code blocks — don't read code aloud
  s = s.replace(/`([^`]+)`/g, "$1"); // inline code → its text
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " "); // images → nothing
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // links → the link text
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, ""); // heading markers
  s = s.replace(/^\s{0,3}>\s?/gm, ""); // blockquote markers
  s = s.replace(/^\s*[-*+]\s+/gm, ""); // unordered list markers
  s = s.replace(/^\s*\d+\.\s+/gm, ""); // ordered list markers
  s = s.replace(/^\s*([-*_])(?:\s*\1){2,}\s*$/gm, " "); // horizontal rules
  s = s.replace(/(\*\*|__)(.*?)\1/g, "$2"); // bold
  s = s.replace(/(\*|_)(.*?)\1/g, "$2"); // italic
  s = s.replace(/~~(.*?)~~/g, "$2"); // strikethrough
  s = s.replace(/\s+/g, " ").trim(); // collapse whitespace
  return s;
}
