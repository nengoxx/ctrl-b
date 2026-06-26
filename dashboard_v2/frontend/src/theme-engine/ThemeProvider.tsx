// ThemeProvider + useActiveRoot (Phase 11 v2 / D29 §14). The theme owns its whole presentation, so the
// engine exposes the active theme's `Root` (App renders it). `ThemeProvider` is the seam that will host
// the headless **feature-controller providers** in M2 (mounted ABOVE the theme Root so state survives a
// theme switch — the §14.5 invariant); for M0 it's a passthrough.
//
// Lazy CSS/fonts are loaded by the `switchTheme` path (switchTheme.ts) BEFORE the active theme flips,
// so the Root model needs no suspense here. The default theme (vapor) CSS is eager (§14.6).

import { type ReactNode } from "react";

import { useUISlice } from "../store/ui";
import { rootFor } from "./resolve";

export function ThemeProvider({ children }: { children: ReactNode }) {
  // M2 will wrap `children` in the feature-controller providers here.
  return <>{children}</>;
}

/** The active theme's Root component — App renders `<Root/>`. Re-resolves when the skin changes. */
export function useActiveRoot() {
  const theme = useUISlice((s) => s.theme);
  return rootFor(theme);
}
