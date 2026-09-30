# R96 — Capturing at 16 kHz on the phone (K6): is it standard, is it worth it, and what does it risk?

**Date:** 2026-09-30 · **Author:** research lane R96 (Opus 5.5), session 53 · **Status:** evidence dossier. Nothing is built.
**Question (owner, 2026-09-30):** "Double check that [16 kHz capture] is actually worth doing and that other projects actually
do that too … that this is actually standard, or rather a good change, and we are not overcomplicating things."
**Builds on:** [R94](./R94-asr-audits-verification.md) §2 (the pipeline) and §7.1.6 (K6); [R95](./R95-vad-placement.md) §5 (the
battery model); [R94-evidence/L1](./R94-evidence/L1-relay-transport.md) D4 (bitrate). **Drives:** the HANDOFF agenda B.8 ruling
(K6: promote into session A or not).
**Index row owed:** this lane may create only this file. The main seat adds the `README.md` index row.

**Confidence vocabulary** (R95's): **VERIFIED** = source read in a clone or on googlesource today. **MEASURED** = run on emma
today (§8). **REPORTED** = official docs or a secondary source, not source-verified. **REASONED** = derived from verified facts
plus a stated assumption. **ESTIMATE** = a number with no measurement behind it. **UNMEASURED** = nobody has the number.

---

## 0. The answer in one screen

1. **It is standard for clients like ours.** Browser voice clients that stream **raw PCM over a WebSocket** almost all do what
   K6 proposes. They create `new AudioContext({ sampleRate: <the model's rate> })` and let the browser resample the mic. The
   clients that do it: ElevenLabs Conversational AI (16 kHz), Pipecat's WebSocket transport (16 kHz), Google's Gemini Live
   web console (16 kHz), and OpenAI's WebSocket-era Realtime console (24 kHz, the model's rate). **None of the clients in that
   group sends 48 kHz raw PCM upstream, and ctrl-b does today.** Clients that don't use this pattern use a different transport
   altogether: WebRTC with Opus at 48 kHz (LiveKit, Vapi/Daily, OpenAI's current console), or compressed `MediaRecorder`
   uploads (open-webui, LibreChat, Hume, Deepgram's starter). [VERIFIED, §1]
2. **It is worth it, for two reasons.** One of them was not known before this pass.
   - **Data.** Uplink payload drops 3×, from 768 to 256 kbit/s: a 30-minute call goes from ≈173 MB to ≈58 MB. [arithmetic]
     The battery saving is real in direction but unknown in size. R95's ≈225 mW is an **ESTIMATE** from a 2012 LTE handset
     model.
   - **Quality.** The relay's resampler is linear interpolation with **no anti-alias filter**. At 48 → 16 kHz the ratio is
     exactly 3, so every output sample falls on an input sample and linear interpolation becomes **pure drop-sampling**. A
     9 kHz tone comes out at 7 kHz at full level, and a 20 kHz tone comes out at 4 kHz at full level. [MEASURED, §3]
     R94 §7.1.6 said "never naive drop-sampling", but that is exactly what the planned relay-at-16 kHz design would do with a
     48 kHz uplink. Chrome's own resampler, which a 16 kHz context uses, is a windowed-sinc filter. [VERIFIED, §2.2]
   - So K6 is the **leaner** way to get correctly filtered 16 kHz audio into Silero and Parakeet. Without it, session B would
     have to add an anti-alias FIR to the relay in pure Python, because `app/core` has no numpy.
3. **It is not overcomplicating.** Every downstream piece already reads `ctx.sampleRate`: the worklet frame size, the
   `start.sample_rate` declaration, the socket ceiling, the chirp matcher, and the relay's resampler construction. The change
   is one constructor argument at each of the two context sites, a capability fallback for old Firefox, and comment/test
   updates. [VERIFIED, §5]
4. **Ranked risks** are in §6. At the top: (1) Firefox/Fennec before 148 **throws** at `createMediaStreamSource` when the rates
   differ, so a fallback to a native-rate context is mandatory. (2) The behaviour on the owner's Honor 20 has not been
   observed; no Chrome-Android bug was found, but absence of evidence is not proof. (3) Small, bounded shifts in levels and
   latency that need the phone field check R94 already asked for.
5. **When:** in **session A**, as part of its phone round. K6 is a transport item: it cuts exactly the 4G exposure that session
   A hardens against. Through the interim Speaches hop (16 → 24 → 16 kHz, linear) quality is a **measured wash** against today.
   It becomes a clean win in session B, when the relay's resampler becomes an identity.

---

## 1. What peers do: capture rate and send rate

Clones and fetches were made 2026-09-30 into `~/.cache/tmp/r96/`. The date after each project is its latest commit.

| Project (commit, date) | Transport | Capture | Sends | How it gets the rate | Evidence |
|---|---|---|---|---|---|
| **ElevenLabs `@elevenlabs/client` 1.26.0** (`050aeea`, 2026-09-29), Conversational AI | WS raw PCM (also a WebRTC mode) | context **at 16 kHz** | `pcm_16000` (default input format) | `new window.AudioContext(supportsSampleRateConstraint ? { sampleRate } : {})`. When unsupported, it loads a **libsamplerate WASM worklet** | `platform/web/input.ts:74-82`; `utils/WebSocketConnection.ts:219` `parseFormat(user_input_audio_format ?? "pcm_16000")`; `platform/web/addLibsamplerateModule.ts:2`. WebRTC mode: `utils/WebRTCConnection.ts:307` `pcm_48000` |
| ElevenLabs, Scribe microphone (same repo) | WS raw PCM | context at the **stream's native rate** | 16 kHz | linear-interpolation resampling in the worklet, only when the context rate is not 16 kHz. Source comment: *"Firefox requires the AudioContext to match the microphone's native sample rate."* | `platform/web/scribeMicrophone.ts:9,54-75`; `scribeAudioProcessor.generated.ts:38-58` |
| **Pipecat** `websocket-transport` 1.7.2 (`0b77e6f`, 2026-09-29) | WS raw PCM | context **at 16 kHz** (not Firefox) | 16 kHz | `new AudioContext({ sampleRate: this.sampleRate })`. On Firefox it uses a native context plus JS linear interpolation (a UA sniff that cites Mozilla bug 1674892) | `transports/websocket-transport/src/webSocketTransport.ts:39` `RECORDER_SAMPLE_RATE = 16_000`; `lib/src/wavtools/lib/wav_recorder.js:378`; `lib/src/wavtools/lib/mediastream_recorder.js:174-190` and `:16-40` |
| **Google Gemini Live API web console** (`0a4542f`, 2025-10-14) | WS raw PCM | context **at 16 kHz** | 16 kHz | `constructor(public sampleRate = 16000)` → `audioContext({ sampleRate: this.sampleRate })` | `src/lib/audio-recorder.ts:44,55`. The API docs: *"Input audio is natively 16kHz, but the Live API will resample if needed so any sample rate can be sent."* (ai.google.dev live-guide, fetched 2026-09-30) |
| **OpenAI Realtime console**, `websockets` branch (`6ea4dba`, 2024-10-07) | WS raw PCM | context **at 24 kHz** (the model's rate) | 24 kHz | `new WavRecorder({ sampleRate: 24000 })` → `new AudioContext({ sampleRate: this.sampleRate })` | `src/pages/ConsolePage.tsx:78`; `src/lib/wavtools/lib/wav_recorder.js:324` |
| OpenAI Realtime console, `main` (`ab8b8f5`, 2025-08-28) | **WebRTC** | native | Opus (codec-negotiated, 48 kHz clock) | `getUserMedia({audio:true})` → `pc.addTrack` | `client/components/App.jsx:21-32` |
| **LiveKit** client-sdk-js 2.22.3 (`5cadc93`, 2026-09-24) | WebRTC | native | Opus. Presets `speech` 24 kbit/s, `music` 48 kbit/s | the server side (agents) resamples for STT. That server side is **UNVERIFIED** in this pass | `src/room/track/options.ts:484-492` |
| **Vapi** web SDK 2.7.1 (`7338828`, 2026-09-18) | WebRTC (Daily) | native | Opus | Daily call object | `vapi.ts:3` `import DailyIframe` |
| Pipecat Daily / SmallWebRTC transports | WebRTC | native | Opus | — | `transports/daily/src/transport.ts:127` (16 kHz only for the local recorder tap) |
| **Hume** TS SDK 0.16.1 (`27e5411`, 2026-08-18) | WS, compressed chunks | native | `MediaRecorder` (webm/mp4/wav) | server decodes | `src/wrapper/getAudioStream.ts:15-18`; `getBrowserSupportedMimeType.ts:5-7`. The streaming loop is in `@humeai/voice-react`, **not cloned** (REPORTED) |
| **Deepgram** Voice Agent demo (`8125114`, 2025-07-09) | WS raw PCM | native context, `ScriptProcessor` | 16 kHz linear16 | **box-average decimation in JS with 48000 hardcoded**, which is wrong on a 44.1 kHz device | `app/context/MicrophoneContextProvider.js:25-38`; `app/utils/deepgramUtils.ts:12` `downsample(inputData, 48000, 16000)`; `app/utils/audioUtils.js:38-60` |
| Deepgram live-transcription starter (`2c4a361`, 2026-04-08) | WS, compressed | native | `MediaRecorder` webm/opus | server decodes | `app/context/MicrophoneContextProvider.tsx:66` |
| **open-webui** (`8bd8b4f`, 2026-09-21) call mode and dictation | HTTP upload | native | `MediaRecorder` clip | server (ffmpeg) | `CallOverlay.svelte:236-249`; `VoiceRecording.svelte:249` |
| **LibreChat** (`14f7b28`, 2026-09-29) | HTTP upload | native | `MediaRecorder` clip | server | `client/src/hooks/Input/useSpeechToTextExternal.ts:178` |
| **WhisperLive** browser extension (`99cbc1c`, 2026-09-10) | WS raw PCM | native context | 16 kHz float32 | **naive drop-sampling in the worklet** (`result[i] = inputBuffer[Math.floor(i * ratio)]`) | `Audio-Transcription-Chrome/options.js:56`; `audiopreprocessor.js:5,63-71` |
| **Speaches** realtime server (`993994f`, 2026-04-17) | WS (OpenAI protocol) | — | expects **24 kHz**, resamples to 16 kHz with `np.interp` | server-side, linear, no anti-alias | `realtime/input_audio_buffer_event_router.py:109-111`; `audio.py:17-22` |

**Reading the table.**
- The **raw-PCM-over-WS class, ctrl-b's own class, converges on "ask the AudioContext for the model's rate".** Four of four
  maintained clients in that class do it, and the only variation is the Firefox fallback. [VERIFIED]
- The two in-worklet decimators that do *not* use this pattern (WhisperLive, Deepgram's demo) both alias: one drop-samples, the
  other box-averages with a hardcoded source rate. They are the counter-examples.
- The field's real bandwidth lever is a **codec**: WebRTC Opus at 24–48 kbit/s is 5–10× below even 16 kHz PCM at 256 kbit/s.
  That is a much larger change (an Opus encoder on the phone through WebCodecs, and a decoder on the relay) and is **not**
  recommended here. It is recorded so nobody mistakes K6 for the end of the road.
- Google's WebRTC and Mozilla's guidance both reduce to "WebRTC sends Opus on a 48 kHz clock". Neither covers raw PCM, so
  neither speaks to K6.

## 2. Platform facts

### 2.1 Does the spec require a 16 kHz context to resample the mic? Yes.
- Web Audio API editor's draft (webaudio.github.io/web-audio-api, fetched 2026-09-30), `MediaStreamAudioSourceNode`: *"If the
  sample rate of the MediaStreamTrack differs from the sample rate of the associated AudioContext, then the output of the
  MediaStreamTrack is resampled to match the context's sample rate."* [VERIFIED]
- Same draft, the `AudioContext` constructor: *"If contextOptions.sampleRate differs from the sample rate of the output
  device, the user agent MUST resample the audio output … Note: If resampling is required, the latency of context may be
  affected, possibly by a large amount."* [VERIFIED] This applies to the context's **output** (the chirp, the drop cue, the
  keepalive); see §6 risk 2.
- The spec text came from WebAudio issue #2322 (opened 2021-04-27, closed). It recorded that Chromium resamples and that
  Firefox threw, and resolved "UA MUST resample (same as Chromium does)". [REPORTED via the issue page]

### 2.2 Chrome (all platforms, Android included)
- **The `sampleRate` option** has been supported since Chrome 74 (caniuse / MDN BCD). [REPORTED]
- **The resampling path**, read on chromium `main` @ `b7f135bdf3`, 2026-09-30:
  1. `MediaStreamAudioSourceNode::Create` asks the track for a provider at `context.sampleRate()`.
  2. `modules/mediastream/webaudio_media_stream_audio_sink.cc:60-88` builds a `media::AudioConverter(source_params_,
     sink_params_)`, which *"resamples from source_params_.sample_rate() to sink_params_.sample_rate()"*.
  3. `media/base/audio_converter.cc:60,73` creates a `MultiChannelResampler` when the rates differ. That class is Chrome's
     `SincResampler` (`media/base/sinc_resampler.h:28-29`: kernel 32–64 taps).
  - So the browser applies a **proper windowed-sinc low-pass** before decimating. [VERIFIED]
- **The capture processing chain (AEC/NS/AGC) runs before the context and does not depend on its rate.**
  - `media/webrtc/audio_processor.cc` `GetDefaultOutputFormat`: *"If WebRTC audio processing is used, the default output
    format is fixed to the native WebRTC processing format"*.
  - `media/webrtc/constants.cc`: `WebRtcAudioProcessingSampleRateHz() { return webrtc::AudioProcessing::kSampleRate48kHz; }`.
    Only Cast builds take the `min`.
  - ctrl-b always asks `noiseSuppression: true` (`pcmCapture.ts` `micConstraints`), so processing is on and the **track is
    48 kHz on Chrome regardless of the context**.
  - The processed track is shared by every consumer (`MediaRecorder`, WebAudio), so one consumer's context rate cannot reach
    back into AEC/NS. [VERIFIED in source; REASONED for "cannot reach back"]
- **A side finding:** the track is fixed at 48 kHz, but today's default context runs at the **output device's** preferred rate
  (MDN: "the new context's output device's preferred sample rate is used by default"). Whenever the device prefers 44.1 kHz,
  Chrome **already** runs this same resampler today. K6 does not introduce a new code path; it changes the ratio. [REASONED]
- **Output latency.** `third_party/blink/.../audio_destination.cc:566-590` resamples the context's output with a
  `SincResampler` (behind `kWebAudioRemoveAudioDestinationResampler`, which moves it elsewhere when enabled).
  `renderer_webaudiodevice_impl.cc` `GetOutputBufferSize` scales buffer sizes to the context rate, so the callback interval
  is kept. [VERIFIED] The added delay is ≈ the resampler's request floor (48 frames, rounded up to one 128-frame quantum =
  8 ms at 16 kHz) plus the kernel's group delay (~1 ms). **ESTIMATE: under 10 ms**, not "a large amount".
- **Known Chrome-Android bugs specific to a 16 kHz context: none found.**
  - Searched on 2026-09-30 across the Chromium tracker, GitHub issues and the web.
  - The one live Android WebAudio issue found (ElevenLabs #1021, 2026-09-16, "AnalyserNode on published WebRTC mic track
    reads flat on Chrome Android") is about WebRTC-published tracks, **not** the context rate.
  - A secondary article (zylos.ai, 2026-07-21) claims some devices "stick to the system default" rate. It gives no citation
    and is **UNVERIFIED**.
  - ctrl-b is safe against that claim by construction: it declares `ctx.sampleRate` (the rate it actually got) to the relay
    and never assumes the requested one.
- **Scale of use (REASONED):** ElevenLabs' default Conversational AI path is a 16 kHz context on every non-Firefox browser,
  Chrome Android included, and it ships in a widely used SDK.

### 2.3 Firefox and Fennec
- **Before Firefox 148, `createMediaStreamSource` THROWS** `NotSupportedError: "Connecting AudioNodes from AudioContexts with
  different sample-rate is currently not supported."`
- This was fixed in Mozilla **bug 1674892**, "Enable connecting getUserMedia and MediaStreamAudioSourceNode running at
  different rates": RESOLVED FIXED, target milestone **148 Branch**, resolved 2025-12-21, with a WPT added (Bugzilla REST,
  fetched 2026-09-30). Firefox 148 shipped **2026-02-24** (MDN release notes). [VERIFIED]
- Pipecat's and ElevenLabs' Firefox branches exist because of this bug, and Pipecat's comment cites it.
- **The owner's Fennec version is unknown.** Current Fennec tracks Firefox release, so it is probably past 148 (**ESTIMATE**).
  The fallback is still mandatory.

### 2.4 `MediaRecorder` (the dictation clip)
- `useDictation.ts:1402` records the **stream** (`new MediaRecorder(stream, …)`), not the context. The clip's encoder and rate
  are untouched by K6, so the whole-clip fallback keeps its current quality. [VERIFIED in code]

## 3. Quality: browser resampling vs the relay's

- **The relay's resampler** (`backend/app/core/audio.py:82`, `Pcm16Resampler`) is streaming **linear interpolation**, "the same
  interpolation math as `speaches.audio.resample_audio_data` (`np.interp`)", with no low-pass. Speaches' own 24 → 16 kHz step
  is also `np.interp` (`speaches/audio.py:17-22`).
- **MEASURED (§8):** tones at −6 dBFS through each path. The output level is at the alias frequency.

| Input tone | A) relay 48k → 16k (the planned design without K6) | B) reference anti-aliased FIR (`resample_poly` 1:3) | C) today: relay 48k → 24k, then Speaches 24k → 16k |
|---|---|---|---|
| 1 / 3 / 6 kHz (in band) | −6.0 dBFS (clean) | −6.0 | — |
| 9 kHz → 7 kHz alias | **−6.0** (no attenuation) | −36.6 | −11.3 |
| 12 kHz → 4 kHz alias | **−6.0** | −74.7 | (cancels at this exact ratio) |
| 14 kHz → 2 kHz alias | **−6.0** | −79.1 | 6 kHz component at −12.1 |
| 20 kHz → 4 kHz alias | **−6.0** | −80.8 | −7.1 |

