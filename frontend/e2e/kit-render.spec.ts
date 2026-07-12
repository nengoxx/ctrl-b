import { CONTRAST_MATRIX } from "./contrast-matrix";
import { expect, test } from "./fixtures";

// The KIT-RENDER smoke (§14.15.1 item ⑩ — "the coverage hole"). No test in ANY layer boots DefaultRoot /
// kit.css: the three pre-existing e2e specs (flows/contrast/a11y) all boot the eager default (vapor). This
// rides the existing e2e projects (mobile + desktop) as a SPEC, NOT a new Playwright project — a project
// would re-run the axe scans per theme (combinatorial, ⑩). It boots the REAL built app per theme combo and
// checks ONE thing: the kit shell renders and stays up across a full tab sweep. Deliberately NOT here:
// screenshot diffing (rejected in the plan — flaky, over-engineered) and axe (the a11y suite owns a11y).
//
// It parametrizes over minimal AND cosmos (CosmosFleet = a distinct Surface impl + a starfield canvas — both
// must boot). Sourced from CONTRAST_MATRIX so the theme/mode set can never silently drift from the registry
// (that list has a drift guard against the real palettes); one representative accent per theme (the first =
// each theme's defaultAccent) keeps this a SMOKE, not the contrast matrix.
interface Combo {
  theme: string;
  mode: string;
  accent: string;
  bar: string[]; // the theme's DEFAULT-layout on-bar sections (D35 §F0) — the tab buttons to sweep
}
const COMBOS: Combo[] = CONTRAST_MATRIX.flatMap((t) =>
  // One representative accent per theme×mode (accents[0] = defaultAccent: minimal→cyan, cosmos→violet).
  t.modes.map((mode) => ({ theme: t.theme, mode, accent: t.accents[0], bar: t.bar })),
);

// LAYOUT-AWARE (D35 §F0): the sweep drives the theme's DEFAULT-layout BAR (`CONTRAST_MATRIX.bar`), not a
// hardcoded 4-tab list — so a theme with a 3-/2-tab default sweeps only its on-bar sections (utils/conf move
// off-bar into Conf/the menu, which have no `#tabbtn`). Sourced from the matrix (kept a plain list so this
// spec doesn't import the app graph — the contrast-matrix rationale); the matrix `bar` is drift-guarded
// against the registry-resolved bar in tests/theme-engine/themeContract.test.ts, so a `defaultLayout` change
// breaks the guard, not this sweep. Each bar id drives a `#tabbtn-<id>` button and reveals a `#tab-<id>`
// role=tabpanel. Today every theme → all four.

for (const c of COMBOS) {
  test(`kit renders + survives a tab sweep — ${c.theme} ${c.mode}/${c.accent}`, async ({
    page,
    pageErrors, // fixture: collects every uncaught page exception AND reportError() (rider (c)'s rAF sink)
  }) => {
    // Seed the persisted UI blob BEFORE any page script (the flows.spec / contrast.spec addInitScript
    // pattern). `v:1` stamps the current persisted-schema version so the migration chain is skipped and
    // theme/mode/accent apply directly; the server appearance mock is unseeded ("vapor") so the reconcile
    // round-trip HOLDS the local pick (fixtures.ts §mockApi). `tab:"fleet"` = the boot section.
    await page.addInitScript(
      (ui) => {
        localStorage.setItem("ctrlb.ui", JSON.stringify(ui));
      },
      { theme: c.theme, mode: c.mode, accent: c.accent, tab: "fleet", v: 1 },
    );

    await page.goto("/");

    // ── Wait for the kit to be LIVE (two independent signals) ──
    //  1) The theme's scoped tokens.css (@layer theme :scope) has applied — it sets `color-scheme` on
    //     <html>, flipping the computed value off the "normal" default. Proves CSS (not just React) loaded;
    //     the non-default theme's stylesheet is lazy, so this is the async gate. (Reused from contrast.spec.)
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
      .not.toBe("normal");
    //  2) A KIT-ONLY chrome node has mounted. `.kit-appbar` is rendered by DefaultRoot's KitAppBar (the
    //     default appbarMode is "visible") and is the class CosmosFleet itself cross-queries — vapor uses
    //     `.app-shell`, never `.kit`, so this positively identifies "DefaultRoot booted, not the eager
    //     default". (The `.kit` root marker would also be kit-only; `.kit-appbar` additionally proves the
    //     chrome sub-tree rendered, so it's the stronger LIVE signal.)
    await page.waitForSelector(".kit-appbar");

    // ── Render/tab smoke: drive the theme's on-bar sections, asserting the kit is intact after each nav ──
    for (const tab of c.bar) {
      await page.locator(`#tabbtn-${tab}`).click();

      // (c) The tab's own panel actually rendered AND is the visible one (`.kit .tab.active { display }`;
      //     inactive panels are display:none) — a cheap per-tab existence + activation check. Conf is a lazy
      //     chunk: its Suspense fallback ALSO carries `#tab-conf`, so this passes through the load either way.
      await expect(page.locator(`#tab-${tab}`)).toBeVisible();

      // (a) No item-② theme-fault fallback (`div.root-error[data-fault="theme"]`) — the stable, non-styling
      //     hook that a theme Root render/commit crash mounts in place of `<ActiveRoot/>` (App.tsx).
      await expect(page.locator('[data-fault="theme"]')).toHaveCount(0);
      // (b) No BARE `.root-error` either — that's the F23 GLOBAL fallback (main.tsx outer net, no data-fault).
      //     Its presence means the whole app tree fell over, not just the theme. `.root-error` is a superset
      //     of (a), so this also re-covers it; both are asserted for a distinct, high-signal message each.
      await expect(page.locator(".root-error")).toHaveCount(0);
    }

    // Zero uncaught page errors across the entire boot+sweep — a cheap, high-signal invariant. rider (c)'s
    // safeRafLoop routes a caught canvas/rAF fault to reportError(); Playwright surfaces that as a pageerror,
    // so a starfield/camera loop that throws during a normal boot fails here (nothing should reportError on a
    // healthy run). More robust than a zero-console.error assert (network/SW noise pollutes that).
    expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
  });
}
