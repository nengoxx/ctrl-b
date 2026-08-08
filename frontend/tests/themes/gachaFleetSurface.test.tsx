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
vi.mock("../../src/hooks/useFleet", () => ({ useFleet: () => fleet.view }));
vi.mock("../../src/hooks/useMedia", () => ({ useMediaIndex: () => ({ data: undefined }) }));

import type { ComponentType } from "react";

import { setThemeSetting, setUI } from "../../src/store/ui";
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
 *  an artifact of the track having stayed the same. */
function DummyLayout({ hosts }: GachaTrackProps) {
  return <div data-testid="dummy-layout">{hosts.length}</div>;
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
    run: vi.fn(),
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
    // them), the banner intact, and the dossier still open on the same machine with its kit stamp held
    expect(container.querySelector("#tab-fleet")).toBe(tab);
    expect(container.querySelector("#gc-star-carve")).toBe(starDefs);
    expect(container.querySelector(".gc-banner")).not.toBeNull();
    expect(document.querySelector(".gc-dossier h2")?.textContent).toBe("atlas");
    expect(document.body.dataset.sheet).toBe("open");
  });

  it("an unknown stored layout degrades to capsule (the validated resolver, end to end)", () => {
    setThemeSetting("gacha", "fleetLayout", "not-a-layout");
    const { container } = render(<GachaFleet active />);
    expect(container.querySelector(".gc-track")).not.toBeNull();
  });
});
