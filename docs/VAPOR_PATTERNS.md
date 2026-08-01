# Vapor design language — the pattern reference (D7 companion)

**Read this before building or styling any component.** It distills the *rules* behind
`frontend/src/theme/vapor.css` (the verbatim lift of `design/prototypes/variations/vapor.html`) so new
components are consistent by construction instead of by guesswork. `vapor.css` stays **verbatim**;
net-new components live in `theme/extras.css` and must be built **only** from the tokens and recipes
below. When in doubt, find the closest existing component in `vapor.css` and copy its recipe.

The cardinal rule: **reuse a token/recipe; never re-derive a color, gradient, glow, radius, or
spacing value.** If a value isn't here, it's almost certainly already in `vapor.css` — go look.
And **never hardcode an `rgba()` color** — every color/glow flows from a token (the owner explicitly
swept all hardcoded pinks/violets/reds out so glows track the theme; see §10).

**Provenance — where the intent lives.** The visual source of truth is
`../design/prototypes/variations/vapor.html`. The *why* behind it is in
`../design/prototypes/vapor-chats/chat1..5.md` (the design back-and-forth) + that folder's `README.md`.
This doc distills both so you don't have to re-read them each time; §13 captures the per-component
decisions from those chats. The design is **mobile-first for a 412×892 Android frame** — verify at
~390–412px width; other widths are unverified territory.

---

## 1. Color tokens & semantic roles

All color comes from CSS variables on `:root` (the default **vapor/"dark"** palette), overridden by
`[data-theme="aqua"]` and `[data-theme="ember"]` on `<body>`. Never hardcode a hex except the two
sanctioned ink-on-gradient constants below.

| Token | Role |
|---|---|
| `--bg`, `--bg-2`, `--bg-3` | Surface depth: page → card → inset field. Cards are `--bg-2`, inputs `--bg-3`. |
| `--ink`, `--ink-soft`, `--ink-faint` | Text hierarchy: primary → secondary/labels → tertiary/placeholder. |
| `--magenta` | **Primary** accent. Active states, focus, primary buttons, LEDs, links, chevrons. |
| `--violet` | **Secondary** accent. The far stop of the primary gradient; "done"/dispatched states. |
| `--teal` | **Info** accent. User chat, the auto-TTS toggle, the `◐` busy spinner, secondary glyphs. |
| `--green` | **Success / command**. `$` command bubbles, exec actions, download links, "awake" badges. |
| `--red` | **Danger / destructive**. The only reliably-red token in *every* palette (see §10). |
| `--line`, `--line-2` | Hairline borders: subtle (`--line`) vs visible (`--line-2`). |
| `--m-glow`, `--v-glow`, `--t-glow` | Ready-made **box-shadow** glows for magenta / violet / teal. |
| `--accent-rgb`, `--accent-rgb-2`, `--danger-rgb` | Bare `R, G, B` triplets for `rgba(var(--x), a)`. |
| `--accent-grad`, `--danger-grad`, `--vapor-glow-filter`, `--danger-glow` | **Mask-icon only** (see §3/§4). `--vapor-glow-filter` was `--accent-glow` until D51 V3 — that name is now the CONTRACT's box-shadow glow (`themes/vapor/tokens.css`), so never use it in a `filter:`. |

Sanctioned constants: **`#1a0428`** (dark ink for text *on* the magenta→violet gradient) and
**white** (`#fff`) for text on saturated fills like `.seg.active`. Nothing else hardcoded.

---

## 2. Typography

Two fonts, loaded in `index.html`:

- **`"Major Mono Display"`** — the *display* face. Use **only** for: the brand mark, large device/host
  names (`.dev .name`, `.now .name`), big stat numbers (`.now .stat .v`, `.summary .v`), util card
  titles (`.nm`), section numbers, and tab glyphs. It mangles punctuation and lowercase — **never use
  it for body text, sentences, labels, or anything with `?`, `S`, mixed case** (this is exactly why
  the confirm-dialog title moved off it).
- **`"JetBrains Mono"`** (base, `13px`) — **everything else**: body, labels, code, kv values, inputs,
  buttons, badges, toasts.

**Label convention (pervasive):** small caps labels are `font-size: 8–9px; letter-spacing: 1.5–2px;
text-transform: uppercase; color: var(--ink-faint|--ink-soft)`. Buttons add `font-weight: 600–800`.
Body copy is `13px`, line-height `1.5`. Code is `~11.5px` `--green` on `--bg`.

---

## 3. Gradients — two families, do not mix them up

