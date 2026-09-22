import { useEffect, useId, useRef, useState } from "react";

import { FocalImg } from "../../components/FocalImg";
import { useActiveBackdrop } from "../../hooks/useActiveBackdrop";
import { useFocalAnchor } from "../../hooks/useFocalPosition";
import {
  useLiveCall,
  type CallDebug,
  type CallPhase,
  type CallView,
} from "../../hooks/useLiveCall";
import { useVoiceStatus } from "../../hooks/useVoiceStatus";
import { modalKeyDown } from "../../lib/focusTrap";
import {
  listAudioInputs,
  onHeadphones,
  ROUTE_HEADPHONES,
  ROUTE_SPEAKER,
  type MicDevice,
} from "../../lib/pcmCapture";
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

/**
 * THE IN-CALL ROUTE CONTROLS (D74 S2) — where am I listening, and through which ear.
 *
 * They are on the CALL screen and not only in Conf because the answer changes *during* a call: the
 * owner puts the headphones on, or the reply comes out of the phone's loudspeaker and they want it
 * back in the headset. Moving either one re-opens the capture under new constraints (the machine's
 * `routeChange` → `recapture`), because Chromium cannot re-negotiate echo cancellation on a live
 * Android source at all (R78 §8) — so a control that pretended to was going to lie.
 *
 * WHAT IT DOES NOT DO: write config. This is a per-call answer; the Conf pair stays the next call's
 * default (§4.5). And it never PROBES for labels — a call holds a live capture, so the permission is
 * granted and the names are already earned, which is the one Maya-F4 rule that does not apply here.
 * The other two are Conf's `DeviceRow` verbatim, deliberately: the list is READ (`enumerateDevices`,
 * plus the `devicechange` the desk this control sits on actually cares about — a headset connecting
 * mid-call), and a stored id the list does not contain is shown DISABLED rather than cleared, because
 * erasing the owner's standing choice over a device that stepped away punishes the common case.
 */
function RouteControls({ call }: { call: CallView }) {
  const [devices, setDevices] = useState<MicDevice[]>([]);
  useEffect(() => {
    const md = navigator.mediaDevices;
    // The read bails SYNCHRONOUSLY where the API is absent (jsdom, an insecure context): a control
    // that cannot learn anything must not schedule a state write either (the `DeviceRow` rule).
    if (!md?.enumerateDevices) return;
    let live = true;
    const read = (): void =>
      void listAudioInputs().then((d) => {
        if (live) setDevices(d);
      });
    read();
    md.addEventListener("devicechange", read);
    return () => {
      live = false;
      md.removeEventListener("devicechange", read);
    };
  }, []);
  const headphones = onHeadphones(call.route);
  const known = devices.some((d) => d.deviceId === call.inputDevice);
  // The action, named — the Mute button's pattern, and the one screen readers announce as what it
  // does. A button reading "Speaker" would be describing a state the ring already carries.
  const flip = headphones ? "Use speaker" : "Use headphones";
  // The Output/Input captions exist because the owner could not tell which control was which
  // (2026-09-22): the button MOVES THE MOUTH, the select PICKS THE EAR, and nothing on either said
  // so. Visual only (`aria-hidden`) — each control's own accessible name already carries the fact.
  // A FRAGMENT, not a row (design round F1): the deck is the one flex row, and every captioned
  // control is its direct child — a wrapper here would freeze "Output+Input" into a group the
  // wrap keeps together, an arbitrary pairing the fourth control would inherit.
  return (
    <>
      <div className="kit-call-io">
        <span className="kit-call-iolabel" aria-hidden>
          Output
        </span>
        <button
          type="button"
          className="kit-call-routebtn"
          disabled={!call.canRoute}
          aria-label={flip}
          onClick={() => call.setRoute(headphones ? ROUTE_SPEAKER : ROUTE_HEADPHONES)}
        >
          {flip}
        </button>
      </div>
      <div className="kit-call-io">
        <span className="kit-call-iolabel" aria-hidden>
          Input
        </span>
        <select
          className="kit-call-device"
          aria-label="Input microphone"
          disabled={!call.canRoute}
          value={call.inputDevice}
          onChange={(e) => call.setInputDevice(e.target.value)}
        >
          <option value="">system default</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
          {call.inputDevice !== "" && !known && (
            <option value={call.inputDevice} disabled>
              saved device — not available
            </option>
          )}
        </select>
      </div>
    </>
  );
}

