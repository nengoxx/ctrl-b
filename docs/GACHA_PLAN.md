# The gacha theme ("Capsule Arcade") — port plan (H1 → Phase 17)

> **Status: DRAFT 2026-08-02 — design NOT locked.** Produced by the prep session from the owner's
> FINISHED prototype (`design/prototypes/gacha/uploads/prot/capsule-arcade/` — the owner's ruling
> 2026-08-02: that file set is FINAL; every other tree under `design/prototypes/gacha/` is a prior
> iteration kept for provenance). The lock session must: run the council round (Codex + an
> independent lens per the method), settle §8's owner questions, then record the D-entry (next
> free: **D52**) in DECISIONS.md. On conflict after the lock: the D-entry wins, then this plan.
> **Fidelity mandate: the owner wants visuals, colors and transitions/animations AS CLOSE AS
> POSSIBLE to the prototype** — same bar as the Vapor-fidelity mandate (ARCHITECTURE), applied to
> a NEW build instead of a port-of-record.
>
> Companion reading before the lock session: `ROADMAP.md` §H1 (the theme's charter + the
> theme-population amendment), `FRONTIER_PLAN.md` (the playbook this follows), `THEME_ENGINE.md`
> §14.4.1 (kit theming pattern) / §14.11 (smoothness allowlist) / §14.15.1 (hardening invariants
> incl. the ⑨ contrast probe) / §15 (chat hooks contract), `DECISIONS.md` D37 (composer axes),
> D51 (the kit end-state this builds on).

## 0. What this document is

The owner iterated the gacha look OUTSIDE the repo to a finished standalone prototype, then gave
a requirements round (2026-08-02, §2). This plan (a) inventories the prototype precisely, (b) pins
the owner's requirements against it, (c) maps every piece onto the kit engine with the extension
points named, and (d) leaves the genuinely-open choices as §8 questions for the design session.
It was drafted by the main seat from a full read of all five prototype files (357 lines total) +
the kit seams, with an Opus seam-verification pass and two Codex rounds over the draft.

## 1. The prototype — inventory (all five files read in full)

**Files (five, 357 lines total).** `capsule-arcade/index.html` (42 dense lines — the full DOM),
`capsule-arcade/theme.css` (152), `capsule-arcade/theme.js` (22), `shared/base.css` (81),
`shared/common.js` (60 — the `PROTO` harness: hosts fixture, view-transition wrapper, tab
switcher, settings binders; its `press()` squash helper is DEFINED BUT NEVER CALLED — an unused
harness capability, not a port obligation). Assets:
`assets/gacha/` (7 images: bg-fleet.jpg wallpaper/banner art, bg-eye.png oracle art, pegasus.jpg /
atlas.jpg / rook.png / lyra.png card art, lyra-cutout.png the transition figure).

**Screens.**
- **Fleet** — `topbar` (brand "CAPSULE ARCADE" + JP subtitle ネットワーク景品所, gradient-text
  wordmark), the **pickup banner** (3-slide auto-carousel, 5.2 s cadence, 620 ms ease-out slide;
  per-slide art + tag pill + italic display copy + JP captions; `banner-glow` breathing radial
  (expensive-effect); `banner-rate` pills top-right: **"★3 RATE 3.0%" + "天井 200"**; dots),
  `track-head` (編成 / "Select a unit" + count 04/04), the **capsule track** — a 2-col grid of
  `capsule-card`s (aspect 3/4; `feat` 5/4 full-row, `wide` 16/9 full-row variants; corner-notch
  via `mask: linear-gradient(315deg, transparent 0 20px, #000 20px)`; art + `rar` stars + `state`
  ribbon (ONLINE gradient green/cyan · SLEEPING grey · NEW) + `plate` name/role/ping + hover
  `shine` sweep + hover img scale 1.05; `sleep` cards greyscale).
- **Agent** — the **oracle** header (300 px art block: bg-eye.png + scanline loop (expensive) +
  "PRIZE OPERATOR / Lucky Relay ラッキーリレー"), then the chat log (bot bubbles `#222541`; user
  bubbles WHITE with a hard pink offset shadow `5px 5px 0 #ff6cae`), the composer (floating
  rounded bar, コマンド入力… placeholder, white GO button).
- **Settings** — groups mimicking ctrl-b's axes 1:1 (its own labels say so): Expressive motion,
  Full effects, **Sticky operator art (`data-oracle="fade"`) — prototype default OFF**, **Banner
  wallpaper (`data-wallpaper="on"`) — prototype default OFF**, three-tab note, composer-skin note.
- **Host detail ("UNIT DOSSIER")** — bottom sheet, **inverted light surface** (`#f9f8ff→#dfe4ff`,
  ink `#17172c`, tri-gradient top strip), art frame + `art-rar` stars, 4 metrics (Ping 応答 /
  Load 負荷 / Temp 温度 / Uptime 稼働), service list (colored-dot rows: "Agent bridge · healthy",
  "Open WebUI · :8080", "Backup worker · idle") with a per-host `--host` accent border.
