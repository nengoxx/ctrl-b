# R98 — The VAD-model landscape and the plug-in contract: which models could replace Silero, how peers abstract a VAD, and the `VadModel` boundary ctrl-b should draw

**Date:** 2026-09-30 · **Author:** research lane R98 (Opus 5.5), session 54 · **Status:** evidence dossier. Nothing is built.
**Question (owner, 2026-09-30):** "I want this to be agnostic … there are other VAD models which we might want to use or test …
if hallucinations and silence issues persist, we might want to use another one that is a little bit better, even if it's
bigger … I would like to not carry technical debt and not have to do a big refactor."
**Artifact it feeds:** a main-seat amendment to [`docs/ASR_PLAN.md`](../ASR_PLAN.md) §3.4 naming a `VadModel` boundary.
**Builds on, does not redo:** [R94-evidence/L4](./R94-evidence/L4-external-research.md) §1 (Silero `VADIterator`, the v5/v6
ONNX contract, 81 µs/window) and §5 (FireRedVAD/TEN brief) · [R95](./R95-vad-placement.md) (placement; sherpa = bool) ·
[R97](./R97-peer-engine-design.md) §2, §4, §9 (peer onset/EMA/pre-roll/structure) · [R84](./R84-silero-threshold-calibration.md)
(threshold calibration, v5→v6 re-calibration) · [R92](./R92-live-call-noise-robustness.md) (noise robustness of today's ear).
**Index row owed:** this lane may create only this file. The main seat adds the `README.md` index row.

**Confidence vocabulary** (R95's): **VERIFIED** = source read in a clone / model metadata read with
`InferenceSession.get_inputs()` today (the method is named per claim). **MEASURED** = run on emma today (method in §8).
**REPORTED** = official docs, a paper or a vendor README, not reproduced. **REASONED** = derived from verified facts plus a
stated assumption. **UNVERIFIED** = expected, not checked.

---

## 0. Executive summary

1. **Silero is the right family; v6.2 beats v5.1.2 on every axis measured here, and the plan's reason for v5 is gone.** On the
   TEN labelled test set (262 s) clean and with DEMAND in-car/cafeteria/kitchen noise, streamed hop by hop on emma: v6.2 AUC
   0.957 vs v5 0.925 (clean), 0.952 vs 0.913 (car 0 dB); under a plan-shaped policy (EMA, act 0.6, 200 ms onset) **v6.2 found
   126/126 labelled speech segments with 0 phantom segments on 3 min each of car, cafeteria babble and kitchen noise; v5 missed
   6/126 and produced 7.3 phantom segments/min on babble** [MEASURED, §2.3]. v5 was pinned for Speaches parity (L4 §1.2), which
   the plan itself dropped (§6: "no Speaches baseline, no shadow comparison and no parity engine"). The IO contract is identical
   (a file swap + a threshold). **Recommendation: default v6.2, keep v5 as the replay A/B** — the main seat's call.
2. **No released streaming model is clearly better than Silero v6 for a car.** The one independent 2026 table (Recho, arXiv
   2609.19856) puts Silero v6 at or near the top of released causal models on every set; MarbleNet wins only at SNR ≤ 0 dB and
   is non-causal; TEN ties on noisy real calls (AUC 0.969 vs 0.966) but loses at low SNR [REPORTED, §2.1]. FireRedVAD's 97.57 F1
   is its **non-streaming** model on an unreleased test set; its streaming model measured **below** v6.2 here (AUC 0.944)
   [MEASURED].
3. **The phantom "Yeah."/"Mm-hmm." class is not a VAD-model problem.** Echo residue and a car radio ARE speech. Every generic VAD
   passes them. The only research line that targets them — foreground VAD (Mamba-FVAD, 2026-09) — is unreleased. Swapping
   models will not fix it; AEC, the hold and the backchannel gate stay the levers.
4. **Peers:** Pipecat, vad-web and sherpa split *model = per-window probability* from *policy*, but each gets one thing wrong
   (§3). Pipecat and vad-web share **one threshold across models whose scales differ**. sherpa **duplicates the policy inside
   each model**. Pipecat **quantizes edges to the caller's buffer**. pysilero-vad and RealtimeSTT **drop the residual samples**
   when a hop does not divide the buffer. Home Assistant's segmenter is the hop-agnostic one: it counts **seconds**, not windows.
5. **The boundary (§4):** a `VadModel` (name · `sample_rate` · `hop` · `delay_hops` · `default_act` · `open()`) and a per-leg
   `VadStream.probs(pcm) → one float per hop`, plus a plain dict of constructors. The Segmenter owns the residual carry, the
   index and delay mapping, and the flush drain. `VadParams` stays in **ms**, with the EMA as a time constant, and the counts are
   derived once per hop. Non-causal models are refused on the live door and may serve only the batch pre-pass. Bool-only models
   go to the already-named `EdgeSegmenter` exit.
6. **Try next if v6.2 fails (§5):** ① v5.1.2 (A/B only), ② TEN, via its native library, behind libc++ and an Agora licence check,
   ③ FireRedVAD-stream, and ④ FireRedVAD non-stream or MarbleNet **for the pre-ASR pass only**. Not recommended: WebRTC,
   micro-vad, pyannote, SpeechBrain, FSMN or Cobra.

---

## 1. The candidate table

Every number that decides a design is in this table. "µs / 32 ms" = CPU for 32 ms of audio, one thread, `intra_op=1`,
`allow_spinning=0`, Python loop included, emma (Ryzen 7 8745HS, Python 3.14.4, onnxruntime 1.30.0) [MEASURED §8].
"thr@5 %" = the threshold that misses 5 % of speech frames on the clean test set. It shows **the probability scale**: Silero's
0.5 and TEN's 0.5 do not mean the same thing.

| Model | Runtime + Python deps | cp314 | Licence | Size | Input contract | Output | Causal / lookahead | State / reset | µs / 32 ms | Default thr · p50 on speech · thr@5 % | 8 kHz |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Silero v5.1.2** (`silero_vad.onnx` @ tag v5.1.2, sha256 `2623a295…`) | onnxruntime + numpy | ✓ (ORT 1.30 cp314 wheel) | MIT | 2 327 524 B | 16 kHz; `input [B, 64+512]` = 64-sample context + 512 hop (32 ms); `state [2,B,128]`; `sr` int64 [VERIFIED get_inputs] | `output [B,1]` P(speech) per hop | causal, 0 lookahead | state + 64-sample context; reset = zeros | **84** (75 raw ORT) | 0.5 (upstream) · 0.990 · **0.09** | ✓ 256+32 |
| **Silero v6.2** (master = tag v6.2 = v6.2.1, sha256 `1a153a22…`, = LiveKit's bundled file per R84) | same | ✓ | MIT | 2 327 524 B | identical to v5 [VERIFIED] | same | causal | same | **83** | 0.5 · 0.998 · **0.40** | ✓ |
| **Silero v6.2 sequence** (`silero_vad_16k_sequence.onnx`, release v6.2.2 2026-09-17, sha256 `9ccdacc4…`) | same | ✓ | MIT | 1 246 165 B | `input [T, 576]` (T windows, each 64 ctx + 512), `h [1,1,128]`, `c [1,1,128]` [VERIFIED get_inputs] | `speech_probs [T]`, `hn`, `cn` | causal; **h/c carry ⇒ streamable** | h, c + ctx | **58 (T=2) · 48 (T=4) · 42 (T=32)**; bit-exact vs per-window v6.2 (max diff 0.0) [MEASURED] | as v6.2 | ✗ 16 kHz only |
| **pysilero-vad 3.4.0** (rhasspy; Wyoming/HA) | C extension (ggml Silero **v6.2.0**), **no ORT, no numpy** | ✓ abi3 cp39 | MIT | 5.9 MB installed | 512 int16 samples as bytes; `process_chunk(bytes)→float`; `reset()` [VERIFIED `__init__.py:35-78`] | prob | causal | internal; `reset()` | **62** | 0.5 · — · — | ✗ |
| **TEN VAD** (`ten-vad` 1.0.6.8, repo `22a3bcd`) | ctypes → prebuilt `libten_vad.so` (**needs system libc++1 + libc++abi1**, absent on emma: import fails) [MEASURED]; an ORT-only path means re-implementing its mel + LPC pitch frontend (sherpa zeroes the pitch, L4 §5) | wheel is py3-none-any (ctypes) | Apache-2.0 + Agora conditions (non-compete; "solely for … direct End Users") | .so 313 KB; onnx 315 449 B | 16 kHz only; hop 160 or 256 (10/16 ms); features 3 frames × 41 (40 mel + pitch); ONNX `input_1 [N,3,41]` + four hidden `[N,64]` [VERIFIED get_inputs + `aed_st.h:15-36`] | raw prob (no smoothing: `voiceProb = aivadScore`, `aed.cc:983`) + flag | **1 hop lookahead** (`AUP_AED_LOOKAHEAD_NFRM 1`; TEN's own eval shifts output by one hop, `plot_pr_curves.py`) | native handle; reset = destroy + create | **141** (hop 256) · 144 (hop 160) | 0.5 · **0.843** · 0.44 | ✗ |
| **FireRedVAD stream** (repo `c30ec49`, `fireredvad_stream_vad_with_cache.onnx`, sha256 `b3c97836…`) | ORT + numpy + **kaldi-native-fbank** (1.22.3 cp314 ✓, 360 KB); cmvn read once (kaldiio avoidable) | ✓ | Apache-2.0 (code + HF weights) | 2 306 042 B | 16 kHz; 80-mel kaldi fbank, 25 ms window / **10 ms hop**, global CMVN; `feat [1,T,80]`, `caches_in [8,1,128,19]` [VERIFIED get_inputs] | prob per 10 ms | **causal** (look-ahead order 0, report §4.3; ONNX has 8 convs, no lookahead filter [VERIFIED onnx graph]); +15 ms fbank window | 8×128×19 floats = **76 KB/leg** + fbank stream | 1240 (T=1) · **345 (T=4 = one 40 ms relay frame)** · 147 (T=10) | 0.5 (CLI 0.4 + 5-frame average) · 0.984 · **0.17** | ✗ |
| **FireRedVAD non-stream** | same | ✓ | Apache-2.0 | 2 388 488 B | same features, whole utterance | prob per 10 ms | **non-causal**: 8 layers × look-ahead 20 frames ⇒ up to **1.6 s** future context [VERIFIED onnx: 16 convs, kernel 20] | none (offline) | n/a (offline) | 0.5 · 0.994 · 0.33 | ✗ |
| **WebRTC VAD** (GMM; `webrtcvad-wheels` 2.0.14) | C extension | **sdist only** — built from source on emma (needs a compiler at install) | MIT | ~0 (no model) | 8/16/32/48 kHz; 10/20/30 ms frames, bytes | **bool** | causal | internal; mode 0–3 | **2.7** | n/a (bool) | ✓ |
| **micro-vad** (`pymicro-vad` 2.1.0; HA's `assist_pipeline`) | C++ extension (microWakeWord arch) | ✓ abi3 | Apache-2.0 | small | 16 kHz, 10 ms (160 samples) bytes | prob; **−1 for the first ~760 ms** (warm-up) [MEASURED] | causal | internal | 287 | HA uses 0.2 / 0.5 · 0.974 · 0.00 | ✗ |
| **MarbleNet v2.0** (`nvidia/Frame_VAD_Multilingual_MarbleNet_v2.0`) | NeMo + torch upstream; third-party ONNX (TigreGotico, 370 126 B; `vadonnx` 0.1.0 port) | ✓ via port | **NVIDIA Open Model License** | 91.5 K params | 16 kHz; log-mel; 20 ms output frames | prob per 20 ms | **non-causal**: a perturbation at t changed outputs from t−1040 to t+1160 ms via the port [MEASURED]; kiloVAD paper: "630 ms latency required by MarbleNet" [REPORTED] | stateless (buffered blocks) | RTF 0.0018 offline (port) | 0.5 · 0.988 · 0.13 (port) | ✗ |
| **pyannote segmentation-3.0** | torch upstream (HF gated); third-party ONNX port | ✓ via port | MIT | ONNX port 5 986 908 B | 16 kHz; **10 s windows**; 7-class powerset per 17 ms | P(speech) = 1 − P(non-speech class) | **non-causal** (whole 10 s window) [MEASURED] | stateless | RTF 0.0052 offline | scale off: thr@5 % = **0.82**, FA@0.5 = 55 % | ✗ |
| **FSMN-VAD** (FunASR) | ORT + kaldi fbank + LFR | ✓ via port | **FunASR Model License 1.1** (attribution; licence forfeited for "denigration") | ONNX 1 730 426 B | 16 kHz, 10 ms | 2-class logits | ~40 ms lookahead [MEASURED via port] | caches | RTF 0.0024 | — · 0.979 · 0.48 | ✗ |
| **SpeechBrain CRDNN** | torch upstream; ONNX port 465 648 B | via port | Apache-2.0 | small | 16 kHz, 10 ms | prob | offline | — | — | AUC 0.68 via port (port unvalidated) | ✗ |
| **Picovoice Cobra** 3.0.3 | proprietary `libpv_cobra.so` via ctypes | py3-none-any | **commercial; AccessKey from Picovoice Console** | — | `frame_length` / `sample_rate` read from the library at runtime [VERIFIED `_cobra.py:197-199`] | prob | UNVERIFIED | — | vendor RTF 0.0004 | not measured (key required) | UNVERIFIED |
| **ai-coustics Quail VAD** / **Krisp VIVA** | proprietary SDKs (Pipecat analyzers) | — | commercial | — | 10 ms windows (Quail: `int(sample_rate*0.01)`, `aic_quail_vad.py:288`) | raw prob (Pipecat bypasses the SDK's own post-processing) | — | — | — | — | — |
| **PulseVAD / kiloVAD** (2.1 K params) | ORT | ✓ | MIT (PulseVAD) | 2.1 KB int8 | 200 ms windows (3200 samples) | 2-class | causal windows ⇒ ≥ 200 ms latency | stateless | — | AVA AUC 0.850 (kiloVAD paper) [REPORTED] | ✗ |
| **Mamba-FVAD** (foreground VAD, arXiv 2609.19856) | — | — | — | 0.6 M | streaming, 1–2 ms/frame CPU | foreground-only speech | streaming | — | — | **not released** (only its benchmark "will be released") | — |

**What the table says for ctrl-b [REASONED]:**
- Only four live-door-eligible candidates exist: causal, ≤ 1 hop of lookahead, a probability output and a licence usable here.
  They are **Silero v5/v6 (incl. the sequence export), TEN and FireRedVAD-stream**.
- Every one runs at 16 kHz, so the relay's PyAV resampler already produces their input. No adapter needs its own resampler.
- The hops are 32 / 16 / 10 ms. Against the relay's 40 ms frames (640 samples), Silero gets 1,1,1,2 windows per frame, TEN-256
  gets 2 or 3 alternating, and FireRed and TEN-160 get exactly 4 (§4.2 ①).
- The probability scales differ by a lot. The threshold that misses 5 % of clean speech is 0.09 for v5, 0.40 for v6.2, 0.44
  for TEN and 0.17 for FireRed-stream. **A threshold is a property of the model, not of the policy.**

---

## 2. Noise robustness — is Silero actually the best for our case?

### 2.1 Independent evidence (not a vendor README)

**Recho Inc., "Foreground Voice Activity Detection", arXiv [2609.19856](https://arxiv.org/abs/2609.19856) (2026-09-17), Table I**
[REPORTED; the authors built a competing model, but none of the baselines is theirs]. The cells are ROC-AUC / F1@0.5.
"In-house" is 9.8 h of **real voice-agent calls in noisy venues** (restaurants, offices), where background talkers are
labelled NEGATIVE:

| Model | KAIST | VoxConverse | TEN test | In-house (noisy real calls) | LibriVAD clean | SNR −5 | SNR 0 | SNR 5 | SNR 10 |
|---|---|---|---|---|---|---|---|---|---|
| WebRTC | – / 0.688 | – / 0.433 | – / 0.891 | – / 0.587 | – / 0.930 | – / 0.288 | – / 0.332 | – / 0.332 | – / 0.465 |
| FSMN-VAD | – / 0.932 | – / 0.972 | – / 0.871 | – / 0.705 | – / 0.918 | – / 0.847 | – / 0.895 | – / 0.901 | – / 0.902 |
| TEN VAD | 0.989 / 0.927 | 0.930 / 0.949 | 0.942 / 0.928 | **0.969** / 0.851 | 0.980 / 0.955 | 0.835 / 0.807 | 0.882 / 0.880 | 0.912 / 0.904 | 0.932 / 0.918 |
| MarbleNet | **0.994** / 0.947 | **0.962** / 0.966 | 0.920 / 0.912 | **0.973** / **0.616** | 0.979 / 0.955 | **0.890** / 0.895 | **0.919** / 0.912 | 0.935 / 0.919 | 0.945 / 0.925 |
| Silero v5 | 0.992 / 0.926 | 0.947 / 0.946 | 0.925 / 0.903 | 0.966 / **0.728** | 0.979 / 0.952 | 0.846 / 0.809 | 0.909 / 0.905 | 0.943 / 0.922 | 0.963 / 0.932 |
| Silero v6 | 0.992 / 0.947 | 0.952 / 0.952 | **0.957** / **0.939** | 0.966 / **0.862** | **0.981** / 0.960 | 0.846 / 0.831 | 0.918 / 0.914 | **0.946** / 0.930 | **0.963** / 0.937 |
| Mamba-FVAD (theirs, unreleased) | 0.986 / 0.910 | 0.933 / 0.929 | 0.910 / 0.890 | **0.982 / 0.884** | 0.979 / 0.960 | 0.830 / 0.712 | 0.916 / 0.884 | 0.958 / 0.933 | 0.970 / 0.947 |

**What it supports:**
- Among released models, **Silero v6 is never worse than third on any set**.
- On noisy real calls, v6's F1 at a fixed 0.5 (0.862) is far above v5's (0.728). The ranking AUC is the same (0.966). That is a
  **calibration** gap, not a ranking gap, and it is exactly the "v5 needs a different threshold" effect measured in §2.3.
- MarbleNet ranks best (AUC) at SNR ≤ 0 dB and on real calls. Its F1@0.5 of 0.616 on real calls shows a badly placed scale.
- TEN is below Silero from SNR 0 dB upward on LibriVAD.

The same paper's VOiCES result [REPORTED]: Silero v6 background false-alarm rate is **music 0.12 · telephone 0.18 · babble 0.27**.
The paper states that generic VADs fire on any speech and that background rejection comes from training supervision (competing-
speaker mixing), not from the architecture.

**Other sources, weaker:**
- **FireRedASR2S technical report**, arXiv [2603.10420](https://arxiv.org/abs/2603.10420) §4.3 and Table 3 [REPORTED,
  self-reported]:
  - FLEURS-VAD-102, 25 ms / 10 ms frames, a fixed threshold of 0.5 for all models.
  - FireRedVAD AUC 99.60 · Silero 97.99 · TEN 97.81; FAR 2.69 / 9.41 / 15.47; miss rate 3.62 / 3.95 / 2.95.
  - The row is the **non-streaming** model. It has 1.6 s of look-ahead (§1).
  - The Silero version is not stated.
  - The test set is still unreleased ("We will release FLEURS-VAD-102", report test-set paragraph; README "coming soon" at `c30ec49`).
- **S4VAD**, arXiv [2609.11110](https://arxiv.org/abs/2609.11110) (2026-09-10):
  - It retrains MarbleNet, a Transformer and an RNN as **causal 10 ms** models. None of them is the pretrained Silero or TEN.
  - Onset latency at a 3 % false-positive rate is 39–55 ms on LibriSpeech and **114–238 ms on AVA-Speech** (noisy movies).
  - Onset latency roughly doubles to quadruples in real noise, whatever the architecture [REPORTED].
- **kiloVAD**, arXiv [2607.25870](https://arxiv.org/abs/2607.25870) (INTERSPEECH 2026): MarbleNet reaches AVA AUC 0.850 with
  **630 ms of context**. A 2.1 K-parameter causal CNN over a 200 ms window matches it [REPORTED].
- **Silero maintainer** (discussion [#593](https://github.com/snakers4/silero-vad/discussions/593), 2024-12-27): "Silero is a
  streaming VAD with a 30-ms chunk … MarbleNet is a synchronous VAD with a ~1s chunk … orders of magnitude slower"
  [REPORTED; the latency half agrees with the receptive field measured in §1].
- **Vendor-only** (not evidence of ranking):
  - TEN's PR curves are on its own released test set.
  - Picovoice claims Cobra 98.9 % TPR @ 5 % FPR against Silero 87.7 % and WebRTC 50 % (LibriSpeech + DEMAND; the Silero
    version is unstated).
  - Silero's own wiki: v5 → v6 noise-only accuracy 0.61 → 0.87 (R84 §1).
- **SincQDR-VAD**, arXiv [2508.20885](https://arxiv.org/abs/2508.20885): academic, and compares only against MarbleNet-class
  models. Not decision-relevant.

### 2.2 In-car, far-field, short utterances — where the evidence stops

- **No independent in-car benchmark exists for any of these models.** Nothing found in 2024–2026 papers, issues or vendor docs.
  The nearest things are the DEMAND mixes measured below and Recho's noisy-venue calls.
- **Short-utterance recall ("yeah", "no") is not benchmarked anywhere** at the word level. The TEN test set has only 16 labelled
  speech segments under 0.6 s. Every neural model found all 16 at its default threshold [MEASURED], but n = 16 decides nothing.
- **Onset latency:** the independent source is S4VAD (above). Here, the time from the labelled onset to the first hop at or
  above threshold is p50 ≈ 50–68 ms for every neural model. The p90 is 128 (v6.2) · 165 (v5) · 126 (TEN) · 112 (FireRed)
  [MEASURED]. The latency differences between models are smaller than one Silero window.

### 2.3 Measured on emma (the bake-off)

**Method (§8):**
- The TEN labelled test set: 30 WAVs, 262 s, 16 kHz, labels in `.scv`.
- Mixed with DEMAND 16 kHz `ch01` noise: **TCAR** (inside a car), **PCAFETER** (cafeteria babble) and **DKITCHEN** (kitchen
  clatter). The SNR is measured over the speech-active samples.
- Every model is streamed **hop by hop**, exactly as the relay would feed it. TEN is aligned by its one hop of lookahead.
- The test set is TEN's own and labels short inter-word pauses as non-speech. That favours TEN, and it inflates the frame-level
  false-alarm rate of any model with a hangover.

Frame-level AUC:

| Model | clean | car +10 | car +5 | car 0 dB | babble +10 | kitchen +5 |
|---|---|---|---|---|---|---|
| Silero v5.1.2 | 0.925 | 0.921 | 0.920 | 0.913 | 0.896 | 0.924 |
| **Silero v6.2** | **0.957** | **0.956** | **0.954** | **0.952** | **0.934** | **0.949** |
| TEN (hop 256) | 0.956 | 0.950 | 0.940 | 0.937 | 0.903 | 0.932 |
| TEN (hop 160) | 0.949 | 0.942 | 0.932 | 0.928 | 0.897 | 0.925 |
| FireRedVAD stream | 0.944 | 0.941 | 0.939 | 0.933 | 0.898 | 0.933 |
| micro-vad | 0.685 | 0.683 | 0.683 | 0.681 | 0.671 | 0.692 |
| *offline references:* FireRed non-stream | 0.965 | — | — | 0.958 | 0.940 | — |
| pyannote seg-3.0 (port) | 0.961 | — | — | 0.961 | 0.935 | — |
| FSMN (port) | 0.934 | — | — | 0.939 | 0.894 | — |
| MarbleNet (port — unvalidated vs NeMo; treat as a lower bound) | 0.869 | — | — | 0.851 | 0.781 | — |

**False-alarm rate at a matched operating point** (each model's threshold set so that it misses 5 % of clean speech frames). This
is the scale-free comparison:

| Model | clean | car 0 dB | babble +10 | kitchen +5 |
|---|---|---|---|---|
| Silero v5.1.2 (thr 0.09) | 41.4 % | 43.6 % | 59.9 % | 41.5 % |
| **Silero v6.2 (thr 0.40)** | **21.7 %** | **21.5 %** | **30.1 %** | **23.2 %** |
| TEN-256 (thr 0.44) | 23.7 % | 23.2 % | 44.0 % | 29.2 % |
| FireRed stream (thr 0.17) | 36.9 % | 41.5 % | 67.2 % | 41.7 % |
| WebRTC mode 3 (bool, its only point) | 54.8 % FA / 6.1 % miss | 19.1 / 39.5 | 13.3 / 61.5 | 11.0 / 55.9 |

**Phantom segments on noise alone** (180 s each, native level). The policy is ctrl-b-shaped: EMA α 0.35, `act`, 200 ms onset,
700 ms end. Segment recall is over the 126 labelled speech segments:

| Model @ act | seg recall clean / car 0 / babble +10 | TCAR /min | PCAFETER /min | DKITCHEN /min |
|---|---|---|---|---|
| Silero v5.1.2 @ 0.6 | 120 / 119 / 118 of 126 | 0.0 | **7.3** | 0.0 |
| **Silero v6.2 @ 0.6** | **126 / 125 / 125** | **0.0** | **0.0** | **0.0** |
| Silero v6.2 @ 0.5 | 126 / 126 / 126 | 0.0 | 0.0 | 0.0 |
| TEN-256 @ 0.6 | 126 / 121 / 124 | 0.0 | 2.7 | 1.0 |
| FireRed stream @ 0.6 | 125 / 124 / 124 | 0.0 | 3.3 | 0.0 |
| WebRTC m2 / m3 (simple policy @ 0.5) | — | 6.0 / 0.0 | 5.7 / 0.7 | 7.3 / 3.0 |

- **The segments v5 missed:** four of the six were in one file (`testset-audio-09`) at −24 to −29 dBFS, with v5's maximum
  probability at 0.19–0.63. The others were a 0.5 s segment at −10 dBFS (max 0.85) and a 1.17 s segment (max 0.81). v6.2 found
  all six. That matches v6.2's release notes ("unusual voices · muted speech · lower quality phone calls") [MEASURED].
- **Car noise is benign for every neural model.** On raw DEMAND TCAR at −23 dBFS, the maximum probability was 0.05 for v5,
  0.07 for v6.2, 0.73 for TEN and 0.72 for FireRed. None of them produced a segment.
- **The danger class is speech-like background:** babble, and by extension the radio and a passenger. That is where v5 falls
  apart and v6.2 holds.

**What the evidence supports [REASONED]:**
1. For ctrl-b's live door, **Silero v6.2 is the best released model measured or reported.** v5.1.2 is measurably worse on
   background speech and on quiet or unusual voices.
2. **No evidence supports "a bigger model would stop the phantom turns."** Those turns are real speech (echo, radio). Only
   foreground-selective training addresses them, and nothing released does it.
3. Beyond v6.2, the robustness headroom is at the **pre-ASR pass**, where lookahead is free. FireRed non-stream (0.965) and
   pyannote (0.961) out-rank every causal model offline.

---

## 3. How the peers abstract a VAD across models

| Peer (commit) | Model interface (what the caller feeds → what comes back) | Per MODEL | Per POLICY | A hop that does not divide the caller's frame |
|---|---|---|---|---|
| **Pipecat** `audio/vad/vad_analyzer.py` (`49dea68`) | `num_frames_required() -> int` (`:122`) · `voice_confidence(buffer: bytes) -> float` (`:131`); int16 bytes in, one float out | `num_frames_required` (Silero `return 512 if self.sample_rate == 16000 else 256`, `silero.py:197`; Quail `int(sample_rate*0.01)`, `aic_quail_vad.py:288`) | `VADParams(confidence=0.7, start_secs=0.2, stop_secs=0.2, min_volume=0.6)`; seconds→windows at `set_params`: `self._vad_start_frames = round(self._params.start_secs / vad_frames_per_sec)` (`:164`) | a byte buffer carries the residual: `while len(self._vad_buffer) >= num_required_bytes:` (`:202`) |
| **LiveKit** `agents/vad.py` + `plugins/silero/vad.py` (`d251b89`) | `VAD.stream() -> VADStream` (`vad.py:95`); `push_frame(AudioFrame)`; yields `VADEvent` with `samples_index: int` "relative to the inference sample rate" (`:34`), `probability`, `speaking` | `VADCapabilities(update_interval=0.032)` (`silero/vad.py:149`); window from `onnx_model.py:62-65` | **fused into the Silero plugin** (`_main_task`); `ExpFilter(alpha=0.35)` (`:234`) | combine frames and loop: `if available_inference_samples < self._model.window_size_samples: break` (`:407`); input-rate mapping keeps a fraction: `input_copy_remaining_fract = to_copy - to_copy_int` (`:435`) |
| **sherpa-onnx** `csrc/vad-model.h`, `voice-activity-detector.cc` (`040afe3`) | `virtual bool IsSpeech(const float *samples, int32_t n)` (`:33`) · `virtual float Compute(const float *samples, int32_t n)` (`:35`) · `WindowSize()` / `WindowShift()` (`:37`, `:39`) | window size vs shift (Silero `WindowSize = window_size + window_overlap_` with `window_overlap_ = 64`, `silero-vad-model.cc:177-178, :216`); TEN hop from config | **duplicated inside every model** (`temp_start_`, `triggered_` in both `silero-vad-model.cc:91-168` and `ten-vad-model.cc:108-160`); the detector branches per model: `} else if (!config_.ten_vad.model.empty()) {` (`voice-activity-detector.cc:58`) | a sample vector carries the residual: `int32_t k = (last_.size() - window_size) / window_shift + 1;` (`:79-80`) |
| **Home Assistant** `assist_pipeline/vad.py`, `audio_enhancer.py` (`dd2a9ed`) | `enhance_chunk(audio: bytes, timestamp_ms) -> EnhancedAudioChunk(speech_probability: float \| None)` (`audio_enhancer.py:42`); micro-vad: `speech_probability = self.vad.Process10ms(audio)` (`:88`) | the enhancer owns the 10 ms model; `process_with_vad(chunk, vad_samples_per_chunk, vad_is_speech, leftover_chunk_buffer)` for external VADs (`vad.py:198`) | **`process(self, chunk_seconds: float, speech_probability: float \| None)`** (`:131`); every counter is decremented in **seconds**: `self._speech_seconds_left -= chunk_seconds` (`:157`) — hop-agnostic by construction | `chunk_samples(samples, bytes_per_chunk, leftover_chunk_buffer)` (`:292`) keeps the leftover bytes |
| **Wyoming** (`08a0c25`) + **pysilero-vad** 3.4.0 | protocol events `VoiceStarted/VoiceStopped(timestamp: ms)` (`wyoming/vad.py`); pysilero: `chunk_samples() -> 512` (`:35`), `process_chunk(bytes) -> float` (`:55`) | fixed 512 | wyoming-faster-whisper `endpointing.py` | **`process_chunks` drops the residual AND the last full chunk when the input is an exact multiple**: `while (audio_idx + _CHUNK_BYTES) < num_audio_bytes:` — 512 samples → 0 probs, 1024 → 1 [MEASURED] |
| **RealtimeSTT** `core/voice_activity.py` (`7777275`) | WebRTC and Silero both run on the same 512-sample buffer, **in series** | `silero_sensitivity` → `vad_prob > (1 - recorder.silero_sensitivity)` (`:151`) | the recorder | WebRTC **drops the remainder**: `num_frames = int(len(chunk) / (2 * frame_length))` (`:181`), so 32 of every 512 samples are never analysed |
| **@ricky0123/vad-web** (`2e5aca9`) | `interface Model { reset_state: () => void; process: (arr: Float32Array) => Promise<SpeechProbabilities> }` (`models/common.ts:18-20`) | `const frameSamples = fullOptions.model === "legacy" ? 1536 : 512` (`real-time-vad.ts:290`) | `FrameProcessorOptions` in ms → frames: `const redemptionFrames = Math.floor(options.redemptionMs / msPerFrame)` (`frame-processor.ts:108`); **one default threshold pair (0.3/0.25) for every model** | the worklet resamples into exact `frameSamples` |
| *(2026, not a peer app)* **vadonnx** 0.1.0 (`d1b28cf`) | `_infer_frame(frame) -> float` (`base.py:46`); public `process_chunk(audio) -> float` returns **only the most recent frame's probability** (`:72-92`) | a declarative `IOSignature` (sample_rate, frame_size, context_size, state_inputs, state_output_map, prob_extract, multiclass_collapse) for 11 models | `get_speech_segments` | a buffer carries the residual; `flush()` zero-pads the tail |
| *(2026)* **CrispASR** `src/crispasr_vad.*` (`6416b99`) | batch slicing before ASR over Silero · FireRed · MarbleNet · WebRTC · whisper-vad-encdec | per-model **threshold override**: `if (!opts.threshold_explicit && opts.threshold == 0.5f) { effective_threshold = 0.30f;` (`crispasr_vad.cpp:278-279`) | `crispasr_vad_options` | offline, whole buffer |

**Lessons for ctrl-b [REASONED from the rows]:**
1. **The model returns a probability per hop and nothing else** (Pipecat, vad-web, vadonnx, HA). The frameworks that fused the
   policy into the model paid for it: sherpa duplicates it in every model and branches per model in the detector; LiveKit has
   only one VAD plugin for that reason.
2. **Policy durations belong in time units, converted with the model's hop.** HA decrements seconds. Pipecat and vad-web convert
   once. No peer converts the **EMA** — LiveKit's α 0.35 is per 32 ms window, and a 10 ms model with the same α smooths three
   times as fast.
3. **Thresholds must follow the model.** Pipecat (`confidence 0.7` for Silero, Krisp and Quail alike) and vad-web (0.3/0.25 for
   legacy, v5 and v6) share one default across models. CrispASR is the only peer found with a per-model default, and it needs
   an "explicit?" bit to do it.
4. **Keep every hop's probability, and keep the residual.** Three peers lose samples or probabilities at the frame boundary
   (pysilero `process_chunks`, RealtimeSTT's WebRTC, vadonnx `process_chunk`). Pipecat also checks its start/stop counters only
   after its `while` loop (`:235-236`), so an edge is quantized to the caller's buffer, not to its window.

---

## 4. The recommended `VadModel` boundary

### 4.1 The shape: a Strategy (the model) behind one small Adapter per model, and a dict of constructors

```python
class VadModel(Protocol):            # one instance per process per model; owns the ORT session (immutable)
    name: str                        # "silero-v6.2" — the config value, the trail's leg_start field, replay --model
    sample_rate: int                 # 16000 (all live-eligible candidates)
    hop: int                         # samples per probability: 512 · 256 · 160
    delay_hops: int                  # 0 causal; TEN 1 — output j describes hop j - delay_hops
    default_act: float               # ctrl-b's CALIBRATED activation for this model's scale (v5: 0.6 per R84)
    def open(self) -> VadStream: ... # fresh per-leg state; "reset" = open a new one (plan: reset only at leg start)

class VadStream(Protocol):
    def probs(self, pcm: NDArray[np.float32]) -> NDArray[np.float32]:
        """len(pcm) % hop == 0 → exactly len(pcm)//hop probabilities in [0,1], in order; state carried."""

VAD_MODELS: dict[str, Callable[[], VadModel]] = {"silero-v5.1.2": ..., "silero-v6.2": ...}
```

**What stays where:**
- **The adapter owns** context samples (Silero's 64), recurrent state, features (fbank, CMVN, pitch) and collapsing several
  outputs to one P(speech).
- **The Segmenter owns** the residual carry, `first_index`, the delay shift, the flush drain, the pre-roll ring (in samples) and
  the ms→count derivation.
- **The pure policy** keeps its signature and gains a hop-derived counts object:
  `step(state, counts, probs, first_index) → (state, edges)`.
  - `counts = derive(VadParams, hop, sample_rate)` is computed once per leg.
  - It holds: `k_onset = ⌈onset_ms/hop_ms⌉`, `k_end = ⌈silence_ms/hop_ms⌉`, `k_rearm`, `age_bound`, `α = exp(−hop_ms/τ)`,
    `max_windows`, `cut_span = ⌈1000/hop_ms⌉`.
  - This is HA's time-unit lesson, applied without HA's per-chunk float decrement: the golden vectors stay integer and exact.
- **`VadParams` stays in ms.** Replace `ema_alpha` with **`ema_tau_ms` ≈ 30.5**, which is LiveKit's 0.35 per 32 ms:
  τ = −32 / ln 0.35. At 10 ms that gives α = 0.720, and at 16 ms α = 0.592.
- **`act`** = the Conf `vad_threshold` when explicitly set, else `model.default_act`. This is CrispASR's `threshold_explicit`
  precedent. The owner-facing Conf value is only meaningful per model, so a model change must re-seed it (see ⑥).
- **The golden vectors** carry `hop` and `sample_rate` in `params`. The hand-authored set stays at 32 ms. Two extra vectors at a
  10 ms hop pin the ms→count and τ→α derivations. **No per-model thresholds in the policy vectors** — act is a param.
- **Per-model conformance test** (one per registry entry, not per policy):
  - (a) chunk invariance: 40 ms frames vs one block give identical probs. Measured bit-exact for Silero, v6.2-seq and FireRed.
  - (b) a short fixture WAV matches the upstream reference implementation within 1e-5.
  - (c) `len(out) == len(pcm)//hop`.
  - (d) the model's sha256.

Why this shape is the leanest that survives a second model [REASONED]:
- It is two methods and five attributes.
- There is no registry machinery beyond one dict (R24).
- It is the interface every peer converged on: vad-web's `Model`, Pipecat's `voice_confidence` + `num_frames_required`,
  LiveKit's `stream()`. It adds the two things none of them got right: per-model `default_act` and declared `delay_hops`.
- `open()`/stream instead of `new_state()` + a pure function: FireRed's fbank stream and TEN's native handle are objects, not
  arrays. A stream hides that without a second abstraction.

### 4.2 The edge cases a second model brings — what breaks, and the leanest handling

| # | Edge case | What breaks | Leanest handling |
|---|---|---|---|
| ① | **A hop that does not divide the relay's 40 ms frame** (Silero 640/512 = 1.25; TEN-256 2.5) | windows straddle frames; the peers that drop the remainder lose 32–128 samples per frame (§3 lesson 4) | the Segmenter keeps a `< hop` residual and calls `probs()` on the largest multiple of `hop`; `first_index` = leg index of the residual's first sample. One implementation, model-agnostic (HA `chunk_samples`, sherpa `last_`) |
| ② | **Edge sample index** | the plan maps an edge to "window × 512" | `edge_sample = first_index + j·hop` for the window `j` the probability *describes* (after ③). The resampler tolerance is "ONE window (32 ms)" in §3.4; generalise it to one `hop` or 32 ms, whichever is larger |
| ③ | **Lookahead / delay** (TEN: 1 hop = 16 ms; FireRed-stream: +15 ms of fbank window, inside the hop accounting) | a probability arrives `delay_hops` late; edges would land one hop late | declare `delay_hops`; the Segmenter shifts the index; flush **drains** by feeding `delay_hops·hop` zeros; `emit_lag_ms` accounting adds `delay_hops·hop_ms` (16 ms ≪ the 60 ms p95 budget) |
| ④ | **A non-causal model** (MarbleNet ≈ 0.6–1 s; FireRed non-stream 1.6 s; pyannote 10 s) | it cannot meet `emit_lag_ms` p95 < 60 ms; the tentative start loses its point | **refuse at config load** (422): the live door requires `delay_hops·hop_ms ≤ 32`. The same protocol serves the **batch pre-pass**, where lookahead is free (`open().probs(whole_buffer)` + drain). That is the only place these models could ever help |
| ⑤ | **A bool-only model** (WebRTC; sherpa's Python `is_speech`) | the three-band policy (act / deact / EMA) and the tentative edge need a probability | not admitted to the probability path. It goes to the plan's named exit, `EdgeSegmenter` (R95 §8). Measured quality (§2.3) gives no reason to build it |
| ⑥ | **A different probability scale** | one absolute `act` means a different operating point per model (thr@5 %: 0.09 / 0.40 / 0.44 / 0.17) | `default_act` per registry entry, calibrated by the replay tool on the reference set. The Conf threshold applies to the configured model: when `vad_model` changes, the stored threshold returns to "unset" so the model default applies. **The trail logs `model` + `act` at `leg_start`**, so a probability in a trail is interpretable |
| ⑦ | **Own resampling or features** (fbank + CMVN; TEN's LPC pitch) | a feature pipeline that is not bit-faithful changes the model (sherpa's zeroed pitch: "This may reduce performance") | features live inside the adapter. The relay always delivers 16 kHz, so no adapter resamples. Faithful TEN features exist only in its native `.so`: an adapter wraps that library or does not exist |
| ⑧ | **Several outputs** (FireRed AED speech/singing/music; pyannote 7-class powerset; FSMN 2-class logits) | the policy is scalar | the adapter collapses to P(speech): `1 − P(non-speech)`, or the speech column. The policy never sees classes |
| ⑨ | **Batching** | Silero has a batch dim; v6.2-seq takes T windows per call | within a leg: `probs()` already takes k hops, so the v6.2 sequence export turns the plan's "drain every queued frame per wake, ONE executor call" into **one ORT call** (48 µs/window at T=4, bit-exact). Across legs: not needed (≤ 2 legs) |
| ⑩ | **The EMA with a different hop** | α 0.35 per 32 ms becomes a 3× faster filter at 10 ms | `ema_tau_ms` in `VadParams`; `α = exp(−hop_ms/τ)` derived once |
| ⑪ | **Count formulas** (`⌈onset_ms/32⌉`, the re-arm run, `2·onset_ms`, the "lowest window in the last 1 s" cut) | hard-coded 32 ms = wrong durations at another hop | every count comes from `derive(params, hop)`. A 10 ms model sees ~3× as many single-hop crossings, so tentative starts flicker more. The ms-based age bound and re-arm guard keep that bounded in **time**; one 10 ms vector pins it |
| ⑫ | **Pre-roll ring** | defined in windows, it would change with the model | in **samples** (`prefix_padding_ms · 16`), independent of hop. It holds audio, not probabilities |
| ⑬ | **Warm-up / zero-priming** | micro-vad returns −1 for ~760 ms; TEN's first output on zeros was 0.25; Silero #637: zero priming shifts later probabilities | adapter maps "not ready" to 0.0 and documents it. Leg start is where the tentative start matters, so the conformance fixture should include the first 1 s of a leg |
| ⑭ | **State size per leg** | Silero ≈ 1.3 KB; FireRed 76 KB + fbank; TEN a native handle | irrelevant at ≤ 2 legs. A native handle needs deterministic release, so add `VadStream.close()` **only when** such a model is adopted (R24). TEN's ctypes `__del__` already throws `AttributeError` when the library failed to load [MEASURED] |
| ⑮ | **Replay tool `--model`** | captures must be model-independent | they already are (raw 16 kHz post-resampler WAV, §6.1). `--model` = a key of `VAD_MODELS`; the output header prints model, sha256 and the act used. Two `--model` runs side by side are the A/B |
| ⑯ | **Dependencies per model** | the `voice` extra grows | v5/v6/v6-seq: none new · FireRed: `kaldi-native-fbank` (cp314 wheel, 360 KB) · TEN: a system `libc++1` package (install.sh + Termux) plus the licence review. A model's deps load lazily with its constructor, so an unconfigured model costs nothing (council 11's lazy-import rule) |

### 4.3 Corrections the boundary implies for ASR_PLAN §3.4 (for the main seat)

- §3.4 "Model/runtime: Silero v5 … v6 is a later A/B": the evidence (§2) supports **v6.2 as the default and v5 as the A/B**. The
  only stated reason for v5 was Speaches parity, and §6 of the plan dropped that.
- §3.4 "per window `[1, 64+512]`": this becomes the Silero **adapter's** contract, not the engine's.
- `⌈onset_ms/32⌉` → `⌈onset_ms/hop_ms⌉`, and `ema_alpha` → `ema_tau_ms`.
- §3.6's pre-pass keeps Speaches' Silero constants. Through the same protocol it could later A/B FireRed non-stream (AUC 0.965)
  without new seams.

---

## 5. Ranked "try next if Silero fails"

"Fails" here means the TUNE gate or the release card shows phantom segments on negatives, or lost short answers.

1. **Silero v6.2 ↔ v5.1.2** — whichever is not the default.
   - Zero adapter work: same IO, same size, same deps.
   - The measured difference is large (§2.3). The field's default is v6.x: LiveKit bundles v6.2 (same sha256), Pipecat v6.0,
     Wyoming/HA's pysilero v6.2.
   - **Also try** v6.2 with `act` at the replay-tuned value; its scale is higher than v5's.
2. **TEN VAD (native library, hop 256).**
   - Why: ties Silero v6 on noisy real calls (AUC 0.969 vs 0.966, Recho) and on the clean TEN set here (0.956 vs 0.957).
     Finer hop (16 ms). Tiny.
   - Against:
     - It loses at low SNR and on babble (FA 44 % vs 30 %).
     - It fired on kitchen transients (1–3 segments/min).
     - It needs `libc++1` on the host.
     - Its licence carries Agora's non-compete clause. Probably fine for a single-owner homelab ("direct End Users"), but it is
       a licence review, not MIT.
     - Faithful features exist only in the binary.
   - Try it only if v6.2 fails specifically on **onset/offset latency**, TEN's stated strength.
3. **FireRedVAD-stream** — Apache-2.0, pure ONNX + a 360 KB fbank wheel, causal, 10 ms. Measured below Silero v6.2 here (AUC
   0.944, 3.3 babble phantoms/min), and no independent streaming numbers exist. Worth a replay only as a different-family
   control.
4. **For the pre-ASR pass only (batch, lookahead free):**
   - **FireRedVAD non-stream**: AUC 0.965 here; the vendor's FLEURS result; Apache-2.0; 2.4 MB.
   - **MarbleNet v2.0**: best at SNR ≤ 0 dB in Recho's table. NVIDIA Open Model License. Upstream needs NeMo/torch; the ONNX
     path is a third-party port that measured poorly here (unvalidated).
   - This is where a "bigger, better" model can actually buy something: the pre-pass decides whether a segment reaches ASR, and
     it may look ahead.
5. **Not recommended:**
   - WebRTC — bool output; 3–14 phantoms/min; the worst in every independent table.
   - micro-vad — AUC 0.68 here, and a 760 ms warm-up.
   - pyannote — 10 s windows; wrong scale for a stream.
   - SpeechBrain, FSMN — FunASR licence clause; 44 % FA in FireRed's table; 4.7 babble phantoms/min here.
   - PulseVAD/kiloVAD — 200 ms windows; below Silero.
   - Cobra, Quail, Krisp — proprietary, key- or SDK-licensed, vendor-only evidence.
6. **Watch item:** foreground/speaker-selective VAD (Mamba-FVAD, arXiv 2609.19856). It is the only line of work aimed at the
   radio/passenger/echo class. Unreleased as of 2026-09-30.

---

## 6. Corrections and amendments to L4 / R95 / R97

- **R95 §C3 and L4 "sherpa-onnx VAD = bool, no probability"**: true of the **Python** binding (`vad-model.cc:23` exposes only
  `is_speech`). The C++ `VadModel` has had `virtual float Compute(...)` (`vad-model.h:35` @ `040afe3`). sherpa's policy is still
  duplicated inside each model (§3), so the plan's conclusion (not sherpa) stands.
- **L4 §5 / ASR_PLAN §9 on FireRedVAD**: now **MEASURED**. The streaming model is causal (no look-ahead filter in its ONNX graph)
  and bit-exact with its whole-sequence form. Streamed here it ranks **below** Silero v6.2, not above it. The vendor headline
  belongs to the non-streaming model (1.6 s of look-ahead).
- **L4 §1.2 "v5 and v6 alike ~81 µs"**: re-measured 83–84 µs in a Python loop (75 µs raw ORT). New: the **v6.2 sequence
  export** (release v6.2.2, 2026-09-17) runs 42–58 µs/window batched, bit-exact, with state carry. L4 read `sequence_vad.py`'s
  docstring but did not note that the model takes and returns `h`/`c` and is therefore streamable.
- **L4 §5 TEN**: add that the prebuilt Linux library needs `libc++.so.1` / `libc++abi.so.1`, which is not installed on emma. The
  pip install succeeds and the import fails. Also add the one-hop lookahead (`AUP_AED_LOOKAHEAD_NFRM`).
- **R97 finding 8 / ASR_PLAN §3.4 EMA**: "α 0.35" is only LiveKit's value **per 32 ms window**. It must be expressed as a time
  constant to survive a model change (§4.2 ⑩).
- **R84 §1 (#685: v6 distributions "can sit lower than v5's")**: on this test set v6.2 sits **higher** on speech (p50 0.998 vs
  0.990; thr@5 % 0.40 vs 0.09). The direction is dataset-dependent. The conclusion stands: a version swap is a re-calibration
  event.

---

## 7. ASR-side sanity (Q5)

**CrispASR** (`6416b99`):
- It serves `POST /v1/audio/transcriptions` (`examples/cli/crispasr_server.cpp:2027`) with the OpenAI field names (`file`,
  `language`, `prompt`, `temperature`, `response_format`).
- It reads every field **by name with a default**, `form_string(req, key, def)` (`:257-265`), so **unknown multipart fields are
  ignored, not rejected**.
- `hotwords` is a recognised field (`rp.hotwords = form_string(req, "hotwords", …)`). `vad_filter` is not: CrispASR's own knob is
  `vad` (bool, default `false`, `whisper_params.h:93`), so `vad_filter` would be silently ignored.
- Only two fields can 400: `response_format` outside {json, verbose_json, text, srt, vtt, diarized_json}, and `language` that
  fails `validate_request_language` (`:403-423`). For `--backend parakeet` the language check always passes: the whisper check
  applies only to the whisper backend, and "sole-language" only to moonshine/gigaam.

**onnx-asr** (`675f0e6`, v0.12.0): a library plus a CLI with **no HTTP server** (no `transcriptions` route, no web framework in the
tree). The OpenAI shape exists only through a wrapper such as Speaches.

So the plan's T-5 concern resolves to this: CrispASR tolerates extra fields; onnx-asr has no endpoint to reject them.

---

## 8. Method (reproducible)

- **Work dir:** `/home/emma/.cache/tmp/r98/` (clones deleted after; the venv is kept). The venv is Python 3.14.4 with onnxruntime
  1.30.0, numpy 2.5.3, kaldi-native-fbank 1.22.3, kaldiio, webrtcvad-wheels 2.0.14 (built from sdist), pymicro-vad 2.1.0,
  pysilero-vad 3.4.0, ten-vad 1.0.6.8 (plus `libc++1`/`libc++abi1` 22.1.2 extracted with `dpkg -x`, on `LD_LIBRARY_PATH`),
  sherpa-onnx 1.13.8 and vadonnx 0.1.0 [fsmn].
- **Contracts:** `onnxruntime.InferenceSession(...).get_inputs()/get_outputs()` on every ONNX file. The FireRed look-ahead comes
  from `onnx.load` Conv attributes. The receptive fields of the ported models were probed by perturbing 10 ms of input at t = 3 s
  and diffing the outputs.
- **Scripts:** `models_lib.py` (streaming wrappers, hop by hop), `bench.py` (AUC, FA/miss at default and matched thresholds,
  onset, short recall, noise-only segments), `bench_offline.py` (whole-file references via vadonnx, plus FireRed non-stream) and
  `bench_policy.py` (the ctrl-b-like policy). Raw results are in `results_all.json` and `results_offline.json`.
- **Data:** the TEN test set (`ten-vad/testset`, 30 files, 262 s — the vendor's set). DEMAND (Zenodo record 1227121) TCAR,
  PCAFETER and DKITCHEN `ch01`, 16 kHz, 300 s each (180 s used for noise-only). The noise offset is random (seed 98). SNR is
  computed over the speech-labelled samples.
- **Timing:** mean over one file's hops. Single-thread ORT (`intra_op=1`, `inter_op=1`, `allow_spinning=0`). Other ctrl-b lanes
  were running on the box, so treat the numbers as ±15 %.

## 9. What I could not determine

- **Real car audio.** DEMAND TCAR is raw cabin noise. It is not audio that has been through the phone's NS/AEC and Bluetooth
  HFP. The captured reference set (§6.1) is the only valid judge.
- **Echo/TTS-leak residue and a real radio**: not synthesised. By §2.2 no generic model is expected to reject them.
- **Word-level short answers ("yeah", "sí", "vale")**: only 16 short labelled segments exist in the set (all found by the neural
  models). Spanish is untested.
- **MarbleNet, SpeechBrain, FSMN and pyannote quality** were measured through a third-party port (vadonnx 0.1.0) whose feature
  frontends were not validated against NeMo/SpeechBrain/FunASR. The MarbleNet AUC 0.869 is probably a lower bound. Recho reports
  0.979 clean.
- **TEN via a pure-ONNX path** (numpy mel + pitch) against its native library: parity not tested. Only the native library was
  measured.
- **Picovoice Cobra**: not measured (an AccessKey is required). Frame length and lookahead UNVERIFIED.
- **An independent streaming benchmark of FireRedVAD**: none exists. FLEURS-VAD-102 is still unreleased. The Silero version in
  FireRed's own table is unstated.
- **Whether a v5 sequence export exists**: upstream ships the sequence model for the current (v6.2) weights only.
- **aarch64 / Termux wheels** for kaldi-native-fbank, pysilero-vad and TEN: not checked. x86_64 cp314 only.
- **When sherpa's `Compute()` was introduced**: not traced (shallow clone).

## 10. Open sweep (Q6)

1. **The Silero v6.2 sequence export makes the relay's batch-drain one ORT call and the pre-pass GIL-free.** It is bit-exact
   with per-window v6.2 when `h`/`c` are carried [MEASURED]. It is available for v6.2 only, which is one more reason the default
   should be v6.2 (§4.3).
2. **TEN's pip package is a deployment trap on stock Ubuntu.** It installs cleanly and fails at import on the missing `libc++.so.1`.
   Its destructor then raises a second error [MEASURED]. Any adoption needs the system package in `install.sh`, or it will
   degrade the ear silently.
3. **pysilero-vad `process_chunks` loses audio.** An exact multiple of 512 samples yields one probability too few (512 → 0), and
   the residual is never carried [MEASURED]. It is the most-deployed non-ORT Silero wrapper (Wyoming/HA). If ctrl-b ever
   reaches for it to shed ORT/numpy, wrap `process_chunk` with our own residual carry, never `process_chunks`.

## Sources

Clones (all 2026-09-30, shallow, default branch):
- `snakers4/silero-vad` `1e261b0` (2026-09-29) — `src/silero_vad/sequence_vad.py`; `data/silero_vad_16k_sequence.onnx`
- `TEN-framework/ten-vad` `22a3bcd` — `include/ten_vad.py`; `src/aed_st.h:15-36`; `src/aed.cc:256,983`; `LICENSE`;
  `examples/plot_pr_curves.py`; `testset/`
- `FireRedTeam/FireRedVAD` `c30ec49` — `fireredvad/core/{detect_model,audio_feat,stream_vad_postprocessor}.py`;
  `fireredvad/stream_vad.py`; `pretrained_models/onnx_models/*`
- `pipecat-ai/pipecat` `49dea68` — `src/pipecat/audio/vad/{vad_analyzer,silero,aic_quail_vad,krisp_viva_vad}.py`
- `livekit/agents` `d251b89` — `livekit-agents/livekit/agents/vad.py`; `livekit-plugins-silero/.../{vad,onnx_model}.py`
- `k2-fsa/sherpa-onnx` `040afe3` — `sherpa-onnx/csrc/{vad-model.h,voice-activity-detector.cc,silero-vad-model.cc,ten-vad-model.cc}`;
  `python/csrc/vad-model.cc`
- `home-assistant/core` `dd2a9ed` — `homeassistant/components/assist_pipeline/{vad,audio_enhancer}.py`
- `rhasspy/wyoming` `08a0c25` (`wyoming/vad.py`) · `rhasspy/wyoming-faster-whisper` `f8e8b0e` · `rhasspy/pymicro-vad` `32bc8dd`
- `KoljaB/RealtimeSTT` `7777275` — `RealtimeSTT/core/voice_activity.py`
- `ricky0123/vad` `2e5aca9` — `packages/web/src/{frame-processor.ts,models/common.ts,real-time-vad.ts}`
- `TigreGotico/vadonnx` `d1b28cf` — `vadonnx/{base,signature,registry}.py`, `docs/streaming.md`
- `CrispStrobe/CrispASR` `6416b99` — `examples/cli/crispasr_server.cpp`, `examples/cli/whisper_params.h`,
  `src/crispasr_vad.{h,cpp}`
- `istupakov/onnx-asr` `675f0e6` · `NVIDIA/NeMo` `00278b0` (sparse) · `wiseman/py-webrtcvad` `e283ca4`

Packages (PyPI JSON, 2026-09-30): onnxruntime 1.30.0 · numpy 2.5.3 · silero-vad 6.2.3 · pysilero-vad 3.4.0 · pymicro-vad 2.1.0 ·
ten-vad 1.0.6.8 · fireredvad 0.0.2 · webrtcvad-wheels 2.0.14 · sherpa-onnx 1.13.8 · pvcobra 3.0.3 · kaldi-native-fbank 1.22.3 ·
vadonnx 0.1.0 · pyannote.audio 4.0.7 · torch 2.14.0 · nemo_toolkit 3.0.0.

Models: Silero v5.1.2 / v6.0 / v6.2 raw files at their tags · `huggingface.co/nvidia/Frame_VAD_Multilingual_MarbleNet_v2.0` (card)
· `TigreGotico/{frame-vad-marblenet,pyannote-segmentation-3.0,fsmn-vad,sb-vad-crdnn}-onnx` · `FireRedTeam/FireRedVAD` (Apache-2.0)
· `funasr/fsmn-vad` · FunASR `MODEL_LICENSE` v1.1.

Papers and other sources:
- arXiv [2609.19856](https://arxiv.org/abs/2609.19856) (Recho, Foreground VAD, Table I + VOiCES)
- arXiv [2603.10420](https://arxiv.org/abs/2603.10420) (FireRedASR2S, §4.3, Table 3)
- arXiv [2609.11110](https://arxiv.org/abs/2609.11110) (S4VAD, Tables I–II)
- arXiv [2607.25870](https://arxiv.org/abs/2607.25870) (kiloVAD, Table 1)
- arXiv [2508.20885](https://arxiv.org/abs/2508.20885) (SincQDR-VAD)
- silero-vad [discussion #593](https://github.com/snakers4/silero-vad/discussions/593) and releases v6.2–v6.2.3
- Picovoice [VAD benchmark](https://picovoice.ai/docs/benchmark/vad/) and [2026 blog](https://picovoice.ai/blog/best-voice-activity-detection-vad/) (vendor)
- DEMAND noise corpus, [Zenodo 1227121](https://zenodo.org/records/1227121)
