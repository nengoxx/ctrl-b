import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  canvasSurface,
  clampRect,
  downscalePlan,
  exportPolicy,
  exportSize,
  extensionFor,
  exportImage,
  runExport,
  SENTINEL_RGBA,
  JPEG_QUALITY,
  STEP_DOWN_QUALITY,
  WEBP_QUALITY,
  type CropRect,
  type DecodedImage,
  type ExportEnv,
  type ExportSurface,
} from "../../src/lib/imageExport";

// THE EXPORT (D65 / MEDIA_MANAGER_PLAN §4) — decode → crop → cap → verify → encode, unit-tested by
// INJECTION.
//
// A worker cannot be unit-tested and a canvas does not exist in jsdom, which is exactly why
// `runExport` takes its platform as an argument: the fake below is a decoder that records its calls
// and a surface that hands back real image bytes, so every RULE of the pipeline is an ordinary test
// while `imageExport.worker.ts` stays thirty lines of plumbing with no rule in it.
//
// The arms are the two probed cross-engine defects and the four policy rules R54 measured:
//  ① the decoder is handed the FILE and nothing else — `createImageBitmap`'s crop-rect form returns
//     the wrong region on an EXIF-rotated photo in Chromium, so the crop must be a `drawImage` source
//     rect, and the shape of `ExportEnv` is what makes the wrong call unwritable;
//  ② the output is VERIFIED, not assumed — Chromium fails an over-limit canvas silently and still
//     produces a valid image file, so pixels are read back and the produced blob's own header re-read;
//  ③ the stored type comes from the BYTES, never from what was asked for (an unsupported type is
//     spec-mandated to become PNG silently);
//  ④ one step-down retry over the role's byte bound, none at all for a lossless type, and an
//     over-budget export is DELIVERED with its advisory rather than refused.

const IMAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "images");
// `Uint8Array.from`, not `new Uint8Array(buffer)`: a node Buffer types as `ArrayBufferLike`, which
// is not a `BlobPart`. Copying once here keeps every arm free of casts.
const bytes = (name: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(readFileSync(join(IMAGES, name)));

/** A blob whose BYTES are a real image and whose `type` label is whatever the arm wants to claim —
 *  the only way to test that the label is not what gets believed. */
const blobOf = (fixture: string, type: string, pad = 0): Blob =>
  new Blob([bytes(fixture), new Uint8Array(pad)], { type });

const RECT: CropRect = { x: 10, y: 20, width: 400, height: 300 };
const BOUNDS = { bytes: 1_500_000, pixels: 4_000_000 };

interface Recorder {
  env: ExportEnv;
  decoded: Blob[];
  draws: { width: number; height: number; rect: CropRect }[];
  encodes: { type: string; quality: number }[];
  released: number;
  closed: number;
  probes: number;
}

/** The fake platform. `encodes` is a QUEUE of answers so the step-down arms can make the first encode
 *  land over the bound and the second under it; `alive` is what the CANVAS PROBE answers. */
function recorder(
  opts: {
    image?: { width: number; height: number };
    blobs?: Blob[];
    /** The CANVAS answers this — never the owner's art (Emma #5). */
    alive?: boolean;
  } = {},
): Recorder {
  const answers = [...(opts.blobs ?? [blobOf("jpeg-5x4.jpg", "image/jpeg")])];
  const rec: Recorder = {
    decoded: [],
    draws: [],
    encodes: [],
    released: 0,
    closed: 0,
    probes: 0,
    env: {
      decode: (file) => {
        rec.decoded.push(file);
        const image: DecodedImage = {
          width: opts.image?.width ?? 1200,
          height: opts.image?.height ?? 900,
          raw: "bitmap",
          close: () => {
            rec.closed++;
          },
        };
        return Promise.resolve(image);
      },
      surface: (width, height) => {
        const surface: ExportSurface = {
          width,
          height,
          raw: `canvas-${width}x${height}`,
          draw: (_src, rect) => rec.draws.push({ width, height, rect }),
          probe: () => {
            rec.probes++;
            return opts.alive ?? true;
          },
          encode: (type, quality) => {
            rec.encodes.push({ type, quality });
            return Promise.resolve(answers.length > 1 ? (answers.shift() as Blob) : answers[0]);
          },
          release: () => {
            rec.released++;
          },
        };
        return surface;
      },
    },
  };
  return rec;
}

describe("exportPolicy — always re-encode, and what to", () => {
  it("sends an alpha-capable source to webp, and a photograph to jpeg", () => {
    expect(exportPolicy("png")).toEqual({
      type: "image/webp",
      quality: WEBP_QUALITY,
      stepDown: STEP_DOWN_QUALITY,
    });
    expect(exportPolicy("webp").type).toBe("image/webp");
    expect(exportPolicy("jpeg")).toEqual({
      type: "image/jpeg",
      quality: JPEG_QUALITY,
      stepDown: STEP_DOWN_QUALITY,
    });
  });

  it("an UNKNOWN format keeps alpha — the asymmetry is deliberate (Emma #3)", () => {
    // This arm replaces one that asserted the opposite. The format is what the header reader PROVED,
    // and `null` means it could not name it — an AVIF, a GIF, a file whose JPEG frame header sat past
    // the head we read. Choosing jpeg there is a permanent, silent flattening of a transparent
    // picture; choosing webp costs milliseconds and kilobytes. Only a byte-proven jpeg loses alpha,
    // because it never had any.
    expect(exportPolicy(null).type).toBe("image/webp");
  });

  it("lets a role FORCE its type — and a lossless one skips the byte step-down", () => {
    // `kit/brand` paints its file as a CSS mask (only the alpha is read) and `frontier/stack`
    // composites three transparent layers: a lossy edge is a halo in both.
    expect(exportPolicy("jpeg", { type: "image/png" })).toEqual({
      // quality `1` because PNG has no quality knob — the argument is ignored for a lossless type.
      type: "image/png",
      quality: 1,
      stepDown: null,
    });
  });

  it("honours a role that REQUIRES alpha over a source that suggests none", () => {
    expect(exportPolicy("jpeg", { alpha: true }).type).toBe("image/webp");
  });
});

describe("exportSize · downscalePlan · clampRect", () => {
  it("caps the output to the role's pixel bound and never scales UP", () => {
    expect(exportSize({ x: 0, y: 0, width: 4000, height: 3000 }, 4_000_000)).toEqual({
      width: 2309,
      height: 1732,
    });
    expect(exportSize({ x: 0, y: 0, width: 100, height: 80 }, 4_000_000)).toEqual({
      width: 100,
      height: 80,
    });
  });

  it("walks a steep downscale in halving steps, ending exactly at the destination", () => {
    // One giant bilinear reduction aliases whatever `imageSmoothingQuality` claims, and Gecko's
    // `resizeQuality` is not a trustworthy alternative (R54 §4.3).
    expect(downscalePlan(400, 300, 200, 150)).toEqual([{ width: 200, height: 150 }]);
    const steep = downscalePlan(8000, 6000, 500, 375);
    expect(steep.length).toBeGreaterThan(1);
    expect(steep[steep.length - 1]).toEqual({ width: 500, height: 375 });
    for (const [i, step] of steep.entries()) {
      const from = i === 0 ? { width: 8000, height: 6000 } : steep[i - 1];
      expect(from.width / step.width).toBeLessThanOrEqual(3);
    }
  });

  it("keeps a rounded crop rect inside the picture", () => {
    // `react-easy-crop` rounds its rect; one pixel past the edge is a transparent seam in the stored
    // file that nothing in the crop UI would have shown.
    expect(clampRect({ x: -5, y: 0, width: 120.6, height: 80.4 }, 100, 60)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 60,
    });
    expect(clampRect({ x: 90, y: 50, width: 40, height: 40 }, 100, 60)).toEqual({
      x: 60,
      y: 20,
      width: 40,
      height: 40,
    });
  });

  it("names the extension for what was PRODUCED, and nothing else", () => {
    expect(extensionFor("image/jpeg")).toBe(".jpg");
    expect(extensionFor("image/png")).toBe(".png");
    expect(extensionFor("image/webp")).toBe(".webp");
    expect(extensionFor("image/avif")).toBeNull();
  });
});

