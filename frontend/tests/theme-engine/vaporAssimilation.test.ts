/// <reference types="node" />
// ^ reads CSS from disk (fs/path/process); the tests tsconfig pins `types:["vitest"]`, so node's globals
//   are pulled in explicitly here (the themeContract.test.ts precedent).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// ── The D51 vapor-assimilation END-STATE GUARDS (plan §3 V3/V6 · R4/R8/R21/R22) ────────────────────
//
// Four mechanical guards that made the assimilation ladder enforceable instead of honor-system — and
// that now hold the FINISHED state (D51 §3 V6, 2026-08-02: the ladder is complete, so these stopped
// being a burn-down ratchet and became the maintenance-era fence). They are deliberately DUMB text
// checks: every failure mode here is a MISSING or EXTRA line, which reading the source proves, and the
// alternative (a browser cascade test) can't run in jsdom at all — jsdom replays neither @layer nor
// @scope nor the body-formula cascade. The real-browser half of V3 lives in `e2e/vapor-tokens.spec.ts`
// (the computed-style split-palette probe, all three accents).
//
//   1. THE BANNER SET — `themes/vapor/extras.css` WAS the deletion iceberg (~3000 ln of vapor-scoped
//      styling of SHARED components, 41 banners). V5 melted it; at V6 the assertion flipped from
//      shrink-only (`baseline ⊇ current ⊇ keeps`) to **EQUALITY**: the residue must BE the six frozen
//      vapor-keeps banners. Ledger: docs/VAPOR_BANNER_LEDGER.md.
//      ⚠️ WHAT THIS DOES AND DOESN'T CATCH — **banner-taxonomy equality**. The fence holds the BANNER
//      SET, i.e. the file's TAXONOMY: no new category of vapor-scoped styling can appear un-ledgered,
//      and no keeps category can vanish. It says nothing about the CSS *inside* a keeps banner —
//      growing the Fleet's own rules there is legitimate, and smuggling shared-component styling in
//      under a keeps header is a REVIEW-era concern, not a machine-caught one. Don't read a green run
//      as "no bespoke remainder was added".
//   2. THE TOKEN-MAP PLACEMENT — the §14.4.1 formula-token trap, checked statically.
//   3. THE CONTRACT-NAME SPLIT — vapor.css/extras.css declare vapor-PRIVATE names only; every contract
//      name has exactly one home (themes/vapor/tokens.css). This is what closed the §13.2 collision.
//   4. THE END-STATE PINS (V6/R22) — VaporRoot renders `DefaultRoot`, and the bespoke chrome V4 deleted
//      (`components/{AppBar,Composer,TabBar}`) is gone AND unreferenced. The third leg of the end state
//      is `CONTRACT_WAIVERS === {}`, asserted where the constant lives (themeContract.test.ts).

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
// THIS LIST.** It was the high-water mark the file could only shrink away from; since V5 emptied it to
// the six keeps and V6 flipped the live check to EQUALITY, it is kept as the PROVENANCE record (what
// the ladder burned down from, and the set the surviving keeps are checked against for self-consistency).
// Ledger: docs/VAPOR_BANNER_LEDGER.md — bucket + dying-at slice for every row, plus the shared-ownership
// notes (a keyframe/selector several components share may not leave with the first of them).
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
// -row actions/chevron. They survived every V4/V5 deletion, and since V6 they ARE the file: the equality
// assertion below reads this constant as both floor and ceiling. Amendable only by an explicit owner
// ruling recorded in the ledger + D51.
const VAPOR_KEEPS: string[] = [
  "F14 — Hero now-dots are <button>s now (so keyboard tab reaches them).",
  "F15 / Appearance · Motion — user-controlled ambient-animation gate.",
  "Firefox smoothness, full effects ON — containment/layer hints (NO visual change). The goal is to",
  "Reboot button (Phase: reboot action). Net-new device-row action: a restart sibling of the",
  "Device-row action area: when a host is ONLINE it shows two buttons (reboot + shutdown). They",
  "DeviceRow chevron toggle as a real <button> (D25, a11y)",
];

