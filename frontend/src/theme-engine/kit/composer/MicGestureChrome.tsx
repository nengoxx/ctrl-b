import { type CSSProperties } from "react";

import { MicIcon } from "./icons";
import type { MicChrome } from "./useMicGesture";

// THE MIC GESTURE'S CHROME (Phase 24 / S0.5 — LIVE_VOICE_PLAN §6): the enlarged record circle, the
// slide-to-cancel track, the lock/call pill, the locked-mode CANCEL button, the standing "Start call"
// chip and the two hints. ONE component rendered by all three composer variants, mirroring the mic
// button's own three call sites — the affordance is the button's, so it lives beside it.
//
// ⚠ IT IS A POSITIONED SIBLING OF `.kit-composer`, NOT A CHILD — the ruled fallback, taken on MEASURED
// evidence (Chromium, 390×844, the real app at each variant): `.kit-composer.sheet` and
// `.kit-composer.line` both compute `overflow: hidden`, and a probe child extending 60px above or 30px
// right of the bar was NOT hit-testable in either (`document.elementFromPoint` returned the chat
// scroller behind it), while the stacked bar — `overflow: visible` — returned the probe. The 2.2× record
// circle and the lock rail both live outside the bar's box by construction, so a child would be sliced
// in two of the three layouts. The plan sheet's `overlay` slot is the precedent for the shape (a
// positioned sibling anchored over the composer); this mounts BESIDE that slot rather than inside it, so
// a theme filling `overlay` keeps it — they coexist at different z-indices (kit.css).
//
// EVERYTHING IS ANCHORED TO THE MEASURED MIC BUTTON, not to any layout's geometry: the host spans the
// whole `.kit-main` and the hook publishes the button's centre + diameter in the host's own coordinates
// (measured once, at the start of each gesture). That is what makes one component serve three layouts
// and four composer skins with no per-variant CSS.
//
// The host div is ALWAYS mounted (it has to exist to be measured); it paints nothing and takes no
// pointer events until a gesture is in flight. Only the two TAP TWINS — the CANCEL button and the call
// chip — ever become interactive, which is the WCAG 2.5.1/2.5.7 conformance half of the design (R69
// §8.2: every gesture affordance grows a tap twin the moment the hand is free).

/** The chevron the slide-to-cancel hint leads with — hand-inlined geometry, like every icon in the kit
 *  (lucide is not a dependency). */
function ChevronLeftIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

/** The lock glyph on the rail's pill — a padlock in mic mode; call mode swaps the whole pill's copy. */
function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="10" width="16" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function ChevronUpIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

export function MicGestureChrome({ chrome }: { chrome: MicChrome }) {
  const { hostRef, stage, mode, anchor, cancel, lift, dragX, moved, showLockHint, hint } = chrome;
  const { onCancelTap, onChipTap } = chrome;
  // A RECORDING is up in exactly two stages. `callArm`/`chip` are call mode, which records nothing.
  const recording = stage === "hold" || stage === "locked";
  const open = stage !== "idle" || hint !== null;

  // The anchor travels as CSS custom properties rather than as per-element inline geometry: one write,
  // and every rule in kit.css positions itself off the same two numbers.
  const vars = {
    "--mg-x": `${anchor.cx}px`,
    "--mg-y": `${anchor.cy}px`,
    "--mg-size": `${anchor.size || 36}px`,
  } as CSSProperties;

  return (
    <div className="mic-gesture" ref={hostRef} data-stage={stage} style={open ? vars : undefined}>
      {!open ? null : (
        <>
          {/* ① THE RAIL — the "slide up" affordance, present for the whole hold and following the
              finger up. Mic mode locks hands-free (latch on crossing); call mode commits on release,
              so its pill reads as the destination rather than as a latch. */}
          {(stage === "hold" || stage === "callArm") && (
            <div
              className={"mg-rail" + (lift >= 1 ? " armed" : "")}
              style={{ "--mg-lift": lift } as CSSProperties}
              aria-hidden
            >
              {mode === "call" ? (
                <span className="mg-rail-label">call</span>
              ) : (
                <LockIcon size={14} />
              )}
              <ChevronUpIcon size={12} />
            </div>
          )}

          {/* ② THE TRACK — "slide to cancel" while the hand is on the button; the real CANCEL BUTTON
              the moment it is free (R69 §1.8: every gesture affordance grows a tap twin). Only mic mode
              has anything to cancel. */}
          {stage === "hold" && (
            <div
              className={"mg-track" + (moved ? " moved" : "")}
              style={{ "--mg-cancel": cancel } as CSSProperties}
              aria-hidden
            >
              <span className="mg-chev">
                <ChevronLeftIcon size={14} />
              </span>
              <span>slide to cancel</span>
            </div>
          )}
          {stage === "locked" && (
            <button type="button" className="mg-cancel" onClick={onCancelTap}>
              cancel
            </button>
          )}

          {/* ③ THE RECORD CIRCLE — the grown affordance. Two nested boxes on purpose: the outer one
              carries the DRAG (translate + the shrink toward cancel, both live values), the inner one
              runs the grow keyframe, so the finger's travel never fights the animation for the
              `transform` property. */}
          {recording && (
            <div
              className="mg-circle"
              style={{
                // The outer box's two live values: the finger's travel, and Telegram's shrink toward
                // cancel (R69 §1.3 — `slideToCancelScale = 0.7 + progress * 0.3`, stated forward).
                transform: `translateX(${dragX}px) scale(${1 - cancel * 0.3})`,
              }}
              aria-hidden
            >
              <span className="mg-grow">
                <MicIcon size={20} />
              </span>
            </div>
          )}

          {/* ④ THE STANDING CALL CHIP — the single-pointer, non-dragging alternative WCAG 2.5.1 demands
              for a path-based commit; it stands ~2 s after a call-mode release without the swipe. */}
          {stage === "chip" && (
            <button type="button" className="mg-chip" onClick={onChipTap}>
              Start call
            </button>
          )}

          {/* ⑤ THE HINTS — the budgeted lock teaching (≤3 shows, retired on the first lock) and the
              transient mode hint a tap raises. `role="status"` is the web equivalent of Telegram's
              re-fired focus event: the mode change is announced, not only drawn (R69 §8.3). */}
          {(showLockHint || hint !== null) && (
            <p className="mg-hint" role="status">
              {hint ?? (mode === "call" ? "slide up to call" : "slide up to lock")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