- **The reason:** at an integer ratio of 3, every output position `i × 3` is an integer, so the interpolation weight is always 0
  and the resampler **is** drop-sampling. Everything from 8 to 24 kHz folds into 0–8 kHz at full level.
- **What that costs ASR (REASONED, UNMEASURED on WER).**
  - Above 8 kHz, speech carries mostly fricative energy (/s/, /ʃ/). Road and wind hiss is broadband.
  - `noiseSuppression` attenuates the stationary part, but whatever is left folds into the band the VAD and ASR read.
  - For clean speech the effect is probably small. For the owner's car calls it adds in-band noise for no reason.
- **Both 16 kHz models expect properly band-limited 16 kHz input:** Parakeet TDT 0.6B v3 takes "16kHz Audio", "Monochannel"
  (HF model card), and Silero VAD supports "8000 Hz and 16000 Hz" (README). Both fetched 2026-09-30. [REPORTED]
- **K6 during the Speaches interim** (phone 16k → relay linear to 24k → Speaches linear to 16k), MEASURED:
  - The passband rolls off a little more than today: 5 kHz −4.1 dB vs −1.8 dB; 7 kHz −8.6 dB vs −3.6 dB.
  - The out-of-band aliasing is gone, because the browser filtered it.
  - Net: a **wash** vs today. After session B the relay's resampler is an identity, and the path is Chrome's sinc and
    nothing else.

