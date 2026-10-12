// Composer controller (D29 §14.2) — headless: the shared composer's behaviour with no markup, so every
// theme's composer presentation reuses it (input draft, prefix-routed send, inference/streaming gate,
// and the dictation mic) instead of re-wiring the underlying stores/hooks. Presentation concerns
// (auto-grow, the Enter-to-send key handler, the mic/send button DOM) stay in each theme's composer.

import { useDictation } from "./useDictation";
import { useVoiceStatus } from "./useVoiceStatus";
import { primeReplyHold } from "../lib/audioController";
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
  /** Whether LIVE VOICE (call mode) is configured+enabled (D71 §5.1) — the mic button's SECOND mode.
   *  False until S1's backend delivers the bit, which is what keeps the call half of the dual-mode
   *  gesture unreachable while it ships. */
  liveReady: boolean;
  /** There is something to send: a non-empty draft, OR a READY staged attachment (D68 §7). The line
   *  variant's send button keys its existence off this — and "ready" is what keeps a rail holding
   *  nothing but a failed chip from arming a send that would carry nothing (MED-5). */
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
  const liveReady = voice.data?.live ?? false;
  const mic = useDictation({
    sttReady,
    statusStamp: voice.dataUpdatedAt,
    autoSend: voice.data?.stt_auto_send ?? false,
    // R51 Tier 0 — the mic's silence auto-stop policy rides the same always-on probe as auto-send;
    // absent (older backend / stub) → undefined → plain push-to-talk.
    autoStop: voice.data?.stt_auto_stop,
    // ISS-84 — the clip upload's bound + retry budget, off the same probe; absent (older backend /
    // stub) → the old single unbounded attempt.
    upload: voice.data?.stt_upload,
    // ISS-73 ① — the hidden-page hold's switch + bound, which the upload loop arms on a hidden page;
    // absent (older backend / stub) → no hold.
    background: voice.data?.tts_background,
    // D71 S2.5 — phrase-by-phrase streaming dictation, off the same probe again. `live_ear` is the
    // EAR's own bit (the WS route's own terms; since S3.5 the dictation toggle alone opens it),
    // deliberately not `live`: dictation fills the composer and needs no mouth, so a TTS-less or
    // call-less install still streams. Both absent → today's whole-clip path.
    liveEar: voice.data?.live_ear,
    liveCall: voice.data?.live_call,
  });
  const isStreaming = status === "streaming";
  /** ISS-73 ① row 12 — the hidden-page hold's switch, off the same probe; absent → no prime. */
  const holdKeep = voice.data?.tts_background?.keepalive === true;

  // Reads the draft imperatively (no stale closure) so it always sends what's currently typed. NO
  // `isStreaming` gate (HIGH-1, owner-ratified UX): while a turn streams, Enter/mic-send STEER — the
  // store's `sendMessage`/`runShell` enqueue a 202 steer bubble. Only the send BUTTON stays Stop
  // (`isStreaming ? stopTurn : send` in each composer variant); Enter routes through here to steer.
  function send(): void {
    const text = getDraft().trim();
    // Read the STAGED SET imperatively too (same no-stale-closure rule as the draft): an
    // attachment-only send is legal, and a send while a PUT is in flight would name an id the
    // server does not have yet. Both are CHEAP PRE-CHECKS — `runComposer` is the authority on them
    // (MED-2), because the dictation auto-send never comes through this function.
    if (!text && !hasStaged()) return;
    if (isUploading()) return;
    // ISS-73 ① — the typed Send IS the gesture the reply's hidden-page hold needs (the mouth's context
    // made + resumed, the `<audio>` element given a real gesture-started play): the reply arrives with
    // no gesture of its own, maybe after the phone is pocketed. Before `runComposer`, inside the
    // gesture; idempotent and cheap — a `!shell` or `/slash` send primes for nothing, harmlessly. Only
    // with the battery switch ON (rulings row 12, the Qwen lane's Q4): off/absent → no context at all.
    if (holdKeep) primeReplyHold();
    // The staged ids are NOT passed from here: `runComposer`'s natural-language branch reserves them
    // (D68 §7), so the button, Enter, a steer and the dictation auto-send — which bypasses this
    // function entirely and calls `runComposer` itself — all carry them with no plumbing. The draft
    // is cleared only if the seam actually ROUTED: a held send keeps what the owner typed.
    if (runComposer(text)) clearDraft(); // prefix routing: !shell · /slash · else agent (lib/composer)
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
    liveReady,
    // MED-5 — the SAME predicate the send path reads (`hasStaged`), derived from the subscribed set
    // so the button re-renders with it: only a `staged` row is something to send.
    sendable: draft.trim() !== "" || staged.some((f) => f.status === "staged"),
    uploadPending: staged.some((f) => f.status === "uploading"),
  };
}
