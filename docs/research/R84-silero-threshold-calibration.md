# R84 — Silero calibration: what the field sets, how the probability behaves on car audio, and whether 0.9 is the cut-off

**Date: 2026-09-24 · Confidence: the field's numbers are VERIFIED at pinned source/official docs; the
behaviour of Silero on narrowband / noisy / noise-suppressed / quiet audio is VERIFIED by first-party
probes on emma, but on SYNTHETIC degradations of studio speech — not on the owner's phone or car.**

**Question (one):** what do shipped stacks set for Silero threshold / silence / min-speech / prefix
padding / volume corroboration, and why; how does Silero's probability behave on narrowband HFP audio,
on noise-suppressed audio, and on quiet vs loud speech; and is our `vad_threshold` 0.9 defensible, or
is it itself causing the car's cut-offs? What should the in-call **Speech** slider's range and default
be, and how should the Silero threshold co-vary with an energy floor if one dial drives both?

**Occasion:** the owner's 2026-09-24 car round (HFP route): finals dropped "too quiet", cut-offs, worse
transcription; plus home false turns. **Builds on:** [`R76`](R76-noise-hallucination-gating.md) §1
(the closed server-knob inventory, speaches' 3 s rescan, `neg = thr − 0.15`), §2.1 (level invariance —
quiet speech peaks 0.954), §4 (the field's gating patterns) — cited, not re-reported. R70 §1.1 (the 3 s
endpoint floor). **Drove:** (open). **Siblings this pass:** R82 (single dial), R83 (portable floor),
R85 (hermes/open-webui).

**Reference class:** the live-voice frameworks (livekit/agents · pipecat · RealtimeSTT · OpenAI
realtime), Silero itself, our ear (speaches), plus faster-whisper, hermes-agent, AssemblyAI's LiveKit
guide and SpeechBrain for the co-variation question.

---

> ### Headline
>
> **① 0.9 is an outlier, and it is plausibly causing the car's cut-offs — through the END threshold,
> not the silence window.** [V source + V probe] Every other stack sets the start threshold at
> **0.3–0.7** (Silero/faster-whisper/OpenAI/LiveKit 0.5, pipecat 0.7, RealtimeSTT 0.6, AssemblyAI's
> LiveKit guide 0.3). Only speaches ships 0.9 — set in its first realtime commit with no rationale,
> while the same commit's type default mirrored OpenAI's 0.5. At 0.9 the utterance ends on any
> ≥ `silence_ms` run whose frames stay below **0.75** (and only a frame ≥ 0.9 clears the timer).
> Replaying speaches' exact realtime flow on quiet narrowband speech, **premature end-of-utterance
> events at silence 700 ms: 12 at thr 0.9 · 12 at 0.7 · 4 at 0.6 · 4 at 0.5**; lengthening the
> silence to 1000 ms does **not** help at 0.9 (14) but does at 0.6 (1).
>
> **② The threshold barely moves ADMISSION of the things that bother the owner at home.** [V probe]
> Speech-like interferers (reverberant far speech at RMS 0.003) open utterances at every threshold
> 0.5–0.9; broadband/car noise, clatter, typing and tones open none at any threshold. What 0.9 alone
> suppresses is a **speaches artefact**: its VAD re-runs the last 3 s *from a zeroed RNN state* on every
> 40 ms append, so the first frame of a fresh window can spike (a 120 Hz hum: 0.898 at frame 0) and
> ~75 rescans of the same audio make the max a multiple-comparison draw. Those false starts transcribe
> to `""` (R76 §2.2) and are already dropped.
>
> **③ Silero is near level-invariant on purpose; the level gate is the only proximity signal.**
> [V maintainer] *"there is no real criterion to distinguish foreground and background speech — loudness
> is not an option because audio can be non-normalized or just quiet as an input"* (silero-vad #687).
> No stack couples a Silero threshold to a level gate through one dial; pipecat ANDs two **fixed,
> independent** floors.
>
> **④ Recommended shape: hold Silero fixed near 0.6, let the user move only the level/SNR margin.** If
> a Silero slider survives at all, its sane range is **0.5–0.8**, default **0.6**; the current slider's
> 0.05–0.95 span is mostly meaningless (§5).

