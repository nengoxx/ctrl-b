# R92 — How live-call voice agents survive noise: VAD flapping, hallucinated shorts, and the false-turn problem

Date: 2026-09-27
Status: evidence dossier; not a decision
Scope: live, interactive voice agents (full- or half-duplex); not batch dictation.
Confidence: every claim is marked VERIFIED (primary source read or owner trail/probe), REPORTED (secondary source), or UNVERIFIED (not established).

What drove this pass

VERIFIED — The owner's car call produced 38 Silero segments in 5 minutes, many 30–100 ms; Parakeet returned an empty string 19 times and also returned “Yeah.”, “Mm-hmm.”, “Mm.”, and “Okay.” on noise. ⟦V: the 19 `""` are most likely NOT Parakeet output: the realtime commit goes through Speaches' own `/v1/audio/transcriptions` door, which re-runs Silero over the committed clip (`routers/stt.py:48` `DEFAULT_VAD_OPTIONS` = threshold 0.5, min_silence 160 ms, pad 400 ms) and returns `""` without calling the model when it finds no speech (`executors/parakeet.py:131-139`). Also, a “30–100 ms segment” is the started→stopped EVENT gap; the audio actually transcribed is `audio_start_ms…audio_end_ms` (`input_audio_buffer.py:80-88`), which starts wherever the rescan put the start and can be much longer. See §V.b1.⟧ The relative floor pinned at −20 dBFS while the owner's speech peaks were only −14…−18 dBFS, and leaked A2DP speech occupied the same band. EVIDENCE.md:67–77.

VERIFIED — This is two failures, not one: (1) Silero/Speaches admits very short false segments and Parakeet turns some into text; (2) the client's loudness rule cannot distinguish a loud car-speaker tail from the owner. The earlier tail/epoch audit also found a fail-open path when a transcript arrives without a matching energy epoch. maya-audit.md:17–57, 61–127.

Our pipeline, stated precisely

VERIFIED — Chrome Android microphone → 40 ms PCM WebSocket frames → Speaches realtime. Speaches rescans the last 3 s on every append with Silero VAD v5, threshold 0.6, silence 700 ms, and no usable prefix padding. Parakeet TDT 0.6b transcribes each VAD segment; only whole-utterance finals are available. The client measures dBFS against a relative floor (minimum-tracking noise estimate plus learned voice level −10 dBFS, clamped [−60, −20]) and drops a final with <200 ms above floor. EVIDENCE.md:10–17; R76:91–165.

Reading guide

VERIFIED — A VAD answers “does this frame/region resemble speech?” It does not answer “is this the owner?”, “is this a complete turn?”, or “is this a meaningful ASR result?”. The field separates those jobs into VAD, endpointing/turn detection, preprocessing, interruption policy, and final acceptance. LiveKit’s current turn-detector documentation makes the same distinction explicitly: VAD detects speech presence; the turn detector adds semantic/acoustic end-of-turn signals. https://docs.livekit.io/agents/build/turns/turn-detector

## 1. THE PEERS, AT SOURCE

### Comparison table

