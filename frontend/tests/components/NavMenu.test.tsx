import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NavHome, NavMenu } from "../../src/components/NavMenu";
import { getUI, setUI } from "../../src/store/ui";

// NavMenu collapse ladder + the NavHome quick-jump (F0 follow-up, 2026-07-12). Both are pure `useSections`
// consumers, so — like NavBar.test — these drive the REAL `ui` store (setUI) and assert what the user sees.
// `minimal` supports every preset, so an explicit layout/appbarMode pick is honored (vapor would coerce).

beforeEach(() => {
  // Reset every lever these components read (module state persists between cases) — including the
  // D70 §8.4a satellite placements, which decide whether the gallery is in the menu at all.
  setUI({
    theme: "minimal",
    tab: "fleet",
    layout: "auto",
    appbarMode: "visible",
    sectionPlacement: {},
  });
});

afterEach(cleanup);

describe("NavMenu collapse ladder", () => {
  it("menu of one → a DIRECT section button (no popover semantics), labelled by the section", () => {
    // 4-tab + the gallery PROMOTED to `button` (D70 §8.4a): the curated four stand on the bar and the
    // gallery is the one off-bar section — the state that exercises the menu-of-one rung.
    setUI({ layout: "4-tab", sectionPlacement: { agents: "button" } });
    const { container } = render(<NavMenu />);

    const btn = container.querySelector<HTMLButtonElement>(".navmenu-launch");
    expect(btn).not.toBeNull();
    expect(btn?.classList.contains("navmenu-direct")).toBe(true);
    expect(btn?.getAttribute("aria-label")).toBe("agents"); // the section's lbl, not "Navigation menu"
    // The direct form is NOT a menu: no popover affordances, no popover node.
    expect(container.querySelector("[aria-haspopup]")).toBeNull();
    expect(btn?.getAttribute("aria-expanded")).toBeNull();
    expect(container.querySelector(".navmenu-pop")).toBeNull();
  });

  it("menu of one, active ON that section → marked as the current location", () => {
    // standing on the lone off-bar section (the `button` placement is what puts it there)
    setUI({ layout: "4-tab", tab: "agents", sectionPlacement: { agents: "button" } });
    const { container } = render(<NavMenu />);

    const btn = container.querySelector<HTMLButtonElement>(".navmenu-direct");
    expect(btn?.getAttribute("aria-current")).toBe("page");
    expect(btn?.classList.contains("active")).toBe(true);
  });

  it("menu of one → clicking navigates straight to the section", () => {
    setUI({ layout: "4-tab", sectionPlacement: { agents: "button" } });
    const { container } = render(<NavMenu />);
    fireEvent.click(container.querySelector<HTMLButtonElement>(".navmenu-direct")!);
    // `agents` is off-bar and UNHOSTED → the plain navigate branch, no coercion.
    expect(getUI().tab).toBe("agents");
  });

  it("menu of many → the orbit LAUNCHER with popover semantics (unchanged by the ladder)", () => {
    setUI({ appbarMode: "minimal" }); // bar = [], menu = the four unhosted sections
    const { container } = render(<NavMenu />);

    const btn = container.querySelector<HTMLButtonElement>(".navmenu-launch");
    expect(btn?.getAttribute("aria-haspopup")).toBe("menu");
    expect(btn?.getAttribute("aria-label")).toBe("Navigation menu");
    expect(btn?.classList.contains("navmenu-direct")).toBe(false); // launcher, not the direct form
  });
});

describe("NavHome quick-jump", () => {
  it("minimal + off the primary section → visible, labelled by + navigating to the primary", () => {
    setUI({ appbarMode: "minimal", tab: "agent" }); // primary = fleet (sections[0]); standing on agent
    const { container } = render(<NavHome appbarMode="minimal" />);

    const btn = container.querySelector<HTMLButtonElement>(".navhome");
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("aria-label")).toBe("fleet");
    fireEvent.click(btn!);
    expect(getUI().tab).toBe("fleet"); // jumped home
  });

  it("hidden while ON the primary section (no clutter)", () => {
    setUI({ appbarMode: "minimal", tab: "fleet" });
    const { container } = render(<NavHome appbarMode="minimal" />);
    expect(container.querySelector(".navhome")).toBeNull();
  });

  it("hidden outside minimal chrome (the tab bar's first button is home there)", () => {
    setUI({ appbarMode: "off", tab: "agent" });
    const { container } = render(<NavHome appbarMode="off" />);
    expect(container.querySelector(".navhome")).toBeNull();
  });
});
