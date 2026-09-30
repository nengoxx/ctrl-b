# ctrl-b Live Voice Hallucination Audit

**Date:** 2026-09-28  
**Repository:** `nengoxx/ctrl-b`  
**Audited revision:** `main` @ `778b9608915af82fe8002132cfe17386c9a8cea1`  
**Mode:** read-only static audit + external source comparison  
**Primary symptom:** false short user transcriptions during live calls, typically words/backchannels such as “Yeah”, “Mm-hmm”, “Uh-huh”, “Okay”, including in a very quiet electric car  
**Primary STT:** Parakeet TDT through Speaches  
**Audience:** coding agent responsible for ctrl-b / the local Speaches fork

---

## 1. Executive verdict

### Bottom line

The most strongly supported root cause is **not the ctrl-b PCM/WebSocket transport and not Parakeet in isolation**.

The strongest architectural defect is the realtime VAD implementation currently inherited from Speaches:

1. incoming audio is appended continuously;
2. on every append, Speaches takes only the **last 3 seconds**;
3. it calls a **batch** Silero `get_speech_timestamps()` pass on that window;
4. the Silero model state is rebuilt from zero for every call;
5. realtime speech start/stop is inferred by comparing the latest batch result with a small external `vad_state`.

That is materially different from a true streaming VAD. A transient can appear speech-like on one re-evaluation and disappear on the next, producing extremely short `speech_started → speech_stopped` events. Those events then cause a chunk to be transcribed, and Parakeet can map structured/speech-like garbage to a short, linguistically plausible word such as “Yeah”, “Mm”, or “Okay”.

ctrl-b already contains a **good defensive patch** for one part of this failure: the relay drops a segment when its relay-clock VAD span is `< silence_ms / 2` (default `<350 ms`) unless Speaches' audio clock proves a real stop. Project evidence says this catches the large cluster of observed 30–201 ms “flaps”.

However, this **does not explain or eliminate every hallucination**. The project’s own car evidence also contains short transcriptions on long VAD spans (roughly 2.5–3.2 seconds). Therefore the next field reproduction in the quiet electric car must determine whether the current symptom is:

- **Class A — short VAD flap**, which current `main` should mostly suppress;
- **Class B — long VAD segment containing structured noise / processing artefact**, which the gap cut intentionally allows;
- **Class C — leaked assistant speech / delayed car playback**, handled by the tail/echo protections rather than the noise gate;
- **Class D — actual low-level/far speech**, which Silero correctly classifies as speech but should be rejected by the proximity/energy policy;
- **Class E — a slicing problem around Parakeet**, especially padding/trailing silence or fragments.

The permanent architectural fix is to **stop using repeated zero-state 3-second batch VAD passes as a realtime speech detector**. Replace that mechanism with one persistent streaming VAD state per live audio session, plus explicit speech-onset debounce / minimum sustained speech and retained pre-roll.

### Confidence summary

| Finding | Confidence | Importance |
|---|---:|---:|
| ctrl-b PCM framing/resampling is not an obvious source of corruption | High | High |
| Speaches realtime VAD is a repeated 3-second batch rescan, not true persistent streaming VAD | Verified | Critical |
| The rescan architecture can create short start/stop flaps and is the best-supported cause of the observed short hallucinations | High | Critical |
| Current relay `< silence_ms/2` cut correctly mitigates the measured short-flap class | Verified | High |
| The gap cut cannot catch long-segment “Yeah/Mm-hmm” false finals | Verified by design and project evidence | High |
| The Sensitivity/dB slider is not “too low” simply because voice is around −20/−21 dBFS while the floor is around −40 dBFS | Verified | High |
| Current call diagnostics omit actual NS/AGC readback even though route-dependent browser processing matters | Verified | Medium/High |
| Current RMS includes DC offset | Verified | Low/Medium |
| An absolute dBFS threshold, word blacklist, or simply raising Silero threshold is a sound primary fix | No — contradicted by evidence/precedent | High |

---

# 2. Scope and limitations

## Audited ctrl-b code

The review traced the live call path across:

- `frontend/src/lib/pcmCapture.ts`
- `frontend/src/lib/pcmWorklet.ts`
- `frontend/src/lib/levelGate.ts`
- `frontend/src/hooks/useLiveCall.ts`
- `frontend/src/lib/liveSocket.ts`
- `frontend/src/theme-engine/kit/CallOverlay.tsx`
- `backend/app/services/voice_live.py`
- `backend/app/core/audio.py`
- `backend/app/api/voice.py`
- `backend/app/config.py`
- `frontend/tests/lib/levelGate.test.ts`
- `frontend/tests/hooks/useLiveCallWiring.test.ts`
- `backend/tests/test_voice_live_s1.py`
- relevant project research documents, particularly R76, R82–R85, R86/R88, R91–R93.

## Audited Speaches code

The public `nengoxx/speaches` tree was inspected at source, especially:

- `src/speaches/realtime/input_audio_buffer_event_router.py`
- `src/speaches/realtime/input_audio_buffer.py`
- `src/speaches/realtime/session.py`
- `src/speaches/executors/silero_vad_v5.py`
- `src/speaches/executors/parakeet.py`

### Important limitation

