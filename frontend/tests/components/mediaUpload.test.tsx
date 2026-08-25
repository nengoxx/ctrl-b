import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaIndex } from "../../src/hooks/useMedia";
import { MEDIA_NS } from "../../src/theme-engine/mediaRegistry";

// THE UPLOAD (D65 / MEDIA_MANAGER_PLAN §4) — pick → guard → crop → export → PUT → register, driven
// through the real component tree.
//
// Mocked BELOW the hooks (the `mediaGallery.test.tsx` precedent): the api client and the WORKER
// client are fakes, everything else is the shipped code — the real guard, the real name minter, the
// real crop modal, the real serialized write queue. So the assertions are on the WIRE, which is the
// contract that matters: which verb carried the bytes, under what name, and what config patch
// followed.
//
// The load-bearing claims, each one a rule that would be expensive to get wrong:
//  · ONE admission latch, taken SYNCHRONOUSLY — two taps in one frame must not start two jobs;
//  · the two-phase retry NEVER re-uploads after a 201 (a second copy under the next suffix would be
//    silent, permanent and invisible to the owner);
//  · a `409` is walked to the next suffix, never shown;
//  · every phase's failure says what it means, and only the retryable ones offer a retry;
//  · single-file per pick, whatever the drop carried.

const IMAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "images");
const fixture = (name: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(readFileSync(join(IMAGES, name)));

const api = vi.hoisted(() => ({
  getJSON: vi.fn(),
  getJSONWithHeader: vi.fn(),
  putJSON: vi.fn(),
  postJSON: vi.fn(),
  putBytes: vi.fn(),
  del: vi.fn(),
  // The real class — the 409 walk branches on `instanceof ApiError` and on `.status`.
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
}));
vi.mock("../../src/api/client", () => api);
const toast = vi.hoisted(() => ({ pushToast: vi.fn() }));
vi.mock("../../src/store/toast", () => toast);
vi.mock("../../src/lib/composer", () => ({ loadProviders: vi.fn(), loadAgents: vi.fn() }));

/** Only the WORKER client is faked — every pure rule of the export (`exportPolicy`, the readback, the
 *  step-down) has its own suite against an injected env in `tests/lib/imageExport.test.ts`. What this
 *  file is about is the JOB around it. */
const exporter = vi.hoisted(() => ({ exportImage: vi.fn() }));
vi.mock("../../src/lib/imageExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/imageExport")>()),
  exportImage: exporter.exportImage,
}));

import { MediaGallery } from "../../src/components/MediaGallery";
import { setUI } from "../../src/store/ui";

const OUTPUT = {
  blob: new Blob([fixture("png-2x3.png")], { type: "image/webp" }),
  type: "image/webp" as const,
  ext: ".webp",
  width: 400,
  height: 300,
  overBudget: false,
};

/** A real file, so the guard's header reader has something honest to read. */
const pickFile = (name = "My Photo.PNG"): File =>
  new File([fixture("photo-64x48.png")], name, { type: "image/png" });

const emptyIndex = (roles: Record<string, MediaIndex["roles"][string]>): MediaIndex => ({
  ns: "gacha",
  collation: "library-v1",
  roles: { characters: [], banner: [], reel: [], oracle: [], ...roles },
  slots: {},
});

function renderGallery(payload: MediaIndex = emptyIndex({})): void {
  api.getJSON.mockResolvedValue(payload);
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const ui: ReactElement = (
    <QueryClientProvider client={qc}>
      <MediaGallery ns="gacha" def={MEDIA_NS.gacha} />
    </QueryClientProvider>
  );
  render(ui);
}

/** Open a gallery and hand back its dialog. */
async function openSection(name: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: `Open the ${name} gallery` }));
  return screen.findByRole("dialog");
}

/** The hidden picker input — the ONE admission path's own element. */
const picker = (dialog: HTMLElement): HTMLInputElement =>
  dialog.querySelector("input[type=file]") as HTMLInputElement;

