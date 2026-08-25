import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaFile, MediaIndex } from "../../src/hooks/useMedia";
import { MEDIA_NS } from "../../src/theme-engine/mediaRegistry";

// THE FRAMING SHEET (D65 / MEDIA_MANAGER_PLAN §5) — the reticle's own state machine, and the sheet
// driven through the real gallery tree.
//
// Same harness and the same reasons as `mediaGallery.test.tsx`: the api client is mocked BELOW the
// hooks, so the real query, the real serialized write queue and the real registry all run, and the
// assertions are on the WIRE — what the config patch says, which is what the backend validates.
//
// The load-bearing claims:
//  · framing is CAPABILITY-GATED on the role and ABSENT on a bundled entry (Emma #6) — a bundled
//    entry's value is proportional, so saving a point "unmoved" through a centred reticle would
//    re-crop the shipped theme everywhere;
//  · the point is `{x, y}` at two decimals with the rev read at SEND time, never from the tapped tile;
//  · a rev that no longer matches reads as unset AND says so;
//  · the previews say they are examples.
//
// What is NOT here, deliberately: the value a SAVE writes. Driving that means driving react-easy-crop
// to report a crop area, which needs a real decoded image in a laid-out box — jsdom has neither. It is
// proved end to end in `e2e/media-framing.spec.ts` (the §12 S4 visual-probe gate), against the built
// app, where the assertion is stronger anyway: the patch AND the pixels that move because of it.

const api = vi.hoisted(() => ({
  getJSON: vi.fn(),
  getJSONWithHeader: vi.fn(),
  putJSON: vi.fn(),
  postJSON: vi.fn(),
  del: vi.fn(),
}));
vi.mock("../../src/api/client", () => api);
vi.mock("../../src/store/toast", () => ({ pushToast: vi.fn() }));
vi.mock("../../src/lib/composer", () => ({ loadProviders: vi.fn(), loadAgents: vi.fn() }));
// jsdom ships no ResizeObserver; the framing sheet measures its stage with one and every `FocalImg`
// preview does too. A no-op is enough here — the MEASURED path has its own suite
// (`tests/hooks/useFocalPosition.test.tsx`) and what this file is about is the write and the wiring.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

import { MediaGallery } from "../../src/components/MediaGallery";
import {
  clampPan,
  framingReducer,
  initialFramingState,
  panLimit,
  roundFocal,
  tapPan,
} from "../../src/components/media/FramingSheet";
import { setUI } from "../../src/store/ui";

// ── the pure half ────────────────────────────────────────────────────────────────────────────────

describe("framingReducer — the focal point IS the crop centre (R57 §9①)", () => {
  it("reads the point off the crop area's PERCENTAGES, not its rounded pixels", () => {
    const next = framingReducer(initialFramingState, {
      t: "area",
      area: { x: 10, y: 60, width: 20, height: 20 },
    });
    expect(next.point).toEqual({ x: 0.2, y: 0.7 });
  });

  it("clamps a point the library reports outside the picture", () => {
    const out = framingReducer(initialFramingState, {
      t: "area",
      area: { x: -30, y: 95, width: 20, height: 20 },
    });
    expect(out.point).toEqual({ x: 0, y: 1 });
  });

  it("keeps the pan and the loaded size as plain state", () => {
    const panned = framingReducer(initialFramingState, { t: "pan", crop: { x: 12, y: -4 } });
    expect(panned.crop).toEqual({ x: 12, y: -4 });
    const media = { width: 300, height: 200, naturalWidth: 1200, naturalHeight: 800 };
    expect(framingReducer(panned, { t: "loaded", media }).media).toBe(media);
  });
});

describe("tapPan / clampPan — tap-to-place, and how far a reticle may travel (R57 §2.2a)", () => {
  const media = { width: 300, height: 200, naturalWidth: 1200, naturalHeight: 800 };

  it("moves the tapped spot under the reticle — the pan is the negated tap offset", () => {
    expect(tapPan({ x: 0, y: 0 }, { x: 40, y: -20 }, media)).toEqual({ x: -40, y: 20 });
  });

  it("lets the reticle's CENTRE reach the picture's own edges — HALF the picture, not (picture−reticle)/2", () => {
    // The library's `restrictPosition` keeps the whole crop AREA inside the media, which is right for a
    // crop and wrong for a reticle: it would fence the focal point into the middle of the picture and a
    // subject near an edge would be silently unaddressable. So its fence is off and this is the limit.
    expect(panLimit(media)).toEqual({ x: 150, y: 100 });
    expect(tapPan({ x: 0, y: 0 }, { x: 400, y: 400 }, media)).toEqual({ x: -150, y: -100 });
    expect(tapPan({ x: 0, y: 0 }, { x: -400, y: -400 }, media)).toEqual({ x: 150, y: 100 });
  });

  it("clamps a pan the LIBRARY reports too — one rule, both sources", () => {
    // `crop` is a CONTROLLED prop: react-easy-crop renders whatever it is handed, so a drag past the
    // limit would paint the picture off into the background.
    expect(clampPan({ x: 900, y: -900 }, media)).toEqual({ x: 150, y: -100 });
  });

  it("does nothing before the picture has loaded — there is no geometry to reason about", () => {
    expect(tapPan({ x: 3, y: 4 }, { x: 40, y: 40 }, null)).toEqual({ x: 3, y: 4 });
    expect(clampPan({ x: 900, y: 900 }, null)).toEqual({ x: 900, y: 900 });
  });
});

