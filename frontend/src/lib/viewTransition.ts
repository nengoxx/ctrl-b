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
  skipTransition?: () => void;
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
/** The most recent transition this wrapper started. Held so a caller superseding one with a PLAIN update
 *  (no new transition to auto-skip it) can end it explicitly — otherwise it would capture whatever DOM the
 *  plain update just committed as its "new" state and animate toward it (Codex M3-confirm M1). Cleared when
 *  it settles, so `skipActiveViewTransition` can never reach a finished transition (or hold its handle). */
let activeTransition: ViewTransitionLike | null = null;
/** …and its KIND — the same `type` the stamp rides. `undefined` = the unstamped default kind (a theme
 *  swap), which by construction belongs to no named owner. */
let activeType: string | undefined;

/** End the active transition — but ONLY if it is one of the KINDS the caller names, i.e. one the caller
 *  itself starts. That scope is the whole point (G4 S1, the §10.1 VT-probe finding): an unscoped skip let
 *  any caller end ANY running transition, and gacha's fleet body did exactly that — its tab-leave teardown
 *  killed the `tab` navigation transition started microseconds earlier in the same commit, every time.
 *  Ownership by TYPE rather than by handle, because `type` is the identity concept this module already has
 *  (`stampOwner` guards the attribute with the same discipline) and the kinds are disjoint by construction:
 *  the nav chokepoint starts `tab`, gacha's fleet starts `detail`/`showcase`, a theme swap is untyped.
 *
 *  Safe always: skipping a settled transition would be a spec no-op anyway, and a skipped transition's
 *  update callback is still guaranteed to have run, so state stays correct either way. */
export function skipActiveViewTransition(...types: string[]): void {
  if (activeType === undefined || !types.includes(activeType)) return;
  activeTransition?.skipTransition?.();
}

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
  activeTransition = t;
  activeType = type;
  // Swallow BOTH legs. `ready` rejects on the skip/TimeoutError path; `finished` rejects too when the
  // transition is skipped or aborted — the original block only caught `ready`, so a skipped transition
  // surfaced an unhandled rejection. Neither is a correctness signal: the callback has already run, so the
  // DOM is applied either way (never gate state on `finished`).
  t.ready.catch(() => {});
  const clear = () => {
    // Let go of the handle the moment this transition is over — identity-guarded, because a NEWER
    // transition may already have taken the slot (this one was the skipped loser).
    if (activeTransition === t) {
      activeTransition = null;
      activeType = undefined;
    }
    if (token === null || stampOwner !== token) return; // untyped, or a newer transition owns the stamp
    stampOwner = null;
    delete root.dataset.transition;
  };
  void t.finished.then(clear, clear); // `.then(f, f)`, not `.finally(f)`: finally RE-THROWS the rejection
}

// ── THE NAVIGATION-TRANSITION DECORATOR (M2 — D52 / GACHA_PLAN §10.1) ───────────────────────────────
// The G0 spike that stood here is over: its device question — does `::view-transition-new(root)` render
// LIVE, so a reel keeps sweeping through a root View Transition rather than freezing behind a snapshot? —
// was settled for Gecko in the affirmative (outcome (a), 2026-08-04), so M2 ships and the flag is gone.
// This is now the real, unflagged decorator, at the same chokepoint the spike was deliberately shaped to
// fit: `useSections.navigate`'s `setUI({ tab })`.
//
// It stays GACHA-GATED, and that is a design statement rather than caution: a root cross-fade is a piece
// of the arcade's tab CHOREOGRAPHY — the thing the reel's slats sweep over — not a kit-wide navigation
// behaviour. cosmos/frontier/vapor/minimal have their own section entrances and get a plain `setUI`,
// byte-identical to the direct call this replaced. The theme read is the store's, not a prop, because the
// chokepoint is a shared hook that must not grow a per-theme parameter for one theme's flourish.
//
// The `tab` STAMP is the whole interface to CSS: `html[data-transition="tab"]` for the flight, which
// gacha.css scopes its `::view-transition-old/new(root)` keyframes to (the M2 block). It rides an
// attribute rather than `startViewTransition({types})` because 144 devices exist (§10.1) — the ruling
// stands even though Gecko 147 shipped types.
//
// Reduced motion and engines without View Transitions need nothing here: `runViewTransition` applies the
// update instantly on both paths, so navigation is never gated on an animation.

/** Apply a NAVIGATION update — inside a root View Transition under gacha (M2), plainly everywhere else. */
export function runNavTransition(update: () => void): void {
  if (getUI().theme !== "gacha") {
    update();
    return;
  }
  runViewTransition(update, "tab");
}
