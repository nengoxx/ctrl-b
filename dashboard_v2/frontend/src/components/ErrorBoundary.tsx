import { Component, type ErrorInfo, type ReactNode } from "react";

// React error boundary — catches render errors in its subtree and renders a fallback instead of
// crashing the whole app. Reusable; primarily wraps lazy <Suspense> blocks (Slice 6 / F6 in
// docs/UI_AUDIT.md) so a chunk-load failure shows a recoverable UI instead of a blank screen.
//
// Key constraint with React.lazy: when its dynamic import rejects, the rejection is CACHED inside
// the lazy component. Re-rendering the same lazy node throws the cached promise again — there is
// no API to clear it. So "retry" can't be implemented by simply clearing the boundary's state;
// the only reliable recovery is `window.location.reload()`, which also picks up any new build
// (the most common failure mode in practice is a stale chunk hash after a deploy). The fallback
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
