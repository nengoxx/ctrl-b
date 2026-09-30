# Lane 3 — Speaches fork audit (for R94 §4/§6)

**Scope.** This is a read-only audit of `~/github/speaches` @ `fd4b956`, the tree `speaches.service` runs. The service runs `~/.local/bin/speaches-serve`, which calls `~/github/speaches/.venv/bin/uvicorn --factory … speaches.main:create_app` on `0.0.0.0:9000` with Python 3.12.13.

**What was checked.**
- ctrl-b @ `778b960`: `backend/app/services/voice_live.py`, `config.py`, `adapters/voice.py`.
- The prod config (`~/.ctrl-b/config.yaml`) and the dev config (`~/.ctrl-b-dev/config.yaml`), with secrets redacted.
- The Speaches journal from 2026-09-14 to 09-28 (713k lines).
- The D77 call trails in `~/.ctrl-b/calls` and `~/.ctrl-b-dev/calls`.
- Microbenchmarks run with the Speaches venv from scratchpad scripts. No service was touched and no file was modified.

Paths below are relative to `src/speaches/` unless they name ctrl-b.

---

## 0. Where R94 is wrong or incomplete (headline)

| # | R94 claim | Verdict | Evidence |
|---|---|---|---|
| W1 | §4.1 "the append handler awaits `commit_and_transcribe` inline, so appends queue behind every Parakeet call"; §6.1 "its append loop blocks on transcription" | **WRONG.** | `event_listener` dispatches every event as its own task (`routers/realtime_ws.py:43-48`, `tg.create_task(event_router.dispatch(...))`). The inline `await` (`realtime/input_audio_buffer_event_router.py:127`) parks only the append task that detected the stop. Later appends are dispatched and processed. **Journal proof:** 85 of 447 `speech_started` were sent while the previous segment's transcript was still pending, and 3 times two transcriptions were in flight at once. ctrl-b's own docstring already says "`speech_started(B)` before `transcript(A)` is routine" (`voice_live.py:28-29`). The real costs of the inline await are **W1a–c** below, not queueing. |
| W1a | — | Missing | **A failed transcription kills the whole session.** `commit_and_transcribe` catches only `openai.APIStatusError` (`input_audio_buffer_event_router.py:170-180`). Any other exception (`APIConnectionError`, `APITimeoutError`, httpx errors) propagates out of the dispatch task. The `TaskGroup` (`realtime_ws.py:43`) then cancels the listener and the outer group (`:106`), and the socket dies at 1006. This is the same mechanism as ctrl-b's documented commit-assert kill (`voice_live.py:44-48`), but reachable without any commit. |
| W1b | — | Missing | **The transcription call has no bound.** It uses the loopback `AsyncOpenAI` with `max_retries=0` and the SDK default timeout of 600 s (openai 2.30 `_constants.py:9`; the custom httpx client has the default 5 s timeout, so the SDK falls back to 600 s, `_base_client.py:867`). The code even carries `# TODO: add timeout` (`realtime/input_audio_buffer.py:173`). |
| W1c | — | Missing | **Transcripts can complete out of order.** Two segments can be in flight at once (observed 3×), and Parakeet runs in FastAPI's threadpool (`routers/stt.py:124` is a sync `def`). Streaming dictation appends finals in arrival order, not by `item_id`: `useDictation.ts` has no `item_id` handling, so a swap would reorder composer text. It is rare. The relay's own comment "Speaches runs one segment at a time" (`voice_live.py:152`) is wrong for the same reason. |
| W2 | §6.1 "ctrl-b already moved TTS off it (PocketTTS)" | **Partial.** | Speaches Kokoro is still **TTS fallback #1** in both prod and dev: `voice.tts.fallbacks[0] = {provider: emma-speaches, model: speaches-ai/Kokoro-82M-v1.0-ONNX}`, with voice `bf_isabella` on the model entry. Retiring Speaches removes that fallback unless it is replaced. |
| W3 | §6.2 "Batch ASR loses nothing" | **True, and it is even closer to a like-for-like swap than R94 says.** But R94 misses a **hidden second VAD** that ctrl-b depends on. | The realtime ear is already a batch client of itself. Each VAD segment is WAV-encoded (16 kHz PCM_16, `input_audio_buffer.py:144-152`) and POSTed to Speaches' **own** `/v1/audio/transcriptions` over the loopback (`input_audio_buffer.py:154-159`, `dependencies.py:177-200`, `LOOPBACK_HOST_URL=http://127.0.0.1:9000` from drop-in `20-loopback-url.conf`). That HTTP handler runs a second, fresh-state Silero pass (`routers/stt.py:48,154-155`: thr 0.5, min_silence 160 ms, pad 400 ms, max 30 s). It returns `""` when no speech is found (fork patch e093d8b) and crops or chunks what it sends to Parakeet (fork patch fdc6a27). **That guard emptied 93 of about 452 realtime segments (~21%)** since 09-14, plus 3 of about 100 clip uploads. §6.2's diagram (relay VAD, then a plain POST to any OpenAI-compatible server) drops this stage. Paired with a bare `parakeet-server`, every noise segment the relay VAD admits would reach Parakeet. See §3.4 for parity. |
| W4 | §4.1 the flap cause is "zero-state rescan" | **Incomplete.** | Two more causes make rescans non-reproducible even on identical audio. (a) **Frame-grid jitter:** once the buffer is over 3 s, the window is `data[-48000:]` (`input_audio_buffer_event_router.py:56`). Appends are 640 samples at 16 kHz, so the 512-sample grid shifts by 128 samples on every append, and Silero sees differently framed chunks each time. (b) **Tail dilution:** 48000 % 512 = 384, so the window is zero-padded by 128 samples (`silero_vad_v5.py:228`). `context[:, -1] = 0` is a view write, so it zeroes the last 64 samples of the newest chunk inside the audio itself (`:115-116`). The newest 32 ms chunk therefore always carries only 24 ms of real audio. |
| W5 | §4.2 test: "check whether each long false span starts within 3 s of the previous `speech_stopped`" | **Right mechanism, but a sharper test exists.** | The relay already forwards Speaches' buffer clocks, and they are in the trails. A 3 s floor-held span shows up as `audio_end_ms ≈ 3000–3300`, and a span of about 3 s needs `audio_start_ms ≈ 0` (the pre-roll clamps at the buffer start). Current prod and dev trails show the floor directly: `0→3240 ''`, `0→3040 "No, it was nothing."`, `1684→3080 "Yeah."`, `1268→3720`, `2004→3800 ''`, `2452→4000`. Many ends cluster just past buffer 3000 ms. |
| W6 | §2 / the D80 gap cut judges on the relay's arrival clock | **Arrival clock is confounded by uplink bunching.** | Six trail segments had a relay `speech_started→stopped` gap of **36–53 ms** for **1.3–3.2 s** of audio (audio clocks). The frames arrived in a burst and Speaches processed about 2 s of audio in one go. This is consistent with R94 §2's mobile-TCP bunching. The audio-clock veto saves these cases, but "relay span" is not a speech-duration measure. |
| W7 | §7 Q4 "is Silero at ~31 inf/s CPU-safe on the uvicorn loop?" | **Answered: yes, with 1 thread.** | Stateful streaming Silero v5 (these exact ONNX files, `intra_op=1`) costs **0.070 ms wall and CPU per 32 ms chunk**, about 0.22% of one core per leg. Today's rescan costs **4.25 ms wall and 28.5 ms CPU per append** (ORT default threads with spin). At 25 appends/s that is about 71% of one core per leg, roughly **320×** more. **But ctrl-b's backend venv (Python 3.14.4) has neither `numpy` nor `onnxruntime` installed.** cp314 wheel availability must be verified before §6.3 is ruled. |
| W8 | — | Missing | **Parakeet unloads after 5 min idle.** `stt_model_ttl` defaults to 300 (`config.py:51`), and `speaches-serve` does not override it. `PRELOAD_MODELS` only **downloads** and never loads into RAM (`main.py:85-92`). Every first utterance after ≥5 min idle pays a reload of **1.7–22 s**: 11.2 s on the first use after the 09-27 restart, 15 s and 22 s on 09-24 (swap-cold). **Every realtime transcription over 2 s in the journal (17 of 433) coincides with a reload.** Realtime transcription latency overall: p50 0.38 s, p95 0.78 s, p99 5.27 s, max 24.05 s. |
| W9 | §4.1 line cites | Minor | `vad_detection_flow` is `input_audio_buffer_event_router.py:53-107`, not `:52-98`. `:126` (rotate) and `:127` (await) are correct. `silero_vad_v5.py:108` (state zeros) is correct. |

