import { useRef, useState, type KeyboardEvent } from "react";

// Shared composer (fleet + agent tabs). Ported from vapor.html: auto-growing textarea, an
// embedded mic toggle, and the send button. Phase 1 wires only the local UX (grow, mic .rec);
// message routing ($/!/slash/agent) + STT land in Phase 4/5/6 — send is intentionally inert.

export function Composer() {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [rec, setRec] = useState(false);

  function autoSize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "";
    if (ta.value === "") return;
    ta.style.height = "auto";
    ta.style.height = Math.min(96, ta.scrollHeight) + "px";
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Phase 4: route to agent / exec. No-op for now.
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
      />
    </div>
  );
}
