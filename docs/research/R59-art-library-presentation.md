# R59 — Presenting a per-destination image LIBRARY on a phone

**Date:** 2026-08-24 · **Bounded pass, one agent, no subagents.**

**The question.** The owner superseded the "gallery lives inline in the settings tab behind an
accordion" model (R56 §8) with a new one: *every art destination has its own **library** — bundled
defaults are first-class entries, uploads join them, delete is the only removal, and priority order
decides what is active. Tap the section → the full gallery opens, probably full-screen, and
everything is managed there.* They asked how shipped products actually present such a library on a
phone — **the entry affordance, the container, the grid, the selection model, and how bundled
defaults slot in** — because they are not sure full-screen is right.

**Mid-pass scope extension (owner, same day).** Some ctrl-b roles use **several** library images at
once — a roster paints every entry simultaneously; dealt pools rotate randomly through all usable
entries. The owner wants the gallery to *highlight what is in use*. Folded into §6 (Q4).

**Already bought, not re-reported here.** [R56](./R56-gallery-management-ux.md) §4 (upload
affordance: empty → large tappable placeholder card; non-empty → header control; no in-grid "+"
tile) and §8 (GOV.UK summary-line accordion headers, multi-open, persisted). [R57](./R57-focal-point-crop-ux.md)
for CMS pickers (Umbraco/Craft/Sanity/Kirby/Statamic). [R58](./R58-touch-drag-reorder.md) for drag.
Where this dossier **amends** one of those findings it says so explicitly (§3.3, §5.4, §6.1, §8③).

---

## Confidence legend

- **[V]** — I read the source file / the shipped CSS at the stated ref and quoted it.
- **[V-doc]** — quoted from an official vendor doc.
- **[R]** — reported by a secondary source (press, community), not independently checked.
- **[U]** — expected but unverified; called out as such.

---

## §0 — TL;DR: the facts that decide

1. **3 columns at phone width is unanimous and not a coincidence.** Signal `spanCount="3"` **[V]**;
   Telegram Android `columnsCount = 3` (5 only for landscape/tablet) **[V]**; Telegram Web A
   `grid-template-columns: repeat(3, 1fr)` **[V]**; AOSP WallpaperPicker2 3 below 820 dp, 4 above
   **[V]**; WordPress computes `min(round(width / 135), 12)` below a 640 px viewport → **3** at
   390 px **[V]**. Five independent products, five different stacks, one number.

2. **Tile shape tracks the DESTINATION, not the grid.** Where the destination is the whole screen,
   the tile is screen-shaped: AOSP `grid_tile_aspect_width 182dp × grid_tile_aspect_height 340dp`
   (0.535) **[V]**, Telegram Android ~117 × 180 dp (`height = dp(180)`) **[V]**. Where the tile is a
   *catalogue thumbnail* rather than a scale model, it is square: Signal `frame.setAspectRatio(1.0f)`
   **[V]**, Telegram Web A `padding-bottom: 100%` **[V]**, WordPress `padding-top: 100%` **[V]**.
   GNOME uses 144 × 108 (4:3 — its destination) **[V]**.

3. **The container is a full-screen surface in every phone reference.** Signal: a nav-graph
   Fragment push, then a full-screen preview *Activity* **[V]**. Telegram: a full-screen Activity
   (Android) / a full-screen settings screen with a real history entry (Web A) **[V]**. AOSP: an
   Activity **[V]**. WordPress: a modal that becomes **`position: fixed; inset: 0`** below 640 px
   **[V]**. **Nobody ships a bottom sheet for this.**

4. **The entry affordance is a preview of the destination, and the preview IS the button.**
   Signal renders a live fake chat at the device aspect ratio and wires
   `chatWallpaperPreview.setOnClickListener(unused -> setWallpaper.performClick())` **[V]**.
   Gutenberg uses **one** `<Button>` that is the "Add a featured image" label when empty and the
   image itself when set (`aspect-ratio: 2/1; object-fit: cover`), with `aria-haspopup="dialog"` and
   `aria-label="Edit or replace the featured image"` **[V]**.

5. **"Active" is always an explicit stored pointer. Order-decides-active has NO precedent in this
   field.** Signal stores the wallpaper object; Telegram stores `background: <slug>`; WordPress
   stores `featured_media`; GNOME compares against `self->active_item`; AOSP asks
   `WallpaperManager`. Not one product infers "active" from list position. **[V ×5]**

6. **Nothing in the field marks *which* image of a rotating set is currently painted.** AOSP
   substitutes a **word** on the current wallpaper — `static_wallpaper_presentation_mode_message` =
   **"Currently set"** vs `rotating_wallpaper_presentation_mode_message` = **"Daily wallpaper"**
   **[V]**. iOS Photo Shuffle collapses the whole rotating set into **one** gallery entry **[R]**.
   tvOS 26 "Choose Aerials" only lets you *hide* thumbnails (opt-out membership) **[V-doc]**.
   Windows binds a *folder* **[R]**. The only place a "one of many is live right now" mark exists is
   the **media player**: Navidrome prepends a 32 × 32 animated glyph with `alt="playing"` /
   `alt="paused"` **[V]**.

7. **The corner vocabulary converges.** **bottom-END = "this is the applied one"** (AOSP
   `wallpaper_check_circle_24dp`, GNOME `background-selected-symbolic`) **[V ×2]**. **top-END =
   multi-select checkbox** (WordPress 24 × 24 px, Telegram Android 22 × 22 dp) **or** a destructive
   remove (GNOME's circular OSD ✕) **[V ×3]**. **bottom-START = a kind/mode badge** (GNOME
   `slideshow-symbolic`, shown when `cc_background_item_changes_with_time(item)`) **[V]**.
   **CENTER = Telegram Android's applied mark** (a filled circle r = 20 dp with a check) **[V]**.

8. **AOSP already solved our badge-contention problem, in one line:** one corner slot, priority-
   ordered — `showBadge(holder, wallpaper_check_circle_24dp, item.isApplied)`, and only
   `if (!item.isApplied)` does the item's own `badgeDrawableRes` get the slot. **[V]**

9. **Bundled defaults live in the same grid as uploads, and are not deletable.** Signal:
   `wallpapers = BuiltIns.getAllBuiltIns(); wallpapers.addAll(WallpaperStorage.getAll())` — built-ins
   first, uploads appended **[V]**. Telegram Web A keeps the server order with the comment "*the
   user's own wallpapers come first*" and de-dups keys across the personal and default sets **[V]**.
   GNOME puts user pictures in a **separate flowbox above a `Separator`**, and gives the remove ✕
   **only** to `BG_IS_RECENT_SOURCE` items **[V]**. AOSP additionally refuses to delete the applied
   one: "*A currently set Live wallpaper should not be deleted*" **[V]**.

