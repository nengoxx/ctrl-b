import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { micLabel } from "./useComposerChrome";
import { TOO_SHORT_MSG, type useDictation } from "../../../hooks/useDictation";
import { startCall } from "../../../store/liveCall";
import { setMicCancel } from "../../../store/micCancel";
import { getUI, setUI, useUISlice } from "../../../store/ui";

// THE DUAL-MODE MIC GESTURE (Phase 24 / S0.5 — docs/LIVE_VOICE_PLAN.md §6, D71; every threshold traced
// to docs/research/R69-hold-to-record-gesture.md). ONE button in the mic's existing slot in all three
// composer variants: tap switches MODE, hold RECORDS, swipe up LOCKS hands-free, slide left CANCELS.
//
// Shaped like `components/useDragReorder.ts`, for the same reason: a PURE state machine (`micReduce`,
// exported and unit-tested arm by arm) plus thin pointer wiring that does nothing but translate events
// into signals and outcomes into calls. Everything geometric is a pure function of the signal stream, so
// jsdom's absence of layout costs the tests nothing.
//
// WHAT THIS HOOK DOES NOT OWN: the recorder. There is exactly one, `hooks/useDictation`, and the gesture
// drives it through `start`/`stop`/`cancel` — the upload, the draft append, the `stt_auto_send` policy
// and the silence auto-stop are untouched (the gesture changes CAPTURE ergonomics, not send policy).
//
// THE CALL HALF SHIPS DARK. `live` is `voice.data?.live`, which no backend sends until S1, so today the
// tap arm always lands on the "hold to record" hint and `startCall` is never reached. The machine, the
// chrome and the CSS for call mode are built and tested (a mocked `live: true` reaches them) so S1/S2a
// wire a bit rather than build a mode.

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE PARAMETERS. Every one traces to R69 §9's table, and this is the ONLY place any of them appears —
// no literal below, no copy in a component, no second definition in a test. (The MOTION constants are
// the deliberate exception and live in kit.css beside the rules they drive, since CSS cannot read these;
// each carries the same R69 citation there, and `LOCK_HINT_COUNT_MS` names the one value that must stay
// in lockstep with the stylesheet.)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Press→record delay, ms. R69 §1.1 [V] — Telegram's tap-disambiguation window for a DUAL-MODE button
 *  (`runOnUIThread(recordAudioVideoRunnable, 150)`), which is exactly our case. Deliberately NOT the
 *  400/500 ms platform long-press: no peer uses that for this control. */
export const ACTIVATE_MS = 150;

/** Movement that disqualifies a tap / commits the axis, px. R69 §4.1 [V] — AOSP `TOUCH_SLOP = 8` dp
 *  (iOS's 10 pt agrees to within a thumb). Telegram Web's zero slop is too strict for a thumb. */
export const SLOP_PX = 8;

/** Upward travel that LOCKS hands-free, px. R69 §1.4 [V] — Telegram's `dp(57)`, reachable in one thumb
 *  flick from a bottom-right button (Signal's 150 dp is a deliberate arm movement; field split, pinned). */
export const LOCK_PX = 56;

/** Slide-to-cancel full distance = this share of the viewport width… R69 §1.3 [V]
 *  (`sizeNotifierLayout.getMeasuredWidth() * 0.35`). */
export const CANCEL_SHARE = 0.35;
/** …capped here, px. R69 §1.3 [V] (`if (distCanMove > dp(140)) distCanMove = dp(140)`). The RELATIVE
 *  form is the whole point: at the owner's 360 px phone a fixed 140 px from a right-edge button leaves
 *  almost no travel (R69 risk 8). */
export const CANCEL_MAX_PX = 140;
/** Releasing past this share of the cancel distance IS a cancel. R69 §1.3 [V] — Telegram's softer
 *  `ACTION_UP` threshold (`alpha < 0.45`, i.e. 55% of the way there). "Most of the way there" must not
 *  send. */
export const CANCEL_RELEASE = 0.55;

/** The lock hint's budget: at most this many shows on this device. R69 §1.7 [V]
 *  (`if (SharedConfig.lockRecordAudioVideoHint < 3)`). */
export const LOCK_HINT_MAX = 3;
/** …and a show only COUNTS once the hint is fully visible, ms after it is armed. R69 §1.7 [V] —
 *  Telegram's 200 ms delay + 150 ms fade, and its rule that a hint the user never saw is not spent.
 *  ⚠ Keep in lockstep with `.mg-hint`'s delay+duration in kit.css. */
export const LOCK_HINT_COUNT_MS = 350;
/** How long a transient mode hint ("Hold to record") stands, ms. The hint is the whole teaching budget
 *  for the tap arm (R69 §1.7's economy), so it must outlast a glance without becoming furniture. */
export const HINT_MS = 1600;

/** How long the standing "Start call" chip stays tappable after a call-mode release, ms — the tap twin
 *  WCAG 2.5.1 requires for a path-based commit (R69 §8.2, LIVE_VOICE_PLAN §6's "~2 s"). */
