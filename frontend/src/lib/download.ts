// THE ONE BLOB-ANCHOR DOWNLOAD (D79 / ROLEPLAY_PLAN §15.3) — how this app hands the owner a file.
//
// Every "save this to my device" in the app goes through here: a tool's `data.download` JSON (the
// Tools-tab `UtilCard`, the shipped Android-PWA precedent), and the character-card / lorebook exports.
// One implementation, so the revoke rule below cannot be right in one copy and wrong in another.
//
// The anchor is never attached to the document: a detached `<a download>` click is what the shipped
// UtilCard path has always done on the owner's phone, and it is FileSaver.js's own shape.

import { sanitizeStem } from "./uploadName";

/** How long the object URL outlives the click. The download is asynchronous — the browser may still be
 *  reading the blob after `click()` returns — and revoking at once is fine for a few KB of JSON but
 *  races a multi-MB PNG card on a slow phone. FileSaver.js waits 40 s for exactly this reason; the
 *  cost is one blob held in memory for that long, which is nothing beside a failed save. */
export const REVOKE_DELAY_MS = 40_000;

/** The filename an export downloads as: a display name through the upload-name sanitizer (the rules the
 *  media path already owns — no control characters, no `<>:"/\\|?*`, no Windows device name), with the
 *  extension passed INTO it. `sanitizeStem` cuts at the LAST dot, so a bare "Dr. Watson" would come
 *  back "Dr"; "Dr. Watson.png" comes back "Dr. Watson". */
export function downloadName(title: string, ext: `.${string}`): string {
  return sanitizeStem(title + ext) + ext;
}

/** Hand the owner `blob` as a file named `filename`. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/** Hand the owner `value` as a pretty-printed JSON file (2-space indent — what a human opens). */
export function downloadJson(filename: string, value: unknown): void {
  downloadBlob(filename, new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
}
