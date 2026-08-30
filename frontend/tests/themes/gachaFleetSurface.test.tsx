import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The FLEET SURFACE under gacha (GACHA_PLAN §12.6 E0, ruling 1) — the property the whole split exists to
// protect: a fleet LAYOUT swap replaces the track body and NOTHING else. `GachaFleet` owns the dossier, the
// View-Transition morph generations, the art showcase and the banner; if a swap remounted it, a settled
// dossier would vanish and every one of those refs would reset. So the swap is driven for real here, with a
// second variant registered for the length of the test.
//
// E0 ships the seam with NO `fleetLayout` settings row (§12.6: "no lying options" — the setting is declared
// at E1, with `poster`, the first value that names something). Driving the resolver therefore means lending
// gacha the declaration too: both the dummy variant and the borrowed spec row are removed afterwards, so no
// other test ever sees either.

const fleet = vi.hoisted(() => {
  const view: Record<string, unknown> = {};
  return { view };
});
// The static view carries every fact but ONE: `pending` is read from the REAL `store/fleetPending`
// (2026-08-30) — `GachaFleet` derives its WAKING set from it, so a frozen stand-in would be a second,
// drifting source for a fact the store owns.
vi.mock("../../src/hooks/useFleet", async () => {
  const { usePendingFleet } = await import("../../src/store/fleetPending");
  return { useFleet: () => ({ ...fleet.view, pending: usePendingFleet() }) };
});
vi.mock("../../src/hooks/useMedia", () => ({ useMediaIndex: () => ({ data: undefined }) }));

import type { ComponentType } from "react";

import { reconcilePending } from "../../src/store/fleetPending";
import { setThemeSetting, setUI } from "../../src/store/ui";
import { dispatchingRun } from "./fleetRunMock";
import { registry } from "../../src/theme-engine/registry";
import type { ThemeSettingField } from "../../src/theme-engine/types";
import { GachaFleet } from "../../src/themes/gacha/GachaFleet";
import { fleetSurface } from "../../src/themes/gacha/fleetSurface";
import type { GachaTrackProps } from "../../src/themes/gacha/GachaTrack";
import type { Host } from "../../src/types";

const host = (id: string, online: boolean): Host => ({
  id,
  name: id,
  ip: "10.0.0.7",
  mac: null,
  ssh_username: null,
  ssh_port: 22,
  os_type: "linux",
  role: "workstation",
  tags: [],
  status: {
    host_id: id,
    online,
    ping_ms: online ? 18 : null,
    last_seen: null,
    checked_at: "2026-01-01T00:00:00Z",
    error: null,
  },
});

/** A stand-in second layout: it renders none of the capsule markup, so "the dossier is still open" cannot be
 *  an artifact of the track having stayed the same. It DOES seat the banner, because since E2 that is part
 *  of the contract every variant implements (§12.6 ruling 7) — a layout that dropped it would be testing a
 *  shape no real variant has. */
function DummyLayout({ hosts, banner }: GachaTrackProps) {
  return (
    <div data-testid="dummy-layout">
      {banner}
      {hosts.length}
    </div>
  );
}

const GACHA = registry.gacha!;

// The two registry slots this file borrows, snapshotted BEFORE each mutation and RESTORED after — not
// deleted. Restore rather than delete because E1 declares a real `fleetLayout` row and registers real
// variants: a teardown that deleted would then quietly strip them for every later test in the run. Both
// restores sit in a `finally`, so a throwing `cleanup()` (an unmount error, a leaked listener) cannot leave
// the app's registries carrying this file's fixtures.
let priorVariant: ComponentType<GachaTrackProps> | undefined;
let priorSpec: ThemeSettingField | undefined;
const restore = (key: string, prior: unknown, target: Record<string, unknown>) => {
  if (prior === undefined) delete target[key];
  else target[key] = prior;
};

