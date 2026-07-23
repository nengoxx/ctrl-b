import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

// A11 / D48 P11 — pointer-driven drag reorder for a short ordered list (the Inference fallback chain),
// LAYERED OVER the retained MoveButtons (Primer/NN-g rule: drag is a layer, arrows stay the keyboard/AT
// path + test hook). Hand-rolled Pointer Events, no library:
//   - pointerdown on a drag HANDLE starts a press; a 6px movement tolerance must be crossed before it
//     becomes a drag (so a tap/scroll on the handle isn't hijacked);
//   - DOCUMENT-level pointermove/pointerup track the gesture (NO setPointerCapture — it misbehaves on
//     touch in Fennec, our lore); the handle carries touch-action:none (in CSS) so a drag doesn't scroll;
//   - the target index is the insertion slot among the OTHER rows' vertical midpoints (matches the
//     existing moveFallback splice-then-insert semantics);
//   - the dragged row lifts with transform/opacity ONLY (§14.11), committed via `onReorder` on release;
//   - Escape cancels (no commit); a debounced aria-live string announces the live position.
// jsdom can't lay out rects, so the reorder MATH is unit-tested via `targetIndex` (pure, exported) plus a
// synthetic pointer sequence with stubbed getBoundingClientRect.
//
// Compiler note: the whole gesture lives in ONE closure (`beginDrag`) with hoisted `function` handlers so
// there are no interdependent `useCallback`s (which the React Compiler flags) and no ref reads/writes
// during render.

const TOLERANCE = 6; // px of movement before a press becomes a drag
const ANNOUNCE_MS = 120; // debounce for the aria-live position announcement

export type DragState = { from: number; to: number; dy: number } | null;

/** The insertion index for the dragged item given the pointer Y and each row's rect. Pure + exported so
 *  the swap logic is unit-testable without a live layout. `rects` maps row index → its bounding rect. */
export function targetIndex(
  clientY: number,
  from: number,
  rects: Map<number, { top: number; height: number }>,
  count: number,
): number {
  let idx = 0;
  for (const [i, r] of [...rects.entries()].sort((a, b) => a[0] - b[0])) {
    if (i === from) continue;
    if (clientY > r.top + r.height / 2) idx++;
    else break;
  }
  return Math.max(0, Math.min(count - 1, idx));
}

export function useDragReorder(count: number, onReorder: (from: number, to: number) => void) {
  const rows = useRef(new Map<number, HTMLElement>());
  const [drag, setDrag] = useState<DragState>(null);
  const [announce, setAnnounce] = useState("");
  // in-flight gesture: `teardown` removes listeners; `cancel` also clears drag state + announces (unmount
  // cleanup + count-change abort use these without reaching into the closure).
  const active = useRef<{ teardown: () => void; cancel: () => void } | null>(null);
  // Keep the latest onReorder so a mid-gesture rerender (new closure) can't commit through a stale callback.
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const setRow = (i: number, el: HTMLElement | null) => {
    if (el) rows.current.set(i, el);
    else rows.current.delete(i);
  };

  const beginDrag = (index: number, startY: number, pointerId: number) => {
    const gesture = { from: index, active: false, to: index };
    let timer: ReturnType<typeof setTimeout> | undefined;

    // hoisted declarations so teardown can name the handlers it removes without a TDZ reference
    function teardown() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", pointercancel);
      document.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
      clearTimeout(timer);
      active.current = null;
    }
    function cancel() {
      teardown();
      setDrag(null);
      setAnnounce("reorder cancelled");
    }
    // Ignore events from a SECOND pointer (multi-touch) once one pointer owns the gesture.
    const mine = (e: PointerEvent) => e.pointerId === pointerId;
    function move(e: PointerEvent) {
      if (!mine(e)) return;
      const dy = e.clientY - startY;
      if (!gesture.active && Math.abs(dy) < TOLERANCE) return;
      gesture.active = true;
      const rects = new Map<number, { top: number; height: number }>();
      for (const [i, el] of rows.current) {
        const r = el.getBoundingClientRect();
        rects.set(i, { top: r.top, height: r.height });
      }
      const to = targetIndex(e.clientY, gesture.from, rects, count);
      if (to !== gesture.to) {
        clearTimeout(timer);
        timer = setTimeout(
          () => setAnnounce(`moved to position ${to + 1} of ${count}`),
          ANNOUNCE_MS,
        );
      }
      gesture.to = to;
      setDrag({ from: gesture.from, to, dy });
      e.preventDefault();
    }
    function up(e: PointerEvent) {
      if (!mine(e)) return;
      teardown();
      setDrag(null);
      if (gesture.active && gesture.to !== gesture.from)
        onReorderRef.current(gesture.from, gesture.to);
    }
    function pointercancel(e: PointerEvent) {
      if (!mine(e)) return;
      cancel();
    }
    function blur() {
      cancel();
    }
    function key(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      cancel();
    }

    active.current = { teardown, cancel };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", pointercancel);
    document.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
  };

  useEffect(() => () => active.current?.teardown(), []);
  // The list length changed mid-drag (a row was added/removed) — the captured indices/rects are now stale,
  // so abort the in-flight gesture rather than commit a bad move. (No-op on the initial mount / when idle.)
  useEffect(() => {
    if (active.current) {
      active.current.teardown();
      setDrag(null);
    }
  }, [count]);

  return {
    drag,
    announce,
    /** props for a row's drag handle button */
    handleProps: (index: number) => ({
      onPointerDown: (e: ReactPointerEvent) => {
        if (e.button !== 0 && e.pointerType === "mouse") return; // primary button / touch / pen only
        if (active.current) return; // a gesture already owns the interaction — ignore a second press
        beginDrag(index, e.clientY, e.pointerId);
      },
    }),
    /** ref + lift style for a row; spread onto the row element */
    rowProps: (index: number) => ({
      ref: (el: HTMLElement | null) => setRow(index, el),
      style:
        drag && drag.from === index
          ? ({
              transform: `translateY(${drag.dy}px)`,
              opacity: 0.85,
              position: "relative",
              zIndex: 2,
            } as const)
          : undefined,
      "data-dragging": drag && drag.from === index ? "" : undefined,
    }),
  };
}
