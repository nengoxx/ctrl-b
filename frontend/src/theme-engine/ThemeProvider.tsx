// ThemeProvider + useActiveRoot (Phase 11 v2 / D29 §14). The theme owns its whole presentation, so the
// engine exposes the active theme's `Root` (App renders it). `ThemeProvider` is the seam that will host
// the headless **feature-controller providers** in M2 (mounted ABOVE the theme Root so state survives a
// theme switch — the §14.5 invariant); for M0 it's a passthrough.
//
// Lazy CSS/fonts are loaded by the `switchTheme` path (switchTheme.ts) BEFORE the active theme flips,
// so the Root model needs no suspense here. Only vapor's CSS is eager (§14.6) — the cosmos DEFAULT
// (D51 V0) loads through the cold-load effect below, like any other lazy theme.

import { type ReactNode, useEffect } from "react";

import { useUISlice } from "../store/ui";
import { pushToast } from "../store/toast";
import { rootFor } from "./resolve";
import { ensureThemeLoaded, ThemeLoadError } from "./switchTheme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Ensure the ACTIVE theme's lazy CSS + fonts are loaded. `switchTheme` only loads on a user pick, so
  // without this a COLD LOAD (e.g. a returning minimal user, or ANY fresh boot since cosmos became the
  // default) would boot with `data-skin=<theme>` but no stylesheet → unstyled. Idempotent:
  // `ensureThemeLoaded` caches per theme, so the switchTheme path never double-loads; vapor (eager)
  // resolves to a no-op. The cold load costs one brief style-in (accepted — single user, PWA-cached,
  // §14.6). (M2 will also wrap `children` in the feature-controller providers here.)
  const theme = useUISlice((s) => s.theme);
  useEffect(() => {
    // Severity-keyed SINGLE signal on a cold-load failure (NN/g, §14.15.1-A ④+): raise exactly one
    // user-facing signal per failure, never two.
    //   • root → SILENT to the user (log only). The Root-chunk failure is FATAL: <ActiveRoot/>'s cold
    //     path re-attempts the (③-evicted) import and, on failure, throws to item ②'s ErrorBoundary,
    //     which owns the one blocking signal. A toast here would be the NN/g double-signal.
    //   • styles/fonts (or any non-ThemeLoadError rejection — defensive) → one non-blocking toast: the
    //     CSS/font failure degrades survivably to the Kit base-token fallbacks, so a toast is the single
    //     signal and no revert is attempted (item ④; the crash path belongs to ②'s boundary).
    // The switchTheme path keeps its OWN toast because a failure there means we STAYED on the working
    // theme (non-fatal) — a distinct, correct single signal.
    ensureThemeLoaded(theme).catch((err: unknown) => {
      if (err instanceof ThemeLoadError && err.source === "root") {
        console.error(err);
        return;
      }
      pushToast("theme failed to load", "err");
      console.error(err);
    });
  }, [theme]);
  return <>{children}</>;
}

/** The active theme's Root component — App renders `<Root/>`. Re-resolves when the skin changes. */
export function useActiveRoot() {
  const theme = useUISlice((s) => s.theme);
  return rootFor(theme);
}
