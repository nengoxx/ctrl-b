import { Component, type ErrorInfo, type ReactNode } from "react";

// React error boundary — catches render errors in its subtree and renders a fallback instead of
// crashing the whole app. Reusable; primarily wraps lazy <Suspense> blocks (Slice 6 / F6 in
// docs/UI_AUDIT.md) so a chunk-load failure shows a recoverable UI instead of a blank screen.
//
// Recovery model with lazy chunks: React.lazy CACHES a rejected dynamic import inside the lazy
// component — re-rendering the same node throws the cached promise again, with no API to clear it,
// so its only reliable recovery is `window.location.reload()`. Our theme Roots use `preloadableRoot`
// (theme-engine/lazyRoot.ts), which EVICTS its memoized `pending` on rejection (§14.15.1-A ③+), so a
// re-attempt (a fresh pick, or this boundary's Reset-as-pick) re-imports the chunk — no reload needed
// for a transient blip. Reload remains the backstop for the case eviction can't reach — the browser
// module map may still cache the failed FETCH (whatwg/html#10327, open) — and it also picks up any new
// build (the most common failure mode in practice is a stale chunk hash after a deploy). The fallback
// the caller provides should call this when the user accepts a reload.
//
// Error boundaries must be class components in React 19 (there's no `useErrorBoundary` hook yet).

interface Props {
  /** Render-prop: receives the caught error + a `reload` helper. Keep the UI in-theme (Vapor). */
  fallback: (error: Error, reload: () => void) => ReactNode;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep one log line so a real bug is visible in the console without spamming on every render.
    // The fallback UI is the user-facing message; this is the developer signal.
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  private reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error) return this.props.fallback(this.state.error, this.reload);
    return this.props.children;
  }
}
