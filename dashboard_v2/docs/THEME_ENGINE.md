# Theme Engine — analysis & design (D28, in design phase)

**Status: ANALYSIS DONE, DESIGN OPEN.** This doc captures a deep analysis of the owner's six theme
prototypes (`prototypes/project/variations/*.html`) and proposes a multi-theme architecture for the
React app. It is the design-phase home; lock decisions here (→ DECISIONS **D28**) before coding.

> **The ask (owner, 2026-06-26):** keep **vapor** with its palettes, and add the prototyped themes
> **exactly as they are** (nuances + complexity preserved, not approximations). Build a "theme engine"
> that switches between vapor / cosmos / frontier / minimal (and their palette options) and lets us
> **natively add new theme variations** that are as dynamic/flexible as the prototypes.

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

### 9.0 The current architecture (AS-IS) — what T0 plugs into

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

| Slot | Owner | Notes |
|---|---|---|
| AppBar, Composer, TabBar, TabIndicator, ConfShell + rows, ChatBubble | **BASE** (token-styled) | Themes restyle via tokens, not structure. vapor keeps its own (frozen). |
| **FleetView** | **theme** (the signature) | base = device rows (minimal/phosphor/observatory-list). cosmos = orbital; frontier = map+beacons+rig-grid; observatory = SVG topology FleetView variant. |
| **HostDetail** | base default; theme override | base = inline expandable body (stats grid + action bar + services). frontier = **bottom sheet**; cosmos = **slide panel**. The stats/actions/services *contents* are shared sub-components. |
| **NowMonitoring** (featured host + live Waveform) | **BASE shared slot** | The auto-cycling featured card recurs in minimal/cosmos/frontier — built once, themes style via tokens. vapor stays on its own `Hero` (untouched). |
| Hero | vapor-only | vapor's animated sun/grid/skyline scene; non-vapor themes use NowMonitoring or nothing. |

### 9.6 CSS strategy — per-theme bundle, `[data-skin]`-scoped, lazy, **isolated by CSS `@layer`**

