// The pickup banner's GESTURE + SLIDE-SET machinery (D52 / GACHA_PLAN §6.4) — pure, so the parts that are
// genuinely hard to get right (tap vs drag, an aborted gesture, a host vanishing mid-swipe) are ordinary unit
// tests instead of device stories. No React, no DOM, no store reads: the component owns the refs, the
// pointer capture and the rAF; this module owns the DECISIONS.
//
// §6.4 specifies the gesture as a STATE MACHINE rather than a heuristic (Codex R4-5), and that is what this
// is: `idle → pending → drag`, with EVERY abnormal end (pointercancel, lost capture, a second finger, unmount)
// resolving back to `idle` with the strip snapped. The alternative — a pile of booleans read from event
// handlers — is exactly how carousels end up stuck mid-drag on a phone.

/** How far the finger must travel before the gesture commits to anything (§6.4's "~10 px slop"). Under it,
 *  a release is a TAP: the promo slide's click action runs. */
export const SLIDE_SLOP_PX = 10;

/** The snap-back / advance transition. The prototype's own `.banner-track` value (theme.css:25). */
export const SNAP_MS = 620;

/** The auto-advance cadence — the prototype's `setInterval(…, 5200)` (theme.js:13), run here as a ONE-SHOT
 *  timeout that any slide change or gesture restarts in full (§6.4's timer matrix: one consistent rule, no
 *  stored remainders). */
export const AUTOPLAY_MS = 5200;

/** Past the first/last slide there is nothing to drag to, so the strip follows the finger at this fraction —
 *  the standard rubber-band cue that the end of the set has been reached. */
export const EDGE_RESISTANCE = 0.35;

/** How much of the banner's width a drag must cover to ADVANCE rather than snap back. */
export const ADVANCE_FRACTION = 0.22;

/** Above this many slides the dot rail becomes a `3 / 12` counter flanked by Previous/Next (§6.4). A bound
 *  the owner's ~5-host fleet will not hit — ruled so the design has one. */
export const MAX_DOTS = 8;

/** The fixed hero slide's key. Slide identity is a KEY, never an index (Codex R4-4), and the hero's is the
 *  one key that is not a host id — it has no data dependency, so it survives every reconciliation. */
export const HERO_KEY = "hero";

export type CarouselPhase = "idle" | "pending" | "drag";

export interface CarouselState {
  phase: CarouselPhase;
  /** The pointer being tracked. `null` in `idle`; a move/up from any OTHER pointer is ignored. */
  pointerId: number | null;
  /** Where `dx` is measured from. Re-based at the direction lock so the strip starts exactly under the
   *  finger instead of jumping by the slop it just consumed. */
  originX: number;
  /** The down point's Y — the direction lock's other axis. */
  startY: number;
  /** The strip's live horizontal offset in px, edge-resisted. Zero unless dragging. */
  dx: number;
  /** True once a real drag happened. The component copies it into a ref on release, and `onClickCapture`
   *  reads that ref to swallow the click the browser fires after the pointer sequence (§6.4). */
  moved: boolean;
}

export const CAROUSEL_IDLE: CarouselState = {
  phase: "idle",
  pointerId: null,
  originX: 0,
  startY: 0,
  dx: 0,
  moved: false,
};

/** Geometry the machine needs but does not own: the banner's width and where the strip currently sits.
 *  Passed per event rather than held in state so a resize mid-gesture can never be stale. */
interface Geometry {
  width: number;
  /** The active slide's position in the CURRENT slide set. */
  index: number;
  count: number;
}

export type CarouselEvent =
  | { type: "down"; pointerId: number; primary: boolean; x: number; y: number }
  | ({ type: "move"; pointerId: number; x: number; y: number } & Geometry)
  | ({ type: "up"; pointerId: number } & Geometry)
  | { type: "cancel" };

export type CarouselEffect =
  /** Nothing for the component to do beyond rendering the new state. */
  | { kind: "none" }
  /** Horizontal intent: capture the pointer (so the gesture survives leaving the element) and stop the
   *  strip's transition — from here the strip follows the finger. */
  | { kind: "capture" }
  /** The gesture ended without choosing a slide (vertical intent, cancel, a second finger). Return to
   *  `idle` and ease the strip back onto the CURRENT slide; the autoplay timer restarts in full. */
  | { kind: "abort" }
  /** An under-slop release — the slide's click action may run. The timer restarts in full. */
  | { kind: "tap" }
  /** A completed drag: ease to this slide (which may be the one we started on). */
  | { kind: "settle"; index: number };

