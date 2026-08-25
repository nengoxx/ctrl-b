import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type Cell,
  displacement,
  dragReduce,
  gridTargetIndex,
  IDLE,
  scrollVelocity,
  targetIndex,
  useDragReorder,
} from "../../src/components/useDragReorder";

// A11/D48 P11 — the fallback drag-reorder. jsdom has no layout, so the target MATH is tested purely via
// `targetIndex`, and the handler wiring (tolerance, commit, Escape) via a synthetic pointer sequence with
// stubbed row rects.
//
// S5 (MEDIA_MANAGER_PLAN §7 / R58) extended the hook for the media grid, and the same rule applies to
// everything it added: the geometry is PURE functions with their own arms (`gridTargetIndex`,
// `displacement`, `scrollVelocity`), the state machine is a pure reducer with its own (`dragReduce`), and
// only the wiring — the long press, the scroll-intent abandon, the held commit's two releases and the
// admission latch — needs a synthetic gesture.

afterEach(cleanup);

const rects = (n: number, h = 40) => {
  const m = new Map<number, { top: number; height: number }>();
  for (let i = 0; i < n; i++) m.set(i, { top: i * h, height: h });
  return m;
};

describe("targetIndex (insertion slot from pointer Y)", () => {
  it("keeps the item in place when the pointer stays in its own band", () => {
    // dragging row 0; pointer near the top → slot 0
    expect(targetIndex(10, 0, rects(3), 3)).toBe(0);
  });
  it("moves down past a sibling's midpoint", () => {
    expect(targetIndex(70, 0, rects(3), 3)).toBe(1); // past row1 mid (60), not row2 mid (100)
    expect(targetIndex(110, 0, rects(3), 3)).toBe(2); // past both → the end
  });
  it("moves up past a sibling's midpoint (dragging the last row)", () => {
    expect(targetIndex(10, 2, rects(3), 3)).toBe(0); // above row0 mid (20)
    expect(targetIndex(30, 2, rects(3), 3)).toBe(1); // between the two upper mids
  });
  it("clamps to the list bounds", () => {
    expect(targetIndex(9999, 0, rects(3), 3)).toBe(2);
    expect(targetIndex(-9999, 2, rects(3), 3)).toBe(0);
  });
});

function Harness({ onReorder }: { onReorder: (from: number, to: number) => void }) {
  const d = useDragReorder(3, onReorder);
  return (
    <div>
      {[0, 1, 2].map((i) => (
        <div key={i} data-row={i} {...d.rowProps(i)}>
          <button type="button" data-handle={i} {...d.handleProps(i)}>
            ⠿
          </button>
        </div>
      ))}
      <span data-live>{d.announce}</span>
    </div>
  );
}

function stubRects(container: HTMLElement) {
  [0, 1, 2].forEach((i) => {
    const el = container.querySelector<HTMLElement>(`[data-row="${i}"]`)!;
    el.getBoundingClientRect = () =>
      ({
        top: i * 40,
        height: 40,
        bottom: i * 40 + 40,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: 0,
      }) as DOMRect;
  });
}

