import type { Page } from "@playwright/test";

import { boot, frame, msg, tapAgent, type, type World } from "./conversationsWorld";
import { VAPOR_UI, expect, test } from "./fixtures";

// D84 / Phase 27 S9b — THE PER-HOME CONVERSATIONS SHEET through the REAL built app (CONVERSATIONS_PLAN
// §10 S9's verify list): the chat header's conversations button opens the view's HOME's sheet, at 390 px
// on all four shipped chat bodies — cosmos (the default), vapor, gacha (its bespoke `GachaAgent`) and
// frontier (its bespoke `FrontierAgent`) — and cosmos on desktop too:
//   · B7 — Emma's sheet lists Emma's conversations only, the open one marked, "New conversation" first;
//     Lynette's older L1 is reached through her sheet, and a send there is Lynette's (no `agent`);
//   · B8 — `⋯` → Rename (the prompt → the PATCH) · Delete a non-open row (the DELETE, the row gone) ·
//     Delete the OPEN conversation with a draft typed → her next latest opens holding the draft (E6);
//   · R36 — switched to Emma inside Lynette's conversation, the header opens LYNETTE's sheet.
// Every tap on a row is a real pointer hit-test, so a sheet painted UNDER the composer or the app bar
// would fail it. The fake server + the drivers are `conversationsWorld.ts` (shared with the B1→B6 spec).

const THEMES = [
  { name: "cosmos", ui: { theme: "cosmos", mode: "dark", accent: "violet" } },
  { name: "vapor", ui: { ...VAPOR_UI } },
  { name: "gacha", ui: { theme: "gacha", mode: "dark", accent: "arcade" } },
  { name: "frontier", ui: { theme: "frontier", mode: "dark", accent: "coral" } },
] as const;

const cvButton = (page: Page) => page.locator("#tab-agent .sec .cvs-btn");
const sheet = (page: Page) => page.locator(".bs-root.cvs-bs .bs-sheet");
const rows = (page: Page) => sheet(page).locator(".cvs-list > li:has(.cvs-more)");
const labels = (page: Page) => rows(page).locator(".cvs-label");
const sheetRow = (page: Page, label: string) =>
  rows(page).filter({ has: page.locator(".cvs-label", { hasText: new RegExp(`^${label}$`) }) });

/** Open the header's sheet and wait for its rows (`n` conversations). */
async function openSheet(page: Page, title: string, n: number) {
  await cvButton(page).click();
  await expect(sheet(page).locator(".cvs-title")).toHaveText(title);
  await expect(rows(page)).toHaveCount(n);
  // the sheet paints a real panel on every theme (a skin of its own, or the kit's base one)
  const paint = await sheet(page).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { color: cs.backgroundColor, image: cs.backgroundImage };
  });
  expect(paint.color !== "rgba(0, 0, 0, 0)" || paint.image !== "none").toBe(true);
}
async function closeSheet(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator(".bs-root.cvs-bs")).toHaveCount(0);
}
/** Disclose a row's actions (`⋯`) and press one. */
async function rowAction(page: Page, label: string, action: "Rename" | "Delete") {
  const r = sheetRow(page, label);
  await r.locator(".cvs-more").click();
  await r.locator(".cvs-act", { hasText: action }).click();
}
/** The chat route: the home answers unless the send names a responder. */
async function chatRoute(page: Page, w: World) {
  await page.route("**/api/agent/chat", (route) => {
    const body = route.request().postDataJSON() as { thread_id: string; agent: string | null };
    w.sent.push(body);
    const who = body.agent ?? "the home";
    const reply = msg(body.thread_id, `r${w.sent.length}`, "assistant", `${who} replies`);
    w.histories[body.thread_id] = [
      ...(w.histories[body.thread_id] ?? []),
      msg(body.thread_id, `u${w.sent.length}`, "user", "hi"),
      reply,
    ];
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        frame("thread", { threadId: body.thread_id, agent: "lynette" }) +
        frame("message.start", { messageId: reply.id }) +
        frame("text.delta", { messageId: reply.id, delta: `${who} replies` }) +
        frame("done", { state: "completed" }),
    });
  });
}

