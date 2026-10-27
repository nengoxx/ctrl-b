// The one-line failure text for a failed action (ISS-104): the result's `summary` with its `error` — the
// reason — after a colon, so "failed to shut down box" becomes "failed to shut down box: sudo could not
// authenticate — …". Shared by the two surfaces that announce a fleet failure: the outcome toast
// (`useFleetActions.run`) and the "action failed" notification built from the live event
// (`notifyForEvent`), so both read the same line.

/** The display cap for the joined line, in characters. A toast is a glance, not a log (owner,
 *  2026-10-27: "make sure the messages in the toast aren't way too long"); about three lines at a
 *  phone's width. The full reason stays on the stored event (`GET /api/events`). */
export const FAILURE_TEXT_MAX = 140;

/** `text` cut to `max` chars at a word boundary, ending in `…` (unchanged when it fits). Whitespace
 *  runs — newlines included (a captured stderr, `clip`'s marker) — collapse to one space first, so the
 *  line wraps as prose instead of breaking where the shell did. A hard cut only when the last space
 *  falls in the first half (one long token, e.g. a path), so a cut never leaves a stub. */
function clipForDisplay(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > max / 2 ? head.slice(0, space) : head).trimEnd()}…`;
}

/** Whether `error` is a reason worth showing — the ONE test both `failureText` and the toast's `sticky`
 *  read (R28: a whitespace-only error must not leave a sticky toast with no reason on it). */
export function hasReason(error: string | null | undefined): error is string {
  return !!error?.trim();
}

/** `summary: error` clipped to `FAILURE_TEXT_MAX` when there is a reason; the summary untouched when
 *  there is none (the no-reason path reads exactly as before). A reason with no summary reads alone. */
export function failureText(
  summary: string | null | undefined,
  error: string | null | undefined,
): string {
  const lead = summary ?? "";
  if (!hasReason(error)) return lead;
  return clipForDisplay(lead ? `${lead}: ${error}` : error, FAILURE_TEXT_MAX);
}