**Confirmed (R94 §1 / §4.1 held):**
- The batch `get_speech_timestamps` runs over `data[-3 s:]` on every append.
- State is `np.zeros` per call.
- `min_speech_duration_ms = 0` (VadOptions default `silero_vad_v5.py:62`, not overridden at `input_audio_buffer_event_router.py:62-66`).
- Stop path ① (`:91-97`) and stop path ② (`:99-105`, `end < 3000 and duration_ms > 3000`, "FIX: magic number").
- Rotate on every stop.
- The 3-local-patch inventory, none of which touches detection logic. fd4b956 only moves `audio_start_ms`, pads, and the session.update filter (details in §1.7).

---

## 1. The realtime path, end to end

### 1.1 Session creation
- **Route and auth.** `routers/realtime_ws.py:56-66` is the route; query `model`, `intent` (default `conversation`), `language`, `transcription_model`. Auth is checked before accept (`:80-84`, `realtime/utils.py:53-88`: `?api_key=`, `Authorization: Bearer`, or `X-API-Key`).
- **Loopback base.** `LOOPBACK_HOST_URL` + `/v1` (`:89-93`). A per-session chat `completion_client` is built but unused for `intent=transcription`.
- **Context.** `SessionContext` (`realtime/context.py:12-28`) holds the pubsub, conversation, response manager and `InputAudioBufferManager`.
- **Session defaults.** `realtime/session.py:13-73`. For `intent=transcription` the URL `model` becomes `input_audio_transcription.model` (`:31-36`). Defaults are `turn_detection = {server_vad, threshold 0.9, prefix_padding_ms 0, silence_duration_ms 550, create_response = intent != "transcription"}` (`:62-68`).
- **Hard cap.** 30 min via `asyncio.timeout(OPENAI_REALTIME_SESSION_DURATION_SECONDS)` (`realtime_ws.py:108`, `session.py:9`).
- **Race hack.** `session.created` is published after a 1 ms `asyncio.sleep` so the sender has subscribed (`realtime_ws.py:110-112`).
- **ctrl-b side.** URL = `…/v1/realtime?model=<stt model>&intent=transcription` (`voice_live.py:275-289`). The relay waits for `session.created`, then sends one `session.update` (`voice_live.py:566-618`).

