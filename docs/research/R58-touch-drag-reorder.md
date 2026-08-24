# R58 — Handle-drag reorder at implementation grade (and does `useDragReorder` meet the bar?)

**Date:** 2026-08-24 · **Scope:** the media-gallery redesign's reorder gesture (owner promoted
handle-drag to a v1 PRIMARY gesture; the `↑`/`↓` buttons stay as the WCAG floor) ·
**Drove:** MEDIA_MANAGER_PLAN §9 Q8 / the reorder slice (open — no D-entry yet)

**Not re-reported here:** [R56 §3](./R56-gallery-management-ux.md) is already bought — WCAG 2.2
SC 2.5.7 naming adjacent move buttons as *the* conforming pattern, handle-only `touch-action: none`,
the Pointer-Events snapshot rule that makes long-press-lift structurally fragile, the drag/scroll
conflict mechanism, list-not-grid at phone width. This dossier starts where that one stops: the
**mechanics below the pattern**, and an audit of the hook we already own.

## Confidence legend

- **VERIFIED** — I read the source / spec text / ran the measurement myself in this session.
- **REPORTED** — a primary secondary source (official docs) says so; not executed here.
- **UNVERIFIED** — reasoned from evidence, not checked. Flagged inline.

---

## §0 — TL;DR

1. **`useDragReorder` is a sound skeleton with a real gap list, not a finished gesture.** It gets
   the *hard, easy-to-get-wrong* half right (handle-only, 6 px tolerance, document-level listeners,
   multi-touch guard, Escape + `pointercancel` + blur cancel, a keyboard path on the same control, a
   debounced live region, count-change abort, 10 unit tests). It is missing everything that makes a
   drag *feel* right: **no displaced-row motion (no gap opens — nothing shows where the row will
   land), no lift affordance beyond `opacity: .85`, no drop settle, no auto-scroll, no
   scroll-delta compensation, and it re-measures every row on every `pointermove`.**
2. **Two premise corrections.** (a) The hook is **not** used by the media gallery — its only call
   site is `SectionRefEditor.tsx:53` (the provider fallback chains); `MediaGallery.tsx` ships `↑`/`↓`
   buttons and no drag. (b) The hook's own comment says `setPointerCapture` "misbehaves on touch in
   Fennec, our lore" — **our own later investigation contradicts that** (GACHA_PLAN §post-close fix:
   the failure was capturing on an *ancestor* + an unguarded bubbling `lostpointercapture`, repro'd
   identically on Chromium, "Bugzilla sweep clean"), and `BottomSheet.tsx:468` ships
   `setPointerCapture` on a touch handle in production. The document-listener choice is still
   **right** (it is exactly what dnd-kit does, `PointerSensor.ts`) — only the stated reason is stale.
3. **The field's numbers converge on tokens we already ship.** Displaced-item motion is
   **200 ms** with **`cubic-bezier(0.2, 0, 0, 1)`** in both dnd-kit (`defaultTransition`) and
   react-beautiful-dnd (`timings.outOfTheWay` + `curves.outOfTheWay`), and Android's
   `DEFAULT_DRAG_ANIMATION_DURATION` is **200 ms** too. Our `kit/tokens.css:79-80` already defines
   `--dur-slow: 200ms` and `--ease-std: cubic-bezier(0.2, 0, 0, 1)`, and `axes.css:43` already
   collapses them to `1ms` under reduced motion. **The animation half is a token reference, not a
   design decision.**
4. **Build-vs-adopt: EXTEND the hook.** Measured, adopting dnd-kit costs **+15.3 KB gzip**
   (`@dnd-kit/core` 6.3.1 + `sortable` 10.0.0 + `utilities` 3.2.2, esbuild-minified, React external)
   — **+40 % on the `ConfTab` chunk the gallery ships in** (38.7 KB gz measured on the deployed prod
   tree). And `@dnd-kit/core@6.3.1` was **last published 2024-12-05 — the same day React 19.0.0
   shipped** — with the maintainer's active line being an unfinished `0.5.x` rewrite. Extending our
   hook is ~**150 lines TS + ~25 lines CSS**, all of it code we already understand.
5. **The one finding that is not about the gesture at all:** on the gallery, reorder commits through
   `PUT /api/settings` and the on-screen order does not change until an **awaited** media-index
   refetch lands (`useSettings.ts:317-331`). With buttons that is invisible. **With drag it is a
   snap-back-then-jump on every drop.** Drag on the gallery therefore requires a held/optimistic
   order for the commit window — that is a *design* decision the plan has not made (MediaGallery
   deliberately refused a local optimistic order at `MediaGallery.tsx:112-116`).

---

## §1 — What was read

