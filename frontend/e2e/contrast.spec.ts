import { calcAPCA } from "apca-w3";
import { rgb, wcagContrast } from "culori";

import { CONTRAST_MATRIX } from "./contrast-matrix";
import { expect, test } from "./fixtures";

// The WCAG contrast GATE (§14.15.1 item 8 · §14.15.1-A ⑧ settled). This RIDES the existing e2e suite (the
// `--e2e` release gate), NOT a new Playwright project — a project would re-run the axe scans per theme×mode×
// accent (combinatorial). It boots the REAL built app per palette combo and measures COMPUTED colors, because
// jsdom/culori can't replay the @layer/@scope/body-formula cascade and a hand-kept palette table would be a
// second source of truth (both rejected in ⑧).
//
// THE PROBE-ELEMENT TECHNIQUE (the verified CSSOM gotcha): `getComputedStyle(el).getPropertyValue("--x")`
// returns the AUTHORED var chain (e.g. `oklch(var(--accent-l) …)`), not a concrete color. So instead we set a
// token onto a REAL property of a probe div (`probe.style.color = "var(--accent-ink)"`) and read
// `getComputedStyle(probe).color` — the engine resolves oklch()/color-mix()/relative-color to a concrete rgb
// string, which we parse with culori on the Node side.
//
// GATES (WCAG 2.1, FAIL the spec) + APCA (advisory, report-only, never gates — ⑧).

// ── The matrix — expanded from CONTRAST_MATRIX (the shared list the jsdom drift guard verifies against the
//    registry palettes; vapor is waived there, so it never appears). minimal → dark+light × 4 hues (8);
//    cosmos → dark × 4 accents (4). ──
interface Combo {
  theme: string;
  mode: string;
  accent: string;
}

const COMBOS: Combo[] = CONTRAST_MATRIX.flatMap((t) =>
  t.modes.flatMap((mode) => t.accents.map((accent) => ({ theme: t.theme, mode, accent }))),
);

// Token pairs to gate. `fg`/`bg` are semantic tokens; `min` is the WCAG 2.1 floor for that role (4.5:1 for
// body text / ink on fill; 3:1 for large/secondary/status affordances). All are resolved via the probe.
interface Pair {
  fg: string;
  bg: string;
  min: number;
}
const PAIRS: Pair[] = [
  { fg: "--accent-ink", bg: "--accent-fill", min: 4.5 }, // ink on the accent-filled controls (item ①)
  { fg: "--text", bg: "--surface", min: 4.5 }, // body text on cards
  { fg: "--text", bg: "--bg", min: 4.5 }, // body text on the page
  { fg: "--text-2", bg: "--surface", min: 3 }, // secondary text on cards
  { fg: "--ok", bg: "--surface", min: 3 }, // status affordances on cards
  { fg: "--warn", bg: "--surface", min: 3 },
  { fg: "--danger", bg: "--surface", min: 3 },
];

const PROBE_TOKENS = [...new Set(PAIRS.flatMap((p) => [p.fg, p.bg]))];

/** WCAG 2.1 contrast ratio (1–21) between two concrete color strings, via culori. */
function wcag(a: string, b: string): number {
  return wcagContrast(a, b);
}
/** Normalize any CSS color (incl. `oklch()`/`color-mix()`) to a plain sRGB `rgb(r,g,b)` string via culori —
 *  apca-w3's parser only understands sRGB forms, so oklch tokens would otherwise read Lc 0. */
function toSrgb(color: string): string {
  const c = rgb(color);
  if (!c) return color;
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${to(c.r)}, ${to(c.g)}, ${to(c.b)})`;
}
/** APCA Lc (advisory, report-only) — signed lightness contrast; we report its magnitude. */
function apcaLc(text: string, bg: string): number {
  return Math.abs(Number(calcAPCA(toSrgb(text), toSrgb(bg))));
}

for (const c of COMBOS) {
  test(`contrast — ${c.theme} ${c.mode}/${c.accent}`, async ({ page }) => {
    // Seed the persisted UI blob BEFORE any page script (the flows.spec addInitScript pattern). `v:1` stamps
    // the current persisted-schema version so the migration chain is skipped and mode/accent apply directly.
    await page.addInitScript(
      (ui) => {
        localStorage.setItem("ctrlb.ui", JSON.stringify(ui));
      },
      { theme: c.theme, mode: c.mode, accent: c.accent, tab: "fleet", v: 1 },
    );

    await page.goto("/");

    // Wait until the theme's SCOPED tokens.css (@layer theme :scope) has applied — it sets `color-scheme`
    // on <html>, flipping the computed value off the "normal" default — AND the Kit Root has mounted.
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
      .not.toBe("normal");
    await page.waitForSelector("#app-scroll");

    // Probe: resolve each token to a concrete color by reading it back off a real CSS property.
    const resolved = await page.evaluate((names) => {
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      const out: Record<string, string> = {};
      for (const n of names) {
        probe.style.color = `var(${n})`;
        out[n] = getComputedStyle(probe).color;
      }
      probe.remove();
      return out;
    }, PROBE_TOKENS);

    for (const p of PAIRS) {
      const fg = resolved[p.fg];
      const bg = resolved[p.bg];
      const ratio = wcag(fg, bg);
      const lc = apcaLc(fg, bg);
      // APCA is ADVISORY — attach to the report, never gate on it (⑧).
      test.info().annotations.push({
        type: "apca",
        description: `${c.theme} ${c.mode}/${c.accent}  ${p.fg}(${fg}) vs ${p.bg}(${bg}) → WCAG ${ratio.toFixed(2)}:1 · APCA Lc ${lc.toFixed(1)}`,
      });
      expect(
        ratio,
        `${c.theme} ${c.mode}/${c.accent}: ${p.fg} (${fg}) vs ${p.bg} (${bg}) — WCAG ${ratio.toFixed(2)}:1 < ${p.min}:1`,
      ).toBeGreaterThanOrEqual(p.min);
    }
  });
}
