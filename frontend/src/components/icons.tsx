import type { ReactNode } from "react";

// The SHELL's own glyphs — the icons that belong to house CHROME rather than to one feature, and the
// one `<svg>` frame every hand-inlined icon in the app is drawn in.
//
// HAND-INLINED, in the house way. `lucide-react` is NOT a dependency of this app and never has been:
// `theme-engine/kit/composer/icons.tsx`, `components/NavMenu.tsx` and `components/media/icons.tsx` all
// draw lucide's GEOMETRY as inline SVG at the stroke weight their surface wants. These are the same,
// and the media set imports its FRAME from here rather than keeping a second copy of it — one recipe,
// so the whole app reads as one stroke language.
//
// Every glyph is `aria-hidden`: each one sits inside a button that carries the words (`aria-label`).
// An icon is never the accessible name of anything.

/** The shared frame — one `<svg>` recipe, on lucide's own 24×24 grid at the weight our surfaces use.
 *  `size` is the only thing a call site chooses: the glyph is sized for the box it sits in (18px in a
 *  44px pill target, 14px in the 30px `.pm-x` disc). */
export function Glyph({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** lucide `x` — the house modal's CLOSE (`.pm-x`, all five `.pm` dialogs).
 *
 *  It replaces the literal `✕` character those buttons used to render, and the reason is the owner's
 *  own observation (2026-08-26): a text glyph is centred by its LINE BOX, not by its ink, so `✕` — whose
 *  ink sits above the baseline with the descender space left empty under it — rides visibly low inside
 *  a 30px circle whatever the flex centring says. A stroked path has no baseline and no side bearings:
 *  the geometry IS the box, so it centres exactly. */
export function XIcon({ size = 14 }: { size?: number } = {}) {
  return (
    <Glyph size={size}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Glyph>
  );
}
