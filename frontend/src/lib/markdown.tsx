// Minimal markdown → React renderer (Phase 4c). Hand-rolled + dep-free (the agreed approach): the
// bot's replies are markdown, and we want full control over fenced code blocks (each gets a copy +
// send-to-composer action — generalizing vapor's editCmd/cmdInto). Rendering to React nodes (never
// innerHTML) is XSS-safe by construction: text goes through React's escaping and links are scheme-
// allowlisted. It streams: re-parsing the whole (short) text each token is cheap, and a half-typed
// block (e.g. an unclosed ``` fence) still renders sensibly.
//
// Supported: ATX headings, `-`/`*`/`+` and `1.` lists (one level), blockquotes, `---` rules, fenced
// code, and inline **bold** / *italic* / `code` / [links](url) / bare http(s) autolinks. Deliberately
// not a full CommonMark engine — chat replies don't need tables/nested lists/reference links.

import { memo, useState, type JSX, type ReactNode } from "react";

import { ACTION_OPEN, ACTION_SPAN } from "./actionSpan";
import { fillComposer } from "./composer";

// ── inline ──

const INLINE: { re: RegExp; node: (m: RegExpMatchArray, key: number) => ReactNode }[] = [
  { re: /^`([^`]+)`/, node: (m, k) => <code key={k}>{m[1]}</code> },
  { re: /^\*\*([^*]+)\*\*/, node: (m, k) => <strong key={k}>{inline(m[1])}</strong> },
  { re: /^__([^_]+)__/, node: (m, k) => <strong key={k}>{inline(m[1])}</strong> },
  { re: /^\*([^*\s][^*]*)\*/, node: (m, k) => <em key={k}>{inline(m[1])}</em> },
  { re: /^_([^_\s][^_]*)_/, node: (m, k) => <em key={k}>{inline(m[1])}</em> },
  {
    re: /^\[([^\]]+)\]\(([^)\s]+)\)/,
    node: (m, k) => safeLink(m[2], inline(m[1]), k),
  },
  { re: /^(https?:\/\/[^\s)]+)/, node: (m, k) => safeLink(m[1], m[1], k) },
];

/** Allow only http(s)/mailto hrefs; anything else (javascript:, data:) renders as plain text. */
function safeLink(href: string, label: ReactNode, key: number): ReactNode {
  const ok = /^(https?:\/\/|mailto:)/i.test(href);
  if (!ok) return <span key={key}>{label}</span>;
  return (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

/** Parse inline markup into React nodes by scanning for the earliest-matching token. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = "";
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    let hit: ReactNode | null = null;
    for (const { re, node } of INLINE) {
      const m = rest.match(re);
      if (m) {
        if (buf) {
          out.push(buf);
          buf = "";
        }
        hit = node(m, key++);
        i += m[0].length;
        break;
      }
    }
    if (hit) {
      out.push(hit);
    } else {
      buf += text[i];
      i += 1;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** Join the lines of a text block, rendering single newlines as soft breaks (chat-friendly). */
function withBreaks(lines: string[]): ReactNode[] {
  const out: ReactNode[] = [];
  lines.forEach((ln, idx) => {
    if (idx) out.push(<br key={`br${idx}`} />);
    out.push(...inline(ln));
  });
  return out;
}

// ── fenced code block (the one component with actions) ──

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  };
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span className="lang">{lang || "code"}</span>
        <span className="acts">
          <button type="button" onClick={copy}>
            {copied ? "copied" : "copy"}
          </button>
          <button type="button" onClick={() => fillComposer(code)}>
            edit
          </button>
        </span>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ── block parsing ──

const RE = {
  fence: /^```(.*)$/,
  heading: /^(#{1,6})\s+(.*)$/,
  hr: /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/,
  quote: /^>\s?(.*)$/,
  ul: /^\s*[-*+]\s+(.*)$/,
  ol: /^\s*\d+\.\s+(.*)$/,
};

