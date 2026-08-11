import { seedUI, test, expect, VAPOR_UI } from "./fixtures";

// D24 — critical-flow smoke: drive the real built app through the core interactions, with the relevant
// POST mocked. These catch "the UI wired up wrong / a flow throws" regressions the logic tests can't.
//
// SKIN (D51 V0): a plain `goto("/")` now boots the COSMOS default, so the flows that drive vapor's bespoke
// surface — its Fleet rows (`.dev`)/shutdown buttons/waveform and its accent palettes (on the shared
// `data-accent` axis since V2) — seed `VAPOR_UI` first. The rest (Tools cards, Conf groups + editor forms)
// run on shared components that render identically under either skin, so they keep booting the default.
// D51 V4 shrank that list: vapor's CHROME is the kit's now (DefaultRoot hosting), so the composer/appbar/
// tab-bar selectors are `.kit-*` under every skin — only the Root-pinned Fleet is still vapor-specific.

test("Boot — a device with no persisted UI lands on the cosmos default (D51 V0)", async ({
  page,
  pageErrors,
}) => {
  await page.goto("/"); // deliberately NO seedUI — this IS the fresh-install path

  // FLAKE RULE (R20): gate on CONTENT the cosmos Root renders. `html[data-skin]` and the page background
  // are stamped by index.html's pre-JS FOUC script, so asserting those alone would pass before the lazy
  // Root/CSS ever landed — the flake class that burned v1.4.5. No fixed waits either; these are
  // auto-retrying content assertions.
  await expect(page.locator(".kit-appbar")).toBeVisible(); // DefaultRoot chrome
  const planet = page.locator(".cosmos-planet.on").first(); // CosmosFleet's orbital host coin
  await expect(planet).toBeVisible();
  await expect(planet).toHaveAttribute("aria-label", /^vault — online/); // …driven by the mocked fleet

  // Only NOW the identity attrs — proven to be the mounted skin's, not the bootstrap script's guess.
  await expect(page.locator("html")).toHaveAttribute("data-skin", "cosmos");
  await expect(page.locator("body")).toHaveAttribute("data-accent", "violet"); // cosmos's defaultAccent
  await expect(page.locator("body")).toHaveAttribute("data-mode", "dark"); // cosmos's defaultMode
  // The vapor-private accent axis was RETIRED at D51 V2 — nothing may write it on any skin ever again.
  await expect(page.locator("body")).not.toHaveAttribute("data-theme");
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("Tools — running a util card renders its result", async ({ page, pageErrors }) => {
  await page.route("**/api/tools/yt_captions", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { state: "ok", summary: "Captions fetched", output: null, data: {}, error: null },
        event: { id: "e1" },
      }),
    }),
  );
  await page.goto("/");
  await page.locator("#tabbtn-utils").click();

  const card = page.locator(".util", { hasText: "Yt Captions" });
  await card.locator("input").first().fill("https://youtu.be/x");
  await card.getByRole("button", { name: "run" }).click();

  await expect(card.getByText("Captions fetched")).toBeVisible();
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("Fleet — clicking a computer row body (not just the chevron) toggles it", async ({ page }) => {
  await seedUI(page, { ...VAPOR_UI, tab: "fleet" }); // vapor's Fleet — `.dev` rows (cosmos orbits planets)
  await page.goto("/");
  const row = page.locator(".dev").filter({ hasText: "vault" }).first();
  const name = row.locator(".top .name"); // the row *body*, not the chevron or an action button
  await expect(row).not.toHaveClass(/open/);
  await name.click();
  await expect(row).toHaveClass(/open/); // expanded by a body click
  await name.click();
  await expect(row).not.toHaveClass(/open/); // and collapses again
});

test("Fleet — shutdown opens the confirm dialog and confirming dismisses it", async ({ page }) => {
  await page.route("**/api/actions/shutdown_host", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        needs_confirm: false,
        result: { state: "ok", summary: "shutting down" },
        event: { id: "e" },
      }),
    }),
  );
  await seedUI(page, { ...VAPOR_UI, tab: "fleet" }); // the row-level "shutdown <host>" button is vapor's
  await page.goto("/");

  await page.getByRole("button", { name: "shutdown vault" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/shut ?down vault/i);

  await dialog.getByRole("button", { name: /shut ?down/i }).click();
  await expect(dialog).toBeHidden();
});

