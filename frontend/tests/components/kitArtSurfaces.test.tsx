import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The owner's PARENT-painted art on the surfaces that adopted it (the Kit Art System / Codex A2 + A5):
// service BANNERS on the kit's own Fleet rows and on cosmos's host-sheet rows, and the faded MACHINE
// picture behind cosmos's sheet.
//
// Unlike `ServiceIcon`, none of this is an element — it is a class plus a custom property on the surface's
// OWN node, so the obligations are different and worth their own suite:
//
//   present   — the class and the variable land on the row/sheet the adopter names;
//   absent    — NEITHER lands: no class, no inline style at all. That is what "dormant" means here, and it
//               is why the primitive returns `undefined` rather than an empty object;
//   ladder    — cosmos DEALS its bundled pool first and then overrides per service, so one drop changes
//               exactly its own row and every other row's dealt art is byte-identical (§A5's precedence
//               for a theme that has its own default for the same surface).
//
// The media hook is mocked rather than wrapped in a QueryClientProvider (the serviceIconSurfaces
// precedent), so these are DOM claims about the surfaces with no network policy in the way.

const media = vi.hoisted(() => ({ data: undefined as MediaIndex | undefined }));
vi.mock("../../src/hooks/useMedia", () => ({ useMediaIndex: () => media }));
const fleet = vi.hoisted((): { view: Record<string, unknown> } => ({ view: {} }));
vi.mock("../../src/hooks/useFleet", () => ({
  useFleet: () => fleet.view,
  useServerInfo: () => ({ data: { poll_seconds: 5 } }),
  useHosts: () => ({ data: [], isError: false }),
}));

import type { MediaFile, MediaIndex } from "../../src/hooks/useMedia";
import { KitFleet } from "../../src/theme-engine/kit/Fleet";
import { CosmosHostDetail } from "../../src/themes/cosmos/CosmosHostDetail";
import type { Host, Service } from "../../src/types";

const host: Host = {
  id: "alpha",
  name: "alpha",
  ip: "10.0.0.7",
  mac: null,
  ssh_username: null,
  ssh_port: 22,
  os_type: "linux",
  role: "workstation",
  tags: [],
  status: {
    host_id: "alpha",
    online: true,
    ping_ms: 9,
    last_seen: null,
    checked_at: "2026-01-01T00:00:00Z",
    error: null,
  },
};

const service = (id: string, over: Partial<Service> = {}): Service => ({
  id,
  host_id: "alpha",
  name: id,
  kind: null,
  port: 8096,
  path: "",
  autostart: false,
  url: `http://10.0.0.7:8096/${id}`,
  controls: [],
  status: { service_id: id, online: true, checked_at: "2026-01-01T00:00:00Z", error: null },
  ...over,
});

const art = (role: string, name: string, over: Partial<MediaFile> = {}): MediaFile => ({
  name,
  file: `${name}.png`,
  url: `/api/media/kit/files/${role}/${name}.png`,
  format: "png",
  size_bytes: 90_000,
  revision: `1:90000:${name}`,
  width: 1000,
  height: 300,
  unusable: false,
  unusable_reason: null,
  ...over,
});

/** What `art(role, name)` must actually paint: the mount URL plus the `?rev=` stamp every CSS-painted
 *  owner role carries, so an in-place overwrite repaints instead of leaving the decoded image (see
 *  `ownerArt.ts#ownerArtUrl`). */
const painted = (role: string, name: string, revision = `1:90000:${name}`) =>
  `url("/api/media/kit/files/${role}/${name}.png?rev=${encodeURIComponent(revision)}")`;

const index = (roles: Partial<Record<string, MediaFile[]>>): MediaIndex =>
  ({ ns: "kit", collation: "library-v1", roles, slots: {} }) as MediaIndex;

const run = async () => {};
const noop = () => {};

const kitFleet = (services: Service[]) => {
  fleet.view = {
    hosts: [host],
    svcByHost: new Map([[host.id, services]]),
    open: new Set([host.id]), // the kit row's services live in the EXPANDED body
    isLoading: false,
    error: null,
    busy: new Set(),
    run,
    toggleRow: noop,
  };
  return render(<KitFleet active />);
};

