import { useCallback, useEffect, useRef } from "react";

// The Android BACK gesture over an overlay (MEDIA_MANAGER_PLAN §6.2, Opus H4 + Emma #5, made a STACK
// by her S2 review #5).
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
// `onClose`. Exactly one entry exists per open overlay, and exactly one is consumed closing it.
//
// **A STACK, WITH IDENTITY** (her S2 review #5). Overlays nest — the gallery opens a delete confirm
// over itself — and a `popstate` fires on EVERY listener, so a guard that only asked "did a pop
// happen?" had the outer overlay closing under the inner one: Back would take the gallery away and
// leave its alert dialog on screen with the trigger it captured already gone. A pop consumes exactly
// ONE entry, and it is always the innermost overlay's, so only the owner of the TOP entry may close.
// The stack is module-level because it is a property of the DOCUMENT's history, not of any component:
// two guards in two trees still share one back button.

/** The marker this hook writes into its own history entries. Read by nothing — a `popstate` fires for
 *  whichever entry is being restored, not for ours — but a labelled entry is what makes the mechanism
 *  legible in a devtools session, and it keeps the state object from being `null` (which some engines
 *  treat as "no state at all"). */
const OVERLAY_STATE = { ctrlbOverlay: true } as const;

/** One guarded overlay's entry on the history stack. */
interface OverlayEntry {
  id: number;
  /** Close it — the hook's own `onClose`, plus forgetting the entry. */
  close: () => void;
}

/** The guarded overlays with an entry on the history stack, outermost FIRST. */
const stack: OverlayEntry[] = [];
let nextId = 1;
/** Entries a cleanup is spending itself: the pops they produce are ours and close nothing. A COUNTER,
 *  not a flag with a timer — `history.back()` delivers its pop on a task we do not schedule, so
 *  "release the swallow after the next tick" is a race, and one that only shows up when a SECOND guard
 *  is listening (it then reads itself as the top and closes for nothing). One pop, one decrement. */
let unwinding = 0;

/** The ONE `popstate` listener the whole stack shares.
 *
 *  One listener rather than one per guard, because a pop is delivered to EVERY listener while it
 *  consumes exactly ONE entry: with a listener each, "was that pop mine?" has to be answered N times
 *  from shared state, and every bookkeeping flag becomes N-way. Here the question is asked once. */
function onPop(): void {
  if (unwinding > 0) {
    unwinding--;
    return;
  }
  stack.pop()?.close();
}

let listening = false;
function listen(): void {
  if (listening) return;
  window.addEventListener("popstate", onPop);
  listening = true;
}

/** Guard `open`, returning the ONE close primitive the UI may call. It answers whether THIS call took
 *  the exit — see `closing` below; a caller that records something about the way it closed (which
 *  answer a confirm is resolving with) must only record it when the answer is `true`.
 *
 *  `onClose` is read through a ref, so a handler recreated every render (the ordinary case for a
 *  closure over component state) never re-pushes the history entry. */
export function useOverlayBackGuard(open: boolean, onClose: () => void): () => boolean {
  const onCloseRef = useRef(onClose);
  // Written in an effect rather than during render (the React-Compiler rule the repo lints for): the
  // only reader is a `popstate` handler, which cannot fire before this commit anyway.
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  /** Our entry's id while it is on the stack, else `null`. */
  const mine = useRef<number | null>(null);
  /** A close is already IN FLIGHT — `history.back()` was asked for and its pop has not landed yet.
   *
   *  `close()` is idempotent across that window (Emma's S2 confirm round, the ConfirmDialog race). The
   *  overlay stays mounted until the pop, so a second gesture in it — a double-tapped ✕, Escape after
   *  Enter — used to spend a SECOND history entry: the first pop closed the overlay and the second was
   *  a real navigation out of the app. The first exit wins; the rest are no-ops. */
  const closing = useRef(false);

  useEffect(() => {
    if (!open || typeof history === "undefined") return;
    const id = nextId++;
    mine.current = id;
    closing.current = false;
    // The TOP entry is the only one a pop can reach, which is what lets a confirm close over a gallery
    // that stays open behind it — and what makes the next Back close that gallery.
    stack.push({
      id,
      close: () => {
        mine.current = null;
        closing.current = false;
        onCloseRef.current();
      },
    });
    listen();
    history.pushState({ ...OVERLAY_STATE, id }, "");
    return () => {
      const at = stack.findIndex((e) => e.id === id);
      if (at < 0) return; // already spent by a pop
      stack.splice(at, 1);
      mine.current = null;
      closing.current = false;
      // Unmounted (or `open` flipped) without the pop having happened — a parent removed us, a tab
      // switched. Our entry is still the one the browser is sitting on, and would otherwise be spent
      // on nothing, so consume it — and swallow the pop it delivers: whatever set `open` false already
      // did the closing, and without the swallow that pop would fall to the guard beneath us.
      //
      // An entry that is no longer the top cannot be reclaimed: the history API can only step, not
      // splice. It is left where it is, which costs one extra Back press — and it takes an overlay
      // unmounting UNDER an overlay that is still open to produce, which no flow here does.
      if (at !== stack.length) return;
      unwinding++;
      history.back();
    };
  }, [open]);

  // `history.back()` is the whole of it: the popstate handler above is what actually closes, so there
  // is exactly one path out and no way to leave an entry behind. Without an entry of our own (the
  // guard is disabled, or the environment has no history) close directly rather than stealing the
  // caller's real back.
  //
  // Returns whether THIS call is the one taking the exit — `false` means a close is already in flight
  // and the caller's gesture came too late to decide anything.
  return useCallback((): boolean => {
    if (closing.current) return false;
    if (mine.current !== null) {
      closing.current = true;
      history.back();
    } else {
      onCloseRef.current();
    }
    return true;
  }, []);
}
