# Frontier theme — implementation plan (T5)

> **Status: ✅ DESIGN LOCKED (2026-07-07) — all five review points owner-ratified same day.**
> This is the executable plan (the `COMPOSER_SURFACE_PLAN.md` tradition). **Build slot** (the
> pinned global order, `TODO.md` header): post-emma-deploy → Hardening slice v2 → Composer
> Surface → **F0 → F1…F5 below**. Each slice: pre-flight → design-confirm → build → audit →
> **owner 390px eyeball + pause**. D-entries are drafted at the F0 and F4 design reviews.
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
   via menu, utils inside it). Composes freely with `appbarMode`. **Preset schema (adversarial
   review 2026-07-07):** a preset = `{ bar: TabId[]; hosted?: Record<TabId, TabId> }`;
   `useSections` exposes the on-bar/off-bar/hosted partitions, and TabBar/KitNavBar/NavMenu
   consume the partitions (today all three map the full unfiltered list — that changes in F0).
   **Precedence rule: hosting supersedes the menu** — the menu affordance lists only sections that
   are off-bar AND unhosted; `navigate(hostedId)` coerces to the host section + scroll-to-group.
3. **The lever** — one global `ui` preference, **device-local like `appbarMode`** (verified:
   `appbarMode` is deliberately per-device/NOT synced — `ui.ts:48-53`, THEME_ENGINE §14.13 #11 —
   and the same per-screen-layout rationale applies; a synced variant would need a new
   `AppearanceDoc` field + reconcile, possible later as an additive promotion, out of F0 scope).
   Default `auto` = the theme's declared default. `ThemeDef` additively declares `defaultLayout` +
   supported set; unsupported picks coerce to nearest supported via a **dedicated layout-coercion
   resolver keyed on the ThemeDef declaration** (warn-first) — this is NOT hardening item ⑦'s
   `resolveThemeSetting`, which only guards per-theme seg/switch settings. Ideal held: **all
   themes can offer all modes**; frontier merely *defaults* to 3-tab, vapor to 4 (vapor waivers to
   its native set while frozen — ladder-owned; VaporRoot never consumes the registry, so its
   byte-identity under F0 is structural, not incidental).

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
- **The chat hooks + token contract (NEW, specified at F4 pre-flight):** **formalize the
  EXISTING shared class names** (the chat tree already uses the legacy vapor-idiom classes —
  `.b.bot`/`.b.cmd`/`.md`/`.chat-log`/… — shared by all themes; renaming would touch frozen vapor,
  so the contract documents + pins them as-is) plus component tokens, covering: bubble kinds
  user/bot/cmd/question · markdown container · code block + actions · plan panel · reasoning ·
  notices · search results. Known grandfathered exception to note in the contract: the `isVapor`
  gate on `PinnedPlan` (AgentTab) — the one sanctioned theme-branch (THEME_ENGINE §14.15.3 hook).
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
- **Plan-pill placement is user-selectable** (owner feature): D30's slot composition is a
  developer API today, so this is a **small real feature, not a freebie** — a setting
  (pinned-top vs composer-pill) that switches which D30 composition the Root passes; scoped in F4
  (decide there: per-theme seg vs global lever). Modularity per §1.

## §3 LOCKED — Point 3: the composer — NO frontier variant (tokens band)

Prototype-verified (2026-07-07, frontier.html:184–299): frontier's composer is **structurally
identical to the stacked Kit composer** (rounded panel · textarea · button row: attach/model/mic/
send) — the comic look is entirely fonts/radii/borders/colors. The 3-gate rules: **tokens band** —
frontier's composer = `KitComposer` (stacked) + frontier `tokens.css`. No `FrontierComposer`
component exists; the earlier variant recommendation was withdrawn as over-build.

- **All-themes picker (owner directive 2026-07-07):** every non-frozen theme declares the
  `composer` seg setting so the Appearance picker offers the style choice everywhere —
  a one-line scope confirmation on `COMPOSER_SURFACE_PLAN.md` A3 (currently minimal + cosmos;
  vapor stays opt-in via its Phase D while frozen). Frontier declares `[stacked, sheet]`
  (stacked default; **`sheet` is the variant ID — "Docked" is only its display label**, per
  COMPOSER_SURFACE_PLAN's registry spec; a literal `docked` value would coerce away) at F1.
- The suggestion **chips are empty-state-owned** (Agent body, §2), not composer functionality.
- **Nuance parked to F1 pre-flight:** the prototype shows a small `model` label in the composer
  row — check whether KitComposer has an equivalent; if not it's a *shared* micro-addition (a slot
  or built-in all themes get), never a frontier fork.
