# R56 — Phone-first image-gallery MANAGEMENT UX (upload · reorder · crop · delete · sections)

**Date of research: 2026-08-24.** Status: **DRAFT dossier** — evidence only, no D-entry yet.
Commissioned for: the Conf-tab media-gallery redesign (the media-gallery design conversation named
as NEXT in the 2026-08-23 HANDOFF block).

**Sibling dossiers (not bought here):** R54 = the crop widget's *library* choice. R55 = the backend
(write endpoints / storage). This dossier is **interaction shape only**.

**Scope lock (owner, already ruled — evidence below is about the detail INSIDE these, not about
alternatives to them):** gallery lives in the settings tab · one collapsible section per image
role · each section has its OWN upload control (no global upload; keyed sections bind from section
context) · after picking a file the user chooses crop OR use-as-is · no camera capture · files
reorder for priority and can be deleted · 5–30 images per section, a handful of sections.

**Current implementation read first:** `frontend/src/components/MediaGallery.tsx` (405 lines) —
thumbnail LIST rows, per-row `↑`/`↓` buttons (`aria-label="Move <file> up"`), badge strip
(`unusable_reason` · `oversize` · `dimensions` · key binding · `no match` / `duplicate`), pins as
`<select>` dropdowns, `busy` gate on the whole section while a settings save is in flight. **No file
operations at all** — the header comment states the §5.4 ruling explicitly.

---

## Confidence legend

| Mark | Meaning |
|---|---|
| **VERIFIED** | I read the primary source myself this session (source file at HEAD, official spec/guideline page, official product doc) |
| **REPORTED** | Secondary source only (third-party guide, forum, search summary) — plausible, not first-hand |
| **UNVERIFIED** | Expected/inferred, explicitly not checked |

Every product source below was fetched **2026-08-24**. Upstream moves; re-verify anything
load-bearing after a couple of releases.

---

## §0 — The verdict in one paragraph

The field has converged, and it disagrees with our instincts in two places. **Reorder:** WCAG 2.2
SC 2.5.7 names *our existing `↑`/`↓` buttons* as the canonical conforming alternative to dragging,
and iOS resolves the drag-vs-scroll conflict by gating reorder behind an explicit **edit mode**
rather than by making drag cleverer — so buttons are not a placeholder we should feel bad about,
they are the field's floor, and drag is optional polish that must be *handle-only* if built.
**Upload:** two independent products (WordPress Gallery block, Immich album page) ship the identical
two-state affordance — **empty → a large placeholder card in the content area; non-empty → a control
in the section/app header** — and neither ships an in-grid `+` tile at HEAD, even though WordPress
documents one (`isAppender`) as an available variant. **Crop:** nobody ships a "skip crop" button;
the crop viewport is cut in the *destination's exact shape* with everything outside it dimmed, and
the default state is a cover-fit of the whole image, so *confirming without touching anything IS
"use as is"*. **Delete:** Immich's code states the rule literally — reversible delete gets a 5 s
undo toast and no dialog; irreversible delete gets a modal saying "cannot undo this action" and a
toast with **no** undo button; Apple HIG says the same in prose. **Sections:** GOV.UK's accordion
ships a per-section **`summary` line inside the header button** and persists open state in session
storage — that summary slot is exactly where a "1 file broken" badge belongs, and GOV.UK's hard rule
("Do not use an accordion for content that all users need to see") makes putting it there mandatory,
not optional. **Focal point:** WordPress and Shopify both ship crop *and* focal point, and both scope
focal point to the case where **the container decides the crop ratio, not the user** — which means
for our fixed-ratio roles crop is complete and focal point is redundant, and for viewport-filling
backgrounds the reverse is true.

---

## §1 — What was read

**Guidelines / specs (VERIFIED, fetched 2026-08-24):**
- W3C WCAG 2.2 Understanding SC 2.5.7 *Dragging Movements* (Level AA) and SC 2.5.8 *Target Size
  (Minimum)* (Level AA) — `w3.org/WAI/WCAG22/Understanding/{dragging-movements,target-size-minimum}.html`
- Material Design 3: Snackbar guidelines · Dialogs guidelines · Progress indicators guidelines ·
  Foundations→Structure (touch targets) · the components index — `m3.material.io`
- material-components-android `docs/components/{Snackbar,Dialog}.md` @ master
- Apple HIG: *Alerts* · *Action sheets* · *Lists and tables* · *Collections* · *Disclosure controls*
- GOV.UK Design System: *Accordion* component page (guidance + macro options)
- Nielsen Norman Group, *Accordions Are Not Always the Answer for Complex Content on Desktops*
  (2014-05-18, still the standing NN/g accordion piece)
- MDN: `createImageBitmap` options · `<input type="file">` `capture`

**Product source read at HEAD (VERIFIED):**
- **Telegram Web A** (`Ajaxy/telegram-tt`, master): `src/components/ui/AvatarEditable.tsx`,
  `CropModal.tsx`, `ImageCropper.tsx`, `ImageCropper.module.scss`
- **Immich** (`immich-app/immich`, main): `web/src/lib/modals/AssetDeleteConfirmModal.svelte`,
  `web/src/lib/components/timeline/actions/DeleteAssetsAction.svelte`,
  `web/src/lib/utils/actions.ts`, `web/src/routes/UploadAssetPreview.svelte`,
  `web/src/routes/UploadPanel.svelte`, the album page `+page.svelte`
- **WordPress Gutenberg** (`WordPress/gutenberg`, trunk):
  `packages/components/src/focal-point-picker/{README.md,index.tsx,controls.tsx}`,
  `packages/compose/src/hooks/use-dragging/index.ts`,
  `packages/block-editor/src/components/media-placeholder/README.md`,
  `packages/block-library/src/gallery/edit.js`,
  `packages/block-library/src/cover/edit/inspector-controls.js`
- **dnd-kit** (`clauderic/dnd-kit`): Pointer/Touch sensor docs + `packages/core/src/hooks/utilities/useAutoScroller.ts`

**Official product docs (VERIFIED):** Notion help *Customize and style your content*; Shopify Help
Center *Uploading images* (focal points).

**REPORTED only:** Notion's "Reposition"/"Save position" affordance and its desktop-only scope;
Ghost's Pintura image-editor integration; Shopify's separate media-editor crop tool.

---

## §2 — The five reference flows, step by step

### 2.1 Telegram Web A — avatar crop (VERIFIED, source read at master)

The whole flow is three files and ~300 lines. Step by step:

1. **Entry.** `AvatarEditable.tsx` renders a `<label role="button" tabIndex={0}>` wrapping a hidden
   `<input type="file" onChange={handleSelectFile} accept="image/png, image/jpeg">`. The tile shows
   the current avatar if there is one, a `camera-add` icon if not. There is **no separate "upload"
   button** — the tile *is* the button. No `capture` attribute (web).
2. **Immediate, unconditional crop.** `handleSelectFile` sets `selectedFile`; `<CropModal file={selectedFile}>`
   opens the moment `Boolean(file) && Boolean(image)`. **There is no preview card, no "use as is"
   button, and no way to reach the server without passing through the cropper.**
