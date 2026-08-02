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

/** The G0 spike's dev-only switch (see `runNavTransition`). localStorage, not a build flag, so the owner
 *  can A/B it on the phone against the SAME build. */
const NAV_VT_KEY = "ctrlb.spike.navVT";

// Minimal structural type so this compiles regardless of the TS DOM lib version (the API may not be in
// older lib.dom.d.ts). Compatible with the real typing where present.
interface ViewTransitionLike {
  ready: Promise<void>;
  finished: Promise<void>;
}
type VTDocument = Document & {
  startViewTransition?: (cb: () => void) => ViewTransitionLike;
};

// The identity of the transition that currently OWNS the `html[data-transition]` stamp (the hardening
// delta over the extracted block). Starting a second transition SKIPS the running one, and the skipped
// one's `finished` settles LATER — so an unguarded cleanup would delete the newer transition's stamp
// mid-flight, un-styling it. Whoever stamps last owns the attribute; an older owner's cleanup no-ops.
// Identity-based, so a stale value is harmless (the next stamp mints a fresh token).
let stampOwner: object | null = null;

/** Whether `runViewTransition` would ACTUALLY animate right now — the same two gates it applies (engine
 *  support + the app's motion flag), exported so a caller can prepare the DOM *for* a transition without
 *  re-deriving them. gacha's M3 needs it: mounting the dossier at rest (rather than sliding it up) is only
 *  correct when a morph is about to carry the entrance; on the instant path the sheet must keep its slide.
 *  One predicate, read by the wrapper itself, so the two can never disagree. */
export function viewTransitionsActive(): boolean {
  if (typeof document === "undefined") return false;
  return (
    getUI().motion !== "reduced" &&
    typeof (document as VTDocument).startViewTransition === "function"
  );
}

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
  if (!viewTransitionsActive() || !start) {
    apply(); // reduced-motion or unsupported → instant swap
    return;
  }
  const root = doc.documentElement;
  // Stamp BEFORE starting, so the pseudo-element rules keyed on `html[data-transition]` are already in
  // scope when the transition begins animating.
  let token: object | null = null;
  if (type !== undefined) {
    token = {};
    stampOwner = token;
    root.dataset.transition = type;
  }
  const t = start(apply);
  // Swallow BOTH legs. `ready` rejects on the skip/TimeoutError path; `finished` rejects too when the
  // transition is skipped or aborted — the original block only caught `ready`, so a skipped transition
  // surfaced an unhandled rejection. Neither is a correctness signal: the callback has already run, so the
  // DOM is applied either way (never gate state on `finished`).
  t.ready.catch(() => {});
  const clear = () => {
    if (token === null || stampOwner !== token) return; // untyped, or a newer transition owns the stamp
    stampOwner = null;
    delete root.dataset.transition;
  };
  void t.finished.then(clear, clear); // `.then(f, f)`, not `.finally(f)`: finally RE-THROWS the rejection
}

// ── ⚠ TEMPORARY — the G0 VIEW-TRANSITION SPIKE (D52 / GACHA_PLAN §10.1, risk #2) ────────────────────
// DELETE OR PROMOTE AT G4. This exists to answer the ONE question paper could not: does
// `::view-transition-new(root)` render LIVE on the owner's Fennec 144+? If it does, gacha's reel keeps
// animating during a root View Transition and M2 (the prototype's tab cross-fade/scale under the reel) is
// worth a real seam; if it does not, the reel freezes mid-sweep behind a static snapshot and M2 DIES
// without ceremony — the reel alone must carry the transition, which is the plan's standing posture.
//
// It is deliberately the SMALLEST possible intrusion on the shared nav chokepoint:
//   · DEFAULT OFF. With the flag unset this is `update()` — byte-identical to the direct `setUI` call it
//     replaced, for every theme, in every build.
//   · GACHA ONLY even when on. A root cross-fade on cosmos/frontier/vapor/minimal is not being spiked.
//   · localStorage-flagged, so the owner toggles it in the browser console on the phone and A/Bs the same
//     deployed build: `localStorage.setItem("ctrlb.spike.navVT", "1")` (and `removeItem` to go back).
// After the device round: either the flag and this function are deleted (M2 dies), or the wrapper becomes
// a real, unflagged navigation-transition decorator at this same chokepoint (M2 lives). Either way this
// block does not survive G4.
function navSpikeEnabled(): boolean {
  if (getUI().theme !== "gacha") return false;
  try {
    return localStorage.getItem(NAV_VT_KEY) === "1";
  } catch {
    return false; // private mode / disabled storage — the spike is simply off
  }
}

/** The nav chokepoint's transition wrapper. Off by default: applies `update` directly. */
export function runNavTransition(update: () => void): void {
  if (!navSpikeEnabled()) {
    update();
    return;
  }
  // `tab` stamps html[data-transition="tab"] so the theme can scope its root-VT keyframes to this kind.
  runViewTransition(update, "tab");
}
