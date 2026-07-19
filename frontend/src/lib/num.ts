// Garbage-safe numeric coercion for settings inputs (one source of truth — shared by AgentsEditor's
// ModelRef/compaction fields and ConfTab's per-endpoint context window). `Number("")` is 0 and
// `Number("abc")` is NaN, and a naive `… === "" ? null : Number(v) || 0` collapses BOTH a cleared
// field and typed junk to 0 — a footgun on token/window budgets where 0 is never meaningful.
//
// - `numOrNull` maps blank / non-numeric / ≤0 → `null` (inherit) for the nullable budget fields
//   (`ge=1`; the schema rejects 0).
// - `numOrKeep` is for the non-nullable compaction knobs (`ge=0`, so 0 is a *valid* setting): a valid
//   non-negative integer is written; anything else (blank/junk) leaves the last valid value untouched.
// - `numOrKeepNullable` is the keep-variant for a nullable `ge=1` budget (D42 context_window): a
//   genuinely blank input → `null` (auto); a valid positive integer → that number; junk / non-finite
//   / ≤0 KEEPS the prior stored value (never silently un-configures the window — Codex FIX A).

export function numOrNull(raw: string): number | null {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

export function numOrKeep(raw: string, current: number): number {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isInteger(n) && n >= 0 ? n : current;
}

export function numOrKeepNullable(raw: string, current: number | null): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : current;
}
