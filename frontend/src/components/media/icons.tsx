// The gallery's action glyphs (D65 / MEDIA_MANAGER_PLAN §6.4) — one small set, for the floating action
// pill on the item detail panel and the In-use corner on a tile.
//
// HAND-INLINED, in the house way. `lucide-react` is NOT a dependency of this app and never has been: the
// composer's `theme-engine/kit/composer/icons.tsx` and `components/NavMenu.tsx` both draw lucide's
// GEOMETRY as inline SVG at the stroke weight their surface wants, and adding a 1 MB icon package to
// draw six arrows would be the dependency the zero-new-deps rule is about. These are lucide's
// `chevrons-up` / `chevron-up` / `chevron-down` / `chevrons-down` / `crop` / `pencil` / `trash-2` /
// `check` / `circle`, at 24×24 with the pill's own weight.
//
// The `<svg>` FRAME they are drawn in is `components/icons.tsx`'s — the house one, shared with the
// shell's own glyphs ("W10"), so the pill and the modal ✕ cannot drift into two stroke languages.
//
// Every glyph is `aria-hidden`: each one sits inside a button that carries the words (`aria-label`, and a
// visible caption where it fits). An icon is never the accessible name of anything here.

import { Glyph } from "../icons";

/** lucide `chevrons-up` — move to top. */
export function ToTopIcon({ size }: { size?: number } = {}) {
  return (
    <Glyph size={size}>
      <path d="m17 11-5-5-5 5" />
      <path d="m17 18-5-5-5 5" />
    </Glyph>
  );
}

/** lucide `chevron-up` — one position up. */
export function UpIcon({ size }: { size?: number } = {}) {
  return (
    <Glyph size={size}>
      <path d="m18 15-6-6-6 6" />
    </Glyph>
  );
}

/** lucide `chevron-down` — one position down. */
export function DownIcon({ size }: { size?: number } = {}) {
  return (
    <Glyph size={size}>
      <path d="m6 9 6 6 6-6" />
    </Glyph>
  );
}

/** lucide `chevrons-down` — move to bottom. */
export function ToBottomIcon({ size }: { size?: number } = {}) {
  return (
    <Glyph size={size}>
      <path d="m7 6 5 5 5-5" />
      <path d="m7 13 5 5 5-5" />
    </Glyph>
  );
}

/** lucide `crop` — set framing (§5's reticle). */
export function FrameIcon({ size }: { size?: number } = {}) {
  return (
    <Glyph size={size}>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </Glyph>
  );
}

/** lucide `pencil` — EDIT the stored picture: open the crop step on the bytes that are already there
 *  and replace them under the same name ("W10").
 *
 *  Deliberately NOT `crop`, which this surface already spends on FRAMING: the two are different verbs
 *  on the same picture (framing chooses what a window keeps; editing changes the stored file), and a
 *  shared glyph would say they are one. */
export function EditIcon({ size }: { size?: number } = {}) {
  return (
    <Glyph size={size}>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </Glyph>
  );
}

/** lucide `trash-2` — delete the file from the server. */
export function DeleteIcon({ size }: { size?: number } = {}) {
  return (
    <Glyph size={size}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </Glyph>
  );
}

/** lucide `pin` — a SEAT's one write: bind this entry into that surface. */
export function PinIcon({ size }: { size?: number } = {}) {
  return (
    <Glyph size={size}>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </Glyph>
  );
}

/** lucide `pin-off` — clear a seat's binding, so its own ladder answers again. */
export function UnpinIcon({ size }: { size?: number } = {}) {
  return (
    <Glyph size={size}>
      <path d="M12 17v5" />
      <path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89" />
      <path d="m2 2 20 20" />
      <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11" />
    </Glyph>
  );
}

/** The In-use corner's two faces: lucide `check` when the entry is in use, `circle` when it is not.
 *  A HOLLOW ring rather than nothing at all, because "off" has to be a visible state — a corner that
 *  disappears when switched off is indistinguishable from a tile that never had the control. */
export function UseIcon({ on, size = 15 }: { on: boolean; size?: number }) {
  return on ? (
    <Glyph size={size}>
      <path d="M20 6 9 17l-5-5" />
    </Glyph>
  ) : (
    <Glyph size={size}>
      <circle cx="12" cy="12" r="8" />
    </Glyph>
  );
}