/** The slider's own window on the 0–1 knob — deliberately NARROWER than the two real enforcers
 *  (`LiveCfg`'s Field and `_parse_start`, both 0–1), because the extremes are degenerate on a live
 *  call: 1.0 is a dead ear (nothing scores above it) and 0 makes every noise a turn. Conf keeps the
 *  full range; a knob set outside this band still shows TRUE on the pill while the thumb clamps
 *  (design round F4 — the narrowing is the design, this comment is its record). */
const VAD_MIN = 0.05;
const VAD_MAX = 0.95;
const VAD_STEP = 0.05;

/**
 * THE SPEECH-THRESHOLD SLIDER (owner ask 2026-09-22) — the server-VAD confidence floor, on the deck,
 * because the right value changes with the ROOM (a street needs a deaf ear, a quiet desk a keen one)
 * and re-opening Conf mid-call to move it was the whole complaint.
 *
 * The pill shows the number; tapping it drops a vertical slider (the Android volume gesture, the
 * owner's own reference) — UP IS A HIGHER FLOOR, A DEAFER EAR, which is why the track carries the
 * two end words: the number is a confidence the owner has no model for, the words are the polarity
 * (design round F5 — the first draft of this file got it backwards in its own comment). The DRAG is
 * local state — only the RELEASE (or Enter) commits, because a commit is a leg redial
 * (`start.vad_threshold` rides the one message that opens a leg; the relay's one-`session.update`
 * pin is why there is no in-band change) and a redial per drag-tick or per arrow-press would cycle
 * the connection through the gesture. Escape CANCELS (draft discarded, focus back on the pill), an
 * outside tap closes — the NavMenu non-modal popover contract, on the capture phase because the
 * deck's own pointer-down stop keeps bubble listeners deaf to taps on its sibling controls.
 *
 * Per call, never config — the route pair's rule (§4.5): the Conf knob stays the next call's default.
 * Renders nothing against a backend whose status predates the field: a control that cannot say what
 * the threshold IS must not offer to move it.
 */