3. **The cropper's geometry communicates the destination.** `ImageCropper.tsx` computes
   `previewContainerSize = Math.min(400, windowWidth - 2rem)` and uses it for **both** width and
   height — a square viewport, responsive to phone width. `ImageCropper.module.scss` then cuts the
   crop window to the *destination's* shape:

   ```scss
   .cropArea   { position:absolute; inset:0.125rem; overflow:hidden; border-radius:50%; box-shadow:0 0 .5rem #0004; }
   .previewMask{ position:absolute; inset:0; background:rgba(0,0,0,0.5); filter:blur(8px); }
   .backgroundImage { filter: blur(0.125rem) brightness(0.75); }
   ```

   i.e. the image is painted **twice** — a blurred, darkened copy underneath, and a sharp copy
   clipped to a **circle** (the avatar's real render shape) on top. Nothing says "this will be shown
   as a circle" in words; the window *is* the circle.
4. **The default state is "use as is".** `scaleFactor = Math.max(size/image.width, size/image.height)`
   — a **cover** fit — and `zoom` starts at `MIN_ZOOM = 100`, `imagePosition` at `{x:0, y:0}`.
   So the modal opens already showing the largest centred square the source can give. Confirming
   without touching anything yields exactly the un-edited crop.
5. **Two controls, no more.** A `RangeSlider` zoom `100 → 200` (**you can only zoom IN**, never out
   past cover — so an under-filled crop is structurally impossible) and one round ✓ `Button`.
   **No aspect presets. No free crop. No rotate. No reset.** Pan is by drag on the background image:
   `onMouseDown={startDrag} onTouchStart={startDrag}` — touch is first-class here.
6. **Cancel unwinds totally.** The modal has `hasCloseButton`; `onClose` → `setSelectedFile(undefined)`.
   Nothing is written, the previous avatar is untouched, and `target.value = ''` was already reset so
   re-picking the same file re-fires `change`.
7. **Output is clamped client-side.** `MIN_OUTPUT_SIZE = 256`, `MAX_OUTPUT_SIZE = 1024`;
   `outputSize = Math.min(max, Math.max(min, cropSize))`. The server never sees a 40 MP crop.

### 2.2 Notion — cover image + "Reposition" (VERIFIED docs / REPORTED affordance)

Notion's official help (`notion.com/help/customize-and-style-your-content`) documents **only**:

> "Hover over the top of any page and click `Add cover`." · "Hover over the cover that appears and
> choose `Change cover`." · "Click `Upload` to add your own image from your computer, or click
> `Link` to paste in the URL…"

**No crop step exists anywhere in the flow** — the file goes up as-is. And the FAQ states the reason
the reposition idiom exists at all:

> "**The cover images are dynamic depending on the width of your window, so there's no specific size
> that works best.** That said, we recommend using images at least 1,500 pixels wide."

The **"Reposition"** affordance itself (hover the cover → `Reposition` → drag the image up/down →
`Save position`) is **REPORTED** from third-party guides, *not* documented on Notion's own help page
I read. It is also **REPORTED desktop/web-only** — third-party sources consistently advise using
desktop to fine-tune cover positioning because mobile crops more aggressively.

**The finding that matters:** Notion's minimal focal-point idiom is (a) *undocumented by its own
vendor*, (b) *hover-gated*, and (c) *reportedly absent on phones*. Whatever its elegance on desktop,
it is not a phone-first pattern as shipped.

### 2.3 WordPress / Gutenberg — placeholder, gallery, focal point (VERIFIED, source at trunk)

**(a) The upload affordance is a documented two-state pattern.** `MediaPlaceholder`'s README
documents an explicit in-grid variant:

> **`isAppender`** — "If true, the property changes the look of the placeholder to be adequate to
> scenarios where new files are added to an already existing set of files, e.g., adding files to a
> gallery. If false the default placeholder style is used."

…but the Gallery block **does not use it at HEAD**. `gallery/edit.js` renders `<MediaPlaceholder>`
**only** inside `if ( ! hasImages && ! isDynamic )` — i.e. the empty state — and once there are
images the add-more path is `<MediaReplaceFlow … addToGallery={hasImageIds} />` inside
`<BlockControls group="other">`, i.e. **the block's toolbar**, the section-header equivalent. The
placeholder also carries the drop zone (`disableDropZone`, `dropZoneUIOnly` props exist to split
those two jobs).

**(b) Reorder is moved OUT of the inline grid.** The `addToGallery` prop doc:

> "If false the gallery media modal opens in the **edit mode where the user can edit existing
> images, by reordering them, remove them, or change their attributes**."

WordPress puts reorder + delete + per-file attributes into a **dedicated full-screen media modal**,
not into the inline grid. That is the same instinct as iOS edit mode (§3).

**(c) Focal point is a separate, container-scoped tool.** `FocalPointPicker`'s README states the job
exactly:

> "It addresses two common issues when displaying images in cropped containers. First, large
> background images can be cropped in undesirable ways, especially on smaller viewports such as
> mobile devices. Second, **the CSS aspect-ratio property can inadvertently crop out the area of
> highest visual interest.** … returns it as a pair of numbers between 0 and 1 … applied to either
> CSS `background-position` … or `object-position`."

Consumers at HEAD: the **Cover** block (`cover/edit/inspector-controls.js`,
`const showFocalPointPicker = isVideoBackground || isImageBackground;`) and **Media & Text**. It is
*not* on the featured-image block. WordPress's crop lives elsewhere entirely — the media library's
"Edit image" (crop/rotate/scale).

**(d) ⚠ A load-bearing defect for us: Gutenberg's focal-point drag is mouse-only.** `index.tsx`
binds `onMouseDown={startDrag}` and nothing else, and `packages/compose/src/hooks/use-dragging/index.ts`
registers `document.addEventListener('mousemove', …)` / `('mouseup', …)` — **no pointer or touch
events anywhere**. On a touchscreen the marker cannot be dragged; the working controls are the
numeric `Left` / `Top` percent `UnitControl`s in `controls.tsx` and the arrow-key nudge in
`arrowKeyStep` (`step = shiftKey ? 0.1 : 0.01`). The field's most-deployed focal-point picker is a
**desktop component**. (A 600 ms rule-of-thirds `Grid` overlay flashes on every value change —
`GRID_OVERLAY_TIMEOUT = 600` — a nice, cheap "what am I aiming at" cue.)

### 2.4 Shopify — the touch-workable focal point (VERIFIED docs) · Ghost — neither (REPORTED)

Shopify Help Center, *Uploading images*:

> "You can use focal points to define the most important part of an image on your online store. …
> **Focal points always display in frame, even if you have a theme that crops your image to fit the
> layout.** Focal points give you more control over the way your image displays on varying screen
> sizes, and in cases when themes use different aspect ratios."
>
> "**You can only have one focal point per image**, but you can change the focal point or remove it
> at any time."
>
> "**If you add a focal point to an image, and then use the image in multiple places on your online
> store, then the same focal point applies wherever you use the image.**"
>
> Step 2: "To select the part of the image where you want to set a focal point, **either click the
> image or drag the blue dot**." Step 3: "Click **Save**."

Three things to take: focal point is a property **of the image**, not of a use-site; it exists
*because the theme, not the user, decides the crop*; and — unlike Gutenberg — the interaction is
**tap-anywhere-to-set** with drag as a refinement, which is single-pointer and therefore touch-native
and WCAG 2.5.7-clean by construction. Shopify **also** ships a separate crop tool (the admin media
editor, with aspect-ratio presets) — **REPORTED**; the help page links it as the place aspect ratios
are explained.

**Ghost (REPORTED):** Ghost's admin ships **no crop and no focal point by default**. Image editing
arrived in 2023 as an integration with the third-party **Pintura** editor — free/automatic on
Ghost(Pro), and on self-hosted a *paid license* whose `pintura-umd.js` + `pintura.css` you upload in
Settings → Integrations. That a mature CMS treats crop as an optional bolt-on is a data point on how
far you can get without one.

### 2.5 Immich — the open-source management surface (VERIFIED, source at main)

**(a) Add-photos affordance = the same two states as WordPress.** In the album page:

- `{#if album.assetCount === 0}` → a large in-content card: a `<button>` with `mdiPlus` + the text
  `select_photos`, under a small `add_photos` label. That is the placeholder/appender form.
- Otherwise → an `IconButton` with `icon={mdiImagePlusOutline}` and `aria-label={$t('add_photos')}`
  in the `<ControlAppBar>`'s `trailing` snippet — i.e. **the header**.

**No in-grid `+` tile in either state.**

**(b) Delete: the reversible/irreversible split is written in code.** `DeleteAssetsAction.svelte`:

```svelte
const force = $derived(forceRequested || !featureFlagsManager.value.trash);
if (force && $showDeleteModal) {
  const confirmed = await modalManager.show(AssetDeleteConfirmModal, { size: assets.length });
  if (!confirmed) return;
}
```

`AssetDeleteConfirmModal.svelte` renders a `<ConfirmModal>` titled
`permanently_delete_assets_count`, body `permanently_delete_assets_prompt` **plus a bolded
`cannot_undo_this_action` line**, `confirmText: delete`, `icon: mdiDeleteForeverOutline`, and a
`do_not_show_again` **checkbox** that flips the `showDeleteModal` preference.

And `utils/actions.ts` decides the toast:

```ts
toastManager.primary({
  description: force ? $t('assets_permanently_deleted_count', …) : $t('assets_trashed_count', …),
  button: onUndoDelete && !force
    ? { label: $t('undo'), color: 'secondary', onclick: () => undoDeleteAssets(onUndoDelete, assets) }
    : undefined,
}, { timeout: 5000 });
```

**Reversible ⇒ toast *with* Undo, 5 s, no dialog. Irreversible ⇒ dialog first, then a toast with the
undo button explicitly `undefined`.** Note the "don't ask again" escape hatch only exists because
Immich's *ordinary* delete is trash — the suppressible confirm is not the only guard.

**(c) Upload progress: aggregate panel + per-file rows.** `UploadPanel.svelte` is a floating panel
(`fixed inset-e-16 bottom-6`) that appears while `$isUploading`, can be minimized, carries a
concurrency setting and a cancel button, and shows a header line of counts:
`upload_progress {remaining, processed, total}` plus `uploaded <success> - errors <errors> -
duplicates <duplicates>`. It **acquires a screen Wake Lock** for the duration
(`acquireWakeLock()` / `releaseWakeLock()`), and on the panel's exit transition fires summary toasts:
`toastManager.danger(upload_errors {count})` / `.primary(upload_success)` /
`.warning(upload_skipped_duplicates {count})`.

`UploadAssetPreview.svelte` is one row per file:

| state | leading 24 px icon | extra |
|---|---|---|
| `PENDING` | `mdiCircleOutline` | — |
| `STARTED` | `mdiLoading` (spin) | **determinate bar**, `width: {progress}%`, label overlay `message · {progress}% - {speed}/s - {eta}s` |
| `DONE` | `mdiCheckCircle` (success) | — |
| `DUPLICATED` | `mdiAlertCircle` (warn) or `mdiTrashCan` | open-in-new link + dismiss `mdiClose` |
| `ERROR` | `mdiAlertCircle` (danger) | **`mdiRestart` retry** + `mdiClose` dismiss, and the error text below in danger colour |

Retry is a real re-enqueue: `handleRetry` removes the item then calls
`fileUploadHandler({ files: [uploadAsset.file], albumId })`.

**(d) Immich does NOT do manual reorder** — albums sort by date asc/desc. It is not a reorder
reference; it is the delete/upload reference.

---

## §3 — Q1: Reorder on touch, 5–30 items, inside a scrollable settings page

### 3.1 The accessibility floor names our current implementation

**VERIFIED — W3C, WCAG 2.2 SC 2.5.7 *Dragging Movements*, Level AA:**

> "All functionality that uses a dragging movement for operation can be achieved by a single pointer
> without dragging, unless dragging is essential or the functionality is determined by the user agent
> and not modified by the author."

and, in the Examples list, verbatim:

> "**A sortable list of elements may, after tapping or clicking on a list element, provide adjacent
> controls for moving the element up or down in the list by simply tapping or clicking on those
> controls.**"

The Understanding doc is also explicit that keyboard support does **not** discharge this:

> "achieving keyboard equivalence for a dragging operation does not automatically meet this success
> criterion, unless that equivalent keyboard operation also provides controls that can be clicked or
> tapped with a pointer."

**Consequence for us: the `↑`/`↓` buttons already in `MediaGallery.tsx` are not a stopgap — they are
the pattern WCAG itself writes down. If drag is ever added, they (or an equivalent single-pointer
move control) must stay, at AA.**

**VERIFIED — WCAG 2.2 SC 2.5.8 *Target Size (Minimum)*, Level AA:** targets ≥ **24 × 24 CSS px**,
with a spacing exception (a 24 px-diameter circle centred on each undersized target must not
intersect another) and an "Equivalent" exception. **VERIFIED — Material 3 Foundations → Structure:**
"For most platforms, consider making touch targets at least **48 × 48dp**. A touch target this size
results in a physical size of about 9mm… The recommended target size for touchscreen elements is
7-10mm." plus the note "**iOS recommends 44 × 44dp targets.**" Android's accessibility guide repeats
48 dp. **Our stacked `↑`/`↓` pair is the place this bites** — two vertically adjacent controls in a
compact row is exactly the geometry SC 2.5.8 was written for.

### 3.2 What the field actually ships

**iOS gates reorder behind an explicit edit mode.** **VERIFIED — Apple HIG, *Lists and tables*:**

> "**Let people edit a table when it makes sense.** People appreciate being able to reorder a list,
> even if they can't add or remove items. **In iOS and iPadOS, people must enter an edit mode before
> they can select table items.**"

That is the field's *interaction-design* answer to the drag-vs-scroll conflict: don't make drag
smarter, make it **modal**. In edit mode the reorder handles appear on the trailing edge; outside it,
every touch is a scroll or a tap. Zero ambiguity, zero long-press latency, zero accidental lifts.

**Grids use long-press.** **VERIFIED — Apple HIG, *Collections*:** "By default, people can tap to
select, **touch and hold to edit**, and swipe to scroll." And: "**Consider using animations to
provide feedback when people insert, delete, or reorder items.** Collections support standard
animations for these actions."

**WordPress relocates reorder to a dedicated surface** — the media modal's edit mode (§2.3b).

**Material Design 3 offers nothing.** **VERIFIED NEGATIVE** — the M3 component index at HEAD lists
34 components (app-bars, badges, bottom-sheets, button-groups, buttons, cards, carousel, checkbox,
chips, date-pickers, dialogs, divider, extended-fab, fab, icon-buttons, lists, loading-indicator,
menus, navigation-bar/drawer/rail, progress-indicators, radio-button, search, segmented-buttons,
side-sheets, sliders, snackbar, switch, tabs, text-fields, time-pickers, toolbars, tooltips). **There
is no drag-handle component, no reorderable-list component, no file-upload component, no accordion,
and no image cropper.** The M3 *Lists* guidelines page contains no occurrence of "reorder" or "drag".
Everyone in this problem space is inventing.

### 3.3 The drag/scroll conflict has a named, spec-level mechanism

**VERIFIED — dnd-kit Pointer sensor docs, Recommendations §`touch-action`:**

> "In general, we recommend you set the `touch-action` property to `none` for draggable elements in
> order to prevent scrolling on mobile devices.
>
> **If your draggable item is part of a scrollable list, we recommend you use a drag handle and set
> `touch-action` to `none` only for the drag handle**, so that the contents of the list can still be
> scrolled, but that initiating a drag from the drag handle does not scroll the page.
>
> **Once a `pointerdown` or `touchstart` event has been initiated, any changes to the `touch-action`
> value will be ignored.** Programmatically changing the `touch-action` value for an element from
> `auto` to `none` after a pointer or touch event has been initiated will not result in the user
> agent aborting or suppressing any default behavior for that event for as long as that pointer is
> active (for more details, refer to the Pointer Events Level 2 Spec)."

**That second paragraph is the whole reason "long-press to lift, then drag" is hard on the web and
easy on native.** You cannot decide *after* the finger lands that this gesture is a drag: the
browser's touch-behaviour snapshot is already taken. The escapes are (a) a handle that was *always*
`touch-action: none`, or (b) a non-passive `touchmove` listener calling `preventDefault()` — which
fights the platform's passive-by-default listeners and is the classic source of "the page scrolls
under my drag" bugs. **The field takes (a).**

The **Touch** sensor doc adds the two mutually-exclusive activation constraints — `distance` (px
before drag starts) and `delay { delay, tolerance }` (ms held, px of slop) — and notes tolerance
"is particularly useful for touch input, where some tolerance should be accounted for when using a
delay constraint, as touch input is less precise than mouse input."

**Auto-scroll at the edges is a first-class default**, not a nice-to-have: dnd-kit ships
`useAutoScroller` with `AutoScrollActivator.{Pointer,DraggableRect}`, an `acceleration`, an
`interval`, an `{x, y}` proximity `threshold`, a `canScroll` predicate, per-ancestor traversal
`order`, and `layoutShiftCompensation` (VERIFIED, source read).

### 3.4 Grid or list at phone width?

**VERIFIED — Apple HIG, *Lists and tables*:** "If you have items that vary widely in size — or you
need to display a large number of images — consider using a **collection** instead." But the same
page's *Collections* counterpart says: "**Consider using a table instead of a collection for text.**
It's generally simpler and more efficient to view and digest textual information when it's displayed
in a scrollable list."

Our rows are **not** bare thumbnails — every row carries filename, `640×854 · 88 KB`, the bound key,
and up to four advisory badges (`unreadable`, `wrong extension (jpeg)`, `large file`,
`very large image`, `no match`, `duplicate`). That is textual information, and a grid cell at
390 px / 3 columns cannot hold it. Against that, 5–30 thumbnails in a list is 5–30 × ~72 px of
scroll inside a section that is itself inside a settings page.

**Recommendation: keep the LIST.** Reasons, in order of weight: (1) the row's text is the point —
half the gallery's job is telling the owner a file is broken, and HIG says text belongs in a table;
(2) reorder in a 1-D list is a 2-button problem, reorder in a 2-D grid is a 4-button problem and
WCAG 2.5.7's named example is the *list* one; (3) 5–30 rows is short enough that vertical scan
beats density. If a grid is ever wanted for a purely-decorative role, make it a *per-role* render
choice, not a gallery-wide one.

### 3.5 Concrete recommendation for reorder

1. **Keep `↑`/`↓` permanently.** They are the WCAG-named alternative, they already work, and they
   cost nothing. Fix the target size: give each a ≥ 44 px (ideally 48 px) hit area, or space them so
   the SC 2.5.8 spacing exception applies.
2. **Add "Move to top" / "Move to bottom"** to a per-row overflow menu. This is the cheapest fix for
   the buttons' one real weakness (bottom→top in a 30-item role = 29 taps) and it stays
   single-pointer. WCAG's own third example blesses exactly this shape ("provides an additional
   pop-up menu after tapping or clicking on items for moving the selected element…").
3. **If drag is built, build it handle-only** — a dedicated grip on the row's trailing edge with
   `touch-action: none` on *the handle alone*, the row itself left `auto` so the section still
   scrolls; plus edge auto-scroll; plus a distance or delay+tolerance activation constraint.
   Do **not** attempt long-press-to-lift on the row body: the Pointer Events snapshot rule makes it
   structurally fragile in a browser.
4. **Consider the iOS lever instead of, or before, drag**: a per-section **"Reorder" toggle** in the
   section header that swaps the rows into a compact reorder mode (handles + move buttons visible,
   thumbnails shrunk, badges hidden). This is the highest-confidence pattern in the dossier — Apple
   ships it, WordPress ships its media-modal equivalent — and it removes the conflict rather than
   mitigating it.
5. **Animate the move.** HIG *Collections* explicitly asks for insert/delete/reorder feedback
   animation. Our existing `busy` gate (save-in-flight blocks reorder) already prevents the
   double-move race; an animation makes the blocked interval legible instead of dead.

---

## §4 — Q2: The upload affordance

### 4.1 What the reference products do

**Two independent products, one pattern (both VERIFIED at HEAD):**

| | empty | non-empty |
|---|---|---|
| **WordPress Gallery block** | `<MediaPlaceholder>` — full-width card: icon, title "Gallery", instructions, **Upload / Media Library** buttons, and a drop zone over the whole block | `<MediaReplaceFlow>` in `<BlockControls group="other">` — **the block toolbar** |
| **Immich album** | in-content card `[ + ] Select photos` under an `ADD PHOTOS` label | `IconButton mdiImagePlusOutline aria-label="add photos"` in the **`ControlAppBar` trailing slot** |

**Neither ships a `+` tile inside the grid at HEAD.** WordPress *documents* the in-grid variant
(`isAppender`: "changes the look of the placeholder to be adequate to scenarios where new files are
added to an already existing set of files, e.g., adding files to a gallery") and Gutenberg still
exports it — but the Gallery block does not use it, and the whole grid is inner blocks with
`renderAppender: false`.

**Telegram's avatar is the degenerate case** — one file, so the *tile* is the upload control
(`<label>` around a hidden `<input type="file">`); there is no separate button at all.

### 4.2 When a section also has non-upload controls

Our sections carry pins (`<select>` dropdowns) and, for `named` roles, a key panel. The evidence
says: **put the upload control in the section header, on the same line as the role name, and keep
the pins where they are.** Rationale, grounded rather than aesthetic:

- Both references put the add control in the surface's **chrome** (toolbar / app bar) precisely so it
  does not compete with the content's own per-item controls. The pins are per-*binding* controls, not
  per-*file*; an in-grid `+` tile would sit in the file list and read as a file.
- The header is also where the collapsed-state summary must live (§8) — so the header is already the
  section's status line, and "3 files · 1 broken · [+]" is one coherent strip.
- An in-grid appender competes with reorder: in a list, an appender row would be a row that cannot
  be moved, which is exactly the kind of exception that makes `↑`/`↓` bounds logic subtle.

**Keep the empty-state placeholder as a real affordance.** Our current empty state is a *sentence*
("Empty — the theme uses its bundled art. Copy .png/.jpg/.webp files into this folder."). Both
references make the empty state a **large tappable card**. Making it tappable is nearly free and
matches the field exactly; the existing sentence becomes the card's instruction line, and the
`media/<ns>/<role>/` path stays (it is still the out-of-band route and the only documentation of the
folder contract).

**Drop-zone note (VERIFIED):** Gutenberg splits the two jobs with `disableDropZone` and
`dropZoneUIOnly`, so the placeholder can be a drop zone without buttons or buttons without a drop
zone. Worth copying as a shape if desktop drag-drop is ever wanted; it is irrelevant on the phone.

**A negative worth recording (VERIFIED):** Material Design 3 ships **no upload component**. There is
no house pattern to conform to; the two products above *are* the convention.

---

## §5 — Q3: The crop-or-use-as-is step

### 5.1 Nobody ships a "skip crop" button — the default IS the skip

Telegram's cropper (§2.1) is the reference implementation of the ruled behaviour, and it achieves
"crop OR use as is" **without a second button**: the modal opens at `zoom = 100`, `position = {0,0}`,
`scaleFactor = Math.max(w-fit, h-fit)`. That state is a centred cover crop of the whole image — i.e.
exactly what "use as is" means for a fixed-ratio destination. Tap ✓ and you have used it as-is; drag
and zoom first and you have cropped. **Two verbs, one button.**

This is a real simplification over a "preview card with two buttons" design, and it is what the field
converged on. The one thing it costs: if the source's aspect ratio already matches the destination,
the cropper is a no-op screen the user must dismiss. For a role whose bound is `1:1` and a source
that is `1:1`, that is one extra tap. Telegram eats that cost; so should we.

### 5.2 The crop screen's affordance budget is tiny

Telegram Web A, complete: **zoom slider (100–200 %) + confirm ✓ + modal close ×**. That is all.
No aspect presets (there is one aspect and it is the destination's), no free crop, no rotate, no
straighten, no reset, no undo. `MIN_ZOOM = 100` is doing quiet work — it makes an under-filled crop
unrepresentable, so there is no "letterboxed avatar" failure mode to handle downstream.

Ghost's counter-example (REPORTED) is instructive in the other direction: when Ghost finally added
crop it bought a *whole* editor (Pintura — crop, rotate, resize, filters, annotations) rather than
building a small one. **The field's two shapes are "a 200-line fixed-aspect cropper" and "an
off-the-shelf editor". There is no popular middle.** (Which library sits in the first slot is R54.)

### 5.3 How "this will be shown as X" is communicated: geometry, not words

**VERIFIED, Telegram Web A `ImageCropper.module.scss`:** the crop window is
`border-radius: 50%` — the avatar's actual render shape — with `overflow: hidden`, and the image
outside it is painted as a **blurred, darkened** copy (`filter: blur(0.125rem) brightness(0.75)`)
under a `rgba(0,0,0,0.5)` + `blur(8px)` mask layer. Nothing is labelled. The user sees the
destination.

**The generalisation for our fixed-aspect roles:** cut the crop window to the role's declared aspect
ratio (and, where the surface rounds or clips, to the role's actual clip — a circle for a circular
avatar slot, the poster's rounded rect for a poster), dim + blur everything outside it, and let the
window itself be the sentence. If a word is wanted, the role's existing registry `hint` is the place
for it, shown once above the window — not a per-frame overlay.

Gutenberg's `Grid` overlay (rule-of-thirds, shown for `GRID_OVERLAY_TIMEOUT = 600` ms after each
value change, VERIFIED) is the cheap composition aid if one is ever wanted; it costs 3 lines of CSS
and no interaction.

### 5.4 Cancel

Telegram: modal `hasCloseButton` → `onClose` → `setSelectedFile(undefined)`. **Nothing partial
survives.** The two mechanics worth copying verbatim:

- **`target.value = ''` immediately after reading `files[0]`** (Telegram does this in
  `handleSelectFile`). Without it, cancelling and re-picking *the same file* fires no `change` event
  and the flow silently dead-ends. This is the single most common bug in this pattern.
- **The blob URL is revoked on replace** (`URL.revokeObjectURL(croppedBlobUrl)` guarded by
  `croppedBlobUrl !== currentAvatarBlobUrl`) — a leak that only shows up after many rounds.

**M3 dialogs (VERIFIED)** back the modal choice: "Use dialogs for prompts that block an app's normal
operation, and for critical information that requires a specific user task, decision, or
acknowledgement." A crop *is* a required decision blocking the upload. And for the discard case: "When
someone dismisses a full-screen dialog, a basic dialog should appear to confirm that they want to
discard the unsaved changes." — worth *not* copying here: at zoom 100 / position 0,0 there is nothing
to discard, so a second confirm should only appear if the user actually moved something.

---

## §6 — Q4: Delete — confirm dialog vs undo toast

### 6.1 The guidelines agree, and they agree with each other

**VERIFIED — Apple HIG, *Alerts*, the decisive sentence:**

> "**Avoid displaying alerts for common, undoable actions, even when they're destructive.** For
> example, you don't need to alert people about data loss every time they delete an email or file
> because they do so with the intention of discarding data, and they can undo the action. **In
> comparison, when people take an uncommon destructive action that they can't undo, it's important to
> display an alert in case they initiated the action accidentally.**"

Our case is *uncommon* (settings, occasional) and *cannot be undone* (server file deletion is final,
per the brief). That is the second clause verbatim.

**VERIFIED — Apple HIG, *Action sheets*** (the iOS variant when there are choices, not just OK/Cancel):

> "**If necessary, provide a Cancel button that lets people reject an action that might destroy
> data.** Place the Cancel button at the bottom of the action sheet…"
>
> "**Make destructive choices visually prominent.** Use the destructive style for buttons that perform
> destructive actions, and place these buttons at the top of the action sheet where they tend to be
> most noticeable."

**VERIFIED — M3 Dialogs guidelines:** "A dialog is a modal window that appears in front of app
content to provide critical information or ask for a decision." · the priority table: Dialog =
"High importance / Required: Dialogs block the main content until an action is confirmed" vs
Snackbar = "Low importance / Optional". · Button order: "Buttons are aligned to the trailing edge of
the dialog for easier interaction. The confirmation button is always closest to the edge." and
"**Don't place dismissive actions to the right of confirming actions.** Instead, place them to the
left." · Copy: "The confirmation action should be clear about what happens next, like **Send** or
**Create**. **Avoid using vague terms like Done, OK, or Close.**"

### 6.2 The undo-snackbar is not available to us, and M3 says so twice

**VERIFIED — M3 Snackbar guidelines, Behavior:**

> "Snackbars without actions can auto-dismiss after 4–10 seconds, depending on platform. **Avoid
> using auto-dismissing snackbars on web unless there's also inline feedback.**"
>
> "**Snackbars with actions should remain on the screen until the user takes an action on the
> snackbar, or dismisses it.**"

and, under *Accessibility requirements for web*:

> "On web, auto-dismissing snackbars are inaccessible for people with low vision or who require
> additional time to perceive information."

So an M3-correct undo snackbar on the web **does not time out** — which means an undo affordance
implies a *server-side grace period of unbounded length*, i.e. a trash. We do not have one, and
building one is R55's problem, not this dossier's. **Without a trash there is no honest undo, and a
5-second window on an irreversible file delete is a worse guard than a dialog, not a better one.**

### 6.3 What the reference product ships

Immich's code (§2.5b) is the rule as an `if`:

- reversible (trash) → **no dialog**, toast with `{ label: undo }`, `timeout: 5000`
- irreversible (`force`) → **`AssetDeleteConfirmModal` first**, body includes a bolded
  `cannot_undo_this_action`, then a toast whose `button` is explicitly `undefined`

The `do_not_show_again` checkbox exists **only** on the irreversible path *and* only because the
ordinary path is a trash — the user who suppresses it has already accepted that trash is their
safety net. **Do not copy the checkbox** into a system with no trash: it converts the only guard into
a one-tap-away nothing.

### 6.4 Recommendation

**Modal confirm. No undo toast. No suppress-checkbox.** Concretely:

- Title states the irreversible verb and the count/name: `Delete cosmos/cast/reisalin.png?` (a role
  can hold 30 near-identical filenames; the *name* is the disambiguator, and our row already has it).
- Body: one bolded line, "This permanently deletes the file from the server. It cannot be undone."
- Buttons: dismissive left, destructive-styled confirm right/trailing, labelled **Delete** — never
  "OK" (M3: "Avoid using vague terms like Done, OK, or Close").
- After success: a plain, non-actionable confirmation. Per M3's web accessibility note, pair it with
  **inline feedback** — the row disappearing from the list *is* that inline feedback, so a toast is
  optional here rather than required.
- **Where the delete control lives** is a separate call. Immich uses a selection mode (`Select` →
  multi-select → a delete button in the selection bar) — that is the phone-native pattern for a
  *photo library*. For 5–30 rows in a settings page, a per-row overflow menu (`⋯` → Delete) is
  cheaper and avoids introducing a second modal mode beside a possible reorder mode. Selection mode
  earns its keep only if bulk delete is wanted.

---

## §7 — Q5: Progress and failure

### 7.1 The guideline says one indicator for the group

**VERIFIED — M3 Progress indicators guidelines, Usage:**

> "Use progress indicators to show the status of ongoing processes, such as loading an app,
> submitting a form, or saving updates.
>
> **When multiple items are loading, use a single progress indicator to show progress for the group.
> Don't add progress indicators to every activity.**"

and on the determinate/indeterminate choice:

> "**Determinate**: Known progress and wait time · **Indeterminate**: Unknown progress and wait time.
> When using a determinate indicator, the indicator must accurately represent the progress of what
> it's measuring. Use indeterminate indicators to show that a process is happening, but the wait time
> is unknown. … **As more information about a process becomes available, a progress indicator should
> change from indeterminate to determinate.**"

### 7.2 What Immich ships (and why it is more than we need)

Immich runs *both* levels: a group header (`{remaining} / {processed} / {total}` + success/error/
duplicate counts) **and** a per-file determinate bar with speed and ETA. But Immich uploads hundreds
of files over the internet from a phone. **We upload 1–3 files, post-crop, clamped to ≲1 MB, over the
tailnet.** On a LAN the determinate bar's honest lifetime is a few hundred milliseconds — at which
point M3's "indeterminate until you know" rule and the group rule both point the same way.

**Recommendation:**

1. **Single indicator per section while a section's upload is in flight** — an indeterminate linear
   bar under the section header, or the section's existing `busy` treatment extended. Do not put a
   bar on the tile.
2. **Promote to determinate only if the upload is measurably slow** (i.e. only if we actually wire
   `XMLHttpRequest.upload.onprogress`; `fetch` has no upload progress). Given the transport, don't
   bother in v1 — M3 explicitly sanctions starting indeterminate.
3. **Per-file rows appear only on failure**, in Immich's exact shape: the filename, a danger-coloured
   error line, and **two controls — retry and dismiss**. Immich's retry is a genuine re-enqueue of the
   original `File` object, so hold the `File` until the row is dismissed.
4. **The queue is trivially serial for us.** Immich's configurable `uploadExecutionQueue.concurrency`
   is a WAN artefact. A serial queue with a 3-item cap is enough and makes "which file failed"
   unambiguous.
5. **Skip the Wake Lock.** Immich acquires one for the duration; at our file sizes and on a tailnet,
   that is a permission surface bought for a sub-second operation. Recorded as a *deliberate
   divergence*, not an oversight.
6. **Summary on completion** (Immich fires `upload_errors {count}` / `upload_success` /
   `upload_skipped_duplicates {count}` toasts as the panel leaves). For us the section re-rendering
   with the new row *is* the summary; a toast is only needed for the failure case, and §7.3 covers it.

### 7.3 Failure surfacing, and the thing our gallery already does better than the field

Our existing badge vocabulary (`unreadable file`, `wrong extension (jpeg)`, `large file`,
`very large image`, plus the `format-mismatch` probed-format rider) is a **post-hoc file-health
report** that no reference product ships — Immich reports upload *transport* outcomes and nothing
about whether the stored file will actually render. **That is an asset, and the upload flow should
feed it rather than duplicate it:** on upload success, the row appears with its badges already
computed by the existing server index refetch. An upload that *succeeds* but lands a file the role
will not render is then visible immediately, with the same words as a file dropped in over SSH.

---

## §8 — Q6: Collapsible sections in a settings page

### 8.1 The hard rule, and the one that saves us

**VERIFIED — GOV.UK Design System, *Accordion*, "When not to use this component":**

> "**Accordions hide content from the user. Not all users will notice them or understand how they
> work.** For this reason, you should only use them in specific situations and if user research
> supports it.
>
> **Do not use an accordion for content that all users need to see.**"
>
> "Do not put accordions within accordions, as it will make content difficult to find."
>
> "Do not use the accordion component if the amount of content inside will make the page slow to
> load."

The brief's stated risk — "a collapsed section that hides *your file is broken* warnings" — is
**exactly** the failure mode GOV.UK's rule names. The resolution GOV.UK itself provides is the
**summary line**:

> "The heading button includes all of these areas: **heading text**, **summary line (if you decide to
> add one)**, **call-to-action text to 'show' or 'hide'**. For users of screen readers, all the text
> in the button will be read as a single statement (separated by commas to allow for slight pauses)."

and in the macro options:

> `summary` — "The summary line of each accordion section." · `summary.html` — "The summary line HTML
> content of each section. **The summary line is inside the HTML `<button>` element, so you can only
> add phrasing content to it.**"

**So the collapsed header is a first-class content slot in the field's most conservative design
system, it is announced as part of the header button, and it accepts phrasing content — a count, a
badge, a warning.** That is precisely where per-section status goes.

### 8.2 Multi-open, and remembered

**VERIFIED — GOV.UK, "Decide between using accordions, tabs and details":**

> "consider if: the user needs to look at more than one section at a time — **an accordion can show
> multiple sections at a time, unlike tabs**"

**VERIFIED — NN/g, *Accordions Are Not Always the Answer…*, "Criteria for Applying Accordions":**

> "If you do use accordions, **make sure to give people the capability to open multiple sections at a
> time** so that different chunks of content are readily available. **Items that are opened or closed
> should remain in that state until the user changes it.**"

**⇒ No auto-collapse of siblings. Ever.** The "only one open at a time" behaviour is a tabs
behaviour, and both sources say so.

**Persistence is field practice, not a nicety.** GOV.UK's accordion persists across *page loads*:

> "(as the expanded state of individual instances of the component persists across page loads using
> **session storage**)" — documented as the reason the accordion's `id` "must be unique across the
> service's domain".

Per-section default: GOV.UK's `expanded` boolean "Sets whether the section should be expanded when
the page loads for the first time. **Defaults to false**", and "An accordion will usually start with
all sections hidden." GOV.UK also ships a **"Show all sections / Hide all sections"** master toggle
above the first header.

### 8.3 Accordions are the *right* choice on a phone

**VERIFIED — NN/g:**

> "Another situation in which accordions are helpful is when the information is restricted to very
> small spaces, such as on mobile devices. On small screens people often stop scrolling before
> reaching the end of an extremely long page. … Collapsing the information is a better alternative:
> it minimizes excessive scrolling and gives users an overview of the content available on the page.
> Reading on mobile is twice as difficult, and the mini-IA provided by the accordions helps readers
> understand the structure of the page."

Against which NN/g's cost list stands: "Accordions increase interaction cost" · "**Hiding content
behind navigation diminishes people's awareness of it.** An extra step is required to see the
information. Headings and titles must be descriptive and enticing enough to motivate people to
'spend' clicks on them. **When content is hidden, people might ignore information.**"

**VERIFIED — Apple HIG, *Disclosure controls*:** "**Use a disclosure control to hide details until
they're relevant.** Place controls that people are most likely to use at the top of the disclosure
hierarchy so they're always visible, with more advanced functionality hidden by default."

**VERIFIED NEGATIVE:** Material Design 3 has **no accordion / expansion-panel component** (see the
34-component inventory in §3.2). Material 2 had "Expansion panels"; M3 dropped it (**REPORTED** —
the M2 page exists, I did not confirm a deprecation note).

### 8.4 Recommendation for our sections

- **Multi-open, never exclusive.** All collapsed by default on first visit; state persisted (our
  `UIState` store is the existing home for a device-local pref of exactly this kind — do not reach
  for `sessionStorage` beside it).
- **The collapsed header is a status line, not just a label.** Compose it as
  `<role name> · <n> files · <badge>` where the badge is present **only** when the section holds
  something the owner must act on — an unusable file, a `no match` in a `named` role, a pin naming a
  missing file. This satisfies GOV.UK's "do not hide content all users need to see" without
  un-collapsing anything, and it is what the `summary` slot is for.
- **A section with a problem should probably open itself once.** GOV.UK's per-section `expanded`
  boolean is exactly this lever, and it is honest: the section *is* relevant. (Do this on first load
  only; never fight a user who has collapsed it.)
- **Semantics:** the header must be a `<button>` inside a heading, with `aria-expanded` and
  `aria-controls`, and the summary must live *inside* the button so screen readers announce it with
  the heading (GOV.UK's phrasing-content constraint). Our current `<div className="mgal-head">` with
  a `<b>` is not that.
- **No nested accordions** — the key panel and the pins stay flat inside their section.
- The section-level **upload control** goes in this same header strip (§4.2). Note it must be a
  sibling of the disclosure button, not inside it — a `<button>` cannot contain a `<button>`.

---

## §9 — Q7: Focal point after upload — one or both?

### 9.1 The field ships both, and scopes them differently

| Product | crop | focal point | what decides the render ratio |
|---|---|---|---|
| WordPress | ✅ media library "Edit image" (crop/rotate/scale) | ✅ `FocalPointPicker` — **Cover** + **Media & Text** blocks only | the *container* (block width × chosen aspect / viewport) |
| Shopify | ✅ admin media editor w/ aspect presets (**REPORTED**) | ✅ one per image, set in Files / theme editor / product media / metafields | the *theme section* |
| Telegram | ✅ mandatory, fixed square | ❌ | fixed, known: a circle |
| Notion | ❌ | ~ "Reposition" (**REPORTED**, undocumented, **reportedly desktop-only**) | the *window width* — Notion says so |
| Ghost | ~ optional paid Pintura add-on (**REPORTED**) | ❌ | — |
| Immich | ❌ | ❌ | — |

**The discriminator is not taste, it is who owns the aspect ratio.** Three independent primary
sources say the same thing in their own words:

- **Gutenberg** `FocalPointPicker` README: "It addresses two common issues when displaying images in
  cropped containers. First, large background images can be cropped in undesirable ways, **especially
  on smaller viewports such as mobile devices**. Second, **the CSS aspect-ratio property can
  inadvertently crop out the area of highest visual interest.**"
- **Shopify** help: "**Focal points always display in frame, even if you have a theme that crops your
  image to fit the layout.** Focal points give you more control over the way your image displays on
  **varying screen sizes**, and in cases when **themes use different aspect ratios**."
- **Notion** help FAQ: "**The cover images are dynamic depending on the width of your window, so
  there's no specific size that works best.**"

Conversely, Telegram — whose destination is a *known circle* — ships a cropper and **no** focal point,
and its cropper is 200 lines.

### 9.2 The other axis: focal point is a property of the IMAGE

Shopify states it outright: "If you add a focal point to an image, and then use the image in multiple
places on your online store, then the same focal point applies wherever you use the image." and "You
can only have one focal point per image." Crop, by contrast, is destructive and per-use: WordPress's
"Edit image" writes a new attachment.

### 9.3 The two touch findings that constrain any focal-point build

- **Gutenberg's picker cannot be dragged on a touchscreen (VERIFIED).** `onMouseDown` only;
  `useDragging` registers `document` `mousemove`/`mouseup` and nothing else. The touch-usable
  controls are the `Left`/`Top` percent inputs and arrow-key nudge.
- **Notion's Reposition is reportedly desktop-only (REPORTED)** and is not documented on Notion's own
  help page at all.
- **Shopify's is touch-native by construction**: "either **click the image** or drag the blue dot" —
  a tap sets the point. That is the single-pointer form WCAG 2.5.7 requires anyway.

**⇒ If we build one, it is tap-to-set-plus-optional-drag, never drag-only.** The Notion "grab and
slide the banner" idiom is the one to *not* copy.

### 9.4 The evidence-based answer for our gallery

The brief says "the target surfaces have **fixed aspect ratios per role**". Under the field's own
discriminator, that means:

- **For a fixed-ratio role, crop-at-upload is complete and a focal point adds nothing.** Both
  functions answer "which part of this image survives the crop"; when the ratio is known once, crop
  answers it once, permanently, and cheaply.
- **For any role that renders at the viewport's ratio — a full-bleed background — the reverse holds.**
  A phone in portrait, the same phone in landscape, and a tablet are three different crops of one
  file; no single crop can serve them, which is Notion's stated situation verbatim. If any of our
  roles is viewport-filling, **that role wants a focal point and does not want a crop**, and the
  registry already has the right place to say which (`MediaRoleDef` — the same row that carries
  `bounds`, `hint`, `asset`, `keys`).
- **Cheapest correct v1:** build crop; make the crop window's shape come from the role's declared
  ratio; and record focal point as an *additive per-role capability* (`RoleDef.focal?: true`) rather
  than a gallery-wide feature. This is the "shape data to extend, not to migrate" directive applied
  to a UI capability, and it means the decision "do we build it at all" becomes "do we have a
  variable-ratio role", which is a fact about the registry, not a preference.
- The wire format is settled by the field and is trivially compatible with our settings write path:
  `{x, y}` in `0..1`, applied as `object-position: ${x*100}% ${y*100}%` (Gutenberg README, verbatim).

**Bottom line: the field ships one OR the other per surface, and ships both per PRODUCT — because
products contain both kinds of surface. So do we.**

---

## §10 — Bounded open sweep (3 findings, none of the numbered questions asked about)

**① The file input must be reset immediately, or cancel-then-repick silently dead-ends.**
**VERIFIED** — Telegram's `handleSelectFile` does `setSelectedFile(target.files[0]); target.value = '';`
on the same tick. Without the reset, a user who opens the cropper, cancels, and picks *the same file*
again fires no `change` event (the input's value is unchanged) and nothing happens. This is a
one-line fix that is invisible in testing unless you specifically test cancel→same-file, and it is
the most likely first bug in this slice.

**② `capture` must stay absent — but omitting it does not remove the camera from Android's picker.**
**VERIFIED — MDN, `<input type="file">`:** "The `capture` attribute value is a string that specifies
which camera to use for capture of image or video data, if the `accept` attribute indicates that the
input should be of one of those types. … **If this attribute is missing, the user agent is free to
decide on its own what to do.**" The owner's "no camera capture" ruling means *do not set `capture`*;
it does **not** mean the Android chooser will hide the camera — with `accept="image/*"` Chrome on
Android routinely offers Camera as a source. If the ruling's intent is "the camera must not appear",
that is not achievable through the file input, and the ruling should be re-read as "we do not build a
camera path", which is what omitting `capture` gives.

**③ EXIF orientation is the classic canvas-crop bug, and the mitigation is a one-word option.**
**VERIFIED — MDN, `createImageBitmap()` options:** `imageOrientation` accepts `from-image` — "Image
oriented according to EXIF orientation metadata, if present (**default**)" — and `none` — "Image
oriented according to image encoding, **ignoring any metadata about the orientation (such as EXIF
metadata, that might be added to an image to indicate that the camera was turned sideways to capture
the image in portrait mode)**". Phone photos are routinely stored landscape-with-an-EXIF-rotation-flag.
A cropper that decodes via `createImageBitmap(blob)` gets the corrected orientation for free at
HEAD-era browsers; one that hand-rolls a decode path, or that assumes the old `"none"` default, ships
sideways crops for exactly the source the owner is most likely to use (a photo from the phone).
**UNVERIFIED:** whether `ctx.drawImage(HTMLImageElement)` also honours EXIF in current Gecko/Blink —
believed yes since the `image-orientation: from-image` default landed, but I did not probe it. **This
is a 10-minute device probe worth running before the crop slice is accepted**, with a portrait phone
photo as the fixture.

---

## §11 — Implications for ctrl-b (short, and separable from the evidence above)

*Evidence ages slowly; this reading ages fast.*

1. **Shape:** stay a **list**, not a grid. Our rows are half text and the text is the diagnostic.
2. **Reorder:** the `↑`/`↓` buttons stay permanently (WCAG names them). Add **Move to top / Move to
   bottom** in a per-row `⋯` menu — that is the cheap fix for the 30-item case. Consider a per-section
   **Reorder mode** (iOS's answer) before considering drag. If drag ships, it is **handle-only**,
   `touch-action: none` on the handle alone, with edge auto-scroll. Fix the `↑`/`↓` hit areas to
   ≥44 px while we are in there (SC 2.5.8).
3. **Upload:** one control in each **section header**; the empty state becomes a **tappable
   placeholder card** carrying the existing sentence and the `media/<ns>/<role>/` path. No in-grid
   `+` tile. Pins stay where they are.
4. **Crop:** immediate modal on file pick; crop window cut to the **role's** ratio/shape with the
   outside dimmed+blurred; **cover-fit default = "use as is"**, zoom-in only, one ✓; close = total
   unwind; clamp the output size client-side; reset `input.value` on read.
5. **Delete:** **modal confirm**, name in the title, "cannot be undone" bolded, destructive-styled
   **Delete** (never "OK"), dismissive on the left. **No undo toast** (we have no trash and M3 forbids
   the timed version on web) and **no "don't ask again"** (Immich only affords that because trash
   catches the mistake).
6. **Progress:** one **indeterminate** indicator per section while its upload is in flight; per-file
   rows **only on failure**, carrying **retry + dismiss** in Immich's shape; serial queue; no Wake
   Lock. Let the existing badge vocabulary report file health after the fact.
7. **Sections:** multi-open, state persisted in `UIState`, all collapsed on first visit; the
   **collapsed header carries `n files` + a warning badge** whenever the section holds an unusable
   file, a `no match`, or a pin naming a missing file; a section with a problem may auto-open once on
   first load. Header = a real `<button>` in a heading with `aria-expanded`/`aria-controls`, the
   summary inside it, the upload control as a **sibling**.
8. **Focal point: don't build it as a gallery feature.** Build crop; make focal point an additive
   `MediaRoleDef` capability that only viewport-filling roles opt into. If built, it is
   **tap-to-set** (Shopify's form), stored `{x, y}` in `0..1`, applied as `object-position` — never
   drag-only (Gutenberg's form is mouse-only and Notion's is desktop-only).

---

## §12 — What I could not determine

- **Whether any product ships a "use as is" button beside a cropper.** I found none in five products,
  but "I did not find one" is not "none exists" — I read Telegram's implementation and inspected
  four others' documented flows. The *pattern* (cover-fit default = the skip) is well evidenced; the
  *absence* of an explicit skip button is a weaker claim.
- **Telegram Android / iOS and Signal's native avatar flows** — not read. The web client is what I
  verified; I did not confirm that the native clients share the "no skip, cover-fit default" shape,
  though the web client is a faithful port in most other respects.
- **Notion's "Reposition"** — REPORTED throughout. Notion's own help documents `Add cover` /
  `Change cover` and nothing else; every step of the reposition interaction, and its desktop-only
  scope, comes from third-party guides. I could not verify it first-hand (no account).
- **Shopify's crop tool** — REPORTED. The help page links "understanding image aspect ratio" in the
  media editor; I did not read that page or confirm the presets.
- **Whether M2's "Expansion panels" were formally deprecated in M3** or merely not carried over — I
  verified the M3 inventory has no accordion; I did not find a deprecation statement.
- **Whether `ctx.drawImage(HTMLImageElement)` honours EXIF orientation on current Gecko/Blink** —
  believed yes, not probed. §10③ names the 10-minute device probe.
- **Any measured numbers.** Nothing here is a benchmark: no frame costs for drag on mid-range
  Android/Gecko, no measured upload durations over the tailnet, no target-size failure counts against
  our current CSS. The 44/48 px recommendation in §3.5 is a guideline figure, not a measurement of
  `mgal-move button`.
- **Accordion research beyond NN/g's 2014 piece and GOV.UK's guidance.** Both are strong, but neither
  is a study of *accordions containing interactive, mutable content* — which is our case and is
  materially different from accordions containing prose. No source I found addresses it directly.
- **The `MediaGallery` sections' current DOM is not an accordion at all** (they are always-open
  `<section>`s), so every §8 recommendation is net-new markup, not an amendment. I did not scope that
  work.

---

## §13 — Source index

**Specs / guidelines**
- WCAG 2.2 Understanding SC 2.5.7 Dragging Movements — https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
- WCAG 2.2 Understanding SC 2.5.8 Target Size (Minimum) — https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- M3 Snackbar guidelines — https://m3.material.io/components/snackbar/guidelines
- M3 Dialogs guidelines — https://m3.material.io/components/dialogs/guidelines
- M3 Progress indicators guidelines — https://m3.material.io/components/progress-indicators/guidelines
- M3 Foundations → Designing → Structure (touch/pointer targets) — https://m3.material.io/foundations/designing/structure
- M3 components index (the negative) — https://m3.material.io/components
- material-components-android `docs/components/Snackbar.md`, `Dialog.md` @ master
- Android accessibility guide (48 dp) — https://developer.android.com/guide/topics/ui/accessibility/apps
- Apple HIG — Alerts · Action sheets · Lists and tables · Collections · Disclosure controls —
  https://developer.apple.com/design/human-interface-guidelines/{alerts,action-sheets,lists-and-tables,collections,disclosure-controls}
- GOV.UK Design System — Accordion — https://design-system.service.gov.uk/components/accordion/
- NN/g — Accordions Are Not Always the Answer for Complex Content on Desktops (2014-05-18) —
  https://www.nngroup.com/articles/accordions-complex-content/
- MDN — `createImageBitmap()` · `<input type="file">`

**Product source (HEAD, read 2026-08-24)**
- `Ajaxy/telegram-tt` master — `src/components/ui/{AvatarEditable.tsx,CropModal.tsx,ImageCropper.tsx,ImageCropper.module.scss}`
- `immich-app/immich` main — `web/src/lib/modals/AssetDeleteConfirmModal.svelte`,
  `web/src/lib/components/timeline/actions/DeleteAssetsAction.svelte`, `web/src/lib/utils/actions.ts`,
  `web/src/routes/{UploadPanel.svelte,UploadAssetPreview.svelte}`,
  `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- `WordPress/gutenberg` trunk — `packages/components/src/focal-point-picker/{README.md,index.tsx,controls.tsx}`,
  `packages/compose/src/hooks/use-dragging/index.ts`,
  `packages/block-editor/src/components/media-placeholder/README.md`,
  `packages/block-library/src/gallery/edit.js`, `packages/block-library/src/cover/edit/inspector-controls.js`
- `clauderic/dnd-kit` — Pointer/Touch sensor docs (docs.dndkit.com) + `packages/core/src/hooks/utilities/useAutoScroller.ts`

**Product docs**
- Notion Help — Customize and style your content — https://www.notion.com/help/customize-and-style-your-content
- Shopify Help Center — Uploading images (focal points) — https://help.shopify.com/en/manual/online-store/images/theme-images
- Ghost changelog — Native image editing (Pintura) — https://ghost.org/changelog/image-editor/ *(REPORTED)*

**Internal**
- `frontend/src/components/MediaGallery.tsx` — the current surface
- `docs/MEDIA_PLAN.md` (D53), `docs/GACHA_PLAN.md` §5.2/§5.4 — the ruled read-only posture this
  redesign supersedes
