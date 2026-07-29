import { type ReactNode, Suspense, useCallback, useEffect, useLayoutEffect, useState } from "react";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAgentChat, useChatInit } from "./hooks/useAgentChat";
import {
  currentAppearancePatch,
  useAppearanceSync,
  useSaveAppearance,
} from "./hooks/useAppearance";
import { useAutoTts } from "./hooks/useAutoTts";
import { useEventStream } from "./hooks/useEvents";
import { useFleetCycle } from "./hooks/useFleet";
import { useForegroundNotifications } from "./hooks/useForegroundNotifications";
import { isAnyDirty } from "./store/dirty";
import { usePlanOpenAutoClose } from "./store/planSheet";
import { useUISlice } from "./store/ui";
import { useComposerSkin, useOutlines } from "./theme-engine/kit/axes";
import { DEFAULT_THEME, defaultSwitchTarget } from "./theme-engine/resolve";
import { switchTheme } from "./theme-engine/switchTheme";
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

  // App re-renders ONLY on a theme change (the reactive reads it keeps: `useActiveRoot` resolves the Root
  // for the skin, and `theme` below keys item ②'s fault boundary — both fire on the same skin change, so no
  // extra re-render trigger). The data-subscribing engines live in a null-rendering child so their
  // per-poll/appearance re-renders stay there and never cascade through `<ActiveRoot/>` into the theme tree.
  const ActiveRoot = useActiveRoot();
  const theme = useUISlice((s) => s.theme); // for the fault-boundary key only (not a new render trigger)

  // Item ② (§14.15.1) — the THEME-FAULT boundary + Reset-as-pick. This inner ErrorBoundary wraps the theme
  // Root so a render/commit crash (or the ThemeProvider cold-load path re-throwing an evicted Root chunk,
  // §14.15.1-A ③) shows a recoverable panel instead of a blank screen, WITHOUT tearing down the whole app
  // (the global main.tsx boundary stays the outer net; ThemeProvider stays above it so a Reset never remounts
  // the provider). Boundaries catch render/commit only — rAF/canvas faults are rider (c)'s `safeRafLoop`, not
  // this boundary's job (§14.15.1-A ②/rider c).
  //
  // Key = `${theme}:${resetEpoch}` (the key-remount idiom, §14.15.1-A ②+): the `theme` part retries cleanly
  // when a NEW skin is picked (a different id → the boundary remounts and re-renders the new Root), and the
  // `resetEpoch` counter guarantees Reset ALWAYS remounts — including when the faulty skin IS DEFAULT_THEME
  // (same id → the key would otherwise be unchanged and Reset would be a silent no-op, the M4 trap). The
  // epoch is bumped ONLY by explicit user action (the Reset button) — never automatically on catch, which
  // would loop (the react-error-boundary #168 footgun).
  const [resetEpoch, setResetEpoch] = useState(0);

  // Reset = a GENUINE pick of DEFAULT_THEME, reconstructing ConfTab.pickTheme's two-step (switchTheme +
  // optimistic appearance PUT) so it satisfies the §14.15.2 invariant (the server appearance doc is written
  // ONLY by explicit user action; the Reset button qualifies). Write-through is REQUIRED: a local-only reset
  // doesn't escape — the server doc would re-apply the broken skin on the next reconcile → crash loop. The
  // `mutate` hook is hoisted here and the callback is passed into the fallback (§14.15.1-A ②+). The switch
  // flows through ⑤'s in-flight guard automatically. Mirrors pickTheme: switchTheme is async (loads the
  // bundle first), so `currentAppearancePatch()` snapshots the store NOW and the target overrides skin/axes.
  const saveAppearance = useSaveAppearance();
  const resetToDefault = useCallback(() => {
    const target = defaultSwitchTarget(DEFAULT_THEME);
    void switchTheme(DEFAULT_THEME, target);
    saveAppearance.mutate({ ...currentAppearancePatch(), theme: DEFAULT_THEME, ...target });
    setResetEpoch((e) => e + 1); // always remount, even when the faulty skin already IS DEFAULT_THEME
  }, [saveAppearance]);

  return (
    <>
      <AppEngines />
      {/* The active theme's Root may be a lazy chunk (non-default themes — keeps a bespoke theme's
          canvas/Fleet out of the default bundle). switchTheme preloads it before the flip, so this
          Suspense only ever shows on a cold load with a non-default theme persisted (brief, §14.6);
          the eager default (vapor) never suspends. fallback=null → the page bg shows during the blip.
          The ErrorBoundary sits ABOVE the Suspense (item ②): a Root chunk that fails to import throws
          the rejected promise to the nearest boundary above `<Suspense>` — this one. */}
      <ErrorBoundary
        key={`${theme}:${resetEpoch}`}
        fallback={(error, reload) => themeFaultFallback(error, reload, resetToDefault)}
      >
        <Suspense fallback={null}>
          {/* eslint-disable-next-line react-hooks/static-components -- ActiveRoot is a STABLE registry component (rootFor(theme), D29 §14), not an inline definition; the lint can't see through the registry lookup. */}
          <ActiveRoot />
        </Suspense>
      </ErrorBoundary>
    </>
  );
}