function VadControl({ call }: { call: CallView }) {
  const [open, setOpen] = useState(false);
  /** The drag's own value, `null` between gestures (the pill then speaks the machine's truth). */
  const [draft, setDraft] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // A CLOSE without a commit discards the draft, in the ONE place every close passes through —
    // the pill must never keep showing a value the machine never took (Escape, an outside tap and
    // the pill's own re-tap all land here).
    if (!open) {
      setDraft(null);
      return;
    }
    const onDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  if (call.vad === null) return null;
  const value = draft ?? call.vad;
  const commit = (): void => {
    if (draft !== null && draft !== call.vad) call.setVad(draft);
    setDraft(null);
  };
  return (
    <div className="kit-call-io" ref={rootRef}>
      <span className="kit-call-iolabel" aria-hidden>
        Speech
      </span>
      <button
        ref={pillRef}
        type="button"
        className="kit-call-routebtn"
        // The value is IN the name (design sweep ①): `aria-label` replaces the text content, and a
        // reader given only "Speech threshold" would have no number at all.
        aria-label={`Speech threshold ${value.toFixed(2)}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {value.toFixed(2)}
      </button>
      {open && (
        <div
          className="kit-call-vadpop"
          onKeyDown={(e) => {
            // Swallowed BEFORE the overlay's modalKeyDown sees it — Escape here means "close the
            // popover", and letting it bubble would HANG UP THE CALL (design round F3).
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false); // the close effect discards the draft — one chokepoint
              pillRef.current?.focus();
            }
          }}
        >
          <span className="kit-call-vadend" aria-hidden>
            deafer
          </span>
          {/* `orient` is Firefox's own vertical-slider attribute; the CSS `writing-mode` pair covers
              Chromium. Spread past the JSX prop types — it is a real DOM attribute React forwards. */}
          <input
            type="range"
            className="kit-call-vadslider"
            aria-label="Speech threshold"
            min={VAD_MIN}
            max={VAD_MAX}
            step={VAD_STEP}
            value={value}
            disabled={!call.canRoute}
            {...{ orient: "vertical" }}
            onChange={(e) => setDraft(Number(e.target.value))}
            onPointerUp={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
          />
          <span className="kit-call-vadend" aria-hidden>
            keener
          </span>
        </div>
      )}
    </div>
  );
}

/** A number the eye can compare against a floor: three decimals, never exponent notation. */
const lvl = (n: number): string => n.toFixed(3);
/** The echo readback, printed so `"all"` and `true` are visually DISTINGUISHABLE (R78 §6.2) — they
 *  mean opposite things here, and a coerced print is how that distinction gets lost. */
const raw = (v: unknown): string => (v === undefined ? "—" : JSON.stringify(v));

/**
 * THE READBACK BLOCK (D74 S7) — the S4 calibration sitting's whole instrument panel, on the screen
 * the owner is holding, and rendered only while `voice.live.debug` is on.
 *
 * It TOUCHES NOTHING (review F4): every value arrives on the view from the machine, which is the one
 * place that holds the track. A block that read `getSettings()` itself would be a screen with a live
 * MediaStreamTrack in its hand.
 */
function DebugBlock({ d }: { d: CallDebug }) {
  return (
    <pre className="kit-call-debug" aria-hidden>
      {`ec    ${raw(d.ecSettings)}   caps ${raw(d.ecCapabilities)}
route ${d.route || "—"}   hold ${d.echoWorkaround || "—"}   fellBack ${d.fellBack ? "yes" : "no"}
arm   ${d.bargeArmed ? "yes" : "no"}   holdMode ${d.earHoldMode ? "yes" : "no"}   held ${
        d.earHeld ? "yes" : "no"
      }   mouth ${d.mouthLive ? "yes" : "no"}
dev   ${d.deviceLabel || "—"} ${d.deviceId ? `[${d.deviceId.slice(0, 8)}]` : ""}
rms   ${lvl(d.rms)}   peak2s ${lvl(d.rmsPeak2s)}   floor ${lvl(d.floor)}
final ${
        d.lastFinal === null
          ? "—"
          : `${d.lastFinal.accruedMs}ms   peak ${lvl(d.lastFinal.peak)}   chars ${d.lastFinal.chars}`
      }`}
    </pre>
  );
}

export function CallOverlay({ close }: { close: () => boolean }) {
  const art = useActiveBackdrop();
  const call = useLiveCall();
  // The §6 mode knob, SNAPSHOTTED (audit A LOW). Read live off the query, a mid-call `/voice/status`
  // refetch — a Conf save, a window refocus — would flip the overlay's indicator under a call in
  // progress, against §4.5's "settings edited mid-call apply to the NEXT call", which every other knob
  // here obeys by being read once at capture.
  // MOUNT-TIME *IS* CALL START, which is what makes a lazy initializer the whole of it: this component
  // is mounted under `key={callMount}` (`DefaultRoot`), so a call cannot begin without mounting it and
  // a REDIAL bumps the key rather than reusing the machine — the next call reads the query again.
  // The read is the design, stated the honest way round: the query has ALREADY answered by the time the
  // overlay can mount, because the call door is gated on it — call mode is only reachable while
  // `useComposer().liveReady` (= `/voice/status`'s own `live` bit) is up, and the mic's mode boots to
  // `mic` with no memory every load. So the `?? true` below is not a race to win; it is the `LiveCfg`
  // field default dressing a state the door does not admit.
  const ringKnob = useVoiceStatus().data?.live_call?.ring;
  const [ringMode] = useState(() => ringKnob ?? true);
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
      {/* THE TOP DECK (owner move, 2026-09-22) — the route row lives ABOVE the ring, not in the
          bottom cluster with Mute: they are settings about the call, not actions in it, and the
          furniture row was cramped. Its own pointer-down stop, because it sits outside the
          cluster's — moving the route is never also a tap-to-interrupt. Gone on a terminal, like
          Mute — there is no ear to move. */}
      {!terminal && (
        <div className="kit-call-top" onPointerDown={(e) => e.stopPropagation()}>
          <RouteControls call={call} />
          <VadControl call={call} />
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
          {/* D74 S7 — inside the cluster, so reading it is never also a tap-to-interrupt. Absent
              entirely with the knob off: no wrapper, no spacing, nothing. */}
          {call.debug !== null && <DebugBlock d={call.debug} />}
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
