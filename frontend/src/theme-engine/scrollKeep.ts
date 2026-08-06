// Scroll-keep across a theme-Root remount (Gate B owner finding, 2026-07-15). A theme pick swaps the
// whole Root (App keys the fault boundary on the theme id), so the content scroller is destroyed with
// its position — switching skins from a scrolled Conf jumped back to the top on every pick. This is the
// `store/groupScroll` one-hop-handoff pattern minus the reactivity (both ends are effects, nothing
// subscribes): the OLD Root's unmount saves its scroller position into a module slot; the NEW Root's
// mount consumes + restores it. Both run inside `switchTheme`'s flushSync commit (layout phase), so the
// View-Transition snapshot already captures the restored position — no post-fade jump.
//
// Section switches WITHIN a theme are a different mechanism, and it lives in DefaultRoot: a per-section
// position map restores each section to where it was left (2026-08-06). This hook stays the THEME-switch
// half — it carries the ACTIVE section's position across a Root remount, which the per-section map cannot,
// because the map dies with the Root it belongs to. The one interaction is the ref returned here: the
// Root's restore effect skips exactly the one run that follows a restore, so it does not overwrite a
// position that is already correct in the DOM with an empty map's 0.

import { useLayoutEffect, useRef, type RefObject } from "react";

let kept: number | null = null;

/** Keep `ref`'s scrollTop across a Root remount: restore a pending saved position on mount (layout
 *  phase, so the View-Transition snapshot sees it) and save the live position on unmount. Returns a ref
 *  that is `true` for the ONE run of the caller's section-POSITIONING effect right after a restore — the
 *  caller consumes (clears) it to skip re-positioning for that run only (the DOM already holds the carried
 *  position; a theme switch is not a section switch). */
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
