import { useEffect, useId, useRef, useState } from "react";

import { WarnRow } from "./WarnRow";
import { XIcon } from "./icons";
import { modalKeyDown } from "../lib/focusTrap";
import { resolvePrompt, resolvePromptPair, usePrompt } from "../store/prompt";
import type { PromptPair } from "../types";

// Phase 7e-b — the one reusable full-page prompt editor. Opened imperatively via
// `requestPrompt({...})` (store/prompt.ts); every prompt/markdown field in Conf (System prompt +
// append, per-agent prompt + append, SKILL.md, and the 7e-c+ SOUL.md/MEMORY.md editors) routes
// through it so a real prompt gets a real editing surface instead of a 48–64px textarea.
//
// Phase 18 / D56 adds PAIR mode (§6 C-18): a registry prompt opened via `requestPromptPair` edits its
// `{override, append}` together, with the shipped default readable beside them and the derived
// placeholder list on show (§7 L-7). Same shell, same focus trap, same footer — only the body differs.
//
// Reuses the app's `--app-h` viewport shell (App.tsx sizes it to visualViewport.height), so the
// Android keyboard shrinks the modal correctly — the same reason the composer sits in normal flow.
// Styling = the shared kit rules (kit.css `.pm-*`; vapor's extras.css copy died at D51 V5).
//
// Focus management mirrors ConfirmDialog (F17): capture the trigger on open, focus the textarea,
// restore focus on close, Escape cancels, keydown scoped to the backdrop (not window). The focus
// trap cycles through the live focusable set (close ✕ → textarea → footer buttons → back); we
// query it each Tab because, unlike ConfirmDialog's fixed two buttons, the footer button count
// varies (Load/Restore only show when `defaultText` is set). Both halves now live in
// `lib/focusTrap` — extracted so the A3 automations sheet reuses them instead of copying them.
//
// Save semantics are the caller's (see store/prompt.ts): Save resolves with the edited text (or the
// edited pair), Cancel resolves with null. The modal never hits the backend.

/** A registry prompt's description, split into normal description text and the COUPLING note the
 *  editor must show as a warning. The convention is the registry's (`services/agent/prompts.py`): a
 *  description states what the prompt does, and where its wording is load-bearing for a runtime guard
 *  it says so after the literal marker `"Coupling: "` — machine-findable on purpose, so the two halves
 *  render differently without a second field on `PromptDef`. No marker → no warning line. */
function splitCoupling(description: string | null | undefined): [string, string | null] {
  const at = description?.indexOf("Coupling: ") ?? -1;
  if (!description || at < 0) return [description ?? "", null];
  return [description.slice(0, at).trim(), description.slice(at).trim()];
}

