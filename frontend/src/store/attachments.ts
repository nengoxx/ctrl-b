// STAGED COMPOSER ATTACHMENTS (D68 / ATTACHMENTS_PLAN §7) — what the owner has attached to the
// message they have not sent yet.
//
// A module store beside the draft (`store/composer.ts`), on the same dep-free `createStore` binding
// (D23), and for the same two reasons: the composer is conditionally rendered (switching to
// Conf/Utils unmounts it), and the SEND path — `lib/composer#runComposer` → `store/chat#sendMessage`
// — has to read the staged ids from outside React entirely. Deliberately NOT persisted (unlike the
// draft): a staged file is a server-side object with a lifetime (`staging_orphan_hours`) and an
// object URL that dies with the page, so restoring a chip after a reload would show a thumbnail for
// bytes that may no longer be claimable.
//
// STATE ONLY. The pipeline that fills it (admit → downscale → PUT) is `lib/attachments.ts`, and the
// React surface is `hooks/useAttachments.ts` — same split as draft ↔ composer routing.

import { createStore } from "./createStore";

/** What the BYTES turned out to be, in the server's own vocabulary (`AttachmentKind`). Pre-upload it
 *  is the client's guess from the header/extension; once staged it is the server's sniff. */
export type AttachKind = "image" | "text" | "pdf";

/** Where one chip is in its life: the PUT is in flight · the server minted an id · it failed and
 *  carries the sentence saying why. A `failed` chip never blocks a send; an `uploading` one holds it. */
export type AttachStatus = "uploading" | "staged" | "failed";

export interface StagedAttachment {
  /** This client's own handle — the chip's React key and the address every update goes to. The
   *  server's `attachment_id` cannot serve: it does not exist until the PUT answers, and a failed
   *  upload never gets one. */
  localId: string;
  /** What the chip shows — the name the file will be stored under (already sanitised for the
   *  server's admission tier, and carrying the EXPORT's extension for a re-encoded image). */
  name: string;
  kind: AttachKind;
  status: AttachStatus;
  /** The claim credential, once the mint answers (§3). Only a `staged` row has one. */
  attachmentId?: string;
  /** An object URL of the picked file, for an image chip's thumbnail. Revoked when the chip goes. */
  previewUrl?: string;
  /** The NAMED refusal a `failed` chip renders (R62 §3.2's three-toasts lesson: say which rule). */
  error?: string;
  bytes?: number;
}

const { emit, useStore } = createStore();
let files: StagedAttachment[] = [];

/** The snapshot, for the non-React readers (the send path, the admission cap). */
export function stagedFiles(): readonly StagedAttachment[] {
  return files;
}

/** Subscribe to the staged set — the rail, the clip's counter, the send gate. */
export function useStagedFiles(): readonly StagedAttachment[] {
  return useStore(stagedFiles);
}

/** The claim credentials of everything that actually landed, in chip order (§3: the chat POST names
 *  ids and nothing else). `uploading`/`failed` rows contribute nothing — a send never waits for one
 *  and never pretends one is there. */
export function stagedIds(): string[] {
  return files.flatMap((f) => (f.status === "staged" && f.attachmentId ? [f.attachmentId] : []));
}

/** Is there anything to send BESIDES text? The other half of the attachment-only send gate (§7). */
export function hasStaged(): boolean {
  return files.length > 0;
}

/** Is a PUT still in flight? The send is HELD while one is (the R61 field convention) — a `failed`
 *  chip deliberately does not count: it will never land, and blocking on it would strand the send. */
export function isUploading(): boolean {
  return files.some((f) => f.status === "uploading");
}

export function addStaged(file: StagedAttachment): void {
  files = [...files, file];
  emit();
}

/** Patch one row by `localId` — a no-op when it is gone (the owner removed the chip mid-upload,
 *  which is the ordinary way this races). */
export function updateStaged(localId: string, patch: Partial<StagedAttachment>): void {
  if (!files.some((f) => f.localId === localId)) return;
  files = files.map((f) => (f.localId === localId ? { ...f, ...patch } : f));
  emit();
}

/** Drop one chip and release its thumbnail. The staged file on the server is left for the sweep —
 *  there is no un-stage call, and inventing one would be a write path for a file that expires by
 *  itself in `staging_orphan_hours`. */
export function removeStaged(localId: string): void {
  const gone = files.find((f) => f.localId === localId);
  if (gone === undefined) return;
  revoke(gone);
  files = files.filter((f) => f.localId !== localId);
  emit();
}

/** Everything goes — the send consumed them, or the owner cleared the composer. */
export function clearStaged(): void {
  if (files.length === 0) return;
  for (const f of files) revoke(f);
  files = [];
  emit();
}

/** Drop exactly the rows whose ids a send CONSUMED (§3: a claimed id can never be claimed again), and
 *  keep everything else — a chip added while the POST was in flight is still the owner's to send.
 *  Called on the 200/202 only: a refused send (409) keeps its chips so the owner can act on the
 *  server's own sentence. */
export function consumeStaged(ids: readonly string[]): void {
  const spent = new Set(ids);
  const kept = files.filter((f) => !(f.attachmentId !== undefined && spent.has(f.attachmentId)));
  if (kept.length === files.length) return;
  for (const f of files) if (!kept.includes(f)) revoke(f);
  files = kept;
  emit();
}

function revoke(file: StagedAttachment): void {
  if (file.previewUrl !== undefined) URL.revokeObjectURL(file.previewUrl);
}
