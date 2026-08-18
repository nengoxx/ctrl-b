# Theme Engine — design record + the live authoring contract (D28–D34)

**Status: BUILT + SHIPPED — the FIVE registered themes are `vapor · minimal · cosmos · frontier ·
gacha` (`theme-engine/registry.ts` = truth; phosphor/observatory are declared in the `ThemeId` union
but were never built, §14.10); the
engine (§14: controllers + Root + Kit + Surfaces) is the as-built architecture.** **Hardening slice v2 ✅ SHIPPED 2026-07-10 (§14.15.1-A)**; the **Composer Surface ✅ SHIPPED
2026-07-11** (§14.15, D34) and **frontier (T5) ✅ CLOSED 2026-07-15** on the owner's Gate D sign-off —
the theme population is CLOSED (owner): no new themes; existing themes formalize onto the kit. *(Header updated 2026-07-07, doc-consistency pass — the old "DESIGN OPEN" status
predated the build.)*

> **The ask (owner, 2026-06-26):** keep **vapor** with its palettes, and add the prototyped themes
> **exactly as they are** (nuances + complexity preserved, not approximations). Build a "theme engine"
> that switches between vapor / cosmos / frontier / minimal (and their palette options) and lets us
> **natively add new theme variations** that are as dynamic/flexible as the prototypes.

---

## §0 — Theme Author Contract (pointer index — added 2026-07-07; nothing is restated here)

**Epoch guide (how to read this doc).** It grew in three epochs, all kept for rationale:
**§§1–8** = the analysis epoch (historical) · **§§9–13** = the T0 epoch — *mixed*: the slot model
(§9.0, §9.2–§9.5, §9.13, §13.2–§13.3 mechanics) is **dead** (each carries a banner; §14.9 is the
mapping), while §9.7–§9.12 + §13.1 remain live contract · **§14** = the **live architecture**
(D29–D34). When in doubt: §14 + the code win.

**To add a theme, satisfy** (each row points at its single owner):

