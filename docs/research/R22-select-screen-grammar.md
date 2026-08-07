# R22 — Character-select screen grammar (fighting/action games)

**Date:** 2026-08-07 · **Status:** BANKED (Opus research lane, curated by the main seat)
**Question:** what makes a character select screen read as "a real game" the moment it appears, and
which of those devices survive a 4-unit roster at phone width (390–430px)?
**Drives:** the alt-fleet ensemble design discussion (GACHA_PLAN §12 + §12.5) and the
`alt-fleet-showcase-v2` design lab.
**Siblings:** [R23](./R23-gacha-roster-banner-grammar.md) (gacha roster/banner grammar) ·
[R24](./R24-game-feel-web-techniques.md) (game-feel → web mechanisms) ·
[R18](./R18-ensemble-collage-fleet.md) (the probed technique stack).

**Confidence:** claims marked **[cited]** have a web source in §7. Unmarked claims are direct
observation of the shipped screens — high-confidence but uncited. Two access notes from the pass:
`gameuidatabase.com` and `interfaceingame.com` both 403 automated fetching (human-browse only; GUIdb
has a dedicated Character Select filter at `index.php?scrn=41`), and
`tcrf.net/Prerelease:Street_Fighter_6/UI_Design` currently serves **prompt-injection content to
fetchers** — open it in a browser only, never via an automated tool.

---

## 1. Per-game teardowns

### 1.1 Guilty Gear Strive (Arc System Works, 2021 / Ver. 2.00 2026)

**The single strongest reference for this brief** — the loudest, most graphic-design-forward select
screen in the genre.

- **Composition.** Radically asymmetric. A **compact grid of small square cut-out portraits**
  occupies roughly the lower-left third; the **selected character's full 3D model stands enormous**
  on the opposite side, floor-anchored, nearly full screen height. The ratio is the point: roster
  ≈ 8% of screen area, selected character ≈ 45%. The P1/P2 split is not mirrored-symmetric — it's a
  layered collision of two asymmetric blocks.
- **The beta→final structural change [cited].** The 2020 beta grouped fighters by **playstyle
  archetype** (Balance/Speed/Power/Tricky) with blurbs; the final build **removed the archetype
  grouping entirely**. Cautionary tale: semantic grouping of a small roster added a layer of
  taxonomy the screen didn't need, and shipping killed it.
- **Stated design philosophy [cited].** Ishiwatari cited research on players constantly shifting
  their gaze due to information density; the whole Strive UI program targets **reduced eye travel
  and a "simplistic look"** — one large focal object plus one small scannable index.
- **Typography.** Type as **architecture, not labeling**: enormous condensed uppercase grotesque,
  frequently rotated 90° along a screen edge, frequently *repeated* as texture, frequently
  **cropped by the frame edge** (a letterform running off-canvas signals the type is a graphic
  layer, not content). Hard red / off-white / near-black with a heavy diagonal-cut motif. Numerals
  and small metadata in wide-tracked mono as counterpoint.
- **Ceremony.** Hover is snappy — model swap with a short slide-in, nameplate slamming in on a
  *different* timing curve (~60–100ms stagger is what makes it feel authored). Confirm is weighty —
  pose, color burst in the character's theme hue, a one-or-two-frame full-screen flash.
- **Ver. 2.00 (April 2026) [cited]** revisited the Character Select screen with design variations
  and customization — the screen is a *feature surface*, not chrome.

### 1.2 Street Fighter 6 (Capcom, 2023)

- **Composition.** Central grid of rounded-square 3D-bust tiles; selected fighter's full render to
  the side. **Shared grid, two cursors** — not two mirrored rosters.
- **Environment as background plate [cited].** The Fighting Ground select screen is staged **inside
  a garage, behind a graffiti spray-painted garage door**, over a dimmed black wall with white
  scraped paint. The select screen is *a place*, not a menu over a gradient.
- **Typography [cited].** A custom urban/varsity face ("SF6 College") carries the street-culture
  direction. Critically: **every character has their own personal font and their own graffiti tag
  logo**, reused in their Level 3 Critical Art — per-character *typographic identity*, not just a
  per-character color.