beforeEach(() => {
  setUI({ theme: "gacha", tab: "fleet", motion: "full", themeSettings: {} });
  fleet.view = {
    hosts: [host("pegasus", true), host("atlas", false)],
    svcByHost: new Map(),
    // Begins the pending record at dispatch and resolves ok, like the real `run` — see `fleetRunMock`.
    run: dispatchingRun(),
    busy: new Set<string>(),
    isLoading: false,
    error: null,
    hasData: true,
    svcHasData: true,
    svcLoading: false,
    svcError: null,
  };
  priorVariant = fleetSurface.variants.dummy;
  priorSpec = GACHA.settings!.fleetLayout;
  fleetSurface.register("dummy", DummyLayout);
  // the E1-shaped declaration, borrowed: the resolver validates against the theme's own option list, so an
  // undeclared value could never resolve to a variant (D31's per-theme capability list)
  GACHA.settings!.fleetLayout = {
    type: "seg",
    label: "Fleet layout",
    options: [
      { val: "capsule", label: "Capsule" },
      { val: "dummy", label: "Dummy" },
    ],
    default: "capsule",
  };
});
afterEach(() => {
  try {
    cleanup();
  } finally {
    restore("dummy", priorVariant, fleetSurface.variants);
    restore("fleetLayout", priorSpec, GACHA.settings!);
    setUI({ themeSettings: {} });
    // …and the pending store, module state with real timers behind it, goes back to empty the same way
    // every other gacha fleet suite resets it: a reconcile against an empty fleet.
    reconcilePending([]);
  }
});

describe("the fleet surface under gacha", () => {
  it("resolves to the CAPSULE track with nothing stored (the seeded default + fallback)", () => {
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".gc-track")).not.toBeNull();
    expect(container.querySelector("[data-testid=dummy-layout]")).toBeNull();
  });

  it("a layout swap replaces the TRACK BODY without remounting GachaFleet or closing a settled dossier", () => {
    const { container } = render(<GachaFleet active />);
    const tab = container.querySelector("#tab-fleet");
    const starDefs = container.querySelector("#gc-star-carve");

    act(() => {
      fireEvent.click(container.querySelectorAll<HTMLElement>(".gc-card")[1]);
    });
    expect(document.querySelector(".gc-dossier h2")?.textContent).toBe("atlas");
    expect(document.body.dataset.sheet).toBe("open");

    act(() => {
      setThemeSetting("gacha", "fleetLayout", "dummy");
    });

    // the swap really happened — the capsule markup is gone, the stand-in is up
    expect(container.querySelector("[data-testid=dummy-layout]")).not.toBeNull();
    expect(container.querySelector(".gc-track")).toBeNull();
    expect(container.querySelector(".gc-track-head")).toBeNull();
    // …and everything OUTSIDE the track body stood still: same DOM nodes (a remount would have rebuilt
    // them), and the dossier still open on the same machine with its kit stamp held
    expect(container.querySelector("#tab-fleet")).toBe(tab);
    expect(container.querySelector("#gc-star-carve")).toBe(starDefs);
    expect(document.querySelector(".gc-dossier h2")?.textContent).toBe("atlas");
    expect(document.body.dataset.sheet).toBe("open");
    // The BANNER is the one thing that legitimately moves (§12.6 ruling 7, E2): it is a SLOT now, so a
    // layout swap REPARENTS it into the new variant's tree and React remounts it. It is still there and
    // still exactly one — an accepted, signed cost (autoplay/slide state resets), and the invariant that
    // matters is that nothing leaks, which `gachaCover.test.tsx` holds with a timer-count assertion.
    expect(container.querySelectorAll(".gc-banner")).toHaveLength(1);
    expect(container.querySelector("[data-testid=dummy-layout] .gc-banner")).not.toBeNull();
  });

  it("an unknown stored layout degrades to capsule (the validated resolver, end to end)", () => {
    setThemeSetting("gacha", "fleetLayout", "not-a-layout");
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".gc-track")).not.toBeNull();
  });
});

