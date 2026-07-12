/// <reference types="node" />
// ^ this file reads tokens.css from disk (fs/path/process); the tests tsconfig pins `types:["vitest"]`, so
//   node's globals are pulled in explicitly here rather than widening the whole suite's ambient types.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { clampChroma, formatHex, inGamut, parse } from "culori";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CONTRAST_MATRIX } from "../../e2e/contrast-matrix";
import { setUI } from "../../src/store/ui";
import { LAYOUT_PRESETS, partitionSections, resolveLayout } from "../../src/theme-engine/layout";
import { registeredThemes } from "../../src/theme-engine/registry";
import { tabsFor } from "../../src/theme-engine/tabs";
import type { ThemeId } from "../../src/theme-engine/types";
import type { Host } from "../../src/types";

// The token-list group parses raw tokens.css DECLARATIONS, NOT computed styles (jsdom can't replay
// @layer/@scope/the body-formula cascade; the COMPUTED contrast lives in e2e/contrast.spec.ts, §14.15.1-A
// ⑧). Read the CSS from disk — Vite's `?raw` transform returns "" under vitest, so fs is the reliable read.
// Anchored at cwd (vitest runs from the `frontend/` package root), not import.meta.url (not a file:// URL here).
function readThemeTokens(theme: string): string {
  return readFileSync(resolve(process.cwd(), "src/themes", theme, "tokens.css"), "utf8");
}

// B2 `themeContract.test.ts` (§14.15.1 item 8) — the interface-conformance suite run against EVERY
// registered theme via `it.each(registeredThemes())`, so a new registry row is verified with zero new test
// code (§14.13.1: the auto-iterating guard). Four groups run in jsdom Vitest: token-list (semantic-contract
// coverage, §14.13.1 Δ3) · behavioral (loaders resolve; attr cleanup across a switch chain) · structural
// measurement hooks (#app-scroll / composer / .kit-appbar — the nodes App + CosmosFleet cross-query) · the
// Fleet a11y assertion (§14.14 invariant #5). The CONTRAST group is a Playwright spec, not here.
//
// vapor's exemptions are ONE declarative waiver constant (never scattered `if (id === "vapor")` skips); the
// list doubles as the §14.15.3 assimilation tracker — it SHRINKS as vapor graduates up the ladder.

// ── CONTRACT_WAIVERS — the single source of every theme-conditional skip in this suite (§14.15.1 item 8;
//    the §14.15.3 assimilation tracker). Each id maps to a §14.15.3 legacy hook vapor can't yet satisfy. ──
export type ContractWaiver =
  | "semantic-tokens" // §14.15.3 hook ②: non-contract token vocab (--magenta/--ink*) + CSS in theme/, not
  //   themes/vapor/tokens.css → the token-list group cannot measure it. Retires at ladder stage V3.
  | "keyframe-prefix" // §14.15.3 hook ③: unprefixed @keyframes — enforced by stylelint (item ⑨), TRACKED
  //   here (no assertion in this suite reads it). Retires at V1.
  | "accent-axis" // §14.15.3 hook ①: accent rides body[data-theme], not data-mode/data-accent — TRACKED
  //   here; the attr-cleanup chain below encodes vapor's frozen axis as its expected behavior. Retires at V2.
  | "kit-structure"; // §14.15.3 hook ④: parallel chrome (components/AppBar·Composer·TabBar vs the Kit's) →
//   no `.kit-appbar`/`.kit-composer`, and its bespoke hero/waveform canvases are e2e territory (flows.spec
//   boots vapor for real). So the render-based structural + Fleet-a11y group is waived. Retires at V4/V5.

export const CONTRACT_WAIVERS: Partial<Record<ThemeId, ContractWaiver[]>> = {
  vapor: ["semantic-tokens", "keyframe-prefix", "accent-axis", "kit-structure"],
};

function isWaived(id: ThemeId, w: ContractWaiver): boolean {
  return CONTRACT_WAIVERS[id]?.includes(w) ?? false;
}