## 4. The connect chirp

`chirp.ts` already correlates at `CHIRP_MATCH_RATE = 16000`. At a 48 kHz capture it box-averages by `factor = 3`, and at
44.1 kHz by 3, giving 14.7 kHz.
- **At a 16 kHz context, `factor = 1`.** The template is generated at 16 kHz (`chirpTemplate(sampleRate)`) and no decimation
  runs.
- The 1 → 3 kHz sweep sits well under the 8 kHz Nyquist, and lag resolution is unchanged (62.5 µs per sample).
- **SNR should be equal or slightly better.** Today's box filter has its first null at 16 kHz and passes much of 8–16 kHz,
  which it then aliases into the matcher's band. The browser's sinc filter removes that band first. [REASONED from §2.2 and
  the box-filter response]
- The chirp is also **played** from the 16 kHz context and upsampled by Chrome to the device rate. The 3 kHz top is well
  inside the band, and the 440 Hz drop cue (`callCue.ts:17`) is unaffected.
- **One real, bounded caveat.** The chirp measures the **capture context's** output path, but TTS plays through an
  `HTMLAudioElement` (`audioController.ts:607`). The chirp is already a proxy for the TTS lag today.
  - A 16 kHz context adds its output-resampler delay to the chirp only: an **ESTIMATE of under 10 ms** (§2.2).
  - That makes the tail hold ≈ 10 ms longer, which is the safe direction and small against a ≈ 2.3 s car lag and
    `tail_lag_margin_ms`.
  - The field check reads it off the existing `outputLatency`/`baseLatency` debug readout (`useLiveCall.ts:2876-2877`).
