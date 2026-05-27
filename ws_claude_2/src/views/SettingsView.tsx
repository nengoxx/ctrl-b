import { useState } from "react";
import { Info } from "lucide-react";

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return <button className={`switch ${on ? "on" : ""}`} onClick={onToggle} role="switch" aria-checked={on} />;
}

// Settings is a scaffold: it shows the shape of what the FastAPI backend will
// persist (endpoints, voice, behavior). Nothing here is wired to a real config
// yet — the live values come from config.yaml on the server side.
export function SettingsView() {
  const [voiceReplies, setVoiceReplies] = useState(false);
  const [confirmDestructive, setConfirmDestructive] = useState(true);
  const [autoWake, setAutoWake] = useState(false);

  return (
    <>
      <div className="banner">
        <Info size={16} />
        <span>Prototype settings. The real values are served by the FastAPI backend from <span className="mono">config.yaml</span> — secrets never reach the browser.</span>
      </div>

      <div className="set-section">
        <p className="section-title"><b>Endpoints</b></p>
        <div className="card panel">
          <div className="set-row">
            <div>
              <div className="s-label">Chat / agent (OpenAI-compatible)</div>
              <div className="s-desc">Used for chat and tool-calling</div>
            </div>
            <span className="spacer" />
            <input className="field" defaultValue="http://corsair:5001/v1" />
          </div>
          <div className="set-row">
            <div>
              <div className="s-label">Speech-to-text (Whisper)</div>
              <div className="s-desc">POST /api/voice/stt</div>
            </div>
            <span className="spacer" />
            <input className="field" defaultValue="http://corsair:9000/v1" />
          </div>
          <div className="set-row">
            <div>
              <div className="s-label">Text-to-speech</div>
              <div className="s-desc">openedai-speech / Piper / Kokoro</div>
            </div>
            <span className="spacer" />
            <input className="field" defaultValue="http://corsair:8001/v1" />
          </div>
          <div className="set-row">
            <div>
              <div className="s-label">SearXNG MCP</div>
              <div className="s-desc">Web search tool for the agent</div>
            </div>
            <span className="spacer" />
            <input className="field" defaultValue="http://emma:8080" />
          </div>
        </div>
      </div>

      <div className="set-section">
        <p className="section-title"><b>Behavior</b></p>
        <div className="card panel">
          <div className="set-row">
            <div>
              <div className="s-label">Speak agent replies</div>
              <div className="s-desc">Auto-play TTS for each response</div>
            </div>
            <span className="spacer" />
            <Toggle on={voiceReplies} onToggle={() => setVoiceReplies((v) => !v)} />
          </div>
          <div className="set-row">
            <div>
              <div className="s-label">Confirm destructive actions</div>
              <div className="s-desc">Shutdown, stop, restart, kill</div>
            </div>
            <span className="spacer" />
            <Toggle on={confirmDestructive} onToggle={() => setConfirmDestructive((v) => !v)} />
          </div>
          <div className="set-row">
            <div>
              <div className="s-label">Wake fleet on tailnet join</div>
              <div className="s-desc">Send WOL to tagged hosts when your phone connects</div>
            </div>
            <span className="spacer" />
            <Toggle on={autoWake} onToggle={() => setAutoWake((v) => !v)} />
          </div>
        </div>
      </div>

      <div className="set-section">
        <p className="section-title"><b>Add to fleet</b></p>
        <div className="card panel">
          <div className="s-desc" style={{ marginBottom: 10 }}>
            New hosts and services live in <span className="mono">config.yaml</span> today. In-UI editing arrives with the
            backend; that's the point where a small datastore replaces the flat file.
          </div>
          <button className="btn" disabled>Add host…</button>
        </div>
      </div>
    </>
  );
}
