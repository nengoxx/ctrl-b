import { useRef } from "react";

import { useComposer } from "../../../hooks/useComposer";
import { stopTurn } from "../../../store/chat";
import { MicIcon, SendArrowheadIcon, StopSquareIcon } from "./icons";
import type { ComposerSlots } from "./types";
import { MIC_LABEL, useComposerChrome } from "./useComposerChrome";

// The Phase E "line" composer variant (COMPOSER_SURFACE_PLAN §Phase E — owner-confirmed 2026-07-11): the
// Telegram-reference SINGLE ROW — `[plan pill (leading)] [flex "Message" field] [morph mic/send]` — rebuilt
// in the Kit's SEMANTIC tokens. A genuinely different structure from the stacked/sheet bars, so a REAL
// component variant (not a `rootClass` wrapper), but SAME BEHAVIOUR as every variant: it reuses the headless
// `useComposer()` controller + the shared `useComposerChrome()` presentational hook, honours the same
// `ComposerSlots` placement contract (§15), and keeps aria parity with KitComposer/SheetComposer.
//
// Owner-confirmed rulings (2026-07-11), do not re-litigate:
//   • MIC + SEND (revised at the line eyeball, 2026-07-11 — supersedes the original full-morph ruling): the
//     MIC never disappears while dictation is configured; SEND joins to its right once the draft is
//     non-empty (empty draft + STT → mic alone, the compact resting look; no STT → send alone). Both share
//     `.line-btn` (the same accent circle).
//   • AUTO-GROW — the shared 96px ceiling from `useComposerChrome`; no new knob.
//   • ATTACH — ABSENT (nothing reserved in the DOM); a placement comment marks where ROADMAP A8 lands it,
//     capability-gated like the mic.
//   • GEOMETRY — a FLOATING ROUNDED-SQUARE PILL: inherits the base `.kit-composer` float (inset ~90% width,
//     frost/border/shadow — "not baked into the window"), reshaped to `border-radius:24px`, a compact single
//     row; the pill + mic/send ride the BOTTOM (`align-items:flex-end`) while the field's extra lines stack
//     UPWARD as it grows. Collapsed it reads as a stadium (24px ≈ half the ~46px bar); grown, the 36px round
//     button (r18, inset 6px) nests concentrically in the 24px corner (r18+6=24), no chord-clip (owner round
//     6, supersedes the old vertical-center stadium). The emoji icon is DROPPED (we don't model emoji).
// The root KEEPS the `.kit-composer` class (edge #5) so DefaultRoot's `querySelector(".kit-composer")`
// --composer-h measurement still finds it; `.line` adds the stadium styling in kit.css.
export function LineComposer({ controlsStart, overlay }: ComposerSlots = {}) {
  const { draft, setDraft, send, isStreaming, mic, sttReady } = useComposer();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { micPressed, pressMic, releaseMic, onKeyDown } = useComposerChrome(taRef, draft, send);

  // The trailing controls (owner eyeball 2026-07-11, revising the original full-morph): the MIC is visible
  // whenever dictation is configured — it must never vanish just because text exists — and SEND joins it (to
  // its right) once there's something to send. Empty draft + STT → mic only (the compact resting look);
  // typing/dictating slides send in beside the mic; no STT → always send alone.
  const showMic = sttReady;
  // `isStreaming` keeps the button mounted as the Stop control (D39, Slice-3 audit MED-1): `send()`
  // clears the draft, so without it the STT+empty-draft resting state would hide Stop exactly while
  // a turn runs — the one moment it must exist.
  const showSend = !sttReady || draft !== "" || isStreaming;

  return (
    <>
      {/* `overlay` slot — a positioned sibling ABOVE `.kit-composer` (e.g. the plan sheet). Rendered before
          the bar so, at equal stacking, the floating composer paints over the overlay's tucked bottom edge. */}
      {overlay}
      <div className="kit-composer line" id="composer">
        {/* `controlsStart` slot — the in-row plan pill FLUSH at the leading edge (owner eyeball: mirror how
            the mic/send hug the trailing edge; this IS A4's `planPill: inline` semantics; with `pinned` the
            slot is empty → `.line-controls:empty` collapses the wrapper, the same trick the sheet uses). */}
        {controlsStart && <div className="line-controls">{controlsStart}</div>}
        <textarea
          ref={taRef}
          id="cmd-input"
          rows={1}
          // "Message" — the reference's own copy: the compact single-row bar wants a SHORT placeholder (a
          // deliberate delta from the Kit's long "How can I help you today?").
          placeholder="Message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {/* ROADMAP A8 attach button lands HERE (trailing of the field, leading of the mic/send),
            capability-gated like the mic. Nothing is reserved in the DOM until then. */}
        {showMic && (
          <button
            type="button"
            className={
              "kit-cbtn mic line-btn" +
              (mic.status === "recording" ? " rec" : "") +
              (micPressed ? " press" : "") +
              (mic.status === "unavailable" || mic.status === "insecure" ? " unavail" : "")
            }
            aria-label={MIC_LABEL[mic.status]}
            title={MIC_LABEL[mic.status]}
            aria-pressed={mic.status === "recording"}
            disabled={mic.status === "unavailable" || mic.status === "sending"}
            onPointerDown={pressMic}
            onPointerUp={releaseMic}
            onPointerCancel={releaseMic}
            onPointerLeave={releaseMic}
            onClick={mic.toggle}
          >
            <MicIcon size={22} />
          </button>
        )}
        {showSend && (
          <button
            type="button"
            className={"kit-send line-btn" + (isStreaming ? " stop" : "")}
            id="cmd-send"
            aria-label={isStreaming ? "stop the running turn" : "send message"}
            title={isStreaming ? "stop the running turn" : "send message"}
            onClick={isStreaming ? stopTurn : send}
          >
            {/* Streaming → the Stop square (D39, same swap as every composer). Idle → the SHARED
                arrowhead glyph — optically re-centered via the `.kit-send.line-btn svg` nudge in
                kit.css (the glyph's mass leans up-right, vapor's fix). */}
            {isStreaming ? <StopSquareIcon size={16} /> : <SendArrowheadIcon size={20} />}
          </button>
        )}
      </div>
    </>
  );
}
