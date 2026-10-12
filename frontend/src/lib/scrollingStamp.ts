// THE "SCROLLING NOW" STAMP (ISS-74; ISS-81 reuses it for the shell scroller) — the desktop half of the
// owner's scrollbar ruling (2026-10-10, recorded on ISS-81): on a fine pointer the bar is invisible at rest
// and shows only WHILE scrolling (and on hover, kit.css). CSS can see `:hover` but not "is scrolling", so
// this stamps `data-scrolling` on the scroller on every scroll and clears it after a short idle — the
// `.kit-quiet-scrollbar` rule (kit.css) keys its thumb colour off the stamp. On touch that rule hides the
// bar outright, so the stamp is inert there (no listener branch on pointer type: one code path).

/** Idle time (ms) after the last scroll event before the stamp clears and the bar goes quiet again. */
export const SCROLL_IDLE_MS = 700;

/** Stamp `data-scrolling` on `el` while it scrolls (a passive listener; the stamp clears `SCROLL_IDLE_MS`
 *  after the last scroll). Returns the teardown: it removes the listener, cancels the pending clear, and
 *  drops any stamp still on the element. */
export function attachScrollingStamp(el: HTMLElement): () => void {
  let idle: ReturnType<typeof setTimeout> | undefined;
  const onScroll = () => {
    el.dataset.scrolling = "true";
    clearTimeout(idle);
    idle = setTimeout(() => delete el.dataset.scrolling, SCROLL_IDLE_MS);
  };
  el.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    el.removeEventListener("scroll", onScroll);
    clearTimeout(idle);
    delete el.dataset.scrolling;
  };
}
