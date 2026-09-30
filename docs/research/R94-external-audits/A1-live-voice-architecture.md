# CTRL-B Live Voice
# Root-Cause Audit, Remediation Options, and Backend/VAD-Agnostic Architecture

**Document type:** Engineering audit + architecture handoff  
**Date:** 2026-09-28  
**Primary repository:** `nengoxx/ctrl-b`  
**Audited ctrl-b revision:** `778b9608915af82fe8002132cfe17386c9a8cea1` (`main`)  
**Public Speaches revision re-verified:** `nengoxx/speaches` @ `a8116598d394e70ff70bfc610283fd752b10bdbc` (`master`)  
**Intended reader:** A fresh coding-agent session with no prior conversation context  
**Repository posture during this investigation:** Read-only. No ctrl-b or Speaches project files were modified.

---

## 0. Purpose

This document consolidates the complete live-voice investigation and design discussion from the 2026-09-28 session into one standalone engineering dossier.

It covers:

1. the original live-call hallucination symptom;
2. the current capture → transport → VAD → ASR → turn pipeline;
3. which responsibilities belong to Control B today and which belong to Speaches;
4. the evidence-backed root cause of the very short false turns;
5. the remaining long-segment false-final class;
6. why the PCM/WebSocket transport is not presently the leading suspect;
7. the existing D80/S10 mitigations and what they do and do not solve;
8. the Sensitivity / dBFS question;
9. echo, Bluetooth tail, browser NS/AGC, and other adjacent failure classes;
10. fixes ranging from one-line/low-risk patches through a full voice architecture redesign;
11. alternative Parakeet runtimes;
12. alternative dedicated VAD engines;
13. combined ASR+VAD stacks and why they may or may not fit ctrl-b;
14. the desired long-term requirement: **ASR-backend agnosticism and VAD agnosticism**;
15. how native streaming ASR and native EOU/EOB signals fit the same architecture;
16. migration, testing, observability, rollback, and acceptance criteria;
17. concrete tickets for a coding agent.

This is intentionally not written as “change threshold X to value Y.” The objective is to fix the current bug while making the live-voice subsystem easier to reason about and less coupled to any one external speech project.

---

# 1. Evidence vocabulary

The following labels are used throughout:

- **[VERIFIED-CODE]** — directly verified in the pinned ctrl-b or Speaches source.
- **[VERIFIED-UPSTREAM]** — directly verified in current upstream source/docs/model cards.
- **[PROJECT-EVIDENCE]** — measurement or observation already recorded in ctrl-b's own research/trails.
- **[INFERENCE]** — evidence strongly supports the explanation, but the exact newest field occurrence was not directly captured in this audit.
- **[PROPOSAL]** — recommended design, not a claim about current behavior.
- **[NEEDS-FIELD]** — should be settled with an instrumented real-device reproduction rather than more speculation.

The newest false short utterance reported from the quiet electric work car has **not** been supplied to this audit as raw PCM plus call trail. Its exact class therefore remains **[NEEDS-FIELD]** even though the broader architecture problem is well supported.

---

# 2. Executive conclusions

## 2.1 The primary VAD is currently Speaches' responsibility

**[VERIFIED-CODE] Control B does not currently own the primary speech start/stop detector.**

Today:

```text
Control B
  captures continuous PCM
  measures level
  transports audio
  applies secondary gates
  protects against echo/tail
  manages the call state

Speaches
  decides speech_started
  decides speech_stopped
  commits the detected segment
  invokes Parakeet
```

So moving a persistent VAD into a Control-B-owned abstraction is a **new fix**, not merely enabling dormant ctrl-b functionality.

---

## 2.2 The strongest root cause is the Speaches realtime VAD architecture

**[VERIFIED-CODE]** Current public Speaches does not operate Silero as a normal persistent streaming detector.

On each audio append it:

1. takes only the latest **3 seconds** of the current buffer;
2. runs a batch `get_speech_timestamps()` pass over that window;
3. reconstructs Silero recurrent state from zero for that batch;
4. compares the latest batch result with a small external `VadState` to manufacture realtime start/stop events.

That is fundamentally different from:

```text
frame 1 -> recurrent state
frame 2 -> same recurrent state
frame 3 -> same recurrent state
...
```

A moving zero-state batch re-evaluation can make a transient appear speech-like on one append and disappear on a following append, creating extremely short start/stop “flaps”.

That is the best-supported explanation for the measured short false segments.

---

## 2.3 Silero itself is not proven to be the problem

The evidence says:

```text
Speaches + Silero batch-rescan realtime integration = problematic
```

It does **not** say:

```text
Silero as a model = fundamentally unsuitable
```

LiveKit, Pipecat, sherpa-onnx and other realtime stacks use persistent stateful VAD processing rather than the Speaches moving-window pattern.

A persistent Silero implementation is therefore the cleanest control experiment.

---

## 2.4 ctrl-b already has a good defensive patch for the shortest flaps

**[VERIFIED-CODE]** Current ctrl-b contains the D80 relay gap cut.

In call mode it discards a transcript if:

```text
relay speech_started -> speech_stopped gap < silence_ms / 2
```

unless the Speaches audio clock proves a real stop:

```text
audio span >= silence_ms
```

At the current default:

```text
silence_ms = 700 ms
gap-cut boundary = strictly < 350 ms
```

The backend tests pin:

```text
349 ms -> cut
350 ms -> pass
700 ms audio span -> veto the cut
no relay start clock -> fail open
```

This was designed from project evidence where observed false short car flaps were `<= 201 ms` while measured real segments were `>= 2361 ms`.

This is a sensible compatibility patch and should remain during migration.

---

## 2.5 The gap cut is intentionally incomplete

**[PROJECT-EVIDENCE]** R92 also records short texts on long VAD spans, approximately:

```text
"Yeah."      ~3084 ms
"Okay, uh"   ~3158 ms
"Mm-hmm."    ~2478 ms
```

Those are far above the `<350 ms` flap filter.

Therefore a current quiet-EV hallucination can still be a VAD/segmentation problem even if the D80 short-gap patch is working.

The next reproduction must distinguish:

- short flap;
- long non-speech segment;
- assistant echo;
- distant real speech/radio;
- genuine user short answer;
- ASR/slice-boundary issue.

---

## 2.6 Parakeet should not be blamed first

The ASR receives audio only after another subsystem has effectively said:

> This audio is speech and deserves transcription.

ASR models are not reliable no-speech classifiers.

Project probes already show that ordinary broadband noise can often yield an empty result while structured or speech-like garbage can decode as plausible tiny utterances such as `Uh`, `Okay`, or `Oh`.

The first debugging question should therefore be:

> **Why was this audio admitted and committed as speech?**

not:

> Why didn't Parakeet know this should be empty?

---

## 2.7 The long-term design should not be “Silero + Parakeet”

The desired architecture is:

> **Control B owns voice contracts and turn semantics. VAD and ASR are replaceable capability-driven engines.**

That means:

```text
VAD may be:
  Silero
  FireRedVAD
  TEN VAD
  a remote VAD
  none

Final ASR may be:
  any OpenAI-compatible STT target
  parakeet.cpp
  CrispASR
  sherpa-onnx
  Speaches legacy
  cloud ASR

Optional live ASR may be:
  Parakeet Realtime EOU
  Nemotron streaming
  another future streaming ASR
```

The core call logic should not contain model-name-specific conditions.

---

# 3. Current live-call architecture

The current call path is approximately:

```text
Android/browser microphone
        │
        ▼
getUserMedia()
  route-dependent echo cancellation
  noise suppression on
  mono
        │
        ▼
AudioContext / AudioWorklet
  Float32 mono
  frame_ms-sized frames
  RMS measurement
  PCM16 little-endian
        │
        ▼
ctrl-b WebSocket
  binary PCM16
  actual AudioContext sample rate declared
        │
        ▼
ctrl-b LiveRelaySession
  frame validation
  bounded/paced queues
  stateful resampling to 24 kHz
        │
        ▼
Speaches realtime WebSocket
  base64 PCM16 @ 24 kHz
        │
        ▼
Speaches resamples to 16 kHz
        │
        ▼
Speaches realtime Silero logic
  repeated batch scan of latest 3 s
        │
        ├ speech_started
        └ speech_stopped
        │
        ▼
Speaches commits segment
        │
        ▼
Parakeet transcription
        │
        ▼
ctrl-b relay
  item_id bookkeeping
  D80 short-gap cut
        │
        ▼
ctrl-b client
  relative level/proximity gate
  min_final_ms
  noise verdict
  echo/tail checks
  call state
        │
        ▼
agent user turn
```