// The semantic contract every non-waived Kit-consuming theme MUST declare (THEME_ENGINE §14.13 #1). These
// are the color/shape tokens the Kit reads; a theme that ships them fully reskins. NOT listed: `--accent-ink`
// (conditionally required — see the light-mode-MUST rule below), the base fallbacks the theme may inherit
// from kit/tokens.css, and the JS/layout runtime vars (--app-h/--appbar-h/--composer-h) that are never
// authored in a theme's tokens.css (§14.13.1 Δ3 — the three classes).
const CONTRACT_TOKENS = [
  "--bg",
  "--surface",
  "--surface-2",
  "--text",
  "--text-2",
  "--text-3",
  "--line",
  "--line-2",
  "--accent",
  "--accent-fill",
  "--accent-soft",
  "--accent-glow",
  "--ok",
  "--ok-soft",
  "--warn",
  "--warn-soft",
  "--danger",
  "--danger-soft",
  "--radius",
  "--radius-sm",
  "--density-pad",
] as const;

// Raw tokens.css per theme (waived themes need no entry — the token-list group skips them).
const TOKENS_RAW: Partial<Record<ThemeId, string>> = {
  minimal: readThemeTokens("minimal"),
  cosmos: readThemeTokens("cosmos"),
};

/** The set of custom-property NAMES a stylesheet DECLARES (`--x:` … — a `:` follows the name). A `var(--x)`
 *  READ has `--x` followed by a space/`)`, never `:`, so usages are excluded. */
function declaredCustomProps(css: string): Set<string> {
  const out = new Set<string>();
  const re = /(--[a-z0-9-]+)\s*:/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) out.add(m[1]);
  return out;
}

// A stub host so the Fleet renders at least one interactive planet/row (the §14.14 invariant #5 assertion:
// "render each theme's Fleet with a stub host → expect a focusable element with an accessible name").
const STUB_HOST: Host = {
  id: "vault",
  name: "vault",
  ip: "10.0.0.1",
  mac: "aa:bb:cc:dd:ee:ff",
  ssh_username: null,
  ssh_port: 22,
  os_type: "linux",
  role: "server",
  tags: [],
  status: {
    host_id: "vault",
    online: true,
    ping_ms: 3,
    last_seen: null,
    checked_at: "2026-01-01T00:00:00Z",
    error: null,
  },
};

/** A QueryClient pre-seeded with the fleet data the always-mounted Kit subtree reads on first render, so a
 *  structural render is deterministic + offline (no fetch). staleTime:Infinity + refetchOnMount:false keep
 *  the seeded values authoritative; the other tabs' unseeded queries sit in their loading state (rendered
 *  hidden, `active={false}`) — never asserted. */
function makeSeededClient(): QueryClient {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  qc.setQueryData(["hosts"], [STUB_HOST]);
  qc.setQueryData(["services"], []);
  qc.setQueryData(["health"], {
    status: "ok",
    version: "test",
    schema_version: 1,
    server: { host: "", port: 5433, poll_seconds: 5, feature_cycle_seconds: 8, debug: false },
  });
  return qc;
}

// Inert stubs for the browser APIs the Kit Root's mount effects touch but jsdom lacks. A bare Root has no
// ErrorBoundary above it here, so an effect that threw (e.g. `new ResizeObserver`) would fail the render.
// NOTE: cosmos needs NO canvas 2d-context stub — CosmosStarfield guards `if (!ctx) return` and CosmosFleet
// is DOM-planet based; getContext→null (below) just keeps the starfield inert and silences jsdom's
// "Not implemented: getContext" noise. File-scoped (Vitest isolates each test file) → no leak to other files.
beforeAll(() => {
  class ResizeObserverStub {
    constructor(_cb: ResizeObserverCallback) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;

  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener(): void {},
    removeEventListener(): void {},
    addListener(): void {},
    removeListener(): void {},
    dispatchEvent(): boolean {
      return false;
    },
  });

  HTMLCanvasElement.prototype.getContext = () => null;
  Element.prototype.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup); // globals:false → RTL cleanup is explicit

