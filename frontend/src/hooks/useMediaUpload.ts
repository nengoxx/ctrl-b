import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from "react";

import { readMediaIndex, type MediaFile } from "./useMedia";
import { useSettings } from "./useSettings";
import type { GalleryScope, JobOutcome } from "./useMediaLibrary";
import { ApiError, putBytes } from "../api/client";
import { exportImage, type CropRect } from "../lib/imageExport";
import { guardPick, pixelRefusal, readHead, type ImageFormat } from "../lib/imageProbe";
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
 *  in memory). The FILE is the source of truth; the export decodes it again in the worker.
 *
 *  It also carries its own CONTEXT — see `JobContext`. */
export interface CropJob extends JobContext {
  file: File;
  /** The decoded size, from the `createImageBitmap` proof — already EXIF-oriented, which is the same
   *  space `react-easy-crop` reports its rect in. */
  width: number;
  height: number;
  /** What the header reader PROVED the bytes are, carried through so the export's alpha decision is
   *  never made from `File.type` (Emma #3). `null` = unnamed by the reader ⇒ treated as alpha-capable. */
  format: ImageFormat | null;
}

/** WHERE a job is going, captured when it was ADMITTED and never re-read (Emma #1).
 *
 *  A job outlives the gallery that started it — the owner can close it while the worker is exporting,
 *  and the write queue lives a level above — so reading `state.current.section` mid-flight meant a job
 *  could find itself with no destination and return without releasing the latch. The Add row then
 *  looked live in every gallery and silently refused every pick for the rest of the session.
 *
 *  Binding the destination makes that unrepresentable: the job knows where it is going from the moment
 *  it starts, and closing the gallery is exactly what it sounds like — the owner stops watching, not
 *  the upload stops happening. */
interface JobContext {
  section: MediaSection;
  scope: GalleryScope;
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
interface Pending extends JobContext {
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [crop, setCrop] = useState<CropJob | null>(null);
  const [failure, setFailure] = useState<UploadFailure | null>(null);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  /** RULE ① — the latch. Synchronous, so two taps in one frame cannot both pass it. */
  const running = useRef(false);
  const pending = useRef<Pending | null>(null);
  /** Names the SERVER has refused with a 409 this session — our listing did not know about them. */
  const raced = useRef(new Set<string>());

