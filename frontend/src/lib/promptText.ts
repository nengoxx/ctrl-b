import type { PromptInfo, PromptPair } from "../types";

// The prompt catalog's two TEXT RULES (Phase 18 / D56 + D70 §9a) — pure, so they are unit-tested
// directly rather than through the editor that applies them.

/** How the SERVER will read a field: blank — or whitespace-only — is unset (§7 L-5). Comparing through
 *  this is what makes a whitespace-only edit "unchanged" WITHOUT trimming meaningful text: a stored
 *  override ending in a newline must not read as changed the moment its row is opened. */
export const normPrompt = (s: string): string => (s.trim() ? s : "");

/** THE FREEZE-TRAP RULE (D70 §9a-1). The modal now opens with the shipped default as the override
 *  field's CONTENT, so the owner edits real words — and the cost of a naive pre-fill is exactly what
 *  R27 names: saving the default AS an override pins the prompt to today's wording forever, silently
 *  opting out of every future improvement to it. So text that is still the default STORES NOTHING.
 *
 *  Three things this is careful about:
 *   · equality is EXACT after ONLY `normPrompt` — never a `.trim()` comparison (Emma F15): the shipped
 *     posture deliberately PRESERVES a deliberate leading/trailing-whitespace delta, and a trimming
 *     compare would silently discard it;
 *   · the comparison target is the `default_text` THIS modal was opened with, not whatever the server
 *     says now;
 *   · an equal base clears ONLY the override — a set `append` is the owner's and survives untouched.
 *
 *  Restore stays what it always was: the both-blank pair (the shipped rule, unchanged). */
export function foldEqualDefault(pair: PromptPair, defaultText: string): PromptPair {
  return normPrompt(pair.override) === normPrompt(defaultText) ? { ...pair, override: "" } : pair;
}

/** The editor's SECTIONS (§9a-3), in the order the REGISTRY first names them — the API's row order is
 *  the one ordering authority, so this derives the sections from it instead of holding a map that
 *  could drift from it. Rows the registry has not placed (`group` absent or `""`) collect into ONE
 *  trailing section with an empty title, which is what "not placed yet" looks like on screen. */
export function groupPrompts(rows: readonly PromptInfo[]): { group: string; rows: PromptInfo[] }[] {
  const out: { group: string; rows: PromptInfo[] }[] = [];
  const byGroup = new Map<string, PromptInfo[]>();
  for (const row of rows) {
    const group = row.group ?? "";
    let bucket = byGroup.get(group);
    if (bucket === undefined) {
      bucket = [];
      byGroup.set(group, bucket);
      // The ungrouped bucket is minted here like any other so registry order is honoured for the rest,
      // but it is MOVED to the end below — a section with no name reads as a remainder, not a lead.
      out.push({ group, rows: bucket });
    }
    bucket.push(row);
  }
  return [...out.filter((s) => s.group !== ""), ...out.filter((s) => s.group === "")];
}
