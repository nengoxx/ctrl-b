import { useEffect, useId, useRef } from "react";

import { FocalImg } from "../../components/FocalImg";
import { useActiveBackdrop } from "../../hooks/useActiveBackdrop";
import { useFocalAnchor } from "../../hooks/useFocalPosition";
import { useLiveCall, type CallPhase } from "../../hooks/useLiveCall";
import { useVoiceStatus } from "../../hooks/useVoiceStatus";
import { modalKeyDown } from "../../lib/focusTrap";
import { confirmAwaiting, resumeCall, useChatSlice } from "../../store/chat";
import { startCall } from "../../store/liveCall";

// THE CALL SCREEN (Phase 24 / D71 §6) — the agent's art full-bleed, the call's state on a ring over the
// face, what the ear heard you say, and the furniture: mute, hang up, the Allow/Deny row a confirm gate
// needs, and the terminal faces. The machine lives inside this component, so MOUNTING is starting a call
// and UNMOUNTING is the whole teardown; there is no third place a call can be.
//
// THE BACKDROP NEVER GOES AWAY (owner ruling): `useActiveBackdrop` ALONE — the active agent's bound
// background, its avatar standing in, else the plain theme surface. A call with Lynette looks like HER.
// Gacha's oracle art deliberately does NOT participate: the call wears agent identity, not fleet
// flavour. The paint is the shipped recipe (`FocalImg` + `.kit-backdrop-art`'s cover + a separate veil),
// not a new one — text-over-art legibility is the three-state-backdrop lesson (§8.3a), not an invention.
//
// TWO MODES, ONE INDICATOR (`voice.live.ring`, §6):
//   · RING — a drawn CIRCUMFERENCE over the art, nothing masked or cropped, FOCAL-ANCHORED: centred on
//     where the backdrop's own framing point lands on screen, so the halo sits over the face at any
//     viewport and for any picture. No point (or no art at all) → the fallback anchor, centred and upper
//     third, which CSS owns. The call's state animates the STROKE.
//   · NO RING — the pure art, and the state rides the transcript line's accent instead.
// The phase line's dot is gone from BOTH: whichever indicator is live is the only one, because two
// things saying the same thing is how one of them goes stale.
//
// TAP TO INTERRUPT (§4.3 trigger B): during `speaking`, a tap anywhere outside the control cluster fires
// the same ordered kill voice barge-in does — and it is the only interrupt a browser without subtractive
// echo cancellation has. Outside `speaking` overlay taps are INERT: during `thinking` you steer by just
// talking, and nothing may cancel by accident.
//
// THE BACK GESTURE (§6) rides `useOverlayBackGuard`, the same guard every other overlay uses — mounted
// one level up, in `DefaultRoot`, because the history entry belongs to the CALL and a redial remounts
// this component underneath it (the shell's comment has the measured reason). `close` arrives as a prop
// and is the ONE exit primitive this component calls: the hang-up button and Escape both go through it,
// so exactly one entry exists per call and exactly one is spent leaving — and the phone's Back gesture
// takes the same path, ending the call instead of navigating the app out from under it.

/** What the phase line says. Plain language — this is the owner's screen, not a state dump. */
function phaseLabel(phase: CallPhase, speaking: boolean, muted: boolean): string {
  switch (phase) {
    case "connecting":
      return "Connecting…";
    case "listening":
      // MUTED outranks the listening copy, because it is the one state where the screen would otherwise
      // promise something untrue: nothing said now is heard, and the line has to say so.
      if (muted) return "Muted";
      return speaking ? "Listening" : "Listening — go ahead";
    case "thinking":
      return "Thinking…";
    case "speaking":
      return "Speaking — tap to interrupt";
    case "error":
      return "Call ended";
    case "ended":
      return "Call ended";
  }
}

