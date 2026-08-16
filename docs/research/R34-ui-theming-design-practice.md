# R34 — Theming, motion and UI/UX consistency: standard practice vs ctrl-b's shape

| | |
|---|---|
| **Date** | 2026-08-16 |
| **Question** | How do standard practice and comparable projects structure theming/design-token systems, motion/animation systems, and UI/UX consistency — and where does ctrl-b's theme-engine/UI design diverge from that field in ways that suggest an overlooked design flaw, inconsistency, or inefficiency? |
| **Method** | Read the ctrl-b side first (THEME_ENGINE.md §9.7/§14.4.1/§14.11/§14.14/§14.16/§15, VAPOR_PATTERNS.md, `frontend/src/theme-engine/**`, all `themes/*/tokens.css`, `tests/theme-engine/themeContract.test.ts`, `e2e/{a11y,contrast}.spec.ts`, plus measured CSS byte/token/duration counts from the working tree + `dist/`). Then read primary field sources: the W3C DTCG format module; Material 3's generated motion token file at HEAD; Open Props source; Home Assistant frontend source at `3e184ee` (2026-08-16) via the GitHub API; LibreChat `client/src/style.css` at `eaef87f` (2026-08-14); open-webui `src/{app.css,routes/+layout.svelte}` at `01f4282` (2026-07-27); Radix Themes + shadcn docs; Carbon's component checklist source; NN/g heuristic-evaluation articles; MDN `@scope` Baseline. No subagents. |
| **Reference class** | The README's in-class peers (open-webui, LibreChat, opencode) — **all three turned out to be near-empty on this question**, so the body of the pass is the *design-system* class (DTCG, Material 3, Radix Themes, shadcn, Open Props, Carbon) plus **Home Assistant frontend** and **VS Code**, which are the only real prior art for "an app with a user-swappable theme contract". HA is nominally out-of-class per the README's 2026-07-25 scope rule; it is included deliberately because the question ("how does a theme contract prevent a theme from breaking the app") has no in-class answer at all, and HA is the field's most-exercised implementation of exactly that contract. It is a supplement, not the body. |
| **Drives** | The owner's 2026-08-16 hardening charge → the UI/theming half of the design-review packet. No D-entry yet; §7 is a QUESTION list, not a verdict list. |

---

## 0. Verdict up front

**Three findings are load-bearing. The rest are questions.**

1. **ctrl-b has no motion token tier at all, and that is the one place where it is behind every
   single reference — including two in-class peers.** MEASURED: 63 distinct duration literals across
   147 timed declarations, and 6 distinct one-off `cubic-bezier()` curves of which 5 appear exactly
   once. Every reference in this dossier tokenizes duration and easing: the W3C DTCG spec makes
   `duration`, `cubicBezier` and `transition` first-class *types*; Material 3 ships 16 duration + 10
   easing tokens; Open Props ships ~45 easings; HA ships `--ha-animation-duration-{none,instant,fast,
   normal,slow}`; **LibreChat — an in-class peer — ships a block literally commented "transitions-dev
   tokens — semantic names shared by every t-\* class below"**. This is the field's single most
   uniform practice and ctrl-b is the only system here without it. THEME_ENGINE already lists
   centralization as an open item; the field evidence says it is not a nice-to-have, it is the
   default shape.

2. **ctrl-b's motion lever is a one-shot seed, so after first boot the OS reduced-motion signal is
   inert.** VERIFIED in `store/ui.ts:85-94`: `defaultMotion()` reads `prefers-reduced-motion` **once**,
   at first paint on a fresh install, and the comment says so. Every reference honours the media query
   **live** (HA re-declares all five duration tokens inside `@media (prefers-reduced-motion: reduce)`;
   LibreChat guards each motion utility with the same query). The §14.11 rule that banned the raw
   query is *correct about its bug* (the cosmos sheet that "wouldn't slide") but it fixed a
   two-signals problem by deleting the wrong one. The field's shape is: one signal, but the OS query
   feeds it **continuously** and the user toggle overrides. Combined with #1: a motion token tier
   would give ctrl-b HA's one-block reduced-motion collapse in place of the **31 `data-motion` gates
   in kit.css + 28 in gacha.css + 9 frontier + 4 cosmos + 10 vapor** it maintains by hand today.

3. **Where ctrl-b is genuinely ahead of the field, it is ahead in enforcement, not in architecture.**
   The `themeContract.test.ts` suite (token-list per theme, `showWhen` contract with deliberately
   broken fixtures, applyBodyAttrs leak check, registry↔contrast-matrix drift guard, warn-only OKLCH
   gamut scan), the custom `ctrlb/accent-fill-contexts` stylelint rule with its one-hop-alias hole
   closed, and the WCAG contrast gate that boots the real app per theme×mode×accent combo and probes
   *computed* colors — none of the peers has anything comparable, and Carbon (which does gate) gates
   with visual-regression screenshots rather than semantics. That capital is real; the questions in §7
   are about *what is not covered*, not about the harness being weak.

