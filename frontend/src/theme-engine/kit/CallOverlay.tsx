import { useId } from "react";

import { FocalImg } from "../../components/FocalImg";
import { useActiveBackdrop } from "../../hooks/useActiveBackdrop";
import { useLiveCall, type CallPhase } from "../../hooks/useLiveCall";

// THE CALL SCREEN (Phase 24 / D71 §6) — minimal v1: the agent's art full-bleed, the call's state, what
// the ear heard you say, and hang up. The machine lives inside this component, so MOUNTING is starting a
// call and UNMOUNTING is the whole teardown; there is no third place a call can be.
//
// THE BACKDROP NEVER GOES AWAY (owner ruling): `useActiveBackdrop` ALONE — the active agent's bound
// background, its avatar standing in, else the plain theme surface. A call with Lynette looks like HER.
// Gacha's oracle art deliberately does NOT participate: the call wears agent identity, not fleet
// flavour. The paint is the shipped recipe (`FocalImg` + `.kit-backdrop-art`'s cover + a separate veil),
// not a new one — text-over-art legibility is the three-state-backdrop lesson (§8.3a), not an invention.
//
// WHAT IS DELIBERATELY NOT HERE (S2b owns them, §7-S2b): both `ring` modes and their focal anchor, mute,
// the in-overlay Allow/Deny confirm row, the terminal "call again" faces, and the Android back-trap.
// What IS here is everything the LOOP needs to be reviewable end to end.
//
// TAP TO INTERRUPT (§4.3 trigger B): during `speaking`, a tap anywhere outside the control cluster fires
// the same ordered kill voice barge-in does — and it is the only interrupt a browser without subtractive
// echo cancellation has. Outside `speaking` overlay taps are INERT: during `thinking` you steer by just
// talking, and nothing may cancel by accident.

/** What the phase line says. Plain language — this is the owner's screen, not a state dump. */
function phaseLabel(phase: CallPhase, speaking: boolean): string {
  switch (phase) {
    case "connecting":
      return "Connecting…";
    case "listening":
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

export function CallOverlay() {
  const art = useActiveBackdrop();
  const call = useLiveCall();
  const labelId = useId();
  const terminal = call.phase === "error" || call.phase === "ended";

  // The whole surface is trigger B; the cluster below stops the event so a hang-up is never also an
  // interrupt. `pointerdown` rather than `click`: an interrupt should land on the touch, not on the
  // release, and there is no drag on this surface to disambiguate from. The "only during `speaking`"
  // rule is NOT re-stated here — `interrupt` is inert in every other phase by the machine's own rule,
  // and two copies of that rule is how one of them stops being true.
  const onSurface = (): void => call.interrupt();

  return (
    <div
      className={`kit-call ph-${call.phase}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      onPointerDown={onSurface}
    >
      {art !== undefined && (
        <div className="kit-call-art" aria-hidden>
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
      <div className="kit-call-body">
        <p className="kit-call-phase" id={labelId}>
          <span className="kit-call-dot" aria-hidden />
          {phaseLabel(call.phase, call.userSpeechActive)}
        </p>
        {/* What the ear heard YOU say (§6) — so a mishearing is visible instantly. The `…` is the
            live-speech state: the ear has an open segment and no transcript for it yet. */}
        <p className="kit-call-heard" aria-live="polite">
          {call.userSpeechActive ? "…" : call.heard}
        </p>
        {call.note !== null && call.note !== "" && <p className="kit-call-note">{call.note}</p>}
        <div className="kit-call-controls" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className="kit-call-hangup" onClick={call.hangUp}>
            {terminal ? "Close" : "Hang up"}
          </button>
        </div>
      </div>
    </div>
  );
}
