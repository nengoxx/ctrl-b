import { useQuery } from "@tanstack/react-query";

import { getJSON } from "../api/client";

// Phase 6b — voice capability probe. `GET /api/voice/status` returns which services are configured
// AND enabled (`{stt, tts}`), without leaking whether keys exist. Drives whether the composer shows
// the mic (stt) and, in 6b-2, the TTS mini-player (tts).
//
// Always-on (not Conf-scoped): the composer lives on the Fleet/Agent tabs, so the mic decision is
// needed there, not only in Conf. Cheap + cached; a Conf voice save invalidates `["voice-status"]`
// (see useSaveSettings) so toggling voice on/off reflects in the mic without a reload.

export interface VoiceStatus {
  stt: boolean;
  tts: boolean;
  /** Client behavior (SttServiceCfg.auto_send): true → mic sends the transcript immediately; false →
   *  fills the composer for review. Surfaced here (not just /api/settings) because the mic is on
   *  Fleet/Agent and the settings query is Conf-scoped. */
  stt_auto_send: boolean;
}

export function useVoiceStatus() {
  return useQuery<VoiceStatus>({
    queryKey: ["voice-status"],
    queryFn: () => getJSON<VoiceStatus>("/api/voice/status"),
    staleTime: 60_000,
  });
}
