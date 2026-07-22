import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MachineEditor } from "../../src/components/MachineEditor";
import type { Host } from "../../src/types";

// MachineEditor — D3 slice 3: the "Discover from Tailscale" button + inline per-host results. Unlike
// the slice-2 test (which mocks useHostMutations wholesale), the apply logic lives INSIDE the real
// useDiscoverVpn hook, so to observe the PUTs we mock the layer BELOW it — the api/client fetch
// helpers + the toast store — and drive the REAL hook through a real QueryClient. create/update/remove
// stay real but unused. Covers: empty-current hosts get a PUT {name,ip,vpn_host}; a differing current
// gets NO PUT and shows `differs`; the open-editor row is skipped; unmatched → no match; ok:false
// renders the reason; the summary toast fires exactly once.

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
    ...over,
  };
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
  it("PUTs {name,ip,vpn_host} ONLY for empty-current hosts; differing/set are left alone", async () => {
    api.getJSON.mockResolvedValue({
      ok: true,
      results: [
        { id: "alpha", name: "alpha", current: null, proposed: "alpha.ts.net", online: true },
        { id: "beta", name: "beta", current: "beta.ts.net", proposed: "beta.ts.net", online: true },
        {
          id: "gamma",
          name: "gamma",
          current: "old.ts.net",
          proposed: "new.ts.net",
          online: false,
        },
      ],
      unmatched: ["delta"],
    });
    renderWithClient(
      <MachineEditor
        hosts={[
          mkHost({ id: "alpha", name: "alpha", ip: "10.0.0.1", vpn_host: null }),
          mkHost({ id: "beta", name: "beta", ip: "10.0.0.2", vpn_host: "beta.ts.net" }),
          mkHost({ id: "gamma", name: "gamma", ip: "10.0.0.3", vpn_host: "old.ts.net" }),
        ]}
      />,
    );

    clickDiscover();

    // Exactly one apply, for the empty-current host, with the minimal name+ip+vpn_host body.
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    expect(api.putJSON).toHaveBeenCalledWith("/api/hosts/alpha", {
      name: "alpha",
      ip: "10.0.0.1",
      vpn_host: "alpha.ts.net",
    });

    // Inline lines: filled / already set / differs:<proposed> / no match.
    await screen.findByText("filled");
    expect(screen.getByText("already set")).toBeTruthy();
    expect(screen.getByText("differs: new.ts.net")).toBeTruthy();
    expect(screen.getByText("no match")).toBeTruthy();
  });

  it("one summary toast, once, with the counts", async () => {
    api.getJSON.mockResolvedValue({
      ok: true,
      results: [
        { id: "alpha", name: "alpha", current: null, proposed: "alpha.ts.net", online: true },
      ],
      unmatched: ["delta"],
    });
    renderWithClient(
      <MachineEditor hosts={[mkHost({ id: "alpha", name: "alpha", ip: "10.0.0.1" })]} />,
    );

    clickDiscover();

    await waitFor(() => expect(toast.pushToast).toHaveBeenCalledTimes(1));
    expect(toast.pushToast).toHaveBeenCalledWith("VPN discovery: 1 filled · 1 no match", "ok");
  });

  it("skips the host whose editor row is open (no PUT, skip note shown)", async () => {
    api.getJSON.mockResolvedValue({
      ok: true,
      results: [
        { id: "alpha", name: "alpha", current: null, proposed: "alpha.ts.net", online: true },
      ],
      unmatched: [],
    });
    renderWithClient(
      <MachineEditor hosts={[mkHost({ id: "alpha", name: "alpha", ip: "10.0.0.1" })]} />,
    );

    fireEvent.click(screen.getByText("alpha")); // open the row → its draft is seeded at mount
    clickDiscover();

    expect(await screen.findByText("skipped — editor open")).toBeTruthy();
    expect(api.putJSON).not.toHaveBeenCalled();
  });

  it("a rejected PUT downgrades that host's line to fill failed; the batch survives and toasts err", async () => {
    api.getJSON.mockResolvedValue({
      ok: true,
      results: [
        { id: "alpha", name: "alpha", current: null, proposed: "alpha.ts.net", online: true },
        { id: "beta", name: "beta", current: null, proposed: "beta.ts.net", online: true },
      ],
      unmatched: [],
    });
    api.putJSON.mockImplementation((url: string) =>
      url === "/api/hosts/beta" ? Promise.reject(new Error("boom")) : Promise.resolve({}),
    );
    renderWithClient(
      <MachineEditor
        hosts={[
          mkHost({ id: "alpha", name: "alpha", ip: "10.0.0.1" }),
          mkHost({ id: "beta", name: "beta", ip: "10.0.0.2" }),
        ]}
      />,
    );

    clickDiscover();

    // alpha's fill lands, beta's failure stays per-host — the batch itself never rejects.
    expect(await screen.findByText("fill failed")).toBeTruthy();
    expect(screen.getByText("filled")).toBeTruthy();
    await waitFor(() => expect(toast.pushToast).toHaveBeenCalledTimes(1));
    expect(toast.pushToast).toHaveBeenCalledWith("VPN discovery: 1 filled · 1 failed", "err");
  });

  it("a result host missing from the hosts prop gets NO PUT (never a guessed body)", async () => {
    api.getJSON.mockResolvedValue({
      ok: true,
      results: [
        { id: "ghost", name: "ghost", current: null, proposed: "ghost.ts.net", online: true },
      ],
      unmatched: [],
    });
    renderWithClient(
      <MachineEditor hosts={[mkHost({ id: "alpha", name: "alpha", ip: "10.0.0.1" })]} />,
    );

    clickDiscover();

    expect(await screen.findByText("fill failed")).toBeTruthy();
    expect(api.putJSON).not.toHaveBeenCalled();
  });

  it("renders the endpoint reason on ok:false and applies nothing", async () => {
    api.getJSON.mockResolvedValue({ ok: false, reason: "tailscale daemon not running" });
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
