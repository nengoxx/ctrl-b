import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { guardPick, readHead, readImageHeader, type GuardLimits } from "../../src/lib/imageProbe";

// The INPUT GUARD (D65 / MEDIA_MANAGER_PLAN §4) — fenced by REAL FILES, which is the whole point.
//
// A header parser tested against hand-written byte arrays tests the AUTHOR's belief about the format,
// which is exactly the belief under test. So every arm below reads a file `scripts/gen-test-images.mjs`
// produced with `sharp` — one per branch of the reader (PNG · baseline JPEG · progressive JPEG · an
// EXIF-rotated JPEG · all three WebP flavours), plus the arms a well-formed corpus cannot contain: a
// truncation, a lying extension, the formats we refuse by name, and one crafted header that CLAIMS
// more pixels than the file could hold.
//
// The claims that would cost the most to get wrong:
//  · the reader reports the ENCODED size of an EXIF-rotated photo (400×200, not the displayed
//    200×400) — that is the number a DECODE guard is about;
//  · the EXTENSION is never consulted: `lying.png` holding JPEG bytes reads as a jpeg;
//  · a signature alone is not a format — a file that stops inside its own header is refused rather
//    than measured from bytes that are not there;
//  · a header claiming 400 megapixels is refused BEFORE any decoder sees it, which is the one thing
//    standing between the owner's phone and Chrome Android's `totalRAM / 25` cap (R54 §4.1).

const IMAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "images");
// `Uint8Array.from`, not `new Uint8Array(buffer)`: a node Buffer types as `ArrayBufferLike`, which
// is not a `BlobPart`. Copying once here keeps every arm free of casts.
const bytes = (name: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(readFileSync(join(IMAGES, name)));

/** Deliberately NOT `UPLOAD_LIMITS`: the arms state their own policy, so a change to the shipped
 *  numbers is a change to the registry's own test and never a silent rewrite of these expectations. */
const LIMITS: GuardLimits = { maxBytes: 1_000_000, maxPixels: 64_000_000, headBytes: 65_536 };

/** The reader takes the head plus the WHOLE file's length (two WebP branches need it). */
const header = (name: string) => {
  const buf = bytes(name);
  return readImageHeader(buf, buf.length);
};

const guard = (name: string, limits: GuardLimits = LIMITS) => {
  const buf = bytes(name);
  return guardPick(buf.length, buf, limits);
};

describe("readImageHeader — the well-formed corpus", () => {
  it("reads a PNG's IHDR", () => {
    expect(header("png-2x3.png")).toMatchObject({ format: "png", width: 2, height: 3 });
  });

  it("reads a baseline JPEG's SOF0", () => {
    expect(header("jpeg-5x4.jpg")).toMatchObject({ format: "jpeg", width: 5, height: 4 });
  });

  it("walks past the extra tables of a PROGRESSIVE JPEG to its SOF2", () => {
    expect(header("jpeg-progressive-9x7.jpg")).toMatchObject({
      format: "jpeg",
      width: 9,
      height: 7,
    });
  });

  it("reports an EXIF-rotated photo's ENCODED size, not its displayed one", () => {
    // `Orientation=6` displays this file as 200×400 in every engine. The guard is about the DECODE,
    // which costs the same pixels either way, so the honest number here is the encoded 400×200 — and
    // an implementation that "helpfully" applied the rotation would be reporting a size no byte of
    // the file contains.
    expect(header("jpeg-exif-portrait.jpg")).toMatchObject({
      format: "jpeg",
      width: 400,
      height: 200,
    });
  });

  it.each([
    ["webp-lossy-8x6.webp", "VP8 "],
    ["webp-lossless-8x6.webp", "VP8L"],
    ["webp-alpha-8x6.webp", "VP8X"],
  ])("reads the canvas size of %s (%s)", (name) => {
    expect(header(name)).toMatchObject({ format: "webp", width: 8, height: 6 });
  });
});

describe("readImageHeader — what the bytes say, never the name", () => {
  it("reads JPEG bytes carrying a .png name as a jpeg", () => {
    // The pair the SERVER answers 415 for. On the way IN it is simply a jpeg: the export re-encodes
    // every input and mints the stored name from the output's own type, so a mislabelled pick is a
    // non-event rather than a rejection.
    expect(header("lying.png")).toMatchObject({ format: "jpeg", width: 5, height: 4 });
  });

  it("refuses a truncated PNG rather than measuring bytes that are not there", () => {
    expect(header("truncated.png")).toMatchObject({ format: null, truncated: true });
  });

  it("reports a JPEG whose frame header is past the head as a jpeg of unknown size", () => {
    // NOT a refusal: the file is a jpeg, we simply cannot measure it from the head we were given (a
    // large EXIF thumbnail does this to a real photo). The megapixel arm is skipped and the
    // `createImageBitmap` proof becomes the guard — which is the ladder's own catch-all rung.
    expect(header("truncated.jpg")).toMatchObject({ format: "jpeg", width: null, height: null });
    expect(guard("truncated.jpg").ok).toBe(true);
  });

  it("says nothing at all about a file that is not an image", () => {
    expect(header("not-an-image.txt")).toMatchObject({
      format: null,
      refused: null,
      truncated: false,
    });
  });
});

describe("readImageHeader — the formats refused BY NAME", () => {
  it("names HEIC, and says how to get a file that works", () => {
    const verdict = guard("heic-header.heic");
    expect(header("heic-header.heic").refused).toBe("heic");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("HEIC");
      // The owner's own fix, because this is the refusal their phone can actually produce.
      expect(verdict.reason).toMatch(/JPEG/);
    }
  });

  it("names TIFF", () => {
    expect(header("tiff-8x6.tiff").refused).toBe("tiff");
  });

  it("names SVG — sniffed from the bytes, so a renamed one is refused too", () => {
    // Ahead of the decode on purpose: a canvas rasterises SVG happily, and it is the one input that
    // is a document rather than a picture.
    expect(header("vector.svg").refused).toBe("svg");
    const svg = bytes("vector.svg");
    expect(readImageHeader(svg, svg.length).refused).toBe("svg");
  });
});

