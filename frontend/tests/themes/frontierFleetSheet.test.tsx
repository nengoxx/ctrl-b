import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FrontierFleet ↔ F3 sheet wiring (the part frontierHostDetail.test.tsx can't see: selection → open sheet).
// `useFleet` is mocked to a fixed FleetView (the App.test.tsx harness pattern) so this exercises ONLY the
// wiring: a selected rig renders the host-detail content with the SAME art/plate presentation as the card.
//
// REGRESSION GUARD (F3 review): `placements` must stay identity-stable across renders (useMemo on `hosts`) —
// the `displayP` retention effect keys on a placement's identity, so a per-render rebuild loops
// (setDisplayP → render → new placement → effect …) and React throws "Maximum update depth exceeded".
// Mounting with a selection is exactly the case that loop lives in; this test failing with that error means
// the memo was dropped.

const fleet = vi.hoisted(() => {
  const view: Record<string, unknown> = {};
  return { view };
});
vi.mock("../../src/hooks/useFleet", () => ({ useFleet: () => fleet.view }));
// D53 M2 — the rig cards and the map cover now resolve through `GET /api/media/frontier`. Mocked rather
// than wrapped in a QueryClientProvider (the `useFleet` precedent above); `media.data = undefined` is the
// fresh-install state, which is also where the byte-identity arm below asserts.
const media = vi.hoisted(() => ({ data: undefined as MediaIndex | undefined }));
vi.mock("../../src/hooks/useMedia", () => ({ useMediaIndex: () => media }));

import type { MediaFile, MediaIndex } from "../../src/hooks/useMedia";
import { ART, assets } from "../../src/themes/frontier/art";
import { FrontierFleet } from "../../src/themes/frontier/FrontierFleet";
import { present } from "../../src/themes/frontier/present";
import { setFrontierSelection } from "../../src/store/frontierSelection";
import type { Host } from "../../src/types";

const host = (id: string, online: boolean): Host => ({
  id,
  name: id,
  ip: "10.0.0.7",
  mac: "aa:bb:cc:dd:ee:ff",
  ssh_username: null,
  ssh_port: 22,
  os_type: "linux",
  role: "workstation",
  tags: [],
  status: {
    host_id: id,
    online,
    ping_ms: online ? 12 : null,
    last_seen: null,
    checked_at: "2026-01-01T00:00:00Z",
    error: null,
  },
});

/** The painted `background-image` URL of one element (the theme paints art as backgrounds on explicitly
 *  dimensioned boxes — never a bare `<img>` — so this is how a rendered assignment is read back). */
const bgUrl = (el: Element | null): string | undefined =>
  /url\(["']?(.*?)["']?\)/.exec((el as HTMLElement | null)?.style.backgroundImage ?? "")?.[1];

/** Every rig CARD's art, in display order. */
const cardArt = (container: HTMLElement): (string | undefined)[] =>
  [...container.querySelectorAll(".frontier-rig .art")].map(bgUrl);

const ownerFile = (name: string): MediaFile => ({
  name,
  file: `${name}.png`,
  url: `/api/media/frontier/files/rigs/${name}.png`,
  format: "png",
  size_bytes: 10,
  revision: "1:10",
  width: 10,
  height: 10,
  unusable: false,
  unusable_reason: null,
});

/** …and the url that file is PAINTED at: the ladders hand over ready-to-paint urls since D65, so an
 *  owner file carries its `?rev=` (defect #1 — a rig replaced in place must not keep its old bytes). */
const painted = (name: string) => `${ownerFile(name).url}?rev=1%3A10`;

const mediaIndex = (
  roles: Record<string, MediaFile[]>,
  slots: MediaIndex["slots"] = {},
): MediaIndex => ({
  ns: "frontier",
  collation: "library-v1",
  roles: { rigs: [], hero: [], stack: [], ...roles },
  slots,
});

beforeEach(() => {
  fleet.view = {
    hosts: [host("pegasus", true), host("atlas", false)],
    svcByHost: new Map(),
    run: vi.fn(),
    busy: new Set<string>(),
    isLoading: false,
    error: null,
  };
  media.data = undefined;
});
afterEach(() => {
  setFrontierSelection(null);
  cleanup();
});

describe("FrontierFleet owner art (D53 M2)", () => {
  it("EMPTY folders ⇒ byte-identical to pre-M2: the indexed bundled rigs + the bundled map cover", () => {
    const { container } = render(<FrontierFleet active />);
    // The claim stated as the expression it replaced: card i paints `assets[present(host,i).asset]`.
    expect(cardArt(container)).toEqual(
      (fleet.view.hosts as Host[]).map((h, i) => assets[present(h, i).asset as string]),
    );
    expect(bgUrl(container.querySelector(".frontier-map .pic"))).toBe(ART.hero);
  });

  it("an UNUSABLE rig falls back for ITS card only — the others never re-deal", () => {
    media.data = mediaIndex({
      rigs: [
        { ...ownerFile("bad"), unusable: true, unusable_reason: "unreadable" },
        ownerFile("b"),
      ],
    });
    const { container } = render(<FrontierFleet active />);
    expect(cardArt(container)).toEqual([
      assets[present({ name: "pegasus" }, 0).asset as string], // the bundled rig for position 0
      painted("b"), // …and position 1 is untouched
    ]);
  });

  it("the map cover takes the hero pool's FIRST file, and only its order changes that", () => {
    // "W6" (owner ruling 2026-08-26): the `hero` pin is gone, so the cover is whatever the owner moved
    // to the top of that gallery — one priority system, on this surface as on every other.
    media.data = mediaIndex({ hero: [ownerFile("one"), ownerFile("two")] });
    const { container, rerender } = render(<FrontierFleet active />);
    expect(bgUrl(container.querySelector(".frontier-map .pic"))).toBe(painted("one"));
    media.data = mediaIndex({ hero: [ownerFile("two"), ownerFile("one")] });
    rerender(<FrontierFleet active />);
    expect(bgUrl(container.querySelector(".frontier-map .pic"))).toBe(painted("two"));
  });
});

describe("FrontierFleet F3 sheet wiring", () => {
  it("no selection → no sheet (the BottomSheet stays unmounted)", () => {
    const { container } = render(<FrontierFleet active />);
    expect(container.querySelector(".bs-sheet")).toBeNull();
    expect(container.querySelector(".frontier-hd")).toBeNull();
  });

  it("selected rig → sheet content renders the card's presentation (name/plate); no render loop", () => {
    setFrontierSelection("pegasus");
    const { container } = render(<FrontierFleet active />);
    const hd = container.querySelector(".frontier-hd");
    expect(hd).not.toBeNull();
    // the h2 the sheet's aria-labelledby points at — the host name
    expect(screen.getByRole("heading", { name: "pegasus" })).toBeTruthy();
    // the same plate present() gives the rig card (pegasus, index 0 → 0xPEG01)
    expect(hd?.querySelector(".plate")?.textContent).toBe("0xPEG01");
    // the composer-hide hook is set while open
    expect(document.body.dataset.sheet).toBe("open");
  });

  it("map ground tap clears the selection (a beacon tap does not)", () => {
    setFrontierSelection("pegasus");
    const { container } = render(<FrontierFleet active />);
    // a tap on the map art (not a beacon) → empty ground → selection cleared, sheet closing
    fireEvent.click(container.querySelector(".frontier-map .pic")!);
    expect(document.body.dataset.sheet).toBeUndefined();
    // fresh selection via the beacon itself — the ground-clear must NOT swallow it (closest check)
    fireEvent.click(container.querySelector(".frontier-beacon")!);
    expect(document.body.dataset.sheet).toBe("open");
  });

  it("Escape closes from ANYWHERE — focus never enters the non-modal sheet (the F3 audit fix)", () => {
    setFrontierSelection("pegasus");
    render(<FrontierFleet active />);
    expect(document.body.dataset.sheet).toBe("open");
    // keydown on document.body — focus still sits on the trigger outside .bs-root (non-modal, no focus steal)
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(document.body.dataset.sheet).toBeUndefined();
  });

  it("the exit slide overshoots fully-closed so the skin shadow rides out with it", () => {
    setFrontierSelection("pegasus");
    const { container } = render(<FrontierFleet active />);
    const sheet = container.querySelector<HTMLElement>(".bs-sheet")!;
    fireEvent.keyDown(document.body, { key: "Escape" });
    // jsdom heights are 0, so the exit target is exactly the clearance: without the overshoot the sheet
    // would rest flush with the viewport bottom and its upward box-shadow would hover over the tab bar
    // until unmount POPS it (the owner-reported artifact).
    expect(sheet.style.transform).toBe("translateY(80px)");
  });

  it("owner rigs are dealt in DISPLAY order, and the sheet shows the same art as the card", () => {
    media.data = mediaIndex({ rigs: [ownerFile("a"), ownerFile("b")] });
    setFrontierSelection("atlas"); // display position 1
    const { container } = render(<FrontierFleet active />);
    expect(cardArt(container)).toEqual([painted("a"), painted("b")]);
    // The F3 rule: the sheet reuses the CARD's placement, never a second resolution of the art.
    expect(bgUrl(container.querySelector(".frontier-hd .banner .img"))).toBe(painted("b"));
  });

  it("a CONSUMED (defaultPrevented) Escape leaves the sheet open — the modal-layer guard", () => {
    setFrontierSelection("pegasus");
    render(<FrontierFleet active />);
    // a modal layer above the sheet (ConfirmDialog et al) preventDefaults the Escape it consumes; the
    // sheet's document listener must honor that and NOT also close (cooperative dismissal).
    document.body.addEventListener("keydown", (e) => e.preventDefault(), { once: true });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(document.body.dataset.sheet).toBe("open");
  });
});