// Item ②'s fallback (§14.15.1) — a compact, SELF-CONTAINED recovery panel shown when the theme Root faults.
// Styling is INLINE on purpose (the crash-screen convention: never depend on the styling of the thing that
// crashed): the F23 classes all live under `@scope ([data-skin="vapor"])`, and this boundary's COMMON case is
// a crashed NON-vapor lazy skin — `html[data-skin]` still names that skin, so vapor's rules can't match and a
// class-styled fallback would render unstyled exactly when it matters (ruling 2026-07-10, supersedes the
// reuse-F23-classes assumption; F23 itself is unchanged — it fires under vapor, where its classes resolve).
// The F23 class names + markup shape are KEPT for identity continuity; `var(--token, literal)` fallbacks let
// the unscoped base tokens enrich the palette when they resolve. Deliberately theme-neutral — this is the
// "the theme is broken" screen. Two actions, ordered by likely fix:
//   • Reload = PRIMARY — `reload()` (window.location.reload) picks up a new build (the common stale-chunk-
//     after-deploy case) AND is the backstop for the browser module-map cached-FETCH case eviction can't
//     reach (whatwg/html#10327). It keeps the current pick.
//   • Reset theme to default = SECONDARY — a genuine pick of DEFAULT_THEME with write-through (see
//     `resetToDefault`). If DEFAULT_THEME is already the faulty skin, Reset still works (the epoch bump
//     remounts and re-renders), but Reload is the likelier fix there — so Reset is never hidden (M4: never a
//     silent no-op), just ordered second.
// `data-fault="theme"` is a stable, non-styling hook so the ⑩ kit-render e2e can distinguish this fallback
// from the F23 global one (both use `.root-error`).
const faultBtn = {
  padding: "10px 16px",
  border: "1px solid var(--accent, #7a7a8c)",
  borderRadius: 8,
  background: "var(--accent-fill, #26262e)",
  color: "var(--text, #e8e8ea)",
  font: "inherit",
  cursor: "pointer",
} as const;

function themeFaultFallback(error: Error, reload: () => void, onReset: () => void): ReactNode {
  return (
    <div
      className="root-error"
      data-fault="theme"
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 16,
        padding: 24,
        maxWidth: 480,
        margin: "0 auto",
        background: "var(--bg, #101014)",
        color: "var(--text, #e8e8ea)",
        fontFamily: "ui-monospace, monospace",
      }}
    >
      <div className="sec">
        <span className="num" aria-hidden>
          !!
        </span>
        <b>ctrl·b</b> <span className="right">// the theme crashed</span>
      </div>
      <div className="root-error-body">
        <p style={{ opacity: 0.8, overflowWrap: "anywhere" }}>
          // {error.message || "unknown error"}
        </p>
        <div
          className="root-error-actions"
          style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}
        >
          <button style={faultBtn} onClick={reload}>
            Reload page
          </button>
          <button style={{ ...faultBtn, background: "transparent" }} onClick={onReset}>
            Reset theme to default
          </button>
        </div>
      </div>
    </div>
  );
}

// Headless controller engines mounted ABOVE the theme Root (D29 §14.5), isolated here so their query/
// chat subscriptions (hosts poll, appearance reconcile, chat deltas) re-render only this null component —
// not App, so they never cascade through `<ActiveRoot/>` into the theme tree.
function AppEngines() {
  useFleetCycle(); // SINGLETON featured-host auto-advance engine
  useAppearanceSync(); // reconcile theme/mode/accent against the server (cross-device LWW, §9.11)
  useChatInit(); // load the most-recent thread once (was AgentTab) — theme-independent (§14.5)
  useAutoTts(); // auto read-aloud of a just-completed reply (6b-2) — global, runs regardless of tab
  // F1 — the SINGLE foreground-notification gate. Hosted here (not in a tab or a theme body) because
  // both of its sources are app-global streams and the whole point is one chokepoint: prefs +
  // visibility + permission + de-dupe are decided in exactly one place. Inert until the owner enables
  // notifications in Conf, and a no-op entirely on a browser/origin without the Notifications API.
  useForegroundNotifications();
  // A4 — reset the SHARED plan-open flag when the plan clears. Hosted HERE (not AgentTab) so a bespoke
  // theme body that replaces the agent section can never lose the reset (§14.5, theme-independent engines).
  // `useAgentChat` is a cheap memoized derivation (threads are bounded); we only read `currentPlan`.
  usePlanOpenAutoClose(useAgentChat().currentPlan);

  // Presentation axes (D37) — project the resolved axis values onto `body[data-*]`, the ONE stamp site the
  // kit chrome keys off (Slice A `outlines` → kit/axes.css strips; Slice B `composerSkin` → kit.css skin
  // chrome). Stamped HERE (not store/ui#applyBodyAttrs) because axis resolution reads the theme registry (the
  // theme's declared default) and the store must NEVER import the registry (the store↛registry circular-import
  // hazard). `useLayoutEffect` (not useEffect) so the FIRST commit paints with the attributes already set — no
  // one-frame flash of the wrong border/chrome state. Both are cleared on unmount so a torn-down app leaves no
  // stale attrs.
  const theme = useUISlice((s) => s.theme);
  const outlines = useOutlines(theme);
  const skin = useComposerSkin(theme);
  useLayoutEffect(() => {
    document.body.dataset.outlines = outlines ? "on" : "off";
    document.body.dataset.composerSkin = skin;
    return () => {
      delete document.body.dataset.outlines;
      delete document.body.dataset.composerSkin;
    };
  }, [outlines, skin]);

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
