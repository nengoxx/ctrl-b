// THE LOCKED RECORDING'S CANCEL, published for a control that is composed somewhere else (Phase 24 /
// S0.5 feel round OF-5, owner 2026-09-13).
//
// WHY A STORE AND NOT A PROP. While a hold-to-record is LOCKED the hand is free, so WCAG 2.5.1 wants a
// real, single-pointer cancel — and the owner's ruling is that it should be the control already sitting
// at the composer's other end: the tools/skills trigger MORPHS into it (sliders → ✕) rather than a
// second floating button appearing. But `ToolsMenuTrigger` is composed ONCE, in DefaultRoot's slot
// merge, and has no access to any composer variant's gesture instance. One module-level slot is the
// smallest thing that joins them — the same shape (and the same dep-free `createStore`, D23) that
// `composerOverlay.ts` uses for the same reason.
//
// LAST WRITER WINS, and that is safe by construction: exactly one composer VARIANT is mounted at a time
// (ThemedComposer resolves one), so there is only ever one gesture publishing here. The publisher clears
// the slot on leaving `locked` AND on unmount, so a dead composer can never leave a live morph behind.
//
// Deliberately NOT persisted and deliberately NOT a `{active, cancel}` pair: "is a cancel offered" is
// exactly "is there a cancel", and two fields that must agree is one more thing that can disagree.

import { createStore } from "./createStore";

const { emit, useStore } = createStore();
let cancel: (() => void) | null = null;

/** Offer `fn` as the live recording's cancel, or `null` to withdraw the offer. Idempotent. */
export function setMicCancel(fn: (() => void) | null): void {
  if (fn === cancel) return;
  cancel = fn;
  emit();
}

/** Run the offered cancel, if one stands. Safe to call at any time (the morphed button's `onClick`). */
export function runMicCancel(): void {
  cancel?.();
}

/** Whether a locked recording is offering a cancel right now — what the morphing control renders off. */
export function useMicCancelOffered(): boolean {
  return useStore(() => cancel !== null);
}
