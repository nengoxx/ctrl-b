# R15 — View Transitions: frosted glass through a capture (Blink) · same-document VT cost on Gecko mobile

> *(Commissioned under the working name "R12"; renamed to R15 on indexing — `R12` was already
> [`R12-tailscale-presence.md`](./R12-tailscale-presence.md).)*

| | |
|---|---|
| **Date** | 2026-08-06 |
| **Pass** | Desk research (spec text · engine source · bug trackers · vendor docs). The desk pass could not run a device probe; the owner ran §7.1's four-case probe on 2026-08-06 and its **results are folded in at §7.1** (they settle Question A and kill option A1). |
| **Question** | (A) Can a `backdrop-filter` app bar keep blurring *through* a same-document View Transition on Blink, and what does the field do about it? (B) Why did Gecko/Fennec get "clunky and glitchy" when the gacha tab flight grew from one group to three, and what should the Gecko path be? |
| **Reference class** | This is a **web-platform engine question**, not a peer-app question — the README's peer class (opencode/open-webui/LibreChat/…) does not ship glass-chrome View-Transition choreography, and a search for it returned nothing usable (§6 records that as a negative finding). The sources used are the primary ones for this class: the CSS WG spec source, Blink C++ source, Bugzilla/crbug, WPT, and the Chrome/Mozilla vendor docs. |
| **Drove** | **G6.6** (gacha, v1.5.0) — the tab flight re-composed onto ONE root group, both engines, no engine branch (option **A3 ≡ B1**; owner ruling 2026-08-06 off the §7.1 probe). |
| **Our code under discussion** | `frontend/src/themes/gacha/gacha.css` (the M2 block, lines ~577–720; the bar rules ~94–207) · `frontend/src/lib/viewTransition.ts` |

**Confidence key** — **VERIFIED** = read the primary source (spec text, engine source, bug comment, BCD
record) myself in this pass · **REPORTED** = a secondary source or a bug reporter says so ·
**UNVERIFIED** = expected/derived but not checked, or needs a device.

---

## 0. TL;DR (the four things that change a decision)

1. **VERIFIED — the "backdrop-filter is copied onto the group" mechanic is real, is spec'd twice
   over, and Blink implements it.** It is in the spec's *capture*, *keyframes* **and** the per-frame
   *group styles rule* (§2.1), and Blink's `ViewTransitionStyleTracker` lists
   `CSSPropertyID::kBackdropFilter` in both `kPropertiesToCapture` and `kPropertiesToAnimate`, then
   writes the captured properties into the **static** `::view-transition-group(tag){…}` rule (§2.2).
   **Corollary that clears our own code of a suspicion: our `animation: none` on
   `::view-transition-group(gacha-appbar)` does NOT strip the group's `backdrop-filter`** — that
   property arrives via `AddContainerStyles`, not via the keyframes.
2. **VERIFIED — the spec makes every named element a *backdrop root*** (`css-view-transitions-1`
   §"Rendering Consolidation"). That is the sentence that governs glass: a blur can only ever sample
   what is inside its own backdrop root, and naming an element (or capturing it) plants a boundary.
   **The platform has exactly two compositions where chrome-glass survives a flight: (a) the bar and
   the content it blurs are in the SAME snapshot, or (b) the bar is OUTSIDE the transition entirely
   (element-scoped VT, Chrome 147+).** Everything else is a workaround.
3. **REPORTED, and it contradicts our CSS comment's engine attribution:** the only field bug report
   on exactly this symptom is **against Firefox, saying Chrome is fine** — Bugzilla 1999295,
   2025-11-10: *"When using the view transition API, backdrop filters seem to be disabled while the
   transition is running. This is not the case in Chrome."* Our `gacha.css` G6.4 comment asserts the
   copy works on "Chromium + Gecko"; the owner's device says Blink drops it and Gecko doesn't. At
   most one of those three statements is right for a given composition. **SETTLED by the §7.1 probe
   (2026-08-06): none of them. A NAMED bar double-applies its blur on BOTH engines; an unnamed one is
   clean on Chrome; Gecko degrades it in every composition.**