ctrl-b's own documents state that production uses an **additional local Speaches fork** with commits not necessarily present in the public GitHub branch, including patches such as prefix padding and a no-speech guard before Parakeet.

Therefore:

> The public `nengoxx/speaches` source is enough to verify the underlying 3-second rescan architecture, but it must **not** be treated as byte-identical to the production local Speaches tree.

The coding agent should re-run the source checks in §12 against the actual local Speaches checkout before editing it.

## Runtime limitation

This audit did not have direct access to:

- the newest quiet-electric-car call trail;
- its raw microphone PCM;
- per-frame Silero probabilities;
- the local production Speaches working tree.

So the architecture-level diagnosis is strong, but attributing the **newest** quiet-EV false “yes/uh-huh” to one exact segment class requires one instrumented reproduction.

---

# 3. Current audio path

The audited path is:

```text
Android/Browser microphone
        │
        ▼
getUserMedia()
  echoCancellation = route-dependent
  noiseSuppression = true
  channelCount = 1
  autoGainControl = browser default
        │
        ▼
AudioContext / AudioWorklet
  Float32 mono
  frame_ms = 40 ms default
  RMS computed
  PCM16 LE produced
        │
        ▼
ctrl-b WebSocket
  binary PCM16 frames
  actual AudioContext sample rate declared
        │
        ▼
backend LiveRelaySession
  bounded/paced queue
  stateful PCM16 resampling
  source rate → 24 kHz
        │
        ▼
Speaches realtime WebSocket
  base64 PCM16 @ 24 kHz
        │
        ▼
Speaches converts 24 kHz → 16 kHz
        │
        ▼
Speaches realtime VAD
  take only last 3 s
  run batch get_speech_timestamps()
  fresh Silero model state
        │
        ├── speech_started
        ├── speech_stopped
        ▼
segment committed
        │
        ▼
HTTP transcription path / Parakeet
        │
        ▼
completed transcript
        │
        ▼
ctrl-b relay
  segment-ID ledger
  short-gap cut
        │
        ▼
browser
  relative energy/min_final gate
  echo/tail checks
        │
        ▼
agent turn
```

The suspicious boundary is overwhelmingly the **realtime VAD → segment commit** boundary, not PCM transport.

---

# 4. Transport audit

## 4.1 Worklet PCM encoding

`frontend/src/lib/pcmWorklet.ts`:

- consumes the actual `AudioContext` input samples;
- groups them into `frame_ms` frames;
- converts them to little-endian signed PCM16 with correct asymmetric full-scale handling;
- reports RMS from the same samples;
- transfers the ArrayBuffer instead of copying it.

The PCM mapping is conventional:

```ts
view.setInt16(
  i * 2,
  Math.round(c < 0 ? c * 32768 : c * 32767),
  true
)
```

Nothing here suggests byte order corruption, sign inversion, clipping by accident, stereo misinterpretation, or inconsistent framing.

### Finding

**No transport corruption bug found in worklet encoding.**

## 4.2 Sample-rate declaration

`PcmCapture.sampleRate` uses the actual `AudioContext.sampleRate`; the client declares that rate to the backend rather than pretending the browser captured at 24 kHz.

This is correct because Android/browser capture commonly runs at 44.1 or 48 kHz.

## 4.3 Backend resampling

`backend/app/core/audio.py::Pcm16Resampler` is a **stateful** stream resampler.

This is important. A naive implementation that independently resampled every 40 ms packet would create a phase discontinuity at every boundary. ctrl-b instead:

- carries the exact rational read position across calls;
- retains the previous frame's final sample;
- interpolates continuously across packet boundaries.

Its intended property is:

```text
feed(frame_a) + feed(frame_b) ≈ feed(frame_a + frame_b)
```

This is exactly the correct shape for streamed PCM.

### Finding

**No obvious frame-boundary resampling defect found.**

## 4.4 Backpressure

The relay owns a bounded queue, pacing, and overload/degraded signalling. It drops old audio rather than allowing an unlimited stale backlog.

An overloaded or frozen path can still lose audio, but it should be visible as degradation and does not naturally explain consistent tiny lexical hallucinations such as “Yeah”.

### Conclusion on transport

The transport is not perfect by metaphysical decree, but there is no code evidence that it is manufacturing the reported short phrases.

**Do not begin the fix by rewriting the WebSocket or replacing the resampler.**

That would be expensive movement with weak causal support.

---

# 5. The primary defect: batch VAD pretending to be streaming VAD

## 5.1 What Speaches currently does

In public Speaches:

```python
audio_window = input_audio_buffer.data[-MAX_VAD_WINDOW_SIZE_SAMPLES:]
```

where:

```python
MAX_VAD_WINDOW_SIZE_SAMPLES = 3000 * MS_SAMPLE_RATE
```

Then on every append:

```python
speech_timestamps = get_speech_timestamps(audio_window, ...)
```

This is a full batch analysis of up to the latest 3 seconds.

Inside the Silero implementation, each call constructs fresh recurrent state for the complete window. It does **not** preserve the model's state from the previous append.

This produces a system with two levels of state:

- a tiny external `vad_state.audio_start_ms/audio_end_ms`;
- a freshly reconstructed Silero inference state every time.

That is not equivalent to continuous streaming inference.

## 5.2 Why this matters

