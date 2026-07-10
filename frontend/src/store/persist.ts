// Shared localStorage helpers for the persisted stores (D23) — dep-free. Folds the load/save
// `try/catch` that `ui`, `composer`, and `collapse` each hand-rolled into one place. Separate from the
// `createStore` binding on purpose (single-responsibility): the binding is state-shape-agnostic; a
// store opts into persistence by calling these in its load + its update action.
//
// All errors are swallowed (private-mode browsers throw on access; a corrupt value throws on parse) so
// persistence can never break the in-memory state — a failed read falls back to the defaults, a failed
// write is a no-op and the value still lives in memory.

/** Defaults-over-merge for an OBJECT state: the parsed blob is merged **over** the defaults, so a field
 *  added since the value was saved keeps its default, and a stored `null`/`undefined` spreads to a no-op.
 *  Shared by both loaders so the merge rule lives in exactly one place. */
function mergeOverDefaults<T>(defaults: T, parsed: unknown): T {
  return { ...(defaults as object), ...(parsed as object) } as T;
}

/** Load `key` from localStorage, falling back to `defaults`. For object states the parsed blob is
 *  merged **over** the defaults, so a field added since the value was saved is still present (and a
 *  stored `null`/`undefined` spreads to a no-op → defaults). Non-object states take the parsed value. */
export function loadPersisted<T>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return defaults;
    const parsed = JSON.parse(raw) as unknown;
    if (defaults !== null && typeof defaults === "object") {
      return mergeOverDefaults(defaults, parsed);
    }
    return parsed as T;
  } catch {
    return defaults;
  }
}

/** Load `key` as a **versioned** object state (the zustand-persist `version`/`migrate` convention adapted
 *  to our flat blob; this is the shared D23 chokepoint so other stores can adopt versioning later — §14.15.1
 *  rider a). One raw read + ONE `JSON.parse` (this obviates the old double-parse presence probes):
 *   - `from` = the persisted schema version. A reserved top-level `v: number` carries it; a MISSING `v`
 *     means a legacy/pre-versioning blob → `from = 0`.
 *   - `merged` = defaults-over-merge (same rule as `loadPersisted`) with the reserved `v` key STRIPPED —
 *     `v` is envelope metadata, never runtime state (the persist convention: the version lives on the
 *     wire, not in the store).
 *   - `from >= version` → the blob is already at/after the current shape, return `merged` as-is. This
 *     covers a `v` from a NEWER build read back after a rollback: its unknown fields are inert under the
 *     defaults-over-merge, so treating it as current is safe (never down-migrate).
 *   - otherwise → `migrate(merged, parsed, from)` runs the caller's ordered upgrade chain. `parsed` is the
 *     raw blob (pre-merge, pre-strip) so a migration can key-presence-infer stages the merge would mask.
 *  All errors are swallowed → `defaults` (same contract as `loadPersisted`). The caller stamps `v` on save. */
export function loadPersistedVersioned<T>(
  key: string,
  defaults: T,
  version: number,
  migrate: (merged: T, raw: unknown, from: number) => T,
): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return defaults;
    const parsed = JSON.parse(raw) as unknown;
    const envelope = parsed as { v?: unknown } | null;
    const from = typeof envelope?.v === "number" ? envelope.v : 0;
    const merged = mergeOverDefaults(defaults, parsed);
    delete (merged as { v?: unknown }).v; // envelope metadata — never leaks into runtime state
    if (from >= version) return merged;
    return migrate(merged, parsed, from);
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
