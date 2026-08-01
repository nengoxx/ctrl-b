/// <reference types="node" />
// ^ reads CSS from disk (fs/path/process); the tests tsconfig pins `types:["vitest"]`, so node's globals
//   are pulled in explicitly here (the themeContract.test.ts precedent).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// ── The D51 vapor-assimilation RATCHET (plan §3 V3 · R4/R8/R21) ────────────────────────────────────
//
// Three mechanical guards that make the assimilation ladder enforceable instead of honor-system. They
// are deliberately DUMB text checks: every failure mode here is a MISSING or EXTRA line, which reading
// the source proves, and the alternative (a browser cascade test) can't run in jsdom at all — jsdom
// replays neither @layer nor @scope nor the body-formula cascade. The real-browser half of V3 lives in
// `e2e/vapor-tokens.spec.ts` (the computed-style split-palette probe, all three accents).
//
//   1. THE BANNER SET — `themes/vapor/extras.css` is the deletion iceberg (~3000 ln of vapor-scoped
//      styling of SHARED components). Every `/* ── … ── */` banner is classified in
//      docs/VAPOR_BANNER_LEDGER.md; this list mirrors the file's actual banners so a deletion can never
//      land un-ledgered, and the frozen vapor-keeps subset can never be deleted by accident.
//   2. THE TOKEN-MAP PLACEMENT — the §14.4.1 formula-token trap, checked statically.
//   3. THE CONTRACT-NAME SPLIT — vapor.css/extras.css declare vapor-PRIVATE names only; every contract
//      name has exactly one home (themes/vapor/tokens.css). This is what closed the §13.2 collision.

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), "utf8");

const EXTRAS = "src/themes/vapor/extras.css";
const VAPOR = "src/themes/vapor/vapor.css";
const TOKENS = "src/themes/vapor/tokens.css";
const KIT_TOKENS = "src/theme-engine/kit/tokens.css";
const THEME_ENTRY = "src/theme/index.css";

/** The banner keys of a vapor stylesheet: the text of each `/* ── <key> ─… ` header line, cut at the
 *  next box-drawing run. Deliberately dumb — one regex, no CSS parse. (`—` U+2014 inside a key is a
 *  different character from the `─` U+2500 rule, so an em-dash in the prose never splits a key.) */
function bannersOf(css: string): string[] {
  const out: string[] = [];
  for (const line of css.split("\n")) {
    const m = /^\s*\/\*\s*─+\s*(.*)$/.exec(line);
    if (m) out.push(m[1].split(/─+/)[0].trim());
  }
  return out;
}

/** Innermost `selector { decls }` rules of a stylesheet (comments stripped first). tokens.css nests no
 *  rules inside a selector block, so `[^{}]+{[^{}]*}` lands exactly on them, skipping @layer/@scope. */
function innerRules(css: string): { selector: string; body: string }[] {
  const nc = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...nc.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().split("\n").pop()!.trim(),
    body: m[2],
  }));
}

/** The custom-property NAMES a stylesheet DECLARES (`--x:`); a `var(--x)` READ never has the colon. */
function declaredProps(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
}

// ── 1. The banner set ──────────────────────────────────────────────────────────────────────────────

