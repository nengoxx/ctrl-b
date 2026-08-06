import { cleanup, fireEvent, render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The owner SERVICE ICON on all FIVE service-row surfaces (D53 M3 / MEDIA_PLAN §9 — "automated across
// ALL FIVE renderers, not eyeball-only").
//
// One `ServiceIcon` owns the degrade logic and the five surfaces only PLACE it, so the obligation is a
// matrix rather than five bespoke suites: for each surface, the same four claims.
//
//   present     — the owner's file paints, from the mount URL the index gave;
//   absent      — no icon means no element at all: the row is the one that shipped before M3;
//   broken      — an <img> that fails LATCHES (it does not sit there torn, and it is not retried);
//   replacement — …and the latch RELEASES when the bytes change under the same URL, which is the owner's
//                 usual repair (overwrite the file) and the whole reason the latch is keyed on
//                 (url, revision) rather than on the URL.
//
// The media hook is mocked rather than wrapped in a QueryClientProvider (the frontierFleetSheet
// precedent), so these are DOM claims about the surfaces, with no network policy in the way.

const media = vi.hoisted(() => ({ data: undefined as MediaIndex | undefined }));
vi.mock("../../src/hooks/useMedia", () => ({ useMediaIndex: () => media }));
// KitFleet is the one surface that fetches its own data; the others take props. `useServerInfo` is
// stubbed too because the kit adapter imports it from this module for the GALLERY's key derivation
// (never called on a render path).
const fleet = vi.hoisted((): { view: Record<string, unknown> } => ({ view: {} }));
vi.mock("../../src/hooks/useFleet", () => ({
  useFleet: () => fleet.view,
  useServerInfo: () => ({ data: { poll_seconds: 5 } }),
}));

import type { MediaFile, MediaIndex } from "../../src/hooks/useMedia";
import { KitFleet } from "../../src/theme-engine/kit/Fleet";
import { CosmosHostDetail } from "../../src/themes/cosmos/CosmosHostDetail";
import { FrontierHostDetail } from "../../src/themes/frontier/FrontierHostDetail";
import { GachaHostDetail } from "../../src/themes/gacha/GachaHostDetail";
import { DeviceRow } from "../../src/themes/vapor/DeviceRow";
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

/** One service with a KIND — so the arms also prove the surfaces bind on `keyFor`'s first choice. */
const service: Service = {
  id: "alpha.media",
  host_id: "alpha",
  name: "Media",
  kind: "jellyfin",
  port: 8096,
  path: "",
  autostart: false,
  url: "http://10.0.0.7:8096",
  controls: [],
  status: {
    service_id: "alpha.media",
    online: true,
    checked_at: "2026-01-01T00:00:00Z",
    error: null,
  },
};

const ICON_URL = "/api/media/kit/files/services/jellyfin.png";
/** What the `<img>` actually points at: the mount URL plus the `?rev=` stamp every owner-art consumer
 *  carries (`ownerArt.ts#ownerArtUrl`), so an in-place overwrite is not answered from the HTTP/SW cache. */
const src = (revision: string) => `${ICON_URL}?rev=${encodeURIComponent(revision)}`;

const iconFile = (revision: string): MediaFile => ({
  name: "jellyfin",
  file: "jellyfin.png",
  url: ICON_URL,
  format: "png",
  size_bytes: 4_000,
  revision,
  width: 64,
  height: 64,
  unusable: false,
  unusable_reason: null,
});

const withIcon = (revision = "1:4000"): MediaIndex => ({
  ns: "kit",
  collation: "casefold-natural",
  roles: { services: [iconFile(revision)] },
  slots: {},
});

const EMPTY: MediaIndex = {
  ns: "kit",
  collation: "casefold-natural",
  roles: { services: [] },
  slots: {},
};

const noop = () => {};
const run = async () => {};

fleet.view = {
  hosts: [host],
  svcByHost: new Map([[host.id, [service]]]),
  open: new Set([host.id]), // the kit row's services live in the EXPANDED body
  isLoading: false,
  error: null,
  busy: new Set(),
  run,
  toggleRow: noop,
};

/** The five surfaces, each built the way its owner builds it, plus the selector for ITS service row.
 *  An ELEMENT factory rather than a `render` call, so an arm can re-render the same tree — which is what
 *  the latch-release arm needs: a remount would reset the latch and prove nothing. */
const SURFACES: { name: string; row: string; element: () => ReactElement }[] = [
  { name: "kit Fleet", row: ".srow", element: () => <KitFleet active /> },
  {
    name: "vapor DeviceRow",
    row: ".svc-row",
    element: () => (
      <DeviceRow
        host={host}
        services={[service]}
        index={0}
        featured={false}
        open
        busy={false}
        onToggle={noop}
        onAction={noop}
      />
    ),
  },
  {
    name: "cosmos host detail",
    row: ".hd-svc",
    element: () => (
      <CosmosHostDetail host={host} services={[service]} busy={false} run={run} titleId="t" />
    ),
  },
  {
    name: "frontier host detail",
    row: ".svc",
    element: () => (
      <FrontierHostDetail
        host={host}
        services={[service]}
        art="/art.png"
        plate="ALPHA"
        busy={false}
        run={run}
        titleId="t"
      />
    ),
  },
  {
    name: "gacha host detail",
    row: ".gc-svc",
    element: () => (
      <GachaHostDetail
        host={host}
        services={[service]}
        art={null}
        mode="five"
        busy={false}
        run={run}
        titleId="t"
      />
    ),
  },
];

beforeEach(() => {
  media.data = undefined;
});
afterEach(cleanup);

describe.each(SURFACES)("service icons · $name", ({ row, element }) => {
  /** The service row's own images — the icon is the only one any of the five puts inside a row. */
  const imgsIn = (r: RenderResult) => [...r.container.querySelectorAll(`${row} img`)];
  const iconIn = (r: RenderResult) => r.container.querySelector(`${row} img.kit-svcicon`);

  it("paints the owner's file for a service whose KIND names it", () => {
    media.data = withIcon();
    const icon = iconIn(render(element()));
    expect(icon?.getAttribute("src")).toBe(src("1:4000"));
    // Decorative: the row already carries the service NAME as text (§5).
    expect(icon?.getAttribute("alt")).toBe("");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders NOTHING when the owner has dropped no file — the row that shipped before M3", () => {
    media.data = EMPTY;
    expect(imgsIn(render(element()))).toHaveLength(0);
  });

  it("…and nothing while the index has not answered, or cannot", () => {
    // Silent degrade: an unreachable `/api/media/kit` is `undefined` data, which is the icon-less row.
    media.data = undefined;
    expect(imgsIn(render(element()))).toHaveLength(0);
  });

  it("LATCHES a broken icon: it leaves the row, and a re-render does not put it back", () => {
    media.data = withIcon();
    const r = render(element());
    fireEvent.error(iconIn(r)!);
    expect(imgsIn(r)).toHaveLength(0);
    // Same (url, revision) = the same broken file: it is never retried.
    r.rerender(element());
    expect(imgsIn(r)).toHaveLength(0);
  });

  it("RELEASES the latch when the bytes change under the same URL (an in-place repair)", () => {
    media.data = withIcon("1:4000");
    const r = render(element());
    fireEvent.error(iconIn(r)!);
    expect(imgsIn(r)).toHaveLength(0);

    // The owner overwrites `jellyfin.png`: the mount PATH is unchanged (it must be — the SW's media route
    // is keyed on it), and only `revision` says the bytes are new — which is what both the latch key and
    // the `?rev=` on the src are made of. SAME tree, so the latch is the one that was tripped a moment
    // ago — a remount here would reset it and prove nothing.
    media.data = withIcon("2:5000");
    r.rerender(element());
    expect(iconIn(r)?.getAttribute("src")).toBe(src("2:5000"));
  });

  it("a LATE error from the replaced revision cannot latch the repaired one (Codex M3 MED-2)", () => {
    // The race: revision A's request is still outstanding when B's props arrive. The mount PATH is
    // stable across a repair, so without a `key` React would re-use the same <img> — and A's later
    // `error` would fire the UPDATED handler, latching B and hiding a picture that is perfectly good.
    // (Still the arm that pins it: the latch is keyed on the identity, not on the src spelling.)
    media.data = withIcon("1:4000");
    const r = render(element());
    const stale = iconIn(r)!;

    media.data = withIcon("2:5000");
    r.rerender(element());
    fireEvent.error(stale); // A's load fails, late

    expect(iconIn(r)?.getAttribute("src")).toBe(src("2:5000"));
    // …and B's OWN failure still latches: the fix detaches the stale request, it does not disarm the latch.
    fireEvent.error(iconIn(r)!);
    expect(imgsIn(r)).toHaveLength(0);
  });
});