describe("runExport", () => {
  it("hands the DECODER the file and nothing else, and the crop to drawImage", async () => {
    // Defect ①. `createImageBitmap(file, sx, sy, sw, sh)` returns the wrong region on an EXIF-rotated
    // photo in Chromium (its own `TODO(crbug.com/40773069)`), and a phone camera is where rotated
    // photos come from. The crop must be the DRAW's source rect.
    const rec = recorder();
    const file = new Blob([bytes("photo-64x48.png")], { type: "image/png" });
    await runExport(rec.env, { file, sourceFormat: "png", rect: RECT, bounds: BOUNDS });
    expect(rec.decoded).toEqual([file]);
    expect(rec.draws).toEqual([{ width: 400, height: 300, rect: RECT }]);
  });

  it("names the output from the produced BYTES, not from the blob's own label", async () => {
    // Defect ③: an unsupported `convertToBlob` type silently yields PNG — measured in both engines,
    // where asking for AVIF returned a 4.3 MB PNG. A file named from the REQUEST would be a 415 the
    // owner cannot explain.
    const rec = recorder({ blobs: [blobOf("png-2x3.png", "image/webp")] });
    const out = await runExport(rec.env, {
      file: new Blob([]),
      sourceFormat: "png",
      rect: RECT,
      bounds: BOUNDS,
    });
    expect(rec.encodes[0].type).toBe("image/webp");
    expect(out.type).toBe("image/png");
    expect(out.ext).toBe(".png");
    expect(out).toMatchObject({ width: 400, height: 300, overBudget: false });
  });

  it("refuses a surface that is not THERE — before anything is drawn into it", async () => {
    // Defect ②. Chromium accepts draws into an over-limit canvas and reads back `[0,0,0,0]` with no
    // exception — and `toBlob` on that canvas still produces a perfectly valid image file, which
    // passes the server's magic-byte check. Verify, never assume.
    const rec = recorder({ alive: false });
    await expect(
      runExport(rec.env, {
        file: new Blob([]),
        sourceFormat: "png",
        rect: RECT,
        bounds: BOUNDS,
      }),
    ).rejects.toThrow(/could not make a drawing surface/);
    // …and it is asked BEFORE the draw, so a dead canvas never even sees the owner's picture.
    expect(rec.draws).toEqual([]);
    expect(rec.encodes).toEqual([]);
  });

  it("EXPORTS sparse transparent art — the check is about the CANVAS, not the picture (Emma #5)", async () => {
    // The arm the first version of this suite could not tell apart from a dead canvas. A small
    // off-centre glyph, a corner decoration, a mask silhouette — every one of them is transparent at
    // the centre and at all four corners, and every one of them was refused with a sentence about the
    // picture being too large for the device. The canvas answers for the canvas.
    const rec = recorder();
    const out = await runExport(rec.env, {
      file: new Blob([]),
      sourceFormat: "png",
      rect: RECT,
      bounds: BOUNDS,
    });
    expect(out.blob.size).toBeGreaterThan(0);
    expect(rec.probes).toBeGreaterThan(0);
  });

  it("refuses a blob under the byte floor", async () => {
    const rec = recorder({ blobs: [new Blob([new Uint8Array(8)], { type: "image/png" })] });
    await expect(
      runExport(rec.env, {
        file: new Blob([]),
        sourceFormat: "png",
        rect: RECT,
        bounds: BOUNDS,
      }),
    ).rejects.toThrow(/empty image file/);
  });

  it("steps down ONCE over the byte bound, and keeps the smaller result", async () => {
    const big = blobOf("jpeg-5x4.jpg", "image/jpeg", 900);
    const small = blobOf("jpeg-5x4.jpg", "image/jpeg", 10);
    const rec = recorder({ blobs: [big, small] });
    const out = await runExport(rec.env, {
      file: new Blob([]),
      sourceFormat: "jpeg",
      rect: RECT,
      bounds: { ...BOUNDS, bytes: 500 },
    });
    expect(rec.encodes).toEqual([
      { type: "image/jpeg", quality: JPEG_QUALITY },
      { type: "image/jpeg", quality: STEP_DOWN_QUALITY },
    ]);
    expect(out.blob).toBe(small);
    expect(out.overBudget).toBe(false);
  });

  it("keeps the FIRST encode when the step-down grew the file", async () => {
    const first = blobOf("jpeg-5x4.jpg", "image/jpeg", 10);
    const worse = blobOf("jpeg-5x4.jpg", "image/jpeg", 900);
    const rec = recorder({ blobs: [first, worse] });
    const out = await runExport(rec.env, {
      file: new Blob([]),
      sourceFormat: "jpeg",
      rect: RECT,
      bounds: { ...BOUNDS, bytes: 100 },
    });
    expect(out.blob).toBe(first);
    // …and it is still over budget, so it is DELIVERED with the advisory (§4: never refuse).
    expect(out.overBudget).toBe(true);
  });

  it("never steps down a LOSSLESS export — it delivers it with the badge instead", async () => {
    const rec = recorder({ blobs: [blobOf("png-2x3.png", "image/png", 900)] });
    const out = await runExport(rec.env, {
      file: new Blob([]),
      sourceFormat: "png",
      rect: RECT,
      bounds: { ...BOUNDS, bytes: 100 },
      override: { type: "image/png" },
    });
    expect(rec.encodes).toEqual([{ type: "image/png", quality: 1 }]);
    expect(out.overBudget).toBe(true);
    expect(out.blob.size).toBeGreaterThan(100);
  });

  it("frees the decode and every surface, on the happy path and on a throw", async () => {
    // A 12 MP source is 48 MB of RGBA. Handing it back at GC's convenience is how a phone tab dies.
    const rec = recorder();
    await runExport(rec.env, {
      file: new Blob([]),
      sourceFormat: "jpeg",
      rect: RECT,
      bounds: BOUNDS,
    });
    expect(rec.closed).toBeGreaterThan(0);
    expect(rec.released).toBeGreaterThan(0);

    const failing = recorder({ alive: false });
    await expect(
      runExport(failing.env, {
        file: new Blob([]),
        sourceFormat: "jpeg",
        rect: RECT,
        bounds: BOUNDS,
      }),
    ).rejects.toThrow();
    expect(failing.closed).toBeGreaterThan(0);
    expect(failing.released).toBeGreaterThan(0);
  });
});

