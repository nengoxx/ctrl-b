import { Bot, Mic, Send, Volume2, VolumeX } from "lucide-react";
import type { ChatMessage } from "../types/models";

type Props = {
  messages: ChatMessage[];
  draft: string;
  listening: boolean;
  responding: boolean;
  ttsEnabled: boolean;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  onToggleListening: () => void;
  onToggleTts: () => void;
};

export function AgentPanel({
  messages,
  draft,
  listening,
  responding,
  ttsEnabled,
  onDraftChange,
  onSend,
  onToggleListening,
  onToggleTts,
}: Props) {
  return (
    <aside className="panel agent-panel">
      <div className="panel-heading compact">
        <div>
          <h2>Agent</h2>
          <p>Mocked text and voice controls</p>
        </div>
        <button className={ttsEnabled ? "icon-button active" : "icon-button"} onClick={onToggleTts} title="Toggle TTS" type="button">
          {ttsEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
        </button>
      </div>

      <div className="message-list" aria-live="polite">
        {messages.map((message) => (
          <div className={`message ${message.speaker}`} key={message.id}>
            <span className="message-meta">
              {message.speaker === "agent" ? "Agent" : "You"} / {message.time}
            </span>
            <p>{message.text}</p>
          </div>
        ))}
        {responding && (
          <div className="message agent">
            <span className="message-meta">Agent / now</span>
            <p>Checking mocked host and service state...</p>
          </div>
        )}
      </div>

      <div className="voice-box">
        <button className={listening ? "voice-button listening" : "voice-button"} onClick={onToggleListening} type="button">
          {listening ? <Bot size={18} /> : <Mic size={18} />}
          <span>{listening ? "Stop mock recording" : "Push to talk"}</span>
        </button>
        <span>{ttsEnabled ? "TTS enabled" : "TTS muted"}</span>
      </div>

      <form
        className="agent-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="Ask about a host or service"
        />
        <button className="icon-button active" type="submit" title="Send message">
          <Send size={17} />
        </button>
      </form>
    </aside>
  );
}
