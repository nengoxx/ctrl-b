import { useRef } from "react";

import { useComposer } from "../../../hooks/useComposer";
import type { ComposerSlots } from "./types";
import { MIC_LABEL, useComposerChrome } from "./useComposerChrome";

// Kit composer (D29 §14.4) — the DEFAULT composer variant: token-driven, `.kit-*` classes, STACKED layout
// (full-width textarea over a controls row, so multi-line input gets the room). Same behaviour as vapor's
// Composer (draft, prefix-routed send, streaming gate, dictation mic) via the SAME headless controller
// (useComposer); only the markup/icons differ. Inline SVG mic/send icons.
//
// COMPOSITION (D30): accepts optional `ComposerSlots` (slot-based composition, not config flags). The
// variant decides WHERE each slot renders — `controlsStart` opens the controls row (left of mic/send),
// `overlay` is a positioned SIBLING above the composer (so a sheet can tuck behind the composer's rounded
// top; a child would paint in front). A base theme passes no slots and gets the bare composer.
//
// `rootClass` is the VARIANT-WRAPPER seam (A2b): a pure-CSS variant (e.g. `ghost`) wraps KitComposer and
// passes an extra root class it restyles in kit.css — same DOM + behaviour, no fork. It is INTERNAL: NOT
// part of the `ComposerSlots` theme contract — themes never pass it (only a sibling wrapper component does).

export function KitComposer({
  controlsStart,
  overlay,
  rootClass,
}: ComposerSlots & { rootClass?: string } = {}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { draft, setDraft, send, isStreaming, mic, sttReady } = useComposer();
  // Shared presentational chrome (mic-press toggle, auto-grow, Enter-to-send) — §3.1.
  const { micPressed, pressMic, releaseMic, onKeyDown } = useComposerChrome(taRef, draft, send);

  return (
    <>
      {/* `overlay` slot — a positioned sibling ABOVE `.kit-composer` (e.g. the plan sheet). Rendered before
          the bar so, at equal stacking, the composer paints over the overlay's tucked bottom edge. */}
      {overlay}
      <div className={"kit-composer" + (rootClass ? " " + rootClass : "")} id="composer">
        <div className="field">
          <textarea
            ref={taRef}
            id="cmd-input"
            rows={1}
            placeholder="How can I help you today?"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="crow">
          {/* `controlsStart` slot — opens the controls row (left of mic/send), e.g. the plan pill. */}
          {controlsStart}
          <span className="grow" />
          {sttReady && (
            <button
              type="button"
              className={
                "kit-cbtn mic" +
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            className="kit-send"
            id="cmd-send"
            aria-label="send message"
            title="send message"
            disabled={isStreaming}
            onClick={send}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
