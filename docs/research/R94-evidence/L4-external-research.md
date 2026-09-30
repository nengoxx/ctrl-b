# Lane 4 — external research for the R94 live-voice redesign (2026-09-28)

Scope: verify A4/A5 outside-project claims; streaming-VAD semantics; flood-guard precedent; ASR host candidates on emma.
Method: shallow clones under `/home/emma/.cache/tmp/r94-research` (now deleted), GitHub/PyPI APIs, vendor docs, and **measurements run on emma**. "MEASURED" means I ran it on emma today. "UNCONFIRMED" means I could not find a primary source.

**Host (MEASURED):**
- Linux 7.0.0-31, Python 3.14.4, AMD Ryzen 7 8745HS, 16 threads, 30 GB RAM.
- Vulkan: `AMD Radeon 780M Graphics (RADV PHOENIX)`, Mesa 26.0.3.
- ctrl-b `backend/.venv` has **no** numpy, onnxruntime, torch, silero_vad or onnx_asr today (checked with `importlib.util.find_spec`).

**Today's baseline (MEASURED):**
- The deployed Speaches runs Parakeet through **onnx-asr 0.7.0** with the **fp32** model `istupakov/parakeet-tdt-0.6b-v3-onnx`: `encoder-model.onnx.data` is 2.4 GB, and `executors/parakeet.py` calls `_get_model_files(quantization=None)`.
- Its VAD is faster-whisper's split `silero_encoder_v5.onnx` / `silero_decoder_v5.onnx` (`~/github/speaches@fd4b956`, `src/speaches/executors/silero_vad_v5.py:148`).
- The `speaches` unit's MemoryCurrent is about 3.2 GB.

---

## 1. Streaming VAD done right

### 1.1 Silero's own `VADIterator`

Source: `snakers4/silero-vad@5cd7945` (package v6.2.3), `src/silero_vad/utils_vad.py:591-682`.

**Defaults:** `threshold=0.5`, `min_silence_duration_ms=100`, `speech_pad_ms=30`.

**There is no `min_speech` / onset confirmation.** START fires on the **first** 32 ms window with `p ≥ threshold`. The start is back-dated by `speech_pad + window` samples.

**The end rule:**
- The first window with `p < threshold − 0.15` (hardcoded; no `neg_threshold` parameter here) arms `temp_end`.
- Any window with `p ≥ threshold` clears it.
- END fires once `current_sample − temp_end ≥ min_silence`, placed at `temp_end + speech_pad − window`.

**State:** `reset_states()` zeroes the model's LSTM state and context. Otherwise, **state carries across every call.**

**Compared with the batch function:** `get_speech_timestamps` (`:281`) defaults to `min_speech_duration_ms=250`, `min_silence_duration_ms=100` and `speech_pad_ms=30`, and it does take `neg_threshold`. Speaches overrides `min_speech_duration_ms` to **0** (`silero_vad_v5.py` `VadOptions`).

**⇒ Takeaway for ctrl-b.** `VADIterator` is the right *state* model but too thin as a *policy*. Onset confirmation and a pre-roll ring must be added, as LiveKit and sherpa do.

### 1.2 ONNX-only Silero with persistent state (no torch)

**Don't depend on the `silero-vad` pip package.** Its `pyproject.toml` has `dependencies = ["packaging", "torch>=1.12.0"]` unconditionally, even with `[onnx-cpu]`. Take the `.onnx` file and write about 30 lines. The contract, which I checked with `InferenceSession.get_inputs()` on both v5 and v6 (MEASURED):

| | Name | Shape / type |
|---|---|---|
| Input | `input` | float32 `[B, 64+512]`, which is the **64-sample context** (the last 64 samples of the previous *input*) plus a 512-sample window at 16 kHz. At 8 kHz it is 32+256. |
| Input | `state` | float32 `[2, B, 128]` |
| Input | `sr` | int64 scalar |
| Output | `output` | `[B, 1]`, the probability |
| Output | `stateN` | fed back as the next call's `state` |

