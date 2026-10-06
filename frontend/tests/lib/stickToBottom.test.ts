import { describe, expect, it } from "vitest";

import {
  ATTACH_PX,
  createStickLatch,
  ESCAPE_PX,
  type ScrollBox,
} from "../../src/lib/stickToBottom";

// lib/stickToBottom — the direction-latched stick-to-bottom controller (ISS-66, R102 §7). Pure: a
// hand-rolled box stands in for the scroller, and a "scroll event" is just `onScroll(box)` after moving
// `scrollTop` — exactly what the two consumers' listeners do. The box CLAMPS like a real one (a write
// past the end lands on the end), because the read-back after a write is part of the contract.

/** A scroller model: `scrollHeight` content, `clientHeight` visible, `scrollTop` clamped to [0, max]. */
function box(scrollHeight = 1000, clientHeight = 400) {
  let top = 0;
  const b = {
    scrollHeight,
    clientHeight,
    writes: 0,
    get scrollTop() {
      return top;
    },
    set scrollTop(v: number) {
      b.writes++;
      top = Math.max(0, Math.min(v, b.scrollHeight - b.clientHeight));
    },
    /** Where the bottom is. */
    get max() {
      return b.scrollHeight - b.clientHeight;
    },
    /** A USER scroll: move without counting as a write, then the scroll event. */
    scrollTo(v: number, latch: ReturnType<typeof createStickLatch>) {
      top = Math.max(0, Math.min(v, b.scrollHeight - b.clientHeight));
      latch.onScroll(b);
    },
  };
  return b satisfies ScrollBox;
}