export function CallOverlay({ close }: { close: () => boolean }) {
  const art = useActiveBackdrop();
  const call = useLiveCall();
  // The §6 mode knob. Absent knobs mean the call cannot start at all (the machine fails it with
  // "not configured"), so this default only ever dresses that terminal face — and it is the `LiveCfg`
  // field default, which is the one answer this surface is allowed to assume.
  const ringMode = useVoiceStatus().data?.live_call?.ring ?? true;
  // WHAT is waiting for an Allow/Deny (§4.5). Reference-stable by the selector's contract, so this
  // subscription costs one render per change of gate and none per streamed part.
  const awaiting = useChatSlice(() => confirmAwaiting());
  const labelId = useId();
  const terminal = call.phase === "error" || call.phase === "ended";
  const panelRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const hangUpRef = useRef<HTMLButtonElement>(null);

  // THE RING'S ANCHOR, in the overlay's OWN coordinates (delta round F9). `.kit-call-art` is
  // `inset: 0` inside a fixed, inset-0 overlay, so the art's box IS the ring's coordinate space and no
  // window or visual-viewport offset can enter the calculation — which is precisely what Android's
  // URL-bar and keyboard transitions would otherwise break. One `ResizeObserver`, the shared one.
  const anchor = useFocalAnchor(artRef, art?.focus);

  // `aria-modal` is a PROMISE about focus, and it was one this overlay could not keep: focus stayed on
  // the composer it covers, so Tab walked an app the screen reader had already been told was hidden.
  // The trap is the one the modals already share (`lib/focusTrap`) — nothing new, and ESCAPE takes the
  // same exit the Back gesture does, deliberately: there is nothing here to dismiss without ending the
  // call.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    hangUpRef.current?.focus();
    return () => {
      // The element we took focus from can be gone by now (the composer re-renders under the overlay).
      if (prev?.isConnected) prev.focus();
      else (document.activeElement as HTMLElement | null)?.blur();
    };
  }, []);

  // The whole surface is trigger B; the cluster below stops the event so a hang-up — or an Allow — is
  // never also an interrupt. `pointerdown` rather than `click`: an interrupt should land on the touch,
  // not on the release, and there is no drag on this surface to disambiguate from. The "only during
  // `speaking`" rule is NOT re-stated here — `interrupt` is inert in every other phase by the machine's
  // own rule, and two copies of that rule is how one of them stops being true.
  const onSurface = (): void => call.interrupt();

  // The state classes the stylesheet animates off: the phase, plus the two orthogonal flags that are not
  // phases (§4.2). `muted` is last in the cascade for a reason — it must beat every pulse.
  const classes = [
    "kit-call",
    `ph-${call.phase}`,
    ringMode ? "ring" : "no-ring",
    call.userSpeechActive ? "speech" : "",
    call.muted ? "muted" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={panelRef}
      className={classes}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      onPointerDown={onSurface}
      onKeyDown={(e) => modalKeyDown(e, panelRef.current, close)}
    >
      {art !== undefined && (
        <div className="kit-call-art" ref={artRef} aria-hidden>
          <FocalImg
            className="kit-backdrop-art"
            art={art.focus}
            src={art.url}
            alt=""
            draggable={false}
          />
          <div className="kit-call-veil" />
        </div>
      )}
      {/* THE RING. JS places its CENTRE and nothing else; the diameter, the stroke and the fallback
          anchor are CSS custom properties on the block, because those are feel-round tuning knobs and
          this is the file that would otherwise collect magic numbers. An unanchorable picture (no
          framing point, a proportional bundled entry, no art at all) sets no inline position and the
          stylesheet's own centred/upper-third anchor stands. */}
      {ringMode && (
        <div
          className="kit-call-ring"
          aria-hidden
          style={anchor === null ? undefined : { left: `${anchor.x}px`, top: `${anchor.y}px` }}
        >
          <i className="kit-call-ring-stroke" />
        </div>
      )}
      <div className="kit-call-body">
        <p className="kit-call-phase" id={labelId}>
          {phaseLabel(call.phase, call.userSpeechActive, call.muted)}
        </p>
        {/* What the ear heard YOU say (§6) — so a mishearing is visible instantly. The `…` is the
            live-speech state: the ear has an open segment and no transcript for it yet. In NO-RING mode
            this line carries the state indicator too (the dot is `aria-hidden`, so the live region still
            announces only the words). */}
        <p className="kit-call-heard" aria-live="polite">
          {!ringMode && <span className="kit-call-dot" aria-hidden />}
          {call.userSpeechActive ? "…" : call.heard}
        </p>
        {call.note !== null && call.note !== "" && <p className="kit-call-note">{call.note}</p>}
        <div className="kit-call-cluster" onPointerDown={(e) => e.stopPropagation()}>
          {/* THE IN-OVERLAY CONFIRM (§4.5 · §6) — Allow and Deny ONLY, riding the SAME `resumeCall`
              chokepoint and the same single-use token as the chat card (the overlay never sees a
              token). "Always" and "edit" stay chat-card affordances: an always-grant deserves the
              thread's full context and an edit is keyboard territory, and the full card is still there
              after the call. */}
          {awaiting !== null && !terminal && (
            <div className="kit-call-confirm">
              <p className="kit-call-confirm-line">
                {awaiting.tool.replace(/_/g, " ")} — needs your OK
              </p>
              <div className="kit-call-confirm-actions">
                <button
                  type="button"
                  className="kit-call-allow"
                  onClick={() => void resumeCall(awaiting.callId, "execute")}
                >
                  Allow
                </button>
                <button
                  type="button"
                  className="kit-call-deny"
                  onClick={() => void resumeCall(awaiting.callId, "dismiss")}
                >
                  Deny
                </button>
              </div>
            </div>
          )}
          <div className="kit-call-controls">
            {/* MUTE (§6). The accessible name FLIPS rather than riding `aria-pressed` — the mic
                gesture's pattern, and the one screen readers announce as the action it is. */}
            {!terminal && (
              <button
                type="button"
                className="kit-call-mute"
                aria-label={call.muted ? "Unmute" : "Mute"}
                onClick={call.toggleMute}
              >
                {call.muted ? "Unmute" : "Mute"}
              </button>
            )}
            {/* TERMINAL FACES (§6): `error` and `ended` keep the overlay up with the note and two ways
                on — the same door a call starts from, and out. A user hang-up never reaches here: it
                closes instantly, with no terminal screen at all. */}
            {terminal && (
              <button type="button" className="kit-call-again" onClick={startCall}>
                Call again
              </button>
            )}
            <button
              ref={hangUpRef}
              type="button"
              className="kit-call-hangup"
              onClick={() => close()}
            >
              {terminal ? "Close" : "Hang up"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
