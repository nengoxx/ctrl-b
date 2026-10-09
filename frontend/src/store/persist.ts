// Shared localStorage helpers for the persisted stores (D23) — dep-free. Folds the load/save
// `try/catch` that `ui`, `composer`, and `collapse` each hand-rolled into one place. Separate from the
// `createStore` binding on purpose (single-responsibility): the binding is state-shape-agnostic; a
// store opts into persistence by calling these in its load + its update action.
//
// All errors are swallowed (private-mode browsers throw on access; a corrupt value throws on parse) so
// persistence can never break the in-memory state — a failed read falls back to the defaults, a failed
// write is a no-op and the value still lives in memory.

/** A plain OBJECT value (not `null`, not an array) — the shape test every persisted blob and every
 *  map inside one is held to at its load boundary. One definition for the stores that fold a blob
 *  (`chat`'s tuple, `composer`'s drafts, `attachments`' rails). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Defaults-over-merge for an OBJECT state: the parsed blob is merged **over** the defaults, so a field
 *  added since the value was saved keeps its default, and a stored `null`/`undefined` spreads to a no-op.
 *  Shared by both loaders so the merge rule lives in exactly one place. A corrupt non-object blob (an
 *  array/string spreads to junk numeric-index keys that would then be re-persisted) falls back to the
 *  defaults outright (verification F5, 2026-07-10). */
function mergeOverDefaults<T>(defaults: T, parsed: unknown): T {
  if (!isRecord(parsed)) {
    return { ...(defaults as object) } as T;
  }
  return { ...(defaults as object), ...parsed } as T;
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
    // isSafeInteger, not typeof (verification F3, 2026-07-10): JSON can smuggle `1e999` → Infinity, which
    // would skip the migration chain as "newer than current"; NaN would re-run it forever. A non-integer
    // `v` is corrupt → treat as legacy v0 (the migrations are idempotent-guarded, so re-running is safe).
    const from = Number.isSafeInteger(envelope?.v) ? (envelope!.v as number) : 0;
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

/** Patch ONE persisted object FIELD BY FIELD (Phase 27 §12.3 M4): read the stored blob FRESH, apply
 *  `patch` to it, and save the result — never a whole-blob write of in-memory state. `patch` receives the
 *  blob as stored right now (a non-object or unreadable value reads as `{}`) and returns ONLY the fields
 *  it owns; every other field is written back exactly as it was read. Two tabs of one browser profile
 *  therefore race only on the SAME field (last writer wins there), and a writer of one field can never
 *  re-persist another field's stale copy — e.g. a tab's navigation re-saving an elevation the other tab
 *  cleared. `ctrlb.chat`'s writers (the view tuple, one home's overrides) go through here, and so do
 *  the per-conversation drafts and rails (`ctrlb.composer` / `ctrlb.attachments`, Phase 27 S8): each
 *  write re-reads the stored map and changes only the conversation entries it owns. A field patched to `undefined` is REMOVED (JSON drops it) — how a load-boundary fold deletes a
 *  retired key. Same error contract as `savePersisted`: storage failures are swallowed. */
export function patchPersisted(
  key: string,
  patch: (stored: Record<string, unknown>) => Record<string, unknown>,
): void {
  let stored: Record<string, unknown> = {};
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw == null ? null : (JSON.parse(raw) as unknown);
    if (isRecord(parsed)) stored = parsed;
  } catch {
    /* unreadable → patch over an empty blob */
  }
  savePersisted(key, { ...stored, ...patch(stored) });
}
