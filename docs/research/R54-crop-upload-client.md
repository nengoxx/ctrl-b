# R54 — The client half of "pick an image → crop → upload"

**Date of pass: 2026-08-24.** Scope: the BROWSER side only — picker, preview, crop UI, pixel export,
encode, and the guards each of those needs. The typed multipart upload API is R55; gallery UX is R56.
Neither is re-bought here.

**Confidence marks.** Every claim is tagged **[V]** verified (I read the primary source at the stated
revision, or probed it and pasted the output), **[R]** reported (secondary source, named), **[U]**
unverified (expected, not checked). §11 lists what I could not settle.

**Reference class note.** The peer class (opencode/Claude Code/open-webui/LibreChat/…) is *empty* for
this problem — none of them ships an image crop step. So this is a **web-platform** pass in the R15 /
R26 / R28 mould: engine source (Chromium main · mozilla-central tip), specs, BCD/caniuse, npm/GitHub
metadata, plus **live probes in the repo's own e2e browsers** (Playwright 1.61.1 → Chromium
149.0.7827.55, Firefox 151.0). No in-class dossier was skipped.

---

## 0. TL;DR — the eight facts that decide the design

1. **`createImageBitmap(file, sx, sy, sw, sh)` is unusable on EXIF-rotated photos.** Probed both
   engines with a 4-quadrant image carrying `Orientation=6`: Firefox 151 returns the correct
   quadrant, **Chromium 149 returns the wrong one**. Chromium's own source carries
   `TODO(crbug.com/40773069)` on exactly this line. `ctx.drawImage(src, sx,sy,sw,sh, …)` is **pixel-
   identical and correct in both engines**. → crop with `drawImage`, never with the crop-rect form. §3.2
2. **EXIF orientation is applied unconditionally, everywhere, in both engines** — `imageOrientation:
   'none'` is a **no-op** in Chromium (feature-flagged off, and deprecation-counted) and unimplemented
   in Gecko. `<img>.naturalWidth` is already oriented. Nothing to do — and nothing you can opt out of. §3.1
3. **`resizeWidth`/`resizeHeight` do NOT reduce peak memory.** Gecko's source decodes full → copies
   for the crop → copies again for the scale (peak is *worse*). Measured: resizing is **25–56 % slower**
   than a plain decode in both engines. It is a convenience, not a memory lever. §4.3
4. **An unsupported `toBlob` type silently yields PNG.** `image/avif`, `image/tiff`, `image/heic` all
   returned `image/png` at 7–8.7 MB in both engines. → always read `blob.type`; derive the filename
   from it, never from what you asked for. §3.3
5. **Chrome Android caps decoded image bytes at `totalRAM / 25`** (`3 MB × 4` = 3 MP on low-end
   devices) and **JPEG is silently IDCT-downscaled to fit**; PNG/WebP get no such cap and just try. Gecko
   has **no per-image cap at all**. → the input guard must be ours, and it matters most for PNG/WebP. §4.1
6. **Chromium fails an over-limit canvas SILENTLY** (probed: 20000×20000 and 65536×1 accept draws and
   read back `[0,0,0,0]`, no throw); Gecko throws `NS_ERROR_FAILURE`. §4.2, §10①
7. **`react-easy-crop` is the only candidate with real pinch-zoom**, hands back the crop rect **in
   source pixels**, and costs **8.60 KB gzip** (JS + CSS) with no runtime dependency tree. §2
8. **The repo already declares the output budget**: `mediaRegistry.ts` role bounds —
   `FULL_ART 4 MP / 1.5 MB`, `BANNER_ART 2 MP / 400 KB`, `LAYER_ART 1 MP / 500 KB`,
   `ICON_ART 262,144 px / 200 KB`. Capping the export at the role's `pixels` puts us **60× under the
   worst canvas limit** — canvas limits are an input-side problem only. §7

---

## 1. Method / provenance

