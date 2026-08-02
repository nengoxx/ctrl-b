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

test("minimal · 2-tab (visible chrome): conf reached via the DOCKED DIRECT button; utils hosted", async ({
  page,
}) => {
  // Default appbarMode is "visible" → the docking rule (D35 §F0 fixup): the nav affordance is an appbar
  // trailing action, NOT a floating launcher. It coexists with the tab bar (bar = fleet+agent, menu = conf).
  // Collapse ladder (F0 follow-up): with a lone off-bar section the docked trigger is a DIRECT button — no
  // popover — that navigates straight to conf.
  await seedUI(page, { theme: "minimal", mode: "dark", accent: "cyan", layout: "2-tab", v: 1 });
  await page.goto("/");

  // Bar = fleet + agent only.
  await expect(page.locator("#tabbtn-fleet")).toBeVisible();
  await expect(page.locator("#tabbtn-agent")).toBeVisible();
  await expect(page.locator("#tabbtn-utils")).toHaveCount(0);
  await expect(page.locator("#tabbtn-conf")).toHaveCount(0); // conf is off-bar → the menu, not the bar

  // The trigger is DOCKED inside the appbar (not floating), alongside the tab bar — and it's the DIRECT form:
  // a labelled button with NO popover semantics.
  await expect(page.locator(".kit-tabbar")).toBeVisible();
  const launch = page.locator(".kit-appbar .navmenu-launch");
  await expect(launch).toBeVisible();
  await expect(page.locator(".kit-appbar .navmenu-launch[aria-label]")).toHaveCount(1); // conf's label
  await expect(page.locator(".kit-appbar .navmenu-launch[aria-haspopup]")).toHaveCount(0); // not a menu

  // Clicking it lands directly on Conf, where the Tools group is hosted (no popover to open).
  await launch.click();
  await expect(page.locator("#tab-conf")).toBeVisible();
  await expect(page.locator("#utils-hosted")).toBeVisible();
});

test("minimal · 2-tab (appbar off): conf reached via the FLOATING DIRECT button (no appbar to dock into)", async ({
  page,
}) => {
  // appbarMode "off" → there's no appbar, so the affordance can't dock: DefaultRoot mounts the standalone
  // floating trigger. Lone off-bar section → the DIRECT form again (floating this time). bar = fleet+agent.
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

  // The FLOATING direct button (not inside an appbar — there is none) navigates straight to conf; no popover.
  const launch = page.locator(".navmenu-launch");
  await expect(launch).toBeVisible();
  await expect(page.locator(".navmenu.docked")).toHaveCount(0);
  await expect(page.locator(".navmenu-launch[aria-label]")).toHaveCount(1);
  await expect(page.locator(".navmenu-launch[aria-haspopup]")).toHaveCount(0);

  await launch.click();
  await expect(page.locator("#tab-conf")).toBeVisible();
  await expect(page.locator("#utils-hosted")).toBeVisible();
});

test("minimal · appbarMode minimal (4-tab): the floating menu carries ALL nav + the NavHome quick-jump", async ({
  page,
}) => {
  // The all-off-bar endpoint ("1-tab mode IS minimal"): no appbar, no tab bar — the floating orbit menu
  // lists every unhosted section (all four under the default 4-tab; menu>1 → still the launcher+popover).
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

  // Open the orbit menu → all four unhosted sections (menu>1, unchanged by the collapse ladder).
  await launch.click();
  const items = page.locator(".navmenu-pop [role='menuitem']");
  await expect(items).toHaveCount(4); // fleet · agent · utils · conf — nothing hosted in 4-tab

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

  // 1 + 2. The nav FLOATS: inset, rounded, bordered, shadowed, blurred.
  const nav = await page.locator(".kit-tabbar").evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      radius: s.borderTopLeftRadius,
      marginLeft: s.marginLeft,
      marginRight: s.marginRight,
      borderWidth: s.borderTopWidth,
      shadow: s.boxShadow,
      backdrop: s.backdropFilter,
    };
  });
  expect(nav.radius).toBe("16px");
  expect(nav.marginLeft).toBe("12px");
  expect(nav.marginRight).toBe("12px");
  expect(nav.borderWidth).toBe("1px");
  expect(nav.shadow).not.toBe("none");
  expect(nav.backdrop).toContain("blur");

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
