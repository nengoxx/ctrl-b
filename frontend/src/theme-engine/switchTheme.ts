// Theme-switch path with the View Transitions API (Phase 11 / D28 §9.12) — BUILT DAY 1.
//
// Same-document View Transitions is Baseline 2025 (covers the owner's modern Android+desktop);
// progressive-enhancement (no support OR reduced-motion → instant swap). The stable `flushSync` form
// (NOT React's experimental <ViewTransition>): the lazy CSS/font load happens BEFORE
// startViewTransition (the page is frozen during the callback — network work inside it risks the ~4s
// skip); flushSync forces React's commit INSIDE the snapshot window (without it the old DOM is
// captured as both before+after → no animation); gated on the app's `ui.motion` flag (not the OS
// media query — CLAUDE.md) so the cross-fade can't leak under reduced-motion; no view-transition-names
// (a theme swap is a whole-page cross-fade — naming elements only adds cost + a duplicate-name skip).
//
// NOTE: vapor, minimal, and cosmos are registered + selectable, so this path IS live — picking a
// different skin in Conf runs the cross-fade. The Conf picker still guards re-picking the SAME skin
// (no-op). The lazy Roots render synchronously once preloaded (`preloadableRoot`), so the flushSync
// below captures the real new theme, not a Suspense fallback. Within-theme accent/mode changes are
// instant `setUI` (not a skin switch → no cross-fade).

import { flushSync } from "react-dom";

import { stableStringify } from "../lib/stableStringify";
import { getUI, setUI, type Motion, type Perf, type ThemeSettingsMap } from "../store/ui";
import { pushToast } from "../store/toast";
import { registry } from "./registry";
import type { Mode, ThemeId } from "./types";

// Minimal structural type so this compiles regardless of the TS DOM lib version (the API may not be in
// older lib.dom.d.ts). Compatible with the real typing where present.
interface ViewTransitionLike {
  ready: Promise<void>;
}
type VTDocument = Document & {
  startViewTransition?: (cb: () => void) => ViewTransitionLike;
};

// Cache the per-theme load promise so a CSS/font bundle is fetched+activated at most once.
const loaded = new Map<ThemeId, Promise<void>>();

/** Ensure the theme's CSS bundle + fonts are loaded & applied. vapor is always-loaded (layer frozen)
 *  + index.html fonts → resolves immediately. Must complete BEFORE the flushSync so the snapshot
 *  captures the styled frame (§9.12). */
export function ensureThemeLoaded(id: ThemeId): Promise<void> {
  let p = loaded.get(id);
  if (!p) {
    const def = registry[id];
    p = Promise.all([
      def?.loadStyles() ?? Promise.resolve(),
      def?.loadFonts?.() ?? Promise.resolve(),
      // Preload the Root component chunk too (lazy themes), so the `lazy(Root)` resolves inside the flushSync
      // with no Suspense flash during the View-Transition snapshot. Eager themes (vapor) omit loadRoot.
      def?.loadRoot?.() ?? Promise.resolve(),
    ]).then(() => undefined);
    // Eviction on rejection (§14.15.1 ③): a rejected promise cached forever poisons that theme for the whole
    // session — one transient network blip and the theme never loads again. Attach the eviction as a SIDE
    // CHANNEL (not folded into the returned chain) so the ORIGINAL `p` is what we cache + return: in-flight
    // dedupe still shares one promise and `switchTheme`'s try/catch still observes the rejection. Guard
    // `loaded.get(id) === p` so a newer attempt already stored isn't clobbered. This is a DELIBERATE
    // divergence from React.lazy's permanent rejection cache (react#14254, filed-never-fixed) — we evict so
    // the next explicit switch re-imports. NOTE: the browser module map may still cache the failed FETCH
    // (whatwg/html#10327 — open, unshipped), so eviction is necessary-not-always-sufficient; item ②'s Reload
    // is the backstop; when #10327 ships this becomes fully self-healing with no code change here.
    const created = p;
    created.catch(() => {
      if (loaded.get(id) === created) loaded.delete(id);
    });
    loaded.set(id, created);
  }
  return p;
}

export interface SwitchTarget {
  mode: Mode;
  accent: string;
  // Optional global/per-theme fields applied atomically with the skin flip — only the cross-device
  // reconcile passes these (when another device changed the whole appearance). A normal in-app pick
  // (Conf) omits them so switching skin never resets motion/perf/themeSettings. (M3 §14.3.)
  motion?: Motion;
  perf?: Perf;
  themeSettings?: ThemeSettingsMap;
}

