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
// Those mechanics now live in the SHARED `lib/viewTransition.ts#runViewTransition` (D52 / GACHA_PLAN
// §10.1) — this module owns the switch POLICY (load, supersede, dirty-guard) and delegates the transition.
//
// NOTE: vapor, minimal, and cosmos are registered + selectable, so this path IS live — picking a
// different skin in Conf runs the cross-fade. The Conf picker still guards re-picking the SAME skin
// (no-op). The lazy Roots render synchronously once preloaded (`preloadableRoot`), so the flushSync
// below captures the real new theme, not a Suspense fallback. Within-theme accent/mode changes are
// instant `setUI` (not a skin switch → no cross-fade).

import { stableStringify } from "../lib/stableStringify";
import { runViewTransition } from "../lib/viewTransition";
import { setUI, type Motion, type Perf, type ThemeSettingsMap } from "../store/ui";
import { isAnyDirty } from "../store/dirty";
import { pushToast } from "../store/toast";
import { registry } from "./registry";
import type { Mode, ThemeId } from "./types";

// Cache the per-theme load promise so a CSS/font bundle is fetched+activated at most once.
const loaded = new Map<ThemeId, Promise<void>>();

/** Which of the three lazy legs of a theme load failed. Engine-internal — the ThemeDef contract is
 *  untouched (§14.15.1-A ④). */
export type ThemeLoadSource = "styles" | "fonts" | "root";

/** Tags an `ensureThemeLoaded` rejection with WHICH leg failed. `Promise.all` discards all but the first
 *  rejection reason and gives no hint of its origin, so each leg is wrapped to throw this before the
 *  aggregate settles. The severity of the failing leg drives the single user signal (§14.15.1-A ④+):
 *  ThemeProvider stays SILENT on `root` (fatal → item ②'s boundary owns the blocking signal) and toasts on
 *  `styles`/`fonts` (survivable → Kit base-token degrade). `cause` carries the original loader error
 *  (ES2022 `Error` cause; target ES2022, §tsconfig). */
export class ThemeLoadError extends Error {
  constructor(
    readonly source: ThemeLoadSource,
    cause: unknown,
  ) {
    super(`theme load failed: ${source}`, { cause });
    this.name = "ThemeLoadError";
  }
}

/** Ensure the theme's CSS bundle + fonts are loaded & applied. vapor is always-loaded — its three sheets
 *  are static `@import`s in `theme/index.css` at `layer(theme)` (the old `layer(frozen)` is long gone) and
 *  its fonts are a static `import` in main.tsx (never index.html) — so its `loadStyles` resolves
 *  immediately, permanently, by the D51 V6 measurement ruling. Must complete BEFORE the flushSync so the
 *  snapshot captures the styled frame (§9.12). */
