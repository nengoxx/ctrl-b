// THE EXPORT (D65 / MEDIA_MANAGER_PLAN §4) — the one path from a picked file to the bytes ctrl-b
// stores, and the only one: **every input is re-encoded, never forwarded.**
//
// That single rule buys four things at once, which is why "use as is" is not a bypass but a crop rect
// covering the whole picture:
//   · the CROP is applied;
//   · the output is normalised onto the served allowlist (png/jpeg/webp — a GIF or an AVIF drop-in
//     becomes a file the mount can serve);
//   · the pixels are capped to the role's own bound, so an upload can never trip the gallery's
//     oversize advisories;
//   · **EXIF, GPS and XMP are stripped** — measured in both engines (R54 §3.5): a canvas re-encode
//     emits JFIF (+ an sRGB ICC profile in Chromium) and nothing else. The owner's phone photos reach
//     a homelab panel without the coordinates of their house, and the SERVER needs no metadata
//     stripper (it has no decoder at all, by D65's own rule).
//
// ── the two probed defects this shape exists to avoid (R54, live cross-engine probes) ────────────
//
//  ① **`createImageBitmap(file, sx, sy, sw, sh)` returns the WRONG REGION on an EXIF-rotated photo in
//     Chromium** — it reads the crop rect in the PRE-orientation space while handing back an oriented
//     bitmap (its own source carries `TODO(crbug.com/40773069)` on that line; Firefox is correct). A
//     phone camera is exactly where `Orientation != 1` comes from, so this is the common case, not the
//     corner. Therefore: **decode takes a Blob and NOTHING else**, and the crop is a `drawImage`
//     source rect — pixel-identical and correct in both engines. The shape of `ExportEnv` below is
//     what makes the wrong call unwritable rather than merely discouraged.
//  ② **Chromium fails an over-limit canvas SILENTLY** — a canvas past `kMaxCanvasArea` accepts draws
//     and reads back `[0,0,0,0]` with no exception, and `toBlob` on it still produces a VALID image
//     file. The failure mode is "a fully transparent PNG lands in the media directory and passes the
//     server's magic-byte check". So the export VERIFIES rather than assumes: pixels are read back,
//     and the produced blob's own header is re-read (§`checkReadback` / `checkEncoded`).
//
// ── shape ────────────────────────────────────────────────────────────────────────────────────────
//
// PURE and injectable: `runExport` takes an `ExportEnv` (a decoder and a surface factory) and knows
// nothing about `OffscreenCanvas`, workers or the DOM. `canvasSurface`/`decodeBitmap` below are the
// real adapters, `imageExport.worker.ts` is where they meet the platform, and `exportImage` is the
// main thread's client. The policy numbers arrive from `theme-engine/mediaRegistry.ts` as arguments —
// `lib/` stays registry-free (the council H4 rider).

import { readImageHeader } from "./imageProbe";

/** The three types this app stores. Anything else `convertToBlob` might hand back is a refusal. */
export type OutputType = "image/png" | "image/jpeg" | "image/webp";

/** extension per output type — and it MUST agree with `core/media.py#ALLOWED_TYPES`, which is what
 *  decides whether the upload is admitted and what Content-Type the mount then serves. */
const EXTENSIONS: Record<OutputType, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

/** The source rect of a crop, in the DECODED image's own (already EXIF-oriented) pixel space — which
 *  is exactly the space `react-easy-crop` reports `croppedAreaPixels` in, so no conversion and no
 *  orientation bookkeeping sits between the two (R54 §2.3). */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A role's advisory ceilings (`MediaBounds`, structurally). The PIXELS half is a hard cap here — an
 *  upload that would trip the gallery's own "very large image" badge is one the export prevents. */
export interface ExportBounds {
  bytes: number;
  pixels: number;
}

/** A role's per-destination override of the format policy (`MediaExportDef`, structurally). */
export interface ExportOverride {
  /** Force this output type whatever the source was. */
  type?: OutputType;
  /** The destination NEEDS transparency, whatever the source's own type suggests. */
  alpha?: boolean;
}

