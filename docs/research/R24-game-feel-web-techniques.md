# R24 — Game-feel for static web prototypes (immersive menu craft → HTML/CSS/JS mechanisms)

**Date:** 2026-08-07 · **Status:** BANKED (Opus research lane, curated by the main seat)
**Question:** what makes game menus feel immersive (Persona 5 craft, "juice", print artifacts,
diegetic framing), and what is the exact web mechanism for each effect under our constraints —
animate `transform`+`opacity` only, no blend modes on scrolling content, no animated
`filter`/`clip-path`, smooth on mobile Gecko AND Chrome-Android?
**Drives:** the alt-fleet ensemble design discussion (GACHA_PLAN §12 + §12.5) and the
`alt-fleet-showcase-v2` design lab; the motion grammar (§B) is adoptable by any future theme work.
**Siblings:** [R22](./R22-select-screen-grammar.md) · [R23](./R23-gacha-roster-banner-grammar.md) ·
[R18](./R18-ensemble-collage-fleet.md) (hit-area/clip probes).

**Confidence:** Part 0 craft claims trace to the sources block (the Persona 5 section is grounded
in the ATLUS UI panel coverage). Part A/B mechanisms are established web-platform behavior; the
Gecko-specific cautions align with our own §14.11 findings and the R15/R18 probes.

---

## Part 0 — the craft, compressed

### 0.1 Persona 5: what it actually does (ATLUS UI panel, Sutoh/Koda)

Stated concept: **"pop punk"** — mass-appeal readability welded to anti-establishment aggression.

- **Colour was locked first, then logo, then fonts.** Red chosen as *the* colour; sub-colours
  deliberately minimised so red never competes. The palette is 3 values (red/black/white) plus
  grey — **the maximalism is spent entirely on form, not hue.**
- **Lines as gaze rails.** Menus are composed around explicit lines "as reference points to guide
  their vision" — opening the main menu literally draws a white line down the centre and the eye
  follows it. The famous half-B&W/half-red split is a compositional anchor, not decoration.
- **Lighting as information hierarchy** — "high lighting for high priority." Contrast is the
  ranking function.
- **Every screen is a different composition.** Moving to a lower menu position changes layouts and
  angles. Navigation is not a list scrolling — it is a **re-composition**. (The single most
  transferable idea.)
- **Typography behaves like images:** blocky letterforms, thick black outlines, mixed case, some
  letters knocked out white-on-black, all letters differing — yet **aligned along one oblique
  baseline**, which is what keeps chaos scannable.
- **Selection = size.** The selected item is simply *bigger*. Cheap, unmissable, phone-safe.
- **Motion is functional** — animations "draw certain things to your attention in fairly chaotic
  screens." Menu entry is an *explosion into position*, not a fade.
- **Sequential payoff.** The victory screen presents spoils "one by one," each with its own sound.
  Staggering *is* the reward.
- Production note: >1000 pages of spec, but the team "left room for the programmers to implement
  their own ideas" — the spec was the composition; the juice was implementation-side.

**Rule set:** ① one dominant colour, minimal sub-colours ② a drawn line tells the eye where to go
③ selection = scale ④ each screen is a new composition, not a new list ⑤ type is a graphic object
on an oblique axis ⑥ rewards arrive serially.

### 0.2 Juice: over-answering the input

Jonasson & Purho (GDC 2012, *Juice It or Lose It*): juice is interaction that **"gives players far
more output than their simple inputs deserve."** Three layers: ① instant response (answer on the
same frame — `:active`/`pointerdown`, not `click`) ② readable feedback (the response says *what
happened*) ③ polish (squash-and-stretch, shake, particles, floating text, sound — Disney's
**anticipation, follow-through, overshoot**).

**The 100–300ms window.** Practitioner consensus: press feedback 100–160ms · tooltips 125–200ms ·
dropdowns 150–250ms · modals/drawers 200–500ms. Two corollaries that matter more than the numbers:
- **Frequency gates ceremony.** Anything performed 100×/day must not be animated. A gacha *pull*
  may take 900ms; a *tab switch* may not.
