import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaFile, MediaIndex } from "../../src/hooks/useMedia";
import { MEDIA_NS } from "../../src/theme-engine/mediaRegistry";

// The owner-media gallery (D65 / MEDIA_MANAGER_PLAN §6) — the Conf half of the media surface, rebuilt
// as a LIBRARY manager: one card per art destination, a full-screen gallery behind each, and the item
// detail panel where every action lives.
//
// The api client is mocked BELOW the hooks (the machineEditorDiscoverVpn precedent), so the real
// `useMediaGalleryIndex` + `useSaveSettings` run against a real QueryClient and the assertions are on
// the WIRE: what the gallery reads, and exactly what patch it writes. That is the contract that
// matters — the config shape is what the backend validates and what the index re-reads.
//
// The load-bearing claims:
//  · a card paints what the section's §2.4 RESOLVER says is live, in the resolver's own mode word —
//    never a re-derivation, and never a phantom when another section holds the winner;
//  · a gesture writes the config the plan's transforms produce, tier rule included;
//  · the modal is the house dialog (trapped, Escape-closes) and the Android Back gesture spends
//    exactly one history entry;
//  · the a11y shape of §6.5: tiles are plain buttons carrying their membership in a DESCRIPTION,
//    `aria-checked` belongs to the In-use switch alone, `aria-current` to a genuinely current entry.
//
// The rows under test are the REAL `MEDIA_NS` ones, not local fixtures: what the owner meets is the
// registry that actually ships.

const api = vi.hoisted(() => ({
  getJSON: vi.fn(),
  getJSONWithHeader: vi.fn(),
  putJSON: vi.fn(),
  postJSON: vi.fn(),
  del: vi.fn(),
}));
vi.mock("../../src/api/client", () => api);
const toast = vi.hoisted(() => ({ pushToast: vi.fn() }));
vi.mock("../../src/store/toast", () => toast);
// `useSaveSettings` refreshes the composer's verb sets on success; both are network calls this suite
// has no business making, and the api client above is already mocked.
vi.mock("../../src/lib/composer", () => ({ loadProviders: vi.fn(), loadAgents: vi.fn() }));

import { ConfirmDialog } from "../../src/components/ConfirmDialog";
import { MediaGallery } from "../../src/components/MediaGallery";
import { setUI } from "../../src/store/ui";

const file = (name: string, role: string, over: Partial<MediaFile> = {}): MediaFile => ({
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
  listed: false,
  hidden: false,
  ...over,
});

/** A bundled row exactly as `core/media.py#bundled_row` emits one: the id in both name fields, no
 *  file, no url, no probe facts — the client maps the id to its own hashed asset. */
const bundledRow = (id: string, over: Partial<MediaFile> = {}): MediaFile => ({
  name: id,
  file: "",
  url: "",
  bundled: id,
  format: null,
  size_bytes: 0,
  revision: "",
  width: null,
  height: null,
  unusable: false,
  unusable_reason: null,
  listed: false,
  hidden: false,
  ...over,
});

/** The FALLBACK TIER the real server appends to every gacha role (§2.3 ③). */
const cast = ["pegasus", "atlas", "3", "4", "lyra"].map((id) => bundledRow(id));

function index(over: Partial<MediaIndex> = {}): MediaIndex {
  return {
    ns: "gacha",
    collation: "library-v1",
    roles: {
      characters: [
        file("a", "characters"),
        file("b", "characters"),
        file("c", "characters"),
        ...cast,
      ],
      banner: [bundledRow("b2"), bundledRow("b3")],
      reel: [bundledRow("lyra")],
      oracle: [],
    },
    slots: {},
    ...over,
  };
}

function renderGallery(payload: MediaIndex = index(), ns = "gacha"): ReturnType<typeof render> {
  api.getJSON.mockResolvedValue(payload);
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const ui: ReactElement = (
    <QueryClientProvider client={qc}>
      <MediaGallery ns={ns} def={MEDIA_NS[ns]} />
    </QueryClientProvider>
  );
  return render(ui);
}

/** Open one section's gallery and wait for the dialog. */
async function openSection(name: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: `Open the ${name} gallery` }));
  return screen.findByRole("dialog");
}

/** Open one item's detail panel inside an already-open gallery. */
function openItem(dialog: HTMLElement, name: string): void {
  fireEvent.click(within(dialog).getByRole("button", { name }));
}

/** The `media.namespaces.gacha` block of the single PUT the gallery made (D65's fold). */
function savedBlock(at = 0): Record<string, unknown> {
  const [url, body] = api.putJSON.mock.calls[at] as [
    string,
    { media: { namespaces: Record<string, unknown> } },
  ];
  expect(url).toBe("/api/settings"); // the ORDINARY write path — file BYTES have their own verb (D65)
  return body.media.namespaces.gacha as Record<string, unknown>;
}

const filesOf = (block: Record<string, unknown>, role = "characters") =>
  (block.roles as Record<string, { files: unknown[] }>)[role].files;

beforeEach(() => {
  api.getJSON.mockReset();
  api.del.mockReset().mockResolvedValue(undefined);
  toast.pushToast.mockReset();
  // This component only ever renders INSIDE the Conf tab, and its writes are read-modify-writes over
  // the settings doc — a Conf-SCOPED query. So the suite runs in the tab the component lives in.
  setUI({ tab: "conf" });
  api.getJSONWithHeader.mockReset().mockResolvedValue({ data: {}, header: "r1" });
  api.putJSON.mockReset().mockResolvedValue({
    settings: { notifications: {} },
    restart_required: [],
    warnings: [],
    providers_rev: "r1",
  });
});
afterEach(async () => {
  cleanup();
  setUI({ tab: "fleet" });
  // Let the back guard's unmount finish. It reclaims its history entry with an asynchronous
  // `history.back()`, and jsdom delivers that pop on a later task — which, without this, is a task
  // inside the NEXT test, where the guard swallows it as its own unwind and the next Escape appears
  // to do nothing. A real browser has no test boundary to leak across; the suite does.
  await new Promise((r) => setTimeout(r, 0));
});

