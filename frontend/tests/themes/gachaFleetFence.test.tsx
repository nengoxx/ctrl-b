import { cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// THE CAPSULE EQUALITY FENCE (GACHA_PLAN §12.6, slice E0 — Codex's pre-extraction requirement). E0 moves the
// capsule track body out of `GachaFleet` and behind the new fleet Surface, and the whole slice's contract is
// that NOTHING the user can see or a screen reader can hear changes. That claim is only checkable against a
// record taken BEFORE the extraction, so this file is committed FIRST, green on the unrefactored code, and
// re-run afterwards: two frozen snapshots of the settled fleet — the full DOM, attribute for attribute, and
// the role/name accessibility list the DOM produces.
//
// If a snapshot needs regenerating after the extraction, the extraction is wrong. Fix the extraction, never
// the snapshot (the E0 brief's law).
//
// The fixture idiom is `gachaFleet.test.tsx`'s: `useFleet` is mocked to a fixed FleetView and the media index
// to the fresh-install state (no owner files ⇒ the bundled art), so the record is of the BODY's own markup and
// not of the query layer.

const fleet = vi.hoisted(() => {
  const view: Record<string, unknown> = {};
  return { view };
});
vi.mock("../../src/hooks/useFleet", () => ({ useFleet: () => fleet.view }));
vi.mock("../../src/hooks/useMedia", () => ({ useMediaIndex: () => ({ data: undefined }) }));

import { setUI } from "../../src/store/ui";
import { GachaFleet } from "../../src/themes/gacha/GachaFleet";
import type { Host, HostServiceCfg } from "../../src/types";

/** N CONFIGURED services — the card's star input (`starsFor`), so the fixture exercises more than one rung. */
const cfg = (n: number): HostServiceCfg[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `s${i}`,
    kind: null,
    port: null,
    path: "/",
    autostart: false,
    cmd: {},
  }));

const host = (id: string, online: boolean, services: number): Host => ({
  id,
  name: id,
  ip: "10.0.0.7",
  mac: null,
  ssh_username: null,
  ssh_port: 22,
  os_type: "linux",
  role: "workstation",
  tags: [],
  services: cfg(services),
  status: {
    host_id: id,
    online,
    ping_ms: online ? 18 : null,
    last_seen: null,
    checked_at: "2026-01-01T00:00:00Z",
    error: null,
  },
});

// FOUR hosts, so the track carries all three capsule shapes at once (`cardShapes(4)` = feat · pair · pair ·
// wide — the prototype's own arrangement) plus both liveness skins. That is the widest single render of the
// track body, which is exactly what the fence wants to hold still.
const HOSTS = [
  host("pegasus", true, 3),
  host("atlas", false, 1),
  host("vault", true, 5),
  host("relay", false, 0),
];

beforeEach(() => {
  setUI({ theme: "gacha", tab: "fleet", motion: "full", themeSettings: {} });
  fleet.view = {
    hosts: HOSTS,
    svcByHost: new Map(),
    run: vi.fn(),
    busy: new Set<string>(),
    isLoading: false,
    error: null,
    hasData: true,
    svcHasData: true,
    svcLoading: false,
    svcError: null,
  };
  // The `NEW` ribbon's host is a RANDOM pick that sticks (`pickRibbonHost`), so the fixture pins the roll —
  // otherwise the ribbon hops between cards and the DOM record is not a record of anything.
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  // `finally`, so a throwing `cleanup()` cannot leave `Math.random` stubbed for the rest of the run — a
  // global that stayed pinned would silently freeze the ribbon roll in every other suite.
  try {
    cleanup();
  } finally {
    vi.restoreAllMocks();
  }
});

/** React's `useId` values (`GachaFleet` labels the dossier sheet with one) encode a per-root counter, so they
 *  are stable for a given render but say nothing about the markup under test. Normalized rather than frozen,
 *  so the fence measures the DOM and not React's id allocator. */
const normalizeIds = (html: string): string => html.replace(/«r[0-9a-z]+»|:r[0-9a-z]+:/g, "«rID»");

/** The roles the fleet's markup can produce. `queryAllByRole` computes the same implicit/explicit roles the
 *  a11y tree does, so this walk is the tree — read per role (stable order) rather than in document order. */
const ROLES = [
  "tabpanel",
  "heading",
  "button",
  "img",
  "link",
  "dialog",
  "tablist",
  "tab",
  "list",
  "listitem",
  "group",
  "region",
  "status",
] as const;

/** One node's accessible NAME, near enough for a fence: the explicit label, else the text its
 *  `aria-labelledby` points at, else its own trimmed text. (The full accname algorithm lives in the axe scan
 *  — `e2e/a11y.spec.ts` — which is where a real conformance claim belongs; here the point is that the list
 *  cannot change silently.) */
function accName(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label) return label;
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const target = by
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (target.trim()) return target.replace(/\s+/g, " ").trim();
  }
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

function a11yTree(container: HTMLElement): string[] {
  const scope = within(container);
  return ROLES.flatMap((role) =>
    scope
      .queryAllByRole(role, { hidden: true })
      .map((el) => `${role} :: ${normalizeIds(accName(el))}`),
  );
}

describe("the capsule fleet — E0 equality fence", () => {
  it("renders a frozen DOM + a11y tree in its settled loaded state", () => {
    // ONE render for both records: `useId`'s counter is per module instance, so a second render in this file
    // would shift the ids — and the fence is about the markup, not about how many times it was built.
    const { container } = render(<GachaFleet active />);
    expect(normalizeIds(container.innerHTML)).toMatchSnapshot("dom");
    expect(a11yTree(container)).toMatchSnapshot("a11y");
  });
});
