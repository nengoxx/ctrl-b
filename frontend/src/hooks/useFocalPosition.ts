import { useLayoutEffect, useState, type RefObject } from "react";

import { focalPosition, type FocalArt, type FocalBox } from "../lib/focalPosition";

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
  const [box, setBox] = useState<FocalBox | null>(null);
  // Only a CENTRED item has anything to measure for. Read as a primitive so the effect's dependency
  // is a boolean rather than the freshly-built object a resolver returns on every render.
  const measured = art?.mode === "centred";

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

  return art === undefined ? undefined : focalPosition(art, box);
}
