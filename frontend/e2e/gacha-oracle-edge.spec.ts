import type { Page } from "@playwright/test";
import {
  expect,
  routeAgentBackground,
  seedThread,
  seedUI,
  test,
  type AgentBackground,
} from "./fixtures";

// THE ORACLE'S BOTTOM EDGE at fractional device-pixel phases (session-51 polish #5 — the owner's prod report:
// "a lighter 1px line at the bottom of the operator art", measured on their screenshot as a last art row at
// luminance 40 against 29 above, brightest under the picture's light shapes). Pixels, not computed styles,
// because the defect only exists after rasterization: the face's bottom edge (299 CSS px — the block's 1px
// bottom border sits below it) lands mid device pixel at DPR 2.625 / 2.75 / 3.5, and the pixel-snapped
// `<img>` and the anti-aliased scrim `::after` rounded that partial row differently — the art painted it, the
// scrim only partly covered it (probe: 51 / 66 / 81 against 29 above). The fix overdraws BOTH layers by 1px
// into the block's clip; with the scrim alone overdrawn the row read DARKER instead (20 / 23 against 30), so
// the assertion is two-sided.
//
// A solid WHITE picture makes a mismatched row unmistakable: under the scrim's bottom stop (`#120e26f2`) white
// reads ≈ 30. The fractional phase comes from the DPR, not from `--kit-inset-top`: the bar-less pull cancels
// the scroller's inset padding exactly, so the block sits at y 0 whatever that token's value (probed at
// 34 → 34.9px — no change).
//
// CHROMIUM ONLY, deliberately (session-52 review round №1): this is a Chromium-rasterizer claim. Rendered old
// vs fixed in Gecko at the same densities, Firefox never showed the seam — it snaps the img, the scrim and the
// clip consistently — and at DPR 2.75 Gecko's `ceil(faceBottom × dpr) − 1` row is PAGE background (it snaps
// the clip to the nearest pixel, not outward), so a Gecko arm of this assertion would fail on a non-bug. Keep
// this spec off the `firefox` project's `testMatch`; Fennec is covered by the owner's phone eyeball. The
// MOBILE project only, too: `test.use` pins every device dimension, so the desktop run would be a duplicate.

/** A 4×4 opaque white PNG, bound on the resolved default — `object-fit: cover` makes it uniformly white. */
const WHITE: AgentBackground = {
  name: "white",
  file: "white.png",
  format: "png",
  sizeBytes: 70,
  width: 4,
  height: 4,
  contentType: "image/png",
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR42mP8//8/AwwwMSAB3BwAlm4DBSLxWcIAAAAASUVORK5CYII=",
};

/** Gacha, `agent_backdrop: operator`, bar-less (`minimal`) — the owner's prod posture — over an EMPTY
 *  thread, so the M7 ramp rests at p = 0: the phase where the seam shows (by p ≥ 0.05 the zoomed face
 *  overruns the clip and hides it even without the fix). */
async function boot(page: Page, sticky: boolean) {
  await seedUI(page, {
    theme: "gacha",
    mode: "dark",
    accent: "arcade",
    tab: "agent",
    agentBackdrop: "operator",
    appbarMode: "minimal",
    themeSettings: { gacha: { oracle: sticky } },
    v: 1,
  });
  await routeAgentBackground(page, WHITE);
  await seedThread(page, []);
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-oracle", sticky ? "fade" : "scroll");
  // Paint-ready: the claim is about the PICTURE's last row, so it must be there AND have decoded (`every`
  // over an empty list would pass vacuously).
  const arts = page.locator("#tab-agent img.gc-oracle-art");
  await expect(arts.first()).toBeAttached();
  await expect
    .poll(() =>
      arts.evaluateAll((els) =>
        (els as HTMLImageElement[]).every((i) => i.complete && i.naturalWidth > 0),
      ),
    )
    .toBe(true);
  // At rest: no ramp progress and no ghosting stamp, or the measurement would not be of the seam's phase.
  const block = page.locator("#tab-agent .gc-oracle");
  // (the driver writes a formatted number, e.g. "0.0000", or nothing before its first frame)
  const p = await block.evaluate((el) => getComputedStyle(el).getPropertyValue("--gc-oracle-p"));
  expect(Number(p.trim() || 0)).toBe(0);
  await expect(block).not.toHaveAttribute("data-gc-ghosting");
  // The comb (screen-blended, animated) and the name plate are not under test — hidden so each row's mean
  // is the art + scrim alone, and deterministic.
  await page.addStyleTag({
    content: ".gc-oracle-scan, .gc-oracle-name { visibility: hidden !important; }",
  });
}