Imagine the latest 3 seconds contain a short structured transient.

At append N:

```text
[ room noise ... transient ... ]
                     ↑
batch VAD says speech
→ speech_started
```

At append N+1 the window has shifted slightly or contains a different amount of following context:

```text
[ room noise ... transient ... new noise ]
                     ↑
batch VAD now says no speech
→ speech_stopped
```

The server has now manufactured a “speech segment” out of an unstable reclassification.

The STT model does not know the segment was epistemically weak. It receives a committed audio slice and must decode something.

For speech-like garbage, short linguistic priors are exactly what one should expect: “Uh”, “Yeah”, “Mm”, “Okay”, etc.

## 5.3 Why a quiet electric car can still trigger it

A VAD does not measure “how loud the car is” in the simplistic sense.

Possible triggers remain even in a quiet cabin:

- HVAC/fan components;
- tyre/road texture;
- cabin resonances;
- turn indicators/clicks;
- bumps;
- microphone handling;
- browser noise-suppression artefacts;
- automatic gain behaviour;
- distant speech/radio;
- brief echo residue;
- low-frequency structured hum.

Silero is a speech classifier. It can be confident on low-level speech-like structure even when absolute RMS is modest.

This is why “quiet environment” does not falsify the VAD diagnosis.

---

# 6. Existing ctrl-b mitigation: good, but intentionally incomplete

ctrl-b now times every segment in the relay and applies:

```python
if relay_gap_ms < silence_ms / 2:
    # candidate flap
```

with an audio-clock veto:

```python
if audio_gap_ms >= silence_ms:
    # preserve it
```

At defaults:

```text
silence_ms = 700
short-gap boundary = 350 ms
```

The code sends a cut transcript as:

```json
{
  "type": "transcript",
  "text": "",
  "final": true,
  "reason": "short",
  "gap_ms": ...
}
```

The client disposes of that like any empty final.

Tests explicitly pin:

- 349 ms → cut;
- 350 ms → pass;
- 699 ms audio span → no veto;
- 700 ms audio span → veto;
- no relay start clock → fail open;
- a short “Mm-hmm.” segment becomes empty;
- a real “Turn off the lights.” segment survives.

This is a well-designed compatibility patch because it targets a distinctive Speaches rescan failure without blindly discarding every short spoken word.

## But it is not a permanent VAD

The project evidence also contains short transcripts whose start→stop span was approximately:

- “Yeah.” — 3.084 s
- “Okay, uh” — 3.158 s
- “Mm-hmm.” — 2.478 s

Those are far outside the short-gap filter.

Therefore:

> “We already added the 350 ms cut” is not sufficient proof that the new quiet-car hallucination cannot be VAD/STT related.

The next trace must classify it.

---

# 7. The dB / Sensitivity control is not the suspected bug

## 7.1 dBFS polarity

For dBFS:

```text
0 dBFS     = maximum digital level
−10 dBFS   = quieter
−20 dBFS   = quieter
−40 dBFS   = much quieter
−60 dBFS   = very quiet
```

Therefore a voice around:

```text
−20 / −21 dBFS
```

is **louder** than a gate at:

```text
−40 dBFS
```

A −40 dBFS floor does not exclude a −21 dBFS voice.

It admits it by ~19 dB.

## 7.2 Current automatic floor

The current gate essentially derives:

```text
floor =
  max(
    noise_floor + noise_margin,
    learned_voice_level - voice_margin
  )
```

then clamps it into:

```text
[min_dbfs, max_dbfs] = [−60, −20]
```

Defaults:

```text
noise_margin_db = 10
voice_margin_db = 10
```

Example:

```text
noise = −42
voice = −21

noise branch = −32
voice branch = −31

Auto floor = −31 dBFS
```

That is sensible.

## 7.3 Manual pin

The earlier car evidence showed a manual pin around −20 while learned voice was around −21. That is indeed bad: the floor can become stricter than the owner’s own speech.

Current code explicitly clamps the pin ceiling to prevent that class of mistake.

## Conclusion

The sensitivity mechanism is not obviously responsible for a false “Yeah” in a quiet car.

It is primarily a **proximity/energy corroborator**, not a speech-vs-noise classifier.

It cannot make Silero stop declaring a structured transient “speech”; it can only decide later whether enough of the segment was loud/near enough to accept.

---

# 8. A diagnostic gap: NS/AGC state is not fully recorded for calls

Current call capture explicitly asks:

```ts
echoCancellation: route === "call" ? { ideal: "all" } : false,
noiseSuppression: true,
channelCount: 1
```

It does **not** explicitly set `autoGainControl`.

Yet `MicReadback` only retains:

- echoCancellation;
- echoCapabilities;
- label;
- deviceId.

It does not retain:

- `getSettings().noiseSuppression`;
- `getSettings().autoGainControl`;
- resolved channel count;
- resolved sample rate.

Interestingly, dictation diagnostics already log NS/AGC.

This means a live-call trail cannot fully answer:

> “What exact browser preprocessing produced the audio that caused this hallucination?”

That should be fixed before another large tuning exercise.

### Recommended diagnostic addition

At capture open, log/read back:

```text
settings.echoCancellation
settings.noiseSuppression
settings.autoGainControl
settings.channelCount
settings.sampleRate
deviceId
label
route requested
route effective
AudioContext.sampleRate
```

