# Cosmos theme — implementation handoff (C2a-fix → C2b → C3)

**Read this first, then the doc map below.** This is a focused handoff for finishing the **cosmos** theme
(the bespoke orbital/space theme). It assumes you've read `CLAUDE.md` + `AGENTS.md` + the canonical
[`HANDOFF.md`](./HANDOFF.md). Cosmos C1 (starfield) and C2a (static orbital fleet) are shipped + pushed on
`main`; what remains is a faithful-to-the-prototype redesign of the fleet interaction, captured here.

> **Owner's standing expectations (do not skip):** match the prototype design closely **with the agreed
> improvements**; be **informed before you build** — read the code you touch, **web-research any net-new
> pattern** (don't guess), and **ask the owner** on genuine design forks; work in **small audited slices**,
> **pause for review between slices**, write **tests for the logic**, and keep everything within the
> **performance budget**. The owner reviews visually on **Android (primary) + desktop**.

---

## 0. How to inform yourself (do this before coding)

1. **The prototype** — `prototypes/project/variations/cosmos.html` (single-file HTML/CSS/JS mock). Read its
   CSS (`.solar`/`.ring`/`.core-glow`/`.sun`/`.planet`/`.halo`/`.panel`/`.backbtn`) and its JS (the
   `setFocus`/camera logic, the star + planet rAF loops). Also **view the screenshots**:
   `prototypes/project/scraps/cosmos-check.png` (+ `cosmos-check2.png`, `cosmos-check3.png`) — the Read tool
   renders PNGs. The first screenshot shows the un-focused fleet (moon + scattered planets + faint rings +
   "Tap a world to focus"). This is the visual target.
2. **The doc map** (canonical, agent-agnostic):
   - [`THEME_ENGINE.md`](./THEME_ENGINE.md) — the theme-engine design (D29). **§9.9 present()**, **§14.3
     per-theme settings**, **§14.4 Kit + bespoke themes**, **§14.6 lazy load**, **§14.11 the cross-browser
     PERF + robustness rule (every theme MUST pass it)**, **§14.13 the new-theme contract**.
   - [`VAPOR_PATTERNS.md`](./VAPOR_PATTERNS.md) — design tokens/components (read before styling net-new UI).
   - [`DECISIONS.md`](./DECISIONS.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`DESIGN.md`](./DESIGN.md),
     [`ROADMAP.md`](./ROADMAP.md), [`TODO.md`](./TODO.md).
3. **Web-research** the net-new patterns (already done once this cycle — findings summarized in §6; re-verify
   if you deviate): DOM-vs-canvas for orbiting nodes, the draggable bottom-sheet, space-themed status
   indicators, compositor animation. Don't re-derive from memory — cite sources.
4. **Ask the owner** on real design forks (they prefer **prose back-and-forth** over multiple-choice for
   architecture). Confirm the design **before** building each slice.

---

## 1. What cosmos is + the end-result focus

Cosmos is a **bespoke** theme (D29 §14.4): it owns its Root but **reuses the whole Kit** (chrome / Agent /
Conf / Utils via `DefaultRoot`) and overrides only the Fleet (its signature surface) + the background.

**End goal:** the prototype's deep-space, solar-system fleet — a central **moon** with host **planets**
orbiting it over a twinkling **starfield** — **with these agreed improvements over the mock:**
- **Real data**, not mock: planets/services/online-state come from the live `useFleet` controller.
- **`size = service health`** (a host with services down shrinks) — *plus* a varied base size (see C2a-fix).
- **Golden-angle (Vogel) scatter** layout (even, scales to any fleet, animates cleanly) — the prototype's
  hand-placed scatter, generalized.
- **Manual selection only** (no auto-cycle), → **camera zoom-follow** → a **draggable bottom sheet**
  (improved from the prototype's static slide-up panel; see §5).
- **No literal ping line-graph** — replace with **space-native indicators** (breathing-pulse latency, etc.).

---

## 2. Current state (shipped on `main`)

- **C1 (starfield)** — `CosmosStarfield.tsx`: fixed full-viewport canvas of twinkling stars behind a
  see-through Kit shell. Perf-disciplined (dpr≤2, ~30fps cap, motion-gated, pauses on `document.hidden`,
  normalized positions + explicit CSS-px sizing — fixed a high-dpi/Android bug; see its header comment).
  Tuned to the owner's eye (density `/4000` cap 800, power-skewed radius, gentle tempo).
- **C2a (static orbital fleet)** — `CosmosFleet.tsx` + `present.ts` + `cosmos.css`: DOM planet `<button>`s
  placed by `present()` (golden-angle), sized by service health, matte coin styling (depth + grain +
  embossed symbol) matching the prototype, a moon core, faint orbit rings.
- Settings (`orbitalMotion` switch + `motionSpeed` seg) live in `index.tsx` → `motion.ts` (the tempo source
  of truth, shared by the starfield now + the orbit later).

**Latest cosmos commits:** `9c3fb1b` (coin fidelity) ← `f2bec34` (C2a) ← `a70da3f`/`421229f` (C1 + audit).

**Tests:** `tests/themes/cosmos.test.ts` (settings/tempo) + `tests/themes/present.test.ts` (encoding).
FE suite is **132 unit / 34 e2e** green. Run: `npm test` / `npm run test:e2e` / `npm run build` /
`npm run typecheck` in `dashboard_v2/frontend`. Dev server: backend `uvicorn app.main:app --port 5433`
(no `--reload` on Windows), frontend `npm run dev` (port **5173**) — **check if already running first**.

---

## 3. The owner's redesign feedback (what's left to do)

The owner reviewed C2a and gave this feedback — every item is planned below.

### C2a-fix (next slice — leaf-ish corrections, do with tests)
1. **Moon D-cutout.** Replace the plain `.cosmos-core` `<div>` with the prototype's **SVG coin** (a white
   coin with an even-odd "D" hole). Exact asset from the prototype (`cosmos.html` lines 266–278):
   ```html
   <svg viewBox="0 0 94 94" aria-hidden="true">
     <defs><linearGradient id="coinGrad" x1="0" y1="0" x2="0.45" y2="1">
       <stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#f1f1f5"/><stop offset="1" stop-color="#d6d6dd"/>
     </linearGradient></defs>
     <path fill="url(#coinGrad)" fill-rule="evenodd"
       d="M47,0 A47,47 0 1,0 47,94 A47,47 0 1,0 47,0 Z M44,19 L44,75 Q44,80.5 49.5,79 A38,33 0 0,0 49.5,15 Q44,13.5 44,19 Z"/>
   </svg>
   ```
   Keep the soft **accent corona** behind it (already a cheap radial-gradient disc — **not** a `filter:blur`,
   per §14.11; the prototype's `.core-glow` uses `blur(80px)` which we deliberately avoid on mobile).
   Give it a `drop-shadow` like the prototype. The moon's gradient id `coinGrad` must be unique/scoped.
2. **Prototype colors.** Swap `present.ts`'s `PLANET_PALETTE` to the prototype hues: violet `#7d6bf0`,
   cyan `#56cfee`, amber/yellow `#ff9d3c`, green `#4fd6a0`, **red `#ff5a6a`**, mars-grey `#3b3b46`.
3. **More varied sizes.** Today size is *only* `BASE_SIZE × health` (28–48px, low variance). Add a **varied
   base size per host** — derive from **service count** (a host running more services = a bigger planet),
   clamped to a sensible px range, **then × health scale**. So sizes spread like the prototype (which had
   22/26/40/44/48px) *and* still encode health. Keep the derivation a clean, named function (the owner may
   want to tweak/toggle the basis later — "shape data to extend").
4. **Decorative Greek-letter glyphs** (owner wants to **experiment**). Replace the host-initial `symbol`
   with a **Greek letter** per host (deterministic, e.g. an alpha…omega array indexed by `hash(id)` or
   index). Keep it easy to swap the glyph set (the owner will try different ones). Embossed styling stays.
5. **Manual selection (no auto-cycle).** Cosmos must NOT use the auto-advancing `featured` /
   `useFleetCycle` (that's vapor's carousel — it auto-moves the highlight every 6s, which the owner does
   NOT want here). Give cosmos its **own selection store** (`createStore`, e.g. `store/cosmosSelection.ts`
   or local to the theme) holding the selected host id (null = none). Tap a planet → set it; nothing
   auto-selects. (Leave `useFleetCycle` alone — it's global; cosmos simply ignores `featured`.)
6. **Orbit rings: subtle + decorative, not one-per-planet.** The prototype's rings are faint, several, and
   **decoupled from planet positions** (planets scatter; rings are ambiance, centered on the moon). Replace
   the current one-ring-per-host-radius approach with **a few soft ambient rings** (fixed set, low opacity).

### C2b (orbit + selection animation + indicators)
7. **Orbit animation.** Continuously rotate `.cosmos-solar` via a **compositor CSS `transform: rotate`**
   (keyframes, `animation-play-state` + `animation-duration` driven by the cosmos motion settings —
   **not** a rAF/`@property --angle` loop, which runs on the main thread; research §6). **Counter-rotate**
   each planet so its glyph stays upright. Gate on `ui.motion==='full' && orbitalMotion`; tempo =
   `motionSpeed` (the same `motion.ts` multipliers the starfield uses). `will-change: transform` only on
   the orbiting elements. Pause when off-tab/hidden + reduced-motion (freeze to static positions).
8. **Camera zoom-follow on selection.** Tap → the camera **zooms toward the selected planet and follows it
   along its orbit** (the prototype's `setFocus`). This is *interaction-driven* motion, so a rAF transition
   on `.cosmos-solar`'s transform (scale + translate to keep the planet centered) is acceptable (research
   §6 explicitly OKs rAF for non-steady transitions). A "back / all systems" affordance deselects.
9. **Breathing-pulse latency** (the graphless "ping"). Online planet gently **breathes** (scale+opacity)
   at a **cadence set by ping** (fast = low ms, slow = laggy, none = offline). Pure transform/opacity. The
   prototype's `.halo` (an expanding ring, `@keyframes halo`) can layer in as the online-liveness ring.
   Offline = desaturated + dimmed + **frozen** (already partly done via `.off`). Redundant (not color-only);
   reduced-motion freezes to a static glow-present/absent.
10. **Service cue (besides size): moons ≤3 / fill-arc >3.** Hosts with **≤3 services** show small **moons**
    (one per service, dark/absent when that service is down); **>3 services** show a single **fill-arc**
    (filled fraction = services up). **Design this cleanly/configurably** (owner: "we might want a toggle or
    to edit it later") — e.g. one `serviceCue(services)` that returns the chosen representation, threshold a
    named const, so a future per-theme setting can force moons|arc|off.
11. **Fit-to-stage responsive scale** so large fleets never clip on a phone (measure the stage, scale
    `.cosmos-solar`). Today `RING_SPACING=64` is a fixed mobile-ish value.

### C3 (bottom-sheet HostDetail)
12. **Build a dependency-free, reusable `BottomSheet` primitive** (shared kit-level — frontier's HostDetail
    wants one too). Ref-driven `transform: translateY` drag (never re-render per pixel, never animate
    `height`); Pointer Events + `setPointerCapture`; velocity-OR-25%-distance snap; CSS-transition snap (no
    JS spring); `touch-action: none` on the handle; **non-modal** (`role="dialog"` *without* `aria-modal`,
    no focus trap, Escape + a real Close button + return focus). Snap points `[closed, open]` — leave a
    **future taller/expanded** point as a purely additive entry (owner: "maybe full-screen later, not now").
    Desktop: `max-width` centered, same gesture. (Patterns in §6 — borrow from vaul; do NOT add a dep.)
13. **Cosmos HostDetail content** inside the sheet: stats + services list + action bar (wake/reboot/
    shutdown/ping via `useFleet`'s `run`). **No ping line-graph** — use the space indicators instead. The
    stats/services/actions sub-components should be reusable (frontier reuses them); extract shared content
    if it pays off (don't duplicate vapor's DeviceRow markup — see §7 "no duplication").

---

## 4. Performance focus (the §14.11 budget — non-negotiable)

Every cosmos animation/effect must pass `THEME_ENGINE.md §14.11` (memory: `themes-smooth-on-firefox-and-chrome`):
- **Animate `transform`/`opacity` ONLY** (compositor). Never `top/left/height/margin`, never an
  `@property`/CSS-variable-trig orbit (main thread).
- **Gate `backdrop-filter: blur()`** — heaviest on Firefox-Android; ≤3–5 on screen; behind `data-perf=lite`.
  Prefer **radial-gradient glows** over `filter: blur` (we already swapped the core glow).
- **`will-change: transform` only on actually-animating elements** (the orbiting planets/solar) — blanket
  use = layer/memory explosion on mobile.
- **DOM planets, not canvas** (≤25 nodes → DOM wins; canvas only at hundreds). Hybrid: canvas starfield
  layer + DOM planet layer. Keep composite layers ~3–5.
- **Pause** the orbit + starfield off-tab / `document.hidden` + reduced-motion; **no per-frame layout reads**
  (`getComputedStyle`/`getBoundingClientRect`) — cache them.
- Test on **Firefox-Android (Fennec) AND Chrome**; must be smooth + overflow-safe + text-wrapping.

---

## 5. Architecture & the seams to REUSE (do not bypass)

- **Theme module:** `src/themes/cosmos/` — `index.tsx` (the `ThemeDef`: palettes/loaders/settings/`present`),
  `CosmosRoot.tsx` (composes `<CosmosStarfield/>` + `<DefaultRoot Fleet={CosmosFleet}/>`), `CosmosFleet.tsx`,
  `CosmosStarfield.tsx`, `present.ts`, `motion.ts`, `fonts.ts`, `tokens.css` (palette tokens), `cosmos.css`
  (bespoke structural CSS — `@scope([data-skin=cosmos]) @layer theme`).
- **Reuse the Kit:** `theme-engine/kit/DefaultRoot.tsx` exposes the **`Fleet` prop** (the per-theme signature
  slot) — cosmos passes `CosmosFleet`; everything else (AppBar/NavBar/Composer/Agent/Conf/Utils) is reused.
  cosmos.css makes `.kit` transparent so the starfield shows through (don't fork the Kit).
- **`useFleet` (headless controller, `hooks/useFleet.ts`):** the SINGLE source of hosts/services/featured/
  busy/actions. CosmosFleet is a **pure consumer** — no new data plumbing, no direct fetching. `run(action,
  host)` is the action chokepoint (confirm-gated underneath). `svcByHost` is the memoized per-host service
  map. **Do NOT** re-implement fleet data access.
- **`present()` (ThemeDef.present, §9.9):** `(host, index, override) => VisualEncoding` —
  `{position:{angle,radius}|{x,y}, size?, color?, symbol?, motion?, [extra]}`. Cosmos owns its encoding;
  the per-host `override` (C4, future) shallow-merges on top (additive — "shape data to extend"). Size that
  needs fleet-wide service data is computed in CosmosFleet (present is pure host+index); both are fine.
- **`motion.ts`:** the ONLY place the orbit/starfield tempo lives. Orbit (C2b) reads the same
  `COSMOS_SPEED` multipliers + `orbitalMotion`/`motionSpeed` settings. Don't hardcode speeds at call sites.
- **Selection store (NEW, C2a-fix):** use the dep-free `store/createStore.ts` factory (the project's
  `useSyncExternalStore` pattern — see `store/ui.ts`/`chat.ts` for the slice idiom). Cosmos selection is
  theme-local state, decoupled from `featured`.
- **Per-theme settings (§14.3):** add cosmos settings via `ThemeDef.settings` (auto-rendered in Conf
  Appearance). A future "service cue: moons|arc|off" toggle is a `seg` entry — additive, no core change.
- **BottomSheet (NEW, C3):** a reusable primitive (likely `components/BottomSheet.tsx`), NOT cosmos-only.
  Check first whether an overlay/modal primitive already exists to reuse (`ConfirmDialog`/`PromptModal`).

---

## 6. Web-research already done (cite/verify; don't re-derive from memory)

**(a) DOM vs canvas for the orbital fleet** — DOM `<button>` planets win decisively for ≤25 interactive
nodes (free hit-testing, focus, ARIA, per-planet CSS); canvas only pays at hundreds–thousands. Hybrid
(canvas starfield + DOM planets) is a recommended pattern. Orbit via **compositor `transform: rotate`** on a
rotating container (CSS keyframes/WAAPI), counter-rotate planets; **avoid** rAF/`@property --angle` for the
*steady* orbit (main thread) — rAF is fine for the *selection zoom-follow* transition. `will-change` only on
movers; keep layers 3–5; gate blur. Sources: svggenie SVG-vs-canvas-vs-webgl, kirupa DOM-vs-canvas,
Smashing "GPU Animation Doing It Right", codersblock orbit-animations, MDN Optimizing-canvas, motion.dev tier-list.

**(b) Draggable bottom sheet (dependency-free)** — ref-driven `transform: translateY` (vaul's lesson: a CSS
*variable* for the offset triggers descendant style-recalc → drop frames; transform the element directly).
Pointer Events + `setPointerCapture`; velocity = |Δy|/Δt, snap if velocity>threshold OR distance>~25%;
CSS-transition snap (clear it on next pointerdown); `touch-action:none` on the handle; handle-only drag
avoids the scroll-vs-drag gate. **Non-modal** (`role=dialog` no `aria-modal`, no focus-trap, Escape + Close +
return-focus). Snap array leaves room for a future tall point. Sources: emilkowal.ski building-a-drawer,
vaul `src/index.tsx`, react-spring-bottom-sheet (a11y), viliket native-bottom-sheets, MDN dialog/complementary
roles, M3 bottom-sheets a11y, javascript.info pointer-events.

**(c) Space-themed status indicators (replace the ping graph)** — **breathing-pulse cadence = latency**
(fast=snappy, none=offline) is the graphless ping (cheapest, "alive" metaphor); glow-present+motion vs
**desaturated+frozen** = online/offline (triple-redundant, not color-only); **size = aggregate service
health** (decided) + **moons (few services) / single fill-arc (many)** + color tier as redundant backstop;
rotation speed = optional load. All transform/opacity; gate blur; reduced-motion freezes (online=static
glow, offline=none). Avoid: many concentric service rings, particle comet tails (gimmicky / perf). Sources:
scifiinterfaces (orbital-HUD critiques), Elite Dangerous / No Man's Sky system maps, dev.to performant-pulse,
SitePoint 60fps-mobile, PubMed redundant-encoding (66%→88% identification).

---

## 7. Conventions & rules (from CLAUDE.md / AGENTS.md / memory)

- **Pre-flight before coding:** read the touch points, reuse existing structures/architecture, no hardcoding
  (tunables → config/settings/named consts), **no duplicated/near-duplicate code**, no bypassed chokepoint.
  Write the design in prose + **confirm with the owner before building**.
- **Don't duplicate — either direction.** Reuse `useFleet`, the Kit, `createStore`, existing overlay
  primitives. If cosmos HostDetail content overlaps vapor's DeviceRow, extract a shared sub-component rather
  than copy markup (but don't over-abstract before a 2nd consumer exists — judgment call, surface it).
- **Shape data to extend, not migrate:** per-host overrides, service-cue choice, glyph set, sizes → unified
  extensible objects / named consts / `ThemeDef.settings`, not parallel maps.
- **Build in small slices; AUDIT each part** (clean/robust/efficient/reliable/final-product fit) before the
  next; **pause for owner review between slices** (don't momentum-continue). Run the **coding-discipline +
  audit skills**. Adversarial-review structural changes.
- **Tests:** add unit tests for the *logic* (present/encoding/size/selection/snap math) — jsdom can't test
  canvas/rAF visually, so cover the pure functions; the visuals are reviewed live. Never live-test config
  writes against the real `config.yaml` (use `CTRLB_CONFIG`/`CTRLB_DB`).
- **Commit** only when it makes sense (owner allows autonomous commits if each change is clearly stated);
  **push needs the owner's OK** (they've been asking for push lately — confirm). Footer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **OS-agnostic** v2 code; Windows: no `uvicorn --reload`; PowerShell has no `tail`/`head` (use
  `Select-Object`), or use the Bash tool.

---

## 8. Owner preferences captured this cycle (don't relitigate)

- **Manual selection** in cosmos (no auto-cycle/auto-highlight). Tap → **zoom-follow** the planet → a
  **draggable bottom sheet** (improved from the prototype's panel). **No full-screen** sheet yet (future).
- **No ping line-graph** → space indicators (breathing-pulse latency primary).
- **Size:** varied base (per host) **×** service health.
- **Colors:** the prototype's exact palette (incl. red + mars-grey).
- **Glyphs:** decorative **Greek letters** — experiment with sets (keep swappable).
- **Service cue:** moons ≤3 services, fill-arc >3 — **designed configurably** (future toggle/edit).
- **Motion:** gentle tempo (Calm/Normal/Lively already tuned in `motion.ts`); orbit reuses these.
- **Starfield:** density/size/tempo already tuned to the owner's eye — don't change without asking.
- **Scrim band finding** (Kit edge scrims paint `--bg` over the starfield under the transparent shell): the
  owner chose to **leave it for now** (looks fine). Revisit only if asked.

---

## 9. Suggested execution order (each = its own slice + review)

1. **C2a-fix** — D-moon SVG · prototype palette · varied base size (× health) · Greek glyphs · manual-select
   store (decouple from `featured`) · decorative ambient rings. Tests for size/glyph/selection logic. Review.
2. **C2b** — compositor orbit (motion-gated) + counter-rotate · breathing-pulse latency + halo · service
   moons/arc (configurable) · fit-to-stage scale · camera zoom-follow on select. Review (perf on Android!).
3. **C3** — reusable `BottomSheet` primitive (a11y + drag + snap) · cosmos HostDetail content (stats/services/
   actions via `useFleet.run`, no ping graph) wired to selection. Review.
4. **C4 (later)** — per-host `appearance.cosmos` override (additive on `present()`), if/when wanted.

Then: update `HANDOFF.md` (mark cosmos done) and consider lifting `present()` learnings into
`THEME_ENGINE.md` for the next spatial theme (frontier).