- **Needed:** only the `CHIRP_MATCH_RATE` doc comment ("the capture runs at the DEVICE rate") becomes stale and needs an edit.

## 5. The alternative: decimate in the worklet vs ask the context

| | Ask the context (`{ sampleRate: 16000 }`) | Decimate in `pcmWorklet.ts` |
|---|---|---|
| Who does it among peers | ElevenLabs (primary), Pipecat (non-Firefox), Google Live console, OpenAI WS console | the **Firefox fallbacks** (ElevenLabs Scribe and Pipecat: linear; ElevenLabs Conversational AI: libsamplerate WASM); WhisperLive and Deepgram's demo, **both aliasing** |
| Filter quality | Chrome `SincResampler`, 32–64 taps [VERIFIED] | only as good as the FIR we write and test. The peers who wrote one mostly got it wrong |
| ctrl-b code | the constructor at `pcmCapture.ts:604` and at `useDictation.ts:1195`, plus a fallback. Everything downstream already keys on `ctx.sampleRate`: `pcmCapture.ts:456` frame size, `liveSocket.ts:152,178`, `useLiveCall.ts:2430,2602`, `useDictation.ts:947`. The relay accepts 8–96 kHz (`voice_live.py:107-108`) and builds its resampler from the declared rate (`:476`) | a polyphase FIR plus state in the worklet string. It splits "context rate" from "frame rate" in every consumer: the chirp matcher's `t` clock is in context samples, the `rec.rate` trail and the `start.sample_rate` declaration would both need the second rate. It also needs new unit vectors |
| Audio-thread cost | the resampler runs in Chrome's C++; the worklet then gets 125 quanta/s instead of 375 | an FIR in JS on the audio thread, on every quantum |

