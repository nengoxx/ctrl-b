import { useQuery } from "@tanstack/react-query";

import { getJSON } from "../api/client";
import { setChunkPolicy } from "../lib/audioController";

// Phase 6b — voice capability probe. `GET /api/voice/status` returns which services are configured
// AND enabled (`{stt, tts}`), without leaking whether keys exist. Drives whether the composer shows
// the mic (stt) and, in 6b-2, the TTS mini-player (tts).
//
// Always-on (not Conf-scoped): the composer lives on the Fleet/Agent tabs, so the mic decision is
// needed there, not only in Conf. Cheap + cached; a Conf voice save invalidates `["voice-status"]`
// (see useSaveSettings) so toggling voice on/off reflects in the mic without a reload.
//
// D63 — the same payload carries the TTS chunk policy. It is CLIENT BEHAVIOR, not React state (the
// playback singleton reads it imperatively, from no component), so it is published to
// `lib/audioController` right where the response lands rather than through an effect in every one of
// this hook's six consumers. This is the only endpoint the chunker needs, and it was already always-on.

/** The `stt_auto_stop` object, in wire spelling (`SttServiceCfg.auto_stop*`, backend/app/config.py).
 *  Unlike the chunk policy this one has a React consumer (`useDictation`, via `useComposer`), so it
 *  rides the query's `data` rather than being published to a singleton. */
export interface SttAutoStopWire {
  enabled: boolean;
  silence_s: number;
  threshold: number;
}

/** The `tts_chunking` object, in wire spelling (`TtsServiceCfg.chunk_*`, backend/app/config.py). */
export interface TtsChunkingWire {
  mode: "off" | "paragraph" | "sentence";
  min_words: number;
  min_chars: number;
  max_chars: number;
  lookahead: number;
  max_text_chars: number;
  format: string;
  /** C3 S2 — speak each sentence as it streams instead of waiting for turn end. */
  read_along: boolean;
  /** D74 — speak roleplay ACTIONS (`*he smiles*`)? Optional, and absent reads as TRUE: a backend that
   *  predates the knob has to keep today's behavior, and a missing field must never silently start
   *  deleting words from a reply. */
  speak_actions?: boolean;
}

/** The `live_call` object, in wire spelling (`LiveCfg`, backend/app/config.py — delivered shape-only by
 *  `GET /voice/status`, D71 §5.1). These are the CLIENT-side call knobs: Speaches' own `TurnDetection`
 *  takes exactly five server fields (§4.1), so every pacing/interruption/presentation number a call
 *  needs is necessarily browser-side and has to arrive here. Nothing in the call may hardcode one. */