// ── multi-line actions (session-51 polish #2) ──
//
// Inline markup is parsed PER LINE (`withBreaks` → `inline`), so a `*…*` whose closer sits on a later
// line — a roleplay action the model wraps over several lines or whole paragraphs — used to render as
// two literal asterisks. The ear already pairs it as ONE span (lib/actionSpan, read by lib/toSpeech),
// so this text-level pre-pass makes the eye agree: every multi-line single-`*` span is rewritten into
// one `*…*` per line (the standard "split at block boundary" technique — one `<em>` cannot wrap
// several `<p>`/`<br>`s). A single break becomes `<em>…</em><br/><em>…</em>` in one `<p>`; a blank line
// becomes two `<p>`s, each with its own `<em>`. Single-line pairs are left byte-for-byte as they were.
// Scope is `*` only: `_` pairs falsely across lines in snake_case prose, and `**` is its own construct.

/** Stars that are STRUCTURE, not emphasis, blanked (same length) before pairing so they can never
 *  close a span: a `*` bullet marker (also after a `>`), and a `***` / `* * *` rule line. The ear
 *  strips these before its action pass too (lib/toSpeech's line-prefix passes), so both halves agree
 *  a bullet list after a stray `*` stays a list. */
const STRUCTURAL_STAR = /^([ \t]*(?:>[ \t]?)*)\*(?=[ \t])/gm;
const STAR_RULE = /^ {0,3}\*(?:[ \t]*\*){2,}[ \t]*$/gm;
/** Inline code is literal, so its stars can neither open nor close a span (fix wave 1: the
 *  `` - `*.log` `` / `` - `*.tmp` `` bullets paired through their globs). The renderer's own inline-code
 *  spelling (`INLINE`'s `` `([^`]+)` ``), kept to one line because `inline()` never sees a `\n`. */
