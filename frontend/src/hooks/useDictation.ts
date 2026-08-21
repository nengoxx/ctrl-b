import { useCallback, useEffect, useRef, useState } from "react";

import type { SttAutoStopWire } from "./useVoiceStatus";
import { runComposer } from "../lib/composer";
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
// Five button states (owner-locked 2026-06-22; `insecure` added 2026-06-26), surfaced via `status`:
//   idle        — armed, not recording (the default look)
//   recording   — actively capturing (drives the vapor `.rec` red-pulse)
//   sending     — clip uploaded, awaiting the transcript (briefly inert, idle look)
//   unavailable — a recording attempt 502'd (the whole STT chain failed). REACTIVE per the owner's
//                 call: no proactive liveness probe — looks normal until an attempt fails, then greys
//                 + goes inert. Re-arms on the next fresh /voice/status probe (Conf save / refocus),
//                 an infra-free recovery path.
//   insecure    — the browser blocks getUserMedia because this isn't a secure context (plain HTTP over
//                 the tailnet, no Tailscale Serve / no browser-flag whitelist). Detected up front from
//                 `navigator.mediaDevices` availability (which IS flag-aware: enabling Chrome's
//                 `unsafely-treat-insecure-origin-as-secure` for this origin makes it a secure context,
//                 so the mic then works on plain HTTP). Greyed like `unavailable` BUT still tappable, so
//                 a tap re-explains the fix via a toast instead of looking dead/stuck (owner ask).
//
// R51 Tier 0 — AUTO-STOP (config `voice.stt.auto_stop*`, delivered by `GET /voice/status`, default
// OFF): while recording, an AnalyserNode on the SAME stream is polled for time-domain RMS; a run of
// readings below the configured floor spanning the configured window ends the recording through the
// ordinary `stop()` — so `onstop → upload → auto_send` is untouched and the two knobs compose (stop
// alone = hands-free stop + review; with auto_send = say-it-and-it-goes). No VAD model, no worklet, no
// background listening: a hidden page stops the recording outright (see `armDetector`).

// Auto-stop (R51 Tier 0) — how often the energy detector reads the stream while recording. NOT a
// tunable (the two tunables are the silence window + the RMS floor, both config): 100 ms resolves the
// configured window to within one reading and costs nothing, the order the field ships at (R51 §5).
const SILENCE_POLL_MS = 100;

const INSECURE_MSG =
  "Mic needs a secure connection — use HTTPS via Tailscale Serve, or allow this origin in your browser flags.";

// Shown when the mic DOES work but the page is plain HTTP (typically a browser-flag-whitelisted origin):
// it records fine — never greyed — but nudge that real HTTPS is the proper setup. Once per page load.
const HTTP_REMINDER =
  "Mic is recording over plain HTTP — HTTPS via Tailscale Serve is the recommended setup.";

// Whether the PAGE is served over HTTPS — deliberately distinct from `micCapable`: a browser flag can
// make a plain-HTTP origin a secure context, so the mic works (mediaDevices present) while this stays
// false. So greying keys off capability, the nudge keys off this.
const httpsOn = typeof window !== "undefined" && window.location?.protocol === "https:";

// Module-level → the plain-HTTP nudge fires once per page load, not once per composer mount (the composer
// remounts when you visit Conf/Utils), so it doesn't pop on every mic use.
let httpReminderShown = false;

type Phase = "idle" | "recording" | "sending";
export type MicStatus = Phase | "unavailable" | "insecure";

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
 * @param autoStop   SttServiceCfg.auto_stop* (via /voice/status), R51 Tier 0: while recording, an
 *                    energy detector on the same stream stops the recording after a silence run —
 *                    hands-free stop, which `autoSend` then composes with unchanged. Absent (older
 *                    backend / test stub) or `enabled: false` → plain push-to-talk, nothing built.
 */
