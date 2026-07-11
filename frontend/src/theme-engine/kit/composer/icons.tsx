// Shared composer glyphs — ONE source for icons that more than one variant renders (a variant-only concern;
// tabs/tools use lucide-react directly). First occupant: the send ARROWHEAD (lucide `navigation` outline,
// stroke 2.2 — the owner's pick from the 2026-07-11 icon showcase), used by SheetComposer (docked) and
// BorderlessComposer (via KitComposer's internal `sendIcon` seam). Its visual mass leans up-right, so the
// variants apply an optical translate(-1px,1px) nudge in kit.css — the glyph itself stays centered.

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