describe("canvasSurface — the adapter's own contract", () => {
  it("draws with the NINE-argument source-rect form", () => {
    // The rule this whole module exists for, pinned where it is actually spelled. A three-argument
    // draw of a pre-cropped bitmap is the shape that carries Chromium's crop defect into the file.
    const ctx = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([1, 2, 3, 4]) })),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      convertToBlob: vi.fn(() => Promise.resolve(new Blob())),
    };
    const surface = canvasSurface(200, 100, () => canvas as unknown as OffscreenCanvas);
    surface.draw(
      { width: 800, height: 600, raw: "bitmap" },
      { x: 5, y: 7, width: 400, height: 200 },
    );

    expect(ctx.drawImage).toHaveBeenCalledWith("bitmap", 5, 7, 400, 200, 0, 0, 200, 100);
    expect(ctx.imageSmoothingEnabled).toBe(true);
    expect(ctx.imageSmoothingQuality).toBe("high");

    surface.release();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });
});

describe("canvasSurface#probe — the sentinel, and its cleanup", () => {
  /** A canvas whose `getImageData` answers with whatever the last `fillRect`/`clearRect` said — the
   *  minimum a sentinel round-trip needs, and enough to catch the two ways this can be wrong. */
  const stubCanvas = (readback: (written: number[] | null) => number[]) => {
    let written: number[] | null = null;
    const ctx = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      fillStyle: "",
      fillRect: vi.fn(() => {
        const m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(ctx.fillStyle);
        written = m ? [+m[1], +m[2], +m[3], Math.round(+m[4] * 255)] : null;
      }),
      clearRect: vi.fn(() => {
        written = null;
      }),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(readback(written)) })),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      convertToBlob: vi.fn(() => Promise.resolve(new Blob())),
    };
    return { ctx, canvas };
  };

  it("writes the sentinel, reads it back, and CLEARS it before anything is drawn", () => {
    const { ctx, canvas } = stubCanvas((w) => w ?? [0, 0, 0, 0]);
    const surface = canvasSurface(4, 4, () => canvas as unknown as OffscreenCanvas);
    expect(surface.probe()).toBe(true);
    // Cleared, not left for the draw to cover: an image WITH ALPHA composites over what is already
    // there, so a surviving sentinel is a stray coloured pixel in the owner's stored file.
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 1, 1);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1, 1);
  });

  it("…and says NO when the backing store swallows it — Chromium's silent failure", () => {
    const { canvas } = stubCanvas(() => [0, 0, 0, 0]);
    const surface = canvasSurface(4, 4, () => canvas as unknown as OffscreenCanvas);
    expect(surface.probe()).toBe(false);
  });

  it("does not mistake a channel swap for a healthy canvas", () => {
    const [r, g, b, a] = SENTINEL_RGBA;
    const { canvas } = stubCanvas(() => [g, r, b, a]);
    const surface = canvasSurface(4, 4, () => canvas as unknown as OffscreenCanvas);
    expect(surface.probe()).toBe(false);
  });
});