**Verdict: ask the context.** It is less code, the filter is better, and it is what the peer class does. Keep a worklet
decimator out of scope. If a fallback is ever needed on a browser that ignores the option, the fallback is today's
native-rate path, not a new decimator.

## 6. Risks, ranked

1. **Firefox/Fennec before 148 fails at `createMediaStreamSource`** (§2.3). Unmitigated, it would kill the call or the
   streaming-dictation leg at start. **Mitigation:** capability-checked, never UA-sniffed (the house rule).
   - Build the 16 kHz context, try the source node, and on `NotSupportedError` close it and rebuild at the native rate.
     The relay resamples as today.
   - For dictation the rebuild happens after an `await`. Sticky user activation from the tap should let `resume()`
     succeed. **UNVERIFIED on Fennec.**
   - Likelihood: **low**; severity if unmitigated: **high**.
2. **Unobserved on the Honor 20** (§2.2). No bug found, but no device evidence either.
   **Mitigation:** the field check R94 already required, done in session A's phone round:
   - the trail's `rec.rate` / `start.sample_rate` reads 16000;
   - one call and one 5–10 minute dictation transcribe normally;
   - the chirp's lag and peak stay comparable, and `outputLatency`/`baseLatency` move by at most about 10 ms;
   - EC-`call` and EC-`media` routes both behave as before.