- The slot-contract consequence stays for the machinery generally (hardening ⑧ pins "every
  registered variant renders every required slot"), but frontier adds no variant of its own.

## §4 LOCKED — Point 4: art assets are PLACEHOLDERS

Owner ruling 2026-07-07: the existing PNGs (hero + rig1–6 + cube/platform stack) are
**placeholders** — frontier builds against them now; final art is a separate owner-side task,
**not** a plan dependency. Design consequence: the art pipeline must make the final-art swap a
**zero-code operation** — `ThemeDef.assets = import.meta.glob('./art/*.png')` keyed by filename,
`present()` assigns by index + per-host `appearance.frontier.image` override, and F2 documents the
**art spec** (expected filenames · aspect ratios: hero ~map-card cover, rigs ~1.18 · the 3
stack layers) so replacements drop in. Size/format pass (likely WebP + explicit dimensions)
in F5. Gotcha already pinned: **gradient accents live in `--accent-fill`; `--accent` must parse
as a plain `<color>`** (§14.15.1 ⑨).

## §5 LOCKED — Point 5: day/night = the standard mode axis

Owner ruling 2026-07-07: the prototype's sun/moon toggle maps to the **standard mode axis**
(dark/light, cross-device synced — the lever every theme has): night = the plum-dusk palette, day
= parchment; the 4 accent gradient swatches are frontier's accent axis. No frontier-only mode
setting. (Frontier's appbar is a tokens reskin, so the Kit's existing mode toggle simply wears the
sun/moon styling.)

## §6 The slices (each: pre-flight → design-confirm → build → audit → owner 390px eyeball → pause)

**F0 = T5 step 0 — the section layout system v1** (engine slice, §1; frontier-independent).
*Build:* the `TabDef.body` registry replacing DefaultRoot's hardwired branch · the curated presets
(4/3/2-tab) · the global synced lever (`auto` = theme default) + `ThemeDef` capability declaration
· the generalized menu-affordance rule (off-bar ⇒ menu) · the utils-in-Conf group (concrete).
*Reuse:* `tabsFor`/`useSections` · NavMenu · appearance channel · per-theme settings machinery.
*Acceptance:* all existing themes render byte-identical in `4-tab`/`auto` (vapor structurally
untouched — its Root never consumes the registry); 3-tab relocates utils into Conf — **query-backed
data survives (external caches); local input state (typed args, in-flight results) legitimately
resets**, since relocation is a rare, user-initiated layout switch and React remounts on
tree-position change (no portal machinery for it — honest trade, adversarial review 2026-07-07);
**hosted utils inherits Conf's lazy latch** (it mounts with Conf's chunk; a `utils` deep-link or
live layout-switch while utils is active force-mounts Conf first, then scrolls to the group);
2-tab reaches Conf via menu; the menu lists off-bar-AND-unhosted sections only; `hasComposer`
correct per preset; keep-mounted semantics for on-bar sections unchanged; unit tests for preset
resolution + the layout-coercion resolver + hosted-deep-link coercion; e2e render pass. **Design
review first → drafts the D-entry.**

**F1 — shell reskin.** *Build:* `ThemeDef` row (`frontier`) · two-axis palettes (§5: night/day
modes, 4 gradient accents — gradients in `--accent-fill`, plain `--accent`) · Chakra Petch +
JetBrains Mono via `loadFonts` · `tokens.css` under `.kit` (appbar sun/moon-skinned mode toggle ·
nav · Conf · Utils · composer per §3) · dusk-glow background · `defaultLayout: 3-tab` +
`composer: [stacked, sheet]` declarations (`sheet` = the docked variant's ID). *Reuse:* Kit wholesale; the §0 contract's porting
playbook (§10). *Acceptance:* every tab fully functional in frontier at 390px; mode/accent
switches live + synced; keyframes `frontier-`-prefixed; §14.6 `@scope` pattern; check.py green.

**F2 — the Fleet signature (bespoke body via the registry).** *Build:* art-map card (hero +
6s `sweep` + GPS beacons at `present()` x/y · ping-ring pulse · offline grey · name tags · count
pill) · 2-col rig grid (art by index · plates · LEDs · offline grayscale) · `present()` +
`ThemeDef.assets` glob · the documented **art spec** (§4: filenames/aspects for the placeholder →
final swap). *Reuse:* `useFleet` controller · cosmos's selection/liveness patterns (cosmos's golden-angle
`present()` is the precedent but is polar — frontier needs its own 2D formula). *Beacon placement
(adversarial review 2026-07-07):* default x/y come from a **deterministic index-seeded 2D scatter
with min-separation** (works for N=1…12+, no hand-authored positions), per-host override wins;
name tags must handle overlap at 390 px and beacons meet the ~44 px tap-target floor (cosmos
already flags this class). *Art contract:* the F2 art spec pins **exact filenames + count as the
placeholder→final swap contract**; `present()` indexes **modulo the set size**; a dangling
per-host `image` override (file no longer in the set) **falls back to the indexed default, never
crashes**. *Acceptance:* real fleet data drives beacons+grid at N=1/6/12 (scatter deterministic,
no collisions); selection syncs beacon↔card; offline states correct; animations
transform/opacity-only + `data-motion`/IO-gated; per-host `appearance.frontier.{image,x,y}`
override honored end-to-end (API → render) incl. the dangling-override fallback; tag-overlap +
tap-target cases pass at 390 px.

