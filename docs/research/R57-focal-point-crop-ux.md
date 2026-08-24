# R57 — Setting a CROP and a FOCAL POINT on a phone, and what a stored focal point means at render time

**Date of pass: 2026-08-24.** Status: **DRAFT dossier** — evidence only, no D-entry yet.
Commissioned for: the media-manager design after the owner's ruling that **a focal point ships in v1**
(MEDIA_MANAGER_PLAN §9 decision session).

**Sibling dossiers — not re-bought here.** [R54](./R54-crop-upload-client.md) = the crop *library* and
the export/encode path (react-easy-crop@6.2.3 chosen; `drawImage`, never `createImageBitmap`'s crop
rect). [R55](./R55-media-upload-backend.md) = the write endpoints.
[R56](./R56-gallery-management-ux.md) = the gallery's interaction shape; its §9 established that the
field ships crop *and* focal, scoped by **who owns the aspect ratio**, and that focal is a property of
the image. This dossier goes one level down: **the control on touch, the composition flow, the
previews, the render math, and the storage shape.**

**Already-known facts the brief told me not to re-report** (and which I did not re-buy): that the field
ships both crop and focal scoped differently; that focal belongs to the image; that Shopify's editor is
touch-workable; that Gutenberg ships `FocalPointPicker`; Telegram's crop-modal shape; react-easy-crop as
our crop control. Where the new evidence **refines or contradicts** one of those, it is flagged
explicitly (§6.1 does contradict one of them for WordPress specifically).

---

## Confidence legend

| Mark | Meaning |
|---|---|
| **[V]** | **Verified** — I fetched and read the primary source myself this session (source file at the stated branch, or a W3C spec) |
| **[V-doc]** | Official vendor documentation, fetched this session, quoted — but the quotes came back through the fetch summarizer, so they are one remove from the raw page |
| **[R]** | **Reported** — secondary source only |
| **[U]** | **Unverified** — expected, explicitly not checked |

Everything below was fetched **2026-08-24**. Upstream moves; re-verify anything load-bearing after a
couple of releases.

---

## §0 — TL;DR: the twelve facts that decide the design