- **Ceremony.** Confirm reads as a spray/stencil slam — ink-splatter mask, hard cut, voice line.

### 1.3 Tekken 8 (Bandai Namco, 2024)

- **[cited]** Inherits Tekken 7's portrait-grid layout, swapping T7's blue shattered-glass
  background for **fiery ember visuals**. Dense rectangular grid (large roster), full render beside.
- **Portraits.** Bust crops, high-key rim lighting, near-uniform pose language — the grid reads as
  a *set*; regularity trades personality for scannability.
- **Ambient motion.** Ember particles + heat shimmer idle — the background breathes when the cursor
  is still. The cheapest "the screen is alive" signal.

### 1.4 Super Smash Bros. Ultimate (2018) — *the counter-example* [cited throughout]

- Grid of boxed head portraits; **Ultimate abandons series grouping for fighter number**. 80+
  fighters → each portrait tiny.
- Player slots open/close 2–8. Echo Fighters **stack into a single slot** toggled by a corner icon —
  an elegant "one tile, two identities" pattern.
- Each player drives a **hand cursor carrying their port emblem** — identity lives in the cursor.
  If a slot reverts without a disconnect, the emblem auto-parks on Random. Defensive default-state
  design.
- Ceremony deliberately minimal per-hover; deferred to one "Ready to fight!" banner. SSB64 showed a
  full 3D model striking a pose; Melee onward dropped to portraits — **roster growth killed the
  ceremony**.
- **Lesson:** premium feel is not intrinsic to grids — it's a function of roster size. **At 80
  fighters you build an index. At 4 you build a stage.**

### 1.5 BlazBlue Centralfiction (2015)

- Grid of square portraits; selected character as a **large hand-drawn illustrated portrait** with
  a nameplate block.
- **Epithet grammar:** proper name in display type + a definite-article epithet in small caps
  beneath ("the Azure Grim Reaper" framing — [cited for lore; exact on-screen string unverified]).
  Four words of mythologizing outperform a spec table.
- Per-character theme-color wash + rotating sigil/magic-circle geometry — **a slow-rotating ring is
  a very cheap, very effective idle**.

### 1.6 The King of Fighters XV (2022)

- 3v3 ⇒ the screen must show the browsable roster, three committed picks per side, and battle
  order. Solution: a **persistent team tray** — a strip of three slots that fills as you confirm.
  **Composed selection needs browse surface ≠ commit surface.** Redesigned select shipped with
  Season 2 [cited]. Black/white/red, chrome bevels, hard angular cuts.

### 1.7 Persona 4 Arena / Persona 5-adjacent (Atlus × ArcSys)

- **Palette [cited].** P5: red, black, white, grey — **blue reserved for the current selection**
  precisely because it's alien to the base palette. Portable rule: *the selection color must be
  outside the theme palette, not a brighter version of it.*
- **Typography [cited].** Blocky letterforms with a **thick black outline**. Split of type roles:
  ornate/display face for repeatable, memorizable elements (menu options, names); plain sans for
  variable content (dialogue, stats). Ransom-note letter variance — which the same sources note
  **costs legibility** (red-on-black passages).
- **Composition [cited].** Hard split: one half black-and-white, the other red, divided by a
  vertical rule funneling the eye.
- **Motion [cited].** The centered character is animated and changes as menus transition — the
  portrait is never static; it reacts to navigation.
- **P4A.** Yellow/black, Midnight-Channel TV-static motif, brush/marker name treatment, diagonal
  "cut-in" portrait slams.

### 1.8 DNF Duel (2022) — *weakest-sourced section*

Painterly heavily-rendered key art [cited: "flashy anime-inspired visuals"]; select leans on
**large painted art in ornate frames** rather than Strive's graphic-design collage. The relevant
contrast: **painted-art-in-a-frame** vs **cut-out-art-in-a-layout** are two select-screen families;
the first needs less typographic scaffolding to feel expensive.

### 1.9 Marvel vs. Capcom lineage [cited]

- In older games characters were just pictures and the announcer did not say their names; by the
  CPS2 titles **the character model is used, and on selection the character quotes or poses** — the
  moment the screen responds *in the character's own voice* is the moment it feels like a game.
