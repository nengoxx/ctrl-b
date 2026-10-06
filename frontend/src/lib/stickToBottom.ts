// Stick-to-bottom for a scroller that grows while the owner reads it (ISS-66, R102 §7) — ONE pure
// controller, two consumers: the chat thread on the shell's `#app-scroll` (`components/ChatThread.tsx`)
// and the call overlay's caption box (`theme-engine/kit/CallOverlay.tsx`). DOM-light on purpose: it reads
// and writes three numbers on whatever box it is handed, so it is tested without React or a layout engine.
//
// THE PATTERN (the field's, stated once in R102 §7): "stuck" is ONE latch, `escaped`, and the measuring
// side never decides it from position alone.
//   · growth / a shrinking pane → `pin()`: if not escaped, write the bottom (instant) and MARK the write;
//   · a scroll event → our own write's echo is ignored; a scroll that ENDS on the bottom never escapes;
//     otherwise DIRECTION decides, and direction = the distance to the bottom GROWING or SHRINKING since
//     the last sample (never `scrollTop`'s own change): growing past `escapePx` escapes, shrinking into
//     the `attachPx` band re-sticks. Native scroll ANCHORING (content inserted above the viewport — a
//     plan panel, an image loading — moves `scrollTop` by exactly the inserted height) preserves the
//     distance, so it changes nothing; read as a `scrollTop` delta it would look like a scroll DOWN and
//     falsely re-stick a reader parked inside the band (review round №1, E-MED2);
//   · a wheel turned up (desktop only — touch has no wheel) escapes at once, before the scroll lands;
//   · `stick()` = the deliberate re-stick (tab entry, a fresh user message, the ↓ pill's tap).
//
// THE TWO CLASSIC BUGS it exists to prevent:
//   1. a POSITION band swallowed by per-chunk pins — the old rule re-read "within 140 px of the bottom"
//      on every scroll event while a streamed reply pinned on every chunk, so a drag had to clear the
//      whole band between two chunks or be yanked back (SillyTavern #335 → #2546 → #4382, LibreChat's
//      "direction decides, not position", and us: ISS-66);
//   2. our OWN write's scroll event read as the user's — a programmatic `scrollTop` write fires a
//      `scroll` like any other, so an unmarked pin re-asserts "stuck" or, after a clamp, reads as a
//      move (use-stick-to-bottom's marked writes, LibreChat's baseline).
//
// THRESHOLDS — provenance: the asymmetric pair is LibreChat's (detach small / re-attach 150); the escape ε
// itself is SillyTavern's 5 px (a move that small is not yet "left" — ours is 4, see the constant); the
// marked write + read-back is use-stick-to-bottom's. The re-attach band is GENEROUS because the end recedes while
// a reply streams — a band as tight as the escape would be unreachable by a hand scrolling back down. A
// small box takes a smaller band (the overlay passes its own: 150 px is more than its whole height).
//
// THE WRITE CONTRACT: `pin()` assigns `scrollTop` and expects it to land INSTANTLY. Nothing in the app
// sets `scroll-behavior: smooth` on either consumer's box today (grep-verified at ISS-66); a theme that
// ever does would turn every pin into an animation restarted per chunk, and its intermediate scroll
// events into stale echoes — such a theme must leave these two boxes at `auto`.

/** An UP move must leave the bottom by more than this, in px, to escape. Small on purpose (SillyTavern's
 *  5): the ε only has to swallow sub-pixel rounding — the shrink clamp has its own rule — and anything
 *  larger re-creates the residual a slow drag under ε per streamed chunk never escapes (main seat, ISS-66). */
export const ESCAPE_PX = 4;
/** A DOWN move ending within this many px of the bottom re-sticks. */
export const ATTACH_PX = 150;

