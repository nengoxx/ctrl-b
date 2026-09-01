// Composer controller (D29 §14.2) — headless: the shared composer's behaviour with no markup, so every
// theme's composer presentation reuses it (input draft, prefix-routed send, inference/streaming gate,
// and the dictation mic) instead of re-wiring the underlying stores/hooks. Presentation concerns
// (auto-grow, the Enter-to-send key handler, the mic/send button DOM) stay in each theme's composer.

import { useDictation } from "./useDictation";
import { useVoiceStatus } from "./useVoiceStatus";
import { runComposer } from "../lib/composer";
import { hasStaged, isUploading, useStagedFiles } from "../store/attachments";
import { useChatSlice } from "../store/chat";
import { clearDraft, getDraft, setDraft, useDraft } from "../store/composer";

export interface ComposerController {
  draft: string;
  setDraft: (v: string) => void;
  /** Route + send the current draft (`!`→shell · `/`→slash · else→agent) then clear it. No-op when
   *  there is NOTHING to send — a blank draft with no staged file (D68 §7: a photo with no caption
   *  is an ordinary send) — and while a staged file is still uploading. A send DURING a live turn is
   *  a STEER (D41), enqueued by the store's `sendMessage`/`runShell`; the send BUTTON stays Stop,
   *  but Enter (and mic auto-send) steer. */
  send: () => void;
  isStreaming: boolean;
  /** The dictation mic state machine (idle/recording/sending/unavailable). */
  mic: ReturnType<typeof useDictation>;
  /** Whether STT is configured — the mic only renders when true. */
  sttReady: boolean;
  /** There is something to send: a non-empty draft, OR staged attachments (D68 §7). The line
   *  variant's send button keys its existence off this. */
  sendable: boolean;
  /** A staged file's upload is still in flight — every variant's send is HELD (disabled) until it
   *  lands or fails (the R61 field convention; a `failed` chip never holds anything). */
  uploadPending: boolean;
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
    // Read the STAGED SET imperatively too (same no-stale-closure rule as the draft): an
    // attachment-only send is legal, and a send while a PUT is in flight would name an id the
    // server does not have yet.
    if (!text && !hasStaged()) return;
    if (isUploading()) return;
    // The staged ids are NOT passed from here: `runComposer`'s natural-language branch reads them
    // (D68 §7), so the button, Enter, a steer and the dictation auto-send — which bypasses this
    // function entirely and calls `runComposer` itself — all carry them with no plumbing.
    runComposer(text); // prefix routing: !shell · /slash · else agent (lib/composer)
    clearDraft();
  }

  // Subscribed (not read imperatively) because the BUTTONS render off these: the line variant shows
  // its send once something is sendable, and every variant disables it while an upload is in flight.
  const staged = useStagedFiles();
  return {
    draft,
    setDraft,
    send,
    isStreaming,
    mic,
    sttReady,
    sendable: draft.trim() !== "" || staged.length > 0,
    uploadPending: staged.some((f) => f.status === "uploading"),
  };
}