3. **Level-gate drift.** Frame RMS loses the energy above 8 kHz.
   - For speech the loss is small, because speech energy sits well below 4 kHz: **ESTIMATE under ~0.5 dB**.
   - Broadband noise floors drop a bit more. The D76 gates are relative dB against a learned floor (the absolute
     `barge_threshold` was dropped in migration step 4, `config_migration/steps.py:818`), so they self-adjust.
   - The per-device remembered voice level may read slightly low for one call.
   - Low.
4. **The dictation meter/detector window changes.** `useDictation.ts:1248` reads `analyser.fftSize` (default 2048) samples per
   100 ms poll: 43 ms at 48 kHz, **128 ms at 16 kHz**.
   - The meter gets smoother, and the silence clock is unchanged because it counts polls.
   - Optional: set `fftSize = 1024` (64 ms) to stay close to today.
   - Low.
5. **Output-path latency added to the chirp only** (§4). Under 10 ms (ESTIMATE), in the safe direction. Low.
6. **The fallback path keeps the aliasing resampler** (§3). This only matters for the old-Firefox fallback once K6 lands.
   **If K6 is NOT done, it becomes risk ① of session B for everyone:** the relay would then need a real anti-alias FIR.
   Low with K6; medium-high without.
7. **Interim quality through Speaches** is a measured wash (§3). Low.

