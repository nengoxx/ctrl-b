// A code-split theme Root that renders SYNCHRONOUSLY once its chunk is loaded — the fix for a one-tick
// flash on theme switch (audit, BE/FE efficiency pass). `React.lazy` always suspends for one microtask on
// its FIRST render, even when the chunk is already in the import cache: switchTheme commits the skin flip
// inside `flushSync`, so that microtask lands the blank Suspense fallback in the synchronously-committed
// frame → the View-Transition "after" snapshot captures null → a cross-fade flash (§9.12).
//
// switchTheme awaits `ensureThemeLoaded` (→ `loadRoot`/`preload`) BEFORE the flip, so by flip time the
// module is cached and `Root` renders the real component synchronously — no suspend, no flash. The COLD
// path (a non-default theme persisted at startup, rendered before any preload) still suspends via a thrown
// promise; the app-level `<Suspense fallback={null}>` covers it exactly as `React.lazy` did (§14.6).

import { createElement, type ComponentType } from "react";

/** Build a theme Root that is sync-once-loaded plus its `preload` (wire as the ThemeDef's `loadRoot`, so
 *  `ensureThemeLoaded` warms the chunk before the cross-fade). `load` is the dynamic import normalized to
 *  `{ default }` (matching the `React.lazy` factory shape it replaces). */
export function preloadableRoot(load: () => Promise<{ default: ComponentType }>): {
  Root: ComponentType;
  preload: () => Promise<void>;
} {
  let mod: ComponentType | null = null;
  let pending: Promise<void> | null = null;
  // `??=` so a stable promise is thrown across cold re-renders (Suspense dedupes on identity) and the
  // import fires at most once WHILE PENDING. On REJECTION we evict `pending` (§14.15.1-A ③+) — a
  // DELIBERATE divergence from React.lazy, whose `??=` caches rejections forever (react#14254, the
  // filed-never-fixed permanent-error cache), leaving Root chunks unretryable. This nearer cache is OURS,
  // so we reset it and the next explicit attempt (a fresh pick, or the boundary's Reset-as-pick) re-imports.
  // The eviction is a SIDE CHANNEL (not folded into the returned/thrown chain) and returns the ORIGINAL
  // promise, guarded `pending === p`: identity is stable while pending (Suspense contract) and the cold-path
  // `throw preload()` still propagates the SAME rejection to the ErrorBoundary. The browser module map may
  // still cache the failed FETCH (whatwg/html#10327 — open, unshipped) → item ②'s Reload is the backstop;
  // when #10327 ships, plain re-import self-heals with no code change here.
  const preload = (): Promise<void> => {
    const fresh = pending == null;
    pending ??= load().then((m) => {
      mod = m.default;
    });
    const p = pending;
    if (fresh) {
      p.catch(() => {
        if (pending === p) pending = null;
      });
    }
    return p;
  };
  const Root: ComponentType = (props) => {
    if (mod) return createElement(mod, props); // hot path: synchronous, no Suspense
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- Suspense contract: throw a Promise to suspend until the lazy chunk resolves (parity with React.lazy).
    throw preload(); // cold path: suspend until the chunk resolves
  };
  return { Root, preload };
}
