import { QueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The POLICY arms below read what the hook ASKS FOR, so the wire hook is spied on rather than run: the
// claim is about the options (Opus M3's distinct policy), not about TanStack honouring them.
const wire = vi.hoisted(() => ({
  useMediaIndex: vi.fn(() => ({
    data: undefined as MediaIndex | undefined,
    error: null as Error | null,
  })),
}));
vi.mock("../../src/hooks/useMedia", () => wire);

// …and a COUNTER around the one operation the hooks' memo exists to stop re-running: `stemIndex`, the pass
// that turns a role folder into its stem→file binding. The real implementation is kept (`importOriginal`),
// so every other arm in this file behaves exactly as it would unmocked — this only makes "how many times
// did we actually scan the role" observable.
const scans = vi.hoisted(() => ({ n: 0 }));
vi.mock("../../src/lib/media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/media")>();
  return {
    ...actual,
    stemIndex: <T extends { name: string; unusable?: boolean }>(files: readonly T[]) => {
      scans.n += 1;
      return actual.stemIndex(files);
    },
  };
});

import type { MediaFile, MediaIndex } from "../../src/hooks/useMedia";
import {
  backgroundArtFrom,
  brandArtFrom,
  hostArtFrom,
  hostArtProps,
  KIT_NS,
  ownerArtUrl,
  serviceBannerFrom,
  serviceBannerProps,
  serviceIconFrom,
  useHostArt,
  useKitBackgroundArt,
  useKitBrandArt,
  useServiceIcons,
} from "../../src/theme-engine/kit/ownerArt";

// The kit namespace's PURE half (D53 M3 + the Kit Art System / MEDIA_PLAN §5) — an identity ↔ the owner's
// file, for all four roles. Split out of the hooks exactly like `frontierArtFromIndex`, so every contested
// case is an ordinary unit test:
//
//  · the binding itself (kind over name for a service, the NAME for a machine, casefolded stem,
//    unusable never binds) — one rule, reused, so the four roles cannot diverge;
//  · the pool + pin ladder on the shared background (a dangling pin falls THROUGH, never blanks);
//  · the PARENT-prop primitives: props when there is art, NOTHING when there is not, which is what makes
//    dormancy a property of absence rather than of a conditional in five surfaces.
//
// (The gallery's side — the derived KEY rows — is source-agnostic now and lives in tests/lib/media.test.ts
// (`deriveKeyBindings`) plus tests/theme-engine/mediaKeySources.test.ts (which list, and its wording).)

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

const index = (roles: Partial<Record<string, MediaFile[]>>, slots: Record<string, string> = {}) =>
  ({
    ns: "kit",
    collation: "library-v1",
    roles,
    slots,
  }) as MediaIndex;

describe("serviceIconFrom — one service's icon", () => {
  it("binds a file whose STEM matches the service's kind, whatever the case", () => {
    const jelly = file("Jellyfin");
    expect(serviceIconFrom(index({ services: [jelly] }), { name: "media", kind: "jellyfin" })).toBe(
      jelly,
    );
  });

  it("falls to the NAME when the service declares no kind", () => {
    const grafana = file("grafana");
    expect(serviceIconFrom(index({ services: [grafana] }), { name: "Grafana", kind: null })).toBe(
      grafana,
    );
    expect(serviceIconFrom(index({ services: [grafana] }), { name: "Grafana", kind: "" })).toBe(
      grafana,
    );
  });

  it("is undefined when nothing is named for it — the ordinary case, and NOT a defect", () => {
    // No bundled fallback exists for this namespace (§3): the row simply renders as it does today.
    expect(
      serviceIconFrom(index({ services: [file("plex")] }), { name: "jellyfin" }),
    ).toBeUndefined();
  });

  it("an UNUSABLE file never binds — a broken drop leaves the row icon-less, not icon-torn", () => {
    const broken = file("plex", { unusable: true, unusable_reason: "format-mismatch" });
    expect(serviceIconFrom(index({ services: [broken] }), { name: "plex" })).toBeUndefined();
  });

  it("degrades to no icon on a missing, empty or malformed payload (it is on a render path)", () => {
    expect(serviceIconFrom(undefined, { name: "plex" })).toBeUndefined();
    expect(serviceIconFrom({ roles: {} } as MediaIndex, { name: "plex" })).toBeUndefined();
    expect(
      serviceIconFrom({ roles: { services: "nope" } } as unknown as MediaIndex, { name: "plex" }),
    ).toBeUndefined();
  });

  it("a service whose key cannot be a filename never binds (there is no such stem to list)", () => {
    expect(
      serviceIconFrom(index({ services: [file("plex")] }), { name: "media/plex" }),
    ).toBeUndefined();
  });
});