## 7. Verdict for the owner (plain words)

- **Standard?** Yes. Apps that stream raw audio from a browser, as ctrl-b does, ask the browser for 16 kHz (or the model's
  rate) up front. ElevenLabs, Pipecat and Google's own Live console all do it. Sending 48 kHz raw audio, as ctrl-b does now,
  is the unusual choice.
- **Worth it?** Yes.
  - It cuts the phone's upload to a third (a 30-minute car call goes from about 173 MB to about 58 MB of audio). That lowers
    the chance of 4G stalls.
  - It gets the speech models properly filtered audio for free.
  - The measurement here shows that the server-side alternative, as currently written, simply throws away two of every three
    samples and lets high-frequency noise fold into the speech band.
  - The battery gain is real in direction, but its size is an estimate.
- **Overcomplicating?** No. It is one argument in two places, a fallback for old Firefox, and some comment and test edits.
  Everything else already follows the rate.
- **When?** In **session A**, verified in that session's phone round. It is a transport change, like the rest of session A.
  If the phone check fails, the fallback is simply today's behaviour.
- **What not to do:** don't write our own decimator in the worklet. Don't reach for Opus/WebCodecs now; it is the only bigger
  bandwidth lever, and a far bigger change.

## 8. Method (MEASURED rows)

- **Host:** emma. The Python was `~/github/speaches/.venv` (3.12, numpy 2.4.5, scipy 1.17.1) with
  `PYTHONPATH=backend` to import ctrl-b's real `app.core.audio.Pcm16Resampler`. Nothing was written to the repo.
- **Signals:** 1 s tones at −6 dBFS, pcm16.
  - A: fed through `Pcm16Resampler(48000, 16000).feed()`.
  - B: `scipy.signal.resample_poly(x, 1, 3)`.
  - C: `Pcm16Resampler(48000, 24000)` followed by Speaches' exact `np.interp(np.linspace(0, n, n·16/24), …)`.
  - Interim row (§3): `Pcm16Resampler(16000, 24000)` followed by the same `np.interp`.
  - Levels are read off a Hann-windowed rFFT peak (±2 bins).
- **Not measured, and why:**
  - anything on the Honor 20 (no device access from this lane);
  - Chrome's resampler numerically (read in source, not run);
  - ASR WER with and without aliasing;
  - power.
- **Throwaway clones** are in `~/.cache/tmp/r96/` (not the repo). They are safe to delete.