- **Nav** — floating rounded bar, 3 tabs, WHITE sliding indicator pill with a hard pink offset
  shadow, JP sub-labels (編成/案内/設定) in the serif face.

**Motion inventory** (the fidelity surface):
| # | Effect | Mechanics | Gating in the prototype |
|---|---|---|---|
| M1 | Tab **reel transition** | 5 vertical slats (tri-gradient `#ff6caf/#755cff/#57e7ff` — a hair off the brand trio, keep the distinction) sweep top→bottom→exit (520 ms each, 30 ms stagger → last slat done at ~640 ms) + the **reel figure** (lyra-cutout, bottom-center, **height 84%**, drop-shadow + pink glow) fading in/out over 620 ms. **Ordering: the prototype fires the reel BEFORE the tab mutation** (`bindNav` `before()` hook) and the content swap happens under the sweep | reduced-motion nukes it (global .001 ms rule) |
| M2 | Tab switch under the reel | `document.startViewTransition` root cross-fade/scale (old 240 ms scale .96; new 380 ms **+100 ms delay** from 1.04) — **graceful no-op when unsupported** (`PROTO.vt`). NOTE: VT pseudo-elements render in the TOP LAYER, above any z-indexed sibling — M1+M2 compose in the prototype only because the reel is outside the VT'd update; the port must prove the same (§4.1) | reduced-motion skips VT entirely |
| M3 | Capsule → dossier morph | **shared-element view transition** (`viewTransitionName: capsule-shell` handed card-img → sheet-avatar, 560 ms spring) + sheet slide-up 520 ms spring | same VT gate; sheet transition set to `none` under VT to avoid double-animating |
| M4 | Banner carousel | translateX slide 620 ms ease-out; auto-advance 5.2 s **paused when tab≠fleet or document.hidden**; dot morph 300 ms spring | — |
| M5 | Banner glow breathe | 6 s opacity loop, mix-blend screen | `.expensive-effect` → display:none under perf-lite |
| M6 | Oracle scanline | 7 s translateY loop (28 px travel), mix-blend screen | `.expensive-effect` |
| M7 | Oracle fade-on-scroll | JS scroll handler: opacity 1→.28, blur 0→5px, scale 1→1.06 over the first 240 px | only under `data-oracle="fade"` |
| M8 | Card shine sweep + img zoom | translateX −120%→120% 760 ms on hover; img scale 1.05 600 ms | reduced-motion global rule |
| M9 | Press squash | WAAPI scale 1→.94→1.025→1 (360 ms) — **dormant: `PROTO.press` has no call site**; port only if the eyeball wants it | skipped under reduced |
| M10 | Wallpaper fade | opacity 520 ms when entering fleet with wallpaper on | — |
| M11 | Switch knob | 260 ms spring | global rule |

**Palette** (the token extraction base):
| Role | Value(s) |
|---|---|
| Base bg / ink | `#0a0b19` / `#f7f6ff` |
| App backdrop | radial `#3a205b → #11142d 48% → #080914` + a faint 115° pinstripe overlay (`#ffffff08`, 7 px) |
| Surfaces | cards `#14172f` · groups `#16182f` · composer `#15172e` · top/nav bars `#11142e` (~e8–ee alpha, blur 12–14) · bot bubble `#222541` |
| Lines | `#ffffff10`–`#ffffff2e` ladder |
| **Tri-accent** | `#ff6cae` pink → `#805cff` violet → `#54e5ff` cyan (brand text, tags, switch-on, reel slats, dossier strip) |
| Secondary accents | cyan text `#9ff0ff` · pink headings `#ff8ec2`/`#ff8fc6` · unit-no `#c8438b` |
| Stars | gold `#ffd464` (glow `#ffb63f88`); sleeping cards de-saturate to `#b9b3d6` |
| Status | ok `#74f3ad` · warn/amber `#ffc76a` · ONLINE ribbon gradient `#74f3ad→#54e5ff` |
| Dossier (inverted) | surface `#f9f8ff→#dfe4ff` · ink `#17172c` · metric cards white w/ `#c9d0ef` borders |
| Gradient variants | reel slats `#ff6caf/#755cff/#57e7ff` · nav-indicator shadow `#ff6cb1` — near-trio values that are NOT the brand trio; token them separately or consciously unify (fidelity call at the eyeball) |
| Per-host accent pairs | the fixture assigns each host `color`/`color2` (e.g. pegasus `#68e1ff/#8c7cff`) driving the dossier's `--host` service-border — the port derives these from the theme accent or the roster entry (design-session detail) |

*(The table is SEMANTIC coverage of every role, not an exhaustive hex dump — the tokens pass at
G0 extracts values from the CSS directly; theme.css is 152 lines and fully readable.)*

**Fonts.** Zen Kaku Gothic New (400/500/700/900 — body, JP-capable) + Shippori Mincho B1
(600/800 — the serif JP accents: subtitles, 編成/設定 headings, nav sub-labels). Prototype loads
them from the Google Fonts CDN; the repo self-hosts via @fontsource (offline PWA, no third-party
requests) — see §4.6.