describe("guardPick — the ladder, in its ruled order", () => {
  it("admits an ordinary picked file", () => {
    const verdict = guard("photo-64x48.png");
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.header).toMatchObject({ format: "png", width: 64, height: 48 });
  });

  it("refuses an empty file", () => {
    expect(guardPick(0, new Uint8Array(), LIMITS)).toMatchObject({ ok: false });
  });

  it("refuses past the byte cap FIRST, naming both numbers", () => {
    // Before the header is even read: the point of the byte cap is to cost nothing.
    const verdict = guardPick(20_000_000, bytes("png-2x3.png"), LIMITS);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("20.0 MB");
      expect(verdict.reason).toContain("1.0 MB");
    }
  });

  it("refuses a header CLAIMING more pixels than the cap, whatever the file weighs", () => {
    // 103 bytes on disk, 400 megapixels of claim — which is exactly what a hostile or corrupt header
    // looks like, and why `file.size` is not a proxy for what a decode will cost.
    const verdict = guard("png-claims-20000x20000.png");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("20000×20000");
      expect(verdict.reason).toContain("400 megapixels");
      expect(verdict.reason).toContain("64");
    }
  });

  it("admits the owner's own 48 MP phone — the cap exists to let it through", () => {
    // The Honor 20 shoots 8000×6000 (owner ruling ④). A guard that refused the phone this app is
    // used from would be a guard against the owner.
    const png = bytes("png-2x3.png").slice();
    new DataView(png.buffer).setUint32(16, 8000);
    new DataView(png.buffer).setUint32(20, 6000);
    expect(guardPick(4_000_000, png, { ...LIMITS, maxBytes: 15 * 1024 * 1024 }).ok).toBe(true);
  });
});

describe("readHead", () => {
  it("reads at most the limit, and clamps to a file shorter than it", async () => {
    const blob = new Blob([bytes("jpeg-5x4.jpg")]);
    const head = await readHead(blob, { ...LIMITS, headBytes: 8 });
    expect(head).toHaveLength(8);
    expect(await readHead(blob, LIMITS)).toHaveLength(blob.size);
  });
});
