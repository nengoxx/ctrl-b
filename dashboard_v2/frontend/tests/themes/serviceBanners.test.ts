import { describe, expect, it } from "vitest";

import { assignBanners, SERVICE_BANNERS } from "../../src/themes/cosmos/serviceBanners";

// Service-banner assignment (cosmos host detail). Guards the corsair repeat fix: within one host, every
// service must get a DISTINCT banner (≤ N services), the assignment must be STABLE regardless of incoming
// order, and a host with more services than banners must still assign every one.

describe("serviceBanners", () => {
  it("bundles the cropped banner set", () => {
    expect(SERVICE_BANNERS.length).toBeGreaterThanOrEqual(12);
    expect(SERVICE_BANNERS.every((u) => typeof u === "string" && u.length > 0)).toBe(true);
  });

  it("never repeats a banner within a host (the corsair bug)", () => {
    const ids = ["corsair.ssh", "corsair.web", "corsair.rdp", "corsair.smb", "corsair.vnc"];
    const m = assignBanners(ids);
    const urls = ids.map((id) => m.get(id));
    expect(urls.every(Boolean)).toBe(true);
    expect(new Set(urls).size).toBe(ids.length); // all distinct
  });

  it("is stable regardless of the incoming service order (no flicker on polls)", () => {
    const ids = ["vault.ssh", "vault.web", "corsair.rdp", "corsair.smb"];
    const a = assignBanners(ids);
    const b = assignBanners([...ids].reverse());
    for (const id of ids) expect(a.get(id)).toBe(b.get(id));
  });

  it("assigns every service even when a host has more services than banners", () => {
    const ids = Array.from({ length: SERVICE_BANNERS.length + 6 }, (_, i) => `big.svc${i}`);
    const m = assignBanners(ids);
    expect(m.size).toBe(ids.length);
    expect([...m.values()].every(Boolean)).toBe(true);
  });
});
