import { type CSSProperties } from "react";

import { MicIcon } from "./icons";
import type { MicChrome } from "./useMicGesture";

// THE MIC GESTURE'S CHROME (Phase 24 / S0.5 — LIVE_VOICE_PLAN §6): the enlarged record circle with its
// live level halo, the slide-to-cancel track, the lock/call rail, the standing "Start call" chip and the
// hint bubble. ONE component rendered by all three composer variants, mirroring the mic button's own
// three call sites — the affordance is the button's, so it lives beside it.
//
// THE LOCKED CANCEL IS NOT HERE ANY MORE (feel round OF-5, owner 2026-09-13): the floating `.mg-cancel`
// button is gone, and the tools/skills trigger at the controls row's LEADING edge morphs into the cancel
// instead (sliders → ✕). It is composed in DefaultRoot, so the gesture publishes the offer through
// `store/micCancel` — see `useMicGesture`'s locked effect. Nothing in this file is interactive except
// the call chip, which is call mode's own tap twin.
//
// ⚠ IT IS A POSITIONED SIBLING OF `.kit-composer`, NOT A CHILD — the ruled fallback, taken on MEASURED
// evidence (Chromium, 390×844, the real app at each variant): `.kit-composer.sheet` and
// `.kit-composer.line` both compute `overflow: hidden`, and a probe child extending 60px above or 30px
// right of the bar was NOT hit-testable in either (`document.elementFromPoint` returned the chat
// scroller behind it), while the stacked bar — `overflow: visible` — returned the probe. The record
// circle (`--mg-grow-scale`, owner-tuned, its level halo bulging past it) and the lock rail live outside the
// bar's box by construction, so a child would be sliced in two of the three layouts. The plan sheet's
// `overlay` slot is the precedent for the shape (a
// positioned sibling anchored over the composer); this mounts BESIDE that slot rather than inside it, so
// a theme filling `overlay` keeps it — they coexist at different z-indices (kit.css).
//
// EVERYTHING IS ANCHORED TO THE MEASURED MIC BUTTON, not to any layout's geometry: the host spans the
// whole `.kit-main` and the hook publishes the button's centre + diameter in the host's own coordinates
// (measured once, at the start of each gesture). That is what makes one component serve three layouts
// and four composer skins with no per-variant CSS.
//
// The host div is ALWAYS mounted (it has to exist to be measured); it paints nothing and takes no
// pointer events until a gesture is in flight. The call CHIP is the only thing in here that ever becomes
// interactive; the locked recording's tap twin is the morphed tools trigger. Between them they are the
// WCAG 2.5.1/2.5.7 conformance half of the design (R69 §8.2: every gesture affordance grows a tap twin
// the moment the hand is free).

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

/** The glyph the CALL rail's circle keeps once its label has faded (lucide `phone`). Call mode's twin of
 *  the padlock: the pill compresses the same way, and what is left has to say what it is. Ships dark with
 *  the rest of the call leg (`live` is never up before S1). */
function PhoneIcon({ size = 14 }: { size?: number }) {
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
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.8.8a2 2 0 0 1 1.7 2Z" />
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

/**
 * @param lifted the composer holds WRITTEN text (round 3): the slide-to-cancel track lifts above the
 *               bar instead of painting across a draft it would be unreadable over. Variant knowledge
 *               — only the variant sees the draft — so it arrives as a prop, not through the hook.
 */
export function MicGestureChrome({ chrome, lifted }: { chrome: MicChrome; lifted?: boolean }) {
  const { hostRef, stage, mode, anchor, cancel, lift, dragX, moved, showLockHint, hint } = chrome;
  const { onChipTap } = chrome;
  // A RECORDING is up in exactly two stages. `callArm`/`chip` are call mode, which records nothing.
  const recording = stage === "hold" || stage === "locked";
  const open = stage !== "idle" || hint !== null;

  // The anchor travels as CSS custom properties rather than as per-element inline geometry: one write,
  // and every rule in kit.css positions itself off the same two numbers.
  const vars = {
    "--mg-x": `${anchor.cx}px`,
    "--mg-y": `${anchor.cy}px`,
    "--mg-size": `${anchor.size || 36}px`,
    // Where the hint bubble's TAIL has to point, measured from the host's right edge (the bubble is
    // right-anchored). `--mg-level` is NOT here on purpose: it arrives at 10 Hz and is written straight
    // to this element by the gesture hook, never through a render.
    "--mg-rx": `${anchor.rx || 36}px`,
  } as CSSProperties;

  return (
    <div
      className={"mic-gesture" + (lifted ? " lifted" : "")}
      ref={hostRef}
      data-stage={stage}
      style={open ? vars : undefined}
    >
      {!open ? null : (
        <>
          {/* ① THE RAIL — the "slide up" affordance, present for the whole hold and following the
              finger up. Mic mode locks hands-free (latch on crossing); call mode commits on release,
              so its pill reads as the destination rather than as a latch.

              THE PILL IS COMPRESSED BY THE SWIPE (feel round OF-2; round 2 made it a TRUE STADIUM).
              THREE stacked layers in one box, each moving differently: the SKIN is a real box whose
              HEIGHT tracks `--mg-lift` under a full radius — straight sides, semicircular caps, the
              exact circle at full lift (the recorded §14.11 height exception; kit.css carries the
              justification) — while the GLYPH rides at the pill's top and settles into the circle's
              centre, and the TAIL (the chevron, and call mode's label) collapses and fades out on the
              way. The glyph and tail stay transform/opacity, and as SIBLINGS of the skin its squeeze
              never distorts them. */}
          {(stage === "hold" || stage === "callArm") && (
            <div
              className={"mg-rail" + (mode === "call" ? " call" : "") + (lift >= 1 ? " armed" : "")}
              style={{ "--mg-lift": lift } as CSSProperties}
              aria-hidden
            >
              <span className="mg-rail-skin" />
              <span className="mg-rail-glyph">
                {mode === "call" ? <PhoneIcon size={14} /> : <LockIcon size={14} />}
              </span>
              <span className="mg-rail-tail">
                {mode === "call" && <span className="mg-rail-label">call</span>}
                <ChevronUpIcon size={12} />
              </span>
            </div>
          )}

          {/* ② THE TRACK — "slide to cancel" while the hand is on the button. The moment the hand is
              free the tap twin takes over (R69 §1.8), and since OF-5 that twin is the MORPHED TOOLS
              TRIGGER rather than anything rendered here. Only mic mode has anything to cancel. */}
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

          {/* ③ THE RECORD CIRCLE — the grown affordance. THREE boxes on purpose, one transform each:
              the outer one carries the DRAG (translate + the shrink toward cancel, both live values),
              `.mg-grow` runs the grow keyframe, and `.mg-halo` carries the live VOICE LEVEL — so the
              finger's travel, the entry animation and a 10 Hz meter never fight over one `transform`.
              The halo is the FIRST child so it paints under the disc. */}
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
              <span className="mg-halo" />
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

          {/* ⑤ THE HINT BUBBLE — the budgeted lock teaching (≤3 shows, retired on the first lock), the
              transient mode hint a tap raises, and (feel round OF-4) the too-short teaching that used to
              be a toast: everything the gesture has to SAY, said in one small tailed bubble right above
              the button it is about. `role="status"` is the web equivalent of Telegram's re-fired focus
              event: the mode change is announced, not only drawn (R69 §8.3). */}
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