## 9. Corrections and gaps

- **Correction to R94 §7.1.6 / R95 §5.** K6 is not only a data/battery lever. Without it, the planned relay-at-16 kHz design
  drop-samples (§3). R94's "if the context rate misbehaves, decimate in the worklet" is also re-ruled here: fall back to the
  native context instead (§5).
- **Correction to R94 §2 (minor).** With NS on, Chrome's track is fixed at 48 kHz. Today's context runs at the output device's
  preferred rate, so "usually 48 kHz" is right, but for a different reason than the device's capture rate.
- **Gaps:** LiveKit agents' server-side resampler (UNVERIFIED); Hume's React streaming loop (not cloned); Safari/iOS (out of
  the owner's scope; not researched); the owner's Fennec version.

## Sources (all fetched or cloned 2026-09-30)

- **Peer repos** (commit, date): elevenlabs/packages `050aeea` 2026-09-29 · pipecat-ai/pipecat-client-web-transports `0b77e6f`
  2026-09-29 · google-gemini/live-api-web-console `0a4542f` 2025-10-14 · openai/openai-realtime-console `main` `ab8b8f5`
  2025-08-28 and `websockets` `6ea4dba` 2024-10-07 · livekit/client-sdk-js `5cadc93` 2026-09-24 · VapiAI/client-sdk-web
  `7338828` 2026-09-18 · HumeAI/hume-typescript-sdk `27e5411` 2026-08-18 · deepgram-devs/deepgram-voice-agent-demo `8125114`
  2025-07-09 · deepgram-starters/nextjs-live-transcription `2c4a361` 2026-04-08 · open-webui/open-webui `8bd8b4f` 2026-09-21 ·
  danny-avila/LibreChat `14f7b28` 2026-09-29 · collabora/WhisperLive `99cbc1c` 2026-09-10 · speaches-ai/speaches `993994f`
  2026-04-17.
- **Chromium** `main` @ `b7f135bdf3` (2026-09-30), chromium.googlesource.com:
  - `third_party/blink/renderer/modules/webaudio/media_stream_audio_source_node.cc`, `media_stream_audio_source_handler.cc`
  - `third_party/blink/renderer/modules/mediastream/webaudio_media_stream_audio_sink.cc`
  - `media/base/audio_converter.cc`, `media/base/sinc_resampler.h`
  - `media/webrtc/audio_processor.cc`, `media/webrtc/constants.cc`
  - `third_party/blink/renderer/platform/audio/audio_destination.cc`
  - `content/renderer/media/renderer_webaudiodevice_impl.cc`, `media/base/audio_latency.cc`
- **Web Audio API editor's draft:** https://webaudio.github.io/web-audio-api/ (the `MediaStreamAudioSourceNode` and
  `AudioContext` constructor text). Spec issue: https://github.com/WebAudio/web-audio-api/issues/2322 (2021-04-27, closed).
- **MDN:** `AudioContext()` constructor, https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext; Firefox 148
  notes, https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/148 (released 2026-02-24).
- **Mozilla bug 1674892:** https://bugzilla.mozilla.org/show_bug.cgi?id=1674892 (FIXED, 148 Branch, 2025-12-21).
- **caniuse**, `sampleRate` option (Chrome 74+): https://caniuse.com/mdn-api_audiocontext_audiocontext_options_samplerate_parameter
- **Gemini Live API guide:** https://ai.google.dev/gemini-api/docs/live-guide
- **Parakeet TDT 0.6B v3 model card:** https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 · **Silero VAD:**
  https://github.com/snakers4/silero-vad
- **ElevenLabs issue #1021** (2026-09-16): https://github.com/elevenlabs/packages/issues/1021
- **Unverified secondary source:** zylos.ai, "Production Realtime Voice Agents" (2026-07-21),
  https://zylos.ai/zh/research/2026-07-21-realtime-voice-agent-relay-architecture/
- **The battery model** (via R95 §5): Huang et al., MobiSys 2012, https://web.eecs.umich.edu/~zmao/Papers/RRC4G_mobisys2012.pdf
  (2012 handset; use it for ratios only).