/** Hand the picker a file, exactly as a real pick does. */
async function pick(dialog: HTMLElement, ...files: File[]): Promise<void> {
  await act(async () => {
    fireEvent.change(picker(dialog), { target: { files } });
    await Promise.resolve();
  });
}

/** Confirm the crop step — with no gesture, which is the "use as is" path. */
async function confirmCrop(label = "Use as is"): Promise<void> {
  const button = await screen.findByRole("button", { name: label });
  await act(async () => {
    fireEvent.click(button);
    await Promise.resolve();
  });
}

beforeEach(() => {
  api.getJSON.mockReset();
  api.del.mockReset().mockResolvedValue(undefined);
  api.putBytes.mockReset().mockResolvedValue({});
  toast.pushToast.mockReset();
  exporter.exportImage.mockReset().mockResolvedValue(OUTPUT);
  setUI({ tab: "conf" });
  api.getJSONWithHeader.mockReset().mockResolvedValue({ data: {}, header: "r1" });
  api.putJSON.mockReset().mockResolvedValue({
    settings: { notifications: {} },
    restart_required: [],
    warnings: [],
    providers_rev: "r1",
  });
  // jsdom has no image decoder. The `createImageBitmap` PROOF rung is the guard's catch-all, so the
  // stub answers with a size for a real image and rejects for anything else — which is exactly the
  // distinction the rung exists to draw.
  globalThis.createImageBitmap = vi.fn((source: Blob) =>
    source.size > 0
      ? Promise.resolve({ width: 64, height: 48, close: vi.fn() } as unknown as ImageBitmap)
      : Promise.reject(new Error("undecodable")),
  ) as typeof createImageBitmap;
  // react-easy-crop measures its container.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(async () => {
  cleanup();
  setUI({ tab: "fleet" });
  // The back guard reclaims its history entry with an asynchronous `history.back()`; let the pop land
  // inside the test that produced it rather than in the next one.
  await new Promise((r) => setTimeout(r, 0));
});

describe("the round trip", () => {
  it("pick → crop → export → PUT the BYTES → register through the settings queue", async () => {
    renderGallery();
    const dialog = await openSection("characters");
    await pick(dialog, pickFile());
    await confirmCrop();

    // ① the bytes leave through D65's typed verb, under a name minted from the picked stem and the
    //    EXPORT's own extension — never from what was picked (`My Photo.PNG` → a webp).
    await waitFor(() => expect(api.putBytes).toHaveBeenCalledTimes(1));
    expect(api.putBytes.mock.calls[0][0]).toBe("/api/media/gacha/files/characters/My%20Photo.webp");
    expect(api.putBytes.mock.calls[0][1]).toBe(OUTPUT.blob);

    // ② …and the registration is ONE ordinary settings patch through the shared queue, appending the
    //    entry at the END: an upload is purely ADDITIVE and re-orders nothing the owner arranged.
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    expect(api.putJSON.mock.calls[0][0]).toBe("/api/settings");
    expect(api.putJSON.mock.calls[0][1]).toEqual({
      media: {
        namespaces: {
          gacha: { roles: { characters: { files: [{ name: "My Photo.webp" }] } } },
        },
      },
    });
  });

  it("exports against the ROLE's own bounds and its export override", async () => {
    renderGallery();
    const dialog = await openSection("characters");
    await pick(dialog, pickFile());
    await confirmCrop();
    await waitFor(() => expect(exporter.exportImage).toHaveBeenCalled());
    const job = exporter.exportImage.mock.calls[0][0] as {
      rect: { width: number; height: number };
      bounds: { pixels: number };
      override?: unknown;
    };
    // "Use as is" is the WHOLE picture through the same pipeline — not a bypass (§4).
    expect(job.rect).toEqual({ x: 0, y: 0, width: 64, height: 48 });
    expect(job.bounds.pixels).toBe(MEDIA_NS.gacha.roles.characters.bounds.pixels);
    expect(job.override).toBeUndefined();
  });

  it("keeps the picker resettable, so the SAME photo can be picked twice", async () => {
    // `change` fires only when the SELECTION changes: without the reset, re-picking the same file
    // fires `cancel` instead and the button is dead (R54 §5.4).
    renderGallery();
    const dialog = await openSection("characters");
    await pick(dialog, pickFile());
    expect(picker(dialog).value).toBe("");
  });

  it("takes ONE file per pick, whatever the drop carried (owner ruling ⑨)", async () => {
    renderGallery();
    const dialog = await openSection("characters");
    await pick(dialog, pickFile("one.png"), pickFile("two.png"));
    await confirmCrop();
    await waitFor(() => expect(api.putBytes).toHaveBeenCalledTimes(1));
    expect(api.putBytes.mock.calls[0][0]).toContain("one.webp");
  });
});

