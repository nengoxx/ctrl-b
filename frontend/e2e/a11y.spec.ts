import AxeBuilder from "@axe-core/playwright";
import { type Page } from "@playwright/test";

import { test, expect } from "./fixtures";

// D24 — a11y gate. axe-core scans each tab (WCAG 2.0/2.1 A + AA) in the real built app; this is what
// locks in the F14–F27 a11y work against regression. The inactive tab panels are `display:none`, which
// axe ignores, so scanning the page covers the active tab + the always-on appbar/composer/tabbar.
//
// TWO arms: the DEFAULT boot (vapor) across its 4-tab bar, and a frontier-booted arm across its 3-tab bar
// (utils hosted in Conf → off-bar; the valid dark/coral combo per CONTRAST_MATRIX). The frontier arm
// machine-enforces the F5 Gate A semantics on the kit surface — A1 (the focus ring is markup-invisible to
// axe, but A3/A5 roles+names, the seg `role="group"`/`aria-pressed`, the sheet grip's label — all axe-
// visible) — the vapor arm alone would never scan a kit theme (vapor is a bespoke escape hatch).

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

// ── Default boot (vapor) — its 4-tab bar ──
const VAPOR_TABS = [
  { id: "fleet", label: "Fleet", content: "vault" },
  { id: "agent", label: "Agent", content: null },
  { id: "utils", label: "Tools", content: "Yt Captions" },
  { id: "conf", label: "Conf", content: "Inference" },
] as const;

for (const t of VAPOR_TABS) {
  test(`vapor ${t.label} tab — no WCAG A/AA axe violations`, async ({ page }) => {
    await page.goto("/");
    await page.locator(`#tabbtn-${t.id}`).click();
    await expect(page.locator(`#tab-${t.id}`)).toHaveClass(/active/);
    // Wait for the tab's real content to settle before scanning — scanning a transient loading state
    // (e.g. Conf's "// loading…" before the lazy chunk + settings resolve) produces flaky violations.
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
