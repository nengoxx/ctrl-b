import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
//  · framing is CAPABILITY-GATED on the ROLE (the registry decides), and offered on a BUNDLED entry
//    too since "W10" — Emma #6's exclusion is gone, because a stored point is centred by construction
//    and the shipped proportional string answers only where there is no stored point;
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
const toast = vi.hoisted(() => ({ pushToast: vi.fn() }));
vi.mock("../../src/store/toast", () => toast);
vi.mock("../../src/lib/composer", () => ({ loadProviders: vi.fn(), loadAgents: vi.fn() }));
// D70 §8.3 — the gallery's data layer asks whether the ACTIVE agent brings its own backdrop (an
// agent-backdrop destination must stop claiming its own picture is live when it does). It is a query
// PAIR of its own and says nothing about this suite's claims, so it answers NO ART here — the same
// stub `mediaGallery.test.tsx` uses, where the arms that drive it live.
vi.mock("../../src/hooks/useActiveBackdrop", () => ({ useActiveBackdrop: () => undefined }));
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
  initialFraming,
  panLimit,
  roundFocal,
  seedPan,
  tapPan,
  zoomPan,
} from "../../src/components/media/FramingSheet";
import { setUI } from "../../src/store/ui";

// ── the pure half ────────────────────────────────────────────────────────────────────────────────

const MEDIA = { width: 300, height: 200, naturalWidth: 1200, naturalHeight: 800 };

/** The state an UNFRAMED item opens in — no seed, so reports are live immediately. */
const fresh = initialFraming(undefined);

describe("framingReducer — the focal point IS the crop centre (R57 §9①)", () => {
  it("reads the point off the crop area's PERCENTAGES, not its rounded pixels", () => {
    const next = framingReducer(fresh, {
      t: "area",
      area: { x: 10, y: 60, width: 20, height: 20 },
    });
    expect(next.point).toEqual({ x: 0.2, y: 0.7 });
  });

  it("clamps a point the library reports outside the picture", () => {
    const out = framingReducer(fresh, {
      t: "area",
      area: { x: -30, y: 95, width: 20, height: 20 },
    });
    expect(out.point).toEqual({ x: 0, y: 1 });
  });

  it("keeps the pan and the loaded size as plain state", () => {
    const panned = framingReducer(fresh, { t: "pan", crop: { x: 12, y: -4 } });
    expect(panned.crop).toEqual({ x: 12, y: -4 });
    expect(framingReducer(panned, { t: "loaded", media: MEDIA }).media).toBe(MEDIA);
  });
});

describe("the SEED — opening a framed image shows its framing (Emma's S4 review #1)", () => {
  const seed = { x: 0.2, y: 0.75 };

  it("opens ON the stored point, before anything has loaded or been reported", () => {
    expect(initialFraming(seed).point).toEqual(seed);
    // …and an unframed item opens with nothing, exactly as before.
    expect(fresh.point).toBeNull();
    expect(fresh.applied, "no seed ⇒ reports are live from the first one").toBe(true);
  });

  it("IGNORES the centre the library reports while it measures", () => {
    // `onMediaLoad` calls `emitCropData()` and only then `onMediaLoaded` (react-easy-crop
    // index.module.mjs:308-316), so the first area report always describes the picture at crop {0,0}
    // — its centre. Reading it would replace the owner's framing with the middle of the picture on a
    // sheet they only opened to look at, which is exactly the bug this arm exists for.
    const centre = { x: 35, y: 35, width: 30, height: 30 };
    expect(framingReducer(initialFraming(seed), { t: "area", area: centre }).point).toEqual(seed);
  });

  it("derives the pan once the picture's size is known, and only then goes live", () => {
    const loaded = framingReducer(initialFraming(seed), { t: "loaded", media: MEDIA });
    expect(loaded.crop).toEqual(seedPan(seed, MEDIA));
    expect(loaded.applied).toBe(true);
    // …and from here the library's report IS the truth — this is the owner moving the picture.
    const moved = framingReducer(loaded, {
      t: "area",
      area: { x: 0, y: 0, width: 30, height: 30 },
    });
    expect(moved.point).toEqual({ x: 0.15, y: 0.15 });
  });

  it("a second `loaded` (a resize re-measure) does not re-seat the picture under the owner", () => {
    const loaded = framingReducer(initialFraming(seed), { t: "loaded", media: MEDIA });
    const moved = framingReducer(loaded, { t: "pan", crop: { x: 5, y: 5 } });
    expect(framingReducer(moved, { t: "loaded", media: MEDIA }).crop).toEqual({ x: 5, y: 5 });
  });
});