> **⚠️ Corrected by the final review (§13).** The isolation mechanism is **CSS Cascade Layers**, and the
> theme-identity attribute is **`data-skin`**, NOT `data-theme` (which stays vapor's frozen accent axis). The
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

The base + non-vapor themes consume a **fixed semantic contract**; each theme's `tokens.css` maps it. **vapor
does NOT adopt this** (frozen — it keeps `--magenta`/`--violet`/`--accent-grad`). Contract (superset distilled
from the prototypes):

```
--surface, --surface-2          surfaces (bg ladder)
--text, --text-2, --text-3      text ladder
--line, --line-2                borders/hairlines
--ok, --warn, --danger          status (+ -soft alpha variants)
--accent                        a TRUE <color> (for color/border/fill-as-solid)
--accent-fill                   flat-or-gradient, consumed ONLY via background/background-image
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
**`applyBodyAttrs` writes a NEW identity attribute `body[data-skin] = theme`** (vapor/minimal/…) for slot +
CSS scoping, and **leaves `body[data-theme]` meaning exactly what it does today — vapor's frozen accent axis
(`dark`|`aqua`|`ember`)**, set only when `theme==="vapor"` (from the `accent` value) — and **actively cleared
(`delete body.dataset.theme`) when skin≠vapor**, since `applyBodyAttrs` rebuilds attrs each call and a stale
`aqua` would otherwise leak. (`mode` and the vapor accent named "dark" are *different axes* that coincidentally
share the string "dark" — benign: vapor declares no `mode` axis, so its `data-mode` is unused.) For non-vapor
themes it additionally sets `body[data-mode]` and `body[data-accent]` (the prototypes scope palettes by attribute) and
may inject `--accent`/`--accent-fill` for computed-OKLCH accents. `ThemeDef.palettes` declares which axes the
Conf picker renders (vapor → named accents only; minimal → mode toggle + 4 hues; phosphor → amber/green; etc.).
Existing vapor attrs (`data-theme`/`data-skyline`/`data-loz`/`data-motion`/`data-tab`) keep their current
meaning — they're vapor's frozen attribute contract (full list in §13.1).

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
  fallback otherwise. **Self-host via Fontsource** (npm, version-pinned, offline-capable — matters for the
  PWA) rather than the Google CDN `<link>`; vapor keeps its current `index.html` `<link>` (frozen).
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
- **Load sequence (no-flash).** (1) An **inline script at the TOP of `<body>`** (NOT `<head>` — `document.body`
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

## 10. Prototype → theme-module porting playbook

The drift-minimizing convention (web-cited: verbatim plain CSS + 1:1 JSX is what keeps re-sync mechanical).
**Goal: editing a prototype HTML later and re-porting is a near-mechanical diff, not a rewrite.**

1. **Create the module dir:** `theme-engine/<theme>/` → `index.ts` (the `ThemeDef`), `tokens.css`,
   `<Theme>FleetView.tsx` (+ any other slot it overrides), `assets/`, `fonts` (Fontsource imports).
2. **CSS — copy verbatim, scope once, assign a layer.** Lift the prototype's `<style>` block **unchanged**
   into `tokens.css`, wrapped in `body[data-skin="<theme>"] { … }` (native nesting) and imported into
   `layer(theme)` (§9.6, §13.1–13.3). Use a `cb-` class namespace for any chrome that overlaps vapor's global
   names. Do **not** rename the prototype's own classes or re-derive colors. Map the prototype's `:root` vars
   onto the semantic contract (§9.7) at the top; keep the theme's own extra vars as-is. Declare
   `@font-face`/Fontsource imports here.
3. **JSX — 1:1 with the prototype markup.** Port the prototype's fleet DOM into the slot component with the
   **same tree + same class strings** (run it through transform.tools/html-to-jsx for the mechanical
   `class→className`/self-close/camelCase pass). Replace the prototype's hardcoded `DEVICES`/`RIGS` array with
   the real `useFleet()` data; replace its inline visual fields with `present(host, index, host.appearance?.[id])`.
4. **Animation — port the rAF/canvas logic into a `useEffect`** keyed to the data, gated by `ui.motion`
   (reuse the existing motion flag, don't add an OS `prefers-reduced-motion` branch — CLAUDE.md). cosmos orbit
   loop, minimal/cosmos waveform, frontier sweep → effects with cleanup.
5. **Keep dynamic React to a thin wrapper.** Avoid inline `style=` (hardest to re-port); keep styling in
   `tokens.css`. Confine `{…}` injection to data points (host list, status, ping).
6. **Register:** one row in `ThemeRegistry` + the Conf picker reads `palettes` automatically. Done.
7. **Re-sync workflow:** owner edits `prototypes/.../<theme>.html` → re-run steps 2–3 as a diff against the
   committed module (CSS is a near-verbatim paste; JSX changes track the markup diff). Document any structural
   change in the module's header comment.

**Acceptance per theme (D7-per-theme):** open the module at 390px side-by-side with its prototype — visually
indistinguishable. vapor's acceptance is stricter: **byte-for-byte unchanged** vs today's build.

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

Each item is a confirmed fix from the review; build T0/T1 against these, not the pre-review wording.

**13.1 — `data-skin` ≠ `data-theme` (CRITICAL — would break vapor).** vapor.css gates its **aqua/ember
palettes entirely on bare `[data-theme="aqua"|"ember"]`** (vapor.css:51/100/106/153/155; "dark" = the bare
`:root` default, no `[data-theme="dark"]` rule). Overloading `data-theme` with the ThemeId silently kills 2 of
vapor's 3 palettes. **Fix:** ThemeId lives on a NEW `body[data-skin]`; `body[data-theme]` keeps meaning
vapor's accent (`dark`|`aqua`|`ember`), set only when skin=vapor; non-vapor bundles scope under `[data-skin]`.
**vapor's full frozen attribute contract** (all must keep current meaning):

| Attribute | Element | Used for | Where |
|---|---|---|---|
| `data-theme=aqua\|ember` (absent→`:root`) | body | vapor palette swap + `.hero` overrides | vapor.css:51,100,106,155 |
| `data-loz=ring` | body | lozenge variant | vapor.css:188; extras.css:82 |
| `data-skyline=city\|mountains` | body | skyline show/hide | vapor.css:398–399 |
| `data-tab=…` | **`.tabbar`** + body | tab indicator slide | vapor.css:253–255; TabBar.tsx:58 / ui.ts:67 |
| `data-motion=reduced` | body | motion kill | extras.css:82–93 |

**13.2 — Token-name collision, solved by `@layer` (NEEDS-MITIGATION).** The contract reuses 3 names vapor
defines in its always-loaded `:root`: `--line`, `--line-2`, `--accent-glow` (vapor.css:17,18,24). Without
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

**13.6 — `App.tsx` slot-host must preserve shell orchestration (NEEDS-MITIGATION).** The slot list models
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
}
```

**Per-theme settings (the "minimal hides the appbar" mechanism).** A theme declares `settings` = a small schema +
defaults (e.g. `{ hideAppbar: { type:"switch", label:"Hide app bar", default:false } }`). The Appearance picker
auto-renders the active theme's settings; values live in an **open `ui.themeSettings[themeId]` map**, persisted +
**synced** via the appearance channel (extend `AppearanceCfg`, additive); read with `useThemeSetting(id, key)`. The
theme's `Root` reads them and reflows. **No app/core change to add a theme's bespoke option.**

## 14.4 The Kit (optional reuse) + token contract

`theme-engine/kit/` — token-driven presenters consuming the **semantic contract** (§9.7, three-tier: global → semantic →
component): `DefaultRoot` (the standard appbar+nav+sections+composer scaffold, parameterized by the theme's section
views + `hideAppbar`-style settings), `AppBar`, `NavBar` (count-driven indicator §13.8), `Composer`, `ConfShell`, device
rows, `NowMonitoring` (+ waveform reading `--accent` via `globalAlpha`, §13.7 alt), `ChatBubble`, and primitives
(`Seg`/`Switch`/`Field`/`Card`). **Reskin themes** (minimal/phosphor) = `Root` is `<DefaultRoot sections={…}/>` + a
`tokens.css` + fonts + a Fleet view. **Bespoke themes** (cosmos/frontier) write their own `Root`. **The deep Conf
editors** (AgentsEditor/MachineEditor/Skills/Memory/Integrations/ToolCatalog) are **reused as-is and skinned by the
Kit/theme CSS** (their classes styled token-driven) — not re-authored per theme. Global overlays (toasts/confirm/prompt/
mini-player) become Kit/token-driven so they restyle per skin.

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
  skyline/etc. rules match `<body>` as a descendant. The sheet is wrapped **verbatim** in `@scope ([data-skin="vapor"])
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
- **Default theme (vapor) CSS eager** (static import → blocking `<link>`, no first-paint FOUC); others lazy (Vite
  guarantees async-chunk CSS before chunk eval). Inline `<body>`-top script sets `data-skin` early (T0, kept). A
  non-default returning user gets **one** View-Transition switch on cold load (accepted; single user, PWA-cached).
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
minimal `tokens.css`/fonts/OKLCH matrix/Fleet, real data) → **T2 phosphor** (tokens+fonts+CRT, reuses Kit) → **T3
observatory** (low-pri; FleetView + `present()`) → **T4 cosmos** (own Fleet Root/orbital + slide-panel HostDetail +
`present()`) → **T5 frontier** (own Fleet + **bespoke Agent** anims + bottom-sheet + assets + `present()`). D7 per theme;
390px eyeball + pause after each.

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
theme that adds blur/animation must honor them (store/ui `motion`/`perf`; `perf` is **device-local**, not
synced, since it's a per-device speed lever).

**Canvas / `requestAnimationFrame` loops** (waveforms, frontier anims): cap the frame rate (~30fps is smooth
for ambient), **pause when off-screen** (IntersectionObserver — the tab stays mounted but `display:none`), and
**never call `getComputedStyle`/`getBoundingClientRect` per frame** — cache them (refresh on a low cadence /
ResizeObserver). See `components/Waveform.tsx` for the reference implementation.

**Layout robustness (any browser).** Text must never overflow its container horizontally. Long unbreakable
strings — backend errors, URLs, paths, JSON tokens, host/model/agent names — must wrap: put `overflow-wrap:
anywhere` on the text container (it's inherited and also shrinks min-content so flex items can't push past the
edge), and give flex text items `min-width: 0`. This is a recurring bug class (the chat-bubble error overflow,
the Conf label overflow); bake the wrap rule into any new text surface from the start. Keep the app's main
scroller `overflow-x: hidden` (a vertical-only scroller computes the x-axis to `auto` otherwise, so a stray-wide
child adds a horizontal scrollbar), and theme the scrollbars — thin + themed thumb **and** a transparent
`::-webkit-scrollbar-corner`, so Chrome's default light corner box never flashes against a dark theme.
