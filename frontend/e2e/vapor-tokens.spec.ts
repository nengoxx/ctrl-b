import { expect, seedUI, test, VAPOR_UI } from "./fixtures";

// The D51 V3 SPLIT-PALETTE guard — the real-browser half of the semantic-token slice.
//
// WHY A BROWSER SPEC: the failure it catches is a pure CASCADE fault. `themes/vapor/tokens.css` aliases
// vapor's private vocabulary (`--magenta`/`--ink*`/`--bg-2`/…) onto the Kit contract, but vapor declares
// those privates on `:scope` (= <html>) and OVERRIDES them per palette on <body>. A var() formula is
// substituted at computed-value time on the element that DECLARES it, so an alias written on `:scope`
// computes once from <html>'s BASE palette and only inherits — every Kit surface would stay vapor-pink
// under Aqua/Ember while vapor's own rules recolored (§14.4.1, the trap Codex flagged pre-build). jsdom
// replays neither @layer nor @scope nor that substitution, so vitest CANNOT see this; only a real engine
// can. (The static half — "no palette-derived alias sits on :scope" — is in
// tests/theme-engine/vaporAssimilation.test.ts and runs in the fast gate.)
//
// PROBE TECHNIQUE (contrast.spec.ts's, same reason): `getComputedStyle(el).getPropertyValue("--x")`
// returns the AUTHORED var chain, not a resolved value. Setting the token on the `background` SHORTHAND
// of a real element makes the engine resolve it — a flat token lands in backgroundColor, an <image>
// (vapor's gradient `--accent-fill`, the §14.15.1 ⑨ second channel) in backgroundImage with concrete
// rgb() stops. The probe is mounted INSIDE `#app-scroll`, i.e. where the kit chrome will live after the
// V4 DefaultRoot pivot — so it measures what a kit-facing element actually inherits, not a detached node.

interface Expected {
  accent: string; // the flat <color> channel
  fill: string[]; // both stops of the identity gradient (the <image> channel)
  bg: string;
  text: string;
  text3: string; // the Waveform's "idle" legend re-points at this (V3)
}

// Per-accent truth, read off vapor.css's palette blocks + themes/vapor/tokens.css. `--accent-fill`
// mirrors each accent's ThemeDef swatch (themes/vapor/index.tsx) 1:1 — if a swatch is retuned without
// its fill (or vice versa) this fails, which is the point.
const EXPECTED: Record<string, Expected> = {
  dark: {
    accent: "rgb(255, 82, 212)", // --magenta
    fill: ["rgb(255, 82, 212)", "rgb(165, 92, 255)"],
    bg: "rgb(10, 3, 22)",
    text: "rgb(255, 230, 247)", // --ink
    text3: "rgb(106, 74, 144)", // --ink-faint
  },
  aqua: {
    accent: "rgb(92, 230, 255)",
    fill: ["rgb(92, 230, 255)", "rgb(110, 123, 255)"],
    bg: "rgb(2, 16, 26)",
    text: "rgb(216, 246, 255)",
    text3: "rgb(58, 122, 146)",
  },
  ember: {
    accent: "rgb(255, 138, 61)",
    fill: ["rgb(255, 138, 61)", "rgb(255, 215, 92)"],
    bg: "rgb(17, 6, 3)",
    text: "rgb(255, 232, 200)",
    text3: "rgb(140, 90, 50)",
  },
};

/** Resolve tokens through a probe mounted in the live app subtree. */
async function probe(
  page: import("@playwright/test").Page,
  names: string[],
): Promise<Record<string, { bgColor: string; bgImage: string }>> {
  return page.evaluate((tokens) => {
    const host = document.getElementById("app-scroll") ?? document.body;
    const el = document.createElement("div");
    host.appendChild(el);
    const out: Record<string, { bgColor: string; bgImage: string }> = {};
    for (const n of tokens) {
      el.style.background = `var(${n})`;
      const cs = getComputedStyle(el);
      out[n] = { bgColor: cs.backgroundColor, bgImage: cs.backgroundImage };
      el.style.background = "";
    }
    el.remove();
    return out;
  }, names);
}

const TOKENS = ["--accent", "--accent-fill", "--bg", "--text", "--text-3"];

for (const [accent, want] of Object.entries(EXPECTED)) {
  test(`vapor tokens re-derive per accent — ${accent}`, async ({ page }) => {
    await seedUI(page, { ...VAPOR_UI, accent, tab: "fleet" });
    await page.goto("/");
    // vapor's tokens.css sets `color-scheme: dark` on <html> — the "the theme's tokens applied" signal
    // every theme spec uses. Then wait for the Root's scroller (a CONTENT node, never a paint attribute).
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
      .not.toBe("normal");
    await page.waitForSelector("#app-scroll");

    const got = await probe(page, TOKENS);
    expect(got["--accent"].bgColor, `${accent}: --accent`).toBe(want.accent);
    expect(got["--bg"].bgColor, `${accent}: --bg`).toBe(want.bg);
    expect(got["--text"].bgColor, `${accent}: --text`).toBe(want.text);
    expect(got["--text-3"].bgColor, `${accent}: --text-3`).toBe(want.text3);
    // --accent-fill is an <image>: assert both identity stops survive into the computed gradient.
    for (const stop of want.fill) {
      expect(
        got["--accent-fill"].bgImage,
        `${accent}: --accent-fill lost the stop ${stop} (got "${got["--accent-fill"].bgImage}"). If every ` +
          `accent reports the SAME stops, the alias froze on :scope — the §14.4.1 trap.`,
      ).toContain(stop);
    }
  });
}
