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
// NOTE (T0): only vapor is registered, and the Conf picker guards re-picking the same skin, so this
// path is effectively never invoked yet — it's built ready for T1+ (the day-1 directive). Within-theme
// accent/mode changes are instant `setUI` (not a skin switch → no cross-fade).

import { flushSync } from "react-dom";

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
    ]).then(() => undefined);
    loaded.set(id, p);
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

/** Switch the active SKIN with a cross-fade. Loads the theme bundle first, then commits the `ui`
 *  change inside a View Transition (gated on `ui.motion` + feature detection). On load failure it
 *  aborts and stays on the current theme. */
export async function switchTheme(next: ThemeId, target: SwitchTarget): Promise<void> {
  try {
    await ensureThemeLoaded(next); // SLOW WORK FIRST — never inside the transition callback
  } catch {
    pushToast("theme failed to load", "err");
    return; // stay on the current theme
  }

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