/** What one export encodes as, and whether it may try again smaller. */
export interface ExportPolicy {
  type: OutputType;
  quality: number;
  /** The ONE lower quality a step-down retry may use, or `null` for a lossless type — a PNG has no
   *  quality knob, so an over-budget PNG is delivered with its badge rather than re-encoded to
   *  nothing (§4: never refuse an over-budget export). */
  stepDown: number | null;
}

/** The measured knee of the quality curve for photographic content (R54 §3.3): jpeg q0.85 lands a
 *  4 MP crop at 771–850 KB in 18–23 ms, where q0.92 costs +65 % bytes for no visible gain on a phone.
 *  WebP is asked for one notch higher because it is only chosen where ALPHA is in play — art with
 *  hard edges, where the ringing q0.85 hides in a photograph is exactly what shows. */
export const JPEG_QUALITY = 0.85;
export const WEBP_QUALITY = 0.9;
/** The one retry's quality when the first encode lands over the role's byte bound. Below the knee on
 *  purpose: a second encode that saved 5 % would not be worth its own time on a phone. */
export const STEP_DOWN_QUALITY = 0.7;
/** How far one `drawImage` may downscale before the result aliases. Past this the export halves in
 *  steps — one giant bilinear reduction loses detail whatever `imageSmoothingQuality` claims, and
 *  Gecko's `resizeQuality` is not a trustworthy alternative (R54 §4.3). */
export const MAX_DOWNSCALE_STEP = 3;
/** A floor no real encoded image is under. Paired with the pixel readback: together they are the
 *  answer to Chromium's silent canvas failure, which produces a VALID but empty file. */
export const MIN_OUTPUT_BYTES = 64;
/** Where the readback samples: the four corners and the centre, as fractions of the output. Five
 *  1×1 `getImageData` reads — a dead canvas is uniformly `[0,0,0,0]`, so any non-zero byte across
 *  these proves the allocation and the draw both happened. */
const READBACK_POINTS: readonly (readonly [number, number])[] = [
  [0.5, 0.5],
  [0.02, 0.02],
  [0.98, 0.02],
  [0.02, 0.98],
  [0.98, 0.98],
];

/** Source MIME types that CAN carry transparency. A source outside this set cannot lose alpha it
 *  never had, so jpeg is the honest (and far cheaper) encode for it. */
const ALPHA_SOURCES = new Set(["image/png", "image/webp", "image/avif", "image/gif"]);

/** How this file will be encoded (R54 §3.4).
 *
 *  The role's override wins outright — a destination that paints its file as a CSS mask, or
 *  composites three transparent layers, is not expressing a preference but a requirement, and no
 *  property of the source can override it. Otherwise: alpha possible ⇒ webp (the one format of the
 *  three that keeps it and that BOTH engines can encode — Firefox has done so since 96; Safari is the
 *  one that cannot, and is not a target); else jpeg. */
export function exportPolicy(sourceType: string, override?: ExportOverride): ExportPolicy {
  const forced = override?.type;
  if (forced !== undefined)
    return { type: forced, quality: qualityFor(forced), stepDown: stepDownFor(forced) };
  const alpha = override?.alpha === true || ALPHA_SOURCES.has(sourceType.toLowerCase());
  const type: OutputType = alpha ? "image/webp" : "image/jpeg";
  return { type, quality: qualityFor(type), stepDown: stepDownFor(type) };
}

function qualityFor(type: OutputType): number {
  // PNG has no quality knob and the argument is IGNORED for it — `1` states that rather than passing
  // a lossy default nobody reads.
  if (type === "image/png") return 1;
  return type === "image/webp" ? WEBP_QUALITY : JPEG_QUALITY;
}

function stepDownFor(type: OutputType): number | null {
  // PNG is lossless: there is no quality to step down, so the byte step is skipped entirely and an
  // over-budget export is delivered with its advisory (§4).
  return type === "image/png" ? null : STEP_DOWN_QUALITY;
}

/** The output size for one crop: the rect itself, scaled down until it fits the role's pixel bound.
 *  Never scaled UP — a small drop-in stays small rather than being blown into a soft rectangle. */
