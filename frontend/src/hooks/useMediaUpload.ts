import { useEffect, useRef, type ChangeEvent, type RefObject } from "react";

import type { CropJob, ImageJob, JobControl, JobFailure, JobPhase } from "./useImageJob";
import { readMediaIndex, type MediaFile } from "./useMedia";
import type { GalleryScope, JobOutcome } from "./useMediaLibrary";
import { ApiError, putBytes } from "../api/client";
import type { ExportOutput } from "../lib/imageExport";
import { mediaFileUrl } from "../lib/media";
import type { LibraryEntry } from "../lib/mediaLibrary";
import { mintName } from "../lib/uploadName";
import { UPLOAD_LIMITS, type MediaSection } from "../theme-engine/mediaRegistry";

// THE UPLOAD (D65 / MEDIA_MANAGER_PLAN §4) — a NEW file in the library: mint a name → PUT the bytes →
// register the entry.
//
// It is one CONSUMER of `useImageJob` since the owner's 2026-08-26 directive ("W10"): everything up to
// and including the export — the admission latch, the guard ladder, the crop step, the worker — is that
// machine's, and what lives here is the tail it is handed, plus the surface the gallery renders. The
// edit consumer is the other tail, and it is why the split exists: editing a picture already in the
// library is a capability of its own, not an appendage of adding one.
//
// The two rules that shape every line of the tail below (the third — one admission, one latch — moved
// with the machine):
//
// ② **TWO PHASES, AND A RETRY THAT NEVER RE-UPLOADS** (Emma #4). Once the server answers `201` the
//    bytes exist under a name, and the only thing left is the config write. A retry that re-ran the
//    whole job would either 409 against its own upload or, worse, store a second copy under the next
//    suffix. So the job record persists the MINTED FILENAME and whether it landed, a retry after a
//    201 goes straight to the registration for that exact identity, and a retry whose PUT outcome is
//    UNKNOWN (a dropped connection is exactly this case) RECONCILES against the index first: if the
//    file is there, the upload already happened.
//
// ③ **ONE WRITE PATH.** Registration is `useMediaLibrary`'s queued, recompute-at-send `patch`
//    chokepoint like every other media config change (§4's write serialization). This hook does not
//    own a second one; what it adds is asking that queue how the write ENDED, because it is the one
//    caller whose other half already happened and cannot be undone.
//
// The `409` from the server's own race guard is not an error the owner ever sees: it means another
// writer took the name between our listing and our PUT, and the answer is the next suffix (§2.5 —
// "never a dialog").

/** What the gallery renders of a job: the Add row's own state, and the failure row. The crop step is
 *  the MACHINE's and is rendered by `MediaGallery` beside this surface's gallery. */
export interface MediaUpload {
  failure: JobFailure | null;
  /** A job is running — the latch is taken and the Add row must not look otherwise. TRUE through the
   *  crop step too, which has no `phase` of its own because nothing is happening: the app is waiting
   *  for the owner. */
  busy: boolean;
  /** What it is doing, for the row's own words. */
  phase: JobPhase | null;
  /** True once this section can accept an upload at all. */
  ready: boolean;
  pick: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  /** The drag-drop and paste entrance — the same admission path as the Add row. */
  offer: (file: File | null | undefined) => void;
  dismiss: () => void;
}

/** The job between its two phases: what to store, under what name, and whether the bytes are already
 *  there. Held in a REF rather than in state — it carries a Blob, and it must survive a re-render
 *  without one being scheduled for it. */
interface Pending {
  section: MediaSection;
  scope: GalleryScope;
  blob: Blob;
  filename: string;
  fields: LibraryEntry;
  uploaded: boolean;
}

