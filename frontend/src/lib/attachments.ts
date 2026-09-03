// THE ATTACHMENT PIPELINE (D68 / ATTACHMENTS_PLAN §7) — a picked file, from the owner's gesture to a
// staged id the send can name.
//
// One path, whichever gesture started it (the clip, a paste, a drop):
//
//   ADMIT, synchronously (the per-message cap + the extension tier → a chip for every file) →
//   INSPECT (images only: `guardPick`'s byte/pixel/format ladder + the thumbnail; everything else
//   takes the byte cap alone) → images only: re-encode through the media manager's export WORKER →
//   `PUT /api/attachments/staging/{name}` → the server's opaque `attachment_id`.
//
// The first phase is synchronous ON PURPOSE (S3 MED-3): the chip IS the app's answer to the gesture,
// and it is also what holds the send, so neither may wait on reading a header.
//
// **Everything here is REUSE.** `lib/imageProbe` is the same guard the media picker runs (the decode
// cap is a fact about the owner's phone, not about a media role), `lib/imageExport#exportImage` is
// the same worker (never a second encoder — §1), and `lib/uploadName#mintName` is the same
// server-admissible name minting. What is genuinely new is the KIND tiering (attachments take text
// and PDFs, which the media surface does not) and the transport.
//
// The store it fills is `store/attachments.ts`; the React surface is `hooks/useAttachments.ts`.
// Nothing here imports React — the pipeline is drivable from a test with no DOM.

import { exportImage, ExportError, type ExportOutput } from "./imageExport";
import { guardPick, readHead, sizeRefusal, type GuardLimits, type ImageHeader } from "./imageProbe";
import { mintName } from "./uploadName";
import { putBytes, ApiError } from "../api/client";
import { addStaged, stagedFiles, updateStaged, type AttachKind } from "../store/attachments";
import { UPLOAD_LIMITS } from "../theme-engine/mediaRegistry";

// ── the kind tiers ────────────────────────────────────────────────────────────────────────────────
//
// MIRRORS `core/attachments.py#ALLOWED_SUFFIXES` — the server's own admission tier, restated here so
// a file the mint would refuse by NAME is refused before it is uploaded (and so the picker can hint
// the chooser). Like `imageProbe` mirroring `probe_image`, this is a deliberate mirror of a code
// CONSTANT, not of a tunable: the tunables (`§6`) arrive from the server below. The server stays the
// authority — anything that gets past this list meets `admission_reason` and a 422.

/** Extensions whose bytes are (or may be) an image. `.gif` is here and is NOT in the media surface's
 *  allowlist: the media mount does not serve GIFs, an attachment may be one. */
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif"] as const;
/** The one kind bytes cannot authenticate — the extension IS the rule (plus the server's strict
 *  UTF-8 decode). Deliberately narrow: the owner ruled configs and logs out of scope (§0a-1). */
const TEXT_EXT = [".txt", ".md", ".csv", ".json"] as const;
const PDF_EXT = ".pdf";

/** What the file input asks the chooser for. Extensions rather than MIME types, unlike the media
 *  picker's `UPLOAD_ACCEPT`: an Android content URI routinely arrives with an empty `File.type`, and
 *  a `text/markdown` accept entry hides `.md` files in several choosers. A HINT either way — the
 *  ladder below is what actually decides. */
export const ATTACH_ACCEPT = [...IMAGE_EXT, ...TEXT_EXT, PDF_EXT].join(",");

// ── the policy the server owns (§6) ──────────────────────────────────────────────────────────────

/** The four `attachments:` knobs the CLIENT reads, in FE spelling. */
export interface AttachmentPolicy {
  maxFiles: number;
  maxFileBytes: number;
  /** The longest edge a staged photo is re-encoded to. */
  maxDimension: number;
  /** The encoder quality it is re-encoded at. */
  quality: number;
}

