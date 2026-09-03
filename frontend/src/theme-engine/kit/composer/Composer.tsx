import { useRef, type ReactNode } from "react";

import { useAttachments } from "../../../hooks/useAttachments";
import { useComposer } from "../../../hooks/useComposer";
import { useComposerSuggest } from "../../../hooks/useComposerSuggest";
import { stopTurn } from "../../../store/chat";
import { useUISlice } from "../../../store/ui";
import { useComposerSkin } from "../axes";
import { AttachClip, AttachRail } from "./AttachRail";
import { ExpandToggle } from "./ExpandToggle";
import { SendArrowheadIcon, SpinnerIcon, StopSquareIcon } from "./icons";
import { SuggestPopover } from "./SuggestPopover";
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
// KitComposer is the STACKED layout — it stamps a `.stacked` root class so the `composerSkin` axis can key
// stacked-only chrome (kit.css: glass/sleek's icon-forward + underline treatments) WITHOUT touching the sheet/
// line layouts (which render their own `.kit-composer.sheet`/`.line`). `rootClass` + `sendIcon` stay the
// VARIANT-WRAPPER seam for a FUTURE bespoke wrapper (a theme's own composer): the extra class is APPENDED after
// `.stacked` and restyled in kit.css, and `sendIcon` overrides the glyph — same DOM + behaviour, no fork. Both
// are INTERNAL: NOT part of the `ComposerSlots` theme contract (themes never pass them). The default send glyph
// is skin-aware: the `glass` skin uses the shared arrowhead (the old Borderless behaviour) unless an explicit
// `sendIcon` was passed.

export function KitComposer({
  controlsStart,
  overlay,
  placeholder,
  rootClass,
  sendIcon,
}: ComposerSlots & { rootClass?: string; sendIcon?: ReactNode } = {}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { draft, setDraft, send, isStreaming, mic, sttReady, uploadPending } = useComposer();
  // Attachments (D68 §7): ONE controller per composer — the rail renders its chips, the clip owns
  // the picker, and `dropProps` puts paste + drag-drop on the surfaces below. Same three lines in
  // every variant; only the PLACEMENT differs (the owner-ruled geometry, per layout).
  const attach = useAttachments();
  // A staged rail moves the clip + the expand toggle into the rail's TAIL (the S6 fix wave, F1/F2),
  // which changes the FIELD's rendered width — hence the same flag reaching the chrome hook below.
  const staged = attach.files.length > 0;
  // Shared presentational chrome (mic-press toggle, auto-grow + its expand ceiling, Enter-to-send) — §3.1.
  const { micPressed, pressMic, releaseMic, onKeyDown, expand } = useComposerChrome(
    taRef,
    draft,
    send,
    staged,
  );
  // Slash autocomplete (A2) — headless; its `onKeyDown` wraps the chrome's so the popover gets the arrow/
  // Enter/Tab/Esc keys first and everything else still sends.
  const suggest = useComposerSuggest({ draft, setDraft, onKeyDown });
  // The resolved composer skin picks the DEFAULT send glyph (glass → the arrowhead, the old Borderless glyph);
  // an explicit `sendIcon` prop still wins. Kit components may import BOTH the store and the registry-backed
  // resolver — only store→registry is the forbidden cycle. (§14.16)
  const theme = useUISlice((s) => s.theme);
  const skin = useComposerSkin(theme);

  return (
    <>
      {/* `overlay` slot — a positioned sibling ABOVE `.kit-composer` (e.g. the plan sheet). Rendered before
          the bar so, at equal stacking, the composer paints over the overlay's tucked bottom edge. */}
      {overlay}
      <SuggestPopover suggest={suggest} />
      <div
        className={"kit-composer stacked" + (rootClass ? " " + rootClass : "")}
        id="composer"
        onDragOver={attach.dropProps.onDragOver}
        onDrop={attach.dropProps.onDrop}
      >
        {/* THE RAIL — above `.field` (grammar ②): the bar grows upward exactly as it does for a
            second line of text, and `--composer-h` picks it up because it is a child of the root.
            It carries the CONTROL TAIL (the clip + the expand toggle) whenever it is up — see
            AttachRail for the two owner findings that put them there. */}
        <AttachRail attach={attach} expand={expand} />
        <div className="field">
          <textarea
            ref={taRef}
            id="cmd-input"
            rows={1}
            onPaste={attach.dropProps.onPaste}
            // The theme's `placeholder` slot wins when it fills it; omitted → the Kit's own greeting,
            // byte-identical to what every theme but gacha renders.
            placeholder={placeholder ?? "How can I help you today?"}
            value={draft}
            onChange={(e) => suggest.onDraftChange(e.target.value)}
            onKeyDown={suggest.onKeyDown}
            onFocus={suggest.onFocus}
            onBlur={suggest.onBlur}
            {...suggest.aria}
          />
          {/* THE EXPAND TOGGLE — the field's top-right (R62 §5's convergent placement). `.field` here
              holds nothing but the textarea, so the corner is its own; the textarea gains a matching
              lead-out in kit.css so no line of text runs under the button. WHILE NOTHING IS STAGED
              only (S6/F2): with a rail up, the composer's top-right corner is the rail's, and the
              toggle lives in its tail instead — one instance, never two. */}
          {!staged && <ExpandToggle expand={expand} />}
        </div>
        <div className="crow">
          {/* `controlsStart` slot — opens the controls row (left of mic/send), e.g. the plan pill. */}
          {controlsStart}
          <span className="grow" />
          {/* THE CLIP — in the controls row, immediately LEFT of the mic (owner-ruled placement), and
              WHILE NOTHING IS STAGED only (S6/F1: with a rail up the clip rides its tail, so it never
              costs the row width beside the mic/send pair). The hidden picker travels with it. */}
          {!staged && <AttachClip attach={attach} />}
          {sttReady && (
            <button
              type="button"
              className={
                "kit-cbtn mic" +
                (mic.status === "recording" ? " rec" : "") +
                (mic.status === "sending" ? " sending" : "") +
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
              {mic.status === "sending" ? (
                <SpinnerIcon size={16} />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
                </svg>
              )}
            </button>
          )}
          {/* While a turn streams the send button becomes a Stop control (D39) — same swap as the
              vapor composer; `stopTurn` guards double-taps. Not disabled: Stop IS the streaming
              affordance. */}
          <button
            type="button"
            className={"kit-send" + (isStreaming ? " stop" : "")}
            id="cmd-send"
            aria-label={isStreaming ? "stop the running turn" : "send message"}
            title={isStreaming ? "stop the running turn" : "send message"}
            // HELD while a staged file is still uploading (D68 §7, the R61 field convention) — never
            // while streaming, where this button is Stop and must stay live.
            disabled={!isStreaming && uploadPending}
            onClick={isStreaming ? stopTurn : send}
          >
            {isStreaming ? (
              /* 20, not the idle arrow's 16: the stop square paints ~48% of the 34px button — vapor's
                 stop-to-button ratio (owner device round, v1.3.1: 16 read too small). */
              <StopSquareIcon size={20} />
            ) : (
              (sendIcon ??
              (skin === "glass" ? (
                <SendArrowheadIcon size={20} />
              ) : (
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
              )))
            )}
          </button>
        </div>
      </div>
    </>
  );
}