for (const t of THEMES) {
  test.describe(`conversations sheet — ${t.name}`, () => {
    // 390 px on all four; cosmos (the default) on desktop as well.
    test.skip(({ isMobile }) => !isMobile && t.name !== "cosmos", "390 px is the target");

    test("B7 — Emma's sheet is Emma's; Lynette's older L1 through HER sheet, Lynette answering", async ({
      page,
      pageErrors,
    }) => {
      const w = await boot(page, t.ui);
      w.titles.E1 = "Emma's chat";
      w.titles.L1 = "the old one";
      await chatRoute(page, w);
      await expect(page.getByText("L2 answer")).toBeVisible();

      await tapAgent(page, "emma");
      await expect(page.getByText("Emma's own chat")).toBeVisible();
      await openSheet(page, "Emma", 1);
      await expect(labels(page)).toHaveText(["Emma's chat"]); // Emma's conversations ONLY
      await expect(sheetRow(page, "Emma's chat").locator(".cvs-row")).toHaveAttribute(
        "aria-current",
        "true",
      );
      await expect(sheet(page).locator(".cvs-list > li").first()).toHaveText("New conversation");
      await closeSheet(page);

      await tapAgent(page, "lynette"); // → L2, her latest
      await expect(page.getByText("L2 answer")).toBeVisible();
      await openSheet(page, "Lynette", 2);
      await expect(labels(page)).toHaveText(["an older question", "the old one"]);
      await sheetRow(page, "the old one").locator(".cvs-row").click();
      await expect(page.getByText("L1 answer")).toBeVisible();
      await expect(page.locator(".bs-root.cvs-bs")).toHaveCount(0);

      await type(page, "hi");
      await expect(page.getByText("the home replies")).toBeVisible();
      expect(w.sent.at(-1)).toMatchObject({ thread_id: "L1", agent: null }); // Lynette, the home
      expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
    });

    test("B8 — rename, delete a non-open row, delete the OPEN one with a draft → L1 holds it", async ({
      page,
      pageErrors,
    }) => {
      const w = await boot(page, t.ui);
      w.titles.L1 = "the old one";
      w.byAgent.lynette = ["L2", "L1", "L0"];
      w.histories.L0 = [msg("L0", "L0-a", "assistant", "L0 answer")];
      w.titles.L0 = "the oldest";
      await expect(page.getByText("L2 answer")).toBeVisible();

      await openSheet(page, "Lynette", 3);
      // Rename — the prompt seeded with the title → the PATCH body
      await rowAction(page, "the old one", "Rename");
      const field = page.locator(".pm-text");
      await expect(field).toHaveValue("the old one");
      await field.fill("  a better name  ");
      await page.locator(".pm-save", { hasText: "Rename" }).click();
      await expect(sheetRow(page, "a better name")).toHaveCount(1);
      expect(w.renamed).toEqual([{ id: "L1", body: { title: "a better name" } }]);

      // Delete a NON-open row — the danger confirm → the DELETE → the row gone
      await rowAction(page, "the oldest", "Delete");
      await page.locator('[role="alertdialog"] button.go.danger').click();
      await expect(rows(page)).toHaveCount(2);
      expect(w.deleted).toEqual(["L0"]);
      await closeSheet(page);

      // Delete the OPEN conversation with a draft typed → L1 opens, the composer holds the draft
      await page.locator(".kit-composer textarea").fill("unsent draft");
      await openSheet(page, "Lynette", 2);
      await rowAction(page, "an older question", "Delete");
      await page.locator('[role="alertdialog"] button.go.danger').click();
      await expect(page.getByText("L1 answer")).toBeVisible();
      expect(w.deleted).toEqual(["L0", "L2"]);
      await expect(page.locator(".kit-composer textarea")).toHaveValue("unsent draft");
      expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
    });

    test("R36 — switched to Emma in L2, the header opens LYNETTE's sheet", async ({
      page,
      pageErrors,
    }) => {
      const w = await boot(page, t.ui);
      w.titles.L1 = "the old one";
      await expect(page.getByText("L2 answer")).toBeVisible();
      await type(page, "/agent emma");
      await expect(
        page.locator(".b.sys", {
          hasText: "// Emma answers in Lynette's conversation — /agent lynette switches back",
        }),
      ).toBeVisible();
      await openSheet(page, "Lynette", 2);
      await expect(labels(page)).toHaveText(["an older question", "the old one"]);
      expect(new Set(w.listed)).toEqual(new Set(["lynette"])); // never Emma's list
      expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
    });
  });
}
