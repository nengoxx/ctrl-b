// Cross-editor dirty registry. Each long-form editor (Conf, Agents, the per-skill SKILL.md
// editor) registers its own dirty flag here via `useRegisterDirty(key, isDirty)`; the
// beforeunload listener in App.tsx checks `isAnyDirty()` and prompts the browser to warn
// the user before unload — refresh, close, navigate away — if anything is unsaved.
//
// Shape mirrors store/confirm.ts: tiny module-scope state, useSyncExternalStore for any
// future React consumer, dependency-free. Key strings are namespaced ("conf", "agents",
// "skill:<name>") so several can coexist; unmount cleanup auto-removes a key so a closed
// editor never holds the registry hostage.
//
// Note: `isAnyDirty()` is also exported as a direct read so the beforeunload handler can
// check it inline without forcing App to re-render on every editor edit. Subscription is
// available via `useAnyDirty()` if a future surface ever wants to render a "Unsaved
// changes" badge in the appbar (not used today).

import { useEffect, useSyncExternalStore } from "react";

const dirtyKeys = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setDirty(key: string, isDirty: boolean): void {
  const had = dirtyKeys.has(key);
  if (isDirty && !had) {
    dirtyKeys.add(key);
    emit();
  } else if (!isDirty && had) {
    dirtyKeys.delete(key);
    emit();
  }
  // No-op when state hasn't changed — saves a needless re-render of any subscriber.
}

/** Direct read — for the beforeunload handler's inline check. Does NOT subscribe. */
export function isAnyDirty(): boolean {
  return dirtyKeys.size > 0;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Subscribe to the aggregate dirty state. Reserved for future "Unsaved" badge UI. */
export function useAnyDirty(): boolean {
  return useSyncExternalStore(subscribe, isAnyDirty, isAnyDirty);
}

/**
 * Register a dirty flag for the lifetime of the calling component. Pass the editor's existing
 * `dirty` expression as `isDirty`; this hook keeps the registry in sync as it flips, and
 * automatically clears the key on unmount (so closing an editor never leaves the registry
 * stuck thinking something is unsaved).
 */
export function useRegisterDirty(key: string, isDirty: boolean): void {
  useEffect(() => {
    setDirty(key, isDirty);
    return () => setDirty(key, false);
  }, [key, isDirty]);
}
