import { expect, test } from "./fixtures";
import { seedUI } from "./fixtures";

// THE AGENT BACKDROP in the REAL built app (D70 §8.3/§8.3a) — the half the unit suite structurally cannot
// reach. `tests/theme-engine/agentBackdrop.test.tsx` proves WHAT MOUNTS; everything asserted here needs a
// cascade to exist: the `@layer base` token declarations, the `:has(> .kit-backdrop-pin)` z-lift, `sticky`
// resolving against the real scroller, and the walk actually moving a computed opacity as the pane scrolls.
//
// Seeded the kit-render way — `ctrlb.ui` before any page script (the appearance mock is unseeded, so the
// reconcile HOLDS the seeded pick) — plus two routed fixtures: an agent that HAS a background, and the
// library row it binds. Registered after `mockApi`, so they win (last-registered wins in Playwright).

const BG = "/api/media/agents/files/backgrounds/hall.webp";

/** The `agents` media index with one usable background — the row the binding below names. */
const AGENT_MEDIA = {
  ns: "agents",
  collation: "library-v1",
  roles: {
    avatars: [],
    backgrounds: [
      {
        name: "hall",
        file: "hall.webp",
        url: BG,
        format: "webp",
        size_bytes: 90_000,
        revision: "1:90000",
        width: 1200,
        height: 1600,
        unusable: false,
        unusable_reason: null,
      },
    ],
  },
  slots: {},
};

/** The roster with that binding on the RESOLVED DEFAULT — the agent a bare boot runs as, so the backdrop
 *  paints with no session pin and no interaction at all. */
const AGENT_ROSTER = {
  agents: [],
  default: "default",
  summaries: {
    default: { title: "default", description: "", avatar: "", background: "hall.webp", voice: "" },
  },
};

type Mode = "operator" | "full" | "off";