This diagram explains why ctrl-b already has a lot of voice intelligence while still depending on Speaches for the most important acoustic boundary decision.

---

# 4. Browser capture audit

## 4.1 Microphone constraints

`frontend/src/lib/pcmCapture.ts`

Current requested constraints:

```text
echoCancellation:
  route == "call"  -> { ideal: "all" }
  route == "media" -> false

noiseSuppression: true
channelCount: 1
```

`autoGainControl` is not explicitly constrained.

This means the exact resolved AGC behavior is browser/platform dependent and should be observed via `track.getSettings()`.

---

## 4.2 Mic readback gap

Current `MicReadback` contains:

```text
echoCancellation
echoCapabilities
label
deviceId
```

It does **not** currently retain:

```text
noiseSuppression
autoGainControl
channelCount
track sampleRate
```

### Recommended instrumentation

Add actual readback:

```text
requested route
echoCancellation actual
noiseSuppression actual
autoGainControl actual
channelCount actual
track sampleRate
AudioContext sampleRate
deviceId
label
fellBack
ecStuck
```

This is low-risk diagnostic work and should precede attempts to “fix” AGC/NS by guessing.

---

# 5. AudioWorklet / PCM audit

`frontend/src/lib/pcmWorklet.ts`

**[VERIFIED-CODE]**

The worklet:

- receives mono Float32 samples;
- carries remainder across WebAudio render quanta until a full configured frame exists;
- converts to PCM16 little-endian using `DataView`;
- clamps values to `[-1,1]`;
- maps negative full scale using `32768` and positive using `32767`;
- calculates RMS over the same input samples;
- timestamps the first sample of the frame using the AudioContext clock;
- transfers the buffer rather than copying.

No obvious:

- endian bug;
- sign bug;
- stereo interpretation bug;
- sample-count bug;
- accidental clipping bug

was found.

---

## 5.1 RMS/DC discrepancy

The current RMS is:

```text
sqrt(mean(sample^2))
```

It does not subtract the frame mean first.

A DC offset therefore contributes to the level measurement.

This is not presently the best explanation for the false words, but it creates a code/docs discrepancy because later research discusses DC removal in some measurement contexts.

### Recommendation

In debug mode calculate both:

```text
raw RMS
DC-removed RMS
```

and compare them on the affected phone/car.

Do **not** modify the audio sent to ASR purely to make the meter cleaner without evidence.

---

# 6. Transport and resampling audit

`backend/app/core/audio.py::Pcm16Resampler`

**[VERIFIED-CODE]**

The relay's resampler is stateful.

It:

- carries exact rational source position across `feed()` calls;
- retains the previous frame's final sample;
- interpolates across packet boundaries;
- avoids re-anchoring the resampling grid every 40 ms;
- has an identity fast path;
- rejects odd-byte PCM frames.

This is the correct general shape for streamed audio.

No clear transport/resampling bug was found that would naturally explain repeated `Yeah` / `Mm-hmm` outputs.

---

## 6.1 Future cleanup

The generic audio module currently contains:

```text
SPEACHES_WIRE_RATE = 24000
```

A backend-agnostic architecture should not let a provider-specific rate become a generic audio constant.

Future adapters should declare accepted audio formats/rates.

---

# 7. Backpressure audit

The current call path contains bounded client and relay buffering plus pacing/drop policies.

An overloaded path can lose or stale audio, but there is no evidence that a healthy transport is creating the observed lexical hallucinations.

Do not begin the fix by replacing WebSockets or rewriting resampling.

---

# 8. Speaches realtime VAD: exact implementation problem

## 8.1 Three-second window

Current public Speaches:

`src/speaches/realtime/input_audio_buffer.py`

```python
SAMPLE_RATE = 16000
MS_SAMPLE_RATE = 16
MAX_VAD_WINDOW_SIZE_SAMPLES = 3000 * MS_SAMPLE_RATE
```

On every append:

`src/speaches/realtime/input_audio_buffer_event_router.py`

```python
audio_window =
    input_audio_buffer.data[-MAX_VAD_WINDOW_SIZE_SAMPLES:]

speech_timestamps =
    get_speech_timestamps(audio_window, ...)
```

So the “realtime” detector is repeatedly rerunning a batch speech-segmentation function over the most recent 3 seconds.

---

## 8.2 Recurrent state starts from zero

Current:

`src/speaches/executors/silero_vad_v5.py`

The batch model invocation initializes:

```python
state = np.zeros((2, batch_size, 128), dtype=np.float32)
```

inside each batch inference.

This is the load-bearing observation.

A true streaming VAD would preserve recurrent state between newly arriving frames.

Speaches instead repeatedly reconstructs state from the moving 3-second window.

---

## 8.3 Why a moving zero-state batch can flap

Consider a structured transient.

Append N:

```text
[noise ... transient ...]
             ^
batch detector finds speech
=> speech_started
```

Append N+1 or N+2:

```text
[slightly shifted context ... transient ... newer audio]
```

The batch pass can produce a different set of speech timestamps.

If the latest speech region disappears or no longer extends to the moving-window tail, the external realtime wrapper can emit:

```text
speech_stopped
```

immediately after the start event.

Thus a brief structured event can become a “user utterance” even though there was never stable persistent speech evidence.

---

# 9. Public Speaches vs deployed/local Speaches

This distinction is important.

The re-verified public Speaches SHA is:

```text
a8116598d394e70ff70bfc610283fd752b10bdbc
```

The public tree confirms the 3-second moving zero-state realtime VAD architecture.

However, ctrl-b's research documents refer to an **owned/local Speaches fork** containing additional patches.

Example: prefix-padding behavior is described as local-fork work.

R92 also describes a production behavior in which the HTTP STT path can return empty before Parakeet is invoked after a second VAD/no-speech check.

The current public tree does run a second VAD in `/v1/audio/transcriptions` and builds `speech_segments`, but its public Parakeet executor currently contains:

```text
TODO: Use request.speech_segments for audio chunking
```

and directly recognizes the full request audio.

Therefore:

> Do not assume every R92 statement about the production/local fork is true of public Speaches, or vice versa.

### Required first coding-agent task

Before editing Speaches:

```text
git rev-parse HEAD
git status
git diff
```

on the deployed local Speaches checkout.

Record:

```text
SHA
dirty diff
onnx_asr version
model identity
```

This avoids “fixing” the wrong source snapshot.

---

# 10. Field evidence from ctrl-b research

## 10.1 Car call

R92 records a car call with:

- about 38 Silero segments in about 5 minutes;
- many `speech_started -> speech_stopped` event gaps around tens of milliseconds;
- 19 empty finals;
- short false/non-owner transcriptions including examples such as:
  - `Yeah.`
  - `Mm-hmm.`
  - `Mm.`
  - `Okay.`

R92 later corrected the interpretation of many empty finals: in the deployed/local fork they likely came from a second no-speech/VAD path rather than from Parakeet returning empty itself.

---

## 10.2 Short-flap measured separation

Project measurements used by D80:

```text
false short arrival gaps <= 201 ms
real measured arrival gaps >= 2361 ms
```

This motivated the relay gap-cut band.

That evidence is good enough for a safe compatibility filter but should not be generalized into “real speech can never be short”.

A genuine `yes` can be much shorter than 2.3 seconds.

---

## 10.3 Long false/ambiguous segments

R92 also records short text on long spans:

```text
"Yeah."      ~3.084 s
"Okay, uh"   ~3.158 s
"Mm-hmm."    ~2.478 s
```

These survive the D80 short-gap filter by design.

This is why the architecture still needs a real VAD/turn solution.

---

# 11. Parakeet synthetic evidence

Project probes found:

- broadband noise often produces empty text;
- structured hum/noise or speech-like fragments can produce plausible short strings;
- examples included short outputs such as `Uh`, `Okay`, or `Oh`.

The exact word is not stable or important.

The important conclusion is:

> Once ambiguous structured audio reaches ASR as a committed utterance, a short plausible linguistic decode is unsurprising.

Do not rely on ASR to repair bad admission.

---

# 12. Silero threshold evidence

R84 tested thresholds and found:

- the old `0.9` Speaches default was an outlier;
- Silero's effective end threshold follows activation (`threshold - 0.15` in the studied implementation);
- high thresholds cause premature ends on degraded/quiet/narrowband speech;
- speech-like interferers can still start across broad threshold ranges;
- raising threshold is not a clean “noise rejection” lever.

