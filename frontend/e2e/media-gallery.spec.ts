import { expect, test } from "./fixtures";

// The owner-media gallery ROUND TRIP, driven in the real built app (D53 M1a's gate; the group id became
// per-NAMESPACE at M1b, when the Conf tab started rendering one gallery per applicable namespace). The vitest suite
// (tests/components/mediaGallery.test.tsx) already pins the patch SHAPE against a mocked api client; what
// only a browser run can prove is the whole chain: the Conf group renders under a media-bearing theme, a
// reorder leaves through `PUT /api/settings` as a `media.<ns>` patch — the D53 §4 re-home, never the old
// `themes.<ns>` — and the server's answer is what the gallery shows afterwards, including after a reload.
//
// The mock is STATEFUL here (the appearance-write precedent in fixtures.ts): the captured order is applied
// to the index this handler serves, because the gallery's next write is computed from the listing, so a
// static index would make the reload assertion vacuous.

const file = (name: string) => ({
  name: name.replace(/\.webp$/, ""),
  file: name,
  url: `/api/media/gacha/files/characters/${name}`,
  format: "webp",
  size_bytes: 88_000,
  revision: `1:88000:${name}`,
  width: 640,
  height: 854,
  unusable: false,
  unusable_reason: null as string | null,
});

const SAVE_ECHO = {
  settings: { notifications: {} },
  restart_required: [] as string[],
  warnings: [] as string[],
  providers_rev: "r1",
};

test("Conf · Theme art — a reorder writes `media.<ns>` and survives a reload", async ({ page }) => {
  let order = ["a.webp", "b.webp"];
  const puts: Record<string, unknown>[] = [];

  await page.addInitScript(() => {
    localStorage.setItem(
      "ctrlb.ui",
      JSON.stringify({ theme: "gacha", mode: "dark", accent: "arcade", tab: "conf", v: 1 }),
    );
    // The gallery's Conf group ships collapsed; the persisted collapse blob opens it before first paint.
    localStorage.setItem("ctrlb.collapsed", JSON.stringify({ "media-gacha": false }));
  });

  // Registered AFTER the baseline mock, so it wins — and everything it does not own is handed back with
  // `route.fallback()` rather than re-mocked here.
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === "GET" && path.endsWith("/api/media/gacha")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ns: "gacha",
          collation: "casefold-natural",
          roles: { characters: order.map(file), banner: [], wallpaper: [], reel: [], oracle: [] },
          slots: {},
        }),
      });
    }
    if (req.method() === "PUT" && path.endsWith("/api/settings")) {
      const body = req.postDataJSON() as {
        media?: { gacha?: { roles?: { characters?: { order?: string[] } } } };
      };
      puts.push(body);
      const next = body.media?.gacha?.roles?.characters?.order;
      if (next) order = next;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SAVE_ECHO),
      });
    }
    return route.fallback();
  });

  await page.goto("/");
  const art = page.locator("#media-gacha");
  await expect(art.locator(".mgal-item .name").first()).toHaveText("a.webp");

  await art.getByRole("button", { name: "Move b.webp up" }).click();

  // ① the wire: the ordinary settings PUT, carrying the WHOLE role order under `media.gacha`
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]).toEqual({
    media: { gacha: { roles: { characters: { order: ["b.webp", "a.webp"] } } } },
  });
  expect(puts[0]).not.toHaveProperty("themes");

  // ② the round trip: the gallery repaints from the SERVER's listing, not from a local optimistic order
  await expect(art.locator(".mgal-item .name")).toHaveText(["b.webp", "a.webp"]);

  // ③ …and the persisted state is what a fresh boot reads back
  await page.reload();
  await expect(page.locator("#media-gacha .mgal-item .name")).toHaveText(["b.webp", "a.webp"]);
  expect(puts).toHaveLength(1); // a reload is not a write
});