1. **There are TWO incompatible focal-point maths in the field, and they are not approximations of each
   other.** *Proportional alignment* (`object-position: x% y%` — CSS's own semantics) and *clamped
   centering* ("put the focal point in the middle of the window, then shift so no gap shows"). **[V]**
2. **The size of the disagreement is exactly `(0.5 − f) × window` pixels — independent of image size,
   independent of zoom** (until a clamp binds). A focal point at x = 0.25 lands **a quarter of the
   window's width apart** under the two rules. This is not a rounding difference; it is a different
   picture. Derivation and worked numbers in §5.3. **[V]**
3. **Everything that crops *for real* uses clamped centering.** Seven independent implementations read
   this session, all algebraically identical: Sanity `image-url` (JS), Sanity Studio's preview (TS),
   Umbraco's preview (TS), ImageSharp `ResizeHelper` (C#, what Umbraco's server uses), Craft
   `Raster::scaleAndCrop` (PHP), Kirby `Focus::coords` (PHP), League/Glide `resolveCropOffset` (PHP,
   what Statamic's server uses). imgix documents the same intent. **[V]**
4. **Everything that only styles a CSS box uses proportional alignment**, because it is free: WordPress's
   cover block (`objectPosition = ${Math.round(x*100)}% ${Math.round(y*100)}%`), Shopify's `image_tag`,
   and — the tell — **Craft ships both, from the same stored value**: `getFocalPoint(asCss: true)`
   returns `"50% 25%"` while `scaleAndCrop` clamped-centers. A Craft site rendering one asset two ways
   gets two framings. **[V]**
5. **Nobody in the reference class ships a touch-first focal control by accident — three ship it by
   construction, and the primitive is TAP-TO-PLACE.** Umbraco (`@click` + `@touchstart`), Kirby
   (`@click` on the surface), Statamic (`@click`, and *nothing else* — no drag at all). Gutenberg's
   is **mouse-only** (`onMouseDown` + `document.addEventListener('mousemove')`), and its drag area is
   `tabIndex={-1}` so it is not even reachable by Tab — its only touch- and keyboard-workable controls
   are the two `Left`/`Top` percent inputs. **[V]**
6. **Every shipped dot is 8–40 px, and only two clear WCAG 2.5.8's 24 px floor.** Gutenberg 40×40
   (glassy, `scale(1.1)` while dragging); Umbraco 16 px (`--dot-radius: 8px`, 2 px white border,
   `scale(1.5)` while dragging, **`pointer-events: none`** so the dot can never eat the tap); Kirby
   16 px (`--range-thumb-size: 1rem`, hidden at `opacity: 0` when unset); Craft r = 8 fabric circle;
   Sanity 16 px visual with a **24 px invisible hit circle**; Statamic 8 px reticle dot. **[V]**
7. **The management framework the owner wants exists, shipped, and is called the Umbraco image
   cropper.** One screen: the **whole image with a tap-to-place focal dot** on the left, a scrolling
   grid of **one live preview card per named destination** on the right. Tapping a preview card swaps
   the left pane into a *crop editor for that one destination*; a card that carries an explicit crop is
   badged **"User defined"**. The value is `{src, focalPoint: {left, top} | null, crops: [{alias, width,
   height, coordinates?}]}`, and the render rule is one `if`: **per-destination crop if it exists, else
   the image's focal point.** **[V]**
8. **Live destination previews are the field norm, not a luxury, and they are cheap.** Sanity renders
   **4 ratio previews** (`3:4 · Square · 16:9 · Panorama 4:1`, overridable per schema via
   `options.hotspot.previews`) that update on *every pointer move*. Statamic renders **9** frames in a
   3×3 mosaic behind a floating toolbox, with the honest caption "Previews are examples". Umbraco
   renders one per real destination. **[V]**
9. **The performance pattern is imperative preview + committed state at drag end.** WordPress writes
   `objectPosition` straight onto the DOM node during `onDrag` (the function is literally called
   `imperativeFocalPointPreview`) and only calls `setAttributes` on `onChange`. Sanity keeps a
   `localValue` during drag and commits with `onChangeEnd`. **[V]**
10. **Crop is non-destructive in every multi-destination product read.** Sanity stores `crop:
    {top,bottom,left,right}` as fractional insets *plus* a hotspot **region** `{x,y,width,height}`;
    Umbraco stores `coordinates: {x1,y1,x2,y2}` insets per named crop. The original file is never
    rewritten in either. Destructive crop appears only where the destination is **one known shape**
    (Telegram's avatar circle, WordPress's media-library "Edit image" which writes a new attachment).
    **This does soften our "crop destroys pixels" premise — but see §6.4: the field's non-destructive
    crop is bought with a server-side or CDN image pipeline, which we do not have and R55 did not
    buy.** **[V]**
11. **Focal is per-image in 6 of 7 products — and WordPress is the exception, in the opposite
    direction from what the brief assumes.** Gutenberg's `focalPoint` is a **block attribute** in
    `cover/block.json`, i.e. stored per *placement* in post content, not on the attachment. Squarespace
    is also per-placement. Shopify/Craft/Kirby/Statamic/Sanity/Umbraco are per-image. **[V]**
12. **There is no adoptable npm focal-point component.** An npm registry search for the obvious terms
    returns nothing in the category; every implementation above is in-house and small: Umbraco's focus
    setter is **8.8 KB of TS including its CSS**, Kirby's is a **~200-line Vue SFC**, Statamic's is
    **4.4 KB**. Build it. **[V]**

---

## §1 — Method / provenance

| What | How |
|---|---|
| Source reads | `raw.githubusercontent.com` at the branch named per project (`trunk` / `main` / `5.x` / `master`), plus the GitHub tree API to locate files. Every path and, where it matters, line context is quoted inline. No clones; nothing written outside this dossier. |
| Specs | W3C **CSS Backgrounds and Borders 3** (`background-position` percentage semantics) and **CSS Images 3** (`object-position`), fetched and text-extracted locally. |
| Vendor docs | Shopify `focal_point` object, imgix `crop=focalpoint` / `fp-x`, Cloudinary x/y qualifiers, Squarespace focal points — via WebFetch. Marked **[V-doc]**: the quotes are from the official page but arrived through the fetch summarizer. |
| Package survey | npm registry search API (`/-/v1/search`) for focal-point components. |
| ctrl-b's own code | Read directly (`frontend/src/themes/gacha/{roster,fleet}.ts`, `theme-engine/mediaRegistry.ts`, `backend/app/core/media.py`). §7. |

**Branches/revisions read:** WordPress/gutenberg `trunk` · sanity-io/sanity `main` · sanity-io/image-url
`main` · umbraco/Umbraco-CMS `main` · SixLabors/ImageSharp `main` · craftcms/cms `5.x` · getkirby/kirby
`main` · statamic/cms `5.x` · thephpleague/glide `master` · Shopify/dawn `main`.

**Reference-class note.** The peer class (opencode / Claude Code / open-webui / LibreChat / …) is
**empty** for this problem — none of them has image art with multiple destination windows. This is
therefore a **CMS/DAM + web-platform** pass in the R15/R26/R28 mould, exactly as R54 and R56 were. The
products chosen are the ones that solve *our* problem: one image, many surfaces, an owner who is not a
designer.

---

## §2 — Q1: the control on touch

### 2.1 Who ships which affordance

| Product | Primitive | Drag? | Touch? | Keyboard | Dot | Grid |
|---|---|---|---|---|---|---|
| **Umbraco** (backoffice) | **tap-to-place** (`@click`) | yes (`@mousedown` + **`@touchstart`**) | **yes** | focusable `<span role⁠-less, aria-label="Focal point">`, arrows **10 px**, **shift = 1 px (finer)** | 16 px, 2 px white border, double shadow, `pointer-events:none`, `scale(1.5)` dragging, `transition: 150ms transform` | none; `cursor: crosshair` |
| **Kirby** (`k-coords-input`) | **tap-to-place** (`@click`) | mouse only (`@mousedown` + window `mousemove`) | tap works, drag does not | thumb is a real `<button>`; arrows **1 %**, shift **10 %**, **Delete clears the focal point** | 16 px (`--range-thumb-size: 1rem`), white, `translate(-50%,-50%)`, `opacity:0` when unset | none |
| **Statamic** | **tap-to-place only** | **no drag at all** | yes (click) | none | 8 px white dot + a reticle sized `min(w,h)/z` | none; 9 live preview frames instead |
| **Sanity** (image tool) | drag a **region** (ellipse) + a crop rect | yes, **Pointer Events + `setPointerCapture` + `touch-action: none`** | **yes** | `tabIndex=0` on hotspot *and* crop, arrows **0.5 %**, shift ×5, save debounced **300 ms** | handles 16 px visual / **24 px invisible hit area** | crop rect is the overlay |
| **Craft** | toggle a marker on, then drag | yes (fabric.js canvas) | [U] | none found | outer circle r = 8 `rgba(0,0,0,.5)` + 2 px white stroke; inner r = 1; picked-indicator r = 12 | none |
| **Gutenberg** | drag, or click anywhere in the drag area | **mouse only** — `onMouseDown` + `document.addEventListener('mousemove'/'mouseup')` | **NO** | drag area is **`tabIndex={-1}`**; the reachable controls are two `%` `UnitControl`s (`Left`/`Top`) and arrow-nudge once focused programmatically (`step = shiftKey ? 0.1 : 0.01`) | **40×40 px**, `background: rgba(255,255,255,.4)`, `backdrop-filter: blur(16px) saturate(180%)`, `box-shadow 0 0 8px rgba(0,0,0,.1)`, `scale(1.1)` + heavier shadow while dragging, `transition: transform 100ms linear`, `z-index: 10000` | **rule-of-thirds at 33 %/66 %**, 1 px `rgba(255,255,255,.4)` lines with the same backdrop-filter, **flashed for `GRID_OVERLAY_TIMEOUT = 600 ms` on every value change** |
| **Shopify** | "**either click the image or drag the blue dot**" | yes | yes | [U] | blue dot [V-doc] | [U] |
| **Squarespace** | "**Click and drag the focal point**" — "a small circle" revealed on hover; **auto-saves on release** | yes | [U] | [U] | small circle [V-doc] | [U] |

**All [V] except the Shopify/Squarespace rows ([V-doc]) and the marked [U]s.**

### 2.2 The three concrete affordances, with their code

**(a) Tap-to-place, dot is decoration.** Umbraco, verbatim:

```ts
#DOT_RADIUS = 8 as const;
#setFocalPointStyle(left, top) {
  this.focalPointElement.style.left = `calc(${left * 100}% - ${this.#DOT_RADIUS}px)`;
  this.focalPointElement.style.top  = `calc(${top  * 100}% - ${this.#DOT_RADIUS}px)`;
}
…
#focal-point { width: calc(2 * var(--dot-radius)); border: solid 2px white; border-radius: 50%;
               pointer-events: none; transition: 150ms transform; }
.focal-point--dragging { cursor: none; transform: scale(1.5); }
```
*(`Umbraco.Web.UI.Client/…/input-image-cropper/image-cropper-focus-setter.element.ts`, main)* **[V]**

`pointer-events: none` on the dot is the load-bearing line: **the dot can never intercept the tap**, so
"tap somewhere else" always works even when you tap *on* the current dot. Everyone who ships tap-to-place
does this (Statamic's reticle: `pointer-events: none`; Kirby's thumb is a `<button>` but the container
handles the click).

**(b) Tap, then hand focus to the thumb.** Kirby, verbatim:

```js
async onMove(e) {
  const bounds = this.$el.getBoundingClientRect();
  const coords = this.getCoords(e, bounds);
  this.onInput(e, { x: (coords.x/bounds.width)*100, y: (coords.y/bounds.height)*100 });
  await this.$nextTick();
  this.focus();                     // ← moves focus to the thumb button
}
```
*(`panel/src/components/Forms/Input/CoordsInput.vue`, main)* **[V]**

Tap gets you within a finger-width; the arrow keys refine from there without a second aim. Umbraco does
the same (`handle?.focus()` in both the click and the drag handler).

**(c) Drag with a live imperative preview, commit at the end.** WordPress, verbatim:

```js
const imperativeFocalPointPreview = ( value ) => {
  const [ styleOfRef, property ] = mediaElement.current
      ? [ mediaElement.current.style, 'objectPosition' ]
      : [ coverRef.current.style, 'backgroundPosition' ];
  styleOfRef[ property ] = mediaPosition( value );
};
…
<FocalPointPicker onDragStart={ imperativeFocalPointPreview }
                  onDrag={ imperativeFocalPointPreview }
                  onChange={ ( p ) => setAttributes( { focalPoint: p } ) } />
```
*(`block-library/src/cover/edit/inspector-controls.js`, trunk)* **[V]**

Sixty-frames-a-second preview with **zero React renders during the drag**; one state commit at drag end.

### 2.3 Numeric fallback and value granularity — measured

| Product | Stored precision | Arrow step | Shift |
|---|---|---|---|
| Gutenberg | `Math.round(n*1e2)/1e2` → **2 dp of a 0–1 fraction** (= 1 % steps in the UI, 0.01 in storage) | 0.01 | 0.1 (**coarser**) |
| Craft | `number_format(x, 4)` → **4 dp**, stored `"0.3125;0.6250"` | n/a | n/a |
| Shopify | emits 4 dp (`1.9231% 9.7917%`) | [U] | [U] |
| Kirby | `round($point, 3)` on parse; UI stores whole percent | 1 % | 10 % (**coarser**) |
| Statamic | `.toFixed()` → **integer percent**, stored `"50-50-1"` | n/a | n/a |
| Sanity | full float | 0.005 | ×5 (**coarser**) |
| Umbraco | full decimal | 10 px | **1 px (finer — inverted vs everyone else)** |

**What that granularity is worth on a phone, computed:** a 1 % focal step moves the rendered image by
1 % of the *scaled* image. On a 390 px-wide window with a cover scale of 2× (a 2:1 source in a 1:1 hole),
that is **7.8 px** under centered semantics and **3.9 px** under proportional. So **integer percent is
already finer than the eye needs, and 2 decimal places is over-precision.** Craft's and Shopify's four
decimals are storage habit, not a requirement. **[V, arithmetic from the formulas in §5]**

**And what a finger is worth:** ~9 mm ≈ 44 CSS px. On a 390 px-wide preview that is **11 % of the image
per fingertip**. Tap-to-place alone therefore lands you within roughly ±5 %. Every product that ships
tap-only compensates with something else — Statamic with nine live previews, Kirby and Umbraco by moving
focus to the thumb so arrows can refine. **We have no arrow keys on the phone**, which makes the preview
the compensator. **[V for the field behaviour; the 9 mm figure is the standard touch-target basis]**

### 2.4 The occlusion problem nobody in this class solves

Every product above asks the user to place a **16–40 px dot under their own fingertip**, which is under
the finger while it moves. The mitigations found are cosmetic — `scale(1.1)` (Gutenberg), `scale(1.5)`
(Umbraco), `cursor: none` (Umbraco). **No magnifier, no loupe, no offset drag, no "dot follows above the
finger" in any of the seven implementations read.** **[V — a negative finding: I looked for it in all
seven]**

The idiom that *does* dodge occlusion is the one R56 already named and the one **react-easy-crop already
gives us**: move the **image** under a fixed window, not a dot under a finger. The thing being aimed is
600 px wide, not 16 px, and it is never under the finger. See §9.

---

## §3 — Q2: how crop and focal compose in a shipped product

### 3.1 The four shapes found

| Shape | Who | Where focal lives | Editable later? |
|---|---|---|---|
| **One screen, focal is the default view, crop is a per-destination override** | **Umbraco** | on the image value | yes — it *is* the editing surface |
| **One dialog holding both at once** (crop rect + hotspot region drawn on the same image) | **Sanity** | on the image reference | yes — opened from the field's menu at any time |
| **Both inside one image editor, different toolbar buttons** | **Craft** (crop/rotate/flip + a focal-point toggle) | on the asset | yes — "Edit image" from the assets index |
| **Two unrelated places** | **WordPress** (crop in the media library; focal in the block inspector), **Shopify** (crop in the media editor; focal in Files / theme editor) | WP: on the *block*. Shopify: on the file | yes for both |

**6 of 6 products let you set the focal point long after upload, and NONE of them puts it in the upload
wizard.** Focal editing is reached from the asset's own management surface: Umbraco's property editor,
Sanity's field menu, Craft's assets index, Shopify's Files page, Kirby's file page, Statamic's asset
editor. **[V for Umbraco/Sanity/Kirby/Statamic/Craft from source and file layout; [V-doc] for
Shopify]** This directly answers the owner's "management framework, not a one-shot wizard".

### 3.2 The Umbraco composition, in detail — this is the design the brief describes

Layout (`image-cropper-field.element.ts`, main) **[V]**:

```
:host { display: flex; height: 400px; gap: … }
#main { max-width: 500px; min-width: 300px; }      ← the focus setter, OR the crop editor
#side { display: grid;
        grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
        overflow-y: auto; }                        ← one preview card per named crop
