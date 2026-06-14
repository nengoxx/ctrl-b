import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { resolvePrompt, usePrompt } from "../store/prompt";

// Phase 7e-b — the one reusable full-page prompt editor. Opened imperatively via
// `requestPrompt({...})` (store/prompt.ts); every prompt/markdown field in Conf (System prompt +
// append, per-agent prompt + append, SKILL.md, and the 7e-c+ SOUL.md/MEMORY.md editors) routes
// through it so a real prompt gets a real editing surface instead of a 48–64px textarea.
//
// Reuses the app's `--app-h` viewport shell (App.tsx sizes it to visualViewport.height), so the
// Android keyboard shrinks the modal correctly — the same reason the composer sits in normal flow.
// Net-new CSS lives in theme/extras.css (`.pm-*`); vapor.css stays untouched (D7).
//
// Focus management mirrors ConfirmDialog (F17): capture the trigger on open, focus the textarea,
// restore focus on close, Escape cancels, keydown scoped to the backdrop (not window). The focus
// trap cycles through the live focusable set (close ✕ → textarea → footer buttons → back); we
// query it each Tab because, unlike ConfirmDialog's fixed two buttons, the footer button count
// varies (Load/Restore only show when `defaultText` is set).
//
// Save semantics are the caller's (see store/prompt.ts): Save resolves with the edited text, Cancel
// resolves with null. The modal never hits the backend.

export function PromptModal() {
  const req = usePrompt();
  const labelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [text, setText] = useState("");

  // Seed the local draft synchronously the first render a new request opens — setting state during
  // render (React's "adjust state when a prop changes" pattern) re-runs before paint, so there's no
  // flashed frame of the *previous* field's text when one editor opens right after another.
  const seededFor = useRef<unknown>(null);
  if (req && seededFor.current !== req) {
    seededFor.current = req;
    setText(req.value);
  }

  // Capture the opening trigger, focus the textarea, restore focus on close.
  useEffect(() => {
    if (!req) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    queueMicrotask(() => textRef.current?.focus());
    return () => {
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    };
  }, [req]);

  if (!req) return null;

  const mono = req.mono ?? true;
  const cap = req.cap;
  const count = text.length;
  const counter =
    cap != null
      ? `${Math.round((count / cap) * 100)}% — ${count.toLocaleString()}/${cap.toLocaleString()}`
      : `${count.toLocaleString()} chars`;
  const overCap = cap != null && count > cap;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      resolvePrompt(null);
    } else if (e.key === "Tab") {
      // Trap focus within the panel — cycle the live focusable set deterministically (Tab in a
      // textarea moves focus by default, so without this it could escape once more items change).
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>("textarea, button"),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey
        ? items[(i - 1 + items.length) % items.length]
        : items[(i + 1) % items.length];
      next.focus();
    }
  };

  return (
    <div className="pm-backdrop" onKeyDown={onKeyDown}>
      <div
        className="pm"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
      >
        <div className="pm-head">
          <h3 id={labelId}>{req.title}</h3>
          <button className="pm-x" aria-label="Close" onClick={() => resolvePrompt(null)}>
            ✕
          </button>
        </div>
        <div className="pm-body">
          <textarea
            ref={textRef}
            className={"pm-text" + (mono ? " mono" : "")}
            value={text}
            spellCheck={false}
            placeholder={req.placeholder}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="pm-foot">
          <div className={"pm-count" + (overCap ? " over" : "")}>{counter}</div>
          {req.defaultText != null && (
            <div className="pm-defaults">
              <button className="pm-alt" onClick={() => setText(req.defaultText as string)}>
                Load default
              </button>
              <button className="pm-alt" onClick={() => setText("")}>
                Restore default
              </button>
            </div>
          )}
          <div className="pm-actions">
            <button className="pm-alt" onClick={() => resolvePrompt(null)}>
              Cancel
            </button>
            <button className="pm-save" onClick={() => resolvePrompt(text)}>
              {req.saveLabel ?? "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
