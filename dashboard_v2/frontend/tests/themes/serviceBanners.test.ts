import { describe, expect, it } from "vitest";

import { assignBanners, SERVICE_BANNERS } from "../../src/themes/cosmos/serviceBanners";

// Cosmos integration: the WebP asset set bundles, and the thin `assignBanners` wrapper delegates to the
// generic picker (whose algorithm is covered in tests/lib/assignFromSet). Here we just confirm the cosmos
// set is present and a host's services come back distinct.

describe("cosmos serviceBanners", () => {
  it("bundles the cropped banner set", () => {
    expect(SERVICE_BANNERS.length).toBeGreaterThanOrEqual(12);
    expect(SERVICE_BANNERS.every((u) => typeof u === "string" && u.length > 0)).toBe(true);
  });

  it("gives a host's services distinct banners", () => {
    const ids = ["corsair.ssh", "corsair.web", "corsair.rdp"];
    const m = assignBanners(ids);
    expect(new Set(ids.map((id) => m.get(id))).size).toBe(ids.length);
  });
});