| Source | How | Pin / date |
|---|---|---|
| `frontend/src/components/useDragReorder.ts` + `SectionRefEditor.tsx` + `MediaGallery.tsx` + `kit.css` + `tests/components/dragReorder.test.tsx` | read in full | this tree, 2026-08-24 |
| **dnd-kit** `packages/core` + `packages/sortable` source | raw.githubusercontent, `master` | read 2026-08-24 (repo HEAD `6fb5783`, 2026-07-13) |
| **@hello-pangea/dnd** (the maintained react-beautiful-dnd fork) `src/animation.ts`, `src/state/auto-scroller/fluid-scroller/**` | raw.githubusercontent, `main` | read 2026-08-24 |
| **SortableJS** 1.15.7 npm tarball (`Sortable.js`, `modular/sortable.core.esm.js`) | `npm pack` + grep | 2026-08-24 |
| **AndroidX RecyclerView** `ItemTouchHelper.java` + `res/values/dimens.xml` | raw.githubusercontent, `androidx-main` | read 2026-08-24 |
| **Apple** `UILongPressGestureRecognizer` property docs | `developer.apple.com/tutorials/data/**.json` | read 2026-08-24 |
| **W3C Pointer Events Level 3** (§4.1.3 firing, §4.2.7 `pointercancel`, §8.1 `touch-action`, §9.4 implicit capture) | fetched + text-extracted | W3C, fetched 2026-08-24 |
| **dnd-kit docs** — pointer sensor recommendations | WebFetch `dndkit.com` | 2026-08-24 |
| Package sizes | `npm pack` + `esbuild --bundle --minify` + `gzip -9`, on emma | 2026-08-24 |
| Our deployed bundle | `gzip -9 -c ~/apps/ctrl-b/frontend/dist/assets/*.js` | prod tree as of 2026-08-22 (v1.7.6) |

---

## §2 — Our hook, audited line by line

### 2.1 What it implements (VERIFIED, `frontend/src/components/useDragReorder.ts`)

| Mechanic | Where | Note |
|---|---|---|
| Handle-only activation | `handleProps()` :151-156 + `.kit .drag-handle { touch-action: none }` `kit.css:4716-4719` | Matches R56 §3.3 / dnd-kit's recommendation exactly. |
| Movement tolerance before drag | `TOLERANCE = 6` :28, checked :90 | In the field's band (SortableJS `touchStartThreshold` 1–4 px; Apple's long-press `allowableMovement` **10 pt**). |
| Document-level move/up/cancel listeners (no `setPointerCapture`) | :129-133 | **Same architecture as dnd-kit** (`PointerSensor.ts`: *"Pointer events stop firing if the target is unmounted while dragging. Therefore we attach listeners to the owner document instead"*). |
| Multi-touch guard | `mine()` :86 | dnd-kit's `TouchSensor` does the equivalent (`if (touches.length > 1) return false`). |
| Escape cancels | `key()` :123-126 | dnd-kit: `handleKeydown` → `Esc` → `handleCancel`. Identical. |
| `pointercancel` aborts | :116-119 | Correct: the spec **requires** `pointercancel` when the pointer is consumed for panning/zooming. |
| Window `blur` aborts | :120-122, :133 | dnd-kit cancels on `resize` + `visibilitychange` instead (see gap G8). |
| Insertion index by neighbour **midpoints** | `targetIndex()` :35-48 | The field's rule: Android's `ItemTouchHelper.Callback.getMoveThreshold()` returns **`.5f`** with the doc *"the fraction of the View size"* — our midpoint test is the same rule. |
| Keyboard reorder on the same control | `onKeyDown` :157-163 | Better than dnd-kit's default (which needs a separate `KeyboardSensor` + space-to-lift); ours is the WCAG 2.5.7-friendly shape. |
| Debounced `aria-live` position announcement | :29, :99-104; region at `SectionRefEditor.tsx:121-136` | dnd-kit ships `defaultAnnouncements` for the same events; ours announces position, which is more useful than dnd-kit's "moved over droppable area". |
| Abort when the list length changes mid-drag | :139-144 | No field equivalent found; a genuinely good extra. |
| Commit through a ref, never a stale closure | :57-59 | Correct. |
| Tests | `frontend/tests/components/dragReorder.test.tsx`, 10 cases incl. tolerance, Escape, `pointercancel`, second-pointer | Pure `targetIndex` math + synthetic pointer sequences with stubbed rects. |

### 2.2 What it lacks (the gap list — see §3 for the field numbers each maps to)

