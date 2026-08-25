import { useRef, type ImgHTMLAttributes } from "react";

import { useFocalPosition } from "../hooks/useFocalPosition";
import { shiftFocalX, type FocalArt } from "../lib/focalPosition";

// An `<img>` that frames itself (D65 / MEDIA_MANAGER_PLAN §5) — one window, one measured box, one
// `object-position`.
//
// It exists because `useFocalPosition` is per-WINDOW and half the windows are rendered inside a
// `.map()`: gacha's banner slides, its poster slices and its magazine-cover cards are all built by a
// plain function called in a loop, where a hook cannot be called at all. A component is the only shape
// that gives each one its own ref and its own observer — and it keeps the four call sites that COULD
// have called the hook directly on the same two lines as the ones that could not.
//
// DORMANT BY ABSENCE, like every other art primitive here: no framing point ⇒ no inline
// `object-position` ⇒ the surface's own CSS default crop, untouched. That is what makes this rewrite
// paint-identical for every state that exists before an owner sets a point.

export interface FocalImgProps extends ImgHTMLAttributes<HTMLImageElement> {
  /** The item's framing, from the theme's resolver. Absent ⇒ no inline position at all. */
  art?: FocalArt;
  /** A per-window offset applied to the RESOLVED X, as a fraction (gacha's cover hero slides its
   *  subject out from under the cut-in column). See `lib/focalPosition.ts#shiftFocalX`. */
  shiftX?: number;
}

export function FocalImg({ art, shiftX, style, ...props }: FocalImgProps) {
  const ref = useRef<HTMLImageElement>(null);
  const resolved = useFocalPosition(ref, art);
  const position =
    resolved !== undefined && shiftX !== undefined ? shiftFocalX(resolved, shiftX) : resolved;
  return (
    <img
      ref={ref}
      {...props}
      style={position === undefined ? style : { ...style, objectPosition: position }}
    />
  );
}