1. **Primary fill (text buttons, toggles, active chips):**
   `linear-gradient(135deg, var(--magenta), var(--violet))`. This is *the* filled-button look —
   utils `.field button`, `.mconf .mfoot .save`, `.seg button.active`, `.switch.on .knob`.
2. **Mask-icon fill (`--accent-grad` / `--danger-grad`):** a `180deg` **four-stop** gradient. Used
   **only** as the `background` behind a `-webkit-mask` SVG icon (`.dev .act.wake`/`.stop`, the TTS
   button). **Never** put `--accent-grad`/`--danger-grad` on a normal text button — its structure
   (direction + stops) doesn't match the primary fill and will look inconsistent. (This was the bug
   in the first confirm dialog.)

Subtle tint backgrounds (card headers, chat bubbles, hero panels) use low-alpha accent washes, e.g.
`linear-gradient(135deg, rgba(var(--accent-rgb), 0.08), transparent)`.

---

## 4. Glows & shadows

- **Box-shadow glows** for elements that glow in place: use `var(--m-glow|--v-glow|--t-glow)` (LEDs,
  focus rings, featured cards) or `0 0 20px rgba(var(--accent-rgb), 0.25)` for a soft halo.
- **Filled-button glow recipe:** `box-shadow: 0 3px 12px rgba(var(--accent-rgb), 0.4),
  inset 0 1px 0 rgba(255,255,255,0.18)` (utils, the biggest filled button). Smaller filled buttons
  scale it down: `.mfoot .save` uses `0 2px 10px … 0.35`, `.seg.active` uses `0 2px 8px … 0.4`. The
  **inset top highlight** `inset 0 1px 0 rgba(255,255,255,0.18)` is part of the filled-button look.
- **Drop-shadow filters** (`filter: drop-shadow(...)` / `--vapor-glow-filter`/`--danger-glow`) are for
  **mask icons** (no box), not boxes.
- **Focus glow (inputs):** `border-color: var(--magenta)` + `box-shadow: 0 0 0 1px var(--magenta),
  0 0 12px rgba(var(--accent-rgb), 0.3)` (or simply `var(--m-glow)` on compact rows).

---

## 5. Border-radius scale

| Radius | Used for |
|---|---|
| `999px` | Pills: `.seg`, `.switch .knob`, badges, the tiny toast. |
| `16px` (one corner `4px`) | Chat bubbles — the `4px` corner is the speaker "tail" (user: bottom-right; bot: bottom-left). |
| `14px` | Cards: `.util`, `.conf-card`. |
| `12px` | `.dev` rows, the waveform, command bubbles. |
| `8px` | Inputs, primary/footer buttons. |
| `6px` | Small inset chips: dropfoot buttons, code `<pre>`, result panels, download links. |

---

## 6. Spacing & layout

- Cards sit `14–16px` from the screen edges (`margin: 14px 16px`), rows `0 18px`.
- Card inner padding `12–14px`; row padding `10–12px`; min row height `52–56px`.
- Flex/grid gaps: `6–12px`. Footers (`.dropfoot`, `.mfoot`) use `gap: 6–8px`, `flex: 1` buttons.
- Section headers (`.sec`, `.conftitle`): tiny uppercase label + a `num` (magenta) + a trailing
  `linear-gradient(90deg, var(--line-2), transparent)` rule.
- Page bottom padding leaves room for the fixed tab bar + composer (`body` `116px`, `.no-composer`
  `80px`). Layer order (z-index): tabbar `12`, composer `11`, appbar `20`, toast `30`. Net-new
  overlays go above: toasts `40`, the confirm backdrop `50`.

---

## 7. Button taxonomy — match the closest one exactly

There are **four** button kinds in vapor. Pick the one whose role matches; copy its recipe.

1. **Primary filled** (one affirmative action): `135deg` magenta→violet fill, `#1a0428` text,
   uppercase `10px`/`ls 1.5px`/`weight 800`, radius `8px`, the filled-button glow (§4), `:active
   { transform: scale(0.96); filter: brightness(1.1); }`. → utils `.field button`, `.mfoot .save`.
2. **Footer choice buttons** (a row of options — the **dialog/form-footer** pattern, used identically
   in `.dev .dropfoot` *and* `.mconf .mfoot`): `all: unset; flex: 1; text-align: center; padding:
   8–9px 0; font-size: 9px; ls 1.8px; uppercase; weight 600; border: 1px solid var(--line-2);
   radius 6–8px; color: var(--ink-soft)`. `:active { background: var(--bg-3); color/border →
   var(--magenta) }`. **Danger variant is OUTLINE, not filled:** `.danger { color:
   rgba(var(--danger-rgb), .85); border-color: rgba(var(--danger-rgb), .3) }`, `:active → var(--red)`.