| # | Gap | Evidence in our code | Severity for a v1 gesture |
|---|---|---|---|
| **G1** | **No displaced-row motion.** The other rows never move, so nothing opens a gap where the row will land. The only feedback is the dragged row following the finger + a debounced screen-reader string. | `rowProps()` :166-178 styles **only** `drag.from` | **The single biggest feel gap.** Every reference library moves the neighbours. |
| **G2** | **Lift affordance is `opacity: .85` + `zIndex: 2`.** No scale, no shadow, no "pop". | :168-176 | Medium — cheap to fix, in CSS. |
| **G3** | **No drop settle.** `setDrag(null)` on `pointerup` snaps the row back to origin instantly; the new order appears when the parent re-renders. | `up()` :109-115 | High **on the gallery** (async commit, §2.3). |
| **G4** | **No auto-scroll.** A 30-row role inside `.kit-scroll` cannot be dragged past the viewport edge — the drag simply stops being useful. | absent | **High.** dnd-kit calls auto-scroll a default, not an option. |
| **G5** | **No scroll-delta compensation.** `dy = clientY - startY` is pure client-space, so if the container scrolls mid-drag (momentum, another finger, or auto-scroll once G4 lands) the row detaches from the finger by exactly the scrolled distance. | :89 | **Blocking for G4** — auto-scroll without this is a bug, not a feature. |
| **G6** | **Re-measures every row on every `pointermove`** — a `getBoundingClientRect()` loop over all rows (forced layout) per event, plus a `setDrag(...)` React state write per event that re-renders the whole editor subtree (neither `ProviderModelPicker` nor the gallery's `RoleSection` is memoised — grep: zero `React.memo` in either file). | :92-106 | Medium-High on a mid-range Android (HARDENING/R33: *the FE constraint is CPU on mid-range Android, not bytes*). |
| **G7** | **No text-selection suppression and no post-drag click suppression.** On desktop a drag that leaves the handle can select text; a drag that ends over the handle still produces a `click`. | absent | Low-Medium (the handle is `user-select: none`, the *page* is not). |
| **G8** | **Cancel-trigger parity.** No `resize`, no `visibilitychange`, no `contextmenu` `preventDefault` (Android long-press on a handle can raise the callout). | :129-133 | Low-Medium. |
| **G9** | **No `aria-roledescription`, no drag-start announcement.** The live region only speaks after the first index change (120 ms debounce). | :99-104 | Low (dnd-kit ships `roleDescription: 'sortable'` + "Picked up…"). |
| **G10** | Announcement debounce fires **after** the gesture may have ended (the timer is cleared by `teardown()`, so a fast drag can announce nothing at all). | `teardown()` :77 clears `timer` | Low, but a real AT hole: nothing is announced on **commit**. |

### 2.3 The local blocker nobody has ruled on yet (VERIFIED, our code)

On the gallery the reorder path is: `move()` → `patch({roles:{[role]:{order}}})` → `PUT /api/settings`
→ `onSuccess` → **`await Promise.race([invalidateQueries(["media"]), 5 s timeout])`**
(`useSettings.ts:329-332`), with `busy = save.isPending` blocking further reorder
(`MediaGallery.tsx:112-116`, whose comment explicitly refuses a local optimistic order: *"a local
optimistic order would be a second source of truth for something the server already owns"*).

With `↑`/`↓` that is invisible — the buttons grey out and the rows swap when the data lands. **With
drag, `setDrag(null)` at `pointerup` puts the row back where it started, and it jumps to its new
slot one round-trip later.** So the redesign must choose one of:

- **(a)** keep the drag transform applied (a "committing" state) until the refetch resolves, then
  cross-fade to the real order — no second source of truth, just a held visual; or
- **(b)** relax the no-optimistic-order rule for the drag path only; or
- **(c)** accept the flicker (LAN round-trip is fast, but the YAML write + index re-read is not free).

**Recommendation: (a).** It preserves the documented invariant (the server owns the order) and it is
the shape the field's drop animation already has — dnd-kit's `DragOverlay` animates the overlay to
the *destination rect* over 250 ms while the underlying list re-renders beneath it.

---

## §3 — The implementation-grade checklist, with the field's numbers

### 3.1 Activation and the touch-action snapshot (spec-level, VERIFIED)

W3C Pointer Events Level 3, §8.1, verbatim:

> "Once panning or zooming has been started, and the user agent has already determined whether or
> not the gesture should be handled as a user agent direct manipulation behavior, **any changes to
> the relevant `touch-action` value will be ignored for the duration of the action.** For instance,
> programmatically changing the `touch-action` value for an element from `auto` to `none` as part of
> a `pointerdown` handler script will not result in the user agent aborting or suppressing any of
> the pan or zoom behavior for that input for as long as that pointer is active."

That is R56 §3.3's dnd-kit doc quote **at spec level** — the handle must be `touch-action: none`
statically, which `kit.css:4719` already does. (Same section: a UA *must* suppress the pointer
stream — i.e. fire `pointercancel` — "right before starting to pan or zoom"; §4.2.7: *"The user
agent MUST fire a pointer event named `pointercancel` when it detects a scenario to suppress a
pointer event stream"*, and the listed scenarios include *"The pointer is subsequently used by the
user agent to manipulate the page viewport (e.g. panning or zooming)"*.)

Activation constraint numbers actually shipped:

| Source | Constraint | Value |
|---|---|---|
| ours | distance | **6 px** (`TOLERANCE`) |
| SortableJS 1.15.7 | `touchStartThreshold` | `devicePixelRatio` (typically 1–3); forced to **1** for native draggable, **4** for the touch fallback path |
| SortableJS 1.15.7 | `delay` / `delayOnTouchOnly` | **0** / `false` (opt-in) |
| dnd-kit 6.3.1 | `activationConstraint` | **none by default**; `distance` (px) or `delay`+`tolerance` (ms/px) are documented but the docs give **no recommended values** (WebFetch, 2026-08-24 — R56's "distance vs delay" summary is the doc's whole content) |
| iOS UIKit | `UILongPressGestureRecognizer.minimumPressDuration` | **0.5 s** (VERIFIED, Apple docs: *"The default duration is `0.5` seconds"*) |
| iOS UIKit | `.allowableMovement` | **10 pt** (VERIFIED: *"The default distance is `10` points"*) |

**Reading:** with a handle that is *already* `touch-action: none`, no delay is needed at all — the
delay exists only to disambiguate a drag from a scroll on a **row-body** grab. Our 6 px is fine;
if anything it can go to 8 px without hurting (dnd-kit's most-copied example uses `{distance: 8}`,
UNVERIFIED — the docs page carries no such number).

### 3.2 Event plumbing: implicit capture makes the document-listener choice correct

Pointer Events L3, §4.1.3 (VERIFIED, verbatim):

> "If the event is `pointerdown`, the associated device is a direct manipulation device, and the
> target is an `Element`, then set pointer capture for this `pointerId` to the target element as
> described in **implicit pointer capture**."

So on **touch**, the handle already holds capture — an explicit `setPointerCapture` is close to a
no-op there, and (per our own GACHA_PLAN finding) capturing on an *ancestor* is what breaks: it
fires a **bubbling** `lostpointercapture` at the original target. On **mouse** there is no implicit
capture, which is exactly why dnd-kit attaches to `ownerDocument` instead. **Our hook's approach ==
dnd-kit's approach; only the comment's reasoning is wrong** (§0 ②).

dnd-kit's `AbstractPointerSensor` also does five things we don't (VERIFIED, source):

```
this.windowListeners.add(EventName.Resize, this.handleCancel);
this.windowListeners.add(EventName.DragStart, preventDefault);
this.windowListeners.add(EventName.VisibilityChange, this.handleCancel);
this.windowListeners.add(EventName.ContextMenu, preventDefault);
this.documentListeners.add(EventName.Keydown, this.handleKeydown);
```

plus, on activation: `document` `click` listener with `{capture: true}` → `stopPropagation` (kills
the post-drag click), `getSelection()?.removeAllRanges()` and a `selectionchange` listener that keeps
removing ranges for the duration, and a **50 ms delayed** document-listener teardown (*"This is
necessary because we listen for `click` and `selection` events on the document"*). That is gaps
G7 + G8 in one paragraph — about **8-10 lines** for us.

### 3.3 Measure once, not per move

dnd-kit's `defaultMeasuringConfiguration` (VERIFIED): droppables use
`strategy: MeasuringStrategy.WhileDragging` with `frequency: MeasuringFrequency.Optimized` — i.e.
**measured when the drag starts**, then re-measured only on the events that can invalidate a rect
(scroll/resize/DOM change), never on every move. Our hook loops `getBoundingClientRect()` over every
row on **every `pointermove`** (G6). On a phone that is a forced synchronous layout per pointer
event, on a list whose rows carry thumbnails.

### 3.4 Displaced-item motion — the numbers agree across four sources

| Source | Duration | Easing | Property |
|---|---|---|---|
| dnd-kit `sortable/hooks/defaults.ts` | **200 ms** | `ease` | `transform` (`transitionProperty = 'transform'`) |
| @hello-pangea/dnd `src/animation.ts` | **0.2 s** (`timings.outOfTheWay`) | **`cubic-bezier(0.2, 0, 0, 1)`** (`curves.outOfTheWay`) | `transform` |
| AndroidX `ItemTouchHelper.Callback` | **`DEFAULT_DRAG_ANIMATION_DURATION = 200`** ms | (RecyclerView item animator) | translation |
| SortableJS | `animation: 0` (opt-in; the docs' canonical value is 150) | `options.easing` (unset) | `translate3d` FLIP (`animate()`: set inverted transform → force repaint via `offsetWidth` → transition to `0,0,0`) |

**Ours already has these tokens:** `--dur-slow: 200ms`, `--ease-std: cubic-bezier(0.2, 0, 0, 1)`
(`kit/tokens.css:79-80`) — literally rbd's `outOfTheWay` curve — and `axes.css:43-44` sets both to
`1ms` under the reduced-motion axis, which is the house's `data-motion` contract (R52 §8: *reduced =
1 ms, not `none`*).

**How much to displace:** dnd-kit's `verticalListSortingStrategy` (VERIFIED) moves every row between
`activeIndex` and `overIndex` by `∓(activeNodeRect.height + itemGap)`, where `itemGap` is measured
from the neighbouring rects — **not** a hardcoded gap. For a uniform-height list that is one line of
arithmetic; our rows are equal-height in both call sites, and `targetIndex` already has the rects.

### 3.5 Lift affordance — the only numbers the field publishes are dnd-kit's own example

VERIFIED from `stories/components/Item/Item.module.css` (dnd-kit's shipped demo, the source of the
look everyone copies):

```
@keyframes pop { 0% { transform: scale(1);   box-shadow: var(--box-shadow); }
                 100%{ transform: scale(var(--scale)); box-shadow: var(--box-shadow-picked-up); } }
.dragOverlay { --scale: 1.05;
               --box-shadow-picked-up: 0 0 0 1px rgba(63,63,68,.05),
                                       -1px 0 15px 0 rgba(34,33,81,.01),
                                        0 15px 15px 0 rgba(34,33,81,.25); }
.Item.dragOverlay { animation: pop 200ms cubic-bezier(0.18, 0.67, 0.6, 1.22); }
.Item.dragging:not(.dragOverlay) { opacity: var(--dragging-opacity, 0.5); }
```

So: **scale 1.05, 200 ms with an overshoot curve (`cubic-bezier(.18,.67,.6,1.22)`), a 15 px-blur
25 %-alpha shadow, and the source row left at opacity 0.5.** rbd's comparable published constants
are `combine.opacity.combining = 0.7` and `combine.scale.drop = 0.75` (a different interaction —
merging, not lifting). Android elevates the dragged child above its siblings rather than scaling it.

Our current `opacity: 0.85` is a weak signal by every one of those. **Recommendation:
`scale(1.02)` + a token shadow + `opacity: 1` on the lifted row, `transform`/`opacity` only
(THEME_ENGINE §14.11), gated by `data-motion`.** Keep the scale small: an overlay-less
(in-flow) row that scales 1.05 shifts its own neighbours' visual centre, which is exactly the
measurement we then use for hit-testing.

### 3.6 Drop settle

| Source | Duration | Easing |
|---|---|---|
| dnd-kit `defaultDropAnimationConfiguration` | **250 ms** | `ease`, plus a side effect that sets the source node to `opacity: 0` for the duration |
| @hello-pangea/dnd `timings` | **0.33 s min → 0.55 s max** (distance-scaled) | **`cubic-bezier(.2, 1, .1, 1)`** (`curves.drop`) |

Both animate *from the released position to the destination rect*, which is precisely what our async
commit prevents today (§2.3). rbd's dynamic duration (longer drop for a longer distance) is the
nicer touch; dnd-kit's fixed 250 ms is the cheaper one, and 250 ms sits between our `--dur-slow`
(200) and nothing — a `--dur-drop` would be a new token, so **prefer `--dur-slow` unless the owner
asks for weight**.

### 3.7 Auto-scroll — four shipped curves, and they disagree by 5×

| Source | Activation band | Max speed | Ramp | Loop |
|---|---|---|---|---|
| **dnd-kit** `getScrollDirectionAndSpeed` | `threshold {x: 0.2, y: 0.2}` → **20 % of the container's height** at each edge | `acceleration = 10` px per tick, `interval = 5` ms → **≈2000 px/s** at the edge | **linear** in distance-into-band | `setInterval(5ms)` |
| **@hello-pangea/dnd** `defaultAutoScrollerOptions` | `startFromPercentage: 0.25` (25 % of container), full speed from `maxScrollAtPercentage: 0.05` | `maxPixelScroll: 28` px **per frame** → **≈1680 px/s** @60 Hz | `ease: p => p ** 2`, **plus time dampening**: `minScroll = 1 px` for the first `accelerateAt = 360 ms`, ramping to full at `stopDampeningAt = 1200 ms` | rAF |
| **SortableJS** AutoScroll plugin | `scrollSensitivity: 30` px (fixed band) | `scrollSpeed: 10` px per **24 ms** tick → **≈417 px/s** | none (step function) | `setInterval(24ms)`, `bubbleScroll: true` |
| **Android** `ItemTouchHelper` | the dragged view must go **out of bounds**; ratio = out-of-bounds / view size | `item_touch_helper_max_drag_scroll_per_frame = 20dp` → **≈1200 dp/s** @60 Hz | distance cap `(t-1)^5 + 1`, **time** `t^5` over `DRAG_SCROLL_ACCELERATION_LIMIT_TIME_MS = 2000` | frame callback |

**Reading for us.** dnd-kit's is the most aggressive and the least principled (a linear ramp on a
5 ms interval, so ~3 scroll writes per frame). rbd's is the best-engineered: a *quadratic* ease plus
**time dampening**, which is the thing that makes "I hovered near the edge for a moment" not fling
the list. Android's `t^5` time curve is the same idea, harsher. **Proposal for our 5-30 row lists in
`.kit-scroll`: band = `min(0.2 × containerHeight, 96px)`, max ≈ **600 px/s** (≈10 px/frame),
`p²` ease, and rbd's dampening idea reduced to its cheap form — no scroll for the first ~200 ms of
edge hover.** Note `.kit-scroll` already sets `overscroll-behavior: contain` (`kit.css:164`), which
removes the pull-to-refresh / rubber-band chaining hazard for free, and `-webkit-overflow-scrolling:
touch` (`:163`) means iOS momentum can be running *while* a drag starts.

### 3.8 Scroll compensation is not optional once auto-scroll exists

dnd-kit tracks it explicitly: `useScrollOffsets` / `useScrollOffsetsDelta` →
`scrollAdjustedTranslate = add(modifiedTranslate, scrollAdjustment)` (`DndContext.tsx:287-295`), plus
an `AutoScroll` option literally named **`layoutShiftCompensation`**. Our `dy` is
`clientY - startY` with no scroll term (G5): the moment the container scrolls, the row lags the
finger by the scrolled distance. **~6 lines**: record `container.scrollTop` at `pointerdown`, add
`(scrollTop - startScrollTop)` to `dy`, and re-derive rects from the same frame.

### 3.9 Accessibility beyond the buttons

dnd-kit ships `defaultAttributes = {roleDescription: 'sortable'}` and `defaultScreenReaderInstructions`
(*"To pick up a draggable item, press the space bar. While dragging, use the arrow keys…"*) plus
`defaultAnnouncements` for start/over/end/cancel. We have the position announcement (better content)
but no start/commit announcement and no role description (G9/G10). Cost: **~6 lines**, and it closes
a real hole — today a *fast* drag announces **nothing** because `teardown()` clears the pending
debounce timer.

The WCAG floor is unchanged and already ruled (R56 §3.1): the `↑`/`↓` buttons stay, and their
`34 × 34` px hit areas (`kit.css:6189-6191`, with an in-code comment acknowledging the trade) still
owe the SC 2.5.8 fix the plan committed to.

### 3.10 Engine gotchas worth writing down

- **iOS Safari + dynamically-added `touchmove` handlers** — dnd-kit's `TouchSensor.setup()`
  (VERIFIED, verbatim): *"Adding a non-capture and non-passive `touchmove` listener in order to
  force `event.preventDefault()` calls to work in dynamically added touchmove event handlers. **This
  is required for iOS Safari.**"* We use **pointer** events, so this does not bite us — but it is the
  reason a `touchmove`-based implementation needs a window-level noop listener at mount.
- **`pointercancel` on scroll is spec-mandated, not a quirk** (§3.1) — treat it as the normal end of
  a gesture the user turned into a scroll, which our hook already does.
- **Post-drag `click`** — dnd-kit suppresses it with a capture-phase document listener; without it, a
  drag that ends on the handle also fires the handle's `onClick` (we have none today; the redesign's
  row-level tap targets make this a live hazard).
- **`contextmenu`** — Android long-press on a handle can raise the callout mid-drag; dnd-kit
  `preventDefault`s it for the gesture's duration.
- **Firefox Android** — no engine-specific defect found for this pattern in this pass. Our own
  in-tree evidence (GACHA_PLAN post-close fix, 2026-08-02: *"NOT engine-specific (Chromium repro'd
  identically; Bugzilla sweep clean — Fennec's `touch-action` handling is not at fault)"*, plus
  `BottomSheet.tsx` shipping a touch handle in production) says handle-only pointer drags are fine on
  Fennec. A Bugzilla REST query for `setPointerCapture`-and-touch bugs returned only long-resolved
  implementation bugs (newest relevant: 1534562, shadow-DOM, RESOLVED FIXED).

### 3.11 Perf posture

Our deployed bundle, measured today: `index` **132.7 KB gz**, `ConfTab` **38.7 KB gz** (the chunk
that contains `mgal-move`, i.e. the gallery), `CosmosRoot` 35.7 KB gz. The gesture's cost should be
judged against `ConfTab`, not the app total.

---

## §4 — Gap → action table

| Gap | Action | Where | Est. lines |
|---|---|---|---|
| G1 displaced rows | compute per-row `translateY = ∓(rowHeight + gap)` for rows between `from` and `to`; apply in `rowProps().style`; `transition: transform var(--dur-slow) var(--ease-std)` in kit.css (skip the transition on the dragged row) | hook + kit.css | ~22 TS + ~8 CSS |
| G2 lift | `scale(1.02)` + token shadow + `opacity: 1`, `data-motion` gated | kit.css | ~10 CSS |
| G3 settle | hold the drag transform through the commit window, animate to the destination rect (`--dur-slow`), release on data arrival | hook + MediaGallery | ~18 |
| G4 auto-scroll | nearest scrollable ancestor (`closest` on computed `overflow-y`), band `min(0.2×h, 96px)`, `p²` ease to ~600 px/s, rAF loop, ~200 ms dead time | hook | ~45 |
| G5 scroll delta | capture `scrollTop` at start; add the delta to `dy` and to the rect math | hook | ~6 |
| G6 measure/render cost | measure rects **once** at drag start (re-measure on scroll/resize only); keep `dy` in a ref + write `transform` directly to the node, keep only `to` in React state | hook | ~25 (mostly a rewrite of `move()`) |
| G7 selection/click | `getSelection().removeAllRanges()` + `selectionchange` listener + capture-phase `click` `stopPropagation`, torn down one tick late | hook | ~8 |
| G8 cancel parity | add `resize`, `visibilitychange`; `preventDefault` `contextmenu` and `dragstart` | hook | ~4 |
| G9/G10 a11y | `aria-roledescription="sortable"`; announce on start and on commit (fire the pending announce in `up()` instead of clearing it) | hook + call sites | ~8 |
| — | tests for the new math (`displacement()` pure, autoscroll speed curve pure) | tests | ~40 |

**Total ≈ 150 lines TS + ~25 CSS + ~40 test lines**, against a file that is currently 181 lines. That
roughly doubles it — which is the honest cost, and it is why §5 has to be argued, not assumed.

---

## §5 — Build vs adopt: the verdict

### 5.1 The measured numbers (VERIFIED, on emma, 2026-08-24)

| Package set | Versions | Bundled + minified | **gzip** |
|---|---|---|---|
| `@dnd-kit/core` + `sortable` + `utilities` | 6.3.1 · 10.0.0 · 3.2.2 | 44,369 B | **15,306 B** |
| …plus `@dnd-kit/modifiers` (`restrictToVerticalAxis`, which a list reorder wants) | + 9.0.0 | 48,873 B | **16,745 B** |

*(method: `npm i` the packages, `esbuild --bundle --format=esm --minify --external:react
--external:react-dom` over an entry importing exactly the symbols a vertical sortable list needs,
then `gzip -9`. This is the added-to-your-chunk figure, not the tarball size.)*

Against `ConfTab` at 38.7 KB gz that is **+40 %** on the chunk (and +11 % on the whole main bundle if
it landed there). Four new runtime dependencies (+`tslib`).

### 5.2 The maintenance facts (VERIFIED)

- `@dnd-kit/core@6.3.1` — **published 2024-12-05**; nothing since (`npm view time`). React 19.0.0
  shipped **the same day**; our tree runs `react@^19.2.0` (19.2.8, 2026-07-21).
- The maintainer's active line is the ground-up rewrite: `@dnd-kit/react` / `@dnd-kit/dom` at
  **0.5.0 (2026-06-11)** with 0.5.1 betas through 2026-07-13. Repo HEAD `6fb5783` (2026-07-13) is
  mostly docs/PR merges. Two open issues name React 19 — both against the **0.x** line (#2116
  "DragDropProvider manager is destroyed during Strict Mode replay", 2026-07-31; #1654 `"use client"`).
- So adopting means choosing between **a frozen v6 that predates our React** and **a pre-1.0 rewrite
  with open React-19 lifecycle bugs**. Neither is the "boring dependency" the deps-OK-if-justified
  rule is meant to license.

### 5.3 Recommendation: **(a) extend our hook.** Do not adopt dnd-kit.

The reasoning, in order of weight:

1. **We already own the expensive 40 %.** The parts that are genuinely hard to get right on the web —
   handle-only activation under the `touch-action` snapshot rule, document-level listeners because
   pointer events die with an unmounted target, the multi-touch guard, cancel semantics, a keyboard
   path on the same control, a live region, a tested pure index function — are *done and pinned by
   tests*. What is missing is animation and auto-scroll: the parts that are ordinary code.
2. **The animation numbers are already tokens in our tree** (§3.4). The displaced-row transition is
   literally `transform var(--dur-slow) var(--ease-std)` — dnd-kit's 200 ms and rbd's
   `cubic-bezier(0.2,0,0,1)`, which is our `--ease-std` character-for-character — and reduced motion
   is handled by an axis we already ship. Adopting a library to get a value we already have written
   down is the "similar code for the same thing we already own" failure mode, in reverse.
3. **The dependency is not on a healthy line** (§5.2), and it would arrive with a rewrite of two
   working call sites (`SectionRefEditor` and the redesigned gallery) into
   `DndContext`/`SortableContext`/`useSortable` — plus a `DragOverlay` portal if we want the drop
   animation, which is where dnd-kit's ergonomics get sharp.
4. **Scope is one gesture on one axis in one settings surface.** dnd-kit earns its size on
   multi-container boards, grids, cross-list moves, custom collision detection. We need none of it;
   `verticalListSortingStrategy` is ~40 lines of arithmetic we can read (§3.4) and reimplement in ~22.
5. **+15.3 KB gz for the ConfTab chunk on a phone-first PWA** is the wrong trade when the
   alternative is ~150 lines of code we maintain anyway.

**Re-open the verdict if** any of these becomes true: reorder must cross containers (drag a file from
one role into another), the gallery moves to a grid (2-D reorder is genuinely a different problem
and R56 §3.4 already recommends against the grid), or a third and fourth surface wants the gesture.

**Build order** (each independently shippable): **G6 + G5 first** (they change the hook's internals
and everything else sits on the new measurement/transform path) → **G1** (the gap — the biggest
perceived win) → **G2** (CSS only) → **G4** (auto-scroll) → **G3** (the settle, once §2.3 is ruled) →
**G7/G8/G9/G10** (a ~26-line hygiene batch).

---

## §6 — Bounded open sweep (3 findings, none of them asked for)

1. **The `↑`/`↓` targets are 34 × 34 px and the code knows it.** `kit.css:6184-6191` carries the
   comment *"34px targets rather than the 44px ideal: two of them ride a 44px-tall row on a phone"*.
   R56 §3.5 ① and MEDIA_MANAGER_PLAN §7 both committed to ≥44 px. Adding drag does not retire this —
   SC 2.5.7 conformance depends on the *buttons*, and SC 2.5.8 applies to them at AA. Worth folding
   into the same slice, since the row geometry is being touched anyway.
2. **`SectionRefEditor` gets the fix for free — and so does its bug surface.** It is the hook's only
   current consumer, and it has **no** `↑`/`↓` buttons at all: its handle carries the arrow-key path
   (`SectionRefEditor.tsx:157-163`) but there is **no single-pointer alternative to the drag**. Per
   R56 §3.1's verbatim Understanding-doc quote (*"achieving keyboard equivalence for a dragging
   operation does not automatically meet this success criterion"*), **the Inference/Voice/Embeddings
   fallback editors are the surface that is actually failing SC 2.5.7 today**, not the gallery. That
   is a pre-existing AA gap the gallery work will sit right next to; it costs one `⋯` menu or one
   pair of buttons.
3. **The drag-handle glyph is `⠿` (U+283F, Braille Pattern Dots-12345678) rendered as text.** R16
   established this repo's font-coverage trap for exotic codepoints (☆ in no shipped subset). `⠿`
   currently renders because the browser falls back to a system font; if a theme ever pins a
   `--font-*` role to a subsetted webfont on the handle, it becomes a tofu box. Low probability, but
   the fix is trivial (an inline SVG grip, as the close-× precedent).

---

## §7 — What I could not determine

- **No device measurements.** Everything about *cost* here (G6's per-move layout, the auto-scroll
  speed that feels right, whether 1.02 or 1.05 reads as a lift on a 390 px phone) is unmeasured on
  the owner's hardware. The MEDIA_MANAGER_PLAN S4 device round is where those get settled; this pass
  bought the numbers to *start* from, not the numbers to ship.
- **dnd-kit v6 under React 19.2 was not runtime-probed.** I read publish dates and the open-issue
  list; I did not mount it. If the owner ever overrules §5, that probe is the first step.
- **No recommended activation constants from dnd-kit's docs.** The widely-copied `{distance: 8}` /
  `{delay: 250, tolerance: 5}` pairs are community examples, not documented recommendations — the
  docs page contains no numbers (WebFetch verified). Treat them as folklore.
- **iOS Safari behaviour is REPORTED only** (no Apple device here). It matters little: the owner is
  on Android/Fennec + desktop Chromium/Gecko, and the one iOS-specific mechanism found
  (`TouchSensor.setup`'s passive-listener workaround) does not apply to a Pointer-Events
  implementation.
- **Whether Gecko's APZ can start a scroll before the main thread applies a *newly mounted* handle's
  `touch-action: none`.** The rule is static-CSS-only (§3.1), our handle's CSS is static, and our
  BottomSheet precedent works — but a handle rendered *during* an in-flight gesture is untested.

---

## §8 — Sources

**Ours (this tree, 2026-08-24):** `frontend/src/components/useDragReorder.ts` ·
`components/SectionRefEditor.tsx` · `components/MediaGallery.tsx` · `components/BottomSheet.tsx` ·
`hooks/useSettings.ts` · `hooks/useMedia.ts` · `theme-engine/kit/kit.css` (`:4714-4745`, `:6184-6210`,
`:158-170`) · `theme-engine/kit/tokens.css:78-81` · `theme-engine/kit/axes.css:43-44` ·
`frontend/tests/components/dragReorder.test.tsx` · `docs/GACHA_PLAN.md` (the 2026-08-02 post-close
pointer-capture fix) · `docs/COSMOS_HANDOFF.md` §C3 · `docs/MEDIA_MANAGER_PLAN.md` §7/§9 Q8 ·
`docs/research/R56-gallery-management-ux.md` §3.

**Field (read at the pins in §1):** clauderic/dnd-kit `master` —
`core/src/hooks/utilities/useAutoScroller.ts`, `core/src/utilities/scroll/getScrollDirectionAndSpeed.ts`,
`core/src/sensors/pointer/{AbstractPointerSensor,PointerSensor}.ts`, `core/src/sensors/touch/TouchSensor.ts`,
`core/src/components/DndContext/{defaults.ts,DndContext.tsx}`,
`core/src/components/DragOverlay/hooks/useDropAnimation.ts`,
`core/src/components/Accessibility/defaults.ts`, `sortable/src/hooks/{useSortable.ts,defaults.ts}`,
`sortable/src/strategies/verticalListSorting.ts`, `stories/components/Item/Item.module.css` ·
hello-pangea/dnd `main` — `src/animation.ts`, `src/state/auto-scroller/fluid-scroller/**` ·
SortableJS 1.15.7 (npm tarball) · androidx-main `recyclerview/.../ItemTouchHelper.java` +
`res/values/dimens.xml` · W3C **Pointer Events Level 3** §4.1.3/§4.2.7/§8.1/§9.4 ·
Apple `UILongPressGestureRecognizer.minimumPressDuration` / `.allowableMovement` ·
dndkit.com pointer-sensor recommendations · npm registry metadata (versions + publish times).
