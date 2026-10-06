import type { Page } from "@playwright/test";

import { expect, seedThread, seedUI, test } from "./fixtures";

// ISS-53 — the phone's BACK gesture over the FULL-SCREEN surfaces, in a real browser. The unit suites
// pin each guard's wiring in jsdom; what only Chromium proves is the history itself: that every surface
// spends exactly the entry it pushed, and — the case jsdom cannot reproduce faithfully — that closing
// one guarded overlay and opening another never shares a task (the edit-message → Delete door, where
// the editor's reclaiming `history.back()` used to be in flight under the confirm's `pushState`, so the
// confirm's entry was lost and the next Back left the app). The `media-gallery.spec.ts` Back arm is the
// pattern: `page.goBack()`, then assert both that the overlay went AND that the app is still there.

/** The address the app was booted on — a Back that left the PWA would change it (about:blank). */
async function bootedAt(page: Page): Promise<string> {
  await page.goto("/");
  return page.url();
}

test("the PROMPT EDITOR — Back closes it, and the app is still there", async ({
  page,
  pageErrors,
}) => {
  const home = await bootedAt(page);
  await page.locator("#tabbtn-conf").click();
  const group = page.locator("#prompts");
  await group.locator(".conftitle").click(); // the group ships collapsed
  await group.locator(".prow").nth(1).locator(".prow-preview").click();
  const modal = page.getByRole("dialog", { name: "Per Tool Cap" });
  await expect(modal).toBeVisible();

  await page.goBack();
  await expect(modal).toHaveCount(0);
  // Still in the app, on the group the editor was opened from — the entry spent was the editor's.
  await expect(group.getByText("Per Tool Cap")).toBeVisible();
  expect(page.url()).toBe(home);
  // Back is the editor's CANCEL: nothing was staged.
  await expect(group.getByRole("button", { name: "Save 1 change" })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

const summary = (title: string) => ({
  title,
  description: "",
  avatar: "",
  background: "",
  voice: "",
});

/** A saved agent as `GET /api/agents/{name}` hands it back (card-export.spec's shape). */
const agentFull = (name: string, title: string) => ({
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
    avatar: "",
    background: "",
    voice: "",
    lorebooks: [],
    model: { provider: null, model: null },
    tools: "*",
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

test("the AGENT DETAIL — Back returns to the gallery grid and stays in the app", async ({
  page,
  pageErrors,
}) => {
  // The owner's own example. The `button` placement makes the gallery its own section (the NavMenu
  // opens it — a section switch, deliberately unguarded); the open agent then REPLACES the grid.
  await seedUI(page, {
    theme: "minimal",
    mode: "dark",
    accent: "cyan",
    layout: "4-tab",
    sectionPlacement: { agents: "button" },
    v: 1,
  });
  await page.route("**/api/agents", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: ["lynette"],
        default: "default",
        summaries: { default: summary(""), lynette: summary("Lynette") },
      }),
    }),
  );
  await page.route("**/api/agents/lynette", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(agentFull("lynette", "Lynette")),
    }),
  );
  const home = await bootedAt(page);
  await page.locator(".kit-appbar .navmenu-launch").click();
  await expect(page.locator("#tab-agents")).toBeVisible();

  await page.locator(".agal-card", { hasText: "Lynette" }).click();
  const back = page.getByRole("button", { name: "‹ all agents" });
  await expect(back).toBeVisible();
  await expect(page.locator(".agal-detail .agent-empty")).toHaveCount(0); // the form, not "loading…"

  await page.goBack();
  await expect(back).toHaveCount(0);
  await expect(page.locator(".agal-card", { hasText: "Lynette" })).toBeVisible(); // the grid again
  await expect(page.locator("#tab-agents")).toBeVisible();
  expect(page.url()).toBe(home);
  expect(pageErrors).toEqual([]);
});

const row = (id: string, role: "user" | "assistant", text: string) => ({
  id,
  thread_id: "t1",
  role,
  parts: [{ type: "text", text }],
  actor: role === "user" ? "user" : "agent",
  ts: "2026-09-27T10:00:00Z",
  tokens: null,
  compacted: false,
});

test("EDIT MESSAGE → Delete → Back cancels the confirm, and the app is still there", async ({
  page,
  pageErrors,
}) => {
  // THE RACE (DefaultRoot's call-screen note): the editor's Delete closes one guarded overlay and opens
  // another. Done in one task, the confirm's entry was lost — so this Back left the PWA. Now the
  // hand-over runs inside the editor's own `popstate`, after its entry is spent.
  await seedThread(page, [row("u1", "user", "tell me a story"), row("a1", "assistant", "once")]);
  let deleted = false;
  await page.route("**/api/threads/t1/messages/u1", (route) => {
    if (route.request().method() === "DELETE") deleted = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  const home = await bootedAt(page);
  await page.locator("#tabbtn-agent").click();
  const mine = page.locator(".b.user").last();
  await expect(mine).toContainText("tell me a story");

  await page.getByRole("button", { name: "edit your message" }).click();
  const editor = page.locator(".pm");
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Delete message" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await expect(editor).toHaveCount(0);

  await page.goBack();
  await expect(confirm).toHaveCount(0);
  // The confirm owned the top entry, so Back CANCELLED it — nothing deleted, the chat still there,
  // and the browser never left the app.
  await expect(mine).toContainText("tell me a story");
  expect(deleted).toBe(false);
  expect(page.url()).toBe(home);
  expect(pageErrors).toEqual([]);
});