- UMvC3 first in series to use 3D models on select. Comic vocabulary: halftone dot fields, ink
  splatter transitions, panel gutters, name-as-bursting-logotype. Team of 3 → bottom tray.

### 1.10 Skullgirls (2012) [cited]

**"Dark Deco"** — Art Deco stages + Golden-Age-Hollywood theatrical presentation (Batman TAS
influence acknowledged). The transferable device is the **marquee/proscenium**: the roster framed
like a theatre bill, portraits as deco medallions. **Framing the roster as a *poster* rather than a
*menu* is the cheapest single move for making a small roster feel like an event.**

### 1.11 Two gold implementation details [both cited]

- **SFV** renders models with a production shortcut: fully rendered but **only the viewable area is
  shaded**.
- **SFxT** gives every character a unique **"come in" animation matched to their personality**:
  Ibuki drops from above in a ninja pose; Hugo walks in slowly from the side. **The entrance
  animation is characterization** — same slot, same duration, different arrival physics.

### 1.12 Street Fighter roster-position rule [cited]

"Characters related to each other are placed near each other — except enemies, who are placed at
the mirrored position on the opposite side." Position encodes narrative relationship.

### 1.13 Indies

- **Rivals of Aether II [cited].** Select screen displays per-character levels — and player
  feedback objected ("both encouraging and discouraging"), requesting it be hidden. **Directly
  relevant to a fleet dashboard: status/stat metadata on a select screen changes it from a stage
  into a report card. Choose deliberately.**
- **Them's Fightin' Herds [cited].** Individually commissioned splash art per character. With four,
  bespoke-per-item is affordable and is the fastest route to "this is a real product."

---

## 2. Synthesis — cross-cutting principles

**P1. The roster is small; the selected character is enormous.** Strive's ratio (index ~8%, hero
~45%). The feeling of "a real game" is produced by the size *disparity*, not the art quality. Two
objects at 5:1 scale read as authored; twelve at 1:1 read as a form.

**P2. The screen is a place, not a menu.** Garage [SF6], deco theatre [Skullgirls], embers
[Tekken 8]. A background plate with implied depth, grain, and a light source does more than any
widget polish.

**P3. Type is a graphic object, not a label.** Rotated, repeated, cropped at the frame edge
[Strive]; per-character bespoke fonts + tags [SF6]; ornate-vs-plain role split [Persona]. The tell
of amateur game UI is a character name set at 16px in the body font. **The name should be the
second-largest object on the screen after the portrait.**

**P4. Every state change is over-answered.** Cursor moves → portrait swaps AND nameplate re-slams
AND accent repaints AND a sound fires. Channels **staggered 60–100ms**, never simultaneous —
that's "choreographed" vs "animated".

**P5. Hover is snappy; confirm is weighty.** Browsing: 100–150ms ease-out, no bounce. Commitment:
350–600ms, overshoot/settle, a 1–2 frame flash, a shake. One timing curve for both feels either
sluggish or cheap.

**P6. The entrance animation is characterization** [SFxT]. Per-item arrival physics in the same
slot and duration — costs nothing but a transform-origin and an easing curve per unit.

**P7. Identity = a persistent per-item accent applied everywhere at once** (plate, nameplate,
cursor, flash — ≥4 elements repainted by one hover).

