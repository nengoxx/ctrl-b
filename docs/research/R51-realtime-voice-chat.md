# R51 — Continuous voice conversation ("live chat mode"): how the field builds it, read at the source

**Date:** 2026-08-21
**Status:** Evidence dossier — complete for the bounded question. **Future-feature research; nothing
is being built.** Not a decision.
**What drove it:** the owner pointed at <https://github.com/nengoxx/RealtimeVoiceChat> (their own
fork) and asked how a continuous always-listening voice mode works, and "how could we most reliably
and efficiently build this" on ctrl-b's seams. No ROADMAP entry exists yet — the nearest neighbours
are §C2 (wake word, R14) and §C3 (chunked TTS, R48/R50).
**Drove:** (open) — no D-entry, no ROADMAP row yet. §9 proposes where it would go.

**Confidence markers used on every finding:** **VERIFIED** = source read at a pinned SHA, or probed
first-hand on emma today. **REPORTED** = secondary source (docs, bug tracker, search result).
**UNVERIFIED** = expected but not checked.

**Prior evidence assumed, not re-bought:** R48 §2.2 (open-webui's call overlay — the only in-class
voice-call loop, already dissected), R48 §3 (Speaches/Kokoro internals), R50 (measured playback:
opus sample-exact, src-swap 4–6 ms, synth 6.1× realtime, sentence chunks → ~0.7 s first audio),
R14 §3–§4 (Android background/mic-permission ceiling — **the entire background half of this
question is already answered there**), `docs/RESEARCH.md` §"Secure context for the mic".

---

## 0. Sources, pinned

