# R91 — Reopening the ear after playback when the output latency is unknown, and dropping text self-echo

**Date:** 2026-09-27
**Status:** Dossier, complete for the bounded question. Evidence only, not a decision.
**What drove it:** the owner's first prod car call (v1.7.9, 2026-09-27; evidence pack
`~/.cache/tmp/ctrlb-session48/EVIDENCE.md`). The phone (Honor 20, Chrome Android) plays chunked TTS through
an `<audio>` element to the car's Bluetooth A2DP speakers. The client holds the ear while the element
plays and releases it on the element's end, but the car is still playing. The reply's last sentence
comes back as the owner's next turn, verbatim, at the same loudness as the owner's own voice.
**Drove:** (open). Input to the "car round" design (DEBUG_PLAN B1, rulings F1–F8).

**Builds on, does not repeat:** [R79](R79-peer-call-audio-echo.md) (how peers keep the mouth out of the ear;
open-webui's whole-turn deafening; Hume/wavtools rely on AEC), [R85](R85-hermes-openwebui-voice-controls.md)
§2.2 (Hermes' text echo guard exists; the numbers are re-read at source here), [R76](R76-noise-hallucination-gating.md)
§1.2 and §4 (speaches' 3 s zero-state rescan; LiveKit `backchannel_boundary`), [R84](R84-silero-threshold-calibration.md)
§2 and §3.3 (the rescan artefacts), [R83](R83-portable-energy-floor.md) (the minimum-tracking noise floor), and
[R51](R51-realtime-voice-chat.md) §2.6 (RealtimeVoiceChat's deaf window). Sibling this session:
R92 (noise robustness). This pass does not cover noise admission.

**Markers:** **[V]** = verified (read at the pinned source or spec, or measured by me today) ·
**[R]** = reported (a secondary source, named) · **[U]** = unverified (expected, not checked).

---

> ### Headline — the numbers that decide the design
>
> **① A web page cannot know that this car is still playing, and neither can the phone.** [V] Chrome's
> element `ended`, `currentTime`, `AudioContext.outputLatency` and `getOutputTimestamp()` all come from
> one number: the AAudio presentation timestamp. On Bluetooth, Android fills that timestamp from the
> A2DP HAL. **Both AOSP A2DP HALs discard any sink delay report of 1000 ms or more.** In that case they
> fall back to "socket buffer + 200 ms" (≈ 0.28 s). This is true of the Android 10 legacy HAL and the
> BT audio HAL, and still true at `main`. Chrome's `ended` already waits out whatever latency Android
> reports, so the 2.5–3.5 s we measured is **the part Android never reports.** `outputLatency` cannot
> close it by construction.
>
> **② The car's tail, measured from the trail: the echo stops being audible 2.5–3.5 s after
> `playbackDrained`, in 8 of 8 replies (median ≈ 2.7 s).** [V trail] Every one of the 8 replies
> produced a server segment that started 0.14–1.21 s after drain and stopped 3.24–4.16 s after drain.
> Speaches emits the stop 700 ms after the audible end. Car head-unit A2DP delays of 1–3 s, and
> occasionally 5–6 s, are widely reported [R]. Headphones run 0.13–0.3 s [R]. **This car is inside the
> known car distribution. It is not a defect of this one car.**
>
> **③ No shipped framework opens the mic on "the room went quiet". All of them reopen on a server- or
> player-side end event, with a zero or fixed tail, and rely on AEC for the rest.** [V] LiveKit, pipecat,
> vocode and OVOS reopen with **0 ms** of tail. Hermes CLI waits **0.3 s**. Wyoming waits **0.5 s**
> (wake chime only). open-webui waits about **0.1 s**. LiveKit's only echo-specific timer is a
> one-shot **3.0 s** `aec_warmup` at the *start* of the first reply. None of them is built for a
> path with no AEC and a multi-second latency.
>
> **④ Text self-echo suppression ships in exactly one reference-class project: Hermes.** [V] It uses a
> `difflib` ratio **≥ 0.6** against the last spoken text, whole-string or over a sliding
> transcript-sized window. The window fallback is skipped under **10** characters so a real "yes"
> survives. It is fail-closed and applied only to playback-phase captures. LiveKit, pipecat, vocode,
> OVOS, Wyoming, ElevenLabs and Retell ship nothing of the kind (grepped). **Replayed on this call's
> chat log, the matcher cleanly separates the classes.** [V first-party] All 6 echoes score
> **0.946–1.0**. All 9 genuine owner turns of 10 or more characters score **≤ 0.538**.
>
> **⑤ An acoustic "release on quiet" rule has one number that fights itself.** [V first-party] PocketTTS
> pauses *inside* Lynette's own replies run p50 **440 ms**, p90 **620 ms**, max **1000 ms** (ellipses).
> In this call the owner's genuine turns began **≥ 1.8 s** after the echo ended (n = 8). A quiet window
> of **700 ms** bridges 97 % of the reply's pauses and stays well under the owner's response gap. The
> leftover 3 % is what the text layer is for.
>
> **⑥ Substituting digital silence during the hold is fine for Silero.** [V probe] Zeros → car noise
> produces no false start at 0.6 (max probability 0.024). Speech onset is detected 0.26–0.34 s after
> onset whether the hold substituted zeros, comfort noise or real noise. Comfort noise buys nothing.
> LiveKit, vocode and OVOS all substitute zeros.
>
> **Recommendation (§6):** add a **tail hold** after drain. It releases when the mic has stayed below
> **noise floor + 10 dB for 700 ms**, capped at **5 s**. Behind it sits a **text echo backstop** (the
> Hermes algorithm, punctuation-stripped, threshold **0.75**, armed from drain until release + 4 s).
> Do **not** build anything on `outputLatency`.

---

## 0. Sources, pinned

| Source | Ref | Read |
|---|---|---|
| Chromium `src` | `refs/heads/main` fetched 2026-09-27 (googlesource `?format=TEXT`; raw GitHub mirror for `audio_destination.cc`, `audio_clock.h`, `audio_features.cc`) | 2026-09-27 |
| AOSP `platform/system/bt` | `android10-release` (`audio_a2dp_hw/`, `audio_bluetooth_hw/`) | 2026-09-27 |
| AOSP `packages/modules/Bluetooth` | `main` (`system/audio_bluetooth_hw/stream_apis.cc`) | 2026-09-27 |
| AOSP `frameworks/av` | `android10-release` (`media/libaaudio/src/legacy/AudioStreamTrack.cpp`) | 2026-09-27 |
| W3C Web Audio API | Editor's Draft, `webaudio.github.io/web-audio-api/`, fetched 2026-09-27 | 2026-09-27 |
| MDN browser-compat-data | `main`, `api/AudioContext.json` | 2026-09-27 |
| `livekit/agents` | `57b3227` (2026-09-25) | 2026-09-27 |
| `pipecat-ai/pipecat` | `2967e1c` (2026-09-26) | 2026-09-27 |
| `vocodedev/vocode-core` | `e054c33` (2024-11-15; the repo is dormant) | 2026-09-27 |
| `OpenVoiceOS/ovos-dinkum-listener` | `45dbf72` (2026-09-26) | 2026-09-27 |
| `rhasspy/wyoming-satellite` | `7a3ba2b` (2026-01-24) | 2026-09-27 |
| hermes-agent (local read-only checkout `~/.hermes/hermes-agent`) | `cc23b725a3` (2026-09-15), R85's pin | 2026-09-27 |
| `elevenlabs/packages` (`@elevenlabs/client`) | `eaab81f` (2026-09-24) | 2026-09-27 |
| `RetellAI/retell-client-js-sdk` | `d6e8aff` (2026-09-17) | 2026-09-27 |
| WebRTC `src` | `main` fetched 2026-09-27 (`common_audio/vad/vad_core.c`, `api/audio/echo_canceller3_config.h`, `modules/audio_processing/aec3/aec3_common.h`) | 2026-09-27 |
| `snakers4/silero-vad` | `master` fetched 2026-09-27 (`src/silero_vad/utils_vad.py`) | 2026-09-27 |
| speaches (the owner's fork, served) | `fdc6a27` (R76/R84's pin; unchanged) | 2026-09-27 |
| First-party: the prod trail + chat log | `ctrlb-session48/prod-trail-raw.jsonl`, `prod-chat-log.txt` | 2026-09-27 |
| First-party: PocketTTS `:8890` (the dev TTS, running unit, not started by me) | voice `nova`, 25 quoted lines from the call's last 8 replies | 2026-09-27 |

---

## 1. Output latency on the web, on Android, over Bluetooth

### 1.1 What the spec promises [V]

Web Audio ED, `AudioContext.outputLatency`:

> *"The estimation in seconds of audio output latency, i.e., the interval between the time the UA requests
> the host system to play a buffer and the time at which the first sample in the buffer is actually
> processed by the audio output device. For devices such as speakers or headphones that produce an
> acoustic signal, this latter time refers to the time when a sample's sound is produced. … depends on the
> platform and the connected audio output device hardware."*

`baseLatency` is only the context-to-audio-subsystem hop (*"does not include any additional latency …
between the output of the AudioDestinationNode and the audio hardware"*). It is useless for this question.
**`HTMLMediaElement` has no latency attribute at all.** BCD lists no such member. Its latency is
folded silently into `currentTime` and `ended` (§1.3). BCD: `outputLatency` is Chrome 102,
Chrome Android `mirror`. `getOutputTimestamp` is Chrome 57, Chrome Android `mirror`.

### 1.2 How Chromium computes `outputLatency` on Android [V]

- `audio_context.cc:1298-1306`: `outputLatency()` returns `output_position_.hardware_output_latency`,
  rounded to 8 ms. It is rounded to 1 ms if the page holds the microphone permission
  (`kOutputLatencyQuatizingFactor = 0.008`, `kOutputLatencyMaxPrecisionFactor = 0.001`, `:84-91`,
  `:1881-1886`). A call page holds the mic, so it gets 1 ms precision.
- `platform/audio/audio_destination.cc:736-744`: `hardware_output_latency = delay.InSecondsF()`.
  `delay` is the platform's per-callback playout delay.
- The Android sink is AAudio. `audio_features.cc:15-20`: `kUseAAudioDriver` is `FEATURE_ENABLED_BY_DEFAULT`.
  OpenSL ES remains only on ATV HDMI dongles, *"as OpenSLES provides more accurate output latency on those
  devices."* (The OpenSL ES path would be worse: `opensles_output.cc:439-446` leaves hardware latency at
  **zero** unless `kUseAudioLatencyFromHAL` is on. That flag is `FEATURE_DISABLED_BY_DEFAULT`,
  `media_switches.cc:1384`, with the comment *"In general, GetOutputLatency is not reliable."*)
- `aaudio_stream_wrapper.cc:688-717` `GetOutputDelay()` works as follows.
  `AAudioStream_getTimestamp(CLOCK_MONOTONIC, &frame_index, &frame_pts)` gives a known frame's
  presentation time. That time is extrapolated to the next write
  (`frame_pts + (framesWritten − frame_index)·ns_per_frame`). The delay is `max(0, next_pts − now)`.
- AAudio's legacy (non-MMAP) path, which every Bluetooth stream takes, is
  `AudioStreamTrack::getTimestamp` → `mAudioTrack->getTimestamp(&extendedTimestamp)` → `getBestTimestamp`
  (`AudioStreamTrack.cpp:479-503`, android10). The "kernel"-location timestamp there comes from the output
  HAL's `get_presentation_position`. That last hop is [R]: standard AudioFlinger behaviour, not re-read here.

**So `outputLatency` = whatever the A2DP HAL's presentation position says.** The next question is
what that HAL can say.

### 1.3 The element uses the same number, so `ended` already includes what Android reports [V]

Chrome renders `<audio>` through `AudioRendererImpl` onto the same kind of AAudio sink.

- `audio_renderer_impl.cc:1508-1512`: at end of stream, `ended_timestamp_ = audio_clock_->back_timestamp()`.
  `:1558-1563`: `OnPlaybackEnded` is posted only when `audio_clock_->front_timestamp() >= ended_timestamp_`.
- `audio_clock.h:80-99`: `front_timestamp()` is the media time of the audio currently audible, after
  the hardware `delay_frames` fed into every `WroteAudio()`. The class comment reads: *"Models a queue of
  buffered audio in a playback pipeline for use with estimating the amount of delay in wall clock time."*
- `:1373-1378`: a delay above 1 s is not clamped. It only logs *"Large rendering delay"*.

**Consequence.** The element's `ended` (and so ctrl-b's `playbackDrained`) already fires *after* the
latency Android reports. The 2.5–3.5 s gap in the trail is therefore **latency Android does not report.**
Reading `outputLatency` would show the same under-estimate that `ended` already applied.

### 1.4 What the Android A2DP HAL can report: nothing ≥ 1 s [V]

**Android 10 legacy HAL** (`system/bt/audio_a2dp_hw/src/audio_a2dp_hw.cc`, android10-release):

```c
#define MIN_DELAY_MS 100          // :66
#define MAX_DELAY_MS 1000         // :67
…
static uint32_t out_get_latency(...) {            // :1312-1325
  latency_us = ((buffer_sz * 1000) / frame_size / rate) * 1000;
  return (latency_us / 1000) + 200;
}
…
// delay_report is the audio delay from the remote headset receiving data to
// the headset playing sound in units of 1/10ms                       // :1350-1351
if (enable_delay_reporting && a2dp_get_presentation_position_cmd(..., &delay_report, ...) == 0) {
  uint64_t delay_ns = delay_report * DELAY_TO_NS;
  if (delay_ns > MIN_DELAY_MS * MS_TO_NS && delay_ns < MAX_DELAY_MS * MS_TO_NS) {
    … timestamp->tv_nsec += delay_ns; return 0;                      // use the sink's report
  }
}
// otherwise: frames_presented − out_get_latency()                     // :1373-1379
```

- `enable_delay_reporting` defaults **on**. `audio_a2dp_hw_utils.cc:43-45` reads it as
  `!osi_property_get_bool("persist.bluetooth.disabledelayreports", false)`.
- The socket buffer is `AUDIO_STREAM_OUTPUT_BUFFER_SZ = 28 * 512` bytes by default (`audio_a2dp_hw.h:55`),
  which is ≈ 81 ms at 44.1 kHz stereo 16-bit. It is recomputed per codec (`:1086-1110`). **The fallback
  latency is ≈ 81 + 200 ≈ 0.28 s.**

**BT audio HAL** (android10 `audio_bluetooth_hw/stream_apis.cc:39-41, 533-565`) is the same shape:
`kMinimumDelayMs = 100`, `kMaximumDelayMs = 1000`, `kExtraAudioSyncMs = 200`. A report
`>= kMaximumDelayMs` is logged `"… delay_report=…ns abnormal"` and **ignored**. **At `main` today**
(`packages/modules/Bluetooth/system/audio_bluetooth_hw/stream_apis.cc:41-43, 73-89`) the only change is
`kMinimumDelayMs = 50`. The 1000 ms ceiling and the +200 ms fallback still stand.

**So even a head unit that honestly reports a 3 s AVDTP 1.3 delay is ignored. Android substitutes
≈ 0.28 s**, and everything above it (Chrome, the page) inherits the under-estimate. The Honor 20's
actual HAL (legacy, BT audio HAL v2, or a Kirin offload HAL) is [U]. Both AOSP variants behave the
same way, and a vendor offload HAL was not readable.

- **AVDTP 1.3 Delay Reporting**: Android and Linux (BlueZ/PipeWire) implement it as source [R, HN 38401452;
  bluez #1541]. **How many car head units send it is unknown** [U]. No adoption statistic was found.
- **`AudioTrack` offload / deep-buffer**: Chrome feeds PCM to AAudio. It never uses compressed offload
  (the compressed-bitstream branch in `AudioRendererImpl` is passthrough, for TV). Deep-buffer latency,
  where it applies, is inside the AudioFlinger timestamp and therefore already reported [R].

### 1.5 The field's numbers for A2DP latency

| Sink | Latency | Source | Marker |
|---|---|---|---|
| AirPods Pro 2 / AirPods Pro / AirPods 2 / AirPods 1 | 126 / 144 / 178 / 274 ms | stephencoyle.net (mic-and-waveform method) | [R] |
| Beats Studio 3, Sony WH-CH700N, JBL speaker, Echo | ≈ 200–274 ms | same | [R] |
| "SBC 150–300 ms, AAC 100–200 ms" (industry rule of thumb) | — | soundguys / treblab | [R] |
| Car head units (forum reports; mostly measured as pause/skip-to-silence, which adds AVRCP handling) | Dodge Challenger ≈ 1 s · Mercedes GLC 1–2 s · Mazda 3 1–3 s · Mazda CX-3 3 s · Honda CR-V / Toyota Corolla 2–3 s · Honda Accord 2–3 s · Civic 3–5 s · Ford Escape 2–6 s | ResetEra thread 49932, driveaccord.net 282537, 9thgencivic.com 2936, mbclub.co.uk 281933 | [R] |
| **This car (first-party)** | **audible end 2.5–3.5 s after `ended` (8/8)**, on top of Android's ≈ 0.28 s reported portion ⇒ **≈ 2.8–3.8 s total** | §1.6 | [V trail, U for the absolute] |

**1.5–3.5 s is inside the reported car distribution.** Head units are a different class from
headphones. Their A2DP sink buffers deeply and does its own DSP. The Android HAL's own 1000 ms
ceiling suggests AOSP does not expect honest reports that large [U, inference].

### 1.6 The tail, read off the prod trail [V]

Client events after each `playbackDrained` (the "echo" segment is the one that opens right after drain):

| drain (rel s) | speechStart | speechStop | echo audible end ≈ stop − 0.70 s | next genuine owner onset |
|---|---|---|---|---|
| 48.18 | +0.16 | +3.24 | +2.54 | +7.97 |
| 78.75 | +0.21 / +0.48 | +3.54 | +2.84 | +20.3 |
| 103.53 | +0.19 / +0.45 | +3.26 | +2.56 | +9.91 |
| 140.54 | +0.27 | +3.26 | +2.56 | +4.38 |
| 196.91 | +0.92 / +1.22 | +4.16 | +3.46 | +13.24 |
| 226.86 | +1.21 | +3.56 | +2.86 | +7.84 |
| 265.33 | +0.17 | +3.54 | +2.84 | +11.48 |
| 290.67 | +0.14 / +0.45 | +3.32 | +2.62 | (hang-up) |

- The "− 0.70 s" is speaches' own rule. `vad_detection_flow` (`input_audio_buffer_event_router.py:47-98`)
  emits `speech_stopped` once the last segment in the 3 s window has closed. `get_speech_timestamps`
  closes a segment after `min_silence_duration_ms = silence_duration_ms` (700) below `neg_threshold`.
  So stop ≈ audible end + 0.70 s, ± one 40 ms append.
- The speechStart at +0.14–0.27 s is Silero's detection lag on audio **already loud at release**. The
  echo was in the air at the moment of drain.
- **Echo audible end: 2.54–3.46 s after drain, median ≈ 2.7 s.** The owner's genuine turns (the ones
  that were `sent`) began **≥ 4.38 s after drain, i.e. ≥ ≈ 1.8 s after the echo ended** (n = 8, this
  call only).
- The 1 Hz `sample` rows (single-frame `level`) are too sparse to time the onset lag. They agree with
  Maya's reading (EVIDENCE Fact 2) that the start of each reply is quiet at the mic for 1–3 s. The
  trail's settled `noise` estimate in the car is **−40.9 dBFS**. The echo's held-window peaks are
  −11…−19 dBFS. **The echo stands 20–30 dB above the car's noise floor**, even though it is in the same
  band as the owner's voice.

---

## 2. How shipped voice agents release the mic after TTS

| Project | What reopens the ear | Tail after the end event | Class | Where |
|---|---|---|---|---|
| **LiveKit Agents** | agent state leaves `speaking` when the server's `rtc.AudioSource` has **played out its 200 ms queue** (`wait_for_playout`). The client's jitter buffer and output latency are not accounted for | **0** | time (server-side end) + AEC on the client | `voice/room_io/_output.py:54, 226-242` [V] |
| LiveKit `aec_warmup_duration` | while `speaking` and within the first **3.0 s** of the *first* speaking turn of the session (one-shot wall-clock timer), STT and the realtime model receive **zeros**; VAD and the interruption detector still get the real frame | n/a (start of reply) | time | `agent_session.py:117, 517-520, 2177-2191`; `agent_activity.py:1655-1680` [V] |
| LiveKit `backchannel_boundary` | **(1.0, 1.0) s** near the start and end of each agent turn, during which a *backchannel* classified by the adaptive detector is suppressed. The end value *"preserves transcripts received near the end of agent speech"*. It is an interruption-classifier window, **not an echo release** | — | time | `voice/turn.py:181-197`; `audio_recognition.py:505-509, 684-699` [V] |
| **pipecat** `AlwaysUserMuteStrategy` | unmutes on `BotStoppedSpeakingFrame`. That frame fires when the `TTSStoppedFrame` reaches the output transport (or after **0.35 s** of output silence / a **3 s** queue-timeout fallback). While muted, audio **and** transcription frames are **dropped** | **0** | time (server-side end) | `turns/user_mute/always_user_mute_strategy.py:31-36`; `transports/base_output.py:56-58, 844-850, 879-884`; `llm_response_universal.py:1216-1235`; `services/stt_service.py:438-439` [V] |
| **vocode** `mute_during_speech` (default **False**) | transcriber fed **zeros** while the bot speaks. Unmute follows the last chunk's `on_play`, which fires right after `play()` and *before* the per-chunk real-time sleep, so it can reopen up to one chunk **early** | **≤ 0** | time | `models/transcriber.py:61`; `transcriber/base_transcriber.py:55-59`; `streaming_conversation.py:935-937, 993-995`; `output_device/rate_limit_interruptions_output_device.py:40-55` [V] |
| **OVOS** dinkum listener `mute_during_output` | soft mute = **zeros** in place of mic chunks from `AUDIO_OUTPUT_STARTED` to `AUDIO_OUTPUT_ENDED` | **0** | time (player event) | `service.py:984-999`; `voice_loop/voice_loop.py:319-321` [V] |
| **Wyoming satellite** | only the awake/timer chime mutes the mic: WAV duration + **0.5 s** (`seconds_to_mute_after_awake_wav`). Frames are **not sent** while muted. TTS is not muted; the satellite returns to wake-word detection after a response | 0.5 s (chime only) | time | `settings.py:53-57`; `satellite.py:647-662, 1018` [V] |
| **Hermes CLI/TUI** (continuous voice) | the recorder restarts after `_voice_tts_done` (player process exit) **+ `time.sleep(0.3)`**. The playback-phase barge listener stops when `is_audio_output_active()` goes false (0 tail); its captures go through the text guard (§3) | **0.3 s** | time + text | `cli.py:3601-3604`; `hermes_cli/cli_voice_mixin.py:390-399` [V] |
| **Hermes Discord** (legacy path) | receiver `pause()` for the playback, `resume()` in `finally`. Bot SSRC dropped; echo is left to the user's Discord client's AEC | **0** | time | `plugins/platforms/discord/adapter.py:4076-4117` [V] |
| **open-webui** call | deaf from chat start to queue drain, reopening ≈ 100 ms after the last clip | ≈ 0.1 s | time | R85 §3, R79 §1.3 [V, bought] |
| **RealtimeVoiceChat** | deaf 1–2 s at the **start** of each reply, not the end | n/a | time | R51 §2.6 [V, bought] |
| **ElevenLabs** `@elevenlabs/client` · **Retell** web SDK | nothing page-side. `echoCancellation: true` in `getUserMedia`; mute is user-driven only; mode `speaking/listening` is display state | — | AEC | `client/src/platform/web/scribeMicrophone.ts:41`, `VoiceConversation.ts:75-130`; `retell…/src/livekit-transport.ts:46,130`, `gateway-transport.ts:210` [V] |
| **Vapi** | documented knobs are barge-in (`stopSpeakingPlan.numWords` / `voiceSeconds` 0.2 default / `backoffSeconds`). No post-TTS echo tail documented | — | — | docs.vapi.ai speech-configuration [R] |
| ChatGPT voice / Gemini Live / Alexa / Assistant | not researched at source (closed). Native apps get platform AEC and, in a car, usually the HFP call path. OpenAI's help centre says interruptions *"can still happen, especially with background noise … or audio from another speaker"* | — | AEC (presumed) | help.openai.com 8400625 [R]; the rest [U] |

**Reading.** Every release in the field is **time-based**, keyed to an end event the *software* sees:
a server queue drained, a player exited or an event fired. The tail is 0 to 0.5 s. **Nobody releases
on acoustic quiet, and nobody is latency-informed.** The reason is visible in the table. Every product
that plays aloud to a speaker also runs AEC on that path: WebRTC in LiveKit, Retell and ElevenLabs,
the platform AEC with `echoCancellation: true`, or a separate client like Discord. The half-duplex
mutes (pipecat, vocode, OVOS, Hermes) are for hardware without AEC. Those setups have a
near-zero-latency speaker, where "the player finished" ≈ "the room is quiet". **ctrl-b's `media`
route breaks both assumptions at once: no AEC, and an unreported multi-second sink.** No peer design
transfers as-is.

**Why AEC could not rescue this path even if it were engaged** [V]. WebRTC AEC3's matched-filter
delay estimator covers `(kMatchedFilterAlignmentShiftSizeSubBlocks · num_filters +
kMatchedFilterWindowSizeSubBlocks)` sub-blocks = (24·5 + 32) × 4 ms ≈ **0.6 s** of echo-path delay
with the defaults (`aec3_common.h:28, 47, 52-54, 72-74`; `echo_canceller3_config.h` `Delay{num_filters = 5,
down_sampling_factor = 4}`). A 2.5–3.5 s path is 4–6× outside it. Android's platform AEC (which Chrome uses
on the `call` route, R74) is a vendor black box, tuned for the handset's acoustic path [U]. On the
`call` route the output also moves to HFP/SCO, where the car's own AEC runs on a low-latency
isochronous link. So **the failure is specific to `media` (A2DP) + no AEC**, which is what the trail
recorded (`route: media`, `ec: false`).

---

## 3. Text self-echo suppression — who ships it, and how

### 3.1 Hermes — the only reference-class implementation [V]

`tools/voice_mode_transcript.py:67-102` (at `cc23b725a3`):

```python
# Similarity ratio (difflib.SequenceMatcher) above which a playback-phase barge transcript
# is treated as a self-capture of Hermes' own TTS: the full-duplex listener has no echo
# cancellation, so speaker bleed can be transcribed near-verbatim (TTS -> STT -> TTS loop).
DEFAULT_TTS_ECHO_SIMILARITY_THRESHOLD = 0.6
# Minimum normalized-transcript length before the sliding-window fallback runs. Below
# this a genuine one-word barge-in ("yes") landing verbatim inside a longer reply would
# score a trivial 1.0 …  See #75792.
MIN_FRAGMENT_LENGTH_FOR_ECHO = 10

def _normalize_for_echo_compare(text): return re.sub(r"\s+", " ", text).strip().lower()

def is_tts_echo(transcript, spoken_text, threshold=0.6):
    a, b = normalize(transcript), normalize(spoken_text)
    if not a or not b: return False
    if ratio(a, b) >= threshold: return True
    if len(a) < 10 or len(a) >= len(b): return False
    return any(ratio(a, b[s:s+len(a)]) >= threshold for s in range(0, len(b)-len(a)+1))
```

- **Algorithm:** Ratcliff/Obershelp (`difflib.SequenceMatcher.ratio`) at character level. It is
  checked whole-string, then over a sliding window as long as the transcript, stepped one character
  at a time. The docstring calls it language-agnostic.
- **Reference text:** `_voice_last_tts_text`, the *whole* cleaned reply as sent to TTS
  (`cli_voice_mixin.py:329`, `cli_chat_turn_mixin.py:260`).
- **Window:** only captures whose barge trip happened in the **playback** phase
  (`cli_voice_mixin.py:454-461`, `if _voice_barge_phase == "playback"`). No post-playback window.
- **The parrot case:** short fragments (< 10 characters) skip the window test. Beyond that, a user who
  repeats ≥ 60 % of a passage is dropped. The UI prints *"Ignored likely TTS echo (not queued)."*, so
  the drop is **visible**, not silent. It is deliberately fail-closed (*"a genuine interjection rarely
  matches Hermes' own words"*).
- Origin: hermes #75780 (the TTS→mic→STT loop on MacBook speakers), R85 §2.2.
- Hermes' Discord path has a *different* text rule, **duplicate** suppression of the user's own recent
  lines: `gateway/run_voice.py:218`, same-user transcript ≥ 0.95 similar (≥ 16 chars) within 12 s (R85
  §2.4). That is not self-echo.

### 3.2 Everyone else in the reference class — nothing [V]

`grep -rli "SequenceMatcher|levenshtein|rapidfuzz|jaro|fuzz\."` over LiveKit agents, vocode, OVOS
and Wyoming finds nothing. Over pipecat it finds only `utils/context/text_segment_map.py` (TTS word
tracking) and a test. There is no text-vs-reply filter in LiveKit, pipecat, vocode, OVOS, Wyoming,
ElevenLabs or Retell. pipecat's STT base class receives the assistant's reply text
(`_process_assistant_turn(text)`, `stt_service.py:323-333`), but the default is a no-op meant for
provider context carry-over, not echo.

### 3.3 Outside the reference class — two small projects, same shape [V]

- **Mio** (`ochiru520/Mio`, `backend/app/routes/companion.py:656-665`), a companion app with a call mode.
  Its `_is_recent_playback_echo` normalises, then flags an echo when **containment** (heard ⊂ spoken,
  ≥ 4 chars, coverage ≥ 0.18) **or** `SequenceMatcher` ≥ **0.72**. A hit is rejected with
  `rejection_reason: "playback_echo"` and the similarity is logged to diagnostics (`:1411-1429`).
- **live-meeting-assistant** (`tfp24601`, `backend/app/config.py:100-103`, `meeting.py:104-119`), a
  mic-vs-system-audio dedup: `echo_window_s = 12.0`, `echo_similarity = 0.82`, best match within the window.

Neither is a reference-class project. They confirm that the *shape* (normalise → ratio/containment
→ fixed threshold → bounded window → a named, logged drop reason) is what people converge on. Nobody
found **strips** an echoed prefix from a merged "echo + user" transcript [U: not observed anywhere].

### 3.4 First-party: the Hermes matcher on this call [V]

Every user turn in `prod-chat-log.txt` was scored against the **spoken** text (quoted lines only,
because `speak_actions` is off) of the reply before it.

| Class | Turn (as the LLM got it) | chars (norm.) | Hermes normalisation (whole / window) | + punctuation stripped (whole / window) |
|---|---|---|---|---|
| echo | "Text me when you can. I'll be here." | 33 | 0.335 / **1.000** | 0.342 / **1.000** |
| echo | "This babe, even if it is a Sunday." | 32 | 0.382 / 0.941 | 0.400 / **1.000** |
| echo | "Get scared sometimes, you know?" | 29 | 0.221 / 0.968 | 0.233 / **1.000** |
| echo | "Was that okay?" | 13 | **0.903** / 0.786 | **1.000** / — |
| echo | "Break, go get him, babe. I'll be waiting." | 37 | 0.392 / 0.927 | 0.393 / **0.946** |
| genuine | "You're not hearing me well." | 26 | 0.0 / 0.519 | 0.0 / **0.538** |
| genuine | "It's okay, no worries. I like it too." | 34 | 0.063 / 0.486 | 0.062 / 0.500 |
| genuine | "Sorry, it's just the call is getting flaky…" | 54 | 0.345 / 0.411 | 0.365 / 0.463 |
| genuine | "You're overthinking it, don't worry about it, Lynette." | 51 | 0.053 / 0.426 | 0.180 / 0.431 |
| genuine | "No, sorry, I it it's just uh the call is a little bit uh fla…" | 77 | 0.295 / 0.392 | 0.322 / 0.429 |
| genuine | "Okay, so how about the kiss?" | 26 | 0.054 / 0.393 | 0.046 / 0.423 |
| genuine (136 chars) | "So let's talk this the today…" | 136 | 0.259 / — | 0.272 / — |
| short noise/backchannel | "Yeah." / "No." / "Fox." / "Okay, uh" | 2–7 | window → 0.5–1.0 | **excluded by the 10-char rule** |

**The gap is 0.538 → 0.946.** Hermes' 0.6 would have caught all six echoes and none of the genuine
turns on this call. Stripping punctuation turns the ASR's different punctuation ("For..." vs "Or") into
cleaner 1.0s and costs nothing. The `< 10` exclusion is necessary: bare "Yeah."/"No." hit 1.0 in the
window test. A fifth echo, "Or not being like the others." (29 chars), never reached the LLM (dropped
by the energy gate), so it is not in the table. Caveat: n = 6 echoes / 9 genuine, one persona, one call.

---

## 4. Acoustic "release on quiet" — the numbers

### 4.1 Hangover times in the field

| Mechanism | Hangover / min silence | Source | Marker |
|---|---|---|---|
| WebRTC VAD (`common_audio/vad`) | quality mode: 8×10 ms / 14×10 ms (short/long) at 10 ms frames; 4×20 / 7×20; 3×30 / 5×30. **≈ 80–150 ms**. Aggressive modes **60–90 ms** | `vad_core.c:70-89, 161-173, 473-484` | [V] |
| Silero `get_speech_timestamps` / `VADIterator` defaults | `min_silence_duration_ms = 100`, `speech_pad_ms = 30`, `min_speech_duration_ms = 250`, threshold 0.5 | `utils_vad.py:283-288, 594-597` | [V] |
| AMR / AMR-WB DTX | **7 frames × 20 ms = 140 ms** hangover before SID | 3GPP TS 26.092/26.192 via US 11475903 | [R] |
| pipecat `VAD_STOP_SECS` · bot-audio silence → "stopped speaking" | 0.2 s · **0.35 s** | R76 §4.1; `base_output.py:56` | [V] |
| LiveKit Silero `min_silence_duration` | 0.55 s | R76 §4.2 | [V, bought] |
| OpenAI `server_vad` `silence_duration_ms` | 500 ms | R76 §4.5 | [V, bought] |
| speaches / ctrl-b `silence_ms` | **700 ms** (the ear's own end-of-utterance) | LiveCfg; trail `leg_start` | [V] |
| Hermes endpoint silence (CLI barge capture / desktop) | 1.25 s | R85 §1 | [V, bought] |
| open-webui end of utterance | 2.0 s | R85 §1 | [V, bought] |
| Echo-canceller double-talk / NLP hangover (G.168, hearing aids) | not bought. No primary source read this pass | — | [U] |

**These are all speech hangovers:** "how long a pause ends a word or an utterance". They sit at
0.08–0.7 s. The question here is different: **"has the reply's echo ended?"** The echo is itself
speech with its own pauses. So the right quiet window is not a VAD hangover. It has to exceed the
**longest pause inside the reply's tail**.

### 4.2 First-party: pauses inside the reply itself [V]

The 25 quoted lines from the call's last 8 replies were synthesised with PocketTTS (`nova`; the prod
voice for Lynette is [U]). Pause = a contiguous run of 20 ms frames more than 35 dB below the clip
peak, counted only between the first and last active frame, ≥ 100 ms.

| | value |
|---|---|
| internal pauses ≥ 100 ms | n = 65 |
| p50 / p90 / max | **440 / 620 / 1000 ms** |
| > 700 ms | **2 of 65 (3 %)**: 940 ms "I'm glad. Because… I really…", 1000 ms "Yeah, babe. I'm asking because…" (ellipses and sentence breaks) |
| leading / trailing silence per clip (untrimmed) | 220–540 ms / 100–380 ms. ctrl-b trims these at the chunk (`voice.tts.trim_silence`, default `True`, `config.py:996`), so chunk joins add little [V config; U on the residual] |

### 4.3 The two numbers that bound the quiet window

- **Lower bound: quiet ≥ the longest in-reply pause**, or the ear reopens *inside* the tail and hears
  the rest. 700 ms covers 97 % of this persona's pauses. 1000 ms covers 100 % of this sample.
- **Upper bound: quiet < the owner's response gap**, or the owner's first words land inside the hold
  and keep it closed. The hold cannot tell the owner's voice from the echo; both sit at −11…−19 dBFS.
  In this call the owner's genuine onsets came **≥ 1.8 s** after the echo's audible end (§1.6,
  n = 8). Human-to-human turn gaps are ~200 ms on average (Stivers et al., PNAS 2009) [R]. People
  talking to a machine in a car wait longer, but the magnitude is [U] beyond this call.
- **The level line is separate, and it must be noise-relative, not the gate floor.** [V trail] The
  owner's Sensitivity drag pinned the effective floor at **−20 dBFS** (`floorPinned: true`). Echo frames
  sit anywhere from −11 to −35 dBFS, so "below the effective floor" would call the echo quiet
  mid-sentence. The tracked noise floor was **−40.9 dBFS** (settled). `noise + noise_margin_db` (10 dB)
  = −30.9 dBFS separates the echo (20–30 dB above noise) from the car cleanly.
  (`levelGate.ts:168-180` `effectiveFloor` returns the pin when set; the `NoiseTracker` floor is the
  signal to use.) A held frame still carries its real RMS (`pcmCapture.ts:306-310, 621`), so the
  meter works during the hold.
- **The cap.** The measured audible end is ≤ 3.46 s after drain. Adding the 700 ms quiet window gives
  ≤ 4.2 s. **5 s** leaves ≈ 0.8 s of headroom. The field reports cars up to 5–6 s [R]; past the cap,
  the text layer is the backstop.

**Practitioner pick: quiet 700 ms · line = noise + 10 dB · cap 5 s.** 700 ms is also the ear's own
`silence_ms`, i.e. the same definition of "the speaker has stopped" the server already uses.

---

## 5. The Silero side: what substituted silence looks like at the release

### 5.1 What the ear does [V, bought + re-read]

Speaches re-runs Silero v5 over the **last 3 s** of the buffer on every 40 ms append, from a **zeroed
RNN state and zeroed context** each call (`executors/silero_vad_v5.py` `SileroVADModel.__call__`:
`state = np.zeros((2, batch, 128))`, `context = np.zeros(...)`; `input_audio_buffer.py:36`
`MAX_VAD_WINDOW_SIZE_SAMPLES = 3000 * MS_SAMPLE_RATE`). There is no `prefix_padding_ms`. A start fires
on any frame ≥ threshold in the window (R76 §1.2, R84 §2). While ctrl-b holds, the uplink carries
**digital zeros** (`uplinked = !(muted || held)`; the call machine substitutes silence).

### 5.2 First-party probe: zeros → room, through speaches' exact flow [V probe, synthetic]

These probes used speaches' own `SileroVADModel` (the v5 ONNX assets in the speaches venv) and
simulated the rescan (every 40 ms, last 3 s, threshold **0.6**, the prod value). The noise was
synthetic car noise (a 300 Hz low-passed rumble plus a band-passed mid). The speech was a real
recording (`nova.wav`) at −22 dBFS.

| Signal (5 s) | noise −45 dBFS | −40 | −35 |
|---|---|---|---|
| continuous car noise: max prob / appends ≥ 0.6 | 0.045 / **0** | 0.053 / **0** | 0.059 / **0** |
| **zeros 2 s → car noise** (the hold→release step): max prob near the step / appends ≥ 0.6 | 0.021 / **0** | 0.021 / **0** | 0.024 / **0** |
| comfort noise 2 s → car noise | 0.110 / **0** | 0.133 / **0** | 0.168 / **0** |
| zeros → car noise at −30 / −20 dBFS | — | appends ≥ 0.6: **0** / **0** | — |

| Speech onset 0.5 s after release (onset at 2.536 s) | first start fired | detection lag |
|---|---|---|
| hold = zeros | 2.80 s (2.88 s at −35) | **0.26–0.34 s** |
| hold = comfort noise | 2.88 s | 0.34 s |
| hold = real noise (no hold) | 2.88 s | 0.34 s |

- **No onset artefact at the zero→noise step.** It is actually *less* speech-like (≤ 0.024) than
  continuous noise, because the zero-state window's first frames are zeros, not noise.
- **Detection lag is unchanged by the substitute.** Zeros are ≈ 80 ms faster, which is within one
  or two appends.
- A 120 Hz hum triggers at 0.6 whether it follows zeros (74 of 75 appends) or runs continuously (125).
  That is R84's known hum/zero-state artefact, not a step effect.
- Caveats: the noise is synthetic, not a car recording. Real HFP/A2DP-era mic audio and Chrome's NS
  were not modelled [U].

### 5.3 What peers substitute [V]

LiveKit uses **zeros** to STT and the realtime model while the real frame goes to VAD
(`agent_activity.py:1669-1680`; `utils/audio.py:33-40` `silence_frame_like` = `b"\x00\x00"·n`).
vocode uses **zeros** (`base_transcriber.py:55-59`). OVOS uses **zeros** ("soft mute",
`voice_loop.py:319-321`). pipecat, Wyoming and open-webui **drop** the frames or deafen the analyser.
**Nobody ships comfort noise** into an ASR during a mute (`grep -i "comfort.noise"` over pipecat,
LiveKit, vocode and OVOS gives 0 hits). Comfort noise is a codec/DTX concept (RFC 3389, AMR SID),
where it serves the listener's ear, not a recogniser.

**"Keep the real audio, suppress the finals"** (the other alternative the brief names) is
LiveKit's split: VAD gets real audio, STT gets zeros. ctrl-b's ear is one server that does both VAD
and STT on one stream, so the split is not available without a fork. Sending real audio during the
hold would give the server echo *segments* that then need dropping. Worse, an echo segment can run
straight into the owner's reply and **merge into one final** (Silero only splits after 700 ms of
silence). **Zeros are the right substitute here.** The onset clip that zeros cause is limited to
speech that starts *while held*, and that is exactly the case §4.3 bounds.

---

## 6. Recommendation (≤ 1 page) — *our reading; evidence above*

**Closing the timing gap takes an acoustic rule, and a text backstop makes that rule's errors cheap.
Nothing latency-informed is needed, because the platform does not have the number.**

**① The tail hold (release on quiet): the mechanism that closes the measured failure.**
- On `playbackDrained` (only when the reply was held, i.e. `mic_hold: on`), keep `earHeld` true:
  `tailHeld`, per ruling F4.
- Per 40 ms frame, count it as quiet when `rms_dBFS < noise.floor + tail_margin_db`. **Use the noise
  tracker, not `effectiveFloor`.** The Sensitivity pin can sit at −20 dBFS, inside the echo band (§4.3).
  If noise is unsettled, fall back to `floor_dbfs + tail_margin_db`.
- Release on **`tail_quiet_ms` of contiguous quiet**, or at **`tail_max_ms`** after drain, whichever
  comes first. Cancel the tail on mute, kill, barge, route change, leg death or a new reply start.
- Knobs (`LiveCfg`, with provenance):
  - `tail_quiet_ms = 700`: it bridges 97 % of in-reply pauses (§4.2), sits well under the owner's
    measured ≥ 1.8 s response gap (§1.6), and equals the ear's own `silence_ms`.
  - `tail_margin_db = 10`: reuse `noise_margin_db`. The echo is 20–30 dB over noise.
  - `tail_max_ms = 5000`: the worst measured end, 3.46 s, plus 0.7 s quiet plus ~0.8 s headroom.
- **Route behaviour** (why it does not break the other routes): it self-scales. Headphones: the mic
  hears nothing, so the hold releases at drain + 0.7 s. Loudspeaker: the room reverb decays, so drain
  + ~0.8–1.2 s [U]. `call` route (AEC + HFP/SCO): the residual echo is small and releases quickly [U].
  Car A2DP: drain + ≈ 3.2–4.2 s. `mic_hold: off` has no tail.

**② The text echo backstop, at final acceptance: the belt.**
- Reference: the **spoken** text of the last reply (the chunk texts actually synthesised).
- Normalise: lowercase, strip punctuation (keep apostrophes), collapse whitespace.
- Score: Hermes' `is_tts_echo`. Take the whole-string ratio; else the best transcript-length window,
  stepped per word in JS for cost. **Skip transcripts under 10 characters.**
- **Threshold 0.75.** That is the midpoint of the measured gap (genuine ≤ 0.538, echo ≥ 0.946). Hermes
  ships 0.6, Mio 0.72, the meeting dedup 0.82.
- Armed from drain until **release + 4 s**. After release an echo final still arrives within ~0.4 s
  of its stop, and the stop comes 0.7 s after the audible end.
- Drop with a trail reason `echo {score}` and a **visible** heard-line note. Hermes prints "Ignored
  likely TTS echo".
- It is **independent of the energy ledger**. It would have caught the two echoes that came through
  the fail-open door (EVIDENCE Fact 3), and it covers the ~3 % mid-tail releases and anything past
  the cap.

**③ Measure in the D77 trail (to confirm, and to decide whether ① ever needs a learned latency).**
- Per reply:
  - `drainT`.
  - `echoEndT`: the last frame over the quiet line before release.
  - `releaseT`, with reason `quiet | cap | cancel`.
  - The number of quiet-run resets.
  - The tail's peak dBFS.
  - **`onsetLagMs`**: `playbackStarted` → the first held frame over the quiet line. This is the
    40 ms-resolution latency the 1 Hz samples could not give.
- Per final: `echoScore`, `echoArmed`, and whether its segment began during the tail.
- Per capture: `AudioContext.outputLatency` / `baseLatency` of the existing capture context, as a
  diagnostic only. Expect ≈ 0.28 s on this car if §1.4 holds.
- Per turn: the owner's gap from release to the next speechStart.

**④ Explicitly NOT to build.**
- **`outputLatency`-driven timing.** Android drops sink reports of 1 s or more and substitutes ≈ 0.28 s;
  `ended` already includes what is reported (§1.3–1.4).
- **The `auto` leak probe.** It judges the first 600 ms, before this sink emits anything (ruled F3).
- **Comfort-noise substitution.** It gives Silero nothing (§5.2).
- **"Real audio + drop finals".** It merges echo with the owner (§5.3).
- **Per-call latency learning.** Revisit only if the trail shows cap releases or the owner is clipped.
- **Echo-prefix stripping on merged finals.** Unobserved, and nobody ships it.
- **A slider or level fix.** The echo is as loud as the owner.

**Trade-offs, stated plainly.**
- **Deaf time:** ≈ 0.7 s after every reply on headphones, where there was none before; ≈ 3.2–4.2 s
  after each reply in this car.
- **Owner clipping:** if the owner starts talking within 700 ms of *hearing* the end, the hold stays
  closed through their words until a 700 ms pause or the cap. **Their opening is lost.** It never
  happened on this call (min gap ≥ 1.8 s), and the trail will count it.
- **Parrot:** a genuine repeat of ≥ 10 characters at ≥ 0.75 similarity inside the window is dropped,
  visibly, so the owner can say it again.
- **Cap:** under a tail louder than noise + 10 dB for > 5 s, the ear reopens on the cap and the text
  layer is the only guard.

---

## 7. What I could not determine

1. **This car's true latency and whether it sends an AVDTP delay report.** The trail gives
   drain-relative numbers only. Android's reported part (≈ 0.28 s fallback, or a report under 1 s) is
   inferred from AOSP, not measured on the Honor 20. `adb shell dumpsys media.audio_flinger`
   (the output's latency) plus `dumpsys bluetooth_manager` (the delay report) on the phone in the car
   would settle it. **[U]**
2. **The Honor 20's A2DP HAL** (AOSP legacy, BT audio HAL v2 or a Kirin offload HAL). Both AOSP
   variants share the ≥ 1000 ms discard. A vendor HAL could differ. **[U]**
3. **Head-unit adoption of AVDTP 1.3 delay reporting.** No statistic found. **[U]**
4. **Onset lag at fine resolution.** The trail's 1 Hz single-frame `level` cannot time it. The
   §6 ③ `onsetLagMs` field would. **[U]**
5. **The owner's response-gap distribution beyond this call** (n = 8, all ≥ 1.8 s after the audible
   end) and on other routes. Human-human ~200 ms is [R]; a person-to-agent figure was not found.
   **[U]**
6. **PocketTTS pauses for the prod Lynette voice and other personas.** I measured `nova` without
   ctrl-b's trim. Ellipsis-heavy personas drive the p90. **[U]**
7. **Real car-noise behaviour of Silero at the release step.** The noise was synthetic; no car
   recording exists. **[U]**
8. **Double-talk / NLP hangover figures (G.168, hearing aids).** Not bought: no primary source was
   read. They matter less once it is clear the echo is speech with its own pauses (§4.1). **[U]**
9. **Closed products** (ChatGPT voice, Gemini Live, Alexa, Assistant): their post-TTS policy is not
   public. The one help-centre line is [R]; the rest is [U].
10. **Loudspeaker-at-home tail length** (reported residual + room decay) under the new rule.
    Estimated at 0.8–1.2 s, not measured. **[U]**

---

## Primary sources

- Chromium (main, 2026-09-27): `third_party/blink/renderer/modules/webaudio/audio_context.cc` ·
  `third_party/blink/renderer/platform/audio/audio_destination.cc` · `media/audio/android/aaudio_stream_wrapper.cc`,
  `aaudio_output.cc`, `audio_manager_android.cc`, `opensles_output.cc`, `aaudio_bluetooth_output.h` ·
  `media/audio/audio_features.cc` · `media/base/media_switches.cc` · `media/renderers/audio_renderer_impl.cc` ·
  `media/filters/audio_clock.h`
- AOSP: `system/bt/audio_a2dp_hw/src/audio_a2dp_hw.cc`, `audio_a2dp_hw_utils.cc`, `include/audio_a2dp_hw.h`,
  `system/bt/audio_bluetooth_hw/stream_apis.cc` (android10-release) · `packages/modules/Bluetooth/system/audio_bluetooth_hw/stream_apis.cc` (main) ·
  `frameworks/av/media/libaaudio/src/legacy/AudioStreamTrack.cpp` (android10-release)
- W3C Web Audio API ED (outputLatency, baseLatency) · MDN BCD `api/AudioContext.json`
- WebRTC: `common_audio/vad/vad_core.c` · `api/audio/echo_canceller3_config.h` · `modules/audio_processing/aec3/aec3_common.h`
- silero-vad `src/silero_vad/utils_vad.py` · speaches `fdc6a27` `realtime/input_audio_buffer_event_router.py`,
  `realtime/input_audio_buffer.py`, `executors/silero_vad_v5.py`
- livekit/agents `57b3227`: `voice/agent_session.py`, `voice/agent_activity.py`, `voice/turn.py`,
  `voice/audio_recognition.py`, `voice/room_io/_output.py`, `utils/audio.py`
- pipecat `2967e1c`: `turns/user_mute/*`, `transports/base_output.py`, `services/stt_service.py`,
  `processors/aggregators/llm_response_universal.py`
- vocode-core `e054c33`: `streaming/transcriber/base_transcriber.py`, `streaming/streaming_conversation.py`,
  `streaming/models/transcriber.py`, `streaming/output_device/rate_limit_interruptions_output_device.py`
- ovos-dinkum-listener `45dbf72`: `service.py`, `voice_loop/voice_loop.py` · wyoming-satellite `7a3ba2b`: `settings.py`, `satellite.py`
- hermes-agent `cc23b725a3`: `tools/voice_mode_transcript.py`, `tools/voice_mode.py`, `hermes_cli/cli_voice_mixin.py`,
  `cli.py`, `plugins/platforms/discord/adapter.py`, `gateway/run_voice.py`
- `@elevenlabs/client` `eaab81f` · retell-client-js-sdk `d6e8aff`
- Mio `ochiru520/Mio` `私人AI日记系统/backend/app/routes/companion.py` · `tfp24601/live-meeting-assistant` `backend/app/{config,meeting}.py` (GitHub API, 2026-09-27)
- Latency reports: https://stephencoyle.net/airpods-pro · https://stephencoyle.net/airpods-pro-2 ·
  https://www.resetera.com/threads/does-your-car%E2%80%99s-bluetooth-have-a-1-2-second-audio-delay.49932/ ·
  https://www.driveaccord.net/threads/bluetooth-audio-streaming-a2dp-delay-lag.282537/ ·
  https://9thgencivic.com/forum/audio-video-navigation/2936-bluetooth-a2dp-lag-delay.html ·
  https://forums.mbclub.co.uk/threads/bluetooth-audio-lag-delay-in-my-2019-glc.281933/ ·
  https://www.soundguys.com/understanding-bluetooth-codecs-15352/ · https://news.ycombinator.com/item?id=38401452 ·
  https://github.com/bluez/bluez/issues/1541
- Vapi: https://docs.vapi.ai/customization/speech-configuration · OpenAI: https://help.openai.com/en/articles/8400625-voice-mode-faq
- AMR DTX hangover: US patent 11475903 ("Methods and apparatuses for DTX hangover in audio coding") citing 3GPP TS 26.092/26.192
- Stivers et al., "Universals and cultural variation in turn-taking in conversation", PNAS 106(26), 2009 (not re-read; [R])
