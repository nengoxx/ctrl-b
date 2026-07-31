import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MachineEditor } from "../../src/components/MachineEditor";
import type { Host } from "../../src/types";

// MachineEditor — D3 slice 3: the "Discover from Tailscale" button + inline per-host results. Unlike
// the slice-2 test (which mocks useHostMutations wholesale), the apply logic lives INSIDE the real
// useDiscoverVpn hook, so to observe the PUTs we mock the layer BELOW it — the api/client fetch
// helpers + the toast store — and drive the REAL hook through a real QueryClient.
//
// THE load-bearing assertion (audit HIGH-1): the fill PUT must carry the FULL host body. The hosts
// PUT is not a PATCH — the backend omit-preserves ONLY the flags that predate their editor rows
// (vpn_host/ssh_prefer_vpn, D47; the wake fields, D2-B/D50); a partial body would reset os_type to linux
// and DELETE mac/ssh_username/role/services. The body is built from a host list fetched FRESH inside
// the mutation (never the possibly-stale prop/cache).

const api = vi.hoisted(() => ({
  getJSON: vi.fn(),
  putJSON: vi.fn(),
  postJSON: vi.fn(),
  del: vi.fn(),
}));
const toast = vi.hoisted(() => ({ pushToast: vi.fn() }));

vi.mock("../../src/api/client", () => api);
vi.mock("../../src/store/toast", () => toast);

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
    wake_on_connect: false,
    ...over,
  };
}

/** Route the two GETs the hook makes: the discovery endpoint + the fresh hosts fetch. */
function mockGets(discovery: unknown, freshHosts: Host[]) {
  api.getJSON.mockImplementation((url: string) =>
    url === "/api/hosts/vpn-discovery" ? Promise.resolve(discovery) : Promise.resolve(freshHosts),
  );
}

