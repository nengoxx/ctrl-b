# Frontier theme — implementation plan (T5)

> **▶ F5 IN PROGRESS — RE-SCOPED BY OWNER 2026-07-13 (supersedes the F4 banner's F5 list below):**
> per-host art override UI + asset format/size pass [hero.png 1.9MB] are **PARKED** (owner call — not
> dropped, revisit post-F5). F5 now = **the two presentation axes (D37)** + the original gates.
> **Slice A ✅ SHIPPED 2026-07-13 (commit `5193f4c`, owner-eyeballed live + ratified; FE gate 422
> tests [+7]):** frontier's CHAT no-outlines strips promoted to the kit-wide `outlines` axis —
> `kit/axes.ts` (`outlinesSetting(defaultOn)` factory + `useOutlines` resolver; undeclared→ON) ·
> `kit/axes.css` in the NEW `@layer base, theme, axes, reset` position (strips-only, `.kit`-scoped,
> gated `body[data-outlines="off"]`) · stamp = AppEngines `useLayoutEffect` (never `applyBodyAttrs` —
> store↛registry) · minimal/cosmos ON · frontier OFF (pixel-identical, ratified) · frontier.css
> thinned to fills/repaints; composer/mini-player/Conf/Utils/overlay strips stay frontier-private.
> **Slice B ✅ SHIPPED 2026-07-15 (commits `6c78d17` + `a433c8f` [round 2]; owner-eyeballed live +
> ratified; independent adversarial audit clean; ALL 12 layout×skin combos verified via a live Playwright
> computed-chrome matrix; FE gate 427):** the `composerSkin` axis — EXPANDED at the owner's pre-build
> review from the pinned `outline`|`bezel` pair to FOUR skins + the LAYOUT DEDUP (D37 AMENDED 2026-07-15,
> the authoritative as-built record): the `composer` seg deduped to the three real layouts
> `[stacked, sheet(Docked), line]` (the CSS-only borderless/ghost wrappers DELETED); the skin seg =
> `outline`|`glass`(old Borderless, incl. stacked-only icon-forward + arrowhead glyph)|`bezel`(frontier's
> sweep; round 2 generalized the inset-highlight bezel to EVERY layout, docked drop inverted
> upward)|`sleek`(old Ghost, scrim + kept rec ring); declared adjacent to the layout seg (ConfTab renders
> declaration order); stale synced `borderless`/`ghost` degrade to defaults (no migration code);
> kit.css gained the "composer skins" base-layer section (specificity-audited per rule); frontier.css no
> longer styles composer chrome. A "composer icon setting" was PARKED (owner 2026-07-15 → ROADMAP).
> **Gates A + C ✅ SHIPPED 2026-07-15 (per the §9 pinned order A → C → B → D; Opus-4.8-high
> subagents built from the pinned briefs, Fable hand-reviewed + independently verified every diff):**
> **Gate A (`5c0a504`)** — all six a11y-floor fixes [A1 `.kit :focus-visible` accent ring + form-field
> carve-out, kit.css @layer base · A2 sheet peek-detent below-fold `inert` + the grip
> dragging-alternative · A3 status-row `role="group"` ×3 · A4 chat `role="log"`+`aria-busy` · A5 Seg
> `group`+label prop (18 call sites)+`aria-pressed` · A6 `.kit-scroll` `scroll-padding-bottom`]. The
> hand-review caught + fixed a REAL A2 bug: under `setPointerCapture` the derived click retargets
> engine-inconsistently (Chromium mouse → the capturing handle; touch → the grip; verified
> empirically), so tap-cycle lives in `endDrag`'s sub-`TAP_SLOP` branch (whole handle = tap target,
> Material precedent; grip onClick = AT-only; `pointercancel` never activates). Live-verified on the
> dev server: tap/mouse/Enter/real-drag + inert per detent all correct. FE gate 431.
> **Gate C (`10e355b`)** — `frontier-render.spec.ts` (NEW: map/beacon→sheet-dialog drive · A1 ring
> asserted via real Tab presses · A2 grip role/label + handle-tap peek⇄full cycle asserted on
> translateY AND the inert flags, polled, no fixed sleeps · rig-stack + `data-thread` empty⇄active
> via one mocked chat turn) · a11y.spec.ts frontier arm (axe WCAG A/AA × its 3-tab bar, `scanTab()`
> extracted, titles theme-prefixed) · firefox Playwright project scoped `testMatch:/kit-render/`
> (deep drives stay Chromium; ci.yml release gate installs chromium+firefox) · stale kit-render
> comments fixed. e2e 109/109 (mobile 52/desktop 52/firefox 5), frontier-render 6/6 @ repeat-each=3.
> **Owner rulings resolved 2026-07-15:** ① A4 now ✓ · ② firefox project ✓ · ③ sub-44px accepted ✓ ·
> ④ cosmos minors → investigated (research agent + code cross-check) and **CLOSED AS NON-ISSUES**
> (the planet `filter` transition = rare one-shot on a tiny promoted layer; the sheet mask is STATIC
> and rides the sheet's transform — NOT the F4 moving-content-under-fixed-mask case); no code change.
> Cosmos offline svc-rows stay dim-LED-only visually (owner accepted; AT covered by the A3 group).
> **NEXT = Gate B (MANUAL, owner on-device — protocol/scenarios/budgets pinned in §9; start the dev
> units first) → Gate D (the §0 18-row walk + owner sign-off CLOSES F5).** After F5: ACA Slices 1–2 ·
> vapor-hygiene filler · the parked art-override UI + asset pass · ROADMAP: cosmos planet-switcher
> chevrons (owner 2026-07-15).
> *(§6-F5 + §7's licensing note still apply where not superseded here.)*
>
> **▶ F4 ✅ SHIPPED 2026-07-13 (built 2026-07-12→13, commits `61f2267`→`696842f` [9]; owner-eyeballed
> through SIX rounds + ratified; independent adversarial audit mid-build: 1 real bug [the agent-tab
> scroller mask clipped the sticky appbar — masks clip sticky children in viewport space] fixed same
> round; FE gate 415 tests [+9 since F3]; every round committed gate-green). NEXT SLICE: F5 (§6-F5 —
> note the as-builts below NARROW it: the scroller mask is GONE so the flagged Fennec mask hazard is
> MOOT; remaining = per-host art override UI · asset format/size [hero.png 1.9MB] · Fennec+Chrome perf
> pass · a11y floor [peek-detent focus · svc-row aria-label · `.kit-tabbtn` focus ring] · frontier e2e
> render case · PLUS the parked owner idea: promote the frontier no-outlines block into a kit
> `body[data-outlines]` axis + a shared `outlinesSetting()` per-theme switch — owner leaned yes,
> promote AFTER the look settles).**
> F4 as-built: **D36 + THEME_ENGINE §15** (the chat hooks + token contract — pinned class hooks +
> component tokens; ACA growth adds its hooks to the table) · AgentTab's log EXTRACTED to the shared
> `components/ChatThread.tsx` (`{active, chat, emptyState?}`; `PrivilegeChip` → components/) ·
> `usePlanOpenAutoClose` re-homed to `<AppEngines/>` (§14.5 — structurally unloseable; App-level test
> pins it) · **`FrontierAgent`** (`bodies={{agent}}`): sticky-pinned 3-layer rig stack (zero-height
> `.fr-rigstack-pin` viewport anchor; nested wrappers split the recede transition from `frontier-bob`),
> `data-thread` empty⇄active recede (watermark scale 0.72 / opacity 0.18; `/clear` reverses free),
> title-TOP empty state + TWO `fillComposer` chips — scroll-free at 390px (live-measured) · see-through
> `.kit` shell over the `in oklab` dusk-glow (cosmos precedent) · prototype bubbles on §15 hooks ONLY
> (user = `--fr-bubble-ink` mode-flipped black, 14/14/4/14, white ~18:1; bot transparent, 66ch cap;
> who-line RIGHT + dotless 9px). **Owner rulings that OVERRIDE the prototype:** NO OUTLINES theme-wide
> (chat · composer · mini player · chips · priv chip+menu · Conf/Utils · overlays · fleet cards · the
> F3 sheet's INNER elements — all fill-differentiated, focus rings kept as inset box-shadows;
> EXCEPTIONS: the fleet `0x…` plate tags [moved bottom-RIGHT on the art, owner override of the
> prototype's bottom-left] + the kit Clear-appbar chrome) · plan family = wordless accent-count pill ·
> accent done-ticks/strike (`--ok` green clashed) · accent Reboot/Wake pill (`--text` fill read too
> white) · 8px think chip · sheet compacted + the services heading = the honest "n/m up" line (the
> actbar `.info` removed → pills align). **Kit/global riders (all themes):** `AppbarMode` gained
> **`transparent`** (Conf label "Clear") — the bar renders + measures (`--appbar-h`) but paints
> NOTHING; squared glass icon buttons (frost, perf-gated) + a `--bg`-colored brand text halo
> (mode-proof); ONE `appbarShown()` predicate (ui.ts) for every bar-presence test; `.kit-main
> .appbar-clear` nulls the top scrim ("the Clear shadow"); vapor additively · the LINE composer grows
> as a ROUNDED SQUARE (radius 999→24px + flex-end: the 36px round button inset 6px is CONCENTRIC with
> the 24px corner [r18+6=24] — no chord-clip; bottom-locked pill/buttons, `kit-btn-pop` 0.15s appear
> anim) · the flexbox min-content overflow fix on EVERY composer variant (`min-width: 0` on the
> flexible child + `flex-shrink: 0` trailing buttons — the pill used to clip mic/send on line AND
> docked) · docked placeholder → "Message" (the long greeting wrapped below its one-line fold) · kit
> tab indicator cap 72→88px (4th nudge territory) · frontier line-composer bezel (soft ink drop +
> inset top highlight). **REMOVED after live jank (owner-confirmed the audit's risk):** the agent-tab
> scroller `mask-image` — a masked scroller re-rasterizes per frame while the rig stack bobs inside;
> the agent tab has NO edge fades by design (the frosted appbar carries the seam).
>
> *(F3 ✅ SHIPPED 2026-07-12 — build `e620a3b`→riders→`f0b403d`; owner-eyeballed + ratified same day;
> FE gate green [406 tests, 9 new]; independent adversarial audit: 0 bugs — 2 inherited primitive RISKs,
> one fixed [Escape], one deferred to F5.)*
> F3 as-built: `FrontierHostDetail` (pure C3b-shape presentation) over the shared `BottomSheet`, opened
> by `frontierSelection` — art banner (the card's own `present()` art/plate, retained-through-slide-out
> via a MEMOIZED placements identity [the hand-review caught an infinite render loop in the subagent
> build: per-render placement rebuild × identity-keyed retention effect — regression-guarded]) ·
> role/ip/ping meta · the HONEST 4-up stat grid (Ping · Uptime "—" deferred [cosmos precedent] ·
> Services n/m · Seen — the prototype's seamless Load/Temp tiles DROPPED, owner ruling) · Reboot+Shut
> down/Wake through the typed-action confirm gate (Reboot = owner-ratified functionality-parity add over
> the prototype) · per-service list with Open links · peek = banner+meta (`sheetSnap` key
> `"frontier-host-detail"`) · `catchOutside={false}` (tap another rig SWAPS, map ground clears, the
> cosmos interaction ruling) · OPAQUE skin, borderless-composer elevation recipe (owner-tuned from the
> prototype's 50px halo, day-mode variant added) · composer hides via `body[data-sheet=open]` (cosmos
> recipe — rule-of-three promotion candidate). **Shared-primitive riders (owner-directed, same day):**
> BottomSheet **Escape closes from anywhere** (document-level, `defaultPrevented` modal-guard — the
> audit found the non-modal sheet's local handler never heard trigger-focused Escape; bit cosmos too;
> `c6a1c0a`) · **exit-slide shadow overshoot** (`EXIT_SHADOW_CLEARANCE` 80px — the shadow used to hover
> over the tab bar then POP at unmount; `3629996`) · **the Kit tab bar assimilated vapor's bar**
> (`af2f867`+`1e1ea1c`: short bar, `TabDef.glyph` marks [SVG icon set deleted], px-capped centered
> sliding line `min(72px,70%)`, active=ink, fleet↔utils glyphs SWAPPED in STANDARD_TABS for ALL themes
> incl. vapor [owner directive], the neutral `.kit-main[data-tab]` hook [frontier shortens its fleet
> top scrim to 12px]) · frontier sheet shadow → the composer elevation (`f0b403d`). **Deferred to
> F5/a11y floor:** peek-detent focus-below-the-fold (transform-vs-scroll primitive design) ·
> roleless-div `aria-label` on offline service rows (cosmos parity) · no `:focus-visible` ring on
> `.kit-tabbtn` (pre-existing, all:unset).**
>
> *(F2 ✅ SHIPPED 2026-07-12 — build `ed672da`→riders→`e677a78`; owner-eyeballed at 390px through one
> fix round; full gate + 96 e2e green; 6-lens adversarial audit: 0 real bugs, 3 NITs fixed
> pre-commit.)* F2 as-built: the badlands Fleet (hero map
> card + card-relative `frontier-sweep` + R2-scattered beacons + 2-col rig grid + 3 explicit states) via
> `bodies={{fleet}}` · `present()` R2 scatter **windowed `R2_OFFSET=2`** so slot 0 = the hero figure's
> spot · the partitioned eager-glob art manifest (`art.ts` IS the placeholder→final-art swap contract;
> rig modulo pool ≠ hero/stack) · **appearance `{image,x,y}` end-to-end for the first time** (backend
> DTO passthrough + explicit validated/CLAMPED override mapping — never a blind spread) ·
> `frontierSelection` store (beacon↔card sync; F3's sheet reads it). **Eyeball-round riders (owner-
> directed, all shipped same day):** the Kit-wide **sliding top-line tab indicator** (`cd00caa` — vapor's
> mechanic generalized to N columns via `--tab-count`/`--tab-i`; the icon pill bg dropped) · **self-host
> presentation** (`cbc2d34` — backend `self` FACT by hostname; `useHosts` stable self-first select; the
> agent's rig stands with the hero figure by default, zero config) · **per-view `FleetOrder`**
> (`3ecad64` — cosmos opts back into YAML order: size-aware layout, small planet innermost; safe = cosmos
> never reads `featured`) · **cosmos cue size channel** (`e677a78` — `visual`/`off` sizes = the
> decorative golden ladder, no service info; owner may retune `decorativePlanetSize` anytime).
>
> *(F1 ✅ SHIPPED 2026-07-12 — pre-flight `7322457` + build `ed672da`⁻¹: frontier REGISTERED, night/day
> palette, Chakra Petch + JetBrains Mono, the Kit `brandMeta` slot ["N/M rigs · online"], composer model
> label → ROADMAP A9, `--accent-fill` PLAIN [deliberate deviation — prototype gradients are decorative
> only; swatches are ThemeDef DATA], defaultLayout 3-tab no restriction, tabs frontier/comms/tools/
> settings, day-mode in-gamut oklch statuses + `--accent-ink #241522`, the B2 OKLCH gamut advisory built
> at pre-flight. F0 ✅ same date — D35 SECTION LAYOUT SYSTEM v1, `b7f63d4…76c0d74`.)*
>
> *(F0 ✅ SHIPPED 2026-07-12, commits `b7f63d4…76c0d74` — D35 LOCKED + same-day addendum; as-built:
> the menu DOCKING RULE · the COLLAPSE LADDER · NavHome · swipe-nav PARKED; body registry = eager DATA,
> lazy COMPONENTS via the generalized `bodies` DefaultRoot prop. The §6-F0 ⚠ preserve-list was honored.)*
>
> **Status: ✅ DESIGN LOCKED (2026-07-07) — all five review points owner-ratified same day, then
> adversarially reviewed against the code (10 findings, all folded in — the review markers sit
> inline at each fix: lever = device-local · explicit preset schema · hosting-supersedes-menu ·
> honest relocation/lazy semantics · `sheet` variant id · existing chat class names · plan-pill =
> a real setting · beacon scatter + the art filename contract · layout coercion ≠ hardening ⑦).**
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
   defaults), replacing `DefaultRoot`'s hardwired tab-body mounting *(precision, 2026-07-11: not a
   select-one `tab === …` switch — DefaultRoot mounts ALL four bodies simultaneously as
   keep-mounted `active`-gated children, `DefaultRoot.tsx` render; the registry must preserve that
   keep-mounted shape while making the SET per-theme)*. The `Fleet={…}` prop folds
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
  gate on `PinnedPlan` (AgentTab) — the one sanctioned theme-ID branch (THEME_ENGINE §14.15.3 hook);
  since A4 (2026-07-11) the SAME spot also carries the SETTING-keyed (not theme-keyed) non-vapor
  `PinnedPlanPanel` branch + the `usePlanOpenAutoClose` host — see F4's ⚠ interplay note.
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
  (pinned-top vs composer-pill) that switches which D30 composition the Root passes. **RESOLVED
  2026-07-11: built as COMPOSER_SURFACE_PLAN A4** — the as-built key is **`planPlacement`**
  (NOT the `planPill` this doc originally sketched; `inline` | `pinned`, shared spec factory
  `planPlacementSetting()` in `kit/composer/plan/placement.ts`; rides the synced themeSettings map,
  zero backend change; `inline` composition is OWNED by DefaultRoot, `pinned` = the Kit
  `PinnedPlanPanel` mounted by AgentTab); **F4 only consumes it** (frontier declares
  `planPlacement: planPlacementSetting(<default>)` at F1/F4). Modularity per §1.

## §3 LOCKED — Point 3: the composer — NO frontier variant (tokens band)

Prototype-verified (2026-07-07, frontier.html:184–299): frontier's composer is **structurally
identical to the stacked Kit composer** (rounded panel · textarea · button row: attach/model/mic/
send) — the comic look is entirely fonts/radii/borders/colors. The 3-gate rules: **tokens band** —
frontier's composer = `KitComposer` (stacked) + frontier `tokens.css`. No `FrontierComposer`
component exists; the earlier variant recommendation was withdrawn as over-build.

- **All-themes picker (owner directive 2026-07-07):** every non-frozen theme declares the
  `composer` seg setting so the Appearance picker offers the style choice everywhere —
  A3 shipped it on minimal + cosmos (vapor stays opt-in via its Phase D while frozen).
  **As-built update (2026-07-11):** the shared `composerLayoutSetting()` factory carries ONE
  option list — now the full 5-variant catalog `[stacked, borderless, ghost, sheet, line]` — and
  per-theme SUBSETTING does not exist as-built (and isn't wanted, per this directive's "choice
  everywhere"). So frontier declares `composer: composerLayoutSetting("stacked")` at F1 — the full
  catalog, stacked default — superseding this doc's earlier `[stacked, sheet]` subset sketch.
  (Values are variant IDs — "Docked"/"Sleek"/"Line" are display labels only.)
- The suggestion **chips are empty-state-owned** (Agent body, §2), not composer functionality.
- **Nuance parked to F1 pre-flight:** the prototype shows a small `model` label in the composer
  row — check whether KitComposer has an equivalent; if not it's a *shared* micro-addition (a slot
  or built-in all themes get), never a frontier fork.
- The slot-contract consequence stays for the machinery generally (hardening ⑧ pins "every
  registered variant renders every required slot"), but frontier adds no variant of its own.

## §4 LOCKED — Point 4: art assets are PLACEHOLDERS

Owner ruling 2026-07-07: the existing PNGs (hero + rig1–6 + cube/platform stack) are
**placeholders** *(count fix, fidelity audit 2026-07-11: the prototype references **10** files —
hero · rig1–6 · cube-only · platform-mid · platform-base; `cube.png` in assets/ is a stray the
prototype never uses — the F2 filename contract pins the real 10)* — frontier builds against them now; final art is a separate owner-side task,
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

**F0 = T5 step 0 — the section layout system v1** (engine slice, §1; frontier-independent). **✅ SHIPPED
2026-07-12 — see the banner atop this file for the as-built deltas (docking rule · collapse ladder ·
NavHome · swipe parked) + the F1 pre-flight reminders.**
*Build:* the `TabDef.body` registry replacing DefaultRoot's hardwired branch · the curated presets
(4/3/2-tab) · the global **device-local** lever (`auto` = theme default; per §1 point 3 — NOT synced,
the `appbarMode` precedent; sync is a possible later additive promotion) + `ThemeDef` capability
declaration · the generalized menu-affordance rule (off-bar ⇒ menu) · the utils-in-Conf group (concrete).
*Reuse:* `tabsFor`/`useSections` · NavMenu · appearance channel · per-theme settings machinery.
*⚠ Preserve (added 2026-07-11, the shipped composer Surface lives in the SAME DefaultRoot this
slice rewrites):* the `useComposerLayout()` read (also a `--composer-h` effect dep), the
`usePlanPlacement()`→`composerAddons` inline-plan composition, and the `ThemedComposer layout={…}`
render — see COMPOSER_SURFACE_PLAN §0 (as-built) + THEME_ENGINE §14.15.4's constraint list.
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

**F1 — shell reskin. ✅ SHIPPED 2026-07-12 — see the banner atop this file for the as-built deltas
(brandMeta slot · model label → ROADMAP A9 · flat `--accent-fill` · the B2 gamut advisory).** *Build:* `ThemeDef` row (`frontier`) · two-axis palettes (§5: night/day
modes, 4 gradient accents — gradients in `--accent-fill`, plain `--accent`) · Chakra Petch +
JetBrains Mono via `loadFonts` · `tokens.css` under `.kit` (appbar sun/moon-skinned mode toggle ·
nav · Conf · Utils · composer per §3) · dusk-glow background · `defaultLayout: 3-tab` +
`composer: composerLayoutSetting("stacked")` + `planPlacement: planPlacementSetting(<default — confirm
at the F1/F4 design review>)` declarations (full shared option lists, per §3's as-built update).
*Reuse:* Kit wholesale; the §0 contract's porting playbook (§10). *Themed copy (fidelity audit 2026-07-11):* tab labels are ALREADY per-theme data
(`TabDef.lbl`/`glyph` — frontier's F1 tab set declares "Frontier/Comms/Settings"); section
headings/map title/empty-state copy live in the bespoke bodies (F2/F4) by construction. The ONE
open item: the appbar brand subtitle ("4/6 rigs · online" — dynamic content in shared Kit chrome) —
resolve at F1 pre-flight (small Kit appbar slot vs accept the standard appbar). *Acceptance:* every tab fully functional in frontier at 390px; mode/accent
switches live + synced; keyframes `frontier-`-prefixed; §14.6 `@scope` pattern; check.py green.
*(Mechanism note, verified 2026-07-11: nothing in `stylelint.config.mjs` auto-derives the prefix —
the enforcement is the P2 META-GUARD TEST in `themeContract.test.ts` ("authoring guards ↔
registry"), which goes RED the moment `frontier` registers until the `src/themes/frontier/**`
`^frontier-` stylelint override AND the `TOKENS_RAW` entry are hand-added. Expect that red; it's
the guard working, with instructions in its failure message.)*

**F2 — the Fleet signature (bespoke body via the registry). ✅ SHIPPED 2026-07-12 — see the banner for
the as-built record + the four owner-directed eyeball riders (tab indicator · self-host · FleetOrder ·
cosmos cue size).** *Build:* art-map card (hero +
6s `sweep` + GPS beacons at `present()` x/y · ping-ring pulse · offline grey · name tags · count
pill; **porting hazard, fidelity audit 2026-07-11: the prototype's `sweep` keyframe animates `left`
(frontier.html:79) — re-author as `transform: translateX()` or it trips the §14.11 budget + the
stylelint perf rule; `ping`/`bob` are already transform/opacity-clean**) · 2-col rig grid (art by index · plates · LEDs · offline grayscale) · `present()` +
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

**F4 — the Agent tab (§2). ✅ SHIPPED 2026-07-13 — see the banner atop this file for the as-built record
(D36/§15 contract · ChatThread extraction · A4 re-home · the six owner rounds: no-outlines theme-wide, the
Clear appbar mode, the rounded-square line composer, the sticky watermark).** *Pre-flight:* inventory the chat markup → write the **chat hooks +
token contract** (named classes + component tokens for bubble kinds/markdown/code/plan/reasoning/
notices/search); confirm with owner; note them for hardening ⑧. *Build:* bespoke body (backdrop +
empty-state rig stack + chips) · the **recede-to-background** transition (first `message.start` ⇄
`/clear`) · the log reskin against the hooks · ~~plan-pill placement setting~~ **SHIPPED as
COMPOSER_SURFACE_PLAN A4 (`planPlacement`) — F4 only declares frontier's default + verifies both
placements against the bespoke body.** ⚠ A4 interplay for the pre-flight inventory: today's
`AgentTab` hosts BOTH the setting-keyed `PinnedPlanPanel` mount (the `pinned` placement) AND the
single `usePlanOpenAutoClose(currentPlan)` call (the shared plan-open flag's reset) — if F4's
bespoke frontier body replaces AgentTab via the registry, it must carry both (or F4 re-homes them
somewhere always-mounted); losing the hook silently regresses the cleared-plan-reopens bug fixed
2026-07-11 (`12f83a5`/A4). Check at the F4 design review.
*Acceptance:* full chat functionality (markdown/code actions/confirm+question bubbles/plan/
reasoning/voice) visually frontier at 390px; **fidelity standard (audit 2026-07-11): the prototype
never renders composer + populated log together (its JS deletes the whole empty state on first
submit, frontier.html:554) — frontier's ACTIVE-CHAT layout is un-prototyped, so F4's D7 eyeball
judges coherence with the comic style, not pixel-fidelity, for that state;** transition reversible + `data-motion`-clean;
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
- ~~F4: chips behavior on `/clear` + small-screen wrap~~ — RESOLVED as-built: chips live in the empty
  state (reappear on `/clear` free); TWO short chips fit one 390px row (owner round 6).
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

## §9 F5-GATES — pinned pre-flight brief (2026-07-15; research-backed, execute in a clean session)

> **STATUS 2026-07-15 (as-built record = the top banner): Gate A ✅ `5c0a504` · Gate C ✅ `10e355b` ·
> the 4 owner rulings RESOLVED (defaults ①②③ confirmed; ④ superseded — the cosmos minors were
> investigated and CLOSED AS NON-ISSUES, see the banner). REMAINING: Gate B (manual on-device,
> protocol below) → Gate D (§0 walk + owner sign-off closes F5).** The A/C item lists below are
> the as-planned briefs — the banner records the deltas (notably the A2 pointer-capture fix).

> Synthesized from a 3-agent pre-flight (2026-07-15): web research on 2026 mobile-perf practice
> (web.dev/MDN/Mozilla primary sources) + WCAG 2.2 / APG a11y practice (W3C Understanding docs
> revised 2026) + a file:line codebase inventory. The inventory's headline: **the codebase is
> already §14.11-clean** (every blur has a perf-lite fallback; all animations transform/opacity +
> motion-gated; the sticky/mask hazards are clear; first-paint stamps are layout-effect) — the
> perf gate is therefore a VERIFICATION pass, while the a11y floor has REAL fixes. Execute in
> order **A → C → B → D** (fixes → e2e locks them in → on-device pass → sign-off).

**Gate A — the a11y floor (fixes; kit-wide unless noted).**
1. **A1 [WCAG 2.4.7 FAILURE, top priority] kit-wide `:focus-visible` ring.** The global ring
   (`theme/extras.css` `:focus-visible`) uses vapor-private `--magenta` → invalid on kit themes →
   NO keyboard focus indicator on any `all: unset` kit control (`.kit-tabbtn`/`.kit-cbtn`/
   `.kit-send`/`.kit-iconbtn`/seg buttons/plan pill/frontier beacons+rigs…). Fix in kit.css
   `@layer base`: a generic `.kit :focus-visible { outline: 2px solid var(--accent);
   outline-offset: 2px; }` + the extras.css form-field suppression pattern (fields keep their
   `:focus` treatments; frontier's inset input rings unaffected). OUTLINE-based, not box-shadow —
   survives `forced-colors` (research ruling); focus rings are already exempt from frontier's
   no-outlines ruling. This subsumes the named `.kit-tabbtn` deficit.
2. **A2 BottomSheet peek detent (primitive-level → frontier + cosmos).** (i) `inert` the
   below-fold content region while at the peek snap (remove when expanded) — SC 2.4.11 focus-not-
   obscured + reachability; (ii) SC 2.5.7 dragging-alternative: the grip becomes a labelled
   `role="button"` — tap/Enter cycles peek↔full (Material `BottomSheetDragHandleView` precedent).
   Escape-close + focus-return already exist — verify, don't rebuild.
3. **A3 status-row semantics.** The offline svc/host rows are roleless `<div>`s with `aria-label`
   (unreliably announced). Give the shared pattern (`FrontierHostDetail` + `CosmosHostDetail` +
   kit `Fleet`/`DeviceRow`) `role="group"` on the row; never color/LED-only state (text already
   present — verify per row).
4. **A4 chat-stream live region (markup-only; owner may defer to ACA Phase 12 — default: DO in
   F5).** `ChatThread` container gets `role="log"` + `aria-live="polite"` + `aria-busy` toggled
   while streaming — announce the COMPLETED reply once, never per token (MITRE chatbot playbook
   pattern); composer keeps focus. ACA features later ADD to this region (D36 growth rule).
5. **A5 Seg semantics.** `components/Seg.tsx`: container `role="group"` + `aria-label`; each
   option button `aria-pressed` (Primer/Workday segmented-control pattern — deliberately NOT
   radiogroup/tablist; no roving-tabindex machinery).
6. **A6 focus-not-obscured hardening.** `scroll-padding-bottom: calc(var(--composer-h, 64px) +
   24px)` on `.kit-scroll` so keyboard-focused rows scroll clear of the docked composer/tab bar.
7. **Explicitly ACCEPTED (owner may override):** sub-44px composer circles (32–34px — pass the
   24px AA floor; single-user, pointer-first) · `will-change` static uses (2 targeted sites,
   audited OK).

**Gate C — e2e locks (do right after A so the fixes are enforced).**
1. Frontier render case: boot `frontier` (it's already in `CONTRAST_MATRIX`) and drive the
   bespoke surfaces — `.frontier-map` + beacons render → beacon tap opens `.frontier-hd`
   (`role="dialog"`) → agent tab `.fr-rigstack` mounts → `data-thread` empty⇄active flip.
2. Add a **frontier arm to `a11y.spec.ts`** (axe A/AA per tab — today it scans vapor ONLY; this
   also machine-enforces A1/A5). Fix the stale "minimal AND cosmos" comment in
   `kit-render.spec.ts`.
3. Add a Playwright **`firefox` project** scoped to `kit-render.spec.ts` (desktop Gecko ≈ partial
   §14.11 automation; Fennec proper stays manual in Gate B). Keeps e2e runtime bounded.
**Gate B — the Fennec + Chrome perf pass (verification, owner on his phone + profilers).**
- Protocol: Fennec USB profiling via desktop `about:debugging` → Firefox Profiler; Chrome via
  `chrome://inspect` DevTools perf panel. Scenarios: agent-tab rig-bob + a streamed reply · theme
  switch (View Transitions are NATIVE on Firefox/Fennec ≥144 — verify the switchTheme VT path
  fires there now) · host-sheet drag/detents · the 12 composer layout×skin combos · keyboard
  open on each composer layout · `data-perf=lite` + reduced-motion toggles.
- Budgets: INP p75 ≤ 200 ms · no handler > 50 ms (long-task) · no dropped-frame runs in the
  profiled scenarios.
- **RULED (research conflict):** KEEP the `visualViewport` `--app-h` observer — `dvh` does NOT
  track the Android on-screen keyboard (our `App.tsx` comment already documents this; the
  research bullet claiming dvh suffices is wrong for Chrome-Android default `interactive-widget`).
- **DEFERRED:** `content-visibility: auto` on the chat log (Baseline 2025, real lever — but per
  the UI_AUDIT F9/F13 stance, only under measured pressure; ACA-adjacent) · cosmos minors
  (planet `filter` transition + the sheet-slide `mask-image`) → the cosmos-owning phase
  (fix-in-owning-phase).

**Gate D — §0 contract row-by-row.** Walk THEME_ENGINE §0's 18 rows for frontier and record the
evidence per row (the 2026-07-15 inventory pre-verified most; rows 10/11/16/17 are the ones the
A/B/C gates complete). Owner sign-off on the walk CLOSES F5; then: ACA Slices 1–2 · the parked
art-override UI + asset pass · vapor-hygiene filler.

**Owner rulings — RESOLVED 2026-07-15:** ① A4 now ✓ (shipped in Gate A) · ② firefox e2e project ✓
(shipped in Gate C) · ③ sub-44px targets accepted ✓ · ④ cosmos minors: the owner asked for evidence
instead of a blind defer → a research agent + code cross-check CLOSED BOTH AS NON-ISSUES (banner has
the reasoning); the cosmos offline svc-rows' dim-LED-only visual was also accepted as-is.
