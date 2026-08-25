import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";

import { expect, seedUI, SETTINGS, test } from "./fixtures";

// THE FOCAL POINT'S VISUAL PROBE (D65 / MEDIA_MANAGER_PLAN §5, the §12 S4 gate) — the one thing only a
// real browser can answer about this slice: **does the paint move, in the right direction, on the
// windows that actually crop?**
//
// S4 rewrote ~10 paint sites from a value the ITEM published and every surface inherited into a value
// each WINDOW resolves from its own measured box. jsdom has no layout, so the vitest suites can prove
// the math, the write and the wiring but not one pixel of the result. Here the app is the built
// artifact, the media file is real bytes with a real aspect, `ResizeObserver` is the browser's own, and
// the assertion is on the COMPUTED `object-position` — the used value, after the cascade, of the
// element the fleet actually shows.
//
// It is a computed-style probe, not a screenshot diff, deliberately: a pixel diff of a themed fleet
// answers "something changed" and this has to answer "the crop moved LEFT, from 50% to 0%, on the
// capsule card and the promo slide and both cover seats" — which is the claim, and the one a
// published-once value gets wrong.
//
// TWO HALVES, and the second is the acceptance line:
//  ① with a framing point set far off-centre, every window's position moves toward it;
//  ② with the BUNDLED art — the state every install is in — every window paints exactly the string it
//    painted before the rewrite, including the cover hero's twenty-point shift.

/** A real 320x240 landscape PNG from the shared corpus, served as the owner's file so the browser has
 *  genuine dimensions to compute `s` from. */
const PHOTO = readFileSync(
  fileURLToPath(new URL("../tests/fixtures/images/photo-320x240.png", import.meta.url)),
);

const REVISION = "1:5120";

interface Entry {
  name?: string;
  bundled?: string;
  focal?: { x: number; y: number; rev: string };
}

const BUNDLED = ["pegasus", "atlas", "3", "4", "lyra"];

const diskRow = (entry: Entry | undefined) => ({
  name: "hero",
  file: "hero.png",
  url: "/api/media/gacha/files/characters/hero.png",
  format: "png",
  size_bytes: PHOTO.length,
  revision: REVISION,
  width: 320,
  height: 240,
  unusable: false,
  unusable_reason: null,
  listed: entry !== undefined,
  hidden: false,
  ...(entry?.focal !== undefined && { focal: entry.focal }),
});

const bundledRow = (id: string) => ({
  name: id,
  file: "",
  url: "",
  bundled: id,
  format: null,
  size_bytes: 0,
  revision: "",
  width: null,
  height: null,
  unusable: false,
  unusable_reason: null,
  listed: false,
  hidden: false,
});

/** The stateful mock: the config `files` list plus (optionally) one owner file on disk, collated the
 *  way `core/media.py#list_role` does and mutated by the settings PUT the framing sheet makes. */
async function mockMedia(page: Page, opts: { withFile: boolean }) {
  const st: { files: Entry[] } = { files: [] };
  const puts: Record<string, unknown>[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === "GET" && path.endsWith("/api/media/gacha")) {
      const listed = st.files.find((f) => f.name === "hero.png");
      const characters = opts.withFile ? [diskRow(listed), ...BUNDLED.map(bundledRow)] : [];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ns: "gacha",
          collation: "library-v1",
          roles: {
            characters,
            banner: [bundledRow("b2"), bundledRow("b3")],
            reel: [bundledRow("lyra")],
            oracle: [],
          },
          slots: {},
        }),
      });
    }
    // The owner's file itself — real bytes, so the browser decodes a real 320x240 picture and every
    // window has a real `s` to map through.
    if (req.method() === "GET" && path.includes("/api/media/gacha/files/")) {
      return route.fulfill({ status: 200, contentType: "image/png", body: PHOTO });
    }
    if (req.method() === "PUT" && path.endsWith("/api/settings")) {
      const body = req.postDataJSON() as {
        media?: { namespaces?: { gacha?: { roles?: { characters?: { files?: Entry[] } } } } };
      };
      puts.push(body);
      const next = body.media?.namespaces?.gacha?.roles?.characters?.files;
      if (next) st.files = next;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          // The WHOLE doc, the way the real endpoint answers: `useSaveSettings` adopts the echo as the
          // settings cache, and Conf reads every section off it — an echo carrying only the media block
          // hands the tab a doc with no `voice` and the render throws on the next field it asks for.
          settings: {
            ...SETTINGS,
            media: { namespaces: { gacha: { roles: { characters: { files: st.files } } } } },
          },
          restart_required: [],
          warnings: [],
          providers_rev: "r1",
        }),
      });
    }
    return route.fallback();
  });
  return { st, puts };
}