**A11y posture already in the prototype:** switches are `role="switch"` + `aria-checked`; overlays
`aria-hidden`; reduced-motion + perf-lite axes wired; focus-visible ring.

## 2. The owner's requirements (2026-08-02) — pinned, each corroborated

| # | Requirement (owner's words, condensed) | Corroboration against the prototype | Plan home |
|---|---|---|---|
| R1 | "visuals, colors and transitions/animations as close as possible" when porting to the kit | §1 is the fidelity inventory; M1–M11 the motion contract | whole plan; §7 gates |
| R2 | Characters replaceable; background replaceable; the transition character replaceable **and smaller** | card art = `ART{}` map (theme.js:3), wallpaper/banner = `bg-fleet.jpg`, figure = `reel-figure` at **84% height** (theme.css:136) | §5 roster; smaller default + tunable |
| R3 | A separate config section: a **roster** (image board / gallery) — visual only, NOT linked to specific PCs, assigned "in order or something like that — we can talk about that specifically" | prototype hardcodes per-host art; the roster REPLACES that binding | §5 + owner Q8.2 |
| R4 | Stars 1–5 from the **amount of services**; the top TWO stars pink-ish golden; "don't necessarily have to match — can be % triggered" | prototype stars are a hardcoded `RAR{}` map (theme.js:4), flat gold | §6 + Q8.3 |
| R5 | **5 stars optional** — a 3-star-max mode to avoid clutter, third star rosy-ish | prototype shows ★★/★★★ only, so 3-star mode ≈ the prototype's own look | §6 (a theme setting) |
| R6 | **Banner wallpaper ON by default**; **sticky operator art (fade) ON by default** | both exist and default OFF (`aria-checked="false"`, index.html settings rows) | §4.5 defaults flip |
| R7 | The banner "★3 RATE 3.0%" becomes **★N RATE M.0%** where M = count of PCs currently ON (4 on → 4.0%); N = the max-star mode (5 → "★5 RATE") | the pill is static markup (index.html banner-rate) | §6.3 |
| R8 | Captions + Japanese characters: **keep as-is for now** | §1 catalogues them | copy freeze; Q8.6 for the brand wordmark |
| R9 | The palette "looks good" but wants **more options, especially for the dark blue-ish stuff** | §1 palette table isolates the blue-navy base ramp | §4.4 palette variants + Q8.5 |
| R10 | Wants this planned thoroughly, corroborated against the prototype, kit translation checked, then handed to a clean session | this document | — |

## 3. Kit translation map — where each prototype piece lands