describe("createStickLatch", () => {
  it("(1) is born stuck: pin writes the bottom and records the write as its own", () => {
    const latch = createStickLatch();
    const b = box();
    expect(latch.isEscaped()).toBe(false);
    expect(latch.pin(b)).toBe(true);
    expect(b.scrollTop).toBe(b.max);
    // …the write's echo is recognised (2) — proven by it NOT reading as a down-move from 0.
  });

  it("(2) our own write's echo never escapes — even after growth moved the end", () => {
    const latch = createStickLatch();
    const b = box();
    latch.pin(b);
    latch.onScroll(b); // the echo
    expect(latch.isEscaped()).toBe(false);
    b.scrollHeight = 1600; // the reply grew
    latch.pin(b);
    latch.onScroll(b);
    expect(latch.isEscaped()).toBe(false);
    expect(b.scrollTop).toBe(b.max);
  });

  it("(3) a small UP move past the escape threshold escapes; pin then writes nothing", () => {
    const latch = createStickLatch();
    const b = box();
    latch.pin(b);
    latch.onScroll(b);
    b.scrollTo(b.max - (ESCAPE_PX + 1), latch); // ESCAPE_PX + 1 — the old 140px band would have kept it stuck
    expect(latch.isEscaped()).toBe(true);
    const before = b.writes;
    b.scrollHeight = 1400; // the next streamed chunk
    expect(latch.pin(b)).toBe(false);
    expect(b.writes).toBe(before);
    expect(b.scrollTop).toBe(1000 - 400 - (ESCAPE_PX + 1));
  });

  it("…while an UP move that stays inside the threshold does not", () => {
    const latch = createStickLatch();
    const b = box();
    latch.pin(b);
    latch.onScroll(b);
    b.scrollTo(b.max - ESCAPE_PX, latch);
    expect(latch.isEscaped()).toBe(false);
  });

  it("(4) a shrink whose clamp ENDS on the bottom never escapes (the think block collapsing)", () => {
    const latch = createStickLatch();
    const b = box(2000);
    latch.pin(b);
    latch.onScroll(b);
    // The reasoning disclosure collapses: content loses 300px; the browser clamps scrollTop DOWN by 300
    // (the view moves up) and fires a scroll — a large up-delta, but it lands on the new bottom.
    b.scrollHeight = 1700;
    b.scrollTo(b.max, latch);
    expect(latch.isEscaped()).toBe(false);
    expect(latch.pin(b)).toBe(true);
  });

  it("(5) a DOWN move ending inside the attach band re-sticks", () => {
    const latch = createStickLatch();
    const b = box(3000);
    latch.pin(b);
    latch.onScroll(b);
    b.scrollTo(b.max - 800, latch);
    expect(latch.isEscaped()).toBe(true);
    b.scrollTo(b.max - ATTACH_PX, latch);
    expect(latch.isEscaped()).toBe(false);
    expect(latch.pin(b)).toBe(true);
    expect(b.scrollTop).toBe(b.max);
  });

  it("(6) a DOWN move that stops outside the band stays escaped", () => {
    const latch = createStickLatch();
    const b = box(3000);
    latch.pin(b);
    latch.onScroll(b);
    b.scrollTo(b.max - 800, latch);
    b.scrollTo(b.max - (ATTACH_PX + 1), latch);
    expect(latch.isEscaped()).toBe(true);
  });

  it("…and a scroll-anchoring shift while escaped (content grew ABOVE; distance unchanged) changes nothing", () => {
    const latch = createStickLatch();
    const b = box(3000);
    latch.pin(b);
    latch.onScroll(b);
    b.scrollTo(1000, latch); // escaped, far up
    b.scrollHeight = 3100; // 100px inserted above the anchor…
    b.scrollTo(1100, latch); // …and the browser moves top by the same 100: a DOWN delta, far from the end
    expect(latch.isEscaped()).toBe(true);
  });

  it("a box that changed with NO scroll event while escaped (the keyboard closing) never turns the next UP drag into a re-stick", () => {
    // Confirm round №1 (Opus N1, reproduced): a refused pin left `lastDist` at the keyboard-open distance
    // (400); the keyboard closed (clientHeight 700 → 1000: now 100 from the end, no scroll event); an UP
    // drag of 10 then read `grew = 110 − 400 < 0` inside the band and re-stuck → the next chunk yanked.
    const latch = createStickLatch();
    const b = box(3000, 700);
    latch.pin(b);
    latch.onScroll(b);
    b.scrollTo(b.max - 400, latch); // escaped, 400 from the end with the keyboard open
    expect(latch.isEscaped()).toBe(true);
    b.clientHeight = 1000; // the keyboard closes: no scroll event…
    expect(latch.pin(b)).toBe(false); // …the ResizeObserver's pin is refused
    b.scrollTo(b.scrollTop - 10, latch); // an UP drag
    expect(latch.isEscaped()).toBe(true);
    expect(latch.pin(b)).toBe(false);
  });

  it("a DOWN drag into the band re-sticks even when a pin is refused before EVERY event (a fast stream)", () => {
    // Confirm round №2 (Opus R2-1): forgetting the distance on every refused pin left every scroll
    // event of a fast stream directionless, so the 150px band never fired. Growth keeps the distance.
    const latch = createStickLatch();
    const b = box(3000);
    latch.pin(b);
    latch.onScroll(b);
    b.scrollTo(b.max - 600, latch); // escaped, far up
    expect(latch.isEscaped()).toBe(true);
    let frames = 0;
    while (latch.isEscaped() && frames < 40) {
      b.scrollHeight += 8; // the reply grows…
      expect(latch.pin(b)).toBe(false); // …the pin is refused (escaped)…
      b.scrollTo(b.scrollTop + 30, latch); // …and the hand drags DOWN 30 per frame
      frames++;
    }
    // net −22 per frame: 600 → ≤ 150 inside the band on the 21st frame → re-stuck (v3 never did)
    expect(latch.isEscaped()).toBe(false);
    expect(frames).toBe(21);
    expect(b.max - b.scrollTop).toBeLessThanOrEqual(ATTACH_PX);
    expect(latch.pin(b)).toBe(true);
  });

  it("native ANCHORING inside the attach band (content inserted above: top and height both +200) keeps an escape", () => {
    // Review round №1 (E-MED2): read as a `scrollTop` delta this was a scroll DOWN ending 30px from the
    // end — inside the 150px band — and falsely re-stuck. Direction is the DISTANCE's change: unchanged.
    const latch = createStickLatch();
    const b = box(3000);
    latch.pin(b);
    latch.onScroll(b);
    b.scrollTo(b.max - 30, latch);
    expect(latch.isEscaped()).toBe(true);
    const top = b.scrollTop;
    b.scrollHeight += 200;
    b.scrollTo(top + 200, latch); // the browser's anchoring adjustment, and the scroll event it fires
    expect(latch.isEscaped()).toBe(true);
    expect(latch.pin(b)).toBe(false);
  });

  it("…and the mirror: a STUCK reader's anchoring shift changes nothing either — the follow-up pin's echo is still ours", () => {
    const latch = createStickLatch();
    const b = box(3000);
    latch.pin(b);
    latch.onScroll(b);
    b.scrollHeight += 200;
    b.scrollTo(b.scrollTop + 200, latch); // anchoring at the bottom: still on the end
    expect(latch.isEscaped()).toBe(false);
    b.scrollHeight += 120; // the stream grows below
    expect(latch.pin(b)).toBe(true);
    latch.onScroll(b); // the pin's echo
    expect(latch.isEscaped()).toBe(false);
    expect(b.scrollTop).toBe(b.max);
  });

  it("(7) a wheel turned up escapes at once — but only with something above to scroll to", () => {
    const latch = createStickLatch();
    const b = box();
    latch.pin(b);
    latch.onWheel(40, b); // down: nothing
    expect(latch.isEscaped()).toBe(false);
    latch.onWheel(-4, b);
    expect(latch.isEscaped()).toBe(true);
    const flat = box(300, 400); // no overflow: scrollTop is 0, there is nothing to escape to
    const other = createStickLatch();
    other.onWheel(-40, flat);
    expect(other.isEscaped()).toBe(false);
  });

  it("(8) stick() clears the escape and pins", () => {
    const latch = createStickLatch();
    const b = box(3000);
    latch.pin(b);
    latch.onScroll(b);
    b.scrollTo(500, latch);
    expect(latch.isEscaped()).toBe(true);
    expect(latch.stick(b)).toBe(true);
    expect(latch.isEscaped()).toBe(false);
    expect(b.scrollTop).toBe(b.max);
    latch.onScroll(b); // its echo
    expect(latch.isEscaped()).toBe(false);
  });

  it("(9) an own write a user scroll BEAT is consumed as the user's", () => {
    const latch = createStickLatch();
    const b = box(3000);
    latch.pin(b); // expecting the echo at max…
    b.scrollTo(b.max - 300, latch); // …but the finger moved first: the event reads the user's position
    expect(latch.isEscaped()).toBe(true);
    // …and the expectation is spent: a later event AT the old write's position is a real move (down,
    // into the band) — it re-sticks on its own merit, not as an echo.
    b.scrollTo(b.max, latch);
    expect(latch.isEscaped()).toBe(false);
  });

  it("reset() forgets the escape and the last sample (a new box, or another owner's scrolling)", () => {
    const latch = createStickLatch();
    const b = box(3000);
    latch.pin(b);
    latch.onScroll(b);
    b.scrollTo(400, latch);
    expect(latch.isEscaped()).toBe(true);
    latch.reset();
    expect(latch.isEscaped()).toBe(false);
    // With no last sample, the first event has no direction: a position far from the end changes nothing.
    b.scrollTo(900, latch);
    expect(latch.isEscaped()).toBe(false);
  });

  it("takes its thresholds per instance (the call overlay's short box)", () => {
    const latch = createStickLatch({ attachPx: 32 });
    const b = box(400, 113);
    latch.pin(b);
    latch.onScroll(b);
    b.scrollTo(b.max - 100, latch);
    expect(latch.isEscaped()).toBe(true);
    b.scrollTo(b.max - 40, latch); // down, but outside a 32px band
    expect(latch.isEscaped()).toBe(true);
    b.scrollTo(b.max - 30, latch);
    expect(latch.isEscaped()).toBe(false);
  });
});
