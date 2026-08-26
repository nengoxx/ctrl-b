# Alt Fleet Lab — THE FINALISTS

The discussion vehicle for the alt-fleet ensemble design conversation, **round two**
(`docs/GACHA_PLAN.md` §12.5). Lab v1 (`../alt-fleet-showcase/`) was a design-review page of eight
thumbnails; lab v2 (`../alt-fleet-showcase-v2/`) was ten full-screen concepts. The owner walked both
on 2026-08-08 and ruled kill / keep / harvest — **three survived**, and this lab is those three,
rebuilt full-screen with the rulings applied. It has since been walked three more times; **rounds 4
and 5 carry the WALK 3 ruling set** (the tri-state banner switch, A's rail-less wide stack with the
selected slice grown, the plate-sized blade, B's raised cut-in column, and C parked).

Standalone: no app code, no build step, **no network at runtime**.

## Run it

```bash
cd design/prototypes/gacha/alt-fleet-finalists
python3 -m http.server 8914
# then open http://<host>:8914/   (phone: http://emma:8914/)
```

Design target is **390 × 844**; it holds **320–430**. On desktop the page centres a ~520px column
over a dim field — the fiction stays intact.

## The three

| | Concept | The fiction | Ancestors |
|---|---|---|---|
| **A** | **THE POSTER** | The premium tour poster: one black field, one parallelogram of four wide sheared slices with open gutters, the SELECTED one grown, and that machine's data in the registry fine print beneath — each slice sitting on a hard offset underlay in its rarity hue, its name block turned to the shear. | v2-02 SLICE STACK (composition) × v1-1 SIGNAL BANDS (colour grammar + the drop) × v1-2 NAME BLADES (the toggle) |
| **B** | **THE COVER** | *CTRL/B FLEET STORY*, issue 04. One machine gets the cover; the other three are cut-outs down the leading edge. Promoting one is a page turn; waking the cover **develops** it. | v1-7 COVER STORY, taken full-screen |
| **C** | **THE CLUB PAGE** *(**PARKED** — owner ruling, WALK 3: out of the production-port scope, kept as evidence; do not iterate)* | The comic page: hand-cut panels in one of three authored geometries, screentone, yellow-tape name plates, stickers, and the *CTRL/B CLUB* masthead. Deliberately the loudest. | v2-09 MANGA COLLAGE, refined |

**All three carry the app's PICKUP BANNER**, in one of three forms — see the next section. That is
the round-3 faithfulness directive: the alt layouts replace the **capsule track**, never the chrome
above it.

### Driving it

- **Switch:** the `‹` / `›` chips, or **←** / **→** on a keyboard. The pill reads `A/3`; the concept
  name flashes for ~2s.
- **Deep link:** `#A` / `#B` / `#C` in the URL; reload returns to it.
- **A — SELECT, then open.** The first tap on a slice **selects** it: the slice pushes out of the
  stack and grows, and the registry below takes its data. The **second** tap on that same
  slice opens the dossier — or runs the wake ceremony if it is asleep. Pegasus is selected at boot.
- **B and C — one tap.** Tap any ONLINE machine to open its dossier. One shared component,
  re-skinned per concept. Escape, the backdrop, or `×` dismisses it; focus returns to the opener.
- **Wake Rook:** Rook is SLEEPING in every concept. Waking him runs *that concept's* ceremony and he
  becomes ONLINE **for that concept only** — and the banner's promo slide for him un-greys, exactly
  as the shipped banner would. In **A** it takes select-then-tap; in **B** he must first be promoted
  to the cover (tap his cut-in), then tapped again to develop it — the brief's two-step; in **C**
  it is a single tap. **Tap anywhere during any ceremony to skip to the final frame.**
- **A only — the name-treatment chip:** `PLATE ⇄ BLADE` in the header.
- **C only — the geometry chip:** `GEO · TILT → CUT → SPREAD`, cycling. Both chips are session-local,
  survive concept switches and the reset, and default to PLATE / TILT.
- **BANNER ON / MIN / OFF — the `BN` chip in the switcher**, next to the `↺`. It **cycles** the pickup
  banner's form on **all three screens at once** and every screen re-flows; the chip reads its value
  (`BN ON` → `BN MIN` → `BN OFF`) and OFF is dimmed *and* struck. Session-local, default ON, survives
  concept switches *and* the reset, announced on the aria-live line. See the next section for why it
  is global and not per-concept.
- **Reset:** the `↺` chip clears every concept's wake state at once (and A's selection).

## The PICKUP BANNER slot (the faithfulness directive)

> *"more in line with our project instead of just generic"* — owner, 2026-08-08

In the shipped gacha theme the pickup banner (`GachaBanner.tsx`) **always rides above the fleet
body**. So every screen here keeps a slot for it, and one shared mock fills all three. What the mock
copies is the **read**, measured off `gacha.css` §"THE PICKUP BANNER" and `carousel.ts`:

| | production | the mock |
|---|---|---|
| height | `.gc-banner { height: 232px }`, fixed at any width | `clamp(150px, --u × .595, 232px)` — 232 at the 390 column, capped so a 430 phone gets production's banner and not a taller one |
| the strip | flex slides, `translateX(-i × 100%)` | identical |
| snap | `SNAP_MS = 620` | `620ms var(--e-out)` |
| cadence | `AUTOPLAY_MS = 5200`, paused when the tab is hidden / not active / motion reduced | one self-rescheduling timer with the same three gates |
| membership | the fixed hero + one promo per host, ONLINE and SLEEPING both | hero + Pegasus + Rook (so a grey promo is on the strip) |
| copy | tag pill · 27px italic display line · caption | tag pill · `--u × .069` display line · caption |
| pills | `rateText()` → `★N RATE x.x%`, `pityText()` → `天井 n`, cut off by the right edge | the same two strings, live off the mock roster (waking a machine moves both) |
| dots | 20×7 boxes morphed by `scaleX` — never an animated `width` (§14.11) | identical |

**It is a mock, not a port.** No drag machine, no dots-as-buttons, no promo button: the lab contract
is *one real `<button>` per machine*, and four more buttons would corrupt the very thing the three
screens are being compared on. The whole component is therefore `aria-hidden` and inert — a picture
of the real component's read. Screens skin it with `--bn-*` + `data-size`, the same
custom-property pattern the shared dossier already uses (`--dsr-accent` / `data-skin`):

- **A** full-bleed as the **first thing in the scrolling body**, seated on a `0 5px 0` gold hard
  offset — the poster's own motif, downward only (a rightward drop on a full-bleed box would push
  the page 5px wide). It is **not pinned**: see "A, round 4" below.
- **B** inset to the cover's 14px margins as a **strapline strip** (`--bn-h-strip: 88px`), paper
  keyline, the issue hue on its tag. The bottom slot was **approved at WALK 3**; the "below the
  cut-ins" alternative is dead.
- **C** full-bleed at the top with print chrome: paper edge under it, ink border, a Bungee display
  line in the page's own black stroke.

### …and the BANNER switch: ON / MIN / OFF (owner rulings, WALK 3)

> *"some designs will look better without the banner"* — owner, 2026-08-08

