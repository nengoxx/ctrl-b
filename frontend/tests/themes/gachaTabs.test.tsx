import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setUI } from "../../src/store/ui";
import { KitNavBar } from "../../src/theme-engine/kit/NavBar";
import { LAYOUT_PRESETS, partitionSections, resolveLayout } from "../../src/theme-engine/layout";
import { tabsFor } from "../../src/theme-engine/tabs";
import { GACHA_COPY } from "../../src/themes/gacha/copy";

// gacha's tab set + layout shape (D52 G0 / GACHA_PLAN §10.5 + Codex R4-9).
//
// The EXACT-COPY arm is the one Codex asked for by name: the existing layout tests select tabs by ID, so a
// theme whose sub-labels all silently vanished would still pass every one of them. This asserts the rendered
// TEXT of all four, in 4-tab mode — the preset where Utils is on the bar and therefore the only place its
// sub-label can be seen at all. `4-tab` is not gacha's default (3-tab is), which is exactly why it needs a
// test: the layout fence says a theme must genuinely honor EVERY preset, not just its own.

const SUBLABELS = [
  ["fleet", GACHA_COPY.tabFleet],
  ["agent", GACHA_COPY.tabAgent],
  ["utils", GACHA_COPY.tabUtils],
  ["conf", GACHA_COPY.tabConf],
] as const;

beforeEach(() => {
  setUI({ theme: "gacha", tab: "fleet", layout: "auto", appbarMode: "visible" });
});

afterEach(cleanup);

describe("gacha tab set (data)", () => {
  it("declares the standard four sections, each with a Japanese sub-label from the frozen copy", () => {
    const tabs = tabsFor("gacha");
    expect(tabs.map((t) => t.id)).toEqual(["fleet", "agent", "utils", "conf"]);
    expect(tabs.map((t) => t.subLabel)).toEqual(SUBLABELS.map(([, jp]) => jp));
    // Composer visibility + the Conf lazy latch are unchanged from the standard set.
    expect(tabs.map((t) => t.hasComposer)).toEqual([true, true, false, false]);
    expect(tabs.find((t) => t.id === "conf")?.lazy).toBe(true);
  });

  it("defaults to the 3-tab preset (the prototype's Fleet/Agent/Settings shape), utils hosted in Conf", () => {
    const layout = resolveLayout("gacha", "auto");
    expect(layout).toBe("3-tab");
    const { bar, menu, hosted } = partitionSections(
      tabsFor("gacha"),
      LAYOUT_PRESETS[layout],
      false,
    );
    expect(bar.map((d) => d.id)).toEqual(["fleet", "agent", "conf"]);
    expect(menu).toEqual([]);
    expect(hosted).toEqual({ utils: "conf" });
  });

  it("honors every preset — it declares no `layouts` restriction (the D35 ideal)", () => {
    for (const preset of ["4-tab", "3-tab", "2-tab"] as const) {
      expect(resolveLayout("gacha", preset)).toBe(preset);
    }
  });
});

describe("gacha nav bar — the sub-labels actually render (Codex R4-9)", () => {
  it("renders ALL FOUR Japanese sub-labels in 4-tab mode", () => {
    setUI({ layout: "4-tab" });
    const { container } = render(<KitNavBar />);
    expect(container.querySelectorAll("[role='tab']")).toHaveLength(4);
    for (const [id, jp] of SUBLABELS) {
      expect(
        container.querySelector(`#tabbtn-${id}`)!.querySelector(".sub")?.textContent,
        `gacha's ${id} tab lost its sub-label`,
      ).toBe(jp);
    }
  });

  it("renders the three on-bar sub-labels under its own 3-tab default", () => {
    const { container } = render(<KitNavBar />);
    expect(container.querySelectorAll("[role='tab']")).toHaveLength(3);
    expect(container.querySelector("#tabbtn-fleet")!.querySelector(".sub")?.textContent).toBe(
      GACHA_COPY.tabFleet,
    );
    expect(container.querySelector("#tabbtn-conf")!.querySelector(".sub")?.textContent).toBe(
      GACHA_COPY.tabConf,
    );
    expect(container.querySelector("#tabbtn-utils")).toBeNull(); // hosted in Conf
  });
});
