import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Theme-engine CSS entry (Phase 11 / D28). Loads vapor.css + extras.css (the frozen canonical
// stylesheet, lifted verbatim from vapor.html — D7) caged in `@layer frozen` so future non-vapor
// themes win by cascade order, not specificity. The frozen files themselves are untouched. §9.6.
import "./theme/vapor-fonts.css"; // self-hosted JetBrains Mono + Major Mono Display (vapor is eager)
import "./theme/index.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { rootErrorFallback } from "./lib/crashScreen";
import { isGecko } from "./lib/engine";
import { coerceBootTheme } from "./theme-engine/resolve";
import { ThemeProvider } from "./theme-engine/ThemeProvider";

// Boundary validation at the composition root (item ⑥ / §14.15.1): heal a persisted active skin that this
// build can't render (a deregistered theme) to DEFAULT_THEME before the first React paint. Runs every boot
// (registry membership is orthogonal to the persisted-schema version); never touches the server.
coerceBootTheme();

// Engine stamp (THEME_ENGINE §14.11). The browser engine is STATIC for the session, so it's a one-time
// boot stamp BEFORE first paint — deliberately NOT a React effect, and deliberately NOT in <AppEngines/>'s
// axis stamping (that's for user-pref-REACTIVE attrs like data-perf/data-motion that flip at runtime).
// Consumers are pure CSS rules keying off `body[data-engine="gecko"]`; see src/lib/engine.ts.
if (isGecko) document.body.dataset.engine = "gecko";

const queryClient = new QueryClient();

// React 19 — centralized error hooks at createRoot. These are complementary to the
// ErrorBoundary below, not a replacement (per React docs): the boundary handles UI recovery,
// these hooks are the single chokepoint for logging. `onUncaughtError` covers the rare case
// where an error escapes every boundary (e.g. the boundary itself threw); `onCaughtError`
// mirrors the existing class `componentDidCatch` log so a future Sentry/remote-reporter wire
// has one place to hook into.
createRoot(document.getElementById("root")!, {
  onUncaughtError: (err, info) => {
    console.error("uncaught render error:", err, info.componentStack);
  },
  onCaughtError: (err, info) => {
    console.warn("caught render error:", err, info.componentStack);
  },
}).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* F23 — the global crash net. The screen itself lives in `lib/crashScreen` (self-contained styling,
          unit-tested there); this is just where it's wired in. */}
      <ErrorBoundary fallback={rootErrorFallback}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
