import { useEffect, useId, useReducer, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";

import { XIcon } from "../icons";
import { useOverlayBackGuard } from "../../hooks/useOverlayBackGuard";
import type { CropJob } from "../../hooks/useMediaUpload";
import type { CropRect } from "../../lib/imageExport";
import { modalKeyDown } from "../../lib/focusTrap";

// THE CROP STEP (D65 / MEDIA_MANAGER_PLAN §4, owner ruling ⑤) — frame the picture, or confirm it as
// it is.
//
// `react-easy-crop@6.2.3` (R54 §2, ADOPTED in RESEARCH.md) because of one fact that no other
// candidate has: it is a FIXED crop window with the image panned and pinched underneath it — the
// Instagram/Android-picker idiom, and the only model in the field where you can crop tightly into a
// 12 MP photo on a 390 px viewport. It also hands the rect back in SOURCE pixels against
// `naturalWidth/naturalHeight`, which is already EXIF-oriented in both engines — the same space
// `createImageBitmap(file)` decodes into, so nothing converts and no orientation bookkeeping sits
// between the crop and the export.
//
// **FREE RATIO** is the owner's ruling, and this is what it means here: the crop window is NOT
// locked to the destination's shape. It opens at the PICTURE's own proportions — so opening and
// confirming is the whole image — and the ratio row offers the ordinary shapes plus, when the
// section declares one, the destination's. "Derive the ratio from the element" was ruled into the
// framing PREVIEWS instead (§5, S4).
//
// Two house adoptions from R54's cost-of-adoption list:
//  · `disableAutomaticStylesInjection` + the CSS import, so the library's stylesheet goes through
//    Vite and the theme layer order stays honest instead of a `<style>` appearing at mount;
//  · a `role="group"` + label on the crop area and a visible ZOOM control — the library is
//    keyboard-focusable and pans with the arrow keys, but it has no ARIA and NO keyboard zoom at all.

/** The picture's own proportions, as the ratio row's first entry — the default, and what makes
 *  "confirm without touching anything" mean "use it as it is". */
export const SOURCE_RATIO = "source";

/** The shapes offered beside it. Deliberately a small, ordinary set: this is a free-ratio crop, not
 *  a layout tool, and every extra entry is a smaller tap target on a phone. */
export const CROP_RATIOS: readonly { id: string; label: string; value: number }[] = [
  { id: "1:1", label: "1:1", value: 1 },
  { id: "4:3", label: "4:3", value: 4 / 3 },
  { id: "3:4", label: "3:4", value: 3 / 4 },
  { id: "16:9", label: "16:9", value: 16 / 9 },
  { id: "9:16", label: "9:16", value: 9 / 16 },
];

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.05;

/** The crop's whole state. Exported with its reducer so the machine is an ordinary unit test — the
 *  gesture layer belongs to the library, but WHEN a crop counts as touched, and what an untouched
 *  confirm produces, are ours and are the part that can be wrong. */
export interface CropState {
  ratio: string;
  crop: { x: number; y: number };
  zoom: number;
  /** The last rect the library reported, in SOURCE pixels. */
  rect: CropRect | null;
  /** The owner has actually adjusted something. See `cropResult`. */
  touched: boolean;
}

export type CropAction =
  /** The library reports a new pan/zoom. Position only — see `touched` below. */
  | { t: "move"; crop: { x: number; y: number } }
  | { t: "zoom"; zoom: number }
  /** The OWNER started a gesture on the crop area (`onInteractionStart`), or moved our own zoom
   *  slider. This — and only this — is what "touched" means. */
  | { t: "interact" }
  | { t: "ratio"; ratio: string }
  | { t: "rect"; rect: CropRect };

export const initialCropState: CropState = {
  ratio: SOURCE_RATIO,
  crop: { x: 0, y: 0 },
  zoom: MIN_ZOOM,
  rect: null,
  touched: false,
};

/** **`touched` is set by the OWNER's own actions, never by anything the library reports** — that
 *  asymmetry is the whole machine, and it is not a nicety: react-easy-crop emits `onCropChange`,
 *  `onZoomChange` AND `onCropComplete` while it MEASURES, before anyone has done anything (caught in
 *  the browser, where a fresh modal already offered "Use this crop"). Reading any of those as an edit
 *  makes "use as is" unreachable — every confirm would submit a rect the owner never chose, one
 *  rounding away from the whole picture, on every upload forever.
 *
 *  What the owner does is `onInteractionStart` (mouse/touch/wheel/keyboard on the crop area), our own
 *  zoom slider, and the shape row. Those are the three, and they are all `interact`/`ratio`. */
export function cropReducer(state: CropState, action: CropAction): CropState {
  switch (action.t) {
    case "move":
      return { ...state, crop: action.crop };
    case "zoom":
      return { ...state, zoom: clampZoom(action.zoom) };
    case "interact":
      return { ...state, touched: true };
    case "ratio":
      // A new shape re-frames the picture, so the pan resets with it — leaving the old offset under a
      // differently-shaped window puts the subject somewhere the owner did not put it.
      return { ...state, ratio: action.ratio, crop: { x: 0, y: 0 }, touched: true };
    case "rect":
      return { ...state, rect: action.rect };
  }
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** What CONFIRM submits.
 *
 *  Untouched ⇒ the WHOLE image, stated exactly rather than taken from the reported rect (§4: "confirm
 *  untouched = use as is"). It is still the same export — the crop rect is simply the whole picture —
 *  because "as is" must not become the one path that skips the re-encode, the pixel cap and the EXIF
 *  strip. That was R54's own warning: "as-is" is otherwise the path that uploads a 200 MP surprise
 *  with the owner's GPS tag in it. */
export function cropResult(state: CropState, natural: { width: number; height: number }): CropRect {
  if (!state.touched || state.rect === null)
    return { x: 0, y: 0, width: natural.width, height: natural.height };
  return state.rect;
}

export function CropModal({
  job,
  /** The destination's own shape, offered as one ratio among the others — never imposed. */
  aspect,
  onConfirm,
  onCancel,
}: {
  job: CropJob;
  aspect?: number;
  onConfirm: (rect: CropRect) => void;
  onCancel: () => void;
}) {
  const [state, dispatch] = useReducer(cropReducer, initialCropState);
  const [url, setUrl] = useState<string | null>(null);
  const labelId = useId();
  const zoomId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useOverlayBackGuard(true, onCancel);

  // The object URL lives and dies with the FILE, in one effect (R54 §6.1): created here, revoked in
  // the cleanup — a later task than the `src` assignment, which is the one ordering Chromium requires
  // (revoking synchronously after `src =` errors there, while Firefox loads happily; and a URL that
  // outlives its consumer pins the whole blob in memory). StrictMode-double-invoke safe.
  useEffect(() => {
    const next = URL.createObjectURL(job.file);
    setUrl(next);
    return () => {
      setUrl(null);
      URL.revokeObjectURL(next);
    };
  }, [job.file]);

  useEffect(() => {
    const panel = panelRef.current;
    queueMicrotask(() => panel?.querySelector<HTMLElement>("button")?.focus());
  }, []);

  const ratios = [
    { id: SOURCE_RATIO, label: "Original", value: job.width / job.height },
    ...CROP_RATIOS,
    ...(aspect === undefined ? [] : [{ id: "destination", label: "Fit here", value: aspect }]),
  ];
  const active = ratios.find((r) => r.id === state.ratio) ?? ratios[0];

  return (
    <div
      className="pm-backdrop mgal-crop-pm"
      // Escape closes THIS modal and must not reach the gallery underneath it. It cannot: the crop
      // modal is a sibling of the gallery in the tree, not a child (`MediaGallery` renders both), so
      // the gallery's own keydown handler never sees these events.
      onKeyDown={(e) => modalKeyDown(e, panelRef.current, close)}
    >
      <div
        className="pm mgal-crop"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
      >
        <div className="pm-head">
          <h3 id={labelId}>Frame the image</h3>
          {/* "Close", not "Cancel" — the house ✕ label, and it keeps the two controls that both
              unwind this modal from sharing one accessible name. */}
          <button className="pm-x" aria-label="Close" onClick={close}>
            <XIcon />
          </button>
        </div>
        <div className="mgal-crop-stage">
          {url !== null && (
            <Cropper
              image={url}
              crop={state.crop}
              zoom={state.zoom}
              aspect={active.value}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              showGrid
              objectFit="contain"
              // The library injects a `<style>` at mount unless told not to — outside Vite and
              // outside the theme layer order (R54 §2.6).
              disableAutomaticStylesInjection
              // It renders a focusable crop area with arrow-key panning and NO ARIA at all; this is
              // the prop it provides for exactly that.
              cropperProps={{
                role: "group",
                "aria-label": "Drag to move the picture, or pinch to zoom",
              }}
              // THE touch signal: a gesture the owner actually made, as opposed to the pan and zoom
              // the library publishes while measuring its own container (see `cropReducer`).
              onInteractionStart={() => dispatch({ t: "interact" })}
              onCropChange={(crop) => dispatch({ t: "move", crop })}
              onZoomChange={(zoom) => dispatch({ t: "zoom", zoom })}
              onCropComplete={(_area: Area, pixels: Area) =>
                dispatch({
                  t: "rect",
                  rect: { x: pixels.x, y: pixels.y, width: pixels.width, height: pixels.height },
                })
              }
            />
          )}
        </div>
        <div className="mgal-crop-controls">
          <div className="mgal-crop-ratios" role="group" aria-label="Crop shape">
            {ratios.map((r) => (
              <button
                key={r.id}
                type="button"
                className={"mgal-ratio" + (r.id === active.id ? " on" : "")}
                aria-pressed={r.id === active.id}
                onClick={() => dispatch({ t: "ratio", ratio: r.id })}
              >
                {r.label}
              </button>
            ))}
          </div>
          <label className="mgal-crop-zoom" htmlFor={zoomId}>
            <span>Zoom</span>
            {/* The library has pinch and wheel zoom and NO keyboard zoom whatsoever (R54 §2.5), so
                without this control the crop is unusable from a keyboard and awkward on a mouse. */}
            <input
              id={zoomId}
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={ZOOM_STEP}
              value={state.zoom}
              onChange={(e) => {
                dispatch({ t: "interact" });
                dispatch({ t: "zoom", zoom: Number(e.target.value) });
              }}
            />
          </label>
        </div>
        <div className="mgal-crop-actions">
          <button type="button" className="mgal-act" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="mgal-act primary"
            onClick={() => onConfirm(cropResult(state, job))}
          >
            {/* The label says which of the two things confirming will do, because they are genuinely
                different and the owner cannot otherwise tell: an untouched confirm stores the whole
                picture, a framed one stores what is inside the window. */}
            {state.touched ? "Use this crop" : "Use as is"}
          </button>
        </div>
      </div>
    </div>
  );
}
