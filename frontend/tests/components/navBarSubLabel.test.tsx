import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setUI } from "../../src/store/ui";
import { KitNavBar } from "../../src/theme-engine/kit/NavBar";
import { NavMenu } from "../../src/components/NavMenu";
import type { TabDef } from "../../src/theme-engine/types";

// The `subLabel` kit seam (D52 / GACHA_PLAN §4.9 ledger — the committed shared extension gacha's ruled
// Japanese nav labels need). Three claims, all structural:
//   1. a TabDef that DECLARES `subLabel` renders a second `.sub` line inside the tab button;
//   2. a TabDef that OMITS it emits NO extra node — every theme but gacha keeps byte-identical bar DOM;
//   3. the floating NavMenu stays icon+label only (the §10.5 fence: "NavMenu itself stays icon-only, no
//      sub-label rendering required").
// The tab registry is mocked so this tests the SEAM, not any particular theme's data (the kit seams unit
// lands before the gacha registry row).

const TABS: TabDef[] = [
  { id: "fleet", glyph: "⌬", lbl: "fleet", subLabel: "編成", hasComposer: true },
  { id: "agent", glyph: "▲", lbl: "chat", subLabel: "案内", hasComposer: true },
  { id: "utils", glyph: "◆", lbl: "tools", hasComposer: false }, // deliberately WITHOUT a sub-label
  { id: "conf", glyph: "●", lbl: "conf", hasComposer: false, lazy: true },
];

vi.mock("../../src/theme-engine/tabs", () => ({
  STANDARD_TABS: [],
  tabsFor: () => TABS,
  hasComposer: () => false,
}));

beforeEach(() => {
  setUI({ theme: "minimal", tab: "fleet", layout: "auto", appbarMode: "visible" });
});

afterEach(cleanup);

describe("KitNavBar — the optional TabDef.subLabel line", () => {
  it("renders a `.sub` node ONLY for the sections that declare one", () => {
    const { container } = render(<KitNavBar />);
    const fleet = container.querySelector("#tabbtn-fleet")!;
    expect(fleet.querySelector(".sub")?.textContent).toBe("編成");
    expect(container.querySelector("#tabbtn-agent")!.querySelector(".sub")?.textContent).toBe(
      "案内",
    );
    // utils/conf declare none → no node at all (not an empty span): a theme without sub-labels is unchanged.
    expect(container.querySelector("#tabbtn-utils")!.querySelector(".sub")).toBeNull();
    expect(container.querySelector("#tabbtn-conf")!.querySelector(".sub")).toBeNull();
    expect(container.querySelectorAll(".sub")).toHaveLength(2);
  });

  it("the primary `.lbl` is untouched (the sub-label is additive, never a replacement)", () => {
    const { container } = render(<KitNavBar />);
    expect(container.querySelector("#tabbtn-fleet")!.querySelector(".lbl")?.textContent).toBe(
      "fleet",
    );
  });
});

describe("NavMenu — stays icon-only (no sub-label rendering)", () => {
  it("lists off-bar sections without any `.sub` node", async () => {
    // appbarMode "minimal" pushes every unhosted section into the floating menu (the all-off-bar endpoint),
    // so the popover lists sections that DO declare sub-labels — and must still render none.
    setUI({ appbarMode: "minimal" });
    const { container, findAllByRole } = render(<NavMenu />);
    container.querySelector<HTMLButtonElement>(".navmenu-launch")!.click();
    const items = await findAllByRole("menuitem");
    expect(items.length).toBeGreaterThan(1);
    expect(container.querySelectorAll(".sub")).toHaveLength(0);
  });
});
