# R18 — Diagonal-slice / collage "ensemble roster" compositions on the web

**Date:** 2026-08-07 · **Status:** DRAFT dossier (no index row — the main seat curates that)
**Question:** how are diagonal-slice / collage ensemble-roster compositions actually implemented on the
web, and which techniques survive our constraints (Fennec **and** Chrome Android, 320–430px, one real
`<button>` per host, N generated from a count, arbitrary opaque owner art)?
**Drives:** the planned ALTERNATIVE gacha Fleet layout (references: `design/prototypes/gacha/Alt fleets/`).

**Confidence markers:** **VERIFIED** = I read the source / ran the probe · **REPORTED** = secondary
source · **UNVERIFIED** = expected, not checked.

**Probe method (the VERIFIED rows below).** Playwright-bundled **Chromium 149.0.7827.55** and
**Firefox 151.0** (desktop Linux builds — the same engines Chrome Android and Fennec ship, *not* the
Android builds; see §7), 390–400px viewports, static local HTML, `document.elementFromPoint()` for
hit-tests plus full-page screenshots for paint. Every VERIFIED result below was **identical in both
engines** unless stated. No app, no dev server, no gates were run.

---

## TL;DR

1. `clip-path` **clips hit-testing**; `mask` **does not** — VERIFIED in both engines, all mask forms.
   That single fact decides the construction: sheared panels must be `clip-path`, not `mask`.
2. Clipped-out area **falls through to whatever is beneath** — so adjacent sheared `<button>`s can
   overlap boxes and tile perfectly with **zero dead zones and zero dead taps** (VERIFIED).
3. `clip-path` also clips **descendants, `outline`, and `filter: drop-shadow`** on the same element.
   Breakout art and the arcade lift/drop must be planned around that (§1.4, §3).
4. Constant shear angle at any width: `calc(100cqw * tan(θ))` — VERIFIED identical in both engines
   (390px × tan 6° → 40.98px), works *inside* `polygon()`. `aspect-ratio` + `%` gives the same number.
5. Gecko sends polygon clip-paths to WebRender natively **and hit-tests them there since Firefox 89**
   (Bug 1675375, RESOLVED FIXED) — no rasterized mask per panel.
6. Duotone: `background-blend-mode` blends an element's own layers (no backdrop readback);
   `mix-blend-mode` reads the **backdrop** and is the mode our own §14.11 already flags as Gecko-hostile
   on moving elements. A **static `filter` chain** needs neither and is already in-family in gacha.css.
7. Breakout art **needs alpha-cutout art or a gradient-mask fade** — arbitrary opaque owner art cannot
   "break out" of a panel without showing its rectangle edge (§3).
8. Collage prior art (Codrops) is **hand-authored per item** — it does not generate from a count. The
   band-roster prior art (cbolson) **does**, via one `%` offset variable + `aspect-ratio`.

---

## 1. Diagonal / sheared panel construction

### 1.1 Hit-testing — the decisive fact (VERIFIED, corrects a live CSSWG issue)

