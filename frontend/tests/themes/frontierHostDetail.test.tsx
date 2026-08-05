import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FrontierHostDetail } from "../../src/themes/frontier/FrontierHostDetail";
import { relativeTime } from "../../src/lib/relativeTime";
import type { Host, Service } from "../../src/types";

// FrontierHostDetail (F3) — the pure host-detail sheet content. Rendered standalone (no store/query wiring:
// it's presentation only), so these cases pin the honest-stat rules (owner ruling: no Load/Temp, Uptime "—"),
// the online/offline action set + the typed-action `run` wiring, the per-service link/offline states, and the
// busy disable. Mirrors the frontierPresent fixture style.

// D53 M3 — the service rows carry the owner's `kit` service ICON now, and `ServiceIcon` reads the media
// index. Mocked to the fresh-install state (no owner files, so no icon element) rather than wrapped in a
// QueryClientProvider — the frontierFleetSheet precedent; the icon itself has its own five-surface suite.
vi.mock("../../src/hooks/useMedia", () => ({ useMediaIndex: () => ({ data: undefined }) }));

afterEach(cleanup);

const host = (over: Partial<Host> = {}): Host => ({
  id: "pegasus",
  name: "pegasus",
  ip: "10.0.0.7",
  mac: "aa:bb:cc:dd:ee:ff",
  ssh_username: null,
  ssh_port: 22,
  os_type: "linux",
  role: "workstation",
  tags: [],
  status: {
    host_id: "pegasus",
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
  host_id: "pegasus",
  name: "grafana",
  kind: null,
  port: 3000,
  path: "",
  autostart: false,
  url: "http://10.0.0.7:3000",
  controls: [],
  status: { service_id: "svc-1", online: true, checked_at: "2026-01-01T00:00:00Z", error: null },
  ...over,
});

/** Read a stat tile's value (the `.v` text, unit concatenated e.g. "12ms") by its `.l` label. */
function statValue(container: HTMLElement, label: string): string | undefined {
  const tiles = Array.from(container.querySelectorAll<HTMLElement>(".stat4"));
  const tile = tiles.find((t) => t.querySelector(".l")?.textContent === label);
  return tile?.querySelector(".v")?.textContent ?? undefined;
}

function renderHD(props: Partial<Parameters<typeof FrontierHostDetail>[0]> = {}) {
  const run = vi.fn().mockResolvedValue(undefined);
  const h = props.host ?? host();
  const { container } = render(
    <FrontierHostDetail
      host={h}
      services={props.services ?? []}
      art="rig1.png"
      plate="0xPEG01"
      busy={props.busy ?? false}
      run={props.run ?? run}
      titleId="host-title"
    />,
  );
  return { container, run: props.run ?? run, h };
}

describe("FrontierHostDetail", () => {
  it("offline host → name (titled), plate, Dormant, Wake rig; Wake calls run('wake', host)", () => {
    const h = host({ status: { ...host().status!, online: false, ping_ms: null } });
    const { container, run } = renderHD({ host: h });

    const heading = screen.getByRole("heading", { name: "pegasus" });
    expect(heading.id).toBe("host-title");
    expect(container.querySelector(".plate")?.textContent).toBe("0xPEG01");
    expect(screen.getByText("Dormant")).toBeTruthy();

    const wake = screen.getByRole("button", { name: /wake rig/i });
    fireEvent.click(wake);
    expect(run).toHaveBeenCalledWith("wake", h);
    expect(screen.queryByRole("button", { name: /reboot/i })).toBeNull();
  });

  it("online host → Reboot + Shut down; Shut down calls run('shutdown', host)", () => {
    const { run, h } = renderHD();
    expect(screen.getByRole("button", { name: /reboot/i })).toBeTruthy();
    const stop = screen.getByRole("button", { name: /shut down/i });
    fireEvent.click(stop);
    expect(run).toHaveBeenCalledWith("shutdown", h);
    expect(screen.queryByRole("button", { name: /wake rig/i })).toBeNull();
  });

  it("honest stats: online 12ms · Uptime — · Services 2/3 · Seen now", () => {
    const services = [
      svc({ id: "a", status: { service_id: "a", online: true, checked_at: "x", error: null } }),
      svc({ id: "b", status: { service_id: "b", online: true, checked_at: "x", error: null } }),
      svc({ id: "c", status: { service_id: "c", online: false, checked_at: "x", error: null } }),
    ];
    const { container } = renderHD({ services });
    expect(statValue(container, "Ping")).toBe("12ms");
    expect(statValue(container, "Uptime")).toBe("—");
    expect(statValue(container, "Services")).toBe("2/3");
    expect(statValue(container, "Seen")).toBe("now");
  });

  // ── The meta + info LINES (M6 pinning, G2): frontier composes both from the same host facts cosmos
  //    derives, so these pin the rendered strings before the shared derivation moves to lib/hostDetail.ts.
  it("meta line: role · ip · vpn? · the live tail (ping when online)", () => {
    const { container } = renderHD({ host: host({ vpn_host: "pegasus.tail.ts.net" }) });
    expect(container.querySelector(".ro2")?.textContent).toBe(
      "workstation · 10.0.0.7 · pegasus.tail.ts.net · 12 ms",
    );
  });

  it("meta line offline: the tail reads WOL-ready with a mac, powered down without one", () => {
    const off = (over: Partial<Host> = {}) =>
      host({ status: { ...host().status!, online: false, ping_ms: null }, ...over });
    const wol = renderHD({ host: off() });
    expect(wol.container.querySelector(".ro2")?.textContent).toBe(
      "workstation · 10.0.0.7 · wake-on-LAN ready",
    );
    cleanup();
    const dead = renderHD({ host: off({ mac: null }) });
    expect(dead.container.querySelector(".ro2")?.textContent).toBe(
      "workstation · 10.0.0.7 · powered down",
    );
  });

  it("info heading: the service tally when online, the WOL/power state when asleep", () => {
    const services = [
      svc({ id: "a" }),
      svc({ id: "b", status: { service_id: "b", online: false, checked_at: "x", error: null } }),
    ];
    const up = renderHD({ services });
    expect(up.container.querySelector(".svc-h")?.textContent).toBe("1/2 services up");
    cleanup();
    const bare = renderHD({ services: [] });
    expect(bare.container.querySelector(".svc-h")?.textContent).toBe("no services parked");
    cleanup();

    const offHost = host({ status: { ...host().status!, online: false, ping_ms: null } });
    const armed = renderHD({ host: offHost, services });
    expect(armed.container.querySelector(".svc-h")?.textContent).toBe("Powered down · WOL armed");
    cleanup();
    const noMac = renderHD({ host: { ...offHost, mac: null }, services });
    expect(noMac.container.querySelector(".svc-h")?.textContent).toBe("Powered down");
  });

  it("offline stats: Ping — and Seen = relativeTime(last_seen) (not 'now')", () => {
    const lastSeen = new Date(Date.now() - 3 * 3600_000).toISOString(); // 3h ago
    const h = host({
      status: { ...host().status!, online: false, ping_ms: null, last_seen: lastSeen },
    });
    const { container } = renderHD({ host: h });
    expect(statValue(container, "Ping")).toBe("—");
    const seen = statValue(container, "Seen");
    expect(seen).not.toBe("now");
    expect(seen).toBe(relativeTime(lastSeen)); // "3h ago"
  });

  it("services: online+url → link with Open; down → Offline + no link; empty → placeholder", () => {
    // empty
    const empty = renderHD({ services: [] });
    expect(empty.container.querySelector(".svc-empty")?.textContent).toBe(
      "No services parked on this rig",
    );
    cleanup();

    // online-with-url + a down service
    const services = [
      svc({ id: "up", name: "grafana", url: "http://10.0.0.7:3000" }),
      svc({
        id: "dn",
        name: "prometheus",
        port: 9090,
        url: null,
        status: { service_id: "dn", online: false, checked_at: "x", error: null },
      }),
    ];
    const { container } = renderHD({ services });
    const link = container.querySelector("a.svc.up");
    expect(link?.getAttribute("href")).toBe("http://10.0.0.7:3000");
    expect(within(link as HTMLElement).getByText("Open")).toBeTruthy();

    const down = container.querySelector(".svc.down");
    expect(down?.tagName).toBe("DIV"); // not a link
    expect(within(down as HTMLElement).getByText("Offline")).toBeTruthy();
  });

  it("busy=true disables the action buttons", () => {
    const { container } = renderHD({ busy: true });
    const pills = Array.from(container.querySelectorAll<HTMLButtonElement>(".pill"));
    expect(pills.length).toBeGreaterThan(0);
    pills.forEach((b) => expect(b.disabled).toBe(true));
  });
});
