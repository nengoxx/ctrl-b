import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";

import { expect, seedUI, test } from "./fixtures";

// D79 / ROLEPLAY_PLAN §15.3–§15.5 — EXPORT in the REAL built app. The vitest suites pin the call shapes
// with the image job mocked; what only a browser can prove is the CHAIN:
//
//   · the carrier really is a PNG — a bound WebP avatar goes through the export WORKER with the type
//     forced to PNG (the server would 415 anything else), and an agent with no avatar gets the letter
//     tile painted on a real main-thread canvas at 512×512;
//   · the blob-anchor download really fires, under the sanitised display name, with the server's bytes;
//   · the lorebook row's `used_by` line and its export.
//
// `/api` is mocked like every other spec (the server half — the composition, the chunk writer, the
// carrier validator — is `test_roleplay_s9.py`'s). Routes registered here win over `mockApi`'s.

const IMAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "images");
const WEBP = readFileSync(join(IMAGES, "webp-lossy-8x6.webp"));
const CARD_PNG = readFileSync(join(IMAGES, "photo-64x48.png")); // what the "server" answers with
const AVATAR = "/api/media/agents/files/avatars/lyn.webp";
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const summary = (title: string, avatar = "") => ({
  title,
  description: "",
  avatar,
  background: "",
  voice: "",
});

/** A saved agent as `GET /api/agents/{name}` hands it back. */
const agentFull = (name: string, title: string, avatar = "") => ({
  name,
  is_default: name === "default",
  soul: "",
  agent: {
    name,
    title,
    description: "",
    prompt: "",
    prompt_append: "",
    inherit_append: true,
    duties: "conversational",
    greeting: "",
    alt_greetings: [],
    example_dialogue: "",
    scenario: "",
    post_history: "",
    persona: "",
    avatar,
    background: "",
    voice: "",
    lorebooks: [],
    model: { provider: null, model: null },
    tools: ["web_search"],
    skills: "*",
    privilege: "confirm",
    compaction: null,
    max_iterations: 20,
    max_repeat_calls: 3,
    max_calls_per_tool: 10,
    max_stall_iterations: 3,
    max_subagent_depth: 2,
    max_concurrent_subagents: 3,
  },
});

const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

/** The gallery with two cards: the root (no avatar) and Lynette (a bound WebP avatar). Every export
 *  request is captured so the arms can assert on what the app SENT, not only on what it saved. */
async function boot(page: Page) {
  const posted: Buffer[] = [];
  await seedUI(page, {
    theme: "minimal",
    mode: "dark",
    accent: "cyan",
    layout: "4-tab",
    sectionPlacement: { agents: "button" },
    v: 1,
  });
  await page.route("**/api/agents", (r) =>
    r.fulfill(
      json({
        agents: ["lynette"],
        default: "default",
        summaries: { default: summary(""), lynette: summary("Lynette", "lyn.webp") },
      }),
    ),
  );
  await page.route("**/api/media/agents", (r) =>
    r.fulfill(
      json({
        ns: "agents",
        collation: "library-v1",
        roles: {
          avatars: [
            {
              name: "lyn",
              file: "lyn.webp",
              url: AVATAR,
              format: "webp",
              size_bytes: WEBP.length,
              revision: `1:${WEBP.length}`,
              width: 8,
              height: 6,
              unusable: false,
              unusable_reason: null,
            },
          ],
          backgrounds: [],
        },
        slots: {},
      }),
    ),
  );
  await page.route(`**${AVATAR}*`, (r) =>
    r.fulfill({ status: 200, contentType: "image/webp", body: WEBP }),
  );
  await page.route("**/api/agents/lynette", (r) =>
    r.fulfill(json(agentFull("lynette", "Lynette", "lyn.webp"))),
  );
  await page.route("**/api/agents/default", (r) => r.fulfill(json(agentFull("default", ""))));
  await page.route("**/api/agents/*/card", (r) =>
    r.fulfill(json({ spec: "chara_card_v3", spec_version: "3.0", data: { name: "Lynette" } })),
  );
  await page.route("**/api/agents/*/card.png", (r) => {
    posted.push(r.request().postDataBuffer() ?? Buffer.alloc(0));
    return r.fulfill({ status: 200, contentType: "image/png", body: CARD_PNG });
  });
  await page.goto("/");
  await page.locator(".kit-appbar .navmenu-launch").click();
  await expect(page.locator("#tab-agents")).toBeVisible();
  return posted;
}

