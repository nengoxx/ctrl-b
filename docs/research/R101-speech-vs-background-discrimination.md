# R101 — Telling the OWNER's speech from music, TV and background on a single-user voice call

**Date:** 2026-10-06 · **Author:** research lane R101 (Opus 5.5), session 61 · **Status:** evidence dossier. Nothing is built, nothing is decided.
**Question (owner, 2026-10-06):** "a thorough research to see the other ways that we can discern that kind of stuff" — after three dev
calls in which music with vocals, a Spanish TV and low-level room sound went out as the owner's turns.
**Feeds:** [`ASR_PLAN.md`](../ASR_PLAN.md) §3.4 (relay VAD), §3.6 (the pre-ASR pass and its parked chars-per-voiced-ms candidate),
§3.7 (parakeet-server on emma), §3.9 (the client level gate) · [`ISSUES.md`](../ISSUES.md) ISS-58 / ISS-63 / ISS-64.
**Drives:** [D85](../DECISIONS.md) (DECISIONS) · [`ASR_PLAN.md`](../ASR_PLAN.md) §3.12 — the owner-voice discriminator, ruled 2026-10-06.
**Builds on, does not redo:** [R98](./R98-vad-model-landscape.md) (VAD models, Recho's foreground-VAD table, the `VadModel` boundary) ·
[R92](./R92-live-call-noise-robustness.md) (how live-call peers survive noise; denoisers parked as a seam) ·
[R76](./R76-noise-hallucination-gating.md) (Whisper filters, energy = a PROXIMITY policy) · [R83](./R83-portable-energy-floor.md) (Chrome
Android AGC = fixed +6 dB) · [R74](./R74-android-call-audio-routing.md) / [R77](./R77-android10-pres-route-residual.md) (what the
browser can reach on Android) · [R85](./R85-hermes-openwebui-voice-controls.md) (open-webui / hermes voice at source).

**Confidence marks** (R98's vocabulary): **[V]** verified — source read in a clone at the SHA below, or model IO read with
`get_inputs()` · **[M]** measured on emma today (method §7) · **[R]** reported — official docs, a paper, a vendor page, not
reproduced · **[RS]** reasoned from verified facts plus a stated assumption · **[U]** expected, not checked.

## Sources (pinned, read 2026-10-06)

| Project | Ref | How |
|---|---|---|
| silero-vad | `master` @ `1e261b036686` (2026-09-29); releases v6.0 / v6.2 / v6.2.2; issues #121 #369 #563 #565 #663 | `gh` API (issues, releases, README) |
| FireRedVAD | `c30ec49` (2026-05-06) | shallow clone; ONNX IO read; models run |
| parakeet.cpp | `main` @ `9a28a3c` (2026-10-06); releases v0.5.0 (2026-08-01, the plan's pin) and v0.6.0 (2026-10-05) | shallow clone |
| pipecat | `61d9f91` (2026-10-06) | shallow clone |
| LiveKit Agents | `76de175` (2026-10-05) | shallow clone |
| Home Assistant core | `dev` @ `070c719` (2026-10-06), sparse: `assist_pipeline`, `wyoming`, `stt` | sparse clone |
| Willow Inference Server | `ba965a8` (2026-02-12) | shallow clone |
| OVOS dinkum listener | `238d953` (2026-10-06) | shallow clone |
| vocode-core | `e054c33` (2024-11-15) | shallow clone |
| SillyTavern Extension-Speech-Recognition | `2365811` (2025-12-20) | shallow clone |
| LibreChat | `e1dfc10` (2026-10-06), sparse: `client/src/hooks/Input` | sparse clone |
| Chromium | `main` @ `f336e20b70a1` — `media/webrtc/helpers.cc` | googlesource `?format=TEXT` |
| sherpa-onnx release assets | `speaker-recongition-models` (2023-12-08), `audio-tagging-models` (CED, 2024-04-19); `sherpa-onnx` 1.13.8 wheel | downloaded, IO read, run |
| YAMNet | `tensorflow/models` `research/audioset/yamnet` @ `c14bf9ad91` | README + class map |
| Test audio | LibriSpeech `dev-clean` (40 speakers, OpenSLR 12) · MUSDB18-7 (144 tracks × 7 s stems, Zenodo 3270814) | downloaded, deleted after |
| The three dev trails | `~/.ctrl-b-dev/calls/{fcd5b115,f9cd51a1,71fbe4ff}-….jsonl` | python, level/count fields only (no text exists) |

---

## 0. Executive summary

1. **A VAD answers "is this speech-like", never "is this the owner".** The field splits the problem into four discriminators with
   different reach: *speech-vs-music* (a tagger) · *near-vs-far / foreground* (level, reverberation, proprietary "background voice
   cancellation") · *this-voice-vs-other-voices* (speaker verification, personal VAD, target-speaker extraction) · *does this text
   make sense here* (ASR confidence, closed vocabulary, device-directedness). Each trial sits in a different cell (§1, §5.2).
2. **Correction — Silero's maintainers do not claim music rejection.** "As for music per se - we did not have music in the training
   data" (#565, 2024-11-04); the v6.0 notes list "Known persisting issues: music with human voice-like instruments" [V]. BUT on
   studio mixes **Silero v5.1.2 and v6.2 rarely fire on music with vocals** (median 0 % of hops ≥ 0.6; 0.6–0.9 confirmed
   segments/min under the plan's policy) [M]. **What makes them fire is WebRTC noise suppression in front of them:** the same 60
   excerpts through a WebRTC NS (level 3, the stand-in for Chrome's `kHigh`) give **5.0–5.7 confirmed segments/min** and a p90
   clip with 67 % of hops ≥ 0.6 [M]. NS strips the accompaniment and leaves the voice — a crude vocal extractor. All three trials
   ran with `ns: true`.
3. **Speech-vs-music is solvable without enrolment — but read the SPEECH channel, not the MUSIC one.** CED-tiny (5.5 M params,
   Apache-2.0 weights, 7 ms per 3 s on one core) gives P(Speech) ≥ 0.3 on **3 %** of post-NS 2 s music windows and on **99–100 %**
   of speech windows, *including speech with music 3–10 dB under it* [M]. P(Music) is useless as a reject rule: the owner talking
   over music scores P(Music) 0.61–0.65 [M]. parakeet-server **v0.6.0** (released 2026-10-05; the plan pins v0.5.0) can host this
   very model (`--sound-model`, ced.cpp) and returns `sound_events` in `verbose_json` [V].
4. **A TV or another talker IS speech; only a speaker-aware (or a foreground) model separates it at equal level.** No VAD, tagger,
   level or ASR-confidence approach can solve ISS-63 (TV and owner in the same −4.5…−9.6 dB band) [RS from V/M].
5. **Speaker verification is cheap and accurate on ONE owner, on clean single-talker segments** — CAM++ (Apache-2.0) 14 / 25 / 35 ms
   per 1 / 2 / 3 s on one core; EER 1.8 % at 1 s, 0.8 % at 2 s, 0.5 % at 3 s with a 30 s enrolment (LibriSpeech, 40 speakers) [M];
   the field's harder VoxCeleb numbers are ~4.3–4.8 % EER at 5 s enrol / 1 s test (ResNet34 / ECAPA, DAME Table 2) [R]. Music-with-
   vocals scores max cos 0.38 against ten enrolled owners (median 0.15–0.17) [M].
6. **Its two real limits, both measured:** (a) **overlap** — the owner speaking over another voice at 0 dB SIR drops to median cos
   0.32–0.35 (≈ the EER threshold, 0.40–0.42) [M]: ISS-63's owner-over-TV turns are exactly that case; (b) **channel** — enrol on the
   wideband phone mic, test on a narrowband (HFP-like) headset: EER 0.5 % → 4.6 %, genuine median 0.74 → 0.48; enrolling on the same
   narrowband channel brings it back to 3.7 % [M]. **Enrol per input route** — the same key problem as ISS-64.
7. **Personal VAD / target-speaker extraction are the frame-level answer to overlap, but nothing production-grade is open.** Google's
   Personal VAD (130 K params) and VoiceFilter-Lite (2.2 MB) published no weights; open re-implementations are a thesis (GPL-3.0,
   2022) and an 18-star repo; WeSep's pretrained models are "coming soon" [V/R]. Enrolment-free "background voice cancellation" exists
   only proprietary (Krisp BVC, ai-coustics, LiveKit Cloud) [R]; Recho's foreground VAD is unreleased (R98) and defines the foreground
   as "sustained presence" — a TV that talks more than the owner IS the foreground [R].
8. **The peer class mostly does NOT discriminate the user's voice.** Home Assistant, Wyoming, open-webui, LibreChat, SillyTavern,
   vocode, OpenAI Realtime: speech-vs-silence only [V/R]. The exceptions: **Willow** (opt-in `voice_auth`: WavLM x-vector, cos ≥ 0.75,
   HTTP 406 "Unauthorized voice") [V]; LiveKit/pipecat via **proprietary** Krisp/ai-coustics filters [V]; Speechmatics `known_speakers`
   (cloud; LiveKit's adapter now drops `focus_speakers` — "not supported by Agent STT") [V]; parakeet.cpp's CLI/C-API speaker registry
   (not in its HTTP server) [V]. Consumer Voice Match **personalises, it does not filter** [R].
9. **Correction — chars-per-voiced-ms (the parked §3.6 candidate) does NOT separate music.** Trial 3: the owner's finals 55–101 ms of
   above-floor energy per character, the music's 8–197 (median ~70) [M on the trail]. It separated ISS-58's near-silence fake only.
10. **The poisoning loop is structural, not a tuning slip.** `learnVoice`'s interferer guard is `p90 ≥ N + noise_margin + voice_margin`;
    with NS holding the minimum tracker at −56…−75 dBFS during music, the guard sat near −45 dBFS and every music final cleared it
    [V code + M trail]. Any gate that learns must learn only from what the discriminator ACCEPTED.

**Ranked top 3 (our reading, §5.5 — not a decision):** ① speaker-verification acceptance on the pre-ASR pass with a per-route enrolment
· ② a speech-vs-music tagger (P(Speech)) on the same pass, no enrolment · ③ the capture/learner pair — an NS-off A/B on the call route
plus learning only from accepted finals. ① and ② compose; neither alone covers all three trials.

---

## 1. The three trials, re-read from the trails [V on the trails; labels are the brief's / ISSUES']

All three: dev, call route, Chrome Android, Speaches as the ear (Silero **v5**, threshold 0.6), `ns: true` on every capture line.

| Trail | Capture | Finals (lines / with text) | What went wrong | Level facts |
|---|---|---|---|---|
| `fcd5b115` ISS-58 | call `agc: true, ns: true, ec: all`, phone mic | 37 / 30 over 424 s (media→call→media) | two finals the owner never said went out; 3 near-silence ones refused | fakes peaked −17.0/−17.3, ~6–8 dB under the owner; fake 9 ms/char vs genuine 50–60 |
| `f9cd51a1` ISS-63 | call `agc: true, ns: true, ec: all`, BT headset (`Default`) | **28 / 21** over 190 s *(ISSUES says "14 of 30"; the trail has 28 final lines — not reconciled)* | the Spanish TV's finals joined the owner's turns | owner −4.5…−9.6, TV −4.8…−9.6: the SAME band |
| `71fbe4ff` today | call `agc: true, ns: true, ec: all`, phone mic, seed none, V −9.5 at start | 35 / 28 over 161 s | music with vocals → 24 finals as one message | owner −6.7…−9.6, music −11…−20 |

**Trial 3, the level trajectory** (from `sample` lines): V −9.5 → −10.6 (8 s) → −13.9 (26 s) → −16.6 (33 s) → −18.0 (54 s) →
−19.6 (81 s), then oscillating −15…−18.2; the floor followed V − 10 (−20 → −29.6). **The noise tracker read −56…−75 dBFS the whole
time music played** — NS + the minimum tracker find the gaps between notes, so the noise term never sees music as noise.

**Why the learner's guard did not hold** [V `levelGate.ts:134-146` + `config.py:858-860`]: `learnVoice` refuses an utterance whose p90 is
under `noise.floor + noise_margin_db (10) + voice_margin_db (10)` — "an interferer that barely passed the gate must not teach the gate
that it is the owner". With N ≈ −65 the bar is ≈ −45 dBFS; the music finals' p90 sat at −11…−20. The guard is anchored to the NOISE,
while the interferer is anchored to the VOICE: it can never fire when the room is quiet between interferer bursts. Each taken fake moves
V by `VOICE_EMA_ALPHA` 0.3 toward the fake's level, which lowers `V − vm`, which admits quieter fakes.

**Chars-per-voiced-ms, measured on trial 3** (labelling by peak, as the brief does: > −10 dB = owner):

| Class | ms of above-floor energy per character (sorted) |
|---|---|
| owner (7 finals) | 55 · 68 · 72 · 74 · 79 · 80 · 101 |
| music (19 finals) | 8 · 23 · 28 · 30 · 40 · 47 · 55 · 62 · 69 · 73 · 75 · 76 · 86 · 103 · 109 · 111 · 120 · 124 · 197 |

The owner's band (55–101) sits inside the music's (8–197). Decoded lyrics are real words at a singing rate — the density rule that caught
ISS-58's 9 ms/char "sentence from near-silence" cannot catch them. ISS-63's finals span 11–120 ms/char with no labels to split them.

---

## 2. The discriminators, by family

### 2.1 Neural VAD on music and singing (question 1a)

| Source | What it says | Mark |
|---|---|---|
| silero-vad #565 (2024-11-04, maintainer `snakers4`) | "It is a known problem with songs / very high voices / children's voices / cartoon voices. As for music per se - we did not have music in the training data." | [V] |
| silero-vad #369 (2023-09-12, maintainer) | "we viewed VAD as speech / noised speech separation from everything else (silence, mild noise, music)" | [V] |
| silero-vad v6.0 release (2025-08-26) | "Known persisting issues: music with human voice-like instruments, very high pitched voices (artificial, cartoons, small children)" | [V] |
| silero-vad #663 (piano/guitar false alarms), linked #563; maintainer 2025-11-06 / 2026-04-01 | "6.2 model was just pushed, that is supposed to solve this issue" · "We drastically improved the noise robustness in this version. So it should be much better." | [V] |
| silero-vad v6.2 release (2025-11-06) | improvements on "Unusual voices · Child voices · Cartoon voices · **Muted voices · Muted speech** · Lower quality phone calls" | [V] — note: better at muffled speech also means better at hearing a far TV [RS] |
| silero-vad #121 (2021) | feature request "speech, music, noise" — closed, never built | [V] |
| TEN VAD #29 (2025-06-19, user report, unanswered) | "Ten-VAD is less effective at filtering out noise, such as … door closing sounds, knocking sounds, and music" | [R] |
| Recho FVAD, arXiv 2609.19856 (via R98 §2.1) | Silero v6 background false-alarm rate on VOiCES: music 0.12 · telephone 0.18 · babble 0.27; "background rejection comes from training supervision … not from the architecture" | [R] |
| parakeet.cpp `docs/vad.md` (v0.6.0) | on 2.6 h of music/noise/ESC-50, seconds called speech per hour: **Silero 48**, Parakeet Ultra head 2174, Redux head 1685; Silero at 0.2–0.3 "at most 199 s of false alarm per hour on music"; the Parakeet VAD head "is not a noise or music rejector" | [V doc; their measurement R] |
| FireRedVAD README | a separate non-streaming **AED** model: "speech/singing/music detection in 100+ languages"; in its own demo the speech track (0.85 of the clip) overlaps singing (0.91) | [V] |
| WebRTC legacy VAD | Recho F1 0.29–0.93 (R98); here: `is_speech` on **91 %** of 10 ms frames of post-NS music [M] | [R]/[M] |
| pyannote segmentation | no statement about music found; non-causal 10 s windows (R98) | no finding |

**Measured on emma** (§7.2; 60 MUSDB18-7 excerpts with vocals = 6.8 min, 40 LibriSpeech clips = 3.8 min; policy = the plan's §3.4
shape: EMA τ 30.5 ms, act 0.6, 7 consecutive hops to confirm, deact act − 0.15, 22-hop end) [M]:

| Input | Level | Silero v5.1.2: median clip share of hops ≥ 0.6 · p90 · confirmed segs/min | Silero v6.2: same | WebRTC legacy VAD (frames) |
|---|---|---|---|---|
| music with vocals, raw | −15 dBFS | 0.00 · 0.03 · **0.9** | 0.00 · 0.01 · **0.6** | — |
| music with vocals, **WebRTC NS 3** | −15 dBFS | 0.05 · 0.67 · **5.7** | 0.02 · 0.68 · **5.0** | 0.91 |
| music with vocals, raw | −30 dBFS | 0.00 · 0.01 · 0.7 | 0.00 · 0.01 · 0.7 | — |
| music with vocals, WebRTC NS 3 | −30 dBFS | 0.00 · 0.29 · 2.8 | 0.00 · 0.55 · 3.2 | 0.49 |
| speech (control), raw / NS | −15 / −30 | 0.80–0.81 · 0.87 · 11.0 | 0.80–0.82 · 0.87–0.89 · 11.0 | 0.72–0.81 |
| vocal stem alone (raw, vocal-active hops) | native | — | 0.39 median share | — |

What it shows: Silero's own training keeps it off a studio mix (the accompaniment masks the voice; the vocal stem alone fires on 39 % of
its hops), but a noise suppressor in front undoes that — it removes exactly the part of the mix that told Silero "this is music". The
phone delivers post-NS audio; **the relay will never see the raw mix** [RS]. Caveats: the stand-in is HA's `webrtc-noise-gain` 1.3.0
(pulseaudio `webrtc-audio-processing`), not Chrome's current NS build; studio stems, not a loudspeaker in a room; 6.8 min.

### 2.2 Speech/music/noise classification and audio tagging (question 1b)

| Model | Size / params | Input · window | Classes that matter | CPU (emma, 1 thread) | Licence | py3.14 path |
|---|---|---|---|---|---|---|
| **CED-tiny** (RicherMans; sherpa-onnx export) | 5.5 M params; ONNX int8 6.1 MB | 16 kHz, 64-mel; `feats [B,64,T]` → `prob [B,527]` [V] | AudioSet 527: Speech, Singing, Music, Television, Radio… | **7.3 ms per 3 s** [M] | weights Apache-2.0 (HF `mispeech/ced-tiny`) [V]; training code GPL-3.0 [V] | ✓ ORT / sherpa-onnx 1.13.8 cp314 [M]; **parakeet-server v0.6.0 `--sound-model` (ced.cpp GGUF, q8_0 ≈ 6 MB)** [V] |
| **FireRedVAD-AED** | ONNX 2 390 544 B | 16 kHz, 80-fbank + CMVN; `feat [B,T,80]` → `probs [B,T,3]` [V] | speech · singing · music (frame-level, 10 ms) | **6.8 ms per 3 s** [M] | Apache-2.0 [V] | ✓ ORT + kaldi-native-fbank + kaldiio [M]; non-causal (as its VAD sibling, R98) |
| YAMNet (Google) | 3.7 M weights, 69.2 M multiplies per 0.96 s frame [V README] | 16 kHz, 0.96 s patches, 0.48 s hop [V] | 521 classes (Speech, Singing, Music, Television, Radio) [V class map] | not measured | Apache-2.0 | TF/TFLite; **MediaPipe Audio Classifier = YAMNet** (browser-capable) [R] |
| PANNs (CNN14 / MobileNetV1) | 81 M / ~4.8 M [R] | 32 kHz (16 kHz variants) | AudioSet 527 | not measured | MIT (repo) | torch |
| AST | 87 M [R] | 10.24 s input | AudioSet 527 | heavy | BSD-3 | torch |
| EfficientAT (mn04…) | ~1 M+ [R] | 32 kHz | AudioSet 527 | not measured | MIT | torch |
| inaSpeechSegmenter | CNN (Keras) | broadcast audio | speech / music / noise (+ gender) — **"Singing voice is tagged as music"**; "speech over music … tagged as speech" [V README] | not measured | MIT | **TensorFlow, "does not yet support Python 3.14+"** [V README] |
| Essentia `voice_instrumental` | — | — | voice vs instrumental | — | **models CC BY-NC-SA 4.0**; library AGPL-3.0 [V] | unusable here |

**Measured — which channel discriminates** (§7.3; 2 s windows after WebRTC NS 3 at −20 dBFS; share of windows whose SPEECH score ≥ t) [M]:

| Windows | n | CED-tiny P(Speech) median · ≥0.2 · ≥0.3 · ≥0.5 | FireRed-AED speech median · ≥0.2 · ≥0.3 · ≥0.5 |
|---|---|---|---|
| music with vocals | 180 | 0.022 · 0.11 · **0.03** · 0.01 | 0.075 · 0.32 · 0.23 · 0.09 |
| speech alone | 90 | 0.703 · 1.00 · **1.00** · 0.99 | 0.793 · 1.00 · 1.00 · 0.94 |
| speech + music 3 dB under | 90 | 0.699 · 0.99 · **0.99** · 0.93 | 0.791 · 0.99 · 0.99 · 0.96 |
| speech + music 6 dB under | 90 | 0.714 · 1.00 · **1.00** · 0.94 | 0.807 · 1.00 · 0.99 · 0.97 |
| speech + music 10 dB under | 90 | 0.738 · 1.00 · **1.00** · 0.99 | 0.792 · 1.00 · 1.00 · 0.98 |

And the MUSIC channel, whole 7 s clips: music P(Music) median 0.86 (raw) / 0.83 (post-NS); **speech with music under it 0.61–0.65**;
speech alone 0.003 [M]. FireRed-AED gives the owner-over-music windows speech 0.79 + singing 0.41–0.49 + music 0.90–0.96 [M]. A rule
"reject when music is present" therefore rejects the owner whenever a radio plays; a rule "reject when speech is absent" does not.
**CED-tiny's speech/singing split is the stronger of the two here** (3 % vs 23 % leak at 0.3). Caveats: MUSDB18 includes rap and
spoken passages — some of the 3 % leak may be genuinely speech-like vocals; studio mixes; one tagger window per 2 s segment.

**The tagger cannot help with TV:** a TV's dialogue is Speech (the "Television" class exists but nothing here shows it fires on TV
dialogue through a phone mic) [U].

### 2.3 Speech enhancement, noise suppression, source separation (question 1c)

| Tool | What it targets | Fit | Mark |
|---|---|---|---|
| **Chrome `noiseSuppression`** | WebRTC APM NS at **`kHigh`**: `apm_config.noise_suppression.level = …NoiseSuppression::Level::kHigh` (`media/webrtc/helpers.cc:157-159` @ `f336e20b70a1`); on Android it runs in software in the renderer (R74 §1.3) — a classical statistical suppressor, not a neural one | it keeps every voice (TV, singer) and, per §2.1, can make music MORE speech-like to a VAD | [V] / [M] |
| `voiceIsolation` constraint (Chrome M123) | "a stronger version of the noiseSuppression constraint … only the human voice if detected will be kept"; effective only where a platform effect exists — "currently … limited to a selected number of ChromeOS devices" | no effect on Android: the Android effects mask only ever holds `ECHO_CANCELLER` (R74 §1.3) | [R] (blink-dev Intent to Ship) + [V] R74 |
| RNNoise 0.2 (2024-04-15) | stationary + non-stationary noise; "babble, car, street" demos; 10 ms lookahead; "60x faster than real-time on an x86 CPU"; 48 kHz frames (pipecat resamples to it) | speech-preserving by design — keeps TV and vocals | [R] demo page; [V] pipecat `rnnoise_filter.py` 480 samples @ 48 kHz |
| DeepFilterNet 2/3 | full-band (48 kHz) noise suppression; "only wav files with a sampling rate of 48kHz are supported"; last push 2024-10-17 | speech-preserving; a 48 kHz pipeline in a 16 kHz system; stale | [V] README |
| Demucs / HT-Demucs | music source separation (vocals / drums / bass / other); `facebookresearch/demucs` archived ("not maintained anymore") | would hand the VAD the vocal stem — §2.1 shows that is what makes Silero fire; and the owner is a "vocal" too | [V] README + [RS] |
| ClearerVoice-Studio (Apache-2.0) | SE (FRCRN, MossFormer2), separation; **audio-only target speaker extraction conditioned on reference speech is 8 kHz only** | research toolkit, not a streaming relay stage | [V] README |
| WeSep (wenet-e2e, Apache-2.0) | target speaker extraction toolkit; "Official pretrained models and automatic download — Coming soon"; "ONNX export and inference" unchecked | no usable weights today | [V] README |
| VoiceFilter-Lite (Google, 2020) | streaming targeted voice separation, 2.2 MB, int8; −25.1 % WER on overlapped speech | no public weights | [R] |
| **Krisp BVC / VIVA** (LiveKit, pipecat) | "remove background noise, chatter, and secondary voices, ensuring the retention … of only the primary speaker's voice"; vendor: VAD false-positive triggers "reduced by 3.5x"; demos include TV; no enrolment | proprietary SDK / LiveKit Cloud (paid from May 2026) | [R] Krisp blog (updated 2026-08) + LiveKit docs; [V] pipecat `krisp_viva_filter.py` imports `krisp_audio` |
| ai-coustics Quail / Voice Focus 2.1 | "realtime audio enhancement and speaker isolation" | proprietary | [R] LiveKit docs; [V] pipecat `aic_filter.py` |
| LiveKit NC vs voice isolation | NC "Removes environmental background noise such as traffic, fans, and music while preserving all speech"; voice isolation "Removes competing voices … emphasizing the primary speaker. Optimized for single-speaker scenarios" | proprietary | [R] docs.livekit.io |

**No open, streaming, 16 kHz model removes competing VOICES.** Everything open is speech-preserving; everything that drops secondary
voices is proprietary or unreleased [V/R as tabled]. "Primary speaker" models without enrolment lean on proximity cues — level,
direct-to-reverberant ratio, spectral tilt — that AGC does not erase [RS]; single-channel distance estimation is an active research line
(Neri et al., TASLP 2024, code public; "Single-Channel Target Speech Extraction Utilizing Distance and Room Clues", arXiv 2505.14433)
[R], nothing deployable found.

### 2.4 Target-speaker approaches for ONE known owner (question 1d)

**Speaker-embedding models** (all 16 kHz, 80-dim fbank in; IO via `get_inputs()` [V]; cost = fbank + ORT, one thread, emma Ryzen 7
8745HS [M]):

| Model | Export | Params / file | Out dim | 1 s · 2 s · 3 s · 5 s | Licence |
|---|---|---|---|---|---|
| **3D-Speaker CAM++ (en, VoxCeleb)** | sherpa-onnx `3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx`, `x [N,T,80]` | 29.6 MB | 512 | **14 · 25 · 35 · 55 ms** | Apache-2.0 (ModelScope card + 3D-Speaker repo) [V] |
| **WeSpeaker ResNet34-LM (VoxCeleb)** | sherpa-onnx, `feats [B,T,80]` | 26.5 MB | 256 | **31 · 60 · 90 · 150 ms** | weights CC-BY-4.0 ("follows the license of its … dataset") [V] |
| SpeechBrain ECAPA-TDNN | HF `speechbrain/spkrec-ecapa-voxceleb` | GGUF f32 83.2 MB (parakeet.cpp table) | 192 | not measured | Apache-2.0 [V] |
| NeMo TitaNet small / large | sherpa-onnx exports (40 / 101 MB) | — | 192 | not measured | CC-BY-4.0 (large, HF) [V] |
| WavLM-base-plus-sv | HF (Willow uses it) | ~95 M [R] | 512 | not measured | not stated on the card [U] |
| Resemblyzer (GE2E) | pip | small LSTM | 256 | "around 1000x real-time on a GTX 1080" | Apache-2.0 [V]; "works best on English" |

**Accuracy, measured** (§7.4; LibriSpeech dev-clean, 40 speakers, enrolment = mean of utterance embeddings over ≥ 30 s, tests = random
windows of held-out utterances; 9 360 non-target and 240 target trials per row) [M]:

| Model | 1.0 s | 1.5 s | 2.0 s | 3.0 s | threshold at EER (2 s) |
|---|---|---|---|---|---|
| CAM++ | EER 1.8 % | 0.8 % | 0.8 % | 0.5 % | cos 0.418 |
| ResNet34-LM | 2.1 % | 1.3 % | 0.8 % | 0.5 % | cos 0.397 |

LibriSpeech is clean read speech on one channel per speaker — an optimistic floor. **The field's harder numbers** (VoxCeleb1-O, DAME
arXiv 2601.13999 Table 2, baselines trained on VoxCeleb2): ResNet34 full–full **1.02 %**, 5 s enrol / 1 s test **4.33 %**
(VoxCeleb1-H: 6.57 %); ECAPA-TDNN 1.08 % → 4.84 % [R]. Segments of ≥ 2 s are where it becomes reliable.

**The two failure modes that decide the design** (§7.4, §7.5) [M]:

| Condition (2 s, CAM++ unless noted) | Owner's score vs own enrolment | Interferer alone vs owner's enrolment |
|---|---|---|
| owner alone | median 0.74, p10 0.61 | non-target p99 0.40 |
| owner + another talker at SIR 10 dB | median 0.61, p10 0.42 | other alone: p90 0.28, max 0.37 |
| … at SIR 5 dB | median 0.50, p10 0.23 | p90 0.26, max 0.51 |
| … at **SIR 0 dB** (the ISS-63 level relation) | **median 0.32, p10 0.12** | p90 0.24, max 0.34 |
| owner + music 6 dB under (ResNet34, 3 s) | median 0.68, p10 0.56 | music-with-vocals window, MAX over 10 owners: median 0.15, p90 0.21 (raw) · median 0.17, p90 0.23, max **0.38** (post-NS) |
| owner + music 3 dB under (ResNet34, 3 s) | median 0.65, p10 0.51 | — |
| **channel: enrol wideband, test narrowband** (8 kHz, 300–3400 Hz — an HFP/CVSD stand-in) | EER 0.5 % → **4.6 %**; genuine median 0.74 → **0.48** | non-target p99 0.34 |
| channel: enrol narrowband, test narrowband | EER **3.7 %**; genuine median 0.68 | non-target p99 **0.50** (narrowband pulls voices together) |

Read: a segment that is ONLY the TV, ONLY music or ONLY another person is rejected at any level. A segment where the owner speaks OVER an
equally loud TV is ambiguous to a segment-level score. A different microphone shifts every score: one enrolment per input route.

**Frame-level / conditioned models:**
- **Personal VAD** (Ding et al., Odyssey 2020, arXiv 1908.04284): three classes per frame (non-speech · target · non-target), conditioned
  on the speaker embedding; best model **130 K params**, beats "a baseline system where individually trained standard VAD and speaker
  recognition networks are combined" [R abstract]. **Personal VAD 2.0** (arXiv 2204.03793): streaming, enrolment-less fallback, sized for
  on-device ASR [R]. Short-enrolment follow-up: arXiv 2601.12769 (ICASSP 2026; code at an anonymous link) [R].
- Open implementations: `pirxus/personalVAD` (GPL-3.0, last push 2022-09, thesis; trained models in an ~800 MB download) [V];
  `fclearner/Personal-vad-2.0` (Apache-2.0, 18 stars, pushed 2026-08-26; "includes … a sanitized speaker-aware checkpoint", CAM++
  embeddings, a causal streaming adapter; "does not include … upstream model weights") [V README]. Neither is a maintained artefact.
- Target-speaker identification pipelines from open parts: arXiv 2608.17972 (pyannote / TitaNet-Large / diart; "> 0.90 median accuracy
  with high specificity (0.95-0.98)" at cos thresholds 0.7–0.75) [R].
- **parakeet.cpp v0.6.0** carries a speaker registry: `parakeet-cli enroll --model <speaker.gguf> --name … --registry …`, encoders
  WeSpeaker ResNet34 / CAM++ / ECAPA / ERes2Net via voice-detect.cpp; it NAMES Sortformer diarization slots ("It does not … Resolve
  overlapped speech"; "Learn new voices on the fly. The registry is only changed by enrolling"); starting thresholds 0.5 (WeSpeaker,
  CAM++), 0.7 (ECAPA, whose impostor scored 0.566); "Expect lower genuine scores when enrollment and test audio come from different
  sessions or microphones". **Exposed in the CLI and the C-API, not in `parakeet-server`** (grep of `examples/server/` finds only the
  sound tagger) [V].

**The enrolment, concretely, for ONE owner** [RS from the measurements above]: 30 s of the owner's natural speech per input route (the
phone mic on the call route, the phone mic on media, each Bluetooth headset), recorded in the room they use, averaged into one centroid
per route key. CAM++ embeds 30 s in ~0.35 s of one core. Over-the-air drift (a cold, a whisper) is the known weak point; incremental
re-centring from ACCEPTED segments is the parakeet.cpp and Willow-style registry's opposite (both are enrol-only) [V].

### 2.5 ASR-side acceptance (question 1e)

| Signal | Evidence | Fits trial |
|---|---|---|
| Whisper `no_speech_prob` / `avg_logprob` / `compression_ratio` | the faster-whisper/pipecat filters (R76 §4; pipecat `no_speech_prob < 0.4`) — **our ear is Parakeet, which has none of them** (R76 §2) | — |
| Parakeet per-word confidence | `parakeet-server` emits `words[].conf` (NeMo `Word.conf`) when `timestamp_granularities[]=word` — **already in v0.5.0** (`89f5e297`, 2026-06-23) [V]; parakeet.cpp's own opt-in word filter (`min_local_conf` 0.5) "removes hallucinated words on Ultra, Redux and RNN-T models at no cost in WER on clean speech. **On v3** and on CTC models … it also removes real words" [V doc]; R92: onnx-asr logprobs do not separate a real "No." from fillers | ISS-58-type fragments at best; lyrics and TV dialogue are confidently recognised real words [RS] |
| Word timestamps → speech rate / chars per voiced ms | measured above: the owner's 55–101 ms/char sits inside the music's 8–197 | ISS-58 only |
| Language identity of the text | Parakeet v3 auto-detects; `parakeet-server` reports a fixed `"language":"en"` placeholder [V `openai_format.cpp`] | ISS-63 *only because* the TV was Spanish and the owner speaks English; whether the TV finals came back as Spanish text is not recorded [U] — incidental, not a discriminator |
| Closed vocabulary | HA's speech-to-phrase: "Instead of answering the question 'what did the user say?', it answers 'which of the phrases I know did the user say?'" [V README] | not for open conversation |
| Device-directedness | Amazon "Device-directed Utterance Detection" (arXiv 1808.02504): acoustic + ASR-decoder + 1-best LSTMs, **EER 5.2 %** combined (acoustic alone 10.9 %); LLM-based follow-up DDSD (arXiv 2411.00023) [R] | research; trained on device logs we do not have |

### 2.6 Microphone and transport — only what a browser reaches (question 1f)

- **AGC:** Chrome Android's `autoGainControl` = a fixed +6 dB (R83, re-read for ISS-63) — not re-bought. [V via R83]
- **NS:** WebRTC NS at `kHigh`, software, before the context (above). The A/B the plan already names (R94 §8) gains a second reason: NS
  as a vocal-extractor for music (§2.1). [V]/[M]
- **Input preset:** with platform AEC Chromium opens `AAUDIO_INPUT_PRESET_VOICE_COMMUNICATION`, else `…_GENERIC`; it never uses
  `UNPROCESSED`; `VOICE_RECOGNITION` is not reachable from a page (R77 §1.6). [V via R77]
- **`voiceIsolation`:** ChromeOS-only in practice; no Android platform effect to bind to. [R]/[V R74]
- **Bluetooth headsets:** in HFP the headset runs its own NR/AEC and, on many models, beamforming or a bone-conduction (VPU) voice
  sensor that keys on the wearer — the ISS-63 headset evidently did not separate the TV (both in one band) [RS from the trail]; narrowband
  HFP also moves every speaker-embedding score (§2.4). None of the headset's processing is visible or controllable from the page. [R/U]
- **Home Assistant's default** for its own WebRTC NS/AGC stage is OFF: `AudioSettings.noise_suppression_level: int = 0`,
  `auto_gain_dbfs: int = 0` (`assist_pipeline/models.py:136-139`) [V].

---

## 3. What the peer class does (question 2)

| Peer | Speech vs silence | Speech vs music | The USER's voice vs other voices | Mark |
|---|---|---|---|---|
| Home Assistant Assist | `VoiceCommandSegmenter` (R92 §V) + optional WebRTC NS/AGC, both default 0 | no | **no** — the only "speaker" in `assist_pipeline`/`wyoming` is the TTS voice's `ATTR_SPEAKER` | [V] |
| HA speech-to-phrase | closed-vocabulary decoder | — | indirectly: a TV rarely says a known command | [V] |
| Wyoming satellite / Rhasspy | Silero gate before streaming (R92) | no | no | [V via R92] / [U] Rhasspy 3 |
| **Willow Inference Server** | client-side (ESP-SR) | no | **yes, opt-in:** `support_sv: False`, `sv_threshold: 0.75`; per request `voice_auth`; WavLM-base-plus-sv x-vector vs every `speakers/voice_auth/*.npy`; no match → `PlainTextResponse("Unauthorized voice", status_code=406)` (`main.py:797-870, 1324-1336`) | [V] |
| OVOS (dinkum listener) | VAD plugins | no | an `audio_transformers` seam exists; one third-party plugin (`ovos-audio-transformer-plugin-omva-voiceid`, ECAPA, 0 stars) labels speakers | [V] seam / [R] plugin |
| open-webui call mode | analyser band −55…−30 dB, any non-zero bin (R85) | no | no | [V via R85] |
| LibreChat | external STT; silence = `getByteFrequencyData` any bin > 0, 3000 ms (`useSpeechToTextExternal.ts:164-190`); its level meter asks AGC/NS/EC **false** | no | no | [V] |
| SillyTavern STT extension | `vad.js` (Kelly Davis 2015): adaptive energy offset ×2 / ×0.5 | no | no | [V] |
| vocode | transcriber-driven endpointing | no | no | [V clone] / R92 |
| pipecat | Silero + `min_volume`; Smart Turn | no | only via **proprietary** filters (`KrispVivaFilter`, `AICFilter`, Picovoice `KoalaFilter`) or Speechmatics `known_speakers`; open filter = RNNoise (48 kHz) | [V] |
| LiveKit Agents | Silero; turn detector | no | Krisp NC/BVC/BVCTelephony (LiveKit Cloud); Speechmatics adapter: `focus_speakers`/`ignore_speakers`/`focus_mode` now dropped — "`SpeakerFocusMode` is not supported by Agent STT … expected to be reintroduced in a future release" (`speechmatics/stt.py:82-85`) | [V] |
| OpenAI Realtime | `server_vad` / `semantic_vad`; `input_audio_noise_reduction` `near_field` / `far_field` (R92) | no | no (near/far field is a proximity filter, not identity) | [V via R92] |
| Deepgram | diarization: anonymous per-request labels, "no memory across requests" | no | no voiceprint product found | [R] |
| AssemblyAI "Speaker Identification" | — | — | "Uses conversation content to infer who's speaking … no voice enrollment needed" — names from TEXT, pre-recorded | [R] |
| Krisp / ai-coustics (as products) | — | music suppressed | primary-speaker isolation without enrolment | [R] |
| Google Voice Match / Alexa Voice ID | wake word + cloud | — | **personalises, does not filter**: "If there's no match, the device treats the query as a guest query and won't provide personal results" | [R] |
| Amazon follow-up mode | device-directed detector (acoustic + ASR + lexical), EER 5.2 % | — | targets "is it meant for me", not "is it this person" | [R] |

**Verdict:** in the open peer class a user-voice gate exists exactly once (Willow), as an authentication feature, segment-level, off by
default. Nobody open ships an owner-voice gate for a live call; the commercial field ships enrolment-FREE primary-speaker isolation instead.

---

## 4. Corrections to premises we held

1. **"Silero fired on sung vocals, so Silero does not reject music."** Half right. The maintainers never trained on music (#565) and
   list voice-like music as a known v6 issue [V] — but on studio mixes v5 and v6.2 stay quiet; it is the **noise suppressor in front**
   that makes them fire (0.6–0.9 → 5.0–5.7 confirmed segments/min) [M]. The relay will run v6.2 on post-NS audio, so the trial-3 class
   survives the VAD swap [RS].
2. **"chars-per-voiced-ms could catch hallucinations"** (ASR_PLAN §3.6 candidate). It catches text from near-silence (ISS-58: 9 vs
   50–60); it does not catch lyrics (trial 3 overlaps entirely) [M].
3. **"A music detector would fix the music case."** Only if it reads the SPEECH class: P(Music) is 0.61–0.65 when the owner talks over
   music [M].
4. **"`learnVoice`'s guard keeps an interferer from teaching the gate."** Not when the noise floor is low: the bar is noise-anchored
   (≈ −45 dBFS here), the interferer voice-anchored (−11…−20) [V/M].
5. **"The parakeet-server we pin has no hooks for this."** v0.5.0 already returns per-word confidence; v0.6.0 (2026-10-05) adds a CED
   sound tagger on the same request and (CLI/C-API only) a speaker registry [V].
6. **"Speaker verification solves the TV."** It solves TV-ONLY segments at any level; owner-over-TV at equal level is borderline (median
   0.32 against a ~0.4 threshold) [M]. Frame-level methods (pVAD, extraction) are the only fix for overlap, and none is deployable open.
7. *(Bookkeeping)* the ISS-63 trail holds 28 `final` lines (21 with text), not 30 [V].

---

## 5. Implications for ctrl-b — OUR READING (ages fast; nothing here is decided)

### 5.1 Where a discriminator can sit

| Stage (ASR_PLAN) | Sees | Can host | Latency it adds |
|---|---|---|---|
| Client (phone) | pre-transport, post-NS PCM; levels | the level gate (today); a tagger in-browser (MediaPipe/YAMNet) [R]; constraint changes (NS off) | none server-side; battery |
| Relay VAD stage (§3.4, `VadModel`) | 32 ms hops, causal only | a frame-level pVAD (none open); Silero v6.2 | must stay < hop |
| **Pre-ASR pass (§3.6)** | the whole finished segment, any lookahead, `to_thread` | **speaker verification (CAM++ 25–35 ms per 2–3 s), a tagger (7 ms per 3 s), FireRed-AED** — all non-causal-safe | tens of ms, before a ~hundreds-of-ms ASR call |
| ASR response | text, `words[].conf`, `sound_events` (v0.6.0) | confidence, speech-rate, the tagger via `--sound-model` | free with the call |
| Turn assembly / hold (client) | finals | the learner rule; "don't restart the hold on a rejected final" | — |

### 5.2 Each candidate against the three trials

| Candidate | ISS-58 (6–8 dB-under fakes, source unknown) | ISS-63 (TV, same level) | Trial 3 (music with vocals, 3–10 dB under) |
|---|---|---|---|
| Level gate, any margin | margin 5 would catch them | **cannot** (same band) | cannot once poisoned; even unpoisoned (V −9.5, floor −19.5) most music finals (−11…−18) pass |
| Silero v6.2 at the relay | unknown | **cannot** (TV is speech) | fires post-NS (5/min measured) — partial |
| chars-per-voiced-ms | catches the 9 ms/char fake | no labels | **cannot** (overlap) |
| Parakeet word confidence | maybe (fragments) | no (real words) | no (real words) |
| Tagger P(Speech) (CED-tiny) | unknown (room sound vs speech) | **cannot** | **yes** — 3 % leak, ~0–1 % owner loss on the synthetic set |
| Speaker verification, per-route enrolment | yes if it was another voice or a TV; no if it was the owner muttering | **yes for TV-only segments; borderline for owner-over-TV** | **yes** (music max 0.38 vs ~0.4 — thin margin; the tagger is the sturdier tool here) |
| pVAD / target-speaker extraction | yes | **yes, incl. overlap** — the only family that is | yes |
| Primary-speaker isolation (Krisp-class) | likely | likely (proximity cues) — proprietary | partly (music suppressed) |

**Plainly: ISS-63 cannot be solved by any level, VAD, tagger or text approach.** Only a speaker-aware model (SV / pVAD / extraction) or
a proprietary primary-speaker isolator separates an equally loud TV; and only the frame-level speaker-aware family handles the owner
speaking OVER it. Trial 3 needs either the tagger or SV; ISS-58 is the one a level or density rule can still reach.

### 5.3 The learner-poisoning loop — a finding for the plan

Whatever discriminator lands, **`learnVoice` (and any future learner) must learn only from finals the discriminator accepted**, and a
rejected final must not restart the turn hold. Today's guard is noise-anchored and cannot see a voice-anchored interferer (§1). The same
applies to any SV score drift or tagger threshold that might "adapt": learn from accepted, never from taken-by-default.

### 5.4 Cost and licences on the relay host

emma = Ryzen 7 8745HS 8C/16T + a Radeon 780M iGPU (no discrete GPU) [V `lscpu`/`lspci`]. Per 2–3 s segment on ONE thread: CAM++
25–35 ms, CED-tiny 7 ms, FireRed-AED 7 ms [M] — all inside the plan's pre-pass worker (`to_thread`), none on the `vad` executor.
Models: CAM++ 29.6 MB (Apache-2.0), CED-tiny 6.1 MB int8 (Apache-2.0 weights), FireRed-AED 2.4 MB (Apache-2.0); WeSpeaker weights
need CC-BY-4.0 attribution; Essentia (NC) and Krisp/ai-coustics (proprietary) are out. Runtime: the `voice` extra's `onnxruntime` +
`numpy` + `kaldi-native-fbank` (cp314 wheel, already R98's FireRed dependency); or parakeet-server v0.6.0's `--sound-model` for the tagger
with no new Python dependency (a plan pin bump v0.5.0 → v0.6.0, its own decision).

### 5.5 Top 3 candidate designs (ranked; the main seat and the owner rule)

1. **Owner verification on the pre-ASR pass, one enrolment per input route.** CAM++ (Apache-2.0) embedding of the segment vs the
   route's centroid; reject below a calibrated threshold; ALSO score 1 s sub-windows and accept on the max, so an owner-over-TV segment
   with owner-dominant stretches survives [RS]. *Buys:* TV-only, music-only and other-talker segments at any level — the one design that
   reaches ISS-63. *Costs:* an enrolment flow (30 s × each route: phone-call, phone-media, each headset — the ISS-64 key problem
   again); a per-route threshold (narrowband pulls impostors to 0.50); a borderline zone for owner-over-equal-level-TV; segments < 1 s
   ("Yeah.") are weak (1.8 % EER clean, ~4–5 % on wild data) — pair with the existing short-final rules; a biometric template on disk
   (SECURITY_MODEL entry). *Debt:* a new subsystem (enrol UI + store + threshold), but on the existing pre-pass seam.
2. **Speech-vs-singing tagger on the pre-ASR pass, no enrolment.** CED-tiny P(Speech) on the segment (0.3 measured; calibrate on the
   owner's corpus), or the AED speech channel; reject "no speech". *Buys:* trial 3's whole class with no user action, robust to NS,
   ~7 ms. *Costs:* nothing for TV or other talkers; rap / spoken-word vocals leak; one more model (or the parakeet-server v0.6.0 pin
   bump and its `sound_events`). *Debt:* minimal — a scalar acceptance beside the existing `no_speech` outcome.
3. **The capture + learner pair (cheapest, partial).** (a) An NS-off A/B on the call route at the `micConstraints` chokepoint — NS is
   what turns music into vocal-like input for the VAD (§2.1), and Silero v6.2 handles stationary noise itself (R98); risk: car/road
   noise reaches the ear unsuppressed. (b) The §5.3 learner rule regardless of what else lands. *Buys:* fewer music segments reaching
   ASR; no poisoning spiral. *Costs:* does nothing for TV; the NS-off half is a hypothesis until a same-room call says otherwise.

①+② compose (one embedding + one tagger call per segment, ~40 ms). The named exit for overlap is a frame-level personal VAD at the relay
VAD stage — the `VadModel` boundary already admits a "probability per hop" model — when an open, maintained pVAD exists [RS].

---

## 6. What I could not determine

1. What ISS-58's 9 s of low-level sound was (soft speech, a neighbour, room sound) — it decides whether SV would have rejected it.
2. Whether the ISS-63 TV finals came back as Spanish text (no transcript text is recorded — by design).
3. How a real loudspeaker + room + Honor 20 mic + Chrome's current NS change §2.1's numbers (studio stems + a pulseaudio-era WebRTC NS
   stand-in were measured).
4. The owner's Bluetooth headset's codec (CVSD narrowband vs mSBC wideband) and its own NR/beamforming — it sets which channel row of
   §2.4 applies.
5. CED-tiny's P(Speech) on the owner's real short finals (< 1 s), and on spoken-word / rap music.
6. Whether `parakeet-server --sound-model`'s `SoundStream` defaults (3 s window, 1 s hop, on 0.4 / off 0.3, `min_duration` 0.3 s)
   yield a usable Speech event on 1–2 s segments (padding behaviour unread).
7. Speaker-embedding behaviour on the owner's voice through NS + AGC + comm-mode processing, and on a whisper/cold.

## 7. Method (reproducible; all on emma, 2026-10-06, Python 3.14.4, onnxruntime 1.30.0, one thread `intra_op=1`)

1. **Trails** — `json.loads` per line; only `final` (`peakDb`, `chars`, `accruedMs`, `floor`), `sample` (`voiceLevel`, `floor`, `noise`)
   and `capture` fields read. No text exists in the trails.
2. **Silero on music** — MUSDB18-7 (Zenodo 3270814): 60 shuffled tracks with a vocal stem above −35 dBFS RMS; stream 0 = mixture,
   4 = vocals, decoded and resampled to 16 kHz mono with PyAV; Silero v5.1.2 (sha256 `2623a295…`) and v6.2 (`1a153a22…`, = the plan's
   pins) run window by window `[1, 64+512]` with carried state; policy as stated in §2.1; NS stand-in = `webrtc-noise-gain` 1.3.0
   `AudioProcessor(0, 3)` on 10 ms int16 frames (its `is_speech` = WebRTC's legacy VAD); levels set by RMS.
3. **Taggers** — CED-tiny via `sherpa_onnx.AudioTagging` (int8 ONNX, top-k 40, missing class = 0); FireRed-AED via ORT with FireRed's
   own fbank (kaldi-native-fbank, 25/10 ms, 80 bins, snip-edges, int16 scale) + `cmvn.ark` (kaldiio), mean frame probabilities.
   "Speech + music r dB under" = LibriSpeech clip + mixture scaled to clip RMS + r dB, then NS.
4. **Speaker verification** — LibriSpeech dev-clean (40 speakers, shuffled with seed 0); enrolment = mean of per-utterance embeddings
   until ≥ 30 s; tests = up to 6 held-out utterances per speaker, one random window each; every test scored against all 40 centroids;
   EER by threshold sweep. Features: kaldi fbank 80, dither 0, per-segment mean subtraction (WeSpeaker int16 scale, CAM++ float scale per
   the sherpa metadata `normalize_samples`). Overlap: two speakers' 2 s windows mixed at the stated SIR (RMS).
5. **Channel** — PyAV 16 → 8 kHz, FFT mask 300–3400 Hz, PyAV 8 → 16 kHz; CAM++; 2 s windows.
6. **Cost** — mean of 10–20 runs after a warm-up, fbank included.

All clones, models, corpora and the venv lived under `~/.cache/tmp/ctrlb-session61/clones/r101/` and were deleted at the end.

## Sources

- silero-vad: issues [#565](https://github.com/snakers4/silero-vad/issues/565), [#369](https://github.com/snakers4/silero-vad/issues/369),
  [#663](https://github.com/snakers4/silero-vad/issues/663), [#563](https://github.com/snakers4/silero-vad/issues/563),
  [#121](https://github.com/snakers4/silero-vad/issues/121); releases [v6.0](https://github.com/snakers4/silero-vad/releases/tag/v6.0),
  [v6.2](https://github.com/snakers4/silero-vad/releases/tag/v6.2), [v6.2.2](https://github.com/snakers4/silero-vad/releases/tag/v6.2.2)
- TEN VAD issue [#29](https://github.com/TEN-framework/ten-vad/issues/29)
- FireRedVAD [`c30ec49`](https://github.com/FireRedTeam/FireRedVAD) — `README.md`, `fireredvad/aed.py`, `fireredvad/core/audio_feat.py`,
  `pretrained_models/onnx_models/fireredvad_aed.onnx`; report arXiv [2603.10420](https://arxiv.org/abs/2603.10420)
- parakeet.cpp [`9a28a3c`](https://github.com/mudler/parakeet.cpp) — `examples/server/main.cpp`, `examples/server/openai_format.cpp`,
  `src/sound_stream.hpp`, `docs/speaker.md`, `docs/sound.md`, `docs/vad.md`, `AGENTS.md`; releases v0.5.0, v0.6.0; commit `89f5e297`
- Chromium `media/webrtc/helpers.cc` @ `f336e20b70a1`; blink-dev [Intent to Ship: VoiceIsolation](https://groups.google.com/a/chromium.org/g/blink-dev/c/hPMvCu-3iPA)
- YAMNet [README](https://github.com/tensorflow/models/tree/master/research/audioset/yamnet) + `yamnet_class_map.csv`
- CED [repo](https://github.com/RicherMans/CED) (GPL-3.0 code) · [mispeech/ced-tiny](https://huggingface.co/mispeech/ced-tiny) (Apache-2.0) ·
  sherpa-onnx `audio-tagging-models` / `speaker-recongition-models` release assets
- [inaSpeechSegmenter](https://github.com/ina-foss/inaSpeechSegmenter) README · [Essentia models](https://essentia.upf.edu/models.html)
- RNNoise [demo](https://jmvalin.ca/demo/rnnoise/), [v0.2](https://github.com/xiph/rnnoise/releases/tag/v0.2) · [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) ·
  [Demucs](https://github.com/facebookresearch/demucs) · [ClearerVoice-Studio](https://github.com/modelscope/ClearerVoice-Studio) ·
  [WeSep](https://github.com/wenet-e2e/wesep)
- Krisp [BVC for voice agents](https://krisp.ai/blog/improving-turn-taking-of-ai-voice-agents-with-background-voice-cancellation/) ·
  LiveKit [noise & echo cancellation](https://docs.livekit.io/transport/media/noise-cancellation/)
- Personal VAD [arXiv 1908.04284](https://arxiv.org/abs/1908.04284) · PVAD 2.0 [arXiv 2204.03793](https://arxiv.org/abs/2204.03793) ·
  short-enrolment PVAD [arXiv 2601.12769](https://arxiv.org/abs/2601.12769) · VoiceFilter-Lite [arXiv 2009.04323](https://arxiv.org/abs/2009.04323) ·
  [pirxus/personalVAD](https://github.com/pirxus/personalVAD) · [fclearner/Personal-vad-2.0](https://github.com/fclearner/Personal-vad-2.0)
- Short-duration SV: DAME [arXiv 2601.13999](https://arxiv.org/abs/2601.13999) Table 2 · target-speaker ID [arXiv 2608.17972](https://arxiv.org/abs/2608.17972) ·
  foreground VAD [arXiv 2609.19856](https://arxiv.org/abs/2609.19856) · distance estimation [arXiv 2403.17514](https://arxiv.org/abs/2403.17514),
  [arXiv 2505.14433](https://arxiv.org/abs/2505.14433) · device-directed [arXiv 1808.02504](https://arxiv.org/abs/1808.02504), [arXiv 2411.00023](https://arxiv.org/abs/2411.00023)
- Speaker models: [speechbrain/spkrec-ecapa-voxceleb](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb) · [WeSpeaker pretrained licence](https://github.com/wenet-e2e/wespeaker/blob/master/docs/pretrained.md) ·
  [3D-Speaker](https://github.com/modelscope/3D-Speaker) · [Resemblyzer](https://github.com/resemble-ai/Resemblyzer)
- Peers at the SHAs in the table: pipecat (`audio/filters/*`, `services/speechmatics/stt.py`), LiveKit Agents
  (`livekit-plugins-speechmatics/…/stt.py`, `README.md`), HA core (`assist_pipeline/models.py`, `wyoming/const.py`), Willow Inference
  Server (`main.py`, `settings.py`), OVOS dinkum (`transformers.py`), LibreChat (`useSpeechToTextExternal.ts`, `useAudioLevels.ts`),
  SillyTavern STT (`vad.js`), [speech-to-phrase](https://github.com/OHF-Voice/speech-to-phrase) README,
  [omva-voiceid plugin](https://github.com/ecosphereplus/ovos-audio-transformer-plugin-omva-voiceid)
- Vendors / consumer: [AssemblyAI speaker identification](https://www.assemblyai.com/docs/speech-understanding/speaker-identification) ·
  [Deepgram diarization](https://developers.deepgram.com/docs/diarization) · [Google Voice Match](https://support.google.com/assistant/answer/9071681)
- Test data: [LibriSpeech dev-clean](https://www.openslr.org/12) · [MUSDB18-7](https://zenodo.org/records/3270814)
- Our own: `frontend/src/lib/levelGate.ts`, `backend/app/config.py:850-862`, ASR_PLAN §3.1/§3.4/§3.6/§3.7/§3.9/§4, ISSUES ISS-58/63/64,
  R74, R76, R77, R83, R85, R92, R98
