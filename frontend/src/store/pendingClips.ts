// THE LOST-CLIP MARKER (ISS-84 part G — ASR_PLAN S8b's interrupted-clip marker, pulled forward; the
// car-wave design §2.3/§2.6, ruling 13 + 17). A clip whose upload is in trouble lives only in MEMORY (the
// upload loop, then its parked toast): a RELOAD or a tab kill loses it — and the loop is exactly the
// window a returning link pops the SW "refresh" toast into (`SwUpdatePrompt` reloads every tab on
// `controllerchange`). Recovering the clip is S8b's IndexedDB work; this slice only refuses to lose one
// SILENTLY: each troubled clip's id is written here, removed when it lands or is discarded, and a boot
// that finds any says so once.
//
// EVERY BOOT TAKES EVERY MARK (final wave X4): a FRESH PWA launch — the app swiped from recents, or
// killed and reopened, the common phone case and this marker's whole purpose — starts with new
// sessionStorage, so marks stamped per tab would match nothing there: the notice would never show and the
// marks would pile up. RECORDED LIMITATION: a second tab's boot consumes this tab's live marks (and says
// so for clips this tab may still land) — tabs are owned by S8b's persisted record, not by this marker.
//
// A SET OF IDS, not one flag (ruling 17): several clips can be parked at once, and one landing must not
// clear another's mark. Kept as an id-keyed OBJECT (`{[id]: markedAt}`) rather than an array,
// because the `persist.ts` helpers speak objects — `patchPersisted` adds or removes ONE key against a
// fresh read, so two clips (or two tabs) never re-persist each other's stale copy, and a key patched to
// `undefined` is removed. Every storage access rides those helpers, which swallow private-mode / quota
// failures: a marker that cannot be written costs only the boot notice, never the clip.
//
// ITS OWN TINY MODULE rather than a section of `micRelease` (capture OWNERSHIP, in-memory, per tab) or
// `composer` (drafts): it is persistence of a different fact, and it is the seed S8b's persisted
// pending-upload record replaces wholesale — one file to retire, nothing to untangle.

import { loadPersisted, patchPersisted, savePersisted } from "./persist";

const KEY = "ctrlb.pendingClips";

/** A fresh clip id. `randomUUID` is secure-context only — a flag-whitelisted plain-HTTP origin records
 *  fine without it — so the fallback only has to be unique within this browser's marker set. */
export function newClipId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Mark a clip as at risk — called at each upload loop's ENTRY (fix wave W4: a hanging first attempt is
 *  the usual failure, and it can run as long as the clip). */
export function markClipPending(id: string): void {
  patchPersisted(KEY, () => ({ [id]: Date.now() }));
}

/** The clip landed, or the owner discarded it (or a 4xx dropped it): it is no longer lost-if-reloaded. */
export function clearClipPending(id: string): void {
  patchPersisted(KEY, () => ({ [id]: undefined }));
}

/** BOOT: how many clips the last session left at risk — and forget them (the notice is said once).
 *  Read at boot only, before any upload of this page can have marked one. EVERY mark is taken (X4 — see
 *  the module comment for the two-tab limitation this records). */
export function takeLostClips(): number {
  const n = Object.keys(loadPersisted<Record<string, unknown>>(KEY, {})).length;
  if (n > 0) savePersisted(KEY, {});
  return n;
}
