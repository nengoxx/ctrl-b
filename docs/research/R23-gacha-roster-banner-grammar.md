# R23 — Gacha roster & banner screen grammar

**Date:** 2026-08-07 · **Status:** BANKED (Opus research lane, curated by the main seat)
**Question:** how do gacha / live-service games stage a small cast as desirable, collectible
characters (roster screens, banner screens, rarity ceremony), and which of those fictions fit a
fleet of 4 PCs?
**Drives:** the alt-fleet ensemble design discussion (GACHA_PLAN §12 + §12.5) and the
`alt-fleet-showcase-v2` design lab.
**Siblings:** [R22](./R22-select-screen-grammar.md) · [R24](./R24-game-feel-web-techniques.md) ·
[R18](./R18-ensemble-collage-fleet.md).

**Confidence:** claims marked **[sourced]** have a URL in the Sources block. Unmarked claims are
direct observation of the shipped UIs, attributed per game. Screenshot-level geometry (shear
angles, visible-cell counts, size ratios) is design-read, not measured — verify against reference
captures before pinning any number in a spec. Unreachable this pass (403/402): Game UI Database
Arknights id=478, ZZZ fandom Main Menu, azurlane.koumakan.jp.

---

## Part I — per-game

### 1. Zenless Zone Zero (the archetype for shear)

- **Roster.** A horizontally scrolling rail of **parallelogram cards sheared ~10–14° off vertical,
  leaning right**; tall (≈2:3); the character art **bleeds past the card's top edge** — the frame is
  a window the character is climbing out of. 4–5 cards visible; the selected card scales ~1.25×,
  slides forward, hands off to a live 3D model.
- **Chrome density.** Rank letter in a notched corner tab (**S = gold/orange, A = purple, B = blue**
  [sourced]) + Attribute chip + Specialty glyph + Faction logo + level + Mindscape pips — **five
  orthogonal taxonomies on one card**, still legible because each lives in a fixed corner slot on a
  flat plate; ornament lives in the negative space and *behind* the figure.
- **Featured/hero.** Signal Search: featured S-rank splash ≈ 60–70% of frame on a diagonally-split
  two-color field; the A-rank rate-ups are demoted to small thumbs (~4:1 linear hero:roster).
- **Diagonal language.** A full-bleed diagonal band at ~15–20° carrying a **repeating marquee of the
  agent's name + serial**, used as the divider between art and stat zones; it crosses *behind* the
  character (depth from a 2D element). Type interacts three ways: the name **huge, condensed,
  uppercase, outline-only, cropped by the frame edge** behind the figure; a Latin+kana lockup; the
  marquee band.
- **Print artifacts [sourced].** Confirmed influences: Persona 5, Street Fighter, Digimon World.
  Kit: Ben-Day halftone, glitch, reverse/inverted color flashes, onomatopoeia lettering, chevrons,
  tape/CRT/VHS motifs, scanlines, an "HDD boot" transition. Sixth Street drops brightness/saturation
  so high-purity characters and UI pop [sourced].
- **Idle.** 3D idle-breathing with physics follow-through on tab change [sourced]; marquee scroll;
  noise/scanline overlay.

### 2. Honkai: Star Rail (restraint + the ticket ceremony)

- **Roster.** Vertical scrolling column on the left third — rounded cells, ~7–9 visible, circular
  portrait + element ring + Path glyph + level + Eidolon pips; rarity as a **corner gradient wash**
  (gold 5★ / purple 4★). Right two-thirds = live 3D model. **The most phone-portable layout here.**
- **Banner.** Hero splash left-of-center, poetic event title, rate-up behind a chip, `Warp ×1/×10`
  bottom-right, explicit pity counter. HSR on itself: "the menus have a soft look… not too much
  decoration"; "the stars are the characters" [sourced].
- **Ceremony — the clearest 4-beat structure:** ① anticipation (the Warp ticket streaks straight
  across a starfield [sourced]) → ② **the tell** (the ticket is blurry with a **rainbow fringe** if
  a 5★ is in the batch [sourced] — deliberately subtle) → ③ reveal (doors open; **the hype music
  differs by tier** [sourced] — audio as a rarity channel) → ④ celebration (cards tapped through
  one at a time, tier-appropriate bursts).
- **Motion signature [sourced]:** "the big shapes are impactful, and the secondary animation of the
  dots puts a high level of finish" — **one large geometric primary + fine particulate secondary,
  offset in time.**

### 3. Genshin Impact (the ornate frame + a cautionary tale)