test("Fleet — cancelling the confirm dialog makes no request", async ({ page }) => {
  let shutdownCalled = false;
  await page.route("**/api/actions/shutdown_host", (route) => {
    shutdownCalled = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await seedUI(page, { ...VAPOR_UI, tab: "fleet" }); // same vapor row button as above
  await page.goto("/");

  await page.getByRole("button", { name: "shutdown vault" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: /cancel/i }).click();
  await expect(dialog).toBeHidden();
  expect(shutdownCalled).toBe(false);
});

// GACHA_PLAN §12.6 slice E4, pin ㉒ — SELECT-THEN-WAKE, in the real built app. The two-step survives for
// exactly one case after the owner's third-walk narrowing (an ONLINE machine opens on tap one), and it is
// the case where a mis-tap costs something: tap 1 SELECTS a sleeping machine, tap 2 runs the wake. Both
// halves are asserted, and so is the NEGATIVE that makes the second tap the only guard there is —
// `wake_host` is risk=LOW with `confirm: false`, so the registry raises no dialog (D8). If a future change
// gated it, the shutdown tests above show what that looks like and this expectation would fail.
test("Fleet — gacha's poster selects a sleeping machine, then wakes it on the second tap", async ({
  page,
  pageErrors,
}) => {
  const wakes: string[] = [];
  await page.route("**/api/actions/wake_host", (route) => {
    wakes.push(route.request().postData() ?? "");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        needs_confirm: false,
        result: { state: "ok", summary: "magic packet sent" },
        event: { id: "e" },
      }),
    });
  });
  // The poster layout rides inside the same persisted blob as the skin triple (`themeSettings`).
  await seedUI(page, {
    theme: "gacha",
    mode: "dark",
    accent: "arcade",
    tab: "fleet",
    themeSettings: { gacha: { fleetLayout: "poster" } },
    v: 1,
  });
  await page.goto("/");

  // `corsair` is the fixture's OFFLINE machine; `vault` is host[0] and therefore the resolved boot pick,
  // so corsair starts unselected. The names are the slices' own `aria-label`s (`fleet.ts#pickLabel`),
  // which spell the machine's liveness and the number of steps its control has.
  const corsair = page.getByRole("button", { name: /^corsair,/ });
  await expect(corsair).toBeVisible();
  await expect(corsair).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: /^vault,/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // TAP 1 — selection only. The registry block below the stack follows it; `aria-pressed` is the fact.
  // The zero-request negative is a BOUNDED WAIT armed before the click, not a read of `wakes` after it: a
  // handler that both selected AND dispatched could commit `aria-pressed` before its request ever reached
  // the route callback, so the sync read would pass and tap 2's poll would then count tap 1's late
  // request as its own. The waiter cannot be outrun — it is listening when the tap lands.
  const early = page.waitForRequest("**/api/actions/wake_host", { timeout: 800 }).then(
    () => true,
    () => false,
  );
  await corsair.click();
  await expect(corsair).toHaveAttribute("aria-pressed", "true");
  expect(await early, "the FIRST tap must not dispatch a wake").toBe(false);

  // TAP 2 — the wake, through the same `wake_host` seam the dossier's own button calls. The payload is
  // read off THIS request object, so it is provably the one tap 2 caused.
  const wakeReq = page.waitForRequest("**/api/actions/wake_host");
  await corsair.click();
  const req = await wakeReq;
  expect(JSON.parse(req.postData() ?? "{}")).toMatchObject({ args: { host_id: "corsair" } });
  expect(wakes, "exactly one wake in the whole flow").toHaveLength(1);
  // …and NO confirm dialog stood between the tap and the request.
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("Agent — sending a message shows the user's bubble", async ({ page }) => {
  // Benign chat endpoint so the send path doesn't error; we assert the user-side echo.
  await page.route("**/api/agent/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ thread_id: "t1", messages: [] }),
    }),
  );
  // Seeded vapor deliberately: since D51 V4 vapor's composer IS the kit's (the `sheet`/"Docked" variant),
  // so this drives the SheetComposer under vapor's tokens — the kit-render sweep covers the other skins.
  await seedUI(page, { ...VAPOR_UI, tab: "fleet" });
  await page.goto("/");
  await page.locator("#tabbtn-agent").click();

  await page.locator(".kit-composer textarea").fill("hello agent");
  await page.locator("#cmd-send").click();

  await expect(page.getByText("hello agent").first()).toBeVisible();
});

test("Conf — a settings group toggles via the keyboard (D25 disclosure)", async ({ page }) => {
  await page.goto("/");
  await page.locator("#tabbtn-conf").click();
  const group = page.locator(".confgroup").filter({ hasText: "Skills" }).first();
  const header = group.locator(".conftitle");
  await header.focus();
  await expect(header).toBeFocused(); // tabIndex makes it focusable
  const before = await group.evaluate((el) => el.classList.contains("collapsed"));
  await page.keyboard.press("Enter");
  const after = await group.evaluate((el) => el.classList.contains("collapsed"));
  expect(after).toBe(!before); // Enter toggled it (the disclosure key handler)
});

test("Conf — an editor form's inputs are findable by their label (D25 association)", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#tabbtn-conf").click();
  // The Computers group is expanded by default; expand the vault machine row to reveal its form.
  await page.locator(".mwrap > .confrow").filter({ hasText: "vault" }).first().click();
  // getByLabel resolves an input only via its accessible name — proof the labels are associated.
  // `exact` on both: getByLabel matches SUBSTRINGS, so a label containing another's text resolves
  // two elements and trips strict mode. What's under test is the ASSOCIATION, not the wording.
  await expect(page.getByLabel("Hostname", { exact: true })).toBeVisible();
  // The address field takes a DNS/MagicDNS name as well as a dotted quad (the numeric `inputMode`
  // that made a name un-typeable on Android was dropped).
  await expect(page.getByLabel("IP or DNS name", { exact: true })).toBeVisible();
});

