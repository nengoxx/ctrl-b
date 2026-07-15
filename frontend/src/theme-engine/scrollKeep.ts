// Scroll-keep across a theme-Root remount (Gate B owner finding, 2026-07-15). A theme pick swaps the
// whole Root (App keys the fault boundary on the theme id), so the content scroller is destroyed with
// its position — switching skins from a scrolled Conf jumped back to the top on every pick. This is the
// `store/groupScroll` one-hop-handoff pattern minus the reactivity (both ends are effects, nothing
// subscribes): the OLD Root's unmount saves its scroller position into a module slot; the NEW Root's
// mount consumes + restores it. Both run inside `switchTheme`'s flushSync commit (layout phase), so the
// View-Transition snapshot already captures the restored position — no post-fade jump.
//
// Tab switches WITHIN a theme keep the deliberate reset-to-top: the Roots' reset effect skips exactly
// the one run that follows a restore, via the ref this hook returns.

import { useLayoutEffect, useRef, type RefObject } from "react";

let kept: number | null = null;

/** Keep `ref`'s scrollTop across a Root remount: restore a pending saved position on mount (layout
 *  phase, so the View-Transition snapshot sees it) and save the live position on unmount. Returns a ref
 *  that is `true` for the ONE run of the caller's scroll-reset effect right after a restore — the caller
 *  consumes (clears) it to skip its `scrollTo(0,0)` for that run only. */
export function useScrollKeep(ref: RefObject<HTMLElement | null>): RefObject<boolean> {
  const restored = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (kept !== null) {
      el.scrollTop = kept;
      kept = null;
      restored.current = true;
    }
    return () => {
      kept = el.scrollTop;
    };
  }, [ref]);
  return restored;
}
