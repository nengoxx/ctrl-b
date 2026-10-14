// A TAP THAT SURVIVES A FLING STOP (ISS-71). A button whose action rides `click` misses the tap that
// lands while its scroller is still coasting: Android Chrome spends that touch on stopping the fling —
// its tap-suppression (Chromium `components/input/tap_suppression_controller.h`) drops the GESTURE tap
// that would have become the `click` — so the first tap only stops the chat and a second one is needed.
// The pointer stream itself is not a gesture and still reaches the page, so the tap is taken from it:
// a `pointerup` from the pointer that went down here, inside the house tap slop, is the tap.
//
// What an ordinary tap still produces AFTER its release — Chrome's emulated `mousedown`/`mouseup` and the
// `click`, all hit-tested again at gesture time — is swallowed near the release point: the fast-button
// pattern (Google, "Creating Fast Buttons for Mobile Web Applications"), a capture-phase BUSTER on the
// document. It can't live on the button because the tap usually UNMOUNTS it (the ↓ pill leaves the
// moment the chat re-sticks), and the browser then delivers those events to whatever lay underneath —
// the `mousedown` would move focus (an `ask_user` input → the soft keyboard), the `click` would activate
// (a tool-confirm card's `exec`). Opus review №1 MED-1 caught the `mousedown` half.
//
// The buster holds its WHOLE window, deliberately — NOT disarmed by the next pointerdown, unlike
// `CallOverlay`'s tap-away guard: after a fling stop no click ever comes, and an owner who learned to
// double-tap this pill must not have that second tap reach the confirm button now sitting under it
// (the main seat's ruling on the reviewers' split, session 77). It also outlives the hook's owner: the
// window self-cleans on its timer, so a consumer whose tap unmounts the HOOK keeps the guard too.
//
// A click with NO pointer session (Enter/Space on the focused button, an assistive-technology
// activation) is the keyboard door and runs the action; a click that a pointer session produced is
// consumed by the session — its release already answered it, tap or rejected drag (Sol review №1).

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import { SLOP_PX } from "../lib/gesture";

/** How long after a pointer tap the events near its release are swallowed, ms. A synthesized click
 *  follows the release within a frame or two; the window is longer ON PURPOSE — it also absorbs a
 *  habitual quick second tap on the same spot (the header's ruling). A slower deliberate tap passes. */
export const TAP_CLICK_BUST_MS = 400;
/** How far from the release a swallowed click may land, px (the click is hit-tested at the same point;
 *  a deliberate tap elsewhere inside the window is left alone). */
const BUST_RADIUS_PX = 24;

interface Down {
  id: number;
  x: number;
  y: number;
}

export interface PointerTapHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
  onClick: (e: ReactMouseEvent<HTMLElement>) => void;
}

export function usePointerTap(onTap: () => void): PointerTapHandlers {
  const down = useRef<Down | null>(null);
  /** A POINTER SESSION owns this element's next click: true from its `pointerdown` until that click
   *  arrives (consumed) or `TAP_CLICK_BUST_MS` after the release / cancel / a mouse leaving. */
  const session = useRef(false);
  const sessionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The live buster's teardown, if any — run when its window ends, or replaced by the next tap's. */
  const buster = useRef<(() => void) | null>(null);
  const tapRef = useRef(onTap);
  // Written in a LAYOUT effect, not during render (the React-Compiler rule the repo lints for — the
  // `useOverlayBackGuard` precedent) and not a passive one: no tap can land between the commit and
  // this write (Opus review №1 LOW-4).
  useLayoutEffect(() => {
    tapRef.current = onTap;
  });
  useEffect(() => () => clearTimeout(sessionTimer.current), []);

  /** The session ends a bounded while after its release — its click, if the browser makes one, comes
   *  within a frame or two. */
  const endSessionSoon = useCallback(() => {
    clearTimeout(sessionTimer.current);
    sessionTimer.current = setTimeout(() => {
      session.current = false;
    }, TAP_CLICK_BUST_MS);
  }, []);

  const armBuster = useCallback((x: number, y: number) => {
    buster.current?.();
    const near = (ev: MouseEvent) => Math.hypot(ev.clientX - x, ev.clientY - y) <= BUST_RADIUS_PX;
    const swallow = (ev: MouseEvent) => {
      if (!near(ev)) return;
      ev.preventDefault(); // a `mousedown`'s default is the focus move; a `click`'s is the activation
      ev.stopPropagation();
    };
    const types = ["mousedown", "mouseup", "click"] as const;
    for (const t of types) document.addEventListener(t, swallow, true);
    const teardown = () => {
      for (const t of types) document.removeEventListener(t, swallow, true);
      clearTimeout(timer);
      if (buster.current === teardown) buster.current = null;
    };
    const timer = setTimeout(teardown, TAP_CLICK_BUST_MS);
    buster.current = teardown;
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button > 0) return; // a secondary mouse button is not a tap
    down.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    session.current = true;
    clearTimeout(sessionTimer.current);
  }, []);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = down.current;
      if (!d || d.id !== e.pointerId) return; // not the pointer that went down here
      down.current = null;
      endSessionSoon();
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > SLOP_PX) return; // a swipe that began here
      armBuster(e.clientX, e.clientY);
      // The buster owns this tap's trailing events now, so the session has nothing left to guard —
      // closing it keeps a STILL-MOUNTED element's next keyboard activation live (Opus confirm N1).
      session.current = false;
      clearTimeout(sessionTimer.current);
      tapRef.current();
    },
    [armBuster, endSessionSoon],
  );

  /** The browser took the touch for a pan (or the pointer was lost): no tap. */
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (down.current?.id !== e.pointerId) return;
      down.current = null;
      endSessionSoon();
    },
    [endSessionSoon],
  );

  /** A MOUSE (and possibly a pen — Pointer Events guarantees implicit capture for TOUCH only; Opus
   *  confirm N2) has no implicit capture: pressed here and released elsewhere, its `pointerup` never comes
   *  back to this element — without this the stale down could pair with a later release, and the open
   *  session would eat the next keyboard activation (Opus review №1 LOW-5). Touch is captured implicitly, so
   *  its up/cancel always arrives here. */
  const onPointerLeave = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType === "touch" || down.current?.id !== e.pointerId) return;
      down.current = null;
      endSessionSoon();
    },
    [endSessionSoon],
  );

  /** THE KEYBOARD DOOR — see the header. */
  const onClick = useCallback(() => {
    if (session.current) {
      session.current = false;
      clearTimeout(sessionTimer.current);
      return;
    }
    tapRef.current();
  }, []);

  return { onPointerDown, onPointerUp, onPointerCancel, onPointerLeave, onClick };
}
