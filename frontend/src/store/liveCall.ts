// IS A CALL UP? (Phase 24 / D71 §6) — one bit, published for a surface composed somewhere else.
//
// WHY A STORE AND NOT A PROP (the `micCancel.ts` reasoning, one surface over). The call is STARTED from
// the composer's mic button — one of three variants, mounted inside `.kit-main` — and the overlay it
// opens is a full-bleed layer that must mount at the SHELL's root, beside the toasts and the dialogs,
// because a composer-parented overlay is clipped by the composer's own bars (the `.mform`/sheet lesson
// the gesture chrome already learned). A module-level slot is the smallest thing that joins them.
//
// ONE VALUE, not an `{active, overlayMounted}` pair: "is a call up" is exactly "is the overlay
// mounted", and two fields that must agree is one more thing that can disagree. The MACHINE lives
// inside the overlay, so mounting is starting and unmounting is the whole teardown — there is no third
// state where a call exists without its screen. The value carries a GENERATION with it (S2b) for
// exactly the same reason it stays one value: a redial is "mount a fresh machine", which is a `key`
// change, which is this number.
//
// Deliberately NOT persisted: a reload ends a call (the session is the socket's, and the relay's own
// `max_sessions` slot is released when it drops). Booting into a dead call screen would be a lie.

import { dismiss, primeAudio } from "../lib/audioController";
import { createStore } from "./createStore";

const { emit, useStore } = createStore();
let requested = false;
/** The mounted machine's generation — bumped by a redial, which is what remounts the overlay. */
let seq = 0;

/**
 * THE CALL DOOR (D71 §6) — every way into a call comes through here, and every one of them is inside a
 * user gesture: the mic gesture's three commits (the swipe, the standing chip, the keyboard) and the
 * terminal face's "Call again".
 *
 * THE ORDER IS THE CONTRACT (micro-confirm №2's blocker): ① `dismiss()` — answering a call SILENCES
 * pre-call playback, and not only for the ear's sake: a session carried into the call can hold a status
 * the element isn't honoring (a pending forward SEEK parks an intent-only "playing" through a silent
 * synthesis gap), and the chunk landing mid-call would republish that same value — no edge, and §4.2's
 * iron-rule kill never fires. No session survives the door, so no phantom status can. ② `primeAudio()`
 * — the shared `<audio>` element is created lazily by whatever first wants to speak, which on mobile is
 * a timer and not a tap; priming must be here, inside the gesture, and must come AFTER the dismiss (on
 * a src-loaded element the prime's already-playing guard would skip the unlock). ③ open the overlay.
 *
 * REDIAL is the same door plus a REMOUNT. Called while a call is already up it bumps the generation,
 * and the shell's `key` turns that into a full teardown + a fresh machine — mounting IS starting, so
 * there is no second "restart" path to keep in step. The only way to reach it in that state is a
 * TERMINAL face (the gesture's mic button sits behind the overlay and is unreachable), where the
 * machine is already dead: its teardown ran when it landed on the terminal. And ① is load-bearing all
 * over again there — the interrupted reply's auto-TTS can have re-docked playback in the meantime.
 */
export function startCall(): void {
  dismiss();
  primeAudio();
  if (requested) seq++;
  requested = true;
  emit();
}

/** Close it. The overlay's unmount IS the call's teardown, so this is the only "end" anything needs. */
export function endCall(): void {
  if (!requested) return;
  requested = false;
  emit();
}

/** The overlay's mount key — `null` when no call is up. Read once, at the shell root: a changed number
 *  is a redial and remounts the machine. */
export function useCallMount(): number | null {
  return useStore(() => (requested ? seq : null));
}
