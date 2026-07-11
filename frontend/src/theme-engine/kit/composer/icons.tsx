// Shared composer glyphs — ONE source for icons that more than one variant renders (a variant-only concern;
// tabs/tools use lucide-react directly). Occupants:
//   • the send ARROWHEAD (lucide `navigation` outline, stroke 2.2 — the owner's pick from the 2026-07-11 icon
//     showcase), used by SheetComposer (docked), BorderlessComposer (via KitComposer's internal `sendIcon`
//     seam) and LineComposer (the morph's send glyph). Its visual mass leans up-right, so the variants apply
//     an optical translate(-1px,1px) nudge in kit.css — the glyph itself stays centered.
//   • the vapor stroke MIC glyph — graduated here at its SECOND consumer (SheetComposer's embedded mic +
//     LineComposer's morphing button; Phase E, 2026-07-11). Was inlined in SheetComposer.

/** The outline arrowhead send glyph. Size via width/height (CSS may override per variant). */
export function SendArrowheadIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polygon points="3 11 22 2 13 21 11 13 3 11" />
    </svg>
  );
}

/** The vapor stroke mic glyph (round caps/joins, stroke 2.6). Size via width/height (CSS may override). */
export function MicIcon({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}