function renderWithClient(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function clickDiscover() {
  fireEvent.click(screen.getByRole("button", { name: "Discover from Tailscale" }));
}

beforeEach(() => {
  api.getJSON.mockReset();
  api.putJSON.mockReset().mockResolvedValue({});
  toast.pushToast.mockReset();
});
afterEach(cleanup);

describe("MachineEditor — Discover from Tailscale (D3 slice 3)", () => {
  it("PUTs the FULL host body (fields preserved) ONLY for empty-current hosts", async () => {
    const alpha = mkHost({
      id: "alpha",
      name: "alpha",
      ip: "10.0.0.1",
      mac: "aa:bb:cc:dd:ee:ff",
      ssh_username: "gamer",
      ssh_port: 2222,
      os_type: "windows",
      role: "rig",
      services: [
        { name: "sunshine", kind: null, port: 47990, path: "", autostart: false, cmd: {} },
      ],
      vpn_host: null,
    });
    const hosts = [
      alpha,
      // Case-only difference vs the casefolded proposal → "already set", never "differs".
      mkHost({ id: "beta", name: "beta", ip: "10.0.0.2", vpn_host: "Beta.TS.NET" }),
      mkHost({ id: "gamma", name: "gamma", ip: "10.0.0.3", vpn_host: "old.ts.net" }),
    ];
    mockGets(
      {
        ok: true,
        results: [
          { id: "alpha", name: "alpha", current: null, proposed: "alpha.ts.net", online: true },
          {
            id: "beta",
            name: "beta",
            current: "Beta.TS.NET",
            proposed: "beta.ts.net",
            online: true,
          },
          {
            id: "gamma",
            name: "gamma",
            current: "old.ts.net",
            proposed: "new.ts.net",
            online: false,
          },
        ],
        unmatched: ["delta"],
      },
      hosts,
    );
    renderWithClient(<MachineEditor hosts={hosts} />);

    clickDiscover();

    // Exactly one apply, for the empty-current host, with the FULL body — os_type/mac/services/
    // ssh_username/ssh_port/role all carried; blank password = keep stored secret.
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    expect(api.putJSON).toHaveBeenCalledWith("/api/hosts/alpha", {
      name: "alpha",
      ip: "10.0.0.1",
      vpn_host: "alpha.ts.net",
      ssh_prefer_vpn: false,
      wake_on_connect: false, // D2-B — carried, so a VPN fill can't clear an owner's flag
      wake_on_presence: false, // D2-A/D50 — carried for the same reason
      wake_presence_cooldown_s: null,
      mac: "aa:bb:cc:dd:ee:ff",
      ssh_username: "gamer",
      ssh_password: "",
      ssh_port: 2222,
      os_type: "windows",
      role: "rig",
      tags: [],
      services: [
        { name: "sunshine", kind: null, port: 47990, path: "", autostart: false, cmd: {} },
      ],
    });

    // Inline lines: filled / already set (case-only) / differs:<proposed> / no match.
    await screen.findByText("filled");
    expect(screen.getByText("already set")).toBeTruthy();
    expect(screen.getByText("differs: new.ts.net")).toBeTruthy();
    expect(screen.getByText("no match")).toBeTruthy();
  });

  it("one summary toast, once, with the counts", async () => {
    const hosts = [mkHost({ id: "alpha", name: "alpha", ip: "10.0.0.1" })];
    mockGets(
      {
        ok: true,
        results: [
          { id: "alpha", name: "alpha", current: null, proposed: "alpha.ts.net", online: true },
        ],
        unmatched: ["delta"],
      },
      hosts,
    );
    renderWithClient(<MachineEditor hosts={hosts} />);

    clickDiscover();

    await waitFor(() => expect(toast.pushToast).toHaveBeenCalledTimes(1));
    expect(toast.pushToast).toHaveBeenCalledWith("VPN discovery: 1 filled · 1 no match", "ok");
  });

  it("skips the host whose editor row is open (no PUT, skip note shown)", async () => {
    const hosts = [mkHost({ id: "alpha", name: "alpha", ip: "10.0.0.1" })];
    mockGets(
      {
        ok: true,
        results: [
          { id: "alpha", name: "alpha", current: null, proposed: "alpha.ts.net", online: true },
        ],
        unmatched: [],
      },
      hosts,
    );
    renderWithClient(<MachineEditor hosts={hosts} />);

    fireEvent.click(screen.getByText("alpha")); // open the row → its draft is seeded at mount
    clickDiscover();

    expect(await screen.findByText("skipped — editor open")).toBeTruthy();
    expect(api.putJSON).not.toHaveBeenCalled();
  });

  it("a rejected PUT downgrades that host's line to fill failed; the batch survives and toasts err", async () => {
    const hosts = [
      mkHost({ id: "alpha", name: "alpha", ip: "10.0.0.1" }),
      mkHost({ id: "beta", name: "beta", ip: "10.0.0.2" }),
    ];
    mockGets(
      {
        ok: true,
        results: [
          { id: "alpha", name: "alpha", current: null, proposed: "alpha.ts.net", online: true },
          { id: "beta", name: "beta", current: null, proposed: "beta.ts.net", online: true },
        ],
        unmatched: [],
      },
      hosts,
    );
    api.putJSON.mockImplementation((url: string) =>
      url === "/api/hosts/beta" ? Promise.reject(new Error("boom")) : Promise.resolve({}),
    );
    renderWithClient(<MachineEditor hosts={hosts} />);

    clickDiscover();

    // alpha's fill lands, beta's failure stays per-host — the batch itself never rejects.
    expect(await screen.findByText("fill failed")).toBeTruthy();
    expect(screen.getByText("filled")).toBeTruthy();
    await waitFor(() => expect(toast.pushToast).toHaveBeenCalledTimes(1));
    expect(toast.pushToast).toHaveBeenCalledWith("VPN discovery: 1 filled · 1 failed", "err");
  });

  it("a result host missing from the FRESH host list gets NO PUT (never a guessed body)", async () => {
    mockGets(
      {
        ok: true,
        results: [
          { id: "ghost", name: "ghost", current: null, proposed: "ghost.ts.net", online: true },
        ],
        unmatched: [],
      },
      [mkHost({ id: "alpha", name: "alpha", ip: "10.0.0.1" })], // fresh list has no "ghost"
    );
    renderWithClient(
      <MachineEditor hosts={[mkHost({ id: "alpha", name: "alpha", ip: "10.0.0.1" })]} />,
    );

    clickDiscover();

    expect(await screen.findByText("fill failed")).toBeTruthy();
    expect(api.putJSON).not.toHaveBeenCalled();
  });

  it("eligibility comes from the FRESH DTO: a value set after discovery is never overwritten", async () => {
    // Discovery saw an empty current, but by the fresh hosts fetch the value exists → NO PUT.
    mockGets(
      {
        ok: true,
        results: [
          { id: "alpha", name: "alpha", current: null, proposed: "alpha.ts.net", online: true },
        ],
        unmatched: [],
      },
      [mkHost({ id: "alpha", name: "alpha", ip: "10.0.0.1", vpn_host: "hand-set.ts.net" })],
    );
    renderWithClient(
      <MachineEditor hosts={[mkHost({ id: "alpha", name: "alpha", ip: "10.0.0.1" })]} />,
    );

    clickDiscover();

    expect(await screen.findByText("differs: alpha.ts.net")).toBeTruthy();
    expect(api.putJSON).not.toHaveBeenCalled();
  });

  it("renders the endpoint reason on ok:false and applies nothing", async () => {
    mockGets({ ok: false, reason: "tailscale daemon not running" }, []);
    renderWithClient(<MachineEditor hosts={[mkHost({ id: "alpha", name: "alpha" })]} />);

    clickDiscover();

    expect(await screen.findByText("tailscale daemon not running")).toBeTruthy();
    expect(api.putJSON).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.pushToast).toHaveBeenCalledTimes(1));
    expect(toast.pushToast).toHaveBeenCalledWith(
      "VPN discovery: tailscale daemon not running",
      "err",
    );
  });
});