| Peer | VAD / endpoint defaults and minimum duration | Loudness AND? / empty and hallucinated text | Text-level turn logic / preprocessing / car evidence |
|---|---|---|---|
| LiveKit Agents, Python | VERIFIED — Silero plugin `activation_threshold=0.5`, `min_speech_duration=0.05 s`, `min_silence_duration=0.55 s`, `prefix_padding_duration=0.5 s`; exit defaults to max(start−0.15, 0.01). `livekit-plugins-silero/.../vad.py:60–138` at https://github.com/livekit/agents/tree/57b3227a7842697e6ad45b1275369cf9700bf161. | VERIFIED — No loudness AND in the Silero plugin. Empty transcript is dropped; carried STT confidence is not thresholded. R76:349–379. | VERIFIED — Audio `TurnDetector` uses acoustic + semantic signals without requiring a transcript. Current endpoint defaults are min 0.5 s / max 3.0 s; with audio turn detector, 0.3 / 2.5 s. VAD silence must be ≥250 ms. Text `MultilingualModel` is still available but deprecated; it uses chat context and language thresholds and has no exposed text-classifier knob. https://docs.livekit.io/agents/build/turns/turn-detector (lines 111–121, 291–389 in fetched source). VERIFIED — interruption defaults in the pinned source include `min_duration=0.5 s`, `min_words=0`, `false_interruption_timeout=2.0 s`, and `backchannel_boundary=(1.0,1.0)`. R76:356–373. VERIFIED — current source includes optional Krisp noise cancellation/BVC before the agent input (`examples/voice_agents/basic_agent.py:130–134`, `examples/voice_agents/warm-transfer/support_agent.py:77–81`). No car-specific policy found. |
| pipecat | VERIFIED — `SileroVADAnalyzer` defaults: `confidence=0.7`, `start_secs=0.2`, `stop_secs=0.2`, `min_volume=0.6`. `VADParams` source: `src/pipecat/audio/vad/vad_analyzer.py:47–60`; docs: https://docs.pipecat.ai/pipecat/learn/speech-input. The 0.2 s start is the minimum sustained speech before VAD confirms a start; 0.2 s stop is silence before stop. | VERIFIED — Yes: `confidence >= 0.7 AND volume >= 0.6`; volume is a rolling 400 ms loudness measure with EMA smoothing, not raw peak. R76:318–329. ⟦V: at the pinned `2967e1c` the volume is ITU-R BS.1770 **K-weighted integrated loudness** over a rolling 400 ms window, normalised −110…−10 LUFS → 0…1 (`audio/utils.py:164-188`, `audio/volume.py:13-19`), EMA factor 0.2 (`vad_analyzer.py:87`). So `min_volume 0.6` is an ABSOLUTE ≈ −50 LUFS gate, far below this car's −42 dBFS noise floor: it would not have gated anything here.⟧ VERIFIED — Whisper service filters metadata (`no_speech_prob <0.4` for faster-whisper, `<0.6` MLX) and drops a known `compression_ratio == 0.5555555555555556` fingerprint; no filler deny-list. R76:344–347. | VERIFIED — Smart Turn is the default stop strategy; it decides whether the user's thought is complete after VAD and transcript flow. Pipecat also exposes minimum-word turn-start strategy and Krisp VIVA IP, whose stated purpose is distinguishing genuine interruptions from “uh-huh”/“yeah”; default IP threshold is 0.5. R76:335–342. VERIFIED — docs recommend upstream audio filters such as Krisp VIVA, ai-coustic, or RNNoise before VAD/STT rather than merely raising confidence/min_volume. Fetched pipecat docs lines 94–101. No car-specific source found. |
| Vapi | VERIFIED — `stopSpeakingPlan.voiceSeconds` defaults to 0.2 s; `numWords` defaults 0; `backoffSeconds` defaults 1 s. Vapi says increasing `voiceSeconds` reduces background-noise false triggers, and `numWords=2–3` avoids interruptions from “okay”/“right”. `waitSeconds` defaults 0.4 s. https://docs.vapi.ai/customization/speech-configuration (fetched source lines 30–35, 86–103). | VERIFIED — The documented speech-duration/word-count controls are interruption controls, not a documented VAD+loudness AND. VERIFIED — no empty/filler transcript deny-list or ASR confidence threshold was found in the public page. | VERIFIED — Smart endpointing can be Vapi, LiveKit, Assembly end-of-turn, Deepgram Flux, or a custom model; custom `timeoutSeconds` is 0–15 s. The LiveKit wait function default is `200 + 8000*x`, i.e. 200–8200 ms. Vapi documents backchannel prediction and says it is handled by the stop-speaking plan. Background sound defaults: “office” for phone, “off” for web. Same page lines 40–115. VERIFIED — current denoising docs describe Krisp Smart Denoising before/around the voice pipeline and experimental Fourier denoising; Fourier has a `staticThreshold=-35 dB` and `baselineOffsetDb=-15 dB`, but is explicitly distortion-prone and requires tuning. https://docs.vapi.ai/documentation/assistants/conversation-behavior/background-speech-denoising (lines 5–49, 66–76). REPORTED — older material and community references call the flag `backgroundDenoisingEnabled`; Vapi’s 2025 changelog says that property was removed from Assistant DTOs. https://docs.vapi.ai/whats-new/2025/7/31. No car-specific public guidance found. |
| Retell | VERIFIED — Public orchestration docs expose “advanced streaming background noise filtering”, echo cancellation, context-aware endpointing and configurable interruption sensitivity, but do not publish an acoustic VAD name, minimum speech duration, or numeric default. https://docs.retellai.com/general/orchestration_overview. VERIFIED — public configuration says response wait can be 0–5.5 s and “Interruption Sensitivity” can be lowered for background speech. https://docs.retellai.com/build/single-multi-prompt/configure-basic-settings. | VERIFIED — No public loudness AND or transcript deny-list/confidence threshold found. | VERIFIED — Retell documents three preprocessing modes: no denoising; “remove noise” (default, not background speech); and “remove noise + background speech”, which uses BVC, can distort caller speech, costs $0.005/min, and should be tested on representative audio. https://docs.retellai.com/build/handle-background-noise. This is pre-ASR, but the public docs do not state whether VAD sees filtered or raw audio. No car-specific source found. |
| ElevenLabs Conversational AI / ElevenAgents | VERIFIED — Public docs say the stack has a proprietary turn-taking model and configurable timeouts/interruptions, but publish no VAD identity, minimum speech duration, loudness threshold, or no-speech confidence. https://elevenlabs.io/docs/eleven-agents/overview. VERIFIED — Conversation flow exposes turn eagerness and interruption enabled/disabled, not numeric acoustic gates. https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow. | VERIFIED — No public filler deny-list, minimum-word rule, ASR confidence threshold, or loudness AND found. | VERIFIED — It is a text/voice turn model rather than documented Silero knobs. REPORTED — independent analysis says custom interruption logic and backchannel policy are not exposed, so conditional “ignore affirmations” logic is usually client-side; this is secondary, not vendor source. https://deepgram.com/learn/elevenlabs-barge-in-interruptions-turn-taking. No car-specific source found. |
| Hermes voice mode | VERIFIED — CLI/TUI capture is energy-only: int16 RMS threshold 200 (≈−44.3 dBFS), 0.3 s above threshold to confirm speech, 0.3 s dip tolerance, and 3.0 s silence endpoint. Its local faster-whisper path has `vad_min_silence_ms=500`. R85:96–120. Discord receiver requires ≥0.5 s audio and 1.5 s RTP silence; Discord client owns VAD/NS/AEC. R85:159–184. | VERIFIED — CLI discards recordings shorter than 0.3 s or whose peak RMS is <200, then applies a Whisper phrase deny-list/repeat regex while exempting configured stop phrases. R85:109–112. VERIFIED — Discord has empty/duplicate guards but no confidence gate. | VERIFIED — barge detector calibrates p90 of 450 ms quiet RMS, multiplies by 3.0, clamps [400,4000] int16, uses 80% of the last 300 ms, and raises minimum to 1500 while TTS plays. It has a text self-echo guard at similarity ≥0.6, skipped for fragments <10 chars. R85:122–145. VERIFIED — no car/Bluetooth-specific guidance; the one relevant report is a MacBook mic around RMS 160 below the absolute 200 threshold. R85:226–247. |
| Open WebUI call mode | VERIFIED — Browser analyser VAD: `minDecibels=-55`, `maxDecibels=-30`; any nonzero bin starts a recording, 2000 ms with no bin ends it. Capture requests browser EC, NS, and AGC true. R85:186–208; R76:393–400. | VERIFIED — no VAD+loudness AND, no sustain/min-speech duration, no confidence, and no phrase list; submit guards are blob ≥100 bytes and non-empty text. | VERIFIED — half-duplex by default: analyser is deaf for the whole assistant generation/playback unless voice interruption is enabled. No car-specific handling. |
| OpenAI Realtime | VERIFIED — `server_vad`: threshold 0.5, prefix padding 300 ms, silence duration 500 ms; higher threshold requires louder activation and may help noisy environments. `semantic_vad` uses `eagerness=low|medium|high|auto` and language/context rather than acoustic thresholds. https://developers.openai.com/api/docs/guides/realtime-vad. | VERIFIED — no documented loudness AND or filler deny-list. VERIFIED — `input_audio_noise_reduction` supports `near_field` and `far_field` and is documented as filtering before VAD and model, reducing false positives. Realtime API reference: https://developers.openai.com/api/reference/ruby/resources/realtime. | VERIFIED — semantic VAD is a text/semantic completion signal, not a noise gate. No car-specific policy. |
| Home Assistant Assist / Wyoming Satellite | VERIFIED — Home Assistant pipeline emits `stt-vad-start` and `stt-vad-end`; the client is encouraged to use local VAD to avoid unnecessary streaming. https://developers.home-assistant.io/docs/voice/pipelines. VERIFIED — Wyoming Satellite uses Silero; source `wyoming_satellite/vad.py:8–32` compares detector probability to `vad_threshold` and requires `trigger_level` consecutive activations, decrementing activation by one on non-speech. CLI source `__main__.py:137–177` defines `--vad`, `--vad-threshold` default 0.5, `--vad-trigger-level` default 1, `--vad-buffer-seconds` default 2, and `--vad-wake-word-timeout` default 5 s. There is no published minimum speech duration or loudness AND. ⟦V: wrong for Home Assistant. The satellite's `--vad` only waits for speech before streaming; HA's own server-side endpointer is `VoiceCommandSegmenter` (`homeassistant/components/assist_pipeline/vad.py:73-101`, core `dev` @ `1e5f618`): `speech_seconds 0.3` (cumulative speech > `before_command_speech_threshold 0.2` before a command starts; reset after `reset_seconds 1.0` of non-speech), `command_seconds 1.0` minimum command, `silence_seconds 0.7` (sensitivity relaxed 1.25 / aggressive 0.25, `:21-30`), `in_command_speech_threshold 0.5`, `timeout_seconds 15`. That IS a published minimum speech duration (0.3 s).⟧ | VERIFIED — no transcript hallucination filter in Wyoming Satellite; VAD is upstream gating. | VERIFIED — mic preprocessing knobs are `--mic-noise-suppression` default 0 and `--mic-auto-gain` default 0; `--mic-seconds-to-mute-after-awake-wav` default 0.5. Source `__main__.py:68–83`. No car-specific source. |
| Vocode | REPORTED — public “Conversation Mechanics” documents Deepgram endpointing defaults `vad_threshold_ms=500`, `utterance_cutoff_ms=1000`, and `use_single_utterance_endpointing_for_first_utterance=False`; it also exposes `conversation_speed`, which scales endpointing waits. https://docs.vocode.dev/open-source/conversation-mechanics. The docs do not identify a VAD model or publish a minimum speech duration. | VERIFIED as a documentation negative — no loudness AND, transcript filler filter, or ASR confidence gate is documented in that page. | REPORTED — endpointing is transcriber-driven and high sensitivity treats any word as interruption; the docs say a fork may be needed for custom behavior. No car-specific policy found. |
| Deepgram Voice Agent / Flux | VERIFIED — Flux integrates transcription with turn events: `StartOfTurn`, `EagerEndOfTurn`, `TurnResumed`, and `EndOfTurn`. Recommended simple path is EndOfTurn only; StartOfTurn interrupts if the agent speaks. https://developers.deepgram.com/docs/flux/agent (fetched lines 42–96). No minimum acoustic speech duration is published in the cited agent docs. | VERIFIED — no loudness AND, filler deny-list, or ASR confidence threshold is exposed as a user knob. | VERIFIED — `EagerEndOfTurn` is moderate-confidence preparation; `TurnResumed` cancels the draft; `EndOfTurn` commits. `eager_eot_threshold` and `eot_threshold` tune the trade-off; docs require measuring Eager→Resumed versus Eager→EndOfTurn. https://developers.deepgram.com/docs/flux/voice-agent-eager-eot (lines 7–78). VERIFIED — Deepgram warns echo/background noise can cause false StartOfTurn and points to preprocessing/barge-in guidance. No car-specific numbers. |
| Gemini Live | VERIFIED — current Live API sample config exposes Automatic Activity Detection with `disabled=false` (default), `start_of_speech_sensitivity=LOW`, `end_of_speech_sensitivity=LOW`, `prefix_padding_ms=20`, and `silence_duration_ms=100`. ⟦V: only `disabled: False` is marked default on the page; LOW/LOW/20/100 are one example's values, not defaults. No Gemini default is published there.⟧ The values are in the current official guide’s Python example: https://ai.google.dev/gemini-api/docs/live-guide (fetched source around the `automatic_activity_detection` example). | VERIFIED — no loudness AND or filler deny-list/confidence threshold documented. | VERIFIED — activity detection is acoustic endpointing; explicit client content can set `turn_complete`. REPORTED — a Google cookbook issue reports observed turn closure around 2000 ms despite a configured 6000 ms silence duration; this is a tracker report, not a product guarantee. https://github.com/google-gemini/cookbook/issues/1263. No car-specific vendor guidance. |

