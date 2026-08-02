// The ONE View-Transition wrapper (D52 / GACHA_PLAN §10.1 — the committed shared-kit extraction).
//
// This is `switchTheme.ts`'s original inline block lifted verbatim into a reusable helper, so the theme
// switch and the gacha tab transition run the SAME code path instead of two hand-rolled wrappers (the
// "don't duplicate an existing pattern" rule). The three things it owns, unchanged from the original:
//
//   1. feature detection — `document.startViewTransition` is progressive enhancement, absent on older
//      Gecko; without it we apply the update instantly;
//   2. the reduced-motion bypass — gated on the APP's `ui.motion` flag (never the OS media query,
//      CLAUDE.md), so a cross-fade can't leak under reduced motion;
//   3. `flushSync(update)` — React commits INSIDE the snapshot window; without it the old DOM is
//      captured as both before AND after, and nothing animates.
//
// The one ADDITION over the original block is the optional `type` stamp: `html[data-transition="<type>"]`
// while the transition runs, so CSS can style one KIND of transition differently (the prototype's
// `PROTO.vt(update, 'detail')` idiom). It rides an attribute rather than the spec's
// `startViewTransition({types})` on purpose — Firefox 144 ships View Transitions WITHOUT view-transition-types
// (§9 external facts), so the attribute is the portable form.
//
// NOT here (deliberately): naming elements. A theme swap is a whole-page cross-fade, and a stray
// `view-transition-name` left on a node would make the NEXT transition skip on a duplicate-name error.

import { flushSync } from "react-dom";

import { getUI } from "../store/ui";

// Minimal structural type so this compiles regardless of the TS DOM lib version (the API may not be in
// older lib.dom.d.ts). Compatible with the real typing where present.
interface ViewTransitionLike {
  ready: Promise<void>;
  finished: Promise<void>;
}
type VTDocument = Document & {
  startViewTransition?: (cb: () => void) => ViewTransitionLike;
};

/** Apply `update` inside a View Transition when the browser supports one and motion is `full`; otherwise
 *  apply it instantly. Either way the update runs through `flushSync`, so React has committed by the time
 *  this returns. `type` (optional) stamps `html[data-transition]` for the duration so theme CSS can target
 *  that kind of transition; the attribute is removed when the transition settles.
 *
 *  Never rejects and never needs awaiting: a caller's correctness must not depend on the animation (a hidden
 *  page skips transitions entirely, and a second `startViewTransition` SKIPS the running one with an
 *  AbortError — the skipped callback has already run, so state stays correct either way). */
export function runViewTransition(update: () => void, type?: string): void {
  const doc = document as VTDocument;
  const start = doc.startViewTransition?.bind(doc);
  const apply = () => flushSync(update);
  if (getUI().motion === "reduced" || !start) {
    apply(); // reduced-motion or unsupported → instant swap
    return;
  }
  const root = doc.documentElement;
  if (type !== undefined) root.dataset.transition = type;
  const t = start(apply);
  t.ready.catch(() => {}); // swallow the skip/TimeoutError (the DOM is already applied)
  if (type !== undefined) {
    void t.finished.finally(() => {
      delete root.dataset.transition;
    });
  }
}
