import type { Page } from "@playwright/test";

import { expect, seedUI, test } from "./fixtures";

// The SECTION LAYOUT SYSTEM v1 lever (D35 / FRONTIER_PLAN §6-F0) driven end-to-end on the REAL built app. A
// SMOKE (no axe, no screenshots) that rides the existing e2e projects — it seeds the device-local `ui.layout`
// lever the same way flows/kit-render seed appearance (an `addInitScript` writing `ctrlb.ui` with `v:1` so the
// migration chain is skipped), then asserts the layout partition the way the user experiences it: which tab
// buttons exist, whether the NavMenu launcher is present, and that hosted utils lands inside Conf.
//
// Themes: `minimal` (a plain Kit theme) exercises the relocation on kit-default bodies; `vapor` — the theme
// with a Root-PINNED bespoke body (FleetTab) and its own eager CSS — repeats the two relocations for real
// since D51 V6 retired its `layouts:["4-tab"]` waiver (R13/Codex #11: the waiver's replacement had to be
// real 2-/3-tab navigation+hosting tests, not a forced-coercion assertion).

test("minimal · 3-tab: utils leaves the bar and is hosted in Conf; the menu carries the gallery", async ({
  page,
}) => {
  await seedUI(page, { theme: "minimal", mode: "dark", accent: "cyan", layout: "3-tab", v: 1 });
  await page.goto("/");

  // Bar = fleet + agent + conf (utils hosted → no #tabbtn-utils).
  await expect(page.locator("#tabbtn-fleet")).toBeVisible();
  await expect(page.locator("#tabbtn-agent")).toBeVisible();
  await expect(page.locator("#tabbtn-conf")).toBeVisible();
  await expect(page.locator("#tabbtn-utils")).toHaveCount(0);
  // D70 §8.4 — no preset's bar names `agents`, so the gallery is the menu's ONE item under every
  // layout: the affordance DOCKS into the appbar (chrome is "visible" here) as the direct form, and
  // the floating launcher stays unmounted.
  await expect(page.locator(".kit-appbar .navmenu-launch")).toHaveCount(1);
  await expect(page.locator(".navmenu:not(.docked)")).toHaveCount(0);

  // Conf hosts the Tools group.
  await page.locator("#tabbtn-conf").click();
  await expect(page.locator("#utils-hosted")).toBeVisible();
});

test("minimal · 2-tab (visible chrome): conf reached via the DOCKED DIRECT button; utils hosted", async ({
  page,
}) => {
  // Default appbarMode is "visible" → the docking rule (D35 §F0 fixup): the nav affordance is an appbar
  // trailing action, NOT a floating launcher. It coexists with the tab bar (bar = fleet+agent, menu = conf).
  // Collapse ladder (F0 follow-up): with TWO off-bar sections (conf + the D70 agents gallery) the docked
  // trigger is the orbit LAUNCHER with a popover, and conf is picked from it.
  await seedUI(page, { theme: "minimal", mode: "dark", accent: "cyan", layout: "2-tab", v: 1 });
  await page.goto("/");

  // Bar = fleet + agent only.
  await expect(page.locator("#tabbtn-fleet")).toBeVisible();
  await expect(page.locator("#tabbtn-agent")).toBeVisible();
  await expect(page.locator("#tabbtn-utils")).toHaveCount(0);
  await expect(page.locator("#tabbtn-conf")).toHaveCount(0); // conf is off-bar → the menu, not the bar

  // The trigger is DOCKED inside the appbar (not floating), alongside the tab bar.
  await expect(page.locator(".kit-tabbar")).toBeVisible();
  const launch = page.locator(".kit-appbar .navmenu-launch");
  await expect(launch).toBeVisible();
  await expect(page.locator(".kit-appbar .navmenu-launch[aria-haspopup]")).toHaveCount(1); // a menu

  // Open it and pick Conf, where the Tools group is hosted.
  await launch.click();
  await page.locator(".navmenu-pop [role='menuitem']").first().click(); // conf (def order)
  await expect(page.locator("#tab-conf")).toBeVisible();
  await expect(page.locator("#utils-hosted")).toBeVisible();
});

test("minimal · 2-tab (appbar off): conf reached via the FLOATING launcher (no appbar to dock into)", async ({
  page,
}) => {
  // appbarMode "off" → there's no appbar, so the affordance can't dock: DefaultRoot mounts the standalone
  // floating trigger. Two off-bar sections (conf + the agents gallery) → the launcher form. bar = fleet+agent.
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

  // The FLOATING launcher (not inside an appbar — there is none) opens the popover conf is picked from.
  const launch = page.locator(".navmenu-launch");
  await expect(launch).toBeVisible();
  await expect(page.locator(".navmenu.docked")).toHaveCount(0);
  await expect(page.locator(".navmenu-launch[aria-haspopup]")).toHaveCount(1);

  await launch.click();
  await page.locator(".navmenu-pop [role='menuitem']").first().click(); // conf (def order)
  await expect(page.locator("#tab-conf")).toBeVisible();
  await expect(page.locator("#utils-hosted")).toBeVisible();
});

test("minimal · appbarMode minimal (4-tab): the floating menu carries ALL nav + the NavHome quick-jump", async ({
  page,
}) => {
  // The all-off-bar endpoint ("1-tab mode IS minimal"): no appbar, no tab bar — the floating orbit menu
  // lists every unhosted section (all five under the default 4-tab; menu>1 → still the launcher+popover).
  // F0 follow-up: the top-left NavHome quick-jump appears when you're OFF the primary section (fleet).
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

  // The seed boots on fleet (the primary section) → NavHome is HIDDEN (a "home" button that only re-lands
  // where you stand is clutter).
  await expect(page.locator(".navhome")).toHaveCount(0);

  // Open the orbit menu → every unhosted section (menu>1, unchanged by the collapse ladder).
  await launch.click();
  const items = page.locator(".navmenu-pop [role='menuitem']");
  await expect(items).toHaveCount(5); // fleet · agent · utils · conf · agents — nothing hosted in 4-tab

  // Navigate OFF the primary (to chat/agent) → NavHome now appears.
  await items.nth(1).click(); // agent (def order)
  await expect(page.locator("#tab-agent")).toBeVisible();
  const navhome = page.locator(".navhome");
  await expect(navhome).toBeVisible();

  // Tapping NavHome jumps back to the primary section (fleet), and it self-hides again.
  await navhome.click();
  await expect(page.locator("#tab-fleet")).toBeVisible();
  await expect(page.locator(".navhome")).toHaveCount(0);
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

// ── gacha · the layout fence, driven for real (D52 G0 / §10.5) ────────────────────────────────────────
// gacha is the second theme to DEFAULT to a narrowed bar (3-tab), and the first to carry per-tab sub-labels.
// The fence says a theme must genuinely honor EVERY preset — so these drive the two presets its default
// isn't, and assert the sub-labels survive the relocation (a 4-tab gacha must be a complete look, not a
// fallback). The 3-tab default itself is covered by the kit-render sweep + the jsdom arms.

test("gacha · 4-tab: the pick is honored — utils returns to the bar WITH its Japanese sub-label", async ({
  page,
  pageErrors,
}) => {
  await seedUI(page, { theme: "gacha", mode: "dark", accent: "arcade", layout: "4-tab", v: 1 });
  await page.goto("/");

  await expect(page.locator("#tabbtn-utils")).toBeVisible(); // back on the bar, off its 3-tab default
  await expect(page.locator(".kit-tabbar [role='tab']")).toHaveCount(4);
  await expect(page.locator(".navmenu")).toHaveCount(0);
  // All four sub-labels render (the exact-copy claim, driven in the real built app).
  await expect(page.locator(".kit-tabbtn .sub")).toHaveCount(4);
  await expect(page.locator("#tabbtn-utils .sub")).toHaveText("ツール");
  expect(pageErrors).toEqual([]);
});

// ── M2 · the navigation transition, driven for real (D52 G4 / §10.1) ──────────────────────────────────
// The decorator is unflagged now, so a REAL tab tap in a REAL engine must actually start a root View
// Transition under gacha — and must not start one anywhere else. The stamp is transient (it clears when
// the transition settles), so both arms RECORD attribute mutations rather than racing a poll against a
// ~500 ms flight; the observer is installed before the tap and read after it.
//
// EVERY set is recorded, not the distinct VALUES (Codex G4 F4): de-duplicating pinned which value won and
// said nothing about how many transitions ran — one stamp and fifty would have read identically, so a
// decorator that fired once and then stopped (or fired on every render) would have passed. Removals are
// skipped, so the list is exactly "the stamps that went up".
const recordTransitionStamps = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __vt: string[] }).__vt = seen;
    new MutationObserver((records) => {
      // A callback can carry SEVERAL records (a stamp and its removal batch into one microtask), and a
      // record reports only the value BEFORE it — so the value AFTER record i is the next record's
      // `oldValue`, and the live attribute for the last one. That reconstruction is what makes the count
      // exact instead of "whatever the attribute happened to read when the observer fired".
      const current = document.documentElement.dataset.transition ?? null;
      records.forEach((r, i) => {
        const after = i + 1 < records.length ? records[i + 1].oldValue : current;
        if (after !== null) seen.push(after);
      });
    }).observe(document.documentElement, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["data-transition"],
    });
  });
};
const transitionStamps = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __vt: string[] }).__vt);

test("gacha · M2: a tab tap runs through a `tab`-stamped root View Transition", async ({
  page,
  pageErrors,
}) => {
  // `motion` is seeded explicitly: the store's first-load default honors the OS query once, and a CI
  // machine advertising `prefers-reduced-motion` would bypass the transition for the right reason and
  // fail this for the wrong one.
  await seedUI(page, {
    theme: "gacha",
    mode: "dark",
    accent: "arcade",
    motion: "full",
    tab: "fleet",
    v: 1,
  });
  await page.goto("/");
  await expect(page.locator("#tabbtn-agent")).toBeVisible();
  await recordTransitionStamps(page);

  await page.locator("#tabbtn-agent").click();
  await expect(page.locator("#tab-agent")).toBeVisible(); // the navigation itself is never gated on it
  // …and the stamp is not left behind: the cleanup is what keeps the NEXT kind's CSS unpolluted — which is
  // also what makes the SECOND tap's stamp a new one rather than the first's leftover.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.transition))
    .toBeUndefined();

  // A SECOND real tap: two navigations must stamp TWICE. The count is the assertion (Codex G4 F4) — a
  // decorator that ran only on the first navigation, or one that stamped on every render, both produced
  // the same single `["tab"]` a de-duplicated recorder saw.
  await page.locator("#tabbtn-fleet").click();
  await expect(page.locator("#tab-fleet")).toBeVisible();
  await expect.poll(() => transitionStamps(page)).toEqual(["tab", "tab"]);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.transition))
    .toBeUndefined();
  expect(pageErrors).toEqual([]);
});