Do not infer these values solely from Chromium source or requested constraints; log what the device actually granted.

---

# 9. RMS and DC offset

The current worklet computes:

```ts
sqrt(mean(sample²))
```

without subtracting the frame mean first.

So a DC offset contributes to the measured energy.

This is not currently the leading hallucination explanation, but it creates a discrepancy with some design/research language that discusses DC-removed level measurements.

### Recommendation

For diagnostics, calculate both:

```text
raw RMS
DC-removed RMS
```

for a field session.

If the difference is negligible on the affected phone/car, leave the transport untouched.

If meaningful, change the **gate statistic**, not necessarily the PCM sent to STT.

Do not introduce a heavy DSP chain before measurement.

---

# 10. Peer systems: what to copy and what not to copy

## 10.1 Pipecat — strong positive precedent

Current Pipecat VAD uses a state machine with:

```text
confidence threshold
AND
minimum volume
AND
start duration
AND
stop duration
```

Current defaults in the inspected source:

```text
confidence = 0.7
start_secs = 0.2
stop_secs = 0.2
min_volume = 0.6
```

Conceptually:

```python
speaking = confidence >= threshold and volume >= minimum

QUIET
  └── speaking → STARTING

STARTING
  ├── continued speaking long enough → SPEAKING
  └── one non-speech decision → QUIET

SPEAKING
  └── non-speech → STOPPING

STOPPING
  ├── sustained non-speech → QUIET
  └── speech returns → SPEAKING
```

This is exactly the class of mechanism missing in Speaches’ current realtime rescan.

Pipecat also preserves Silero model state across incoming frames.

### Lesson

**A VAD score should not become a user turn on its first positive frame.**

Use temporal state.

---

## 10.2 LiveKit — strong positive precedent

LiveKit’s Silero plugin is streaming and maintains per-stream state.

Published defaults include approximately:

```text
activation threshold: 0.5
minimum speech: 0.05 s
minimum silence: 0.55 s
prefix padding: 0.5 s
```

The exact defaults are less important than the architecture:

- one VAD stream owns its recurrent state;
- speech onset and speech end are stateful temporal decisions;
- prefix audio is retained rather than sacrificed to onset debounce.

### Lesson

If latency is a concern, onset debounce does not require losing the beginning of speech.

Use a ring buffer / pre-roll.

---

## 10.3 Vapi — product-level positive precedent

Vapi exposes a continuous-speech requirement (`voiceSeconds`) for interruption. Its documentation explicitly describes increasing that duration to reduce false triggers from background noise.

A common/recommended value is around 0.2 s.

### Lesson

A ~200 ms speech-onset confirmation period is not an exotic hack; it is a standard product control class.

For ctrl-b, it should probably be an internal calibrated default, not a prominent user-facing knob.

---

## 10.4 OpenWebUI — useful negative precedent

Current OpenWebUI call mode:

- uses `echoCancellation: true`;
- `noiseSuppression: true`;
- `autoGainControl: true`;
- analyser minimum around −55 dB;
- starts recording on the first detected frequency-bin activity;
- does **not** require sustained speech before triggering;
- ends after about 2 seconds of silence.

That is much simpler than ctrl-b.

It also has public user reports of background noise causing unwanted interruptions in voice mode.

### Lesson

Do **not** copy OpenWebUI’s detector as the noise-robustness fix.

Its implementation is useful mainly as evidence that an energy-ish first-frame trigger is not enough.

---

## 10.5 OpenAI Realtime — useful architectural reference

OpenAI’s documented server VAD defaults use concepts such as:

```text
threshold
prefix padding
silence duration
```

and newer transcription paths expose input noise reduction and optional transcription logprobs.

Semantic VAD/turn detection exists as a separate concern.

### Lesson

Keep these concerns separate:

1. **Is there speech?**
2. **Has speech genuinely begun?**
3. **Has the utterance ended?**
4. **Is the text semantically a complete turn?**

Semantic turn detection cannot repair garbage that was incorrectly admitted as speech in stage 1.

---

## 10.6 Deepgram Flux — later-stage precedent

Flux models semantic end-of-turn confidence and can emit tentative/confirmed turn completion.

Useful for future conversational smoothness.

Not a substitute for rejecting a cabin transient before STT.

---

# 11. Parakeet-specific conclusions

## 11.1 Do not blame it alone

Parakeet is being called after another system has already asserted:

> this slice deserves transcription.

ASR models are not generally no-speech classifiers.

A short ambiguous chunk can decode to a plausible short word.

The correct first question is therefore:

> Why was this audio committed for transcription?

not:

> Why did Parakeet fail to return an empty string?

## 11.2 Do not blacklist words

Never add:

```text
if transcript in {"yeah", "uh-huh", "okay", ...}: drop
```

It will eventually discard a genuine one-word answer, and the error will be conversationally catastrophic.

Project evidence already contains legitimate/plausibly legitimate short utterances.

Lexical filtering is the wrong layer.

## 11.3 Token/logprob gating is not a primary solution

The project’s existing synthetic experiments report overlap between confidence/logprob for:

- false filler-like decodes;
- genuine noisy short answers such as “No”.

That makes ASR confidence useful as **telemetry**, not a safe binary admission rule.

