import { useRef, useState, type KeyboardEvent } from "react";

import { runComposer } from "../lib/composer";
import { useChat } from "../store/chat";

// Shared composer (fleet + agent tabs). Ported from vapor.html: auto-growing textarea, an
// embedded mic toggle, and the send button. Submits route through runComposer (Phase 4c): `!<cmd>`
// → guarded shell (Phase-5 stub), `/<verb>` → slash commands (incl. /local //cloud), else → agent;
// every route jumps to the Agent tab. STT lands in Phase 6 — the mic stays a local toggle for now.
// Lives in normal flow at the bottom of the app-shell (App), so no bottom-padding bookkeeping.

export function Composer() {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [rec, setRec] = useState(false);
  const { status } = useChat();

  function autoSize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "";
    if (ta.value === "") return;
    ta.style.height = "auto";
    ta.style.height = Math.min(96, ta.scrollHeight) + "px";
  }

  function send() {
    const ta = taRef.current;
    if (!ta) return;
    const text = ta.value.trim();
    if (!text || status === "streaming") return;
    runComposer(text); // routes by prefix: !shell · /slash · else agent (lib/composer)
    ta.value = "";
    autoSize();
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
          onInput={autoSize}
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
