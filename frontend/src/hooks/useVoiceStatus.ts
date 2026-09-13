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
  /** The barge-in ACTION floor (§4.3): sustained energy for this long before a kill, so a cough costs
   *  nothing. Client-side because Speaches has no minimum-speech knob (council F2). */
  min_speech_ms: number;
  /** The RMS floor the §4.3 energy gate measures against. **0 ⇒ reuse `stt_auto_stop.threshold`** (the
   *  §4.1 table: same detector family as Tier 0, calibrated in the same S4 sitting). */
  barge_threshold: number;
  /** Automatic (voice) interruption. OFF ⇒ walkie-talkie: speech over the reply still transcribes and
   *  queues; the tap stays every browser's interrupt. */
  barge_in: boolean;
  /** §6 overlay mode — the focal-anchored face ring. S2b renders it; S2a's minimal overlay does not. */
  ring: boolean;
  /** `auto | on | off` — the loopback-AEC fallback lever. S0 ruled `auto` = off where the live track
   *  reads `echoCancellation: "all"`; the protective ear-hold elsewhere is S3. */
  echo_workaround: string;
  /** The relay's own session cap, in seconds — surfaced so the overlay can be honest about the limit. */
  max_session_s: number;
}

export interface VoiceStatus {
  stt: boolean;
  tts: boolean;
  /** LIVE VOICE / call mode is configured+enabled (D71 §5.1). **S1's backend delivers it** — nothing
   *  sends it today, so it reads `undefined` → false everywhere, which is exactly what keeps the S0.5
   *  call-mode chrome unreachable while its gesture, states and CSS are already built and tested. */
  live?: boolean;
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
        });
      }
      return status;
    },
    staleTime: 60_000,
  });
}