**F3 — HostDetail.** *Build:* frontier sheet content (art banner + name/plate/status · role/ip/
ping/uptime line · 4-up stat grid · action bar Wake/Shutdown+info · services list with Open-links).
*Reuse:* `components/BottomSheet.tsx` (multi-snap, cosmos-proven) · `sheetSnap` (key
`"frontier-host-detail"`, isolation already unit-tested) · the existing action/confirm flow
(gate untouched). *Acceptance:* open/drag/snap/dismiss at 390px; actions run through the normal
confirm path; a11y (`role="dialog"` non-modal per §14.13 #9).

**F4 — the Agent tab (§2).** *Pre-flight:* inventory the chat markup → write the **chat hooks +
token contract** (named classes + component tokens for bubble kinds/markdown/code/plan/reasoning/
notices/search); confirm with owner; note them for hardening ⑧. *Build:* bespoke body (backdrop +
empty-state rig stack + chips) · the **recede-to-background** transition (first `message.start` ⇄
`/clear`) · the log reskin against the hooks · plan-pill placement setting (D30 slots).
*Acceptance:* full chat functionality (markdown/code actions/confirm+question bubbles/plan/
reasoning/voice) visually frontier at 390px; transition reversible + `data-motion`-clean;
legibility over the watermark verified; no shared-component forks (per-element escalation only,
each gate-checked at review).

**F5 — polish + gates.** *Build:* per-host art override UI in Conf (the `appearance.frontier`
editor) · asset format/size pass (WebP + dimensions; placeholders stay swappable per §4) ·
§14.11 perf pass on **Fennec + Chrome** (sweep/ping/bob budgets · `backdrop-filter` →
`data-perf` · canvas n/a) · a11y floor (§14.14 #5: beacons/rigs = named focusables; decorative
art `aria-hidden`) · e2e render case for frontier · final owner eyeballs (Fleet AND Agent per the
TODO rule). *Acceptance:* full gate + e2e green; the §0 Author Contract checklist satisfied
row-by-row; owner sign-off.

## §7 Parked nuances (resolve at the owning slice's pre-flight)

- F1: the composer `model` label (shared micro-addition or skip — §3 nuance).
- F4: chips behavior on `/clear` (recommend: reappear with the empty state) + small-screen wrap.
- F0/F1: the utils-in-Conf group's first-render interplay with the lazy-Conf latch.
- F2: `sheetSnap` camera-lift interplay on the map card (cosmos precedent — likely n/a, verify).
- F5: placeholder-art licensing/attribution note if the final set is AI-generated (owner call).

## §8 Execution conditions + governance

- **Slot:** post-emma-deploy → Hardening v2 → Composer Surface → F0…F5 (the pinned global order).
- **D-entries:** F0's design review drafts the section-layout-system D-entry (formally supersedes
  the §14.15.4 "tab-body registry" wording); F4's review drafts the chat hooks-contract D-entry if
  the contract proves non-trivial. `COMPOSER_SURFACE_PLAN.md` A3 gets its all-themes scope
  confirmation (§3) when that slice runs.
- **Standing rules:** D7 pixel-fidelity vs frontier.html per slice · §14.11 budget on every
  animation · vapor stays frozen (waivers, ladder-owned) · commit-per-slice, owner pause between
  slices · every slice ends `python tools/check.py` green.
