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
async function mockMedia(page: Page, opts: { withFile: boolean; files?: Entry[] }) {
  const st: { files: Entry[] } = { files: opts.files ?? [] };
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
  await page.getByRole("button", { name: "Open the Characters gallery" }).click();
  const gallery = page.getByRole("dialog");
  await gallery.getByRole("button", { name: "hero.png", exact: true }).click();
  await gallery.getByRole("button", { name: "Focus", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Set focus" });
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

  await sheet.getByRole("button", { name: "Save", exact: true }).click();
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

test("an already-framed image OPENS on its framing, and an untouched Save keeps it (Emma #1)", async ({
  page,
  pageErrors,
}) => {
  // The browser half of the seed, and the one only a browser can prove: the vitest arm stops before
  // `react-easy-crop` has loaded anything, so it never exercises the DERIVED PAN. Here the picture
  // really loads, `onMediaLoaded` really fires, the seeded pan really goes to the library, and the
  // library's own report has to hand the same point back — which is the round trip that decides
  // whether opening a framed image to look at it leaves it framed.
  const stored = { x: 0.18, y: 0.82, rev: REVISION };
  const { puts } = await mockMedia(page, {
    withFile: true,
    files: [{ name: "hero.png", focal: stored }],
  });
  await seedUI(page, { theme: "gacha", mode: "dark", accent: "arcade", tab: "conf", v: 1 });
  await page.addInitScript(() =>
    localStorage.setItem("ctrlb.collapsed", JSON.stringify({ "media-gacha": false })),
  );
  await page.goto("/");

  // The framed picture as the fleet paints it, BEFORE anything is opened — so the "unchanged" claim
  // below is about pixels and not only about the wire.
  const card = ".gc-card.feat img";
  await page.locator("#tabbtn-fleet").click();
  await expect(page.locator(card)).toBeVisible();
  const painted = await positionOf(page, card);

  await page.locator("#tabbtn-conf").click();
  await page.getByRole("button", { name: "Open the Characters gallery" }).click();
  const gallery = page.getByRole("dialog");
  await gallery.getByRole("button", { name: "hero.png", exact: true }).click();
  // The affordance already says a point is set, before the sheet is even open.
  await expect(gallery.getByRole("button", { name: "Focus", exact: true })).toContainText("set");
  await gallery.getByRole("button", { name: "Focus", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Set focus" });
  await expect(sheet.locator(".mgal-frame-stage img")).toBeVisible();
  // THE RETICLE IS ON THE STORED POINT, read off the library's own transform rather than off anything
  // S4 computes. A point LEFT of and BELOW centre means the picture has to move RIGHT and UP for it to
  // land under a reticle fixed at the middle — so `translate` must be `+x, −y`. Unseeded it is `0, 0`,
  // which is what this would have caught: the sheet showing the middle of the picture while claiming
  // to show the owner's framing.
  await expect
    .poll(() =>
      sheet
        .locator(".reactEasyCrop_Image")
        .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).e),
    )
    .toBeGreaterThan(1);
  expect(
    await sheet
      .locator(".reactEasyCrop_Image")
      .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).f),
  ).toBeLessThan(-1);

  // …and confirming without moving anything writes exactly what was already there.
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => puts.length).toBe(1);
  const saved = (
    puts[0] as { media: { namespaces: { gacha: { roles: { characters: { files: Entry[] } } } } } }
  ).media.namespaces.gacha.roles.characters.files;
  expect(saved.find((f) => f.name === "hero.png")?.focal).toEqual(stored);

  // …and the fleet paints the same pixels it painted before the sheet was ever opened.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("#tabbtn-fleet").click();
  await expect(page.locator(card)).toBeVisible();
  expect(await positionOf(page, card)).toBe(painted);

  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

// ── THE PARITY GOLDEN (Emma's S4 review #4) ─────────────────────────────────────────────────────
//
// Every literal below was read out of `git show 492738e` — the commit BEFORE the rewrite — and none of
// it is derived from `focalPosition`, `shiftFocalX` or any other S4 code. That is the whole point: a
// parity assertion computed by the thing under test proves only that it agrees with itself, and it
// cannot catch the two failures that matter here — a call site whose CSS default was lost in the
// rewrite, and an inline override that stopped being written.
//
// Nine windows, and each distinct capsule shape, in the state every install is in.

/** `gacha.css` / `tokens.css` at 492738e — the crop each surface fell back to with no framing set. */
const CSS_DEFAULT = {
  cardPair: "50% 16%", // .gc-card img
  cardFeat: "50% 6%", // .gc-card.feat img
  cardWide: "50% 46%", // .gc-card.wide img
  slideScene: "52% 30%", // .gc-slide img
  slidePromo: "50% 12%", // .gc-slide.promo img
  avatar: "50% 14%", // .gc-dossier .avatar
  watermark: "50% 14%", // .gc-dossier-mark
  posterSlice: "50% 26%", // .po-art img       (was `var(--po-focus, …)`)
  coverSeat: "50% 22%", // .cv-shot img       (was `var(--cv-focus, …)`)
  oracle: "50% 46%", // .gc-oracle-art     (was `var(--gc-oracle-pos)`, tokens.css)
  wallpaper: "56% 30%", // --gc-wallpaper-pos, tokens.css
} as const;

/** `themes/gacha/roster.ts` at 492738e — the hand-tuned values the bundled cast carries, which every
 *  site painted INLINE, and the cover hero's shifted form (`coverHeroFocus`, `50% − 20`). */
const BUNDLED_FOCUS = { pegasus: "50% 12%", three: "50% 14%", four: "50% 8%" } as const;
const HERO_SHIFTED = "30% 12%";

/** Boot gacha's fleet on a given layout with NO owner art — the bundled cast, dealt to the fixture's
 *  two machines: position 0 = `pegasus` (which carries a focus), position 1 = `atlas` (which does not).
 *  `hosts` overrides the fleet when a third machine is needed to reach the `pair` shape. */
async function bootBundled(
  page: Page,
  opts: { layout?: string; tab?: string; hosts?: unknown[] } = {},
) {
  await mockMedia(page, { withFile: false });
  if (opts.hosts !== undefined) {
    await page.route("**/api/hosts", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(opts.hosts),
      }),
    );
  }
  await seedUI(page, {
    theme: "gacha",
    mode: "dark",
    accent: "arcade",
    tab: opts.tab ?? "fleet",
    ...(opts.layout === undefined
      ? {}
      : { themeSettings: { gacha: { fleetLayout: opts.layout } } }),
    v: 1,
  });
  await page.goto("/");
}