const INLINE_CODE = /`[^`\n]+`/g;

/** What a continuation line keeps OUTSIDE its `*…*` wrapper: indentation plus any block marker
 *  (quote / bullet / ordered / heading), so the block parser still sees the line's structure. */
const LINE_LEAD = /^[ \t]*(?:>[ \t]?)*(?:[-*+][ \t]+|\d+\.[ \t]+|#{1,6}[ \t]+)?/;

/** One `*…*` per line of a span's inner text. Whitespace (and a continuation line's block marker)
 *  stays outside the wrapper, so every segment still satisfies the em rule (`*` + non-space); an
 *  empty segment (the blank line of a paragraph break) and a rule line are emitted as they are. */
function perLine(inner: string): string {
  return inner
    .split("\n")
    .map((seg, idx) => {
      if (idx > 0 && RE.hr.test(seg)) return seg;
      const lead = (idx > 0 ? LINE_LEAD : /^\s*/).exec(seg)![0];
      const body = seg.slice(lead.length);
      const core = body.trimEnd();
      return core ? `${lead}*${core}*${body.slice(core.length)}` : seg;
    })
    .join("\n");
}

/** Rewrite the multi-line action spans of one run of NON-fence text. `tailOpen` (Q2b, the settled
 *  reply's last run only): an opener the model never closed is italicized to the end, as if a closer
 *  followed — while streaming it stays literal until the closer arrives, so nothing flickers. */
function splitActions(text: string, tailOpen: boolean): string {
  const blankStars = (m: string) => m.replace(/\*/g, "\u0000");
  const mask = text
    .replace(INLINE_CODE, blankStars)
    .replace(STAR_RULE, blankStars)
    .replace(STRUCTURAL_STAR, (_m, lead: string) => `${lead}\u0000`);
  const spans: { start: number; end: number; closed: boolean }[] = [];
  for (const m of mask.matchAll(ACTION_SPAN))
    spans.push({ start: m.index, end: m.index + m[0].length, closed: true });
  if (tailOpen) {
    // The ear's order: closed spans first, then an opener left over at the end (lib/toSpeech).
    const at = mask.replace(ACTION_SPAN, (m) => " ".repeat(m.length)).search(ACTION_OPEN);
    if (at >= 0) spans.push({ start: at, end: text.length, closed: false });
  }
  let out = "";
  let from = 0;
  for (const { start, end, closed } of spans) {
    const inner = text.slice(start + 1, closed ? end - 1 : end);
    out += text.slice(from, start);
    out += closed && !inner.includes("\n") ? text.slice(start, end) : perLine(inner);
    from = end;
  }
  return out + text.slice(from);
}

/** The pre-pass over a whole (newline-normalized) source: fenced code is never touched — the source
 *  is walked with the SAME fence rule `blocks` uses (an unclosed trailing fence captures the rest), so
 *  a span can neither pair across a fence nor italicize one. */
function carryActions(src: string, settled: boolean): string {
  if (!src.includes("*")) return src; // no star, no span — a plain reply pays nothing per token
  const runs: { text: string[]; fence: boolean }[] = [];
  let fenced = false;
  for (const line of src.split("\n")) {
    const isFence = RE.fence.test(line);
    const inFence = fenced || isFence;
    const last = runs.at(-1);
    if (last && last.fence === inFence && !(isFence && !fenced)) last.text.push(line);
    else runs.push({ text: [line], fence: inFence });
    if (isFence) fenced = !fenced;
  }
  return runs
    .map((r, idx) =>
      r.fence
        ? r.text.join("\n")
        : splitActions(r.text.join("\n"), settled && idx === runs.length - 1),
    )
    .join("\n");
}

/** Split markdown into a flat list of rendered block nodes. */
function blocks(src: string, settled: boolean): ReactNode[] {
  const lines = carryActions(src.replace(/\r\n?/g, "\n"), settled).split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // blank — block separator
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // fenced code (collect to closing fence; an unclosed fence while streaming captures the rest)
    const fence = line.match(RE.fence);
    if (fence) {
      const lang = fence[1].trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !RE.fence.test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) i += 1; // consume the closing ```
      out.push(<CodeBlock key={key++} code={body.join("\n")} lang={lang} />);
      continue;
    }

    // horizontal rule
    if (RE.hr.test(line)) {
      out.push(<hr key={key++} />);
      i += 1;
      continue;
    }

    // heading
    const h = line.match(RE.heading);
    if (h) {
      const level = h[1].length;
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      out.push(<Tag key={key++}>{inline(h[2])}</Tag>);
      i += 1;
      continue;
    }

    // blockquote (consecutive `>` lines)
    if (RE.quote.test(line)) {
      const body: string[] = [];
      while (i < lines.length && RE.quote.test(lines[i])) {
        body.push(lines[i].match(RE.quote)![1]);
        i += 1;
      }
      out.push(<blockquote key={key++}>{withBreaks(body)}</blockquote>);
      continue;
    }

    // lists (a run of same-type items; one level)
    if (RE.ul.test(line) || RE.ol.test(line)) {
      const ordered = RE.ol.test(line);
      const re = ordered ? RE.ol : RE.ul;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) {
        items.push(lines[i].match(re)![1]);
        i += 1;
      }
      const lis = items.map((it, idx) => <li key={idx}>{inline(it)}</li>);
      out.push(ordered ? <ol key={key++}>{lis}</ol> : <ul key={key++}>{lis}</ul>);
      continue;
    }

    // paragraph (consecutive plain lines until a blank or a block starter)
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      const l = lines[i];
      if (RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l)) break;
      if (RE.ul.test(l) || RE.ol.test(l)) break;
      para.push(l);
      i += 1;
    }
    if (para.length) out.push(<p key={key++}>{withBreaks(para)}</p>);
  }
  return out;
}

/** Render a markdown string as themed React nodes (styling = kit.css `.md` — the one source since D51 V5).
 *  Memoized on its props: during streaming the whole chat-log re-renders per token, but a COMPLETED
 *  bubble's text is byte-stable, so it skips the full from-scratch re-parse (the LibreChat /
 *  Vercel-AI-SDK block-memoization pattern at the message grain). Only the still-growing streaming bubble
 *  re-parses.
 *
 *  `settled` (session-51 polish #2, Q2b): the text is final — no token will extend it — so an action
 *  opener the model never closed is italicized to the end. Absent/false keeps it literal (the streaming
 *  posture: a closer may still arrive). */
export const Markdown = memo(function Markdown({
  text,
  settled = false,
}: {
  text: string;
  settled?: boolean;
}) {
  return <>{blocks(text, settled)}</>;
});
