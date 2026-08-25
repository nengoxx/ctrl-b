import {
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// THE HOUSE DRAG-REORDER GESTURE (A11/D48 P11, extended for MEDIA_MANAGER_PLAN §7 / R58).
//
// One hook, two SHAPES of reorder surface, and everything below the shape is shared:
//
//  · `activation: "handle"` (the default, and what the provider fallback chains have always used) — a
//    dedicated ⠿ control that exists only to reorder. It carries `touch-action: none` in CSS, so a drag
//    activates on 6px of movement, and the SAME control carries the ArrowUp/ArrowDown keyboard path
//    (the Primer/NN-g rule: an AT reorder path always exists, on one control).
//  · `activation: "press"` — the row's own primary control (a gallery TILE, which opens a detail panel
//    when tapped). It cannot be `touch-action: none` — the grid has to scroll — so touch activates on a
//    500ms LONG PRESS instead (Android's `ViewConfiguration` long-press timeout and iOS's
//    `minimumPressDuration`, which agree), and movement before that press lands is read as the SCROLL it
//    almost always is: the gesture abandons and the page keeps the pointer. A mouse still activates on
//    distance. There is no key binding here — the tile's keyboard meaning is "open me", and the WCAG
//    floor for order lives in the ↑/↓ + move-to-edge buttons of the panel it opens (R56 §3.1).
//
// The gesture is hand-rolled Pointer Events, never dnd-kit (R58 §5: +15.3 KB gz on the chunk the gallery
// ships in, for a v6 line frozen the day React 19.0 shipped). What it implements, and where the field's
// numbers came from:
//
//   · DOCUMENT-level move/up/cancel listeners — dnd-kit's own architecture (`PointerSensor`: pointer
//     events stop firing if the target unmounts mid-drag), plus an explicit `setPointerCapture` on the
//     pressed element for the mouse case. (The file used to blame Fennec for the latter; our own later
//     investigation — GACHA_PLAN's post-close fix — found the failure was capture on an ANCESTOR plus an
//     unguarded bubbling `lostpointercapture`, repro'd identically on Chromium.)
//   · MEASURE ONCE at lift (R58 G6/§3.3, dnd-kit's `MeasuringStrategy.WhileDragging`) — never a
//     `getBoundingClientRect()` loop per `pointermove` — and compensate the container's SCROLL DELTA
//     against those frozen rects (G5) so the row never detaches from the finger.
//   · DISPLACED ROWS open the gap (G1): every row between the source and the target travels to its
//     neighbour's slot, measured from the same frozen rects (dnd-kit's `verticalListSortingStrategy`
//     generalised to reading order, so it holds for a 3-column grid too). The timing is
//     `--dur-slow`/`--ease-std` in kit.css — literally the field's 200ms and
//     `cubic-bezier(0.2, 0, 0, 1)`, and already collapsed to 1ms by the reduced-motion axis, so motion
//     is gated by the house's `UIState`-driven `data-motion` contract rather than by a media query.
//   · AUTO-SCROLL near the scroll container's edges (G4): a band of `min(20% of height, 96px)`, a
//     quadratic ramp to ~600px/s, and 200ms of dead time before the first pixel — @hello-pangea/dnd's
//     dampening idea in its cheap form, so "I paused near the edge" does not fling the list.
//   · THE HELD COMMIT (G3, council Emma #8), which is the one thing the gallery cannot do without: the
//     order is owned by the SERVER and does not change until an awaited refetch lands, so releasing the
//     transform at `pointerup` would snap the row home and jump it one round-trip later. Instead the row
//     SETTLES onto its destination slot and is HELD there until the authoritative order arrives
//     (`orderKey` changes, released in a layout effect so the release paints in the same commit as the
//     new order) or the commit settles — and an ERROR releases in `finally`: back to the pre-drag order,
//     transforms and autoscroll cleared, the consumer's toast left standing.
//
// The state machine is a pure exported reducer (`dragReduce`) with its own arms, and `phaseRef` is the
// synchronous read every handler uses — including the admission latch, which refuses a new press while a
// commit is still in flight.
//
// jsdom can't lay out rects, so the geometry is unit-tested through the pure functions (`targetIndex`,
// `gridTargetIndex`, `displacement`, `scrollVelocity`) plus synthetic pointer sequences with stubbed
// rects; the real gesture is pinned in `e2e/media-gallery.spec.ts`.
//
// Compiler note: the whole gesture lives in ONE closure (`beginDrag`) with hoisted `function` handlers so
// there are no interdependent `useCallback`s (which the React Compiler flags).

const TOLERANCE = 6; // px of movement before a HANDLE press becomes a drag
const PRESS_MS = 500; // long press before a BODY press becomes a drag (Android == iOS default)
const PRESS_SLOP = 10; // px of movement that abandons a long press (iOS `allowableMovement`, 10pt)
const ANNOUNCE_MS = 120; // debounce for the aria-live position announcement
const BAND_FRACTION = 0.2; // autoscroll band, as a fraction of the container's height
const BAND_MAX = 96; // …capped, so a tall desktop container doesn't scroll from the middle
const SCROLL_MAX = 600; // px/s at the very edge of the band
const SCROLL_DEAD_MS = 200; // edge hover before the first scrolled pixel
const CLICK_GUARD_MS = 50; // how long the post-drag click suppression outlives the gesture

/** A row's vertical band — all the 1-D insertion rule needs. */
export interface Band {
  top: number;
  height: number;
}

/** A row's full slot geometry — what a GRID needs, and what displacement is measured from. */
export interface Cell extends Band {
  left: number;
  width: number;
}

/** The insertion index for the dragged item given the pointer Y and each row's rect. Pure + exported so
 *  the swap logic is unit-testable without a live layout. `rects` maps row index → its bounding rect. */
export function targetIndex(
  clientY: number,
  from: number,
  rects: ReadonlyMap<number, Band>,
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

/** The same question for a GRID, in READING ORDER: a tile is behind the pointer when the pointer is
 *  below its whole band, or inside that band and past its horizontal midpoint. Collapses to the 1-D rule
 *  for a single column of full-width tiles, and it is the generalisation the gallery's three columns
 *  need — a Y-midpoint test alone cannot tell tile 3 from tile 5 when both share a row. */
export function gridTargetIndex(
  clientX: number,
  clientY: number,
  from: number,
  rects: ReadonlyMap<number, Cell>,
  count: number,
): number {
  let idx = 0;
  for (const [i, r] of [...rects.entries()].sort((a, b) => a[0] - b[0])) {
    if (i === from) continue;
    const below = clientY >= r.top + r.height;
    const above = clientY < r.top;
    if (below || (!above && clientX > r.left + r.width / 2)) idx++;
    else break;
  }
  return Math.max(0, Math.min(count - 1, idx));
}

/** Where row `index` has to travel while `from` is being dragged to `to` — its NEIGHBOUR's slot, or
 *  `null` when this row is not displaced at all (R58 G1). Measured from the frozen rects rather than
 *  from a height-plus-gap arithmetic, which is what makes one function serve both a list and a grid:
 *  in a uniform layout, slot `k`'s geometry is simply rect `k`'s. */
export function displacement(
  index: number,
  from: number,
  to: number,
  rects: ReadonlyMap<number, Cell>,
): { dx: number; dy: number } | null {
  let slot: number;
  if (from < to) {
    if (index <= from || index > to) return null;
    slot = index - 1;
  } else if (from > to) {
    if (index >= from || index < to) return null;
    slot = index + 1;
  } else return null;
  const here = rects.get(index);
  const there = rects.get(slot);
  if (here === undefined || there === undefined) return null;
  return { dx: there.left - here.left, dy: there.top - here.top };
}

/** The autoscroll speed for a pointer at `y` against a container spanning `top`…`bottom`, in px/s —
 *  signed (negative scrolls up). Zero outside the band; a QUADRATIC ramp inside it, which is
 *  @hello-pangea/dnd's `p²` rather than dnd-kit's linear one, so approaching the edge is gentle and
 *  reaching it is decisive (R58 §3.7). */
export function scrollVelocity(y: number, top: number, bottom: number, band: number): number {
  if (band <= 0) return 0;
  if (y < top + band) {
    const p = Math.min(1, (top + band - y) / band);
    return -SCROLL_MAX * p * p;
  }
  if (y > bottom - band) {
    const p = Math.min(1, (y - (bottom - band)) / band);
    return SCROLL_MAX * p * p;
  }
  return 0;
}

/** THE GESTURE'S STATE, as four states and nothing implied:
 *
 *   · `idle`  — nothing in flight.
 *   · `press` — a pointer is down on a reorder-capable element, but the activation threshold (distance,
 *     or the long press) has not been crossed. This is the state a TAP lives and dies in.
 *   · `drag`  — the row is following the pointer; `to` is the live insertion slot.
 *   · `hold`  — the pointer is up, the write is in flight, and the visual arrangement is HELD as the
 *     owner left it. Only the commit's outcome or the authoritative order leaves this state (Emma #8). */
export type DragPhase =
  | { kind: "idle" }
  | { kind: "press"; from: number }
  | { kind: "drag"; from: number; to: number; rects: ReadonlyMap<number, Cell> }
  | { kind: "hold"; from: number; to: number; rects: ReadonlyMap<number, Cell> };

export type DragSignal =
  | { type: "press"; from: number }
  | { type: "lift"; rects: ReadonlyMap<number, Cell> }
  | { type: "over"; to: number }
  | { type: "drop" }
  | { type: "cancel" }
  | { type: "released" };

export const IDLE: DragPhase = { kind: "idle" };

/** The machine, pure. Two arms carry the whole design:
 *   · `drop` from a drag that never left its own slot goes straight home — there is nothing to commit;
 *   · `cancel` is REFUSED while holding. Escape, a blur or a `pointercancel` may abandon a gesture; none
 *     of them may abandon a write that is already on the wire, because the visual is the only honest
 *     report of what the server is about to say. */
export function dragReduce(phase: DragPhase, signal: DragSignal): DragPhase {
  switch (signal.type) {
    case "press":
      return phase.kind === "idle" ? { kind: "press", from: signal.from } : phase;
    case "lift":
      return phase.kind === "press"
        ? { kind: "drag", from: phase.from, to: phase.from, rects: signal.rects }
        : phase;
    case "over":
      return phase.kind === "drag" && phase.to !== signal.to ? { ...phase, to: signal.to } : phase;
    case "drop":
      if (phase.kind === "press") return IDLE;
      if (phase.kind !== "drag") return phase;
      return phase.to === phase.from ? IDLE : { ...phase, kind: "hold" };
    case "cancel":
      return phase.kind === "hold" ? phase : IDLE;
    case "released":
      return phase.kind === "hold" ? IDLE : phase;
  }
}

export interface DragReorderOptions {
  /** How the insertion slot is decided: one column of bands, or reading order over a grid. */
  axis?: "list" | "grid";
  /** Where the gesture starts — a dedicated handle, or the row's own primary control. */
  activation?: "handle" | "press";
  /** Nothing here is orderable (the capability is off, the list holds one item, the write path is not
   *  ready). The gesture refuses at admission; the consumer hides its affordances (§7). */
  disabled?: boolean;
  /** A signature of the RENDERED order. While a commit is held, the first change of this releases the
   *  held transforms — in the same commit that paints the new order, so there is no double jump. Absent
   *  ⇒ the commit's own settlement is the only release. */
  orderKey?: string;
  /** The last slot a drop from `from` may ASK FOR, when the consumer's storage cannot express every
   *  position. The gallery's can't: the collation's trailing bundled tier is not arrangeable, so a drag
   *  that pointed past it would be committed as something else and slide back a refetch later. The
   *  gesture is clamped while the finger is still down instead, so what the owner sees is what will be
   *  saved. Absent ⇒ every slot is reachable. */
  limit?: (from: number) => number;
}

export function useDragReorder(
  count: number,
  onReorder: (from: number, to: number) => void | Promise<unknown>,
  options: DragReorderOptions = {},
) {
  const { axis = "list", activation = "handle", disabled = false, orderKey, limit } = options;
  const rows = useRef(new Map<number, HTMLElement>());
  const [phase, setPhase] = useState<DragPhase>(IDLE);
  // The SYNCHRONOUS view of the machine. Every DOM handler reads this (a React state read would be one
  // render behind), and so does the admission latch — the S3 pattern: a press arriving while a commit is
  // still in flight is refused here, not by a disabled attribute that repaints too late.
  const phaseRef = useRef<DragPhase>(IDLE);
  const [announce, setAnnounce] = useState("");
  // in-flight gesture: `teardown` removes listeners; `cancel` also clears drag state + announces (unmount
  // cleanup + count-change abort use these without reaching into the closure).
  const active = useRef<{ teardown: () => void; cancel: () => void } | null>(null);
  /** The HELD commit: the node whose transform is frozen, and the order it was computed against. */
  const held = useRef<{ node: HTMLElement | null; key: string | undefined } | null>(null);
  /** Gone. A held commit outlives its surface by design — closing the gallery does not un-send a write —
   *  so its settlement arrives at a hook nobody is rendering, and must not try to paint. */
  const dead = useRef(false);
  // Keep the latest onReorder so a mid-gesture rerender (new closure) can't commit through a stale callback.
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const orderKeyRef = useRef(orderKey);
  orderKeyRef.current = orderKey;
  // Read at MOVE time, not at press time: the list it is a fact about is the one being rendered now.
  const limitRef = useRef(limit);
  limitRef.current = limit;

  const setRow = (i: number, el: HTMLElement | null) => {
    if (el) rows.current.set(i, el);
    else rows.current.delete(i);
  };

  const signal = (s: DragSignal) => {
    if (dead.current) return;
    const next = dragReduce(phaseRef.current, s);
    if (next === phaseRef.current) return;
    phaseRef.current = next;
    // A mere PRESS paints exactly like idle, and most presses are taps — so it stays in the ref and
    // costs no render (G6: the consumers of this hook are unmemoised subtrees). `IDLE` is a shared
    // constant, so going home from a press bails out of React's update on identity.
    if (next.kind !== "press") setPhase(next);
  };

  /** Let a held row go: the node returns to being an ordinary row, and the machine goes home. */
  const release = () => {
    const h = held.current;
    held.current = null;
    if (h?.node != null) restore(h.node);
    signal({ type: "released" });
  };

  const beginDrag = (index: number, e: ReactPointerEvent) => {
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const pressed = e.currentTarget;
    // A long press only makes sense where the finger has no dedicated handle to hold; a mouse activates
    // on distance in both shapes (a 500ms hold with a mouse is not a gesture, it is a stall).
    const longPress = activation === "press" && e.pointerType !== "mouse";
    const g = {
      from: index,
      to: index,
      x: startX,
      y: startY,
      lifted: false,
      node: null as HTMLElement | null,
      rects: new Map<number, Cell>() as ReadonlyMap<number, Cell>,
      scroller: null as HTMLElement | null,
      top0: 0,
      left0: 0,
      raf: 0,
      last: 0,
      edge: 0,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let presser: ReturnType<typeof setTimeout> | undefined;
    let guarding = false;

    // hoisted declarations so teardown can name the handlers it removes without a TDZ reference
    function teardown() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", pointercancel);
      document.removeEventListener("keydown", key);
      document.removeEventListener("selectionchange", deselect);
      document.removeEventListener("contextmenu", swallow);
      document.removeEventListener("touchmove", swallow);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("blur", abort);
      window.removeEventListener("resize", abort);
      window.removeEventListener("dragstart", swallow);
      clearTimeout(timer);
      clearTimeout(presser);
      if (g.raf !== 0) cancelAnimationFrame(g.raf);
      g.raf = 0;
      // The post-drag click suppression has to OUTLIVE the gesture by a tick: the `click` the browser
      // synthesises after a pointerup arrives after every listener here is gone (dnd-kit does the same,
      // for the same reason).
      if (guarding) {
        guarding = false;
        setTimeout(() => document.removeEventListener("click", guardClick, true), CLICK_GUARD_MS);
      }
      active.current = null;
    }
    function abort() {
      const lifted = g.lifted;
      teardown();
      if (g.node !== null) home(g.node);
      signal({ type: "cancel" });
      if (lifted) setAnnounce("reorder cancelled");
    }
    // Ignore events from a SECOND pointer (multi-touch) once one pointer owns the gesture.
    const mine = (ev: PointerEvent) => ev.pointerId === pointerId;
    const swallow = (ev: Event) => ev.preventDefault();
    const deselect = () => window.getSelection()?.removeAllRanges();
    function guardClick(ev: MouseEvent) {
      ev.stopPropagation();
      ev.preventDefault();
      // There is exactly ONE click to swallow — the one the browser synthesises for the pointer that
      // just dragged. Disarming on it rather than only on the timer below means the guard can never
      // outlive its own gesture and eat a real tap.
      guarding = false;
      document.removeEventListener("click", guardClick, true);
    }
    function hide() {
      if (document.visibilityState === "hidden") abort();
    }

    /** Freeze the geometry (G6) and take over the pointer. Everything after this is arithmetic. */
    function lift() {
      clearTimeout(presser);
      g.lifted = true;
      g.node = rows.current.get(g.from) ?? null;
      const rects = new Map<number, Cell>();
      for (const [i, el] of rows.current) {
        const r = el.getBoundingClientRect();
        rects.set(i, { top: r.top, left: r.left, width: r.width, height: r.height });
      }
      g.rects = rects;
      g.scroller = scrollableAncestor(g.node);
      g.top0 = g.scroller?.scrollTop ?? 0;
      g.left0 = g.scroller?.scrollLeft ?? 0;
      // G7 — a press that became a drag must not leave a selection behind it, and must not let one grow
      // under the finger for the rest of the gesture.
      window.getSelection()?.removeAllRanges();
      document.addEventListener("selectionchange", deselect);
      // The `touch-action` snapshot rule (Pointer Events L3 §8.1) says a handler cannot make an element
      // un-pannable once the pointer is down — so on the long-press path the ONLY way to keep the grid
      // from scrolling under the drag is a non-passive `touchmove` that refuses it.
      document.addEventListener("touchmove", swallow, { passive: false });
      document.addEventListener("click", guardClick, true);
      guarding = true;
      try {
        // On the TARGET, never an ancestor (GACHA_PLAN's post-close finding) — and touch already has it
        // implicitly (PE L3 §4.1.3), so this is really the mouse's.
        pressed.setPointerCapture(pointerId);
      } catch {
        // A synthetic pointer, or one already gone: the document listeners are the real mechanism.
      }
      if (g.node !== null) g.node.style.transition = "none";
      signal({ type: "lift", rects });
      setAnnounce(`picked up item ${g.from + 1} of ${count}`);
      if (g.scroller !== null && typeof requestAnimationFrame === "function") {
        g.raf = requestAnimationFrame(tick);
      }
      update();
    }

    /** The dragged node follows the pointer (plus whatever the container scrolled under it, G5), and the
     *  insertion slot is re-derived from the FROZEN rects in that same shifted space. */
    function update() {
      const ds = g.scroller === null ? 0 : g.scroller.scrollTop - g.top0;
      const dl = g.scroller === null ? 0 : g.scroller.scrollLeft - g.left0;
      if (g.node !== null) {
        g.node.style.transform = `translate(${g.x - startX + dl}px, ${g.y - startY + ds}px)`;
      }
      const aimed =
        axis === "grid"
          ? gridTargetIndex(g.x + dl, g.y + ds, g.from, g.rects, count)
          : targetIndex(g.y + ds, g.from, g.rects, count);
      // Clamped HERE rather than at the commit: a gesture that shows a slot it cannot save is a
      // gesture that lies for one round trip.
      const to = limitRef.current === undefined ? aimed : Math.min(aimed, limitRef.current(g.from));
      if (to === g.to) return;
      g.to = to;
      clearTimeout(timer);
      timer = setTimeout(() => setAnnounce(`moved to position ${to + 1} of ${count}`), ANNOUNCE_MS);
      signal({ type: "over", to });
    }

    function tick(ts: number) {
      const el = g.scroller;
      if (el === null) return;
      const dt = g.last === 0 ? 0 : Math.min(ts - g.last, 32);
      g.last = ts;
      const r = el.getBoundingClientRect();
      const v = scrollVelocity(g.y, r.top, r.bottom, Math.min(r.height * BAND_FRACTION, BAND_MAX));
      if (v === 0) g.edge = 0;
      else {
        if (g.edge === 0) g.edge = ts;
        // The dead time is the cheap half of rbd's time dampening: hovering near the edge for a moment
        // on the way somewhere else must not fling the list.
        if (ts - g.edge >= SCROLL_DEAD_MS) {
          const before = el.scrollTop;
          el.scrollTop = before + (v * dt) / 1000;
          if (el.scrollTop !== before) update();
        }
      }
      g.raf = requestAnimationFrame(tick);
    }

    function move(ev: PointerEvent) {
      if (!mine(ev)) return;
      g.x = ev.clientX;
      g.y = ev.clientY;
      if (!g.lifted) {
        const slop = longPress ? PRESS_SLOP : TOLERANCE;
        const far =
          axis === "grid"
            ? Math.hypot(ev.clientX - startX, ev.clientY - startY) >= slop
            : Math.abs(ev.clientY - startY) >= slop;
        if (!far) return;
        // Movement before the hold landed is the SCROLL it almost always is: hand the pointer back
        // rather than fighting the page for it.
        if (longPress) abort();
        else lift();
        return;
      }
      update();
      ev.preventDefault();
    }

    function up(ev: PointerEvent) {
      if (!mine(ev)) return;
      const { from, to, node, rects, lifted } = g;
      teardown();
      // A press that never became a drag is a TAP: leave it to the element's own click handler.
      if (!lifted) {
        signal({ type: "cancel" });
        return;
      }
      if (to === from) {
        signal({ type: "drop" });
        if (node !== null) home(node);
        return;
      }
      // G3 — the SETTLE, then the HOLD. The row travels to its destination slot on the kit's own motion
      // tokens and stays there: the order belongs to the server, and the only honest thing to show while
      // the write is in flight is the arrangement the owner just made.
      if (node !== null) {
        const here = rects.get(from);
        const there = rects.get(to);
        node.style.transition = "transform var(--dur-slow) var(--ease-std)";
        if (here !== undefined && there !== undefined) {
          node.style.transform = `translate(${there.left - here.left}px, ${there.top - here.top}px)`;
        }
      }
      // G10 — announced on COMMIT. The debounce above is cleared by `teardown`, so a fast drag used to
      // announce nothing at all.
      setAnnounce(`moved to position ${to + 1} of ${count}`);
      held.current = { node, key: orderKeyRef.current };
      signal({ type: "drop" });
      const result = onReorderRef.current(from, to);
      if (isThenable(result)) {
        void (async () => {
          try {
            await result;
          } catch {
            // The consumer owns the message (the gallery's write queue toasts its own failures). What is
            // owed HERE is the visual, and it is owed on both outcomes — hence `finally`.
          } finally {
            release();
          }
        })();
      } else release();
    }
    function pointercancel(ev: PointerEvent) {
      if (!mine(ev)) return;
      abort();
    }
    function key(ev: KeyboardEvent) {
      if (ev.key !== "Escape") return;
      abort();
    }

    active.current = { teardown, cancel: abort };
    signal({ type: "press", from: index });
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", pointercancel);
    document.addEventListener("keydown", key);
    // G8 — the cancel/suppress parity dnd-kit ships: a resize invalidates every frozen rect, a hidden tab
    // abandons the gesture, and Android's long-press callout and the browser's own image drag are both
    // refused for the gesture's duration.
    document.addEventListener("contextmenu", swallow);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("blur", abort);
    window.addEventListener("resize", abort);
    window.addEventListener("dragstart", swallow);
    if (longPress) presser = setTimeout(lift, PRESS_MS);
  };

  useEffect(() => {
    // Set on MOUNT as well as cleared on unmount: StrictMode mounts, unmounts and mounts again, and a
    // flag only ever set would leave the second mount permanently inert.
    dead.current = false;
    return () => {
      dead.current = true;
      active.current?.teardown();
    };
  }, []);
  // The list length changed mid-drag (a row was added/removed) — the captured indices/rects are now stale,
  // so abort the in-flight gesture rather than commit a bad move. (No-op on the initial mount / when idle,
  // and a HELD commit is left alone: its write is already on the wire.)
  useEffect(() => {
    active.current?.cancel();
  }, [count]);
  // The authoritative order arrived. Released in a LAYOUT effect so the transforms clear in the same
  // commit that paints the new order — an ordinary effect would paint one frame of the new order still
  // wearing the old drag's displacement.
  useLayoutEffect(() => {
    const h = held.current;
    if (h === null || h.key === undefined || h.key === orderKey) return;
    release();
    // `release` is re-created every render and is deliberately NOT a dependency: the trigger is the
    // order signature, and the guard above is what makes a re-run a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);

  return {
    phase,
    announce,
    /** props for a row's drag handle — or, in `press` activation, for the row's own primary control.
     *  Pointer = drag; ArrowUp/ArrowDown = the keyboard/AT reorder path on a real HANDLE (so the handle
     *  is a full reorder control, not pointer-only). onReorder bounds-checks the target. */
    handleProps: (
      index: number,
    ): {
      onPointerDown: (e: ReactPointerEvent) => void;
      onDragStart: (e: ReactDragEvent) => void;
      onKeyDown?: (e: ReactKeyboardEvent) => void;
      "aria-roledescription"?: string;
    } => ({
      onPointerDown: (e: ReactPointerEvent) => {
        if (disabled) return;
        if (e.button !== 0 && e.pointerType === "mouse") return; // primary button / touch / pen only
        // THE ADMISSION LATCH, synchronous: one gesture at a time, and a commit still in flight refuses
        // a new one outright rather than starting a drag whose rects are about to be replaced.
        if (active.current !== null || phaseRef.current.kind !== "idle") return;
        beginDrag(index, e);
      },
      // A tile holds an <img>, and an image is natively draggable: without this a mouse press starts the
      // browser's own drag-and-drop, which cancels our pointer stream before it can activate.
      onDragStart: (e: ReactDragEvent) => e.preventDefault(),
      ...(activation === "handle"
        ? {
            onKeyDown: (e: ReactKeyboardEvent) => {
              const to = e.key === "ArrowUp" ? index - 1 : e.key === "ArrowDown" ? index + 1 : null;
              if (to === null || to < 0 || to >= count) return;
              e.preventDefault();
              void onReorderRef.current(index, to);
              setAnnounce(`moved to position ${to + 1} of ${count}`);
            },
            "aria-roledescription": "sortable",
          }
        : {}),
    }),
    /** ref + the displacement style for a row; spread onto the row element. The DRAGGED row carries no
     *  style at all — its transform is written straight to the node, so a re-render can neither fight it
     *  nor cost one (G6) — and says what it is in data attributes kit.css keys the lift off. */
    rowProps: (index: number) => {
      const moving = (phase.kind === "drag" || phase.kind === "hold") && phase.from === index;
      const shift =
        phase.kind === "drag" || phase.kind === "hold"
          ? displacement(index, phase.from, phase.to, phase.rects)
          : null;
      return {
        ref: (el: HTMLElement | null) => setRow(index, el),
        style:
          shift === null
            ? undefined
            : ({ transform: `translate(${shift.dx}px, ${shift.dy}px)` } as const),
        "data-dragging": moving ? "" : undefined,
        "data-drag-held": phase.kind === "hold" && phase.from === index ? "" : undefined,
      };
    },
  };
}

/** Send a node HOME — back to where it started, visibly. Used where nothing was committed (an Escape,
 *  a `pointercancel`, a drop that never left its own slot): the row has not moved in the layout, so
 *  animating the transform to zero is the truthful thing to show, and it is the same 200ms the
 *  displaced rows travel on. */
function home(node: HTMLElement): void {
  node.style.transition = "transform var(--dur-slow) var(--ease-std)";
  node.style.transform = "";
}

/** Give a node back to the layout: no transform, and no transition to animate the giving-back with.
 *  This is the RELEASE of a held commit, where the row's real position has changed underneath it — an
 *  animated clear there would slide it away from the slot it just arrived in. */
function restore(node: HTMLElement): void {
  node.style.transition = "none";
  node.style.transform = "";
  node.getBoundingClientRect(); // flush, so re-enabling the transition cannot animate the clear
  node.style.transition = "";
}

/** The nearest ancestor that actually scrolls — the autoscroll's subject. */
function scrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p !== null; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return typeof (v as PromiseLike<unknown> | null | undefined)?.then === "function";
}
