import type { MediaUpload } from "../../hooks/useMediaUpload";
import { UPLOAD_ACCEPT } from "../../theme-engine/mediaRegistry";

// THE UPLOAD SURFACE, once (D65 / MEDIA_MANAGER_PLAN §4 + §6.2) — the labelled **Add an image** row and
// the failure row that answers for it.
//
// It was `GalleryModal`'s own JSX until the picker arrived (D70 §13-S6b wave 2), and it is here for the
// reason the machinery below it is shared: the ONE admission path is a claim about the app, not about a
// screen. Two surfaces now put a picture into a library — the gallery, and the agent editor's LIBRARY
// PICKER — and a second hand-rolled Add row would be a second set of phase words, a second failure
// vocabulary and a second `accept` list to keep in step (the picker's predecessor had exactly that, and
// its `upload`/`clear` pills are what this wave deletes).
//
// Nothing about the gallery's rendering changed with the move: the markup, the classes and the copy are
// the ones that shipped.

/** What the Add row says while a job runs. Per PHASE, because they take visibly different amounts of
 *  time on a phone and "working…" for four seconds reads as a hang. */
function working(phase: MediaUpload["phase"]): string {
  // `null` while the CROP step is open: the job holds the latch, but nothing is running — the app is
  // waiting for the owner, behind a modal that covers this row anyway.
  if (phase === null) return "Working…";
  if (phase === "guard") return "Opening the picture…";
  if (phase === "export") return "Preparing the image…";
  if (phase === "upload") return "Uploading…";
  if (phase === "replace") return "Saving the change…";
  return "Saving…";
}

/** The failure row's own heading — WHICH step failed, because the answer differs completely: a
 *  refused pick means choose another file, a failed upload means try again, a failed REPLACE means the
 *  stored picture is untouched (Emma W10 #2 — an edit is not an upload and must not borrow its copy),
 *  and a failed registration means the picture is already on the server. */
function failureTitle(phase: MediaUpload["phase"]): string {
  if (phase === "guard") return "That picture cannot be used —";
  if (phase === "export") return "The image could not be prepared —";
  if (phase === "upload") return "The upload did not finish —";
  if (phase === "replace") return "The change was not saved —";
  return "Uploaded, but not saved to the list —";
}

/** The job's failure, where the owner started it. An ALERT, not a status (Emma W10 #4): it interrupts a
 *  job the owner started rather than describing the list they are looking at — and the surface's ONE
 *  `role="status"` is its header line. Renders nothing while there is nothing to say. */
export function UploadFailureRow({ upload }: { upload: MediaUpload }) {
  if (upload.failure === null) return null;
  return (
    <p className="mgal-fail" role="alert">
      <b>{failureTitle(upload.failure.phase)}</b> {upload.failure.message}
      {upload.failure.retry !== undefined && (
        <button type="button" className="mgal-act" onClick={upload.failure.retry}>
          Try again
        </button>
      )}
      <button type="button" className="mgal-act" onClick={upload.dismiss}>
        Dismiss
      </button>
    </p>
  );
}

/** The ONE admission path (§4, Opus M8): exactly one section is ever on screen, so one row, one job,
 *  one latch. HIDDEN input + a styled button, `accept`ed by explicit types and with NO `capture`
 *  (R54 §5.1/§5.4): both engines already offer the camera in the chooser for an image accept list, and
 *  `capture` would make the camera the only option. `input.value` is reset in the handler. */
export function AddImageRow({ upload }: { upload: MediaUpload }) {
  return (
    <>
      <input
        ref={upload.inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        hidden
        onChange={upload.onInputChange}
      />
      <button
        type="button"
        className="mgal-add"
        disabled={!upload.ready || upload.busy}
        onClick={upload.pick}
      >
        <span aria-hidden>＋</span> {upload.busy ? working(upload.phase) : "Add an image"}
        <small>
          {upload.busy
            ? "keep this open until it finishes"
            : "a photo or a picture — you can crop it next"}
        </small>
      </button>
    </>
  );
}