| Requirement | Owner |
|---|---|
| One `ThemeDef` registry row (`id/label/Root`(or `loadRoot`)`/palettes/loadStyles/loadFonts?/present?/assets?/settings?/defaultLayout?/layouts?/media?`) | §14.3 · `theme-engine/types.ts` (code = truth) |
| Lazy `Root` owns the whole presentation (controllers stay above it) | §14.1 · §14.3 · §14.5 |
| Section composition — per-theme body overrides (`bodies`) + the `defaultLayout`/`layouts` capability declaration | **§14.17** (SECTION LAYOUT SYSTEM v1, D35) |
| Pick the cheapest CSS band per region: tokens-only reskin under `.kit` → Surface → bespoke | §14.4.1 (recipe) · §14.14 (3-band + 3-gate) |
| Reskinning the agent CHAT: style the pinned hook classes + tokens only — never fork the shared tree | **§15** (chat hooks + token contract, D36) |
| Cross-theme look levers (`outlines` · `composerSkin`): declare the per-theme default; strips live in the `axes` layer (never fills), composer chrome belongs to skins — not theme CSS | **§14.16** (presentation axes, D37) |
| Semantic token contract (mode/accent axes; two-channel accent) | §9.7 · §14.13 #1 |
| Author OKLCH colors **in-gamut for sRGB** (a too-vivid chroma gamut-clips flat/hue-shifted on sRGB phones — the owner's device is sRGB; the B2 advisory scan warns per out-of-gamut `oklch()` literal with a clamp suggestion) | §14.15.4 (built 2026-07-12) · `themeContract.test.ts` advisory group |
| Keyframes prefixed `<id>-` | §14.13 #4 |
| The `@scope`/`:scope` + formula-tokens-on-`body` gotcha | §14.6 (canonical; §14.4.1/§14.13/§10 restate) |
| Perf/motion budget — transform/opacity only · `data-motion`/`data-perf` gates · canvas caps · **Fennec + Chrome** | §14.11 |
| a11y floor — one named focusable per host; decorative `aria-hidden` | §14.14 invariant #5 |
| Per-theme settings (`switch`/`seg`; open synced `ui.themeSettings[id]` map) | §14.3 |
| `present()` + per-host `appearance.<id>` override (+ `ThemeDef.assets` art) | §9.9 · §14.13 #7 |
| Fonts/assets lazy (no first-paint hit) | §9.10 · §10 steps 1–2 |
| Cross-device sync (LWW appearance channel) | §9.11 |
| 390 px owner eyeball + an e2e render case | §14.13.1 (+ the standing per-slice eyeball rule, TODO Phase 11) |
| **Wire the three guard tables** — `stylelint.config.mjs` `^<id>-` keyframe override · `e2e/contrast-matrix.ts` row · `TOKENS_RAW` entry in `themeContract.test.ts` (all hand-maintained BY DESIGN; the P2 meta-guard + drift guards fail loudly with instructions until each is added) | §14.13.1 P2 · the files' own headers |
| The step-by-step porting playbook | **§10** (rewritten as-built 2026-07-06) |

**⚠ SPEC-not-built — do not assume these exist in code:** *(none currently. The tab **body** registry
formerly listed here SHIPPED 2026-07-12 as frontier F0 / D35 — the SECTION LAYOUT SYSTEM v1: kit
`DEFAULT_BODIES` + the `bodies` DefaultRoot prop + curated 4/3/2-tab presets + the device-local `ui.layout`
lever; the live contract is **§14.17**, with §14.15.4's as-built entry + `FRONTIER_PLAN.md`'s banner as the record.)* *(The user-selectable Surface machinery formerly listed here SHIPPED
2026-07-11 — the composer Surface is COMPLETE per `COMPOSER_SURFACE_PLAN.md`: `composerVariants`
catalog `[stacked, borderless, ghost, sheet, line]` + `ThemedComposer` resolver + the `planPlacement`
inline/pinned axis; F5 slice B [2026-07-15, D37] deduped the catalog to `[stacked, sheet, line]` —
borderless/ghost became the `glass`/`sleek` skins of the `composerSkin` axis, §14.16. The Hardening-v2 artifacts — `resolveThemeSetting` ⑦, `themeContract.test.ts` ⑧,
stylelint ⑨, `kit-render.spec.ts` ⑩ — all SHIPPED 2026-07-10 and ARE in the tree.)*

**Sequencing rule (satisfied 2026-07-10):** the Hardening slice v2 (§14.15.1) landed **before** the next themeable-UI wave
— a frontier plan builds on top of it, not around it.

**frontier (T5 — §14.10; full plan: `FRONTIER_PLAN.md`, design LOCKED 2026-07-07; F0–F3 ✅ SHIPPED
2026-07-12 + F4 ✅ 2026-07-13 — frontier is REGISTERED and fully live [Fleet map · HostDetail sheet ·
the bespoke Agent tab on the §15 chat contract]; F5 polish/gates remains):**
the second bespoke/spatial theme. Pre-classified:
**Fleet = bespoke** (Mœbius art-map + GPS beacons + rig-card grid; `present()` supplies x/y +
`assets` art; the per-host `appearance.frontier.image` override was **RETIRED at D53 M2** — the
`media/frontier/rigs/` owner pool replaced it; `x`/`y` still work — §9.9) · **Agent tab = bespoke** (the
one non-Fleet structural deviation any theme has, D29) · **HostDetail = reuse the Kit
`BottomSheet`** · everything else = a `.kit` tokens reskin. Design source:
`design/prototypes/variations/frontier.html`; build precedent + reusable seams
(`BottomSheet`/`present()`/`sheetSnap`/camera-lift): `COSMOS_HANDOFF.md` (historical record).
Gotcha: frontier's **gradient accents** must live in `--accent-fill` — the `--accent` channel must
parse as a plain `<color>` (§14.15.1 ⑨).

## 1. The prototypes (what was actually built)

Six single-file HTML prototypes (~40 KB / 450–850 lines each), each a *complete* app in its own design
language. **All six are 3-tab (Fleet/Agent/Conf) — none has the Utils/Tools tab** the shipped app has,
and several rename tabs. Each loads **its own Google Fonts** and defines **its own disjoint CSS-variable
namespace**.

| Theme | Concept | Palette options | Fleet tab (the signature surface) | Port complexity |
|---|---|---|---|---|
| **vapor** *(shipped)* | synthwave sunset | aqua / ember (named, single-axis, dark-only) | expandable device rows + summary | (baseline) |
| **minimal** | flat, calm, sleek | **2-axis matrix: light/dark × 4 OKLCH accent hues = 8 combos** | device rows + "now monitoring" featured card w/ live canvas ping | **LOW–MED** (mostly reskin) |
| **phosphor** | amber CRT terminal | amber ↔ green-phosphor (both dark) + accent selector | device rows (restyled) + ASCII `<pre>` topology | **LOW–MED** (reskin + CRT overlay) |
| **observatory** | astronomy mission-control | light/dark + accent hue | device rows + **SVG radial topology map** (per-host `angle`) | **MED** |
| **cosmos** | orbital solar system | light/dark + 4 accent swatches | **orbital planets w/ rAF zoom-pan camera**; tap-to-focus; canvas starfield + per-host waveform | **HIGH** |
| **frontier** | **Mœbius badlands comic** (hand-drawn art assets — §6) | night/day × 4 accent | **art-map w/ GPS beacons + 2-col "rig-card" grid (the drawings) + modal bottom sheet** | **HIGH** |

Recurring motif across minimal/cosmos/frontier: a **"now monitoring" featured host** (big stats + a live
`<canvas>` ping waveform, often auto-cycling every 5s). Worth treating as a shared concept.

> **Outcome of this table (status line, 2026-08-17).** Built + registered: **vapor · minimal · cosmos ·
> frontier**, plus **gacha** (Phase 17 / D52 — born after this table, so it isn't in it). **phosphor (T2)
> and observatory (T3) were never built** and never will be — the theme population is **CLOSED** (owner
> 2026-07-15); they remain declared in the `ThemeId` union only. **Five registered themes** —
> `theme-engine/registry.ts` is the truth.

> **Scope (owner, 2026-06-26):** in scope = **minimal, phosphor, cosmos, frontier** (+ **vapor**, shipped,
> **FROZEN — do not touch**). **observatory = in scope but LOW priority** — its prototype isn't fully built
> yet, so port it **last / once its design is complete**. **`vapor.html` (proto) is DROPPED** — it's the
> *old* vapor design; the shipped React vapor is the improved one. frontier is kept **exactly as-is
> including its hand-drawn Mœbius art** (see §6).

## 2. The five findings that shape the architecture

1. **No shared token contract.** Every theme names its design tokens differently and models *accent*
   differently: vapor = baked **gradients + glows** (`--accent-grad`, `--m-glow`); minimal = flat
   **OKLCH** (`--accent`/`--accent-soft`); cosmos/frontier = a runtime **`--acc` indirection**;
   phosphor = a **monochrome ramp** (`--amber*`). Neutral ladders differ too (`--ink*`+`--bg-1/2/3` vs
   `--text*`+`--surface*`). → Components must consume a **normalized *semantic* token interface**, and
   each theme maps onto it; they cannot hardcode any one theme's variable names.
2. **Themes restructure components, not just colors.** cosmos (orbital fleet), frontier (map+beacons+
   bottom-sheet), observatory (SVG topology), vapor-proto (canvas carousel) each have **net-new
   signature components** no CSS swap can produce. minimal/phosphor are close to reskins. → The engine
   needs **per-theme component variants**, not just a stylesheet switch.
3. **Palette is (up to) a 2-axis matrix.** minimal proves the rich model — **mode (light/dark) ×
   accent (hue)**, independent (8 combos). vapor's current model is single-axis named palettes
   (aqua/ember). phosphor shows "palette options *within* a theme" (amber/green). → Generalize to
   **theme → {mode axis?, accent axis?, named-palette axis?}**, where a theme declares which axes it
   supports.
4. **Themes need per-host *presentation* data the real model lacks.** cosmos → planet size/color/
   symbol/orbit `{r,a,spd}`; frontier → map `x/y` + photo + license-plate; observatory → `angle`.
   These are authored in the prototypes, not derived from host data. → The engine needs a **per-theme
   host-presentation layer** (deterministic derivation from role/status where possible, + optional
   explicit per-host overrides in config).
5. **Per-theme fonts, assets, tab sets.** Each theme loads its own fonts; frontier uses real `.png`
   imagery; tab counts/names vary (all proto = 3 tabs, no Utils). → Font loading, an asset strategy,
   and a **flexible tab registry** are all theme-scoped concerns.

## 3. Proposed architecture — a pluggable presentation layer over the shared core

> **⛔ SUPERSEDED by §14 (the D29 Root+Kit architecture) — kept for rationale/history; §14.9 maps what survived.**

The app already separates **data/logic** (TanStack Query hooks, the `store/*` external stores, the API
client, the `ui` store) from **presentation** (the vapor components + `vapor.css`). The data/logic core
is **theme-agnostic and stays as-is**. We make the *presentation* layer pluggable:

```
        ┌─────────────────────────  shared core (unchanged)  ─────────────────────────┐
        │  hooks/useFleet, useActions, useSettings · store/* · api/client · ui store   │
        └──────────────────────────────────────────────────────────────────────────────┘
                                          │  (host/service/agent data, actions)
        ┌─────────────────────────────────▼──────────────────────────────────────────┐
        │  THEME MODULE  (one per theme; selected at runtime)                         │
        │   • tokens.css   — maps the semantic token interface (§2.1) + theme extras  │
        │   • fonts        — the theme's web fonts, lazy-loaded when active           │
        │   • components   — variants for the surfaces it restructures (esp. Fleet)   │
        │   • palettes     — declared axes: mode? accent? named? + their values       │
        │   • present(host)— per-host presentation mapping (planet/beacon/angle/…)    │
        │   • tabs         — which tabs + labels (default: the standard 4)            │
        └─────────────────────────────────────────────────────────────────────────────┘
```

**Mechanics:**
- **A `ThemeRegistry`** (a typed `ThemeDef` per theme, mirroring the backend action-registry pattern):
  `{ id, label, palettes, fonts, tokensHref|cssModule, components: Partial<ThemeSlots>, present }`.
  Adding a theme = one registry entry + its module — the "natively add new variations" goal.
- **Component slots.** Components split into **shared** (token-normalized: AppBar, Composer, Conf rows,
  TabBar shell, chat bubbles — ~70% of surface) and **slotted** (theme-overridable: `FleetView`,
  `HostDetail`, `Hero`/`NowMonitoring`, the tab-indicator). A slot resolves to the active theme's
  variant, else a default. cosmos/frontier ship a `FleetView`; minimal/phosphor reuse the default rows.
- **⛔ vapor is FROZEN (owner directive).** The shipped vapor components + `vapor.css` are **registered
  as the vapor theme module exactly as they are — not refactored.** vapor is the special, hand-tuned
  original; the engine must be **purely additive** around it. (So: no "normalize vapor onto semantic
  tokens" refactor — that earlier idea is dropped.)
- **Self-contained theme modules + an optional shared base.** Each new theme is a **self-contained
  presentation module** (its own components + CSS + tokens + fonts + assets), mirroring how the
  prototypes are self-contained single files — this is what keeps each theme pixel-faithful to its
  prototype (D7-per-theme). To avoid duplicating ~70% identical chrome across the *reskin-class* themes,
  the **structurally-similar themes (minimal, phosphor) may share a NEW token-driven base** (semantic
  tokens `--accent`/`--surface{,-2}`/`--text{,-2,-3}`/`--line{,-2}`/`--ok/--warn/--danger`, accent
  resolvable to flat-or-gradient) — *new code, not vapor's*. The **structurally-distinct themes (cosmos,
  frontier)** bring their own `FleetView`/detail components via slots. **How much base to share vs
  duplicate is the main T0 granularity decision** — bias toward faithful duplication over a leaky shared
  abstraction.
- **Palette model.** `ui` store gains `{ theme, mode, accent }` (today's single `theme` enum
  generalizes). A `ThemeDef.palettes` declares supported axes + values; `applyBodyAttrs` sets
  `body[data-theme][data-mode]` + (for accent) injects the accent token. Backwards-compatible: vapor's
  aqua/ember become named palettes; minimal's mode×accent uses both axes.
- **Per-host presentation.** `ThemeDef.present(host, index)` returns the theme's visual encoding
  (planet/beacon/angle/…), deterministic from role+status+index by default, overridable by an optional
  `appearance` block on the host config (the per-theme-per-host override seam).
- **Persistence/sync.** OPEN (see §5) — client `ui` store (today) vs backend `config.yaml` (syncs the
  owner's Android+desktop). Recommendation leans backend for the *active selection* + any custom accent,
  keeping the instant-apply path.

## 4. Phased plan (build the engine on the cheapest theme first, hardest last)

Each theme is an independently shippable slice; the engine foundation is paid once.

- **T0 — Foundation (the engine — vapor untouched).** The `ThemeRegistry` + slot resolution; register
  the **existing vapor components as the vapor module as-is** (no edits); generalize the `ui` store to
  `{theme,mode,accent}` (client-persisted now, sync seam designed — see §5.2); per-theme font + CSS
  lazy-loading; the Conf → Appearance theme/palette picker. **Acceptance: vapor is byte-for-byte
  unchanged and still default** — the engine is proven by adding a switch that, with only vapor
  registered, changes nothing. De-risks everything.
- **T1 — minimal** (LOW–MED): validates the engine on a near-reskin theme + the **mode×accent matrix**
  (the richest palette model — build it here so the abstraction is right). Mostly tokens + a couple of
  variant tweaks (tab-indicator pill, the featured "now monitoring" card).
- **T2 — phosphor** (LOW–MED): validates the **overlay layer** (CRT scanlines/grid/glow) + a
  monochrome palette + the within-theme palette option (amber/green).
- **T3 — observatory** (MED): first real **component variant** — the SVG topology `FleetView` + per-host
  `angle`. Proves slots + `present()`.
- **T4 — cosmos** (HIGH): the orbital `FleetView` — rAF orbit+camera, per-host planet encoding, canvas
  starfield + waveform, viewport morph. The stress test for slots + presentation data + animation
  lifecycle.
- **T5 — frontier** (HIGH): map+beacons+`x/y`, photo rig-cards, the **bottom-sheet** detail primitive,
  and the **asset strategy** (per-host imagery / placeholders). Heaviest net-new surface.
- **Shared `NowMonitoring` slot** — the auto-cycling "featured host + live canvas waveform" recurs in
  minimal/cosmos/frontier; build it once as a slot those themes style, rather than three times.
  (vapor stays on its own existing Hero — untouched.)

## 5. Open decisions — settle before/within T0 (owner input needed)

1. ~~Scope~~ **RESOLVED (owner 2026-06-26):** minimal + phosphor + cosmos + frontier (+ vapor frozen).
   vapor-proto dropped. **observatory = in scope but LOW priority** (prototype incomplete — port last).
2. ~~Persistence~~ **RESOLVED:** **v1 = client-local** (extend the existing `ui` store localStorage), but
   **design the complete cross-device feature** — an `appearance` block in `config.yaml` (active theme +
   mode + accent + any custom palette) synced via the settings API, with the `ui` store reconciling on
   load. Build the seam now (the store reads an injectable initial value; the backend block is additive),
   ship the local path first. ("Always think about the complete feature" — owner.)
3. **Per-host presentation data (OPEN).** Deterministic derivation (role/status/index → planet/beacon/
   angle) — zero config — vs an explicit per-host `appearance` override. Likely **both**: derive by
   default, optional override. For **frontier specifically**, see #4 — the art assignment is the concrete
   instance of this.
4. ~~frontier assets~~ **RESOLVED (keep the art):** frontier's "photos" are the owner's **hand-drawn
   Mœbius-style comic art** — they ARE the theme and must be kept. **OPEN sub-question:** how is art
   assigned to *real* hosts? Options: a fixed set of the owner's drawings cycled by host index/role
   (zero per-host config), or an optional per-host `image` field so the owner can pick a drawing per
   machine. (Leaning: ship a built-in drawing set assigned by index, add the per-host override later.)
5. **Utils/Tools tab (OPEN).** All prototypes dropped it (3-tab). Keep the 4th tab in a generic per-theme
   style, or let a theme declare its tab set and fold Tools elsewhere? (Leaning: themes declare tabs;
   default 4, a theme may omit/restyle — the engine already needs a flexible tab registry.)
6. **OKLCH / `color-mix` baseline (low-risk).** Prototypes use `color-mix` (srgb+oklch), `oklch()`,
   `100dvh`, `backdrop-filter` — fine on the owner's modern Android Chrome/Firefox. Confirm no older target.

## 6. ⚠️ Discrepancies to confirm with the owner

- ~~frontier "comic"~~ **RESOLVED:** frontier **IS** a comic theme — a **Mœbius (Jean Giraud) badlands
  comic**. The comic-ness lives in the owner's **hand-drawn art assets** (the "rig" drawings + map art),
  not in CSS halftone/outlines (the agent correctly found none of that). Keep the theme exactly as-is,
  **art included** (decision §5.4).
- ~~vapor-proto~~ **RESOLVED:** dropped — it's the *old* vapor design; the shipped React vapor is the
  improved one and is **frozen/untouched**.
- **cosmos central body (minor).** The owner said "planets rotating a **moon**"; the prototype's central
  body is a coin/orb (`.sun` in code) that doubles as the "All systems / deselect" home control. Confirm
  the central body's intended identity when porting T4 (cosmetic, not blocking).

## 7. Where this slots in the docs

New **DECISIONS D28** (lock the architecture + the §5 decisions). A **ROADMAP** "Appearance/theming"
expansion (today a one-liner). A **TODO Phase 11 — Theme engine** with the T0–T5 slices. This doc stays
the analysis reference. The standing **D7 (pixel-exact fidelity)** mandate now applies *per theme* — each
ported theme must be visually indistinguishable from its prototype at phone width.

## 8. ⭐ RESEARCH & DESIGN PHASE BRIEF — do this next, in a clean session (owner directive 2026-06-26)

> **📜 DONE (2026-06-26)** — this brief was executed; see the banner before §9. Historical.

**This feature is NOT ready to implement.** The owner wants a **deliberate, thorough research + design
phase first** — "research deeply how to better design this feature with our existing code; I want it
flexible for future themes AND for the edits I'll keep making to the prototypes." Treat §§1–7 above as the
*input analysis*; the next session's job is to turn it into a **locked, code-level architecture spec**.
**Do not write feature code in that session — produce the design.**

**North star:** adding a future theme (or re-syncing one after the owner edits its prototype) should be
**cheap and mechanical** — a new self-contained module + a registry entry, with vapor untouched. Optimize
the architecture for *that*.

**Research deeply (both halves):**
- **(a) Our existing code — find the cleanest seams.** Map exactly how the React app renders today: the
  component tree (App → tabs → components), the `ui` store + `applyBodyAttrs` data-attr path, how
  `vapor.css`/`extras.css` are loaded and scoped, asset/font loading (`index.html`), the TanStack-Query
  data hooks the presentation consumes, and how `FleetTab`/`DeviceRow`/`Hero` are built. Identify the
  precise injection points for a theme switch that **touches no vapor code**.
- **(b) External best practices — pick the patterns deliberately.** Research and compare (web-sourced,
  cite): multi-theme/skinnable architectures in React; **CSS strategy** options (per-theme stylesheet
  bundles + `data-theme` scoping vs CSS Modules vs CSS-in-JS vs vanilla-extract) and which best keeps each
  theme isolated, lazy-loaded, and faithful; **component-slot / variant registries**; **design-token**
  systems (semantic tokens, the flat-vs-gradient accent problem, OKLCH); per-theme **font + asset**
  loading without bloating first paint; and a **prototype→module workflow** that minimizes drift when the
  owner re-edits a single-file prototype (e.g. keep the module's DOM/CSS structurally close to the
  prototype; consider a documented porting convention).

**Produce (the deliverables):**
1. A **code-level design spec** (DESIGN.md-style) in this doc or a sibling: the `ThemeDef`/`ThemeRegistry`
   types, the slot system + the exact slot list, the token convention, the chosen CSS/asset/font strategy
   with rationale, the `{theme,mode,accent}` palette model, the client-local **+ designed-but-deferred**
   config-sync persistence seam, and the per-host presentation layer.
2. The **prototype→theme-module porting playbook** (how to add/refresh a theme cheaply + faithfully).
3. **DECISIONS D28** locking the architecture + the §5 resolutions; **TODO Phase 11** (T0–T5); a ROADMAP
   Appearance expansion. Re-confirm the few still-OPEN §5 items (frontier art assignment, Utils tab,
   per-host data) as part of the spec.

**Reference material is in the repo:** the prototypes live in `prototypes/project/variations/*.html`
(+ art in `prototypes/project/assets/`), now committed. The four prior agent analyses (cosmos/frontier/
minimal deep-dives + the observatory/phosphor classification) are summarized in §§1–2; re-run focused
reads if needed. **Scope the research to a clean session — it's a big, careful design effort, not a quick
slice.**

---

# ✅ RESEARCH + DESIGN PHASE — DONE (2026-06-26). Locked spec below; →DECISIONS D28, →TODO Phase 11.

> The §8 brief is complete. Three parallel research streams ran (existing-code seam map · external
> best-practices, web-cited · prototype structural inventory) plus a focused fifth stream on the per-host
> presentation-data pattern. The owner resolved the four open judgment calls (recorded in §9.1). §§9–10 are
> the deliverable: a code-level design spec + a prototype→module porting playbook. **DECISIONS D28** locks
> the architecture; **TODO Phase 11** has the T0–T5 slices. This is *design only — no feature code was
> written.* T0 (the engine, vapor untouched) is the first build slice.

## 9. Code-level design spec (LOCKED — build against this)

> **⚠ Mixed epoch (labeled 2026-07-07).** The T0 slot model here was replaced by §14: **§9.0,
> §9.2–§9.5 and §9.13 are dead** (individually bannered). **§9.1 (decisions) and §9.7–§9.12
> (tokens · palettes · present() · fonts · sync · View Transitions) remain live contract** and are
> referenced by the §0 Author Contract. §14.9 is the survived-vs-replaced map.

### 9.0 The current architecture (AS-IS) — what T0 plugs into

> **⛔ HISTORICAL** — describes the pre-M0 code; the engine has since inverted this. See §14.1.

Mapped from the code (2026-06-26). This is *today's* reality the engine extends; §§9.1+ are the *target*.

- **Component tree (`App.tsx`).** A `.app-shell` flex column → `.app-scroll` holding `<AppBar/>` + the four
  tabs, then `<Composer/>` + `<TabBar/>` in-flow at the bottom. **Fleet/Agent/Utils are always mounted**;
  **Conf is `React.lazy` + conditionally mounted** (`confMounted` latch, idle-preloaded, `ErrorBoundary`→
  `Suspense` wrapper). Tab visibility is pure CSS: global `.tab{display:none}` / `.tab.active{display:block}`.
  App also runs three shell effects: `--appbar-h` (ResizeObserver on `.appbar`), `--app-h` (visualViewport,
  keyboard-aware), and a `beforeunload` dirty-guard. `showComposer = tab==="fleet"||"agent"` (hardcoded ids,
  mirrored in `store/ui.ts`).
- **The theme chokepoint (`store/ui.ts`).** A dep-free `createStore` external store, persisted to
  `localStorage["ctrlb.ui"]`, that mirrors itself onto **`body[data-theme|tab|skyline|loz|motion]`** +
  `.no-composer` via **`applyBodyAttrs`** (runs synchronously in `setUI`, and once at module load for
  first-paint). Today `theme: "dark"|"aqua"|"ember"` (a single conflated field).
- **CSS (`main.tsx` → `theme/`).** `vapor.css` (~1110 lines, all rules effectively global) + `extras.css`
  (~2278 lines: app-shell + net-new components, reuses vapor tokens) are **statically imported** (always
  loaded, global, unscoped). vapor's palette = a `:root` base (`--bg/--ink/--magenta/--accent-grad/…`) with
  full ~48-prop **`[data-theme="aqua"]`/`[data-theme="ember"]`** override blocks (+ `.hero` `!important`
  gradients). Only **4 `!important`** rules total, all vapor-only selectors.
- **The Fleet signature surface.** `FleetTab` → `<Hero/>` (SVG sun/grid/skyline from `heroScene.ts`, gated by
  `heroOn`; a `<Waveform/>` canvas that **live-reads `--accent-rgb`/`--accent-rgb-2`** each rAF frame, gated by
  `waveformOn`) + the device list (`DeviceRow` — LED/expand/services) + `<FleetSummary/>`. `TabBar` indicator
  slides via `grid repeat(4,1fr)` + `translateX(N*100%)` keyed on `.tabbar[data-tab]` (**4-tab-hardcoded CSS**).
- **The theme-agnostic core (stays as-is).** All `hooks/*` (`useFleet`/`useActions`/`useSettings`/…) and all
  `store/*` except `ui` have **zero theme/vapor coupling** — confirmed. `useSettings` is **Conf-tab-scoped**
  (`useScopedQuery("conf",…)`) so it does *not* fetch on Fleet/Agent (the reason §9.11 needs `GET /api/appearance`).
- **Appearance picker.** `ConfTab` → Appearance group: a `Seg<Theme>` (Vapor/Aqua/Ember) + skyline/loz/hero/
  motion controls, all calling `setUI`. This is what the theme/mode/accent picker extends.

**Net:** the seam already exists (`applyBodyAttrs` + a theme-agnostic data core). The engine adds an identity
attribute, a slot layer, lazy CSS, and a richer palette model **around** vapor — it does not rewrite any of
the above except `App.tsx` (→ slot host) and `store/ui.ts` (→ richer state). The exact deltas: §9.13.

### 9.1 Decisions resolved this phase (owner, 2026-06-26)

1. **Shared base + per-theme slot overrides** (the main T0 granularity call). Build **one** new
   token-driven *base* chrome shared by all four non-vapor themes; each theme owns only what it
   *restructures* via slots. (Not full per-theme duplication, not base-for-reskins-only.)
2. **vapor is the default *selection*, not the structural *fallback*.** vapor = the refined "v1 /
   pre-themes" original, kept *exactly as-is*, registered as a **fully self-contained module that overrides
   every slot** with its frozen components — it never leans on the base. The **slot-resolution fallback is
   the base** (minimal is the base made concrete). Unconfigured app → vapor; a missing slot on any *other*
   theme → base, never vapor.
3. **Tabs: v1 = all themes mirror vapor's 4 tabs**, but the engine carries a **genuinely flexible tab
   registry** — a theme can later declare more/fewer tabs (and the current tabs stay editable) **without
   breaking other themes**. Build the flexibility now; exercise the uniform-4 case in v1.
4. **Per-host presentation = theme-owned `present()` + derive-by-default + optional override** (the §5.3 /
   §5.4 questions, now researched + locked — see §9.9). Backend gains one additive optional field (defined day
   1); no migration; frontier art ships a built-in drawing set assigned by index **+ a per-host `image`
   override, both built in T5** (owner 2026-06-26 — no deferred half).
5. **Persistence + cross-device sync is BUILT DAY 1, not a deferred seam** (owner 2026-06-26: "always think
   about the complete feature; build it from day 1 to avoid refactors"). Backend-authoritative server-stamped
   LWW + localStorage instant-cache/offline-truth; the `ui` store is designed once with the reconcile/write
   path so no later refactor. Full spec §9.11.
6. **Theme-switch animation (View Transitions API) is BUILT DAY 1** (owner 2026-06-26). The `flushSync` +
   `startViewTransition` pattern, gated on `ui.motion` + feature detection, lazy-load before the transition.
   Full spec §9.12.

### 9.2 The spine (one diagram)

> **⛔ SUPERSEDED by §14 (the D29 Root+Kit architecture) — kept for rationale/history; §14.9 maps what survived.**

```
shared core (UNCHANGED)   hooks/* · store/* (minus ui) · api/client   ── host/service/agent data, actions
        │
  <ThemeProvider>  reads ui.{theme,mode,accent} · resolves slots from the ThemeRegistry · lazy-loads the theme bundle
        │
  resolveSlot(name) = registry[theme].slots[name] ?? BASE.slots[name]      (vapor fills ALL → never hits BASE)
        │
   ┌────┴───────────────────────────────────────────────────────────────────────────────────────┐
   │ vapor module (FROZEN)        │ BASE chrome (NEW, shared, = the fallback)                      │
   │  existing components +       │  token-driven AppBar · Composer · TabBar shell · TabIndicator  │   ← per-theme module:
   │  vapor.css, registered AS-IS │  · Conf shell/rows · ChatBubble · HostDetail(stats/actions/svc)│     tokens.css (scoped, lazy)
   │  overrides every slot        │  · FleetRows (default FleetView) · NowMonitoring + Waveform    │     · fonts · assets · palette axes
   └──────────────────────────────┴────────────────────────────────────────────────────────────────┘     · present(host) · tabs[]
                                                                                                            · slot overrides (only what it
                                                                                                              RESTRUCTURES: FleetView, HostDetail…)
```

**Why this keeps vapor frozen *and* the fallback sane:** vapor is complete on its own (every slot filled by
its shipped components) so the engine never substitutes a base part into vapor. Every *other* theme inherits
the base for chrome it doesn't restructure. Adding/re-syncing a theme = **one registry row + one
self-contained module + one verbatim scoped `.css`** — the north star.

### 9.3 Types — `ThemeRegistry` / `ThemeDef` / `ThemeSlots`

> **⛔ SUPERSEDED by §14 (the D29 Root+Kit architecture) — kept for rationale/history; §14.9 maps what survived.**
> **Do NOT build from this `ThemeDef`/`ThemeSlots`** — the live type is §14.3 + `theme-engine/types.ts`.

New `theme-engine/` dir under `frontend/src/` (sibling to `theme/`, which keeps `vapor.css`/`extras.css`).
Mirrors the backend action-registry pattern (typed descriptor per theme).

```ts
// theme-engine/types.ts
export type ThemeId = "vapor" | "minimal" | "phosphor" | "cosmos" | "frontier" | "observatory";
export type Mode = "dark" | "light";          // generalizes today's single `theme` enum's dark default

// TabId = the existing `Tab` union (store/ui.ts: "fleet"|"agent"|"utils"|"conf") — reuse, don't redefine.
// TabDef extends today's TabBar.tsx `{id,glyph,lbl}` array with the composer flag (§13.6 moves the hardcoded
// `showComposer = tab==="fleet"||"agent"` here so a theme's tab set drives it).
export type TabId = Tab;                        // import { type Tab } from "../store/ui"
export interface TabDef { id: TabId; glyph: string; lbl: string; hasComposer: boolean; }

// A theme declares WHICH palette axes it supports; the picker renders only the declared axes.
export interface PaletteModel {
  modes?: Mode[];                               // e.g. minimal: ["dark","light"]; vapor: undefined (dark-only)
  accents?: { id: string; label: string; value?: string }[]; // hue swatches OR named palettes (aqua/ember, amber/green)
  defaultMode?: Mode;
  defaultAccent?: string;
}

// The slot surfaces the engine can resolve per-theme. `Partial` — a theme fills only what it overrides.
export interface ThemeSlots {
  AppBar: React.ComponentType;
  TabBar: React.ComponentType<{ onPrefetch: (t: TabId) => void }>;
  TabIndicator?: React.ComponentType;           // most themes fold this into TabBar
  Composer: React.ComponentType;
  FleetView: React.ComponentType<{ active: boolean }>;   // THE signature surface — most-overridden
  HostDetail: React.ComponentType<HostDetailProps>;       // inline row body | slide panel | bottom sheet
  Hero?: React.ComponentType;                   // vapor's animated scene; non-vapor → NowMonitoring or none
  NowMonitoring?: React.ComponentType;          // shared featured-host + Waveform (minimal/cosmos/frontier)
  ChatBubble: React.ComponentType<ChatBubbleProps>;
  ConfShell: React.ComponentType;               // Conf tab container (rows are shared)
}

export interface ThemeDef {
  id: ThemeId;
  label: string;
  palettes: PaletteModel;
  tabs: TabDef[];                               // v1: every theme returns the standard 4 (see §9.8)
  slots: Partial<ThemeSlots>;                   // vapor = complete; others = only restructured surfaces
  loadStyles: () => Promise<unknown>;           // () => import("./minimal/tokens.css")  — lazy, code-split
  loadFonts?: () => Promise<void>;              // FontFace activate (§9.10); vapor uses index.html as-is
  present?: Present;                            // per-host visual encoding (§9.9); omit → no spatial layout
  assets?: Record<string, () => Promise<string>>; // import.meta.glob map keyed by name (frontier art)
}

export const ThemeRegistry: Record<ThemeId, ThemeDef> = { /* vapor, minimal, … */ };
export const FALLBACK: ThemeId = "minimal";     // slot fallback when a theme omits a slot AND base lacks it
```

> **`BASE` vs `FALLBACK`.** `BASE` is the new token-driven chrome module (its slots are the default
> implementations). `FALLBACK` names which *registered theme* is structurally closest to base for the rare
> case a future exotic theme omits a slot the base can't render generically — minimal, per the owner. In
> practice resolution is `registry[theme].slots[name] ?? BASE.slots[name]`; vapor never reaches it.
>
> **⏱️ BASE's slice: T1, not T0.** In **T0 only vapor is registered**, and vapor fills *every* slot, so the
> `?? BASE.slots[name]` fallback is **never hit** — T0 ships an **empty/stub `BASE`** (the resolution wiring +
> an empty slot map) and the `createContext` default points at it. The real **BASE token-driven chrome is
> built in T1** (with minimal). So `FALLBACK="minimal"` is also inert until T1 — fine, no T0 path reads it.

### 9.4 Slot resolution — context, no prop-drilling

> **⛔ SUPERSEDED by §14 (the D29 Root+Kit architecture) — kept for rationale/history; §14.9 maps what survived.** `useThemeSlot` was deleted.

`ThemeProvider` (new) reads `ui.{theme,mode,accent}`, ensures the active theme's CSS+fonts are loaded
(suspends on first switch via a small resource cache), and exposes the resolved slot set through context.
`createContext` default = the BASE slots (the documented fallback mechanism). Components call
`useThemeSlot("FleetView")`. `App.tsx` becomes the **slot host**: it renders `<Slots.AppBar/>`,
`<Slots.FleetView active=…/>`, etc. instead of the hardcoded tree.

> **App.tsx changes; vapor *components* + `vapor.css` do not.** The shell orchestration becoming
> slot-driven is core-infra work, not a vapor edit. vapor's slots point at the existing
> `AppBar`/`FleetTab`/`Composer`/… unchanged, so **vapor renders byte-for-byte identically** (the T0
> acceptance test). "vapor frozen" = its visual components + `vapor.css` are untouched; the shell that hosts
> them generalizes.

### 9.5 Slot list — shared chrome vs theme-overridable (the exact split)

> **⛔ SUPERSEDED by §14 (the D29 Root+Kit architecture) — kept for rationale/history; §14.9 maps what survived.** *(The per-theme design intent captured in this table — e.g. frontier's map+beacons Fleet + bottom-sheet HostDetail — survives as design input; the slot mechanism does not.)*

| Slot | Owner | Notes |
|---|---|---|
| AppBar, Composer, TabBar, TabIndicator, ConfShell + rows, ChatBubble | **BASE** (token-styled) | Themes restyle via tokens, not structure. vapor keeps its own (frozen). |
| **FleetView** | **theme** (the signature) | base = device rows (minimal/phosphor/observatory-list). cosmos = orbital; frontier = map+beacons+rig-grid; observatory = SVG topology FleetView variant. |
| **HostDetail** | base default; theme override | base = inline expandable body (stats grid + action bar + services). frontier = **bottom sheet**; cosmos = **slide panel**. The stats/actions/services *contents* are shared sub-components. |
| **NowMonitoring** (featured host + live Waveform) | **BASE shared slot** | The auto-cycling featured card recurs in minimal/cosmos/frontier — built once, themes style via tokens. vapor stays on its own `Hero` (untouched). |
| Hero | vapor-only | vapor's animated sun/grid/skyline scene; non-vapor themes use NowMonitoring or nothing. |

### 9.6 CSS strategy — per-theme bundle, `[data-skin]`-scoped, lazy, **isolated by CSS `@layer`**

> **⚠️ Corrected by the final review (§13).** The isolation mechanism is **CSS Cascade Layers**, and the
> theme-identity attribute is **`data-skin`**, NOT `data-theme` (at the time vapor's frozen accent axis;
> **that axis is RETIRED since D51 V2, 2026-08-01** — vapor's accent rides the shared `data-accent`). The
> earlier "scope under `[data-theme]` + rely on specificity" idea is superseded — see §13.1–13.3.

**Chosen (web-cited):** per-theme **plain `.css`** bundles, **dynamic-`import()`'d** (Vite `cssCodeSplit`
extracts each to its own `<link>`, guaranteed loaded before the chunk evaluates → no FOUC *in the prod build*),
each **scoped under `body[data-skin="x"]`** and **assigned to a CSS `@layer`**. Rejected: CSS Modules /
CSS-in-JS (both rename selectors → *increase* drift from the hand-built prototype; CSS-in-JS additionally in
maintenance mode + RSC-hostile). vanilla-extract noted as a later graduation path only.

- **vapor.css + extras.css stay always-loaded — but caged in a low-priority `@layer`.** Replace `main.tsx`'s
  two JS `import` lines with a `theme/index.css` that does, **without editing the frozen files**:
  ```css
  @layer frozen, base, theme;          /* declare order: later layers win for NORMAL declarations */
  @import "./vapor.css"  layer(frozen);
  @import "./extras.css" layer(frozen);   /* extras AFTER vapor, SAME layer — preserves their internal cascade */
  ```
  The BASE chrome CSS goes in `layer(base)`; each non-vapor theme's bundle in `layer(theme)`. Because a later
  layer beats an earlier one for normal declarations, an active theme's tokens + rules **win over vapor's
  always-loaded `:root` and global classes by cascade ORDER, not specificity** — this dissolves both the
  token-name collision (`--line`/`--line-2`/`--accent-glow`, §13.2) and the global class-name collision
  (`.appbar`/`.composer`/…, §13.3) **without renaming anything in the frozen files**. (`!important` audit:
  only **4** important rules exist across both files, all on vapor-only selectors — `[data-theme=aqua/ember]
  .hero`, `.dev.off .eq i`, the `data-motion` kill — so none can outrank a separately-namespaced theme. Safe.)
- **Belt-and-suspenders namespacing.** BASE/non-vapor chrome still uses a **disjoint class namespace** (a
  `cb-` prefix, e.g. `.cb-appbar`) so it never matches vapor's global rules even if `@layer` were unavailable.
  Layer + namespace is the robust pair.
- **vapor's internal cascade is unchanged** (vapor + extras in one layer, same order as today; vapor is the
  only sheet rendering when active — non-vapor bundles are lazy/not loaded). **T0 must verify `vite build`
  preserves `@import … layer()`** (Lightning CSS / postcss-import) — if it strips the token, the fallback is
  **both** `cb-` namespacing (for the global *class* collisions) **and** renaming the 3 colliding contract
  tokens (`--line→--border`, `--line-2→--border-2`, `--accent-glow→--glow`, §13.2 — namespacing alone does
  NOT fix the *variable* inheritance). First T0 task.
- **Switch lifecycle / FOUC:** rely on Vite's prod guarantee **and** React 19's native stylesheet handling —
  render the theme's lazy `<link rel="stylesheet" precedence>` (React blocks the reveal until it loads) /
  `preinit`, inside a `startTransition` so the old theme stays visible until the new CSS+components are ready
  (no Suspense-fallback flash). Verify with `vite build && vite preview`, **not** `vite dev` (dev always
  FOUCs). Keep `cssCodeSplit:true`; never set `build.modulePreload:false` (boolean form silently breaks lazy
  CSS). Inactive bundles' `<link>`s are left in place (inert under `[data-skin]` scoping) — teardown deferred.

### 9.7 Token contract (semantic) — **NEW code for non-vapor themes only**

Every theme consumes a **fixed semantic contract**; each theme's `tokens.css` maps it. ~~**vapor
does NOT adopt this** (frozen — it keeps `--magenta`/`--violet`/`--accent-grad`).~~ **AMENDED at D51 V3
(2026-08-02): the vapor exemption is GONE.** `themes/vapor/tokens.css` maps vapor's private vocabulary
(`--magenta`/`--ink*`/…, which still exist as its *raw* tier) onto the full contract, and the
`semantic-tokens` waiver was retired — so **all five registered themes map this contract with no waiver**
(conformance: `themeContract.test.ts`'s token-list group, `TOKENS_RAW` = minimal/cosmos/frontier/vapor/gacha).
Contract (superset distilled
from the prototypes):

```
--surface, --surface-2          surfaces (bg ladder)
--text, --text-2, --text-3      text ladder
--line, --line-2                borders/hairlines
--ok, --warn, --danger          status (+ -soft alpha variants)
--accent                        a TRUE <color> (for color/border/fill-as-solid)
--accent-fill                   flat-or-gradient, consumed ONLY via background/background-image
--accent-ink                    ink (text/icon) on accent-fill surfaces; base fallback var(--bg); light-mode themes MUST set it explicitly (WCAG 4.5:1 vs --accent-fill)
--accent-soft                   low-alpha accent (color-mix or alpha channel)
--accent-glow                   optional box/drop-shadow layer (phosphor text-shadow, cosmos blur)
--radius, --radius-sm           shape
```

> **The flat-vs-gradient accent problem (web-cited).** A gradient is a CSS `<image>`, not a `<color>`, so a
> single `--accent` can't be both. **Two channels:** `--accent` is always a real color (minimal/phosphor set
> it flat); `--accent-fill` is what backgrounds use (a theme may set it to the same color or to a gradient);
> a `::before`/overlay reads `--accent-glow` for the uniform glow escape hatch. Components consume the three
> uniformly and never know whether the theme is flat or gradient.

**Accent matrix (minimal's mode×4-hue):** generate in **OKLCH** (perceptually uniform; ~90% support, fine for
the owner's Android), tints/shades/alpha via `color-mix(in oklch, …)`. minimal's 4 hues = 4 accent swatches
(fixed L/C, varied H); phosphor's amber/green = 2 **named** accents; cosmos/frontier = 4 named swatches.

### 9.8 Palette model + `ui` store change

`ui` store: `{ theme: ThemeId }` generalizes to `{ theme: ThemeId; mode: Mode; accent: string }`.
*(As-built + D51 V2, 2026-08-01:)* **`applyBodyAttrs` writes the identity attribute
`html[data-skin] = theme`** (on `<html>` — the `@scope` identity) **plus the shared
`body[data-mode]`/`body[data-accent]` axes for EVERY skin** — vapor included since D51 V2 retired
its private `body[data-theme]` accent axis (values unchanged: `dark` inert / `aqua` / `ember`, now
as `data-accent`; the retired attr is defensively `delete`d on every apply). (`mode` and the vapor
accent named "dark" are *different axes* that coincidentally share the string "dark" — benign:
vapor declares no `mode` axis, its stamped `data-mode="dark"` matches no rule.) Themes may inject
`--accent`/`--accent-fill` for computed-OKLCH accents. `ThemeDef.palettes` declares which axes the
Conf picker renders (vapor → named accents only; minimal → mode toggle + 4 hues; phosphor → amber/green; etc.).
Existing vapor attrs (`data-skyline`/`data-loz`/`data-tab`; `data-motion` is shared) keep their
current meaning until their D51 ledger slice — vapor's frozen attribute contract, §13.1
(`data-theme` RETIRED at D51 V2 → the shared `data-accent` axis).

> **Note — a trivial one-time persisted-shape remap (single user, low-stakes).** The persisted field splits
> from one conflated `theme:"dark"|"aqua"|"ember"` into `{theme,accent}`. `loadPersisted` only *fills missing
> fields* (`{...defaults, ...parsed}`), so the owner's own existing `localStorage["ctrlb.ui"]` (e.g.
> `{theme:"aqua"}`) would otherwise read back as an invalid `ThemeId`. A ~3-line read-time remap before the
> registry reads state handles it: legacy `theme ∈ {dark,aqua,ember}` → `{theme:"vapor", mode:"dark", accent:
> theme==="dark" ? <vapor default> : theme}`. (No returning-user base to protect — it's just so the owner's own
> devices don't reset on the update. Bumping the persist key would also work but loses the other UI prefs;
> the remap is cleaner.)

### 9.9 Per-host presentation layer (researched + locked)

**Pattern (web-cited; Presenter/View-Model + data-viz encoding-channel + extend-not-migrate):** a pure,
**theme-owned** function derives every visual from neutral core fields; optional hand-authored overrides live
in **one namespaced object** on the host; the backend stores that object as **open pass-through** (the theme
owns the schema, client-side).

```ts
// VisualEncoding — the neutral output contract (data-viz "channels": position/size/color/shape/angle).
interface VisualEncoding {
  position?: { x: number; y: number } | { angle: number; radius: number };
  size?: number; color?: string; symbol?: string; asset?: string;
  motion?: { speed: number; angle: number };
  [k: string]: unknown;                          // open — theme-specific extras
}
type Present = (host: Host, index: number, override?: Record<string, unknown>) => VisualEncoding;
```

- **Zero-config default:** derive deterministically — **golden-angle placement** (`angle = index·137.5°`,
  `radius = c·√index`, even distribution, no spokes) for orbital/topology; **`palette[hash(host.id) % n]`** for
  color; modulo-into-curated-set for symbol/art. Stable across reloads (the id *is* the state; nothing saved).
- **Optional override:** **one** additive optional field on the host — `appearance: { <themeId>: { …blob } }`
  — extended by adding a key, **never** a sibling map per theme (the named anti-pattern; CLAUDE.md "extend,
  not migrate"; corroborated by OpenAPI `x-` extensions + K8s annotations). A present() shallow-merges
  `override` over the derived channels.
- **Backend — open pass-through, `dict[str, dict[str, Any]]`** (no per-theme Pydantic union — a union forces a
  server change per new theme = the migration we forbid; validate only keys the server reads = none today,
  unknown theme keys round-trip untouched). **Scope (the full round-trip, so the build knows all sites):**
  - **DAY 1 (T0) — settle the persisted schema only:** add `appearance: dict[str,dict[str,Any]] = {}` to the
    **config-side host model (`ComputerCfg` in `backend/app/config.py`)**. That fixes the YAML shape so there's
    never a migration. *(That's the only day-1 backend host change — the rest below is additive, not a refactor,
    so it lands when first consumed.)*
  - **T3/T5 (when a spatial theme first reads/authors it) — additive read+write wiring:** carry it onto the
    runtime `Host` (`domain/host.py`) + the `Settings.hosts()` builder (`config.py`, currently hand-builds each
    `Host` → would drop the key); expose it in the public host DTO (`_host_dto`, `api/hosts.py` — a hand-written
    dict); and for *authoring* overrides, carry it through `HostIn` + `_apply_fields` (`api/hosts.py`). Each is a
    one-line additive add against the already-fixed field shape — **not** a refactor.
- **frontier art (spec'd now, owner 2026-06-26 — no deferred half):** `ThemeDef.assets` =
  `import.meta.glob('./frontier/art/*.png', { query:'?url' })`; `present()` assigns `asset = artKeys[index %
  artKeys.length]` as the zero-config default **and** honors an optional per-host override
  `host.appearance.frontier.image` — **both built in T5** (the override rides the open `appearance` blob, so
  it's additive, not a later refactor).

### 9.10 Fonts + assets (no first-paint hit)

- **Fonts inert until active:** each non-vapor theme's `@font-face` lives in its scoped lazy bundle (browser
  downloads a webfont only when a rendered node uses it — an inactive theme costs nothing). On activation,
  `ThemeDef.loadFonts()` uses the **FontFace API** (`new FontFace(...).load()` → `document.fonts.add`) and
  awaits `loaded` before the theme paints, avoiding a swap flash; `font-display: swap` + a metric-adjusted
  fallback otherwise. **Self-host via Fontsource** (npm, version-pinned) rather than the Google CDN
  `<link>`. ~~vapor keeps its current `index.html` `<link>` (frozen).~~ **As-built: vapor is self-hosted
  too** — `themes/vapor/vapor-fonts.css` (`@fontsource` `@import`s, latin + latin-ext only), statically
  imported from `main.tsx` because vapor's CSS is EAGER; `index.html` carries no font `<link>` at all
  (only a comment recording that). The lazy themes keep the dynamic-import `fonts.ts` shape.
- **Assets:** per-theme images via lazy **`import.meta.glob`** (each match → own hashed chunk); index a glob
  of `./<theme>/assets/*` by name at runtime. The frontier art (`rig1..6.png`, `hero.png`, etc. — currently
  in `prototypes/project/assets/`) is **copied** into the theme module on port (not imported from prototypes).

### 9.11 Persistence + cross-device sync — **BUILT DAY 1** (owner 2026-06-26: no deferred seam; full feature now)

Web-researched (TanStack Query persistence/optimistic docs, offline-first SWR, next-themes no-FOUC). **Model:
backend is the source of truth on read; server-stamped last-write-wins on write; localStorage is the instant
cache + offline truth.** For a single user this is the robust-simple shape — **no CRDT, no client clocks, no
ETag/412, no Background Sync** (all over-engineering for one writer behind one authoritative backend).

- **Backend.** A **typed `AppearanceCfg(BaseModel){theme:str; mode:str; accent:str; updated_at:datetime|None}`**
  block on the Settings config (`backend/app/config.py`) — typed, **not** `extra="allow"` (small known shape;
  the owner wants robust). Edited via the existing `PUT /api/settings` deep-merge (same path every setting uses;
  additive). The server stamps `updated_at` on write (its own clock → no cross-device skew).
- **⚠️ The full settings doc is Conf-tab-scoped** (`useSettings` = `useScopedQuery("conf", …)`, won't fetch on
  Fleet/Agent), so it **cannot** drive first-paint or cross-device reconcile. Add a **lightweight always-on
  read** — **`GET /api/appearance`** (mount it in the existing settings router, `backend/app/api/settings.py`,
  beside `GET/PUT /api/settings`) → just `{theme,mode,accent,updated_at}` — read by a small **`useAppearance()`
  query hook (a plain `useQuery`, NOT `useScopedQuery` — it must fetch on mount regardless of the active tab)**;
  the `ui` store reconciles against it (compare-then-set). Writes still go through the Conf picker's
  `PUT /api/settings {appearance}` (the picker lives in Conf where the settings doc is loaded).
- **Load sequence (no-flash).** *(Original design text — as built, `data-skin` moved to `<html>` (§10
  AS-BUILT) and since D51 V2 the script stamps the shared `data-mode`/`data-accent` for every skin; the
  `data-theme` mention below is the retired vapor axis.)* (1) An **inline script at the TOP of `<body>`**
  (NOT `<head>` — `document.body`
  is null there; a script at the start of `<body>` runs with `body` present, before `#root` paints) reads
  `localStorage["ctrlb.ui"]` and sets **`body[data-skin]`/`data-theme`/`data-mode`** — keeping the attrs on
  `body` so vapor's existing `body[data-*]` selectors + the §10 `body[data-skin="x"]` scoping stay consistent.
  (Set `index.html`'s static initial to `data-skin="vapor"` too.) This kills FOUC tighter than the current
  end-of-body module-load apply. (2) React + the `ui` store hydrate from localStorage (instant). (3) The
  always-on `GET /api/appearance` resolves
  → **compare-then-set**: apply the server value **only if it differs** from the applied one (a matching value
  never re-switches → no visible flash). Fresh device (no localStorage) = one switch from default → server
  value, unavoidable + correct.
- **Write path.** Conf picker change → `setUI()` (instant localStorage + `applyBodyAttrs`, the existing
  synchronous path) **+** an optimistic `PUT /api/settings {appearance}` via `useSaveSettings` with a mutation
  **`scope:{id:"settings"}`** so rapid toggles serialize in order; `onError` rolls back, `onSettled`
  invalidates. The PUT is idempotent (full deep-merge patch) so a retry/duplicate is harmless.
- **Offline.** localStorage is the truth; the PUT **pauses and auto-resumes on reconnect** (TanStack
  `networkMode:"online"` default). No service-worker Background Sync (not on iOS/FF; unnecessary here).
- **Conflict.** Two devices change the theme → backend LWW (server-stamped); the other device reconciles on
  its next mount/refocus refetch. `updated_at` is carried so a future "detect simultaneous write" check is
  additive — but no conflict UI is built (cosmetic pref, not worth it).

### 9.12 Theme-switch animation (View Transitions API) — **BUILT DAY 1** (owner 2026-06-26)

Web-researched. Same-document View Transitions is **Baseline 2025** (Chrome 111 / Safari 18 / Firefox 144 —
fully covers the owner's modern Android+desktop); progressive-enhancement (no support → instant swap). Locked
pattern (the **stable `flushSync` form**, NOT React's experimental `<ViewTransition>` Canary component):

```ts
async function switchTheme(next: ThemeId, mode, accent) {
  try { await ensureThemeLoaded(next); }         // 1. SLOW WORK FIRST (lazy import CSS+slots) — never inside the callback
  catch (e) { pushToast("theme failed to load", "err"); return; }  // load failure → abort, stay on current theme
  const apply = () => flushSync(() => setUI({ theme: next, mode, accent }));   // synchronous DOM commit
  if (uiMotion === "reduced" || !document.startViewTransition) return void apply();  // 2. gate on the app's motion flag + support
  const t = document.startViewTransition(apply); // 3. default full-page cross-fade (name nothing)
  t.ready.catch(() => {});                        // 4. swallow the skip/TimeoutError (DOM already applied)
}
```

Rationale + the traps it avoids: the lazy `import()` happens **before** `startViewTransition` (the page is
frozen during the callback; network work inside it risks the ~4s skip); `flushSync` forces React's commit
**inside** the snapshot window (without it the old DOM is captured as both before+after → no animation); the
switch is gated on the app's **`ui.motion`** setting (not the OS media query — CLAUDE.md), so the default
cross-fade can't leak through under reduced-motion (gating the JS call beats `::view-transition-*` CSS that
only sees the OS query); no `view-transition-name`s (a theme swap is a whole-page cross-fade — naming elements
only adds cost + a duplicate-name skip footgun). `ensureThemeLoaded` must confirm the **CSS is applied before
the `flushSync`** (await the dynamic `import()` of the CSS module) or the old snapshot captures an unstyled
frame. Leave a seam to migrate to React's native `<ViewTransition>` when it leaves Canary.

### 9.13 Files that change (the vapor-safe touch list)

> **⛔ SUPERSEDED by §14 (the D29 Root+Kit architecture) — kept for rationale/history; §14.9 maps what survived.** (a T0-era touch list — the as-built file map is §14 + the code.)

| File | Change | Vapor-safe? |
|---|---|---|
| `theme-engine/` (new dir) | registry, types, `ThemeProvider`, `useThemeSlot`, BASE chrome, per-theme modules, the `switchTheme` View-Transition path (§9.12) | additive |
| `store/ui.ts` | `{theme}`→`{theme,mode,accent}`; `applyBodyAttrs` sets **`data-skin`** (+ `data-mode`/`data-accent` for non-vapor; `data-theme` stays vapor's accent); **dedicated legacy-`theme` migration** (§13.1, §13.4); reconcile-on-mount against `GET /api/appearance` (compare-then-set, §9.11) | extends, no vapor edit |
| `App.tsx` | becomes the **slot host** (renders resolved slots; preserves shell orchestration §13.6) | shell infra; vapor renders identically |
| `main.tsx` | `vapor.css`/`extras.css` → layered via `theme/index.css` (§9.6); mount `<ThemeProvider>` | additive, no vapor edit |
| `index.html` | **inline no-FOUC script at the TOP of `<body>`** (read `localStorage["ctrlb.ui"]` → set `body[data-skin/data-theme/data-mode]` pre-paint, §9.11; `<head>` can't — `body` is null); static initial `data-skin="vapor"`; vapor fonts stay; non-vapor fonts via FontFace | additive (keeps vapor default) |
| `tabs/ConfTab.tsx` | Appearance group: `Seg<Theme>` → theme picker + declared-axis mode/accent controls; writes `setUI` + optimistic `PUT /api/settings {appearance}` (§9.11) | extends the picker |
| `config.py` (backend) | typed **`AppearanceCfg{theme,mode,accent,updated_at}`** Settings block (server-stamped) — **day 1** (§9.11); **+ `ComputerCfg.appearance: dict[str,dict[str,Any]]={}`** per-host override (schema only, §9.9) — **day 1** | additive optional |
| `api/settings.py` (backend) | **`GET /api/appearance`** lightweight always-on read beside `GET/PUT /api/settings` — **day 1** | additive endpoint |
| `hooks/useAppearance.ts` (new) | small always-on `useQuery` (NOT Conf-scoped) feeding the `ui`-store reconcile | additive |
| `domain/host.py` · `api/hosts.py` | carry `appearance` onto runtime `Host` + `Settings.hosts()` builder + `_host_dto` (read) + `HostIn`/`_apply_fields` (authoring) — **additive at T3/T5 when first consumed** (§9.9), not day-1 | additive, not a refactor |
| `theme/vapor.css`, `theme/extras.css`, `theme/heroScene.ts`, all vapor components | **untouched (D7)** — only caged in `layer(frozen)` via `theme/index.css`, no edit | ✅ frozen |

## 10. Prototype → theme-module porting playbook — ✏️ REWRITTEN AS-BUILT 2026-07-06 (final review, D34)

> The original §10 described the superseded T0 slot model (`theme-engine/<theme>/`, `<Theme>FleetView.tsx`
> slots, `body[data-skin]` selector wrapping). This rewrite matches the **as-built §14 Root model** —
> §14.4.1's recipe is the canonical short form; this is the fuller playbook. The drift-minimizing convention
> is unchanged (verbatim plain CSS + 1:1 JSX keeps re-sync mechanical). **Goal: editing a prototype HTML
> later and re-porting is a near-mechanical diff, not a rewrite.**

1. **Create the module dir:** `frontend/src/themes/<id>/` → `index.tsx` (the `ThemeDef`: `Root`, `palettes`,
   `loadStyles`, optional `loadFonts`/`loadRoot`/`settings`/`present`/`assets`), `tokens.css`, optional
   `<Id>Root.tsx` + bespoke components (spatial themes), `fonts.ts` (Fontsource imports + FontFace await),
   `assets/`. **Reskin theme** → `Root` = a thin wrapper rendering `<DefaultRoot …/>`; **bespoke theme** →
   your own Root (opt into Kit pieces by adding the `.kit` marker yourself).
2. **CSS — copy verbatim, scope + layer it.** Lift the prototype's `<style>` block **unchanged** into
   `tokens.css` as `@layer theme { @scope ([data-skin="<id>"]) { … } }` (a lazy import must self-declare
   BOTH). The gotchas, all empirically earned: `:root` → **`:scope`** (scoped selectors match descendants,
   not the root); page background on `:scope, body`; mode/accent/density axes on `body[data-*]`;
   **formula-derived tokens on `body`, not `:scope`** (§14.4.1 var()-trap); **prefix every `@keyframes` with
   `<id>-`** (§14.13 #4 — names are global; bundles coexist mid-switch); reference the pre-declared
   **`@layer theme` ONLY — never introduce a NEW top-level layer name** in a lazy sheet (first-declaration
   order would append it AFTER `reset` and outrank the user-select reset); **`@font-face` at top level only**
   (Fontsource import / FontFace API) — inside `@scope` it is invalid and silently dropped. Map the
   prototype's `:root` vars onto the semantic contract (§9.7/§14.13 #1) at the top; keep the theme's own
   extra vars as-is; don't rename prototype classes or re-derive colors.
3. **JSX — 1:1 with the prototype markup.** Port the prototype's DOM into your Fleet view / bespoke Root with
   the **same tree + same class strings** (transform.tools/html-to-jsx for the mechanical pass). Replace the
   hardcoded `DEVICES`/`RIGS` arrays with the real controller hooks (`useFleet()` etc.); replace inline
   visual fields with `present(host, index, host.appearance?.[id])`. **Preserve the structural measurement
   hooks** (§14.15.1 item 8): the scroller is `#app-scroll`, the composer root `#composer`/`.kit-composer`,
   the appbar `.kit-appbar` — the contract test asserts them.
4. **Animation — rAF/canvas logic into a `useEffect`** keyed to the data, gated by `ui.motion` (never a
   second OS `prefers-reduced-motion` branch — §14.11); heavy effects behind `data-perf`. Cap ~30fps, pause
   off-screen/hidden, no per-frame layout reads. Effects must clean up (StrictMode double-invoke).
5. **Keep dynamic React to a thin wrapper.** Avoid inline `style=` (hardest to re-port); keep styling in
   `tokens.css`. Confine `{…}` injection to data points (host list, status, ping).
6. **Register:** one row in `theme-engine/registry.ts`. The Conf Appearance picker auto-renders
   `palettes`/`settings`; `themeContract.test.ts` + the stylelint dir-overrides auto-cover the new module
   (§14.13.1 — coverage grows with the data, not with discipline).
7. **Re-sync workflow:** owner edits `prototypes/.../<id>.html` → re-run steps 2–3 as a diff against the
   committed module (CSS is a near-verbatim paste; JSX changes track the markup diff). Document any
   structural change in the module's header comment.

**Acceptance per theme (D7-per-theme):** open the module at 390px side-by-side with its prototype — visually
indistinguishable — **and smooth on Firefox/Fennec AND Chrome with all effects ON** (§14.11). vapor's
acceptance remains stricter: byte-for-byte unchanged vs today's build (until its §14.15 assimilation stages).

## 11. Validation verdict (final review, 2026-06-26)

Two adversarial streams ran before locking: a **design-vs-code review** (hunting for anything that breaks the
frozen vapor) and a **web-cited best-practice validation**. **Verdict: the architecture is sound and matches
2026 best practice** — registry+slots for structural divergence, plain `[data-skin]`-scoped lazy CSS,
semantic tokens with a two-channel accent + OKLCH/`color-mix`, and a `present()`+open-override per-host layer
are all the recommended options (not the expedient ones). No rethink needed. The review found **two
vapor-breaking bugs** and several robustness gaps in the *spec wording*, all corrected in §§9.6/9.8 and
consolidated as the build checklist in §13. The one external addition that materially hardens the design is
**CSS `@layer`** to cage the always-loaded frozen sheet by cascade order.

## 12. Patterns adopted from the validation (beyond the original spec)

- **CSS `@layer`** (Baseline since 2022, ~94%) — cage vapor/extras in `layer(frozen)`; isolation by cascade
  order, not specificity. The keystone hardening (§9.6, §13.2–13.3).
- **React 19 native stylesheet** (`<link rel="stylesheet" precedence>` / `preinit`) **inside `startTransition`**
  — framework-level FOUC/flash guarantee independent of the bundler; old theme stays visible until the new
  CSS+components are ready (§9.6, §13.5).
- **Module-level slot map (or stable-map-in-context + active-key-in-state)** — avoid context fan-out (a
  provider `value` change re-renders all consumers; `React.memo` doesn't shield them). The `?? BASE.slots`
  fallback already guards unknown keys (§13.6).
- **Same-document View Transitions API** (Baseline Oct 2025; progressive-enhancement) — **LOCKED day 1** for
  the theme-switch animation; full pattern §9.12.
- **Cross-device sync (config `appearance` block + `GET /api/appearance` + reconcile)** — **LOCKED day 1**;
  full pattern §9.11. (Both were "deferred seams" pre-review; owner pulled them forward 2026-06-26.)
- **Adopt where useful:** CSS **container queries** (`@container`, ~94%) for per-theme responsive fleet
  surfaces (adapt to container, not viewport — no per-theme media rewrites).
- **Within a theme:** `light-dark()` for the mode axis (pairs with OKLCH/`color-mix`); it only knows
  light/dark so it doesn't replace the skin switch.
- **Hold/deferred:** `@scope` (Firefox-146 floor; not encapsulation) — `@layer`+namespacing suffices;
  vanilla-extract / Panda (build-time tokens don't runtime-swap as cleanly as custom properties) — plain
  CSS + custom properties is the better fit; `<link>` teardown on switch (inert under scoping).

## 13. Final-review corrections — the T0 build checklist (LOCKED 2026-06-26)

> **⚠ Mixed epoch (labeled 2026-07-07).** §13.1 (the vapor frozen-attr table) is **live contract**;
> §13.2–§13.3 describe the `@layer` isolation **mechanism that §14.6 replaced with `@scope`** (the
> collision *rationale* still holds); §13.6 already carries its own superseded banner; the rest is
> historical build-notes.

Each item is a confirmed fix from the review; build T0/T1 against these, not the pre-review wording.

**13.1 — `data-skin` ≠ `data-theme` (CRITICAL — would break vapor).** *(HISTORICAL RATIONALE as of
D51 V2, 2026-08-01: `body[data-theme]` is RETIRED — vapor's accent now rides the SHARED
`body[data-accent]` axis like every theme, values unchanged (`dark` inert / `aqua` / `ember`), and
the `data-skin`-carries-ThemeId design this section forced remains exactly right. The row below is
struck; the remaining rows stay live contract until their D51 ledger slice.)* Original finding:
vapor.css gated its aqua/ember palettes on bare `[data-theme="aqua"|"ember"]`, so overloading
`data-theme` with the ThemeId would silently kill 2 of vapor's 3 palettes — hence the ThemeId on a
new dedicated skin attribute (as built: `html[data-skin]`, on `<html>`).
**vapor's attribute contract — ✅ CLOSED at D51 V6 (2026-08-02)**; every row has reached its final state
(plan §3.1). What is left is not "frozen", it is vapor's two live axes: `data-skyline` (Fleet decoration,
Root-written) and the two SHARED axes it never owned. CSS refs live in `themes/vapor/` since V1:

| Attribute | Element | Used for | Status |
|---|---|---|---|
| ~~`data-theme=aqua\|ember`~~ | body | vapor palette swap | **RETIRED D51 V2** → shared `data-accent` (vapor.css selectors flipped) |
| ~~`data-loz=ring`~~ | body | lozenge variant | **RETIRED D51 V4** → the `loz` setting drives `<VaporMark/>`, the kit AppBar's `brandMark` slot content, and the value is stamped on the MARK node (`.vapor-mark[data-loz]`), not on body |
| `data-skyline=city\|mountains` | body | skyline show/hide | live; **RULED at V3: Fleet decoration → `vapor-keeps`** (the Root-pinned VaporFleet keeps it — [`VAPOR_BANNER_LEDGER.md`](./VAPOR_BANNER_LEDGER.md) §2) |
| ~~`data-tab=…` on **`.tabbar`**~~ | `.tabbar` | tab indicator slide | **RETIRED D51 V4** — vapor renders the kit `KitNavBar`, which drives its own `.kit-tabbar[data-tab]` + `--tab-i`. The BODY `data-tab` stamp is unaffected: it is a shared axis (`store/ui.ts`), not vapor-private |
| `data-motion=reduced` | body | motion kill | live (shared UIState axis, not vapor-private) |

**13.2 — Token-name collision, solved by `@layer` (✅ CLOSED at D51 V3, 2026-08-01).** *As-built:* the
collision no longer exists — `themes/vapor/tokens.css` (V3) took over `--line`/`--line-2`, vapor's
`--accent-glow` (a `drop-shadow()` **filter**, the type-mismatched one) was renamed `--vapor-glow-filter`,
and vapor.css now declares **vapor-private names only**, pinned by
`tests/theme-engine/vaporAssimilation.test.ts`. Every contract name has exactly one home per theme. The
original analysis, for provenance: The contract reuses 3 names vapor
defines in its always-loaded `:scope` block: `--line`, `--line-2`, `--accent-glow` (vapor.css:24,25,31). Without
isolation, a theme that *forgets* to redefine one silently inherits vapor's value (pink `--line`, a
`drop-shadow()` where a `box-shadow` was meant). **`@layer` (§9.6) fixes it by cascade order** — vapor's
`:root` is in `layer(frozen)`, the active theme in a later layer → theme wins even at equal specificity. (If
the `@layer` build-verify fails, fall back: rename the 3 contract tokens disjoint — `--border`/`--border-2`/
`--glow`.) vapor defines **no** `--accent`/`--accent-fill`/`--accent-soft`/`--surface*`/`--text*`/`--ok`/
`--warn`/`--danger`/`--radius*` — the rest of the contract is already clean.

**13.3 — Global class-name collision, solved by `@layer` + namespace (CONFIRMED).** vapor/extras define a
large always-loaded global class surface (`.appbar .composer .tabbar .tab .dev .hero .now* .conf-card .b
.seg .switch …`) — exactly the chrome surfaces BASE re-creates. **Fix:** `@layer` (frozen loses to base/theme)
**plus** a disjoint `cb-` namespace on BASE/non-vapor chrome (belt-and-suspenders).

**13.4 — `ui` store needs a trivial one-time persisted-shape remap (low-stakes, single user).** See §9.8 —
remap legacy `theme ∈ {dark,aqua,ember}` before the registry reads it (`loadPersisted`'s field-fill merge
can't do value remapping). Not a robustness pillar — just so the owner's own existing localStorage doesn't
read back an invalid `ThemeId`. A ~3-line remap (or a persist-key bump, accepting the loss of other UI prefs).

**13.5 — FOUC defended at two levels (§9.6, §12).** Vite prod guarantee + React 19 `precedence`/`preinit` in
`startTransition`; verify with `vite build && vite preview`.

**13.6 — `App.tsx` slot-host must preserve shell orchestration (NEEDS-MITIGATION). ⚠️ SUPERSEDED by §14.1 —
there is no slot-host; the theme `Root` owns the shell (App is a thin host). Kept as design history; the
`--appbar-h` stable-ref and `TabDef.hasComposer` points survived into the Roots/`useSections`.** The slot list models
*surfaces*, not the shell machinery. Keep in App (render the resolved slot **inside** these):
- **Lazy ConfTab** — `confMounted` latch + idle `preloadConfTab` + `ErrorBoundary`→`Suspense`→lazy wrapper
  (App.tsx:46–49,109–121,132–138) stays; the `ConfShell` slot renders inside the Suspense boundary.
- **`--appbar-h` measurement** must target a **stable ref**, not `document.querySelector(".appbar")`
  (App.tsx:61) — BASE's AppBar is namespaced (`cb-appbar`), so the class selector would return null and the
  plan-pin silently uses its fallback offset.
- **`showComposer`** is hardcoded to tab ids in **both** App.tsx:123 **and** ui.ts:71 — move to a
  **`TabDef.hasComposer`** flag (the flexible-tab-registry requirement; D28 #4).
- **Tab containers + show/hide** — App still emits the `.tab`/`#tab-*`/`role=tabpanel`/`aria-labelledby`
  containers; non-vapor chrome currently leans on vapor.css's global `.tab{display:none}/.tab.active` rule —
  **BASE must own its own show/hide** (don't depend on the frozen sheet cross-theme).

**13.7 — Shared Waveform needs a contract canvas channel (CONFIRMED tension).** `Waveform.tsx:44` live-reads
`--accent-rgb`/`--accent-rgb-2` (rgb-triplet, for `rgba()` strings). The contract has no triplet. **Fix:** add
`--accent-rgb` as an explicit **canvas channel** in the contract; vapor keeps its own `Hero` waveform
(untouched), BASE `NowMonitoring` reads the contract `--accent-rgb`. (Extract the rAF draw as a
color-parameterized pure fn to avoid duplicating the loop.)

**13.8 — BASE TabBar indicator is count-driven, not vapor's CSS math (NEEDS-MITIGATION for flexible tabs).**
vapor's indicator hardcodes 4 tabs in CSS (`repeat(4,1fr)`, `width:25%`, `translateX(N*100%)` — vapor.css:243–
255) — fine for frozen vapor (always 4). **BASE's TabBar/TabIndicator computes `100/n%` width + `index*100%`
offset from `ThemeDef.tabs.length`** so a future non-4-tab theme works without touching the frozen sheet.

---

# §14 — REVISION 2 (LOCKED 2026-06-26): headless controllers + theme-owned `Root` + Kit (→DECISIONS D29)

> **Supersedes the fixed-slot model of §§9–13.** The owner clarified the real requirement: a theme must be able to
> **restructure / relocate / hide / add** any element (minimal hides the appbar; frontier's chat has animated squares)
> while **full functionality stays reachable**. A fixed 7-slot layout structurally can't do that. So ownership inverts:
> **the theme owns the whole presentation; the app owns functionality as headless controllers + shared state; an optional
> Kit supplies reusable token-driven presenters.** vapor is **migrated as a normal theme** (default until others verified),
> not frozen-and-separate. **Build against this section, not §§9.4–9.5/13.6 (the slot model).** What survives from T0:
> §14.9. Web-grounded: headless-component pattern (Radix/TanStack/Headless UI), theme-as-plugin (layout not just color),
> 3-tier design tokens, `@scope` (Baseline Dec 2025).

## 14.1 The four layers

```
1 CORE (unchanged)        hooks/* · store/* · api/client                         — theme-agnostic data/domain
2 CONTROLLERS (headless)  useFleet · useAgentChat · useComposer · useSections     — state+actions, NO markup,
        │                 · useAppChrome · useTools · useConf                        STORE-BACKED, mounted in App
3 THEME <Root>            owns the ENTIRE body; composes controllers + Kit +      — one per theme; the escape hatch
        │                 bespoke elements (hide/relocate/add anything)              AND the norm
4 KIT (optional reuse)    DefaultRoot · AppBar · NavBar · Composer · ConfShell ·  — token-driven presenters +
                          device rows · NowMonitoring · ChatBubble · primitives      the semantic token contract
```

`App.tsx` = thin host: providers + app-global effects (viewport `--app-h`, `beforeunload`) + global-overlay mounting +
`<ActiveTheme.Root/>`. Everything visual is below `Root`, owned by the theme.

## 14.2 Feature controllers (the stable contract)

One headless hook per functional area, returning `{ …state, …actions }`, **no JSX**. **Store-backed** (the D23
`createStore` pattern) for any state shared across instances or surviving a theme switch — NOT component `useState`.
Mounted in `App` (above `Root`). Initial set (extracted from today's components, behavior-preserving):

| Controller | Owns | Extracted from |
|---|---|---|
| `useFleet` | hosts/services (via existing hooks) + **featured/open/auto-cycle** | `FleetTab` local state → a fleet store |
| `useComposer` | input value, prefix routing (`!`/`/`/agent), inference mode, mic/dictation, submit | `Composer` |
| `useAgentChat` | messages, send, streaming/buffered, confirm-bubble suspend/resume, plan | `AgentTab` + chat store |
| `useSections` | active functional area + navigate + list (functional, not visual tabs) | `ui.tab` generalized |
| `useAppChrome` | TTS-auto, voice status, mini-player | `AppBar`/voice hooks |
| `useTools` / `useConf` | thin wrappers over existing registry/settings hooks | `UtilsTab`/`ConfTab` |

Controllers are the **capability catalog**: a theme that hides a control doesn't remove the capability — any presentation
can surface it. Document each controller's API (headless = the API IS the contract).

## 14.3 Theme contract (`ThemeDef` revised)

```ts
interface ThemeDef {
  id: ThemeId; label: string;
  Root: React.ComponentType;            // owns the whole presentation
  palettes: PaletteModel;               // §9.8 (kept) — mode/accent/named axes
  loadStyles: () => Promise<unknown>;   // §9.6 (kept) — lazy CSS; DEFAULT theme is eager (§14.6)
  loadFonts?: () => Promise<void>;      // §9.10 (kept)
  present?: Present;                    // §9.9 (kept) — per-host encoding (cosmos/frontier)
  settings?: ThemeSettingsSpec;         // NEW — theme-namespaced options (see below)
  loadRoot?: () => Promise<unknown>;    // as-built: the Root PRELOAD hook (themes assign the lazy
                                        // chunk's preload fn, which resolves void — `lazyRoot.ts`)
  assets?: Record<string, string>;      // as-built: import.meta.glob art map (frontier — §9.9)
  defaultLayout?: LayoutId;             // as-built (D35): the preset `ui.layout: "auto"` adopts (omit → 4-tab) — §14.17
  layouts?: LayoutId[];                 // as-built (D35): supported presets a pick is coerced into (omit → ALL) — §14.17
  media?: ThemeMedia;                   // as-built (D52 G5 / D53): the `/api/media/{ns}` namespace this theme's surfaces read
}
```

**Per-theme settings (the mechanism for a theme's OWN options).** A theme declares `settings` = a small schema +
defaults (e.g. minimal's `{ density: { type:"seg", label:"Density", options:[…], default:"comfortable" } }`).
*(The original example here was a per-theme `hideAppbar` switch — **it no longer exists**: hiding the bar
became the GLOBAL, device-local `ui.appbarMode` lever, and `stripLegacyAppbar` prunes the old key off every
load. §14.13 #11 owns that lever.)* The Appearance picker
auto-renders the active theme's settings; values live in an **open `ui.themeSettings[themeId]` map**, persisted +
**synced** via the appearance channel (extend `AppearanceCfg`, additive); read with `useThemeSetting(id, key)`. The
theme's `Root` reads them and reflows. **No app/core change to add a theme's bespoke option.**

## 14.4 The Kit (optional reuse) + token contract

`theme-engine/kit/` — token-driven presenters consuming the **semantic contract** (§9.7, three-tier: global → semantic →
component). **As-built inventory (the folder is the truth):** `DefaultRoot` (the standard appbar+nav+sections+composer
scaffold) · `AppBar` (`KitAppBar` + `KitTtsFlash`) · `NavBar` (`KitNavBar`, count-driven indicator §13.8) ·
`Fleet` (`KitFleet` — the default device list) · `KitBackground` + `ownerArt.ts` (the Kit Art System, below) ·
`ServiceIcon` · `composer/` (the variant catalog + `ThemedComposer` + the plan/tools/suggest families) ·
`axes.ts`/`axes.css` (§14.16) · `tokens.css`/`kit.css`.
*(The T0 wish-list this paragraph used to name — `ConfShell`, `NowMonitoring`, `ChatBubble`, `Field`/`Card` — was
never built: "build the Kit lazily-by-need" [§14.4.1 last bullet] held. And the shared primitives/surfaces that DO
exist are in **`components/`, not `kit/`** — `Seg` · `Switch` · `SettingRow` · `ConfGroup` · `ChatThread` ·
`NavMenu` · `BottomSheet` · `PlanSteps` · the Conf editors — app-wide components the Kit CSS styles under `.kit`.)*

**`DefaultRoot`'s props ARE the theme-facing seam — the complete list** (`kit/DefaultRoot.tsx` = truth):
`appbarMode` (structural; the global lever — §14.13 #11) · `bodies` (per-theme section-body overrides — §14.17) ·
`composerSlots` (the D30 addon axis) · **`brandMark` / `brandText` / `brandMeta`** (the three appbar brand SLOTS,
threaded to `KitAppBar` — the theme's leading mark [vapor's lozenge], its wordmark [gacha's katakana], its subtitle
[frontier's rig count, shown only while the synced `ui.appbarSubtitleVisible` switch is on]; omit any one and the
Kit's own default renders) · `kitBackground` (opt out of the shared art layer). There is **no `sections=` prop and
no `hideAppbar` prop** — cosmetic settings never reach here (they are token/`body[data-*]`-driven, e.g. minimal's
`density`).

**The Kit Art System behind `kitBackground`** (`kit/KitBackground.tsx` + `kit/ownerArt.ts`): the owner's shared art
out of the `kit` media namespace (D53) — one faded whole-app background image from `media/kit/background/`, plus the
namespace's other roles (service icons through `ServiceIcon`, service banners, machine pictures, the appbar brand
mark). The background layer is **mounted by the THEME, never by the registry or by CSS**: `DefaultRoot` renders it
by default, it is gated on the synced `ui.kitBackgroundVisible` field, and it emits no node at all when the folder is
empty (dormancy by absence). Opt-out rule: §14.13 #8.

**Reskin themes** (minimal) = `Root` is a thin wrapper rendering `<DefaultRoot/>` + a
`tokens.css` + fonts + optionally a Fleet body. **Bespoke themes** write their own `Root` — though since D51 V4
even `VaporRoot` is a wrapper (`<DefaultRoot appbarMode bodies={{ fleet: FleetTab }} brandMark/>`), so "bespoke"
now means bespoke *bodies* + CSS, not a hand-rolled shell. **The deep Conf
editors** (AgentsEditor/MachineEditor/Skills/Memory/Integrations/ToolCatalog) are **reused as-is and skinned by the
Kit/theme CSS** (their classes styled token-driven) — not re-authored per theme. Global overlays (toasts/confirm/prompt/
mini-player) become Kit/token-driven so they restyle per skin.

### 14.4.1 Locked CSS architecture — token-only reskins + a `.kit` marker (research-backed, K2 2026-06-27)

Web-researched against **Radix Themes** + the design-token consensus (Material/Open-Props/shadcn). The Kit is a
**token-driven component library**, NOT a per-theme override layer. This is the shape that keeps adding-a-theme cheap and
never leaks into vapor — **follow it for every future theme:**

- **Reskin themes contribute ONLY a `tokens.css`** (global→semantic values) — *zero* component CSS. "Adding a new theme
  is as simple as defining a new token set" is the explicit best practice; per-theme component-CSS overrides are the
  *discouraged, brittle* path (Angular Material warns exactly against it). minimal/phosphor/observatory = a token set +
  `DefaultRoot`.
- **One shared Kit stylesheet, scoped under a `.kit` marker** that `DefaultRoot` puts on its shell — this is precisely
  Radix Themes' `.radix-themes` root-class scoping. Kit CSS lives in **`@layer base`** as `.kit .confrow { … }` /
  `.kit-appbar { … }`, reading semantic tokens. The marker is what confines it: kit CSS applies exactly where a
  Root renders `.kit` — **since D51 V4 that includes vapor** (DefaultRoot hosting), whose `@layer theme` sheet
  wins any shared property while its remaining blocks await the V5 ladder. A bespoke Root without the marker
  gets no kit CSS at all — opt-in reuse.
- ~~**vapor = the bespoke escape hatch:** its own Root + its own CSS, no marker.~~ **AMENDED at D51 V4:**
  vapor's Root hosts `DefaultRoot`, so vapor renders the `.kit` marker like every other theme and kit.css
  applies to it. Its sheet (`themes/vapor/{vapor,extras}.css`, `@layer theme`, scoped `[data-skin="vapor"]`)
  is now a residual OVERRIDE layer over the kit — shrinking, per the V5 deletion ladder, to the Root-pinned
  VaporFleet + the brand mark. A bespoke theme is still entitled to structural CSS (§14.14); what D51 removed
  is the *duplicate chrome tree*.
- **Cascade layers order it:** `@layer base, theme` → a theme *may* override a Kit rule in `@layer theme` (the rare
  escape hatch), but the norm is token-only. **Component tokens** (`--kit-appbar-bg: var(--surface)`) are introduced
  only where a theme must diverge beyond what semantic tokens allow — never speculatively (YAGNI).
- **Build the Kit lazily-by-need:** only build a Kit component a theme actually consumes. (`NowMonitoring` + its live
  waveform are deferred until a theme renders a featured-host card — minimal dropped the monitoring section, vapor has
  its own Hero — so K2 skips them; they land in the slice of the first theme that needs them.)

> **⚠️ Gotcha — a derived (formula) token must be DECLARED where its inputs vary, not on `:scope` (the
> var()-on-html trap, caught in minimal 2026-06-27).** A `var()` formula is substituted at computed-value
> time on the element that *declares* the property. minimal's OKLCH accent is a formula over inputs
> (`--accent: oklch(var(--accent-l) var(--accent-c) var(--accent-h))`) whose inputs are overridden on
> `body[data-accent=…]` / `body[data-mode=…]`. Declared on `:scope` (= `<html>`), `--accent` computed
> **once** on `<html>` from `<html>`'s inputs and only *inherited* down — the body-level input overrides sat
> *below* the derivation, so switching accent/mode **never recolored** (the accent was frozen at the default
> hue). Fix: declare the **derived** tokens (`--accent`/`-fill`/`-soft`) on a `body { … }` rule (at/below
> where the axes are set) so each recomputes against the resolved inputs; keep the raw **inputs**
> (`--accent-l/-c/-h`) and the static semantic tokens on `:scope`. Rule of thumb: *raw values → `:scope`;
> any token whose value is a `var()` formula over a per-mode/per-accent input → `body`.* (A theme with flat,
> non-formula accents — a literal color per `data-accent` — is immune; this only bites formula accents.)

**Recipe — add a future reskin theme (zero app/core/backend change):**
1. `themes/<id>/tokens.css` — `@layer theme { @scope ([data-skin="<id>"]) { :scope { …semantic tokens… } body[data-mode=…] / body[data-accent=…] { …overrides… } } }`. (⚠️ tokens on `:scope`/`body`, mode/accent on `body[data-*]` — the §14.6 scope-root gotcha; **derived formula tokens must live on `body`, not `:scope`** — see the gotcha box above.)
2. `themes/<id>/index.tsx` — a `ThemeDef`: `Root` = a thin wrapper that reads the global chrome lever and renders `<DefaultRoot appbarMode={…} />`, adding only the props it actually needs from the complete list `appbarMode · bodies · composerSlots · brandMark · brandText · brandMeta · kitBackground` (§14.4 — STRUCTURAL choices are props; COSMETIC settings are a `body[data-*]` attr its `tokens.css` scopes, e.g. minimal's `data-density`). *(There is no `hideAppbar` prop — that per-theme switch became the global `ui.appbarMode`, §14.13 #11.)* Plus `palettes`; `loadStyles: () => import("./tokens.css")`; optional `loadFonts` (Fontsource, awaited via `document.fonts.load`); optional `settings`; optional `present` (spatial themes only); optional `defaultLayout`/`layouts` (§14.17) and `media` (§14.4's art system).
3. Register it in `theme-engine/registry.ts`. The Conf Appearance picker auto-renders its modes/accents/settings; `ThemeProvider` loads its lazy CSS/fonts on activation (and on cold-load if it's the persisted theme). Its Fleet view is the one surface it composes itself (from Kit `device-row`/`NowMonitoring` pieces); everything else is the shared Kit chrome + editors, skinned entirely by its tokens.

> **⚠️ The two-CSS-trees invariant — ✅ CLOSED at D51 V6 (2026-08-02). What is left is the LAW OF
> CO-APPLICATION, which is permanent and applies to every theme.**
> *Original (2026-07-06, D34):* the SHARED components — `tabs/AgentTab` (the whole chat), the Conf editors,
> the shared overlays — were styled by two INDEPENDENT trees, the Kit's (`kit/kit.css`, under `.kit`) and
> vapor's (`themes/vapor/{vapor,extras}.css`, under `[data-skin=vapor]`), only one of which could ever match
> — so a markup/class change had to update BOTH, and a missed tree left an unstyled-but-live element.
> **That duplicate tree no longer exists.** The V4 pivot put vapor inside `.kit` (so the sheets began to
> co-apply) and V5 deleted vapor's copy of every shared surface; at V6 vapor's residual CSS styles its own
> bespoke Fleet DOM plus a short, deliberate list of SHARED kit hooks (the `brandMark` lozenge, the
> plan-pin panel's geometry/paint, page chrome/scrollbars) — the §15 reskin route, not a duplicate.
> **A shared component's markup/class change now updates ONE tree, the kit's.**
>
> What survives as standing guidance, because it governs any theme that overrides a kit rule:
> - **A cascade layer wins PER PROPERTY, not per rule.** Where two sheets style the same element with
>   DIFFERENT properties, both apply. The V4 build hit exactly this: kit.css slides the `.switch` knob with
>   `transform: translateX(20px)` while vapor.css slid it with `left: 22px` — vapor won `left`, the kit's
>   `transform` still applied, and the knob moved TWICE, landing outside its 42px track on every Conf
>   toggle. Fixed by adopting one recipe. **When you add, edit or delete a theme rule, check what the kit
>   rule underneath it sets that the theme does NOT.**
> - **The same mechanism silently vetoes kit BEHAVIOUR.** A kit rule that repositions a shared overlay
>   contextually (`.kit:has(.tab.active .plan-pin-panel) .mini-player { top: … }`) lost to vapor's flat
>   `.mini-player { top: … }` in `@layer theme` — the overlay simply didn't yield. These are not render
>   errors; only the eyeball or the deletion finds them. (All three such repositioners came back at V5.)
> - **"The kit has an equivalent rule" is not sufficient grounds to delete a theme rule — check which
>   LAYER wins.** A kit rule in `@layer base` can sit under a *different*, surviving theme rule in
>   `@layer theme` (extras.css's wide-control wrap vs vapor.css's `.confrow .k { min-width: 0 }`), so
>   deleting the duplicate silently hands the property to the wrong declaration.

## 14.5 The core invariant — state ownership (prevents future refactors)

**All state that must (a) survive a theme switch or (b) be reachable by multiple parts of a presentation lives in a
controller/store mounted ABOVE the theme `Root`.** Never a theme component's `useState`. Consequence: switching theme
remounts only presentation — no refetch, no lost draft/featured/scroll, instant. (Today's offenders to lift: `FleetTab`
`featured`/`open`; agent scroll; any composer draft not already in the composer store.)

## 14.6 CSS isolation — `@scope` + `@layer` + eager-default

- **Skin isolation = `@scope ([data-skin=X]) { … }`** wrapping each theme's CSS (Baseline Dec 2025 — covers the owner's
  modern Android+desktop). Only the active skin's rules match; themes can't bleed even if bundles coexist during a switch.
  The prototypes share class names (`.composer/.seg/.switch/.device/.hero`), so scoping (not bare globals) is required.
- **AS-BUILT (M1):** `data-skin` lives on **`<html>`** (`documentElement`), so the scope is rooted at the document
  root — vapor's `:root`/`html,body`/page-background rules all sit inside the scope, and its `body[data-*]` accent/
  skyline/etc. rules match `<body>` as a descendant (the accent rules ride the shared `body[data-accent]` since
  D51 V2 — the private `data-theme` axis is retired). The sheet is wrapped **verbatim** in `@scope ([data-skin="vapor"])
  { … }` with only these scope-root selector edits (⚠️ **the critical gotcha — empirically caught in M1**: *scoped
  selectors match DESCENDANTS of the scope root, NOT the root itself*, so selectors targeting `<html>` silently don't
  apply unless they use `:scope`):
  - `:root` → **`:scope`** (defines the vars on `<html>` — they inherit down; `:root` would *not* match inside the scope).
  - `html, body` → **`:scope, body`** (so `<html>` keeps the page background/reset; bare `html` wouldn't match).
  - Bare `[data-theme=aqua|ember]` (the accent axis, on `<body>`) and all `.class`/`body[data-*]` rules are **descendants
    → unchanged**. `@keyframes`/`@media` stay inside the scope verbatim (the bundler preserves them — M1 gate).
  - **A theme's own `tokens.css` must use `:scope` (not `:root`) for its variable block** — same reason. (Porting playbook §10.)
  **Far lower risk than a PostCSS prefix** (research: prefix plugins *replace* `:root`, mis-prefix body-level same-element
  selectors, double-prefix `@keyframes`). Verified: vapor renders byte-identical (e2e asserts the computed page background).
- **`@layer base, theme`** still orders Kit-vs-theme overrides (theme wins). Composes with `@scope` (orthogonal: layer =
  cascade order, scope = which elements match).
- **One theme's CSS is eager** (static import → blocking `<link>`, no first-paint FOUC); others lazy (Vite
  guarantees async-chunk CSS before chunk eval). Inline `<body>`-top script sets `data-skin` early (T0, kept). A
  non-eager returning user gets **one** View-Transition switch on cold load (accepted; single user, PWA-cached).
  *(✏️ As-built since D51: the eager theme is **vapor**, and it is **no longer the default** — cosmos took
  `DEFAULT_THEME` at V0, and cosmos's CSS is lazy like everyone else's, so a FRESH boot now flashes browser
  canvas → kit base → cosmos, the accepted V0 trade. Vapor stays eager by the **V6 measurement ruling** — its
  whole slice is 5.3 KiB gz — not because it is the default.)*
- **M1 build-verify gate:** confirm the bundler preserves `@scope` (+ vapor byte-identical scoped) before scoping any
  other theme — mirrors T0's `@layer` gate.

## 14.7 Vapor migration runbook — verify at EVERY step (extra care: the only working theme)

Full suite (92 unit + 32 e2e) + 390px eyeball must stay green at each milestone; a regression is then isolated to one step.

- **M0 — shell inversion, vapor behavior untouched.** `App` → thin host (providers, `--app-h` viewport, `beforeunload`,
  overlay mounting) rendering `<VaporRoot/>`. `VaporRoot` = today's App body composing the **existing vapor components
  verbatim** (no controllers yet; move the layout-specific effects like `--appbar-h` into it). **Acceptance: byte-identical
  build** (same bar as T0). De-risks the inversion alone. *(The T0 slot resolution / `useThemeSlots` is removed here —
  App renders the theme `Root` directly.)*
- **M1 — `@scope` CSS-scoping gate.** Build/verify the scoping mechanism; scope `vapor.css` under `@scope([data-skin=
  vapor])`. **Acceptance: vapor renders byte-identical scoped** + `@scope` survives the bundler. Biggest vapor risk → own gate.
- **M2 — controller extraction, ONE feature per step.** Extract `useFleet`→`useComposer`→`useAgentChat`→`useSections`→
  `useAppChrome` (store-backed); migrate vapor's components to consume each, **verifying after each**. Behavior preserved
  by construction (logic relocated). Composer prefix-routing + agent tool-loop (confirm/resume/streaming) get extra
  scrutiny + targeted e2e. Lift `featured`/`open` into the fleet store here.
- **M3 — register vapor as a `ThemeDef`** (`Root=VaporRoot`, scoped CSS via `loadStyles`/eager, `palettes`=named accents,
  `settings` if any) + the per-theme settings mechanism. vapor is now a peer theme; default selection.
  - **✅ DONE 2026-06-26.** `ThemeDef.settings` schema (`ThemeSettingField`/`ThemeSettingsSpec`, the VS-Code
    `configuration` model) → open `ui.themeSettings[id]` map (`setThemeSetting`) → `useThemeSetting(id,key)`
    (`theme-engine/settings.ts`, override→declared default) → the Conf Appearance picker **auto-renders** the active
    theme's settings. vapor's `skyline/loz/heroOn/waveformOn` migrated into `vapor.settings` (VaporRoot owns the
    `body[data-skyline]/[data-loz]` write via a pre-paint `useLayoutEffect`; `migrateVaporSettings` folds the legacy
    localStorage shape). **`motion`+`perf` now sync** cross-device (owner directive) — folded additively into the LWW
    channel with the new `theme_settings` map (wire snake / store camel). **⚠️ Robustness rule learned:** ADDITIVE
    synced fields must default to **`None`/unseeded** on the backend, NOT to their UI defaults — a stamped pre-existing
    appearance doc would otherwise make them look *authored* and the LWW reconcile (`?? local`) would wipe local prefs
    on the first upgrade load (guarded by reconcile tests). **Latent T1 follow-up:** a self-initiated skin pick
    double-fires `switchTheme` (optimistic write re-reconciles during the async bundle-load) — unreachable while vapor
    is the only theme; gate on `useIsMutating` when the first non-vapor theme lands (commented in `useAppearanceSync`).

Only after M0–M3 green: build the Kit + minimal. **← M0–M3 are now all green; NEXT = Kit + minimal.**

## 14.8 Edge cases (locked)

| Concern | Resolution |
|---|---|
| Hide a control | Capability stays in its controller; another presentation can surface it |
| Relocate composer (keyboard) | `useKeyboardInsets`/viewport hook the theme `Root` opts into |
| Theme-specific anims (frontier) | Pure theme components; own effects/cleanup; `ui.motion`-gated |
| State across theme switch | Controllers above `Root` (§14.5) |
| Alt navigation (drawer/none) | `useSections` = active+navigate+list; theme renders nav freely |
| Lazy heavy section (Conf) | Lazy-section helper; preserves `confMounted`/Suspense |
| Broken theme `Root` | Root `ErrorBoundary` → fallback offers **revert to vapor** |
| Global overlays | Kit/token-driven, scoped to active skin |
| StrictMode double-invoke | Controllers + theme effects clean up (cycle interval, canvas rAF) |
| PWA offline switch | Lazy chunks in build manifest → workbox-precached; verify |
| Theme omits a section | `useSections` defaults active to first rendered |
| Per-host visuals | `present()` + open `appearance` blob (§9.9) |
| Theme-specific persisted option | `ui.themeSettings[id]` synced (§14.3) |
| First-paint FOUC | Default eager, others lazy + one VT switch (§14.6) |
| Add a future theme | `ThemeDef` + `Root` + scoped `tokens.css` + fonts + Fleet view; zero app/core/backend change |

## 14.9 What survives T0 vs replaced

**Survives unchanged:** `ThemeRegistry`, `ThemeProvider` (generalized to provide controllers/active-theme), `ui`-store
`{theme,mode,accent}` (+ `themeSettings` added), cross-device sync (`AppearanceCfg` + `GET /api/appearance` + reconcile),
View-Transition `switchTheme`, inline no-FOUC script, the `@layer` concept, the per-host `appearance` blob, the legacy-
`theme` remap. **Replaced:** `ThemeSlots` (7 slots) + `useThemeSlot` + App-as-slot-host → `Root` + controllers (the slot
idea survives *inside* the Kit's `DefaultRoot`). `theme/index.css`'s `layer(frozen)` cage → per-theme `@scope` + eager
default.

## 14.10 Build order (re-sliced)

M0 → M1 → M2 → M3 (vapor migrated, default) → **Kit + minimal** (token contract + `DefaultRoot` + per-theme settings +
minimal `tokens.css`/fonts/OKLCH matrix/Fleet, real data) → ~~**T2 phosphor** (tokens+fonts+CRT, reuses Kit)~~ → ~~**T3
observatory** (low-pri; FleetView + `present()`)~~ *(**T2 + T3 were never built and are CLOSED, not pending** —
the theme population closed on the owner's 2026-07-15 ruling; both stay declared in the `ThemeId` union only.
Anything below that cites phosphor/observatory as "the next theme" is historical.)* → **T4 cosmos** (own Fleet Root/orbital + slide-panel HostDetail +
`present()`) → **T5 frontier** (step 0 = the **tab-body registry** engine slice, ratified 2026-07-07 — §14.15.4; then own
Fleet + **bespoke Agent** anims + bottom-sheet + assets + `present()`). D7 per theme;
390px eyeball + pause after each. *(T-numbers are recipe labels, NOT gates — T4 shipped before
T2/T3, and T2 phosphor / T3 observatory do not gate T5; the cross-track interleave is pinned in
`TODO.md`'s header, 2026-07-07.)*

## 14.11 Cross-browser performance + robustness budget (RULE — every theme must pass) — owner directive 2026-06-26

The owner runs the PWA on **Firefox/Fennec AND Chrome** (Fennec is the mic-over-HTTP browser). Vapor was
built Chrome-first and shipped effects that are smooth on Blink but janky on Firefox-Android; the rules below
exist so **no future theme repeats that**. A theme is not "done" until it's **smooth on Firefox/Fennec *and*
Chrome at 390px with all effects ON** — that browser pair is part of the per-theme acceptance/eyeball pass,
not an afterthought.

**Animation — composite, don't repaint.** Continuous/ambient animations may only animate **`transform` and
`opacity`** (the compositor handles these on the GPU; Firefox-Android cannot composite anything else and
repaints every frame). **Never animate** `background-position`, `width`/`height`/`top`/`left`, `box-shadow`,
or `filter` in a loop. Convert: a scrolling texture → a `transform: translate` on a taller child (see the
neon-grid `:scope`/`.grid::before` precedent — 1:1 and GPU-cheap); a size pulse → `transform: scale`; a glow
pulse → animate `opacity` of a glow layer, not `box-shadow`/`filter`. Promote a continuously-animated element
with `will-change: transform` and bound its neighbours with `contain: layout` (or `paint`, if no glow
overflows the box — `paint` clips).

**`backdrop-filter: blur()` is the single heaviest effect on Firefox** (Mozilla rates CSS blur ~10× slower
than Chrome; a sticky/fixed blurred bar re-blurs the scrolling page every frame). Use it sparingly, don't
stack many blurred surfaces over the same scroll area, keep the radius modest, and **wire it to the `data-perf`
lever** — lite mode drops the blur (opaque fallback bg). Likewise gate all ambient animation behind
`data-motion`. **Both toggles (`body[data-motion]`, `body[data-perf]`) are part of the theme contract** — a
theme that adds blur/animation must honor them (store/ui `motion`/`perf`; **both sync cross-device** — owner
directive 2026-06-26, folded into the LWW appearance channel in M3 §14.3; the device-local, unsynced lever is
`appbarMode`). *(Corrected 2026-07-06 — this line previously said perf was device-local/not-synced, contradicting
the code; `useAppearance.ts` + `AppearanceCfg` are the source of truth.)*

**Engine-scoped degrades — `body[data-engine="gecko"]` (Gate B, 2026-07-15).** Some costs are Gecko-only
(WebRender re-blurs a transform-animated `backdrop-filter` per frame; `mix-blend-mode` on per-frame-moving
elements defeats its tile cache) while Chrome absorbs the same effect. When a fix would **trade visual
richness for smoothness**, scope the degrade to Gecko instead of degrading everyone: `src/lib/engine.ts`
detects Gecko via `CSS.supports("-moz-appearance", "none")` (a feature-check, NOT userAgent parsing) and
`main.tsx` stamps `body[data-engine="gecko"]` once at boot (static, pre-paint — not a React effect). This is
the frontend's first and only engine branch — run it like the backend's closed OS-branch allowlist
(ARCHITECTURE §6): a **closed, documented consumer list**, currently ONE (cosmos.css, Gate B 2026-07-15):
① the planet grain swaps `mix-blend-mode: overlay` → plain `normal` at lower alpha. *(A second consumer —
dropping the sheet's backdrop blur while it slides, via BottomSheet's `[data-settling]` stamp — was tried
and REVERTED the same day on owner eyeball: the frost pop-in at settle read worse than the slide chop it
cured. The stamp itself remains available; the attempt + alternatives are recorded in cosmos.css's
bs-sheet section — read that before re-attempting any sheet-slide degrade.)* Fixes with **no visual trade** (moving a
static glow off an animated element, deleting a paint-per-frame transition) stay UNIVERSAL — never fork two
code paths to preserve nothing. Every engine-scoped rule carries its revert path in an in-file comment; the
Playwright `firefox` project can assert these rules. Before adding a consumer, ask whether a universal
design change (frontier's opaque sheet — "a free Firefox win") does the job instead.

**Canvas / `requestAnimationFrame` loops** (waveforms, starfields, gacha's banner/agent motion): **drive EVERY
loop through the engine-owned `theme-engine/safeRafLoop.ts`** — this is a requirement, not a suggestion. An
unguarded `requestAnimationFrame(tick)` inside a theme is the anti-pattern the helper's own header names: a
React error boundary cannot catch a throw in a rAF callback (the tick fires outside render/commit), so a
faulting frame either kills the loop silently or errors once per frame forever. `safeRafLoop` wraps the tick in
try/catch, stops permanently on a throw (a LATCH — a later `start()` is a no-op, so an event-driven caller
can't resurrect a dead loop), leaves the last painted frame on screen, and routes the fault to `reportError()`
**once**. Six consumers today: cosmos (`camera.ts`, `CosmosStarfield`), vapor (`Waveform`), gacha
(`GachaBanner`, `GachaAgent`) + `App.tsx`. **`enforced by:` eslint** — `no-restricted-syntax` on
`CallExpression[callee.name="requestAnimationFrame"]` across `src/themes/**` (keyed to the CALL so a `typeof`
availability guard doesn't trip).
Then: cap the frame rate (~30fps is smooth
for ambient), **pause when not visible**, and
**never call `getComputedStyle`/`getBoundingClientRect` per frame** — cache them (refresh on a low cadence /
ResizeObserver). See `themes/vapor/Waveform.tsx` for the reference implementation (the per-host waveform:
IntersectionObserver gate + a cached rect + `safeRafLoop`).
*Pause mechanism — pick by the layer's nature:* an element that can genuinely scroll/tab out of view uses
**IntersectionObserver** (the tab stays mounted but `display:none`); a **persistent full-bleed** layer that is
either the whole page or nothing may instead gate on **`document.hidden` + `visibilitychange`** — deliberate in
`themes/cosmos/CosmosStarfield.tsx` (an IO on a viewport-sized fixed layer only ever reports "intersecting",
so it costs an observer to learn nothing; the real idle win is the backgrounded tab). Either way the loop must
stop when nothing can see it.

**SVG-filter waivers — a closed, owner-granted list, currently TWO (2026-08-07 gacha R19 · 2026-08-18 cosmos).** A per-element
SVG `filter` is an offscreen rasterization, the class this section budgets — so each use is a scoped waiver,
run like the engine-branch consumer list above. ① **gacha's carved fleet stars**: `filter: url(#gc-star-carve)`
on `.gc-card .rar .gc-star` **and the cover hero's `.cv-stars .gc-star`** (one GROUPED rule — still one
reference; the cover row joined at the E5 device round, owner finding: same row-on-artwork case as the card).
The def + full construction notes live in `GachaStar.tsx`. Owner-picked off the R19
candidate sheet (`design/prototypes/gacha/research-sheets/star-carved-candidates.html`, variant E) **with the
cost labeled on the sheet**; STATIC (never animated — the hard ban stays on filters in loops), star-sized
buffers (~14px, not surface-sized). The banked fallback if a device round finds fleet-scroll jank is the same
sheet's variant C — the identical carve as pure layered geometry; revert = swap the grouped fleet-star rule
(it names both rows), delete the def, strike this entry.
② **cosmos's carved moon button**: `filter="url(#cosmosCarve)"` on the moon path in
`themes/cosmos/CosmosMoon.tsx:72-88` — an inner-shadow deboss giving the Agent-chat button its recessed
floor. STATIC and ONE element, on a surface that neither scrolls nor animates the filtered node. **Shipped
since `735a852` and owner-RATIFIED 2026-08-18** (discovered retroactively by the engine-wide sweep below,
which is exactly the gap that sweep closes). Revert = flip the component to its already-present cutout/coin
branch (`:92-101`, pure gradient geometry) and strike this entry.

**Enforced by `tests/theme-engine/svgFilterWaivers.test.ts`**: it sweeps every `src/**/*.{css,ts,tsx}` for a
DIRECT LITERAL applied `url(#…)` filter (property or attribute spelling, bare or quoted fragment; a
runtime-assembled filter string is outside a lexical fence — a convention line, not a parseable gap) — comments stripped, so this prose can't satisfy it — and asserts the found set
EQUALS its `SVG_FILTER_WAIVERS` constant, occurrence for occurrence. `url(#…)` gradients and masks are
ordinary paint and are deliberately out of scope. Granting order: **owner ruling → a numbered ¶ here (def,
consumers, revert path) → the allowlist entry**. Widening the constant alone is not a grant.

**Layout robustness (any browser).** Text must never overflow its container horizontally. Long unbreakable
strings — backend errors, URLs, paths, JSON tokens, host/model/agent names — must wrap: put `overflow-wrap:
anywhere` on the text container (it's inherited and also shrinks min-content so flex items can't push past the
edge), and give flex text items `min-width: 0`. This is a recurring bug class (the chat-bubble error overflow,
the Conf label overflow); bake the wrap rule into any new text surface from the start. Keep the app's main
scroller `overflow-x: hidden` (a vertical-only scroller computes the x-axis to `auto` otherwise, so a stray-wide
child adds a horizontal scrollbar), and theme the scrollbars — thin + themed thumb **and** a transparent
`::-webkit-scrollbar-corner`, so Chrome's default light corner box never flashes against a dark theme.

**Gate motion on `data-motion`, NOT the raw OS `prefers-reduced-motion` query (cosmos C3, 2026-06-28).** The
app's Motion switch (`store/ui`) is the master lever: `defaultMotion()` SEEDS it from `prefers-reduced-motion`
(so reduced-motion users get `reduced` by default), but the switch lets a user turn it back ON. So gate
EVERY animation — ambient *and* one-shot interaction transitions (a sheet slide, a modal) — on
`body[data-motion="reduced"]`, never on a second `@media (prefers-reduced-motion: reduce)` rule. Keying off
the raw OS query is a bug: it ignores the in-app override, so an animation silently dies for a user who has
OS reduced-motion ON but app Motion `full` (the cosmos sheet "wouldn't slide" — orbit gated on `data-motion`
animated, the sheet gated on the OS query did not). One signal, user-overridable, app-wide.

**Spatial-theme camera math: DERIVE per render, don't measure per frame (cosmos C2b/C3).** A camera/lift that
follows or re-centers reads geometry ONCE (a ResizeObserver writes raw rects into state), then derives the
transform target in the React render (cheap arithmetic) — the rAF only reads the resulting value, never
`getBoundingClientRect`. When a new dimension changes the centering (cosmos's sheet-aware lift shrinks the
live zone by the open sheet's height), change only the *derived offset*, and keep the *scale* (zoom
magnification) on the original basis so the focused node's on-screen SIZE doesn't jump.

## 14.12 Shared-component UX conventions (learned in the A.2 reskin — apply to every theme + vapor)

These three bugs surfaced reskinning the Conf editors under `minimal`; all are now fixed in the **shared
Kit** (`kit.css` / a shared component) so every future reskin inherits the fix, and in **vapor** (via
`extras.css` overrides, vapor.css verbatim). Bake them into any new component from the start:

- **Draw simple symbols (`+ − ×`), don't render them as font glyphs.** A text glyph's optical centering
  varies by font/weight — minimal's Hanken Grotesk sat the add-row `+`/`−` off-centre in a circle that
  looked centered in vapor's font. Draw the symbol from CSS bars (two `linear-gradient(var(--accent),…)`
  `background` slices at `center`) or an SVG mask, so it's font-independent and always centered. Precedent:
  `.kit .mwrap.add .label::before` + the vapor `extras.css` override; the mini-player play/pause masks.
- **A dependent setting gets its own conditional labelled sub-row — never cram two controls into one row's
  right slot.** The "Auto-route to specialists" row jammed a number input *and* a Switch into one right-hand
  `<span>` (cramped, the input unlabelled). Split it: a clean toggle row, then a labelled numeric sub-row
  rendered only when the toggle is on (the Memory editor's State-cap / Reflection-interval precedent). The
  numeric field then right-aligns with every other `.lim-input` row. This lives in the **shared component**
  (`AgentsEditor`), so it's fixed for all skins at once.
- **Dialog/modal footer = neutral-left / primary-right on ONE row; don't stack into staggered rows.** With a
  secondary utility pair (Load/Restore default) *and* primary actions (Cancel/Save), make the utilities quiet
  **text** buttons on the left and the primary actions **pills** on the right (`margin-right:auto` / `margin-
  left:auto`, `flex-wrap` as the overflow fallback). Four equal pills don't fit at 390px → don't force them
  onto their own full-width rows (that reads as a left/right stagger). Precedent: `.kit .pm-foot` /
  `.pm-defaults .pm-alt`. (Material's "confirming action right, dismissive/neutral left" footer pattern.)

## 14.13 New-theme slot-in contract — the pre-flight (hardened after minimal + vapor, 2026-06-27)

**The whole point of the Kit + the semantic-token contract is that a new theme slots in by providing a
`tokens.css` (+ optional fonts/effects) and *nothing structural breaks*.** This checklist consolidates every
wire we actually hit shipping minimal + the vapor migration, so T2 (phosphor) → T5 each "just work" no matter
what new tokens/effects/fonts they bring. Verify each before writing a theme:

1. **Tokens — the contract is COMPLETE and is the safety net.** Every semantic token the Kit reads
   (`--bg`/`--surface`/`--surface-2`/`--text`/`-2`/`-3`/`--line`/`--line-2`/`--accent`/`--accent-fill`/
   `--accent-ink`/`--accent-soft`/`--accent-glow`/`--ok`/`--ok-soft`/`--warn`/`--warn-soft`/`--danger`/`--danger-soft`/
   `--radius`/`--radius-sm`/`--density-pad`) has a base fallback in `theme-engine/kit/tokens.css`
   (`@layer base`). So a theme that ships a **partial** `tokens.css` degrades gracefully (base value shows
   through); a complete one fully reskins. *(As-enforced nuance, 2026-07-10: the B2 suite requires the 21
   unconditional tokens; `--accent-ink` is required **iff the theme declares a light mode** — dark-only
   themes inherit the base `var(--bg)` fallback byte-identically. A single-mode theme is covered under its
   one implicit mode, `"dark"`.)* **Verified 2026-06-27: zero tokens are read without a fallback,
   and kit.css has no hardcoded theme colors** (only neutral `rgba(0,0,0,…)` shadows). *If you add a NEW Kit
   component that reads a NEW token, add its base fallback to `kit/tokens.css` in the same change* (the rule
   that caught `--bg`).
2. **`@scope`/`@layer` + the `:scope` gotcha (§14.6).** A theme's `tokens.css` is
   `@layer theme { @scope ([data-skin="<id>"]) { … } }` (a lazy import self-declares BOTH — the static
   `@import` can't pass the layer). The variable block goes on **`:scope`** (= `<html data-skin=id>`, NOT
   `:root` — scoped selectors match descendants, not the root); mode/accent/density axes on `body[data-*]`;
   page background on `:scope, body`.
3. **Formula-derived tokens live on `body`, NOT `:scope` (the var()-on-:scope trap, §14.4.1).** Any token
   whose value is a `var()` formula over a per-mode/accent input (minimal's OKLCH `--accent`) must be declared
   on a `body{}` rule so it recomputes against the resolved inputs; raw inputs stay on `:scope`. Declared on
   `:scope` it computes once on `<html>` and only inherits — the body-level overrides never re-derive it (the
   accent silently froze). A theme with flat literal-per-accent colors is immune.
4. **`@keyframes` names are GLOBAL — prefix every one with your theme id (`gacha-…`).** `@scope` isolates
   *selectors*, NOT animation names; the last-parsed `@keyframes <name>` wins document-wide, and theme bundles
   coexist during a View-Transition switch. **Every theme in the tree now complies:** vapor's were renamed at
   D51 V1 (`vapor-spin`, `vapor-shimmer`, `vapor-eq`, `vapor-twinkle`, `vapor-float`, `vapor-heartbeat`,
   `vapor-gridmove`, `vapor-tts-glow`, `vapor-sun-stripes-static`), the Kit's are `kit-*`, and
   minimal/cosmos/frontier/gacha each carry their own id. ~~A new theme that names a keyframe
   `spin`/`glow`/`shimmer`/etc. silently collides with vapor and breaks it while both are loaded.~~ *(That
   specific hazard is DEAD — no unprefixed keyframe is left. The RULE stands unchanged, because the collision
   is now simply between any two themes whose bundles coexist mid-switch.)* Rule: **prefix ALL your
   `@keyframes` with `<theme-id>-`** and you can never collide (this is exactly why the Kit uses `kit-*`).
   *(`inside` is NOT a vapor keyframe — an earlier prose list
   here included it, but it's a regex false-positive: `vapor.css:3` has the words "keeps @keyframes inside @scope"
   in a comment. Caught by external_audit #3 — exactly why the keyframe inventory should be **executable**, not
   hand-maintained.)* **`enforced by:` stylelint `keyframes-name-pattern` per-dir `overrides` — which are HAND-LISTED per
   existing theme dir (`kit/**`→`^kit-`, `themes/minimal/**`→`^minimal-`, `themes/cosmos/**`→`^cosmos-`,
   `themes/frontier/**`→`^frontier-`, `themes/vapor/**`→`^vapor-`, `themes/gacha/**`→`^gacha-` — no
   allowlist left), NOT a growing glob. gacha's runs at ERROR severity (a brand-new theme has no inventory to
   burn down); the five older ones are grandfathered warn-first. A NEW theme's override is forced by the **P2
   meta-guard** in `themeContract.test.ts` (red, with instructions, until the entry exists — added
   2026-07-10). See §14.13.1.**
5. **New effects must pass the §14.11 cross-browser budget.** CRT scanlines, glow, flicker, any ambient
   animation → **transform/opacity only** (no animated `background-position`/`box-shadow`/`filter`/size),
   **`will-change`/`contain`** the animated element, gate continuous anims behind `body[data-motion]` and any
   `backdrop-filter`/heavy effect behind `body[data-perf]` (both are part of the theme contract). Canvas/rAF
   loops: **drive them through `theme-engine/safeRafLoop.ts`** (mandatory — `enforced by:` the eslint
   `no-restricted-syntax` ban on a bare `requestAnimationFrame` under `src/themes/**`), then cap ~30fps, pause
   when not visible (IntersectionObserver; `document.hidden` for a persistent full-bleed layer), cache layout
   reads. **A theme isn't done until it's smooth on
   Firefox/Fennec AND Chrome at 390px with effects ON.** (A glow pulse → animate the `opacity` of a glow
   layer, not `box-shadow`; `--accent-glow` already exists in the contract for static glows.)
6. **Reuse the Kit; don't fork shared components.** A reskin theme = `Root` → `<DefaultRoot/>` + `tokens.css`
   (+ fonts + a Fleet view + settings). The shared overlays/editors/chat/primitives are already token-driven
   under `.kit` — never re-style them per-theme (§14.4.1: token-only reskins). A bespoke theme (own `Root`,
   own CSS, no `.kit`) opts INTO Kit pieces by adding the `.kit` marker itself. The §14.12 UX conventions
   (draw symbols, dependent sub-rows, neutral-left/primary-right footers) are baked into the shared layer, so
   you inherit them.
7. **State lives above the `Root` (§14.5); per-host visuals via `present()` (§9.9).** A spatial theme
   (cosmos/frontier, T4/T5) adds `present()` + its own Fleet `Root`; nothing else in the system changes.
8. **See-through / spatial themes: the signature layer is FULL-BLEED *under* the glass chrome — never boxed
   at the chrome edges (hardened after cosmos C2b, 2026-06-28).** The Kit's floating chrome (appbar/composer)
   is frosted glass (`backdrop-filter` on a translucent surface, perf-gated by `data-perf`). Glass only reads
   when there's **high-contrast background BLEEDING behind it** (the iOS Control-Center / macOS-sidebar
   pattern). So a theme's signature background (cosmos's orbital system; a fixed starfield; frontier's
   terrain) must be a **full-bleed layer spanning the whole fleet area** — e.g. `position:absolute; inset:0`
   filling `.kit-scroll` — so it sits *behind* the appbar (top) and composer (bottom). **Do NOT** size the
   layer to the gap *between* the chrome (`height: calc(100% - appbar)` + `overflow:hidden`): it clips the
   content at the composer line, leaving only `--bg` behind the composer, so the blur of near-uniform dark
   reads as a flat **black box that crops the system** (the exact C2b bug). Bonus: an absolute layer is out
   of scroll flow, so it can never add scroll height (no stray scrollbar) — more robust than clip+height.
   The glass recipe itself lives ONCE in the Kit composer/appbar; the theme only has to bleed under it.
   **A theme with its own full-bleed signature layer must ALSO opt out of the shared Kit background
   (`<DefaultRoot kitBackground={false}/>`, §14.4) — full-app scenery is exclusive by default: the shared
   layer XOR the theme's own, never both competing. cosmos (starfield), frontier (map) and gacha (wallpaper)
   all pass it.**
9. **Reusable `BottomSheet` primitive (`components/BottomSheet.tsx`) — use it, don't re-roll a sheet
   (added cosmos C3, 2026-06-28).** A dependency-free, kit-level draggable bottom sheet. Controlled
   (`<BottomSheet open onClose>`); **multi-snap** closed/peek/full — the CONTENT marks its peek line with
   `[data-bs-peek]` (no marker → plain closed/full). Mechanics worth not re-discovering: the transform is
   driven IMPERATIVELY (`el.style.transform = translateY(px)` on a ref — never a CSS var, vaul's lesson:
   a var offset recalcs every descendant → drops frames; never animate `height`); drag on the **handle**
   only (`touch-action:none`) to sidestep the scroll-vs-drag gate; release = `pickSnap` (nearest snap, or a
   velocity flick steps one snap / dismisses); `[data-dragging]` kills the CSS transition for a 1:1 drag.
   **Enter/exit animation** = a quick fade-in + slide-up on open, opaque slide-down on close (a *proper*
   bottom sheet — the slide is the primary motion, the fade just softens it). **`onHeightChange`** reports
   the active-snap height (for a spatial theme's camera-lift). Non-modal a11y: `role=dialog` WITHOUT
   `aria-modal`, no focus trap, Escape + an sr-only Close + return-focus; an optional invisible tap-outside
   catcher (`catchOutside`, default on — cosmos turns it OFF so taps fall through to the orbital stage).
   The theme only adds a **skin** (cosmos.css: glass/dots/rounded under `@layer theme`); the `.bs-*`
   STRUCTURE lives once in `kit.css`. **Sheet-open composer yield is kit-default** (K1, 2026-07-15):
   `kit.css` hides/slides the Kit composer (`visibility:hidden`, layout-box preserved) keyed on the
   host-stamped `body[data-sheet=open]` — a fleet surface owns the stamp, themes may still override in
   `@layer theme`. *Gotcha baked in:* a content reflow mid-enter (a display-font swap, an
   async height change) fires the sheet's ResizeObserver, whose `transition:none` re-apply would SNAP the
   sheet and kill the enter animation — the `entering` ref makes a mid-slide resize RE-TARGET the slide
   (keep the transition) instead; only an at-rest resize re-applies instantly.
10. **App-like text-selection / tap-highlight model (`@layer reset` in `theme/index.css`) — net-new CONTENT
    must opt INTO selectability (added 2026-06-28).** The app is **non-selectable by default** (`body {
    user-select: none }`) with the tap-highlight killed everywhere (`* { -webkit-tap-highlight-color:
    transparent }`), so every control — buttons, `role=slider`, `all: unset` controls (a planet inherits
    `none`), even touch-scroll-over-text — is clean with no per-widget chasing. This lives in a LAST-ordered
    cascade layer (`@layer base, theme, reset`), so it beats any theme's `all: unset` by layer order with
    **no `!important`**. Three sub-layers `defaults < content < controls`: **content** opts selectable islands
    back in (`.b .body`/markdown/code, device + host info VALUES, conf labels, inputs, `.selectable`);
    **controls** keep `none` even when nested in selectable content (the chat retry button, disclosure
    summaries). **Implication for a new theme:** your interactive surfaces are non-selectable for free, but
    any net-new **content text a user should be able to copy** (a new info value, a new message region) must
    be added to the `content` sub-layer's selector list — or just give it `class="selectable"`.
11. **Minimal chrome (`ui.appbarMode`) — DefaultRoot themes inherit it; a bespoke Root MUST handle it (added
    minimal-nav, 2026-06-28).** `ui.appbarMode` is a GLOBAL **four**-state lever —
    **`"visible" | "transparent" | "off" | "minimal"`**
    — and it's **per-device / LOCAL (not synced)** unlike the rest of appearance. `visible` = appbar + bottom
    tab bar; `transparent` = the SAME appbar + tab bar, but the bar paints **nothing** (no fill/border/shadow/
    backdrop-filter — it floats over the page, squared icon buttons); `off` = no appbar, tab bar only;
    `minimal` = **no appbar AND no tab bar** — navigation moves to a
    floating **orbit `NavMenu`** (top-right launcher → icon dropdown of the theme's sections). **Never test the
    mode with a `=== "visible"` comparison** — call **`appbarShown(mode)`** (`store/ui.ts`), the single source
    for "is a bar PRESENT (rendered + measured into `--appbar-h`)": true for `visible`+`transparent`, false for
    `off`+`minimal`. A hand-rolled triple would miss `transparent`. **DefaultRoot
    themes get all four for free** (DefaultRoot reads the prop: bar present→`<KitAppBar/>`; `minimal`→`<NavMenu/>`
    replaces `<KitNavBar/>`). `NavMenu` (in **`components/`**, not `kit/`) is a pure `useSections()` consumer — it
    renders the theme's sections
    as a menu, no nav-state fork. **A bespoke Root (its own `Root`, no DefaultRoot) MUST read
    `appbarMode` and either implement minimal or explicitly map `minimal`→`off`.** *Status:* **every registered
    theme honors all four modes — the last carve-out is GONE.** ~~vapor is the one bespoke Root not yet wired —
    `VaporRoot` maps `minimal`→`off` for now.~~ **RETIRED at D51 V4:** `VaporRoot` renders `DefaultRoot`, so
    vapor gets the floating `NavMenu` (and `transparent`) for free. This clause now governs only a FUTURE Root
    that hand-rolls its own chrome. §14.11
    budget applies to any nav transition (the `kit-fade` tab entrance is motion-gated).
12. **Composer = a base VARIANT + slot ADDONS, theme-selected (D30, added 2026-06-28).** The composer is
    composable, not configurable. The two axes are the **VARIANT/style** (`ComposerVariant =
    ComponentType<ComposerSlots>`; the stacked `KitComposer` default + the `SheetComposer` docked style) and the
    **ADDONS** (`composerSlots = { controlsStart?, overlay? }`) composed INTO the variant. ⚠️ **Selection
    SUPERSEDED by D31/§14.14:** the variant is no longer a `DefaultRoot Composer=` prop — it's a USER-SELECTABLE
    Surface (the `composerVariants` registry + a per-theme `composer` `seg` setting + the `ThemedComposer`
    resolver). `composerSlots` stays a `DefaultRoot` prop (the addon axis is orthogonal + theme-decided). A variant decides WHERE each slot renders
    (its layout); the theme decides WHAT fills it. **All variants reuse the headless `useComposer()`** — only
    markup/style differ, so a new style is a new component, never new logic; a new addon is a new named slot,
    purely additive. The plan-pill addon (`kitPlanComposerSlots` = `<PlanPill/>` in `controlsStart` + the peek
    `<PlanSheet/>` in `overlay`) is the first consumer — its nodes are STATIC (the pill/sheet self-subscribe to
    `useCurrentPlan()` + the `planSheet` store, render `null` with no plan), so dropping it into a variant adds
    zero wiring and never re-renders the app shell. The peek `.plan-sheet` is a SIBLING of `.kit-composer` (so
    the composer's rounded top tucks its bottom — a child would paint in front). **Vapor keeps its own frozen
    in-tab plan** (`AgentTab` gates it on `theme === "vapor"`); moving the frosted plan out of the kit Agent tab
    is what restored that tab's `kit-fade` entrance (a `backdrop-filter` can't composite under an animating
    ancestor). Full rationale: **DECISIONS.md D30**.

### 14.13.1 Enforcement & coverage — making the contract EXECUTABLE (audit #3, 2026-06-30)

The §14.11 budget and the §14.13 checklist are the prose **source of truth**; reliability decays when prose contracts
outrun their guards (three independent audits' core thesis: *make the documented contracts executable*). Four
**complementary** enforcement layers cover the contract — they are NOT substitutes, each catches what the others
structurally can't:

| Layer | Enforces | Why it can't move to another layer |
|---|---|---|
| **TS `ThemeDef`** (`types.ts`) | *shape* — field presence/types | types can't express `defaultMode ∈ modes`, `seg.default ∈ options`, or behavior |
| **Runtime guards** — `resolveThemeSetting` / `isRegisteredThemeId` / resolver `?? fallback` | *resilience* — never crash the user on stale/corrupt synced data | its job is to *silence* bad data (degrade), so it can't also be what *tells the dev to fix it* |
| **`themeContract.test.ts`** (B2) | *conformance* — value invariants types can't express **+ behavioral** (attr-cleanup across a switch chain, loaders resolve) | behavioral invariants need **mount + switch** — impossible at registry-load or in the type system; CI **fails the build** so the theme gets fixed pre-merge |
| **stylelint** (CSS) | keyframe prefixes · animation budget · token-only colors | CSS-invisible to all of the above |

`themeContract.test.ts` is the standard **interface-contract / conformance-suite pattern** — one reusable suite run
against every implementation via `it.each(registeredThemes())`, so a new theme is verified with **zero new test code**.
Layers 2 and 3 look redundant (both know `seg.default ∈ options`) but have opposite jobs: runtime **coerces** a bad
value (user fine); the test **fails the build** (dev fixes the theme). Keep both.

**stylelint rule → prose-contract map** (adopted minimal + **warn-first**; CSS-only; one `npm run lint:css`; grown via
the loop below):

| Rule | Enforces |
|---|---|
| `keyframes-name-pattern` (built-in, per-dir `overrides`) | §14.13 #4 — `^kit-` in `kit/**` and `^<t>-` in `themes/<t>/**` for all five themes (minimal · cosmos · frontier · vapor · gacha); no legacy allowlist remains. gacha's is an ERROR, the rest warn-first |
| `stylelint-high-performance-animation` | §14.11 — animate only `transform`/`opacity` (the rule that would have caught vapor's Firefox jank) |
| `ctrlb/accent-fill-contexts` + `ctrlb/accent-is-color` (the local plugin, **ERRORS**) | §9.7's two-channel accent — `--accent-fill` only via `background`/`background-image`, `--accent` must parse as a plain `<color>` |
| `color-no-hex` + `color-named` + `function-disallowed-list` + `function-url-scheme-disallowed-list`, scoped to `themes/gacha/**` (**ERRORS**; `themes/gacha/tokens.css` re-exempted) | §14.13 #1 — gacha authors colors ONLY in its `tokens.css`, so all eight palette variants re-tint by token edit; plus no inline `data:` URLs (art goes through `art.ts`'s manifest or the media mount). *(`stylelint-declaration-strict-value` was listed here as the must-use-token rule — it was never installed; these per-theme bans are what actually shipped, and they stay scoped to the theme that opted in.)* |
| `custom-property-pattern` (built-in) | token naming |

**The "grow the ruleset" governance loop** (so guards never lag the contracts):
1. **Auto-iterating guards.** Never enumerate themes by hand — `themeContract.test.ts` iterates `registeredThemes()`;
   stylelint uses directory-glob `overrides`. A new `registry.ts` row is auto-tested; a new `themes/<t>/` folder is
   auto-linted. Coverage grows with the data, not with discipline.
2. **Doc-as-coverage-map.** Every enforceable §14.11/§14.13 item carries an **`enforced by:`** marker
   (`stylelint:<rule>` / `test:themeContract` / `eyeball-only`). A new prose rule with no marker is then a *visible*
   hole, not a forgotten one. (E.g. #1 token completeness → `test:themeContract` token-list; #4 → `stylelint:keyframes-
   name-pattern`; #5 animation budget → `stylelint:high-performance-animation`; the §14.13 token-fallback rule →
   `test:themeContract`.)
3. **Definition-of-done.** A slice that adds or hardens a contract **adds/extends its executable guard in the same
   slice** (a stylelint rule or a B2 assertion) — or marks it `eyeball-only` with a reason. Covered by the standing
   pre-flight/audit discipline; not a separate chore.
- *Optional (P2) meta-guard:* a test asserting every registered theme has a `tokens.css`, every theme folder is matched
  by a stylelint override, and every checklist item has an `enforced by:` marker — the guard that guards the guards. **✅ BUILT 2026-07-10** (the "authoring guards ↔ registry" describe in `themeContract.test.ts`: keyframe-override + TOKENS_RAW presence per non-waived registered theme; the contrast-matrix half was already live as the drift guard).

> **`themeContract.test.ts` token-list assertion (audit #3 Δ3).** The token check must distinguish three classes:
> **semantic tokens** every non-vapor Kit-consuming theme must provide; **base fallbacks** Kit declares in
> `kit/tokens.css` (the safety net); and **runtime vars** set by JS/layout (`--app-h`/`--appbar-h`/`--composer-h`) —
> documented exceptions that must NOT be flagged missing. Add a light/dark contrast smoke once a 2nd light-capable
> theme lands.

## 14.14 Swappable Surfaces — Tokens vs Variants vs Bespoke (the element-extension contract, D31)

**The question this answers:** when we add a themeable element (or a new variation of one) for a new theme, do we
(a) restyle it with tokens, (b) make it a swappable component variant, or (c) let the theme own bespoke markup?
Getting this wrong **either way** rots the system — over-abstracting utility surfaces into registries (the "wrong
abstraction"), or hardcoding structural divergence that should be a clean variant. This is the **locked routing
rule**; follow it for every new element/variant. (Web-researched: W3C DTCG / Material 3 / Radix Themes / shadcn on
tokens; MUI `slots` + Radix/React-Aria headless on variants; VS Code/Backstage registries; Metz/Dodds/Frost/Rule-of-
Three on abstraction. Full rationale: **DECISIONS.md D31**.)

### The 3-band spectrum — the cheapest band that can express the difference WINS

| Band | Mechanism | Use when | Add a theme = |
|---|---|---|---|
| **Tokens** | the semantic contract (`tokens.css` under `.kit`, §14.4.1) | the difference is **cosmetic** — color, spacing, type, radius, elevation, motion | a `tokens.css` |
| **Surface (variant)** | a registry of interchangeable components over ONE headless controller | the difference is **structural** — different DOM/layout/interaction — AND ≥2 real impls | register a variant + list it |
| **Bespoke** | the theme owns the markup (escape hatch) | a genuine one-off (vapor's hero/skyline/waveform Fleet; cosmos's orbital Fleet; a single-theme snowflake) | the theme's own file |

**Tokens re-skin; they cannot restructure.** A token is a name→value for a *visual* decision; nothing in token-space
can add/remove a DOM part, change layout topology, or alter behavior. The moment a theme difference crosses into
structure, it has left token-space — that, and only that, is when a Surface is earned.

### The decision gate — a region earns a Surface ONLY if ALL THREE hold

1. **Structural divergence** — DOM shape / composition / interaction genuinely differs across themes, not just
   color/space/type/radius. *(Only tokens differ → use Tokens.)*
2. **≥2 real divergent implementations** exist or are imminent (prefer 3). A hypothetical future theme does **not**
   count (speculative generality). *(One special structure → a **bespoke** snowflake, never a registry-of-one.)*
3. **A shared headless controller** can back every variant — the invariant behavior (state, a11y, keyboard, data)
   factors into ONE hook; only rendering swaps. *(Behavior can't be shared → these aren't variants of one thing.)*

**The map today** (re-run the gate before adding any region):

| Region | Verdict | Why |
|---|---|---|
| **Fleet** (list / orbital / map) | **Surface** | radically different DOM + interaction; ≥2 impls (`KitFleet`, `CosmosFleet`); backed by `useFleet` |
| **Composer** (stacked / docked / line — LAYOUTS; chrome = the `composerSkin` axis, §14.16) | **Surface** | structural layout differs; ≥2 REAL impls (`KitComposer`, `SheetComposer`, `LineComposer`); backed by `useComposer` — **user-selectable since 2026-07-11; F5 slice B deduped the old borderless/ghost wrapper "variants" into the glass/sleek skins** |
| **Tools tab** | **Tokens** | one schema-driven `UtilCard` structure, reskinned; no per-theme component |
| **Conf / settings** | **Tokens** | one `ConfGroup`/`SettingRow` structure, reskinned; matches VS Code/Primer/MUI/Backstage — none component-swap settings |
| **AppBar / nav / chrome** | **Tokens** | same nav contract restyled (promote ONLY if a theme truly restructures navigation) |

⚠️ The **"shape & design"** of a token-themed region (e.g. the tool card's radius/surface/borders/spacing) is fully
theme-controllable **via tokens** — that is NOT a reason to make it a Surface. A Surface is earned only by *structural*
divergence + a *second* implementation.

### The Surface model — controller + variants, selected one of TWO ways

A Surface = a region + **one headless controller** + **interchangeable variant components**. Every variant is a pure
presenter over the controller (`useComposer`, `useFleet`; §14.2) — behavior is never duplicated. Variants read **only**
the semantic contract, so they're portable across any contract-providing theme.

**Variant selection has two mechanisms — pick the simplest that fits (do NOT conflate them):**

1. **Root-pinned (prop injection)** — the theme's `Root` passes the variant component straight into the layout
   (`DefaultRoot Fleet={CosmosFleet}`). **No registry, no setting.** Use when a theme has exactly ONE variant for that
   surface and the user shouldn't choose. Simplest; zero indirection. **This is Fleet for every theme except gacha**
   (each pins its signature view; gacha graduated — see below). The two mechanisms coexist per theme: graduation is
   per-offering-theme, never a forced migration of the pinned ones.
2. **User-selectable (registry + per-theme `seg` setting + resolver)** — an open `Record<variantId, Component>` of
   **STABLE module-level references** (never a `lazy()`/fresh identity built in render — React would remount the
   subtree and **reset controller state**), object-lookup **+ a default fallback** (unknown/removed id degrades, never
   crashes); the theme lists the offered ids + default as a `seg` setting (§14.3, auto-rendered in Appearance +
   auto-synced); a shared resolver maps `active theme → its <surface> setting → variant` and renders it. The resolver
   is usable by **any** Root — `DefaultRoot` AND bespoke Roots (vapor/frontier) — so the switch is **not Kit-only**.
   **This is Composer** (stacked/docked, user-picked) **— and, since 2026-08-08, gacha's Fleet** (`fleetLayout`:
   capsule/poster/cover).

**Graduation path:** a surface starts Root-pinned and **graduates** to user-selectable the moment ≥2 variants + a user
choice are actually wanted (the second-instance trigger). Composer has **graduated in code (2026-07-11)** —
the full catalog is live and user-picked. **Fleet graduated 2026-08-08 (gacha alt-fleet E0, D31 record):** gacha
offers a real fleet choice (`fleetLayout` seg — capsule/poster/cover, three theme-owned variants registered in its
lazy chunk over the shared resolver). Cosmos's orbital fleet and every other theme's pinned Fleet are *untouched* —
graduation adds the registry path for the offering theme only. Don't pre-graduate a surface that only has one variant
per theme; the prop is correct and cheaper.

> **✅ As-built status (2026-07-11 — supersedes the QH 2026-07-07 spec-only banner):** the machinery below
> IS in the tree per `COMPOSER_SURFACE_PLAN.md` (A1–A4 + C, all owner-eyeballed + audited):
> `composerVariants` `[stacked, borderless, ghost, sheet, line]` + `composerLayoutSetting` + `ThemedComposer`
> (kit/composer/), the `rootClass`/`sendIcon` pure-CSS wrapper seam (borderless/ghost) *(F5 slice B
> [2026-07-15, D37] later DEDUPED the catalog to `[stacked, sheet, line]` — the two wrappers deleted into the
> `composerSkin` axis's glass/sleek skins, §14.16; the `rootClass`/`sendIcon` seam itself remains)*, the shared
> `useComposerChrome` presentational hook, and the A4 `planPlacement` axis (inline pill+sheet, owned by
> DefaultRoot · pinned `PinnedPlanPanel`, mounted by AgentTab). The `DefaultRoot Composer={…}` prop is
> REMOVED (D30's banner covers the history). Fleet remains the one Root-pinned multi-impl surface
> *(true when written — Fleet graduated for gacha on 2026-08-08; see the graduation note above)*.

**The factory is concrete-first.** There was exactly ONE user-selectable surface at first (Composer), so its
registry + resolver were built **concretely** in `kit/composer/` (`composerVariants` map + `composerLayoutSetting`
spec + `ThemedComposer` resolver). The clause held: the generic factory was written only when the SECOND
user-selectable surface arrived. **✅ EXTRACTED 2026-08-08 (gacha alt-fleet E0):** `createSurface` in
`src/theme-engine/surface.ts`, produced by factoring the composer concrete — composer re-pointed zero-churn behind
its existing tests, gacha's `fleetSurface` is the second consumer:
```ts
// src/themes/gacha/fleetSurface.ts — the real second consumer
export const fleetSurface = createSurface<GachaTrackProps>("fleetLayout", "capsule", GachaTrack);
fleetSurface.register("poster", GachaPoster);  // stable module-level refs, registered at module scope
fleetSurface.register("cover", GachaCover);
// resolver hook → active theme → its "fleetLayout" setting → variant; unknown/stale ids degrade to "capsule"
```

### Conditional setting visibility — the `showWhen` contract (E0, 2026-08-08 — D52 ledger addendum 2)

A ThemeDef settings row may declare `showWhen?: { key: string; is: string | string[] }` — the row renders in
Appearance only while a SIBLING seg setting resolves to one of the named values (gacha's `posterName` shows only
under `fleetLayout: "poster"`). The contract, enforced by the themeContract checker for every registered theme:

- **The controller must be a DECLARED sibling `seg`** of the same theme — never a switch (string `is` can't match a
  boolean; an enable-toggle would be a different feature), never `showWhen`-conditional itself (**no chains**), never
  a self-reference, and every `is` value must be one of the controller's declared options (`is` non-empty).
- **Declaration order is render order:** a conditional row is declared IMMEDIATELY AFTER its controller, so the pair
  reads as one unit in Conf.
- **Visibility is a render concern ONLY — hidden ≠ cleared.** A hidden row's stored value is never pruned; it keeps
  syncing in the appearance doc and reappears with its old pick when the controller returns.
- **Fail-open belts** in `settingRowVisible` (pure, exported, unit-tested): an undeclared or self-referential
  controller shows the row rather than silently losing it — the contract test makes both unreachable for a
  registered theme; the belts cover unregistered/corrupt shapes.

### How to extend — the additive moves (no churn to existing code)

- **Add a Root-pinned variant** (one-per-theme) → pass it via the Root prop (`Fleet={…}`). Nothing else.
- **Add a user-selectable variant** → put it in the registry (stable ref) + list its id in each offering theme's
  `<surface>` setting `options`. A *bespoke* variant registers in its theme's **lazy chunk**; `switchTheme`'s preload
  guarantees it's registered before that theme's Root renders. *Kit* default variants register eagerly (they're the
  fallback + used by reskins). A picker auto-appears once a theme lists ≥2 options.
- **Graduate a pinned surface to user-selectable** → only when ≥2 variants + user choice are real; build/extract the
  registry+resolver then (Composer is the worked reference).
- **Add a whole new Surface type** → a new headless controller + (pinned prop OR registry) — but ONLY after the 3-gate
  passes (a second *structural* implementation actually exists).
- **Add an addon** (the orthogonal composition axis, §14.13 #12) → a new named slot in `ComposerSlots`; additive, no
  variant churn. The plan-pill (`kitPlanComposerSlots`) is the first.

### vapor & frontier (and any bespoke Root)
A bespoke theme registers its OWN variants and renders `<surface.Themed/>` in its Root → first-class participation, no
special-casing. **✏️ vapor's row is HISTORY (D51 V4, 2026-08-01):** the "deferred, additive opt-in" this paragraph
described — map the vocabulary onto the contract (`--accent: var(--magenta)`, …) and mark the subtree `.kit` — was
TAKEN, and it was indeed a small step rather than a refactor. vapor now hosts the KIT variants (it renders
`<DefaultRoot/>`, its `tokens.css` carries the contract, its `ThemeDef.settings` declares the four axis/seg
descriptors) and registers **no** bespoke composer variant; the one surface it still owns is its Root-pinned
Fleet, bespoke-by-right. The bespoke-Root seam itself is unchanged and still available — frontier uses it.

### Invariants & runtime safety (audit-hardened, 2026-06-29 — external_audit B4/D1/H3)

1. **No theme-id branching (the load-bearing invariant).** Neither `DefaultRoot` nor any resolver may
   `if (theme === "cosmos")`. A Surface resolves a variant by reading the **per-theme setting** + the registry —
   theme identity flows in only as the *key* into the generic settings map, never as a `switch`. (Verified:
   `DefaultRoot` has zero theme branches.) This is what lets a new theme slot in without editing shared code.
   *"No theme ID conditionals inside `DefaultRoot`. Ever."* (audit D1 / agent-rule #2). ~~**One grandfathered
   exception (documented 2026-07-06):** `AgentTab.tsx`'s `isVapor` gate on the in-tab `PinnedPlan`.~~
   **✅ RETIRED at D51 V4 (2026-08-01)** — and note it did NOT take the ChatSurface route this text predicted:
   vapor simply declared the existing `planPlacement: "pinned"` setting, so plan location became "the setting's
   choice" exactly as designed and the branch deleted itself. The invariant now holds with **zero** exceptions
   anywhere in the shared tree.
2. **Per-theme settings are VALIDATED at read, not cast.** `useThemeSetting` runs the raw (persisted/synced/possibly
   stale) value through `resolveThemeSetting(themeId, key, raw)`: a `seg` value must be one of the spec's `options`
   (else → `default`); a `switch` value must be boolean (else → `default`); an unknown key → `undefined`. Non-negotiable
   for Surfaces because the setting drives *which component renders*. **Bonus — this enforces the capability list for
   free:** a theme only declares the ids it offers in its setting `options`, so a validated value can only ever be a
   variant the theme actually offers (a stale `sheet` under a stacked-only theme coerces back to `stacked`). The
   resolver still keeps a final `registry[id] ?? fallback` as defence in depth.
3. **A user-selectable surface's `seg` `options` ARE its capability list.** The menu of variants a theme offers; the
   `default` is its pinned choice. Adding/removing an offering = editing that one list — no registry/resolver change.
4. **Slot semantics are fixed + documented (don't let themes invent gravity).** `ComposerSlots` placement is contract:
   `controlsStart` = leading edge of the controls row (plan pill); `overlay` = a positioned sibling ABOVE the composer
   (plan sheet, tucking behind the rounded top — rendered *before* the bar so the composer paints over its tucked
   edge). Reserve `controlsEnd` (trailing controls) + `below` (a strip under the bar) as the next additive slots —
   **add only when a real consumer exists** (audit H3), never speculatively.
5. **Variant a11y obligation (final review 2026-07-06, D34).** A Surface variant must expose **one focusable,
   accessibly-named element per interactive item** (host/action) and mark decorative layers `aria-hidden` —
   CosmosFleet's DOM-planet `<button aria-label aria-pressed>` over the canvas is the precedent (that D31
   rendering research chose DOM-over-canvas *for* this). A canvas-only variant with zero focusable hosts
   violates the contract. `enforced by:` a light per-variant assertion in `themeContract.test.ts` (render each
   theme's Fleet with a stub host → expect a focusable element with an accessible name); full keyboard-flow
   auditing stays `eyeball-only`.

### Anti-patterns — do NOT
- ❌ Make a utility/forms/settings/chrome surface a Surface (registry-of-one / wrong abstraction — every mature system
  token-themes these).
- ❌ Stand up a variant registry for a *hypothetical* future theme (speculative generality — wait for the 2nd real
  implementation; **duplicate until then**).
- ❌ Build a variant `lazy()` inside render or return fresh component identities (remount → controller state reset).
- ❌ Put behavior in a variant — it belongs in the headless controller (one source of truth).
- ↩️ **Reversal rule:** if a built variant slot won't fit a new theme cleanly, inline it back and re-abstract on the
  real shape — "the fastest way forward is back" (Metz). Don't defend a wrong seam from sunk cost.

---

# §14.15 — FINAL REVIEW OUTCOME (2026-07-06, →DECISIONS D34): Hardening slice v2 + the vapor assimilation ladder

> A 29-agent adversarial review (6 decision clusters × web best-practice + code audit, every risk/change
> finding independently attack-verified, Claude as final judge) re-validated the entire architecture:
> **every layer confirmed — no decision relitigated.** It found one product bug, one coverage hole, and
> reshaped the hardening slice into the v2 below, which **supersedes the TRIAGE-3 slice ordering**
> (B4→R3→R4+T1→B2→stylelint). Sequencing unchanged: this slice ships first when the theme engine un-parks
> (post-emma-deploy), then the Composer Surface (`COMPOSER_SURFACE_PLAN.md`).

## 14.15.1 The Hardening slice v2 (10 items + 2 riders — behavior-preserving except ①) — ✅ SHIPPED 2026-07-10 (all 10 items + riders a/b/c; as-built deltas in §14.15.1-A; commits bdaf511…9e21cdc; release gate incl. e2e 7/7 green)

1. **`--accent-ink` token (the one product bug).** kit.css hardcodes `color: var(--bg)` on `--accent-fill`
   controls (**9 accent-fill sites**: kit.css 362/663/802/995/1547/1612/2956/3169/3341 — audit each; skip
   no-text uses like the switch knob/masks; the 10th `color: var(--bg)` hit at kit.css:2508 is the plan-step
   done-tick on `background: var(--ok)` — NOT accent, leave it to the B2 status-color contrast assertions).
   minimal's **light mode ships 3.2–3.4:1** on every accent control (accent
   L0.58; fails WCAG AA 4.5:1). Fix: add `--accent-ink` to the contract with base fallback
   `var(--bg)` (all dark themes byte-identical, zero migration), sweep the text-bearing sites to
   `color: var(--accent-ink)`, and set minimal's light-mode ink **near-black (~#000)** — NOT `--text`/#1d1c1a
   (only 3.9:1 vs the L0.58 accent; verify the literal against all 4 hues). Matches Material `on-primary` /
   Radix `--accent-contrast` / shadcn `primary-foreground`; explicit per-mode literal, no auto-derivation.
2. **Theme-fault boundary + Reset-as-pick.** ErrorBoundary around `<ActiveRoot/>` in App (keyed by theme id so
   a new pick retries cleanly). Fallback: **Reload = primary** (fixes the common stale-chunk-after-deploy case,
   keeps the theme) + **"Reset theme to default" = a genuine `pickTheme(DEFAULT_THEME)`** — local apply **plus
   the normal optimistic PUT** (write-through). Local-only reset does NOT escape (the server doc re-applies the
   broken theme on the next reconcile → crash loop); quarantine machinery was reviewed and rejected
   (over-engineering + invisible-state trap). No safe-mode flag exists. See the invariant in §14.15.2.
3. **`ensureThemeLoaded` rejection eviction.** The `loaded` Map caches a rejected promise forever → one
   transient blip poisons that theme for the session. Fix idiom: build `p`, attach a side-channel
   `p.catch(() => loaded.delete(id))`, then `loaded.set(id, p)` and **return the ORIGINAL `p`** (preserves
   in-flight dedupe + the rejection switchTheme's try/catch observes). Note in-code: the browser module map may
   still cache HTTP-status failures (whatwg/html#10327 open) — our eviction is necessary, not always sufficient.
4. **ThemeProvider cold-load catch → toast only.** Replace `void ensureThemeLoaded(theme)` with a `.catch` that
   toasts + logs. Do NOT auto-revert (a CSS-only failure degrades to the neutral Kit base-token fallbacks —
   survivable; the crash path belongs to item ②'s boundary; two revert authorities would race).
5. **In-flight guard INSIDE `switchTheme`** (replaces the planned `useIsMutating` gate — one chokepoint beats
   two mechanisms). Module-level `latest` + `inFlight`, tracking the **full SwitchTarget** (not just the id, so
   the winning call applies the right mode/accent): dedupe same-target calls; after the await, bail if
   superseded. Covers the reconcile double-VT (live since minimal/cosmos registered), out-of-order cold loads,
   and StrictMode double-effects uniformly. Fix the stale comment at `useAppearance.ts:132` while there.
6. **Registered-ID coercion, two doors, never auto-PUT.** Load door: coerce an unregistered persisted `theme`
   → `DEFAULT_THEME` in the migration chain (AFTER `migrateLegacyTheme`, or aqua→vapor remaps get flattened).
   Reconcile door: an unknown server skin = "no renderable opinion" → **hold the whole skin-triple
   {theme,mode,accent} at local** (they're skin-scoped, atomic per skin) but **still apply
   motion/perf/themeSettings** (global/namespaced — unknown keys inert). Never write a coerced value back
   (version-skew LWW-clobber protection); documented consequence: touching the picker on an old build
   overwrites a newer device's pick — acceptable, explicit user action.
7. **B4 `resolveThemeSetting`** (unchanged from TRIAGE-3 / COMPOSER_SURFACE_PLAN §2.0 — seg∈options else
   default · switch→bool · unknown→undefined; the Composer Surface depends on it).
8. **B2 `themeContract.test.ts`** — the conformance suite via `it.each(registeredThemes())`: token-list
   (semantic vs base-fallback vs runtime-var classes, §14.13.1 Δ3) · behavioral (attr cleanup across a switch
   chain; loaders resolve) · **structural measurement hooks** (`#app-scroll`; when `hasComposer` a
   `#composer`/`.kit-composer` node; render with `appbarMode="visible"` and assert `.kit-appbar` — the class
   CosmosFleet cross-queries) · the **Fleet a11y assertion** (§14.14 invariant #5) · a **contrast group**
   (`--accent-ink` vs `--accent-fill` ≥4.5:1 · `--text` vs `--surface`/`--bg` ≥4.5:1 · `--text-2` and
   status colors vs `--surface` ≥3:1, per theme×mode×accent; WCAG 2.1 gates, APCA advisory). ⚠️ Decide the
   palette-resolution strategy up front: jsdom/culori can't replay the @layer/@scope/body-formula cascade —
   either parse tokens.css and model the override chain, or use real-browser computed styles (Vitest browser
   mode/Playwright); a hand-duplicated palette table needs a drift meta-test. **vapor's exemptions = ONE
   declarative waiver constant** (e.g. `CONTRACT_WAIVERS = {vapor: [semantic-tokens, keyframe-prefix,
   accent-axis]}`) — never scattered `if (id !== "vapor")` skips; the waiver list IS the §14.15.3 tracker.
9. **stylelint micro-slice** (warn-first, per TRIAGE-3): `keyframes-name-pattern` (per-dir overrides;
   vapor/extras allowlisted = waiver) · `stylelint-high-performance-animation` · token-only colors ·
   `custom-property-pattern` · **NEW: `--accent-fill` may appear only in `background`/`background-image`/mask
   contexts, and a theme's `--accent` must parse as a `<color>`, never a gradient** (a gradient `--accent`
   silently kills every focus ring/border/color-mix).
10. **Kit-render e2e smoke (the coverage hole).** No test in ANY layer mounts DefaultRoot/kit.css today — all
    three e2e specs boot vapor. Add `e2e/kit-render.spec.ts`: seed `localStorage["ctrlb.ui"]` via
    `addInitScript` (the flows.spec pattern), parametrized over **minimal AND cosmos** (CosmosFleet = a distinct
    Surface impl + canvas), poll a kit-only class (lazy CSS loads async), run the render/tab smoke
    (crash + ErrorBoundary-fallback detection only). A SPEC, not a Playwright project (a project would re-run
    the axe scans per theme — combinatorial). No screenshot diffing (rejected — flaky, over-engineered here).

**Riders (approved 2026-07-06):** **(a) persisted-schema `v` stamp** on `ctrlb.ui` — missing→0, run ordered
migrations up to current, stamp, save; makes the three migrations one-shot + prunable and **deletes
`rawHasAppbarMode()`** (the double-parse hack the version stamp obviates); the zustand-persist
`version`/`migrate` convention. (Server-doc `hideAppbar` strip stays as-is; a one-shot backend fold is
deferred.) **(b) key-order-insensitive `themeSettings` compare** in `reconcileAppearance` (sorted-keys
stringify or small deepEqual, ~10 lines + unit test) — kills the spurious re-apply when two devices authored
settings in different orders. **Declined:** aria-live theme announcement (no SR user; if the app ever goes
eyes-free, do a deliberate live-region pass — toasts + streaming + theme — as its own slice).

### 14.15.1-A Pre-build review amendments (owner-ratified 2026-07-10 — supplements, does not restructure, the items above)

A 5-agent pre-build pass (code-truth · adversarial · 3 web-research memos, every claim re-verified in source
by the main session) found the plan fully current (zero line-ref drift) and produced these deltas. Each is
the industry-standard pattern, named and sourced in the session record.

- **③ +:** the eviction must ALSO reset `preloadableRoot`'s memoized `pending` on rejection
  (`lazyRoot.ts` — `pending ??=` caches rejections "parity with React.lazy", so evicting only the
  `loaded` Map leaves Root chunks unretryable; the nearer cache is OURS, not the whatwg module map).
  Preserve the stable promise identity while pending (the `??=` stays). The browser module map may still
  cache the failed *fetch* (whatwg/html#10327 — open, unshipped) → item ②'s **Reload button is the
  backstop**; NO cache-busting retry (Chrome-only URL extraction, fragile with Vite static specifiers).
  When #10327 ships, plain re-import self-heals with zero code change here. Same commit: update
  `ErrorBoundary.tsx`'s "no API to clear it" doc comment (true for React.lazy, false for ours post-③).
- **⑤ +:** clear the in-flight marker **in `finally`** — else a failed target is deduped forever and
  strands ③'s retry (③ and ⑤ are mutually dependent; build together). The monotonic-token/settle-reset
  norm (React ignore-flag pattern generalized). Precision fix: the reconcile double-VT is prevented by the
  **supersede** check, not the dedupe (pick and reconcile targets differ in the motion trio) — and the
  `next.theme !== local.theme` branch in `useAppearanceSync` must survive any refactor.
- **⑥ +:** the registered-id coercion is a **validity check, not a migration** (parse-don't-validate /
  zod-`.catch` semantics): it runs **every boot**, after the (now-versioned) chain, ungated by `v` —
  registry membership is orthogonal to schema version (a theme can be deregistered with no shape change).
  Reconcile door: inject an `isRegistered` predicate into `reconcileAppearance` (stays pure; keeps cosmos's
  canvas imports out of jsdom); hold the skin-triple at local **before** the equality gate. *(As-built
  placement, 2026-07-10: the load-door coercion lives at the ENGINE boundary — `resolve.ts
  coerceBootTheme()`, called from main.tsx before first paint — NOT in store/ui.ts: registry.ts statically
  pulls VaporRoot → components/stores, so a store→registry edge would be a module-eval import cycle.)*
  **Third door accepted as-is:** the index.html FOUC script applies the raw persisted id with no allowlist — the
  next-themes-standard self-heal; a one-frame flash on a removed-theme device is accepted, do NOT add an
  allowlist to the pre-paint path.
- **④ + (single-signal, NN/g):** `ensureThemeLoaded` tags rejections with a typed
  `ThemeLoadError { source: "styles" | "fonts" | "root" }` (engine-internal — the ThemeDef contract is
  untouched). Provider cold-load catch: styles/fonts → toast (survivable base-token degrade); **root →
  silent** (item ②'s boundary owns the fatal signal; never both for one failure). The switch path keeps
  its toast (failure there means we stayed on the working theme — non-fatal, single signal, correct).
- **② +:** key the boundary on **theme id + a resetEpoch counter** (key-remount idiom) so Reset always
  remounts — without it, Reset is a silent no-op when DEFAULT_THEME itself is the faulty theme. Export
  `DEFAULT_THEME` from `resolve.ts` (it is module-private today; the standing no-"vapor"-literals guarantee
  already mandates the constant). Reset reconstructs pickTheme's two-step in App (`switchTheme` +
  `useSaveAppearance().mutate` hoisted) → flows through ⑤'s guard and satisfies the §14.15.2 explicit-
  user-action invariant. REUSE the existing render-prop `ErrorBoundary` + the F23 root-fallback primitives
  (vapor CSS is eager/frozen → the fallback renders styled under every theme). Boundaries catch
  render/commit only — rAF/canvas faults are rider (c)'s job, not ②'s.
- **Rider (a) +:** the v-stamp adoption must NOT re-run the appbar seed on current-shape unversioned blobs
  (every real device today has `appbarMode` but no `v` — "missing→0, run all" would override the user's
  choice, the exact bug the code comment records). The v0→appbarMode step infers its stage by **key
  presence** ("blob has `appbarMode` ⇒ already past it") — the accepted idempotency escape hatch for a
  non-idempotent migration over mixed-stage unversioned data (zustand treats unversioned as current;
  redux-persist as run-all; presence-inference is confined to this ONE step). Delete the
  `rawHasAppbarMode()` *helper* (no other caller), keep its raw-presence logic inside the step.
- **NEW rider (c) — owner-approved 2026-07-10; ✅ BUILT (`theme-engine/safeRafLoop.ts`; six consumers —
  cosmos camera + starfield, vapor's waveform, gacha's banner + agent, `App.tsx`; adoption enforced by the
  eslint rAF ban; the contract is now live guidance in §14.11 / §14.13 #5):** an engine-owned **`safeRafLoop`** helper (~20 lines):
  try/catch around the tick body; on throw cancel the loop, `reportError()`, degrade gracefully (stop
  animating, never error-per-frame). Adopt in cosmos's camera + starfield loops now. This is the pattern
  every future canvas theme copies instead of an unguarded loop — shape the seam before the second consumer
  arrives. *(As-built correction 2026-07-10: frontier is canvas-FREE per FRONTIER_PLAN §6-F5 — PNG art +
  transform/opacity CSS keyframes; the next canvas consumer is observatory T6. The eslint src/themes/**
  rAF rule enforces adoption regardless.)*
- **⑧ settled:** the contrast group runs as a **Playwright spec** (`e2e/contrast.spec.ts`, reuses the
  existing e2e harness) — NOT jsdom (can't replay `@layer`/`@scope`), NOT token parsing (breaks on
  `color-mix()`/relative color), NOT a palette table (second source of truth). **Probe-element technique**
  (the verified CSSOM gotcha: `getPropertyValue("--x")` returns the AUTHORED var chain — apply tokens to
  real properties on a probe element and read the computed color). Math: `culori` (WCAG 2.1 gate) +
  `apca-w3` (advisory). The rest of `themeContract.test.ts` stays in jsdom Vitest.
- **⑨ settled:** `stylelint-high-performance-animation@^2` (maintained, 2026-01) + **one custom plugin**
  (`stylelint.createPlugin` + `walkDecls`, reusing culori for the `<color>` parse) for the two bespoke
  accent rules — no off-the-shelf plugin expresses "value-token restricted to a property set". Optional:
  `stylelint-declaration-strict-value` for the inverse must-use-token direction.
- **Build order (dependency-driven):** rider (a) → ⑥ + rider (b) → ③+⑤ (together) → ④ → ② → rider (c)
  → ① → ⑦ (independent, parallel-ok) → ⑧ → ⑩ → ⑨.

## 14.15.2 New invariants (locked by the review)

- **The server appearance doc is only ever written by EXPLICIT user action** — the Conf picker and the
  boundary's Reset button qualify; migrations, coercions, reconciles, and error handlers never do. (This is
  why item ⑥ never auto-PUTs and why item ②'s write-through is correct: Reset IS a pick.)
- **Browser floor (documented, not probed):** Chrome/Edge 118+ · Firefox/Fennec **146+** (@scope; Dec 2025) ·
  Safari 17.4+. Below the Firefox floor the `@scope`-wrapped sheets are dropped wholesale — **vapor renders as
  an unstyled shell** (kit-based themes degrade to neutral base tokens). Accepted for owner-controlled
  evergreen browsers; a boot probe/`@supports` duplicate was reviewed and rejected. Note: the View-Transition
  floor (FF144) sits BELOW the @scope floor → no version window renders themes but breaks the switch.
- **Two-CSS-trees rule** for shared markup (§14.4.1 box — AMENDED at D51 V4: the trees CO-APPLY now, so read
  the amended box) + ~~the **grandfathered `isVapor` exception** (§14.14 invariant #1)~~ **RETIRED at D51 V4**.

## 14.15.3 Vapor assimilation ladder (owner directive 2026-07-06: frozen = a phase, not an identity)

> ## ✅ DONE — 2026-08-02 (D51, TODO Phase 16, slices V0–V6 all shipped)
>
> **The ladder is COMPLETE. Vapor is a kit theme.** It renders `<DefaultRoot/>` (kit app bar with its
> `brandMark` lozenge · kit tab bar · the `sheet` composer · `pinned` plan · shared chat/Conf/Utils/overlays)
> over `themes/vapor/tokens.css`, plus a Root-pinned **bespoke VaporFleet** — hero, skyline, waveform, device
> rows — which is bespoke-BY-RIGHT under D31/§1.1, not a leftover. Across the phase `extras.css` went
> **3028 → 204 ln** (41 → 6 banners, exactly the frozen `vapor-keeps` list) and `vapor.css` **1178 → 692 ln**
> (`kit.css` **5107 → 5304**; net **−3113** CSS lines); the
> `CONTRACT_WAIVERS` list is `{}`. Superseded in sequencing by
> [`VAPOR_ASSIMILATION_PLAN.md`](./VAPOR_ASSIMILATION_PLAN.md) (LOCKED 2026-08-01) — read it, plus
> [`VAPOR_BANNER_LEDGER.md`](./VAPOR_BANNER_LEDGER.md), for the as-built record. **The six hooks and their
> retirement slices:**
>
> | Hook | Retired at |
> |---|---|
> | ① accent on `body[data-theme]` | **V2** — the shared `body[data-accent]` axis; `applyBodyAttrs` has one arm |
> | ② non-contract token vocabulary | **V3** — `themes/vapor/tokens.css` maps the full semantic contract |
> | ③ unprefixed `@keyframes` | **V1** — all prefixed `vapor-*`; the `src/theme/` stylelint override is gone |
> | ④ parallel chrome (`components/{AppBar,Composer,TabBar}`) | **V4** — the DefaultRoot pivot; the files are DELETED |
> | ⑤ the `isVapor` PinnedPlan gate | **V4** — `planPlacement: "pinned"` + the kit's `PinnedPlanPanel` |
> | ⑥ CSS living in `theme/` | **V1** — everything is under `themes/vapor/` |
>
> Two things settled at **V6** beyond the hooks: the `layouts: ["4-tab"]` **section waiver RETIRED** (vapor
> offers all presets; real 2-/3-tab navigation + hosting tests replaced the forced-coercion assertions), and
> the **vapor lazy flip was MEASURED and DROPPED** — the whole eager slice is 26.5 KB raw / **5.3 KB gzipped**
> after V5, against real new mechanism (an internal `@layer` wrap, a face-awaiting font loader, a first-paint
> test on the persisted-vapor path) on the owner's daily-driver theme.
>
> The end state is ENFORCED, not reviewed: `tests/theme-engine/vaporAssimilation.test.ts` asserts the
> extras.css banner set **equals** the frozen keeps list and pins "VaporRoot renders DefaultRoot" + "the
> bespoke chrome is deleted and unreferenced"; `themeContract.test.ts` asserts `CONTRACT_WAIVERS === {}`;
> `tests/theme-engine/layout.test.ts` asserts no registered theme restricts `layouts`. **The section below
> is HISTORY** — the original 2026-07-06 inventory and rung plan, kept for provenance.

Vapor is already IN the engine (registered ThemeDef, bespoke Root — a legitimate D31 band; behavior extracted
to shared controllers in M2). "Frozen" = exactly **six legacy hooks**: ① accent rides `body[data-theme]`
(branches in `applyBodyAttrs` ui.ts:198 + the index.html FOUC script — the tracked exceptions to the
DEFAULT_THEME rule); ② non-contract token vocabulary (`--magenta`/`--accent-grad`/`--ink*`); ③ unprefixed
`@keyframes`; ④ parallel chrome (components/AppBar·Composer·TabBar vs Kit's); ⑤ the `isVapor` PinnedPlan gate;
⑥ CSS living in `theme/` not `themes/vapor/`. Ladder (each stage additive, independently shippable,
D7-eyeball-gated; unscheduled — after the catalog stabilizes):

- **V1 — file + keyframe hygiene:** move CSS to `themes/vapor/`, prefix keyframes `vapor-*`, delete the
  stylelint allowlist entries. Intra-scope cosmetic; lowest risk.
- **V2 — accent axis (`data-theme` → `data-accent`), ONE atomic commit, five touchpoints:** both writers
  (ui.ts:198-206 + index.html:38-43) · all four `[data-theme="aqua"|"ember"]` selectors in vapor.css
  (58/107/113/162 — palettes + `.hero`; each block defines the `--accent-rgb` the shared Waveform live-reads,
  the silent-failure canary: the bar color must still shift on a palette pick) · flows.spec.ts:134's assertion ·
  the §13.1 frozen-attr table (whose line refs are stale — refresh to 58/107/113/162). Namespace check settled
  at review: every `[data-accent]` reader lives inside a per-skin `@scope` → vapor's accent ids cannot collide
  with kit accent ids. Accent VALUES don't change → `migrateLegacyTheme` + its FOUC twin stay.
- **V3 — semantic-token mapping:** map vapor's vocabulary onto the contract at the top of its sheet
  (`--accent: var(--magenta)` — semantically correct: aqua remaps `--magenta` to cyan, so it IS "the primary
  accent"); shrink the B2 waiver list. @layer order must hold (a wrong-layer token re-opens §13.2).
- **V4 — per-component graduation, ordered by divergence (LOW first), tracked by the shrinking waiver list +
  the §14.4.1 two-trees note:** Conf editors → shared overlays (precondition for the deferred App-hoist of
  overlay mounting, §14.15.4) → **chat LAST and via the D31 3-gate, not tokens** — vapor's chat is
  structurally divergent (pulse animation, `▸/▾` pseudo-element disclosure, terminal-vs-neutral gestalt);
  if V3 tokens can't carry its look through the shared classes (likely), the correct retirement is a
  **ChatSurface variant** over `useAgentChat` (split AgentTab into kit chat-element presenters + a view shell
  at that point — the graduation recipe), NOT deleting extras.css's block. Chat graduation must relocate
  `PinnedPlan` (composer addon like kit, or a token-driven shared widget) and removes hook ⑤. Composer/Fleet
  variant registration = the Composer Surface plan (independent track). V4 checklist riders: promote
  `--accent-rgb`/`-2` into the contract as explicit canvas channels when a shared canvas graduates (derive in
  JS from `--accent` once per readColors tick, don't hand-maintain triplets), and re-point Waveform's
  vapor-private reads (`--magenta` :192 AND `--ink-faint` :194) at contract tokens.
- **V5 — chrome dedup (tail):** fold AppBar/Composer/TabBar only where ≥2 themes genuinely share structure
  (D31 bites hardest here — forcing vapor's bespoke chrome into a Kit mold is the anti-pattern). The only
  stage with real fidelity risk.

**Standing guarantees (every slice, until the ladder completes):** nothing new depends on a legacy hook (no
new `data-theme` readers, unprefixed keyframes, or theme-id gates) · exemptions live in shrinkable waiver
lists (B2 constant + stylelint allowlist), never scattered skips · engine code uses `DEFAULT_THEME`
(resolve.ts), never a `"vapor"` literal (ui.ts DEFAULTS/migration + the ①-hook branches are the tracked
boundary exceptions) · shared-markup changes obey the two-trees rule.

## 14.15.4 Backlog (post-hardening, in no order) + reviewed-and-rejected

**Backlog:** `kit.css` off the eager path (~100KB raw/10KB gz) — ~~inert under vapor~~ **that premise died at
D51 V4: vapor renders `.kit`, so kit.css applies to EVERY theme and none of it is inert (`theme/index.css`
says so at its `@import`). The item survives on its remaining merit — it is eager weight a theme's lazy Root
chunk could carry — and its preconditions below are unchanged.** **Precondition:** wrap
kit.css's body in `@layer base { … }` internally FIRST (a bare JS `import "./kit.css"` can't carry
`layer(base)`; unlayered it outranks every layer and inverts the cascade), then drop the index.css @import and
static-import it from DefaultRoot (rides the lazy Root chunks; verify a cold boot into minimal still paints
styled). · **Overlay mounting App-hoist** (§14.1's locked end-state) — **precondition:** re-scope the overlay
CSS first (kit.css styles overlays as `.kit .modal` descendants; hoisted outside DefaultRoot's `.kit` element
they render unstyled under Kit themes — both review agents missed this; part of the V4 overlay graduation). ·
vapor-fonts.css comment: drop/qualify "offline-capable PWA" (woff2 aren't SW-precached; theme JS/CSS chunks
ARE — verified in dist/sw.js). · ~~OKLCH gamut/chroma-ceiling advisory in B2~~ **✅ BUILT 2026-07-12 (frontier
F1 pre-flight):** the B2 warn-only gamut scan over each mapped theme's `tokens.css` `oklch()` LITERALS (culori
`inGamut("rgb")` + a `clampChroma` suggestion; emits via `process.stderr.write` — vitest's reporter hides
console output from passing tests) + the §0 authoring row. Formula/`color-mix()` tokens stay e2e-probe
territory (runtime-resolved).

**Reviewed and REJECTED (do not resurrect without a new trigger):** storage-event/BroadcastChannel listener
(uncovered fields are per-device BY DESIGN; synced fields already reconcile) · woff2 SW precache/runtime-cache
(app is dead offline — no tailnet → no backend) · @scope boot probe / `@supports` vapor duplicate ·
per-theme-eager-CSS rework ~~(vapor is default + flagship; revisit only if the owner permanently settles on
another theme)~~ — **✏️ the REASONING is superseded, the verdict RE-EARNED (D51 V6, 2026-08-02): vapor is
NOT the default any more (cosmos is, since V0) and it stays eager on its own merits — the flip was measured
(the whole slice is 26.5 KB raw / 5.3 KiB gzipped, and vapor's woff2 files are usage-lazy regardless) against
real new mechanism, and DROPPED. Revisit only if that ratio changes.** · screenshot diffing · **tab BODY registry — ✅ BUILT 2026-07-12 as frontier F0 / D35 (the
SECTION LAYOUT SYSTEM v1; commits `b7f63d4…76c0d74`). As-built: `TabDef` stayed PURE DATA (gains only
`lazy?`) — the id→body defaults live in kit space (DefaultRoot's `DEFAULT_BODIES`) and per-theme overrides
ride the generalized `bodies` prop (the `Fleet={…}` fold resolved as data-fold + prop-injection, D35's
"eager DATA, lazy COMPONENTS" ruling); every constraint below was honored (keep-mounted · generic `lazy`
latch · the composer-surface preserve-list). Historical trigger record:** TRIGGERED (owner-ratified 2026-07-07): frontier
is "a theme that actually needs a different section" (bespoke Agent body + a 3-tab set), so the id→body
completion of `tabs.ts` (each `TabDef` gains a `body` component; standard four as defaults, per-theme
overrides) is scheduled as the frontier plan's step 0 (§14.10 T5), AFTER Hardening v2 — the design has since been LOCKED and WIDENED into the SECTION LAYOUT SYSTEM v1 (owner review 2026-07-07): spec = `FRONTIER_PLAN.md` §1/§6-F0 (curated 4/3/2-tab presets · global synced lever · generalized menu affordance · utils-in-Conf hosting), superseding this entry's narrower registry wording. It REPLACES
DefaultRoot's hardwired `tab === "…"` branch (no parallel mechanism) and subsumes the accreting per-region
props — fold `Fleet={…}` into it when it lands (owner leaned fold; confirm at the design review, where the
D-entry gets drafted). Constraints: preserve keep-mounted semantics (active flags, never conditional-render)
and keep the lazy-Conf latch / scroll-reset / `--composer-h` measurement generic (e.g. a `lazy?` TabDef
flag); **and preserve the COMPOSER-SURFACE wiring the shipped feature added to DefaultRoot
(2026-07-11) — the `useComposerLayout()` read (also a `--composer-h` effect dep), the
`usePlanPlacement()`→`composerAddons` inline-plan composition, and the `ThemedComposer
layout={…}` render — all interleaved in the same component the registry rewrites.** The D31
Surface axis stays separate — variants ≠ tab composition.** ·
a third perf tier · scroll restoration across switches · quarantine subsystem · aria-live announcement (see
riders).

## 14.16 Presentation axes — the `axes` cascade layer + `body[data-*]` stamps (D37; added 2026-07-13, frontier F5 slice A)

**What an axis is.** A cross-theme LOOK lever (Tokens band — §14.14; never a Surface): a per-theme
setting (§14.3, auto-rendered + synced) + a shared factory/resolver on `resolveThemeSetting`
(`theme-engine/kit/axes.ts`; undeclared themes → the kit-native look; no theme-id branching) + a
`body[data-*]` stamp projected by `<AppEngines/>` in a `useLayoutEffect` (NOT `applyBodyAttrs` — the
store↛registry hazard). Axis override CSS lives in `theme-engine/kit/axes.css`, imported at the NEW
cascade position **`@layer base, theme, axes, reset`** (`theme/index.css`): it outranks `@layer theme`
because the stamp already encodes theme-default + user override resolved — a theme's own rules can't veto
the user's choice.

**Invariants.** (1) The axes layer **strips/swaps only** (borders, a focus-ring replacement) — **never
fills**; it beats theme CSS, so a fill there would clobber theme inks. Fill-differentiation stays each
theme's job. (2) Every selector is `.kit`-scoped (inert on vapor) AND gated on the stamp. (3) Only kit
semantic-contract tokens (§15). (4) Promote a theme-private strip into an axis only when a second
consumer wants it (§14.14 graduation philosophy).

**Built axes:** `outlines` (chat-scoped — the D36 §15 hook families; minimal/cosmos default ON, frontier
OFF = its F4 look) · `composerSkin` (✅ BUILT 2026-07-15, F5 slice B — `outline`|`glass`|`bezel`|`sleek`,
**+ `arcade`** (added D52 G3: a flat, opaque CABINET PANEL — no frost, no elevation, a hairline edge, tight
corners, squared-off controls; born of gacha's prototype but LOOK-named and authored on semantic tokens, so
it is a real catalog member any theme can wear — never a theme-scoped bypass of D37);
frontier defaults `bezel`, minimal/cosmos `outline`; declared right after the `composer` layout seg so the
two rows render adjacent). Its skins are first-class kit chrome in kit.css keyed on
`body[data-composer-skin]` (a dedicated "composer skins" section), NOT axes-layer strips; the composer
LAYOUT catalog deduped to the three real components `[stacked, sheet, line]` (borderless/ghost → the
glass/sleek skins). No theme styles composer chrome directly (D37 authority rule: outlines axis owns the
chat thread, skin axis owns the composer). **2026-07-30 — the axis grew to the composer's OVERLAY POPOVERS**
(`.kit-suggest` · `.tools-sheet`): one shared shell recipe (§15) plus one per-skin block each — glass = the
plan sheet's neutral frost + the bar's elevation (perf-lite → opaque), bezel = the bar's dusk drop + inset
light edge, sleek = flat + tight, outline = the un-keyed base. `.priv-menu` shares the SHELL but not the
axis: it is chat-header chrome, not composer chrome. One sanctioned TS seam: KitComposer picks its default send
glyph by resolved skin (glass → arrowhead). Full as-built rationale: **DECISIONS D37 (amended
2026-07-15)**.

## 14.17 SECTION LAYOUT SYSTEM v1 — the section-composition contract (D35; ✅ BUILT 2026-07-12 as frontier F0)

**What this owns.** *Where* the app's standard sections live, and how a theme composes them. The RATIONALE
record (why curated presets, why hosting, the review that widened the tab-body registry into this) stays in
`FRONTIER_PLAN.md` §1/§6-F0; **this section is the live authoring surface.** Principle: *functionality =
modules; layout = modes that recompose WHERE modules live.* A preset never adds or removes a section.

**The lever.** `ui.layout: "auto" | LayoutId` (`store/ui.ts`) — **GLOBAL and cross-theme, but per-DEVICE:
persisted locally, NOT synced** (a layout choice legitimately differs per screen), exactly like `appbarMode`.
`"auto"` = the active theme's declared default. A concrete pick is resolved by
**`theme-engine/layout.ts#resolveLayout(themeId, lever)`**, which is a *coercion*, not a validation:
`ThemeDef.layouts` (omit → **all** presets, the ratified ideal — no registered theme restricts the set today)
is the supported set and `ThemeDef.defaultLayout` (omit → `4-tab`) the theme default. Recovery has two
distinct branches (`layout.ts:74–91`): a value this build doesn't know at all (rolled-back or hand-edited
localStorage) falls back to the **theme default, silently**; a *known* preset the theme doesn't support is
coerced to the **nearest supported preset** by tab-count distance (tie → the larger) with a
once-per-`(theme, lever)` dev warn. Either way the lever can never crash a render.

**The presets** (`LAYOUT_PRESETS`, curated — do not add one casually): `4-tab` = `[fleet, agent, utils, conf]`
· `3-tab` = `[fleet, agent, conf]` + utils **hosted** in conf · `2-tab` = `[fleet, agent]` + the same hosting.
Two axes fall out: **(A)** a section that is off-bar *and* unhosted gets the floating `NavMenu` affordance;
**(B)** a **hosted** section renders INSIDE its host's body instead of standalone (utils→conf is the ONE
curated pair — concrete-first; generalize only if a second appears). `partitionSections` is pure and skips any
id a given theme doesn't declare, so a preset naming a section a theme lacks is harmless. `appbarMode:
"minimal"` folds in here too: it is treated as an empty bar, so every section lands in the menu.

**The consumer chokepoint.** `hooks/useSections.ts` is the ONE headless controller — it returns
`sections` (the theme's full list) · `bar` / `menu` / `hosted` (the partitions) · the resolved `layout` ·
`active` · `hasComposer` (the ACTIVE section's flag, so per-preset composer visibility is automatic) ·
`navigate`. **Never re-derive a partition or re-read the lever in a component** — the tab bar, the `NavMenu`,
and `DefaultRoot` all consume this, and the hosted-section coercion (navigate → host + arm the scroll-to-group
handoff at `HOSTED_UTILS_GROUP_ID`) lives there once. `layout.ts` and `tabs.ts` are held to the same purity
rule: **no component imports**, and the `registry` is read at CALL time only, never at module init.

**What a theme authors.**
- **Bodies:** the id→component defaults live in kit space (`DefaultRoot`'s `DEFAULT_BODIES`); a theme overrides
  per section through the **`bodies` prop** (`<DefaultRoot bodies={{ fleet: CosmosFleet }}/>`) — a merge over
  the defaults, not a replacement. This is D35's *"eager DATA, lazy COMPONENTS"* ruling: `TabDef` stays pure
  data (that's why `tabs.ts` has no component field), and a theme's bodies co-load with its lazy Root chunk, so
  they need no extra code-split.
- **`TabDef` fields** (`theme-engine/types.ts`): `subLabel?` = an optional second label line under `lbl` on the
  tab bar (gacha's Japanese nav labels; the floating `NavMenu` is icon-only and ignores it) · `lazy?` = the
  generic lazy-mount flag (mounted only once its section first becomes active, then **kept mounted** so draft
  state survives; `DefaultRoot` wraps it in `ErrorBoundary`+`Suspense`). Conf is the only `lazy` section today.
- **Capability declaration:** `defaultLayout?` / `layouts?` on the `ThemeDef` (§14.3) — a seam for a theme whose
  presentation genuinely can't express a preset. vapor's ladder-owned `["4-tab"]` waiver retired at D51 V6.

**Invariant (inherited, non-negotiable).** Non-hosted section bodies are **keep-mounted and `active`-gated —
never conditional-rendered on layout grounds**; only a hosted body is skipped by the mount loop (its host
renders it). Anything that measures or latches (`--composer-h`, the scroll reset, the lazy latch) stays
generic — no `tab === "…"` branch comes back.

# §15 — The CHAT HOOKS + TOKEN CONTRACT (→DECISIONS D36; specified at the frontier F4 pre-flight, 2026-07-12)

**What this is.** The agent chat renders ONE shared component tree for every theme (§14.10's "shared +
reskinned" band): `tabs/AgentTab.tsx` (bubbles · confirm/question flows · retry · TTS · privilege chip;
F4 extracts the log core into `components/ChatThread.tsx` with an `emptyState` slot) + `lib/markdown.tsx`
(markdown + the code block's copy/edit actions) + `components/PlanSteps.tsx` + the composer plan family
(`theme-engine/kit/composer/plan/*`). This section PINS that tree's class hooks + the tokens they consume
as the styling contract: a theme reskins the chat by (a) its `tokens.css` values and (b) theme-scoped CSS
targeting THESE hooks — never by forking the DOM. The names are the legacy vapor idiom **formalized
AS-IS** — kept that way now for churn reasons only (D51 finished vapor's assimilation, so a rename would
touch every theme's CSS, not just vapor's, for zero behavior). Styling home:
`kit.css` BUCKET-A.3a (base conversation) · A.3b (markdown) · A.3c (command/question/TTS). Enforcement:
hardening ⑧'s `themeContract.test.ts` grows contract assertions on these hooks when warranted; until then
this table is the pin.

| Region | Hooks |
|---|---|
| Log container | `.chat-log` (`#chatlog`) |
| Bubble kinds | `.b` × `.user` / `.bot` / `.sys` / `.cmd` — modifiers `.cmd-resolved` · `.question` · `.plan-note` |
| Bubble anatomy | `.who` (+ `.status-tag` · `.tts-play`[`.playing`/`.loading`]) · `.body` |
| Streaming | `.dots` (+ `i` children) · `.caret` |
| Chat error | `.chat-err` · `.chat-err-msg` · `.chat-err-retry` |
| Reasoning | `details.think` → `summary` (`.label`/`.hint`) + `pre` |
| Command detail | `details.cmd-detail` → `summary` (`.preamble`/`.cmd-gate`/`.chev`) + `pre` |
| Command outcome | `.cmd-result` + state class (`running`/`ok`/`error`/`skipped`) · `details.cmd-output` · `details.cmd-links` (`.label`/`.hint` · `ol li a` · `.src`/`.snip`) |
| Gate/approve actions | `.actions` → `.exec`/`.edit`/`.dismiss` (shared by confirm-gate · proposed-write · question) |
| Question bubble | `.q-prompt` · `.q-input-wrap` · `.q-input` |
| Markdown | `.md` (the A.3b block/inline element set) · `.md-code` → `.md-code-bar` (`.lang`/`.acts`) + `pre>code` |
| Plan | `.plan-note` · kit `.plan-pin-panel`/`.plan-pin-head`/`.plan-pin-drop` · shared `.plan-steps`/`.plan-step`[`.pending`/`.active`/`.done`]/`.tick`(`.tick-btn`)/`.txt` · composer `.plan-pill`/`.plan-sheet`. (vapor's old in-tab `.plan-pin`/`.plan-pin-wrap`/`.plan-drop` are **DELETED** — D51 V4/V5; vapor now reskins the KIT panel's `.plan-pin-panel`/`.plan-pin-head` hooks, the §15 route, so its centered flush hanging tab is theme CSS over shared markup) |
| Composer popovers | `.kit-suggest` (A2 — `li`[`.active`] → `.sg-val`/`.sg-kind`) · `.tools-sheet` (A6 — `.tools-sec`/`.tools-lbl`/`.tools-list`/`.tools-row`[`.on`]/`.tools-radio`/`.tools-tick`/`.tools-name`/`.tools-tag`/`.tools-empty`/`.tools-clear`; trigger `.kit-cbtn.tools`[`.open`] → `.tools-dot`). Both carry `.open` (mounted-when-closed + `inert`, like `.plan-sheet`) and share ONE shell recipe with `.priv-menu`; the two composer-anchored ones ALSO take per-skin chrome from the `composerSkin` axis (§14.16) — `.priv-menu` deliberately does not |
| Chat section header | `.sec` (`.num`/`.right`) · the privilege family `.priv-chip-wrap`/`.priv-chip`(`.set`)/`.priv-dot`/`.priv-lbl`/`.priv-backdrop`/`.priv-menu` |
| Notices | `.notice` (+ `.heart`) |

**Component tokens.** The buckets consume ONLY the semantic contract (§9.7): `--text/-2/-3` ·
`--accent`/`--accent-soft` (never `--accent-fill` — it may be a gradient `<image>`, §14.15.1 ⑨) ·
`--line/-2` · `--surface/-2` · `--bg` · `--radius-*` · `--font-body`. *(Font caveat: only **`--font-body`** is
a kit-contract token — `kit/tokens.css` declares it and `themeContract.test.ts` requires it. **`--font-display`
and `--font-mono` are THEME-PRIVATE**, not contract: `--font-display` is declared by vapor/cosmos/frontier and
read OPTIONALLY by the kit exactly once, defensively — `kit.css`'s nav glyphs use `var(--font-display, inherit)`
— while `--font-mono` exists only inside gacha. A theme that declares neither is fully conformant; never author
a shared surface against an unfallbacked read of either.)* A theme needing a
chat-only value adds a THEME-PRIVATE token in its own tokens.css (frontier: a mode-flipped near-black
bubble fill), never a new contract token; promotion needs a second consumer.

**Rules.**
1. **Same DOM, themed skin** — the reskin band is tokens + theme-scoped CSS on the hooks above.
2. **Per-element escalation only**: an element that provably can't reach D7 fidelity via CSS escalates
   through the 3-gate (§14.14) at the slice review; a second theme needing a structurally different log
   is what births a ChatSurface (D34 ladder V4 rider) — not before.
3. ~~**Grandfathered**: `AgentTab`'s `isVapor` branch (vapor's frozen in-tab `.plan-pin`) — the one
   sanctioned theme-ID gate.~~ **RETIRED at D51 V4:** vapor declares `planPlacement: "pinned"` and takes the
   shared `PinnedPlanPanel` path, so `AgentTab` has NO theme-ID branch left. There is now **zero** sanctioned
   theme-ID gate in the shared tree (§14.14's no-`if (theme === …)` invariant holds everywhere).
4. **Growth rule**: ACA Phase 12 chat features (Stop/steering/approvals) land INSIDE the shared tree and
   ADD their hooks to this table in the same change.
5. **Always-mounted chat engines live in `<AppEngines/>`** (§14.5): `useChatInit` · `useAutoTts` ·
   `usePlanOpenAutoClose` (re-homed from AgentTab at F4) — a theme body replacing the agent section can
   never lose them.