### 1.2 `session.update` / `turn_detection`
- **Handler.** `realtime/session_event_router.py:39-61`. It dumps the update with `exclude_defaults=True`, deep-merges it into the session dict, and re-validates `Session(**…)`. `input_audio_format` and `output_audio_format` are rejected with an error event.
- **`TurnDetection` has exactly five fields** (`types/realtime.py:250-255`), all required except `type`. `PartialSession` types each field as `X | NotGiven`, and `NotGiven` is an empty `BaseModel` (`:75-79, 323-336`). **So any partial object silently validates as `NotGiven` and is dropped.** Verified in the venv: `{'turn_detection': {'threshold': 0.6}}` becomes `NotGiven`.
- **NEW DEFECT: ctrl-b's `language` never applies.** ctrl-b sends `input_audio_transcription: {"language": "en"}`. The trail `leg_start` confirms it, with the language taken from `voice.stt.language` (`provider_registry.py:714-724`). `InputAudioTranscription.model` is required (`types/realtime.py:258-261`), so the block validates as `NotGiven` and is **silently dropped**. The journal's "Applying session configuration update" lines show only `turn_detection`, and the session keeps `language: None`. It is inert today because Parakeet ignores language anyway (§3.3). ctrl-b's docstring (`voice_live.py:577-580`) claims the field applies when non-blank.
- **What applies today** (journal 09-28): `{'turn_detection': {'create_response': False, 'prefix_padding_ms': 300, 'silence_duration_ms': 700, 'threshold': 0.6}}`.

### 1.3 `input_audio_buffer.append`, resample, VAD
Handler: `input_audio_buffer_event_router.py:113-127`.
1. **Decode.** base64 is decoded, then `audio_samples_from_file(..., 24000)` reads RAW s16le as float32 (`audio.py:59-69`).
2. **Resample 24k→16k.** `resample_audio_data` (`audio.py:17-22`) does a **per-chunk, stateless `np.interp` over `np.linspace(0, len, target_len)`** (endpoint=True).
   - Each 960-sample (40 ms) chunk maps onto 640 outputs spaced 960/639, not 1.5. That is a **25 Hz sawtooth time-warp** of up to 1.5 source samples (62.5 µs), and the last output clamps to `data[-1]`.
   - There is no anti-alias low-pass.
   - Measured on a 440 Hz sine: max error 0.17 and RMS error −20 dB relative to an ideal resample. ctrl-b's `Pcm16Resampler` is clean, but this second hop is not.
   - R94 §4.3's "transport/resampler verified clean" covers **ctrl-b's** resampler only. Removing the 24 kHz hop removes this.
3. **Append.** `InputAudioBuffer.append` is `np.append`, **an O(n) copy of the whole current buffer on every append** (`input_audio_buffer.py:71-73`). See §6 D3.
4. **`vad_detection_flow`** runs **synchronously on the event loop** when `turn_detection` is set (`:120-121`).
   - It takes the last 3000 ms (`MAX_VAD_WINDOW_SIZE_SAMPLES = 3000*16`, `input_audio_buffer.py:36`).
   - It calls `get_speech_timestamps` with `threshold = turn_detection.threshold`, `min_silence_duration_ms = silence_duration_ms`, `speech_pad_ms = 0` (`STREAMING_VAD_SPEECH_PAD_MS`, `:49, 62-66`), and everything else at defaults: `neg_threshold = thr − 0.15`, `min_speech 0`, `max_speech inf`.
   - The **last** timestamp is used (`:72`). ">1 timestamp" warned 1,282 times since 09-14 (`:69-70`).
