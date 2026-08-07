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
stays in `brandMeta` either way. **RE-RULED 2026-08-06 (owner, from live side-by-side renders of
both strings): コントロール・ビー wins** ("the one with the dot in the middle — it looks
better") — G6 swaps the shipped カプセルアーケード string; subtitle unchanged.

**4.4 Palette variants (R9) — ✅ RULED Q8.5: two families, five variants. AMENDED at the G6
pre-build rulings (owner, 2026-08-06, from live renders): TWO INDEPENDENT PICKERS — the theme
ACCENT picker ships SEVEN variants (families 1+2, all four shifter candidates kept; an EIGHTH —
**jade**, green-leaning family-2 — added at G6.2 the same night, owner-asked to pair with the
cool dossiers; the §7.7 G6.2 addendum), and the
DOSSIER gets its OWN picker (family 3: the light slip + the four dark palettes; +2 MORE cool
darks at G6.1 same day — cyber-teal · forest-green, the §7.7 G6.1 addendum).**
**THE CARVE-OUT MECHANISM, SHARPENED at G6.2:** the "trio never touches status chrome" rule is
NOT a hue-distance test — jade's slot 3 sits 32.5° from ok-green (the same distance glacier's
UN-pinned far stop ships at) and fires anyway, because under a GREEN trio the ONLINE lozenge
(`--gc-online-fill`) and the NEW ribbon (`--gc-brand-fill`) become the same green→cyan object
on one capsule card — one live status, one decoration. The operative rule: **if the trio's
family makes brand chrome and status chrome read as the same object, pin `--gc-online-fill` +
`--gc-caption` off the trio** (arcade's verified values); clearance numbers inform, the
object-identity test decides. The registry
models the accent axis natively: `ThemeDef.palettes.accents` (`{id, label, swatch}` list +
`defaultAccent`) feeds the SHARED `data-accent` axis (D51 V2: one axis, every skin) — each gacha
"accent" is a tokens.css block. The dossier axis is gacha-private: a per-theme settings row
(§14.3 pattern, like `starMode`) driving `body[data-gc-dossier]`; rendered as color chips via a
small ADDITIVE shared extension — an optional `swatch?` on seg options (the D51 additive-slot
idiom; themes without it byte-identical — ledger entry in §4.9). The axes are disjoint in WRITES
— accent blocks never write `--gc-dossier-*`, dossier blocks write only `--gc-dossier-*` (which
REQUIRES minting `--gc-dossier-kicker`; the old scheme had each palette writing the non-dossier
`--gc-unit-no`, the known trap — slip keeps today's value) — but the dossier surface READS four
accent/global things by design (Codex G6-plan R1): the top strip (`--gc-brand-fill`), slip's
sticker action button (`--accent-fill`/`--accent-ink` + `--gc-act-shadow`), and the star badge
(`--gc-star*`). So the contrast gate grows additively (7 accent rows + 5 dossier rows), PLUS one
bounded cross-axis check per crossing: strip + star badge legibility probed on every dossier
sheet, slip's button on every accent (they are the only paints that vary on both axes — not a
7×5 matrix). The ruled set:
- **Family 1 — base-ramp variants (trio CONSTANT — it stays the brand):** **arcade** (the
  prototype as-is, default) · **midnight** (deeper, blacker navy; less purple in the radial) ·
  **indigo** (bluer, colder surfaces). These re-tint only bg/surfaces/radial ("the dark
  blue-ish stuff"). Midnight/indigo have NO pinned hexes — like eridu's re-derivation they are
  BUILD-DERIVED under the stated identity + the recipe below, recorded in the as-built and
  judged at the owner device round. Derivation color space for every lighten/darken/mix in the
  recipe: **plain sRGB linear interpolation toward #fff/#000/the-partner** — the 2026-08-06
  render pass reproduced the shipped arcade literals in it to within rounding (VERIFIED), so it
  is the space that round-trips. Each variant's block must also state its own
  `--gc-display-shadow` (a deep tint in its radial's family — eyeball-tuned, recorded).
- **Family 2 — accent-SHIFTING variants that move the pink→violet→cyan trio too**, informed by a
  research pass over popular gacha games' real UI palettes (Opus pass, 2026-08-02; main seat
  re-computed and CONFIRMED every quoted contrast ratio). **RULED 2026-08-06 (owner, after a
  live-render pass — all four candidates screenshotted on the running theme, phone viewport):
  ALL FOUR ship** — "a bunch of variety could be good" — with ONE revision: **eridu's trio is
  RE-DERIVED toward the green/blue side** ("keep it more on the side of the green and the blue
  instead of going all the way to pink; make the gradient less convoluted") — drop the pink
  `#ff5cd0` end, re-walk blue→cyan→green monotonically, same L≈60–72 band + ≥25° gold/warn
  clearance rules as the original derivation. The render pass narrowed its lime blocker to a
  MECHANISM: two brand consumers put trio color on status chrome — `--gc-online-fill` (its far
  stop = trio slot 3) and `--gc-caption` (`lighten(b3,.43)`) — so if the revised trio still ends
  lime-adjacent, eridu's block pins EXACTLY those two tokens off the trio (the "trio never
  touches status chrome" carve-out; the other three candidates need no carve-out). The revised
  trio's hexes, measured hue/lightness walk, gold/warn clearances, and whether the carve-out
  fired are RECORDED in the G6 as-built before the device round. Render-pass
  verdicts on the rest (VERIFIED on device-size renders): ember = the strongest shift, one
  device-eyeball item (its ONLINE ribbon becomes green→violet, the widest hue jump in the set);
  glacier = cleanest cold read, its tri-strip reads as ~2.5 colors at small size (caution
  confirmed, accepted); nebula = barely a shift from arcade but KEPT (owner likes it; variety).
  Field finding worth keeping: almost no
  major gacha uses a three-color gradient brand — they run ONE hero hue on near-neutral dark
  (Genshin/WuWa warm gold · Blue Archive/Arknights signal blue · HSR pastel violet · ZZZ
  black/white+neon) — so each candidate is a monotonic hue walk re-derived around a field
  identity, L≈60–72, ≥25° hue clearance from star gold `#ffd464` and warn `#ffc76a`.

  | Candidate | Trio (pink→violet→cyan slots) | Base ramp (bg · card · radial) | Provenance / caution | Worst contrast |
  |---|---|---|---|---|
  | **ember** (warm) | `#ff6f52` `#ff4f93` `#c46bff` | `#120b18` · `#1e1433` · `#5b2350→#2a1330→#100810` | Genshin/WuWa warm-metal-on-dark + HSR Fire/Lightning; gold deliberately NOT in the trio (stars own it). Don't warm slot 1 past H 10° (warn-pill clearance) | 5.65 on card |
  | **glacier** (cold) | `#7c6cff` `#2fb8ff` `#79f2e6` | `#070d1c` · `#101a33` · `#1d3f7a→#0d1730→#05080f` | Blue Archive logo blue `#128AFA` lifted + Arknights crystalline-clinical + HSR Quantum/Ice. Tightest hue walk (63°) — verify the tri-strip still reads as three colors at small size on device | 4.47 on card |
  | nebula (soft) | `#eb77ea` `#9c96f4` `#5ec7db` | `#0c0a1c` · `#171634` · `#43276b→#141334→#08070f` | HSR's own in-UI element chips verbatim (Lightning/Quantum/Ice) — pastel-celestial. Weakest SHIFT: same hue arc as arcade, mainly desaturated — a calm-eyes option, not range | 6.73 on card |
  | eridu (loud) | `#ff5cd0` `#3ff0ff` `#b4ff4a` | `#0a0a12` · `#12141f` · `#26305e→#0f1120→#06070c` | ZZZ black/white+neon signage + NIKKE HUD contrast. **Semantic blocker: the acid lime competes with ok-green `#74f3ad` for "host is up"** — only shippable if the trio never touches status chrome. **RE-DERIVE per the 2026-08-06 ruling above (green/blue walk, pink end dropped) before shipping; base ramp may keep** | 6.72 on card |

  **The variant-block RECIPE (2026-08-06 render pass, VERIFIED against the shipped tokens.css —
  this is what a `body[data-accent]` block must contain).** The six base tokens are
  `--gc-brand-1/2/3` (trio) · `--bg` · `--surface` (card) · `--gc-backdrop` (radial).
  `--gc-brand-fill` and `--accent-fill` are `var()` formulas — they re-derive free. Everything
  below is a FUNCTION of the base six and must be re-derived per variant or the block silently
  shows arcade pink/cyan beside a new trio (ratios = the shipped arcade literals, re-computed and
  confirmed by render):
  `--surface-2` = lighten(card,.02) · `--gc-bar`/`--gc-bar-grad` = mix(bg,card,.5)+alphas ·
  `--gc-bar-grad-wall`/`--gc-pill-bg`/`--gc-wallpaper-scrim`/`--gc-slide-scrim` = new bg, same
  alphas · `--gc-card-wall`/`--gc-composer` = new card (+e6) · `--gc-card-scrim` =
  darken(bg,.08)e6 · `--gc-bubble-bot` = lighten(card,.08) · `--gc-heading` = lighten(b1,.23) ·
  `--gc-caption` = lighten(b3,.43) · `--gc-online-fill` = 92deg #74f3ad→b3 · `--gc-reel-slat` =
  b1→b2→b3 · `--gc-switch-fill` = 90deg b1→darken(b2,.06) · `--gc-ind-shadow`/
  `--gc-bubble-user-shadow`/`--gc-dot-shadow` = b1(+99) · `--gc-banner-glow` = b1-4d + b3-3d ·
  `--accent` = var(--gc-brand-1) · **`--gc-display-shadow`** (arcade's violet `#1b1030` — NOT a
  formula today; each variant states its own). Held constant across variants:
  `--ok --warn --danger --gc-star* --gc-tag-ink --gc-online-ink --gc-nav-ink --gc-ind-fill` +
  every hairline. **`--gc-dossier-*` is deliberately ABSENT: the dossier is the other picker's
  scope.** (The re-runnable render lab: session scratchpad `shifter-previews/candidates.mjs` +
  `render.mjs` — a tool for the pick, not repo material.)

**Family 3 — the DOSSIER SURFACE (owner session 2026-08-04, Opus). SCOPE: dossier-only.** Distinct
from families 1 and 2 above, which re-tint the WHOLE theme — the owner ruled this exercise
**dossier-only**, so these move `--gc-dossier-*` and nothing else. Global `--accent-fill` /
`--gc-brand-fill` were explicitly off the table.

**The dark trial is ✅ SIGNED OFF (owner, 2026-08-06, from the example images) — as a PICKER, not a
flip.** The dossier picker ships FIVE options: **slip** (the shipped G2 light sheet, unchanged —
G2's identity survives as an option) + the four dark palettes below; **default = neon-purple**
(the owner's favorite — "the first top-left image… I like the button there"). Per-option rulings:
- **Action buttons:** the four DARK palettes take the flat example button, styled after the
  **NEON-PURPLE panel specifically** — re-measure THAT panel and apply its treatment (including
  its 1px top highlight and fill-gradient shape, which the earlier measurement pass had excluded
  as "not the design language" — the owner wants precisely that look) with each palette's fill/ink
  from the table below. **Slip KEEPS its current sticker-style button** — each identity stays
  coherent (so the `.gc-act` replacement rules are scoped to the dark options only, and
  `--gc-act-shadow` stays LIVE for slip — the former G6-row "single migration" of it is
  superseded).
- **Service-row dots go VAPOR-STYLE** (owner: "vapor has decorative colors for the dots… brighter,
  and quite dim when the service is down — they still carry real status"). The precedent is
  vapor's `.svc-row .led` (vapor.css: up = brand magenta + `--m-glow`, down = dim `--ink-faint`,
  no glow). Gacha's version: two tokens per dossier palette — led-up = the palette's accent,
  bright (+ subtle glow on the darks), led-down = dim neutral. This REPLACES the current
  ok-green/warn-amber dot pair; the "whole list dims when the unit sleeps" behavior falls out
  naturally. **BOTH states must clear the 3:1 non-text floor on their card, on ALL FIVE
  palettes** (Codex G6-plan R2: on a port-bearing row the dot is the ONLY visible status cue —
  the port slot shows `:8080`, not "offline", and the aria-label is not visual redundancy — so
  no sub-floor exemption). "Dim" is achieved by killing the glow and dropping
  saturation/brightness RELATIVE to led-up, not by dropping under the floor. Tokens (per
  palette, slip included): `--gc-dossier-led` / `--gc-dossier-led-dim`(+ the glow rides led-up
  on the darks only). This supersedes the shared `-ok #74f3ad` · `-warn #ffc76a` row in the
  table below FOR THE DOTS — those tokens remain only if a non-dot dossier consumer still reads
  them at build time (verify; delete if orphaned — no dead tokens).
- **The tri-gradient top strip stays** for now on ALL five (owner, skeptical: "I have the feeling
  it wouldn't look too good, but let's see how it looks" — a device-round item, not a build item).
  It reads `--gc-brand-fill`, so it follows the ACCENT picker, tying the sheet to the theme.
- **Star badge: keep as-is for now**; the design gets its own look later (owner, 2026-08-05).
- Why this was once gated on an explicit trial (2026-08-04, historical): going dark reversed G2's
  one-light-surface identity ("an arcade prize slip pulled out from under the night-time cabinet").
  Shipping dark **as a picker** dissolves that objection — the slip identity survives as an option
  rather than being replaced. Measured consequence worth keeping: **dark makes contrast EASIER.**
  Every tight margin in this theme lives on the light sheet — the 2.62:1 Shut-down bug fixed the
  same day, `--gc-unit-no`, and the retired `--gc-dossier-danger` all exist because literals had
  to be deepened for it.

The four the owner shortlisted, sampled from `design/prototypes/gacha/dossier palette example.png`
(4x2 panel grid at `(14 + 384c, 40 + 506r)`, 347x440) and NORMALISED so every gated pair passes:

  | palette | sheet from→to | card | action fill stops (direction per the neon-purple authority below) | on-fill ink | accent ink | kicker |
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

  **THE PICKER CONTRACT (2026-08-06, Codex G6-plan R6 — pinned so no two agents invent it
  twice; AMENDED at G6.1, owner 2026-08-06 evening: "more variety … in line with any of the
  color palettes that are left" ⇒ TWO MORE dark options appended from the example's remaining
  panels).** Setting key **`dossierPalette`** (gacha `settings` map, type `seg`), default
  **`neon-purple`**, options in this order:
  `slip` ("Slip") · `neon-purple` ("Neon") · `sunset-orange` ("Sunset") · `rose-pink` ("Rose")
  · `aurora-violet` ("Aurora") · `cyber-teal` ("Teal") · `forest-green` ("Forest") — each with
  `swatch` = its action-fill start hex (slip's = its paper sheet top `--gc-dossier-from`
  value); value lands as `body[data-gc-dossier="<id>"]`
  (absent/`slip` = today's rules untouched). *(G6.1 pick rationale + the measured panels: the
  §7.7 G6.1 addendum. amber-gold was passed over — its accent is ΔE 9.5 from `--gc-star`, the
  eridu-carve-out collision class on the very surface that carries the stars; midnight-blue
  sits inside neon/aurora's hue family. One block + one option row reverts either call.)* Each DARK option's tokens block sets, from its
  table row + the shared list: `--gc-dossier-from/-to/-card/-ink/-ink-2/-line/-badge/
  -art-shadow` + minted **`--gc-dossier-kicker`** (its kicker column) + **`--gc-dossier-accent`**
  (its accent-ink column) + **`--gc-dossier-led`/`-led-dim`** (per the dots bullet) +
  **`--gc-dossier-close-bg`/`-close-ink`** (the mock's dark disc + light glyph — fixes the
  known white-blob inversion) + **`--gc-dossier-act-fill`/`-act-ink`/`-act-rim`/`-act-hi`**
  (the neon-purple-treatment slots, per-palette fill/ink) + its own **`-shadow`** and
  **`-blank`** (slip's current values are light-tuned — each dark states both). Slip's block
  is EMPTY — it is the absence of an override, not a fifth copy.

**The ACTION BUTTON, measured from the example (same session).** The owner asked for "as close as
possible" to the mock. Four of my own measurements were wrong before this settled — recorded so the
next reader does not repeat them:

- The bright 1px top highlight exists **only on the neon-purple panel**; the other seven have none.
  ~~It is NOT the design language. Same for the 20% vertical fill gradient (neon-purple again).~~
  **INVERTED 2026-08-06: the owner picked the NEON-PURPLE panel's button as THE look** ("I want
  that look… I like the button there"). **The single authority for the shipping dark buttons is
  a fresh measurement of the NEON-PURPLE panel, taken at G6 build time and recorded in the
  as-built**: its fill gradient (direction AND stops — this panel carries the ~20% vertical
  component the others lack), the 1px top highlight (color/opacity, and measured as DISTINCT
  from the 1px rim — two elements or one), radius, and rim luminance. That treatment then
  applies uniformly across the four dark palettes with each palette's fill/ink from the table.
  Every measurement bullet below (incl. "the fill gradient is HORIZONTAL") describes the OTHER
  seven panels — lore for the reader, NON-AUTHORITATIVE for the shipping buttons.
- The fill gradient is **HORIZONTAL, not vertical** — median −39% left→right against −4.6%
  top→bottom. A vertical sample reads it as flat.
- Box is **176 x 39 CSS px** (an earlier "195" sampled across the gap into the second button), and
  `.gc-act` inherits the kit's unitless `line-height: 1.5`, so a 10px label is a 15px line box —
  12px padding gives 41px, not 39. Use 11px.
- Radius **4.6px**; it only *looks* rounder in a side-by-side if the mock is upscaled.
- The rim is **1.10x the fill's luminance** — a whisper. A `color-mix(fill 78%, white)` is ~2x and
  visibly wrong; 90/10 lands right.

  So the example's GENERIC primary (the seven non-selected panels — superseded for the shipping
  buttons by the neon-purple authority above) is: flat-ish horizontal gradient · ~5px radius · a
  1px rim a hair lighter
  than the fill · **no elevation at all** · white or dark label per the table above. The secondary is
  transparent with a muted accent border. The press has no offset to sink into, so both buttons drop
  the sticker translate for an opacity change — and note the generic `.gc-act:active` in gacha.css
  still slides the SECONDARY 3px unless it is replaced, not merely overridden on `.primary`.

  **This REPLACES the theme's sticker language on the DARK dossier options only** (the nav
  indicator, user bubble and arcade composer keep it everywhere; **slip keeps the sticker button
  too — 2026-08-06 ruling above**). `--gc-act-shadow` therefore STAYS LIVE (slip uses it); the
  former G6-row "single migration" of it is superseded — the flat-button rules live under the
  dark `body[data-gc-dossier]` values instead.

**Two rules the dark flip BREAKS that no token edit covers** (both found by rendering, not by
reading):
1. `--gc-unit-no` — the deepened rose minted for the LIGHT sheet measures **2.94** on a dark one, and
   it is not a `--gc-dossier-*` token, so a dossier-family sweep misses it. **CLOSED by the picker
   contract above: the kicker consumer moves onto minted `--gc-dossier-kicker` (slip's value = the
   current `--gc-unit-no` rose), each palette's block sets its own** — the write-disjointness rule
   then holds with no exception.
2. `.gc-dossier-close` composes `background: var(--gc-dossier-ink)` with `color: var(--gc-dossier-from)`
   — correct when ink is dark and sheet light; flipping the tokens turns the disc into a white blob.
   It needs its own pair (the mock's is a dark disc with a light glyph).

**Still unfinished on these four** *(2026-08-06 status: the first two are RULED above — strip
kept as-is for now, badge kept as-is for now — so what remains is G6 BUILD verification, not
owner input)*: the sheet's top brand strip and the star badge still carry light-sheet values
(verify they read acceptably on each dark palette; the strip ruling is keep-and-judge-on-device),
and the state sheet (active / focus-visible / **disabled**, a flat `opacity: 0.42` that moves
every ratio at once) has not been rendered on a dark surface — G6 renders and gates it.

**The lab that produced all of this** lives in the session scratchpad (`palette-lab/`:
`candidates.mjs` + `render.mjs` + `palettes.json`), NOT in the repo — it drives the real running dev
app via Playwright, injects candidates inside the same `@layer theme { @scope … }` as production
(unlayered injection outranks the theme and would flatter a losing rule), mocks `/api/appearance` and
aborts every non-GET `/api/**` with a counter that read **0** on every run. Re-runnable, but it is a
tool for one decision — do not promote it into the repo without a reason.

  All four clear the 3.0 probe bar everywhere, and every candidate's WORST trio-on-card ratio
  beats the shipped arcade trio's own weakest link (`#805cff` on card = 4.10, re-computed).
  Gold stars + ok/warn status hexes stay constant across all variants.

**Gate coverage (2026-08-06, Codex G6-plan R4 — the e2e matrix must be able to EXPRESS the
promise before it can keep it).** Every shipping variant on BOTH axes passes the §14.15.1-⑨
probe. The current harness (`e2e/contrast-matrix.ts` rows = theme/mode/accent;
`contrast.spec.ts` seeds only those axes) has NO dossier dimension — G6 extends the row schema
with an optional per-theme settings seed (`settings: {dossierPalette: "<id>"}`), giving **7
accent rows (dossier at default) + 5 dossier rows (accent at default) + the bounded cross-axis
checks named at the top of §4.4**. The dossier rows' THEME_PAIRS additions: act-ink/act-band
(sampled over the CENTRED label band per the gate method — the pair schema gains a band-sample
mode; the existing every-stop rule stays for non-centred-label pairs) · led/card and
led-dim/card (both ≥3:1, all five) · close-ink/close-bg · kicker/sheet · ink & ink-2/card ·
secondary label & border/card · star badge vs `-badge`. **Disabled controls are
contrast-EXEMPT** (WCAG's own carve-out; the flat 0.42 sheet is rendered for the owner eyeball,
not gated); focus-visible IS gated on each dark.

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
"04 / 04" counter counts, and the `NEW` ribbon (no live field exists) — all ruled in §8 (Q1/Q10;
the ribbon since superseded by the G6-row demo ruling, 2026-08-06). And the
**shared-extension ledger** — every place the port touches SHARED kit scope, named up front (the
D51 discipline):
| Extension | Scope | Posture |
|---|---|---|
| `brandText` slot (**committed** — the §4.3 katakana ruling needs it) | kit AppBar, the D51 `brandMark` idiom: `brandText ?? "ctrl·b"` | one prop + fallback; other themes byte-identical |
| `subLabel` on the tab definition (**committed** — the Q8.6b keep ruling needs it) | `TAB_SETS`/tab-def shape + kit NavBar render | optional additive field; themes without it byte-identical; the CSS-attr alternative rejected (labels are data) |
| `swatch?` on seg-setting options (**committed 2026-08-06** — the §4.4 dossier picker renders color chips) | the FULL render path (Codex G6-plan R7): `theme-engine/types.ts` seg options + ConfTab's settings-option mapping (it currently STRIPS unknown fields) + the shared `Seg` component (it owns option markup and renders only `{val,label}` today) + shared seg styling + tests | optional additive field typed `swatch?: string \| string[]` (the accents idiom reused — "a swatch is DATA for the chip"); seg rows without it render byte-identical, NO extra DOM node when absent |
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

**6.2 Star colors — AS BUILT (2026-08-06 correction: no longer a draft).** 5-star mode: ★1–3
gold (`#ffd464`), ★4–5 pink-gold — **shipped as `--gc-star-hi: #ff8fa8`** (tokens.css, the
owner-picked device value). 3-star mode: ★1–2 gold, ★3 rosy. Sleeping cards keep the
de-saturation. Tokens, not hardcodes. **G6 holds these constant** — it only verifies the badge
composite on the dark dossier palettes, it does not re-open the colors.

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
| G0 | **The settle-everything slice (Codex sequencing ruling: no Fleet JSX until these are pinned; recipes = §10).** **First, the KIT SEAMS UNIT as ONE reviewable, revertible commit (council M4):** `brandText` + `subLabel` + the `runViewTransition` extraction (behavior-identical extraction + test FIRST, the `.finished`/token-guard hardening as a labelled delta on top — it touches the daily theme-switch path). Then gacha-private: theme registration (`ThemeId` + registry row) + `defaultLayout: "3-tab"` + `TAB_SETS` row (JP sub-labels) · tokens.css (semantic extraction from theme.css; **the stylelint `src/themes/gacha/` override enforces `^gacha-` keyframes AND no literal colors outside tokens.css** — council M7, what keeps the palette variants — five then, seven + the dossier five since the 2026-08-06 re-ruling — a repaint-free G6) · fonts per §10.4 (**generate + measure the frozen subset**, guard test, lazy `loadFonts`) · settings descriptors (`starMode` default `five` + R6 defaults) · **the §10.1 device SPIKE** (VT-new liveness on the owner's Fennec → the M2 verdict; **G0 owns the reel MECHANISM: overlay mount, slats, passive start, spike verdict — the figure is G4's**, council M10) · the roster schema + resolver (§5.2/5.3 incl. cycling, resolving against the BUNDLED set) · the star ladders (§6.1, ruled) · riders: `stats.html` precache exclusion (§10.4; the `runtimeCaching` routes MOVED to G5 — council M8) · the ConfTab raw-value LOW (§10.5) · the kit-fade re-tune under gacha (§10.1). Palette VARIANTS stay unexposed until G6 | gate + kit-render e2e joins + the spike verdicts recorded |
| ✅ G1 | **BUILT + OWNER-EYEBALLED 2026-08-02 (as-built §7.2)** — bespoke Fleet: banner (carousel + glow + live rate pill w/ §6.3 loading semantics + the §6.4 slide set **incl. the eyeball-ruled SCENE slides**) + capsule track (cards/states/plates/shine + stars) + wallpaper + the geometry rule + the owner's own art in the bundled set | owner eyeball ✅ (3+ live rounds) |
| ✅ G2 | **BUILT + OWNER-EYEBALLED 2026-08-02 night (as-built §7.3)** — dossier sheet (light inversion + the ruled grid + live service rows + the H3 ACTION BAR) + **the M3 capsule→dossier morph, owner-PULLED from G4 and made to visibly work** + swap morph + visible × + tap-outside close + **the full-screen ART SHOWCASE (owner ask)** — M6 extraction to `lib/hostDetail.ts` landed first; contrast gate gained the dossier's THEME_PAIRS rows | owner eyeball ✅ ("looks good", pushed) + contrast probe ✅ (48-combo matrix) |
| ✅ G3 | **CLOSED 2026-08-04 (as-built §7.4; commits `6c5298d..5ce33d7` + the side-session re-rule `ba0b8b1`/`d65e7b7`) — device round PASSED wholesale, Gecko scanline branch NOT needed.** GachaAgent body (oracle two-FACE crossfade — art+scrim+name ghost as ONE surface, owner-ruled; pin `top: var(--appbar-h)`, owner-ruled) + the shared catalog's `arcade` composer skin (measured: no existing skin faithful) + bubble polish + the owner's four live findings + the Codex wave (plan-pin regression, the UN-RUNGED-header stacking fix, M7 stale-base remeasure, safeRafLoop fault latch). Device checks owed: M7 blur on Fennec · 12.5px read comfort · pin across appbar modes · the flat composer · M6 scanline on Gecko | eyeball + device check (PENDING) |
| ✅ G4 | **CLOSED 2026-08-04 (as-built §7.5; commits `dd1a056..fa86ed3`) — owner round PASSED on phone + desktop, 67% default kept, M2 device-confirmed.** The reel FIGURE (67% tunable default, all dials `--gc-figure-*` tokens, corrected baked glow — drop-shadow's length IS σ, §7.5 lesson) + M2 shipped prototype-exact with the seam promoted (flag deleted) + the type-scoped VT skip + degradation latches. Codex: READY WITH FIXES → wave → confirm all-resolved, residual LOWs closed | owner figure eyeball + Fennec+Chrome device round (incl. the one-line M2 check) |
| ◐ G5 | **BUILT + REVIEW-COMPLETE 2026-08-05 (as-built §7.6; commits `ac621ed..8f6297a`) — OWNER FILE-DROP + GALLERY ROUND = the open gate.** The namespace-generic media surface per the ruled option (b): hardened read-only mount + per-role index (+`revision`), the `ThemeDef.media` gallery, the first SW runtimeCaching, per-namespace DEGRADE-NEVER-BRICK health, the reel-pool pin ruling. Codex arc: NOT READY → 2 waves + final → closed | owner file-drop + phone gallery round |
| ◐ G6 | **BUILT + REVIEW-COMPLETE 2026-08-06 (as-built §7.7; uncommitted at write time, committed same day) — OWNER DEVICE ROUND = the open gate, then v1.5.0.** Per the 2026-08-06 pre-build rulings (all §4.4): TWO PICKERS. (i) ACCENT picker, SEVEN variants: arcade/midnight/indigo + ember/glacier/nebula + the RE-DERIVED eridu (green/blue walk) — each one `body[data-accent]` block per the §4.4 variant-block recipe + a `palettes.accents` row + a `contrast-matrix.ts` row. (ii) DOSSIER picker (gacha settings row → `body[data-gc-dossier]`, seg + the additive `swatch?` chip extension): slip (unchanged, keeps sticker button) + neon-purple (DEFAULT) · sunset-orange · rose-pink · aurora-violet with the neon-purple-panel flat button (re-measured, highlight included), vapor-style led/led-dim service dots, per-palette kicker + close-disc pairs, top strip kept. (iii) Wordmark swap → コントロール・ビー (§4.3). (iv) NEW-ribbon DEMO on ONE random host card (no semantics, no data seam — owner decides keep/drop/meaning at the device round; the pick is made ONCE per Fleet mount and sticks until that host leaves the fleet — never re-rolled on poll re-renders; empty fleet = no ribbon). (v) Dark-surface verification: disabled/focus/active state sheet + brand strip + star badge rendered on the darks. Dots-close-dossier: RULED KEEP (2026-08-06) — off the open list | owner device round (eyeball-heavy BY NATURE — budget several rounds, the G0 lesson) |

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

**§7.6 — G5 AS-BUILT (2026-08-05; ✅ code + reviews COMPLETE — ⏳ owner file-drop + gallery
round pending).** Eleven commits `ac621ed..8f6297a` (4 build + 4 wave-1 + 2 wave-2 + 1 final);
end state **BE 1301 (+47) / FE 1404 (+41) / 205 e2e**, gate green per commit; every security
behavior live-verified against the dev backend (hostile drops, traversals, symlinks, the
role-file collision). The record:
- **B1 backend:** `core/media.py` (namespace/role registry · the one collation
  `casefold-natural` · the bounded stdlib magic-byte+dimension prober · `ensure_media_dirs`) +
  `api/media.py` (`MediaFiles(StaticFiles)`: extension→type ALLOWLIST set-not-guessed, nosniff,
  no-cache, `follow_symlink=False`, role-shape gate `<role>/<file>`, the `is_served_file`
  lstat gate) + the `/api/media/{ns}` index (per-role lists in server order + format/size/WxH/
  `revision` (`mtime_ns:size`) metadata + roster entries/slots) vs `/api/media/{ns}/files/`
  mount split; `themes.gacha` Settings models. **Wire-shape AMENDMENT to §5.2:** the index
  ships `{roles, slots}` — the role re-rule's per-role lists ARE the entries; the draft's flat
  `{entries}` is superseded (no duplicate wire data).
- **B2 swap:** one `useMedia` query → `rosterFromIndex` adapter → the SAME §5.3 resolver;
  per-ROLE bundled fallback (no user files ⇒ byte-identical G4 behavior); `Roster` gained
  `scenes`+`pools`; the reel latch is `(url, revision)`-scoped (in-place replacement recovers).
- **B3 gallery:** namespace-generic `MediaGallery` driven by a **`ThemeDef.media` descriptor**
  (descriptor-not-code — no `theme===` branches in ConfTab); order/pins via the normal
  settings path; save-await bounded (`MEDIA_REFETCH_TIMEOUT_MS` 5 s — the standing kit item:
  global request timeout); oversize warnings from named constants (ruled: advisory thresholds
  are not config).
- **B4 PWA:** the repo's first runtimeCaching — woff2 `CacheFirst`, media files
  `StaleWhileRevalidate` via a **sameOrigin+pathname callback matcher** (an unanchored href
  regex was cache-poisonable by query-string lookalikes — Codex); the sw spec compiles the
  matcher out of the real built `dist/sw.js`.
- **⚖ RULINGS OF RECORD:** the `reel_figure` pin selects from the REEL POOL (reel/ files +
  bundled cutouts when empty), never plain characters — a portrait without a cutout must not
  be offerable (it would render as a rectangle mid-sweep); the bundled reel pool derives from
  entries' `cutout` fields per-role (fixes "owner portraits dropped ⇒ figure silently lost";
  retired `toCutoutArt` as a duplicate path). **DEGRADE, NEVER BRICK (durable law):** a bad
  media layout (symlinked spine, role-file collision, mkdir failure) disables THAT NAMESPACE —
  no mount, index 200 `{disabled, reason}`, gallery shows the reason, prominent log — and the
  panel boots; the pre-ruling code CRASH-LOOPED prod's systemd on a stray file (uncaught
  `FileExistsError` after the exit-78 preflight). Post-boot root-swap symlinks are OUT OF
  THREAT MODEL (fs access = shell = owns the box; the tailnet is the boundary) — recorded in
  the ensure docstring. Symlinks are rejected at EVERY level (spine at ensure; files via the
  single `is_served_file` predicate read by mount AND index, so advertised == served).
- **Review arc:** Codex R1 **NOT READY** (6 MED/2 LOW — lead: role-scope hole + SW overmatch)
  → wave 1 (8 fixes; live-verified) → confirm **WAVE NEEDS FIXES** (file-level symlinks · the
  two boot bugs · parser leniency · hung-fetch hostage · rewarm nit) → wave 2 → final confirm
  (2 mechanical residuals: degenerate SOF/chunk lengths · the duplicated predicate) →
  `8f6297a`, main-seat verified diff, **review CLOSED by the main seat** (exactly-specified
  leaf fixes; red-first proven).
- **Collation edge (documented+pinned):** numbers sort before text (`a1.png` < `a.png`);
  `2.png` < `10.png` (natural).
- **OPEN (the G5 gate):** the owner round — drop real images into
  `$CTRLB_HOME/media/gacha/{characters,banner,wallpaper,reel,oracle}/` (dev:
  `~/.ctrl-b-dev/media/gacha/`), check the deal/scenes/wallpaper/oracle/reel-cutout pickup,
  and the phone gallery (order, pins, warnings, real touch). Owner cutouts have NO baked glow
  (expected; the gallery's reel hint + `art.ts` say so — the bake recipe is there if wanted).

**§7.7 — G6 AS-BUILT (2026-08-06; ✅ code + reviews COMPLETE — ⏳ the owner DEVICE ROUND is the
open gate).** The two pickers, the wordmark swap, the NEW-ribbon demo, the dark-surface
verification. Diff +~1.3k/−100 across 23 files (+ `lib/chipBackground.ts`,
`tests/stylelint/accentRules.test.ts` new); FE unit 1549→**1594** · Playwright 211→**231**
(gacha contrast rows 1→12) · full gate 6/6, all main-seat re-run after every wave.
- **(i) ACCENT picker — seven `body[data-accent]` blocks** per the §4.4 recipe. Family 1 blocks
  carry only the ramp functions (trio constant by identity; the completeness guard's `RAMP_ONLY`
  set knows). midnight/indigo BUILD-DERIVED (sRGB lerp): mid `#05070f/#0d1024/#1d2450→#0a0d22→#04050c`
  (ink/fill 4.69) · ind `#050918/#0e1631/#26377f→#0d1737→#040716` — the card TUNED one step
  deeper (first draft hit 3.97 worst-trio-on-card, under arcade's own 4.10; shipped 4.15,
  ink/fill 4.62). ember/glacier/nebula = the pinned table hexes (ink/fill 6.25/5.03/7.51).
  **eridu RE-DERIVED**: trio `#3a86ff→#2fd8f5→#3fe9bd`, LCh hue 285.3°→219.6°→170.1° monotonic,
  L* 57.2→79.8→83.4, ≥83° clearance from gold/warn (floor 25°); worst-on-card 5.27. **The
  carve-out FIRED on the mechanism** (slot 3 sits 15° from ok-green — CLOSER than the rejected
  lime's 32°): `--gc-online-fill` + `--gc-caption` pinned to arcade's verified values; the
  ONLINE ribbon stays green→cyan. Per-variant `--gc-display-shadow` = darken(radial-1,.50).
  **A §14.6 trap closed:** kit's `--accent-ink: var(--bg)` sits on `:root` (= the scope root) and
  froze at arcade's ink under every variant — re-declared on `body` (vapor-precedented); the gate
  would have measured the stale pair. Recipe fidelity: three §4.4 formulas don't round-trip
  arcade's own literals (`lighten(card,.02/.08)`, `darken(b2,.06)`) — arcade untouched, variants
  take the recipe as written; recorded not fudged.
- **(ii) DOSSIER picker** — `dossierPalette` seg exactly per THE PICKER CONTRACT; slip = NO
  block. Ten `--gc-dossier-*` tokens minted (kicker · led/led-dim · close-bg/-ink ·
  act-fill/-ink/-rim/-hi/-line); THREE deleted (`--gc-unit-no`, `-ok`, `-warn` — dot-only
  consumers, verdict ORPHANED; the `gachaChrome` value pin moved to the kicker). The dark
  action button = the FRESH neon-purple panel measurement (1 mock px ≈ 1.13 CSS px): box
  178×37 CSS px — the shipped geometry, nothing moved · radius 6px stands · fill VERTICAL
  −21% (horizontal flat −2.4%) · rim 1.11× (sides) · top highlight 2.51× — **"two elements or
  one" = ONE element, two values** (per-side `border-color: hi rim rim`; a border + inset line
  would stack two lifts, 1px too tall) · no elevation → press = `opacity .82`, the generic
  `:active` slide REPLACED for the darks (secondary included). Only neon-purple's bottom stop is
  derived (`darken(#511cab,.10)` — its table pair fell 1.6% where the panel measures 21%; the
  other three fall 23/31/43% and ship as authored). Dots vapor-style: led = the palette accent
  (derived ONCE on `body` — deliberate deviation from the contract's letter, the ruling defines
  led AS the accent; led-dim per-palette), dark-only glow; both states ≥3:1 all five (slip
  5.79/3.30 · neon 6.98/3.36 · sunset 4.76/3.43 · rose 10.43/3.44 · aurora 8.86/3.43). TWO new
  normalisations: sunset's ink-2 → per-palette `#d0cce8` (shared value hit 3.87 on its brick
  top) and its kicker one step lighter `#f9c2a3` (table value had 0.04 margin). The secondary
  outline is TOKENED (`-act-line`; darks mix 70% against their own CARD — the slip formula's
  `-line` is near-transparent white there). The `swatch?` seg extension shipped the full §4.9
  path (types · ConfTab mapping un-STRIPPED via spread · Seg chip, NO node when absent ·
  kit.css `.seg-chip` · `chipBackground` extracted to `lib/`, the Swatches/Seg shared rule).
  **Accent chips are LITERALS** — deliberate reversal of the Codex-G0 #4 var() note (right with
  one accent, wrong with seven: every chip would preview the ACTIVE palette); drift covered by a
  unit test pinning each chip to its tokens.css hexes.
- **(iii) Wordmark** → コントロール・ビー (values swapped in `copy.ts`; both readings frozen, no
  font regen; `settingDossierDesc` uses 紙 — a glyph the subset already carries via 壁紙).
- **(iv) NEW ribbon** — own top-LEFT ribbon (the state chip is real status, not displaced),
  brand-pill pair, `aria-hidden`; `pickRibbonHost` = a pure tested reducer, pick held in a REF
  and drawn OUTSIDE the state updater (StrictMode-pure; an updater may be replayed), top 32px
  (clear of the rarity row — found by render).
- **(v) Dark-surface verification** — 5 palettes × {rest, disabled, active×2, focus} rendered;
  disabled stays contrast-EXEMPT. Focus ring: `.bs-sheet:has(.gc-dossier) :focus-visible` takes
  `--gc-dossier-accent` (fixes the pre-existing 2.62 kit ring on slip's card; `:has()`-scoped so
  a future NON-dossier sheet keeps the kit's own gated ring — under slip the rose ring is ~3.01
  on kit surfaces). Known notes: gacha's `.bs-sheet` block restyles any future second sheet
  (exactly one exists); the close transient (`detail == null`) shows the kit ring for an instant.
- **Gate coverage as built:** 7 accent rows + 5 dossier rows (a separate `SETTINGS_MATRIX` — the
  palette list has three other consumers that must not see settings rows) × the §4.4 pair list
  (+ `--gc-star-hi`/badge beyond the brief — same lozenge); band-sample mode (2-stop
  HARD-ASSERTED; stop-average ≠ band beyond two); the seed survives-the-reconcile assertion
  (body-attr stamp check BEFORE the probes, the localStorage survival check AFTER them — no
  observable sentinel exists when LOCAL wins LWW, so post-probe placement is what makes a wipe
  on either side fail loudly); TWO drift guards (every seeded value is a declared option; every
  dossier option has a row). **The STRIP is an ADVISORY channel, not a gate** (main-seat ruling
  on Codex R1-F1: the strip follows the ACCENT axis by owner design — a per-dossier floor would
  force a write-disjointness break; slip ships 1.19 worst BY DESIGN pending the standing
  device-round skepticism): worst strip-vs-sheet slip **1.19** · sunset **1.79** · rose
  **3.53** · aurora **3.97** · neon **4.28**; non-throwing by contract (an unresolvable advisory
  annotates "unresolved").
- **The stylelint fence GREW:** `ctrlb/accent-fill-contexts` gates a read of ANY `var(--*-fill)`
  (Codex R1-F2's one-hop alias smuggle) with an EXACT property allowlist (fix-set R2: the old
  prefix admitted `background-color` — the precise property a gradient dies on); allowed = image
  props or another `--*-fill` alias declaration. The plugin gained its FIRST tests (4, Node-API
  driven, the hole replayed pre/post-fix). Rule id kept (ruling: id churn, zero behavior).
  Comment-evasion inside `var()` REJECTED as out of threat model (mistakes, not adversaries).
- **Review arc:** Codex R1 **SHIP WITH FIXES** (2 MED/3 LOW — lead: the strip gate +
  the alias hole; all five accepted, two with leaner main-seat fixes) + 2 main-seat audit items
  → Opus fix wave (7 items) → Codex fix-set R2 (4 CLOSED · 1 LOW · 2 MED) → wave 2
  (main-seat-applied, 3 surgical edits: advisory try/catch · exact prop list + regression test ·
  assertion moved post-probe) → full gate + full local Playwright green. Codex R1 also
  independently confirmed: recipe completeness, write-disjointness both ways, the cascade
  idioms (equal-specificity shared/per-palette token blocks vs `:not()` for component rules),
  the pre-mount slip fallback, `swatch?` byte-identity, wordmark/glyph safety.
- **Recorded, not fixed (pre-existing):** `--gc-tag-ink` on `--gc-brand-fill`'s worst arcade
  stop = 4.27 (shipped since G1; the NEW ribbon reuses the pair, aria-hidden decorative).
**G6.1 ADDENDUM (2026-08-06 evening — owner: verify the colors + "2 more in line with any of
the palettes that are left"; built same night).** The verification came back **CLEAN**: the
shipped four reproduce the example panels exactly on `from`/`to`/`accent` (the fitted sampling
windows are now recorded in tokens.css; `card` carries a ≤6/255 method uncertainty — the one
value whose original sample point is not recoverable), every §7.7 ratio recomputes, and the
neon button authority re-confirms independently (rim 1.10×, highlight 2.55×, vertical −21.2%).
Also established: all eight mock buttons carry WHITE labels (sunset/rose's dark inks are the
documented normalisations), and the shipped kicker deliberately = the accent, not the mock's
muted glyph (§4.4's own "lightened 40%" arithmetic proves it). **The two new palettes =
cyber-teal + forest-green** — the shipped four occupy the magenta→orange arc (20°–54° + 315°–
333°), these fill the cool half at ≥91° clearance (maximin winner); **amber-gold passed over**
(accent ΔE 9.5 from `--gc-star` — the sheet's identity would BE the rarity gold; fill 15° from
sunset's), midnight-blue likewise (inside neon/aurora's family). Two measured deviations, both
precedented and recorded in the blocks: cyber-teal's `from` re-taken from its panel's top band
(front-loaded ramp — the neon degenerate-pair twin) + its fill takes §4.4's own recorded 8%
deepen (preserves the family's both-extremes-≥4.5 invariant); forest-green ships **entirely as
measured, zero normalisations** (its 180° pair is its true vertical gradient — its horizontal
runs the wrong way). Both join the shared dark block (4→6 selectors) and inherit the flat
button/glow/focus rules via the `:not(slip)` scoping automatically (render-verified). Gate:
SETTINGS_MATRIX 4→6 (the coverage guard demanded them red-first), 235 e2e / 1599 FE unit /
6/6, all main-seat re-run. Strip advisories: teal 4.00 · forest 3.74 (better than every
shipped dark except neon).

**G6.2 ADDENDUM (2026-08-06 night — owner: the family-1 trio-constant siblings read too similar;
"another that leans more greenish to fit the teal dossier").** The EIGHTH accent: **jade** —
trio `#5bae49 → #2fbc8d → #06c5bf` (LCh hue 135.9°→164.4°→191.8° monotonic, span 55.9°; L*
64.1/68.4/72.1 inside the ruled band; ≥48.6° clearance from gold, ≥56.4° from warn) on a deep
GREEN-NAVY ramp (`--bg #041213` · `--surface #0b2022` · radial `#0e5546→#0a2321→#030f10` —
every other variant's ramp sits at LCh hue 281–308; jade's 207 is what seats the Teal/Forest
dossiers in their own family). ZERO tuning steps (greens carry sRGB's luminance — worst
trio-on-card 6.11 vs arcade's own 4.10 floor); accent-ink/fill 6.90; strip advisory 6.64 (best
in the set). **The carve-out FIRED on the sharpened mechanism above** (not clearance — the
ONLINE/NEW lozenge object-identity); `--gc-online-fill` + `--gc-caption` pinned to arcade's
values, recipe values recorded beside the pins. Matrix 7→8 red-first; the completeness/chip
guards auto-followed. Device-round flags: the 55.9° tri-strip span (glacier's ~2.5-colors
caution applies) · on KIT surfaces `--accent` (slot 1) and ok-green are now both greens
(outside the carve-out's scope — eyeball) · arcade's cyan caption/ONLINE living inside a green
palette (reads coherently in renders).

**G6.3 ADDENDUM — THE FIDELITY WAVE (2026-08-06, from the owner device round).** Three findings,
all measured back against `design/prototypes/gacha/dossier palette example.png` rather than
argued: a nav bug, two view-transition artefacts, and a dossier that "drifts from the example
sheet" (too blue · missing outline/glow · flat tiles · plain white name · hot-pink kicker/LEDs
where the mock is muted violet). Slice A of the wave — `frontend/` + docs only.

**(1) The same-tab nav guard.** `useSections.navigate` had none, on the recorded §10.1 reasoning
that "a value-subscriber no-ops naturally". Right about the store, wrong about the decorator:
`runNavTransition` wraps the write and under gacha starts a real root View Transition *first*, so
re-tapping the active tab replayed the whole cross-fade. Guard added in the NON-hosted branch,
after `clearGroupScrollTarget()` (a stale handoff must still be disarmed) — the hosted branch
keeps re-navigating on purpose, because re-tapping a hosted section re-scrolls its host to the
group. Two unit cases beside the existing `useSections` suite; the §10.1 bullet is marked
SUPERSEDED in place rather than deleted.

**(2a) The dark rims — the scale moved off `root`.** gacha animated
`::view-transition-old/new(root)` with `scale(.96/1.04)`, and the root snapshot is the whole page
*including the fixed app backdrop* (`.kit`'s radial + pinstripe). Two copies of that backdrop at
different scales, cross-fading, do not line up at the frame edge — the rim/seam the owner saw on
Chrome. The prototype never had it because its transition scales CONTENT over a backdrop that
holds still. So `.kit-main` takes a scoped `view-transition-name: gacha-page` for the flight (the
same `[data-transition=…] <selector>` idiom the dossier avatar already uses — a constant name
would make the NEXT transition skip on a duplicate-name error) and the keyframes move onto it,
byte-identical (96/104%, 240/380 ms +100, and 200/300 ms for `detail`). The root pair keeps ONLY
`animation-duration`, i.e. the UA's opacity cross-fade — invisible, since the backdrop and nav bar
are identical in both captures. **Verified live on chromium AND firefox** (Playwright probe over
`document.getAnimations()`): `gacha-root-out/in` land on `::view-transition-old/new(gacha-page)`,
root carries only `-ua-view-transition-fade-*`, the nested `capsule-shell` group still flies at
its own 560/280 ms, and `.kit-main`'s name is back to `none` after the flight.

**(2a-ii) …and the REEL had to come with it — a SECOND owner device report, caught mid-flight
against the dev build, on BOTH engines: the slats and the figure suddenly swept UNDER the tab
contents.** The mechanism, confirmed: `::view-transition-*` is a flat pseudo tree whose GROUPS are
ordered by the paint order of the elements they were captured from, and the root group is always
first. With one group, everything sat inside the root snapshot in its natural order — the reel
(z-rung 45, a sibling painted after `.kit`) drew above the content, and `::view-transition-new(root)`
being LIVE is what kept it sweeping. The moment `gacha-page` became a second group it began painting
ABOVE the whole root snapshot: content over reel. **Re-ordering the two groups cannot fix it, and
that is the load-bearing observation** — the root snapshot holds BOTH the app backdrop (which must
stay below the content) and the reel (which must sit above it), so no single z-index for the root
group is right, and neither is a `::view-transition-group` z-index of any value. The reel therefore
takes a group of its own (`view-transition-name: gacha-reel`, scoped to `tab` alone — the node
lingers invisible after a sweep, and neither the dossier morph nor the showcase has business
extracting it), and lands where it belongs for free: it paints after `.kit-main`, so its group sorts
after `gacha-page` in both engines. Its old/new pair takes `animation: none` rather than the UA
cross-fade — the new pseudo is LIVE (the §10.1 outcome-(a) property this whole effect already
rides), so a fade-in would dim the first 380 ms of the reel's own sweep, and `animation: none` also
drops the UA `plus-lighter` blend, which has nothing to blend against; the OLD capture is explicitly
zeroed (the resting reel is invisible anyway — its slats park at `translateY(-110%)` — but a
transparent snapshot painted over a live one is the kind of ghost worth ruling out). The GROUP keeps
its own animation: both rects are the full shell, so it is a no-op.
**Verified on chromium AND firefox** by a CSS slow-motion probe (`animation-duration: 6s !important`
from an *unlayered* sheet — important beats the theme's layered normal declarations on every engine,
and a duration override never resurrects an `animation: none`; CDP playback-rate is Chromium-only
and would not have covered Gecko): mid-flight frames show the slats and the figure OVER the page on
both. **Rims re-checked with the reel extracted and still gone** — the reel is out of the root
snapshot entirely now, and the root pair carries no transform in the first place; the four frame
edges sample as smooth gradient runs with no dark seam on either engine. **No double-play**: the only
`gacha-reel` pseudo animation present is the group's own no-op, so the slat sweep runs exactly once,
in the live content.

**(2b) The star badge, held back.** `.gc-dossier .art-rar` is not part of the `capsule-shell`
morph (that flies the `<img>`), so in the NEW capture it was page content — painted at its final
position from frame 1, then re-painted by the live DOM over the image at finish. Fixed at the VT
layer: `view-transition-name: dossier-rar` under `[data-transition="detail"]`, with
`gacha-rar-in`/`gacha-rar-out` holding opacity flat until 73% of the 560 ms arc and cross-fading
in the last ~150 ms. BOTH legs are written because `detail` has two shapes — a fresh open (no
`old` exists; the `new` rule is the whole story) and a SWAP (both captures have the badge at the
same rect; without the `old` rule the UA's default fade-out would blink it away mid-flight).
**NOT named under `showcase`**, ruled deliberately: there the dossier stays mounted *behind* the
full-screen art overlay, and a named element is lifted OUT of the root snapshot and painted above
it — the badge would float over the artwork. Occlusion only works while it stays in the page
snapshot, and the reported artefact is the `detail` morph.

**(3) The dossier re-sample.** Method deltas over G6/G6.1 (all panel-relative to the recorded
`(14 + 384c, 40 + 506r)` grid):
- **the top-band window now applies to ALL six darks**, not just cyber-teal: median `x 185–220,
  y 11–16` — above the kicker, below the 1px rim. The shipped `from` values came from `y 128–138`,
  which is 29.8% of the panel's `y 8→428` content box: they were never the top of the sheet.
- **the sheet is a 3-STOP gradient**, `linear-gradient(from, mid 30%, to)`. `mid` IS each palette's
  former `from` — the same measured pixel, now at the position it was taken from — so the reshape
  adds a stop rather than moving one. Fitted against the per-row background profile of each panel
  (130–190 clean rows at `x 198–214`), the 30% knee halves the straight line's error: rms
  **2.38 / 4.15 / 8.68 / 3.04 / 1.86 / 1.53** (neon/sunset/rose/aurora/teal/forest) against
  **4.90 / 9.76 / 15.12 / 11.71 / 5.92 / 8.05** for two stops. 30% is not a taste value; a free-knee
  search moves the mean rms by 0.19.
- **tiles + rows are TRANSLUCENT LIFTS**, solved per palette from seven measured composite/backdrop
  pairs (four metric tiles, each against its two flanking gaps interpolated to the tile's own x;
  three service rows against the gaps above/below interpolated in y). Alpha capped at 25% so the
  card stays a lift rather than a repaint.
- **the panel carries a 1px rim**: sides = the mean of the left/right rim medians at mid height
  (the panels' gradients are DIAGONAL, so the two edges differ — the vertical CSS gradient's
  equivalent is their mean), top = the top-edge median over `x 110–250`. The inner tile/row
  hairline is a dimmer member of the same rim, not white: implied strength 10–27% across the six,
  median ~22%, shipped as ONE derived declaration `color-mix(… outline 22%, transparent)`.
- kicker / name / role-line = the brightest-pixel median of their glyph bands
  (`x 137–217, y 41–48` · `x 137–175, y 66–88` · `x 137–257, y 99–107`); LED = the dot core median
  (`x 30–33, y 313–316`).

| palette | `from` (was → now) | `mid` (new) | `card` (was → now) | `outline` / `-top` | `name` | `kicker` (was → now) | `ink-2` (was → now) | `led` (was → now) | `led-dim` |
|---|---|---|---|---|---|---|---|---|---|
| neon-purple | `#140e35` → **`#241747`** | `#140e35` | `#130f32` → **`#ab91fd0b`** | `#6e4c9c` / `#724f9b` | `#c5c7f7` | `#f46adf` → `#a895da` | `#b9b4d8` → `#9080c5` | `#f46adf` → `#7751c8` | `#9e479d` → `#725d9f` |
| sunset-orange | `#843e3c` (held) | `#843e3c` | `#502f3e` (held) | `#ac645e` / `#d48059` | `#fefaf8` | `#f9c2a3` → `#f8baa9` | `#d0cce8` → `#f7bca2` | `#f28c53` → `#d66e49` | `#cb764e` → `#af7866` |
| rose-pink | `#34202b` → **`#623443`** | `#34202b` | `#221b23` → **`#fc7c8c14`** | `#ac6371` / `#f0a1ab` | `#f8e2e5` | `#f3bfc0` → `#f3b6ba` | `#b9b4d8` → `#e1a4aa` | `#f3bfc0` → `#dc6d78` | `#866a6e` → `#ad666d` |
| aurora-violet | `#171643` → **`#391e61`** | `#171643` | `#10143a` → **`#b069fc12`** | `#74549e` / `#a769c6` | `#dcc6ee` | `#d5a5f1` → `#b48cd7` | `#b9b4d8` → `#a78dd0` | `#d5a5f1` → `#9851b6` | `#7a629d` → `#866295` |
| cyber-teal | `#001e2d` → `#001f2e` | **`#00111f`** | `#001522` → **`#01384740`** | `#1e6678` / `#39637a` | `#72e4ee` | `#23cbde` → `#44bacc` | `#b9b4d8` → `#33a2b2` | `#23cbde` → `#2494ae` | `#3c7278` → `#3d6e79` |
| forest-green | `#08261f` → **`#19422d`** | `#08261f` | `#05231e` → **`#73fc7a0c`** | `#507c56` / `#588d63` | `#acf0d6` | `#68ce7b` → `#74ce95` | `#b9b4d8` → `#5ebf8a` | `#68ce7b` → `#58a260` | `#4e7c56` → `#5e7e61` |

Slip gains `--gc-dossier-mid: #f1f2ff` (the EXACT 30% point of its own `#f9f8ff → #dfe4ff` line, so
the light sheet renders byte-identically), `--gc-dossier-outline{,-top}: transparent` (the rim is a
dark-panel property; the border still exists under `box-sizing: border-box`, so nothing moves) and
a derived `--gc-dossier-name: var(--gc-dossier-ink)`. `--gc-dossier-ink-2` LEFT the shared dark
block — every palette now states its own. **The buttons are untouched** (owner: "the buttons are
fine"): no `--gc-dossier-act-*` value and no `.gc-act` rule changed; `--gc-dossier-act-line`'s
*rendered* value shifts only because it color-mixes with the card.

**NORMALISATIONS (the standing rule — a mock literal that fails its gated floor is nudged within
the same hue, never restored):**
- **sunset-orange `from`, 100% back onto `mid`.** Its measured band `(189,85,67)` puts the sheet's
  own near-white ink at **4.18** (floor 4.5), and its peach kicker/role line could only clear
  against it by going essentially white — which is the identity the owner asked to keep. The
  palette therefore HOLDS the brick for the first 30% and then falls, which is still closer to the
  panel's front-loaded shape than the straight line it replaces. The one palette that lost its
  correction; recorded, not fudged.
- **sunset-orange `card`, SOLID (no lift).** The measured fit is `rgb(254,116,88)` at 19.2%, and any
  lift pushes `--gc-dossier-accent` (the Shut down label) to **3.16** against 4.5 — at *zero* lift
  the bare sheet already measures **3.58** there. No alpha clears it, and the buttons are frozen,
  so the card stays the dark chip that holds the label at **4.76**.
- **sunset-orange kicker** `#f49379` +36% white → `#f8baa9` (4.60/4.60/9.21 on from/mid/to) — the
  same rule G6 applied to the same glyphs, landing within 3/255 of the G6 value.
- **sunset-orange ink-2** `#f4a37f` +27% white → `#f7bca2` (4.63/4.63/9.27, 6.97 on card).
- **neon-purple LED** `#5b36aa` → `#7751c8`: as measured it lands **2.18** on the composited card,
  under the 3:1 non-text floor the LED is held to (on a port-bearing row the dot is the only
  visible status cue). Raised in HSL lightness to **3.13**.
- **aurora-violet LED** `#924ab1` → `#9851b6` (3.10). rose/teal/forest/sunset ship their measured
  dot (4.11 / 4.98 / 4.61 / 3.40).
- every `led-dim` is the new dot at ×0.50 saturation / ×0.70 lightness, then raised until it clears
  3:1 on its own composited card: **3.12 / 3.14 / 3.09 / 3.11 / 3.11 / 3.16**.

**GATE (`e2e/contrast.spec.ts`) — the method delta the translucent card forced.** `wcagContrast`
reads alpha as opaque, so an un-composited probe would have measured `rgb(171 145 253)` — a light
lavender — where the screen shows near-black, and every pair on that card would have gone blind
(it failed loudly first, which is the right failure mode). `Pair` gained `over?: string[][]`: a
backdrop STACK under `bg`, bottom-first, each layer listing the alternatives that can be there;
the bg is flattened onto every combination, a translucent fg onto the flattened bg, and the worst
result gates — the file's existing "worst stop wins" discipline, one dimension further. The card
stack is `["--gc-dossier-mid", "--gc-dossier-to"]`: `--gc-dossier-from` is deliberately absent
because **no card-bearing block exists in the sheet's top 30%** — the head (portrait, kicker, name,
role line) occupies all of it, in the mock and in our own layout. New rows: `ink`/`ink-2`/`kicker`
against `--gc-dossier-mid`, and `--gc-dossier-name` against all three stops at **min 3** (27 px at
weight 900 is WCAG LARGE text). `e2e/vendor-types.d.ts` gained culori's optional `alpha`.

**MEASURED PASS TABLE (the real gate run, `--project=mobile -g gacha`, 14/14 green).** Worst value
per row across the stops it is gated on:

| | ink/from | ink/card | ink-2 worst | kicker worst | name worst | accent/card | act-line/card | act-ink/fill | led/card | dim/card | star/badge |
|---|---|---|---|---|---|---|---|---|---|---|---|
| neon-purple | 14.74 | 15.65 | 4.72 | 6.19 | 10.00 | 6.57 | 3.94 | 10.54 | 3.13 | 3.12 | 13.70 |
| sunset-orange | 6.94 | 10.45 | 4.63 | 4.60 | 7.40 | 4.76 | 3.14 | 5.62 | 3.40 | 3.14 | 13.70 |
| rose-pink | 9.08 | 11.99 | 4.83 | 5.84 | 8.13 | 8.22 | 5.02 | 5.71 | 4.11 | 3.09 | 13.70 |
| aurora-violet | 12.39 | 14.07 | 4.81 | 5.01 | 8.72 | 7.76 | 4.68 | 8.32 | 3.10 | 3.11 | 13.70 |
| cyber-teal | 15.37 | 15.96 | 5.63 | 7.40 | 11.37 | 8.96 | 5.14 | 6.27 | 4.98 | 3.11 | 13.70 |
| forest-green | 10.22 | 12.97 | 5.00 | 5.92 | 8.71 | 7.31 | 4.51 | 6.07 | 4.61 | 3.16 | 13.70 |
| slip | 16.65 | 17.57 | 5.47 | 4.60 | 13.95 | 5.79 | 3.44 | 5.62 | 5.79 | 3.30 | 12.43 |

Floors: 4.5 for every ink/kicker/accent/act-ink column, 3 for name (large), act-line, led, dim,
star. **The STRIP advisory moved with the brighter tops** (still advisory by the G6 ruling, never a
gate): slip **1.19** (unchanged) · sunset **1.79** · rose **2.34** (was 3.53) · forest **2.63** (was
3.74) · aurora **3.19** (was 3.97) · neon **3.80** (was 4.28) · teal **3.96** (was 4.00). A brighter
top band is a smaller step to the brand band by construction; the device round already owns this
item.

**RECORDED DEVIATIONS (measured, not fixed):**
- **one `--gc-dossier-card` serves both tiles and rows, and the mock does not.** Every panel lifts
  its metric tiles 2–4× harder than its service rows (rose: +26 vs +7 in R). One token cannot say
  both, so the fit splits the difference — tiles land slightly under the mock, rows slightly over.
  Residuals: neon ±2 · teal ±5 · forest ±6 · aurora ±8 · rose ±11. Splitting them would need a
  second token and a component-level change.
- **the mock inks the metric captions / ports GREYER than the role line** (neon `#767498` against
  the role line's `#9080c5`); `--gc-dossier-ink-2` paints all three and takes the role line's tint,
  per the brief. Most visible on sunset, whose captions/ports become peach. A one-token follow-up
  if the device round dislikes it.
- **the shared 22% hairline under-fits sunset/rose** (their measured borders carry a glow the
  sample cannot separate from the line).
- **slip's `h2` also becomes the display serif** — the rule is not palette-scoped, because the
  dossier is one component with one typographic identity; slip keeps its own ink.
- **§10.4 font contract:** a runtime JAPANESE host name in the `h2` falls through the frozen subset
  to the system serif tail (Latin names draw from the real face, whose full latin range ships).
  Accepted — the fallback is a serif either way, and the alternative is un-freezing the subset.

- **OPEN (the G6+G6.1+G6.2+G6.3 gate): the owner device round** — the palettes themselves on all 15 combos,
  plus the named items: ember's green→violet ONLINE ribbon · the top strip on the darks (the
  1.19/1.79 advisories say slip/sunset are where to look) · the NEW-ribbon verdict
  (keep/drop/meaning) · glacier's tri-strip at small size · the wordmark · dossier dots'
  brightness-coding on slip (lighter-means-dim on paper). Then v1.5.0.

---

**G6.4 ADDENDUM — THE DOSSIER DEVICE ROUND (2026-08-06).** The owner's verdict on the G6.3 sheet
was *"colors good, design good now"* plus **one real gap and six presentation asks**, three of them
ruled live off an HMR'd dev build while this slice was being written. Everything below is
`frontend/` + this doc; the sheet's data, actions and star semantics are untouched.

**(1) THE SERVICE ROWS ARE LINKS — the gap.** `.gc-svc` was a `div role="group"`. Every sibling
dossier opens its services; gacha's did not. Wired to the SAME seam, verbatim
(`CosmosHostDetail`/`FrontierHostDetail`/kit `Fleet`): a service that is **live AND declares a
`url`** renders as `<a href={rebaseServiceUrl(s.url, serviceBase(host, window.location))}
target="_blank" rel="noopener">`; **everything else — offline, or up with no URL — stays the
`role="group"` div** with its `"<name> online|offline"` label, so there is never a dead link to
tap. The row BODY (LED · `ServiceIcon` · name · port) is one JSX fragment shared by both arms, so
the two can't drift. The anchor takes no `aria-label`: its link text is the name + port, the
sibling pattern. Affordance = tokens only — `--gc-dossier-row-hover` (an accent mix into the
row's own card, derived on `body` so it re-tints per palette; it shipped this round at **10%** and
the G6.5 addendum below cuts it to **5%** — a premultiplied mix against an opaque accent multiplies
the card's alpha as well as tinting it, which the ungated original did not account for) behind
`@media (hover: hover)` so a
phone can't leave the last-tapped row lit, plus an `opacity: .82` press (the darks' own flat press;
a row has no offset shadow to sink into). The focus ring is already the sheet's
(`.bs-sheet:has(.gc-dossier) :focus-visible`).

**(2) THE DOTTED TEXTURE.** Owner: *"the Cosmos bottom sheets have this dotted pattern baked in,
faded … it fades out from the centre more or less; it aligns with the drag handle."* A port of
cosmos's own `.bs-sheet::before` grid, recipe intact — **1px dot on a 13px pitch**,
`background-position: center 6px` (cosmos's literal, because the geometry it solves is the KIT's:
a 13px tile centres its dot 6.5px in, so +6 lands the row on the grab bar — verified on a render,
grip centre y 380.0 vs dot row 380.5), radially masked from the top-centre. It takes **its own
pseudo** (`.bs-sheet::after`, `z-index: -1`): gacha's `::before` is the brand strip, and the two
cannot share a box — the fade mask would eat the strip's ends, and cosmos's element `opacity`
would fade the strip with it. The negative rung still paints over `.bs-sheet`'s background (it is
transformed, so it IS a stacking context) and below both the strip and the whole `.gc-dossier`
subtree.
*Knobs + defaults:* `--gc-dossier-texture: radial-gradient(#ffffff14 1px, #ffffff00 1.6px)` on the
darks (α **0.078** — deliberately fainter than cosmos's ≈0.117 composite, because the mock's panels
read nearly flat) · `--gc-dossier-texture-size: 13px 13px` · `--gc-dossier-texture-mask:
radial-gradient(260px 340px at 50% 46px, #000 0%, #000 22%, transparent 72%)` — cosmos's stop shape
with the vertical radius grown for a panel several times taller. **Slip's texture is `none`**: a
token switch, not a selector fork, so the light sheet is byte-identical to what shipped.

**(3) THE CHARACTER WATERMARK.** Owner: *"put the character image as a background of the bottom
sheet, like the dotted texture — faded, so it's visible, positioned center-right, in the empty zone
right of the PC name."* `GachaHostDetail` renders a SECOND copy of the same `ResolvedArt` the
portrait draws (`alt=""` + `aria-hidden` + `draggable={false}` + `pointer-events: none`); **no art ⇒
no watermark**. It carries **no `view-transition-name`** — `capsule-shell` stays declared on
`.avatar` alone, so the detail morph and the showcase are untouched (`gachaReel`/`gachaDossier`
pin it).
*Paint order without a z-index:* `.gc-dossier` must stay a non-stacking context (its close corner's
`z-index: 2` has to reach the SHEET's context to clear the handle's z-1 drag strip), which rules out
`z-index: -1` — the mark would escape to `.bs-sheet` and paint UNDER the texture. So the ordering is
positional: the mark is the first positioned child and `.gc-dossier-head` / `.gc-metrics` /
`.gc-acts` / `.gc-svcs` all took `position: relative`, which orders them after it in tree order.
*Geometry + knobs:* box `right: 0; width: 66%; height: 210px`, `object-fit: cover`,
`object-position: 50% 14%` with the entry's own `focus` overriding inline, exactly as on the
portrait. **66% is not a taste number** — it puts the box's centre, and therefore the art's, at
**67% of the sheet** (the owner's "one third in from the right"); at this box aspect a portrait
source covers the width exactly and is cropped only vertically, so the x half of `object-position`
is inert and the y half is what `focus` steers. `--gc-dossier-mark-opacity: 0.16` (it went in at 0.12 — the middle of
the owner's own 0.10–0.14 bracket — and the owner asked for one clear step MORE from the live build,
*"the background image should be a little bit more visible"*; `0` on slip, no watermark on prize
paper) ·
`--gc-dossier-mark-mask: radial-gradient(88% 50% at 84% 46%, #000 0%, #000 44%, transparent 95%)`,
anchored NEAR THE RIGHT on purpose so the solid core covers the subject out to the sheet's edge and
only the left/top/bottom dissolve. That mask is what answers the owner's two follow-ups: the
**top no longer reads CUT** (running it to the sheet's rounded top is not available — `.gc-dossier`
lives inside `.bs-body`, which is `overflow-y: auto`, so it would be clipped at the same line 21px
higher; both of the box's own edge rows are past the fade's end instead), and the **left reach**
now lands half-strength at the middle of the unit name and zero by the portrait's edge.

**(4) THE CLOSE DISC — thinned.** Owner: *"more opaque than not, but not completely opaque",* so the
watermark shows through it. `--gc-dossier-close-bg` on the darks became `color-mix(in srgb,
var(--gc-dossier-badge) 78%, transparent)` → **α 0.702** (it went in at 85% / α 0.765 and the owner
asked for *"slightly more transparent, just slightly"* from the live build). The thinning is a step ON TOP of the badge
rather than an edit TO it: `--gc-dossier-badge` is shared with the rarity lozenge over the portrait,
where a translucent tile would wash the gold stars out. Slip keeps its solid ink disc. The glyph
pair joined the translucent club, so `e2e/contrast.spec.ts` gave it the sheet's TOP band as its
backdrop stack (`--gc-dossier-from`/`-mid`, not the card's — the corner sits in the head, above the
30% knee). **Measured on the final renders** (brightest disc pixel vs the glyph, inside the disc):
**16.03 neon-purple · 16.63 cyber-teal · 16.65 slip**; computed for the lightest sheet in the set with
a near-white art pixel behind it at the watermark's own 0.16, **13.4:1 on sunset-orange**. The 4.5
floor is never in play — the disc is dark on every dark palette.

**(5) THE × IS DRAWN, NOT SET.** Owner: *"make sure the × is in the EXACT centre."* It was
`content: "\d7"`, and a text glyph **cannot** be centred exactly here: `place-items: center` centres
the LINE BOX, and where the ink sits inside it follows the font's ascent/descent, which the two
engines resolve **1.6px apart** — measured on the shipped 38px disc, the best single optical
`translateY(-0.07em)` still left the ink **1.0px high on Blink and 0.6px low on Gecko**. So the mark
became geometry: a plus `clip-path: polygon(...)`-ed out of a **12px** square of `currentColor`,
`transform: rotate(45deg)`. Both operations are symmetric about the box's own centre. **12, not 13**:
the disc is 38px, so an ODD child leaves a 12.5px half-gap and both engines round it the same way,
half a pixel down-right; an even child divides 38 exactly (13+12+13). **Measured result: ink
9.5×9.5px (identical to the retired glyph's ink), offset 0.000/0.000 px, margins 14.25 on all four
sides — on Chromium AND Firefox, at 393 and 360.** It also retires the ASCII-fence workaround the
glyph existed for: there is no character in the rule at all now. (The disc's `font-size: 21px` is
left in place but is now inert.)

**(6) THE TOP-CORNER RIM JUNCTION.** Owner: *"there's a little bit of an outline in the upper
corners … the gradient shows the border — it looks a little clunky."* Mechanism, confirmed at 12×:
the mock's panels carry the lit 1px rim and **no strip**; we carry both, and a 4px band clipped by
the pseudo's 23px radius simply **stops ~10px in with a near-vertical cut** while the rim keeps
curving — a bright band butting into a bright arc. **Four candidates were rendered on both corners**
(`cand-A..E`, chromium, neon-purple + aurora-violet): (A) baseline; (B) top border takes the SIDE
outline value — *no visible change*, on most palettes the two values are within a hair
(neon `#724f9b` vs `#6e4c9c`); (C) strip over the border box + transparent top rim — *fixes the
junction but opens a visible GAP in the arc* where the side rim picks up; (D) the strip's ends
dissolve; (E) C+D — *keeps C's gap*. **CHOSEN: (D).** `--gc-dossier-strip-fade: linear-gradient(90deg,
transparent, #000 34px, #000 calc(100% - 34px), transparent)` as a mask on `.bs-sheet::before`; 34px
is comfortably longer than the ~10px at which the arc clips the band, so nothing is cut and the
rim's arc is the only line at the corner. **The rim itself is untouched** — the two-value per-side
border the mock measured stays exactly as G6.3 ruled it. Slip's token is `none`: its rim is
transparent, so it has no arc to collide with, and the owner asked for the light sheet to stay as
signed off.

**Verification.** Playwright, the real built artifact, `chromium` + `firefox` × `393` and `360`,
palettes `neon-purple` · `cyber-teal` · `slip`, dossier at its FULL detent with a linked service, a
port-less service and an offline one — plus a long-host-name arm and 4×-DPR crops of the close disc
and both top corners. Renders read the same on both engines (mask, clip-path and the texture all
land identically). Targeted vitest (`gachaDossier` 43 · `gachaChrome` · `gachaReel` · `gachaFleet`)
+ the whole `tests/themes` suite, `stylelint`, `typecheck`, `eslint`, `prettier` all green.

**RECORDED, NOT FUDGED — the one honest cost.** The watermark sits behind the head's text, and the
sheet's own small-text pairs have almost no headroom (`--gc-dossier-ink-2` measures 4.7–5.3 against
the sheet stops, against a 4.5 floor). Measured on neon-purple at 393 by diffing a render against
the same render with `.gc-dossier-mark { opacity: 0 }`, worst composited background under each text
role, **at the shipped 0.16**: **kicker 5.79 ✓ (its worst pixel is outside the mask's reach — the
watermark does not touch it) · host name 5.79 ✓ (large text, floor 3) · role line 2.87 ✗** — the role
line's worst pixel is a near-white patch of the character art, and the role line sits at exactly the
mask's vertical centre, i.e. in its widest solid band. The gated TOKEN
pair still passes (the gate measures tokens, and art is not one), but the rendered pair does not.
There is no geometry that satisfies all three owner rulings AND the floor: the arithmetic wants an
effective art alpha ≤ 0.05 there, which is half the bottom of the owner's own bracket. **The knob is
one token** — `--gc-dossier-mark-opacity`, measured: **0.16 (shipped, the owner's own live ask) →
2.87** · 0.12 → 3.25 · 0.10 → 3.97 · **0.07 → ≥4.5 everywhere**. The owner has now seen this exact
overlap live twice and asked for MORE visibility both times, so the trade is theirs and is recorded
rather than silently taken; nothing else in the slice depends on the value, and no geometry satisfies
all three of their positioning rulings AND the floor (the arithmetic wants an effective art alpha
≤ 0.05 under the role line, half the bottom of their original bracket).

---

**G6.5 ADDENDUM — THE CONTRAST RE-NORMALISATION (2026-08-06).** Codex's review of the G6.4 wave
returned **DO NOT SHIP** on one thing only: the gate itself. `Pair.over`'s sRGB source-over maths is
right, but the STACK it modelled was incomplete, so the G6.4 table above is measured against
backdrops the screen does not paint. Three holes, all on the dark palettes (slip's card is opaque
and its texture/watermark are `none`, so every stack below is a no-op there):

1. **the dot TEXTURE was missing under the translucent cards.** `.bs-sheet::after` paints the dot
   field ABOVE the sheet gradient and BELOW the whole `.gc-dossier` subtree, so every card-bearing
   block sits on it. Neon's `ink-2` measured **5.02** against the sheet stops alone and **4.07** in
   truth; several dim LEDs fell from 3.09–3.16 to **2.44–2.66**.
2. **the row-HOVER background was ungated entirely.** It arrived at G6.4 with the note that a 10%
   accent mix "moves the row's luminance far less than the sheet gradient already does under it".
   Measurement says otherwise, and the reason is a `color-mix` property nobody checked: the mix is
   PREMULTIPLIED and the accent term is opaque, so a 10% share does not tint the card — it
   **triples its alpha** (neon .043 → .139) in a bright hue. Worst pairs on a hovered row: neon port
   3.48, neon dim LED 2.16, rose dim LED **1.96**, and on the LIGHT slip a dim LED at 2.84 that no
   lightening can recover (on white, "dimmer" means lighter).
3. **the WATERMARK does reach the metric grid** — two comments claimed it does not. Measured on the
   shipped render at 393px: head **0–152**, mark **0–210**, metric tiles **152–224** (value row 161,
   caption row 182), action bar **224–273**, service rows below that. So the tiles — and only the
   tiles — are a translucent card over the art.

**RULING (main seat): the owner-tuned knobs do not move.** The watermark keeps its geometry and its
0.16; the texture keeps its 0.078; the G6.4 role-line halo trade stays accepted as recorded. The
gate learns the real stack, and the tokens that then fail are normalised by the smallest step that
clears the floor — the standing rule this theme has used since G6.

**WHAT THE GATE MODELS NOW** (`e2e/contrast.spec.ts`):
- `CARD_STACK = [[mid, to], [texture]]` — the action bar and the service rows, which clear the mark.
- `GRID_STACK = CARD_STACK + [mark-grid]` — the metric tiles. `ink`/`ink-2` on the card are gated
  here because the tiles are their worst home; the same two tokens paint the rows and the button
  labels one layer down, so the tighter row covers both.
- the CLOSE disc gains `[texture] + [mark-head]`, which its own token comment always claimed and the
  gate never carried (12.6–16.7 — the derivation was right).
- **two model tokens**, painted by nothing, derived from the owner's knob so a retune moves the
  model with the paint: `--gc-dossier-mark-head` = white at the full opacity (the head band, where
  the mask is solid) and `--gc-dossier-mark-grid` = white at **0.26** of it — the mask's own value at
  the caption row (ry 105px anchored 96.6px down, solid to 44%, out at 95% ⇒ 0.66 at the value row,
  0.26 at the caption's). The caption's band gates both tile pairs: it is the only tile text that
  can lose a floor (the 16px value clears 4.5 over the FULL knob with ≥6:1 to spare). Both live on
  `body`, not `:scope` — the §14.6 trap, caught live: declared on the scope root they froze at
  slip's `0` and the layer silently did nothing.
- four HOVER rows (`ink`, `ink-2`, both LEDs) over `CARD_STACK`. The hover BORDER is deliberately
  not gated against its own fill: it is the state CHANGE that identifies the affordance and is
  adjacent to the sheet on its outer edge, and gating it would pin the mix at a share too small to
  see (sunset's is the binding one at 2.89).

**DELIBERATELY NOT MODELLED — text painted STRAIGHT on the sheet (the head).** `over` is a BACKDROP
stack: what shows through a translucent token. The dots and the art are painted OVER the sheet under
the head's glyphs, which is a rendered-pixel question, and this theme has an owner-signed answer for
it — the G6.4 halo trade. Modelling them as full-area backgrounds there would demand near-white inks
and kickers on five palettes (measured, texture alone: neon `ink-2` 3.77 · sunset 3.81 + kicker 3.79
· rose 3.84 · aurora 3.82 + kicker 3.98 · forest 3.95). **Recorded as an open main-seat question**,
not taken silently.

**TOKEN EDITS — the minimal deltas (all "lighten toward white", the method §7.7 already uses):**

| palette | token | was → now | why (worst measured, before → after) |
|---|---|---|---|
| neon-purple | `ink-2` | `#9080c5` → **`#a294ce`** (+16%) | metric caption over texture+mark **4.07 → 4.54** |
| neon-purple | `led` / `led-dim` | `#7751c8`/`#725d9f` → **`#8968cf`/`#8370ab`** (+13/+12%) | card 2.54/2.53 → **3.31/3.26**; hovered row → 3.08/3.03 |
| sunset-orange | `led-dim` | `#af7866` → **`#b17c6b`** (+3%) | hovered row 2.89 → **3.02** (its card is opaque) |
| rose-pink | `ink-2` | `#e1a4aa` → **`#e2a6ac`** (+2%) | metric caption 4.47 → **4.54** |
| rose-pink | `led` / `led-dim` | `#dc6d78`/`#ad666d` → **`#dd737d`/`#bd8389`** (+4/+19%) | card 3.24/2.44 → **3.39/3.37**; hover 3.05/3.02 |
| aurora-violet | `ink-2` | `#a78dd0` → **`#b29cd6`** (+13%) | metric caption 4.38 → **4.53** |
| aurora-violet | `led` / `led-dim` | `#9851b6`/`#866295` → **`#a86dc2`/`#987aa5`** (+16/+15%) | card 2.49/2.50 → **3.36/3.37**; hover 3.04/3.06 |
| cyber-teal | `ink-2` | `#33a2b2` → **`#35a3b3`** (+1%) | metric caption 4.56 → **4.61** |
| cyber-teal | `led-dim` | `#3d6e79` → **`#527e88`** (+11%) | card 2.66 → **3.37**; hover 3.06 |
| forest-green | `ink-2` | `#5ebf8a` → **`#63c18e`** (+3%) | metric caption 4.43 → **4.51** |
| forest-green | `led-dim` | `#5e7e61` → **`#78937a`** (+16%) | card 2.49 → **3.39**; hover 3.05 |
| *(shared)* | `row-hover` | `accent 10%` → **`accent 5%`** | the premultiply above; 5% is the largest share slip's own dim LED survives (**3.06**) |

`slip` and `sunset-orange`'s inks are **untouched** — the light sheet is byte-identical to what the
owner signed off, and sunset's opaque card immunises everything but its hovered row. Every accent,
kicker, name, sheet stop, card alpha, button and mask value in the G6.4 table is unchanged.

**MEASURED PASS TABLE (the real run, `--project=mobile -g gacha`, 14/14 green).** Worst value per
column, floors 4.5 / 3 as before; `card` columns are the new stacks:

| | ink/card (grid) | ink-2/card (grid) | led/card | dim/card | ink/hover | ink-2/hover | led/hover | dim/hover | close glyph |
|---|---|---|---|---|---|---|---|---|---|
| neon-purple | 11.24 | 4.54 | 3.31 | 3.26 | 11.81 | 4.77 | 3.08 | 3.03 | 14.42 |
| sunset-orange | 10.45 | 6.97 | 3.40 | 3.28 | 9.63 | 6.42 | 3.14 | 3.02 | 12.64 |
| rose-pink | 8.38 | 4.54 | 3.39 | 3.37 | 8.48 | 4.59 | 3.05 | 3.02 | 13.20 |
| aurora-violet | 9.98 | 4.53 | 3.36 | 3.37 | 10.26 | 4.66 | 3.04 | 3.06 | 13.98 |
| cyber-teal | 12.44 | 4.61 | 4.25 | 3.37 | 12.36 | 4.58 | 3.85 | 3.06 | 14.71 |
| forest-green | 8.96 | 4.51 | 3.66 | 3.39 | 9.27 | 4.66 | 3.30 | 3.05 | 13.57 |
| slip | 17.57 | 6.89 | 5.79 | 3.30 | 16.32 | 6.40 | 5.38 | 3.06 | 16.65 |

**FALSIFIED, not merely green:** with neon's `led-dim` restored to `#725d9f` the gate fails the row
it should (`2.53:1 < 3:1`), which is the proof that the new stack is doing work rather than
resolving to a transparent no-op — the exact way the two mark tokens failed silently at first.

**OPEN AFTER THIS ADDENDUM (main-seat calls, not build items):**
- the head's dot-field/art overlap above — accept the G6.4 halo precedent as covering it, or model
  it and re-tint five palettes' secondary inks.
- the hover BORDER at 2.89 on sunset (ungated by the reasoning above).
- the owner device round still owns the LOOK of every value this addendum moved: the LEDs are up to
  19% lighter and two role lines up to 16% lighter.

---

**G6.6 ADDENDUM — THE TAB-FLIGHT RE-COMPOSITION (2026-08-06).** The owner ran the four-case device
probe R15 §7.1 asks for, on Chrome Android **and** Fennec, and the answer inverts G6.3/G6.4's whole
direction: **the extraction WAS the artefact.**

| Case | Composition | Chrome Android | Fennec |
|---|---|---|---|
| 1 | no names at all | **glass GOOD** | clarity shift |
| 2 | content region named, bar unnamed inside it | **glass GOOD** | clarity shift |
| 3 | content + bar named, flat siblings — **our G6.4 state** | **layered glass** + a **1px seam** at the group's top edge | **layered glass** |
| 4 | case 3 + `view-transition-group: nearest` (Chrome only) | identical to case 3 | n/a |

Owner, verbatim: *"several layers of glass, it adds one when the transition starts."* That is the
spec working as written — a named element is captured with its blur already baked into its image AND
has its computed `backdrop-filter` copied onto `::view-transition-group()` every frame (R15 §2.1c–d;
Blink implements the copy, §2.2). Two blurs, one bar. Case 4 kills option **A1** outright: nesting the
group does not undo the doubling.

Case 1 also corrects the claim that has stood in `gacha.css`'s bar block since G6.4 — that
`backdrop-filter` "cannot survive a View Transition capture on Blink". It survives fine; what it
cannot survive is being NAMED. And Gecko's degradation is in **all four** cases, i.e.
composition-independent (Bugzilla 1999295 confirmed on device) — **accepted as unwinnable**, and
deliberately *not* worth an engine branch, because the composition that is best for Chrome is also
the cheapest for Gecko.

**RULING (owner): adopt R15's A3 ≡ B1 — ONE root group for the tab flight, both engines, no branch.**

**AS BUILT** (`frontend/src/themes/gacha/gacha.css`, the M2 block; net **−80 lines**):

| Gone | Was | Why it goes |
|---|---|---|
| the `tab` arm of the `gacha-page` naming rule + its two pseudo rules | G6.3 | the extraction is the doubling's precondition |
| the `gacha-appbar`/`gacha-tabbar` names + all six pseudo rules, **and the `body:not([data-engine="gecko"])` branch itself** | G6.4 | they *are* case 3; the branch has nothing left to gate |
| the `gacha-reel` name + its old/new pair | G6.3 | with nothing extracted, the reel is back at its natural z-45 paint order **inside** the root snapshot — above the tab content for free, the pre-G6.3 behaviour. It also retires our one live use of the `animation: none`-on-a-group idiom (Gecko bug 2057752, a one-frame z-order flip) |

| Kept / new | |
|---|---|
| `::view-transition-old/new(root)` @ **380 ms** | THE flight, and now the whole of it: a plain UA opacity cross-fade |
| `gacha-page` + the `gacha-root-out/in` pair | survive for the **`detail`** morph alone — which is probe **case 2**, measured glass-good, and whose extraction is what keeps a root scale off gacha's fixed backdrop |

**THE SCALE IS GONE ENTIRELY — round 2, and it is the trap worth remembering.** This shipped first as
R15's option A3 describes it: the 96%/104% moved off the VT image onto an in-page `@keyframes`
entrance on `.tab.active`. On device it **jumped the outgoing page** — the old screen grew for a beat
before freezing — and the mechanism says it had to. `runViewTransition` stamps
`html[data-transition="tab"]` **before** calling `startViewTransition` (the pseudo rules must be in
scope when the transition begins), while the old state is captured **inside** that call. For one
commit the stamp is up with the LEAVING body still matching `.tab.active`, so a stamp-keyed in-page
animation fires on both sides — and it **cannot be narrowed**: the stamp is a document-level flag with
no notion of which side of the swap an element is on. Any future in-page entrance has to ride a
MOUNT-scoped mechanism (a key, a class the body sets when it becomes active), never this attribute.

**Owner ruling: the tab flight is a PURE OPACITY CROSS-FADE.** The outgoing page is pixel-frozen at
the tap and fades; the incoming one fades up; nothing scales anywhere. **`viewTransition.ts` is
untouched** — the whole slice is CSS at the same chokepoint.

**WHAT THE OWNER MUST RE-EYEBALL (the device round owns all of it):**
1. **The flight is FADE-ONLY now — neither page scales.** Two steps plainer than the prototype, and the
   second step is one the platform cannot give us cleanly here. Confirm it still reads as "one screen
   replacing another", and that the old page is pixel-frozen from the tap (no growth, no shift).
2. **Glass continuity** on the app bar and the tab bar through a flight — Chrome should now hold the
   blur steady end to end, with no layering and no pop at commit.
3. **The 1px rim/seam at the top of the bar should be gone** on Chrome (both its causes are: no named
   group edge, and `:scope { background: var(--bg) }` still blacks the root canvas).
4. **Gecko clunk** — three main-thread group animations are down to one (R15 §4.1), and the snapshot
   resampling blur (bug 2012228) is gone with the snapshot scale. Fennec should feel smoother, but its
   blur will still visibly soften for the flight and that is not fixable from here.
5. **Tap feel** — the reel must still sweep ABOVE the tab content (the G6.3 report, now solved by
   deletion), and rapid tab hammering must not glitch.

---

**G6.7 ADDENDUM — THE NAME FACE · THE STARS · THE ARCADE DROP · THE ORACLE'S BOTTOM EDGE
(2026-08-06).** Four owner asks that landed in the same wave as G6.6, all eyeball items, all measured on
device-width renders rather than reasoned.

**① THE MACHINE-NAME FACE — a picker, off R17.** R17's headline: the dossier name's `font-style: italic`
was a **synthetic shear**. `Shippori Mincho B1` publishes `style: "normal"` only (all twelve generated
`@font-face` blocks; the CSS2 API answers `ital,wght@1,800` with **HTTP 400**), so the browser was
mechanically skewing a Japanese mincho — the case MDN names as impeding legibility. The italic is gone
from the dossier `h2`; the CARD plate keeps its own, because that one is the **prototype's** (`.plate b`)
rather than ours, and was not in question. *(Flagged for the round: on all three faces the card's italic
is still synthesised.)*

The face itself became a **setting**, not a token default — the owner saw Bungee live and ruled it "too
bulky as a default":

| `nameFont` | face | latin woff2 | RFN | notes |
|---|---|---:|---|---|
| **`mincho`** (default) | Shippori Mincho B1 900 | *(already shipped)* | no | the theme's own serif, now upright |
| `bungee` | Bungee 400 | 14.0 KB | no | arcade signage; **CAPS-ONLY** (lowercase glyphs *are* capitals) |
| `maru` | Zen Maru Gothic 900 | 11.3 KB | no | Yoshimichi Ohira — same hand as `--font-body`'s Zen Kaku |

Built as the **`dossierPalette` pattern end to end**: a seg row declared second in the registry (so the
two identity pickers sit together under the accent row) → `useThemeSetting` → `body[data-gc-namefont]`
(GachaRoot's fourth body attr, cleared on unmount) → one tokens.css block per alternate, with `mincho`
expressed as the **absence** of one (slip's idiom). No ledger extension was needed: `themeSettings` is an
open map and the row carries no `swatch` (these options differ by SHAPE — a colour chip would preview
nothing). **SCOPE (owner):** the pair `--gc-name-font` / `--gc-name-weight` — renamed off `--gc-dossier-*`
because it is no longer dossier-scoped — drives the dossier `h2` **and** the capsule card's plate. The
banner/promo titles are ROSTER copy and deliberately keep `--font-body`. Only family + weight ride the
tokens; each surface keeps its own size.

The two faces are **committed latin-only subsets**. `scripts/gen-theme-fonts.mjs` grew one optional
`subsets` field per face (extend-don't-migrate) — asking the CSS2 API for a JP `text=` subset of a font
with no Japanese returns a file of .notdefs carrying a `unicode-range` that would then shadow the real JP
faces. Runtime Japanese in a machine name falls to the system stack by design (council L12). `fonts.ts`
warms **only Bungee**: an unpainted `@font-face` is never fetched, so the unpicked alternate costs zero.

*Regeneration was clean and is worth recording as the method:* the first re-run reproduced all twelve
existing woff2 **byte-for-byte** (so upstream had not drifted), and the second — after `settingNameFontDesc`
added the one new glyph **名** — changed exactly the six JP files (+644 B) and left all eight LATIN files
byte-identical. Committed total **219,568 B**, against the guard's 300 KB ceiling.

**MEASURED NAME FIT** (393px, the dossier's 181px line box — `.gc-dossier-title` 241px minus the close
disc's reserved 60px). Advance width at 27px:

| name | mincho | bungee | maru | lines (mincho / bungee / maru) |
|---|---:|---:|---:|---|
| `emma` | 83 | 84 | 72 | 1 / 1 / 1 |
| `corsair` | 95 | 131 | 82 | 1 / 1 / 1 |
| `workstation-alpha` | 250 | 319 | 220 | 2 / 2 / 2 |
| `media-server-basement-01` | 361 | 434 | 334 | 3 / 4 / 2 |

**Nothing overflows or clips on any option** (`overflow-wrap: anywhere` wraps; the head grows from 152px
to 165.5px at four lines and the sheet grows with it). Bungee fits **~9 lowercase characters per line**
against mincho's ~12 — it is the widest of the three, which is the trade the owner already saw.

**② THE RARITY STARS — drawn, off R16.** The ★ text glyph is replaced on both rows by **one primitive**
(`GachaStar.tsx`): candidate **C2**'s squat round star, filled, with a dark contour. The `★` string
survives where it is a string — the banner's `★N RATE` pill. `starsFor`/`isHighStar`, the aria-hidden row
and the label pattern are untouched; `fill: currentColor` keeps the whole `--gc-star`/`-hi`/`-dim` tinting
story working through the row's `color`.

*A mechanic settled by pixel probe, because the sheet's CSS lied about it:* the candidate sheet set
`stroke-width` on the `<use>`, which **never reached** the polygon in the shadow tree — three wildly
different CSS widths rendered **byte-identical PNGs**, while a control symbol without the presentation
attribute varied. What the owner actually picked was the symbol's own `stroke-width="9"` in **user
units**, i.e. 7.3% of whatever size the row asks for. The primitive keeps it as an attribute, so the
contour scales with the star and one component serves both rows. Its viewBox is cropped to the stroked
extent, which makes `--gc-star-size` mean the star's real **ink** width.

**MEASURED, and it un-inverts R16's finding:**

| | ink | gap | pitch | pitch÷ink |
|---|---:|---:|---:|---|
| card, shipped before | 11.4 | — | 14 | 1.23 |
| dossier, shipped before | 9.5 | — | 13 | **1.37** ← smaller AND looser than the card |
| **card, now** | **10** | 3 | 13 | **1.30** |
| **dossier, now** | **11.5** | 3.5 | 15 | **1.30** |

Both land on the reference family (Arknights 1.32 · Epic Seven 1.31 · Genshin detail 1.33) and the detail
surface is the bigger one. The card landed at **10** in a second round: candidate C2's own 7px read "way
too small" on device, and 10 is the ink R16's nearest measured analogue uses — the **Arknights operator
card, ~10px at pitch 13.2** — while still sitting under the 11.4px of glyph ink the theme shipped before,
which is what the original "fleet: small" asked for.

**THE TREATMENT SPLITS PER SURFACE** (owner rulings off the live states, same day). One primitive, one
set of polygons; each surface says how they are painted, so nothing branches in TS:

| | stroke | drop | why |
|---|---|---|---|
| **dossier tab** | `currentColor` (self) | **none** | a quiet tab on a sheet: the stroke's job is to fatten and round the silhouette into one solid, plumper star. Owner: *"they look better without."* |
| **fleet card** | **accent** (`--gc-star-edge`, `var(--accent)` at 85%) | **yes** (`--gc-lift-color`) | this row sits on ARTWORK, and a frame can be bright anywhere behind it. Owner: *"a blue outline… the accent color outline"* for visibility |

The candidate sheet's contrasting **dark contour is retired on both** — the owner read it as an outline.
`paint-order: stroke fill` keeps the card's accent stroke an EDGE and not a ring: only its outer half
survives, **≈0.47px** at the row's 10px ink. Both the stroke width (**9**) and the drop offset (**12**)
are tokens in the primitive's **user units** (its viewBox is 96.5 wide), so both scale with the row —
the drop lands at **1.244px** measured, inside the 1–1.5px bracket the ruling named. Neither accent paint
is `currentColor`, which is what keeps `.hi` re-tinting the STAR alone — verified in the render: a `.hi`
star's fill is `rgb(255,143,168)` while its stroke and drop stay accent.

⚠ **THE OVER-ART CHECK, and it is a real trade the device round owns.** Measured on the shipped fleet at
393px (brightest single pixel of artwork under each card's star row, against each star paint):

| card | brightest art pixel | gold | rose-gold | accent edge |
|---|---|---:|---:|---:|
| 0, 1 | `rgb(255,255,255)` — a white highlight | **1.41:1** | **2.15:1** | **2.62:1** |
| 2 | `rgb(75,66,67)` | 6.88:1 | 4.51:1 | 3.71:1 |
| 3 | `rgb(0,0,0)` | 14.85:1 | 9.75:1 | 8.01:1 |

Against a **white** highlight no star paint clears the 3:1 non-text floor; the accent edge is the best of
the three at 2.62. The retired dark contour scored **~19.9:1** there — separation on bright art is exactly
what it was buying. The card row also sits ABOVE the scrim's ramp (`--gc-card-scrim` is transparent to
42%), so it is genuinely on unscrimmed art. Recorded, not designed around: the owner ruled the accent edge
in after seeing both live, and the worst case is a single specular pixel rather than the typical backdrop.

The dossier's filled dark **lozenge became C4's off-centre hairline tab** — 1px rim, translucent
palette-derived fill, no black — and `--gc-dossier-badge` stays (the close disc still mixes it). Two
corrections the renders forced:

- **C4's literal `right: -52px` does not survive variable content.** The sheet only ever drew a ★5 tab. At
  393px the tab runs **31.5px (★1, the ruled floor — the commonest tab on a real fleet) to 91.5px (★5)**,
  and a fixed right offset makes the ★5 tab lap the portrait by 39.5px while the **★2 tab misses it by
  5.5px**, floating free in the title column. It now straddles the frame's trailing edge (`left: 100%` +
  a −50% self-shift), so every rung laps proportionally: **15.75 / 23.25 / 45.75px** at ★1 / ★2 / ★5.
- **The contrast gate caught the fill on slip.** The tab's sheet-derived formula is near-white on the
  light sheet: gold measured **1.32:1** against a 3:1 floor. The token's DIRECTION now follows the
  surface, exactly as `--gc-dossier-close-bg` does — the light sheet takes the dark lozenge thinned to
  **78%** (measured over its head band: 72% → gold 3.99 / rose 2.62 ✗ · **78% → 4.79 / 3.15 ✓** ·
  84% → 5.79 / 3.80), the dark sheets take their own top stop at 72% (11.5–12.0 / 7.6–7.9). The gate's two
  star rows were **re-stacked** onto the new fill + the head band's texture and watermark — the same
  correction G6.5 made everywhere else. **14/14 green.**

The glyph's 12px gold glow retires with the glyph (R16 §2: the contour is the legibility), and
`--gc-star-glow` / `--gc-star-shadow` / `--gc-star-shadow-dim` are deleted rather than left orphaned.

**③ THE ARCADE DROP on the two art surfaces.** kit.css's composer-skin signature — `<lift> <lift> 0` at a
60% accent mix — now runs through the capsule cards and the dossier portrait. Both distances were
re-weighted on the owner's device round: the kit's 3px reads thin on artwork, so the **cards go to 4px**
("slightly thicker, not too much, like the button") and the **portrait to 5px**, one step further again
because it is the largest single image the theme shows. gacha mints its **own**
`--gc-lift` / `--gc-lift-color` rather than reading `--arcade-lift`, which is declared ON `.kit-composer`
and would tie a card's elevation to a composer picker value.

*Two things measurement decided:*

- **Where the card's drop can live.** The card is masked to the capsule silhouette AND `overflow: hidden`,
  and a mask is applied after filters: pixel-probed, **`box-shadow` and `filter: drop-shadow()` on the
  card each paint NOTHING** in the offset band, while a pseudo on a wrapper wearing the same mask paints
  correctly (and carries the 315° notch into the shadow). So `GachaCard` gained a `.gc-slot` wrapper —
  the grid item, which now carries the SHAPE classes because they are geometry. Per the owner's fit
  ruling the slot keeps the footprint the track always gave a card and the CARD is inset by the lift:
  measured at 393px, slot ratios are **exactly 1.25 / 0.75 / 1.778** (feat / pair / wide, unchanged),
  card inset 3/3, **no track overflow**, wallpaper on and off.
  *(Falling out of the same probe: `--gc-card-shadow`'s outer `0 16px 34px` half has **never** painted,
  for exactly this reason. Recorded on the token; not trimmed, since removing it changes no pixel.)*
- **Where the colour token belongs.** With `--gc-lift-color` on `:scope` the drop rendered **TEAL** — a
  custom property substitutes its `var()` where it is DECLARED and is inherited already-substituted, so on
  `html` it took the KIT's base `--accent`, which gacha only re-points on `body`. This is the §14.6 trap
  `--accent-ink` documents, and it was caught by a pixel sample rather than by review. The colour moved to
  `body`; the distance is a constant and stays on `:scope`.

The dossier portrait takes a plain `box-shadow` — it is a rounded rect with no mask and nothing clipping
it (the sheet's own `overflow: hidden` is 16px away, measured) — with the crisp offset listed FIRST so it
reads over the soft contact shadow. Verified in pixels at 3px: the drop is present at the portrait's edge
and gone 8px out. **It then went to `--gc-lift-lg: 5px`** on the owner's device round ("a little too slim"
at 3px — a 104×138 picture on a wide sheet carries a heavier offset than a 176px card in a 2-up grid), and
the cards followed to **`--gc-lift: 4px`** in the same round. Two tokens, one family; the card's own inset
reads its lift, so the track's footprint follows automatically.

**④ THE ORACLE'S BOTTOM EDGE — and it ends up SPLIT IN TWO.** REPORTED: once ghosted, the sticky block
ends in a clean-cut horizontal line behind the chat log, and the follow-up named the worst of it — the
**SCANLINE**, whose straight hairlines all stop dead on one row. A **static vertical alpha mask** over a
new `--gc-oracle-edge-fade` (48px — M7's fourth tunable, on the same "taste on a real phone" reasoning as
its other three) answers both halves; the mask is a token (`--gc-oracle-edge-mask`) because an alpha ramp
is written in colours and gacha authors colours only in `tokens.css`. Two further owner rounds then split
where it applies, because the halves want different lifetimes:

**(a) THE COMB dissolves ALWAYS**, for the whole of fade mode — the owner likes the softened comb at rest
as well as ghosted — so the mask sits on `.gc-oracle-scan` itself. A mask is applied to an element's own
rendering *before* it is blended into its parent, so the comb's alpha ramps down first and
`mix-blend-mode: screen` then contributes nothing at the bottom. Measured, masked vs forced-off, over the
last 24px (x-averaged, so the horizontal comb survives the average):

| scan phase | 0% | 25% | 50% | 75% | 99% |
|---|---|---|---|---|---|
| Chromium masked / unmasked | 2.84 / 5.47 | 3.95 / 7.00 | 3.64 / 5.61 | 3.52 / 4.55 | 3.05 / 5.82 |
| Gecko masked / unmasked | 3.38 / 8.57 | 6.17 / 10.10 | 6.27 / 8.75 | 6.71 / 7.95 | 3.38 / 8.57 |

⚠ **The strength PULSES over the 7 s loop, and that is inherent to the pinned mechanism** — reported
rather than worked around. `.gc-oracle-scan` is 28px taller than the block and *translates* down by
`--gc-scan-travel`; a mask is authored in the element's own space, so it travels with it. The reduction
runs ~53%→~24% (Chromium) and ~61%→~16% (Gecko) across a cycle. Any fix costs the static-mask property
(an animated mask position) or a wrapper node, so it is left as an observation for the eyeball round.

**(b) THE ART's edge dissolves only once the block is FULLY GHOSTED**, so at rest the crisp bottom edge —
the designed hairline look — comes back. The block's mask is gated on a BOOLEAN the M7 driver stamps,
`body[data-oracle="fade"] .gc-oracle[data-gc-ghosting]`. A boolean and not the ramp, deliberately: a mask
whose *geometry* tracked `--gc-oracle-p` would re-rasterize a gradient every scroll frame, which is the
paint cost M7's entire one-write-per-frame design exists to avoid. `GachaAgent`'s driver already computes
`p` each frame; it now also flips the stamp, writing the DOM **only on a flip**.

**THE THRESHOLD moved to the END of the ramp** after the owner saw the engage POP mid-scroll: `oracleGhosting`
turns on at **p ≥ 0.95** and releases at **p < 0.88** (a Schmitt gap — a scroller parked on a single
threshold wobbles a pixel and would toggle the attribute, and therefore the mask, every frame). At 0.95 the
block's own opacity is already ≈0.32, i.e. at `--gc-oracle-floor`. Measured cost of the flip ITSELF (the
same `p` rendered with the stamp on vs off, mean over the bottom 56 rows, 0–255):

| ramp position | block opacity | Chromium | Gecko |
|---|---|---|---|
| p = 0 *(the first cut's threshold)* | 1.00 | 3.25 | 2.92 |
| p = 0.5 | 0.64 | 1.73 | 1.67 |
| **p = 0.88** *(release)* | 0.37 | **1.20** | **1.32** |
| **p = 0.95** *(engage)* | 0.32 | **1.22** | **1.23** |

— **~2.7× quieter than at the ramp's start, and the same in both directions**, which is what makes the
hysteresis gap safe to cross either way. Fully ghosted, with the block mask on top of the scan's at its
worst phase, the comb reads **0.32 (Chromium) / 0.51 (Gecko)** against 0.97 / 1.69 with the block mask off.

Both masks are static and mode-scoped: outside `data-oracle="fade"` nothing changes at all —
`data-oracle="scroll"` renders byte-identically.

**⑤ THE PEEK DETENT (owner report, same round: the stars CLIP at the half-closed sheet).** Measured at
393px with a ★5 tab, the deepest mark: the peek fold sat at the sheet's **+166px** with the tab's bottom
rim at **+169** — **3.1px past it, clipped** — and the stars themselves only 1.9px clear before their own
drop, while the portrait's thickened 5px offset ended 0.9px clear.

Fixed **gacha-scoped**, as ruled, and by a lever that is this element's own: BottomSheet derives the peek
reveal as `[data-bs-peek].offsetTop + .offsetHeight + 14`, and gacha's marker IS `.gc-dossier-head` — so
its box height *is* the detent. Its bottom padding goes **14 → 24px**, which is also clearance it now owes
on its own terms (the rarity mark used to sit inside the portrait; since G7 it hangs 9px past the frame,
and the portrait's drop grew). **Peek 166 → 176px**: the tab's rim is now **6.9px above** the fold, the
stars 11.9px, the portrait's drop 10.9px. Nothing kit-wide moved.

*(Noted while measuring, deliberately NOT fixed here: the kit's formula loses gacha's handle strip,
because `.gc-dossier-head` is `position: relative`, so its `offsetTop` reads 0 rather than its distance
from the sheet's top — gacha's peek has always been ~22px shorter than the kit intends. That is a KIT
arithmetic question; the ruling scoped this to gacha, and the rule above fixes the symptom inside gacha's
own box.)*

**OPEN AFTER THIS ADDENDUM (device-round items, not build items):**
- **Star legibility over a white art highlight** — the table in ② above. The accent edge is the best paint
  available at 2.62:1 and the dark contour that scored 19.9:1 is the thing the owner ruled out.
- **The card plate's italic is still synthetic on all three faces** (no shipped face publishes an italic).
  It is the prototype's own styling, so it was left alone rather than changed unasked — the owner's call.
- **A 4-line machine name meets the rarity tab.** Measured under `mincho` at 393px: 1–3 lines clear the
  tab by 21.5px or more (up to ~21 characters), and a 4-line name (~30 characters) overlaps its top edge
  by **5.5px** in the 118–150px band. Beyond the owner's own fleet (4–7 characters), and no clipping —
  recorded rather than designed around.
- The whole wave is eyeball work: star size and packing, the tab's fill and lap, the drop's weight on
  cards vs portrait, and the 48px dissolve band are all one-token tunes.


---

**G6.8 ADDENDUM — THE RECONCILIATION WAVE (2026-08-06).** Codex's wave-12 review returned **DO NOT SHIP**
on one finding and five lean ones; the owner added two rulings of their own in the same round. All eight
are folded in here.

**① THE CONTRAST GATE's watermark model splits (the blocker).** `gacha.css`'s mask note records TWO
transmissions at the metric tiles — **0.66** at the VALUE row (y 161) and **0.26** at the CAPTION row
(y 182) — but tokens.css exported only the 0.26 model and the gate used it for BOTH tile inks. So the
16px values, which sit 21px higher under 2.5× more art, were measured against a backdrop **6.4 points of
alpha weaker** than the one they are painted on (4.3% modelled vs 10.6% real at the owner's 0.16 knob).
That is the FALSE-PASS direction: a palette could clear the gate while the real metric row failed.

`--gc-dossier-mark-grid` is retired for **`--gc-dossier-mark-value`** (knob × 0.66) and
**`--gc-dossier-mark-caption`** (knob × 0.26), each derived from the owner's knob exactly as the old one
was, and `contrast.spec.ts` gains `VALUE_STACK` / `CAPTION_STACK` so neither ink is measured on the
other's band.

**RE-MEASURED — and nothing needed re-normalising.** The correction tightens `--gc-dossier-ink` by up to
2.0 contrast points; every palette still clears 4.5 with margin, so no token moved:

| palette | ink / VALUE (correct) | ink / caption (old model) | delta | ink-2 / CAPTION |
|---|---:|---:|---:|---:|
| slip | 17.57 | 17.57 | 0.00 | 6.89 |
| neon-purple | **9.21** | 11.21 | −2.00 | 4.52 |
| sunset-orange | 10.45 | 10.45 | 0.00 | 6.97 |
| rose-pink | **6.99** | 8.37 | −1.38 | 4.53 |
| aurora-violet | 8.29 | 10.00 | −1.71 | 4.54 |
| cyber-teal | 10.70 | 12.41 | −1.71 | 4.60 |
| forest-green | 7.45 | 9.00 | −1.56 | 4.53 |

*(slip and sunset-orange are 0.00 by construction — an opaque card, and slip's watermark is `0` besides.
Tightest is rose-pink at **6.99**, 2.49 points of headroom. Modelled mark alphas: value **0.106**,
caption **0.043**.)*

**FALSIFIED, three runs, not merely green.** Dimming the shared `--gc-dossier-ink` to `#b6b6b6` — a value
chosen to land inside the false-pass window — makes rose-pink read **3.81 (FAILS)** on the new VALUE
stack and **4.57 (PASSES)** on the old shared-caption stack. That is Codex's finding reproduced end to
end: the old model would have shipped it. Restored ⇒ **14/14 green**.

**② THE NAME FACE's PREWARM follows the resolved setting.** `fonts.ts` awaited Bungee unconditionally,
which was wrong in both directions: every DEFAULT user downloaded and awaited a face they never paint,
and a synced `maru` was not warmed at all — so activation could finish before Zen Maru was ready and the
dossier name would land in the fallback and swap under the owner, the exact FOUT the module exists to
prevent. `loadFonts` now resolves `nameFont` through `resolveThemeSetting` (at CALL time, which keeps the
settings→registry→theme→fonts cycle benign) and warms `NAME_FACE[value]`: **mincho → nothing extra** (it
IS `--font-display`, already covered by Shippori's two weights), **bungee → `400 1em 'Bungee'`**, **maru →
`900 1em 'Zen Maru Gothic'`**. The mapping is exported pure (`nameFaceProbes`) and tested for all three
values, for coverage of every declared option, and for an unknown value warming nothing.

**③ FONT GENERATION is now atomic, validated and hashed.** The generator emptied the committed directory
BEFORE going to the network, so a failed fetch or a prettier that would not start left tracked faces
missing or half-updated. It now builds into `fonts.staging` (a SIBLING, so the swap-in `rename` stays on
one filesystem) and replaces the destination only after every fetch, write and format has succeeded;
`subsets` values are validated against `jp | latin` and throw on anything else, instead of silently
falling through to Latin. Each file carries a **sha256** in the manifest and `gachaFonts.test.ts` asserts
it against the bytes on disk — size + topology let a wrong-but-same-size woff2 through. No `@font-face`
parsing was added (ruled out of scope).

**Re-run to stamp the hashes: all 14 woff2 byte-identical.** Reproducibility holds and Google has not
drifted; only `manifest.json` changed. Guard falsified by zeroing one hash (fails with the file named),
then restored.

**④ THE CARD's HIT AREA now matches what is visible.** The accent drop was painted by a pseudo on an inert
`.gc-slot` wrapper while the `<button>` sat inset by the lift, so a thumb landing on the visible drop hit
nothing. The **BUTTON is now the grid item** — it owns the cell edge to edge, carries the shape classes and
the drop pseudo — and the masked surface became an inner **`.gc-card-face`**, inset by the lift. The split
is still forced (a mask is applied after filters, so `box-shadow`/`drop-shadow` on a masked element are
erased — pixel-probed in wave 1), but the unmasked box is now the semantic control rather than a wrapper.
Every positioned child keeps the face as its containing block, i.e. the same box it always had.

**VERIFIED at 393px, both wallpaper modes, all shapes:** hit-tested at six extreme points per card —
`dropRight`, `dropBottom`, `dropCorner`, both top corners and the centre — **all six resolve to the
button on feat, pair, pair-sleep and wide**. Ratios unchanged (**1.25 / 0.75 / 1.778**), face inset 4/4,
no track overflow, the VT morph hook (`currentTarget.querySelector("img")`) still resolves, the reel and
the wave-1 badge-suppression selectors are untouched. The drop still paints identically: the strip right
of the face reads accent for exactly **+0…+3px** and backdrop at +4 (= `--gc-lift`), the 315° notch shows
backdrop (the shadow is notched too) and nothing paints above the card's top edge.

**⑤ TWO STALE VT COMMENTS** corrected — the M2 block header still read "the scale done IN THE PAGE" and
the M3 block still said the tab flight "scales the arriving `.tab` in the page". Both now describe the
root-only opacity cross-fade, and the M3 note points at the capture/stamp reason no in-page scale is
available. This is the comment that would otherwise invite a maintainer to "repair" the absent scale.

**⑥ THE × CLOSE JUMP (owner bug, root-caused then fixed).** On the fleet at scrollTop 0, opening a dossier
from a card the fold CUTS and closing it with × scrolled the page behind. Instrumented on the live app:
the writer is **`BottomSheet.tsx:310`**, `triggerRef.current?.focus?.()` **without `preventScroll`**,
firing `SNAP_MS` (420 ms) after close — measured **scrollTop 0 → 226 (Blink) / 0 → 230 (Gecko)**, which is
a **CLAMP to the page end** (maxScrollTop 230), not the 31.5px the card needed. Nothing else wrote scroll:
no `scrollTop=` setter call, no `scrollIntoView`, and the move was inside the `focus()` call rather than at
the VT finish or the React commit.

*The path asymmetry is diagnostic and is now pinned by tests:* **Escape does not jump** (focus never left
the opener, so the claimed-focus guard skips the restore), **tap-outside does not jump**, and **× does**
(focus was inside the sheet, so the opener has to be focused back). The fix is one argument —
`focus({ preventScroll: true })` — which keeps SC 2.4.3 and drops only the scroll. Re-measured after:
**0px on both engines, both close paths, with focus still restored to the card.**

Three `BottomSheet` tests pin the guard's branches, including the one the live investigation could not
observe firing: **focus fallen back to `<body>` DOES restore** (`document.body` is explicitly excluded from
`claimed`) — so that branch is benign, not broken. A note for whoever reads the guard next: it tests
containment against **`.bs-sheet`**, so the full-screen `.bs-catch` dismissal button counts as *outside*.
Falsified by removing `preventScroll` (two tests fail), then restored.

**⑦ THE FLEET STARS grew again (owner).** "Smaller than the dossier ones; something around those lines" —
the card ink goes **10 → 11px** with the gap **3 → 3.3px**, so the two surfaces read one scale and the
ratio stays exactly **1.30** (the dossier is 11.5 / 3.5, also 1.30). The rule that sets the size changed
with it: the card no longer borrows another game's card metric (R16's Arknights analogue at 10px), it
sits one step under the dossier by construction. Tokens only — no literals. Measured at 393px on every
shape: row **68.2 × 11**, ink 11, pitch 14.3, ratio 1.300, inside the face on feat/pair/wide, **47px clear
of the state chip** (236.5 on wide) and **121–153px clear of the plate** — no collision anywhere.

**⑧ THE DROP FAMILY TAKES THE THEME'S FLAT ACCENT, SOLID (owner ruling).** "Follow the theme, the actual
same colour for all of those things." The drops shipped for a day as `color-mix(in oklch, var(--accent)
60%, transparent)` — the KIT composer skin's own formula, borrowed with the signature — which reads as a
*washed* accent rather than the accent. `--gc-lift-color` is now **`var(--accent)`**: the derivation the
theme already hands its controls (`--accent-fill`'s first stop is this same `--gc-brand-1`), re-pointed
rather than re-typed, so all eight variants move with it. One token still feeds the whole family — cards,
dossier portrait and the stars' own offsets — so "all of those things" is one edit and cannot drift.

⚠ **A CORRECTION TO THE PREMISE, worth recording:** the brief assumed the active tab paints with
`--accent-fill`. It does not. Under gacha the tab-bar indicator is a **WHITE pill** (`--gc-ind-fill:
#ffffff`) wearing a **hard offset shadow** (`--gc-ind-shadow`) — it is the SEG's active chip that takes
`--accent-fill`. So the thing the owner is matching is the indicator's *shadow*, and the flat accent hits
it almost exactly. Measured, `--gc-lift-color` vs `--gc-ind-shadow` per variant:

| accent | `--gc-lift-color` = `--accent` | indicator's hard shadow | match |
|---|---|---|---|
| arcade · midnight · indigo | `#ff6cae` | `#ff6cb1` | 3/255 of blue apart — the palette note's deliberate near-trio value, flagged "do not silently unify" |
| ember | `#ff6f52` | `#ff6f52` | **exact** |
| glacier | `#7c6cff` | `#7c6cff` | **exact** |
| nebula | `#eb77ea` | `#eb77ea` | **exact** |
| eridu | `#3a86ff` | `#3a86ff` | **exact** |
| jade | `#5bae49` | `#5bae49` | **exact** |

**Five of eight are byte-identical to the chrome the owner is matching**, and the other three differ by a
value the theme keeps separate on purpose. Nothing was minted to achieve it.

**Wallpaper check:** the drop pixel is now **identical with the wallpaper on and off** (`255,108,174` in
both, sampled on the card's drop band) — an opaque colour has no backdrop to composite against, where the
60% mix used to land differently on `--surface` and `--gc-card-wall`. The `--gc-star-edge` stroke keeps its
85% mix deliberately: it is not a drop but a 0.47px stroke half sitting ON the gold, and the sliver of
translucency is what stops it reading as a hard ring.

**Gate: indifferent.** No gated or advisory pair reads `--gc-lift-color` — the drops are decorative
(checked across `e2e/contrast.spec.ts` and `contrast-matrix.ts`), and the contrast sweep is unchanged at
14/14.

⚠ **COHERENCE QUESTION FOR THE MAIN SEAT (reported, NOT changed — the kit signature is a separate owner
ruling, 2026-08-03).** The kit's arcade composer still paints `oklch(… / 0.6) 3px 3px 0`. Under gacha it is
now both **lighter** (60% alpha vs solid) and **thinner** (3px vs the cards' 4px and the portrait's 5px)
than every drop beside it. If the owner wants one language end to end, the composer skin is where the
remaining delta lives.

**⑨ THE PLATE's NAME TAKES C6 — THE GRADIENT-CLIPPED FILL (owner's pick off the name-effects sheet).**
*(An earlier cut of this item shipped a `::first-letter` capital with a hard offset; the owner picked C6
from the sheet instead and that version was REMOVED, tokens and tests with it. C1, the accent initial, is
deferred to a later session and deliberately NOT built.)*

`.gc-card .plate b` now paints `--accent-fill` clipped to its glyphs — the app-bar wordmark's treatment,
one surface down — at `--gc-fill-spread`'s calm window with `background-position: 50% 0`. Verbatim from
the sheet, including the part that is a finding rather than a style:

**IT SHIPS SHADOWLESS, and that is VERIFIED incompatibility, not taste** (sheet §4.3): `text-shadow` paints
ON TOP of a `background-clip: text` fill, so the plate's `--gc-plate-shadow` halo would flood the
letterforms it exists to sit behind. The rule states `text-shadow: none` explicitly rather than trusting
that nothing upstream sets one — the kit has the same gotcha from the other direction (an INHERITED
text-shadow paints inside gradient-clipped glyphs, which is why the clear-appbar wordmark nulls the kit's
halo). `--gc-plate-shadow` therefore has no live consumer; it is kept, annotated, because it is the
prototype's own value for this surface and the treatment is a picked candidate the owner may walk back.

**(a) RENDER — both engines, all three faces, no wrapper needed.** The sheet applied C6 to an inline
element and so do we: `.plate` is `display: grid`, so the `b` is a blockified grid item — measured
`display: block`, `background-clip: text`, `color: rgba(0,0,0,0)`, `text-shadow: none`, `background-size:
240% 100%`, `background-position: 50% 0` on Chromium AND Gecko under mincho / bungee / maru. Glyph ink is
present in the accent range in every combination, a long name still wraps inside the plate
(`overflow-wrap: anywhere` untouched) and **nothing overflows the plate box** — checked with
`media-server-basement-01`.

**(b) CONTRAST — a new gated pair, and no palette needs tinting.** The name's INK is now the accent ramp,
so it is gated like one. The fg is a new **`--gc-name-fill-window`**: `--gc-fill-spread` means only the
ramp's middle 1/2.4 is ever visible (t = 0.2917…0.7083), so gating `--accent-fill` itself would measure two
colours the glyphs cannot show — the G6.5 "modelled a paint the screen does not make" class, one axis over.
The window is two `color-mix`es of the same two brand tokens, so every accent re-derives it; the gate's
existing `<image>` worst-stop handling does the rest (and it asserts a gradient parses to stops, so the
pair cannot pass vacuously — checked, the token resolves to `color(srgb …)` and the gate's regex covers it).

The BED is the card's `--surface` — the scrim's transparent end, deliberately: the plate sits where the
scrim is nearly solid, which is darker and kinder, so the light end is the conservative direction. The
ARTWORK under the scrim is not modelled (art is not a token — the G6.5 boundary), and losing the plate's
dark halo to the clip is exactly the trade C6 was picked knowing.

| accent | visible calm window | vs `--surface` | vs the plate bed | 3.0 | 4.5 |
|---|---|---:|---:|---|---|
| arcade | `#da67c6 → #a561e7` | **4.57** | 5.10 | ✓ | ✓ |
| midnight | `#da67c6 → #a561e7` | 4.89 | 5.22 | ✓ | ✓ |
| indigo | `#da67c6 → #a561e7` | 4.63 | 5.14 | ✓ | ✓ |
| ember | `#ff6665 → #ff5880` | 5.79 | 6.41 | ✓ | ✓ |
| glacier | `#6682ff → #45a2ff` | 5.10 | 5.71 | ✓ | ✓ |
| nebula | `#d480ed → #b38df1` | 6.66 | 7.42 | ✓ | ✓ |
| eridu | `#379efc → #32c0f8` | 6.51 | 6.99 | ✓ | ✓ |
| jade | `#4eb25d → #3cb879` | 6.32 | 7.11 | ✓ | ✓ |

**The floor question, answered rather than assumed.** At 20px with `--gc-name-weight` 900 (mincho/maru) the
name is ≥18.66px AND bold ⇒ WCAG **large**, floor 3.0; the feature card's 27px clears the ≥24px rule
outright. ⚠ Under **BUNGEE the weight is 400**, so a 20px pair/wide name is *not* large and its real floor
is 4.5 — but **every accent clears 4.5 anyway** (worst: arcade at 4.57), so the caveat costs nothing today.
The gate is set at 3.0 as briefed; if a future accent lands between 3.0 and 4.5 this is the note that says
Bungee makes it a real failure.

⚠ **THE ONE HAND-KEPT VALUE in the window token:** its 29.17% / 70.83% stops are `--gc-fill-spread: 240%`
computed by hand, because CSS cannot do that arithmetic inside `color-mix`. Moving the spread means moving
them. Flagged in the token and in the gate pair.

**OPEN AFTER THIS ADDENDUM:** the composer-vs-cards drop delta above. The wave-1 open items stand (the card plate's synthetic italic;
the 4-line-name/rarity-tab overlap; star legibility over a white art highlight; the scan mask's phase
pulse).

**R19 ADDENDUM — THE CARVED STARS · THE CARD FACE AXIS · THE CLOSE CORNER (2026-08-07, the owner's live
day round).** Four rulings landed live, each committed separately:

**① THE CLOSE CORNER, finished.** The disc's badge mix thinned 78%→55% (the owner's re-look superseded
G6.4's "more opaque than not": at 78% it read as "an opaque foreign blue" — at 55% the sheet's own palette
tints through, so the navy reads as a dimming of THIS dossier). The drawn × walked 12→14px — the one step
that keeps the even-child exactness rule (38 = 12+14+12, zero centring offset on both engines). Gate
re-measured: 74/74.

**② THE CARD STARS ARE CARVED (R19).** The owner walked the treatment through outline-only+14px (drop
retired, "they don't look that good with the shadow") and then, off the commissioned candidate sheet
(`research-sheets/star-carved-candidates.html` — six treatments over the white/dark/busy art crops, each
cost-labeled), picked **variant E, the blurred inner shadow** ("I like it that much"): the star's own
colour falling into shadow along its top inner edge, the letterpress deboss cue. Ships as
`filter: url(#gc-star-carve)` on the card row alone — the def in `GachaStar.tsx` (GachaStarDefs, mounted
by GachaFleet; presence PINNED in gachaFleet.test.tsx because a dangling `url(#)` unpaints the element on
Gecko), `primitiveUnits="objectBoundingBox"` so the carve scales with any `--gc-star-size` (probe-verified:
the oBB fractions render byte-alike to the sheet's user-unit form at 14px and 56px), flood ink =
`--gc-star-carve-ink` (the sheet's own `#120726bf`, one ink for gold/rose/dim — the construction is
alpha-based). **This is a §14.11 waiver, owner-granted with the cost labeled on the sheet** — recorded in
THEME_ENGINE §14.11's new closed SVG-filter list; scope pinned by gachaChrome's `url(#` count; the banked
fallback if a device round finds fleet-scroll jank is the sheet's variant C (the same carve as pure layered
geometry). The 2026-08-06 treatments' machinery went with the pick: the drop polygon, `--gc-star-drop` and
`--gc-star-edge` are deleted, silhouette and 14px ink untouched (the owner's own condition).

**③ THE CARD NAME-FACE AXIS (`cardNameFont`).** The deferred per-surface selector landed (Opus subagent,
pinned brief, main-seat reviewed): a second "Card face" seg (mincho/bungee/maru, **default bungee** — the
absence-of-a-block base, mincho's idiom one value over) beside `nameFont`, which now steers the dossier
alone. The plate's interim `"Bungee"` pin dissolved into `--gc-card-name-*`; fonts.ts warms the RESOLVED
union of both axes (the unconditional warm line returned to the per-setting map as its comment promised);
zero backend change (theme_settings is an open pass-through map, verified both sides). +6 tests. One trap
documented in-code: a TEST importing a theme index before its fonts module evaluates the registry
mid-cycle and silently resolves every setting to `undefined` — the gachaFonts import order is load-bearing.

**④ TEST DEBT RECONCILED.** The 2026-08-06 night commits (13px re-inversion, the Bungee pin) had landed on
the fast pre-commit hook only, leaving three gachaChrome pins stale — caught and re-pinned to the current
rulings before they could ambush the tag gate.

**OPEN AFTER R19:** the star-legibility-over-white-highlight eyeball CHANGES SHAPE — the accent edge that
defended it is gone; the carve band is the new distinctness cue, so the owner re-checks bright frames on
device with the carve live. The other wave-1 items stand as above.

**R20 ADDENDUM — THE EYEBALL LIST CLOSED BY DEFERRAL (owner, 2026-08-07): nothing remains before the
push word.** The stars-over-white re-check closed on device ("the stars look good for now"). The four
remaining items the owner ruled **noted for post-1.5.0 refinement** — none blocks the release; details
pinned here so they survive HANDOFF supersession:

- **The composer's quieter drop (coherence call, deferred).** The gacha signature drop is a hard SOLID
  accent offset (cards 4px · dossier portrait 5px), but the chat composer wears the shared kit `arcade`
  skin (ruled 2026-08-03), which paints its drop at **3px / 60% α** — thinner and washier than every
  drop beside it. The binary when picked up: ACCEPT (a deliberately quieter input-box shadow on a
  kit-wide component) or ALIGN (make the arcade skin itself take the solid 4px — one edit in the shared
  skin; gacha is the only theme defaulting to it).
- **The 4-line-name / rarity-tab touch (measured; recommendation = accept as recorded).** A ~30-char
  host name wraps to FOUR lines at phone width in the dossier and the fourth line's edge overlaps the
  rarity-star tab top by ~5.5px — a touch, nothing clips. Names ≤ ~21 chars (three lines) clear
  comfortably; the owner's fleet runs 4–7 chars. Guarding against it would be speculative padding; a
  spacing guard is the option if it's ever wanted.
- **The scan-mask 7s phase pulse.** The oracle's bottom dissolve shows one subtle visible pulse per
  7-second cycle; the fix, if it ever bothers, is one wrapper node.
- **The "white bar atop the appbar" (reported once, undiagnosed).** Discriminator when picked up:
  switch to cosmos/another theme — if the bar shows there too it is Fennec's own browser chrome, not
  the theme.

**R21 ADDENDUM — THE OWNER-ORDERED PRE-RELEASE AUDIT (2026-08-08, before the push word): two fresh
lanes over the ENTIRE unpushed stack, a fix wave, and both confirm rounds closed.** The owner asked for
"an audit with a subagent and codex for the latest things we implemented and touched" before deploying.
Two independent lanes ran on the same scope (the 24 then-unpushed commits) with disjoint lenses, per the
council split: **Codex `gpt-5.6-sol` high = line-level correctness** (verdict: SHIP WITH FIXES — 2 MED,
2 LOW, and it independently cleared the carve def lifetime, the `cardNameFont` axis, and every other
theme against the kit-wide changes) · **an Opus release-integrity lane** (verdict: RELEASE, no HIGH —
re-ran the full gate at HEAD, verified schema/migrations/`install.sh`/`update.sh`/`deploy/` are
byte-untouched by the stack, proved the one boot-brick candidate inert against the real prod config,
and swept hygiene: no secrets, no debug leftovers, the ~80 MB art dirs excluded, the only new binaries
two content-hashed woff2). Main-seat rulings and the fold, all commits local:

- **MED FIXED (`39c39f6`) — a non-UTF-8 filename 500'd its whole media namespace.** `describe_file →
  file_url → quote()` raised `UnicodeEncodeError` on a surrogate-escaped POSIX name (an archive/SMB
  drop), killing `/api/media/{ns}` instead of skipping one file — a degrade-never-brick violation.
  The fix lives at the ONE advertised==served chokepoint: `is_served_file()` now rejects a name that
  cannot encode UTF-8, which is exactly the set uvicorn can never address anyway (both HTTP impls
  decode request targets with `errors="replace"`, so such a name is unreachable — verified against
  uvicorn's source, not assumed). POSIX-only regression test beside it.
- **MED FIXED (`10f146b`) — the 5★ pair card's stars sat under the status pill on narrow phones.**
  Measured in the built app (2px steps): last colliding width **364px**, first clear width 366px.
  Below **380px** the pair card's pill now drops to the NEW-ribbon's existing 32px rung (no new
  number minted; `.feat`/`.wide` untouched, star geometry untouched); the owner's 393/412px views
  never change. E2e arm drives 320/**364/381**/412 — the cutoff's own edges are pinned (Codex
  confirm-round LOW, folded `0665869`).
- **Test-pinning the owner's day-round literals (`527e042`)** — the 55% close-disc is pinned as its
  full declaration and the drawn × must stay even-and-square (the 38 = 12+14+12 zero-offset rule);
  both mutation-checked. And **the carve's variant-C rollback is now IN THE REPO**: the §14.11
  waiver's banked fallback lived only in the gitignored research sheet — git could not produce the
  documented revert. Its geometry+mask construction (the sheet tags C geometry+mask, not "pure
  geometry" — corrected) is banked verbatim as the GachaStar.tsx comment block, with the trap named:
  C's dark-mix paint is NOT `--gc-star-carve-ink` (mix-toward-dark vs flood-through-alpha).
- **Doc truth (`109bf05`, `41581d6`, this commit):** D52's role list learned `oracle` (added at G5,
  never recorded) and dropped `wallpaper`; the badge-token comments and the 78% test pin stopped
  claiming the close disc (its real reader since the 55% re-look is the base rarity tab — the pin is
  re-anchored to `--gc-dossier-rar-bg` so it can never false-pass again); HANDOFF's unpushed-commit
  count became the `git rev-list --count` command after going stale twice in one day as a digit.

**DEFERRED POST-1.5.0 (ruled, not built — the reviewers' prescriptions were heavier than the findings):**
① media `revision` is `mtime_ns:size`, not content identity — a same-size, same-mtime replacement keeps
stale art cached; trigger judged contrived (D53 chose the cheap form deliberately; lean close if it ever
bites: fold `ctime_ns` in). ② picking an unwarmed name-face while gacha is live paints one fallback frame
until the woff2 arrives (self-healing; the warm-the-resolved-union design is deliberate). ③ the §14.11
waiver counter only scans `gacha.css` — a `url(#` in another sheet widens the waiver silently; widen the
scan's source. ④ HANDOFF is 647 KB and every cold session reads it first — archive the superseded ▶/⚑
blocks. (①–② Codex LOWs, ③–④ the integrity lane's.)

**Confirm rounds, both closed:** Codex re-reviewed the wave diff alone — both MED fixes CONFIRMED
correct, zero new runtime defects, its 3 LOWs (the cutoff probes, the count, one comment clause) all
folded. The integrity lane re-verified every one of its findings RESOLVED against the commits (its
words: "the retreat is now a diff, not an excavation") and kept RELEASE, with ONE precondition: the
full Playwright suite had only run targeted since `gacha.css` changed, so the pre-deploy `check.py
--e2e` must be green at the final HEAD before the tag. **Run at HEAD 2026-08-08: ALL 7 CHECKS PASSED**
(ruff lint+format · pyright · backend pytest · FE check-all · prettier · the full Playwright e2e
suite, 76s). v1.5.0 is release-handoff-ready; the release brief = HANDOFF's ▶▶▶ block.

## 8. Owner questions (the §5-of-vapor-plan analogue) — **✅ ALL RULED (prep session + the lock session, both 2026-08-02); nothing remains open**

**✅ Answered (rulings folded into the sections cited):**
- ~~Q2 Roster serving~~ → **(b) read-only owner directory + the phone gallery for
  ordering/pinning** (§5.4). The §5.3 assignment semantics are now FULLY ruled too
  (positional + `slots` pins + ordered cycling — §5.3, lock session).
- ~~Q3 Star ladder~~ → **CONFIGURED services, regardless of live status**, exact ladders in
  §6.1 (5★: 1/2/3/4/≥5 → ★1..★5; 3★: 1 → ★1, 2–3 → ★2, >3 → ★3). The zero-services
  cell is ruled too: ★1 floor (lock session, §6.1).
- ~~Q6 Brand wordmark~~ → **katakana wordmark** (§4.3; commits the `brandText` slot; exact
  string = eyeball copy pick — *settled 2026-08-06 from live renders: コントロール・ビー, §4.3;
  G6 swaps the shipped string*). The JP nav sub-labels half — ruled Q6b in the lock block below.
- ~~Q1 (size half) + Q10 Card geometry~~ → **specified DURING the build slices, by eyeball**
  ("to make sure it fits and looks good" — owner). The G1/G4 briefs carry them as in-slice
  design work with owner checkpoints, not lock blockers. The COUNTER semantics and the `NEW`
  ribbon ride along as G1 eyeball decisions *(the ribbon did NOT get ruled at G1 — superseded
  2026-08-06: G6 ships it as a DEMO on one random card, semantics still open — see the G6 row)*.

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
  *(Superseded 2026-08-06 at the G6 pre-build rulings: ALL FOUR shifter candidates ship —
  seven accent variants — plus the separate dossier picker; §4.4 is current.)*
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
  counter would not. **SUPERSEDED at G6.3 (owner device round) — `useSections.navigate` now
  guards the same-tab case** (`if (id === active) return`, after the scroll-target disarm, in the
  non-hosted branch only). The reasoning above was right about the *store* and wrong about the
  *decorator*: a value-subscriber does no-op on `setUI({ tab })`, but `runNavTransition` wraps
  that write, and under gacha it starts a real root View Transition first — so re-tapping the
  active tab replayed the whole cross-fade over a screen that never changed. The guard lives at
  the chokepoint, not in the decorator ("did anything change?" is navigation's question), and the
  hosted branch deliberately keeps re-navigating: re-tapping a hosted section re-scrolls its host
  to the group, which is the feature.
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