4. **VERIFIED — the Gecko jank has a named, citable mechanism, and it scales with the NUMBER OF
   GROUPS.** Every `::view-transition-group` runs a UA-generated `width`/`height` animation. Chrome's
   own docs: *"Animating width and height, as happens here on the `::view-transition-group`, is
   generally frowned upon in web performance circles as it runs layout per frame. However, for View
   Transitions, we plan to optimize it so it can run off the main thread in most cases."* Chrome
   built that optimization; **Gecko has not** (Bugzilla 2000047, filed by dholbert *because* Bramus
   described Chrome's version — profile attached showing the refresh driver ticking every 16 ms).
   And dholbert, same bug: *"In Firefox, when random-synthetic-jank happens… the animation seems to
   immediately snap to the end; whereas in Chrome release, the animation pauses for the duration of
   the jank."* **Main-thread animation per group + snap-to-end under jank = "clunky and glitchy",
   and it appeared exactly when we went from one group to three.**

---

## 1. Ground truth on versions (VERIFIED — MDN browser-compat-data, read from `mdn/browser-compat-data` @ 2026-08-06)

| Feature | Chrome / Chrome Android | Firefox / Firefox Android | Safari |
|---|---|---|---|
| `Document.startViewTransition` | **111** | **144** | 18 |
| `view-transition-name` | 111 | **144** | 18 |
| `document.activeViewTransition` | 142 | 147 | 26.2 |
| `view-transition-group` (**nested groups**) | **140** | ✗ not supported | ✗ |
| `view-transition-scope` | 147 | ✗ | ✗ |
| **`Element.startViewTransition`** (**element-scoped VT**) | **147** | ✗ | ✗ |

*(`chrome_android` / `firefox_android` are `"mirror"` in BCD — i.e. same version as desktop. So
element-scoped VTs ARE available on Chrome Android 147+.)*

- **VERIFIED** Firefox shipped same-doc VT in **144** — Bugzilla **1985809** *"[css-view-transitions]
  Let view transitions ride the trains"*, resolved 2025-08-29, target milestone *144 Branch*.
- **VERIFIED** Element-scoped VT is **Chrome 147 stable, published 2026-03-27**
  (developer.chrome.com/blog/element-scoped-view-transitions).
- **UNVERIFIED but decision-relevant:** the owner's Fennec is described as "144+". If it is *actually*
  144 (Oct 2025), it is **~9 releases and ~40 landed VT bugs behind** current Gecko (§4.5 lists the
  fixed set). Establish the exact version before spending anything on Gecko choreography.

---

## 2. QUESTION A — evidence

### 2.1 What the spec actually says (VERIFIED — read from `w3c/csswg-drafts` `css-view-transitions-1/Overview.bs`, main @ 2026-08-06)

**(a) Named elements form a backdrop root** — §"Rendering Consolidation" (`#named-and-transitioning`),
verbatim:

> Elements captured in a view transition during a view transition **or whose 'view-transition-name'
> computed value is not 'none' (at any time)**:
> - Form a stacking context.
> - Are flattened in 3D transforms.
> - **Form a backdrop root.**

**(b) `backdrop-filter` is captured** — §"Capture the old state", step 11:

> Set capture's **old backdrop-filter** to the computed value of 'backdrop-filter' on element.

**(c) …is animated on the group** — §"Setup transition pseudo-elements" (both-old-and-new branch):

> ```css
> @keyframes -ua-view-transition-group-anim-transitionName {
>   from { transform: transform; width: width; height: height; backdrop-filter: backdropFilter; }
> }
> ```

**(d) …and is re-written onto the group's STATIC rule every frame** — §"Update pseudo-element styles"
(`#style-transition-pseudo-elements-algorithm`), the rule the UA keeps in sync with the *new* element:

> ```css
> :root::view-transition-group(transitionName) {
>   width: width; height: height; transform: transform;
>   writing-mode: …; direction: …; text-orientation: …;
>   mix-blend-mode: mixBlendMode; backdrop-filter: backdropFilter; color-scheme: colorScheme;
> }
> ```

**(e) Why it is on the group at all** — §"Rendering Model", verbatim:

> View Transition works by replicating an element's rendered state using UA generated pseudo-elements.
> Aspects of the element's rendering which apply to the element itself or its descendants, for example
> visual effects like 'filter' or 'opacity' and clipping from 'overflow' or 'clip-path', are applied
> when generating its image in Capture the image. **However, properties like 'mix-blend-mode' which
> define how the element draws when it is embedded can't be applied to its image. Such properties are
> applied to the element's corresponding `::view-transition-group()` pseudo-element**…

**(f) The page is not painted underneath** — §"Rendering consolidation" (the `animating` phase):

> the boxes generated by any element in that Document with captured in a view transition and its
> element contents … **are not painted (as if they had `opacity: 0`)** and do not respond to
> hit-testing…

**(g) The pseudo tree is flat and ordered by paint order**, `::view-transition-image-pair` exists only
to provide `isolation: isolate` for its children (spec note, §`::view-transition-image-pair`). The
group itself carries no isolation.

**Reading (mine, UNVERIFIED as engine behaviour):** by (a)+(d)+(f)+(g) the appbar's group SHOULD blur
the sibling group painted below it (our `gacha-page`), because that sibling is the only thing behind
it and nothing between them declares a backdrop root. That is why the failure the owner sees needs an
engine-level explanation, not a spec-level one.

**The CSSWG resolution behind all this** (REPORTED — CSSWG minutes, 2023-09-27, csswg-drafts#9358):
*"RESOLVED: animate backdrop-filter for view transitions similar to transform/size"*, motivated by the
report that during view transitions "the backdrop-filter property gets dropped on the floor"; the fix
is that "the computed value of the backdrop filter gets copied to its group pseudo, similar to
mix-blend-mode".

### 2.2 What Blink actually implements (VERIFIED — Chromium source, `main` @ 2026-08-06)

`third_party/blink/renderer/core/view_transition/view_transition_style_tracker.cc`:

```cpp
const CSSPropertyID kPropertiesToCapture[] = {
    CSSPropertyID::kBackdropFilter, CSSPropertyID::kColorScheme,
    CSSPropertyID::kMixBlendMode,   CSSPropertyID::kTextOrientation,
    CSSPropertyID::kWritingMode,
};

const CSSPropertyID kPropertiesToAnimate[] = {
    CSSPropertyID::kBackdropFilter,
};
```

…plus a dedicated `ViewTransitionStyleTracker::InvalidateBackdropFilterCompositingProperties()`
("Only invalidate things that have a backdrop filter" → `SetNeedsPaintPropertyUpdate()` on each
captured element that has one), i.e. Blink deliberately re-plumbs backdrop-filter compositing when a
transition starts.

`view_transition_style_builder.cc`, `AddContainerStyles()` — **the captured properties go into the
STATIC group rule**, not only the keyframes:

```cpp
  group_rule_builder.AppendFormat(R"CSS( width: %.3fpx; height: %.3fpx; transform: %s; )CSS", …);
  AppendProperties(captured_css_properties, group_rule_builder);   // ← backdrop-filter lands here
  AddRules(kGroupTagName, tag, group_rule_builder.ReleaseString());
```

**Consequence for our CSS (VERIFIED by construction):** `::view-transition-group(gacha-appbar){
animation: none }` cannot be what kills the glass on Blink — it only removes the UA
transform/width/height/backdrop-filter *interpolation*; the group keeps the static
`backdrop-filter` value written by `AddContainerStyles`. (Worth knowing before anyone "fixes" it
there.)

### 2.3 What the test suite says (VERIFIED — WPT tree, `master` @ 2026-08-06)

Four relevant reftests exist, all authored from the Chromium side:

| Test | What it pins |
|---|---|
| `css/css-view-transitions/backdrop-filter-captured.html` | "View transitions: capture with backdrop filter on the element" — target has `view-transition-name: target` + `backdrop-filter: grayscale(1)`, animations stretched to 300 s, screenshot taken after `.ready`. i.e. **the group's blur must be visible mid-flight**. |
| `backdrop-filter-animated.html` | the old→new interpolation of the value |
| `backdrop-filter-while-promise-pending.html` (+ iframe support file) | the value during the pending-update window |
| **`view-transition-name-is-backdrop-filter-root.html`** | title verbatim: *"View transitions: view-transition-name non-none value is a backdrop filter root"* — author `vmpstr@chromium.org`. A `.filter{backdrop-filter:invert(1)}` **inside** a named element must NOT invert the cyan background outside it. |

**I could not retrieve per-browser pass/fail** — wpt.fyi's simple search API returned run metadata
(Chrome 153.0.7979.3, Edge 152, Firefox 155.0a1, Safari 249 preview) with empty result rows for
reftests. §7 lists this as unbought.

### 2.4 The one field report of the symptom (REPORTED — Bugzilla 1999295, UNCONFIRMED, Site Reports, filed 2025-11-10, last touched 2026-05-13)

> **openguessr.com - Backdrop filter not applied during transitions**
> "When using the view transition API, backdrop filters seem to be disabled while the transition is
> running. This is not the case in Chrome." — paulrhomberg01@gmail.com, 2025-11-10 (video + comparison
> image attached)

**This is the single most important correction in the dossier**: the field's report points the *other
way* from our device note. Two readings, both plausible, and they are distinguishable on a device:

- *Composition difference.* If openguessr's blurred bar is **not** named (it lives inside the root
  snapshot), then in Chrome the blur is simply part of the captured/live root rendering and works;
  Gecko apparently drops it. Our bar, by contrast, **is** named (Blink-only, since G6.4) — a different
  code path, the one where the blur has to be re-applied on the group over a *sibling* group.
