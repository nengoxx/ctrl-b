import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

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
//
// Phase 24 / S0.5 — the hook WIDENS for the hold-to-record gesture (LIVE_VOICE_PLAN §6, D71). There is
// exactly ONE recorder: the gesture drives THIS machine through `start`/`stop`/`cancel` instead of
// standing up a second one, and `toggle` stays untouched as the keyboard/AT path (R69 §8.1 — the
// Telegram-Web degradation IS the shipped alternative). What the gesture needed, and nothing more:
//   · `start()` RESOLVES to whether a recorder actually armed, so a hold on a denied/failed mic can
//     close its own chrome instead of painting a circle over a mic that never opened;
//   · `cancel()` discards — a flag consulted in the `onstop` path, so the clip costs no POST;
//   · the 1000 ms FLOOR (R69 §9, Signal's rule) lives here, in the pre-upload path, because this is
//     the layer that knows when the recording started;
//   · the arming latch is now a TOKEN rather than a boolean (delta round F5): a release landing while
//     `getUserMedia` is still pending ABORTS that attempt, and a stream resolving afterwards is stopped
//     at once — never an ownerless recording.
//
// S0.5 FEEL ROUND (owner, 2026-09-13) — METERING IS SPLIT FROM POLICY (OF-3). The R51 detector already
// read time-domain RMS every 100 ms, but only while the auto-stop POLICY was on, so the live voice level
// the record circle wants existed exactly when the owner had switched a different feature on. The
// analyser + poll now arm for EVERY recording (that is the METER); the auto-stop STOP decision below is
// gated on `autoStopOn` exactly as it always was (that is the POLICY, untouched). Both seams the gesture
// consumes — the level, and the too-short teaching — are ASSIGNABLE REFS on the return rather than props:
// they are registered by whoever is painting (one composer at a time), they are null-safe, and a null one
// falls back to the behaviour that shipped. A 10 Hz level must not re-render React, which is the whole
// reason it is a ref the gesture writes to the DOM from rather than a piece of state.

// Auto-stop (R51 Tier 0) — how often the energy detector reads the stream while recording. NOT a
// tunable (the two tunables are the silence window + the RMS floor, both config): 100 ms resolves the
// configured window to within one reading and costs nothing, the order the field ships at (R51 §5).
// Since the feel round it is also the METER's cadence — one timer, two readers.
const SILENCE_POLL_MS = 100;

/** The time-domain RMS that reads as a FULL meter, i.e. `level === 1` (OF-3). Feel-tuned, not measured:
 *  ordinary speech at arm's length on the owner's phone sits well under 0.1 RMS, so 0.12 puts a normal
 *  sentence in the upper half of the bulge and leaves headroom for a shout instead of pinning. The
 *  auto-stop's own `threshold` is deliberately NOT reused — that one is a SILENCE floor (default 0.01),
 *  three orders of feel away from "how loud is loud", and it is user-configurable. */
const METER_FULL_RMS = 0.12;

/** The minimum clip we will spend a POST on, in ms (R69 §9 / §2 — Signal's floor, ratified in
 *  LIVE_VOICE_PLAN §6). A mis-timed hold produces a 200 ms blip: discard it CLIENT-SIDE, before any
 *  upload, and teach the gesture instead of failing silently. Applies to every entry — the gesture and
 *  the keyboard toggle alike — because "a clip too short to be speech" is one fact about the clip, not
 *  a property of how the recording was started. */
const MIN_CLIP_MS = 1000;

/** The teaching line that replaces the discarded blip (R69 §2: Signal teaches at exactly this moment).
 *  Short, and it names the gesture rather than scolding. ONE string for both presentations: since the
 *  feel round the composer shows it in the gesture's own hint BUBBLE (right above the mic, where the
 *  blip just happened), and the toast below is the fallback for a consumer that registers no handler. */
