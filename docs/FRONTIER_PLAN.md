# Frontier theme — implementation plan (T5)

> **Status: 🔶 IN DESIGN (2026-07-07) — the owner design review is in progress, point by point.**
> Locked points below are owner-ratified prose decisions; open points are listed with their
> current recommendation. When all points close, this doc becomes the executable plan (the
> `COMPOSER_SURFACE_PLAN.md` tradition) and the step-0 design review drafts the D-entries.
> **Read first:** `THEME_ENGINE.md` **§0** (the Theme Author Contract) · §14.10 (T5) · §14.15.4
> (the ratified step-0 entry) · `TODO.md` header (the global order: build slot = post-deploy →
> Hardening v2 → Composer Surface → this).

**Design source:** `design/prototypes/variations/frontier.html` (567 lines; the Mœbius "badlands
comic" — dusk/day western frontier, machines as rigs staked across the badlands). Art assets
already exist in `design/prototypes/assets/` (hero + rig1–6 + cube/platform stack, 11 files).
**Precedent:** cosmos (`COSMOS_HANDOFF.md`, historical) deliberately built the seams frontier
reuses: `BottomSheet`, `present()`, `sheetSnap` (string-keyed; frontier isolation already
unit-tested), sheet-aware camera-lift.

**The prototype's data shape** (maps 1:1 onto `present()`): each rig carries
`{img: "rig1".."rig6", plate: "0xPEG01", x/y: map-percent, on/ping/uptime/cpu/temp}` — i.e.
`present()` supplies `{asset, x, y, plate}` from host index/name, overridable per host via the
open `host.appearance.frontier.{image,x,y}` blob (THEME_ENGINE §9.9, locked long ago).

---

## §1 LOCKED — Point 1: the section layout system (T5 step 0, supersedes "tab-body registry")

Owner-ratified 2026-07-07 (two-round design conversation). **Principle: functionality = modules;
layout = modes that recompose where modules live. No theme/mode ever removes functionality — only
placement varies.** The plan-pill (D30 slots) is the one-level-down precedent.

**Two orthogonal axes:**

- **Axis A — reachability (general mechanism).** Every section (fleet · agent · utils · conf) is
  always reachable: a tab-bar button if on-bar, the menu affordance otherwise. The NavMenu trigger
  rule generalizes from "appbarMode: minimal" to "**whenever any section is off-bar**"; minimal is
  simply the all-off-bar endpoint of the same spectrum (the owner's "1-tab mode IS minimal").
  Sections stay distinct, fully-functional screens.
- **Axis B — hosting (curated, pair-specific).** Utils content can render **as a group inside
  Conf**. This is deliberately NOT a general "module declares a fallback host" mechanism (rejected
  as speculative — fleet/agent/conf have no sensible host; concrete-first, rule of three): it is
  one curated composition, implemented concretely in Conf, generalized only if a second hosting
  pair ever exists.

**The pieces:**

1. **Section/body registry** — `tabs.ts`'s `TabDef` gains `body` (per-theme sets; standard four as
   defaults), replacing `DefaultRoot`'s hardwired `tab === "…"` branch. The `Fleet={…}` prop folds
   in (theme-pinning-as-data — NOT a Surface graduation; the D31 variant axis stays separate).
2. **Curated layout presets** — `4-tab` (today) · `3-tab` (utils hosted in Conf) · `2-tab` (conf
   via menu, utils inside it). Composes freely with `appbarMode`.
3. **The lever** — one global, appearance-synced `ui` preference mirroring `appbarMode`, default
   `auto` = the theme's declared default. `ThemeDef` additively declares `defaultLayout` +
   supported set; unsupported picks coerce to nearest supported (warn-first). Ideal held: **all
   themes can offer all modes**; frontier merely *defaults* to 3-tab, vapor to 4 (vapor waivers to
   its native set while frozen — ladder-owned).

**Edges the spec must own:** keep-mounted state per module across relocation (utils keeps state
when it moves between own-section and Conf-group) · active-id space in hosted mode (deep-link
`utils` → conf + scroll-to-group) · `hasComposer` computed per layout · a11y/tab-order per mode ·
the lazy-Conf latch stays generic. **Architecture check passed:** `useSections`/`tabsFor` already
data-driven; NavMenu exists; appearance channel + `ThemeDef` extend additively; the only
structural change is the body registry (= this step 0). D-entry drafted at step-0's design review.

## §2 LOCKED — Point 2: the Agent tab — bespoke shell, shared internals

- **Bespoke (frontier-owned, via the section registry):** the Agent body — backdrop/layout, the
  signature empty-state (3-layer bobbing rig stack + "Frontier Comms" + suggestion chips;
  chips are empty-state-owned, not composer functionality).
- **Shared + reskinned:** the message-log component tree — same components/DOM, comic look via CSS
  (borders/fills/fonts/pseudo-element tails). Rationale: the log carries deep functionality
  (markdown + code actions, confirm/question bubbles, plan panel, reasoning, notices, search
  results, streaming) AND ACA Phase 12 grows it (Stop/steering/approvals) — a fork pays every ACA
  slice twice and splits the security UX. The 3-gate agrees: same DOM shape → cheapest band wins.
- **The chat hooks + token contract (NEW, specified at F4 pre-flight):** every restylable chat
  element gets a named, documented, test-pinnable hook class + component tokens (the
  `.kit-appbar`-style contract extended inward: bubble kinds user/bot/cmd/question · markdown
  container · code block + actions · plan panel · reasoning · notices · search results).
  Hardening item ⑧ (`themeContract.test.ts`) eventually pins them. **Escalation valve:** an
  element that provably can't reach D7 fidelity via CSS goes bespoke *per-element* (gate-checked);
  a second theme needing a structurally different log is what births a ChatSurface (ladder V4
  rider) — not before.
- **The empty→chat transition (owner leaned, ratified):** the rig stack **recedes into a living
  background** — scale-down + translate + fade to a dim watermark (transform/opacity only,
  §14.11-clean), triggered by the thread's first `message.start`, reversed on `/clear`/new thread
  (class toggle). Background mode: bob slower/subtler, `data-motion`-gated, IO-paused when
  inactive. Legibility owned by heavy dim/desaturate + scrim + the comic style's opaque bubbles.
  This is §14.13 #8's full-bleed-signature rule applied over time instead of space.
- **Plan-pill placement is user-selectable in frontier** (D30 slots) — modularity per §1.

## §3 OPEN — Point 3: the composer (recommendation on the table)

Frontier's comic composer = a **frontier-owned variant** (`FrontierComposer`) registered through
the Composer-Surface machinery (which lands before frontier), theme-pinned as frontier's default;
`useComposer()` (prefix routing · mic/dictation · send · drafts) stays the shared controller.
Scope + consequences: being discussed (see the conversation record / §R below when closed).
Fallback if Composer-Surface slips: the D30 `Composer={…}` prop works today.

## §4 OPEN — Point 4: art assets

Are the existing hand-drawn PNGs (hero + rig1–6 + cube/platform stack) final shippable art, or to
be redrawn/extended first? Either way: shipped via `ThemeDef.assets = import.meta.glob(...)`,
assigned by index in `present()` + per-host `appearance.frontier.image` override; a size/format
pass (likely WebP) belongs to F5. Gotcha already pinned: **gradient accents live in
`--accent-fill`; `--accent` must parse as a plain `<color>`** (§14.15.1 ⑨).

## §5 OPEN — Point 5: day/night

Recommendation: map the prototype's sun/moon appbar toggle to the **standard mode axis**
(dark/light, cross-device synced) — night(plum dusk)/day(parchment) are frontier's mode palettes;
the 4 accent gradient swatches are its accent axis. Not a frontier-only setting.

## §6 Slice skeleton (F0–F5 — each: pre-flight → design-confirm → build → audit → owner eyeball)

- **F0 = T5 step 0** — the §1 section layout system v1 (engine slice; its own design review +
  D-entry). AFTER Hardening v2 + Composer Surface.
- **F1 — shell reskin**: ThemeDef row + two-axis palettes + Chakra Petch/JetBrains Mono +
  `tokens.css` under `.kit` (appbar/nav/conf/utils) + the dusk-glow app background.
- **F2 — Fleet signature**: art-map card (hero + 6s radar sweep + GPS beacons via `present()` x/y,
  ping-ring pulse, offline grey) + 2-col rig grid (art by index, plates, LEDs, offline grayscale).
- **F3 — HostDetail**: `BottomSheet` reuse + frontier content (art banner · 4-up stats · action
  bar · services list).
- **F4 — Agent tab** (§2): chat hooks/token contract pre-flight → bespoke shell + empty-state +
  recede transition → log reskin → plan-pill slot.
- **F5 — polish + gates**: per-host art override UI in Conf · asset format pass · §14.11 perf pass
  (Fennec + Chrome) · a11y floor · e2e render case · final 390px eyeballs.

## §7 Open nuances (parking list — resolve at their slice's pre-flight)

- Chips styling/behavior on small screens; do chips reappear on `/clear`?
- The map card's `backdrop-filter` uses (frosted tab bar) → `data-perf` gating.
- Rig-art licensing/attribution note if assets are AI-generated (owner's call, F5).
- 3-tab default + the utils-in-conf group's first render (lazy interplay).
- Frontier's `sheetSnap` key naming + camera-lift interplay on the map card (cosmos precedent).