5. **Start.** If `audio_start_ms is None` and there is any timestamp: `audio_start_ms = max(0, duration_ms − window_ms + ts.start − prefix_padding_ms)` (`:75-88`), then `speech_started{item_id = buffer.id, audio_start_ms}` is published.
6. **Stop ①.** No timestamp in the window: `audio_end_ms = duration_ms`, then `speech_stopped` (`:91-97`).
7. **Stop ②.** `ts.end < 3000 and duration_ms > 3000`: `audio_end_ms = duration_ms` (`:99-105`).
   - An ongoing speech ends at the window end (3000 ms) (`silero_vad_v5.py:288-290`), so `end < 3000` means a closed segment with ≥ `silence_ms` of silence after it.
   - **In a buffer ≤3 s, stop ② is impossible, so a phrase that starts in a fresh buffer cannot end before buffer-time 3 s** unless it flaps via ①. ctrl-b already models this as R70's law `max(silence_ms, 3000 − phrase_ms) + ~0.5 s` (`config.py:712-717`).
8. **On stop.** `publish(speech_stopped)`, then `ctx.audio_buffers.rotate()` (a new buffer becomes current; the old one is kept), then `await commit_and_transcribe(ctx, item_id)` (`:124-127`).

### 1.4 `commit_and_transcribe` and `InputAudioBufferTranscriber`
- **`commit_and_transcribe`** (`input_audio_buffer_event_router.py:152-191`):
  - Publishes `input_audio_buffer.committed{item_id, previous_item_id}`.
  - Starts an `InputAudioBufferTranscriber` task and awaits it.
  - Turns `APIStatusError` into an `error` event (4xx → invalid_request, 5xx → server_error). Other exceptions escape (W1a).
  - `create_response` is false, so it returns there (`:182-183`).
- **`InputAudioBufferTranscriber._handler`** (`input_audio_buffer.py:134-171`):
  - Creates a conversation item (id = buffer id).
  - Writes `data_w_vad_applied` as **WAV PCM_16 LE 16 kHz** (`:144-152`).
  - Calls `transcription_client.create(file, model = session.input_audio_transcription.model, response_format="text", language = session language or omit)` (`:154-159`).
- **Yes, it calls Speaches' own HTTP endpoint.** `get_transcription_client` (`dependencies.py:177-200`) is an `AsyncOpenAI` whose `http_client` has `base_url = LOOPBACK_HOST_URL + /v1`, with bearer = `API_KEY` and `max_retries=0`.
  - **URL:** `POST http://127.0.0.1:9000/v1/audio/transcriptions`.
  - **Model:** `istupakov/parakeet-tdt-0.6b-v3-onnx`, the URL `model` that ctrl-b sets from `voice.stt.model`.
  - Without `LOOPBACK_HOST_URL` it would use an `ASGITransport` around the bare `stt_router`. That is broken, which is why ctrl-b's 20-loopback drop-in exists.
- **Slice.** `data[audio_start_ms*16 : audio_end_ms*16]` (`input_audio_buffer.py:80-88`). Start = detection point − `prefix_padding_ms`, clamped at 0 of **this** buffer (it can never reach into the previous buffer). End = buffer end at the stop, so the slice **always carries ≥ `silence_ms` of trailing silence**, and up to about 3 s when floor-held.
- **Output event.** `conversation.item.input_audio_transcription.completed{event_id, item_id, content_index: 0, transcript, usage: {seconds: buffer.duration, type: "duration"}}` (`input_audio_buffer.py:162-170`, `types/realtime.py:387-394`). Note that `usage.seconds` is the **whole buffer** duration, not the slice.
- **No partials exist.** ctrl-b consumes `speech_started`, `speech_stopped`, `…completed`, `session.updated` and `error`, and absorbs the rest (`voice_live.py:886-935`).

### 1.5 Consequence of the inline await (quantified)
- **Appends keep flowing** (W1): there were 85 new segment starts while a transcript was pending, out of 447.
- **The loop's real per-append cost is the VAD rescan.** Production p50 is 5.1 ms, p95 7.6 ms, p99 14.3 ms and max 28.8 ms (16,608 full-window rescans in 26 h of journal). My bench measured 4.25 ms wall and 28.5 ms CPU.
- **The HTTP transcription runs in the threadpool** (sync endpoint) and contends for the same 8 cores and 16 threads.
- **What the relay sees:**
  - Transcripts arrive about 235 ms after `speech_stopped` on the no-speech fast path.
  - About 340–450 ms on a warm Parakeet.
  - About 2.3–24 s on a reload (W8).
  - Occasionally two are in flight at once.
  - A non-HTTP-status failure means a bare 1006.

### 1.6 Pacing (from ctrl-b)
- **Normal appends.** `frame_ms = 40` (`config.py:1001`, not overridden in either config). Each append is 960 samples at 24 kHz, which is 640 at 16 kHz and 1.25 Silero chunks, so there are **25 appends/s**. Each append reruns about 94 chunks: 1 batched encoder `run` plus **94 sequential decoder `run`s** (`silero_vad_v5.py:125-135`). That is about 2,350 chunk-inferences/s, against 31.25/s for a streaming VAD (**75× redundant work**).
- **Flush.** A flush is 80 extra appends (3200 ms, `voice_live.py:831-872`) delivered at loopback speed.

