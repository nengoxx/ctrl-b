// THE ATTACHMENT PIPELINE (D68 / ATTACHMENTS_PLAN §7) — a picked file, from the owner's gesture to a
// staged id the send can name.
//
// One path, whichever gesture started it (the clip, a paste, a drop):
//
//   admit (extension tier → `guardPick`'s byte/pixel/format ladder) → CLASSIFY from the bytes →
//   images only: re-encode through the media manager's export WORKER → `PUT /api/attachments/staging/
//   {name}` → the server's opaque `attachment_id`.
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
import { guardPick, readHead, type GuardLimits, type ImageHeader } from "./imageProbe";
import { mintName } from "./uploadName";
import { putBytes, ApiError } from "../api/client";
import {
  addStaged,
  stagedFiles,
  updateStaged,
  type AttachKind,
  type StagedAttachment,
} from "../store/attachments";
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

/** What this file IS, for the chip and for whether it gets re-encoded. The BYTES win where they can
 *  speak (a photo the picker named `.txt` is an image, exactly as the server sniffs it); the
 *  extension tier answers for everything else — including an image-tier file this reader cannot
 *  measure (a GIF, a JPEG whose frame header sits past the head), which is still an image. */
function kindOf(ext: string, header: ImageHeader): AttachKind {
  if (header.format !== null) return "image";
  if (ext === PDF_EXT) return "pdf";
  return (TEXT_EXT as readonly string[]).includes(ext) ? "text" : "image";
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

/** ADMIT one file: the ladder, then a chip. Returns the row to upload, or `null` when the file was
 *  refused (a `failed` chip already carries the sentence) — per-file, so one refusal never touches
 *  the files beside it (§7). */
async function admit(file: File): Promise<{ file: File; entry: StagedAttachment } | null> {
  const localId = nextLocalId();
  const ext = extensionOf(file.name);
  // A refused chip keeps the FACE of what the owner picked (a photo that was too large still reads
  // as a photo) — the kind is the extension tier's, since the bytes never got a verdict.
  const fail = (error: string): null => {
    const kind: AttachKind = (IMAGE_EXT as readonly string[]).includes(ext)
      ? "image"
      : ext === PDF_EXT
        ? "pdf"
        : "text";
    addStaged({ localId, name: file.name || "file", kind, status: "failed", error });
    return null;
  };
  if (admittedCount() >= policy.maxFiles) return fail(tooMany());
  if (![...IMAGE_EXT, ...TEXT_EXT, PDF_EXT].includes(ext)) return fail(wrongKind(ext));

  let header: ImageHeader;
  try {
    const verdict = guardPick(file.size, await readHead(file, guardLimits()), guardLimits());
    if (!verdict.ok) return fail(verdict.reason);
    header = verdict.header;
  } catch {
    return fail("that file could not be read from this device. Try picking it again.");
  }

  const kind = kindOf(ext, header);
  const entry: StagedAttachment = {
    localId,
    name: file.name,
    kind,
    status: "uploading",
    bytes: file.size,
    // The thumbnail is the PICKED file, available now — the re-encode happens after the chip is on
    // screen, and a 2048px webp would look identical in a 56px square.
    ...(kind === "image" ? { previewUrl: URL.createObjectURL(file) } : {}),
  };
  addStaged(entry);
  return { file, entry: { ...entry, ...pixelPlan(header) } };
}

/** The per-file export budget, carried on the entry so `deliver` does not re-read the header. */
function pixelPlan(header: ImageHeader): { pixels?: number; sourceFormat?: ImageHeader["format"] } {
  return { pixels: pixelBudget(header), sourceFormat: header.format };
}

/** Re-encode (images only) and PUT. Every exit updates the chip — there is no silent outcome. */
async function deliver(file: File, entry: StagedAttachment & ReturnType<typeof pixelPlan>) {
  const { localId, kind } = entry;
  try {
    let blob: Blob = file;
    let ext = extensionOf(file.name);
    if (kind === "image") {
      const output: ExportOutput = await exportImage({
        file,
        sourceFormat: entry.sourceFormat ?? null,
        // The WHOLE picture: attachments have no crop step (§7's "crop-before-send" is recorded, not
        // built), so the rect is the source and the cap does the work.
        rect: { x: 0, y: 0, width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
        bounds: { bytes: policy.maxFileBytes, pixels: entry.pixels ?? policy.maxDimension ** 2 },
        override: { quality: policy.quality },
      });
      blob = output.blob;
      ext = output.ext; // the name follows the BYTES the encoder produced, never the request (R54)
    }
    // Minted against an EMPTY taken-set: the server resolves collisions at claim, when the thread
    // finally exists (§3's candidate-name-at-mint). What `mintName` buys here is the rest of its
    // contract — a sanitised, byte-budgeted, admission-safe name the mint cannot refuse.
    const name = mintName(file.name, ext, [], UPLOAD_LIMITS);
    const row = await putBytes<MintedRow>(
      `/api/attachments/staging/${encodeURIComponent(name)}`,
      blob,
    );
    // The SERVER's answers win: the name it admitted, and the kind/size its own sniff decided.
    updateStaged(localId, {
      status: "staged",
      attachmentId: row.attachment_id,
      name: row.name,
      kind: row.kind,
      bytes: row.bytes,
    });
  } catch (error) {
    updateStaged(localId, { status: "failed", error: uploadRefusal(error) });
  }
}

/** THE ENTRANCE — the clip, a paste and a drop all arrive here (§7). Admits every file first (so
 *  every chip appears at once), then uploads them one at a time: two 12 MP exports in flight is two
 *  decoded bitmaps on a phone, and the chips already say what is happening.
 *
 *  Never rejects: a per-file failure is a `failed` chip, and the files beside it carry on. */
export async function offerFiles(picked: readonly File[]): Promise<void> {
  const admitted: { file: File; entry: StagedAttachment & ReturnType<typeof pixelPlan> }[] = [];
  for (const file of picked) {
    const ok = await admit(file);
    if (ok !== null) admitted.push(ok);
  }
  for (const { file, entry } of admitted) await deliver(file, entry);
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
