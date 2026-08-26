import { useQueryClient } from "@tanstack/react-query";

import type { ImageJob, JobControl, JobDelivery } from "./useImageJob";
import type { GalleryScope, LibraryItem } from "./useMediaLibrary";
import { ApiError, putBytes } from "../api/client";
import type { OutputType } from "../lib/imageExport";
import { revUrl } from "../lib/media";
import type { MediaSection } from "../theme-engine/mediaRegistry";

// EDIT IN PLACE (D65 / MEDIA_MANAGER_PLAN §12's "W10") — re-crop a picture that is ALREADY in the
// library, under the name it already has.
//
// It exists because of the owner's round after W9: there was no way to re-frame or re-crop an image
// once it was uploaded, and the answer "delete it and add it again" loses the entry's whole config
// identity — its place in the order, its In-use state, its binding key, whatever surface pins it. So
// this writes BYTES and nothing else: **there is no register call here**, and there is no config write
// at all. The entry is the same entry; only what it looks like changed.
//
// It is the second consumer of `useImageJob` — the same admission, guard, crop step and export the
// upload runs on — and everything it adds is at the two ends:
//
//  · **the SOURCE is the stored file**, fetched through its own `?rev=` URL so the bytes cropped are
//    the bytes the gallery is showing. Admitted as a PROMISE, so the machine's one latch covers the
//    download too.
//  · **the DELIVERY is a conditional PUT to the same filename**, carrying `X-Expected-Revision` — the
//    revision read at admission. The server replaces only if the file still answers to it, and answers
//    **412** if it does not (never 409, which on that route means "that name is taken" and is walked
//    into a second copy). The copy on a 412 is the server's own sentence.
//
// **The export is FORCED to the stored file's own type** (`ExportOverride.type`), which is what keeps
// the filename honest: `a.png` must still be a PNG afterwards or the mount serves it as one under
// `nosniff` and the browser refuses it. The role's own policy — which is free to choose webp for an
// upload — cannot apply to a file whose extension is already decided.
//
// **Two residuals, recorded rather than solved** (§12): each re-crop re-encodes the STORED bytes, so a
// crop of a crop compounds the q0.85 generation loss (the original is not kept — the additive-library
// ruling), and a lost response retried reads as a 412 whose copy says to reopen it, which is the same
// two-devices class the write queue already accepts.

/** The stored file's proven format → what the export must produce. The server refuses to SERVE a file
 *  whose bytes disagree with its extension (`unusable_reason: "format-mismatch"`), and the edit button
 *  is absent on an unusable row, so anything reaching here is one of these three. */
const OUTPUT_FOR: Record<string, OutputType> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** What could not be read, in the owner's terms — thrown by the loader so the machine's guard row
 *  carries a sentence they can act on rather than "Failed to fetch". */
const UNREADABLE = "the stored image could not be read — it may have been deleted or replaced.";

export interface MediaEdit {
  /** Re-crop this entry. Silently ignored where the affordance would not be offered (see `editable`)
   *  and while a job is running — the machine's own latch. */
  start: (item: LibraryItem) => void;
}

/** Whether an entry can be edited at all — the ONE predicate, so the button and the action cannot
 *  disagree about it:
 *   · the section must be able to WRITE bytes into this role (a seat is a read-only view);
 *   · a BUNDLED entry has no file on disk to replace (it is the app's own asset, hashed by the build);
 *   · an UNUSABLE row cannot be decoded, so there is nothing to open a crop step on. */
export function editable(section: MediaSection, item: LibraryItem): boolean {
  return section.caps.upload && !item.bundled && item.row.unusable !== true;
}

export function useMediaEdit(args: {
  /** The one image-job machine, mounted by `MediaGallery` and shared with the upload consumer. */
  job: ImageJob;
  section: MediaSection | undefined;
  scope: GalleryScope;
}): MediaEdit {
  const { job, section, scope } = args;
  const qc = useQueryClient();

  /** The conditional PUT — the whole tail. The precondition is the revision read at ADMISSION, not at
   *  send: it is the revision of the bytes the owner actually cropped, and re-reading it later would
   *  defeat the guard by adopting whatever changed underneath. */
  const deliver =
    (row: { url: string; file: string; revision: string }): JobDelivery =>
    async (output, _job, control: JobControl) => {
      control.begin();
      control.setPhase("upload");
      try {
        await putBytes(row.url, output.blob, { "X-Expected-Revision": row.revision });
      } catch (error) {
        // A 412 is not retryable BY THIS JOB: the bytes on the server are not the ones this crop was
        // measured against, so re-sending it would overwrite a picture the owner has not seen. The
        // server's own sentence says the only thing that helps — reopen it.
        const stale = error instanceof ApiError && error.status === 412;
        control.fail({
          phase: "upload",
          message: stale
            ? error.message
            : error instanceof ApiError
              ? `the change was refused: ${error.message}`
              : "the change did not reach the server. Check the connection and try again.",
          filename: row.file,
          retry: stale
            ? undefined
            : control.retryable(() => void deliver(row)(output, _job, control)),
        });
        return;
      }
      // The ONE invalidation spelling in this app (`useSettings`' media save): by PREFIX, so every
      // namespace's listing re-reads, and AWAITED so the job stays busy until the gallery is showing
      // the new bytes — the URL carries `?rev=`, so nothing repaints until the fresh row lands.
      // Unbounded on purpose, unlike the settings save's: nothing computes its next write from this.
      await qc.invalidateQueries({ queryKey: ["media"] });
      control.finish();
    };

  return {
    start: (item: LibraryItem) => {
      if (section === undefined || !editable(section, item)) return;
      const type = OUTPUT_FOR[item.row.format ?? ""];
      if (type === undefined) return;
      const row = { url: item.row.url, file: item.row.file, revision: item.row.revision };
      // The bytes the GALLERY is showing — same `?rev=` URL, so a cache holding the previous picture
      // cannot hand us one crop of a file and then a precondition about another.
      const load = async (): Promise<File> => {
        let blob: Blob;
        try {
          const res = await fetch(revUrl(row.url, row.revision));
          if (!res.ok) throw new Error(String(res.status));
          blob = await res.blob();
        } catch {
          throw new Error(UNREADABLE);
        }
        // The stored NAME rides along: the crop step shows it, and the upload's minter is not in this
        // path at all — this file keeps the name it already has.
        return new File([blob], row.file, { type: blob.type });
      };
      // The LOADER, not its promise: the machine calls it once the latch is taken, so a second tap
      // starts no second download and a refused admission starts none at all.
      job.offer(load, { section, scope, export: { type }, deliver: deliver(row) });
    },
  };
}