*(Every seam below was VERIFIED in the prep session — an Opus seam pass with file:line reads,
the load-bearing four re-checked by the main seat: `bodies` override `FrontierRoot.tsx:18`,
`svcByHost` `useFleet.ts:114/143`, the bespoke-agent-body pattern `FrontierAgent.tsx:103`,
per-host art blob `FrontierFleet.tsx:54`. Registration facts: `ThemeId` is a CLOSED union
(`theme-engine/types.ts:14` — add `"gacha"`; `phosphor`/`observatory` are declared-but-superseded
slots, ignore them); the registry (`registry.ts`) holds the 4 BUILT themes — gacha is one new row
+ one self-contained module ("the north star" per the registry's own header). The backend needs
ZERO changes for registration: `AppearanceCfg.theme` is a plain `str`, `theme_settings` an open
dict.)*

| Prototype piece | Kit home | Work class |
|---|---|---|
| Palette + type + radii + line ladder | `themes/gacha/tokens.css` (the kit token contract, §9.7) — incl. the app-backdrop gradient + pinstripe as bg tokens | tokens only |
| Topbar (brand gradient text, JP subtitle, blur bar) | kit AppBar: `brandMark` slot (D51) for the gradient wordmark treatment + `brandMeta` for the JP subtitle; bar surface via tokens + theme-layer polish | tokens + slots |
| Nav (floating pill bar, white indicator w/ pink hard shadow, JP sub-labels) | kit NavBar on theme-layer CSS over kit hooks (`.kit-tabbtn`, indicator) — the sliding-indicator mechanism exists; JP sub-labels see Q8.6 | theme CSS on kit hooks |
| Fleet (banner + capsule track + dossier) | **bespoke Fleet body** — the established bespoke-by-right pattern (vapor's Root-pinned VaporFleet, cosmos' planet fleet + its own detail sheet precedent) | bespoke body |
| Banner rate pill (live) | inside the bespoke Fleet, derived from the same fleet query (online count is client-derivable) | bespoke body |
| Stars | a small pure fn in the bespoke Fleet + dossier (shared source) — §6 | bespoke body |
| Oracle header + fade-on-scroll | **a bespoke Agent BODY** (`bodies={{agent: GachaAgent}}`) — frontier's exact pattern (`FrontierAgent.tsx`: theme art rendered ABOVE the composed shared `<ChatThread/>`, plus its `emptyState` slot; §15 rule 5 — chat engines live in `<AppEngines/>`, a body swap can't lose them). The M7 fade observes the kit's SINGLE scroller — mechanics in §4.2 | bespoke body |
| Chat bubbles (white+pink-shadow user, `#222541` bot) | the §15 chat-hooks reskin — the ONE shared chat tree, never forked; hook classes are `.chat-log` + `.b.user`/`.b.bot`/`.b.sys` etc. (THEME_ENGINE §15 table), NOT the prototype's `.msg` names — the port re-targets selectors 1:1. Chat-only colors become theme-private tokens (§15 token rule; never repurpose `--accent-fill`) | theme CSS on chat hooks |
| Composer (rounded floating, GO) | `composerSkin` axis (D37) — a gacha skin over the shared composer logic (the axis-descriptor factories in `kit/axes.ts` / `kit/composer/`) | axis skin |
| Detail dossier (light inverted sheet) | inside the bespoke Fleet over the shared `<BottomSheet>` — the pattern is established TWICE (`CosmosHostDetail`, `FrontierHostDetail`, both `{host, services, busy, run, titleId}` presentation over `useFleet()`); mind the drag-strip z-index gotcha | bespoke body |
| Reel transition + figure | a Root-sibling overlay component — the cosmos-starfield mount pattern (`CosmosRoot.tsx`: `<><CosmosStarfield/><DefaultRoot/></>`), `position:fixed` + `pointer-events:none` (escapes the kit shell's overflow/isolation). **Ordering caveat (G0 SPIKE — §4.1):** the prototype starts the reel BEFORE the tab mutation via a nav hook; a passive `useUISlice(s => s.tab)` subscriber starts it the SAME FRAME the content swaps. The spike decides passive-start vs a minimal pre-nav hook | theme component + G0 spike |
| Capsule→dossier VT morph (M3) | inside the bespoke Fleet — self-contained, gated on support + motion axis | bespoke body |
| Settings rows (wallpaper, oracle, star mode, palette) | `ThemeDef.settings` — entries auto-render as Conf Appearance rows in declaration order (`ConfTab.tsx:838/2403`), persisted via `setThemeSetting` + read via `useThemeSetting` with spec-validated fallback. **Only two field kinds exist: `switch` and `seg`** — enough for wallpaper/oracle/star-mode; the palette variants ride `ThemeDef.palettes.accents` (native registry model) instead | descriptors |
| Motion/perf axes | already the app's global axes — the prototype was explicitly built against them (`data-motion`/`data-perf`, `.expensive-effect` ≙ perf-lite gating) | free |
| Roster (images + assignment) | **new config + serving seam** — §5 | backend + Conf UI |

## 4. Kit extensions + engineering notes

**4.1 The tab-transition seam — a G0 SPIKE, settled before any Fleet JSX.** Two coupled
questions the draft can't answer on paper (Codex F1 on this plan):

- **Reel start ordering.** The prototype brackets the tab mutation (`bindNav`'s `before()` fires
  the reel, then the mutation runs under the sweep). The kit's navigation chokepoint
  (`hooks/useSections.ts` → `setUI`) swaps tab state immediately; a passive subscriber starts the
  reel the same frame the content swaps. The spike builds the passive version FIRST and compares
  it against the prototype side-by-side on device; if the one-frame difference reads worse, the
  fallback is a **minimal pre-navigation hook at the useSections chokepoint** (one optional
  callback, the D30 slot idiom — NOT a generic transition framework; scope it to "run this before
  the tab write, fire-and-forget"). Re-entrancy (rapid tab taps restart the reel — the TTS-flash
  timer-restart pattern) and reduced-motion (no reel at all) are part of the spike's contract
  either way.
- **M2/M3 View Transitions.** VT pseudo-elements render in the TOP LAYER — above ANY z-indexed
  sibling — so the M2 root cross-fade only composes with the reel if the reel element is excluded
  from capture or the composition is verified visually. Posture: **the reel (M1) is the PRIMARY
  effect and must be complete without VT**; M2 is spike-gated progressive enhancement and is
  **dropped without ceremony** if it fights the reel. M3 (the capsule→dossier morph) is
  independent of the reel, inside the bespoke Fleet, and stays progressive enhancement (fallback
  = the sheet's own slide-up, already the prototype's base behavior; the shared `BottomSheet`'s
  420 ms JS-coupled lifecycle is the timing to compose with — §4.9). Gecko: VT shipped in
  Firefox/Fenix 144 (Oct 2025) — the owner's device build is checked at the same G0 spike.

**4.2 Agent-tab header — RESOLVED: no kit extension; the scroll mechanics are the real work.**
The seam pass settled the slot question: frontier's Agent tab is a full bespoke BODY
(`bodies={{agent: FrontierAgent}}`) that renders its own art block above the composed shared
`<ChatThread/>` (never forked; `emptyState` is the one inner slot). `GachaAgent` follows it.
But the M7 fade does NOT get "its own scroll context" — **all bodies share the kit's single
scroller (`#app-scroll`)**, and the prototype's per-screen `scrollTop` logic translates as:
listen on `#app-scroll` (passive), compute progress from the oracle's own offset (not absolute
scrollTop — other tabs share the scroller), sticky-pin + fade/blur/scale exactly as M7, and
**re-sync after `ChatThread`'s programmatic bottom-pinning** (the shared thread scrolls to the
bottom when Agent activates — so entering a POPULATED thread starts with the oracle already
ghosted behind the log, which is the design working as intended: the sticky art is a backdrop
the chat scrolls over (`z: oracle 0 / log 2` in the prototype), not a header you must scroll
past. Flagged to the owner as a §8 note, not a defect). Budget ceiling unchanged (frontier's
Agent tab is the named precedent).