If the local `onnx-asr` version exposes logprobs, log them experimentally. Do not make them the first production filter.

## 11.4 Trailing silence is worth a separate fix

A recent NVIDIA Parakeet issue documents a case where adding only ~400 ms of trailing silence changes a correct decode into an empty one.

That is not the same failure as hallucinated “Yeah”, but it confirms that Parakeet output can be sensitive to the final slice boundaries/padding.

Recommended separate experiment:

```text
decode segment as currently sliced
decode active-speech-trimmed copy
compare
```

For an empty final, a trimmed retry may be useful.

It should not be confused with the noise-hallucination fix.

---

# 12. Recommended permanent architecture

## 12.1 Replace batch-rescan realtime VAD

The local Speaches fork should own one persistent VAD object per realtime input session.

At 16 kHz, process one standard Silero frame at a time (commonly 512 samples / 32 ms for the current models).

State should persist:

```text
Silero recurrent state
speech/not-speech state machine
onset duration
silence duration
pre-roll ring buffer
segment start sample
segment end sample
```

Pseudo-architecture:

```python
class StreamingVad:
    state = QUIET
    speech_run_ms = 0
    silence_run_ms = 0
    pre_roll = RingBuffer(300_ms)
    segment = []

    def push(frame):
        probability = silero_stream(frame)  # persistent recurrent state
        energy = energy_stat(frame)

        candidate = probability >= start_threshold

        if state == QUIET:
            pre_roll.push(frame)

            if candidate:
                speech_run_ms += frame_ms
            else:
                speech_run_ms = 0

            if speech_run_ms >= START_CONFIRM_MS:
                state = SPEAKING
                segment = pre_roll + recent_candidate_frames
                emit speech_started

        elif state == SPEAKING:
            segment.append(frame)

            if probability < end_threshold:
                silence_run_ms += frame_ms
            else:
                silence_run_ms = 0

            if silence_run_ms >= SILENCE_MS:
                emit speech_stopped
                transcribe(segment)
                reset_segment_only()
```

Important:

- do **not** reset the model on every packet;
- onset debounce and pre-roll must work together;
- end hysteresis should remain distinct from start threshold;
- preserving one short genuine “yes” is an explicit test.

---

# 13. What onset duration should be used?

Do not blindly hard-code a number from another product.

Use a small sweep against recorded test audio.

Reasonable experiment values:

```text
50 ms   — LiveKit-like aggressive/low-latency class
100 ms
150 ms
200 ms  — Pipecat/Vapi-like product class
250 ms  — Silero offline default minimum-speech class
300 ms
```

Test corpus must include:

### Genuine speech

- “yes”
- “no”
- “yeah”
- “mm-hmm”
- one clipped/quiet word
- normal sentence
- hesitant speech
- low-volume voice
- voice while driving

### Non-speech

- parked quiet EV
- EV while moving
- noisy combustion car
- HVAC only
- indicator click
- pothole/bump
- handling phone
- road rumble
- radio at low volume
- TTS echo tail
- silence
- door close
- cough

Score:

```text
false speech starts / minute
false committed finals / minute
real one-word recall
first-phoneme clipping rate
turn-start latency
turn-end latency
```

Choose the lowest onset duration that suppresses the noise class without harming genuine short answers.

My starting experiment would include **150, 200 and 250 ms**, with 200 ms the centre arm.

That is an experiment recommendation, not a claim that 200 ms is already proven optimal for this device.

---

# 14. Short-term patch if the streaming rewrite is delayed

The public Speaches `VadOptions` already contains:

```python
min_speech_duration_ms
```

and its current default is:

```text
0
```

The realtime caller does not override it.

Setting a non-zero value can reject some tiny batch-VAD speech fragments.

This is a legitimate short-term experiment.

However, it does **not** repair the underlying repeated-rescan state problem.

Because each 3-second window is independently reinterpreted, the same transient can still move around between “speech” and “not speech” as context shifts.

Recommended posture:

```text
Patching min_speech_duration_ms = useful stopgap
Persistent streaming VAD = actual architectural fix
```

Do not remove ctrl-b’s relay gap cut when adding the stopgap.

---

# 15. Layered admission policy

The strongest design is layered:

## Layer 1 — stateful VAD probability

“Does this frame look like speech?”

## Layer 2 — temporal onset confirmation

“Has it looked like speech continuously long enough to believe it?”

## Layer 3 — relative energy/proximity corroboration

“Was enough of the accepted segment plausibly near-field owner speech?”

ctrl-b already has useful machinery here:

```text
noise-relative floor
learned owner voice level
min_final_ms
per-item segment ledger
```

This should remain.

## Layer 4 — echo/tail protection

“Is this actually our own reply returning through the car?”

ctrl-b already has:

```text
ear hold
tail timing/chirp
text echo backstop
segment IDs
```

## Layer 5 — ASR

Only now ask Parakeet for text.

## Layer 6 — optional semantic endpointing

“Is the user actually finished?”

This is a future conversational-quality layer, not admission.

---

# 16. Important inefficiency in the current layering

Today, the browser’s relative-energy gate is largely a **post-ASR** decision.

So a noise segment may already:

1. trigger server VAD;
2. open speech state;
3. block mouth state;
4. be committed;
5. run Parakeet;
6. send a final;
7. then be rejected by the client energy gate.

