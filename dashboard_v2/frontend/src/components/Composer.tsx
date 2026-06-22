import { useEffect, useRef, type KeyboardEvent } from "react";

import { useDictation } from "../hooks/useDictation";
import { useVoiceStatus } from "../hooks/useVoiceStatus";
import { runComposer } from "../lib/composer";
import { useChat } from "../store/chat";
import { clearDraft, setDraft, useDraft } from "../store/composer";

// Shared composer (fleet + agent tabs). Ported from vapor.html: auto-growing textarea, an
// embedded mic toggle, and the send button. Submits route through runComposer (Phase 4c): `!<cmd>`
// → guarded shell (Phase-5 stub), `/<verb>` → slash commands (incl. /local //cloud), else → agent;
// every route jumps to the Agent tab.
// Lives in normal flow at the bottom of the app-shell (App), so no bottom-padding bookkeeping.
//
// Phase 6b-1 — the mic is now a real tap-to-start/tap-to-stop dictation control (useDictation), driven
// by the recorder's actual state (no local `rec` toggle). It's shown only when /voice/status reports
// STT configured (useVoiceStatus); a failed STT chain greys it out reactively. See useDictation for
// the four-state machine.
//
// F28 — draft persistence. The textarea value is **controlled**: it lives in store/composer.ts
// rather than the DOM. That keeps what the user typed alive across (a) the conditional unmount
// when they switch to Conf/Utils (which hide the composer entirely), and (b) full page reload
// (persisted to localStorage). Cleared on send.

const MIC_LABEL: Record<string, string> = {
  idle: "start dictation",
  recording: "stop dictation",
  sending: "transcribing…",
  unavailable: "voice servers unreachable",
};

export function Composer() {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const draft = useDraft();
  const { status } = useChat();
  // Voice capability + dictation. The mic only renders when STT is configured (stt:false → hidden,
  // per the owner's state #3); the recorder's real phase drives the button class.
  const voice = useVoiceStatus();
  const sttReady = voice.data?.stt ?? false;
  const mic = useDictation(sttReady, voice.dataUpdatedAt);

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
        {sttReady && (
          <button
            type="button"
            className={
              "mic" +
              (mic.status === "recording" ? " rec" : "") +
              (mic.status === "unavailable" ? " unavail" : "")
            }
            aria-label={MIC_LABEL[mic.status]}
            title={MIC_LABEL[mic.status]}
            aria-pressed={mic.status === "recording"}
            disabled={mic.status === "unavailable" || mic.status === "sending"}
            onClick={mic.toggle}
          />
        )}
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
