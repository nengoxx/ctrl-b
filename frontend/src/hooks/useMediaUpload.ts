import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from "react";

import type { MediaFile, MediaIndex } from "./useMedia";
import { useSettings } from "./useSettings";
import type { GalleryScope, JobOutcome } from "./useMediaLibrary";
import { ApiError, putBytes } from "../api/client";
import { exportImage, type CropRect } from "../lib/imageExport";
import { guardPick, readHead } from "../lib/imageProbe";
import { mediaFileUrl } from "../lib/media";
import type { LibraryEntry } from "../lib/mediaLibrary";
import { mintName } from "../lib/uploadName";
import { UPLOAD_LIMITS, type MediaSection } from "../theme-engine/mediaRegistry";

// THE UPLOAD (D65 / MEDIA_MANAGER_PLAN §4) — pick → guard → crop → export → PUT → register, as ONE
// job with a latch and an idempotent retry.
//
// The three rules that shape every line of it:
//
// ① **ONE ADMISSION PATH, ONE LATCH** (Opus M8). Exactly one section is ever on screen — the entry
//    card opens the gallery, the gallery's labelled Add row is the only way in — so there is one
//    job at a time and the latch that enforces it is a SYNCHRONOUS ref, never rendered state: two
//    taps in one frame both read the same pre-render `false` and both start a job. The v1 design's
//    second per-section flag was accordion residue and is not rebuilt here.
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

/** The picked file, waiting for the crop step. The object URL is NOT here on purpose: it belongs to
 *  the modal that renders it, created and revoked in one effect (R54 §6.1 — revoking in the same task
 *  as the `src` assignment errors in Chromium, and a URL outliving its consumer pins the whole blob
 *  in memory). The FILE is the source of truth; the export decodes it again in the worker. */
export interface CropJob {
  file: File;
  /** The decoded size, from the `createImageBitmap` proof — already EXIF-oriented, which is the same
   *  space `react-easy-crop` reports its rect in. */
  width: number;
  height: number;
}

/** Which step failed. Each one means something different to the owner, and the copy says which. */
export type UploadPhase = "guard" | "export" | "upload" | "register";

export interface UploadFailure {
  phase: UploadPhase;
  message: string;
  /** The section this happened in, so a failure cannot be shown under a gallery it is not about. */
  sectionId: string;
  /** The minted name, once there is one — shown, because after a `201` the FILE EXISTS and the owner
   *  needs to know what to look for. */
  filename?: string;
  /** Absent where there is nothing to retry (a refused pick — the answer is to pick something else). */
  retry?: () => void;
}

export interface MediaUpload {
  /** The file waiting to be cropped, or `null`. */
  crop: CropJob | null;
  failure: UploadFailure | null;
  /** A job is running — the latch is taken and the Add row must not look otherwise. TRUE through the
   *  crop step too, which has no `phase` of its own because nothing is happening: the app is waiting
   *  for the owner. */
  busy: boolean;
  /** What it is doing, for the row's own words. */
  phase: UploadPhase | null;
  /** True once this section can accept an upload at all. */
  ready: boolean;
  pick: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  /** The drag-drop and paste entrance — the same admission path as the Add row. */
  offer: (file: File | null | undefined) => void;
  confirm: (rect: CropRect) => void;
  cancel: () => void;
  dismiss: () => void;
}

/** The job between its two phases: what to store, under what name, and whether the bytes are already
 *  there. Held in a REF rather than in state — it carries a Blob, and it must survive a re-render
 *  without one being scheduled for it. */
interface Pending {
  blob: Blob;
  filename: string;
  fields: LibraryEntry;
  uploaded: boolean;
}