// ── the persisted chip thumbnail (the S6 fix wave, finding F3) ───────────────────────────────────
//
// Android Chrome discards a backgrounded tab, and the staged set is a module store: the owner came
// back from the camera app to an empty rail while the FILES were still sitting in staging for 24h.
// `store/attachments` now persists the staged rows, and a row is only worth restoring if it can be
// SEEN — the object URL of the picked file dies with the page, so the persisted picture is a small
// JPEG data URL produced by the export worker (off the main thread, out of the pixels it already had).

/** The thumbnail's longest edge and its quality. 256 is a 56px chip at any device pixel ratio a phone
 *  has, with room for the bubble snapshot to reuse it; 0.7 is the export's own `STEP_DOWN_QUALITY` —
 *  the measured point where a photograph stops paying for its bytes (R54 §3.3). */
const THUMB_MAX_DIMENSION = 256;
const THUMB_QUALITY = 0.7;
/** …and the budget ONE thumbnail may occupy (reviewer MED-6). A restorable row WITHOUT a picture
 *  beats a persist that silently fails: `savePersisted` swallows a quota error by design, so an
 *  oversized thumbnail would take the whole rail down with it rather than just itself. The per-thumb
 *  cap alone is NOT the whole bound — `max_files_per_message` has no ceiling — so the persisted
 *  projection enforces its own TOTAL budget too (`store/attachments`' `THUMB_BUDGET_CHARS`). */
const THUMB_MAX_CHARS = 64 * 1024;

/** The class defaults from `config.py#AttachmentsCfg`, mirrored for the window BEFORE the first
 *  `/api/providers` read lands — never a second opinion about the numbers, just the same starting
 *  point the server would have. */
const DEFAULTS: AttachmentPolicy = {
  maxFiles: 10,
  maxFileBytes: 10 * 1024 * 1024,
  maxDimension: 2048,
  quality: 0.85,
};

let policy: AttachmentPolicy = DEFAULTS;
let visionPrimary = false;

/** The `/api/providers` fields this module owns, as the wire spells them. */
export interface AttachmentInfoWire {
  attachments?: {
    max_files_per_message?: number;
    max_file_mb?: number;
    image_max_dimension?: number;
    image_quality?: number;
  };
  sections?: { inference?: { accepts_images?: boolean } };
}

/** Install what `GET /api/providers` said (`lib/composer#loadProviders` calls this — ONE loader for
 *  the whole response, so the caps and the vision hint can never be read from two different reads of
 *  it). Absent fields keep their defaults: an older backend simply leaves the client where it was. */
export function setAttachmentInfo(wire: AttachmentInfoWire): void {
  const a = wire.attachments;
  const mb = positive(a?.max_file_mb);
  policy = {
    maxFiles: positive(a?.max_files_per_message) ?? DEFAULTS.maxFiles,
    maxFileBytes: mb === undefined ? DEFAULTS.maxFileBytes : mb * 1024 * 1024,
    maxDimension: positive(a?.image_max_dimension) ?? DEFAULTS.maxDimension,
    quality: positive(a?.image_quality) ?? DEFAULTS.quality,
  };
  visionPrimary = wire.sections?.inference?.accepts_images === true;
}