const cosmosSheet = (services: Service[]) =>
  render(<CosmosHostDetail host={host} services={services} busy={false} run={run} titleId="t" />);

/** `--kit-banner-img` off one row, or "" when the row carries no inline art. */
const bannerOf = (el: Element | null) =>
  (el as HTMLElement | null)?.style.getPropertyValue("--kit-banner-img") ?? "";

beforeEach(() => {
  media.data = undefined;
});
afterEach(cleanup);

describe("service banners · the kit's own Fleet rows", () => {
  it("paints the owner's banner on the row itself — class + variable, no extra element", () => {
    media.data = index({ "service-banners": [art("service-banners", "jellyfin")] });
    const { container } = kitFleet([service("s1", { name: "Media", kind: "jellyfin" })]);
    const row = container.querySelector(".srow")!;
    expect(row.classList.contains("kit-svc-banner")).toBe(true);
    expect(bannerOf(row)).toBe(painted("service-banners", "jellyfin"));
    // The art is a BACKGROUND of the row: nothing new inside it, so the row's content is untouched.
    expect(row.querySelectorAll("img")).toHaveLength(0);
  });

  it("an OFFLINE row takes the same class (its deeper veil is CSS, keyed on the row's own state)", () => {
    media.data = index({ "service-banners": [art("service-banners", "plex")] });
    const { container } = kitFleet([service("s1", { name: "plex", url: null, status: null })]);
    const row = container.querySelector(".srow.off")!;
    expect(row.classList.contains("kit-svc-banner")).toBe(true);
    expect(bannerOf(row)).toContain("plex.png");
  });

  it("no file ⇒ no class AND no inline style — the row that shipped before this slice", () => {
    media.data = index({ "service-banners": [] });
    const { container } = kitFleet([service("s1", { name: "grafana" })]);
    const row = container.querySelector(".srow")!;
    expect(row.classList.contains("kit-svc-banner")).toBe(false);
    expect(row.getAttribute("style")).toBeNull();
  });

  it("an UNUSABLE file paints nothing rather than a broken row", () => {
    media.data = index({
      "service-banners": [art("service-banners", "grafana", { unusable: true })],
    });
    const { container } = kitFleet([service("s1", { name: "grafana" })]);
    expect(container.querySelector(".srow")!.classList.contains("kit-svc-banner")).toBe(false);
  });
});

describe("service banners · cosmos DEALS its pool, then OVERRIDES per service", () => {
  const services = [
    service("s1", { name: "Media", kind: "jellyfin" }),
    service("s2", { name: "grafana" }),
    service("s3", { name: "ssh" }),
  ];

  it("with no owner files, every row carries a BUNDLED banner (byte-identical to before)", () => {
    media.data = index({ "service-banners": [] });
    const { container } = cosmosSheet(services);
    const rows = [...container.querySelectorAll(".hd-svc")];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.classList.contains("kit-svc-banner")).toBe(true); // the theme's own default art
      expect(bannerOf(row)).toMatch(/^url\(".+"\)$/);
    }
  });

  it("ONE drop changes exactly its own row — every other row keeps the art it was dealt", () => {
    // The reason the ladder is deal-then-override rather than deal-the-rest: excluding owner-bound
    // services from the deal would re-deal every position after them, so one file would silently move
    // art the owner never touched.
    media.data = index({ "service-banners": [] });
    const before = [...cosmosSheet(services).container.querySelectorAll(".hd-svc")].map(bannerOf);
    cleanup();

    media.data = index({ "service-banners": [art("service-banners", "jellyfin")] });
    const after = [...cosmosSheet(services).container.querySelectorAll(".hd-svc")].map(bannerOf);

    expect(after[0]).toBe(painted("service-banners", "jellyfin"));
    expect(after[0]).not.toBe(before[0]);
    expect(after.slice(1)).toEqual(before.slice(1)); // untouched, to the character
  });

  it("the override binds on the SERVICE identity (kind over name), like the icon does", () => {
    media.data = index({ "service-banners": [art("service-banners", "grafana")] });
    const rows = [...cosmosSheet(services).container.querySelectorAll(".hd-svc")].map(bannerOf);
    expect(rows[1]).toBe(painted("service-banners", "grafana"));
    expect(rows[0]).not.toContain("grafana"); // the kind-keyed row is untouched
  });
});

