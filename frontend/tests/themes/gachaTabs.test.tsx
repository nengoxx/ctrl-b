import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setUI } from "../../src/store/ui";
import { KitNavBar } from "../../src/theme-engine/kit/NavBar";
import {
  composeLayout,
  LAYOUT_PRESETS,
  partitionSections,
  resolveLayout,
} from "../../src/theme-engine/layout";
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
  setUI({
    theme: "gacha",
    tab: "fleet",
    layout: "auto",
    appbarMode: "visible",
    sectionPlacement: {},
  });
});

afterEach(cleanup);

describe("gacha tab set (data)", () => {
  it("declares the four BAR sections with their frozen Japanese sub-labels, plus the gallery", () => {
    const tabs = tabsFor("gacha");
    expect(tabs.map((t) => t.id)).toEqual(["fleet", "agent", "utils", "conf", "agents"]);
    expect(tabs.slice(0, 4).map((t) => t.subLabel)).toEqual(SUBLABELS.map(([, jp]) => jp));
    // D70 §8.4a — the gallery gained one when it became PROMOTABLE onto the bar: キャラ (kyara), from
    // the same frozen module, so the committed font subset covers it (`gachaFonts.test.ts` is the guard).
    expect(tabs.find((t) => t.id === "agents")?.subLabel).toBe(GACHA_COPY.tabAgents);
    // Composer visibility + the lazy latch are unchanged from the standard set.
    expect(tabs.map((t) => t.hasComposer)).toEqual([true, true, false, false, false]);
    expect(tabs.find((t) => t.id === "conf")?.lazy).toBe(true);
    expect(tabs.find((t) => t.id === "agents")?.lazy).toBe(true);
  });

  it("defaults to the 3-tab preset (the prototype's Fleet/Agent/Settings shape), utils hosted in Conf", () => {
    const layout = resolveLayout("gacha", "auto");
    expect(layout).toBe("3-tab");
    // Through the SATELLITE composition, which is what the app partitions (D70 §8.4a): the gallery's
    // default `conf` placement joins utils in the hosting map, so gacha's default chrome is exactly the
    // prototype's three columns with nothing extra docked beside them.
    const { preset } = composeLayout(LAYOUT_PRESETS[layout], {});
    const { bar, menu, hosted } = partitionSections(tabsFor("gacha"), preset, false);
    expect(bar.map((d) => d.id)).toEqual(["fleet", "agent", "conf"]);
    expect(menu.map((d) => d.id)).toEqual([]);
    expect(hosted).toEqual({ utils: "conf", agents: "conf" });
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

  it("the PROMOTED gallery renders its own キャラ sub-label — five columns, all five lines", () => {
    // D70 §8.4a: `sectionPlacement.agents = "tab"` splices the satellite in after chat, so gacha's bar
    // carries five sub-labels. The word was minted for exactly this state; a label-only fifth column
    // beside four bilingual ones is what the ruling avoids.
    setUI({ layout: "4-tab", sectionPlacement: { agents: "tab" } });
    const { container } = render(<KitNavBar />);
    const btns = [...container.querySelectorAll("[role='tab']")];
    expect(btns.map((b) => b.id)).toEqual([
      "tabbtn-fleet",
      "tabbtn-agent",
      "tabbtn-agents",
      "tabbtn-utils",
      "tabbtn-conf",
    ]);
    expect(container.querySelectorAll(".kit-tabbtn .sub")).toHaveLength(5);
    expect(container.querySelector("#tabbtn-agents .sub")?.textContent).toBe(GACHA_COPY.tabAgents);
    // …and the bar hands the CSS its column count, which is what drives the 5-up label step.
    expect(
      container.querySelector<HTMLElement>(".kit-tabbar")?.style.getPropertyValue("--tab-count"),
    ).toBe("5");
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