### 1.7 The three local commits (vs parents)
- **e093d8b "skip Parakeet when VAD finds no speech"** (09-06):
  - `executors/parakeet.py`: if `request.speech_segments` is empty, it returns `("", "text/plain")` or `Transcription(text="")` without loading Parakeet. This is now `parakeet.py:131-139`.
  - Before it, the handler's VAD result was computed but unused, so Parakeet ran on pure noise and hallucinated.
  - Adds `tests/parakeet_test.py`.
- **fdc6a27 "transcribe Parakeet VAD segments sequentially"** (09-21):
  - Replaces `parakeet.with_timestamps().recognize(whole_audio)` with a loop over `merge_segments(speech_segments, vad_options)`, recognising each `audio[start:end]` and joining the non-empty stripped texts with `" "` (`parakeet.py:140-147`).
  - With the HTTP VAD options (pad 400, max 30 s), **clips under 30 s become ONE chunk** from `first.start − 400 ms` to `last.end + 400 ms`, keeping the internal silences (`silero_vad_v5.py:321-365`). So in practice it trims leading and trailing non-speech, and only splits audio longer than 30 s at speech boundaries (≤30 s chunks).
  - This matters for long clip uploads (`voice.stt`), because fp32 Parakeet on minutes of audio is unbounded.
- **fd4b956 "honour `turn_detection.prefix_padding_ms` as a slice-start pre-roll"** (09-27, ctrl-b S11). Three changes:
  - (a) `session_event_router` no longer rejects or excludes `prefix_padding_ms`.
  - (b) The streaming VAD's `speech_pad_ms` changes from `prefix_padding_ms` to the constant 0. Previously it was always 0 anyway, because the field was stripped and defaulted to 0.
  - (c) `audio_start_ms` becomes `max(0, … − prefix_padding_ms)`, and both `audio_end_ms` sites change from `duration_ms − prefix_padding_ms` to `duration_ms − 0`.
  - Net effect: endpoint timing is unchanged, and the slice gains up to 300 ms of pre-roll, clamped at the buffer start.
  - Interaction: the second VAD pass (400 ms pad) can now include the onset because the pre-roll gives it room. Before, it could not pad before the slice start.
  - Adds `tests/realtime_vad_prefix_padding_test.py`.
  - The service restarted at 09-27 17:40, and there have been zero `prefix_padding_ms` error events since. All 79 earlier `error` events were this rejection.

---

## 2. Silero executor (`executors/silero_vad_v5.py`)

- **State.**
  - `state = np.zeros((2, batch, 128))` on every `__call__` (`:108`).
  - Within the call it **is** carried across the 512-sample chunks. The encoder runs batched over all chunks, each prefixed by the previous chunk's last 64 samples as context (`:114-129`); the first chunk gets zero context.
  - The decoder then loops chunk by chunk with `out, state = decoder.run(…, state)` (`:133-135`).
  - So it is correct **within a call** and reset **between calls**. On the realtime path, every append is a new call over a re-framed window (W4).
- **Parameters.** `get_speech_timestamps` (`:190-308`) is the Silero reference algorithm. Window 512 samples. `neg_threshold = max(thr − 0.15, 0.01)` when None (`:234-235`).
  - **Realtime:** thr = 0.6 (ctrl-b), neg 0.45, `min_speech_duration_ms` 0, `min_silence_duration_ms` 700 (ctrl-b `silence_ms`), `speech_pad_ms` 0, `max_speech_duration_s` inf.
  - **HTTP path** (`routers/stt.py:48`, "copied from faster_whisper"): thr 0.5, neg 0.35, min_speech 0, **min_silence 160**, **pad 400**, **max_speech 30 s**.
- **Model.**
  - faster-whisper 1.1.1's **split** Silero v5 export: `.venv/lib/python3.12/site-packages/faster_whisper/assets/silero_encoder_v5.onnx` (713,415 B) and `silero_decoder_v5.onnx` (532,505 B) (`:148-161`).
  - It is **not in the HF cache**, and it is not snakers4's single-file `silero_vad.onnx`.
  - ORT `SessionOptions` are left at defaults. The thread settings are commented out (`:82-86`), so it uses all physical cores with spin-wait, which explains the 6.7× CPU/wall ratio.
  - Providers are CPU only after the drop-in excludes CUDA and TRT (the wheel is `onnxruntime-gpu` 1.24.4 with providers `[TRT, CUDA, CPU]`).
  - `vad_model_ttl = -1`, so it never unloads. It loaded in 0.07 s.
- **Cost.** 3 s rescan: 4.25 ms wall and 28.5 ms CPU (bench); production p50 is 5.1 ms wall. At 25 appends/s that is about 11–13% of the event loop and about 0.7 core of CPU **per live leg, including silence**. The streaming stateful alternative is 0.07 ms per chunk on 1 thread (W7).
- **For the relay's A/B parity (R94 §6.3 "same model generation").** Using upstream `silero_vad.onnx` v5 is a different export of the same weights. Expect near-identical but not bit-identical probabilities. The cleanest A/B uses these two faster-whisper files, or confirms equivalence on the replay corpus.

---

## 3. HTTP `/v1/audio/transcriptions` + Parakeet

