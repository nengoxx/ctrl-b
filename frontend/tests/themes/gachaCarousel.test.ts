import { describe, expect, it } from "vitest";

import {
  ADVANCE_FRACTION,
  CAROUSEL_IDLE,
  EDGE_RESISTANCE,
  HERO_KEY,
  SLIDE_SLOP_PX,
  carouselReduce,
  reconcileActive,
  settleIndex,
  type CarouselEvent,
  type CarouselState,
} from "../../src/themes/gacha/carousel";

// The pickup banner's gesture machine (D52 / GACHA_PLAN §6.4). §6.4 specifies it as a STATE MACHINE rather
// than a heuristic precisely so it can be tested like this — the failure modes it exists to prevent (a
// carousel that eats the page scroll, a drag that opens a dossier on release, a gesture that never resolves
// after `pointercancel`) are all one reducer call away here and would otherwise be device stories.

const GEO = { width: 300, index: 1, count: 4 };

/** Drive a sequence of events from idle and return the final state + the last effect. */
function run(events: CarouselEvent[], from: CarouselState = CAROUSEL_IDLE) {
  let state = from;
  let effect = carouselReduce(state, { type: "cancel" }).effect; // a known no-op starting value
  for (const e of events) ({ state, effect } = carouselReduce(state, e));
  return { state, effect };
}

const down = (x = 100, y = 100, pointerId = 1): CarouselEvent => ({
  type: "down",
  pointerId,
  primary: true,
  x,
  y,
});
const move = (x: number, y: number, pointerId = 1): CarouselEvent => ({
  type: "move",
  pointerId,
  x,
  y,
  ...GEO,
});
const up = (pointerId = 1): CarouselEvent => ({ type: "up", pointerId, ...GEO });

describe("the slop — nothing commits until the finger has actually travelled", () => {
  it("a pointerdown alone only ARMS the machine (no capture, no drag)", () => {
    const { state, effect } = run([down()]);
    expect(state.phase).toBe("pending");
    expect(state.moved).toBe(false);
    expect(effect.kind).toBe("none");
  });

  it("stays pending inside the slop in BOTH axes", () => {
    const { state, effect } = run([down(), move(100 + SLIDE_SLOP_PX - 1, 100 + SLIDE_SLOP_PX - 1)]);
    expect(state.phase).toBe("pending");
    expect(effect.kind).toBe("none");
  });

  it("an under-slop release is a TAP — the slide's click action runs", () => {
    const { state, effect } = run([down(), move(104, 102), up()]);
    expect(effect.kind).toBe("tap");
    expect(state).toEqual(CAROUSEL_IDLE);
  });
});

describe("the direction lock", () => {
  it("horizontal intent captures the pointer and enters the drag", () => {
    const { state, effect } = run([down(), move(140, 104)]);
    expect(effect.kind).toBe("capture");
    expect(state.phase).toBe("drag");
    expect(state.moved).toBe(true);
  });

  it("re-bases the origin at the lock, so the strip does not jump by the slop it consumed", () => {
    const { state } = run([down(100, 100), move(140, 104)]);
    expect(state.dx).toBe(0); // the strip starts exactly under the finger
    const next = carouselReduce(state, move(150, 104));
    expect(next.state.dx).toBe(10); // …and tracks from there
  });

  it("VERTICAL intent aborts cleanly — no capture, so the page keeps scrolling natively", () => {
    const { state, effect } = run([down(), move(104, 140)]);
    expect(effect.kind).toBe("abort");
    expect(state).toEqual(CAROUSEL_IDLE);
  });

  it("treats a perfect diagonal as vertical (page scroll is the safer default on a phone)", () => {
    const { effect } = run([down(), move(120, 120)]);
    expect(effect.kind).toBe("abort");
  });

  it("ignores a SECOND pointer's move events entirely", () => {
    const armed = run([down(100, 100, 1)]).state;
    const { state, effect } = carouselReduce(armed, move(200, 100, 2));
    expect(effect.kind).toBe("none");
    expect(state).toBe(armed);
  });
});