---

## 0. Sources, pinned

| Source | Pin | Read |
|---|---|---|
| snakers4/silero-vad | `5cd79456` (HEAD 2026-09-23 = tag v6.2.3); model files at tags **v5.1.2** and **v6.2** | `src/silero_vad/utils_vad.py`, `tuning/`, README, releases v6.0/v6.2, issues #366 #606 #637 #685 #687 #798 |
| silero-vad wiki | `959929d` (2026-03-26) | FAQ, Quality-Metrics (+ history for the 8 k chart) |
| speaches — the owner's fork (served) | `fdc6a27`; upstream `speaches-ai/speaches` `993994f` (2026-04-18) — **no VAD change since** (GitHub API, today) | `executors/silero_vad_v5.py`, `realtime/input_audio_buffer_event_router.py`, `realtime/session.py`, `audio.py`; `git log -S` → `2068a02` |
| livekit/agents | `98ed3e85` (2026-09-25 UTC) | `livekit-plugins-silero/…/vad.py`, `utils/exp_filter.py`, `voice/turn.py`; bundled ONNX LFS oid |
| pipecat-ai/pipecat | `4471fe83` (2026-09-24) + commits `a5fc2b1650`, `e9057a9ab8` via API | `audio/vad/vad_analyzer.py`, `audio/vad/silero.py`, `audio/utils.py`, `audio/volume.py`, `transports/base_input.py` |
| KoljaB/RealtimeSTT | `77772755` (2026-09-17) | `docs/configuration.md`, `RealtimeSTT/audio_recorder.py` docstrings |
| faster-whisper | 1.1.1 (speaches venv) | `vad.py` `VadOptions` |
| hermes-agent (read-only checkout) | `cc23b725` (2026-09-15) | `hermes_cli/config_defaults.py`, `tools/transcription_local.py` |
| Official docs, fetched today | docs.livekit.io `agents/logic/turns/vad` · assemblyai.com `voice-agents/livekit-universal-3-5-pro` · SpeechBrain VAD tutorial | WebFetch |
| OpenAI Realtime `server_vad` | via R76 §4.5 (verified 2026-09-21) | cited |
| Vendor blog, secondary | edesy.in `docs/voice-agent/pipeline/vad` | [R] |

**Probes** (throwaway, `~/.cache/tmp/research/r84-probe/`, deleted after): speaches' **own** module
(`get_speech_timestamps`, the split v5 encoder/decoder from faster-whisper's assets, its
`resample_audio_data`) imported in its venv; the served service was not touched. The split model equals
Silero **v5.1.2** ONNX to 5 × 10⁻⁷ (checked). Speech: five studio voice clips from the TTS voice
library (≈ 66 s, **all female**). Degradations at 16 kHz: *nb* = 300–3400 Hz band-pass → 8 kHz →
µ-law (a narrowband-codec proxy; **CVSD/mSBC not modelled**) → back to 16 kHz; *car* = low-frequency
noise at a stated speech-to-noise ratio; *NS* = a crude STFT Wiener suppressor (−20 dB floor) — **not**
Chrome's WebRTC NS. "Premature" = an end event whose preceding `silence_ms` window still held ≥ ~100 ms
of speech in the clean reference. The flow replay reproduces speaches exactly: 16 k → 24 k wire →
per-40 ms `np.interp` → 3 s window rescan → its stop rule.

---

## 1. Silero itself [V, `5cd79456`]

