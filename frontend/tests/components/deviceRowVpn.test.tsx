import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeviceRow } from "../../src/components/DeviceRow";
import type { Host } from "../../src/types";

// DeviceRow — D3 slice 2: the expanded kv-detail shows a `vpn` row when the host has a vpn_host, and
// omits it otherwise. (Outbound links use serviceBase(window.location); in jsdom the origin is
// localhost = LAN, so links stay on the ip — that vantage logic is unit-tested in serviceBase.test.)

function mkHost(over: Partial<Host> = {}): Host {
  return {
    id: "corsair",
    name: "corsair",
    ip: "192.168.1.128",
    mac: null,
    ssh_username: "user",
    ssh_port: 22,
    os_type: "windows",
    role: null,
    tags: [],
    status: {
      host_id: "corsair",
      online: false,
      ping_ms: null,
      last_seen: null,
      checked_at: "",
      error: null,
    },
    vpn_host: null,
    ssh_prefer_vpn: false,
    ...over,
  };
}

const rowProps = {
  services: [],
  index: 0,
  featured: false,
  open: true,
  busy: false,
  onToggle: vi.fn(),
  onAction: vi.fn(),
};

afterEach(cleanup);

describe("DeviceRow — vpn display line", () => {
  it("shows the vpn address in the kv detail when vpn_host is set", () => {
    render(<DeviceRow host={mkHost({ vpn_host: "corsair.tail.ts.net" })} {...rowProps} />);
    expect(screen.getByText("vpn")).toBeTruthy();
    expect(screen.getByText("corsair.tail.ts.net")).toBeTruthy();
  });

  it("omits the vpn line when vpn_host is absent", () => {
    render(<DeviceRow host={mkHost()} {...rowProps} />);
    expect(screen.queryByText("vpn")).toBeNull();
  });
});
