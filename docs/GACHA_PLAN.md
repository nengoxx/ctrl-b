# The gacha theme ("Capsule Arcade") — port plan (H1 → Phase 17)

> **Status: ✅ LOCKED 2026-08-02 as [D52](./DECISIONS.md)** (the lock session: the owner's
> seven remaining §8 answers → the council round — a FRESH Opus architecture lens, verdict
> LOCK, + Codex round 4 delta, verdict READY WITH FIXES — → §11 reconciliation, all findings
> + both confirm rounds folded → D52 recorded). Produced by the prep session from the owner's
> FINISHED prototype (`design/prototypes/gacha/uploads/prot/capsule-arcade/` — the owner's
> ruling 2026-08-02: that file set is FINAL; every other tree under `design/prototypes/gacha/`
> is a prior iteration kept for provenance). **On conflict: D52 wins, then this plan.** Next:
> build G0–G6 per §7.
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
points named, and (d) records the owner's §8 rulings (ALL RULED as of the 2026-08-02 lock
session) plus the council reconciliation (§11) — no choices remain open in this document.
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
| M2 | Tab switch under the reel | `document.startViewTransition` root cross-fade/scale (old 240 ms scale .96; new 380 ms **+100 ms delay** from 1.04) — **graceful no-op when unsupported** (`PROTO.vt`). NOTE: VT pseudo-elements paint above ALL content incl. the top layer, and `view-transition-name:none` does NOT exclude an element from the root capture — the reel appears animated during a root VT only because `::view-transition-new(root)` is LIVE (implementation-attested; the §10.1 spike question) | reduced-motion skips VT entirely |
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
| R8 | Captions + Japanese characters: **keep as-is for now** *(amended by the Q8.7 ruling: live banner-promo slides carry TEMPLATED copy — §6.4; and by Q8.6b: all JP must be real Japanese, kanji-first)* | §1 catalogues them | copy freeze; §6.4; Q8.6 for the brand wordmark |
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
| Topbar (brand gradient text, JP subtitle, blur bar) | kit AppBar: the **`brandText` slot (committed — §4.3 katakana ruling)** carries the gradient katakana wordmark, `brandMark` the leading mark, `brandMeta` the JP subtitle; bar surface via tokens + theme-layer polish | tokens + slots |
| Nav (floating pill bar, white indicator w/ pink hard shadow, JP sub-labels) | kit NavBar on theme-layer CSS over kit hooks (`.kit-tabbtn`, indicator) — the sliding-indicator mechanism exists; JP sub-labels RULED KEEP via the committed `subLabel` extension (Q8.6b, §4.9 ledger) | theme CSS on kit hooks |
| Fleet (banner + capsule track + dossier) | **bespoke Fleet body** — the established bespoke-by-right pattern (vapor's Root-pinned VaporFleet, cosmos' planet fleet + its own detail sheet precedent) | bespoke body |
| Banner rate pill (live) | inside the bespoke Fleet, derived from the same fleet query (online count is client-derivable) | bespoke body |
| Stars | a small pure fn in the bespoke Fleet + dossier (shared source) — §6 | bespoke body |
| Oracle header + fade-on-scroll | **a bespoke Agent BODY** (`bodies={{agent: GachaAgent}}`) — frontier's exact pattern (`FrontierAgent.tsx`: theme art rendered ABOVE the composed shared `<ChatThread/>`, plus its `emptyState` slot; §15 rule 5 — chat engines live in `<AppEngines/>`, a body swap can't lose them). The M7 fade observes the kit's SINGLE scroller — mechanics in §4.2 | bespoke body |
| Chat bubbles (white+pink-shadow user, `#222541` bot) | the §15 chat-hooks reskin — the ONE shared chat tree, never forked; hook classes are `.chat-log` + `.b.user`/`.b.bot`/`.b.sys` etc. (THEME_ENGINE §15 table), NOT the prototype's `.msg` names — the port re-targets selectors 1:1. Chat-only colors become theme-private tokens (§15 token rule; never repurpose `--accent-fill`) | theme CSS on chat hooks |
| Composer (rounded floating, GO) | `composerSkin` axis (D37) — reuse an existing shared skin if faithful, else ONE **look-named shared catalog skin (`arcade`)** on semantic tokens, offered to every theme (the D37 rule; §10.5 is authoritative) | axis skin (shared scope) |
| Detail dossier (light inverted sheet) | inside the bespoke Fleet over the shared `<BottomSheet>` — the pattern is established TWICE (`CosmosHostDetail`, `FrontierHostDetail`, both `{host, services, busy, run, titleId}` presentation over `useFleet()`); mind the drag-strip z-index gotcha | bespoke body |
| Reel transition + figure | a Root-sibling overlay component — the cosmos-starfield mount pattern (`CosmosRoot.tsx`: `<><CosmosStarfield/><DefaultRoot/></>`), `position:fixed` + `pointer-events:none` (escapes the kit shell's overflow/isolation). **RESOLVED (§10.1):** passive same-frame start is prototype-faithful (its own no-VT path does exactly that) — class/`key` derived in JSX, no hook; the G0 device spike settles only the M2 VT-liveness question | theme component |
| Capsule→dossier VT morph (M3) | inside the bespoke Fleet — self-contained, gated on support + motion axis | bespoke body |
| Settings rows (wallpaper, oracle, star mode, palette) | `ThemeDef.settings` — entries auto-render as Conf Appearance rows in declaration order (`ConfTab.tsx:838/2403`), persisted via `setThemeSetting` + read via `useThemeSetting` with spec-validated fallback. **Only two field kinds exist: `switch` and `seg`** — enough for wallpaper/oracle/star-mode; the palette variants ride `ThemeDef.palettes.accents` (native registry model) instead | descriptors |
| Motion/perf axes | already the app's global axes — the prototype was explicitly built against them (`data-motion`/`data-perf`, `.expensive-effect` ≙ perf-lite gating) | free |
| Roster (images + assignment) | **new config + serving seam** — §5 | backend + Conf UI |

## 4. Kit extensions + engineering notes

**4.1 The tab-transition seam — a G0 SPIKE, now RESEARCH-RESOLVED except one device question
(full recipe: §10.1).** The deep-research round settled the ordering question on paper: the
prototype's own no-VT path fires the reel and the swap in the same pre-paint task —
**behaviorally identical to a passive same-frame start** — so the pre-navigation hook is
DROPPED and the port uses the passive Root-sibling overlay (class/`key` derived in JSX,
`key={tab}` restart, first-mount latch, reduced-motion = no reel). Posture unchanged: **the
reel (M1) is the PRIMARY effect and must be complete without VT**; M2 is spike-gated
progressive enhancement **dropped without ceremony** if it fights the reel — and the ONE
question paper can't answer is whether `::view-transition-new(root)` renders LIVE on the
owner's Fennec 144+ (§10.1 ranks the three outcomes). M3 (the capsule→dossier morph) is
independent, inside the bespoke Fleet, progressive enhancement over the sheet's own slide-up
(the shared `BottomSheet` 420 ms lifecycle is the timing to compose with — §4.9).

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
past. **✅ RULED Q8.8 (owner, lock session): the ghosted entry is accepted as designed.**)
Budget ceiling unchanged (frontier's Agent tab is the named precedent).

**4.3 Brand text — ✅ RULED (owner, 2026-08-02, this prep session): the brand wordmark in
Japanese KATAKANA.** This commits the small `brandText` extension of the D51 slot family (the
kit brand row renders the literal `ctrl·b` today; `brandMark`/`brandMeta` cover the mark +
subtitle but not the wordmark text — a theme-fillable `brandText?: ReactNode` with the literal
as fallback, byte-identical for every other theme). The exact katakana rendering is an eyeball
copy pick at G0/G1 — draft **コントロール・ビー** (the ctrl·b transliteration) in the gacha
gradient treatment, with カプセルアーケード ("Capsule Arcade") as the alternative reading if
the owner prefers the prototype's brand over the app's; the JP subtitle ネットワーク景品所
stays in `brandMeta` either way.

**4.4 Palette variants (R9) — ✅ RULED Q8.5: two families, five variants.** The registry models
this natively: `ThemeDef.palettes.accents` (`{id, label, swatch}` list + `defaultAccent`) feeds
the SHARED `data-accent` axis (D51 V2: one axis, every skin) — each gacha "accent" is a
tokens.css block. The ruled set:
- **Family 1 — base-ramp variants (trio CONSTANT — it stays the brand):** **arcade** (the
  prototype as-is, default) · **midnight** (deeper, blacker navy; less purple in the radial) ·
  **indigo** (bluer, colder surfaces). These re-tint only bg/surfaces/radial ("the dark
  blue-ish stuff").
- **Family 2 — accent-SHIFTING variants (owner, lock session): TWO variants that move the
  pink→violet→cyan trio too**, informed by a research pass over popular gacha games' real UI
  palettes (Opus pass, 2026-08-02; main seat re-computed and CONFIRMED every quoted contrast
  ratio). **The owner picks the final two from the four candidates below** (default pick if
  none stated: ember + glacier — true warm/cold range). Field finding worth keeping: almost no
  major gacha uses a three-color gradient brand — they run ONE hero hue on near-neutral dark
  (Genshin/WuWa warm gold · Blue Archive/Arknights signal blue · HSR pastel violet · ZZZ
  black/white+neon) — so each candidate is a monotonic hue walk re-derived around a field
  identity, L≈60–72, ≥25° hue clearance from star gold `#ffd464` and warn `#ffc76a`.

  | Candidate | Trio (pink→violet→cyan slots) | Base ramp (bg · card · radial) | Provenance / caution | Worst contrast |
  |---|---|---|---|---|
  | **ember** (warm) | `#ff6f52` `#ff4f93` `#c46bff` | `#120b18` · `#1e1433` · `#5b2350→#2a1330→#100810` | Genshin/WuWa warm-metal-on-dark + HSR Fire/Lightning; gold deliberately NOT in the trio (stars own it). Don't warm slot 1 past H 10° (warn-pill clearance) | 5.65 on card |
  | **glacier** (cold) | `#7c6cff` `#2fb8ff` `#79f2e6` | `#070d1c` · `#101a33` · `#1d3f7a→#0d1730→#05080f` | Blue Archive logo blue `#128AFA` lifted + Arknights crystalline-clinical + HSR Quantum/Ice. Tightest hue walk (63°) — verify the tri-strip still reads as three colors at small size on device | 4.47 on card |
  | nebula (soft) | `#eb77ea` `#9c96f4` `#5ec7db` | `#0c0a1c` · `#171634` · `#43276b→#141334→#08070f` | HSR's own in-UI element chips verbatim (Lightning/Quantum/Ice) — pastel-celestial. Weakest SHIFT: same hue arc as arcade, mainly desaturated — a calm-eyes option, not range | 6.73 on card |
  | eridu (loud) | `#ff5cd0` `#3ff0ff` `#b4ff4a` | `#0a0a12` · `#12141f` · `#26305e→#0f1120→#06070c` | ZZZ black/white+neon signage + NIKKE HUD contrast. **Semantic blocker: the acid lime competes with ok-green `#74f3ad` for "host is up"** — only shippable if the trio never touches status chrome | 6.72 on card |

**Family 3 — the DOSSIER SURFACE (owner session 2026-08-04, Opus). SCOPE: dossier-only.** Distinct
from families 1 and 2 above, which re-tint the WHOLE theme — the owner ruled this exercise
**dossier-only**, so these move `--gc-dossier-*` and nothing else. Global `--accent-fill` /
`--gc-brand-fill` were explicitly off the table.

**The dossier goes DARK** (owner, "for now to try how it looks"). That reverses G2's one-light-surface
idea ("an arcade prize slip pulled out from under the night-time cabinet") — a real identity change,
recorded as a TRIAL, not a lock. Measured consequence worth keeping: **dark makes contrast EASIER.**
Every tight margin in this theme lives on the light sheet — the 2.62:1 Shut-down bug fixed the same
day, `--gc-unit-no`, and the retired `--gc-dossier-danger` all exist because literals had to be
deepened for it.

The four the owner shortlisted, sampled from `design/prototypes/gacha/dossier palette example.png`
(4x2 panel grid at `(14 + 384c, 40 + 506r)`, 347x440) and NORMALISED so every gated pair passes:

  | palette | sheet from→to | card | action fill (90deg) | on-fill ink | accent ink | kicker |
  |---|---|---|---|---|---|---|
  | **neon-purple** | `#140e35`→`#070b25` | `#130f32` | `#511cab`→`#4f1ea7` | `#ffffff` | `#f46adf` | `#f46adf` |
  | **sunset-orange** | `#843e3c`→`#2f1f34` | `#502f3e` | `#d97943`→`#ce6144` | `#0a0b19` | `#f28c53` | `#f7ba98` |
  | **rose-pink** | `#34202b`→`#15141e` | `#221b23` | `#da7b7a`→`#c55e74` | `#0a0b19` | `#f3bfc0` | `#f3bfc0` |
  | **aurora-violet** | `#171643`→`#08112d` | `#10143a` | `#7e37a5`→`#562a90` | `#ffffff` | `#d5a5f1` | `#d5a5f1` |

  Shared across all four: `--gc-dossier-ink #f4f2ff` · `-ink-2 #b9b4d8` · `-line #ffffff20` ·
  `-ok #74f3ad` (the NIGHT token, back in its element at 12–13:1) · `-warn #ffc76a` ·
  `-badge #0c0a24e6` · `-art-shadow 0 10px 22px #00000066`.

  **Normalisations applied — do not "restore" these to the mock's literals, they fail:**
  sunset-orange's kicker lightened 40% toward white (3.16 → 4.55) · cyber-teal's fill deepened 8%
  and amber-gold's 24% so a white label clears · rose-pink's fill LIGHTENED 8% because it carries a
  DARK label. **sunset-orange and rose-pink are the two whose fills are light enough to need dark
  labels** — that is a property of the palettes, not a bug.

  **Gate method (the plan's own rule, learned the hard way):** the label is CENTRED, so gate the
  band the text actually covers, not the gradient's extremes — testing the extremes failed four
  palettes spuriously. Ratios were computed BEFORE rendering; all four pass ink/card, ink-2/card,
  kicker/sheet, Shut-down/card, label/band and the dot floors.

**The ACTION BUTTON, measured from the example (same session).** The owner asked for "as close as
possible" to the mock. Four of my own measurements were wrong before this settled — recorded so the
next reader does not repeat them:

- The bright 1px top highlight exists **only on the neon-purple panel**; the other seven have none.
  It is NOT the design language. Same for the 20% vertical fill gradient (neon-purple again).
- The fill gradient is **HORIZONTAL, not vertical** — median −39% left→right against −4.6%
  top→bottom. A vertical sample reads it as flat.
- Box is **176 x 39 CSS px** (an earlier "195" sampled across the gap into the second button), and
  `.gc-act` inherits the kit's unitless `line-height: 1.5`, so a 10px label is a 15px line box —
  12px padding gives 41px, not 39. Use 11px.
- Radius **4.6px**; it only *looks* rounder in a side-by-side if the mock is upscaled.
- The rim is **1.10x the fill's luminance** — a whisper. A `color-mix(fill 78%, white)` is ~2x and
  visibly wrong; 90/10 lands right.

  So the example's primary is: flat-ish horizontal gradient · ~5px radius · a 1px rim a hair lighter
  than the fill · **no elevation at all** · white or dark label per the table above. The secondary is
  transparent with a muted accent border. The press has no offset to sink into, so both buttons drop
  the sticker translate for an opacity change — and note the generic `.gc-act:active` in gacha.css
  still slides the SECONDARY 3px unless it is replaced, not merely overridden on `.primary`.

  **This REPLACES the theme's sticker language on the dossier only** (the nav indicator, user bubble
  and arcade composer keep it). `--gc-act-shadow` becomes unused — see §5's single migration.

**Two rules the dark flip BREAKS that no token edit covers** (both found by rendering, not by
reading):
1. `--gc-unit-no` — the deepened rose minted for the LIGHT sheet measures **2.94** on a dark one, and
   it is not a `--gc-dossier-*` token, so a dossier-family sweep misses it. Each palette carries its
   own kicker in the table above.
2. `.gc-dossier-close` composes `background: var(--gc-dossier-ink)` with `color: var(--gc-dossier-from)`
   — correct when ink is dark and sheet light; flipping the tokens turns the disc into a white blob.
   It needs its own pair (the mock's is a dark disc with a light glyph).

**Still unfinished on these four:** the sheet's top brand strip and the star badge still carry
light-sheet values, and the state sheet (active / focus-visible / **disabled**, a flat
`opacity: 0.42` that moves every ratio at once) has not been rendered on a dark surface.

**The lab that produced all of this** lives in the session scratchpad (`palette-lab/`:
`candidates.mjs` + `render.mjs` + `palettes.json`), NOT in the repo — it drives the real running dev
app via Playwright, injects candidates inside the same `@layer theme { @scope … }` as production
(unlayered injection outranks the theme and would flatter a losing rule), mocks `/api/appearance` and
aborts every non-GET `/api/**` with a counter that read **0** on every run. Re-runnable, but it is a
tool for one decision — do not promote it into the repo without a reason.

  All four clear the 3.0 probe bar everywhere, and every candidate's WORST trio-on-card ratio
  beats the shipped arcade trio's own weakest link (`#805cff` on card = 4.10, re-computed).
  Gold stars + ok/warn status hexes stay constant across all variants.
Every variant (all five shipping) must pass the §14.15.1-⑨ contrast probe; the G6 device round
covers the full matrix.

**4.5 Defaults (R6).** `wallpaper: on`, `oracle: fade` ship as the theme's defaults (prototype
ships OFF — deliberate flip, owner-ruled). Both stay owner-togglable rows.

**4.6 Fonts — SUPERSEDED by the measured §10.4 strategy.** The naive @fontsource JP path was
rejected on measurement (~757 KB/72 requests first load; +31 MB dist); the port ships a FROZEN
build-time subset of the theme's 62 JP glyphs (committed, icons-script pattern, ~140 KB total
with the fontsource-latin imports) + the lazy `loadFonts()` pattern so activation paints
without FOUT. Full recipe, guard test, and PWA caching posture: §10.4.

**4.7 Perf/smoothness (§14.11).** Everything animated is transform/opacity except M7's blur ramp
(0→5 px on scroll) — that must be Gecko-checked on device; if it janks, the blur term drops under
`data-engine=gecko` (the Gate-B precedent) while opacity/scale stay. M5/M6 (mix-blend loops) are
already `.expensive-effect`-classed → map 1:1 onto perf-lite. The wallpaper is a static img +
gradient scrim — cheap. The banner carousel timer must pause off-tab/hidden (the prototype already
does; keep under the kit's tab model).

**4.8 Live data the theme reads (all client-side, existing queries — VERIFIED shapes):**
- Hosts + status: `HostStatus {online, ping_ms, last_seen, …}` — cards, state ribbons, the count.
- **Services: real** — configured services arrive ON the host object (`(host.services ?? [])`
  — the RULED star input, §6.1); the separate `GET /api/services` poll + `useFleet()`'s
  `svcByHost` grouping feed the dossier's LIVE service-status rows only.
- Online count: `hosts.filter(h => h.status?.online).length` — frontier already derives it for
  its brandMeta rig count. The rate pill is the same one-liner.
- **Load / temp / uptime DO NOT EXIST in the backend** — of the prototype's four dossier metrics
  only Ping is real. **✅ RULED Q8.9: the frontier grid** — with the exact value semantics
  pinned (Codex R4-10 — frontier's Services tile is live `up/total`, which is NOT the gacha
  ruling): **Ping 応答** = `ping_ms` when online else "—" · **Uptime 稼働** = "—" (deferred-seam
  placeholder) · **Services サービス** = `(host.services ?? []).length` — the CONFIGURED count,
  the star input, visible `0` included · **Seen 最終確認** = "now" when online else
  `relativeTime(last_seen)`. Load/Temp dropped. (Adding real metrics is backend scope,
  explicitly OUT of this theme phase.) **The dossier also carries the host ACTION BAR**
  (council H3): wake/power actions over the shared typed-action `run` — both precedent dossiers
  have one, and §6.4's promo-click→wake flow depends on it; the prototype has no action-bar
  design, so it's a named fidelity design checkpoint at G2 (gacha visual language, kit
  semantics). The pure host-detail derivation (online/ping/upCount/seen/meta strings) is
  EXTRACTED to `lib/` at G2 — gacha would be its third byte-similar copy (rule of three,
  council M6); markup stays per-theme.
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
| `brandText` slot (**committed** — the §4.3 katakana ruling needs it) | kit AppBar, the D51 `brandMark` idiom: `brandText ?? "ctrl·b"` | one prop + fallback; other themes byte-identical |
| `subLabel` on the tab definition (**committed** — the Q8.6b keep ruling needs it) | `TAB_SETS`/tab-def shape + kit NavBar render | optional additive field; themes without it byte-identical; the CSS-attr alternative rejected (labels are data) |
| `composerSkin` — **RULED (council H2/R4-2, per LOCKED D37): reuse an existing shared skin if faithful, else the catalog gains ONE look-named value `arcade`** (never `gacha`), authored on semantic tokens only | the axis catalog is CLOSED and shared (`kit/axes.ts`); a catalog value appears AND applies in every theme's picker — so G3 budgets the cross-theme cost: visual check in vapor/cosmos/frontier pickers + the `axes.test` arm | shared scope; the theme-scoped alternative is DELETED (it was a D37 bypass); any exception would need an explicit D52 amendment — not proposed |
| ~~Pre-nav transition hook~~ | ~~`hooks/useSections.ts` chokepoint~~ | **DROPPED by the §10.1 research verdict** — passive start is prototype-faithful |
| Shared VT helper `lib/viewTransition.ts` (**committed**) | extracts `switchTheme.ts:163-183`'s existing block; both callers use it | reuse-not-duplicate; §10.1 |
| `BottomSheet` timing | shared lifecycle is 420 ms with a coupled JS timeout — the prototype's 520 ms spring can't be pure-CSS-overridden without truncating the unmount | **RULED (lock): accept 420 ms** (fidelity deviation, likely invisible); the `durationMs` prop is added ONLY if the G2 eyeball rejects it — the last shared-kit change is thereby pinned |
| Chat bubble selectors | paint lands on `.b.user .body` / `.b.bot .body` (the kit paints bodies, not rows) | selector-precision note for G3, no scope change |
| `ThemeId` union + registry row | closed union in `types.ts` | the normal new-theme change |

## 5. The roster — replaceable art (R2/R3)

The roster has FOUR separable parts (Codex F3 on this plan — the draft conflated them; the
design session walks them in this order):

**5.1 What it feeds (the consumer roles — distinct image SHAPES, per the prototype):** portrait
card art (capsule cards, 3/4-ish crops), landscape art (wallpaper + banner slides, wide crops),
the oracle art (wide), and the transparent CUTOUT (the reel figure — a different asset kind, not
a crop). All VISUAL ONLY — never linked to a specific PC (R3).

**5.2 The entry schema (extend-don't-migrate — one object per entry, extensible).**
**Config home RULED at lock (council H1): `themes: {gacha: {…}}`** — one FEATURE-named
top-level map keyed by theme id (the D48 `providers` precedent). A `theme_gacha:` top-level
key would be the banned sibling-map shape: the next theme with art would mint a new top-level
section + its own model/reader/writer, and renaming later costs a real config migration.
**The read path, pinned:** the theme body does NOT read raw settings — the §10.4 media INDEX
endpoint returns the roster DATA (`{entries: [{name, urls, valid…}], slots}`) so the theme
has ONE query; **host→entry ASSIGNMENT (positional/cycling) stays in the §5.3 CLIENT
resolver** — it depends on the client's display order (`useHosts` sorts `self` first), so it
cannot live server-side without duplicating that ordering (Opus confirm). Conf gallery writes
go through the normal `PUT /api/settings` path. (Until G5 lands, G1–G4 resolve against the
bundled default set client-side — same resolver, no config.)

```yaml
themes:
  gacha:
    roster:                   # ordered list — order IS the default assignment
      - name: lyra            # display/reference name
        image: lyra.png       # the main art (cards)
        cutout: lyra-cutout.png # optional transparent cutout (reel-figure eligible)
        wide: lyra-wide.jpg   # optional landscape variant (banner/wallpaper eligible; when a
                              # wide-consuming slot picks an entry WITHOUT one, the resolver
                              # falls back to `image` with the focal crop — never a hole)
        focus: "50% 30%"      # optional focal point (the prototype hand-tunes object-position
                              # per image — a default center-top applies when absent)
      - ...
    slots:                    # optional pinned bindings (else positional / derived)
      reel_figure: lyra       # must resolve to an entry WITH a cutout
      oracle: ...
      wallpaper: ...
      hero: lyra              # the fixed hero slide's art (defaults to the wallpaper pick when
                              # absent; RULED Q8.7 — the OTHER slides are live per-host promos
                              # derived from each host's §5.3 assignment, so no slide-set slot)
```

*(NO `stars:` key — the star MODE's single home is the `starMode` ThemeDef setting, §6.1;
council M5/R4-8 killed the double home. If custom thresholds are ever wanted they extend the
settings spec, not this map.)*

**5.3 Assignment + fallback semantics (the "in order or something" conversation, Q8.2b):**
positional over the fleet's display order is the default; `slots` pins specials. A per-host
override via `host.appearance.gacha.entry` is **NOT the free seam the draft claimed** — the
appearance blob's WRITE path doesn't exist (`HostIn` has no `appearance` field; the machine
editor round-trips an existing key only by omission; frontier's own picker was never built —
`RIG_KEYS` has zero consumers). Per-host override is therefore OPTIONAL FUTURE scope (HostIn
field + editor UI), not part of this phase — which suits R3's "not linked to a specific PC"
anyway: **this phase ships positional + `slots` pins only.** Fallback rules — **RULED at lock
(Codex R4-3: one deterministic behavior, one shared resolver consumed by cards, promos AND the
dossier):** more hosts than roster entries → **ordered CYCLING** (host i gets entry i mod N);
the neutral placeholder card is reserved for an EMPTY roster or an unusable file; fewer hosts
than entries → unused entries just sit in the gallery; a `slots` reference to a
missing/deleted entry → fall back to positional/default art, never crash; a missing file on
disk → placeholder + a Conf gallery warning (render stays silent).

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
- **✅ RULED (owner, 2026-08-02, this prep session): option (b).** The read-only owner
  directory + the phone-facing Conf gallery for ORDERING and PINNING (the gallery
  selects/orders/pins; it never writes files — the owner drops files in from another machine).
  Option (c) stays a possible later layer behind the same directory + schema. **Council
  amendment (M9, mechanics not shape):** the mount is namespace-generic — the directory is
  **`$CTRLB_HOME/media/gacha/`** under a single `/api/media/{ns}/` route, so the next
  art-bearing theme is a path segment, not a new route. (Same ruled shape; the literal path
  changed from the draft's `art/gacha/` — flagged to the owner.)
- **✅ RE-SHAPED at the G1 eyeball (owner, 2026-08-02 evening): ROLE-SCOPED subfolders,
  drop-in = assignment.** The flat namespace dir gains role subdirectories —
  `$CTRLB_HOME/media/gacha/{characters,banner,wallpaper,reel}/` (oracle's home = a G5-brief
  detail; its own folder for symmetry is the default) — and a file dropped into a role folder
  is ASSIGNED to that role with no pinning ceremony: `characters/` feeds the per-host deal,
  `banner/` feeds the carousel's extra SCENE slides (each dropped image = one slide, the
  owner's ruled pick over a cycling hero — §6.4 amendment below), `wallpaper/` the fleet
  background (first/pinned wins; rotation = possible later), `reel/` the transition cutouts.
  The owner's words: independent pools, "so it's more organized". This SUPERSEDES the
  per-entry `wide`/`cutout` optional fields as the primary source of role art — the §5.2
  entry schema keeps them for BUNDLED defaults, and `slots` pins survive as optional
  overrides binding a character INTO a role (e.g. wallpaper: lyra). The G5 brief must spec
  the index endpoint per-role (`{characters: […], banner: […], …}`) and the §10.4 hardening
  applies per subfolder unchanged. Until G5, the bundled interim carries the same shapes in
  code (`ART.scenes`, the roster) so G5 stays a source swap, not a redesign.
- **✅ RULED (owner, 2026-08-04, closing the default-order gap): ALPHABETICAL FILENAME sort is
  the default order** for files in a role folder before the Conf gallery is ever touched;
  gallery reorder/pins override it (persisted in config) once made. Rationale: predictable,
  stable across restarts, and a zero-UI escape hatch — `01-foo.png`, `02-bar.png` works with no
  gallery visit, but nothing forces the convention. (The G5 brief pins the sort as
  case-insensitive natural/lexicographic — one deterministic collation, stated in the index
  endpoint's contract so client and server can never disagree.)

**5.5 Fallback art:** the theme ships the prototype's asset set as the bundled default roster
either way, so it looks right on first boot (art provenance: the owner's own picks — confirm at
lock that they're fine living in the repo long-term; they're committed already under
`design/prototypes/`).

## 6. Stars + the rate pill (R4/R5/R7)

**6.1 Star count — ✅ RULED (owner, 2026-08-02, this prep session): CONFIGURED services,
regardless of live status.** The input is `(host.services ?? []).length` (`Host.services` is
OPTIONAL in the DTO, `types.ts:39`; it arrives ON the host object with the hosts query — no
join, no extra loading state). The ruling KILLS the online-mode plumbing entirely: no
services-query-state exposure, no star flicker concern, stars change only when the owner edits
a machine's services. The RULED ladders:

| Configured services | 5★ mode | 3★ mode |
|---|---|---|
| 1 | ★1 | ★1 |
| 2 | ★2 | ★2 |
| 3 | ★3 | ★3 |
| 4 | ★4 | ★3 |
| ≥5 | ★5 | ★3 |

*(Verbatim owner ladder at LOCK: 5★ = "1→1, 2→2, 3→3, 4→4, 5-or-more→5"; 3★ = "1 service→1,
two or three→2, more than three→3". **3★ RE-RULED at the G1 eyeball, owner 2026-08-02: ≥3 → ★3**
— the lock table's 2–3 compression made the owner's whole real fleet (2/2/3/3 configured
services) read a flat ★2; the table above shows the live rule. 5★ re-confirmed unchanged at the
same eyeball. NOTE the lock premise "emma carries 5–6 configured services" was optimistic —
the real counts are 3 on the dev config / 4 on prod.)* **Zero services — RULED at lock: the ★1 floor**
(a unit never renders starless; gacha logic); the G1 eyeball reviews it like any visual.
**Config home — ONE home (council M5/R4-8):** the ladders above are DESIGN CONSTANTS; the mode
lives in a single authoritative `ThemeDef.settings` seg key **`starMode`** (default `five` —
**ship default 5★, ruled Q8.4**: emma already carries 5–6 configured services, so the flagship
rolls a full row day one; 3★ one tap away). Cards, dossier stars and the rate pill all consume
the SAME resolved value (`useThemeSetting`); nothing star-shaped lives in the roster YAML.
Tests: default 5★ · 3★ toggle/persistence · invalid-value fallback · pill coupling.

**6.2 Star colors.** 5-star mode: ★1–3 gold (`#ffd464`), **★4–5 pink-gold** (draft: a
`#ffd464→#ff9e8a`-family rose-gold; exact value picked on device at the eyeball). 3-star mode:
★1–2 gold, **★3 rosy**. Sleeping cards keep the de-saturation. Tokens, not hardcodes.

**6.3 The rate pill.** `★{maxStars} RATE {onlineCount}.0%` — max-star mode (5★ default, ruled)
+ the live count of ONLINE hosts (4 on → "4.0%"). 天井 200 stays as flavor copy (R8). Both
derive from the fleet query the body already renders from — no new backend. **Loading/empty
semantics:** while the hosts query is unresolved the pill must not read "0.0%" (a lie) — render
"—%" or hold the pill; 0 hosts online legitimately reads "0.0%" only once resolved. Same rule
for the "04 / 04" counter.

**6.4 Banner slides — the Q8.7 ruling (fixed hero + live promos + swipe), the design:**

- **Slide set.** Slide 1 = the FIXED "NETWORK PRIZE POOL" hero — frozen prototype copy, roster
  wallpaper/banner art, zero data dependency. Slides 2..N = **one live promo per host — ALL
  hosts, online AND sleeping** (the owner's "for each pc"; a sleeping promo renders dimmed in
  the sleep-card treatment, which keeps the click useful: open the dossier → wake). **Membership
  is the RULING, not implementer latitude** (Codex R4-1): crowding is solved by presentation
  (dots/controls, the a11y bullet below), never by silently narrowing membership; only the
  OWNER may narrow it at an eyeball. Promo art = the host's roster-resolved entry — the ONE
  shared resolver of §5.3 (cards, promos and dossier must agree).
- **✅ AMENDED at the G1 eyeball (owner, 2026-08-02 evening): + SCENE slides.** The set is now
  **hero → N scenes → per-host promos**: each image in the banner role pool (§5.4's `banner/`
  folder at G5; the bundled `ART.scenes` — the owner's b2/b3 drops — until then) is its own
  slide, ruled over the cycling-hero alternative. Scene slides are INERT non-buttons (nothing
  to open) but CARRY the hero-style copy block with TEMPLATED defaults, owner-ruled ("good
  default text… not just for the first one"): tag 限定イベント + caption 開催中 (both frozen
  glyphs, `sceneTag`/`sceneCaption`) + a title from the **`SCENE_TITLES` ASCII pool** (copy.ts,
  researched against the real gacha banner register — Genshin "Epitome Invocation", HSR
  "Light Cone Event Warp", Arknights "Headhunting"): CAPSULE FESTIVAL · MIDNIGHT UPLINK ·
  STARLIGHT RELAY · LUCKY CIRCUIT · NEON HEADHUNT · PACKET CARNIVAL · AURORA PROTOCOL ·
  GOLDEN UPTIME, scene i → pool[i mod 8]. Keys `"scene:<name>"` — disjoint from host ids;
  all carousel machinery (reconcile/inert/dots/gestures) is key-generic and unchanged. The
  "hero-only: no dots, no autoplay" contract case now genuinely means no scenes AND no
  hosts; scenes present ⇒ the carousel runs even on an empty fleet. Scenes take the base
  52% 30% scene crop, never `.promo`'s face crop.
- **Copy — the R8 amendment (owner-ruled via Q8.7):** the fixed hero keeps its frozen captions;
  promo slides are inherently TEMPLATED — tag pill = live state (ONLINE/SLEEPING treatments),
  display copy = the host name, JP caption from a small template set (draft: 稼働中 "in
  operation" / 休眠中 "dormant"; exact strings = an owner copy pick at the G1 eyeball, same
  bar as the katakana wordmark pick).
- **Click.** Promo slides are real `button`s (`aria-label`: "open <host> dossier") —
  **proposed target: the host's UNIT DOSSIER sheet**, the same action as tapping its capsule
  card (one handler, no new nav concept; wake/manage lives in the dossier). Owner-confirm at
  the G1 eyeball. The fixed hero is inert (or cycles to the track — eyeball whim).
- **Swipe + click coexist (feasibility CONFIRMED) — specified as a STATE MACHINE, not a
  heuristic (Codex R4-5):** `idle → pending → horizontal-drag`. Primary pointer only; on
  pointer-down enter `pending`; after the ~10 px slop, DIRECTION-LOCK via `abs(dx) > abs(dy)`
  — horizontal intent captures the pointer and enters `horizontal-drag` (the strip follows the
  finger, transform-only, rAF; release snaps to the nearest slide with the existing 620 ms
  ease; edge drags clamp with resistance); vertical intent aborts cleanly (no capture —
  `touch-action: pan-y` keeps page scroll native). Under-slop release = tap → the slide's
  click action. Suppression of the post-drag native click happens in `onClickCapture` (a
  `moved` flag must survive through the click event); native image dragging disabled.
  `pointercancel`, lost capture, secondary pointers and unmount all resolve to `idle` with the
  strip snapped and the timer state restored. Dots stay as labeled buttons (the non-gesture
  and keyboard path).
- **Slide identity + reconciliation (Codex R4-4):** the active slide is keyed **`"hero"` |
  `host.id` — never an index**. Membership changes (poll adds/removes a host, initial promo
  resolution) are BUFFERED while a gesture or snap animation is in flight and reconciled by
  key between interactions; if the active host vanished, land on the nearest surviving
  neighbor (or the hero) WITHOUT animation. Dots derive from the reconciled set.
- **Timer semantics (extends §10.3) — the explicit matrix (Codex R4-6):** one-shot timeout,
  not an interval. An actual manual slide CHANGE → restart at the full 5.2 s; a gesture that
  ends with NO change (tap, cancel, under-slop, snap-back) → restart at the full cadence too
  (one consistent rule, no stored remainders). Eligibility pauses kept: tab≠fleet,
  `document.hidden`, and **during the reel the banner REJECTS new input** (the overlay is
  `pointer-events:none`, so the banner disables itself on the reel signal: any active gesture
  cancels + snaps, autoplay holds until the reel ends).
- **A11y + many-host bounds (Codex R4-7):** carousel semantics on the strip; **inactive
  slides are `inert`** (no tab stop, `aria-hidden`) — keyboard focus can never open an unseen
  dossier; the active slide alone is interactive. Dot buttons carry host names +
  `aria-current`. Hero-only state (zero hosts) renders no dots and no autoplay. Dots stay
  fixed-size up to 8 slides; beyond that, a `3 / 12` counter replaces the rail **flanked by
  labeled Previous/Next buttons (the keyboard path the dots provided must survive the swap —
  Codex confirm MED); both WRAP at the ends, matching the auto-advance cycle**, and the
  counter is announced — a bound the owner's ~5-host fleet won't hit, ruled so the design
  has one.
- **Loading/error states:** hosts unresolved → the fixed hero alone (it needs no data); promos
  join by key on resolve (reconciled between interactions — no jitter mid-drag); zero hosts →
  hero only. **A background refetch error keeps the last successful host set** (TanStack keeps
  cached data; treating any `error` as hero-only would collapse the carousel needlessly —
  Codex R4-4); hero-only applies only when NO successful data has ever arrived.

## 7. Slice ladder (firmed at the lock session — council-amended)

> **✅ G0 COMPLETE + OWNER-SIGNED 2026-08-02 (evening) — as-built record (§7.1 below the
> ladder). G1 is next.** The G3 row is amended: the chat-bubble reskin was PULLED FORWARD
> into G0 on the owner's request (values + type metrics shipped; only bubble POLISH remains
> at G3 beside the oracle/composer work).

| Slice | Contents | Gate |
|---|---|---|
| G0 | **The settle-everything slice (Codex sequencing ruling: no Fleet JSX until these are pinned; recipes = §10).** **First, the KIT SEAMS UNIT as ONE reviewable, revertible commit (council M4):** `brandText` + `subLabel` + the `runViewTransition` extraction (behavior-identical extraction + test FIRST, the `.finished`/token-guard hardening as a labelled delta on top — it touches the daily theme-switch path). Then gacha-private: theme registration (`ThemeId` + registry row) + `defaultLayout: "3-tab"` + `TAB_SETS` row (JP sub-labels) · tokens.css (semantic extraction from theme.css; **the stylelint `src/themes/gacha/` override enforces `^gacha-` keyframes AND no literal colors outside tokens.css** — council M7, what keeps five palette variants a repaint-free G6) · fonts per §10.4 (**generate + measure the frozen subset**, guard test, lazy `loadFonts`) · settings descriptors (`starMode` default `five` + R6 defaults) · **the §10.1 device SPIKE** (VT-new liveness on the owner's Fennec → the M2 verdict; **G0 owns the reel MECHANISM: overlay mount, slats, passive start, spike verdict — the figure is G4's**, council M10) · the roster schema + resolver (§5.2/5.3 incl. cycling, resolving against the BUNDLED set) · the star ladders (§6.1, ruled) · riders: `stats.html` precache exclusion (§10.4; the `runtimeCaching` routes MOVED to G5 — council M8) · the ConfTab raw-value LOW (§10.5) · the kit-fade re-tune under gacha (§10.1). Palette VARIANTS stay unexposed until G6 | gate + kit-render e2e joins + the spike verdicts recorded |
| ✅ G1 | **BUILT + OWNER-EYEBALLED 2026-08-02 (as-built §7.2)** — bespoke Fleet: banner (carousel + glow + live rate pill w/ §6.3 loading semantics + the §6.4 slide set **incl. the eyeball-ruled SCENE slides**) + capsule track (cards/states/plates/shine + stars) + wallpaper + the geometry rule + the owner's own art in the bundled set | owner eyeball ✅ (3+ live rounds) |
| ✅ G2 | **BUILT + OWNER-EYEBALLED 2026-08-02 night (as-built §7.3)** — dossier sheet (light inversion + the ruled grid + live service rows + the H3 ACTION BAR) + **the M3 capsule→dossier morph, owner-PULLED from G4 and made to visibly work** + swap morph + visible × + tap-outside close + **the full-screen ART SHOWCASE (owner ask)** — M6 extraction to `lib/hostDetail.ts` landed first; contrast gate gained the dossier's THEME_PAIRS rows | owner eyeball ✅ ("looks good", pushed) + contrast probe ✅ (48-combo matrix) |
| ✅ G3 | **CLOSED 2026-08-04 (as-built §7.4; commits `6c5298d..5ce33d7` + the side-session re-rule `ba0b8b1`/`d65e7b7`) — device round PASSED wholesale, Gecko scanline branch NOT needed.** GachaAgent body (oracle two-FACE crossfade — art+scrim+name ghost as ONE surface, owner-ruled; pin `top: var(--appbar-h)`, owner-ruled) + the shared catalog's `arcade` composer skin (measured: no existing skin faithful) + bubble polish + the owner's four live findings + the Codex wave (plan-pin regression, the UN-RUNGED-header stacking fix, M7 stale-base remeasure, safeRafLoop fault latch). Device checks owed: M7 blur on Fennec · 12.5px read comfort · pin across appbar modes · the flat composer · M6 scanline on Gecko | eyeball + device check (PENDING) |
| ✅ G4 | **CLOSED 2026-08-04 (as-built §7.5; commits `dd1a056..fa86ed3`) — owner round PASSED on phone + desktop, 67% default kept, M2 device-confirmed.** The reel FIGURE (67% tunable default, all dials `--gc-figure-*` tokens, corrected baked glow — drop-shadow's length IS σ, §7.5 lesson) + M2 shipped prototype-exact with the seam promoted (flag deleted) + the type-scoped VT skip + degradation latches. Codex: READY WITH FIXES → wave → confirm all-resolved, residual LOWs closed | owner figure eyeball + Fennec+Chrome device round (incl. the one-line M2 check) |
| G5 | Roster serving per the RULED option (b), **namespace-generic (council M9): ONE `/api/media/{ns}/` mount over `$CTRLB_HOME/media/<ns>/` — gacha is the first namespace, frontier's never-built art picker inherits it** — ensured dir + the hardened read-only mount (§10.4 serving details incl. the route split + backend tests) + the Conf gallery (order/pin) + **the repo's first SW `runtimeCaching` routes land HERE with their own gate** (woff2 `CacheFirst` + `/api/media/` `StaleWhileRevalidate` — council M8 moved them out of G0's riders) | gate + the §5.4/§10.4 security requirements |
| G6 | Palette variants (the ruled §4.4 set: arcade/midnight/indigo + the two accent-shifting picks) **+ §4.4 FAMILY 3 — the four owner-shortlisted DOSSIER palettes (neon-purple · sunset-orange · rose-pink · aurora-violet) and the measured example ACTION BUTTON, both from the 2026-08-04 session; the dossier goes DARK as a trial.** Ship each as one `body[data-accent]` block + a `palettes.accents` row + a `contrast-matrix.ts` row; the button rules REPLACE `.gc-act*` rather than layering over them, and `--gc-act-shadow` migrates per §5 | owner sign-off |

Each slice: Opus build from a pinned brief → main-seat audit → Codex round → owner eyeball
(the D51 cadence). The theme joins `themeContract.test.ts` + the e2e structural/a11y groups at G0.

**§7.1 — G0 AS-BUILT (✅ owner-signed 2026-08-02).** Fifteen build commits
`835850a..0bb0b51` (+ the D52 addendum `c26d1eb`); full gate green on every one; end state
1254 BE / ~1022+ FE unit / 177 e2e (14+ gacha arms). **Four owner eyeball rounds** drove four
fidelity waves — the record for successors:
- **Round 1** (chrome missing): appbar glass dissolve (NO shadow — theme.css:8) · switch
  two-stop `#ff6cae→#725bff` · floating nav pill + white indicator w/ `5px 5px 0 #ff6cb1`.
- **Round 2** (geometry + gradients): content scrolls UNDER the bar (`.kit{position:relative}`
  **without z-index** — deliberately NOT a stacking context, the reel/modal rungs stay
  document-level; `--gc-nav-zone` scroller pad; both kit edge veils nulled) · bar slimmed to
  the prototype's metrics (its real computed height is **68px**, the prototype's own number —
  border-box 52+14+2) · `--accent-fill` → the two-stop, ONE token edit sweeping all 14 filled
  controls (fill uses brand `#805cff` not the switch's `#725bff` — the 4.5:1 ink gate;
  the switch itself keeps the prototype-exact value, it carries no ink) · the trio now paints
  only wordmark + palette chip (`--gc-brand-fill`).
- **Round 3**: appbar 67→~57px (the cause was the brand row inheriting `line-height:1.5`;
  the prototype sets 1 — NOT padding) · clear-mode legibility (the kit's inherited
  `text-shadow` halo painted INSIDE the gradient-clipped wordmark glyphs — nulled on the
  wordmark; the mode gained the prototype dissolve as explicit backing).
- **Round 4** (all MEASURED): appbar→content flush — the prototype's bar→content gap is
  **0px**; ours was 22–26px of first-block top padding stacking (e2e-pinned flush now) ·
  the user-bubble "font" was TYPE not family (family was already ZKGN, proven by advance-width
  probes; the missing half was the prototype's `12.5px/1.45` — ported both sides; **owner
  read-comfort check on device pending at G3**) · the composer placeholder speaks the
  prototype's コマンド入力… via the NEW `ComposerSlots.placeholder` seam (owner-requested,
  D52 addendum; last-defined-wins scalar through `mergeComposerSlots` — which DROPS unknown
  fields, the trap that would have killed the seam silently).
- **Review record**: Codex slice review SHIP WITH FIXES (7 findings — the ★-glyph guard gap,
  roster `unusable` validity, exact token values + 31-row guard, stylelint fence to ERROR +
  `color()`/`data:` bans, reel motion-reenable ghost, whole-page a11y scans, `themeRowValue`
  extraction) → wave confirm NOT READY (satellite-overlay lifts + the minimal-mode phantom
  nav zone) → both closed → final verdict READY; round-4 wave main-seat audited (the
  placeholder seam diff read at the merge chokepoint).
- **Standing G0 outputs**: fonts = 70 frozen glyphs, **192,856 B / 12 woff2** (guard proven:
  it did NOT fire on コマンド入力… because the string was frozen at registration — correct) ·
  the layer-trap fence now lists **7** members · `--appbar-h` is MEASURED (ResizeObserver;
  ~57px bare / ~62–64 with TTS or 2-tab chrome — reference numbers only).
- ~~**OPEN, carried to G4: the VT spike is UNTESTED**~~ **→ ✅ SETTLED 2026-08-04 without the
  owner's phone: outcome (a), `new(root)` is LIVE in Gecko — the §10.1 verdict block is the
  record** (external-capture probe, the transfer argument, the residuals, and the
  `skipActiveViewTransition` ownership bug it uncovered = G4's first obligation). The owner's
  observed visible-swap-under-the-reel is confirmed as the thing M2's cross-fade masks
  (measured: 1-frame step flag-off vs an 8-frame ramp flag-on); the body-only fallback is no
  longer needed.

**§7.2 — G1 AS-BUILT (✅ owner-eyeballed 2026-08-02 evening, same session as the G0 sign-off).**
Fifteen commits `2898fad..4879f9e`; end state **1221 FE unit (107 files) / 1254 BE / 33 gacha
e2e arms**, full gate green per commit. The record for successors:
- **Build (Opus, pinned brief `scratchpad/g1-brief.md` shape):** `2898fad` `wideArtForHost` (the
  promo crop of the SAME assignment, +5 tests) · `9b057bd` the banner — pure `carousel.ts`
  machine (idle→pending→drag, total over (state,event)) + `fleet.ts` derivations + the
  `gachaReel` sweep-signal store + imperative-transform `GachaBanner` · `2a19553` the capsule
  track (notch mask, stars, plates, tap-armed shine) · `5c4c7cc` wallpaper as a BACKGROUND on
  `.kit-main` (kit owns its children; the fade was the price, practically unobservable) ·
  `e0f1e2a` the agent's own self-review fix (suppressor disarm at gesture start).
- **Review wave (Codex R1: READY WITH FIXES, 4 MED + 2 LOW; +2 main-seat finds; verdicts in
  scratchpad codex-review/confirm.md):** `3f4f7c5` F1–F6 — ONE `moveTo` owns every animated
  move; snap lock mirrored into a commit-time ref (the pointerdown-vs-effect race); banner
  `inert` while the reel sweeps; focus ring pulled inside the clipped overflow
  (`outline-offset: -3px`); `detail===0` bypasses click suppression; `snapping` OUT of the
  autoplay gate (cadence restarts at interaction END) · `546a74c` F7 the kit-shaped error
  state (notice BESIDE cached track — frontier's replace-shape contradicted the banner) + F8
  additive `hasData` on `useFleet` (the honest "ever answered" fact; `hostCount>0` was a lying
  proxy) · `1d20524` F9 the `.promo` face crop (the prototype's per-slide nth-child 50% 12%,
  generalized as a class) · `92e508d` the confirm round's one residual (disarm BEFORE the
  gesture rejections). Codex confirm: 8/9 RESOLVED → residual closed → ready.
- **Owner eyeball rounds (live, the G0 cadence paying again):** `d03856e` slide scrim cut
  hard (95/60/90% alphas → 55/30/50 — an OWNER OVERRIDE of prototype literals, the first;
  copy legibility rides its text-shadow) · `e0afd5f` **3★ ladder RE-RULED ≥3→★3** (the lock
  table read the owner's whole real fleet — 2/2/3/3 configured services — as flat ★2; §6.1
  amended; and the lock premise "emma has 5–6 services" was optimistic: 3 dev / 4 prod) +
  `--gc-star-hi` → `#ff8fa8` (the §6.2 device pick; salmon read barely-rosy) · `0411843` the
  owner's OWN ART joins the bundled set (roster recast `[pegasus, atlas, 3, 4, lyra-tail]`;
  lyra stays for her cutout — the G4 figure default; rook benched; 6.5 MB drops → 188 KB webp
  via the documented one-shot) · `22e5577` entry-4 `focus: "50% 8%"` (the wide card's 46%
  crop beheaded a full-body composition; value MEASURED against simulated 16:9 + banner
  bands, not eyeballed) · `0b02a10` **the SCENE slides** (Opus wave, two owner amendments
  folded MID-FLIGHT: hero-style copy, then the researched `SCENE_TITLES` pool; `BannerSlide`
  became a discriminated union hero|scene|promo — the promo `host` is now compiler-enforced) ·
  `4879f9e` scene dots announce the visible TITLE (the wave agent's own flag, accepted).
- **Scenes-wave Codex round (folded post-eyeball): READY FOR SLICE CLOSE.** Union rendering
  (buffering, inert offscreen, gestures, promo-only activation), the `count > 1` autoplay gate
  (scenes run on an empty fleet; a true hero-only set stays paused), `sceneTitle()` cycling and
  glyph coverage all judged SOUND. Two notes: (N) comment drift from `4879f9e` — two comments
  still said the dot announces the scene's *name*; fixed in the handoff commit — and (L,
  PRE-EXISTING, not scenes-caused) promo slide keys are bare host ids, so a host literally
  named `hero` would collide with `HERO_KEY` (duplicate React keys); lean fix = `host:`-prefix
  promo keys. Non-blocking on the real fleet — carried in OPEN below.
- **Lessons banked:** an eyeball "bug" can be the ruled design meeting real data — CHECK THE
  LIVE API before touching code (both star reports were data, not defects) · owner rulings
  arriving mid-wave are deliverable to a running agent as amendments (two landed cleanly) ·
  `vitest` from the repo ROOT silently runs without jsdom — cwd discipline on compound
  commands · the wave agent's `git add -A` swept unrelated worktree state once (it caught and
  rewrote itself; keep briefs explicit: stage by path).
- **OPEN at slice close:** the ~80 MB of original drop files sit UNTRACKED in
  `design/prototypes/gacha/{chars,banner images}/` — owner call whether they enter history
  (REC: no; the converted webp set is committed and the originals live wherever the owner
  keeps art) · owner picks not yet given: the wordmark string (カプセルアーケード stands) ·
  NEW ribbon (unbuilt, no data seam) · promo-click→dossier destination (stub seam awaits G2;
  proposal unvetoed so far) · counter semantics implicitly accepted (no complaint over three
  rounds) · the Codex L above (`hero`-named host vs `HERO_KEY`): `host:`-prefix promo keys
  when G2 next touches the slide plumbing — a one-line namespace fix, not worth its own wave.
- **POST-CLOSE FIX (owner device round, 2026-08-02 night): touch swipe was DEAD on the phone**
  (Fennec — mouse drag fine, dots/taps fine). Root cause, Opus-research-confirmed with a live
  CDP touch repro + spec citations: on TOUCH the pointerdown target (a slide child) holds
  **implicit pointer capture**, so the horizontal lock's `root.setPointerCapture()` fires a
  BUBBLING `lostpointercapture` at that child — which the root's unguarded handler read as a
  cancel, aborting every swipe at the frame it locked. NOT engine-specific (Chromium repro'd
  identically; Bugzilla sweep clean — Fennec's `touch-action` handling is not at fault). Fix =
  the one-line target guard (`e.target === e.currentTarget`) + two pinning tests; alternatives
  (skip capture on touch / capture at pointerdown) rejected — the latter breaks promo-tap click
  targeting on desktop (the BottomSheet-documented Chromium asymmetry). Field check: no peer
  lib (use-gesture/Embla/Framer/Swiper) captures on an ancestor; our own `useDragReorder`
  lore said as much. The research pass stands as this fix's review round. **LESSON (durable,
  any pointer-gesture code): a bubbling `lostpointercapture` listener MUST target-guard, or
  touch's implicit capture handoff reads as a cancel — test gestures with REAL touch (CDP
  `Input.dispatchTouchEvent`), not just mouse or jsdom.** ✅ Owner re-checked on the Fennec
  device: swipe works (2026-08-02 night) — G1 fully closed.

**§7.3 — G2 AS-BUILT (✅ owner-eyeballed + PUSHED 2026-08-02 night, same owner-attended session
as the G1 close).** Eleven commits `8c4c74f..294cc32`; end state
**1323 FE unit (111 files) / 1254 BE**, full gate green per commit, pushed.
- **Build (Opus, pinned brief `g2-brief.md`):** `8c4c74f` U1 — `lib/hostDetail.ts` (council M6;
  pinning tests FIRST, both precedent themes refactored on, two REAL differences kept: frontier's
  voice strings stay in-theme, the seen/lastSeen split) · `7504d42` U2 the light sheet (ruled
  grid, svcByHost rows, `--host` accent pairs = i%3 over the tri-accent) · `526975e` U3 the
  action bar (arcade tickets on kit `run` semantics; `--gc-dossier-danger` minted — the night
  `--danger` measured 3.0 on white) · `a9c6567` U4 `host:` key namespace (the carried G1 LOW,
  regression-tested against the old code) · agent finds: **`pingText` `<1 ms`** (emma pings
  itself in fractions — changed the G1 plate too, flagged) · dossier JP labels were already
  in the subset (no regen).
- **Main-seat audit + owner round 1 (`57e106a`):** strip clip (4px box can't carry a 24px
  radius — full-cover band pseudo) · ticket gradient fringe (`background-clip: padding-box`) ·
  the CONTRAST PROBE finds: kicker 4.30 → `#b03578`, opacity-muted labels → real token
  `--gc-dossier-ink-2 #565875` (alpha blends are invisible to the token gate), night ok/warn
  dots ~1.5 on white → `--gc-dossier-ok/-warn` · **contrast.spec.ts gains THEME_PAIRS + the
  in-subtree probe mount** (11 dossier rows; 48-combo matrix green locally).
- **THE MORPH ARC (M3, owner-pulled from G4).** First pass shipped INVISIBLE on device. Parallel
  Codex design analysis + Opus instrumented rework found the REAL cause: BottomSheet mounts via
  a passive effect, so the VT's new capture held NO avatar at all (`flushSync` does not flush
  another component's mount) — plus the moving-target rect underneath. Fix (`6b9188c`): opt-in
  **`enterInstant`/`upkeepKey` seam on BottomSheet** (derived presence — sheet exists AT REST in
  the very commit the transition updates; other themes pinned byte-identical) + the PROTOTYPE
  composition (owner re-ruling: prototype-exact, morph > sheet-slide; `gacha-detail-in/out`
  root keyframes, sheet does not slide under VT) + SWAP morph (inline avatar
  `view-transition-name: none` suppression during the old capture) + visible × (theme markup,
  `\d7` glyph in CSS — the ASCII fence) + tap-outside close (document listener, exemption list;
  `d36bbb6` modals exempt) — **frame-proven on Chromium AND Firefox 151** (x11grab; Playwright
  Gecko screenshots OMIT the ::view-transition layer — the durable verification gotcha).
- **Codex rounds:** G2 review **NOT READY** (the async-callback HIGH → generation tickets) →
  M3 confirm **READY WITH FIXES**, all five taken (`f25a0a2`): single-owner morph PREP +
  `skipActiveViewTransition` on the shared wrapper · capture-critical body stamps → layout
  effects · **close-on-navigation ruled** (a nav tap is "outside"; keyboard now matches) ·
  claimed-focus guard on BottomSheet's restore · `upkeepKey` ends a per-poll forced layout.
  `efffd96` closes LOW-5: the ruled EM DASH via copy.ts `metricPending` + one `fonts:gacha`
  regen (70→71 glyphs) — **the "regen needed" premise was WRONG; latin faces carry U+2000-206F**.
- **`c248260` the ART SHOWCASE (owner ask, same night):** portrait = button → full-screen
  UNCROPPED art on the night backdrop, **z-46** (sheet 40 < showcase < confirm 50), REVERSE
  morph both ways under `[data-transition="showcase"]`, Escape closes art-then-dossier
  (defaultPrevented convention), Tab-trapped ×, tap-outside exempts the overlay; both-engine
  probe evidence; showcase teardown funneled through every dossier teardown path.
- **The G2-CLOSE SWEEP (Codex, on the showcase): CLOSABLE WITH FIXES → all four taken
  (`294cc32`, mutation-checked):** the showcase's transitions take the same generation TICKETS
  as the dossier morphs (`artGen` + prep-object ownership; a stale callback that closed over a
  React-reused avatar can no longer claim it — `isConnected` guarded) · forced teardown SKIPS
  the owned in-flight transition (settling VT snapshots float above z-indexed content — the
  live render gate alone never excluded the reel) · focus restore is INTENT-flagged (only the
  art's own dismissal restores to the portrait; teardown lets the closing owner handle focus —
  a cleanup cannot trust post-commit state) · five adversarial race/teardown arms + a
  skip-spying, never-settling VT mock. Two recorded residuals: `skipActiveViewTransition` is
  global-not-per-layer (fine while both call sites run together on teardown; revisit if the
  wrapper grows owners) · a same-frame whole-tree unmount can still momentarily target a
  detaching portrait (falls to body, where it was going anyway — no machinery).
- **Owner rulings this slice (D52 addendum):** morph = prototype-exact, IMAGE over sheet-slide
  if forced · swaps morph too · visible × restored (overrides the kit no-visible-close for
  gacha) · tap-outside closes (cards/promos/modals exempt; carousel dots close — flagged,
  unvetoed) · close-on-navigation · the showcase itself · width-bound contain in the showcase
  (unvetoed) · G4's M3 line is DONE early — G4 re-scopes to the reel figure + M2 only.
- **OPEN at close:** kit sr-only sheet close duplicates the ×'s accessible name (kit-level
  "host provides close" opt-out, follow-up) · a11y e2e never opens the dossier (axe misses the
  × — tag-gate note) · the reel-vs-track guard publishes via the store's normal effect (a
  first-painted-frame input gap, theoretical) · deliberate eslint warnings: set-state in
  capture-critical layout effects (documented inline).