| Project | Ref | SHA / version | Read |
|---|---|---|---|
| **nengoxx/RealtimeVoiceChat** (the pointed fork) | HEAD | `64dc0d875415bcbd39a9bad61dc169cba72f0b6e` (2025-09-27) | 2026-08-21 |
| **KoljaB/RealtimeVoiceChat** (the upstream) | HEAD | `9de323f13371dec2d6269fba0cdcb9254e0ec016` (2025-07-11) | 2026-08-21 |
| KoljaB/RealtimeSTT | HEAD | `7a0b47607f634df8f6c448bcfbd4e9f2b6bdb02f` (2026-08-21), v1.0.4 | 2026-08-21 |
| KoljaB/RealtimeTTS | HEAD | `e61420f97f108e7ae2175b36e4d2f58289b4bd76` (2026-08-21) | 2026-08-21 |
| pipecat-ai/pipecat | HEAD | `6f3914f0ea009ee30a96b2de9ce7664a5e19153e` (2026-08-20) | 2026-08-21 |
| livekit/agents | HEAD | `89c71040a82d7bc8bb1077dc56c5781f347b6768` (2026-08-21) | 2026-08-21 |
| speaches-ai/speaches (**the owner's voice server**) | HEAD | `993994f7984bf3fe9655b267448328cf66fccb42` (2026-04-17) | 2026-08-21 |
| danny-avila/LibreChat (`client/src`) | HEAD | `b4593f80b7ec0a5e3c0e3eb0f51941dd34349230` | 2026-08-21 |
| Mintplex-Labs/anything-llm (`frontend/src`) | HEAD | `c8bd6442e6b6eee8d08a761452960f7f77e334a9` | 2026-08-21 |
| **Live probe** | emma | Speaches **0.8.3** @ `127.0.0.1:9000` (`/openapi.json`) | 2026-08-21 |
| ctrl-b | `da848be` | working tree | 2026-08-21 |

Clones lived in `/home/emma/.cache/tmp/r51/` (`TMPDIR` honoured per the tmpfs memory) and were
deleted after the pass. No repo file was modified except this dossier.

> ### ⚠ Security note on the owner's own fork — action recommended
> **VERIFIED** (`git show 64dc0d8 -- code/llm_module.py`): the fork's single "customized" commit
> hardcodes what looks like a live **OpenRouter API key** (`sk-or-v1-…`, value deliberately not
> reproduced here) in **two** places — as the *default argument* of `_create_openai_client(...)` and
> again inside `LLM.__init__`, overwriting the passed-in `api_key`/`base_url`.
> **CURATION CORRECTION (main seat, 2026-08-21): the fork is PRIVATE, not public** —
> `gh api repos/nengoxx/RealtimeVoiceChat` → `"visibility": "private"`; the anonymous API 404s
> (the research clone worked only because emma's gh auth has access). The key presence itself was
> re-verified through the authed API (2 pattern matches, value never printed). Severity is
> therefore hygiene, not exposure: the key sits in the git history of a private repo — rotate at
> convenience, prefer env vars, and remember private repos can become public. (The same commit
> also hardcodes `C:/Users/rovax/...` cert and voice paths — a personal local config committed to
> the fork, not a maintained variant.)

---

## 1. ctrl-b's seams as they stand (VERIFIED — read at `da848be`)

Read before researching, so the findings land on real code.

| Seam | File:line | Shape today |
|---|---|---|
| Mic capture | `frontend/src/hooks/useDictation.ts:175-218` | **Push-to-talk**: tap → `getUserMedia({audio:true})` (no constraints beyond `audio:true`) → `MediaRecorder` (webm/opus preferred) → tap → `onstop` → one POST. Five states incl. `insecure`. |
| STT upload | `useDictation.ts:122-173` | `POST /api/voice/stt` multipart, one whole clip; 502 → `unavailable` latch; `auto_send` routes the transcript through `runComposer` (queues as a steer during a live turn). |
| STT route | `backend/app/api/voice.py:42-77` | Reads at most `max_upload_bytes+1`; 413/422/502/503; `X-Voice-Served-By`. |
| STT adapter | `backend/app/adapters/voice.py:154-195` | `/v1/audio/transcriptions` per target until one answers (`failover_collect`); `vad_filter` + `hotwords` ride `extra_body`. **Whole-clip only — no streaming path.** |
| TTS | `voice.py:81-108` + `adapters/voice.py:198-236` | Whole-reply buffered synth (R48 §1); C3 chunking is designed, not built. |
| Turn transport | `backend/app/api/agent.py:877` (`GET /agent/turns/{id}/stream`) | **SSE**, `EventSourceResponse`, replay cursor, persist-before-emit. |
| Turn start | `agent.py:1119` (`POST /agent/chat`) | Request/response; a post during a live turn returns **202** and queues a steer (D41). |
| Turn stop | `agent.py:1022` (`POST /agent/turns/{id}/cancel`) | Idempotent, `?turn_id=`-scoped, harvest-first, replayable receipt, awaits `shutdown_grace_s`. |
| **WebSockets** | — | **VERIFIED NEGATIVE: ctrl-b has no WebSocket route anywhere** (`grep -rn "websocket" backend/app` → 0 hits). Every live channel today is SSE down + HTTP up. |

**The shape of the gap, stated once:** ctrl-b has a good *downlink* (durable server-owned turns +
SSE + a scoped cancel) and no *uplink* — no continuous audio channel, no VAD, no endpointing, and a
mic hook whose whole contract is "one tap = one clip".

---

## 2. The pointed repo — RealtimeVoiceChat, end to end

### 2.1 What the fork actually is (VERIFIED)

The fork is **upstream HEAD plus exactly one commit**. `9de323f` (the fork's parent) *is*
`KoljaB/RealtimeVoiceChat` HEAD — upstream has not moved since 2025-07-11. The fork commit changes:
TTS engine `kokoro` → `coqui` (XTTS "Lasinya" + a cloned British-accent reference voice), LLM
provider `ollama` → OpenRouter `google/gemini-2.5-flash-preview-05-20` (with the hardcoded key
above), `USE_SSL = True` with local mkcert paths, a first-sentence word cap 7 → 10 in the system
prompt, and ~30 MB of waifu/background art. **No architectural change.** Everything below is
therefore upstream's design, and citations are to the upstream SHA.

**Upstream is unmaintained** (VERIFIED, README): *"This project is no longer being actively
maintained by me due to time constraints… I will continue to review and merge high-quality,
well-written Pull Requests."* It pins `realtimestt==0.3.104` / `realtimetts[kokoro,coqui,orpheus]==0.5.5`;
RealtimeSTT is now **1.0.4** (§3). Treat the code as an excellent worked example of the *shape*, not
as a dependency.

### 2.2 The wire — WebSocket, raw PCM, a hand-rolled 8-byte header (VERIFIED)

One `@app.websocket("/ws")` (`server.py:872`) carrying **both** directions, four asyncio tasks per
connection (`server.py:940-945`): `process_incoming_data`, `AudioInputProcessor.process_chunk_queue`,
`send_text_messages`, `send_tts_chunks`.

**Uplink** — binary frames, `struct.unpack("!II", raw[:8])` = big-endian `timestamp_ms` + `flags`,
then raw `int16` PCM (`server.py:255-276`). Client side (`static/app.js:34-74`):

```js
const BATCH_SAMPLES = 2048;
const HEADER_BYTES  = 8;
const FRAME_BYTES   = BATCH_SAMPLES * 2;      // 4096
const MESSAGE_BYTES = HEADER_BYTES + FRAME_BYTES;   // 4104
```

**The numbers that decide designs:** 2048 samples per message at the `AudioContext`'s rate
(typically 48 kHz) = **42.7 ms per frame, 4104 bytes, ~23.4 messages/s ≈ 96 kB/s ≈ 0.77 Mbit/s
uplink, uncompressed, sent continuously from the moment you press Start** — there is **no
client-side VAD gate**: silence is transmitted at full rate. Server backpressure is a drop, not a
pause: `MAX_AUDIO_QUEUE_SIZE = 50` (env-tunable) ≈ **2.1 s** of backlog, then
*"Audio queue full; dropping chunk"* (`server.py:271-276`).

**Downlink** — JSON text frames only. TTS audio rides as `{"type":"tts_chunk","content":<base64>}`
(`server.py:490-495`) after `UpsampleOverlap.get_base64_chunk` resamples the engine's 24 kHz PCM to
48 kHz with a half-chunk overlap to hide boundary artefacts (`upsample_overlap.py:26-60`). That is
**~96 kB/s of PCM inflated to ~128 kB/s by base64 ≈ 1.02 Mbit/s downlink**. Total ≈ **1.8 Mbit/s
each conversation, uncompressed, in both directions, always on.**

The other downlink message types are the whole UI contract (`app.js:210-263`):
`partial_user_request` · `final_user_request` · `partial_assistant_answer` · `final_assistant_answer`
· `tts_chunk` · `tts_interruption` · `stop_tts`. Uplink JSON: `tts_start` · `tts_stop` ·
`clear_history` · `set_speed`.

**Two latent defects worth carrying forward:**

1. **A hardcoded resample ratio (VERIFIED, `audio_in.py:21`):** `_RESAMPLE_RATIO = 3`, i.e.
   48 000 → 16 000, applied unconditionally. Nothing on the wire carries a sample rate, and the
   client's `sampleRate: { ideal: 24000 }` constraint (`app.js:96`) is *irrelevant* because the
   worklet runs at `audioContext.sampleRate`, not the track's. On a device whose default
   `AudioContext` rate is 44 100 (some Android hardware) the server would feed Whisper 14 700 Hz
   audio labelled 16 000 — ~9 % fast and sharp. **VERIFIED in source; UNVERIFIED whether it bites in
   practice** (it would degrade WER silently, not crash).
2. **A dead field (VERIFIED):** `flags & 1` = `isTTSPlaying` is packed by the client, unpacked into
   `metadata["isTTSPlaying"]` by the server, and **never read again** (`grep isTTSPlaying code/` →
   only the pack/unpack sites). The wire has an echo-suppression hook nobody wired up; the actual
   mechanism is §2.6.

### 2.3 The ear — RealtimeSTT with a two-stage VAD (VERIFIED)

`AudioInputProcessor` (245 lines) resamples and hands bytes to `TranscriptionProcessor`
(`transcribe.py`, 839 lines), which wraps **`RealtimeSTT.AudioToTextRecorder` with
`use_microphone: False`** and is fed via `feed_audio()` — i.e. **the library's mic-owning design is
bypassed exactly the way a browser-client split needs.** The shipped config
(`transcribe.py:24-51`):

```python
"model": "base.en", "realtime_model_type": "base.en",
"use_main_model_for_realtime": False,
"silero_sensitivity": 0.05, "webrtc_sensitivity": 3,
"post_speech_silence_duration": 0.7,     # ← dynamically overwritten, see §2.4
"min_length_of_recording": 0.5, "min_gap_between_recordings": 0,
"enable_realtime_transcription": True, "realtime_processing_pause": 0.03,
"silero_use_onnx": True, "silero_deactivity_detection": True,
"beam_size": 3, "beam_size_realtime": 3,
"initial_prompt_realtime": "The sky is blue. When the sky... She walked home. Because he... ",
```

**Two whisper instances run concurrently** — a realtime one re-transcribing every 30 ms for partials
and a final one for the authoritative transcript. The `initial_prompt_realtime` is a prompt-hack: it
seeds Whisper with alternating complete/incomplete sentences so the partial text *carries
punctuation cues*, which is what the turn detector reads (§2.4).

**The VAD is two-stage, and the order is the efficiency argument** (VERIFIED, RealtimeSTT
`core/voice_activity.py:220-247`): cheap `webrtcvad` on 10 ms frames gates, and only when it fires
does the expensive Silero pass run — *on a thread*:

```python
    is_webrtc_speech(recorder, data)
    if recorder.is_webrtc_speech_active:
        if not recorder.silero_working:
            …
            # Silero is the expensive confirmation pass after WebRTC wakes it.
            thread_factory(target=is_silero_speech, args=(recorder, data, silero_generation)).start()
```

Silero runs on **512-sample (32 ms @ 16 kHz) frames**; the threshold is inverted sensitivity —
`vad_prob > (1 - silero_sensitivity)`, so the shipped `0.05` means **speech only above p = 0.95**, a
deliberately conservative barge-in trigger. Silero's recurrent state is explicitly reset between
utterances (`reset_silero_vad_state`) — *"it must not leak across warmup, listening attempts, or
completed recordings"*.

### 2.4 Turn detection — the one genuinely novel piece (VERIFIED, `turndetect.py`)

**This is what the repo is actually for.** Silence-duration endpointing alone is bad: 700 ms cuts
off a thinking pause, 1500 ms makes every reply feel slow. RVC makes
`post_speech_silence_duration` a **function of what you just said**, recomputed on every partial.

A **DistilBERT sequence classifier** (`KoljaB/SentenceFinishedClassification`, `max_length=128`,
LRU-cached 256 entries, GPU if available, warmed at boot) returns `P(sentence complete)`. Then
(`turndetect.py:_text_worker`, 402-500):

```python
whisper_suggested_pause      = avg over recent matching partials of {
      "..." → ellipsis_pause 2.3 | "." → punctuation_pause 0.39
    | "!" → 0.35 | "?" → 0.33 | none → unknown_sentence_detection_pause 1.25 }
sentence_finished_model_pause = interpolate_detection(prob)   # linear (0.0,1.0)→(1.0,0.0)
weight_towards_whisper = 0.65
weighted_pause = 0.65*whisper_suggested_pause + 0.35*sentence_finished_model_pause
final_pause    = weighted_pause * detection_speed            # 0.5 (fast) … 1.7 (very slow)
if contains_ellipses: final_pause += 0.2
min_pause = pipeline_latency + pipeline_latency_overhead     # 0.1
if final_pause < min_pause: final_pause = min_pause
```

Three design ideas here are worth more than the code:

- **The punctuation signal is averaged over the recent partials that share the same
  punctuation-stripped text** (`find_matching_texts`, a 20-deep deque). Whisper flip-flops the final
  "." across re-transcriptions; averaging the *stable* window is a cheap denoiser.
- **A single user-facing "speed" slider** (0–100 → `speed_factor` 0.0–1.0) linearly interpolates
  **all six** pause constants between a `fast` and a `very_slow` preset and is pushed live over the
  WebSocket (`set_speed`). One knob, no per-parameter UI.
- **The pipeline measures its own latency at boot and uses it as the floor.**
  `SpeechPipelineManager.__init__` runs `llm.measure_inference_time()` (time to 10 tokens) and the
  TTS engine's TTFA measurement, sums them into `full_output_pipeline_latency`
  (`speech_pipeline_manager.py:246-247`), and that number becomes both the minimum end-of-turn pause
  **and** the offset at which speculative generation fires (§2.5). *"Never wait less than it will
  take you to answer"* is a rule of thumb the code derives rather than hardcodes.

### 2.5 Speculative generation — where the perceived latency actually goes (VERIFIED)

RVC does not wait for end-of-turn to start thinking. A silence-monitor thread
(`transcribe.py:_start_silence_monitor`, 234-315) polls every 1 ms and fires three staged callbacks
off the *running* silence clock, all expressed as offsets from the (dynamic) `silence_waiting_time`:

| Trigger | Offset | Effect |
|---|---|---|
| `potential_sentence_end` | `silence_waiting_time − pipeline_latency − 0.02` | `SpeechPipelineManager.prepare_generation(partial_text)` — **the LLM starts generating on a partial transcript** |
| TTS allowance | `silence_waiting_time − 0.25` | sets `tts_quick_allowed_event` — synthesis may begin |
| "HOT" | `silence_waiting_time − 0.35` | UI/state hint that a final is imminent (with a COLD rollback if speech resumes) |

The LLM worker splits the stream into a **quick answer** and a **final answer**
(`speech_pipeline_manager.py:_llm_inference_worker` + `text_context.py`): `TextContext.get_context`
scans the first ≤120 chars for the first split token in `{. ! ? , ; : \n - 。 、}` that leaves
≥6 chars and ≥10 alphanumerics, and *that first clause* is handed to TTS immediately
(`QUICK_ANSWER_STREAM_CHUNK_SIZE = 8` vs `FINAL_ANSWER_STREAM_CHUNK_SIZE = 30`, `audio_module.py:27-28`).
The system prompt's *"Your FIRST sentence MUST be 7 words or less"* exists **to make this trick
work** — it is a latency mechanism disguised as a persona instruction.

**If the user turns out not to be finished, the speculative work is thrown away** — but only if the
text actually changed: `check_abort` compares the new text to the running generation's with
`TextSimilarity(focus='end', n_words=5)` and **ignores anything ≥ 0.95 similar**
(`speech_pipeline_manager.py:509-513`). That similarity gate is what stops Whisper's partial
churn from cancelling and restarting the LLM on every 30 ms tick.

### 2.6 Barge-in — exactly how the TTS is killed and the turn aborted (VERIFIED)

Two independent paths:

**(a) Acoustic.** RealtimeSTT's VAD fires `on_recording_start` → `server.py:774-816`. If
`tts_client_playing` (a flag the *client* maintains and reports via `tts_start`/`tts_stop` JSON, set
from the playback AudioWorklet's own `ttsPlaybackStarted`/`Stopped` messages —
`app.js:145-164`), then in order: stop server→client TTS (`tts_to_client = False`), mark
`user_interrupted`, **force-send the partial assistant answer as final** (`send_final_assistant_answer(forced=True)`
— so the conversation history records what was *said so far*, not the whole planned reply),
`stop_tts` to the client, `abort_generations(...)`, then `tts_interruption` to the client.

Client-side both messages clear the playback worklet's ring buffer instantly —
`ttsWorkletNode.port.postMessage({type:"clear"})` (`ttsPlaybackProcessor.js:12-21` zeroes
`bufferQueue`/`readOffset`/`samplesRemaining`) — and `stop_tts` additionally latches
`ignoreIncomingTTS = true` so chunks already in flight over the WebSocket are dropped.

**(b) Textual.** Every partial transcript also pokes a dedicated `AbortWorker` thread
(`server.py:601-619`) which calls `SpeechPipelineManager.check_abort(text, …)` behind the 0.95
similarity gate. So a *changed* partial aborts the speculative generation even without a fresh
VAD start.

**The abort itself is a synchronous, event-fenced teardown** (`process_abort_generation`,
`speech_pipeline_manager.py:834-950`): mark `abortion_started`, clear `abort_block_event` to *block
new requests first*, set `stop_llm_request_event` / `stop_tts_quick_request_event` /
`stop_tts_final_request_event`, **also set the workers' *start* events so a worker parked on a wait
wakes up and sees the stop**, then `wait(timeout=5.0)` for each worker's `stop_*_finished_event`,
call `llm.cancel_generation()`, close the generator, clear `running_generation`, set
`abort_completed_event`, re-set `abort_block_event`. Eleven `threading.Event`s, three 5 s timeouts,
one 7 s outer timeout. **This is the part of the design that is expensive, and it is expensive
because the workers are threads, not tasks.**

**A finding that changes designs — the barge-in dead zone.** At end of user turn, `on_before_final`
sets `AudioInputProcessor.interrupted = True` (`server.py:717-720`), and
`process_chunk_queue` then **drops incoming audio entirely** (`audio_in.py:196-201`:
`if not self.interrupted: self.transcriber.feed_audio(...)` — no else, no buffering). It is cleared
either **1 s after the first TTS chunk is sent** (`_reset_interrupt_flag_async`, `server.py:347-365`)
or **2 s after end of turn** (`send_tts_chunks`, `server.py:399-403`), whichever comes first.
**So for the first ~1–2 s of every bot reply — precisely when a user is most likely to cut in — the
system is deaf by construction.** This is not documented anywhere in the repo; it is the mic-side
echo guard doing double duty, and it is the price of not trusting AEC (§6.1).

### 2.7 The mouth — RealtimeTTS (VERIFIED)

`AudioProcessor` (`audio_module.py`) wraps `RealtimeTTS.TextToAudioStream` over `CoquiEngine` /
`KokoroEngine` / `OrpheusEngine`, feeding it a *token generator* rather than a string, with
per-engine sentence/comma silence tuples (`Silence(comma=0.3, sentence=0.6, default=0.3)` for all
three) and two stream chunk sizes (quick 8 / final 30). Output PCM lands on an `asyncio.Queue`,
gets 24 k→48 k upsampled with overlap, base64'd, and pushed. `on_first_audio_chunk_synthesize` sets
`quick_answer_first_chunk_ready`, which is the gate `send_tts_chunks` waits on before it starts
draining — i.e. **playback starts on the first synthesized chunk of the first clause, not on the
first complete sentence.**

### 2.8 Concurrency + hardware (VERIFIED)

- **Threads, not tasks, for everything model-shaped.** Four daemon worker threads in
  `SpeechPipelineManager` (request / LLM / TTS-quick / TTS-final), one `AbortWorker` per connection,
  one silence-monitor thread, one turn-detection text worker, plus a Silero thread per VAD wake.
  asyncio is used only for the WebSocket and the audio queue.
- **`SpeechPipelineManager` and `AudioInputProcessor` are process-global singletons on `app.state`**
  (`server.py:113-127`), and `websocket_endpoint` **re-binds their callbacks to the new connection**
  on every connect (`server.py:918-934`). A second browser tab silently hijacks the first's
  pipeline, and `history` is global. **Single-user by construction** — which happens to be exactly
  ctrl-b's N=1, but it means the code carries no multi-session lessons.
- **GPU (REPORTED, README + docker-compose):** *"A powerful CUDA-enabled NVIDIA GPU is highly
  recommended"*, CUDA 12.1, NVIDIA Container Toolkit; the compose file reserves `count: all` GPUs
  **for both the app and the Ollama service**. Resident models: Whisper `base.en` ×2 (realtime +
  final), Silero VAD (ONNX), DistilBERT turn classifier, XTTS-v2 or Kokoro, and the LLM.
- **No published latency figure anywhere** (VERIFIED negative: `grep -i latency README.md` → two
  marketing lines, no number). The only latency numbers in the system are the ones it measures about
  itself at boot (§2.4). **Any "RealtimeVoiceChat achieves X ms" claim is not from this repo.**

### 2.9 What would *not* port to ctrl-b (VERIFIED, our reading flagged in §9)

The mic is in a phone browser and the models are on LAN hosts, so: the global-singleton pipeline,
the thread-per-stage abort fence, the "one process owns STT+LLM+TTS+history" assumption, and the
uncompressed 1.8 Mbit/s duplex PCM channel are all shaped by *"everything runs on the one GPU box
the user is sitting at"*. What ports is the **staging** (§2.4/§2.5) and the **interruption
semantics** (§2.6).

---

## 3. RealtimeSTT / RealtimeTTS as they are *today* — the libraries moved, the app didn't

**RealtimeSTT is at v1.0.4 and now ships a first-class remote server** (VERIFIED,
`RealtimeSTT_server/PRODUCTION_SERVER.md`), which is the single most relevant fact for a
browser-client + LAN-models split:

- `stt-server-production` — FastAPI, **loopback bind by default**, *"A direct non-loopback bind is
  rejected unless a bearer token and both Uvicorn TLS files are configured"*, token only via
  `REALTIMESTT_SERVER_BEARER_TOKEN` (literal CLI tokens rejected), documented reverse-proxy recipe.
  This is a security posture ctrl-b would not have to fight.
- WebSocket at `/api/v1/ws/transcribe` (aliases `/api/v1/ws`, **`/v1/audio/transcriptions/stream`**).
  Commands `{"type":"start"|"finalize"|"reset"|"cancel"}`; binary audio is length-prefixed with
  metadata `{"sampleRate":16000,"channels":1,"format":"pcm_s16le","frames":640,"audioSequence":N}` —
  **note `frames: 640` = 40 ms, and "clients must keep one stateful resampler for the logical turn
  and must not restart a resampler for each packet"** (the mistake RVC's `_RESAMPLE_RATIO` invites).
- Per-session bounded outbound queue with **partial-coalescing under backpressure and a two-event
  terminal reserve** (final + completion are never dropped); exhausting it closes with WS **1013**.
  That is a better wire contract than RVC's "drop chunks when the inbound queue is full".
- **The load-bearing caveat (VERIFIED):** *"The versioned production WebSocket path does not
  instantiate a recorder or use VAD to decide turn finals."* Turn decisions are the **client's**
  job in this mode; `finalize` seals the turn. The VAD/turn machinery lives only in the in-process
  `AudioToTextRecorder`.
- CPU is now a first-class profile: the recommended non-GPU pairing is
  `sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8` for live text +
  `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` for the authoritative final, because Nemotron
  *"processes only new audio frames during the turn"* instead of re-transcribing a growing buffer —
  which is exactly what RVC's `base.en` realtime instance does 33×/s.

**RealtimeTTS** is likewise at HEAD `e61420f9` (2026-08-21) vs RVC's pinned 0.5.5. Not read in
depth: R48/R50 already establish that ctrl-b's TTS answer is an OpenAI-compatible HTTP endpoint
(Speaches/Kokoro) plus a client element queue, and RealtimeTTS is an *in-process Python* engine
wrapper — the wrong layer for us.

---

## 4. The field cross-check — pipecat and livekit/agents

These are the two production voice-agent frameworks, and where they **agree with each other and
disagree with RVC** is the most useful signal in this dossier.

### 4.1 Turn-taking is a *pluggable pair*, not a number (VERIFIED, pipecat `src/pipecat/turns/`)

Pipecat decomposes the user turn into **start strategies × stop strategies**:

```
start: [VADUserTurnStartStrategy, TranscriptionUserTurnStartStrategy]   # defaults
 stop: [TurnAnalyzerUserTurnStopStrategy(LocalSmartTurnAnalyzerV3)]     # default
```

with shipped alternatives `WakePhraseUserTurnStartStrategy`, `MinWordsUserTurnStartStrategy`,
`KrispVivaIP…`, `ExternalUserTurnStartStrategy` on the start side, and
`SpeechTimeoutUserTurnStopStrategy`, `DeferredUserTurnStopStrategy`,
`LLMTurnCompletionUserTurnStopStrategy`, `ExternalUserTurnStopStrategy` on the stop side. VAD
parameters are separate and small (`VADParams`: `confidence 0.7, start_secs 0.2, stop_secs 0.2,
min_volume 0.6`).

### 4.2 Silence-only endpointing is dead — three independent replacements (VERIFIED)

| System | Mechanism | Cost |
|---|---|---|
| **RVC** | DistilBERT text classifier over the partial transcript → dynamic silence duration | ~66 M params, GPU-warmed, needs partials |
| **pipecat Smart Turn v3** | **audio-domain ONNX classifier** on Whisper log-mel features, 16 kHz, `stop_secs 3`, `pre_speech_ms 500`, `max_duration_secs 8` | **`smart-turn-v3.2-cpu.onnx` = 8.7 MB, bundled in the wheel, `intra_op_num_threads=1` by default** — no GPU, no transcript |
| **pipecat `FilterIncompleteUserTurnStrategies`** | asks **the main LLM** to prefix every reply with `✓` (complete) / `○` (incomplete short) / `◐` (incomplete long); only `✓` finalizes the turn | zero extra models; costs a prefix token and a round trip |
| **OpenAI Realtime `semantic_vad`** (REPORTED, developers.openai.com) | hosted classifier over *"actual words spoken"*, one knob `eagerness: low\|medium\|high\|auto` | hosted |

**8.7 MB of CPU ONNX is the finding that most changes a design here.** RVC's approach needs a GPU
and a live partial-transcript stream; Smart Turn v3 needs neither and is a drop-in over any VAD.

### 4.3 Interruption is a *policy object* with false-positive recovery (VERIFIED, livekit/agents `voice/turn.py`)

```python
_INTERRUPTION_DEFAULTS = {
    "enabled": True, "discard_audio_if_uninterruptible": True,
    "min_duration": 0.5, "min_words": 0,
    "resume_false_interruption": True, "false_interruption_timeout": 2.0,
    "backchannel_boundary": (1.0, 1.0),
}
_ENDPOINTING_DEFAULTS           = {"mode": "fixed", "min_delay": 0.5, "max_delay": 3.0, "alpha": 0.9}
_STREAMING_ENDPOINTING_DEFAULTS = {"mode": "fixed", "min_delay": 0.3, "max_delay": 2.5, "alpha": 0.9}
_PREEMPTIVE_GENERATION_DEFAULTS = {"enabled": True, "preemptive_tts": False,
                                   "max_speech_duration": 10.0, "max_retries": 3}
```

Three things RVC has no equivalent of:

- **`min_duration: 0.5` / `min_words`** — a cough or "mhm" must clear a floor before it counts as an
  interruption. Pipecat ships the same idea as `MinWordsUserTurnStartStrategy` (with
  `use_interim: True` so interim transcripts count).
- **`resume_false_interruption: True, false_interruption_timeout: 2.0`** — if the "interruption"
  produces no transcript within 2 s, **the agent resumes speaking**. RVC's interruption is
  irreversible: the generation is torn down through eleven events and cannot come back.
- **`preemptive_generation` is a first-class default-on option** — the field independently arrived
  at RVC's speculative-generation trick and made it a config flag.

### 4.4 What the model is told it said — the barge-in context problem (VERIFIED)

LiveKit persists the assistant turn **truncated to what was actually played**
(`voice/agent_activity.py:2971-3004`):

```python
        # use synchronized transcript when available after interruption
        forwarded_text = text_out.text if text_out else ""
        if speech_handle.interrupted and audio_output is not None:
            playback_ev = await audio_output.wait_for_playout()
            if audio_out is not None and audio_out.first_frame_fut.done() and not …cancelled():
                if playback_ev.synchronized_transcript is not None:
                    forwarded_text = playback_ev.synchronized_transcript
            else:
                forwarded_text = ""
        …
            msg = self._agent._chat_ctx.add_message(role="assistant", content=forwarded_text,
                                                    interrupted=speech_handle.interrupted, …)
```

RVC does the cheap version of the same thing (`send_final_assistant_answer(forced=True)` writes the
*generated-so-far* text, not the *spoken-so-far* text — so the model still over-remembers by up to a
sentence). OpenAI's protocol answer is `conversation.item.truncate` with an
`audio_end_ms`. **This is R35 §12 divergence ④ arriving from a second direction:** ctrl-b's Stop
today leaves no model-visible trace at all, and a voice mode makes that a correctness bug rather
than a nicety — the user will say *"no, stop, I meant…"* about words the model believes it never
said.

### 4.5 Transport: WebRTC for browsers, WebSocket for server-side pipes (REPORTED, OpenAI docs)

OpenAI's Realtime guide splits the three transports by *who holds the microphone*:

- **WebRTC** — *"browser and mobile clients that capture or play audio directly"*
- **WebSocket** — *"when your server already receives raw audio from a media pipeline, call system,
  or worker"*
- **SIP** — telephony.

**ctrl-b's live-voice case is the first bullet, and RVC is the second bullet's design applied to the
first bullet's problem.** The concrete costs of that mismatch are §2.2 (uncompressed PCM, no
jitter buffer, drop-on-overflow) and §6.1 (no AEC reference signal).

---

## 5. The four chat-UI peers — a near-total negative beyond open-webui

R48 §2.2 already dissected open-webui's `CallOverlay` (the one in-class conversational loop:
re-split the growing buffer on every delta, `pop()` the incomplete tail, unbounded synth-ahead,
**≥300 ms of deliberately inserted silence per chunk boundary**). The question here was whether the
other three ship anything comparable. **They do not** (VERIFIED, source-read at the SHAs in §0):

| Peer | Voice input | Endpointing | Duplex / call mode |
|---|---|---|---|
| **LibreChat** | two hooks — `useSpeechToTextBrowser` (`react-speech-recognition`, i.e. the **Web Speech API**) and `useSpeechToTextExternal` (MediaRecorder → upload) | `monitorSilence`: an `AnalyserNode` with a user-set `minDecibels`, polled by **`requestAnimationFrame`**, auto-stop after **3000 ms** of no bins > 0; then an `autoSendText`-second timer before sending | **none** — `grep -rli "callOverlay\|full.duplex\|bargeIn" client/src` → 0 |
| **AnythingLLM** | `SpeechToText/BrowserNative` (Web Speech API) and `SpeechToText/ServerSTT` (MediaRecorder → upload) | `const SILENCE_INTERVAL = 3_200; // ms of silence before auto-stop, matches BrowserNative.` | **none** |
| **LobeChat** | (R48 §2.5: TTS-side only) | — | **none** |
| **open-webui** | call overlay | — | **the only one** (R48 §2.2) |

Three secondary findings from that negative:

1. **Two of three peers' *primary* voice input is the browser's own `SpeechRecognition`.** On Chrome
   Android that ships audio to Google's servers, and Gecko does not implement it at all — so it is
   **structurally unavailable to ctrl-b** on both the privacy axis (tailnet-only is the whole
   premise) and the Fennec axis. Worth recording because it explains why the field's chat UIs get
   "continuous listening" cheaply and we cannot.
2. **A 3.0–3.2 s energy-threshold silence auto-stop is the field's *entry-level* answer**, and both
   peers landed within 200 ms of each other independently. That is a ~30-line, zero-model
   intermediate step between ctrl-b's push-to-talk and a real live mode (§9, Tier 0).
3. **LibreChat's detector is driven by `requestAnimationFrame`** — which stops when the tab is
   hidden. R14 §3.4 already rules `setInterval`/`setTimeout` out for the same class of reason; rAF
   is the same mistake with a different clock. **Any ctrl-b detector belongs in an AudioWorklet.**

---

## 6. The browser half, for *our* shape

### 6.1 Echo cancellation is the load-bearing platform question, and it has a trap

Barge-in requires that the mic not hear the TTS. Otherwise the failure is not subtle: the leaked
audio is transcribed, the VAD fires, and **the bot interrupts itself** (REPORTED, LiveKit community
threads + livekit/agents #3758, #916 — *"leaked echo gets transcribed and triggers barge-in, so the
bot interrupts itself"*).

**MDN's definition of the constraint (REPORTED, MDN `MediaTrackConstraints.echoCancellation`, read
2026-08-21)** — note what `remote-only` is scoped to:

> `true`: *"The browser decides what audio will be removed from the signals recorded by the
> microphone. It must attempt to cancel at least as much as `remote-only` and should attempt to
> cancel as much as `all`."*
> `"remote-only"`: *"Only user system-generated audio captured by the user's microphone **from
> remote sources (as represented by MediaStreamTracks sourced from an RTCPeerConnection)** is
> removed."*

So the **guaranteed** floor is "cancel what came over a peer connection", and cancelling
same-page `<audio>` / Web Audio output is a *should*, not a *must*. The W3C spec text
(`mediacapture-streams` §echoCancellation) is vaguer still and defines the enum members without
saying what each cancels.

**REPORTED, and consistent across four independent secondary sources (discuss-webrtc, a
public-webrtc issue thread, and two write-ups, all read 2026-08-21): Chromium does not use
locally-played audio (HTMLAudioElement or Web Audio) as the AEC reference signal — only audio
arriving via an `RTCPeerConnection` — while Firefox, Safari and Edge consider all browser audio.**
Chrome's stated position is that the spec does not say which audio must be cancelled. **This is the
single most consequential unverified claim in this dossier** (see §8) and it has a well-known,
cheap workaround:

**The loopback-`RTCPeerConnection` trick (REPORTED, with a linked gist):** route the TTS through
`AudioContext.createMediaStreamDestination()` → a *local* `RTCPeerConnection` pair → set the
loopback stream as the `<audio>` element's `srcObject`. The audio never leaves the device, but
Chromium now classifies it as remote and applies AEC. **This means a WebSocket-transport design can
still get AEC** — it just has to fake the peer connection locally, and it is ~40 lines. (It is also
why RVC's `interrupted` dead zone (§2.6) exists: RVC plays TTS through a bare AudioWorklet, gets no
AEC reference on Chrome, and compensates by going deaf for 1–2 s.)

Note also that ctrl-b's current mic call passes **no constraints at all** —
`getUserMedia({ audio: true })` (`useDictation.ts:184`) — so today it takes whatever the UA
defaults to. RVC asks for `echoCancellation: true, noiseSuppression: true, channelCount: 1`
(`app.js:94-102`).

### 6.2 Capture mechanism: AudioWorklet, not MediaRecorder (VERIFIED where marked)

- **MediaRecorder's `timeslice` chunks are not independently decodable.** MDN's `start()` page
  documents only *"The number of milliseconds to record into each Blob"* and that *"timeslice is not
  exact"* — it says **nothing** about chunk structure, and in practice a WebM/Matroska stream puts
  the header in the first blob only. ctrl-b's own STT contract already depends on the container
  being whole: `useDictation.ts:132-135` derives the upload filename extension from the recorder's
  real `mimeType` *"(mime ↔ ext must agree — Whisper routes by extension)"*, and
  `adapters/voice.py:184` forwards the file as one unit. **A "just add `timeslice` and POST each
  blob" streaming path would send the server headerless fragments.** (VERIFIED that our code assumes
  a whole container; REPORTED that WebM timeslice chunks lack per-chunk headers.)