describe("the entry cards (§6.1)", () => {
  it("one card per DECLARED destination — role folders, then the pin-backed seats", async () => {
    renderGallery();
    await screen.findByRole("button", { name: "Open the characters gallery" });
    for (const name of ["characters", "banner", "reel", "oracle"]) {
      expect(screen.getByRole("button", { name: `Open the ${name} gallery` })).toBeTruthy();
    }
    // The three gacha SEATS: a character bound into a surface the cast does not own. `reel_figure` is
    // NOT one — it pins the reel role's own first pick, so it belongs to that role's card.
    for (const label of ["Fleet backdrop", "Hero slide", "Operator backdrop"]) {
      expect(screen.getByRole("button", { name: `Open the ${label} gallery` })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: /Transition figure/ })).toBeNull();
  });

  it("paints the ACTIVE art the resolver names, with its mode word — a collage for a dealt set", async () => {
    const { container } = renderGallery();
    await screen.findByRole("button", { name: "Open the characters gallery" });
    const card = screen.getByRole("button", { name: "Open the characters gallery" });
    // The cast is DEALT: every owner file is in use, the bundled tier is not, and the word says how.
    expect(card.textContent).toContain("dealt to machines in this order");
    const art = [...card.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(art).toEqual([
      "/api/media/gacha/files/characters/a.webp?rev=1%3A88000",
      "/api/media/gacha/files/characters/b.webp?rev=1%3A88000",
      "/api/media/gacha/files/characters/c.webp?rev=1%3A88000",
    ]);
    expect(container.querySelector(".mgal-card-art.collage")).toBeTruthy();
  });

  it("…and on a fresh install the same resolver paints the BUNDLED tier instead", async () => {
    renderGallery(
      index({
        roles: { characters: cast, banner: [], reel: [], oracle: [] },
      }),
    );
    const card = await screen.findByRole("button", { name: "Open the characters gallery" });
    // The fallback tier IS what the theme deals when the owner has dropped nothing — the gallery says
    // exactly that rather than "nothing in use", because the fleet is not blank.
    expect(card.textContent).toContain("5 images");
    expect(card.textContent).toContain("dealt to machines");
    expect(card.querySelectorAll("img")).toHaveLength(4); // the collage caps at four
  });

  it("a first-wins role names ONE in use; an empty one offers to add", async () => {
    renderGallery();
    const reel = await screen.findByRole("button", { name: "Open the reel gallery" });
    expect(reel.textContent).toContain("1 in use");
    const oracle = screen.getByRole("button", { name: "Open the oracle gallery" });
    expect(oracle.textContent).toContain("Add an image");
  });

  it("the warning chip names what the owner has to act on, once", async () => {
    renderGallery(
      index({
        roles: {
          characters: [
            file("liar", "characters", { unusable: true, unusable_reason: "format-mismatch" }),
            file("ok", "characters"),
          ],
          banner: [],
          reel: [],
          oracle: [],
        },
      }),
    );
    const card = await screen.findByRole("button", { name: "Open the characters gallery" });
    expect(card.textContent).toContain("1 will not paint");
  });

  it("a section OVERRIDDEN by a seat points at it instead of painting a phantom (§2.4)", async () => {
    // The pin-beats-pool case: `oracleArt` reads the `oracle` SEAT before it ever looks at the oracle
    // folder. The pool's own grid does not hold the winner, so the card must not mark one of its tiles.
    renderGallery(
      index({
        roles: {
          characters: [file("kira", "characters")],
          banner: [],
          reel: [],
          oracle: [file("eye", "oracle")],
        },
        slots: { oracle: "kira" },
      }),
    );
    const card = await screen.findByRole("button", { name: "Open the oracle gallery" });
    expect(card.textContent).toContain("overridden");
    expect(card.querySelectorAll("img")).toHaveLength(0); // no phantom
    expect(screen.getByRole("button", { name: /Currently set by Operator backdrop/ })).toBeTruthy();
  });

  it("a SEAT offers only what its source LADDER can resolve — never a pick that falls through", async () => {
    // The pin names an entry the theme looks up in the list it DEALS. On a fresh install that is the
    // bundled cast; the moment the owner drops one file in, the cast is theirs — and offering the
    // bundled names beside it would let them pick one the render silently ignores.
    renderGallery(index({ roles: { characters: cast, banner: [], reel: [], oracle: [] } }));
    let dialog = await openSection("Fleet backdrop");
    expect(within(dialog).getByRole("button", { name: "pegasus (bundled)" })).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    cleanup();

    renderGallery();
    dialog = await openSection("Fleet backdrop");
    expect(within(dialog).getByRole("button", { name: "a.webp" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "pegasus (bundled)" })).toBeNull();
  });

  it("a SEAT card says what is pinned, and offers the source role's library", async () => {
    renderGallery(
      index({
        roles: {
          characters: [file("kira", "characters"), file("nova", "characters")],
          banner: [],
          reel: [],
          oracle: [],
        },
        slots: { wallpaper: "nova" },
      }),
    );
    const card = await screen.findByRole("button", { name: "Open the Fleet backdrop gallery" });
    expect(card.textContent).toContain("nova in use");
    const dialog = await openSection("Fleet backdrop");
    expect(within(dialog).getByRole("button", { name: "kira.webp" })).toBeTruthy();
    // A seat is a VIEW: no upload row, and its detail offers only the pin.
    expect(within(dialog).queryByText(/Add an image/)).toBeNull();
  });
});