- **Lessons banked (durable):** TWO WRITING AGENTS IN ONE WORKTREE COLLIDE — a concurrent
  agent's git operation reset the other's index mid-commit, and the whole-tree pre-commit hook
  blocks either on the other's WIP; parallel build waves get `isolation: worktree` from now
  on · VERIFY ANIMATIONS WITH FRAMES, not end-state screenshots — and
  never with Playwright-Gecko screenshots (they render without the VT layer) · anything a VT
  capture must see is committed IN the update callback (layout effects / derived presence;
  passive effects can land after the capture) · `startViewTransition`'s callback is async and
  ALWAYS runs (even skipped) → generation tickets + single-owner DOM prep for names ·
  `:scope[data-transition]::view-transition-*` matches fine inside `@scope` rooted on html ·
  a token contrast gate cannot see `opacity` blends — mute with tokens, not alpha.

**§7.4 — G3 AS-BUILT (2026-08-03; ✅ code + reviews complete; ✅ CLOSED 2026-08-04 — owner
device round PASSED wholesale, no fix wave needed).** Device-round verdicts (owner, Fennec,
2026-08-04): M7 blur ramp smooth · 12.5px bubbles comfortable · oracle pin holds across appbar
modes · the arcade composer panel approved **as re-ruled by the 2026-08-03 side session** (the
amendment below IS the shipped look; the old flat-panel question and its `--line-2` delta are
moot) · the M6 scanline fine on Gecko as-is — **the pre-designed `data-engine` Gecko branch is
NOT built and NOT needed**. The `:active`-wedge question rode the same round with no complaint —
closed unless daily use bites.
Six commits `6c5298d, 444469b, 8e37db5, 2f424ef, af6100e, 5ce33d7`; end state **1343 FE (112
files) / 1254 BE / 40 gacha e2e arms**, gate green per commit. The record:
- **U1** GachaAgent joins `bodies` (frontier's pattern): partitioned `ART.oracle` + M6 scanline
  over the composed shared ChatThread; empty state with composer-filling chips. **U2** M7 as
  ONE CSS var (`--gc-oracle-p`) from a passive `#app-scroll` listener through `safeRafLoop`;
  progress from the oracle's own offset; TWO full faces (art+scrim+name) crossfading, ghost
  carries the blur, `aria-hidden`. **U3 RULED: the catalog gains `arcade`** — measured 4/5
  defining properties off every existing skin (prototype: opaque `#15172e`, no frost, hairline,
  14px, no shadow); semantic tokens only; one fidelity delta flagged (edge `--line-2` #ffffff2e
  vs the prototype's #ffffff1a — a shared skin can't read theme-private tokens). **⚠ U3's LOOK
  is SUPERSEDED — see the 2026-08-03 skin amendment at the end of this section; the hairline
  and the flatness are both gone. Its D37 rulings (look-named, shared, semantic tokens only)
  all stand.** **U4** log-box metrics, measured.
- **The owner's four live findings (2f424ef):** privilege chip → the kit's `.sec/.right` slot
  (was displaced to x=308 vs the precedents' 82) · the dropdown's trap fixed · the WHOLE FACE
  rides the ramp (owner ruling — §10.2 had under-scoped it to the art) · the oracle pins at
  `var(--appbar-h)`, never under the bar (owner ruling; §10.2's top:0 superseded). Plus an e2e
  catch: M7's zoom must live INSIDE the block's clip or it grows the pane's scrollWidth.
- **Codex round: READY WITH FIXES → all five taken (`5ce33d7`):** M1 the gacha override had
  silently UN-STUCK the kit's pinned-plan panel (deleted outright — the kit's sticky z:4
  stands) · M2 the header's z-index trapped PrivilegeChip's 60/61 overlay — **fixed by
  REMOVING the header's z-index (positioned-but-un-runged ⇒ no stacking context; tree order
  beats the z-0 oracle), NOT by Codex's portal** (the repo has zero portals; the agent's
  departure from the main seat's header-3 ruling, accepted as the leaner fix; hit-test parity
  with cosmos proven) · M3 M7's base remeasures on pinned-plan presence + an observed appbar,
  coalesced through one rAF · L1 `safeRafLoop` latches `faulted` (start() no-ops after a
  thrown tick — NOTE the blast radius: GachaBanner's drag loop now freezes post-fault instead
  of re-throwing per gesture, the intended degradation) · L2 the adversarial arms (both M3
  arms verified red on pre-fix code).
