// ONE composer overlay at a time (A6). Three surfaces hover over the composer's top edge, all anchored off
// the same measured `--composer-h`: the PLAN sheet (the D30 `overlay` slot), the slash-SUGGEST popover (A2)
// and the tools/skills MENU (A6). Two of them showing at once overlaps — and the pairwise "opening X closes
// Y" rule A2 shipped (useComposerSuggest → setPlanSheetOpen(false)) needs a new edit in every surface for
// every surface added, so the third one is where that stops paying. The open state is CENTRALIZED here as a
// single OWNER slot: claiming it closes whoever held it, no surface knows about any other.
//
// Deliberately just a slot — no registry, no priorities, no focus management. Dep-free `createStore` (D23),
// module state, NOT persisted (an overlay must never be open on a cold boot).

import { createStore } from "./createStore";

/** The composer surfaces that compete for the overlay space above the composer. */
export type ComposerOverlay = "plan" | "suggest" | "menu";

const { emit, useStore } = createStore();
let owner: ComposerOverlay | null = null;

/** Give the overlay slot to `next` (or `null` to close whatever holds it). Idempotent. */
export function setComposerOverlay(next: ComposerOverlay | null): void {
  if (next === owner) return;
  owner = next;
  emit();
}

/** Close `which` — but ONLY if it still owns the slot. A surface that was already displaced must not
 *  clear the slot on its way down (that would close the surface which displaced it). */
export function releaseComposerOverlay(which: ComposerOverlay): void {
  if (owner === which) setComposerOverlay(null);
}

/** Open `which`, or close it if it's already the owner (the trigger-tap gesture). */
export function toggleComposerOverlay(which: ComposerOverlay): void {
  setComposerOverlay(owner === which ? null : which);
}

/** Read the current owner imperatively (non-reactive) — for callers outside render. */
export function getComposerOverlay(): ComposerOverlay | null {
  return owner;
}

/** Whether `which` currently owns the overlay slot. */
export function useComposerOverlayOpen(which: ComposerOverlay): boolean {
  return useStore(() => owner === which);
}
