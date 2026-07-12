import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FrontierFleet ↔ F3 sheet wiring (the part frontierHostDetail.test.tsx can't see: selection → open sheet).
// `useFleet` is mocked to a fixed FleetView (the App.test.tsx harness pattern) so this exercises ONLY the
// wiring: a selected rig renders the host-detail content with the SAME art/plate presentation as the card.
//
// REGRESSION GUARD (F3 review): `placements` must stay identity-stable across renders (useMemo on `hosts`) —
// the `displayP` retention effect keys on a placement's identity, so a per-render rebuild loops
// (setDisplayP → render → new placement → effect …) and React throws "Maximum update depth exceeded".
// Mounting with a selection is exactly the case that loop lives in; this test failing with that error means
// the memo was dropped.

const fleet = vi.hoisted(() => {
  const view: Record<string, unknown> = {};
  return { view };
});
vi.mock("../../src/hooks/useFleet", () => ({ useFleet: () => fleet.view }));

import { FrontierFleet } from "../../src/themes/frontier/FrontierFleet";
import { setFrontierSelection } from "../../src/store/frontierSelection";
import type { Host } from "../../src/types";

const host = (id: string, online: boolean): Host => ({
  id,
  name: id,
  ip: "10.0.0.7",
  mac: "aa:bb:cc:dd:ee:ff",
  ssh_username: null,
  ssh_port: 22,
  os_type: "linux",
  role: "workstation",
  tags: [],
  status: {
    host_id: id,
    online,
    ping_ms: online ? 12 : null,
    last_seen: null,
    checked_at: "2026-01-01T00:00:00Z",
    error: null,
  },
});

beforeEach(() => {
  fleet.view = {
    hosts: [host("pegasus", true), host("atlas", false)],
    svcByHost: new Map(),
    run: vi.fn(),
    busy: new Set<string>(),
    isLoading: false,
    error: null,
  };
});
afterEach(() => {
  setFrontierSelection(null);
  cleanup();
});

describe("FrontierFleet F3 sheet wiring", () => {
  it("no selection → no sheet (the BottomSheet stays unmounted)", () => {
    const { container } = render(<FrontierFleet active />);
    expect(container.querySelector(".bs-sheet")).toBeNull();
    expect(container.querySelector(".frontier-hd")).toBeNull();
  });

  it("selected rig → sheet content renders the card's presentation (name/plate); no render loop", () => {
    setFrontierSelection("pegasus");
    const { container } = render(<FrontierFleet active />);
    const hd = container.querySelector(".frontier-hd");
    expect(hd).not.toBeNull();
    // the h2 the sheet's aria-labelledby points at — the host name
    expect(screen.getByRole("heading", { name: "pegasus" })).toBeTruthy();
    // the same plate present() gives the rig card (pegasus, index 0 → 0xPEG01)
    expect(hd?.querySelector(".plate")?.textContent).toBe("0xPEG01");
    // the composer-hide hook is set while open
    expect(document.body.dataset.sheet).toBe("open");
  });

  it("map ground tap clears the selection (a beacon tap does not)", () => {
    setFrontierSelection("pegasus");
    const { container } = render(<FrontierFleet active />);
    // a tap on the map art (not a beacon) → empty ground → selection cleared, sheet closing
    fireEvent.click(container.querySelector(".frontier-map .pic")!);
    expect(document.body.dataset.sheet).toBeUndefined();
    // fresh selection via the beacon itself — the ground-clear must NOT swallow it (closest check)
    fireEvent.click(container.querySelector(".frontier-beacon")!);
    expect(document.body.dataset.sheet).toBe("open");
  });

  it("Escape closes from ANYWHERE — focus never enters the non-modal sheet (the F3 audit fix)", () => {
    setFrontierSelection("pegasus");
    render(<FrontierFleet active />);
    expect(document.body.dataset.sheet).toBe("open");
    // keydown on document.body — focus still sits on the trigger outside .bs-root (non-modal, no focus steal)
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(document.body.dataset.sheet).toBeUndefined();
  });

  it("the exit slide overshoots fully-closed so the skin shadow rides out with it", () => {
    setFrontierSelection("pegasus");
    const { container } = render(<FrontierFleet active />);
    const sheet = container.querySelector<HTMLElement>(".bs-sheet")!;
    fireEvent.keyDown(document.body, { key: "Escape" });
    // jsdom heights are 0, so the exit target is exactly the clearance: without the overshoot the sheet
    // would rest flush with the viewport bottom and its upward box-shadow would hover over the tab bar
    // until unmount POPS it (the owner-reported artifact).
    expect(sheet.style.transform).toBe("translateY(80px)");
  });

  it("a CONSUMED (defaultPrevented) Escape leaves the sheet open — the modal-layer guard", () => {
    setFrontierSelection("pegasus");
    render(<FrontierFleet active />);
    // a modal layer above the sheet (ConfirmDialog et al) preventDefaults the Escape it consumes; the
    // sheet's document listener must honor that and NOT also close (cooperative dismissal).
    document.body.addEventListener("keydown", (e) => e.preventDefault(), { once: true });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(document.body.dataset.sheet).toBe("open");
  });
});
