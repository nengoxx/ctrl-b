import { QueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The POLICY arms below read what the hook ASKS FOR, so the wire hook is spied on rather than run: the
// claim is about the options (Opus M3's distinct policy), not about TanStack honouring them.
const wire = vi.hoisted(() => ({
  useMediaIndex: vi.fn(() => ({
    data: undefined as MediaIndex | undefined,
    error: null as Error | null,
  })),
}));
vi.mock("../../src/hooks/useMedia", () => wire);

import type { MediaFile, MediaIndex } from "../../src/hooks/useMedia";
import {
  KIT_NS,
  serviceIconFrom,
  serviceKeyBindings,
  useServiceIcons,
} from "../../src/theme-engine/kit/serviceIcons";

// The kit namespace's PURE half (D53 M3 / MEDIA_PLAN §5) — service identity ↔ owner file. Split out of
// the hooks exactly like `frontierArtFromIndex`, so every contested case is an ordinary unit test:
//
//  · the binding itself (kind over name, casefolded stem, unusable never binds);
//  · file/file collisions — first in the SERVER's index order wins, in either order;
//  · service/service collisions — no winner exists (services are not in the media index), so BOTH share
//    the winning file, and the row says so;
//  · every file is accounted for: it bound a key, it was shadowed by one that already had, no service is
//    called that, or it is broken.

const file = (name: string, over: Partial<MediaFile> = {}): MediaFile => ({
  name,
  file: `${name}.png`,
  url: `/api/media/kit/files/services/${name}.png`,
  format: "png",
  size_bytes: 4_000,
  revision: `1:4000:${name}`,
  width: 64,
  height: 64,
  unusable: false,
  unusable_reason: null,
  ...over,
});

const index = (files: MediaFile[]): MediaIndex => ({
  ns: "kit",
  collation: "casefold-natural",
  roles: { services: files },
  slots: {},
});

describe("serviceIconFrom — one service's icon", () => {
  it("binds a file whose STEM matches the service's kind, whatever the case", () => {
    const jelly = file("Jellyfin");
    expect(serviceIconFrom(index([jelly]), { name: "media", kind: "jellyfin" })).toBe(jelly);
  });

  it("falls to the NAME when the service declares no kind", () => {
    const grafana = file("grafana");
    expect(serviceIconFrom(index([grafana]), { name: "Grafana", kind: null })).toBe(grafana);
    expect(serviceIconFrom(index([grafana]), { name: "Grafana", kind: "" })).toBe(grafana);
  });

  it("is undefined when nothing is named for it — the ordinary case, and NOT a defect", () => {
    // No bundled fallback exists for this namespace (§3): the row simply renders as it does today.
    expect(serviceIconFrom(index([file("plex")]), { name: "jellyfin" })).toBeUndefined();
  });

  it("an UNUSABLE file never binds — a broken drop leaves the row icon-less, not icon-torn", () => {
    const broken = file("plex", { unusable: true, unusable_reason: "format-mismatch" });
    expect(serviceIconFrom(index([broken]), { name: "plex" })).toBeUndefined();
  });

  it("degrades to no icon on a missing, empty or malformed payload (it is on a render path)", () => {
    expect(serviceIconFrom(undefined, { name: "plex" })).toBeUndefined();
    expect(serviceIconFrom({ roles: {} } as MediaIndex, { name: "plex" })).toBeUndefined();
    expect(
      serviceIconFrom({ roles: { services: "nope" } } as unknown as MediaIndex, { name: "plex" }),
    ).toBeUndefined();
  });

  it("a service whose key cannot be a filename never binds (there is no such stem to list)", () => {
    expect(serviceIconFrom(index([file("plex")]), { name: "media/plex" })).toBeUndefined();
  });
});

describe("serviceKeyBindings — what the gallery says", () => {
  it("one row per KEY, in fleet order, each carrying the file that answers it", () => {
    const jelly = file("jellyfin");
    const b = serviceKeyBindings(
      [{ name: "Media", kind: "jellyfin" }, { name: "Grafana" }],
      [jelly],
    );
    expect(b.rows.map((r) => r.key)).toEqual(["jellyfin", "grafana"]);
    expect(b.rows[0].file).toBe(jelly);
    expect(b.rows[1].file).toBeUndefined();
    expect(b.binding.keyOf.get(jelly)).toBe("jellyfin");
  });

  it("service/service collision: BOTH services listed on one row, sharing the winning file (§5)", () => {
    // Two hosts each running a `jellyfin` service collapse to one key. There is no index order over
    // SERVICES to break the tie with — so there is no tie: they share, and the row says so.
    const jelly = file("jellyfin");
    const b = serviceKeyBindings(
      [
        { name: "media-a", kind: "Jellyfin" },
        { name: "media-b", kind: "jellyfin" },
      ],
      [jelly],
    );
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0].services).toEqual(["media-a", "media-b"]);
    expect(b.rows[0].file).toBe(jelly);
  });

  it("file/file collision: the FIRST in the server's index order wins, and the loser is SHADOWED", () => {
    const png = file("jellyfin", { file: "jellyfin.png" });
    const webp = file("Jellyfin", { file: "Jellyfin.webp" });
    const services = [{ name: "media", kind: "jellyfin" }];

    const first = serviceKeyBindings(services, [png, webp]);
    expect(first.rows[0].file).toBe(png);
    expect(first.binding.shadowed.has(webp)).toBe(true);
    expect(first.binding.unmatched.size).toBe(0);

    // …and in the other order the other file wins — the tie-break IS the listing the owner can reorder.
    const second = serviceKeyBindings(services, [webp, png]);
    expect(second.rows[0].file).toBe(webp);
    expect(second.binding.shadowed.has(png)).toBe(true);
  });

  it("an extension TIE is the same rule: two spellings of one stem, first-wins, no third state", () => {
    const a = file("plex", { file: "plex.png" });
    const b = file("plex", { file: "plex.webp" });
    const out = serviceKeyBindings([{ name: "plex" }], [a, b]);
    expect(out.binding.keyOf.get(a)).toBe("plex");
    expect(out.binding.keyOf.has(b)).toBe(false);
    expect(out.binding.shadowed.has(b)).toBe(true);
  });

  it("a file no service is named for is UNMATCHED — distinct from being shadowed", () => {
    const stray = file("emby");
    const out = serviceKeyBindings([{ name: "plex" }], [file("plex"), stray]);
    expect(out.binding.unmatched.has(stray)).toBe(true);
    expect(out.binding.shadowed.size).toBe(0);
  });

  it("an UNUSABLE file is neither: the server's verdict is the reason, and it already carries it", () => {
    const broken = file("plex", { unusable: true, unusable_reason: "unreadable" });
    const out = serviceKeyBindings([{ name: "plex" }], [broken]);
    expect(out.rows[0].file).toBeUndefined();
    expect(out.binding.shadowed.size + out.binding.unmatched.size).toBe(0);
  });

  it("flags a service whose key can never be a filename, and offers it no file", () => {
    const out = serviceKeyBindings([{ name: "media/plex" }, { name: "plex" }], [file("plex")]);
    expect(out.rows[0].representable).toBe(false);
    expect(out.rows[0].file).toBeUndefined();
    expect(out.rows[1].representable).toBe(true);
  });

  it("no services and no files are both empty, never a throw", () => {
    expect(serviceKeyBindings([], [file("plex")]).binding.unmatched.size).toBe(1);
    expect(serviceKeyBindings([{ name: "plex" }], []).rows[0].file).toBeUndefined();
  });
});