describe("serviceBannerFrom — the SAME identity, a different folder", () => {
  it("binds by the service's `keyFor` identity, out of the banner role", () => {
    const banner = file("jellyfin");
    const idx = index({ services: [file("plex")], "service-banners": [banner] });
    expect(serviceBannerFrom(idx, { name: "Media", kind: "Jellyfin" })).toBe(banner);
  });

  it("reads ONLY its own role — an icon is never dealt as a banner, and vice versa", () => {
    // The two roles share a key on purpose (one name to remember), which is exactly why the FOLDER has
    // to be the whole of the assignment: dropping `jellyfin.png` into `services/` must not paint a
    // 20px icon across the row.
    const icon = file("jellyfin");
    const idx = index({ services: [icon], "service-banners": [] });
    expect(serviceBannerFrom(idx, { name: "media", kind: "jellyfin" })).toBeUndefined();
    expect(serviceIconFrom(idx, { name: "media", kind: "jellyfin" })).toBe(icon);
  });

  it("an unusable banner leaves the surface on whatever it already painted", () => {
    const broken = file("jellyfin", { unusable: true, unusable_reason: "unreadable" });
    expect(
      serviceBannerFrom(index({ "service-banners": [broken] }), { name: "jellyfin" }),
    ).toBeUndefined();
  });
});

describe("hostArtFrom — one machine's picture", () => {
  it("binds by the machine's NAME, casefolded", () => {
    const pic = file("Corsair");
    expect(hostArtFrom(index({ hosts: [pic] }), { name: "corsair" })).toBe(pic);
  });

  it("a RENAMED machine resolves to nothing until the file is renamed too (the A7 accepted cost)", () => {
    // The old file is not lost and not silently reused: it lists as unmatched in the gallery, and the
    // remedy is one rename. Removing the machine and later restoring the name reattaches it.
    const pic = file("corsair");
    expect(hostArtFrom(index({ hosts: [pic] }), { name: "corsair-2" })).toBeUndefined();
    expect(hostArtFrom(index({ hosts: [pic] }), { name: "CORSAIR" })).toBe(pic); // case-only: still bound
  });

  it("is undefined for an empty folder or an unreachable index — the sheet renders as it does today", () => {
    expect(hostArtFrom(index({ hosts: [] }), { name: "corsair" })).toBeUndefined();
    expect(hostArtFrom(undefined, { name: "corsair" })).toBeUndefined();
  });
});

describe("backgroundArtFrom — the shared background's pool + pin ladder", () => {
  it("takes the folder's FIRST usable file when nothing is pinned", () => {
    const first = file("a");
    expect(backgroundArtFrom(index({ background: [first, file("b")] }))).toBe(first);
  });

  it("a PIN overrides the first-wins pick, by stem", () => {
    const b = file("b");
    expect(backgroundArtFrom(index({ background: [file("a"), b] }, { background: "b" }))).toBe(b);
  });

  it("a DANGLING pin falls through to the first usable file — never a blank layer", () => {
    const a = file("a");
    expect(backgroundArtFrom(index({ background: [a] }, { background: "deleted" }))).toBe(a);
  });

  it("skips an unusable file, and is undefined for an empty folder (no layer at all)", () => {
    const good = file("b");
    expect(backgroundArtFrom(index({ background: [file("a", { unusable: true }), good] }))).toBe(
      good,
    );
    expect(backgroundArtFrom(index({ background: [] }))).toBeUndefined();
    expect(backgroundArtFrom(undefined)).toBeUndefined();
  });
});