function positive(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** The live policy — read at ADMISSION, never captured at module load, so a Conf save takes effect
 *  on the next pick without a reload (the `loadProviders` refresh is what delivers it). */
export function attachmentPolicy(): AttachmentPolicy {
  return policy;
}

/** Can the DEFAULT inference chain's primary see images (D68 §5)? Drives the quiet per-chip hint —
 *  best-effort UX, never a gate: the in-band strip is the real floor, and this knows only about the
 *  configured chain (a `/<provider>` override resolves server-side and is not reported here). */
export function primaryAcceptsImages(): boolean {
  return visionPrimary;
}

// ── the ladder ───────────────────────────────────────────────────────────────────────────────────

/** The guard's policy for an ATTACHMENT: the server's own byte cap, and the media surface's decode
 *  ceiling + head window, which are properties of the DEVICE rather than of any media role (§6's
 *  "decode guard ≥64 MP (Honor 20)" is the same number for the same reason — one place, one value). */
function guardLimits(): GuardLimits {
  return {
    maxBytes: policy.maxFileBytes,
    maxPixels: UPLOAD_LIMITS.maxPixels,
    headBytes: UPLOAD_LIMITS.headBytes,
  };
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** What this file IS as far as the CLIENT is concerned — the extension TIER, and only that (MED-4).
 *
 *  The bytes used to win here, which meant reading a header for every pick: but the image ladder only
 *  runs on image-tier files now (a format/pixel/SVG verdict on a `.md` is a verdict about the wrong
 *  thing), so there is no header left to reclassify a text file from. That is not a loss of truth —
 *  it is the same division of labour the rest of this module keeps: the client refuses what it can
 *  see cheaply, and the SERVER's sniff is the authority, arriving on the mint's own answer and
 *  overwriting `kind` on the chip. A photo the picker named `.txt` therefore uploads verbatim and
 *  comes back an image, named by the server rather than guessed at here. */
function kindOf(ext: string): AttachKind {
  if ((TEXT_EXT as readonly string[]).includes(ext)) return "text";
  return ext === PDF_EXT ? "pdf" : "image";
}

/** The pixel budget one photo is re-encoded to, expressed as `exportSize`'s own currency.
 *
 *  The knob is a LONGEST EDGE and the export caps by AREA, so the area is derived per picture: at
 *  `w*h*s²` where `s = maxDimension / max(w, h)`, `exportSize`'s `sqrt(maxPixels / (w*h))` resolves
 *  to exactly `s` — the longest edge lands on the knob and the aspect ratio is untouched. With no
 *  measurable header (the reader admits those; the decode proof is next) the square of the knob is
 *  the honest equivalent bound. */
function pixelBudget(header: ImageHeader): number {
  const { maxDimension } = policy;
  const square = maxDimension * maxDimension;
  if (header.width === null || header.height === null) return square;
  const longest = Math.max(header.width, header.height);
  if (longest <= maxDimension) return header.width * header.height; // never scaled UP
  const scale = maxDimension / longest;
  return Math.max(1, Math.round(header.width * header.height * scale * scale));
}

/** A refusal the owner can act on. Every sentence names the rule that refused it (R62 §3.2: three
 *  distinct toasts for three distinct refusals is the field's own lesson). */
function tooMany(): string {
  const n = policy.maxFiles;
  return `one message can carry up to ${n} file${n === 1 ? "" : "s"} — send these, then attach the rest.`;
}

function wrongKind(ext: string): string {
  const what = ext === "" ? "that file has no extension" : `${ext} files are not accepted`;
  return `${what} — ctrl-b takes images, .txt/.md/.csv/.json text and PDFs.`;
}

function uploadRefusal(error: unknown): string {
  if (error instanceof ExportError) return error.message;
  if (error instanceof ApiError) {
    if (error.status >= 500) return "the server could not store that file — try again in a moment.";
    return `the server refused that file: ${error.message}`;
  }
  return "that file did not reach the server. Check the connection and try again.";
}

/** How many chips COUNT against the per-message cap: a failed one never becomes an id, so it must
 *  not occupy a slot the owner could still fill. */
function admittedCount(): number {
  return stagedFiles().filter((f) => f.status !== "failed").length;
}

let seq = 0;
function nextLocalId(): string {
  seq += 1;
  return `att-${Date.now()}-${seq}`;
}

/** What the mint answered with (`api/attachments.py#StagedAttachment`). */
interface MintedRow {
  attachment_id: string;
  name: string;
  kind: AttachKind;
  mime: string;
  bytes: number;
}

/** One admitted file on its way to the mint: the row it already owns in the store, plus (images only)
 *  the export budget its header measured, so `deliver` never re-reads it. */
interface Pending {
  file: File;
  localId: string;
  kind: AttachKind;
  pixels?: number;
  sourceFormat?: ImageHeader["format"];
}

/** ADMIT the whole batch, SYNCHRONOUSLY (MED-3) — before the first `await`, so that from the owner's
 *  gesture onward every file the app took responsibility for is VISIBLE and every file it refused has
 *  said so. That is not only a UX rule: `isUploading()` is the send gate, and a file that exists
 *  nowhere yet holds nothing, so an Enter pressed straight after a drop used to send text-only and
 *  lose the picture. The admission window is now inside `uploading`.
 *
 *  The two refusals that can be judged with no bytes read live here and are per-file, so one refusal
 *  never touches the files beside it (§7): the per-message CAP (counted against the rows already in
 *  the store PLUS the ones this batch has just added — `admittedCount` reads the live set, so the
 *  overflow of a two-drops-at-once race refuses at admission rather than uploading past the cap) and
 *  the extension TIER. A refused chip keeps the FACE of what the owner picked. */
function admitAll(picked: readonly File[]): Pending[] {
  const pending: Pending[] = [];
  for (const file of picked) {
    const localId = nextLocalId();
    const ext = extensionOf(file.name);
    const kind = kindOf(ext);
    const name = file.name || "file";
    if (admittedCount() >= policy.maxFiles) {
      addStaged({ localId, name, kind, status: "failed", error: tooMany() });
      continue;
    }
    if (![...IMAGE_EXT, ...TEXT_EXT, PDF_EXT].includes(ext)) {
      addStaged({ localId, name, kind, status: "failed", error: wrongKind(ext) });
      continue;
    }
    // The PROVISIONAL row: the name and the kind the extension gives us, no preview yet (an object
    // URL for a file we may be about to refuse is a leak waiting for an exit path). `inspect` fills
    // in the thumbnail; the mint's answer replaces the name and the kind.
    addStaged({ localId, name, kind, status: "uploading", bytes: file.size });
    pending.push({ file, localId, kind });
  }
  return pending;
}

/** The rest of the ladder — the part that needs bytes. Returns the row to upload, or `null` when it
 *  was refused (its chip already carries the named sentence).
 *
 *  MED-4 — the IMAGE ladder runs on image-tier files ONLY. A `.md` or a PDF gets the byte cap (the
 *  same sentence, from the same function) and nothing else: refusing a text file for "being" an SVG,
 *  or for a pixel count read out of prose, is a verdict about the wrong thing, and the server already
 *  refuses dishonest bytes by its own rules (strict UTF-8 / its sniff) with a sentence the chip
 *  shows. */
async function inspect(row: Pending): Promise<Pending | null> {
  const { file, localId, kind } = row;
  const fail = (error: string): null => {
    updateStaged(localId, { status: "failed", error });
    return null;
  };
  if (kind !== "image") {
    const refusal = sizeRefusal(file.size, policy.maxFileBytes, "file");
    return refusal === null ? row : fail(refusal);
  }
  let header: ImageHeader;
  try {
    const verdict = guardPick(file.size, await readHead(file, guardLimits()), guardLimits());
    if (!verdict.ok) return fail(verdict.reason);
    header = verdict.header;
  } catch {
    return fail("that file could not be read from this device. Try picking it again.");
  }
  // The thumbnail is the PICKED file, available now — the re-encode happens after the chip is on
  // screen, and a 2048px webp would look identical in a 56px square.
  updateStaged(localId, { previewUrl: URL.createObjectURL(file) });
  return { ...row, pixels: pixelBudget(header), sourceFormat: header.format };
}

/** Re-encode (images only) and PUT. Every exit updates the chip — there is no silent outcome. */
async function deliver(entry: Pending) {
  const { file, localId, kind } = entry;
  try {
    let blob: Blob = file;
    let ext = extensionOf(file.name);
    /** The persisted face of an image chip (F3) — undefined for a text/PDF row (their chip is a glyph
     *  and a name, both of which the persisted row already carries) and for a picture whose thumbnail
     *  the platform could not make or that came back over the budget. */
    let thumb: string | undefined;
    if (kind === "image") {
      const output: ExportOutput = await exportImage({
        file,
        sourceFormat: entry.sourceFormat ?? null,
        // The WHOLE picture: attachments have no crop step (§7's "crop-before-send" is recorded, not
        // built), so the rect is the source and the cap does the work.
        rect: { x: 0, y: 0, width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
        bounds: { bytes: policy.maxFileBytes, pixels: entry.pixels ?? policy.maxDimension ** 2 },
        override: { quality: policy.quality },
        // The one caller that asks for the optional thumbnail arm (F3). Free here: the worker has the
        // decoded pixels open anyway, and it is the only place they exist off the main thread.
        thumb: { maxDimension: THUMB_MAX_DIMENSION, quality: THUMB_QUALITY },
      });
      blob = output.blob;
      ext = output.ext; // the name follows the BYTES the encoder produced, never the request (R54)
      // MED-6 — an over-budget thumbnail is DROPPED, never truncated and never persisted: the row is
      // still restorable, it just comes back wearing the kind's glyph instead of the picture.
      if (output.thumbDataUrl !== undefined && output.thumbDataUrl.length <= THUMB_MAX_CHARS)
        thumb = output.thumbDataUrl;
    }
    // Minted against an EMPTY taken-set: the server resolves collisions at claim, when the thread
    // finally exists (§3's candidate-name-at-mint). What `mintName` buys here is the rest of its
    // contract — a sanitised, byte-budgeted, admission-safe name the mint cannot refuse.
    const name = mintName(file.name, ext, [], UPLOAD_LIMITS);
    const row = await putBytes<MintedRow>(
      `/api/attachments/staging/${encodeURIComponent(name)}`,
      blob,
    );
    // The SERVER's answers win: the name it admitted, and the kind/size its own sniff decided. The
    // thumbnail rides the SAME patch, so the row becomes `staged` and persistable in one write.
    updateStaged(localId, {
      status: "staged",
      attachmentId: row.attachment_id,
      name: row.name,
      kind: row.kind,
      bytes: row.bytes,
      ...(thumb === undefined ? {} : { thumb }),
    });
  } catch (error) {
    updateStaged(localId, { status: "failed", error: uploadRefusal(error) });
  }
}

/** THE ENTRANCE — the clip, a paste and a drop all arrive here (§7). Three phases, in this order for
 *  three different reasons: ADMIT the batch synchronously (MED-3 — every chip exists before anything
 *  awaits), INSPECT each file (the guard ladder + the thumbnail: cheap, no decode, so the whole batch
 *  gets its face before any upload starts), then UPLOAD one at a time — two 12 MP exports in flight
 *  is two decoded bitmaps on a phone, and the chips already say what is happening.
 *
 *  Never rejects: a per-file failure is a `failed` chip, and the files beside it carry on. */
export async function offerFiles(picked: readonly File[]): Promise<void> {
  const admitted: Pending[] = [];
  for (const row of admitAll(picked)) {
    const ok = await inspect(row);
    if (ok !== null) admitted.push(ok);
  }
  for (const entry of admitted) await deliver(entry);
}

/** Files out of a `DataTransfer` — a drop or a paste. The `items` walk is the FALLBACK the plan
 *  names (§7): `DataTransfer.files` is empty for some paste sources (and for a drag in older
 *  Gecko), while `items` carries the same payload as `kind: "file"` entries. */
export function filesFrom(data: DataTransfer | null): File[] {
  if (data === null) return [];
  if (data.files.length > 0) return [...data.files];
  return [...(data.items ?? [])]
    .filter((i) => i.kind === "file")
    .flatMap((i) => {
      const f = i.getAsFile();
      return f === null ? [] : [f];
    });
}
