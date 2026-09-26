import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { FocalImg } from "../../components/FocalImg";
import { Glyph } from "../../components/icons";
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
import { listAudioInputs, ROUTE_CALL, ROUTE_MEDIA, type MicDevice } from "../../lib/pcmCapture";
import {
  confirmAwaiting,
  getLiveTurn,
  lastReply,
  resumeCall,
  useChatSlice,
} from "../../store/chat";
import { startCall } from "../../store/liveCall";

// THE CALL SCREEN (Phase 24 / D71 §6) — the agent's art full-bleed, the call's state on a ring over the
// face, what the ear heard you say, and the furniture: mute, hang up, the Allow/Deny row a confirm gate
// needs, and the terminal faces. The machine lives inside this component, so MOUNTING is starting a call
// and UNMOUNTING is the whole teardown; there is no third place a call can be.
//
// THE BACKDROP NEVER GOES AWAY (owner ruling): `useActiveBackdrop` ALONE — the active agent's bound
// background, its avatar standing in, else the plain theme surface. A call with Lynette looks like HER.
// It is the same routing ladder every send follows (the sticky pin the composer menu writes, else the
// thread's pin, else the default), so the face on the call screen is the agent the call's turns run as.
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

// ── THE DECK'S GLYPHS (D75, owner ask 2026-09-22) ────────────────────────────────────────────────
// Hand-inlined lucide geometry on the house `Glyph` frame (`components/icons.tsx` carries the rule and
// the reason `lucide-react` is not a dependency). Local to this file because they are this deck's
// vocabulary — the two ROUTES — and not house chrome; if a second surface ever names a route they move
// up to the shell set. Every one is `aria-hidden` by the frame: the pill and the rows carry the words.

/** lucide `volume-2` — the CALL route (echo-cancelled, phone-call mode). */
function SpeakerIcon({ size }: { size?: number } = {}) {
  return (
    <Glyph size={size}>
      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
      <path d="M16 9a5 5 0 0 1 0 6" />
      <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
    </Glyph>
  );
}

/** lucide `speaker` — the hi-fi BOX, for the MEDIA route (no call processing). The two routes have to
 *  be told apart at a glance on a pill the size of a thumb, and a waves-count difference is not that; a
 *  different OBJECT is. */
function HifiSpeakerIcon({ size }: { size?: number } = {}) {
  return (
    <Glyph size={size}>
      <rect width="16" height="20" x="4" y="2" rx="2" />
      <path d="M12 6h.01" />
      <circle cx="12" cy="14" r="4" />
      <path d="M12 14h.01" />
    </Glyph>
  );
}

/** lucide `audio-lines` — the SENSITIVITY control (D76 §C.7): a level, which is what the popover shows.
 *  Not a gauge or a dial: the control is a meter with a line on it, and the glyph says "level". */
function LevelIcon({ size }: { size?: number } = {}) {
  return (
    <Glyph size={size}>
      <path d="M2 10v3" />
      <path d="M6 6v11" />
      <path d="M10 3v18" />
      <path d="M14 8v7" />
      <path d="M18 5v13" />
      <path d="M22 10v3" />
    </Glyph>
  );
}

/**
 * THE DECK'S POPOVER MECHANICS, stated ONCE (D75, extracted from the since-deleted speech slider).
 *
 * Three rules, and every one of them was learned the hard way on this screen, so a second control
 * re-deriving them is a second chance to get one wrong:
 *   · the outside close listens on the CAPTURE phase, because the deck's own pointer-down stop (which
 *     keeps a control tap from being a tap-to-interrupt) makes bubble listeners deaf to taps on its
 *     sibling controls. It closes through `dismiss` like every other close (design round L3): one
 *     close, one focus rule, so a tap-away cannot leave focus on a node that has just unmounted;
 *   · ESCAPE IS SWALLOWED — this overlay's own Escape rule is `modalKeyDown`, i.e. HANG UP THE CALL
 *     (design round F3), so a popover that let it bubble would end the call instead of closing itself;
 *   · a keyboard close hands focus back to the pill it came from, which is the only element still on
 *     screen that the gesture can be continued from.
 * It is deliberately NOT modal: the NavMenu popover contract, which the rest of the app already wears.
 *
 * WHERE THE SWALLOW HANGS IS THE WHOLE OF RULE TWO (review round A1, found independently by the visual
 * e2e probe and the correctness lens — and against what this file's own comments claimed). Opening a
 * popover leaves focus ON THE PILL, which is the popover's SIBLING: a handler on the popover node never
 * sees that keydown at all, it bubbles pill → `.kit-call-io` → the overlay → `modalKeyDown` → the call
 * ends. So the handler rides the element that already carries `rootRef` — the `.kit-call-io` wrapper,
 * the one ancestor of BOTH — and is gated on `open`, because an Escape with the popover closed must
 * still reach the overlay and hang up. (NavMenu's other half, focus-on-open, is deliberately NOT copied:
 * a root-level swallow is the leaner equivalent and leaves the pill as the one thing to tab back to.
 * The unit arm that was supposed to hold this fired on a ROW — a focus state the UI never reaches —
 * which is exactly why it passed over a live bug; E1's arm now fires on the pill.)
 */
function useDeckPopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  /** Close and put the finger back where it started — the ONE close a keyboard, a pick or a tap-away
   *  takes. Stable, so the outside-close effect below re-subscribes on `open` alone. */
  const dismiss = useCallback((): void => {
    setOpen(false);
    pillRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) dismiss();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, dismiss]);
  const onKeyDown = (e: ReactKeyboardEvent): void => {
    // The `open` gate is not defensive: this handler sits on the control's ROOT, which is mounted for
    // the whole call, so without it every deck control would be a place the call cannot hang up from.
    if (!open || e.key !== "Escape") return;
    e.stopPropagation();
    dismiss();
  };
  return { open, setOpen, rootRef, pillRef, dismiss, onKeyDown };
}

/** The two routes as the picker offers them (D76 §A — the axis is media/call, not speaker/headphones).
 *  The VALUES are the `pcmCapture` constants and never string literals — the consts' own comment says
 *  why — and the hints are the bargain each one strikes, because that is the whole content of the
 *  choice. Whether the mic pauses while the reply speaks is NOT a route's property any more; it is
 *  `mic_hold`'s, which is config only (D76 §B). The glyphs are a different OBJECT each (main-seat
 *  overrule of the D75 design round): at 18px that is the only difference the eye resolves. */
const ROUTE_CHOICES = [
  {
    val: ROUTE_MEDIA,
    name: "Media",
    hint: "clear audio · follows Bluetooth like music, phone speaker otherwise",
    Icon: HifiSpeakerIcon,
  },
  {
    val: ROUTE_CALL,
    name: "Call",
    hint: "phone-call mode · echo-cancelled · hands-free mic",
    Icon: SpeakerIcon,
  },
] as const;

/**
 * THE OUTPUT PICKER (D75 ④, owner ask 2026-09-22) — STATE-FIRST, and that is a fix, not a style.
 *
 * The control it replaces was a button labelled with the ACTION ("Use headphones" while on speaker),
 * the Mute pattern. On Mute that reads right because there are two states and the button is the only
 * thing on screen naming either; here the owner read the label as the STATE and reported the crackle
 * INVERTED — they believed they were on headphones while the call was on the speaker route (ISS-16).
 * An action label on a state the owner already misread once is the shape this picker exists to end.
 *
 * So the pill SHOWS where the sound is going (the current route's glyph, the name in its accessible
 * name since the pill has no words) and tapping opens the list — the owner's own instruction, "the
 * hint will be the list when you click". Picking writes nothing to config — the per-call rule the route
 * pair has always had (§4.5); the Conf row stays the next call's default.
 *
 * A `menu` OF `menuitemradio`s, not a `radiogroup` (review round A6): the ARIA radio group promises
 * arrow-key selection with a roving tabindex, and this is a chip that names a state and opens a small
 * exclusive list — `PrivilegeChip`'s exact shape, which is the pattern this house already ships for it.
 * `aria-checked` stays: one of two, and which one is the whole content of the card.
 */
