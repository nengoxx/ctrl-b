import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MachineEditor } from "../../src/components/MachineEditor";
import type { Host } from "../../src/types";

// MachineEditor — D3 slice 2 additions: the `VPN host` input + `SSH via VPN first` Switch, plumbed
// through the Draft → PUT payload. We mock the mutation-hook boundary (like agentsEditor* tests) and
// drive the REAL component's DOM. Key regression: because this editor now MANAGES both fields, it must
// always SEND them (the backend's omit-preserves is for old clients that don't) — an untouched host's
// loaded vpn_host/ssh_prefer_vpn must appear in the payload, not be dropped.

const h = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  discover: vi.fn(),
}));

vi.mock("../../src/hooks/useHostMutations", () => ({
  useCreateHost: () => ({ mutate: h.create, isPending: false }),
  useUpdateHost: () => ({ mutate: h.update, isPending: false }),
  useDeleteHost: () => ({ mutate: h.remove, isPending: false }),
  useDiscoverVpn: () => ({ mutate: h.discover, isPending: false, data: undefined }),
}));

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
    status: null,
    has_password: true,
    services: [],
    vpn_host: null,
    ssh_prefer_vpn: false,
    ...over,
  };
}

function openRow(name: string) {
  fireEvent.click(screen.getByText(name)); // the .label div bubbles to the confrow's disclosure toggle
}

afterEach(cleanup);