- **Party setup.** Four slots in a bottom row — a **fixed-count formation**, not a scroller; a
  "formation" reads differently from a "list."
- **Wish banner.** Featured 5★ centered and largest — analyzed as deliberate hierarchy to drive
  rolls [sourced]. Ornate scrollwork frames, serif titles.
- **THE CAUTIONARY TALE [sourced].** On the *standard* banner Keqing is drawn slightly larger than
  Mona/Qiqi; players read it as rate-up framing though rates are equal. **Size is a promise. Never
  size something up for aesthetic balance alone.**
- **Ceremony [sourced].** The wish streaks across the sky and **turns blue → purple → gold as the
  tier resolves** — the most legible rarity ceremony in the genre: **the anticipation object itself
  changes color to announce the tier before the character exists on screen.**

### 4. Arknights (the archetype of the personnel-file fiction)

- **Roster.** Chamfered-rectangle operator cards (one cut corner), dark industrial busts, scrolling
  grid. Chrome: class icon in a black chevron, 1–6 star row [sourced], E0/E1/E2 promotion insignia,
  potential pips; stats later **overlaid directly on the card** [sourced]; favorites pinnable
  [sourced]; stat text reduced to icons over time [sourced].
- **The dossier fiction — the core contribution.** The operator Archive is a literal personnel
  file: Code Name, Combat Experience, Place of Birth, Race, Height, **Infection Status**, and a
  **Physical Examination block in letter grades** (Physical Strength / Mobility / Endurance /
  Tactical Planning / Combat Skill / Arts Assimilation → S/A/B/C/D/E), plus clinical third-person
  prose. **The game does not describe a character; it renders a bureaucracy's record of an asset.**
- **Recruitment** doubles down: post a listing, pick tags, wait a 1h/4h/9h timer. Hiring, not magic.
- **Rates as ornament [sourced].** 6★ 2% / 5★ 8% / 4★ 50% / 3★ 40%; +2%/pull after 50 to a
  guarantee at 99; limited guarantee at 150; spark at 300 — printed on the banner face as design
  elements.
- **Print kit.** Black / bone-white / hazard orange; mono + technical labels; 45° hazard tape;
  barcodes, tick-strips, dot-matrix numerals; logo watermarks; redaction bars. Post-Episode-13 the
  home screen supports swappable event color schemes [sourced].

### 5. Blue Archive (flat, bright, the phone-inside-the-phone)

- **Student list.** Near-square cards, generous rounding, bust art on a **pastel flat field, no
  gradient**, star row, school crest badge, Striker/Special tabs. Thin rounded sans, heavy white
  space. **The anti-Arknights: almost no chrome, all color and air.**
- **The identity glyph [sourced].** Every student has a **halo** — a floating disk/ring above the
  head, varying in color/shape/design, keyed to personality. A **per-character logo**: unique,
  legible at 24px, reusable as an icon anywhere. The cleanest "give each roster member a mark, not
  just a portrait" in the genre.
- **MomoTalk.** A literal chat app in-game: contact list, circular avatars, unread badges,
  presence-like state, bubble threads. **The strongest precedent for staging a roster as a
  messaging contact list — which an "online/offline" fleet already is.**

### 6. NIKKE (corporate-military product catalog)

- Tall cards with a hard angular bottom-right cut; **R/SR/SSR** [sourced]; taxonomy chips:
  **Manufacturer** logo (Elysion/Missilis/Tetra/Pilgrim) [sourced], Burst Type as Roman numeral,
  Element Code, class, weapon. The fiction: Nikkes are **manufactured products with a brand**
  [sourced: Tetra "glamorous designs focused on entertainment"]. **Brand-as-faction maps directly
  onto hardware vendors.**
- **Ceremony.** A capsule/pod descends, seams glow, opens; SSR announced by a **gold column of
  light** before the figure is visible. Anticipation is *spatial* (something arrives), not temporal.

### 7. Fate/Grand Order (the oldest grammar; card-flip ceremony)

- **Roster.** A dense spreadsheet grid — deliberately information-dense and low-chrome. The
  counter-example: **a roster can be utilitarian if the ceremony carries the desire.**
- **Banner.** Bespoke wide illustration, heavy JP type, the canonical **"PICK UP"** ribbon.
- **Ceremony — the best tell design in the genre [sourced]:** the summoning ring turns
  blue → gold (occasionally **rainbow**) · cards land face-down as bronze/silver/gold backs · a
  silver card can **spark and turn gold mid-reveal** · an upgraded card is rendered
  **double-sided so the class shows on both faces during the flip** — the flip animation itself is
  instrumented to leak information. The purest **near-miss engineering** [sourced, general
  literature].

