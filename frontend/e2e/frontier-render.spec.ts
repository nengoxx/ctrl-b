import { expect, test } from "./fixtures";

// FRONTIER BESPOKE-SURFACE lock (F5 Gate C — docs/FRONTIER_PLAN.md §9). kit-render.spec.ts's generic
// sweep proves every theme (frontier included) BOOTS + survives a tab sweep; this spec goes DEEPER on
// frontier's three bespoke surfaces (the badlands map + beacon→sheet flow · the host-detail sheet · the
// Agent rig-stack) and machine-enforces the Gate A a11y FIXES so they can't regress — A1 (the kit-wide
// keyboard focus ring) and A2 (the BottomSheet peek detent: below-fold inerting + the grip dragging-
// alternative). The a11y arm in a11y.spec.ts also scans frontier with axe; this is the behavioural half.
//
// Deliberately a SEPARATE file from kit-render.spec.ts: the firefox project is scoped to /kit-render/
// (playwright.config.ts) to keep Gecko runtime bounded to the light generic sweep — these deep pointer-
// capture + chat drives stay Chromium-only (mobile + desktop projects). Fennec proper is manual (Gate B).
//
// Boot = the same addInitScript localStorage seed the other e2e specs use. frontier's valid combo per
// CONTRAST_MATRIX is dark/coral (coral = its defaultAccent); its DEFAULT layout is 3-tab (utils hosted in
// Conf), so the on-bar sections are fleet/agent/conf.

