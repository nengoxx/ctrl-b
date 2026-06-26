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
| **frontier** | **dusk "badlands"** (see §6 — *not* comic) | night/day × 4 accent | **photographic map w/ GPS beacons + 2-col photo "rig-card" grid + modal bottom sheet** | **HIGH** |
| **vapor (proto)** | evolved vapor | light/dark | **auto-cycling featured-device carousel + live canvas waveform hero** | **HIGH** (vs shipped static Hero) |

Recurring motif across minimal/cosmos/frontier/vapor-proto: a **"now monitoring" featured host** (big
stats + a live `<canvas>` ping waveform, often auto-cycling every 5s). Worth treating as a shared concept.

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
- **Token normalization (the enabling refactor).** Define a semantic interface — `--accent` (resolved
  to a gradient *or* flat color via a single `--accent-fill`), `--accent-soft`, `--surface{,-2}`,
  `--text{,-2,-3}`, `--line{,-2}`, `--ok/--warn/--danger`, plus opt-in decoration tokens
  (`--glow-*`, gradients) that themes may leave unset. Refactor the shipped vapor components to consume
  these instead of `--magenta`/`--ink-soft`/`--accent-grad` directly; vapor's `vapor.css` becomes the
  vapor *mapping* of the interface. This is behavior-preserving for vapor and unlocks every other theme.
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

- **T0 — Foundation (the engine + token normalization).** Semantic token interface; refactor vapor
  components onto it (behavior-preserving, vapor still pixel-exact — the D7 acceptance test); the
  `ThemeRegistry` + slot resolution; generalize the `ui` store to `{theme,mode,accent}`; per-theme font
  loading; the Conf → Appearance theme/palette picker. **Ships with vapor only** (proof: nothing changes
  visually) — this de-risks everything.
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
- **(optional) vapor-proto hero** — fold the auto-cycling canvas "now monitoring" carousel in as a
  vapor `Hero` evolution, *or* as the shared `NowMonitoring` slot minimal/cosmos/frontier also use.

## 5. Open decisions — settle before/within T0 (owner input needed)

1. **Scope: which themes ship?** The owner named 3 (cosmos/frontier/minimal). There are **6** prototypes
   (+ observatory, phosphor, and an evolved vapor-proto). Are observatory/phosphor in scope? Is
   vapor-proto meant to **replace** the shipped static vapor Hero, or be a separate option?
2. **Theme persistence: backend-synced vs client-local.** Sync across Android+desktop (config) vs simple
   per-device (localStorage, as today). Recommendation: backend for selection+custom accent.
3. **Per-host presentation data.** Deterministic derivation (role/status/index → planet/beacon) — zero
   config, but the owner can't hand-place a planet — vs an explicit per-host `appearance` override block
   (more faithful to the authored prototypes, more config). Likely both (derive + optional override).
4. **frontier's assets.** The prototype uses real per-host **photos** (`rig1–6.png`) + a `hero.png` map.
   The real app has no per-host imagery. Strategy: generated/placeholder art, an optional per-host image
   field, or a non-photographic faithful reinterpretation? (Affects "exactly as they are.")
5. **Utils/Tools tab.** All prototypes dropped it. Keep the 4th tab in a generic per-theme style, or let
   themes declare a 3-tab set and fold Tools elsewhere?
6. **OKLCH / `color-mix` baseline.** Prototypes use `color-mix` (srgb+oklch), `oklch()`, `100dvh`,
   `backdrop-filter`. Fine on the owner's modern Android Chrome/Firefox; confirm no older target.

## 6. ⚠️ Discrepancies to confirm with the owner

- **frontier is NOT "comic".** The owner described frontier as "retro comic style," but `frontier.html`
  is a **warm dusk "badlands/frontier territory"** theme (photographic map, glowing GPS beacons, photo
  "rig cards," license-plate IDs, Chakra Petch font) — **no** halftone/ben-day/bold-outline/speech-bubble
  comic elements anywhere. Either the comic styling is a *future* intent not yet in the file, or
  "frontier" = territory-frontier (not comic). **Confirm which** before scoping T5.
- **cosmos central body.** The owner said "planets rotating a **moon**." In the prototype the planets
  orbit a central **coin/orb** (called `.sun` in code) that doubles as the "All systems / deselect" home
  control; the brand glyph is a separate moon. Minor, but the central body's identity/role matters for a
  faithful port.
- **Theme count vs the shipped 4-tab app.** Every prototype is 3-tab; reconcile with Utils (decision 5).

## 7. Where this slots in the docs

New **DECISIONS D28** (lock the architecture + the §5 decisions). A **ROADMAP** "Appearance/theming"
expansion (today a one-liner). A **TODO Phase 11 — Theme engine** with the T0–T5 slices. This doc stays
the analysis reference. The standing **D7 (pixel-exact fidelity)** mandate now applies *per theme* — each
ported theme must be visually indistinguishable from its prototype at phone width.