export function useDictation({
  sttReady,
  statusStamp,
  autoSend,
  autoStop,
}: {
  sttReady: boolean;
  statusStamp: number;
  autoSend: boolean;
  autoStop?: SttAutoStopWire;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [unavailable, setUnavailable] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const armingRef = useRef(false); // true between a start() tap and the recorder actually arming

  // Auto-stop state. Every one of these stays null unless the feature is on AND its AudioContext ran.
  const audioRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hiddenRef = useRef<(() => void) | null>(null);

  // The policy, flattened to primitives so the detector's identity tracks the VALUES, not the identity
  // of the query object carrying them. Absent → disabled (the mic predates the field; LOW-4).
  const autoStopOn = autoStop?.enabled ?? false;
  const silenceMs = (autoStop?.silence_s ?? 0) * 1000;
  const silenceFloor = autoStop?.threshold ?? 0;

  // Whether the browser will even hand us a mic. `navigator.mediaDevices` is undefined in an insecure
  // context (plain HTTP) AND present once the origin is treated as secure (real HTTPS, localhost, or a
  // browser flag), so this single check is the flag-aware gate — no `location.protocol` sniffing, which
  // would wrongly block a user who whitelisted the origin. Stable per page load (read at render).
  const micCapable =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

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
        // Auto-send routes it like a typed+sent message. NO streaming gate (HIGH-1, D41): a voice
        // message during a live turn QUEUES as a steer (the 202 path), same as Enter — voice is the
        // owner's primary mobile input, and a queued bubble is visible/removable. `runComposer` →
        // `sendMessage`/`runShell` enqueue the steer; the running turn keeps the view.
        if (autoSend) {
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

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop(); // fires onstop → cleanup → upload
  }, []);

  /** The auto-stop detector's ONE idempotent teardown (council MED-2): interval, visibility listener,
   *  nodes, context. Called from EVERY terminal path — `onstop` (BEFORE the upload begins), `onerror`,
   *  a failed arm, a failed start, unmount — so nothing ever watches a mic that is no longer recording. */
  const teardownDetector = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (hiddenRef.current) {
      document.removeEventListener("visibilitychange", hiddenRef.current);
      hiddenRef.current = null;
    }
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current = null;
    const ctx = audioRef.current;
    audioRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {}); // a double-close rejects
  }, []);

  /** Arm the energy detector on the SAME stream the recorder holds (never a second getUserMedia). Silent
   *  by contract (MED-2): no Web Audio, a context that won't leave `suspended`, a throwing node graph —
   *  every one degrades to ordinary push-to-talk. A recording that needs one extra tap is a non-event;
   *  an error toast on every recording would not be. */
  const armDetector = useCallback(
    async (stream: MediaStream) => {
      if (typeof AudioContext === "undefined") return;
      let ctx: AudioContext;
      try {
        ctx = new AudioContext(); // constructed inside the start gesture, so it may autoplay-unlock
      } catch {
        return;
      }
      audioRef.current = ctx; // parked BEFORE the await, so a stop during it closes this context
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      // Either the recording already ended during the resume (teardown cleared the parked context) or
      // the context never ran — in both cases anything built here would outlive its recording.
      if (audioRef.current !== ctx || ctx.state !== "running") {
        teardownDetector();
        return;
      }
      let analyser: AnalyserNode;
      try {
        analyser = ctx.createAnalyser();
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser); // analyser only — never the destination (that would echo the mic)
        analyserRef.current = analyser;
        sourceRef.current = source;
      } catch {
        teardownDetector();
        return;
      }
      const samples = new Float32Array(analyser.fftSize);
      let silentMs = 0; // the current run of below-floor readings; silence BEFORE speech counts too
      pollRef.current = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += v * v;
        if (Math.sqrt(sum / samples.length) >= silenceFloor) {
          silentMs = 0; // anything above the floor restarts the run
          return;
        }
        silentMs += SILENCE_POLL_MS;
        if (silentMs >= silenceMs) stop(); // the SAME path as tapping stop → onstop → upload
      }, SILENCE_POLL_MS);
      // Council MED-1 — dictation is a screen-on activity: a hidden page ends the recording outright
      // rather than leaving the mic live behind a timer Android throttles to ~once a minute.
      const onHidden = () => {
        if (document.visibilityState === "hidden") stop();
      };
      document.addEventListener("visibilitychange", onHidden);
      hiddenRef.current = onHidden;
    },
    [silenceFloor, silenceMs, stop, teardownDetector],
  );

  const start = useCallback(async () => {
    // Re-entrancy guard: a second tap during the getUserMedia await would open a *second* stream and
    // orphan the first (its tracks never stopped → the mic stays live). `arming` blocks that window.
    if (armingRef.current || recRef.current?.state === "recording") return;
    if (!micCapable) return; // insecure context — `toggle` already surfaced the toast; defensive only
    armingRef.current = true;
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        teardownDetector(); // every failed start leaves the detector state clean (MED-2)
        pushToast("Microphone permission denied", "err");
        return;
      }
      const mime = pickMime();
      let rec: MediaRecorder;
      try {
        rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      } catch {
        // Construction can throw (no supported container) — release the stream we just opened.
        teardownDetector();
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
        teardownDetector(); // BEFORE the upload enters `sending` — the watcher dies with the recording
        stream.getTracks().forEach((t) => t.stop()); // release the mic indicator
        void upload();
      };
      rec.onerror = () => {
        teardownDetector();
        stream.getTracks().forEach((t) => t.stop());
        pushToast("Recording failed", "err");
        setPhase("idle");
      };
      rec.start();
      setPhase("recording");
      // Toggle off → not even constructed, so the recording behaves exactly as it did pre-Tier-0.
      if (autoStopOn) void armDetector(stream);
    } finally {
      armingRef.current = false;
    }
  }, [upload, micCapable, autoStopOn, armDetector, teardownDetector]);

  /** Tap handler. No mediaDevices → can't capture: re-explain the fix on every tap (greyed but tappable,
   *  so it's never a dead/stuck control). Capable but plain HTTP (flag-whitelisted) → it WORKS (never
   *  greyed); just nudge once per session that HTTPS is the proper setup. Then idle → start, recording →
   *  stop + transcribe. Inert while unavailable/sending. */
  const toggle = useCallback(() => {
    if (!micCapable) {
      pushToast(INSECURE_MSG, "info");
      return;
    }
    if (!httpsOn && !httpReminderShown) {
      httpReminderShown = true;
      pushToast(HTTP_REMINDER, "info");
    }
    if (unavailable) return;
    if (phase === "recording") stop();
    else if (phase === "idle") void start();
  }, [micCapable, phase, unavailable, start, stop]);

  // Stop any in-flight recording if the composer unmounts mid-capture (tab switch to Conf/Utils).
  // `stop()` only ASKS the recorder (its `onstop` may land after we're gone), so the detector is torn
  // down here too — a timer/listener must never outlive the mount that owns it.
  useEffect(
    () => () => {
      stop();
      teardownDetector();
    },
    [stop, teardownDetector],
  );

  // `insecure` wins over `unavailable`: with no secure context a recording attempt can't even start,
  // so the 502-driven `unavailable` flag never gets set — surface the actionable reason instead.
  const status: MicStatus = !micCapable ? "insecure" : unavailable ? "unavailable" : phase;
  return { status, toggle };
}