export function useMediaUpload(args: {
  /** The section the open gallery is showing, or `undefined` when none is. */
  section: MediaSection | undefined;
  scope: GalleryScope;
  /** The WHOLE role's rows — a filename collides folder-wide, not scope-wide. */
  rows: readonly MediaFile[];
  /** `useMediaLibrary`'s register write, answering how it ended. */
  append: (section: MediaSection, filename: string, fields: LibraryEntry) => Promise<JobOutcome>;
}): MediaUpload {
  const { section, scope, rows, append } = args;
  const { data: settings } = useSettings();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [crop, setCrop] = useState<CropJob | null>(null);
  const [failure, setFailure] = useState<UploadFailure | null>(null);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  /** RULE ① — the latch. Synchronous, so two taps in one frame cannot both pass it. */
  const running = useRef(false);
  const pending = useRef<Pending | null>(null);
  /** Names the SERVER has refused with a 409 this session — our listing did not know about them. */
  const raced = useRef(new Set<string>());

  // What a running job reads. Through a ref, because a job outlives the render it started in — the
  // gallery it was opened from may already be closed when the config write lands — and because
  // recreating every callback below on each new `rows` array would re-arm the whole hook on every
  // poll. Written in an EFFECT, never during render (the house rule `useOverlayBackGuard` follows):
  // the only readers are event handlers and in-flight promises, neither of which can run before the
  // commit.
  const state = useRef({ section, scope, rows, append });
  useEffect(() => {
    state.current = { section, scope, rows, append };
  });

  // ── the job, as PLAIN functions ────────────────────────────────────────────────────────────────
  //
  // Not `useCallback`s, deliberately. Two of them are RECURSIVE — a failure row's "Try again" re-enters
  // the very step that produced it — and a memoized closure cannot name itself (the React Compiler
  // lint says so outright). Nothing here needs a stable identity either: none of these is an effect
  // dependency, and the component that renders them re-renders with its data anyway. Everything a
  // running job reads comes from `state.current`, so a fresh closure per render is not a stale one.

  /** A "Try again" is an ADMISSION too, and takes the same latch: a double-tapped retry would
   *  otherwise run two exports, or two registrations, of the same job. */
  const retryable = (again: () => void) => () => {
    if (running.current) return;
    again();
  };

  function finish(): void {
    pending.current = null;
    running.current = false;
    setPhase(null);
  }

  function fail(sectionId: string, next: Omit<UploadFailure, "sectionId">): void {
    setFailure({ ...next, sectionId });
    // The latch RELEASES on a failure: the row is on screen, and the owner must be able to pick
    // something else without first dismissing it. The pending job survives for the retry.
    running.current = false;
    setPhase(null);
  }

  /** The bytes → the server, walking suffixes past the race guard. Returns the name that stuck. */
  async function upload(job: Pending, sec: MediaSection): Promise<string> {
    let name = job.filename;
    for (let attempt = 0; attempt <= UPLOAD_LIMITS.raceRetries; attempt++) {
      try {
        await putBytes(mediaFileUrl(sec.ns, sec.role, name), job.blob);
        return name;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
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
   *  whose PUT outcome is unknown, the index is re-read first — if the file is already in the folder,
   *  the upload happened and re-sending the blob would store a second copy under the next suffix. */
  async function deliver(resumed: boolean): Promise<void> {
    const job = pending.current;
    const sec = state.current.section;
    if (job === null || sec === undefined) return;
    running.current = true;
    setFailure(null);
    if (!job.uploaded && resumed) {
      const rowsNow = await reread(qc, sec.ns, sec.role);
      if (rowsNow.some((row) => row.file === job.filename)) job.uploaded = true;
    }
    if (!job.uploaded) {
      setPhase("upload");
      try {
        job.filename = await upload(job, sec);
        job.uploaded = true;
      } catch (error) {
        fail(sec.id, {
          phase: "upload",
          message: uploadMessage(error),
          retry: retryable(() => void deliver(true)),
        });
        return;
      }
    }
    setPhase("register");
    const outcome = await state.current.append(sec, job.filename, job.fields);
    if (outcome === "written") {
      finish();
      return;
    }
    // The bytes ARE on the server — this is a partial success, and the sentence has to say so or
    // the owner goes looking for a file that is already there. It is also the least damaging
    // failure in the pipeline: an unlisted file still appears in this gallery and still paints,
    // because the collation appends what is on disk (§2.3 ②).
    fail(sec.id, {
      phase: "register",
      message: `${job.filename} was uploaded, but the library list could not be saved. The image is in the folder and will still appear — try again to give it its place in the order.`,
      filename: job.filename,
      retry: retryable(() => void deliver(true)),
    });
  }

  /** Phase one: the crop rect becomes bytes, and the bytes get a name. */
  async function run(file: File, rect: CropRect): Promise<void> {
    const sec = state.current.section;
    if (sec === undefined) return;
    running.current = true;
    setPhase("export");
    let output;
    try {
      output = await exportImage({
        file,
        sourceType: file.type,
        rect,
        bounds: sec.bounds,
        override: sec.def.export,
      });
    } catch (error) {
      fail(sec.id, {
        phase: "export",
        message: error instanceof Error ? error.message : "the image could not be prepared.",
        retry: retryable(() => void run(file, rect)),
      });
      return;
    }
    // The stored name is minted from the OUTPUT's own extension (`blob.type`, never the request)
    // and from what the folder already holds — so it cannot collide and cannot be refused.
    const filename = mint(state.current.rows, raced.current, file.name, output.ext);
    pending.current = {
      blob: output.blob,
      filename,
      // Uploads always set the binding `key` on a named role (§2.2): the minted filename is an
      // internal handle, so the stem fallback would bind this file to a key nobody chose. A pool
      // has no keys and gets none.
      //
      // NO `focal` is seeded here — see the note at the end of this file.
      fields: state.current.scope.key === undefined ? {} : { key: state.current.scope.key },
      uploaded: false,
    };
    await deliver(false);
  }

  /** The ONE admission path (rule ①) — the Add row, a drop and a paste all arrive here. */
  function offer(file: File | null | undefined): void {
    const sec = state.current.section;
    if (file == null || sec === undefined || !sec.caps.upload) return;
    if (running.current) return; // the latch, taken synchronously
    running.current = true;
    setFailure(null);
    setPhase("guard");
    void (async () => {
      const limits = {
        ...UPLOAD_LIMITS,
        // The SERVER's cap, so the client refuses before it spends an upload on a 413 — and the
        // two ends can never disagree about what the number is.
        maxBytes: settings?.media?.write?.max_bytes ?? UPLOAD_LIMITS.maxBytesFallback,
      };
      // READING the file can fail on its own, and on Android it is not exotic: a picked file is a
      // content URI whose grant the system can revoke while the app is backgrounded, and the read
      // then throws `NotReadableError`. Unhandled, that would leave the latch taken with no row on
      // screen — one dead Add button for the rest of the session.
      let head: Uint8Array;
      try {
        head = await readHead(file, limits);
      } catch {
        fail(sec.id, {
          phase: "guard",
          message:
            "that file could not be read — if it came from the photo picker, the app may have lost access to it. Pick it again.",
        });
        return;
      }
      const verdict = guardPick(file.size, head, limits);
      if (!verdict.ok) {
        // No retry: the answer to a refused pick is a different picture, not the same one again.
        fail(sec.id, { phase: "guard", message: verdict.reason });
        return;
      }
      // The PROOF rung, and the guard's catch-all: everything the header reader cannot see (an
      // AVIF, a GIF, a HEIC that slipped past the sniff, a file that is not an image at all)
      // rejects HERE. It costs a full decode of a file that is about to be decoded again in the
      // worker — bought deliberately (§4's ladder), because the alternative is a crop UI opening
      // on a picture that cannot be shown and an owner discovering it after framing it.
      let size: { width: number; height: number };
      try {
        const bitmap = await createImageBitmap(file);
        size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
      } catch {
        fail(sec.id, {
          phase: "guard",
          message:
            "that file could not be opened as an image on this device. If it came from a phone camera, try sharing it (which converts it) or saving it as JPEG first.",
        });
        return;
      }
      setPhase(null);
      setCrop({ file, ...size });
    })();
  }

  return {
    crop,
    // A failure belongs to the section it happened in: the gallery may have been closed and another
    // one opened while the job ran, and a row about a picture that is not on screen is worse than none.
    failure: failure !== null && failure.sectionId === section?.id ? failure : null,
    busy: phase !== null || crop !== null,
    phase,
    ready: section?.caps.upload === true && settings !== undefined,
    inputRef,
    pick: () => {
      if (running.current) return;
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
    confirm: (rect: CropRect) => {
      const job = crop;
      setCrop(null);
      if (job !== null) void run(job.file, rect);
    },
    cancel: () => {
      // Unwinds fully (§4): the file is dropped, the latch releases, nothing was written anywhere.
      setCrop(null);
      running.current = false;
      setPhase(null);
    },
    dismiss: () => {
      setFailure(null);
      pending.current = null;
    },
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

/** Re-read the role's listing through the SAME query every other consumer uses — the reconcile step
 *  of rule ②. `invalidateQueries` awaits the active observers' refetch, and the gallery that started
 *  this upload is one, so the cache holds the server's answer by the time this returns. */
async function reread(
  qc: ReturnType<typeof useQueryClient>,
  ns: string,
  role: string,
): Promise<MediaFile[]> {
  await qc.invalidateQueries({ queryKey: ["media", ns] });
  return qc.getQueryData<MediaIndex>(["media", ns])?.roles?.[role] ?? [];
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