| What | How |
|---|---|
| Bundle sizes | `esbuild 0.28.1` (the repo's own binary) `--bundle --minify --format=esm --target=es2022 --jsx=automatic`, `react`/`react-dom`/`react/jsx-runtime` **external**, `process.env.NODE_ENV="production"`, then `gzip -9`. Entry = the real public import each library documents. |
| React 19 compat | (a) installed `peerDependencies` read from `node_modules`; (b) `tsc 5.9` against `@types/react@19` with the repo's own `skipLibCheck: true`; (c) a **real mount** under `react-dom@19.2.8` `createRoot` + `StrictMode` in jsdom 29, counting `console.error`. |
| Maintenance | npm registry `time` map + GitHub REST `/repos` (stars / open issues / `pushed_at` / archived). |
| Engine behaviour | Chromium `main` via `chromium.googlesource.com` gitiles (`?format=TEXT`, base64); mozilla-central `tip` via `hg-edge.mozilla.org/raw-file/tip` + searchfox JSON. Paths + line numbers quoted inline. |
| Live probes | Playwright 1.61.1 (the repo's pin) → Chromium 149.0.7827.55 headless, Firefox 151.0 headless, on emma (x86_64, 30 GB). Test images generated with the repo's `sharp 0.35.3`. |

**Probe caveat, stated once and load-bearing:** every timing below is **headless desktop Linux**, not
a phone. Treat wall-times as *ratios*, not budgets; a mid-range Android is roughly 4–8× slower on
this kind of work (R33 §FE: "CPU on mid-range Android/Gecko, not bytes"). Chrome Android and Firefox
Android could not be probed from here — §11 lists the device-round items.

---

## 2. Q1 — the crop library

### 2.1 Measured sizes and metadata [V]

All numbers 2026-08-24. Total = minified+gzip JS **plus** the stylesheet the library requires.

| Package | Version (published) | JS gzip | CSS gzip | **Total gzip** | Runtime deps | npm/wk | GitHub |
|---|---|---:|---:|---:|---|---:|---|
| **react-easy-crop** | **6.2.3** (2026-07-24) | 7,995 B | 609 B | **8.60 KB** | `normalize-wheel` (bundled in) | 3.09 M | 2,772★ · **6 open** · pushed 2026-08-11 · MIT |
| **react-image-crop** | **11.1.2** (2026-06-21) | 4,052 B | 1,130 B | **5.08 KB** | **none** | 2.42 M | 4,104★ · 73 open · pushed 2026-06-21 · ISC |
| **react-avatar-editor** | **15.1.0** (2026-03-21) | 3,857 B | — | **3.86 KB** | **none** | 705 k | (canvas-native) |
| **cropperjs** (v2) | **2.2.0** (2026-08-23) | 12,376 B | (Shadow-DOM inlined) | **12.38 KB** | **10** `@cropper/*` pkgs | 1.66 M | 13,863★ · 41 open · pushed 2026-08-23 · MIT |
| react-cropper | 2.3.3 (**2023-04-12**) | 14,083 B | + `cropper.css` | ~14 KB+ | `cropperjs@1.6.3` (v1!) | 422 k | — |
| react-advanced-cropper | 0.20.1 (**2025-03-01**) | 25,193 B | 1,829 B | **27.02 KB** | `advanced-cropper`, `classnames`, `tslib` | 162 k | 884★ · 15 open · NOASSERTION licence |
| *hand-rolled* | — | 0 | 0 | **0** | none | — | est. 150–250 LOC |

Context for judging the KBs: the repo's current runtime dependency set is react + react-dom +
`@tanstack/react-query` + fontsource CSS. 8.6 KB gzip is roughly one extra font weight.

### 2.2 Interaction model — the discriminator [V]

Grepped the *minified output bundles* for the gesture primitives:

| | 2-finger pinch (`touches[1]` / distance) | wheel zoom | Safari `gesture*` | pointer drag |
|---|---|---|---|---|
| react-easy-crop | **yes** (`touches[1]`) | **yes** (`onWheel`) | **yes** (`gesturestart`/`gesturechange`) | `onTouchStart` + mouse |
| react-image-crop | no | no | no | `onPointerDown` (unified) |
| react-avatar-editor | no | no | no | `onTouchStart` only |
| cropperjs v2 | pointer-map based (`$pointers: Map`) + `$onWheel` | yes | no | Pointer Events |

The models differ in kind, not degree:

* **react-easy-crop** = a *fixed crop window* with the image panned/zoomed underneath (the
  Instagram/Android-picker idiom). Aspect is a prop; the crop rect is always exactly the aspect.
  On a 390 px viewport this is the only model where you can crop *tightly* into a 12 MP photo.
* **react-image-crop** = *drag a rectangle over a fit-to-screen image*. There is no zoom at all.
  To crop a small region of a 4000 px photo displayed at 390 px you drag a ~20 px rectangle with
  a finger. Correct on desktop, poor on a phone.
* **react-avatar-editor** = pan + a `scale` **prop** you drive from a slider. No pinch.

### 2.3 Does it give the crop rect in SOURCE pixels? [V]

**react-easy-crop: yes.** `onCropComplete(croppedArea, croppedAreaPixels)`. Read the built
`computeCroppedArea` — the pixel rect is computed against `mediaSize.naturalWidth/naturalHeight`
and `Math.round`ed:

```js
const mediaNaturalBBoxSize = rotateSize(mediaSize.naturalWidth, mediaSize.naturalHeight, rotation);
…
croppedAreaPixels: { ...sizePixels,
  x: Math.round(limitAreaFn(mediaNaturalBBoxSize.width  - sizePixels.width,
                            croppedAreaPercentages.x * mediaNaturalBBoxSize.width  / 100)),
  y: Math.round(limitAreaFn(mediaNaturalBBoxSize.height - sizePixels.height,
                            croppedAreaPercentages.y * mediaNaturalBBoxSize.height / 100)) }
```
*(`node_modules/react-easy-crop/index.module.mjs`, v6.2.3)*

Because `naturalWidth/Height` is already EXIF-oriented (§3.1), this rect is in the **same space** as
`createImageBitmap(file)`'s full decode — no conversion, no orientation bookkeeping. That is the
single biggest integration win on the list.

**react-image-crop: no.** `Crop` is `{x,y,width,height,unit:'px'|'%'}` in **displayed** pixels; you
must scale by `naturalWidth/width` yourself. It *ships* helpers to do it — and they are wrong for us
(see §10③).

**cropperjs v2 / react-avatar-editor: no rect at all** — they hand you a `<canvas>`
(`selection.$toCanvas(options)` / `editor.getImageScaledToCanvas()`). `$toCanvas()` defaults to the
selection's **display** size; you must pass `{width}` to get source resolution [V, read
`@cropper/element-selection`].

### 2.4 React 19 [V]

| | peerDeps | `tsc` w/ `@types/react@19` | real `createRoot` + `StrictMode` mount |
|---|---|---|---|
| react-easy-crop 6.2.3 | `react >=16.4.0`, `react-dom >=16.4.0` | clean under the repo's `skipLibCheck:true`; **fails** with `skipLibCheck:false` (`index.d.mts(218,13): TS2503: Cannot find namespace 'JSX'`) | **clean** — `reactEasyCrop_Container` rendered, 0 errors |
| react-image-crop 11.1.2 | `react >=16.13.1` | clean either way (uses `React.JSX`) | **clean** — `ReactCrop` rendered, 0 errors |
| react-avatar-editor 15.1.0 | explicitly `… ^19.0.0` | — | — |
| react-advanced-cropper 0.20.1 | `react >=16.8.0` | **7 files** fail on the same bare-`JSX` error | — |

* Both mounted under **react 19.2.8 / react-dom 19.2.8**, `StrictMode` double-invoke included, with
  zero console errors beyond the expected `act(...)` notice from my harness. [V]
* Neither uses any API React 19 removed — grepped both builds for `findDOMNode`, `componentWillMount`,
  `componentWillReceiveProps`, `contextTypes`, `createFactory`, `ReactDOM.render`: **react-easy-crop
  = zero hits**; react-image-crop = `defaultProps` only, on a **class** (still supported; only
  function-component `defaultProps` was removed). [V]
* The bare-`JSX` breakage is **not a blocker for us** — `frontend/tsconfig.app.json` sets
  `skipLibCheck: true`. It is a maintenance signal, not a gate. [V]
* react-easy-crop is mid-rewrite: issue **#664 "Migrate Cropper to Hooks and React Compiler"** is open
  (2026-08-11) with `7.0.0--canary.*` on npm. Adopting v6 means a v7 major is coming. [V]
* react-advanced-cropper's React-19 issues (#82, #85, #89) are all **closed** and its peer range
  already admits 19 — but the last release is **2025-03-01**. [V]

### 2.5 Keyboard / a11y [V, from rendered DOM]

Mounted both and dumped the markup.

**react-image-crop — best in class by a wide margin:**
```html
<div class="ReactCrop__crop-selection" tabindex="0" role="group"
     aria-label="Use the arrow keys to move the crop selection area">
  <div class="ReactCrop__drag-handle ord-nw" tabindex="0" role="button"
       aria-label="Use the arrow keys to move the north west drag handle to change the crop selection area">
  … ×8 handles, each labelled …
```
Plus `nudgeStep`/`nudgeStepMedium`/`nudgeStepLarge` and an overridable `ariaLabels` prop.

**react-easy-crop — focusable but unlabelled.** The crop area renders
`tabIndex: 0, onKeyDown, onKeyUp, data-testid="cropper"` — **no `role`, no `aria-label`**. Arrow keys
pan by `KEYBOARD_STEP = 1` px (`shiftKey` → ×0.2); **there is no keyboard zoom at all** (`MIN_ZOOM 1`,
`MAX_ZOOM 3`, changed only by pinch/wheel).
*Correction to my own first reading:* the focusable node is absent in jsdom because it only renders
once `state.cropSize` is measured, which needs a real layout — the library **is** keyboard-focusable
in a browser. Recorded because the wrong version of this claim is the kind that becomes folklore.

**react-avatar-editor / cropperjs v2:** no ARIA in the rendered output.

### 2.6 Ranked recommendation

**① `react-easy-crop@6.2.3` — recommended.** The mobile model, the only real pinch, the crop rect
already in source pixels, 8.60 KB gzip, no dependency tree, maintained this month. Cost of adoption,
all small and all local:
  * add `role="group"` + `aria-label` via `cropperProps` (the prop exists), and a visible zoom
    control (a range input bound to `zoom`) so zoom is reachable without a pinch;
  * pass `disableAutomaticStylesInjection` and `import "react-easy-crop/react-easy-crop.css"` instead —
    otherwise it injects a `<style>` at mount, outside Vite and outside the theme layer order. There is
    no CSP in this repo (grepped: none) so this is a cascade-ordering concern, not a security one; [V]
  * its dimming overlay is `box-shadow: 0 0 0 9999em` on the crop area — a 9999 em spread shadow is
    exactly the class of paint the `stylelint-high-performance-animation` rules exist to catch. It is
    static (not animated) so it should be fine, but it is overridable via `style.cropAreaStyle` if the
    device round shows scroll/paint cost. [V source; U cost]

**② Hand-rolled — a real, defensible second.** The crop math is ~40 lines and the house already owns
pointer-drag patterns to copy: `components/BottomSheet.tsx` (`setPointerCapture` + `touch-action:none`,
with the retargeting gotcha already documented in its header), `components/useDragReorder.ts`
(document-level listeners *without* capture, and the note saying why), `themes/gacha/GachaBanner.tsx`.
What we would be writing from scratch is the part where the bugs live: 2-pointer pinch with a stable
focal point, clamping pan so the crop window never leaves the image at any zoom, `ResizeObserver`
recompute, and `touch-action` correctness across both engines. Choose this only if the main seat wants
literally zero new deps; the honest trade is ~200 lines of gesture code against 8.6 KB.

**③ `react-image-crop@11.1.2`** — pick this *only* if the rect-over-image model is wanted. Smallest
complete option (5.08 KB), zero deps, best a11y in the field. Disqualifiers for phone-first: no zoom
of any kind, and its export helpers must not be used (§10③).

**④ `react-avatar-editor@15.1.0`** — smallest (3.86 KB), canvas-native, explicit React-19 peer. No
pinch; zoom is a slider you own. Reasonable if the crop is always a square avatar-ish thumb.

**⑤ `cropperjs@2.2.0` — no.** Most-starred and most-maintained of the set, but: 10 packages, Custom
Elements + Shadow DOM (imperative refs, hand-written JSX typings, our theme tokens do not cross the
shadow boundary), no source-pixel rect, and its React wrapper (`react-cropper`) is pinned to
**cropperjs 1.x** with a last release of **2023-04-12**.

**⑥ `react-advanced-cropper@0.20.1` — no.** 27 KB (3.1× the winner), last release 2025-03, `tslib` +
`classnames`, `NOASSERTION` licence, bare-`JSX` typings.

---

## 3. Q2 — the export path

### 3.1 EXIF orientation: settled, and there is no opt-out

Probed a 400×200 JPEG with `Orientation=6` (rotate 90° CW → displays 200×400):

| | Chromium 149 | Firefox 151 |
|---|---|---|
| `createImageBitmap(f)` | **200×400** | **200×400** |
| `createImageBitmap(f, {imageOrientation:'from-image'})` | 200×400 | 200×400 |
| `createImageBitmap(f, {imageOrientation:'none'})` | **200×400** (no-op) | **200×400** (no-op) |
| `<img>.naturalWidth × naturalHeight` (blob: URL) | **200×400** | **200×400** |
| same, with `image-orientation:none` on the `<img>` | 200×400 (no effect) | 200×400 (no effect) |
| `drawImage` into a canvas with `image-orientation:none` | oriented | oriented |

Why `'none'` does nothing, from source [V]:

* **Chromium** — `third_party/blink/renderer/core/imagebitmap/image_bitmap.cc` `ParseOptions()`:
  ```cpp
  parsed_options.orientation_from_image = true;
  parsed_options.source_orientation = source_orientation;
  if (base::FeatureList::IsEnabled(features::kCreateImageBitmapOrientationNone) &&
      options->imageOrientation() == V8ImageOrientation::Enum::kNone) {
    parsed_options.orientation_from_image = false;   // only under the flag
  ```
  and `third_party/blink/common/features.cc:346` — `BASE_FEATURE(kCreateImageBitmapOrientationNone, base::FEATURE_DISABLED_BY_DEFAULT);`
  `image_bitmap_source.cc` additionally does `Deprecation::CountDeprecation(… kObsoleteCreateImageBitmapImageOrientationNone)`
  with the comment *"imageOrientation: 'from-image' will be used to replace imageOrientation: 'none'."*
* **Gecko** — `dom/canvas/ImageBitmap.cpp` only ever tests
  `aOptions.mImageOrientation == ImageOrientation::FlipY`. There is no `none` branch. And
  `ImageBitmap.cpp:614` passes `nsLayoutUtils::SFE_ORIENTATION_FROM_IMAGE`, which forces
  `StyleImageOrientation::FromImage` regardless of CSS.

Spec side: `image-orientation`'s **initial value is `from-image`** and it **applies to all elements**
and is **inherited** (CSS Images 3, quoted verbatim: *Initial: from-image · Applies to: all elements ·
Inherited: yes*). BCD: `from-image` — Chrome **81**, Firefox **26**, Safari **13.1**, mobile mirrored.
MDN also warns *"`image-orientation: none;` does not override the orientation of non-secure-origin
images as encoded by their EXIF information, due to security concerns"* (csswg-drafts#5165).

**But the two engines read that property off different elements** [V] — a divergence worth writing down:

* Chromium — `canvas_2d_recorder_context.cc`, with the comment
  *"We always use the image-orientation property on the **canvas element** because the alternative
  would result in complex rules depending on the source of the image."*
* Gecko — `layout/base/nsLayoutUtils.cpp:7286` uses the **source element's** frame style
  (`content->GetPrimaryFrame()->StyleVisibility()->UsedImageOrientation(imgRequest)`), falling back
  to `FromImage` when the image has no primary frame (i.e. a detached `new Image()`).

→ **Design rule:** never set `image-orientation` anywhere in ctrl-b, and prefer `createImageBitmap`,
which ignores CSS in both engines. See §10②.

### 3.2 The crop rect: `drawImage`, never `createImageBitmap`'s sx/sy/sw/sh — a real cross-engine bug

Probe: 400×200, four pure quadrants (TL red · TR green · BL blue · BR yellow), `Orientation=6`.
The oriented image is 200×400 with TL=blue, TR=red, BL=yellow, BR=green — **both engines agree on that.**
Then I took the oriented top-left quarter `(0, 0, 100, 200)` and the bottom-right quarter
`(100, 200, 100, 200)`:

| | expected | Chromium 149 | Firefox 151 |
|---|---|---|---|
| `createImageBitmap(f, 0,0,100,200)` centre | blue `[0,0,254]` | **green `[0,255,1]` ✗** | blue `[0,0,254]` ✓ |
| `createImageBitmap(f, 100,200,100,200)` centre | green | **blue ✗** | green ✓ |
| same + `{resizeWidth:40,resizeHeight:40}` | blue | **green ✗** | blue ✓ |
| non-rotated (`Orientation=1`) control | red / yellow | ✓ | ✓ |

Chromium interprets the crop rect in the **pre-orientation** encoded space while returning an oriented
bitmap. Its own source says so — `image_bitmap.cc`:

```cpp
// TODO(crbug.com/40773069): This should use `parsed_options.source_size`,
// because it should be in the same (post-orientation) space.
```
and crbug **40773069** is titled *"createImageBitmap crop doesn't respect JPEG orientation"*
(component `Blink>Canvas`, FoundIn-91/92/93). The TODO is still in `main` at tip and the bug still
reproduces in Chromium 149. [V]

**The safe path, probed identical and correct in both engines, from both an `ImageBitmap` and an `<img>`:**

```js
ctx.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh)   // TL=blue TR=red BL=yellow BR=green, both engines
```

### 3.3 `toBlob` format/quality matrix — MEASURED

2000×2000 (4 MP) crop of a synthetic 12 MP photo, `canvas.toBlob`:

| requested | Chromium 149 | Firefox 151 |
|---|---|---|
| `image/png` | `image/png` **8,664,503 B** / 119 ms | `image/png` **7,078,157 B** / 137 ms |
| `image/jpeg` q0.92 | 1,270,000 B / 59 ms | 1,539,056 B / 26 ms |
| **`image/jpeg` q0.85** | **771,475 B / 23 ms** | **850,322 B / 18 ms** |
| `image/jpeg` q0.80 | 575,743 B / 22 ms | 647,375 B / 17 ms |
| `image/webp` q0.92 | 1,242,742 B / 382 ms | 1,245,568 B / 359 ms |
| **`image/webp` q0.85** | **818,490 B / 332 ms** | **820,912 B / 311 ms** |
| `image/webp` q0.80 | 616,582 B / 304 ms | 618,120 B / 291 ms |
| `image/avif` q0.8 | → **`image/png` 8,664,503 B** | → **`image/png` 7,078,157 B** |
| `image/tiff` q0.8 | → `image/png` | → `image/png` |
| `image/heic` q0.8 | → `image/png` | → `image/png` |

Full 12 MP (4000×3000) canvas:

| | Chromium 149 | Firefox 151 |
|---|---|---|
| jpeg q0.85 | 2,858,160 B / **95 ms** | 3,253,885 B / **53 ms** |
| webp q0.85 | 2,357,018 B / **969 ms** | 2,365,594 B / **921 ms** |
| png | 25,788,104 B / 358 ms | 21,134,901 B / 416 ms |

And at a realistic output size, 1400×1400, through a Worker (`OffscreenCanvas.convertToBlob`):

| | Chromium 149 | Firefox 151 |
|---|---|---|
| jpeg q0.85 | 276,473 B | 291,039 B |
| webp q0.85 | **255,754 B** | **240,540 B** |
| avif q0.85 | → `image/png` **4,322,675 B** | → `image/png` 3,528,803 B |

**Firefox CAN encode WebP** — BCD `HTMLCanvasElement.toBlob.type_parameter_webp`: **Firefox 96**
(`firefox_android` mirrored), Chrome 50, **Safari `false`**. Confirmed by the probe. Same for
`OffscreenCanvas.convertToBlob.option_type_parameter_webp` (Chrome 69 / FF 105 / Safari ✗). [V]

The fallback is spec-mandated, not a bug — HTML Standard: *"The default is 'image/png'; **that type is
also used if the given type isn't supported.**"* → **read `blob.type`.** The AVIF row is the teeth: a
4.3 MB PNG uploaded where a 250 KB AVIF was intended, silently, past a magic-byte check.

**Reading of the numbers.** WebP is *not* uniformly smaller: at 4 MP on high-frequency content it was
**6 % larger** than jpeg q0.85 while costing **14–17× the encode time**; at 1400 px (after the
downscale removes the high frequencies) it was **8–17 % smaller** at **2.2–2.4×** the time. So WebP
buys you a small size win and one thing jpeg cannot do at all: **alpha**.

### 3.4 Recommended output-format policy

**Always re-encode. Never forward the original bytes.** One code path that simultaneously: applies the
crop, normalises to the allowlist, caps pixels to the role bound, and strips EXIF/GPS.

```
alpha possible?  →  image/webp  q0.90     (source MIME ∈ {png, webp, avif, gif}, or the role needs alpha)
otherwise        →  image/jpeg  q0.85
then             →  read blob.type; if it is not what you asked for, fall back deliberately
                    (webp-unsupported → png, and re-check size against the role's bytes bound)
```

Rationale: jpeg q0.85 at 2000×2000 lands at **771–850 KB**, inside `FULL_ART`'s 1.5 MB bound with room,
at 18–23 ms; webp would cost 311–332 ms for a *larger* file. Where transparency matters (`LAYER_ART`,
`ICON_ART`) jpeg is simply wrong, and at those sizes webp's encode cost is negligible.
q0.85 is the knee of the measured curve (q0.92 → +65 % bytes for no visible gain on a phone; q0.80 →
−25 % bytes with visible ringing on flat gradients [U — not eyeballed]).

### 3.5 What a canvas re-encode strips — MEASURED

JPEG produced by `toBlob('image/jpeg', 0.85)`, first 4 KB scanned for markers:

| | `Exif` | `ICC_PROFILE` | XMP (`ns.adobe.com/xap`) | `JFIF` |
|---|---|---|---|---|
| Chromium 149 | **no** | **yes** | no | yes |
| Firefox 151 | **no** | no | no | yes |

Chromium leading bytes: `ff d8 ff e0 00 10 4a 46 49 46 …` then `ff e2` (APP2/ICC).
Firefox: `ff d8 ff e0 … 4a 46 49 46 …` then `ff db` (DQT) — nothing but JFIF.

**EXIF, GPS and XMP are gone in both.** This is a *feature* for us: the owner uploads phone photos to
a homelab panel; the GPS tag of their house does not need to land in `$CTRLB_HOME/media`. It also
means the server never needs to strip metadata (and it has no Pillow to do it with — locked). The one
thing that does survive in Chromium is an sRGB ICC profile, ~470 bytes — harmless, and it makes the
two engines' outputs byte-different, so **never assert on exported bytes in a test**; assert on
dimensions and `blob.type`.

### 3.6 `createImageBitmap` vs `<img>` — which to decode with

| | `createImageBitmap(file)` | object URL + `<img>` |
|---|---|---|
| Needs a blob URL | no | yes (+ revoke lifecycle, §6) |
| EXIF | always applied, CSS-proof | applied, but via CSS `image-orientation` (§3.1) |
| Async shape | Promise, rejects on undecodable | `onload`/`onerror` |
| Feeds react-easy-crop | no (it wants a `string` src) | **yes** |
| Frees deterministically | `bmp.close()` | GC |
| 12 MP decode (measured) | 55 ms Cr / 60 ms Fx | 4–5 ms to `onload` (**lazy** — decode happens at draw) |

**Use both, for different jobs.** The `<img>` + object URL for the *preview* (react-easy-crop needs a
URL anyway); `createImageBitmap(file)` inside a **Worker** for the *export*, so the crop+encode never
touches the main thread. The cost of the second decode is one 55–190 ms worker task. Measured
end-to-end in a Worker (decode 12 MP → crop → resize to 1400 → encode):

| | Chromium 149 | Firefox 151 |
|---|---|---|
| worker, jpeg q0.85 | **87.8 ms** | **100 ms** |
| worker, webp q0.85 | 209 ms | 221 ms |
| main thread, same pipeline | 73 ms total, **max frame gap 17 ms** | 71 ms total, **max frame gap 66 ms** |

The Gecko main-thread run dropped ~4 frames at 60 Hz on a *desktop*. `OffscreenCanvas` +
`convertToBlob` is available everywhere we care (Chrome 69 / FF 105, mobile mirrored) and a `File` is
structured-cloneable — the worker is ~30 lines. Recommended.

---

## 4. Q3 — hard limits on Android

### 4.1 Max **decodable** image — the real constraint, and it is per-engine

**Chromium** — `content/child/blink_platform_impl.cc`, verbatim:
```cpp
size_t BlinkPlatformImpl::MaxDecodedImageBytes() {
  const int kMB = 1024 * 1024;
  const int kMaxNumberOfBytesPerPixel = 4;
#if BUILDFLAG(IS_ANDROID)
  if (base::SysInfo::IsLowEndDevice()) {
    // Limit image decoded size to 3M pixels on low end devices.
    // 4 is maximum number of bytes per pixel.
    return 3 * kMB * kMaxNumberOfBytesPerPixel;
  }
  // For other devices, limit decoded image size based on the amount of physical
  // memory. … 1.6GB of reported physical memory on a 2GB device is enough to set the
  // limit at 16M pixels, which is a desirable value since 4K*4K is a relatively
  // common texture size.
  return base::SysInfo::AmountOfTotalPhysicalMemory().InBytes() / 25;
#else
  size_t max_decoded_image_byte_limit = kNoDecodedImageByteLimit;   // desktop: unlimited
```
So on **Chrome Android** the cap is `RAM/25`, i.e. at 4 B/px:

| device RAM | cap (bytes) | cap (megapixels) |
|---|---:|---:|
| low-end (`IsLowEndDevice`) | 12 MB | **3.0 MP** |
| 2 GB | 85.9 MB | 21.5 MP |
| 4 GB | 171.8 MB | 43.0 MP |
| 8 GB | 343.6 MB | 85.9 MP |
| 12 GB | 515.4 MB | 128.8 MP |

**What happens at the cap is format-dependent** [V]:
* **JPEG is silently downscaled.** `jpeg_image_decoder.cc` runs libjpeg IDCT scaling with
  `g_scale_denominator = 8`:
  ```cpp
  unsigned JPEGImageDecoder::DesiredScaleNumerator(wtf_size_t max_decoded_bytes,
                                                   wtf_size_t original_bytes,
                                                   unsigned scale_denominator) {
    if (original_bytes <= max_decoded_bytes) return scale_denominator;
    return floor(sqrt((double)max_decoded_bytes / original_bytes) * scale_denominator);
  }
  ```
  → a 200 MP Samsung shot on a 4 GB phone decodes at ⅜ or ¼ scale. No error, no warning.
* **PNG and WebP get no such treatment.** Grepped both decoders for `max_decoded_bytes`: the PNG
  decoder has **zero** references; the WebP decoder only takes it in its constructor. And
  `ImageDecoder::SetSize` guards only arithmetic overflow (`SizeCalculationMayOverflow`), not the
  byte cap. → a giant PNG is attempted at full size and fails on allocation (or takes the tab with it).

**Gecko has no per-image decode cap at all** [V]. `image.mem.max_legal_imgframe_size_kb` defaults to
**`-1`** (the comment says it is "meant for testing/fuzzing purposes"). What exists is a *cache*
budget — `image.mem.surfacecache.max_size_kb = 2024 * 1024` (≈1.98 GB) ∧
`image.mem.surfacecache.size_factor = 4` (≤¼ of main memory) — which governs retention, not the
attempt. Gecko *does* ship downscale-during-decode by default
(`image.downscale-during-decode.enabled = true`, `image.jpeg.dct-scaling.enabled = true`,
`image.jpeg.dct-scaling.min-factor = 2.5`) but that is driven by the *display* size, not by
`createImageBitmap` (§4.3).

**Decoded-memory arithmetic (4 B/px, the figure that matters):**

| source | pixels | decoded RGBA |
|---|---:|---:|
| 12 MP (4000×3000) | 12.0 M | **48 MB** |
| 48 MP (8000×6000) | 48.0 M | **192 MB** |
| 108 MP (12000×9000) | 108 M | **432 MB** |
| 200 MP (16320×12240) | 200 M | **799 MB** |

### 4.2 Max **canvas** — source constants + measured failure modes

**Chromium** — `third_party/blink/renderer/core/html/canvas/canvas_rendering_context_host.cc`, verbatim:
```cpp
// Firefox limits width/height to 32767 pixels, but slows down dramatically
// before it reaches that limit. We limit by area instead, giving us larger
// maximum dimensions, in exchange for a smaller maximum canvas size.
static constexpr int kMaxCanvasArea = 32768 * 8192;   // = 268,435,456 CSS px
// In Skia, we will also limit width/height to 65535.
static constexpr int kMaxSkiaDim = 65535;
```
No `BUILDFLAG(IS_ANDROID)` branch — **the same constants apply on Chrome Android.** [V]

**Gecko** — `gfx/2d/Factory.cpp` `CheckSurfaceSize(sz, extentLimit, allocLimit)` rejects on
(a) side > `extentLimit`, (b) 16-byte-aligned `stride × height` overflowing `int32_t`, (c)
`stride × height > allocLimit`. `Factory::AllowedSurfaceSize` supplies `sConfig->mMaxTextureSize` and
`mMaxAllocSize`, whose prefs are `gfx.max-texture-size = 65535` and
**`gfx.max-alloc-size = (int32_t)0x7FFFFFFF`** (2,147,483,647 B). At 4 B/px that is
**≈536.87 M pixels** — which is exactly why the crowd-sourced table reports 23,168×23,168 =
536,756,224 for Firefox 122+. [V]

Probed (desktop, headless):

| canvas | Chromium 149 | Firefox 151 |
|---|---|---|
| 8192 × 8192 (67 MP, 268 MB) | OK | OK |
| 32767 × 1 | OK | OK |
| 32768 × 1 | OK | OK |
| 65535 × 1 | OK | OK |
| **65536 × 1** | **draws, reads back `[0,0,0,0]` — NO throw** | **throws `NS_ERROR_FAILURE`** |
| 20000 × 20000 (400 MP, 1.6 GB) | **silently dead (`[0,0,0,0]`)** — over `kMaxCanvasArea` | **OK** — under the 2 GB byte limit |
| 23200 × 23200 (538 MP, 2.15 GB) | silently dead | **throws `NS_ERROR_FAILURE`** |

Published mobile figures, for reference [R — jhildenbiddle/canvas-size `docs/index.md`, BrowserStack,
undated and Android 5–11 vintage; **no Firefox Android row exists**]: Chrome 91+ on Android 8–11 =
65,535 × 65,535 side, 16,384×16,384 area; on Android 5 the *area* drops to 11,180² (124,992,400).
The Android-5 row is the useful one — it says the **effective** limit on a memory-poor device is
below the constant.

### 4.3 Does `resizeWidth`/`resizeHeight` reduce peak memory? **No.**

Support first: caniuse `createimagebitmap` — Chrome **59+** full; Firefox **42** partial (`#4 #5`
= no options object at all), **93** options but no resize, **98+** `y #7` = resize dimensions yes,
**`resizeQuality` no** (bug 1363861). `and_ff 153 = y #7`, `and_chr 151 = y`. [R]

Bugzilla **1363861** — *"createImageBitmap() does not support resize options (resizeQuality remains)"*,
status **NEW**, last touched 2026-08-07. [V]

**Premise correction, though:** mozilla-central at tip *does* read `mResizeQuality` —
`dom/canvas/ImageBitmap.cpp` `ScaleDataSourceSurface`:
```cpp
SamplingFilter filter = SamplingFilter::LINEAR;
switch (aOptions.mResizeQuality) {
  case ResizeQuality::Pixelated:              filter = SamplingFilter::POINT; break;
  case ResizeQuality::Medium:
  case ResizeQuality::High:                   filter = SamplingFilter::GOOD;  break;
  case ResizeQuality::Low: default:           break;
}
```
So the option is honoured, mapped onto three filters — but Mozilla still tracks it as unimplemented,
presumably because `GOOD` is not a true high-quality (Lanczos) resample. Treat it as **"accepted, not
trustworthy"**: do not rely on `resizeQuality:'high'` for a large downscale on Gecko.

**Now the memory question.** Gecko's blob path, `dom/canvas/ImageBitmap.cpp`
`CreateImageBitmapFromBlob`, in order: `imgtool->DecodeImageAsync(mInputStream, aMimeType, …)` — **no
target size is passed** — then, on completion, `CropAndCopyDataSourceSurface` (a full copy; the
comment even says *"force a copy into unprotected memory"*), then `FlipYDataSourceSurface`, then
`ScaleDataSourceSurface`. Peak = full decoded surface **+ crop copy + scaled copy**. `resizeWidth`
makes peak memory **worse**, not better. [V]

Chromium's `<img>`-element path (`image_bitmap.cc`) re-decodes with
`Platform::GetMaxDecodedImageBytes()` and **no `desired_size`**, then crops/scales — so no saving
there either. (`ImageDecoder::Create` *does* take `const SkISize& desired_size`, so a scaled-decode
path exists in principle; I could not locate Chromium's Blob→ImageBitmap implementation to check
whether it uses it — §11.) [V for the `<img>` path; U for the Blob path]

Measured, and consistent with the source reads — resizing is **slower**, never faster:

| source | plain decode | `+ resizeWidth:1000` | `+ crop rect + resize to 600²` |
|---|---|---|---|
| 12 MP, Chromium | 55 ms | **78 ms** | 59 ms |
| 12 MP, Firefox | 60 ms | **95 ms** | 66 ms |
| 12 MP rotated, Chromium | 52 ms | 69 ms | 195 ms |
| 12 MP rotated, Firefox | 72 ms | 103 ms | 82 ms |
| 48 MP, Chromium | 160 ms | **207 ms** | 174 ms |
| 48 MP, Firefox | 190 ms | **297 ms** | 201 ms |

### 4.4 The input guard I recommend

`file.size` alone is a poor proxy (a 3 MB PNG can be 100 MP of flat colour). Two cheap layers:

1. **Byte cap first** — reject `file.size > N` before touching the decoder. A phone JPEG at 12–50 MP is
   3–15 MB; 30 MB is generous.
2. **Header-parse the pixel dimensions before decoding** — `await file.slice(0, 65536).arrayBuffer()`
   and read: PNG `IHDR` (big-endian u32 at offsets 16 and 20), JPEG `SOF0/1/2` marker scan
   (`FFC0`–`FFCF` excluding `C4/C8/CC` → height u16, width u16), WebP `VP8X`/`VP8 `/`VP8L`. ~40 lines,
   zero deps, no decode. Reject `w*h > cap` with a message naming the number. [proposal, not measured]
3. **Then** decode. Wrap `createImageBitmap` in try/catch — an undecodable format (HEIC, TIFF) and an
   over-large allocation both surface as a rejection.

Recommended cap: **40 MP**, i.e. every phone camera through 48 MP-binned, refusing the 108/200 MP
modes. A stricter **24 MP** is also defensible and closer to Chromium's own 2 GB-device figure of
21.5 MP. Numbers for the main seat to choose between; either way the cap belongs in config, not a
literal (`prefer-configurable-no-hardcoding`).

`navigator.deviceMemory` would let us derive Chromium's own `RAM/25` at runtime — but it is
**Chrome-only** (Chrome/Chrome Android 63+; Firefox and Safari `false`) and from Chrome 147 the
Android values are quantised to `1, 2, 4, 8` GiB. Not a portable lever; a fixed cap is better. [V]

---

## 5. Q4 — the picker

### 5.1 What `accept` actually does on Android — from both browsers' source

**Chrome Android** — `ui/android/java/src/org/chromium/ui/base/SelectFileDialog.java` [V]:
* `preferAndroidMediaPicker()` = `Build.VERSION.SDK_INT >= TIRAMISU (33) && sPhotoPickerDelegate != null`
  → on **Android 13+** Chrome routes to the **Android system photo picker**.
* The gate is `isSupportedPhotoPickerTypes(mimeTypes)`: *every* entry must start with `image/`
  (or `video/`). → **`accept="image/png,image/jpeg,image/webp"` still gets the photo picker.**
* Extension-form accept values are mapped through `MimeTypeMap`, falling back to
  `application/octet-stream` for unknown extensions.
* For the external-picker fallback: `ACTION_GET_CONTENT`, `setType("*/*")`, `EXTRA_MIME_TYPES` = the
  accept list **plus a literal `"type/nonexistent"`** (a deliberate hack — the comment says it stops
  "the MediaPicker hijacking the call … which … breaks our cloud media integration"), plus
  `CATEGORY_OPENABLE`.
* **A camera intent is added to the chooser whenever the accept list includes an image type**, with no
  `capture` attribute involved: `if (shouldShowImageTypes() && camera != null) extraIntents.add(camera);`
  (skipped only on `DeviceInfo.isDesktop()`).

**Firefox Android (Fenix)** —
`mobile/android/android-components/…/feature/prompts/file/MimeType.kt` + `FilePicker.kt` [V]:
* `Intent(ACTION_GET_CONTENT)`, `type = "*/*"`, `CATEGORY_OPENABLE`, `EXTRA_MIME_TYPES` = the accept
  list, `EXTRA_ALLOW_MULTIPLE` = the `multiple` attribute, and **`EXTRA_LOCAL_ONLY = true`** — so
  unlike Chrome, Fenix **excludes cloud providers** (Drive/Photos) from the chooser.
* No `ACTION_PICK_IMAGES` anywhere — Fenix does **not** use the Android 13 photo picker.
* A camera `ACTION_IMAGE_CAPTURE` intent is added to the chooser when the CAMERA permission is
  already granted; the capture file is created as a **`.jpg`** temp file.
* On Android 14+ (`UPSIDE_DOWN_CAKE`) the image type requests `READ_MEDIA_VISUAL_USER_SELECTED`.

So: **both browsers offer the camera for an image accept list.** "No camera-capture requirement" does
not mean no camera photo will arrive — and a fresh camera JPEG is precisely the file most likely to
carry `Orientation != 1`.

`accept` is a **hint**, per MDN verbatim: *"The `accept` attribute doesn't validate the types of the
selected files; it provides hints for browsers to guide users towards selecting the correct file
types. It is still possible (in most cases) for users to toggle an option in the file chooser that
makes it possible to override this … you should make sure that the `accept` attribute is backed up by
appropriate server-side validation."* [V]

### 5.2 HEIC — it arrives as HEIC, and neither engine can read it

* **Android does not transcode images.** `developer.android.com/media/platform/transcoding` lists
  exactly three transcodable formats — **HEVC (H.265), HDR10, HDR10+**, all video, all → AVC. Images
  are absent from the page entirely. [V]
* **HEIC/HEIF decode: Chrome ✗, Chrome Android ✗, Firefox ✗, Firefox Android ✗** (Safari ✓).
  caniuse `heif`, all versions through Chrome 154 / and_chr 151 / and_ff 153 = `n`. [R — caniuse
  2026-08]
* iPhone-sourced photos shared to Android, and Samsung's "HEIF" storage option, both produce `.heic`.
  Realistic, not theoretical. [R]

### 5.3 What can arrive, and what to do about it

Because we **always re-encode**, "transcoding" is free — the only question is whether the engine can
*decode* the input.

| arriving type | decodable in Chrome+Firefox (desktop & Android)? | action |
|---|---|---|
| jpeg / png / webp | yes | normal path |
| **avif** | **yes** — Chrome 85+, Firefox 93+, and_chr/and_ff ✓ [R caniuse] | decode → re-encode to webp/jpeg. Free. |
| gif / bmp | yes | decode → re-encode (first frame only) |
| **heic / heif** | **no** | **refuse** with a named message. Do **not** ship a libheif/wasm decoder — `heic2any`-class bundles are ~1–2 MB, dwarfing the entire app's JS. |
| tiff | no | refuse |
| svg | decodable, but vector + an XML/script surface | **refuse explicitly**, ahead of the decode |
| anything else | — | the `createImageBitmap` rejection is the catch-all |

### 5.4 The picker markup I recommend

```tsx
<input ref={inputRef} type="file" hidden
       accept="image/png,image/jpeg,image/webp"
       onChange={onPick} onCancel={onCancel} />
```
* **Explicit types, not `image/*`.** Same photo-picker routing on Chrome (§5.1), and it puts our
  exact allowlist into `EXTRA_MIME_TYPES` on both engines, so HEIC drops out of the default view.
  It is a filter, not a guarantee (§5.1 quote) — validate anyway.
* **No `capture` attribute** (BCD: `input.capture` is Android-only — Chrome Android 25+, Firefox
  Android 79+, desktop `false`). Both engines add the camera to the chooser regardless.
* **`multiple`**: supported everywhere (both map it to `EXTRA_ALLOW_MULTIPLE`). Our flow is one image
  per section with a crop step, so leave it off; batch is R56's call.
* **Reset `input.value = ""` in the change handler.** `change` fires only when the selection changes;
  re-picking the same file fires **`cancel`** instead (BCD `HTMLInputElement.cancel_event`: Chrome
  113, Firefox 91, Safari 16.4 — so it *is* usable as a real signal on our targets). Without the
  reset, "pick the same photo again" is a dead button. [V]
* `input.showPicker()` (Chrome 99 / FF 101 / Safari 16) is available if `.click()` proves awkward
  inside a sheet.

**Desktop drag-and-drop — the minimal standard pattern** (~12 lines):
```tsx
onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy" }}
onDragLeave={…}
onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) accept(f) }}
```
`preventDefault` on `dragover` is what makes the element a drop target at all. `DataTransfer.files`
is universally supported (`DataTransferItem`: Chrome 11 / FF 50 / Safari 5.1). A `paste` handler
reading `e.clipboardData.files` is the same 3 lines and gets "copy image → paste" free. Both are
desktop-only affordances; neither costs anything on the phone.

---

## 6. Q5 — the state machine and the object-URL lifecycle

### 6.1 Object URL revocation — MEASURED, and the engines disagree

Spec, File API, verbatim: *"As long as the mapping exist the Blob can't be garbage collected, so some
care must be taken to revoke the URL as soon as the reference is no longer needed"* and *"Attempts to
dereference url after it has been revoked will result in a network error. **Requests that were
started before the url was revoked should still succeed.**"* Entries are also dropped by the
*unloading document cleanup steps*. [V]

That last sentence does **not** save you, because assigning `img.src` only *queues* the load:

| when we revoke | Chromium 149 | Firefox 151 |
|---|---|---|
| **synchronously, right after `img.src = url`** | **ERROR** | loaded 4000×3000 |
| in a microtask (`Promise.resolve().then`) | loaded | loaded |
| in a macrotask (`setTimeout 0`) | loaded | loaded |
| before assigning `src` | ERROR | ERROR |
| re-assign the **same** URL after revoking | **ERROR** (correct) | **loaded again** (stale) |
| `await img.decode()` then revoke | ok, 4000 | ok, 4000 |

Rules that fall out:
* **Never revoke in the same synchronous task as the `src` assignment.** Chromium fails.
* **Never rely on a revoked URL still working.** Firefox does; Chromium does not.
* The clean deterministic form is `img.src = url; await img.decode(); URL.revokeObjectURL(url)` —
  works in both. Otherwise revoke in the effect cleanup / on `load`+`error`.

### 6.2 The lean state machine

```
idle
 └─ pick (input change / drop / paste)
     └─ guard(file)            size cap → header dims → mime/extension sanity     ✗→ rejected(reason)
         └─ decoding           createImageBitmap(file) just to prove decodability ✗→ rejected(reason)
             └─ choosing       objectUrl created here; render preview
                 ├─ "use as-is"  → exporting(rect = whole oriented image)
                 └─ "crop"       → cropping(crop, zoom) → exporting(rect = croppedAreaPixels)
                     └─ exporting   worker: decode File → drawImage(rect) → cap to role.pixels → encode
                         └─ uploading  (R55's multipart POST)
                             └─ done | error(retry keeps the same File)
```

Design notes, each earning its place:

* **The `File` is the source of truth, not the object URL.** The URL exists only to feed the preview
  `<img>`; the export decodes the `File` again in the worker. One URL per picked file, created on
  entry to `choosing`, revoked in that effect's cleanup. `useEffect(() => { const u =
  URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u) }, [file])` satisfies §6.1
  (cleanup is a later task) and is StrictMode-double-invoke safe.
* **`bmp.close()`** after every `drawImage`, in the worker and out. On a 12 MP source that is 48 MB
  you are handing back immediately instead of at GC's convenience.
* **"Use as-is" is not "skip the pipeline".** It is *crop rect = the whole image* through the same
  export. Otherwise "as-is" is the one path that can upload a 200 MP HEIC-adjacent surprise, keep the
  GPS tag, and blow the role's byte bound.
* **Filename.** Derive the extension from `blob.type` (§3.3), never from the request. `file.name` from
  an Android content URI may be generic (`image.jpg`) or arbitrary — sanitise the stem, and let R55
  own the wire contract.
* **Do not hold unsaved state across the picker round-trip.** The picker is another Android activity;
  an installed PWA can be backgrounded (and on a memory-poor device, killed) while it is open. Keep
  the pick as the *first* step of the flow, not the middle. [U — not device-probed; §11]

---

## 7. What this means for ctrl-b specifically

* **The output budget already exists.** `frontend/src/theme-engine/mediaRegistry.ts`:
  `FULL_ART = { bytes: 1_500_000, pixels: 4_000_000 }`, `BANNER_ART = { 400_000, 2_000_000 }`,
  `LAYER_ART = { 500_000, 1_000_000 }`, `ICON_ART = { 200_000, 262_144 }`. Cap the export at the
  role's `pixels` and the widest output is 2000×2000 — **60× under Chromium's `kMaxCanvasArea`** and
  well inside every published Android figure. Canvas limits are then purely an *input*-side concern,
  which §4.4's guard already covers. It also means `advisories()`'s existing `oversize`/`dimensions`
  badges should never fire for an uploaded file, which is a nice invariant to assert in a test.
* **`components/MediaGallery.tsx` says, in its own header, "there are no file operations here … §5.4
  ruled option (b)"** and gives the reason: *"the app has no application-layer auth (the tailnet IS
  the boundary), so a write endpoint would be reachable by anything on the tailnet."* Adding upload
  **reverses a recorded ruling**. That is above this dossier's pay grade, but it must be reconciled
  in DECISIONS/MEDIA_PLAN before the FE work lands, or the code and the doc will contradict each
  other on day one.
* **Gesture prior art to copy, not re-invent** (if the hand-rolled option wins): `BottomSheet.tsx`
  (`setPointerCapture` + `touch-action:none`, with the click-retargeting gotcha already written down
  at line 50), `useDragReorder.ts` (document-level listeners *without* capture, and the note saying
  why), `GachaBanner.tsx`.
* **No CSP in this repo** (grepped `backend/app`, `frontend/index.html`, `frontend/src`) — so
  react-easy-crop's runtime `<style>` injection is a cascade-order question, not a blocker. Still
  prefer `disableAutomaticStylesInjection` + the CSS import so the theme layer order stays honest.
* **Existing `createObjectURL` sites** — `components/UtilCard.tsx:30`, `lib/audioController.ts:376,523`
  — are the house precedent to match; check their revoke discipline against §6.1 while we are here.

---

## 8. The recommended pipeline, in one block

```ts
// ── main thread ────────────────────────────────────────────────────────────
// 1. pick            <input accept="image/png,image/jpeg,image/webp">  (reset .value)
// 2. guard           size cap → header-parsed w*h cap → refuse heic/heif/tiff/svg by name
// 3. prove decodable const probe = await createImageBitmap(file); probe.close()
// 4. preview         url = URL.createObjectURL(file)   // revoke in effect cleanup
//                    <Cropper image={url} aspect={role.aspect} … onCropComplete={(_, px) => setRect(px)} />
//                    "use as-is" → rect = { x:0, y:0, width: natW, height: natH }
// 5. export          worker.postMessage({ file, rect, cap: role.pixels, type, quality })

