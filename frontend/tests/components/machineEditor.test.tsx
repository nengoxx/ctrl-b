import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MachineEditor } from "../../src/components/MachineEditor";
import type { Host } from "../../src/types";

// MachineEditor — D3 slice 2 additions: the `VPN host` input + `SSH via VPN first` Switch, plumbed
// through the Draft → PUT payload. We mock the mutation-hook boundary (like agentsEditor* tests) and
// drive the REAL component's DOM. Key regression: because this editor now MANAGES both fields, it must
// always SEND them (the backend's omit-preserves is for old clients that don't) — an untouched host's
// loaded vpn_host/ssh_prefer_vpn must appear in the payload, not be dropped.

const h = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn() }));

vi.mock("../../src/hooks/useHostMutations", () => ({
  useCreateHost: () => ({ mutate: h.create, isPending: false }),
  useUpdateHost: () => ({ mutate: h.update, isPending: false }),
  useDeleteHost: () => ({ mutate: h.remove, isPending: false }),
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