test("cosmos · M2 is gacha's alone: a tab tap stamps nothing", async ({ page, pageErrors }) => {
  await seedUI(page, { theme: "cosmos", mode: "dark", motion: "full", tab: "fleet", v: 1 });
  await page.goto("/");
  await expect(page.locator("#tabbtn-agent")).toBeVisible();
  await recordTransitionStamps(page);

  await page.locator("#tabbtn-agent").click();
  await expect(page.locator("#tab-agent")).toBeVisible();
  expect(await transitionStamps(page)).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("gacha · 2-tab: conf via the DOCKED direct button; utils still hosted", async ({
  page,
  pageErrors,
}) => {
  await seedUI(page, { theme: "gacha", mode: "dark", accent: "arcade", layout: "2-tab", v: 1 });
  await page.goto("/");

  await expect(page.locator("#tabbtn-fleet")).toBeVisible();
  await expect(page.locator("#tabbtn-agent")).toBeVisible();
  await expect(page.locator("#tabbtn-utils")).toHaveCount(0);
  await expect(page.locator("#tabbtn-conf")).toHaveCount(0); // off-bar → the docked affordance

  const launch = page.locator(".kit-appbar .navmenu-launch");
  await expect(launch).toBeVisible();
  await expect(page.locator(".kit-appbar .navmenu-launch[aria-haspopup]")).toHaveCount(0);

  await launch.click();
  await expect(page.locator("#tab-conf")).toBeVisible();
  await expect(page.locator("#utils-hosted")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("gacha · chrome fidelity: floating nav pill, white indicator + pink hard shadow, dissolving appbar", async ({
  page,
  pageErrors,
}) => {
  // The owner's G0 eyeball wave, measured on COMPUTED styles in the real built app — the only place the
  // @layer/@scope cascade actually runs (jsdom can't replay it, so this can't be a unit test). Each
  // assertion is one of the five mismatches the owner flagged against the prototype.
  await seedUI(page, { theme: "gacha", mode: "dark", accent: "arcade", v: 1 });
  await page.goto("/");
  await expect(page.locator(".kit-tabbar")).toBeVisible();

  // 1 + 2. The nav FLOATS OVER the scroller — absolutely positioned and inset, like the kit's composer
  //        one element up (the owner's round-2 note: content must pass under it, not stop above it).
  const nav = await page.locator(".kit-tabbar").evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      position: s.position,
      radius: s.borderTopLeftRadius,
      left: s.left,
      right: s.right,
      minHeight: s.minHeight,
      borderWidth: s.borderTopWidth,
      shadow: s.boxShadow,
      backdrop: s.backdropFilter,
    };
  });
  expect(nav.position).toBe("absolute");
  expect(nav.radius).toBe("16px");
  expect(nav.left).toBe("12px");
  expect(nav.right).toBe("12px");
  expect(nav.minHeight).toBe("66px"); // the prototype's slim bar (owner round 2, item B)
  expect(nav.borderWidth).toBe("1px");
  expect(nav.shadow).not.toBe("none");
  expect(nav.backdrop).toContain("blur");

  // …and the scroller RUNS BEHIND it: the bar must overlap the scroll area, and the scroller must pad
  // its bottom past the bar so the last row can still be reached. Both halves, or "floating" is just a
  // shadow over dead space.
  //
  // Measured on a NO-COMPOSER section (Codex G0 L1): on Fleet the composer alone contributes ~64px of
  // padding, so a clearance assertion there passes even with the nav zone missing entirely. Conf has no
  // composer, so `--composer-h` is 0 and the padding under test is purely the nav's.
  await page.locator("#tabbtn-conf").click();
  await expect(page.locator("#tab-conf")).toHaveClass(/active/);
  const geo = await page.evaluate(() => {
    const barEl = document.querySelector(".kit-tabbar")!;
    const bar = barEl.getBoundingClientRect();
    const scroll = document.querySelector("#app-scroll")!;
    const s = getComputedStyle(scroll);
    const shellEl = document.querySelector(".kit")!;
    const shell = getComputedStyle(shellEl);
    return {
      overlaps: scroll.getBoundingClientRect().bottom > bar.top,
      padBottom: parseFloat(s.paddingBottom),
      scrollPadBottom: parseFloat(s.scrollPaddingBottom),
      composerH: parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--composer-h"),
      ),
      barHeight: bar.height,
      declaredBarH: parseFloat(shell.getPropertyValue("--gc-nav-bar-h")),
      // The REAL bottom inset, measured — a custom property holding `max(…, env(…))` comes back from
      // getComputedStyle as the unevaluated token string, so it can't be parsed as a number.
      insetB: shellEl.getBoundingClientRect().bottom - bar.bottom,
    };
  });
  expect(geo.overlaps).toBe(true);
  expect(geo.composerH).toBe(0); // the arm really is on a composer-less section
  // The bar's REAL height must match the arithmetic constant the zone reserves (Codex G0 L3): the
  // declared `min-height: 66px` never binds — 52px buttons + 7px padding + 1px border, border-box.
  expect(geo.barHeight).toBe(geo.declaredBarH);
  expect(geo.barHeight).toBe(68);
  // Clearance = the whole nav zone, not just "more than the bar".
  expect(geo.padBottom).toBeGreaterThanOrEqual(geo.barHeight + geo.insetB);
  expect(geo.scrollPadBottom).toBeGreaterThanOrEqual(geo.barHeight + geo.insetB);

  // 3. The indicator is a WHITE pill with the hard offset pink shadow (not the kit's accent line).
  const ind = await page.locator(".kit-tab-ind .bar").evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, shadow: s.boxShadow, radius: s.borderTopLeftRadius };
  });
  expect(ind.bg).toBe("rgb(255, 255, 255)");
  expect(ind.radius).toBe("12px");
  expect(ind.shadow).toContain("5px 5px"); // the hard offset — no blur radius
  expect(ind.shadow).toContain("255, 108, 177"); // #ff6cb1, the near-trio nav pink

  // 4. The appbar DISSOLVES (a gradient, not a flat fill) and casts no shadow; the kit's top edge scrim —
  //    what actually read as that shadow — is nulled.
  const bar = await page.locator(".kit-appbar").evaluate((el) => {
    const s = getComputedStyle(el);
    return { image: s.backgroundImage, shadow: s.boxShadow, backdrop: s.backdropFilter };
  });
  expect(bar.image).toContain("linear-gradient");
  expect(bar.shadow).toBe("none");
  expect(bar.backdrop).toContain("blur");
  const scrim = await page
    .locator(".kit-main")
    .evaluate((el) => getComputedStyle(el, "::before").backgroundImage);
  expect(scrim).toBe("none");

  // 5. The toggles: the TWO-stop pink→violet track, a white knob, the prototype's 48×28 geometry.
  await page.locator("#tabbtn-conf").click();
  const knob = page.locator(".kit .switch.on .knob").first();
  await expect(knob).toBeVisible();
  const sw = await knob.evaluate((el) => {
    const s = getComputedStyle(el);
    const k = getComputedStyle(el, "::after");
    return { image: s.backgroundImage, w: s.width, h: s.height, knobBg: k.backgroundColor };
  });
  expect(sw.image).toContain("linear-gradient");
  expect(sw.image).toContain("255, 108, 174"); // #ff6cae
  expect(sw.image).toContain("114, 91, 255"); // #725bff — the two-stop, NOT the tri-gradient's cyan
  expect(sw.image).not.toContain("229, 255"); // no #54e5ff stop
  expect(sw.w).toBe("48px");
  expect(sw.h).toBe("28px");
  expect(sw.knobBg).toBe("rgb(255, 255, 255)");

  expect(pageErrors).toEqual([]);
});

// ── gacha · the 5★ pair card's narrow-viewport rung ───────────────────────────────────────────────────
// The rarity row and the status pill both hang off a pair card's top edge from opposite corners, and the
// pill is later in the DOM — so on a narrow phone it PAINTED OVER the last stars, losing the one thing a
// capsule card exists to announce. Measured rather than argued: at a 320px viewport the row reaches ~96px
// into a 135px face while the SLEEPING pill starts at ~73px, and the two only stop colliding at 366px.
// gacha.css therefore drops the pill to the `NEW` ribbon's rung below 380px, and this arm drives BOTH ends
// of that rule in the real built app — a media query nobody exercises is a comment.
//
// The fixture is its own: the baseline mock's hosts carry no `services`, and `starsFor` reads the
// CONFIGURED count, so the worst case (five stars + the wider SLEEPING pill) has to be dealt deliberately.
// Three hosts is the shape that puts a pair card in the track at all — `cardShapes` makes host[0] featured
// and pairs the rest, with no trailing odd host to take the wide slot.
const FIVE_STAR_HOSTS = [true, false, false].map((online, i) => ({
  id: ["vault", "corsair", "emma"][i],
  name: ["vault", "corsair", "emma"][i],
  ip: `192.168.1.${137 + i}`,
  mac: null,
  os_type: "linux",
  role: "server",
  tags: [],
  services: Array.from({ length: 5 }, (_, s) => ({ name: `svc${s}`, port: 1000 + s })),
  status: { online, latency_ms: online ? 3 : null, checked_at: "2026-06-24T00:00:00Z" },
}));

test("gacha · a 5★ pair card's stars are never under the status pill, at any phone width", async ({
  page,
  pageErrors,
}) => {
  await page.route("**/api/hosts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FIVE_STAR_HOSTS),
    }),
  );
  await seedUI(page, { theme: "gacha", mode: "dark", accent: "arcade", tab: "fleet", v: 1 });
  await page.goto("/");

  // The SLEEPING pair card — the wide-pill worst case. `.feat`/`.wide` are excluded exactly as the CSS
  // rule excludes them: they carry twice the face and were never in the collision.
  const card = page.locator(".gc-track .gc-card.pair.sleep").first();
  await expect(card).toBeVisible();
  // Geometry measured against the FACE, which is the containing block both are absolute to — so the
  // numbers mean the same thing the CSS's `top` does, at any viewport.
  const probe = () =>
    card.evaluate((el) => {
      const face = el.querySelector(".gc-card-face")!.getBoundingClientRect();
      const rar = el.querySelector(".rar")!.getBoundingClientRect();
      const pill = el.querySelector(".state")!.getBoundingClientRect();
      return {
        stars: el.querySelectorAll(".rar .gc-star").length,
        pillText: el.querySelector(".state")!.textContent,
        pillTop: Math.round(pill.top - face.top),
        // The bbox intersection itself: positive on BOTH axes is what "the pill covers a star" means.
        overlapX: Math.min(rar.right, pill.right) - Math.max(rar.left, pill.left),
        overlapY: Math.min(rar.bottom, pill.bottom) - Math.max(rar.top, pill.top),
      };
    });

  await page.setViewportSize({ width: 320, height: 800 });
  const narrow = await probe();
  expect(narrow.stars).toBe(5); // the fixture really is the worst case
  expect(narrow.pillText).toBe("SLEEPING");
  expect(narrow.pillTop).toBe(32); // the ribbon's rung, one below the stars
  expect(narrow.overlapY).toBeLessThanOrEqual(0); // …so the boxes cannot intersect, however wide the row
  // Horizontally they DO still share a column at 320 — which is the whole reason the rung moved, and
  // stating it here keeps this arm honest about what is being fixed.
  expect(narrow.overlapX).toBeGreaterThan(0);

  // The cutoff's own two edges (Codex confirm round): 364 is the LAST measured colliding width — a
  // regression that narrows the media query below it would leave a real collision while 320 still
  // passed — and 381 is the first width past it, where the base rung must already be safe again.
  await page.setViewportSize({ width: 364, height: 800 });
  expect((await probe()).pillTop).toBe(32);

  await page.setViewportSize({ width: 381, height: 800 });
  const past = await probe();
  expect(past.pillTop).toBe(9);
  expect(past.overlapX).toBeLessThan(0);

  await page.setViewportSize({ width: 412, height: 800 });
  const wide = await probe();
  expect(wide.pillTop).toBe(9); // a real phone keeps the designed single rung
  expect(wide.overlapX).toBeLessThan(0); // …because at that width there is room for both
  expect(pageErrors).toEqual([]);
});

// ── vapor · the waiver's replacement (D51 V6) ─────────────────────────────────────────────────────────
// vapor declared `layouts:["4-tab"]` from D35 until D51 V6; the test here used to assert the coercion. The
// retirement's bar (R13 / Codex #11) was REAL relocation tests, so these two drive the same partitions
// minimal does — with vapor's distinguishing feature in shot: the Root-PINNED bespoke `FleetTab` body
// (`.hero` + `.dev` rows), which must keep rendering on the bar under every preset. `defaultLayout` is
// still `4-tab` (vapor's native shape — the 4-tab arm is covered by every other vapor spec).

