import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

// A dependency-free, reusable draggable bottom sheet (Cosmos C3a). Kit-level + presentational — it owns the
// GESTURE + the open/close transition, NOT any host logic (cosmos passes the content). frontier reuses it.
//
// Web-research (COSMOS_HANDOFF §6b — vaul / emilkowalski / react-spring-bottom-sheet):
//  • Drag = a ref-driven `transform: translateY` set DIRECTLY on the element — never a CSS var (recalcs every
//    descendant → drops frames) and never `height`. We never re-render per pixel.
//  • Pointer Events + `setPointerCapture`; drag on the HANDLE only (sidesteps the scroll-vs-drag gate, so a
//    scrolling body never fights the drag). `touch-action: none` on the handle.
//  • Snap: dismiss if flicked down fast (velocity) OR dragged past ~25% of the sheet height; else snap back
//    open. The snap itself is a CSS transition (iOS `cubic-bezier(.32,.72,0,1)`), cleared while dragging so
//    the drag is 1:1 (see cosmos `.bs-*` CSS).
//  • Non-modal a11y: `role="dialog"` WITHOUT `aria-modal`; no focus trap; Escape closes; focus returns to the
//    trigger on close. No visible ✕ (owner dropped it) — a visually-hidden Close button keeps AT/keyboard
//    parity; dismiss = drag-down / tap-outside / Escape / that button.
//  • Perf (§14.11): transform/opacity only; the skin drops its `backdrop-filter` blur while `data-dragging`
//    (never re-blurs per frame) and under `data-perf=lite`. This component just sets the attributes.

/** Snap decision (pure + testable): dismiss on a fast downward flick OR a drag past the distance threshold.
 *  Upward drags (dragPx ≤ 0) never dismiss. `velocity` is px/ms (downward = positive). */
export function shouldDismiss(dragPx: number, sheetHeight: number, velocity: number): boolean {
  if (dragPx <= 0) return false;
  const DISTANCE_FRAC = 0.25; // dragged past a quarter of the sheet → dismiss
  const VELOCITY_THRESH = 0.5; // px/ms downward flick → dismiss regardless of distance
  return velocity > VELOCITY_THRESH || dragPx > sheetHeight * DISTANCE_FRAC;
}

const EXIT_MS = 420; // keep in sync with the `.bs-sheet` transition duration (CSS) — unmount fallback

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** aria-labelledby target (the content's header id) so AT announces the sheet's title. */
  labelledBy?: string;
  /** Skin hook — cosmos passes its class to apply the glass/dot/rounded look. */
  className?: string;
  /** Accessible name for the visually-hidden close button + the tap-outside catcher. */
  closeLabel?: string;
  /** Render the invisible full-screen tap-to-close catcher (default true). Set false when the host surface
   *  behind the sheet must stay interactive — e.g. cosmos lets you tap another planet to SWAP without the
   *  catcher swallowing the tap; cosmos then routes its own "tap empty sky → close". */
  catchOutside?: boolean;
}

export function BottomSheet({
  open,
  onClose,
  children,
  labelledBy,
  className,
  closeLabel = "Close",
  catchOutside = true,
}: Props) {
  // Stay mounted through the slide-out so the exit transition can play; unmount when it finishes.
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false); // drives data-state open|closed (the translateY target)
  const sheetRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Drag state (refs — never re-render per move).
  const dragging = useRef(false);
  const startY = useRef(0);
  const lastY = useRef(0);
  const lastT = useRef(0);
  const velocity = useRef(0);

  // Open → mount + (next frame) raise. Close → lower, then unmount after the transition.
  useEffect(() => {
    if (open) {
      clearTimeout(exitTimer.current);
      triggerRef.current = (document.activeElement as HTMLElement | null) ?? triggerRef.current;
      setMounted(true);
      // Two rAFs so the element paints at translateY(100%) before flipping to 0 (the enter slide).
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
      return () => cancelAnimationFrame(r);
    }
    if (mounted) {
      setEntered(false); // slide down
      exitTimer.current = setTimeout(() => {
        setMounted(false);
        triggerRef.current?.focus?.(); // return focus to the planet that opened it
        triggerRef.current = null;
      }, EXIT_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => clearTimeout(exitTimer.current), []);

  if (!mounted) return null;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    dragging.current = true;
    startY.current = lastY.current = e.clientY;
    lastT.current = e.timeStamp;
    velocity.current = 0;
    sheet.dataset.dragging = "true"; // CSS kills the transition (1:1 drag) + drops the blur
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const dy = Math.max(0, e.clientY - startY.current); // down only (up = future "expanded" snap)
    const dt = e.timeStamp - lastT.current;
    if (dt > 0) velocity.current = (e.clientY - lastY.current) / dt;
    lastY.current = e.clientY;
    lastT.current = e.timeStamp;
    sheet.style.transform = `translateY(${dy}px)`;
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    const sheet = sheetRef.current;
    if (!sheet) return;
    delete sheet.dataset.dragging; // restore the snap transition
    sheet.style.transform = ""; // hand the transform back to the data-state CSS rule
    const dy = Math.max(0, e.clientY - startY.current);
    if (shouldDismiss(dy, sheet.offsetHeight, velocity.current)) onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className={"bs-root" + (className ? " " + className : "")} onKeyDown={onKeyDown}>
      {/* invisible tap-outside catcher — no dim (the no-scrim decision); closes on tap. Optional: cosmos
          disables it so taps fall through to the orbital stage (tap a planet to swap; tap sky to close). */}
      {catchOutside && <button className="bs-catch" aria-label={closeLabel} onClick={onClose} />}
      <div
        className="bs-sheet"
        ref={sheetRef}
        data-state={entered ? "open" : "closed"}
        role="dialog"
        aria-labelledby={labelledBy}
      >
        <div
          className="bs-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="bs-grip" aria-hidden />
        </div>
        {/* sr-only close for keyboard/AT (no visible ✕) */}
        <button className="bs-close-sr" onClick={onClose}>
          {closeLabel}
        </button>
        <div className="bs-body">{children}</div>
      </div>
    </div>
  );
}