export function useMediaUpload(args: {
  /** The one image-job machine, mounted by `MediaGallery` and shared with the edit consumer. */
  job: ImageJob;
  /** The section the open gallery is showing, or `undefined` when none is. */
  section: MediaSection | undefined;
  scope: GalleryScope;
  /** The WHOLE role's rows — a filename collides folder-wide, not scope-wide. */
  rows: readonly MediaFile[];
  /** `useMediaLibrary`'s register write, answering how it ended. */
  append: (section: MediaSection, filename: string, fields: LibraryEntry) => Promise<JobOutcome>;
  /** Called with the STORED filename once the entry is in the library — the one fact a caller that
   *  uploads on the way to something else needs (D70 §8.2: the agent editor sets the binding it just
   *  made). Absent for the gallery, which uploads INTO the library and has nowhere else to point.
   *
   *  Only on `written`: a registration that failed leaves the bytes on the server but no entry, and
   *  binding an agent to a picture the library does not list would be a claim the render walks past. */
  onStored?: (filename: string) => void;
}): MediaUpload {
  const { job, section, scope, rows, append, onStored } = args;
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef<Pending | null>(null);
  /** Names the SERVER has refused with a 409 this session — our listing did not know about them. */
  const raced = useRef(new Set<string>());

  // The LIVE facts a running job reads — and only these. Where the job is going is bound into the
  // job itself (Emma #1); what is left here is the folder listing a NAME is minted against (which must
  // be as fresh as possible), the write queue (which belongs to the tab, not to the gallery), and the
  // stored-name callback (which belongs to whatever draft the caller is filling in).
  //
  // Through a ref because a job outlives the render it started in, and because recreating every
  // function below on each new `rows` array would re-arm the hook on every poll. Written in an EFFECT,
  // never during render (the house rule `useOverlayBackGuard` follows): the only readers are event
  // handlers and in-flight promises, neither of which can run before the commit.
  const state = useRef({ rows, append, onStored });
  useEffect(() => {
    state.current = { rows, append, onStored };
  });

  // ── the tail, as PLAIN functions ───────────────────────────────────────────────────────────────
  //
  // Not `useCallback`s, for the machine's own reason: `deliver` is RECURSIVE — a failure row's "Try
  // again" re-enters it — and a memoized closure cannot name itself.

  /** The machine's `finish`, plus this tail's own book-keeping: the two-phase record is done with. */
  function finish(control: JobControl): void {
    pending.current = null;
    control.finish();
  }

  /** What every delivery failure hands the machine as its `abandon` (Emma W10 #1): when the row is
   *  dismissed — or replaced by a NEW admission, which removes the row's retry with the row — the
   *  two-phase record and the multi-megabyte Blob it holds are unreachable and must not outlive it.
   *  Never called on the failure's own retry (the machine's contract), which is what keeps rule ②'s
   *  resume intact. */
  const abandon = () => {
    pending.current = null;
  };

  /** Is `filename` in the role's folder RIGHT NOW? A rejection means "could not find out", never
   *  "no" — the whole point of the reconcile (Emma #2). Throws; the caller keeps the job retryable.
   *
   *  `readMediaIndex` rather than any cache operation — see its own note: an invalidation hands back
   *  a cache that PREDATES the upload, and a cache-WRITING read publishes a transient failure to the
   *  gallery that is waiting to show the failure row.
   */
  async function landed(job: Pending, filename: string): Promise<boolean> {
    const index = await readMediaIndex(job.section.ns);
    return (index.roles?.[job.section.role] ?? []).some((row) => row.file === filename);
  }

  /** The bytes → the server, walking suffixes past the race guard. Returns the name that stuck.
   *
   *  `resumed` carries the one fact that changes what a `409` MEANS. On a first attempt it can only be
   *  another writer, and the answer is the next suffix. On a RESUMED attempt at the ORIGINAL name it
   *  is far more likely to be our own earlier upload — the one whose response we lost — so that exact
   *  name is reconciled once more before any suffixing. Without this, the retry of a lost-response
   *  upload stores a second copy of the same picture and orphans the first (Emma #2). */
  async function upload(job: Pending, resumed: boolean): Promise<string> {
    const { ns, role } = job.section;
    let name = job.filename;
    let reconciled = false;
    for (let attempt = 0; attempt <= UPLOAD_LIMITS.raceRetries; attempt++) {
      try {
        await putBytes(mediaFileUrl(ns, role, name), job.blob);
        return name;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
        if (resumed && !reconciled && name === job.filename) {
          reconciled = true;
          // A throw here is the honest outcome: we cannot tell whose file that is, and guessing
          // "someone else's" is what duplicates the owner's picture.
          if (await landed(job, name)) return name;
        }
        // The one status the owner never sees. Another writer took this name between our listing
        // and our PUT; mint the next one and try again.
        raced.current.add(name);
        name = mint(state.current.rows, raced.current, job.filename, extOf(job.filename));
      }
    }
    throw new Error("could not find a free filename — try again in a moment.");
  }

  /** Phase two: make sure the bytes are there (once), then register them (§4's two-phase job).
   *
   *  `resumed` is what separates a first run from a RETRY, and it is the whole of rule ②: on a retry
   *  whose PUT outcome is unknown, the folder is re-read first — if the file is already there, the
   *  upload happened and re-sending the blob would store a second copy under the next suffix.
   *
   *  Everything it needs about WHERE it is going comes off the job (Emma #1), so closing the gallery
   *  mid-flight cannot strand it — and every exit from here releases the latch. */
  async function deliver(control: JobControl, resumed: boolean): Promise<void> {
    const job = pending.current;
    // No job at all: nothing to deliver, and the latch must not be left holding the door.
    if (job === null) {
      finish(control);
      return;
    }
    control.begin();
    if (!job.uploaded && resumed) {
      try {
        if (await landed(job, job.filename)) job.uploaded = true;
      } catch {
        // The reconcile could not be MADE, so the outcome is still unknown — and an unknown outcome
        // must never fall through into a PUT. Stay exactly where we were: same job, same name, still
        // retryable. One more tap when the connection is back costs nothing; a duplicate upload costs
        // the owner a file they cannot see.
        control.fail({
          phase: "upload",
          message: `${job.filename} may or may not have reached the server — the library could not be re-read to find out. Try again when the connection is back.`,
          filename: job.filename,
          retry: control.retryable(() => void deliver(control, true)),
          abandon,
        });
        return;
      }
    }
    if (!job.uploaded) {
      control.setPhase("upload");
      try {
        job.filename = await upload(job, resumed);
        job.uploaded = true;
      } catch (error) {
        control.fail({
          phase: "upload",
          message: uploadMessage(error),
          filename: job.uploaded ? job.filename : undefined,
          retry: control.retryable(() => void deliver(control, true)),
          abandon,
        });
        return;
      }
    }
    control.setPhase("register");
    const outcome = await state.current.append(job.section, job.filename, job.fields);
    if (outcome === "written") {
      // The entry EXISTS now, under this name — the one fact a caller uploading on the way somewhere
      // else needs (see `onStored`). Read off the ref like everything else a job reads late.
      state.current.onStored?.(job.filename);
      finish(control);
      return;
    }
    // The bytes ARE on the server — this is a partial success, and the sentence has to say so or
    // the owner goes looking for a file that is already there. It is also the least damaging
    // failure in the pipeline: an unlisted file still appears in this gallery and still paints,
    // because the collation appends what is on disk (§2.3 ②).
    control.fail({
      phase: "register",
      message: `${job.filename} was uploaded, but the library list could not be saved. The image is in the folder and will still appear — try again to give it its place in the order.`,
      filename: job.filename,
      retry: control.retryable(() => void deliver(control, true)),
      abandon,
    });
  }

  /** THE DELIVERY the machine calls with the exported bytes: give them a name, then run the two-phase
   *  job above. */
  const delivery = async (output: ExportOutput, ctx: CropJob, control: JobControl) => {
    // The stored name is minted from the OUTPUT's own extension (`blob.type`, never the request)
    // and from what the folder already holds — so it cannot collide and cannot be refused.
    const filename = mint(state.current.rows, raced.current, ctx.file.name, output.ext);
    pending.current = {
      section: ctx.section,
      scope: ctx.scope,
      blob: output.blob,
      filename,
      // Uploads always set the binding `key` on a named role (§2.2): the minted filename is an
      // internal handle, so the stem fallback would bind this file to a key nobody chose. A pool
      // has no keys and gets none.
      //
      // NO `focal` is seeded here — see the note at the end of this file.
      fields: ctx.scope.key === undefined ? {} : { key: ctx.scope.key },
      uploaded: false,
    };
    await deliver(control, false);
  };

  /** The ONE admission this surface makes — the Add row, a drop and a paste all arrive here, and the
   *  destination plus the delivery are bound into the job from this point on (Emma #1). */
  function offer(file: File | null | undefined): void {
    if (section === undefined || !section.caps.upload) return;
    job.offer(file, { section, scope, deliver: delivery });
  }

  return {
    // A failure belongs to the section it happened in: the gallery may have been closed and another
    // one opened while the job ran, and a row about a picture that is not on screen is worse than none.
    failure: job.failure !== null && job.failure.sectionId === section?.id ? job.failure : null,
    busy: job.busy,
    phase: job.phase,
    ready: section?.caps.upload === true && job.ready,
    inputRef,
    pick: () => {
      if (job.busy) return;
      inputRef.current?.click();
    },
    onInputChange: (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // ALWAYS reset (R54 §5.4): `change` fires only when the SELECTION changes, so without this,
      // picking the same photo twice is a dead button — the second pick fires `cancel`, not `change`.
      event.target.value = "";
      offer(file);
    },
    offer,
    // The machine's dismiss ABANDONS the failure, and the failure's own `abandon` is what drops the
    // pending record — one home for that cleanup, whichever path clears the row.
    dismiss: job.dismiss,
  };
}