That protects the conversation but still pays latency/compute and allows upstream state churn.

Long term, the best architecture moves enough admission evidence **before ASR invocation** to avoid transcribing obviously invalid segments.

The cleanest place is the VAD owner — the local Speaches fork — because that is where the segment exists before Parakeet.

Do not duplicate the whole client relative-floor algorithm on the server without evidence. A server-side onset debounce already removes the most pathological class.

---

# 17. Noise suppression and AGC

## 17.1 Noise suppression

ctrl-b already requests:

```text
noiseSuppression = true
```

Do not immediately add a second denoiser.

Denoisers can create artificial tonal/speech-like residue. For a VAD problem, “more denoising” is not automatically safer.

First run controlled arms:

```text
A: current NS on
B: NS off
```

in the quiet EV and noisy car.

Measure VAD starts/minute and accepted false finals.

## 17.2 AGC

Call capture leaves AGC to browser resolution.

That is acceptable only if its actual result is visible.

First change should be diagnostic:

```text
log getSettings().autoGainControl
```

Then decide whether explicit AGC true/false improves consistency.

Do not force AGC as a hallucination fix without data.

---

# 18. High-pass / spectral filtering

A modest voice-chain high-pass around the common telephony/WebRTC low-frequency region (~80–100 Hz) is defensible as an experiment against road rumble.

But:

- it is not yet proven necessary;
- it should not be the first change;
- 300–400 Hz would be aggressive and can damage low-pitched speech;
- a spectral filter does not replace VAD state/debounce.

Recommended order:

1. log band energies;
2. collect real car PCM;
3. simulate filters offline;
4. only then modify live audio.

---

# 19. Diagnostic changes recommended before the next car test

These are high-value and low behavioural risk.

## 19.1 Call capture readback

Add to the existing debug trail:

```json
{
  "mic": {
    "requested_route": "media",
    "echoCancellation": false,
    "noiseSuppression": true,
    "autoGainControl": false,
    "channelCount": 1,
    "trackSampleRate": 48000,
    "contextSampleRate": 48000,
    "deviceId": "...",
    "label": "..."
  }
}
```

Use actual `track.getSettings()` values.

## 19.2 VAD segment telemetry

The ideal local Speaches debug record per segment:

```json
{
  "segment_id": "...",
  "started_at_ms": 0,
  "confirmed_after_ms": 192,
  "speech_probability": {
    "max": 0.93,
    "mean": 0.71,
    "p10": 0.42,
    "p50": 0.77
  },
  "candidate_run_ms": 224,
  "silence_run_ms": 704,
  "raw_duration_ms": 1120,
  "active_duration_ms": 376
}
```

With the current batch engine, at least log the batch VAD result that caused each state transition.

## 19.3 Energy telemetry

Per segment:

```text
raw RMS p10/p50/p90/peak
DC-removed RMS p10/p50/p90/peak
noise floor
effective floor
ms above floor
learned voice level
```

## 19.4 Optional debug audio capture

For a local homelab deployment, the fastest truth source would be an **explicitly opt-in debug ring** that saves only short windows around:

- rejected segments;
- accepted segments;
- false final candidates.

Suggested constraints:

```text
OFF by default
debug-only
short capped WAVs
automatic retention
never uploaded externally
clear UI/config warning
```

Without audio, a “Yeah” final cannot always be distinguished from:

- real user speech;
- assistant echo;
- radio;
- transient;
- model hallucination.

A 2–5 second local WAV often settles that in one listen.

---

# 20. Acceptance test for the permanent VAD

The streaming-VAD change is not complete until it passes an adversarial suite.

## Required invariants

### VAD-1 — one transient is not speech

A single positive Silero frame must not create a committed user segment.

### VAD-2 — onset continuity

If speech evidence breaks before `start_confirm_ms`, onset accumulation resets.

### VAD-3 — pre-roll

A confirmed utterance contains the audio preceding confirmation so its first consonant is preserved.

### VAD-4 — short real answer

A genuine “yes” / “no” / “mm-hmm” survives.

### VAD-5 — model state persists

Successive frames use the same Silero recurrent state until the session resets.

### VAD-6 — end hysteresis

One low-probability frame inside speech does not terminate the utterance.

### VAD-7 — silence ends it

Sustained silence near current 700 ms ends it predictably.

### VAD-8 — no double commit

One speech interval produces one segment/commit.

### VAD-9 — no flap storm

Stationary car noise for 5 minutes stays below the accepted false-final budget.

### VAD-10 — existing ctrl-b relay protections remain compatible

`item_id`, prefix padding, gap cut, transcript gate, echo/tail logic all remain coherent during migration.

---

# 21. Suggested field success criteria

For a five-minute no-user-speech car recording:

```text
Accepted false user turns: 0
Parakeet calls caused by noise: ideally 0
Raw unconfirmed VAD candidates: allowed/logged
```

For 20 repetitions each of:

```text
yes
no
yeah
mm-hmm
okay
```

target:

```text
detection recall ≥ 95%
first-word clipping = 0
```

For normal utterances:

```text
no noticeable extra conversational lag beyond ~150–250 ms onset confirmation
```

That last number should be judged subjectively as well as measured.

