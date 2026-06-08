import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { runComposer } from "../lib/composer";
import { useChat } from "../store/chat";
import { clearDraft, setDraft, useDraft } from "../store/composer";

// Shared composer (fleet + agent tabs). Ported from vapor.html: auto-growing textarea, an
// embedded mic toggle, and the send button. Submits route through runComposer (Phase 4c): `!<cmd>`
// → guarded shell (Phase-5 stub), `/<verb>` → slash commands (incl. /local //cloud), else → agent;
// every route jumps to the Agent tab. STT lands in Phase 6 — the mic stays a local toggle for now.
// Lives in normal flow at the bottom of the app-shell (App), so no bottom-padding bookkeeping.
//
// F28 — draft persistence. The textarea value is **controlled**: it lives in store/composer.ts
// rather than the DOM. That keeps what the user typed alive across (a) the conditional unmount
// when they switch to Conf/Utils (which hide the composer entirely), and (b) full page reload
// (persisted to localStorage). Cleared on send.

export function Composer() {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [rec, setRec] = useState(false);
  const draft = useDraft();
  const { status } = useChat();

  // Auto-grow the textarea to fit content (max 96px). Runs whenever the draft changes,
  // including the initial render — so a saved draft loaded from localStorage gets the right
  // height as soon as the composer becomes visible (mount / tab-switch-back / reload).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "";
    if (ta.value === "") return;
    ta.style.height = "auto";
    ta.style.height = Math.min(96, ta.scrollHeight) + "px";
  }, [draft]);

  function send() {
    const text = draft.trim();
    if (!text || status === "streaming") return;
    runComposer(text); // routes by prefix: !shell · /slash · else agent (lib/composer)
    clearDraft();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="composer" id="composer">
      <div className="field">
        <textarea
          ref={taRef}
          id="cmd-input"
          rows={1}
          placeholder="ask anything…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className={"mic" + (rec ? " rec" : "")}
          aria-label="toggle dictation"
          title="toggle dictation"
          onClick={() => setRec((r) => !r)}
        />
      </div>
      <button
        type="button"
        className="send"
        id="cmd-send"
        aria-label="send message"
        title="send message"
        disabled={status === "streaming"}
        onClick={send}
      />
    </div>
  );
}
