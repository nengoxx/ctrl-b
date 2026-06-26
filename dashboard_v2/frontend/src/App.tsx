import { useEffect } from "react";

import { useAppearanceSync } from "./hooks/useAppearance";
import { useEventStream } from "./hooks/useEvents";
import { useFleetCycle } from "./hooks/useFleet";
import { isAnyDirty } from "./store/dirty";
import { useActiveRoot } from "./theme-engine/ThemeProvider";

// App is a THIN HOST (Phase 11 v2 / D29 §14.1, M0). The active theme owns the whole presentation —
// App renders `<ActiveRoot/>` and runs the APP-GLOBAL effects that aren't part of any theme's visual
// tree: the live event stream, cross-device appearance sync, the visual-viewport `--app-h` sizing, and
// the unsaved-changes unload guard. Everything visual (the `.app-shell` layout, appbar, tabs, composer,
// tab bar, overlays) lives below, owned by the theme (vapor → themes/vapor/VaporRoot).
//
// (Layout-specific effects — lazy-Conf, scroll-reset, `--appbar-h` — moved into VaporRoot since each
// theme owns its own layout. App keeps only what every theme shares.)

export default function App() {
  useEventStream(); // live activity feed → refresh fleet on any recorded action (effects only, no re-render)
  useAppViewport(); // --app-h tracks the visual viewport (keyboard-aware dvh) — effect only
  useUnsavedGuard(); // warn before unload if any editor has unsaved changes — effect only

  // App re-renders ONLY on a theme change (the one reactive read it keeps). The data-subscribing engines
  // live in a null-rendering child so their per-poll/appearance re-renders stay there and never cascade
  // through `<ActiveRoot/>` into the whole theme tree.
  const ActiveRoot = useActiveRoot();
  return (
    <>
      <AppEngines />
      <ActiveRoot />
    </>
  );
}

// Headless controller engines mounted ABOVE the theme Root (D29 §14.5), isolated here so their query
// subscriptions (hosts poll, appearance reconcile) re-render only this null component — not App.
function AppEngines() {
  useFleetCycle(); // SINGLETON featured-host auto-advance engine
  useAppearanceSync(); // reconcile theme/mode/accent against the server (cross-device LWW, §9.11)
  return null;
}

// Size the app shell to the VISUAL viewport. `100dvh` (CSS fallback) tracks the browser toolbar but NOT
// the on-screen keyboard, so `visualViewport.height` is used to keep the in-flow composer above the
// keyboard. `--app-h` overrides the dvh fallback once JS runs. App-global: every theme's layout uses it.
function useAppViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => document.documentElement.style.setProperty("--app-h", `${vv.height}px`);
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, []);
}

// F19 — warn the browser before unload (refresh / close / navigate) if any editor has unsaved changes.
// `isAnyDirty()` is a direct registry read (not a subscription) so this runs once at mount and reads
// fresh state at unload. Both `preventDefault()` + `returnValue=""` cover the modern + legacy specs.
function useUnsavedGuard(): void {
  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (!isAnyDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
}
