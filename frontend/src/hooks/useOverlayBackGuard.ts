import { useCallback, useEffect, useRef } from "react";

// The Android BACK gesture over a full-screen overlay (MEDIA_MANAGER_PLAN §6.2, Opus H4 + Emma #5).
//
// ctrl-b has no router and wants none (R59 §11.6 ①: a route + history stack is a navigation model we
// would then have to own). What it needs is the bounded half of one: while an overlay is open, the
// phone's Back gesture must CLOSE THE OVERLAY instead of leaving the app — the single most common way
// a PWA loses its user. That is one `pushState` on open plus one `popstate` listener.
//
// **ONE CLOSE PRIMITIVE** (Emma #5 — the orphan-entry regression). The tempting shape is "✕ sets
// open=false, and popstate also sets open=false", and it leaks: the ✕ path never pops the entry it
// pushed, so a session of open/close/open/close builds a pile of history entries and the owner has to
// press Back five times to leave the app. Here the UI's close (✕, Escape, a completed action) calls
// `close()`, which calls `history.back()`; the popstate handler is the ONLY thing that ever invokes
// `onClose`. Exactly one entry exists while the overlay is open, and exactly one is consumed closing it.
//
// Re-entry guarded (the same finding's other half): the effect pushes ONCE per open, and an unmount
// that happens while the entry is still ours pops it silently rather than leaving it behind for the
// next Back press to spend on nothing.

/** The marker this hook writes into its own history entries. Read by nothing — a `popstate` fires for
 *  whichever entry is being restored, not for ours — but a labelled entry is what makes the mechanism
 *  legible in a devtools session, and it keeps the state object from being `null` (which some engines
 *  treat as "no state at all"). */
const OVERLAY_STATE = { ctrlbOverlay: true } as const;

/** Guard `open`, returning the ONE close primitive the UI may call.
 *
 *  `onClose` is read through a ref, so a handler recreated every render (the ordinary case for a
 *  closure over component state) never re-pushes the history entry. */
export function useOverlayBackGuard(open: boolean, onClose: () => void): () => void {
  const onCloseRef = useRef(onClose);
  // Written in an effect rather than during render (the React-Compiler rule the repo lints for): the
  // only reader is a `popstate` handler, which cannot fire before this commit anyway.
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  /** Ours is on the stack right now. */
  const pushed = useRef(false);
  /** We asked for the pop ourselves (an unmount cleanup) — swallow the close it will deliver. */
  const unwinding = useRef(false);

  useEffect(() => {
    if (!open || typeof history === "undefined") return;
    history.pushState(OVERLAY_STATE, "");
    pushed.current = true;
    const onPop = () => {
      // Our entry is gone the moment this fires, whoever caused it: the owner's Back gesture, the
      // ✕ (through `close` below), or our own cleanup.
      pushed.current = false;
      if (!unwinding.current) onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Unmounted (or `open` flipped) without the pop having happened — a parent removed us, a tab
      // switched. The entry is still ours and would otherwise be spent on nothing, so consume it,
      // and swallow the close it triggers: whatever set `open` false already did the closing.
      if (pushed.current) {
        unwinding.current = true;
        pushed.current = false;
        history.back();
        // The pop lands on a later task; release the swallow after it, or the NEXT open would start
        // with its close disarmed.
        setTimeout(() => {
          unwinding.current = false;
        }, 0);
      }
    };
  }, [open]);

  return useCallback(() => {
    // `history.back()` is the whole of it: the popstate handler above is what actually closes, so
    // there is exactly one path out and no way to leave an entry behind. Without an entry of our own
    // (the guard is disabled, or the environment has no history) close directly rather than stealing
    // the caller's real back.
    if (pushed.current) history.back();
    else onCloseRef.current();
  }, []);
}
