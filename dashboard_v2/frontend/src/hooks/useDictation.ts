import { useCallback, useEffect, useRef, useState } from "react";

import { runComposer } from "../lib/composer";
import { getChatStatus } from "../store/chat";
import { appendDraft, clearDraft, getDraft } from "../store/composer";
import { pushToast } from "../store/toast";

// Phase 6b-1 — push-to-talk dictation (tap to start, tap to stop). The idiomatic React home for the
// imperative MediaRecorder API is a custom hook (not a store): recording state is read by exactly one
// place — the Composer mic button — so it never needs to be globally shared. (TTS *playback*, which
// many bubbles + the chat reducer coordinate, gets a shared singleton in 6b-2 instead.)
//
// Flow: getUserMedia → MediaRecorder → on stop, POST the recorded clip to /api/voice/stt → append the
// transcript to the composer draft for review-then-send. The recorder's container mimeType and the
// upload filename extension MUST agree — Whisper servers route by extension (the 6a↔6b contract).
//
// Four button states (owner-locked 2026-06-22), surfaced via `status`:
//   idle        — armed, not recording (the default look)
//   recording   — actively capturing (drives the vapor `.rec` red-pulse)
//   sending     — clip uploaded, awaiting the transcript (briefly inert, idle look)
//   unavailable — a recording attempt 502'd (the whole STT chain failed). REACTIVE per the owner's
//                 call: no proactive liveness probe — looks normal until an attempt fails, then greys
//                 + goes inert. Re-arms on the next fresh /voice/status probe (Conf save / refocus),
//                 an infra-free recovery path.

type Phase = "idle" | "recording" | "sending";
export type MicStatus = Phase | "unavailable";

// Container candidates in preference order — the first the browser can record wins. webm/opus is the
// Android/Chrome default; mp4 covers Safari/iOS; ogg is a fallback. The recording mimeType picked here
// also dictates the upload filename extension (via the recorder's actual mimeType — see extFromMime).
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mime of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      /* some engines throw on odd codec strings — skip */
    }
  }
  return null; // fall through to the browser default container
}

/** Map a recorder mimeType to the extension Whisper should route by (the upload filename ext). Derived
 *  from the recorder's *actual* `mimeType` after start() — a browser may fall back to a different
 *  container than we requested, and the filename extension must follow the real bytes, not our guess. */
function extFromMime(mime: string): string {
  if (mime.includes("mp4") || mime.includes("mpeg")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

/**
 * @param sttReady   whether /voice/status reports STT configured+enabled (gates re-arm on recovery)
 * @param statusStamp `dataUpdatedAt` of the status query — a change means a fresh probe landed, so a
 *                    previously-`unavailable` mic re-arms (no proactive probe; rides the existing query).
 * @param autoSend   SttServiceCfg.auto_send (via /voice/status): true → send the transcript immediately
 *                    (routed like a typed+sent message); false (default) → fill the composer for review.
 */
export function useDictation({
  sttReady,
  statusStamp,
  autoSend,
}: {
  sttReady: boolean;
  statusStamp: number;
  autoSend: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [unavailable, setUnavailable] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const armingRef = useRef(false); // true between a start() tap and the recorder actually arming

  // Re-arm after a fresh capability probe (Conf voice save / window refocus). /voice/status only
  // reports *configured*, not *reachable*, so this is an optimistic re-arm: worst case the next
  // attempt greys it again. Infra-free recovery from a transient outage without a liveness probe.
  useEffect(() => {
    if (sttReady) setUnavailable(false);
  }, [statusStamp, sttReady]);

  const upload = useCallback(async () => {
    const chunks = chunksRef.current;
    chunksRef.current = [];
    const mime = recRef.current?.mimeType || "audio/webm";
    const blob = new Blob(chunks, { type: mime });
    if (!blob.size) {
      setPhase("idle");
      return;
    }
    setPhase("sending");
    // Filename extension follows the recorder's *actual* container (mime ↔ ext must agree — Whisper
    // routes by extension). `mime` strips codec params via extFromMime's substring checks.
    const form = new FormData();
    form.append("file", blob, `dictation.${extFromMime(mime)}`);
    try {
      const res = await fetch("/api/voice/stt", { method: "POST", body: form });
      if (res.status === 502) {
        // The whole STT chain (primary + fallback) failed → the reactive "unavailable" state.
        setUnavailable(true);
        pushToast("Voice servers unreachable", "err");
        return;
      }
      if (!res.ok) {
        pushToast(`Transcription failed (${res.status})`, "err");
        return;
      }
      const data = (await res.json()) as { text?: string };
      if (data.text?.trim()) {
        appendDraft(data.text); // always show it in the composer first
        // Auto-send routes it like a typed+sent message — but only when idle. Firing into an in-flight
        // turn would be silently dropped (sendMessage no-ops while streaming), so leave it in the
        // composer to send manually (the typed path is likewise blocked by the disabled send button).
        if (autoSend && getChatStatus() !== "streaming") {
          // Reads the just-appended draft imperatively (combines with anything already typed).
          const full = getDraft().trim();
          if (full) {
            runComposer(full);
            clearDraft();
          }
        }
      } else {
        pushToast("Didn't catch that — try again", "info");
      }
    } catch {
      // Network failure reaching our own backend — treat like an unreachable chain.
      setUnavailable(true);
      pushToast("Voice servers unreachable", "err");
    } finally {
      setPhase("idle");
    }
  }, [autoSend]);

  const start = useCallback(async () => {
    // Re-entrancy guard: a second tap during the getUserMedia await would open a *second* stream and
    // orphan the first (its tracks never stopped → the mic stays live). `arming` blocks that window.
    if (armingRef.current || recRef.current?.state === "recording") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      // Insecure origin (plain HTTP over the tailnet) disables getUserMedia — that's what 6c (HTTPS
      // via Tailscale Serve) fixes. Not a server outage, so don't mark the chain unavailable.
      pushToast("Microphone needs a secure (HTTPS) connection", "err");
      return;
    }
    armingRef.current = true;
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        pushToast("Microphone permission denied", "err");
        return;
      }
      const mime = pickMime();
      let rec: MediaRecorder;
      try {
        rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      } catch {
        // Construction can throw (no supported container) — release the stream we just opened.
        stream.getTracks().forEach((t) => t.stop());
        pushToast("Recording isn't supported on this browser", "err");
        return;
      }
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop()); // release the mic indicator
        void upload();
      };
      rec.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        pushToast("Recording failed", "err");
        setPhase("idle");
      };
      rec.start();
      setPhase("recording");
    } finally {
      armingRef.current = false;
    }
  }, [upload]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop(); // fires onstop → upload
  }, []);

  /** Tap handler: idle → start recording; recording → stop + transcribe. Inert while unavailable/sending. */
  const toggle = useCallback(() => {
    if (unavailable) return;
    if (phase === "recording") stop();
    else if (phase === "idle") void start();
  }, [phase, unavailable, start, stop]);

  // Stop any in-flight recording if the composer unmounts mid-capture (tab switch to Conf/Utils).
  useEffect(() => () => stop(), [stop]);

  const status: MicStatus = unavailable ? "unavailable" : phase;
  return { status, toggle };
}
