import { useEffect, useRef, useState } from "react";

import { useVoiceStatus } from "../hooks/useVoiceStatus";
import { dismiss as stopAudio } from "../lib/audioController";
import { useConnection } from "../store/connection";
import { setUI, useUISlice } from "../store/ui";

// Top bar: brand lozenge (logo or spinning ring via body[data-loz]) + auto-TTS toggle.
// The toggle flips a themed mask icon (speaker ↔ slashed-speaker) and flashes a toast — ported
// from vapor.html. 6b-2: it now gates *real* auto read-aloud (useAutoTts) of completed replies, and
// muting it stops any audio playing now. Shown only when TTS is configured (/voice/status tts:true).
//
// F16 — when the activity-stream SSE drops, a small `.conn-badge` appears between the brand
// and the TTS button so the owner can see the live feed is currently broken. The brand has
// `flex: 1` so it shrinks to make room; CSS in extras.css (vapor.css untouched, D7).

export function AppBar() {
  const ttsAuto = useUISlice((s) => s.ttsAuto);
  const ttsConfigured = useVoiceStatus().data?.tts ?? false;
  const conn = useConnection();
  const [toast, setToast] = useState<{ on: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    // Skip the toast on first paint; only flash on user toggles.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setToast({ on: ttsAuto });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 1100);
    if (!ttsAuto) stopAudio(); // muting auto-TTS silences whatever's playing now
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [ttsAuto]);

  return (
    <>
      <div className="appbar">
        <div className="brand">
          <div className="lozenge" />
          <span className="mark">ctrl·b</span>
          <span className="meta">dashboard</span>
        </div>
        {conn !== "connected" && (
          <div
            className={`conn-badge ${conn}`}
            role="status"
            aria-live="polite"
            title={conn === "reconnecting" ? "Reconnecting to live feed…" : "Live feed offline"}
          >
            <span className="dot" aria-hidden />
            <span className="lbl">{conn === "reconnecting" ? "reconnecting" : "offline"}</span>
          </div>
        )}
        {ttsConfigured && (
          <button
            className={"tts-btn" + (ttsAuto ? "" : " muted")}
            title={ttsAuto ? "auto-tts on — tap to mute" : "auto-tts muted — tap to enable"}
            aria-pressed={ttsAuto}
            aria-label="auto text-to-speech"
            onClick={() => setUI({ ttsAuto: !ttsAuto })}
          />
        )}
      </div>
      <div className={"tts-toast" + (toast ? " show" : "") + (toast && !toast.on ? " off" : "")}>
        <b>auto-tts</b> {toast?.on === false ? "muted" : "on"}
      </div>
    </>
  );
}