describe("roundFocal — two decimals, per R57 §2.3", () => {
  it("stores two decimals and nothing finer", () => {
    // One percent of a cover-scaled image is 4–8 px on a 390 px window — already finer than the eye,
    // and Craft's and Shopify's four decimals are storage habit rather than a requirement.
    expect(roundFocal({ x: 0.123456, y: 0.987654 })).toEqual({ x: 0.12, y: 0.99 });
    expect(roundFocal({ x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 });
  });

  it("clamps, and answers the centre for a non-finite coordinate", () => {
    expect(roundFocal({ x: -3, y: 9 })).toEqual({ x: 0, y: 1 });
    expect(roundFocal({ x: Number.NaN, y: 0.2 })).toEqual({ x: 0.5, y: 0.2 });
  });
});

// ── the sheet, in the real gallery ───────────────────────────────────────────────────────────────

const file = (name: string, role: string, over: Partial<MediaFile> = {}): MediaFile => ({
  name,
  file: `${name}.webp`,
  url: `/api/media/gacha/files/${role}/${name}.webp`,
  format: "webp",
  size_bytes: 88_000,
  revision: "1:88000",
  width: 640,
  height: 854,
  unusable: false,
  unusable_reason: null,
  listed: false,
  hidden: false,
  ...over,
});

const bundledRow = (id: string): MediaFile => ({
  name: id,
  file: "",
  url: "",
  bundled: id,
  format: null,
  size_bytes: 0,
  revision: "",
  width: null,
  height: null,
  unusable: false,
  unusable_reason: null,
  listed: false,
  hidden: false,
});

const cast = ["pegasus", "atlas", "3", "4", "lyra"].map(bundledRow);

function index(characters: MediaFile[]): MediaIndex {
  return {
    ns: "gacha",
    collation: "library-v1",
    roles: { characters, banner: [], reel: [], oracle: [] },
    slots: {},
  };
}

function renderGallery(payload: MediaIndex): ReturnType<typeof render> {
  api.getJSON.mockResolvedValue(payload);
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const ui: ReactElement = (
    <QueryClientProvider client={qc}>
      <MediaGallery ns="gacha" def={MEDIA_NS.gacha} />
    </QueryClientProvider>
  );
  return render(ui);
}

async function openItem(role: string, name: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: `Open the ${role} gallery` }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name }));
  return dialog;
}

/** The `roles.characters.files` list of the single settings PUT the sheet caused. */
function savedFiles(at = 0): unknown[] {
  const [url, body] = api.putJSON.mock.calls[at] as [
    string,
    { media: { namespaces: { gacha: { roles: { characters: { files: unknown[] } } } } } },
  ];
  expect(url).toBe("/api/settings");
  return body.media.namespaces.gacha.roles.characters.files;
}

beforeEach(() => {
  api.getJSON.mockReset();
  api.del.mockReset().mockResolvedValue(undefined);
  setUI({ tab: "conf" });
  api.getJSONWithHeader.mockReset().mockResolvedValue({ data: {}, header: "r1" });
  api.putJSON.mockReset().mockResolvedValue({
    settings: { notifications: {} },
    restart_required: [],
    warnings: [],
    providers_rev: "r1",
  });
});
afterEach(async () => {
  cleanup();
  setUI({ tab: "fleet" });
  await new Promise((r) => setTimeout(r, 0));
});