---

# 22. Rollout sequence

## P0 — Instrumentation only

**ctrl-b**

- add call NS/AGC/channel/sample-rate readback;
- log raw + DC-removed RMS in debug;
- retain current gap cut;
- retain current relative gate;
- make no behavioural threshold change.

**local Speaches**

- log why each speech start/stop occurred;
- log batch VAD probabilities/summary if practical.

Then reproduce:

1. quiet parked EV;
2. moving EV;
3. noisy car;
4. quiet room;
5. deliberate one-word answers.

This classifies the current live bug.

---

## P1 — Stateful streaming VAD in local Speaches

Replace repeated 3-second batch inference with a persistent Silero stream.

Add:

```text
start confirmation
end hysteresis
pre-roll
per-session reset
```

Keep the relay gap cut as defense-in-depth.

---

## P1b — stopgap if P1 is too invasive

Before the full rewrite:

- set/test a non-zero `min_speech_duration_ms`;
- or debounce `speech_started` until sustained evidence is present;
- retain buffered pre-roll so real short speech is not clipped.

Do not pretend this closes the architecture debt.

---

## P2 — Tune with recorded real-world corpus

Sweep onset duration.

Do not tune against synthetic noise alone.

Pick values based on:

```text
false turns
short-answer recall
clipping
latency
```

---

## P3 — Parakeet slicing / empty-final robustness

Test:

- current padded segment;
- active-speech-trimmed segment;
- optional empty-final retry.

Keep this a separate ticket from false positive speech admission.

---

## P4 — optional future turn intelligence

Only after acoustic/VAD admission is reliable:

- semantic end-of-turn;
- tentative EOT;
- interruption predictor.

These can make conversation nicer but should not be recruited to clean up an unreliable microphone admission layer.

---

# 23. Changes I would NOT make

## Do not raise Silero threshold aggressively

Project calibration already found that higher thresholds hurt quiet/narrowband real speech, especially because end threshold follows start threshold.

A threshold increase does not solve speech-like interferers reliably.

## Do not use one absolute dBFS floor

Different microphones/routes/AGC states vary too much.

Keep the relative floor.

## Do not blacklist “Yeah”, “Uh-huh”, “Okay”, “No”

Those are valid answers.

## Do not make ASR logprob the sole gate

Real noisy short words can have weak confidence too.

## Do not replace the WebSocket transport first

The evidence does not point there.

## Do not copy OpenWebUI’s detector

Its source has no onset debounce and public noise-trigger complaints exist.

## Do not introduce a heavy denoiser before recording evidence

It may create a new class of VAD artefacts while obscuring the original one.

## Do not remove the relay gap cut immediately after adding streaming VAD

Keep it through the field-validation period. Delete/reduce it only after traces show it is redundant and it never saves a real regression.

---

# 24. Concrete implementation tickets for the coding agent

## Ticket A — call preprocessing readback

**Repo:** ctrl-b  
**Risk:** low  
**Behaviour:** diagnostic only

Modify `MicReadback` / capture construction to include actual:

```ts
noiseSuppression
autoGainControl
channelCount
sampleRate
```

Propagate to `CallDebug` / call trail.

Add unit tests for present/undefined browser values.

---

## Ticket B — DC-removed diagnostic level

**Repo:** ctrl-b  
**Risk:** low if debug-only

In the worklet or debug path, calculate frame mean and DC-removed RMS.

Do not change uplink samples initially.

Compare in real affected device traces.

---

## Ticket C — persistent streaming Silero

**Repo:** local Speaches fork  
**Risk:** medium/high  
**Value:** critical

Create a session-scoped streaming VAD instance.

Requirements:

```text
persistent recurrent state
one inference per new frame
onset debounce
silence debounce
prefix/pre-roll buffer
one segment ID per confirmed utterance
clean reset after stop
clean reset on session end
```

Do not run `get_speech_timestamps(last_3_seconds)` on every append as the primary realtime state machine.

---

## Ticket D — onset sweep

**Repo:** local Speaches + test harness  
**Risk:** low

Make start confirmation internally configurable for testing.

Arms:

```text
50
100
150
200
250
300 ms
```

Keep user UI unchanged until measured.

---

## Ticket E — retain relay safety net

**Repo:** ctrl-b  
**Risk:** none

Keep current `gap_cut_ms` behaviour during streaming-VAD rollout.

Add a debug counter:

```text
gap_cut_saved_segments
```

If it remains zero over substantial real use after P1, revisit removal later.

---

## Ticket F — real-noise fixture corpus

**Repo:** preferably test assets outside normal git history if privacy-sensitive

Capture labelled snippets from:

```text
quiet EV
moving EV
combustion car
room
HVAC
indicator
road bump
assistant echo
real short answers
```

Use them for deterministic regression tests.

If personal audio should not be committed, derive anonymised/noise-only fixtures or keep the corpus in a local test directory ignored by git.

---

# 25. How to diagnose the very next false “Yeah”

When it happens, collect:

```text
segment item_id
relay start→stop gap
Speaches audio start→end span
VAD probability/run data
actual NS/AGC settings
raw/DC-removed energy stats
noise floor
effective floor
ms above floor
mouthLive
earHeld
tailHeld
assistant spoken text
final transcript
short WAV around segment
```