- **The field's answer is raw PCM out of an AudioWorklet.** RVC's `pcmWorkletProcessor.js` is
  20 lines — clamp float32, convert to Int16, `postMessage(buffer, [buffer])` **as a transferable**
  (zero-copy). Playback is a second 68-line worklet with a ring buffer and a `{type:"clear"}`
  control message. That pair is the entire client audio engine, and it is the cheapest thing in the
  whole repo to port.
- **R14 §3.4 (already owned) forbids the timer-driven alternative:** Chrome's intensive throttling
  checks timers *once per minute* for hidden pages, and the exemption is scoped to an
  `RTCPeerConnection` with a live track — **not** a bare `getUserMedia` track. *"Never drive the
  detector from `setInterval`/`setTimeout`. Put the inference in an AudioWorklet."* (§5's LibreChat
  `requestAnimationFrame` finding is the same rule violated.)

### 6.3 Background / screen-off / permissions — **already bought, do not re-buy**

R14 settles this and nothing here changes it:

- **Screen Wake Lock keeps the screen on and nothing else** — right tool for a docked/screen-on
  "call", useless for screen-off (R14 §3.4).
- **Chrome Android holds a microphone-typed foreground service** (VERIFIED in R14 §3.2), so
  screen-off capture is *plausible but unproven*; **Fenix declares none, so Firefox background
  capture is structurally dead** (R14 §3.3).
