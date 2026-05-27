import { useEffect, useRef, useState } from "react";
import { Send, Mic, Volume2, VolumeX } from "lucide-react";
import { sendChat } from "../api/queries";
import type { ChatMessage } from "../types";

const uid = () => Math.random().toString(36).slice(2, 10);

// Browser STT (Web Speech API) is used here as a stand-in. The production build
// will POST audio to /api/voice/stt (Whisper) and play /api/voice/tts output.
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};
function getRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function AgentView() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: uid(), role: "assistant", ts: new Date().toISOString(), content: "Ready. Ask me to check a host, restart a service, or search the web." },
  ]);
  const [input, setInput] = useState("");
  const [recording, setRecording] = useState(false);
  const [tts, setTts] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function submit(text: string) {
    const content = text.trim();
    if (!content) return;
    setInput("");
    const userMsg: ChatMessage = { id: uid(), role: "user", content, ts: new Date().toISOString() };
    const pending: ChatMessage = { id: uid(), role: "assistant", content: "…", ts: new Date().toISOString(), pending: true };
    setMessages((m) => [...m, userMsg, pending]);

    const reply = await sendChat(content);
    setMessages((m) => m.map((x) => (x.id === pending.id ? reply : x)));
    if (tts && "speechSynthesis" in window) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(reply.content));
    }
  }

  function toggleMic() {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    const rec = getRecognition();
    if (!rec) {
      alert("Speech recognition isn't available in this browser. The real build uses /api/voice/stt (Whisper).");
      return;
    }
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onresult = (e) => setInput(e.results[0][0].transcript);
    rec.onend = () => setRecording(false);
    recRef.current = rec;
    rec.start();
    setRecording(true);
  }

  return (
    <div className="agent">
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <p className="section-title" style={{ margin: 0 }}>
          Agent
        </p>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="icon-btn" title={tts ? "Voice replies on" : "Voice replies off"} onClick={() => setTts((v) => !v)}>
          {tts ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role} ${m.pending ? "pending" : ""}`}>
            <div className="who">{m.role === "user" ? "you" : "emma"}</div>
            {m.content}
          </div>
        ))}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message the agent…"
          aria-label="Message the agent"
        />
        <button type="button" className={`icon-btn mic ${recording ? "recording" : ""}`} onClick={toggleMic} title="Push to talk">
          <Mic size={18} />
        </button>
        <button type="submit" className="btn primary" disabled={!input.trim()}>
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}