describe("the H5 role-family card (kit's derived keys)", () => {
  const svcFile = (name: string, over: Partial<MediaFile> = {}): MediaFile => ({
    ...file(name, "services"),
    url: `/api/media/kit/files/services/${name}.png`,
    file: `${name}.png`,
    ...over,
  });

  function renderKit(files: MediaFile[], services: { name: string; kind?: string | null }[]) {
    api.getJSON.mockImplementation((url: string) => {
      if (url === "/api/services") return Promise.resolve(services);
      if (url === "/api/hosts") return Promise.resolve([]);
      return Promise.resolve({
        ns: "kit",
        collation: "library-v1",
        roles: { services: files, "service-banners": [], hosts: [], background: [], brand: [] },
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

  it("ONE card for the whole family, with a row per KEY that opens that key's gallery", async () => {
    // The owner-ratified refinement: twelve services must not put twelve cards in Conf.
    renderKit([svcFile("jellyfin")], [{ name: "Media", kind: "jellyfin" }, { name: "Grafana" }]);
    // Two roles share the SERVICES key source (icons and banners), so a key row is named by its key
    // AND by what a file of that role is — "jellyfin" alone would name two different galleries.
    const row = await screen.findByRole("button", { name: "Open the jellyfin icon gallery" });
    expect(row.textContent).toContain("Media");
    expect(row.textContent).toContain("jellyfin.png");
    expect(
      screen.getByRole("button", { name: "Open the grafana icon gallery" }).textContent,
    ).toContain("no icon");
    fireEvent.click(row);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "jellyfin — icon" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "jellyfin.png" })).toBeTruthy();
  });

  it("the UNASSIGNED bucket appears only when files bound nothing — and is their only way out", async () => {
    // A rename's aftermath. Per-key galleries would make the orphan invisible and undeletable, which
    // is the one state a manager must not be able to produce.
    renderKit([svcFile("jellyfin"), svcFile("old-name")], [{ name: "Media", kind: "jellyfin" }]);
    const card = await screen.findByRole("button", { name: "Open the Unassigned gallery" });
    expect(card.textContent).toContain("1 file matches no name here");
    fireEvent.click(card);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "old-name.png" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "jellyfin.png" })).toBeNull();
  });

  it("…and never while the KEY LIST is still unknown (a third state, not an empty one)", async () => {
    api.getJSON.mockImplementation((url: string) => {
      if (url === "/api/services") return new Promise(() => undefined); // pending forever
      if (url === "/api/hosts") return Promise.resolve([]);
      return Promise.resolve({
        ns: "kit",
        collation: "library-v1",
        roles: {
          services: [svcFile("jellyfin")],
          "service-banners": [],
          hosts: [],
          background: [],
          brand: [],
        },
        slots: {},
      });
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MediaGallery ns="kit" def={MEDIA_NS.kit} />
      </QueryClientProvider>,
    );
    await screen.findAllByText(/reading the fleet/);
    expect(screen.queryByRole("button", { name: "Open the Unassigned gallery" })).toBeNull();
  });
});