// THE IMMUTABLE V3 BASELINE — the 41 banners extras.css carried when the ledger froze. **NEVER EDIT
// THIS LIST.** It is not a mirror of the file; it is the high-water mark the file may only shrink away
// from. The subset assertion below therefore rejects an ADDED banner *and* a RENAMED one (a rename is an
// add + a delete, and the new key isn't in the baseline) — which a hand-maintained mirror alone cannot
// do, since a deleter could just as easily "fix" the mirror by adding the new key. Ledger:
// docs/VAPOR_BANNER_LEDGER.md — bucket + dying-at slice for every row, plus the shared-ownership notes
// (a keyframe/selector several components share may not leave with the first of them).
const V3_BASELINE_BANNERS: string[] = [
  "Net-new v2 components (Phase 2): activity toasts + confirm dialog.",
  "F23 — Root error boundary fallback. The Slice-6 boundary inside <App> handles",
  "F14 — Hero now-dots are <button>s now (so keyboard tab reaches them).",
  "F25 — Global keyboard focus indicator (WCAG 2.4.7 Focus Visible).",
  "F15 / Appearance · Motion — user-controlled ambient-animation gate.",
  "Performance (lite) mode — Conf → Appearance → Blur (mirrored to body[data-perf], like data-motion).",
  "Firefox smoothness, full effects ON — containment/layer hints (NO visual change). The goal is to",
  'Phase 6b-1 — mic "unavailable" state. A recording attempt 502\'d (the STT primary + fallback',
  "Phase 6b-2 — TTS read-aloud. A per-bubble trigger (speaker in the assistant who-line) + a docked",
  "Phase 6c-2 — HTTPS access card (Tailscale Serve) in the Server conf group. The URL wraps; the",
  "D18 — inference fallbacks list editor (Conf → Inference). Collapsible rows reuse the vapor",
  "F16 — Live SSE connection badge in the appbar.",
  "Agent chat (Phase 4a). The .b.bot/.user/.sys bubbles are vapor.css (verbatim); these are the",
  "Command/action bubbles (Phase 4b). The `.b.cmd` shell (border, $-pre, .actions, .preamble)",
  "Plan panel (Phase 4d). The task_plan tool's live checklist — net-new (vapor has no plan markup),",
  "Markdown bot replies (Phase 4c). The bot bubble body is vapor.css (verbatim); these style the",
  "Reboot button (Phase: reboot action). Net-new device-row action: a restart sibling of the",
  "Interactive plan dots (plan-edit): in the pinned/live panel each step's tick is clickable to",
  "Device-row action area: when a host is ONLINE it shows two buttons (reboot + shutdown). They",
  "Conf section collapse (Phase 7c polish)",
  "Conf tab — settings forms (Phase 7a)",
  "Conf → Computers · services sub-editor (Phase 7b, net-new — no vapor markup)",
  "Conf → Integrations · MCP/OpenAPI server editor (Phase 7c-b, net-new)",
  "Conf → Computers · VPN-discovery results (D3 slice 3, net-new)",
  "Conf → Agent tools · per-tool description overrides (Phase 7d-a, net-new)",
  "Conf → Agents · definitions editor (Phase 7d-b, net-new)",
  "Conf → Skills · SKILL.md editor (Phase 7d-c, net-new)",
  "PromptModal · full-page prompt/markdown editor (Phase 7e-b, net-new)",
  "Memory panel (Phase 7e-d-3, net-new)",
  "Conf sizing refine (Phase 7e-b)",
  "Wide-control wrap (the kit.css :2203-2224 pattern, mirrored under vapor's scope)",
  "Session privilege chip (A1/D16)",
  "Question bubble (A2)",
  "Tools tab (Phase 8) — owner-directed font fix (2026-06-24).",
  "Tools tab · Section B — the agent-tool catalog (Phase 8b, D22, net-new)",
  "Approvals ('always allow') editor (Phase 8 / D44 W3)",
  "DeviceRow chevron toggle as a real <button> (D25, a11y)",
  "Add-row +/− glyph centering (override of vapor.css's text glyph)",
  "A11 / D48 — Providers registry + the shared provider→model picker",
  "A3 (14c) — Conf › Automations (list rows + the editor sheet)",
  "A3 (14d) — the created-automation card in the CHAT log (§D-5)",
];

// The ENUMERATED vapor-keeps list, FROZEN at V3 (D51 R21 — "decoration" as a re-made category judgement
// is the drift vector). These banners style the Root-pinned VaporFleet surface that stays bespoke-by-
// right (§1.1): the hero now-dots, the ambient-motion gate, the Fleet containment hints, and the device
// -row actions/chevron. They must SURVIVE every V4/V5 deletion; at V6 the extras.css residue must EQUAL
// this list. Amendable only by an explicit owner ruling recorded in the ledger + D51.
const VAPOR_KEEPS: string[] = [
  "F14 — Hero now-dots are <button>s now (so keyboard tab reaches them).",
  "F15 / Appearance · Motion — user-controlled ambient-animation gate.",
  "Firefox smoothness, full effects ON — containment/layer hints (NO visual change). The goal is to",
  "Reboot button (Phase: reboot action). Net-new device-row action: a restart sibling of the",
  "Device-row action area: when a host is ONLINE it shows two buttons (reboot + shutdown). They",
  "DeviceRow chevron toggle as a real <button> (D25, a11y)",
];

// The ratchet is TWO assertions over immutable constants — `V3_BASELINE_BANNERS ⊇ current ⊇ VAPOR_KEEPS`
// — so there is no editable mirror to "fix" a violation with. (The V3 build did carry a hand-maintained
// mirror list + a count constant; both are GONE as redundant: the subset half rejects additions/renames
// strictly harder than a mirror, and `current ⊆ a 41-element baseline` implies the count bound. The cost
// is that a DELETION needs no test edit — the ledger tick is enforced by review, not by the suite. That
// is the right trade: a ratchet that can be edited in the same commit as the violation isn't a ratchet.)
describe("D51 — the extras.css banner ratchet (shrink-only)", () => {
  const current = new Set(bannersOf(read(EXTRAS)));
  const baseline = new Set(V3_BASELINE_BANNERS);

  it("adds nothing: every banner in extras.css is in the frozen V3 baseline", () => {
    const strays = [...current].filter((b) => !baseline.has(b));
    expect(
      strays,
      `extras.css carries ${strays.length} banner(s) NOT in the frozen V3 baseline:\n` +
        strays.map((s) => `    · ${s}`).join("\n") +
        "\n  · ADDED a banner? New bespoke vapor styling of a shared component is precisely what D51 is\n" +
        "    deleting — port it onto the kit instead. If it is genuinely unavoidable, it needs an explicit\n" +
        "    ruling in D51 + a row in docs/VAPOR_BANNER_LEDGER.md before this baseline may be amended.\n" +
        "  · RENAMED/re-worded a banner's first line? Don't — the first line IS the ledger key. Restore\n" +
        "    the wording; the ledger, this baseline and the file must all read the same string.\n" +
        "  · DELETING is always allowed (that's the ladder): just tick the row in the ledger. NEVER edit\n" +
        "    V3_BASELINE_BANNERS to make this pass.",
    ).toEqual([]);
  });

  it("keeps every frozen vapor-keeps banner (the bespoke VaporFleet surface)", () => {
    const lost = VAPOR_KEEPS.filter((k) => !current.has(k));
    expect(
      lost,
      `a V4/V5 deletion took ${lost.length} vapor-keeps banner(s):\n` +
        lost.map((s) => `    · ${s}`).join("\n") +
        "\n  These style the Root-pinned VaporFleet surface D51 §1.1 rules bespoke-by-right. Restore them," +
        " or amend the frozen list with an explicit owner ruling (ledger §5 + D51).",
    ).toEqual([]);
  });

  it("the frozen lists are self-consistent (vapor-keeps ⊆ baseline)", () => {
    for (const keep of VAPOR_KEEPS) expect(V3_BASELINE_BANNERS).toContain(keep);
  });
});