Current ctrl-b:

```text
vad_threshold = 0.6
valid range = 0.5–0.8
```

This is a reasonable current baseline.

### Do not use:

```text
0.9
```

as the architectural fix.

---

# 13. Existing D80/S10 protections

Current main already has meaningful safety machinery.

---

## 13.1 Segment IDs

`item_id` is forwarded so speech events, energy evidence and final transcripts can be associated with the same segment.

This fixed prior overlap/epoch problems.

---

## 13.2 Relay gap cut

`backend/app/services/voice_live.py::gap_cut_ms`

Conceptually:

```python
if relay_gap is missing:
    keep

if relay_gap >= silence_ms / 2:
    keep

if audio_gap exists and audio_gap >= silence_ms:
    keep

otherwise:
    cut
```

The cut sends an empty final with reason `short`.

This should remain during a VAD migration as defense in depth.

---

## 13.3 Client relative level/proximity gate

`frontend/src/lib/levelGate.ts`

This gate answers:

> Was enough of the segment plausibly loud/near enough to be the owner?

It is **not** a speech classifier.

Important current values:

```text
noise bootstrap            1 s
noise window               5 s
discard frames below      -84 dBFS
voice EMA alpha            0.3

floor_dbfs                -45
noise_margin_db            10
voice_margin_db            10
playback_margin_db         10
min_dbfs                  -60
max_dbfs                  -20

min_final_ms              200
```

Approximate auto-floor logic:

```text
max(
  measured_noise + noise_margin,
  learned_owner_voice - voice_margin
)
```

then clamp.

This should be preserved through the architectural change.

---

## 13.4 Noise verdict

If a speech segment remains open while a reply is ready, ctrl-b can classify the segment as noise if after `noise_verdict_ms` it has accumulated insufficient above-floor energy.

Current default:

```text
1000 ms
```

This prevents some weak/noisy open segments from indefinitely blocking a reply.

Again: this operates on a segment already opened by the upstream VAD.

---

## 13.5 Echo/tail defenses

The project has a separate, well-evidenced Bluetooth/TTS feedback class.

Car playback can remain audible after the browser media element reports end.

Existing defenses include:

- ear hold;
- post-playback tail hold;
- quiet-run release;
- cap;
- chirp-measured output lag;
- text self-echo backstop;
- segment identity.

Do not merge echo handling into the ambient-noise VAD fix.

---

# 14. Sensitivity and dBFS

The reported concern:

> voice around -20/-21 dBFS; Sensitivity top around -40

does not mean voice is out of range.

dBFS:

```text
0 dBFS   = maximum digital level
-20      = relatively loud
-40      = much quieter
-60      = very quiet
```

So:

```text
voice = -21 dBFS
floor = -40 dBFS
```

means voice is about 19 dB **above** the floor.

It passes.

The dangerous case is raising a floor/pin toward `-20`, where `-21` can be rejected.

Current code contains a dynamic pin ceiling intended to prevent the earlier car failure where a manual `-20` pin sat above the owner's learned voice and rejected it.

---

## 14.1 Sensitivity is not server VAD sensitivity

The call's Sensitivity control affects client-side level/proximity evidence.

It does not change:

```text
Silero probability threshold
Speaches speech_started
Speaches speech_stopped
```

Therefore moving the slider cannot prevent Speaches from opening a segment or invoking ASR upstream.

That separation should remain explicit in the new design.

---

# 15. Browser preprocessing

## 15.1 Noise suppression

Current capture asks:

```text
noiseSuppression: true
```

Do not immediately stack another denoiser on top.

Noise suppression can reduce stationary noise but can also reshape the signal and create artifacts.

Run real A/B first.

---

## 15.2 AGC

Call capture currently leaves `autoGainControl` unspecified.

The resolved setting should be logged before changing it.

Project research indicates Android/route behavior differs from desktop adaptive AGC expectations.

Do not assume enabling AGC will normalize the car.

---

# 16. Failure taxonomy for the next false short utterance

When the next `Yeah`/`Mm-hmm` appears, classify it.

---

## Class A — short VAD flap

Evidence:

```text
relay gap < 350 ms
```

Current call-mode gap cut should normally suppress it.

If it does not:

- verify deployed ctrl-b version;
- verify `mode=call`;
- inspect `item_id`;
- inspect audio-gap veto;
- inspect trail.

---

## Class B — long non-speech segment

Evidence:

```text
gap > 350 ms
captured WAV contains no human speech
```

This is a primary target for persistent streaming VAD + onset confirmation.

---

## Class C — assistant echo

WAV contains the assistant's TTS.

Investigate the tail/echo path, not the ambient VAD threshold.

---

## Class D — distant real speech

Radio, TV, passenger, next-room voice, etc.

The VAD can be correct while the turn is wrong.

The relevant layer is owner/proximity discrimination.

---

## Class E — genuine user short answer

No hallucination.

Do not blacklist the lexical item.

---

## Class F — ASR slicing/padding failure

The WAV contains user speech but the final transcription is bad because of clipping/padding/trailing silence.

Treat separately from VAD false-positive work.

---

# 17. Solution spectrum: smallest to largest

---

## Option 0 — observability only

**Risk:** very low  
**Architecture:** unchanged  
**Recommended:** yes, regardless of later path

Add:

- actual NS/AGC/channel/sample-rate readback;
- raw + DC-removed RMS diagnostics;
- per-segment VAD/energy metadata;
- bounded opt-in WAV capture around suspicious segments.

Purpose:

> know which bug class the newest quiet-EV issue actually is.

---

## Option 1 — tiny Speaches minimum-speech patch

Current Speaches `VadOptions` has:

```text
min_speech_duration_ms
```

default:

```text
0
```

and the realtime caller does not override it.

Experiment:

```text
150 ms
200 ms
250 ms
```

### Pros

- tiny code change;
- easy rollback;
- likely reduces some one-frame/short flaps.

### Cons

- still uses moving zero-state 3 s rescans;
- not a true streaming detector;
- does not solve long false segments;
- risks suppressing genuine short speech unless pre-roll/buffering is correct.

**Recommendation:** acceptable stopgap only.

---

## Option 2 — repair Speaches VAD in place

Replace its realtime detector with:

```text
persistent recurrent Silero state
frame-by-frame inference
minimum sustained onset
silence/hysteresis end
pre-roll
one clean segment buffer
```

### Pros

- minimum ctrl-b protocol churn;
- current live WebSocket remains;
- frontend unchanged.

### Cons

- Control B still delegates turn boundaries to Speaches;
- VAD and ASR remain coupled;
- future VAD switching still requires Speaches work;
- project remains tied to an older/less-active speech server.

**Recommendation:** good technical fix if minimizing changes outranks architectural cleanup.

---

## Option 3 — Control B owns VAD; Speaches becomes final ASR only

Pipeline:

```text
browser PCM
 -> ctrl-b VAD/TurnController
 -> finalized utterance
 -> existing Speaches /v1/audio/transcriptions
 -> text
```

### Pros

- fixes ownership boundary;
- isolates VAD migration from ASR migration;
- keeps known Parakeet behavior temporarily;
- easiest way to prove the VAD hypothesis cleanly.

### Cons

- Speaches remains deployed until later.

**Recommendation:** excellent intermediate milestone.

---

## Option 4 — Control B VAD + parakeet.cpp batch ASR

Likely ordinary production target:

```text
PCM
 -> ctrl-b VAD
 -> ctrl-b turn buffer
 -> parakeet.cpp OpenAI batch endpoint
 -> final text
```

### Pros

- clean responsibility split;
- Parakeet v3 remains;
- CPU;
- Vulkan;
- Ryzen APU can be tested without CUDA;
- OpenAI-compatible batch endpoint;
- minimal external policy.

### Cons

- bundled HTTP server is intentionally simple;
- one model;
- serialized inference;
- WAV uploads.

For a single local user, those limitations may not matter.

---

## Option 5 — in-process sherpa-onnx

Pipeline:

```text
ctrl-b Python
  -> sherpa stateful VAD
  -> sherpa Parakeet v3 INT8
```

### Pros

- one process;
- good VAD architecture;
- CPU Windows support;
- fewer moving pieces.

### Cons

- no Vulkan 780M advantage like parakeet.cpp;
- current RealtimeSTT validation warns of intermittent empty native-Windows sherpa Parakeet finals in some fixtures.

**Recommendation:** strongest simplicity candidate; benchmark before production.

