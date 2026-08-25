import { describe, expect, it } from "vitest";

import type { LibraryRow } from "../../src/lib/mediaLibrary";
import {
  activeBannerSet,
  assignBanners,
  bannerPool,
  SERVICE_BANNER_SET,
} from "../../src/themes/cosmos/serviceBanners";

// Cosmos integration: the WebP asset set bundles, the thin `assignBanners` wrapper delegates to the generic
// picker (whose algorithm is covered in tests/lib/assignFromSet), and — since S6 — the SET IS A LIBRARY: the
// pool a host sheet deals from is whatever the `service-banners` role's bundled tier resolved to, so hiding a
// banner takes it out of the rotation and reordering the section reorders the deal.

/** A bundled row as the server collates it — id in both `name` and `bundled`, no file, no url. */
const row = (id: string, over: Partial<LibraryRow> = {}): LibraryRow => ({
  name: id,
  file: "",
  bundled: id,
  ...over,
});

describe("cosmos serviceBanners", () => {
  it("bundles the cropped banner set, each id its file's own stem", () => {
    expect(SERVICE_BANNER_SET.length).toBeGreaterThanOrEqual(12);
    expect(SERVICE_BANNER_SET.every((b) => b.url.length > 0)).toBe(true);
    // The ids are what the backend mirrors and what a `{bundled: …}` config entry names, so they have
    // to be the bare stems and they have to be in the folder's own order.
    expect(SERVICE_BANNER_SET.slice(0, 3).map((b) => b.id)).toEqual([
      "banner-01",
      "banner-02",
      "banner-03",
    ]);
  });

  it("gives a host's services distinct banners", () => {
    const ids = ["corsair.ssh", "corsair.web", "corsair.rdp"];
    const m = assignBanners(ids, bannerPool(undefined));
    expect(new Set(ids.map((id) => m.get(id))).size).toBe(ids.length);
  });
});

describe("the rotation as a library (S6)", () => {
  it("a STUB payload deals the whole shipped set — the degrade every adapter runs on", () => {
    expect(bannerPool(undefined)).toEqual(SERVICE_BANNER_SET.map((b) => b.url));
  });

  it("the library's ORDER is the pool's order, and an unknown id falls out", () => {
    expect(bannerPool(["banner-03", "banner-01", "retired"])).toEqual([
      SERVICE_BANNER_SET[2].url,
      SERVICE_BANNER_SET[0].url,
    ]);
  });

  it("switching every banner off deals NOTHING — not the shipped set", () => {
    // The distinction `bundledSetFrom` draws: an empty ARRAY is the owner's own answer, and dealing
    // the shipped set for it would make the In-use switch a lie.
    expect(bannerPool([])).toEqual([]);
    expect(assignBanners(["a.svc"], bannerPool([])).size).toBe(0);
  });

  it("the §2.4 resolver reads the bundled tier only, hidden rows dropped", () => {
    const rows = [
      row("banner-01"),
      row("banner-02", { hidden: true }),
      // An owner's own file in this folder binds to a SERVICE and is the family card's business.
      { name: "jellyfin", file: "jellyfin.png" },
    ];
    expect(activeBannerSet(rows)).toEqual({ ids: ["b:banner-01"], mode: "deal" });
  });
});