describe("exportImage — the worker CLIENT's own contract", () => {
  /** A worker that never exists, driven by hand. The real one cannot be constructed in jsdom, and the
   *  paths that matter here are the ones that only run when something has already gone wrong. */
  function fakeWorker() {
    const worker = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      onerror: null as (() => void) | null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    return worker;
  }
  const JOB = {
    file: new Blob([]),
    sourceFormat: "png" as const,
    rect: RECT,
    bounds: BOUNDS,
  };

  it("resolves the worker's result and terminates", async () => {
    const worker = fakeWorker();
    const promise = exportImage(JOB, () => worker as unknown as Worker);
    expect(worker.postMessage).toHaveBeenCalledWith(JOB);
    worker.onmessage?.({ data: { ok: true, result: { blob: new Blob(), ext: ".webp" } } });
    await expect(promise).resolves.toMatchObject({ ext: ".webp" });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects with the worker's OWN sentence when the pipeline refused", async () => {
    const worker = fakeWorker();
    const promise = exportImage(JOB, () => worker as unknown as Worker);
    worker.onmessage?.({ data: { ok: false, error: "the cropped image came back empty" } });
    await expect(promise).rejects.toThrow(/came back empty/);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects — and terminates — when the worker DIES without answering", async () => {
    // The realistic way: an out-of-memory kill on a big decode. Unhandled, the promise stays pending
    // forever and the upload latch with it.
    const worker = fakeWorker();
    const promise = exportImage(JOB, () => worker as unknown as Worker);
    worker.onerror?.();
    await expect(promise).rejects.toThrow(/could not be processed/);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("settles ONCE and terminates ONCE, whatever else the worker sends afterwards", async () => {
    const worker = fakeWorker();
    const promise = exportImage(JOB, () => worker as unknown as Worker);
    worker.onmessage?.({ data: { ok: true, result: { blob: new Blob(), ext: ".webp" } } });
    // A duplicate reply, and an error after the answer — both are things a dying worker does.
    worker.onmessage?.({ data: { ok: false, error: "second thoughts" } });
    worker.onerror?.();
    await expect(promise).resolves.toMatchObject({ ext: ".webp" });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects rather than throwing when the worker cannot be constructed at all", async () => {
    await expect(
      exportImage(JOB, () => {
        throw new Error("no workers here");
      }),
    ).rejects.toThrow(/cannot process images in the background/);
  });
});