Spec, [CSS Masking L1 §5 Clipping Paths](https://drafts.csswg.org/css-masking-1/) (verbatim):

> "Clipping *does* affect hit testing; there are no hits outside the clip region, only inside."
> "By default, `pointer-events` must not be dispatched on the clipped-out (non-visible) regions of a shape."

and, for masking (verbatim, §1.2):

> "Masking *does not* affect hit testing."

[csswg-drafts issue #11339](https://github.com/w3c/csswg-drafts/issues/11339) (opened 2024-12-09) claims
the *implementations* disagree with the mask half: "Chrome and Firefox do consult the mask for
hit-testing; WebKit does not."

**That claim did not reproduce (VERIFIED, 2026-08-07).** Probing a `<button>` over a plain `<div>` at a
point inside the button's box but outside its painted region:

| construction | Chromium 149 | Firefox 151 |
|---|---|---|
| `mask-image: linear-gradient(…, transparent 50%)` | button still hit | button still hit |
| `mask-image: url("data:image/svg+xml,…")` | button still hit | button still hit |
| `mask: url(#svgMaskElement)` | button still hit | button still hit |
| `clip-path: inset()` / `polygon()` | **falls through to the div** | **falls through to the div** |
| `clip-path: url(#svgClipPath)` | **falls through to the div** | **falls through to the div** |

All five applied correctly *visually* (screenshot-checked), so this is a hit-test difference, not a
styling failure. Conclusion for us: **`mask` = full rectangle stays tappable; `clip-path` = only the
shape is tappable, and the rest falls through to the element behind.**

Consequence: the current gacha card's mask-based notch (`--gc-card-mask`, `gacha.css`) leaves the whole
rect tappable — correct for a grid of non-overlapping cards. A *sheared* composition has overlapping
boxes by construction, so it must use `clip-path`, or the top band's rectangle will swallow taps aimed
at the band below it.

### 1.2 Which technique the field actually uses

- **`clip-path: polygon()` — dominant.** Every readable implementation I found (§5) uses it. CSS-Tricks'
  ["Create Diagonal Layouts Like it's 2020"](https://css-tricks.com/create-diagonal-layouts-like-its-2020/)
  recommends it over transforms whenever text must stay horizontal, and notes it is "the only way to
  achieve angles between two images or more complex backgrounds".
- **`skewY(-θ)` + counter-`skewY(θ)` child — the older technique**, still correct for *solid-colour*
  bands. Costs: the parent's box is unskewed for layout, so gutter/padding must be corrected by
  `tan(θ)` math; child images must be counter-skewed *and* over-sized or they show corners; and the
  skewed box's **hit area is the skewed box** (transforms do map hit-testing), which works but forces
  every child to counter-skew. CSS-Tricks: skew "is actually the only method" if you want the *text*
  skewed too — which the ZZZ reference does NOT want (its Latin names are rotated, not sheared).
- **`mask` — ruled out** for the panel by §1.1.

### 1.3 Overlapping vs tiling (VERIFIED)

Two sheared `<button>`s whose *boxes* overlap by 40px but whose polygons tile exactly: every sample
point resolved to the geometrically correct button in both engines, including points inside the upper
button's box but below its polygon edge. Interlocking bands are therefore free — no `pointer-events`
gymnastics needed on the buttons themselves.

*(Sub-pixel note, UNVERIFIED: adjacent polygon edges that share a mathematical line can show an
antialiasing hairline. The references all have visible gutters anyway; if a seamless tile is ever
wanted, overlap the polygons by 1px rather than trusting the shared edge.)*

### 1.4 Three things `clip-path` also clips (VERIFIED)

1. **Descendants.** A child positioned outside the parent's clip is invisible *and* unhittable
   (`elementFromPoint` returned the element behind, not the child). Breakout art cannot live inside the
   clipped panel — §3.
2. **`filter: drop-shadow()` on the same element** — the shadow vanishes entirely (same class of
   finding as the in-repo mask/box-shadow probe recorded in `gacha.css`). Put the shadow on an
   **ancestor wrapper**: then it renders *and takes the polygon's shape* (VERIFIED — a magenta
   parallelogram offset behind a parallelogram panel).
3. **The focus ring.** A keyboard-focused clipped `<button>` showed **no visible focus ring in Firefox**
   and at best a clipped sliver in Chromium. A clipped host panel needs an **explicit inner focus
   indicator** (inset ring / accent bar inside the polygon), or it fails our a11y floor.

Also: `clip-path` other than `none` **creates a stacking context** ("the same way that CSS `opacity`
does for values other than `1`" — [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/clip-path)),
and its percentages resolve against the **border-box** by default.

**The union-polygon trick (VERIFIED, and it solves our arcade drop).** Our cards owe a visible offset
accent drop that must also be tappable (Codex wave-12 #5). With the panel clipped, put the drop
*inside* the clip: clip the `<button>` to the **union** of the parallelogram and its lifted copy (a
hexagon), then let two inner spans carry the drop and the face, each clipped to the plain
parallelogram. Probed at 390px with θ=7°, lift=6px: the drop paints along the right+bottom, the drop
strip is inside the button's hit area, and all three stacked bands hit-test correctly — identical in
both engines.

---

## 2. Duotone / flat-colour panel treatment

**Support (VERIFIED via MDN):** `mix-blend-mode` and `background-blend-mode` are both **Baseline widely
available since January 2020**. Both are usable; the question is cost, not support.

**The mechanical difference that decides it** ([web.dev Blend Modes](https://web.dev/learn/css/blend-modes),
[MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/mix-blend-mode), verbatim):

- `mix-blend-mode` "sets how an element's content should blend with its **backdrop** — the content
  rendered behind the element within the same stacking context" → the compositor must **read back the
  backdrop**. It creates a stacking context; `isolation: isolate` on the parent "will create a new
  stacking context, which will prevent it from blending with a backdrop layer" — i.e. it *bounds* the
  readback but does not remove it.
- `background-blend-mode` "applies blending to the **background** of an element" — its own background
  layers only. **No backdrop, nothing behind it to read.**
- `luminosity`/`color`/`hue`/`saturation` are the **non-separable** modes; `luminosity` "creates a color
  with the luminosity of the source color and the hue and saturation of the backdrop color" — that is
  exactly the ZZZ flat-panel look (art's tone, panel's hue).

**Gecko cost (REPORTED + in-repo VERIFIED):**
- Firefox 88 landed the WebRender change that lets `mix-blend-mode`/`backdrop-filter` "issue readbacks
  directly from picture cache tiles rather than forcing draws to an intermediate surface"; measured
  "GPU times on an AMD 5700 GPU at 4k … drops from ~1.8ms to ~0.3 ms"
  ([Bug 1684781](https://bugzilla.mozilla.org/show_bug.cgi?id=1684781), RESOLVED FIXED). So modern
  Gecko blends on the GPU — the old "always blended on the CPU" folklore is stale
  ([Bug 1008128 meta](https://bugzilla.mozilla.org/show_bug.cgi?id=1008128)).
- **But** that readback is per *picture-cache tile*, and our own `THEME_ENGINE.md` §14.11 already
  records the Gate-B finding that `mix-blend-mode` **"on per-frame-moving elements defeats its tile
  cache"** — cosmos scoped its grain overlay to `normal` on `body[data-engine="gecko"]` for exactly
  this. **A fleet list scrolls**, so every blended panel is a moving element on Gecko.

**Three ways to get the look, cheapest first:**

| # | Technique | Backdrop readback? | Fits our art pipeline? |
|---|---|---|---|
| A | Static `filter: grayscale(1) contrast(1.15) sepia(…) hue-rotate(…)` on the `<img>`, flat panel colour showing only in gutters/edges/scrim | no | **yes** — `<img>` + `object-position` untouched; `gacha.css` already ships `filter: grayscale(.75) brightness(.72)` on sleeping cards, so this is the in-family move |
| B | `background-blend-mode: luminosity` with the art as `background-image` + `background-color: var(--panel)` | no | **art must move from `<img>` to `background-image`** — `object-position: 50% 16%` ≡ `background-position` + `background-size: cover`, but it **breaks the M3 morph seam** (`GachaCard` hands `e.currentTarget.querySelector("img")` to `onOpen`) and loses `<img>` load/error handling |
| C | Grayscale `<img>` + `mix-blend-mode: luminosity` over a coloured panel, `isolation: isolate` on the panel | **yes** | keeps `<img>`, but is the Gecko-hostile option on a scroller; would need a `body[data-engine="gecko"]` degrade |

A is a true monotone tint (one hue), not a two-colour duotone; B/C give the real duotone. **Note the
references do not actually need a blend at all**: in the ZZZ poster the flat colour is the *panel behind
cut-out art*, and the art is grayscale. With opaque rectangular art, the same reading is achieved by
grayscale art + coloured gutters/edge/scrim (option A).

---

## 3. Breakout art (character overflowing the panel)

**The hard constraint (VERIFIED §1.4-①):** a `clip-path`ed panel clips its descendants completely. Any
breakout must be a **sibling drawn outside the clipped element** — a second copy of the art,
absolutely positioned, above the composition.

**The second constraint (reasoning, not a browser fact):** breakout only reads as "art escaping the
panel" if the escaping pixels have **alpha** — a cut-out character. Owner art here is arbitrary
rectangular images, so a raw second copy shows a rectangle hanging outside the panel. Two escapes:
1. **Gradient-masked bleed** — the outside copy wears `mask-image: radial-gradient(closest-side, #000
   55%, transparent)` (or a linear fade toward the panel edge) so it dissolves instead of ending. Probed
   working; and because masks don't clip hit-testing (§1.1) the copy must additionally be
   `pointer-events: none`.
2. **Restrict breakout to authored decoration** — the rotated name type, a glow, a badge — and leave
   the photographic art inside its panel. This is what the *True Damage* reference actually does: the
   art is strictly inside the slices; only the type breaks the composition.

**Tap targets + z-order (VERIFIED):** with `pointer-events: none` on the breakout copy *and* on the
rotated title overlay, sample points beneath both resolved to the correct underlying band button in
both engines. The cost is honest and worth stating in the design: **a tap on the breakout art opens
whatever panel is underneath it, not the panel it belongs to.** (The cbolson pen in §5 uses the mirror
of this trick — `pointer-events: none` on the wrapper, `auto` on the items.)

---

## 4. Diagonal-band responsive math (constant angle across widths)

The failure mode: a fixed-px vertex offset means angle = `atan(offset / width)`, so the shear flattens
as the screen widens. Three fixes, in ascending order of modernity:

1. **Percentage-of-height offsets + `aspect-ratio`** — because `polygon()`'s y-coordinates are % of the
   box *height*, locking the box's aspect ratio locks the angle. This is what the slanted-grid pen does
   (`aspect-ratio: 1` + `--_offset: 10%`). VERIFIED: `aspect-ratio: 1/0.10510` produced the same
   40.98px at 390px as the `tan()` form below.
2. **Trig on a known dimension** — NewCity's
   ["Consistent Diagonal Clipping with CSS"](https://www.insidenewcity.com/consistent-diagonal-clipping-with-css/):
   `--tangent: 0.268; --corner-offset: calc(var(--tangent) * var(--height))`, fed into
   `clip-path: polygon(var(--corner-offset) 0%, 100% 0%, calc(100% - var(--corner-offset)) 100%, 0% 100%)`.
   Needs the height passed in per element.
3. **`tan()` + container-query units — the 2026 answer.** VERIFIED in both engines:

   ```css
   .band { --shear: calc(100cqw * tan(7deg)); /* parent has container-type: inline-size */
           clip-path: polygon(0 var(--shear), 100% 0,
                              100% calc(100% - var(--shear)), 0 100%); }
   ```
   At a 390px container, `calc(100cqw * tan(6deg))` computed to **40.9844px (Chromium) / 40.9833px
   (Firefox)**, and the same expression *inside* `clip-path` serialized identically in both
   (`polygon(0px 40.9907px, 100% 0px, calc(100% - 40.9907px), 0px 100%)`). `CSS.supports()` reported
   true for `tan()`, `cqw` and `round()` in both. `tan()` is **Baseline widely available since March
   2023** (MDN). **`calc(100% * tan(θ))` does NOT work** — it fell back to the initial height in both
   engines; the multiplicand must be a real unit, hence `cqw`.
   Robustness note (MDN): with no eligible container ancestor, `cq*` units fall back to the **small
   viewport unit** — so the container declaration is load-bearing, not decoration.

Band *heights* for N hosts: with a locked `aspect-ratio` per band the composition height is a pure
function of N and the column width — which is exactly the "generate from a count" property we need, and
it is the same shape of rule as the existing `cardShapes(hostCount)` in `frontend/src/themes/gacha/fleet.ts`.

---

## 5. Prior art worth stealing

**① "Slanted grid gallery", cbolson (CodePen `GRbzyGJ`) — VERIFIED, read the full CSS.**
The closest thing to a *generated* roster. A 3-column grid; one variable `--_offset: 10%` with
pre-multiplied aliases (`--_offset-1 … --_offset-9`); each item is `aspect-ratio: 1` and
`clip-path: polygon(var(--_clip-path))` where `--_clip-path` is set per `:nth-child()` in multiples of
that offset — so the row-to-row shear is one number and the angle is aspect-locked (§4-①). Rows
interlock via `margin-top: calc(var(--_offset-3) * -1 + var(--_gap))` on `:nth-child(n+4)` — i.e. the
next row is pulled *up* 30% into the previous row's clipped-away triangle. `pointer-events: none` on
the wrapper with `auto` on the items keeps the wrapper's rectangle from eating events. On hover it
`transition`s `clip-path` back to a full rectangle plus `scale: 1.3` — pretty, but a `clip-path`
transition is not compositor-accelerated and the non-hovered items get `filter: grayscale(1) blur(3px)`;
both are outside our §14.11 budget and we'd take the geometry, not the interaction.

**② Codrops, "Crafting a Cutout Collage Layout with CSS Grid and Clip-path" (2020) — VERIFIED, read
`tympanus.net/Tutorials/CutoutCollageLayout/styles.css`.**
The *collage* archetype (our Double-Dragon / Viewtrade references). A `grid-template-columns:
repeat(12, 1fr)` / `repeat(12, 1fr)` canvas; every image gets its own `grid-column`/`grid-row`, its own
`z-index` (0…8, deliberately overlapping), and its own irregular percentage polygon — e.g.
`clip-path: polygon(5% 10%, 27% 3%, 94% 25%, 84% 98%, 39% 98%, 11% 98%, 4% 66%, 4% 34%)`. Hover
transitions `clip-path .45s` to a second hand-authored polygon. **The load-bearing lesson is negative:
the "hand-drawn torn edge" look is per-item hand-authored art direction and there is no generator.** For
dynamic N we would need a seeded pseudo-random polygon generator, and percentage polygons distort with
the box's aspect (fine for a torn collage, fatal for a consistent shear).

**③ NewCity, "Consistent Diagonal Clipping with CSS" — VERIFIED (technique + code quoted at source).**
The whole article is our §4 problem: parallelograms of differing heights end up with differing angles.
Solution = store `tan(θ)` as a custom property and derive the vertex offset from the element's own
height. Pre-`tan()` in spirit but the same reasoning; worth citing as the "why" behind §4.

**④ Game marketing pages (ZZZ agents, Riot "True Damage") — UNVERIFIED.** I did not obtain readable
source for either; the current HoYoverse/Riot campaign pages are JS/canvas-driven marketing builds and
the True Damage page is gone. Treat the reference images as *art direction* only, not as evidence about
implementation.

---

## 6. Recommended technique stack for OUR constraints

**Panel = `clip-path: polygon()` on the real `<button>`. Not `mask`, not `skewY`.** It is the only
construction where the tap area equals the visible parallelogram (§1.1) — which is what lets N bands
interlock with zero dead taps (§1.3) — and Gecko has sent polygon clips to WebRender *and hit-tested
them there* since Firefox 89 (Bug 1675375). `skewY` would force every child to counter-skew and would
shear the type the references keep upright.

**Angle = `calc(100cqw * tan(var(--gc-shear)))`** on a `container-type: inline-size` track, band
`aspect-ratio` fixed. One token, constant angle 320→430px, verified identical in both engines (§4).
Band count and heights then derive from `hostCount` exactly like `cardShapes()` does today.

**Keep the arcade lift by clipping the button to the union hexagon** (parallelogram ∪ its offset copy),
with `.drop`/`.face` spans each clipped to the plain parallelogram — verified painting *and* tappable
(§1.4). Do not reach for `filter: drop-shadow` on the panel; the clip erases it.

**Duotone = static `filter` on the `<img>` + flat panel colour in the gutters, edge and scrim** (option
A, §2). No backdrop readback, keeps `<img>` (so the M3 morph seam and `object-position` survive), and
matches the sleeping-card filter already in `gacha.css`. Hold `mix-blend-mode` in reserve as a
Gecko-scoped upgrade only — a scrolling list of blended panels is exactly the tile-cache case §14.11
burned us on. For a true two-colour duotone, `background-blend-mode` (no readback) is the next step,
but it costs the `<img>` element and must be raised as a design change.

**Add an explicit inset focus ring** — the UA ring is clipped away (§1.4-③).

**Breakout: type only.** Rotated names crossing gutters as `pointer-events: none` + `aria-hidden`
overlays. Art breakout needs alpha-cutout or a masked fade, and a tap on it opens the *wrong* panel
(§3) — worth showing the owner, not worth shipping blind.

---

## 7. What I could not determine

- **Real Fennec / Chrome-Android numbers.** Every probe ran on desktop Linux Chromium 149 / Firefox 151.
  The engines are the same, the **compositor budget is not** — mobile tile sizes, memory pressure and
  the Android GPU driver all matter. Nothing here substitutes for the standing on-device eyeball round
  (§14.11 acceptance).
- **The cost of N polygon clips while scrolling on Gecko-Android.** Bug 1675375 says polygon clips go to
  WebRender natively rather than as rasterized masks, but I found no per-clip cost measurement, and no
  Fennec-specific jank report for `clip-path`. The one Bugzilla hit for scroll lag under clip-path
  ([1736960](https://bugzilla.mozilla.org/show_bug.cgi?id=1736960)) turned out to be a *dangling
  `url(#…)` reference* — which is our own R21 lesson ("dangling `filter:url(#)` UNPAINTS on Gecko")
  wearing a different hat — and was fixed in Firefox 96 as a duplicate of 1727016. **Not a clip-path
  cost datapoint.**
- **A measured mix-blend-mode-vs-filter delta on mobile.** The only number I found (1.8ms → 0.3ms) is
  desktop, 4K, and about the *fix*, not about our composition.
- **Whether the CSSWG-issue mask/hit-test claim was ever true.** My probe says no in Chromium 149 /
  Firefox 151 across all three mask forms; the issue (Dec 2024) says yes for Chrome and Firefox. I did
  not test older builds or the Android builds, and the issue is still open with no spec resolution — so
  **do not rely on mask hit-testing behaviour in either direction**; use `clip-path` when the hit area
  must follow the shape, and an explicit `pointer-events` rule when it must not.
- **Readable source for a real ZZZ-style shipped roster page** (§5-④).