### 3.1 Request path
- **Handler.** `routers/stt.py:120-173` is a sync `def`, so it runs in the threadpool.
- **Form fields.** `file`, `model`, `language`, `prompt`, `response_format` (default `json`), `temperature`, `timestamp_granularities[]`, `stream`, `hotwords` and `without_timestamps`.
  - **`vad_filter` is not a field**, so ctrl-b's `extra_body.vad_filter` is discarded (`adapters/voice.py:227-243` already says so). The VAD always runs regardless.
- **Decoding** (`dependencies.py:85-120`): `audio/pcm` or `audio/raw` is read as s16le at **16 kHz**. Everything else goes through `faster_whisper.decode_audio` (PyAV) to 16 kHz mono. Errors map to 415, 400 or 500.
- **Flow.**
  - A full-clip Silero pass runs with `DEFAULT_VAD_OPTIONS` (`:154-155`).
  - Then `ParakeetModelManager.handle_transcription_request` (`executors/parakeet.py:163-169`).
  - `stream=true` raises `NotImplementedError`, which becomes a 500 (`:155-161`).
  - `verbose_json`, `srt` and `vtt` raise `ValueError`, which also becomes a 500 (`:127-130`).
- **Response.**
  - `text` returns a `text/plain` body. This is what the realtime loopback uses.
  - `json` returns `{"text": "…"}`. This is what ctrl-b's clip path uses (default format, `adapters/voice.py:253-260`).
- **Log noise.** `transcription_response_to_http_response` logs **ERROR "Unexpected streaming transcription response type"** on every request (`stt.py:105`), 557 times since 09-14.
- **Fragile call.** `asyncio.run(get_timestamp_granularities(request))` runs inside a threadpool endpoint (`stt.py:143`). It works only because the form is already cached.

### 3.2 Parakeet executor
- **onnx-asr 0.7.0** from `.venv/lib/python3.12/site-packages`.
- **Model and quantization.** `onnx_asr.load_model(model_id, providers=…)` (`parakeet.py:117-119`) passes **no quantization, so fp32**. `NemoConformerTdt` files are `encoder-model.onnx` + `encoder-model.onnx.data` (**2.3 GB**), `decoder_joint-model.onnx` (70 MB), `vocab.txt` and `config.json`. They live in `~/.cache/huggingface/hub/models--istupakov--parakeet-tdt-0.6b-v3-onnx/snapshots/8f23f0c0…`.
- **Other settings.** Default ORT threads. Greedy TDT decode (`onnx_asr/asr.py:125-160`).
- **Recognition.** `parakeet.recognize(np_array)` per merged segment, with the default sample rate of 16 kHz.
- **Lifecycle.** `stt_model_ttl` 300 s, so it unloads after 5 min idle. Reload takes 1.7–22 s (W8).

### 3.3 Language
- Speaches' Parakeet executor never passes `language` (`parakeet.py:144`), and onnx-asr uses it only for Whisper (`onnx_asr/adapters.py:72`). **Parakeet v3 auto-detects across its 25 languages on every call.**
- ctrl-b's `voice.stt.language: en` is inert on both doors. It is also dropped by session.update on the realtime door (§1.2).
- `DEFAULT_LANGUAGE=en`, `WHISPER_MODEL` and `USE_BATCHED_MODE` in `speaches-serve` are **not `Config` fields**, so they are dead env vars.

### 3.4 Parity a replacement must reproduce
1. **An OpenAI-compatible multipart `POST /v1/audio/transcriptions`.**
   - `file` in any container ctrl-b's recorder produces (PyAV-grade decode), and 16 kHz PCM_16 WAV for the relay.
   - `model`.
   - `response_format` `json` returning `{"text"}`.
   - Tolerate extra fields (`language`, `hotwords`, `vad_filter`).
   - Accept a bearer header.
2. **The pre-ASR no-speech guard: ctrl-b DOES rely on it.**
   - It returns `""` when fresh-state Silero at thr 0.5 finds no speech. This hit about 21% of realtime segments and 3% of clip uploads.
   - The relay handles an empty final as "nothing" (`voice_live.py:905-927`, and the phone disposes of empty finals).
   - Without it, those segments would go to Parakeet and come back as short hallucinations ("Yeah.", "Mm-hmm."), which is exactly the A3 class.
   - Either the ASR host does this (sherpa-onnx can; parakeet.cpp: verify), or **ctrl-b's relay runs a second-stage check on the finished segment** before POSTing. The latter is cheap, because the relay already holds the segment and a Silero session.
3. **Edge crop plus 400 ms pad.** Trim to `[first_speech − 400 ms, last_speech + 400 ms]`. Parakeet never sees long leading or trailing silence. Today's realtime slices carry ≥700 ms trailing silence and up to about 3 s when floor-held.
4. **Long audio.** Split at speech boundaries into ≤30 s chunks, recognise sequentially, and join with spaces (fdc6a27). This is needed for long `voice.stt` uploads (the cap is 25 MB, `config.py` `max_upload_bytes`).
5. **Same model for text parity.** `istupakov/parakeet-tdt-0.6b-v3-onnx`, fp32, greedy, no language forcing. An int8 build or another runtime (parakeet.cpp GGML) changes the text, so the bake-off should compare against this.
6. **Model resident.** No idle unload (fixes W8).
7. **Latency baseline to beat** (warm, realtime segments incl. loopback, WAV, decode and VAD): p50 0.38 s, p95 0.78 s. The no-speech fast path is about 0.24 s.