test("frontier bespoke surfaces + Gate A locks — dark/coral", async ({ page, pageErrors }) => {
  await page.addInitScript(
    (ui) => {
      localStorage.setItem("ctrlb.ui", JSON.stringify(ui));
    },
    { theme: "frontier", mode: "dark", accent: "coral", tab: "fleet", v: 1 },
  );
  await page.goto("/");
  await page.waitForSelector(".kit-appbar"); // DefaultRoot booted (the kit-render LIVE signal)

  // ── Gate A1 lock: a keyboard-focused kit control paints the accent :focus-visible ring ──
  // The ring lives in kit.css `@layer base` (`.kit :focus-visible { outline: 2px solid var(--accent) }`).
  // `:focus-visible` fires ONLY on genuine keyboard nav (never a mouse click / programmatic .focus()), so
  // we drive real Tab presses and stop on the first ring-bearing control (form fields suppress the ring —
  // kit.css `outline: none` — so skip those; the accent-ring controls are the tab buttons/send/seg/etc.).
  let ring: { style: string; width: string; color: string } | null = null;
  for (let i = 0; i < 25 && !ring; i++) {
    await page.keyboard.press("Tab");
    ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !el.closest(".kit") || !el.matches(":focus-visible")) return null;
      const cs = getComputedStyle(el);
      if (cs.outlineStyle === "none") return null; // form field — its ring is suppressed; keep Tabbing
      return { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor };
    });
  }
  expect(
    ring,
    "a keyboard-focused kit control must paint a :focus-visible ring (A1)",
  ).not.toBeNull();
  expect(ring!.style).toBe("solid");
  expect(ring!.width).toBe("2px");
  expect(ring!.color).toMatch(/^rgb/); // the accent resolves to a concrete color, not `transparent`/invalid

  // ── Fleet: the badlands MAP renders with a beacon per host (mock fleet = 2 hosts: vault + corsair) ──
  await expect(page.locator(".frontier-map")).toBeVisible();
  const beacons = page.locator(".frontier-beacon");
  await expect(beacons).toHaveCount(2);

  // ── Beacon tap opens the host-detail SHEET (role=dialog on the shared BottomSheet, frontier-skinned) ──
  await beacons.first().click(); // vault (online) — the first placement
  const sheet = page.locator(".bs-sheet[role='dialog']");
  await expect(sheet).toBeVisible();
  await expect(page.locator(".frontier-hd")).toBeVisible();

  // ── K1 lock: while the sheet is open the Kit composer YIELDS (kit-default, promoted 2026-07-15 from the
  // frontier/cosmos copies — kit.css BottomSheet section, keyed on the host-stamped body[data-sheet=open]).
  // It uses `visibility:hidden` (NOT display:none — the layout box stays for fit/camera measures), so poll
  // the composer's computed `visibility` (the 0.2s fade), matching the translateY/inert polling idiom below.
  const composerVis = () =>
    page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".kit-composer");
      return el ? getComputedStyle(el).visibility : null;
    });
  await expect.poll(composerVis).toBe("hidden");

  // ── Gate A2 lock — the peek detent + the grip dragging-alternative ──
  // The grip is a labelled role="button" (SC 2.5.7); the below-fold region (the `[data-bs-peek]` marker's
  // following siblings — stats/actions/services) is `inert` at peek (SC 2.4.11) and released at full.
  const grip = page.locator(".bs-grip");
  await expect(grip).toHaveAttribute("role", "button");
  await expect(grip).toHaveAttribute("aria-label", /expand|collapse/i);

  // Read the below-fold siblings' `inert` flag (imperatively set on the DOM nodes by BottomSheet.applyInert)
  // and the sheet's inline translateY (peek pushes it down > 0; full sits at 0). Polled — the 420ms snap.
  const belowFoldInert = () =>
    page.evaluate(() => {
      const pe = document.querySelector<HTMLElement>(".frontier-hd [data-bs-peek]");
      if (!pe) return null;
      const flags: boolean[] = [];
      for (let s = pe.nextElementSibling; s; s = s.nextElementSibling)
        flags.push((s as HTMLElement).inert);
      return flags;
    });
  const sheetTy = () =>
    page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".bs-sheet");
      const m = /translateY\(([-\d.]+)px\)/.exec(el?.style.transform ?? "");
      return m ? parseFloat(m[1]) : NaN;
    });

  // There ARE below-fold siblings (the stats/actbar/svc-h/svcs), and at the PEEK detent they're all inert.
  expect((await belowFoldInert())?.length ?? 0).toBeGreaterThan(0);
  await expect.poll(async () => (await belowFoldInert())?.every(Boolean)).toBe(true);
  await expect.poll(sheetTy).toBeGreaterThan(0);

  // Tap the handle → cycles to FULL: below-fold reachable (inert cleared) + the sheet slides up to ty 0.
  await page.locator(".bs-handle").click();
  await expect.poll(async () => (await belowFoldInert())?.some(Boolean)).toBe(false);
  await expect.poll(sheetTy).toBe(0);

  // Tap again → back to PEEK: below-fold re-inerted + the sheet drops back down (ty > 0).
  await page.locator(".bs-handle").click();
  await expect.poll(async () => (await belowFoldInert())?.every(Boolean)).toBe(true);
  await expect.poll(sheetTy).toBeGreaterThan(0);

  // Escape closes the (non-modal) sheet — verifying the pre-existing Gate A2 escape-close path.
  await page.keyboard.press("Escape");
  await expect(page.locator(".bs-sheet")).toHaveCount(0); // unmounts after the exit slide
  // sheet gone → FrontierFleet clears body[data-sheet=open] → the composer is visible again (K1 round-trip).
  await expect.poll(composerVis).toBe("visible");

  // ── Agent: the bespoke rig-stack mounts; `data-thread` flips empty ⇄ active ──
  await page.locator("#tabbtn-agent").click();
  const agentTab = page.locator("#tab-agent");
  await expect(agentTab).toBeVisible();
  await expect(page.locator(".fr-rigstack")).toBeVisible();
  await expect(agentTab).toHaveAttribute("data-thread", "empty"); // no messages at boot → hero state
  await expect(page.getByText("Frontier Comms")).toBeVisible(); // the empty-state hero

  // Drive one real chat turn through the mocked /api: the composer's send appends an optimistic user +
  // empty-assistant bubble to the chat store IMMEDIATELY (store/chat.sendMessage), and the mocked
  // POST /api/agent/chat returns `{}` (a buffered turn) whose reload path keeps those bubbles (initChat's
  // "don't clobber an in-flight session" guard) — so `data-thread` flips to "active" and stays there.
  await page.locator("#cmd-input").fill("Which rigs are online?");
  await page.locator("#cmd-send").click();
  await expect(agentTab).toHaveAttribute("data-thread", "active");

  // Zero uncaught page errors across the whole drive (the kit-render invariant — a bespoke surface that
  // throws on boot/interaction surfaces here).
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});