**P8. The selection color must be outside the theme palette** [P5's blue on red/black/white].
A brighter version of the theme color is not a state change; an alien hue is.

**P9. Name + epithet beats name + stats.** "The [adjective] [noun]" construction [BlazBlue].
Metadata turns a stage into a dashboard [Rivals feedback, cited].

**P10. Browse surface ≠ commit surface** [KOF XV team tray, MvC3 tray] — whenever selection is
composed rather than singular.

**P11. Ambient motion is mandatory and nearly free.** One slow-drifting layer + one slow-rotating
layer + one grain/scanline overlay is the entire recipe. A still screen reads as a document.

**P12. The announcer moment has a purely visual equivalent: the name typesets itself** — letters
arriving in sequence (~25–40ms/char), or a hard slam with scale-overshoot and a shockwave ring.

---

## 3. Translation to a 4-item roster at 390px

**Survives (and often strengthens):** the scale disparity (hero 55–65vh + a comfortable rail) ·
big type (40–56px names are *cheaper* on mobile) · staggered state changes and dual timing (pure
transform/opacity) · per-item accent via one custom property · per-item arrival physics · name +
epithet (two lines) · grain/scanline overlay · the confirm flash (+90ms white overlay) + shake
(±3px/120ms) · a per-unit background plate (vignette + gradient + grain).

**Breaks or needs the roster big:** dense grids (and the corollary: **do not build a 2×2 grid of
SMALL tiles at 390px** — four small tiles read as a settings screen; either four large tiles or one
hero + a rail) · side-by-side P1/P2 splits (becomes a *sequence* + committed tray) · perspective
carousels (Gecko compositor cost; a flat rail + scale-up on active gets 80%) · full-body crops
(~40px wide at the shoulders — crop to bust) · metadata under ~13px on textured plates · particle
fields (cap hard, or one drifting gradient layer) · backdrop-filter (unreliable + expensive) ·
rotated 90° vertical type (eats a 40–56px gutter — reserve for wide viewports).

**The status dimension.** ONLINE=color / SLEEPING=grayscale maps onto the genre's
locked-character idiom (silhouette/grayscale/question-mark plates):

| | idle | selected |
|---|---|---|
| **online** | full color, accent border 40%, gentle idle drift | full color, accent 100%, hero portrait, name typesets |
| **sleeping** | `saturate(0) brightness(0.55)`, no idle motion, accent desaturated | grayscale hero, name typesets in grey, **the wake affordance is the only saturated pixel on screen** |

---

## 4. Five named concept directions (4-unit roster, phone-width)

### C1 — THE SLAB *(Strive × SF6)*
Top ~60vh: selected unit's bust bleeding off the right edge over a per-unit plate (flat field +
hard diagonal cut + grain). Bottom: full-width rail of four square tiles, active 1.15× and lifted
6px. **Ceremony: the nameplate slam** — name scales 1.25→1.0 over 180ms hard settle, white flash at
90ms, 2px shake, shockwave ring on the rail tile; portrait arrives 80ms *before* the name. Name
52px condensed uppercase cropped at the right edge; epithet 13px tracked +0.18em in the accent;
metadata 11px wide-tracked mono. Sleeping = plate desaturates, portrait `saturate(0)
brightness(0.55)`, name renders #8A8A8A, idle drift stops.

### C2 — THE MARQUEE *(Skullgirls deco theatre)*
No separate hero — the roster IS the composition. Four tall portrait cards as deco medallions
(stepped border, corner ornaments, ruled cap band); the active card expands in place to ~1.4× while
neighbors compress and dim. Proscenium header with ruled double-line. **Ceremony: the spotlight** —
everything else drops to 15% brightness over 240ms, a radial highlight blooms, the card's frame
draws itself from the corners over 300ms. High-contrast display serif/deco names in small-caps on
cap bands. The only symmetric/formal direction — the formality is the point. Sleeping = sepia/grey
interior with the frame still fully drawn (the frame is the promise the unit exists).

### C3 — THE QUADRANT *(Smash's grid inverted: tiles so large each is a portrait)*
2×2 of full-bleed cards (~48vw × 32vh), hairline gutters, each card its own scene (own plate, own
accent). **Ceremony: the takeover** — the chosen card FLIP-animates to full-bleed in 420ms while
the other three compress into a bottom strip; one flash frame at arrival. Name 20px→48px, same
element, one scale. Epithet only exists at full-bleed (never shows small text). Sleeping = grayscale
+ faint diagonal hatch — **the best at-a-glance status communication of the five**.

### C4 — THE DOSSIER *(Tekken/KOF stat-card)*
Upper 45%: tight face crop, hard-lit, accent rim light. Lower 55%: a spec sheet — ruled label/value
mono rows. Four-item rail of circular avatars pinned at the bottom. **Ceremony: the readout** —
spec rows populate in sequence 40ms apart, values typing/counting in (the announcer moment as a
type animation), ending with an accent underline sweep. **Caveat: the most dashboard-like and least
character-like — choose only if the fleet must stay legible as infrastructure.**

