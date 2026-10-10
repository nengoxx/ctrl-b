import { expect, test } from "./fixtures";
import { art, boot, expectChecked, frame, json, msg, tapAgent, type } from "./conversationsWorld";

// D84 / Phase 27 — CONVERSATIONS PER AGENT through the REAL built app (CONVERSATIONS_PLAN §2's behaviour
// spec, §10 S7's e2e): B1 → B2 → B3 → B4 → B5 driven through the composer and the tools menu's agent
// rows (THE ROSTER DOOR — the checked row is the open conversation's HOME, tapping the already-checked row
// navigates), and B6's "leave mid-reply, come back, the reply is whole". The store suites pin every seam
// (`chatResponder`, `chatHop`, `chatSeen`, `chatDeleted`); what only a browser run proves is the chain —
// the real menu, the real composer verbs, the backdrop following WHO ANSWERS (the responder, else the home).
// The fake server + the drivers live in `conversationsWorld.ts` (shared with `conversationsSheet.spec.ts`).

test("B1 → B5 through the composer and the tools menu: who answers, /new, the roster door", async ({
  page,
  pageErrors,
}) => {
  const w = await boot(page);
  await page.route("**/api/agent/chat", (route) => {
    const body = route.request().postDataJSON() as { thread_id: string; agent: string | null };
    w.sent.push(body);
    const who = body.agent ?? "lynette";
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
        frame("message.start", { messageId: reply.id, agent: who }) +
        frame("text.delta", { messageId: reply.id, delta: `${who} replies` }) +
        frame("done", { state: "completed" }),
    });
  });
  await expect(page.getByText("L2 answer")).toBeVisible();
  await expect(art(page)).toHaveAttribute("src", /lynette\.webp/);

  // B1 — `/agent emma` in Lynette's L2: the note, the backdrop shows Emma, the CHECKED row stays Lynette.
  await type(page, "/agent emma");
  await expect(
    page.locator(".b.sys", {
      hasText: "// Emma answers in Lynette's conversation — /agent lynette switches back",
    }),
  ).toBeVisible();
  await expect(art(page)).toHaveAttribute("src", /emma\.webp/);
  await expectChecked(page, "lynette");
  await type(page, "hi");
  await expect(page.getByText("emma replies")).toBeVisible();
  expect(w.sent.at(-1)).toMatchObject({ thread_id: "L2", agent: "emma" });

  // B2 — `/new` while switched: a fresh LYNETTE conversation (never Emma's), the responder gone.
  await type(page, "/new");
  await expect(page.getByText("L3 greeting")).toBeVisible();
  expect(w.minted).toEqual([{ agent: "lynette" }]);
  await expect(art(page)).toHaveAttribute("src", /lynette\.webp/);
  await expectChecked(page, "lynette");

  // B3 — pick Emma in the roster: her own latest (E1) opens; Emma talks.
  await tapAgent(page, "emma");
  await expect(page.getByText("Emma's own chat")).toBeVisible();
  await expect(art(page)).toHaveAttribute("src", /emma\.webp/);
  await expectChecked(page, "emma");

  // B4 — back to Lynette: her latest (L3, minted in B2) opens, LYNETTE talking.
  await tapAgent(page, "lynette");
  await expect(page.getByText("L3 greeting")).toBeVisible();
  await expect(art(page)).toHaveAttribute("src", /lynette\.webp/);

  // B5 — switch who answers, then tap the ALREADY-CHECKED home row: nothing reloads, back to the rule.
  await type(page, "/agent emma");
  await expect(art(page)).toHaveAttribute("src", /emma\.webp/);
  const readsBefore = w.reads.L3;
  await tapAgent(page, "lynette");
  await expect(art(page)).toHaveAttribute("src", /lynette\.webp/);
  expect(w.reads.L3).toBe(readsBefore); // the open conversation IS her latest — no reload
  await type(page, "hi");
  await expect(page.getByText("lynette replies")).toBeVisible();
  expect(w.sent.at(-1)).toMatchObject({ thread_id: "L3", agent: null }); // the home answers
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("B6 — leave mid-reply for Emma, come back: Lynette's reply is whole, and never landed in E1", async ({
  page,
  pageErrors,
}) => {
  const w = await boot(page);
  let release: () => void = () => undefined;
  const replied = new Promise<void>((resolve) => {
    release = resolve;
  });
  const REPLY = "a long and careful answer from lynette";
  await page.route("**/api/agent/chat", async (route) => {
    w.sent.push(route.request().postDataJSON() as Record<string, unknown>);
    await replied; // the turn is still running when the owner taps Emma
    // …and by the time it answers, the server has persisted the whole reply
    w.histories.L2 = [
      ...w.histories.L2,
      msg("L2", "u-new", "user", "a long question"),
      msg("L2", "r-new", "assistant", REPLY),
    ];
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        frame("thread", { threadId: "L2", agent: "lynette" }) +
        frame("message.start", { messageId: "r-new", agent: "lynette" }) +
        frame("text.delta", { messageId: "r-new", delta: REPLY }) +
        frame("done", { state: "completed" }),
    });
  });
  await expect(page.getByText("L2 answer")).toBeVisible();
  await type(page, "a long question");
  await expect.poll(() => w.sent.length).toBe(1);

  await tapAgent(page, "emma"); // a hop while the reply runs (R9) — E1 opens at once
  await expect(page.getByText("Emma's own chat")).toBeVisible();
  const answered = page.waitForResponse("**/api/agent/chat");
  release();
  await answered; // the left turn's answer has ARRIVED while the owner is in E1 (deterministic)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  await expect(page.getByText(REPLY)).toHaveCount(0); // nothing of it landed in Emma's conversation

  await tapAgent(page, "lynette"); // back to L2 — her latest
  await expect(page.getByText(REPLY)).toHaveCount(1); // whole, once
  await expect(page.getByText("a long question")).toBeVisible();
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("B6 — come back WHILE the reply still runs: the probe re-attaches, and the reply lands whole", async ({
  page,
  pageErrors,
}) => {
  const w = await boot(page);
  let release: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    release = resolve;
  });
  let running = true;
  const REPLY = "lynette kept talking while you were away";
  const persist = () => {
    w.histories.L2 = [
      ...w.histories.L2,
      msg("L2", "u-new", "user", "a long question"),
      msg("L2", "r-new", "assistant", REPLY),
    ];
  };
  // The send's own POST never answers until the end: the owner leaves and comes back meanwhile.
  await page.route("**/api/agent/chat", async (route) => {
    w.sent.push(route.request().postDataJSON() as Record<string, unknown>);
    await finished;
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        frame("thread", { threadId: "L2", agent: "lynette" }) +
        frame("done", { state: "completed" }),
    });
  });
  // The D39 probe says the turn is still running; the re-attach stream delivers it to the end.
  await page.route("**/api/agent/turns/L2", (route) => json(route, { active: running }));
  await page.route(/\/api\/agent\/turns\/L2\/stream/, async (route) => {
    await finished;
    persist();
    running = false;
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        `id: T:1\r\n${frame("message.start", { messageId: "r-new", agent: "lynette" })}` +
        `id: T:2\r\n${frame("text.delta", { messageId: "r-new", delta: REPLY })}` +
        `id: T:3\r\n${frame("done", { state: "completed" })}`,
    });
  });
  await expect(page.getByText("L2 answer")).toBeVisible();
  await type(page, "a long question");
  await expect.poll(() => w.sent.length).toBe(1);

  await tapAgent(page, "emma"); // leave while the reply runs (R9)
  await expect(page.getByText("Emma's own chat")).toBeVisible();
  const reattached = page.waitForRequest(/\/api\/agent\/turns\/L2\/stream/);
  await tapAgent(page, "lynette"); // back — the turn is STILL running
  await expect(page.getByText("L2 answer")).toBeVisible();
  await reattached; // the probe found it live and re-attached
  release();
  await expect(page.getByText(REPLY)).toHaveCount(1); // whole, once
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});