- *Version difference.* 1999295 is from Firefox ~144-era; ours is Fennec "144+".

Either way, the claim in `gacha.css:633-635` ("a named group's computed `backdrop-filter` is copied
onto `::view-transition-group()`… Level-1 pseudos only; Chromium + Gecko") is **half-verified**: the
spec + Blink source back the Chromium half (§2.1–2.2); **nothing found in this pass backs the Gecko
half**, and 1999295 argues against it.

### 2.5 What Chrome DevRel actually recommends for fixed headers (VERIFIED — `GoogleChrome/developer.chrome.com`, `site/en/docs/web-platform/view-transitions/index.md`, main @ 2026-08-06)

The guidance exists and is exactly the technique we already use — extract the header into its own
group:

> "To avoid this, you can extract the header from the rest of the page so it can be animated
> separately. This is done by assigning a `view-transition-name` to the element." … "Now the header
> stays in place and cross-fades." (§ *Transitioning multiple elements*, with the *"Shared axis
> transition with fixed header"* demo)

And the flat-tree property we rely on for the reel:

> "View transitions use a flat structure. In the real DOM, the heading text was in the header. But,
> during the transition, their respective `::view-transition-group`s are siblings."

**Negative finding (VERIFIED by exhaustion of that document):** the guide has **no** mention of
`backdrop-filter`, blur, glass, or any caveat that an extracted header loses effects that sample the
page behind it. Grepping the whole 1075-line source for `backdrop|blur` returns nothing. The
"extract the header" recipe is written for *opaque* headers.

### 2.6 The escape hatches the platform grew since (VERIFIED — vendor docs + BCD)

**(i) Nested view transition groups — `view-transition-group` property, Chrome/Edge 140, Firefox ✗,
Safari ✗** (developer.chrome.com/docs/css-ui/view-transitions/nested-view-transition-groups). Values
`contain` / `nearest` / `none`. Instead of a flat sibling list, a named descendant's group nests
inside its ancestor's group via an intermediary `::view-transition-group-children()` pseudo which
"keeps all nested pseudos together", inherits the parent's transform/3D and clipping
(`overflow: clip`) and the parent's border shape. **Why it matters here:** nesting is the platform's
answer to "this group needs the group below it to be *behind* it, not beside it" — the bar's group
would sit inside `gacha-page`'s group, directly over that group's image. The docs do **not** mention
backdrop-filter, so the blur-through is UNVERIFIED — but it is a one-line, already-engine-branched
experiment.

**(ii) Element-scoped view transitions — `Element.startViewTransition()`, Chrome 147 stable
2026-03-27, Chrome Android 147, Firefox ✗, Safari ✗.** The decisive properties, verbatim from
csswg-drafts `css-view-transitions-2/element-scoped-view-transitions.md` and the Chrome docs:

> "The `::view-transition` pseudo… is laid out as a `position: absolute; inset: 0` child of the scope."
> "**Non-transitioning content outside the scope can now paint on top of transitioning content**" —
> addressing that overlays "could not stack in front of the pseudo-element tree".
> "The scope must be a block container with `contain: layout`" … Chrome applies `contain: layout` and
> `view-transition-scope: all` onto the scope root during the transition.
> "elements outside the `<ul>` element — for example the buttons — **remain interactive**, because
> those elements are not part of the scope."

That is a *page-level* pseudo tree instead of a top-layer one: an app bar **outside** the scope is
never captured, never snapshotted, stays live, and paints above the transition — so its
`backdrop-filter` samples the pseudo tree exactly as it samples the page today. This is the only
option found that is *architecturally* correct rather than a workaround.

### 2.7 What the platform cannot do today (honest statement)

- **There is no way to blur, from one snapshot group, the live pixels of another group, portably.**
  The spec's only lever is the copied `backdrop-filter` on the group, whose sampling is governed by
  the backdrop-root rule (§2.1a) and by each engine's compositing; Gecko has an open report that it
  does nothing at all during a transition (§2.4), and it is unimplemented-or-ineffective on Blink in
  *our* composition per the owner's device.
- **There is no "exclude this element from the snapshot" primitive in a document-scoped VT.**
  `view-transition-name: none` does not lift an element out of its captured ancestor; the only ways
  out are (a) not naming the ancestor, or (b) element-scoped VT (Chrome 147+).
- **`position: fixed` does not help** — a fixed element inside a captured subtree is still captured
  (and Gecko currently mis-captures it: bug 1979005, §4.4).
- **Pre-compositing a blurred copy is not viable here.** CSS `element()` is Firefox-only
  (`-moz-element`), and canvas-snapshotting the scroller per frame on a phone is far more expensive
  than the effect is worth. Ruled out, do not re-buy.
- **The value CAN be animated** (spec (c) above), so a *graceful* solution — ramp the blur down and
  back up around the flight instead of having it snap — is available on both engines even where the
  blur-through isn't.

---

## 3. QUESTION A — ranked options for OUR composition

Constraints carried from the brief: **no root-scale rims · reel above content · chrome must not pop
at commit.**

| # | Option | Keeps constraints? | Cost | Confidence it fixes the glass |
|---|---|---|---|---|
| **A0** | **Probe first (§7.1), don't build.** Spec + Blink source say the named-group case should blur; the failure is therefore composition-, version- or compositor-specific and one 20-minute device probe tells us *which*, which changes the ranking below. | n/a | ~30 min on a phone | n/a — it is the prerequisite |
| **A1** | **Nest the bar's group under the page group** — add `view-transition-group: nearest` to the existing **Blink-only** `.kit-appbar`/`.kit-tabbar` naming rules (Chrome 140+; the branch already exists, so Gecko is untouched). The bar's group then paints *inside* `gacha-page`'s group, directly above that group's image. | Yes, *if* the child group doesn't inherit the page's scale — our scale rides `::view-transition-old/new(gacha-page)` (the images), **not** the group's transform, and nesting inherits the parent **group**'s transform. UNVERIFIED, cheap to check. | ~2 CSS lines | **Medium.** Docs don't mention backdrop-filter; it does give the blur something structurally behind it. |
| **A2** | **Element-scoped VT for the flight** (Chrome 147+): wrap the tab bodies in a scope element (the kit has no such wrapper today — the bodies are siblings of `KitAppBar` inside `.kit-scroll`), call `Element.startViewTransition` there, leave bar + tab bar + reel outside. Bar stays **live**, glass never drops, reel keeps its z-order for free, chrome cannot pop because it never transitions. | Yes, by construction — this is the composition the constraints describe. | **High**: a new DOM wrapper in the shared kit (all themes), a second path in `runViewTransition`, `contain: layout` auto-applied to the scope (⚠ becomes the containing block for any `position: fixed` descendant), and the doc-scoped path must remain for Gecko/Safari. | **High** — the bar is not captured at all. |
| **A3** | **Stop extracting the page: one group + the scale done as an ordinary CSS entrance.** Un-name `.kit-main`; let the root pair do an opacity-only cross-fade (UA default), and put the 96%/104% scale on a plain `@keyframes` entrance on `.tab.active` instead (the kit already had `kit-fade` there; gacha nulls it). Bar and content are back in ONE snapshot ⇒ glass is baked on the old side and **live** on the new side; the fixed backdrop is never scaled ⇒ **no rims**; the reel is back inside the root snapshot's natural paint order ⇒ above the content without a name. | Yes — and it removes the two constraints' *causes* rather than working around them. | Low-ish CSS churn, but it undoes the G6.3/G6.4 shape (needs the owner's eye on the outgoing side: the leaving page only cross-fades, it no longer scales down). | **High for the "switches on at commit" pop** (the bar is no longer a separate live layer), **Medium** for the blur-through, since it is then the same case as pre-G6.3. **A0's probe answers this directly.** |
| **A4** | **Make the drop deliberate and cheap:** animate `backdrop-filter` down to `blur(0)` over the first ~80 ms and back at the end (spec (c) — it *is* animatable), so the glass fades rather than snapping, with the gradient carrying legibility meanwhile. | Yes | Tiny | Doesn't restore glass; removes the *snap*, which is what read as broken. Owner already rejected the near-opaque *fill*; this is a different lever (no recolour). |
| **A5** | **Accept the dropout** (status quo, owner's current ruling). | Yes | Zero | — |
| **✗** | Pre-composited blur via `element()` / canvas / duplicated blurred layer. | — | — | **Ruled out** (§2.7) — Gecko-only API and per-frame cost. Do not re-buy. |

**Recommended sequence:** A0 → if the probe shows the *named-bar* case is the loser, try **A1**
(2 lines) → if that fails, choose between **A3** (cheap, changes the choreography) and **A2**
(expensive, permanently correct, Chrome-only). A4 is a good consolation in every branch.

> **OUTCOME (§7.1, 2026-08-06):** A0 ran. The named-bar case IS the loser — on both engines. **A1 was
> tried in the same probe and does NOT fix it** (case 4 = case 3, seam included), so it is dead rather
> than untested. **A3 adopted**, by owner ruling; A2 and A4 not bought (see §7.1 for why neither now
> earns its cost).

---

## 4. QUESTION B — evidence (Gecko same-doc VT on Android)

### 4.1 The mechanism that scales with group count (VERIFIED)

Chrome's own doc, `view-transitions/index.md` (aside, § *One element transitioning to another*):

> "Animating width and height, as happens here on the `::view-transition-group`, is generally frowned
> upon in web performance circles as **it runs layout per frame**. However, for View Transitions, we
> plan to optimize it so it can run off the main thread in most cases. **This optimization hasn't been
> implemented yet.**"

Gecko's matching bug — **Bugzilla 2000047**, *"Optimize no-op `height`/`width` css animations, since
view transitions might generate them"*, NEW, CSS Transitions and Animations, filed 2025-11-13 by
dholbert@mozilla.com, verbatim:

> c0: "Bramus from Chrome DevRel describes an optimization that Chrome's got on Canary right now…
> `width` and `height` animations run on the main thread… if we can detect and specially-handle those,
> it'd be great to optimize them away entirely."
> c1: "Here's a testcase which has a no-op animation for css `width` and `height`… **ACTUAL RESULTS:
> Refresh driver ticks every 16ms or so. EXPECTED RESULTS: No refresh driver ticks.**"
> c3: "(Notice the main-thread activity for testcase 1 … vs. the lack of main-thread activity for
> testcase 2 [opacity].)"
> c6 (bramus@google.com): "Note that these generated keyframes still do something when the
> `width`/`height` don't change, namely moving the pseudo across the screen from its old to its new
> position… **The most visual outcome is that the animations are no longer subject to jank.**"
> c9 (dholbert): "**In Firefox, when random-synthetic-jank happens… the animation seems to immediately
> snap to the end; whereas in Chrome release, the animation pauses for the duration of the jank.**"

**Direct application:** one group → one main-thread group animation. Three groups (root · page · reel)
→ three, on a phone, every frame, alongside the reel's five slat animations + figure. And Gecko's
response to a dropped frame is to **snap the animation to its end** — which is precisely the
"glitchy" the owner described, and precisely what a one-group composition did not do.

### 4.2 A brand-new Gecko bug that matches our exact code (REPORTED — Bugzilla 2057752, UNCONFIRMED, filed 2026-07-25, last touched 2026-08-04)

> **"Transition group with `animation: none` renders above higher z-index group"** — reporter
> thelazylama@gmail.com: *"For one frame at the beginning or end of the transition, Firefox renders
> the `hero-section` snapshot above the animated `heroFade` snapshot, despite `hero-section` having a
> lower `z-index`."* Chromium handles it correctly.

We set `animation: none` on `::view-transition-group(gacha-reel)`'s pair and (Blink-only) on the
chrome groups — the reel's rule is **live on Gecko**. A one-frame z-order flip at the start and end of
every tab flight is a textbook "glitchy". **This bug is 12 days old; nobody has triaged it.** Cheap
mitigation to test: replace `animation: none` with a real but no-op animation (e.g. a keyframe that
holds `opacity: 1` for the flight duration) so the group is never in the "no animation" state.

### 4.3 Scaling a snapshot is a *quality* regression on Gecko too (VERIFIED — Bugzilla 2012228, NEW, 2026-01/02)

> dholbert, 2026-01-23: text is blurry in Firefox and Safari, crisp in Chrome — *"we're taking the
> view-transition-screenshot **without** the ancestor's scale applied, and then we apply the scale to
> the screenshot when displaying it."* c2: putting the view-transition on the same element that bears
> the scale makes the blurriness disappear. c3: Safari matches Firefox but scrapes through WPT fuzzy
> tolerances.

Related, already fixed: **1977111** *"[V-T] Large view-transition snapshots are blurry"* (fixed,
143 Branch, 2025-08-01). Our flight scales a full-viewport snapshot 0.96→1.04 on both sides ⇒ on Gecko
the incoming page is a **resampled** image for the whole 380 ms. Opacity-only avoids this entirely.

### 4.4 Other open Gecko VT bugs that touch our composition (REPORTED — Bugzilla, statuses as of 2026-08-06)

| Bug | Title | Why it touches us |
|---|---|---|
| **2001861** | "Stop setting `mWillBuildScrollableLayer` false in transition captures" (Panning and Zooming, NEW) — tnikkel: *"For view transitions, **async scrolling does not happen inside view transition captures**."* | On Android, a flight in progress means the captured scroller is **not** APZ-async-scrollable. Tap-then-fling during the 380 ms lands on the main thread. |
| **1979005** | "View transition elements with `position:fixed` descendants not captured" (Layout, NEW) — sukil: *"our current implementation expects our target element's capture/snapshot to include position:fixed descendants too, however for some reason or another it isn't."* emilio: fixing it means adding abspos/fixed area to the ink-overflow rect, *"a somewhat scary change"*. | Any `position: fixed` descendant inside a named region can vanish/clip mid-flight on Gecko. |
| **1991967** | "Animated pseudos don't respond to scroll during view transition" (NEW) | Same family: the pseudo tree and the scroller disagree during a flight. |
| **1994547** | "View Transition elements not visible during transition" (NEW) | The class of "content missing mid-flight" reports. |
| **2023566** | "Missing element in view transition (scale, translate3d, offset)" (Graphics: WebRender, NEW, 2026-04) | Our flight is scale + a promoted, `will-change`-d reel. |
| **1926021** | "Make sure we iterate in paint order to capture view transition state" (NEW) | Paint-order/z-order of groups — the exact property our reel extraction depends on. |
| **1968100** | "View Transitions Layout — M2 Contingency" (Layout, ASSIGNED) | The layout work is still in flight. |
| **1959116** | "View transitions demo crashes when being rapidly clicked" | Rapid tab tapping is our normal usage; `runViewTransition` already supersedes-and-skips, which is the right shape. |

### 4.5 Gecko *has* been fixing this fast — the version question is load-bearing (VERIFIED — Bugzilla FIXED list)

Between 144 and 155 branches, the VT fix stream includes: `1985161` pseudo animation-timing
inheritance (144), `1986582` avoid hit-testing for `nsDisplayViewTransitionCapture` (144), `1966257`
pixel snapping of the ink-overflow rect (144), `1977111` large snapshots blurry (143), `1981204` clip
snapshot image when `overflow:hidden` (143), `1966192` capture iteration in paint order / respect
z-index (142), `1968672` capture inside a nested transform (141), `1958394` capture offscreen targets
(145), `1928437` find the proper scroller on VT pseudos (151), `2038312` retarget animations on
orphaned VT pseudos (152), `2016288`/`2016523` bulk removal of failure-allowing WPT annotations
(149) — i.e. Gecko went from "many known-broken" to "removing failure annotations" over exactly the
window the owner's device may have skipped.

**Also VERIFIED, and it kills a tempting hypothesis:** the only Android-specific VT bug found,
**1984902** (`DynamicToolbarTest#viewTransitionSnapshotSize`), is a *test-harness* bug — the test
didn't set `dom.viewTransitions.enabled`. It is **not** evidence of a dynamic-toolbar/VT interaction
on Fennec. (There *is* a mobile snapshot-size test, which is mildly reassuring.)

### 4.6 Is custom animation on `::view-transition-new` slower than the UA default on Gecko? (UNVERIFIED)

**Not established.** What *is* established: (i) `width`/`height` animations — which the UA generates
for **every** group regardless of what we write — are main-thread on Gecko (§4.1); (ii)
`opacity`-only animation demonstrably does **not** tick the main thread in dholbert's comparison
testcase (2000047 c1/c2/c3). No bug was found stating that author-authored keyframes on VT pseudos are
forced onto the main thread *per se*, and no bug was found showing Gecko runs VT pseudo animations on
the compositor either. Treat "opacity is cheaper than transform+width/height on Gecko VT pseudos" as
**strongly indicated but unproven**; treat "fewer groups is cheaper" as **VERIFIED by mechanism**.

---

## 5. QUESTION B — ranked options for the Gecko path

| # | Option | What it buys | What it costs | Confidence |
|---|---|---|---|---|
| **B0** | **Establish the Fennec version first** (`about:support`). If it is 144-146, update before tuning anything. | §4.5 — a year of VT fixes, incl. capture paint-order and snapshot blur | 2 minutes | High value, zero cost |
| **B1** | **Gecko = ONE group, opacity-only.** Don't name `.kit-main` or `.gc-reel` under Gecko; let the root pair cross-fade with the UA/opacity keyframes; the reel returns to its natural paint order inside the root snapshot (above the content — the pre-G6.3 behaviour the M2 comment documents), and the scale is either dropped or done as a plain CSS entrance on `.tab.active`. | Kills all three named Gecko mechanisms at once: 3 main-thread group animations → 1 (§4.1); `animation: none` z-flip → gone (§4.2); snapshot resampling blur → gone (§4.3). | The Gecko flight becomes plainer than Blink's — an engine-branched *choreography*, which §14.11's allowlist permits only for a real visual trade. This is one. | **High** — every mechanism it removes is documented |
| **B2** | **Keep the reel group; drop only the `gacha-page` group** (root + reel, opacity-only on both). | Most of B1's win (2 groups instead of 3), keeps the reel's explicit z-order guarantee. | Retains the `animation: none` group (bug 2057752) — unless paired with the no-op-animation trick. | Medium-high |
| **B3** | **Keep the 3 groups, remove only the two hazards**: swap `animation: none` → a no-op keyframe (2057752) and swap the scale for opacity-only (2012228 + main-thread cost). | Minimal structural change; keeps the reel group's ordering guarantee on both engines. | Still 3 main-thread group animations on a phone. | Medium |
| **B4** | **Skip the VT on Gecko entirely** — `runNavTransition` no-ops under `data-engine="gecko"`, the reel alone carries the switch. | Zero VT cost; zero VT bugs. | The DOM swap is then **instant at tap**, ~230 ms *before* the slats close over the viewport (`gacha-reel` reaches `translateY(0)` at 45% of 520 ms) — so the swap is visible, which is exactly what the VT was bought to hide. Would need a deliberate delayed commit, i.e. a second mechanism. | Low as-is; **use only if B1 still janks** |
| **B5** | **Auto-degrade under Gecko** — treat Gecko like `data-perf="lite"` for the flight (figure off, blur off), keeping the composition. | Cuts the *other* per-frame costs riding alongside the VT. | Doesn't touch the VT mechanisms themselves; visibly poorer arcade. | Low-medium; a good rider on B1 |

**On the brief's claim that "rims never afflicted Gecko":** I found **nothing in the bug record either
way**, and geometrically the rim is engine-neutral — a `scale(0.96)` old snapshot exposes whatever is
painted behind the `::view-transition` layer at the edges, and under gacha the app backdrop lives on a
captured element that is *not painted* during the flight (spec §2.1f). So **the claim is UNVERIFIED
and I would not build on it**; if B1/B2 restores a root-level scale on Gecko, re-check the rim on
device. (Note B1 as written does *not* restore a root scale — it drops the scale or moves it to an
in-page entrance, which side-steps the question.)

---

## 6. What the field does (peer/framework practice) — mostly a NEGATIVE finding

- **VERIFIED (by absence):** searching GitHub issues/code, Chrome DevRel guides, vtbag/Bag-of-Tricks,
  Astro/Next/Vue VT integrations for *engine-gated VT choreography* (UA-sniff Gecko → simpler
  animation) turned up **no real example**. The universal published pattern is **feature detection
  only** — `if (!document.startViewTransition) { update(); return; }` (MDN, Chrome docs,
  GoogleChromeLabs/view-transitions-mock, Astro's `ClientRouter` fallbacks `animate|swap|none`).
  Nobody publishes "Firefox gets a different transition".
- **REPORTED (vtbag/@vtbag + Bag of Tricks jotter, 2026):** the Firefox gaps a library author calls
  out are feature gaps, not perf gaps — no `view-transition-name: auto`, no
  `document.activeViewTransition` (now 147), **no nested view transition groups / `view-transition-group`
  has no effect**, "making it difficult to clip view transition images". Consistent with BCD (§1).
- **Interpretation (ours):** our `body[data-engine="gecko"]` branch is already *more* engine-aware than
  the published field, which is a consequence of shipping a bespoke arcade choreography on a phone
  browser nobody optimises for. There is no borrowed answer available — the decision has to be made
  from mechanism (§4), which is what §5 does.

---

## 7. What I could NOT determine (and exactly how to buy it)

### 7.1 The decisive device probe for Question A (~30 min, no code shipped)

A single static HTML page, opened on the owner's Chrome Android **and** Fennec, with a fixed blurred
bar over scrolling content and four buttons that run the same DOM swap under four compositions:

| Case | Composition | Question it answers |
|---|---|---|
| 1 | root only (no names at all) | Does the glass survive when bar+content are in one snapshot? (⇒ ranks **A3**) |
| 2 | content region named, bar unnamed (inside it) | Is *extraction* what breaks it? (our pre-G6.4 state) |
| 3 | content named + bar named, flat siblings | Does the group's copied `backdrop-filter` blur the sibling group? (our state today ⇒ confirms/denies §2.2) |
| 4 | case 3 + `view-transition-group: nearest` on the bar (Chrome only) | ⇒ ranks **A1** |

Record: blur present/absent during the flight, per engine, per case. **This is the number that decides
Question A**, and it is not obtainable from any document.

### 7.1 PROBE RESULTS — bought (owner device, 2026-08-06). **§7.1 is now closed.**

The four cases above, run on the owner's phone on **both** Chrome Android and Fennec.

| Case | Composition | Chrome Android | Fennec (Gecko) |
|---|---|---|---|
| 1 | root only, no names | **glass GOOD** — blur holds for the whole flight, no seam | clarity shift (see below) |
| 2 | content region named, bar unnamed inside it | **glass GOOD** | clarity shift |
| 3 | content named + bar named, flat siblings (**our state at G6.4**) | **LAYERED GLASS** + a **1px seam** at the named group's top edge | **LAYERED GLASS** |
| 4 | case 3 + `view-transition-group: nearest` on the bar (Chrome only) | **LAYERED GLASS** + the same 1px seam | n/a (unsupported) |

Owner's description of the layered-glass artefact, verbatim: *"several layers of glass, it adds one
when the transition starts."* That reading matches the mechanism exactly — the captured image is
already blurred and the group's copied `backdrop-filter` (§2.1c–d, §2.2) blurs it a second time over
the sibling group below.

**Three findings that move the rankings:**

1. **Naming the bar is the cause, on BOTH engines.** §2.4's two candidate readings are settled in
   favour of *composition*, not version: the flat-sibling case fails on Chrome as well as Gecko, and
   the unnamed cases are clean on Chrome. Our `gacha.css` bar comment's engine attribution
   ("`backdrop-filter` cannot survive a View Transition capture on Blink") was **wrong** and is
   corrected in the code.
2. **A1 is DEAD.** Nesting the bar's group (`view-transition-group: nearest`) does not fix the
   doubling — case 4 is indistinguishable from case 3, seam included. The load-bearing assumption in
   §7.2 ("whether a nested group's child inherits the parent's *image* animations") is moot: the
   double-blur survives nesting, so the option never gets as far as mattering.
3. **Gecko degrades the blur in ALL FOUR cases**, including case 1 with no names at all — a visible
   clarity shift the moment any flight starts. This is Bugzilla **1999295** confirmed on device, it is
   composition-independent, and no CSS reaches it. **Accepted as unwinnable.**

**RULING (owner, 2026-08-06): adopt A3 ≡ B1 — ONE root group for the tab flight, both engines, no
engine branch.** The `tab` kind names nothing; the root pair is a plain 380 ms UA opacity cross-fade;
the reel returns to its natural z-45 paint order inside the root snapshot. The `detail` morph is
untouched — it is probe **case 2** (content named, bar unnamed within it), measured glass-good, and
its extraction is what keeps the root scale off gacha's fixed backdrop.

**…and A3's SECOND HALF DID NOT SURVIVE THE DEVICE, which is a correction to this dossier's own
option text.** A3 proposes moving the 96%/104% scale onto "a plain `@keyframes` entrance on
`.tab.active`". Built that way it **jumped the outgoing page** — and the mechanism says it had to:
`runViewTransition` stamps `html[data-transition="tab"]` *before* calling `startViewTransition`
(the pseudo rules must be in scope when the transition begins), while the old state is captured
*inside* that call. For one commit the stamp is up with the LEAVING body still matching
`.tab.active`, so a stamp-keyed in-page animation fires on both sides and cannot be narrowed — the
stamp is a document-level flag with no notion of which side of the swap an element is on. Any future
in-page entrance must ride a MOUNT-scoped mechanism instead.

**Owner ruling (same day): NO SCALE ANYWHERE.** The tab flight is a pure opacity cross-fade — the
outgoing page is pixel-frozen at the tap and fades, the incoming one fades up. Recorded here so the
next reader does not re-derive A3's entrance from the option table above and hit the same wall.

*Not re-bought and now unnecessary:* **A2** (element-scoped VT) stays the only architecturally-perfect
answer but is Chrome-147-only and kit-level; with A3 keeping the glass on Chrome anyway, it buys
nothing the owner can see. **A4** (ramp the blur down) is moot on Chrome and would only mask Gecko's
own degradation with a second one.

Built as **G6.6** (GACHA_PLAN §7.7 addendum); the code lives in `gacha.css`'s M2 block.

### 7.2 Unbought items

- **wpt.fyi per-browser results** for the four `backdrop-filter` VT reftests (§2.3). The simple search
  API returns empty rows for reftests; the real answer needs the structured `POST /api/search` or the
  raw GCS `report.json`. Would tell us definitively whether *Gecko* implements the group copy.
- **A Chromium bug for "backdrop-filter doesn't blur across VT groups."** None found.
  `issues.chromium.org` is JS-gated and returned a sign-in shell to fetches; the crbugs surfaced by
  search (**40175472 / 1194050** "backdrop-filter blur disappears during transition/animation",
  **40067168**, **40040614**) are the *pre-existing* Blink family of "blur breaks when a parent
  animates / transitions", which may well be the underlying cause here, but I could not read them.
  **Buy this by hand** (open in a real browser) before filing anything upstream.
- **Whether a nested group's child inherits the parent's *image* animations** (A1's load-bearing
  assumption). Docs say the children pseudo inherits the parent's transform/3D + clipping; our scale
  lives on the old/new images, not the group. Test in probe case 4.
- **Whether Gecko runs any VT pseudo animation off the main thread.** No bug found either way (§4.6).
  A Firefox profiler capture on the device (or desktop Nightly with the same CSS) would settle it and
  is the natural companion to §7.1.
- **The owner's exact Fennec version** (§B0) — everything in §4.5 hinges on it.

---

## 8. The numbers that decide

| Kind | Value |
|---|---|
| Spec anchors | `css-view-transitions-1` §"Rendering Consolidation" (`#named-and-transitioning`) — **named ⇒ backdrop root** · §"Capture the old state" step 11 · §"Setup transition pseudo-elements" (group keyframes) · §"Update pseudo-element styles" (`#style-transition-pseudo-elements-algorithm`) — **static group rule carries `backdrop-filter`** |
| CSSWG | **csswg-drafts#9358**, RESOLVED 2023-09-27 "animate backdrop-filter for view transitions similar to transform/size" |
| Blink source | `view_transition_style_tracker.cc` `kPropertiesToCapture` / `kPropertiesToAnimate` / `InvalidateBackdropFilterCompositingProperties()`; `view_transition_style_builder.cc` `AddContainerStyles()` |
| WPT | `css/css-view-transitions/backdrop-filter-captured.html`, `-animated`, `-while-promise-pending`, **`view-transition-name-is-backdrop-filter-root.html`** |
| Chromium versions | VT 111 · nested groups (`view-transition-group`) **140** · `activeViewTransition` 142 · **element-scoped `Element.startViewTransition` + `view-transition-scope` 147, stable 2026-03-27**, Chrome Android mirrors |
| Gecko versions | VT ships **144** (bug **1985809**, 2025-08-29) · types **147** (bug 2001878) · nested groups & scoped VT **not supported** |
| Gecko bugs — glass | **1999295** (backdrop-filter not applied during transitions; "not the case in Chrome") |
| Gecko bugs — perf/glitch | **2000047** (main-thread width/height group animations; jank ⇒ snap-to-end) · **2057752** (`animation: none` group renders above higher z-index group, one frame, 2026-07-25) · **2012228** (snapshot scaled after capture ⇒ blurry) · **2001861** (no async scrolling inside VT captures) · **1979005** (fixed descendants not captured) · **1991967** · **1994547** · **2023566** · **1926021** · **1968100** · meta **1823896** (VT1) / **1860854** (VT2) / **2017359** (Interop 2026 VT) |
| Chrome DevRel | `view-transitions/index.md` — "extract the header" recipe (§ Transitioning multiple elements); the width/height aside ("runs layout per frame… optimization hasn't been implemented yet"); **no backdrop-filter guidance anywhere in the document** |

**URLs** — https://drafts.csswg.org/css-view-transitions-1/ ·
https://github.com/w3c/csswg-drafts/issues/9358 ·
https://lists.w3.org/Archives/Public/public-css-archive/2023Sep/0888.html ·
https://github.com/w3c/csswg-drafts/blob/main/css-view-transitions-2/element-scoped-view-transitions.md ·
https://developer.chrome.com/docs/web-platform/view-transitions/same-document ·
https://developer.chrome.com/blog/element-scoped-view-transitions ·
https://developer.chrome.com/docs/css-ui/view-transitions/element-scoped-view-transitions ·
https://developer.chrome.com/docs/css-ui/view-transitions/nested-view-transition-groups ·
https://developer.chrome.com/blog/view-transitions-in-2025 ·
https://bugzilla.mozilla.org/show_bug.cgi?id=1999295 ·
https://bugzilla.mozilla.org/show_bug.cgi?id=2000047 ·
https://bugzilla.mozilla.org/show_bug.cgi?id=2057752 ·
https://bugzilla.mozilla.org/show_bug.cgi?id=2012228 ·
https://bugzilla.mozilla.org/show_bug.cgi?id=2001861 ·
https://bugzilla.mozilla.org/show_bug.cgi?id=1979005 ·
https://bugzilla.mozilla.org/show_bug.cgi?id=1985809 ·
https://bugzilla.mozilla.org/show_bug.cgi?id=1823896 ·
https://bugzilla.mozilla.org/show_bug.cgi?id=1860854 ·
https://github.com/web-platform-tests/wpt/tree/master/css/css-view-transitions ·
https://vtbag.dev/basics/styling/ · https://vtbag.dev/tips/view-transition-fails-and-fixes/

---

## 9. Implications for ctrl-b (short, and separable from the evidence above)

1. **Two comments in `gacha.css` need amending after the §7.1 probe, whichever way it lands.** The
   G6.4 block (lines ~626–641) asserts the group backdrop-filter copy works on "Chromium + Gecko";
   the bar block (lines ~119–123) asserts "`backdrop-filter` cannot survive a View Transition capture
   on Blink". §2 makes the first half-verified and the second engine-attribution-suspect (1999295
   reports the mirror image). Whatever the probe says, one of them is currently misleading the next
   reader.
2. **`animation: none` on a group is now a known-hazard idiom on Gecko** (2057752, 12 days old) and we
   use it on the reel group in the Gecko path. If nothing else from this dossier is actioned, that one
   is worth a no-op-keyframe experiment.
3. **The cheapest composition that serves BOTH questions is A3 ≡ B1**: one group, opacity-only in the
   VT, the scale done as an in-page entrance on the incoming tab. It removes the rim cause, the
   snapshot-resampling blur, two of three main-thread group animations, and the `animation: none`
   z-flip — and it puts the bar back in the same snapshot as the content it blurs. Whether it also
   restores the glass is exactly probe case 1.
4. **If the owner wants the glass unconditionally**, the only architecturally-correct answer is **A2 /
   element-scoped VT (Chrome 147+)** — and that wants a `docs/DECISIONS.md` entry, because it
   introduces a second transition path and a kit-level DOM wrapper, i.e. it is not a gacha-local
   change.
5. **Do not re-buy**: `element()`/canvas pre-compositing (§2.7), a per-browser VT choreography
   precedent from the field (§6 — there isn't one), or the Android dynamic-toolbar hypothesis
   (§4.5 — 1984902 is a test-harness bug).
