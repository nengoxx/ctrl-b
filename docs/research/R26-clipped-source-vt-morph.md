# R26 — Making a CLIPPED-SOURCE View Transition morph read continuous

**Date:** 2026-08-08 · **Class:** web-platform engine research (not peer-class — no self-hosted
agent-chat project ships a clipped-source shared-element morph; searched, recorded negative)
**Question:** the gacha POSTER fleet layout (branch `alt-fleet`) morphs a poster slice's art into
the dossier avatar with a View Transition. The slice shows only a **sheared cutout** of its image
(`clip-path: var(--poly)` on the ancestor `.po-art`), but the VT snapshot is taken of the `<img>`
itself, so the transition **opens by popping the full rectangle** and then shrinks it. *What is the
best-feeling, engine-safe way to make a clipped-source morph read continuous — with working probe
evidence on BOTH engines?*

**Engine floor (hard):** Firefox Fennec (Gecko ~151, the owner's PRIMARY device) **and** Chrome
Android (Chromium ~149). A candidate that clears only one engine is evidence, never a
recommendation.

**Related:** [R15](./R15-view-transitions-glass-and-gecko.md) (VT capture/glass + the Gecko
group-count cost) · [R18](./R18-ensemble-collage-fleet.md) (the clip-path band construction this
layout is built from) · [R25](./R25-alt-fleet-port-seams.md) (the port's seam map) ·
`docs/GACHA_PLAN.md` §10.1 (the external-capture probe pattern this pass reuses).

---

## 0. Headline

1. **The spec already gives us the fix, and both engines honour it.** A captured element's **own**
   `clip-path` **is baked into its snapshot**; only *ancestor* clipping is lost. The bug is
   therefore a **naming** bug, not a VT limitation: `capsule-shell` is stamped on the `<img>`, one
   level *below* the element that carries the clip. **Naming `.po-art` instead removes the pop
   entirely — VERIFIED on Gecko 151 and Chromium 149, zero code in the CSS, ~6 type widenings in
   TS.**
2. **The owner's two-stage "card unfolds, then morphs" staging works on both engines too** —
   the live clip interpolates at a clean 60 fps (9–10 frames for a 150 ms unfold, monotonic, on
   both engines under *software* compositing). It needs three things the naive version misses: a
   **z-lift** (measured: 17.7 % of the revealed area is eaten by the next slice without it), **both**
   clip variables opened (`--poly` *and* the six-vertex `--poly-hit`), and the **generation-ticket
   discipline extended across the new async gap**.
3. **They are not rivals — (a) is the floor that makes (c) safe.** Probed directly: interrupt the
   unfold at 40 % and capture. With the `<img>` named the snapshot **jumps +3 660 px in one frame**;
   with `.po-art` named it stays monotonic. (a) makes *any* intermediate clip state capture
   faithfully, which is exactly what a staged/abortable choreography needs.
4. **Level-2 nested groups (`view-transition-group: contain`) are Chromium-only** —
   `CSS.supports('view-transition-group','contain')` is `true` on Chromium 149 and **`false` on
   Firefox 151** (verified in-engine). Excluded from the ranking by the both-engines bar.

---

## 1. The spec facts

### 1.1 The captured element's own clip IS in the snapshot (the load-bearing sentence)

CSS View Transitions Module Level 1, **§1.5 Rendering model** (verbatim):

> "Aspects of the element's rendering which apply to the element itself or its descendants, for
> example visual effects like **filter or opacity and clipping from overflow or clip-path**, are
> applied when generating its image."

and, for the properties that cannot be:

> "Such properties are applied to the element's corresponding `::view-transition-group()`
> pseudo-element, which is meant to generate a box equivalent to the element."
> *(context: `mix-blend-mode`, "which define how the element draws when it is embedded")*

The capture algorithm itself is **§7.7 "Capture the image"**, with **§7.7.1 "Capture rendering
characteristics"**. *(⚠ I could not extract §7.7.1's numbered list — the fetch truncated there. The
§1.5 sentence above is the quoted authority, and §2 below verifies it empirically on both engines,
which is what this repo requires anyway.)* — **REPORTED (spec) + VERIFIED (probe)**

### 1.2 What is NOT in the snapshot: everything an ANCESTOR does

The complement is the actual bug. Chrome for Developers' nested-groups guide states the effect
plainly, and the field guides repeat it:

> "There's no such thing as clip-path in a `::view-transition` pseudo class; if you're animating an
> element that was clipped through overflow or clip path **by another element** it will appear
> **unclipped** in the pseudo class." — Cyd Stumpel, *A Practical Guide to the CSS View Transition
> API* (**REPORTED**, secondary; verified by our own §2 base-case frames)

Also load-bearing and easy to get wrong: `::view-transition-*` pseudos are children of
`::view-transition`, which is generated on the **document element**. They therefore inherit custom
properties from `html` — **not** from the element that was captured. Any geometry a pseudo's rule
needs must be on `html`. (This is what makes candidate (b) expensive; see §5.2.) — **VERIFIED**
(the repo's own `:scope[data-transition="detail"]` rules in `gacha.css:2159+` work for exactly this
reason.)

### 1.3 The UA stylesheet the default look comes from

> `::view-transition-group(*) { position: absolute; top: 0; left: 0; animation-duration: 0.25s;
> animation-fill-mode: both; }`
> `::view-transition-image-pair(*) { position: absolute; inset: 0; isolation: isolate; }`
> `::view-transition-old(*), ::view-transition-new(*) { position: absolute; inset-block-start: 0;
> **inline-size: 100%; block-size: auto**; }`

The bolded pair is why a morph between a **landscape** source (328 × 169.6) and a **portrait**
destination (104 × 138) reads as *the old image deflating at the top of the group* rather than as a
crop: the old snapshot keeps its own aspect while the group's box animates to the new one. It is
overridable (§4.1's `a3` lever). — **REPORTED (spec) + VERIFIED (probe)**

### 1.4 Level 2 — nested groups

`view-transition-group: contain | nearest | <name>` plus `::view-transition-group-children()` let
an ancestor's clip apply to a nested group (you copy the clip onto the *children* pseudo, not the
group). Browser support, verbatim from Chrome for Developers: **"Chrome: 140" and "Edge: 140"**,
with **Firefox and Safari "not supported"**. Confirmed in-engine: `CSS.supports(
'view-transition-group','contain')` → `true` on Chromium 149, **`false` on Firefox 151**.
— **REPORTED (doc) + VERIFIED (in-engine)**

---

## 2. The probe

**Rig.** A standalone harness replicating the poster's real geometry — the `--run`/`--gut`/`--drop`/
`--poly`/`--poly-hit`/`--po-h` block copied from `frontend/src/themes/gacha/gacha.css:1621-1740`,
four sheared slices at a 390 × 844 viewport (poster width 330 px ⇒ `--run` = **58.19 px**, slice
height **171.6 px**, art box **328 × 169.6**), one image per slice, a fake dossier sheet whose
`.avatar` is the shipped 104 × 138 / radius 16 / `object-fit: cover` box, and the shipped
`capsule-shell` name pair + the repo's 560/280/300 ms `detail` timings.

**The canary.** Each slice's image is an SVG of *exactly* the art box's aspect whose two corner
triangles — precisely the regions `--poly` clips away — are painted pure magenta, inset 2.5 px so
clip-edge anti-aliasing cannot produce false positives. **Magenta on screen ⇒ clipped-away source
is being painted.** Nothing else in the harness is magenta; the destination art is the same file
with those triangles painted back into the gradient, so the morph's *destination* can never
contribute to the count. Full reveal = **17 480 px** (Gecko) / **17 258 px** (Chromium).

**Capture.** The §10.1 pattern, because **Playwright/Gecko screenshots omit the `::view-transition`
layer**: `Xvfb :77 -screen 0 760x1000x24` + a **real windowed browser** (Playwright headed, viewport
390 × 844, dsf 1) + `ffmpeg -f x11grab -framerate 60` → lossless PPM frames → per-frame pixel count
(PIL, no numpy on this box). Playwright drives; it never captures. Two detectors: an exact-colour
one and an **opacity-tolerant hue** one (`r > g+50 ∧ b > g+50`) that keeps counting the triangle
while it cross-fades out — the second is what the frame counts below use, so they measure *how long
the wrong shape is on screen*, not how long it is opaque.

**Engines (exact):** Chromium **149.0.7827.55** · Firefox/Gecko **151.0**, both Playwright-bundled,
both under Xvfb **software** compositing (the *less* favourable path — same argument as §10.1's
liveness spike). Timings are **real** (no slow-motion) unless stated.

**Cross-check:** Chromium was additionally driven headless with Playwright screenshots at 4×
slow-motion; the two instruments agree, and Chromium screenshots *do* include the VT layer (Gecko's
do not — hence the rig).

---

## 3. Per-candidate findings

### The measurement, one table

Frames in which clipped-away source content is on screen (60 fps external capture, real timing):

| mode | what it is | Gecko 151 | Chromium 149 | peak canary px | reading |
|---|---|---|---|---|---|
| **base** | shipped: `<img>` named | **5 frames (84 ms)**, full 17 480 px reached **in ONE frame** | **5 frames (84 ms)**, 17 228 px in one frame | 17 480 / 17 228 | **the pop** |
| **(a)** | `.po-art` (the clip carrier) named | **0 frames** | **0 frames** | — (baseline only) | continuous from frame 0 |
| **(a) + `.picked`** | (a) with the selected slice's `scale(1.05)` ancestor transform | **0 frames** | **0 frames** | — | ancestor transform is fine |
| **(b)** | `<img>` named + `clip-path` animated on `::view-transition-old` | 11 frames (184 ms) | 11 frames (184 ms) | **9 360 / 9 124** | reveal works, never completes |
| **(b2)** | `<img>` named + **static** `clip-path` on `::view-transition-old` | **0 frames** | (not run; (b) proves the property applies) | — | property applies statically too |
| **(c)** | two-stage unfold, then morph | 13 frames (217 ms) | 14 frames (234 ms) | **17 480 / 17 258** (the *intended* full reveal) | unfold reaches 100 %, then flies |
| **(c) no z-lift** | control | peak **13 427** vs 16 324 | — | **−17.7 %** | the next slice eats the corner |
| **(d)** | `view-transition-group: contain` | **unsupported** | supported | — | engine split |

The two engines produce **identical frame counts** on every candidate. That is the strongest single
result of this pass.

---

### (a) Name the clip-CARRYING element (`.po-art`) — **VERIFIED, both engines**

**Does the element's own `clip-path` bake into the snapshot? YES, on both engines.** With
`view-transition-name: capsule-shell` moved from the `<img>` to its parent `.po-art` (which carries
`clip-path: var(--poly)`), the canary count never rises above its resting baseline on **either**
engine, in **any** frame of the flight. The frames show the flying snapshot as a **sheared
parallelogram** matching the visible cutout, which then cross-fades to the rounded-rect avatar.

Robustness bonus, probed directly (this is what makes (a) the floor rather than an alternative):

| interrupted-unfold probe (Gecko, capture at 40 % of a 400 ms unfold) | canary series | verdict |
|---|---|---|
| `<img>` named (`cmid`) | …8 958 → 10 876 → 10 876 → 10 876 → **14 536** → 11 804… | **+3 660 px jump in one frame** |
| `.po-art` named (`camid`) | …6 869 → 8 870 → 10 798 → 10 798 → 10 798 → 10 225 → 8 379 | **monotonic, no jump** |

i.e. with (a) in place the snapshot is faithful to **whatever shape the clip currently has** —
mid-animation, aborted, reduced-motion, slow frame. Without it, every intermediate state is its own
pop.

**What else flies.** `.po-art` also contains `.po-glow` and `.po-veil` (the hue wash) and its
`overflow: hidden` now *contains the breathing `<img>` inside the snapshot* (today the idle
`gacha-po-breathe` scale is folded into the group transform instead). Both are arguably
improvements; both are eyeball items, not measured. **UNVERIFIED** as a preference.

**How the default cross-fade looks** (§1.3): the parallelogram keeps its landscape aspect and
"deflates" at the top of the shrinking group. A one-rule lever exists and was probed (**`a3`**):

```css
::view-transition-old(capsule-shell), ::view-transition-new(capsule-shell) {
  block-size: 100%; object-fit: cover;      /* fill the morphing group instead of keeping aspect */
}
```
`a3` is **also 0-pop on both engines**; the art then fills the flying box the whole way (reads more
like a card reshaping) at the cost of cropping the shear as the box narrows. Owner's eye decides;
frames for both are in the scratchpad.

### (b) Reveal inside ONE transition — animate `clip-path` on `::view-transition-old` — **VERIFIED (it runs), both engines**

`clip-path` **animates on the VT pseudos in both Gecko 151 and Chromium 149** (this was the open
feasibility question, and the answer is yes), and a **static** `clip-path` on the pseudo also
applies (mode `b2`, 0-pop). Percentage polygon coordinates ride the group's scale correctly — the
`from` shape sits exactly on the visible cutout, so frame 0 is continuous.

Two real defects, both measured:

1. **The reveal never completes.** Peak canary **9 360 px vs the 17 480 px full reveal**: the clip
   opens while the group is already shrinking hard (the shipped
   `cubic-bezier(0.22, 1, 0.36, 1)` is ~35 % along by frame 1), so the user never sees the cut
   corners at readable size. It reads as "extra content appearing on a departing card", not as an
   unfold.
2. **The percentage is viewport-dependent and out of scope.** The `from` polygon's Y coordinate is
   `--run ÷ art-height` = **34.31 % @390 px, 31.4 % @320 px, 36.6 % @430 px** (`--po-h`'s `clamp()`
   changes which term binds). And per §1.2 the pseudos inherit from `html`, so `--run` (declared on
   `.po-poster`, `gacha.css:1621`) **is not in scope there** — the ratio would have to be measured
   in JS and written onto the document element before every open. That is a second source of truth
   for geometry the CSS already owns.

Plus a scoping cost: the `detail` VT block (`gacha.css:2151-2232`) is shared with the **capsule**
track, whose crop needs none of this, so the rule needs `:has(body[data-gc-fleet="poster"])` (the
`body[data-gc-fleet="poster"]` stamp already exists, `gacha.css:1540`).

### (c) The owner's staging — unfold the CARD, then morph — **VERIFIED, both engines**

Staging as specified: **stage 1** animates the *slice's* clip from the sheared polygon to the full
plate rectangle (the card "stretches to fit its whole image"); **stage 2** is the existing morph,
now from a rectangular source.

**"Opening the clip IS the full reveal" — confirmed at the real geometry, corners included.**
`.po-art` is `inset: 1px` on the plate and its `<img>` is `position:absolute; inset:0;
width/height:100%; object-fit: cover` (`gacha.css:1718-1729`), so the image's border box *already*
covers the whole plate rect minus the 1 px keyline; the clip is the only thing hiding the corners.
The probe reaches the **full 17 480 px** canary area — every clipped-away pixel is real image, no
letterboxing, no transparent corner.

**① The z-lift is mandatory and was measured.** Slices overlap by `--run − --gut` = **36.19 px** and
later siblings paint on top, so without a lift the next slice **eats 17.7 % of the revealed area**
(peak 13 427 vs 16 324) — visibly, a sheared bite out of the unfolding card's bottom-right. Side-by-
side frames are in the scratchpad. **Cheap news: `.po-slice.picked` already sets `z-index: 3`
(`gacha.css:1786-1789`)**, and an "open" tap always leaves the slice picked in the same React batch,
so the lift is effectively already there — but an explicit `.opening { z-index }` is one line of
insurance rather than an invisible dependency on the picked state. Compositing mid-animation was
clean on both engines (no seams, no flicker, no re-raster artefacts in 60 fps frames).

**② The keyframe pair that interpolates on BOTH engines.** `clip-path` only interpolates between
polygons **with the same vertex count**, and this layout has **two** clip variables:

```css
/* .po-drop / .po-plate / .po-art  — 4 vertices both ends */
--poly:     polygon(0 var(--run), 100% 0, 100% calc(100% - var(--run)), 0 100%)
    -->     polygon(0 0,          100% 0, 100% 100%,                    0 100%)

/* .po-slice (the BUTTON) — SIX vertices both ends; forgetting this one leaves the top-left
   triangle cut, because the button wears the UNION polygon, not --poly */
--poly-hit: polygon(0 var(--run), 100% 0, calc(100% + var(--drop)) var(--drop),
                    calc(100% + var(--drop)) calc(100% - var(--run) + var(--drop)),
                    var(--drop) calc(100% + var(--drop)), 0 100%)
    -->     polygon(0 0,          100% 0, calc(100% + var(--drop)) 0,
                    calc(100% + var(--drop)) calc(100% + var(--drop)),
                    var(--drop) calc(100% + var(--drop)), 0 100%)
```

One inline write of each on the **button** moves all four boxes, because they all read the same two
variables — each element then interpolates its own `clip-path` used value. `transition: clip-path`
must be declared on **each** of `.po-slice`, `.po-drop`, `.po-plate`, `.po-art`. Measured result:
**9–10 frames of monotonic interpolation for a 150 ms unfold on both engines** (60 fps, software
compositing) — no jank, no dropped frames, no snap-to-end.

**③ The handoff seam: none observed, and here is what keeps it that way.** Frames at the boundary
(Gecko f139→f142) show the unfolded rect held, then the flight beginning with the live slice
**already refolded behind it** — no frame in which the card re-clips before the capture. The
invariant the implementation must hold: **the opened `--poly`/`--poly-hit` must stay on the element
from `transitionend` until *inside* the update callback.** The old capture happens after
`startViewTransition` returns, at the next rendering opportunity; removing the class or the inline
values before then re-clips the element and you have bought a *second* discontinuity. Refold
**inside the update callback** (after the old capture, before the new one): probed, and it leaves no
measurable artefact — the fleet behind the sheet is back to its authored shape in the new state.
The alternative (hold the unfold until `finished`) was probed and **rejected**: the fleet stays
visibly rectangular behind the dossier (canary 16 034 px at rest afterwards).

**④ The neighbour parting variant (`c2`).** Runs *concurrently* with the unfold so it costs no
time; the neighbours step aside 7 px (the wake ceremony's `partingStep` grammar) and the card
unfolds into the room it made. In the frames it is subtle — it reads as "the stack makes way"
rather than as a separate beat, and it slightly reduces how much the unfold has to overlap. **No
measured downside; pure eyeball.** Frames in the scratchpad. (It adds one more thing the update
callback must stand down, see §5.3.)

**Timing.** Measured end-to-end (`t.finished`, both engines within ~15 ms of each other):

| composition | Gecko | Chromium |
|---|---|---|
| today (single morph, 560 ms group) | **580 ms** | 593 ms |
| (c) at stage-1 150 ms + 560 ms group | **747 ms** | 750 ms |
| **(c) at stage-1 130 ms + 430 ms group** | **595 ms** | — |

So the owner's "must not feel slower than today" is **achievable at parity**: ~**130 ms** unfold +
~**430 ms** morph lands at 595 ms against today's 580 ms. 150 ms unfolds read fine in the frames;
below ~110 ms the unfold stops being legible as a move (9 frames at 150 ms is already the floor for
a shape change of this size). The band to walk on-device: **stage 1 120–160 ms, group 420–480 ms.**

### (d) Level-2 nested groups — **ENGINE-SPLIT, excluded**

`view-transition-group: contain` + `::view-transition-group-children()` is the platform's *intended*
answer to ancestor clipping, and it is **Chromium 140+/Edge 140+ only**; Firefox 151 reports
`CSS.supports(...) === false` (verified in-engine, and Fennec rides the same train). On Gecko the
declaration is simply dropped, which means the layout falls back to **exactly today's pop** — a
Chromium-solved / Gecko-broken split, which the acceptance bar forbids. Recorded as evidence only.
It also isn't needed: (a) gets the same clip for free by naming one level up, on both engines.

---

## 4. Recommendation

**Both engines clear (a), (b) and (c).** The ranking below is therefore about *quality and cost*,
not about coverage — and (d) is excluded outright as an engine split.

### Rank 1 — **(a) as the invariant, with (c) as the choreography on top**

Do (a) **first and unconditionally**: move `capsule-shell` from the `<img>` to `.po-art`. It is the
minimum that closes the owner's named discontinuity (0 pop frames vs 5, both engines), it costs no
CSS at all, it touches no part of the generation/prep machinery, and — the reason it belongs
*under* (c) rather than beside it — it is what makes every **intermediate** clip state capture
faithfully (§3(a)'s interrupted-unfold probe: +3 660 px one-frame jump without it, monotonic with
it). A staged, abortable, reduced-motion-branching choreography *needs* that property; building (c)
on the `<img>` naming means every abort path is a fresh pop waiting to be found on a device.

Then add (c) — the owner's preferred staging — as a poster-scoped layer: unfold **130–150 ms**,
morph **430–480 ms**, both clip variables, the explicit z-lift, refold in the update callback, and
stage 1 **skipped entirely** whenever no transition will run (see §5.3). This is the composition
the frames support and the one that matches the owner's mental model ("the card stretches to fit
its whole image, then flies").

If the owner wants the leanest possible landing first, **(a) alone is a complete, shippable fix**
and (c) can follow as a separate slice without re-doing any of it. That sequencing is a real option,
not a hedge: (a) is additive-only and (c) never has to undo it.

### Rank 2 — **(a) alone**, with the `a3` sizing lever if the deflating parallelogram reads wrong

Cheapest correct answer. The open question it leaves is aesthetic, not technical: a parallelogram
cross-fading into a rounded rect. Two probed looks (default aspect / `a3` fill-the-group), both
0-pop on both engines.

### Rank 3 — **(b)**, not recommended

It works on both engines — that finding is worth having and it is now bought — but it is the worst
trade of the three: the reveal never reaches full size (9 360 vs 17 480 px), the polygon percentage
is **viewport-dependent** and lives outside the pseudos' inheritance chain so it must be measured in
JS and written onto `html`, and the shared `detail` block needs a `:has()` scope to keep the capsule
track out of it. It buys a *worse* version of (c)'s beat for *more* machinery.

### Excluded — **(d)**

Chromium-only (verified). Under the both-engines bar it cannot be recommended in any form.

### Guardrails that apply whichever way this lands

- **No new deps, no new dependency on `.finished`** — the repo's own rule (`§10.1`, "never gate
  correctness on `.finished`"). (c)'s refold rides the **update callback**, which always runs.
- **Poll-truthful architecture untouched**: nothing here changes what the fleet believes about a
  machine. (c) does delay the *sheet mount* by one stage — see §5.3's ticket note.
- **§14.11**: the added animation is `clip-path`, not `transform`/`opacity`. That is a deliberate
  exception to the theme's transform-only habit and it is measured, not assumed — 9–10 monotonic
  frames per unfold on both engines under software compositing, on the tapped slice only, for
  ≤160 ms. Worth restating in the plan when it lands.

---

## 5. Implementation cost in the REAL codebase (file:line)

### 5.1 Candidate (a) — ~6 type widenings and one query

| file:line | change |
|---|---|
| `frontend/src/themes/gacha/GachaPoster.tsx:225` | `e.currentTarget.querySelector("img")` → the `.po-art` **span**, and only when it actually contains an `<img>` (an art-less slice renders `.po-art-blank` and must keep degrading to the plain open — same rule as today) |
| `frontend/src/themes/gacha/GachaPoster.tsx:113` | `onSliceTap(hostId, morphImg: HTMLImageElement \| null)` → `HTMLElement` |
| `frontend/src/themes/gacha/GachaFleet.tsx:212` | `prep.current.card: HTMLImageElement` → `HTMLElement` |
| `frontend/src/themes/gacha/GachaFleet.tsx:287` | `openHostDossier(hostId, morphImg?: HTMLImageElement \| null)` → `HTMLElement` |
| `frontend/src/themes/gacha/GachaFleet.tsx:375` | `onTapHost(...)` same widening |
| `frontend/src/themes/gacha/GachaTrack.tsx:41, :61` | `onOpenHost` / `onTapHost` prop types |
| `frontend/src/themes/gacha/GachaCard.tsx:23` | `onOpen` prop type (capsule keeps handing over its `<img>` — its crop ≈ its capture, nothing changes for it) |

**CSS changes: none.** The `detail` block (`gacha.css:2151-2232`) and the avatar's counterpart name
(`gacha.css:2474-2477`) are untouched. The `prep`/`gen` machinery
(`GachaFleet.tsx:185-228, 286-338`) is untouched — the element it stamps simply becomes a span.

Two things to eyeball once, not to fix blind: `.po-glow` + `.po-veil` now fly inside the snapshot,
and `.po-art`'s `overflow: hidden` now contains the idle breathe scale inside it.

### 5.2 Candidate (b) — CSS plus new JS geometry plumbing

`gacha.css:2165-2168` would gain a poster-scoped `::view-transition-old(capsule-shell)` keyframe
(`:has(body[data-gc-fleet="poster"])`, the stamp exists at `gacha.css:1540`), **plus** a JS write of
the measured `--run ÷ art-height` ratio onto `document.documentElement` before every
`startViewTransition` (§1.2 — the pseudos cannot see `.po-poster`'s variables). New source of truth
for geometry that `gacha.css:1621/1640` already owns.

### 5.3 Candidate (c) — CSS plus a real change to the opener's shape

**CSS (poster block, `gacha.css:1650-1740`):**
- `transition: clip-path <stage1> …` on `.po-slice`, `.po-drop`, `.po-plate`, `.po-art` (scoped to
  an `.opening`/`[data-opening]` state so nothing transitions at rest).
- the two opened polygon values from §3(c)②, vertex counts preserved.
- `z-index` on the opening slice (insurance beside `.po-slice.picked`'s existing `z-index: 3`,
  `gacha.css:1786`).
- **`body[data-motion="reduced"] .po-slice { transition: none }` already exists
  (`gacha.css:2033`)** — and reduced motion is also the path where `viewTransitionsActive()` is
  false and the open is the sheet's plain slide-up. So the JS must **skip stage 1 outright** on that
  path; otherwise the card unfolds instantly, holds, and never morphs back.

**JS (`GachaFleet.openHostDossier`, `GachaFleet.tsx:286-338`)** — this is the substantive cost, and
it lands squarely in the territory the file's own comments document:
- The open becomes **async before** `startViewTransition`. The `gen` ticket (`:191`, doc comment
  `:185-191`) must be taken **before** stage 1 and **re-checked after the await** — a rapid A→B tap,
  a close, the reel starting (`reeling`, `:184`), a host leaving, a tab change or an unmount can all
  land inside the new ~150 ms window, which is *wider* than anything the current code has to
  survive.
- A **`prep`-shaped owner ref** (`:211-228`) must own the **opened slice** so every abandonment path
  refolds it — same identity discipline (`prep.current === myPrep`) that already guards the stamped
  portrait and the suppressed avatar. `cleanMorphPrep` (`:216-228`) grows a refold; `dropShowcase`
  (`:278-284`) and the tab-leave teardown must not leave a slice unfolded.
- The refold (and `c2`'s parting stand-down) go **inside the update callback**, beside the existing
  name restores (`:324-331`).
- **Ownership question for the main seat:** `GachaPoster.tsx:33-34` states the shared opener "owns
  every part of the transition", and stage 1 is *poster-private geometry*. Either the opener gains a
  `prepare?: () => Promise<void>` that the layout supplies (keeps the invariant, one new prop), or
  the layout performs the unfold and the invariant is restated. The first is the smaller lie.
- Budget: +130–150 ms of latency before the sheet mounts; hold the total by re-timing the group to
  ~430 ms (`gacha.css:2159-2162`) — measured 595 ms vs today's 580 ms.

---

## 6. What I could NOT determine

1. **No real-device evidence.** Everything here is desktop Gecko **151.0** and Chromium
   **149.0.7827.55** under Xvfb **software** compositing. Fennec on the owner's phone and Chrome
   Android are **untested** — the §10.1 transfer argument (one implementation, one train) applies,
   and the *identical* frame counts across two very different engines make an Android-only
   divergence unlikely, but the device round remains the acceptance for feel and for frame
   stability under real GPU compositing.
2. **The spec's §7.7.1 "capture rendering characteristics" numbered list** — the fetch truncated
   there. §1.5's sentence is quoted instead, and both engines were probed, which is the stronger
   evidence anyway.
3. **Feel is not measured.** "Does a parallelogram cross-fading into a rounded rect look right"
   and "does the unfold read as the card stretching" are owner-eye questions. Frames exist for
   every variant; nobody has watched them at speed on a phone.
4. **The probe is synthetic.** Four slices, flat SVG art with hard colour blocks (a photographic
   frontier portrait will show the reveal very differently), **no** `gacha-po-breathe` idle
   animation, no `.po-glow`/`.po-veil` in the named subtree, no `.po-zone` text, no wake ceremony
   running concurrently, no reel.
5. **The `dossier-rar` badge hold** (`gacha.css:2222-2246`, held back to the last 150 ms of a
   560 ms arc) was **not** re-checked against a two-stage open or a re-timed group. If (c) lands
   and the group shortens to ~430 ms, that 73 % keyframe stop is a number that moves with it.
6. **Gecko VT cost (R15 §B: cost scales with GROUP COUNT).** Naming `.po-art` instead of the `<img>`
   keeps the count at one, so no change is expected — **UNVERIFIED**, not measured.
7. **The "hold the unfold until `finished`" variant (`c3`)** is reported only as a rejected
   artefact; my probe's restore path for it was itself buggy, so treat "it leaves the fleet
   unfolded" as the finding and nothing else about that variant as tested.
8. **Swap and reopen-mid-exit shapes.** The probe only ever ran a *fresh* open. The `detail` kind
   has two other shapes (a dossier already on screen; one still easing out — `GachaFleet.tsx:
   299-316`), and neither was probed with either candidate.
9. **`a3` (`block-size: 100%; object-fit: cover` on the pseudos)** was verified 0-pop on both
   engines but **not** compared for feel at real speed, and not checked against the capsule track,
   which shares the same pseudo selectors.

---

*Probe harness, drivers, per-frame counts and all evidence strips were kept in the session
scratchpad (`/home/emma/.cache/tmp/r26/probe/`), not committed — the §10.1 precedent.*