### What the peer survey actually says

VERIFIED — The strongest recurring defenses are: temporal minimums (50–500 ms), a second audio measure (pipecat volume or a second VAD), pre-VAD denoising/AEC, semantic/text-level end-of-turn, and explicit false-interruption recovery. No surveyed peer solves this with a universal “drop Yeah/Mm-hmm” list. LiveKit carries transcript confidence but does not use it as a turn acceptance threshold (R76:375–379); Deepgram uses a lifecycle with a draft/cancel/commit separation instead of pretending a tentative endpoint is final.

VERIFIED — A “minimum speech duration” is not the same as “minimum meaningful user turn”. LiveKit’s 50 ms is a VAD segment floor; its 500 ms interruption floor is a policy floor. Vapi’s 0.2 s is an interruption-start floor. Pipecat’s 0.2 s is VAD start confirmation. Speaches currently has 0 ms effective `min_speech_duration_ms` in realtime. R76:146–153; R84:219–231.

UNVERIFIED — None of Vapi, Retell, ElevenLabs, Gemini, or Deepgram’s public pages establishes that its preprocessing output is exactly the signal seen by its VAD, nor does any public page provide a car-specific false-trigger rate.

## 2. SILERO IN NOISE

### Documented mechanics

VERIFIED — Silero’s repository documents `threshold=0.5`, `min_speech_duration_ms=250`, `min_silence_duration_ms=100`, and `speech_pad_ms=30` for `get_speech_timestamps`. A candidate segment shorter than 250 ms is thrown away; the silence duration is the wait before separating a speech chunk; padding expands the returned chunk. `src/silero_vad/utils_vad.py:283–342` and `:422–476` at https://github.com/snakers4/silero-vad/tree/5cd7945676eb32225748052e2e6a0580e4686a08.

VERIFIED — The exit threshold defaults to `max(threshold−0.15,0.01)`. At threshold 0.6, the exit threshold is 0.45; a frame between 0.45 and 0.6 neither starts a new segment nor clears the silence timer. R84:87–101; repository `utils_vad.py:341–342,475–476,663–671`.

VERIFIED — The model repository does not claim that stationary broadband noise must stay below 0.6. It documents a probability threshold and recommends plotting probabilities and calibrating on labelled domain data; it does not publish a universal noise-only probability bound. Therefore “engine noise cannot cross 0.6” is not a valid design assumption.

VERIFIED — R76’s source-level probes through the same v5 module found broadband noise max probability 0.041 at RMS 0.005, 0.049 at RMS 0.020, 0.028 at RMS 0.050, and 0.212 at RMS 0.150; a 120 Hz hum reached 0.586, below 0.6 but above the default 0.5. R76:229–238. These are synthetic signals, not the owner’s cabin.

VERIFIED — R84’s larger synthetic sweep found v5 noise-only continuous-state max ≤0.11 for white/pink/car noise/clatter/typing/tone, but a 120 Hz hum produced repeated starts at thresholds 0.5–0.8; the zero-state Speaches rescan had first-frame spikes. R84:187–203. Thus the observed car flapping is consistent with the rescanning architecture and transient/structured noise, not evidence that every stationary broadband engine bed scores >0.6.

### v5, v6, and Speaches’ rescan

VERIFIED — Silero v6.0 release notes report 16% fewer errors on noisy real-life data; v6.2 reports improvements for muted voices, muted speech, and lower-quality phone calls. The wiki noise-only accuracy table in R84 reports v5 0.61/0.44 versus v6 0.87/0.71 on ESC-50/private noisy calls. R84:111–118. v5→v6 is a recalibration event, not a drop-in threshold-preserving change.

VERIFIED — In R84’s narrowband synthetic probe, v5 at 0 dB SNR had only 0.51 of frames ≥0.9 and p10 0.406; at 10 dB SNR it had 0.84 ≥0.9. v6.2 improved several quiet/narrowband cases. R84:147–167. These values are frame distributions, not car-room measurements.

VERIFIED — Speaches realtime leaves `min_speech_duration_ms` at 0, uses a 3 s trailing window, and reruns VAD from a zeroed state on every append. A single 32 ms frame can therefore open a segment; the 250 ms Silero default is not active in this path. R76:146–164; R84:129–137.

VERIFIED — In this design, `min_silence_duration_ms=700` controls the end of a segment inside a rescan window; it does not suppress a short start and cannot undo repeated zero-state starts. The 3 s window also means timestamps are poor evidence for actual segment speech length. R76:154–164.

VERIFIED — The cheapest Speaches-side defense is to pass a nonzero `min_speech_duration_ms` into the realtime `VadOptions`, but R76’s probe shows the current 0.9 start already rejects ordinary broadband noise ⟦V: stale. Prod runs 0.6 since D76 (trail `leg_start`: `threshold 0.6`); R84's v5 probes still show broadband/car noise ≤ 0.11 at 0.6⟧; the observed problem is the remaining structured/flapping segments and ASR acceptance. A server minimum should therefore be a second defense, not the whole fix.

## 3. PARAKEET / ASR HALLUCINATION ON NON-SPEECH

### What is known for Whisper

VERIFIED — faster-whisper documents `no_speech_threshold=0.6` and `log_prob_threshold=-1.0`; its sequential path skips a segment when `no_speech_prob > no_speech_threshold` unless average log probability overrides. `compression_ratio_threshold=2.4` is a repetition/degeneracy guard. R76:284–298, based on faster-whisper 1.1.1 `transcribe.py:1173–1190`.

VERIFIED — whisper.cpp exposes `no_speech_thold` as a decoder parameter; its default and effect are source/version-specific and must not be assumed portable to faster-whisper. Source reference: https://github.com/ggml-org/whisper.cpp/search?q=no_speech_thold. No live-call peer in this pass used a phrase list as its primary gate.

REPORTED — Whisper non-speech hallucination studies and the “Bag of Hallucinations” project report recurring phrases including “Thank you for watching”, “Thanks for watching”, “you”, and “so”; the reported filter construction used n-gram log probability <−10 and occurrence count >4. R76:421–428; arXiv: https://arxiv.org/abs/2501.11378. This is secondary for this dossier and model/language dependent.

VERIFIED — Phrase deny-lists are unsafe for live calls: “yes”, “no”, “okay”, “stop”, and “yeah” can be legitimate answers. R76:430–443. A deny-list also would not catch this owner’s Parakeet false content such as “Flora Wallace”, measured on reversed speech. R76:261–280.

### What is known for Parakeet / NeMo

VERIFIED — The owner’s served Parakeet path returned `""` on white noise, 120 Hz hum, clatter, and four-voice babble ⟦V: through the HTTP door, so the second Silero pass (0.5) may have returned `""` before Parakeet ran. My direct probe of Parakeet v3 (the prod model, `istupakov/parakeet-tdt-0.6b-v3-onnx`) with no VAD: white/car noise → `""`, but 120 Hz hum → “Uh”, 3-voice reversed babble → “Okay.”, a 150 ms speech onset in car noise → “Oh.”. §V.b4⟧, but returned “Flora Wallace” on reversed speech and “Hello.” on a 200 ms speech fragment. Every response carried `logprobs:null`. R76:261–275.

