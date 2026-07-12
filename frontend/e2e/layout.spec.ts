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

test("minimal · 2-tab: conf reached via the NavMenu (which coexists with the tab bar); utils hosted", async ({
  page,
}) => {
  await seedUI(page, { theme: "minimal", mode: "dark", accent: "cyan", layout: "2-tab", v: 1 });
  await page.goto("/");

  // Bar = fleet + agent only.
  await expect(page.locator("#tabbtn-fleet")).toBeVisible();
  await expect(page.locator("#tabbtn-agent")).toBeVisible();
  await expect(page.locator("#tabbtn-utils")).toHaveCount(0);
  await expect(page.locator("#tabbtn-conf")).toHaveCount(0); // conf is off-bar → the menu, not the bar

  // The NavMenu launcher EXISTS alongside the tab bar (they legitimately coexist in 2-tab).
  await expect(page.locator(".kit-tabbar")).toBeVisible();
  const launch = page.locator(".navmenu-launch");
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