test("vapor · 3-tab: the pick is HONORED — utils leaves the bar, hosted in Conf; pinned Fleet intact", async ({
  page,
  pageErrors,
}) => {
  await seedUI(page, { theme: "vapor", accent: "dark", layout: "3-tab", v: 1 });
  await page.goto("/");

  // Bar = fleet + agent + conf. The old waiver would have rendered FOUR buttons here.
  await expect(page.locator("#tabbtn-fleet")).toBeVisible();
  await expect(page.locator("#tabbtn-agent")).toBeVisible();
  await expect(page.locator("#tabbtn-conf")).toBeVisible();
  await expect(page.locator("#tabbtn-utils")).toHaveCount(0);
  await expect(page.locator(".navmenu")).toHaveCount(0); // menu empty in 3-tab

  // vapor's Root-pinned bespoke Fleet still owns the primary section under the narrowed bar.
  await expect(page.locator("#tab-fleet .hero")).toBeVisible();
  await expect(page.locator("#tab-fleet .dev").first()).toBeVisible();

  // Conf hosts the Tools group.
  await page.locator("#tabbtn-conf").click();
  await expect(page.locator("#utils-hosted")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("vapor · 2-tab: conf via the DOCKED direct button; utils hosted; pinned Fleet intact", async ({
  page,
  pageErrors,
}) => {
  // Default appbarMode "visible" → the nav affordance docks into vapor's kit appbar (beside its brand mark)
  // rather than floating — the same collapse ladder minimal gets, on the theme that owns the appbar's
  // `brandMark` slot.
  await seedUI(page, { theme: "vapor", accent: "dark", layout: "2-tab", v: 1 });
  await page.goto("/");

  await expect(page.locator("#tabbtn-fleet")).toBeVisible();
  await expect(page.locator("#tabbtn-agent")).toBeVisible();
  await expect(page.locator("#tabbtn-utils")).toHaveCount(0);
  await expect(page.locator("#tabbtn-conf")).toHaveCount(0); // off-bar → the menu

  // vapor's own brand mark and the docked launcher coexist in the one appbar.
  await expect(page.locator(".kit-appbar .kit-brand .vapor-mark")).toBeVisible();
  const launch = page.locator(".kit-appbar .navmenu-launch");
  await expect(launch).toBeVisible();
  await expect(page.locator(".kit-appbar .navmenu-launch[aria-haspopup]")).toHaveCount(0); // direct form

  await expect(page.locator("#tab-fleet .hero")).toBeVisible();

  await launch.click();
  await expect(page.locator("#tab-conf")).toBeVisible();
  await expect(page.locator("#utils-hosted")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("gacha · chat bubbles: white user bubble with the hard pink offset, filled bot bubble, no clip", async ({
  page,
  pageErrors,
}) => {
  // The §15 chat-hooks reskin (pulled forward from G3 by owner ruling — bubbles only). Measured on
  // COMPUTED styles with a REAL seeded thread, because the claims are about painted `.body` elements and
  // about geometry: the prototype's signature `5px 5px 0` hard shadow must have room to sit inside the
  // log's padding rather than clipping or forcing a horizontal scrollbar.
  const msg = (id: string, role: string, text: string) => ({
    id,
    thread_id: "t1",
    role,
    parts: [{ type: "text", text }],
    actor: role,
    ts: "2026-01-01T00:00:00Z",
    tokens: null,
    compacted: false,
  });
  // Route BEFORE the fixture's catch-all would answer these two with `{}`.
  await page.route("**/api/threads", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "t1",
          title: "t",
          agent: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          archived: false,
        },
      ]),
    }),
  );
  await page.route("**/api/threads/t1/messages", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        msg("m1", "user", "wake rook for me"),
        msg("m2", "assistant", "wake-on-LAN sent — it usually answers in about 40 seconds."),
        // A SYS bubble too — the third `.b` kind gacha restyles, and the third the round-4 item-H
        // font-family fence has to cover.
        msg("m3", "system", "context compacted"),
      ]),
    }),
  );

  await seedUI(page, { theme: "gacha", mode: "dark", accent: "arcade", tab: "agent", v: 1 });
  await page.goto("/");
  await expect(page.locator("#tab-agent .b.user .body")).toBeVisible();

  // The USER bubble: white fill, near-black ink, the hard offset (no blur radius) in the theme's pink.
  const user = await page.locator("#tab-agent .b.user .body").evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      bg: s.backgroundColor,
      color: s.color,
      shadow: s.boxShadow,
      radius: s.borderTopLeftRadius,
    };
  });
  expect(user.bg).toBe("rgb(255, 255, 255)");
  expect(user.color).toBe("rgb(22, 22, 44)"); // #16162c
  expect(user.shadow).toContain("5px 5px"); // hard — offset with no blur
  expect(user.shadow).toContain("255, 108, 174"); // #ff6cae
  expect(user.radius).toBe("14px");

  // The BOT bubble is FILLED here, where the kit ships it borderless.
  const bot = await page.locator("#tab-agent .b.bot .body").evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, radius: s.borderTopLeftRadius };
  });
  expect(bot.bg).toBe("rgb(34, 37, 65)"); // #222541
  expect(bot.radius).toBe("14px");

  // Owner round 4, item H. The family claim first: the shared chat tree must resolve to the THEME's body
  // face on every bubble kind, not to whatever the shell happened to pass down (§15 — one tree, reskinned
  // through its pinned hooks). Then the prototype's own `.msg` type metrics, which the bubble port had
  // left behind: 12.5px (theme.css:87) over base.css's 1.45, on BOTH sides.
  const type = await page.evaluate(() => {
    const of = (sel: string) => {
      const s = getComputedStyle(document.querySelector(sel)!);
      return { ff: s.fontFamily, size: s.fontSize, lh: s.lineHeight };
    };
    return {
      shell: getComputedStyle(document.querySelector(".kit")!).fontFamily,
      user: of("#tab-agent .b.user .body"),
      bot: of("#tab-agent .b.bot .body"),
      sys: of("#tab-agent .b.sys .body"),
    };
  });
  expect(type.shell).toContain("Zen Kaku Gothic New");
  for (const k of ["user", "bot", "sys"] as const) {
    expect(type[k].ff, `${k} bubble font-family`).toBe(type.shell);
  }
  expect(type.user.size).toBe("12.5px");
  expect(type.bot.size).toBe("12.5px");
  // 12.5 x 1.45 = 18.125 — the prototype's own computed line box.
  expect(parseFloat(type.user.lh)).toBeCloseTo(18.125, 2);
  expect(parseFloat(type.bot.lh)).toBeCloseTo(18.125, 2);

  // The LOG's own box (G3 U4): the prototype's tighter gutter and rhythm, not the kit's. Measured here
  // rather than asserted in CSS because the claim is about the cascade — the kit ships `6px 18px 12px` /
  // `gap: 14px` and the theme overrides only the two halves that are the prototype's own.
  const log = await page.locator("#tab-agent .chat-log").evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      padLeft: s.paddingLeft,
      padRight: s.paddingRight,
      gap: s.rowGap,
      padTop: s.paddingTop,
    };
  });
  expect(log.padLeft).toBe("14px"); // theme.css:82 — the kit's 18px
  expect(log.padRight).toBe("14px");
  expect(log.gap).toBe("12px"); // base.css:57 — the kit's 14px
  expect(log.padTop).toBe("6px"); // …and the kit's own top space is KEPT (the privilege row sits above)

  // The USER row's NAME LABEL sits at the bubble's LEFT (start) edge — the shared thread's own behaviour
  // in every theme, measured here because gacha is the theme that re-sizes the bubble's type and box and
  // could most easily knock it off (owner finding, G3 round 2).
  const whoRow = await page.evaluate(() => {
    const row = document.querySelector("#tab-agent .b.user")!;
    const r = (sel: string) => {
      const b = row.querySelector(sel)!.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right) };
    };
    return { who: r(".who"), body: r(".body") };
  });
  expect(whoRow.who.left).toBe(whoRow.body.left); // the label starts where the bubble starts
  expect(whoRow.who.right).toBe(whoRow.body.right); // …and neither overhangs the other

  // The shadow has ROOM: the bubble's right edge plus the 5px offset stays inside the log's box, and the
  // scroller never gains a horizontal overflow.
  const fit = await page.evaluate(() => {
    const body = document.querySelector("#tab-agent .b.user .body")!.getBoundingClientRect();
    const log = document.querySelector("#tab-agent .chat-log")!.getBoundingClientRect();
    const scroll = document.querySelector("#app-scroll")!;
    return {
      slack: log.right - (body.right + 5),
      overflowX: scroll.scrollWidth - scroll.clientWidth,
    };
  });
  expect(fit.slack).toBeGreaterThanOrEqual(0);
  expect(fit.overflowX).toBe(0);

  expect(pageErrors).toEqual([]);
});

test("gacha · appbarMode minimal: no tab bar → the nav zone collapses to the kit's own geometry", async ({
  page,
  pageErrors,
}) => {
  // Codex G0 M2. `minimal` renders NO `.kit-tabbar`, so an unconditional nav zone left a phantom gap
  // under the content and floated the composer that far off the bottom. The zone is switched on by the
  // BAR'S PRESENCE, so this asserts the collapse is exact — the kit's own numbers, not "smaller".
  await seedUI(page, {
    theme: "gacha",
    mode: "dark",
    accent: "arcade",
    appbarMode: "minimal",
    tab: "fleet",
    v: 1,
  });
  await page.goto("/");
  await expect(page.locator(".navmenu-launch")).toBeVisible();
  await expect(page.locator(".kit-tabbar")).toHaveCount(0);

  const geo = await page.evaluate(() => {
    const shell = getComputedStyle(document.querySelector(".kit")!);
    const scroll = document.querySelector("#app-scroll")!;
    const composer = document.querySelector(".kit-composer")!;
    const root = getComputedStyle(document.documentElement);
    return {
      zone: shell.getPropertyValue("--gc-nav-zone").trim(),
      padBottom: parseFloat(getComputedStyle(scroll).paddingBottom),
      composerBottom: parseFloat(getComputedStyle(composer).bottom),
      composerH: parseFloat(root.getPropertyValue("--composer-h")),
    };
  });
  expect(geo.zone).toBe("0px");
  expect(geo.composerBottom).toBe(12); // the kit's own anchor, not lifted past a bar that isn't there
  expect(geo.padBottom).toBe(geo.composerH + 24); // the kit's own formula exactly
  expect(pageErrors).toEqual([]);
});

test("gacha · the composer's satellite overlays clear the floating nav", async ({
  page,
  pageErrors,
}) => {
  // Codex G0 M1. `.kit-suggest` / `.tools-sheet` / `.plan-sheet` anchor off `--composer-h` to sit just
  // above the composer's top edge; lifting the composer without lifting them put the first two ON the
  // composer and the plan sheet's lower half behind it and the bar. Driven through the real tools menu,
  // which is the one satellite reachable without a live turn.
  await seedUI(page, { theme: "gacha", mode: "dark", accent: "arcade", tab: "agent", v: 1 });
  await page.goto("/");
  await expect(page.locator(".kit-composer")).toBeVisible();

  await page.locator(".kit-cbtn.tools").click();
  const sheet = page.locator(".tools-sheet.open");
  await expect(sheet).toBeVisible();
  // Settle the .2s open slide before measuring — mid-transition the sheet is still translated 14px down,
  // which reads as a 6px overlap that isn't there once it lands.
  await expect(sheet).toHaveCSS("transform", "none");

  const gap = await page.evaluate(() => {
    const s = document.querySelector(".tools-sheet.open")!.getBoundingClientRect();
    const c = document.querySelector(".kit-composer")!.getBoundingClientRect();
    const bar = document.querySelector(".kit-tabbar")!.getBoundingClientRect();
    return { sheetBottom: s.bottom, composerTop: c.top, barTop: bar.top };
  });
  // The sheet sits ABOVE the composer's top edge — not overlapping it, and therefore not the bar below.
  expect(gap.sheetBottom).toBeLessThanOrEqual(gap.composerTop);
  expect(gap.sheetBottom).toBeLessThan(gap.barTop);
  expect(pageErrors).toEqual([]);
});

