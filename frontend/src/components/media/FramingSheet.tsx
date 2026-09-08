import {
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import Cropper, { type Area, type MediaSize } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";

import { FocalFace } from "../FocalFace";
import { FocalImg } from "../FocalImg";
import { XIcon } from "../icons";
import { useOverlayBackGuard } from "../../hooks/useOverlayBackGuard";
import type { LibraryItem } from "../../hooks/useMediaLibrary";
import {
  centredFocal,
  clampZoom,
  FOCAL_ZOOM_MAX,
  FOCAL_ZOOM_MIN,
  FOCAL_ZOOM_STEP,
  type FocalPoint,
} from "../../lib/focalPosition";
import { modalKeyDown } from "../../lib/focusTrap";
import { focalState, rowFocal, tileUrl, type EditedFocal } from "../../lib/mediaLibrary";
import { framesCircle, type MediaSection } from "../../theme-engine/mediaRegistry";

// THE FRAMING SHEET (D65 / MEDIA_MANAGER_PLAN §5, R57 §9) — where the owner says which part of a
// picture matters, so every window that crops it keeps that part on screen.
//
// **A RETICLE, NOT A DOT** (R57 §2.4, §9①). Every product in the field — Umbraco, Kirby, Statamic,
// Sanity, Craft, Gutenberg, Shopify, Squarespace — asks you to place a 16–40 px dot under your own
// fingertip, and not one of the seven implementations read has any mitigation for the finger sitting
// on top of the thing it is aiming. The idiom that dodges it is the one we already ship for the crop
// step: move the IMAGE under a fixed centre window. The thing being aimed is the whole picture, and
// it is never under the finger.
//
// So this is `react-easy-crop` again, with two settings that turn a cropper into a reticle:
//  · a SMALL explicit `cropSize` (see `RETICLE_FRACTION`) — the default would size the crop area to
//    the whole media on its short axis, which locks one axis of the pan at dead centre forever;
//  · `restrictPosition={false}` plus our own `panLimit` — its rule keeps the whole crop AREA inside the
//    picture, which would fence the focal point out of the picture's own edges (see `panLimit`).
//
// ── THE ZOOM, and the one role that has one (D70 §13-S6b wave 3) ─────────────────────────────────
//
// The comment that stood here said there was NO zoom because `z` was recorded and unbuilt, and that
// offering a pinch whose result is thrown away would be a lie. `z` is built now, and it is offered
// exactly where something reads it: a role that declares a CIRCLE destination (`framesCircle` — the
// avatars library and nothing else today). Backgrounds keep the sheet unchanged, because a full-bleed
// backdrop honours the point and not the zoom, and a control with no consumer is the same lie in the
// other direction.
//
// **THE RETICLE STAYS A RETICLE, at every zoom.** It is tempting to make the circle on the stage BE the
// chat face — a round crop area at the media's short axis, `restrictPosition` on, WYSIWYG. Measured
// against the shared-centre trade the owner ratified, that design loses: the library's fence keeps the
// whole crop AREA inside the picture, so on a 3:4 portrait the square window's crop can only travel in
// Y and the X of the point is pinned at 0.5 forever — and that same point is what the FULL-BLEED
// backdrop reads, where X is the axis that crops. One centre serves both windows only if every point
// stays addressable, which is what the small reticle and our own `panLimit` are for. The exact circle
// the owner asked for is the PREVIEW instead, and it is the one preview in this strip that is not an
// approximation: a circle is always aspect 1, so `FocalFace` paints it through the destination's own
// arithmetic at whatever size it is drawn (`lib/focalPosition.ts#circleFraming`).
//
// What the stage's zoom then means is "magnify by this much", and it means the same thing in both
// places: the picture grows under the reticle by `z`, and the destination circle shows `1/z` of the
// cover crop it would otherwise show. The pan travels with it — `panLimit` and `seedPan` both carry the
// factor, because the library composes `translate(crop) scale(zoom)` and a point at fraction `f` sits
// at `(f − 0.5)·media·z + crop`.
//
// The focal point IS the crop centre, in the library's own percentage output — `onCropAreaChange`
// fires on every pointer move, so the previews below animate under the finger (Sanity's form, R57 §4).
//
// **TAP-TO-PLACE** is the coarse entry three of the four touch-capable products ship (R57 §2.2a): tap
// a spot and the image pans so that spot lands under the reticle, which is exactly `crop -= tapOffset`
// — see `onStageClick`.
//
// **THE PREVIEWS ARE EXAMPLES** and say so (Statamic's `focal_point_previews_are_examples`, R57 §4③).
// Their aspects come from the registry's `MediaPreviewDef` rows, which are declared coarse in the
// type's own doc comment: the real surfaces' CSS is the paint authority. What they are NOT
// approximating is the MATH — each preview runs the destination's own component (`FocalImg` over its
// own measured box for a rectangle, `FocalFace` for a circle), so where the point lands in a preview of
// that shape is exact. The CIRCLE one is exact FULL STOP, aspect included: a circle is always 1:1 and
// its crop does not depend on its diameter, so the "chat face" below is the chat face.

/** The reticle's side, as a fraction of the stage's short axis, with a floor and a ceiling in CSS px.
 *
 *  It is small on purpose — not for reach (`panLimit` handles that) but for AIM: a target the size of
 *  the picture tells you nothing about where its centre is, and the default `cropSize` is exactly that
 *  (the media's own short axis). A 30% square reads as a target, and the floor keeps it a real touch
 *  target on a narrow phone. */
export const RETICLE_FRACTION = 0.3;
export const RETICLE_MIN = 64;
export const RETICLE_MAX = 160;

/** How long the rule-of-thirds grid stays up after a change — Gutenberg's `GRID_OVERLAY_TIMEOUT`,
 *  verbatim (R57 §8①). It is a transient guide, not a permanent overlay: left up it competes with the
 *  picture the owner is trying to look at. */
export const THIRDS_FLASH_MS = 600;

/** A tap that moved more than this many pixels was a DRAG, and the library has already handled it. The
 *  click that follows a drag fires on the same element, so without this every release would re-centre
 *  on wherever the finger stopped — a second, invisible move on top of the one the owner made. */
const TAP_SLOP = 6;

/** How many decimals of a 0..1 fraction are stored. TWO, per R57 §2.3's measurement: one percent of a
 *  cover-scaled image is ~4–8 px on a 390 px window, already finer than the eye, and Craft's and
 *  Shopify's four decimals are storage habit rather than a requirement. */
const FOCAL_DECIMALS = 2;

/** How many decimals of the ZOOM are stored. Two, because the slider's step is 0.05 — the stored value
 *  is exactly what the control can express, and nothing finer can arrive from it. */
const ZOOM_DECIMALS = 2;

interface FramingState {
  /** The library's pan, in container pixels — the offset of the media's centre from the reticle's. */
  crop: { x: number; y: number };
  /** The live focal point, from the crop area's own percentages — or, until the picture has loaded,
   *  the STORED one this sheet opened on. `null` only when there is neither. */
  point: FocalPoint | null;
  /** The live zoom (`>= 1`; 1 = no zoom). Only a circle-framing role can move it. */
  zoom: number;
  /** The rendered + natural media size, once the picture has loaded. */
  media: MediaSize | null;
  /** The point this sheet OPENED on (Emma's S4 review #1), or `null` for an unframed item. */
  seed: FocalPoint | null;
  /** The seed's pan has been derived and handed to the library — from here the reports are the truth.
   *  Always true when there is no seed, so an unframed item behaves exactly as it did. */
  applied: boolean;
}

type FramingAction =
  | { t: "pan"; crop: { x: number; y: number } }
  | { t: "area"; area: Area }
  | { t: "zoom"; zoom: number }
  | { t: "loaded"; media: MediaSize };

/** The sheet's opening state, from whatever framing the item already has.
 *
 *  A `useReducer` LAZY initializer rather than a constant, because the seed is a prop: an item opened
 *  for a look rather than an edit must not have its framing quietly replaced by the centre. */
export function initialFraming(seed: EditedFocal | undefined): FramingState {
  return {
    crop: { x: 0, y: 0 },
    point: seed === undefined ? null : { x: seed.x, y: seed.y },
    zoom: clampZoom(seed?.z),
    media: null,
    seed: seed === undefined ? null : { x: seed.x, y: seed.y },
    applied: seed === undefined,
  };
}

export function framingReducer(state: FramingState, action: FramingAction): FramingState {
  switch (action.t) {
    case "pan":
      return { ...state, crop: action.crop };
    case "area":
      // A report that arrives BEFORE the seed's pan has been handed over describes the picture at
      // `crop {0,0}` — i.e. its CENTRE — and must not overwrite the point the owner already set. That
      // is not a hypothetical ordering: `onMediaLoad` calls `emitCropData()` and only THEN
      // `onMediaLoaded` (react-easy-crop `index.module.mjs:308-316`), so the centre is always reported
      // first. It is the exact path that made an inspect-and-save silently re-centre a framed image.
      if (!state.applied) return state;
      // THE ONE LINE the whole control is (R57 §9①): the focal point is the crop area's centre. Taken
      // from the PERCENTAGE report rather than the pixel one — the pixels are rounded to whole source
      // pixels by the library, and a percentage is what a 0..1 fraction already is.
      return {
        ...state,
        point: {
          x: clamp01((action.area.x + action.area.width / 2) / 100),
          y: clamp01((action.area.y + action.area.height / 2) / 100),
        },
      };
    case "zoom":
      // THE ZOOM ALONE. The library's own gesture handlers report the matching pan FIRST and the zoom
      // second (`setNewZoom` calls `onCropChange` then `onZoomChange`, index.module.mjs:507-520), so
      // re-deriving the pan here would apply the correction twice. The SLIDER, which the library knows
      // nothing about, dispatches the same pair — see `zoomPan`, which is the library's own
      // zoom-about-a-point arithmetic taken at the container's centre.
      return { ...state, zoom: clampZoom(action.zoom) };
    case "loaded": {
      // The picture's size is the last thing the seed needed: until now there was no way to say where
      // 0.42 across it IS. Deriving the pan here is what puts the stored point under the reticle, and
      // the library's own next report closes the loop by handing the same point back.
      if (state.seed === null || state.applied) return { ...state, media: action.media };
      return {
        ...state,
        media: action.media,
        applied: true,
        crop: seedPan(state.seed, action.media, state.zoom),
      };
    }
  }
}

/** How far the picture may be panned: far enough for the reticle's CENTRE to reach any point in it,
 *  edges and corners included — i.e. half the picture, not `(picture − reticle) / 2`.
 *
 *  **This is why the library's own `restrictPosition` is off here** (it is on in the crop step, where it
 *  belongs). Its rule keeps the whole CROP AREA inside the media, which is exactly right when the crop
 *  area is the output — and wrong when it is a reticle: it would fence the focal point into
 *  `[r/2W, 1 − r/2W]`, and with a 30% reticle over a contained portrait that is the middle THREE FIFTHS
 *  of the picture. A subject near an edge would be unaddressable, silently, with no sign of why. Half
 *  the picture is the honest limit: every point is reachable, and the picture can never travel further
 *  than its own middle.
 *
 *  **AND IT GROWS WITH THE ZOOM.** The library paints `translate(crop) scale(zoom)`, so a magnified
 *  picture is `media·zoom` wide on the stage and reaching its far edge takes `media·zoom/2` of pan. A
 *  limit that ignored the factor would fence the reticle into the middle `1/z` of a zoomed picture —
 *  the very unaddressability this function exists to refuse, arriving through the back door. */
export function panLimit(media: MediaSize, zoom = FOCAL_ZOOM_MIN): { x: number; y: number } {
  const z = clampZoom(zoom);
  return { x: (Math.abs(media.width) * z) / 2, y: (Math.abs(media.height) * z) / 2 };
}

/** One pan, clamped — the ONE place that happens, because `crop` is a CONTROLLED prop: react-easy-crop
 *  renders exactly what it is handed, so an unclamped value from either source (a drag it reports, a tap
 *  we compute) would paint the picture off into the background. */
export function clampPan(
  crop: { x: number; y: number },
  media: MediaSize | null,
  zoom = FOCAL_ZOOM_MIN,
): { x: number; y: number } {
  if (media === null) return crop;
  const limit = panLimit(media, zoom);
  return { x: clamp(crop.x, limit.x), y: clamp(crop.y, limit.y) };
}

/** The pan that puts a STORED point under the reticle (Emma's S4 review #1).
 *
 *  `crop` is the offset of the picture's centre from the reticle's, so the point at fraction `f` sits
 *  at `(f − 0.5)·media + crop`; putting it under the reticle means `crop = (0.5 − f)·media`. It runs
 *  through the same `clampPan` a drag does — which cannot bind for a point inside the picture (the
 *  limit IS half the picture), and which keeps a hand-edited `focal` outside 0..1 from panning the
 *  picture off the stage.
 *
 *  It is the whole of "open a framed image and see its framing", and without it the sheet opened at
 *  the centre while the library immediately reported that centre as the live point — so confirming
 *  without touching anything replaced the owner's framing with the middle of the picture. */
export function seedPan(
  point: FocalPoint,
  media: MediaSize,
  zoom = FOCAL_ZOOM_MIN,
): { x: number; y: number } {
  const z = clampZoom(zoom);
  return clampPan(
    { x: media.width * z * (0.5 - point.x), y: media.height * z * (0.5 - point.y) },
    media,
    z,
  );
}

/** The pan that keeps whatever is under the reticle under it while the ZOOM changes — the whole of the
 *  slider's correction, and one multiplication because the reticle sits at the container's centre.
 *
 *  It is the library's own arithmetic, evaluated at that centre: `setNewZoom` computes
 *  `zoomTarget·newZoom − zoomPoint` about the gesture's point, and at the container's centre
 *  `zoomPoint` is `{0, 0}`, which leaves `crop · new/old`. Deriving it rather than borrowing it is what
 *  lets the slider and a pinch land on the same state — and what makes the pair testable without a
 *  laid-out stage.
 *
 *  A zoom that is not a real factor (the control's value read before it has one) moves nothing. */
export function zoomPan(
  crop: { x: number; y: number },
  from: number,
  to: number,
): { x: number; y: number } {
  const ratio = clampZoom(to) / clampZoom(from);
  return Number.isFinite(ratio) ? { x: crop.x * ratio, y: crop.y * ratio } : crop;
}

/** The pan that puts the media point currently under `(dx, dy)` — an offset from the reticle's centre,
 *  in container pixels — under the reticle instead.
 *
 *  Exported for its own test: it is the whole of tap-to-place, and it is one subtraction because the
 *  reticle sits at the container's centre — the point under the finger is `offset` away from it, so
 *  moving the picture by `−offset` brings that point home.
 *
 *  A tap before the picture has LOADED is a no-op rather than an unbounded pan: there is nothing on
 *  screen to have aimed at, and no geometry to clamp against. */
export function tapPan(
  crop: { x: number; y: number },
  offset: { x: number; y: number },
  media: MediaSize | null,
  zoom = FOCAL_ZOOM_MIN,
): { x: number; y: number } {
  if (media === null) return crop;
  // The offset is in container pixels and so is the pan, so the subtraction is zoom-free; only the
  // fence it lands in knows about the magnification.
  return clampPan({ x: crop.x - offset.x, y: crop.y - offset.y }, media, zoom);
}

/** The framing at the stored precision — and the ONE place the rounding happens, so what the previews
 *  showed and what the config holds cannot be two different framings.
 *
 *  **A zoom of 1 is not written.** Absent is the only spelling of "no zoom" (`MediaFocal.z`, and the
 *  server folds a literal 1 away for the same reason), which is what makes framing an item at the
 *  slider's home position write the exact three keys it wrote before the field existed. */
export function roundFocal(point: FocalPoint, zoom: number = FOCAL_ZOOM_MIN): EditedFocal {
  const f = (n: number) => Number(clamp01(n).toFixed(FOCAL_DECIMALS));
  // ROUNDED FIRST, tested second (Emma's wave-3 review): a pinch is continuous, so a live 1.004 is
  // above the floor until the rounding collapses it to exactly 1 — the seam must test the value it
  // WRITES, or the forbidden spelling rides the gap between the two.
  const z = Number(clampZoom(zoom).toFixed(ZOOM_DECIMALS));
  const out: EditedFocal = { x: f(point.x), y: f(point.y) };
  if (z > FOCAL_ZOOM_MIN) out.z = z;
  return out;
}

export function FramingSheet({
  section,
  item,
  onSave,
  onCancel,
}: {
  section: MediaSection;
  item: LibraryItem;
  /** Save the framing — WITH the revision this sheet rendered, so the write can refuse if the bytes
   *  were replaced while the owner was framing them (Emma's S4 review #2). The sheet supplies it
   *  because the sheet is the only thing that can be authoritative about what it showed. */
  onSave: (focal: EditedFocal | null, expectedRev: string) => void;
  onCancel: () => void;
}) {
  // SEEDED from whatever framing the item already carries — `rowFocal` is the shared predicate, so a
  // STALE point seeds nothing and the sheet opens centred with its own "focus was reset" note.
  const [state, dispatch] = useReducer(framingReducer, rowFocal(item.row), initialFraming);
  const [thirds, setThirds] = useState(false);
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  const labelId = useId();
  const zoomId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const tapFrom = useRef<{ x: number; y: number } | null>(null);
  const close = useOverlayBackGuard(true, onCancel);

  const url = tileUrl(item.row, section);
  const stored = focalState(item.row);
  const previews = section.def.previews ?? [];
  // Does anything READ a zoom for this role? Exactly the roles that declare a circle destination — see
  // the header, and `MediaPreviewDef.shape`, which is the one declaration both this and the circle
  // preview below hang off.
  const circle = framesCircle(section.def);
  // The stage's short axis decides the reticle, so it has to be measured — the library takes
  // `cropSize` in pixels and the whole point of this control is that the target is SMALL.
  const reticle =
    stage === null
      ? RETICLE_MIN
      : Math.min(
          RETICLE_MAX,
          Math.max(RETICLE_MIN, RETICLE_FRACTION * Math.min(stage.width, stage.height)),
        );

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const read = () => {
      const rect = el.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) return;
      setStage((prev) =>
        prev !== null && prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    queueMicrotask(() => panel?.querySelector<HTMLElement>("button")?.focus());
  }, []);

  // The thirds FLASH: raised by every change to the point, lowered `THIRDS_FLASH_MS` later. Keyed on
  // the point itself so a burst of pointer moves keeps re-arming one timer rather than stacking them.
  const px = state.point?.x;
  const py = state.point?.y;
  useEffect(() => {
    if (px === undefined) return;
    setThirds(true);
    const at = setTimeout(() => setThirds(false), THIRDS_FLASH_MS);
    return () => clearTimeout(at);
  }, [px, py]);

  /** The natural size the previews map through: the loaded picture's own, else what the index
   *  measured. Both can be absent (a row the server could not size), and that is the recorded
   *  proportional degrade rather than a blocked sheet. */
  const naturalWidth = state.media?.naturalWidth ?? item.row.width ?? null;
  const naturalHeight = state.media?.naturalHeight ?? item.row.height ?? null;
  const live = state.point ?? { x: 0.5, y: 0.5 };
  // ONE art value for the whole strip: the rectangular previews read the point and ignore the zoom
  // (`focalPosition`), the circle one reads both (`circleFraming`). Which window honours what is a
  // property of the two mappings, never of this call site.
  const liveArt = centredFocal(live, naturalWidth, naturalHeight, state.zoom);

  const onStageClick = (e: MouseEvent<HTMLDivElement>) => {
    const from = tapFrom.current;
    tapFrom.current = null;
    const el = stageRef.current;
    if (el === null) return;
    // A drag's own trailing click is not a tap. (A keyboard-activated click reports 0,0 for both and
    // therefore reads as a tap on the centre — which is a no-op pan, not a surprise move.)
    if (from !== null && Math.hypot(e.clientX - from.x, e.clientY - from.y) > TAP_SLOP) return;
    const rect = el.getBoundingClientRect();
    const offset = {
      x: e.clientX - (rect.left + rect.width / 2),
      y: e.clientY - (rect.top + rect.height / 2),
    };
    dispatch({ t: "pan", crop: tapPan(state.crop, offset, state.media, state.zoom) });
  };

  /** The SLIDER's zoom: the same pair the library's own pinch reports, in the same order — the pan that
   *  keeps the aimed point under the reticle, then the new factor. Without the first, zooming would
   *  slide the framing away from whatever the owner had just aimed at (the point sits at
   *  `(f − 0.5)·media·z + crop`, so holding `crop` while `z` moves moves `f`). */
  const onZoom = (next: number) => {
    dispatch({ t: "pan", crop: zoomPan(state.crop, state.zoom, next) });
    dispatch({ t: "zoom", zoom: next });
  };

  return (
    <div
      className="pm-backdrop mgal-frame-pm"
      onKeyDown={(e) => modalKeyDown(e, panelRef.current, close)}
    >
      <div
        className="pm mgal-frame"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
      >
        <div className="pm-head">
          <h3 id={labelId}>Set focus</h3>
          <button className="pm-x" aria-label="Close" onClick={close}>
            <XIcon />
          </button>
        </div>
        {/* The lede names the shape the owner is looking at, because the reticle is round for a circle
            role — and, where there is a zoom, says what the second control does. */}
        <p className="mgal-frame-lede">
          {circle ? (
            <>
              Move the picture so the part that matters sits inside the circle, and zoom to close in
              on it. Every place this image is cropped will keep that part in view.
            </>
          ) : (
            <>
              Move the picture so the part that matters sits inside the square. Every place this
              image is cropped will keep that part in view.
            </>
          )}
        </p>
        {/* The rev-keyed reset, said in the owner's terms (§2.2). The point is not "lost" — the
            PICTURE changed under a name that did not, so a point measured on the old bytes describes
            a spot that is gone. */}
        {stored === "stale" && (
          <p className="mgal-frame-note" role="status">
            Focus was reset — the file changed.
          </p>
        )}
        <div
          className="mgal-frame-stage"
          ref={stageRef}
          onPointerDown={(e) => {
            tapFrom.current = { x: e.clientX, y: e.clientY };
          }}
          onClick={onStageClick}
        >
          {url !== undefined && (
            <Cropper
              image={url}
              // THE FENCE IS HERE, on the rendered value, and that is what makes it right under zoom.
              // `crop` is a CONTROLLED prop, so the library paints exactly what it is handed and every
              // position it reports is computed from this one — an over-far drag cannot accumulate. It
              // has to be the render rather than the reducer because a zoom gesture reports its PAN
              // FIRST and its new factor second (index.module.mjs:507-520): clamping the pan against
              // the zoom still in state would truncate a zoom-in to the fence of the zoom it left.
              crop={clampPan(state.crop, state.media, state.zoom)}
              // THE ZOOM, where a circle destination reads one (the header). A role with none pins the
              // pair at 1 exactly as this sheet always has, so the library offers no pinch at all
              // rather than one whose result would be discarded on save.
              zoom={state.zoom}
              minZoom={FOCAL_ZOOM_MIN}
              maxZoom={circle ? FOCAL_ZOOM_MAX : FOCAL_ZOOM_MIN}
              onZoomChange={circle ? (zoom) => dispatch({ t: "zoom", zoom }) : undefined}
              aspect={1}
              cropSize={{ width: reticle, height: reticle }}
              objectFit="contain"
              // Our own thirds overlay spans the whole picture (Gutenberg's, R57 §8①); the library's
              // would draw on the reticle, where three lines across 90 px teach nothing.
              showGrid={false}
              disableAutomaticStylesInjection
              // ROUND for a circle destination — the aim target wears the shape of the window it is
              // aiming for. It is still a reticle and not the window (see the header): the exact
              // circle is the "chat face" preview below.
              cropShape={circle ? "round" : "rect"}
              classes={{ cropAreaClassName: "mgal-reticle" + (circle ? " round" : "") }}
              cropperProps={{
                role: "group",
                "aria-label": `Drag the picture, or tap a spot, to put it in the ${
                  circle ? "circle" : "square"
                }`,
              }}
              // The library's own fence is OFF (see `panLimit`) — a reticle must reach the edges — so
              // every pan it reports is clamped here instead, by the one rule both sources share.
              restrictPosition={false}
              onCropChange={(crop) => dispatch({ t: "pan", crop })}
              onMediaLoaded={(media) => dispatch({ t: "loaded", media })}
              // EVERY pointer move, not just the release: the previews are the compensator for a
              // fingertip being 11% of the picture wide (R57 §2.3), and previews that only update on
              // release cannot compensate for anything.
              onCropAreaChange={(area) => dispatch({ t: "area", area })}
            />
          )}
          <span className={"mgal-frame-thirds" + (thirds ? " on" : "")} aria-hidden />
        </div>
        {/* THE ZOOM, for a circle role only. A slider for the same reason the crop step has one: the
            library ships pinch and wheel and NO keyboard zoom whatsoever, so without this the control
            is unreachable from a keyboard and awkward on a mouse. */}
        {circle && (
          <label className="mgal-frame-zoom" htmlFor={zoomId}>
            <span>Zoom</span>
            <input
              id={zoomId}
              type="range"
              min={FOCAL_ZOOM_MIN}
              max={FOCAL_ZOOM_MAX}
              step={FOCAL_ZOOM_STEP}
              value={state.zoom}
              onChange={(e) => onZoom(Number(e.target.value))}
            />
          </label>
        )}
        {previews.length > 0 && (
          <div className="mgal-frame-previews">
            <ul>
              {previews.map((p) => (
                <li key={p.label}>
                  {/* A CIRCLE preview is the destination itself, not an approximation of it: the face
                      it paints is `FocalFace` over the same framing, and a circle's crop does not
                      depend on how big the circle is (`circleFraming`). So it is the painted box —
                      there is no inner `<img>` to give it. */}
                  {p.shape === "circle" ? (
                    url === undefined ? (
                      <span
                        className="mgal-frame-win circle"
                        style={{ aspectRatio: `${p.aspect}` }}
                      />
                    ) : (
                      <FocalFace
                        className="mgal-frame-win circle"
                        style={{ aspectRatio: `${p.aspect}` }}
                        src={url}
                        art={liveArt}
                      />
                    )
                  ) : (
                    <span className="mgal-frame-win" style={{ aspectRatio: `${p.aspect}` }}>
                      {url !== undefined && (
                        <FocalImg src={url} alt="" draggable={false} art={liveArt} />
                      )}
                    </span>
                  )}
                  <small>{p.label}</small>
                </li>
              ))}
            </ul>
            {/* Statamic's own caption, and its own honesty (R57 §4③ / council M4): these are shapes
                like the real ones, not the real ones. */}
            <p className="mgal-frame-caption">Previews are examples.</p>
          </div>
        )}
        <div className="mgal-frame-actions">
          <button type="button" className="mgal-act" onClick={close}>
            Cancel
          </button>
          {/* Absent unless there IS one to clear — the house rule for a control with nothing to do. */}
          {stored === "set" && (
            <button
              type="button"
              className="mgal-act"
              onClick={() => onSave(null, item.row.revision)}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className="mgal-act primary"
            disabled={state.point === null}
            onClick={() =>
              state.point !== null && onSave(roundFocal(state.point, state.zoom), item.row.revision)
            }
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

function clamp(n: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, n));
}