export const TOO_SHORT_MSG = "Too short — hold to record";

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
  /** The in-flight `start()` attempt, or null — the re-entrancy latch, now a TOKEN (F5). A second entry
   *  during the `getUserMedia` await would open a SECOND stream and orphan the first (its tracks never
   *  stopped → the mic stays live), which is what the old boolean blocked; the token additionally lets a
   *  release/cancel landing inside that window ABORT the attempt, so a stream that resolves after the
   *  gesture ended is released immediately instead of becoming a recording nobody asked for. */
  const armRef = useRef<{ aborted: boolean } | null>(null);
  /** Set by `cancel()` and consumed in `onstop`: the clip is DROPPED, no upload (LIVE_VOICE_PLAN §6). */
  const discardRef = useRef(false);
  /** `Date.now()` at `rec.start()` — the only thing the 1000 ms floor needs, and this is the layer that
   *  has it. 0 when nothing is recording. */
  const startedAtRef = useRef(0);

  /** THE METER SEAM (OF-3) — assigned by whoever paints the recording (the mic gesture), called with a
   *  0…1 level every `SILENCE_POLL_MS` while recording. Null-safe: with nobody registered the poll still
   *  runs the auto-stop policy and simply meters into nothing. */
  const meterRef = useRef<((level: number) => void) | null>(null);
  /** THE TOO-SHORT SEAM (OF-4) — assigned by whoever can TEACH better than a toast can. The floor RULE
   *  and `MIN_CLIP_MS` stay here (this is the layer that knows how long the clip was); only the
   *  PRESENTATION moves. Null → the toast that always shipped. */
  const tooShortRef = useRef<(() => void) | null>(null);

  // Detector state. Every one of these stays null unless an AudioContext actually ran.
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

  /** @param mime the recorder's ACTUAL container, handed over by the `onstop` closure that owns it —
   *  the recorder releases its ownership of `recRef` before the upload begins (F2), so this can no
   *  longer be read back off the ref. (A clip's `heldMs` defaulting to `Infinity` when there is no
   *  stamp is deliberate and STAYS: "no stamp" alone must never discard a clip. A recording that
   *  ERRORED is covered by the discard flag `onerror` sets — F4 — never by the missing stamp.) */
  const upload = useCallback(
    async (mime: string) => {
      const chunks = chunksRef.current;
      chunksRef.current = [];
      const heldMs = startedAtRef.current > 0 ? Date.now() - startedAtRef.current : Infinity;
      startedAtRef.current = 0;
      const blob = new Blob(chunks, { type: mime });
      if (!blob.size) {
        setPhase("idle");
        return;
      }
      // THE 1000 ms FLOOR — before the POST, never after: a blip costs no round trip, and the toast is
      // the teaching moment (R69 §2/§9). Deliberately AFTER the empty-blob early-out, which is about a
      // recorder that produced nothing at all rather than about a recording that was too brief.
      if (heldMs < MIN_CLIP_MS) {
        // The teaching PRESENTATION is the one part a consumer may take over (OF-4): the composer flashes
        // it in the gesture's hint bubble, right above the button the blip happened on. Everyone else —
        // and any future consumer that registers nothing — keeps the toast.
        if (tooShortRef.current) tooShortRef.current();
        else pushToast(TOO_SHORT_MSG, "info");
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
            // D68 MED-2 — the draft is cleared ONLY if the seam actually routed. `runComposer` HOLDS a
            // send while a staged file is still uploading, and this path is exactly why the gate lives
            // there: a transcript that lands mid-upload must wait for the file rather than send without
            // it (or, worse, be cleared away). The words stay in the composer; the next send carries both.
            if (full && runComposer(full)) clearDraft();
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
    },
    [autoSend],
  );

  /** Abort an in-flight `start()` (F5), reporting whether there WAS one. The caller then knows there is
   *  no recording to stop or discard: the recorder never armed, so nothing was captured. `armRef` is
   *  released here so an immediate re-press can start afresh — the aborted attempt still owns its own
   *  token, and `start`'s `finally` only clears the ref when it is still the one it parked. */
  const abortArming = useCallback((): boolean => {
    const arm = armRef.current;
    if (!arm) return false;
    arm.aborted = true;
    armRef.current = null;
    return true;
  }, []);

  const stop = useCallback(() => {
    if (abortArming()) return; // released inside the acquisition window — nothing started (F5)
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop(); // fires onstop → cleanup → upload
  }, [abortArming]);

  /** Discard the recording: no transcript, no POST, no draft. The flag is consulted in the `onstop`
   *  path (the ONE place that decides whether a stopped recorder uploads), so cancelling reuses the
   *  entire teardown rather than forking it — LIVE_VOICE_PLAN §6's slide-left cancel, the locked-mode
   *  CANCEL button and the Esc key all land here. */
  const cancel = useCallback(() => {
    if (abortArming()) return; // cancelled inside the acquisition window — nothing to discard (F5)
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") return;
    discardRef.current = true;
    rec.stop();
  }, [abortArming]);

  /** Release ONLY the Web Audio half of the detector (interval · nodes · context). Split out because
   *  the energy detector is allowed to degrade while the hidden-page stop is NOT (MED-1): a context
   *  that won't run must not take the unattended-mic rule with it. */
  const teardownAudio = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current = null;
    const ctx = audioRef.current;
    audioRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {}); // a double-close rejects
  }, []);

  /** The auto-stop detector's ONE idempotent teardown (council MED-2): the audio half PLUS the
   *  visibility listener. Called from EVERY terminal path — `onstop` (BEFORE the upload begins),
   *  `onerror`, a failed start, unmount — so nothing ever watches a mic that is no longer recording. */
  const teardownDetector = useCallback(() => {
    teardownAudio();
    if (hiddenRef.current) {
      document.removeEventListener("visibilitychange", hiddenRef.current);
      hiddenRef.current = null;
    }
  }, [teardownAudio]);

  /** Arm the energy detector on the SAME stream the recorder holds (never a second getUserMedia). Silent
   *  by contract (MED-2): no Web Audio, a context that won't leave `suspended`, a throwing node graph —
   *  every one degrades to ordinary push-to-talk. A recording that needs one extra tap is a non-event;
   *  an error toast on every recording would not be. The hidden-page stop is NOT part of that degrade
   *  (MED-1) — it is armed first, synchronously, and outlives any Web Audio failure below.
   *
   *  ARMED FOR EVERY RECORDING since the feel round (OF-3): what it reads is a LEVEL, which the record
   *  circle wants whatever the auto-stop policy says. The policy has not moved — the STOP decision inside
   *  the poll is still gated on `autoStopOn`, and with it off nothing here can end a recording. The
   *  degrade rule covers the meter too: a context that won't run means no level, never a broken mic. */
  const armDetector = useCallback(
    async (stream: MediaStream) => {
      // Council MED-1 — dictation is a screen-on activity: a hidden page ends the recording outright
      // rather than leaving the mic live behind a timer Android throttles to ~once a minute. Armed
      // before any Web Audio work, so an unavailable/suspended context can never leave the mic
      // recording untended; only the full teardown (every terminal path) removes it.
      const onHidden = () => {
        if (document.visibilityState === "hidden") stop();
      };
      document.addEventListener("visibilitychange", onHidden);
      hiddenRef.current = onHidden;
      if (typeof AudioContext === "undefined") return;
      let ctx: AudioContext;
      try {
        ctx = new AudioContext(); // constructed inside the start gesture, so it may autoplay-unlock
      } catch {
        return;
      }
      audioRef.current = ctx; // parked BEFORE the await, so a stop during it closes this context
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      // The parked context IS this arm's ownership token: if it is no longer the current one, the
      // recording ended (or a NEXT one already armed) while we awaited. A stale continuation closes
      // only its own context, best-effort, and touches nothing global — the live detector, whoever
      // owns it now, must survive it.
      if (audioRef.current !== ctx) {
        if (ctx.state !== "closed") void ctx.close().catch(() => {});
        return;
      }
      // Still ours, but the context never ran → drop the AUDIO only; the hidden-page stop above stays
      // armed for the rest of the recording, which is now plain push-to-talk.
      if (ctx.state !== "running") {
        teardownAudio();
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
        teardownAudio();
        return;
      }
      const samples = new Float32Array(analyser.fftSize);
      let silentMs = 0; // the current run of below-floor readings; silence BEFORE speech counts too
      pollRef.current = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += v * v;
        const rms = Math.sqrt(sum / samples.length);
        // ① THE METER — every reading, whatever the policy (OF-3). Straight to a registered consumer,
        //    never through state: at 10 Hz a `setState` would re-render the whole composer subtree.
        meterRef.current?.(Math.min(1, rms / METER_FULL_RMS));
        // ② THE POLICY — unchanged, and still the only thing that can end a recording from in here.
        if (!autoStopOn) return;
        if (rms >= silenceFloor) {
          silentMs = 0; // anything above the floor restarts the run
          return;
        }
        silentMs += SILENCE_POLL_MS;
        if (silentMs >= silenceMs) stop(); // the SAME path as tapping stop → onstop → upload
      }, SILENCE_POLL_MS);
    },
    [autoStopOn, silenceFloor, silenceMs, stop, teardownAudio],
  );

  /** The pre-flight EVERY entry shares — the tap, and (since S0.5) the gesture's activation. No
   *  mediaDevices → can't capture: re-explain the fix on every attempt (greyed but tappable, so it's
   *  never a dead/stuck control). Capable but plain HTTP (flag-whitelisted) → it WORKS (never greyed);
   *  just nudge once per session that HTTPS is the proper setup. Returns whether a recording may start.
   *  ONE function rather than a second copy in the gesture path: the degraded states are UX contracts
   *  (owner-locked 2026-06-22/26), and two copies is how one of them quietly stops being true. */
  const preflight = useCallback((): boolean => {
    if (!micCapable) {
      pushToast(INSECURE_MSG, "info");
      return false;
    }
    if (!httpsOn && !httpReminderShown) {
      httpReminderShown = true;
      pushToast(HTTP_REMINDER, "info");
    }
    return !unavailable;
  }, [micCapable, unavailable]);

  /** Open the mic and start recording. RESOLVES TO WHETHER A RECORDER ARMED (S0.5): the gesture holds a
   *  visible record affordance from the moment of activation, and a permission prompt that is declined —
   *  or a browser with no usable container — must close that affordance rather than leave it painted
   *  over a mic that never opened. `false` also covers the F5 abort (released during acquisition). */
  const start = useCallback(async (): Promise<boolean> => {
    // A NON-NULL `recRef` OWNS the recorder's lifecycle until one of its terminal callbacks releases
    // it (F2) — `state` alone is not enough: `stop()`/`cancel()` flip it to "inactive" synchronously
    // while the final `dataavailable`/`stop` events are still QUEUED, and a recording started inside
    // that window would overwrite the chunks, the discard flag and the stamp the late callback is
    // about to read. A too-early re-press gets `false` here and closes its own chrome, as it does for
    // every other reason a recorder does not arm.
    if (armRef.current || recRef.current) return false;
    if (!preflight()) return false;
    const arm = { aborted: false };
    armRef.current = arm;
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // ABORTED FIRST (F1): the gesture let go while the browser was still asking. A rejection that
        // lands after that is the user's own release, not a new fact to report — and the toast and the
        // teardown below both belong to the CURRENT attempt, whose detector/listener this one must not
        // touch. (The non-aborted path is unchanged: a real denial still explains itself.)
        if (arm.aborted) return false;
        teardownDetector(); // every failed start leaves the detector state clean (MED-2)
        pushToast("Microphone permission denied", "err");
        return false;
      }
      // F5 — the gesture ended (release, or a cancel) while the browser was still opening the mic.
      // Release the stream we were handed at once: an ownerless recording is the one outcome the
      // acquisition window must never produce.
      if (arm.aborted) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
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
        return false;
      }
      recRef.current = rec;
      chunksRef.current = [];
      discardRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        // OWNERSHIP ENDS HERE (F2) — before the upload, and before the discard branch returns: this is
        // the terminal callback the queued-events window was held open for, so the next `start()` is
        // free from now on. Guarded on the closure's own `rec` so a future defensive overwrite of the
        // ref is never clobbered by a late callback belonging to an older recorder.
        if (recRef.current === rec) recRef.current = null;
        teardownDetector(); // BEFORE the upload enters `sending` — the watcher dies with the recording
        stream.getTracks().forEach((t) => t.stop()); // release the mic indicator
        // CANCELLED (S0.5): the same teardown, and then nothing — no blob, no POST, no draft.
        if (discardRef.current) {
          discardRef.current = false;
          chunksRef.current = [];
          startedAtRef.current = 0;
          setPhase("idle");
          return;
        }
        void upload(rec.mimeType || "audio/webm");
      };
      rec.onerror = () => {
        // OWNERSHIP IS DELIBERATELY NOT RELEASED HERE (the confirm round's sweep): an `error` is not
        // the end of the event stream — the platform's inactivate steps fire the final `dataavailable`
        // and `stop` AFTER it, and releasing early would let a new `start()` reset the shared
        // discard/chunks/stamp that late `onstop` is about to read. The `onstop` above stays the ONE
        // releasing terminal; what the error arms is the discard flag (F4), which makes that `onstop`
        // a clean no-upload close-out.
        discardRef.current = true;
        teardownDetector();
        stream.getTracks().forEach((t) => t.stop());
        startedAtRef.current = 0;
        pushToast("Recording failed", "err");
        setPhase("idle");
      };
      rec.start();
      startedAtRef.current = Date.now(); // the 1000 ms floor's only input
      setPhase("recording");
      // ALWAYS armed (OF-3): the analyser is the METER first and the auto-stop's input second. The
      // policy toggle now lives inside the poll, so a recording with auto-stop off still behaves
      // exactly as it did pre-Tier-0 — nothing in here can stop it — and the level flows regardless.
      void armDetector(stream);
      return true;
    } finally {
      // Only if it is still OURS: an abort released the ref so a re-press could start immediately, and
      // that newer attempt's token must survive this one's unwind.
      if (armRef.current === arm) armRef.current = null;
    }
  }, [upload, preflight, armDetector, teardownDetector]);

  /** Tap handler — the KEYBOARD/AT path since S0.5 (R69 §8.1: tap-to-start, tap-to-stop). idle → start,
   *  recording → stop + transcribe. Inert while unavailable/sending; the degraded explainers ride
   *  `preflight`, which `start` re-runs for the gesture. */
  const toggle = useCallback(() => {
    if (phase === "recording") {
      stop();
      return;
    }
    // `start` runs the pre-flight itself; running it HERE too would double the plain-HTTP nudge. The
    // one case `start` cannot cover is a tap that must still explain itself while nothing may start.
    if (phase === "idle" && !unavailable) void start();
    else preflight();
  }, [phase, unavailable, start, stop, preflight]);

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
  // `toggle` is the keyboard/AT path; `start`/`stop`/`cancel` are the gesture's three verbs (S0.5).
  // There is one recorder behind all four. `meter`/`onTooShort` are the two ASSIGNABLE seams the feel
  // round added — both null-safe, both owned by whoever mounts (assign on mount, null on cleanup), so a
  // second composer can never inherit a dead handler.
  return { status, toggle, start, stop, cancel, meter: meterRef, onTooShort: tooShortRef };
}

/** The two assignable seams' type, named so a consumer can state what it registers. */
export type MicMeterRef = MutableRefObject<((level: number) => void) | null>;
export type MicTooShortRef = MutableRefObject<(() => void) | null>;
