// THE TAB'S CLIP-UPLOAD ACTIVITY (ISS-84 fix wave W1) — which attempt of a clip upload is running in
// this tab right now, or null. REACTIVE, unlike its neighbour `micRelease` (whose capture ownership is
// imperative by contract — nothing renders off it): the mic button must PAINT this. An upload loop can
// outlive the composer that started it (a tab switch unmounts it; a parked clip's Retry runs from a toast
// whose instance is dead), and a remounted composer's own phase cannot see it — so the spinner, the
// attempt label and ISS-83's door all read the TAB's truth from here, whichever instance renders.
//
// Its own module rather than a reactive half of `micRelease`: that file's header promises no
// `createStore` (no subscription anyone pays for), and this one exists only to be subscribed to.
//
// ONE SLOT with an OWNER: the tab's capture ownership already keeps two upload loops from overlapping
// (`captureOwned` refuses both a recording and a Retry while one runs), so a single value is the truth —
// but each write names its loop, and a clear from a loop that no longer holds the slot is ignored, so a
// stray late `finally` can never blank another loop's spinner.

import { createStore } from "./createStore";

/** The running attempt (1-based) of `of` total. Replaced, never mutated: it is the React snapshot. */
export interface UploadActivity {
  attempt: number;
  of: number;
}

const { emit, useStore } = createStore();
let current: { owner: object; value: UploadActivity } | null = null;

/** The loop `owner` is on `value` (an attempt starting), or — with `null` — has ended. */
export function publishUploadActivity(owner: object, value: UploadActivity | null): void {
  if (value === null) {
    if (current?.owner !== owner) return; // not this loop's slot (or already clear)
    current = null;
  } else {
    current = { owner, value };
  }
  emit();
}

/** The tab's upload activity, reactively (a stable reference per write). */
export function useUploadActivity(): UploadActivity | null {
  return useStore(() => current?.value ?? null);
}

/** TESTS ONLY — clear a slot a finished case left standing. Never called by the app. */
export function resetUploadActivity(): void {
  current = null;
  emit();
}