---

## Option 6 — RealtimeSTT owns the voice path

Current RealtimeSTT is substantially healthier than Speaches and supports:

- persistent Silero;
- WebRTC/Silero recorder logic;
- pre-roll;
- streaming models;
- sherpa Parakeet final;
- production WS/HTTP server.

### Problem for ctrl-b

It duplicates existing Control-B responsibilities.

**Recommendation:** good comparison/reference, not the preferred ownership model.

---

## Option 7 — CrispASR owns the voice path

CrispASR is active, supports many ASR/VAD backends and has Windows Vulkan/HIP/CPU options.

### Caveat

Its current vLLM realtime WebSocket documentation says that particular realtime API is Whisper-only today.

Its OpenAI batch Parakeet endpoint is still useful.

**Recommendation:** strong batch backend candidate; not necessary as the orchestration layer.

---

## Option 8 — fully VAD/ASR-agnostic Control B

This is the preferred long-term solution.

Control B owns:

```text
audio ingress
format routing
canonical PCM
turn state
endpoint policy
canonical events
failure recovery
capability resolution
```

Engines own:

```text
VAD -> acoustic evidence
live ASR -> partials / optional native endpoint hints
final ASR -> authoritative text
```

---

# 18. Dedicated VAD candidates

---

## 18.1 Persistent Silero

**Role:** baseline.

Reasons:

- mature;
- tiny;
- widely deployed;
- stateful recurrent streaming;
- existing ctrl-b calibration/evidence;
- cleanest experiment to isolate the Speaches integration defect.

A correct persistent Silero implementation is materially different from current Speaches.

### Version caution

Silero v5 and v6 probability distributions are not guaranteed to match.

Treat a model-generation change as a recalibration event.

For the first architecture comparison, keep the currently understood generation as close as practical.

---

# 19. FireRedVAD

Repository:

```text
FireRedTeam/FireRedVAD
```

Checked SHA:

```text
c30ec49e8cc69642b0ee65362eba11b9d11c6e54
```

License:

```text
Apache-2.0
```

Features currently documented:

- streaming VAD;
- offline VAD;
- CPU operation;
- 100+ languages;
- ~2.2 MB model in example output.

Author-reported FLEURS-VAD-102:

```text
                  F1      false alarm   miss
FireRedVAD       97.57       2.69       3.62
Silero           95.95       9.41       3.95
TEN              95.19      15.47       2.95
WebRTC           52.30       2.83      64.15
```

This makes FireRed a very interesting false-positive challenger.

### Important limitation

That is an author benchmark on multilingual VAD data, not a car-noise benchmark.

Use it to justify testing, not to declare the winner.

Upstream quick start currently documents:

```bash
pip install fireredvad
```

plus model download and `FireRedStreamVad`.

---

# 20. TEN VAD

Repository:

```text
TEN-framework/ten-vad
```

Checked SHA:

```text
22a3bcd4509d0faaa8eef4881e8af5f39c178950
```

Features:

- 16 kHz input;
- 10/16 ms hop configurations;
- very small runtime footprint;
- low reported RTF;
- Windows/Linux/macOS/mobile/web support;
- designed around voice-agent endpoint responsiveness.

### License warning

The upstream LICENSE is **not plain Apache-2.0**.

It contains Apache-2.0 text plus additional deployment conditions, including restrictions regarding competition with Agora offerings.

This should be explicitly reviewed before making TEN a distributed dependency.

### sherpa implementation warning

Current sherpa-onnx TEN preprocessing sets the model's expected pitch feature to zero and includes a source comment:

> This may reduce performance.

Therefore:

```text
TEN via sherpa != necessarily definitive native TEN quality
```

A serious VAD bake-off should include the official/native TEN path.

---

# 21. WebRTC VAD

Not recommended as the authoritative detector.

Advantages:

- trivial compute;
- mature;
- simple.

Disadvantages:

- much weaker discrimination in difficult/non-speech environmental audio;
- binary output;
- more false activation risk.

Given the Ryzen host, saving the small neural-VAD compute budget is not worth making speech admission weaker.

---

# 22. RMS/energy is evidence, not VAD

Keep the existing relative energy gate.

It answers:

> Is this close/loud enough to plausibly be the owner?

The acoustic VAD answers:

> Does this sound like speech?

Those are complementary.

Do not merge them into one unexplained magic number.

---

# 23. ASR options

---

## 23.1 Preserve the existing generic final STT concept

ctrl-b already has:

```text
Settings
 -> provider_registry
 -> ResolvedTarget
 -> VoiceClient
```

for ordinary STT.

That is useful architecture.

The new live subsystem should reuse the same idea for authoritative final transcription rather than replacing it with a Parakeet-only API.

---

# 24. parakeet.cpp

Repository source checked:

```text
mudler/parakeet.cpp
238057cb707fdb6c4b185c853da095328930b539
```

Latest release checked:

```text
v0.5.0
2026-08-01
```

Release assets include:

```text
Windows x64 CPU
Windows x64 Vulkan
Linux x64 CPU
Linux x64 Vulkan
shared-library variants
```

Current project documentation explicitly supports ggml device selection including integrated Ryzen APUs.

---

## 24.1 Batch HTTP server

`parakeet-server` exposes:

```text
POST /v1/audio/transcriptions
```

and is intentionally described upstream as an example server:

- one loaded model;
- one transcription at a time;
- WAV input;
- OpenAI-style output.

For ctrl-b's one-user local environment this may be entirely adequate.

Prototype concept:

```powershell
.\parakeet-server.exe --model tdt-0.6b-v3 --port 8080
```

Then send the completed utterance.

---

## 24.2 CPU vs Radeon 780M Vulkan

Do not make GPU support a prerequisite.

Benchmark:

```text
CPU build
Vulkan build
```

on the actual call segment distribution:

```text
0.3 s
0.5 s
1 s
3 s
5 s
10 s
```

Measure:

```text
p50
p95
CPU utilization
GPU utilization
RAM/shared VRAM
load time
text parity
```

An iGPU can lose on tiny jobs because dispatch overhead matters.

Let the measurements decide.

---

# 25. CrispASR

Repository checked:

```text
CrispStrobe/CrispASR
391fe51bfe7705404fb610ea23c67b5794f27bdb
```

Latest release checked:

```text
v0.8.37
2026-09-25
```

Current release assets include:

```text
Windows CPU
Windows Vulkan
Linux Vulkan
Linux HIP
```

Its server exposes:

```text
POST /v1/audio/transcriptions
```

and supports Parakeet.

It can therefore be used simply as a resident batch Parakeet server without adopting the rest of CrispASR.

### Important realtime caveat

Current docs for its vLLM-compatible `/v1/realtime` WebSocket say:

```text
Whisper-only today
```

Therefore do not assume the Parakeet HTTP backend also gives ctrl-b a Parakeet live-stream API.

---

# 26. sherpa-onnx

Checked SHA:

```text
040afe360a38e25daaa325ce8889abf93ea02609
```

Current CPU Python install:

```bash
pip install sherpa-onnx sherpa-onnx-bin
```

Official current docs support CPU wheels including Windows x64/x86.

The VAD implementation is a strong reference:

- persistent hidden state;
- minimum speech duration;
- minimum silence duration;
- hysteresis;
- queued completed segments;
- reset semantics.

It supports both Silero and TEN.

It can also run Parakeet v3 INT8.

---

# 27. RealtimeSTT

Checked:

```text
777727553eedfa19aead15337ce66bab549add3f
```

Current sherpa engines include:

```text
sherpa_onnx_parakeet
sherpa_onnx_nemotron
```

with Parakeet v3 INT8 as authoritative final and Nemotron as a true streaming model.

Current install:

```powershell
python -m pip install "RealtimeSTT[server,sherpa-onnx]"
stt-install-sherpa-models --root models/sherpa-onnx --model all
```

Current production docs explicitly separate live streaming and final lanes.

This is a useful architectural precedent even if ctrl-b does not adopt the framework.

---

# 28. Native streaming ASR requires a richer contract

The ordinary OpenAI transcription API is ideal for:

```text
completed audio -> final text
```

It is not enough to represent:

```text
continuous PCM
 -> partial text
 -> word timestamps/confidence
 -> native EOU
 -> native EOB
```

Therefore backend agnosticism requires **two ASR contracts**:

```text
BatchAsr
StreamingAsr
```

---

# 29. Batch ASR contract

Conceptually:

```python
class BatchAsr:
    capabilities: AsrCapabilities

    async def transcribe(
        audio,
        *,
        language=None,
    ) -> FinalTranscript:
        ...
```

Adapters can include:

```text
existing OpenAI VoiceClient
Speaches
parakeet.cpp HTTP
CrispASR HTTP
sherpa in-process
cloud STT
```

This path should remain the authoritative final lane by default.

---

# 30. Streaming ASR contract

Conceptually:

```python
class StreamingAsr:
    capabilities: AsrCapabilities

    async def open_stream(config) -> AsrStream:
        ...
```

and:

```python
class AsrStream:
    async def feed(pcm) -> list[AsrEvent]:
        ...
    async def flush() -> list[AsrEvent]:
        ...
    async def close() -> None:
        ...
```

Canonical events may include:

```text
TranscriptPartial
TranscriptFinalDelta
EndpointHint(utterance)
EndpointHint(backchannel)
WordFinalized
```

---

# 31. Parakeet Realtime EOU 120M

Model:

```text
nvidia/parakeet_realtime_eou_120m-v1
```

Current model card confirms:

- native streaming;
- native `<EOU>` endpoint;
- voice-agent target;
- low-latency operation;
- English-only;
- no punctuation;
- no capitalization.

This should be viewed as a **different live model**, not a drop-in replacement for multilingual Parakeet v3.

---

# 32. parakeet.cpp native streaming API

Crucial distinction:

## HTTP `parakeet-server`

Batch:

```text
WAV upload
 -> final transcription
```

## Shared C API

Persistent streaming:

```text
parakeet_capi_stream_begin()
parakeet_capi_stream_feed()
parakeet_capi_stream_finalize()
parakeet_capi_stream_free()
```

The tagged `v0.5.0` API already contains this streaming surface.

Input:

```text
16 kHz mono float PCM
```

It surfaces:

```text
new finalized text
EOU
EOB
event timestamps
word timestamps
confidence
```

JSON helpers return a document shaped approximately:

```json
{
  "text": "...",
  "eou": 1,
  "eob": 0,
  "events": [
    {"type": "eou", "frame": 31, "t": 2.48}
  ],
  "words": [
    {"w": "hello", "start": 0.48, "end": 0.64, "conf": 0.91}
  ]
}
```

---

## 32.1 EOU vs EOB

Current `parakeet.cpp` C API explicitly distinguishes:

```text
EOU = user completed an utterance; voice agent may respond
EOB = user completed a backchannel/acknowledgment
```

Its source comments use an example such as `uh-huh` and explicitly state that a voice agent should not treat EOB as the user taking the turn.

That is potentially very valuable in ctrl-b.

Do not infer EOB from text manually.

Preserve the provider's signal as canonical metadata.

---

## 32.2 How to expose the streaming C API to ctrl-b

The bundled HTTP server does not provide this continuous stream.

Options:

### A. In-process FFI

Load:

```text
parakeet.dll / libparakeet.so
```

from the Python backend with a thin binding.

Advantages:

- lowest IPC latency;
- one process;
- direct capabilities.

Disadvantages:

- native-library lifecycle now lives in ctrl-b;
- crash isolation weaker.

### B. Tiny local sidecar

Build a narrowly scoped local streaming service over the C API.

Protocol:

```text
start
binary PCM
events
stop
```

Advantages:

- process isolation;
- easy restart;
- keeps native C++ out of ctrl-b process.

Disadvantages:

- another small process/protocol.

### C. Another future streaming provider

The architecture should not care whether the stream is parakeet.cpp, Nemotron, cloud Realtime, etc.

---

# 33. Endpointing is a third independent abstraction

VAD and ASR should not implicitly own the turn.

Define explicit endpointing strategies:

```text
vad
native
hybrid
manual
auto
```

---

## 33.1 VAD endpointing

For ordinary batch ASR:

```text
VAD confirms speech
 -> open turn

VAD confirms enough silence
 -> close turn

batch ASR
 -> final text
```

---

## 33.2 Native endpointing

For a native streaming model:

```text
continuous PCM -> live ASR
native EOU     -> close turn
```

VAD may be disabled.

This should be supported but need not be the first production configuration.

---

## 33.3 Hybrid endpointing

Recommended for early native-EOU deployment:

```text
VAD:
  acoustic start
  barge-in/UI activity
  fallback silence

live ASR:
  native EOU = fast semantic-ish end
  EOB = backchannel hint
```

Example:

```text
VAD opens speech
EOU arrives -> finalize immediately

OR

EOU fails to arrive
+ fallback silence timeout
-> finalize safely
```

This gives low native endpoint latency without creating an uncloseable turn if the streaming model fails to emit EOU.

---

## 33.4 Manual endpointing

Push-to-talk/dictation:

```text
user action defines the boundary
```

VAD can be disabled or advisory.

Keep this first-class.

---

# 34. Live ASR and final ASR can be different

This is one of the strongest design improvements.

For example:

```text
LiveAsr:
  Parakeet Realtime EOU 120M
  -> partial text
  -> EOU/EOB

FinalAsr:
  Parakeet TDT 0.6B v3
  -> authoritative final text
```

Why this is useful:

- low-latency endpointing;
- live text if desired;
- final model can retain multilingual/quality behavior;
- final model can restore normal casing/punctuation behavior;
- streaming failure does not destroy the turn.

This dual-lane idea is also consistent with the current RealtimeSTT production design, which separates live and final engines.

---

# 35. Always keep a canonical turn PCM buffer

Even when using streaming ASR, Control B should retain a bounded canonical turn buffer.

Reasons:

- authoritative final transcription;
- live-provider failure recovery;
- provider failover;
- debugging;
- reproducible tests;
- optional later correction;
- no need to reconstruct audio from partial tokens.

Failure path:

```text
live ASR crashes
 -> continue buffering PCM
 -> VAD/fallback closes the turn
 -> BatchAsr transcribes canonical PCM
 -> conversation survives
```

This is a key benefit of separating live ASR from final ASR.

---

# 36. Capability-driven pipeline selection

Do not identify features from model names.

Define explicit capabilities.

Example batch target:

```text
batch                true
streaming            false
partials              false
native_endpointing    false
backchannel_events    false
word_timestamps       true
punctuation           true
capitalization        true
input_rates           {16000, ...}
languages             [...]
```

Example Parakeet EOU target:

```text
batch                false/irrelevant
streaming            true
partials              true
native_endpointing    true
backchannel_events    true
punctuation           false
capitalization        false
language              English
input_rate            16000
```

---

## 36.1 Endpoint-mode validation

```text
endpointing=vad
  requires VAD

endpointing=native
  requires live_asr.native_endpointing

endpointing=hybrid
  requires VAD + native endpointing

endpointing=manual
  requires neither

endpointing=auto
  resolver selects a valid mode from capabilities
```

Invalid combinations should fail settings validation loudly.

---

# 37. VAD should also expose capabilities

Example:

```text
probabilities
binary activity
stateful
native segment events
required frame size
supported sample rates
```

Some VADs expose probability.

Some expose only speech/non-speech.

Some emit complete start/end events.

Normalize them into Control-B-owned observations.

---

# 38. Control B owns the TurnController

Stable center:

```text
QUIET
  │ acoustic evidence
  ▼
CANDIDATE
  │ sustained confirmation
  ▼
SPEAKING
  │
  ├ native EOU -> finalize
  ├ VAD silence -> finalize
  ├ manual stop -> finalize
  └ hard timeout -> finalize/degrade
```

The TurnController owns:

```text
pre-roll
candidate duration
turn IDs
canonical PCM
endpoint source
fallback timers
max turn length
recovery policy
```

The VAD does not own these semantics.

The ASR does not own these semantics.

---

# 39. Pre-roll is mandatory

If speech must be sustained for e.g. 200 ms before confirmation, but recording begins only after that delay, the word onset is clipped.

Correct shape:

```text
always maintain rolling pre-roll

candidate begins
 -> candidate audio already retained

candidate confirmed
 -> create turn whose start reaches into pre-roll
```

Suggested starting experiment:

```text
prefix 300–500 ms
```

The exact value must be tuned with real short-answer recordings.

---

# 40. Short answers are a required regression class

Explicitly test:

```text
yes
no
yeah
mm-hmm
okay
```

many times.

A solution that eliminates false `Yeah` by eliminating real `Yeah` is not a solution.

No lexical blacklist.

---

# 41. Existing relative energy gate remains valuable

The new VAD should not make `levelGate.ts` obsolete.