describe("brandArtFrom — the app bar's mark, on the SAME pool + pin ladder (G6.3)", () => {
  // Deliberately the background's shape, rung for rung: a second pool role must not invent a second
  // resolution rule, or "first wins unless you pin one" would mean two things in one namespace.
  it("takes the folder's first usable file, and a PIN overrides it by stem", () => {
    const first = file("a");
    expect(brandArtFrom(index({ brand: [first, file("b")] }))).toBe(first);
    const b = file("b");
    expect(brandArtFrom(index({ brand: [file("a"), b] }, { brand: "b" }))).toBe(b);
  });

  it("a DANGLING pin falls through, an UNUSABLE file is skipped — never a broken mark", () => {
    const a = file("a");
    expect(brandArtFrom(index({ brand: [a] }, { brand: "deleted" }))).toBe(a);
    const good = file("b");
    expect(brandArtFrom(index({ brand: [file("a", { unusable: true }), good] }))).toBe(good);
  });

  it("reads ONLY its own folder, and is undefined when empty — the bar keeps its old mark", () => {
    // The empty answer is the ordinary one, and it is what makes the whole role dormant by absence:
    // no file ⇒ the theme's `brandMark` ⇒ the kit dot, exactly as before this slice.
    expect(brandArtFrom(index({ background: [file("a")], brand: [] }))).toBeUndefined();
    expect(brandArtFrom(index({}))).toBeUndefined();
    expect(brandArtFrom(undefined)).toBeUndefined();
  });

  it("is INDEPENDENT of the background — two pools, two pins, no leakage either way", () => {
    const bg = file("wall");
    const mark = file("logo");
    const idx = index({ background: [bg], brand: [mark] }, { background: "wall", brand: "logo" });
    expect(backgroundArtFrom(idx)).toBe(bg);
    expect(brandArtFrom(idx)).toBe(mark);
  });
});

describe("ownerArtUrl — the `?rev=` every owner-art consumer paints from (Codex LOW)", () => {
  it("stamps the file's revision onto the mount URL, encoded", () => {
    // `mtime_ns:size` carries a colon, which is legal in a query value but is encoded anyway: one rule,
    // and nothing downstream has to reason about which characters a revision may hold.
    expect(ownerArtUrl(file("plex"))).toBe(
      "/api/media/kit/files/services/plex.png?rev=1%3A4000%3Aplex",
    );
  });

  it("leaves the PATH untouched — the SW's media route matches on it, so a poll still hits", () => {
    const url = ownerArtUrl(file("plex"))!;
    expect(new URL(url, "http://x").pathname).toBe("/api/media/kit/files/services/plex.png");
  });

  it("MOVES exactly when the bytes move, and not otherwise", () => {
    expect(ownerArtUrl(file("plex"))).toBe(ownerArtUrl(file("plex"))); // a poll re-fetching the index
    expect(ownerArtUrl(file("plex", { revision: "2:5000" }))).not.toBe(ownerArtUrl(file("plex")));
  });

  it("no file ⇒ nothing to paint; no revision ⇒ the bare URL", () => {
    expect(ownerArtUrl(undefined)).toBeUndefined();
    // The server writes an empty revision only when it could not stat the file — which also makes it
    // unusable, so this never reaches a surface; a `?rev=` naming nothing would be noise either way.
    expect(ownerArtUrl(file("plex", { revision: "" }))).toBe(
      "/api/media/kit/files/services/plex.png",
    );
  });
});

