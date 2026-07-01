// Schedule a chunk preload during browser idle time (Slice 6 / F6 in docs/UI_AUDIT.md).
//
// Uses `requestIdleCallback` when available so the prefetch never competes with the first-paint
// critical path. Safari does not implement `requestIdleCallback` yet (browser-compat table on
// MDN), so we fall back to a short `setTimeout` — close enough in practice: by 800ms the initial
// render is done on any sensible device, and we'd rather warm the chunk a little eagerly than not
// at all.
//
// Returns a cancel function in case the caller unmounts before the callback fires (it doesn't
// hurt to fire either way — the module just gets imported and held in memory — but cancelling
// keeps the dev console quiet about unhandled work).
//
// Failures inside the loader are swallowed deliberately: a failed prefetch must not break the
// page. The real load (via React.lazy / a click) will surface the error through its own
// Suspense / error boundary.

type IdleHandle = number;
type IdleDeadline = { didTimeout: boolean; timeRemaining: () => number };
interface IdleWindow {
  requestIdleCallback?: (cb: (d: IdleDeadline) => void, opts?: { timeout: number }) => IdleHandle;
  cancelIdleCallback?: (handle: IdleHandle) => void;
}

export function prefetchOnIdle(load: () => Promise<unknown>, timeoutMs = 2000): () => void {
  const w = window as Window & IdleWindow;
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(() => void load().catch(() => undefined), {
      timeout: timeoutMs,
    });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(() => void load().catch(() => undefined), 800);
  return () => window.clearTimeout(id);
}