* **Start/end semantics.** `threshold` is the START threshold. The end/"negative" threshold is
  `threshold - 0.15` in `VADIterator` (`if (speech_prob < self.threshold - 0.15) and self.triggered`,
  `utils_vad.py:671`) and `max(threshold - 0.15, 0.01)` in `get_speech_timestamps` (`:475-476`,
  docstring: *"Negative threshold (noise or exit threshold). If model's current state is SPEECH, values
  BELOW this value are considered as NON-SPEECH"*). **The silence timer (`temp_end`) is cleared only by
  a frame `>= threshold`** (`:485`, `:663`) — a frame between the two thresholds neither ends
  nor rescues the segment.
* **Defaults and "why":** `threshold 0.5` — *"It is better to tune this parameter for each dataset
  separately, but "lazy" 0.5 is pretty good for most datasets"*; `get_speech_timestamps`:
  `min_speech_duration_ms 250`, `min_silence_duration_ms 100`, `speech_pad_ms 30`,
  `min_silence_at_max_speech 98`; `VADIterator`: `min_silence_duration_ms 100`, `speech_pad_ms 30`, no
  min-speech. FAQ: *"for majority of use cases no tuning is necessary by design, a good start would be
  to plot probabilities, select the threshold, min_speech_duration_ms and min_silence_duration_ms."*
  The official tuning kit (`tuning/search_thresholds.py` → `utils.calculate_best_thresholds`)
  grid-searches an **enter/exit pair** on 20 × 20 steps against labelled data by per-frame accuracy —
  i.e. Silero's own answer is "calibrate both thresholds on your domain".
* **Sample rates.** 8000 and 16000 Hz only (multiples of 16 k are decimated); windows 256 / 512
  samples (32 ms either way), context 32 / 64. The model is **two heads** — *"one for 8 kHz, one for
  16 kHz"* (FAQ) — and the tuning kit fine-tunes them separately (`tune_8k`). The only published
  8-vs-16 k comparison (wiki chart, 2021-era model) shows near-identical precision/recall.
  Speaches always runs the **16 k head** on 16 k audio; HFP narrowband therefore reaches it as 16 k audio
  with an empty 4–8 kHz band.
* **Versions.** v5 (2024-06), v6.0 (2025-08: *"16% less errors on noisy real-life data"*), v6.2
  (2025-11: *"Significant quality improvements on … Muted voices · Muted speech · Lower quality phone
  calls"*, closing #606 *"performs poorly on some narrow band audio data"*). Wiki noise-only accuracy
  (share of noise files NOT flagged as speech): v5 **0.61 / 0.44** (ESC-50 / private noisy calls) vs v6
  **0.87 / 0.71**. Speaches runs v5; LiveKit bundles **v6.2** (LFS oid `1a153a22…` = the v6.2 tag's
  file); pipecat bundles **v6.0** (`597d30b3…`). #685: v6 probability distributions can sit lower than
  v5's for the same audio — the maintainer's answer is *"basic threshold and hyper-parameter tuning is
  required for any VAD model"*. **A version swap is a re-calibration event.**
* **Foreground vs background, level.** #687 (maintainer, 2025-09-24): *"not designed for far-field
  speech per se · emphasis in the latest release was to suppress background speech … loudness is not an
  option because audio can be non-normalized or just quiet … in a streaming scenario it is difficult to
  normalize."* #366 (a user at **0.85** on 8 kHz telephony) reports the static threshold failing for
  *"a large amount of background noise"* and *"a quiet environment but the speaker is also very quiet"*;
  no maintainer answer. #452: *"Is there a method … to filter out noise that is not human voice?"* —
  *"No."* #637: zero-valued "priming" input shifts later probabilities (maintainer: model trained on
  files starting with non-speech) — state history matters.
* **Nothing published** on noise-suppressed input or AGC [V: repo, wiki and issues searched].

## 2. Speaches — how the ear maps our two fields [V, `fdc6a27` = upstream `993994f`]

* `vad_detection_flow` runs `get_speech_timestamps` over **the last 3 s** on every append with
  `VadOptions(threshold=…, min_silence_duration_ms=silence_duration_ms, speech_pad_ms=prefix_padding_ms)`
  — `neg_threshold` defaults, `min_speech_duration_ms` stays **0**, pad is 0 (R76 §1.2). It is **not**
  a `VADIterator`: `SileroVADModel.__call__` starts every call from `state = np.zeros(...)`. Silero's FAQ:
  *"Do models keep state, should chunks be sent sequentially? Yes."*
* Input: pcm16 at 24 kHz, resampled per append to 16 kHz by `np.interp` (linear, no anti-alias filter).
  Measured harmless for Silero (max probability within 0.04 of a proper polyphase resampler, threshold-crossing shares unchanged, on every probe signal).
* **The 0.9 default:** `realtime/session.py` `TurnDetection(threshold=0.9, prefix_padding_ms=0,
  silence_duration_ms=550)` was introduced in `2068a02` "feat: add realtime API" (2025-02-13); the same
  commit's own `TurnDetection` model defaulted `threshold: float = 0.5` with OpenAI's docstring. No
  issue, PR text or comment explains 0.9 (issues searched: threshold / vad / server_vad /
  turn_detection). **Inference [U]:** §3's zero-state spikes are the kind of thing a developer would
  paper over by raising the threshold.

## 3. What the probes show [V probe, synthetic]

### 3.1 The probability on degraded speech (share of speech frames ≥ threshold; p10 = 10th percentile)

| condition | v5 (speaches) ≥ .9 / ≥ .75 / ≥ .5 · p10 | v6.2 ≥ .9 / ≥ .75 / ≥ .5 · p10 |
|---|---|---|
| clean, RMS 0.05 | .95 / .97 / .98 · .975 | .96 / .97 / .98 · .998 |
| clean, RMS 0.005 | .91 / .94 / .96 · .908 | .94 / .95 / .97 · .984 |
| clean, RMS 0.0015 | .78 / .89 / .94 · .722 | .90 / .94 / .96 · .905 |
| **nb, 0.05** | .86 / .92 / .95 · .834 | .93 / .95 / .97 · .970 |
| **nb, 0.005** | .79 / .90 / .94 · .730 | .90 / .93 / .96 · .906 |
| nb + car noise, SNR 10 dB | .84 / .90 / .94 · .763 | .87 / .91 / .94 · .808 |
| nb + car, SNR 5 dB | .80 / .89 / .94 · .734 | .79 / .88 / .93 · .660 |
| nb + car, SNR 0 dB | .51 / .74 / .87 · .406 | .60 / .75 / .87 · .390 |
| nb + car 10 dB **+ NS** | .80 / .88 / .92 · .659 | .84 / .89 / .93 · .705 |
| nb + car 0 dB **+ NS** | .72 / .85 / .92 · .587 | .68 / .81 / .89 · .454 |
| nb on the native **8 k head** (v5.1.2 / v6.2) | .85 / .90 / .94 · .743 | .94 / .96 / .97 · .976 |

Reading: narrowband and quietness each push 10–20 % of in-word frames below 0.9 and 5–10 % below 0.75
— the 0.9 start/0.75 exit pair sits **on** the distribution's lower tail, while 0.5/0.35 sits well
below it. The **peak** stays ≥ 0.99 in every condition, so admission (the start) is never the problem;
the **exit** is. The 8 k head is no better than the 16 k head for v5. v6.2 holds degraded speech
materially higher.

### 3.2 Endpointing — speaches' exact flow, v5, silence 700 ms, 66 s of speech (6 real pauses ≥ 700 ms)

Premature end events (a turn cut mid-speech):

| thr → | 0.5 | 0.55 | 0.6 | 0.65 | 0.7 | 0.8 | 0.9 |
|---|---|---|---|---|---|---|---|
| nb, 0.05 | 2 | 2 | 3 | 3 | 3 | 4 | 4 |
| **nb, 0.005 (quiet car)** | **4** | 3 | **4** | 4 | **12** | 8 | **12** |
| nb + car SNR 5 | 4 | 4 | 4 | 6 | 8 | 8 | 7 |

Silence window at fixed threshold (premature events, quiet nb): **0.9 → 13 @ 500 ms · 12 @ 700 ·
14 @ 1000**; **0.6 → 5 · 4 · 1**; **0.5 → 4 · 4 · 2**. Clean speech: 1–3 at every threshold. v6.2 in
the same flow (quiet nb): 0.5 → **0**, 0.9 → 5.

**So:** on degraded audio the knee sits between **0.6 and 0.7**; above it the silence knob loses its
authority (a longer window does not rescue the turn because in-word frames keep falling below the
0.75 exit). This is the mechanism the brief suspected, reproduced.

### 3.3 Admission — false utterance starts in speaches' flow (10 s signals)

| signal | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | continuous-state max (v5 / v6.2) |
|---|---|---|---|---|---|---|
| white / pink / car noise, clatter, typing, 1 kHz tone (run at 0.5 / 0.7 / 0.9 only) | 0 | — | 0 | — | 0 | ≤ 0.11 / ≤ 0.08 |
| synthetic music (vibrato chord) | 2 | 0 | 0 | 0 | 0 | 0.19 / 0.23 |
| 120 Hz hum + harmonics, RMS 0.05 | 4 | 4 | 4 | 8 | **0** | 0.79 / 0.24 |
| hum, RMS 0.01 | 8 | 9 | 83 | 0 | 0 | — |
| far speech (reverb RT60 ≈ 0.5 s, 3 kHz LP, RMS 0.003) + car noise 0.001 | 3 | 2 | 4 | 2 | **3** | 0.99 / **0.62** |

* The hum starts come from **frame 0 of a zero-state window** (max 0.898 there, 146 of 149 hits at
  frame 0): a speaches artefact, invisible to a streaming VAD. They transcribe to `""` (R76 §2.2).
* **Far speech passes at every threshold** — 0.9 does not stop the TV. Notably, **v6.2 in continuous
  state rejects it** (max 0.33 with a white floor, 0.62 with car noise; 0–10 % of frames ≥ 0.5, none ≥ 0.9) while keeping dry
  speech at the same level and SNR (0.74–0.81 of frames ≥ 0.9) — consistent with #687's "suppress
  background speech". **But inside speaches' zero-state rescans v6.2 still yields 2–4 far-speech starts
  at 0.5** — the rescan architecture spends the model's advantage.

### 3.4 Noise suppression and AGC

* **NS before Silero** (crude Wiener, §3.1): at moderate SNR it *lowers* in-speech probability slightly
  (v5 ≥ .9: .84 → .80 at 10 dB); at very low SNR it raises it (.51 → .72 at 0 dB). Net: NS does not
  lift quiet-speech probability in the regime the car is likely in, and it removes none of the
  speech-likeness of an interferer. Field practice places enhancement **before** VAD: pipecat applies
  `audio_in_filter` in the input transport ahead of everything (`base_input.py:284-285`); OpenAI's
  `input_audio_noise_reduction` is documented as filtering *"before it is sent to VAD"* (R76 §4.5).
  **Chrome's actual WebRTC NS was not probed** [U].
* **AGC:** undocumented for Silero. 30 dB of level change (0.05 → 0.0015) moves v5's ≥ .9 share
  .95 → .78, peak ≥ .999: **second-order for Silero, first-order for any absolute level gate.**

## 4. The field's numbers

| Stack (pin) | start thr | end thr | min speech | end silence | pre-pad | level corroboration |
|---|---|---|---|---|---|---|
| **Silero** `get_speech_timestamps` / `VADIterator` (`5cd79456`) | 0.5 | thr − 0.15 | 250 ms / — | 100 ms | 30 ms | none; "loudness is not an option" (#687) |
| **faster-whisper** 1.1.1 `VadOptions` | 0.5 | thr − 0.15 | 0 | 2000 ms | 400 ms | — |
| **speaches realtime** (`fdc6a27`) | **0.9** (session default) | 0.75 | **0** (unreachable) | 550 default (we send 700) + the 3 s floor | 0 (field discarded) | — |
| **speaches HTTP door** (R76 §1.3) | 0.5 | 0.35 | 0 | 160 ms | 400 ms | — |
| **OpenAI Realtime `server_vad`** (R76 §4.5) | 0.5 | — | — | 500 ms | 300 ms | *"higher threshold … louder audio … noisy environments"*; pre-VAD `near_field`/`far_field` NR |
| **LiveKit** `silero.VAD.load` (`98ed3e85`, Silero **v6.2**) | 0.5 | max(thr − 0.15, 0.01) | 50 ms | 550 ms + endpointing `min_delay` 0.5 s / `max_delay` 3.0 s | 500 ms | none; probability EMA-smoothed (α 0.35); `max_buffered_speech` 60 s |
| **pipecat** `VADParams` (`4471fe83`, Silero **v6.0**) | 0.7 (`confidence`) | same value (STOPPING state) | 0.2 s (`start_secs`) | 0.2 s (`stop_secs`, was 0.8 until 2026-02-07) + turn-stop `user_speech_timeout` 0.6 s | — | **AND** `min_volume` 0.6 = BS.1770 loudness over 400 ms normalised −110…−10 LUFS ⇒ **≈ −50 LUFS** |
| **RealtimeSTT** (`77772755`) | Silero `> 1 − 0.4` = **0.6**, behind WebRTC mode 3 | WebRTC (or Silero if `silero_deactivity_detection`) | `min_length_of_recording` 0.5 s | `post_speech_silence_duration` 0.6 s | 1.0 s | two VADs in series |
| **AssemblyAI × LiveKit guide** (docs, today) | **0.3** for both VADs | — | — | — | — | — |
| **hermes-agent** (`cc23b725`) | faster-whisper default 0.5 (no threshold set) | — | — | `vad_min_silence_ms` 500; capture auto-stop 3.0 s | — | capture RMS 200/32767 ≈ **0.0061** linear |
| **open-webui** call mode (R76 §4.4) | no Silero | — | — | 2000 ms | — | analyser band −55…−30 dB |
| **Edesy** (vendor doc) [R] | **0.8** default ("0.9 too strict — misses quiet speakers, soft endings") | — | — | 200 ms | — | optional volume 0.01–0.1 |

*Why these numbers:* Silero's 0.5 is its "lazy" dataset-agnostic default; pipecat moved `stop_secs`
0.8 → 0.2 because *"with a shorter stop_secs value, STT services using a local VAD can finalize
sooner"* while end-of-turn moved to a separate strategy (`a5fc2b1650`); AssemblyAI lowers LiveKit to
0.3 to match its own VAD and avoid a "dead zone", and says *"If you're in a noisy environment and
receiving false speech triggers, raise both … thresholds together."* RealtimeSTT documents Silero
end-detection as *"more robust against background noise"* than WebRTC's.

**Stacks above 0.8 in production:** speaches (0.9, unexplained), a vendor blog (0.8, unmeasured) and
one telephony user in silero #366 (0.85, reporting failures at both extremes). Nobody else.

**Coupling a neural threshold with a level gate:** pipecat ANDs two fixed, independent floors
(`confidence >= 0.7 and volume >= 0.6`, R76 §4.1); RealtimeSTT chains two VADs; AssemblyAI couples two
*probability* thresholds 1:1; SpeechBrain's pipeline refines neural segments with an energy VAD whose
energy is **normalised per segment** (relative, not absolute). **No product or paper found that drives
a probability threshold and a level floor from one user dial.**

## 5. The co-variation question

* **Do they need to co-vary?** No: Silero's threshold governs **endpoint robustness** (§3.2) and
  admits speech-like audio at every setting (§3.3); the level floor governs **proximity** (R76 §6),
  which Silero's authors keep out of the model (#687).
* **The simpler form the owner asked about — should the Silero threshold be a user dial at all?** On
  this evidence, **no**: moving it up does not quieten the home (the interferer is speech-like and
  passes 0.5–0.9 alike; the non-speech it does stop produces empty finals), and moving it down is only
  ever *right* for degraded audio — which a fixed ≈ 0.6 already serves at home at no measured cost.
  The dial that changes behaviour in both rooms is the level/SNR margin.
* **If one dial must drive both:** hold Silero fixed and move only the energy margin; at most a
  **step table** that drops Silero to 0.5 at the most sensitive end ("car") and never raises it above
  ≈ 0.7 at the other. A linear coupling of 0.05–0.95 would walk Silero across the 0.6–0.7 cliff in the
  middle of the dial.
* **Ranges if a Silero control is kept:** 0.5–0.8 (step 0.05). Below 0.5 on v5-with-rescans the
  zero-state and music-like starts grow (§3.3) and the exit threshold approaches its 0.01 floor; above
  0.8 is the cut-off regime. The current slider's `VAD_MIN 0.05 … VAD_MAX 0.95`
  (`CallOverlay.tsx:403-405`) spans mostly unusable territory.

## 6. Bounded open sweep (three)

1. **The rescan architecture is the reason speaches "needs" a high threshold** — zero-state windows
   (first-frame spikes) and ~75 re-evaluations per 3 s (max-of-many) inflate false starts beyond what a
   streaming Silero at the same threshold would produce. A streaming iterator (persistent state, one
   inference per new 32 ms) would let the threshold sit at the field's 0.5 and give `min_speech_ms` a
   natural home. Fork-sized change [U effort].
2. **Silero v6.2 is a material upgrade for exactly our two symptoms** — measurably higher probability
   on narrowband/quiet speech (fewest premature cuts in every probe) and, in streaming use, rejection
   of reverberant far speech that v5 passes at 0.9. It pays off fully only with (1). Re-calibrate on
   swap (#685).
3. **The start is never the problem; the exit is.** Every condition peaks ≥ 0.99: "the car doesn't
   hear me" is the client level gate (R83), "the car cuts me off" is Silero's exit.

---

## 7. Implications for ctrl-b — ranked

*Evidence ages slowly; this section fast. Nothing here is decided.*

1. **Change the `vad_threshold` default 0.9 → 0.6** (config + seed of the in-call slider). Evidence:
   premature cuts on quiet narrowband 12 → 4, silence window regains authority, home admission
   unchanged for speech-like audio; the extra starts at 0.6 (hum/music-like) come back as empty
   finals. Confidence: mechanism [V]; magnitude on the owner's car [U] — synthetic audio, female
   voices only.
2. **Stop exposing Silero as the user's sensitivity dial.** Make the in-call dial drive the level/SNR
   gate (R82/R83); keep `vad_threshold` a Conf knob bounded **0.5–0.8**. If the Speech slider is kept,
   clamp it to 0.5–0.8, default 0.6, step 0.05, and label it as "cut-off tolerance", not sensitivity.
3. **`silence_ms`: keep 700; bound 500–1200.** At ≤ 0.6 the knob works: 1000 ms roughly halves
   premature cuts (0.6: 4 → 1) for ~0.3 s latency — a plausible car preset, not a user dial. The field
   sits at 0.5–0.8 s total.
4. **Co-variation rule:** none by default (Silero fixed, the dial moves only the level margin). If a
   coupling is wanted, a two-step table — Silero 0.6 across the dial, 0.5 at its most sensitive end.
5. **Fork follow-ups, when the owner wants the home interferer handled at the source:** a streaming
   Silero iterator in speaches (§6.1), then v6.2 (§6.2), re-calibrated on the owner's own recordings
   with Silero's `tuning/search_thresholds.py` enter/exit search.
6. **S4 log:** per utterance, the server's `speech_started/stopped` timing against the client's
   accrued-above-floor ms, so "not heard" (gate) and "cut off" (Silero exit) are told apart.

---

## 8. What I could not determine

1. **Real HFP audio.** CVSD (8 kHz) vs mSBC (16 kHz wideband speech) on the owner's car, the car's own
   NS/AGC/AEC, and Chrome's resampling of it were not modelled; the µ-law band-pass proxy may flatter
   or punish Silero. If the car negotiates mSBC, the narrowband penalty largely disappears.
2. **Chrome's WebRTC noise suppression** (and whether `autoGainControl` defaults ON on the Honor 20's
   comm-mode path) were not probed; my NS is a crude Wiener filter.
3. **Voice coverage.** Five female studio voices; the owner's voice, male or low-pitched speech, and
   spontaneous speech with hesitations were not tested.
4. **Why speaches chose 0.9** — no trace in commits or issues; the zero-state reading is an inference.
5. **Whether pipecat's `stop_secs` 0.2 / LiveKit's EMA** would change the cut-off numbers if ported —
   the replays of those rules on continuous-state probabilities (not shown) tracked the Silero rule
   closely, so the gain is in the threshold, not the rule; not tested on speaches' rescans.
6. **Published false-positive rates for TV/other-room speech vs threshold** — none found beyond
   Silero's aggregate noise-only accuracies; #687 is the only first-party statement.
7. **Premature-cut ground truth** is energy-labelled (−35 dB of the clip's loud frames), which counts
   some low-energy tails as speech; comparisons across thresholds are fair, absolute counts are not.

---

## Primary sources

- silero-vad `5cd79456` — `src/silero_vad/utils_vad.py:281-350,421-586,590-680` (`:310` lazy 0.5, `:476` neg, `:485`/`:663` timer reset, `:671` iterator exit); `tuning/utils.py:326-353`,
  `tuning/config.yml` (`tune_8k`); releases v6.0 (2025-08-26), v6.2 (2025-11-06); issues #366, #452, #606,
  #637, #685, #687, #798. Wiki `959929d` — FAQ; Quality-Metrics (noise-only accuracy table; 8 k vs 16 k
  chart from history).
- speaches fork `fdc6a27` (= upstream `993994f` for these files) — `executors/silero_vad_v5.py:36-65,70-125,190-300`;
  `realtime/input_audio_buffer_event_router.py:46-121`; `realtime/input_audio_buffer.py:34-36`;
  `realtime/session.py:62-67`; `audio.py:17-22`; commit `2068a02` (2025-02-13).
- livekit/agents `98ed3e85` — `livekit-plugins-silero/livekit/plugins/silero/vad.py:60-139,410-575`;
  `livekit-agents/livekit/agents/utils/exp_filter.py`; `voice/turn.py:135-147`; docs.livekit.io
  `agents/logic/turns/vad`.
- pipecat `4471fe83` — `audio/vad/vad_analyzer.py:24-27,86-87,173-210`; `audio/vad/silero.py:22-23,175-235`;
  `audio/utils.py:164-188`; `audio/volume.py:13-16`; `transports/base_input.py:284-285`; commits
  `a5fc2b1650` (2026-02-07), `e9057a9ab8` (2026-08-07).
- RealtimeSTT `77772755` — `docs/configuration.md:69-79`; `RealtimeSTT/audio_recorder.py:395-421`.
- faster-whisper 1.1.1 — `vad.py` `VadOptions`.
- hermes-agent `cc23b725` — `hermes_cli/config_defaults.py:1077-1083,1126-1127`; `tools/transcription_local.py:174-175`.
- AssemblyAI, *Universal 3.5 Pro Realtime on LiveKit* (fetched 2026-09-24); SpeechBrain VAD tutorial.
- Edesy, *Voice Activity Detection* docs [R, unmeasured].
- ctrl-b `63da966` — `backend/app/config.py:683-689`; `frontend/src/theme-engine/kit/CallOverlay.tsx:403-405`.
