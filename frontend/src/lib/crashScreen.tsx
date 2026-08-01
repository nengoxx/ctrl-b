import type { ReactNode } from "react";

// The crash screens (§14.15.1 item ② + F23) — the shared style primitives, plus the GLOBAL root fallback
// itself (main.tsx wires it into the outer ErrorBoundary; App.tsx composes its own theme-fault panel from
// the same primitives, since it also needs a Reset action).
//
// SELF-CONTAINED BY CONTRACT: a crash screen may assume NO theme CSS loaded — "never depend on the styling
// of the thing that crashed". Every class these screens wear is vapor-`@scope`d (`.root-error`/
// `.root-error-body`/`.conf-save` in `theme/extras.css`; `.sec`/`.num`/`.right` in `theme/vapor.css`), so
// they resolve for exactly ONE skin — and since D51 V0 that skin is no longer the default. The contract is a
// READABLE BASELINE, not pixel uniformity: these inline objects own every readability-critical property
// (both halves of each color pair, layout, wrap), and inline beats any stylesheet where they overlap. A skin
// whose scoped rules still match (vapor today) may DECORATE the properties the baseline doesn't set —
// typography, spacing, the section-header dressing — which is its own designed look on its own skin, not a
// defect. The class names stay on the markup for exactly that reason (plus the e2e hooks + F23 lineage).
//
// COLOR PAIRING (Codex, MED): a foreground/background pair must come from ONE source. The button's
// background+color are therefore both NEUTRAL LITERALS — an earlier `background: var(--accent-fill)` +
// `color: var(--text)` mixed a fill token (which owns its own on-fill ink) with the page text token, which
// under vapor put light text on its magenta gradient. Only the BORDER still reads `var(--accent, …)`: it's a
// theme hint whose contrast doesn't gate readability. The shell keeps `var(--bg)`/`var(--text)` — that IS a
// single-source pair (the contract pair the contrast e2e gates for every theme), with neutral fallbacks.
export const crashShell = {
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: 16,
  padding: 24,
  maxWidth: 480,
  margin: "0 auto",
  background: "var(--bg, #101014)",
  color: "var(--text, #e8e8ea)",
  fontFamily: "ui-monospace, monospace",
} as const;

/** The error line inside `.root-error-body` (dimmed, wraps a long stack/message rather than overflowing). */
export const crashMessage = { opacity: 0.8, overflowWrap: "anywhere" } as const;

/** A recovery action — neutral fill + neutral ink (see COLOR PAIRING above). */
export const crashBtn = {
  padding: "10px 16px",
  border: "1px solid var(--accent, #7a7a8c)",
  borderRadius: 8,
  background: "#26262e",
  color: "#e8e8ea",
  font: "inherit",
  cursor: "pointer",
} as const;

/** The SECONDARY recovery action — a recessed neutral, NOT `transparent`: a see-through fill would re-pair
 *  the neutral label with the shell's themed `var(--bg)` and lose contrast on a light skin. */
export const crashBtnQuiet = { ...crashBtn, background: "#16161b" } as const;

// F23 — the GLOBAL root fallback. The Slice-6 ErrorBoundary inside <App> handles the lazy Conf chunk
// specifically (chunk-load failure → render inside the tab area); this one is the net for crashes in any
// always-mounted subtree (AppBar / Composer / TabBar / Toasts / Fleet / Agent / Utils / hooks). Layout is
// self-contained — `.app-shell` isn't mounted when this fires, so it can't reuse `.tab`. ONE action: reload
// (the boundary's `window.location.reload`), which also picks up a new build after a deploy.
//
// It lives here rather than in main.tsx so it is unit-testable: importing main.tsx would run the real
// `createRoot(...).render(...)` composition root.
export function rootErrorFallback(error: Error, reload: () => void): ReactNode {
  return (
    <div className="root-error" style={crashShell}>
      <div className="sec">
        <span className="num" aria-hidden>
          !!
        </span>
        <b>ctrl·b</b>
        <span className="right">// the app hit a snag</span>
      </div>
      <div className="root-error-body">
        <p style={crashMessage}>// {error.message || "unknown error"}</p>
        <button className="conf-save" style={crashBtn} onClick={reload}>
          Reload page
        </button>
      </div>
    </div>
  );
}