Not-flaws worth recording, so they are not re-litigated: the three-tier token model (§14.4.1) matches
the field consensus exactly; the `.kit` marker is verifiably the Radix Themes pattern; `@scope` is
genuinely Baseline as the doc claims (VERIFIED against MDN — "Since December 2025"); and the
D31 3-band routing rule (Tokens/Surface/Bespoke) has **no equivalent in the field at all** — no
reference system attempts structural theme variance, so ctrl-b is not diverging from a practice
there, it is operating past the edge of one.

---

## 1. The ctrl-b shape (ground truth, so the comparisons are honest)

All VERIFIED by reading the tree at `cdfd48d`.

**1.1 — Token contract: 21 required names, 3 tiers.** `theme-engine/kit/tokens.css` declares 23
custom properties as the neutral fallback set; `themeContract.test.ts`'s `CONTRACT_TOKENS` requires 21
of them from every non-waived theme (`--accent-ink` is conditionally required, the layout runtime vars
are excluded). Content: `--bg`, `--surface`, `--surface-2`; `--text`, `--text-2`, `--text-3`;
`--line`, `--line-2`; `--ok/-soft`, `--warn/-soft`, `--danger/-soft`; `--accent`, `--accent-fill`,
`--accent-soft`, `--accent-glow`, `--accent-ink`; `--font-body`; `--radius`, `--radius-sm`;
`--density-pad`.

**1.2 — What the contract does NOT contain.** No spacing scale. No type scale (no font sizes, weights,
line-heights). No elevation/shadow tokens. No border-width tokens. **No duration or easing tokens.**
No z-index tokens (the layer order is prose in VAPOR_PATTERNS §6). VERIFIED by grep: zero matches for
`--space`, `--gap-`, `--pad-`, `--size-`, `--fs-`, `--motion-`, `--ease`, `--dur-`.

**1.3 — Theme token counts.** `vapor` 24, `minimal` 25, `cosmos` 23, `frontier` 25 — i.e. the contract
plus one or two privates. **`gacha` 177** — the contract plus ~152 `--gc-*` privates
(`--gc-dossier-act-rim`, `--gc-cv-slip-ink`, …). One theme carries 7× the token surface of the other
four combined.

**1.4 — CSS mass.** `kit/kit.css` 6,136 lines in ONE file (53 `── section` banners, ~10 top-level
BUCKET banners); `gacha/gacha.css` 4,293 lines with **zero** banner sections; `frontier` 1,195;
`cosmos` 843; `vapor` 692+204. Built: the eager `index-*.css` is **122,887 B raw / 21,549 B gzipped**;
lazy per-theme chunks are gacha 42,722/9,173, frontier 14,193/3,615, cosmos 10,982/2,863.

**1.5 — Motion.** 63 distinct duration literals across 147 timed declarations; most common `0.2s`
(25) and `0.15s` (21). Six distinct `cubic-bezier()`s, five used once each:
`(0.16,1,0.3,1)`, `(0.2,1.25,0.35,1)`, `(0.22,1,0.36,1)`, `(0.25,1,0.4,1)`, `(0.32,0.72,0,1)`,
`(0.77,0,0.175,1)`. Gating is per-rule on `body[data-motion="reduced"]` (kit 31 · gacha 28 · frontier
9 · cosmos 4 · vapor-extras 10) and `body[data-perf]` (kit 34 · gacha 12 · cosmos 3 · frontier 3).

**1.6 — Color mechanics.** `color-mix()` is used throughout (kit 49, cosmos 24, gacha 24, frontier 9,
vapor 8). Relative color syntax (`rgb(from var(--x) …)`) is used **zero** times. Hand-maintained
`R, G, B` triplet tokens (`--accent-rgb`, `--accent-rgb-2`, `--danger-rgb`) survive in vapor only —
14 `rgba(var(--*-rgb), …)` reads plus two `getComputedStyle` reads in `Waveform.tsx`.