REPORTED ⟦V: it is Modal's example (modal.com), not NVIDIA's⟧ — the NeMo/Parakeet streaming example explicitly says Parakeet “tries really hard to transcribe everything to English” and may output “Yeah” or “Mm-hmm” on silent audio; its mitigation is silence detection before inference ⟦V: an ABSOLUTE level gate, `pydub` `silence_thresh=-45` dBFS, `min_silence_len=1000` ms. In this car (noise −42 dBFS median) it would pass the cabin as non-silent⟧. https://modal.com/docs/examples/streaming_parakeet. This is a secondary example using NeMo, not the owner’s Speaches runtime.

VERIFIED — NVIDIA’s model material describes Silero VAD before Parakeet inference to reduce non-speech processing and improve endpointing. https://catalog.ngc.nvidia.com/orgs/nvidia/collections/parakeet-tdt-0.6b-v2. That is preprocessing guidance, not a Parakeet confidence guarantee.

VERIFIED — NeMo has a general ASR confidence-estimation tutorial, but the owner’s `onnx-asr` Parakeet executor returns text only and Speaches’ realtime transcription requests `response_format="text"`; it exposes no `no_speech_prob`, token confidence, or log probability to ctrl-b. R76:168–215. Any confidence gate requires executor + HTTP/realtime schema changes. ⟦V: plus a dependency bump. The venv has `onnx-asr 0.7.0`, whose TDT greedy loop takes `argmax` and discards the score (`onnx_asr/asr.py:133-162`). **`onnx-asr ≥ 0.10.0`** (commit `54f3819`, 2025-12-26, “Add logprobs to recognize results”) returns per-token `logprobs` through `.with_timestamps()`. NeMo's native `ConfidenceConfig` (entropy/tsallis, α 0.33, `aggregation min`, all `preserve_*` default False) is not reachable from ONNX. A probe shows the signal does NOT cleanly separate the case that matters (§V.b4).⟧

VERIFIED — The practical live-call filter order is therefore: reject empty text; require identified segment evidence; use measured energy/proximity as a corroborating signal; optionally use ASR metadata only after a Speaches patch. Do not start with Parakeet filler vocabulary.

## 4. THE BACKCHANNEL PROBLEM

VERIFIED — “Mm-hmm”, “uh-huh”, “yeah”, “right”, and “okay” can be continuers while the agent is speaking, but “yeah” and “okay” can also be a complete answer. Deepgram’s explanatory material distinguishes pure listener signals (`mm-hmm`, `uh-huh`) from ambiguous agreement tokens (`yeah`, `okay`). https://deepgram.com/learn/backchannels-vs-interruptions-voice-agents. This is a vendor educational page, so the linguistic claim is REPORTED rather than primary academic evidence.

REPORTED — Academic work defines backchannels as brief one- or two-word listener responses and treats backchannel prediction separately from turn-taking. The 20 most frequent examples include “yeah”, “mmhmm”, and “oh okay”; the study finds backchanneling is especially local/acoustic, while context helps turn-taking. https://arxiv.org/html/2401.14717v1. The result is useful but not a production acceptance rule.

VERIFIED — LiveKit’s implementation does not solve this with a transcript deny-list. Its adaptive interruption path has a `backchannel_boundary=(1.0,1.0)` around agent-turn boundaries and a `min_duration=0.5 s`; its model can classify overlap as backchannel and suppress it near the boundary. R76:359–373. The text `MultilingualModel` predicts end-of-turn from conversation context, but current docs deprecate it in favor of the audio model. https://docs.livekit.io/agents/build/turns/turn-detector.

VERIFIED — Pipecat exposes the same distinction as a model strategy: Krisp VIVA IP is intended to distinguish genuine interruptions from backchannels and uses a default 0.5 probability threshold. R76:335–342. Its plain `MinWordsUserTurnStartStrategy` is cheaper but cannot know whether “yeah” answers a question. ⟦V: missed the shipped rule. It is PHASE-asymmetric: `min_words` applies only while the bot speaks; after `BotStoppedSpeakingFrame` one word starts a turn (`min_words_user_turn_start_strategy.py`, `min_words = self._min_words if self._bot_speaking else 1`). Krisp IP, LiveKit `backchannel_boundary`/`min_words`, and Vapi `numWords` are all overlap/interruption rules too. No surveyed peer drops a short utterance when the agent is silent, and none uses question context.⟧

VERIFIED — Deepgram Flux separates tentative end from committed end. `EagerEndOfTurn` can prepare a response, `TurnResumed` cancels it, and only `EndOfTurn` commits. It is a text-plus-acoustic turn lifecycle, not a backchannel word list. https://developers.deepgram.com/docs/flux/voice-agent-eager-eot.

### Cheapest rule for ctrl-b

UNVERIFIED ⟦V: was marked VERIFIED, but this is the author's heuristic; no source ships it, and the owner's chat log contradicts rule 3 (§V.b2)⟧ — The cheapest safe rule is contextual, not lexical:

1. Drop an empty final immediately.
2. If a short final (one or two words, especially “mm-hmm”/“uh-huh”) overlaps the agent’s speech or arrives inside a short post-agent boundary, treat it as a backchannel and do not submit it.
3. For “yeah”, “okay”, “right”, “sure”, “yes”, “no”, and “stop”, preserve it when the previous assistant turn ended with a question or an explicit confirmation request; otherwise require the existing energy/segment evidence and a short commit delay.
4. Never make the vocabulary rule unconditional.

UNVERIFIED — The exact boundary and delay for this client are not measured. LiveKit’s 1.0 s boundary and 0.5 s interruption minimum are useful starting evidence, not a ctrl-b default. The owner’s car tail currently lasts about 3.2–3.6 s to VAD stop and 3.6–4.0 s to final after element drain, so a boundary alone cannot repair this route; tail holding must precede backchannel classification. maya-audit.md:61–70. ⟦V: those are drain→`speech_stopped` spans and include the 700 ms `silence_ms`. The audible echo ends 2.34–2.66 s after drain (7/8; one 3.26), and the output lag is ≈ 2.25–2.45 s (Opus audit I1; R91 §1.6).⟧

## 5. THE LEVEL AXIS IN A CAR

### Field numbers

REPORTED — A real-world listening study measured car/traffic environments from 61.2 to 78.7 dBA across categories; the van/road condition reached 78 dBA. https://pmc.ncbi.nlm.nih.gov/articles/PMC4111914. This is an acoustic-environment range, not a phone microphone dBFS calibration.

VERIFIED — ITU-T P.1100 gives speakerphone hands-free SLR 13±4 dB versus headset 8±4 dB: a nominal ~5 dB car disadvantage with ±4 dB spread. It also constrains send level rather than assuming arbitrary AGC. R83:42–53, 180–195; official source https://www.itu.int/rec/T-REC-P.1100.

REPORTED — Typical active telephone speech is about −26 dBov; R83 converts 0.05 RMS to roughly −26 dBFS under the project’s RMS convention. The owner’s car round measured speech peaks −14…−18 dBFS but ordinary level was close to the relative floor; R83:49–55; EVIDENCE.md:10–17. The R83 dBov conversion convention is itself marked uncertain there.

VERIFIED — No source found publishes a reliable phone-mic dBFS level table by car speed, HFP codec, handset, or Chrome route. The owner’s measured levels are more useful than generic dBA, but only for this route/device.

VERIFIED — The owner’s A2DP output tail peaks −11…−19 dBFS at the microphone, the same band as accepted speech. Therefore no amplitude-only gate can reject that echo while accepting the owner’s voice. EVIDENCE.md:38–46.

### Absolute versus relative gates

VERIFIED — The surveyed shipped products mostly rely on NS/AEC + neural VAD or their own internal level model. Pipecat is the clearest explicit AND precedent: Silero confidence plus normalized 400 ms loudness. Hermes uses relative quiet-room calibration for barge-in but keeps a separate absolute turn floor. R76:318–347; R85:122–145.