**It is one switch for the whole lab, on purpose.** In production this is not an alt-fleet option at
all: it is a **gacha `ThemeDef` setting choosing `GachaBanner`'s form for the entire theme**, with
these three values — the same shape as the existing `starMode` setting, which is likewise a small
theme-level enum every layout inherits. So the lab models it the same way: one chip in the switcher,
one value, all three screens, no per-concept override. (If it were per-layout here, the walk would be
comparing three different questions instead of one.)

The value lives on the **stage** (`data-banner="on|min|off"`), not on a screen — screens are built
lazily and the reset rebuilds them all, and a stage-level attribute means a screen built five minutes
from now inherits the current value for free. The autoplay cadence is gated by the same flag, so a
hidden banner is not still ticking. Because the chip is a *cycle* and not a toggle it carries no
`aria-pressed`: the accessible name is the value (`"Pickup banner: min. Tap to cycle."`) and the
visible face says the same thing.

**MIN is not a third component.** It puts every banner into the **STRIP form B's strapline already
ships** (`data-size="strip"`, driven from the stage; each banner remembers what its screen asked for
in `data-base`, so ON hands the full form back). So "minimal" is an authored variant that is already
being walked rather than a new one to maintain — and B, which is a strip in every state, is
untouched by it. What the strip compresses is the **caption** line; the tag pill, the display line,
both `★N RATE` / `天井` pills and all three dots stay, so it is still recognisably the banner.

| | ON | MIN | OFF |
|---|---|---|---|
| **A** | the slot is the first child of the scrolling body; the scroll range is **exactly** the banner's 232px | same, at **88px** — the poster is nearly whole on the landing frame and one short scroll finishes it | the slot is gone and the range is **exactly zero** — the poster and its registry fill one frame, nothing scrolls |
| **B** | the strapline strip, hero-copy floor at 212px and cut-in floor at 202px | **identical to ON** — B's banner was always this strip | both floors come back down (116 / 126): the cover closes up and the hero name block returns to its natural seat |
| **C** | `.cl-page` — the space every panel, tape and sticker is authored in — starts at `--bn-slot` | starts at 88px | starts at 0 |

C's three states are one variable (`--bn-slot`) rather than three nudges: every geometry is authored
in **percentages of `.cl-page`**, so all three scale into whatever the banner leaves, and the GEO chip
is positioned off the same variable (`max(9px, --bn-slot − 15px)`).

## The rarity → hue ladder (ruled at the first walk)

The owner's ruling (§12.5, 2026-08-08): **the per-slice colour derives from the star count**, not
from a hand-picked per-host accent. Declared once in `styles.css` `:root`, applied by `app.js` as a
per-machine `--rar`:

| stars | hue | | the mock roster |
|---|---|---|---|
| ★5 | `#ffd464` gold | == production `--gc-star` | Pegasus |
| ★4 | `#b07cff` purple | | Atlas |
| ★3 | `#4dd7ff` cyan | | Lyra |
| ★2 | `#5fe0a0` green | | Rook |
| ★1 | `#cdd2e0` silver | the floor | — |

Production's source is the configured-services ladder in `frontend/src/themes/gacha/stars.ts`; the
lab's mock roster carries `stars` directly, which is the same number.

**Stars themselves keep the production star grammar** — gold `#ffd464` fill, rose-gold `#ff8fa8` on
the top two rungs (`isHighStar`, 5★ mode) — and are **never tinted by the slice hue**. Two different
signals must not wear one colour.

**A SLEEPING machine's hue is suppressed** (grey keyline / grey tape cap) along with the mono art,
and floods back in on wake. Status still never rides on colour alone: every screen keeps a literal
chip (`ONLINE` / `SLEEPING` / `STANDBY`), per §12.3 ④.

## What changed vs. the ancestors

**A THE POSTER** — v2-02's composition is intact (black field, `Fleet` header, one 10° parallelogram
of four equal slices, a registry footer in fine print — the registry became *live* in round 3 and the
vertical wordmark rail was cut in round 5, see below). Added in round 2, all from v1-1 and all
rarity-derived:

- **a HARD OFFSET DROP under every slice, in that machine's rarity hue** *(round 2, owner ruling)* —
  the shipped theme's "sits ON the surface" motif, whose exact precedents are
  `--gc-ind-shadow: 5px 5px 0 #ff6cb1` (the nav indicator: white pill, hard pink offset) and
  `--gc-bubble-user-shadow` (the user chat bubble). v1-1 SIGNAL BANDS is both the reference look and
  the structural precedent: its `.band-drop` was the *same polygon translated 5px/5px*, never a
  shadow. It **cannot** be a `box-shadow` here — a slice is a `clip-path` polygon and a clip-path
  erases an offset shadow (the shipped capsule card hit exactly this and needed a wrapper; the trap
  is written up in `frontend/src/themes/gacha/gacha.css`, "THE SLOT, and the ARCADE DROP"). So each
  slice is three boxes: the **button** (no paint; its clip-path is the *union* of slice and drop, so
  the hit area still follows the shear **and** the drop is not clipped away), the **`.po-drop`**
  underlay, and the **`.po-plate`** slice itself. A SLEEPING slice's drop follows its suppressed
  grey and floods to the hue on wake, with the keyline.
- a **keyline frame** per slice in the same hue, plus a cheap static hue wash pooling at the
  bottom-leading corner. The keyline is drawn the R18 way — **the plate's background IS the keyline
  and the art sits inside the same polygon**. An inset `box-shadow` would be laid on the border-box
  *rectangle* and then clipped away by the shear, leaving two stray vertical bars. It went **2px →
  1px when the drop landed**: v1-1 carries no keyline at all, and 2px + 5px of one hue on one edge
  read as double chrome — the underlay is the primary hue carrier now, the keyline just holds the
  cut.
- the **NAME in the hue at the slice's BOTTOM-LEADING edge**, with stars above it and the role
  beneath. Never the top edge — a top-anchored name reads as the band *above*'s caption, which is
  the ruled v2-01 defect. The block clears the rising bottom diagonal by `--run × .6`; anchoring at
  a flat `10px` puts the role line under the shear and slices it (caught in the first render round,
  and now pinned by a geometric assertion in the verification pass).
- **the whole name block ROTATED TO THE SHEAR** *(round 2, owner ruling)* — name, stars *and* role
  line ride the diagonal, v1-1's and v1-2's language and GACHA_PLAN §12.2's "name rotated to the
  shear angle". `transform: rotate(-1 × --a)` about `0 100%`, so **the bottom-leading anchor is
  literally unmoved** and only the baseline angle changes. Two things fell out of it: clearance from
  the bottom edge becomes *constant* along the slice instead of shrinking towards the trailing end
  (which is why the blade now rides the diagonal instead of being chopped by it), and rotating about
  a bottom-leading corner drags everything *above* that corner leftwards by `blockHeight × sin 10°`
  — ~9px for the plate block, ~11px for the blade's, enough to eat the first letter of the role line
  against the vertical leading edge. The first render round of the change did exactly that; `left`
  now carries the drift plus the margin, per treatment.
