import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

// The SECTION LAYOUT SYSTEM v1 lever (D35 / FRONTIER_PLAN §6-F0) driven end-to-end on the REAL built app. A
// SMOKE (no axe, no screenshots) that rides the existing e2e projects — it seeds the device-local `ui.layout`
// lever the same way flows/kit-render seed appearance (an `addInitScript` writing `ctrlb.ui` with `v:1` so the
// migration chain is skipped), then asserts the layout partition the way the user experiences it: which tab
// buttons exist, whether the NavMenu launcher is present, and that hosted utils lands inside Conf.
//
// Themes: `minimal` (a registered Kit theme that supports ALL presets → an explicit 3-/2-tab pick is honored)
// exercises the real relocation; `vapor` (the frozen default, `layouts:["4-tab"]`) proves the waiver coerces a
// 2-tab pick back to its untouched 4-tab markup.

/** Seed the persisted UI blob before any page script (the flows/kit-render pattern). `v:1` = current schema
 *  (skip migrations); the appearance server-mock is unseeded so the reconcile round-trip HOLDS the local pick,
 *  and `ui.layout` is device-local so it's never reconciled away. */
async function seedUI(page: Page, ui: Record<string, unknown>): Promise<void> {
  await page.addInitScript((blob) => {
    localStorage.setItem("ctrlb.ui", JSON.stringify(blob));
  }, ui);
}

test("minimal · 3-tab: utils leaves the bar and is hosted in Conf; no NavMenu (menu empty)", async ({
  page,
}) => {
  await seedUI(page, { theme: "minimal", mode: "dark", accent: "cyan", layout: "3-tab", v: 1 });
  await page.goto("/");

  // Bar = fleet + agent + conf (utils hosted → no #tabbtn-utils).
  await expect(page.locator("#tabbtn-fleet")).toBeVisible();
  await expect(page.locator("#tabbtn-agent")).toBeVisible();
  await expect(page.locator("#tabbtn-conf")).toBeVisible();
  await expect(page.locator("#tabbtn-utils")).toHaveCount(0);
  // Menu is empty in 3-tab (conf is on the bar) → the floating launcher is not rendered.
  await expect(page.locator(".navmenu")).toHaveCount(0);

  // Conf hosts the Tools group.
  await page.locator("#tabbtn-conf").click();
  await expect(page.locator("#utils-hosted")).toBeVisible();
});

test("minimal · 2-tab (visible chrome): conf reached via the DOCKED appbar menu; utils hosted", async ({
  page,
}) => {
  // Default appbarMode is "visible" → the docking rule (D35 §F0 fixup): the nav affordance is an appbar
  // trailing action, NOT a floating launcher. It coexists with the tab bar (bar = fleet+agent, menu = conf).
  await seedUI(page, { theme: "minimal", mode: "dark", accent: "cyan", layout: "2-tab", v: 1 });
  await page.goto("/");

  // Bar = fleet + agent only.
  await expect(page.locator("#tabbtn-fleet")).toBeVisible();
  await expect(page.locator("#tabbtn-agent")).toBeVisible();
  await expect(page.locator("#tabbtn-utils")).toHaveCount(0);
  await expect(page.locator("#tabbtn-conf")).toHaveCount(0); // conf is off-bar → the menu, not the bar

  // The menu trigger is DOCKED inside the appbar (not floating), alongside the tab bar.
  await expect(page.locator(".kit-tabbar")).toBeVisible();
  const launch = page.locator(".kit-appbar .navmenu-launch");
  await expect(launch).toBeVisible();

  // Open it → exactly one menuitem (conf, the sole off-bar-and-unhosted section).
  await launch.click();
  const items = page.locator(".navmenu-pop [role='menuitem']");
  await expect(items).toHaveCount(1);

  // Activating it lands on Conf, where the Tools group is hosted.
  await items.first().click();
  await expect(page.locator("#tab-conf")).toBeVisible();
  await expect(page.locator("#utils-hosted")).toBeVisible();
});

