// Shared localStorage helpers for the persisted stores (D23) — dep-free. Folds the load/save
// `try/catch` that `ui`, `composer`, and `collapse` each hand-rolled into one place. Separate from the
// `createStore` binding on purpose (single-responsibility): the binding is state-shape-agnostic; a
// store opts into persistence by calling these in its load + its update action.
//
// All errors are swallowed (private-mode browsers throw on access; a corrupt value throws on parse) so
// persistence can never break the in-memory state — a failed read falls back to the defaults, a failed
// write is a no-op and the value still lives in memory.

/** Load `key` from localStorage, falling back to `defaults`. For object states the parsed blob is
 *  merged **over** the defaults, so a field added since the value was saved is still present (and a
 *  stored `null`/`undefined` spreads to a no-op → defaults). Non-object states take the parsed value. */
export function loadPersisted<T>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return defaults;
    const parsed = JSON.parse(raw) as unknown;
    if (defaults !== null && typeof defaults === "object") {
      return { ...(defaults as object), ...(parsed as object) } as T;
    }
    return parsed as T;
  } catch {
    return defaults;
  }
}

/** Persist `value` under `key`. No-op (non-fatal) if storage is unavailable or over quota. */
export function savePersisted<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — non-fatal, state still lives in memory */
  }
}