```

Behaviour, verbatim from the same file:

- default `#main` = `<umb-image-cropper-focus-setter>` over the **whole image**;
- `#side` = `repeat(this.crops, …)` of `<umb-image-cropper-preview .crop .focalPoint .src>` — **each
  card is bound to the live focal point**;
- `onCropClick(crop)` sets `currentCrop`, which swaps `#main` into `<umb-image-cropper>` for **that one
  crop**; saving it writes `crop.coordinates`;
- a card whose crop has `coordinates` renders a **`"User defined"`** badge under its alias and its
  `W x H`;
- a **"Reset focal point"** button appears in `#main`'s action row only `when(focalPoint && (left !== 0.5
  || top !== 0.5))`.

And the render rule (`ImageCropperValue.GetCropBaseOptions`, C#) **[V]**:

```csharp
if ((preferFocalPoint && HasFocalPoint()) || (crop is not null && crop.Coordinates is null && HasFocalPoint()))
    → FocalPoint
if (crop is not null && crop.Coordinates is not null && preferFocalPoint == false)
    → the explicit crop rect
```

with

```csharp
public bool HasFocalPoint() => FocalPoint is not null && (FocalPoint.Left != 0.5m || FocalPoint.Top != 0.5m);
```

**Centre means "unset".** No nullable-vs-default ambiguity, no migration when the field is added.

### 3.3 Sanity's composition — both on one canvas, and a *region* rather than a point

Sanity's hotspot is not a point: it is an **ellipse** `{x, y, width, height}` (fractions), drawn on the
same SVG as the crop rectangle, both draggable and resizable with Pointer Events. The consequence is
visible in the render math (§5.4): when the requested window cannot contain the whole hotspot region,
Sanity **letterboxes rather than cut into it** (`method = 'letterbox'`). A point cannot express "this
much must survive"; a region can. **[V]**

Handle sizing, verbatim (`imagetool/constants.ts`) **[V]**:

```ts
export const HANDLE_VISUAL_SIZE_HOTSPOT = 16
export const HANDLE_VISUAL_SIZE_CROP = 8
export const HANDLE_INTERACTIVE_SIZE = 24     // “Ensure we have enough space for the handles to be interactive”
export const MARGIN_SIZE = HANDLE_INTERACTIVE_SIZE / 2
export const MIN_CROP_SIZE = 0.05             // “Prevent resizing the crop to less than 5% of the image size”
export const KEYBOARD_MOVEMENT_STEP = 0.005
export const KEYBOARD_SHIFT_MULTIPLIER = 5
export const KEYBOARD_CHANGE_SAVE_DEBOUNCE_MS = 300
```

The **16 visual / 24 interactive** split is the field's answer to WCAG 2.5.8 without a fat handle.

---

## §4 — Q3: destination previews

**Yes, and it is the norm.** Three shipped forms, in ascending cost:

**① Fixed ratio strip — Sanity.** `ImageToolInput.tsx`, verbatim **[V]**:

```tsx
const DEFAULT_PREVIEWS: HotspotPreview[] = [
  {title: '3:4',      aspectRatio: 3 / 4},
  {title: 'Square',   aspectRatio: 1 / 1},
  {title: '16:9',     aspectRatio: 16 / 9},
  {title: 'Panorama', aspectRatio: 4 / 1},
] as const
```
rendered in a `<Grid gridTemplateColumns={4}>`, each an `<h4>` label over a `RatioBox` containing a
`<HotspotImage aspectRatio srcAspectRatio hotspot crop>`. **Overridable per schema** via
`schemaType.options.hotspot.previews`. They read `localValue`, which the tool updates on **every pointer
move** (`onChange={setLocalValue}`; `onChangeEnd` commits), so they animate under the finger.

**② Real destinations — Umbraco.** One card per configured crop, showing **alias · `W x H` · a "User
defined" badge**, tappable to open that crop's editor. §3.2.

**③ Nine frames — Statamic.** The whole editor background is a 3×3 mosaic of preview frames sized
`66.66 % / 22.22 % / 11.11 %` on each axis (so: wide, square-ish and tall, in every combination), with a
380 px toolbox floating at `top: 20px; left: 20px`, and the caption key
`messages.focal_point_previews_are_examples` — **"previews are examples"**, i.e. the product tells you
these are not your actual pages. Frames transition `all 0.5s ease`. **[V]**

**The lightest shipped version** is Sanity's: *n* `RatioBox`es, each an `<img>` absolutely positioned
inside `overflow: hidden`, driven by the same pure function that computes the real render. No canvas, no
extra fetch, one shared `src`.

---

## §5 — Q4: THE MATH. This is the decision.

### 5.1 What CSS percentages actually mean — the spec, verbatim

**CSS Backgrounds and Borders 3, `background-position`, `<percentage>` [V]:**

> A percentage for the horizontal offset is relative to *(width of background positioning area − width of
> background image)*. A percentage for the vertical offset is relative to *(height of background
> positioning area − height of background image)*, where the size of the image is the size given by
> `background-size`.
>
> For example, with a value pair of `0% 0%`, the upper left corner of the image is aligned with the upper
> left corner of, usually, the box's padding edge. A value pair of `100% 100%` places the lower right
> corner of the image in the lower right corner of the area. **With a value pair of `75% 50%`, the point
> 75% across and 50% down the image is to be placed at the point 75% across and 50% down the area.**

**CSS Images 3, `object-position` [V]:**

> The `object-position` property determines the alignment of the replaced element inside its box. The
> `<position>` value type (which is also used for `background-position`) … **is resolved using the
> concrete object size as the object area and the content box as the positioning area.**

So — with `object-fit: cover`, image width `S` ≥ box width `V`:

```
offset_px(P) = P × (V − S)          [P ∈ 0..1 ; V − S ≤ 0 so the offset is ≤ 0]
```

and the focal point at image-fraction `f` lands at screen position `P(V − S) + f·S`. Setting `P = f`
(what `object-position: f×100%` does) gives **`f·V`** — the focal point lands at fraction `f` **of the
window**. That is "proportional alignment", and it is *not* "centred".

### 5.2 What everything that really crops does — five sources, one formula

**ImageSharp `ResizeHelper.CalculateTargetLocationAndBounds` (C#, `main`) — the cleanest statement [V]:**

```csharp
float center = -(ratio * sourceWidth) * options.CenterCoordinates.Value.X;
targetX = (int)MathF.Round(center + (width / 2F));
if (targetX > 0) { targetX = 0; }
if (targetX < (int)MathF.Round(width - (sourceWidth * ratio)))
      { targetX = (int)MathF.Round(width - (sourceWidth * ratio)); }
