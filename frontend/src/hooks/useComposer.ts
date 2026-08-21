// Composer controller (D29 §14.2) — headless: the shared composer's behaviour with no markup, so every
// theme's composer presentation reuses it (input draft, prefix-routed send, inference/streaming gate,
// and the dictation mic) instead of re-wiring the underlying stores/hooks. Presentation concerns
// (auto-grow, the Enter-to-send key handler, the mic/send button DOM) stay in each theme's composer.

import { useDictation } from "./useDictation";
import { useVoiceStatus } from "./useVoiceStatus";
import { runComposer } from "../lib/composer";
import { useChatSlice } from "../store/chat";
import { clearDraft, getDraft, setDraft, useDraft } from "../store/composer";

export interface ComposerController {
  draft: string;
  setDraft: (v: string) => void;
  /** Route + send the current draft (`!`→shell · `/`→slash · else→agent) then clear it. No-op only
   *  when the draft is blank — a send DURING a live turn is a STEER (D41), enqueued by the store's
   *  `sendMessage`/`runShell`; the send BUTTON stays Stop, but Enter (and mic auto-send) steer. */
  send: () => void;
  isStreaming: boolean;
  /** The dictation mic state machine (idle/recording/sending/unavailable). */
  mic: ReturnType<typeof useDictation>;
  /** Whether STT is configured — the mic only renders when true. */
  sttReady: boolean;
}

export function useComposer(): ComposerController {
  const draft = useDraft();
  // Slice only `status` — `useChat()` would re-render the composer/mic/voice subtree on every streamed token.
  const status = useChatSlice((s) => s.status);
  const voice = useVoiceStatus();
  const sttReady = voice.data?.stt ?? false;
  const mic = useDictation({
    sttReady,
    statusStamp: voice.dataUpdatedAt,
    autoSend: voice.data?.stt_auto_send ?? false,
    // R51 Tier 0 — the mic's silence auto-stop policy rides the same always-on probe as auto-send;
    // absent (older backend / stub) → undefined → plain push-to-talk.
    autoStop: voice.data?.stt_auto_stop,
  });
  const isStreaming = status === "streaming";

  // Reads the draft imperatively (no stale closure) so it always sends what's currently typed. NO
  // `isStreaming` gate (HIGH-1, owner-ratified UX): while a turn streams, Enter/mic-send STEER — the
  // store's `sendMessage`/`runShell` enqueue a 202 steer bubble. Only the send BUTTON stays Stop
  // (`isStreaming ? stopTurn : send` in each composer variant); Enter routes through here to steer.
  function send(): void {
    const text = getDraft().trim();
    if (!text) return;
    runComposer(text); // prefix routing: !shell · /slash · else agent (lib/composer)
    clearDraft();
  }

  return { draft, setDraft, send, isStreaming, mic, sttReady };
}
