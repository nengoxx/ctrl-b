import { useEffect, useRef, useState } from "react";

import { useAppChrome } from "../hooks/useAppChrome";
import { useConnection } from "../store/connection";

// Top bar: brand lozenge (logo or spinning ring via body[data-loz]) + auto-TTS toggle.
// The toggle flips a themed mask icon (speaker ↔ slashed-speaker) and flashes a toast — ported
// from vapor.html. 6b-2: it now gates *real* auto read-aloud (useAutoTts) of completed replies, and
// muting it stops any audio playing now. Shown only when TTS is configured (/voice/status tts:true).
//
// F16 — when the activity-stream SSE drops, a small `.conn-badge` appears between the brand
// and the TTS button so the owner can see the live feed is currently broken. The brand has
// `flex: 1` so it shrinks to make room; CSS in extras.css (vapor.css untouched, D7).

// `transparent` (global appbarMode="transparent") stamps a `.transparent` modifier so vapor.css null-paints
// the bar (additive rule — byte-identical DOM when the mode isn't transparent, per the ladder rule).
export function AppBar({ transparent = false }: { transparent?: boolean } = {}) {
  // Voice control from the headless app-chrome controller (D29 §14.2); the muting-stops-audio behavior
  // lives in `toggleAutoTts` now. The toast flash below stays vapor presentation.
  const { ttsAuto, ttsConfigured, toggleAutoTts } = useAppChrome();
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
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [ttsAuto]);

  return (
    <>
      <div className={"appbar" + (transparent ? " transparent" : "")}>
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
            onClick={toggleAutoTts}
          />
        )}
      </div>
      <div className={"tts-toast" + (toast ? " show" : "") + (toast && !toast.on ? " off" : "")}>
        <b>auto-tts</b> {toast?.on === false ? "muted" : "on"}
      </div>
    </>
  );
}