```

**Umbraco's browser preview (TS, `main`) — same thing, with the intent in the comment [V]:**

```ts
// position image so that its center is at the focal point (default to center if null)
const focalPoint = this.#focalPoint ?? { left: 0.5, top: 0.5 };
let imageLeft = containerWidth  / 2 - imageWidth  * focalPoint.left;
let imageTop  = containerHeight / 2 - imageHeight * focalPoint.top;
// clamp
imageLeft = clamp(imageLeft, containerWidth  - imageWidth,  0);
imageTop  = clamp(imageTop,  containerHeight - imageHeight, 0);
```

**Craft `Image\Raster::scaleAndCrop` (PHP, `5.x`) [V]:**

```php
$centerX = $newWidth * $cropPosition['x'];
$x1 = $centerX - $targetWidth / 2;   $x2 = $x1 + $targetWidth;
if ($x1 < 0)          { $x2 -= $x1;             $x1 = 0; }
if ($x2 > $newWidth)  { $x1 -= ($x2 - $newWidth); $x2 = $newWidth; }
```

**Kirby `Image\Focus::coords` (PHP, `main`) [V]:**

```php
$x  = $sourceWidth * $x;
$x1 = max(0, $x - $width / 2);
if ($x1 + $width > $sourceWidth) { $x1 = $sourceWidth - $width; }
```

**League/Glide `Manipulators\Size::resolveCropOffset` (PHP, `master`) — what Statamic's `fit=crop-x-y-z`
runs on [V]:**

```php
$offset_x = (int) (($image->width() * $offset_percentage_x / 100) - ($width / 2));
if ($offset_x < 0)              { $offset_x = 0; }
if ($offset_x > $max_offset_x)  { $offset_x = $max_offset_x; }   // $max_offset_x = width − target
```

**Sanity `@sanity/image-url` (JS, `main`) — the same, over a *region* [V]:**

```js
// Center output horizontally over hotspot
const hotspotXCenter = Math.round((hotspot.right - hotspot.left) / 2 + hotspot.left)
let left = Math.max(0, Math.round(hotspotXCenter - width / 2))
// Keep output within crop
if (left < crop.left) { left = crop.left }
else if (left + width > crop.left + crop.width) { left = crop.left + crop.width - width }
```

**imgix, `crop=focalpoint` [V-doc]:** *"When set in combination with a relative horizontal (`fp-x`),
vertical (`fp-y`), and/or zoom (`fp-z`) value, will **center the image on those coordinates** and crop
from there."* `fp-x` / `fp-y`: **float 0.0–1.0 inclusive, default 0.5**; require `fit=crop` +
`crop=focalpoint`. **Cloudinary [V-doc]:** with `g_xy_center` the x/y qualifiers are *"The coordinates of
the center of gravity"*, and *"Values between 0.0 and 1.0 indicate a percentage. Integer values indicate
pixels."* **Squarespace [V-doc]:** *"The area set by the focal point now appears as the **center** of
your image."*

**In one line, normalised (window = 1, `s` = the cover-scaled image size in window units, `s ≥ 1`):**

```
offset_true(f) = clamp( 0.5 − f·s , 1 − s , 0 )
```

### 5.3 How far apart the two rules are — the number that decides it

`offset_prop(f) = f·(1 − s)`. Subtract:

```
offset_true − offset_prop = (0.5 − f·s) − f(1 − s) = 0.5 − f
```

**In window units. Times the window's width in pixels:**

> **Δ = (0.5 − f) × W pixels, for any image, at any zoom, until a clamp binds.**

| focal `f` | window 390 px | window 160 px (a fleet tile) |
|---|---|---|
| 0.50 | 0 px | 0 px |
| 0.40 | 39 px | 16 px |
| 0.25 | **98 px** | 40 px |
| 0.10 | **156 px** | 64 px |

Worked check, `W = 300`, cover-scaled image `S = 600` (s = 2), `f = 0.25`:
*proportional* — offset `= 0.25 × (300 − 600) = −75`; the focal lands at `0.25×600 − 75 = 75 px` = 25 %
across. *Centred* — offset `= 150 − 150 = 0`; the focal lands at `150 px` = dead centre. Difference
75 px `= 300 × (0.5 − 0.25)`. ✔

**Where the clamp binds**, the two converge — and it binds whenever `|0.5 − f·s|` leaves `[1 − s, 0]`,
i.e. for small overflow (`s` near 1) or extreme `f`. Two useful limits: as `s → ∞` the two rules
**coincide** (`P_true → f`), and at `s = 1` there is nothing to move so both are moot.

**Reading:** proportional alignment is a *weaker* promise — it says "roughly over there"; centred says
"in the middle if I can". Both keep the focal point **visible**; only centred keeps it **framed**.

### 5.4 Converting between them — the ten lines that let us use CSS and still mean "centred"

```
P_true(f, s) = clamp01( (f·s − 0.5) / (s − 1) )        for s > 1 ; use 0.5 when s == 1
```

```ts
/** `object-position` percentages that put the image's focal point in the MIDDLE of a cover-fitted
 *  box, clamped so no gap ever shows. Returns "50% 50%" when the box does not crop that axis. */
