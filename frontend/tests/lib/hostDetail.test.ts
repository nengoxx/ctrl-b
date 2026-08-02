import { describe, expect, it } from "vitest";

import { hostDetailFacts } from "../../src/lib/hostDetail";
import { relativeTime } from "../../src/lib/relativeTime";
import type { Host, Service } from "../../src/types";

// The shared host-detail derivation (council M6) — the arithmetic cosmos, frontier and gacha's dossier all
// read. The two component test files pin what each theme RENDERS from it; these pin the values themselves,
// including the degenerate inputs a render path must survive (a host that has never been polled).

const host = (over: Partial<Host> = {}): Host => ({
  id: "h",
  name: "h",
  ip: "10.0.0.1",
  mac: null,
  ssh_username: null,
  ssh_port: 22,
  os_type: "linux",
  role: null,
  tags: [],
  status: {
    host_id: "h",
    online: true,
    ping_ms: 12,
    last_seen: null,
    checked_at: "2026-01-01T00:00:00Z",
    error: null,
  },
  ...over,
});

const svc = (id: string, online: boolean): Service => ({
  id,
  host_id: "h",
  name: id,
  kind: null,
  port: 1,
  path: "",
  autostart: false,
  url: null,
  controls: [],
  status: { service_id: id, online, checked_at: "x", error: null },
});

describe("hostDetailFacts", () => {
  it("online host: ping through, seen = now, ratio counts only the UP services", () => {
    const f = hostDetailFacts(host(), [svc("a", true), svc("b", false), svc("c", true)]);
    expect(f).toMatchObject({ online: true, ping: 12, upCount: 2, total: 3, ratio: "2/3" });
    expect(f.seen).toBe("now");
  });

  it("offline host: seen falls back to relativeTime(last_seen); lastSeen is that value either way", () => {
    const iso = new Date(Date.now() - 2 * 3600_000).toISOString();
    const off = hostDetailFacts(
      host({ status: { ...host().status!, online: false, ping_ms: null, last_seen: iso } }),
      [],
    );
    expect(off.online).toBe(false);
    expect(off.ping).toBeNull();
    expect(off.seen).toBe(relativeTime(iso)); // "2h ago"
    expect(off.lastSeen).toBe(off.seen);

    // ONLINE keeps lastSeen honest — it is the un-special-cased half (cosmos shows its own placeholder
    // in that slot, so it must be able to read the raw value).
    const on = hostDetailFacts(host({ status: { ...host().status!, last_seen: iso } }), []);
    expect(on.seen).toBe("now");
    expect(on.lastSeen).toBe(relativeTime(iso));
  });

  it("no services → ratio is null (each theme renders its own placeholder), counts are 0", () => {
    const f = hostDetailFacts(host(), []);
    expect(f.ratio).toBeNull();
    expect(f.upCount).toBe(0);
    expect(f.total).toBe(0);
  });

  it("a never-polled host (status null) reads offline, no ping, and an em-dash last-seen", () => {
    const f = hostDetailFacts(host({ status: null }), []);
    expect(f.online).toBe(false);
    expect(f.ping).toBeNull();
    expect(f.lastSeen).toBe("—"); // relativeTime's own null case
    expect(f.seen).toBe("—");
  });

  it("a service with no status row counts as down (never as up)", () => {
    const noStatus: Service = { ...svc("x", false), status: null };
    const f = hostDetailFacts(host(), [noStatus, svc("y", true)]);
    expect(f.ratio).toBe("1/2");
  });
});