VERIFIED — A relative floor is a route-portable proximity proxy, not a speech/noise classifier. R76 measured far speech/TV-like audio near RMS 0.003 versus near-field speech 0.05–0.2, a 15–60× gap, while both were speech-like to Silero. R76:249–259 and :458–470. It cannot reject a near speaker or loud TTS echo.

VERIFIED — The R83 precedent for a robust floor is minimum statistics: WebRTC AGC2 tracks a minimum over 5 s (500×10 ms), drops immediately, and rises halfway per period; it avoids learning speech by tracking minima. R83:109–125. The owner’s current floor adds learned voice level −10 dB and clamps [−60,−20], but the top clamp is only 5 dB above the observed owner peaks in the car, so the gate is over-constrained there. ⟦V: the −20 dBFS floor was the owner's own Sensitivity drag (`floorPinned`). Unpinned, the trail's floor was −31 dBFS (voice −21 − 10), and the tracked noise was median −42.2 dBFS (range −49.3…−39.9, 295 samples). The owner's −14…−18 peaks sat 13–17 dB over the unpinned floor and 24–28 dB over the cabin noise. **The level axis had headroom against road noise. The 5 dB squeeze is an artefact of the pin, not of the car.**⟧

### Spectral cue and cheap client filter

VERIFIED — Speech is commonly treated as a roughly 300–3400 Hz telephone band, while road/engine rumble has substantial low-frequency energy. A vehicle speech-recognition study found 400 Hz high-pass processing best in one acceleration condition, but a 500 Hz high-pass degraded recognition in all tested environments; it concludes speech components above 400 Hz remain necessary. ⟦V: re-read (Hoshino, Toyota CRDL R&D Review 39(1)). The baseline front-end is a 200 Hz HPF. At every CONSTANT-SPEED condition 200 Hz was best (engine-periodic level `Len ≤ 1.6 dB`); 300/400 Hz won only under acceleration (`Len ≥ 1.8/2.3 dB`), adaptive → +11.9 % mean. The paper puts road noise as random components below 1000 Hz and wind above 500 Hz, so a 300 Hz cut removes only part of it. HMM isolated-word ASR, ~2004.⟧ https://www.tytlabs.co.jp/en/english/review/rev391epdf/e391_004hoshino.pdf. Therefore a 250–350 Hz high-pass or low-band-energy ratio is a plausible feature; a hard 500 Hz cut is not a safe default.

⟦V: shipped HPF precedent exists but at ~80–90 Hz, not 300: WebRTC APM's `HighPassFilter` (3 cascaded biquads, `modules/audio_processing/high_pass_filter.cc:25-34`) measures −3 dB at ≈ 87 Hz, −13 dB at 80 Hz, 0 dB from 100 Hz (my `sosfreqz` of the 16 kHz coefficients). The classic WebRTC VAD's lowest sub-band starts at 80 Hz (`vad_filterbank.c:32-39`). pipecat's volume is K-weighted (BS.1770). No peer meters on a 300–3400 Hz band.⟧ VERIFIED — Web Audio’s native `BiquadFilterNode` supports `highpass`; MDN describes it as a second-order 12 dB/octave roll-off that attenuates below cutoff and passes above. https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode. A client can compute a cheap parallel feature without changing the PCM sent to Speaches.

UNVERIFIED — No live-call peer in this pass documents a final-acceptance gate based on 300–3400 Hz energy or a WebAudio high-pass. The car paper is a recognition experiment, not evidence that a high-pass separates owner speech from this owner’s echo.

## 6. RECOMMENDATION MENU

Ranking criteria: reliability in this car; false-drop risk at home; implementation debt in this pipeline. D77 means the next trail must preserve enough evidence to compare the choices, not merely count “good calls”.

### 1. Ship first: tail-aware hold + identified segment evidence + existing relative energy gate

Reliability in car: highest for the measured failure. False-drop at home: low for owner speech; it may delay barge-in while a tail is audible. Debt: relay/client, medium; no new model.

VERIFIED basis — the car’s output continues 3.2–3.6 s after HTMLAudioElement drain and finals arrive 3.6–4.0 s after drain; the existing hold is released on element timeline, not acoustic quiet. maya-audit.md:61–80. Also, a final without an energy epoch currently passes open. EVIDENCE.md:48–57.

Ship shape: keep `mic_hold=on` as the honest default; remove/retire `auto` for this route. Start `tailHeld` at playback drain; release only after the existing meter stays below the effective floor for a measured quiet interval, bounded by a cap. ⟦V: CONFLICT with R91 §4.3/§6 (and the Opus audit I2): the quiet line must be the NOISE tracker + 10 dB (≈ −31 dBFS in this car), NOT `effectiveFloor`. With the −20 pin the echo reads “quiet” mid-sentence. R91 numbers: quiet 700 ms, cap 5 s, plus a text backstop (≥ 10 chars, threshold ≈ 0.75). The main seat kept `auto` redefined as the D73 rule and deleted only the probe (I3), so “remove/retire `auto`” is superseded.⟧ Carry a monotonically assigned segment ID through relay speech-start/stop and transcript, or serialize upstream transcription; never use a FIFO ledger because Speaches tasks can complete out of order. Drop empty finals before queueing, but close their identified ledger entry first.

Starting numbers ⟦V: superseded by R91: cap 5 s (3.46 s worst measured end + 0.7 s quiet + headroom); 3.5 s would release inside the one 3.26 s tail⟧: use 3.5 s as a diagnostic cap only, not a universal promise; require 500–1000 ms of observed quiet to release; keep the current 200 ms final energy requirement. These are candidate numbers, not verified optima. The measured 3.2–3.6 s tail makes a 3.5 s cap plausible for this call, while a quiet-release path handles shorter routes.

Failure scenario: a persistently loud car tail reaches the cap and reopens the ear; a legitimate owner utterance during the hold is lost. D77 must record `playbackDrained`, `tailHeld`, `tailQuietSince`, `tailDeadline`, per-frame floor and peak, segment ID, start/stop, transcript completion, and final drop reason.

### 2. Silero minimum-duration patch plus client final gate

⟦V: dominated by a relay-only cut Maya did not have (the Opus audit landed after her brief). A final whose server started→stopped gap is < `silence_ms/2` is dropped at the relay, with no Speaches patch. On this trail that is 22 of 38 segments (14 empty, 8 non-empty: “Yeah.” ×4, “Okay.”, “Mm.”, “Mm-hmm.”, “Really?”), all with a gap ≤ 201 ms. Every other segment's gap was ≥ 2361 ms. Three short finals sit on the LONG side and survive the cut: “Yeah.” 3084 ms, “Okay, uh” 3158 ms, and “Mm-hmm.” 2478 ms (§V.b2). Why it protects a real short “yes” better than a 150–250 ms min-speech: §V.b1. If a server patch is ever wanted, the door that matters for Parakeet is `DEFAULT_VAD_OPTIONS` in `routers/stt.py:48` (min_speech 0), not only the realtime `VadOptions`.⟧

Reliability in car: medium for flapping; low for loud echo. False-drop at home: low to medium for “yes” if only applied to VAD segment duration. Debt: small Speaches fork plus existing client.

VERIFIED basis — the realtime path has effective minimum speech duration 0 and accepts 30–100 ms segments. Silero’s documented offline default is 250 ms, and LiveKit ships 50 ms. R76:146–153; Silero `utils_vad.py:315–324`.

Starting numbers: test 150, 200, and 250 ms minimum VAD duration; do not silently reuse the client’s 200 ms above-floor criterion. Keep silence 700 ms initially. A 250 ms minimum is the Silero documented default, not a guarantee that it is right for live “yes”.

Failure scenario: a genuine clipped “yes” or “no” is shorter than the chosen duration; the gate removes a real answer, while a longer speech-like TTS tail still passes. D77 must record raw segment duration, above-floor duration, transcript (including empty), and whether the segment was suppressed before ASR.

### 3. Keep Silero near 0.6; add a 300–350 Hz spectral/level corroborator

