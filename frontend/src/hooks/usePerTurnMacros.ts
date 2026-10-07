import { useQuery } from "@tanstack/react-query";

import { postJSON } from "../api/client";
import { useDebounced } from "./useDebounced";

// ISS-28 (owner 2026-10-07) — the editors' per-turn macro HINT. A per-turn macro (`{{random:…}}`,
// `{{time}}`, …) in text that lands in the prompt HEAD changes the cached prefix every turn, so the
// prompt cache re-prefills from there (owner ruling 2026-10-06: accepted, never silent). The import
// reports already say so; this says it while the owner EDITS, before any save.
//
// THE CLIENT KNOWS NO MACRO. The vocabulary (`SUPPORTED`/`PER_TURN`) AND the grammar (comments
// stripped, a padded `{{ time }}` literal) are the server's one predicate, `per_turn_in`, asked over
// `POST /api/macros/per-turn` — the `schedule-preview` shape (advisory, debounced). A client regex
// would be a second copy of that grammar. WHICH fields are head-landing is the caller's selection, as
// it is the importers'.

/** How long the editor waits after an edit before asking. The schedule preview's value, for its
 *  reason: one request per pause, still reads as live. */
const HINT_DEBOUNCE_MS = 300;

/** The hint line — the import report's count line, said of one field/entry. */
export function perTurnHint(names: readonly string[], noun: "field" | "entry"): string {
  const listed = names.map((n) => `{{${n}}}`).join(", ");
  return `this ${noun} uses a per-turn macro (${listed}) — the prompt cache re-prefills every turn it is active`;
}

/** The hint for `text`, as `WarnRow` lines (`[]` or one). `headLanding` false → never asked: a tail
 *  field costs no cache. A text with no `{{` holds no macro by construction, so it is never sent. */
export function usePerTurnHint(
  text: string,
  headLanding: boolean,
  noun: "field" | "entry",
): string[] {
  const settled = useDebounced(text, HINT_DEBOUNCE_MS);
  const ask = headLanding && settled.includes("{{");
  const { data } = useQuery<{ per_turn: string[] }>({
    queryKey: ["per-turn-macros", settled],
    queryFn: () => postJSON<{ per_turn: string[] }>("/api/macros/per-turn", { text: settled }),
    enabled: ask,
    staleTime: Infinity, // a pure function of the text — the key IS the input
    // ADVISORY: a refused or failed ask is simply no hint — never a retry storm against a server that
    // is down while the owner types. No `placeholderData` either (Emma's MED): the previous text's
    // answer must never stand in for this one's, or B shows A's macro names while B is in flight.
    retry: false,
  });
  // This text's own answer only — and only while the field still asks (a flip to tail drops it at once).
  return ask && data && data.per_turn.length > 0 ? [perTurnHint(data.per_turn, noun)] : [];
}