- **Installing as a PWA does not raise the background ceiling** (R14 §3.5).
- **Mic permission persistence: Chrome Android favourable (REPORTED), Fennec undetermined** (R14 §4)
  — a live-voice mode that re-prompts every launch is DOA on Firefox until that is probed on the
  owner's phone.
- Secure context is already solved: Tailscale Serve HTTPS (`docs/RESEARCH.md` §"Secure context for
  the mic", D1). **WebSocket over `wss:` and WebRTC both ride the same origin** — no new
  certificate work either way.

### 6.4 One thing we already own that nobody expected — **Speaches ships the OpenAI Realtime API**

**VERIFIED by live probe on emma (`GET http://127.0.0.1:9000/openapi.json`, Speaches 0.8.3,
2026-08-21):** the owner's TTS/STT server exposes **`/v1/realtime`** — as a `POST` "Realtime Webrtc"
SDP-exchange endpoint *and* (source, `routers/realtime_ws.py:56`) as a **WebSocket** speaking the
OpenAI Realtime event protocol. Also verified: `/v1/audio/transcriptions` accepts `stream: bool`.
Source at `993994f7`:

- **Server VAD is real and configurable** (`realtime/session.py:59-66`):
  `TurnDetection(type="server_vad", threshold=0.9, prefix_padding_ms=0, silence_duration_ms=550,
  create_response=…)`, `input_audio_format="pcm16"`, `output_audio_format="pcm16"`,
  `speech_model="speaches-ai/Kokoro-82M-v1.0-ONNX"`, session lifetime 30 min.
- The VAD is **Silero v5 re-run over a rolling 3 s window on every `input_audio_buffer.append`**
  (`input_audio_buffer.py:36`: `MAX_VAD_WINDOW_SIZE_SAMPLES = 3000 * MS_SAMPLE_RATE`;
  `input_audio_buffer_event_router.py:47-101`), emitting
  `input_audio_buffer.speech_started` / `.speech_stopped`. Client audio is base64 pcm16 **at
  24 kHz**, resampled server-side to 16 kHz.
- **A Speaches-specific extension matters to us:** `create_session_object_configuration(…,
  intent="transcription")` makes the URL `model` param the *transcription* model and sets
  `create_response=False` — i.e. **transcription-only mode: server VAD + endpointing + transcripts,
  no LLM, no TTS.**
- **Three gaps, all VERIFIED, all decision-relevant:**
  1. **Transcription is not streaming.** `InputAudioBufferTranscriber._handler` waits for
     speech-stop, writes the VAD-trimmed buffer to a WAV in memory and makes **one**
     `transcriptions.create(...)` call. There are **no partial transcripts** — so the RVC/pipecat
     tricks that key off partials (speculative generation, min-words interruption, text-based
     turn detection) have no input here.
  2. **`conversation.item.truncate` is not implemented** — the handler publishes
     *"Handling of the 'conversation.item.truncate' event is not implemented."* That is exactly the
     §4.4 primitive.
  3. **No server-side auto-interrupt.** `speech_started` is published but nothing cancels the active
     response; `cancel_active()` only runs on a new `response.create` or an explicit
     `response.cancel`. Barge-in is the client's job.
- **And the structural one:** in conversation mode Speaches' `response_event_router` calls a chat
  completion **itself** and handles function calls itself. Using `/v1/realtime` end-to-end would
  **bypass ctrl-b's entire agent loop** — tools, D8 confirm gates, prompts registry, core memory,
  attribution, thread persistence, steer queue. **Only `intent=transcription` is architecturally
  admissible for us.**

---

## 7. Cross-cutting numbers table (for whoever designs this)

| Quantity | RVC | pipecat | livekit | Speaches realtime | ctrl-b today |
|---|---|---|---|---|---|
| Uplink frame | 2048 samples ≈ 42.7 ms, raw pcm16 + 8 B header | (transport-dependent) | WebRTC opus | base64 pcm16 @24 kHz | n/a (one blob) |
| VAD | webrtcvad(10 ms) → Silero(512 samp), speech at p>0.95 | Silero, `confidence 0.7`, `start/stop_secs 0.2` | Silero + APM | Silero v5, `threshold 0.9`, 3 s window | `vad_filter` server-side only |
| End-of-turn | dynamic 0.1–3.0 s from DistilBERT + punctuation | Smart Turn v3 ONNX (8.7 MB) or LLM `✓/○/◐` | `min_delay 0.5`, `max_delay 3.0` | `silence_duration_ms 550` | user's second tap |
| Interruption floor | none (VAD start + 0.95 text-similarity gate) | `MinWordsUserTurnStartStrategy` | `min_duration 0.5`, `min_words 0` | none (client's job) | n/a |
| False-interruption recovery | none (irreversible teardown) | — | `resume_false_interruption`, `timeout 2.0` | none | n/a |
| Speculative generation | yes, at `silence − pipeline_latency − 0.02` | — | `preemptive_generation` on by default | no | no |
| Barge-in dead zone | **1–2 s, deaf** (§2.6) | none | none | none | n/a |
| Bandwidth | ~1.8 Mbit/s duplex uncompressed | — | opus | base64 pcm16 (~1.3× raw) | one POST per utterance |

---

## 8. What I could not determine

1. **Whether Chromium *on Android* uses locally-played audio as the AEC reference.** §6.1's claim is
   REPORTED from four secondary sources and a 2019-rooted W3C thread, and Chrome's Android path may
   use the platform `AcousticEchoCanceler` (which cancels the *device's* output, not just a peer
   connection) rather than AEC3's browser-render reference. **This single fact decides whether
   barge-in needs the loopback-`RTCPeerConnection` trick, a WebRTC transport, or nothing.** It is a
   ~20-minute device probe: play a known TTS clip through an `<audio>` element while recording with
   `echoCancellation:true`, and measure whether the clip appears in the capture. Do this on the
   owner's phone in Chrome **and** Fennec before any design is locked.
2. **Fennec's mic-permission persistence** — R14 §4 left it UNDETERMINED and this pass adds nothing.
   Still a device probe.
3. **Whether RVC's `_RESAMPLE_RATIO = 3` bug ever fires in practice** — I did not run the app, and
   the distribution of default `AudioContext.sampleRate` values on Android hardware is not something
   I could establish from source.
4. **Measured latency of RVC** — the repo publishes none (§2.8) and I did not stand it up (it wants
   a CUDA GPU, an XTTS model download, and an LLM). Every "X ms" figure you may see attributed to it
   is from a third party.
5. **Smart Turn v3's accuracy** — I verified the model file, its size, its input pipeline and its
   defaults, but pipecat publishes no in-repo eval, and I did not benchmark it.
6. **What Speaches' WebRTC `/v1/realtime` POST actually negotiates** — it returned **403** to an
   unauthenticated probe (bearer-gated), and I did not use the owner's key for an SDP exchange. The
   WebSocket flavour is source-verified; the WebRTC flavour is inferred from the router name and the
   `rtc/` package.
7. **Whether llama.cpp on corsair can sustain the token cadence a duplex loop needs while
   `narrow_tools` churns the prefix cache** — R36's open item, unchanged, and it becomes
   latency-visible in a voice mode.
8. **LobeChat's voice input** — I read only its `package.json` (no `getUserMedia`, no VAD deps) plus
   R48 §2.5's TTS-side reading. I did not source-read its input path; "no call mode" for LobeChat is
   the weakest cell in §5's table.

---

## 9. Implications — **our reading, not evidence**

Everything above is sourced. Everything below is inference and should be argued with.

### 9.1 What ctrl-b already has that carries over unchanged

- **The output half is already designed.** C3 (R48/R50) is *exactly* the mouth a live mode needs:
  sentence chunks, opus, an `HTMLAudioElement` queue with a 4–6 ms src-swap seam, depth-1 prefetch,
  synth at 6.1× realtime, ~0.7 s to first audio. A live mode does not need a different TTS
  architecture — it needs C3 plus a *kill* verb on the queue (open-webui's `#halt()`, RVC's
  worklet `{type:"clear"}`).
- **The turn machinery is unusually good for this.** Server-owned durable turns, SSE with a replay
  cursor, persist-before-emit, a scoped idempotent cancel with a replayable steer harvest, and a
  202-steer path that already accepts input *during* a live turn (D41). R35 rated our turn top-tier;
  a voice mode is the first feature that *needs* all of it.
- **The provider registry + failover** (D48) already gives per-service targets, timeouts and
  `extra_body` — a streaming STT target is a new *shape*, not a new *concept*.
- **Speaches already speaks the protocol** (§6.4). We may not need a new service at all.

### 9.2 What is genuinely new, in dependency order

1. **A continuous audio uplink.** ctrl-b has zero WebSocket surface. This is the single largest new
   piece and it drags in: an AudioWorklet capture path, a framing contract, backpressure policy, and
   reconnect semantics on a phone that sleeps.
2. **VAD + endpointing.** Either delegated (Speaches server VAD) or ours (Silero-ONNX in a worklet).
3. **Interruption plumbing into the agent loop.** Cancel already exists; what does not exist is
   **"what the model believes it said"** (§4.4). This is R35 divergence ④ and it stops being
   cosmetic here.
4. **A session state machine** the UI can render: idle → listening → thinking → speaking →
   interrupted, with a hard "hang up".
5. **Echo control** (§6.1) — possibly nothing, possibly 40 lines of loopback peer connection,
   possibly a transport decision. **Probe first.**

### 9.3 Three candidate architectures, ranked

**Ranked on: reliability for one user on a tailnet, efficiency (both compute on LAN hosts and code
we must own), and how much of ctrl-b's existing architecture survives intact.**

---

**① Speaches-realtime as the ear, ctrl-b as the brain, C3 as the mouth.** ★ recommended

```
phone (AudioWorklet pcm16)
   └─ wss ─▶ ctrl-b /api/voice/live  (thin relay + session state)
                 └─ ws ─▶ Speaches /v1/realtime?intent=transcription   (Silero VAD + endpointing + final transcript)
                 ◀── transcript ──┘
                 └─▶ existing agent turn (POST /agent/chat or the 202 steer path)
                 └─▶ existing SSE downlink for text
                 └─▶ C3 chunked TTS for audio  (+ a kill verb)
```

*Why first:* it buys VAD, endpointing and utterance segmentation from a service the owner already
runs, on a machine that already holds the Whisper weights, for **zero new models and zero new
hosts**. The agent loop, the prompts registry, core memory, attribution, tools and the confirm gate
are all untouched — the transcript enters through the same door a dictation transcript enters
today. It degrades gracefully: if the realtime socket dies, the mic button still works.

*What it costs:* one new WS route in ctrl-b (a relay, not a pipeline), the client audio worklet,
and a session state machine. Roughly: worklet ~60 lines, relay ~200, state machine + UI ~300.

*What it cannot give you:* **partial transcripts** (§6.4 gap 1), therefore **no speculative
generation and no text-based interruption gating**. Time-to-first-audio ≈ `silence_duration_ms`
(550) + whole-utterance Whisper + LLM TTFT + C3's ~0.7 s. That is a *conversational* mode, not a
*sub-second* one — and for a homelab control panel, "say the thing, get an answer" is the actual use
case. **Barge-in works** because it is client-driven anyway: local VAD/energy on the phone → clear
the C3 queue instantly → `POST /agent/turns/{id}/cancel` (already idempotent and scoped).

*Risks:* Speaches' realtime path is the least-exercised part of that server (its own source carries
`# FIX: magic number` and an unimplemented truncate); it is bearer-gated and we must not put the key
in the browser (hence the relay, not a direct phone→Speaches socket); and re-running Silero over a
3 s window on every append is CPU we are adding to emma.

---

**② Own the ear: Silero-ONNX + Smart Turn v3, in ctrl-b.** ★★ if ① proves too coarse

Same skeleton, but ctrl-b runs the VAD itself — **client-side** Silero in the capture worklet (so
silence never leaves the phone, killing §2.2's always-on 0.77 Mbit/s uplink) plus **server-side**
`smart-turn-v3.2-cpu.onnx` (8.7 MB, CPU, no transcript needed) for end-of-turn, then one existing
`/api/voice/stt` POST per utterance — **no streaming STT at all, and no new voice service.**

*Why it is attractive:* it reuses the STT adapter and its failover **exactly as built**, it makes the
uplink bursty instead of continuous, and it puts the two tunables (`VADParams`-shaped and
`SmartTurnParams`-shaped) in `config.yaml` where the no-hardcoding rule wants them. It is also the
only option that works if Speaches is swapped for a different OpenAI-compatible server.

*Why it is second:* two new model artefacts to ship and version (onnxruntime-web in the PWA bundle —
and R14 §3.4 already warns that cross-origin isolation is off the table, so plan single-threaded
WASM+SIMD), plus we own the endpointing quality forever. R14's finding that in-browser ONNX is
"real but community-grade" applies.

---

**③ Port RealtimeVoiceChat's shape wholesale.** ✗ not recommended

A duplex WebSocket carrying raw PCM both ways, a dedicated pipeline manager with threaded LLM/TTS
workers, speculative generation, and a DistilBERT turn classifier.

*Why not:* it is the second-bullet transport applied to the first-bullet problem (§4.5); it needs a
GPU-resident DistilBERT + two Whisper instances on a host that also runs the LLM; its abort path is
eleven `threading.Event`s and three 5-second timeouts inside a codebase whose entire concurrency
model is asyncio; its pipeline is a process-global singleton; and it would fork the agent loop —
RVC's `SpeechPipelineManager` owns its own `history`, so tools, memory, prompts and attribution
would all need re-plumbing into a second turn engine. The 1.8 Mbit/s uncompressed duplex channel on
a phone is the least of it.

*What to steal from it anyway:* (a) the **20-line PCM capture worklet and 68-line playback worklet**
— genuinely the best code in the repo; (b) **measure the pipeline's own latency at boot and use it
as the endpointing floor** (§2.4); (c) the **similarity gate on re-transcribed partials** so churn
does not cancel work (0.95, end-focused, 5 words); (d) the **single "speed" slider** interpolating
all pause constants — one owner-facing knob, not six; (e) the *negative* lesson of the
**1–2 s deaf window** — do not let the echo guard eat the barge-in window; fix echo properly instead.

### 9.4 The honest cost assessment

- **Tier 0 — "auto-stop dictation", ~1 day.** Add an AnalyserNode energy detector to
  `useDictation` with a config-driven silence timeout (the field's own numbers: 3.0–3.2 s, §5) and
  `auto_send` already exists. No new services, no new models, no protocol. This alone converts
  push-to-talk-twice into say-it-and-it-goes, and it is the 80 % of the owner's felt problem for
  ~2 % of the cost. **It is also the only tier that is unambiguously worth building before the
  probes in §8 come back.**
- **Tier 1 — architecture ①, ~1 week** of focused work (relay route + worklet + state machine + UI +
  tests), assuming the §8.1 AEC probe comes back clean. Add ~2 days if it comes back dirty and the
  loopback trick is needed.
- **Tier 2 — architecture ②, +1 week** on top, and a permanent maintenance surface (two ONNX
  artefacts, browser WASM budget, endpointing quality is now ours).
- **Tier 3 — screen-off / always-listening: not a web feature.** R14 §5 already ruled this: it needs
  a Capacitor WebView + a mic foreground service, ≈1 week, and **Firefox cannot do it at all**. A
  live voice mode should be scoped as *screen-on, app-foreground, Wake Lock held* — i.e. the
  "docked on a stand" tier — and say so in the design.
- **The cost nobody budgets:** §4.4. Making the model's memory match what the user *heard* touches
  the turn's terminal persistence, and R35 flagged the same seam from the text side. It should be
  designed once, for both.

### 9.5 Where this would live

There is no ROADMAP entry. The natural placement is a **new §C4 beside C2 (wake word) and C3
(chunked TTS)** — all three are the same subsystem, and C3 is a hard prerequisite for any of this
(a live mode with whole-reply buffered TTS is not a live mode). A D-entry would be needed for the
first WebSocket in the codebase, since "SSE down, HTTP up" is currently an implicit architectural
invariant rather than a recorded decision.

---

## Primary sources

- nengoxx/RealtimeVoiceChat `64dc0d8`; KoljaB/RealtimeVoiceChat `9de323f` — `code/server.py`,
  `code/audio_in.py`, `code/transcribe.py`, `code/turndetect.py`, `code/speech_pipeline_manager.py`,
  `code/text_context.py`, `code/audio_module.py`, `code/upsample_overlap.py`,
  `code/static/{app.js,pcmWorkletProcessor.js,ttsPlaybackProcessor.js}`, `README.md`,
  `docker-compose.yml`, `requirements.txt`
- KoljaB/RealtimeSTT `7a0b476` — `RealtimeSTT/core/voice_activity.py`, `RealtimeSTT/audio_recorder.py`,
  `RealtimeSTT_server/PRODUCTION_SERVER.md`, `README.md`
- pipecat-ai/pipecat `6f3914f` — `src/pipecat/audio/vad/vad_analyzer.py`,
  `src/pipecat/audio/turn/{base_turn_analyzer.py,smart_turn/base_smart_turn.py,smart_turn/local_smart_turn_v3.py}`,
  `src/pipecat/turns/{user_turn_strategies.py,user_start/min_words_user_turn_start_strategy.py}`
- livekit/agents `89c7104` — `livekit-agents/livekit/agents/voice/turn.py`,
  `livekit-agents/livekit/agents/voice/agent_activity.py`
- speaches-ai/speaches `993994f` — `src/speaches/realtime/{session.py,input_audio_buffer.py,
  input_audio_buffer_event_router.py,response_event_router.py,conversation_event_router.py}`,
  `src/speaches/routers/{realtime_ws.py,realtime_rtc.py}`; live `GET /openapi.json` on emma
- danny-avila/LibreChat `b4593f8` — `client/src/hooks/Input/{useSpeechToTextBrowser.ts,useSpeechToTextExternal.ts}`
- Mintplex-Labs/anything-llm `c8bd644` — `frontend/src/components/WorkspaceChat/ChatContainer/PromptInput/SpeechToText/{BrowserNative,ServerSTT}/index.jsx`
- MDN — `MediaTrackConstraints.echoCancellation`, `MediaRecorder.start()`;
  W3C `mediacapture-streams` §echoCancellation
- OpenAI — `developers.openai.com/api/docs/guides/realtime` (transports),
  `…/guides/realtime-vad` (`server_vad` / `semantic_vad`, `eagerness`, `create_response`,
  `interrupt_response`)
- Secondary (REPORTED) on Chromium AEC reference scope: discuss-webrtc threads, a public-webrtc-logs
  W3C issue thread, and a write-up documenting the loopback-`RTCPeerConnection` workaround
- Owned dossiers cited rather than re-derived: R14 §3–§4, R48 §1/§2.2/§3, R50