Its role remains:

```text
neural VAD:
  speech-like?

relative level:
  near/owner-like enough?

echo system:
  our own playback?

ASR:
  what words?
```

This layered evidence is healthier than one detector trying to answer all four questions.

---

# 42. How this fits the current provider registry

ctrl-b already uses the pattern:

```text
config
 -> provider_registry
 -> frozen resolved target/policy
 -> adapter
```

This should be reused.

### Keep:

- final STT providers in the existing generic provider world where practical;
- call settings snapshot at call start.

### Add:

A sibling voice-engine/capability registry for things that are not naturally HTTP OpenAI targets, especially in-process VAD.

Do **not** force an in-process Silero/TEN/FireRed adapter into a shape requiring:

```text
base_url
api_key
api_mode
```

when those fields are meaningless.

---

# 43. Suggested configuration semantics

Exact names can change.

Conceptually:

```yaml
voice:
  stt:
    # Existing authoritative final STT
    provider: local-parakeet
    model: parakeet-v3

  vad:
    engine: silero
    model: silero-v5
    extra: {}

  streaming_stt:
    enabled: false
    provider: ""
    model: ""

  endpointing:
    mode: auto
    start_confirm_ms: 200
    prefix_ms: 350
    silence_ms: 700
    native_fallback_silence_ms: 1200
```

English low-latency profile:

```yaml
voice:
  stt:
    provider: parakeet-final
    model: parakeet-v3

  vad:
    engine: firered

  streaming_stt:
    enabled: true
    provider: parakeet-live
    model: eou-120m

  endpointing:
    mode: hybrid
```

---

# 44. `auto` endpoint resolver

Suggested behavior:

```text
if live ASR has native endpointing and VAD exists:
    hybrid

elif live ASR has native endpointing:
    native

elif VAD exists:
    vad

elif explicit manual mode:
    manual

else:
    configuration error
```

No model-name tests.

---

# 45. “Switch at any time” semantics

Backend agnosticism should mean:

> Settings can select another engine without rewriting application code.

It should **not** imply migrating recurrent hidden state halfway through an active call.

Use the existing good ctrl-b rule:

```text
engine selections freeze at call start
settings changes apply to the next call
```

---

## 45.1 Batch ASR failover

Easy:

```text
turn finalizes
 -> try final ASR target 1
 -> target 2 if allowed/failure
```

Reuse existing final STT chain concepts.

---

## 45.2 Streaming ASR failure

Do not attempt hidden-state transfer.

Instead:

```text
live ASR fails
 -> mark live lane degraded
 -> keep canonical PCM
 -> continue VAD
 -> batch final at turn end
 -> reopen live stream next turn
```

---

## 45.3 VAD failure

Do not silently make RMS become authoritative speech detection.

Possible explicit degrade hierarchy:

```text
native EOU available:
  native + hard timeout

no native EOU:
  stop/reopen media leg
  or manual endpointing
  depending policy
```

A failure should be visible in debug/state.

---

# 46. Provider-agnostic audio routing

Current:

```text
browser rate
 -> ctrl-b 24 kHz
 -> Speaches 16 kHz
```

Future:

```text
source PCM16 + actual sample rate
        │
        ▼
AudioFormatRouter
        │
        ├ 16 kHz stream -> VAD
        ├ 16 kHz stream -> streaming Parakeet EOU
        ├ 24 kHz stream -> legacy Speaches
        └ canonical PCM -> batch final
```

Requirements:

- one stateful resampler per destination rate;
- never reset resampler at packet boundaries;
- share converted streams when consumers require the same format;
- move provider-specific rate requirements into adapter capabilities.

---

# 47. Canonical internal events

Frontend/call logic should not depend on:

```text
Silero internals
TEN internals
FireRed frame structs
<EOU> token ID
<EOB> token ID
OpenAI server_vad event spelling
```

Adapters normalize them.

Suggested internal events:

```text
AcousticActivityStarted
AcousticActivityEnded

TranscriptPartial
TranscriptFinal

EndpointHint(
  source = vad | native_asr | manual | timeout,
  kind   = utterance | backchannel
)

TurnStarted
TurnFinalized

VoiceDegraded
```

The external frontend wire can initially remain backward-compatible:

```json
{"type":"speech_started","item_id":"..."}
{"type":"speech_stopped","item_id":"..."}
{"type":"transcript","item_id":"...","text":"...","final":true}
```

This allows a backend redesign with limited React/reducer churn.

---

# 48. Peer patterns worth preserving

## LiveKit

Good ideas:

- one independent VAD stream per audio stream;
- recurrent state;
- min speech;
- min silence;
- pre-roll;
- activation/deactivation hysteresis.

---

## Pipecat

Good ideas:

- explicit `QUIET -> STARTING -> SPEAKING -> STOPPING` state;
- time-based onset confirmation;
- confidence and loudness are separate evidence.

Do not blindly copy its exact volume default because its loudness metric differs from ctrl-b's dBFS gate.

---

## RealtimeSTT

Good ideas:

- pre-roll;
- stateful Silero;
- separate live and final ASR models.

---

## OpenWebUI

Useful negative lesson:

- fixed analyser threshold;
- first sound immediately starts capture;
- no real onset sustain.

Do not simplify ctrl-b to that.

---

# 49. Observability requirements

Before and during migration, debug output should make a false turn explainable without reading five modules.

---

## 49.1 Capture line

Record:

```text
route requested
route effective
device
echo cancellation
noise suppression
AGC
channel count
track sample rate
AudioContext sample rate
```

---

## 49.2 Segment line

Record:

```text
turn/segment ID
VAD engine/version
VAD thresholds/config
candidate duration
VAD probability summary
start sample/time
end sample/time
pre-roll included
raw duration
relative-energy ms
noise floor
voice level
effective floor
endpoint source
ASR live provider
ASR final provider
final text length/text if debug policy allows
rejection reason
```

---

## 49.3 Debug audio

Optional only.

Local, short, bounded WAVs around relevant events.

Requirements:

```text
OFF by default
explicit debug enable
retention cap
local only
short windows
```

This is the fastest truth source for distinguishing:

```text
noise
echo
radio
distant person
owner
```

---

# 50. VAD offline bake-off

Do not choose the final VAD from upstream F1 alone.

Replay identical recordings through:

```text
persistent Silero
FireRed Stream-VAD
TEN native
optional newer Silero generation
```

Use the same Control-B `TurnController` over each observation stream.

---

## 50.1 Negative corpus

At minimum:

```text
quiet parked EV       5 min
moving EV             5 min
noisy combustion car  5 min
quiet room             5 min
HVAC
indicator
road bumps
phone handling
door close
music
radio
assistant TTS leak
digital silence
```

---

## 50.2 Positive corpus

At least 20 samples each:

```text
yes
no
yeah
mm-hmm
okay
```

plus:

```text
quiet normal speech
normal speech
driving speech
hesitant speech
long pauses
short clauses
speech overlapping playback
```

---

# 51. VAD metrics

Priority order:

1. **false accepted/committed user turns per minute**
2. short-answer recall
3. first-phoneme clipping
4. end latency
5. start latency
6. WER of the ASR when fed the resulting slices

Do not choose the detector on raw F1 alone.

A small latency penalty is acceptable if it materially removes false turns.

---

# 52. ASR runtime bake-off

Feed **the same finalized utterance files** to:

```text
current Speaches/onnx-asr
parakeet.cpp CPU
parakeet.cpp Vulkan
CrispASR
sherpa-onnx
```

Durations:

```text
0.3
0.5
1
3
5
10 seconds
```

Measure:

```text
p50 latency
p95 latency
CPU
GPU
RAM
shared VRAM
cold/warm load
text parity/WER
empty-final rate
```

---

# 53. Native EOU bake-off

English-only experimental arm:

```text
selected VAD
+
Parakeet Realtime EOU live lane
+
Parakeet v3 final lane
```

Measure:

```text
false EOU
missed EOU
EOU latency
EOB correctness/usefulness
fallback silence frequency
final correction latency
conversation feel
```

Especially test:

```text
"mm-hmm"
"yeah"
"uh-huh"
```

while the assistant is speaking.

---

# 54. Acceptance criteria

## No-owner-speech car recording

For a five-minute negative recording:

```text
accepted false user turns = 0
```

Raw unconfirmed VAD candidate activity is acceptable.

---

## Short answers

Suggested initial target:

```text
>= 95% detection/turn recall
no systematic first-phoneme clipping
```

