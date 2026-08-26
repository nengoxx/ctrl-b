import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";

import { expect, SETTINGS, test } from "./fixtures";

// The owner-media LIBRARY round trip (D65 / MEDIA_MANAGER_PLAN §6), driven in the real built app. The
// vitest suite (tests/components/mediaGallery.test.tsx) pins every patch SHAPE against a mocked api
// client; what only a browser run can prove is the whole chain — the card opens a real trapped dialog,
// a gesture leaves through `PUT /api/settings` as a `media.namespaces.<ns>` patch, a delete leaves
// through D65's typed `DELETE` verb first, the SERVER's answer is what repaints, and the phone's BACK
// gesture closes the overlay instead of leaving the app.
//
// The mock is STATEFUL (the appearance-write precedent in fixtures.ts) and COLLATES like the server:
// the owner's `files` entries in order, then unlisted files on disk, then the role's unlisted bundled
// ids as the fallback tier (`library-v1`). A static index would make every repaint assertion vacuous —
// and the fallback tier is what an untouched section looks like — a gesture that ORDERS the section
// names it whole (§2.3 ③ as amended 2026-08-25), which is what makes the order the owner sees the one
// the next read serves.

/** The bundled cast the real registry ships for `gacha/characters`. */
const BUNDLED = ["pegasus", "atlas", "3", "4", "lyra", "rook"];

interface Entry {
  name?: string;
  bundled?: string;
  hidden?: boolean;
}

/** The bundled cast as `files` ENTRIES — what an order write names when it sweeps the section (§2.3 ③
 *  as amended 2026-08-25: an ORDER intent states the whole section's order, defaults included). */
const castEntries = (order: readonly string[] = BUNDLED): Entry[] =>
  order.map((bundled) => ({ bundled }));

const diskRow = (filename: string, listed: boolean, hidden: boolean) => ({
  name: filename.replace(/\.webp$/, ""),
  file: filename,
  url: `/api/media/gacha/files/characters/${filename}`,
  format: "webp",
  size_bytes: 88_000,
  revision: `1:88000:${filename}`,
  width: 640,
  height: 854,
  unusable: false,
  unusable_reason: null as string | null,
  listed,
  hidden,
});

const bundledRow = (id: string, listed: boolean, hidden: boolean) => ({
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
  unusable_reason: null as string | null,
  listed,
  hidden,
});

/** `core/media.py#list_role`, in miniature — the one rule both ends name `library-v1`. */
function collate(files: Entry[], onDisk: string[]) {
  const rows: (ReturnType<typeof diskRow> | ReturnType<typeof bundledRow>)[] = [];
  const seenFiles = new Set<string>();
  const seenIds = new Set<string>();
  for (const item of files) {
    if (item.bundled != null) {
      if (BUNDLED.includes(item.bundled) && !seenIds.has(item.bundled)) {
        seenIds.add(item.bundled);
        rows.push(bundledRow(item.bundled, true, item.hidden === true));
      }
      continue;
    }
    if (item.name != null && onDisk.includes(item.name) && !seenFiles.has(item.name)) {
      seenFiles.add(item.name);
      rows.push(diskRow(item.name, true, item.hidden === true));
    }
  }
  for (const f of [...onDisk].sort()) if (!seenFiles.has(f)) rows.push(diskRow(f, false, false));
  for (const id of BUNDLED) if (!seenIds.has(id)) rows.push(bundledRow(id, false, false));
  return rows;
}

/** The PUT's answer, as the real endpoint gives it: the WHOLE masked config back.
 *
 *  Two things ride on that being whole (the S4 rider, closed here). The ECHO has to carry the media
 *  block — `useSaveSettings` adopts it as the settings cache, and the gallery's next write is a
 *  read-modify-write over exactly that, so an echo that dropped it would let the next gesture rebuild
 *  the list from the index alone and silently lose every per-item field. And it has to carry EVERY
 *  OTHER section too: Conf reads each one off the adopted doc, so a partial echo hands the tab a config
 *  with no `voice` and the next render throws — a React recoverable error (#520) that no assertion in
 *  this file was looking at, which is why `pageErrors` is asserted beside them now.
 *
 *  `notifications` is spelled out because the save's own success path reads it off the echo
 *  (`useSaveSettings` adopts it as the notification-prefs cache) — `SETTINGS` has no such section. */
