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

export interface VoiceStatus {
  stt: boolean;
  tts: boolean;
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
