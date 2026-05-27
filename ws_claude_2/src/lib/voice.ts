// Voice layer. Two halves:
//
//   STT  — push-to-talk. The prototype uses the browser Web Speech API as a
//          stand-in so the mic button is real today. The production build POSTs
//          recorded audio to /api/voice/stt (Whisper / faster-whisper on your
//          OpenAI-compatible endpoint) — see sttViaBackend() for the shape.
//   TTS  — speak the agent's replies. Prototype uses speechSynthesis; production
//          streams audio from /api/voice/tts (openedai-speech / Piper / Kokoro).
//
// Keeping both behind this module means the views never touch the browser APIs
// directly, so swapping in the real endpoints is isolated here.

export interface Recognizer {
  start(): void;
  stop(): void;
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> & { length: number } }) => void;
  onerror: (e: unknown) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

export function isSttAvailable(): boolean {
  const w = window as unknown as Record<string, unknown>;
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

/** Push-to-talk recognizer. `onPartial` fires with interim text, `onFinal`
 *  with the settled transcript, `onEnd` when the mic closes. */
export function createRecognizer(opts: {
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd?: () => void;
}): Recognizer | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    let interim = "";
    let final = "";
    for (let i = 0; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (i === e.results.length - 1 && interim === "") interim = t;
      final += t;
    }
    opts.onPartial?.(interim);
    opts.onFinal(final.trim());
  };
  rec.onerror = () => opts.onEnd?.();
  rec.onend = () => opts.onEnd?.();
  return { start: () => rec.start(), stop: () => rec.stop() };
}

/** Production STT: POST the recorded blob to the backend Whisper endpoint. */
export async function sttViaBackend(audio: Blob): Promise<string> {
  const fd = new FormData();
  fd.append("file", audio, "speech.webm");
  const res = await fetch("/api/voice/stt", { method: "POST", body: fd });
  const data = (await res.json()) as { text: string };
  return data.text;
}

let voices: SpeechSynthesisVoice[] = [];
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  const load = () => (voices = window.speechSynthesis.getVoices());
  load();
  window.speechSynthesis.onvoiceschanged = load;
}

/** Speak text. Prototype path uses the browser; production should fetch
 *  /api/voice/tts and play the returned audio stream instead. */
export function speak(text: string): void {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const preferred = voices.find((v) => /en-US/i.test(v.lang) && /natural|google|samantha/i.test(v.name));
  if (preferred) u.voice = preferred;
  u.rate = 1.05;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
