import type { Page, Route } from "@playwright/test";

import { THREAD_LIST, expect, seedUI, test } from "./fixtures";

// D84 / Phase 27 — CONVERSATIONS PER AGENT through the REAL built app (CONVERSATIONS_PLAN §2's behaviour
// spec, §10 S7's e2e): B1 → B2 → B3 → B4 → B5 driven through the composer and the tools menu's agent
// rows (THE ROSTER DOOR — the checked row is the open conversation's HOME, tapping the already-checked row
// navigates), and B6's "leave mid-reply, come back, the reply is whole". The store suites pin every seam
// (`chatResponder`, `chatHop`, `chatSeen`, `chatDeleted`); what only a browser run proves is the chain —
// the real menu, the real composer verbs, the backdrop following WHO ANSWERS (the responder, else the home).
//
// Setup is the plan's: Lynette (the configured default) and Emma, each with her own background; Lynette's
// L2 is her newest, L1 older; Emma's newest is E1. `/api` is mocked like every other spec; the server's
// half (the routes, seam ①, the 404s) is pinned in `backend/tests/test_threads_a15_routes.py`.

const frame = (event: string, data: unknown) =>
  `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const GIF = Buffer.from("R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", "base64");

const bg = (name: string) => ({
  name,
  file: `${name}.webp`,
  url: `/api/media/agents/files/backgrounds/${name}.webp`,
  format: "webp",
  size_bytes: 90_000,
  revision: "1:90000",
  width: 1200,
  height: 1600,
  unusable: false,
  unusable_reason: null,
});
const summary = (title: string, background: string) => ({
  title,
  description: "",
  avatar: "",
  background,
  voice: "",
  duties: "agent",
});
const thread = (id: string, agent: string) => ({
  id,
  title: null,
  agent,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  archived: false,
});
const msg = (thread: string, id: string, role: "user" | "assistant", text: string) => ({
  id,
  thread_id: thread,
  role,
  parts: [{ type: "text", text }],
  actor: role === "user" ? "user" : "agent",
  ts: "2026-01-01T00:00:00Z",
  tokens: null,
  compacted: false,
});

/** The fake server's state — what the routes answer, mutated by the requests that change it. */
interface World {
  /** Each agent's conversations, newest first (the roster door's `?agent=<name>&limit=1` read). */
  byAgent: Record<string, string[]>;
  /** Each conversation's durable history (`/messages`). */
  histories: Record<string, ReturnType<typeof msg>[]>;
  /** How many times each conversation's history was read — "nothing reloads" (B5). */
  reads: Record<string, number>;
  /** Every chat POST body. */
  sent: Record<string, unknown>[];
  /** Every seam-① mint body. */
  minted: Record<string, unknown>[];
}

async function boot(page: Page): Promise<World> {
  const w: World = {
    byAgent: { lynette: ["L2", "L1"], emma: ["E1"] },
    histories: {
      L2: [
        msg("L2", "L2-u", "user", "an older question"),
        msg("L2", "L2-a", "assistant", "L2 answer"),
      ],
      L1: [msg("L1", "L1-a", "assistant", "L1 answer")],
      E1: [msg("E1", "E1-a", "assistant", "Emma's own chat")],
    },
    reads: {},
    sent: [],
    minted: [],
  };
  await seedUI(page, {
    theme: "minimal",
    mode: "dark",
    accent: "cyan",
    tab: "agent",
    agentBackdrop: "operator",
    v: 1,
  });
  await page.route("**/api/media/agents", (route) =>
    json(route, {
      ns: "agents",
      collation: "library-v1",
      roles: { avatars: [], backgrounds: [bg("lynette"), bg("emma")] },
      slots: {},
    }),
  );
  await page.route("**/api/media/agents/files/backgrounds/*", (route) =>
    route.fulfill({ status: 200, contentType: "image/gif", body: GIF }),
  );
  await page.route("**/api/agents", (route) =>
    json(route, {
      agents: ["lynette", "emma"],
      default: "lynette",
      summaries: {
        default: summary("default", ""),
        lynette: summary("Lynette", "lynette.webp"),
        emma: summary("Emma", "emma.webp"),
      },
    }),
  );
  // The boot's list (newest first): L2 is the conversation the chat opens.
  await page.route(THREAD_LIST, (route) =>
    route.request().method() === "POST"
      ? route.fallback()
      : json(route, [thread("L2", "lynette"), thread("E1", "emma"), thread("L1", "lynette")]),
  );
  // THE ROSTER DOOR's read.
  await page.route(/\/api\/threads\?agent=([^&]+)&limit=1$/, (route) => {
    const agent = decodeURIComponent(/agent=([^&]+)/.exec(route.request().url())?.[1] ?? "");
    const id = w.byAgent[agent]?.[0];
    return json(route, id ? [thread(id, agent)] : []);
  });
  // Seam ① — `/new` (and a roster door onto an agent with none) mints a greeted conversation.
  await page.route(/\/api\/threads$/, (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { agent: string };
    w.minted.push(body);
    const id = `${body.agent[0].toUpperCase()}${(w.byAgent[body.agent]?.length ?? 0) + 1}`;
    w.byAgent[body.agent] = [id, ...(w.byAgent[body.agent] ?? [])];
    w.histories[id] = [msg(id, `${id}-g`, "assistant", `${id} greeting`)];
    return json(route, thread(id, body.agent));
  });
  await page.route(/\/api\/threads\/[^/]+\/messages$/, (route) => {
    const id = route.request().url().split("/").at(-2)!;
    w.reads[id] = (w.reads[id] ?? 0) + 1;
    return json(route, w.histories[id] ?? []);
  });
  await page.route("**/api/agent/turns/*", (route) => json(route, { active: false }));
  await page.goto("/");
  await page.waitForSelector("#tab-agent.active");
  return w;
}

const art = (page: Page) => page.locator("#tab-agent > .kit-backdrop-strip img.kit-backdrop-art");
const trigger = (page: Page) => page.locator("#composer .kit-cbtn.tools");
const row = (page: Page, name: string) =>
  page.locator("#composer-tools label.tools-row").filter({
    has: page.locator(".tools-name", { hasText: new RegExp(`^${name}$`) }),
  });
async function type(page: Page, text: string) {
  await page.locator(".kit-composer textarea").fill(text);
  await page.locator("#cmd-send").click();
}
/** Tap an agent row in the tools menu (the roster door) — the panel closes on an agent row. */
async function tapAgent(page: Page, name: string) {
  await trigger(page).click();
  await row(page, name).click();
  await expect(page.locator("#composer-tools.open")).toHaveCount(0);
}
/** The checked row = the open conversation's HOME (R38) — read with the panel open, then closed again. */
async function expectChecked(page: Page, name: string) {
  await trigger(page).click();
  await expect(row(page, name).locator("input")).toBeChecked();
  await trigger(page).click();
  await expect(page.locator("#composer-tools.open")).toHaveCount(0);
}

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
