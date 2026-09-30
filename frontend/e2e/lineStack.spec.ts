import { expect, seedUI, test } from "./fixtures";

// THE LINE PILL'S CONTROL STACK, in real layout (the owner's 2026-09-30 round). jsdom lays nothing
// out, so the unit suite (tests/components/composerExpand.test.tsx) can pin the RULE but not the
// property it rests on: that the height the stack decides from is measured at the STACKED width,
// whichever shape the cluster has right now. Get that width wrong and the decision feeds back into
// its own input — the owner watched the mic hop up and down on every keystroke for a whole line of
// typing (reproduced at 360px, where a 5-line draft in the row re-wraps to 3 once stacked). So this
// drives the built app at that width: type forward, delete back, and count the flips.

test.use({ viewport: { width: 360, height: 740 } });

const TEXT =
  "Okay so basically I want you to check the composer thing because whenever I type something " +
  "longer it starts jumping around between positions and that looks pretty bad honestly, fix it";

async function boot(page: import("@playwright/test").Page) {
  // STT on, so the mic renders beside send — the pair the stack is about.
  await page.route("**/api/voice/status", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ stt: true, tts: false, stt_auto_send: false }),
    }),
  );
  await seedUI(page, {
    theme: "cosmos",
    mode: "dark",
    accent: "violet",
    tab: "agent",
    themeSettings: { cosmos: { composer: "line" } },
    v: 1,
  });
  await page.goto("/");
  const field = page.locator("#cmd-input");
  await expect(field).toBeVisible();
  return field;
}

/** The measurement runs in an effect and the decision lands one render later — two frames settle both. */
const settle = (page: import("@playwright/test").Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

const isStacked = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.querySelector(".line-cluster")!.classList.contains("stack"));

test("the stack flips ONCE each way, on the same character, typing forward and deleting back", async ({
  page,
  pageErrors,
}) => {
  const field = await boot(page);
  const flips: string[] = [];
  let was = false;
  const step = async (n: number, dir: "+" | "-") => {
    await field.fill(TEXT.slice(0, n));
    await settle(page);
    const now = await isStacked(page);
    if (now !== was) flips.push(`${dir}${n}:${now ? "stack" : "row"}`);
    was = now;
  };
  for (let n = 1; n <= TEXT.length; n++) await step(n, "+");
  for (let n = TEXT.length - 1; n >= 0; n--) await step(n, "-");

  expect(flips).toHaveLength(2);
  const [on, off] = flips.map((f) => Number(f.slice(1, f.indexOf(":"))));
  expect(flips[0]).toMatch(/^\+\d+:stack$/);
  expect(flips[1]).toMatch(/^-\d+:row$/);
  expect(off).toBe(on - 1); // deleting the character that stacked it is what releases it
  expect(pageErrors).toEqual([]);
});

test("stacked on a short field, the toggle rides on top INSIDE the grown pill", async ({
  page,
}) => {
  const field = await boot(page);
  // Walk forward to the first stacked character — the shortest field the stack ever stands on.
  let n = 1;
  for (; n <= TEXT.length; n++) {
    await field.fill(TEXT.slice(0, n));
    await settle(page);
    if (await isStacked(page)) break;
  }
  expect(n).toBeLessThan(TEXT.length);
  const boxes = await page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    return {
      pill: r("#composer"),
      toggle: r(".line-cluster .kit-cbtn.expand"),
      mic: r(".line-cluster .mic"),
    };
  });
  expect(boxes.toggle.bottom).toBeLessThanOrEqual(boxes.mic.top); // on top of the column…
  expect(boxes.toggle.top).toBeGreaterThanOrEqual(boxes.pill.top); // …and never clipped by the pill
});

test("EXPAND pins the tall height at once and stacks with it; collapse hands both back", async ({
  page,
}) => {
  const field = await boot(page);
  // Grow to the first length that offers the toggle (3 rendered lines) — still in the row, since the
  // stack waits for 3 lines at the WIDER stacked width.
  const toggle = page.locator("#composer .kit-cbtn.expand");
  for (let n = 1; n <= TEXT.length && !(await toggle.isVisible()); n++) {
    await field.fill(TEXT.slice(0, n));
    await settle(page);
  }
  expect(await isStacked(page)).toBe(false);
  // The WRITTEN height, not the painted box: the paint eases toward it (the owner-ruled transition),
  // so a box read two frames in is mid-flight.
  const height = () => field.evaluate((el: HTMLElement) => parseFloat(el.style.height));
  const before = await height();

  await toggle.click();
  await expect.poll(() => isStacked(page)).toBe(true);
  expect(await height()).toBe(370); // half the 740px viewport, far past the ~3-line draft it holds

  await toggle.click();
  await expect.poll(() => isStacked(page)).toBe(false);
  expect(await height()).toBe(before);
});
