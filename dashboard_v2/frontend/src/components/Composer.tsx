import { useRef, useState, type KeyboardEvent } from "react";

import { sendMessage, useChat } from "../store/chat";
import { setUI } from "../store/ui";

// Shared composer (fleet + agent tabs). Ported from vapor.html: auto-growing textarea, an
// embedded mic toggle, and the send button. Phase 4a wires send → the agent chat (and jumps to the
// Agent tab). Prefix routing ($/!/slash, /local //cloud) lands in 4c; STT in 6 — mic stays local.
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
    setUI({ tab: "agent" }); // route to chat (4c adds $/! prefix routing)
    void sendMessage(text);
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