3. **Mask-icon action** (icon-only): a `width/height` box, `-webkit-mask` SVG, `background:
   var(--accent-grad)` (or `--danger-grad`), `filter: var(--vapor-glow-filter|--danger-glow)`, `:active {
   transform: scale(0.85–0.9) }`. → `.dev .act.*`, `.tts-btn`.
4. **Segmented / toggle** (`.seg`, `.switch`): pill track `--bg-3` + border; the active segment/knob
   gets the `135deg` fill + a small glow.

> **Vapor never renders a *filled red* text button.** Red appears only as: outline-red (footer
> `.danger`), red text/icon, a red mask-icon (`.act.stop`), or red badges. The single filled gradient
> is the magenta→violet primary. Honor this unless the owner explicitly opts out (see §11).

---

## 8. Inputs & fields

`all: unset; background: var(--bg-3); border: 1px solid var(--line|--line-2); radius 8px; padding
7–9px 10–12px; font: inherit; font-size: 11–12px`. Placeholder `--ink-faint`. Focus = the input
focus glow (§4). When an input butts a button (utils), the input squares its right corners
(`8px 0 0 8px`) and the button squares its left (`0 8px 8px 0`) — that shared seam is why a
standalone button should round **all four** corners.

---

## 9. Motion

Transitions are short: `0.12–0.2s` on `transform`/`filter`/`background`. Press feedback is a scale-
down: `:active { transform: scale(0.85–0.96) }` (smaller for icons, larger for text buttons).
Named keyframes already defined (reuse, don't invent): `spin`, `heartbeat` (LED), `shimmer` (hero
name), `ttsGlow`, `micrec`, eq-bar grow. Scrollbar is a `4px` magenta thumb; selection is magenta.

---

## 10. Theming (3 palettes) & the danger-color philosophy

`<body data-theme>` switches the palette by overriding the `:root` tokens. The three themes
(chat4): **Vapor** (magenta/violet/pink — the default, `data-theme="dark"`), **Aqua** (cyan/indigo,
cool ocean), **Ember** (amber/gold/coral, Miami sunset). *Everything* is themed via vars — not just
text/buttons but the skyline SVG gradient stops + window colors, the sun aura + stripes
(`--sun-stripe`), and the live ping waveform (reads `--accent-rgb` at draw time). When you add a
component, every glow/shadow must flow from `--accent-rgb` / `--accent-rgb-2` / `--danger-rgb` so it
tracks the theme — the owner explicitly rejected hardcoded glows ("button shadows/glow dont seem to
match the theme structure").

**The danger color is a deliberate per-theme decision — read this before styling anything red.**
The owner's explicit choice (chat4): destructive things (the `.act.stop` power-off icon, the active
mic) are **red in Vapor, crimson in Ember, but PURPLE/accent in Aqua** — *"for the aqua theme I want
them purple as they are right now for the vapor theme."* That is *why* `--danger-grad` /
`--danger-rgb` resolve to the **accent** (not red) under `[data-theme="aqua"]`. It is intentional,
not a bug. Consequences:

- To stay consistent with the established design, a new destructive control should use
  **`--danger-grad` / `--danger-rgb`** — giving red in Vapor/Ember and purple in Aqua, matching the
  list power-off button **in every theme**.
- `var(--red)` is the *only* token that stays red-family in all three (vapor `#ff3b7a`, aqua
  `#ff6b8e`, ember `#ff3b3b`). Use it **only** if a control must read red even in Aqua — but know
  that this deliberately *diverges* from the aqua power-off button. Flag it to the owner; don't pick
  it silently.

Always sanity-check a new component in **all three** themes before calling it done.

---

## 11. Net-new components (not in `vapor.html`)

Some v2 features have no prototype equivalent (e.g. activity **toasts**, the **confirm dialog** — vapor
has no full-screen modal; its only "dialog" is the inline `.mconf` form). Build these in
`theme/extras.css`, composing the tokens/recipes above. A net-new component is "on-theme" when every
color is a token, its buttons match a §7 recipe, its radii/spacing match §5/§6, and it holds up in all
three palettes. If the owner asks for something vapor never does, treat it as a deliberate,
documented extension — but still build it from the existing recipes so it reads as part of the
family. **Worked example — the confirm dialog (decided with the owner):** vapor only ever *fills*
the accent gradient, never a danger one. The owner chose **filled** danger buttons anyway, so the
dialog's two buttons share the §7-primary fill *exactly* (135° two-stop, 0.4 glow, inset, dark ink)
and the destructive one only swaps its hue source `--accent-rgb → --danger-rgb` — i.e. red in
Vapor/Ember, purple in Aqua (§10), matching the power-off button's per-theme hue. That's the
template for any future filled-danger control: reuse the primary recipe, swap the rgb token.