// ── worker ─────────────────────────────────────────────────────────────────
const bmp = await createImageBitmap(file);            // EXIF applied, both engines, CSS-proof
const s = Math.min(1, Math.sqrt(cap / (rect.width * rect.height)));
const dw = Math.max(1, Math.round(rect.width  * s));
const dh = Math.max(1, Math.round(rect.height * s));
const oc = new OffscreenCanvas(dw, dh);
const cx = oc.getContext("2d")!;
cx.imageSmoothingEnabled = true;
cx.imageSmoothingQuality = "high";
cx.drawImage(bmp, rect.x, rect.y, rect.width, rect.height, 0, 0, dw, dh);  // NOT the crop-rect form
bmp.close();
// verify the allocation actually happened — Chromium fails silently (§4.2, §10①)
if (cx.getImageData(dw - 1, dh - 1, 1, 1).data[3] === 0 && /* expected opaque */ opaque) throw …;
const blob = await oc.convertToBlob({ type, quality });
postMessage({ blob, type: blob.type });               // trust blob.type, not `type`
```

Two riders:
* If `rect.width / dw > 3`, do the downscale in two `drawImage` steps (½ then the remainder). One
  giant bilinear step aliases, `imageSmoothingQuality:'high'` notwithstanding, and Gecko's
  `resizeQuality` is not a reliable alternative (§4.3). [proposal — quality not eyeballed]
* Keep `type`/`quality`/the pixel caps in the media registry / Settings, not as literals.

---

## 9. Corrections to beliefs a reader might hold

1. **"Firefox can't encode WebP."** False since **Firefox 96** for `toBlob`/`toDataURL` and **105**
   for `OffscreenCanvas.convertToBlob`. Measured working in Firefox 151. *Safari* is the one that
   cannot. [V]
2. **"`imageOrientation: 'none'` lets you ignore EXIF."** No — it is a no-op in both engines and
   deprecation-counted in Chromium. [V]
3. **"`resizeWidth` makes big-photo decoding cheaper."** No — post-decode in both engines, measured
   25–56 % *slower*, and strictly worse for peak memory on Gecko. [V]
4. **"caniuse says Gecko ignores `resizeQuality`."** Stale-ish: mozilla-central at tip maps it onto
   three `SamplingFilter`s. Bugzilla 1363861 is nonetheless still NEW — treat the option as accepted
   but not trustworthy for large downscales. [V]
5. **"`accept` restricts what can arrive."** MDN says otherwise in as many words. [V]
6. **"Android converts HEIC for you."** Only *video* is transcoded (HEVC/HDR10/HDR10+ → AVC). [V]
7. **"`createImageBitmap`'s crop rect is the tidy way to crop."** It silently returns the wrong region
   in Chromium on any EXIF-rotated photo. [V, probed + Chromium's own TODO]
8. **"react-easy-crop has no keyboard support."** It does — a `tabIndex:0` crop area with arrow-key
   panning. What it lacks is ARIA and keyboard *zoom*. (This corrects my own first pass, which read a
   jsdom render where `cropSize` was never measured.) [V]

---

## 10. Bounded open sweep — 3 items, same bar

**① Chromium's canvas failure mode is silent, and a silent failure passes a magic-byte check.**
Probed: a canvas over `kMaxCanvasArea` (20000×20000) or over `kMaxSkiaDim` (65536×1) accepts
`fillRect` and reads back `[0,0,0,0]` **with no exception**, where Gecko throws `NS_ERROR_FAILURE`.
Combined with the fact that `toBlob` on such a canvas still produces a *valid* image file, the failure
mode is "a fully transparent PNG lands in the media directory and validates". Our ≤4 MP cap means we
should never get there — but the export must still *verify* rather than assume: read one pixel back,
or assert `blob.size` against a floor, before handing the blob to the uploader. Cost: 2 lines.

**② `image-orientation` is inherited, applies to all elements, and the two engines read it off
different elements.** CSS Images 3 verbatim: *Applies to: all elements · Inherited: yes*. Chromium's
`drawImage` reads the computed value off the **canvas** ("We always use the image-orientation property
on the canvas element…"); Gecko reads it off the **source `<img>`'s** frame
(`nsLayoutUtils.cpp:7286`). So a single theme or reset rule — `* { image-orientation: none }`, or the
property on any ancestor of either element — would silently rotate exported pixels **in one engine
only**, and the bug would be invisible on desktop Chrome while wrong on the owner's phone. The repo
already runs `stylelint` with custom rules; **add a `declaration-property-value-disallowed-list` entry
forbidding `image-orientation` outright.** Cheapest possible fix for a class of bug that is otherwise
extremely hard to find.

**③ `react-image-crop`'s own export helpers are wrong for a phone.** From `dist/index.js`
(v11.1.2, the `cropToCanvas` body):
```js
let o = e.naturalWidth / e.width, s = e.naturalHeight / e.height, c = window.devicePixelRatio;
t.width = Math.floor(n.width * o * c), t.height = Math.floor(n.height * s * c), a.scale(c, c);
```
The output canvas is the source crop **× devicePixelRatio** in each axis while the draw stays at
natural size — on a DPR-3 phone that is a **9× pixel blow-up** of real resolution (pure upsampling),
and it multiplies the canvas-limit exposure by 9. `cropToImg` then calls `e.toBlob(t)` with **no
type**, i.e. PNG. If the main seat picks react-image-crop, `cropToCanvas`/`cropToImg` must be marked
do-not-use and §8's pipeline used instead. (Not applicable to the ① recommendation, but recorded
because these helpers are new in 11.1.0 — 2026-06-21 — and read like the obvious thing to reach for.)

---

## 11. What I could not determine

1. **Chromium's Blob→ImageBitmap decode path.** `Blob` implements `ImageBitmapSource` (only
   `IsBlob()`/`CheckUsability()` in `blob.h`), and the old `ImageBitmapFactories` files are gone from
   `core/imagebitmap/` in `main`. I verified the `<img>`-element path passes **no** `desired_size`
   (so no scaled decode), but could not read the Blob path to see whether it forwards `resizeWidth`
   into `ImageDecoder::Create(…, desired_size)`. The *measured* timings (resize always slower) suggest
   it does not, but that is inference. GitHub/grep.app code search was rate-limited/blocked.
2. **Real Android numbers.** Everything measured here is headless desktop. Unknown until a device
   round: actual canvas ceilings on Chrome Android and **Firefox Android** (the crowd-sourced table has
   *no* Firefox Android row at all); whether the 200 MP Samsung mode is IDCT-downscaled or refused on
   the owner's phone; wall-times for the worker pipeline; whether a 12 MP webp encode is tolerable.
3. **Whether the owner's phone can even produce HEIC.** Depends on the handset and its camera
   "storage format" setting. One look at the device settles it and decides how loud the HEIC refusal
   message needs to be.
4. **PWA-standalone picker survival.** Whether Chrome Android backgrounds/kills an installed ctrl-b
   while the system photo picker is open, and whether `change` still fires on return. §6.2's "pick
   first" advice is precaution, not measurement.
5. **Perceptual quality of jpeg q0.85 and of a single-step >3× downscale.** All size/time numbers are
   measured; no eyeballing was done, and the test image is synthetic noise + gradients, which is
   *worst-case* for WebP and unrepresentative of the owner's art. The §3.4 policy should be re-checked
   against two or three real files before it is locked.
6. **crbug 40773069's formal status.** The tracker JSON did not parse cleanly. The bug **reproduces in
   Chromium 149** and its `TODO` is still in `main` at tip, so it is open in every sense that matters,
   but I cannot quote a status field.
7. **cropperjs v2 and react-advanced-cropper interaction quality.** Sized, dated and API-read, but not
   mounted or gesture-tested — they were eliminated on structure (Shadow DOM / no source-pixel rect /
   staleness) before it was worth the tokens.

---

## 12. Sources

**Specs / docs.** HTML Standard, `canvas.html` — *"The default is `image/png`; that type is also used
if the given type isn't supported"* · CSS Images 3 §`image-orientation` (drafts.csswg.org) · W3C File
API (w3c.github.io/FileAPI) · MDN: `createImageBitmap`, `image-orientation`, `<input type="file">` ·
`developer.android.com/media/platform/transcoding`.

**Engine source (fetched 2026-08-24).** Chromium `main`:
`third_party/blink/renderer/core/html/canvas/canvas_rendering_context_host.cc` (`kMaxCanvasArea`,
`kMaxSkiaDim`) · `core/imagebitmap/image_bitmap.cc` (`ParseOptions`, the crbug TODO, the `<img>` decode
path) · `core/imagebitmap/image_bitmap_source.cc` (the `none` deprecation counter) ·
`common/features.cc:346` · `modules/canvas/canvas2d/canvas_2d_recorder_context.cc` +
`canvas_rendering_context_2d.cc` (`RespectImageOrientation`) ·
`platform/image-decoders/image_decoder.{h,cc}` · `platform/image-decoders/jpeg/jpeg_image_decoder.cc`
(`DesiredScaleNumerator`) · `content/child/blink_platform_impl.cc` (`MaxDecodedImageBytes`) ·
`ui/android/java/src/org/chromium/ui/base/SelectFileDialog.java`.
mozilla-central `tip`: `dom/canvas/ImageBitmap.cpp` · `gfx/2d/Factory.cpp` ·
`modules/libpref/init/StaticPrefList.yaml` · `layout/base/nsLayoutUtils.cpp` ·
`dom/canvas/CanvasRenderingContext2D.cpp` ·
`mobile/android/android-components/…/feature/prompts/file/{FilePicker,MimeType}.kt`.
Bugzilla **1363861** (NEW) · **1189632** (DUPLICATE) · crbug **40773069**.

**Compat data.** mdn/browser-compat-data `main` (`css/properties/image-orientation.json`,
`api/HTMLCanvasElement.json`, `api/OffscreenCanvas.json`, `api/HTMLInputElement.json`,
`api/Navigator.json`, `html/elements/input.json`) · caniuse `main`
(`createimagebitmap.json`, `avif.json`, `heif.json`) · jhildenbiddle/canvas-size `docs/index.md`
(crowd-sourced, undated, Android 5–11 vintage).

**Package metadata.** npm registry `time`/`peerDependencies`/download-point API and GitHub REST
`/repos` + `/search/issues`, all 2026-08-24.

**Probes.** Playwright 1.61.1 (repo pin) → Chromium 149.0.7827.55, Firefox 151.0, headless on emma;
test images from `sharp 0.35.3`. Bundles: `esbuild 0.28.1`, react externalised, `gzip -9`. React-19
mount: `react-dom@19.2.8` `createRoot` + `StrictMode` in `jsdom@29`. Scratch trees under
`$TMPDIR=/home/emma/.cache/tmp` and deleted after the pass.