Reliability in car: medium; helps low rumble and structured noise, not TTS/other speech. False-drop at home: medium if the filter is used as a hard gate; low if it is only corroboration. Debt: client-only, low to medium.

VERIFIED basis — v5 at 0.9 has quiet-car premature-end failures because its 0.75 exit threshold sits on the degraded-speech tail; R84 measured 12 premature cuts at 0.9 versus 4 at 0.6 for one quiet narrowband sweep. R84:169–185. WebAudio has a native high-pass. The vehicle study supports caution around 400–500 Hz.

Starting numbers: keep VAD start threshold 0.6; compute low-band (<300 Hz) versus speech-band (300–3400 Hz) energy over 40–200 ms; use it as a logged feature first, not an immediate hard rejection. If hardened, require speech-band energy to exceed low-band energy by a locally calibrated margin, with a 250–350 Hz cutoff.

Failure scenario: phone AEC/NS and HFP codec reshape the spectrum; the owner’s low-pitched/quiet speech is wrongly dropped, or TTS occupies the speech band and still passes. D77 must record both band energies, cutoff, raw RMS, post-filter RMS if used, route, and ASR result.

### 4. Pre-VAD denoising/AEC upgrade

Reliability in car: potentially high for stationary road/engine noise, unknown for this phone path and echo tail. False-drop at home: medium; denoisers can remove quiet syllables. Debt: relay or browser audio-processing patch, high if DeepFilterNet/RNNoise/Krisp is introduced.

VERIFIED basis — OpenAI documents noise reduction before VAD/model; pipecat recommends RNNoise/Krisp/ai-coustic before VAD/STT; Retell warns aggressive background-speech cancellation can distort caller speech and costs $0.005/min. OpenAI Realtime docs; pipecat docs; Retell noise docs above.

Starting numbers: do not choose an unverified denoiser default from prose. Benchmark one candidate on raw and processed audio, preserving both. Measure onset latency and syllable deletion; a 100–200 ms lookahead is a material live-call cost, not free.

Failure scenario: denoiser suppresses the owner's quiet onset, changes Silero probabilities, or leaves A2DP speech because echo cancellation lacks a synchronized render reference. D77 must record raw/processed frame levels, VAD probabilities, processing latency, route, and transcript deltas.

### 5. Semantic/backchannel turn classifier or external Flux/LiveKit-style architecture

Reliability in car: potentially highest for false turns and “yeah” semantics, but not for acoustic echo before the classifier. False-drop at home: lowest if it can use question context, but model errors remain. Debt: highest: Speaches/relay protocol and likely model/provider change.

VERIFIED basis — LiveKit audio/text turn detectors and Deepgram Flux separate speech activity from end-of-turn; Flux drafts on EagerEndOfTurn and commits only on EndOfTurn. Vapi’s Smart Endpointing makes the same class of trade-off. These systems provide the semantic signal ctrl-b currently lacks.

Starting numbers: none should be invented. If using a provider, record its published threshold/delay: Flux’s `eager_eot_threshold`/`eot_threshold`; LiveKit min/max endpointing 0.3–2.5 s with audio detector; Vapi wait function 200–8200 ms. Do not use a semantic classifier as a substitute for tail holding or segment identity.

Failure scenario: a loud echoed question-like tail is semantically plausible and is committed; provider latency/cost and multilingual behavior differ from the current local path. D77 must record tentative/confirmed event pairs, cancellation rate, semantic decision, acoustic evidence, tail state, and final submission.

### What I would ship first

VERIFIED recommendation — ship combination 1 first, then test combination 2 behind a server flag. It attacks the measured car cause (late A2DP tail and fail-open correlation) without adding a new model or a vocabulary policy. Add the 150–250 ms server segment minimum only after D77 confirms short flap segments are still creating finals; it is cheap defense-in-depth. Keep Silero at 0.6 rather than raising it: R84 shows 0.9 worsens quiet narrowband cut-offs, while speech-like interferers pass across 0.5–0.9. R84:26–54, 169–185.

VERIFIED — Do not ship first: unconditional “Yeah/Mm-hmm/Okay” deny-list; absolute −20/−24 dBFS final floor; `auto` probe based on assumed 100–250 ms A2DP latency; or semantic VAD without tail/echo evidence. Each either loses legitimate short answers or is contradicted by the measured route.

D77 minimum evidence contract

VERIFIED — For every VAD segment/final, record: call/leg generation; segment ID; capture and relay timestamps; VAD start/stop; actual PCM duration; Silero threshold and probability summary if available; raw RMS/dBFS p10/median/p90/peak; floor and clamp state; milliseconds above floor; route/EC/NS/AGC state; `mouthLive`, `earHeld`, `tailHeld`, and playback drain; transcript including empty; transcript completion order; accepted/dropped decision and reason. The current trail’s missing segment identity and 1 Hz level sampling are exactly what prevented safe correlation and exact acoustic-latency measurement. EVIDENCE.md:1–17, 48–65; maya-audit.md:17–23, 41–47.

## what I could not determine

UNVERIFIED — Whether the owner’s 38-segment car flapping came mainly from stationary engine/road noise, structured transients, Chrome’s AEC/NS output, A2DP echo, or Speaches’ zero-state 3 s rescan. The trail proves all are plausible and proves the late loud tail, but does not contain raw audio or per-frame Silero probabilities.

UNVERIFIED — The actual acoustic onset and full tail distribution on the owner’s Android/Chrome/car combination. The 1 Hz samples establish roughly 3.2–3.6 s to VAD stop and 3.6–4.0 s to final after drain, not sub-second platform latency.

UNVERIFIED — Whether Parakeet TDT through `onnx-asr` can expose useful per-token confidence, blank probability, or a no-speech signal. The current Speaches realtime door exposes none; the executor’s deeper API was not proved. ⟦V: now DETERMINED. `onnx-asr ≥ 0.10.0` exposes per-token logprobs (§3). Whether they are useful: a synthetic probe says no for the case that matters (§V.b4).⟧

UNVERIFIED — Whether a 150, 200, or 250 ms server minimum is the best cutoff for the owner’s legitimate short answers, and whether it interacts with Speaches’ concurrent transcription ordering.

UNVERIFIED — Whether v6.2 in a persistent streaming state, rather than Speaches’ zero-state rescan, materially reduces this owner’s car false segments. R84’s v6 evidence is synthetic and continuous-state; the exact Speaches integration was not run.

UNVERIFIED — Whether browser-side 300–350 Hz high-pass or band-energy corroboration improves this phone route without deleting quiet/low-pitched speech. The car recognition study is precedent, not a ctrl-b measurement.

UNVERIFIED — The effective VAD/preprocessing order and thresholds used internally by Vapi, Retell, ElevenLabs, Gemini Live, and hosted voice providers; public docs expose only parts of their proprietary pipelines.

UNVERIFIED — A production-quality backchannel classifier that can reliably distinguish “yeah” as continuer from “yeah” as an answer using only the current whole-utterance final and local conversation state. The evidence supports question-context as the cheapest heuristic, not a guaranteed classifier.

Primary sources and already-bought evidence

VERIFIED — ctrl-b evidence: R76 `docs/research/R76-noise-hallucination-gating.md`; R83 `R83-portable-energy-floor.md`; R84 `R84-silero-threshold-calibration.md`; R85 `R85-hermes-openwebui-voice-controls.md`; R79 `R79-peer-call-audio-echo.md`; `/home/emma/.cache/tmp/ctrlb-session48/EVIDENCE.md`; `/home/emma/.cache/tmp/ctrlb-session48/maya-audit.md`.

VERIFIED — source pins read in this pass: Silero VAD `5cd7945676eb32225748052e2e6a0580e4686a08`; LiveKit Agents `57b3227a7842697e6ad45b1275369cf9700bf161`; pipecat `2967e1c09ad484076089bc88427d305fe8f79fa9`; Wyoming Satellite `7a3ba2bc23fc6699adae4f5bbac4ce529fe2a623`.