- **Overshoot needs runway.** A back-ease at 100ms looks glitchy; overshoot is only legible at
  ≥200ms; anticipate-then-overshoot needs ≥320ms.

### 0.3 Print artifacts: why they read as "designed"

Print residue implies a *press*, a *run*, a physical object — someone made this on purpose. The
risograph vocabulary: **halftone dot screens + diffusion grain**, **misregistration** (layers
shifted up to ~3mm → the "lively, analog" energy), **semi-transparent inks** overlapping into
unplanned third colours, a **hard-limited bright palette**. Plus the *machinery* of print:
registration/crop marks, colour bars, plate serials, barcodes, trim lines. Manga screentone = the
same dot screen at 45°, applied only to shadows. CRT scanlines and chromatic aberration are the
electronic equivalent — evidence of a *medium*.

### 0.4 Diegesis: why the fiction raises immersion

Diegetic UI exists inside the fiction (player AND character can see it). It buys: no fourth-wall
break, lower cognitive load (Metro 2033's wristwatch reports time *and* radiation; its cracked
glass carries tension), and narrative coherence (Firewatch's map is a held object with a *cost* in
the world). Constraints: legible at in-world scale; the character must plausibly have the object.
**For a web prototype the trade inverts favourably: the immersion benefit costs near zero, because
the "3D model" is a `<div>` with a clip-path.**

---

## Part A — catalogue: 19 effect → mechanism pairs

> **E** effect · **W** why games use it · **M** web mechanism · **⚠** mobile caveat.

**A1 · Halftone dot field (decorative).**
**M** One declaration, no blends, no images:
```css
.halftone{ --dot:6px; --r:1.6px;
  background-image: radial-gradient(circle at 50% 50%, currentColor var(--r), transparent calc(var(--r) + .5px));
  background-size: var(--dot) var(--dot); }
```
`currentColor` so the tone inherits the panel's ink; `background-size` in px, never %.
**⚠** Pitch below ~4px moirés against phone DPR during scroll — keep ≥5px; never animate
`background-position` (translate a positioned overlay element instead).

**A2 · Halftone *ramp* (density gradient) without blend modes.**
**M** The 3-declaration trick (radial-gradient + `background-blend-mode: multiply` +
`filter: contrast(16)`) is off the table under our constraints. Blend-free substitute: constant dot
size, **mask the layer's opacity**:
```css
.tone::before{ content:""; position:absolute; inset:0; pointer-events:none;
  background-image: radial-gradient(circle, #000 1.8px, transparent 2.2px);
  background-size: 6px 6px;
  -webkit-mask-image: linear-gradient(150deg, #000 10%, transparent 75%);
          mask-image: linear-gradient(150deg, #000 10%, transparent 75%); }
```
At 6px pitch on a phone the eye can't distinguish "smaller dots" from "fainter dots."
**M-alt** True photo halftone: **bake it** — render once to `<canvas>` at load (or ship a PNG), use
as `background-image`. One rasterisation, zero per-frame cost.
**⚠** Distinction worth knowing: `mix-blend-mode` forces compositor read-back of the page *behind*
the element (what destroys Gecko scroll perf); `background-blend-mode` only composites the
element's own background layers at paint time. A **static** `filter: contrast(N)` rasterises once —
it is *animating* filters that is fatal.