---

## 4. Everything ctrl-b uses Speaches for

### 4.1 Consumers (prod `~/.ctrl-b/config.yaml` and dev `~/.ctrl-b-dev/config.yaml` are the same in shape; keys redacted)

| Door | Config | Target | Code |
|---|---|---|---|
| Clip-upload STT (push-to-talk / whole-clip dictation) | `voice.stt` | primary `emma-speaches` (`http://127.0.0.1:9000/v1`) · `istupakov/parakeet-tdt-0.6b-v3-onnx`; fallback `vault-speaches` (`http://192.168.1.137:9000/v1`, a **separate Speaches on vault** serving `deepdml/faster-whisper-large-v3-turbo-ct2`) | `adapters/voice.py:217-265` (`transcriptions.create`, json, `language` + `extra_body{vad_filter, hotwords}`) |
| Realtime ear (live call + streaming dictation) | `voice.live` (prod `{}`, dev `enabled: true`) | a blank `provider` resolves like `voice.stt`, so `emma-speaches` · Parakeet; **hop 1 only, no failover** (`voice_live.py:68-70`) | `services/voice_live.py`, `api/voice.py:53,287` |
| TTS **fallback #1** | `voice.tts.fallbacks[0]` | `emma-speaches` · `speaches-ai/Kokoro-82M-v1.0-ONNX` (voice `bf_isabella`); primary is `emma-pockettts` (`:8890`) | `adapters/voice.py` `synthesize` |

- **Nothing else.** No embeddings, `/v1/vad`, diarization or chat. The frontend references are comments only.
- **Tooling.** `tools/speaches_realtime_smoke.py` pins the wire.
- **Retiring emma's Speaches** touches the three rows above, and does not touch `vault-speaches`.
- **Fallback quirk.** `vault-speaches` is whisper, so `hotwords` and `language` would apply there. It has none of the fork patches unless vault runs this fork, which I have not verified.

### 4.2 Knobs that ride `session.update` today, which become relay config
- `turn_detection.threshold` = `live.vad_threshold` (0.6, bounds 0.5–0.8, `config.py:711`).
- `silence_duration_ms` = `live.silence_ms` (700, `:717`).
- `prefix_padding_ms` = `live.prefix_padding_ms` (300, `:727`).
- `create_response: false` and `type: server_vad`, which are moot.
- `input_audio_transcription.language` from `voice.stt.language`, silently dropped today.

### 4.3 Implicit Speaches constants the relay must own or re-decide
- 3000 ms window and the 3 s endpoint floor (`MAX_VAD_WINDOW_SIZE_SAMPLES`).
- `neg_threshold = thr − 0.15`.
- `min_speech_duration_ms = 0`, which becomes R94's onset confirmation.
- Streaming `speech_pad 0`.
- The 24 kHz wire rate (`SPEACHES_WIRE_RATE`, `core/audio.py:27`).
- The 30-min session cap (`max_session_s` default 1800 aligns with it, but its bound allows 7200, `config.py:1005`, so above 1800 Speaches would kill the leg at 30 min).
- The HTTP-side guard options from §3.4.

