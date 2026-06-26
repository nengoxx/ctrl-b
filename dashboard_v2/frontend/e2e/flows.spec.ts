import { test, expect } from "./fixtures";

// D24 — critical-flow smoke: drive the real built app through the core interactions, with the relevant
// POST mocked. These catch "the UI wired up wrong / a flow throws" regressions the logic tests can't.

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
      body: JSON.stringify({ needs_confirm: false, result: { state: "ok", summary: "shutting down" }, event: { id: "e" } }),
    }),
  );
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
  await page.goto("/");

  await page.getByRole("button", { name: "shutdown vault" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: /cancel/i }).click();
  await expect(dialog).toBeHidden();
  expect(shutdownCalled).toBe(false);
});

test("Agent — sending a message shows the user's bubble", async ({ page }) => {
  // Benign chat endpoint so the send path doesn't error; we assert the user-side echo.
  await page.route("**/api/agent/chat", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ thread_id: "t1", messages: [] }) }),
  );
  await page.goto("/");
  await page.locator("#tabbtn-agent").click();

  await page.locator(".composer textarea").fill("hello agent");
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

test("Conf — an editor form's inputs are findable by their label (D25 association)", async ({ page }) => {
  await page.goto("/");
  await page.locator("#tabbtn-conf").click();
  // The Computers group is expanded by default; expand the vault machine row to reveal its form.
  await page.locator(".mwrap > .confrow").filter({ hasText: "vault" }).first().click();
  // getByLabel resolves an input only via its accessible name — proof the labels are associated.
  await expect(page.getByLabel("Hostname")).toBeVisible();
  await expect(page.getByLabel("IP address")).toBeVisible();
});

test("Conf — changing the vapor palette updates body[data-theme]", async ({ page }) => {
  await page.goto("/");
  await page.locator("#tabbtn-conf").click();

  // Appearance group is expanded by default. Theme-engine model (D28): the skin is "Vapor"; the
  // "Palette" segmented control switches vapor's frozen accent axis (Vapor/Aqua/Ember → body[data-theme]).
  await page.getByRole("button", { name: "Aqua", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "aqua");
  await expect(page.locator("body")).toHaveAttribute("data-skin", "vapor");
});
