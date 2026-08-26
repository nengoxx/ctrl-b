import { useEffect, useRef, useState } from "react";

import { useSettings } from "./useSettings";
import type { GalleryScope } from "./useMediaLibrary";
import {
  exportImage,
  type CropRect,
  type ExportOutput,
  type ExportOverride,
} from "../lib/imageExport";
import { guardPick, pixelRefusal, readHead, type ImageFormat } from "../lib/imageProbe";
import { UPLOAD_LIMITS, type MediaSection } from "../theme-engine/mediaRegistry";

// THE IMAGE JOB (D65 / MEDIA_MANAGER_PLAN §4 + §12's "W10") — one picture, from a `File` to the bytes
// this app stores: **admit → guard → crop → export → DELIVER**.
//
// It is the front half of what used to be `useMediaUpload` whole, split at the owner's directive of
// 2026-08-26: *editing an image already in the library is a standalone capability, not an appendage of
// uploading.* Both jobs are the same four steps and differ only in what happens to the bytes at the
// end — a new file under a minted name, or the same file replaced under its own — so the steps live
// here once and the tail is INJECTED. Plain strategy injection: a `deliver` function bound into the
// job at admission, no registry and no framework.
//
// The three rules that shaped the upload still shape this, unchanged:
//
// ① **ONE ADMISSION PATH, ONE LATCH** (Opus M8). Exactly one section is ever on screen and one job at
//    a time runs in it, whatever admitted it — the Add row, a drop, a paste, the detail panel's Edit.
//    The latch that enforces it is a SYNCHRONOUS ref, never rendered state: two taps in one frame both
//    read the same pre-render `false` and both start a job. ONE machine is mounted (`MediaGallery`),
//    so the latch, the phase word and the failure row are one set of facts about one job.
//
// ② **THE DESTINATION IS BOUND AT ADMISSION** (Emma #1) — and since this split, so is the DELIVERY.
//    A job outlives the gallery that started it: the owner can close it while the worker is exporting.
//    Reading the live gallery mid-flight meant a job could find itself with no destination and return
//    without releasing the latch, which left the Add row looking live and silently refusing every pick
//    for the rest of the session. A job knows where it is going, and what to do when it gets there,
//    from the moment it starts.
//
// ③ **THE PHASE WORDS AND THE FAILURE ROW ARE THE MACHINE'S**, because they are what the owner sees of
//    a job and there is one job. A delivery drives them through the `JobControl` it is handed rather
//    than owning state of its own.

/** The picked file, waiting for the crop step — and the whole job around it.
 *
 *  The object URL is NOT here on purpose: it belongs to the modal that renders it, created and revoked
 *  in one effect (R54 §6.1 — revoking in the same task as the `src` assignment errors in Chromium, and
 *  a URL outliving its consumer pins the whole blob in memory). The FILE is the source of truth; the
 *  export decodes it again in the worker. */
export interface CropJob extends JobSpec {
  file: File;
  /** The decoded size, from the `createImageBitmap` proof — already EXIF-oriented, which is the same
   *  space `react-easy-crop` reports its rect in. */
  width: number;
  height: number;
  /** What the header reader PROVED the bytes are, carried through so the export's alpha decision is
   *  never made from `File.type` (Emma #3). `null` = unnamed by the reader ⇒ treated as alpha-capable. */
  format: ImageFormat | null;
}

/** ONE ADMISSION, stated whole: where the bytes are going, how they are encoded, and what happens to
 *  them when they exist. Captured when the file is offered and never re-read (rule ②). */
export interface JobSpec {
  section: MediaSection;
  scope: GalleryScope;
  /** Override the role's own export policy for THIS job. The edit consumer forces the stored file's
   *  proven source type through it, so a re-crop cannot change the extension of a file it is replacing
   *  under its own name. Absent ⇒ the role's policy (`section.def.export`), which is the upload's case. */
  export?: ExportOverride;
  /** WHAT HAPPENS TO THE BYTES — the injected tail (§12's "W10").
   *
   *  **A delivery never throws**: it reports every outcome through the `JobControl` it is handed, and
   *  every path out of it ends in exactly one of `finish`/`fail`. A throw would leave the latch taken
   *  with nothing on screen, which is the one failure this machine cannot describe. */
  deliver: JobDelivery;
}

export type JobDelivery = (
  output: ExportOutput,
  job: CropJob,
  control: JobControl,
) => Promise<void>;

/** The machine, as a delivery drives it. Everything a tail needs to say about a job it is running, and
 *  nothing about how the machine holds it. */
export interface JobControl {
  /** Take the latch and clear any failure row — the first thing a delivery does, and the first thing a
   *  RETRY of one does. Idempotent: on the first pass the latch is already held. */
  begin: () => void;
  /** Which step is running, for the Add row's own words. */
  setPhase: (phase: JobPhase | null) => void;
  /** The job is over and nothing is left to retry. */
  finish: () => void;
  /** The job failed HERE. The row appears, and the latch RELEASES — the owner must be able to pick
   *  something else without first dismissing it. */
  fail: (failure: Omit<JobFailure, "sectionId">) => void;
  /** A "Try again" is an ADMISSION too, and takes the same latch: a double-tapped retry would
   *  otherwise run two exports, or two registrations, of the same job. */
  retryable: (again: () => void) => () => void;
}

/** Which step failed. Each one means something different to the owner, and the copy says which. The
 *  first two are the machine's own; the rest belong to a delivery. */
export type JobPhase = "guard" | "export" | "upload" | "register";