describe("machine pictures · cosmos's host sheet (the first adopter)", () => {
  it("paints the owner's picture for THIS machine on the sheet's own node", () => {
    media.data = index({ hosts: [art("hosts", "alpha")] });
    const { container } = cosmosSheet([service("s1")]);
    const sheet = container.querySelector(".cosmos-hd")!;
    expect(sheet.classList.contains("kit-host-art")).toBe(true);
    expect((sheet as HTMLElement).style.getPropertyValue("--kit-host-img")).toBe(
      painted("hosts", "alpha"),
    );
    // A DIFFERENT variable from the banner's, because custom properties inherit and this node is the
    // rows' ancestor — one shared name would leak the machine picture into every un-bannered row.
    expect((sheet as HTMLElement).style.getPropertyValue("--kit-banner-img")).toBe("");
  });

  it("a picture for ANOTHER machine, or none at all, leaves the sheet exactly as it was", () => {
    media.data = index({ hosts: [art("hosts", "vault")] });
    const other = cosmosSheet([service("s1")]).container.querySelector(".cosmos-hd")!;
    expect(other.classList.contains("kit-host-art")).toBe(false);
    expect(other.getAttribute("style")).toBeNull();
    cleanup();

    media.data = index({ hosts: [] });
    const none = cosmosSheet([service("s1")]).container.querySelector(".cosmos-hd")!;
    expect(none.classList.contains("kit-host-art")).toBe(false);
    expect(none.getAttribute("style")).toBeNull();
  });
});

describe("an OVERWRITE in place repaints — same URL, new bytes (Codex LOW)", () => {
  // The failure this pins: the owner replaces `hosts/alpha.png` (or a banner) over SSH under the same
  // name. The mount PATH cannot move for it — the SW's media route is keyed on the pathname, so a moving
  // URL would miss on every poll — which is exactly why the CSS-painted roles carry the file's `revision`
  // on the query string instead. Without it, nothing in the style changes and the surface keeps painting
  // the image it already decoded (`ServiceIcon` has an element to re-key; a background-image has not).
  //
  // The SAME tree is re-rendered in both arms, with a FACTORY element rather than one shared object:
  // React bails out of a subtree whose props are the very same object, and a remount would repaint
  // regardless and prove nothing either way.
  const sheet = (services: Service[]) => () => (
    <CosmosHostDetail host={host} services={services} busy={false} run={run} titleId="t" />
  );

  it("the machine picture behind the sheet", () => {
    media.data = index({ hosts: [art("hosts", "alpha")] });
    const element = sheet([service("s1")]);
    const r = render(element());
    const img = () =>
      r.container
        .querySelector<HTMLElement>(".cosmos-hd")!
        .style.getPropertyValue("--kit-host-img");
    expect(img()).toBe(painted("hosts", "alpha"));

    media.data = index({ hosts: [art("hosts", "alpha", { revision: "2:91000" })] });
    r.rerender(element());
    expect(img()).toBe(painted("hosts", "alpha", "2:91000"));
    expect(img()).toContain("/api/media/kit/files/hosts/alpha.png?rev="); // the mount path is unmoved
  });

  it("…and a service banner on the row", () => {
    const svc = [service("s1", { name: "Media", kind: "jellyfin" })];
    media.data = index({ "service-banners": [art("service-banners", "jellyfin")] });
    const element = sheet(svc);
    const r = render(element());
    expect(bannerOf(r.container.querySelector(".hd-svc"))).toBe(
      painted("service-banners", "jellyfin"),
    );

    media.data = index({
      "service-banners": [art("service-banners", "jellyfin", { revision: "2:91000" })],
    });
    r.rerender(element());
    expect(bannerOf(r.container.querySelector(".hd-svc"))).toBe(
      painted("service-banners", "jellyfin", "2:91000"),
    );
  });
});