/** Mean luminance of the DEVICE rows around the face's bottom edge (over the block's right half), plus the
 *  index of the face's last — possibly partial — device row within them. */
async function edgeRows(page: Page) {
  const geo = await page.evaluate(() => {
    const block = document.querySelector<HTMLElement>("#tab-agent .gc-oracle")!;
    const face = block.querySelector<HTMLElement>(".gc-oracle-face.sharp")!;
    const b = block.getBoundingClientRect();
    return { faceBottom: face.getBoundingClientRect().bottom, left: b.left, width: b.width };
  });
  const dpr = await page.evaluate(() => devicePixelRatio);
  const y0 = Math.floor(geo.faceBottom) - 4;
  const clip = { x: geo.left + geo.width / 2, y: y0, width: geo.width / 2 - 8, height: 8 };
  const png = await page.screenshot({ clip, scale: "device", animations: "disabled" });
  // Decoded in the page (canvas) rather than with a Node PNG dependency.
  const rows = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    return Array.from({ length: bmp.height }, (_, y) => {
      let s = 0;
      for (let x = 0; x < bmp.width; x++) {
        const i = (y * bmp.width + x) * 4;
        s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      }
      return s / bmp.width;
    });
  }, png.toString("base64"));
  const last = Math.ceil(geo.faceBottom * dpr) - 1 - Math.round(y0 * dpr);
  return { rows, last, dump: `rows ${rows.map(Math.round).join(",")}, last ${last}` };
}

/** The last row must match the scrimmed art above it, in BOTH directions: brighter is the owner's defect
 *  (raw art under a short scrim: +22…+52 before the fix), darker is its inverse (a scrim overhanging art that
 *  stops short: −7…−10 with only the scrim overdrawn). 4 is headroom for the gradient's own slope
 *  (≈ 0.3/row here) and rasterizer noise. */
function expectNoSeam({ rows, last, dump }: Awaited<ReturnType<typeof edgeRows>>) {
  expect(Math.abs(rows[last] - rows[last - 1]), dump).toBeLessThanOrEqual(4);
}

for (const dpr of [2, 2.625, 2.75, 3, 3.5]) {
  test.describe(`gacha oracle bottom edge @ DPR ${dpr}`, () => {
    test.use({
      viewport: { width: 400, height: 800 },
      deviceScaleFactor: dpr,
      isMobile: true,
      hasTouch: true,
    });

    test("fade (sticky ON) — the art's last device row matches the row above: no lighter or darker line", async ({
      page,
    }, info) => {
      test.skip(info.project.name !== "mobile", "device dims are pinned by test.use — one project");
      await boot(page, true);
      expectNoSeam(await edgeRows(page));
    });

    test("scroll (sticky OFF) — no seam either, and the designed hairline still paints below the art", async ({
      page,
    }, info) => {
      test.skip(info.project.name !== "mobile", "device dims are pinned by test.use — one project");
      await boot(page, false);
      await expect(page.locator("#tab-agent .gc-oracle")).toHaveCSS("border-bottom-width", "1px");
      const edge = await edgeRows(page);
      expectNoSeam(edge);
      // The first row wholly inside the 1px border (CSS 299 → 300) reads lighter than the page below it.
      const { rows, last, dump } = edge;
      expect(rows[last + 1], dump).toBeGreaterThan(rows[rows.length - 1] + 2);
    });
  });
}