export function ensureThemeLoaded(id: ThemeId): Promise<void> {
  let p = loaded.get(id);
  if (!p) {
    const def = registry[id];
    // Tag EACH leg's rejection with its source BEFORE the aggregate — `Promise.all` rejects with the raw,
    // origin-less reason of the first-failing leg, so wrapping here is what preserves WHICH leg died.
    p = Promise.all([
      (def?.loadStyles() ?? Promise.resolve()).catch((err: unknown) => {
        throw new ThemeLoadError("styles", err);
      }),
      (def?.loadFonts?.() ?? Promise.resolve()).catch((err: unknown) => {
        throw new ThemeLoadError("fonts", err);
      }),
      // Preload the Root component chunk too (lazy themes), so the `lazy(Root)` resolves inside the flushSync
      // with no Suspense flash during the View-Transition snapshot. Eager themes (vapor) omit loadRoot.
      (def?.loadRoot?.() ?? Promise.resolve()).catch((err: unknown) => {
        throw new ThemeLoadError("root", err);
      }),
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
  kitBackgroundVisible?: boolean;
  appbarSubtitleVisible?: boolean;
}

/** The outcome of a switch attempt, so a caller can persist the choice ONLY when it actually applied.
 *  A refused switch (dirty-at-supersede-point, load failure) must NOT be written to the server + query
 *  cache, or `useAppearance`'s reconcile re-applies it and other devices adopt it (Codex, review of the
 *  fix wave). `"superseded"` = a newer differing call took over — that winning call's own caller owns the
 *  persist, so a superseded loser persists nothing either. */
export type SwitchOutcome = "applied" | "refused-dirty" | "load-failed" | "superseded";

// In-flight guard state (§14.15.1 ⑤ — one chokepoint, replaces the planned `useIsMutating` gate).
//  • `latest` — a per-call identity token. The last call to arrive wins (last-write-wins): after its
//    await, an older call whose token has been superseded BAILS, so at most one transition applies. Left
//    un-cleared after a call completes — it's identity-based, so a stale value is harmless (the next call
//    mints a fresh token and becomes `latest`).
//  • `inFlight` — the currently-running switch, keyed by the FULL target (§14.15.1 ⑤: not just the id, so
//    the winning call applies the right mode/accent). A call with the SAME key joins it (one load, one VT).
let latest: object | null = null;
let inFlight: { key: string; done: Promise<SwitchOutcome> } | null = null;

/** The actual switch: load the bundle, bail if superseded, else commit inside a View Transition. Never
 *  rejects — a load failure toasts + returns (so the `finally` in `switchTheme` always clears `inFlight`,
 *  keeping a failed target retryable; pairs with ③'s cache eviction — the two are one mechanism). */
async function runSwitch(
  next: ThemeId,
  target: SwitchTarget,
  token: object,
): Promise<SwitchOutcome> {
  try {
    await ensureThemeLoaded(next); // SLOW WORK FIRST — never inside the transition callback
  } catch {
    // Toast ONLY as the winner (verification F1, 2026-07-10): the live pick→reconcile double-switch
    // shares ONE load promise via the `loaded` cache, so on failure BOTH calls land here — without the
    // gate the user gets two identical error toasts (the exact double-signal ④+ forbids). The single
    // signal belongs to the latest intent; superseded losers stay silent.
    if (latest === token) pushToast("theme failed to load", "err");
    return "load-failed"; // stay on the current theme
  }
  // Superseded while the bundle loaded? A newer `switchTheme` (a DIFFERENT target) has taken over → bail so
  // only the WINNING call applies its full target. This supersede — not the same-key dedupe below — is what
  // collapses the reconcile double-VT (pick + reconcile targets differ in the motion trio), out-of-order
  // cold loads, and StrictMode double-effects into ONE applied transition.
  if (latest !== token) return "superseded";
  // LAST LINE against destroying unsaved work, checked HERE because this is the moment the theme root
  // remounts and every mounted editor's draft dies with it. The callers check too, but they check
  // BEFORE the bundle load: with a cold bundle that window is long enough to start typing in, and the
  // edits begun inside it were destroyed (Codex, review of the fix wave — the TOCTOU its predecessors'
  // fixes left open). Guarding the action itself rather than each call site makes the invariant
  // structural: a theme switch never eats an unsaved draft, whoever asked for it.
  if (isAnyDirty()) {
    pushToast("Save or discard your unsaved changes before switching theme", "err");
    return "refused-dirty";
  }

  // The feature-detect + reduced-motion bypass + flushSync trio now lives in `lib/viewTransition.ts` (D52 —
  // one shared wrapper, so the gacha tab transition can't grow a second hand-rolled copy). No `type` is
  // passed: a theme swap is the UNSTAMPED default kind, exactly as this block behaved before the extraction.
  runViewTransition(() =>
    setUI({
      theme: next,
      mode: target.mode,
      accent: target.accent,
      ...(target.motion !== undefined && { motion: target.motion }),
      ...(target.perf !== undefined && { perf: target.perf }),
      ...(target.themeSettings !== undefined && { themeSettings: target.themeSettings }),
      ...(target.kitBackgroundVisible !== undefined && {
        kitBackgroundVisible: target.kitBackgroundVisible,
      }),
      ...(target.appbarSubtitleVisible !== undefined && {
        appbarSubtitleVisible: target.appbarSubtitleVisible,
      }),
    }),
  );
  return "applied";
}

/** Switch the active SKIN with a cross-fade. Loads the theme bundle first, then commits the `ui` change
 *  inside a View Transition (gated on `ui.motion` + feature detection). On load failure it toasts and
 *  stays on the current theme. Module-level guard (§14.15.1 ⑤): identical in-flight targets are DEDUPED
 *  (one load, one VT); a superseding call (different target) wins via the monotonic `latest` token, and
 *  the loser bails after its await so at most ONE transition applies. `inFlight` clears in a `finally`
 *  (success AND failure) so a failed target is immediately retryable — the retry re-invokes ③'s evicted
 *  loader. */
export function switchTheme(next: ThemeId, target: SwitchTarget): Promise<SwitchOutcome> {
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
    kitBackgroundVisible: target.kitBackgroundVisible,
    appbarSubtitleVisible: target.appbarSubtitleVisible,
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