describe("useDragReorder (synthetic pointer sequence)", () => {
  it("commits a reorder on release once the drag tolerance is crossed", () => {
    const onReorder = vi.fn();
    const { container } = render(<Harness onReorder={onReorder} />);
    stubRects(container);
    fireEvent.pointerDown(container.querySelector('[data-handle="0"]')!, {
      clientY: 10,
      button: 0,
    });
    fireEvent.pointerMove(document, { clientY: 110 }); // well past the 6px tolerance, into row2's band
    fireEvent.pointerUp(document);
    expect(onReorder).toHaveBeenCalledWith(0, 2);
  });

  it("does NOT commit when movement stays under the 6px tolerance (a tap)", () => {
    const onReorder = vi.fn();
    const { container } = render(<Harness onReorder={onReorder} />);
    stubRects(container);
    fireEvent.pointerDown(container.querySelector('[data-handle="1"]')!, {
      clientY: 40,
      button: 0,
    });
    fireEvent.pointerMove(document, { clientY: 43 }); // 3px — below tolerance
    fireEvent.pointerUp(document);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("Escape cancels the in-flight drag (no commit)", () => {
    const onReorder = vi.fn();
    const { container } = render(<Harness onReorder={onReorder} />);
    stubRects(container);
    fireEvent.pointerDown(container.querySelector('[data-handle="0"]')!, {
      clientY: 10,
      button: 0,
    });
    fireEvent.pointerMove(document, { clientY: 110 });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerUp(document); // listeners are gone → this is a no-op
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("pointercancel aborts the in-flight drag (no commit, announces cancelled)", () => {
    const onReorder = vi.fn();
    const { container } = render(<Harness onReorder={onReorder} />);
    stubRects(container);
    fireEvent.pointerDown(container.querySelector('[data-handle="0"]')!, {
      clientY: 10,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(document, { clientY: 110, pointerId: 1 }); // past tolerance → active
    fireEvent.pointerCancel(document, { pointerId: 1 }); // OS/touch interruption
    fireEvent.pointerUp(document, { pointerId: 1 }); // listeners are gone → no-op
    expect(onReorder).not.toHaveBeenCalled();
    expect(container.querySelector("[data-live]")!.textContent).toBe("reorder cancelled");
  });

  it("ignores events from a SECOND pointer (multi-touch) once one pointer owns the gesture", () => {
    const onReorder = vi.fn();
    const { container } = render(<Harness onReorder={onReorder} />);
    stubRects(container);
    fireEvent.pointerDown(container.querySelector('[data-handle="0"]')!, {
      clientY: 10,
      button: 0,
      pointerId: 1,
    });
    // a different finger drags past the tolerance — must be ignored, so the gesture never activates
    fireEvent.pointerMove(document, { clientY: 110, pointerId: 2 });
    fireEvent.pointerUp(document, { pointerId: 1 }); // the owning pointer releases; gesture inactive
    expect(onReorder).not.toHaveBeenCalled();
  });
});

// ── S5: the grid geometry, the displacement, the autoscroll curve and the machine ────────────────────

/** Three columns of 100×80 tiles, two rows — the gallery's shape. */
const cells = (n: number, cols = 3, w = 100, h = 80) => {
  const m = new Map<number, Cell>();
  for (let i = 0; i < n; i++) {
    m.set(i, { left: (i % cols) * w, width: w, top: Math.floor(i / cols) * h, height: h });
  }
  return m;
};

describe("gridTargetIndex (the insertion slot in READING order)", () => {
  it("counts a tile as passed once the pointer is past its horizontal midpoint in the same row", () => {
    // dragging tile 0; the pointer sits over tile 1's left half → it has not passed it.
    expect(gridTargetIndex(120, 40, 0, cells(6), 6)).toBe(0);
    // …and over its right half it has.
    expect(gridTargetIndex(180, 40, 0, cells(6), 6)).toBe(1);
  });
  it("counts a whole ROW BAND above the pointer as passed, whatever the x", () => {
    // y in the second band, x at the far left: both of row one's remaining tiles are behind it.
    expect(gridTargetIndex(0, 100, 0, cells(6), 6)).toBe(2);
  });
  it("is the 1-D rule when there is one column", () => {
    const one = cells(3, 1);
    expect(gridTargetIndex(60, 10, 0, one, 3)).toBe(0);
    expect(gridTargetIndex(60, 200, 0, one, 3)).toBe(2);
  });
  it("clamps to the list bounds", () => {
    expect(gridTargetIndex(9999, 9999, 0, cells(6), 6)).toBe(5);
    expect(gridTargetIndex(-9999, -9999, 5, cells(6), 6)).toBe(0);
  });
});

describe("displacement (which rows open the gap, and how far)", () => {
  const grid = cells(6);
  it("moves every row BETWEEN the source and a later target back one slot", () => {
    // 0 → 2: tiles 1 and 2 each take their left neighbour's slot.
    expect(displacement(1, 0, 2, grid)).toEqual({ dx: -100, dy: 0 });
    expect(displacement(2, 0, 2, grid)).toEqual({ dx: -100, dy: 0 });
    expect(displacement(3, 0, 2, grid)).toBeNull(); // past the target — untouched
    expect(displacement(0, 0, 2, grid)).toBeNull(); // the dragged tile has its own transform
  });
  it("…and forward one slot when the target is EARLIER", () => {
    expect(displacement(1, 3, 1, grid)).toEqual({ dx: 100, dy: 0 });
    expect(displacement(2, 3, 1, grid)).toEqual({ dx: -200, dy: 80 }); // wraps to the next row's start
    expect(displacement(0, 3, 1, grid)).toBeNull();
  });
  it("displaces nobody when the drag never left its own slot", () => {
    expect(displacement(1, 1, 1, grid)).toBeNull();
  });
  it("is null rather than wrong when a rect is missing", () => {
    expect(displacement(1, 0, 2, new Map())).toBeNull();
  });
});

describe("scrollVelocity (the autoscroll curve)", () => {
  it("is zero away from both edges", () => {
    expect(scrollVelocity(300, 0, 600, 96)).toBe(0);
  });
  it("is negative near the top and positive near the bottom", () => {
    expect(scrollVelocity(10, 0, 600, 96)).toBeLessThan(0);
    expect(scrollVelocity(590, 0, 600, 96)).toBeGreaterThan(0);
  });
  it("ramps QUADRATICALLY — half-way into the band is a quarter of the speed", () => {
    const edge = scrollVelocity(600, 0, 600, 96);
    const half = scrollVelocity(600 - 48, 0, 600, 96);
    expect(half / edge).toBeCloseTo(0.25, 5);
  });
  it("saturates at the edge rather than accelerating past it", () => {
    expect(scrollVelocity(9999, 0, 600, 96)).toBe(scrollVelocity(600, 0, 600, 96));
  });
  it("never scrolls a container with no band", () => {
    expect(scrollVelocity(0, 0, 600, 0)).toBe(0);
  });
});

describe("dragReduce (the state machine)", () => {
  const rects = cells(3);
  const pressed = dragReduce(IDLE, { type: "press", from: 0 });
  const dragging = dragReduce(pressed, { type: "lift", rects });
  const over = dragReduce(dragging, { type: "over", to: 2 });

  it("walks press → drag → hold → idle", () => {
    expect(pressed).toEqual({ kind: "press", from: 0 });
    expect(dragging).toMatchObject({ kind: "drag", from: 0, to: 0 });
    expect(over).toMatchObject({ kind: "drag", to: 2 });
    const held = dragReduce(over, { type: "drop" });
    expect(held).toMatchObject({ kind: "hold", from: 0, to: 2 });
    expect(dragReduce(held, { type: "released" })).toBe(IDLE);
  });
  it("a press that never lifted goes straight home — that is what a TAP is", () => {
    expect(dragReduce(pressed, { type: "drop" })).toBe(IDLE);
  });
  it("a drop that never left its own slot commits nothing", () => {
    expect(dragReduce(dragging, { type: "drop" })).toBe(IDLE);
  });
  it("REFUSES to cancel a held commit — the write is already on the wire", () => {
    const held = dragReduce(over, { type: "drop" });
    expect(dragReduce(held, { type: "cancel" })).toBe(held);
    expect(dragReduce(held, { type: "over", to: 1 })).toBe(held);
    // …while a drag cancels from anywhere.
    expect(dragReduce(over, { type: "cancel" })).toBe(IDLE);
    expect(dragReduce(pressed, { type: "cancel" })).toBe(IDLE);
  });
  it("ignores signals that belong to another state", () => {
    expect(dragReduce(IDLE, { type: "lift", rects })).toBe(IDLE);
    expect(dragReduce(IDLE, { type: "released" })).toBe(IDLE);
    expect(dragReduce(dragging, { type: "press", from: 1 })).toBe(dragging);
  });
});

// ── S5: the gesture wiring the pure functions cannot cover ───────────────────────────────────────────

function GridHarness({
  onReorder,
  orderKey,
  onOpen,
  limit,
}: {
  onReorder: (from: number, to: number) => void | Promise<unknown>;
  orderKey?: string;
  onOpen?: () => void;
  limit?: (from: number) => number;
}) {
  const d = useDragReorder(3, onReorder, { axis: "grid", activation: "press", orderKey, limit });
  return (
    <div>
      {[0, 1, 2].map((i) => (
        <div key={i} data-row={i} {...d.rowProps(i)}>
          <button type="button" data-handle={i} {...d.handleProps(i)} onClick={onOpen}>
            tile
          </button>
        </div>
      ))}
      <span data-live>{d.announce}</span>
    </div>
  );
}

/** One column of 100-wide, 40-tall tiles — enough for the reading-order rule to be unambiguous. */
function stubCells(container: HTMLElement) {
  [0, 1, 2].forEach((i) => {
    const el = container.querySelector<HTMLElement>(`[data-row="${i}"]`)!;
    el.getBoundingClientRect = () =>
      ({
        top: i * 40,
        height: 40,
        bottom: i * 40 + 40,
        left: 0,
        right: 100,
        width: 100,
        x: 0,
        y: i * 40,
      }) as DOMRect;
  });
}

const mouseDown = (el: Element, clientY: number) =>
  fireEvent.pointerDown(el, { clientX: 0, clientY, button: 0, pointerId: 1, pointerType: "mouse" });
const moveTo = (clientX: number, clientY: number) =>
  fireEvent.pointerMove(document, { clientX, clientY, pointerId: 1 });
const release = () => fireEvent.pointerUp(document, { pointerId: 1 });

describe("useDragReorder (press activation — the gallery grid)", () => {
  it("a TOUCH activates on a long press, not on distance", async () => {
    vi.useFakeTimers();
    try {
      const onReorder = vi.fn();
      const { container } = render(<GridHarness onReorder={onReorder} />);
      stubCells(container);
      fireEvent.pointerDown(container.querySelector('[data-handle="0"]')!, {
        clientX: 0,
        clientY: 10,
        pointerId: 1,
        pointerType: "touch",
      });
      // Before the hold lands, a big move is a SCROLL: nothing is dragging yet…
      act(() => void vi.advanceTimersByTime(200));
      moveTo(60, 110);
      expect(container.querySelector("[data-dragging]")).toBeNull();
      // …and the abandoned gesture never becomes a drag, however long the finger stays down.
      act(() => void vi.advanceTimersByTime(1000));
      moveTo(60, 110);
      release();
      expect(onReorder).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("…and once the hold LANDS, the same movement reorders", async () => {
    vi.useFakeTimers();
    try {
      const onReorder = vi.fn();
      const { container } = render(<GridHarness onReorder={onReorder} />);
      stubCells(container);
      fireEvent.pointerDown(container.querySelector('[data-handle="0"]')!, {
        clientX: 0,
        clientY: 10,
        pointerId: 1,
        pointerType: "touch",
      });
      act(() => void vi.advanceTimersByTime(500));
      expect(container.querySelector("[data-dragging]")).not.toBeNull();
      moveTo(60, 110); // past tile 2's midpoint, in tile 2's band
      release();
      expect(onReorder).toHaveBeenCalledWith(0, 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a MOUSE still activates on distance, and the tap it leaves behind is suppressed", () => {
    const onReorder = vi.fn();
    const onOpen = vi.fn();
    const { container } = render(<GridHarness onReorder={onReorder} onOpen={onOpen} />);
    stubCells(container);
    const tile = container.querySelector<HTMLElement>('[data-handle="0"]')!;
    mouseDown(tile, 10);
    moveTo(60, 110);
    release();
    expect(onReorder).toHaveBeenCalledWith(0, 2);
    // The browser fires this after the whole gesture; without the capture-phase guard the drag would
    // ALSO open the tile's detail panel.
    fireEvent.click(tile);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a press that never moved is a TAP: no reorder, and the tile's own action runs", () => {
    const onReorder = vi.fn();
    const onOpen = vi.fn();
    const { container } = render(<GridHarness onReorder={onReorder} onOpen={onOpen} />);
    stubCells(container);
    const tile = container.querySelector<HTMLElement>('[data-handle="0"]')!;
    mouseDown(tile, 10);
    release();
    fireEvent.click(tile);
    expect(onReorder).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("never aims past the last slot the CONSUMER can express", () => {
    // The gallery storage cannot order anything after its trailing bundled tier, so the drop clamps
    // while the finger is still down — a gesture that showed slot 2 and saved slot 1 would slide back
    // one refetch later, which is exactly the snap-back the held commit exists to avoid.
    const onReorder = vi.fn();
    const { container } = render(<GridHarness onReorder={onReorder} limit={() => 1} />);
    stubCells(container);
    mouseDown(container.querySelector('[data-handle="0"]')!, 10);
    moveTo(60, 110); // aimed at the very end…
    release();
    expect(onReorder).toHaveBeenCalledWith(0, 1); // …landed on the honest bottom
  });
});

describe("useDragReorder (the HELD commit — Emma #8)", () => {
  it("holds the dropped arrangement until the AUTHORITATIVE order arrives", async () => {
    let settle = () => {};
    const onReorder = vi.fn(() => new Promise<void>((r) => (settle = r)));
    const { container, rerender } = render(<GridHarness onReorder={onReorder} orderKey="a b c" />);
    stubCells(container);
    mouseDown(container.querySelector('[data-handle="0"]')!, 10);
    moveTo(60, 110);
    release();
    // The pointer is up and the write is in flight: the tile stays where it was dropped, and every
    // displaced tile stays displaced.
    expect(container.querySelector("[data-drag-held]")).not.toBeNull();
    expect(container.querySelector('[data-row="1"]')!.getAttribute("style")).toContain("translate");
    // The server's order lands — and the hold is released in the SAME commit that paints it.
    rerender(<GridHarness onReorder={onReorder} orderKey="c a b" />);
    expect(container.querySelector("[data-drag-held]")).toBeNull();
    expect(container.querySelector('[data-row="1"]')!.getAttribute("style")).not.toContain(
      "translate",
    );
    await act(async () => {
      settle();
      await Promise.resolve();
    });
  });

  it("releases on a REFUSED write too — snapped back, and the next drag is admitted", async () => {
    let reject: (e: Error) => void = () => {};
    const onReorder = vi.fn(() => new Promise<void>((_, r) => (reject = r)));
    const { container } = render(<GridHarness onReorder={onReorder} orderKey="a b c" />);
    stubCells(container);
    mouseDown(container.querySelector('[data-handle="0"]')!, 10);
    moveTo(60, 110);
    release();
    expect(container.querySelector("[data-drag-held]")).not.toBeNull();
    await act(async () => {
      reject(new Error("save failed"));
      await Promise.resolve();
    });
    // Back to the order the owner started from — the toast is the consumer's business, the VISUAL is
    // this hook's, and it is owed on both outcomes (the `finally`).
    expect(container.querySelector("[data-drag-held]")).toBeNull();
    expect(container.querySelector('[data-row="1"]')!.getAttribute("style")).not.toContain(
      "translate",
    );
    mouseDown(container.querySelector('[data-handle="0"]')!, 10);
    moveTo(60, 110);
    release();
    expect(onReorder).toHaveBeenCalledTimes(2);
  });

  it("REFUSES a new drag while the commit is in flight (the synchronous latch)", async () => {
    let settle = () => {};
    const onReorder = vi.fn(() => new Promise<void>((r) => (settle = r)));
    const { container } = render(<GridHarness onReorder={onReorder} orderKey="a b c" />);
    stubCells(container);
    mouseDown(container.querySelector('[data-handle="0"]')!, 10);
    moveTo(60, 110);
    release();
    // A second gesture starting on top of the held one would drag against rects the server is about to
    // replace — so it never starts.
    mouseDown(container.querySelector('[data-handle="1"]')!, 50);
    moveTo(10, 10);
    release();
    expect(onReorder).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle();
      await new Promise((r) => setTimeout(r, 0));
    });
    // …and once it settles, the surface is live again.
    mouseDown(container.querySelector('[data-handle="1"]')!, 50);
    moveTo(10, 10);
    release();
    expect(onReorder).toHaveBeenCalledTimes(2);
  });

  it("announces the commit, which a fast drag used to swallow (G10)", () => {
    const { container } = render(<GridHarness onReorder={vi.fn()} />);
    stubCells(container);
    mouseDown(container.querySelector('[data-handle="0"]')!, 10);
    moveTo(60, 110);
    release();
    expect(container.querySelector("[data-live]")!.textContent).toBe("moved to position 3 of 3");
  });
});

describe("useDragReorder (keyboard reorder on the handle)", () => {
  it("ArrowUp/ArrowDown reorder; the ends are bounds-checked", () => {
    const onReorder = vi.fn();
    const { container } = render(<Harness onReorder={onReorder} />);
    const handle = (i: number) => container.querySelector<HTMLElement>(`[data-handle="${i}"]`)!;
    fireEvent.keyDown(handle(1), { key: "ArrowUp" });
    expect(onReorder).toHaveBeenLastCalledWith(1, 0);
    fireEvent.keyDown(handle(1), { key: "ArrowDown" });
    expect(onReorder).toHaveBeenLastCalledWith(1, 2);
    // at the ends there is nowhere to go — no call
    onReorder.mockClear();
    fireEvent.keyDown(handle(0), { key: "ArrowUp" });
    fireEvent.keyDown(handle(2), { key: "ArrowDown" });
    expect(onReorder).not.toHaveBeenCalled();
  });
});
