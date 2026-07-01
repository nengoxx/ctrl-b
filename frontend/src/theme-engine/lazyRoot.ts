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
  // import fires at most once. A rejection is cached (parity with React.lazy) → propagates to ErrorBoundary.
  const preload = (): Promise<void> =>
    (pending ??= load().then((m) => {
      mod = m.default;
    }));
  const Root: ComponentType = (props) => {
    if (mod) return createElement(mod, props); // hot path: synchronous, no Suspense
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- Suspense contract: throw a Promise to suspend until the lazy chunk resolves (parity with React.lazy).
    throw preload(); // cold path: suspend until the chunk resolves
  };
  return { Root, preload };
}