VERIFIED — official/public URLs cited inline: LiveKit turn detector; Pipecat speech input; Vapi speech configuration and denoising; Retell orchestration and background-noise handling; ElevenAgents overview and conversation flow; OpenAI Realtime VAD/reference; Home Assistant pipelines; Deepgram Flux; Gemini Live; Vocode mechanics; MDN BiquadFilterNode; ITU-T P.1100; vehicle speech-recognition study; academic backchannel paper. 

## V. Opus 5.5 verification pass (2026-09-27)

This pass re-opened the sources behind every design-bearing claim, read the prod trail and chat log, and ran one synthetic Parakeet probe. The pins match Maya's: LiveKit `57b3227`, pipecat `2967e1c`, silero-vad `5cd7945`, wyoming-satellite `7a3ba2b`, speaches `fdc6a27`. Also read: HA core `dev` @ `1e5f618` (`assist_pipeline/vad.py`), WebRTC `main` (`high_pass_filter.cc`, `vad_filterbank.c`), NeMo `main` (`asr_confidence_utils.py`), onnx-asr (the venv's 0.7.0, and git to `675f0e6`/0.12.0). The corrections are made in place above and marked `⟦V: …⟧`.

### V.a Claims re-verified

| Claim | Maya | Finding | Source |
|---|---|---|---|
| LiveKit Silero: 0.5 / min_speech 0.05 / min_silence 0.55 / prefix 0.5 / exit max(t−0.15, 0.01) | VERIFIED | **Confirmed.** `min_speech` is a CONTIGUOUS-speech onset debounce, and END needs `min_silence` of contiguous silence, so a LiveKit start→end gap is ≥ 0.55 s by construction | `livekit-plugins-silero/…/vad.py:60-138, 518-566` |
| LiveKit interruption defaults (`min_duration 0.5`, `min_words 0`, `false_interruption_timeout 2.0`, `backchannel_boundary (1.0, 1.0)`) | VERIFIED | **Confirmed.** All are overlap/interruption rules | `voice/turn.py:150-198` |
| LiveKit endpointing 0.5/3.0 s, audio detector 0.3/2.5 s, VAD silence ≥ 250 ms, `MultilingualModel` deprecated | VERIFIED | **Confirmed** (slated for removal in 2.0) | docs.livekit.io turn-detector |
| pipecat 0.7 / 0.2 / 0.2 / `min_volume 0.6`, `confidence AND volume` | VERIFIED | **Confirmed, with a correction.** The volume is BS.1770 K-weighted LUFS (absolute, ≈ −50 LUFS at 0.6). The STARTING count resets on one non-speech frame | `vad_analyzer.py:25-28, 194-248`; `audio/utils.py:164-188` |
| pipecat Whisper `no_speech_prob 0.4` | VERIFIED | **Confirmed** | `services/whisper/stt.py:283` |
| pipecat Krisp IP threshold 0.5 separates backchannels | VERIFIED | **Confirmed.** It is an interruption predictor (runs against bot speech) | `krisp_viva_ip_user_turn_start_strategy.py:1-17, 70-102` |
| Silero `get_speech_timestamps` 0.5/250/100/30 | VERIFIED | **Confirmed. Nuance:** the streaming `VADIterator` has NO `min_speech_duration` (`:591-598`). The 250 ms exists only offline | `utils_vad.py:283-295, 591-598` |
| Speaches realtime `min_speech_duration_ms` 0; zero-state 3 s rescan | VERIFIED | **Confirmed** | `silero_vad_v5.py:38-60`; `input_audio_buffer_event_router.py:47-98` |
| Wyoming `--vad-threshold 0.5`, `trigger-level 1`, `buffer 2 s`, NS/AGC 0 | VERIFIED | **Confirmed**, but HA's endpointer was missed (below) | `vad.py:8-32`; `__main__.py:76-163` |
| HA: “no published minimum speech duration” | VERIFIED | **WRONG.** `speech_seconds 0.3` (reset 1.0 s), `command_seconds 1.0`, `silence_seconds 0.7` (0.25/1.25) | `assist_pipeline/vad.py:21-101` |
| OpenAI `server_vad` 0.5/300/500; noise reduction runs before VAD | VERIFIED | **Confirmed** | realtime-vad guide; API reference |
| Vapi `voiceSeconds 0.2`, `numWords` 0 (2–3 advised), `backoff 1 s`, `waitSeconds 0.4`, wait `200 + 8000·x` | VERIFIED | **Confirmed** | docs.vapi.ai speech-configuration |
| Deepgram: echo/noise cause false `StartOfTurn` | VERIFIED | **Confirmed.** The eager-EOT page publishes no numeric defaults | developers.deepgram.com flux pages |
| Gemini Live LOW/LOW/20/100 | VERIFIED (as config) | **Example values, not defaults** | ai.google.dev live-guide |
| Parakeet “Yeah/Mm-hmm on silence” | REPORTED (as NVIDIA) | **Modal's** example. Mitigation = pydub −45 dBFS / 1000 ms | modal.com streaming_parakeet |
| NGC: Silero before Parakeet | VERIFIED | **Confirmed** (one sentence; no confidence, no hallucination text) | catalog.ngc.nvidia.com |
| Speaches exposes no confidence | VERIFIED | **True for the venv (onnx-asr 0.7.0).** False as a claim about the stack: onnx-asr ≥ 0.10.0 returns token logprobs | `onnx_asr/asr.py`, commit `54f3819` |
| Vehicle HPF study (400 best / 500 hurts) | VERIFIED | **Confirmed, with nuance.** At constant speed 200 Hz was best | Hoshino, TCRDL R&D Review 39(1) |
| “Cheapest safe rule is contextual” | VERIFIED | **Heuristic, not a source; contradicted by the chat log** | §V.b2 |

### V.b What was missed

**b1. The relay gap cut (extra question i), and why it is the right noise cut here.**

Speaches has two stop paths (`input_audio_buffer_event_router.py:70-97`):

- **Path 1.** The whole 3 s window shows NO speech on the next rescan. The stop fires within one or two appends of the start. This is the flap.
- **Path 2.** The last timestamp closed ≥ `silence_ms` before the window end, and the buffer is > 3000 ms.

Every stop rotates the buffer, and the committed audio is `audio_start_ms…now`.

For a real utterance ending through path 2, the gap is ≈ speech duration + `silence_ms` − the detection lag (R91 §5.2: 0.26–0.34 s). A 150 ms “no” still gives ≈ 0.5 s. The 3 s buffer rule inflates most real gaps further (R76 §1.2), which is why the trail's real minimum is 2361 ms. So `gap < silence_ms/2` (350 ms) is really a **path-1 detector**. It protects a real “yes” regardless of the word's length, which a 150–250 ms minimum-speech rule cannot. But the true margin for a very short real word is only ~0.1–0.2 s, not the 2 s the trail suggests. The relay-clock bunching is why it must stay `/2`, not `silence_ms`.

**Field pattern:** supported in class, not in form.

- Every continuous-state peer debounces the onset: LiveKit 50 ms contiguous, pipecat 200 ms contiguous, HA 0.3 s cumulative, Silero offline 250 ms, Vapi 0.2 s (interruptions), Hermes 0.3 s (R85).
- None needs a post-hoc gap test, because their VAD cannot retract a start. END requires `min_silence`, so a start→stop gap < `min_silence` cannot occur.
- OpenAI `server_vad` and Deepgram publish no minimum-speech knob. Deepgram's `UtteranceEnd` works from word timings, ≥ 1000 ms [REPORTED, docs].

So the cut is the relay-side equivalent of the universal debounce, tailored to a Speaches-specific defect.

**Missed risk: the flap SPLITS an utterance.** A path-1 stop rotates the buffer, and the next start follows +225–235 ms later in 5 of 22 flaps.

- In 4 of those 5, the continuation was the reply's echo.
- One flap carried words: “Really?” (gap 82 ms) followed by “gonna be with me.” is the echo of “You're… really good at being patient with me.”
- No owner turn was split in this trail (n = 6).

A dropped flap can therefore take an utterance's first word(s). That is a live candidate for the owner's “first words cut” report. The trail should log `nextStartMs` per dropped flap. Do not merge flap text (it would prepend hallucinated “Yeah.”s).