describe("the ONE admission latch (§4, Opus M8)", () => {
  it("refuses a second job while one is running — synchronously, in the same frame", async () => {
    renderGallery();
    const dialog = await openSection("characters");
    // Two picks with no await between them: rendered state would still read `false` for the second.
    await act(async () => {
      fireEvent.change(picker(dialog), { target: { files: [pickFile("one.png")] } });
      fireEvent.change(picker(dialog), { target: { files: [pickFile("two.png")] } });
      await Promise.resolve();
    });
    expect(await screen.findAllByRole("button", { name: "Use as is" })).toHaveLength(1);
    await confirmCrop();
    await waitFor(() => expect(api.putBytes).toHaveBeenCalledTimes(1));
    expect(api.putBytes.mock.calls[0][0]).toContain("one.webp");
  });

  it("releases the latch when the crop is cancelled, and writes nothing", async () => {
    renderGallery();
    const dialog = await openSection("characters");
    await pick(dialog, pickFile());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Use as is" })).toBeNull());
    expect(api.putBytes).not.toHaveBeenCalled();
    expect(api.putJSON).not.toHaveBeenCalled();
    // …and the next pick is admitted.
    await pick(dialog, pickFile("again.png"));
    expect(await screen.findByRole("button", { name: "Use as is" })).toBeTruthy();
  });
});

describe("names (§2.5)", () => {
  it("walks past what the folder already holds", async () => {
    renderGallery(
      emptyIndex({
        characters: [
          {
            name: "photo",
            file: "photo.webp",
            url: "/api/media/gacha/files/characters/photo.webp",
            format: "webp",
            size_bytes: 10,
            revision: "1",
            width: 1,
            height: 1,
            unusable: false,
            unusable_reason: null,
          },
        ],
      }),
    );
    const dialog = await openSection("characters");
    await pick(dialog, pickFile("photo.png"));
    await confirmCrop();
    await waitFor(() => expect(api.putBytes).toHaveBeenCalled());
    expect(api.putBytes.mock.calls[0][0]).toContain("photo-2.webp");
  });

  it("answers the server's 409 race guard with the next suffix — never a dialog", async () => {
    renderGallery();
    api.putBytes
      .mockRejectedValueOnce(new api.ApiError("name exists", 409))
      .mockResolvedValueOnce({});
    const dialog = await openSection("characters");
    await pick(dialog, pickFile("photo.png"));
    await confirmCrop();
    await waitFor(() => expect(api.putBytes).toHaveBeenCalledTimes(2));
    expect(api.putBytes.mock.calls[0][0]).toContain("photo.webp");
    expect(api.putBytes.mock.calls[1][0]).toContain("photo-2.webp");
    // The owner is never told: a 409 means another writer took the name, and the answer is a name.
    expect(within(dialog).queryByText(/could not/i)).toBeNull();
    await waitFor(() => expect(api.putJSON).toHaveBeenCalled());
  });
});