// In-flight guard state (§14.15.1 ⑤ — one chokepoint, replaces the planned `useIsMutating` gate).
//  • `latest` — a per-call identity token. The last call to arrive wins (last-write-wins): after its
//    await, an older call whose token has been superseded BAILS, so at most one transition applies. Left
//    un-cleared after a call completes — it's identity-based, so a stale value is harmless (the next call
//    mints a fresh token and becomes `latest`).
//  • `inFlight` — the currently-running switch, keyed by the FULL target (§14.15.1 ⑤: not just the id, so
//    the winning call applies the right mode/accent). A call with the SAME key joins it (one load, one VT).
let latest: object | null = null;
let inFlight: { key: string; done: Promise<void> } | null = null;

/** The actual switch: load the bundle, bail if superseded, else commit inside a View Transition. Never
 *  rejects — a load failure toasts + returns (so the `finally` in `switchTheme` always clears `inFlight`,
 *  keeping a failed target retryable; pairs with ③'s cache eviction — the two are one mechanism). */
async function runSwitch(next: ThemeId, target: SwitchTarget, token: object): Promise<void> {
  try {
    await ensureThemeLoaded(next); // SLOW WORK FIRST — never inside the transition callback
  } catch {
    pushToast("theme failed to load", "err");
    return; // stay on the current theme
  }
  // Superseded while the bundle loaded? A newer `switchTheme` (a DIFFERENT target) has taken over → bail so
  // only the WINNING call applies its full target. This supersede — not the same-key dedupe below — is what
  // collapses the reconcile double-VT (pick + reconcile targets differ in the motion trio), out-of-order
  // cold loads, and StrictMode double-effects into ONE applied transition.
  if (latest !== token) return;

  const apply = () =>
    flushSync(() =>
      setUI({
        theme: next,
        mode: target.mode,
        accent: target.accent,
        ...(target.motion !== undefined && { motion: target.motion }),
        ...(target.perf !== undefined && { perf: target.perf }),
        ...(target.themeSettings !== undefined && { themeSettings: target.themeSettings }),
      }),
    );

  const doc = document as VTDocument;
  const start = doc.startViewTransition?.bind(doc);
  if (getUI().motion === "reduced" || !start) {
    apply(); // reduced-motion or unsupported → instant swap
    return;
  }
  const t = start(apply);
  t.ready.catch(() => {}); // swallow the skip/TimeoutError (the DOM is already applied)
}

/** Switch the active SKIN with a cross-fade. Loads the theme bundle first, then commits the `ui` change
 *  inside a View Transition (gated on `ui.motion` + feature detection). On load failure it toasts and
 *  stays on the current theme. Module-level guard (§14.15.1 ⑤): identical in-flight targets are DEDUPED
 *  (one load, one VT); a superseding call (different target) wins via the monotonic `latest` token, and
 *  the loser bails after its await so at most ONE transition applies. `inFlight` clears in a `finally`
 *  (success AND failure) so a failed target is immediately retryable — the retry re-invokes ③'s evicted
 *  loader. */
export function switchTheme(next: ThemeId, target: SwitchTarget): Promise<void> {
  // Dedupe key: theme id + the full normalized target. `stableStringify` makes the `themeSettings` part
  // key-order-insensitive (top-level field order is irrelevant — it sorts keys), so two calls carrying the
  // same target produce the same key and share one load + one View Transition.
  const key = stableStringify({
    next,
    mode: target.mode,
    accent: target.accent,
    motion: target.motion,
    perf: target.perf,
    themeSettings: target.themeSettings,
  });
  if (inFlight && inFlight.key === key) return inFlight.done; // same target already running → join it

  const token = {};
  latest = token; // a different-key call arriving later supersedes this one via the token
  const done = runSwitch(next, target, token);
  const entry = { key, done };
  inFlight = entry;
  // Clear the marker on settle — success AND failure. Without this a failed target would stay deduped
  // forever and strand ③'s eviction (③ + ⑤ are one mechanism). Only clear if it's still OUR entry: a newer
  // different-key call may have already replaced `inFlight`.
  void done.finally(() => {
    if (inFlight === entry) inFlight = null;
  });
  return done;
}