export const CHIP_MS = 2000;

/** How long a pointer-derived `click` is swallowed after the pointer session ends, ms. R69 §5.4 [V]:
 *  a `click` is STILL dispatched to the capturing target after `lostpointercapture`, so the pointer
 *  machine owns "tap" and this guard keeps `onClick` for the keyboard alone. Same 50 ms
 *  `CLICK_GUARD_MS` the house drag gesture uses. */
export const CLICK_GUARD_MS = 50;

/** Haptic durations, ms. R69 §2 [V] (Signal's 20/20/50) merged with §1.2/§1.4's toggle+lock buzzes.
 *  ALL DECORATIVE — see `buzz`. */
const VIB_START_MS = 20;
const VIB_CATCH_MS = 20;
const VIB_CANCEL_MS = 50;

/** Decorative haptics only (R69 §7 [V] / risk 3): on Firefox for Android `navigator.vibrate()` RETURNS
 *  TRUE and does nothing, and there is no feature detection that can tell — so every buzz here strictly
 *  accompanies a state change the UI has already painted, and the return value is never consulted. */
function buzz(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no Vibration API — the visible state change is the real signal */
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE PURE MACHINE
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Which destination the one button currently points at. NO MEMORY (owner ruling, overriding R69 §9's
 *  persistence row): it boots `mic` on every load, so it is component state and nothing persists it. */
export type MicMode = "mic" | "call";

/** The gesture's stages — six, and nothing implied:
 *   · `idle`    — nothing in flight.
 *   · `press`   — down, before the 150 ms activation. The stage a TAP lives and dies in.
 *   · `hold`    — recording, finger down. Slide left cancels, swipe up locks.
 *   · `locked`  — recording hands-free. The button is tap-to-stop, and the tools trigger at the other
 *                 end of the controls row has morphed into a real CANCEL button (OF-5).
 *   · `callArm` — call mode held: the "slide up to call" pill is up, committing on RELEASE.
 *   · `chip`    — a call-mode release without the swipe left a standing, tappable "Start call" chip. */
export type GestureStage = "idle" | "press" | "hold" | "locked" | "callArm" | "chip";

/** The axis the gesture HARD-LOCKED to on leaving the slop (delta round F6, Signal's rule over
 *  Telegram's softer one): a diagonal thumb arc can otherwise cross the lock line AND the cancel
 *  distance, leaving the outcome to handler order. `null` = still inside the slop. */
export type GestureAxis = null | "x" | "y";

export interface MicGestureState {
  stage: GestureStage;
  /** The pointer this gesture belongs to; `-1` once the gesture no longer has one (after a lock, where
   *  the locking pointer's own release must do nothing — R69 §1.5). */
  pid: number;
  /** The mode the gesture is RUNNING in — snapshotted at pointerdown so a mode flip mid-gesture (there
   *  is no way to cause one, but the machine should not depend on that) cannot change its meaning. */
  mode: MicMode;
  t0: number;
  x0: number;
  y0: number;
  axis: GestureAxis;
  dx: number;
  dy: number;
  /** The cancel distance measured for THIS gesture — re-measured per gesture, never cached, because
   *  rotation and the address bar both move the viewport (R69 §1.3/risk 8). */
  cancelDist: number;
  /** The gesture has left the slop at least once. Suppresses the lock hint, which teaches only the
   *  gesture that has not started yet (R69 §1.7: `moveProgress < 0.8f`). */
  moved: boolean;
}

export type MicSignal =
  | {
      type: "down";
      pid: number;
      t: number;
      x: number;
      y: number;
      mode: MicMode;
      cancelDist: number;
    }
  | { type: "activate" }
  | { type: "move"; pid: number; x: number; y: number }
  | { type: "up"; pid: number; t: number }
  | { type: "pointercancel"; pid: number }
  /** Keyboard/AT activation (R69 §8.1) — starts hands-free by construction: there is no hand to free. */
  | { type: "keyStart" }
  | { type: "keyStop" }
  /** The recording ended without the gesture: the silence auto-stop, the hidden-page rule, a recorder
   *  error, a declined permission. The machine must not keep painting a circle over a closed mic. */
  | { type: "stopped" }
  /** The visible CANCEL — the tap twin every gesture affordance grows once the hand is free. Since the
   *  feel round it is the MORPHED tools trigger rather than a floating button (OF-5); the signal is the
   *  same, and the machine neither knows nor cares which control sent it. */
  | { type: "cancelTap" }
  | { type: "escape" }
  | { type: "chipExpire" };

/** What the wiring must DO about a transition. Semantic, never imperative: haptics are derived from
 *  these in one place rather than being outcomes of their own. */
export type MicOut = "start" | "stop" | "cancel" | "lock" | "tap" | "callCommit" | "callChip";

export const MIC_IDLE: MicGestureState = {
  stage: "idle",
  pid: -1,
  mode: "mic",
  t0: 0,
  x0: 0,
  y0: 0,
  axis: null,
  dx: 0,
  dy: 0,
  cancelDist: 0,
  moved: false,
};

/** The full slide-left distance for a gesture starting at this viewport width (R69 §1.3's relative
 *  form). Pure + exported: the machine takes it as a signal field so a test can state the viewport
 *  instead of faking `window`. */
export function cancelDistance(viewportWidth: number): number {
  return Math.min(viewportWidth * CANCEL_SHARE, CANCEL_MAX_PX);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 0…1 toward the slide-left cancel commit — what the track renders and what the release rule reads.
 *  Zero unless the gesture committed to the X axis (F6). */
export function cancelProgress(s: MicGestureState): number {
  if (s.axis !== "x" || s.cancelDist <= 0) return 0;
  return clamp01(-s.dx / s.cancelDist);
}

/** 0…1 toward the 56 px lock / call threshold. Zero once the gesture committed to the X axis (F6). */
export function liftProgress(s: MicGestureState): number {
  if (s.axis === "x") return 0;
  return clamp01(-s.dy / LOCK_PX);
}

/** Fold one move into the state: track the travel, and commit the dominant axis the first time the
 *  gesture leaves the slop. Shared by `hold` and `callArm` so the two legs cannot drift apart. */
function advance(s: MicGestureState, x: number, y: number): MicGestureState {
  const dx = x - s.x0;
  const dy = y - s.y0;
  const out = Math.hypot(dx, dy) > SLOP_PX;
  return {
    ...s,
    dx,
    dy,
    moved: s.moved || out,
    // ONCE committed, never re-evaluated — that is the whole point of F6.
    axis: s.axis ?? (out ? (Math.abs(dx) > Math.abs(dy) ? "x" : "y") : null),
  };
}

interface MicStep {
  state: MicGestureState;
  out: MicOut[];
}

const step = (state: MicGestureState, ...out: MicOut[]): MicStep => ({ state, out });

/**
 * The machine, pure. The arms that carry the design, in one place:
 *   · a release still in `press`, inside the activation window and inside the slop, is a TAP;
 *   · `hold` cancels the INSTANT the slide reaches full distance (no release needed, R69 §1.3) and
 *     locks the INSTANT it crosses 56 px (latch on crossing, R69 §1.4) — but only on its committed axis;
 *   · `pointercancel` mid-recording PROMOTES TO LOCKED. It is the one rule the field is unanimous on
 *     never breaking (R69 §1.5/risk 2): an OS-level interruption may not silently destroy audio;
 *   · call mode commits on RELEASE, not on crossing — a recorded deviation from the lock's latch
 *     (LIVE_VOICE_PLAN §6): a call costs more to undo than a lock, so it keeps a slide-back-down escape.
 */
export function micReduce(s: MicGestureState, sig: MicSignal): MicStep {
  switch (sig.type) {
    case "down":
      // While the STANDING CHIP is up, the BUTTON IS INERT (LIVE_VOICE_PLAN §6's exact words: the
      // chip "owns its tap (= start call, the button inert until the chip expires)"): starting the
      // call belongs to the chip's OWN tap (`onChipTap`, a real button committing on click), never
      // to this pointer's down-event — the same no-down-event-commits rule `locked` honors below.
      if (s.stage === "chip") return step(s);
      // A LOCKED recording owns its tap too — but the tap completes on the UP event (WCAG 2.5.2's
      // "no down-event"), so a fresh pointer is merely adopted here — and only while the stop is still
      // UNOWNED (`pid === -1`). A second finger landing on an already-adopted button must not hijack
      // which release ends the recording (F3).
      if (s.stage === "locked") return step(s.pid === -1 ? { ...s, pid: sig.pid } : s);
      // A second finger never joins a gesture in flight: the captured pointer owns it.
      if (s.stage !== "idle") return step(s);
      return step({
        ...MIC_IDLE,
        stage: "press",
        pid: sig.pid,
        mode: sig.mode,
        t0: sig.t,
        x0: sig.x,
        y0: sig.y,
        cancelDist: sig.cancelDist,
      });

    case "activate":
      if (s.stage !== "press") return step(s);
      // Recording starts AT activation (R69 §1.1) — call mode raises its pill instead and records
      // nothing, because a call is committed on release.
      return s.mode === "call"
        ? step({ ...s, stage: "callArm" })
        : step({ ...s, stage: "hold" }, "start");

    case "move": {
      if (sig.pid !== s.pid) return step(s);
      if (s.stage === "press") {
        // Pre-activation travel still matters: it is what disqualifies the release from being a tap.
        return step(advance(s, sig.x, sig.y));
      }
      if (s.stage === "hold") {
        const next = advance(s, sig.x, sig.y);
        if (next.axis === "x" && cancelProgress(next) >= 1) return step(MIC_IDLE, "cancel");
        if (next.axis === "y" && -next.dy >= LOCK_PX)
          return step({ ...next, stage: "locked", pid: -1 }, "lock");
        return step(next);
      }
      if (s.stage === "callArm") return step(advance(s, sig.x, sig.y));
      return step(s);
    }

    case "up": {
      if (sig.pid !== s.pid) return step(s);
      if (s.stage === "press") {
        const tap = sig.t - s.t0 < ACTIVATE_MS && Math.hypot(s.dx, s.dy) <= SLOP_PX;
        return tap ? step(MIC_IDLE, "tap") : step(MIC_IDLE);
      }
      if (s.stage === "hold") {
        return cancelProgress(s) >= CANCEL_RELEASE
          ? step(MIC_IDLE, "cancel")
          : step(MIC_IDLE, "stop");
      }
      if (s.stage === "callArm") {
        return liftProgress(s) >= 1
          ? step(MIC_IDLE, "callCommit")
          : step({ ...s, stage: "chip", pid: -1 }, "callChip");
      }
      // `locked` with an adopted pointer = the tap twin of tap-to-stop. `pid === -1` is the LOCKING
      // pointer's own release, which must do nothing at all (R69 §1.5).
      if (s.stage === "locked") return step(MIC_IDLE, "stop");
      return step(s);
    }

    case "pointercancel": {
      if (sig.pid !== s.pid) return step(s);
      // THE IRON RULE. A recording in flight is promoted, never discarded — and when the cancel lands
      // during `getUserMedia` (we are in `hold` from activation, the stream is still opening) this is
      // exactly the latch that makes the arriving recording a LOCKED one (delta round F5).
      if (s.stage === "hold") return step({ ...s, stage: "locked", pid: -1 }, "lock");
      // `press` has nothing recorded yet; `callArm` has started no call. Both simply end.
      if (s.stage === "press" || s.stage === "callArm") return step(MIC_IDLE);
      return step(s);
    }

    case "keyStart":
      if (s.stage !== "idle") return step(s);
      // There is no hand to free: keyboard activation IS the hands-free state, so the CANCEL twin and
      // the Esc key are live from the first keystroke (R69 §8.1/§9's conformance set).
      return step({ ...MIC_IDLE, stage: "locked", mode: s.mode }, "start");

    case "keyStop":
      return step(MIC_IDLE, "stop");

    case "cancelTap":
      if (s.stage !== "hold" && s.stage !== "locked") return step(s);
      return step(MIC_IDLE, "cancel");

    case "escape":
      if (s.stage === "hold" || s.stage === "locked") return step(MIC_IDLE, "cancel");
      if (s.stage === "idle") return step(s);
      return step(MIC_IDLE);

    case "stopped":
      if (s.stage === "hold" || s.stage === "locked") return step(MIC_IDLE);
      return step(s);

    case "chipExpire":
      return s.stage === "chip" ? step(MIC_IDLE) : step(s);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE WIRING
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Where the chrome paints, in the chrome host's own coordinates: the mic button's centre and its
 *  diameter. Measured ONCE per gesture from the pressed button (the `useDragReorder` measure-at-lift
 *  rule) — never a `getBoundingClientRect()` loop per move. */
export interface MicAnchor {
  cx: number;
  cy: number;
  size: number;
  /** The button centre's distance from the host's RIGHT edge. The hint BUBBLE is right-anchored (a
   *  sentence centred on a button ~24px from the bar's trailing edge runs off-screen), so its TAIL —
   *  which has to point at the button — needs the one number CSS cannot derive from `cx` alone: where
   *  the bubble's own right edge is. Same measurement, same moment, no second layout read. */
  rx: number;
}

/** Everything `<MicGestureChrome/>` renders off. One object so the three variants pass one prop. */
export interface MicChrome {
  hostRef: RefObject<HTMLDivElement | null>;
  stage: GestureStage;
  mode: MicMode;
  anchor: MicAnchor;
  /** 0…1 toward the slide-left cancel — the track follows the finger continuously (R69 §1.3). */
  cancel: number;
  /** 0…1 toward the lock / call threshold. */
  lift: number;
  /** The circle's live horizontal travel, px (≤ 0) — the track FOLLOWS THE FINGER (R69 §1.3's
   *  continuous progress feedback, which is the whole reason the relative form was chosen). Zero
   *  unless the gesture committed to the X axis. */
  dragX: number;
  /** The gesture has left the slop: the chevron oscillation stops once the drag it describes begins. */
  moved: boolean;
  /** The budgeted "slide up to lock" hint is due (≤3 shows, retired forever on the first lock). */
  showLockHint: boolean;
  /** A transient mode hint, or null. */
  hint: string | null;
  onChipTap: () => void;
}

export interface MicGesture {
  /** The button's brief pressed look — the JS-toggled class the kit has always used here rather than
   *  CSS `:active`, which Fennec leaves wedged after a tap. */
  pressing: boolean;
  /** `aria-label` + `title`: the MODE rides the accessible NAME, and there is no `aria-pressed` — both
   *  Telegram clients independently, and R69 §8.3's ruling for a dual-destination control. */
  label: string;
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLButtonElement>) => void;
    onContextMenu: (e: ReactMouseEvent<HTMLButtonElement>) => void;
    onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  };
  chrome: MicChrome;
}

/**
 * Wire the gesture to the one dictation recorder.
 *
 * @param mic   the `useDictation` controller (`useComposer().mic`) — start/stop/cancel/toggle.
 * @param live  whether call mode is offered at all (`useComposer().liveReady`). False until S1.
 */
export function useMicGesture(mic: ReturnType<typeof useDictation>, live: boolean): MicGesture {
  const [state, setState] = useState<MicGestureState>(MIC_IDLE);
  // The SYNCHRONOUS read every handler uses (the `phaseRef` idiom): a pointermove landing before React
  // has re-rendered must still see the transition the previous event caused.
  const stateRef = useRef(state);
  const [mode, setMode] = useState<MicMode>("mic"); // no memory — boots `mic` every load (owner ruling)
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [anchor, setAnchor] = useState<MicAnchor>({ cx: 0, cy: 0, size: 0, rx: 0 });
  const [hint, setHint] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const activateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const guardTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** True while a pointer session owns this button — the swallow that keeps `onClick` keyboard-only. */
  const pointerSession = useRef(false);
  /** Which `start()` attempt is the CURRENT one (F1). `useDictation.start` resolves asynchronously, so
   *  an attempt that was aborted by its own release can resolve `false` long after a NEXT gesture has
   *  begun — and its close-out would then idle a recording that is running perfectly well. Every
   *  dispatch takes a generation; only the latest one may close the gesture out. */
  const startGen = useRef(0);

  // The controller, read through a ref so the callbacks below do not re-identify on every render (its
  // `toggle`/`start` re-bind with the mic's phase). Assigned during render, the same idiom LineComposer
  // uses for its latch refs: the handlers never fire mid-render, so they always read the current one.
  const micRef = useRef(mic);
  micRef.current = mic;

  const hintsShown = useUISlice((s) => s.micLockHintShown);
  const hintRetired = useUISlice((s) => s.micLockHintRetired);

  const flashHint = useCallback((text: string) => {
    setHint(text);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), HINT_MS);
  }, []);

  // The call commit — all three doors (the swipe-up commit, the standing chip's tap, the keyboard
  // activation) land on the STORE's `startCall`, and every one of them is INSIDE a user gesture. The
  // door itself (dismiss → prime → open, in that order, and the redial that rides it) lives there
  // because it is no longer only this gesture's: the terminal face's "Call again" is the second caller.

  // A NAMED function expression so the two self-scheduling outcomes (`start`'s failure close-out and
  // the chip's expiry) can re-enter the machine by the function's own name rather than through the
  // `const` they are being assigned to.
  const send = useCallback(
    function send(sig: MicSignal): void {
      const { state: next, out } = micReduce(stateRef.current, sig);
      if (next !== stateRef.current) {
        stateRef.current = next;
        setState(next);
      }
      for (const o of out) {
        switch (o) {
          case "start": {
            buzz(VIB_START_MS);
            // The affordance is already painted; if the mic never actually opens (permission declined,
            // no usable container, or the F5 abort), close it rather than leave a circle over a mic
            // that is not recording — but ONLY while this is still the gesture that asked (F1).
            const gen = ++startGen.current;
            void micRef.current.start().then((armed) => {
              if (!armed && gen === startGen.current) send({ type: "stopped" });
            });
            break;
          }
          case "stop":
            micRef.current.stop();
            break;
          case "cancel":
            buzz(VIB_CANCEL_MS);
            micRef.current.cancel();
            break;
          case "lock":
            buzz(VIB_CATCH_MS);
            // ONE successful lock retires the hint permanently (R69 §1.7).
            if (!getUI().micLockHintRetired) setUI({ micLockHintRetired: true });
            break;
          case "tap":
            // Tap = mode switch, FROM IDLE ONLY — but only when there is a second mode to switch to.
            // With the `live` bit down there is one mode, so the tap spends the teaching budget
            // instead of doing nothing (LIVE_VOICE_PLAN §6, ruling 5).
            if (live) {
              const to: MicMode = modeRef.current === "mic" ? "call" : "mic";
              setMode(to);
              flashHint(to === "call" ? "Hold to call" : "Hold to record");
            } else {
              flashHint("Hold to record");
            }
            break;
          case "callCommit":
            buzz(VIB_CATCH_MS);
            startCall();
            break;
          case "callChip":
            clearTimeout(chipTimer.current);
            chipTimer.current = setTimeout(() => send({ type: "chipExpire" }), CHIP_MS);
            break;
        }
      }
    },
    [live, flashHint],
  );

  /** Measure the pressed button against the chrome host — at the start of the gesture, and again
   *  whenever the tracking effect below sees the geometry move (the button ref is what lets it). */
  const anchorBtn = useRef<HTMLElement | null>(null);
  const measure = useCallback((btn: HTMLElement) => {
    const host = hostRef.current;
    if (!host) return;
    anchorBtn.current = btn;
    const b = btn.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    const cx = b.left + b.width / 2;
    setAnchor({
      cx: cx - h.left,
      cy: b.top + b.height / 2 - h.top,
      size: Math.max(b.width, b.height),
      rx: h.right - cx,
    });
  }, []);

  /** THE ANCHOR TRACKS THE BUTTON while the chrome stands FINGER-FREE (the owner's live round,
   *  2026-09-14; the review's F2 scoped it). Measure-once assumed a short hold over a STATIC bar,
   *  and S2.5 broke the premise: a streaming recording is LONG, and the bar moves under it — the
   *  keyboard collapses at record start, and the field auto-grows as phrases append — so the circle
   *  painted where the button USED to be ("two mic buttons", the owner's phone round).
   *
   *  ONLY `locked`/`chip` track (F2): while a FINGER owns the gesture the chrome is finger-relative
   *  by design (`dragX`/lift ride pointer deltas from the down coordinates), and re-anchoring under
   *  a stationary finger would teleport the circle away from the touch — the affordance must never
   *  detach from the hand that holds it. The moment the hand lets go (a lock, or the standing call
   *  chip) the chrome is button-relative, and the effect's own first `remeasure()` recovers
   *  whatever moved during the held stages.
   *
   *  EVENT-driven, never a per-move rect loop (the measure-at-lift rule's letter was about
   *  pointermove): `visualViewport` resize = the keyboard · a ResizeObserver on the BAR
   *  (`.kit-composer` — the review's F1: the HOST is `.kit-main`, whose box does NOT change when
   *  the bottom-anchored bar grows upward) plus the host (pane-level changes) · window resize =
   *  rotation — the S2b call ring's F9 pattern, one layer down. Coalesced through one rAF so a
   *  burst of observer callbacks costs one layout read; the button-gone guard makes a mid-teardown
   *  fire a no-op. */
  const tracking = state.stage === "locked" || state.stage === "chip";
  useEffect(() => {
    if (!tracking) return;
    let raf = 0;
    const remeasure = () => {
      raf ||= requestAnimationFrame(() => {
        raf = 0;
        const btn = anchorBtn.current;
        if (btn?.isConnected) measure(btn);
      });
    };
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(remeasure);
    if (ro) {
      const bar = anchorBtn.current?.closest(".kit-composer");
      if (bar) ro.observe(bar);
      if (hostRef.current) ro.observe(hostRef.current);
    }
    const vv = window.visualViewport;
    vv?.addEventListener("resize", remeasure);
    window.addEventListener("resize", remeasure);
    // The catch-up read: geometry that moved while a finger owned the stages (the keyboard
    // collapsing during the hold that became this lock) is recovered the moment tracking arms.
    remeasure();
    return () => {
      ro?.disconnect();
      vv?.removeEventListener("resize", remeasure);
      window.removeEventListener("resize", remeasure);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [tracking, measure]);

  /** Swallow the trailing `click` this pointer session will produce. RE-ASSERTS the session rather than
   *  only scheduling its expiry (F3): ANY pointer that went down on the button produces a click, so a
   *  second finger's release re-arms the guard — and if that release had merely re-scheduled the expiry
   *  it would leave the flag already false, opening the keyboard door to the owning finger's own
   *  trailing click. Called from every button-pointer up/cancel, foreign pointers included. */
  const armClickGuard = useCallback(() => {
    pointerSession.current = true;
    clearTimeout(guardTimer.current);
    guardTimer.current = setTimeout(() => {
      pointerSession.current = false;
    }, CLICK_GUARD_MS);
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button > 0) return; // secondary mouse buttons are not this gesture
      pointerSession.current = true;
      clearTimeout(guardTimer.current);
      // THE DEGRADED STATE, preserved exactly (owner-locked UX): with no secure context the mic can
      // never capture, and a press re-explains the fix through the SAME path the tap used to take.
      if (micRef.current.status === "insecure") {
        micRef.current.toggle();
        armClickGuard();
        return;
      }
      measure(e.currentTarget);
      try {
        // Belt-and-braces: touch gets implicit capture (PE L3 §4.1.3), the mouse does not (R69 §5.2).
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic pointer, or one already gone — the machine works without capture */
      }
      // Whether THIS down is the one that can create a press — a second finger landing during someone
      // else's press finds the machine unchanged, and must not re-arm (i.e. restart) its timer (F3).
      const wasIdle = stateRef.current.stage === "idle";
      send({
        type: "down",
        pid: e.pointerId,
        t: e.timeStamp,
        x: e.clientX,
        y: e.clientY,
        mode: modeRef.current,
        // RE-MEASURED per gesture (R69 §1.3): rotation and the address bar both move the viewport.
        cancelDist: cancelDistance(window.innerWidth || 0),
      });
      if (wasIdle && stateRef.current.stage === "press") {
        clearTimeout(activateTimer.current);
        activateTimer.current = setTimeout(() => send({ type: "activate" }), ACTIVATE_MS);
      }
    },
    [send, measure, armClickGuard],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (stateRef.current.pid !== e.pointerId) return;
      send({ type: "move", pid: e.pointerId, x: e.clientX, y: e.clientY });
    },
    [send],
  );

  // ONLY THE OWNING POINTER'S RELEASE TOUCHES THE GESTURE (F3): a foreign finger's up/cancel is not
  // allowed to clear the activation timer the owner is counting on (the machine already ignores its
  // signal, so the `send` is skipped as a no-op rather than because it would be harmful). The click
  // guard is the deliberate exception — it arms for EVERY pointer that went down on the button,
  // because every one of them produces a trailing click. (After a lock the state's pid is −1, so the
  // locking pointer's own release also takes the no-send path — which is exactly R69 §1.5's rule.)
  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (stateRef.current.pid === e.pointerId) {
        clearTimeout(activateTimer.current);
        send({ type: "up", pid: e.pointerId, t: e.timeStamp });
      }
      armClickGuard();
    },
    [send, armClickGuard],
  );

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (stateRef.current.pid === e.pointerId) {
        clearTimeout(activateTimer.current);
        send({ type: "pointercancel", pid: e.pointerId });
      }
      armClickGuard();
    },
    [send, armClickGuard],
  );

  /** R69 §6 [V] — long-press raises the context menu (and, with it, the selection magnifier) on both
   *  Android browsers. Cancelling it has been safe on Fennec since Fx 91 (bug 1481923 FIXED), and the
   *  S0 device probes confirmed it must STAY cancelled: it fires on the button during a real hold. */
  const onContextMenu = useCallback((e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
  }, []);

  /**
   * THE KEYBOARD DOOR — the ONE thing `onClick` is still for.
   *
   * R69 risk 5 [V]: a `click` is still dispatched to the capturing target after `lostpointercapture`,
   * so binding tap to `onClick` beside the pointer machine double-fires. The pointer machine therefore
   * owns "tap" outright, and this handler swallows every click that a pointer session produced. What
   * survives is activation with NO pointer session — Enter/Space on the focused button, or an
   * assistive-technology "click" action — which runs the current mode toggle-style: exactly the
   * Telegram-Web degradation R69 §8.1 verified as the shipped alternative (tap-toggle + Esc, no hold).
   */
  const onClick = useCallback(
    (e: ReactMouseEvent<HTMLButtonElement>) => {
      if (pointerSession.current) return;
      if (modeRef.current === "call") {
        startCall();
        return;
      }
      if (micRef.current.status === "recording") {
        send({ type: "keyStop" });
        return;
      }
      // A keyboard session never ran `onPointerDown`, so the anchor was never measured — and the
      // locked circle + CANCEL twin about to paint position off it. Measure from the activating
      // button, or the chrome lands at the host's 0,0 (main-seat audit F-B).
      measure(e.currentTarget);
      send({ type: "keyStart" });
    },
    [send, measure],
  );

  // ESC CANCELS while a recording is up (R69 §8.1's other half — Telegram Web's `captureEscKeyListener`).
  const gesturing = state.stage !== "idle";
  useEffect(() => {
    if (!gesturing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") send({ type: "escape" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [gesturing, send]);

  // THE RECORDING CAN END WITHOUT THE GESTURE — the silence auto-stop, the hidden-page rule, a recorder
  // error. `useDictation`'s status is the authority on "is there a recording", so it closes the gesture
  // rather than leaving a hands-free circle painted over a mic that stopped. (Keyed on the status alone:
  // an optimistic `locked` set while the status has not moved yet does not re-run this.)
  const micStatus = mic.status;
  useEffect(() => {
    const stage = stateRef.current.stage;
    if ((stage === "hold" || stage === "locked") && micStatus !== "recording") {
      send({ type: "stopped" });
    }
    // …and the live level goes with it (OF-3). The meter stops being CALLED when the poll dies, which
    // would leave the last reading painted — so the next gesture would open on a stale bulge.
    if (micStatus !== "recording") hostRef.current?.style.setProperty("--mg-level", "0");
  }, [micStatus, send]);

  // THE TWO RECORDER SEAMS (feel round OF-3/OF-4), registered and withdrawn together in ONE effect: a
  // composer that unmounts must not leave a live handler pointing into its dead tree, and the next one
  // to mount must not inherit it. `mic.meter`/`mic.onTooShort` are refs, so their identities are stable
  // for the recorder's life and this runs exactly once per mount.
  const meterRef = mic.meter;
  const tooShortRef = mic.onTooShort;
  const pendingRef = mic.onPending;
  useEffect(() => {
    // THE LEVEL IS WRITTEN STRAIGHT TO THE DOM. It arrives at 10 Hz; routing it through state would
    // re-render the composer, the gesture chrome and every control beside them ten times a second for
    // a decoration. One custom property on the chrome host is what every rule in kit.css reads.
    meterRef.current = (level: number) => {
      hostRef.current?.style.setProperty("--mg-level", String(level));
    };
    // The too-short teaching, moved out of the toast rail and into the gesture's own bubble — the copy
    // is still `useDictation`'s (one string), and so is the RULE that fires it.
    tooShortRef.current = () => flashHint(TOO_SHORT_MSG);
    // S2.5 / R70 §7 — "A PHRASE IS PENDING", the one thing the S0.5 vocabulary did not already own.
    // Claude Code's answer (dimmed text firming up) is unavailable to us: we have no partial to dim.
    // So it lands on the mic chrome, where the eye already is, and never on the text layer — one DOM
    // attribute, painted by kit.css, GESTURE MACHINE UNTOUCHED (it is not a stage; a pending phrase
    // changes nothing about what the button does). Same imperative write as the level, for the same
    // reason: this must not re-render the composer subtree every couple of seconds.
    pendingRef.current = (pending: boolean) => {
      const host = hostRef.current;
      if (!host) return;
      if (pending) host.dataset.pending = "1";
      else delete host.dataset.pending;
    };
    return () => {
      meterRef.current = null;
      tooShortRef.current = null;
      pendingRef.current = null;
    };
  }, [meterRef, tooShortRef, pendingRef, flashHint]);

  // THE LOCKED CANCEL, PUBLISHED (OF-5). While the gesture is `locked` — by a swipe or by the keyboard
  // path, which is locked from its first keystroke — the tools/skills trigger at the composer's other
  // end MORPHS into this cancel. It is composed in DefaultRoot and cannot see this hook, so the offer
  // travels through `store/micCancel`. Withdrawn on leaving the stage AND on unmount (the cleanup is
  // both), so a dead composer never leaves a live morph.
  const locked = state.stage === "locked";
  useEffect(() => {
    if (!locked) return;
    setMicCancel(() => send({ type: "cancelTap" }));
    return () => setMicCancel(null);
  }, [locked, send]);

  // S2.5 — WHOSE TIMEOUT IS THE FINGER (§9.3-c). The streaming idle stop must not run during a `hold`:
  // the hand is on the button, and a pause is the whole point of phrase dictation. `locked` — reached
  // by the swipe OR from the first keystroke, which has no hand to free — is the hands-free state that
  // clock exists for. An assignable ref like the meter, written from the one place that knows the
  // stage; cleared on unmount so a dead composer never leaves a recording looking hands-free.
  const handsFreeRef = mic.handsFree;
  useEffect(() => {
    handsFreeRef.current = locked;
    return () => {
      handsFreeRef.current = false;
    };
  }, [locked, handsFreeRef]);

  // Call mode is offered only while the `live` bit is up; if it goes down under us, fall back to mic —
  // and CLOSE anything call mode had in flight first (F5). Repainting the mode alone would leave a
  // `callArm` still committing on release, or a standing chip still tappable, into a call the backend
  // just said it cannot take. `escape` is the existing signal for exactly this (every closed stage
  // folds to MIC_IDLE with no outcomes), so no new reducer vocabulary is needed. A call-mode `press`
  // is in the list too (the confirm round's sweep): its SNAPSHOTTED mode would otherwise carry the
  // still-armed activation timer straight into `callArm` after the bit fell.
  useEffect(() => {
    if (live) return;
    const s = stateRef.current;
    if (s.stage === "callArm" || s.stage === "chip" || (s.stage === "press" && s.mode === "call")) {
      clearTimeout(chipTimer.current);
      send({ type: "escape" });
    }
    setMode("mic");
  }, [live, send]);

  // THE HINT BUDGET (R69 §1.7): the "slide up to lock" hint shows while the gesture has not started
  // moving, at most three times per device, and a show is SPENT only once the hint is fully visible —
  // a hint the owner never saw does not count. One successful lock retires it forever (in `send`).
  const showLockHint =
    state.stage === "hold" && !state.moved && !hintRetired && hintsShown < LOCK_HINT_MAX;
  useEffect(() => {
    if (!showLockHint) return;
    const t = setTimeout(
      () => setUI({ micLockHintShown: getUI().micLockHintShown + 1 }),
      LOCK_HINT_COUNT_MS,
    );
    return () => clearTimeout(t);
  }, [showLockHint]);

  useEffect(
    () => () => {
      clearTimeout(activateTimer.current);
      clearTimeout(chipTimer.current);
      clearTimeout(hintTimer.current);
      clearTimeout(guardTimer.current);
    },
    [],
  );

  const onChipTap = useCallback(() => {
    clearTimeout(chipTimer.current);
    send({ type: "chipExpire" });
    startCall();
  }, [send]);

  return {
    pressing: state.stage === "press",
    label: micLabel(mic.status, mode),
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onContextMenu,
      onClick,
    },
    chrome: {
      hostRef,
      stage: state.stage,
      mode,
      anchor,
      cancel: cancelProgress(state),
      lift: liftProgress(state),
      dragX: state.axis === "x" ? Math.max(-state.cancelDist, Math.min(0, state.dx)) : 0,
      moved: state.moved,
      showLockHint,
      hint,
      onChipTap,
    },
  };
}