describe("edge resistance", () => {
  it("damps a drag past the FIRST slide", () => {
    const at0 = { ...GEO, index: 0 };
    let s = carouselReduce(CAROUSEL_IDLE, down()).state;
    s = carouselReduce(s, { type: "move", pointerId: 1, x: 140, y: 100, ...at0 }).state;
    s = carouselReduce(s, { type: "move", pointerId: 1, x: 240, y: 100, ...at0 }).state;
    expect(s.dx).toBeCloseTo(100 * EDGE_RESISTANCE);
  });

  it("damps a drag past the LAST slide, and leaves the middle undamped", () => {
    const atEnd = { ...GEO, index: 3 };
    let s = carouselReduce(CAROUSEL_IDLE, down()).state;
    s = carouselReduce(s, { type: "move", pointerId: 1, x: 60, y: 100, ...atEnd }).state;
    s = carouselReduce(s, { type: "move", pointerId: 1, x: -40, y: 100, ...atEnd }).state;
    expect(s.dx).toBeCloseTo(-100 * EDGE_RESISTANCE);
    // the same drag one slide in from the end is full-strength
    let m = carouselReduce(CAROUSEL_IDLE, down()).state;
    m = carouselReduce(m, move(60, 100)).state;
    m = carouselReduce(m, move(-40, 100)).state;
    expect(m.dx).toBe(-100);
  });
});

describe("settleIndex — where a released drag lands", () => {
  const geo = { width: 300, index: 1, count: 4 };
  const past = 300 * ADVANCE_FRACTION + 1;

  it("advances forward on a leftward drag past the threshold", () => {
    expect(settleIndex(-past, geo)).toBe(2);
  });

  it("advances back on a rightward drag past the threshold", () => {
    expect(settleIndex(past, geo)).toBe(0);
  });

  it("snaps BACK when the drag did not cover enough of the banner", () => {
    expect(settleIndex(-(300 * ADVANCE_FRACTION - 1), geo)).toBe(1);
  });

  it("clamps at both ends — a finger never wraps the set (only autoplay and Prev/Next do)", () => {
    expect(settleIndex(past, { ...geo, index: 0 })).toBe(0);
    expect(settleIndex(-past, { ...geo, index: 3 })).toBe(3);
  });

  it("survives a zero-width measurement rather than dividing the set by nothing", () => {
    expect(settleIndex(-5, { width: 0, index: 1, count: 4 })).toBe(2);
  });
});

describe("every abnormal end resolves to idle (the §6.4 rule that keeps a phone carousel unstuck)", () => {
  it("pointercancel from a drag", () => {
    const dragging = run([down(), move(140, 104)]).state;
    const { state, effect } = carouselReduce(dragging, { type: "cancel" });
    expect(effect.kind).toBe("abort");
    expect(state).toEqual(CAROUSEL_IDLE);
  });

  it("a cancel while idle is a no-op, not a spurious snap", () => {
    const { effect } = carouselReduce(CAROUSEL_IDLE, { type: "cancel" });
    expect(effect.kind).toBe("none");
  });

  it("a SECOND finger resolves the gesture instead of joining it", () => {
    const dragging = run([down(100, 100, 1), move(140, 104, 1)]).state;
    const { state, effect } = carouselReduce(dragging, down(200, 200, 2));
    expect(effect.kind).toBe("abort");
    expect(state).toEqual(CAROUSEL_IDLE);
  });

  it("a non-primary pointer never arms the machine at all", () => {
    const { state, effect } = carouselReduce(CAROUSEL_IDLE, {
      type: "down",
      pointerId: 9,
      primary: false,
      x: 0,
      y: 0,
    });
    expect(state).toEqual(CAROUSEL_IDLE);
    expect(effect.kind).toBe("none");
  });

  it("a released drag carries `moved`, so the component can swallow the click that follows", () => {
    const dragging = run([down(), move(140, 104), move(20, 104)]).state;
    expect(dragging.moved).toBe(true);
    const { effect } = carouselReduce(dragging, up());
    expect(effect.kind).toBe("settle");
  });
});

describe("reconcileActive — a membership change while a slide is open", () => {
  it("keeps the active slide when it survives, even though its INDEX moved", () => {
    expect(reconcileActive([HERO_KEY, "a", "b"], [HERO_KEY, "b"], "b")).toBe("b");
  });

  it("lands on the FORWARD neighbour when the active host vanished", () => {
    // 'b' is gone; 'c' has slid into the position the user was looking at.
    expect(reconcileActive([HERO_KEY, "a", "b", "c"], [HERO_KEY, "a", "c"], "b")).toBe("c");
  });

  it("falls back to the BACKWARD neighbour when nothing survives ahead", () => {
    expect(reconcileActive([HERO_KEY, "a", "b"], [HERO_KEY, "a"], "b")).toBe("a");
  });

  it("lands on the hero when the whole fleet disappears", () => {
    expect(reconcileActive([HERO_KEY, "a", "b"], [HERO_KEY], "b")).toBe(HERO_KEY);
  });

  it("never returns a key that is not in the new set, even from a nonsense previous order", () => {
    expect(reconcileActive([], [HERO_KEY, "a"], "ghost")).toBe(HERO_KEY);
    expect(reconcileActive(["x"], [], "x")).toBe(HERO_KEY);
  });
});
