import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaFile, MediaIndex } from "../../src/hooks/useMedia";
import { MEDIA_NS } from "../../src/theme-engine/mediaRegistry";

// The owner-media gallery (D52/G5, GACHA_PLAN §5.4) — the Conf half of the read-only media surface.
//
// The api client is mocked BELOW the hooks (the machineEditorDiscoverVpn precedent), so the real
// `useMediaIndex` + `useSaveSettings` run against a real QueryClient and the assertions are on the WIRE:
// what the gallery reads, and exactly what patch it writes. That is the contract that matters — the
// config shape is what the backend validates and what the index re-reads.
//
// The load-bearing claims:
//  · reordering writes the WHOLE role order (the config field is the order itself, not a diff);
//  · a pin writes `media.<ns>.slots.<key>`, and clearing one writes null — never a stray "";
//  · nothing here can create, rename or delete a file (§5.4 ruled option (b): there is no write API);
//  · the advisories are SHOWN — a file the theme cannot use must be visible as such. Since D53 M1b the
//    gallery DERIVES them: the server's `unusable_reason` for what only it can know (it read the bytes),
//    and the size/dimension ones here, from the file's numbers against the registry row's per-role bounds.
//
// The row under test is the REAL `MEDIA_NS.gacha`, not a local fixture: the parity obligation on the M1b
// lift is that the same files show the same badges as when the server derived them, which is a claim about
// the bounds that actually ship.

const api = vi.hoisted(() => ({
  getJSON: vi.fn(),
  putJSON: vi.fn(),
  postJSON: vi.fn(),
  del: vi.fn(),
}));
vi.mock("../../src/api/client", () => api);
vi.mock("../../src/store/toast", () => ({ pushToast: vi.fn() }));
// `useSaveSettings` refreshes the composer's verb sets on success; both are network calls
// this suite has no business making, and the api client above is already mocked — so this
// only silences the two module-level fetchers.
vi.mock("../../src/lib/composer", () => ({ loadProviders: vi.fn(), loadAgents: vi.fn() }));

import { MediaGallery } from "../../src/components/MediaGallery";

const file = (name: string, role: string, over: Partial<MediaIndex["roles"][string][0]> = {}) => ({
  name,
  file: `${name}.webp`,
  url: `/api/media/gacha/files/${role}/${name}.webp`,
  format: "webp",
  size_bytes: 88_000,
  revision: "1:88000",
  width: 640,
  height: 854,
  unusable: false,
  unusable_reason: null,
  ...over,
});

function index(over: Partial<MediaIndex> = {}): MediaIndex {
  return {
    ns: "gacha",
    collation: "casefold-natural",
    roles: {
      characters: [file("a", "characters"), file("b", "characters"), file("c", "characters")],
      reel: [],
    },
    slots: {},
    ...over,
  };
}

function renderGallery(payload: MediaIndex = index()): ReturnType<typeof render> {
  api.getJSON.mockResolvedValue(payload);
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const ui: ReactElement = (
    <QueryClientProvider client={qc}>
      <MediaGallery ns="gacha" def={MEDIA_NS.gacha} />
    </QueryClientProvider>
  );
  return render(ui);
}

/** The `media.<ns>` block of the single PUT the gallery made. */
function savedBlock(): Record<string, unknown> {
  expect(api.putJSON).toHaveBeenCalledTimes(1);
  const [url, body] = api.putJSON.mock.calls[0] as [string, { media: Record<string, unknown> }];
  expect(url).toBe("/api/settings"); // the ORDINARY write path — no media-specific endpoint exists
  return body.media.gacha as Record<string, unknown>;
}

beforeEach(() => {
  api.getJSON.mockReset();
  api.putJSON.mockReset().mockResolvedValue({
    settings: { notifications: {} },
    restart_required: [],
    warnings: [],
    providers_rev: "r1",
  });
});
afterEach(cleanup);

