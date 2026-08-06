import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Both queries are spied on rather than run: the claims here are about WHICH list a source reads, what it
// turns it into, and — the load-bearing one — that the other source's query is never enabled.
const queries = vi.hoisted(() => ({
  useServices: vi.fn((): { data: unknown; isError: boolean } => ({
    data: undefined,
    isError: false,
  })),
  useHosts: vi.fn((): { data: unknown; isError: boolean } => ({ data: undefined, isError: false })),
}));
vi.mock("../../src/hooks/useServices", () => ({ useServices: queries.useServices }));
vi.mock("../../src/hooks/useFleet", () => ({ useHosts: queries.useHosts }));

import { useMediaKeySource } from "../../src/theme-engine/mediaKeySources";

// The DERIVED-KEY sources (the Kit Art System / Codex A1). M3 shipped one dynamic source and the gallery
// was shaped around it — a service-specific hook, model and copy. With `hosts` as the second, the gallery
// reads ONE shape and this module is where a source's differences live. What must hold:
//
//  · each source turns ITS live list into `{key,label}` pairs through the identity rule that source owns
//    (a service prefers `kind`; a machine is its name) — the same rules the RENDER side resolves through;
//  · a role with no `keySource` gets `null` and enables nothing;
//  · the source that is not asked for is not fetched, so one gallery panel never pays for the other's list;
//  · the three states are distinguishable (list / still loading / never coming), and each carries the
//    words for THAT list — never "service" wording on a machine panel.

const call = (source: undefined | "services" | "hosts") =>
  renderHook(() => useMediaKeySource(source)).result.current;

/** The `enabled` flag each query was asked for on the last render. */
const enabled = () => ({
  services: (queries.useServices.mock.calls.at(-1) as unknown as [unknown, { enabled: boolean }])[1]
    .enabled,
  hosts: (
    queries.useHosts.mock.calls.at(-1) as unknown as [unknown, unknown, { enabled: boolean }]
  )[2].enabled,
});

describe("useMediaKeySource", () => {
  it("a role with no keySource gets null — and neither list is fetched", () => {
    expect(call(undefined)).toBeNull();
    expect(enabled()).toEqual({ services: false, hosts: false });
  });

  it("services: keys are `kind` else `name`, labels are the display name, in fleet order", () => {
    queries.useServices.mockReturnValueOnce({
      data: [
        { name: "Media", kind: "Jellyfin" },
        { name: "Grafana", kind: null },
      ],
      isError: false,
    });
    expect(call("services")?.consumers).toEqual([
      { key: "jellyfin", label: "Media" },
      { key: "grafana", label: "Grafana" },
    ]);
    // …and the machines are not fetched for a services panel.
    expect(enabled()).toEqual({ services: true, hosts: false });
  });

  it("hosts: the key is the machine NAME — never its slug id, which rekeys on rename", () => {
    queries.useHosts.mockReturnValueOnce({
      data: [
        { id: "corsair", name: "Corsair" },
        { id: "vault", name: "vault" },
      ],
      isError: false,
    });
    expect(call("hosts")?.consumers).toEqual([
      { key: "corsair", label: "Corsair" },
      { key: "vault", label: "vault" },
    ]);
    expect(enabled()).toEqual({ services: false, hosts: true });
  });

  it("neither source DRIVES a poll — the gallery wants identities, not liveness", () => {
    call("hosts");
    const pollOf = (calls: { mock: { calls: unknown[][] } }) => calls.mock.calls.at(-1)?.[0];
    expect(pollOf(queries.useServices)).toBe(false);
    expect(pollOf(queries.useHosts)).toBe(false);
  });

  it("still loading vs never arriving are DIFFERENT states, each in the source's own words", () => {
    // Loading: no list yet, no error.
    expect(call("hosts")).toMatchObject({ consumers: undefined, failed: false });

    // Terminal: no list, and it is not coming.
    queries.useHosts.mockReturnValueOnce({ data: undefined, isError: true });
    const failed = call("hosts")!;
    expect(failed.failed).toBe(true);
    expect(failed.def.failed).toContain("machine");
    expect(failed.def.loading).toContain("machines");
    expect(failed.def.none).toContain("machines");
    // The wording is per SOURCE, so a machine panel can never say "service".
    expect(JSON.stringify(failed.def)).not.toContain("service");
  });

  it("a cached list with a failed REFETCH is not a failure — the annotations are still answerable", () => {
    queries.useServices.mockReturnValueOnce({ data: [{ name: "plex" }], isError: true });
    const out = call("services")!;
    expect(out.failed).toBe(false);
    expect(out.consumers).toEqual([{ key: "plex", label: "plex" }]);
  });
});
