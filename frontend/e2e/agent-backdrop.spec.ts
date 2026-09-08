import { expect, test } from "./fixtures";
import { planThread, seedThread, seedUI } from "./fixtures";

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

async function boot(
  page: import("@playwright/test").Page,
  theme: string,
  mode: Mode,
  ui: Record<string, unknown> = {},
) {
  await seedUI(page, {
    theme,
    mode: "dark",
    accent: theme === "gacha" ? "arcade" : "cyan",
    tab: "agent", // boot straight into the agent section — the backdrop's only home
    agentBackdrop: mode,
    v: 1,
    ...ui,
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

  test("full — the art layer reaches the scroller's TRUE top with no bar in flow", async ({
    page,
  }) => {
    // The owner's S6 round: with a floating launcher and no app bar, the picture started a scroller-inset
    // below the pane's top and left a band of bare `--bg` above it. The pin's SEAT is deliberate and did
    // not move; the art layer is pulled up through it by `--kit-backdrop-lift` instead. Measured against
    // the real scroller in the real cascade, because that is the only place the token resolves — jsdom
    // builds no boxes and the unit suite structurally cannot see this.
    await boot(page, "minimal", "full", { appbarMode: "minimal" });
    // Both edges in ONE read, and POLLED for the same reason the overflow arm below is: the tab's 250ms
    // entrance keyframe translates it by 4px, so a one-shot measure catches the animation, not the layout
    // (measured: a 3.4px miss on the first frame). 34px + the safe area is what the inset declares in this
    // mode, and the claim is that NONE of it is left above the picture; ±1 is device-pixel rounding, not a
    // tolerance on the rule. The BOTTOM edge is the other half of "fills the pane": the height lost its two
    // subtractions exactly because the pull removed what they compensated.
    await expect
      .poll(
        async () =>
          await page.evaluate(() => {
            const art = document.querySelector(".kit-backdrop-full")!.getBoundingClientRect();
            const pane = document.getElementById("app-scroll")!.getBoundingClientRect();
            return Math.max(Math.abs(art.top - pane.top), Math.abs(art.bottom - pane.bottom));
          }),
        {
          message:
            "the art does not fill the pane edge to edge (a band of bare background is left)",
        },
      )
      .toBeLessThanOrEqual(1);
    // THE OVERFLOW INVARIANT, restated for the new geometry (the twin of the arm above): a taller layer
    // pulled above the content origin must still add NOTHING scrollable to an empty tab.
    await expect
      .poll(
        async () =>
          await page.locator("#app-scroll").evaluate((el) => el.scrollHeight - el.clientHeight),
        { message: "the pulled full-bleed layer made the pane scrollable" },
      )
      .toBeLessThanOrEqual(1);
  });

  test("full — the top seam scrim yields over the art, and only on the tab that has it", async ({
    page,
  }) => {
    // `.kit-main::before` seals the appbar seam with an OPAQUE `--bg` top stop — over full-bleed art that
    // is a 30px band of flat background across the picture, i.e. the very gap it exists to prevent. It is
    // nulled while a `full` pin is on the ACTIVE tab, and only then.
    const scrim = () =>
      page.locator(".kit-main").evaluate((el) => getComputedStyle(el, "::before").backgroundImage);
    // ONE boot, then the LIVE tab transition — not a second `boot()`. Two boots would register a second
    // `addInitScript` seeding `ctrlb.ui`, and the order those run in on the reload is not guaranteed: the
    // first boot's `tab: "agent"` can win, which is the silent-first-run-flake class this suite has been
    // burned by before. Switching tabs in the running app is also the better claim — the rule has to
    // follow `.tab.active` as it moves, not merely be right at two boots.
    // A VISIBLE bar, because that is the mode with both a scrim to lose and a nav bar to click.
    await boot(page, "minimal", "full", { appbarMode: "visible" });
    expect(await scrim()).toBe("none");
    // Section bodies are keep-mounted, so the pin's NODE stays while another tab shows — which is exactly
    // why the rule is scoped to `.tab.active`. On the Fleet the scrim must be back, doing its job.
    await page.locator("#tabbtn-fleet").click();
    await page.waitForSelector("#tab-fleet.active");
    await expect(page.locator("#tab-agent > .kit-backdrop-pin")).toHaveCount(1); // mounted, not active
    expect(await scrim()).toContain("gradient");
    // …and back: the scrim yields again when the agent tab returns, so this is a live rule and not a
    // one-way boot artefact.
    await page.locator("#tabbtn-agent").click();
    await page.waitForSelector("#tab-agent.active");
    expect(await scrim()).toBe("none");
  });

  test("operator — the seam scrim KEEPS its job over a strip that scrolls away", async ({
    page,
  }) => {
    // The deliberate half of the scoping: `operator` is in-flow art that leaves, and once it has left it is
    // CONTENT under the seam — exactly what the scrim is for. Only the pin yields.
    await boot(page, "minimal", "operator", { appbarMode: "minimal" });
    expect(
      await page
        .locator(".kit-main")
        .evaluate((el) => getComputedStyle(el, "::before").backgroundImage),
    ).toContain("gradient");
  });

  test("full — a PINNED PLAN above the pin never drags the transcript under the panel", async ({
    page,
  }) => {
    // The S6 review's second finding, and the coverage hole it walked through: the pin is ZERO-HEIGHT,
    // so the `--plan-head-h` pull that lets the art reach up under the panel advanced every FOLLOWING
    // sibling by the same amount — `.sec` and `.chat-log` started at the panel's own top, under it.
    // (gacha's oracle takes the identical pull and is fine: its pulled block is 300px tall, so its
    // siblings are pushed back by its own height. Nothing about that precedent transfers to a pin.)
    await seedThread(page, planThread([{ text: "wake pegasus", status: "active" }]));
    await boot(page, "minimal", "full", {
      themeSettings: { minimal: { planPlacement: "pinned" } },
    });
    const panel = page.locator("#tab-agent > .plan-pin-panel");
    await expect(panel).toBeVisible();
    await expect(page.locator("#tab-agent > .kit-backdrop-pin")).toHaveCount(1);
    // Read the LAYOUT positions (`offsetTop`), not the painted ones: a first-in-flow sticky panel is
    // shifted down to its own `top` at scroll-top, so its painted box is not the flow box the content
    // below has to clear. The panel IS that first flow child (the tab's own rule), so its flow box runs
    // from 0 to its height — and the pin between it and the transcript takes no flow space at all.
    const off = (sel: string) =>
      page.locator(sel).evaluate((el: HTMLElement) => ({
        top: el.offsetTop,
        height: el.offsetHeight,
      }));
    const panelH = (await off("#tab-agent > .plan-pin-panel")).height;
    expect((await off("#tab-agent > .kit-backdrop-pin")).height).toBe(0);
    for (const sel of ["#tab-agent > .sec", "#tab-agent > .chat-log"]) {
      const below = await off(sel);
      expect(below.top, `${sel} starts under the plan panel's flow box`).toBeGreaterThanOrEqual(
        panelH,
      );
    }
    // …and the pull it compensates is still doing its job: the art reaches UP under the panel rather
    // than starting below it (the whole reason the pin is moved at all).
    const art = (await page.locator(".kit-backdrop-full").boundingBox())!;
    const painted = (await panel.boundingBox())!;
    expect(art.y).toBeLessThanOrEqual(painted.y);
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
