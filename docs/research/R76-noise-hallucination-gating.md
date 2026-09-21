# R76 — Stopping noise-triggered finals from becoming committed user turns

**Date:** 2026-09-21
**Status:** Draft dossier — complete for the bounded question. Nothing is built; not a decision.
**What drove it:** today's owner phone round on the live call (D71 / Phase 24). With
`server_vad {threshold: 0.9, prefix_padding_ms: 0, silence_duration_ms: 700}`, background sound still
produced finals — "Yeah.", "Okay" — and the call committed them as real user turns. There is no gate
today between a server final and turn submission: `useLiveCall`'s `final` arm drops a final only when
it is **empty**, **muted** or **ear-held**.
**Drove:** (open) — the S4 calibration round's knob list, and whatever gate the owner rules for it.

**Reference class.** First-party first (our own ear, read at source and probed live on emma today),
then the live-voice framework class the earlier passes already established — **livekit/agents ·
pipecat · RealtimeSTT · open-webui's call mode** — plus the OpenAI realtime protocol as the
specification prior art and the Whisper-hallucination literature for the denylist question.

**Confidence markers:** **[V] VERIFIED** = source read at a pinned ref, or probed by me on emma today.
**[R] REPORTED** = secondary source. **[U] UNVERIFIED** = expected, not checked.

---

> ### Headline — five findings, four of them measured today
>
> **① The brief's premise is wrong in one load-bearing place: our live ear is NOT faster-whisper.**
> [V] `voice.stt.model = istupakov/parakeet-tdt-0.6b-v3-onnx` and `voice.live` inherits it (blank
> provider → resolve like stt). Every faster-whisper hallucination knob — `no_speech_threshold`,
> `log_prob_threshold`, `condition_on_previous_text`, `hallucination_silence_threshold` — is
> **inapplicable to the executor that serves our calls**, which ignores `prompt`, `temperature` and
> `hotwords` by design (`executors/parakeet.py:141`, the TODO says so out loud). The same line means
> our configured `stt.hotwords` ("corsair vault emma …") has been **inert** on this ear all along —
> which is exactly R70 §1.3's unexplained "corsair" → "Course air".
>
> **② The server-side knob inventory is CLOSED, and we are already at the end of it.** [V, source]
> `TurnDetection` has exactly five fields (`type`, `threshold`, `prefix_padding_ms`,
> `silence_duration_ms`, `create_response`) and `InputAudioTranscription` exactly two (`model`,
> `language`). Extra keys are silently ignored by pydantic; `prefix_padding_ms` is explicitly
> **excluded from the applied update** anyway. There is no min-speech-duration, no noise reduction,
> no eagerness, no confidence, and no server env var that changes any of it.
>
> **③ Nothing anywhere in the chain can hand the relay a confidence number.** [V, source + probe]
> The realtime transcriber calls its own HTTP door with `response_format="text"`
> (`realtime/input_audio_buffer.py:157`) — hard-coded. Parakeet produces no scores at all
> (`{"text":"…","logprobs":null,"usage":null}` on every probe today). Even switching the live model to
> faster-whisper would not help: speaches drives `BatchedInferencePipeline`, whose `no_speech_prob` /
> `avg_logprob` only surface through `verbose_json` — which the realtime path never requests — and
> which **never applies `no_speech_threshold` at all** (the skip lives only in the sequential path;
> the batched constructor hard-codes `hallucination_silence_threshold=None`,
> `condition_on_previous_text=False`). Confidence gating is a two-layer fork change, not a knob.
>
> **④ At threshold 0.9 the thing that gets through is SPEECH-LIKE AUDIO, not "noise" — and Silero is
> nearly level-invariant.** [V, probed on emma today] Broadband noise, clatter bursts and a 1 kHz tone
> never reach 0.9 (max 0.21, 0.11, 0.01). Real speech **scaled down to RMS 0.003** — about −50 dBFS,
> five times *below* our 0.01 default floor — still peaks at **0.954** and still transcribes
> perfectly ("Hello, world."). So a distant TV or a next-room conversation passes both gates cleanly,
> and **the one server knob we have is out of headroom**: 0.9 → 0.95 starts costing quiet real speech
> before it costs the interferer.
>
> **⑤ The failure class reproduces, and it is a CONTENT hallucination, not a stock phrase.** [V,
> probed] Reversed speech (speech-like, no words) through the live door returns **"Flora Wallace"** —
> short, confident, wrong. Pure noise returns `""`, which our client already drops. A Whisper-style
> phrase denylist would therefore not have caught today's finals even in principle, while it *would*
> eat the owner's legitimate one-word answers. **No project in the reference class ships one**
> (livekit, pipecat, RealtimeSTT, open-webui: all grepped, all negative).

---

## 0. Sources, pinned