describe.each(registeredThemes().map((d) => [d.id, d] as const))(
  "theme contract — %s",
  (id, def) => {
    // ── Token-list group (§14.13.1 Δ3) ──
    const tokenIt = isWaived(id, "semantic-tokens") ? it.skip : it;
    tokenIt(
      "tokens.css declares the full semantic contract (+ light-mode --accent-ink rule)",
      () => {
        const raw = TOKENS_RAW[id];
        expect(raw, `no raw tokens.css mapped for "${id}"`).toBeTruthy();
        const declared = declaredCustomProps(raw!);
        for (const token of CONTRACT_TOKENS) {
          expect(
            declared.has(token),
            `${id}/tokens.css is missing the contract token ${token}`,
          ).toBe(true);
        }
        // `--accent-ink` MUST be set explicitly IFF the theme declares a light mode (a light --bg is
        // near-white → the base var(--bg) fallback fails WCAG on the accent); dark-only themes inherit it.
        const hasLightMode = def.palettes.modes?.includes("light") ?? false;
        if (hasLightMode) {
          expect(
            declared.has("--accent-ink"),
            `${id} declares a light mode → tokens.css MUST set --accent-ink explicitly (§14.15.1 ①)`,
          ).toBe(true);
        }
      },
    );

    // ── Behavioral group (a): the loaders resolve in vitest (CSS imports transform to stubs; font
    //    document.fonts calls are try/catch'd; loadRoot resolves the Root module). ──
    it("loaders resolve (loadStyles / loadFonts? / loadRoot?)", async () => {
      await def.loadStyles();
      await def.loadFonts?.();
      await def.loadRoot?.();
    });

    // ── Structural measurement hooks + Fleet a11y (render the real Root) ──
    const renderDescribe = isWaived(id, "kit-structure") ? describe.skip : describe;
    renderDescribe("structural hooks + Fleet a11y (mounted Root)", () => {
      it("exposes #app-scroll, a composer node, .kit-appbar, and a focusable named Fleet host", async () => {
        // Preload the Root chunk so `preloadableRoot`'s Root renders synchronously (no Suspense flash),
        // and warm the lazy styles for parity with the switchTheme path.
        await def.loadRoot?.();
        await def.loadStyles();
        setUI({
          theme: id,
          mode: def.palettes.defaultMode ?? "dark",
          accent: def.palettes.defaultAccent ?? "",
          tab: "fleet", // a composer-bearing section (STANDARD_TABS) so the composer mounts
          appbarMode: "visible", // → KitAppBar renders `.kit-appbar`
        });

        const { container, unmount } = render(
          createElement(
            QueryClientProvider,
            { client: makeSeededClient() },
            createElement(def.Root),
          ),
        );
        try {
          // #app-scroll — the scroller DefaultRoot + AgentTab query by id.
          expect(document.getElementById("app-scroll"), `${id}: no #app-scroll`).not.toBeNull();
          // composer — `.kit-composer` (Kit) OR `#composer` (id), the fleet section has one.
          expect(
            container.querySelector(".kit-composer, #composer"),
            `${id}: no composer node on a composer-bearing section`,
          ).not.toBeNull();
          // .kit-appbar — the class CosmosFleet cross-queries for its stage sizing.
          expect(container.querySelector(".kit-appbar"), `${id}: no .kit-appbar`).not.toBeNull();
          // Fleet a11y (§14.14 invariant #5): the Fleet panel exposes ≥1 focusable, accessibly-named host.
          const fleet = container.querySelector('[aria-labelledby="tabbtn-fleet"]');
          expect(fleet, `${id}: no Fleet tabpanel`).not.toBeNull();
          const named = fleet!.querySelector("button[aria-label]");
          expect(named, `${id}: Fleet exposes no focusable, accessibly-named host`).not.toBeNull();
          expect((named!.getAttribute("aria-label") ?? "").length).toBeGreaterThan(0);
        } finally {
          unmount();
        }
      });
    });
  },
);