export interface JobFailure {
  phase: JobPhase;
  message: string;
  /** The section this happened in, so a failure cannot be shown under a gallery it is not about. */
  sectionId: string;
  /** The minted name, once there is one — shown, because after a `201` the FILE EXISTS and the owner
   *  needs to know what to look for. */
  filename?: string;
  /** Absent where there is nothing to retry (a refused pick — the answer is to pick something else). */
  retry?: () => void;
}

/** The machine's whole surface. `useMediaUpload` and the edit consumer wrap it; nothing else touches
 *  it except `MediaGallery`, which mounts it and renders its crop step. */
export interface ImageJob {
  /** The file waiting to be cropped, or `null`. */
  crop: CropJob | null;
  /** The current failure, with the section it happened in — a consumer scopes it to what is on screen. */
  failure: JobFailure | null;
  /** A job is running — the latch is taken. TRUE through the crop step too, which has no `phase` of its
   *  own because nothing is happening: the app is waiting for the owner. */
  busy: boolean;
  phase: JobPhase | null;
  /** The machine can accept a file at all (the settings snapshot the server's byte cap comes from has
   *  landed). A consumer ANDs its own capability onto this. */
  ready: boolean;
  /** THE ONE ADMISSION PATH (rule ①). Ignored while a job is running, and while there is no file. */
  offer: (file: File | null | undefined, spec: JobSpec) => void;
  confirm: (rect: CropRect) => void;
  cancel: () => void;
  dismiss: () => void;
}

export function useImageJob(): ImageJob {
  const { data: settings } = useSettings();
  const [crop, setCrop] = useState<CropJob | null>(null);
  const [failure, setFailure] = useState<JobFailure | null>(null);
  const [phase, setPhase] = useState<JobPhase | null>(null);
  /** RULE ① — the latch. Synchronous, so two taps in one frame cannot both pass it. */
  const running = useRef(false);

  // The one LIVE fact a running job reads: the server's byte cap, which must be as fresh as possible.
  // Through a ref because a job outlives the render it started in. Written in an EFFECT, never during
  // render (the house rule `useOverlayBackGuard` follows): the only readers are event handlers and
  // in-flight promises, neither of which can run before the commit.
  const state = useRef({ settings });
  useEffect(() => {
    state.current = { settings };
  });

  // ── the job, as PLAIN functions ────────────────────────────────────────────────────────────────
  //
  // Not `useCallback`s, deliberately. Two of them are RECURSIVE — a failure row's "Try again" re-enters
  // the very step that produced it — and a memoized closure cannot name itself (the React Compiler
  // lint says so outright). Nothing here needs a stable identity either: none of these is an effect
  // dependency, and the component that renders them re-renders with its data anyway.

  const retryable = (again: () => void) => () => {
    if (running.current) return;
    again();
  };

  function fail(sectionId: string, next: Omit<JobFailure, "sectionId">): void {
    setFailure({ ...next, sectionId });
    // The latch RELEASES on a failure: the row is on screen, and the owner must be able to pick
    // something else without first dismissing it. The delivery's own pending job survives for the retry.
    running.current = false;
    setPhase(null);
  }

  /** The control ONE job's delivery drives the machine through — bound to that job, like everything
   *  else about it (rule ②), so a failure can only ever be reported against the section it happened in. */
  function control(job: JobSpec): JobControl {
    return {
      begin: () => {
        running.current = true;
        setFailure(null);
      },
      setPhase,
      finish: () => {
        running.current = false;
        setPhase(null);
      },
      fail: (next) => fail(job.section.id, next),
      retryable,
    };
  }

  /** The crop rect becomes bytes, and the bytes go to the job's own delivery.
   *
   *  Takes its DESTINATION and its tail from the crop job rather than from the live gallery (rule ②):
   *  the owner may close the gallery while the worker is exporting, and a job they already committed to
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
        // The JOB's policy where it states one, else the ROLE's. An edit states one: it is replacing a
        // file under its own name, so the output type is not free.
        override: ctx.export ?? sec.def.export,
      });
    } catch (error) {
      fail(sec.id, {
        phase: "export",
        message: error instanceof Error ? error.message : "the image could not be prepared.",
        retry: retryable(() => void run(ctx, rect)),
      });
      return;
    }
    await ctx.deliver(output, ctx, control(ctx));
  }

  /** THE ONE ADMISSION PATH (rule ①) — every entrance arrives here, and the job is bound HERE, once. */
  function offer(file: File | null | undefined, spec: JobSpec): void {
    if (file == null) return;
    if (running.current) return; // the latch, taken synchronously
    running.current = true;
    setFailure(null);
    setPhase("guard");
    const sec = spec.section;
    void (async () => {
      const limits = {
        ...UPLOAD_LIMITS,
        // The SERVER's cap, so the client refuses before it spends an upload on a 413 — and the
        // two ends can never disagree about what the number is.
        maxBytes: state.current.settings?.media?.write?.max_bytes ?? UPLOAD_LIMITS.maxBytesFallback,
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
      setCrop({ ...spec, file, ...size, format: verdict.header.format });
    })();
  }

  return {
    crop,
    failure,
    busy: phase !== null || crop !== null,
    phase,
    ready: settings !== undefined,
    offer,
    confirm: (rect: CropRect) => {
      const job = crop;
      setCrop(null);
      // The JOB is what carries the destination and the delivery onward — never the live gallery.
      if (job !== null) void run(job, rect);
    },
    cancel: () => {
      // Unwinds fully (§4): the file is dropped, the latch releases, nothing was written anywhere.
      setCrop(null);
      running.current = false;
      setPhase(null);
    },
    dismiss: () => setFailure(null),
  };
}
