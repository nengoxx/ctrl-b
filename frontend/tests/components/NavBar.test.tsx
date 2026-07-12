import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { KitNavBar } from "../../src/theme-engine/kit/NavBar";
import { setUI } from "../../src/store/ui";

// KitNavBar roving tabindex under partial layouts (audit F0#2). WAI-ARIA tabs require exactly ONE tab stop
// in the tablist. Pre-F0 the active section was always on the bar (`selected ? 0 : -1` sufficed); under
// 2-tab the user can stand on an OFF-BAR section (conf, reached via the NavMenu) — the bar must then fall
// back to a first-button tab stop or it becomes keyboard-unreachable (fleet/agent aren't in the menu either:
// a real navigation dead-end). Drives the real ui store, same as the useSections tests.

beforeEach(() => {
  setUI({ theme: "minimal", tab: "fleet", layout: "auto", appbarMode: "visible" });
});

afterEach(cleanup);

function tabStops(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("[role='tab']"))
    .filter((b) => b.tabIndex === 0)
    .map((b) => b.id);
}

describe("KitNavBar roving tabindex", () => {
  it("active ON the bar → the active button is the single tab stop (4-tab, unchanged)", () => {
    setUI({ tab: "agent" });
    const { container } = render(<KitNavBar />);
    expect(container.querySelectorAll("[role='tab']")).toHaveLength(4);
    expect(tabStops(container)).toEqual(["tabbtn-agent"]);
  });

  it("active OFF the bar (2-tab + conf active) → the FIRST button is the single tab stop", () => {
    setUI({ layout: "2-tab", tab: "conf" }); // conf is off-bar in 2-tab (menu-reached)
    const { container } = render(<KitNavBar />);
    expect(container.querySelectorAll("[role='tab']")).toHaveLength(2); // fleet + agent
    expect(tabStops(container)).toEqual(["tabbtn-fleet"]); // exactly one tab stop — never zero
  });
});