// ── Behavioral group (b): attr cleanup across a real vapor↔minimal↔cosmos switch chain (§14.15.1 item 8).
//    Drives applyBodyAttrs through real `setUI` and asserts NO stale data-theme/data-mode/data-accent leaks
//    in either direction. This encodes vapor's frozen `accent-axis` (body[data-theme]) as expected behavior
//    — a single explicit sequence, not a per-theme skip, so no waiver branch is needed. ──
describe("applyBodyAttrs cleanup across a vapor↔minimal↔cosmos switch chain", () => {
  it("never leaks a stale accent/mode/accent-hue attr between skins", () => {
    const html = document.documentElement;
    const body = document.body;

    setUI({ theme: "vapor", mode: "dark", accent: "aqua" });
    expect(html.dataset.skin).toBe("vapor");
    expect(body.dataset.theme).toBe("aqua"); // vapor's frozen accent axis
    expect(body.dataset.mode).toBeUndefined();
    expect(body.dataset.accent).toBeUndefined();

    setUI({ theme: "minimal", mode: "light", accent: "iris" });
    expect(html.dataset.skin).toBe("minimal");
    expect(body.dataset.theme).toBeUndefined(); // vapor's accent must be cleared
    expect(body.dataset.mode).toBe("light");
    expect(body.dataset.accent).toBe("iris");

    setUI({ theme: "cosmos", mode: "dark", accent: "violet" });
    expect(html.dataset.skin).toBe("cosmos");
    expect(body.dataset.theme).toBeUndefined();
    expect(body.dataset.mode).toBe("dark");
    expect(body.dataset.accent).toBe("violet");

    setUI({ theme: "vapor", mode: "dark", accent: "ember" });
    expect(html.dataset.skin).toBe("vapor");
    expect(body.dataset.theme).toBe("ember");
    expect(body.dataset.mode).toBeUndefined(); // minimal/cosmos axes must be cleared
    expect(body.dataset.accent).toBeUndefined();
  });
});

// ── Drift guard for the Playwright contrast matrix (§14.15.1 item 8: "a hand-duplicated palette table needs
//    a drift meta-test"). The contrast gate (e2e/contrast.spec.ts) can't import the registry (it would drag
//    the app graph into Playwright), so its theme×mode×accent list lives in the plain `e2e/contrast-matrix.ts`.
//    This test — which CAN import the registry — asserts that list equals the live palettes for every
//    non-waived theme, so adding/removing a mode or accent fails here until the matrix is updated. ──
describe("e2e contrast matrix ↔ registry palettes (drift guard)", () => {
  const measurable = registeredThemes().filter((d) => !isWaived(d.id, "semantic-tokens"));

  it("covers exactly the non-waived registered themes", () => {
    expect(CONTRAST_MATRIX.map((t) => t.theme).sort()).toEqual(measurable.map((d) => d.id).sort());
  });

  it.each(measurable.map((d) => [d.id, d] as const))("matches %s's modes + accents", (id, def) => {
    const row = CONTRAST_MATRIX.find((t) => t.theme === id);
    expect(row, `${id} missing from CONTRAST_MATRIX`).toBeTruthy();
    // A single-mode theme (no `modes` axis) is covered under its one implicit mode ("dark").
    expect(row!.modes).toEqual(def.palettes.modes ?? ["dark"]);
    expect(row!.accents).toEqual((def.palettes.accents ?? []).map((a) => a.id));
  });

  // The kit-render sweep (e2e/kit-render.spec.ts) is now LAYOUT-AWARE: it drives the theme's DEFAULT-layout
  // bar, sourced from `CONTRAST_MATRIX.bar`. Guard that hand-maintained list against the registry-resolved
  // bar so a theme changing its `defaultLayout` (frontier's future 3-tab) breaks HERE — not the sweep, which
  // would otherwise silently keep clicking a stale tab set (D35 §F0 punch-list).
  it.each(measurable.map((d) => [d.id] as const))(
    "%s's matrix `bar` = the registry-resolved default-layout bar",
    (id) => {
      const row = CONTRAST_MATRIX.find((t) => t.theme === id);
      const layout = resolveLayout(id, "auto"); // the theme's declared default preset
      const { bar } = partitionSections(tabsFor(id), LAYOUT_PRESETS[layout], false);
      expect(
        row!.bar,
        `${id}: CONTRAST_MATRIX.bar drifted from the ${layout} on-bar sections — update the matrix`,
      ).toEqual(bar.map((d) => d.id));
    },
  );
});

