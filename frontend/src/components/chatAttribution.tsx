import { Fragment, type ReactNode, useState } from "react";

import type { CallUsage, ChatMessage, MessageSource } from "../types";

// D62 — per-message SERVE ATTRIBUTION for the assistant who-line: the always-on endpoint chip
// (`⏺ ASSISTANT · CORSAIR · 14:32`, warn-coloured when a fallback saved the turn) and the tap-to-reveal
// metrics disclosure under it. Lives beside ChatThread because it is who-line furniture, not a bubble:
// ChatThread owns the bubble tree and hands this component the label + the trailing who-line extras.
//
// Two rules run through everything here:
//   • EVERY segment omits itself when its datum is absent. The backend records what the endpoint
//     reported and nothing else, so a partial report renders fewer segments — never a zero, never an
//     "unknown". A message with no `source` and no `usage` (every pre-D62 row, every user turn) renders
//     the plain old who-line and is not tappable at all.
//   • The model id lives in `usage.model` and the endpoint in `source.served` — the who-line shows the
//     ENDPOINT (the owner's own friendly name, legible at 10px), the disclosure shows the model.

/** Tokens in the who-line's register: `512` · `8.1k` · `262k`. One decimal only where it earns its
 *  place (under 10k), so a context window reads `262k` rather than `262.1k`. */