export interface LiveCallWire {
  /** Uplink frame duration. The relay refuses a frame carrying more than 2× this at the declared rate. */
  frame_ms: number;
  /** The client's outbound-buffer ceiling in MILLISECONDS of audio (§3.1/F6): crossing it closes the
   *  leg and reconnects as a fresh session rather than draining stale speech into an obsolete turn. */
  buffered_ceiling_ms: number;
  /** How much audio the CALL's uplink pacer may hold before it drops its oldest, in ms (A-F2, evidence
   *  docs/research/R71). The bound exists because a main-thread stall dispatches a burst the relay's
   *  rolling budget reads as a protocol violation; the pacer meters it out, and past this depth the head
   *  of the queue is speech too stale for a conversation with a clock on both sides. Worth keeping at
   *  or under the relay's own `relay_queue_ms` so the visible bound is the client's — a recommendation,
   *  not an invariant: nothing cross-validates the two knobs, and a larger value here simply hands the
   *  drop back to the relay. Dictation has no such bound — it is lossless by rule (`lib/uplinkPacer`). */
  call_backlog_ms: number;
  /** The barge-in ACTION floor (§4.3): sustained energy for this long before a kill, so a cough costs
   *  nothing. Client-side because Speaches has no minimum-speech knob (council F2). */
  min_speech_ms: number;
  /** The RMS floor the §4.3 energy gate measures against. **0 ⇒ reuse `stt_auto_stop.threshold`** (the
   *  §4.1 table: same detector family as Tier 0, calibrated in the same S4 sitting). */
  barge_threshold: number;
  /** Automatic (voice) interruption. OFF ⇒ walkie-talkie: speech over the reply still transcribes and
   *  queues; the tap stays every browser's interrupt. Ships OFF (owner re-ruling 2026-09-22). */
  barge_in: boolean;
  /** The SERVER-side Silero threshold (0.5–0.8, D76 §D), delivered like its neighbours so the client
   *  can show what the relay runs. Conf is its only door; the relay reads it from config. Optional: a
   *  pre-field backend's status carries none. */
  vad_threshold?: number;
  /** §6 overlay mode — the focal-anchored face ring. S2b renders it; S2a's minimal overlay does not. */
  ring: boolean;
  /** The agent's reply as fading CAPTIONS on the call screen (owner ask 2026-09-22). Optional for the
   *  usual reason — a backend that predates the field says nothing, and the overlay's own `?? true`
   *  dresses the `LiveCfg` default rather than inventing a second one. */
  captions?: boolean;
  /** D76 §B — `auto | on | off`: is the ear held while the reply plays? `on` = always, `off` = never,
   *  `auto` = the leak probe (D76 S2) — until S2 lands, held where the track's AEC readback is not
   *  `"all"` (the S0 ruling, per track, never UA-sniffed). */
  mic_hold: string;
  /** D76 §C (evidence R83) — the RELATIVE near-speech gate, all in dB. `floor_dbfs` is the bootstrap
   *  ceiling (the floor before a noise estimate, and its cap meanwhile); the three MARGINS are relative
   *  dB (noise +, own voice −, playback +); `min_dbfs`/`max_dbfs` clamp the effective floor. Delivered
   *  now, READ by nothing until D76 S0b wires the estimator. */
  floor_dbfs: number;
  noise_margin_db: number;
  voice_margin_db: number;
  playback_margin_db: number;
  min_dbfs: number;
  max_dbfs: number;
  /** D76 §A — `"media"` (default) or `"call"`: how the mic is opened, which decides how the reply is
   *  played. `media` ⇒ `echoCancellation: false`, which keeps Chrome Android out of communication mode
   *  and TTS on the media path, following the system's own routing — Bluetooth when connected, the
   *  loudspeaker otherwise (R74 §1.3, verified on-device 2026-09-23). `call` ⇒ the platform AEC ask:
   *  phone-call mode, echo-cancelled, the hands-free device's own mic. Read by EVERY capture,
   *  dictation's included. */
  route: "media" | "call";
  /** D73 S5 — the capture `deviceId`; "" = the system default. On Android this list is the ROUTE
   *  picker (R74 §2.2) and the choice moves both directions. Asked for as `ideal`, so a device that
   *  is gone falls back to the default rather than failing the capture. */
  input_device: string;
  /** D73 S6 — does a HIDDEN page keep the call (R75)? Off ⇒ the pre-S6 policy, where the page going
   *  away ends it cleanly. `pagehide` tears down either way: a document that is really dying ends its
   *  call, and that is the signal for it (R75 §12.2 A7 — bfcache is provably off mid-call). */
  background: boolean;
  /** …and the FREEZE DEFEAT that makes keeping it worth anything on Chrome Android (R75 §3.5): a
   *  constant, inaudible-but-nonzero source into the capture context's destination, which makes
   *  Blink's `IsAudible()` true and takes the page out of both the freeze path and background
   *  throttling. Its own switch because it is a deliberate defeat of a battery protection. */
  background_keepalive: boolean;
  /** How long a BACKGROUNDED call may sit with no speech and no reply before it ends itself, in
   *  seconds. **0 = off.** The alternative is a pocketed phone riding a hot mic to `max_session_s`. */
  background_idle_s: number;
  /** The relay's own session cap, in seconds — surfaced so the overlay can be honest about the limit. */
  max_session_s: number;
  /** S2.5 — phrase-by-phrase streaming dictation: the mic's hold/lock rides the SAME ear, and each
   *  utterance final appends to the composer draft live. Its own whole-feature toggle beside the
   *  call's `enabled`, so the two are switched independently. Off ⇒ today's whole-clip POST. */
  dictation: boolean;
  /** How long the release waits for the flush's TAIL final before giving up, ms (R70 §4: ~2.4× the
   *  worst measured 530–830 ms tail). `flush` has NO ack, so this bound is the client's only clock. */
  tail_wait_ms: number;
  /** HANDS-FREE idle stop, s: a run of below-floor mic energy this long ends a LOCKED streaming
   *  session through the ordinary release (R70 §9.3). A `hold` is exempt — the finger is the timeout. */
  dictation_idle_s: number;
  /** The hard cap on any one streaming dictation session, s (R70 §9.3) — `hold` included. */
  dictation_max_s: number;
  /** D74 S5 — THE TRANSCRIPT GATE: how many milliseconds of above-SILENCE-floor microphone energy a
   *  call utterance must have carried before its final is taken, ms. **0 = off.** It exists because a
   *  Whisper-family endpoint answers a stretch of noise with a plausible sentence rather than with
   *  nothing (R76), and the client is the only end that knows what the microphone actually heard.
   *  Measured against `stt_auto_stop.threshold` and deliberately NOT `barge_threshold` — "louder than
   *  silence" is a different question from "loud enough to interrupt a reply".
   *
   *  OPTIONAL, and absent reads as OFF: a pre-D74 backend has no such knob, and a client that
   *  invented one would be discarding the owner's words on a number nobody chose. The backend ships
   *  200 as its default. */
  min_final_ms?: number;
  /** D74 S7 — the call overlay's READBACK block: the track's resolved echo-cancellation mode beside
   *  its open-time capability, the live RMS against the floor, and the flags the arming decision was
   *  taken from (R78 §6.2). Diagnostic only; off renders nothing extra. Optional for the same reason
   *  as the knob above — absent is off. */
  debug?: boolean;
}

