# R16 — Rarity stars: how gacha UIs actually draw them, and how to draw ours

| | |
|---|---|
| **Date** | 2026-08-06 |
| **Pass** | Field research on **rendered artefacts** — extracted game UI sprites, full-resolution UI screenshots and official store screenshots, **measured pixel-by-pixel** (PIL), plus our own shipped font files measured with fontTools. Vendor docs only for the CSS/SVG technique axis. No device probe. |
| **Question** | How do gacha / collection games treat rarity stars — size relative to the card, fill vs outline vs dual-tone, placement, container treatment, how the top rarity is distinguished, and behaviour at very small sizes? And on the rendering axis: text glyph vs inline SVG vs CSS mask for **crisp outlined stars at 10–16 px on mobile DPR**? |
| **Reference class** | **Gacha / collection-game UI**, as the brief scopes it — Genshin Impact, Arknights, Epic Seven, Blue Archive (measured); Honkai: Star Rail, FGO, NIKKE, Uma Musume, Azur Lane (sampled, contributed nothing measurable — §6). *Not* the README's LLM-app peer class, which has no analogue for this problem. |
| **Drove** | the G7 stars redesign (open) |
| **Rendered companion** | [`design/prototypes/gacha/research-sheets/star-candidates.html`](../../design/prototypes/gacha/research-sheets/star-candidates.html) — 7 candidates (C0 = current), each in both contexts, at real size, in real tokens, with the theme's own font inlined. **Rulings-from-renders beats hex-tables (§7.7 lesson): open the sheet on the phone before reading §5 here.** |
| **Our code under discussion** | `frontend/src/themes/gacha/stars.ts` · `GachaCard.tsx:69–75` · `GachaHostDetail.tsx:156–162` · `gacha.css` `.gc-card .rar` (~1197–1219) and `.gc-dossier .art-rar` (~1798–1816) · `tokens.css` `--gc-star*` (~251–262), `--gc-dossier-badge` (~831) |

**Confidence key** — **VERIFIED** = I fetched the artefact and measured it myself in this pass ·
**REPORTED** = a secondary source or a vendor doc says so · **UNVERIFIED** = derived/expected, not checked.

---

## 0. TL;DR — the five things that change the design