**b2. Backchannels vs real short answers (extra question ii): the chat log refutes the question-context rule.**

False shorts landed right after question-ending replies:
- 04:50:57: “Yeah.” / “Mm-hmm.” / “Yeah.” after “…Unless you're asking about someone else?”
- 04:53:17: **“No.” after “Is this… okay?”** The owner's next turns were “No, sorry, … the call is a little bit uh flaky” and “You're not hearing me well”. The “No.” was not meant, and it drove the whole hurt-rejection arc. It is the most damaging turn in the log.

Both are in the first, untrailed call (`auto`).

The one plausibly REAL short answer, “Okay, uh” (04:55:49, gap 3158 ms, began ~1.1 s after the echo ended), followed a reply ending “…I promise.”, not a question. A question-context rule would admit ≥ 4 false shorts and would not protect the plausible real one.

A second case is undeterminable: “Yeah.” (04:55:14, gap 3084 ms, peak −11.3 dBFS, 240 ms over floor, SENT) is the post-drain echo segment. It is either the echo mis-transcribed or the owner talking over it.

The shipped rule in the field is PHASE-based (short words ignored only while the agent speaks: pipecat `min_words … if bot_speaking else 1`, Krisp IP, LiveKit, Vapi `numWords`). ctrl-b's hold already covers that phase. After it, peers treat one word as a turn. Separating these cases is acoustic evidence's job (the gap cut, the item_id ledger, energy above the noise-relative floor, the tail hold), not a lexical rule.

**b3. The second Silero pass.**

- Speaches' HTTP door re-runs Silero at 0.5 / 160 / pad 400 and returns `""` without calling Parakeet when it finds nothing (`routers/stt.py:48, 154-168`; `executors/parakeet.py:131-139`). R76 knew this but judged it “can essentially never fire” at 0.9. At 0.6 it rejected 14 of the 22 flaps.
- The 8 non-empty flaps are where Parakeet ran on the 400 ms-padded region that the 0.5 pass accepted.
- If a server patch is ever wanted, `DEFAULT_VAD_OPTIONS` (min_speech 0) is the door in front of Parakeet. It is server-wide.

**b4. Parakeet v3 non-speech outputs and confidence (extra question iv).** [VERIFIED probe, synthetic]

The probe ran `istupakov/parakeet-tdt-0.6b-v3-onnx` (the prod model) through onnx-asr 0.12.0 `.with_timestamps()`, with no VAD. Speech was PocketTTS `nova`, 16 kHz; car noise was a synthetic low-passed rumble plus a band-passed mid.

| Input | Text | mean / min token logprob |
|---|---|---|
| white −40, car −38, car −30 dBFS; 440 Hz 120 ms drop cue + car | `""` | — |
| 120 Hz hum −30 | “Uh” | −0.67 / −1.31 |
| 3-voice reversed babble −25 | “Okay.” | −0.53 / −0.92 |
| 150 ms speech onset + car | “Oh.” | −1.06 / −1.13 |
| “yeah” at −45 under car −38 | “Uh” | −0.80 / −1.58 |
| “Yeah.” clean / +car SNR≈8 / −30 in car | “Yeah.” | −0.15 / −0.14 / −0.14 |
| “No.” clean | “No.” | −0.28 / −0.55 |
| **“No.” + car SNR≈8** | “No.” | **−0.88 / −1.42** |
| “Okay, uh” clean | “Okay, uh” | −0.36 / −0.70 |

- Parakeet returns `""` on broadband noise by itself.
- Its fillers come from structured or speech-like input (hum, babble, speech fragments, faint far speech).
- A logprob gate would drop a real noisy “No.” (−0.88) together with the fillers (−0.53…−1.06). **Not a clean separator for the short answers that matter** (n = 15, synthetic, one TTS voice).
- Reaching the signal takes an onnx-asr bump plus executor and realtime-schema patches (OpenAI's shape: `include: ["item.input_audio_transcription.logprobs"]`, R76 §1.4).

**b5. Silero tracker (brief Q2, uncovered).**
- #452, “filter out noise that is not human voice?”: the maintainer answered “No.”
- #369: the maintainer frames the VAD as separating speech from “silence, mild noise, music”; noise-only false triggers were a v5 to-do.
- No tracker issue on car noise was found.

**b6. The level axis in the car.** The trail's noise estimate: median −42.2 dBFS (−49.3…−39.9). The unpinned floor was −31. The owner peaked 24–28 dB over the cabin noise. The “~5 dB headroom” is an artefact of the pin. The noise failure in this car is the flap/hallucination class (0 ms above floor, peak −120), not level overlap. So speech-band metering (N4) has little to fix on this evidence.

**b7. HPF precedent (extra question iii).**
- Shipped high-pass filters sit at ~80–90 Hz: WebRTC APM at −3 dB ≈ 87 Hz, and the WebRTC VAD bands start at 80 Hz. pipecat's volume is K-weighted.
- The only 200–400 Hz evidence is the Toyota ASR study. Its steady-cruise optimum was 200 Hz.
- No live-call peer meters a 300–3400 Hz band. As a log-only trail feature it is harmless (it never changes the uplink).

### V.c What was misread

- **Heuristic labelled VERIFIED.** The §4 “cheapest safe rule” and the §6 recommendation are the author's heuristics, marked VERIFIED.
- **Stale tail numbers.** The drain→`speech_stopped` spans (3.2–3.6 / 3.6–4.0 s) are used as the tail. The audible echo ends 2.3–2.7 s after drain (I1).
- **Wrong quiet line.** The menu #1 releases on `effectiveFloor`. R91 requires the noise tracker, because the pin sits in the echo band.
- **Wrong cap.** 3.5 s is below R91's 5 s and would release inside the 3.26 s tail.
- **Stale `auto` ruling.** “Retire `auto`” is superseded by I3.
- **Stale threshold.** “Current 0.9 start” is stale; prod is 0.6.
- **pipecat volume.** It is K-weighted LUFS, not a relative loudness.
- **Attribution.** The Modal example is attributed to NVIDIA.
- **Gemini.** Example values are presented as defaults.
- **Home Assistant.** Its endpointer is omitted.
- **Empty finals.** `""` is attributed to Parakeet instead of the second VAD pass.
- **Segment length.** The event gap is conflated with segment audio length.
- **Headroom.** The pin's 5 dB is read as car headroom.

### V.d Re-judged recommendation — AGREE WITH CHANGES

**Ship first (all client or relay; server untouched):**
1. **The tail hold as R91 specifies it.** Quiet line = noise + 10 dB; 700 ms; cap 5 s; plus the Hermes-style text backstop and the `item_id` ledger. This is Maya's #1 with R91's numbers and I3's `auto`.
2. **N1 + N2.** Drop empty finals. At the relay, drop finals with gap < `silence_ms/2`, silently (no cue, no note, no mouth hold). Trail `gapMs`, `nextStartMs` and the flap text. This replaces Maya's #2 (no Speaches patch).

**Do not build:**
- The question-context backchannel rule (b2).
- A filler deny-list.
- A logprob gate (b4).
- Silero 0.6 → higher.

**Log only:** band energies (Maya's #3 as a trail feature). Keep denoise (#4) and a semantic turn model (#5) parked.

**What still escapes after 1 + 2:**
- Long-gap shorts, like “Yeah.” in the echo segment (the tail catches those) and “Mm-hmm.” (energy gate).
- A real owner word eaten by a flap-split (b1). The trail must count these.

### V.e What I could not determine

- Whether the long-gap “Yeah.” (rel 48.9–52.3) and “Mm-hmm.” (rel 210.7–213.2) were the owner, the echo, or noise. There is no raw audio.
- Whether “No.” / “Fox.” / the triple “Yeah.” in the untrailed first call were flaps, echo, or the owner. The owner's follow-ups imply unintended.
- Whether Chrome applies APM's 87 Hz HPF on this Android capture with `ec:false`.
- Whether a real car recording reproduces the probe's filler behaviour, and the logprob distribution for the owner's own voice.
- The flap-split rate on owner speech (0 of 6 here).
- Any car-specific vendor guidance. None found, as in Maya's pass.
