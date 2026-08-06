import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BottomSheet, pickSnap } from "../../src/components/BottomSheet";

// BottomSheet snap selection (Cosmos C3c). The drag/transform itself is verified live (jsdom can't render the
// gesture); this covers the pure helper. snaps ascending: [0 = full, peekTy, fullH = closed].

const SNAPS = [0, 300, 500]; // full · peek (fullH−peekH) · closed (fullH)

describe("pickSnap", () => {
  it("slow release snaps to the nearest point", () => {
    expect(pickSnap(40, 0, SNAPS)).toBe(0); // near full
    expect(pickSnap(280, 0, SNAPS)).toBe(300); // near peek
    expect(pickSnap(470, 0.1, SNAPS)).toBe(500); // near closed
  });

  it("a fast flick DOWN steps one snap toward closed", () => {
    expect(pickSnap(10, 0.8, SNAPS)).toBe(300); // full → peek
    expect(pickSnap(300, 0.8, SNAPS)).toBe(500); // peek → closed (dismiss)
  });

  it("a fast flick UP steps one snap toward full", () => {
    expect(pickSnap(300, -0.8, SNAPS)).toBe(0); // peek → full
    expect(pickSnap(500, -0.8, SNAPS)).toBe(300); // closed-ish → peek
  });

  it("a flick UP at full stays full (clamped at the first snap)", () => {
    expect(pickSnap(0, -0.8, SNAPS)).toBe(0);
  });

  it("a slow drag that doesn't pass the midpoint bounces back", () => {
    expect(pickSnap(120, 0.1, SNAPS)).toBe(0); // 120 closer to 0 than 300 → back to full
    expect(pickSnap(360, 0.1, SNAPS)).toBe(300); // 360 closer to 300 than 500 → back to peek
  });

  it("two-state sheet (no peek detent): nearest / flick to close", () => {
    const s2 = [0, 500];
    expect(pickSnap(40, 0, s2)).toBe(0); // bounce back to full
    expect(pickSnap(300, 0, s2)).toBe(500); // past midpoint → closed
    expect(pickSnap(10, 0.8, s2)).toBe(500); // flick down → closed
  });
});

// data-settling STATE stamp (Gate B, 2026-07-15). The primitive marks the sheet element while a programmatic
// slide plays so a skin can react (cosmos.css drops its Gecko backdrop blur only for this window). Unlike the
// pure `pickSnap` cases above these mount the real component: jsdom reports offsetHeight 0 (no peek detent),
// so the sheet is a plain full sheet — enough to observe the stamp lifecycle. The enter slide is scheduled in
// a rAF and the stamp self-clears after SNAP_MS (420) + 60 slack; fake timers drive both deterministically.
const SETTLE_MS = 420 + 60; // SNAP_MS + slack (BottomSheet.markSettling — SNAP_MS isn't exported)

describe("data-settling stamp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom doesn't implement Pointer Capture — onPointerDown calls setPointerCapture; stub it to a no-op so
    // the handler runs to completion (we only care about its `data-settling` clear, not the capture itself).
    HTMLElement.prototype.setPointerCapture = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // No `act()` wrapping the timer advances: the settling path is purely IMPERATIVE (rAF/timeout mutate
  // `dataset` directly; `settle()`→`syncGrip` bails with no state change here), so advancing fires no React
  // update — nothing to flush. children go in the props object (createElement's 3rd arg doesn't satisfy the
  // component's required `children` prop for the typechecker).
  const renderOpenSheet = () =>
    render(
      createElement(BottomSheet, {
        open: true,
        onClose: () => {},
        children: createElement("div", null, "content"),
      }),
    );

  it("stamps data-settling on open, and clears it after SNAP_MS+60", () => {
    const { container } = renderOpenSheet();
    const sheet = container.querySelector<HTMLElement>(".bs-sheet")!;
    vi.advanceTimersByTime(20); // fire the enter-slide rAF that marks the motion
    expect(sheet.dataset.settling).toBe("true");
    vi.advanceTimersByTime(SETTLE_MS); // let the self-clear timeout elapse
    expect(sheet.dataset.settling).toBeUndefined();
  });

  it("pointerdown on the handle clears a pending data-settling (a drag has its own rules)", () => {
    const { container } = renderOpenSheet();
    const sheet = container.querySelector<HTMLElement>(".bs-sheet")!;
    const handle = container.querySelector<HTMLElement>(".bs-handle")!;
    vi.advanceTimersByTime(20);
    expect(sheet.dataset.settling).toBe("true");
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    expect(sheet.dataset.settling).toBeUndefined();
  });
});