test("gacha · appbar: prototype padding in the default mode; a dissolve + no inner halo in clear mode", async ({
  page,
  pageErrors,
}) => {
  // Owner round-3, items E and F.
  await seedUI(page, { theme: "gacha", mode: "dark", accent: "arcade", tab: "fleet", v: 1 });
  await page.goto("/");
  await expect(page.locator(".kit-appbar")).toBeVisible();

  // E — SUPERSEDED 2026-08-05 (owner: the "on" bar sits as slim as clear — commit 693a06a): the bar
  // carries the clear mode's 8/6 vertical pads with gacha's prototype 16px sides, replacing round-3's
  // prototype-literal `14px 16px`. (This arm shipped one push broken: push CI skips e2e, so the pad
  // change landed green — the tag gate or a local full run is where this file actually fires.)
  const bar = await page.locator(".kit-appbar").evaluate((el) => {
    const s = getComputedStyle(el);
    return { pad: s.padding, height: el.getBoundingClientRect().height };
  });
  expect(bar.pad).toBe("8px 16px 6px");
  // ~57px at the prototype pads; ~43 at the slim ones (the 28.8px brand block + 14px of padding).
  expect(bar.height).toBeLessThanOrEqual(46);
  // `--appbar-h` is MEASURED, so everything anchored to it (the M7 oracle math, toasts, the mini-player)
  // follows the trim rather than assuming the old number.
  const appbarH = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--appbar-h")),
  );
  // `offsetHeight` rounds, so compare to the fractional rect within a pixel.
  expect(Math.abs(appbarH - bar.height)).toBeLessThan(1);

  // F — the CLEAR mode. Two claims: the bar keeps a near-transparent dissolve as a backing (glyphs never
  // float over arbitrary content with no contrast), and the kit's inherited legibility halo is nulled ON
  // THE WORDMARK — with `background-clip: text` + `color: transparent` that dark halo paints on top of
  // the gradient, inside every letter, which is the "shadow in the inside" the owner saw.
  await seedUI(page, {
    theme: "gacha",
    mode: "dark",
    accent: "arcade",
    appbarMode: "transparent",
    // The subtitle is a SWITCH since the refined G6.3 ruling (`ui.appbarSubtitleVisible`, synced, default
    // OFF) — so the halo claim below has to seed it ON, or the `.meta` span this arm measures never exists.
    appbarSubtitleVisible: true,
    tab: "fleet",
    v: 1,
  });
  await page.goto("/");
  await expect(page.locator(".kit-appbar.transparent")).toBeVisible();

  const clear = await page.evaluate(() => ({
    barImage: getComputedStyle(document.querySelector(".kit-appbar")!).backgroundImage,
    wordShadow: getComputedStyle(document.querySelector(".gc-word")!).textShadow,
    metaShadow: getComputedStyle(document.querySelector(".kit-brand .meta")!).textShadow,
  }));
  expect(clear.barImage).toContain("linear-gradient");
  expect(clear.wordShadow).toBe("none");
  expect(clear.metaShadow).not.toBe("none"); // the plain subtitle KEEPS its halo — real legibility
  expect(pageErrors).toEqual([]);
});

test("gacha · the appbar→content offset is the prototype's zero on every tab", async ({
  page,
  pageErrors,
}) => {
  // Owner round 4, item G. The prototype puts its first block FLUSH under the topbar (`.banner` at the
  // bar's bottom edge on fleet; no topbar at all on agent/settings), while the kit's first `.kit-sec`/
  // `.sec`/`.confgroup` each carry their own top space on TOP of the bar's 14px bottom pad. gacha nulls
  // that space on the FIRST block of each tab only — so this measures the real distance the way the user
  // sees it, and fails if a future slice re-introduces the stack.
  for (const tab of ["fleet", "agent", "conf"] as const) {
    await seedUI(page, { theme: "gacha", mode: "dark", accent: "arcade", tab, v: 1 });
    await page.goto("/");
    await expect(page.locator(".kit-appbar")).toBeVisible();
    await expect(page.locator(`#tab-${tab}`)).toBeVisible();

    const gap = await page.evaluate((id) => {
      const scroll = document.querySelector("#app-scroll")!;
      scroll.scrollTop = 0;
      const bar = document.querySelector(".kit-appbar")!.getBoundingClientRect();
      const first = document.querySelector(`#tab-${id}`)!.firstElementChild!;
      return first.getBoundingClientRect().top - bar.bottom;
    }, tab);
    // Sub-pixel tolerance only — the claim is FLUSH, not "small".
    expect(Math.abs(gap), `${tab}: appbar→first-block gap`).toBeLessThan(1);
  }
  expect(pageErrors).toEqual([]);
});

test("gacha · the composer placeholder is the theme's, in every composer layout", async ({
  page,
  pageErrors,
}) => {
  // Owner round 4, item I. The placeholder is APP copy, hardcoded once per composer VARIANT; gacha fills
  // it through the `placeholder` field on `ComposerSlots`. Driven across all three layouts because the
  // LAYOUT is the user's pick, not the theme's — one string has to cover them all. The e2e (rather than a
  // second unit test) is what proves the string survives the real DefaultRoot → mergeComposerSlots →
  // ThemedComposer path with the theme's setting resolving the variant.
  for (const composer of ["stacked", "sheet", "line"] as const) {
    await seedUI(page, {
      theme: "gacha",
      mode: "dark",
      accent: "arcade",
      tab: "agent",
      themeSettings: { gacha: { composer } },
      v: 1,
    });
    await page.goto("/");
    const field = page.locator("#cmd-input");
    await expect(field).toBeVisible();
    await expect(field, `${composer} layout`).toHaveAttribute("placeholder", "コマンド入力…");
  }

  // …and a kit theme in the same seat still renders the KIT's own copy — the seam's fallback is what keeps
  // every other theme byte-identical.
  await seedUI(page, { theme: "minimal", mode: "dark", accent: "cyan", tab: "agent", v: 1 });
  await page.goto("/");
  await expect(page.locator("#cmd-input")).toHaveAttribute(
    "placeholder",
    "How can I help you today?",
  );
  expect(pageErrors).toEqual([]);
});

test("gacha · the fleet WALLPAPER paints on .kit-main, only on the fleet tab, only when on", async ({
  page,
  pageErrors,
}) => {
  // M10 / §10.3. The ruling bans three hosting forms outright, so what is worth measuring is where the
  // layer actually LANDS: on `.kit-main` (the non-scrolling positioning context) rather than on the
  // scroller, and gated by BOTH of the prototype's conditions. Computed styles, because the whole point is
  // the cascade — the art URL arrives as a custom property published on `body` by the Root.
  const layer = () =>
    page.locator(".kit-main").evaluate((el) => {
      const s = getComputedStyle(el);
      return { image: s.backgroundImage, size: s.backgroundSize };
    });

  await seedUI(page, {
    theme: "gacha",
    mode: "dark",
    accent: "arcade",
    tab: "fleet",
    themeSettings: { gacha: { wallpaper: true } },
    v: 1,
  });
  await page.goto("/");
  await expect(page.locator(".gc-banner")).toBeVisible();

  const on = await layer();
  expect(on.image).toContain("url("); // the resolved roster art
  expect(on.image).toContain("gradient"); // …under the prototype's four-stop scrim
  expect(on.size).toContain("cover");
  // The SCROLLER must stay transparent, or the layer below it would never show (and a background there
  // would repaint per scroll frame — the trap kit.css:63-68 documents).
  const scroll = await page
    .locator("#app-scroll")
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(scroll).toBe("none");

  // Off-tab: the same rule's `[data-tab="fleet"]` half.
  await page.locator("#tabbtn-conf").click();
  await expect(page.locator("#tab-conf")).toBeVisible();
  expect((await layer()).image).toBe("none");

  // Setting off: the `[data-wallpaper="on"]` half.
  await seedUI(page, {
    theme: "gacha",
    mode: "dark",
    accent: "arcade",
    tab: "fleet",
    themeSettings: { gacha: { wallpaper: false } },
    v: 1,
  });
  await page.goto("/");
  await expect(page.locator(".gc-banner")).toBeVisible();
  expect((await layer()).image).toBe("none");
  expect(pageErrors).toEqual([]);
});

test("gacha · R19: the carved card stars — the def, its tokened ink, the rule reaching the star", async ({
  page,
  pageErrors,
}) => {
  // The carve is a CSS `filter: url(#gc-star-carve)` — an owner-granted §14.11 waiver (THEME_ENGINE's
  // closed SVG-filter list). Three things can kill it SILENTLY, and none is visible to a source-level
  // unit test (Codex R19 wave review, LOW-1): the def unmounting (a dangling `url(#)` UNPAINTS the
  // referencing element on Gecko), the feFlood's `var()` dangling to BLACK (the token must reach the def
  // through the gacha scope), and the card rule not resolving on the star. Computed styles on the real
  // cascade, and this spec runs on both engines.
  await seedUI(page, { theme: "gacha", mode: "dark", accent: "arcade", tab: "fleet", v: 1 });
  await page.goto("/");
  await expect(page.locator(".gc-banner")).toBeVisible();

  await expect(page.locator("filter#gc-star-carve")).toHaveCount(1);
  // `--gc-star-carve-ink` (#120726bf) resolved on the flood — a dangled var computes to solid black.
  const flood = await page
    .locator("#gc-star-carve feFlood")
    .evaluate((el) => getComputedStyle(el).floodColor);
  expect(flood).toContain("18, 7, 38");
  // …and the card row's rule reaches a real star with the live reference.
  const star = page.locator(".gc-card .rar .gc-star").first();
  await expect(star).toBeVisible();
  expect(await star.evaluate((el) => getComputedStyle(el).filter)).toContain("gc-star-carve");
  expect(pageErrors).toEqual([]);
});