export function kTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${Number((n / 1000).toFixed(1))}k`;
  return `${Math.round(n / 1000)}k`;
}

/** A call duration: `840ms` under a second, `12.3s` above it. */
export function duration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Output throughput — `41 tok/s` — or `null` when either half is missing/zero (we measure the call,
 *  but the token count is the provider's to report). */
export function tokensPerSecond(out: number | null | undefined, ms: number | null | undefined) {
  if (out == null || ms == null || ms <= 0) return null;
  return `${Math.round(out / (ms / 1000))} tok/s`;
}

/** How full the served endpoint's window this prompt ran — `31% of 262k`. Needs both the prompt size
 *  and the window that served it; `null` otherwise (a cloud endpoint with no declared window). */
export function windowShare(input: number | null | undefined, window: number | null | undefined) {
  if (input == null || window == null || window <= 0) return null;
  return `${Math.round((input / window) * 100)}% of ${kTokens(window)}`;
}

/** One line of the disclosure. `glyph` is decorative (aria-hidden) and `sr` carries its words, so
 *  `↑ 8.1k` is announced as "input tokens 8.1k" rather than as a bare arrow. */
interface Seg {
  glyph?: string;
  sr?: string;
  text: string;
}
interface Row {
  segs: Seg[];
  warn?: boolean;
}

/** The disclosure's content, as data (pure — the unit under test):
 *    `qwen3.6-max · ↑ 8.1k (6.9k cached) · ↓ 512`
 *    `31% of 262k · 12.3s · 41 tok/s`
 *    `↯ fallback from corsair · 2 failed hops`   (degraded only, warn)
 *  Empty rows are dropped, so `[]` means "nothing to disclose" — which is also what makes the
 *  who-line non-tappable. */
export function metricRows(
  source: MessageSource | null | undefined,
  usage: CallUsage | null | undefined,
): Row[] {
  // llama.cpp-style endpoints report only the NEWLY-prefilled tokens as input, with cache hits in a
  // separate counter — so `cached > input` (impossible under OpenAI's subset semantics, where the
  // prompt total includes cached) marks the additive shape, and the honest "sent up" total — for the
  // ↑ figure AND the window share — is their sum. Facts persist as-reported; only display normalizes.
  const inTok = usage?.input_tokens;
  const cachedTok = usage?.cached_tokens;
  const totalIn =
    inTok != null ? (cachedTok != null && cachedTok > inTok ? inTok + cachedTok : inTok) : null;

  const call: Seg[] = [];
  if (usage?.model) call.push({ text: usage.model });
  if (totalIn != null) {
    const cached = cachedTok != null ? ` (${kTokens(cachedTok)} cached)` : "";
    call.push({ glyph: "↑", sr: "input tokens", text: `${kTokens(totalIn)}${cached}` });
  }
  if (usage?.output_tokens != null) {
    call.push({ glyph: "↓", sr: "output tokens", text: kTokens(usage.output_tokens) });
  }

  const cost: Seg[] = [];
  const share = windowShare(totalIn, source?.context_window);
  if (share) cost.push({ text: share });
  if (usage?.duration_ms != null) cost.push({ text: duration(usage.duration_ms) });
  const rate = tokensPerSecond(usage?.output_tokens, usage?.duration_ms);
  if (rate) cost.push({ text: rate });

  const fallback: Seg[] = [];
  if (source?.degraded) {
    fallback.push({
      glyph: "↯",
      text: source.from ? `fallback from ${source.from}` : "served by a fallback",
    });
    if (source.failed_hops) {
      fallback.push({
        text: `${source.failed_hops} failed hop${source.failed_hops === 1 ? "" : "s"}`,
      });
    }
  }

  return [{ segs: call }, { segs: cost }, { segs: fallback, warn: true }].filter(
    (r) => r.segs.length > 0,
  );
}

function MetricLine({ row }: { row: Row }) {
  return (
    <div className={"who-meta-row" + (row.warn ? " warn" : "")}>
      {row.segs.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          <span className="who-seg">
            {s.glyph && <span aria-hidden="true">{s.glyph} </span>}
            {s.sr && <span className="who-sr">{s.sr} </span>}
            {s.text}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/** The assistant who-line: `⏺ ASSISTANT · CORSAIR · 14:32`, plus the metrics disclosure it toggles.
 *
 *  Tapping ANYWHERE on the line toggles (owner ruling — and deliberately no visual affordance hint).
 *  Keyboard/AT operability follows D25's BREAKOUT pattern rather than `disclosureToggle`: the line can
 *  contain the read-aloud button, and a `role="button"` row containing a button is the very
 *  `nested-interactive` violation D25 fixed on the fleet row. So the row stays a plain `<div onClick>`
 *  and the real toggle is a child `<button aria-expanded>` — sr-only here (the kit's `.bs-close-sr`
 *  recipe) because the owner ruled out a visible affordance. Nested controls stop propagation so they
 *  don't double-fire (`TtsButton`).
 *
 *  `children` are the trailing who-line extras ChatThread owns (the working/thinking tag, the
 *  read-aloud toggle) — passed in rather than re-implemented here. */
export function BotWhoLine({
  m,
  label,
  time,
  children,
}: {
  m: ChatMessage;
  /** The turn's speaker — the AgentDef name for a specialist turn, else "assistant" (7e-c). */
  label: string;
  /** The already-formatted `hh:mm` (ChatThread owns the clock format). */
  time: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const source = m.source;
  const rows = metricRows(source, m.usage);
  const toggle = () => setOpen((o) => !o);
  return (
    <>
      <div className="who" onClick={rows.length ? toggle : undefined}>
        {label} ·{" "}
        {source && (
          <>
            <span className={"who-ep" + (source.degraded ? " degraded" : "")}>
              <span className="who-sr">
                {source.degraded ? "served after a fallback by " : "served by "}
              </span>
              {source.served}
            </span>{" "}
            ·{" "}
          </>
        )}
        {time}
        {children}
        {rows.length > 0 && (
          <button
            className="who-sr"
            aria-expanded={open}
            // stopPropagation, or the click bubbles to the row's own toggle and the pair cancels out
            // (D62 review F2) — the same guard TtsButton already carries.
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
          >
            message details
          </button>
        )}
      </div>
      {open && rows.length > 0 && (
        <div className="who-meta">
          {rows.map((r, i) => (
            <MetricLine key={i} row={r} />
          ))}
        </div>
      )}
    </>
  );
}
