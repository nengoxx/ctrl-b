import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { useComposer } from "../../hooks/useComposer";

// Kit composer (D29 §14.4) — token-driven, `.kit-*` classes. Same behaviour as vapor's Composer (draft,
// prefix-routed send, streaming gate, dictation mic) via the SAME headless controller (useComposer); only
// the markup/icons differ. Presentation concerns (auto-grow, Enter-to-send, mic-press feedback) mirror
// vapor's Composer so a reskin keeps the exact UX. Inline SVG mic/send icons.

const MIC_LABEL: Record<string, string> = {
  idle: "start dictation",
  recording: "stop dictation",
  sending: "transcribing…",
  unavailable: "voice servers unreachable",
  insecure: "microphone needs a secure (HTTPS) connection",
};

export function KitComposer() {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { draft, setDraft, send, isStreaming, mic, sttReady } = useComposer();

  // Mic press feedback as a JS-toggled class (not CSS :active — Fennec leaves :active wedged after a tap).
  const [micPressed, setMicPressed] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressMic = () => {
    setMicPressed(true);
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setMicPressed(false), 200);
  };
  const releaseMic = () => {
    clearTimeout(pressTimer.current);
    setMicPressed(false);
  };
  useEffect(() => () => clearTimeout(pressTimer.current), []);

  // Auto-grow the textarea to fit content (max 96px), including the initial render so a restored draft
  // gets the right height as soon as the composer becomes visible.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "";
    if (ta.value === "") return;
    ta.style.height = "auto";
    ta.style.height = Math.min(96, ta.scrollHeight) + "px";
  }, [draft]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="kit-composer" id="composer">
      <div className="field">
        <textarea
          ref={taRef}
          id="cmd-input"
          rows={1}
          placeholder="How can I help you today?"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="crow">
        <span className="grow" />
        {sttReady && (
          <button
            type="button"
            className={
              "kit-cbtn mic" +
              (mic.status === "recording" ? " rec" : "") +
              (micPressed ? " press" : "") +
              (mic.status === "unavailable" || mic.status === "insecure" ? " unavail" : "")
            }
            aria-label={MIC_LABEL[mic.status]}
            title={MIC_LABEL[mic.status]}
            aria-pressed={mic.status === "recording"}
            disabled={mic.status === "unavailable" || mic.status === "sending"}
            onPointerDown={pressMic}
            onPointerUp={releaseMic}
            onPointerCancel={releaseMic}
            onPointerLeave={releaseMic}
            onClick={mic.toggle}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="kit-send"
          id="cmd-send"
          aria-label="send message"
          title="send message"
          disabled={isStreaming}
          onClick={send}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
