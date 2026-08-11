import AxeBuilder from "@axe-core/playwright";
import { type Page } from "@playwright/test";

import { seedUI, test, expect, VAPOR_UI } from "./fixtures";

// D24 — a11y gate. axe-core scans each tab (WCAG 2.0/2.1 A + AA) in the real built app; this is what
// locks in the F14–F27 a11y work against regression. The inactive tab panels are `display:none`, which
// axe ignores, so scanning the page covers the active tab + the always-on appbar/composer/tabbar.
//
// FOUR arms: the DEFAULT boot — cosmos since D51 V0 — across its 4-tab bar, a seeded VAPOR arm across the
// same bar (vapor is a bespoke escape hatch with its own chrome + Fleet, and it stays a shipping skin until
// Phase 16 finishes assimilating it, so it keeps its own scan now that it is no longer the default), a
// frontier-booted arm across its 3-tab bar (utils hosted in Conf → off-bar; the valid dark/coral combo per
// CONTRAST_MATRIX), and a GACHA arm across its own 3-tab bar (D52 G0 — enrolled from registration, so every
// later gacha slice is measured against it). The kit arms machine-enforce the F5 Gate A semantics — A1 (the
// focus ring is markup-invisible to axe, but A3/A5 roles+names, the seg `role="group"`/`aria-pressed`, the
// sheet grip's label — all axe-visible).

/** Scan one active tab panel for WCAG A/AA violations, scoped to that panel. */
async function scanTab(page: Page, id: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    // Scope to the active panel: the other tabs stay mounted (hidden) — scanning them adds
    // cross-tab noise + flake. The always-on chrome (appbar/tabbar/composer) is covered separately.
    .include(`#tab-${id}`)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // `color-contrast` is excluded by design: BOTH kit themes' palettes are deliberate, D-protected
    // aesthetics (vapor's low-contrast neon-on-dark; frontier's badlands accents — D24). The gate gilds
    // the *structural/semantic* a11y (roles, names, labels, ARIA — the F14–F27 + F5 Gate A work);
    // contrast is an accepted, documented tradeoff (D24).
    .disableRules(["color-contrast"])
    .analyze();

  // Readable failure: list the rule ids + node counts rather than a wall of JSON.
  const summary = violations
    .map((v) => `${v.id} (${v.impact}, ${v.nodes.length} nodes)`)
    .join("\n");
  expect(violations, `\n${summary}`).toEqual([]);
}

/** Scan the WHOLE PAGE (Codex G0 #6). The per-tab scans above are scoped to `#tab-<id>`, which by
 *  construction never sees the chrome the theme actually re-skins — the app bar, the tab bar and its
 *  indicator, the composer, the floating overlays. A theme could ship an unlabelled bar control, or a
 *  reel overlay that steals focus, and every scoped scan would still pass. Inactive tab panels are
 *  `display:none`, which axe ignores, so this adds the chrome without adding cross-tab noise. */
async function scanPage(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(["color-contrast"]) // same D24 palette exemption as the scoped scans
    .analyze();
  const summary = violations
    .map((v) => `${v.id} (${v.impact}, ${v.nodes.length} nodes)`)
    .join("\n");
  expect(violations, `\n${summary}`).toEqual([]);
}

/** Seed a theme's persisted appearance before any page script (the flows/contrast/kit-render pattern). */
async function bootTheme(page: Page, ui: Record<string, unknown>): Promise<void> {
  await page.addInitScript((seed) => {
    localStorage.setItem("ctrlb.ui", JSON.stringify(seed));
  }, ui);
}

// ── Whole-page scans, one per shipping theme, on Fleet ──
// One arm each rather than one per tab: the point is the CHROME, which is identical across tabs, so a
// second tab would re-scan the same bars for a third of the suite's runtime.
const PAGE_ARMS = [
  { theme: "cosmos", ui: { theme: "cosmos", mode: "dark", accent: "violet", tab: "fleet", v: 1 } },
  { theme: "vapor", ui: { ...VAPOR_UI, tab: "fleet" } },
  {
    theme: "frontier",
    ui: { theme: "frontier", mode: "dark", accent: "coral", tab: "fleet", v: 1 },
  },
  { theme: "gacha", ui: { theme: "gacha", mode: "dark", accent: "arcade", tab: "fleet", v: 1 } },
] as const;

for (const arm of PAGE_ARMS) {
  test(`${arm.theme} — whole page (chrome included) has no WCAG A/AA axe violations`, async ({
    page,
  }) => {
    await bootTheme(page, arm.ui);
    await page.goto("/");
    await expect(page.locator(".kit-appbar, .appbar").first()).toBeVisible();
    await expect(page.locator("#tab-fleet")).toHaveClass(/active/);
    await scanPage(page);
  });
}

// ── Default boot (cosmos) — its 4-tab bar ──
// The fleet arm's settle marker is a SELECTOR, not text: cosmos's Fleet renders hosts as orbital coins
// whose name lives in `aria-label`, not in text content.
const FOUR_TABS = [
  { id: "fleet", label: "Fleet", content: "vault" },
  { id: "agent", label: "Agent", content: null },
  { id: "utils", label: "Tools", content: "Yt Captions" },
  { id: "conf", label: "Conf", content: "Inference" },
] as const;