// ── 2. The token-map placement (§14.4.1 formula-token trap) ────────────────────────────────────────

describe("D51 V3 — themes/vapor/tokens.css placement + wiring", () => {
  const tokens = read(TOKENS);

  it("declares every palette-derived alias on `body`, never on `:scope`", () => {
    // The set of names whose value can differ BELOW <html> — i.e. every input a `:scope` formula would
    // freeze. DERIVED from both sheets, never hand-listed, so a new per-palette token is covered free:
    //   · vapor.css's aqua palette block  → the raw tier (--magenta/--ink*/--bg-2/--danger-rgb/…)
    //   · every `body`-rooted rule in tokens.css → the semantic tier itself (--bg/--line*/--accent-fill
    //     from the per-accent blocks, plus --accent/--text/… from the base body rule). Without this half,
    //     a formula over a CONTRACT token (`--accent-ink: var(--bg)`, `--danger-soft: … var(--danger) …`)
    //     could be moved to :scope and freeze exactly the same way, unseen.
    const aqua = /\[data-accent="aqua"\]\s*\{([\s\S]*?)\n\s*\}/.exec(read(VAPOR));
    expect(aqua, 'vapor.css no longer has an [data-accent="aqua"] palette block').toBeTruthy();
    const overridden = declaredProps(aqua![1]);
    expect(overridden.size).toBeGreaterThan(10); // sanity: the regex really caught the block
    for (const { selector, body } of innerRules(tokens)) {
      if (selector.startsWith("body")) for (const n of declaredProps(body)) overridden.add(n);
    }

    for (const { selector, body } of innerRules(tokens)) {
      for (const [, name] of body.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
        if (!overridden.has(name)) continue;
        expect(
          selector.startsWith("body"),
          `tokens.css declares a formula over the palette-overridden ${name} on "${selector}". A var() ` +
            `formula is substituted on the DECLARING element: on :scope (= <html>) it would compute once ` +
            `from the BASE palette and only inherit, freezing every kit surface at vapor-pink under ` +
            `Aqua/Ember (§14.4.1). Move the declaration into a \`body\` rule.`,
        ).toBe(true);
      }
    }
  });

  it("is self-layered and imported WITHOUT an @import layer() wrapper", () => {
    expect(
      /@layer\s+theme\s*\{/.test(tokens),
      "themes/vapor/tokens.css must declare `@layer theme { … }` itself (the cosmos/frontier shape, and " +
        "what keeps the V6 lazy flip a no-op here)",
    ).toBe(true);
    const entry = read(THEME_ENTRY);
    expect(
      /@import\s+"\.\.\/themes\/vapor\/tokens\.css"\s*;/.test(entry),
      "theme/index.css must import vapor's tokens.css WITHOUT `layer(theme)`: the file already declares " +
        "that layer, and the wrapper would nest it as the SUB-layer `theme.theme`, which loses to " +
        "vapor.css's unlayered-within-`theme` rules.",
    ).toBe(true);
  });
});

// ── 3. The contract-name split (the §13.2 collision, closed at V3) ─────────────────────────────────

describe("D51 V3 — one home per contract token", () => {
  it("vapor.css + extras.css declare vapor-PRIVATE names only", () => {
    const contract = declaredProps(read(KIT_TOKENS)); // the contract IS what kit/tokens.css declares
    for (const file of [VAPOR, EXTRAS]) {
      for (const name of declaredProps(read(file))) {
        expect(
          contract.has(name),
          `${file} declares the CONTRACT token ${name}. Contract names live in themes/vapor/tokens.css ` +
            `(one name, one home — the §13.2 collision class D51 V3 closed); this sheet declares only ` +
            `vapor-private names. If the value is a different TYPE than the contract's (vapor's old ` +
            `--accent-glow was a drop-shadow() FILTER), rename it \`--vapor-*\` instead.`,
        ).toBe(false);
      }
    }
  });
});
