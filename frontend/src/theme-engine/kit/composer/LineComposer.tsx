import { useRef, useState } from "react";

import { useAttachments } from "../../../hooks/useAttachments";
import { useComposer } from "../../../hooks/useComposer";
import { useComposerSuggest } from "../../../hooks/useComposerSuggest";
import { stopTurn } from "../../../store/chat";
import { AttachClip, AttachRail } from "./AttachRail";
import { ExpandToggle } from "./ExpandToggle";
import { MicIcon, SendArrowheadIcon, SpinnerIcon, StopSquareIcon } from "./icons";
import { SuggestPopover } from "./SuggestPopover";
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
//   • AUTO-GROW — the shared 96px ceiling from `useComposerChrome`; no new knob. Since D68 S5 that hook
//     carries a SECOND ceiling (half the viewport) behind the EXPAND toggle, which this layout is the
//     primary beneficiary of ("the line composer has very little space" — owner). Still no local knob:
//     the affordance is the shared chrome's, like the ceiling it moves.
//   • ATTACH — PRESENT since D68 S3 (this supersedes the original "ABSENT" ruling): the quiet clip sits in
//     the trailing cluster, LEFT of the mic, and the staged THUMBNAIL RAIL rides above the pill's row. It is
//     NOT capability-gated (unlike the mic): there is no "attachments configured" fact to gate on.
//   • THE ROW IS ITS OWN ELEMENT since the D68 S5 fix wave (MED-1) — `.line-row`, holding exactly what the
//     single row always held. The bar's other occupants (the rail, its refusal lines) are ordinary block
//     siblings ABOVE it, which is what S3's `flex-wrap` + `order:-1` reordering was faking.
//   • GEOMETRY — a FLOATING ROUNDED-SQUARE PILL: inherits the base `.kit-composer` float (inset ~90% width,
//     frost/border/shadow — "not baked into the window"), reshaped to `border-radius:24px`, a compact single
//     row; the pill + mic/send ride the BOTTOM (`align-items:flex-end`) while the field's extra lines stack
//     UPWARD as it grows. Collapsed it reads as a stadium (24px ≈ half the ~46px bar); grown, the 36px round
//     button (r18, inset 6px) nests concentrically in the 24px corner (r18+6=24), no chord-clip (owner round
//     6, supersedes the old vertical-center stadium). The emoji icon is DROPPED (we don't model emoji).
// The root KEEPS the `.kit-composer` class (edge #5) so DefaultRoot's `querySelector(".kit-composer")`
// --composer-h measurement still finds it; `.line` adds the stadium styling in kit.css.
export function LineComposer({ controlsStart, overlay, placeholder }: ComposerSlots = {}) {
  const { draft, setDraft, send, isStreaming, mic, sttReady, sendable, uploadPending } =
    useComposer();
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Attachments (D68 §7) — the shared controller; see KitComposer for the contract.
  const attach = useAttachments();
  // A staged rail moves the clip + the toggle into the rail's TAIL (S6 fix wave, F1/F2) — the flag
  // also tells the chrome hook the field's rendered width just changed (the clip leaves its row).
  const staged = attach.files.length > 0;
  // THE CONTROL STACK's state (decided below, after the measurement it reads) — declared first
  // because the chrome hook's width key carries it.
  const [stacked, setStacked] = useState(false);
  const { micPressed, pressMic, releaseMic, onKeyDown, expand, fieldPx, fieldCeilPx } =
    useComposerChrome(
      taRef,
      draft,
      send,
      // The field's width follows BOTH facts (the hook's `fieldWidthKey`): staging moves the clip +
      // toggle to the rail, and the stack frees or reclaims a whole button lane. Flipping either
      // re-measures at once, so the height and the painted-px are never stale (re-round MED-1).
      `${staged}|${stacked}`,
    );
  // Slash autocomplete (A2) — same wiring in every variant; see KitComposer.
  const suggest = useComposerSuggest({ draft, setDraft, onKeyDown });

  // The trailing controls (owner eyeball 2026-07-11, revising the original full-morph): the MIC is visible
  // whenever dictation is configured — it must never vanish just because text exists — and SEND joins it (to
  // its right) once there's something to send. Empty draft + STT → mic only (the compact resting look);
  // typing/dictating slides send in beside the mic; no STT → always send alone.
  const showMic = sttReady;
  // `isStreaming` keeps the button mounted as the Stop control (D39, Slice-3 audit MED-1): `send()`
  // clears the draft, so without it the STT+empty-draft resting state would hide Stop exactly while
  // a turn runs — the one moment it must exist.
  //
  // `sendable` (not `draft !== ""`) since D68 S3: a staged file with NO caption is a legal send
  // (§7), and the button that sends it has to exist. It reads the draft too, so the pre-attachment
  // behaviour is unchanged when nothing is staged.
  const showSend = !sttReady || sendable || isStreaming;

  // THE CONTROL STACK (the owner's S6 re-round, 2026-09-03): once the field is TALL enough, the
  // trailing controls turn vertical — mic over send, "same distance and everything" — and the text
  // gets the freed lane back. "Only when there's space" (owner) is the whole rule, and the honest
  // currency for "space" is the PAINTED field height the chrome hook just wrote — never the rendered
  // line count, which lies whenever the ceiling binds (a 20-line draft still paints 96px at rest —
  // the re-round review's MED-2, conf 1.00). Consequences that fall out for free:
  //   · the PAIR (mic+send, 78px) fits under the 96px resting ceiling, so it stacks from ~3 lines
  //     (77.25px painted — the 1px grace below accepts the sub-pixel, the pill grows ≤0.75px);
  //   · the TRIO (the no-rail case adds the 28px toggle: 112px) does NOT fit a resting field at all —
  //     it engages only while the owner has EXPANDED, where the painted height can actually cover it;
  //   · the sum counts what actually RENDERS (re-round MED-3): no STT → no mic lane in the arithmetic.
  // THE MEMORY (re-round MED-1): stacking frees ~42px of width, the text re-wraps, and the freshly
  // re-measured painted-px can fall back under the entry bar — a strict predicate would flip per
  // keystroke at the boundary. So entry is strict (fits, within the 1px grace) while exit gives ONE
  // LINE of hysteresis, the exact amount a lane's width is worth — GUARDED by the ceiling: the band
  // exists to absorb the stack's own re-wrap, never to hold a column the CURRENT ceiling cannot
  // paint, so collapsing the expand mode (or the column's needs growing past the ceiling) lets go
  // on the next measurement regardless of the band. Written as the React adjust-state-during-render
  // idiom (never an effect: that is the cascading-render idiom eslint rightly flags — and a ref
  // would not re-render, so the hook's width key would lag a render and the flip's own re-measure
  // would never fire; stale-measurement renders resolve themselves one measure later by the same
  // rule).
  const GAP = 6; // the row's own gap — "same distance and everything" (owner)
  const stackNeeds =
    [!staged && 28, showMic && 36, showSend && 36]
      .filter((h): h is number => h !== false)
      .reduce((sum, h, at) => sum + h + (at > 0 ? GAP : 0), 0) || Number.MAX_SAFE_INTEGER; // an empty column never stacks
  const fits = fieldPx >= stackNeeds - 1; // the strict entry test (1px grace: 77.25 vs 78)
  const holds = fieldPx >= stackNeeds - 23 && fieldCeilPx >= stackNeeds - 1;
  const nextStacked = stacked ? holds : fits;
  if (nextStacked !== stacked) setStacked(nextStacked);

  return (
    <>
      {/* `overlay` slot — a positioned sibling ABOVE `.kit-composer` (e.g. the plan sheet). Rendered before
          the bar so, at equal stacking, the floating composer paints over the overlay's tucked bottom edge. */}
      {overlay}
      <SuggestPopover suggest={suggest} />
      <div
        className="kit-composer line"
        id="composer"
        onDragOver={attach.dropProps.onDragOver}
        onDrop={attach.dropProps.onDrop}
      >
        {/* THE RAIL — above the pill's row (the ruled placement for this layout), now as an ordinary
            block sibling: `.line-row` below is the flex container, so the rail and the refusal lines
            under it simply stack above it and the pill grows UPWARD exactly as multi-line text already
            makes it grow. (S3 faked this with `flex-wrap` + `order:-1` on the root while the root WAS
            the row — which left the absolutely-positioned expand toggle pinned to the root's top-right,
            i.e. on top of the rail. The wrapper removes the reordering instead of patching the toggle.)
            Since S6 the rail also CARRIES the clip + the toggle in its tail while it is up (F1/F2):
            the row's top-right corner is no longer the composer's when a rail sits above it. */}
        <AttachRail attach={attach} expand={expand} />
        {/* THE FIELD ROW — exactly what the single row always held (the plan-pill lane · the field · the
            trailing cluster), with the owner-eyeballed flex geometry (`align-items:flex-end` + the 6px
            gaps) moved onto it from the root VERBATIM. Its reason to exist is the toggle below: an
            element to be the row's own positioning context. */}
        <div className="line-row">
          {/* `controlsStart` slot — the in-row plan pill FLUSH at the leading edge (owner eyeball: mirror how
              the mic/send hug the trailing edge; this IS A4's `planPill: inline` semantics; with `pinned` the
              slot is empty → `.line-controls:empty` collapses the wrapper, the same trick the sheet uses). */}
          {controlsStart && <div className="line-controls">{controlsStart}</div>}
          <textarea
            ref={taRef}
            id="cmd-input"
            rows={1}
            // "Message" — the reference's own copy: the compact single-row bar wants a SHORT placeholder (a
            // deliberate delta from the Kit's long "How can I help you today?"). A theme that fills the
            // `placeholder` slot overrides it; omitted → exactly this string, as before.
            placeholder={placeholder ?? "Message"}
            value={draft}
            onChange={(e) => suggest.onDraftChange(e.target.value)}
            onKeyDown={suggest.onKeyDown}
            onFocus={suggest.onFocus}
            onBlur={suggest.onBlur}
            onPaste={attach.dropProps.onPaste}
            {...suggest.aria}
          />
          {/* THE EXPAND TOGGLE — the field's top-right (R62 §5). This layout has no `.field` wrapper (the
              ROW is the field), so it hangs off `.line-row` and is absolutely positioned into THAT box's
              top-right corner — which the `flex-end` row leaves empty, since the mic/send ride the bottom.
              Anchoring it to the row rather than the root is the MED-1 fix: the root also holds the rail,
              and its top-right corner is the RAIL's corner whenever a file is staged. WHILE NOTHING IS
              STAGED only (S6/F2) — that RAIL's corner is precisely where the owner wants the control
              once there is one, so with a rail up the tail renders it and this does not. */}
          {/* THE CLIP — trailing of the field, LEFT of the mic/send cluster (the ruled placement, and
              the spot the A8 placeholder comment always marked). Ungated: it is chrome, not a
              capability — but WHILE NOTHING IS STAGED only (S6/F1): this row has the least width in
              the app, and with a rail up the tail is a better home for the clip than the field is.
              It stays a ROW child, outside the stack below — the owner's stack is the action pair
              (+ the toggle), and a four-deep column would push the threshold past six lines. */}
          {!staged && <AttachClip attach={attach} size={18} />}
          {/* THE TRAILING CLUSTER — one wrapper, two shapes (the S6 re-round). Horizontal it is
              invisible: an unpositioned flex row with the row's own 6px gap, so the mic/send pair
              lays out exactly as it did as bare row children — and the expand toggle, rendered
              INSIDE it, still absolutely positions against `.line-row` (the nearest positioned
              ancestor; the cluster deliberately is not one). Stacked (`.stack`, ≥3/≥5 rendered
              lines per the arithmetic above) it turns into a bottom-anchored COLUMN — mic over
              send, the toggle in-flow on top exactly as the rail tail carries it. */}
          <div className={"line-cluster" + (stacked ? " stack" : "")}>
            {/* THE EXPAND TOGGLE — the field's top-right (R62 §5). This layout has no `.field`
                wrapper (the ROW is the field), so it hangs off `.line-row`'s top-right corner —
                which the `flex-end` row leaves empty — until the stack claims it in-flow. WHILE
                NOTHING IS STAGED only (S6/F2): with a rail up the tail renders it and this does
                not. */}
            {!staged && <ExpandToggle expand={expand} />}
            {showMic && (
              <button
                type="button"
                className={
                  "kit-cbtn mic line-btn" +
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
                {mic.status === "sending" ? <SpinnerIcon size={22} /> : <MicIcon size={22} />}
              </button>
            )}
            {showSend && (
              <button
                type="button"
                className={"kit-send line-btn" + (isStreaming ? " stop" : "")}
                id="cmd-send"
                aria-label={isStreaming ? "stop the running turn" : "send message"}
                title={isStreaming ? "stop the running turn" : "send message"}
                disabled={!isStreaming && uploadPending} // held while a file uploads (D68 §7)
                onClick={isStreaming ? stopTurn : send}
              >
                {/* Streaming → the Stop square (D39, same swap as every composer). Idle → the SHARED
                  arrowhead glyph — optically re-centered via the `.kit-send.line-btn svg` nudge in
                  kit.css (the glyph's mass leans up-right, vapor's fix). */}
                {/* Stop at 20 (not the arrowhead's 20-for-16 split): ~48% of the 36px circle — vapor's
                  stop-to-button ratio (owner device round, v1.3.1). */}
                {isStreaming ? <StopSquareIcon size={20} /> : <SendArrowheadIcon size={20} />}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