**A3 · Duotone photography (arbitrary two-colour pair).**
**W** Forces heterogeneous art into one palette — the single most effective "designed system" move.
**M** SVG filter referenced from CSS: desaturate, then remap channels through a 2-entry table:
```html
<svg width="0" height="0" aria-hidden="true">
  <filter id="duo" color-interpolation-filters="sRGB">
    <feColorMatrix type="matrix" values=".33 .33 .33 0 0  .33 .33 .33 0 0  .33 .33 .33 0 0  0 0 0 1 0"/>
    <feComponentTransfer>
      <feFuncR type="table" tableValues="0.05 0.98"/>
      <feFuncG type="table" tableValues="0.02 0.15"/>
      <feFuncB type="table" tableValues="0.09 0.18"/>
    </feComponentTransfer>
  </filter>
</svg>
```
`img { filter: url(#duo); }` — `tableValues` = shadow colour then highlight colour, per channel /255.
**M-alt (no SVG):** `filter: grayscale(1) sepia(1) hue-rotate(318deg) saturate(6) contrast(1.15)
brightness(.92)` — inline-able, but the shadow end is always ~black.
**⚠ Three traps.** ① Omit `color-interpolation-filters="sRGB"` → washed-out linearRGB. ② **A
dangling `filter: url(#id)` (def absent/unmounted) UNPAINTS the element on Gecko** — the def must
live in the same document and never conditionally unmount (our own v1.5.0 lesson, re-confirmed).
③ Never transition/animate the filter string.

