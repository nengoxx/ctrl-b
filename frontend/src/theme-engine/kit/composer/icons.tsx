// Shared composer glyphs — ONE source for icons that more than one variant renders (a variant-only concern;
// tabs/tools use lucide-react directly). Occupants:
//   • the send ARROWHEAD (lucide `navigation` outline, stroke 2.2 — the owner's pick from the 2026-07-11 icon
//     showcase), used by SheetComposer (docked), the GLASS composer skin (KitComposer picks it as the default
//     send glyph when the resolved skin is `glass`) and LineComposer (the morph's send glyph). Its visual mass
//     leans up-right, so the callers apply an optical translate(-1px,1px) nudge in kit.css — the glyph centered.
//   • the vapor stroke MIC glyph — graduated here at its SECOND consumer (SheetComposer's embedded mic +
//     LineComposer's morphing button; Phase E, 2026-07-11). Was inlined in SheetComposer.

/** The Stop square (D39): the send button becomes a Stop control while a turn streams — every kit
 *  layout variant renders it through the same `isStreaming ? stop : send` swap (vapor's pattern).
 *  Rounded square, stroke language matching the arrowhead. The rect spans 5→19 — the SAME glyph box
 *  as the default send arrow it swaps with (a closed square reads optically smaller than an open
 *  directional glyph, so it gets the full box, not the old 6→18; owner device round, v1.3.1). */
export function StopSquareIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* 2.4, not the arrowhead's 2.2: a square's long straight runs read thinner than angled
          strokes at equal weight (owner eyeball; the mic sits at 2.6). */}
      <rect x="5" y="5" width="14" height="14" rx="2.5" />
    </svg>
  );
}

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

/** The transcribing spinner (owner ask 2026-07-30): the classic 8-bar radial activity glyph (lucide
 *  `loader` geometry), swapped in for the mic glyph while a recorded clip awaits its transcript
 *  (`useDictation` status `sending`). The rotation lives in CSS off the button's `.sending` class
 *  (kit.css / vapor.css), stepped per-bar so it reads as the dial "rolling around". */
export function SpinnerIcon({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* 2.4 (between the arrowhead's 2.2 and the mic's 2.6): eight short bars at equal weight read
          thinner than the mic's long strokes, so they get a touch more. */}
      {/* Graded opacity tail (owner round 2026-08-21): equal-weight bars under the 45°-step roll land
          every frame on a pixel-identical image — the spin was invisible. The iOS/Material segmented-
          spinner fix: a bright head fading counter-clockwise behind it, so each step visibly advances
          the head clockwise; the static face (reduced motion, line's frozen glyph) still reads as a
          spinner rather than a gapped icon. */}
      <path d="M12 2v4" opacity="1" />
      <path d="m16.2 7.8 2.9-2.9" opacity="0.14" />
      <path d="M18 12h4" opacity="0.22" />
      <path d="m16.2 16.2 2.9 2.9" opacity="0.31" />
      <path d="M12 18v4" opacity="0.42" />
      <path d="m4.9 19.1 2.9-2.9" opacity="0.55" />
      <path d="M2 12h4" opacity="0.7" />
      <path d="m4.9 4.9 2.9 2.9" opacity="0.85" />
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
