// Compact relative-time formatter for ISO-8601 UTC timestamps (e.g. host.status.last_seen). Shared util
// — the first consumer is minimal's Fleet ("last seen 3m ago"); kept generic for the events feed / other
// themes. App code (not a workflow script), so Date.now() is fine.

/** "now" · "3m ago" · "2h ago" · "5d ago" from an ISO-8601 UTC string. Null/empty/invalid → "—". */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const secs = Math.max(0, (Date.now() - t) / 1000);
  if (secs < 45) return "now";
  const mins = secs / 60;
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