// ── OKLCH sRGB-gamut ADVISORY (§14.15.4 backlog → built 2026-07-12 at the frontier F1 pre-flight). A
//    too-vivid oklch() accent authored beyond the sRGB gamut gets gamut-mapped by the browser on sRGB
//    displays (the owner's Android) — it renders flatter/hue-shifted than authored, and the e2e contrast
//    gate then measures the CLIPPED color, not the intent. This scan warns at author time instead.
//    WARN-ONLY, never gates (the stylelint warn-first tradition: the inventory is a burn-down list) — the
//    binding floor stays the e2e WCAG gate on computed colors. Scope: oklch() LITERALS in tokens.css only.
//    Formula tokens (`oklch(var(--l) …)`) contain nested parens so the regex skips them, and `color-mix()`
//    results are runtime-dependent — both are exactly what the browser-side e2e probe already measures. ──
describe("OKLCH sRGB-gamut advisory (tokens.css oklch() literals — warn-only)", () => {
  const inSrgb = inGamut("rgb");

  it.each(Object.entries(TOKENS_RAW).map(([id, raw]) => [id, raw] as const))(
    "%s's oklch() literals resolve inside sRGB",
    (id, raw) => {
      const offenders: string[] = [];
      for (const [lit] of raw.matchAll(/oklch\([^()]*\)/gi)) {
        // Unparseable → malformed CSS, a different problem (stylelint/browser territory), not gamut.
        if (!parse(lit)) continue;
        if (!inSrgb(lit)) {
          offenders.push(`${lit} → nearest in-gamut ≈ ${formatHex(clampChroma(lit, "oklch"))}`);
        }
      }
      if (offenders.length > 0) {
        // Direct stderr, NOT console.warn — vitest's default reporter intercepts + hides console
        // output from passing tests, which would make this advisory invisible in the gate run.
        process.stderr.write(
          `[oklch-gamut advisory] ${id}/tokens.css authors ${offenders.length} oklch() literal(s) ` +
            `outside sRGB — they gamut-clip flat/hue-shifted on sRGB displays (lower the chroma or ` +
            `use the suggested clamp):\n  ${offenders.join("\n  ")}\n`,
        );
      }
    },
  );
});

// ── P2 meta-guard (§14.13.1 — "the guard that guards the guards"; built 2026-07-10 after the frontier
//    pre-flight authoring audit found §14.13 #4 was HONOR-SYSTEM for new themes). stylelint's per-theme-dir
//    keyframe-prefix overrides are HAND-LISTED (stylelint has no <dir>-derived pattern), so a new
//    `src/themes/<id>/` silently fell through to the generic kebab-case rule — and an unprefixed keyframe
//    collides document-wide with vapor's (§14.13 #4, the flagship-breaking case). These tests make every
//    hand-maintained authoring table fail LOUDLY, with instructions, the moment a registry row lacks its
//    entry. Exemptions route through CONTRACT_WAIVERS — the same single tracker, never a scattered skip. ──
describe("authoring guards ↔ registry (P2 meta-guard)", () => {
  const stylelintConfig = readFileSync(resolve(process.cwd(), "stylelint.config.mjs"), "utf8");

  it.each(
    registeredThemes()
      .filter((d) => !isWaived(d.id, "keyframe-prefix"))
      .map((d) => [d.id] as const),
  )("stylelint.config.mjs has the ^%s- keyframe override for src/themes/%s/", (id) => {
    // Text-level check on purpose: importing the untyped .mjs into the typed suite buys no robustness
    // over asserting both halves of the override are present, and the failure message is the fix.
    expect(
      stylelintConfig.includes(`src/themes/${id}/`),
      `stylelint.config.mjs needs an overrides entry for "src/themes/${id}/**/*.css" — copy the minimal/cosmos block`,
    ).toBe(true);
    expect(
      stylelintConfig.includes(`"^${id}-"`),
      `the src/themes/${id}/ override must enforce keyframes-name-pattern "^${id}-" (§14.13 #4 — unprefixed keyframes collide with vapor's document-wide)`,
    ).toBe(true);
  });

  it("TOKENS_RAW maps every non-waived registered theme (the token-list group's input)", () => {
    const need = registeredThemes()
      .filter((d) => !isWaived(d.id, "semantic-tokens"))
      .map((d) => d.id)
      .sort();
    expect(
      Object.keys(TOKENS_RAW).sort(),
      'add `<id>: readThemeTokens("<id>")` to TOKENS_RAW for the new theme',
    ).toEqual(need);
  });
});