describe("MediaGallery", () => {
  it("lists each role's files with their metadata, and names the folder to copy into", async () => {
    const { container } = renderGallery();
    await screen.findByText("a.webp");
    expect([...container.querySelectorAll(".mgal-item .name")].map((n) => n.textContent)).toEqual([
      "a.webp",
      "b.webp",
      "c.webp",
    ]);
    expect(container.querySelector(".mgal-item .dim")!.textContent).toBe("640×854 · 88 KB");
    // the thumbnail is the SAME mount url the theme paints from — the gallery cannot flatter a drop
    expect(container.querySelector<HTMLImageElement>(".mgal-thumb")!.getAttribute("src")).toBe(
      "/api/media/gacha/files/characters/a.webp",
    );
    // an empty role says what to do rather than rendering nothing
    expect(screen.getByText(/Copy \.png\/\.jpg\/\.webp files into this folder/)).toBeTruthy();
    expect(screen.getByText("media/gacha/reel/")).toBeTruthy();
  });

  it("shows the registry's per-role hint — including the reel cutout's missing-glow expectation", async () => {
    renderGallery();
    await screen.findByText("a.webp");
    expect(screen.getByText(/The cutout that rides the tab transition/)).toBeTruthy();
  });

  it("derives the four advisories — the server's verdict plus the role's bounds — and marks the bad row", async () => {
    const { container } = renderGallery(
      index({
        roles: {
          characters: [
            file("liar", "characters", {
              unusable: true,
              unusable_reason: "format-mismatch",
              format: "jpeg",
            }),
            file("stub", "characters", {
              unusable: true,
              unusable_reason: "unreadable",
              format: null,
            }),
            // Facts only: 3.6 MB and 12.8 MP, both past the gacha row's full-art bounds.
            file("huge", "characters", { size_bytes: 3_600_000, width: 3000, height: 4257 }),
          ],
        },
      }),
    );
    await screen.findByText("liar.webp");
    // The PROBED format rides the mismatch badge (§5's client-compares-format-to-extension line): the
    // bytes are a jpeg however the name reads, which is the whole of what the owner has to act on.
    expect(screen.getByText("wrong extension (jpeg)")).toBeTruthy();
    expect(screen.getByText("unreadable file")).toBeTruthy();
    expect(screen.getByText("large file")).toBeTruthy();
    expect(screen.getByText("very large image")).toBeTruthy();
    expect(container.querySelectorAll(".mgal-item.bad")).toHaveLength(2);
    // …and the oversize one still shows its real numbers, because it is still usable
    expect([...container.querySelectorAll(".mgal-item .dim")][2].textContent).toBe(
      "3000×4257 · 3.6 MB",
    );
  });

  it("a file inside the role's bounds carries NO badge — the advisory is a ceiling, not a description", async () => {
    const { container } = renderGallery(
      index({
        roles: {
          characters: [
            file("ok", "characters", { size_bytes: 1_500_000, width: 2000, height: 2000 }),
          ],
        },
      }),
    );
    await screen.findByText("ok.webp");
    expect(container.querySelectorAll(".mgal-item .badge")).toHaveLength(0);
  });

  it("moving a file writes the WHOLE role order through PUT /api/settings", async () => {
    renderGallery();
    await screen.findByText("a.webp");
    fireEvent.click(screen.getByRole("button", { name: "Move c.webp up" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalled());
    expect(savedBlock()).toEqual({
      roles: { characters: { order: ["a.webp", "c.webp", "b.webp"] } },
    });
  });

  it("the ends of a role cannot be moved off it", async () => {
    renderGallery();
    await screen.findByText("a.webp");
    expect(screen.getByRole("button", { name: "Move a.webp up" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Move c.webp down" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("blocks a second move while the first is in flight (the next order is read off the screen)", async () => {
    api.putJSON.mockReturnValue(new Promise(() => undefined)); // never resolves — the save stays pending
    renderGallery();
    await screen.findByText("a.webp");
    fireEvent.click(screen.getByRole("button", { name: "Move a.webp down" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Move c.webp up" })).toHaveProperty(
        "disabled",
        true,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Move c.webp up" }));
    expect(api.putJSON).toHaveBeenCalledTimes(1); // the stale-order write never happened
  });

  it("stays blocked until the REFETCHED order is on screen, not merely until the PUT resolves", async () => {
    // Codex F5. The next order is computed from the list on screen, so the window between "PUT
    // resolved" and "index refetched" is the dangerous one: a tap in it computes a full order from the
    // stale list and persists it OVER the move that just landed. `useSaveSettings` awaits the media
    // invalidation, so `isPending` — and the controls — outlive the round trip.
    let releaseRefetch: (v: MediaIndex) => void = () => undefined;
    api.getJSON
      .mockResolvedValueOnce(index())
      .mockImplementationOnce(() => new Promise<MediaIndex>((r) => (releaseRefetch = r)));

    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MediaGallery ns="gacha" def={MEDIA_NS.gacha} />
      </QueryClientProvider>,
    );
    await screen.findByText("a.webp");

    fireEvent.click(screen.getByRole("button", { name: "Move c.webp up" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    // the PUT has RESOLVED and the refetch has not — the moment the fix exists for
    await waitFor(() => expect(api.getJSON).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Move a.webp down" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Move a.webp down" }));
    expect(api.putJSON).toHaveBeenCalledTimes(1); // the stale-order write never happened

    // …and once the authoritative order lands, the next move is computed from THAT.
    const fresh = index({
      roles: {
        characters: [file("a", "characters"), file("c", "characters"), file("b", "characters")],
        reel: [],
      },
    });
    releaseRefetch(fresh);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Move a.webp down" })).toHaveProperty(
        "disabled",
        false,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Move a.webp down" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(2));
    const [, body] = api.putJSON.mock.calls[1] as [string, { media: { gacha: unknown } }];
    expect(body.media.gacha).toEqual({
      roles: { characters: { order: ["c.webp", "a.webp", "b.webp"] } },
    });
  });

  it("re-reads the directory on every entry — files arrive OUT OF BAND, over SSH", async () => {
    // Codex F7: a 60s-stale listing would show the owner art that predates the copy they just finished.
    // The gallery's own observer refetches on mount; the theme's surfaces keep the cheap staleTime.
    api.getJSON.mockResolvedValue(index());
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const ui = (
      <QueryClientProvider client={qc}>
        <MediaGallery ns="gacha" def={MEDIA_NS.gacha} />
      </QueryClientProvider>
    );
    const { unmount } = render(ui);
    await screen.findByText("a.webp");
    expect(api.getJSON).toHaveBeenCalledTimes(1);

    unmount();
    // the owner scp's a new file in while the gallery is not looking
    api.getJSON.mockResolvedValue(
      index({ roles: { characters: [file("zzz", "characters")], reel: [] } }),
    );
    render(ui);
    expect(await screen.findByText("zzz.webp")).toBeTruthy();
    expect(api.getJSON).toHaveBeenCalledTimes(2);
  });

  it("pinning writes the slot; clearing writes NULL, not an empty string", async () => {
    renderGallery();
    await screen.findByText("a.webp");
    const select = screen.getByRole("combobox", { name: /Fleet backdrop/ });
    fireEvent.change(select, { target: { value: "b" } });
    await waitFor(() => expect(api.putJSON).toHaveBeenCalled());
    expect(savedBlock()).toEqual({ slots: { wallpaper: "b" } });

    api.putJSON.mockClear();
    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => expect(api.putJSON).toHaveBeenCalled());
    expect(savedBlock()).toEqual({ slots: { wallpaper: null } });
  });

  it("the figure pin offers CUTOUTS, never the cast (a portrait would sweep as a rectangle)", async () => {
    renderGallery(
      index({
        roles: {
          characters: [file("a", "characters"), file("b", "characters")],
          reel: [file("cut", "reel"), file("cut2", "reel")],
        },
      }),
    );
    await screen.findByText("a.webp");
    const options = [...screen.getByRole("combobox", { name: /Transition figure/ }).children].map(
      (o) => o.textContent,
    );
    expect(options).toEqual(["—", "cut", "cut2"]);
    // the cast is offered for the backdrop, which crops a portrait fine — the two differ on purpose
    const backdrop = [...screen.getByRole("combobox", { name: /Fleet backdrop/ }).children].map(
      (o) => o.textContent,
    );
    expect(backdrop).toEqual(["—", "a", "b"]);
  });

  it("…and falls back to the theme's BUNDLED cutout names while reel/ is empty", async () => {
    renderGallery(index({ roles: { characters: [file("a", "characters")], reel: [] } }));
    await screen.findByText("a.webp");
    const options = [...screen.getByRole("combobox", { name: /Transition figure/ }).children].map(
      (o) => o.textContent,
    );
    expect(options).toEqual(["—", "lyra"]); // useful on a fresh install, not an empty select
  });

  it("EVERY pin falls back to its SOURCE ROLE's bundled ids on a fresh install (D65)", async () => {
    // The ruled fresh-install behaviour, pinned for all four pins rather than only the figure. Since
    // D65 the fallback names come from `roles[slot.from].bundled` — one list, DERIVED from the theme's
    // own ladder module — instead of a hand-typed per-slot copy (`MediaSlotDef.bundled`, retired). The
    // three character-sourced pins therefore offer the bundled CAST, which is exactly what `slotEntry`
    // resolves against while `characters/` is empty: the select cannot offer a name the theme refuses.
    renderGallery(index({ roles: { characters: [], reel: [] } }));
    await screen.findByRole("combobox", { name: /Fleet backdrop/ });
    const cast = ["—", "pegasus", "atlas", "3", "4", "lyra"];
    for (const [label, expected] of [
      [/Fleet backdrop/, cast], // from `characters`
      [/Hero slide/, cast], // from `characters`
      [/Operator backdrop/, cast], // from `characters`
      [/Transition figure/, ["—", "lyra"]], // from `reel` — a CUTOUT, never the cast (Codex F4)
    ] as const) {
      const options = [...screen.getByRole("combobox", { name: label }).children].map(
        (o) => o.textContent,
      );
      expect(options, String(label)).toEqual(expected);
    }
  });

  it("a LEGACY pin naming something the slot no longer offers is shown as missing, not hidden", async () => {
    // The F4 re-rule stopped offering characters for the figure; a config written before it must be
    // visible so the owner can clear it — the theme has already degraded to the default underneath.
    renderGallery(
      index({
        roles: { characters: [file("kira", "characters")], reel: [file("cut", "reel")] },
        slots: { reel_figure: "kira" },
      }),
    );
    await screen.findByText("kira.webp");
    expect(screen.getByRole("option", { name: "kira (missing)" })).toBeTruthy();
  });

  it("a DANGLING pin stays visible so the owner can see the value they need to clear", async () => {
    renderGallery(index({ slots: { wallpaper: "deleted" } }));
    await screen.findByText("a.webp");
    expect(screen.getByRole("combobox", { name: /Fleet backdrop/ })).toHaveProperty(
      "value",
      "deleted",
    );
    expect(screen.getByRole("option", { name: "deleted (missing)" })).toBeTruthy();
  });

  it("offers NO file operation — the surface is read-only by ruling (§5.4)", async () => {
    const { container } = renderGallery();
    await screen.findByText("a.webp");
    const labels = [...container.querySelectorAll("button")].map((b) =>
      (b.getAttribute("aria-label") ?? b.textContent ?? "").toLowerCase(),
    );
    for (const word of ["upload", "delete", "remove", "rename", "add"]) {
      expect(labels.some((l) => l.includes(word))).toBe(false);
    }
    expect(container.querySelector("input[type=file]")).toBeNull();
  });

  it("says WHY when the namespace is disabled, instead of showing an empty grid", async () => {
    // Codex W2. An empty grid means "you have not dropped anything in yet"; a disabled namespace means
    // "the app cannot read your folder". Only one of those is the owner's to fix, so they must not look
    // the same. The theme is already on its bundled art underneath.
    renderGallery({
      ns: "gacha",
      collation: "casefold-natural",
      roles: {},
      slots: {},
      disabled: true,
      reason: "'/home/x/.ctrl-b/media/gacha/reel' is a file, but a directory is needed there.",
    });
    expect(await screen.findByText(/media disabled/)).toBeTruthy();
    expect(screen.getByText(/is a file, but a directory is needed there/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Move/ })).toBeNull();
  });

  it("a hung media refetch does not hold the save open forever", async () => {
    // Codex W4. `getJSON` has no timeout (a standing kit-wide gap), so the awaited invalidation is
    // bounded: on the bound the save settles and the controls unblock with a possibly-stale order,
    // rather than the Save button hanging over an art listing.
    vi.useFakeTimers();
    try {
      api.getJSON.mockResolvedValueOnce(index()).mockImplementationOnce(
        () => new Promise<MediaIndex>(() => undefined), // never settles
      );
      const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <MediaGallery ns="gacha" def={MEDIA_NS.gacha} />
        </QueryClientProvider>,
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText("a.webp")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Move c.webp up" }));
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByRole("button", { name: "Move a.webp down" })).toHaveProperty(
        "disabled",
        true,
      );

      await vi.advanceTimersByTimeAsync(6_000); // past the bound
      expect(screen.getByRole("button", { name: "Move a.webp down" })).toHaveProperty(
        "disabled",
        false,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an unreachable index instead of rendering an empty gallery", async () => {
    api.getJSON.mockRejectedValue(new Error("boom"));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MediaGallery ns="gacha" def={MEDIA_NS.gacha} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/media index unreachable: boom/)).toBeTruthy();
  });
});

// ── the KEYED gallery, where the keys are DATA (D53 M3 / MEDIA_PLAN §5) ──────────────────────────
//
// The kit row's keys are the fleet's SERVICE identities, so this half of the gallery owns a second data
// dependency (Opus M5) and has four sentences to get right: which key each service wants, which file
// took it, which files took none and WHY — and, while the service list is still in flight, that it does
// not know yet. That last one is the load-bearing case: "no service is called that" would be a claim
// about a list we do not have.

const svcFile = (name: string, over: Partial<MediaFile> = {}): MediaFile => ({
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

/** The kit gallery against a URL-aware client mock: its own index, plus the `/api/services` list it
 *  fetches ITSELF — `services: null` leaves that request pending forever and `"error"` fails it, the two
 *  ways the key list can be unknown. */
function renderKitGallery(
  files: MediaFile[],
  services: { name: string; kind?: string | null }[] | null | "error",
) {
  api.getJSON.mockImplementation((url: string) => {
    if (url === "/api/services") {
      if (services === null) return new Promise(() => {}); // pending forever
      if (services === "error") return Promise.reject(new Error("offline"));
      return Promise.resolve(services);
    }
    return Promise.resolve({
      ns: "kit",
      collation: "casefold-natural",
      roles: { services: files },
      slots: {},
    });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MediaGallery ns="kit" def={MEDIA_NS.kit} />
    </QueryClientProvider>,
  );
}

/** Wait for the derived key panel to have rendered (the services request has answered). */
const settled = (c: HTMLElement) =>
  waitFor(() => expect(c.querySelectorAll(".mgal-keys li").length).toBeGreaterThan(0));

/** The key panel as the owner reads it: `key` → the text beside it → what answers it. */
const keyRows = (c: HTMLElement) =>
  [...c.querySelectorAll(".mgal-keys li")].map((li) => ({
    key: li.querySelector("code")!.textContent,
    hint: li.querySelector(".h")!.textContent,
    bound: li.querySelector(".b")!.textContent,
  }));

/** The badges on one file row, by filename. */
const badgesOf = (c: HTMLElement, filename: string) =>
  [...c.querySelectorAll(".mgal-item")]
    .filter((li) => li.querySelector(".name")!.textContent === filename)
    .flatMap((li) => [...li.querySelectorAll(".badge")].map((b) => b.textContent));

describe("MediaGallery · kit service icons", () => {
  it("names the folder to copy into — the whole owner-facing contract of a namespace no theme owns", async () => {
    const { container } = renderKitGallery([], []);
    // A fleet with no services at all: nothing to name a file after, and the gallery says so rather
    // than showing an empty key panel the owner cannot act on.
    await screen.findByText(/nothing to name a file after/);
    expect(container.querySelector(".mgal-head .path")!.textContent).toBe("media/kit/services/");
    expect(screen.getByText(/no icon is painted anywhere yet/)).toBeTruthy();
    // The sentence is COMPOSED (Codex A1): the role says what a file of it is ("icon"), the source says
    // what the keys come from ("services") — neither is written into the gallery.
    expect(screen.getByText(/named after the services above/)).toBeTruthy();
    expect(keyRows(container)).toEqual([]);
  });

  it("one row per service key, in fleet order, each showing the file that answers it", async () => {
    const { container } = renderKitGallery(
      [svcFile("jellyfin")],
      [
        { name: "Media", kind: "jellyfin" },
        { name: "Grafana", kind: null },
      ],
    );
    await settled(container);
    expect(keyRows(container)).toEqual([
      { key: "jellyfin", hint: "Media", bound: "jellyfin.png" },
      { key: "grafana", hint: "Grafana", bound: "no icon" },
    ]);
    // …and the same answer from the FILE's side.
    expect(badgesOf(container, "jellyfin.png")).toEqual(["jellyfin"]);
  });

  it("says UNKNOWN while the service list is in flight — never a false 'no service named X'", async () => {
    const { container } = renderKitGallery([svcFile("jellyfin")], null);
    await screen.findByText("jellyfin.png");
    expect(container.querySelector(".mgal-empty")!.textContent).toContain("reading the fleet");
    expect(keyRows(container)).toEqual([]); // no key panel to be wrong with
    expect(badgesOf(container, "jellyfin.png")).toEqual(["unknown"]);
  });

  it("flags a service/service collision on ONE row and says the two share the file", async () => {
    const { container } = renderKitGallery(
      [svcFile("jellyfin")],
      [
        { name: "media-a", kind: "Jellyfin" },
        { name: "media-b", kind: "jellyfin" },
      ],
    );
    await settled(container);
    const [row] = keyRows(container);
    expect(row.hint).toContain("media-a · media-b");
    expect(row.hint).toContain("share this icon"); // a file DID win it — see the no-file arm below
    expect(row.bound).toBe("jellyfin.png");
  });

  it("flags a file/file collision on the LOSER, and a file no key wants as unmatched", async () => {
    const { container } = renderKitGallery(
      [
        svcFile("jellyfin", { file: "jellyfin.png" }),
        svcFile("Jellyfin", { file: "Jellyfin.webp" }),
        svcFile("emby"),
      ],
      [{ name: "media", kind: "jellyfin" }],
    );
    await settled(container);
    expect(badgesOf(container, "jellyfin.png")).toEqual(["jellyfin"]); // the winner, by index order
    expect(badgesOf(container, "Jellyfin.webp")).toEqual(["duplicate"]);
    expect(badgesOf(container, "emby.png")).toEqual(["no match"]);
  });

  it("says outright that a service whose key cannot be a filename cannot have an icon", async () => {
    // Two shapes on purpose (Codex M3-R1 NEW-1): the separator case AND a reserved-name case share ONE
    // general explanation — the copy must never diagnose a single character class, because the rule is
    // the whole conservative stem set (lib/media.ts#isStemRepresentable).
    const { container } = renderKitGallery([], [{ name: "media/plex" }, { name: "CON" }]);
    await settled(container);
    for (const row of keyRows(container)) {
      expect(row.hint).toContain("no icon: no file on the server could be named this");
      expect(row.bound).toBe("—");
    }
  });

  it("an UNUSABLE file keeps the server's verdict as its reason, and gains no second one", async () => {
    const { container } = renderKitGallery(
      [svcFile("jellyfin", { unusable: true, unusable_reason: "format-mismatch", format: "jpeg" })],
      [{ name: "media", kind: "jellyfin" }],
    );
    await settled(container);
    expect(badgesOf(container, "jellyfin.png")).toEqual(["wrong extension (jpeg)"]);
    expect(keyRows(container)[0].bound).toBe("no icon");
  });

  it("colliding services with NO file share a KEY, not an icon (Codex M3 LOW-1)", async () => {
    // The fresh-install wording. "These share one icon" is a claim about a picture that does not
    // exist — on a fresh install, or when the only candidate file is unusable, what they actually
    // share is the name the owner has to give the file.
    const { container } = renderKitGallery(
      [],
      [
        { name: "media-a", kind: "jellyfin" },
        { name: "media-b", kind: "jellyfin" },
      ],
    );
    await settled(container);
    const [row] = keyRows(container);
    expect(row.hint).toContain("use the same icon key");
    expect(row.hint).not.toContain("share this icon");
    expect(row.bound).toBe("no icon");
  });

  it("a FAILED service list says so, instead of spinning forever (Codex M3 LOW-2)", async () => {
    // The query is terminal — retry is off — so "reading the fleet's services…" would be a spinner
    // sentence for something that will never arrive. The FILES keep their honest `unknown` badge:
    // the bindings are unknown, which is not the same as unmatched.
    const { container } = renderKitGallery([svcFile("jellyfin")], "error");
    await waitFor(() =>
      expect(container.querySelector(".mgal-empty")!.textContent).toContain(
        "service list unavailable",
      ),
    );
    expect(container.querySelector(".mgal-empty")!.textContent).not.toContain("reading the fleet");
    expect(keyRows(container)).toEqual([]);
    expect(badgesOf(container, "jellyfin.png")).toEqual(["unknown"]);
  });
});

// ── the SECOND derived source: machines (the Kit Art System / Codex A1) ─────────────────────────
//
// The whole point of the generic view model is that this panel needed no new gallery code — so what is
// under test is that the generic path SAYS THE RIGHT THINGS here: machine keys, machine wording, and the
// picture noun. A hosts panel that said "service" would be the A1 failure mode made visible.

/** The kit gallery showing ONLY the `hosts` role, against its own index + the `/api/hosts` list it
 *  fetches itself. `hosts: null` leaves that request pending forever. */
function renderHostsGallery(files: MediaFile[], hosts: { id: string; name: string }[] | null) {
  api.getJSON.mockImplementation((url: string) => {
    if (url === "/api/hosts") {
      if (hosts === null) return new Promise(() => {});
      return Promise.resolve(hosts);
    }
    return Promise.resolve({
      ns: "kit",
      collation: "casefold-natural",
      roles: { hosts: files },
      slots: {},
    });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MediaGallery ns="kit" def={MEDIA_NS.kit} />
    </QueryClientProvider>,
  );
}

const hostFile = (name: string): MediaFile => ({
  ...svcFile(name),
  url: `/api/media/kit/files/hosts/${name}.png`,
});

describe("MediaGallery · kit machine pictures", () => {
  it("one row per MACHINE, keyed by its name, showing the file that answers it", async () => {
    const { container } = renderHostsGallery(
      [hostFile("corsair")],
      [
        { id: "corsair", name: "Corsair" },
        { id: "vault", name: "vault" },
      ],
    );
    await settled(container);
    expect(keyRows(container)).toEqual([
      { key: "corsair", hint: "Corsair", bound: "corsair.png" },
      { key: "vault", hint: "vault", bound: "no picture" },
    ]);
    expect(container.querySelector(".mgal-head .path")!.textContent).toBe("media/kit/hosts/");
  });

  it("speaks about MACHINES and PICTURES — the generic renderer never leaks the other source's words", async () => {
    const { container } = renderHostsGallery([], []);
    await screen.findByText(/nothing to name a file after/);
    expect(screen.getByText(/No machines are configured yet/)).toBeTruthy();
    expect(screen.getByText(/no picture is painted anywhere yet/)).toBeTruthy();
    expect(screen.getByText(/named after the machines above/)).toBeTruthy();
    expect(container.textContent).not.toContain("service");
  });

  it("says it is reading the MACHINES while that list is in flight", async () => {
    const { container } = renderHostsGallery([hostFile("corsair")], null);
    await screen.findByText("corsair.png");
    expect(container.querySelector(".mgal-empty")!.textContent).toContain("machines");
    expect(badgesOf(container, "corsair.png")).toEqual(["unknown"]);
  });

  it("a RENAMED machine leaves its old picture UNMATCHED, and the new key shows what to call the file", async () => {
    // The A7 accepted cost, made visible where the owner can act on it: the remedy is one rename, and
    // both halves of it are on screen — the orphaned file and the key it should carry.
    const { container } = renderHostsGallery(
      [hostFile("corsair")],
      [{ id: "corsair-2", name: "corsair-2" }],
    );
    await settled(container);
    expect(badgesOf(container, "corsair.png")).toEqual(["no match"]);
    expect(keyRows(container)).toEqual([
      { key: "corsair-2", hint: "corsair-2", bound: "no picture" },
    ]);
  });
});

// ── the STATIC-key half of the same obligation (Codex M3 MED-1) ──────────────────────────────────
//
// The frontier stack's keys come from the registry rather than from live data, but a drop can go wrong
// in exactly the same two ways — a second file reaching a key that is already taken, and a file whose
// stem matches no key at all. Before the classifier was shared, this path recorded only the WINNERS, so
// `Cube.webp` and a mistyped `platform_mis.png` looked exactly like a file that had bound.

function renderStackGallery(files: MediaFile[]) {
  api.getJSON.mockResolvedValue({
    ns: "frontier",
    collation: "casefold-natural",
    roles: { rigs: [], hero: [], stack: files },
    slots: {},
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MediaGallery ns="frontier" def={MEDIA_NS.frontier} />
    </QueryClientProvider>,
  );
}

const stackFile = (name: string, file: string): MediaFile => ({
  ...svcFile(name),
  file,
  url: `/api/media/frontier/files/stack/${file}`,
});

describe("MediaGallery · a static-key named role diagnoses drops the same way", () => {
  it("badges the LOSER of a stem collision, in either index order", async () => {
    const png = stackFile("cube", "cube.png");
    const webp = stackFile("Cube", "Cube.webp");

    const first = renderStackGallery([png, webp]);
    await waitFor(() => expect(first.container.querySelectorAll(".mgal-item")).toHaveLength(2));
    expect(badgesOf(first.container, "cube.png")).toEqual(["cube"]);
    expect(badgesOf(first.container, "Cube.webp")).toEqual(["duplicate"]);
    cleanup();

    // The tie-break is the LISTING, which the owner reorders — so the other order names the other winner.
    const second = renderStackGallery([webp, png]);
    await waitFor(() => expect(second.container.querySelectorAll(".mgal-item")).toHaveLength(2));
    expect(badgesOf(second.container, "Cube.webp")).toEqual(["cube"]);
    expect(badgesOf(second.container, "cube.png")).toEqual(["duplicate"]);
  });

  it("flags a file that matches no declared layer — the typo the owner would otherwise hunt for", async () => {
    const { container } = renderStackGallery([
      stackFile("cube", "cube.png"),
      stackFile("platform_mis", "platform_mis.png"),
    ]);
    await waitFor(() => expect(container.querySelectorAll(".mgal-item")).toHaveLength(2));
    expect(badgesOf(container, "platform_mis.png")).toEqual(["no match"]);
    // …and the key panel still says what that layer is falling back to.
    const rows = keyRows(container);
    expect(rows.map((r) => r.bound)).toEqual(["cube.png", "bundled", "bundled"]);
  });
});
