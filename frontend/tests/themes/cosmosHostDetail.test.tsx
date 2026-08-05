import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CosmosHostDetail } from "../../src/themes/cosmos/CosmosHostDetail";
import { relativeTime } from "../../src/lib/relativeTime";
import type { Host, Service } from "../../src/types";

// CosmosHostDetail (C3b) — the pure host-detail sheet content, rendered standalone (presentation only, no
// store/query wiring). Written as the PINNING half of the M6 extraction (council M6, G2): cosmos and
// frontier carried byte-similar host derivations and gacha would be the third copy, so the shared values
// move to `lib/hostDetail.ts` — and these cases pin cosmos's CURRENT rendered output first, so the
// refactor is provably behaviour-identical rather than "looks the same".
//
// The frontier half already existed (`frontierHostDetail.test.tsx`); cosmos had no component test at all,
// which is exactly the gap a refactor would have fallen through.

// D53 M3 — the service rows carry the owner's `kit` service ICON now, and `ServiceIcon` reads the media
// index. Mocked to the fresh-install state (no owner files, so no icon element) rather than wrapped in a
// QueryClientProvider — the frontierFleetSheet precedent; the icon itself has its own five-surface suite.
vi.mock("../../src/hooks/useMedia", () => ({ useMediaIndex: () => ({ data: undefined }) }));

afterEach(cleanup);

const host = (over: Partial<Host> = {}): Host => ({
  id: "vega",
  name: "vega",
  ip: "10.0.0.9",
  mac: "aa:bb:cc:dd:ee:ff",
  ssh_username: null,
  ssh_port: 22,
  os_type: "linux",
  role: "workstation",
  tags: [],
  status: {
    host_id: "vega",
    online: true,
    ping_ms: 12,
    last_seen: null,
    checked_at: "2026-01-01T00:00:00Z",
    error: null,
  },
  ...over,
});

const svc = (over: Partial<Service> = {}): Service => ({
  id: "svc-1",
  host_id: "vega",
  name: "grafana",
  kind: null,
  port: 3000,
  path: "",
  autostart: false,
  url: "http://10.0.0.9:3000",
  controls: [],
  status: { service_id: "svc-1", online: true, checked_at: "2026-01-01T00:00:00Z", error: null },
  ...over,
});

function renderHD(props: Partial<Parameters<typeof CosmosHostDetail>[0]> = {}) {
  const run = vi.fn().mockResolvedValue(undefined);
  const h = props.host ?? host();
  const { container } = render(
    <CosmosHostDetail
      host={h}
      services={props.services ?? []}
      busy={props.busy ?? false}
      run={props.run ?? run}
      titleId="host-title"
      {...(props.onStep ? { onStep: props.onStep } : {})}
    />,
  );
  return { container, run: props.run ?? run, h };
}

/** The glance cluster's values in order: [alive-or-seen, services] (services absent when there are none). */
const glance = (c: HTMLElement): string[] =>
  [...c.querySelectorAll<HTMLElement>(".hd-glance span")].map((s) => s.textContent ?? "");
/** The muted id line: ping · ip · (vpn) · mac. */
const ids = (c: HTMLElement): string[] =>
  [...c.querySelectorAll<HTMLElement>(".hd-ids span")].map((s) => s.textContent ?? "");

describe("CosmosHostDetail — the derived values (M6 pinning)", () => {
  it("online: status 'online · role', alive placeholder, 2/3 services, '12 ms' ping", () => {
    const services = [
      svc({ id: "a" }),
      svc({ id: "b" }),
      svc({ id: "c", status: { service_id: "c", online: false, checked_at: "x", error: null } }),
    ];
    const { container } = renderHD({ services });
    expect(container.querySelector(".hd-status .t")?.textContent).toBe("online · workstation");
    expect(container.querySelector(".hd-status")?.className).toContain("on");
    // Uptime is DEFERRED — online reads the placeholder, NOT relative time (the cosmos/frontier difference
    // this extraction must preserve: frontier's same slot reads "now").
    expect(glance(container)).toEqual(["—", "2/3"]);
    expect(ids(container)[0]).toBe("12 ms");
  });

  it("offline: status 'asleep', glance falls back to relativeTime(last_seen), ping —", () => {
    const lastSeen = new Date(Date.now() - 3 * 3600_000).toISOString(); // 3h ago
    const h = host({
      status: { ...host().status!, online: false, ping_ms: null, last_seen: lastSeen },
    });
    const { container } = renderHD({ host: h });
    expect(container.querySelector(".hd-status .t")?.textContent).toBe("asleep · workstation");
    expect(container.querySelector(".hd-status")?.className).not.toContain(" on");
    expect(glance(container)[0]).toBe(relativeTime(lastSeen)); // "3h ago"
    expect(ids(container)[0]).toBe("—");
  });

  it("no services → the glance carries the alive/seen value alone (no ratio)", () => {
    const { container } = renderHD({ services: [] });
    expect(glance(container)).toEqual(["—"]);
  });

  it("the id line is ping · ip · vpn? · mac, with mac falling back to —", () => {
    const withVpn = renderHD({ host: host({ vpn_host: "vega.tail.ts.net" }) });
    expect(ids(withVpn.container)).toEqual([
      "12 ms",
      "10.0.0.9",
      "vega.tail.ts.net",
      "aa:bb:cc:dd:ee:ff",
    ]);
    cleanup();
    const noMac = renderHD({ host: host({ mac: null }) });
    expect(ids(noMac.container)).toEqual(["12 ms", "10.0.0.9", "—"]);
  });

  it("online → Reboot + Shut down + Ping; the typed-action run is wired", () => {
    const { run, h } = renderHD();
    fireEvent.click(screen.getByRole("button", { name: /reboot/i }));
    expect(run).toHaveBeenCalledWith("reboot", h);
    fireEvent.click(screen.getByRole("button", { name: /shut down/i }));
    expect(run).toHaveBeenCalledWith("shutdown", h);
    fireEvent.click(screen.getByRole("button", { name: /ping/i }));
    expect(run).toHaveBeenCalledWith("ping", h);
    expect(screen.queryByRole("button", { name: /^wake$/i })).toBeNull();
  });

  it("offline → Wake (+ Ping); busy disables the whole bar", () => {
    const h = host({ status: { ...host().status!, online: false, ping_ms: null } });
    const { run } = renderHD({ host: h });
    fireEvent.click(screen.getByRole("button", { name: /^wake$/i }));
    expect(run).toHaveBeenCalledWith("wake", h);
    cleanup();

    const { container } = renderHD({ host: h, busy: true });
    const acts = [...container.querySelectorAll<HTMLButtonElement>(".hd-act")];
    expect(acts.length).toBeGreaterThan(0);
    acts.forEach((b) => expect(b.disabled).toBe(true));
  });

  it("services: online+url → link; down → non-link group; empty → placeholder", () => {
    const empty = renderHD({ services: [] });
    expect(empty.container.querySelector(".hd-svc-empty")?.textContent).toBe(
      "No services on this world",
    );
    cleanup();

    const services = [
      svc({ id: "up", name: "grafana" }),
      svc({
        id: "dn",
        name: "prometheus",
        port: 9090,
        url: null,
        status: { service_id: "dn", online: false, checked_at: "x", error: null },
      }),
    ];
    const { container } = renderHD({ services });
    const link = container.querySelector("a.hd-svc.on");
    expect(link?.getAttribute("href")).toBe("http://10.0.0.9:3000");
    expect(within(link as HTMLElement).getByText("grafana")).toBeTruthy();
    const down = container.querySelector(".hd-svc.off");
    expect(down?.tagName).toBe("DIV");
  });
});