describe("seedPan — where a stored point has to sit", () => {
  it("offsets the picture by exactly how far the point is from its middle", () => {
    // `crop` is the offset of the picture's centre from the reticle's, so the point at `f` sits at
    // `(f − 0.5)·media + crop`; putting it under the reticle means `crop = (0.5 − f)·media`.
    expect(seedPan({ x: 0.5, y: 0.5 }, MEDIA)).toEqual({ x: 0, y: 0 });
    expect(seedPan({ x: 0.25, y: 0.75 }, MEDIA)).toEqual({ x: 75, y: -50 });
  });

  it("reaches the picture's own corners without the clamp biting", () => {
    expect(seedPan({ x: 0, y: 0 }, MEDIA)).toEqual(panLimit(MEDIA));
    expect(seedPan({ x: 1, y: 1 }, MEDIA)).toEqual({ x: -150, y: -100 });
  });

  it("clamps a hand-edited point from OUTSIDE the picture rather than panning it off the stage", () => {
    expect(seedPan({ x: -3, y: 9 }, MEDIA)).toEqual({ x: 150, y: -100 });
  });
});

// ── THE ZOOM (D70 §13-S6b wave 3) — the circle windows' `z`, and everything that moves with it ──
//
// The library paints `translate(crop) scale(zoom)`, so a point at fraction `f` sits at
// `(f − 0.5)·media·z + crop`. Every number below falls out of that one line: the pan a seed needs, how
// far the reticle may travel, and what the slider has to do to the pan so zooming does not slide the
// framing off whatever the owner just aimed at.