export function exportSize(rect: CropRect, maxPixels: number): { width: number; height: number } {
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const scale = Math.min(1, Math.sqrt(maxPixels / (w * h)));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** The intermediate sizes a downscale walks through, ending at the destination. One entry for the
 *  ordinary case; halving steps when the reduction is steeper than `MAX_DOWNSCALE_STEP`. */
export function downscalePlan(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { width: number; height: number }[] {
  const steps: { width: number; height: number }[] = [];
  let w = srcW;
  let h = srcH;
  while (w / dstW > MAX_DOWNSCALE_STEP && h / dstH > MAX_DOWNSCALE_STEP) {
    w = Math.max(dstW, Math.round(w / 2));
    h = Math.max(dstH, Math.round(h / 2));
    steps.push({ width: w, height: h });
  }
  const last = steps[steps.length - 1];
  if (last === undefined || last.width !== dstW || last.height !== dstH)
    steps.push({ width: dstW, height: dstH });
  return steps;
}

/** The stored extension for what the encoder ACTUALLY produced — never for what was asked. An
 *  unsupported `toBlob`/`convertToBlob` type is spec-mandated to fall back to PNG silently (HTML
 *  Standard, verbatim: *"that type is also used if the given type isn't supported"*), and R54
 *  measured it: asking for AVIF yielded a 4.3 MB PNG in both engines. Name the file from the bytes
 *  and that mismatch is impossible; name it from the request and the server answers 415. */
export function extensionFor(type: string): string | null {
  return EXTENSIONS[type as OutputType] ?? null;
}

// ── the injectable pipeline ──────────────────────────────────────────────────────────────────────

/** Anything that can be drawn FROM: the decoded source, or an intermediate downscale surface. */
export interface DrawSource {
  readonly width: number;
  readonly height: number;
  /** The platform object underneath (an `ImageBitmap`, an `OffscreenCanvas`). Opaque here — only the
   *  adapter that made it ever looks. */
  readonly raw: unknown;
}

/** A decoded image, with the deterministic release `ImageBitmap` gives us. A 12 MP photo is 48 MB of
 *  RGBA; handing it back at GC's convenience is how a phone tab dies. */
export interface DecodedImage extends DrawSource {
  close(): void;
}

/** One canvas the export draws into. `draw` takes a SOURCE RECT and always fills this whole surface,
 *  which is the crop, the downscale and the two-step walk in one operation — and it is the only way
 *  a crop can be expressed here (defect ① above). */
export interface ExportSurface extends DrawSource {
  draw(src: DrawSource, rect: CropRect): void;
  /** The RGBA of one pixel, for the readback check. */
  sample(x: number, y: number): readonly number[];
  encode(type: string, quality: number): Promise<Blob>;
  /** Release the backing canvas once nothing will draw from it again. */
  release(): void;
}

export interface ExportEnv {
  /** Decode the WHOLE file. No crop arguments exist here, deliberately — see defect ①. */
  decode(file: Blob): Promise<DecodedImage>;
  surface(width: number, height: number): ExportSurface;
}

/** One export, as posted to the worker: every field structured-cloneable. */
export interface ExportJob {
  file: Blob;
  /** The source's own MIME type, for the alpha decision. `File.type` may be empty on an Android
   *  content URI, which simply reads as "no alpha claimed" and takes the jpeg path. */
  sourceType: string;
  rect: CropRect;
  bounds: ExportBounds;
  override?: ExportOverride;
}

export interface ExportOutput {
  blob: Blob;
  /** What the encoder actually produced — the naming authority (`extensionFor`). */
  type: OutputType;
  ext: string;
  width: number;
  height: number;
  /** Over the role's advisory byte bound even after the one step-down. **Delivered anyway** (§4):
   *  the bound is advice the gallery shows as a badge, never a gate that loses the owner's work. */
  overBudget: boolean;
}

/** A refusal the caller can put in front of the owner. Its own class so a pipeline failure is
 *  distinguishable from a programming error thrown by the platform. */
export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportError";
  }
}

