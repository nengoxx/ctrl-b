import { useRef } from "react";

import { useComposer } from "../../../hooks/useComposer";
import { useComposerSuggest } from "../../../hooks/useComposerSuggest";
import { stopTurn } from "../../../store/chat";
import { MicIcon, SendArrowheadIcon, SpinnerIcon, StopSquareIcon } from "./icons";
import { SuggestPopover } from "./SuggestPopover";
import type { ComposerSlots } from "./types";
import { MIC_LABEL, useComposerChrome } from "./useComposerChrome";

// The DOCKED "sheet" composer variant (D30/D31, COMPOSER_SURFACE_PLAN §3.2) — vapor's inline rounded-dock
// look, rebuilt in the Kit's SEMANTIC tokens (never vapor's `--magenta`/`--ink`/`--bg-2`): full-width bar
// anchored to the screen bottom with a rounded top, an embedded borderless accent mic inside the field, and
// a tall full-height send block beside it. Same BEHAVIOUR as every variant — it reuses the headless
// `useComposer()` controller (never re-implements composer logic) plus the shared `useComposerChrome()`
// presentational hook, and honours the SAME `ComposerSlots` placement contract as KitComposer (§15):
//   • `overlay`        — a positioned SIBLING rendered BEFORE the bar, so the composer's rounded top tucks
//                        the overlay's bottom edge (the plan sheet; edges #7/#15).
//   • `controlsStart`  — EMBEDDED at the field's leading edge, inside the input surface (the plan pill),
//                        mirroring the embedded mic at the trailing edge; rendered only when populated.
// The root KEEPS the `.kit-composer` class (edge #5) so DefaultRoot's `querySelector(".kit-composer")`
// --composer-h measurement still finds it; `.sheet` adds the docked styling in kit.css.
export function SheetComposer({ controlsStart, overlay, placeholder }: ComposerSlots = {}) {
  const { draft, setDraft, send, isStreaming, mic, sttReady } = useComposer();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { micPressed, pressMic, releaseMic, onKeyDown } = useComposerChrome(taRef, draft, send);
  // Slash autocomplete (A2) — same wiring in every variant; see KitComposer.
  const suggest = useComposerSuggest({ draft, setDraft, onKeyDown });

  return (
    <>
      {/* `overlay` slot — a positioned sibling ABOVE `.kit-composer` (e.g. the plan sheet). Rendered before
          the bar so, at equal stacking, the docked composer paints over the overlay's tucked bottom edge. */}
      {overlay}
      <SuggestPopover suggest={suggest} />
      <div className="kit-composer sheet" id="composer">
        <div className="sheet-row">
          <div className="field">
            {/* `controlsStart` slot — EMBEDDED at the field's leading edge, INSIDE the input surface
                (owner eyeball 2026-07-11: same background as the text input, mirroring the embedded mic on
                the trailing edge; matches A4's `planPill: inline` semantics). Wrapped ONLY when populated;
                the pill may itself render null, which `.sheet-controls:empty { display:none }` collapses. */}
            {controlsStart && <div className="sheet-controls">{controlsStart}</div>}
            <textarea
              ref={taRef}
              id="cmd-input"
              rows={1}
              // "Message" — the LineComposer's copy, same rationale (owner eyeball r5): this field is a
              // SINGLE-LINE row, and the long stacked-composer greeting wraps below the fold (it had to be
              // scrolled to read). A one-line bar wants a short placeholder. A theme that fills the
              // `placeholder` slot overrides it; omitted → exactly this string, as before.
              placeholder={placeholder ?? "Message"}
              value={draft}
              onChange={(e) => suggest.onDraftChange(e.target.value)}
              onKeyDown={suggest.onKeyDown}
              onFocus={suggest.onFocus}
              onBlur={suggest.onBlur}
              {...suggest.aria}
            />
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
                {/* vapor's stroke mic glyph at vapor's proportion (~26px in the 40px hit target) — owner
                    eyeball 2026-07-11: the docked variant keeps vapor's icon language, theme-colored.
                    Graduated to the shared `MicIcon` at its second consumer (Phase E's LineComposer). */}
                {mic.status === "sending" ? <SpinnerIcon size={26} /> : <MicIcon size={26} />}
              </button>
            )}
          </div>
          {/* Send — vapor-look paper-plane (§3.3), not KitComposer's arrow. Tall block beside the field. */}
          <button
            type="button"
            className={"kit-send tall" + (isStreaming ? " stop" : "")}
            id="cmd-send"
            aria-label={isStreaming ? "stop the running turn" : "send message"}
            title={isStreaming ? "stop the running turn" : "send message"}
            onClick={isStreaming ? stopTurn : send}
          >
            {/* Streaming → the Stop square (D39, same swap as every composer). Idle → the SHARED
                arrowhead glyph (owner pick, icon showcase 2026-07-11) — stroke language matches
                the mic; 24px matches vapor's send proportion. Optically re-centered via the
                `.kit-send.tall svg` nudge in kit.css (the glyph's mass leans up-right, vapor's fix). */}
            {/* Stop at 24 — vapor's dock paints its stop 24px in a 50px block; the tall send is the
                same geometry (owner device round, v1.3.1: 20 read too small). */}
            {isStreaming ? <StopSquareIcon size={24} /> : <SendArrowheadIcon size={24} />}
          </button>
        </div>
      </div>
    </>
  );
}
