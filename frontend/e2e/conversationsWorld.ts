import type { Page, Route } from "@playwright/test";

import { THREAD_LIST, expect, seedUI } from "./fixtures";

// D84 / Phase 27 — the CONVERSATIONS WORLD: one fake server + the shared drivers, for the specs that run
// conversations per agent through the REAL built app (`conversations.spec.ts` — B1→B6 through the composer
// and the tools menu; `conversationsSheet.spec.ts` — B7/B8/R36 through the header's conversations sheet).
// Factored out of the first spec at S9b so the second reuses it rather than copying it.
//
// Setup is the plan's: Lynette (the configured default) and Emma, each with her own background; Lynette's
// L2 is her newest, L1 older; Emma's newest is E1. `/api` is mocked like every other spec; the server's
// half (the routes, seam ①, the 404s) is pinned in `backend/tests/test_threads_a15_routes.py`.

/** The theme the B1→B6 chain has always booted (`boot`'s default). */
export const MINIMAL_UI = { theme: "minimal", mode: "dark", accent: "cyan" } as const;

export const frame = (event: string, data: unknown) =>
  `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
export const json = (route: Route, body: unknown, status = 200) =>
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
export const thread = (id: string, agent: string) => ({
  id,
  title: null,
  agent,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  archived: false,
});
/** One durable row; `agent` = the assistant row's own speaker (absent = the home's own, §12.3 L4). */
export const msg = (
  thread: string,
  id: string,
  role: "user" | "assistant",
  text: string,
  agent?: string,
) => ({
  id,
  thread_id: thread,
  role,
  parts: [{ type: "text", text }],
  actor: role === "user" ? "user" : "agent",
  ts: "2026-01-01T00:00:00Z",
  tokens: null,
  compacted: false,
  ...(agent ? { agent } : {}),
});

/** The fake server's state — what the routes answer, mutated by the requests that change it. */
export interface World {
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
  /** An owner-set title per conversation (`PATCH {title}`) — the summaries' `label` wins with it. */
  titles: Record<string, string>;
  /** The live-status flags a summary row carries (§4: `running` · `awaiting` · `unread`). */
  flags: Record<string, { running?: boolean; awaiting?: boolean; unread?: boolean }>;
  /** Every `PATCH /api/threads/:id` that carried a `title` (the seen write's `seen_at` is not recorded). */
  renamed: { id: string; body: Record<string, unknown> }[];
  /** Every `DELETE /api/threads/:id`, in order. */
  deleted: string[];
  /** Every per-agent summaries read (`?agent=<name>&limit=50…`) — the sheet's and the header dot's. */
  listed: string[];
}

/** One `?agent=` summaries row (§4) as the fake server derives it: `label` = the title, else the first
 *  owner line; `preview` = the newest row with text (its speaker, `agent` null for the owner's). */
function summaryRow(w: World, id: string, agent: string) {
  const rows = w.histories[id] ?? [];
  const firstUser = rows.find((m) => m.role === "user");
  const last = rows.at(-1);
  const f = w.flags[id] ?? {};
  return {
    ...thread(id, agent),
    title: w.titles[id] ?? null,
    label: w.titles[id] ?? (firstUser ? firstUser.parts[0].text : null),
    preview: last
      ? {
          role: last.role,
          agent: last.role === "user" ? null : (last.agent ?? null),
          text: last.parts[0].text,
          ts: last.ts,
        }
      : null,
    running: !!f.running,
    awaiting: !!f.awaiting,
    unread: !!f.unread,
  };
}

export async function boot(page: Page, ui: Record<string, unknown> = MINIMAL_UI): Promise<World> {
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
    titles: {},
    flags: {},
    renamed: [],
    deleted: [],
    listed: [],
  };
  await seedUI(page, { tab: "agent", agentBackdrop: "operator", ...ui, v: 1 });
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
  // THE SHEET's (and the header dot's) summaries read: `?agent=<name>&limit=50[&before=<cursor>]`.
  await page.route(/\/api\/threads\?agent=[^&]+&limit=50/, (route) => {
    const params = new URL(route.request().url()).searchParams;
    const agent = params.get("agent")!;
    w.listed.push(agent);
    const ids = w.byAgent[agent] ?? [];
    const before = params.get("before")?.split(",").at(-1);
    const from = before ? ids.indexOf(before) + 1 : 0;
    return json(
      route,
      ids.slice(from, from + 50).map((id) => summaryRow(w, id, agent)),
    );
  });
  // Rename (the title) + the seen write (`seen_at`, answered and not recorded) + DELETE.
  await page.route(/\/api\/threads\/[^/?]+$/, (route) => {
    const req = route.request();
    const id = decodeURIComponent(req.url().split("/").at(-1)!);
    const agent = Object.keys(w.byAgent).find((a) => w.byAgent[a].includes(id)) ?? "lynette";
    if (req.method() === "PATCH") {
      const body = req.postDataJSON() as Record<string, unknown>;
      if ("title" in body) {
        w.renamed.push({ id, body });
        if (typeof body.title === "string") w.titles[id] = body.title;
        else delete w.titles[id];
      }
      return json(route, summaryRow(w, id, agent));
    }
    if (req.method() === "DELETE") {
      w.deleted.push(id);
      for (const a of Object.keys(w.byAgent)) w.byAgent[a] = w.byAgent[a].filter((t) => t !== id);
      return json(route, { deleted: true });
    }
    return route.fallback();
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

export const art = (page: Page) =>
  page.locator("#tab-agent > .kit-backdrop-strip img.kit-backdrop-art");
export const trigger = (page: Page) => page.locator("#composer .kit-cbtn.tools");
export const row = (page: Page, name: string) =>
  page.locator("#composer-tools label.tools-row").filter({
    has: page.locator(".tools-name", { hasText: new RegExp(`^${name}$`) }),
  });
export async function type(page: Page, text: string) {
  await page.locator(".kit-composer textarea").fill(text);
  await page.locator("#cmd-send").click();
}
/** Tap an agent row in the tools menu (the roster door) — the panel closes on an agent row. */
export async function tapAgent(page: Page, name: string) {
  await trigger(page).click();
  await row(page, name).click();
  await expect(page.locator("#composer-tools.open")).toHaveCount(0);
}
/** The checked row = the open conversation's HOME (R38) — read with the panel open, then closed again. */
export async function expectChecked(page: Page, name: string) {
  await trigger(page).click();
  await expect(row(page, name).locator("input")).toBeChecked();
  await trigger(page).click();
  await expect(page.locator("#composer-tools.open")).toHaveCount(0);
}