### 8. Wuthering Waves

Banner tabs as a **stacked vertical icon strip on the left edge** (banner switching as a rail —
phone-friendly). `Convene ×1/×10`; **pity surfaced as a first-class numeric counter**. 5★ gold /
4★ purple. Roster = HSR's column + stage pattern.

### 9. Azur Lane (the dock/hangar fiction — best fit for machines)

- **Dock.** Dense grid ~4×3 to 5×4 visible; each cell a portrait in a **colored rarity frame**
  (Normal grey, Rare blue, **Elite purple, Super Rare gold** [sourced], Ultra Rare iridescent) +
  hull-type icon, level, limit-break stars, affinity heart, **lock pin**. Heavy always-visible
  sort/filter chrome — because the dock holds hundreds (an inventory screen first).
- **Fiction.** You don't summon — you **build**: a shipyard with a real-time build timer, then a
  launch. **Manufacture-and-berth is the most natural gacha fiction for machines you own and can
  power on.**
- **Idle.** Live2D breathing + touch reactions + parallax on tilt.

### 10. Uma Musume (two-axis rarity + broadcast graphics)

- **Split rarity** [sourced]: trainees carry star rarity; support cards carry R/SR/SSR — two rarity
  languages on two object classes. Precedent for "the machine has a tier AND its components have
  tiers."
- Scouting: Spotlight Banner tabs; 150/1500 carats [sourced]. Register = **racecourse broadcast**:
  gate numbers, tote-board numerals, silks color coding, aptitude **letter grades A–G** (the
  Arknights letter-grade trick applied to performance). Ceremony = the **starting gate**: gates
  rattle, then open — anticipation as a *mechanical latch*, not a light.

### 11. League of Legends group posters (K/DA, True Damage) — the poster grammar

- **Composition:** 4–5 members on a flat high-saturation field (no environment); **one member
  centered and forward** (Ahri / Akali [sourced]), the rest fanned back in a **shallow arc**, each
  separated by a hard drop shadow or colored rim so silhouettes never merge.
- **Wordmark:** heavy custom display face, oversized, **cropped by the frame edge**, repeated as a
  low-contrast background pattern. Member names in a small-caps footer strip; Hangul/Latin pairing;
  graffiti/spray for True Damage, chrome/holo gradients for K/DA ALL OUT.
- **The reusable move:** assign each member **one color**, compose so the colors read as a
  deliberate palette; solo posters **reuse the exact group pose at a different crop** — one asset,
  two crops. Concept leads: Paul Kwon (Zeronis), Jesse Li [sourced].

---

## Part II — synthesis

### A. Cross-cutting principles

1. **The roster is never a list — it's an institution's records.** Arknights files operators; Azur
   Lane berths ships; NIKKE catalogs products; Blue Archive enrolls students. **Pick the
   institution first; the field names, vocabulary, and chrome follow for free.**
2. **Rarity is a full stack, not a badge:** a hue (gold ▸ purple ▸ blue ▸ grey is near-universal)
   + a material (foil/iridescence/matte) + a typographic weight + a **motion budget** + a sound
   [HSR changes the music by tier, sourced]. If the top tier only differs by color, it isn't a tier.
3. **The hero-vs-roster size contract (≈3–5× linear; the hero may break the frame, the roster stays
   inside) — and its liability: size is a promise** [Genshin/Keqing, sourced]. Never size up for
   aesthetic balance alone.
4. **Over-decorated chrome that still reads = decoration on the perimeter, data on flat plates in
   fixed slots** [ZZZ's five taxonomies; Arknights' stats-to-icons]. Ornament goes where data isn't.
