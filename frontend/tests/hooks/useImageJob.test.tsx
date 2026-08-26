import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// THE IMAGE-JOB MACHINE (D65 / MEDIA_MANAGER_PLAN §4 + §12's "W10") — the four steps every stored
// picture goes through, with the tail INJECTED.
//
// Driven directly rather than through the gallery, because what this file is about is the part no
// consumer can see: the LATCH, the phase word and the failure row, and the guarantee that they behave
// identically whichever delivery is bound into the job. `tests/components/mediaUpload.test.tsx` is the
// same machine under the REAL upload tail, on the wire; this is the machine itself, under a fake one.
//
// Mocked BELOW the hook, on the `mediaUpload.test.tsx` precedent: the settings query and the export
// WORKER are fakes, and everything else — the real guard ladder, the real header reader, the real
// latch — is the shipped code.

const IMAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "images");
const fixture = (name: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(readFileSync(join(IMAGES, name)));

const settings = vi.hoisted(() => ({ useSettings: vi.fn() }));
vi.mock("../../src/hooks/useSettings", () => settings);
const exporter = vi.hoisted(() => ({ exportImage: vi.fn() }));
vi.mock("../../src/lib/imageExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/imageExport")>()),
  exportImage: exporter.exportImage,
}));

import {
  useImageJob,
  type ImageJob,
  type JobControl,
  type JobDelivery,
  type JobSpec,
} from "../../src/hooks/useImageJob";
import { MEDIA_NS, mediaSections } from "../../src/theme-engine/mediaRegistry";

const SECTION = mediaSections("gacha", MEDIA_NS.gacha, ["characters"]).find(
  (s) => s.role === "characters" && s.kind === "pool",
)!;

const OUTPUT = {
  blob: new Blob([fixture("photo-64x48.png")], { type: "image/webp" }),
  type: "image/webp" as const,
  ext: ".webp",
  width: 64,
  height: 48,
  overBudget: false,
};

const pickFile = (name = "photo.png"): File =>
  new File([fixture("photo-64x48.png")], name, { type: "image/png" });

/** The live hook value, captured out of a one-line harness — the machine has no DOM of its own. */
let job: ImageJob;
function Harness() {
  job = useImageJob();
  return null;
}

