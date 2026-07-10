import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Theme-engine CSS entry (Phase 11 / D28). Loads vapor.css + extras.css (the frozen canonical
// stylesheet, lifted verbatim from vapor.html — D7) caged in `@layer frozen` so future non-vapor
// themes win by cascade order, not specificity. The frozen files themselves are untouched. §9.6.
import "./theme/vapor-fonts.css"; // self-hosted JetBrains Mono + Major Mono Display (eager default theme)
import "./theme/index.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { coerceBootTheme } from "./theme-engine/resolve";
import { ThemeProvider } from "./theme-engine/ThemeProvider";

// Boundary validation at the composition root (item ⑥ / §14.15.1): heal a persisted active skin that this
// build can't render (a deregistered theme) to DEFAULT_THEME before the first React paint. Runs every boot
// (registry membership is orthogonal to the persisted-schema version); never touches the server.
coerceBootTheme();

const queryClient = new QueryClient();

// F23 — Root error fallback. The Slice-6 ErrorBoundary inside <App> handles the lazy Conf
// chunk specifically (chunk-load failure → render inside the tab area). This one is the
// global net for crashes in any always-mounted subtree (AppBar / Composer / TabBar / Toasts /
// Fleet / Agent / Utils / hooks). Self-contained layout — `.app-shell` isn't mounted when
// this fires, so the fallback can't reuse `.tab`. Reuses the Vapor section-header (`.sec` +
// `.num` + `<b>`) + `.conf-save` button primitives the Conf fallback already uses; net-new
// CSS is just the outer container in extras.css (`.root-error` + `.root-error-body`).
function rootErrorFallback(error: Error, reload: () => void) {
  return (
    <div className="root-error">
      <div className="sec">
        <span className="num" aria-hidden>
          !!
        </span>
        <b>ctrl·b</b>
        <span className="right">// the app hit a snag</span>
      </div>
      <div className="root-error-body">
        <p>// {error.message || "unknown error"}</p>
        <button className="conf-save" onClick={reload}>
          Reload page
        </button>
      </div>
    </div>
  );
}

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
      <ErrorBoundary fallback={rootErrorFallback}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
