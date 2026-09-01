import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// THE ATTACHMENT PIPELINE (D68 S3 / ATTACHMENTS_PLAN §7) — a picked file to a staged id.
//
// Driven through the REAL module, with exactly two things faked: the export WORKER (a worker cannot
// be constructed in jsdom, and `tests/lib/imageExport.test.ts` already owns the encoder's own
// contract) and `fetch`. Everything else — the real guard ladder, the real header reader, the real
// name minting, the real store — is the shipped code, so what these arms prove is the WIRING:
//
//  · every refusal reaches the owner as its OWN sentence, on its OWN chip (R62 §3.2's lesson), and
//    never touches the files beside it;
//  · the downscale is asked for in the SERVER's numbers (`image_max_dimension`/`image_quality`), and
//    is asked of the shared export rather than a second encoder (§1);
//  · the PUT names the minted file and the SERVER's answer is what the chip ends up carrying.

const exporter = vi.hoisted(() => ({ exportImage: vi.fn() }));
vi.mock("../../src/lib/imageExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/imageExport")>()),
  exportImage: exporter.exportImage,
}));

import {
  ATTACH_ACCEPT,
  attachmentPolicy,
  filesFrom,
  offerFiles,
  primaryAcceptsImages,
  setAttachmentInfo,
} from "../../src/lib/attachments";
import { clearStaged, isUploading, stagedFiles, stagedIds } from "../../src/store/attachments";

const IMAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "images");
const bytes = (name: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(readFileSync(join(IMAGES, name)));

const picture = (name = "photo.png", fixture = "photo-320x240.png"): File =>
  new File([bytes(fixture)], name, { type: "image/png" });
const note = (name = "notes.txt", body = "hello"): File =>
  new File([body], name, { type: "text/plain" });

/** The mint's answer — the row `api/attachments.py#StagedAttachment` returns. */
function mintOk(over: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true,
    status: 201,
    json: async () => ({
      attachment_id: "a".repeat(32),
      name: "photo.webp",
      kind: "image",
      mime: "image/webp",
      bytes: 4096,
      ...over,
    }),
  } as unknown as Response;
}

function mintRefusal(status: number, detail: string) {
  return {
    ok: false,
    status,
    json: async () => ({ detail }),
  } as unknown as Response;
}

const EXPORTED = {
  blob: new Blob([bytes("photo-64x48.png")], { type: "image/webp" }),
  type: "image/webp" as const,
  ext: ".webp",
  width: 320,
  height: 240,
  overBudget: false,
};

beforeEach(() => {
  exporter.exportImage.mockResolvedValue(EXPORTED);
  globalThis.fetch = vi.fn(async () => mintOk());
});

afterEach(() => {
  clearStaged();
  // Back to the class defaults so one arm's server numbers never leak into the next.
  setAttachmentInfo({});
});

describe("the server owns the numbers (§6)", () => {
  it("adopts the knobs `/api/providers` serves, and the vision answer with them", () => {
    setAttachmentInfo({
      attachments: {
        max_files_per_message: 3,
        max_file_mb: 2,
        image_max_dimension: 1024,
        image_quality: 0.6,
      },
      sections: { inference: { accepts_images: true } },
    });
    expect(attachmentPolicy()).toEqual({
      maxFiles: 3,
      maxFileBytes: 2 * 1024 * 1024,
      maxDimension: 1024,
      quality: 0.6,
    });
    expect(primaryAcceptsImages()).toBe(true);
  });

  it("an older backend that serves neither leaves the class defaults in place", () => {
    setAttachmentInfo({});
    expect(attachmentPolicy()).toEqual({
      maxFiles: 10,
      maxFileBytes: 10 * 1024 * 1024,
      maxDimension: 2048,
      quality: 0.85,
    });
    expect(primaryAcceptsImages()).toBe(false); // conservative, exactly like the server's own default
  });

  it("the picker asks for the kinds the server admits — and nothing else", () => {
    // Mirrors `core/attachments.py#ALLOWED_SUFFIXES`; a file outside it is refused at the mint's
    // name predicate, so offering it in the chooser would be an invitation to a 422.
    expect(ATTACH_ACCEPT.split(",")).toEqual([
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
      ".gif",
      ".txt",
      ".md",
      ".csv",
      ".json",
      ".pdf",
    ]);
  });
});

