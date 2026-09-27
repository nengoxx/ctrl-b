import { expect, seedThread, test } from "./fixtures";

// D81 — RETRY + ALTERNATES end to end, in the REAL built app: open the who-line disclosure, `retry`
// streams a new take through `/api/agent/regenerate`, the end-of-turn floor lands the `2/2` counter,
// and `‹` swaps back to `1/2` through the variant route.
//
// The unit suites pin each seam (the store's routes + floor installer, the who-line's controls); what
// only a browser run proves is the CHAIN — the SSE turn reduced by the real reducer, the floor re-read
// at its end, and the counter rendering from the server's `reply` annotation (never derived client-side).
// `/api` is mocked like every other spec; the server's half (stash/swap/renumber) is pinned in
// `backend/tests/test_message_actions_d81.py`.

const frame = (event: string, data: unknown) =>
  `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;

const row = (id: string, role: "user" | "assistant", text: string, extra: object = {}) => ({
  id,
  thread_id: "t1",
  role,
  parts: [{ type: "text", text }],
  actor: role === "user" ? "user" : "agent",
  ts: "2026-09-27T10:00:00Z",
  tokens: null,
  compacted: false,
  ...extra,
});

const ASKED = row("u1", "user", "tell me a story");
const FIRST = (count: number) =>
  row("a1", "assistant", "once upon a time", { reply: { ids: ["a1"], n: 1, count } });
const SECOND = row("a2", "assistant", "long ago, far away", {
  reply: { ids: ["a2"], n: 2, count: 2 },
});

test("retry writes a second take (2/2), and ‹ swaps back to the first (1/2)", async ({
  page,
  pageErrors,
}) => {
  // The durable floor as the server would serve it after each step — the one source of `reply`.
  let floor: unknown[] = [ASKED, FIRST(1)];
  await seedThread(page, floor);
  await page.route("**/api/threads/t1/messages", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(floor) }),
  );
  const regenerated: Record<string, unknown>[] = [];
  await page.route("**/api/agent/regenerate", (route) => {
    regenerated.push(route.request().postDataJSON() as Record<string, unknown>);
    floor = [ASKED, SECOND]; // the take the stream below produces, as the end-of-turn floor has it
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        frame("thread", { threadId: "t1" }) +
        frame("message.start", { messageId: "a2", agent: null }) +
        frame("text.delta", { messageId: "a2", delta: "long ago, far away" }) +
        frame("done", { state: "completed" }),
    });
  });
  const swaps: unknown[] = [];
  await page.route("**/api/threads/t1/messages/a2/alternate", (route) => {
    swaps.push(route.request().postDataJSON());
    floor = [ASKED, FIRST(2)];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: floor }),
    });
  });

  await page.goto("/");
  await page.locator("#tabbtn-agent").click();
  const bot = page.locator(".b.bot").last();
  await expect(bot).toContainText("once upon a time");
  await expect(bot.locator(".who-alt")).toHaveCount(0); // one take: no counter yet

  // The disclosure opens on the identity run; its `retry` regenerates the tail host.
  await bot.locator(".who .who-id").click();
  await page.getByRole("button", { name: "retry this reply", exact: true }).click();

  await expect(page.locator(".b.bot").last()).toContainText("long ago, far away");
  expect(regenerated[0]).toMatchObject({ thread_id: "t1", message_id: "a1", stream: true });
  const counter = page.locator(".b.bot .who-alt-n");
  await expect(counter).toHaveText("2/2");

  await page.getByRole("button", { name: "previous version of this reply", exact: true }).click();
  await expect(counter).toHaveText("1/2");
  await expect(page.locator(".b.bot").last()).toContainText("once upon a time");
  expect(swaps).toEqual([{ n: 1 }]);
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});
