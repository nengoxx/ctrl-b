import { useLayoutEffect, useState, type RefObject } from "react";

import {
  focalLanding,
  focalPosition,
  type FocalArt,
  type FocalBox,
  type FocalPoint,
} from "../lib/focalPosition";

// ONE WINDOW's reading of an item's framing point (D65 / MEDIA_MANAGER_PLAN §5, council H3).
//
// **Why this is per-window and not published once.** Until S4 the focal value was a string an item
// carried and every surface inherited — `--cv-focus` on gacha's cover card, `--po-focus` on a poster
// slice, an inline `object-position` on a capsule card. That works for a PROPORTIONAL value, which is
// a fact about the picture alone. It cannot work for a CENTRED one: `P = clamp01((f·s − 0.5)/(s − 1))`
// is a function of `s`, the amount THIS box crops away, and one library feeds a 3/4 capsule card, a
// 16/9 promo slide, a 104×138 portrait and a full-viewport magazine cover. One published string would
// be right in at most one of them. So the value is computed where it is painted, from that window's
// own measured box.
//
// **What it costs.** Nothing until an owner sets a point: a `proportional` item needs no box, so no
// observer is created for the bundled art the app ships with, and an item with no framing at all
// returns `undefined` — no inline style, the surface's own CSS default, byte-identical paint. A
// centred item costs one `ResizeObserver` per painted window, which is the same primitive the shell
// already runs for `--appbar-h`, `--composer-h` and the swatch grid.
//
// **First paint.** The box is unknown while the ref is still null, and returning a proportional value
// for one frame and a centred one for the next would be a visible jump on the very surfaces this
// exists to fix. `useLayoutEffect` is what closes that: it runs after the DOM is mutated and BEFORE
// the browser paints, and a `setState` inside it is flushed synchronously in the same frame — so the
// first frame the user ever sees already carries the measured value. (It is also the reason this is
// not `useEffect`.) There is no SSR in this app; nothing here touches `window` at module scope, and
// the `ResizeObserver` guard below is what keeps it honest under jsdom.
//
// **The recorded degrade** (§5): a surface that CANNOT measure — one whose art is a background
// published on `body`, with no element to observe — passes `null` for the box and gets the
// proportional mapping instead. That is a weaker promise (the subject is roughly over there rather
// than centred), it is visible, and it is deliberate: gacha's fleet backdrop is the one shipped case,
// and it sits under a near-opaque scrim. See `themes/gacha/GachaRoot.tsx`.

/** The measured `object-position`/`background-position` for `art` in the window `ref` points at, or
 *  `undefined` when the item has no framing point — in which case the caller must set NO inline
 *  position at all and let the surface's own default crop stand.
 *
 *  `ref` is the CALLER's, deliberately: half the windows are `<img>` elements the caller renders and
 *  half are boxes it already holds a ref to for another reason (gacha's oracle block). A hook that
 *  minted the ref would force the second half to thread two. */
export function useFocalPosition(
  ref: RefObject<Element | null>,
  art: FocalArt | undefined,
): string | undefined {
  // Only a CENTRED item has anything to measure for. Read as a primitive so the effect's dependency
  // is a boolean rather than the freshly-built object a resolver returns on every render.
  const box = useFocalBox(ref, art?.mode === "centred");
  return art === undefined ? undefined : focalPosition(art, box);
}

/** WHERE the framing point LANDS in that same window, in its own pixels (D71 §6) — the call ring's
 *  anchor, which is `focalLanding` over the one box this measures. `null` = unanchorable (a
 *  proportional item, no point, or a box that has not been measured yet) and the caller paints its own
 *  fallback anchor.
 *
 *  **Coordinate discipline (D71 delta round F9).** The box is the ELEMENT's own, and the caller draws
 *  the ring inside that same element's coordinate space — so no window/visual-viewport offset enters
 *  the calculation at all, and Android's URL-bar and keyboard transitions (which move the visual
 *  viewport without a useful `window.resize`) cannot desync it. The observer below sees any resize of
 *  the box itself, which is the only thing that can move the landing. */
export function useFocalAnchor(
  ref: RefObject<Element | null>,
  art: FocalArt | undefined,
): FocalPoint | null {
  const box = useFocalBox(ref, art?.mode === "centred");
  return art === undefined ? null : focalLanding(art, box);
}

/** The ONE measurement both readings share: this window's painted box, or `null` while it cannot be
 *  known. Shared rather than copied because every line of it is a rule learned once — a zero box is not
 *  a measurement, a same-value write must not re-render every consumer, and jsdom ships no
 *  `ResizeObserver`. `measured` is the caller's "is there anything to measure for": false costs no
 *  observer at all, which is what keeps the bundled proportional art free. */
function useFocalBox(ref: RefObject<Element | null>, measured: boolean): FocalBox | null {
  const [box, setBox] = useState<FocalBox | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    // `typeof ResizeObserver` is the house guard (`Swatches`, `CosmosFleet`): jsdom ships none, so
    // without it every suite that renders a themed surface throws at layout-effect time. In a browser
    // it is always defined, and the state it bails to — no box — is the proportional degrade above.
    if (!measured || el === null || typeof ResizeObserver === "undefined") {
      setBox(null);
      return;
    }
    const read = () => {
      const rect = el.getBoundingClientRect();
      // A zero box is not a measurement: a display:none ancestor, a not-yet-laid-out slide. Keep the
      // last good value rather than flipping to the proportional degrade and back.
      if (!(rect.width > 0) || !(rect.height > 0)) return;
      // Same-value writes are dropped HERE rather than left to React's bail-out, because the object
      // identity would change on every observer callback and re-render every consumer of it.
      setBox((prev) =>
        prev !== null && prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, measured]);

  return box;
}