  // The LIVE facts a running job reads — and only these two. Where the job is going is bound into the
  // job itself (`JobContext`); what is left here is the folder listing a NAME is minted against (which
  // must be as fresh as possible) and the write queue (which belongs to the tab, not to the gallery).
  //
  // Through a ref because a job outlives the render it started in, and because recreating every
  // function below on each new `rows` array would re-arm the hook on every poll. Written in an EFFECT,
  // never during render (the house rule `useOverlayBackGuard` follows): the only readers are event
  // handlers and in-flight promises, neither of which can run before the commit.
  const state = useRef({ rows, append });
  useEffect(() => {
    state.current = { rows, append };
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

  /** Is `filename` in the role's folder RIGHT NOW? A rejection means "could not find out", never
   *  "no" — the whole point of the reconcile (Emma #2). Throws; the caller keeps the job retryable.
   *
   *  `readMediaIndex` rather than any cache operation — see its own note: an invalidation hands back
   *  a cache that PREDATES the upload, and a cache-WRITING read publishes a transient failure to the
   *  gallery that is waiting to show the failure row.
   */
  async function landed(ctx: JobContext, filename: string): Promise<boolean> {
    const index = await readMediaIndex(ctx.section.ns);
    return (index.roles?.[ctx.section.role] ?? []).some((row) => row.file === filename);
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
  async function deliver(resumed: boolean): Promise<void> {
    const job = pending.current;
    // No job at all: nothing to deliver, and the latch must not be left holding the door.
    if (job === null) {
      finish();
      return;
    }
    const sec = job.section;
    running.current = true;
    setFailure(null);
    if (!job.uploaded && resumed) {
      try {
        if (await landed(job, job.filename)) job.uploaded = true;
      } catch {
        // The reconcile could not be MADE, so the outcome is still unknown — and an unknown outcome
        // must never fall through into a PUT. Stay exactly where we were: same job, same name, still
        // retryable. One more tap when the connection is back costs nothing; a duplicate upload costs
        // the owner a file they cannot see.
        fail(sec.id, {
          phase: "upload",
          message: `${job.filename} may or may not have reached the server — the library could not be re-read to find out. Try again when the connection is back.`,
          filename: job.filename,
          retry: retryable(() => void deliver(true)),
        });
        return;
      }
    }
    if (!job.uploaded) {
      setPhase("upload");
      try {
        job.filename = await upload(job, resumed);
        job.uploaded = true;
      } catch (error) {
        fail(sec.id, {
          phase: "upload",
          message: uploadMessage(error),
          filename: job.uploaded ? job.filename : undefined,
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

  /** Phase one: the crop rect becomes bytes, and the bytes get a name.
   *
   *  Takes its DESTINATION from the crop job rather than from the live gallery (Emma #1): the owner
   *  may close the gallery while the worker is exporting, and an upload they already committed to
   *  should land, not vanish with the latch still held. */
  async function run(ctx: CropJob, rect: CropRect): Promise<void> {
    const sec = ctx.section;
    running.current = true;
    setPhase("export");
    let output;
    try {
      output = await exportImage({
        file: ctx.file,
        // The BYTES' own format, from the guard's header reader — never `File.type`, which an Android
        // content URI leaves empty and which decided a transparent picture's fate (Emma #3).
        sourceFormat: ctx.format,
        rect,
        bounds: sec.bounds,
        override: sec.def.export,
      });
    } catch (error) {
      fail(sec.id, {
        phase: "export",
        message: error instanceof Error ? error.message : "the image could not be prepared.",
        retry: retryable(() => void run(ctx, rect)),
      });
      return;
    }
    // The stored name is minted from the OUTPUT's own extension (`blob.type`, never the request)
    // and from what the folder already holds — so it cannot collide and cannot be refused.
    const filename = mint(state.current.rows, raced.current, ctx.file.name, output.ext);
    pending.current = {
      section: sec,
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
    await deliver(false);
  }

  /** The ONE admission path (rule ①) — the Add row, a drop and a paste all arrive here. The
   *  destination is captured HERE, once, and travels with the job from this point on (Emma #1). */
  function offer(file: File | null | undefined): void {
    const sec = section;
    const ctx: JobContext | null = sec === undefined ? null : { section: sec, scope };
    if (file == null || sec === undefined || ctx === null || !sec.caps.upload) return;
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
        try {
          size = { width: bitmap.width, height: bitmap.height };
        } finally {
          // 48 MB of RGBA for a 12 MP photo, handed straight back — and in a `finally` because the
          // refusal below returns without ever reaching the crop step.
          bitmap.close();
        }
      } catch {
        fail(sec.id, {
          phase: "guard",
          message:
            "that file could not be opened as an image on this device. If it came from a phone camera, try sharing it (which converts it) or saving it as JPEG first.",
        });
        return;
      }
      // THE CAP, ENFORCED WHERE THE SIZE FIRST EXISTS (Emma #4). The header reader admits files it
      // cannot measure — a JPEG whose frame header sits past the 64 KB head, and every format it
      // deliberately does not dimension (AVIF, GIF) — so without this rung the 64 MP contract was only
      // true of the files we happened to be able to parse, and a 108 MP one would go on to be decoded a
      // SECOND time in the worker. The proof decode's own cost is unavoidable for those formats; the
      // second one is not, and neither is opening a crop UI on a picture we will refuse anyway.
      const oversize = pixelRefusal(size.width, size.height, limits.maxPixels);
      if (oversize !== null) {
        fail(sec.id, { phase: "guard", message: oversize });
        return;
      }
      setPhase(null);
      setCrop({ ...ctx, file, ...size, format: verdict.header.format });
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
      // The JOB is what carries the destination onward — never the live gallery (Emma #1).
      if (job !== null) void run(job, rect);
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