10. **Upload, once the picker is its own screen, is a labeled ROW at the top — not a header icon,
    not an in-grid tile.** Signal: a 56 dp-min row "Choose from photos" with a gallery icon, above a
    2 dp divider and a "Presets" header **[V]**. Telegram Android: `uploadImageRow`, `setColorRow`,
    `sectionRow`, *then* the grid **[V]**. Telegram Web A: `<ListItem icon="camera-add">Upload
    image</ListItem>` at the top of the Island card **[V]**. This **amends** R56 §4.2 for the
    full-screen container (R56's header-control finding was measured on *inline* sections).

11. **ctrl-b has no history/popstate handling anywhere** (`grep -rl 'popstate\|history.pushState'
    frontend/src` → empty) **[V]**, and Telegram Web A's `useHistoryBack.ts` shows what a real route
    stack costs (a module-level history model, a Safari edge-gesture workaround with two tuned
    constants, deferred operations because "*Safari doesn't really like when there's 2+ consequent
    history operations in one frame*") **[V]**. This is the strongest argument for **full-screen
    modal over full-screen route** in our app.

---

## §1 — What was read (provenance)

**Source, at the stated ref, read directly:**

- **signalapp/Signal-Android** `main`: `app/src/main/java/org/thoughtcrime/securesms/wallpaper/`
  `ChatWallpaperFragment.java`, `ChatWallpaperSelectionFragment.java`,
  `ChatWallpaperSelectionAdapter.java`, `ChatWallpaperViewHolder.java`,
  `ChatWallpaperPreviewActivity.java`, `ChatWallpaperRepository.java`, `WallpaperStorage.java`;
  `res/layout/chat_wallpaper_selection_fragment.xml`,
  `chat_wallpaper_selection_fragment_adapter_item.xml`, `chat_wallpaper_preview_activity.xml`;
  `res/values/dimens.xml`.
- **Ajaxy/telegram-tt (Telegram Web A)** `master`: `src/components/left/settings/`
  `SettingsGeneralBackground.tsx` + `.scss`, `WallpaperTile.tsx` + `.scss`;
  `src/hooks/useHistoryBack.ts`.
- **DrKLO/Telegram (Telegram Android)** `master`: `TMessagesProj/src/main/java/org/telegram/ui/`
  `WallpapersListActivity.java`, `Cells/WallpaperCell.java`.
- **LineageOS/android_packages_apps_WallpaperPicker2** `lineage-22.2` (AOSP WallpaperPicker2 mirror):
  `res/values/{dimens,strings,integers}.xml`;
  `res/layout/{grid_item_image,labeled_grid_item_image,grid_item_my_photos}.xml`;
  `src/com/android/wallpaper/util/{SizeCalculator.java,DeletableUtils.kt}`;
  `src/com/android/wallpaper/picker/individual/IndividualPickerFragment2.kt`.
- **GNOME/gnome-control-center** `main`: `panels/background/`
  `cc-background-panel.blp`, `cc-background-chooser.blp`, `cc-background-chooser.c`,
  `background.gresource.xml`.
- **WordPress/gutenberg** `trunk`: `packages/editor/src/components/post-featured-image/{index.js,style.scss}`.
- **WordPress/wordpress-develop** `trunk`: `src/js/media/views/attachments.js`,
  `src/wp-includes/css/media-views.css`.
- **navidrome/navidrome** `master`: `ui/src/common/SongTitleField.jsx`.
- **home-assistant/frontend** `dev`: `src/components/ha-picture-upload.ts`.
- **ctrl-b itself** (to ground the recommendation): `frontend/src/components/BottomSheet.tsx`,
  `PromptModal.tsx`, `ConfirmDialog.tsx`; `backend/app/core/media.py`; `docs/MEDIA_MANAGER_PLAN.md`
  §4, §9.

**Docs read:** MDN `aria-current`; Apple Support *Set up Apple TV 4K screen savers* (tvOS);
Notion *Customize and style your content*; Material Components Android `docs/components/{Dialog,BottomSheet}.md`.

**Attempted and failed (recorded so nobody re-buys it):** `developer.apple.com` HIG *Collections*
and `m2.material.io/design/interaction/states.html` are client-rendered — the fetcher gets a title
and nothing else. R56 §3.4 already banks the HIG *Lists/Collections* quotes; the Material
"selected vs activated" state definitions remain **unbought**. `support.apple.com/en-us/102638`
truncated before the Photo Shuffle section.

---

## §2 — The reference flows, end to end

### 2.1 Signal Android — the closest structural match to the owner's model **[V]**

Three screens, in order:

**① `ChatWallpaperFragment`** — the *settings* screen. It is a `ScrollView` whose top half is a
**live mock of the destination**: a fake chat with an avatar, two message bubbles, a date pill, a
send button, all painted over the current wallpaper, and the preview is forced to the device's
aspect ratio:

```java
forceAspectRatioToScreenByAdjustingHeight(chatWallpaperPreview);
…
chatWallpaperPreview.setOnClickListener(unused -> setWallpaper.performClick());
setWallpaper.setOnClickListener(unused -> SafeNavigation.safeNavigate(…,
    R.id.action_chatWallpaperFragment_to_chatWallpaperSelectionFragment));
```

The preview and the "Set wallpaper" row are the *same* action. Below: a "Dark theme dims wallpaper"
switch, "Set chat color", and reset rows.

**② `ChatWallpaperSelectionFragment`** — the *library*. Layout order, top to bottom:

| element | spec |
|---|---|
| toolbar | `dsl_settings_toolbar`, title "Chat color & wallpaper", back = `popBackStack()` |
| **"Choose from photos"** | `AppCompatTextView`, `minHeight="56dp"`, `drawableStartCompat="@drawable/ic_gallery_outline_24"`, `drawablePadding="26dp"`, `marginTop="16dp"` |
| divider | `height="2dp"`, `signal_inverse_transparent_05` |
| **"Presets"** header | bold, `minHeight="48dp"`, padding 16/12 |
| grid | `GridLayoutManager`, **`app:spanCount="3"`**, `padding{Start,End}=@dimen/wallpaper_selection_gutter` = **8 dp** |

Tile: `AspectRatioFrameLayout` with `app:resize_mode="fixed_width"`, `paddingStart/End = 8dp`,
`paddingBottom = 16dp`, containing a `ShapeableImageView` with `scaleType="centerCrop"`.
`ChatWallpaperViewHolder` sets `frame.setAspectRatio(1.0f)` → **square tiles, 16 dp gutters,
8 dp outer**. At 390 dp: cell = (390 − 16) / 3 ≈ 124.7 dp, image ≈ 108.7 dp.

**③ `ChatWallpaperPreviewActivity`** — tapping a tile does **not** apply it. It opens a full-screen
Activity whose content is a **`ViewPager2` over the entire library**, with a fake chat drawn on top;
the first bubble literally says *"Swipe to preview more wallpapers"* and the second says *"Set
wallpaper for all chats"*. A fixed 60 dp bottom bar holds one `MaterialButton` **"Set wallpaper"**,
which returns the *currently paged* item:

```java
submit.setOnClickListener(unused -> {
  ChatWallpaperSelectionMappingModel model =
      (…) adapter.getCurrentList().get(viewPager.getCurrentItem());
  setResult(RESULT_OK, new Intent().putExtra(EXTRA_CHAT_WALLPAPER, model.getWallpaper()));
  finish();
});
```

**Library composition** — the exact shape the owner described:

```java
void getAllWallpaper(@NonNull Consumer<List<ChatWallpaper>> consumer) {
  List<ChatWallpaper> wallpapers = new ArrayList<>(ChatWallpaper.BuiltIns.INSTANCE.getAllBuiltIns());
  wallpapers.addAll(WallpaperStorage.getAll());
  consumer.accept(wallpapers);
}
```

**Deletion — the one place Signal diverges from the owner's model.** There is no delete UI at all.
`WallpaperStorage` garbage-collects instead:

> `/** Called when wallpaper is deselected. This will check anywhere the wallpaper could be used, and
> if we discover it's unused, we'll delete the file. */`

So a Signal upload is only "in the library" while something still points at it. **The owner's
"uploads are additive, delete is the only removal" is a deliberate departure from Signal — record
it as a choice, not an oversight.**

### 2.2 Telegram Android — the delete-capable variant **[V]**

`WallpapersListActivity` row order: `uploadImageRow`, `setColorRow`, `sectionRow`, the grid rows,
`resetSectionRow`, `resetRow` ("Reset chat backgrounds"), `resetInfoRow`.
`columnsCount = 3` (portrait phone), 5 for tablet/landscape.

`WallpaperCell` geometry: `availableWidth = width - dp(14*2 + 6*(spanCount-1))` → **14 dp outer
gutters, 6 dp inter-tile gap**; row height for the all-wallpapers type is **`dp(180)`** while the
cell width at 390 dp is (390 − 28 − 12)/3 ≈ **116.7 dp** → a **portrait, roughly screen-shaped tile**.

Two *different* marks, deliberately:

```java
// the applied wallpaper — dead centre
if (isSelected) {
  circlePaint.setColor(Theme.serviceMessageColorBackup);
  canvas.drawCircle(cx, cy, AndroidUtilities.dp(20), circlePaint);
  checkDrawable.setBounds(…); checkDrawable.draw(canvas);
}
// multi-select for deletion — top-right, 22×22dp, 2dp inset
checkBox = new CheckBox(context, R.drawable.round_check2);
addView(checkBox, LayoutHelper.createFrame(22, 22, Gravity.RIGHT | Gravity.TOP, 0, 2, 2, 0));
```

`onItemLongClick` enters an action mode (`actionBar.createActionMode`) whose trailing item is
`delete` (`R.drawable.msg_delete`, width `dp(54)`), confirmed by
`formatPluralString("DeleteBackground", selectedWallPapers.size())`.

### 2.3 Telegram Web A — the web-native version of the same screen **[V]**

```tsx
<Island>
  <ListItem icon="camera-add" disabled={isUploading} onClick={handleUploadWallpaper}>Upload image</ListItem>
  <ListItem icon="colorize"   onClick={handleSetColor}>Set color</ListItem>
  <ListItem icon="favorite"   onClick={handleResetToDefault}>Reset to defaults</ListItem>
  <Checkbox label="Blurred" … />
  <RangeSlider label="Pattern intensity" … />
</Island>
<IslandTitle>Chat background</IslandTitle>
<div className="settings-wallpapers">{visibleWallpapers.map(w => <WallpaperTile … />)}</div>
```

```scss
.settings-wallpapers {
  display: grid; grid-auto-rows: 1fr;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.0625rem;                 /* 1px — a near-seamless mosaic */
  margin: 1rem -1rem 0;           /* bleeds past the page gutter */
  border-top-{left,right}-radius: var(--border-radius-island);
}
.WallpaperTile { height: 0; padding-bottom: 100%; }        /* square */
.WallpaperTile::after { border: 2px solid var(--color-primary); opacity: 0; transition: opacity .15s ease; }
.WallpaperTile.selected::after   { opacity: 1; }
.WallpaperTile.selected .media-inner { transform: scale(0.9); }   /* shrink + ring */
```

Selection is **immediate on tap** — but only once the full-resolution blob is cached; an
uncached tile shows a `ProgressSpinner` first, with the comment *"Selecting without a cached blob
would render nothing and then reset — better to keep the current wallpaper."*

Ordering + dedup, verbatim from the source comment:

> `// Keep the server order (the user's own wallpapers come first), skipping unrenderable`
> `// patterns and dropping duplicates that appear in both the personal list and the default set`

Back navigation: `useHistoryBack({ isActive, onBack: onReset })`.

### 2.4 AOSP WallpaperPicker2 — the platform picker **[V]**

- Columns: `INDIVIDUAL_FEWER_COLUMNS = 3`, `INDIVIDUAL_MORE_COLUMNS = 4`, switched at
  `COLUMN_COUNT_THRESHOLD_DP = 820`. Category tiles are always 3; featured tiles 2.
- Tile aspect: `grid_tile_aspect_width 182dp` × `grid_tile_aspect_height 340dp`.
- Paddings: `grid_padding 4dp`, `grid_item_individual_padding_horizontal 4dp`,
  `grid_item_individual_padding_bottom 8dp`, `wallpaper_grid_edge_space 20dp`,
  `wallpaper_grid_padding_top 32dp`; corner radius `grid_item_all_radius 28dp` (3-col) /
  `..._small 20dp` (4-col).
- Tile anatomy (`grid_item_image.xml`): a `CardView` holding `thumbnail` (centerCrop) +
  `overlay_icon` (centre) + **`indicator_icon` at `alignParentBottom` + `alignParentEnd`,
  `visibility="gone"`** + a loading `ProgressBar`.
- The badge rule (`IndividualPickerFragment2.kt`):

  ```kotlin
  showBadge(holder, R.drawable.wallpaper_check_circle_24dp, item.isApplied)
  if (!item.isApplied) {
      showBadge(holder, wallpaper.badgeDrawableRes, wallpaper.badgeDrawableRes != ID_NULL)
  }
  ```

  with `grid_item_badge_size 24dp`, `grid_item_badge_indicator_size 16dp`,
  `grid_item_badge_margin 12dp` (3-col) / `grid_item_badge_margin_small 8dp` (4-col).
- **"My photos" is an in-grid tile** (`grid_item_my_photos.xml`): a full-bleed `RelativeLayout`
  with a centred `overlay_icon` and a bottom label bar reading `my_photos_category_title`. It sits
  in the **category** grid, not the file grid.
- Presentation-mode strings: `static_wallpaper_presentation_mode_message` = **"Currently set"**;
  `rotating_wallpaper_presentation_mode_message` = **"Daily wallpaper"** (comment: *"set on the
  device and is part of a daily rotation of wallpapers"*). Rotation is turned on by a tile —
  `daily_refresh_tile_title` "Daily wallpaper" / `daily_refresh_tile_subtitle` "Tap to turn on" —
  and there is a manual `refresh_daily_wallpaper_content_description` "Refresh daily wallpaper".
- Deletion (`DeletableUtils.kt`): permitted only when the item declares a delete action **and** it is
  not currently applied — `// A currently set Live wallpaper should not be deleted.`

### 2.5 GNOME Settings → Background — the "defaults + your uploads, one grid" desktop reference **[V]**

Panel structure (`cc-background-panel.blp`): a "Style" group with two **large destination preview
cards** as grouped `ToggleButton`s (Default / Dark), an "Accent Color" group, then:

```blueprint
Adw.PreferencesGroup {
  title: _("Background");
  header-suffix: Button { Adw.ButtonContent { icon-name: "list-add-symbolic"; label: _("_Add Picture…"); } };
  Adw.Bin { styles ["card"] $CcBackgroundChooser background_chooser { … } }
}
```

Chooser (`cc-background-chooser.blp`): **two `FlowBox`es** — `recent_flowbox` (the user's added
pictures) inside a `recent_box`, then a `Separator`, then the system `flowbox`. Both:
`column-spacing: 12; row-spacing: 12; homogeneous: true; max-children-per-line: 8;
activate-on-single-click: true; selection-mode: single`.

Tile construction (`cc-background-chooser.c`), thumbnails **144 × 108** (`THUMBNAIL_WIDTH 144`,
`THUMBNAIL_HEIGHT = W * 3 / 4`), assembled as a `GtkOverlay`:

| slot | widget | meaning |
|---|---|---|
| bottom-**START** | `slideshow-symbolic`, visible iff `cc_background_item_changes_with_time(item)` | *this entry rotates over time* |
| bottom-**END** | `background-selected-symbolic`, css class `selected-check` | *this is the active background* |
| top-**END** | `cross-small-symbolic` `osd circular remove-button`, tooltip **"Remove Background"** — created **only** `if (BG_IS_RECENT_SOURCE (source))` | *delete this upload* |

a11y: each cell is `GTK_ACCESSIBLE_ROLE_TOGGLE_BUTTON`, labelled with the item name, and the active
one gets css `active-item` + `GTK_ACCESSIBLE_STATE_CHECKED = TRUE`.

Delete UX — **a genuine deferred-delete undo**: `on_delete_background_clicked_cb` pushes the item
onto `removed_backgrounds` and raises an `AdwToast` "Background removed" / "%d backgrounds removed"
with an Undo button; the real `bg_recent_source_remove_item` only runs from
`really_delete_background`, the array's free-func, i.e. **when the toast is dismissed**.
`update_recent_visibility` hides the whole recent flowbox once everything in it is queued for removal.

### 2.6 WordPress / Gutenberg — the entry affordance, in React **[V]**

```jsx
<Button
  className={ ! featuredImageId ? 'editor-post-featured-image__toggle'
                                : 'editor-post-featured-image__preview' }
  onClick={ open }
  aria-label={ ! featuredImageId ? null : __( 'Edit or replace the featured image' ) }
  aria-describedby={ ! featuredImageId ? null : `editor-post-featured-image-${id}-describedby` }
  aria-haspopup="dialog"
>
  { !! featuredImageId && media && <img className="…__preview-image" src={…} alt={ getImageDescription(media) } /> }
  { ! featuredImageId && ! isLoading && ( postType?.labels?.set_featured_image || __('Add a featured image') ) }
</Button>
{ !! featuredImageId && <HStack className="…__actions"><Button>Replace</Button><Button>Remove</Button></HStack> }
<DropZone onFilesDrop={ onDropFiles } />
```

```scss
.editor-post-featured-image__toggle,
.editor-post-featured-image__preview { width: 100%; min-height: $grid-unit-50; /* 40px */ }
.editor-post-featured-image__preview .…__preview-image {
  object-fit: cover; width: 100%; object-position: 50% 50%; aspect-ratio: 2/1;
}
.editor-post-featured-image__actions:not(.…-missing-image) {
  position: absolute; bottom: 0; opacity: 0;      /* ← revealed only on hover/focus-within */
  transition: opacity 50ms ease-out;
  .…__action { backdrop-filter: blur(16px) saturate(180%); background: rgba(255,255,255,.75); }
}
```

The hidden alt-text node is real content: `getImageDescription()` returns
`"Current image: <alt>"` or `"The current image has no alternative text. The file name is: <file>"`.

The library it opens: `wp.media` modal. Grid columns are computed, not fixed —

```js
idealColumnWidth: $( window ).width() < 640 ? 135 : 150
…
this.columns = Math.min( Math.round( width / this.options.idealColumnWidth ), 12 ) || 1;
```

Tile CSS: `.attachment { width: 25%; padding: 8px }` (JS then overrides the width per `data-columns`),
`.attachment-preview:before { padding-top: 100% }` (square), `.attachment .check { 24 × 24px; top: 0;
right: 0 }`, selected ring `inset 0 0 0 5px #fff, inset 0 0 0 7px #c3c4c7`, "details" (the one whose
sidebar is open) ring `inset 0 0 0 3px #fff, inset 0 0 0 7px #183ad6`. And:

```css
@media only screen and (max-width: 640px), screen and (max-height: 400px) {
  /* Full-bleed modal */
  .media-modal, .image-details .media-modal { position: fixed; top: 0; left: 0; right: 0; bottom: 0; }
}
```

### 2.7 Two negatives worth having

- **Home Assistant has no library.** `ha-picture-upload` is a value-or-upload control: no value →
  an `ha-file-upload` drop area; value set → an `<img class="value">` plus a **"Clear picture"**
  button; an optional `crop` flag routes through `showImageCropperDialog`. There is no gallery, no
  defaults, no reuse of previously-uploaded pictures. **[V]** The dashboard view editor exposes a
  "Background" tab with alignment / repeat / fixed settings. **[V-doc]**
- **Notion's cover picker is tabbed, and its help doc is silent on reuse.** Documented tabs: a
  curated Notion gallery, **Upload**, **Link**, Unsplash search. The help page does **not** say
  whether previously-used covers are remembered, and says nothing mobile-specific. **[V-doc for the
  tabs; the reuse question is UNBOUGHT.]**

---

## §3 — Q1: the entry affordance in the settings surface

### 3.1 What products show before you tap

| product | what the settings row/section shows | tappable? |
|---|---|---|
| **Signal** | a **live mock of the destination** (chat bubbles + avatar + send button) over the current wallpaper, forced to the device aspect ratio; a "Set wallpaper" row beneath | the whole preview is the button **[V]** |
| **Gutenberg** | full-width **preview of the current image**, `aspect-ratio: 2/1`, `object-fit: cover`; "Add a featured image" label when empty | the preview *is* the `<Button>` **[V]** |
| **GNOME** | two destination preview cards (Light/Dark desktops with a shell mockup) + an inline chooser | previews are toggle buttons; the library is inline **[V]** |
| **iOS** | two large preview cards (Lock / Home) with "Customize" under the current wallpaper; a separate "+ Add New Wallpaper" | **[R]** |
| **Home Assistant** | the image itself + "Clear picture" — no library behind it | **[V]** |
| **Telegram** | a plain settings row "Chat background" (no preview) that opens the picker | **[V]** |

**The pattern with four independent confirmations: a preview of the CURRENTLY-ACTIVE image, shaped
like the destination, and the preview is the button.** A plain row with a chevron (Telegram) is the
minority and is the one case where the picker screen itself opens with a preview at the top instead.

Nobody ships a **thumbnail strip of the library** as the entry affordance — the library's existence
is communicated by the destination screen, not by teasing its contents.

### 3.2 The accessible shape of "the preview is the button" **[V]**

Gutenberg is the only one of these written in HTML, and it is worth copying exactly:

- one `<Button>` whose class (not whose existence) switches between `__toggle` and `__preview`;
- `aria-haspopup="dialog"` — announces that tapping opens a dialog, not navigates;
- `aria-label="Edit or replace the featured image"` on the set state (the `<img>` alt alone would
  read as decoration);
- `aria-describedby` → a visually-hidden node carrying "Current image: …" or
  "The current image has no alternative text. The file name is: …".

### 3.3 The touch trap in the same component

`.editor-post-featured-image__actions` is `opacity: 0` and only revealed by `:hover`, `:focus`, or
`:focus-within` on the container. **On a phone there is no hover**, so Replace/Remove are invisible
until something inside takes focus. GNOME's remove ✕ has the same shape (an `osd` overlay button on
a desktop tile). **Do not put a phone-critical action behind hover on the entry card.**

---

## §4 — Q2: the container

### 4.1 What ships

| product | container | dismissal |
|---|---|---|
| Signal | **full-screen Fragment** (nav-graph destination) → **full-screen Activity** for preview | toolbar back = `popBackStack()`; system Back |
| Telegram Android | **full-screen Activity** | toolbar back; system Back |
| Telegram Web A | **full-screen settings screen** inside a persistent `Transition` | `useHistoryBack` → real Back-button target |
| AOSP | **full-screen Activity** | toolbar back; system Back |
| WordPress | **modal**, `position: fixed; inset: 30px` desktop → **`inset: 0` below 640 px** | ✕ + Escape + backdrop |
| GNOME | **inline** (desktop panel, plenty of room) | n/a |
| Notion | popover with tabs (desktop) | **[V-doc]**; mobile shape **[U]** |

**Rule as the evidence states it:** *management* surfaces (upload + browse + apply, ± delete) go
**full-screen on a phone**. The only inline one is the only desktop one. **Not one product uses a
bottom sheet.** Material's own docs put bottom sheets in the "secondary content anchored to the
bottom" role, and a full-screen dialog in the "series of tasks" role. **[V-doc]**

Library size is *not* the discriminator — Signal ships ~14 built-ins and still goes full-screen.
**The discriminator is whether the surface manages or merely picks.** A one-shot pick can be a
sheet; a surface that also uploads, crops, reorders and deletes cannot.

### 4.2 Route vs modal — the ctrl-b-specific half

Telegram Web A is the only web reference and it pays a real price for a route:
`src/hooks/useHistoryBack.ts` maintains a module-level `historyState[]` + `historyCursor`, an
`isAlteringHistory` re-entrancy guard, `deferredHistoryOperations` because *"Safari doesn't really
like when there's 2+ consequent history operations in one frame"*, and two hand-tuned constants
(`SAFARI_EDGE_BACK_GESTURE_LIMIT = 300`, `..._DURATION = 350`) described in a comment as *"Carefully
selected by swiping and observing visual changes"*. **[V]**

ctrl-b has **zero** `popstate` / `history.pushState` usage in `frontend/src` **[V]** and navigates by
tab state, not routes. Importing a history stack to open a gallery is the expensive path. What ctrl-b
*does* already own: `PromptModal.tsx` / `ConfirmDialog.tsx` (`role="dialog" aria-modal="true"`,
`lib/focusTrap`, Escape, trigger capture + focus restore) and `BottomSheet.tsx` (snap points with
`0 = full`, drag-on-handle, `role=dialog` **without** `aria-modal`, no focus trap). **[V]**

---

## §5 — Q3: the grid

### 5.1 The measured table

| product | cols @ ~390 px | tile aspect | inner gap | outer gutter | corner radius |
|---|---|---|---|---|---|
| Signal | **3** (`spanCount`) | **1:1** | 16 dp (8+8) | 8 dp | `ShapeAppearanceOverlay.Signal.WallpaperPreview` |
| Telegram Android | **3** (5 tablet/landscape) | **~117 × 180 dp (0.65)** | 6 dp | 14 dp | — |
| Telegram Web A | **3** | **1:1** | **1 px** | bleeds to page edge | island radius on the first row only |
| AOSP | **3** (<820 dp), 4 (≥) | **182 × 340 dp (0.535)** | 8 dp (4+4) | 20 dp | 28 dp (3-col) / 20 dp (4-col) |
| WordPress | **3** (computed) | **1:1** | 16 px (8+8) | — | — |
| GNOME (desktop) | ≤8/line | **144 × 108 (4:3)** | 12 px | 12 px | — |

Everything uses `centerCrop` / `object-fit: cover`.

### 5.2 Square vs destination-shaped — the actual rule

The split is not stylistic. **AOSP and Telegram Android draw a scale model of the destination** —
the tile is meant to answer "how will this look as my screen", so it is screen-shaped and tall,
which is also why they fit only ~2 rows on screen. **Signal, Telegram Web A and WordPress draw a
catalogue thumbnail** — the tile answers "which picture is this", and the destination is previewed
elsewhere (Signal's swipeable preview Activity; the chat itself). Square packs more per screen and
is honest about not being a preview.

**Corollary for a multi-role gallery:** the tile ratio belongs to the *role*, not to the gallery.

### 5.3 Badges on tiles — the contention rule already exists **[V]**

AOSP is the only reference whose items carry *diagnostic* badges alongside an applied state, and it
resolves the conflict with a single documented priority: one `indicator_icon` slot at bottom-end;
applied wins; otherwise the item's own badge. `grid_item_badge_size 24dp`, margin 12 dp at 3 columns.

Everyone else keeps the corners semantically separate (§0 ⑦), which is the alternative: **different
meanings live in different corners, never in the same one.**

### 5.4 Grid or list, honestly re-examined for a FULL-SCREEN container

R56 §3.4 recommended a **list** and it was right *for its container* — a section inside a scrolling
settings page, where the row's text (`filename`, `640×854 · 88 KB`, the bound key, up to four
advisory badges) is half the value and a 110 px cell cannot hold it. That argument is scoped to the
container, and the container changed.

What the field says once the picker is its own screen: **six of six products use a grid, none uses a
list**, including the two (AOSP, WordPress) whose items carry status. Their method is not "shrink the
text to fit" — it is **move the text out of the tile**:

- AOSP: the tile carries at most one 24 dp badge; the name lives in a `title` TextView that is
  `visibility="gone"` in the plain variant, and everything else lives in the preview screen's
  `floating_sheet_wallpaper_info_view`.
- WordPress: the tile carries a 24 px check; filename, dimensions, file size, alt text and the
  Delete button all live in the modal's **right-hand details sidebar**, which below 640 px becomes a
  slide-up panel (`.media-sidebar { max-width: 70%; bottom: 120% } .media-sidebar.visible { bottom: 0 }`).

**Ruling for our case: grid in the full-screen container, plus a per-item detail surface, plus a
count in the header.** The R56 concern — "a broken file must not hide" — is answered by a
header summary line (`12 images · 1 unusable`) and a **problem badge in a corner the applied check
does not use**, not by keeping a list. If the owner ever wants the diagnostic reading, a
grid/list toggle in the gallery toolbar is the cheap escape hatch; do not make the *default* a list.

---

## §6 — Q4: the selection model (incl. multi-active and rotation)

### 6.1 "Active" is a pointer, everywhere. Order never decides. **[V ×5]**

| product | where "active" is stored |
|---|---|
| Signal | `SignalStore.wallpaper().setWallpaper(chatWallpaper)` / `recipients().setWallpaper(id, …)` |
| Telegram Web A | `setThemeSettings({ theme, background: wallpaper.slug, … })` |
| Telegram Android | compared per-cell: `isSelected = object == selectedWallpaper` |
| AOSP | `WallpaperManager`; the tile asks `item.isApplied` |
| GNOME | `cc_background_item_compare (item, self->active_item)` |
| WordPress | `featured_media` post field |

R57 §6 found the same for CMS focal points (Sanity/Umbraco/Craft/Kirby/Statamic each store a value
object on the asset). **No product in either dossier's reference class derives "which image is used"
from list position.** ctrl-b's pools do (`core/media.py`: *"a pin then resolves to whichever comes
first in this role's order"*, `list_role(… order)` puts the owner's persisted `order` first) — that is
a **fallback chain**, and it is fine as a *storage* mechanism, but it is not how any product asks the
user to express the choice.

### 6.2 Tap = apply, or tap = preview?

Both ship, and the split is principled:

- **Tap = apply immediately**: Telegram Web A (`selection-mode` equivalent: `onClick` → `setThemeSettings`),
  GNOME (`activate-on-single-click: true; selection-mode: single`). Both are **trivially reversible**
  (tap another tile) and **cheap** (no crop, no per-item settings). Telegram still guards the
  irreversible-looking failure — an uncached tile shows a spinner rather than applying nothing.
- **Tap = preview, explicit "Set"**: Signal (tile → full-screen `ViewPager2` preview → one "Set
  wallpaper" button), AOSP (tile → preview screen → "Apply"/`set_wallpaper_dialog`), WordPress (tile →
  details sidebar → "Set featured image"). All three have a **second decision** to make after
  choosing — which screen (home/lock), which crop, which size.

**Discriminator: if the item needs any further decision or can fail, the field inserts a preview
step.** ctrl-b items can be unusable, can want a focal point, and belong to roles with different
shapes — that puts us on the Signal/AOSP side.

### 6.3 How the active tile is marked

| product | mark |
|---|---|
| Telegram Web A | `::after { border: 2px solid var(--color-primary) }` fading in over 150 ms **+** the image `transform: scale(0.9)` |
| Telegram Android | a filled circle **r = 20 dp, dead centre**, with a check drawable inside |
| AOSP | **24 dp check-circle, bottom-end**, margin 12 dp |
| GNOME | `background-selected-symbolic` **bottom-end** + css `.active-item` + `STATE_CHECKED` |
| WordPress | ring `inset 0 0 0 3px #fff, inset 0 0 0 7px #183ad6` + a blue 24 px check top-right |

Two families: **a ring/shrink on the whole tile** (colour-dependent, elegant) and **a check badge in
a fixed corner** (colour-independent, survives a busy image). WordPress and Telegram-Web ship both
at once. Nobody ships a "Current" text chip on the tile — the *word* appears only where there is
room for it (AOSP's info sheet, §6.4).

### 6.4 The extension: several images in use at once, and rotation

**The headline, stated plainly: no shipped image picker distinguishes "currently painted" from
"eligible". The field does not have this idea.** Six products, three approaches, none of them a
per-tile live marker:

**① The rotating set collapses to ONE entry.** iOS "Photo Shuffle" is a single wallpaper in the
gallery; you configure it with a photo multi-select (categories, an album, or "Select Photos
Manually", max ~50) and a **Shuffle Frequency** of On Tap / On Lock / Hourly / Daily. The individual
photos never appear as gallery entries, so the question "which one is showing" never arises in the
picker. **[R — press + community docs; Apple's own article truncated before this section]**

**② Rotation is a property of the COLLECTION, and the current item gets a WORD.** AOSP: the
"Daily wallpaper" tile inside a category grid (`daily_refresh_tile_subtitle` = "Tap to turn on")
turns the whole category into the rotation; the *current wallpaper*'s info panel then reads
`rotating_wallpaper_presentation_mode_message` = **"Daily wallpaper"** where a static one reads
`static_wallpaper_presentation_mode_message` = **"Currently set"**. A "Refresh daily wallpaper"
button advances it manually. **[V]** No per-image mark exists anywhere in the grid.

**③ Membership is expressed as opt-OUT toggling, with no current marker.** tvOS 26 "Choose
Aerials": pick a category in the sidebar, then *"select a thumbnail to hide it, or select Hide All to
hide all the Aerials for that category"*. Everything not hidden is in the rotation. Apple's own doc
does **not** state how hidden vs shown is indicated. **[V-doc, including the negative]**

**④ Bind a folder and say nothing.** Windows 11 Slideshow takes a folder + interval + shuffle; there
is no per-image state and no "current" marker; the only per-image surface is a 5-thumbnail "Recent
images" strip. **[R]**

**⑤ The one per-entry rotation flag in the field:** GNOME's `slideshow-symbolic` in the tile's
**bottom-START** corner, visible iff `cc_background_item_changes_with_time(item)` — i.e. *this entry
is itself a time-varying wallpaper*. It marks the entry's **kind**, not "showing right now", and it
deliberately occupies a different corner from the bottom-end selected check. **[V]**

**Where "one of many is live" IS marked, it is a media player, not a picker.** Navidrome, the only
one of these readable at source: the now-playing row prepends a **32 × 32 animated GIF** (an
equaliser for playing, a static PNG for paused, both theme-aware) *in front of the title*, with the
text alternative carried by the image itself:

```jsx
const isCurrent = currentId && (currentId === record.id || currentId === record.mediaFileId);
…
<img src={icon} className={classes.icon} alt={paused ? 'paused' : 'playing'} />
…
{isCurrent && <Icon />}
```

Note what it is **not**: it is not the row's selected state, not a checkbox, not a colour change. A
distinct glyph in a distinct position, plus a text alternative. **[V]**

**a11y — the state names exist and are distinct. [V-doc, MDN]**

> "A non-null `aria-current` state on an element indicates that this element represents the current
> item within a container or set of related elements."
> `true` — "Represents the current item within a set."
> "**Do not use `aria-current` as a substitute for `aria-selected`**" in `gridcell`, `option`, `row`,
> `tab`; "When something is selected rather than current (such as a `tab` in a `tablist`), use
> `aria-selected`".

So the three states have names: **membership** = `aria-checked` (GNOME's native equivalent is a
toggle-button with `GTK_ACCESSIBLE_STATE_CHECKED` **[V]**) or `aria-selected` in a listbox;
**the one currently rendered** = `aria-current="true"`; **excluded** = `aria-checked="false"`
(+ `aria-disabled` only if it genuinely cannot be chosen).

**The three-state grid (in use now / eligible / present-but-not-used) does not exist in the field.**
The closest shipped shape is a **labelled partition**: GNOME's `Separator` between the user's
pictures and the system set; Signal's "Presets" header between the upload row and the built-ins;
tvOS's per-category sidebar. If we need "above the cut / below the cut", a labelled divider is the
field-supported form — not a third badge.

---

## §7 — Q5: bundled defaults as first-class entries

### 7.1 Mixing

| product | how defaults and user items share the grid |
|---|---|
| **Signal** | one list: `BuiltIns.getAllBuiltIns()` **then** `WallpaperStorage.getAll()` — **defaults first, uploads appended**; no visual distinction at all **[V]** |
| **Telegram Web A** | one grid in server order, comment: *"the user's own wallpapers come first"*; **de-duplicated by key** across the personal and default sets; unrenderable / auto-installed patterns filtered out of the picker entirely **[V]** |
| **GNOME** | **two flow-boxes separated by a `Separator`** — user pictures above, system below **[V]** |
| **AOSP** | user photos are a **category tile** ("My photos"), i.e. a different level of the hierarchy **[V]** |
| **WordPress** | there are no "defaults" — everything is the user's media library **[V]** |

Three of the four that *have* both put the user's own items **first**. Only Signal appends them last.

### 7.2 Deletability of a stock item

**Nobody lets you delete a bundled default.** The rules are enforced at the source level:

- GNOME: the ✕ overlay is constructed `if (BG_IS_RECENT_SOURCE (source))` — system wallpapers
  literally never get one. **[V]**
- AOSP: `DeletableUtils.getDeleteAction` returns null unless the wallpaper's own metadata declares a
  delete action, **and** returns null for the currently-applied one (`// A currently set Live
  wallpaper should not be deleted.`). **[V]**
- Signal: no delete UI at all; uploads are GC'd when nothing references them. **[V]**
- Telegram Android is the exception that proves it — long-press multi-select delete works on
  catalogue entries too, but they are **server-backed** and simply reappear. **[V]**

There is also no "hide a stock item" anywhere in the wallpaper class — the only hide-a-stock-item
mechanism found in the whole pass is **tvOS's Choose Aerials**, and that is a *rotation-membership*
control, not a library edit. **[V-doc]**

### 7.3 What happens when the user's last item goes

**All three fall back to a NAMED default, never to "the next one in the list":**

- Signal `resetAllWallpaper` → `SignalStore.wallpaper().setWallpaper(null)` +
  `recipients().resetAllWallpaper()` → the themed background. The confirm dialog is a **three-button**
  MaterialAlertDialog: "Reset default wallpaper" / "Reset all wallpapers" / Cancel. **[V]**
- Telegram Web A `handleResetToDefault` → `setThemeSettings({ …RESET_WALLPAPER_SETTINGS, isBlurred: true,
  patternColor: getDefaultPatternColor(theme) })`; Telegram Android has a "Reset chat backgrounds" row
  with its own alert. **[V]**
- GNOME: `update_recent_visibility` hides the entire recent flow-box when all its items are queued for
  removal; the system set is untouched and stays selectable. **[V]**

**Implication the owner's model makes free:** if bundled defaults are entries *in the pool*, the pool
can never empty, so the "what do we fall back to" question dissolves — provided defaults are
undeletable. That is the whole argument for the model, stated as the field would state it.

### 7.4 GNOME's delete UX contradicts R56 §6.4 — read the mechanism before adopting either

R56 §6.4 ruled **confirm dialog, no undo toast** ("no trash ⇒ no honest undo"), citing M3 against the
timed-undo pattern on web. GNOME ships the opposite: no confirm at all, a per-tile ✕, and an
`AdwToast` "Background removed" with **Undo**.

The reason GNOME can is mechanical: the click only *queues* the item
(`g_ptr_array_add (self->removed_backgrounds, undo_data)`); the actual removal is the array's free
func, so it runs when the toast is dismissed. **The undo is honest because the delete is deferred.**
**[V]** R56's ruling stands for ctrl-b unless we build the same deferral — but the finding is that the
"no undo without a trash" premise has a cheaper solution than a trash: *defer the unlink until the
toast dies.* Worth putting in front of the owner, not smuggling in.

---

## §8 — Bounded open sweep (3 findings none of the questions asked about)

**① The upload control's PLACE changes with the container, and R56's finding was container-scoped.**
R56 §4.2 concluded "put the upload control in the section header" from WordPress's `MediaReplaceFlow`
(a block toolbar) and Immich's `ControlAppBar` icon. Both of those are *inline* surfaces. Every
phone-first picker that is **its own screen** instead uses a **labeled row at the top of the screen,
above the grid, with a leading icon** — Signal ("Choose from photos", 56 dp, gallery icon, above a
divider and a "Presets" header), Telegram Android (`uploadImageRow` then `setColorRow` then
`sectionRow`), Telegram Web A (`<ListItem icon="camera-add">Upload image</ListItem>` at the top of the
Island). **3/3. [V]** A bare icon in a full-screen toolbar is *not* what this class ships.

Related qualification of R56's "no reference product ships an in-grid `+` tile": AOSP does ship an
in-grid tile — `grid_item_my_photos.xml`, a full-bleed tile with a centred icon and a bottom label bar
— but it lives in the **category** grid, one level above the files. The R56 negative is correct *for
file grids* and should be restated that way. **[V]**

**② Tap-to-apply needs a per-tile failure story, and Telegram wrote the comment.** `WallpaperTile`'s
`handleClick` does not apply an uncached wallpaper: it flips `isLoadAllowed`, shows a
`ProgressSpinner` **inside the tile**, and only calls `onClick` from an effect once `fullMedia`
arrives — *"Selecting without a cached blob would render nothing and then reset — better to keep the
current wallpaper."* The cache write is awaited and a failure is swallowed with the current wallpaper
intact. **[V]** Generalises: any tile whose activation can fail needs the pending/failed state **on
the tile**, not in a toast — which is also the cheapest place to put ctrl-b's "unusable" state.

**③ WordPress's mobile media modal hides its details panel off-screen rather than dropping it.**
`.media-sidebar { z-index: 1900; max-width: 70%; bottom: 120% }` and
`.media-sidebar.visible { bottom: 0 }` below 640 px **[V]** — the desktop right-hand details column
becomes a slide-up panel over the grid. That is the shipped answer to "where does per-item text go on
a phone when the tile can't hold it", and it costs one class toggle rather than a second layout.

---

## §9 — The numbers that decide

```
COLUMNS @ phone width          3   (Signal 3 · Telegram 3 · Telegram Web 3 · AOSP 3 <820dp · WP round(390/135)=3)
TILE ASPECT                    destination-shaped when the tile is a scale model  (AOSP 182×340 = 0.535 · TG-Android 117×180 = 0.65)
                               1:1 when the tile is a catalogue thumbnail          (Signal · TG-Web · WordPress)
                               4:3 for a landscape destination                     (GNOME 144×108)
GAP                            16 dp Signal · 16 px WordPress · 8 dp AOSP · 6 dp TG-Android · 1 px TG-Web
OUTER GUTTER                   8 dp Signal · 14 dp TG-Android · 20 dp AOSP · 12 px GNOME
CORNER RADIUS                  28 dp AOSP (3-col) / 20 dp (4-col)
APPLIED BADGE                  24 dp check-circle, bottom-END, margin 12 dp (AOSP) · bottom-END symbolic (GNOME)
                               r = 20 dp filled circle + check, CENTRE (TG-Android)
                               2 px accent ring + scale(0.9) (TG-Web)
MULTI-SELECT CHECKBOX          24 × 24 px top-right (WordPress) · 22 × 22 dp top-right, 2 dp inset (TG-Android)
REMOVE AFFORDANCE              circular OSD ✕, top-END, recent items only (GNOME)
UPLOAD ROW                     minHeight 56 dp, leading 24 dp icon, 26 dp drawable padding (Signal)
ENTRY PREVIEW                  full-width, aspect-ratio 2/1, object-fit cover (Gutenberg)
                               forced to the device aspect ratio (Signal, GNOME, iOS)
CONTAINER                      full-screen: Fragment/Activity ×3 · fixed inset:0 modal ≤640px (WordPress)
BOTTOM SHEET FOR THIS JOB      0 / 6
ORDER-DECIDES-ACTIVE           0 / 6
PER-TILE "CURRENTLY PAINTED" MARK IN A ROTATING SET   0 / 5
```

---

## §10 — What I could not determine

- **Apple HIG *Collections*** and **Material's "selected" vs "activated" state definitions** —
  both pages are client-rendered and the fetcher returns only a title. R56 §3.4 already banks the
  HIG *Lists/Collections* lines; the Material state vocabulary (`state_activated` vs
  `state_selected` vs `state_checked`) is **still unbought** and is the one piece of theory that
  would sharpen §6.4.
- **iOS wallpaper gallery internals** — the entry screen's two preview cards, "+ Add New Wallpaper",
  and Photo Shuffle's frequency options are **[R]** only (press + community). Apple's own article
  truncated before the relevant sections.
- **tvOS's visual indication of a hidden vs shown Aerial** — Apple's doc describes the *action*
  ("select a thumbnail to hide it") but not the mark.
- **Notion**: whether previously-used covers are remembered/reusable, and the mobile container shape.
  The four tabs are documented; the rest is not.
- **WhatsApp / Signal Desktop wallpaper pickers** — not researched; Signal Android + Telegram cover
  the class and budget was better spent on source.
- **Immich album-cover selection** — the components found (`AlbumCover.svelte`,
  `set_album_cover.action.dart`) are *renderers* and a "set this asset as cover" action on an asset
  already in the album; there is no library-with-defaults picker. R56 §2.5 remains the Immich record.
- **Device behaviour of any of this** — no phone probe was run. In particular Telegram Web A's 1 px
  grid gap and the 3-column count at 320 px were not eyeballed.
- **Whether ctrl-b's `MediaRoleDef` can carry a tile ratio today** — I read `core/media.py`'s
  ordering semantics and the plan, not the full role model.

---

## §11 — Recommendation for ctrl-b v1

*(Evidence above ages slowly; this section ages fast. It is a proposal, not a decision.)*

### 11.1 Entry affordance — in the settings tab

- **One card per art destination, and the card is the button.** Full-width, **shaped like the
  destination** (`aspect-ratio` from the role: `9/16`-ish for `kit/background`, `1/1` for machine
  icons, the role's own ratio for hero/banner), `object-fit: cover`, painted with the
  **currently-active image**. Gutenberg's one-button-two-modes shape, Signal's destination-shaped
  preview, four independent confirmations.
- **The card carries the status line R56 §8.4 put in the accordion header** — `<role> · n images`
  plus the warning chip when the section holds an unusable file / a `no match` / a pin naming a
  missing file. The accordion goes away; its summary slot does not. This also keeps the GOV.UK
  "don't hide what all users need to see" property without any disclosure at all.
- **Accessibility, copied verbatim from Gutenberg:** `aria-haspopup="dialog"`,
  `aria-label="Open the <role> gallery"`, `aria-describedby` → a visually-hidden node reading
  `"Current image: <name>"` (or the no-alt-text variant), and the `<img>`'s own alt.
- **Empty state:** the same card with the "Add an image" label + the `media/<ns>/<role>/` path
  sentence. (R56 §4.1 — already bought; unchanged.)
- **Multi-active roles** (roster, dealt pool): the card shows a **stack/collage of the first 3–4**
  rather than one image, and the status line states the mode in **words** —
  `"All 8 shown"` / `"Rotates each deal · 6 in the pool"`. This is iOS Photo Shuffle's
  "one entry represents the set" plus AOSP's presentation-mode string ("Currently set" vs
  "Daily wallpaper"). Do not invent a badge for a thing the whole field expresses as a word.
- **No hover-revealed actions on the card** (§3.3). Replace/Delete live inside the gallery.

### 11.2 Container — a full-screen MODAL, not a route, not a sheet

- Every phone reference goes full-screen for a surface that *manages*; none uses a bottom sheet.
- Build it on the **existing modal shell** (`PromptModal` / `ConfirmDialog`'s pattern:
  `role="dialog" aria-modal="true"`, `lib/focusTrap`, Escape, trigger capture + focus restore),
  sized to the viewport — the same shell `CropModal.tsx` is already specced to use
  (MEDIA_MANAGER_PLAN §4). **Do not write a third modal**, and do not reach for `BottomSheet` here
  (it is deliberately non-modal and untrapped).
- **Do not add a route.** ctrl-b has no history plumbing; Telegram's `useHistoryBack.ts` is the
  price list. **Do** add the bounded half: one `history.pushState` on open + a `popstate` listener
  that closes the overlay, so the Android Back gesture dismisses the gallery instead of leaving the
  app. ~15 lines, no navigation model.
- **Chrome:** leading ✕/back + the role name as the title; **the upload control as a labeled row
  directly under the bar** (`[icon] Add an image`, ≥56 px), then a divider, then a section header,
  then the grid. This **amends R56 §4.2 for this container** — a header icon button is right for an
  inline section header; 3/3 phone pickers ship a labeled row once the picker owns the screen.
  Gate it on `MediaIndex.write_enabled` exactly as the plan already specifies.

### 11.3 Grid

- **3 columns.** Five products agree; do not compute it.
- **Tile ratio comes from the role**, not the gallery (§5.2). Where no ratio is known, square.
- **Gap 12–16 px, outer gutter 12–16 px, radius from the kit.** Telegram Web's 1 px mosaic is an
  aesthetic choice, not the mainstream.
- **Two corners, two meanings, never shared:**
  - **bottom-end** = *in use* — a 24 px check-circle, 8–12 px margin (AOSP + GNOME converge here);
  - **top-end** = *problem* — a filled warning dot for `unusable` / `duplicate` / `no match`.
  If a third state ever needs a badge, take **bottom-start** (GNOME's kind/mode corner) — do **not**
  overload a corner without AOSP's explicit priority rule.
- **Diagnostics text leaves the tile.** Per-item text (`filename`, `640×854 · 88 KB`, the bound key,
  the full badge list, Delete, Set focal point) lives in a **per-item detail panel** reached by
  tapping the tile — WordPress's `.media-sidebar` slide-up is the shipped mobile form. The gallery
  header keeps the count (`12 images · 1 unusable`) so nothing hides.
- Optional escape hatch: a grid/list toggle in the gallery toolbar. Default **grid**; R56's list
  argument was correct for the inline container and does not survive the move (§5.4).

### 11.4 Selection model

- **Keep `order` as the storage mechanism; stop asking the owner to express intent as a drag.** Ship
  **"Set as active"** in the item detail, implemented as *move-to-front of `order`*. The owner gets
  explicit selection (which is what 6/6 products give), the config keeps its first-wins semantics,
  and nothing migrates. Reordering stays available for the multi-active roles where relative order
  genuinely matters.
- **Tap = open the item, not tap = apply.** ctrl-b items can be unusable, can want a focal point,
  and differ by role shape — that is the "second decision" discriminator that puts Signal, AOSP and
  WordPress on the preview side (§6.2).
- **Mark the active tile twice**: a 2 px accent ring *and* the bottom-end check circle. The ring is
  Telegram Web's; the check is AOSP/GNOME's; both together stay legible on a busy 110 px thumbnail
  and survive without colour.
- **Multi-active roles.** Two visual states plus a word, because that is all the field has:
  - *in the pool* → the check badge on every member;
  - *not in use* → dim (`opacity`) **and move below a labelled divider** (GNOME's `Separator`,
    Signal's "Presets" header) — a labelled partition, not a third badge;
  - *currently painted* → only if we can actually know it. If the client knows which pool entry it
    just dealt, mark it with a **distinct glyph in a distinct corner plus a text alternative**
    (Navidrome's `alt="playing"` shape — e.g. a small filled dot, `title`/`aria-label` "Showing
    now"). If we cannot know it server-side, **say so in the header** ("rotates on each deal")
    rather than faking a per-tile mark — AOSP's "Daily wallpaper" string is precisely that
    concession, and it is the field's honest answer.
- **a11y state names (MDN, §6.4):** tiles are toggle-buttons. Membership → `aria-checked`
  (`aria-selected` if the grid is a listbox). The one currently rendered → **`aria-current="true"`**
  — never `aria-selected` for that meaning.

### 11.5 Bundled defaults

- **Same grid as uploads.** One list, not a second screen.
- **Uploads first, defaults below a labelled divider ("Bundled").** Telegram's ordering
  ("the user's own wallpapers come first") + GNOME's separator. The partition also makes the
  deletability rule visually self-evident.
- **Bundled entries are undeletable**: no ✕, and the item detail omits Delete (GNOME's rule is a
  source-level `if`, not a disabled button).
- **Consider AOSP's second rule** — the currently-applied item is not deletable. Cheapest correct
  behaviour for us: allow deleting it, but promote the next entry to front in the same transaction.
- **Because defaults are always present, the pool can never empty** — which is the model's real
  payoff. Fall back to the *named* bundled default, never "whatever is next" (3/3 products do this).
- **Delete UX:** R56 §6.4's confirm-dialog ruling stands *as written*. Put GNOME's mechanism in
  front of the owner as the one alternative that is honest — defer the unlink until the toast is
  dismissed — but do not adopt a timed undo without building the deferral.

### 11.6 What to avoid

1. **A route + history stack.** ctrl-b has none; `useHistoryBack.ts` is the cost.
2. **A bottom sheet as the management container.** 0/6 in the field; M3 scopes sheets to secondary
   content.
3. **Hover-revealed actions** on the entry card or on tiles (Gutenberg's and GNOME's desktop
   assumption; there is no hover on the phone).
4. **An in-grid "+" appender in the FILE grid.** Nobody ships one; AOSP's in-grid tile is a
   *category*, not an appender.
5. **Diagnostics text on a 110 px tile.** Move it to a detail panel and keep a count in the header.
6. **Expressing "which one is active" only as drag-to-top.** No product asks a user to reorder to
   choose; make the intent explicit and let the order be the implementation.
7. **Sharing one corner between the in-use check and the problem badge** without AOSP's explicit
   priority rule — pick two corners instead.
8. **Inventing a rich three-state badge vocabulary for rotation.** The field has one word and one
   partition; anything more is unvalidated design.

---

## §12 — Source index

**Read at source (ref in §1):**

- signalapp/Signal-Android `main` — `wallpaper/{ChatWallpaperFragment, ChatWallpaperSelectionFragment,
  ChatWallpaperSelectionAdapter, ChatWallpaperViewHolder, ChatWallpaperPreviewActivity,
  ChatWallpaperRepository, WallpaperStorage}.java`; `res/layout/chat_wallpaper_*.xml`;
  `res/values/dimens.xml`.
- Ajaxy/telegram-tt `master` — `src/components/left/settings/{SettingsGeneralBackground.tsx,
  SettingsGeneralBackground.scss, WallpaperTile.tsx, WallpaperTile.scss}`; `src/hooks/useHistoryBack.ts`.
- DrKLO/Telegram `master` — `TMessagesProj/.../ui/WallpapersListActivity.java`,
  `.../ui/Cells/WallpaperCell.java`.
- LineageOS/android_packages_apps_WallpaperPicker2 `lineage-22.2` —
  `res/values/{dimens,strings,integers}.xml`; `res/layout/{grid_item_image,labeled_grid_item_image,
  grid_item_my_photos}.xml`; `src/com/android/wallpaper/util/{SizeCalculator.java,DeletableUtils.kt}`;
  `src/com/android/wallpaper/picker/individual/IndividualPickerFragment2.kt`.
- GNOME/gnome-control-center `main` — `panels/background/{cc-background-panel.blp,
  cc-background-chooser.blp, cc-background-chooser.c, background.gresource.xml}`.
- WordPress/gutenberg `trunk` — `packages/editor/src/components/post-featured-image/{index.js,style.scss}`.
- WordPress/wordpress-develop `trunk` — `src/js/media/views/attachments.js`,
  `src/wp-includes/css/media-views.css`.
- navidrome/navidrome `master` — `ui/src/common/SongTitleField.jsx`.
- home-assistant/frontend `dev` — `src/components/ha-picture-upload.ts`;
  `src/panels/lovelace/editor/view-editor/hui-view-background-editor.ts` (located, not read).

**Docs:**

- MDN — [`aria-current`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-current).
- Apple Support — [Set up Apple TV 4K screen savers](https://support.apple.com/guide/tv/set-up-screen-savers-atvbfa799b87/tvos) (tvOS "Choose Aerials").
- Apple Support — [Change your iPhone wallpaper](https://support.apple.com/en-us/102638) (truncated; used only for the entry-screen shape).
- Notion — [Customize and style your content](https://www.notion.com/help/customize-and-style-your-content) (cover tabs).
- Home Assistant — [Dashboard views](https://www.home-assistant.io/dashboards/views/) (Background tab).
- material-components/material-components-android — `docs/components/{Dialog,BottomSheet}.md`.

**Secondary [R]:** 9to5Mac (iOS 26.3 / 26.4 wallpaper gallery), MacRumors (Photo Shuffle frequency;
tvOS 26 Choose Aerials), Microsoft Support / Microsoft Q&A (Windows 11 slideshow background).

**In-repo cross-references:** [R56](./R56-gallery-management-ux.md) §3.4, §4, §6, §8;
[R57](./R57-focal-point-crop-ux.md) §3, §6; [R58](./R58-touch-drag-reorder.md);
[`docs/MEDIA_MANAGER_PLAN.md`](../MEDIA_MANAGER_PLAN.md) §4, §9.