**A4 · Torn / jagged panel edges.**
**M** Two options with a load-bearing difference: `clip-path: polygon(...)` clips the box **and the
hit area** (and any outward box-shadow); `mask-image: url("data:image/svg+xml,…")` is purely
visual — hit area stays rectangular, works with tiled tear strips. Torn edge on a *decorative
banner* → mask (keeps the tap target whole). Torn edge on a *button whose neighbours interlock* →
clip-path (R18's fall-through fact). For an organic tear: `feTurbulence` + `feDisplacementMap`,
**baked to a mask image**, never a live filter on a scroller.
**⚠** Clipped elements can't cast outward shadows — wrap in a parent carrying
`filter: drop-shadow(...)`; the shadow follows the clipped silhouette.

**A5 · Diagonal / parallelogram buttons — the hit-area rule.**
**M** `clip-path` restricts pointer events to the clipped region (R18-verified both engines). The
rule: **clip a presentational inner element, leave the `<button>` unclipped** so the tap target
stays the full rectangle:
```html
<button class="cmd"><span class="cmd__skin"></span><span class="cmd__label">WAKE</span></button>
```
`.cmd__skin{ position:absolute; inset:0; clip-path: polygon(...); }`
Invert (clip the button itself) **only** when angled buttons overlap and must not steal each
other's taps — the §12 interlocking-bands case.
**⚠** A 12° shear removes ~20% of nominal tap area at the corners — exactly where thumbs land.
Never let a clipped button fall below 44×44 CSS px of *actual clipped* area.

**A6 · Container-driven diagonal geometry (`tan()` + `cqw`).**
**M** (R18's finding, generalized)
```css
.panel{ container-type: inline-size; }
.band{
  --a: 9deg;
  --run: calc(tan(var(--a)) * 100cqw);
  clip-path: polygon(0 0, 100% var(--run), 100% 100%, 0 calc(100% - var(--run)));
  padding-block: calc(var(--run) / 2);   /* keeps content inside the slope */
}
```
**⚠** `container-type: inline-size` applies containment: new containing block AND stacking
context — `position: fixed` descendants get trapped. Keep overlays/sheets outside any
container-query root.

**A7 · Rotated type inside clipped panels.**
**M** Rotate an **inner** `<span>`, never the clipped parent (polygon coordinates must stay
predictable). `transform: rotate(-4deg)`; don't use `writing-mode` for mere tilt.
**⚠** Transformed text loses subpixel AA and renders thinner/fuzzier small. Rotate only ≥18px,
heavy faces only, bump the weight one step.

**A8 · Type slam (the entrance).**
```css
@keyframes slam{
  0%  { opacity:0; transform: scale(2.4) rotate(-8deg); }
  55% { opacity:1; transform: scale(.94) rotate(-4deg); }
  100%{ opacity:1; transform: scale(1)   rotate(-4deg); }
}
.slam{ animation: slam 240ms cubic-bezier(.16,1,.3,1) both; }
```
Pair with A9 (flash) + A10 (shake) on the same frame — that trio IS the over-answer.
**⚠** Start from `scale(2.4)`, never `scale(0)` (scaling from zero reads as a glitch and
rasterises at absurd sizes mid-flight). `will-change: transform, opacity` added on
`animationstart`, removed on `animationend`.

**A9 · One-frame white flash.**
**M** A pre-existing absolutely-positioned white element at `opacity:0`, animated on opacity only:
```css
.flash{ position:absolute; inset:0; background:#fff; opacity:0; pointer-events:none; }
@keyframes flash{ 0%{opacity:0} 20%{opacity:.55} 100%{opacity:0} }
```
**⚠** Never animate `background-color` to fake it (paint per frame). Reuse one flash node per
surface.

**A10 · Screen shake.**
**M** `translate3d` on a dedicated `#shakeRoot` wrapper, 4–5 keyframes, 90–140ms, amplitude ≤6px
on mobile.
**⚠** ① Never shake `<body>` (whole-page invalidation). ② A transform on the wrapper creates a
containing block — `position: fixed` children (sheets, toasts, nav) will ride the shake. Keep
fixed overlays outside the shake root. Suppress under `prefers-reduced-motion`.

**A11 · Afterimage / ghost trail.**
**M** No blur, no filter — duplicate the element as an inert echo layer:
```css
.echo{ position:absolute; inset:0; pointer-events:none;
       animation: ghost 200ms cubic-bezier(.23,1,.32,1) both; }
@keyframes ghost{ from{ transform:none; opacity:.5 } to{ transform:scale(1.18); opacity:0 } }
```
Multi-frame trail: 2–3 echoes, same keyframes, `animation-delay: 0/-40ms/-80ms`, stepped opacity.
**⚠** Each echo is another composited layer, and **layer/group count is directly Gecko compositor
cost** (our own memory). Cap at 3, transition-only, remove nodes on `animationend`.

**A12 · Fake parallax without scroll-linking.**
**M** **Parallax on state change, not on scroll:** on select, background band `translate3d(0,4px,0)`,
mid frame 8px, card 24px — same 260ms, same easing. Identical depth read, zero scroll-handler cost.
**M-alt** If scroll parallax is mandatory: the `perspective`+`translateZ` container trick
(compositor-only, no JS) — but it forces a 3D context and gets expensive on Gecko with many layers.
**⚠** Never drive parallax from a scroll handler + `style.transform` — a main-thread write per
frame; the most reliable way to make a mobile page feel broken.

**A13 · Staggered reveal.**
```css
li{ animation: rise 220ms var(--e-out) both;
    animation-delay: min(calc(var(--i) * var(--stagger, 40ms)), 240ms); }
```
(`sibling-index()` is the emerging upgrade; treat as enhancement.)
**⚠** Uncapped staggers are the classic sin (20×60ms = 1.2s). Cap total added delay at 240ms;
`--stagger: 0ms` under reduced motion.

**A14 · Sticker outline (die-cut look).**
**M** Three tiers, cheapest first: ① geometry — duplicate the shape in a parent pseudo-element
scaled up ~4px with the same clip-path, filled white (zero filter cost); ② text —
`-webkit-text-stroke: 6px #fff` + `paint-order: stroke fill` (fallback: duplicate string via
`::before{ content: attr(data-text) }`, stroke, `z-index:-1`); ③ arbitrary silhouettes — chained
`filter: drop-shadow(0 0 0 #fff)` at 4–8 small offsets (`drop-shadow` respects alpha; `box-shadow`
doesn't).
**⚠** Tier 3 = one full filter pass per shadow; cap at 4 offsets; never combine with scale
animation on the same element (animate a *parent* so the filtered layer is transformed, not
re-filtered).

**A15 · Registration marks, colour bars, trim lines.**
**M** Pure CSS corners (two crossed hairlines via linear-gradient, or a 12px inline SVG crosshair);
colour bar = one `repeating-linear-gradient` with hard stops; trim = `border: 1px dashed`.
**⚠** Effectively free. Keep ≤35% opacity + `pointer-events: none` or they compete with real
controls at phone size.

**A16 · Barcode + serial decoration.**
```css
.barcode{ background-image: repeating-linear-gradient(90deg,
  #000 0 2px, transparent 2px 5px, #000 5px 6px, transparent 6px 11px,
  #000 11px 14px, transparent 14px 16px); }
```
Vary per host by seeding 2–3 gradient layers at coprime periods from a data attribute. Serial in
Silkscreen/Monomaniac One, `letter-spacing: .18em`, `opacity: .6`.
**⚠** Sub-pixel bars shimmer on high-DPR during scroll — whole-pixel stops ≥2px, fixed strip
height.

**A17 · CRT scanlines + chromatic aberration.**
```css
.crt::after{ content:""; position:absolute; inset:0; pointer-events:none;
  background: repeating-linear-gradient(to bottom,
    transparent 0 2px, rgba(0,0,0,.14) 2px 3px); }
```
Aberration: `text-shadow: 1px 0 #0ff, -1px 0 #f0f;` — static.
**⚠** The classic failure: animating `background-position-y` for drift (repaint per frame) —
translate the overlay element instead. A 1px stripe period on a 2.75× DPR phone crawls/moirés
during scroll — use ≥3px period. Glitch *pulses*: duplicate the text into two transform-offset
layers; never animate `text-shadow`.

**A18 · Baked noise / paper grain.**
**M** **Bake the turbulence into an image, never a live CSS filter.** Put `feTurbulence` *inside* a
data-URI SVG rendering a rect — rasterised once as a tile:
```css
.grain{ position:absolute; inset:0; pointer-events:none; opacity:.05;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E"); }
```
`stitchTiles="stitch"` = seamless; a 160px tile beats full-screen (caps processed pixels).
**⚠** `filter: url(#noise)` on a live element = a filter surface re-evaluated on change —
catastrophic on a scrolling list. `backdrop-filter` dies in capture contexts (our own VT lesson) —
avoid entirely here.

**A19 · Chromatic display type (Bungee layering).**
**M** Bungee (DJR, OFL) ships as **four metrically-registered layers — Regular, Inline, Outline,
Shade — designed for stacking**, plus true vertical-setting glyphs:
```css
.sign{ position:relative; font-family:"Bungee"; }
.sign::before,.sign::after{ content:attr(data-t); position:absolute; inset:0; }
.sign::before{ font-family:"Bungee Shade";   color:#2b0a0a; z-index:-1; }
.sign::after { font-family:"Bungee Outline"; color:#fff; }
```
**⚠** Three font files for one word — load only the layers used, `font-display: swap`, subset to
the literal strings for fixed labels.

---

## Part B — motion grammar (adoptable wholesale)

### B.1 Tokens

```css
:root{
  /* durations */
  --t-instant : 90ms;    /* press-down, flash on                */
  --t-tap     : 140ms;   /* release, toggle, chevron nudge      */
  --t-ui      : 220ms;   /* card select, panel swap, slam       */
  --t-panel   : 320ms;   /* sheet, drawer, screen change        */
  --t-ceremony: 900ms;   /* a pull/reveal, budgeted across beats*/

  /* easings — never ease-in on UI */
  --e-out       : cubic-bezier(.23, 1, .32, 1);      /* default in/out    */
  --e-inout     : cubic-bezier(.77, 0, .175, 1);     /* on-screen travel  */
  --e-sheet     : cubic-bezier(.32, .72, 0, 1);      /* drawers           */
  --e-overshoot : cubic-bezier(.34, 1.56, .64, 1);   /* ~+12%, needs ≥200ms */
  --e-slam      : cubic-bezier(.16, 1, .3, 1);       /* hard landing      */
  --e-anticipate: cubic-bezier(.68, -.4, .32, 1.4);  /* pull back then over; ≥320ms */

  --stagger: 40ms;  --stagger-max: 240ms;
  --press-scale: .97;  --shake-amp: 4px;
}
```
Selection logic: entrances/exits → `--e-out` · on-screen movement → `--e-inout` · sheets →
`--e-sheet` · hover/colour → plain `ease` · continuous → `linear`. `ease-out` at 200ms *feels
faster* than `ease-in` at 200ms; ease-in on UI is always wrong. **Transitions** for anything a user
can interrupt (they retarget mid-flight); **keyframes** only for fire-and-forget ceremony.

### B.2 The input ladder — one input, N responses

| State | Trigger | Responses (all transform/opacity) | Duration / easing |
|---|---|---|---|
| Rest | — | idle only; no ambient motion on lists | — |
| Hover | `@media (hover:hover) and (pointer:fine)` **only** | ① scale(1.02) ② accent rule scaleX(0→1) ③ chevron translateX(4px) | `--t-tap` / `--e-out` |
| Focus-visible | keyboard | outline + accent rule — **no scale** (no bounce for keyboard) | `--t-tap` / ease |
| Press | `:active`/pointerdown | ① scale(.97) ② translateY(1px) ③ badge dims .7 | `--t-instant` / `--e-out` |
| Select (release) | pointerup | **4-part over-answer:** flash 0→.55→0 · card .97→1.04→1 · ghost echo fades at old position · siblings part 6–10px, `--stagger` apart | `--t-ui` / `--e-overshoot` |
| Confirm | explicit commit | the full ceremony (B.3) | `--t-ceremony` |
| Deny/error | invalid | 3-cycle shake ±5px + red flash; button stays enabled | 260ms / `--e-inout` |

Gate hover behind `(hover:hover) and (pointer:fine)` — touch fires false hovers and leaves buttons
stuck hovered after a tap.

### B.3 The ceremony (5 beats, 900ms)

| Beat | ms | What moves | Easing |
|---|---|---|---|
| 1 · Anticipation | 0–180 | everything compresses toward centre scale(.96); ambient dims | `--e-anticipate` |
| 2 · Impact | 180–300 | flash + 4px shake + subject slams scale(2.4)→.94 | `--e-slam` |
| 3 · Settle | 300–500 | .94→1; echo fades | `--e-overshoot` |
| 4 · Reveal | 500–760 | detail rows rise, 40ms stagger, capped | `--e-out` |
| 5 · Rest | 760–900 | nothing moves; silence is part of the beat | — |

**Mandatory: tap anywhere skips to the final frame** (a `.skip` class zeroing durations/delays). A
ceremony you cannot escape becomes a tax on the second viewing.

### B.4 Reduced motion — reduce, don't delete

```css
@media (prefers-reduced-motion: reduce){
  :root{
    --t-ui: 120ms; --t-panel: 150ms; --t-ceremony: 200ms;
    --e-overshoot: var(--e-out); --e-anticipate: var(--e-out);
    --stagger: 0ms; --press-scale: 1; --shake-amp: 0px;
  }
  .slam, .echo, .shake{ animation-name: fade-in; animation-duration: 120ms; }
  .parallax-layer{ transform: none !important; }
}
```
Keep opacity/colour changes throughout — removing *all* feedback is a worse regression than the
motion was. *(NOTE for production ctrl-b use: user motion prefs are modeled via UIState/Appearance,
not raw OS media queries — this block is the PROTOTYPE form; the app form routes the same tokens
through the existing appearance switch, per the CLAUDE.md no-parallel-patterns rule.)*

### B.5 Performance contract (non-negotiable)

1. `transform` + `opacity` are the only guaranteed GPU-composited properties across engines.
2. Static `filter`/`clip-path` = fine (rasterised once). **Animated = fatal** (clip-path animation
   without compositor support = full geometry recalc per frame on one CPU thread).
3. **≤3 concurrently-animating composited layers per beat** — group/layer count is directly Gecko
   compositor cost.
4. `will-change` added on `animationstart`, removed on `animationend` — never static on list items.
5. Never `scale(0)` — start at `scale(.9–.97)` + `opacity:0`. Popovers scale from their trigger.
6. No scroll-handler-driven transforms. State-change parallax only.
7. Transformed elements become containing blocks — fixed children of a shaking/parallaxing wrapper
   break.
8. Don't animate anything the user does 100×/day.

---

## Part C — diegetic framings for "4 PCs as gacha characters", ranked

Axes: fiction strength · verb fit (wake/sleep/shutdown natural?) · state legibility · motion payoff
· scale (survives a 5th host?).

**① Capsule-toy machine / gashapon dome — best fit.** Four capsules in a glass dome; the crank is
the fleet's primary control. Fiction ★★★★★ (the gacha IS the fiction — no translation layer; and
the shipped theme is literally named "Capsule Arcade"). Verbs ★★★★★ — crank = wake; capsule
cracking open = boot; sealed and dim = asleep; a diegetic *action*, not a button labelled Wake.
State ★★★★☆ (lit/dim capsule, per-PC shell colour). Motion ★★★★★ — crank → clunk → capsule drop →
chute rattle → crack-open maps beat-for-beat onto §B.3 including genuine anticipation (the crank
resists, *then* gives). Scale ★★★★☆ (a dome holds 4–12). Craft with: A1 on the dome glass, A15 on
the spec plate, A16 serials per capsule, A19 vertical on the side rail, A9+A10 on the crank pull.

**② Trading-card binder / 9-pocket page.** Foil cards in polypropylene sleeves. Fiction ★★★★★
(the canonical gacha artifact). Verbs ★★☆☆☆ — you don't "wake" a card (its weakness). State
★★★★★ — holo shimmer = online, greyed sleeve = offline, rarity stars = tier; **best state
legibility of any framing**. Motion ★★★★☆ — flip, tilt-shimmer, pull-from-sleeve; all
transform-only, so **cheapest to build to a high standard**. Scale ★★★★★ (paginated). Craft with:
A3 duotone portraits, A14 die-cut border, A16 serial + edition, A18 grain on the stock, rarity via
A2 ramp.

**③ Arcade cabinet / character-select screen.** Fiction ★★★☆☆ (a UI of a UI — but a *place*).
Verbs ★★★★☆ (SELECT/READY/START; start ≈ wake). State ★★★★☆ (desaturated portrait + OFFLINE
stencil). Motion ★★★★★ — **the strongest motion fit of the five**: select screens are the
historical origin of the juice vocabulary; every Part-A effect has a canonical placement. Scale
★★★★☆. Craft with: A8 slam, A11 afterimage on cursor, A5 diagonal tiles, A17 scanlines (the one
framing where CRT is *literal*), A19 chromatic marquee.

**④ Hangar / launch-bay sortie board.** Fiction ★★★★☆. Verbs ★★★★★ — **the best verb mapping of
all five**: LAUNCH/RECALL/STANDBY/SCRAMBLE ↔ wake/shutdown/sleep/wake-all with zero strain. State
★★★★★ — fuel bars/dock lamps make CPU/temp/uptime readouts *native to the fiction*; best for a
data-dense fleet screen. Motion ★★★★☆ (clamps release, gantry retracts, catapult fires). Scale
★★★★★. Cost: drifts toward military sci-fi, away from "gacha characters."

**⑤ Personnel file / dossier folder.** Fiction ★★★★☆. Verbs ★★☆☆☆ (paper has no verbs; a rubber
stamp is charming once). State ★★☆☆☆ — **weakest: paper does not update**; live status on a static
document looks like a bug. Motion ★★☆☆☆ (a folder opens — the whole vocabulary). Scale ★★★★★.
**Where it wins:** the single best host for the print-artifact kit (A1/A2/A3/A15/A16/A18 +
typewriter serials). **Harvest it as the detail-view treatment inside ① or ②** — the capsule opens
→ the dossier is what's inside.

**Recommendation:** ① as the fleet shell (owns the crank/wake verb and the reveal ceremony), ② as
the per-host card treatment inside it (owns state legibility, scales), ③'s motion vocabulary
borrowed wholesale for selection/transition, ⑤'s print treatment for the expanded detail panel.
④ only if the screen's real job turns out to be telemetry.

---

## Typography shortlist (all OFL, self-hostable)

| Concept | Face | Why |
|---|---|---|
| Arcade signage, vertical rails, 3-colour words | **Bungee** (+Shade/Outline/Inline) | Built for layer-stacking + true vertical setting. *(Already shipped in gacha.)* |
| Heavy poster / P5-adjacent blocky gothic, covers kana | **Dela Gothic One** | Flat very-thick gothic, closest free face to P5's letterforms, handles JP |
| Latin poster weight | **Archivo Black** / **Anton** | Safest large-headline workhorses |
| Techno-mono, mecha readouts, serials | **Rubik Mono One**, **Monomaniac One** | Machine-stencil reads |
| Retro console "this is a game" | **DotGothic16** | Recreates 16×16 bitmap gothics (JP consoles/keitai); covers kana |
| Micro-labels 8–12px only | **Silkscreen** | Latin-only bitmap; never body text |
| Gacha-cute / manga JP flavour | **Kaisei Decol**, **RocknRoll One**, **Rampart One** | Badges + rarity words |
| Body & UI | **Inter**, **Zen Kaku Gothic New** | The maximalism must live only in headers/badges/stamps — if the body also shouts, nothing is |

Loading discipline: full JP faces run multi-MB — use unicode-range slices or `pyftsubset` builds of
the literal strings; `font-display: swap`; load only the Bungee layers actually used.

---

## Sources

**Persona 5 / game UI:** Persona Central — ATLUS panel on P5 UI concept & development · Jordan
Samson (Medium) · Andre Rodrigues (Medium) · Jiaxin Wen · Xiaohai Liu (Medium, P5R visual design).
**Juice / motion:** GDC Vault — *Juice It or Lose It* (Jonasson & Purho) · gamejuice.co.uk ·
eastondev.com game-feedback post · emilkowalski/skills animation STANDARDS.md · animations.dev
easing blueprint · Appypie mobile animation guide.
**Diegesis:** Game Developer — "Diegesis and designing for immersion" · Wayline — "Beyond the HUD"
· Nasty Rodent · Vasilisa Shcherbakova — diegetic game menus.
**Print:** Design Lexicon — Risograph Aesthetic · STUDIO·ITY riso simulator · Reed College riso
LibGuide.
**Web mechanisms:** Frontend Masters — pure CSS halftone · Lean Rada — CSS halftone · CSS-IRL —
halftone patterns · utilitybend — SVG duotone/noise · MDN filter · Ahmad Shadeed — clip-path ·
Sara Soueidan — CSS/SVG clipping · Codrops clip-path reference + feTurbulence texture ·
CSS-Tricks — jagged edges, staggered animation, drop-shadow · Daniel Jones — rough edges ·
freeCodeCamp — grainy backgrounds · web.dev — CSS trig functions · 9elements — diagonal layouts ·
Cloud Four — staggered custom-property animation · Alec Lownes — CSS CRT · Deloughry — CSS glitch ·
1Byte — text outline · Motion.dev — performance guide + tier list · Chrome Developers —
hardware-accelerated animations.
**Type:** djr.com — Bungee (+ release notes, Typographica review) · Google Fonts — Dela Gothic
One, DotGothic16, Rubik Mono One, Archivo Black.