async function boot(page: import("@playwright/test").Page, theme: string, mode: Mode) {
  await seedUI(page, {
    theme,
    mode: "dark",
    accent: theme === "gacha" ? "arcade" : "cyan",
    tab: "agent", // boot straight into the agent section — the backdrop's only home
    agentBackdrop: mode,
    v: 1,
  });
  await page.route("**/api/media/agents", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(AGENT_MEDIA),
    }),
  );
  await page.route("**/api/agents", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(AGENT_ROSTER),
    }),
  );
  // The picture itself never has to decode for any assertion here (geometry and stacking are the claims),
  // but a 404 would log noise and leave a broken-image box — serve a 1×1 so the layer paints something.
  await page.route(`**${BG}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/gif",
      body: Buffer.from("R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", "base64"),
    }),
  );
  await page.goto("/");
  await page.waitForSelector("#tab-agent.active");
}

test.describe("the kit themes take the shared layer", () => {
  test("operator — an in-flow strip at the token height, above the section head", async ({
    page,
  }) => {
    await boot(page, "minimal", "operator");
    const strip = page.locator("#tab-agent > .kit-backdrop-strip");
    await expect(strip).toHaveCount(1);
    await expect(page.locator(".kit-backdrop-pin")).toHaveCount(0);
    // The height is the TOKEN's, not a literal in the component — a theme retunes it in `@layer theme`.
    const box = await strip.boundingBox();
    expect(box!.height).toBeCloseTo(240, 1); // device-pixel-ratio rounding, not a tolerance on the token
    // Full-bleed: `.kit .tab` carries no padding, which is the property this presentation rides. Measured
    // against the SCROLLER's own content box rather than assumed (the S5 lesson: measure the real host).
    const pane = await page.locator("#app-scroll").boundingBox();
    const pane2 = pane!;
    expect(box!.x).toBeCloseTo(pane2.x, 1);
    expect(box!.width).toBeCloseTo(pane2.width, 1);
    // …and it really is the owner's file, framed by `object-fit: cover`.
    const img = strip.locator("img.kit-backdrop-art");
    expect(await img.getAttribute("src")).toContain(BG);
    await expect(img).toHaveCSS("object-fit", "cover");
    // It scrolls AWAY with the content — no sticky, which is the whole difference from `full`.
    await expect(strip).toHaveCSS("position", "relative");
  });

  test("full — a zero-height sticky pin, the transcript lifted above it, and the walk dimming on scroll", async ({
    page,
  }) => {
    await boot(page, "minimal", "full");
    const pin = page.locator("#tab-agent > .kit-backdrop-pin");
    await expect(pin).toHaveCount(1);
    await expect(page.locator(".kit-backdrop-strip")).toHaveCount(0);
    await expect(pin).toHaveCSS("position", "sticky");
    expect((await pin.boundingBox())!.height).toBeCloseTo(0, 1); // takes no flow space
    // THE Z-LIFT, the reason `full` is readable at all: the layer sits at z 0 and the tab's own in-flow
    // content is raised above it — gated on the pin EXISTING (`:has()`), so a tab with no backdrop keeps
    // exactly the stacking it had. Both children, because a positioned z-0 box paints over the TEXT of
    // non-positioned blocks, the section head included.
    await expect(page.locator("#tab-agent > .chat-log")).toHaveCSS("z-index", "1");
    await expect(page.locator("#tab-agent > .sec")).toHaveCSS("z-index", "1");
    await expect(page.locator(".kit-backdrop-full")).toHaveCSS("z-index", "auto");
    // THE OVERFLOW INVARIANT (gacha's own oracle carries the twin assertion, and for the same reason): an
    // absolutely-positioned descendant contributes to a scroll container's scrollable area, so a layer
    // sized past the pane would make an EMPTY agent tab scrollable — and then dim itself for no reason.
    // Sized to `--kit-pane-h` it adds EXACTLY nothing; measured against the real pane rather than reasoned
    // about (the first cut, sized to `--app-h`, added 104px here). POLLED because the tab's own 250ms
    // entrance keyframe translates it by 4px, which is real overflow while it lasts and none after.
    await expect
      .poll(
        async () =>
          await page.locator("#app-scroll").evaluate((el) => el.scrollHeight - el.clientHeight),
        { message: "the full-bleed layer made the pane scrollable" },
      )
      .toBeLessThanOrEqual(1);
    // The walk: opacity 1 at rest → strictly dimmer once the pane has scrolled past the ramp. Read as a
    // COMPUTED value, which is the only place the `calc()` over the driver's property actually resolves.
    const opacity = () =>
      page.locator(".kit-backdrop-full").evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(await opacity()).toBeCloseTo(1, 2);
    await page.locator("#app-scroll").evaluate((el) => {
      el.style.height = "300px"; // force a scrollable pane in an empty thread
      el.scrollTop = 400; // past the 240px ramp
      el.dispatchEvent(new Event("scroll"));
    });
    await expect
      .poll(async () => await opacity(), { message: "the walk never reached the floor" })
      .toBeLessThan(0.4);
  });

  test("off — no layer at all, with the picture bound and servable", async ({ page }) => {
    await boot(page, "minimal", "off");
    await expect(page.locator(".kit-backdrop-strip, .kit-backdrop-pin")).toHaveCount(0);
    // …and the tab keeps its pre-slice stacking: nothing to lift over.
    await expect(page.locator("#tab-agent > .chat-log")).toHaveCSS("z-index", "auto");
  });
});

test.describe("gacha integrates through its own body", () => {
  test("operator — the ORACLE paints the agent's picture; no kit layer is mounted", async ({
    page,
  }) => {
    await boot(page, "gacha", "operator");
    await expect(page.locator(".gc-oracle")).toHaveCount(1);
    await expect(page.locator(".kit-backdrop-strip, .kit-backdrop-pin")).toHaveCount(0);
    expect(
      await page.locator(".gc-oracle-face.sharp img.gc-oracle-art").getAttribute("src"),
    ).toContain(BG);
  });

  test("full — the oracle does not mount; the SHARED arrangement paints the same picture", async ({
    page,
  }) => {
    await boot(page, "gacha", "full");
    await expect(page.locator(".gc-oracle")).toHaveCount(0); // plate + scanline absent (owner-accepted)
    const pin = page.locator("#tab-agent > .kit-backdrop-pin");
    await expect(pin).toHaveCount(1);
    await expect(pin).toHaveCSS("position", "sticky");
    expect(await pin.locator("img.kit-backdrop-art").getAttribute("src")).toContain(BG);
  });

  test("off — the oracle KEEPS its plate and scanline, and paints no picture", async ({ page }) => {
    await boot(page, "gacha", "off");
    await expect(page.locator(".gc-oracle")).toHaveCount(1);
    await expect(page.locator(".gc-oracle-scan")).toHaveCount(1);
    await expect(page.locator(".gc-oracle-art")).toHaveCount(0);
    await expect(page.locator(".kit-backdrop-strip, .kit-backdrop-pin")).toHaveCount(0);
  });
});