// ── THE SAME SWAP, ON THE REAL VARIANTS (GACHA_PLAN §12.6 slice E4, pin ⑯). The case above proves the
//    CONTRACT with a stand-in whose markup shares nothing with capsule's — which is why it stays: it is the
//    only shape in which "the dossier survived" cannot be an artifact of the track having stayed put. What
//    it cannot prove is that the three SHIPPED layouts satisfy it, and they are the ones the owner swaps
//    between: each mounts its own ceremony hook, its own refs and (cover) its own layout effects, and any
//    of those could have been given a key that re-keys the body around them.
//
//    So this walks the real catalog end to end — capsule -> poster -> cover, the picker's own order — with a
//    dossier SETTLED before the first swap. What is asserted about the dossier is only what is real: it is
//    `GachaFleet`'s own sheet, a SIBLING of the track body, so it is the SAME NODE across both swaps and
//    still describes the machine it was opened on. The layouts' own selection is asserted beside it,
//    because the two are genuinely independent here — the capsule card that opened the dossier does not
//    route through the alt layouts' pick, so `atlas` holds the sheet while `pegasus` (host[0], the resolved
//    default pick) is what the poster's slice and the cover's hero mark as selected.
//
//    NO cross-layout MORPH assertion: the morph is capsule/poster's (§12.6 ruling 5②, as amended), the
//    cover opens plain, and a swap is not an open.
describe("the fleet surface under gacha — the REAL registered variants", () => {
  beforeEach(() => {
    // The suite above lends gacha a capsule+dummy declaration; these cases need the SHIPPED row, whose
    // options are the three real layouts. `priorSpec` is that row, snapshotted before the loan.
    GACHA.settings!.fleetLayout = priorSpec!;
  });

  it("capsule -> poster -> cover swaps the TRACK BODY only — no remount, and the settled dossier stands", () => {
    const { container } = render(<GachaFleet active />);
    const tab = container.querySelector("#tab-fleet");
    const starDefs = container.querySelector("#gc-star-carve");
    const live = container.querySelector(".gc-live");
    // …the markers themselves exist, so a later `toBe(marker)` cannot pass on two nulls.
    for (const node of [tab, starDefs, live]) expect(node).not.toBeNull();

    act(() => {
      fireEvent.click(container.querySelectorAll<HTMLElement>(".gc-card")[1]);
    });
    const sheet = document.querySelector(".gc-dossier");
    expect(sheet?.querySelector("h2")?.textContent).toBe("atlas");
    expect(document.body.dataset.sheet).toBe("open");

    /** Everything OUTSIDE the track body stood still — the same nodes a remount would have rebuilt, and
     *  the same dossier, still open on the machine it was opened for. */
    const expectFleetStood = (layout: string): void => {
      expect(container.querySelector("#tab-fleet"), layout).toBe(tab);
      expect(container.querySelector("#gc-star-carve"), layout).toBe(starDefs);
      expect(container.querySelector(".gc-live"), layout).toBe(live);
      expect(document.querySelector(".gc-dossier"), layout).toBe(sheet);
      expect(sheet!.querySelector("h2")!.textContent, layout).toBe("atlas");
      expect(document.body.dataset.sheet, layout).toBe("open");
      expect(container.querySelectorAll(".gc-banner"), layout).toHaveLength(1);
    };

    act(() => {
      setThemeSetting("gacha", "fleetLayout", "poster");
    });
    // THE POSTER is really up: one sheared slice per machine inside the `.po-body` column, and the capsule
    // grid and its head are gone with the body they belonged to.
    expect(container.querySelectorAll(".po-body .po-poster .po-slice")).toHaveLength(2);
    expect(container.querySelector(".gc-track")).toBeNull();
    // …its own selection is host[0], the RESOLVED pick — not the machine holding the dossier.
    expect(
      container.querySelectorAll<HTMLElement>(".po-slice")[0].getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      container.querySelectorAll<HTMLElement>(".po-slice")[1].getAttribute("aria-pressed"),
    ).toBe("false");
    expectFleetStood("poster");

    act(() => {
      setThemeSetting("gacha", "fleetLayout", "cover");
    });
    // THE COVER is really up: the fixed frame, its masthead heading, one hero card and the rest as cut-ins
    // in the side stack — and the poster's column is gone.
    expect(container.querySelector(".cv-frame h1.cv-mast")).not.toBeNull();
    const heroCards = container.querySelectorAll<HTMLElement>(".cv-heroslot .cv-card.is-hero");
    expect(heroCards).toHaveLength(1);
    expect(heroCards[0].dataset.gcHost).toBe("pegasus"); // the same resolved pick the poster marked
    expect(heroCards[0].getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll(".cv-stack .cv-card.is-cut")).toHaveLength(1);
    expect(container.querySelector(".po-poster")).toBeNull();
    // …and the banner rides into the cover's STRAPLINE seat, which is where this composition prints it.
    expect(container.querySelector(".cv-strap .gc-banner")).not.toBeNull();
    expectFleetStood("cover");
  });
});
