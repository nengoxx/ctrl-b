import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { useComposer } from "../hooks/useComposer";
import { stopTurn } from "../store/chat";

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
  insecure: "microphone needs a secure (HTTPS) connection",
};

export function Composer() {
  const taRef = useRef<HTMLTextAreaElement>(null);
  // All behaviour comes from the headless controller (draft, prefix-routed send, streaming gate, mic).
  // This component owns only vapor's composer DOM + presentation concerns (auto-grow, Enter-to-send).
  const { draft, setDraft, send, isStreaming, mic, sttReady } = useComposer();

  // Mic press feedback as a JS-toggled class (not CSS `:active`, which Fennec leaves wedged after a
  // tap → the button stayed shrunk). pointerdown shrinks; up/cancel/leave restore; a short safety
  // timeout guarantees restore even if a release event is dropped, so it never wedges small.
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
              (micPressed ? " press" : "") +
              // Grey for both blocked states; `insecure` stays tappable (not disabled) so a tap can
              // re-explain the HTTPS fix instead of reading as a dead/stuck control.
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
          />
        )}
      </div>
      {/* While a turn streams, the send button becomes a Stop control (D39): a square glyph (`.stop`
          swaps the arrow mask in vapor.css) that cancels the server-owned turn. Not disabled while
          streaming any more — that's the whole point; `stopTurn` guards double-taps. */}
      <button
        type="button"
        className={"send" + (isStreaming ? " stop" : "")}
        id="cmd-send"
        aria-label={isStreaming ? "stop turn" : "send message"}
        title={isStreaming ? "stop turn" : "send message"}
        onClick={isStreaming ? stopTurn : send}
      />
    </div>
  );
}
