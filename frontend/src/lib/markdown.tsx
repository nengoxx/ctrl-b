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

/** Split markdown into a flat list of rendered block nodes. */
function blocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
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
 *  Memoized on `text`: during streaming the whole chat-log re-renders per token, but a COMPLETED bubble's
 *  text is byte-stable, so it skips the full from-scratch re-parse (the LibreChat / Vercel-AI-SDK
 *  block-memoization pattern at the message grain). Only the still-growing streaming bubble re-parses. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return <>{blocks(text)}</>;
});