export interface VoiceStatus {
  stt: boolean;
  tts: boolean;
  /** LIVE VOICE / call mode is configured+enabled (D71 §5.1). **S1's backend delivers it** — nothing
   *  sends it today, so it reads `undefined` → false everywhere, which is exactly what keeps the S0.5
   *  call-mode chrome unreachable while its gesture, states and CSS are already built and tested. */
  live?: boolean;
  /** THE EAR ALONE (S2.5): the realtime chain is configured AND at least one of
   *  `voice.live.{enabled,dictation}` (S3.5: the dictation toggle alone opens the ear) — exactly the
   *  terms the `WS /api/voice/live` route itself gates on, and deliberately NOT the `live` bit's
   *  third (TTS, the call's §5.1 refinement). Streaming dictation fills the composer, so it needs no
   *  mouth; a mic keyed off `live` would be dark on a TTS-less install whose relay would have taken
   *  the socket. Optional so a pre-S2.5 backend reads as "no ear" and the mic stays on the whole-clip
   *  path. */
  live_ear?: boolean;
  /** Client behavior (SttServiceCfg.auto_send): true → mic sends the transcript immediately; false →
   *  fills the composer for review. Surfaced here (not just /api/settings) because the mic is on
   *  Fleet/Agent and the settings query is Conf-scoped. */
  stt_auto_send: boolean;
  /** Client behavior (R51 Tier 0): the mic's silence auto-stop policy. Optional so a pre-Tier-0 backend
   *  (or a test stub) simply leaves the mic on plain push-to-talk — absent reads as disabled. */
  stt_auto_stop?: SttAutoStopWire;
  /** Client behavior (D63): how to split a reply for read-aloud. Optional so a pre-D63 backend (or a
   *  test stub) simply leaves the controller on its whole-message default. */
  tts_chunking?: TtsChunkingWire;
  /** Client behavior (D71 §5.1): the call's pacing/interruption knobs. Optional so a pre-S1 backend (or
   *  a test stub) reads as "no call knobs" — which pairs with `live` being absent there anyway. */
  live_call?: LiveCallWire;
}

export function useVoiceStatus() {
  return useQuery<VoiceStatus>({
    queryKey: ["voice-status"],
    queryFn: async () => {
      const status = await getJSON<VoiceStatus>("/api/voice/status");
      const c = status.tts_chunking;
      if (c) {
        setChunkPolicy({
          mode: c.mode,
          minWords: c.min_words,
          minChars: c.min_chars,
          maxChars: c.max_chars,
          maxTextChars: c.max_text_chars,
          lookahead: c.lookahead,
          format: c.format,
          readAlong: c.read_along,
          speakActions: c.speak_actions ?? true,
        });
      }
      return status;
    },
    staleTime: 60_000,
  });
}