test("gacha · M7: the oracle ghosts as ONE SURFACE — art and copy together — and both perf gates hold", async ({
  page,
  pageErrors,
}) => {
  // The G3 claim, measured rather than eyeballed (the G2 lesson: animations are verified with computed
  // styles or frames, never an end-state screenshot). Three things are under test and each has been a real
  // failure mode: the ramp measures from the ORACLE'S OWN OFFSET (not raw scrollTop — other tabs share
  // `#app-scroll`), the WORDS degrade with the picture (the owner's ruling — a sharp title over blurring
  // art reads as detached), and the blur half stays behind the perf gate (§14.11: blur on text on Gecko).
  const msg = (id: string, role: string, text: string) => ({
    id,
    thread_id: "t1",
    role,
    parts: [{ type: "text", text }],
    actor: role,
    ts: "2026-01-01T00:00:00Z",
    tokens: null,
    compacted: false,
  });
  await page.route("**/api/threads", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "t1",
          title: "t",
          agent: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          archived: false,
        },
      ]),
    }),
  );
  // A long thread so the pane genuinely scrolls past the ramp.
  await page.route("**/api/threads/t1/messages", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        Array.from({ length: 14 }, (_, i) =>
          msg(`m${i}`, i % 2 ? "assistant" : "user", `line ${i} of the operator transcript`),
        ),
      ),
    }),
  );

  await seedUI(page, { theme: "gacha", mode: "dark", accent: "arcade", tab: "agent", v: 1 });
  await page.goto("/");
  await expect(page.locator("#tab-agent .gc-oracle")).toBeVisible();

  /** Everything the ramp touches, at a given scroll position — including the EFFECTIVE opacity of the
   *  picture and of the words, which is the pair that has to move together. */
  const sample = async (top: number) => {
    await page.evaluate((t) => {
      document.getElementById("app-scroll")!.scrollTop = t;
    }, top);
    // let the driver's single rAF land
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    return await page.evaluate(() => {
      const block = document.querySelector<HTMLElement>("#tab-agent .gc-oracle")!;
      const q = (sel: string) => document.querySelector<HTMLElement>(`#tab-agent ${sel}`);
      const eff = (n: HTMLElement | null) => {
        let o = 1;
        let e: HTMLElement | null = n;
        while (e && e !== block.parentElement) {
          o *= parseFloat(getComputedStyle(e).opacity);
          e = e.parentElement;
        }
        return n === null ? null : +o.toFixed(3);
      };
      const soft = q(".gc-oracle-face.soft");
      const pane = document.getElementById("app-scroll")!;
      return {
        p: getComputedStyle(block).getPropertyValue("--gc-oracle-p").trim(),
        blockOpacity: +getComputedStyle(block).opacity,
        // the ZOOM rides the faces, not the block: a scale on the full-width block grows the PANE's
        // scroll area, which `overflow-x: hidden` conceals without removing (asserted below).
        transform: getComputedStyle(q(".gc-oracle-face.sharp")!).transform,
        blockTransform: getComputedStyle(block).transform,
        position: getComputedStyle(block).position,
        // the sticky pin: the art stops at the APPBAR's bottom edge, never under it (owner ruling)
        oracleTop: Math.round(block.getBoundingClientRect().top),
        barBottom: Math.round(
          document.querySelector(".kit-appbar")!.getBoundingClientRect().bottom,
        ),
        paneOverflowX: pane.scrollWidth - pane.clientWidth,
        art: eff(q(".gc-oracle-face.sharp .gc-oracle-art")),
        words: eff(q(".gc-oracle-face.sharp .gc-oracle-name h1")),
        ghostWords: eff(q(".gc-oracle-face.soft .gc-oracle-name h1")),
        ghostFilter: soft ? getComputedStyle(soft).filter : null,
        ghostDisplay: soft ? getComputedStyle(soft).display : null,
        logZ: getComputedStyle(q(".chat-log")!).zIndex,
      };
    });
  };

  const top = await sample(0);
  expect(top.p).toBe("0.000");
  expect(top.blockOpacity).toBe(1);
  expect(top.position).toBe("sticky"); // a BACKDROP the log scrolls over, not a header scrolled past
  expect(top.logZ).toBe("2"); // …and the log rides above it (the prototype's z: oracle 0 / log 2)

  // The ramp does NOT start at scrollTop 0: it starts where the ORACLE does (below the appbar). One pixel
  // of scroll therefore cannot already be ghosting it.
  expect((await sample(1)).p).toBe("0.000");

  const deep = await sample(900); // well past the 240px ramp
  expect(deep.p).toBe("1.000");
  expect(deep.blockOpacity).toBeCloseTo(0.28, 3); // the prototype's own ghost endpoint
  expect(deep.transform).not.toBe("none"); // …and its 1.06 scale, on the FACE
  expect(deep.blockTransform).toBe("none"); // …never on the block, which would widen the pane
  // THE PIN (owner ruling): the art stops flush under the measured appbar at every scroll position, and
  // the pane never gains horizontal scroll area from the zoom.
  expect(deep.oracleTop).toBe(deep.barBottom);
  expect(top.oracleTop).toBe(top.barBottom);
  expect(deep.paneOverflowX).toBe(0);
  // THE RULING: art and words are one surface. The sharp face has faded out entirely and the ghost — the
  // blurred copy — carries BOTH at the block's floor.
  expect(deep.art).toBe(0);
  expect(deep.words).toBe(deep.art);
  expect(deep.ghostWords).toBeCloseTo(0.28, 3);
  expect(deep.ghostFilter).toContain("blur");

  // Mid-ramp, the two still track each other exactly (the detached-title failure would show up here).
  const mid = await sample(200);
  expect(Number(mid.p)).toBeGreaterThan(0);
  expect(Number(mid.p)).toBeLessThan(1);
  expect(mid.words).toBe(mid.art);

  // PERF-LITE drops the blurred face outright — text blur is the §14.11-sensitive case — and the sharp
  // face stops crossfading, so the ghost is carried by the block's opacity walk alone.
  await page.evaluate(() => document.body.setAttribute("data-perf", "lite"));
  const lite = await sample(900);
  expect(lite.ghostDisplay).toBe("none");
  expect(lite.art).toBeCloseTo(0.28, 3);
  expect(lite.words).toBe(lite.art);
  await page.evaluate(() => document.body.setAttribute("data-perf", "full"));

  // REDUCED MOTION drops the scale (movement) and keeps the ghost (legibility).
  await page.evaluate(() => document.body.setAttribute("data-motion", "reduced"));
  const reduced = await sample(900);
  expect(reduced.transform).toBe("none"); // the face's zoom drops
  expect(reduced.blockOpacity).toBeCloseTo(0.28, 3);

  // The whole ramp, in both engines, never widens the page (§14.11).
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(pageErrors).toEqual([]);
});

test("gacha · the ARCADE composer skin: a flat cabinet panel here, and the same value in another theme", async ({
  page,
  pageErrors,
}) => {
  // D37/D51's shared-catalog rule made concrete (GACHA_PLAN §4.9 ledger + §10.5): composer chrome is never
  // theme CSS, so gacha's prototype bar entered the catalog as the LOOK-named `arcade` value — which every
  // theme's picker offers and every theme can wear. Both halves are measured here, because both are the
  // deal: the skin has to be faithful in gacha AND sane in a theme that never asked for it.
  const chrome = () =>
    page.locator(".kit-composer").evaluate((el) => {
      const s = getComputedStyle(el);
      const btn = document.querySelector(".kit-send") ?? document.querySelector(".kit-cbtn");
      return {
        stamp: document.body.dataset.composerSkin,
        bg: s.backgroundColor,
        backdrop: s.backdropFilter,
        borderWidth: s.borderTopWidth,
        borderColor: s.borderTopColor,
        radius: s.borderTopLeftRadius,
        padding: `${s.paddingTop} ${s.paddingLeft}`,
        shadow: s.boxShadow,
        ctrlRadius: btn ? getComputedStyle(btn).borderTopLeftRadius : null,
      };
    });

  // ── gacha, on its DECLARED default ──
  await seedUI(page, { theme: "gacha", mode: "dark", accent: "arcade", tab: "agent", v: 1 });
  await page.goto("/");
  await expect(page.locator(".kit-composer")).toBeVisible();
  const gacha = await chrome();
  expect(gacha.stamp).toBe("arcade"); // the theme declares it; no user override involved
  // the panel: OPAQUE (no frost), NO outline, the theme's own tight radius, an even gutter, and the skin's
  // HARD OFFSET in place of an ambient lift. The last two were the reverse until the owner re-ruled the skin
  // (2026-08-03): one signature — a zero-blur accent drop — and no borders anywhere in it.
  expect(gacha.bg).toBe("rgb(20, 23, 47)"); // --surface, opaque — the prototype's #15172e within 1/255
  expect(gacha.backdrop).toBe("none");
  expect(gacha.borderWidth).toBe("1px"); // the box still RESERVES its edge — only the colour goes
  expect(gacha.borderColor).toBe("rgba(0, 0, 0, 0)");
  expect(gacha.radius).toBe("14px"); // gacha's --radius = the prototype's own 14px (kit default is 20)
  expect(gacha.padding).toBe("9px 9px"); // the prototype's even 9px gutter
  expect(gacha.shadow).toMatch(/ 3px 3px 0px 0px$/); // offset by the lift, zero blur AND zero spread
  expect(gacha.ctrlRadius).toBe("10px"); // --radius-sm: the controls square off with the bar

  // ── cosmos wearing the same catalog value ──
  // The cross-theme cost the plan budgeted. Every value in the skin is a SEMANTIC token, so the look
  // travels while the palette and geometry stay the host theme's.
  await seedUI(page, {
    theme: "cosmos",
    mode: "dark",
    accent: "violet",
    tab: "agent",
    themeSettings: { cosmos: { composerSkin: "arcade" } },
    v: 1,
  });
  await page.goto("/");
  await expect(page.locator(".kit-composer")).toBeVisible();
  const cosmos = await chrome();
  expect(cosmos.stamp).toBe("arcade");
  expect(cosmos.backdrop).toBe("none");
  expect(cosmos.shadow).toMatch(/ 3px 3px 0px 0px$/);
  expect(cosmos.padding).toBe("9px 9px");
  // …its OWN surface, corner radius and accent — no gacha value leaked into the shared catalog. The drop is
  // mixed from `--accent`, so the same rule paints violet here and pink there: same shape, host's colour.
  expect(cosmos.bg).not.toBe(gacha.bg);
  expect(cosmos.radius).not.toBe(gacha.radius);
  expect(cosmos.shadow).not.toBe(gacha.shadow);

  // ── and the picker offers it everywhere (the D37 contract's visible half) ──
  await seedUI(page, { theme: "cosmos", mode: "dark", accent: "violet", tab: "conf", v: 1 });
  await page.goto("/");
  const row = page.locator(".confrow", { hasText: "Composer skin" }).first();
  await expect(row).toBeVisible();
  const labels = await row.evaluate((el) =>
    [...el.querySelectorAll("button")].map((b) => b.textContent),
  );
  expect(labels).toEqual(["Outline", "Glass", "Bezel", "Sleek", "Arcade"]);
  // five options still fit ONE row at the mobile width — the seg must not wrap into a second line
  const rows = await row.evaluate(
    (el) =>
      new Set([...el.querySelectorAll("button")].map((b) => b.getBoundingClientRect().top)).size,
  );
  expect(rows).toBe(1);
  expect(pageErrors).toEqual([]);
});

// ── The G3 fix wave's browser arms (Codex G3 M1/M2/L2) ─────────────────────────────────────────────────
// Three claims that only a real engine can settle, each one a bug that shipped: the privilege dropdown is a
// DOCUMENT-level overlay under gacha exactly as under every other theme; the kit's pinned plan panel keeps
// the kit's own sticky pin and rung; and the shared `arcade` skin holds up under every composer LAYOUT, not
// just the stacked one it was measured on.

/** A thread whose last assistant message carries a `task_plan` call — the shape `currentPlanOf` reads, and
 *  therefore the only way to make the pinned panel mount from a seeded page. */
function planThread(steps: { text: string; status: "pending" | "active" | "done" }[]) {
  return [
    {
      id: "m0",
      thread_id: "t1",
      role: "user",
      parts: [{ type: "text", text: "wake the fleet" }],
      actor: "user",
      ts: "2026-01-01T00:00:00Z",
      tokens: null,
      compacted: false,
    },
    {
      id: "m1",
      thread_id: "t1",
      role: "assistant",
      parts: [
        { type: "text", text: "Here is the plan." },
        { type: "tool_call", call_id: "c1", tool: "task_plan", args: { steps }, state: "ok" },
      ],
      actor: "assistant",
      ts: "2026-01-01T00:00:01Z",
      tokens: null,
      compacted: false,
    },
  ];
}

/** Seed one thread + its messages (the two routes every chat-shaped arm here needs). */
async function seedThread(page: Page, messages: unknown[]) {
  await page.route("**/api/threads", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "t1",
          title: "t",
          agent: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          archived: false,
        },
      ]),
    }),
  );
  await page.route("**/api/threads/t1/messages", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(messages),
    }),
  );
}

const chatLines = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    thread_id: "t1",
    role: i % 2 ? "assistant" : "user",
    parts: [{ type: "text", text: `line ${i} of the operator transcript` }],
    actor: i % 2 ? "assistant" : "user",
    ts: "2026-01-01T00:00:00Z",
    tokens: null,
    compacted: false,
  }));

