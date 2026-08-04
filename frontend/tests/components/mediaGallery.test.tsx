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
  slots: [{ key: "wallpaper", label: "Fleet backdrop", from: "characters" }],
};

const file = (name: string, role: string, over: Partial<MediaIndex["roles"][string][0]> = {}) => ({
  name,
  file: `${name}.webp`,
  url: `/api/media/gacha/files/${role}/${name}.webp`,
  format: "webp",
  size_bytes: 88_000,
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
