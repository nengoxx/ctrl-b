import { useSyncExternalStore } from "react";

// The shared external-store binding (D23) — dep-free. Unifies the listener-set + notify + the React
// `useSyncExternalStore` wiring that every module-singleton store (and `lib/audioController`) used to
// hand-roll. It owns NO state and imposes NO shape: the caller keeps its own `state` value + its own
// (often guarded) update function calling `emit()`, and supplies its own snapshot to `useStore`.
//
// Each `createStore()` call closes over its own private `listeners` set, so stores stay independent.
//
//   const { emit, useStore } = createStore();
//   let state: T = initial;
//   export function setX(...) { state = ...; emit(); }                       // update + notify
//   export function useX() { return useStore(() => state); }                 // whole snapshot
//   export function useSlice<S>(sel: (s: T) => S) { return useStore(() => sel(state)); }  // slice
//
// Selector/snapshot contract: `getSnapshot` MUST return a primitive or a stable reference. A snapshot
// that builds a fresh object/array each call changes identity every read and loops forever (React
// compares with `Object.is`). For composite reads, call `useStore` once per field. An object-selector
// + `equalityFn` variant (a hand-rolled `useSyncExternalStoreWithSelector`) is an additive future
// extension — see DECISIONS D23 — not needed today: every current snapshot is a primitive or the
// stable `state` reference.
//
// `getServerSnapshot` is `getSnapshot` (this is a client-only PWA; reusing it is correct — React docs).

export interface StoreBinding {
  /** Subscribe a listener; returns an unsubscribe. For wiring non-React side-effects to changes. */
  subscribe(cb: () => void): () => void;
  /** Notify all listeners — call after mutating the store's state. */
  emit(): void;
  /** Bind a snapshot to React. `getSnapshot` must return a primitive or a stable reference. */
  useStore<T>(getSnapshot: () => T): T;
}

export function createStore(): StoreBinding {
  const listeners = new Set<() => void>();
  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  };
  const emit = (): void => {
    for (const l of listeners) l();
  };
  const useStore = <T>(getSnapshot: () => T): T =>
    useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { subscribe, emit, useStore };
}