describe("the framing affordance is capability-gated (§5)", () => {
  it("appears on an owner file in a FRAMABLE role, and says whether one is set", async () => {
    renderGallery(index([file("a", "characters"), ...cast]));
    const dialog = await openItem("characters", "a.webp");
    expect(within(dialog).getByRole("button", { name: /Set framing/ }).textContent).toContain(
      "not set",
    );
  });

  it("reads SET once the point is keyed to the file's CURRENT revision", async () => {
    renderGallery(
      index([file("a", "characters", { focal: { x: 0.4, y: 0.2, rev: "1:88000" } }), ...cast]),
    );
    const dialog = await openItem("characters", "a.webp");
    expect(within(dialog).getByRole("button", { name: /Set framing/ }).textContent).toContain(
      "set",
    );
  });

  it("is ABSENT on a BUNDLED entry — not disabled (Emma #6)", async () => {
    // The reason is not tidiness: a bundled entry's value is a hand-tuned PROPORTIONAL string, and
    // this reticle means CENTRED. Saving a point the owner never moved would jump the picture on
    // every surface at once. A per-entry focus-mode edit path is the recorded future.
    renderGallery(index([file("a", "characters"), ...cast]));
    const dialog = await openItem("characters", "pegasus (bundled)");
    expect(within(dialog).queryByRole("button", { name: /Set framing/ })).toBeNull();
  });

  it("is ABSENT on a role the registry does not declare framable", async () => {
    // `reel` is a CUTOUT — it rides the tab transition as a figure, and a focal crop is exactly what
    // that surface has no use for. The registry says so; the panel does not decide.
    renderGallery({
      ns: "gacha",
      collation: "library-v1",
      roles: { characters: [], banner: [], reel: [file("cut", "reel")], oracle: [] },
      slots: {},
    });
    const dialog = await openItem("reel", "cut.webp");
    expect(within(dialog).queryByRole("button", { name: /Set framing/ })).toBeNull();
  });

  it("is ABSENT on a file whose bytes cannot be read — there is nothing to frame", async () => {
    renderGallery(
      index([
        file("bad", "characters", { unusable: true, unusable_reason: "unreadable" }),
        ...cast,
      ]),
    );
    const dialog = await openItem("characters", "bad.webp");
    expect(within(dialog).queryByRole("button", { name: /Set framing/ })).toBeNull();
    // …and the panel still SAYS why, which is the part the owner has to act on.
    expect(within(dialog).getByText(/unreadable or unsupported format/)).toBeTruthy();
  });
});

describe("the sheet itself", () => {
  it("opens as its OWN dialog with the previews the registry declares, captioned as examples", async () => {
    renderGallery(index([file("a", "characters"), ...cast]));
    const gallery = await openItem("characters", "a.webp");
    fireEvent.click(within(gallery).getByRole("button", { name: /Set framing/ }));
    const sheet = await screen.findByRole("dialog", { name: "Set framing" });
    // One window per registry row, labelled in the owner's words…
    for (const label of ["capsule card", "promo slide", "magazine cover"])
      expect(within(sheet).getByText(label)).toBeTruthy();
    // …and Statamic's honesty about what they are (council M4).
    expect(within(sheet).getByText("Previews are examples.")).toBeTruthy();
    // It is a SIBLING of the gallery, not a child — a nested dialog would ride the gallery's own
    // keydown trap and its Escape would close the screen underneath it.
    expect(sheet.contains(gallery)).toBe(false);
    expect(gallery.contains(sheet)).toBe(false);
  });

  it("says the framing was RESET when the file changed under its name (§2.2)", async () => {
    renderGallery(
      index([file("a", "characters", { focal: { x: 0.4, y: 0.2, rev: "0:1" } }), ...cast]),
    );
    const gallery = await openItem("characters", "a.webp");
    // …and the affordance already reads "not set", because a stale point IS unset everywhere.
    expect(within(gallery).getByRole("button", { name: /Set framing/ }).textContent).toContain(
      "not set",
    );
    fireEvent.click(within(gallery).getByRole("button", { name: /Set framing/ }));
    const sheet = await screen.findByRole("dialog", { name: "Set framing" });
    expect(within(sheet).getByText("Framing was reset — the file changed.")).toBeTruthy();
  });

  it("offers CLEAR only where there is a live point to clear, and it removes the field", async () => {
    renderGallery(
      index([file("a", "characters", { focal: { x: 0.4, y: 0.2, rev: "1:88000" } }), ...cast]),
    );
    const gallery = await openItem("characters", "a.webp");
    fireEvent.click(within(gallery).getByRole("button", { name: /Set framing/ }));
    const sheet = await screen.findByRole("dialog", { name: "Set framing" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Clear framing" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    // Cleared by REMOVAL, never by persisting a `{0.5, 0.5}` that means the same thing.
    expect(savedFiles()).toEqual([{ name: "a.webp" }]);
  });
});