/** The three numbers the latch reads (an `HTMLElement` is one; a test's plain object is another). */
export interface ScrollBox {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export interface StickLatch {
  /** Feed every `scroll` event of the box. */
  onScroll(el: ScrollBox): void;
  /** Feed every `wheel` event's `deltaY` — desktop intent; `el` answers "is there anything above". */
  onWheel(deltaY: number, el: ScrollBox): void;
  /** Follow: write the bottom unless escaped. Returns whether it wrote. */
  pin(el: ScrollBox): boolean;
  /** Re-stick deliberately, then pin. */
  stick(el: ScrollBox): boolean;
  isEscaped(): boolean;
  /** Forget everything — a new box, or the same box after another owner has been scrolling it. */
  reset(): void;
}

export function createStickLatch(opts?: { escapePx?: number; attachPx?: number }): StickLatch {
  const escapePx = opts?.escapePx ?? ESCAPE_PX;
  const attachPx = opts?.attachPx ?? ATTACH_PX;
  let escaped = false;
  /** The previous sample's distance to the bottom — what "direction" is measured against (null = no
   *  sample yet: the first event has no direction). */
  let lastDist: number | null = null;
  /** Our own write, pending its scroll event (read BACK after the write: the browser clamps). A pin that
   *  moves nothing fires no event, so this can go stale; the next real scroll then mismatches and is
   *  taken as the user's — except a user move landing within ±1 px of it, which is swallowed as an echo.
   *  Accepted residual (review round №1): inside the escape ε, and only ever at the bottom. */
  let expectTop: number | null = null;

  const pin = (el: ScrollBox): boolean => {
    // A refused pin forgets the last distance ONLY when the distance SHRANK with no scroll event —
    // the keyboard closing, a block collapsing below the view, the composer shrinking — because a
    // distance measured against the old box would read the next UP drag as "closer" and re-stick
    // (confirm round №1, Opus N1 — reproduced). It is KEPT when the distance grew: that is the reply
    // streaming (the end receding), and a pin is refused before almost every scroll event of a fast
    // stream, so forgetting it there would leave every event directionless and the attach band inert
    // (confirm round №2, Opus R2-1). Anchoring (content inserted ABOVE) also reads as "grew" at the
    // pin and as "unchanged" at its own event — kept, then nothing changes: safe either way.
    if (escaped) {
      const d = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (lastDist !== null && d < lastDist) lastDist = null;
      return false;
    }
    el.scrollTop = el.scrollHeight;
    expectTop = el.scrollTop;
    lastDist = 0; // the write landed on the bottom (the read-back is the clamped maximum)
    return true;
  };

  return {
    onScroll(el) {
      const top = el.scrollTop;
      const dist = el.scrollHeight - top - el.clientHeight;
      const grew = dist - (lastDist ?? dist); // > 0: further from the end; < 0: closer
      lastDist = dist;
      // 1. our own write's echo never counts; a mismatch means a user scroll beat it — theirs, below.
      if (expectTop !== null) {
        const ours = Math.abs(top - expectTop) <= 1;
        expectTop = null;
        if (ours) return;
      }
      // 2. a scroll that ENDS on the bottom never escapes: the clamp after a shrink (the think block
      //    collapsing under the first text token), a fling running into the end.
      if (dist <= 1) {
        escaped = false;
        return;
      }
      // 3. direction decides, as the distance's change. Anchoring preserves `dist` → `grew === 0` →
      //    neither branch. (What a single distance cannot tell apart: content that grew BELOW between two
      //    samples without a pin in between reads as "further from the end". While stuck, every growth is
      //    pinned in the same task, so that window stays closed in practice.)
      if (grew > 0 && dist > escapePx) escaped = true;
      else if (grew < 0 && dist <= attachPx) escaped = false;
    },
    onWheel(deltaY, el) {
      if (deltaY < 0 && el.scrollTop > 0) escaped = true;
    },
    pin,
    stick(el) {
      escaped = false;
      return pin(el);
    },
    isEscaped: () => escaped,
    reset() {
      escaped = false;
      lastDist = null;
      expectTop = null;
    },
  };
}