- The reference wrapper is `OnnxWrapper.__call__` (`utils_vad.py:109-144`). It uses `intra_op_num_threads=1` and `inter_op_num_threads=1`, and resets on a sample-rate or batch change.
- The v5 file is `https://github.com/snakers4/silero-vad/raw/v5.1.2/src/silero_vad/data/silero_vad.onnx` (md5 `ad78afa8…`). Master's file is v6 (md5 `302cb198…`). **They differ**, and A5's "tune v6 separately" caveat stands.
- **"Same generation as Speaches" nuance:** Speaches runs faster-whisper's *split* encoder/decoder v5 export, not the single-file v5. For a byte-identical A/B, reuse those two files. That means `encoder(input)` then `decoder(input=enc, state)` per window, exactly as `silero_vad_v5.py:111-130` does, but with state carried across calls instead of `np.zeros` per call.
- **UNCONFIRMED:** that the split export and the single-file v5 give bit-equal probabilities.

**CPU cost (MEASURED on the 8745HS, onnxruntime 1.30.0, 1 thread, 3000 frames):**
- v5 and v6 alike cost about **81 µs per 512-sample window**. At 31.25 windows/s per leg that is **about 0.25 % of one core**.
- Silero's README claims "< 1 ms per 30+ ms chunk on one thread" (README.md:117), which is consistent.
- onnxruntime `run()` releases the GIL (stated in silero-vad `src/silero_vad/sequence_vad.py` docstring: "the ONNX kernels themselves release the GIL").

**⇒ On the event loop.** 81 µs inline on the uvicorn loop is tolerable. LiveKit and Pipecat both off-load it anyway (below). A single-worker executor per process is the conventional shape.

### 1.3 How the frameworks do onset, pre-roll, end hysteresis and reset

| | **LiveKit** `livekit-plugins-silero` (`livekit/agents@57b3227`, `vad.py`, `onnx_model.py`) | **Pipecat** `VADAnalyzer` + `SileroVADAnalyzer` (`pipecat-ai/pipecat@07a1d8c`) | **sherpa-onnx** `VoiceActivityDetector` (`k2-fsa/sherpa-onnx@040afe3`, `csrc/silero-vad-model.cc`, `voice-activity-detector.cc`, `silero-vad-model-config.h`) |
|---|---|---|---|
| Start threshold | `activation_threshold=0.5` | `confidence=0.7` **AND** smoothed `volume ≥ min_volume=0.6` | `threshold=0.5` |
| End threshold | `deactivation_threshold = max(act−0.15, 0.01)`. While speaking, `p > deact` counts as speech. | Same `confidence`, so no hysteresis band. | `neg_threshold = max(thr−0.15, 0.01)` |
| Probability smoothing | `ExpFilter(alpha=0.35)`: `f = 0.35·f + 0.65·p` (`utils/exp_filter.py:38-45`) | Volume only: exp-smoothing factor 0.2 | none |
| **Onset confirmation** | `min_speech_duration=0.05` s: consecutive speech windows accumulate. **Any** non-speech window resets the accumulator. | `start_secs=0.2`: STARTING state needs `round(0.2/0.032)=6` consecutive speech windows. One miss returns it to QUIET. | `min_speech_duration=0.25` s via `temp_start_`; a sub-threshold window resets it. |
| End | `min_silence_duration=0.55` s of consecutive non-speech | `stop_secs=0.2` (STOPPING; speech returns it to SPEAKING) | `min_silence_duration=0.5` s |
| **Pre-roll** | `prefix_padding_duration=0.5` s. While not speaking, the write cursor is rewound to keep the last 0.5 s (`_reset_write_cursor`). The START event carries the buffered frames. | Not in the VAD. `SegmentedSTTService` keeps the last **1 s** of audio while not speaking (`stt_service.py:1003-1005`). | Implicit: the segment start is `tail − 2·WindowSize − min_speech_samples`, about 2·576 + 4000 samples ≈ **320 ms** at defaults. |
| Max segment | `max_buffered_speech=60` s, then drops further audio with a warning | – | `max_speech_duration=20` s, after which the threshold is **raised to 0.9** and min_silence to 0.1 s until the segment ends |
| Model state reset | Only on flush/`_reset_state` (`model.reset()` zeroes state and context). State **persists across segments.** | **Every 5 s of wall time**, unconditionally (`silero.py:_MODEL_RESET_STATES_TIME = 5.0`, "memory will keep growing otherwise") | Only on explicit `Reset()`. State persists across segments. |
| Threading | `run_in_executor(None, model, …)`; warns if the inference loop falls > 0.2 s behind real time | Own `ThreadPoolExecutor(max_workers=1)` | Native (C++) |
| Bundled model | Hash `ebcdad74…` matches neither v5.1.2 nor v6.0/master (**version UNCONFIRMED**). `onnx_file_path` can point at v5. | v6.0 (md5 equals the v6.0 tag) | v4/v5 supported; v5 `window_overlap_=64` |