This can be refined after collecting enough samples.

---

## Echo

Assistant playback must not become an accepted user turn under the shipping route/mic-hold policy.

---

## Latency

Measure both objectively and subjectively.

A ~150–250 ms onset confirmation can be acceptable if pre-roll prevents clipping.

Native EOU should be judged on real conversational feel, not just an endpoint timestamp.

---

# 55. Migration plan

---

## Phase 0 — pin reality

Before code changes:

```text
ctrl-b SHA
deployed local Speaches SHA
local Speaches diff
onnx_asr version
model IDs
deployed ctrl-b version
```

Capture one quiet-EV debug reproduction.

---

## Phase 1 — instrumentation

Add:

```text
NS/AGC/channel/sample rate readback
DC-removed RMS diagnostic
per-segment VAD reason
optional bounded WAV
```

No threshold behavior change.

---

## Phase 2 — introduce interfaces without behavior change

Implement domain contracts:

```text
VadEngine
VadSession
BatchAsr
StreamingAsr
AsrCapabilities
EndpointStrategy
TurnController
```

Legacy Speaches remains selected.

---

## Phase 3 — persistent Silero shadow mode

Feed the same live PCM to:

```text
Speaches current VAD
new persistent Silero
```

Do not submit the new detector's turns.

Log divergence.

This is the most rigorous root-cause confirmation.

---

## Phase 4 — make Control B VAD authoritative

Use:

```text
Control-B TurnController + persistent VAD
```

but keep the existing final ASR temporarily.

This isolates the VAD change.

---

## Phase 5 — VAD bake-off

Offline + shadow:

```text
Silero
FireRed
TEN
```

Choose from target-environment data.

---

## Phase 6 — batch ASR migration

A/B:

```text
parakeet.cpp CPU
parakeet.cpp Vulkan
sherpa
CrispASR
```

Select through provider configuration.

---

## Phase 7 — optional streaming-ASR lane

Add `StreamingAsr`.

Prototype Parakeet EOU using:

```text
FFI
or tiny sidecar
```

Use hybrid endpointing initially.

---

## Phase 8 — simplify only after field validation

Possible later removals:

```text
Speaches-specific 3 s flush rules
D80 Speaches flap cut
legacy live Speaches adapter
```

Do not remove safety belts in the same release that introduces new endpointing.

---

# 56. Concrete coding tickets

## T1 — deployment/source pin

Produce one machine-readable debug/header block with:

```text
ctrl-b SHA
Speaches SHA
Speaches dirty status
onnx_asr version
VAD model
ASR model
```

---

## T2 — mic readback

Extend the current readback/trail:

```text
NS
AGC
channels
sample rate
```

---

## T3 — VAD domain interface

Add pure types/protocols.

No production behavior change.

---

## T4 — ASR capability model

Define:

```text
batch
streaming
partials
native_endpointing
backchannel_events
timestamps
confidence
punctuation
capitalization
languages
sample rates
```

---

## T5 — endpoint strategy

Implement/validate:

```text
vad
native
hybrid
manual
auto
```

---

## T6 — provider-agnostic audio format router

Keep legacy Speaches conversion working while moving new paths away from `SPEACHES_WIRE_RATE`.

---

## T7 — persistent Silero adapter

Per call:

```text
one recurrent state
sequential frames
clean reset
probability/activity output
```

No 3-second zero-state rescans.

---

## T8 — TurnController

Own:

```text
pre-roll
candidate onset
speech-active state
end silence
turn buffer
turn ID
endpoint reason
hard timeout
```

---

## T9 — shadow comparison

Trail current upstream Speaches events beside new-controller events.

---

## T10 — offline corpus harness

Input WAV.

Output JSONL:

```text
timestamp
VAD probability
activity
candidate state
start
stop
finalized region
```

---

## T11 — FireRed adapter

Same `VadEngine` contract.

---

## T12 — TEN adapter

Test native official runtime.

Record license note.

Optionally test sherpa TEN separately.

---

## T13 — final batch ASR adapters

Ensure final transcription can target:

```text
legacy Speaches
parakeet.cpp
CrispASR
sherpa
existing cloud OpenAI-compatible providers
```

---

## T14 — parakeet.cpp batch prototype

CPU + Vulkan target benchmark.

---

## T15 — parakeet.cpp streaming adapter

Map:

```text
stream text
EOU
EOB
word/confidence
```

to canonical events.

---

## T16 — dual live/final lane

Support:

```text
live_asr != final_asr
```

---

## T17 — streaming failure recovery

If live ASR fails:

```text
retain turn PCM
continue VAD
batch final
reopen live next turn
```

---

## T18 — legacy cleanup

Only after evidence.

---

# 57. Prototype/install references

These are prototype notes, not hard-coded production requirements.

---

## 57.1 parakeet.cpp

Latest checked release:

```text
v0.5.0
```

Batch server:

```powershell
.\parakeet-server.exe --model tdt-0.6b-v3 --port 8080
```

HTTP:

```text
POST /v1/audio/transcriptions
```

Windows release variants include CPU and Vulkan.

For native streaming EOU use the **shared C API**, not the batch HTTP server.

---

## 57.2 CrispASR

Latest checked release:

```text
v0.8.37
```

Prototype concept:

```powershell
.\crispasr.exe `
  --server `
  --backend parakeet `
  -m auto `
  --auto-download `
  --host 127.0.0.1 `
  --port 8080
```

Verify exact release CLI with `--help`.

HTTP:

```text
/v1/audio/transcriptions
```

Do not assume current realtime WebSocket supports Parakeet; current docs say that vLLM Realtime endpoint is Whisper-only.

---

## 57.3 sherpa-onnx

CPU install:

```powershell
pip install sherpa-onnx sherpa-onnx-bin
```

Good for:

```text
VAD experiments
one-process Parakeet INT8 experiment
```

---

## 57.4 RealtimeSTT

```powershell
python -m pip install "RealtimeSTT[server,sherpa-onnx]"
stt-install-sherpa-models --root models/sherpa-onnx --model all
```

Useful as an external benchmark/reference architecture.

---

## 57.5 FireRedVAD

```bash
pip install fireredvad
```

Download the model according to upstream README and use `FireRedStreamVad`.

CPU first.

---

## 57.6 TEN VAD

Use the official native/ONNX runtime appropriate to platform.

Review its custom license before choosing it as a long-term distributed dependency.

---

# 58. Recommended likely production architecture

```text
┌─────────────────────────────────────────────────────┐
│ ctrl-b backend                                      │
│                                                     │
│  AudioIngress                                       │
│       │                                             │
│       ▼                                             │
│  AudioFormatRouter                                  │
│       │                                             │
│       ├────────────► VadSession                     │
│       │                 │                           │
│       ├────────────► optional StreamingAsr          │
│       │                 │                           │
│       ▼                 ▼                           │
│               TurnController                        │
│                    │                                │
│             canonical turn PCM                      │
│                    │                                │
│                    ▼                                │
│                BatchAsr                             │
│                    │                                │
│                    ▼                                │
│             final transcript                        │
│                    │                                │
│                    ▼                                │
│          existing call reducer/agent                │
└─────────────────────────────────────────────────────┘

Optional side process:
    parakeet.cpp
```

No dedicated VAD server is required.

---

# 59. Recommended first production combination

Before native EOU:

```text
VAD:
  persistent Silero baseline
  or FireRed if the real corpus clearly wins

Endpoint:
  VAD-driven TurnController

Final ASR:
  Parakeet TDT 0.6B v3

Runtime:
  parakeet.cpp CPU or Vulkan
  chosen from target-machine short-clip benchmark

Existing:
  level gate
  echo/tail
  D80 gap safety
  call state
  all retained
```

---

# 60. Recommended advanced English combination

After baseline stability:

```text
VAD:
  selected best detector

Live ASR:
  Parakeet Realtime EOU 120M

Endpoint:
  hybrid
    VAD opens acoustic activity
    EOU closes quickly
    silence timeout is fallback

Final ASR:
  Parakeet TDT 0.6B v3

Backchannel:
  preserve EOB distinctly
```

This tests native turn intelligence without sacrificing an authoritative final transcript.

---

# 61. Existing ctrl-b choices worth preserving

Do not throw away good architecture while fixing the bad boundary.

Preserve:

1. browser reports real sample rate;
2. resampler state survives packet boundaries;
3. bounded client/relay backpressure;
4. media path is separate from chat path;
5. call configuration snapshots at start;
6. segment IDs;
7. relative dBFS gate;
8. echo/tail model;
9. call debug trail;
10. generic final STT provider abstraction.

