// Composer controller (D29 §14.2) — headless: the shared composer's behaviour with no markup, so every
// theme's composer presentation reuses it (input draft, prefix-routed send, inference/streaming gate,
// and the dictation mic) instead of re-wiring the underlying stores/hooks. Presentation concerns
// (auto-grow, the Enter-to-send key handler, the mic/send button DOM) stay in each theme's composer.

import { useDictation } from "./useDictation";
import { useVoiceStatus } from "./useVoiceStatus";
import { runComposer } from "../lib/composer";
import { useChat } from "../store/chat";
import { clearDraft, getDraft, setDraft, useDraft } from "../store/composer";

export interface ComposerController {
  draft: string;
  setDraft: (v: string) => void;
  /** Route + send the current draft (`!`→shell · `/`→slash · else→agent) then clear it. No-op while
   *  streaming or when the draft is blank. */
  send: () => void;
  isStreaming: boolean;
  /** The dictation mic state machine (idle/recording/sending/unavailable). */
  mic: ReturnType<typeof useDictation>;
  /** Whether STT is configured — the mic only renders when true. */
  sttReady: boolean;
}

export function useComposer(): ComposerController {
  const draft = useDraft();
  const { status } = useChat();
  const voice = useVoiceStatus();
  const sttReady = voice.data?.stt ?? false;
  const mic = useDictation({
    sttReady,
    statusStamp: voice.dataUpdatedAt,
    autoSend: voice.data?.stt_auto_send ?? false,
  });
  const isStreaming = status === "streaming";

  // Reads the draft imperatively (no stale closure) so it always sends what's currently typed.
  function send(): void {
    const text = getDraft().trim();
    if (!text || isStreaming) return;
    runComposer(text); // prefix routing: !shell · /slash · else agent (lib/composer)
    clearDraft();
  }

  return { draft, setDraft, send, isStreaming, mic, sttReady };
}
