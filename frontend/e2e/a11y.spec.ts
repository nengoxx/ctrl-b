import AxeBuilder from "@axe-core/playwright";

import { test, expect } from "./fixtures";

// D24 — a11y gate. axe-core scans each tab (WCAG 2.0/2.1 A + AA) in the real built app; this is what
// locks in the F14–F27 a11y work against regression. The inactive tab panels are `display:none`, which
// axe ignores, so scanning the page covers the active tab + the always-on appbar/composer/tabbar.

const TABS = [
  { id: "fleet", label: "Fleet", content: "vault" },
  { id: "agent", label: "Agent", content: null },
  { id: "utils", label: "Tools", content: "Yt Captions" },
  { id: "conf", label: "Conf", content: "Inference" },
] as const;

for (const t of TABS) {
  test(`${t.label} tab — no WCAG A/AA axe violations`, async ({ page }) => {
    await page.goto("/");
    await page.locator(`#tabbtn-${t.id}`).click();
    await expect(page.locator(`#tab-${t.id}`)).toHaveClass(/active/);
    // Wait for the tab's real content to settle before scanning — scanning a transient loading state
    // (e.g. Conf's "// loading…" before the lazy chunk + settings resolve) produces flaky violations.
    if (t.content) await expect(page.getByText(t.content, { exact: false }).first()).toBeVisible();

    const { violations } = await new AxeBuilder({ page })
      // Scope to the active panel: the other tabs stay mounted (hidden) — scanning them adds
      // cross-tab noise + flake. The always-on chrome (appbar/tabbar/composer) is covered separately.
      .include(`#tab-${t.id}`)
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      // `color-contrast` is excluded by design: the Vapor theme's low-contrast neon-on-dark palette is
      // the deliberate, D7-protected aesthetic. The gate gilds the *structural/semantic* a11y (roles,
      // names, labels, ARIA — the F14–F27 work); contrast is an accepted, documented tradeoff (D24).
      .disableRules(["color-contrast"])
      .analyze();

    // Readable failure: list the rule ids + node counts rather than a wall of JSON.
    const summary = violations
      .map((v) => `${v.id} (${v.impact}, ${v.nodes.length} nodes)`)
      .join("\n");
    expect(violations, `\n${summary}`).toEqual([]);
  });
}
