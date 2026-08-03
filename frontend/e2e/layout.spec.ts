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

  // E — the bar carries the prototype's own `14px 16px`, not the kit's 16/12, and lands on the
  // prototype's height (a 15px wordmark over a 9px subtitle inside 28px of vertical padding).
  const bar = await page.locator(".kit-appbar").evaluate((el) => {
    const s = getComputedStyle(el);
    return { pad: s.padding, height: el.getBoundingClientRect().height };
  });
  expect(bar.pad).toBe("14px 16px");
  // 67px before the trim; ~57 after, which is the prototype's own bar height. The two paddings were a
  // wash (kit 16+12 = prototype 14+14 = 28) — the height came from the brand's inherited 1.5 line boxes.
  expect(bar.height).toBeLessThanOrEqual(58);
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
  // the panel: OPAQUE (no frost), a visible hairline, the theme's own tight radius, an even gutter, flat
  expect(gacha.bg).toBe("rgb(20, 23, 47)"); // --surface, opaque — the prototype's #15172e within 1/255
  expect(gacha.backdrop).toBe("none");
  expect(gacha.borderWidth).toBe("1px");
  expect(gacha.borderColor).not.toBe("rgba(0, 0, 0, 0)"); // unlike glass/bezel/sleek, the edge STAYS
  expect(gacha.radius).toBe("14px"); // gacha's --radius = the prototype's own 14px (kit default is 20)
  expect(gacha.padding).toBe("9px 9px"); // the prototype's even 9px gutter
  expect(gacha.shadow).toBe("none"); // a panel bolted on, not a bar floating above
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
  expect(cosmos.shadow).toBe("none");
  expect(cosmos.padding).toBe("9px 9px");
  // …its OWN surface and its OWN corner radius — no gacha value leaked into the shared catalog
  expect(cosmos.bg).not.toBe(gacha.bg);
  expect(cosmos.radius).not.toBe(gacha.radius);

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

test("gacha · the ARCADE skin holds its shape under every composer LAYOUT", async ({
  page,
  pageErrors,
}) => {
  // Codex G3 L2: the skin was only ever measured on `stacked`. The skin is the CHROME axis and the layout is
  // the STRUCTURE axis (D30/D37) — they COMPOSE, and the split is the contract: the cabinet panel's chrome
  // (opaque fill, no frost, a hairline that stays, no elevation) holds under every structure, while GEOMETRY
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
    expect(seen.borderWidth).toBe("1px");
    expect(seen.shadow).toBe("none");
    // …the STRUCTURE — each layout's own, untouched by the skin
    expect(seen.radius).toBe(geometry[layout].radius);
    expect(seen.bottomRadius).toBe(geometry[layout].bottomRadius);
    expect(seen.padTop).toBe(geometry[layout].padTop);
    expect(seen.overflowX).toBeLessThanOrEqual(0);
  }
  expect(pageErrors).toEqual([]);
});