/** decode → crop → cap → verify → encode → (one step-down) → verify. */
export async function runExport(env: ExportEnv, job: ExportJob): Promise<ExportOutput> {
  const image = await env.decode(job.file);
  // Every surface this export makes, so a throw anywhere below still frees all of them. `release()`
  // is idempotent, which is what lets the loop ALSO release each intermediate the moment it has been
  // drawn from — the memory matters at 12 MP, and the list is only the safety net.
  const made: ExportSurface[] = [];
  try {
    const rect = clampRect(job.rect, image.width, image.height);
    const out = exportSize(rect, job.bounds.pixels);
    let src: DrawSource = image;
    let srcRect = rect;
    for (const step of downscalePlan(rect.width, rect.height, out.width, out.height)) {
      const next = env.surface(step.width, step.height);
      made.push(next);
      next.draw(src, srcRect);
      // The previous rung is finished with the moment it has been drawn from: the decoded bitmap goes
      // back immediately rather than at GC's convenience, and an intermediate canvas with it.
      if (src === image) image.close();
      else (src as ExportSurface).release();
      src = next;
      srcRect = { x: 0, y: 0, width: next.width, height: next.height };
    }
    const surface = src as ExportSurface;
    checkReadback(surface);
    const policy = exportPolicy(job.sourceType, job.override);
    let blob = await surface.encode(policy.type, policy.quality);
    if (blob.size > job.bounds.bytes && policy.stepDown !== null) {
      const smaller = await surface.encode(policy.type, policy.stepDown);
      // Keep whichever is actually smaller: a step-down that grew the file (it happens on flat art)
      // would be a worse picture for no reason at all.
      if (smaller.size < blob.size) blob = smaller;
    }
    const type = await checkEncoded(blob);
    return {
      blob,
      type,
      ext: EXTENSIONS[type],
      width: surface.width,
      height: surface.height,
      overBudget: blob.size > job.bounds.bytes,
    };
  } finally {
    // `close()` is idempotent on an ImageBitmap, so the happy path's early release costs nothing here
    // and a throw before the first draw still frees the decode.
    image.close();
    for (const surface of made) surface.release();
  }
}

/** Keep the crop inside the picture. `react-easy-crop` rounds its rect, and a rect rounded one pixel
 *  past the edge is a `drawImage` that samples nothing there — a transparent seam on one side, which
 *  is invisible in the crop UI and permanent in the stored file. */
export function clampRect(rect: CropRect, width: number, height: number): CropRect {
  const w = Math.max(1, Math.min(Math.round(rect.width), width));
  const h = Math.max(1, Math.min(Math.round(rect.height), height));
  return {
    x: Math.min(Math.max(0, Math.round(rect.x)), width - w),
    y: Math.min(Math.max(0, Math.round(rect.y)), height - h),
    width: w,
    height: h,
  };
}

/** Defect ②, first half: prove the canvas is actually THERE. Chromium accepts draws into an
 *  over-limit canvas and reads back `[0,0,0,0]` without throwing, so an unverified export can store a
 *  perfectly valid, perfectly empty picture. Five samples, and any non-zero byte is proof.
 *
 *  The false positive is a genuinely blank image — a fully transparent PNG the owner picked by
 *  mistake. Refusing that is the right answer anyway: it paints nothing wherever it lands, and the
 *  sentence says exactly what was found. */
function checkReadback(surface: ExportSurface): void {
  for (const [fx, fy] of READBACK_POINTS) {
    const x = Math.min(surface.width - 1, Math.floor(surface.width * fx));
    const y = Math.min(surface.height - 1, Math.floor(surface.height * fy));
    if (surface.sample(x, y).some((channel) => channel !== 0)) return;
  }
  throw new ExportError(
    "the cropped image came back empty — the picture may be larger than this browser can process. Try a smaller crop.",
  );
}

/** Defect ② second half, and the naming authority in one read: the produced blob's OWN header.
 *
 *  `blob.type` is a label the encoder wrote; the header is what the server will magic-byte check and
 *  what the mount will serve. Reading it here closes the whole class in one place — an unsupported
 *  type that silently became PNG, a label that disagrees with the bytes, a dead-canvas blob of a few
 *  bytes — and it is the same reader the input guard uses, so the two ends of the pipeline cannot
 *  drift into two opinions about what a PNG looks like. */