test("minimal · 2-tab (appbar off): conf reached via the FLOATING NavMenu (no appbar to dock into)", async ({
  page,
}) => {
  // appbarMode "off" → there's no appbar, so the menu can't dock: DefaultRoot mounts the standalone floating
  // launcher (the "docks to the chrome that exists" fallback). Same partition (bar = fleet+agent, menu = conf).
  await seedUI(page, {
    theme: "minimal",
    mode: "dark",
    accent: "cyan",
    layout: "2-tab",
    appbarMode: "off",
    v: 1,
  });
  await page.goto("/");

  // No appbar in this mode; the tab bar remains.
  await expect(page.locator(".kit-appbar")).toHaveCount(0);
  await expect(page.locator(".kit-tabbar")).toBeVisible();

  // The FLOATING launcher (not inside an appbar — there is none) is present and opens the conf menu.
  const launch = page.locator(".navmenu-launch");
  await expect(launch).toBeVisible();
  await expect(page.locator(".navmenu.docked")).toHaveCount(0);

  await launch.click();
  const items = page.locator(".navmenu-pop [role='menuitem']");
  await expect(items).toHaveCount(1);

  await items.first().click();
  await expect(page.locator("#tab-conf")).toBeVisible();
  await expect(page.locator("#utils-hosted")).toBeVisible();
});

test("minimal · appbarMode minimal (4-tab): the floating menu carries ALL nav (bar gone)", async ({
  page,
}) => {
  // The all-off-bar endpoint ("1-tab mode IS minimal"): no appbar, no tab bar — the floating orbit menu
  // lists every unhosted section (all four under the default 4-tab). Pins the pre-existing minimal behavior
  // the docking rule must never disturb (audit F0 coverage nit).
  await seedUI(page, {
    theme: "minimal",
    mode: "dark",
    accent: "cyan",
    appbarMode: "minimal",
    v: 1,
  });
  await page.goto("/");

  await expect(page.locator(".kit-appbar")).toHaveCount(0);
  await expect(page.locator(".kit-tabbar")).toHaveCount(0);
  const launch = page.locator(".navmenu-launch");
  await expect(launch).toBeVisible();
  await expect(page.locator(".navmenu.docked")).toHaveCount(0);

  await launch.click();
  const items = page.locator(".navmenu-pop [role='menuitem']");
  await expect(items).toHaveCount(4); // fleet · agent · utils · conf — nothing hosted in 4-tab

  await items.last().click(); // conf (def order)
  await expect(page.locator("#tab-conf")).toBeVisible();
});

test("minimal · 2-tab: a stale `utils` deep-link boots coerced onto Conf with the Tools group", async ({
  page,
}) => {
  // The boot-coercion path (DefaultRoot's effect): a persisted `tab:"utils"` is hosted under 2-tab → route
  // through the nav chokepoint to the host (Conf) + scroll-to-group. Allow the effect a tick — `toBeVisible`
  // polls, and Conf is a lazy chunk that mounts after the coercion.
  await seedUI(page, {
    theme: "minimal",
    mode: "dark",
    accent: "cyan",
    layout: "2-tab",
    tab: "utils",
    v: 1,
  });
  await page.goto("/");

  await expect(page.locator("#tab-conf")).toBeVisible(); // coerced off the stale utils deep-link
  await expect(page.locator("#utils-hosted")).toBeVisible();
});

test("vapor · 2-tab: the frozen waiver coerces back to 4-tab — all four tab buttons render", async ({
  page,
}) => {
  // vapor declares `layouts:["4-tab"]`; a 2-tab pick coerces to 4-tab (a one-time console.warn, harmless).
  // VaporRoot never consumes the registry, so its four-tab markup is byte-identical. vapor tab buttons are
  // the same `#tabbtn-<id>` ids the vapor flows.spec drives.
  await seedUI(page, { theme: "vapor", accent: "dark", layout: "2-tab", v: 1 });
  await page.goto("/");

  for (const id of ["fleet", "agent", "utils", "conf"]) {
    await expect(page.locator(`#tabbtn-${id}`)).toBeVisible();
  }
});