// ── A1 DELTA (COMPOSER_SURFACE_PLAN §7 — "adds what ⑧ did not cover"). Per-theme descriptor invariants the
//    Surface resolver depends on: a declared default must name a real palette option (so the picker + the
//    contrast matrix can't drift), every setting's default must be self-consistent with its own spec (so
//    `resolveThemeSetting` never coerces a theme's OWN default away), and the tab set the composer-visibility
//    reads must be usable. Auto-iterates the registry (§14.13.1) → a new theme is verified with no new code. ──
describe.each(registeredThemes().map((d) => [d.id, d] as const))(
  "theme contract — A1 delta (palettes · settings defaults · tabs) — %s",
  (id, def) => {
    it("defaultAccent ∈ palettes.accents ids · defaultMode ∈ palettes.modes (when declared)", () => {
      const { defaultAccent, defaultMode, accents, modes } = def.palettes;
      if (defaultAccent !== undefined) {
        expect(
          (accents ?? []).map((a) => a.id),
          `${id}: defaultAccent "${defaultAccent}" is not a declared accent`,
        ).toContain(defaultAccent);
      }
      if (defaultMode !== undefined) {
        expect(modes ?? [], `${id}: defaultMode "${defaultMode}" is not a declared mode`).toContain(
          defaultMode,
        );
      }
    });

    it("every settings entry's default is valid (switch→boolean · seg→∈options)", () => {
      for (const [key, field] of Object.entries(def.settings ?? {})) {
        if (field.type === "switch") {
          expect(typeof field.default, `${id}.${key}: switch default must be boolean`).toBe(
            "boolean",
          );
        } else {
          expect(
            field.options.map((o) => o.val),
            `${id}.${key}: seg default "${field.default}" must be a declared option`,
          ).toContain(field.default);
        }
      }
    });

    it("tabsFor returns a non-empty set with unique ids", () => {
      const tabs = tabsFor(id);
      expect(tabs.length, `${id}: empty tab set`).toBeGreaterThan(0);
      const ids = tabs.map((t) => t.id);
      expect(new Set(ids).size, `${id}: duplicate tab ids`).toBe(ids.length);
    });
  },
);

// ── A1 DELTA — root-owned attr lifecycle (§7: "extend the switch-chain test to the root-owned attrs"). The
//    file's `applyBodyAttrs` switch-chain test above covers the GLOBAL attrs (data-skin/theme/mode/accent).
//    The ROOT-owned attrs are written by a Root's own mount effect, not by applyBodyAttrs, so they can only
//    be asserted with a mounted Root. Cleanly testable here: MinimalRoot writes body[data-density] on mount
//    and clears it on unmount (useLayoutEffect) — the "a Root owns + cleans up its own attr, no leak to the
//    next skin" contract. (VaporRoot's data-skyline/data-loz/.no-composer are behind the `kit-structure`
//    render waiver; CosmosFleet's data-sheet is written only on a host-sheet OPEN interaction — both out of
//    A1's cleanly-testable scope; see the report.) ──
describe("root-owned attr lifecycle (mounted Root) — MinimalRoot data-density", () => {
  it("sets body[data-density] while mounted, clears it on unmount (no leak)", async () => {
    const minimal = registeredThemes().find((d) => d.id === "minimal");
    expect(minimal, "minimal not registered").toBeTruthy();
    await minimal!.loadRoot?.();
    await minimal!.loadStyles();
    setUI({
      theme: "minimal",
      mode: "dark",
      accent: "cyan",
      tab: "fleet",
      appbarMode: "visible",
      themeSettings: {},
    });

    const { unmount } = render(
      createElement(
        QueryClientProvider,
        { client: makeSeededClient() },
        createElement(minimal!.Root),
      ),
    );
    try {
      expect(document.body.dataset.density).toBe("comfortable"); // minimal's declared default
    } finally {
      unmount();
    }
    expect(document.body.dataset.density).toBeUndefined(); // cleared → no stale attr on the next skin
  });
});