**4.3 Brand text.** The kit brand row renders the literal `ctrl·b` wordmark; the prototype says
"CAPSULE ARCADE". `brandMark`/`brandMeta` cover the mark + subtitle but NOT the wordmark text.
Options: (a) keep `ctrl·b` set in the gacha gradient treatment (brand consistency, zero kit
change), (b) a `brandText` extension of the same slot family. Owner call — Q8.6.

**4.4 Palette variants (R9).** The registry models this natively: `ThemeDef.palettes.accents`
(`{id, label, swatch}` list + `defaultAccent`) feeds the SHARED `data-accent` axis (D51 V2: one
axis, every skin) — each gacha "accent" is a tokens.css block re-tinting BOTH the accent trio and
the dark blue-ish base ramp (bg/surfaces), the way vapor's accents re-skin its whole feel. Draft
candidates for the design session (Q8.5): **arcade** (the prototype as-is), **midnight** (deeper
navy, less purple in the radial), **indigo** (bluer surfaces, colder trio), **dusk** (warmer
violet). Each variant must pass the §14.15.1-⑨ contrast probe.

**4.5 Defaults (R6).** `wallpaper: on`, `oracle: fade` ship as the theme's defaults (prototype
ships OFF — deliberate flip, owner-ruled). Both stay owner-togglable rows.

**4.6 Fonts.** Self-host via @fontsource (repo convention, offline PWA). JP faces are
unicode-range-subset — bundle only the used weights (ZKGN 400/700/900 + SMB1 600/800; drop 500
unless the port needs it). Verify exact package names at lock (§9 external facts). Precache
posture: fonts ride the standard Vite hashing; watch install-size (the JP subsets lazy-load by
unicode-range — only subsets actually used by the rendered copy are fetched).

