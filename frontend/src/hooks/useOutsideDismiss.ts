import { useEffect, useRef } from "react";

// LIGHT DISMISS for a non-modal popover — a pointer going down anywhere outside it closes it. ONE copy of
// the effect the app's popovers wear (NavMenu, the composer tools menu); the call deck keeps its own
// (`CallOverlay#useDeckPopover`), because its tap-away must also swallow the tap's click — that surface is
// tap-to-stop. Here the tap is NOT swallowed: it closes the popover AND does its own job (the field takes
// focus, send sends), the NavMenu contract.
//
// CAPTURE phase on `document`, so a surface that stops `pointerdown` propagation can't make it deaf. Touch
// DOWN, not click: a scroll that starts outside closes it too — how Android's own popups behave.
//
// `isInside` and `onDismiss` are read through refs, so callers pass inline lambdas freely and the listener
// is (un)subscribed on `open` alone.
export function useOutsideDismiss(
  open: boolean,
  isInside: (target: Node) => boolean,
  onDismiss: () => void,
): void {
  const inside = useRef(isInside);
  const dismiss = useRef(onDismiss);
  // Refreshed after every render (never during it), so the listener always sees the latest callbacks.
  useEffect(() => {
    inside.current = isInside;
    dismiss.current = onDismiss;
  });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (!inside.current(e.target as Node)) dismiss.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);
}