/** The USED `object-position` of one element — after the cascade, after the inline style, in px or %
 *  exactly as the engine resolved it. The X half as a number of percent, for the direction assertions. */
async function positionOf(page: Page, selector: string): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).objectPosition);
}

/** `"12.5% 30%"` -> 12.5 / 30. Chromium resolves a percentage `object-position` to percentages. */
const xOf = (pos: string): number => Number.parseFloat(pos);
const yOf = (pos: string): number => Number.parseFloat(pos.split(/\s+/)[1] ?? "");

test("the framing point MOVES the paint, on every window that crops (the S4 visual probe)", async ({
  page,
  pageErrors,
}) => {
  const { puts } = await mockMedia(page, { withFile: true });
  await seedUI(page, { theme: "gacha", mode: "dark", accent: "arcade", tab: "fleet", v: 1 });
  // The Conf media group ships collapsed; open it up front so step ② is about framing rather than
  // about a disclosure (the `media-gallery.spec.ts` precedent).
  await page.addInitScript(() =>
    localStorage.setItem("ctrlb.collapsed", JSON.stringify({ "media-gacha": false })),
  );
  await page.goto("/");

  // ── ① BEFORE. The owner's file is the whole cast, so it is dealt to both fixture machines: it paints
  //    the capsule card AND the promo slide, two windows of very different shapes. With no framing point
  //    set, neither carries an inline position and both sit on their own CSS default — which is what the
  //    parity half of this gate is about.
  //    (The first card in the track is the FEATURED shape — `gacha.css` gives each of the three capsule
  //    shapes its own default, which is itself part of why a published-once value cannot serve them.)
  const card = ".gc-card.feat img";
  const promo = ".gc-slide.promo img";
  await expect(page.locator(card).first()).toBeVisible();
  const cardBefore = await positionOf(page, card);
  const promoBefore = await positionOf(page, promo);
  expect(cardBefore, "the featured capsule shape's shipped default crop").toBe("50% 6%");
  expect(promoBefore, "the promo band's shipped default crop").toBe("50% 12%");

  // ── ② SET a framing point, far off-centre, through the real sheet.
  await page.locator("#tabbtn-conf").click();
  await page.getByRole("button", { name: "Open the characters gallery" }).click();
  const gallery = page.getByRole("dialog");
  await gallery.getByRole("button", { name: "hero.png", exact: true }).click();
  await gallery.getByRole("button", { name: /Set framing/ }).click();
  const sheet = page.getByRole("dialog", { name: "Set framing" });
  await expect(sheet).toBeVisible();
  // …and the previews are there, honestly captioned (council M4).
  await expect(sheet.getByText("Previews are examples.")).toBeVisible();

  // TAP-TO-PLACE near the picture's left edge (R57 §2.2a): the image pans so the tapped spot lands
  // under the reticle. Waiting for the picture to load first — the pan is clamped against its measured
  // size, so a tap before `onMediaLoaded` would be a no-op.
  const stage = sheet.locator(".mgal-frame-stage");
  await expect(stage.locator("img")).toBeVisible();
  const box = (await stage.boundingBox())!;
  // Hard into the top-left corner: the reticle can reach the picture's own edges (`panLimit`), so the
  // stored point clamps to ~0 on both axes — which makes the direction assertions below true at every
  // viewport rather than only at the one this was written on.
  await page.mouse.click(box.x + 4, box.y + 4);
  // The transient rule-of-thirds guide is raised by the change (Gutenberg's flash, R57 §8①).
  await expect(sheet.locator(".mgal-frame-thirds.on")).toBeVisible();

  await sheet.getByRole("button", { name: "Save framing" }).click();
  await expect.poll(() => puts.length).toBe(1);
  const saved = (
    puts[0] as {
      media: { namespaces: { gacha: { roles: { characters: { files: Entry[] } } } } };
    }
  ).media.namespaces.gacha.roles.characters.files;
  const focal = saved.find((f) => f.name === "hero.png")?.focal;
  // The stored shape: two decimals, keyed to the row's revision as read at SEND time (§2.2/§5).
  expect(focal, "the point is stored on the entry").toBeDefined();
  expect(focal!.rev, "keyed to the file's own revision").toBe(REVISION);
  expect(focal!.x, "the tap reached the picture's left edge").toBeLessThanOrEqual(0.05);
  expect(focal!.y, "…and its top edge").toBeLessThanOrEqual(0.05);
  expect(Number(focal!.x.toFixed(2)), "two decimals, no more").toBe(focal!.x);
  expect(Number(focal!.y.toFixed(2))).toBe(focal!.y);

  // ── ③ AFTER. Back on the fleet, with the index re-read, both windows have MOVED — and each one moved
  //    on THE AXIS IT ACTUALLY CROPS, which is the whole claim. The 4:3 source is TALLER than the
  //    capsule card is proportionally, so that window crops horizontally and its X walks left; it is
  //    SHORTER than the promo band, so that window crops vertically and its Y walks up. One published
  //    value could not have produced both — and the untouched axis of each is left at exactly 50% by the
  //    `s ≤ 1 + ε` guard, which is the visible proof that the division-by-zero arm holds in a browser
  //    (a NaN there would void the whole declaration and the window would fall back to its CSS default).
  await expect(sheet).toHaveCount(0); // saving closes the sheet, leaving the gallery behind it
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("#tabbtn-fleet").click();
  await expect(page.locator(card).first()).toBeVisible();
  await expect
    .poll(async () => xOf(await positionOf(page, card)), { message: "the card's crop moved left" })
    .toBeLessThan(xOf(cardBefore));
  await expect
    .poll(async () => yOf(await positionOf(page, promo)), { message: "the promo's crop moved up" })
    .toBeLessThan(yOf(promoBefore));
  expect(await positionOf(page, card), "the card's uncropped axis is the guard's 50%").toMatch(
    /^\d[\d.]*% 50%$/,
  );
  expect(await positionOf(page, promo), "the promo's uncropped axis is the guard's 50%").toMatch(
    /^50% \d[\d.]*%$/,
  );

  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("the BUNDLED art paints exactly what it painted before the rewrite (the parity line)", async ({
  page,
  pageErrors,
}) => {
  // The state every install is in until an owner sets a point — and therefore the state the ~10-site
  // rewrite is ACCEPTED on. The magazine cover is the sharpest arm: it is where the retired
  // `--cv-focus` / `--cv-hero-focus` chain lived, one element serving two seats with two different
  // values, and the hero's twenty-point leftward shift has to survive to the digit.
  await mockMedia(page, { withFile: false });
  await seedUI(page, {
    theme: "gacha",
    mode: "dark",
    accent: "arcade",
    tab: "fleet",
    themeSettings: { gacha: { fleetLayout: "cover" } },
    v: 1,
  });
  await page.goto("/");

  const hero = ".cv-card.is-hero .cv-shot img";
  const cut = ".cv-card.is-cut .cv-shot img";
  await expect(page.locator(hero)).toBeVisible();
  // Display position 0 is `pegasus`, whose hand-tuned PROPORTIONAL value is `50% 12%`; the hero seat
  // slides it twenty points left, exactly as `coverHeroFocus` did.
  expect(await positionOf(page, hero)).toBe("30% 12%");
  // Position 1 is `atlas`, which declares none — so NO inline position at all and the lab's own default
  // stands. A computed override here would be a claim about a crop nobody authored.
  expect(await positionOf(page, cut)).toBe("50% 22%");
  // …and the retired custom properties are gone from the card, not merely unread.
  const published = await page
    .locator(".cv-card")
    .first()
    .evaluate((el) => [
      el.style.getPropertyValue("--cv-focus"),
      el.style.getPropertyValue("--cv-hero-focus"),
    ]);
  expect(published).toEqual(["", ""]);

  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});