// `enterInstant` (M3's seam, D52 G2). OPT-IN: with the flag unset the enter is the primitive's two-step
// (mount, then a rAF slides it up from the closed position) and every existing host keeps it. With the flag
// the sheet must be PRESENT and SETTLED in the very commit that opened it — that is the whole point: gacha's
// capsule→dossier morph is a View Transition, and the browser captures the new state one frame after the
// update callback returns. A sheet that mounts an effect later has no avatar in that capture (nothing to
// morph into); one that is mid-slide gives the morph an off-screen destination.
//
// jsdom reports offsetHeight 0, so the transform is 0 either way — OPACITY is the observable difference:
// the two-step commits `0` and only reaches `1` in its rAF (which `act` does not run), the instant path is
// at `1` immediately.
describe("enterInstant", () => {
  afterEach(cleanup);

  const sheet = (open: boolean, enterInstant?: boolean) =>
    createElement(BottomSheet, {
      open,
      enterInstant,
      onClose: () => {},
      children: createElement("div", null, "content"),
    });

  it("is present and settled in the commit that turned `open` true", () => {
    const { container, rerender } = render(sheet(false, true));
    expect(container.querySelector(".bs-sheet")).toBeNull();
    rerender(sheet(true, true));
    const el = container.querySelector<HTMLElement>(".bs-sheet")!;
    expect(el).not.toBeNull();
    expect(el.style.opacity).toBe("1");
    expect(el.style.transform).toBe("translateY(0px)");
  });

  it("leaves the default enter untouched when the flag is unset", () => {
    const { container, rerender } = render(sheet(false));
    rerender(sheet(true));
    const el = container.querySelector<HTMLElement>(".bs-sheet")!;
    expect(el).not.toBeNull(); // mounted by the open effect…
    expect(el.style.opacity).toBe("0"); // …but still at the START of its slide, waiting on the rAF
  });
});

// ── FOCUS RESTORATION ON CLOSE — the three branches of the claimed-focus guard, and the `preventScroll`
//    the owner's "the page jumps when I close the dossier" bug turned out to be (2026-08-06).
//
// Root-caused by instrumenting the real close path: the restore fires 420 ms after close, and focusing an
// element the browser considers out of view SCROLLS IT INTO VIEW — the opener is a card the sheet was
// covering, so the page behind moved (measured: scrollTop 0 → 226 on Blink, 0 → 230 on Gecko, a CLAMP to
// the page end rather than a nudge). Restoring focus is the a11y contract; scrolling while doing it is not.
describe("BottomSheet — focus restoration on close", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  const openSheet = (opts: { onClose?: () => void } = {}) => {
    const trigger = document.createElement("button");
    trigger.id = "opener";
    document.body.append(trigger);
    trigger.focus(); // the sheet captures `document.activeElement` as its trigger when it opens
    const spy = vi.spyOn(trigger, "focus");
    const view = render(
      createElement(BottomSheet, {
        open: true,
        onClose: opts.onClose ?? (() => {}),
        children: createElement("div", null, "body"),
      }),
    );
    return { trigger, spy, view };
  };

  it("restores the opener WITHOUT scrolling — the owner's page-jump bug", () => {
    const { trigger, spy, view } = openSheet();
    // THE × PATH, which is the one that actually moves focus: the user activates a control INSIDE the
    // sheet, so at teardown `document.activeElement` is inside the departing sheet — nothing outside
    // claimed it — and the opener has to be focused back. (Escape leaves focus ON the opener already, so
    // it takes the `claimed` branch and never calls `focus()` at all; that asymmetry is what made × the
    // only close path the owner saw jump.)
    // `.bs-sheet`, not `.bs-root`: the guard tests containment against the SHEET, so the full-screen
    // `.bs-catch` dismissal button — a sibling of the sheet — counts as "outside" and would take the
    // claimed branch. The × the owner presses is inside the sheet proper.
    const inside = view.container.querySelector<HTMLElement>(".bs-sheet button");
    expect(inside, "the sheet must render a focusable control").toBeTruthy();
    inside!.focus();
    view.rerender(
      createElement(BottomSheet, {
        open: false,
        onClose: () => {},
        children: createElement("div", null, "body"),
      }),
    );
    vi.advanceTimersByTime(500); // past SNAP_MS
    expect(spy).toHaveBeenCalled();
    // THE ASSERTION THIS TEST EXISTS FOR: every restore must pass `preventScroll`.
    for (const call of spy.mock.calls) expect(call[0]).toEqual({ preventScroll: true });
    trigger.remove();
  });

  it("does NOT yank focus back when the user has already claimed it elsewhere", () => {
    // The Codex M3-confirm L1 guard: a tap-outside dismissal puts focus on the control the user just
    // activated, and stealing it 420 ms later would eat their next action.
    const { trigger, spy, view } = openSheet();
    const other = document.createElement("button");
    document.body.append(other);
    other.focus();
    view.rerender(
      createElement(BottomSheet, {
        open: false,
        onClose: () => {},
        children: createElement("div", null, "body"),
      }),
    );
    vi.advanceTimersByTime(500);
    expect(spy).not.toHaveBeenCalled();
    trigger.remove();
    other.remove();
  });

  it("DOES restore when focus fell back to <body> — nothing claimed it", () => {
    // The third branch, pinned because the live investigation could not observe it firing on the
    // tap-outside path and it needed a decision rather than an assumption: `document.body` is explicitly
    // excluded from `claimed`, so "focus went nowhere" restores exactly like Escape and the close buttons.
    const { trigger, spy, view } = openSheet();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    view.rerender(
      createElement(BottomSheet, {
        open: false,
        onClose: () => {},
        children: createElement("div", null, "body"),
      }),
    );
    vi.advanceTimersByTime(500);
    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls) expect(call[0]).toEqual({ preventScroll: true });
    trigger.remove();
  });
});
