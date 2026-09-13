// IS A CALL UP? (Phase 24 / D71 §6) — one bit, published for a surface composed somewhere else.
//
// WHY A STORE AND NOT A PROP (the `micCancel.ts` reasoning, one surface over). The call is STARTED from
// the composer's mic button — one of three variants, mounted inside `.kit-main` — and the overlay it
// opens is a full-bleed layer that must mount at the SHELL's root, beside the toasts and the dialogs,
// because a composer-parented overlay is clipped by the composer's own bars (the `.mform`/sheet lesson
// the gesture chrome already learned). A module-level slot is the smallest thing that joins them.
//
// ONE BIT, not a `{active, overlayMounted}` pair: "is a call up" is exactly "is the overlay mounted",
// and two fields that must agree is one more thing that can disagree. The MACHINE lives inside the
// overlay, so mounting is starting and unmounting is the whole teardown — there is no third state where
// a call exists without its screen.
//
// Deliberately NOT persisted: a reload ends a call (the session is the socket's, and the relay's own
// `max_sessions` slot is released when it drops). Booting into a dead call screen would be a lie.

import { createStore } from "./createStore";

const { emit, useStore } = createStore();
let requested = false;

/** Open the call overlay. Called from the mic gesture's call commit, INSIDE the user gesture (which is
 *  also where the `<audio>` element gets primed — see `primeAudio`). Idempotent: a second commit while a
 *  call is up is a no-op, not a redial. */
export function requestCall(): void {
  if (requested) return;
  requested = true;
  emit();
}

/** Close it. The overlay's unmount IS the call's teardown, so this is the only "end" anything needs. */
export function endCall(): void {
  if (!requested) return;
  requested = false;
  emit();
}

/** Whether the call overlay should be mounted — read once, at the shell root. */
export function useCallRequested(): boolean {
  return useStore(() => requested);
}