| Source | Ref / version | Read |
|---|---|---|
| **speaches — the owner's fork, the one emma serves** `~/github/speaches` | `fdc6a27` (HEAD, committed **today 12:50**; upstream base `993994f`, 2026-04-17). Local commits: `a95929a` aliases · `e093d8b` "skip Parakeet when VAD finds no speech" · `fdc6a27` "transcribe Parakeet VAD segments sequentially" | 2026-09-21 |
| **the RUNNING service** | pid 459763, `speaches.service` (user unit), started **12:50:19 today** ⇒ the running binary **is** `fdc6a27` | 2026-09-21 |
| **faster-whisper** (in the speaches venv) | `1.1.1` — `transcribe.py` | 2026-09-21 |
| **onnx-asr** (the Parakeet runtime) | `0.7.0` | 2026-09-21 |
| **livekit/agents** | `c0a8f4467f3cc48298a8fb0c05aca7744be56579` (HEAD, 2026-09-21) — `voice/turn.py`, `voice/agent_activity.py`, `voice/audio_recognition.py`, `livekit-plugins-silero/vad.py` | 2026-09-21 |
| **pipecat-ai/pipecat** | `06cc27c0754561530f1e3c73d01768f74c1ea206` (HEAD, 2026-09-21) — `audio/vad/vad_analyzer.py`, `audio/volume.py`, `audio/utils.py`, `turns/user_start/*`, `services/whisper/stt.py` | 2026-09-21 |
| **KoljaB/RealtimeSTT** | `777727553eedfa19aead15337ce66bab549add3f` (HEAD, 2026-09-17) — `audio_recorder.py`, `core/voice_activity.py` | 2026-09-21 |
| **open-webui** | `0a7c15832fb30b1903753e83f81dc7d27e5b0944` (HEAD, 2026-09-05) — `chat/MessageInput/CallOverlay.svelte`, `backend/open_webui/routers/audio.py` | 2026-09-21 |
| **OpenAI Realtime docs** | `developers.openai.com/api/reference/resources/realtime/client-events` + `…/api/docs/guides/realtime-vad` | 2026-09-21 |
| **Barański et al., "Investigation of Whisper ASR Hallucinations Induced by Non-Speech Audio"** | arXiv 2501.11378, IEEE ICASSP 2025 (abstract read; details [R]) | 2026-09-21 |
| **ctrl-b** | working tree at `14c93ab` — `services/voice_live.py`, `config.py` (`LiveCfg`/`SttServiceCfg`), `hooks/useLiveCall.ts`, `lib/pcmWorklet.ts`, `lib/pcmCapture.ts` | 2026-09-21 |
| Already bought, not re-derived | [R70](./R70-phrase-streaming-dictation.md) §1 (the 3 s endpoint law, the commit trap, the flush), [R68](./R68-live-voice-deltas.md) §1, [R51](./R51-realtime-voice-chat.md) §5 | — |

Probe scripts were throwaway (`~/.cache/tmp/r76/`, since `/tmp` is RAM): a Silero probability sweep
run in-process against speaches' own module, and eight one-shot POSTs to the already-running server
using the already-resident model. Read-only; no secret printed or written; the owner's call had ended
two minutes before the first POST.

---

## 1. What the server actually exposes — the closed inventory [V, source]

### 1.1 The realtime session: five fields plus two

`src/speaches/types/realtime.py:250`:

```python
class TurnDetection(BaseModel):
    create_response: bool
    prefix_padding_ms: int
    silence_duration_ms: int
    threshold: float = Field(..., ge=0.0, le=1.0)
    type: Literal["server_vad"] = "server_vad"

class InputAudioTranscription(BaseModel):
    model: str
    language: str | None = None
```

That is the whole surface. Consequences, each verified:

* **No `min_speech_duration`, no `max_speech_duration`, no `eagerness`, no `semantic_vad`, no
  `input_audio_noise_reduction`, no `include`.** `Session` is a plain pydantic `BaseModel`, so an
  extra key is **silently ignored** — a smuggled `min_speech_duration_ms` would neither error nor
  apply.
* **All five `turn_detection` fields are required**, so a partial object fails validation and falls
  back to `NotGiven` — R70/§7-S0's "send all five" pin, re-confirmed at this SHA.
* **`prefix_padding_ms` never applies**: `session_event_router.py:39-58` both emits the "not
  supported" error *and* excludes the key from the merged update. Our relay sends 0; the session
  default is 0; the value is a no-op either way.
* Session defaults (`realtime/session.py:62`): `threshold=0.9`, `prefix_padding_ms=0`,
  `silence_duration_ms=550`, `create_response = intent != "transcription"`.