describe("the hooks RESOLVE once per identity, per index (Codex LOW)", () => {
  // The callback is called per subject per render — cosmos's sheet asks for a banner on every service row
  // of every poll render — and each ask used to re-scan the whole role. These arms pin the memo: the
  // answer cannot change while the index is the same object, so it is computed once and looked up after.
  const seed = (data: MediaIndex | undefined) => {
    wire.useMediaIndex.mockImplementation(() => ({ data, error: null }));
  };
  afterEach(() => {
    wire.useMediaIndex.mockImplementation(() => ({ data: undefined, error: null }));
  });

  it("many identities, and a re-render, cost ONE scan of the role", () => {
    seed(index({ services: [file("plex")] }));
    scans.n = 0;
    const { result, rerender } = renderHook(() => useServiceIcons());

    expect(result.current({ name: "plex" })?.name).toBe("plex");
    result.current({ name: "plex" });
    result.current({ name: "PLEX", kind: null }); // the SAME normalized key, so the same question
    // …and an un-iconed service is answered from the same map: "the owner dropped nothing for this one"
    // is the ORDINARY answer, and it must not cost a scan either.
    expect(result.current({ name: "grafana" })).toBeUndefined();
    rerender();
    result.current({ name: "plex" });
    expect(scans.n).toBe(1);
  });

  it("a NEW index answers freshly — the cache lives and dies with the object it was built for", () => {
    seed(index({ hosts: [file("alpha")] }));
    const { result, rerender } = renderHook(() => useHostArt());
    expect(result.current({ name: "alpha" })?.name).toBe("alpha");

    seed(index({ hosts: [] })); // the owner deleted the file; the query re-fetched
    rerender();
    expect(result.current({ name: "alpha" })).toBeUndefined();
  });
});

describe("the PARENT-surface primitives (Codex A2)", () => {
  it("return a class + ONE custom property, so the adopter spreads them onto its own element", () => {
    const banner = serviceBannerProps("/api/media/kit/files/service-banners/a%20b.png");
    expect(banner).toEqual({
      className: "kit-svc-banner",
      style: { "--kit-banner-img": 'url("/api/media/kit/files/service-banners/a%20b.png")' },
    });
    const host = hostArtProps("/api/media/kit/files/hosts/vault.png");
    expect(host).toEqual({
      className: "kit-host-art",
      style: { "--kit-host-img": 'url("/api/media/kit/files/hosts/vault.png")' },
    });
  });

  it("use DISTINCT variables — custom properties inherit, and a sheet is an ANCESTOR of its rows", () => {
    // A host picture on the sheet and a banner on each row would otherwise share one name: a row with no
    // banner of its own would inherit the machine's picture and paint it as a strip.
    const banner = serviceBannerProps("/x.png")!;
    const host = hostArtProps("/y.png")!;
    expect(Object.keys(banner.style)).not.toEqual(Object.keys(host.style));
  });

  it("return NOTHING when there is no art — dormancy by ABSENCE, not by a conditional per surface", () => {
    // No class ⇒ no rule matches ⇒ the surface is byte-identical to the one that shipped before.
    expect(serviceBannerProps(undefined)).toBeUndefined();
    expect(serviceBannerProps("")).toBeUndefined();
    expect(hostArtProps(undefined)).toBeUndefined();
  });
});

describe("the kit index's OWN query policy (Opus M3)", () => {
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

  it("every role reads that ONE query, so five surfaces cost one request", () => {
    for (const hook of [useKitBackgroundArt, useKitBrandArt]) {
      wire.useMediaIndex.mockClear();
      renderHook(() => hook());
      const [ns, opts] = wire.useMediaIndex.mock.calls.at(-1) as unknown as [
        string,
        { refetchOnWindowFocus: boolean },
      ];
      expect(ns).toBe(KIT_NS);
      expect(opts.refetchOnWindowFocus).toBe(false); // the same policy object, not a second one
    }
  });

  it("degrades SILENTLY: an unreachable index resolves to no art, never to an error branch", () => {
    wire.useMediaIndex.mockReturnValueOnce({ data: undefined, error: new Error("offline") });
    const { result } = renderHook(() => useServiceIcons());
    expect(result.current({ name: "plex" })).toBeUndefined();
  });

  it("shares the gallery's key FAMILY, so a gallery save invalidates the art too", () => {
    // `useSaveSettings` invalidates the `["media"]` PREFIX — this is the arm that says the kit query is
    // inside it, i.e. that a reorder/drop seen in Conf reaches the rows without a reload.
    const qc = new QueryClient();
    qc.setQueryData(["media", KIT_NS], { ns: KIT_NS });
    void qc.invalidateQueries({ queryKey: ["media"] });
    expect(qc.getQueryState(["media", KIT_NS])?.isInvalidated).toBe(true);
  });
});