describe("the gallery modal (§6.2)", () => {
  it("is the house dialog: labelled, trapped, and Escape closes it", async () => {
    renderGallery();
    const dialog = await openSection("characters");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByRole("heading", { name: "characters" })).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Escape goes through history.back — and the popstate handler is the ONLY closer", async () => {
    // The orphan-entry regression arm (Emma #5): a close path that did not spend its own history entry
    // would leave one behind on every open, and the owner would press Back five times to leave the app.
    renderGallery();
    const before = history.length;
    const dialog = await openSection("characters");
    await waitFor(() =>
      expect((history.state as { ctrlbOverlay?: boolean } | null)?.ctrlbOverlay).toBe(true),
    );
    // (`history.length` never SHRINKS on back — the pointer moves and the next push truncates — so the
    // leak shows up as growth across opens, which is what this bounds.)
    expect(history.length).toBeLessThanOrEqual(before + 1);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((history.state as { ctrlbOverlay?: boolean } | null)?.ctrlbOverlay).toBeUndefined();
  });

  it("the owner's BACK gesture closes it too", async () => {
    renderGallery();
    await openSection("characters");
    await waitFor(() =>
      expect((history.state as { ctrlbOverlay?: boolean } | null)?.ctrlbOverlay).toBe(true),
    );
    history.back();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("carries the Add row — the ONE admission path, with its hidden picker beside it (S3b)", async () => {
    renderGallery();
    const dialog = await openSection("characters");
    const add = within(dialog)
      .getByText(/Add an image/)
      .closest("button");
    expect(add).toHaveProperty("disabled", false);
    // Explicit accept types (never `image/*`) and NO `capture`: both engines already offer the camera
    // in the chooser for an image accept list, and `capture` would make it the only option (R54 §5).
    const input = dialog.querySelector("input[type=file]");
    expect(input?.getAttribute("accept")).toBe("image/png,image/jpeg,image/webp");
    expect(input?.hasAttribute("capture")).toBe(false);
    expect(input?.hasAttribute("multiple")).toBe(false);
  });

  it("…and a SEAT has none: a read-only view over another library has nothing to upload to", async () => {
    renderGallery();
    const dialog = await openSection("Fleet backdrop");
    expect(within(dialog).queryByText(/Add an image/)).toBeNull();
    expect(dialog.querySelector("input[type=file]")).toBeNull();
  });

  it("counts the library in a live region, so a delete is announced", async () => {
    renderGallery();
    const dialog = await openSection("characters");
    expect(within(dialog).getByRole("status").textContent).toContain("8 images");
  });
});

describe("the grid (§6.3) and its a11y shape (§6.5)", () => {
  it("marks IN USE, PROBLEM and BUNDLED in three corners, never sharing one", async () => {
    const { container } = renderGallery(
      index({
        roles: {
          characters: [
            file("a", "characters"),
            file("bad", "characters", { unusable: true, unusable_reason: "unreadable" }),
            bundledRow("lyra"),
          ],
          banner: [],
          reel: [],
          oracle: [],
        },
      }),
    );
    await openSection("characters");
    const tile = (name: string) =>
      screen.getByRole("button", { name }).parentElement as HTMLElement;
    expect(container.querySelectorAll(".mgal-corner.end")).toHaveLength(2); // a + bad: both dealt
    expect(container.querySelectorAll(".mgal-corner.top")).toHaveLength(1); // only the broken one
    expect(container.querySelectorAll(".mgal-corner.start")).toHaveLength(1); // only the bundled one
    expect(tile("a.webp")).toBeTruthy();
  });

  it("a tile is a plain button whose DESCRIPTION carries membership — never a fake toggle", async () => {
    // Emma #9: `aria-checked` on a tile would claim a state a tile does not own, and a screen reader
    // cannot check it. Membership is said in words; the switch in the detail panel is the real control.
    renderGallery();
    const dialog = await openSection("characters");
    const tile = within(dialog).getByRole("button", { name: "a.webp" });
    expect(tile.getAttribute("aria-checked")).toBeNull();
    const described = document.getElementById(tile.getAttribute("aria-describedby") ?? "");
    expect(described?.textContent).toContain("in use");
    // A DEALT pool has no single current member, so nothing claims to be one.
    expect(dialog.querySelector("[aria-current]")).toBeNull();
  });

  it("…and `aria-current` marks the ONE genuinely current entry where there is one", async () => {
    renderGallery(
      index({
        roles: {
          characters: [],
          banner: [],
          reel: [file("cut", "reel"), file("cut2", "reel")],
          oracle: [],
        },
      }),
    );
    const dialog = await openSection("reel");
    expect(
      within(dialog).getByRole("button", { name: "cut.webp" }).getAttribute("aria-current"),
    ).toBe("true");
    expect(
      within(dialog).getByRole("button", { name: "cut2.webp" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("tiles are lazy past the first screenful — the decode budget (Opus M3)", async () => {
    const many = Array.from({ length: 12 }, (_, i) => file(`f${i}`, "characters"));
    const { container } = renderGallery(
      index({ roles: { characters: many, banner: [], reel: [], oracle: [] } }),
    );
    await openSection("characters");
    const imgs = [...container.querySelectorAll(".mgal-grid img")];
    expect(imgs.filter((i) => i.getAttribute("loading") === "eager")).toHaveLength(9);
    expect(imgs.filter((i) => i.getAttribute("loading") === "lazy")).toHaveLength(3);
    for (const img of imgs) expect(img.getAttribute("decoding")).toBe("async");
  });
});

describe("the item detail panel (§6.4) and what its actions write", () => {
  it("SET AS ACTIVE moves the entry to the front of `files`", async () => {
    renderGallery();
    const dialog = await openSection("characters");
    openItem(dialog, "c.webp");
    fireEvent.click(within(dialog).getByRole("button", { name: "Set as active" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    // The amended tier rule in one assertion (§2.3 ③, owner 2026-08-25): an ORDER intent names the
    // WHOLE section — the disk rows and the five bundled defaults alike, in the resulting order. The
    // old rule listed only the three files, which made those three the owner's entire tier and retired
    // the cast the fleet was painting.
    expect(filesOf(savedBlock())).toEqual([
      { name: "c.webp" },
      { name: "a.webp" },
      { name: "b.webp" },
      { bundled: "pegasus" },
      { bundled: "atlas" },
      { bundled: "3" },
      { bundled: "4" },
      { bundled: "lyra" },
    ]);
  });

  it("…and on a SEAT it is a pin write, worded 'Use here'", async () => {
    renderGallery();
    const dialog = await openSection("Fleet backdrop");
    openItem(dialog, "b.webp");
    fireEvent.click(within(dialog).getByRole("button", { name: "Use here" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    expect(savedBlock()).toEqual({ slots: { wallpaper: "b" } });
  });

  it("…and on a pool whose ladder HAS a pin, activation writes that pin", async () => {
    // `reel_figure` sits above the reel folder's own first-wins pick, so move-to-front would leave the
    // pin silently winning — the gallery would be claiming a binding the render will not honour.
    renderGallery(
      index({
        roles: {
          characters: [],
          banner: [],
          reel: [file("cut", "reel"), file("cut2", "reel")],
          oracle: [],
        },
      }),
    );
    const dialog = await openSection("reel");
    openItem(dialog, "cut2.webp");
    fireEvent.click(within(dialog).getByRole("button", { name: "Set as active" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    expect(savedBlock()).toEqual({ slots: { reel_figure: "cut2" } });
  });

  it("a pinned entry offers to CLEAR the pin instead of setting it again", async () => {
    renderGallery(index({ slots: { wallpaper: "b" } }));
    const dialog = await openSection("Fleet backdrop");
    openItem(dialog, "b.webp");
    expect(within(dialog).queryByRole("button", { name: "Use here" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear this pin" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    // NULL, never an empty string — the shape the backend reads as "unpinned".
    expect(savedBlock()).toEqual({ slots: { wallpaper: null } });
  });

  it("a DANGLING pin can be cleared even though no tile holds it", async () => {
    renderGallery(index({ slots: { wallpaper: "deleted" } }));
    const dialog = await openSection("Fleet backdrop");
    expect(within(dialog).getByText(/is missing/).textContent).toContain("deleted");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear the pin" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    expect(savedBlock()).toEqual({ slots: { wallpaper: null } });
  });

  it("the ↑/↓ pair moves one entry, and is HIDDEN where order decides nothing (#11)", async () => {
    renderGallery();
    const dialog = await openSection("characters");
    openItem(dialog, "b.webp");
    fireEvent.click(within(dialog).getByRole("button", { name: "↑ Move up" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    // An ORDER intent, so the section is named whole — the ↑/↓ pair and the drag are one transform.
    expect(filesOf(savedBlock())).toEqual([
      { name: "b.webp" },
      { name: "a.webp" },
      { name: "c.webp" },
      { bundled: "pegasus" },
      { bundled: "atlas" },
      { bundled: "3" },
      { bundled: "4" },
      { bundled: "lyra" },
    ]);
  });

  it("…hidden on a SEAT, which is a view over someone else's order", async () => {
    renderGallery();
    const dialog = await openSection("Fleet backdrop");
    openItem(dialog, "b.webp");
    expect(within(dialog).queryByRole("button", { name: /Move up/ })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Move to top/ })).toBeNull();
  });

  it("the In-use switch writes `hidden`, and the tile dims + leaves the deal", async () => {
    const { container } = renderGallery();
    const dialog = await openSection("characters");
    openItem(dialog, "b.webp");
    const sw = within(dialog).getByRole("switch", { name: /In use — b.webp/ });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    expect(filesOf(savedBlock())).toEqual([
      { name: "a.webp" },
      { name: "b.webp", hidden: true },
      { name: "c.webp" },
    ]);
    // …and the SWITCH is the only `aria-checked` in the whole surface (Emma #9).
    expect(container.querySelectorAll("[aria-checked]")).toHaveLength(1);
  });

  it("a HIDDEN entry is dimmed and out of use, but still in the library", async () => {
    const { container } = renderGallery(
      index({
        roles: {
          characters: [file("a", "characters"), file("off", "characters", { hidden: true })],
          banner: [],
          reel: [],
          oracle: [],
        },
      }),
    );
    const card = await screen.findByRole("button", { name: "Open the characters gallery" });
    expect(card.querySelectorAll("img")).toHaveLength(1); // only `a` is dealt
    const dialog = await openSection("characters");
    expect(within(dialog).getByRole("button", { name: "off.webp" })).toBeTruthy();
    expect(container.querySelectorAll(".mgal-tile-img.dim")).toHaveLength(1);
  });

  it("DELETE removes the bytes first, then writes ONE config that promotes the next entry", async () => {
    const confirm = await import("../../src/store/confirm");
    renderGallery();
    const dialog = await openSection("characters");
    openItem(dialog, "a.webp");
    const asked = new Promise<void>((resolve) => setTimeout(resolve, 0));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await asked;
    confirm.resolveConfirm(true);
    // DELETE-FIRST: a failure between the two steps leaves a dangling entry the collation drops
    // harmlessly, where the reverse would leave a file nothing lists — invisible and undeletable.
    await waitFor(() => expect(api.del).toHaveBeenCalledTimes(1));
    expect(api.del.mock.calls[0][0]).toBe("/api/media/gacha/files/characters/a.webp");
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    expect(filesOf(savedBlock())).toEqual([{ name: "b.webp" }, { name: "c.webp" }]);
  });

  it("a BUNDLED entry has no Delete at all — absent, not disabled (§6.6)", async () => {
    renderGallery();
    const dialog = await openSection("characters");
    openItem(dialog, "lyra (bundled)");
    expect(within(dialog).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(dialog).getByText(/Bundled with the app/)).toBeTruthy();
    // …and no framing action either: the focal point lands at S4, and a stub would be a promise.
    expect(within(dialog).queryByRole("button", { name: /framing/i })).toBeNull();
  });

  it("names the BINDING SOURCE in a named role — the key field, or the filename (§2.2)", async () => {
    api.getJSON.mockImplementation((url: string) => {
      if (url === "/api/services") return Promise.resolve([{ name: "Media", kind: "jellyfin" }]);
      if (url === "/api/hosts") return Promise.resolve([]);
      return Promise.resolve({
        ns: "kit",
        collation: "library-v1",
        roles: {
          services: [
            { ...file("odd-name", "services"), file: "odd-name.png", key: "jellyfin" },
            { ...file("jellyfin", "services"), file: "jellyfin.png" },
          ],
          "service-banners": [],
          hosts: [],
          background: [],
          brand: [],
        },
        slots: {},
      });
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MediaGallery ns="kit" def={MEDIA_NS.kit} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open the jellyfin icon gallery" }));
    const dialog = await screen.findByRole("dialog");
    openItem(dialog, "odd-name.png");
    expect(within(dialog).getByText(/bound by its key/).textContent).toContain("jellyfin");
    // …and the file that bound by its stem is a DUPLICATE here, which used to be invisible (#4).
    fireEvent.click(within(dialog).getByRole("button", { name: "‹ All images" }));
    openItem(dialog, "jellyfin.png");
    expect(within(dialog).getByText("duplicate name")).toBeTruthy();
    expect(within(dialog).getByText(/bound by its filename/)).toBeTruthy();
  });
});

describe("the write queue (§4 — serialized, recomputed at send, quiet)", () => {
  it("QUIET: a gesture does not stack a 'Settings saved' toast (#10)", async () => {
    renderGallery();
    const dialog = await openSection("characters");
    openItem(dialog, "c.webp");
    fireEvent.click(within(dialog).getByRole("button", { name: "Set as active" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    expect(toast.pushToast).not.toHaveBeenCalled();
  });

  it("two taps in one second SERIALIZE, and the second is computed from the FIRST's result", async () => {
    // Emma #3. The dangerous window is between "PUT resolved" and "index refetched": a second gesture
    // computed off the stale list would persist an order that undoes the first. The queue's intents are
    // recomputed at send time instead, so they compose.
    let second: (v: MediaIndex) => void = () => undefined;
    api.getJSON
      .mockResolvedValueOnce(index())
      .mockImplementationOnce(() => new Promise<MediaIndex>((r) => (second = r)));
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MediaGallery ns="gacha" def={MEDIA_NS.gacha} />
      </QueryClientProvider>,
    );
    const dialog = await openSection("characters");
    openItem(dialog, "c.webp");
    const up = within(dialog).getByRole("button", { name: "↑ Move up" });
    fireEvent.click(up);
    fireEvent.click(up);
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));

    // The refetch lands with the first move applied; the queued second intent is applied to THAT.
    second(
      index({
        roles: {
          characters: [
            file("a", "characters"),
            file("c", "characters"),
            file("b", "characters"),
            ...cast,
          ],
          banner: [],
          reel: [],
          oracle: [],
        },
      }),
    );
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(2));
    expect(filesOf(savedBlock(1))).toEqual([
      { name: "c.webp" },
      { name: "a.webp" },
      { name: "b.webp" },
      { bundled: "pegasus" },
      { bundled: "atlas" },
      { bundled: "3" },
      { bundled: "4" },
      { bundled: "lyra" },
    ]);
  });

  it("refuses to write until the SETTINGS snapshot is here — a lossy write is worse than a wait", async () => {
    // The write is a read-modify-write over the persisted `files` list; without it a gesture could only
    // write bare `{name}` rows, destroying every per-item field the owner set (`key`/`hidden`/`focal`).
    api.getJSONWithHeader.mockReturnValue(new Promise(() => undefined)); // never resolves
    renderGallery();
    const dialog = await openSection("characters");
    openItem(dialog, "c.webp");
    const act = within(dialog).getByRole("button", { name: "Set as active" });
    expect(act).toHaveProperty("disabled", true);
    fireEvent.click(act);
    await waitFor(() => expect(within(dialog).getByText("c.webp")).toBeTruthy());
    expect(api.putJSON).not.toHaveBeenCalled();
  });
});

describe("the index read (defect #3)", () => {
  it("is scoped to Conf: leaving the tab stops the gallery re-reading every namespace on focus", async () => {
    // Every tab body in this app stays MOUNTED once visited, so the old always-on observer re-read the
    // directory on every window focus for the rest of the session, from whatever tab the owner was on.
    renderGallery();
    await screen.findByRole("button", { name: "Open the characters gallery" });
    expect(api.getJSON).toHaveBeenCalledTimes(1);

    setUI({ tab: "fleet" });
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 10));
    expect(api.getJSON).toHaveBeenCalledTimes(1);

    // …and coming BACK re-reads, because files arrive out of band (Codex F7).
    setUI({ tab: "conf" });
    await waitFor(() => expect(api.getJSON).toHaveBeenCalledTimes(2));
  });
});

describe("the namespace-level states", () => {
  it("says WHY when the namespace is disabled, instead of showing an empty grid", async () => {
    renderGallery({
      ns: "gacha",
      collation: "library-v1",
      roles: {},
      slots: {},
      disabled: true,
      reason: "'/home/x/.ctrl-b/media/gacha/reel' is a file, but a directory is needed there.",
    });
    expect(await screen.findByText(/media disabled/)).toBeTruthy();
    expect(screen.getByText(/is a file, but a directory is needed there/)).toBeTruthy();
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

// ── the S2 REVIEW arms (Emma's blind pass, all main-seat ACCEPTed). Each one is a state the gallery
//    could reach on its own and describe wrongly: an activation the render ignores, a pin the ladder
//    cannot resolve, a queue replayed against a listing that is no longer the server's, a delete whose
//    cleanup failed reported as a delete that failed.

describe("activation guarantees ELIGIBILITY (review #1)", () => {
  it("SET AS ACTIVE switches a hidden entry back on, in the same write", () => {
    // Moving a hidden entry to the front changes nothing the owner can see: resolution skips hidden
    // rows everywhere, so the tile would sit first and stay excluded while the card painted somebody
    // else — the gallery claiming a binding the render ignores.
    renderGallery(
      index({
        roles: {
          characters: [file("a", "characters"), file("off", "characters", { hidden: true })],
          banner: [],
          reel: [],
          oracle: [],
        },
      }),
    );
    return openSection("characters").then(async (dialog) => {
      openItem(dialog, "off.webp");
      fireEvent.click(within(dialog).getByRole("button", { name: "Set as active" }));
      await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
      expect(filesOf(savedBlock())).toEqual([{ name: "off.webp" }, { name: "a.webp" }]);
    });
  });

  it("an IN-ROLE pin of a fallback bundled entry writes the pin AND lists it — one patch", async () => {
    // The reel's `reel_figure` pin resolves inside the list `poolRows` deals, and the fallback tier is
    // offered only while the owner's own tier is empty. With an owner cutout present, pinning bundled
    // `lyra` used to write a value the ladder could never find: the card claimed lyra, the transition
    // kept painting the owner's file, and the detail offered to "clear a pin" that was never active.
    renderGallery(
      index({
        roles: {
          characters: [],
          banner: [],
          reel: [file("cut", "reel"), bundledRow("lyra")],
          oracle: [],
        },
      }),
    );
    const dialog = await openSection("reel");
    openItem(dialog, "lyra (bundled)");
    fireEvent.click(within(dialog).getByRole("button", { name: "Set as active" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    // ONE write, both halves — a pin whose eligibility landed separately could fail on its own.
    expect(savedBlock()).toEqual({
      slots: { reel_figure: "lyra" },
      roles: { reel: { files: [{ name: "cut.webp" }, { bundled: "lyra" }] } },
    });
  });

  it("…and a SEAT still writes only its pin — it is a VIEW over someone else's library", async () => {
    // The exception, and it is the tier rule protecting the source: a seat shows bundled rows only
    // because the source's own tier is empty, so listing one would collapse the whole bundled cast to
    // that single entry — a five-character fleet becoming a one-character fleet on a pin.
    renderGallery(index({ roles: { characters: cast, banner: [], reel: [], oracle: [] } }));
    const dialog = await openSection("Fleet backdrop");
    openItem(dialog, "atlas (bundled)");
    fireEvent.click(within(dialog).getByRole("button", { name: "Use here" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    expect(savedBlock()).toEqual({ slots: { wallpaper: "atlas" } });
  });
});

describe("what the card CLAIMS is what the resolver answers (review #3)", () => {
  it("a dangling seat pin reads as a MISSING pin with a fallback in use — never as in use", async () => {
    // `wallpaper: deleted` resolves to nothing: the backdrop has already fallen through to the kit
    // picture or the bundled scene. Saying "deleted in use" named a picture nobody can see, beside a
    // warning chip saying that same picture is missing.
    renderGallery(index({ slots: { wallpaper: "deleted" } }));
    const card = await screen.findByRole("button", { name: "Open the Fleet backdrop gallery" });
    expect(card.textContent).not.toContain("deleted in use");
    expect(card.textContent).toContain("the pinned image is gone — a fallback is in use");
    expect(card.textContent).toContain("pinned image is missing"); // the chip still points at the fix
  });

  it("…and a resolved seat names the row the RESOLVER picked, pin or fall-through", async () => {
    // The hero slide has no pin of its own: its ladder reads the fleet backdrop's. The card says what
    // that ladder resolved, which is the whole of §2.4's one-resolver rule.
    renderGallery(index({ slots: { wallpaper: "b" } }));
    const hero = await screen.findByRole("button", { name: "Open the Hero slide gallery" });
    expect(hero.textContent).toContain("b in use");
  });
});

describe("the stem/id pin collision note (review #6, §2.3's owed sentence)", () => {
  it("a file stem and a bundled id that answer to ONE pin value are called out, with the tie-break", async () => {
    // The `f:`/`b:` identities stay separate — they are two library entries — but a pin VALUE is a bare
    // name and reaches whichever the collation lists first. That ambiguity is invisible from the grid.
    renderGallery(
      index({
        roles: {
          characters: [],
          banner: [],
          reel: [file("lyra", "reel"), bundledRow("lyra")],
          oracle: [],
        },
      }),
    );
    const card = await screen.findByRole("button", { name: "Open the reel gallery" });
    expect(card.textContent).toContain("duplicate names");
    const dialog = await openSection("reel");
    openItem(dialog, "lyra (bundled)");
    expect(within(dialog).getByText("duplicate name")).toBeTruthy();
    expect(within(dialog).getByText(/answers to the name/).textContent).toContain(
      "The one the library lists FIRST is the one that answers",
    );
  });

  it("…and a role with no pin never invents one — its files bind by KEY, not by pin value", async () => {
    // The same two names in a POOL that writes no pin are two ordinary entries: nothing addresses them
    // by name there, so calling them a duplicate would be a warning about nothing.
    renderGallery(
      index({
        roles: {
          characters: [file("lyra", "characters"), bundledRow("lyra")],
          banner: [],
          reel: [],
          oracle: [],
        },
      }),
    );
    const card = await screen.findByRole("button", { name: "Open the characters gallery" });
    expect(card.textContent).not.toContain("duplicate names");
  });
});

describe("the queue past its failure and staleness bounds (reviews #4 and #7)", () => {
  /** Let React and the fake clock catch up together. `waitFor` cannot be used under fake timers here
   *  (it never sees the clock move), so the flush is explicit. */
  const flush = async (ms = 0) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it("a refetch that misses its bound DISCARDS the rest of the queue, and says so", async () => {
    // The window Emma found: the first PUT succeeds, its authoritative refetch runs past the 5s bound,
    // `mutateAsync` resolves anyway — and the loop then recomputes the NEXT queued intent from an index
    // the server may already have superseded, whose write can undo the first one.
    vi.useFakeTimers();
    try {
      api.getJSON
        .mockResolvedValueOnce(index())
        .mockImplementation(() => new Promise<MediaIndex>(() => undefined)); // never lands
      const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <MediaGallery ns="gacha" def={MEDIA_NS.gacha} />
        </QueryClientProvider>,
      );
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "Open the characters gallery" }));
      await flush();
      const dialog = screen.getByRole("dialog");
      openItem(dialog, "c.webp");
      const up = within(dialog).getByRole("button", { name: "↑ Move up" });
      fireEvent.click(up);
      fireEvent.click(up);
      await flush();
      expect(api.putJSON).toHaveBeenCalledTimes(1);

      await flush(5_000); // the bound expires; the save resolves with the index unknown
      expect(api.putJSON).toHaveBeenCalledTimes(1); // the queued intent was DROPPED, not replayed
      expect(toast.pushToast).toHaveBeenCalledWith(
        expect.stringContaining("did not come back in time"),
        "err",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  /** A pin-capable role (`reel` ← the `reel_figure` pin) holding two owner files. */
  const reelIndex = (over: Partial<MediaFile> = {}) =>
    index({
      roles: {
        characters: [],
        banner: [],
        reel: [file("cut", "reel", over), file("other", "reel")],
        oracle: [],
      },
    });

  /** A PUT that echoes the patch back as the settings doc, the way the real endpoint does — so the
   *  next queued job's read-modify-write reads what the last one actually persisted. */
  const echoingPut = () =>
    api.putJSON.mockImplementation((_url: string, body: Record<string, unknown>) =>
      Promise.resolve({
        settings: { notifications: {}, ...body },
        restart_required: [],
        warnings: [],
        providers_rev: "r1",
      }),
    );

  it("a PIN decides its ELIGIBILITY at SEND, not from the item that was on screen", async () => {
    // Emma's confirm-round scenario, minus the timeout. On a pin-capable role: toggle A's In-use OFF,
    // then press Set as active before the refetch has updated the rendered detail. Minted from that
    // stale item the pin was "already eligible" and went out SCALAR-ONLY — written onto the entry the
    // job ahead of it had just hidden, where no ladder can resolve it. Eligibility is a fact about the
    // index, so it is recomputed from the index at send like every other part of a write.
    echoingPut();
    api.getJSON.mockResolvedValueOnce(reelIndex()).mockResolvedValue(reelIndex({ hidden: true }));
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MediaGallery ns="gacha" def={MEDIA_NS.gacha} />
      </QueryClientProvider>,
    );
    const dialog = await openSection("reel");
    openItem(dialog, "cut.webp");
    // Both gestures land before the first write's refetch does — the second is queued off the state
    // the first one is in the middle of changing.
    fireEvent.click(within(dialog).getByRole("switch", { name: /In use — cut.webp/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Set as active" }));

    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(2));
    expect(filesOf(savedBlock(0), "reel")).toEqual([
      { name: "cut.webp", hidden: true },
      { name: "other.webp" },
    ]);
    // The pin AND the `hidden` clear that makes it resolvable, in the one patch.
    expect(savedBlock(1)).toEqual({
      slots: { reel_figure: "cut" },
      roles: { reel: { files: [{ name: "cut.webp" }, { name: "other.webp" }] } },
    });
  });

  it("a SEAT REFUSES a pin it cannot make resolve, rather than writing one that never will", async () => {
    // Emma's final-confirm sequence. "No files half needed" and "cannot be made eligible" were the
    // same value, and the caller read both as pin-only-safe: hide a bundled SOURCE row, then use its
    // still-rendered seat tile before the refetch lands, and the seat wrote a pin onto an entry that
    // is hidden — while the one repair that would fix it (putting that bundled row into the source
    // role's own tier) is the write a seat must never make, because it collapses the source's whole
    // bundled deal to that single entry.
    let landed: (v: MediaIndex) => void = () => undefined;
    const fresh = index({ roles: { characters: cast, banner: [], reel: [], oracle: [] } });
    api.getJSON
      .mockResolvedValueOnce(fresh)
      .mockImplementationOnce(() => new Promise<MediaIndex>((r) => (landed = r)))
      .mockResolvedValue(fresh);
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MediaGallery ns="gacha" def={MEDIA_NS.gacha} />
      </QueryClientProvider>,
    );
    // ① retire a bundled entry from the SOURCE role — the only section that may.
    let dialog = await openSection("characters");
    openItem(dialog, "atlas (bundled)");
    fireEvent.click(within(dialog).getByRole("switch", { name: /In use — atlas/ }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // ② the seat is still showing the pre-hide library, so the tile is there to tap.
    dialog = await openSection("Fleet backdrop");
    openItem(dialog, "atlas (bundled)");
    fireEvent.click(within(dialog).getByRole("button", { name: "Use here" }));

    // ③ the authoritative listing lands, with atlas retired…
    landed(
      index({
        roles: {
          characters: cast.map((r) =>
            r.bundled === "atlas" ? { ...r, hidden: true, listed: true } : r,
          ),
          banner: [],
          reel: [],
          oracle: [],
        },
      }),
    );
    // …and the queued pin is refused outright rather than written onto a retired entry.
    await new Promise((r) => setTimeout(r, 20));
    expect(api.putJSON).toHaveBeenCalledTimes(1);
    expect(filesOf(savedBlock(0))).toEqual([{ bundled: "atlas", hidden: true }]);
  });

  it("…and so does a pin whose target is GONE from the library by the time it sends", async () => {
    // The other half of the same conflation: the row was deleted out of band (or dropped by a
    // collation that self-healed) between the tap and the send. There is nothing to repair, and the
    // pin would be dangling by construction.
    echoingPut();
    api.getJSON.mockResolvedValueOnce(reelIndex()).mockResolvedValue(
      index({
        roles: { characters: [], banner: [], reel: [file("other", "reel")], oracle: [] },
      }),
    );
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MediaGallery ns="gacha" def={MEDIA_NS.gacha} />
      </QueryClientProvider>,
    );
    const dialog = await openSection("reel");
    openItem(dialog, "cut.webp");
    fireEvent.click(within(dialog).getByRole("switch", { name: /In use — cut.webp/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Set as active" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.putJSON).toHaveBeenCalledTimes(1); // the hide; the pin refused
    expect(api.putJSON.mock.calls[0][1]).not.toHaveProperty("media.namespaces.gacha.slots");
  });

  it("…and on a refetch timeout the pin is DISCARDED with everything else, carve-out and all", async () => {
    // The same scenario with step 5: the hide lands but its authoritative refetch does not. A scalar
    // pin looks safe to keep — it recomputes from nothing — and is not: whether it can RESOLVE is a
    // fact about the index we no longer have. So the queue drops everything.
    vi.useFakeTimers();
    try {
      echoingPut();
      api.getJSON
        .mockResolvedValueOnce(reelIndex())
        .mockImplementation(() => new Promise<MediaIndex>(() => undefined));
      const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <MediaGallery ns="gacha" def={MEDIA_NS.gacha} />
        </QueryClientProvider>,
      );
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "Open the reel gallery" }));
      await flush();
      const dialog = screen.getByRole("dialog");
      openItem(dialog, "cut.webp");
      fireEvent.click(within(dialog).getByRole("switch", { name: /In use — cut.webp/ }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Set as active" }));
      await flush();
      expect(api.putJSON).toHaveBeenCalledTimes(1); // the hide

      await flush(5_000);
      expect(api.putJSON).toHaveBeenCalledTimes(1); // …and the pin never went out onto a hidden entry
      expect(toast.pushToast).toHaveBeenCalledWith(
        expect.stringContaining("did not come back in time"),
        "err",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("a DELETE whose config cleanup fails reads as a partial success, not as a failed delete", async () => {
    // The bytes are already gone. "Save failed" here sends the owner looking for a file the server no
    // longer has — and the dangling entry it leaves drops on its own at the next collation.
    const confirm = await import("../../src/store/confirm");
    api.putJSON.mockRejectedValue(new Error("config write refused"));
    renderGallery();
    const dialog = await openSection("characters");
    openItem(dialog, "a.webp");
    const asked = new Promise<void>((resolve) => setTimeout(resolve, 0));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await asked;
    confirm.resolveConfirm(true);
    await waitFor(() => expect(toast.pushToast).toHaveBeenCalled());
    const [message, kind] = toast.pushToast.mock.calls[0] as [string, string];
    expect(message).toContain("a.webp was deleted");
    expect(message).toContain("library entry could not be cleaned up");
    expect(kind).toBe("err");
    expect(message).not.toBe("config write refused"); // the bare save error would read as "not deleted"
  });

  it("a failed write drains the queue and RELEASES busy — the gallery is usable again", async () => {
    api.putJSON.mockRejectedValueOnce(new Error("nope"));
    renderGallery();
    const dialog = await openSection("characters");
    openItem(dialog, "c.webp");
    const up = within(dialog).getByRole("button", { name: "↑ Move up" });
    fireEvent.click(up);
    fireEvent.click(up);
    await waitFor(() => expect(toast.pushToast).toHaveBeenCalledWith("nope", "err"));
    // The second intent was dropped rather than replayed against a list the server refused…
    await new Promise((r) => setTimeout(r, 10));
    expect(api.putJSON).toHaveBeenCalledTimes(1);
    // …and the status line is no longer saving, so the next gesture is not blocked behind a stuck flag.
    expect(within(dialog).getByRole("status").textContent).not.toContain("saving");
    fireEvent.click(up);
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(2));
  });

  it("two SECTIONS' writes interleave through the one chokepoint, each carrying its own block", async () => {
    // The queue is per-namespace, not per-section: two destinations' jobs must compose rather than
    // replace each other's list (§4's whole reason for serialising at one place).
    renderGallery(
      index({
        roles: {
          characters: [file("a", "characters"), file("b", "characters")],
          banner: [],
          reel: [file("cut", "reel"), file("cut2", "reel")],
          oracle: [],
        },
      }),
    );
    let dialog = await openSection("characters");
    openItem(dialog, "b.webp");
    fireEvent.click(within(dialog).getByRole("button", { name: "Set as active" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    dialog = await openSection("reel");
    openItem(dialog, "cut2.webp");
    fireEvent.click(within(dialog).getByRole("button", { name: "Set as active" }));
    await waitFor(() => expect(api.putJSON).toHaveBeenCalledTimes(2));
    expect(filesOf(savedBlock(0))).toEqual([{ name: "b.webp" }, { name: "a.webp" }]);
    expect(savedBlock(1)).toEqual({ slots: { reel_figure: "cut2" } });
  });
});

describe("the overlay STACK: a confirm over the gallery (review #5)", () => {
  it("Back cancels the CONFIRM and leaves the gallery standing; the next Back closes the gallery", async () => {
    // The regression: the confirm had no history entry, so the gallery's guard consumed the Back —
    // unmounting the gallery and leaving the alert dialog on screen with its captured trigger gone and
    // a promise nobody could resolve.
    api.getJSON.mockResolvedValue(index());
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MediaGallery ns="gacha" def={MEDIA_NS.gacha} />
        <ConfirmDialog />
      </QueryClientProvider>,
    );
    const dialog = await openSection("characters");
    openItem(dialog, "a.webp");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await screen.findByRole("alertdialog");

    history.back();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("dialog")).toBeTruthy(); // the gallery is still open behind it
    expect(api.del).not.toHaveBeenCalled(); // …and Back CANCELLED, it did not confirm

    history.back();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