- a **hard, unblurred name shadow** (`3px 3px 0`, v1-1's `.band-copy` value) instead of the old soft
  halo — same family as the drop under the slice. One layer only: a soft halo underneath it turns
  into mud on busy art.
- the **status chip at the trailing edge** — lit green for ONLINE (v1-1's grammar), dim violet for
  SLEEPING — and a right-edge **JP glyph tag** (天馬 / 地図 / 塔 / 琴) per v2-02.
- the **PLATE ⇄ BLADE chip** — **rebuilt at WALK 3, and it is now a one-variable toggle.**
  Rounds 1–3 walked a *display-scale* blade: `--u × .118` (~46px) type wearing a 5–6px black contour,
  which needed two support mechanisms of its own (the contour, to hold any hue over any art; and a
  **status-chip lift**, because a 46px blade arrives at the trailing edge ~90px up and ran under the
  chip — §12.3 ④ says status may never be buried). The owner ruled twice: first that the blade should
  wear the **plate's typography** (solid rarity fill + the hard `3px 3px 0` dark offset, **no
  contour**), then that it should also take the **plate's size** — the blade scale "looks way too
  big". What is left is the cleanest possible comparison:

  | | PLATE | BLADE |
  |---|---|---|
  | type | 20px Archivo Black, rarity fill, `3px 3px 0 #07050a` | **identical** |
  | seat | mid-slice, `--run × .6 + 4px` above the bottom | down on the **lower diagonal**, `--run × .18` |
  | role line | below the name | lifted **above** it (under the name the shear would slice it) |
  | stars · chip · leading offset · gap · rotation | — | **identical** |

  Both support mechanisms **dissolved** with the size: the contour is gone (at plate size the hard
  offset carries it, exactly as it does for the plate) and the chip sits in its one authored place in
  both treatments. The remaining variable is literally where the name sits — which is the question
  the owner is walking. *(Legibility went the opposite way from the worry: the low seat is deeper
  inside `.po-veil`'s darkest corner, so the blade measures **better** contrast against the art than
  the plate does on three of four slices — numbers in the verification table.)*

**A, round 3 — the faithfulness pass.** The ruled changes that turned static poster furniture into a
live readout of the *selected* machine:

- **the banner slot**, so the poster is judged under the chrome it will actually ship beneath.
- **the footer is the SELECTED machine's data**, replacing the static `SERIES 2026` registry:
  hostname, role · status, ping · uptime · last seen, services. **No buttons**: it is a readout, and
  the poster already owns exactly one control per machine.
- **SELECT-THEN-OPEN.** First tap selects; the second tap on the same slice opens or wakes. Every
  `aria-label` names both steps — `"…Tap to select; tap again to open the unit dossier."` becomes
  `"…Selected. Tap to open the unit dossier."` once it is the selected one — and the `aria-live`
  line announces each selection. Still exactly four buttons.
- *(round 3 also gave the poster a left rail carrying the selected machine's name, vertically. **It
  was cut at WALK 3** — see round 5 below.)*

**A, round 4 — THE BANNER IS NOT PINNED (faithfulness correction).** Round 3 pinned it above a
scrolling stack. Production does not: in `GachaFleet.tsx` the banner is simply the **first child of
the fleet tab's scrolling body** — `#app-scroll` scrolls the whole tab and nothing inside it is
sticky. So the slot moved *into* the scroller, above the poster, and the banner **scrolls away**.
This is what answers walk question 10 (below), and it is why the four-slice poster can be read whole
at all.

The mechanism that makes it exact is one declaration: **`.po-body { min-height: 100% }`** — the
poster plus its registry, as one box, is at least a viewport tall. So the scroll range is *exactly*
the banner's height at every width from 320 to 430: scroll once and the banner is gone and the whole
poster + registry occupies the frame. With the banner off the same rule gives the other half: the
range is exactly **zero** and nothing scrolls at all.

**A, round 5 — the WALK 3 ruling set.** Four changes, and they are one decision:

- **THE LEFT RAIL IS GONE.** Owner: it *"makes the PC cards a little bit too small."* Rounds 3–4
  spent a 104px left gutter on a vertical name and the four slices paid for it in width. That gutter
  is now a modest `--lead: 40px` inset against a `--trail: 20px` one — **still off-centre right**
  (the owner likes that), but now as a deliberate asymmetry rather than a rail's leftover. Poster
  width **272px → 330px at the 390 column, +21%**. The header and the footer realign to the new
  leading edge.
- **the slices no longer interlock.** `--gut` went **9px → 22px**. At 9px the bands met almost
  edge-to-edge along the shear, and a size difference between two of them could not read — which
  matters because:
- **SELECTION READS AS SIZE.** `.picked` now carries a **5% grow about the slice's own centre**
  alongside a (dialled-down, 9px → 4px) push out of the stack. It is a `transform`, not a height
  (§14.11): one compositor property, no layout, no height tweening, neighbours do not reflow — they
  just get overlapped a little inside the gutters the same ruling opened. The trailing inset is
  sized so the grown slice's own 5px drop, scaled *and* nudged, still lands inside the viewport at
  320 / 390 / 430 — asserted, not assumed.
- **the registry is IN THE FLOW and carries the identity.** With the rail gone the footer is the
  only place the selected machine is named, so the hostname left the fine print and became a
  **display line** (Archivo Black at `--u × .052`, ~20px, in the rarity hue). And it is **no longer
  pinned**: in production the bottom zone belongs to the tab switcher and the composer floating over
  the cards, so nothing else may pin there. The block sits last in the scroll flow, after the fourth
  slice — exactly where the `SERIES 2026` registry originally sat — and updates in place on
  selection. **Selecting does not scroll**: the grow + nudge *is* the feedback, and because the
  affordance is a transform, the slice you tapped does not move under your finger.

A's scroll body is therefore: **banner → the four-slice poster → the selected machine's registry**,
with only the `Fleet` header pinned.

**B THE COVER** — v1-7 taken from a card to a full screen. Added: the masthead's issue line tracks
the current hero and its status; the cut-in cards carry a hue bar plus their own status chip; a
barcode + `¥0` gag + a `CHANGE COVER` hint. *(Round 1 also put a rarity **spine stripe** across the
very top; the owner **cut it** at round 5 — nothing replaces it, and the hue still reads first through
the masthead kicker, the cut-in bars and the banner's tag pill.)* The interaction is new: **promoting** a cut-in is a five-beat page turn (the
page shrinks and dims, the DOM swaps, the new hero scales in, the masthead beats), and waking the
cover **develops** it (flash + shake, the hue floods a radial wash, a rose `AWAKE` stamp thuds in
and stays). There are still exactly **four buttons, one per machine** — the same button moves between
the hero slot and the stack and re-labels itself, so focus and identity survive the promotion.

**B, round 5 — the top dead space, killed (owner ruling, WALK 3).** There was a growing hole between
the masthead block and the top of the cut-in column, and the owner wanted the stack *"all the way up,
with some offset to look good."* Two changes:

- **the stack top is DERIVED, not a flat number.** A flat `190px` could not work, because the
  masthead is not a fixed height: its two display lines scale with the column (`--u × .108`,
  line-height `.8`), so at 320 it ends ~60px higher than at 430 and the dead space was simply
  whatever was left over. The top is now built from the same numbers the masthead is —
  `calc(70px + var(--u) × .173)`, where `70px` is its fixed rows (16px top + the `CTRL/B` kicker +
  the `ISSUE` line + margins + the ~3.5px the `-2deg` rotation drops the block's leading corner) and
  `.173 × --u` is its two display lines. The result is a **constant ~15px of air under the masthead
  at every width** instead of 30 / 17 / 10, and the column gains ~53px at the design width. The
  floor stays at 202px for the strapline, so the extra column shows up as slack *below* the
  `CHANGE COVER` hint, which is where it is useful.
- **the hero art is re-cropped for the cover.** Raising the column puts paper over the leading edge
  of the frame, so the hero's focal point shifts **right**: a *lower* `object-position` X shows more
  of the image's left, which slides the subject rightwards out from under the stack. Only the HERO
  slot is re-cropped (a 112px cut-in keeps the roster crop) — the same override pattern C already
  uses for its panels: **the slot owns the crop, the roster keeps the default.**

**C THE CLUB PAGE** — **PARKED at WALK 3** (owner: out of the production-port scope; kept as
evidence, not iterated further — the only thing it still picks up is the global banner switch).
Everything below is the closing record. v2-09's energy is untouched; the refinements were:

- **torn panel edges**: the polygons went from 4–6 vertices to 8–9 irregular ones, so the die-cut
  reads as hand-torn paper rather than a clean shear.
- **safe-zone geometry**: each panel now overrides the roster crop with its own focus point tuned to
  that panel's aspect, so every face sits inside its own panel instead of riding a corner.
- **yellow-tape name plates** replacing v2-09's floating outline names: a notched tape strip with
  `NAME` + `JP · ROLE` and a black star pill, carrying a rarity-hue cap at the leading edge. The tapes
  still live in *page* space, so they cross the panel gutters — that was the charm.
- **a rarity keyline**: three nested layers on the same polygon — paper white (the button's own
  background), then a 2px hue line, then the art. Ink-black and paper still lead.
- kept exactly as-is: the speed-line burst, the `04 UNITS` and `TAILNET` stickers, the ZZZ +
  `STANDBY` chip on the sleeping panel, the `CTRL/B CLUB` masthead footer with its
  all-rights-reserved fine print, and the burst → colour-flood wake.

**C, round 3 — the ruled change set.** Everything the owner named at walk 2, plus the banner:

- **the banner slot at the top**, and `.cl-page` — the coordinate space every panel, tape and
  sticker is authored in — now starts *beneath* it and stops above the CLUB band. All three
  geometries are authored against that shorter box rather than nudged into it.
- **the tape stars, stepped up.** `8px` was a footnote on a plate whose name runs at ~17px. The pill
  now carries `clamp(11px, --u × .036, 15px)` — ~14px at the 390 column, the production card's star
  read. **The tapes themselves are untouched** (the owner likes them); only the pill grew.
- **the screentone, thinned.** Three cuts, none of them a live filter, and all three are now
  *parameters* on the shared `.tone-ramp` primitive rather than a fork of it: a smaller dot on the
  same pitch (`--tone-dot` 1.7px → 1.15px), lighter ink (`opacity` .28 → .15), and a **punch-out
  over the face** — the panel already carries its face-safe crop as `--focus`, so the same point
  drives `--tone-hole`, a radial mask intersected with the ramp. The coarse ramp still runs over
  backgrounds and clothing, which is the half the ruling kept. *(`mask-composite: intersect` is the
  standard property, Gecko's; `-webkit-mask-composite: source-in` rides beside it for Blink. A UA
  with neither falls back to `add` — the hole is ignored and the tone is merely uniform at the new
  lighter weight, a degradation and not a break.)*
- **the GEOMETRY TOGGLE — TILT / CUT / SPREAD.** Three authored geometries on **one DOM**: the chip
  writes each panel's rect, polygon, focus point, z-order and its tape's page-space anchor, so the
  wake state, the focus ring and the button identities all survive a switch. All three keep what the
  ruling protected — the collaged one-over-another **overlap**, the tapes, a **face-safe crop** per
  panel, and the **polygon as the hit area**.
  - **TILT** — the walked layout, unchanged in spirit: hand-torn tilted rectangles, 8–9 irregular
    vertices, ±2–3° rotations.
  - **CUT** — knife-edge: zero rotation, four straight-edged polygons whose long edges run roughly
    parallel, so the paper keylines read as slashing action-page gutters. The bands still ride one
    over another; they just meet on clean lines.
  - **SPREAD** — the splash page: ONE dominant Pegasus panel with the other three collaged smaller
    **over** it. The only geometry where the hero takes the *bottom* of the z-order, which is
    precisely why `z` is authored per geometry instead of derived from the roster index.
  - Rook's heavy panel treatment and the black CLUB footer band are as-is in all three (ruled fine).

### How each scales with N

- **A** generates from a count: one shear, one slice height, `N` slices. The registry reads one
  machine, so it is N-independent by construction, and the stack was already a scroller — a bigger
  fleet is simply a longer scroll under the same banner. Nothing is hand-authored.
- **B** is fixed at *one* hero + a stack: the **cut-in column scrolls vertically** for larger fleets
  (`.cv-stack` is its own scroll container inside a flex column, so the `CHANGE COVER` hint below it
  never moves). Hierarchy is unchanged at any N — that is the point of a cover.
- **C** does **not** generate. Production ships it as **hand-authored templates per fleet-count
  bucket**, accepted at the 2026-08-08 ruling. The template range and the `>N` fallback are an
  E-slice design call.

## The lab contract (so the comparison is fair)

Identical to lab v2, verbatim: the same four machines (Pegasus 5★ ONLINE / Atlas 4★ ONLINE /
Rook 2★ SLEEPING / Lyra 3★ ONLINE) · the same four art crops · ONLINE = full colour,
SLEEPING = `saturate(0) brightness(.55)` with idle motion stopped · one real `<button>` per machine ·
one shared focus-trapped dossier · a latency-dramatising wake ceremony per concept's own fiction.

**Motion** follows R24 §B verbatim: the §B.1 tokens are the `:root` block in `styles.css`; ceremonies
are five beats inside 900ms with a mandatory tap-anywhere skip; only `transform` / `opacity` animate.
No animated `filter` / `clip-path` / `background-position`; `will-change` is added on `animationstart`
and removed on `animationend`; hover is gated behind `@media (hover:hover) and (pointer:fine)`;
`prefers-reduced-motion` routes through the §B.4 token-override block (durations shrink, feedback
stays). Grain is a baked data-URI tile (A18), never a live filter.

**SVG filters: none.** The contract pins the sleeping treatment to a plain CSS `filter`, so nothing
here needs `filter: url(#id)` — and zero references means the Gecko dangling-reference trap (a
removed `<defs>` unpaints its element) cannot arise. `index.html` carries a comment marking where a
pinned, never-unmounted `<defs>` block would go if a later round adds one.

**A11y:** every machine button carries an aria-label naming machine + role + stars + status + what
the tap does — **A's name both steps** of select-then-open, B's distinguish *on the cover* from
*supporting cut-in*; `:focus-visible` rings are drawn **inset** (the UA ring is clipped away inside a
`clip-path` shape); an `aria-live="polite"` line announces concept switches, selections,
name-treatment and geometry changes, promotions, dossier opens and wake results; the dossier is a
focus-trapped `role="dialog"` that returns focus to its opener. The **banner mock is
`aria-hidden`** — it is a picture of a shipped component, and giving it dots-as-buttons or a promo
button would break the one-button-per-machine contract the comparison rests on.

## The open questions for the walk

Two things changed the *nature* of this list at WALK 3, and they are worth stating before the
questions: **C is PARKED** (owner ruling — out of the production-port scope, kept as evidence, do not
iterate), and the first two questions are no longer kill/keep. Both the name treatment and the
banner form are **planned production settings**, so what the walk decides is the **default value**,
not whether the thing survives.

1. **PLATE vs BLADE — the name's position (A).** *A planned setting; the walk picks the default.*
   The toggle is now a genuinely **one-variable** comparison: identical type, identical size,
   identical furniture, and the two support mechanisms the oversized blade needed (its black contour,
   the status-chip lift) both dissolved. The name either sits mid-slice with the role beneath it
   (PLATE) or rides the lower diagonal with the role lifted above it (BLADE). Whatever you prefer
   *is* a preference about the seat and not about weight, colour or hierarchy. Watch it on **Rook**
   (dark art, low contrast everywhere) and **Lyra** (light art, the name sits over her shirt) — those
   are where a seat change moves the most.
2. **Banner ON / MIN / OFF — per screen, and then as ONE default.** *A planned setting; the walk
   picks the default.* The owner already leans **B = ON** and **A = MIN or OFF**; the chip is there to
   confirm or overturn that on a real phone. Three reads to take:
   - **A** — OFF, the whole poster and its registry fill exactly one frame and nothing scrolls at
     all. MIN, the poster is nearly whole and one short scroll finishes it, with the pickup copy still
     present. ON, you land on 232px of banner and about three and a half slices. Is the poster a
     thing you want to see whole, or is the full banner worth the scroll?
   - **B** — the one the owner suspected first, and the reason MIN exists at all: B's banner *is*
     the strip, so ON and MIN are the same cover, and OFF is a different magazine — the hero name
     block drops to its natural seat and the barcode footer sits right under it. Both are defensible.
   - **C** — parked, but the chip is global, so it still walks: OFF the collage starts at the top and
     every panel grows into the extra height; ON it reads like a page *under an ad*. Look, do not
     iterate.
3. **A's keyline: keep the hairline, or kill it?** `5px` is the production drop verbatim
   (`--gc-ind-shadow`); on a real phone it may want 4 or 6. Tied to it: the keyline was thinned
   2px → 1px so drop and line do not stack into double chrome, and **v1-1 carries no keyline at
   all** — killing the last 1px is a one-line change if the drop alone is enough. **Judge it on
   Rook's sleeping slice**, where both the keyline and the drop are the same grey and the drop is
   doing the whole job; the round-5 gutters make that band far easier to read in isolation than it
   was when the slices interlocked.
4. **A's trailing-end air.** The name block's anchor is unchanged from round 1 (`--run × .6 + 4px`
   above the bottom in PLATE, `--run × .18` in BLADE), and `--run` grew with the slices in round 5 —
   the wider poster shears deeper, so the trailing end now sits noticeably higher off the bottom edge
   than the leading end. It reads as deliberate, but the block could equally be dropped 8–12px to hug
   the diagonal harder — one number, in either treatment or both.
5. **Does the selected-slice GROW feel right?** New at round 5, and it is the one thing here with no
   precedent to fall back on. Selection now says *"this band is bigger"*: a 5% scale about the
   slice's own centre plus a 4px push out of the stack, riding the existing `--t-ui` transform
   transition. Three sub-questions: is **5%** the right amount (it is one token, `--pick-grow`), does
   the grown band **overlapping its neighbours** inside the 22px gutters read as depth or as
   collision, and — because the registry is below the fold when the banner is on — is the grow
   **enough feedback on its own** for a tap whose other effect you cannot see?

**Standing, from earlier walks:**

6. **Equal-rarity hue collision.** The mock spread is 5/4/3/2 — all distinct, which flatters the
   ladder. A real fleet of four machines with three services each is **four cyan slices**. Worth
   deciding on-device whether that is fine (it is honest: they *are* the same rarity) or whether the
   grammar needs a secondary differentiator.
7. **B's hero rotation.** Does promoting feel good enough to be a daily gesture, or does the extra
   tap to reach a non-cover machine's dossier annoy? (Note the asymmetry: a SLEEPING machine takes
   two taps to wake in B — promote, then develop.)
8. **A costs two taps to open anything**, which is what select-then-open buys the registry. On a
   fleet you know by heart that may be one tap too many; the counter-argument is that the registry is
   where the ping and the services live, so the first tap is often the *only* one you want. The
   branch is three lines in `tap()`.
9. Not asked but visible: **A's shear and slice height** are still the §12.3 ② device-round numbers
   (`--a: 10deg`, height `clamp(148px, 0.44 × column, 180px)`) — but `--run` is `tan(--a) × 100cqw`,
   so the round-5 widening deepened the shear from ~48px to ~58px of vertical run without anyone
   retuning the angle. If the slices now look *too* raked, `--a` is the one number, and the rotated
   type follows it for free.
10. ~~Not asked but newly visible: under the real banner, A is a scrolling stack…~~ **RESOLVED
    (round 4) — the banner scrolls away with the body, which is also the faithful answer.** The
    round-3 build pinned it; production does not (`GachaFleet.tsx` renders the banner as the first
    child of the tab's own scroller and nothing in there is sticky). It is now in the scroll flow,
    and `min-height: 100%` on the poster's box makes the scroll range *exactly* the banner's height,
    so one scroll gesture takes you from "banner + poster" to "the whole poster and its registry, one
    frame, no banner". The alternative that was on the table — a shorter slice — was not needed and
    would have cost the art.
11. **C's loudness** — moot for the port (C is parked), kept because the answer is still evidence
    about how loud the gacha theme may get.

## Verification

The `preview/` captures are Playwright (chromium) shots at **390 × 844, DPR 2**, driven through the
repo's existing `frontend/` Playwright install — no new browser downloads:

| file | what it is |
|---|---|
| `A-plate.png` · `A-blade.png` | A at rest, banner ON — the frame you land on, in both name treatments |
| `A-plate-scrolled.png` · `A-blade-scrolled.png` | A after one scroll: **the banner is gone**, all four slices and the registry in one frame |
| `A-plate-nobanner.png` | A with the `BN` chip OFF: the whole poster + registry, no scroll at all |
| `A-plate-minbanner.png` | A with the chip on **MIN**: the slim 88px banner, poster nearly whole |
| `B.png` · `B-nobanner.png` | the cover both ways — raised cut-in column, re-cropped hero |
| `C-tilt.png` · `C-cut.png` · `C-spread.png` | the three authored geometries (banner ON) — **C is PARKED, these are the closing record** |

### Rounds 4 + 5 — re-run from scratch: **201 / 201 pass**, plus a paint pass

Rounds 4 and 5 touched the banner switch, A's whole anatomy and B's column, so nothing is carried
forward: **201 behavioural + geometric assertions** — every A / B / C behaviour re-run across **both
name treatments × all three banner states**, and the overflow bar across **2 widths × 3 states × 6
views** — plus a Pillow pass over element captures.

| Area | Check | Result |
|---|---|---|
| chip | defaults ON, sits in the switcher next to `↺`, face reads `BN ON`, and it carries **no `aria-pressed`** (it is a cycle, so the value is the accessible name) | PASS |
| chip | **cycles** ON → MIN → OFF → ON, announcing each value on the aria-live line | PASS |
| chip | OFF hides the slot on **all three screens at once**; ON restores all three to their original heights | PASS |
| chip | the value survives concept switches **and** the reset, and **re-applies to the rebuilt component** (`data-size`, height, face) | PASS |
| chip | the 5200ms cadence runs when ON and is **paused** when OFF (dot index frozen over 5.8s) | PASS |
| MIN | every screen's banner takes the **strip form**, and each remembers its base (`full` / `strip`) so ON hands the full one back | PASS |
| MIN | the slim height is B's strapline height (**88px**) on all three, a >100px shrink on A | PASS |
| MIN | still recognisably the banner: tag pill inked, display line, **both** `★N RATE` / `天井` pills, three dots | PASS |
| MIN | the **caption** is what compresses away — the strip's own authored cut, not a new one | PASS |
| MIN | **B is untouched** (it was a strip in every state), A's scroll range follows the slim height exactly, C's page starts at 88 and every geometry scales into it, the GEO chip travels with it | PASS |
| cut | A's banner no longer sits on a gold `0 5px 0` hard drop — it ends clean on the field | PASS |
| cut | B's rarity spine stripe across the very top is **gone from the DOM** | PASS |
| reflow · A | scroll range == the banner's height ON **and MIN**, **exactly 0** OFF, at 320 / 360 / 390 / 430 | PASS |
| reflow · B | hero-copy floor 212→116 and cut-in floor 202→126 | PASS |
| reflow · C | `.cl-page` starts at 0 and grows by **exactly** the banner's height; the GEO chip travels with it | PASS |
| A · anatomy | the banner is the **first child of the scroller**; **nothing inside is sticky or fixed** | PASS |
| A · anatomy | **two** grid rows — only the `Fleet` header is pinned | PASS |
| A · anatomy | the registry is **in the flow**, last, after the fourth slice | PASS |
| A · scroll | the banner is on screen at rest and scrolls **fully out of the viewport**; after the scroll all four slices *and* the registry are inside the scrollport — both treatments | PASS |
| A · rail | `.po-rail` is **absent from the DOM** | PASS |
| A · width | poster width ≥ 320px at the 390 column (was 272) and still **off-centre right** (lead > trail) | PASS |
| A · gutter | a real **22px** gutter between every unpicked pair, derived from the resolved `clip-path` (was 9px); its midpoint hits **neither** neighbour | PASS |
| A · selection | the picked slice is **measurably larger** (>3% in both axes) than an unpicked one, and eats into but never closes its own gutters | PASS |
| A · selection | selecting does **not** scroll the body | PASS |
| A · footer | the hostname is a display line ≥16px and the block **repaints** between two selections | PASS |
| blade | the hard shadow is the **plate's exact computed value** on every slice, and the fill is the same rarity hue | PASS |
| blade | `-webkit-text-stroke` is **0** on every slice (was ~5.6px black) | PASS |
| blade | the name is **plate-sized** — identical computed `font-size` to PLATE | PASS |
| blade | it still rides **lower** than the plate's seat (>20px, and never below 4px of clearance) and is rotated to the shear | PASS |
| blade | the role line lifts **above** the name in BLADE and sits below it in PLATE | PASS |
| blade | the **status-chip lift dissolved**: the chip is within 1.5px of the same seat in both treatments | PASS |
| blade | role + star sizes are **identical** in both treatments | PASS |
| blade · paint | every name is inked in its own rarity hue (25–33% of its box) and **77–93% of its ink edges land on a dark pixel exactly 3px down-right** — the hard offset, measured, no stroke | PASS |
| blade · paint | contrast against the art at the blade's low seat measures **2.35–4.24**, vs 1.15–3.51 for the plate: the low seat sits deeper in `.po-veil`, so the restyle **improved** legibility rather than costing it | PASS |
| A · behaviour | boot selection · step 1 selects and does not open · step 2 opens · Escape returns focus · step 1 on the sleeping slice does **not** wake · step 2 runs the ceremony · the registry renumbers · Rook's promo un-greys · the chip is never overlapped by the name · reset — **all four combinations of treatment × banner state** | PASS |
| B · stack | the cut-in column starts **6–26px under the masthead at every width** (a constant ~15px by construction) and never overlaps it — 320 / 390 / 430 × all three banner states | PASS |
| B · hero | the **hero** crop is shifted right (`object-position` X < 40%) while the cut-ins keep the roster's 50% | PASS |
| B · layout | the raised column still clears the barcode footer; promote + develop + the four-button contract all still hold | PASS |
| C | the burst wake runs and the sticker tells the truth in **all three** banner states; the page starts where the state says (232 / 88 / 0) — the only C work this round, since C is parked | PASS |
| overflow | `scrollWidth <= clientWidth` on document, body, stage **and A's scroller**, and every drop / panel / banner / cut-in right edge inside the viewport — **320 and 430 × A plate, A blade, B, C tilt, C cut, C spread × banner ON / MIN / OFF** (36 views) | PASS |
| reduced motion | the banner stays paused with `0s` travel, and the switch still reflows A | PASS |
| console | clean through the entire run — errors, warnings, failed requests | PASS (0 / 0 / 0) |

**What these two rounds taught the harness:**

- **A percentage `min-height` on the scroll content is the whole mechanism.** Making the banner
  "scroll away" is easy; making it scroll away *completely* at every width is not, because the four
  slices are shorter than the frame. `min-height: 100%` on the box holding the poster + registry
  pins the scroll range to exactly the banner's height — and the same declaration gives the
  banner-off state a range of exactly zero. Both were asserted as equalities, not as inequalities,
  which is what caught two separate 2–16px overruns while the footer was being resized.
- **A grown element needs its overflow budget computed, not eyeballed.** `.picked` scales about the
  slice's centre, so the trailing inset has to cover `(halfWidth × 0.05) + the 5px drop + the nudge`
  at the *widest* column. That is why the nudge came down 9px → 4px: it was the term that pushed the
  scaled drop past the viewport at 390. The overflow suite runs 24 views precisely because this
  class of bug only shows at one width.
- **Derive the probe from the thing being asserted.** The gutter check reads `--run` back off the
  **resolved** `clip-path` and computes `top(i+1) − bottom(i) + run`, so it follows `--a` and the
  poster's width rather than a hard-coded 10°; and it skips the pairs touching the *picked* slice,
  because a scaled neighbour is supposed to eat into its own gutters. A first version asserted a
  constant 22px everywhere and failed on exactly the pair the design intends to be different.
- **A tri-state control must be driven by reading the state back, not by counting clicks.** The
  first version of the suite clicked the chip once to reach "off"; with three values that silently
  tested MIN and passed. Every setup now loops `click → read the stage → stop when it matches`, which
  is also the only form that survives the next value being added.
- **Rotated boxes make `getBoundingClientRect` comparisons lie.** Asserting "the role line is above
  the name" with `role.bottom <= name.top` fails on a `-10deg` block, because the axis-aligned boxes
  of two rotated siblings overlap. Comparing **centres** is the honest test.

### Round 3 — the faithfulness pass (superseded above, kept for the record): **139 / 139 pass**

Round 3 touched all three screens, so nothing is carried forward: **97 behavioural + geometric**
assertions, plus **42 paint assertions** read back off real captures with Pillow.

| Area | Check | n | Result |
|---|---|---|---|
| banner | the slot is filled on A / B / C: three slides, the active slide's art **loaded**, copy non-empty, exactly one lit dot | 9 | PASS |
| banner | the pills carry the app's grammar — `★5 RATE x.x%` + `天井 n` (`fleet.ts` rateText / pityText) | 3 | PASS |
| banner | **inert mock**: `aria-hidden`, zero buttons — the one-button-per-machine contract is intact | 3 | PASS |
| banner | proportion matches production: **232 @ 390** full-bleed on A and C, the **88px strapline** inset to 14px on B | 6 | PASS |
| banner | auto-advance moves the strip after the **5200ms** cadence (`translateX(-100%)`, dot 0 → 1) | 1 | PASS |
| banner | **reduced motion pauses it** — dot still 0 after 5.7s, and `transition-duration` is `0s` | 1 | PASS |
| banner · paint | the slide is real art (60k–147k distinct colours), the **tag pill is filled in the screen's skin colour**, the display line is inked | 9 | PASS |
| A · select | boots with **Pegasus selected**; rail reads `PEGASUS`, footer reads `PEGASUS-01 · 18 MS · HERMES…` — both treatments | 2 | PASS |
| A · select | every label names the **two step** — `Tap to select; tap again to open/wake`, flipping to `Selected. Tap to …` | 2 | PASS |
| A · select | step 1 on an ONLINE machine selects and **does not open**; the live region announces it | 4 | PASS |
| A · select | step 2 on the **same** slice opens the dossier; Escape returns focus to it | 4 | PASS |
| A · select | step 1 on the **SLEEPING** machine selects only — **no ceremony**; step 2 runs it | 4 | PASS |
| A · select | the wake lands and the **footer shows the new numbers** (`31 MS`, `SEEN NOW`), label + live region rewritten | 2 | PASS |
| A · banner | waking Rook **un-greys his promo slide** and moves the rate pill to `★5 RATE 10.0%` | 2 | PASS |
| A · paint | the footer is **inked and its pixels change** between two selections (element captures, byte-compared) | 2 | PASS |
| A · paint | each name is genuinely **inked in its rarity hue** inside its own box, both treatments | 8 | PASS |
| A · drop | every underlay is offset by **exactly 5,5** and wears the **same resolved polygon** as its plate | 2 | PASS |
| A · drop (paint) | the hue paints **2.5px past the trailing edge** and **2.5px below the bottom edge**, is **absent on the leading edge**, and the gutter past it is still black — a directional offset, not a flood | 11 | PASS |
| A · drop (paint) | the **sleeping** slice's drop is suppressed to grey, not its rarity green | 1 | PASS |
| A · rotation | the name block's transform is a real rotation (matrix `b ≠ 0`), every slice, both treatments | 2 | PASS |
| A · blade | the name is laid out **and the status chip is never buried** by it | 2 | PASS |
| A · hit area | a tap inside the slice's own shape hits that slice; the **sheared-off corner falls through** | 4 | PASS |
| A · reset | `↺` re-sleeps Rook, returns the selection to Pegasus, keeps the name treatment | 2 | PASS |
| B | the strapline sits **below the hero name block, above the barcode footer**, clear of the cut-in stack | 1 | PASS |
| B | everything settled is untouched: masthead, rarity spine, 3 cut-ins + their tape spines, barcode, `¥0` | 1 | PASS |
| B | still exactly **four** machine buttons; promote still turns the page; develop still wakes + stamps, and the strapline follows | 3 | PASS |
| C · geometry | the chip switches `data-geo`; the **collaged overlap survives** (3–5 overlapping pairs per geometry) | 6 | PASS |
| C · geometry | the page starts **under the banner** in all three — every geometry authored in that box | 3 | PASS |
| C · geometry | the **polygon IS the hit area**: the point farthest outside it (inside the footprint rect) falls through, every panel, every geometry | 3 | PASS |
| C · geometry | the burst wake runs in **each** geometry (ZZZ gone, tape re-hued, sticker tells the truth); reset re-sleeps Rook and **keeps** the geometry | 6 | PASS |
| C · tapes | every tape is on-screen, still `#ffe14d`, star `14.04px` — in all three geometries | 3 | PASS |
| C · tapes (paint) | the star row is painted in the **production star colours**, on a pill tall enough to carry it (24–25px) | 8 | PASS |
| C · tone | thinned: `opacity .15`, `--tone-dot 1.15px`, the face punch-out present — all three geometries | 3 | PASS |
| C · tone (paint) | with the art hidden and the paper turned white, the **face box has zero ink** (255.0 mean) while the field beside it carries tone (14.9% coverage, 252.3 mean) | 3 | PASS |
| C | the black CLUB band and the sleeping panel's heavy treatment are untouched | 1 | PASS |
| overflow | `scrollWidth <= clientWidth` on document, body, stage **and A's scroller**, and every drop / panel / banner right edge inside the viewport — **320 and 430 × A plate, A blade, B, C tilt, C cut, C spread** | 12 | PASS |
| A · motion | tap-anywhere collapses the ceremony to its final frame (325ms of a 900ms budget); reduced motion kills the idle breathe and still lands the wake (531ms) | 2 | PASS |
| console | clean through the entire run — errors, warnings, failed requests | 1 | PASS (0 / 0 / 0) |

**Three things this round taught the harness or corrected in the record:**

- **A round-2 claim was over-stated, and paint-level probing caught it.** The round-2 table said "a
  tap on a slice's own drop band hits *that* slice". It does not, and cannot: `.po-drop` is
  `pointer-events: none`, and a `clip-path` can only *shrink* a hit area — it never extends one past
  the element's border box. What the union `--poly-hit` actually buys is that the drop is **not
  clipped away**, which is a *paint* property and is now asserted as one (the hue really is there
  2.5px past the trailing edge). The hit-area rows now assert only what is true: inside the shape
  hits, the sheared-off corner falls through.
- **`clip-path` hides paint but does not contain SCROLLABLE OVERFLOW.** Once the stack moved into a
  scroller, `.po-flashline` (`-4%` / `-4%`) and BLADE's `nowrap` name reported real `scrollWidth` on
  it — 396 against a 390 client — even though nothing was visible. `.po-plate { overflow: clip }`
  contains them without making the plate a scroll container of its own.
- **Derive probes from live geometry, always.** Round 2's lesson held and was extended twice: the
  drop probes now read the shear back off the **resolved** `clip-path` (its first vertex is
  `0 --run`), so they follow `--a` rather than a hard-coded 10°; and C's fall-through probe no longer
  samples a corner — on a torn edge a vertex can sit a fraction of a pixel from the corner and the
  probe lands *on* the boundary. It now samples a grid and takes the point **farthest** outside the
  polygon, and places it by inserting a 1px marker at the local coordinate and reading its rect back,
  so every transform (rotation included) is applied by the browser rather than reconstructed.

Both verification scripts are throwaways — they live in the session scratchpad, not in the repo.

### Round 2 — screen A (superseded by round 3, kept for the record)

Round 2 touched **screen A only**, so screen A was re-run from scratch and B / C keep the round-1
pass below. 112 behavioural + geometric assertions, plus **29 pixel assertions** read back off the
captured PNGs with Pillow.

| Area | Check | n | Result |
|---|---|---|---|
| A · paint (DOM) | name, stars and role are laid out, visible, inked and non-empty — every slice, **both treatments** | 24 | PASS |
| A · paint (pixels) | each name is genuinely **inked in its rarity hue** inside its own box, counted off the capture | 8 | PASS |
| A · rotation | every part's top edge is **not level** — i.e. it really did turn with the shear, both treatments | 24 | PASS |
| A · safe zone | the rotated corners of name / stars / role fall **inside the resolved slice polygon** (PLATE); in BLADE, stars + role fully inside and the blade's *leading* edge inside — the trailing overhang is by design | 28 | PASS |
| A · safe zone | the block's anchor is still **bottom half · leading side · above the rising diagonal**, both treatments | (in 28) | PASS |
| A · drop (geometry) | every underlay is offset by **exactly 5,5**, wears the **same resolved polygon** as its plate, and paints behind it | 8 | PASS |
| A · drop (pixels) | the hue is there **2.5px past the trailing edge** and **2.5px below the bottom edge**, is **absent on the leading edge**, and the gutter past it is still black — i.e. a directional offset, not a flood | 16 | PASS |
| A · drop | Rook's grey underlay **floods to its rarity green on wake** (also under reduced motion) | 2 | PASS |
| A · hit area | the union clip-path keeps the shear honest: a tap on a slice's own drop band hits **that** slice, the sheared-off corner falls through to nobody, and the slice below still owns its own area | 3 | PASS |
| A · blade | the status chip is **not buried** by the blade in any slice | 4 | PASS |
| A · toggle | PLATE → BLADE and BLADE → PLATE both flip `data-name` | 2 | PASS |
| A · ceremony | the wake runs, clears `asleep`/`waking`/`parting`, flips the chip, rewrites the aria-label, announces, and unmounts the catcher; a second tap opens the dossier | 2 | PASS |
| A · dossier / reset | Escape closes and returns focus to the slice; `↺` puts Rook back to sleep and keeps the name treatment | 2 | PASS |
| A · overflow | `scrollWidth <= clientWidth` on document, body and stage **and** the 5px drop stays inside the viewport — 320px and 430px × both treatments | 8 | PASS |
| A · reduced motion | idle breathe off; the ceremony still runs and still lands (749ms) | 3 | PASS |
| A · tap-to-skip | the catcher mounts, a tap collapses to the final frame (375ms of a 900ms budget) and unmounts it | 2 | PASS |
| A · console | clean through the whole run — errors, warnings, failed requests | 1+2 | PASS (0 / 0 / 0) |

Two things this round taught the harness, both worth keeping:

- **Assert paint, not just state.** The round-1 lesson stands (a `*/` typo once left every name
  invisible while all behavioural checks passed), and it is now enforced twice: a DOM check *and* a
  Pillow pixel count inside each name's own box. The safe-zone check still reads the shear back off
  the **resolved** `clip-path`, so it follows `--a` rather than a hard-coded 10°.
- **Derive probe points from the live geometry.** The first pixel pass failed one control because a
  fixed "8.5px below the bottom edge" offset slid into the next slice once the woken slice took its
  `.picked` nudge (`translate3d(9px,0,0)` raises the edge ~1.6px). The gutter probe now samples the
  midpoint between *this* drop's edge and the *next* plate's top edge, computed at capture time.

### Round 1 — B and C (unchanged this round)

The round-1 pass was **40 / 40** across all three screens; its screen-A rows are superseded by the
table above and are dropped from this one.

| Area | Check | Result |
|---|---|---|
| Render | A / B / C render at 390×844 | PASS |
| Console | clean on every screen, through every ceremony, at 320px, at 430px, and under reduced motion | PASS (0 errors, 0 warnings, 0 failed requests) |
| Ceremonies | B promote (hero becomes ROOK) · B develop (mono → colour + stamp) · C burst wake | PASS — each clears the sleeping state and announces it |
| Ceremonies | after waking, the machine opens the dossier instead (B) | PASS |
| Ceremonies | C's `STANDBY` sticker flips to `ONLINE!`, the ZZZ is removed, the tape's grey cap re-hues | PASS |
| B · buttons | still exactly 4 machine buttons after a promotion | PASS |
| Tap-to-skip | catcher mounts during a ceremony; a tap collapses to the final frame (332ms of a 900ms budget) and unmounts it | PASS |
| Dossier | focus moves to `×` on open, Escape closes, focus returns to the opening button | PASS |
| Reset | `↺` puts every concept back to one sleeping machine | PASS |
| Switcher | ←/→ move and rewrite the hash; `#A` / `#B` / `#C` deep-links restore the right screen | PASS |
| Overflow | `scrollWidth <= clientWidth` on document, body and stage — **320px and 430px, all three screens** | PASS |
| Reduced motion | idle breathe and C's ZZZ float stop; ceremonies still run and still land (456ms) | PASS |

## Known rough edges

- **B**'s two-step wake (promote, then develop) is the brief's interaction, but it means the sleeping
  machine is the only one that costs two taps. Flagged above as a walk question, not fixed silently.
- **A now costs two taps to open anything**, which is what select-then-open buys the registry. On a
  fleet you know by heart that is one tap too many; the counter-argument is that the registry is
  where the ping and the services live, so the first tap is often the *only* one you want. A ruling
  either way is cheap — the branch is three lines in `tap()`.
- **A's registry is below the fold when the banner is on.** That is the ruled trade (nothing may pin
  at the bottom — production's tab switcher and composer live there) and selection deliberately does
  *not* scroll to it. So on the landing frame, tapping a slice changes something you cannot see. The
  in-stack grow + nudge is the compensation; whether it is enough compensation is a walk question in
  its own right.
- **A's slices scroll under the lab's switcher chrome**, which sits where production's tab bar and
  composer will. That is faithful, but it does mean the bottom slice is partly covered on the
  landing frame — read it as the reserve, not as a clipping bug.
- **MIN is B's strip on A and C**, which means A's slim banner uses a copy block authored for a
  118px-wide cover inset, not for a full-bleed 390px strip: the display line has room to spare and the
  dots sit further in than they would if the strip had been authored for full-bleed. Deliberate — a
  second authored variant would be a second thing to walk — but it is the one place MIN looks borrowed.
- **The banner mock has no pointer machine.** No drag, no dot taps. That is deliberate (the lab
  contract), but it means the *feel* of the shipped banner — the swipe, the click suppression after
  a drag — is not what is being walked here. Only its read is.
- **C is PARKED** and does not generate from a count; it is here as a look. TILT, CUT and SPREAD are
  each their own authored template set, and the three of them are the record of how loud the theme was
  willing to get.
- The Japanese strings fall back to the system JP face — the self-hosted subsets are **latin** only,
  since full JP faces run multi-MB.
- Idle motion is deliberately cheap everywhere (one 24s breathe, one 3.2s ZZZ float). No particle
  fields, no canvas — the §14.11 discipline.
- Desktop is *not* a design target: it centres the phone column and stops there.

## Assets

Copied verbatim from lab v2 so the three labs are visually comparable: the four art crops
(`pegasus.webp`, `atlas.webp`, `3.webp`, `4.webp`) and seven self-hosted latin `woff2` subsets
(Bungee · Zen Kaku Gothic New 700/900 · Archivo Black · Rubik Mono One · Silkscreen ·
Dela Gothic One). Nothing is fetched at runtime.