const saveEcho = (files: Entry[]) => ({
  settings: {
    ...SETTINGS,
    notifications: {},
    media: { namespaces: { gacha: { roles: { characters: { files } } } } },
  },
  restart_required: [] as string[],
  warnings: [] as string[],
  providers_rev: "r1",
});

/** Focus must never be left on `<body>`: the trap's Escape and Tab both ride keydown from whatever has
 *  focus, so an orphaned focus is a dialog the keyboard cannot leave. The gallery unmounts the control
 *  focus is on twice in an ordinary flow (leaving the detail panel; a delete taking its tile with it),
 *  which is exactly when it has to re-land. */
async function expectFocusTrapped(page: import("@playwright/test").Page) {
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') != null))
    .toBe(true);
}

/** Boot straight into Conf, under gacha, with the media group already open. */
async function bootConf(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "ctrlb.ui",
      JSON.stringify({ theme: "gacha", mode: "dark", accent: "arcade", tab: "conf", v: 1 }),
    );
    localStorage.setItem("ctrlb.collapsed", JSON.stringify({ "media-gacha": false }));
  });
}

/** The URL an owner file is PAINTED at — the `?rev=` every resolver stamps (defect #1). */
const painted = (filename: string) =>
  `/api/media/gacha/files/characters/${filename}?rev=${encodeURIComponent(`1:88000:${filename}`)}`;

/** The STATEFUL media mock: a `characters/` folder plus the config `files` list, collated on every read
 *  the way the server does, and mutated by the writes the gallery makes. Registered AFTER the baseline
 *  mock so it wins; everything it does not own falls through. */
async function statefulMedia(
  page: import("@playwright/test").Page,
  initial: { onDisk: string[]; files: Entry[] },
) {
  const st = { onDisk: [...initial.onDisk], files: [...initial.files] };
  const puts: Record<string, unknown>[] = [];
  const deletes: string[] = [];
  const uploads: { filename: string; body: Buffer }[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === "GET" && path.endsWith("/api/media/gacha")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ns: "gacha",
          collation: "library-v1",
          roles: { characters: collate(st.files, st.onDisk), banner: [], reel: [], oracle: [] },
          slots: {},
        }),
      });
    }
    // D65's typed write verb: the BYTES, raw-bodied, never multipart and never POST. The mock is the
    // server's own contract in miniature — the file joins the folder, so the next index read collates
    // it exactly as the real one would.
    if (req.method() === "PUT" && path.includes("/api/media/gacha/files/")) {
      const filename = decodeURIComponent(path.split("/").pop() ?? "");
      uploads.push({ filename, body: req.postDataBuffer() ?? Buffer.alloc(0) });
      st.onDisk.push(filename);
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ name: filename.replace(/\.[^.]+$/, ""), file: filename }),
      });
    }
    if (req.method() === "DELETE" && path.includes("/api/media/gacha/files/")) {
      deletes.push(path);
      st.onDisk = st.onDisk.filter((f) => !path.endsWith(f));
      return route.fulfill({ status: 204, body: "" });
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
        body: JSON.stringify(saveEcho(st.files)),
      });
    }
    return route.fallback();
  });
  return { st, puts, deletes, uploads };
}

/** The e2e's own picker files, from the shared corpus (`scripts/gen-test-images.mjs`). */
const image = (name: string) =>
  fileURLToPath(new URL(`../tests/fixtures/images/${name}`, import.meta.url));