**1.7 — What a theme may do.** Everything. A theme ships a `tokens.css` (token-only, the norm), *may*
ship arbitrary CSS in `@layer theme` that overrides kit rules, *may* pin bespoke Surface variants, and
*may* replace the whole `Root`. §14.4.1's "law of co-application" documents two real bugs this
produced (the `.switch` knob that moved twice because kit animated `transform` and vapor set `left`;
the `.mini-player` that stopped yielding to the plan panel because a flat theme rule out-layered the
kit's `:has()` repositioner).

---

## 2. Design-token architecture — what the 2026 standard actually is

**2.1 — The W3C DTCG format reached its first stable version, and it types motion. VERIFIED.**
The Community Group announced the first stable release **2025-10-28** (v2025.10); the current editor's
draft I fetched is stamped "Draft Community Group Report 30 July 2026". The type list is:
`color`, `dimension`, `fontFamily`, `fontWeight`, **`duration`**, **`cubicBezier`**, `number`,
`strokeStyle`, `border`, **`transition`**, `shadow`, `gradient`. Composite types are "individual design
tokens whose values are made up of several sub-values"; aliasing is `"{colors.blue}"`, resolving to the
target's whole `$value`, "enabling semantic relationships between tokens".
→ **The standard's own type system says duration and easing are tokens.** Not a stylistic preference.

**2.2 — Three tiers is the consensus, and ctrl-b already implements it. VERIFIED, no divergence.**
- LibreChat (`client/src/style.css` @ `eaef87f`): primitive tier `--gray-800: 33 33 33` … then a
  semantic tier of ~90 names — `--surface-primary: var(--white)`, `--surface-secondary`,
  `--surface-hover`, `--surface-destructive`, `--border-light/-medium/-heavy/-xheavy`,
  `--text-primary` — then `.dark { … }` re-pointing the semantic names at different primitives.
- shadcn/ui (docs, REPORTED): semantic vars (`--primary`, `--background`, `--border`, `--ring`) in
  `:root`, dark values in `.dark`, exposed to utilities via `@theme inline`; OKLCH since Tailwind v4.
- Radix Themes (docs, REPORTED): 12-step color scales (`--red-1`…`--red-12`) with solid + alpha
  variants per accent, plus space/radius/shadow/typography scales and a `--scaling` factor.
- ctrl-b's §14.4.1 says "global (raw values, per theme) → semantic/alias (these names) → component
  (Kit CSS reads these)" and the code matches.
→ ctrl-b's *shape* is right. What differs is **coverage** (§2.3) and **breadth of the semantic tier**.

**2.3 — Everyone else's semantic tier is far wider than 21 names. VERIFIED.**
Home Assistant `src/resources/theme/core.globals.ts` @ `3e184ee`:
```
--ha-border-width-{sm,md,lg}                    (3)
--ha-border-radius-{sm,md,lg,xl,2xl…6xl,pill,circle,square}   (13)
--ha-space-1 … --ha-space-20                    (20, 4px step)
--ha-animation-duration-{none,instant,fast,normal,slow}       (5)
```
`typography.globals.ts` adds `--ha-font-size-{xs…5xl}` (9) built on a
`--ha-font-size-scale: 1` multiplier, `--ha-font-weight-{light,normal,medium,bold}` +
`{body,heading,action}` aliases, `--ha-line-height-{condensed,normal,expanded}`, and three font
families. Open Props ships `--size-1…--size-15` plus a parallel `--size-px-*` ladder. Carbon's
"definition of done" makes it a gate: *"Component styles use tokens available in the system.
Component styles do not contain magic numbers or colors that are not tokenized."*
→ ctrl-b tokenizes **color + radius + one density multiplier** and leaves spacing, type and motion as
literals. Carbon's rule would fail every ctrl-b stylesheet on the spacing/type/duration axes.

**2.4 — Runtime theme switching: everyone scopes by a root marker; nobody ships parallel component
trees. VERIFIED.**
- Radix Themes: a root `.radix-themes` class carries the tokens; the docs ship split
  `tokens.css` / `components.css` / `utilities.css` so consumers control import order; and overriding
  component styles is **explicitly discouraged** — *"Beyond simple style overrides, we recommend using
  the components as-is, or create your own versions using the same building blocks"*, with the advice
  that heavy overriding means you should reconsider whether Radix Themes fits.
- open-webui @ `01f4282`: theming is `const themes = ['dark','light','oled-dark']` plus `her`, applied
  by adding/removing a class on `document.documentElement`. That is the whole engine.
- HA: `applyThemesOnElement` builds a flat `Record<varName, value>` and calls
  `element.style.setProperty()` for each. A theme is a **map of variable names**. Full stop.
→ ctrl-b's `@scope ([data-skin=X])` + `.kit` marker is the same family and is arguably stricter
(scope isolation beats class scoping). The divergence is that ctrl-b's contract permits a theme to
ship *component CSS and structural DOM*, which Radix discourages and HA/VS Code make impossible.

**2.5 — HA solves the derived-token problem generically; ctrl-b solves it by authoring rule. VERIFIED.**
HA's `extractDerivedVars()` (`src/common/style/derived-css-vars.ts`) scans each globals stylesheet for
declarations whose value contains `var(`, and `processTheme()` merges `{...derivedStyles, ...theme}`
so **every derived token is re-declared at the same level as the theme's overrides**. That makes
"a formula token computed above where its inputs vary" structurally impossible.
ctrl-b hit the identical bug (minimal's OKLCH accent frozen at the default hue, §14.4.1 gotcha box)
and fixed it with a **rule for authors**: *"raw values → `:scope`; any token whose value is a `var()`
formula over a per-mode/per-accent input → `body`."* The rule is correct and the tests probe the
result (the contrast matrix boots the real app), but it is enforced by discipline where HA enforces it
by construction.

**2.6 — HA also auto-derives rgb triplets; modern CSS makes both approaches obsolete. VERIFIED.**
`processTheme()` emits `--rgb-<key>` for every hex token that lacks one. ctrl-b maintains
`--accent-rgb`/`--accent-rgb-2`/`--danger-rgb` by hand in vapor. Both are workarounds for a problem
CSS Color 5 relative syntax now solves — and ctrl-b uses `color-mix()` (114 sites) but
`rgb(from …)` **zero** times. Low stakes (14 read sites, vapor-only), recorded for completeness.

---

## 3. Motion system structure — the sharpest divergence

**3.1 — Material 3 tokenizes motion into a 2-D grid. VERIFIED** (read the generated source
`tokens/versions/v0_192/_md-sys-motion.scss` at material-web HEAD):
```
duration-short1..4      50 / 100 / 150 / 200 ms
duration-medium1..4    250 / 300 / 350 / 400 ms
duration-long1..4      450 / 500 / 550 / 600 ms
duration-extra-long1..4 700 / 800 / 900 / 1000 ms
easing-emphasized              cubic-bezier(0.2, 0, 0, 1)
easing-emphasized-accelerate   cubic-bezier(0.3, 0, 0.8, 0.15)
easing-emphasized-decelerate   cubic-bezier(0.05, 0.7, 0.1, 1)
easing-standard                cubic-bezier(0.2, 0, 0, 1)
easing-standard-accelerate     cubic-bezier(0.3, 0, 1, 1)
easing-standard-decelerate     cubic-bezier(0, 0, 0, 1)
easing-legacy / -accelerate / -decelerate / easing-linear
```
16 durations, 10 easings, both axes named. **Note the shape**: two *families* (emphasized vs standard)
× three *roles* (both-ends / accelerate-out / decelerate-in). The role split matters more than the
count: the direction of travel picks the curve.

**3.2 — Open Props tokenizes easing on a 1–5 intensity ladder. VERIFIED** (`src/props.easing.css`):
`--ease-1…5`, `--ease-in-1…5`, `--ease-out-1…5`, `--ease-in-out-1…5`, `--ease-elastic-*`,
`--ease-squish-*`, `--ease-step-1…5`, and `--ease-spring-1…5` expressed as `linear()` sampled curves.
Different philosophy from M3 (intensity ladder vs semantic role) — but the same conclusion: named, not
inline.

**3.3 — Home Assistant collapses motion at ONE choke point. VERIFIED** (`core.globals.ts`):
```css
--ha-animation-duration-none: 1ms;  --ha-animation-duration-instant: 75ms;
--ha-animation-duration-fast: 150ms; --ha-animation-duration-normal: 250ms;
--ha-animation-duration-slow: 350ms;
@media (prefers-reduced-motion: reduce) {
  html { /* all five re-declared → 1ms */ }
}
```
Five names, one media block, whole app respects reduced motion. Compare ctrl-b: **82 hand-written
`data-motion` gates** across five stylesheets, each of which is an individual opportunity to forget.
(Note HA collapses to `1ms` rather than `none` — animations still *fire* their `animationend`/
`transitionend` events, so JS that awaits a transition doesn't hang. ctrl-b's `data-motion` blocks are
worth auditing for the same hazard; two `0.001s` literals in the tree suggest the trick is known.)

**3.4 — An IN-CLASS peer already ships motion tokens. VERIFIED** — LibreChat `client/src/style.css`
@ `eaef87f`, verbatim comment: `/* transitions-dev tokens — semantic names shared by every t-* class
below. */`
```css
--resize-dur: 300ms;   --resize-ease: cubic-bezier(0.22, 1, 0.36, 1);
--icon-swap-dur: 200ms; --icon-swap-ease: ease-in-out; --icon-swap-blur: 2px;
--icon-swap-start-scale: 0.25;
--avatar-lift: -3px; --avatar-dur: 280ms; --avatar-scale: 1.04; --avatar-falloff: 0.45;
--avatar-ease-in: cubic-bezier(0.22, 1, 0.36, 1);
--avatar-ease-out: cubic-bezier(0.34, 3.85, 0.64, 1);
```
Two observations. (a) The tokens are named **per motion pattern** (`icon-swap`, `avatar`, `resize`),
not per abstract duration bucket — a middle path between M3's grid and nothing, and probably the
cheaper one for a small app. (b) Each pattern is a **named utility class** (`.t-icon-swap`,
`.t-avatar`) with its own `@media (prefers-reduced-motion: reduce) { transition: none !important }`
guard. Interesting for ctrl-b: `cubic-bezier(0.22, 1, 0.36, 1)` appears in **both** codebases
independently — it is the well-known "easeOutQuint" curve.

**3.5 — Reduced motion: the field treats the OS query as live input, not a seed. VERIFIED across
HA (media block), LibreChat (per-utility media guards), and M3/MDN guidance (REPORTED).** No reference
reads `prefers-reduced-motion` once and then ignores it. ctrl-b's `defaultMotion()` does exactly that,
by design and with an accurate comment. The §14.11 ban on a *second* raw-query rule remains right —
two independent gates is the bug that killed the cosmos sheet — but "one signal" and "live signal" are
independent properties, and ctrl-b currently has the first without the second.

---

## 4. Peer-project theming — what a theme is allowed to be

**4.1 — In-class peers: near-total NEGATIVE. Record this; it changes what "peer practice" can mean here.**
- **open-webui** @ `01f4282` (VERIFIED): four theme values, applied as classes on `<html>`;
  `oled-dark` maps to the `dark` class; `her` maps to `light`. Plus a `--app-text-scale` slider that
  multiplies `font-size` and a handful of sidebar dimensions. There is no token contract and no
  concept of a third-party theme.
- **LibreChat** @ `eaef87f` (VERIFIED): a real primitive→semantic→`.dark` token system (~90 semantic
  names) and the motion tokens above — but one visual identity, two modes. No theme registry.
- **opencode** (REPORTED, opencode.ai/docs/themes): themes are JSON with a `defs` section (reusable
  color refs) and a `theme` section (assignments), values may be hex, ANSI ints, refs,
  `{dark, light}` pairs, or `"none"` to inherit the terminal. The docs are explicit that themes are
  "purely color/token maps — they don't modify layout or structural elements".
→ **No in-class peer has a theme engine.** ctrl-b is the only one, which means "what do peers do" has
no answer for the interesting half of the question and the comparison must be made against HA/VS Code.

**4.2 — HA: a theme is a flat variable map, applied as inline style, and cannot touch DOM or CSS.
VERIFIED** (`src/common/dom/apply_themes_on_element.ts` @ `3e184ee`). The resolution order is exactly
three layers, and it is worth quoting the mechanism because it is the thing ctrl-b's contract lacks:
1. if dark: `themeRules = { ...darkSemanticVariables, ...darkColorVariables }`
2. `const { modes, ...baseThemeRules } = themes.themes[themeToApply]` → merged
3. `modes.dark` / `modes.light` → merged on top
then `processTheme()` prefixes each key with `--` and `element.style.setProperty()` writes it. Themes
are stored/served as YAML maps by the backend; the only escalation path in the HA ecosystem is a
*separate* extension mechanism (custom Lovelace cards / the third-party `card-mod`), not the theme
system. HA also tracks previously-set keys on `element.__themes.keys` so a theme switch **resets**
what the last theme set — the same leak class ctrl-b's `applyBodyAttrs` cleanup test covers.

**4.3 — VS Code: the same answer, harder. REPORTED** (code.visualstudio.com API docs). A color theme
is a JSON map of named theme colors contributed via `contributes.themes`; `workbench.colorCustomizations`
is "limited to color customization only" and cannot change layout or CSS. Different concerns get
different contribution points entirely (`themes` vs `iconThemes` vs `productIconThemes`).

**4.4 — The synthesis: the field prevents "theme breaks layout" by making it representationally
impossible, not by rules.** HA/VS Code/opencode: a theme is *data* (a map), so there is nothing to
override. Radix: a theme is tokens and overriding components is documented as a smell. ctrl-b: a theme
is *code* — a lazily-imported module with a `Root`, arbitrary `@layer theme` CSS and registry entries —
and the guard is a written law (§14.4.1's co-application rules) plus review. ctrl-b's power here is
deliberate and D31-ruled; the observation is only that **the two documented co-application bugs are
the predicted failure mode of the chosen design, and the field's mitigation is not available to us**,
so the mitigation has to be something else (see §7 Q6).

---

## 5. UI/UX consistency + evaluation practice

**5.1 — Heuristic evaluation's inconvenient number. VERIFIED (nngroup.com).** Nielsen's own theory
article: a **single evaluator finds only ~35%** of an interface's usability problems; three-to-five
find ~75%; five find ~85%; past five, diminishing returns. Severity is rated 0–4 (`0` = not a problem,
`1` cosmetic, `2` minor, `3` major, `4` catastrophe), and *"the mean of a set of ratings from three
evaluators is satisfactory for many practical purposes"*. The ten heuristics (last updated
2024-01-30) are: visibility of system status · match with the real world · user control and freedom ·
consistency and standards · error prevention · recognition rather than recall · flexibility and
efficiency of use · aesthetic and minimalist design · help users recognize/diagnose/recover from
errors · help and documentation.
→ Directly transferable to ctrl-b's situation: the method's own literature says **one reviewer is a
35% instrument**, which is the quantitative argument for the multi-agent review pattern already in
use (and for keeping the *independent* passes independent — the 35%→85% curve depends on evaluators
not sharing a prior).

**5.2 — Carbon's "definition of done" is the design-review checklist format that transfers.
VERIFIED** (carbon-website `src/pages/contributing/component-checklist/index.mdx`). Four status
tiers — `Draft` / `Preview candidate` / `Preview` / `Stable` — and per-tier requirement tables in four
groups. The row set:
*Design spec:* Color tokens · Type tokens · Structure and measurements · Interaction states ·
Behaviors · Accessibility.
*Code:* API guiding principles · Built to spec · Tokens · Globalization · Responsiveness · Storybook ·
Documentation · Fully Typed/JSDoc · Codemods · Unit testing · **Visual regression tests (VRT)** ·
Accessibility verification tests (AVT) · Screen reader/voiceover.
*Documentation:* Usage · Style · Code · Accessibility docs.
Two rows quote directly onto our situation:
- Tokens — *"Component styles use tokens available in the system. Component styles do not contain
  magic numbers or colors that are not tokenized."*
- Interaction states — *"Designs include specs for states such as hover, focus, selected, disabled,
  read-only, error, warning, etc."* (Note ctrl-b is a touch-first PWA: `hover` is largely inapplicable
  and `:active` is the real state — but "every control has a specified state set" is the transferable
  part, and VAPOR_PATTERNS §13 is already a mini version of this checklist for one theme.)
- VRT — *"Component has at least one test on the default story… Additional 'problematic' or highly
  concerning component states, stories, viewport-widths can be covered by VRT."* ctrl-b's §14.15.4
  backlog lists "screenshot diffing" under **reviewed and REJECTED**. That was a cost ruling; it is
  worth noting that it is the one row of Carbon's code checklist ctrl-b has explicitly declined, and
  that the reason (5 themes × modes × accents = combinatorial) is exactly the reason the WCAG contrast
  gate exists in its cheap non-project form. See §7 Q11.

**5.3 — Mobile navigation conventions. REPORTED (M3 guidelines via search; the m3.material.io pages
are JS-rendered and did not yield to fetch).** Navigation bars carry **3 to 5 top-level destinations**;
with three, show icon + label for all; with four, the active destination shows icon + label and
inactive ones show icons with labels where they fit; with five, labels only if space permits. Below a
compact width class the navigation bar is the pattern; at medium it is swapped for a rail (3–7
destinations). ctrl-b's tab sets are 4 (kit default) / 3 (frontier, gacha) / 2 (a frontier preset) —
inside the range at 3 and 4; the 2-tab preset is below M3's floor, where the convention would be a
different control (segmented button or a menu) rather than a nav bar. Also relevant: gacha renders a
`subLabel` second line under `lbl`, which M3's 4–5-destination guidance does not contemplate — an
intentional identity choice, flagged only because label-density is the thing M3 trims first.

**5.4 — Safe areas: HA tokenizes what ctrl-b computes inline. VERIFIED** (`main.globals.ts`). HA
declares `--safe-area-inset-{top,bottom,left,right}` (each `var(--app-safe-area-inset-*, env(safe-area-
inset-*, 0px))` — so a native wrapper can inject a value), plus derived `--safe-area-inset-{x,y}`,
`--safe-area-offset-*` for centring inside asymmetric insets, and `--safe-width`/`--safe-height` to be
used "instead of 100vw and 100vh". They also tokenize `--header-height: 56px`. ctrl-b has the same
class of runtime vars (`--app-h`, `--appbar-h`, `--composer-h`, excluded from the contract by
§14.13.1 Δ3) but no safe-area token family. On an Android PWA in Fennec/Chrome with gesture
navigation this is the layer that decides whether the tab bar clears the system gesture inset.

---

## 6. Implications for ctrl-b (my reading — ages faster than §1–§5)

- The **token contract is right-shaped and under-populated**. The three-tier model, the `.kit` marker,
  the `@scope` isolation and the two-channel accent (`--accent` colour vs `--accent-fill` image) are
  all field-correct, and the accent split is *better* than the field's usual single `--primary`. What
  is missing is not a different architecture, it is more tiers of the same one — and the missing tier
  the field is unanimous about is motion.
- The **cost of the missing motion tier is already being paid** in 82 hand-written `data-motion`
  gates and 63 duration literals. That is not a byte cost (irrelevant on a tailnet), it is a
  consistency-and-forgetting cost, and it grows per theme: gacha alone added 28 gates.
- **A motion tier is additive and cheap in the D31 sense.** It is squarely the Tokens band: a
  `--motion-*`/`--ease-*` set in `kit/tokens.css`, one reduced-motion collapse block, themes override
  values (a "snappy" theme vs a "weighty" one becomes a token edit rather than 28 rules). It also
  gives the R24 motion-grammar spec — already bought — somewhere to land.
- The **reduced-motion seed** is the only thing in this dossier I would call a latent correctness bug
  rather than a shape question, and it is a ~10-line fix (a `matchMedia` `change` listener that
  updates `motion` while the user has not explicitly overridden it) that must respect the existing
  one-signal rule, not reintroduce a second gate.
- The **theme-as-code power is a deliberate, ruled tradeoff** and the field offers no way to keep it
  and get the field's safety. The realistic mitigation is detection, not prevention: the co-application
  bug class is exactly what a per-theme render/VRT probe would catch, and it is the argument that could
  re-trigger the rejected screenshot-diffing entry — narrowly, at a handful of pinned states.
- **gacha's 152 private tokens are worth a look in both directions.** They may be a healthy escape
  hatch working as designed (a bespoke theme owning its own vocabulary), or a signal that the shared
  contract is missing names every theme silently re-invents (shadow/elevation, per-surface scrims).
  The tell is whether other themes have privates that *mean the same thing*.

---

## 7. The divergence list — questions for the design-review packet (SYNTHESIS, not verdicts)

Each is phrased as a question because none of them has been ruled. Evidence pointer in brackets.

**Q1 — Should motion become a token tier?** Every reference (DTCG types · M3 16+10 · Open Props ~45 ·
HA 5 · LibreChat per-pattern) tokenizes duration and easing; ctrl-b has 63 duration literals and 6
one-off curves. Which shape — M3's family×role grid, Open Props' intensity ladder, or LibreChat's
per-pattern naming (`--resize-dur`, `--icon-swap-ease`)? [§1.5, §3.1–3.4]

**Q2 — Should the OS reduced-motion query become a live input to the `motion` store rather than a
one-shot seed?** `defaultMotion()` reads it once at first boot; HA and LibreChat respond to it
continuously. Can this be done without reintroducing the two-gates bug §14.11 banned? [§1.5, §3.5,
`store/ui.ts:85`]

**Q3 — Would a duration-token tier let 82 per-rule `data-motion` gates collapse to one block?**
HA re-declares five tokens inside one media query and is done. If our gates also carry *structural*
changes (not just timing), how many are pure timing? [§1.5, §3.3]

**Q4 — Do our reduced-motion paths kill transitions in a way that breaks `transitionend` waiters?**
HA collapses to `1ms`, not `none`, so events still fire; we have two `0.001s` literals suggesting the
trick is known but not systematic — and the popover contract already depends on `transitionend`
(the react-dom `transitioncancel` gotcha in memory). [§3.3]

**Q5 — Should the semantic contract grow spacing / type / elevation tiers, or is 21 names correct for
a five-theme app?** HA ships 20 space + 13 radius + 9 font-size + 4 weight + 3 line-height; Carbon
gates on "no magic numbers". Counter-argument: our themes differ *by* their spacing rhythm, so a
shared scale could be the wrong abstraction. Which values are actually shared? [§1.1–1.2, §2.3, §5.2]

**Q6 — Given that a theme is code and cannot be made structurally safe, what is the *detection*
mechanism for the co-application bug class?** Two real instances are recorded (knob double-move,
mini-player veto); both were found by eyeball. The field's prevention (theme = data) is unavailable by
D31 design. [§1.7, §4.4, THEME_ENGINE §14.4.1]

**Q7 — Should derived-token correctness be enforced by construction rather than by authoring rule?**
HA's `extractDerivedVars` + merge makes the var-on-`:scope` trap impossible; we fixed the same bug
with a rule ("formula tokens on `body`") that a new theme author must know. Could the token-list
contract test also assert *where* a formula token is declared? [§1.1, §2.5, §14.4.1 gotcha box]

**Q8 — Is `kit.css` at 6,136 lines one file the right authoring unit?** Radix ships split
`tokens.css`/`components.css`/`utilities.css`; HA splits per concern (core/main/typography/semantic/
color/animations). Note this is an *authoring navigability* question, not a byte question — the byte
case was measured and closed (D51 V6). Note also `gacha.css` is 4,293 lines with **zero** section
banners while kit.css has 53. [§1.4]

**Q9 — Are gacha's ~152 `--gc-*` private tokens the escape hatch working, or 152 unpromoted contract
gaps?** The §15 rule is "promotion needs a second consumer". Do other themes carry privates that mean
the same thing (shadows, scrims, per-surface fills)? [§1.3]

**Q10 — Is the 2-tab frontier preset below the navigation-bar convention floor?** M3 puts nav bars at
3–5 destinations. At two, the field's control is a segmented button or a menu, not a bar. [§5.3]

**Q11 — Does the co-application bug class re-trigger the rejected "screenshot diffing" backlog item,
narrowly?** Carbon's stable gate requires VRT on at least the default story plus "problematic" states.
Our rejection was combinatorial cost — but a handful of pinned states × 5 themes is not the full
matrix, and the existing contrast gate already proves the cheap in-suite pattern. [§5.2, §14.15.4]

**Q12 — Should safe-area insets be tokenized?** HA ships a full family incl. `--safe-width`/
`--safe-height` and an override hook for a native wrapper. We are an Android-first PWA with a fixed
tab bar + composer; this is the layer that decides gesture-inset clearance. [§5.4]

**Q13 — Is the z-index/layer order (VAPOR_PATTERNS §6: tabbar 12, composer 11, appbar 20, toast 30,
toasts 40, confirm 50) prose that should be tokens?** It is the only remaining ordering contract
carried entirely in documentation, and it already reads as two overlapping generations. [§1.2]

**Q14 — Should the review method adopt severity ratings and the multi-evaluator target explicitly?**
Nielsen: one evaluator = ~35% of problems, five = ~85%; severity 0–4, mean of three ratings.
Our audit ledgers (SYS-#/F#/PR-#) carry findings but, as R33 also noted, not a uniform severity axis.
[§5.1]

**Q15 — Is the hand-maintained rgb-triplet pattern (`--accent-rgb`) worth retiring for relative color
syntax?** HA auto-derives `--rgb-<key>`; CSS Color 5 makes both unnecessary. 14 CSS reads + 2
`getComputedStyle` reads in `Waveform.tsx`, vapor-only. Low stakes — listed so it is a decision, not
an oversight. [§1.6]

---

## 8. What I could not determine

- **M3's own reduced-motion and navigation guidance at primary source.** `m3.material.io` renders
  client-side; the fetch returned only the page title. The nav-bar destination counts and the
  rail-swap breakpoint in §5.3 are **REPORTED** from search summaries of Google/Android docs, not read
  from the spec page. The motion tokens in §3.1 *are* VERIFIED — they came from the generated
  material-web source, not the doc site.
- **Radix Themes' exact CSS at HEAD.** The token-reference doc URL 404s; §2.4/§2.3's Radix lines are
  **REPORTED** from the styling/color/spacing doc pages and search summaries. I did not read
  `@radix-ui/themes`'s published `tokens.css` to count its scales or confirm whether it uses
  `@layer`.
- **opencode's theme code at HEAD.** The repo layout moved (`packages/tui/internal/theme` 404s at
  `fb8344f`); §4.1's opencode row is **REPORTED** from opencode.ai/docs/themes only.
- **Whether ctrl-b's 82 `data-motion` gates are pure-timing or mixed.** I counted occurrences, not
  their contents. Q3's collapse estimate depends on that split and I did not do the read.
- **Whether any theme's private tokens duplicate another's** (Q9). I counted per-theme token
  declarations; I did not diff their *meanings*.
- **Any dead-CSS measurement.** No coverage instrumentation was run, so "6,136 lines" is a size fact,
  not a liveness fact. Q8 is about authoring navigability precisely because I cannot speak to dead
  rules.
- **HA's community-theme failure modes in practice.** I read the apply mechanism, not the issue
  tracker; I cannot say how often a variable-only contract still produces broken layouts (e.g. a theme
  setting a radius token to something the layout cannot absorb).