test("the privilege dropdown is a DOCUMENT-level overlay — in gacha exactly as in cosmos", async ({
  page,
  pageErrors,
}) => {
  // Codex G3 M2. The chip's backdrop (fixed, z 60) and menu (z 61) are page-level rungs: while the menu is
  // open the backdrop owns EVERY other surface, so the next tap closes the menu instead of reaching the
  // composer or the bar. A theme that gives the `.sec` header a z-index turns it into a stacking context and
  // those two rungs resolve INSIDE it — the menu then loses to the composer (z 4) and the appbar (z 5), and
  // two overlays can be open at once. Hit-testing is the assertion because painting order is what broke.
  const probe = async () => {
    await page.click("#tab-agent .priv-chip");
    await expect(page.locator(".priv-menu")).toBeVisible();
    return await page.evaluate(() => {
      const hit = (x: number, y: number) => document.elementFromPoint(x, y);
      const menu = document.querySelector<HTMLElement>(".priv-menu")!;
      const mr = menu.getBoundingClientRect();
      const comp = document.querySelector<HTMLElement>(".kit-composer")!;
      const cr = comp.getBoundingClientRect();
      const bar = document.querySelector<HTMLElement>(".kit-appbar")!;
      const br = bar.getBoundingClientRect();
      const sec = document.querySelector<HTMLElement>("#tab-agent > .sec")!;
      const onMenu = hit(mr.left + mr.width / 2, mr.top + 12);
      const onComposer = hit(cr.left + cr.width / 2, cr.top + cr.height / 2);
      const onBar = hit(br.left + 12, br.top + br.height / 2);
      return {
        secZ: getComputedStyle(sec).zIndex,
        menuZ: getComputedStyle(menu).zIndex,
        backdropZ: getComputedStyle(document.querySelector(".priv-backdrop")!).zIndex,
        menuOwnsItself: !!onMenu?.closest(".priv-menu"),
        backdropOwnsComposer: !!onComposer?.classList.contains("priv-backdrop"),
        backdropOwnsAppbar: !!onBar?.classList.contains("priv-backdrop"),
      };
    });
  };

  await seedThread(page, chatLines(14));
  await seedUI(page, { theme: "gacha", mode: "dark", accent: "arcade", tab: "agent", v: 1 });
  await page.goto("/");
  await expect(page.locator("#tab-agent .gc-oracle")).toBeVisible();
  const gacha = await probe();
  expect(gacha.menuZ).toBe("61");
  expect(gacha.backdropZ).toBe("60");
  expect(gacha.secZ).toBe("auto"); // the header is POSITIONED but never a stacking context
  expect(gacha.menuOwnsItself).toBe(true);
  expect(gacha.backdropOwnsComposer).toBe(true);
  expect(gacha.backdropOwnsAppbar).toBe(true);

  // …and the reference: the same three facts under a theme that never touched the ladder.
  await seedUI(page, { theme: "cosmos", mode: "dark", accent: "violet", tab: "agent", v: 1 });
  await page.goto("/");
  await expect(page.locator("#tab-agent .priv-chip")).toBeVisible();
  const cosmos = await probe();
  expect(cosmos.menuOwnsItself).toBe(gacha.menuOwnsItself);
  expect(cosmos.backdropOwnsComposer).toBe(gacha.backdropOwnsComposer);
  expect(cosmos.backdropOwnsAppbar).toBe(gacha.backdropOwnsAppbar);
  expect(pageErrors).toEqual([]);
});

test("gacha · the PINNED plan panel keeps the kit's sticky pin and its rung", async ({
  page,
  pageErrors,
}) => {
  // Codex G3 M1. The theme's z-ladder overrode `.plan-pin-panel`'s `position: sticky` with `relative`,
  // which silently turned the PINNED placement back into an inline one: the panel scrolled away with the
  // thread. The panel is the kit's — a theme paints it, the kit positions it — so this arm measures the
  // kit's own contract through gacha: sticky, rung 4 (above the log's 2, below the appbar's 5), and still
  // on screen after the thread has scrolled far past it.
  await seedThread(page, planThread([{ text: "wake pegasus", status: "active" }]));
  await seedUI(page, {
    theme: "gacha",
    mode: "dark",
    accent: "arcade",
    tab: "agent",
    themeSettings: { gacha: { planPlacement: "pinned" } },
    v: 1,
  });
  await page.goto("/");
  const panel = page.locator(".plan-pin-panel");
  await expect(panel).toBeVisible();

  const read = async () =>
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".plan-pin-panel")!;
      const r = el.getBoundingClientRect();
      const bar = document.querySelector<HTMLElement>(".kit-appbar")!.getBoundingClientRect();
      const s = getComputedStyle(el);
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        position: s.position,
        z: s.zIndex,
        top: Math.round(r.top),
        barBottom: Math.round(bar.bottom),
        ownsItsOwnBand: !!hit?.closest(".plan-pin-panel"),
        logZ: getComputedStyle(document.querySelector("#tab-agent .chat-log")!).zIndex,
      };
    });

  const atTop = await read();
  expect(atTop.position).toBe("sticky"); // NOT relative — the theme must not disable the pin
  expect(atTop.z).toBe("4"); // the kit's rung: above the log (2), below the appbar (5)
  expect(atTop.logZ).toBe("2");
  expect(atTop.ownsItsOwnBand).toBe(true); // over the oracle art and the thread alike

  await page.evaluate(() => {
    document.getElementById("app-scroll")!.scrollTop = 600;
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  const scrolled = await read();
  // STUCK: still on screen, still just under the bar (the kit's `--appbar-h + 8px`), never travelling
  // up across the appbar's band
  expect(scrolled.top).toBeGreaterThanOrEqual(scrolled.barBottom);
  expect(scrolled.top).toBeLessThanOrEqual(scrolled.barBottom + 12);
  expect(scrolled.ownsItsOwnBand).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("the pinned plan header and the mini-player never overlap — in every chrome mode", async ({
  page,
  pageErrors,
}) => {
  // W1. The player's yield used to hard-code the header's box as a literal (`--appbar-h + 46px`), so it
  // was wrong everywhere the header did NOT sit exactly 46px under the bar: it overlapped the header by
  // 18–27px in `minimal` (whose bar-less scroller inset the literal never knew about), by 1–3px in `off`,
  // and floated 16px low in vapor (whose flush hanging tab starts higher). The fix derives the band from
  // three published inputs — the measured bar, the scroller inset, the theme's own gap — plus the MEASURED
  // header height, so this arm measures the ONE invariant that replaced the literal: an 8px gap, in every
  // theme × chrome-mode cell, at any scroll offset.
  //
  // The player is activated by starting a clip whose synth never resolves: `audioController.toggle` sets
  // `{id, status:"loading"}` BEFORE awaiting the fetch, so the pill mounts and STAYS (no audio to play in
  // a headless browser). The voice status flip is what renders the per-bubble `.tts-play` at all.
  await page.route("**/api/voice/status", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ stt: true, tts: true }),
    }),
  );
  await page.route("**/api/voice/tts", () => {}); // never fulfils → the clip stays "loading"
  await seedThread(page, [
    ...planThread([{ text: "wake pegasus", status: "active" }]),
    // a scrollable tail, so the scroll-offset arm below moves a real scroller (ids kept distinct from the
    // plan thread's m0/m1)
    ...chatLines(20).map((m, i) => ({ ...m, id: `x${i}` })),
  ]);

  // The bar-less content insets the two `:has()` token rules declare (safe-area is 0 on these devices):
  // visible = a real bar in flow → no inset; minimal = the floating launcher's clearance; off = breathing
  // room. Nothing else in the suite pins them, and the band is now built from them.
  const INSET = { visible: 0, minimal: 34, off: 10 } as const;
  const ACCENT = { cosmos: "violet", vapor: "dark" } as const;

  for (const theme of ["cosmos", "vapor"] as const) {
    for (const chrome of ["visible", "off", "minimal"] as const) {
      await seedUI(page, {
        theme,
        mode: "dark",
        accent: ACCENT[theme],
        tab: "agent",
        appbarMode: chrome,
        themeSettings: { [theme]: { planPlacement: "pinned" } },
        v: 1,
      });
      await page.goto("/");
      await expect(page.locator(".plan-pin-panel")).toBeVisible();
      await page.locator("#tab-agent .tts-play").first().click();
      await expect(page.locator(".mini-player")).toBeVisible();

      const read = async () =>
        await page.evaluate(() => {
          const head = document
            .querySelector<HTMLElement>(".plan-pin-head")!
            .getBoundingClientRect();
          const player = document
            .querySelector<HTMLElement>(".mini-player")!
            .getBoundingClientRect();
          const panel = document
            .querySelector<HTMLElement>(".plan-pin-panel")!
            .getBoundingClientRect();
          const bar = document.querySelector<HTMLElement>(".kit-appbar")?.getBoundingClientRect();
          const hit = document.elementFromPoint(
            head.left + head.width / 2,
            head.top + head.height / 2,
          );
          return {
            gap: player.top - head.bottom,
            headOwnsItsCentre: !!hit?.closest(".plan-pin-panel"),
            scrollPadTop: getComputedStyle(document.getElementById("app-scroll")!).paddingTop,
            headVar: getComputedStyle(document.documentElement).getPropertyValue("--plan-head-h"),
            panelTop: Math.round(panel.top),
            barBottom: bar ? Math.round(bar.bottom) : null,
          };
        });

      const at = await read();
      const cell = `${theme}/${chrome}`;
      expect(at.gap, cell).toBeGreaterThanOrEqual(6); // never an overlap…
      expect(at.gap, cell).toBeLessThanOrEqual(14); // …and never a floating gap either
      expect(at.headOwnsItsCentre, cell).toBe(true); // nothing is painted over the header
      expect(at.scrollPadTop, cell).toBe(`${INSET[chrome]}px`); // the `:has()` token rules fired
      expect(parseFloat(at.headVar), cell).toBeGreaterThan(20); // the head height really is published
      expect(parseFloat(at.headVar), cell).toBeLessThan(60);

      // The yield rule really CONSUMES the published variable (Codex W1 MED): the 31px fallback sits so
      // close to every real head (28.5–30.5) that a misspelled `var()` would still land inside [6,14].
      // Inject a sentinel far outside that band and demand the player moves by exactly the delta.
      if (theme === "cosmos" && chrome === "minimal") {
        const before = await page.evaluate(() => {
          const v = getComputedStyle(document.documentElement).getPropertyValue("--plan-head-h");
          const top = document.querySelector(".mini-player")!.getBoundingClientRect().top;
          document.documentElement.style.setProperty("--plan-head-h", "47px");
          return { headH: parseFloat(v), top };
        });
        const after = await page.evaluate(
          () => document.querySelector(".mini-player")!.getBoundingClientRect().top,
        );
        expect(after - before.top, `${cell} sentinel`).toBeCloseTo(47 - before.headH, 0);
        await page.evaluate(() => {
          // restore the measured value for the arms below (the inline removal above re-exposes nothing —
          // the effect wrote an inline property too, so re-publish by nudging a resize read)
          const el = document.querySelector<HTMLElement>(".plan-pin-head")!;
          document.documentElement.style.setProperty("--plan-head-h", `${el.offsetHeight}px`);
        });
      }

      // The panel is first-in-flow + sticky, so it RESTS at one spot: scrolling must not change the gap.
      const scrolledTo = await page.evaluate(() => {
        const s = document.getElementById("app-scroll")!;
        s.scrollTop = 800;
        return s.scrollTop;
      });
      expect(scrolledTo, cell).toBeGreaterThan(0); // the scroller really overflows — else this arm is vacuous
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
      const scrolled = await read();
      expect(scrolled.gap, cell).toBeCloseTo(at.gap, 1);

      // vapor's hanging tab survived the move from a `top:` on the panel to `--kit-plan-gap: 0px`.
      if (theme === "vapor" && chrome === "visible") expect(at.panelTop).toBe(at.barBottom);
    }
  }
  expect(pageErrors).toEqual([]);
});