test("Conf — changing the vapor palette updates body[data-accent]", async ({ page }) => {
  await seedUI(page, { ...VAPOR_UI, tab: "fleet" }); // vapor's own palette set (dark/aqua/ember)
  await page.goto("/");

  // @scope proof (M1): vapor's CSS is wrapped in `@scope ([data-skin=vapor])` rooted at <html>. The dark
  // page background (`html,body{background:var(--bg)}`, --bg #0a0316) must actually compute — it would be
  // the default transparent if @scope silently failed to apply (e.g. an unsupported/ mis-emitted scope).
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(10, 3, 22)");

  await page.locator("#tabbtn-conf").click();

  // Appearance group is expanded by default. Theme-engine model (D28): the skin is "Vapor"; the
  // "Palette" swatch picker (a radiogroup of color chips) switches vapor's accent on the SHARED axis
  // (Vapor/Aqua/Ember → body[data-accent], D51 V2). Each chip is a role=radio named by the palette.
  await page.getByRole("radio", { name: "Aqua", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-accent", "aqua"); // the shared accent axis
  await expect(page.locator("body")).not.toHaveAttribute("data-theme"); // the retired vapor-private axis
  await expect(page.locator("html")).toHaveAttribute("data-skin", "vapor"); // @scope identity on <html>
});

test("Fleet — live-ping canvas is sized even if Fleet wasn't the initial tab (no blank waveform)", async ({
  page,
}) => {
  // Regression: FleetTab is ALWAYS mounted (display:none when inactive), so if the user's last tab wasn't
  // Fleet, the waveform canvas first mounts hidden (0 size). The bug: `sizeCanvas` set a 0-pixel backing
  // store and only re-ran on window.resize, so switching to Fleet left the live-ping blank until a reload.
  // Fix = a ResizeObserver that re-sizes when the canvas becomes visible. So: boot on the Agent tab, switch
  // to Fleet, and assert the canvas backing store actually sized (> 0) — fails with the old window-resize code.
  // The waveform is vapor's FleetTab, so the skin is seeded explicitly (cosmos's Fleet has no waveform).
  await seedUI(page, { ...VAPOR_UI, tab: "agent" });
  await page.goto("/");
  await page.locator("#tabbtn-fleet").click();
  await expect
    .poll(() =>
      page
        .locator(".waveform canvas")
        .first()
        .evaluate((c) => (c as HTMLCanvasElement).width),
    )
    .toBeGreaterThan(0);
});

// D53 M3 — the owner's SERVICE ICONS, end to end in the real built app (the M2 owner-art precedent: the
// empty-fixture baseline proves the icon-less row, this proves the adapter is LIVE). One arm is enough
// because one component paints all five surfaces; what only a browser run can show is the whole chain —
// the `kit` index fetch, `keyFor` over the fleet's own service list, and a real load off the hardened
// mount. Vapor's Fleet is the surface with the least ceremony to open (a row click).
test("Fleet — an owner icon named after a service paints on its row (D53 M3)", async ({
  page,
  pageErrors,
}) => {
  const ICON = "/api/media/kit/files/services/ssh.png";
  // Registered after the fixtures baseline, so this wins. The exact-index glob does NOT swallow the
  // files mount (its URLs carry more path segments).
  await page.route("**/api/media/kit", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ns: "kit",
        collation: "casefold-natural",
        roles: {
          services: [
            {
              // `ssh` is the fixture fleet's first service, and it declares no kind — so this also
              // exercises `keyFor`'s fallback to the display NAME.
              name: "ssh",
              file: "ssh.png",
              url: ICON,
              format: "png",
              size_bytes: 68,
              revision: "1:68",
              width: 1,
              height: 1,
              unusable: false,
              unusable_reason: null,
            },
          ],
        },
        slots: {},
      }),
    }),
  );
  // A real (1x1) PNG on the mount, so the paint is a genuine load rather than a broken image — which is
  // also what proves the latch did NOT trip.
  await page.route("**/api/media/kit/files/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    }),
  );

  await seedUI(page, { ...VAPOR_UI, tab: "fleet" });
  await page.goto("/");
  const row = page.locator(".dev").filter({ hasText: "vault" }).first();
  await row.locator(".top .name").click();

  const icon = row.locator(".svc-row", { hasText: "ssh" }).locator("img.kit-svcicon");
  // …at the mount PATH plus the file's `?rev=` stamp: owner media is mutable in place under a stable URL,
  // so every owner-art consumer carries the revision on the query string (`ownerArt.ts#ownerArtUrl`).
  await expect(icon).toHaveAttribute("src", `${ICON}?rev=${encodeURIComponent("1:68")}`);
  // …and it DECODED: a broken image reports zero natural width, which is the state the latch removes.
  await expect.poll(() => icon.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);
  // The service with no file named for it keeps the icon-less row.
  expect(await row.locator(".svc-row", { hasText: "web" }).locator("img").count()).toBe(0);

  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});