- **The shipped stacking ladder (a durable law for bespoke agent bodies):** oracle 0 < header
  (positioned, NO z-index) < log 2 < plan 4 (kit) < appbar 5, fixed overlays 60/61
  document-level. **Any theme that gives the log a rung must NOT rung the chrome above it —
  a positioned-with-z ancestor traps every fixed descendant.**
- **Plan corrections recorded:** §10.2's wrapper-scale, art-only crossfade scope, and top:0
  are all superseded as above. **Probe gotcha:** the dev backend's own `/api/appearance`
  silently overrides a seeded theme — mock it or a "cosmos" probe run comes back wearing gacha.
- ~~**OPEN at this state:** the owner DEVICE ROUND~~ **→ PASSED 2026-08-04 (see the header);
  all five checks closed, no fix wave.** Still standing: the arcade skin's cross-theme look
  rides every theme's picker (visual-checked gacha+cosmos, screenshots in evidence).

**⚠ AMENDMENT — the `arcade` skin was RE-RULED after G3 closed (owner session 2026-08-03,
UNCOMMITTED at the time of writing; the code in `kit/kit.css` is the record).** U3 above
describes the skin as SHIPPED at G3, not as it now stands. The owner drove a live round on it
and the look changed materially:

- **No outlines anywhere in the skin.** The bar's hairline, the controls' borders — all
  `transparent`. This also strips the mic's red RECORDING ring (`.kit-cbtn.mic.rec`); the red
  glyph is the cue, exactly as glass and bezel already do. **Owner-confirmed, not an oversight.**
