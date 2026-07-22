import { useEffect, useRef, useState } from "react";

// A11 / D48 B1 — a guarded JSON-object textarea (the provider model `extra_body` chat-call passthrough).
// Precedent: ServerListEditor's kv/list textareas — but JSON needs validation, so this parses on every
// keystroke: a valid object is emitted through `onChange`, invalid text is kept in the field, shown with
// an inline error, and reported via `onValidity(id,false)` so the caller can BLOCK the save (invalid JSON
// must never reach the PUT). Blank = `null` (no extra_body). Reseeds from `value` only across an external
// identity change (e.g. a save reconcile), never mid-edit. On unmount it clears its block (reports valid)
// so a removed/renamed row never leaves a stale save-block. Vapor `.kv-text` recipe (extras.css).
export function JsonField(props: {
  id: string; // stable-per-instance key for the caller's invalid-set
  value: Record<string, unknown> | null | undefined;
  onChange: (v: Record<string, unknown> | null) => void;
  onValidity: (id: string, valid: boolean) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  const seed = () =>
    props.value && Object.keys(props.value).length ? JSON.stringify(props.value, null, 2) : "";
  const [text, setText] = useState(seed);
  const [err, setErr] = useState<string | null>(null);
  // Reseed only when the external value genuinely changes identity while the field is clean-ish (no
  // parse error and the current text already round-trips to it) — mirrors the draft-epoch guard so a
  // background settings refetch can't clobber an in-progress edit.
  const lastSeed = useRef(JSON.stringify(props.value ?? null));
  const incoming = JSON.stringify(props.value ?? null);
  if (incoming !== lastSeed.current && err === null) {
    let current: unknown = null;
    try {
      current = text.trim() === "" ? null : JSON.parse(text);
    } catch {
      current = Symbol("dirty"); // unparseable → treat as dirty, keep the user's text
    }
    // Adopt the incoming value ONLY when the current text still ROUND-TRIPS to the previous seed (the
    // field is clean); when the text has diverged (dirty) or is unparseable, keep it. This is the fixed
    // branch — the prior code inverted it, adopting on divergence and clobbering an in-progress edit
    // (Codex#11). `lastSeed` advances to the new incoming in both cases (idempotent per external change).
    const clean = JSON.stringify(current) === lastSeed.current;
    lastSeed.current = incoming;
    if (clean) setText(seed());
  }

  // Clear the block when this field leaves the tree (row removed / provider renamed → remount).
  const validityRef = useRef(props.onValidity);
  validityRef.current = props.onValidity;
  const { id } = props;
  useEffect(() => () => validityRef.current(id, true), [id]);

  const onText = (t: string) => {
    setText(t);
    if (t.trim() === "") {
      setErr(null);
      props.onValidity(id, true);
      props.onChange(null);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(t);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("must be a JSON object");
      }
      setErr(null);
      props.onValidity(id, true);
      props.onChange(parsed as Record<string, unknown>);
    } catch (e) {
      setErr((e as Error).message);
      props.onValidity(id, false);
    }
  };

  return (
    <>
      <textarea
        aria-label={props.ariaLabel}
        className={"kv-text json-field" + (err ? " invalid" : "")}
        placeholder={props.placeholder ?? '{ "cache_prompt": true }'}
        value={text}
        onChange={(e) => onText(e.target.value)}
      />
      {err && <div className="json-err">invalid JSON — {err}</div>}
    </>
  );
}
