import { useEffect, useRef, useState } from "react";
import { Send, Mic, Volume2, VolumeX, X, Bot } from "lucide-react";
import { useChat } from "../api/queries";
import { createRecognizer, speak, stopSpeaking, type Recognizer } from "../lib/voice";
import { uid, clockTime } from "../lib/format";
import type { ChatMessage, ToolCall } from "../types";

const SUGGESTIONS = ["Wake g5", "Restart SearXNG", "Search the web for tailscale ACLs", "Any hosts need attention?"];

function ToolChip({ t }: { t: ToolCall }) {
  return (
    <div className="toolcall">
      <Bot size={13} />
      <span>{t.action === "web_search" ? "web search" : t.action.replace(/_/g, " ")}</span>
      <span className="tc-target">{t.target}</span>
    </div>
  );
}

export function AgentDock({ floating, onClose }: { floating: boolean; onClose: () => void }) {
  const chat = useChat();
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: uid(), role: "assistant", ts: new Date().toISOString(),
      content: "Ready. Ask me to check a host, wake a machine, restart a service, or search the web. I route everything through the typed action registry — no raw shell." },
  ]);
  const [input, setInput] = useState("");
  const [recording, setRecording] = useState(false);
  const [tts, setTts] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<Recognizer | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function submit(text: string) {
    const content = text.trim();
    if (!content || chat.isPending) return;
    setInput("");
    const userMsg: ChatMessage = { id: uid(), role: "user", content, ts: new Date().toISOString() };
    const pending: ChatMessage = { id: uid(), role: "assistant", content: "Thinking…", ts: new Date().toISOString(), pending: true };
    setMessages((m) => [...m, userMsg, pending]);

    try {
      const { message } = await chat.mutateAsync(content);
      setMessages((m) => m.map((x) => (x.id === pending.id ? message : x)));
      if (tts) speak(message.content);
    } catch {
      setMessages((m) => m.map((x) => (x.id === pending.id ? { ...x, content: "Request failed.", pending: false } : x)));
    }
  }

  function toggleMic() {
    if (recording) { recRef.current?.stop(); return; }
    const rec = createRecognizer({
      onPartial: (t) => t && setInput(t),
      onFinal: (t) => setInput(t),
      onEnd: () => setRecording(false),
    });
    if (!rec) {
      alert("Speech recognition isn't available in this browser.\nThe production build records audio and POSTs it to /api/voice/stt (Whisper).");
      return;
    }
    recRef.current = rec;
    rec.start();
    setRecording(true);
  }

  function toggleTts() {
    setTts((v) => {
      if (v) stopSpeaking();
      return !v;
    });
  }

  return (
    <aside className={`dock ${floating ? "floating" : ""}`}>
      <div className="dock-head">
        <Bot size={17} style={{ color: "var(--accent)" }} />
        <div>
          <div className="d-title">Agent</div>
          <div className="d-sub">text · voice · tools</div>
        </div>
        <span className="spacer" />
        <button className="icon-btn" onClick={toggleTts} title={tts ? "Voice replies on" : "Voice replies off"}>
          {tts ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
        {floating && <button className="icon-btn" onClick={onClose} title="Close"><X size={16} /></button>}
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role} ${m.pending ? "pending" : ""}`}>
            <div className="who">{m.role === "user" ? "you" : "agent"} · {clockTime(m.ts)}</div>
            <div className="bubble">{m.content}</div>
            {m.toolCalls && (
              <div className="toolcalls">
                {m.toolCalls.map((t, i) => <ToolChip key={i} t={t} />)}
              </div>
            )}
          </div>
        ))}
      </div>

      {messages.length <= 1 && (
        <div className="suggest">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => submit(s)}>{s}</button>
          ))}
        </div>
      )}

      <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(input); }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input); }
          }}
          placeholder={recording ? "Listening…" : "Message the agent…"}
          rows={1}
          aria-label="Message the agent"
        />
        <button type="button" className={`icon-btn mic ${recording ? "recording" : ""}`} onClick={toggleMic} title="Push to talk">
          <Mic size={18} />
        </button>
        <button type="submit" className="btn primary" disabled={!input.trim() || chat.isPending} title="Send">
          <Send size={15} />
        </button>
      </form>
    </aside>
  );
}