// ── THE V6 FLIP: from a shrink-only RATCHET to an EQUALITY fence ───────────────────────────────────
// V3→V5 asserted `V3_BASELINE_BANNERS ⊇ current ⊇ VAPOR_KEEPS` — a burn-down over immutable constants,
// with no editable mirror to "fix" a violation with. V5 emptied the iceberg (41 → 6, and those six ARE
// the frozen keeps list), so D51 §3 V6 flips the live assertion to **`current === VAPOR_KEEPS`**: the
// residue may no longer shrink OR grow. `V3_BASELINE_BANNERS` stays, unused by the equality check, as
// the PROVENANCE record — the 41-banner high-water mark this file burned down from (it is also what
// makes the third test, keeps ⊆ baseline, a real self-consistency check on the frozen pair).
//
// MAINTENANCE ERA — read this before "just adding a banner": vapor is DONE. A new `/* ── … ── */`
// banner in extras.css is not a ledger tick, it is a re-opening of the assimilation — it needs a
// D51-SUCCESSOR RULING, not an edit here. The kit is where new shared-component styling goes.
describe("D51 V6 — the extras.css banner set EQUALS the frozen vapor-keeps list", () => {
  const banners = bannersOf(read(EXTRAS));
  const current = new Set(banners);

  it("carries the six vapor-keeps banners and NOTHING else (the D51 end-state bar)", () => {
    const strays = [...current].filter((b) => !VAPOR_KEEPS.includes(b));
    const lost = VAPOR_KEEPS.filter((k) => !current.has(k));
    expect(
      { strays, lost },
      "extras.css's banner set must EQUAL the frozen vapor-keeps list (D51 §3 V6 — the assimilation is\n" +
        "  COMPLETE; this is no longer a shrink-only ratchet):\n" +
        (strays.length
          ? `  · EXTRA (${strays.length}):\n` + strays.map((s) => `      · ${s}`).join("\n") + "\n"
          : "") +
        (lost.length
          ? `  · MISSING (${lost.length}):\n` + lost.map((s) => `      · ${s}`).join("\n") + "\n"
          : "") +
        "  · ADDED a banner? vapor is DONE — new bespoke vapor styling of a SHARED component is exactly\n" +
        "    what D51 deleted. Style it in the kit (kit.css, on contract tokens) so every theme gets it.\n" +
        "    A genuinely vapor-only need is a D51-SUCCESSOR RULING + a ledger amendment, never a quiet\n" +
        "    edit to VAPOR_KEEPS. (Fidelity on SHARED kit hooks — the §15 reskin route, e.g. the plan-pin\n" +
        "    block — needs no banner: it rides vapor.css/the un-bannered fidelity section.)\n" +
        "  · DELETED one? These six style the Root-pinned VaporFleet surface D51 §1.1 rules bespoke-by-\n" +
        "    right (hero now-dots, the ambient-motion gate, the Fleet containment hints, the device-row\n" +
        "    actions + chevron). Restore it, or amend the frozen list with an explicit owner ruling\n" +
        "    (ledger §5 + D51).\n" +
        "  · RENAMED/re-worded a first line? Don't — the first line IS the ledger key; the ledger, the\n" +
        "    frozen lists here and the file must all read the same string.",
    ).toEqual({ strays: [], lost: [] });
  });

  it("carries each banner exactly ONCE (a set comparison can't see a duplicate)", () => {
    expect(
      banners.length,
      `extras.css has ${banners.length} banner LINES for ${current.size} distinct keys. The equality ` +
        `check above compares SETS, so a duplicated key slips past it — and a second block filed under ` +
        `an existing key is un-ledgerable (the ledger is keyed by that first line). Fold the new rules ` +
        `into the existing block, or take them to the kit.`,
    ).toBe(VAPOR_KEEPS.length);
  });

  it("the frozen lists are self-consistent (vapor-keeps ⊆ the V3 baseline)", () => {
    // The provenance check: every survivor was present at the freeze, so no keep was ever back-filled.
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

// ── 4. The V6 END STATE, pinned mechanically (D51 §3 V6 · R22) ─────────────────────────────────────
//
// Two STRUCTURAL legs live here; the third — `CONTRACT_WAIVERS === {}` — is asserted in
// themeContract.test.ts, where the constant lives (a cross-import between test files would re-register
// that file's whole suite here). Scope, stated honestly: these pin the SHELL's shape (vapor's Root is
// DefaultRoot hosting and nothing else; the three deleted chrome files stay deleted and unreferenced).
// "No bespoke remainder" as a whole is broader than any regex — it is a review standard, and these are
// the two of its edges that a machine can hold.

const VAPOR_ROOT = "src/themes/vapor/VaporRoot.tsx";
/** The bespoke chrome the V4 delete commit removed — vapor's parallel copies of kit capabilities. */
const DELETED_CHROME = ["AppBar", "Composer", "TabBar"] as const;

/** The JSX expression a module's LAST `return` yields: everything between that `return` and the final
 *  `;`, comments stripped, one wrapping paren pair removed. VaporRoot has one component and one return,
 *  which is what makes this dumb slice exact. */
function returnedJsx(src: string): string {
  const nc = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  let expr = nc.slice(nc.lastIndexOf("return") + "return".length);
  expr = expr.slice(0, expr.lastIndexOf(";")).trim(); // drop the `;` + the function's closing brace
  if (expr.startsWith("(") && expr.endsWith(")")) expr = expr.slice(1, -1).trim();
  return expr;
}

/** Every source file under a dir (recursive), filtered to the code extensions we care about. */
function sourceFiles(dir: string): string[] {
  const root = resolve(process.cwd(), dir);
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(tsx?|css)$/.test(f))
    .map((f) => `${dir}/${f}`);
}

describe("D51 V6 — the end state (no bespoke remainder), pinned in source", () => {
  it("VaporRoot IMPORTS the kit's DefaultRoot", () => {
    expect(
      /import\s*\{[^}]*\bDefaultRoot\b[^}]*\}\s*from\s*"[^"]*kit\/DefaultRoot"/.test(
        read(VAPOR_ROOT),
      ),
      `${VAPOR_ROOT} must import the kit's DefaultRoot (D51 §1.1: vapor takes cosmos's shape — a thin ` +
        `Root over DefaultRoot hosting + a Root-pinned bespoke Fleet). A VaporRoot that hand-rolls the ` +
        `shell again is the parallel-chrome hook (④) D51 V4 killed.`,
    ).toBe(true);
  });

  it("…and RENDERS it as its whole output — one root element, and that element is <DefaultRoot>", () => {
    // The structural half of the no-resurrection pin. A mere "<DefaultRoot appears somewhere" check
    // passes happily on `<><DefaultRoot/><VaporAppBar/></>` — chrome renamed and re-mounted BESIDE the
    // kit shell, which is hook ④ wearing a new hat. So anchor BOTH ends of the returned expression:
    // JSX's own single-root rule means any sibling needs a fragment or a wrapper element, and either
    // one moves the first characters off `<DefaultRoot`.
    const jsx = returnedJsx(read(VAPOR_ROOT));
    expect(
      /^<DefaultRoot[\s/>]/.test(jsx) && /(\/>|<\/DefaultRoot>)$/.test(jsx),
      `${VAPOR_ROOT}'s return must BE a single <DefaultRoot …/> element — nothing wrapping it, nothing ` +
        `beside it. It currently returns:\n\n${jsx}\n\n` +
        `  · A FRAGMENT or wrapper element? Then something renders next to the kit shell. If it is ` +
        `chrome (a bar, a composer, a nav), that is the parallel-chrome hook D51 V4 deleted — put it in ` +
        `the kit and reach it through a slot (the \`brandMark\`/\`bodies\` precedents).\n` +
        `  · Genuinely theme-owned, non-chrome, and it cannot be a slot? That needs an explicit ` +
        `D51-successor ruling first.\n` +
        `  · A conditional return (\`cond ? <DefaultRoot/> : <Legacy/>\`)? Same answer — the second arm ` +
        `is the remainder.`,
    ).toBe(true);
  });

  it("the bespoke chrome components/{AppBar,Composer,TabBar} are DELETED and unreferenced", () => {
    for (const name of DELETED_CHROME) {
      expect(
        existsSync(resolve(process.cwd(), `src/components/${name}.tsx`)),
        `src/components/${name}.tsx is BACK. D51 V4 deleted vapor's parallel copy of a kit capability ` +
          `(kit ${name} ⇄ this file); resurrecting it re-opens hook ④. Extend the kit instead (D31 3-gate ` +
          `/ D37 axes — the brandMark slot is the precedent).`,
      ).toBe(false);
    }
    // …and nothing imports them (an import of a deleted path would fail typecheck, but a resurrected file
    // would not — so pin the REFERENCE too, across src/ + the two test trees).
    const importRe = new RegExp(
      `from\\s*"[^"]*components/(${DELETED_CHROME.join("|")})"|import\\("[^"]*components/(${DELETED_CHROME.join("|")})"`,
    );
    const offenders = [
      ...sourceFiles("src"),
      ...sourceFiles("tests"),
      ...sourceFiles("e2e"),
    ].filter((f) => importRe.test(read(f)));
    expect(
      offenders,
      `these files import the DELETED bespoke chrome:\n` +
        offenders.map((f) => `    · ${f}`).join("\n") +
        `\n  The kit owns app bar / composer / tab bar for every theme since D51 V4 (KitAppBar, the ` +
        `composer layout catalog, KitNavBar). Point at those.`,
    ).toEqual([]);
  });
});