5. **Ceremony is four beats, and THE TELL is the craft:** anticipation → the tell (the token leaks
   the outcome early: FGO's ring colors + double-sided flip; HSR's rainbow-fringed ticket;
   Genshin's blue→purple→gold) → reveal → celebration. The tell makes people watch instead of skip;
   without it the ceremony is just latency.
6. **Every roster member owns a compact identity glyph** [Blue Archive's halo]. Portrait art
   doesn't scale down; a glyph does.
7. **The diagonal is the energy axis; the grid is the institution axis.** ZZZ shears ~10–20° for
   pop; Arknights/FGO keep orthogonal grids for bureaucracy/inventory. Commit to one; use the other
   sparingly. Equal-weight mixing reads as an unfinished template.
8. **Saturation encodes state.** Unowned/locked/unavailable = silhouette or desaturation —
   universal, needs no legend. (Gacha's ONLINE=color / SLEEPING=grayscale is already fluent.)
9. **Numbers are ornament.** Pity counters, drop rates, serials, timers printed on the banner face
   [Arknights, sourced; WuWa first-class pity]. Real data displayed as decoration builds trust and
   fills layout at zero design cost.
10. **The roster must appear alive when idle** — breathing, parallax on tilt, marquee tickers,
    drifting particles. A frozen roster reads as a spreadsheet.

### B. Mapping onto 4 PCs

The fleet already speaks the dialect: stars = specs, ONLINE=color / SLEEPING=grayscale (principle
8 exactly as shipped), wake = the summon.

**Fits naturally:** personnel file (a machine genuinely HAS a spec sheet — Code Name→hostname,
Place of Birth→vendor, Physical Exam→CPU/RAM/GPU/disk graded A–S) · dock/hangar (machines berth;
boot = launch; construction-with-a-timer maps 1:1 onto boot time) · squad formation (exactly 4
slots IS a party; empty slot = ghosted outline) · manufacturer branding (vendors are real factions)
· contact list with presence (**the only fiction where the status badge isn't a metaphor — zero
fiction tax**) · group poster (4 members, 4 colors, one featured; naturally phone-portrait).

**Fights the material:** the rate-up banner as the *primary* frame (you own all four; the gambling
grammar — pity, percentages, ×10 — is cosplay with nothing underneath; **use the banner's
hierarchy, not its mechanics**) · rarity as the dominant sort (4 items rank nothing; stars = a spec
readout, not scarcity; no sort/filter chrome for a set of four) · the near-miss ceremony (**the
wake outcome isn't uncertain, just slow — dramatize LATENCY and confirmation: a gate opening, a
boot sequence, a ping returning; faking tier suspense reads as noise the second time**) ·
Live2D-grade idle (**use data motion instead: ticker, uptime counter, ping sparkline — free and
honest**).

### C. Five named concept directions (phone-width, 4 machines)

**C1 "SECTOR ROSTER" — the personnel file** *(Arknights + Uma letter grades).* Vertical stack of 4
chamfered cards (~112px, one 45° cut corner), 45° hazard-stripe rules between; tap expands in place
into the dossier: mono label/value rows, a letter-graded exam block (CPU **S**, RAM **A**, GPU
**B**, DISK **A**), a redacted "clinical notes" line. Active machine = thin orange keyline +
"ACTIVE DUTY" tab; sleeping = grayscale + "STANDBY" stamp rotated ~−8°. **Wake ceremony:** status
flips to dot-matrix "DISPATCHING…" + a scanning bar sweeps the card → on first ping the
desaturation lifts **as a wipe from the cut corner outward** (~600ms) → a rubber-stamp "ONLINE"
thuds on at −8° with a 1-frame overshoot. Kit: hazard tape, hostname barcodes, dot-matrix uptime,
facility watermark at 6%, `FILE NO. 004-ζ` serials, redaction bars.

**C2 "SIGNAL SEARCH" — the diagonal band** *(ZZZ).* A diagonal band at 14° crosses the page
carrying a marquee ticker (`◆ EMMA ONLINE 41d 06h ◆ CORSAIR STANDBY ◆ …`). Hero above; a rail of 3
parallelogram thumbs (sheared 14°, ~96×140) below; hard ~4:1 hero:thumb ratio; the hero name huge,
condensed, outline-only, cropped by the right edge, hero art overlapping in front. **Wake
ceremony:** the band fills with a color sweep **along its own axis** → halftone dot burst + one
inverted-color frame at first ping → grayscale snaps to color with a 1-frame chromatic offset → an
onomatopoeia burst (`WAKE!`) in the band, then decays. Kit: Ben-Day halftone, chevrons along the
band, VHS/scanline at 4%, serials in the band's repeating text, vendor faction chips.

**C3 "THE DOCK" — berth and launch** *(Azur Lane + NIKKE's pod).* A **2×2 grid of square berth
cells** (~48vw, full-bleed to the gutters) — the one layout that puts all four machines on a phone
with zero scrolling. Rarity-frame color = spec tier; hull-type glyph (desktop/laptop/server/NAS);
uptime; a lock pin for "do not wake"; berth numbers. Hierarchy by **cell span**: a featured berth
spans the full top row (2×1), demoting the rest to a 3-across strip — honest hierarchy, no size
hacks. **Wake ceremony:** the berth frame's seams glow and split; a **real boot timer counts up**
in the cell (no fake suspense) → on ping a **column of light in the frame's rarity color** rises →
desaturation lifts → the frame reseals with a metallic tick; the timer turns amber if boot exceeds
expected — **the ceremony doubles as a progress indicator** (the strongest functional argument in
this dossier). Kit: rivets, panel lines, `BERTH 03`, fleet spec totals in a header strip.

**C4 "MOMOROSTER" — the contact list** *(Blue Archive MomoTalk + halo-as-glyph).* Four rows ~88px
on a pastel flat field; 64px circular avatars with a bespoke **halo glyph** floating above each
(drawn once as SVG, reusable at 20px anywhere); presence dot; last-seen line; badge pills. A
featured machine gets a pinned card ~2.2× row height with full-body art + a status line in a speech
bubble (pinning must be an explicit user action — the Keqing rule). **Wake ceremony:** the row
shows a **typing indicator** (three bouncing dots) while the wake packet is in flight — the perfect
existing idiom for "in progress, unknown duration" → a speech bubble pops with an in-character
line, the dot animates grey→green with a ring pulse, the halo spins up and settles.

**C5 "FLEET/4" — the group poster** *(K/DA / True Damage + FGO's flip).* Full-bleed flat color
field; four machine avatars in a **shallow arc**, the featured one centered-forward at ~1.6×, each
with a hard rim light in **its own accent** (4 members = 4 colors = one palette). The fleet
wordmark oversized, cropped by the top edge, repeated behind at 8% as a pattern; a small-caps
footer strip lists all four names, featured underlined. Tapping a back member swaps poses (slide to
center, colors re-key — one asset, two crops). Sleeping = a flat silhouette in its accent at 30%.
**Wake ceremony:** a **card-flip** — the silhouette flips on its Y axis and lands full-color and
rim-lit, with the FGO tell: **the flip's back face is already lit, visible mid-rotation**; the
wordmark pattern pulses once in that machine's accent.

### D. Picking between them

- **C3 The Dock** = strongest *functional* fit (all four visible, span-hierarchy, ceremony = a real
  progress indicator).
- **C1 Sector Roster** = richest *content* fit (specs are a true dossier — ornament is honest data,
  principle 9).
- **C2 Signal Search** = strongest *style* fit if the theme is already gacha-loud; the 14° band and
  4:1 hero ratio are expensive to keep legible at 390px.
- **C4 MomoRoster** = lowest fiction tax, least new art; the safe, honest one.
- **C5 Fleet/4** = **the best anchor image** — the one composition that makes exactly four items
  feel like a deliberate cast rather than a short list; worth building even if only as the hero
  card of another direction.

---

## Sources

- 141store.com — "Analyzing the Visual Feast of ZZZ" (palette, Ben-Day, glitch, onomatopoeia,
  physics follow-through, Sixth Street saturation)
- Don X — "UI Noir: Honkai Star Rail" (Medium) — big-shapes + secondary dots, straight-line intro,
  restrained decoration
- Joedi Ho — "Genshin Impact: Gacha games and their element of design" (Medium) — centered/largest
  5★; the Keqing size-implies-featured failure
- Arknights Terra Wiki — Headhunting (rates, pity ramp, spark) · Operator (1–6 stars) ·
  arknights.fandom.com — User interface (stats-to-icons, card overlays, pinning, event schemes)
- Fate/Grand Order Wiki — Summoning (ring colors, rainbow, silver-sparks-gold, double-sided flip)
- GINX — HSR 4★/5★ warp animation differences (rainbow-fringed ticket, tier music)
- Game8 — ZZZ S/A-rank lists · BitTopup — ZZZ pity (S=gold/orange, A=purple, B=blue; rates)
- Blue Archive Wiki — Halo (per-student identity mark)
- Prydwen — NIKKE character progression · gachagames.miraheze.org — Nikke (R/SR/SSR, burst,
  manufacturer, element, class)
- BlueStacks — Azur Lane ship guide (rarity tiers/colors)
- GameRant — Umamusume scouting explained · PCGamesN — Uma tier list (two-axis rarity, carats)
- Wuthering Waves Wiki — Convene (banner structure, explicit pity)
- ArtStation — K/DA concept art (Paul Kwon/Zeronis) · True Damage poster work (Dan Siddiqui)
- Wikipedia — Gacha game (near-miss reveal technique)
