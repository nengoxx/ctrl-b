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

import { FocalImg } from "../FocalImg";
import { useOverlayBackGuard } from "../../hooks/useOverlayBackGuard";
import type { LibraryItem } from "../../hooks/useMediaLibrary";
import { centredFocal, type FocalPoint } from "../../lib/focalPosition";
import { modalKeyDown } from "../../lib/focusTrap";
import { focalState, tileUrl } from "../../lib/mediaLibrary";
import type { MediaSection } from "../../theme-engine/mediaRegistry";

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
//    picture, which would fence the focal point out of the picture's own edges (see `panLimit`);
//  · NO ZOOM (`minZoom = maxZoom = 1`). Zoom is the recorded-but-unbuilt `z` field (§5's "future
//    recorded, not built"): offering a pinch whose result is thrown away on save would be a lie.
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
// approximating is the MATH — each preview is a `FocalImg` over its own measured box, i.e. the same
// code path the real window runs, so where the point lands in a preview of that shape is exact.

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

interface FramingState {
  /** The library's pan, in container pixels — the offset of the media's centre from the reticle's. */
  crop: { x: number; y: number };
  /** The live focal point, from the crop area's own percentages. `null` until the first report. */
  point: FocalPoint | null;
  /** The rendered + natural media size, once the picture has loaded. */
  media: MediaSize | null;
}

type FramingAction =
  | { t: "pan"; crop: { x: number; y: number } }
  | { t: "area"; area: Area }
  | { t: "loaded"; media: MediaSize };

export const initialFramingState: FramingState = { crop: { x: 0, y: 0 }, point: null, media: null };

export function framingReducer(state: FramingState, action: FramingAction): FramingState {
  switch (action.t) {
    case "pan":
      return { ...state, crop: action.crop };
    case "area":
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
    case "loaded":
      return { ...state, media: action.media };
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
 *  than its own middle. */
export function panLimit(media: MediaSize): { x: number; y: number } {
  return { x: Math.abs(media.width) / 2, y: Math.abs(media.height) / 2 };
}

/** One pan, clamped — the ONE place that happens, because `crop` is a CONTROLLED prop: react-easy-crop
 *  renders exactly what it is handed, so an unclamped value from either source (a drag it reports, a tap
 *  we compute) would paint the picture off into the background. */
export function clampPan(
  crop: { x: number; y: number },
  media: MediaSize | null,
): { x: number; y: number } {
  if (media === null) return crop;
  const limit = panLimit(media);
  return { x: clamp(crop.x, limit.x), y: clamp(crop.y, limit.y) };
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
): { x: number; y: number } {
  if (media === null) return crop;
  return clampPan({ x: crop.x - offset.x, y: crop.y - offset.y }, media);
}

/** `{x, y}` at the stored precision — and the ONE place the rounding happens, so what the previews
 *  showed and what the config holds cannot be two different points. */
export function roundFocal(point: FocalPoint): FocalPoint {
  const f = (n: number) => Number(clamp01(n).toFixed(FOCAL_DECIMALS));
  return { x: f(point.x), y: f(point.y) };
}

export function FramingSheet({
  section,
  item,
  onSave,
  onCancel,
}: {
  section: MediaSection;
  item: LibraryItem;
  onSave: (point: FocalPoint | null) => void;
  onCancel: () => void;
}) {
  const [state, dispatch] = useReducer(framingReducer, initialFramingState);
  const [thirds, setThirds] = useState(false);
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  const labelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const tapFrom = useRef<{ x: number; y: number } | null>(null);
  const close = useOverlayBackGuard(true, onCancel);

  const url = tileUrl(item.row, section);
  const stored = focalState(item.row);
  const previews = section.def.previews ?? [];
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
    dispatch({ t: "pan", crop: tapPan(state.crop, offset, state.media) });
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
          <h3 id={labelId}>Set framing</h3>
          <button className="pm-x" aria-label="Close" onClick={close}>
            ✕
          </button>
        </div>
        <p className="mgal-frame-lede">
          Move the picture so the part that matters sits inside the square. Every place this image
          is cropped will keep that part in view.
        </p>
        {/* The rev-keyed reset, said in the owner's terms (§2.2). The point is not "lost" — the
            PICTURE changed under a name that did not, so a point measured on the old bytes describes
            a spot that is gone. */}
        {stored === "stale" && (
          <p className="mgal-frame-note" role="status">
            Framing was reset — the file changed.
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
              crop={state.crop}
              // NO ZOOM: `z` is recorded and unbuilt (§5), and a pinch whose result is discarded on
              // save would be worse than no pinch at all.
              zoom={1}
              minZoom={1}
              maxZoom={1}
              aspect={1}
              cropSize={{ width: reticle, height: reticle }}
              objectFit="contain"
              // Our own thirds overlay spans the whole picture (Gutenberg's, R57 §8①); the library's
              // would draw on the reticle, where three lines across 90 px teach nothing.
              showGrid={false}
              disableAutomaticStylesInjection
              classes={{ cropAreaClassName: "mgal-reticle" }}
              cropperProps={{
                role: "group",
                "aria-label": "Drag the picture, or tap a spot, to put it in the square",
              }}
              // The library's own fence is OFF (see `panLimit`) — a reticle must reach the edges — so
              // every pan it reports is clamped here instead, by the one rule both sources share.
              restrictPosition={false}
              onCropChange={(crop) => dispatch({ t: "pan", crop: clampPan(crop, state.media) })}
              onMediaLoaded={(media) => dispatch({ t: "loaded", media })}
              // EVERY pointer move, not just the release: the previews are the compensator for a
              // fingertip being 11% of the picture wide (R57 §2.3), and previews that only update on
              // release cannot compensate for anything.
              onCropAreaChange={(area) => dispatch({ t: "area", area })}
            />
          )}
          <span className={"mgal-frame-thirds" + (thirds ? " on" : "")} aria-hidden />
        </div>
        {previews.length > 0 && (
          <div className="mgal-frame-previews">
            <ul>
              {previews.map((p) => (
                <li key={p.label}>
                  <span className="mgal-frame-win" style={{ aspectRatio: `${p.aspect}` }}>
                    {url !== undefined && (
                      <FocalImg
                        src={url}
                        alt=""
                        draggable={false}
                        art={centredFocal(live, naturalWidth, naturalHeight)}
                      />
                    )}
                  </span>
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
            <button type="button" className="mgal-act" onClick={() => onSave(null)}>
              Clear framing
            </button>
          )}
          <button
            type="button"
            className="mgal-act primary"
            disabled={state.point === null}
            onClick={() => state.point !== null && onSave(roundFocal(state.point))}
          >
            Save framing
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