export function focalObjectPosition(
  imgW: number, imgH: number, boxW: number, boxH: number, fx: number, fy: number,
): string {
  const scale = Math.max(boxW / imgW, boxH / imgH);      // cover
  const sx = (imgW * scale) / boxW;                      // ≥ 1
  const sy = (imgH * scale) / boxH;                      // ≥ 1
  const p = (f: number, s: number) =>
    s > 1 + 1e-6 ? Math.min(1, Math.max(0, (f * s - 0.5) / (s - 1))) : 0.5;
  return `${(p(fx, sx) * 100).toFixed(2)}% ${(p(fy, sy) * 100).toFixed(2)}%`;
}
```

Sanity checks against the table above: `s = 2, f = 0.25 → (0.5 − 0.5)/1 = 0 → "0%"` (image's left edge
at the box's left edge → focal centred ✔). `s = 2, f = 0.9 → 1.3 → clamped to 1 → "100%"` ✔.
`s = 3, f = 0.5 → 0.5 → "50%"` ✔.

**The alternative, if we do not want to know the box size:** copy Umbraco's preview — absolutely position
the `<img>` with `width`/`height` percentages inside an `overflow: hidden` container and set `top`/`left`
from the clamped-centre formula directly. That is what their preview cards do, and it needs no
`object-position` at all.

### 5.5 Measured gotchas

1. **`object-fit: contain` + a focal point is actively wrong, not merely useless.** With `contain` there
   is no crop, so `object-position` positions the *letterboxed* image inside the box — a focal point of
   `{0.2, 0.2}` shoves the whole picture into the top-left corner and puts the empty space on the other
   two sides. R56 §9 established that most of our windows paint `contain`. **Focal must be applied only
   on surfaces that actually cover.** **[V from the spec text in §5.1]**
2. **`background-position` and `object-position` have identical percentage semantics** — the spec defines
   `object-position`'s computed value "as for `background-position`" — so a stored pair works for both,
   and WordPress emits both from one helper (`objectPosition` for the `<img>` variant,
   `backgroundPosition` for the parallax/repeated variants). **[V]**
3. **Craft ships both mappings from one stored value.** `getFocalPoint(asCss: true)` returns
   `($focal['x']*100) . '% ' . ($focal['y']*100) . '%'` — proportional — while `scaleAndCrop` centres.
   If we expose a focal point to *both* a CSS surface and a server/canvas crop, they will disagree by
   §5.3's Δ unless we pick one rule and convert. **[V]**
4. **Rounding is not a hazard at our sizes** (§2.3): 1 % ≈ 4–8 px on a 390 px window. Store 3–4
   decimals of a 0–1 fraction at most; two is enough.
5. **Everyone treats `{0.5, 0.5}` as "unset".** Umbraco's `HasFocalPoint()`, Umbraco's `isCentered()`
   helper, Kirby's `50% 50%` default, imgix's `fp-x` default `0.5`, Shopify's *"Returns 50 if no focal
   point is set"*. Nobody carries a separate null flag into the render path. **[V + V-doc]**

---

## §6 — Q5: storage shape, and whether crop is non-destructive

### 6.1 What each product persists

| Product | Focal shape | Where | Crop shape | Destructive? |
|---|---|---|---|---|
| **Sanity** | `hotspot: {x, y, width, height}` — a **region**, fractions, default `{0.5,0.5,1,1}` | on the **image field value** (beside the asset `_ref`), not on the asset doc | `crop: {top, bottom, left, right}` — fractional **insets**, default all `0` | **No.** CDN applies `rect=l,t,w,h` per request |
| **Umbraco** | `focalPoint: {left, top} | null` | in the **property value JSON** | `crops: [{alias, width, height, coordinates?: {x1,y1,x2,y2}}]` — insets, **per named crop, optional** | **No.** ImageSharp applies `cc=` / `rxy=` per request |
| **Craft** | `focalPoint` **varchar** `"0.3125;0.6250"` (`number_format(x,4) . ';' . …`), `null` when unset | column on the **asset record** | transforms are non-destructive; the image editor's crop **writes the file** | **Mixed** |
| **Kirby** | `focus` **string** `"34.9% 62.1%"` in the file's content txt; accepts named gravities and 0–1 or 0–100 | **content file** beside the image | none — `crop()` derives thumbs from focus | **No** |
| **Statamic** | `"50-50-1"` = `x-y-zoom`, integer percent | asset meta | none — Glide derives | **No** |
| **Shopify** | percent x/y on the **file**; *"Returns 50 if no focal point is set"*; `image_tag` emits `object-position` | on the file record | separate media editor with ratio presets | **[R]** crop bakes a new file |
| **WordPress** | `focalPoint: {type: "object"}` — a **block attribute** in `cover/block.json`, stored **in post content** | **per placement** | media-library "Edit image" writes a **new attachment** | **Yes** for crop |
| **Squarespace** | per placement; auto-saves | per block | — | — |

**[V] for Sanity/Umbraco/Craft/Kirby/Statamic/WordPress; [V-doc] for Shopify/Squarespace.**

### 6.2 The refinement to a fact the brief lists as known

The brief states, as settled, that *focal is a property of the IMAGE, not the destination.* That is true
of **6 of 8** products here — and it is **false of the two most-deployed pickers in the world**:
Gutenberg's `focalPoint` is a block attribute (per placement) and Squarespace's is per image block. The
per-image rule is still the right one for us (one machine's art, five surfaces, one owner), but "the
field is unanimous" would be wrong, and the *reason* the two outliers differ is instructive: both are
page builders where the same asset is deliberately reused with different intent per placement. Our
gallery is not that. **[V]**

### 6.3 The "region, not a point" option

Sanity is the only product here whose focal is a **region**, and it buys one concrete behaviour a point
cannot: `calculateStyles.ts` computes `maxHotspotXScale = 1/hotspot.width`, `minFullBleedScale`, and
**if `minFullBleedScale > maxScale` it letterboxes** rather than cut the protected area
(`method = 'letterbox'`). A point can only say *where*; a region can say *how much must survive*. Cost:
two more drag handles and a resize gesture on a phone. **[V]**

### 6.4 The honest read on "non-destructive"

**Yes — for multi-destination art the field is non-destructive, and plainly so.** Sanity and Umbraco both
keep the original bytes and store crop as fractional metadata; Kirby and Statamic store no crop at all
and derive every thumb.

**But the premise our design rests on is not thereby wrong.** Every non-destructive implementation in
this list pays for it with a **server-side or CDN image pipeline that re-crops per request** — Sanity's
CDN, Umbraco's ImageSharp middleware, Kirby's thumb driver, Glide. R55 bought a raw-PUT write endpoint
and static-file serving; **ctrl-b has no image processing on the server at all** (`core/media.py` reads
*header bytes only* — it deliberately has no decoder and no third-party imaging dep). Our
non-destructive option is therefore not "store a rect and let the server cut it" but "**store a rect and
let CSS cut it**", which is exactly what the focal point already is, and which R54's canvas pipeline
would otherwise bake.

So the accurate statement is: **for a variable-ratio destination, non-destructive is both the field norm
and free for us (it is CSS). For a fixed-ratio destination, non-destructive would cost a server-side
imaging dependency we have deliberately not taken — so baking pixels at upload remains the right call
there.** That is the same split R56 §9 reached from a different direction.

---

## §7 — What ctrl-b already has (read this before designing anything)

**We already ship a focal point.** `frontend/src/themes/gacha/roster.ts`:

```ts
/** Optional `object-position` focal point; absent → the theme's default crop. */
focus?: string;
```

on `RosterEntry` — i.e. **on the image entry**, which is the field-correct home, and it is already
written as an `object-position` pair (proportional semantics). **[V, repo]**

**We already derive a per-surface variant of it.** `frontend/src/themes/gacha/fleet.ts`:

```ts
export const COVER_HERO_SHIFT = 20;   // percentage points, LEFT, for the HERO slot
export function coverHeroFocus(focus: string | undefined): string | undefined { … }
```

with a documented fallback chain (`--cv-hero-focus` → `--cv-focus` → `50% 22%`), a render-path
degradation contract, and an `Infinity` guard. Plus a dozen hand-tuned literals in `gacha.css`
(`object-position: 52% 30%`, `50% 12%`, `50% 46%`, `50% 16%`, `50% 6%` …). **The v1 feature is not "add a
focal point" — it is "let the owner author the one we already consume, instead of us hand-tuning it in
CSS."** **[V, repo]**

**The intrinsic dimensions we need for the centred math are already on the wire.** `MediaFile` in
`backend/app/core/media.py` carries `width: int | None` and `height: int | None` (header-parsed, no
decode). So `focalObjectPosition()` from §5.4 can run client-side with no measurement and no extra
request. **[V, repo]**

**Two seam warnings.**
① `MediaRoleDef` (`theme-engine/mediaRegistry.ts`) is the right home for *"does this role offer a focal
control, and what preview windows should it show"* — but **not** for the focal value, which is per-file.
② The persisted media config is `media.<ns>.roles.<role>.{order: [filename…], slots: {name: name}}`.
Adding `focal: {filename: "x% y%"}` beside `order` is **exactly** the "parallel sibling maps keyed by the
same name" shape the owner's 2026-06-24 extend-don't-migrate directive names as the anti-pattern — and
the field agrees: **Sanity and Umbraco each keep ONE per-image value object holding crop *and* hotspot
together.** The unified shape is `files: {<filename>: {order?, focal?, …}}` (or an ordered list of
objects), and it is cheap now because the map is empty. **[V, repo + the two source reads]**
③ `MediaFile.revision` is an opaque change token for *these bytes*. A focal point keyed by filename
survives a byte-replacement under the same name — which is a stale-framing bug waiting to happen. The
existing precedent (the reel figure's failure latch keys on `(url, revision)`) is the answer.

---

## §8 — Bounded open sweep — 3 findings none of the questions asked about

**① Gutenberg's rule-of-thirds grid is a *transient*, and that is why it works.** `GRID_OVERLAY_TIMEOUT
= 600` — the 33 %/66 % overlay fades in on **every value change** and back out 600 ms later
(`transition: opacity 100ms linear`), so it is a compositional cue while you are aiming and invisible
while you are looking. A permanent grid over a small phone preview would fight the picture. Ten lines,
and the only "what am I aiming at" affordance any of the seven implementations ships. **[V]**

**② Statamic ships a ZOOM axis on the focal point, and it changes the stored shape.** `"50-50-1"` is
`x-y-z`; `z` is a `<input type="range" min="1" max="10" step="0.1">` and the reticle's size is
`min(imageW, imageH) / z` — so the control shows you *how much* will be kept, not just where the middle
is. Glide honours it by scaling the source **before** cropping (`$image->scale(ceil($resize_width *
$zoom), …)`). imgix has the same third parameter (`fp-z`). This is the cheapest way to express "crop
tighter" **without a crop rectangle** — one slider, one number, and it composes with the same clamped
formula. Worth knowing before we conclude that "tighter" requires the full crop editor. **[V + V-doc]**

**③ The reference class has a shared naming convention we should not invent around.** `x`/`y` (imgix,
Sanity, Statamic, Craft, Shopify), `left`/`top` (Umbraco, Kirby's CSS output), fractions `0..1` (imgix,
Sanity, Umbraco, Craft) vs percent `0..100` (Shopify, Kirby, Statamic). The **majority and the CSS-facing
choice** is `{x, y}` as `0..1` fractions — which is also what Gutenberg's README prescribes verbatim
(*"returns it as a pair of numbers between 0 and 1 … `{ x: 0.5, y: 0.1 }` → `object-position: 50% 10%`"*)
and what our own `RosterEntry.focus` string decodes to. Storing percent strings (Kirby, Statamic, and our
current `focus` field) means every consumer re-parses; storing `{x, y}` means one formatter. **[V]**

---

## §9 — Recommendation for ctrl-b v1

*Evidence ages slowly; this reading ages fast. §§2–8 are the evidence; this is one reading of it.*

**① The control: a fixed reticle over a pannable image — not a dot.** Set the focal point by **panning
the image under a fixed centre reticle** (react-easy-crop's exact model, which R54 already chose and
which we are already shipping for crop). Reasons, in order of weight:
- it is the only idiom in this dossier with **no finger-occlusion problem** (§2.4) — the thing you aim is
  the whole image, never a 16 px target under your fingertip;
- it needs **zero new gesture code**: react-easy-crop already hands back the crop rect in **source
  pixels** (R54 §2.3), and the focal point is `((rect.x + rect.width/2) / naturalWidth, (rect.y +
  rect.height/2) / naturalHeight)` — one line;
- it makes the focal point and the crop **the same gesture**, which collapses two controls into one;
- and it survives the phone: pinch-zoom is the `fp-z` idea (§8②) for free.
**Add tap-to-place as the coarse entry** if the reticle proves fiddly — it is 5 lines (Kirby's `onMove`)
and it is what three of the four touch-capable products ship. **Never drag-only** (Gutenberg's form is
mouse-only; Notion's is desktop-only).

**② The flow: editable later, from the gallery row — never a wizard step.** 6/6 products put focal
editing on the asset's management surface, not in the upload path (§3.1). Ship it as a **"Framing" action
on the gallery row** that opens the same sheet the crop step uses. The upload path keeps R56's ruling
unchanged: pick → crop sheet → ✓, with the cover-fit default meaning "use as is". A focal point set at
upload is a free by-product of ① (the crop's own centre), so **the upload path gets a sensible default
without asking a second question.**

**③ Previews: Sanity's form, sized to our roles.** Under the reticle, a row of small `RatioBox`
previews — **one per destination window this file actually feeds**, driven by the role registry, labelled
with the role's `asset` noun. Update them **on every pointer move** from a local value; commit once on ✓
(§2.2c / §4). Two to four previews, not nine. Caption them honestly the way Statamic does.

**④ The math: store the focal point, render it CENTRED, and compute it client-side.**
- **Store** `{x, y}` as `0..1` fractions, 2 decimal places, `{0.5, 0.5}` = unset (§5.5⑤, §8③).
- **Render** with `focalObjectPosition()` (§5.4) — `P = clamp01((f·s − 0.5)/(s − 1))` — emitted as
  `object-position`. We can do this and Shopify/WordPress cannot, because `MediaFile` already carries
  `width`/`height` (§7) and our destination boxes are ours to measure.
- **Do not** ship the naive `object-position: x*100% y*100%`. It is one line cheaper and it is off by
  `(0.5 − f) × W` pixels — up to a **quarter of the window** at f = 0.25 (§5.3). Our windows are 160–390
  px wide; that is 40–98 px of wrong framing on the exact surfaces the feature exists to fix.
- **Apply it only where the surface covers.** On a `contain` surface a focal point is worse than nothing
  (§5.5①). Make that a property of the role, not a hope.
- **One rule, everywhere.** If any surface ever crops in canvas (a baked export), it must use the same
  clamped-centre formula, or it will disagree with CSS by the same Δ (§5.5③ — Craft's live bug).

**⑤ Storage: one per-file object, not a sibling map.** `media.<ns>.roles.<role>` grows a
`files: {<filename>: {focal?: {x, y}, …}}` (or `order` becomes a list of objects) rather than a `focal:`
map beside `order:` — the owner's extend-don't-migrate directive, and independently what Sanity and
Umbraco both do (§6.1, §7②). Migrate now while the map is empty. Key the value so a byte-replacement
invalidates it (`revision`, §7③).

**⑥ Scope: focal for variable-ratio surfaces, baked crop for fixed-ratio ones — unchanged.** R56 §9's
split survives everything here. What §6.4 adds is *why*: the field's non-destructive crop is bought with
a server-side imaging pipeline we deliberately do not have.

**What to avoid**
- **Gutenberg's picker as a model.** Mouse-only drag, `tabIndex={-1}` drag area, numeric-inputs-as-the-
  real-control. Steal its 600 ms rule-of-thirds flash (§8①) and its `imperativeFocalPointPreview`
  (§2.2c); leave the rest.
- **A draggable dot as the only affordance on a phone** (§2.4).
- **Sanity's hotspot *region*.** Two extra handles and a resize gesture on a 390 px screen, to buy a
  letterbox fallback we have no use for (§6.3).
- **Per-placement focal** (WordPress/Squarespace, §6.2). Our owner sets one machine's art once.
- **Four decimal places** (§2.3) and a separate null flag (§5.5⑤).
- **A crop rect per destination** (Umbraco's `coordinates` override) in v1. It is the right *eventual*
  shape and the registry already has the row for it — but it is a second editor, and the focal point is
  what the owner asked for.

---

## §10 — What I could not determine

- **Whether any of these focal controls is actually usable on a phone.** I read their event bindings and
  their CSS; I did not open one on a phone. Umbraco binds `@touchstart`, Sanity uses Pointer Events with
  `touch-action: none`, Kirby's `@click` fires on tap — all three *should* work, and none of the three
  products is a phone product. **No measured touch usability exists in this dossier.**
- **Craft's and Shopify's touch behaviour.** Craft's editor is fabric.js on a canvas ([U] whether its
  focal marker drags on touch). Shopify's "drag the blue dot" is [V-doc] only — I did not read the admin
  bundle.
- **Whether Shopify ever crops server-side around the focal point.** The docs say `image_tag` applies it
  via `object-position` (CSS-only, proportional). Whether `image_url`'s `crop:` parameter can take the
  focal point is [U] — I did not read that page.
- **Cloudinary's edge behaviour.** The x/y reference states `g_xy_center` means "the coordinates of the
  center of gravity" and that 0.0–1.0 are percentages, but *"does not mention whether crops are adjusted
  if they fall outside the image boundaries"*. I inferred clamping from the family; not verified.
- **Notion's "Reposition"** — still [R], as in R56. No account, and Notion's own help documents only
  `Add cover` / `Change cover`.
- **Any performance number.** No frame costs for a live-previewing drag on mid-range Android/Gecko, which
  is the constraint R33 names for our front end. §4's "update on every pointer move" is what the field
  ships on desktop; **whether 2–4 live previews plus a panning image hold 60 fps on the owner's phone is
  an unmeasured risk**, and the mitigation (WordPress's imperative style writes) is known but untested
  here.
- **Whether react-easy-crop's crop-centre is a *good* focal point in practice** — the algebra is trivial,
  the ergonomics ("did the owner mean the middle of what he framed?") are not something I can settle from
  source.
- **Statamic's zoom (`fp-z`) interaction with a CSS-only renderer.** Glide implements it by scaling
  before cropping; the CSS equivalent is a `background-size`/`transform` scale, which composes with
  `object-position` in a way I did not work through.
- **Immich, Ghost, Notion, LibreChat, open-webui: no focal point at all.** Recorded as a negative; I did
  not re-verify Immich beyond R56's read.

---

## §11 — Sources

**Specs**
- CSS Backgrounds and Borders Module Level 3 — `background-position` — https://www.w3.org/TR/css-backgrounds-3/
- CSS Images Module Level 3 — `object-position` §4.6 — https://www.w3.org/TR/css-images-3/
- WCAG 2.2 SC 2.5.8 Target Size (Minimum) — cited via R56 §3

**Source read at HEAD (paths as fetched, 2026-08-24)**
- WordPress/gutenberg `trunk`: `packages/components/src/focal-point-picker/{index.tsx,README.md,controls.tsx,focal-point.tsx,grid.tsx,utils.ts,styles/focal-point-picker-style.ts,styles/focal-point-style.ts}`; `packages/compose/src/hooks/use-dragging/index.ts`; `packages/block-library/src/cover/{shared.js,save.js,block.json,edit/inspector-controls.js}`
- sanity-io/image-url `main`: `src/{urlForImage.ts,parseSource.ts,types.ts}`
- sanity-io/sanity `main`: `packages/sanity/src/core/form/inputs/files/{ImageInput/ImageInputHotspotInput.tsx,ImageToolInput/ImageToolInput.tsx,ImageToolInput/imagetool/{constants.ts,HotspotImage.tsx,calculateStyles.ts,ToolSVG.tsx,ToolSVG.styles.tsx,hooks/usePointerHandlers.ts,hooks/useKeyboardControls.ts}}`
- umbraco/Umbraco-CMS `main`: `src/Umbraco.Infrastructure/PropertyEditors/ValueConverters/ImageCropperValue.cs`; `src/Umbraco.Cms.Imaging.ImageSharp/Media/ImageSharpImageUrlGenerator.cs`; `src/Umbraco.Web.UI.Client/src/packages/media/media/components/input-image-cropper/{image-cropper-field.element.ts,image-cropper-focus-setter.element.ts,image-cropper-preview.element.ts,utils.ts,types.ts}`; `src/Umbraco.Web.UI.Client/src/packages/core/utils/math/math.ts`
- SixLabors/ImageSharp `main`: `src/ImageSharp/Processing/Processors/Transforms/Resize/ResizeHelper.cs`
- craftcms/cms `5.x`: `src/image/Raster.php`; `src/elements/Asset.php`; `src/web/assets/cp/src/js/AssetImageEditor.js`
- getkirby/kirby `main`: `src/Image/Focus.php`; `panel/src/components/Forms/Input/CoordsInput.vue`; `panel/src/styles/reset/range.css`
- statamic/cms `5.x`: `resources/js/components/assets/Editor/{FocalPointEditor.vue,FocalPointPreviewFrame.vue}`; `resources/css/components/focal-point.css`
- thephpleague/glide `master`: `src/Manipulators/Size.php`
- Shopify/dawn `main`: `assets/base.css`, `sections/image-banner.liquid` (the negative — Dawn contains no `focal` reference; `image_tag` emits it)

**Vendor documentation (fetched 2026-08-24)**
- Shopify — `focal_point` object — https://shopify.dev/docs/api/liquid/objects/focal_point
- imgix — `crop=focalpoint` and `fp-x` — https://docs.imgix.com/en-US/apis/rendering/size/crop · `.../focalpoint-crop/fp-x`
- Cloudinary — x/y coordinate qualifiers — https://cloudinary.com/documentation/transformation_reference_x_y_x_y_coordinates
- Squarespace — Using focal points to center images — https://support.squarespace.com/hc/en-us/articles/205826028

**Package survey**
- npm registry search API — `focal point react`, `focal-point-picker`, `react focal point image` (no adoptable component; nearest hits are `react-image-crop`, `rc-image`)

**ctrl-b's own code (read, not modified)**
- `frontend/src/themes/gacha/roster.ts` · `frontend/src/themes/gacha/fleet.ts` · `frontend/src/themes/gacha/gacha.css` · `frontend/src/theme-engine/mediaRegistry.ts` · `backend/app/core/media.py`