test("Conf · Theme art — the library round trip: activate · reorder · In use · delete", async ({
  page,
  pageErrors,
}) => {
  await bootConf(page);
  const { st, puts, deletes } = await statefulMedia(page, {
    onDisk: ["a.webp", "b.webp"],
    files: [],
  });

  await page.goto("/");
  const group = page.locator("#media-gacha");
  const card = group.getByRole("button", { name: "Open the characters gallery", exact: true });

  // ① the ENTRY CARD paints what the §2.4 resolver says is live — the owner's two files, dealt — and
  //    the five bundled entries sit in the library rather than in the deal.
  await expect(card).toContainText(`${BUNDLED.length + 2} images`);
  await expect(card).toContainText("dealt to machines in this order");
  await expect(card.locator("img")).toHaveCount(2);

  await card.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("status")).toContainText(`${BUNDLED.length + 2} images`);

  // ② MOVE TO TOP is activation ("W6" — the library's ORDER is the only priority system), and it is
  //    an ORDER intent, so the write names the WHOLE section — the two files and the five bundled
  //    defaults, in the order they now sit (§2.3 ③ as amended).
  await dialog.getByRole("button", { name: "b.webp", exact: true }).click();
  await dialog.getByRole("button", { name: "Move to top", exact: true }).click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]).toEqual({
    media: {
      namespaces: {
        gacha: {
          roles: {
            characters: {
              files: [{ name: "b.webp" }, { name: "a.webp" }, ...castEntries()],
            },
          },
        },
      },
    },
  });

  // …and the grid repaints from the SERVER's listing, not from a local optimistic order.
  await dialog.getByRole("button", { name: "‹ All images", exact: true }).click();
  await expect(dialog.locator(".mgal-tile").first()).toHaveAttribute("aria-label", "b.webp");

  // ③ the ↑/↓ pair — the WCAG floor S5's drag never replaces.
  await dialog.getByRole("button", { name: "a.webp", exact: true }).click();
  await dialog.getByRole("button", { name: "↑ Move up", exact: true }).click();
  await expect.poll(() => puts.length).toBe(2);
  expect(puts[1]).toMatchObject({
    media: {
      namespaces: {
        gacha: {
          roles: {
            characters: {
              files: [{ name: "a.webp" }, { name: "b.webp" }, ...castEntries()],
            },
          },
        },
      },
    },
  });

  // ④ the In-use switch writes `hidden`, and the entry leaves the deal while staying in the library.
  await dialog.getByRole("switch", { name: /In use — a.webp/ }).click();
  await expect.poll(() => puts.length).toBe(3);
  // The In-use switch is NOT an order intent, so it adds nothing of its own — the cast is listed
  //    because the two order writes above already said so.
  expect(st.files).toEqual([
    { name: "a.webp", hidden: true },
    { name: "b.webp" },
    ...castEntries(),
  ]);
  await dialog.getByRole("button", { name: "‹ All images", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText(`${BUNDLED.length + 2} images`); // still listed…
  await expectFocusTrapped(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // …but IT is out of the deal. The collage is capped at four, so the count says nothing useful here
  // — what says it is that `a.webp` is not among the pictures and `b.webp` still is. (The five
  // defaults are dealt beside it now: ②'s order write listed them, which puts them in the owner's own
  // tier. That is the amendment's one real consequence in a MIXED section, and the In-use switch is
  // how a default leaves again — exactly as it is for a file.)
  await expect(card.locator(`img[src="${painted("a.webp")}"]`)).toHaveCount(0);
  await expect(card.locator(`img[src="${painted("b.webp")}"]`)).toHaveCount(1);

  // ⑤ DELETE — the bytes leave through D65's typed verb FIRST, then ONE config write.
  await card.click();
  await dialog.getByRole("button", { name: "b.webp", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).last().click();
  await expect.poll(() => deletes.length).toBe(1);
  expect(deletes[0]).toBe("/api/media/gacha/files/characters/b.webp");
  await expect.poll(() => puts.length).toBe(4);
  expect(st.files).toEqual([{ name: "a.webp", hidden: true }, ...castEntries()]);

  // ⑥ and with the owner's only usable file switched off, the BUNDLED CAST is what the fleet deals.
  //    It reaches the deal through the OWNER's tier now rather than through the fallback one — the
  //    sweep listed it two gestures ago — and that is the amendment's whole claim: the same art, in
  //    the order the owner arranged, whichever tier is carrying it.
  await expectFocusTrapped(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card).toContainText("dealt to machines");
  await expect(card.locator("img")).toHaveCount(4); // the collage of the bundled cast, capped at four

  // …and nothing above threw. Every write here adopts the PUT's echo as the settings cache and Conf
  // reads every section off it, so a partial echo surfaces as a recoverable React error and NOTHING
  // else (S4's rider). This is the assertion that makes that class visible.
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

/** Drag the tile at `from` onto the tile at `to`, with a real pointer: press, cross the activation
 *  distance, land on the LEADING half of the target tile (the grid's insertion rule is reading order —
 *  past a tile's horizontal midpoint means "after it"), release. */
async function dragTile(
  page: import("@playwright/test").Page,
  from: import("@playwright/test").Locator,
  to: import("@playwright/test").Locator,
  /** Which half of the target tile the finger lets go over — i.e. which SIDE of it the row lands on.
   *  `after` is what "drop it at the very end" is, and it is a different slot from `before`. */
  side: "before" | "after" = "before",
) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  // Two steps: one to cross the 6px activation distance, one to arrive. A single jump would put the
  // whole gesture in one `pointermove`, which is not what a hand does and not what the hit test sees.
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 12);
  await page.mouse.move(b.x + b.width * (side === "after" ? 0.8 : 0.2), b.y + b.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
}

test("Conf · Theme art — a DRAG reorders, holds through the commit, and the order survives a reload", async ({
  page,
  pageErrors,
}) => {
  // S5's own round trip (MEDIA_MANAGER_PLAN §7). The vitest suite pins the gesture's machine and its
  // geometry against stubbed rects; what only a browser can prove is that a real pointer over a real
  // 3-column grid lands on the slot the owner aimed at, that the write it produces is the SAME `moveBy`
  // intent the ↑/↓ buttons enqueue — tier rule included, so no bundled row is swept in — and that the
  // order the server then serves is the one already on screen.
  await bootConf(page);
  const { st, puts } = await statefulMedia(page, {
    onDisk: ["a.webp", "b.webp", "c.webp"],
    files: [],
  });

  await page.goto("/");
  const card = page.getByRole("button", { name: "Open the characters gallery", exact: true });
  await card.click();
  const dialog = page.getByRole("dialog");
  const tiles = dialog.locator(".mgal-tile");
  await expect(tiles).toHaveCount(BUNDLED.length + 3); // three files on disk + the bundled cast
  await expect(tiles.first()).toHaveAttribute("aria-label", "a.webp");

  // ① drag the THIRD tile in front of the first.
  await dragTile(page, tiles.nth(2), tiles.nth(0));
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]).toEqual({
    media: {
      namespaces: {
        gacha: {
          roles: {
            characters: {
              // The WHOLE section, in the order the drag produced (§2.3 ③ as amended): the disk rows
              // — without which the order is inexpressible and the drag snaps back — and the five
              // bundled defaults, which is what makes the next drag able to say anything at all.
              files: [{ name: "c.webp" }, { name: "a.webp" }, { name: "b.webp" }, ...castEntries()],
            },
          },
        },
      },
    },
  });

  // ② the grid repaints from the SERVER's listing — and the held transform is gone with it, so what is
  //    on screen is the real order rather than a transform pretending to be one.
  await expect(tiles.first()).toHaveAttribute("aria-label", "c.webp");
  await expect(dialog.locator("[data-drag-held]")).toHaveCount(0);
  await expect(dialog.locator('[style*="translate"]')).toHaveCount(0);

  // ③ THE BOTTOM OF THE LIST IS THE BOTTOM OF THE LIST. Drag that same file onto the very LAST tile —
  //    a bundled one. This used to be CLAMPED to the last disk row: the trailing bundled tier was not
  //    arrangeable, so the drop landed three slots short of where the finger was. The 2026-08-25
  //    amendment makes an order write state the WHOLE section's order, so the file goes where it was
  //    put and the write names every entry it passed on the way (same art, new order).
  await dragTile(page, tiles.nth(0), tiles.nth(BUNDLED.length + 2), "after");
  await expect.poll(() => puts.length).toBe(2);
  expect(puts[1]).toEqual({
    media: {
      namespaces: {
        gacha: {
          roles: {
            characters: {
              files: [{ name: "a.webp" }, { name: "b.webp" }, ...castEntries(), { name: "c.webp" }],
            },
          },
        },
      },
    },
  });
  await expect(tiles.nth(BUNDLED.length + 2)).toHaveAttribute("aria-label", "c.webp");
  await expect(tiles.nth(2)).toHaveAttribute("aria-label", "pegasus (bundled)");
  await expect(dialog.locator('[style*="translate"]')).toHaveCount(0);

  // ④ …and it is PERSISTED, not just painted.
  await page.reload();
  await card.click();
  await expect(page.getByRole("dialog").locator(".mgal-tile").first()).toHaveAttribute(
    "aria-label",
    "a.webp",
  );
  expect(st.files.map((e) => e.name ?? e.bundled)).toEqual([
    "a.webp",
    "b.webp",
    ...BUNDLED,
    "c.webp",
  ]);
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("Conf · Theme art — a section of nothing but DEFAULTS drags, downwards included", async ({
  page,
  pageErrors,
}) => {
  // The owner-round defect (2026-08-25), in the state every theme section is in on a fresh install:
  // no owner files, five bundled characters, an empty `files` list. Every downward drag used to be a
  // no-op — the write could express no position past the row's own, so the gesture clamped to where it
  // started and the tile snapped home — and an upward multi-slot drag landed somewhere else entirely.
  // Reordering the shipped cast IS the feature; this is the browser proof that it works.
  await bootConf(page);
  const { st, puts } = await statefulMedia(page, { onDisk: [], files: [] });

  await page.goto("/");
  const card = page.getByRole("button", { name: "Open the characters gallery", exact: true });
  await card.click();
  const dialog = page.getByRole("dialog");
  const tiles = dialog.locator(".mgal-tile");
  await expect(tiles).toHaveCount(BUNDLED.length);
  await expect(tiles.first()).toHaveAttribute("aria-label", "pegasus (bundled)");

  // DOWN two slots — the direction that used to refuse itself. The drop lands on the LEADING half of
  // the second row's first tile, which is the insertion slot after `atlas` and `3` (reading order).
  await dragTile(page, tiles.nth(0), tiles.nth(3));
  await expect.poll(() => puts.length).toBe(1);
  expect(st.files.map((e) => e.bundled)).toEqual([
    ...BUNDLED.slice(1, 3),
    BUNDLED[0],
    ...BUNDLED.slice(3),
  ]);
  // The SERVER's collation is what repaints, so this is the order the owner keeps.
  await expect(tiles.nth(2)).toHaveAttribute("aria-label", "pegasus (bundled)");
  await expect(dialog.locator("[data-drag-held]")).toHaveCount(0);

  // …and the cast is still five, not the two rows the swap touched (the deal-shrinking half).
  await page.reload();
  await card.click();
  await expect(page.getByRole("dialog").locator(".mgal-tile")).toHaveCount(BUNDLED.length);
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("Conf · Theme art — Restore defaults puts the shipped art back and keeps the owner's", async ({
  page,
  pageErrors,
}) => {
  // The owner's way BACK (S6). Reordering a section now names the defaults in `files`, and switching
  // one off is a click — so there has to be one action that undoes all of it without touching what the
  // owner put there. It is absent while the section is still exactly as it shipped.
  await bootConf(page);
  const { st, puts } = await statefulMedia(page, {
    onDisk: ["a.webp"],
    files: [{ bundled: "lyra" }, { name: "a.webp" }, { bundled: "pegasus", hidden: true }],
  });

  await page.goto("/");
  const card = page.getByRole("button", { name: "Open the characters gallery", exact: true });
  await card.click();
  const dialog = page.getByRole("dialog");
  const restore = dialog.getByRole("button", { name: "Restore defaults", exact: true });
  await restore.click();
  await page.getByRole("button", { name: "Restore", exact: true }).last().click();
  await expect.poll(() => puts.length).toBe(1);
  // The bundled ids leave `files` — which is what puts them back in the REGISTRY's order — and the
  // owner's file keeps its entry, switched back on with it.
  expect(st.files).toEqual([{ name: "a.webp" }]);
  // …and the control goes with it: there is nothing left to restore.
  await expect(restore).toHaveCount(0);
  await expect(dialog.locator(".mgal-tile").first()).toHaveAttribute("aria-label", "a.webp");
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("Conf · Theme art — a REFUSED drag snaps back, says so, and the next drag is admitted", async ({
  page,
  pageErrors,
}) => {
  // The other half of the held commit (Emma #8): the transform is held on the OPTIMISM that the server
  // will agree, so a refusal has to release it in `finally` — back to the order the owner picked it up
  // from, with the queue's own error toast left standing and the surface still live. A held transform
  // that outlived a failed write would be the worst outcome available: the gallery showing an
  // arrangement the server rejected.
  await bootConf(page);
  await statefulMedia(page, { onDisk: ["a.webp", "b.webp", "c.webp"], files: [] });
  let attempts = 0;
  // Registered AFTER the stateful mock, so it wins on the settings PUT and nothing else.
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    attempts++;
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "the config could not be written" }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open the characters gallery", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const tiles = dialog.locator(".mgal-tile");
  await expect(tiles).toHaveCount(BUNDLED.length + 3);

  await dragTile(page, tiles.nth(2), tiles.nth(0));
  await expect.poll(() => attempts).toBe(1);
  await expect(page.locator(".toast.err")).toBeVisible();
  // Released: the order is the pre-drag one, and no tile is still wearing a drag transform.
  await expect(tiles.first()).toHaveAttribute("aria-label", "a.webp");
  await expect(dialog.locator("[data-drag-held]")).toHaveCount(0);
  await expect(dialog.locator('[style*="translate"]')).toHaveCount(0);

  // …and the latch let go with it: a fresh drag is admitted rather than silently refused forever.
  await dragTile(page, tiles.nth(2), tiles.nth(0));
  await expect.poll(() => attempts).toBe(2);
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("Conf · Theme art — what the gallery says is in use is what the FLEET paints", async ({
  page,
}) => {
  // The arm the S2 review asked for by name. Every other assertion in this file reads the Conf card —
  // which resolves through the same §2.4 functions the theme does, so a broken PAINT SITE would leave
  // them all green. This one crosses to gacha's own Fleet body and reads the picture on a capsule card.
  await bootConf(page);
  const { st } = await statefulMedia(page, { onDisk: ["a.webp", "b.webp"], files: [] });
  await page.goto("/");
  const card = page.getByRole("button", { name: "Open the characters gallery", exact: true });
  const dealt = page.locator(".gc-card img").first();

  // ① the fleet deals the collation's first entry — the owner's, and STAMPED (defect #1).
  await page.locator("#tabbtn-fleet").click();
  await expect(dealt).toHaveAttribute("src", painted("a.webp"));

  // ② "Move to top" in the gallery moves the fleet with it — one resolver, two readers.
  await page.locator("#tabbtn-conf").click();
  await card.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "b.webp", exact: true }).click();
  await dialog.getByRole("button", { name: "Move to top", exact: true }).click();
  await expect
    .poll(() => st.files)
    .toEqual([{ name: "b.webp" }, { name: "a.webp" }, ...castEntries()]);
  await expectFocusTrapped(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("#tabbtn-fleet").click();
  await expect(dealt).toHaveAttribute("src", painted("b.webp"));
});

test("Conf · Theme art — a library switched entirely OFF leaves the fleet empty, not bundled", async ({
  page,
}) => {
  // Emma's S2 review #2, end to end. The render-side fallback used to read "resolved to nothing" as
  // "this must be a stub payload" and restore the shipped cast — so the card said "nothing in use"
  // while the fleet kept dealing exactly the art the owner had just retired.
  await bootConf(page);
  await statefulMedia(page, {
    onDisk: ["a.webp"],
    files: [
      { name: "a.webp", hidden: true },
      ...BUNDLED.map((id) => ({ bundled: id, hidden: true })),
    ],
  });
  await page.goto("/");
  const card = page.getByRole("button", { name: "Open the characters gallery", exact: true });
  await expect(card).toContainText("nothing in use");

  await page.locator("#tabbtn-fleet").click();
  // The capsule cards are still there — a card without art is still a card (§5.3) — and every one of
  // them is on the resolver's placeholder rather than on a picture the owner switched off.
  await expect(page.locator(".gc-card")).not.toHaveCount(0);
  await expect(page.locator(".gc-card img")).toHaveCount(0);
  await expect(page.locator(".gc-card-blank").first()).toBeAttached();
});

test("Conf · Theme art — the phone's BACK gesture closes the gallery, not the app", async ({
  page,
}) => {
  // The bounded half of a navigation model (§6.2): one history entry while the overlay is open, and the
  // `popstate` handler is the only closer. Without it Back would leave the PWA outright.
  await bootConf(page);
  await page.goto("/");
  const card = page.getByRole("button", { name: "Open the characters gallery", exact: true });
  await card.click();
  await expect(page.getByRole("dialog")).toHaveCount(1);

  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Still in the app, on the tab we opened from — the entry that was spent was OURS.
  await expect(card).toBeVisible();
});

test("Conf · Theme art — the gallery + its detail panel pass the a11y gate", async ({ page }) => {
  // The §11 "#12 a11y batch", with teeth. The tab-level scans in `a11y.spec.ts` never see this
  // surface: the media group ships collapsed, and the modal only exists once it is opened. So the
  // scan comes to it — the grid AND the detail panel, which is where every control lives.
  await bootConf(page);
  await page.route("**/api/media/gacha", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ns: "gacha",
        collation: "library-v1",
        roles: { characters: collate([], ["a.webp"]), banner: [], reel: [], oracle: [] },
        slots: {},
      }),
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Open the characters gallery", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expectNoViolations(page);

  await dialog
    .getByRole("button", { name: /bundled/ })
    .first()
    .click();
  await expect(dialog.getByRole("switch")).toBeVisible();
  await expectNoViolations(page);
});

/** axe over the open dialog, on the house exemption (D24: the palettes are deliberate). */
async function expectNoViolations(page: import("@playwright/test").Page) {
  const { violations } = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(["color-contrast"])
    .analyze();
  expect(
    violations,
    `\n${violations.map((v) => `${v.id} (${v.impact}, ${v.nodes.length} nodes)`).join("\n")}`,
  ).toEqual([]);
}

test("Conf · Theme art — the UPLOAD round trip: Add → pick → crop → tile → active → delete", async ({
  page,
}) => {
  // §11's full round trip, and the only place the export pipeline runs for REAL: a real picker
  // activity, a real `createImageBitmap`, a real worker, a real `OffscreenCanvas.convertToBlob`.
  // Everything the vitest suite pins is a SHAPE against a faked worker; what only a browser can prove
  // is that the pipeline produces bytes at all, that they leave through D65's typed verb, and that
  // the file the server then lists is the one the gallery paints.
  await bootConf(page);
  const { st, puts, uploads, deletes } = await statefulMedia(page, { onDisk: [], files: [] });

  await page.goto("/");
  const card = page.getByRole("button", { name: "Open the characters gallery", exact: true });
  await card.click();
  const dialog = page.getByRole("dialog");
  // The role is empty of OWNER files; its bundled tier is what the grid holds until now.
  await expect(dialog.getByRole("status")).toContainText(`${BUNDLED.length} images`);

  // ① the ADD ROW is the one admission path, and it opens the real picker.
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /Add an image/ }).click();
  await (await chooser).setFiles(image("photo-320x240.png"));

  // ② the crop step. Untouched ⇒ "use as is" — the whole picture, through the same export.
  const crop = page.getByRole("dialog", { name: "Frame the image" });
  await expect(crop).toBeVisible();
  await crop.getByRole("button", { name: "Use as is", exact: true }).click();

  // ③ the BYTES leave through the typed PUT, under a name minted from the picked stem and the
  //    EXPORT's own extension — a PNG source keeps alpha, so it lands as webp.
  await expect.poll(() => uploads.length).toBe(1);
  expect(uploads[0].filename).toBe("photo-320x240.webp");
  expect(uploads[0].body.length).toBeGreaterThan(64);
  // The real encoder's own header, not a label we chose: `RIFF....WEBP`.
  expect(uploads[0].body.subarray(0, 4).toString("latin1")).toBe("RIFF");
  expect(uploads[0].body.subarray(8, 12).toString("latin1")).toBe("WEBP");

  // ④ …then ONE config write appends it, and the server's next listing is what repaints.
  await expect.poll(() => puts.length).toBe(1);
  expect(st.files).toEqual([{ name: "photo-320x240.webp" }]);
  const tile = dialog.getByRole("button", { name: "photo-320x240.webp", exact: true });
  await expect(tile).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText(`${BUNDLED.length + 1} images`); // the upload + the bundled tier

  // ⑤ it is an ordinary library entry from here on: move it to the top, then delete it.
  await tile.click();
  await dialog.getByRole("button", { name: "Move to top", exact: true }).click();
  await expect.poll(() => puts.length).toBe(2);
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).last().click();
  await expect.poll(() => deletes.length).toBe(1);
  expect(deletes[0]).toBe("/api/media/gacha/files/characters/photo-320x240.webp");
  // The upload's entry is gone; the cast stays listed, because ⑤'s "Move to top" was an order
  // intent and named it. A DELETE is not one, so it removes exactly the one entry it was about.
  await expect.poll(() => st.files).toEqual(castEntries());
});

test("Conf · Theme art — the export strips EXIF, and the picked extension decides nothing", async ({
  page,
}) => {
  // The privacy half of "always re-encode" (R54 §3.5, measured in both engines): the owner uploads
  // phone photos to a homelab panel, and the GPS tag of their house must not land in
  // `$CTRLB_HOME/media`. It is also why the SERVER needs no metadata stripper — it has no decoder at
  // all, by D65's own rule — so this assertion is the only thing standing behind that claim.
  await bootConf(page);
  const { uploads } = await statefulMedia(page, { onDisk: [], files: [] });
  await page.goto("/");
  await page.getByRole("button", { name: "Open the characters gallery", exact: true }).click();
  const dialog = page.getByRole("dialog");

  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /Add an image/ }).click();
  await (await chooser).setFiles(image("jpeg-exif-portrait.jpg"));
  await page
    .getByRole("dialog", { name: "Frame the image" })
    .getByRole("button", { name: "Use as is", exact: true })
    .click();

  await expect.poll(() => uploads.length).toBe(1);
  // A JPEG source cannot carry alpha, so the policy sends it to jpeg — and the stored NAME follows
  // the produced bytes (`.jpg`), never the `.jpeg` that was picked.
  expect(uploads[0].filename).toBe("jpeg-exif-portrait.jpg");
  const head = uploads[0].body.subarray(0, 4096).toString("latin1");
  expect(uploads[0].body.subarray(0, 2).toString("hex")).toBe("ffd8");
  expect(head).not.toContain("Exif");
  expect(head).not.toContain("ns.adobe.com/xap"); // XMP

  // …and the SOURCE really carries one, which is the half a stripping test silently loses: a fixture
  // whose EXIF never got written makes every assertion above vacuously true. (It happened — sharp's
  // `withExifMerge` wrote `Orientation: 1` where 6 was asked for.)
  const source = readFileSync(image("jpeg-exif-portrait.jpg"));
  expect(source.subarray(0, 4096).toString("latin1")).toContain("Exif");

  // THE orientation fact, end to end. The file is ENCODED 400×200 with `Orientation=6`, so every
  // engine DISPLAYS it 200×400 — and what we store must be what the owner saw. A stored 400×200 would
  // mean the decode ignored EXIF; the wrong REGION would mean the crop went through
  // `createImageBitmap`'s rect form, which returns the wrong quadrant on exactly this input in
  // Chromium (R54 §3.2, its own `TODO(crbug.com/40773069)`).
  expect(sofSize(uploads[0].body)).toEqual({ width: 200, height: 400 });
});

/** A JPEG's frame size, from its own bytes — the only honest way to ask what was stored. */
function sofSize(jpeg: Buffer): { width: number; height: number } | null {
  for (let i = 2; i + 9 < jpeg.length;) {
    if (jpeg[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = jpeg[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: jpeg.readUInt16BE(i + 7), height: jpeg.readUInt16BE(i + 5) };
    }
    i += 2 + jpeg.readUInt16BE(i + 2);
  }
  return null;
}

test("Conf · Theme art — an empty-MIME transparent picture keeps its alpha, and its sparseness is not a failure", async ({
  page,
}) => {
  // Two of Emma's S3 findings, in the one place that can prove either — a real decoder and a real
  // encoder:
  //  · **#3** the alpha decision must come from the BYTES. An Android content URI routinely hands over
  //    a `File` with an EMPTY MIME type, and deciding from that sent a transparent logo down the jpeg
  //    path, flattening it onto black permanently, in the stored file.
  //  · **#5** the export's own check must be about the CANVAS. This fixture is transparent at its
  //    centre and at all four corners — the five points the first readback sampled — with one small
  //    opaque block off to one side. It is a mask silhouette, a corner glyph, exactly the art the
  //    `brand` and `stack` roles exist for, and it was refused as "the cropped image came back empty".
  await bootConf(page);
  const { uploads } = await statefulMedia(page, { onDisk: [], files: [] });
  await page.goto("/");
  await page.getByRole("button", { name: "Open the characters gallery", exact: true }).click();
  const dialog = page.getByRole("dialog");

  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /Add an image/ }).click();
  await (
    await chooser
  ).setFiles({
    name: "logo.png",
    mimeType: "", // what the photo picker hands over, and what must decide nothing
    buffer: readFileSync(image("sparse-alpha-200x200.png")),
  });
  await page
    .getByRole("dialog", { name: "Frame the image" })
    .getByRole("button", { name: "Use as is", exact: true })
    .click();

  // It EXPORTED at all — #5.
  await expect.poll(() => uploads.length).toBe(1);
  // …as a WEBP, from the bytes' own format rather than from the absent MIME type — #3.
  expect(uploads[0].filename).toBe("logo.webp");
  const body = uploads[0].body;
  expect(body.subarray(0, 4).toString("latin1")).toBe("RIFF");
  expect(body.subarray(8, 12).toString("latin1")).toBe("WEBP");
  // …and the transparency survived. Asserted from the CONTAINER rather than by hunting for a byte
  // string: a WebP carries alpha either as a lossless `VP8L` bitstream, or as an extended `VP8X`
  // whose first flag byte sets the ALPHA bit (RFC 9649 §2.5.2). A bare `VP8 `, or a `VP8X` with that
  // bit clear, is the flattened picture this arm exists to catch.
  const container = body.subarray(12, 16).toString("latin1");
  const VP8X_ALPHA = 0x10;
  expect(container === "VP8L" || (container === "VP8X" && (body[20] & VP8X_ALPHA) !== 0)).toBe(
    true,
  );
});
