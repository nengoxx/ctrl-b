# Alt Fleet Lab v2 — ten immersive concept screens

The discussion vehicle for the alt-fleet ensemble design conversation
(`docs/GACHA_PLAN.md` §12.5). **Lab v1** (`../alt-fleet-showcase/`) was a design-review page with
thumbnails and notes; **this is not that.** Each of the ten screens is a full-viewport game screen
with its own fiction, palette, type system, idle motion, selection states and wake ceremony — the
same four machines, ten different games.

Standalone: no app code, no build step, no network at runtime.

## Run it

```bash
cd design/prototypes/gacha/alt-fleet-showcase-v2
python3 -m http.server 8913
# then open http://<host>:8913/  (phone: http://emma:8913/)
```

Design target is **390 × 844**; it holds 320–430. On desktop the page just centres a ~520px column
over a dim field — the fiction stays intact.

## The ten

| # | Concept | The fiction | Source |
|---|---|---|---|
| 01 | **SIGNAL BANDS** | The ZZZ diagonal roster poster — parallel sheared bands, marquee ticker, outline names crossing the gutters. This is the §12.2 PRODUCTION form. | ref img 1 · R23 C2 · R18 |
| 02 | **SLICE STACK** | The True Damage premium poster: one black field, one parallelogram of four equal slices, a giant vertical wordmark. Maximal restraint. | ref img 3 · R22 P1–P3 |
| 03 | **CHARACTER SELECT** | The fighting-game slab: hero bleeding off-edge + a four-tile rail, nameplate slam, epithets, announcer type. | R22 C1 |
| 04 | **THE DOCK** | Four berths, rarity-coloured frames, a lock pin — and a wake ceremony that is a genuine progress indicator (a real elapsed timer runs). | R22 C3 × R23 C3 |
| 05 | **OPERATOR FILE** | The personnel registry: chamfered cards, hazard tape, letter-graded exam block, hostname barcodes, rubber stamps. | R23 C1 · R24 ⑤ |
| 06 | **FLEET/4** | The group poster: four members, four colours, one stepped forward; FGO's flip with the back face already lit. | R23 C5 |
| 07 | **THE CUT-IN** | The Persona two-tone diagonal: a −12° band, thick keyline plates, alien-cyan selection, triple-ghost name collapse. | R22 C5 |
| 08 | **GIG FLYER** | The riso one-man live: ONE pinned SVG duotone presses all four portraits into the same two inks; the fleet's stats ARE the gig details. | ref img 4 · R24 A2/A3/A16 |
| 09 | **MANGA COLLAGE** | The comic page: hand-authored panel polygons (N=4 fixed — this form has no generator), halftone fields, sleep burst, stickers. The loudest. | ref img 2 |
| 10 | **CAPSULE DOME** | The gashapon machine itself: four capsules in a dome, and the crank IS the wake control — it resists, then gives. | R24 C① |

## Driving it

- **Switch concepts:** the `‹` / `›` chips at the bottom, or **←** / **→** on a keyboard.
  The index pill shows `03/10`; the concept name flashes for ~2s on each switch.
- **Deep link:** the current concept lives in `location.hash` (`#07`) — reload returns to it.
- **Open a dossier:** tap any ONLINE machine. Same shared component everywhere, re-skinned per
  concept via one accent custom property and one of three finishes (soft / hard / print).
  Escape, the backdrop, or `×` dismisses it; focus returns to the button that opened it.
- **Wake Rook:** Rook is SLEEPING in every concept. Tapping him (or, in 10, the crank) runs *that
  concept's* wake ceremony and he becomes ONLINE **for that concept only**.
  **Tap anywhere during a ceremony to skip to the final frame** — mandatory, and it works everywhere.
- **Reset:** the small `↺` chip in the switcher clears every concept's wake state at once.

Two concepts use a **select-then-open** button: **03 CHARACTER SELECT** (first tap selects and slams
the nameplate, second tap on the selected tile opens the dossier) and **05 OPERATOR FILE** (first tap
opens the file in place with the graded exam block, second tap opens the full dossier).
**07 THE CUT-IN** does the same for its cut-in. Everywhere else one tap opens the dossier.

## The shared contract (so the comparison is fair)

Same roster (Pegasus / Atlas / Rook / Lyra, one sleeping) · same four art crops · ONLINE = full
colour, SLEEPING = `saturate(0) brightness(.55)` with idle motion stopped · one real `<button>` per
machine · one shared dossier · a latency-dramatising wake ceremony per concept's own fiction.

**Motion** follows R24 §B verbatim: the §B.1 tokens are the `:root` block in `styles.css`, ceremonies
are five beats inside 900ms, and only `transform` / `opacity` animate. No animated
`filter` / `clip-path` / `background-position`; `will-change` is added on `animationstart` and removed
on `animationend`; hover effects are gated behind `@media (hover:hover) and (pointer:fine)`;
`prefers-reduced-motion` routes through the §B.4 token-override block (durations shrink, feedback
stays). Grain is a baked data-URI tile (A18), never a live filter.

**SVG filter defs** (the riso duotone pair, the silhouette matrix) are pinned in `index.html` and are
never conditionally unmounted — a dangling `filter: url(#id)` unpaints the element on Gecko.

**A11y:** every machine button carries an aria-label naming machine + role + status + what the tap
does; `:focus-visible` rings are drawn *inset* (the UA ring is clipped away inside a `clip-path`
shape); an `aria-live="polite"` status line announces concept switches, dossier opens and wake
results; the dossier is a focus-trapped `role="dialog"`.

## Fonts

All self-hosted latin subsets, `font-display: swap`, no runtime network. Carried over from lab v1:
**Bungee** 400, **Zen Kaku Gothic New** 700/900. Fetched for this lab from `fonts.gstatic.com`
(all five succeeded, **~64KB total**, well under the 450KB budget):
**Archivo Black** (18.6KB) · **Rubik Mono One** (12.8KB) · **DotGothic16** (10.5KB) ·
**Silkscreen** (8.4KB) · **Dela Gothic One** (13.8KB).

Note: these are the **latin** subsets. The Japanese strings (天馬 / 地図 / 塔 / 琴, マシンをえらべ,
前売り…) fall back to the system JP face — intentional, since full JP faces run multi-MB.

## Verification

`preview/01.png` … `preview/10.png` are Playwright captures at 390×844 (DPR 2). All ten screens
render with a **clean console**; each concept's wake ceremony was driven and clears the sleeping
state; the dossier opens and Escape closes it; no horizontal overflow at **320px or 430px**;
the reduced-motion path and the `↺` reset were exercised.

## Known rough edges

- **09 MANGA COLLAGE** hit areas are exact (the polygon clips the button), but the panel geometry is
  hand-authored per item — as R18 §5-② says, this form does not generate from a count. It is here so
  the *look* gets a fair hearing at N=4, not as a candidate for a dynamic fleet.
- **06 / 07** simulate cut-out figures with heavy keylines and drop plates. The art is rectangular
  and opaque; nothing here pretends to have alpha (R18 §3).
- **04 THE DOCK**'s boot timer reads `mm:ss.c` rather than plain `mm:ss` — at a 900ms ceremony a
  plain `mm:ss` never ticks, which defeats the point of showing a real timer.
- The **06** fan is tuned so no member is ever fully occluded at 390px; at 320px the sliver of the
  card next to the lead gets thin.
- Idle motion is deliberately cheap everywhere (one marquee, one breathe, one bob). No particle
  fields, no canvas — the §14.11 discipline.
- Desktop is *not* a design target: it centres the phone column and stops there.