* **No server env var touches any of this.** `Config` (`src/speaches/config.py`) exposes model TTLs,
  `api_key`, `log_level`, host/port, `allow_origins`, `enable_ui`, whisper device settings,
  `loopback_host_url`, chat-completion base URL and ORT options — nothing else. The one
  hallucination-shaped field, `_unstable_vad_filter` (line 103, documented as *"Useful for removing
  hallucinations in speech recognition caused by background silences"*), is **dead code**: grep finds
  no reader anywhere in `src/`, and the leading underscore makes it a pydantic private attribute.

### 1.2 What the Silero wrapper does at `threshold=0.9`

`executors/silero_vad_v5.py` (adapted from `faster_whisper.vad`):

```python
class VadOptions(BaseModel):
    threshold: float = 0.5
    neg_threshold: float | None = None       # → max(threshold - 0.15, 0.01)
    min_speech_duration_ms: int = 0
    max_speech_duration_s: float = float("inf")
    min_silence_duration_ms: int = 2000
    speech_pad_ms: int = 400
...
    window_size_samples = 512                 # 32 ms at 16 kHz
```

* **The threshold is compared straight to the Silero probability**, per 512-sample (32 ms) window:
  `speech_prob >= threshold` starts a segment; the exit uses the hysteresis floor
  `neg_threshold = max(threshold − 0.15, 0.01)` — **0.75 at our 0.9**.
* **`min_speech_duration_ms` stays 0 in the realtime path.** `vad_detection_flow` constructs
  `VadOptions(threshold=…, min_silence_duration_ms=silence_duration_ms, speech_pad_ms=prefix_padding_ms)`
  and leaves the rest at defaults, so **one single 32 ms frame above 0.9 opens an utterance** and
  nothing anywhere enforces a minimum speech length. This is the knob the field uses for exactly our
  problem (§4) and the protocol cannot reach it.
* `silence_duration_ms` is *only* Silero's `min_silence_duration_ms` **inside the trailing 3 s
  window**; the stop still cannot fire before the buffer passes 3000 ms (R70 §1.1, re-read at this
  SHA — `MAX_VAD_WINDOW_SIZE_SAMPLES = 3000 * 16`).
* The VAD re-runs over the **last 3 s on every appended frame**, from a zeroed RNN state each time
  (`state = np.zeros(...)` in `SileroVADModel.__call__`). Measured in today's journal: *"VAD
  processing took 0.0063s for 3.00s audio"*, at 25–50 appends/s.
* **The event timestamps cannot be used to measure an utterance.** `speech_stopped` carries
  `audio_end_ms = buffer.duration_ms − prefix_padding_ms` — the *whole buffer*, not the speech end
  (the source's own `# TODO: not quite correct`). Because the stop waits for the 3 s floor, the
  `started → stopped` span is inflated toward ~3 s for every short utterance. **A "was that too short
  to be a turn?" test built on the server's events would be measuring the buffer, not the speech.**
  (Our relay forwards neither field today — `voice_live.py:689-694` sends bare `speech_started` /
  `speech_stopped`.)

### 1.3 What actually reaches Parakeet — and the two fork patches already in the path

On `speech_stopped` the server rotates the buffer and transcribes `data_w_vad_applied`
(`audio_start_ms … audio_end_ms`, i.e. including the trailing silence) through its **own HTTP door**:

```python
transcript = await self.transcription_client.create(
    file=file, model=self.session.input_audio_transcription.model,
    response_format="text",
    language=self.session.input_audio_transcription.language or omit)
```
`realtime/input_audio_buffer.py:154`. Four parameters. No temperature, no prompt, no hotwords, no
`timestamp_granularities`, no `stream` — and the format is **`text`**, which forecloses every
metadata-bearing response shape.

At that HTTP door (`routers/stt.py:120-175`) **Silero runs a second time, unconditionally**, with
hard-coded options:

```python
DEFAULT_VAD_OPTIONS = VadOptions(min_silence_duration_ms=160, max_speech_duration_s=30)
# ⇒ threshold 0.5, min_speech_duration_ms 0, speech_pad_ms 400
```

There is **no `vad_filter` form parameter any more** — ctrl-b's `stt.vad_filter: true` extra is
accepted by nothing and discarded by FastAPI. The accepted non-standard extras are `hotwords` and
`without_timestamps` only.

Then the owner's fork's two local patches:

* `e093d8b` (2026-09-06) — **if the second VAD pass finds no speech at all, skip the model and return
  `""`.** This is a real anti-hallucination guard and it works (§2.2: noise/hum/clatter all return
  `""`) — but it is a **0.5-threshold test applied to audio that already passed 0.9**, so for the
  call path it can essentially never fire. It protects the *whole-clip POST* door, not the ear.
* `fdc6a27` (2026-09-21, **today, and the running binary**) — transcribe each merged VAD segment
  separately and join the non-empty ones, instead of handing Parakeet the whole waveform. This
  removes the silence *between* segments from the model's input, which is the classic hallucination
  substrate. Whether the owner's round ran before or after the 12:50 restart is **not determined**
  (§7).

### 1.4 The confidence question, answered end to end

| Layer | Carries a confidence signal? |
|---|---|
| Parakeet executor (`onnx_asr`) | **No.** `recognize()` returns a string; `text`/`json` are the only formats it accepts; probed responses have `"logprobs": null`. |
| The realtime transcriber | **No** — asks for `response_format="text"`. |
| `conversation.item.input_audio_transcription.completed` | `transcript` + `usage.seconds` (the **buffer** duration, inflated by the 3 s rule) — nothing else. |
| OpenAI's protocol | Has it: `include: ["item.input_audio_transcription.logprobs"]` [V, docs]. **Speaches implements no `include` at all** (grep: zero hits in `realtime/`). |
| faster-whisper path (if we switched models) | `avg_logprob` / `no_speech_prob` exist but **only in `verbose_json`**, which the realtime door never asks for — and the batched pipeline never gates on them (§3). |

---

## 2. First-party probes, run on emma today [V]

### 2.1 Silero v5 probabilities, through speaches' own module

Per-32 ms-frame probabilities over 2 s signals (1.32 s for the speech sample, `audio.wav` from the
speaches tree), plus whether `get_speech_timestamps` yields a segment at **our** settings
(threshold 0.9 / min_silence 700 / pad 0) and at the **HTTP door's** (0.5 / 160 / 400). RMS is linear
over float samples in [−1, 1] — **the same quantity `pcmWorklet.ts` posts as `frame.rms`**, so these
numbers are directly comparable to `barge_threshold` / `stt.auto_stop_threshold` (default **0.01**).

| Signal | RMS | max P | frames ≥ 0.9 | segs @0.9 | segs @0.5 |
|---|---|---|---|---|---|
| digital silence | 0.000 | 0.012 | 0/63 | 0 | 0 |
| white noise | 0.005 | 0.041 | 0/63 | 0 | 0 |
| white noise | 0.020 | 0.049 | 0/63 | 0 | 0 |
| white noise | 0.050 | 0.028 | 0/63 | 0 | 0 |
| white noise (loud) | 0.150 | 0.212 | 0/63 | 0 | 0 |
| 1 kHz tone | 0.050 | 0.010 | 0/63 | 0 | 0 |
| 120 Hz hum | 0.050 | **0.586** | 0/63 | 0 | **1** |
| clatter bursts (impulses) | 0.077 | 0.112 | 0/63 | 0 | 0 |
| **speech, as recorded** | 0.164 | 0.999 | 30/42 | 1 | 1 |
| **speech, scaled to 0.050** | 0.050 | 0.999 | 31/42 | 1 | 1 |
| **speech, scaled to 0.020** | 0.020 | 0.995 | 28/42 | 1 | 1 |
| **speech, scaled to 0.008** | 0.008 | 0.981 | 26/42 | 1 | 1 |
| **speech, scaled to 0.003** | 0.003 | **0.954** | 22/42 | **1** | 1 |
| reversed speech (speech-like, no words) | 0.164 | **1.000** | 28/42 | **1** | 1 |
| 4-voice babble | 0.165 | 0.990 | 22/42 | 1 | 1 |
| 200 ms speech fragment | 0.182 | 0.996 | 5/7 | 1 | 1 |
| reversed speech, scaled to 0.003 | 0.003 | 0.820 | 0/42 | 0 | — |

**What this settles.**

1. **Silero at 0.9 is a speech-likeness test, not a loudness test.** Nothing broadband or tonal got
   through; everything speech-shaped did, down to −50 dBFS.
2. **The `threshold` knob is out of road.** Clean speech peaks at 0.999 but *quiet* speech peaks at
   0.954 — so 0.9 → 0.95 buys almost nothing against a speech-like interferer and starts costing real
   quiet turns. Raising it is not the fix.
3. **Energy separates our case only as a PROXIMITY proxy.** A far interferer measured at the phone
   (~0.003) and the owner's near-field voice (0.05–0.2 on the same scale) are 15–60× apart *in
   energy* while being equal *in speech-likeness*. That gap — not a noise/speech distinction — is what
   a client energy gate would be exploiting.

### 2.2 The live door, model resident (`POST /v1/audio/transcriptions`, parakeet, `response_format=json`)

| Clip | Duration | RMS | Returned |
|---|---|---|---|
| white noise | 2.0 s | 0.020 | `""` |
| 120 Hz hum | 2.0 s | 0.050 | `""` |
| clatter bursts | 2.0 s | 0.081 | `""` |
| 4-voice babble | 1.3 s | 0.165 | `""` |
| **reversed speech** | 1.3 s | 0.164 | **`"Flora Wallace"`** |
| speech, 200 ms fragment | 0.2 s | 0.182 | `"Hello."` |
| speech, 400 ms fragment | 0.4 s | 0.224 | `"Hello."` |
| speech, scaled to 0.003 | 1.3 s | 0.003 | `"Hello, world."` |
| speech, as recorded | 1.3 s | 0.164 | `"Hello, world."` |

Every response carried `"logprobs": null, "usage": null`.

**What this settles.** The empty-final path is healthy — genuine non-speech already comes back as
`""` and our reducer already discards it. The live failure is the **middle case**: speech-like audio
that is not the owner's words, which the ear transcribes into a short confident string. And the
string is *content* ("Flora Wallace"), not a Whisper stock phrase — see §5.

---

## 3. faster-whisper's hallucination knobs, verified — and why they are out of reach here

`faster_whisper==1.1.1`, `transcribe.py`, defaults on **both** `WhisperModel.transcribe` and
`BatchedInferencePipeline.transcribe`:

| Parameter | Default | Effect |
|---|---|---|
| `no_speech_threshold` | **0.6** | with `log_prob_threshold`, skips a segment whose `no_speech_prob` exceeds it |
| `log_prob_threshold` | **−1.0** | a high enough avg-logprob **overrides** the no-speech skip (`transcribe.py:1173-1190`) |
| `compression_ratio_threshold` | **2.4** | repetition/degeneracy guard (temperature fallback) |
| `condition_on_previous_text` | **True** (sequential) | the classic hallucination-loop amplifier |
| `prompt_reset_on_temperature` | 0.5 | |
| `hallucination_silence_threshold` | **None** (off) | skips silent stretches when word timestamps are on |
| `temperature` | `[0.0, 0.2, 0.4, 0.6, 0.8, 1.0]` | fallback ladder |
| `vad_filter` | `True` (batched) / `False` (sequential) | |

**Speaches drives the batched pipeline** (`executors/whisper.py:161`), and the batched path
overrides three of these in its own constructor — `hallucination_silence_threshold=None`,
`condition_on_previous_text=False`, `temperatures=temperature[:1]` (`transcribe.py:517-518, 499-502`)
— **and never runs the no-speech skip at all**: that block lives only in `generate_segments`, the
sequential path. The batched `forward()` emits every segment with its `no_speech_prob` attached and
drops nothing.

Speaches' own call passes `language`, `initial_prompt`, `word_timestamps`, `temperature`,
`vad_filter=False`, `clip_timestamps`, `hotwords`, `without_timestamps` — **no threshold parameters at
all**, so even the defaults that *would* apply are left to the library. Conclusion: **switching the
live ear to faster-whisper would buy no hallucination gating without a speaches patch**, and the
metadata that would justify a gate (`no_speech_prob`, `avg_logprob`) is confined to `verbose_json`,
which the realtime transcriber cannot request.

---

## 4. The field — how live-voice stacks actually keep noise out of a turn

### 4.1 pipecat `06cc27c` — the AND of model probability and measured loudness [V]

```python
VAD_CONFIDENCE = 0.7 ; VAD_START_SECS = 0.2 ; VAD_STOP_SECS = 0.2 ; VAD_MIN_VOLUME = 0.6
...
speaking = confidence >= self._params.confidence and volume >= self._params.min_volume
```
`audio/vad/vad_analyzer.py:24-27, 208-210`. The volume is **ITU-R BS.1770 integrated loudness over a
rolling 400 ms window**, normalised from −110…−10 LUFS onto 0…1 (`audio/volume.py`,
`audio/utils.py:163-187`), exponentially smoothed (α 0.2). `start_secs`/`stop_secs` are converted to a
**frame count** the state machine must accumulate before it leaves STARTING/STOPPING — a hangover on
both edges.

This is the strongest precedent for the option class the brief asks about: **the biggest open-source
voice-agent framework does not trust the VAD model alone; it requires the audio to be loud enough
too, by default.**

pipecat also makes *what starts a user turn* pluggable (`turns/user_start/`):
`VADUserTurnStartStrategy`, `TranscriptionUserTurnStartStrategy` (defaults are **both**, in that
order — `user_turn_strategies.py:42`), `MinWordsUserTurnStartStrategy(min_words=…)`,
`WakePhrase…`, and `KrispVivaIPUserTurnStartStrategy`, whose docstring names our exact symptom:

> *"uses Krisp's IP model to distinguish genuine user interruptions from backchannels (e.g. "uh-huh",
> "yeah") … Only when the IP model's probability exceeds the configured threshold [default 0.5] is
> `trigger_user_turn_started()` called."*

Its Whisper services filter on metadata rather than phrases (`services/whisper/stt.py`): keep a
segment only if `no_speech_prob < 0.4` (faster-whisper service) / `< 0.6` (MLX), and — a nice
artefact — drop any segment whose `compression_ratio == 0.5555555555555556`, a known hallucination
fingerprint.

### 4.2 livekit/agents `c0a8f44` — recover from the false turn rather than predict it [V]

Silero plugin defaults (`livekit-plugins-silero/vad.py:63-71`): `activation_threshold=0.5`,
`min_speech_duration=0.05`, `min_silence_duration=0.55`, `prefix_padding_duration=0.5`,
`deactivation_threshold = max(activation − 0.15, 0.01)` — **the same hysteresis formula as ours, but
at 0.5 with a 50 ms minimum speech duration**, which is the opposite trade to our 0.9-with-no-minimum.

Turn handling (`voice/turn.py:150-197`):

```python
_INTERRUPTION_DEFAULTS = {"enabled": True, "discard_audio_if_uninterruptible": True,
    "min_duration": 0.5, "min_words": 0, "resume_false_interruption": True,
    "false_interruption_timeout": 2.0, "backchannel_boundary": (1.0, 1.0)}
```

* `min_duration = 0.5 s` — VAD speech shorter than this never registers as an interruption
  (`agent_activity.py:2452`).
* `min_words` (default 0, i.e. off) gates interruption on the *transcript* word count
  (`agent_activity.py:2325-2334, 2665-2677`).
* `false_interruption_timeout = 2.0 s` + `resume_false_interruption = True`: if speech interrupted the
  agent and **no transcript follows within 2 s**, the interruption is classified false and the agent's
  speech resumes. There is also a `user_transcription_timeout` event for "VAD said speech, STT said
  nothing".
* `backchannel_boundary = (1.0, 1.0)`: overlapping speech classified as a backchannel by the adaptive
  detector is suppressed within 1 s of the start/end of an agent turn.

**Two negatives worth recording.** (a) livekit *carries* per-turn STT confidence
(`transcript_confidence`, averaged over the finals — `audio_recognition.py:1237, 1253-1256`) all the
way onto the `ChatMessage`, and **never thresholds it**; the only confidence thresholds in the tree
belong to the end-of-turn model. (b) its only transcript-side drop is
`if not transcript: return` (`audio_recognition.py:1214`) — the same empty test we already have.
Notably, for the realtime-model backchannel case it *does* drop the turn outright, with the comment:
*"an unjudged overlap commits: interrupting the agent is recoverable, discarding a real user turn is
not."*

### 4.3 RealtimeSTT `7777275` — two VADs in series, plus a minimum recording length [V]

Defaults (`audio_recorder.py:71-75`): `silero_sensitivity=0.4` (the comparison is
`vad_prob > (1 − sensitivity)`, i.e. **0.6**), `webrtc_sensitivity=3` (the most aggressive WebRTC
mode), `post_speech_silence_duration=0.6`, `min_length_of_recording=0.5`,
`min_gap_between_recordings=0`. The cheap WebRTC VAD gates, and only when it fires is Silero run as
*"the expensive confirmation pass"* (`core/voice_activity.py:233-247`). Nothing filters the
transcript text; the defence is entirely upstream of the model.

### 4.4 open-webui `0a7c158` — energy only, and two dumb guards at the submit [V]

Its call overlay does its own VAD in the browser: an `AnalyserNode` banded to
`minDecibels = −55 … maxDecibels = −30`, "sound" = any non-zero frequency bin in that band, a **2000 ms**
silence run ends the utterance, and muting/assistant-speaking is implemented by *deafening the
analyser* (`minDecibels = −1`). At the submit there are exactly two guards: skip if the blob is
`< 100` bytes, and submit only `if (res.text !== '')`. No confidence, no phrase list, no duration
rule. Its server-side STT does pass `vad_filter=WHISPER_VAD_FILTER` to faster-whisper.

### 4.5 The OpenAI realtime protocol — what the spec-setter offers for this exact problem [V, docs]

* `server_vad`: `threshold` (default **0.5**), `prefix_padding_ms` (**300**), `silence_duration_ms`
  (**500**), plus an optional `idle_timeout_ms`. On the threshold: *"A higher threshold will require
  louder audio to activate the model, and thus might perform better in noisy environments."*
* `semantic_vad`: no thresholds at all — a model decides whether the user is done, tuned by
  `eagerness: "low" | "medium" | "high" | "auto"` (*"low will wait longer for the user to continue
  speaking, high will respond more quickly; auto is the default and is equivalent to medium"*). It
  targets **premature endpointing**, not noise admission; it is not a noise gate.
* `input_audio_noise_reduction: {type: "near_field" | "far_field"}` — *"Noise reduction filters audio
  added to the input audio buffer **before it is sent to VAD and the model**. Filtering the audio can
  improve VAD and turn detection accuracy (**reducing false positives**) and model performance by
  improving perception of the input audio."* This is the platform's own answer to our symptom, and it
  is a **pre-VAD enhancement stage**, not a post-hoc filter. Speaches has no equivalent.
* `include: ["item.input_audio_transcription.logprobs"]` — the protocol's confidence channel, which
  speaches does not implement.

---

## 5. The phrase-denylist question, judged

**The literature is real but off-target for us.** Barański et al. (ICASSP 2025, arXiv 2501.11378)
build a **"Bag of Hallucinations"** for Whisper from non-speech audio and remove it by post-processing
transcripts; the widely-cited artefacts are "Thank you for watching", "Thanks for watching", "you",
"so" [R — search summary of the paper and of `sachaarbonel/whisper-hallucinations`, which publishes a
per-language blocklist and a filter function]. The reported construction filtered candidates by n-gram
log-probability (< −10) and occurrence count (> 4) on non-speech inferences [R].

**Against adopting one here, on our own evidence:**

1. **Our ear is not Whisper.** The reproduction (§2.2) returns *"Flora Wallace"* — a content
   hallucination with no stock-phrase character. A Whisper BoH would not contain it, and BoH is
   explicitly a *per-model, per-language* artefact.
2. **No peer in the class ships one.** Grepped at HEAD: livekit/agents (hits are TTS markup and eval
   prompts only), pipecat (one `compression_ratio` fingerprint, no phrase list), RealtimeSTT (only a
   test fixture), open-webui (nothing). The field's post-ASR filters are **metadata** filters.
3. **It collides with our own semantics.** "Yes", "no", "okay", "stop" are legitimate one-word turns
   in a call, and the confirm gate makes "yes" *load-bearing*. A denylist that removes "Yeah."/"Okay"
   removes the answer to "shall I reboot corsair?" as well, and it fails in the direction livekit's
   comment names: *discarding a real user turn is not recoverable.*

**Verdict: not a candidate.** The honest alternatives are (a) corroborate the final with a second
measurement the words themselves do not carry (energy/proximity, §6), or (b) refuse to let a *lone
short* final commit by itself without a second signal — a policy about turn shape, not about
vocabulary.

---

## 6. Energy corroboration as an option class — precedent and honest limits

**Precedent exists and is shipped:** pipecat's `min_volume=0.6` AND-gate (§4.1), open-webui's
−55 dBFS analyser band (§4.4), and our own `min_speech_ms`-over-floor accumulator already running in
`useLiveCall` for barge-in trigger A (`hooks/useLiveCall.ts:1183-1207`, floor =
`barge_threshold || stt.auto_stop_threshold`, counted on the worklet's own RMS, `knobs.min_speech_ms`
default 300 ms). ctrl-b therefore already owns every piece except the rule.

**What it can and cannot do, from §2.1's numbers:**

* It **can** reject a *far* interferer: a TV two metres away lands near 0.003 RMS at the phone while
  near-field speech lands at 0.05–0.2 — a 15–60× separation, and the default floor 0.01 sits inside
  the gap.
* It **cannot** reject a *near* interferer: another person at the phone, or our own TTS leaking into a
  track whose AEC does not remove it, is loud and speech-like, and passes any energy test the owner's
  own voice passes.
* It **will** reject a genuinely quiet turn: our ear happily transcribes speech at 0.003, so a
  whispered "yes" is exactly the thing an energy floor throws away. The floor is a **proximity**
  policy — worth stating in those words in Conf, not as "noise filtering".
* Its calibration is device-specific (phone AGC moves the whole scale), which is why the field ships
  it as a knob and why S4 is the place to set it.

---

## 7. What I could not determine

1. **What the owner's actual interferer was.** "Yeah."/"Okay" are equally consistent with (a) a
   distant TV/conversation, (b) the owner's own backchannel, and (c) **our own reply leaking back into
   the ear outside the hold window** — "Thank you." especially reads like the character. The gate that
   is right depends on which, and nothing in the logs records it: speaches never logs transcript text,
   and the relay logs none either.
2. **Whether the round ran on `fdc6a27`.** The service restarted at 12:50:19 today, the same minute as
   the commit; a round before that ran on `e093d8b`, whose Parakeet call still fed the whole
   silence-padded waveform to the model — a materially more hallucination-prone shape.
3. **What Silero actually scores for the owner's room**, on the owner's phone, through Chrome's AEC +
   noise suppression. My probes are synthetic signals and one studio-clean speech clip on emma's CPU;
   the phone's processed uplink is a different signal. The S4 round should log `frame.rms` percentiles
   and the per-utterance accrual, not guess them.
4. **Whether `onnx_asr` can expose any per-token score** for Parakeet TDT (`with_timestamps()` exists;
   scores were not investigated beyond confirming the speaches wrapper returns text only).
5. **Whether a pre-VAD noise-reduction stage would help us**, as OpenAI claims for theirs — we have no
   such model, and Chrome's own `noiseSuppression` is already on in our capture.
6. Whether upstream speaches has moved on any of this since `993994f` (2026-04-17) — the fork's base
   is five months old and only the local tree was read.

---

## 8. Implications for ctrl-b — ranked

*Evidence ages slowly, this section fast. Nothing here is decided.*

**Before any of it: settle §7 item 1.** One debug line on the relay or the client — per final, the
accrued ms above floor, the peak RMS in the window, and the text length — turns the next phone round
into evidence. Every option below is calibrated by those three numbers, and option ② is *free* if the
answer is "it was the reply".

### ① The energy-corroborated final — a client gate in `useLiveCall` **[recommended]**

**Mechanism.** Accrue `frame.rms >= floor` milliseconds across the utterance window (from
`speechStart`, with a small pre-roll to cover Silero's 96–184 ms detection lag — R70 §1.2), and in the
`final` arm discard the transcript when the accrual is below a knob (reuse `min_speech_ms`, 300 ms,
or add a sibling). **Where it lands:** `hooks/useLiveCall.ts` — the `final` reducer arm plus the
existing `onFrame` accumulator (which today only counts while `mouthLive`); nothing else moves. One
optional knob in `LiveCfg`, delivered by `GET /voice/status` like every other client knob.
**Why first:** it is the field's shipped pattern (pipecat's `confidence AND volume`), it reuses a
calibrated floor and an accumulator we already own, it costs no new subsystem and no server change,
and the `floor <= 0 ⇒ disarmed` precedent already in trigger A gives it an honest off-state.
**Cost, stated plainly:** it is a proximity rule; a whispered turn is lost, and a near interferer still
gets through. **Confidence:** mechanism **[V]**; efficacy against the owner's actual interferer
**[U]** until S4 measures it.

*Placement note.* The identical rule could live in the relay (`voice_live.py` sees the same PCM frames
and the same events, so the data is identical) and would then cover streaming dictation too. It is the
better home **only if** dictation needs the same gate; otherwise it adds relay state to solve a
problem the client is already holding the numbers for, and the call's `final` arm is where "does this
become a turn" is already decided.

### ② Widen the ear-hold rather than gate the final — *if* §7 item 1 says "the reply leaked"

**Mechanism.** The reducer already drops finals flat while `earHeld` (S3). If the leak is happening in
the tail after playback ends, the fix is a hold tail (hundreds of ms after the mouth stops), not a new
gate — the same shape as livekit's `backchannel_boundary = (1.0, 1.0)`, which suppresses exactly the
speech that overlaps the start/end of an agent turn. **Where it lands:** the existing hold
choreography in `useLiveCall` + `pcmCapture.setHeld`. **Why second:** it is the cheapest possible
change and it is *diagnostic-dependent* — worthless if the interferer is the room, decisive if it is
us. **Confidence:** mechanism **[V]** (the hold exists and already drops finals); applicability
**[U]**.

### ③ A lone-short-final policy in the drain — "one word alone does not open a turn"

**Mechanism.** A final that is short (one or two words) and arrives with nothing pending does not
drain immediately: it waits a bounded window for a continuation, and commits only if corroborated —
by ① 's energy accrual, by a second utterance joining the queue, or by there being an open confirm
gate (where a lone "yes" is exactly what we are waiting for). **Where it lands:** the `final`/`drain`
arms of `useLiveCall`'s reducer, which already queue and join pending utterances with `PENDING_JOIN`.
**Field backing:** livekit's `min_interruption_words` + `false_interruption_timeout` (2 s) +
backchannel suppression; pipecat's `MinWordsUserTurnStartStrategy` and the Krisp IP strategy, whose
whole purpose is suppressing "yeah"/"uh-huh". **Why third:** it is a real behaviour change to turn
semantics, it adds latency to legitimate short answers, and it is the option most likely to need its
own review round. It is also the only one that would survive a *near* interferer.

### Recorded and NOT recommended

* **Server-side knobs: exhausted.** `threshold` is already 0.9 with ≈0.05 of usable headroom (quiet
  speech peaks at 0.954); `silence_duration_ms` governs endpointing, not admission;
  `prefix_padding_ms` is discarded by the server; no other field exists. **[V]**
* **A phrase denylist: rejected** (§5) — wrong model, no peer precedent, and it eats "yes".
* **Confidence gating: unreachable without a fork** — two layers would have to change (`include`
  support in the realtime session *and* an executor that produces scores). If it ever becomes
  reachable, pipecat's published thresholds are the starting numbers: `no_speech_prob < 0.4`. **[V]**
* **A speaches fork patch: last resort, with its trigger recorded.** The fork already exists and
  already carries two local patches, so the *cost* is low — but the *payoff* is low too. The one-line
  patch (`min_speech_duration_ms` into `vad_detection_flow`'s `VadOptions`) suppresses sub-threshold
  transients, and §2.1 shows our 0.9 gate already rejects those. **Trigger to revisit:** the S4 log
  shows utterances that open on a *brief* burst (< ~200 ms of speech-like audio) on the owner's phone
  — then the patch is the right tool and the client gate is not. A second candidate, if the whole-clip
  POST door ever starts hallucinating, is raising `routers/stt.py`'s hard-coded
  `DEFAULT_VAD_OPTIONS.threshold` above 0.5 — but that is server-wide and affects every door.

---

## Primary sources

- speaches (owner's fork) `fdc6a27` — `src/speaches/types/realtime.py:250-261` ·
  `realtime/session.py:58-68` · `realtime/session_event_router.py:39-58` ·
  `realtime/input_audio_buffer_event_router.py:48-98` · `realtime/input_audio_buffer.py:34-36,152-172` ·
  `executors/silero_vad_v5.py:36-65,217-296` · `executors/parakeet.py:125-152` ·
  `executors/whisper.py:143-215,270-300` · `routers/stt.py:48,120-175` · `config.py:41-125`
- faster-whisper `1.1.1` — `transcribe.py:276-295` (batched defaults), `:489-518` (batched overrides),
  `:726-745` (sequential defaults), `:1173-1190` (the no-speech skip, sequential only)
- livekit/agents `c0a8f44` — `voice/turn.py:150-197` · `voice/agent_activity.py:2310-2345,2650-2695` ·
  `voice/audio_recognition.py:1206-1260` · `livekit-plugins-silero/vad.py:63-138`
- pipecat `06cc27c` — `audio/vad/vad_analyzer.py:24-27,150-215` · `audio/volume.py` ·
  `audio/utils.py:163-187` · `turns/user_start/{vad,transcription,min_words,krisp_viva_ip}_*.py` ·
  `turns/user_turn_strategies.py:29-45` · `services/whisper/stt.py:283,440-447,516,598-607`
- RealtimeSTT `7777275` — `audio_recorder.py:71-75,136-190` · `core/voice_activity.py:111-250`
- open-webui `0a7c158` — `src/lib/components/chat/MessageInput/CallOverlay.svelte:154-183,290-380` ·
  `backend/open_webui/routers/audio.py:630`
- OpenAI Realtime API reference — session `turn_detection` (server_vad defaults 0.5 / 300 ms / 500 ms;
  `semantic_vad` eagerness), `input_audio_noise_reduction` (`near_field`/`far_field`),
  `include: ["item.input_audio_transcription.logprobs"]`; VAD guide
- Barański, Jasiński, Bartolewska, Kacprzak, Witkowski, Kowalczyk — *Investigation of Whisper ASR
  Hallucinations Induced by Non-Speech Audio*, arXiv:2501.11378, IEEE ICASSP 2025
- ctrl-b `14c93ab` — `backend/app/services/voice_live.py:428-441,686-707` ·
  `backend/app/config.py:601-636,639-787` · `frontend/src/hooks/useLiveCall.ts:552-592,1183-1207` ·
  `frontend/src/lib/pcmWorklet.ts:60-73` · `frontend/src/lib/pcmCapture.ts:170-185`
