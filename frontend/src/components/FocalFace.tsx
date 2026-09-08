import type { CSSProperties } from "react";

import { circleFraming, type FocalArt } from "../lib/focalPosition";

// A CIRCLE window that frames itself, at ZERO measurement cost (D70 §13-S6b wave 3) — the transcript's
// who-line face and the composer picker's row face, which are the same window at two sizes.
//
// **Why it is not `FocalImg`.** That component measures its box with a `ResizeObserver`, because
// `P(f, s)` needs to know how far the source overflows THIS window and a 3/4 card, a 16/9 slide and a
// full-viewport cover are three different answers. A circle is not: it is always aspect 1, and the
// overflow of a square window turns out to be a fact about the picture alone (`lib/focalPosition.ts#
// circleFraming` has the two-line derivation). So the whole reading is a pure function of the item, and
// the per-BUBBLE observer that the 18 px face's old comment refused to pay for does not exist to pay.
// That is the invariant here, and it is the reason this file exists rather than a `measure={false}`
// flag on the other one: a component with no ref and no effect cannot grow one by accident.
//
// **Why a `<span>` with a background rather than an `<img>`.** The zoom draws the picture LARGER than
// the window, and an `<img>` overflowing its own box needs an ancestor to clip it — a wrapper element,
// per bubble, on the most-repeated node in the app. A background is clipped by the box that declares
// it, so one element carries the circle, the border and the picture. Both faces are already
// `alt=""` decoration (the speaker is the label right beside them), so nothing is lost from the
// accessibility tree, and a file the server can no longer serve degrades to the surface colour rather
// than to a broken-image glyph at 28 px.
//
// DORMANT BY ABSENCE, like every art primitive here: an item with no framing point sets no inline
// position at all and the window's own CSS (`background-size: cover`, centred) paints exactly what it
// painted before this existed.

/** The URL as a CSS `url()` token. Quoted and escaped rather than interpolated raw: a filename is the
 *  owner's — an SSH drop can be called anything a filesystem accepts — and a `"` inside one would
 *  otherwise end the string mid-value. (React assigns this through the CSSOM, which rejects an invalid
 *  declaration whole, so the failure mode was a picture that silently did not paint rather than an
 *  injection; escaping makes it paint.) */
function cssUrl(src: string): string {
  return `url("${src.replace(/["\\]/g, "\\$&")}")`;
}

export function FocalFace({
  src,
  art,
  className,
  style,
}: {
  src: string;
  /** The item's framing, from the one resolver (`hooks/useAgentArt`). Absent ⇒ centred cover. */
  art?: FocalArt;
  className?: string;
  style?: CSSProperties;
}) {
  const framing = circleFraming(art);
  return (
    <span
      className={className}
      style={{
        ...style,
        backgroundImage: cssUrl(src),
        ...(framing === undefined
          ? {}
          : { backgroundPosition: framing.position, backgroundSize: framing.size }),
      }}
    />
  );
}
