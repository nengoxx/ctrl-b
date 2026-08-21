// App-chrome controller (D29 §14.2) — headless: the persistent voice/audio affordances a theme's chrome
// renders, with no markup. TWO consumer hooks, deliberately split because the AppBar and the MiniPlayer
// read different slices — bundling them would re-render the AppBar on the player's ~4×/sec progress:
//   useAppChrome   — the auto-TTS toggle + whether TTS is configured (the appbar's voice control).
//   useNowPlaying  — the docked TTS player's derived state + transport actions (the mini-player).
// The playback itself lives in lib/audioController (the shared <audio> singleton, D23 store) — these
// hooks COMPOSE it (the per-bubble TtsButton still selects its own slice there directly, unchanged).

import {
  dismiss,
  seekFraction,
  togglePlay,
  usePlayback,
  type ChunkSpan,
} from "../lib/audioController";
import { getUI, setUI, useUISlice } from "../store/ui";
import { useVoiceStatus } from "./useVoiceStatus";

// ── Auto-TTS (the appbar control) ────────────────────────────────────────────────────────────────

/** Flip the auto-read-aloud toggle; muting also silences whatever's playing now (was the AppBar's
 *  effect). Module-level + reads `getUI()` imperatively, so it's a stable action with no stale closure. */
export function toggleAutoTts(): void {
  const next = !getUI().ttsAuto;
  setUI({ ttsAuto: next });
  if (!next) dismiss(); // muting auto-TTS stops the clip playing right now
}

export interface AppChrome {
  /** Whether completed replies auto-read-aloud. */
  ttsAuto: boolean;
  /** Whether TTS is configured (the toggle only renders when true). */
  ttsConfigured: boolean;
  toggleAutoTts: () => void;
}

export function useAppChrome(): AppChrome {
  const ttsAuto = useUISlice((s) => s.ttsAuto);
  const ttsConfigured = useVoiceStatus().data?.tts ?? false;
  return { ttsAuto, ttsConfigured, toggleAutoTts };
}

// ── Now-playing (the docked mini-player) ─────────────────────────────────────────────────────────

export interface NowPlaying {
  /** A clip is docked — the player renders only when true. */
  active: boolean;
  loading: boolean;
  playing: boolean;
  /** Progress 0..1 — the scrubber value + the filled-track look. */
  fraction: number;
  /** Seconds remaining — the time label. */
  remaining: number;
  /** Seconds total — the denominator the waveform maps its bars through. */
  duration: number;
  /** Some of `duration` is still a chars/sec estimate — the time label wears a `~`. */
  estimated: boolean;
  /** The whole-message chunk map (D63 amendment) — null under `chunking: off`. Reference-stable, so a
   *  consumer may `useMemo` a per-bar projection off it without recomputing on every position tick. */
  chunks: ChunkSpan[] | null;
  /** The scrubber is inert while loading / before a duration is known. */
  seekDisabled: boolean;
  togglePlay: () => void;
  seek: (fraction: number) => void;
  dismiss: () => void;
}

export function useNowPlaying(): NowPlaying {
  // Per-field selectors (not one object snapshot — the store contract requires a stable/primitive read).
  // The mini-player needs current/duration, so it DOES re-render on `timeupdate` (that's its job).
  const active = usePlayback((p) => p.id !== null);
  const status = usePlayback((p) => p.status);
  const current = usePlayback((p) => p.current);
  const duration = usePlayback((p) => p.duration);
  const estimated = usePlayback((p) => p.estimated);
  // The chunk map is a stable reference by contract (the controller rebuilds it only when a duration or
  // a chunk state moves), so selecting it here does NOT add a render per `timeupdate`.
  const chunks = usePlayback((p) => p.chunks);
  return {
    active,
    loading: status === "loading",
    playing: status === "playing",
    fraction: duration > 0 ? Math.min(1, current / duration) : 0,
    remaining: duration > 0 ? Math.max(0, duration - current) : 0,
    duration,
    estimated,
    chunks,
    seekDisabled: status === "loading" || duration <= 0,
    togglePlay,
    seek: seekFraction,
    dismiss,
  };
}
