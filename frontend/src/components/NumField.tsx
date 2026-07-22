import { useEffect, useRef, useState } from "react";

// A11 / D48 — a guarded INTEGER field for the provider-card numerics (max_concurrent_requests /
// retry_attempts) + the per-model context_window (FX13 / Codex#6). Mirrors JsonField: it keeps the raw
// text locally, emits a finite integer (or `null` when blank) through `onChange`, and reports invalid text
// via `onValidity(id, false)` so the caller BLOCKS the save — instead of `Number("abc") → NaN`, which
// `JSON.stringify` turns into `null`, silently dropping a bounded limit past the backend's ge= validation.
// Reseeds from `value` only across an external identity change while the field is clean (draft-epoch
// guard, matching JsonField's fixed branch). On unmount it clears its block so a removed row never leaves
// a stale save-block.
export function NumField(props: {
  id: string; // stable-per-instance key for the caller's invalid-set
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  onValidity: (id: string, valid: boolean) => void;
  ariaLabel: string;
  placeholder?: string;
  min?: number; // inclusive lower bound (e.g. 1 for max_concurrent, 0 for retry_attempts)
}) {
  const seed = () => (props.value == null ? "" : String(props.value));
  const [text, setText] = useState(seed);
  const [err, setErr] = useState(false);

  // Adopt an external change only when the current text still equals the last seed (clean); keep the
  // user's in-progress text otherwise. `lastSeed` advances to the new incoming value either way.
  const lastSeed = useRef(seed());
  const incoming = seed();
  if (incoming !== lastSeed.current && !err) {
    const clean = text === lastSeed.current;
    lastSeed.current = incoming;
    if (clean) setText(incoming);
  }

  // Clear the block when this field leaves the tree (row removed / provider renamed → remount).
  const validityRef = useRef(props.onValidity);
  validityRef.current = props.onValidity;
  const { id } = props;
  useEffect(() => () => validityRef.current(id, true), [id]);

  const parse = (t: string): number | null | undefined => {
    if (t.trim() === "") return null; // blank → null (inherit / unlimited)
    const n = Number(t);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined; // NaN / Infinity / non-integer
    if (props.min != null && n < props.min) return undefined;
    return n;
  };

  const onText = (t: string) => {
    setText(t);
    const v = parse(t);
    if (v === undefined) {
      setErr(true);
      props.onValidity(id, false); // block the save; do NOT emit a NaN→null value upstream
      return;
    }
    setErr(false);
    props.onValidity(id, true);
    props.onChange(v);
  };

  return (
    <>
      <input
        aria-label={props.ariaLabel}
        inputMode="numeric"
        className={"num-field" + (err ? " invalid" : "")}
        placeholder={props.placeholder}
        value={text}
        onChange={(e) => onText(e.target.value)}
      />
      {err && (
        <div className="json-err">
          must be a whole number{props.min != null ? ` ≥ ${props.min}` : ""}
        </div>
      )}
    </>
  );
}