test("gacha · a pinned plan reserves NO band over the oracle (pill floats over the art)", async ({
  page,
  pageErrors,
}) => {
  // Owner round 2026-08-19: the pinned panel's sticky flow box reserved a pill-height band of bare
  // background above the full-bleed oracle — the second first-block-geometry gap of this family
  // (c8dc09d closed the bar-less inset one). The ruling is the launcher-icon one: chrome floats OVER
  // the art, the art never yields. Pinned invariant: the oracle's seat WITH a plan equals its seat
  // WITHOUT one, in every appbar mode, fade off (static block) AND on (sticky backdrop) — and the
  // pill's box genuinely intersects the art's.
  const readOracle = () =>
    page.evaluate(() => {
      // The thread bottom-pins on load when messages exist — zero the scroll first, or the static
      // (fade-off) oracle reads scrolled-up and the seat compare is confounded.
      document.getElementById("app-scroll")!.scrollTop = 0;
      const oracle = document.querySelector<HTMLElement>(".gc-oracle")!.getBoundingClientRect();
      const head = document.querySelector<HTMLElement>(".plan-pin-head")?.getBoundingClientRect();
      return {
        top: oracle.top,
        bottom: oracle.bottom,
        head: head ? { top: head.top, bottom: head.bottom } : null,
      };
    });
  for (const fade of [false, true]) {
    for (const chrome of ["visible", "off", "minimal"] as const) {
      const cell = `fade=${fade} chrome=${chrome}`;
      await seedThread(page, []);
      await seedUI(page, {
        theme: "gacha",
        mode: "dark",
        tab: "agent",
        appbarMode: chrome,
        themeSettings: { gacha: { planPlacement: "pinned", oracle: fade } },
        v: 1,
      });
      await page.goto("/");
      await expect(page.locator(".gc-oracle")).toBeVisible();
      const bare = await readOracle();

      await seedThread(page, planThread([{ text: "wake pegasus", status: "active" }]));
      await page.goto("/");
      await expect(page.locator(".plan-pin-panel")).toBeVisible();
      await expect(page.locator(".gc-oracle")).toBeVisible();
      const withPlan = await readOracle();

      expect(
        Math.abs(withPlan.top - bare.top),
        `oracle seat drifted (${cell})`,
      ).toBeLessThanOrEqual(1);
      expect(withPlan.head, `no pill rendered (${cell})`).not.toBeNull();
      expect(withPlan.head!.bottom, `pill above the art (${cell})`).toBeGreaterThan(withPlan.top);
      expect(withPlan.head!.top, `pill below the art (${cell})`).toBeLessThan(withPlan.bottom);
    }
  }
  expect(pageErrors).toEqual([]);
});

test("gacha · the ARCADE skin holds its shape under every composer LAYOUT", async ({
  page,
  pageErrors,
}) => {
  // Codex G3 L2: the skin was only ever measured on `stacked`. The skin is the CHROME axis and the layout is
  // the STRUCTURE axis (D30/D37) — they COMPOSE, and the split is the contract: the cabinet panel's chrome
  // (opaque fill, no frost, no outline, one hard accent drop) holds under every structure, while GEOMETRY
  // stays the layout's own — the skin's radius/padding rules are deliberately `.stacked`-scoped so the
  // docked sheet's top-only corners and the line variant's stadium survive it. Both halves are asserted,
  // because a skin that reached into the other two would be the actual regression.
  const geometry = {
    stacked: { radius: "14px", bottomRadius: "14px", padTop: "9px" }, // the theme's --radius + its gutter
    sheet: { radius: "14px", bottomRadius: "0px", padTop: "0px" }, // docked: top-only corners, no padding
    line: { radius: "24px", bottomRadius: "24px", padTop: "5px" }, // the stadium, concentric with its buttons
  };
  for (const layout of ["stacked", "sheet", "line"] as const) {
    await seedUI(page, {
      theme: "gacha",
      mode: "dark",
      accent: "arcade",
      tab: "agent",
      themeSettings: { gacha: { composer: layout } },
      v: 1,
    });
    await page.goto("/");
    const bar = page.locator(".kit-composer");
    await expect(bar).toBeVisible();
    const seen = await bar.evaluate((el: HTMLElement) => {
      const s = getComputedStyle(el);
      return {
        cls: el.className,
        stamp: document.body.dataset.composerSkin,
        bg: s.backgroundColor,
        backdrop: s.backdropFilter,
        borderWidth: s.borderTopWidth,
        borderColor: s.borderTopColor,
        radius: s.borderTopLeftRadius,
        bottomRadius: s.borderBottomLeftRadius,
        padTop: s.paddingTop,
        shadow: s.boxShadow,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(seen.cls).toContain(layout === "stacked" ? "kit-composer" : layout);
    // the CHROME — identical in all three
    expect(seen.stamp).toBe("arcade");
    expect(seen.bg).toBe("rgb(20, 23, 47)"); // --surface, opaque
    expect(seen.backdrop).toBe("none");
    expect(seen.borderWidth).toBe("1px"); // the edge is RESERVED but transparent (owner ruling 2026-08-03)
    expect(seen.borderColor).toBe("rgba(0, 0, 0, 0)");
    expect(seen.shadow).toMatch(/ 3px 3px 0px 0px$/); // the one hard drop, identical in all three layouts
    // …the STRUCTURE — each layout's own, untouched by the skin
    expect(seen.radius).toBe(geometry[layout].radius);
    expect(seen.bottomRadius).toBe(geometry[layout].bottomRadius);
    expect(seen.padTop).toBe(geometry[layout].padTop);
    expect(seen.overflowX).toBeLessThanOrEqual(0);
  }
  expect(pageErrors).toEqual([]);
});

test("the PINNED PLAN HEAD wears the composer skin (the W2 vocabulary, out in the agent tab)", async ({
  page,
  pageErrors,
}) => {
  // W2 / the D37 amendment: `composerSkin` stopped being a rule per skin per surface and became ONE
  // `--skin-*` override vocabulary, which let two surfaces OUTSIDE the composer join it — the TTS
  // mini-player and this pinned plan header. The header is the interesting one to measure: it is the
  // furthest thing from the input bar that the axis now reaches, it lives in a THEME-painted panel, and it
  // is where the chip slots (`--skin-chip-edge` / `--skin-chip-elev`) are the only declarers.
  //
  // Cosmos, because it ships `outlines: true` — the no-outlines axis flattens `.plan-pin-head`'s border to
  // `none` outright, which would make the edge arm read the same under every skin and pass vacuously.
  //
  // GAP, documented rather than papered over: the sibling mini-player arm is DEFERRED. Activating the
  // player needs a per-bubble `.tts-play`, which needs a seeded assistant message AND the voice-status
  // flip — the pinned-overlap test above pays that cost for the ONE thing only a browser can settle there
  // (a geometric overlap). Re-seeding it here to re-read four custom properties would not buy a fourth
  // check of the same vocabulary; the player's consumption is pinned at source in
  // tests/theme-engine/skinVocabulary.test.ts. Do NOT add a production seam to make it cheaper.
  await seedThread(page, planThread([{ text: "wake pegasus", status: "active" }]));
  const head = async (composerSkin: string) => {
    await seedUI(page, {
      theme: "cosmos",
      mode: "dark",
      accent: "violet",
      tab: "agent",
      themeSettings: { cosmos: { planPlacement: "pinned", composerSkin } },
      v: 1,
    });
    await page.goto("/");
    await expect(page.locator(".plan-pin-head")).toBeVisible();
    return await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector<HTMLElement>(".plan-pin-head")!);
      return {
        edge: s.borderTopColor,
        width: s.borderTopWidth,
        shadow: s.boxShadow,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
  };

  // `outline` declares NOTHING — the chip keeps the kit's own accent-mix edge and no drop at all.
  const outline = await head("outline");
  expect(outline.width).toBe("1px");
  expect(outline.edge).not.toBe("rgba(0, 0, 0, 0)");
  expect(outline.shadow).toBe("none");

  // `glass` declares the edge away and no elevation: the chip's `--accent-soft` fill carries it alone.
  const glass = await head("glass");
  expect(glass.width).toBe("1px"); // the BOX is kept — only the colour goes, so nothing reflows
  expect(glass.edge).toBe("rgba(0, 0, 0, 0)");
  expect(glass.shadow).toBe("none");

  // `arcade` declares both: no edge, and the cabinet's one hard zero-blur accent drop at the lift.
  const arcade = await head("arcade");
  expect(arcade.edge).toBe("rgba(0, 0, 0, 0)");
  expect(arcade.shadow).toMatch(/ 3px 3px 0px 0px$/);
  // …and a 3px offset on a chip inside a 14px-inset sticky panel must not widen the page (§14.11).
  expect(arcade.overflowX).toBeLessThanOrEqual(0);
  expect(pageErrors).toEqual([]);
});

test("the tools-menu trigger's open RING belongs to the `outline` skin alone", async ({
  page,
  pageErrors,
}) => {
  // Owner report 2026-08-03: opening the tools/skills menu grew an accent border on its trigger under EVERY
  // skin — re-adding the very resting border glass/bezel/sleek strip from all composer controls, so an open
  // menu was the only outlined thing in a borderless bar. The ring is now gated to `outline`; everywhere else
  // the open state is the accent GLYPH alone. Two non-outline skins are covered rather than one: `bezel`,
  // which never had resting borders, and `arcade`, which is the theme's DECLARED default and therefore the
  // configuration actually shipped. (Arcade was chosen originally because it kept a visible resting
  // hairline, which would have caught a blanket `border-color: transparent` fix; the owner then removed
  // every outline from that skin, so today both arms assert the same shape. Kept anyway — a skin whose
  // default changes should not silently stop being covered.) One theme, one variable.
  const probe = async (composerSkin: string) => {
    await seedUI(page, {
      theme: "gacha",
      mode: "dark",
      accent: "arcade",
      tab: "agent",
      themeSettings: { gacha: { composerSkin } },
      v: 1,
    });
    await page.goto("/");
    const trigger = page.locator(".kit-cbtn.tools");
    await expect(trigger).toBeVisible();
    const read = () =>
      trigger.evaluate((el) => {
        const s = getComputedStyle(el);
        return { border: s.borderTopColor, glyph: s.color };
      });
    const rest = await read();
    await trigger.click();
    // Never let this pass VACUOUSLY: if the trigger stopped opening the panel entirely, "the border did not
    // change" would be trivially true. The panel has to actually be open before either reading counts.
    await expect(page.locator(".tools-sheet.open")).toBeVisible();
    // The trigger's `color` is TRANSITIONED (`.kit-cbtn`, 150ms), so a sample taken on the click frame
    // returns the interpolated START colour and the glyph looks unchanged. POLL for it to settle rather
    // than sleeping a fixed 250ms: a throttled CI worker can outlast any timeout we would pick, and the
    // glyph changing is the very thing every caller below asserts. `border-color` is not transitioned —
    // it snaps — so once the glyph has landed both readings are final.
    await expect.poll(async () => (await read()).glyph).not.toBe(rest.glyph);
    return { rest, open: await read() };
  };

  for (const skin of ["bezel", "arcade"]) {
    const { rest, open } = await probe(skin);
    expect(open.border, `${skin}: the open trigger must not grow a ring`).toBe(rest.border);
    expect(open.glyph, `${skin}: the glyph is the only open cue — it must still change`).not.toBe(
      rest.glyph,
    );
  }

  const outline = await probe("outline");
  expect(outline.open.border).not.toBe(outline.rest.border);
  // …and it appeared, rather than the edge merely going transparent (which `not.toBe(rest)` alone would pass)
  expect(outline.open.border).not.toBe("rgba(0, 0, 0, 0)");
  expect(outline.open.glyph).not.toBe(outline.rest.glyph);
  expect(pageErrors).toEqual([]);
});

// ── the Kit Art System's one STACKING obligation (the fix-wave MED) ──────────────────────────────
//
// Cosmos's planet-switcher chevrons sit at `z-index: 2` for exactly one reason, live-caught on a device in
// 2026-07-15: the BottomSheet handle's invisible 16px drag hit-strip (`.bs-handle::after`, z 1) overlaps the
// top of the name row and would otherwise SWALLOW chevron taps. The kit's machine-picture class then arrived
// with `isolation: isolate` — which leaves the surface's own place among its siblings alone but TRAPS its
// descendants, so with a picture present the whole `.cosmos-hd` competed as one z-auto box and the strip won
// again. cosmos.css puts `isolation: auto` back; this is the arm that says so in the real cascade.
//
// Both arms run the SAME probe, and that is the point: the chevron must behave identically whether or not the
// owner has dropped a picture for the machine. A populated-only test would not have caught the regression.
const HOST_ART = (names: string[]) => ({
  ns: "kit",
  collation: "casefold-natural",
  roles: {
    services: [],
    "service-banners": [],
    hosts: names.map((name) => ({
      name,
      file: `${name}.png`,
      url: `/api/media/kit/files/hosts/${name}.png`,
      format: "png",
      size_bytes: 90_000,
      revision: "1:90000",
      width: 1600,
      height: 900,
      unusable: false,
      unusable_reason: null,
    })),
    background: [],
  },
  slots: {},
});

for (const withArt of [true, false]) {
  test(`cosmos · a chevron tap where the sheet's drag strip overlaps it steps the planet — machine picture ${
    withArt ? "PRESENT" : "absent"
  }`, async ({ page, pageErrors }) => {
    // `motion: reduced` so the orbit is STATIC: Playwright refuses to click a moving target, and the
    // claim here is about hit-testing, not about animation. The sheet snaps rather than slides for the
    // same reason (kit.css's reduced-motion rule) — the stacking cascade is identical either way.
    await seedUI(page, {
      theme: "cosmos",
      mode: "dark",
      accent: "violet",
      tab: "fleet",
      motion: "reduced",
      v: 1,
    });
    if (withArt)
      await page.route("**/api/media/kit", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(HOST_ART(["vault", "corsair"])),
        }),
      );
    await page.goto("/");

    // Open the sheet on `vault` (the first fixture host, online).
    await page.locator(".cosmos-planet.on").first().click();
    await expect(page.locator(".cosmos-hd")).toBeVisible();
    await expect(page.locator(".hd-name")).toHaveText("vault");
    // The art arm must really be the art arm — otherwise "it still works" says nothing about isolation.
    await expect(page.locator(".cosmos-hd.kit-host-art")).toHaveCount(withArt ? 1 : 0);
    // The exact point the 2026-07-15 bug was about: inside the chevron's 44px expander AND inside the
    // handle's drag strip. Everything is computed live — INCLUDING the strip's height: the kit default is
    // 16px but cosmos overrides `.bs-handle::after` to 38px (cosmos.css), and a hardcoded 16 aimed both
    // the probe AND the "settled" precondition at points whose meaning depended on the very stacking fix
    // under test (Codex fix-set R2). A layout change now moves the probe instead of silently defeating it.
    const measure = () =>
      page.evaluate(() => {
        const chev = document.querySelector<HTMLElement>('.hd-chev[aria-label="Next planet"]');
        const handle = document.querySelector<HTMLElement>(".bs-handle");
        if (!chev || !handle) return null;
        const c = chev.getBoundingClientRect();
        const cx = c.left + c.width / 2;
        const cy = c.top + c.height / 2;
        const expanderTop = cy - 22; // the chevron's ::after is 44px, centred on the glyph
        const expanderBottom = cy + 22;
        const h = handle.getBoundingClientRect();
        const stripH = parseFloat(getComputedStyle(handle, "::after").height) || 0; // the REAL strip
        const stripTop = h.bottom;
        const stripBottom = stripTop + stripH;
        // The diagnostic point: the centre of the TRUE intersection of strip and expander.
        const overlap = Math.min(expanderBottom, stripBottom) - Math.max(expanderTop, stripTop);
        const y = (Math.max(expanderTop, stripTop) + Math.min(expanderBottom, stripBottom)) / 2;
        // The SETTLED precondition point: inside the expander but strictly BELOW the strip, so it is
        // reachable whatever the stacking says — the precondition must never depend on the fix under
        // test. If no such point exists the geometry is reported (settleable:false) and the test fails
        // loudly instead of timing out at the poll. Until the sheet has finished sliding in, the row is
        // off-screen and every reading below is a measurement of nothing.
        const sy = Math.min(expanderBottom - 2, Math.max(stripBottom + 2, cy));
        const settleable = sy > stripBottom && sy < expanderBottom;
        const at = (px: number, py: number) => document.elementFromPoint(px, py);
        return {
          overlap,
          settleable,
          x: cx,
          y,
          onChevron: !!at(cx, y)?.closest(".hd-chev"),
          settled: settleable && !!at(cx, sy)?.closest(".hd-chev"),
          hit: String(at(cx, y)?.className ?? "(nothing)"),
        };
      });
    await expect.poll(async () => (await measure())?.settled).toBe(true);
    const probe = await measure();

    // VACUITY GUARDS: if the strip and the expander ever stop overlapping, or no fix-independent settled
    // point exists, this test proves nothing and must say so rather than pass (or time out).
    expect(probe, "the sheet did not render its chevrons").not.toBeNull();
    expect(
      probe!.settleable,
      "no chevron point exists below the drag strip — the settled precondition cannot be established",
    ).toBe(true);
    expect(
      probe!.overlap,
      "the drag strip no longer overlaps the chevron's tap target",
    ).toBeGreaterThan(0);
    expect(probe!.onChevron, `the drag strip swallows the chevron (hit: ${probe!.hit})`).toBe(true);

    // …and the tap really steps the selection, without closing the sheet.
    await page.mouse.click(probe!.x, probe!.y);
    await expect(page.locator(".hd-name")).toHaveText("corsair");
    await expect(page.locator(".cosmos-hd")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
}

// ── the banner class paints INSIDE the row, not into its border (owner-caught 2026-08-06) ────────
//
// The kit banner recipe sizes the art `cover` against the POSITIONING area (the padding box) while the
// default painting area is the BORDER box, so on an adopter that draws a border the picture overflowed raw
// into that 1px strip — past the scrim and the veil, which are sized `auto` and stop at the padding box.
// On cosmos's `.hd-svc` (1px `--line`) a light image therefore grew a bright rim. `background-clip:
// padding-box` on the kit class is the fix, and it has to hold in the REAL cascade — cosmos declares its
// own `background-color` for the same element in a later layer, which is exactly the kind of neighbour
// that could take the clip back to its initial value.
test("cosmos · an owner banner is clipped to the row's padding box, not its border box", async ({
  page,
  pageErrors,
}) => {
  await seedUI(page, {
    theme: "cosmos",
    mode: "dark",
    accent: "violet",
    tab: "fleet",
    motion: "reduced",
    v: 1,
  });
  await page.route("**/api/media/kit", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...HOST_ART([]),
        roles: {
          ...HOST_ART([]).roles,
          "service-banners": [
            {
              name: "ssh",
              file: "ssh.png",
              url: "/api/media/kit/files/service-banners/ssh.png",
              format: "png",
              size_bytes: 90_000,
              revision: "1:90000",
              width: 1000,
              height: 300,
              unusable: false,
              unusable_reason: null,
            },
          ],
        },
      }),
    }),
  );
  await page.goto("/");
  await page.locator(".cosmos-planet.on").first().click();
  const row = page.locator(".hd-svc.kit-svc-banner").first();
  await expect(row).toBeVisible();

  const paint = await row.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      clip: s.backgroundClip,
      // …and the row really is painting the OWNER's file, or the clip claim is about nothing.
      owner: s.backgroundImage.includes("/api/media/kit/files/service-banners/ssh.png"),
      bordered: parseFloat(s.borderTopWidth) > 0,
    };
  });
  expect(paint.owner, "the row is not painting the owner's banner").toBe(true);
  expect(paint.bordered, "this row no longer draws a border — the rim class is moot").toBe(true);
  // EVERY layer, and the colour with them (it follows the bottom-most layer's value).
  expect(new Set(paint.clip.split(", "))).toEqual(new Set(["padding-box"]));
  expect(pageErrors).toEqual([]);
});

