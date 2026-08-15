/** A small inline warnings/notice list (D48 B5 / R22). Visual precedent: `.redisc-hint`. Rendered in
 *  the owning ConfGroup; fed by PUT-response warnings (after save), `GET /api/providers` boot warnings
 *  and `GET /api/prompts` unknown-id notices (Phase 18). Extracted from ConfTab so the prompt editor
 *  and its modal reuse the shape instead of copying it. */
export function WarnRow({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <div className="conf-warnrow">
      {warnings.map((w, i) => (
        <div className="conf-warn" key={i}>
          ⚠ {w}
        </div>
      ))}
    </div>
  );
}
