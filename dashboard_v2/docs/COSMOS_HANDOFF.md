# Cosmos theme — implementation handoff (C2a-fix → C2b → C3)

**Read this first, then the doc map below.** This is a focused handoff for finishing the **cosmos** theme
(the bespoke orbital/space theme). It assumes you've read `CLAUDE.md` + `AGENTS.md` + the canonical
[`HANDOFF.md`](./HANDOFF.md). **C1 (starfield), C2a-fix (palette/runes/sizing/selection/rings/moon-toggle/
Pluto/fit-to-stage), and ALL of C2b (orbit · camera zoom-follow + tap-hit-area · liveness pulse/halo ·
service-cue moons/ring) are shipped + pushed on `main`.** The ONLY remaining cosmos work is **C3 — the
bottom-sheet HostDetail** (tap a planet → zoom → a draggable sheet with stats/services/actions). **C3's
design is LOCKED — jump to [§10](#10-c3--locked-design--build-plan-start-here) and build.**

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

## 2. Current state (shipped + pushed on `main`)

Everything below C1 is DONE, committed, pushed, audited, and green. Cosmos file inventory lives in
`frontend/src/themes/cosmos/`: `index.tsx` (ThemeDef + settings), `CosmosRoot.tsx`, `CosmosStarfield.tsx`,
`CosmosFleet.tsx`, `CosmosMoon.tsx`, `present.ts`, `runes.tsx`, `motion.ts`, `orbit.ts`, `camera.ts`,
`liveness.ts`, `serviceCue.ts`, `fonts.ts`, `tokens.css`, `cosmos.css`. Selection store:
`src/store/cosmosSelection.ts`. Tests: `tests/themes/{cosmos,present,orbit,camera,liveness,serviceCue}.test.ts`
+ `tests/store/cosmosSelection.test.ts`.

- **C1 (starfield)** — `CosmosStarfield.tsx`: fixed full-viewport twinkle canvas; perf-disciplined; gated by
  the GLOBAL Motion lever only (the old per-theme `orbitalMotion` switch was removed as redundant).
- **C2a-fix** — `present.ts` (index-based 10-color palette + rune-id symbol; `planetSize` by service count ×
  health), `runes.tsx` (SVG "rune" glyphs — drawn not fonted, §14.12), `CosmosMoon.tsx` (Cutout/Carved moon
  toggle), manual-selection store, per-planet orbit rings, decorative in-view "Pluto", and the **fit-to-stage
  camera** (full-bleed `.cosmos-stage` absolute layer → system fits/centers the LIVE ZONE between appbar +
  composer; fixed the scrollbar + the "black box / no-glass" composer by letting the system bleed behind the
  glass chrome — see THEME_ENGINE §14.13 #8).
- **C2b-1 orbit** (`orbit.ts`) — per-planet WAAPI `transform` orbit (translate, glyph upright, no
  counter-rotate). `offset-path` rejected (NOT composited on Firefox-Android). All planets PROGRADE
  (realistic); de-synced by radius-based periods + golden-angle phase. `orbitStyle` setting (Per-planet /
  Rigid / Off). Gated by global Motion + Fleet-tab-active + `document.hidden`; tempo → WAAPI `playbackRate`.
- **C2b-2 camera** (`camera.ts`) — `useCameraFollow` OWNS `.cosmos-camera`'s transform (fit-scale + zoom +
  follow); selecting a planet eases (frame-rate-independent exp damping) to `scale×2.2` and TRACKS it via the
  orbit's `currentTime` (layout-free). rAF runs only while tracking-a-moving-selection or easing; stops when
  idle/frozen/deselected. + the 44px tap-hit-area (`::after`).
- **C2b-3 liveness** (`liveness.ts`) — `liveness` setting Pulse / Halo / Both / Off. Pulse = a tight tinted
  glow that breathes at a **ping-cadence**; Halo = expanding ring. Online-only children, z-index:-1, Motion-
  gated (reduced-motion → static glow). Transform/opacity only.
- **C2b-4 service cue** (`serviceCue.ts`) — `serviceCue` setting **Data / Visual / Off**. Data: ≤2 services →
  orbiting muted moons (lit=up/dim=down, de-synced — globally distinct periods + seeded direction + per-host
  phase); ≥3 → a full ring whose **stroke-WIDTH** = up-fraction (never drops a segment). Visual: exactly THREE
  decorative moons across the fleet (one host 2, one host 1, rest 0), **re-rolled per page load** via a
  `useState`-lazy salt (stable within the session), no rings. `ServiceCueLayer` lives at the bottom of
  `CosmosFleet.tsx`.

**Cosmos settings (auto-rendered in Conf · Appearance):** `moonStyle` · `motionSpeed` · `orbitStyle` ·
`liveness` · `serviceCue`. (Global Motion is the master on/off.)

**Commits (newest → oldest):** `2d44741` (serviceCue Visual) · `5dbdb51` (C2b-4) · `6fbf3d6` (C2b-3) ·
`723f93e` (C2b-2) · `12bc5e9` (C2b-1) · `2639ea2` (C2a-fix).

**Tests:** **178 unit / 34 e2e** green. Run in `dashboard_v2/frontend`: `npm test` · `npm run test:e2e` ·
`npm run build` · `npm run typecheck`. Dev server is usually ALREADY running — backend `uvicorn
app.main:app --port 5433` (NO `--reload` on Windows), frontend `npm run dev` (port **5173**); **check
`netstat` first**. Live visual checks use Playwright scripts in the scratchpad that intercept
`GET /api/appearance` to force `theme:"cosmos"` + the setting under test (see §10.7).

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
- **Size:** varied base (per host) **×** service health. *(shipped)*
- **Colors (FINAL):** a fixed **index of 10 distinct colors** (amber, cyan, purple, green, …), assigned by
  host position — NOT id-hash, NOT the prototype's exact palette. The red is last so a new host won't mimic
  the decorative Pluto. *(shipped — C2a-fix)*
- **Glyphs (FINAL):** **custom SVG "runes"** (circle/point/radius marks), drawn not fonted (§14.12). NOT
  Greek letters (that was an earlier experiment). *(shipped)*
- **Service cue (FINAL):** moons for **≤2** services / fill-**ring** for **≥3** (ring width = up-fraction,
  not a missing segment). Setting = **Data / Visual / Off**; Visual = exactly 3 decorative moons fleet-wide,
  random per refresh. *(shipped — C2b-4)*
- **Planets all PROGRADE** (same direction — realistic); **moons can retrograde** (realistic captured moons)
  and are de-synced. *(shipped — C2b)*
- **Motion:** gentle tempo (Calm/Normal/Lively in `motion.ts`); orbit + moons reuse it. The GLOBAL Motion
  lever is the master on/off (the per-theme `orbitalMotion` switch was REMOVED as redundant). *(shipped)*
- **Starfield:** density/size/tempo tuned to the owner's eye — don't change without asking.
- **Scrim band:** RESOLVED — the full-bleed `.cosmos-stage` + a Fleet-tab scrim-off means the system bleeds
  behind the glass composer (no dark band). See THEME_ENGINE §14.13 #8.
- **C3 decisions (LOCKED this session):** (1) **cosmos-specific `CosmosHostDetail`** — do NOT extract a
  shared-with-vapor component (vapor's `DeviceRow` is frozen; the Kit's `KitFleet` already has its OWN inline
  `DeviceRow` — each presentation owns its markup, all sharing `useFleet`; cosmos is the 3rd, promotable to a
  shared kit component only when frontier needs it). (2) **NO backdrop scrim** behind the sheet (keep the
  orbital system visible; the sheet's own shadow/glass gives depth). Full plan in §10.

---

## 9. Execution order

1. ~~**C2a-fix**~~ ✅ DONE (commit `2639ea2`).
2. ~~**C2b**~~ ✅ DONE — orbit `12bc5e9` · camera+hit `723f93e` · liveness `6fbf3d6` · service-cue `5dbdb51`
   · visual-cue `2d44741`. (fit-to-stage landed inside C2a-fix.)
3. **C3** ← **NEXT. Design LOCKED — see §10.** Reusable `BottomSheet` primitive (C3a) → `CosmosHostDetail`
   content wired to selection + camera lift (C3b).
4. **C4 (later)** — per-host `appearance.cosmos` override (additive on `present()`), if/when wanted.

---

## 10. C3 — LOCKED design + build plan (START HERE)

**Goal:** tap a planet → (camera already zoom-follows, C2b-2) → a **draggable bottom sheet** slides up with
that host's detail (stats + services + actions). Two slices, each its own commit + owner review.

### 10.1 Decisions already locked (do NOT relitigate — owner confirmed this session)
- **`CosmosHostDetail` is cosmos-specific** (its own component + cosmos/token styling). Do NOT extract a
  shared-with-vapor component and do NOT touch vapor's `components/DeviceRow.tsx` (frozen, D7). Rationale:
  the *data layer* (`useFleet`) is the shared part and IS reused; markup legitimately differs per theme —
  vapor's `DeviceRow` and the Kit's inline `DeviceRow` (in `kit/Fleet.tsx`) are already two separate
  presentations sharing `useFleet`. Cosmos is the 3rd. Promote to a shared kit component only when **frontier**
  exists (a real 2nd consumer) — not before.
- **No backdrop scrim.** The sheet is a glass panel over the lower area; the orbital system stays fully
  visible above it (the zoomed planet floats above the sheet). Depth comes from the sheet's own shadow/glass.
  (Non-modal anyway — see 10.3.)

### 10.2 Reuse map (what to lean on)
- **`useFleet()`** (`hooks/useFleet.ts`) — `hosts`, `svcByHost`, `run(action, host)`, `busy`. `run` handles
  the confirm dialog + optimistic flips + toasts already (`useActions.ts` `FleetAction = wake|shutdown|reboot|
  ping`). The action bar just calls `run("wake"|"shutdown"|"reboot"|"ping", host)` and disables on `busy.has(id)`.
- **Content reference (NOT to import — to mirror):** the Kit's inline `DeviceRow` in
  `src/theme-engine/kit/Fleet.tsx` (lines ~108–221) shows the exact fields to surface: stats grid (IP,
  MAC, Last seen via `lib/relativeTime`, Ping), services list (name · `host:port` · LED · open `s.url` in a new
  tab when `s.status.online && s.url`), wake/stop buttons. Cosmos shows the SAME data + reboot + ping, styled
  for space, **no ping line-graph** (use the liveness/space indicators instead).
- **Types:** `Host`/`HostStatus`/`Service` in `src/types.ts` (see §6 of the explore — ping_ms, last_seen,
  ip, mac, ssh_*, os_type, role; service: name, port, url, status.online, controls).
- **Selection store:** `src/store/cosmosSelection.ts` (`useCosmosSelection` / `setCosmosSelection`) — the
  sheet is OPEN when `selected != null`. CosmosFleet already clears a stale selection if the host leaves.
- **`createStore.ts`** if any new shared state is needed (dep-free).

### 10.3 C3a — the `BottomSheet` primitive (dependency-free, reusable)
New file: `src/components/BottomSheet.tsx` (kit-level, shared — frontier reuses it). Web-research is DONE
(§6b — cite emilkowalski/vaul/react-spring-bottom-sheet; re-verify only if deviating). Mechanics:
- **Ref-driven `transform: translateY`** drag — transform the element directly; do NOT animate a CSS var or
  `height` (vaul's lesson: CSS-var offset recalcs descendants → drops frames). Never re-render per pixel.
- **Pointer Events + `setPointerCapture`**, drag on a **handle** only (sidesteps the scroll-vs-drag gate);
  `touch-action: none` on the handle.
- **Snap:** velocity (`|Δy|/Δt`) over a threshold **OR** dragged > ~25% of the sheet height → dismiss; else
  snap back open. **CSS-transition** for the snap (add a `transitioning` class; clear the transition on the
  next `pointerdown` so the drag is 1:1). No JS spring.
- **Non-modal a11y:** `role="dialog"` **WITHOUT** `aria-modal`; **no focus trap**; **Escape** closes; a real
  **Close** button; **return focus** to the trigger on close. Snap points as an array `[closed, open]` — leave
  a future "expanded/tall" point as a purely-additive entry.
- **Desktop:** `max-width` centered, same gesture. **No scrim** (10.1).
- **API (controlled):** `<BottomSheet open onClose>{children}</BottomSheet>` — `open` mounts/raises it;
  drag-dismiss / Escape / Close → `onClose()`. Keep it presentational (no host logic inside).
- **Perf/§14.11:** transform/opacity only; the sheet gets `will-change: transform` while dragging only; gate
  any blur behind `data-perf`; respect reduced-motion (snap instantly, no spring feel).
- **Tests** (jsdom-safe): the snap-decision math (velocity-or-distance → dismiss vs snap-back) as a pure
  helper (e.g. `shouldDismiss(dragPx, sheetH, velocity)`); the drag/transform itself is verified live.

### 10.4 C3b — `CosmosHostDetail` + wiring
New file: `src/themes/cosmos/CosmosHostDetail.tsx`. Rendered by `CosmosRoot` (or `CosmosFleet`) inside a
`<BottomSheet open={selected != null} onClose={() => setCosmosSelection(null)}>`.
- **Content (cosmos-styled, token-driven):** a header (host name + online/role), a stats grid (IP · MAC ·
  Last seen · Ping — mirror `KitFleet`'s `DeviceRow` fields), a services list (name · `host:port` · status
  dot · open `s.url` ↗ when online), and an **action bar** (Wake when offline; Reboot + Shutdown when online;
  Ping always) → `useFleet().run(...)`, disabled while `busy.has(host.id)`. **No ping line-graph.**
- **Camera lift:** when the sheet is open it covers the lower area, so the focused planet must sit ABOVE it.
  The camera (`camera.ts`) already lifts to the live-zone center via `centerOffsetY`; shrink the effective
  live zone by the sheet's height when open (pass a larger upward offset), so the planet floats above the
  sheet (prototype's "focused ≈0.44h" feel). The sheet height is known (its snap-open height) — thread it
  into the `centerOffsetY` calc in `CosmosFleet`.
- **Selection ↔ sheet:** open iff `selected`; the host = `hosts.find(h => h.id === selected)`. Dismiss →
  `setCosmosSelection(null)` → sheet closes + camera eases back (already wired). Tapping a different planet
  swaps the host (selection changes; sheet stays open with new content).
- **Reusability seam:** keep the stats/services/action sub-bits as small local components so they can be
  lifted to a shared kit module when frontier lands (don't pre-abstract now).

### 10.5 Slicing & cadence
C3a (BottomSheet primitive, placeholder content) → **review** → C3b (HostDetail + camera lift) → **review**.
Small audited parts; pause for owner review between slices; the owner reviews visually on Android + desktop.

### 10.6 Gotchas / invariants (bitten this cycle — don't repeat)
- **Firefox-Android (Fennec) is the primary device.** Two things are NOT composited there and were rejected:
  CSS **`offset-path`** and **WAAPI `composite:"add"`**. Use plain `transform` (translate/rotate/scale).
- The **camera owns `.cosmos-camera`'s transform** imperatively (`useCameraFollow`) — do NOT also set it in
  React/JSX (single owner; no fight). The sheet must not write that transform.
- **No Math.random/Date.now in pure modules** (keep them pure + testable); isolate randomness to the
  component (the visual-cue salt is a `useState` lazy-init in `CosmosFleet`).
- Keyframes are GLOBAL — prefix every cosmos one `cosmos-*` (§14.13 #4).
- The full-bleed stage means the sheet, the camera, and the chrome all share the same area — verify the
  sheet sits above the navbar (z-index) and the composer doesn't fight it (the Fleet tab has the composer;
  the sheet covers the lower area — decide stacking: sheet over composer, or hide the composer while the
  sheet is open? Confirm with the owner during C3b).

### 10.7 Verify like this session did
- `npm run typecheck` · `npm test` · `npm run build` · `npm run test:e2e` (all must stay green; 178/34 now).
- **Live visual + behavior** via a Playwright script against the running dev server (port 5173) that
  intercepts `**/api/appearance` to force `doc.theme="cosmos"` (+ `motion`, + `theme_settings.cosmos.<setting>`),
  then drives/inspects the DOM. Use `click({force:true})` on planets (they orbit → "not stable" otherwise).
  Sample `.cosmos-camera` `style.transform`, element rects, `getAnimations()`, `getComputedStyle(...).animationName`
  to assert behavior (zoom on select, sheet translateY on drag, no scroll, reduced-motion freeze). Screenshot
  at Pixel-5 (phone) AND a desktop viewport; the owner reviews the images. Scratchpad dir is in the harness
  env; copy any `*.mjs` into `frontend/` before `node`-running so it resolves `@playwright/test`.

### 10.8 After C3
- Update this doc + `HANDOFF.md` to mark cosmos **done**; consider lifting `present()`/orbit/camera learnings
  into `THEME_ENGINE.md` for the next spatial theme (frontier). C4 (per-host `appearance.cosmos` override) is
  optional/later.

Then: update `HANDOFF.md` (mark cosmos done) and consider lifting `present()` learnings into
`THEME_ENGINE.md` for the next spatial theme (frontier).