for (const t of FOUR_TABS) {
  test(`cosmos ${t.label} tab — no WCAG A/AA axe violations`, async ({ page }) => {
    await page.goto("/");
    // FLAKE RULE (R20): the default skin's Root is a LAZY chunk since D51 V0, so gate on kit CONTENT before
    // touching the bar — never on `data-skin`/the background, which the pre-JS FOUC script stamps first.
    await expect(page.locator(".kit-appbar")).toBeVisible();
    await page.locator(`#tabbtn-${t.id}`).click();
    await expect(page.locator(`#tab-${t.id}`)).toHaveClass(/active/);
    // Wait for the tab's real content to settle before scanning — scanning a transient loading state
    // (e.g. Conf's "// loading…" before the lazy chunk + settings resolve) produces flaky violations.
    if (t.id === "fleet") await expect(page.locator(".cosmos-planet.on").first()).toBeVisible();
    else if (t.content)
      await expect(page.getByText(t.content, { exact: false }).first()).toBeVisible();
    await scanTab(page, t.id);
  });
}

// ── vapor boot — the same 4-tab bar, its own bespoke chrome/Fleet (seeded: no longer the default) ──
for (const t of FOUR_TABS) {
  test(`vapor ${t.label} tab — no WCAG A/AA axe violations`, async ({ page }) => {
    await seedUI(page, { ...VAPOR_UI, tab: "fleet" });
    await page.goto("/");
    await page.locator(`#tabbtn-${t.id}`).click();
    await expect(page.locator(`#tab-${t.id}`)).toHaveClass(/active/);
    if (t.content) await expect(page.getByText(t.content, { exact: false }).first()).toBeVisible();
    await scanTab(page, t.id);
  });
}

// ── frontier boot — its 3-tab bar (fleet/agent/conf; utils hosted in Conf) ──
const FRONTIER_TABS = [
  { id: "fleet", label: "Fleet", content: "THE FRONTIER" }, // the badlands map label
  { id: "agent", label: "Agent", content: "Frontier Comms" }, // the empty-state hero
  { id: "conf", label: "Conf", content: "Inference" },
] as const;

// ── gacha boot — its 3-tab bar (fleet/agent/conf; utils hosted in Conf), D52 G0 ──
// The arm exists from G0 on purpose: the theme joined the a11y gate the moment it registered, so every
// later slice is measured against it. The settle markers track what each slice made real — G3's Agent tab
// is the bespoke oracle body now, so it settles on the operator's own name plate rather than on nothing.
const GACHA_TABS = [
  { id: "fleet", label: "Fleet", content: "vault" },
  { id: "agent", label: "Agent", content: "Lucky Relay" },
  { id: "conf", label: "Conf", content: "Inference" },
] as const;

for (const t of GACHA_TABS) {
  test(`gacha ${t.label} tab — no WCAG A/AA axe violations`, async ({ page }) => {
    await page.addInitScript(
      (ui) => {
        localStorage.setItem("ctrlb.ui", JSON.stringify(ui));
      },
      { theme: "gacha", mode: "dark", accent: "arcade", tab: "fleet", v: 1 },
    );
    await page.goto("/");
    await expect(page.locator(".kit-appbar")).toBeVisible();
    await page.locator(`#tabbtn-${t.id}`).click();
    await expect(page.locator(`#tab-${t.id}`)).toHaveClass(/active/);
    if (t.content) await expect(page.getByText(t.content, { exact: false }).first()).toBeVisible();
    await scanTab(page, t.id);
  });
}

// ── gacha's ALT FLEET LAYOUTS (GACHA_PLAN §12.6 slice E4, pin ㉑) ──
// The arm above measures gacha's DEFAULT Fleet (capsule). `fleetLayout` REPLACES that whole body with a
// composition of its own — the poster's stack of sheared slices with its registry block, the cover's fixed
// magazine frame with a masthead heading, a hero card and a cut-in column — each with its own controls,
// headings and copy, and axe has never seen either. Two arms, Fleet only: the chrome around them is the
// same kit shell the arms above already scan, and the layout is the only thing that changes.
//
// The seed rides INSIDE the same persisted `ctrlb.ui` blob every other arm uses (`themeSettings` is one of
// its fields, `src/store/ui.ts`), so this needs no new mechanism. The settle marker is the LAYOUT's own
// root rather than a hostname: a hostname renders under capsule too, so a seed that failed to apply would
// scan the default body and pass — the marker is what proves the layout is really up.
const GACHA_LAYOUTS = [
  { layout: "poster", marker: ".po-body .po-slice" },
  { layout: "cover", marker: ".cv-frame .cv-card.is-hero" },
] as const;

for (const arm of GACHA_LAYOUTS) {
  test(`gacha Fleet — the ${arm.layout} layout has no WCAG A/AA axe violations`, async ({
    page,
  }) => {
    await seedUI(page, {
      theme: "gacha",
      mode: "dark",
      accent: "arcade",
      tab: "fleet",
      themeSettings: { gacha: { fleetLayout: arm.layout } },
      v: 1,
    });
    await page.goto("/");
    await expect(page.locator(".kit-appbar")).toBeVisible();
    await expect(page.locator("#tab-fleet")).toHaveClass(/active/);
    await expect(page.locator(arm.marker).first()).toBeVisible();
    await scanTab(page, "fleet");
  });
}

for (const t of FRONTIER_TABS) {
  test(`frontier ${t.label} tab — no WCAG A/AA axe violations`, async ({ page }) => {
    // Seed the persisted UI blob BEFORE any page script (the flows/contrast/kit-render addInitScript
    // pattern); dark/coral is frontier's valid combo (defaultAccent) per CONTRAST_MATRIX.
    await page.addInitScript(
      (ui) => {
        localStorage.setItem("ctrlb.ui", JSON.stringify(ui));
      },
      { theme: "frontier", mode: "dark", accent: "coral", tab: "fleet", v: 1 },
    );
    await page.goto("/");
    await page.locator(`#tabbtn-${t.id}`).click();
    await expect(page.locator(`#tab-${t.id}`)).toHaveClass(/active/);
    await expect(page.getByText(t.content, { exact: false }).first()).toBeVisible();
    await scanTab(page, t.id);
  });
}
