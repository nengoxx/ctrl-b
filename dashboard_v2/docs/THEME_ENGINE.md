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
> **FROZEN — do not touch**). **`vapor.html` (proto) is DROPPED** — it's the *old* vapor design; the shipped
> React vapor is the improved one. **observatory = TBC** (owner hasn't confirmed; treat as optional/later).
> frontier is kept **exactly as-is including its hand-drawn art** (see §6).

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
   vapor-proto dropped. **observatory still TBC** — the one remaining scope question (include or shelve?).
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
