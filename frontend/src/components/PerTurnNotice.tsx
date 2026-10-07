import { usePerTurnHint } from "../hooks/usePerTurnMacros";
import { WarnRow } from "./WarnRow";

/** ISS-28 — the per-turn macro hint for ONE head-landing field's text, as the shared `WarnRow` line
 *  (nothing when the server's `per_turn_in` finds none). Shaped `{ text }` so the SAME component
 *  serves the field's row (the saved/draft value) and the fullscreen editor's `notice` slot (the live
 *  text, per keystroke) — one predicate, one wording, both places. Mount it only for HEAD-landing text:
 *  mounting it is the head-landing decision. */
export function PerTurnNotice({ text }: { text: string }) {
  return <WarnRow warnings={usePerTurnHint(text, true, "field")} />;
}