- **The flatness is replaced by ONE SIGNATURE: a hard, zero-blur accent drop** —
  `--arcade-lift: 3px`, `color-mix(in oklch, var(--accent) 60%, transparent)` — on the bar, on
  every control (menu, mic, plan pill, send) and on the composer's two popovers
  (`.kit-suggest`/`.tools-sheet`). A darkened variant for the accent-FILLED controls was built
  and rejected: the owner ruled for one colour across the bar. Semantic tokens throughout, so
  it wears the host theme's accent — cosmos paints it violet (now asserted in e2e).
- **A sticker PRESS:** `:active` translates a control into its drop and removes it. The mic
  rides the JS `.press` class as well, because `:active` wedges on Fennec (useComposerChrome).
- **The neutral controls take the plan pill's `--accent-soft` fill** — without a fill, a drop
  behind a see-through button reads as a detached band, not a shadow.
- **Geometry:** unchanged except the DOCKED layout's menu + mic, which square off to
  `--radius-sm` (owner ruling). A pass that squared every layout's controls was rejected. The
  docked send slab is untouched; its drop is fully clipped by the bar's `overflow: hidden` and
  paints zero pixels (pixel-diff verified — harmless, left in place).
- **Two e2e arms were re-pointed** (`layout.spec.ts` ~963 / ~1248): they asserted "the edge
  STAYS" and `shadow: none`, both now false. They gate the transparent border and a
  `/ 3px 3px 0px 0px$/` shadow SHAPE (not a literal colour, so a palette change can't break them).
- **Two gacha-side fixes rode the same session** (both in `themes/gacha/`): the M6 scanline layer
  is now one travel-length taller than its box (`inset: calc(-1 * var(--gc-scan-travel)) 0 0 0`),
  which fixes the uncombed band that appeared across the top of the art at the end of every
  7s cycle — the animation itself is untouched; and `--gc-fill-spread: 240%` widens the
  `--accent-fill` ramp via `background-size` on the four SMALL filled controls the owner picked
  (composer send + line mic, seg active chip, mini-player play) so a 26–36px control shows the
  ramp's middle instead of the whole sweep. The token's stops were deliberately NOT moved —
  the wide consumers keep their full sweep.
- ~~**STILL OPEN on device:** whether `:active` wedges on Fennec for the send/menu/plan pill~~
  **→ closed by the 2026-08-04 device round** (no wedge reported; the mic is immune by
  construction). Re-open only if daily use shows a stuck press.

*(Separately, and unrelated to gacha: the tools-menu trigger's open RING is now gated to the
`outline` skin — `body[data-composer-skin="outline"] .kit .kit-cbtn.tools.open`. It used to
re-grow a border that glass/bezel/sleek deliberately strip, so an open menu was the only
outlined thing in a borderless bar.)*

**§7.5 — G4 AS-BUILT (2026-08-04; ✅ code + reviews COMPLETE; ✅ CLOSED same night — the owner
round PASSED on BOTH phone and desktop: figure approved at the 67% default untouched, M2's
on-device tab switch confirmed good, no tuning requested).** Seven commits `dd1a056, 9a57155, dbb020a, 6dbecef, a282ef8, cafb48a,
fa86ed3`; end state **FE 1363 / BE 1254**, gate green per commit. The record:
- **S1** the VT skip is TYPE-scoped (`skipActiveViewTransition(...types)`, `activeType` beside
  `activeTransition`; kinds disjoint by construction: nav=`tab`, fleet=`detail`/`showcase`,
  theme swap untyped) — closes the probe's ownership bug; the exact kill reproduced red-first.
  **Fix-wave hardening:** an UNTYPED start now synchronously retires a typed stamp before
  `start()` (else the theme swap ran under M2's tab rules), and the test proves BEFORE-start
  via a capture-time `stampAtStart` recorded inside the fake — an after-return assertion would
  pass the regression.
- **S2** M2 ships prototype-exact (`old(root)` scale .96 / 240 ms ease · `new(root)` from 1.04
  / 380 ms + 100 ms delay on `--gc-ease-out`), keyframes unified kind-neutral
  (`gacha-root-out/in` serve tab 240/380+100 AND detail 200/300 via per-kind overrides). The
  spike seam PROMOTED per its charter: flag + fenced block deleted, `runNavTransition` = the
  real gacha-gated decorator, other themes byte-identical (e2e: one `tab` stamp per real tap
  on gacha — cardinality via the MutationRecord `oldValue` chain, two taps ⇒ `["tab","tab"]`;
  zero on cosmos). The hosted-nav branch (utils→conf) gets reel but NO M2 (flushSync-in-effect;
  pre-existing, accepted).
- **S3** the reel FIGURE: `--gc-figure-{h,x,lift,dur,peak}` tokens (h default 67% vs the
  prototype's 84% — the re-scope; the tokens.css note carries the aspect/clip numbers), art via
  `reelFigureArt` (G5 pin swaps it), warm-up preload, degradation LATCH (corrupt art ⇒
  slats-only; `perf: lite` ⇒ no fetch AND no mount), overlay unchanged at z 45.
- **⚠ DURABLE LESSON (Codex right, main seat wrong, settled by pixel experiment):** CSS
  `drop-shadow()`'s blur length **IS the Gaussian σ** — proven pixel-identical to `blur()` at
  the same value in BOTH engines (RMSE 0.0000) — box-shadow's r=2σ does NOT apply to filter
  functions. The first bake halved the glow; regenerated σ 48/35 asset px (30/22 css ÷ .622
  scale), 855×900 107 KB, recipe reproduces byte-for-byte (`art.ts`); `--gc-figure-h` 62→67%
  compensates (900/828) so the character's on-screen size is unchanged. The independent
  two-shadows form KEPT (baking the real filter chain overshoots 1.4–1.5×).
- **Review arc:** Codex R1 READY WITH FIXES (2 MED/3 LOW) → wave `a282ef8`+`cafb48a` → confirm
  round: all four CONFIRMED-RESOLVED + 2 new LOWs (before-start proof · a flipped ratio in the
  tokens note), both closed `fa86ed3`. HANDOFF-stale-flag LOW = ruled historical-blocks-stand;
  the live top block carries the disclaimer.
- **Carried to G5:** owner-supplied cutouts have no baked glow (bake at index time, or document
  the expectation) · the figure's failure latch is safe ONLY while `FIGURE` is module-static —
  runtime/media-index art needs URL-scoped reset semantics (Codex confirm note).
- ~~**OPEN (the G4 gate):** the owner FIGURE EYEBALL + the Fennec+Chrome device round~~
  **→ PASSED same night (phone AND desktop, owner: "they look good"); no tuning asked, the
  67% default stands, the M2 device check is done. G4 CLOSED.**

**Acceptance matrix (the lock session turns this into per-slice test obligations):** 0/1/many
hosts · hosts>roster and roster>hosts · queries loading/error states (pill, counter) ·
no-services and many-services hosts · missing/corrupt/deleted art (file AND slot reference) ·
all appbar/layout modes · reduced-motion and perf-lite · VT unsupported (older Gecko) · rapid
tab switching (reel re-entrancy) · long host names on plates · Fennec AND Chrome device rounds.

## 8. Owner questions (the §5-of-vapor-plan analogue) — **✅ ALL RULED (prep session + the lock session, both 2026-08-02); nothing remains open**

**✅ Answered (rulings folded into the sections cited):**
- ~~Q2 Roster serving~~ → **(b) read-only owner directory + the phone gallery for
  ordering/pinning** (§5.4). The §5.3 assignment semantics are now FULLY ruled too
  (positional + `slots` pins + ordered cycling — §5.3, lock session).
- ~~Q3 Star ladder~~ → **CONFIGURED services, regardless of live status**, exact ladders in
  §6.1 (5★: 1/2/3/4/≥5 → ★1..★5; 3★: 1 → ★1, 2–3 → ★2, >3 → ★3). The zero-services
  cell is ruled too: ★1 floor (lock session, §6.1).
- ~~Q6 Brand wordmark~~ → **katakana wordmark** (§4.3; commits the `brandText` slot; exact
  string = eyeball copy pick). The JP nav sub-labels half — ruled Q6b in the lock block below.
- ~~Q1 (size half) + Q10 Card geometry~~ → **specified DURING the build slices, by eyeball**
  ("to make sure it fits and looks good" — owner). The G1/G4 briefs carry them as in-slice
  design work with owner checkpoints, not lock blockers. The COUNTER semantics and the `NEW`
  ribbon ride along as G1 eyeball decisions.

**✅ Ruled in the LOCK session (owner, 2026-08-02 — the seven formerly-open items):**

- ~~Q1 Reel frequency~~ → **(a) every switch** ("we can always tune the timings and such
  later" — owner). The cooldown (b) stays the pre-agreed G4-eyeball valve if daily use wears
  — a one-line change. Reduced-motion kills the reel regardless. → §4.1/§10.1 unchanged.
- ~~Q4 Default star mode~~ → **5★ default** (overrides the 3★ REC — owner: emma already has
  5–6 configured services, so the flagship rolls a full row day one). 3★ stays one seg-tap
  away; the rate pill follows the mode (`★5 RATE` by default). → §6.1 config home, §6.3.
- ~~Q5 Palette variants~~ → **BOTH families.** (i) The base-ramp set per the REC — arcade
  (default) · midnight · indigo — trio constant. (ii) **PLUS two accent-SHIFTING variants**
  (owner: "a couple more that also shift the accent trio"), derived from a research pass over
  popular gacha games' real UI palettes (owner-directed; candidates + provenance in §4.4).
  Five variants total; every one passes the §14.15.1-⑨ contrast probe. → §4.4, G6.
- ~~Q6b JP nav sub-labels~~ → **KEEP, via the `subLabel` kit extension (now committed —
  §4.9 ledger).** Owner constraint: **real Japanese** — kanji where it's the natural writing,
  kana otherwise; never decorative pseudo-JP. The four labels verified as genuine words:
  編成 (hensei, "formation" — Fleet) · 案内 (annai, "guidance" — Agent) · 設定 (settei,
  "settings" — Conf) · **Utils = ツール** (tsūru — the standard katakana loanword for
  "tools", matching the katakana wordmark). The 4-tab layout fence is thereby satisfied.
- ~~Q7 Banner slides~~ → **(a) AND (b) — the union.** Slide 1 = the fixed "NETWORK PRIZE
  POOL" hero with its frozen copy; then **live per-host promo slides**; promos are
  **CLICKABLE** and the banner is **SWIPEABLE**. Swipe+click coexist — feasibility confirmed,
  standard carousel tap-vs-drag discrimination; full design + the R8 copy amendment in
  **§6.4** (new). → G1 scope grows accordingly.
- ~~Q8 Oracle entry state~~ → **ghosted entry accepted** (per REC): a populated thread lands
  bottom-pinned with the art ghosted behind the log; full-strength on scroll-up and always on
  an empty chat. The §4.2 note is a ruling now, not a flag. → §4.2/§10.2 unchanged.
- ~~Q9 Dossier metrics~~ → **the frontier grid — "same four as frontier" (owner):**
  Ping 応答 · **Uptime 稼働 ("—" placeholder** — the frontier/cosmos deferred-seam precedent,
  additive when a backend boot-time seam ever lands) · Services サービス (configured count —
  doubles as the star explanation) · Seen 最終確認 (`last_seen`, real). The prototype's
  Load 負荷 / Temp 温度 tiles are dropped (no seam feeds them — the same honest-grid ruling
  frontier recorded in code). → §4.8, G2.

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

**Lock-session record + post-lock obligations (nothing here is an open design question):**
- ~~§8's remaining owner answers~~ ✅ ALL RULED (2026-08-02 lock session). ~~The council
  round~~ ✅ RAN (Opus architecture lens LOCK WITH CHANGES + Codex R4 READY WITH FIXES — all
  findings reconciled in §11 and folded; both confirm rounds' residuals folded too). The
  D52 entry records the lock.
- The prototype stays the fidelity reference: every G-slice eyeball compares against
  `capsule-arcade/index.html` opened locally (it is fully standalone).
- The test-surface question is now ANSWERED in §10.5 (contract/e2e enrollment, verified).

## 10. Implementation dossier — the deep-research round (2026-08-02, owner-directed)

*Four Opus research passes (transition/VT engineering · scroll+GPU fluidity · asset pipeline ·
fine-grain kit integration), synthesized and load-bearing claims re-checked by the main seat.
This section is the "how, exactly" layer under §3/§4 — build briefs cite it directly. Confidence
markers kept from the dossiers: VERIFIED = read in source/spec; measured numbers are stated as
such; the G0/G4 device rounds remain binding for everything Gecko-empirical.*

### 10.1 The tab transition (M1/M2) — the recipe

- **Passive start is CONFIRMED prototype-faithful.** The prototype's own no-VT path
  (`common.js:12-17`) runs the reel class-add and the content swap in the same task before any
  paint — behaviorally identical to a same-frame passive start. The pre-nav kit hook is
  therefore DROPPED from the plan (it bought one frame on the VT path only); `useSections.
  navigate` also has no same-tab guard, and a value-subscriber no-ops naturally where a nav
  counter would not.
- **The React shape:** the overlay is a Root sibling AFTER `<DefaultRoot/>` (cosmos-starfield
  precedent), deriving its class/`key` from `useUISlice(s => s.tab)` IN JSX (same
  `useSyncExternalStore` binding as the bodies → same commit, same paint; no effect, no
  `useLayoutEffect`). Restart on rapid taps = `key={tab}` remount (the React-clean equivalent
  of the prototype's `void offsetWidth` trick); a first-render latch suppresses the boot reel.
- **One shared VT helper, not a second wrapper:** extract `switchTheme.ts:163-183`'s block
  (feature-detect + `motion==="reduced"` bypass + `flushSync(update)`) into
  `lib/viewTransition.ts` `runViewTransition(update, type?)` with the `html[data-transition]`
  stamp — **hardened over the original: catch BOTH `.ready` AND `.finished` (the existing
  block catches only `.ready`), and make the `data-transition` cleanup race-safe (an aborted
  older transition must not delete the newer one's stamp — token-guard the delete)**. React
  19.2 stable ships NO ViewTransition component (verified against installed node_modules) —
  do not chase the canary API. Firefox 144 lacks VT *types* — the kind rides
  `html[data-transition]`, never `startViewTransition({types})`.
- **M2's call seam, stated plainly:** the passive subscriber starts the REEL but cannot WRAP
  the nav update in `startViewTransition` — kit navigation is `useSections.navigate` →
  `setUI`, called directly by NavBar, and a subscriber fires after the write. So **M1 needs
  no hook at all; M2 specifically either DIES at G0 (the default expectation — it was
  droppable-without-ceremony already) or requires a small navigation-transition decorator at
  the shared chokepoint** (wrap the `setUI` call, semantic and opt-in). The G0 spike's
  liveness verdict decides whether M2 is worth that seam.
- **VT composition, precisely** (corrects §4.1's draft wording): NO z-index can paint above a
  running root VT (the VT layer paints after all content INCLUDING the top layer);
  `view-transition-name: none` does NOT exclude an element from the root capture. The reel
  appears animated during a root VT only because `::view-transition-new(root)` is LIVE — which
  is implementation-attested (Chrome/MDN) but weaker in the spec text. **That liveness on
  Fennec 144 is the single empirical question the G0 spike settles.** Ranked outcomes:
  (a) prototype-identical (unnamed reel; spike first) · (b) isolate the reel as its own VT
  group pinned live (`::view-transition-group(reel){animation:none}` +
  `old(reel){display:none}` + `new(reel){animation:none}` — paints above root) · (c) drop the
  root VT for tabs (M2 dies; the reel carries everything).
- **✅ SPIKE VERDICT (2026-08-04): OUTCOME (a) — `::view-transition-new(root)` is LIVE in
  Gecko; M2 ships prototype-identical.** Settled WITHOUT the owner's phone, by an Opus
  external-capture probe on this box (the frames-not-screenshots bar: Xvfb + real windowed
  Firefox + ffmpeg x11grab; Playwright drove but never captured): a canary animation inside
  the root capture advanced monotonically at nominal rate through a stretched 2.5 s root VT
  on BOTH Gecko 151 (in-app, gacha, real reel — the slats swept and completed INSIDE the VT
  window) and system Firefox 152.0.6 (engine-level page). Transfer to Fennec: high
  confidence — BCD pins every VT entry at 144 for `firefox` AND `firefox_android` (one
  implementation, one train, bug 1985809; no Android-specific VT bugs found), and liveness
  held even under Xvfb SOFTWARE compositing, the less favourable path. Residuals, honestly:
  144 itself untested (first-release quirk not excludable from here — the owner's Fennec
  must be ≥144, and their desktop runs 152 so it likely is) · device stutter-vs-freeze is a
  fluidity question G4's existing Fennec+Chrome round covers anyway, as one line item:
  *switch tabs under gacha with M2 wired; confirm the slats keep sweeping through the
  cross-fade*. No standalone phone spike is owed. Evidence strips + drivers were kept in the
  session scratchpad (`vt-spike-probe/`), not committed.
  **The probe also found WHY the owner's own desktop A/B looked identical ("same as
  before") — a REAL ownership bug, G4's first obligation:** `GachaFleet.dropShowcase`
  (`GachaFleet.tsx:150-156`) calls `skipActiveViewTransition()` UNCONDITIONALLY, and the
  tab-leave effect (`:210-219`) calls `dropShowcase` — so a fleet→X navigation kills the nav
  VT started microseconds earlier in the same commit, 100% reproducibly (captured with
  stacks). `activeTransition` (`viewTransition.ts:57`) is a module-global with NO owner
  token — unlike `stampOwner` (`:47`), which token-guards the attribute against exactly this
  cross-talk class. Latent today (flag-off), fatal once M2 is unflagged. **G4 fix = give the
  skip the same token discipline `stampOwner` already has** (a caller may only end the
  transition it started; the minimal `showArt !== null` guard is the fallback, the token is
  the pattern-matching fix). Two more G4 obligations the probe surfaced: **the M2 CSS does
  not exist yet** (`[data-transition="tab"]` matches zero rules — the flag currently yields
  only the bare ~250 ms UA cross-fade, measured 274 ms), and the seam promotion
  (`runNavTransition` → unflagged decorator; the fenced block dies) per the block's own
  charter. *Stale-fact fix, same probe: VT `types` landed in Gecko 147 (bug 2001878) — the
  next bullet's "Firefox 144 lacks VT types" was true at lock time; the `html
  [data-transition]` attribute form REMAINS the ruling (144 devices exist; don't relitigate).*
- **Interruption semantics (spec-verified):** a second `startViewTransition` SKIPS the active
  one with AbortError — not queued; the skipped callback has already run so state stays
  correct. Swallow `.ready`/`.finished` rejections (the house helper already does); a hidden
  page skips transitions entirely; never gate correctness on `.finished`.
- **Riders:** the kit's own `.tab.active` entrance (`kit-fade` 0.25 s) would double-animate
  against a VT root cross-fade — gacha nulls/re-tunes it (the prototype has no such fade) ·
  the reel-figure's static double `drop-shadow()` rasterizes a large moving PNG on Gecko —
  bake the glow into the exported cutout asset; `will-change: transform` + `contain: layout`
  on the slats · geometry: `position:fixed` sibling, `height: var(--app-h)` NOT `inset:0`
  (the keyboard-aware shell height), bottom safe-area inset for the figure,
  `pointer-events:none` + `aria-hidden` · **z-rung ✅ RULED (lock, → D52):** the reel sits at
  **z 45** on the kit ladder (toasts 40 / TTS flash 41 / **reel 45** / modal 50 / prompt 60 —
  covers toasts for its ~640 ms, NEVER covers confirm/prompt modals), and gacha does **NOT**
  copy the cosmos `.kit{position:relative;z-index:1}` idiom (that would make `.kit` a unit
  and put the reel over modals); the rung is recorded in the kit ladder comment.
- **Reduced motion:** no reel at all + the VT bypass — via `body[data-motion]`, never the OS
  query, and never the prototype's global `.001ms` sledgehammer (`base.css:78-80` is
  explicitly NOT ported; §14.11 rule).
- **Owner observation at the G0 eyeball (2026-08-02):** with M2 off, the content swap is
  VISIBLE during the reel's first frames (the slats haven't covered the viewport yet) — this
  is precisely the gap M2's cross-fade masks in the prototype (old scales down 240 ms, new
  fades in +100 ms). The G0 spike verdict therefore answers the owner's complaint too, not
  just the liveness question. **If VT is dead/frozen on Fennec, the G4 fallback candidate is
  the owner's suggested SHORT swap delay — on the BODY CONTENT ONLY** (owner clarification:
  the bar's indicator/selected state flipping instantly is GOOD and stays immediate; only the
  tab-body swap holds briefly until the slats cover). Mechanically: nav state flips at once,
  the BODY's displayed tab lags it by a short gacha-only hold (a deferred display value, not
  a deferred navigation — inputs and rapid taps stay live against the real state; re-entry
  collapses to the newest target; the hold stays well under the ~300 ms tap-response bar) —
  traded at the G4 eyeball against accepting the visible swap.

### 10.2 The oracle (M7) — the recipe

- **Mechanism ruling: the two-layer crossfade.** CSS scroll-driven animations are NOT in
  stable Gecko (BCD: `firefox: "preview"` — flag-only in stable as of FF152) → ruled out as
  mechanism, and shipping it as enhancement means two implementations of one effect (against
  the repo's posture). Animated `filter: blur()` is ruled out by §14.11's own conversion rule
  ("animate the opacity of a … layer, not filter"; Gecko blur ≈ 10× slower, bugzilla 925025;
  no theme in the repo animates filter anywhere). The shape: TWO stacked copies of the oracle
  art in the sticky block, with the fade split so the ENDPOINT matches the prototype's 28%
  ghost — **overall `opacity 1→.28` on the shared wrapper** (+ its `scale`), the children
  CROSSFADING inside it (sharp `1→0`, statically-blurred(5px) copy `0→1`); fading
  sharp→.28 while the blurred copy reaches 1 would end fully-opaque-blurred, not ghosted.
  Static filter rasterizes once; per-frame work is opacity/transform only, all derived from
  the one `--oracle-p`.
- **The driver:** passive listener on `#app-scroll` (the `ChatThread.tsx:617-627` precedent —
  same scroller, `{passive:true}`), writing ONE custom property (`--oracle-p`) inside rAF;
  CSS derives all three channels from it. NO per-frame `getBoundingClientRect` (§14.11);
  cache the oracle's `offsetTop` via ResizeObserver. **`active`-gate the listener and
  RE-MEASURE on tab activation** — a `display:none` body reports all-zero
  rects/offsets/sizes; and re-sync after `ChatThread`'s programmatic bottom-pin (§4.2).
- **Stacking facts (verified):** sticky-under-sticky is fine (the appbar frost overlays the
  top `--appbar-h` of the art — near the prototype's own gradient topbar; `top:
  var(--appbar-h)` if the eyeball wants the art clear). **The kit edge scrims are the real
  pitfall**: `.kit-main::before` (30 px `--bg` haze band, z 3, OUTSIDE the scroller) +
  `.has-composer::after` bottom veil — both paint over the oracle/log; gacha nulls them
  per-tab via the documented `body[data-tab]` hook (cosmos/frontier precedent). Keep the
  log's z below 3. Sticky-killers: no `overflow`/`transform`/`filter`/`contain:paint` wrapper
  between `#app-scroll` and the oracle. The blurred copy is itself a backdrop root — keep it
  a LEAF; a filtered/blended gacha ancestor of `.kit-appbar`/`.kit-composer` would break
  their backdrop-filters.

### 10.3 Ambient + fleet effects — rulings from the GPU pass

- **M5 glow** (static element, opacity-only blend loop): low risk, keep. **M6 scanline**
  (blended AND moving): the exact class cosmos Gate-B measured as a WebRender tile-cache
  defeat — plan the `body[data-engine="gecko"]` branch (blend→`normal`, alpha compensated,
  translate kept) as the LIKELY shape; the device round decides.
- **`.expensive-effect` does not exist in the shipping frontend** (it lives only in the committed prototype). M5/M6/glow gates
  are hand-authored `body[data-perf="lite"]` rules + `data-motion` gates (both stamped by the
  ui store).
- **Inactive tabs are free but phase-reset:** `.kit .tab{display:none}` kills CSS animations
  (Gecko too, FF39+) and they restart from frame 0 on activation — fine for loops. JS timers
  are NOT free: the carousel interval follows the cosmos precedent (`useTabActive("fleet")` +
  `visibilitychange`), **plus a new pause: don't auto-advance while the reel/transition
  runs**.
- **§14.11 violation found in the prototype:** `.banner-dots i{transition: width}` animates
  layout — port as `transform: scaleX()` on a fixed box (or a two-layer pill).
- **Wallpaper (M10):** host the layer on `.kit-main` — NOT `position:fixed` (breaks under any
  transformed ancestor), NOT absolute inside the scroller (repaints on scroll; kit.css:63-68
  documents this exact trap), NOT `background-attachment:fixed` (Gecko flicker bug 1418923).
  **The per-card `backdrop-filter: blur(2px)` (theme.css:20) is DELETED by design** — it is
  §14.11's "many blurred surfaces over one scroll area" verbatim, the frontier ruling calls
  stacked blur "the #1 Fennec jank source", and each card moves against the static wallpaper
  (re-blur per scroll frame). Replacement: raise card alpha `#14172fcc → ~e6` under
  wallpaper-on — visually near-zero delta over already-scrimmed art. The appbar's blur is the
  one blurred surface the theme affords.
- **Touch reality:** the card `:hover` shine + img zoom never fire on the owner's phone —
  give the shine a tap trigger (`:active` or the open gesture) at G1, eyeball-tuned.
- **The 60 fps budget table** (what may coincide): compositor-only = banner slide · reel
  slats/figure · shine sweep · wallpaper fade · oracle crossfade · nav indicator (safe
  together) — blend-composite = M5 (static, low) / M6 (moving — the Gecko risk) — paint-heavy
  = appbar blur while content changes beneath (afforded), animated blur/per-card blur
  (banned) — layout = the banner-dots width transition (converted). **Never coincide:** the
  reel with a banner auto-advance (pause the timer), M3's VT with the reel (§4.1), wallpaper
  + per-card blur + shine (resolved by the deletion).

### 10.4 Assets — fonts, images, serving (measured)

- **JP fonts: the naive path is REJECTED on measurement.** fontsource's numbered JP splits ×
  the 5 needed weights = ~550 KB raw (~150 KB gz) of pure `@font-face` CSS + **~757 KB of
  woff2 over ~72 requests** on first render (the frozen copy's 62 glyphs — 43 kanji + 19
  kana, ZKGN 47 / SMB1 15, measured against the packages' real unicode-range tables scatter
  across 21 dense chunks) + **31.3 MB / 1,188 files added to dist** (fontsource CSS
  references woff2 AND woff; Vite emits every referenced file; current whole dist is
  8.4 MB). The monolithic `japanese-*.css` entrypoints are worse (no unicode-range at all) —
  never use them.
- **ADOPTED strategy: a frozen build-time subset, committed** (the icons-script pattern):
  `scripts/gen-theme-fonts.mjs` (or a documented `pyftsubset` line) subsets the 5 weights to
  the theme's actual glyph set; outputs committed under the theme; **~39 KB estimated for all
  five JP subsets** (anchored on Google's own 50-glyph chunk sizes — measure at G0, the
  estimate is not a measurement) + the existing fontsource **latin** imports
  (vapor-fonts.css precedent) ≈ **~140 KB total, 10 files**. A **guard test** re-derives the
  glyph set from the theme's copy constants and fails if a glyph is missing from the subset
  manifest — that's what keeps "frozen copy" changeable later. Loading: the LAZY
  `themes/<t>/fonts.ts` pattern (cosmos/frontier — `loadFonts()` awaited by `switchTheme`
  before the skin flips → activation paints without FOUT; keep `font-display: swap`; skip
  `size-adjust` tuning). System-JP fallback stays in the font-stack only (Android has no
  reliable Mincho 600/800). **Degradation contract (council L12):** the guard test covers
  COMPILE-TIME copy constants only — any runtime/user-supplied JP text (host names, roster
  names) falls back to the system JP stack BY DESIGN.
- **PWA/offline (verified from the built artifact):** the SW precaches zero woff2 today and
  the repo has NO `runtimeCaching` — vapor's fonts + cosmos art rely on the browser HTTP
  cache offline (the vite.config comment claiming cosmos art is runtime-cached is WRONG —
  correct it in passing). Free win found: `**/*.html` sweeps `dist/stats.html` (290 KB build
  artifact) into precache — exclude it. Recommendation: add the repo's FIRST `runtimeCaching`
  routes — **`CacheFirst` for `/assets/*.woff2` (hashed, immutable) but
  `StaleWhileRevalidate`/`NetworkFirst` for `/api/media/` (owner-MUTABLE files — CacheFirst
  would pin a replaced image forever against the mount's `no-cache` semantics)** — unused
  themes cost zero install bytes but work offline once used (fixes vapor/cosmos too).
  **Council M8 re-slotted this: NOT a G0 rider — the routes land at G5 with their own gate**
  (they touch the PWA update path; the media caching posture lives there anyway). Only the
  `stats.html` precache exclusion stays a trivial G0 rider.
- **Images:** target table — capsule portrait 640×854 WebP q72 (~60–90 KB) · feat/wide
  1160×930/655 · banner 1240×700 q70 · wallpaper 720×1560 q55 (it sits under a scrim —
  quality is cheap) · reel cutout 720×1000 lossy-WebP-with-alpha (the 468 KB PNG → ~50 KB;
  verify Fennec decodes alpha-WebP at the device round). DPR cap 2; single format (no
  `<picture>`/AVIF pipeline for a LAN app). The prototype's `atlas.jpg` (3000×4257, 3.6 MB)
  decodes to ~51 MB of bitmap on the phone — the DECODE is the real cost, not transfer.
  LCP: first banner slide `fetchpriority="high" loading="eager" decoding="async"`; everything
  below the fold lazy; width/height attrs belt-and-braces over the aspect-ratio boxes (CLS
  already contained). Fade-in-on-load: set the flag from a ref callback checking
  `img.complete` (cached images never fire onLoad late), gate on the UIState motion axis.
  **Bundled art: NO maintained build script (council M8 — over-engineering for 7 fallback
  images that change only when the owner swaps art):** a documented one-shot `sharp` CLI line
  in the theme README produces the committed outputs; the owner's real art path is the runtime
  directory with no re-encode anyway. (The FONT subset script + guard test stay — justified by
  the measured 757 KB/72-req avoidance.) **User roster files get NO server-side re-encode**
  (Pillow = new runtime dep + an untrusted-decoder surface): a ~30-line stdlib magic-byte +
  dimension reader in the index endpoint gives the format allowlist AND lets the Conf gallery
  warn ("3000×4257, 3.6 MB — consider resizing").
- **Serving (verified against installed Starlette 1.3.1):** path traversal is handled
  (normpath + realpath + `commonpath` containment; `follow_symlink=False` rejects symlinks
  out of the root; the CVE-2023-29159 class is fixed). **The REAL hole is Content-Type**:
  `FileResponse` guesses from extension — an owner-dropped `evil.html` would serve as
  same-origin `text/html` = stored XSS with full API access. The mount therefore SUBCLASSES
  StaticFiles: extension→type ALLOWLIST (png/jpg/webp only, never `guess_type`), 404
  everything else, `X-Content-Type-Options: nosniff`. Cache: `Cache-Control: no-cache`
  (revalidate — Starlette already emits ETag/Last-Modified and answers 304s at ~200 bytes);
  `immutable` is reserved for hashed names. **Placement (council M9: namespace-generic):**
  under `/api/media/{ns}/` (gacha = the first namespace), registered before the SPA fallback —
  the existing `/assets` mount is prod-only and the Vite dev proxy forwards `/api` only, so
  this is the one placement that works in both profiles with zero vite.config change.
  **Three build-critical details (Codex round 3):**
  ① Starlette's `StaticFiles(check_dir=True)` RAISES at construction when the directory is
  missing — **ensure `$CTRLB_HOME/media/gacha/` exists before mounting** (the startup
  ensure-dir pattern the other `$CTRLB_HOME` workspaces use); ② split the prefix —
  `/api/media/{ns}` (the JSON index/metadata endpoint — it also returns the roster ENTRIES +
  slots, the §5.2 read path; host→entry assignment stays client-side per §5.3) vs
  `/api/media/{ns}/files/…` (the mount) — one shared prefix
  invites route-order collisions; ③ the slice ships backend tests for: missing dir at boot,
  traversal attempts, the extension allowlist + nosniff header, HEAD + 304 revalidation, and
  route ordering vs the SPA fallback.

### 10.5 Kit-integration obligations (the fence list — all verified file:line)

- **Bodies:** gated by `display:none`/`.active`; timers follow the cosmos
  `useTabActive`+`visibilitychange` pattern; M7 re-measures on activation (§10.2).
- **Layouts:** `defaultLayout:"3-tab"` = bar `[fleet,agent,conf]` + utils HOSTED in conf — a
  `bodies.utils` override would silently never render under 3-tab. **The layout fence
  (`layout.test.ts:69-85`): every registered theme must honor EVERY preset** — gacha must
  genuinely work under 2-tab (conf off-bar → **a DOCKED direct button; it floats only under
  the relevant appbar modes — Codex R4-9 corrected the draft's "floating NavMenu"; NavMenu
  itself stays icon-only, no sub-label rendering required**) and 4-tab (standalone Utils
  under gacha chrome); the user's device-local layout override makes this real, not
  theoretical. Boot coercion (utils→conf) exists. `TAB_SETS` gets a gacha row (carrying the
  RULED JP `subLabel`s — 編成/案内/設定 + ツール for Utils, Q8.6b) **+ an exact-copy test
  asserting all four sub-labels render in 4-tab mode** (Codex R4-9: existing layout tests
  select by IDs and would pass with every sub-label missing).
- **Composer skin — the D37 lock RULES this (a draft recommendation here was reversed on
  review):** D37 (DECISIONS) says themes must NOT style composer chrome directly — every new
  composer look becomes a SHARED, **look-named** catalog skin offered to every theme (D51
  reiterates; the plan-pin exception was narrow geometry fidelity, not a bypass of D37's
  composer authority). So: use an existing skin if fidelity permits; otherwise the catalog
  gains the look-named value **`arcade`** (the exact name, ruled — named for the look, never
  `gacha`), authored on semantic tokens only, and it legitimately appears in every theme's
  picker. A theme-scoped
  exception would need an explicit D52 amendment to D37/D51 — not proposed. Per-theme
  settings persistence is clean (`themeSettings[themeId]` — no bleed).
- **Lifecycle:** switch-IN is FOUC-safe (`ensureThemeLoaded` awaited before the flip) but
  **cold-boot into persisted gacha is NOT** (ThemeProvider loads in an unawaited effect; the
  index.html no-FOUC script carries only cosmos colors) — **✅ RULED (lock, → D52): gacha's
  `--bg` joins the documented default-mirror allowlist in the boot script** (the D51 V0
  pattern; one line, no flash). Switch-OUT
  cleanup ledger: `body[data-wallpaper]`/`[data-oracle]` attrs (set+delete in
  `useLayoutEffect`, the VaporRoot pattern), the reel node, the `#app-scroll` listener, the
  carousel interval, and any lingering `view-transition-name` (a leftover `capsule-shell`
  name would corrupt the THEME-SWITCH transition — `switchTheme` deliberately uses no names).
- **Contract obligations (`themeContract.test.ts`):** all 21 `CONTRACT_TOKENS` declared; a
  `TOKENS_RAW` arm; `CONTRACT_WAIVERS` stays `{}` (no exemption); Root renders in jsdom
  exposing `#app-scroll`/`.kit-composer`/`.kit-appbar` and a Fleet tabpanel whose cards are
  **`button[aria-label]`** elements; `defaultAccent ∈ accents`; settings defaults
  self-consistent; **stylelint gets a `src/themes/gacha/` override with `^gacha-` — every
  prototype keyframe is renamed** (`reel`→`gacha-reel` etc.). **Gacha declares
  `modes:["dark"]`** — the dossier's light sheet is a SURFACE, not a mode (a light MODE would
  additionally require `--accent-ink`).
- **E2E enrollment:** one row in `e2e/contrast-matrix.ts` (with `bar:["fleet","agent",
  "conf"]`) auto-enrolls kit-render + contrast; `a11y.spec.ts` and `layout.spec.ts` need
  hand-written gacha arms; `axes.test.ts` needs the theme-default arm (and relies on
  `phosphor` staying unregistered).
- **Found in passing (pre-existing LOW, fix as a G0 rider):** `ConfTab.tsx:2408` renders raw
  `themeVals?.[key] ?? default` bypassing `resolveThemeSetting` — a corrupt persisted seg
  value displays raw in Conf while the app resolves it to default.

### 10.6 The risk ledger (ranked)

| # | Risk | Status |
|---|---|---|
| 1 | Per-card backdrop-filter × N under the wallpaper-ON default (the #1 Fennec jank class) | **Resolved by design — deleted, card alpha raised** (§10.3) |
| 2 | VT `::view-transition-new(root)` liveness on Fennec 144 (decides the reel×M2 composition) | **✅ SETTLED 2026-08-04 — LIVE (outcome (a)); external-capture probe on desktop Gecko 151/152 + BCD single-implementation transfer argument (§10.1 verdict block)** |
| 3 | M6 scanline: moving + blended on Gecko (the cosmos Gate-B class) | Gecko branch pre-designed; device round decides (§10.3) |
| 4 | JP font weight (757 KB/72 req naive; 31 MB dist) | **Resolved by design — frozen subset ~140 KB** (§10.4) |
| 5 | Stored XSS via media Content-Type on the art mount | **Resolved by design — allowlist subclass + nosniff** (§10.4) |
| 6 | Reel × kit-fade double-animation; reel × banner timer; reel z-rung vs modals | Designed (§10.1/§10.3); **z-rung RULED: 45, no `.kit` stacking copy** (§10.1) |
| 7 | Phone-side image decode (3.6 MB source art ≈ 51 MB bitmap) | Pipeline + gallery warnings (§10.4) |
| 8 | Cold-boot FOUC into persisted gacha | **RULED: gacha `--bg` joins the boot-script mirror allowlist** (§10.5) |
| 9 | 2-tab/4-tab layout fence (must work outside the 3-tab default) | Named obligation + acceptance matrix (§10.5/§7) |

## 11. Council reconciliation (the lock session, 2026-08-02) — every finding ruled

*The council: ONE fresh Opus architecture lens over the full folded plan (verdict: **LOCK WITH
CHANGES**) + Codex `gpt-5.6-sol` round 4, a delta pass over the newly folded ruling material
(verdict: **READY WITH FIXES**). The two lenses conflicted nowhere material; both independently
caught the composer-ledger contradiction. Main-seat rulings below; findings are cited in place
throughout the plan as "council H#/M#/L#" (Opus) and "Codex R4-#".*

| # | Finding | Ruling |
|---|---|---|
| H1 (Opus) | `theme_gacha:` top-level = the banned sibling-map shape; roster read path undefined | **ACCEPTED** — `themes: {gacha: {…}}` (D48 `providers` precedent) + the media index endpoint returns the RESOLVED roster (§5.2) |
| H2 (Opus) = R4-2 (Codex) | §4.9 ledger still authorized a D37 bypass (theme-scoped composer CSS) vs §10.5's ruling | **ACCEPTED** — ledger row + §3 pinned to the look-named shared `arcade` skin; G3 budgets the cross-theme picker cost |
| H3 (Opus) | The dossier lost the host ACTION BAR (unspecified UI on the fidelity path; promo-click→wake depends on it) | **ACCEPTED** — G2 gains the action bar as a named fidelity design checkpoint (§4.8) |
| M4 (Opus) | Shared-kit edits scattered across slices | **ACCEPTED WITH NUANCE** — G0 opens with the kit seams unit (brandText·subLabel·runViewTransition, extraction-then-delta); the composer skin STAYS at G3 (self-contained catalog value; designing it needs the gacha tokens in place) but is ledgered shared-scope with its own review flag |
| M5 (Opus) = R4-8 (Codex) | Star mode had two config homes | **ACCEPTED** — `starMode` ThemeDef setting is the single home; `stars:` deleted from the YAML (§5.2/§6.1) |
| M6 (Opus) | Third byte-similar host-detail derivation | **ACCEPTED** — pure derivation extracted to `lib/` at G2; markup stays per-theme (D31 band intact) |
| M7 (Opus) | Tokens authored across G0–G4 make G6's five variants a repaint | **ACCEPTED** — stylelint no-literal-colors-outside-tokens.css rule at G0 |
| M8 (Opus) | Two over-engineered riders (SW runtimeCaching at G0; gen-theme-art.mjs) | **ACCEPTED** — routes move to G5 with their own gate; art script becomes a documented one-shot CLI line; font script + guard test STAY (measured justification) |
| M9 (Opus) | Theme-shaped media mount won't age | **ACCEPTED** — `/api/media/{ns}/` over `$CTRLB_HOME/media/<ns>/`, gacha first; flagged to the owner (the ruled option-(b) SHAPE is unchanged; the literal path moved from `art/gacha/`) |
| M10 (Opus) | G0/G4 both claimed the reel | **ACCEPTED** — G0 = mechanism/slats/spike; G4 = figure + composition |
| L11 (Opus) | Reel z-rung must be a D52 ruling | **ACCEPTED** — z 45, no `.kit` stacking-context copy (§10.1) |
| L12 (Opus) | JP-subset degradation contract unstated | **ACCEPTED** — compile-time constants only; runtime JP falls back to the system stack by design (§10.4) |
| L13 (Opus) | Base-ramp variants overload `data-accent` slightly | **ACCEPTED AS-IS** — a second selection mechanism would be worse; the picker labels honestly |
| R4-1 (Codex, HIGH) | The online-only "escape hatch" let an implementer narrow the ruled promo membership | **ACCEPTED, REWORDED rather than deleted** — membership (all hosts) is the ruling; crowding is solved by presentation; narrowing is an OWNER-only eyeball call (the owner explicitly offered to talk about it — deleting the knob entirely would over-rule the owner) |
| R4-3 (Codex) | hosts>roster had no deterministic rule | **ACCEPTED** — ordered cycling; placeholder reserved for empty roster/unusable file; ONE shared resolver (§5.3) |
| R4-4 (Codex) | Slide identity by index breaks under membership churn; error-state collapsed the carousel | **ACCEPTED** — key by `"hero"`\|`host.id`, buffered reconciliation, nearest-survivor; background errors keep the last good set (§6.4) |
| R4-5 (Codex) | Gesture heuristic → full state machine | **ACCEPTED** — idle→pending→horizontal-drag, direction lock, pointercancel/capture-loss/unmount handling, onClickCapture suppression (§6.4) |
| R4-6 (Codex) | Timer/reel semantics ambiguous | **ACCEPTED** — one-shot timeout, full-cadence restart on ANY interaction end (no stored remainders — leaner than the suggested matrix), banner rejects input during the reel (§6.4) |
| R4-7 (Codex) | Offscreen promo buttons keyboard-reachable; dots unbounded | **ACCEPTED** — inert inactive slides, labeled dots + `aria-current`, hero-only = no dots/autoplay, >8 slides → counter (§6.4) |
| R4-9 (Codex) | 2-tab NavMenu description inaccurate; sub-labels untested | **ACCEPTED** — docked-direct correction + the exact 4-tab sub-label test (§10.5) |
| R4-10 (Codex) | "Frontier grid" reused literally would render live `up/total` Services | **ACCEPTED** — exact value table pinned; Services = CONFIGURED count (§4.8) |
| R4-11 (Codex) | Stale open-question references survived the fold | **ACCEPTED** — swept (§0, §7 header, §8 residuals, §9); FOUC + z-rung recast as D52 rulings, both now RULED in §10.1/§10.5 |

**Sound per both lenses (no action):** the bespoke-body routing, chat-hook reskin,
`modes:["dark"]`, the layout-fence posture, the §10.5 contract/e2e enrollment list, the
two-family palette structure on the shared accent axis, the 5★ fold's consistency, and the
transform-only banner mechanics.