**Notes:**
- Pipecat's periodic 5 s reset contradicts A5's claim that "LiveKit, Pipecat and sherpa-onnx carry recurrent state forward". Pipecat does carry it, but only within 5 s windows. LiveKit and sherpa are the better templates.
- A4 §9 on RealtimeSTT ("preserves recurrent state") was **not re-verified**. It was out of scope and is deferred.

**⇒ A defensible starting policy (all values are sourced precedent):**
- v5 model, state never reset mid-leg;
- `act` 0.5–0.6, with `deact = act − 0.15`;
- optional EMA of 0.35 on the probability (LiveKit);
- onset confirmation of 0.1–0.25 s of *consecutive* speech windows (the LiveKit 0.05 to sherpa 0.25 span; Pipecat 0.2);
- pre-roll ring of 0.3–0.5 s, plus the confirmation window (LiveKit 0.5, sherpa ~0.32, Pipecat 1.0);
- end at 0.5–0.7 s (ctrl-b's 700 is within range);
- max segment of 20–30 s, with sherpa's raise-the-threshold trick as a cheap safe cut.

---

## 2. Flood guarding a real-time ingress

### 2.1 What real services do

| Service | Rule | On violation |
|---|---|---|
| **Deepgram** (live WS) | "Deepgram allows audio to be streamed at a maximum of **1.25x realtime**, if you send a large buffer of audio, the stream may wind up being significantly delayed." It *recommends* buffering audio during a disconnect and re-sending it. ([Recovering from connection errors](https://developers.deepgram.com/docs/recovering-from-connection-errors-and-timeouts-when-live-streaming-audio)) | **Throttle** (delay), not close. The only close is "no audio within 10 s of opening" (same page). |
| **AssemblyAI** (Universal Streaming v3) | Error **3007** "Audio transmission rate exceeded: too much audio buffered". A "built-in throttle at approximately **1.25× real-time**", closing only when **> 5 minutes** of audio is buffered ahead of processing. Chunks must be 50–1000 ms. ([Message sequence](https://www.assemblyai.com/docs/streaming/message-sequence), [API ref](https://www.assemblyai.com/docs/api-reference/streaming-api/universal-streaming)). Clients are told to pace by wall clock: `next = start + n·chunk` ([guide](https://www.assemblyai.com/docs/streaming/guides/stream_prerecorded_file_realtime)). | **Throttle**, then close only on a huge backlog. |
| **Google Cloud STT** (gRPC streaming) | The server error "Audio data is being streamed too fast. Please stream audio data approximately at real time." (and the "too slow" twin, OUT_OF_RANGE) is confirmed in user reports: [python-docs-samples#364](https://github.com/GoogleCloudPlatform/python-docs-samples/issues/364), [#742](https://github.com/GoogleCloudPlatform/python-docs-samples/issues/742), [android-docs-samples#37](https://github.com/GoogleCloudPlatform/android-docs-samples/issues/37). The often-quoted "tolerates 50 % divergence" is **UNCONFIRMED**: no primary source found. | Stream error (close) |
| **OpenAI Realtime** | `input_audio_buffer.append` allows "up to a maximum of 15 MiB" per event. **No published pacing or rate rule** was found ([client events ref](https://developers.openai.com/api/reference/resources/realtime/client-events)). | n/a |
| **WebRTC NetEq** (jitter buffer) | Bursty or late arrival is absorbed. NetEq compares the filtered buffer level with an adaptive target delay and **time-stretches (accelerates)** to drain the excess. Packets too late for playout are discarded. "If the buffer is full, discard all the existing packets (this should be rare)." ([NetEq g3doc](https://github.com/webrtc-sdk/webrtc/blob/m125_release/modules/audio_coding/neteq/g3doc/index.md)) | **Degrade** (accelerate/drop), never disconnect |
| LiveKit / Janus / mediasoup | RTP over UDP: bursts are the jitter buffer's and congestion control's problem. **Not researched further**; no evidence of per-stream "audio-rate" disconnects. | – |

### 2.2 Verdict on the R94 §2.4 invariant

**Yes, it is established.** "A real-time source cannot be meaningfully ahead of the wall clock" is exactly what Deepgram and AssemblyAI enforce: a token bucket refilled at 1.25× wall clock. Google enforces it as an error. **Every one of them throttles or buffers first; none closes on a short burst.** Closing is reserved for gross backlog (AssemblyAI: 5 min) or no audio at all.

**The refinement the invariant needs.** The pure cumulative form, `audio_ms ≤ elapsed + slack`, lets unused credit accrue without bound: a client idling at 50 % could later dump minutes of audio. Credit is capped in practice by ctrl-b's 15 s `uplink_idle_s` only for full silence, not for a slow sender. The standard fix is a **token bucket**:
- rate 1.0× (or 1.25×, per Deepgram/AssemblyAI) of wall time;
- capacity B ≈ the largest stall you will forgive (e.g. 5–10 s of audio, which is ≥ the 2–4 s mobile stalls seen in the prod log);
- a per-frame-count twin at the same rate.

**On overflow, degrade rather than close**, i.e. drop the oldest audio and send one `degraded` notice (the NetEq and Deepgram posture). Close (1008) only at a gross multiple, e.g. > 2B over.

**A second option on a TCP transport:** simply *stop reading* the socket when over budget. TCP backpressure then pushes the excess into the client's `bufferedAmount`. Caveat: ctrl-b's `liveSocket.ts` closes 4000 on `bufferedAmount` > `buffered_ceiling_ms`, so this merely moves the kill to the client unless that ceiling is revisited. This is my inference, not a sourced pattern.

---

## 3. ASR host candidates — A4/A5 claims verified

### 3.1 mudler/parakeet.cpp — **EXISTS; A4's claims essentially all HOLD**

**Project facts:**
- Repo created 2026-05-28, MIT, ~790★, HEAD `3a1e15e` (2026-09-28).
- Latest release **v0.5.0 (2026-08-01)**, with assets `parakeet-v0.5.0-bin-linux-{cpu,vulkan,cuda,cuda12}-x64.tar.gz` (GitHub releases API). **Each bin tarball contains both `parakeet-cli` and `parakeet-server`** (checked by extracting it; `release.yml:3-6`). The Vulkan build needs only `libvulkan.so.1`, which is present on emma.

**Server flags** (`examples/server/main.cpp:51-74`): `--model <path|url|alias> [--host 127.0.0.1] [--port 8080] [--threads N] [--cache-dir <dir>]`. **The default bind is 127.0.0.1** (the Docker image binds 0.0.0.0).

**Model aliases** (`examples/server/README.md`, `model_fetch.cpp:27`):
- `tdt-0.6b-v3` → `tdt-0.6b-v3-f16.gguf` (1.44 GB), cached under `~/.cache/parakeet.cpp/models`.
- Also on [HF mudler/parakeet-cpp-gguf](https://huggingface.co/mudler/parakeet-cpp-gguf): `q8_0` 0.94 GB, `q6_k` 0.81, `q5_k` 0.74, `q4_k` 0.68.

**API:** `POST /v1/audio/transcriptions`, multipart `file` (**WAV only**, otherwise 400). WAV at any sample rate is accepted and resampled internally (`main.cpp:25`). `response_format` is `json` (default, `{"text": "..."}`), `text` or `verbose_json` (one segment plus words with `conf`). `timestamp_granularities[]=word`. `GET /health` returns `{"status":"ok"}`.

**Ignored parameters:**
- `model`, `temperature` and `prompt` are ignored.
- **`language` is ignored.** `verbose_json` reports a fixed `en` placeholder, and v3 auto-detects.

**Concurrency:** **inference is serialised by a mutex** (`main.cpp:109,154`). Upstream calls it "an example, not a production service".

**Known Vulkan issues:**
- [#62](https://github.com/mudler/parakeet.cpp/issues/62) (open, 2026-08-15): **Radeon 880M (RDNA 3.5) on Windows**, where `vkCreateDevice` fails with `ErrorExtensionNotPresent` on a bf16-less device. Workaround: `GGML_VK_DISABLE_BFLOAT16=1`.
- [#55](https://github.com/mudler/parakeet.cpp/issues/55) (open): Vulkan OOM on inputs longer than 5 min (GTX 1660). Irrelevant for our clip sizes.
- **On emma (RADV, Mesa 26.0.3) it ran cleanly** (MEASURED): `ggml_vulkan: 0 = AMD Radeon 780M Graphics (RADV PHOENIX) | uma: 1 | fp16: 1 | bf16: 0 | … matrix cores: KHR_coopmat`, then `using device: Vulkan0`. Despite `bf16: 0` there was no #62 failure on Linux.
- Adjacent evidence: CrispASR documents **RADV 780M crashes in ggml-Vulkan `FLASH_ATTN_EXT`** ([CrispASR docs/tts.md, issue #402](https://github.com/CrispStrobe/CrispASR)) and a `maxComputeWorkGroupCount` abort on 780M/gfx1103 (#256). Both affect TTS models there. **Treat ggml-Vulkan on 780M as "works for Parakeet today; pin the Mesa and parakeet.cpp versions".**

### 3.2 sherpa-onnx Parakeet v3 int8 — A4's API claims HOLD; the bug history is real

**Packaging and API:**
- PyPI `sherpa-onnx` 1.13.8 (2026-09-10) has a cp314 manylinux wheel of 4.4 MB, plus `sherpa-onnx-core` (10.6 MB). `sherpa-onnx-bin` exists (19 MB, CLI binaries only; not needed for the Python API).
- API: `sherpa_onnx.OfflineRecognizer.from_transducer(encoder, decoder, joiner, tokens, …, model_type="nemo_transducer")`, with files `encoder.int8.onnx`, `decoder.int8.onnx`, `joiner.int8.onnx` and `tokens.txt` (`python-api-examples/offline-nemo-parakeet-decode-file.py`).
- The Python `VoiceActivityDetector` (Silero v5 or TEN, persistent state) is in the same wheel.

**Empty/missing-decode history (GitHub issues):**

| Issue | Status | What |
|---|---|---|
| [#2258](https://github.com/k2-fsa/sherpa-onnx/issues/2258) | open, 2025-05 | v2 returns empty text on some GigaSpeech files. onnx-asr and HF transcribe them fine. |
| [#3767](https://github.com/k2-fsa/sherpa-onnx/issues/3767) | open, 2026-07 | **All NeMo TDT offline decodes empty on Windows**, 1.13.3–1.13.4, int8 and fp32. Linux not reported. |
| [#3267](https://github.com/k2-fsa/sherpa-onnx/issues/3267) / [#3657](https://github.com/k2-fsa/sherpa-onnx/issues/3657) | open | `modified_beam_search` with TDT hallucinates or is empty ~20 %. Greedy is unaffected. |
| [#3997](https://github.com/k2-fsa/sherpa-onnx/issues/3997) / [#3999](https://github.com/k2-fsa/sherpa-onnx/issues/3999) | open, 2026-09-27, against 1.13.8 | The NeMo mel log floor `log(max(E, FLT_EPSILON))` vs NeMo's `log(E + 2^-24)` **degrades quiet audio** (below about −50 dBFS). Reported WER impact on English quiet audio is 15.2 → 7.9 % with the fix, and v3 is affected. **Relevant to the car/far-field case.** |

Fixed in the CHANGELOG: "Fix TDT decoding for NeMo TDT transducers (#2606)" in **1.12.14**; "Fix float32 catastrophic cancellation in NemoNormalizePerFeature (#3857)" in **1.13.5**.

**⇒** sherpa is viable, but it is the only candidate with an open, relevant accuracy defect (#3997), and it has no Vulkan path for us. It ranks behind parakeet.cpp and onnx-asr.

### 3.3 CrispASR — **EXISTS; A4's flags HOLD**

- `CrispStrobe/CrispASR`: created 2026-03-29, MIT, HEAD `2cd383a`.
- Latest release is **v0.8.38 (2026-09-28)**. A4's v0.8.37 (09-25) was correct when written.
- Linux assets: `crispasr-linux-x86_64{,-avx512,-cpu-legacy,-vulkan,-hip,-cuda,-cuda13}.tar.gz`.
- Flags exist as A4 wrote them: `--server --host --port --backend parakeet --gpu-backend vulkan -m auto -dev N` (`examples/cli/cli.cpp:387-404,795-800`). The default host is `127.0.0.1:8080` (`whisper_params.h:352`).
- It serves `POST /v1/audio/transcriptions` (`crispasr_server.cpp:2027`), serialises one model by default, and `--server-workers N` adds instances (README).
- The streaming VAD default is `min_speech 250 ms` (`examples/server/server.cpp:133`).
- It is a big multi-engine stack (TTS, LID, punctuation…). As a dumb Parakeet host it is a heavier twin of parakeet.cpp; both are ggml. **Not benchmarked.**

### 3.4 onnx-asr in-process — **the zero-parity-risk option; viable**

**Project and footprint:**
- `istupakov/onnx-asr`: MIT, latest **v0.12.0 (2026-07-15)**. Speaches pins `>=0.7.0` and has 0.7.0 installed.
- Dependencies: `numpy` only, plus the `[cpu]` extra `onnxruntime>=1.18.1, !=1.24.1, !=1.25.*, !=1.26.0`, plus the optional `[hub]` extra huggingface-hub. It declares Python 3.14 and free-threading classifiers.
- **Installed and ran fine on emma's Python 3.14.4** with onnxruntime 1.30.0 (cp314 wheel, 23.6 MB) and numpy 2.5.3.
- Footprint (MEASURED): the venv is 161 MB total (onnxruntime 67 M, numpy 70 M, onnx_asr 7 M including bundled preprocessor/resampler ONNX graphs). **torch is not required.**

**API:**
- `onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v3", path=<local dir>|None, quantization=None|"int8", providers=[…], sess_options=…)`.
- `model.recognize(np.float32 array | wav path, sample_rate=16000)` returns a str (`adapters.py:92-118`, `loader.py:310-318`).
- **`path=` can point at the existing HF snapshot**: no download, the same bytes Speaches uses today.

**Bundled VAD:** yes, but it is **batch segmentation only**. `SileroVad` in `models/silero.py` runs a whole buffer and downloads `istupakov/silero-vad-onnx`. It is **not** a streaming iterator, so it is not useful for the relay. That is fine: use the ~30-line ONNX wrapper from §1.2.

**Caveat:** Speaches' non-streaming path also runs its batch VAD and transcribes merged segments (`executors/parakeet.py:131-146`). A direct call on a whole relay-cut segment is the *model*-parity case, not a byte-identical *pipeline*.

**CPU cost (MEASURED, 8745HS, default ORT threads, Speaches idle in the background, 5 runs each, p50):**

| Clip | onnx-asr fp32 (today's model) | onnx-asr int8 |
|---|---|---|
| 0.3 s | 97 ms | 51 ms |
| 0.8 s | 155 ms | 102 ms |
| 1.5 s | 173 ms | 132 ms |
| 3 s | 185 ms | 176 ms |
| 5 s | 242 ms | 289 ms |
| 10 s | 648 ms | 360 ms |
| Load time | 11 s | 14.5 s |
| Peak RSS | 2.65 GB | 1.26 GB |

**Conclusion:** onnx-asr in the ctrl-b process is feasible and gives model parity. The cost is about 2.7 GB RSS (fp32) inside the backend process, plus ASR crash and CPU coupling with the web server. That argues for keeping ASR **out of process** (a sidecar) even though the in-process option exists.

---

## 4. CPU vs Vulkan on the 780M — **no published numbers found; measured here instead**

**Published data:**
- Web search found nothing for Parakeet TDT 0.6B on a 780M or any AMD APU.
- parakeet.cpp's `benchmarks/BENCHMARK.md` has CPU numbers on a Ryzen 9 9950X3D and GPU numbers on NVIDIA GB10 and Apple M4 only.

**Setup:** `parakeet-server` v0.5.0 on emma; HTTP round trip via curl on localhost (so it includes the WAV upload); 5 runs each, **p50**; audio is a speech sample resampled to 16 kHz.

| Clip | CPU f16 | **Vulkan f16** | CPU q8_0 | **Vulkan q8_0** |
|---|---|---|---|---|
| 0.3 s | 57 ms | 68 ms | 51 ms | 64 ms |
| 0.8 s | 84 ms | 112 ms | 76 ms | 106 ms |
| 1.5 s | 123 ms | 120 ms | 108 ms | 119 ms |
| 3 s | 207 ms | **125 ms** | 175 ms | **117 ms** |
| 5 s | 310 ms | **157 ms** | 313 ms | **125 ms** |
| 10 s | 625 ms | **251 ms** | 614 ms | **230 ms** |

**Other measurements:**
- Server ready in about 1–2 s (warm page cache).
- Peak RSS for parakeet-cli is about 1.5 GB (f16) and 1.0 GB (q8), CPU and Vulkan alike (UMA).
- Occasional first-call outlier of ~130–155 ms on Vulkan.

**Reading:**
- **The CPU/Vulkan crossover is about 1.5 s.** CPU wins below it, and Vulkan wins 2–2.5× above it.
- ctrl-b's call segments (0.3–3 s) sit mostly at or under the crossover, so **CPU q8_0 or f16 is the simple default**. Vulkan pays off for longer dictation chunks.
- **parakeet.cpp CPU f16 is already about 1.5–2× faster than today's onnx-asr fp32** on short clips (57 vs 97 ms at 0.3 s; 84 vs 155 ms at 0.8 s), at 57 % of the RSS.

**Text parity (MEASURED, n=2 clips, anecdotal):**
- parakeet.cpp **f16 on CPU and on Vulkan** matched onnx-asr fp32 **byte for byte** on the 5 s and 10 s clips.
- q8_0 on CPU dropped commas ("I've called I wanna say …"); q8_0 on Vulkan matched.
- A real parity corpus is still owed.

---

## 5. FireRedVAD and TEN VAD (brief)

**FireRedVAD** — `FireRedTeam/FireRedVAD`, created 2026-03-03, last push 2026-05-06:
- The licence is **plain Apache-2.0**.
- ~0.57–0.59 M params ≈ 2.2 MB fp32 is confirmed (README:108-114). It has stream-VAD and non-stream-VAD modes.
- The numbers **exist as A5 quoted them** (README:26-31): F1 97.57 / FA 2.69 / Miss 3.62, against Silero 95.95 / 9.41 / 3.95 and TEN 95.19 / 15.47 / 2.95.
- **Two corrections to A5:**
  1. The README attributes the 97.57 F1 to the **non-streaming** VAD, whereas A5 uses it to promote *Stream-VAD*. No stream-VAD numbers are published.
  2. The FLEURS-VAD-102 test set is "coming soon" (README:33), so the benchmark is **not reproducible yet**.

**TEN VAD** — `TEN-framework/ten-vad` (GitHub SPDX: NOASSERTION):
- **Confirmed: "Apache License v2.0 … with the following additional conditions"**. Notably: "You may not Deploy the ten-vad in a way that competes with Agora's offerings", and deployment is allowed "solely for your benefit and the benefit of your direct End Users" (LICENSE:1-20).
- The README claims better precision than Silero and WebRTC, lower RTF, and 10/16 ms hops (160/256 samples). These are self-reported PR curves on their own released test set.
- A5's sherpa caveat is **confirmed**: `sherpa-onnx/csrc/ten-vad-model.cc:401-403` sets the pitch feature to 0 "as a simplification. This may reduce performance".

---

## 6. Bottom line for the Fable review

1. **The relay VAD** is about 30 lines of onnxruntime and numpy around the **v5** Silero ONNX, with persistent state and a LiveKit/sherpa-style policy (onset confirmation, pre-roll ring, `deact = act − 0.15`, max-segment cut). It costs about 0.25 % of a core per leg.
   - New dependencies for ctrl-b: `onnxruntime` and `numpy` (~140 MB installed; cp314 wheels exist).
   - Do **not** take the `silero-vad` pip package (it hard-requires torch). Do **not** copy Pipecat's 5 s state reset.
2. **The flood guard:** the "can't be ahead of the wall clock" rule is industry practice (Deepgram and AssemblyAI at 1.25×). Implement it as a **token bucket with a burst cap**, not an unbounded cumulative credit, and **throttle or drop before closing**.
3. **ASR host:**
   - parakeet.cpp `parakeet-server` (CPU, f16 or q8_0) is verified working on emma. It is faster than today's path, speaks the OpenAI shape, and ships as a single static binary. It is serialised, WAV-only, and ignores `language`.
   - onnx-asr (in-process or as a tiny sidecar) is the zero-model-change fallback.
   - Vulkan helps only for clips over about 1.5 s.
   - sherpa-onnx carries an open quiet-audio mel bug (#3997).

Cleanup: clones, the throwaway venv, the downloaded GGUFs, the v5/v6 ONNX files and the int8 HF cache under `/home/emma/.cache/tmp/r94-research` were deleted after measurement.