/** Open one agent's editor from its gallery card and open the footer's export chooser. */
async function openExport(page: Page, card: string) {
  await page.locator(".agal-card", { hasText: card }).click();
  const row = page.locator(".agal-detail");
  await row.getByRole("button", { name: "export", exact: true }).click();
  return row;
}

/** A PNG's IHDR size (bytes 16–23, big-endian) — which picture the carrier actually was. */
const ihdr = (b: Buffer) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) });

test("PNG card — a bound WebP avatar is re-encoded to a PNG carrier and the card downloads as <title>.png", async ({
  page,
  pageErrors,
}) => {
  const posted = await boot(page);
  const row = await openExport(page, "Lynette");
  const download = page.waitForEvent("download");
  await row.getByRole("button", { name: "PNG card" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Lynette.png");
  expect(readFileSync(await file.path())).toEqual(CARD_PNG); // the SERVER's bytes, verbatim
  // What was POSTed is the carrier: a real PNG, the avatar drawn WHOLE (8×6 — no crop, no focal).
  expect(posted).toHaveLength(1);
  expect([...posted[0].subarray(0, 8)]).toEqual(PNG_SIG);
  expect(ihdr(posted[0])).toEqual({ width: 8, height: 6 });
  expect(pageErrors).toEqual([]);
});

test("PNG card — no avatar: the root agent's letter tile is the 512×512 carrier", async ({
  page,
  pageErrors,
}) => {
  const posted = await boot(page);
  const row = await openExport(page, "default");
  const download = page.waitForEvent("download");
  await row.getByRole("button", { name: "PNG card" }).click();
  expect((await download).suggestedFilename()).toBe("default.png");
  expect([...posted[0].subarray(0, 8)]).toEqual(PNG_SIG);
  expect(ihdr(posted[0])).toEqual({ width: 512, height: 512 });
  expect(pageErrors).toEqual([]);
});

test("JSON card — GET …/card downloads verbatim as <title>.json; a dirty form says `save first`", async ({
  page,
  pageErrors,
}) => {
  const posted = await boot(page);
  const row = await openExport(page, "Lynette");
  const download = page.waitForEvent("download");
  await row.getByRole("button", { name: "JSON card" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Lynette.json");
  expect(JSON.parse(readFileSync(await file.path(), "utf8"))).toEqual({
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: { name: "Lynette" },
  });
  expect(posted).toHaveLength(0); // no picture involved

  // The server composes from DISK: an unsaved edit gates the export.
  await row.getByLabel("Display name").fill("Lynette II");
  await expect(row.getByRole("button", { name: "save first" })).toBeDisabled();
  expect(pageErrors).toEqual([]);
});

test("Lorebooks — the row says who links the book, and `export` downloads ST's JSON as <name>.json", async ({
  page,
  pageErrors,
}) => {
  await page.route("**/api/lorebooks", (r) =>
    r.fulfill(
      json({
        lorebooks: [
          {
            slug: "hollow-sea",
            name: "Hollow Sea",
            enabled: true,
            entries: 2,
            used_by: { agents: ["lynette"], global: true },
          },
        ],
      }),
    ),
  );
  await page.route("**/api/agents", (r) =>
    r.fulfill(
      json({
        agents: ["lynette"],
        default: "default",
        summaries: { default: summary(""), lynette: summary("Lynette") },
      }),
    ),
  );
  const st = {
    entries: { "0": { uid: 0, key: ["ghostship"], content: "fog" } },
    name: "Hollow Sea",
  };
  await page.route("**/api/lorebooks/hollow-sea/export", (r) => r.fulfill(json(st)));
  await page.goto("/");
  await page.locator("#tabbtn-conf").click();
  const group = page.locator("#lorebooks");
  await group.locator(".conftitle").click();
  await expect(group.locator(".lb-book > .confrow .desc")).toHaveText(
    "2 entries · used by Lynette · global",
  );
  await group.getByRole("button", { name: "expand Hollow Sea" }).click();
  const download = page.waitForEvent("download");
  await group.getByRole("button", { name: "export", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Hollow Sea.json");
  expect(JSON.parse(readFileSync(await file.path(), "utf8"))).toEqual(st);
  expect(pageErrors).toEqual([]);
});