// ── PER-SECTION SCROLL RESTORATION (owner ask, 2026-08-06) ────────────────────────────────────────────
// Driven on the real built app because the claim is about a real scroller: jsdom has no layout, so the
// jsdom arms (tests/theme-engine/sectionScroll.test.tsx) can only prove the bookkeeping. Here Conf is a
// genuinely long page in a 393px viewport, so "keeps your place" is the thing the owner asked for.

test("kit shell: a section returns to where it was left; a fresh boot still starts at the top", async ({
  page,
  pageErrors,
}) => {
  await seedUI(page, { theme: "minimal", mode: "dark", accent: "cyan", v: 1 });
  await page.goto("/");
  const scroller = page.locator("#app-scroll");
  const scrollTop = () => scroller.evaluate((el) => el.scrollTop);

  // A cold boot lands at the top — the map is empty, which is the pre-restoration behaviour.
  await expect(page.locator("#tab-fleet")).toBeVisible();
  expect(await scrollTop()).toBe(0);

  // Conf is a LAZY chunk whose groups arrive with their queries, so its scroll range starts at zero and
  // grows: wait for the real page before measuring, or the offset is taken against a stub.
  await page.locator("#tabbtn-conf").click();
  await expect(page.locator("#tab-conf")).toBeVisible();
  await expect(page.locator("#providers")).toBeVisible();
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(1000);

  // Scroll it down. The target is derived from the real range, so the arm can neither pass vacuously on a
  // short page nor ask for an offset the page cannot reach.
  const target = await scroller.evaluate((el) => {
    el.scrollTo(0, Math.floor((el.scrollHeight - el.clientHeight) / 2));
    return el.scrollTop;
  });
  expect(target, "Conf is not scrollable here — the arm would prove nothing").toBeGreaterThan(100);

  // Away to Fleet — never scrolled, so it opens at the top…
  await page.locator("#tabbtn-fleet").click();
  await expect(page.locator("#tab-fleet")).toBeVisible();
  await expect.poll(scrollTop).toBe(0);

  // …and back to Conf, which is where the owner left it (±1px: a scroll range can be fractional).
  await page.locator("#tabbtn-conf").click();
  await expect(page.locator("#tab-conf")).toBeVisible();
  await expect.poll(scrollTop).toBeGreaterThan(target - 1.5);
  expect(await scrollTop()).toBeLessThan(target + 1.5);
  expect(pageErrors).toEqual([]);
});

test("kit shell: restoration does not eat the scroll-to-group handoff (utils hosted in Conf)", async ({
  page,
  pageErrors,
}) => {
  // The one flow the section-switch scroll must YIELD to. A stale `utils` deep-link under a hosting preset
  // is coerced through the nav chokepoint, which arms the group handoff; the host body (ConfTab) expands
  // the group and scrolls it into view, and DefaultRoot's parent effect runs AFTER that child effect — so
  // without the `getGroupScrollTarget()` skip it lands last and cancels the scroll outright, leaving the
  // pane at the top of Conf. The pre-restoration code carried the same guard for the same reason; this
  // drives the OUTCOME rather than the source line (themeContract.test.ts owns the source check).
  await seedUI(page, {
    theme: "minimal",
    mode: "dark",
    accent: "cyan",
    layout: "2-tab",
    tab: "utils",
    v: 1,
  });
  await page.goto("/");

  await expect(page.locator("#tab-conf")).toBeVisible(); // coerced off the stale deep-link
  await expect(page.locator("#utils-hosted")).toBeVisible();

  // The pane travelled a long way down Conf and the group is on screen — not the scrollTop 0 an
  // unguarded restore would have left (the map is empty on a cold boot, so its restore IS a reset).
  await expect
    .poll(() => page.locator("#app-scroll").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(500);
  const seen = await page.evaluate(() => {
    const s = document.getElementById("app-scroll")!;
    const g = document.getElementById("utils-hosted")!;
    const y = g.getBoundingClientRect().y - s.getBoundingClientRect().y;
    return y >= 0 && y < s.clientHeight;
  });
  expect(seen, "the Tools group is not inside the scroller's viewport").toBe(true);
  expect(pageErrors).toEqual([]);
});