describe("MachineEditor — vpn_host + ssh_prefer_vpn (D3 slice 2)", () => {
  it("renders the VPN host field and the SSH-via-VPN switch when a row is opened", () => {
    render(<MachineEditor hosts={[mkHost()]} />);
    openRow("corsair");
    expect(screen.getByLabelText("VPN host")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "SSH via VPN first" })).toBeTruthy();
  });

  it("round-trips edits to BOTH fields into the PUT payload", () => {
    render(<MachineEditor hosts={[mkHost()]} />);
    openRow("corsair");
    fireEvent.change(screen.getByLabelText("VPN host"), {
      target: { value: "corsair.tail.ts.net" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "SSH via VPN first" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    expect(h.update).toHaveBeenCalledTimes(1);
    const arg = h.update.mock.calls[0][0] as { id: string; payload: Record<string, unknown> };
    expect(arg.id).toBe("corsair");
    expect(arg.payload.vpn_host).toBe("corsair.tail.ts.net");
    expect(arg.payload.ssh_prefer_vpn).toBe(true);
  });

  it("SENDS a loaded host's existing values on an untouched save (omit-preserves regression)", () => {
    render(
      <MachineEditor hosts={[mkHost({ vpn_host: "corsair.tail.ts.net", ssh_prefer_vpn: true })]} />,
    );
    openRow("corsair");
    fireEvent.click(screen.getByRole("button", { name: "save" })); // no edits

    const arg = h.update.mock.calls[0][0] as { payload: Record<string, unknown> };
    expect(arg.payload.vpn_host).toBe("corsair.tail.ts.net"); // preserved because the editor SENT it
    expect(arg.payload.ssh_prefer_vpn).toBe(true);
  });

  it("a blank VPN host serializes to null (explicit clear)", () => {
    render(<MachineEditor hosts={[mkHost({ vpn_host: "corsair.tail.ts.net" })]} />);
    openRow("corsair");
    fireEvent.change(screen.getByLabelText("VPN host"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    const arg = h.update.mock.calls[0][0] as { payload: Record<string, unknown> };
    expect(arg.payload.vpn_host).toBeNull();
  });
});

// D2-B — the per-host `wake_on_connect` flag rides the same Draft → PUT path as the D3 fields, and for
// the same reason must ALWAYS be sent by this editor (the backend's omit-preserves exists for bodies
// that don't model the field, not for this one).
describe("MachineEditor — wake_on_connect (D2-B)", () => {
  it("renders the switch, seeded from the host, with the MAC caveat spelled out", () => {
    render(<MachineEditor hosts={[mkHost({ wake_on_connect: true })]} />);
    openRow("corsair");
    const sw = screen.getByRole("switch", { name: "Wake when I connect" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("needs the MAC above")).toBeTruthy();
  });

  it("round-trips a toggle into the PUT payload", () => {
    render(<MachineEditor hosts={[mkHost()]} />);
    openRow("corsair");
    expect(
      screen.getByRole("switch", { name: "Wake when I connect" }).getAttribute("aria-checked"),
    ).toBe("false");
    fireEvent.click(screen.getByRole("switch", { name: "Wake when I connect" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(h.update.mock.calls[0][0].payload.wake_on_connect).toBe(true);
  });

  it("SENDS a loaded host's existing value on an untouched save (omit-preserves regression)", () => {
    render(<MachineEditor hosts={[mkHost({ wake_on_connect: true })]} />);
    openRow("corsair");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(h.update.mock.calls[0][0].payload.wake_on_connect).toBe(true);
  });

  it("defaults to false on a new machine", () => {
    render(<MachineEditor hosts={[]} />);
    openRow("add machine");
    fireEvent.change(screen.getByLabelText("Hostname"), { target: { value: "pegasus" } });
    fireEvent.change(screen.getByLabelText("IP or DNS name"), { target: { value: "10.0.0.9" } });
    fireEvent.click(screen.getByRole("button", { name: "add machine" }));
    expect(h.create.mock.calls[0][0].wake_on_connect).toBe(false);
  });
});

// D2-A/D50 — the presence pair (`wake_on_presence` + its optional per-host cooldown override) rides
// the same Draft → PUT path. The owner directive is the load-bearing one: EVERY machine defaults off,
// and a new machine must send neither field armed.
describe("MachineEditor — wake_on_presence + cooldown override (D2-A/D50)", () => {
  const SW = "Wake when my phone connects";

  it("renders both rows, seeded from the host", () => {
    render(
      <MachineEditor hosts={[mkHost({ wake_on_presence: true, wake_presence_cooldown_s: 900 })]} />,
    );
    openRow("corsair");
    expect(screen.getByRole("switch", { name: SW }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByLabelText<HTMLInputElement>("Presence cooldown (seconds)").value).toBe(
      "900",
    );
  });

  it("an unset cooldown renders blank — the field means 'use the global'", () => {
    render(<MachineEditor hosts={[mkHost({ wake_on_presence: true })]} />);
    openRow("corsair");
    expect(screen.getByLabelText<HTMLInputElement>("Presence cooldown (seconds)").value).toBe("");
  });

  it("round-trips a toggle + an override into the PUT payload", () => {
    render(<MachineEditor hosts={[mkHost()]} />);
    openRow("corsair");
    fireEvent.click(screen.getByRole("switch", { name: SW }));
    fireEvent.change(screen.getByLabelText("Presence cooldown (seconds)"), {
      target: { value: "60" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    const payload = h.update.mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload.wake_on_presence).toBe(true);
    expect(payload.wake_presence_cooldown_s).toBe(60);
  });

  it("a blank cooldown serializes to null, and 0 survives as a real value", () => {
    render(<MachineEditor hosts={[mkHost({ wake_presence_cooldown_s: 900 })]} />);
    openRow("corsair");
    const field = screen.getByLabelText("Presence cooldown (seconds)");
    fireEvent.change(field, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(h.update.mock.calls[0][0].payload.wake_presence_cooldown_s).toBeNull();

    fireEvent.change(field, { target: { value: "0" } }); // not null — "no cooldown on this host"
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(h.update.mock.calls[1][0].payload.wake_presence_cooldown_s).toBe(0);
  });

  it("SENDS a loaded host's existing values on an untouched save (omit-preserves regression)", () => {
    render(
      <MachineEditor hosts={[mkHost({ wake_on_presence: true, wake_presence_cooldown_s: 900 })]} />,
    );
    openRow("corsair");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    const payload = h.update.mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload.wake_on_presence).toBe(true);
    expect(payload.wake_presence_cooldown_s).toBe(900);
  });

  it("a new machine is created with the presence wake OFF and no override", () => {
    render(<MachineEditor hosts={[]} />);
    openRow("add machine");
    expect(screen.getByRole("switch", { name: SW }).getAttribute("aria-checked")).toBe("false");
    fireEvent.change(screen.getByLabelText("Hostname"), { target: { value: "pegasus" } });
    fireEvent.change(screen.getByLabelText("IP or DNS name"), { target: { value: "10.0.0.9" } });
    fireEvent.click(screen.getByRole("button", { name: "add machine" }));
    expect(h.create.mock.calls[0][0].wake_on_presence).toBe(false);
    expect(h.create.mock.calls[0][0].wake_presence_cooldown_s).toBeNull();
  });
});
