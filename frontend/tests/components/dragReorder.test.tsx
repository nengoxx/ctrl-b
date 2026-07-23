import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { targetIndex, useDragReorder } from "../../src/components/useDragReorder";

// A11/D48 P11 — the fallback drag-reorder. jsdom has no layout, so the target MATH is tested purely via
// `targetIndex`, and the handler wiring (tolerance, commit, Escape) via a synthetic pointer sequence with
// stubbed row rects.

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