### 4.4 Relay machinery that exists only because of Speaches, and dies with it
- `realtime_url`, `connect_speaches`, `_configure_upstream`, `_adopt_pre_roll` and the prefix-padding error sniffing.
- The R70 silence-burst `_flush` (3200 ms of zeros because Speaches can't be told "end now").
- The COMMIT-SAFETY invariant.
- The D80 gap cut's reason to exist.
- The base64 TEXT uplink (33% overhead).

---

## 5. Resource facts (2026-09-28 19:35)

- **Process.** PID 2308678, up since 09-27 17:40. 49 threads.
- **Memory.**
  - `ps` RSS was 3.83 GB, dropping to 3.37 GB while swapping out during the check.
  - `smaps_rollup`: Anonymous 3.07 GB, **Swap 1.46 GB**. VmHWM 5.27 GB. systemd reports peak 6.8 GB and swap peak 0.99 GB earlier.
  - CPU total 1 h 12 min in 26 h; 0% at rest.
- **Models loaded now: only Silero.** Parakeet was unloaded at 14:13:50 and has had no load since. Kokoro was not loaded since the restart.
  - About 4.5 GB of anonymous memory is held while the 2.3 GB model is **unloaded**. That is retained or fragmented heap (glibc does not return ORT/numpy arenas), or session garbage that is never freed. Either way, the TTL unload saves no memory in practice, and the resulting swap makes the reload slow (22 s worst).
- **Startup.**
  - The unit started at 17:40:01, and the app was ready at 17:40:06.
  - `PRELOAD_MODELS` only checks the download (0.5 s).
  - Gradio UI mounted (`enable_ui` default True, `main.py:191-196`).
  - The first STT request at 17:58:49 paid an 11.23 s Parakeet load. Silero loaded in 0.07 s at the first realtime session.
- **Logging.** `log_level` defaults to `debug` (`config.py:81`). That produced 206k journal lines in 26 h, with multiple lines per append (VAD timing and ref-count debug) and per sent event.

---

## 6. Other Speaches defects that affect ctrl-b

| ID | Severity for ctrl-b | Defect | Cite |
|---|---|---|---|
| D1 | HIGH (latent) | Any non-`APIStatusError` exception in a handler tears down the whole realtime session (TaskGroup). The words in flight are lost. | `realtime_ws.py:43-48,106`; `input_audio_buffer_event_router.py:170-180` |
| D2 | HIGH (observed) | Parakeet idle-unloads at 5 min, costing 1.7–22 s on the first utterance after idle. All 17 realtime transcriptions over 2 s coincide with reloads. | `config.py:51`; `base_model_manager.py:85-98`; `main.py:85-92` |
| D3 | MED (latent) | Per-session memory never bounded. `pubsub.events` stores every event incl. every base64 append (`pubsub.py:160,163`). `InputAudioBufferManager` never evicts rotated buffers (`input_audio_buffer.py:95,105-108`), which together is about 230 MB per 30-min leg. `np.append` copies the whole current buffer on every append (`:73`). Measured: about 11 ms per append at 5 min without rotation and 25–80 ms at 7.5–15 min. At 25 appends/s **the loop saturates after roughly 8–10 min without a `speech_stopped`**; ctrl-b sends silence frames even while the mic is held. | as cited |
| D4 | MED | The flap machinery: zero state, frame-grid jitter, tail dilution, and the 3 s end floor in fresh buffers. Every slice carries the whole trailing silence. | §1.3, W4 |
| D5 | MED | The 24k→16k per-chunk resampler has a 25 Hz time-warp and no anti-alias filter. | `audio.py:17-22` |
| D6 | LOW (inert) | `input_audio_transcription` without `model` is dropped as `NotGiven`, so ctrl-b's language never applies. | `types/realtime.py:75-79,258-261,325` |
| D7 | LOW | Transcriptions can overlap and complete out of order. Dictation appends in arrival order. | `realtime_ws.py:47`; `stt.py:124` |
| D8 | LOW | No timeout on the loopback transcription (600 s SDK default). | `input_audio_buffer.py:173`; openai `_constants.py:9` |
| D9 | LOW | Hard 30-min session cap; ctrl-b's `max_session_s` allows up to 7200. | `session.py:9`; ctrl-b `config.py:1005` |
| D10 | SECURITY-relevant | The server binds `0.0.0.0:9000` (`speaches-serve`; `ss` confirms). The Gradio UI, `/docs` and `/health` are **unauthenticated by design** (`config.py:72-80`, `main.py:157-196`). `API_KEY` in the unit is a trivial placeholder value (not reproduced here). This is LAN and tailnet reachable; check it against SECURITY_MODEL while Speaches remains. | unit + `main.py` |
| D11 | LOW | Log noise: `debug` default, plus an ERROR logged on every transcription. | `config.py:81`; `stt.py:105` |
| D12 | LOW | `session.created` is ordered by a 1 ms sleep hack. | `realtime_ws.py:110-112` |
| D13 | LOW (inert) | Parakeet `verbose_json`, `srt`, `vtt` and `stream` return 500 rather than 4xx. | `parakeet.py:127-130,155-161` |
| D14 | INFO | `usage.seconds` reports the whole buffer, not the slice. | `input_audio_buffer.py:166-169` |

---

## 7. Implications for the R94 §6 plan (short)

- **The target architecture is sound, and it is closer to what Speaches does than R94 frames it.** Speaches already runs "VAD → segment → batch POST to `/v1/audio/transcriptions`". The move changes **who** runs the VAD and **how** (streaming stateful, off the 24 kHz hop), and **where** the POST goes.
- **Add a second-stage guard to §6.2.** Before POSTing, run fresh-state batch Silero on the finished segment (thr 0.5, pad 400, crop). Otherwise require the ASR host to do it. **This must be built before cutover, because ~21% of today's segments are emptied by it.**
- **Keep the ASR host's model resident.** For the shadow and interim phase (R94 §6.6 step 6: "ASR stays on Speaches' HTTP path at first"), set `STT_MODEL_TTL=-1` in the Speaches env. That is a one-line ops change, not code.
- **§6.3 runtime.** Verify onnxruntime and numpy wheels exist for CPython 3.14 before ruling "in-process in ctrl-b's venv". If they don't, the VAD needs its own small process or an alternative runtime.
- **§4.2 trail check.** Use the forwarded `audio_start_ms`/`audio_end_ms` (W5), not the relay arrival clock (W6).