export function PromptModal() {
  const req = usePrompt();
  const labelId = useId();
  const fieldId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [text, setText] = useState("");
  const [pair, setPair] = useState<PromptPair>({ override: "", append: "" });

  // Seed the local draft synchronously the first render a new request opens — setting state during
  // render (React's "adjust state when a prop changes" pattern) re-runs before paint, so there's no
  // flashed frame of the *previous* field's text when one editor opens right after another.
  const seededFor = useRef<unknown>(null);
  if (req && seededFor.current !== req) {
    seededFor.current = req;
    if (req.kind === "pair") setPair({ override: req.override, append: req.append });
    else setText(req.value);
  }

  // Capture the opening trigger, focus the textarea, restore focus on close. The panel's FIRST
  // textarea is the field to land in under either mode (pair mode's is the override) — read off the
  // panel rather than a second ref, which pair mode would have to thread through a child.
  useEffect(() => {
    if (!req) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    queueMicrotask(() => panelRef.current?.querySelector("textarea")?.focus());
    return () => {
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    };
  }, [req]);

  if (!req) return null;

  const isPair = req.kind === "pair";
  const cap = req.kind === "pair" ? undefined : req.cap;
  // Pair mode counts BOTH fields: the model receives them concatenated, so the combined length is the
  // budget the number is there to make visible.
  const count = req.kind === "pair" ? pair.override.length + pair.append.length : text.length;
  const counter =
    cap != null
      ? `${Math.round((count / cap) * 100)}% — ${count.toLocaleString()}/${cap.toLocaleString()}`
      : `${count.toLocaleString()} chars`;
  const overCap = cap != null && count > cap;

  // Escape closes, Tab cycles the panel's LIVE focusable set — both from `lib/focusTrap`, which the
  // automations editor sheet shares (A3 slice 3). The behaviour is the one this modal has always had;
  // it just no longer lives here alone. `resolvePrompt(null)` cancels EITHER kind (store/prompt.ts).
  return (
    <div
      className="pm-backdrop"
      onKeyDown={(e) => modalKeyDown(e, panelRef.current, () => resolvePrompt(null))}
    >
      <div className="pm" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <div className="pm-head">
          <h3 id={labelId}>{req.title}</h3>
          <button className="pm-x" aria-label="Close" onClick={() => resolvePrompt(null)}>
            <XIcon />
          </button>
        </div>
        {req.kind === "pair" ? (
          <PairBody fieldId={fieldId} req={req} pair={pair} onChange={setPair} />
        ) : (
          <div className="pm-body">
            <textarea
              aria-labelledby={labelId}
              className={"pm-text" + ((req.mono ?? true) ? " mono" : "")}
              value={text}
              spellCheck={false}
              placeholder={req.placeholder}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        )}
        <div className="pm-foot">
          <div className={"pm-count" + (overCap ? " over" : "")}>{counter}</div>
          {req.kind === "pair" ? (
            // Only [Load default] here: the restore path is clearing BOTH fields (blank is unset,
            // §7 L-5), which the row's own Restore stages in one tap.
            <div className="pm-defaults">
              <button
                className="pm-alt"
                onClick={() => setPair((p) => ({ ...p, override: req.defaultText }))}
              >
                Load default
              </button>
            </div>
          ) : (
            req.defaultText != null && (
              <div className="pm-defaults">
                <button className="pm-alt" onClick={() => setText(req.defaultText as string)}>
                  Load default
                </button>
                <button className="pm-alt" onClick={() => setText("")}>
                  Restore default
                </button>
              </div>
            )
          )}
          <div className="pm-actions">
            <button className="pm-alt" onClick={() => resolvePrompt(null)}>
              Cancel
            </button>
            <button
              className="pm-save"
              onClick={() => (isPair ? resolvePromptPair(pair) : resolvePrompt(text))}
            >
              {req.saveLabel ?? "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Pair mode's body: the two labelled fields, the prompt's description + coupling note, its derived
 *  placeholders as chips, and the shipped default read-only. The default sits in a `<details>` so the
 *  390px phone opens on the editor; at desk width the CSS puts it in a second column beside it. */
function PairBody(props: {
  fieldId: string;
  req: { defaultText: string; description?: string | null; placeholders?: string[] };
  pair: PromptPair;
  onChange: (next: PromptPair) => void;
}) {
  const { fieldId, req, pair } = props;
  const [desc, coupling] = splitCoupling(req.description);
  const chips = req.placeholders ?? [];
  return (
    <div className="pm-body pm-pair">
      <div className="pm-pair-edit">
        {desc && <div className="pm-desc">{desc}</div>}
        {coupling && <WarnRow warnings={[coupling]} />}
        {chips.length > 0 && (
          <div className="pm-chips">
            {chips.map((name) => (
              <span className="pm-chip" key={name}>{`{{${name}}}`}</span>
            ))}
          </div>
        )}
        <label className="pm-flabel" htmlFor={`${fieldId}-o`}>
          Override
        </label>
        <textarea
          id={`${fieldId}-o`}
          className="pm-text mono"
          value={pair.override}
          spellCheck={false}
          placeholder="(empty → the shipped default)"
          onChange={(e) => props.onChange({ ...pair, override: e.target.value })}
        />
        <label className="pm-flabel" htmlFor={`${fieldId}-a`}>
          Append
        </label>
        <textarea
          id={`${fieldId}-a`}
          className="pm-text mono pm-text-min"
          value={pair.append}
          spellCheck={false}
          placeholder="added after the base, separated by a blank line"
          onChange={(e) => props.onChange({ ...pair, append: e.target.value })}
        />
      </div>
      {/* Folded on the 390px phone (the editor is what opens); OPEN from the start at the width where
          the CSS puts it in the second column — an empty column with a chevron is not the C-18
          "side-by-side" view. Read once per mount: React diffs against its own previous value, so a
          later user toggle is never fought. */}
      <details
        className="pm-def"
        // (`typeof` guard: jsdom has no matchMedia; the tests exercise the folded phone shape)
        open={
          (typeof matchMedia === "function" && matchMedia("(min-width: 700px)").matches) ||
          undefined
        }
      >
        <summary>Default text</summary>
        <div className="pm-defbody">{req.defaultText}</div>
      </details>
    </div>
  );
}
