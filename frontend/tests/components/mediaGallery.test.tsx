import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaIndex } from "../../src/hooks/useMedia";
import type { ThemeMedia } from "../../src/theme-engine/types";

// The owner-media gallery (D52/G5, GACHA_PLAN §5.4) — the Conf half of the read-only media surface.
//
// The api client is mocked BELOW the hooks (the machineEditorDiscoverVpn precedent), so the real
// `useMediaIndex` + `useSaveSettings` run against a real QueryClient and the assertions are on the WIRE:
// what the gallery reads, and exactly what patch it writes. That is the contract that matters — the
// config shape is what the backend validates and what the index re-reads.
//
// The load-bearing claims:
//  · reordering writes the WHOLE role order (the config field is the order itself, not a diff);
//  · a pin writes `themes.<ns>.slots.<key>`, and clearing one writes null — never a stray "";
//  · nothing here can create, rename or delete a file (§5.4 ruled option (b): there is no write API);
//  · the index's warnings are SHOWN — a file the theme cannot use must be visible as such.

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

const MEDIA: ThemeMedia = {
  ns: "gacha",
  roles: { characters: "Capsule cards.", reel: "The cutout that rides the tab transition." },
  slots: [
    { key: "wallpaper", label: "Fleet backdrop", from: "characters" },
    // The ruled shape (Codex F4): the figure's options come from the REEL role, not the cast, with the
    // theme's own bundled cutout standing in while that folder is empty.
    { key: "reel_figure", label: "Transition figure", from: "reel", bundled: ["lyra"] },
  ],
};

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
  warnings: [] as string[],
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
      <MediaGallery media={MEDIA} />
    </QueryClientProvider>
  );
  return render(ui);
}

/** The `themes.<ns>` block of the single PUT the gallery made. */
function savedBlock(): Record<string, unknown> {
  expect(api.putJSON).toHaveBeenCalledTimes(1);
  const [url, body] = api.putJSON.mock.calls[0] as [string, { themes: Record<string, unknown> }];
  expect(url).toBe("/api/settings"); // the ORDINARY write path — no media-specific endpoint exists
  return body.themes.gacha as Record<string, unknown>;
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

  it("shows the theme's per-role hint — including the reel cutout's missing-glow expectation", async () => {
    renderGallery();
    await screen.findByText("a.webp");
    expect(screen.getByText("The cutout that rides the tab transition.")).toBeTruthy();
  });

  it("surfaces the index's warnings, and marks an unusable file on its row", async () => {
    const { container } = renderGallery(
      index({
        roles: {
          characters: [
            file("liar", "characters", { unusable: true, warnings: ["format-mismatch"] }),
            file("huge", "characters", {
              warnings: ["oversize", "dimensions"],
              size_bytes: 3_600_000,
            }),
          ],
        },
      }),
    );
    await screen.findByText("liar.webp");
    expect(screen.getByText("wrong extension")).toBeTruthy();
    expect(screen.getByText("large file")).toBeTruthy();
    expect(screen.getByText("very large image")).toBeTruthy();
    expect(container.querySelectorAll(".mgal-item.bad")).toHaveLength(1);
    // …and the oversize one still shows its real numbers, because it is still usable
    expect([...container.querySelectorAll(".mgal-item .dim")][1].textContent).toBe(
      "640×854 · 3.6 MB",
    );
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
        <MediaGallery media={MEDIA} />
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
    const [, body] = api.putJSON.mock.calls[1] as [string, { themes: { gacha: unknown } }];
    expect(body.themes.gacha).toEqual({
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
        <MediaGallery media={MEDIA} />
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
          <MediaGallery media={MEDIA} />
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
        <MediaGallery media={MEDIA} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/media index unreachable: boom/)).toBeTruthy();
  });
});