function OutputPicker({ call }: { call: CallView }) {
  const pop = useDeckPopover();
  // An unknown route is the media case, the same way the capture resolves it (`wantsAec`) —
  // the pill must never go blank because a backend answered with something this build has no glyph for.
  // The fallback names ITS row rather than riding list position (review sweep): the array's order is a
  // presentation choice, and a reorder must not silently move where an unknown route lands.
  const current =
    ROUTE_CHOICES.find((c) => c.val === call.route) ??
    ROUTE_CHOICES.find((c) => c.val === ROUTE_MEDIA) ??
    ROUTE_CHOICES[0];
  return (
    <div className="kit-call-io pop-deck" ref={pop.rootRef} onKeyDown={pop.onKeyDown}>
      <span className="kit-call-iolabel" aria-hidden>
        Sound
      </span>
      <button
        ref={pop.pillRef}
        type="button"
        className="kit-call-routebtn kit-call-iconpill"
        disabled={!call.canRoute}
        // The STATE, not the action (see the block comment): the pill shows a glyph, so its name is
        // the only place a reader — or the owner checking their own report — learns where they are.
        // The tail is the affordance a chevron would have drawn (design S2, overruled on the owner's
        // "just icons"): the chip says it can be changed instead of showing that it can.
        aria-label={`Sound: ${current.name} — tap to change`}
        aria-haspopup="menu"
        aria-expanded={pop.open}
        onClick={() => pop.setOpen(!pop.open)}
      >
        <current.Icon />
      </button>
      {pop.open && (
        <div className="kit-call-pop kit-call-routepop" role="menu" aria-label="Sound">
          {ROUTE_CHOICES.map((c) => (
            <button
              key={c.val}
              type="button"
              role="menuitemradio"
              // Checked against the RESOLVED row, never the raw string (Maya A2): an unknown route
              // falls to the media row above, and the capture resolves it the same way
              // (`wantsAec`), so this is the truth rather than a convenience — a card with no checked
              // row would claim the sound is going nowhere.
              aria-checked={c.val === current.val}
              className="kit-call-routeopt"
              disabled={!call.canRoute}
              onClick={() => {
                call.setRoute(c.val);
                pop.dismiss();
              }}
            >
              <c.Icon />
              <span className="kit-call-routename">
                {c.name}
                {/* The tick beside the tint (design L1, the tools-row precedent): over a translucent
                    card on art, a colour wash alone is one cue for the one question the owner already
                    got wrong once. Decorative — `aria-checked` is the stated fact. */}
                {c.val === current.val && <span aria-hidden> ✓</span>}
              </span>
              <span className="kit-call-routehint">{c.hint}</span>
            </button>
          ))}
          {/* ISS-18 (R81): a flip out of comm mode cannot move a reply already playing — its output
              stream was tagged when it opened. A footer under the choices, not a note on the overlay's
              line (owner ruling 2026-09-24): it is a property of the picker, said once where the
              choice is made, and it never reads as an alarm. */}
          <span className="kit-call-routehint kit-call-routefoot" aria-hidden>
            a change mid-reply starts with the next reply
          </span>
        </div>
      )}
    </div>
  );
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
  const known = devices.some((d) => d.deviceId === call.inputDevice);
  // The captions exist because the owner could not tell which control was which (2026-09-22): the
  // pill moves where the SOUND comes out, the select picks which MIC is heard, and nothing on either
  // said so. Visual only (`aria-hidden`) — each control's own accessible name already carries the fact.
  //
  // "Sound" and "Mic", not "Output" and "Input" (review round A5): the Output/Input pair claims a
  // mouth/ear split the platform does not honour — on Android the input list IS the router, and
  // picking a row there moves BOTH directions (R74 §2.2). Two words that each name one thing the
  // owner can point at beat two that name a symmetry we do not have.
  //
  // A FRAGMENT, not a row (design round F1): the deck is the one flex row, and every captioned
  // control is its direct child — a wrapper here would freeze "Sound+Mic" into a group the
  // wrap keeps together, an arbitrary pairing the fourth control would inherit.
  //
  // THE EAR STAYS NATIVE (D75 ④): the Output pill grew a picker of its own because there is no OS
  // affordance behind it — Android has no page-reachable output selector at all (R79 §4, re-verified
  // 2026-09-22), the "route" is a fiction we assemble out of capture constraints. The INPUT list is a
  // real device enumeration, and a `<select>` opens the platform's own picker, which is the better
  // control on a phone. Two shapes because they are two different things, not an inconsistency.
  return (
    <>
      <OutputPicker call={call} />
      <div className="kit-call-io">
        <span className="kit-call-iolabel" aria-hidden>
          Mic
        </span>
        <select
          className="kit-call-device"
          aria-label="Input microphone"
          disabled={!call.canRoute}
          value={call.inputDevice}
          onChange={(e) => call.setInputDevice(e.target.value)}
        >
          <option value="">default</option>
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

/** How often the Sensitivity meter re-reads the ear, ms (D76 §F) — a property of reading, like
 *  `DEBUG_TICK_MS`: the level arrives on the audio callback at 25–50 Hz, and the meter SAMPLES it rather
 *  than following it (the D74 S7 rule — never per frame, never a render per frame). 100 ms is fast enough
 *  for a syllable to move the bar and slow enough to cost nothing; the tick runs only while the popover
 *  is open. It is also the most often a drag re-pins the floor. Not a knob: nothing about the call
 *  changes with it. */
const METER_TICK_MS = 100;

/** A dBFS value the way the owner reads it: whole decibels, a real minus sign (U+2212 — the hyphen
 *  reads as a dash beside a number this small), and the unit. */
function dbLabel(n: number): string {
  const r = Math.round(n);
  return `${r < 0 ? "−" : ""}${Math.abs(r)} dB`;
}

/** Where `db` sits on the meter, 0 (bottom, `min`) … 1 (top, `max`) — clamped, so a level below the
 *  range is an empty bar and one above it a full one. A degenerate range (the two bounds are separate
 *  Conf fields and nothing orders them) reads as a step at `max` rather than a division by zero. */
function meterFrac(db: number, min: number, max: number): number {
  if (max <= min) return db >= max ? 1 : 0;
  return Math.min(1, Math.max(0, (db - min) / (max - min)));
}

/**
 * THE SENSITIVITY CONTROL (D76 §C.7) — the deck's third control, and the Speech slider's successor in
 * PATTERN only (`useDeckPopover`, the captioned icon pill, the vertical column, the end words). What it
 * shows is new: a LIVE METER — the bar is the mic's level right now, the accent line is the floor the
 * gate measures against — because a relative floor is only legible beside the voice it is relative to.
 *
 * AUTO is the default and the floor moves by itself (the noise tracker and the own-voice learner,
 * `lib/levelGate`). DRAGGING THE LINE PINS a manual floor for THIS call — Discord's shape: it writes
 * nothing, dies with the call, and applies from the next frame with no leg redial. Tapping the caption
 * above the meter hands the floor back to Auto.
 *
 * POLARITY, stated once because the slider this replaces got it backwards in its own comment: the axis
 * is dBFS, BOTTOM = `min_dbfs`, TOP = `max_dbfs`. A LOWER floor admits quieter sound, so DOWN IS MORE
 * SENSITIVE — which is what the two end words say.
 *
 * ONE INPUT MECHANISM — the native range, overlaid transparent on the whole 44 × 132 column: the drag
 * target is the column (not a thumb), the keyboard and assistive tech get a real slider for free, and
 * no pointer arithmetic is re-derived here. What the eye sees is ours (the bar, the line); what the
 * finger and the reader touch is the platform's.
 *
 * NOTHING HERE RENDERS PER TICK: the bar, the line and the range's value are written through refs by the
 * one interval, which runs only while the popover is open. React sees a render only when the PIN
 * changes, which is what the pill's accessible name says.
 */
function SensitivityControl({ call, min, max }: { call: CallView; min: number; max: number }) {
  const { open, setOpen, rootRef, pillRef, onKeyDown } = useDeckPopover();
  const { readLevel, setFloorPin } = call;
  // The pinned VALUE, for the words (the pill's name, the caption). The view carries only whether a
  // pin stands (`floorAuto`, which stays the truth for that); the value is this control's own because
  // this control is the only thing that ever sets one — a mirror of its own last write, not a copy of
  // the machine's state.
  const [pinDb, setPinDb] = useState<number | null>(null);
  const pinned = !call.floorAuto;
  const pinText = pinDb === null ? "pinned" : dbLabel(pinDb);
  const fillRef = useRef<HTMLElement>(null);
  const markRef = useRef<HTMLElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);
  /** A pointer is down on the column — the tick then leaves the range's value to the finger. */
  const dragging = useRef(false);
  /** The drag's latest value, not yet handed to the machine (the tick flushes it — at most one pin per
   *  tick, never one per pointer move). */
  const pending = useRef<number | null>(null);

  const commit = useCallback(
    (v: number): void => {
      pending.current = null;
      setFloorPin(v);
      setPinDb(v);
    },
    [setFloorPin],
  );
  const placeMark = useCallback(
    (floor: number | null): void => {
      const mark = markRef.current;
      if (!mark) return;
      mark.style.opacity = floor === null ? "0" : "1";
      if (floor !== null) mark.style.setProperty("--f", String(meterFrac(floor, min, max)));
    },
    [min, max],
  );

  /** The finger lifted (or the platform took the gesture): stop batching, and hand the drag's last value
   *  over now rather than at the next tick. */
  const release = useCallback((): void => {
    dragging.current = false;
    if (pending.current !== null) commit(pending.current);
  }, [commit]);

  useEffect(() => {
    if (!open) return;
    // The LIFT is heard on the document, capture phase: a mouse drag that leaves the column releases
    // off it, and a lift the column never saw would leave the tick deferring to a finger that is gone.
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    const tick = (): void => {
      if (pending.current !== null) commit(pending.current);
      const { level, floor } = readLevel();
      if (fillRef.current)
        fillRef.current.style.transform = `scaleY(${level === null ? 0 : meterFrac(level, min, max)})`;
      placeMark(floor);
      const range = rangeRef.current;
      if (range && !dragging.current) {
        // No floor yet (the first second of a call) ⇒ the range still has a browser-default value, and
        // assistive tech would announce an arbitrary midpoint as the floor; it is "Auto" until there is
        // a number (the S1 code round, LOW).
        if (floor === null) range.setAttribute("aria-valuetext", "Auto");
        else {
          range.value = String(Math.round(floor));
          range.setAttribute("aria-valuetext", dbLabel(floor));
        }
      }
    };
    tick();
    const id = setInterval(tick, METER_TICK_MS);
    return () => {
      clearInterval(id);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
      // A close DISCARDS a drag still in flight (the S1 code round, MED 1): the card can go under an
      // outside pointer-down while the finger is still on the column, and only a LIFT may pin. What
      // is lost is at most the last tick's worth of movement — the tick already commits while dragging.
      dragging.current = false;
      pending.current = null;
    };
  }, [open, readLevel, commit, release, placeMark, min, max]);

  return (
    <div className="kit-call-io" ref={rootRef} onKeyDown={onKeyDown}>
      <span className="kit-call-iolabel" aria-hidden>
        Sensitivity
      </span>
      <button
        ref={pillRef}
        type="button"
        className="kit-call-routebtn kit-call-iconpill"
        // Disabled with its two deck siblings, on THEIR rule: while the leg is moving there may be no
        // capture at all, and a meter with no numbers must not open onto a dead column.
        disabled={!call.canRoute}
        // The STATE is in the name (the Sound pill's rule): the pill is a glyph, so this is the only
        // place a reader learns whether the floor is the machine's or theirs.
        aria-label={`Sensitivity: ${pinned ? pinText : "auto"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <LevelIcon />
      </button>
      {open && (
        <div className="kit-call-pop kit-call-senspop" role="dialog" aria-label="Sensitivity">
          {/* The caption IS the Auto affordance: a button only while there is a pin to release, plain
              words when the floor is already the machine's (a button that does nothing is a lie).
              BOTH states are two lines in the same box — the mode, then what a touch does — because
              the column below must not move when a pin lands: the owner's finger is on it. */}
          {pinned ? (
            <button
              type="button"
              className="kit-call-sensmode"
              disabled={!call.canRoute}
              aria-label={`Back to auto — pinned at ${pinText}`}
              onClick={() => {
                pending.current = null;
                setFloorPin(null);
                setPinDb(null);
                // This button is about to unmount (Auto is plain words), and focus left on a removed
                // node falls to <body> — OUTSIDE the overlay, where Escape reaches neither this card's
                // swallow nor the overlay's own rule (found by the e2e arm). The column stays in the
                // card, and it is the next thing a keyboard would move anyway.
                rangeRef.current?.focus();
              }}
            >
              {pinText}
              <span className="kit-call-sensend">tap for auto</span>
            </button>
          ) : (
            <span className="kit-call-sensmode">
              Auto
              <span className="kit-call-sensend">drag to pin</span>
            </span>
          )}
          <span className="kit-call-sensend" aria-hidden>
            less
          </span>
          <div className="kit-call-meter">
            <i className="kit-call-meterfill" ref={fillRef} aria-hidden />
            <i className="kit-call-metermark" ref={markRef} aria-hidden />
            {/* `orient` is Firefox's own vertical-slider attribute; the CSS `writing-mode` pair covers
                Chromium (the deleted Speech slider's recipe). UNCONTROLLED on purpose: its value is
                written by the tick through the ref, so an Auto floor moving by itself costs no render. */}
            <input
              ref={rangeRef}
              type="range"
              className="kit-call-meterrange"
              aria-label="Sensitivity floor"
              aria-valuetext="Auto"
              min={min}
              max={max}
              step={1}
              disabled={!call.canRoute}
              {...{ orient: "vertical" }}
              onPointerDown={() => {
                dragging.current = true;
              }}
              onChange={(e) => {
                const v = Number(e.target.value);
                // The line follows the finger NOW (a style write, no render); the machine hears it at
                // the next tick. A keyboard step has no drag to batch, so it pins at once.
                placeMark(v);
                if (dragging.current) pending.current = v;
                else commit(v);
              }}
            />
          </div>
          <span className="kit-call-sensend" aria-hidden>
            more sensitive
          </span>
        </div>
      )}
    </div>
  );
}

/** How close to the bottom counts as "still following", in px. The chat log's own stick rule, at the
 *  scale of a three-line box: 140px of slack there is most of this block. */
const FOLLOW_SLACK_PX = 8;

/**
 * THE CAPTIONS (owner ask 2026-09-22) — the agent's reply as text on the call screen, three lines of
 * it, fading at whichever edge hides more, growing as it streams. The screen said what the EAR heard and
 * never what came BACK; on a phone that is the half you cannot re-read, because the reply is in the
 * chat behind an overlay you would have to hang up to see.
 *
 * It renders the thread's LAST assistant message, which is already in this browser (`store/chat`) —
 * no wire, no second copy of the reply, and nothing to keep in step: the same deltas that fill the
 * transcript fill this. The subscription returns a STRING (the `createStore` snapshot contract), so a
 * reasoning or tool delta on the same message costs no render here.
 *
 * THE CALL-SCOPE RULE (§4.5), and it is the whole reason this component has state at all: captions may
 * show only a turn that STARTED after the call did. A reply already streaming at mount is the owner
 * reading silently before they dialled — the same exclusion `setCallVoice(true, getLiveTurn() !== null)`
 * makes for the MOUTH, expressed the same way it is there: as a GATE ON THE STATUS TIMELINE, never as
 * the excluded message's id (a fresh turn's optimistic placeholder is RENAMED mid-stream when
 * `message.start` adopts the server's id, so a captured id stops matching the very message it was meant
 * to exclude). Once that turn has settled the FLOOR is latched — the last reply then is the last one
 * this block may not show — and the next reply, being a message that did not exist, is the call's own.
 *
 * DELIBERATELY NOT A LIVE REGION: the reply is being SPOKEN, and an `aria-live` here would read the
 * whole of it over its own audio. It is ordinary text in a dialog — readable on demand, announced by
 * nobody. (`.kit-call-heard` keeps its live region for the opposite reason: nothing says that aloud.)
 */
function CallCaptions() {
  // `undefined` = the gate is still shut (a turn was live at mount); a string/null is the latched
  // floor. One `useState` initializer, because mount-time IS call start (the overlay's own key rule).
  const [floor, setFloor] = useState<string | null | undefined>(() =>
    getLiveTurn() !== null ? undefined : (lastReply()?.id ?? null),
  );
  // "Is a turn live" asked of the store, through the same expression the latch above took — one
  // statement of the question, so the gate cannot open on a condition the floor never tested.
  const turnLive = useChatSlice(() => getLiveTurn() !== null);
  // The gate OPENS the instant that turn settles, and it is latched DURING RENDER (React's own
  // adjusting-state-while-rendering pattern) rather than from an effect: the floor is what the very
  // next line reads, so deferring it to a commit would paint one frame of the excluded reply first.
  // It can run at most once — `floor` leaves `undefined` and never returns to it.
  if (floor === undefined && !turnLive) setFloor(lastReply()?.id ?? null);
  // THE FLOOR TRACKS until the call's first turn has RUN (review F5, a belt): the latched id can
  // VANISH — a client-only placeholder from a failed pre-call send is dropped by any `reloadChat` —
  // and then `lastReply` returns an OLDER durable message whose id no longer matches, painting a
  // pre-call reply. The discriminator is the same one the gate itself rides, the STATUS TIMELINE: a
  // real call reply always passes through a live turn on this thread's own subscription, so until one
  // has, any change of last-settled-reply is pre-call history re-arranging itself, and the floor
  // simply follows it. From the first live turn on, the floor is fixed — a vanishing id after that
  // resolves to the call's own replies, which may show.
  const turnRan = useRef(false);
  if (turnLive) turnRan.current = true;
  if (floor !== undefined && !turnLive && !turnRan.current) {
    const id = lastReply()?.id ?? null;
    if (id !== floor) setFloor(id);
  }
  const said = useChatSlice(() => {
    const reply = lastReply();
    if (reply === null || floor === undefined || reply.id === floor) return "";
    return reply.text;
  });

  // AUTO-FOLLOW, and only while the owner has not scrolled away: growth pins to the bottom, a scroll
  // up parks it. The chat log's rule and its shape (a ref + a scroll handler), NOT its code — that one
  // is bound to `#app-scroll`, the shell's single content pane, which this overlay covers.
  const boxRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Which edge is hiding something — what the stylesheet fades (and nothing else may decide: CSS
  // cannot ask whether a box overflows). Measured from the same reads the follow rule uses, so the
  // fade and the pin can never disagree about where the box is.
  const [edges, setEdges] = useState({ above: false, below: false });
  const measure = (el: HTMLElement): void => {
    const slack = el.scrollHeight - el.scrollTop - el.clientHeight;
    stick.current = slack <= FOLLOW_SLACK_PX;
    const above = el.scrollTop > 0;
    const below = slack > 0;
    setEdges((e) => (e.above === above && e.below === below ? e : { above, below }));
  };
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (stick.current) el.scrollTop = el.scrollHeight;
    // Measured HERE rather than left to the scroll event the line above fires: growth alone moves no
    // scrollbar, so a box that just became scrollable while already at its end would keep the edges it
    // was painted with.
    measure(el);
  }, [said]);

  if (said === "") return null; // nothing said yet, or a tool-only turn: no empty box
  return (
    <div
      className={
        "kit-call-said" + (edges.above ? " more-above" : "") + (edges.below ? " more-below" : "")
      }
      ref={boxRef}
      // Its own pointer-down stop (the cluster's rule): this block SCROLLS, and a drag to read the
      // start of a reply must never also be a tap-to-interrupt.
      //
      // …ONLY WHILE IT ACTUALLY SCROLLS, though (review round B1): stopping unconditionally put a dead
      // zone directly above the line that says "tap to interrupt", over the text the owner is most
      // likely to be looking at when they want to interrupt. The bargain, stated: a SHORT reply is a
      // live interrupt target like the rest of the surface, a LONG one is a reading surface a drag can
      // be started on, and everywhere else on the overlay always interrupts. The same two edge reads
      // the fade and the follow rule take answer it, so the three can never disagree about the box.
      onPointerDown={(e) => {
        if (edges.above || edges.below) e.stopPropagation();
      }}
      onScroll={(e) => measure(e.currentTarget)}
    >
      {said}
    </div>
  );
}

/** A level the eye can compare against a floor: dBFS to one decimal (D76 §C.1 — every level the call
 *  reasons about is dB now), and a dash for "nothing measured yet". */
const db = (n: number | null): string => (n === null ? "—" : n.toFixed(1));
/** The echo readback, printed so `"all"` and `true` are visually DISTINGUISHABLE (R78 §6.2) — they
 *  mean opposite things here, and a coerced print is how that distinction gets lost. */
const raw = (v: unknown): string => (v === undefined ? "—" : JSON.stringify(v));
/** The voice key (S3b: `<device>|ec=<mode>`), its device part cut the way the `dev` line cuts the id
 *  when that part IS the id — a 64-hex id runs the line off the screen; a label-based key prints whole.
 *  The mode suffix is everything from the last `|` (the mode itself never holds one). */
const vkey = (key: string | null, deviceId: string): string => {
  if (key === null) return "—";
  const cut = key.lastIndexOf("|");
  const device = cut < 0 ? key : key.slice(0, cut);
  return device === deviceId && device.length > 8
    ? `${device.slice(0, 8)}…${key.slice(device.length)}`
    : key;
};

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
route ${d.route || "—"}   hold ${d.micHold || "—"}   fellBack ${d.fellBack ? "yes" : "no"}
arm   ${d.bargeArmed ? "yes" : "no"}   held ${d.earHeld ? "yes" : "no"}   mouth ${
        d.mouthLive ? "yes" : "no"
      }
dev   ${d.deviceLabel || "—"} ${d.deviceId ? `[${d.deviceId.slice(0, 8)}]` : ""}
dBFS  ${db(d.level)}   peak2s ${db(d.levelPeak2s)}   floor ${db(d.floor)} ${
        d.floorPinned ? "(pinned)" : "(auto)"
      }
noise ${db(d.noise)} ${d.noiseSettled ? "(settled)" : "(provisional)"}   voice ${db(d.voiceLevel)}
key   ${vkey(d.voiceKey, d.deviceId)}
final ${
        d.lastFinal === null
          ? "—"
          : `${d.lastFinal.accruedMs}ms   peak ${db(d.lastFinal.peakDb)}   chars ${d.lastFinal.chars}`
      }
probe ${
        d.probe === null
          ? "—"
          : `#${d.probe.idx}   max ${db(d.probe.maxDb)}   floor ${db(d.probe.floor)}   ${
              d.probe.released ? "released" : "held"
            }`
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
  //
  // ONE read of the query feeds BOTH snapshots (review sweep): two `useVoiceStatus()` calls in one
  // component are two subscriptions to the same observer for the same payload, and a second one is
  // also a second chance for the two to be taken from different reads.
  const liveKnobs = useVoiceStatus().data?.live_call;
  const [ringMode] = useState(() => liveKnobs?.ring ?? true);
  // …and the captions knob, on exactly the same terms and for exactly the same reasons (the paragraph
  // above is this one's too): a presentation choice, frozen for the call, re-read by the next one.
  const [captions] = useState(() => liveKnobs?.captions ?? true);
  // …and the Sensitivity meter's range (D76 §C.7: `min_dbfs`…`max_dbfs`), on the same terms. No
  // numbers, no meter: a control that cannot say where the floor may go must not offer to move it (the
  // Speech slider's own rule) — and the call door makes that state unreachable anyway.
  const [meterRange] = useState(() =>
    typeof liveKnobs?.min_dbfs === "number" && typeof liveKnobs.max_dbfs === "number"
      ? { min: liveKnobs.min_dbfs, max: liveKnobs.max_dbfs }
      : null,
  );
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
          {meterRange !== null && (
            <SensitivityControl call={call} min={meterRange.min} max={meterRange.max} />
          )}
        </div>
      )}
      <div className="kit-call-body">
        {/* The reply, above the state line and the heard line both — the answer reads down into what
            you said, the way the chat does. Nothing at all with the knob off: no wrapper, no gap. */}
        {captions && <CallCaptions />}
        <p className="kit-call-phase" id={labelId}>
          {phaseLabel(call.phase, call.userSpeechActive, call.muted)}
        </p>
        {/* What the ear heard YOU say (§6) — so a mishearing is visible instantly. The `…` is the
            live-speech state: the ear has an open segment and no transcript for it yet — and it HOLDS
            through `waitingFinal`, the STT round-trip after the segment closes (owner, 2026-09-23:
            the previous final surfacing for those milliseconds read as a stale line popping in before
            the real one). The pair is the machine's own "words in flight" predicate (§4.2's iron rule).
            In NO-RING mode this line carries the state indicator too (the dot is `aria-hidden`, so the
            live region still announces only the words). */}
        <p className="kit-call-heard" aria-live="polite">
          {!ringMode && <span className="kit-call-dot" aria-hidden />}
          {call.userSpeechActive || call.waitingFinal ? "…" : call.heard}
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