describe("admission — every refusal is named, and only its own file fails", () => {
  it("an unaccepted extension is refused before anything is read", async () => {
    await offerFiles([new File(["x"], "report.docx")]);
    const [chip] = stagedFiles();
    expect(chip.status).toBe("failed");
    expect(chip.error).toContain(".docx files are not accepted");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("a HEIC photo is refused with the sentence that names the FIX", async () => {
    await offerFiles([new File([bytes("heic-header.heic")], "IMG_0001.jpg")]);
    const [chip] = stagedFiles();
    expect(chip.status).toBe("failed");
    expect(chip.error).toContain("HEIC");
    expect(chip.kind).toBe("image"); // a refused photo still READS as a photo in the rail
  });

  it("a file past `max_file_mb` names the cap it broke", async () => {
    setAttachmentInfo({ attachments: { max_file_mb: 1 } });
    const big = new File([new Uint8Array(2 * 1024 * 1024)], "huge.png");
    await offerFiles([big]);
    expect(stagedFiles()[0].error).toContain("this app accepts up to 1.0 MB");
  });

  it("a refusal never blocks the healthy files beside it (§7)", async () => {
    await offerFiles([new File(["x"], "report.docx"), picture(), note()]);
    expect(stagedFiles().map((f) => f.status)).toEqual(["failed", "staged", "staged"]);
    expect(stagedIds()).toHaveLength(2); // only what actually landed can be sent
  });

  it("`max_files_per_message` refuses the overflow, by name, and a FAILED chip holds no slot", async () => {
    setAttachmentInfo({ attachments: { max_files_per_message: 2 } });
    await offerFiles([picture("a.png"), picture("b.png"), picture("c.png")]);
    const chips = stagedFiles();
    expect(chips.map((f) => f.status)).toEqual(["staged", "staged", "failed"]);
    expect(chips[2].error).toContain("up to 2 files");
    // …and the refused one does not occupy the slot it was denied: one more pick still fails, but a
    // REMOVED healthy chip would free a real slot (the count is of admitted rows, not of chips).
    expect(stagedIds()).toHaveLength(2);
  });
});

// MED-3 — ADMISSION IS SYNCHRONOUS. Everything the app took responsibility for is on the rail before
// the first `await`, which is what makes `isUploading()` (the send gate) true from the gesture
// onwards: an Enter pressed straight after a drop must be HELD, not sent text-only past the file.
describe("the admission window (MED-3)", () => {
  it("every picked file has its chip BEFORE anything awaits", () => {
    const inFlight = offerFiles([picture("a.png"), note("b.txt")]);
    expect(stagedFiles().map((f) => [f.name, f.status])).toEqual([
      ["a.png", "uploading"],
      ["b.txt", "uploading"],
    ]);
    expect(isUploading()).toBe(true); // …so the send is already held
    return inFlight;
  });

  it("a file refused at admission is refused synchronously too, on its own chip", () => {
    const inFlight = offerFiles([new File(["x"], "report.docx"), picture()]);
    expect(stagedFiles().map((f) => f.status)).toEqual(["failed", "uploading"]);
    return inFlight;
  });

  it("two rapid offers cannot both fill the LAST slot — the overflow refuses at admission", async () => {
    setAttachmentInfo({ attachments: { max_files_per_message: 1 } });
    // Not awaited between: the second gesture lands while the first file is still uploading, which is
    // exactly the race a post-await cap check loses (both would upload, both past the cap).
    const first = offerFiles([picture("a.png")]);
    const second = offerFiles([picture("b.png")]);
    await Promise.all([first, second]);
    expect(stagedFiles().map((f) => f.status)).toEqual(["staged", "failed"]);
    expect(stagedFiles()[1].error).toContain("up to 1 file");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // nothing uploaded past the cap
  });

  it("the preview is minted with the guard's verdict, never before it", async () => {
    // The provisional chip carries no object URL: a photo the ladder is about to refuse would leave
    // one behind with no chip to own it (and no exit path that revokes it).
    const made = vi.spyOn(URL, "createObjectURL");
    await offerFiles([new File([bytes("heic-header.heic")], "IMG_0001.jpg")]);
    expect(stagedFiles()[0].status).toBe("failed");
    expect(made).not.toHaveBeenCalled();
    await offerFiles([picture()]);
    expect(made).toHaveBeenCalledTimes(1);
  });
});

// MED-4 — the IMAGE ladder is for IMAGES. A text file or a PDF meets the byte cap and the name tier
// here, and the SERVER's own rules (strict UTF-8, its sniff) decide the rest — it refuses dishonest
// bytes with a sentence this chip already knows how to show.
describe("the guard's scope (MED-4)", () => {
  it("a `.md` that happens to begin with `<svg` stages clean", async () => {
    globalThis.fetch = vi.fn(async () =>
      mintOk({ name: "drawing.md", kind: "text", mime: "text/markdown", bytes: 40 }),
    );
    await offerFiles([new File(['<svg width="10"><circle r="4"/></svg>'], "drawing.md")]);
    expect(stagedFiles()[0]).toMatchObject({ status: "staged", kind: "text" });
    expect(exporter.exportImage).not.toHaveBeenCalled(); // never re-encoded — it is not a picture
  });

  it("…and a text file is never refused for the shape of its bytes", async () => {
    globalThis.fetch = vi.fn(async () =>
      mintOk({ name: "data.json", kind: "text", mime: "application/json", bytes: 9 }),
    );
    // A PNG signature inside a `.json` is the server's business (its sniff), not a client refusal.
    await offerFiles([new File([bytes("photo-320x240.png")], "data.json")]);
    expect(stagedFiles()[0].status).toBe("staged");
  });

  it("but the BYTE cap still refuses it here, by name, before the upload", async () => {
    setAttachmentInfo({ attachments: { max_file_mb: 1 } });
    await offerFiles([new File([new Uint8Array(2 * 1024 * 1024)], "log.txt")]);
    expect(stagedFiles()[0].status).toBe("failed");
    expect(stagedFiles()[0].error).toContain("this app accepts up to 1.0 MB per file");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("the delivery", () => {
  it("an image is re-encoded through the SHARED export, in the SERVER's numbers", async () => {
    setAttachmentInfo({ attachments: { image_max_dimension: 160, image_quality: 0.5 } });
    await offerFiles([picture("holiday.png")]); // the fixture is 320×240
    const job = exporter.exportImage.mock.calls[0][0] as {
      bounds: { pixels: number; bytes: number };
      override: { quality: number };
      sourceFormat: string | null;
    };
    // The knob is a LONGEST EDGE and the export caps by AREA: 320×240 at 160/320 → 160×120 = 19200.
    expect(job.bounds.pixels).toBe(19_200);
    expect(job.override.quality).toBe(0.5);
    expect(job.sourceFormat).toBe("png"); // proven from the BYTES, never `File.type` (R54/Emma #3)
  });

  it("a picture already inside the cap is never scaled UP", async () => {
    setAttachmentInfo({ attachments: { image_max_dimension: 4096 } });
    await offerFiles([picture()]);
    const job = exporter.exportImage.mock.calls[0][0] as { bounds: { pixels: number } };
    expect(job.bounds.pixels).toBe(320 * 240);
  });

  it("the PUT carries the minted name and the chip adopts the SERVER's answer", async () => {
    await offerFiles([picture("holiday snap.png")]);
    const [url, init] = (
      globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }
    ).mock.calls[0];
    // The name follows the EXPORT's extension (the encoder's own bytes), sanitised by `mintName`.
    expect(url).toBe("/api/attachments/staging/holiday%20snap.webp");
    expect(init.method).toBe("PUT"); // never POST, never multipart (SECURITY_MODEL §2.8)
    expect(stagedFiles()[0]).toMatchObject({
      status: "staged",
      attachmentId: "a".repeat(32),
      name: "photo.webp", // the server's admitted name, not ours
      kind: "image",
      bytes: 4096,
    });
    expect(stagedIds()).toEqual(["a".repeat(32)]);
  });

  it("a text file is uploaded VERBATIM — no encoder is asked about it", async () => {
    globalThis.fetch = vi.fn(async () =>
      mintOk({ name: "notes.txt", kind: "text", mime: "text/plain", bytes: 5 }),
    );
    await offerFiles([note()]);
    expect(exporter.exportImage).not.toHaveBeenCalled();
    const [url, init] = (
      globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }
    ).mock.calls[0];
    expect(url).toBe("/api/attachments/staging/notes.txt");
    expect(init.body).toBeInstanceOf(File);
    expect(stagedFiles()[0]).toMatchObject({ status: "staged", kind: "text" });
  });

  it("a refused upload keeps the server's own sentence on the chip", async () => {
    globalThis.fetch = vi.fn(async () =>
      mintRefusal(415, "that file is not an image, a PDF or text"),
    );
    await offerFiles([picture()]);
    expect(stagedFiles()[0]).toMatchObject({ status: "failed" });
    expect(stagedFiles()[0].error).toContain("not an image, a PDF or text");
    expect(stagedIds()).toEqual([]); // a failed chip is never sendable
  });

  it("an unreachable backend says so in the owner's terms", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError("network")));
    await offerFiles([note()]);
    expect(stagedFiles()[0].error).toContain("did not reach the server");
  });
});

describe("the DataTransfer entrance (paste + drop)", () => {
  it("prefers `files`, and falls back to the `items` walk (§7)", () => {
    const f = note();
    expect(filesFrom({ files: [f], items: [] } as unknown as DataTransfer)).toEqual([f]);
    // The fallback the plan names: some paste sources leave `files` empty and carry the payload as
    // `items` of kind "file" only.
    const items = { files: [], items: [{ kind: "file", getAsFile: () => f }, { kind: "string" }] };
    expect(filesFrom(items as unknown as DataTransfer)).toEqual([f]);
    expect(filesFrom(null)).toEqual([]);
  });
});
