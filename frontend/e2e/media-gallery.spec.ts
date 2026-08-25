import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./fixtures";

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
// and the fallback tier is exactly what proves a gesture did NOT sweep the bundled art into the deal.

/** The bundled cast the real registry ships for `gacha/characters`. */
const BUNDLED = ["pegasus", "atlas", "3", "4", "lyra"];

interface Entry {
  name?: string;
  bundled?: string;
  hidden?: boolean;
}

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

/** The PUT's answer, as the real endpoint gives it: the whole masked config back. It matters that the
 *  ECHO carries the media block — `useSaveSettings` adopts it as the settings cache, and the gallery's
 *  next write is a read-modify-write over exactly that. An echo that dropped it would let the next
 *  gesture rebuild the list from the index alone and silently lose every per-item field. */
const saveEcho = (files: Entry[]) => ({
  settings: {
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
  return { st, puts, deletes };
}

test("Conf · Theme art — the library round trip: activate · reorder · In use · delete", async ({
  page,
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
  await expect(card).toContainText("7 images");
  await expect(card).toContainText("dealt to machines in this order");
  await expect(card.locator("img")).toHaveCount(2);

  await card.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("status")).toContainText("7 images");

  // ② SET AS ACTIVE = move-to-front, and the write sweeps only the DISK rows (§2.3 ③).
  await dialog.getByRole("button", { name: "b.webp", exact: true }).click();
  await dialog.getByRole("button", { name: "Set as active", exact: true }).click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]).toEqual({
    media: {
      namespaces: {
        gacha: { roles: { characters: { files: [{ name: "b.webp" }, { name: "a.webp" }] } } },
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
        gacha: { roles: { characters: { files: [{ name: "a.webp" }, { name: "b.webp" }] } } },
      },
    },
  });

  // ④ the In-use switch writes `hidden`, and the entry leaves the deal while staying in the library.
  await dialog.getByRole("switch", { name: /In use — a.webp/ }).click();
  await expect.poll(() => puts.length).toBe(3);
  expect(st.files).toEqual([{ name: "a.webp", hidden: true }, { name: "b.webp" }]);
  await dialog.getByRole("button", { name: "‹ All images", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("7 images"); // still listed…
  await expectFocusTrapped(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card.locator("img")).toHaveCount(1); // …but only one is dealt

  // ⑤ DELETE — the bytes leave through D65's typed verb FIRST, then ONE config write.
  await card.click();
  await dialog.getByRole("button", { name: "b.webp", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).last().click();
  await expect.poll(() => deletes.length).toBe(1);
  expect(deletes[0]).toBe("/api/media/gacha/files/characters/b.webp");
  await expect.poll(() => puts.length).toBe(4);
  expect(st.files).toEqual([{ name: "a.webp", hidden: true }]);

  // ⑥ and with the owner's only usable file switched off, the BUNDLED tier is what the fleet deals —
  //    the fallback-tier semantics that make the whole model paint-parity-free.
  await expectFocusTrapped(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card).toContainText("dealt to machines");
  await expect(card.locator("img")).toHaveCount(4); // the collage of the bundled cast, capped at four
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

  // ② "Set as active" in the gallery moves the fleet with it — one resolver, two readers.
  await page.locator("#tabbtn-conf").click();
  await card.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "b.webp", exact: true }).click();
  await dialog.getByRole("button", { name: "Set as active", exact: true }).click();
  await expect.poll(() => st.files).toEqual([{ name: "b.webp" }, { name: "a.webp" }]);
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