---

## 12. Component intent (decided in the design chats — constraints, not just looks)

These are the *resolved* decisions from `chats/chat1..5.md`. Honor them; they're where the owner
landed after iterating, and re-litigating them silently is the wrong move.

- **Composer** (chat1) — **one** shared composer, shown **only** on Fleet + Chat (hidden on Utils/
  Conf). There is **one** chat thread; replies from Fleet land in the same thread you read on Chat.
  Layout is `[ textarea ][ mic ][ send ]`: the textarea + mic share one `.field` (same `--bg-2`
  bg) so the mic reads as *inside* the input, and the focus glow is on the field via `:focus-within`
  (the whole input lights up as a unit). The send button is the magenta→violet **paper-plane**,
  flush to the composer's right with a 14px top-right corner matching the chrome. The composer bar
  has **rounded top corners (14px)** so it reads as "stickied to the bottom." Textarea auto-grows
  to a cap then **snaps back to one row** when cleared. Placeholder is just `ask anything…` — the
  `$` / `k:` / `o:` routing prefixes still work but are **deliberately unadvertised** (local models
  infer commands and surface them as green command bubbles). Mic = dictation only, send = send only
  (never crossed).
- **Appbar** (chat2) — brand on the left (logo lozenge + `ctrl·b` mark + `dashboard` meta), **TTS
  toggle on the right, and nothing else**. No clock, no theme toggle in the bar — **theme lives in
  Conf → Appearance**. The TTS button is an outline speaker **mask icon** (teal→violet fill, slow
  glow pulse when on; slashed-speaker + desaturated when muted), built like the composer mic.
- **Brand lozenge** (chat3) — the `logo.png` sits at 130% inside the circle so its edges clip under
  a 4px conic-gradient ring; **does not spin** by default. Conf → Appearance → "App mark" toggles
  **Logo** (default) vs **Ring** (the original spinning gradient ring, no logo).
- **Hero scene** (chat2/chat3) — retrowave sun that **floats ~5px** (bob) with ~5 themed translucent
  stripes that stay *visually static* relative to the sun (counter-animation cancels the bob).
  Skyline is a **City | Mountains** toggle (Conf → Appearance → "Horizon"), each a **multi-layer
  SVG** with atmospheric perspective (layers get darker toward the foreground) and neon ridge/edge
  outlines; all stops + window colors are theme vars. The equalizer is **8 bars**. The whole scene
  is lifted verbatim into `theme/heroScene.ts` — don't re-derive it; restyle via the tokens.
- **Fleet device row** (chat1/chat3) — tap to expand: services list (`.svc-row`, Phase 3) + a
  details strip (ip / mac / `ssh user@host:port` / os) + a dropfoot of footer buttons
  (`$ ping`, `› ssh`, and an `↗ http://<ip>` link that replaced the old inline shutdown — wake/stop
  live as the mask-icon buttons in the row header). Only the **featured** machine gets the bright
  magenta→violet left bar + glow; other awake machines get a **muted violet left bar (~35%)**.
- **Utils card** (chat1/chat3) — input + action button are **one flush unit** sharing an 8px radius
  (input rounds its left, button rounds its right). Tool glyphs are real icons **filled with the
  magenta→violet gradient** (mask + gradient bg), not white-on-a-box. Button text is `#1a0428`/800.
- **Themes** (chat4) — Vapor / Aqua / Ember, all fully tokenized incl. skyline + sun + waveform.
  See §10 for the danger-color philosophy (the one cross-theme subtlety that bites).

## 13. Pre-ship checklist for any component

- [ ] Every color is a token (no stray hex except `#1a0428` / `#fff` on gradients).
- [ ] Buttons match one §7 recipe exactly (gradient direction, glow alpha, inset highlight, text color).
- [ ] Radii from §5, spacing/gaps from §6, fonts per §2 (no Major Mono on prose/punctuation).
- [ ] Focus/press states present (input focus glow; `:active` scale).
- [ ] Verified in **vapor + aqua + ember**; anything that must be red uses `var(--red)` (§10).
- [ ] Lives in `extras.css` if net-new; `vapor.css` untouched.