---

# 62. Explicit anti-recommendations

Do **not**:

- blacklist `Yeah`, `Mm-hmm`, `Okay`, `No`;
- raise Silero to 0.9 as the main fix;
- make ASR token/logprob confidence the sole gate;
- use one absolute dBFS threshold as VAD;
- rewrite WebSocket transport first;
- add a heavy denoiser before capturing evidence;
- deploy VAD as a separate service merely because it is a model;
- write `if model_name == ...` branches for EOU;
- let both an external framework and ctrl-b independently own turn boundaries;
- switch VAD architecture + VAD model + ASR runtime + ASR model at once;
- remove D80 safety belts during the first migration release.

---

# 63. Open questions that need experiments, not more reading

1. Which VAD wins on the actual EV/noisy-car corpus?
2. Does newer Silero beat the currently understood generation on this hardware?
3. Does FireRed's published false-alarm advantage survive Android car audio?
4. Does TEN's faster endpoint behavior survive without increased false turns?
5. What onset confirmation duration preserves real `yes` while killing transients?
6. What is the best end-silence value when native EOU is absent?
7. Does browser NS help or hurt on this exact phone/car?
8. What AGC setting is actually granted on each route?
9. Does 780M Vulkan beat CPU for 0.3–5 s Parakeet requests?
10. Is EOB reliably useful for the user's acknowledgments?
11. How much latency does final Parakeet-v3 correction add after native EOU?
12. What exact audio produced the newest quiet-EV false turn?

---

# 64. New coding-agent starting sequence

A fresh coding agent should **not** start by editing thresholds.

Start in this order.

### Step 1 — pin deployed reality

```text
ctrl-b SHA
local Speaches SHA/diff
runtime/model versions
```

### Step 2 — instrumentation

Make one new car event explainable.

### Step 3 — define contracts

```text
VadEngine
BatchAsr
StreamingAsr
AsrCapabilities
EndpointStrategy
TurnController
```

No behavior change yet.

### Step 4 — persistent Silero shadow

Compare it live against Speaches.

### Step 5 — build replay harness

Use the same recordings for all VADs.

### Step 6 — make ctrl-b endpointing authoritative

Keep final ASR unchanged initially.

### Step 7 — evaluate FireRed/TEN

Choose from real data.

### Step 8 — migrate final ASR runtime

CPU/Vulkan bake-off.

### Step 9 — optional native EOU lane

Hybrid first.

This ordering keeps each experiment interpretable.

---

# 65. Source/version index

## ctrl-b

Repository:

```text
nengoxx/ctrl-b
```

Audited SHA:

```text
778b9608915af82fe8002132cfe17386c9a8cea1
```

Key paths:

```text
frontend/src/lib/pcmWorklet.ts
frontend/src/lib/pcmCapture.ts
frontend/src/lib/levelGate.ts
frontend/src/hooks/useLiveCall.ts
frontend/src/lib/liveSocket.ts

backend/app/services/voice_live.py
backend/app/core/audio.py
backend/app/config.py
backend/app/domain/provider.py
backend/app/core/provider_registry.py

backend/tests/test_voice_live_s1.py

docs/research/R76-noise-hallucination-gating.md
docs/research/R83-portable-energy-floor.md
docs/research/R84-silero-threshold-calibration.md
docs/research/R86-live-call-e2e-audit.md
docs/research/R91-ear-reopen-latency-and-text-echo.md
docs/research/R92-live-call-noise-robustness.md
docs/research/R93-echo-envelope-delay-estimation.md
```

---

## Speaches

Public repository:

```text
nengoxx/speaches
```

Re-verified SHA:

```text
a8116598d394e70ff70bfc610283fd752b10bdbc
```

Key paths:

```text
src/speaches/realtime/input_audio_buffer_event_router.py
src/speaches/realtime/input_audio_buffer.py
src/speaches/executors/silero_vad_v5.py
src/speaches/executors/parakeet.py
src/speaches/routers/stt.py
```

Remember: deployed local fork may differ.

---

## parakeet.cpp

Repository:

```text
mudler/parakeet.cpp
```

Current checked source SHA:

```text
238057cb707fdb6c4b185c853da095328930b539
```

Latest checked release:

```text
v0.5.0
2026-08-01
```

Relevant:

```text
examples/server/README.md
include/parakeet_capi.h
src/streaming.cpp
```

---

## CrispASR

Repository:

```text
CrispStrobe/CrispASR
```

Checked SHA:

```text
391fe51bfe7705404fb610ea23c67b5794f27bdb
```

Latest checked release:

```text
v0.8.37
2026-09-25
```

Relevant:

```text
docs/server.md
docs/streaming.md
src/crispasr_vad.cpp
examples/server/realtime_server.*
```

---

## RealtimeSTT

Repository:

```text
KoljaB/RealtimeSTT
```

Checked SHA:

```text
777727553eedfa19aead15337ce66bab549add3f
```

Relevant:

```text
RealtimeSTT/core/voice_activity.py
docs/engines/sherpa-onnx.md
RealtimeSTT_server/PRODUCTION_SERVER.md
docs/installation.md
```

---

## sherpa-onnx

Repository:

```text
k2-fsa/sherpa-onnx
```

Checked SHA:

```text
040afe360a38e25daaa325ce8889abf93ea02609
```

Relevant:

```text
sherpa-onnx/csrc/voice-activity-detector.cc
sherpa-onnx/csrc/silero-vad-model.cc
sherpa-onnx/csrc/ten-vad-model.cc
```

---

## FireRedVAD

Repository:

```text
FireRedTeam/FireRedVAD
```

Checked SHA:

```text
c30ec49e8cc69642b0ee65362eba11b9d11c6e54
```

License:

```text
Apache-2.0
```

---

## TEN VAD

Repository:

```text
TEN-framework/ten-vad
```

Checked SHA:

```text
22a3bcd4509d0faaa8eef4881e8af5f39c178950
```

License:

```text
Apache-2.0 text + additional deployment restrictions
```

---

## NVIDIA Parakeet Realtime EOU

Model:

```text
nvidia/parakeet_realtime_eou_120m-v1
```

Checked properties:

```text
streaming
native EOU
English-only
no punctuation
no capitalization
voice-agent low-latency target
```

---

# 66. Final engineering recommendation

There are two distinct goals.

## Immediate bug goal

Stop letting a moving-window zero-state batch Silero pass define realtime user turns.

The smallest durable fix is:

```text
persistent streaming VAD
+ sustained onset confirmation
+ pre-roll
+ proper silence/hysteresis
```

## Long-term architecture goal

Do not encode “Silero” or “Parakeet” into the live-call architecture.

Make Control B own:

```text
media ingress
audio-format routing
canonical turn PCM
turn state
endpoint policy
canonical voice events
capability resolution
failure recovery
debuggability
```

Let providers own only:

```text
VAD:
  acoustic speech evidence

Streaming ASR:
  partial text and optional endpoint/backchannel hints

Final ASR:
  authoritative transcription
```

That makes all of the following configuration choices rather than rewrites:

```text
Silero + Parakeet v3
FireRed + Parakeet v3
TEN + Parakeet v3
Silero + cloud Whisper
FireRed + CrispASR
Silero + Parakeet EOU + Parakeet-v3 final
no VAD + native EOU
manual push-to-talk + any final ASR
```

The recommended migration sequence is deliberately conservative:

```text
instrument
 -> persistent VAD shadow
 -> ctrl-b owns endpointing
 -> VAD bake-off
 -> batch ASR runtime bake-off
 -> optional streaming/EOU lane
 -> remove legacy coupling only after field evidence
```

This both addresses the current false-turn bug and prevents the next external speech backend from silently becoming the owner of Control B's conversation semantics.

---

# 67. Handoff status

**ctrl-b source audit:** re-verified at pinned SHA.  
**public Speaches realtime VAD defect:** re-verified at current public SHA.  
**transport diagnosis:** no leading corruption defect found.  
**D80 short-gap mitigation:** re-verified.  
**relative level gate:** re-verified.  
**VAD alternatives:** re-checked.  
**batch ASR alternatives:** re-checked.  
**parakeet.cpp streaming EOU/EOB API:** re-checked, including tagged v0.5.0.  
**backend/VAD-agnostic design:** consolidated above.  
**newest quiet-EV false event:** exact attribution still requires one instrumented field reproduction.  
**project files modified during audit:** none.
