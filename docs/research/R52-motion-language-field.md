# R52 — A micro-animation language for small UI state changes: what the field actually prescribes and ships

**Date:** 2026-08-21
**Status:** Evidence dossier — complete for the bounded question. §8 is a **proposal for the main seat
to judge**, not a decision.
**What drove it:** [`ISSUES.md`](../ISSUES.md) **ISS-10** (owner, 2026-08-21, *"for the future maybe"*) —
composer icon swaps (mic → spinner, send → stop, mic-only → mic+send, recording chip on/off) cut
instantly today; the owner wants one consistent micro-transition language, and floated *"different
animations in a toggle in the settings"*.
**Drove:** (open) — no D-entry yet. Adjacent open work: [R34](./R34-ui-theming-design-practice.md) §3 +
§7 Q1–Q4 (the motion-token gap), HARDENING_PLAN Track D / DP-A.

**Confidence markers used on every finding:** **VERIFIED** = source read at the pinned SHA below, or
read first-hand in this repo. **REPORTED** = secondary source (docs, search result). **UNVERIFIED** =
expected but not checked.

---

## 0. Sources, pinned

| Project / spec | Ref | SHA | Read |
|---|---|---|---|
| material-components/material-web (M3) | main | `e7b4db67ab6e9adc6e4ad42f725ea288fe419be4` | 2026-08-21 |
| microsoft/fluentui (Fluent 2) | master | `b5ec47fc035849b21b35d6f6054d60c0a64ff3db` | 2026-08-21 |
| carbon-design-system/carbon (IBM Carbon) | main | `2377255936a46f641e530497452712f548ae31f0` | 2026-08-21 |
| danny-avila/LibreChat | main | `b4593f80b7ec0a5e3c0e3eb0f51941dd34349230` | 2026-08-21 |
| open-webui/open-webui | main | `01f4282f1ffe0d6212f58d3afbeae21fffd0c4be` | 2026-08-21 |
| lobehub/lobe-chat | main | `363797b1eddc01d1d6f07e28148b200618c2d0a2` | 2026-08-21 |
| lobehub/editor (LobeChat's `SendButton` lives here) | master | `15a1d23e99fc7b0c5f096dd8ca903adb8a29f39f` | 2026-08-21 |
| Mintplex-Labs/anything-llm | master | `c8bd6442e6b6eee8d08a761452960f7f77e334a9` | 2026-08-21 |
| aaif-goose/goose | main | `45b322c1df30295caaceb23a8a043fc9fa032527` | 2026-08-21 |
| microsoft/vscode (motion-settings precedent) | main | `1be2c3cf898d351d081002673c3c55e12f824ad9` | 2026-08-21 |
| mdn/browser-compat-data | main | `493cef41d0f0de67c5eafe2cf84413850cd4de90` | 2026-08-21 |
| Apple Developer docs (SwiftUI `Animation`, `ReplaceSymbolEffect`) | docs JSON API | fetched | 2026-08-21 |
| W3C `css-mediaqueries-5` ED | drafts.csswg.org | fetched | 2026-08-21 |
| ctrl-b working tree | `main` @ `f57afea` | — | 2026-08-21 |

Not re-bought (already in this folder): [R34](./R34-ui-theming-design-practice.md) §3 (the motion-tier
gap + HA's collapse block), [R15](./R15-view-transitions-glass-and-gecko.md) §B (Gecko VT cost scales
with group count), [R26](./R26-clipped-source-vt-morph.md) (same-doc VT verified on Gecko 151 +
Chromium 149), [R24](./R24-game-feel-web-techniques.md) §B (a full motion-grammar token spec for
*theme* motion).

---

## 1. Headline

**The blunt version the brief asked for: nobody in the reference class animates a composer glyph
swap, and the design systems' own toggle-icon-buttons don't either.** 6/6 peer chat apps cut
`send → stop` and `mic → spinner` instantly, and Material Web's `md-icon-button toggle` — the
component whose entire job is swapping one glyph for another — carries **zero** transition
declarations.

But the field is not silent, it is *split by element class*, and that split is the useful finding:

| What changes | What the field does | Numbers |
|---|---|---|
| A **glyph swapped inside a persistent control** | **Nothing** (6/6 peers, M3 icon-button) | — |
| A **small binary state** on a control (checkbox mark, switch handle, selection) | **Scale + opacity cross-fade**, direction-role easing | M3 150 ms out / 350 ms in; Fluent 200 ms symmetric |
| The **state itself while it lasts** (transcribing, generating) | **A continuous ambient animation** — this is where 6/6 peers spend their motion budget | 0.75 s–2 s infinite |
| A **control entering/leaving a row** | Mount-time pop or nothing | ctrl-b 150 ms; peers: nothing |

So the honest answer to ISS-10 is **not** "the field says don't". It is: *the field gives you no peer
precedent for animating the swap, gives you the exact primitive to use if you do (scale + opacity,
not blur, not morph, not View Transitions), gives you a tight duration band (100–200 ms), and warns
that the thing already carrying the meaning is the ambient state animation — the swap must not fight
it.*

The one structural gap that IS unanimous across every reference: **a named motion token tier.** M3,
Fluent, Carbon, Open Props, Home Assistant *and* an in-class peer (LibreChat) all ship one; ctrl-b
ships none (R34 §3.1–3.4, re-verified here at 2026-08 HEADs). That is the part of this dossier with
no counter-evidence.

---

## 2. Q1 — Design-system motion standards

### 2.1 The token scales, at HEAD

**Material 3 — 16 durations × 10 easings. VERIFIED**
(`tokens/versions/latest/sass/_md-sys-motion.scss`, generated, "Design system: Google Material 3,
Version: 34.0.21"):

```
short1 50ms   short2 100ms   short3 150ms   short4 200ms
medium1 250   medium2 300    medium3 350    medium4 400
long1 450     long2 500      long3 550      long4 600
extra-long1 700 … extra-long4 1000

easing-standard              cubic-bezier(0.2, 0, 0, 1)
easing-standard-accelerate   cubic-bezier(0.3, 0, 1, 1)
easing-standard-decelerate   cubic-bezier(0, 0, 0, 1)
easing-emphasized-accelerate cubic-bezier(0.3, 0, 0.8, 0.15)
easing-emphasized-decelerate cubic-bezier(0.05, 0.7, 0.1, 1)
easing-legacy                cubic-bezier(0.4, 0, 0.2, 1)
easing-linear                …
```

Shape: two **families** (standard / emphasized) × three **roles** (both-ends · accelerate-out ·
decelerate-in). *(Unchanged from R34's v0_192 read — the values are stable across ~6 months.)*

**Fluent 2 — 8 durations × 9 curves. VERIFIED**
(`packages/tokens/src/global/durations.ts`, `curves.ts`):

```
durationUltraFast 50ms   durationFaster 100ms   durationFast 150ms   durationNormal 200ms
durationGentle 250ms     durationSlow 300ms     durationSlower 400ms durationUltraSlow 500ms

curveEasyEase        cubic-bezier(0.33, 0, 0.67, 1)     ← the symmetric default
curveEasyEaseMax     cubic-bezier(0.8, 0, 0.2, 1)
curveDecelerateMin/Mid/Max  (0.33,0,0.1,1) / (0,0,0,1) / (0.1,0.9,0.2,1)
curveAccelerateMin/Mid/Max  (0.8,0,0.78,1) / (1,0,1,1) / (0.9,0.1,1,0.2)
curveLinear          cubic-bezier(0, 0, 1, 1)
```

Same structural shape as M3: **role (accelerate/decelerate/both) × intensity (min/mid/max)**.

**Carbon — 6 durations × 6 curves, and it is the only one that writes down what each duration is
FOR. VERIFIED** (`packages/motion/src/dtcg/motion.json`, DTCG-typed, `$description` verbatim):

```
fast-01      70ms   "Micro-interactions such as button and toggle. Instant response to user action."
fast-02     110ms   "Micro-interactions such as fade in. Subtle entrance or exit of small UI elements."
moderate-01 150ms   "Micro-interactions, small expansion, short distance movements. Default transition speed."
moderate-02 240ms   "Expansion, system communication, toast."
slow-01     400ms   "Large expansion, important system notifications."
slow-02     700ms   "Background dimming, large hero transitions."

easing.standard.productive  [0.2, 0, 0.38, 0.9]   easing.standard.expressive  [0.4, 0.14, 0.3, 1]
easing.entrance.productive  [0,   0, 0.38, 0.9]   easing.entrance.expressive  [0,   0,    0.3, 1]
easing.exit.productive      [0.2, 0, 1,    0.9]   easing.exit.expressive      [0.4, 0.14, 1,   1]
```

Carbon's axis names are `standard | entrance | exit` × `productive | expressive` — literally the
"role × family" shape M3 and Fluent express with different words. **Three independent systems, one
structure.**

**Apple. VERIFIED (API reference) / REPORTED (HIG prose).** Apple publishes no CSS-style token
grid. The concrete numbers its API reference does state:

- `Animation.easeInOut` — *"The `easeInOut` animation has a default duration of **0.35 seconds**."*
- `Animation.default` (iOS 17+) — a spring with **`response = 0.55`, `dampingFraction = 1.0`,
  `blendDuration = 0.0`**; prior to iOS 17 it was `easeInOut`.
- `.smooth` / `.snappy` / `.bouncy` — springs described by a *perceptual duration* + `extraBounce`,
  not a curve.

I could **not** read the HIG *Motion* page itself (JS-rendered; both the HTML and the
`/tutorials/data/…/motion.json` API path 404 for HIG paths). Marked **UNVERIFIED** — do not quote HIG
prose from this dossier.

### 2.2 What they actually apply to a SMALL component state change

This is the part that decides our design, and it is only visible in source.

**① M3's own toggle icon-button does NOT animate its glyph swap. VERIFIED.**
`iconbutton/internal/icon-button.ts:166-167` renders:

```ts
${!this.selected ? this.renderIcon() : nothing}
${this.selected ? this.renderSelectedIcon() : nothing}
```

— i.e. **the exact conditional-render swap ctrl-b writes** (`mic.status === "sending" ? <SpinnerIcon/>
: <MicIcon/>`), and `grep -c transition` across `_icon-button.scss`, `_shared.scss` and
`_filled-icon-button.scss` returns **0**. Material's answer for a swapped glyph is: don't.

**② Where M3 DOES animate a small binary state — the checkbox — the primitive is scale + opacity,
and it is enter/exit ASYMMETRIC. VERIFIED** (`checkbox/internal/_checkbox.scss:122-147, 210-234`,
verbatim):

```scss
.background, .icon {
  opacity: 0;                                        // fade in
  transform: scale(0.6);                             // scale from 60% to 100%
  transition-duration: 150ms, 50ms;                  // Exit duration for scale and opacity.
  transition-property: transform, opacity;
  transition-timing-function: easing-emphasized-accelerate, linear;
}
:where(.selected) :is(.background, .icon) {
  opacity: 1;
  transform: scale(1);
  transition-duration: 350ms, 50ms;                  // Enter duration for scale and opacity.
  transition-timing-function: easing-emphasized-decelerate, linear;
}
```

Read that carefully — it is a complete recipe: **scale 0.6 ↔ 1 with opacity cross-fade, enter 350 ms
`emphasized-decelerate`, exit 150 ms `emphasized-accelerate`, opacity always 50 ms linear.** Enter is
**2.33×** exit. It also carries a *disabled* escape hatch: `:where(.disabled, .prev-disabled) … {
animation-duration: 0s; transition-duration: 0s }` — motion is suppressed for a state change the user
did not cause.

**③ Fluent's switch is SYMMETRIC at 200 ms. VERIFIED**
(`react-switch/…/useSwitchStyles.styles.ts`): `transitionDuration: tokens.durationNormal` (200 ms),
`transitionTimingFunction: tokens.curveEasyEase`, same both directions, on both the track's
`background, border, color` and the thumb's `transform`.

**④ The reduced-motion collapse is a DURATION, not `none`. VERIFIED** — Fluent writes
`'@media screen and (prefers-reduced-motion: reduce)': { transitionDuration: '0.01ms' }` on *every*
motion rule; Home Assistant redefines all five duration tokens to `1ms` in one block (R34 §3.3).
Neither uses `none`, because a zeroed transition still fires `transitionend` and JS waiting on it
does not hang. **ctrl-b already knows this trick in one place** (`kit.css`
`body[data-motion="reduced"] .kit .kit-composer { transition-duration: 0.001s }`) and *not* in
others — see §7 ②.

### 2.3 The structural rule that makes motion read as "consistent"

Distilled from the three systems, in the order they'd rank it:

1. **A shared named scale.** Every reference has one; the count is 6–16 and the count does not
   matter. What matters is that no rule writes a raw literal.
2. **Easing is chosen by DIRECTION OF TRAVEL, not by taste.** `standard` (both ends visible) ·
   `decelerate`/`entrance` (arriving) · `accelerate`/`exit` (leaving). 3/3 systems name exactly these
   three roles. This is the single highest-leverage structural rule and it is the one ctrl-b's
   composer has zero of (all five composer transitions use the implicit `ease` default).
3. **Emphasis tiers** (M3 standard/emphasized, Carbon productive/expressive) — a second family for
   "this moment deserves weight". Optional at our scale; ctrl-b's per-theme fidelity (D7) already
   fills that role.
4. **Enter/exit duration asymmetry is NOT universal** — M3 does it (2.33×), Carbon splits the *curve*
   but not the *duration*, Fluent and LibreChat are fully symmetric. Do not treat it as a rule.

---

## 3. Q2 — Peer chat apps: do they animate composer icon/state swaps?

**Verdict: no. 6/6 cut the swap. And 3/6 have a motion library sitting in the tree unused for it,
so "we'd need a dependency" is a false premise in both directions.**

| Peer | `send ⇄ stop` | `mic ⇄ spinner` / recording | Motion lib in tree |
|---|---|---|---|
| LibreChat | **instant** — `SendButton`/`StopButton`/`DuringRunSendButton` are three separate components swapped by the parent; each carries `transition-all duration-theme-normal` (200 ms) which covers **colour/opacity only** | mic is a separate control; no glyph swap | `framer-motion@12`, `@react-spring/web`, `react-transition-group`, `tailwindcss-animate` |
| open-webui | **instant** — `{#if isActive && prompt === ''}` Stop `{:else}` mic/call/send; buttons carry bare Tailwind `transition` | recording **replaces the whole bar** with `VoiceRecording.svelte`, no enter/exit transition; transcribing = colour change + a 12-bar `step-end` spinner | none |
| LobeChat | **instant** — `if (generating) return <Button…><StopIcon/></Button>` early-return in `@lobehub/editor`'s `SendButton.tsx` | separate `VoiceMessage` surface | `motion@12`, `@formkit/auto-animate` |
| AnythingLLM | **instant** — `{isStreaming ? <StopGenerationButton/> : <SendPromptButton/>}`; `transition-all` = colour | **`{processing ? <CircleNotch animate-spin/> : <Microphone …/>}`** — the identical ternary ctrl-b writes | none |
| goose (desktop) | **instant** — `{isLoading && !hasSubmittableContent ? <Stop/> : <Send…/>}` | mic glyph never swaps; it gets `animate-pulse` while transcribing, plus a floating "Listening • Transcribing" chip that appears with **no** transition | `framer-motion@12`, `tailwindcss-animate`, `tw-animate-css` |
| Material Web (`md-icon-button toggle`, as the design-system control) | **instant** — 0 transitions in its stylesheets | — | — |

**VERIFIED, all six, by reading the render sites** (paths in §0's repos:
`client/src/components/Chat/Input/{SendButton,StopButton,DuringRunSendButton}.tsx` ·
`src/lib/components/chat/MessageInput.svelte:2265-2340` + `MessageInput/VoiceRecording.svelte` ·
`src/react/SendButton/SendButton.tsx` ·
`frontend/src/components/WorkspaceChat/ChatContainer/PromptInput/index.jsx:389-397` +
`…/SpeechToText/MicButton/index.jsx` · `ui/desktop/src/components/ChatInput.tsx:1780-1845`).

### 3.1 The one peer that ships an icon-swap utility — and where it puts it

**LibreChat has EXACTLY the utility ISS-10 describes, tokenized, and does not use it in the composer.
VERIFIED** (`client/src/style.css:83-129`, verbatim):

```css
/* transitions-dev tokens — semantic names shared by every t-* class below. */
:root {
  --icon-swap-dur: 200ms;  --icon-swap-ease: ease-in-out;
  --icon-swap-blur: 2px;   --icon-swap-start-scale: 0.25;
}
.t-icon-swap { position: relative; display: inline-grid; }
.t-icon-swap .t-icon {
  grid-area: 1 / 1;                          /* ← both glyphs stacked in ONE grid cell */
  transition: opacity var(--icon-swap-dur) var(--icon-swap-ease),
              filter  var(--icon-swap-dur) var(--icon-swap-ease),
              transform var(--icon-swap-dur) var(--icon-swap-ease);
  will-change: opacity, filter, transform;
}
.t-icon-swap[data-state='a'] .t-icon[data-icon='a'],
.t-icon-swap[data-state='b'] .t-icon[data-icon='b'] { opacity: 1; filter: blur(0); transform: scale(1); }
.t-icon-swap[data-state='a'] .t-icon[data-icon='b'],
.t-icon-swap[data-state='b'] .t-icon[data-icon='a'] {
  opacity: 0; filter: blur(var(--icon-swap-blur)); transform: scale(var(--icon-swap-start-scale));
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) { .t-icon-swap .t-icon { transition: none !important; } }
```

Its only consumers are `SidePanel/Agents/{AgentAvatar,AgentFooter,Advanced/AdvancedPanel}.tsx` — the
agent-builder panel, **not** the chat composer.

Two riders worth recording:
- **Provenance: these values are not LibreChat's own measurement.** The comment names
  `transitions-dev`, a third-party motion skill/pattern library; its public catalogue lists the
  pattern verbatim as *"Scale and blur icon swap"* (**REPORTED** — fetched transitions.dev landing
  page, which publishes the names but not the numbers). So `200 ms / ease-in-out / scale 0.25 /
  blur 2px` is one designer's recipe adopted wholesale, not a converged industry value. Weight it
  accordingly against M3's checkbox numbers, which *are* a design system's own spec.
- **`blur()` is a `filter`.** §14.11 bans `filter` in a *loop*; a 200 ms one-shot on a 16 px box is
  not that, but on Fennec it still forces an offscreen rasterization per frame of the transition. We
  get ~95 % of the read from `opacity + transform` alone. Recommend dropping it (§8).

### 3.2 LibreChat ALSO ships a per-theme, validated motion token — this is the closest peer precedent for our seam

**VERIFIED** (`packages/client/tailwind.preset.cjs`, `packages/client/src/theme/registry.ts`):

```js
transitionDuration: {
  'theme-fast':   'var(--theme-motion-fast, 150ms)',
  'theme-normal': 'var(--theme-motion-normal, 200ms)',
}
```
```ts
export const appearanceKeys = Object.freeze({ …, motionFast: '--theme-motion-fast',
                                                 motionNormal: '--theme-motion-normal' });
export const defaultAppearance = Object.freeze({ …, motionFast: '150ms', motionNormal: '200ms' });
const appearanceValidators = { …, motionFast: isDuration, motionNormal: isDuration };
```

Two durations, in the **theme definition**, **per-theme overridable**, with a `^\d*\.?\d+(ms|s)$`
validator. That is structurally the exact thing §8 proposes for ctrl-b's kit — and it means the
in-class field has already answered "should motion live in the theme contract?" with *yes, and two
names is enough to start*.

### 3.3 What peers DO animate at the composer: the state, not the swap

Unanimous, and it is where the meaning already lives. **VERIFIED, all values read from source:**

| Peer | Effect | Value |
|---|---|---|
| open-webui | 12-bar radial spinner while transcribing | `spinner_T6mA 0.75s **step-end** infinite`, graded opacity `.14 → 1` |
| LobeChat | stop glyph carries a rotating arc | SVG SMIL `<animateTransform type="rotate" dur="1s" repeatCount="indefinite">` |
| AnythingLLM | transcribing / listening | Tailwind `animate-spin` (1 s linear) / custom `pulse-glow 1.5s infinite` (scale 1→1.1 + `boxShadow` — would fail our §14.11) |
| goose | transcribing | Tailwind `animate-pulse` (2 s) on the mic glyph itself; a red/blue `animate-pulse` dot in the status chip |
| **ctrl-b** | transcribing / recording | `kit-spin 1s steps(8, end) infinite` (graded-opacity 8-bar) / `kit-tag-pulse 1.8s ease-in-out infinite`, opacity-only |

**Correction of a plausible premise:** ctrl-b is not behind here. Our spinner is the *same* graded-
opacity stepped-bar glyph open-webui ships (both descend from the `svg-spinners` set), at 8 steps/1 s
vs their 12/0.75 s, and our recording pulse is opacity-only where AnythingLLM's animates `boxShadow`.
The gap ISS-10 names is real but it is *only* the swap.

### 3.4 ChatGPT web and Claude.ai — NOT observed

**UNVERIFIED.** Both are login-walled SPAs with hashed, minified bundles; no fetchable source, and I
had no authenticated browser session to observe with. Web search returned only unrelated tutorials.
**Do not infer anything about them from this dossier.** If the main seat wants that data point, the
cheapest acquisition is 60 seconds of the owner's own screen recording, not another research pass.

---

## 4. Q3 — Implementation pattern for an in-place icon swap (React 18 + CSS, no deps)

### 4.1 The four candidates, scored

| Pattern | DOM cost | Interruption-safe? | a11y | Under `duration: 0` | Field use |
|---|---|---|---|---|---|
| **① Stacked glyphs, one grid cell, toggle `opacity`+`transform`** | +1 `<svg>` per swappable control (composer: +2 total) | **Yes** — CSS transitions interpolate from the *current computed* value, so a mid-flight reversal is smooth with no bookkeeping | Both glyphs already `aria-hidden`; the button's `aria-label` carries the state; add `pointer-events:none` to the inactive one | End state is a pure declarative style ⇒ correct, instantly | **LibreChat `.t-icon-swap`** (the only shipped instance found) |
| **② Keyed remount + enter keyframe** | 0 | **No** — a remount restarts the keyframe at 0 %; and there is no exit at all, so it reads as a *pop-in*, not a swap | fine | Needs its own gate (a keyframe ignores duration tokens unless it reads one) | **ctrl-b's own `kit-btn-pop`** (line layout) |
| **③ `@starting-style` (+ `transition-behavior: allow-discrete`)** | 0 | Partial — solves *enter*; *exit* still requires the node to stay in the DOM | fine | fine | none found in the peer class |
| **④ View Transitions API** | whole-document capture + a pseudo-element tree | Spec'd, but see below | fine | needs `data-motion` gating in JS | none found for a sub-button glyph |

**① is the field's standard and the recommendation.** It is also the *only* one of the four that
gives a true cross-fade (both glyphs visible mid-transition) without extra machinery.

### 4.2 Ruling on View Transitions for a sub-button glyph: **overkill, and specifically costly on our
browser pair**

- The *default* same-document View Transition **is** a cross-fade of old/new snapshots. So VT would
  produce visually **the same result** as ① — at the cost of a document-scoped capture.
- [R15](./R15-view-transitions-glass-and-gecko.md) §B established with a named mechanism that Gecko's
  VT jank scales with **group count**: the per-group UA `width`/`height` animation runs *main-thread
  layout per frame* (Bugzilla 2000047). Adding a named group for a 16 px glyph inside a 34 px button
  buys a main-thread layout animation to move nothing.
- Element-scoped VT (which would bound the capture) is **✗ on Gecko** per R15's BCD table.
- ctrl-b's existing VT use is a *layout morph* (theme switch, the gacha poster morph) — a genuinely
  document-scoped change. A glyph swap is the opposite case.

**Verdict: no. Keep VT for layout morphs; use ① for glyphs.** (Field view: 0/6 peers, 0/3 design
systems use VT for this.)

### 4.3 `@starting-style` is available to us if we ever want a mount-enter without a keyframe

**VERIFIED** from BCD at `493cef4`: `@starting-style` — Chrome **117**, Firefox **129**, Safari
**17.5**; `transition-behavior` — Chrome 117, Firefox 129, Safari 17.4 (android entries `mirror`
desktop). Fennec ships ≥ 151 in this repo's e2e matrix (R26), so both are safe. Noted as *available*,
not *recommended*: for the composer's mount cases we already own `kit-btn-pop`, and swapping a
working keyframe for `@starting-style` is a lateral move.

### 4.4 Apple's platform answer, as corroboration for ①

**VERIFIED** (`Symbols.ReplaceSymbolEffect` docs): Apple ships a first-class in-place glyph swap —
the **Replace** symbol effect — and it is **scale-based**: *"The initial symbol scales down as it's
removed, and the new symbol scales up as it's added"* (Down-Up), with `Off-Up` (no exit animation)
and `Up-Up` variants. Same primitive as M3's checkbox and LibreChat's `.t-icon-swap`. Three
independent lineages converge on **scale + fade**; none of them morphs paths, and none uses blur
except the third-party recipe in §3.1.

---

## 5. Q4 — Motion settings UX: is a multi-level motion setting a real pattern?

**Short answer: no. The field's third state is a SOURCE selector (`auto`), not an intensity level —
and the only per-effect knobs that ship are booleans for one specific expensive effect.**

**① The platform signal has two values, full stop. VERIFIED** (`css-mediaqueries-5` ED §12.1,
verbatim): `prefers-reduced-motion` — *"Value: `no-preference | reduce` · Type: discrete"*. There is
no intensity ladder to key off. §12.2 defines a **separate** `prefers-reduced-transparency` feature —
i.e. the spec itself models "less motion" and "less transparency" as two orthogonal levers, which is
exactly ctrl-b's `data-motion` + `data-perf` pair.

**② VS Code — the tri-state, and it is `auto`. VERIFIED**
(`src/vs/workbench/browser/workbench.contribution.ts:761-784`):

```ts
'workbench.reduceMotion': {
  enum: ['on', 'off', 'auto'], default: 'auto', tags: ['accessibility'],
  enumDescriptions: [ "Always render with reduced motion.",
                      "Do not render with reduced motion",
                      "Render with reduced motion based on OS configuration." ] },
'workbench.reduceTransparency': {
  enum: ['on', 'off', 'auto'], default: 'off', tags: ['accessibility'], … },
```

Note both the tri-state **and** the twin setting. ctrl-b's two levers are structurally identical to
VS Code's two; what we are missing is the **third value**, `auto` — and `auto` means *live OS query*,
which is precisely R34 §3.5's finding that our `defaultMotion()` reads `prefers-reduced-motion` once
at first boot and is inert thereafter. **One change fixes both.**

**③ In-class peers: 3/5 have no reduced-motion support at all. VERIFIED** (code search,
`prefers-reduced-motion`): open-webui **0** hits, LobeChat **0**, AnythingLLM **0**; LibreChat has
per-utility `@media` guards; goose has 2. **0/5 expose a user-facing motion setting of any kind.**

**④ The one user-facing motion toggle found in the class is a PER-EFFECT boolean. VERIFIED**
(open-webui `src/lib/components/chat/Settings/Interface.svelte:785-805`): a single `Switch` labelled
**"Fade Effect for Streaming Text"**, description *"Fade streaming text as it arrives."* That is the
field's shape for "let the user turn off the one animation that bothers them" — a named boolean for a
named effect, not a global intensity dial.

**Ruling for the owner's floated idea.** A `full / subtle / off` **intensity ladder has zero
precedent** in any design system or peer read here, and it is actively expensive for us: every one of
the 82 hand-written `data-motion` gates (R34: kit 31 · gacha 28 · frontier 9 · vapor 10 · cosmos 4)
would need a *third* branch, and every theme would have to decide what "subtle" means for its own
motion (D7 fidelity makes that 5 answers, not 1). What the field supports, cheaply:

- **`full | reduced | auto`** on the existing switch — one new value, `auto` = live `matchMedia`
  listener. Field-backed (VS Code), fixes the R34 seed bug, costs ~10 lines, zero new gates.
- **A named per-effect boolean** *if and when one specific effect annoys the owner* (open-webui's
  shape). Not speculative infrastructure — one switch, one effect, added on demand.

---

## 6. Q5 — Consistency audit seed: what animates in ctrl-b's composer today

Scope: the composer surfaces + small state flips attached to them. Theme-owned big motion (D7) is out
of scope by the brief. **All VERIFIED by reading `frontend/src/theme-engine/kit/kit.css` and
`kit/composer/*.tsx` at `f57afea`.**

### 6.1 The inventory

| # | Surface / state | Declaration | Duration · easing | Motion-gated? |
|---|---|---|---|---|
| 1 | `.kit-cbtn` (mic, tools) resting → hover/active/state | `transition: background 0.15s, color 0.15s, opacity 0.2s` | 150 / 200 ms · implicit `ease` | **no** |
| 2 | `.kit-cbtn.mic.press` press feedback | `transform: scale(0.92)` | **none — `transform` is absent from #1's list** | n/a |
| 3 | `.kit-cbtn.mic.rec` recording chip | `color` + `border-color` | fill fades (150 ms), **`border-color` snaps** (absent from #1) | n/a |
| 4 | `.kit-cbtn.mic.sending` transcribing chip (ISS-9) | `color` + `background` + `border-color` | same split as #3 | n/a |
| 5 | `.kit-cbtn.mic.sending svg` spinner roll | `animation: kit-spin 1s steps(8, end) infinite` | 1 s · `steps(8)` | ✔ `animation: none` |
| 6 | `.kit-send` | `transition: opacity 0.15s` | 150 ms · `ease` | **no** |
| 7 | `.kit-send.stop svg` glyph nudge reset | `transform: none` (vs `translate(-1px,1px)` on the arrowhead) | **no transition** | n/a |
| 8 | `.mic.rec` in sheet / line / glass | `animation: kit-tag-pulse 1.8s ease-in-out infinite` | 1.8 s | ✔ `animation: none` |
| 9 | **line** `.line-btn`, `.line-controls > *` mount pop | `animation: kit-btn-pop 0.15s ease-out` (scale .6→1 + opacity 0→1) | 150 ms · `ease-out` | ✔ **positive gate** `[data-motion="full"]` |
| 10 | `.kit .kit-composer` (whole bar hide/show) | `transition: opacity 0.2s ease, transform 0.2s ease, visibility 0.2s` | 200 ms · `ease` | ✔ `transition-duration: 0.001s` |
| 11 | `.kit-suggest`, `.tools-sheet` popovers | `transition: opacity 0.2s ease, transform 0.2s ease` | 200 ms · `ease` | ✔ `transition: none` |
| 12 | `.plan-pill .chev` | `transition: transform 0.16s ease` | **160 ms** · `ease` | no |
| 13 | `.plan-sheet`, `.plan-pin-drop` | `transition: opacity 0.2s ease, transform 0.2s ease` | 200 ms · `ease` | ✔ |
| 14 | `.priv-menu` | `animation: kit-navmenu-in 0.16s ease` | 160 ms · `ease` | ✔ |

**Every state SWAP in the table is instant** — #5 and #8 are ambient loops, #9 is a *mount*, and #1/#6
only cover colour/opacity. There is no cross-fade anywhere in the composer.

### 6.2 The numbers that name what would unify

- **4 distinct interaction durations** in composer scope for what is one family: `0.15s`, `0.16s`,
  `0.2s`, `0.001s`. (`0.16` vs `0.15` is a coin-flip nobody could defend.)
- **0 named easings.** 9 of the 14 rows use the implicit CSS default `ease` =
  `cubic-bezier(0.25, 0.1, 0.25, 1)`, one uses `ease-out`, two use `ease-in-out`. **No rule anywhere
  in the composer picks its curve by direction of travel** — the structural rule §2.3 calls the
  highest-leverage one.
- **3 different reduced-motion collapses** across 14 rows: `animation: none` (#5, #8),
  `transition: none` (#11), `transition-duration: 0.001s` (#10). Only the third is field-correct
  (§2.2 ④).
- **The only motion-ish tokens in the whole frontend are gacha-private**: `--gc-ease-out:
  cubic-bezier(0.16, 1, 0.3, 1)` (easeOutExpo), `--gc-ease-spring: cubic-bezier(0.2, 1.25, 0.35, 1)`,
  `--gc-figure-dur` (`themes/gacha/tokens.css:65-66`). Under THEME_ENGINE §15's promotion rule ("a
  private is promoted at its second consumer"), a kit-level easing set would be exactly that second
  consumer.
- Whole-tree context, from R34 §1.5 and not re-measured here: **63 distinct duration literals across
  147 timed declarations · 6 one-off `cubic-bezier`s · 82 hand-written `data-motion` gates.**

### 6.3 The two swaps' React shapes (what a fix has to work with)

- **Stacked** (`KitComposer`): send and mic are both permanently mounted; only the child SVG changes
  (`isStreaming ? <StopSquareIcon size={20}/> : <SendArrowheadIcon size={20}/>`,
  `mic.status === "sending" ? <SpinnerIcon/> : <mic path>`). **Nothing animates in this layout at
  all** — including the mic+send case, since both buttons always exist.
- **Sheet**: same, at sizes 26/24.
- **Line**: mic and send are *conditionally mounted* (`showMic = sttReady`,
  `showSend = !sttReady || draft !== "" || isStreaming`), so a mount fires `kit-btn-pop` — this is
  the one animation ISS-10 points at. On `isStreaming` the send button **stays mounted** (the class
  flips to `.stop`), so the send→stop glyph still cuts even in `line`.
- **Hazard for a stacked-glyph fix:** the arrowhead's optical nudge is keyed on the *button*
  (`.kit-send.line-btn svg` / `.tall svg` / glass) and neutralised by `.kit-send.stop svg { transform:
  none }`. With both glyphs mounted simultaneously the `.stop` class no longer discriminates *which*
  SVG — the nudge must move onto a per-glyph hook, or the transition will also animate a 1 px slide
  on every swap.

### 6.4 A non-risk worth recording (ATAM sense — a good decision on an implicit assumption)

R34 §7 Q4 asked whether our reduced-motion paths break `transitionend` waiters. **For the composer,
they don't, and it was deliberate:** `useComposerSuggest.ts:30-34` and `SuggestPopover.tsx:57-88`
carry an explicit synchronous release path for exactly the case where `transition: none` means no
event ever fires, plus a `transitioncancel` branch for mid-exit displacement. `BottomSheet.tsx:173`
independently chose a duration+slack timer over `transitionend` *because* of the `0.001s` collapse.
Two surfaces, two correct answers, both hand-maintained — which is the cost of not having a choke
point, not a bug.

---

## 7. Q6 — Bounded open sweep (3, same bar)

**① `.kit-cbtn` omits `border-color` and `transform` from its transition list, so half of "the swaps
cut instantly" is already a plain omission. VERIFIED** (`kit.css:601`,
`transition: background 0.15s, color 0.15s, opacity 0.2s`). Consequences: the recording ring (`.rec`,
`border-color: color-mix(… danger 40%)`) and the ISS-9 transcribing chip (`.sending`, `border-color:
… accent 45%`) **snap** while their fill and ink fade over 150 ms — a visible two-speed state change
on the same 32 px button; and `.mic.press { transform: scale(0.92) }` snaps in *both* directions,
which contradicts `VAPOR_PATTERNS.md` §9's own house rule (*"Press feedback is a scale-down …
Transitions are short: 0.12–0.2s on transform/filter/background"*). **This is the cheapest item in
the whole dossier: two property names.**

**② The reduced-motion collapse has no choke point, and R34's "82 gates would collapse to one block"
is over-optimistic — a correction.** A token-level `1ms` redefinition (HA's pattern) collapses every
rule that *consumes* a duration token. It does **not** cover infinite ambient animations
(`kit-spin`, `kit-tag-pulse`): a 1 ms infinite spin is worse than no gate, so those keep their
per-rule `animation: none`. Nor does it cover positive gates like #9's `[data-motion="full"]`. Honest
estimate for the composer subset: a token tier would fold rows 1/6/10/11/12/13 into one block and
leave 5/8/9 hand-gated — i.e. **the collapse is real but partial, roughly the timing-only majority.**
Worth restating in DP-A before anyone budgets against R34's number.

**③ "Adding motion needs a dependency" is false, and so is "the peers all do it".** 3/6 peers ship
`framer-motion` / `motion` / `@react-spring/web` in the tree (LibreChat, LobeChat, goose) and **still
cut the composer swap**; the one peer that built an icon-swap utility built it in **~30 lines of
plain CSS** with no library. Both the pro-dep and the pro-animation arguments-from-authority fail.
CSS-only remains the correct prior, and the field is neutral-to-negative on the feature itself — the
case for doing it is the owner's taste, which is a legitimate reason, but it should be *named* as
that rather than dressed as field practice.

---

## 8. §Recommendation — a proposal for the main seat, not a decision

Framed against our seams. Nothing here is a ruling; §8.5 lists what I'd cut first.

### 8.1 A minimal kit-level motion vocabulary (Tokens band, D31; theme-overridable per D7)

Three durations and three easings — the smallest set that satisfies §2.3's rules 1 and 2. Values are
picked where M3 / Fluent / Carbon / LibreChat **already agree**, and where possible are *our current
literals*, so the first commit is a rename, not a re-timing.

```css
/* frontend/src/theme-engine/kit/tokens.css */
:root {
  /* durations — the field's micro-interaction band (M3 short2/3/4 · Fluent Faster/Fast/Normal ·
     Carbon fast-01→moderate-01). --dur-2 is already the composer's dominant literal. */
  --dur-1: 100ms;   /* instant feedback: press, hover, a chip's fill/ink/edge */
  --dur-2: 150ms;   /* THE default micro-transition: glyph swap, control enter/exit */
  --dur-3: 200ms;   /* the composer bar, popovers, sheets */

  /* easings — chosen by DIRECTION OF TRAVEL (M3 standard family; Carbon's entrance/exit split) */
  --ease-std: cubic-bezier(0.2, 0, 0, 1);   /* both ends visible — the default */
  --ease-in:  cubic-bezier(0.3, 0, 1, 1);   /* leaving  (accelerate / exit) */
  --ease-out: cubic-bezier(0, 0, 0, 1);     /* arriving (decelerate / entrance) */
}
body[data-motion="reduced"] {
  --dur-1: 1ms; --dur-2: 1ms; --dur-3: 1ms;   /* 1ms, NOT none — `transitionend` still fires (§2.2④) */
}
```

Why these exact choices:
- **3 durations, not 16.** M3's 16 exist because M3 spans phone-scale hero motion; our micro-scope
  needs the 100/150/200 band and nothing else. LibreChat, an in-class peer at our size, ships **2**.
- **`--dur-2: 150ms`** — Carbon calls 150 ms *"Default transition speed"*; Fluent's `durationFast` is
  150; LibreChat's `--theme-motion-fast` is 150; it is already our composer's most common literal.
- **`--ease-std` over the implicit `ease`.** `ease` = `cubic-bezier(0.25,0.1,0.25,1)`, which eases
  *in* at the start — for a state change that should feel like an immediate response to a tap, all
  three systems front-load the motion instead (M3 `(0.2,0,0,1)`, Carbon `(0.2,0,0.38,0.9)`,
  Fluent `(0.33,0,0.67,1)`). This one substitution changes the *feel* of every existing composer
  transition for free.
- **Per-theme override** is the LibreChat-verified shape (§3.2): a theme's `tokens.css` may
  re-declare any of the six. gacha's `--gc-ease-out`/`--gc-ease-spring` become overrides of
  `--ease-out` rather than privates (§15 promotion, §6.2).
- **Naming** deliberately avoids `--motion-*` so nothing reads as coupled to the `data-motion`
  attribute.

### 8.2 The two primitives, and which composer change gets which

The composer has **two distinct classes** of change and today conflates them. Name both:

**SWAP** — a glyph exchanged inside a control that persists. New, ~15 lines of kit.css:

```css
.kit-glyph { grid-area: 1 / 1; transition: opacity var(--dur-2) var(--ease-std),
                                           transform var(--dur-2) var(--ease-std); }
.kit-swap  { display: inline-grid; }                 /* both glyphs, one cell — LibreChat's shape */
.kit-glyph[data-on="false"] { opacity: 0; transform: scale(0.7); pointer-events: none; }
```

- **Opacity + transform only** — no `filter: blur()`. §14.11-clean by construction, and it drops the
  one part of LibreChat's recipe that has no design-system backing (§3.1).
- **`scale(0.7)`, not M3's 0.6 or LibreChat's 0.25.** At 16–26 px a glyph scaled to 0.25 has already
  vanished before the fade does any work; 0.7 keeps the cross-fade legible at our sizes. **This value
  is a judgement, not a measurement** — it is the one number in this section that wants an owner
  eyeball (§8.4).
- **Symmetric**, per Fluent/LibreChat. M3's 2.33× enter/exit asymmetry is an *emphasized*-family
  choice for a 20 px checkbox that is the screen's subject; our glyph is not.

**ENTER/EXIT** — a control joining or leaving the row. Already exists: `kit-btn-pop`. Retokenize it to
`var(--dur-2) var(--ease-out)` (arriving ⇒ decelerate) and leave its positive `[data-motion="full"]`
gate alone.

**Application table:**

| ISS-10 case | Primitive | Rule | Note |
|---|---|---|---|
| `send ⇄ stop` (all 3 layouts) | **SWAP** | stack `SendArrowheadIcon` + `StopSquareIcon` | **Move the arrowhead's optical nudge onto a per-glyph hook first** (§6.3) or it animates a 1 px slide |
| `mic ⇄ spinner` (all 3 layouts) | **SWAP** | stack the mic path + `SpinnerIcon` | Gate `kit-spin` to the ACTIVE glyph — a compositor animation on an `opacity:0` node is wasted work (§14.11 "pause when nothing can see it") |
| `mic-only → mic+send` (line only) | **ENTER** | existing `kit-btn-pop`, retokenized | An *exit* would need an animated width ⇒ layout thrash ⇒ **don't**. Field precedent: peers ship no exit either |
| recording chip on/off (`.rec`) | **STATE TINT** | add `border-color` to `.kit-cbtn`'s list at `--dur-1` | Sweep item §7 ① |
| transcribing chip (`.sending`, ISS-9) | **STATE TINT** | same | same |
| press (`.press`) | **STATE TINT** | add `transform var(--dur-1) var(--ease-std)` | Closes the `VAPOR_PATTERNS` §9 violation |

### 8.3 Where the reduced-motion gate bites

- **The token block in §8.1 is the choke point** for rows 1/6/10/11/12/13 of §6.1 plus both new
  primitives — one block, no new hand-written gates. It also *removes* the `transition: none` on
  `.kit-suggest` (row 11) in favour of `1ms`, which is the field-correct collapse and would make
  `SuggestPopover`'s synchronous-release branch belt-and-braces rather than load-bearing. **Do not
  delete that branch** — `displaced` still snaps to `transition: none` via the overlay handoff, so
  the branch keeps a real job.
- **The two infinite ambient animations keep their own `animation: none` gates.** A 1 ms infinite
  spin is a pathology (§7 ②).
- **The SWAP primitive degrades correctly at `1ms`** because its end state is a pure declarative
  style — the inactive glyph is `opacity: 0` regardless of duration. No JS, no keyframe, nothing to
  latch. This is the property that makes ① the right pattern and ② the wrong one.

### 8.4 What still needs the owner, not more research

1. **The `scale(0.7)` value** and whether a 150 ms cross-fade reads as "considered" or as "laggy" on
   the send button — the acceptance for anything in §8.2 is the usual Fennec + Chrome device round at
   390 px, not a test.
2. **Whether to do this at all.** The field gives no peer precedent (§1); the case is taste. That is
   a fine reason — it should just be stated as one.
3. **The settings question (§5):** `full | reduced | auto` (VS Code's shape, ~10 lines, also fixes
   R34's one-shot-seed finding) vs. the status quo. An intensity ladder is not recommended.

### 8.5 If this gets cut down, cut in this order

The items are independently shippable and their value/cost ratios differ by an order of magnitude:

1. **§7 ① — add `border-color` and `transform` to `.kit-cbtn`'s transition list.** Two property
   names; fixes a visible two-speed state change and a house-rule violation; needs no tokens, no new
   DOM, no design ruling. *Ship this regardless of what happens to the rest.*
2. **§8.1 — the token tier alone**, with every existing composer rule rewritten to consume it. Pure
   rename + one collapse block; no behaviour change except `ease → --ease-std`; closes the one gap
   the field is unanimous about (R34 §7 Q1); lands DP-A's motion question.
3. **§8.2 SWAP on the mic ⇄ spinner pair only.** Highest-frequency swap the owner actually sees on a
   phone, and the least likely to fight the send button's optical nudge.
4. **§8.2 SWAP on send ⇄ stop.** Wants the nudge refactor (§6.3) first.
5. Everything else.

---

## 9. What I could not determine

- **ChatGPT web and Claude.ai composer motion** — not observed at all (§3.4). The two most-used
  reference points in the class are a hole in this dossier.
- **Apple HIG *Motion* page prose** — the page and its docs-JSON path are not fetchable; only the
  SwiftUI/Symbols **API reference** numbers in §2.1/§4.4 are VERIFIED. Nothing in this dossier quotes
  HIG guidance.
- **Whether LibreChat ever considered `.t-icon-swap` for the composer** — I read the code, not the
  issues/PRs. The absence may be deliberate or may be that nobody got to it.
- **Any measured frame cost** of a stacked-glyph cross-fade on Fennec/Chrome Android. Zero device
  numbers here; §8.4 ① is the acceptance. (Prior art suggests it is free — it is two composited
  properties on a ≤26 px box — but that is reasoning, not measurement.)
- **Whether `--dur-1/2/3` is the right *count*.** LibreChat ships 2, HA 5, Fluent 8, M3 16. I picked 3
  by argument, not by trying it.
- **Exact `transitionend`-hazard audit outside the composer.** §6.4 covers the two composer-adjacent
  waiters; the other three stylesheets' 51 `data-motion` gates were out of scope by the brief.