/** A third fixture machine, so the capsule track deals `feat · pair · pair` and the PAIR shape (and
 *  therefore its own default crop) is on screen. Two machines deal `feat · wide`. */
const THREE_HOSTS = [
  {
    id: "vault",
    name: "vault",
    ip: "192.168.1.137",
    mac: "aa:bb:cc:dd:ee:ff",
    os_type: "linux",
    role: "server",
    tags: [],
    status: { online: true, latency_ms: 3, checked_at: "2026-06-24T00:00:00Z" },
  },
  {
    id: "corsair",
    name: "corsair",
    ip: "192.168.1.128",
    mac: null,
    os_type: "windows",
    role: "desktop",
    tags: [],
    status: { online: false, latency_ms: null, checked_at: "2026-06-24T00:00:00Z" },
  },
  {
    id: "g5",
    name: "g5",
    ip: "192.168.1.140",
    mac: null,
    os_type: "linux",
    role: "server",
    tags: [],
    status: { online: true, latency_ms: 5, checked_at: "2026-06-24T00:00:00Z" },
  },
];

test("PARITY — the capsule track, the banner and the backdrop paint their pre-S4 strings", async ({
  page,
  pageErrors,
}) => {
  await bootBundled(page);
  await expect(page.locator(".gc-card.feat img")).toBeVisible();

  // ① the FEATURED card, painting `pegasus` — the INLINE path: the entry's own hand-tuned value beats
  //    the shape's default, exactly as it did when the value was written straight onto the element.
  expect(await positionOf(page, ".gc-card.feat img")).toBe(BUNDLED_FOCUS.pegasus);
  // ② the WIDE card, painting `atlas` — the DEFAULT path: no framing, so no inline declaration at all
  //    and the shape's own crop stands. This is the assertion a lost CSS default would fail.
  expect(await positionOf(page, ".gc-card.wide img")).toBe(CSS_DEFAULT.cardWide);
  // ③ the banner's FIRST slide is scene art, which declares no focus. (Since the 2026-08-26 ruling that
  //    slide is dealt from the banner pool rather than pinned, so on a bundled install it is `b2` and no
  //    longer `banner.webp` — both are scene art with no framing, which is what this arm is about.)
  expect(await positionOf(page, ".gc-slide:not(.promo) img")).toBe(CSS_DEFAULT.slideScene);
  // ④ the PROMO slides: the same two entries again, in a window of a completely different shape —
  //    `pegasus` inline, `atlas` on the promo default.
  const promos = page.locator(".gc-slide.promo img");
  expect(await promos.nth(0).evaluate((el) => getComputedStyle(el).objectPosition)).toBe(
    BUNDLED_FOCUS.pegasus,
  );
  expect(await promos.nth(1).evaluate((el) => getComputedStyle(el).objectPosition)).toBe(
    CSS_DEFAULT.slidePromo,
  );
  // ⑤ the fleet BACKDROP — the one surface that cannot measure itself, so its value is published on
  //    `body` exactly as before. It is the second layer of a two-layer background.
  const backdrop = await page
    .locator(".kit-main")
    .evaluate((el) => getComputedStyle(el).backgroundPosition);
  expect(backdrop, "the wallpaper's own default crop").toContain(CSS_DEFAULT.wallpaper);

  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("PARITY — the PAIR capsule shape, which only a third machine puts on screen", async ({
  page,
  pageErrors,
}) => {
  // Two machines deal `feat · wide`; three deal `feat · pair · pair` (`fleet.ts#cardShapes`). Without
  // this arm the `pair` shape's default — the base `.gc-card img` rule — is never painted at all.
  await bootBundled(page, { hosts: THREE_HOSTS });
  const pairs = page.locator(".gc-card:not(.feat):not(.wide) img");
  await expect(pairs.first()).toBeVisible();
  // position 1 is `atlas` (no focus) → the base default; position 2 is `3` (focus `50% 14%`) → inline.
  expect(await pairs.nth(0).evaluate((el) => getComputedStyle(el).objectPosition)).toBe(
    CSS_DEFAULT.cardPair,
  );
  expect(await pairs.nth(1).evaluate((el) => getComputedStyle(el).objectPosition)).toBe(
    BUNDLED_FOCUS.three,
  );

  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("PARITY — the FEATURED shape's own default, which needs art carrying no framing", async ({
  page,
  pageErrors,
}) => {
  // `pegasus` sits at position 0 and carries a focus, so the bundled cast can never show `.gc-card.feat`
  // falling back to its own crop. One owner file — which carries no framing until someone sets one — is
  // what puts that default on screen.
  await mockMedia(page, { withFile: true });
  await seedUI(page, { theme: "gacha", mode: "dark", accent: "arcade", tab: "fleet", v: 1 });
  await page.goto("/");
  await expect(page.locator(".gc-card.feat img")).toBeVisible();
  expect(await positionOf(page, ".gc-card.feat img")).toBe(CSS_DEFAULT.cardFeat);

  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("PARITY — the DOSSIER's two windows, the poster slice, the cover's two seats, the oracle", async ({
  page,
  pageErrors,
}) => {
  // ── the DOSSIER: one entry, two windows on one sheet (a 104x138 portrait and a 66%-wide watermark),
  //    which is the case a single published value served wrongly by construction.
  await bootBundled(page);
  await page.getByRole("button", { name: "open vault dossier, online" }).click();
  await expect(page.locator(".gc-dossier .avatar")).toBeVisible();
  expect(await positionOf(page, ".gc-dossier .avatar")).toBe(BUNDLED_FOCUS.pegasus);
  expect(await positionOf(page, ".gc-dossier-mark")).toBe(BUNDLED_FOCUS.pegasus);
  // …and their own defaults, on art that declares no framing: `corsair` is position 1 = `atlas`.
  await page.keyboard.press("Escape");
  await expect(page.locator(".gc-dossier")).toHaveCount(0);
  await page.getByRole("button", { name: "open corsair dossier, sleeping" }).click();
  await expect(page.locator(".gc-dossier .avatar")).toBeVisible();
  expect(await positionOf(page, ".gc-dossier .avatar")).toBe(CSS_DEFAULT.avatar);
  expect(await positionOf(page, ".gc-dossier-mark")).toBe(CSS_DEFAULT.watermark);

  // ── the POSTER, where the value used to ride `--po-focus` on the slice button.
  await bootBundled(page, { layout: "poster" });
  const slices = page.locator(".po-art img");
  await expect(slices.first()).toBeVisible();
  expect(await slices.nth(0).evaluate((el) => getComputedStyle(el).objectPosition)).toBe(
    BUNDLED_FOCUS.pegasus,
  );
  expect(await slices.nth(1).evaluate((el) => getComputedStyle(el).objectPosition)).toBe(
    CSS_DEFAULT.posterSlice,
  );
  // …and the retired property is gone from the button, not merely unread.
  expect(
    await page
      .locator(".po-slice")
      .first()
      .evaluate((el) => el.style.getPropertyValue("--po-focus")),
  ).toBe("");

  // ── the COVER: ONE element, TWO seats, and the sharpest arm of the lot — it is where the
  //    `--cv-focus` / `--cv-hero-focus` chain lived, and the hero's twenty-point slide has to survive
  //    to the digit.
  await bootBundled(page, { layout: "cover" });
  await expect(page.locator(".cv-card.is-hero .cv-shot img")).toBeVisible();
  expect(await positionOf(page, ".cv-card.is-hero .cv-shot img")).toBe(HERO_SHIFTED);
  expect(await positionOf(page, ".cv-card.is-cut .cv-shot img")).toBe(CSS_DEFAULT.coverSeat);
  expect(
    await page
      .locator(".cv-card")
      .first()
      .evaluate((el) => [
        el.style.getPropertyValue("--cv-focus"),
        el.style.getPropertyValue("--cv-hero-focus"),
      ]),
  ).toEqual(["", ""]);

  // ── the ORACLE: one window, two stacked copies, and the one custom property that legitimately
  //    survived. Its bundled art is scene art and declares no framing.
  await bootBundled(page, { tab: "agent" });
  await expect(page.locator(".gc-oracle-art").first()).toBeVisible();
  expect(await positionOf(page, ".gc-oracle-art")).toBe(CSS_DEFAULT.oracle);

  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});