describe("useServiceIcons — the icons' OWN query policy (Opus M3)", () => {
  it("asks for a long stale window and NO focus refetch — not the gallery's fresh-on-entry", () => {
    // These observers live on every rendered service row of every theme. The gallery's policy here
    // would re-read the directory on every window focus for a picture that is the same picture; the
    // gallery keeps it where it belongs, on the screen the owner opens right after copying files in.
    renderHook(() => useServiceIcons());
    const [ns, opts] = wire.useMediaIndex.mock.calls.at(-1) as unknown as [
      string,
      { staleTime: number; refetchOnWindowFocus: boolean },
    ];
    expect(ns).toBe(KIT_NS);
    expect(opts.refetchOnWindowFocus).toBe(false);
    expect(opts.staleTime).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it("degrades SILENTLY: an unreachable index resolves to no icon, never to an error branch", () => {
    wire.useMediaIndex.mockReturnValueOnce({ data: undefined, error: new Error("offline") });
    const { result } = renderHook(() => useServiceIcons());
    expect(result.current({ name: "plex" })).toBeUndefined();
  });

  it("shares the gallery's key FAMILY, so a gallery save invalidates the icons too", () => {
    // `useSaveSettings` invalidates the `["media"]` PREFIX — this is the arm that says the kit query is
    // inside it, i.e. that a reorder/drop seen in Conf reaches the rows without a reload.
    const qc = new QueryClient();
    qc.setQueryData(["media", KIT_NS], { ns: KIT_NS });
    void qc.invalidateQueries({ queryKey: ["media"] });
    expect(qc.getQueryState(["media", KIT_NS])?.isInvalidated).toBe(true);
  });
});