/** The next free name, against the folder's listing PLUS whatever the server has raced us for. */
function mint(
  rows: readonly MediaFile[],
  raced: ReadonlySet<string>,
  sourceName: string,
  ext: string,
): string {
  const taken = rows.filter((row) => row.bundled == null).map((row) => row.file);
  return mintName(sourceName, ext, [...taken, ...raced], UPLOAD_LIMITS);
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot) : "";
}

/** What a failed PUT means, in the owner's terms. Two statuses get their own sentence because they
 *  are not about the picture at all:
 *   · `413` — the server's own cap, which the client already checks; reaching it here means the
 *     EXPORT produced something over it, which is a fact about the role's bounds, not the pick;
 *   · `500` — the role directory is missing or unwritable on the server (S1's flagged case: the
 *     write refuses to create a tree the boot check prepared). That is an OPERATOR problem and has
 *     to read as one, or the owner keeps re-picking pictures at a folder that is not there. */
function uploadMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      return "the server could not write into the media folder for this section. Check that the folder exists and is writable, then restart ctrl-b — the folders are prepared at startup.";
    }
    if (error.status === 413) {
      return `the server refused the upload as too large (${error.message}). Try a tighter crop.`;
    }
    return `the upload was refused: ${error.message}`;
  }
  return "the upload did not reach the server. Check the connection and try again.";
}

// ── on FOCAL (§5), and why nothing is seeded here ────────────────────────────────────────────────
//
// The plan's §4 says "the crop centre seeds the focal point". Under the LIBRARY model that line has
// no content, and writing something for it would be worse than writing nothing: what gets STORED is
// the crop, so the subject the owner framed is at the centre of the stored file BY CONSTRUCTION —
// the seeded value is `{x: 0.5, y: 0.5}` for every upload, crop or "use as is" alike, which is
// exactly what an ABSENT focal already means (§5: "absent = unset"). Persisting it would put a
// redundant default in the owner's config and, worse, make every uploaded file look like one whose
// framing had been deliberately chosen.
//
// So `focal` is left absent and **S4 owns it entirely** — where it earns its keep, which is a file
// whose framing must differ PER DESTINATION (one library feeding eleven windows of different
// shapes). Flagged to the main seat rather than absorbed.