describe("failure rows, per phase (§4)", () => {
  it("a refused PICK says why and offers no retry — the answer is another picture", async () => {
    renderGallery();
    const dialog = await openSection("characters");
    // A HEIC, which no browser can decode. Refused BY NAME, before any decoder sees it.
    await pick(dialog, new File([fixture("heic-header.heic")], "IMG_0001.heic"));
    const row = await within(dialog).findByText(/HEIC/);
    expect(row.textContent).toContain("That picture cannot be used");
    expect(within(dialog).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(api.putBytes).not.toHaveBeenCalled();
  });

  it("a failed EXPORT keeps the crop and offers a retry", async () => {
    renderGallery();
    exporter.exportImage.mockRejectedValueOnce(new Error("the cropped image came back empty"));
    const dialog = await openSection("characters");
    await pick(dialog, pickFile());
    await confirmCrop();
    const retry = await within(dialog).findByRole("button", { name: "Try again" });
    expect(within(dialog).getByText(/could not be prepared/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(retry);
      await Promise.resolve();
    });
    // The SAME crop, re-exported — the owner does not frame the picture twice.
    await waitFor(() => expect(api.putBytes).toHaveBeenCalledTimes(1));
    expect(exporter.exportImage).toHaveBeenCalledTimes(2);
  });

  it("names the role-directory failure as the OPERATOR problem it is", async () => {
    // The S1-flagged case: the registry knows the role, the boot check passed, and the folder is
    // gone from disk — so the write refuses rather than resurrecting a tree the owner deleted.
    renderGallery();
    api.putBytes.mockRejectedValue(new api.ApiError("Internal Server Error", 500));
    const dialog = await openSection("characters");
    await pick(dialog, pickFile());
    await confirmCrop();
    const row = await within(dialog).findByText(/media folder/);
    expect(row.textContent).toContain("restart ctrl-b");
  });
});

describe("the two-phase job (§4, Emma #4)", () => {
  it("a retry after a 201 NEVER re-uploads — it retries only the registration", async () => {
    renderGallery();
    api.putJSON.mockRejectedValueOnce(new Error("save failed"));
    const dialog = await openSection("characters");
    await pick(dialog, pickFile("photo.png"));
    await confirmCrop();

    // Phase one landed; phase two did not. The row says exactly that — the bytes ARE on the server,
    // and telling the owner "the upload failed" would send them looking for a file that is there.
    const row = await within(dialog).findByText(/was uploaded, but the library list/);
    expect(row.textContent).toContain("photo.webp");
    expect(api.putBytes).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(2));
    // THE claim: one upload, two registrations. A second PUT here would store a second copy of the
    // same picture under the next suffix, silently and permanently.
    expect(api.putBytes).toHaveBeenCalledTimes(1);
    expect(api.putJSON.mock.calls[1][1]).toEqual(api.putJSON.mock.calls[0][1]);
  });
});

describe("scoped sections", () => {
  it("an upload into a KEY's gallery binds by that key, not by the minted stem", async () => {
    // The minted filename is an internal handle, so the stem fallback would bind the file to a key
    // nobody chose. Uploads always set `key` on a named role (§2.2).
    renderGallery();
    api.getJSON.mockResolvedValue({
      ns: "frontier",
      collation: "library-v1",
      roles: { stack: [], rigs: [], hero: [] },
      slots: {},
    });
    cleanup();
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MediaGallery ns="frontier" def={MEDIA_NS.frontier} />
      </QueryClientProvider>,
    );
    const dialog = await openSection("cube");
    await pick(dialog, pickFile("layer.png"));
    await confirmCrop();
    await waitFor(() => expect(api.putJSON).toHaveBeenCalled());
    expect(api.putJSON.mock.calls[0][1]).toEqual({
      media: {
        namespaces: {
          frontier: { roles: { stack: { files: [{ name: "layer.webp", key: "cube" }] } } },
        },
      },
    });
    // …and the role FORCES png, which the export must be told before it encodes.
    expect((exporter.exportImage.mock.calls[0][0] as { override?: unknown }).override).toEqual({
      type: "image/png",
    });
  });
});