async function checkEncoded(blob: Blob): Promise<OutputType> {
  if (blob.size < MIN_OUTPUT_BYTES)
    throw new ExportError("the browser produced an empty image file. Try a smaller crop.");
  const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  const format = readImageHeader(head, blob.size).format;
  if (format === null)
    throw new ExportError("this browser produced an image format ctrl-b cannot store.");
  return ({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const)[format];
}

// ── the platform adapters ────────────────────────────────────────────────────────────────────────

/** `createImageBitmap(file)` — the whole file, EXIF applied by both engines and CSS-proof, and **no
 *  crop arguments** (defect ①). An undecodable input (HEIC that slipped past the guard, a truncated
 *  copy) rejects here, which is the pipeline's catch-all rung. */
export async function decodeBitmap(file: Blob): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(file);
  return {
    width: bitmap.width,
    height: bitmap.height,
    raw: bitmap,
    close: () => bitmap.close(),
  };
}

/** An `OffscreenCanvas` behind the `ExportSurface` contract. The factory is a parameter so the
 *  ADAPTER itself is testable — the nine-argument `drawImage` form is the whole point of this module,
 *  and a contract that is only exercised in a browser is one nothing pins. */
export function canvasSurface(
  width: number,
  height: number,
  make: (w: number, h: number) => OffscreenCanvas = (w, h) => new OffscreenCanvas(w, h),
): ExportSurface {
  const canvas = make(width, height);
  const ctx = canvas.getContext("2d");
  if (ctx === null)
    throw new ExportError("this browser could not open a drawing surface for the image.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return {
    width,
    height,
    raw: canvas,
    draw(src, rect) {
      // THE nine-argument source-rect form. Never `createImageBitmap`'s crop rect, never a three-arg
      // draw of a pre-cropped bitmap — see defect ① in the header.
      ctx.drawImage(
        src.raw as CanvasImageSource,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        width,
        height,
      );
    },
    sample: (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data),
    encode: (type, quality) => canvas.convertToBlob({ type, quality }),
    // Zeroing the canvas is how a surface is released: there is no `close()`, and a 0×0 canvas frees
    // its backing store immediately instead of at GC's convenience.
    release: () => {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

/** The real environment: a bitmap decoder and OffscreenCanvas surfaces. */
export const platformEnv: ExportEnv = {
  decode: decodeBitmap,
  surface: (w, h) => canvasSurface(w, h),
};

// ── the main thread's client ─────────────────────────────────────────────────────────────────────

/** What the worker answers with. A discriminated union rather than a rejected promise, because a
 *  worker's `onerror` carries no message worth showing anyone. */
export type WorkerReply = { ok: true; result: ExportOutput } | { ok: false; error: string };

/** Run one export in a WORKER.
 *
 *  Off the main thread because R54 measured the main-thread pipeline dropping ~4 frames at 60 Hz on a
 *  DESKTOP Gecko (max frame gap 66 ms), and a mid-range Android is 4–8× slower on this kind of work.
 *  The worker costs one 88–100 ms task for a 12 MP source and the UI never stutters.
 *
 *  One worker per export, terminated when it answers: exports are a deliberate owner gesture, not a
 *  stream, and a pooled worker would be state to own for no measurable gain. */
export function exportImage(job: ExportJob): Promise<ExportOutput> {
  return new Promise<ExportOutput>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./imageExport.worker.ts", import.meta.url), { type: "module" });
    } catch {
      reject(new ExportError("this browser cannot process images in the background."));
      return;
    }
    const done = (fn: () => void) => {
      worker.terminate();
      fn();
    };
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      done(() => (reply.ok ? resolve(reply.result) : reject(new ExportError(reply.error))));
    };
    // A worker that dies without answering (an out-of-memory kill on a big decode is the realistic
    // way) would otherwise leave this promise pending forever, and the upload latch with it.
    worker.onerror = () =>
      done(() =>
        reject(new ExportError("the image could not be processed — it may be too large.")),
      );
    worker.postMessage(job);
  });
}