export interface CarouselReduced {
  state: CarouselState;
  effect: CarouselEffect;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** The strip's offset, damped at the ends of the set. */
function resist(dx: number, { index, count }: Geometry): number {
  const atStart = index <= 0 && dx > 0;
  const atEnd = index >= count - 1 && dx < 0;
  return atStart || atEnd ? dx * EDGE_RESISTANCE : dx;
}

/** Which slide a released drag lands on: the neighbour in the drag's direction once it has covered
 *  `ADVANCE_FRACTION` of the banner, else back where it started. Clamped — the set does not wrap under the
 *  finger (only autoplay and the Prev/Next buttons wrap). */
export function settleIndex(dx: number, { width, index, count }: Geometry): number {
  const step = Math.abs(dx) > Math.max(1, width) * ADVANCE_FRACTION ? (dx < 0 ? 1 : -1) : 0;
  return clamp(index + step, 0, Math.max(0, count - 1));
}

/** The machine. Total over (state, event): every pair has an answer, and every answer that leaves a gesture
 *  lands in `CAROUSEL_IDLE` — there is no path that parks in `pending`/`drag` with no pointer. */
export function carouselReduce(s: CarouselState, e: CarouselEvent): CarouselReduced {
  switch (e.type) {
    case "down": {
      // A SECOND pointer (or a non-primary button) arriving mid-gesture resolves the gesture rather than
      // joining it: two fingers on a carousel is not a two-finger gesture, it is an accident, and §6.4 wants
      // it to end in `idle` with the strip snapped rather than tracking whichever finger moves first.
      if (s.phase !== "idle") return { state: CAROUSEL_IDLE, effect: { kind: "abort" } };
      if (!e.primary) return { state: s, effect: { kind: "none" } };
      return {
        state: {
          phase: "pending",
          pointerId: e.pointerId,
          originX: e.x,
          startY: e.y,
          dx: 0,
          moved: false,
        },
        effect: { kind: "none" },
      };
    }
    case "move": {
      if (s.phase === "idle" || e.pointerId !== s.pointerId)
        return { state: s, effect: { kind: "none" } };
      const dx = e.x - s.originX;
      const dy = e.y - s.startY;
      if (s.phase === "pending") {
        // Still inside the slop in BOTH axes → the gesture has not declared itself yet.
        if (Math.abs(dx) < SLIDE_SLOP_PX && Math.abs(dy) < SLIDE_SLOP_PX) {
          return { state: s, effect: { kind: "none" } };
        }
        // Vertical intent aborts CLEANLY — no capture, no preventDefault, so `touch-action: pan-y` keeps the
        // page scrolling natively. Ties count as vertical: scrolling the page is the safer default on a
        // phone, and the diagonal that loses here is one the user can repeat.
        if (Math.abs(dx) <= Math.abs(dy))
          return { state: CAROUSEL_IDLE, effect: { kind: "abort" } };
        // Horizontal lock. Re-base the origin so the strip starts at 0 rather than jumping by the slop.
        return {
          state: { ...s, phase: "drag", originX: e.x, dx: 0, moved: true },
          effect: { kind: "capture" },
        };
      }
      return { state: { ...s, dx: resist(dx, e) }, effect: { kind: "none" } };
    }
    case "up": {
      if (s.phase === "idle" || e.pointerId !== s.pointerId)
        return { state: s, effect: { kind: "none" } };
      if (s.phase === "pending") return { state: CAROUSEL_IDLE, effect: { kind: "tap" } };
      return { state: CAROUSEL_IDLE, effect: { kind: "settle", index: settleIndex(s.dx, e) } };
    }
    case "cancel":
      // `pointercancel`, lost capture, and unmount all land here.
      if (s.phase === "idle") return { state: s, effect: { kind: "none" } };
      return { state: CAROUSEL_IDLE, effect: { kind: "abort" } };
  }
}

/** Reconcile the ACTIVE slide across a membership change (Codex R4-4).
 *
 *  Membership changes are buffered while a gesture or snap is in flight and applied between interactions, so
 *  this is the one place that decides where the active slide lands. It keys on identity, never position: if
 *  the active key survived, it stays active even though its INDEX may have moved. If its host vanished, land
 *  on the nearest surviving neighbour — forward first, because the slides after a removed one shift into its
 *  place, so the forward neighbour is the one now occupying the position the user was looking at. Failing
 *  everything, the hero, which is always present. */
export function reconcileActive(prevKeys: string[], nextKeys: string[], activeKey: string): string {
  if (nextKeys.includes(activeKey)) return activeKey;
  const survives = (k: string | undefined): k is string => k !== undefined && nextKeys.includes(k);
  const at = prevKeys.indexOf(activeKey);
  if (at >= 0) {
    for (let d = 1; d < prevKeys.length; d++) {
      if (survives(prevKeys[at + d])) return prevKeys[at + d];
      if (survives(prevKeys[at - d])) return prevKeys[at - d];
    }
  }
  return nextKeys[0] ?? HERO_KEY;
}