describe("the zoom's arithmetic", () => {
  it("seeds a stored point under the reticle AT the stored zoom", () => {
    // Without the factor the seeded pan is right only at z = 1: at z = 2 the picture is twice as wide
    // on the stage, so the same point is twice as far from its middle.
    expect(seedPan({ x: 0.25, y: 0.75 }, MEDIA, 2)).toEqual({ x: 150, y: -100 });
    expect(seedPan({ x: 0.25, y: 0.75 }, MEDIA, 1)).toEqual({ x: 75, y: -50 });
    // …and the default is 1, which is what keeps every un-zoomed call identical to the one before.
    expect(seedPan({ x: 0.25, y: 0.75 }, MEDIA)).toEqual(seedPan({ x: 0.25, y: 0.75 }, MEDIA, 1));
  });

  it("GROWS the pan limit with the zoom, or the reticle could not reach a magnified picture's edge", () => {
    // A limit that ignored the factor would fence the reticle into the middle 1/z of the picture —
    // the very unaddressability `panLimit` exists to refuse, through the back door.
    expect(panLimit(MEDIA, 2)).toEqual({ x: 300, y: 200 });
    expect(clampPan({ x: 280, y: 0 }, MEDIA, 2)).toEqual({ x: 280, y: 0 });
    expect(clampPan({ x: 280, y: 0 }, MEDIA, 1)).toEqual({ x: 150, y: 0 });
    // …and a corner of the picture is still exactly reachable at any zoom.
    expect(seedPan({ x: 0, y: 0 }, MEDIA, 3)).toEqual(panLimit(MEDIA, 3));
  });

  it("zoomPan keeps the aimed point under the reticle — the library's own rule at the centre", () => {
    // `setNewZoom` computes `zoomTarget·newZoom − zoomPoint` about the gesture's point; the reticle IS
    // the container's centre, where `zoomPoint` is {0,0} and the whole correction is `crop · new/old`.
    expect(zoomPan({ x: 60, y: -40 }, 1, 2)).toEqual({ x: 120, y: -80 });
    expect(zoomPan({ x: 120, y: -80 }, 2, 1)).toEqual({ x: 60, y: -40 });
    // …which is exactly the pan the seed would have derived at the new zoom, and that is the claim.
    expect(zoomPan(seedPan({ x: 0.2, y: 0.9 }, MEDIA, 1), 1, 2.5)).toEqual(
      seedPan({ x: 0.2, y: 0.9 }, MEDIA, 2.5),
    );
    expect(zoomPan({ x: 10, y: 10 }, 1, Number.NaN)).toEqual({ x: 10, y: 10 });
  });

  it("the reducer's `zoom` moves ONLY the zoom — the library reports its own pan first", () => {
    // `setNewZoom` calls `onCropChange` and THEN `onZoomChange` (index.module.mjs:507-520), so a
    // reducer that re-derived the pan here would apply the correction twice on every pinch.
    const at = framingReducer(
      { ...framingReducer(fresh, { t: "pan", crop: { x: 33, y: 0 } }) },
      { t: "zoom", zoom: 3 },
    );
    expect(at).toMatchObject({ zoom: 3, crop: { x: 33, y: 0 } });
    // …and a zoom from anywhere lands inside the range the slider can express.
    expect(framingReducer(fresh, { t: "zoom", zoom: 99 }).zoom).toBe(4);
    expect(framingReducer(fresh, { t: "zoom", zoom: 0.1 }).zoom).toBe(1);
  });

  it("opens on the STORED zoom, and derives the seed pan with it", () => {
    const opened = initialFraming({ x: 0.25, y: 0.75, z: 2 });
    expect(opened.zoom).toBe(2);
    expect(framingReducer(opened, { t: "loaded", media: MEDIA }).crop).toEqual(
      seedPan({ x: 0.25, y: 0.75 }, MEDIA, 2),
    );
    // An unzoomed item — and every item framed before the field existed — opens at 1.
    expect(initialFraming({ x: 0.25, y: 0.75 }).zoom).toBe(1);
    expect(fresh.zoom).toBe(1);
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

  it("WRITES NO ZOOM AT 1 — absent is the only spelling of it (wave 3)", () => {
    // The round-trip claim the field is additive on: framing at the slider's home position writes the
    // exact object it wrote before `z` existed, so nothing in a config the owner may open changes.
    expect(roundFocal({ x: 0.4, y: 0.6 })).toEqual({ x: 0.4, y: 0.6 });
    expect(Object.keys(roundFocal({ x: 0.4, y: 0.6 }, 1))).toEqual(["x", "y"]);
    expect(roundFocal({ x: 0.4, y: 0.6 }, 2.25)).toEqual({ x: 0.4, y: 0.6, z: 2.25 });
    // A pinch is CONTINUOUS — the library reports values the slider's step cannot express, and one
    // that rounds DOWN to the floor must vanish rather than store the forbidden `z: 1` (Emma's
    // wave-3 review: the write seam must test the value it writes, not the one it was handed).
    expect(Object.keys(roundFocal({ x: 0.4, y: 0.6 }, 1.004))).toEqual(["x", "y"]);
    // Two decimals, which is exactly what the slider's 0.05 step can express — and the ends hold.
    expect(roundFocal({ x: 0.4, y: 0.6 }, 1.0500000000000003).z).toBe(1.05);
    expect(roundFocal({ x: 0.4, y: 0.6 }, 99).z).toBe(4);
    expect(Object.keys(roundFocal({ x: 0.4, y: 0.6 }, Number.NaN))).toEqual(["x", "y"]);
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

const bundledRow = (id: string, over: Partial<MediaFile> = {}): MediaFile => ({
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
  ...over,
});

const cast = ["pegasus", "atlas", "3", "4", "lyra"].map((id) => bundledRow(id));

function index(characters: MediaFile[]): MediaIndex {
  return {
    ns: "gacha",
    collation: "library-v1",
    roles: { characters, banner: [], reel: [], oracle: [] },
    slots: {},
  };
}

/** The QueryClient is handed BACK so a test can push a new index into it — which is exactly what an
 *  authoritative refetch does, and the only way to drive "the file was replaced while the sheet was
 *  open" deterministically. */
function renderGallery(payload: MediaIndex): { qc: QueryClient } {
  api.getJSON.mockResolvedValue(payload);
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const ui: ReactElement = (
    <QueryClientProvider client={qc}>
      <MediaGallery ns="gacha" def={MEDIA_NS.gacha} />
    </QueryClientProvider>
  );
  render(ui);
  return { qc };
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
  toast.pushToast.mockReset();
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
    const dialog = await openItem("Characters", "a.webp");
    expect(within(dialog).getByRole("button", { name: "Focus" }).textContent).toContain("not set");
  });

  it("reads SET once the point is keyed to the file's CURRENT revision", async () => {
    renderGallery(
      index([file("a", "characters", { focal: { x: 0.4, y: 0.2, rev: "1:88000" } }), ...cast]),
    );
    const dialog = await openItem("Characters", "a.webp");
    expect(within(dialog).getByRole("button", { name: "Focus" }).textContent).toContain("set");
  });

  it("is OFFERED on a BUNDLED entry too ('W10' — the recorded H3 seam, built)", async () => {
    // It was absent at S4 on Emma #6: a bundled entry's shipped value is a hand-tuned PROPORTIONAL
    // string, and this reticle means CENTRED, so saving a point the owner never moved would have
    // jumped the picture on every surface. The item-mode design closed that — a STORED point is
    // centred by construction and the shipped string answers only where there is no stored point — and
    // the owner's round forced it: `characters/` is empty on a fresh install, so every entry in it is
    // bundled and the exclusion bit at 100%.
    renderGallery(index([file("a", "characters"), ...cast]));
    const dialog = await openItem("Characters", "pegasus (default)");
    expect(within(dialog).getByRole("button", { name: "Focus" }).textContent).toContain("not set");
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
    const dialog = await openItem("Transition figure", "cut.webp");
    expect(within(dialog).queryByRole("button", { name: "Focus" })).toBeNull();
  });

  it("is ABSENT on a file whose bytes cannot be read — there is nothing to frame", async () => {
    renderGallery(
      index([
        file("bad", "characters", { unusable: true, unusable_reason: "unreadable" }),
        ...cast,
      ]),
    );
    const dialog = await openItem("Characters", "bad.webp");
    expect(within(dialog).queryByRole("button", { name: "Focus" })).toBeNull();
    // …and the panel still SAYS why, which is the part the owner has to act on.
    expect(within(dialog).getByText(/unreadable or unsupported format/)).toBeTruthy();
  });
});

describe("the sheet itself", () => {
  it("opens as its OWN dialog with the previews the registry declares, captioned as examples", async () => {
    renderGallery(index([file("a", "characters"), ...cast]));
    const gallery = await openItem("Characters", "a.webp");
    fireEvent.click(within(gallery).getByRole("button", { name: "Focus" }));
    const sheet = await screen.findByRole("dialog", { name: "Set focus" });
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
    const gallery = await openItem("Characters", "a.webp");
    // …and the affordance already reads "not set", because a stale point IS unset everywhere.
    expect(within(gallery).getByRole("button", { name: "Focus" }).textContent).toContain("not set");
    fireEvent.click(within(gallery).getByRole("button", { name: "Focus" }));
    const sheet = await screen.findByRole("dialog", { name: "Set focus" });
    expect(within(sheet).getByText("Focus was reset — the file changed.")).toBeTruthy();
  });

  it("SEEDS from the stored point, so an untouched Save stores the SAME value (Emma #1)", async () => {
    // THE regression. The sheet used to open at the centre and the library reported that centre as
    // the live point while it measured, so opening a correctly framed image to look at it and
    // confirming without moving anything replaced the owner's framing with the middle of the picture.
    //
    // There is no "touched" rule here (unlike the crop step, where an untouched confirm means
    // something different from a framed one): Save always writes the point the sheet is SHOWING. That
    // is only safe because the point it shows is now the stored one — which is what this asserts, end
    // to end: a stored 0.18/0.82 goes in and 0.18/0.82 comes back out on the wire.
    renderGallery(
      index([file("a", "characters", { focal: { x: 0.18, y: 0.82, rev: "1:88000" } }), ...cast]),
    );
    const gallery = await openItem("Characters", "a.webp");
    fireEvent.click(within(gallery).getByRole("button", { name: "Focus" }));
    const sheet = await screen.findByRole("dialog", { name: "Set focus" });
    // The previews paint the STORED framing on open — the sheet's own visible proof of the seed.
    const preview = sheet.querySelector<HTMLImageElement>(".mgal-frame-win img");
    expect(preview?.style.objectPosition, "the previews show the stored point").toBe("18% 82%");
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    expect(savedFiles()).toEqual([{ name: "a.webp", focal: { x: 0.18, y: 0.82, rev: "1:88000" } }]);
  });

  it("frames a DEFAULT end to end ('W10'), and stores the point with an empty rev", async () => {
    // The whole bundled arm, on the wire: the sheet opens on the theme's own hashed asset (the server
    // sends no url for one), the save passes the row's revision — which is `""` for a bundled row —
    // and the guard lets it through because the two agree. The stored `rev: ""` is what `focalState`
    // reads as LIVE on a bundled row: build-hashed bytes have nothing to go stale against.
    const framed = bundledRow("pegasus", { focal: { x: 0.3, y: 0.7, rev: "" } });
    renderGallery(index([framed, ...cast.slice(1)]));
    const gallery = await openItem("Characters", "pegasus (default)");
    // The control says SET, which is the whole bundled rule in one word: `rev: ""` would read as
    // stale on a file, and reads as live here because there is no revision to disagree with.
    expect(within(gallery).getByRole("button", { name: "Focus" }).textContent).toContain("set");
    fireEvent.click(within(gallery).getByRole("button", { name: "Focus" }));
    const sheet = await screen.findByRole("dialog", { name: "Set focus" });
    // …so the sheet SEEDS from it (the previews are the visible proof), and an untouched Save writes
    // the same point back rather than the centre.
    expect(sheet.querySelector<HTMLImageElement>(".mgal-frame-win img")?.style.objectPosition).toBe(
      "30% 70%",
    );
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    // An order intent it is NOT: the write lists the one entry it acted on, and the rest of the
    // bundled tier stays in the fallback tier where a framing write may not move it.
    expect(savedFiles()).toEqual([{ bundled: "pegasus", focal: { x: 0.3, y: 0.7, rev: "" } }]);
    expect(toast.pushToast).not.toHaveBeenCalled();
  });

  it("REFUSES when the file was replaced while the owner was framing it (Emma #2)", async () => {
    // The coordinates were chosen against revision A; the `rev` they are stored under is read at SEND
    // time, which is revision B. Marrying the two would make `focalState` call the OLD picture's point
    // live on the NEW picture forever — the exact pair rev-keying exists to fold to "unset".
    const { qc } = renderGallery(
      index([file("a", "characters", { focal: { x: 0.18, y: 0.82, rev: "1:88000" } }), ...cast]),
    );
    const gallery = await openItem("Characters", "a.webp");
    fireEvent.click(within(gallery).getByRole("button", { name: "Focus" }));
    const sheet = await screen.findByRole("dialog", { name: "Set focus" });

    // …and now an SSH overwrite lands and the authoritative refetch publishes it.
    act(() => {
      qc.setQueryData(
        ["media", "gacha"],
        index([file("a", "characters", { revision: "2:99000" }), ...cast]),
      );
    });

    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.pushToast).toHaveBeenCalled());
    expect(String(toast.pushToast.mock.calls[0][0])).toContain("The picture changed");
    expect(api.putJSON, "nothing is written at all").not.toHaveBeenCalled();
  });

  it("CLEARING stays revision-independent — 'no framing' is true of whatever is there now", async () => {
    const { qc } = renderGallery(
      index([file("a", "characters", { focal: { x: 0.18, y: 0.82, rev: "1:88000" } }), ...cast]),
    );
    const gallery = await openItem("Characters", "a.webp");
    fireEvent.click(within(gallery).getByRole("button", { name: "Focus" }));
    const sheet = await screen.findByRole("dialog", { name: "Set focus" });
    act(() => {
      qc.setQueryData(
        ["media", "gacha"],
        index([file("a", "characters", { revision: "2:99000" }), ...cast]),
      );
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    expect(savedFiles()).toEqual([{ name: "a.webp" }]);
    expect(toast.pushToast).not.toHaveBeenCalled();
  });

  it("offers CLEAR only where there is a live point to clear, and it removes the field", async () => {
    renderGallery(
      index([file("a", "characters", { focal: { x: 0.4, y: 0.2, rev: "1:88000" } }), ...cast]),
    );
    const gallery = await openItem("Characters", "a.webp");
    fireEvent.click(within(gallery).getByRole("button", { name: "Focus" }));
    const sheet = await screen.findByRole("dialog", { name: "Set focus" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    // Cleared by REMOVAL, never by persisting a `{0.5, 0.5}` that means the same thing.
    expect(savedFiles()).toEqual([{ name: "a.webp" }]);
  });
});

// ── THE CIRCLE ROLE (D70 §13-S6b wave 3) ────────────────────────────────────────────────────────
//
// The zoom is offered where something READS one — a role that declares a circle destination
// (`MediaPreviewDef.shape`), which today is the agents' avatars library and nothing else. Everything
// above ran against gacha's `characters`, which declares none, so those arms are the other half of this
// claim: the sheet the backgrounds and the theme libraries get is byte-for-byte the one that shipped.

function agentsIndex(avatars: MediaFile[]): MediaIndex {
  return {
    ns: "agents",
    collation: "library-v1",
    roles: { avatars, backgrounds: [] },
    slots: {},
  };
}

function renderAgents(payload: MediaIndex): void {
  api.getJSON.mockResolvedValue(payload);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <MediaGallery ns="agents" def={MEDIA_NS.agents} />
    </QueryClientProvider>,
  );
}

/** The `roles.avatars.files` list of the single settings PUT an agents-side sheet caused. */
function savedAvatars(): unknown[] {
  const [url, body] = api.putJSON.mock.calls[0] as [
    string,
    { media: { namespaces: { agents: { roles: { avatars: { files: unknown[] } } } } } },
  ];
  expect(url).toBe("/api/settings");
  return body.media.namespaces.agents.roles.avatars.files;
}

async function openAvatarFraming(rows: MediaFile[]): Promise<HTMLElement> {
  renderAgents(agentsIndex(rows));
  fireEvent.click(await screen.findByRole("button", { name: "Open the Avatars gallery" }));
  const gallery = await screen.findByRole("dialog");
  fireEvent.click(within(gallery).getByRole("button", { name: "a.webp" }));
  fireEvent.click(within(gallery).getByRole("button", { name: "Focus" }));
  return await screen.findByRole("dialog", { name: "Set focus" });
}

const avatar = (over: Partial<MediaFile> = {}): MediaFile =>
  file("a", "avatars", { url: "/api/media/agents/files/avatars/a.webp", ...over });

describe("the sheet, for a role whose destination is a CIRCLE", () => {
  it("offers the zoom and the exact chat-face preview beside the card", async () => {
    const sheet = await openAvatarFraming([avatar()]);
    expect(within(sheet).getByRole("slider", { name: "Zoom" })).toBeTruthy();
    // Two windows of the SAME aspect, which the preview type otherwise forbids: a circle eats the
    // corners a square keeps, and the corners are where a portrait's hair and shoulders are.
    for (const label of ["gallery card", "chat face"])
      expect(within(sheet).getByText(label)).toBeTruthy();
    // The circle preview IS the destination, painted by the destination's own component — one box
    // carrying the picture, so a zoomed one is clipped by the disc that declares it.
    const circle = sheet.querySelector<HTMLElement>(".mgal-frame-win.circle");
    expect(circle?.tagName).toBe("SPAN");
    expect(circle?.querySelector("img"), "no inner image — the box IS the face").toBeNull();
    expect(circle?.style.backgroundImage).toContain("/api/media/agents/files/avatars/a.webp");
    // …and the lede names the shape the reticle is wearing.
    expect(within(sheet).getByText(/sits inside the circle/)).toBeTruthy();
  });

  it("keeps the SAME sheet for a role that declares no circle — no zoom, no circle preview", async () => {
    // gacha's `characters`: the regression guard on "backgrounds keep today's sheet unchanged", and
    // the reason the control is gated on the destination rather than on a flag someone sets.
    renderGallery(index([file("a", "characters"), ...cast]));
    const gallery = await openItem("Characters", "a.webp");
    fireEvent.click(within(gallery).getByRole("button", { name: "Focus" }));
    const sheet = await screen.findByRole("dialog", { name: "Set focus" });
    expect(within(sheet).queryByRole("slider", { name: "Zoom" })).toBeNull();
    expect(sheet.querySelector(".mgal-frame-win.circle")).toBeNull();
    expect(within(sheet).getByText(/sits inside the square/)).toBeTruthy();
  });

  it("SEEDS the stored zoom and writes it back untouched, beside the point it belongs to", async () => {
    const sheet = await openAvatarFraming([
      avatar({ focal: { x: 0.4, y: 0.3, rev: "1:88000", z: 2 } }),
    ]);
    expect(within(sheet).getByRole<HTMLInputElement>("slider", { name: "Zoom" }).value).toBe("2");
    // The circle preview shows the STORED framing on open — 640×854, so `s = (1, 854/640)·2`.
    const circle = sheet.querySelector<HTMLElement>(".mgal-frame-win.circle");
    expect(circle?.style.backgroundSize).toBe("200% 266.875%");
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    expect(savedAvatars()).toEqual([
      { name: "a.webp", focal: { x: 0.4, y: 0.3, z: 2, rev: "1:88000" } },
    ]);
  });

  it("stores the zoom the slider is left at — and NOTHING when it is left at 1", async () => {
    const sheet = await openAvatarFraming([
      avatar({ focal: { x: 0.4, y: 0.3, rev: "1:88000", z: 3 } }),
    ]);
    const slider = within(sheet).getByRole("slider", { name: "Zoom" });
    fireEvent.change(slider, { target: { value: "1" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    // Back at the home position the write is the exact object a pre-wave-3 save produced.
    expect(savedAvatars()).toEqual([{ name: "a.webp", focal: { x: 0.4, y: 0.3, rev: "1:88000" } }]);
  });

  it("CLEARING takes the zoom with it — it is one framing, not a point and a setting", async () => {
    const sheet = await openAvatarFraming([
      avatar({ focal: { x: 0.4, y: 0.3, rev: "1:88000", z: 2 } }),
    ]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    expect(savedAvatars()).toEqual([{ name: "a.webp" }]);
  });
});