**4.7 Perf/smoothness (§14.11).** Everything animated is transform/opacity except M7's blur ramp
(0→5 px on scroll) — that must be Gecko-checked on device; if it janks, the blur term drops under
`data-engine=gecko` (the Gate-B precedent) while opacity/scale stay. M5/M6 (mix-blend loops) are
already `.expensive-effect`-classed → map 1:1 onto perf-lite. The wallpaper is a static img +
gradient scrim — cheap. The banner carousel timer must pause off-tab/hidden (the prototype already
does; keep under the kit's tab model).

**4.8 Live data the theme reads (all client-side, existing queries — VERIFIED shapes):**
- Hosts + status: `HostStatus {online, ping_ms, last_seen, …}` — cards, state ribbons, the count.
- **Services: real** — `GET /api/services` polled; `useFleet()` already groups them as
  `svcByHost: Map<hostId, Service[]>` with per-service `status.online` — exactly the star-engine
  input (§6). The dossier service list renders the same rows.
- Online count: `hosts.filter(h => h.status?.online).length` — frontier already derives it for
  its brandMeta rig count. The rate pill is the same one-liner.
- **Load / temp / uptime DO NOT EXIST in the backend** — of the prototype's four dossier metrics
  only Ping is real. Q8.9 decides: "—" placeholders (the cosmos uptime precedent) or drop the
  tiles. (Adding real metrics is backend scope, explicitly OUT of this theme phase.)
- Per-host art override seam (roster §5): `host.appearance` is an open per-theme blob
  (`appearance.gacha.…`) the backend passes through untouched — frontier keys its per-host art
  off `appearance.frontier.image` today.

**4.9 Tab set, layout default, and card geometry (Codex F5 on this plan).** The prototype is a
THREE-tab design (Fleet/Agent/Settings). The kit defaults an unknown theme to the standard
4-tab set (`theme-engine/tabs.ts`, `layout.ts` default `4-tab`) — gacha must declare
`defaultLayout: "3-tab"` (a `ThemeDef` field that exists) and its tab labels at G0, or it boots
into the wrong navigation shape. Related open geometry rules the prototype's 4-host fixture
hand-assigns: which live host gets the `feat` (5/4 full-row) card, which `wide` (16/9), what the
"04 / 04" counter counts, and the `NEW` ribbon (no live field exists) — all §8.10. And the
**shared-extension ledger** — every place the port touches SHARED kit scope, named up front (the
D51 discipline):
| Extension | Scope | Posture |
|---|---|---|
| `composerSkin` gains a `gacha` value | the axis catalog is CLOSED and shared (`kit/axes.ts`) — a new skin is a kit change visible to the axis picker on every kit theme | the K1/D37 precedent; small, but it is NOT theme-private — name it in D52 |
| Pre-nav transition hook (only if the §4.1 spike demands it) | `hooks/useSections.ts` chokepoint | one optional fire-and-forget callback, D30 slot idiom |
| `BottomSheet` timing | shared lifecycle is 420 ms with a coupled JS timeout — the prototype's 520 ms spring can't be pure-CSS-overridden without truncating the unmount | either accept 420 ms (fidelity deviation, likely invisible) or a `durationMs` prop (tiny, shared) — eyeball decides |
| Chat bubble selectors | paint lands on `.b.user .body` / `.b.bot .body` (the kit paints bodies, not rows) | selector-precision note for G3, no scope change |
| `ThemeId` union + registry row | closed union in `types.ts` | the normal new-theme change |

## 5. The roster — replaceable art (R2/R3)

The roster has FOUR separable parts (Codex F3 on this plan — the draft conflated them; the
design session walks them in this order):

**5.1 What it feeds (the consumer roles — distinct image SHAPES, per the prototype):** portrait
card art (capsule cards, 3/4-ish crops), landscape art (wallpaper + banner slides, wide crops),
the oracle art (wide), and the transparent CUTOUT (the reel figure — a different asset kind, not
a crop). All VISUAL ONLY — never linked to a specific PC (R3).

**5.2 The entry schema (extend-don't-migrate — one object per entry, extensible):**

```yaml
theme_gacha:                  # exact key/nesting per the config conventions at lock
  roster:                     # ordered list — order IS the default assignment
    - name: lyra              # display/reference name
      image: lyra.png         # the main art (cards)
      cutout: lyra-cutout.png # optional transparent cutout (reel-figure eligible)
      wide: lyra-wide.jpg     # optional landscape variant (banner/wallpaper eligible; when a
                              # wide-consuming slot picks an entry WITHOUT one, the resolver
                              # falls back to `image` with the focal crop — never a hole)
      focus: "50% 30%"        # optional focal point (the prototype hand-tunes object-position
                              # per image — a default center-top applies when absent)
    - ...
  slots:                      # optional pinned bindings (else positional / derived)
    reel_figure: lyra         # must resolve to an entry WITH a cutout
    oracle: ...
    wallpaper: ...
    banner: [lyra, pegasus]   # the slide set (Q8.7 decides its source semantics)
  stars: { ladder: [1,2,3,5,7], mode: five }   # §6's config home lives beside it
```

**5.3 Assignment + fallback semantics (the "in order or something" conversation, Q8.2b):**
positional over the fleet's display order is the default; `slots` pins specials; an OPTIONAL
per-host override via the existing `host.appearance.gacha.entry` blob (the frontier
per-host-image precedent) is available but stays an override — the positional roster remains
primary (R3's "not linked to a specific PC"). Rules the session must fix: more hosts than roster
entries (cycle, or a neutral placeholder card), fewer (unused entries just sit in the gallery),
a `slots` reference to a missing/deleted entry (fall back to positional/default art, never
crash), and a missing file on disk (placeholder + a Conf gallery warning, silently for render).

**5.4 Where the bytes come from — the three honest options (Q8.2a):**

**Serving — the seam verdict (VERIFIED): no user-image path exists today.** The backend serves
only the built frontend (`/assets` → `frontend/dist/assets`, prod-only) + the SPA fallback;
`$CTRLB_HOME` holds text workspaces (memories/skills/agents) with no HTTP route; the only upload
endpoint is transient voice STT. The existing art pattern is **build-time bundled**: frontier
eagerly globs `./art/*.png` into `ThemeDef.assets` and per-host selection is a KEY into that
bundled set via the `host.appearance.frontier.image` blob — not a file path.

The seam verdict stands: NO user-image path exists today (backend serves only the built
frontend; `$CTRLB_HOME` has no media dir or route; the only upload endpoint is transient STT).

- **(a) Bundled roster (zero backend):** ship the prototype's art set (+ any images the owner
  hands over at build time) via the frontier glob pattern; the Conf gallery picks among bundled
  keys. Replaceable *at build time only* — new art means a release. Cheapest; weakest vs R2/R3's
  spirit ("you can configure" a gallery).
- **(b) Read-only owner directory (small backend, no write API):** `$CTRLB_HOME/art/gacha/` +
  a read-only, path-validated StaticFiles mount + an index endpoint (or config listing); the
  owner drops files in over SSH/SMB from any machine; the Conf gallery selects/orders/pins but
  never writes files. Most of (c)'s value at a fraction of its surface.
- **(c) Managed gallery (the full feature — upload/delete API + the mount):** genuinely
  phone-configurable. **The security posture must be honest (Codex F4): the app has NO
  application-layer auth — the tailnet IS the boundary (SECURITY_MODEL), so an upload endpoint
  is reachable by anything on the tailnet.** Requirements if chosen: raster allowlist ONLY
  (png/jpg/webp — NO SVG, it's active content same-origin), magic-byte verification and ideally
  decode-and-reencode, per-file + aggregate size quotas, sanitized/immutably-hashed filenames,
  atomic writes, no symlink following, server-set Content-Type + `X-Content-Type-Options`,
  deletion semantics vs roster references. **A media threat-model paragraph goes INTO D52, not
  just a slice checklist.**
- Recommendation to carry into the session: **(b) for this phase** — it satisfies "replaceable
  without a release", keeps the new attack surface read-only, and (c) can layer on later behind
  the same directory + schema (the seam ROADMAP will want again for avatars/host art). Decide at
  lock.

**5.5 Fallback art:** the theme ships the prototype's asset set as the bundled default roster
either way, so it looks right on first boot (art provenance: the owner's own picks — confirm at
lock that they're fine living in the repo long-term; they're committed already under
`design/prototypes/`).

## 6. Stars + the rate pill (R4/R5/R7)

**6.1 Star count.** Primary driver: the host's SERVICE count. It "doesn't have to match 1:1" —
the mapping is thresholds, not identity. Draft: a threshold ladder (e.g. services ≥ {1,2,3,5,7}
→ ★1..★5; the 3-star mode uses {1,2,4}); alternatively %-of-fleet-max triggered. **Data
semantics (Codex F6): the two candidate drivers have different plumbing.** CONFIGURED count =
`(host.services ?? []).length` — `Host.services` is OPTIONAL in the DTO (`types.ts:39`); it
arrives ON the host object with the hosts query, no join, no extra loading state (the stable
choice). ONLINE count = `useFleet().svcByHost` per-service
`status.online` — livelier ("stars dim as services drop", the more gacha behavior) but the
services query's loading/error state is currently DISCARDED by `useFleet()`, so "no services"
is ambiguous with "still loading"/"query failed"; choosing online-mode obliges the port to
surface that state (render the configured count, or last-known, until the services query
resolves — never a flash of ★1). Which driver + the zero-services rendering = Q8.3.
**Config home for the ladder:** `ThemeDef.settings` can't hold a list (switch/seg only) — the
thresholds live in the `theme_gacha` config section beside the roster (§5.2's `stars:` key);
the Conf rows expose only the MODE seg (5★/3★) and any preset choice.

**6.2 Star colors.** 5-star mode: ★1–3 gold (`#ffd464`), **★4–5 pink-gold** (draft: a
`#ffd464→#ff9e8a`-family rose-gold; exact value picked on device at the eyeball). 3-star mode:
★1–2 gold, **★3 rosy**. Sleeping cards keep the de-saturation. Tokens, not hardcodes.

**6.3 The rate pill.** `★{maxStars} RATE {onlineCount}.0%` — max-star mode (5 or 3) + the live
count of ONLINE hosts (4 on → "4.0%"). 天井 200 stays as flavor copy (R8). Both derive from the
fleet query the body already renders from — no new backend. **Loading/empty semantics:** while
the hosts query is unresolved the pill must not read "0.0%" (a lie) — render "—%" or hold the
pill; 0 hosts online legitimately reads "0.0%" only once resolved. Same rule for the "04 / 04"
counter.

## 7. Slice ladder (draft — the lock session firms this)

| Slice | Contents | Gate |
|---|---|---|
| G0 | **The settle-everything slice (Codex sequencing ruling: no Fleet JSX until these are pinned):** theme registration (`ThemeId` + registry row) + `defaultLayout: "3-tab"` + tab labels · tokens.css (semantic extraction from theme.css) · fonts (**incl. the JP-subset size spike** — measure before committing weights) · settings descriptors + R6 defaults · **the §4.1 tab-transition SPIKE** (passive-start vs pre-nav hook; VT composition verdict; owner's Fennec ≥144 check) · the roster schema + resolver (§5.2/5.3, resolving against the BUNDLED set first regardless of the Q8.2 serving ruling) · the star config home. Palette VARIANTS stay unexposed until G6 (no half-built accent list in the picker) | gate + kit-render e2e joins + the spike verdicts recorded |
| G1 | Bespoke Fleet: banner (carousel + glow + live rate pill w/ §6.3 loading semantics) + capsule track (cards/states/plates/shine + **the stars on cards**, §6.1/6.2) + wallpaper + the card-geometry rules (Q8.10 ruling) | owner eyeball |
| G2 | Dossier sheet (light inversion + Ping + Q8.9-ruled metrics + services list) — **reuses G1's star engine**, adds the sheet-timing call (§4.9 ledger) | eyeball + contrast probe |
| G3 | Agent tab: GachaAgent body (oracle + §4.2 scroll mechanics) + chat-hooks reskin + composer skin — **the M7 blur ramp gets its own Fennec/Chrome device check here**, not deferred to G6 | eyeball + device check |
| G4 | Reel transition overlay + figure (smaller default, tunable) on the G0 spike's mechanism + M2/M3 VT enhancement per the spike verdict | Fennec+Chrome device round (the Gate-B shape) |
| G5 | Roster serving per the Q8.2 ruling ((b)/(c) backend work if chosen) + the Conf gallery + slot pins | gate + the §5.4 security requirements |
| G6 | Palette variants (Q8.5 picks) + polish + full §14.15.1 hardening pass + the on-device Gecko round | owner sign-off |

Each slice: Opus build from a pinned brief → main-seat audit → Codex round → owner eyeball
(the D51 cadence). The theme joins `themeContract.test.ts` + the e2e structural/a11y groups at G0.

**Acceptance matrix (the lock session turns this into per-slice test obligations):** 0/1/many
hosts · hosts>roster and roster>hosts · queries loading/error states (pill, counter, stars) ·
no-services and many-services hosts · missing/corrupt/deleted art (file AND slot reference) ·
all appbar/layout modes · reduced-motion and perf-lite · VT unsupported (older Gecko) · rapid
tab switching (reel re-entrancy) · long host names on plates · Fennec AND Chrome device rounds.

## 8. Owner questions for the design session (the §5-of-vapor-plan analogue)

1. **Reel figure size:** "smaller" — target height? (Prototype 84%; draft default ~55–60%, kept
   tunable.) And should it show on EVERY tab switch, or only some (e.g. not when leaving Agent
   mid-conversation)?
2. **Roster:** (a-part) the serving option — §5.4's (a) bundled / **(b) read-only owner
   directory (recommended this phase)** / (c) managed upload gallery (the honest security cost
   is §5.4's)? (b-part) the assignment semantics — positional-by-fleet-order default + `slots`
   pins + the optional per-host override (§5.3): confirm, and rule the overflow/missing-art
   fallbacks.
3. **Star ladder:** CONFIGURED services (stable, zero extra plumbing) or ONLINE services
   (livelier, needs the query-state work — §6.1)? The exact thresholds (both modes), and the
   zero-services rendering. Or the %-triggered alternative — of what, exactly?
4. **Default star mode:** ship 5-star or 3-star as the default?
5. **Palette variants:** which of §4.4's candidates (arcade/midnight/indigo/dusk — or others) make
   the cut, and does the variant re-tint surfaces only or also the tri-accent?
6. **Brand wordmark:** keep `ctrl·b` in the gacha gradient treatment, or show "CAPSULE ARCADE"
   (needs the small `brandText` extension)? JP nav sub-labels (編成/案内/設定): keep (kit
   extension or CSS trick) or drop?
7. **Banner slides:** slide 1 is the wallpaper art + "NETWORK PRIZE POOL"; slides 2–3 are per-host
   promos with flavor stats. Source the slide set from the roster (which entries?), from the
   online hosts, or keep a fixed 3-slide set with roster art?
8. **Oracle entry state:** entering the Agent tab with a populated thread starts with the oracle
   already ghosted behind the log (the shared thread bottom-pins on activation; the sticky art
   is a backdrop the chat scrolls over — §4.2). Confirm that's the wanted feel, or should the
   oracle get a brief full-opacity beat on tab entry before settling?
9. **Dossier metrics** — of the prototype's four (Ping/Load/Temp/Uptime) **only Ping is real in
   the backend** (VERIFIED). Show the other three as "—" (the cosmos uptime precedent), or drop
   the tiles to a Ping-only row? (Real load/temp/uptime collection is backend scope, out of this
   phase — if wanted, it's a ROADMAP entry.)
10. **Card geometry for a live fleet:** the prototype hand-assigns its 4 fixtures (`feat` 5/4
    full-row · two standard 3/4 · `wide` 16/9 full-row). Rule for N hosts: e.g. first host (or
    first ONLINE host?) = `feat`, remainder 2-col, a trailing odd host = `wide`? What does the
    "04 / 04" counter count (online/total?), and the `NEW` ribbon has no live field — drop it,
    or derive (recently added host)?

## 9. Verification record + remaining obligations for the lock session

**Verified in prep (2026-08-02, Opus seam pass + main-seat re-checks — citations inline in
§3–§6):** theme registration shape + closed `ThemeId` union; `bodies` override; bespoke agent
body precedent; chat hook classes; `svcByHost`; only-ping-is-real; online-count derivation;
tab observability + Root-sibling overlay mount; `ThemeDef.settings` auto-render (switch/seg
only); no user-image serving path; `host.appearance` per-theme blob.

**External facts (checked in prep):**
- @fontsource packages EXIST: `@fontsource/zen-kaku-gothic-new` (300–900),
  `@fontsource/shippori-mincho-b1`. JP-subset on-disk size not yet measured — measure at G0
  before committing to weights.
- View Transitions (same-document): Chrome 111+; **Firefox 144 (Oct 2025) incl. Firefox for
  Android 144+**; the repo already treats VT as optional
  (`theme-engine/switchTheme.ts:176` uses `doc.startViewTransition?.`). Posture stays §4.1
  progressive-enhancement: the owner's actual Fennec build must be ≥144 (device check at the
  G4 gate); `view-transition-types` availability in Gecko unverified — the port must not use it.

**Still open for the lock session:**
- Whether `themeContract.test.ts` / the e2e structural groups enumerate theme ids anywhere a 5th
  registration must join (V6 pinned vapor-specific invariants; a new id likely just joins the
  contract matrix — read the test before G0).
- §8's owner answers → then the council round → then the D52 entry.
- The prototype stays the fidelity reference: every G-slice eyeball compares against
  `capsule-arcade/index.html` opened locally (it is fully standalone).
