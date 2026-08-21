// D63 — the TTS chunker: `toSpeech` prose in, an ORDERED list of speakable chunks out. Pure and
// dependency-free (same posture as lib/toSpeech, which is its only input source), so it is exhaustively
// unit-testable and the playback queue in lib/audioController owns no text logic at all.
//
// Why chunks: synthesizing a whole reply is one 13-second wait before any sound; synthesizing the first
// sentence is ~0.7 s (R50 P2). The queue plays chunk N while chunk N+1 synthesizes, so the split has to
// be (a) at a place a human would pause and (b) never so small that the prosody shatters.
//
// Three rules, in this order — split, then merge up to the floor, then break anything over the cap:
//   split   sentence mode on `[.!?…]` + any newline · paragraph mode on blank lines only.
//   floor   a piece under EITHER floor (`minWords` words OR `minChars` chars) keeps accumulating
//           forward, so "Sure." never becomes its own 300 ms clip. open-webui's rule and its numbers.
//   cap     over `maxChars` → break at the last word boundary under the cap; if the piece has NO word
//           boundary under the cap (one absurd token), HARD-CUT at the cap so the queue always advances.
//
// Deliberately NOT list-aware and deliberately not `Intl.Segmenter` (both probed, neither better).

/** The chunk policy — the `tts_chunking` object `GET /voice/status` delivers, in client spelling. */
export interface ChunkCfg {
  /** `off` = one chunk, the whole message (the pre-D63 path). */
  mode: "off" | "paragraph" | "sentence";
  minWords: number;
  minChars: number;
  maxChars: number;
  /** Per-MESSAGE character budget. Chunks past it are dropped (D63 moved this bound off the request). */
  maxTextChars: number;
}

export interface ChunkPlan {
  chunks: string[];
  /** True when the message ran past `maxTextChars` and its tail was dropped — the caller toasts once. */
  dropped: boolean;
}

/** Sentence end, or ANY line break (a heading or list item ends a thought without punctuation). */
const SENTENCE_SPLIT = /(?<=[.!?…])\s+|\n+/;
const PARAGRAPH_SPLIT = /\n{2,}/;

const words = (s: string): number => (s.match(/\S+/g) ?? []).length;

/** Break one over-long piece at word boundaries under `maxChars`, hard-cutting an unbroken token. */
function capped(piece: string, maxChars: number): string[] {
  const out: string[] = [];
  let rest = piece;
  while (rest.length > maxChars) {
    const head = rest.slice(0, maxChars + 1); // +1 so a boundary AT the cap still counts
    // Paragraph mode keeps newlines inside a piece, so both are word boundaries here.
    const cut = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n"));
    // No boundary at all → the piece is one unbroken token; cut it mid-word rather than emit a chunk
    // the server would 422 (or, worse, loop forever making no progress).
    const at = cut > 0 ? cut : maxChars;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** The full plan, including whether the per-message budget dropped a tail. */
export function chunkPlan(text: string, cfg: ChunkCfg): ChunkPlan {
  const src = text.trim();
  if (!src) return { chunks: [], dropped: false };
  // `off` is the pre-D63 path verbatim: one request carrying the whole message, whose length the
  // server's own per-request 422 still bounds. No cap applied here — that would change its behavior.
  if (cfg.mode === "off") return { chunks: [src], dropped: false };

  const pieces = src
    .split(cfg.mode === "paragraph" ? PARAGRAPH_SPLIT : SENTENCE_SPLIT)
    .map((p) => p.trim())
    .filter(Boolean);

  // Merge floor — accumulate forward until the buffer clears BOTH floors, then emit it. A trailing
  // buffer that never cleared them is emitted anyway: there is nothing left to merge it with.
  const merged: string[] = [];
  let buf = "";
  for (const piece of pieces) {
    buf = buf ? `${buf} ${piece}` : piece;
    if (words(buf) >= cfg.minWords && buf.length >= cfg.minChars) {
      merged.push(buf);
      buf = "";
    }
  }
  if (buf) merged.push(buf);

  // Cap + the per-message budget. `chunk_max_chars <= max_text_chars` is validated server-side, so the
  // first chunk always fits and playback always starts.
  const chunks: string[] = [];
  let budget = cfg.maxTextChars;
  let dropped = false;
  for (const piece of merged) {
    for (const chunk of capped(piece, cfg.maxChars)) {
      if (chunk.length > budget) {
        dropped = true;
        return { chunks, dropped };
      }
      budget -= chunk.length;
      chunks.push(chunk);
    }
  }
  return { chunks, dropped };
}

/** The chunk list alone — the pure `(text, cfg) => string[]` form most callers want. */
export function ttsChunks(text: string, cfg: ChunkCfg): string[] {
  return chunkPlan(text, cfg).chunks;
}