### C5 — THE CUT-IN *(P4A/P5)*
A skewed band (~−12°) crosses the screen; the selected unit as a cut-out figure with a thick
contour stroke breaking out of the band; roster = four skewed parallelogram chips along a diagonal;
two-tone split background. Hover **replaces** rather than transitions: exit stage-left 120ms, enter
stage-right 160ms with 1.1× overshoot, a 1-frame hard silhouette flash between. Confirm: three
offset copies of the name streak in and collapse (anime ghosting) over 260ms. Sleeping = flat black
silhouettes with the contour stroke intact (shape still identifies the unit). Highest risk, most
graphically distinctive.

| | most "game-like" | status legibility | 390px robustness | build cost |
|---|---|---|---|---|
| C1 Slab | high | medium | high | medium |
| C2 Marquee | medium-high | medium | high | medium |
| C3 Quadrant | high | **highest** | **highest** | medium-high (FLIP) |
| C4 Dossier | medium | high | high | low |
| C5 Cut-in | **highest** | low-medium | medium | high |

---

## 5. The 12-item build checklist (distilled)

1. Hero portrait ≥ 4× the linear size of a roster tile.
2. Background is a *place* — plate + vignette + grain, per unit.
3. Name is the second-largest object on screen.
4. Every hover changes ≥3 things, staggered 60–100ms apart.
5. Hover 100–150ms ease-out; confirm 350–600ms with overshoot.
6. Per-unit arrival physics — different transform-origin/easing per unit.
7. One CSS custom property (`--unit-accent`) repaints ≥4 elements.
8. Selection color lives outside the base palette.
9. Name + epithet, never name + stat table (unless C4, deliberately).
10. Ambient: one drifting layer + one grain overlay, always running.
11. Confirm = flash frame (≤90ms) + shake (±2–3px, ≤120ms) + name typeset.
12. Sleeping = `saturate(0) brightness(0.55)` + idle motion stopped + the wake affordance as the
    only saturated pixel.

---

## 6. Open items for a human pass

- Browse gameuidatabase.com (`index.php?scrn=41`) and interfaceingame.com manually — both 403
  fetchers; their galleries + tag vocabularies are the highest-value uncaptured asset.
- **Never fetch `tcrf.net/Prerelease:Street_Fighter_6/UI_Design` with an automated tool** — it
  serves injection content; open in a browser.
- BlazBlue exact on-screen epithet strings unconfirmed; DNF Duel is the weakest-sourced section.

## 7. Sources

- Game UI Database — Strive `gameData.php?id=623` · Tekken 8 `id=1883` · KOF XIV `id=864` · KOF
  XIII `id=863` · Persona 5 `id=72` · Character Select filter `index.php?scrn=41` *(all 403 to
  fetchers; human-browsable)*
- EventHubs — GGStrive character select beta→final change (2020-10-11) · Tekken 8 select mockup
  (2023-01-10) · UMvC3 full select screen (2011) · DNF Duel beta impressions (2021)
- guiltygear.com — Ver. 2.00 patch notes (2026-04-08)
- toptier.gg — Strive closed beta analysis
- SmashWiki — "Character selection screen"
- streetfighter.fandom.com — "Character Select" (SFV shading; SFxT come-in animations; roster
  position rule)
- Sportskeeda — SF6 TGS 2022 (garage/graffiti staging) · KOF XV day-one roster
- The Point Online — SF6 art-direction piece (SF6 College font, per-character fonts/tags)
- Jordan Samson / Kinga Olszewska / Jiaxin Wen / Mechanics of Magic — Persona 5 UI analyses
  (palette, blue selection, type roles, animated centered figure)
- BlazBlue wiki — Ragna the Bloodedge · Centralfiction
- KOF XV Season 2 select screen (YouTube)
- Arc System Works — DNF Duel · Fighters Generation — DNF Duel gallery
- Skullgirls — "Artistic Origins" · Wikipedia — Skullgirls
- Rivals of Aether II launch feedback (nolt.io/654) + Steam discussion — hide-levels request
- Wikipedia — Them's Fightin' Herds · ArtStation — TFH splash art (Aaron Tucker)