Then classify:

### gap < 350 ms

Current relay filter failed or was bypassed. Investigate item ID, audio-veto condition, dictation-vs-call mode, or version mismatch.

### gap > 350 ms, energy below relative floor

Server VAD admitted structured noise; client should reject final. If it reaches agent, inspect segment ledger/fail-open path.

### gap > 350 ms, energy above floor, WAV is non-speech

Persistent VAD/onset debounce is the fix. This is the strongest quiet-car target class.

### WAV contains assistant voice

Echo/tail path, not ambient-noise VAD.

### WAV contains faint radio/other human

VAD is technically correct; proximity/owner discrimination is the relevant layer.

### WAV contains genuine user “yeah”

No hallucination. Look higher in conversation-state handling if application behavior was wrong.

---

# 26. Final recommendation

Treat this as a **speech-admission architecture problem**, not a magic threshold problem.

The desired final design is:

```text
browser capture
    ↓
optional browser preprocessing
    ↓
persistent streaming Silero
    ↓
sustained-onset confirmation
    ↓
pre-roll-preserved segment
    ↓
relative energy/proximity corroboration
    ↓
echo/tail protection
    ↓
Parakeet
    ↓
optional semantic turn logic
```

ctrl-b has already built surprisingly strong downstream safety machinery: segment IDs, a relative floor, per-segment energy, tail holding, echo checks, a relay flap filter, and useful tests.

The weak link is upstream:

> repeated zero-state batch VAD over a moving 3-second window is being asked to behave like a realtime state machine.

Fix that first.

---

# 27. Source notes

## Project code

- ctrl-b: https://github.com/nengoxx/ctrl-b
- audited ctrl-b commit: `778b9608915af82fe8002132cfe17386c9a8cea1`
- public Speaches fork: https://github.com/nengoxx/speaches

Primary project paths are listed in §2.

## External implementations / documentation

### Silero VAD

- Repository / implementation:
  https://github.com/snakers4/silero-vad

Relevant concepts:
- persistent `VADIterator`;
- offline `get_speech_timestamps`;
- minimum speech duration;
- minimum silence duration;
- threshold/hysteresis.

### Pipecat

- Repository:
  https://github.com/pipecat-ai/pipecat
- audited current source included:
  `src/pipecat/audio/vad/vad_analyzer.py`
  `src/pipecat/audio/vad/silero.py`

Relevant concepts:
- confidence AND volume;
- STARTING/SPEAKING/STOPPING states;
- `start_secs`;
- `stop_secs`;
- persistent streaming model state.

### LiveKit Agents Silero

- Documentation:
  https://docs.livekit.io/agents/logic/turns/vad/

Relevant concepts:
- streaming VAD;
- activation threshold;
- minimum speech;
- minimum silence;
- prefix padding.

### OpenWebUI

- Repository:
  https://github.com/open-webui/open-webui
- current call overlay:
  `src/lib/components/chat/MessageInput/CallOverlay.svelte`

Relevant as a negative comparison:
- fixed analyser floor;
- first detected sound starts capture/interruption;
- no explicit onset debounce;
- public reports of background-noise false interruption.

### OpenAI Realtime

- Realtime VAD guide / API documentation:
  https://platform.openai.com/docs/guides/realtime-vad
  https://platform.openai.com/docs/guides/realtime-transcription

Relevant concepts:
- server VAD;
- prefix padding;
- silence duration;
- input noise reduction;
- optional transcription logprobs;
- semantic VAD as a distinct layer.

### Vapi

- Speech configuration documentation:
  https://docs.vapi.ai/customization/speech-configuration

Relevant concept:
- continuous voice duration / `voiceSeconds` to reduce false interruption from background noise.

### Deepgram Flux

- Documentation:
  https://developers.deepgram.com/docs/flux

Relevant as future endpointing architecture:
- tentative/eager and confirmed end-of-turn;
- semantic turn completion separate from low-level speech detection.

### NVIDIA Parakeet

- NVIDIA/NeMo Parakeet ecosystem and current issue reports should be checked when modifying segment slicing.
- A 2026 Parakeet TDT issue reports materially different output when trailing silence is appended to otherwise identical speech, supporting a separate slice-boundary/trim experiment.

---

# 28. Handoff checklist

Before coding:

- [ ] Confirm local production Speaches commit/tree.
- [ ] Confirm current deployed ctrl-b version contains the D80 gap cut.
- [ ] Capture one new quiet-EV debug trail.
- [ ] Add NS/AGC readback before changing their settings.
- [ ] Classify the next false short by segment duration and audio.
- [ ] Build streaming VAD behind a switch if rollback matters.
- [ ] Preserve pre-roll.
- [ ] Test real one-word answers.
- [ ] Keep current relay gap cut initially.
- [ ] Do not blacklist filler words.
- [ ] Do not raise Silero threshold as the primary fix.
- [ ] Do not rewrite transport without new evidence.

---

## Audit status

**Static audit:** complete for the relevant ctrl-b paths at the pinned commit.  
**External architecture comparison:** complete enough to support the recommended direction.  
**Definitive attribution of the newest quiet-electric-car event:** pending one instrumented reproduction because its raw audio/trail is not present in the repository.  
**Repository modifications performed by this audit:** none.