1. **VERIFIED — spacing tracks size, and it is the lever we have backwards.** Small rarity rows in
   the field pack *tight* (Genshin's item card: pitch = ink, 1.00; its extracted sprite actually
   **overlaps**, 0.89), big ones breathe (Genshin's character-detail panel: 1.33). Our card row
   is loose-ish at 1.23 and our **dossier** row is looser still — **1.37 — at a *smaller* size than
   the card**. That inversion (the detail surface's stars smaller *and* more
   spread than the grid's) is unique to us in the sample, and it is most of what makes the dossier
   badge read as a fussy widget rather than a mark.
2. **VERIFIED — nobody puts a filled plaque behind rarity stars.** Four measured games, four
   treatments: bare over the card (Genshin, Epic Seven), or a thin dark *strip* the card already had
   (Arknights). Legibility is bought with a **dark contour on the star** or a glow, never with a black
   lozenge. Our `--gc-dossier-badge` lozenge under `.art-rar` has no precedent in the sample.
3. **VERIFIED — the top rarity is signalled by the CONTAINER, not by recolouring a star.** Genshin
   swaps the card *background* (gold vs purple vs blue), Arknights the card frame + flare, Blue
   Archive swaps the **whole star** to a second colour at full opacity. A row of *mixed-colour* stars
   (our gold + rose-gold top two) is ours alone. Not re-opened — owner-ruled §6.2 — but worth knowing
   it is a signature, not a convention, and that it is the reason our five stars can't be read as one
   silhouette.
4. **VERIFIED — the outlined ask cannot be met with the text glyph, and our repo already has the
   precedent for the fix.** `U+2606 ☆` is in **none** of the eight shipped woff2 subsets (only
   `U+2605` is), so an outlined star written as a character silently falls out of Zen Kaku onto the
   platform's symbol font — visibly a different weight and optical size (rendered side-by-side in the
   sheet's technique lab). `-webkit-text-stroke` on `★` blobs at ≤10 px because the stroke is centred
   on the outline and eats the counters. **Draw the star.** This is exactly the G6.4 close-× move
   (a glyph replaced by geometry because glyph ink is a font-metric, not a design decision).
5. **VERIFIED — the *shape* is a bigger lever than the size.** Every measured reference star is
   squat with blunt/rounded points (inner:outer ≈ 0.5). `U+2605` as our own font draws it is the
   sharp classical star (0.382) with long thin points — the first thing to fur up at 9 px and, as an
   *outline*, nearly invisible at 8–12 px. The sheet renders sharp-vs-round side by side at both
   sizes; the difference is not subtle.

---

## 1. The measurements (VERIFIED)

Everything in this table I fetched and measured myself with PIL. "ink" = the alpha/colour bounding
box of one star; "pitch" = star-origin to star-origin; "p/ink" = pitch ÷ ink width, i.e. how tightly
the row packs. Device pixels as sourced — the normalisation caveat is in §1.1.

| Source | star ink | pitch | p/ink | row ÷ card width | container | fill treatment |
|---|---|---|---|---|---|---|
| Genshin `Icon_5_Stars.png` (extracted sprite) | 27 × 27 | 24 | **0.89** | — | none (3 px glow margin) | flat gold + soft outer glow |
| Genshin item grid, 1920×1080 UI shot | 16 × 16 | 16 | **1.00** | 64 / 104 = **0.62** | none | flat gold, no stroke |
| Arknights operator card, 2732×2048 | ~10 × 13 | 13.2 | **1.32** | 76 / 143 = **0.53** | the card's dark top strip | gold fill + dark contour |
| Epic Seven hero card, 2732×2048 | ~16 | 21 | **1.31** | — | none | gold fill + navy contour, slightly overlapping |
| Genshin **character-detail** panel, 1920×1080 | ~30 × 30 | 40 | **1.33** | — | none | solid; earned bright / unearned **muted solid** |
| Genshin **Character Archive** grid | *no stars at all* | — | — | — | card background gradient | — |
| **ctrl-b capsule card today** | 11.4 × 10.9 | 14 | **1.23** | 67 / 179.5 = **0.38** | none | flat token + `0 0 12px` gold glow |
| **ctrl-b dossier `.art-rar` today** | 9.5 × 9.1 | 13 | **1.37** | 62 / 104 = 0.59 (lozenge box 80 = 0.77) | **filled black lozenge** | flat token, no shadow |

Derivations for our two rows (so they can be re-checked): card `font-size: 12px` +
`letter-spacing: 2px` ⇒ pitch 14 px; dossier `font-size: 10px` + `letter-spacing: 2px` +
`gap: 1px` ⇒ pitch 13 px. Row spans are **ink spans** — `(n−1)·pitch + ink` — so they compare
like-for-like with the gold-pixel bounding boxes measured off the games. Ink from the font, §3.
Card width = the shipped grid
(`grid-template-columns: 1fr 1fr; gap: 10px; padding: 0 12px`) at a 393 px viewport ⇒ 179.5 px.

**Note that the two normalisations disagree.** By *card fraction* the field runs its rarity row at
**0.53–0.62 of the card's width** and ours is the smallest in the sample at **0.38**; by *absolute
pixels on the surface the owner actually holds*, ours is the largest. Both are true — §1.1.

### 1.1 The normalisation caveat (read before quoting a number)

- The Genshin figures come from a **1920×1080 desktop/console** capture, so device px ≈ CSS px, but
  viewed at desk distance.
- The Arknights and Epic Seven figures come from **official App Store screenshots at 2732×2048** —
  iPad Pro 12.9″ *native* pixels at 2×, so the logical size is **half** the numbers above (an
  Arknights star is ~5 logical px, its whole 6-star row ~46 logical px on a 71 pt card).
- Ours are CSS px on a ~393 pt phone.

So "the field runs bigger" (card fraction) and "the field runs much smaller" (logical px) are both
supportable from this table. **The owner's direction — fleet smaller — is consistent with the
logical-px reading**, which is the one that matches a phone in the hand. Recorded rather than
resolved: §7 says what would settle it.

### 1.2 Sources

- Genshin extracted sprites — Genshin Impact Wiki file store:
  [`Icon_5_Stars.png`](https://static.wikia.nocookie.net/gensin-impact/images/2/2b/Icon_5_Stars.png)
  (129 × 33 canvas, ink 123 × 27) ·
  [`Icon_1_Star.png`](https://static.wikia.nocookie.net/gensin-impact/images/b/b7/Icon_1_Star.png)
  (33 × 33, ink 27 × 27), listed via `genshin-impact.fandom.com/api.php?action=query&list=allimages`.
- Genshin UI screenshots — Game UI Database, [Genshin Impact (Console)](https://www.gameuidatabase.com/gameData.php?id=470),
  files `Genshin-Impact01032021-021308-87184.jpg` (item grid),
  `…-021435-49965.jpg` (Character Archive), `…-021309-*` (character detail), all 1920 × 1080.
- Arknights / Epic Seven — Apple App Store official screenshots via the iTunes lookup API
  (`itunes.apple.com/lookup?id=1464872022`, `id=1322399438`), fetched at their native
  `2732x2048` size.
- Blue Archive star assets — Blue Archive Wiki:
  [`Star_Icon.png`](https://static.wikia.nocookie.net/blue-archive/images/1/1f/Star_Icon.png) and
  [`Star_2_Icon.png`](https://static.wikia.nocookie.net/blue-archive/images/d/d2/Star_2_Icon.png),
  both 146 × 141, fully inked.

---

## 2. What the four measured games actually do (VERIFIED, with the reading)

**Genshin Impact — three different answers on three surfaces, and that is the lesson.**

- *Item grid (small card, ~104 px):* stars at the **bottom-left**, straddling the boundary between
  the art and the white nameplate, **tight (p/ink 1.00)**, flat gold, no stroke, no container.
  Rarity is **co-encoded** by the card's background band (purple 4★ / blue 3★ / green 2★), so the
  star row is not carrying the signal alone.
- *Character Archive (smaller card):* **the stars are gone.** Rarity is the card background gradient
  and nothing else. At the smallest grid size the field's answer is to **drop the row**, not shrink it.
- *Character detail / ascension panel (big):* six stars at ~30 px, **loose (p/ink 1.33)**,
  **left-aligned above the name/level line**, no plaque, no glow. Earned stars are solid bright,
  unearned are **solid muted grey — never hollow**.

That third row is the closest thing in the whole sample to what the owner is asking the dossier to
become: *plain, off-centre, bigger, no loud container.* Genshin got there without an outline.

**Arknights — the container is the card, not a pill.** Six gold stars in a thin **dark strip across
the top of the operator card**, tight-ish (1.30), gold fill with a dark contour so they hold over the
portrait. The 6★ tier's distinction is the card's own frame + background flare, not the stars.

**Epic Seven — contour, overlapping, bottom-centre.** Gold fill with a navy contour, stars very
slightly overlapping, sitting on the portrait with no container.

**Blue Archive — the tier is a whole-star colour swap.** `Star_Icon.png` (gold, faceted/bevelled with
a lighter rim) and `Star_2_Icon.png` (identical geometry, **blue**), both fully inked at 146 × 141.
The change between tiers is 100 % of the star's colour at full opacity — the nearest field relative
of our rose-gold rung, and note it swaps *every* star, not the top two.

**Shape, across all four (VERIFIED):** squat, thick-limbed, rounded or blunt points; inner:outer
radius around 0.5. Nobody draws the sharp classical star our `U+2605` is.

---

## 3. Our own artefacts, measured (VERIFIED — fontTools on the shipped woff2s)

| font (shipped subset) | `U+2605` advance | ink bbox (units/em) | ink w × h |
|---|---|---|---|
| `zen-kaku-gothic-new-400-jp.woff2` | **1000 (1.000 em — full-width CJK)** | (24, −73) → (976, 833) | **0.952 × 0.906 em** |
| `zen-kaku-gothic-new-{500,700,900}-jp` | 1000 | identical | identical |
| `shippori-mincho-b1-{600,800}-jp` | 1000 | (38, −63) → (961, 817) | 0.923 × 0.880 em |
| `U+2606 ☆`, every subset | — | **absent** | — |

Three consequences:

1. **At `font-size: 12px` the star's ink is 11.4 × 10.9 px and it hangs 0.9 px below the baseline.**
   Its ink centre sits at 0.380 em above the baseline — the **CJK** centre, not Latin cap-height
   centre — so vertically aligning a star row against Latin text is a function of the font's metrics,
   resolved differently by different engines. This is precisely the failure mode the G6.4 close-×
   was rewritten as `clip-path` geometry to escape ("a text glyph cannot be centred exactly here …
   where the ink sits inside that box is a function of the font's ascent/descent metrics — which the
   two engines resolve differently", `gacha.css`).
2. Side bearings are only 0.048 em, so the glyph's *natural* pitch is already 1.05 × ink. Our
   `letter-spacing: 2px` at 12 px adds 0.167 em on top ⇒ **1.23**. Reaching the field's small-size
   idiom (≈1.00) needs a **negative** letter-spacing, roughly `-0.05em`.
3. **`U+2606` is not shippable as-is.** `faces.css` lists `U+2605` in every JP `unicode-range`;
   `U+2606` appears nowhere. Writing `☆` renders it from whatever symbol font the device supplies —
   different metrics on Fennec vs Chrome, different again on desktop, and a tofu risk if none exists.
   The technique lab in the companion sheet renders `★` and `☆` at the same seven sizes so the
   mismatch is visible rather than argued.

---

## 4. The rendering-technique axis

| | outline possible? | crispness at 9–16 px / DPR 2–3 | gradient fill | cost |
|---|---|---|---|---|
| **Text glyph `★`** | only via `-webkit-text-stroke` (or the absent `☆`) | fill: excellent. Stroke: **blobs at ≤10 px** — the stroke is centred on the outline, so half of it fills the counters | `background-clip: text` (fiddly) | zero — already shipped |
| **Inline SVG** | **yes, exactly** (`fill:none; stroke; stroke-linejoin:round`) | excellent at every size and DPR; stroke width is authorable to 0.1 px with `vector-effect: non-scaling-stroke` | trivial (`<linearGradient>` or `fill: url()`) | ~1 DOM node per star; one `<symbol>` + `<use>` keeps geometry single-sourced |
| **CSS `mask-image`** | only if the SVG path is already a **ring** (even-odd) — you cannot turn a filled mask into an outline from CSS | excellent (rasterised at the element's device size) | **best** — the star becomes a paintable box, so `--gc-star-hi` could be a gradient | 1 element per star; the outline variant needs a *second* asset |

- **REPORTED (MDN)** — `-webkit-text-stroke`: *"This feature is well established and works across
  many devices and browser versions. It's been available across browsers since April 2017,"* spec'd
  in the [Compatibility Standard](https://compat.spec.whatwg.org/#the-webkit-text-stroke)
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-text-stroke)). Support is not the
  problem; **the geometry is** — MDN does not document stroke placement, and the rendered result
  (technique lab, row 3) shows the classic centred-stroke behaviour.
- **REPORTED (MDN)** — `paint-order: stroke fill`, which is what draws a dark contour *behind* an SVG
  star's fill rather than over it, is **"Baseline 2024 — Newly available since March 2024"**
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/paint-order)). That is newer than most of
  our platform floor. **Degradation is graceful** (without it the contour paints over the fill and
  the star reads slightly thinner), but it belongs on the device-round checklist.

**Recommendation: inline SVG, one `<symbol>` + `<use>` per star.** It is the only option that
expresses *both* the filled card star and the outlined dossier star from one geometry, it makes the
star's silhouette a design decision instead of a font's, it sizes and strokes in exact px at any DPR,
and it retires the ASCII-fence problem the glyph creates (the same argument, and the same shape of
fix, as G6.4's close-×). CSS mask is the runner-up and becomes the better choice only if the
rose-gold rung ever wants to be a *gradient*; the text glyph stays viable **only** for a
fill-only outcome (candidate C1), where it is a pure CSS edit and worth the option.

---

## 5. Implications for the G7 design (short, separate — this ages faster than §1–§4)

1. **Fleet: shrink *and* tighten together.** 12 px → 9 px is only half of it; the field's small-size
   idiom is pitch ≈ ink, which `letter-spacing: 2px` forbids. A 9 px star at ≈0 pitch reads as one
   rarity *bar*; five 9 px stars at 14 px pitch still read as five separate marks.
2. **Kill the glow before you shrink anything.** `--gc-star-shadow`'s `0 0 12px var(--gc-star-glow)`
   is the loudest element in the row. No reference at small size uses one — Genshin's glow lives in a
   **27 px** sprite. Arknights and Epic Seven both use a **dark contour** instead, which is what
   actually holds a star over bright art (see the "over ART" strip in the sheet).
3. **Dossier: delete the lozenge, don't shrink it.** Nothing measured puts a filled plaque behind
   rarity stars, and Genshin's own detail panel — the closest analogue to our dossier head — is
   bare, big, loose and left-aligned above the name. That *is* the owner's "plain, small, off-centre,
   pill much quieter". C1/C2/C3/C6 in the sheet delete it outright; **C4 exists for the case where
   the owner wants a container kept**, reduced to a 1 px rim over the sheet's own colour.
4. **Draw the star; make it round.** The outline ask forces the technique choice (§3, §4) and the
   technique choice makes the silhouette free — take the squat, blunt-pointed shape the field uses.
   The sharp `★` outline at 8–12 px is close to invisible (sheet, technique lab rows 6 vs 7).
5. **Know what an outline signals before shipping it.** `U+2606` is literally *WHITE STAR* — hollow —
   and the wider rating idiom reads hollow as *empty/unearned*. The one field precedent for showing
   a partial scale (Genshin's ascension row) uses **dim solid**, never hollow. Two safe readings:
   outline *every* star, so hollowness is the theme's voice and carries no state (C2–C5); or lean
   in and show the **full five slots** with the earned ones gold-outlined and the tail a faint
   outline, so the row means "3 of 5" (C6). What to avoid is a row where *some* stars are outlined
   and some are filled for a reason unrelated to progress.
6. **Do not re-open the rose-gold** (owner-ruled §6.2) — but note §0-③: it is why our row can never
   read as one silhouette the way a Genshin row does, and it is the reason the top-two rung reads
   faintest of all at 9 px (rose on dark art has less contrast than gold). If the fleet star drops to
   8–9 px, the rose rung is the pair to check on device first.

---

## 6. Negative findings and corrections (the most re-usable part)

- **CORRECTION to the premise I started with.** "Our row is loud because it is loose compared to the
  field" is **only half right**: measured, our card row's p/ink 1.23 sits *between* Genshin's 1.00 and
  Arknights' 1.30 — squarely in family. What is genuinely out of family is (a) the **12 px glow**,
  (b) the **dossier being smaller *and* looser than the card** — 1.37 at 10 px against 1.23 at 12 px
  (every reference does the opposite:
  the detail surface is bigger *and* looser), and (c) the **filled black lozenge**, which nothing in
  the sample has. Shrinking the card stars alone would not fix the thing the owner is reacting to.
- **No shipped gacha UI in this sample draws RARITY stars as outline-only.** Every rarity star I
  measured is solid. The outlined direction is therefore a *theme voice* decision without a field
  measurement behind it — which is fine, but it means the stroke weights in the companion sheet
  (1.1–1.3 px) are **my derivation from what stays legible at DPR 2–3**, not a copied number.
- **Honkai: Star Rail, FGO, NIKKE, Uma Musume and Azur Lane contributed nothing measurable.** Their
  official store screenshots in this pass are marketing composites (device frames, overlay copy,
  scenes) with no roster grid at native resolution. Recorded as a **gap in the sample**, not as
  evidence those games do something different.
- **The peer class was not searched** — deliberately. The brief scoped this to gacha UI, and the
  README's LLM-app peer class (opencode / open-webui / LibreChat / …) has no rarity-mark analogue.

---

## 7. What I could not determine

1. **Native *logical*-pixel sizes from a real phone build.** Every full-bleed capture I could source
   is desktop-native (Genshin) or tablet-native marketing (Arknights, Epic Seven), so the absolute-px
   half of §1.1 rests on a ÷2 conversion. A single real phone screenshot of an Arknights or Epic
   Seven roster at a known DPR would settle "how big is a rarity star in the hand", which is the
   number the owner's "fleet: small" is really about.
2. **Outline stroke weight at small size has no field measurement** (see §6) — the sheet is the
   experiment, and the device round is the ruling.
3. **Whether Blue Archive's blue star is a rarity tier or a different scale.** I have the two assets
   and their identical geometry; I did not find the screen that uses the blue one.
4. **Whether `paint-order: stroke fill` is safe on the owner's Fennec build** (Baseline March 2024).
   Degradation is graceful, but it is an eyeball item.
5. **Whether dropping the fleet stars entirely is on the table.** Genshin's Character Archive does
   exactly that (§2) and it is the most radical answer the field offers to "make them smaller" — but
   it presupposes a second rarity channel (their card *background*), which our capsule card does not
   have. Not rendered as a candidate because our cards have no such channel to fall back on; noted
   in case the owner wants one invented.

---

## 8. Method note (so this is cheap to re-buy)

Wiki file stores are addressable without scraping —
`https://<wiki>.fandom.com/api.php?action=query&list=allimages&aiprefix=<Prefix>&format=json` returns
direct asset URLs, which is how the Genshin and Blue Archive sprites above were found. Official
store screenshots at native resolution come from
`https://itunes.apple.com/lookup?id=<trackId>&country=us`, whose `screenshotUrls` end in a
`/<W>x<H>bb.jpg` size segment that can be rewritten to a larger one. Both beat searching for
screenshots, and both give artefacts you can *measure* instead of describe — which, for a question
like this one, is the whole difference between a finding and an opinion.
