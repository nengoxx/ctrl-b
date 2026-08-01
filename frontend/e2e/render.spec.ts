import { test, expect } from "./fixtures";

// D24 — render smoke: each of the 4 tabs mounts in the REAL built app served by `vite preview`, with
// `/api` mocked. The headline "the build isn't broken / a component didn't crash" guard. We assert the
// panel goes active + a piece of its real content is visible (so an ErrorBoundary fallback would fail
// the test) AND no uncaught page exception fired. Boots the DEFAULT skin — cosmos since D51 V0 — so the
// Fleet marker is a selector (its hosts are orbital coins named by `aria-label`, with no text content)
// and the sweep waits for the kit chrome first (the default Root is a lazy chunk now; R20).

const TABS = [
  { id: "fleet", label: "Fleet", content: null, marker: ".cosmos-planet.on" }, // a fixture host coin
  { id: "agent", label: "Agent", content: null, marker: null }, // empty thread → just assert the panel
  { id: "utils", label: "Tools", content: "Yt Captions", marker: null }, // a util run card
  { id: "conf", label: "Conf", content: "Inference", marker: null }, // a ConfGroup title (lazy chunk)
] as const;

for (const t of TABS) {
  test(`${t.label} tab renders without crashing`, async ({ page, pageErrors }) => {
    await page.goto("/");
    await expect(page.locator(".kit-appbar")).toBeVisible(); // the lazy default Root mounted (content gate)
    await page.locator(`#tabbtn-${t.id}`).click();

    const panel = page.locator(`#tab-${t.id}`);
    await expect(panel).toHaveClass(/active/);
    await expect(panel).toBeVisible();
    if (t.marker) {
      await expect(page.locator(t.marker).first()).toBeVisible();
    } else if (t.content) {
      await expect(page.getByText(t.content, { exact: false }).first()).toBeVisible();
    }

    expect(pageErrors, `uncaught exceptions on ${t.label}: ${pageErrors.join("; ")}`).toHaveLength(
      0,
    );
  });
}