/** Admit a file, and let the guard's two awaited rungs settle. */
async function offer(spec: JobSpec, file: File | null = pickFile()): Promise<void> {
  await act(async () => {
    job.offer(file, spec);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Confirm the crop step as "use as is" — the whole picture. */
async function confirm(): Promise<void> {
  await act(async () => {
    job.confirm({ x: 0, y: 0, width: 64, height: 48 });
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** A delivery that RECORDS what it was handed and then ends the job the way it is told to. */
function tail(end: (control: JobControl) => void): { calls: unknown[][]; deliver: JobDelivery } {
  const calls: unknown[][] = [];
  return {
    calls,
    deliver: async (output, ctx, control) => {
      calls.push([output, ctx]);
      control.begin();
      control.setPhase("upload");
      await Promise.resolve();
      end(control);
    },
  };
}

const spec = (deliver: JobDelivery, over?: Partial<JobSpec>): JobSpec => ({
  section: SECTION,
  scope: {},
  deliver,
  ...over,
});

beforeEach(() => {
  settings.useSettings.mockReturnValue({ data: { media: { write: { max_bytes: 15_000_000 } } } });
  exporter.exportImage.mockReset().mockResolvedValue(OUTPUT);
  globalThis.createImageBitmap = vi.fn((source: Blob) =>
    source.size > 0
      ? Promise.resolve({ width: 64, height: 48, close: () => {} } as unknown as ImageBitmap)
      : Promise.reject(new Error("undecodable")),
  ) as typeof createImageBitmap;
});
afterEach(cleanup);

describe("the machine (§4 rules ① and ②)", () => {
  it("admit → guard → crop → export → the INJECTED tail, with the job's own context", async () => {
    const { calls, deliver } = tail((c) => c.finish());
    render(<Harness />);
    await offer(spec(deliver));
    // The crop step holds the latch with NO phase: nothing is running, the app is waiting for the owner.
    expect(job.crop?.file.name).toBe("photo.png");
    expect(job.phase).toBe(null);
    expect(job.busy).toBe(true);
    await confirm();
    expect(exporter.exportImage).toHaveBeenCalledTimes(1);
    // The BYTES' own proven format reaches the export, never `File.type` (Emma #3) — and the ROLE's
    // export policy is what an admission that states none is under.
    expect(exporter.exportImage.mock.calls[0][0]).toMatchObject({
      sourceFormat: "png",
      bounds: SECTION.bounds,
      override: SECTION.def.export,
    });
    // The tail got the exported bytes and the job they belong to.
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(OUTPUT);
    expect((calls[0][1] as { section: { id: string } }).section.id).toBe(SECTION.id);
    // …and `finish` releases everything.
    expect(job.busy).toBe(false);
    expect(job.phase).toBe(null);
    expect(job.failure).toBe(null);
  });

  it("ONE LATCH, taken synchronously — a second offer in the same frame is ignored", async () => {
    const { deliver } = tail((c) => c.finish());
    render(<Harness />);
    await act(async () => {
      job.offer(pickFile("first.png"), spec(deliver));
      // The same frame: nothing has re-rendered, so a latch in STATE would still read `false` here.
      job.offer(pickFile("second.png"), spec(deliver));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(job.crop?.file.name).toBe("first.png");
  });

  it("…and the latch is HELD through the crop step and the export, then released by the tail", async () => {
    const { deliver } = tail((c) => c.finish());
    render(<Harness />);
    await offer(spec(deliver));
    await offer(spec(deliver), pickFile("second.png"));
    expect(job.crop?.file.name).toBe("photo.png"); // the crop step refused the second pick
    await confirm();
    await offer(spec(deliver), pickFile("third.png"));
    expect(job.crop?.file.name).toBe("third.png"); // …and the finished job let the next one in
  });

  it("a REFUSED pick fails at `guard`, releases the latch, and offers no retry", async () => {
    const { calls, deliver } = tail((c) => c.finish());
    render(<Harness />);
    // A bare PNG signature with no IHDR behind it: the header reader's "the picture data stops inside
    // its own header" rung, which is a refusal about the FILE rather than about the platform.
    const truncated = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await offer(spec(deliver), new File([truncated], "x.png", { type: "image/png" }));
    expect(job.failure?.phase).toBe("guard");
    expect(job.failure?.sectionId).toBe(SECTION.id);
    expect(job.failure?.retry).toBeUndefined();
    expect(job.crop).toBe(null);
    expect(calls).toHaveLength(0);
    // The latch RELEASED: the answer to a refused pick is a different picture, and the owner must be
    // able to offer one without dismissing the row first.
    expect(job.busy).toBe(false);
    await offer(spec(deliver));
    expect(job.crop?.file.name).toBe("photo.png");
  });

  it("an EXPORT failure is retryable, and the retry re-enters the export it failed in", async () => {
    const { deliver } = tail((c) => c.finish());
    render(<Harness />);
    exporter.exportImage.mockRejectedValueOnce(new Error("the canvas is too large."));
    await offer(spec(deliver));
    await confirm();
    expect(job.failure?.phase).toBe("export");
    expect(job.busy).toBe(false);
    await act(async () => {
      job.failure?.retry?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(exporter.exportImage).toHaveBeenCalledTimes(2);
    expect(job.failure).toBe(null);
    expect(job.busy).toBe(false);
  });

  it("a TAIL's failure is the machine's failure row — and its retry takes the same latch", async () => {
    let attempts = 0;
    const deliver: JobDelivery = async (_out, _ctx, control) => {
      attempts++;
      control.begin();
      control.setPhase("upload");
      await Promise.resolve();
      control.fail({
        phase: "upload",
        message: "the upload did not finish.",
        filename: "a.webp",
        retry: control.retryable(() => void deliver(_out, _ctx, control)),
      });
    };
    render(<Harness />);
    await offer(spec(deliver));
    await confirm();
    expect(job.failure).toMatchObject({
      phase: "upload",
      filename: "a.webp",
      sectionId: SECTION.id,
    });
    expect(job.busy).toBe(false);
    // A double-tapped retry runs ONE job: the second tap meets the latch the first one took.
    await act(async () => {
      job.failure?.retry?.();
      job.failure?.retry?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(attempts).toBe(2);
    // Dismiss clears the row and nothing else.
    act(() => job.dismiss());
    expect(job.failure).toBe(null);
  });

  it("CANCELLING the crop unwinds the whole job — nothing exported, latch free", async () => {
    const { calls, deliver } = tail((c) => c.finish());
    render(<Harness />);
    await offer(spec(deliver));
    act(() => job.cancel());
    expect(job.crop).toBe(null);
    expect(job.busy).toBe(false);
    expect(exporter.exportImage).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("the JOB's own export override wins over the role's — what an edit is admitted with", async () => {
    const { deliver } = tail((c) => c.finish());
    render(<Harness />);
    await offer(spec(deliver, { export: { type: "image/jpeg" } }));
    await confirm();
    expect(exporter.exportImage.mock.calls[0][0]).toMatchObject({
      override: { type: "image/jpeg" },
    });
  });

  it("no settings snapshot ⇒ not READY: the server's byte cap is not a number to guess", () => {
    settings.useSettings.mockReturnValue({ data: undefined });
    render(<Harness />);
    expect(job.ready).toBe(false);
  });
});
