# ctrl-b Live Voice Architecture — Revised VAD / ASR Plan

**Date:** 2026-09-28  
**Repository:** `nengoxx/ctrl-b`  
**Context:** revision of the previous Speaches/Parakeet migration plan after a dedicated VAD + ASR+VAD survey  
**Primary requirement:** eliminate false user turns/hallucination-triggering segmentation while preserving very short genuine answers, low latency, multilingual Parakeet v3 functionality, local operation, and Windows/Ryzen compatibility.

---

## 1. Revised conclusion

The best architecture is **not** “replace Speaches with another monolithic realtime speech server”.

The best architecture for ctrl-b is:

```text
Browser microphone
        │
        ▼
ctrl-b media WebSocket
        │
        ▼
┌─────────────────────────────────────────────┐
│ CTRL-B TURN-INGRESS                         │
│                                             │
│  resample → acoustic VAD → temporal policy  │
│                  │              │           │
│                  │              ├ onset     │
│                  │              ├ pre-roll  │
│                  │              ├ silence   │
│                  │              └ max turn  │
│                  ▼                          │
│        completed utterance buffer           │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
             ASR adapter
                   │
         ┌─────────┴─────────┐
         │                   │
   parakeet.cpp          alternative
    Parakeet v3            backend
         │
         ▼
    final transcript
         │
         ▼
existing ctrl-b admission / echo / call state
```

The crucial design revision is:

> **ctrl-b should own the VAD interface and the temporal segmentation policy, but the acoustic VAD model should be pluggable.**

Do **not** weld ctrl-b permanently to Silero.

Implement one `VadEngine` seam and test at least:

1. **Silero VAD** — production baseline
2. **FireRedVAD Stream-VAD** — quality challenger
3. **TEN VAD** — latency/size challenger

against the exact same car/room recordings.

---

# 2. Why this is better than an ASR+VAD package

ctrl-b already owns:

- microphone capture;
- continuous PCM;
- resampling;
- an adaptive noise / voice level model;
- echo/tail protection;
- call state;
- segment IDs;
- debug trails;
- reconnect / backpressure handling.

A full voice framework such as RealtimeSTT or CrispASR would own many of those concerns again.

That creates two policy layers:

```text
external voice framework decides what a turn is
             +
ctrl-b decides what a turn is
```

That is exactly the kind of architecture that made the current Speaches problem difficult to reason about.

The ASR package should ideally have one simple contract:

```text
audio utterance in
text out
```

---

# 3. Important correction to the earlier recommendation

The earlier plan proposed “persistent Silero inside ctrl-b” as the final architecture.

That is still a good **implementation baseline**, but it is too specific as an architectural contract.

The revised contract should be:

```python
class VadEngine(Protocol):
    def reset(self) -> None: ...
    def feed(self, pcm16_16k: bytes) -> VadObservation: ...
```

where:

```python
@dataclass
class VadObservation:
    speech_probability: float | None
    active: bool
```

The **model adapter** should not decide:

- the user turn ID;
- whether the agent is interrupted;
- whether a final is accepted;
- how much pre-roll is retained;
- whether the transcript is submitted.

Those are ctrl-b policies.

---

# 4. Separate “acoustic VAD” from “turn policy”

This distinction is fundamental.

## Acoustic VAD

Question:

> Does this small frame acoustically resemble human speech?

Possible engines:

```text
Silero
TEN VAD
FireRedVAD
WebRTC VAD
```

## Turn policy

Question:

> Has enough convincing speech occurred to open a user turn, and has enough silence occurred to close it?

ctrl-b should own this.

Example:

```text
QUIET
  │
  │ acoustic speech evidence
  ▼
CANDIDATE
  │
  │ sustained for start_confirm_ms
  ▼
SPEAKING
  │
  │ sustained acoustic silence for end_silence_ms
  ▼
FINALIZE
```

with a pre-roll ring that preserves audio from before confirmation.

This means switching:

```text
Silero → FireRed
```

does not change call semantics.

---

# 5. Candidate A — Silero VAD

## Status

**Recommended production baseline.**

Not because it is mathematically proven to be the best VAD, but because it is the best risk-adjusted starting point.

## Strengths

- very mature;
- widely deployed in realtime voice agents;
- permissive MIT license;
- tiny CPU cost;
- native recurrent streaming state;
- 8/16 kHz;
- excellent portability;
- well understood thresholds/hysteresis;
- strong external implementation examples.

LiveKit's current production Silero integration exposes exactly the primitives ctrl-b needs:

```text
min_speech_duration
min_silence_duration
prefix_padding_duration
activation_threshold
deactivation_threshold
```

and processes roughly one VAD update every 32 ms.

## Important: the Speaches bug is NOT “Silero is bad”

Speaches currently calls a **batch speech-timestamp function over a moving 3-second window**.

That is not how Silero is intended to operate as a live detector.

A proper Silero realtime implementation carries recurrent state forward for every frame.

That is what LiveKit, Pipecat and sherpa-onnx do.

## Why start with the same model generation

The production Speaches fork currently uses a Silero-v5-derived implementation.

For the first architecture A/B, use **Silero v5** or a byte-equivalent known model.

That gives the clean experiment:

```text
same acoustic model
old stateless/rescanned architecture
versus
new persistent streaming architecture
```

If hallucinations disappear, we have isolated the architecture.

Do not simultaneously move to Silero v6 and claim we proved why it improved.

## Silero v6 later

Silero v6 is worth testing later, but user reports and upstream issues show its probability calibration can differ substantially from v5.

Therefore:

```text
v5 threshold != automatically valid v6 threshold
```

Tune v6 as a new detector.

---

# 6. Candidate B — FireRedVAD

Repository:

https://github.com/FireRedTeam/FireRedVAD

## Status

**Most interesting quality challenger.**

FireRedVAD was released as a standalone project in 2026.

It supports:

```text
streaming VAD
offline VAD
audio-event detection
100+ languages
CPU operation
```

The model is about 0.57M parameters / ~2.2 MB float32.

## Published quality

The FireRed team reports on FLEURS-VAD-102:

```text
                 F1       False alarm     Miss
FireRedVAD      97.57%       2.69%        3.62%
Silero          95.95%       9.41%        3.95%
TEN             95.19%      15.47%        2.95%
WebRTC          52.30%       2.83%       64.15%
```

This makes FireRedVAD extremely interesting for the ctrl-b failure mode because **false alarms** are exactly what hurt us.

## But do not crown it from this table

The limitations matter:

- it is the model author's own benchmark;
- FLEURS-VAD-102 is multilingual speech/VAD data, not a car-specific benchmark;
- our dominant false-positive distribution includes road/HVAC/Android processing/echo;
- the project is much younger than Silero;
- fewer independent production reports exist.

Therefore:

> FireRed is the model I would most want to beat Silero in our own test corpus.

If it does, use it.

---

# 7. Candidate C — TEN VAD

Repository:

https://github.com/TEN-framework/ten-vad

## Status

**Strong latency/efficiency challenger; do not assume best accuracy.**

TEN VAD is explicitly designed for realtime voice agents.

Published characteristics include:

```text
16 kHz
10/16 ms hop options
very small native library
low CPU RTF
fast speech→silence transition
cross-platform support
```

Its project benchmark reports lower compute and better precision than older Silero/WebRTC configurations.

## Excellent property for ctrl-b

Its temporal resolution is attractive for conversational latency.

A detector that responds faster to speech→silence can let us lower perceived end-of-turn latency without blindly shrinking ctrl-b's silence policy.

## Important sherpa-onnx caveat

Do **not** use sherpa-onnx's TEN implementation as the only quality evaluation.

The current sherpa-onnx source explicitly sets TEN VAD's expected pitch feature to zero:

```cpp
features_.back() = 0;
```

and comments:

```text
"This may reduce performance"
```

So:

```text
TEN native result
≠ necessarily sherpa TEN result
```

For a true TEN-vs-Silero benchmark, test TEN's official runtime/preprocessing too.

## Licensing

TEN VAD is Apache-2.0 **with additional conditions**, not plain Apache-2.0.

Review this before choosing it as a long-term shipped dependency.

For a private ctrl-b installation this is unlikely to be operationally painful, but it is a reason Silero is cleaner from a dependency-governance perspective.

---

# 8. Candidate D — WebRTC VAD

## Status

**Not recommended as primary VAD.**

Advantages:

```text
extremely cheap
old/stable
simple
```

Problems:

```text
binary output
limited acoustic model
poor noisy-environment behavior
frequent false positives in non-speech sounds
```

Independent reproducible VAD testing on noisy/ESC-50 data found WebRTC dramatically more prone to non-speech activation than Silero.

ctrl-b's Ryzen CPU does not need to save the tiny amount of compute that would justify accepting that quality trade.

## Optional role

A WebRTC/energy detector can be used as a cheap *wake hint* before a neural model.

I do **not** recommend doing this initially.

Silero/FireRed/TEN are already so cheap that a two-stage CPU optimization would mainly add state and edge cases.

---

# 9. Candidate E — pure energy / RMS detector

## Status

**Never primary.**

Keep RMS/SNR as a *different type of evidence*.

It answers:

> Is this signal close/loud relative to the learned room and owner?

It does not answer:

> Is this speech?

This distinction is why ctrl-b's existing adaptive level gate remains useful even after replacing Speaches.

---

# 10. Two-stage VAD: should ctrl-b use one?

There are two possible meanings.

## Bad two-stage design

```text
WebRTC says speech
      ↓
Silero runs
```

This mostly saves a negligible amount of CPU and creates another detector whose false negatives can hide speech.

Not recommended.

## Useful multi-evidence design

```text
neural VAD
     +
adaptive near-field energy evidence
```

These signals answer different questions.

Recommended policy:

```text
Acoustic VAD:
  determines candidate speech timing

Relative energy:
  corroborates that a completed segment plausibly came from the nearby owner

Echo/tail:
  rejects own playback

ASR:
  converts accepted utterance audio to text
```

Keep these independent in telemetry.

Do not collapse everything into one magic `confidence`.

---

# 11. ASR+VAD / EOU solutions

## 11.1 RealtimeSTT

### Good

RealtimeSTT has a significantly healthier VAD design than Speaches:

- streaming/stateful Silero;
- WebRTC + Silero confirmation;
- pre-roll;
- minimum recording duration;
- post-speech silence;
- Parakeet via sherpa-onnx.

### Why it is not preferred

It would duplicate several ctrl-b responsibilities:

```text
capture/session policy
segmentation
pre-roll
turn lifecycle
stream transport
```

Using a large framework to fix one bad VAD implementation is unnecessary when ctrl-b already has the media/control architecture.

**Recommendation:** useful reference implementation and fallback prototype, not default architecture.

---

## 11.2 CrispASR full streaming stack

### Good

Current CrispASR has:

- multiple VAD engines;
- minimum speech duration;
- utterance IDs;
- partial/final events;
- HTTP + WebSocket;
- Parakeet;
- Vulkan support.

### Why not default to the whole thing

For ordinary Parakeet v3, CrispASR's generic streaming path still uses rolling decode windows rather than true native streaming Parakeet.

And we would once again outsource turn semantics to a large multipurpose stack.

**Recommendation:** excellent ASR backend candidate; do not initially outsource ctrl-b endpointing to it.

---

## 11.3 Parakeet Realtime EOU 120M

Model:

```text
nvidia/parakeet_realtime_eou_120m-v1
```

This is a genuinely interesting different architecture.

It performs native streaming ASR and emits an `<EOU>` token.

Reported latency is approximately:

```text
80–160 ms
```

This can eliminate the classic VAD silence timer for end-of-turn.

### Why it is not the default ctrl-b replacement

It currently supports:

```text
English only
no punctuation
no capitalization
```

ctrl-b currently has access to multilingual Parakeet v3.

Changing to this model means losing functionality.

It also changes ASR quality/model behavior at the same time as endpointing.

**Recommendation:** experimental English-only low-latency arm, not production migration baseline.

---

## 11.4 Nemotron streaming

NVIDIA's newer streaming ASR family is technically compelling and includes a multilingual 40-locale Nemotron 3.5 model.

But NVIDIA's own voice-agent guidance distinguishes native EOU Parakeet from streaming ASR models whose turn end still uses VAD.

So this does **not** remove the architectural need for an acoustic turn detector.

It is an ASR alternative, not the fix to this bug.

---

# 12. A surprisingly strong deployment option: sherpa-onnx in-process

sherpa-onnx currently supports in one native runtime:

```text
Silero VAD
TEN VAD
Parakeet TDT 0.6B v3 INT8
```

The Python API exposes a stateful `VoiceActivityDetector`.

Its current C++ source confirms:

- Silero recurrent hidden state is persisted frame to frame;
- minimum speech duration is enforced;
- minimum silence duration is enforced;
- threshold hysteresis is present;
- completed segments are queued;
- current speech is visible before completion.

This is fundamentally different from Speaches' moving-window rescan.

## Operational advantage

This could make ctrl-b:

```text
one Python backend process
+
sherpa-onnx native library
+
Silero
+
Parakeet
```

with no second server.

## Drawback

Parakeet performance should be benchmarked.

The published sherpa example for v3 INT8 is CPU-only and not necessarily as fast as `parakeet.cpp` on this Ryzen/780M setup.

sherpa's standard Windows/Python provider story is primarily CPU or NVIDIA CUDA, not the Vulkan path available in parakeet.cpp.

## Recommendation

Treat this as the **simplicity candidate**:

```text
Architecture S:
ctrl-b + sherpa-onnx VAD + sherpa-onnx Parakeet
```

versus:

```text
Architecture P:
ctrl-b VAD + parakeet.cpp ASR
```

---

# 13. Preferred ASR backend remains parakeet.cpp

For the target machine, `parakeet.cpp` still has the best hardware story:

```text
CPU
Vulkan
Ryzen APU explicitly supported through ggml device selection
```

Its HTTP server is intentionally simple.

That is a feature for this use case.

The preferred separation is:

```text
ctrl-b = intelligence around WHEN to transcribe
parakeet.cpp = WHAT was said
```

The HTTP process boundary also gives:

- ASR crash isolation;
- easy CPU/Vulkan A/B;
- restart/reload without touching the call server;
- easy replacement later.

For one user, local HTTP overhead is negligible compared with model inference.

---

# 14. Should Silero itself be a second server?

**No.**

There is no reason to deploy:

```text
ctrl-b
   → VAD HTTP server
   → ASR HTTP server
```

A VAD processes one tiny frame every ~16–32 ms and maintains a tiny amount of state.

It belongs in the ctrl-b process.

Use a separate service only for a relatively heavy/replaceable inference engine such as Parakeet if desired.

---

# 15. Recommended software design

## 15.1 VAD engine interface

```python
class VadEngine(Protocol):
    frame_samples: int

    def reset(self) -> None:
        ...

    def probability(self, pcm16k: memoryview) -> float:
        ...
```

Adapters:

```text
SileroVad
FireRedVad
TenVad
```

The adapter should expose **acoustic evidence only**.

---

## 15.2 Turn segmenter

One ctrl-b-owned class:

```python
class TurnSegmenter:
    vad: VadEngine
    state: QUIET | CANDIDATE | SPEAKING
    preroll: RingBuffer
    speech_run_ms: int
    silence_run_ms: int
    utterance: AudioBuffer
```

This class owns:

```text
start_confirm_ms
end_silence_ms
prefix_ms
max_utterance_ms
segment IDs
```

Not the VAD implementation.

---

## 15.3 ASR interface

```python
class AsrEngine(Protocol):
    async def transcribe(
        self,
        pcm16: bytes,
        *,
        sample_rate: int,
        language: str | None = None,
    ) -> str:
        ...
```

Adapters:

```text
ParakeetCppAsr
SherpaParakeetAsr
CrispParakeetAsr
LegacySpeachesAsr
```

---

# 16. Recommended event contract

The browser should continue seeing roughly:

```json
{"type":"speech_started","item_id":"..."}
{"type":"speech_stopped","item_id":"..."}
{"type":"transcript","item_id":"...","text":"...","final":true}
```

Therefore the frontend call state machine does **not** need an architectural rewrite.

Only the backend producer of those events changes.

---

# 17. Pre-roll is mandatory

A minimum-speech/onset confirmation period without pre-roll clips the first phoneme.

This is not theoretical; sherpa-onnx has an open request describing exactly the tradeoff:

```text
increase min speech → fewer noise hallucinations
but → clip the beginning of real speech
```

ctrl-b should solve it structurally.

Keep a ring buffer even while `QUIET`.

On confirmation:

```text
segment =
    prefix audio
    +
    candidate speech
    +
    following speech
```

Suggested initial:

```text
prefix = 300–500 ms
```

The buffer should use timestamps/sample positions, not wall-clock reconstruction.

---

# 18. Recommended first-turn policy

Do not reuse a magic number blindly.

Start with a controlled sweep:

```text
start_confirm_ms:
  100
  150
  200
  250

end_silence_ms:
  500
  700
  900
```

Likely practical centre:

```text
start_confirm ≈ 200 ms
end_silence ≈ 700 ms
prefix ≈ 350 ms
```

But the real car corpus chooses the winner.

---

# 19. Semantic turn detection?

A semantic turn detector answers:

> Did the user finish the *thought*?

It can help with:

```text
long thinking pauses
hesitations
premature response
```

It does **not** solve:

```text
road noise incorrectly classified as speech
```

Therefore it is Phase 2.

Possible future pipeline:

```text
acoustic VAD
    ↓
ASR
    ↓
semantic endpoint / turn detector
    ↓
agent
```

Do not put semantic turn detection ahead of fixing acoustic admission.

---

# 20. Final candidate matrix

| Option | False-trigger potential | Latency | Maturity | Windows/Ryzen | Complexity | Role |
|---|---|---|---|---|---|---|
| Silero v5 persistent | Strong | Strong | Excellent | Excellent CPU | Low | **baseline** |
| Silero v6 persistent | potentially stronger, retune needed | Strong | Very good | Excellent CPU | Low | later A/B |
| FireRed Stream-VAD | **very promising** | Strong | New | CPU viable | Medium | **quality challenger** |
| TEN VAD native | promising | **excellent** | Good | Windows supported | Medium | latency challenger |
| TEN via sherpa | promising but pitch simplification | excellent | Good | Excellent CPU | Low | secondary test |
| WebRTC | poor in noise | excellent | Excellent | Excellent | Low | reject primary |
| RMS only | environment dependent | excellent | trivial | Excellent | trivial | corroboration only |
| RealtimeSTT whole stack | good | good | Good | CPU | High overlap | fallback architecture |
| CrispASR whole stack | good | good | Active | Vulkan | High overlap | fallback architecture |
| Parakeet EOU 120M | native EOU | **excellent** | New/official | parakeet.cpp capable | model change | English experiment |

---

# 21. Recommended bake-off

Do **not** first benchmark ASR.

Benchmark the detectors independently.

For each recorded WAV:

```text
Silero v5
FireRed Stream-VAD
TEN native
(optional Silero v6)
```

Record frame-by-frame:

```text
timestamp
probability
binary speech
start event
stop event
```

Then run the SAME ctrl-b temporal policy over each probability stream.

## Corpus

### Negative / no-owner-speech

```text
5 min parked EV
5 min moving EV
5 min combustion car
HVAC only
road rumble
indicator
bumps
phone handling
doors
music
radio
assistant TTS leak
quiet room
```

### Genuine speech

```text
yes ×20
no ×20
yeah ×20
mm-hmm ×20
okay ×20

quiet sentences
normal sentences
car sentences
hesitant sentences
speech with pauses
```

---

# 22. Metrics

Do not choose by F1 alone.

For ctrl-b the priority order is:

## 1. False accepted user turns

```text
false segments / minute
```

on no-owner-speech recordings.

## 2. Short-answer recall

```text
yes/no/yeah/mm-hmm detected correctly
```

## 3. Start clipping

Were initial consonants retained?

## 4. End latency

```text
true final word end
→ speech_stopped
```

## 5. Start latency

```text
true speech onset
→ speech_started
```

## 6. ASR WER after segmentation

A VAD can look great frame-by-frame and still generate worse ASR slices.

---

# 23. Decision rule

Do not select a VAD because it wins an average benchmark.

Use a Pareto rule.

A new detector replaces Silero only if:

```text
false-turn rate is materially lower
AND
short-answer recall is not meaningfully worse
AND
latency is acceptable
```

For ctrl-b, an extra ~50 ms is worth paying to remove false agent turns.

A 100 ms faster VAD that occasionally invents a user turn is not an upgrade.

---

# 24. Migration stages

## Phase A — extract the seam

No change to default behavior.

Add:

```text
VadEngine
TurnSegmenter
AsrEngine
```

Keep Speaches adapter as legacy.

---

## Phase B — reproduce Speaches externally

Implement persistent Silero v5 with:

```text
same threshold neighborhood
same ~700 ms ending silence
pre-roll
minimum onset
```

Run it in shadow mode.

Do not submit its turns yet.

Log:

```text
Speaches start/stop
new VAD start/stop
```

This tells us exactly how they diverge.

---

## Phase C — detector bake-off

Offline replay:

```text
Silero
FireRed
TEN
```

Choose from actual car data.

---

## Phase D — make ctrl-b VAD authoritative

Then:

```text
browser PCM
→ ctrl-b VAD
→ ctrl-b segment
→ legacy Speaches ASR-only OR new ASR
```

This stage isolates VAD migration from ASR migration.

If practical, first keep current Parakeet inference unchanged while bypassing Speaches VAD.

---

## Phase E — replace ASR host

A/B:

```text
parakeet.cpp CPU
parakeet.cpp Vulkan / Radeon 780M
sherpa-onnx Parakeet CPU
```

Pick based on short-utterance latency and transcription parity.

---

## Phase F — remove temporary defenses

Only after field evidence.

Candidates for later simplification:

```text
relay <350ms Speaches-flap cut
duplicate frontend/server gate logic
legacy Speaches adapter
```

Do not remove them in the same release that introduces the new VAD.

---

# 25. Preferred final deployment

My preferred likely end-state is:

```text
PROCESS 1: ctrl-b backend
    WebSocket media relay
    persistent acoustic VAD
    TurnSegmenter
    echo/tail policy
    call trail
    ASR adapter

PROCESS 2: parakeet.cpp
    Parakeet TDT 0.6B v3
    CPU or Vulkan
    /v1/audio/transcriptions
```

with:

```text
Silero v5 initially
FireRed if real-car A/B proves superior
```

No separate VAD daemon.

No general voice framework.

No realtime ASR requirement.

No dependency on CUDA.

---

# 26. Alternative “fewest processes” deployment

If operational simplicity beats 780M experimentation:

```text
ctrl-b backend
    +
sherpa-onnx
      ├ Silero/TEN VAD
      └ Parakeet v3 INT8
```

Everything runs in one process.

This is an excellent fallback architecture.

It should be benchmarked because CPU final-ASR latency may be worse than
`parakeet.cpp` Vulkan/CPU on the target machine.

---

# 27. What I would NOT do

Do not:

```text
replace Speaches with another opaque all-in-one voice stack immediately
```

Do not:

```text
pick TEN only because its own benchmark says it beats Silero
```

Do not:

```text
pick FireRed only because FLEURS F1 is highest
```

Do not:

```text
move both VAD and ASR model family in one step
```

Do not:

```text
make WebRTC the main detector
```

Do not:

```text
use an absolute dB threshold as VAD
```

Do not:

```text
deploy Silero as a separate HTTP service
```

Do not:

```text
remove ctrl-b's existing energy/echo protections during the migration
```

---

# 28. Final recommendation

### Architecture

**Control B owns turn segmentation.**

### VAD abstraction

**Pluggable acoustic detector.**

### Initial detector

**Persistent Silero v5** because it isolates the known Speaches architecture defect with minimum model change.

### Challenger

**FireRedVAD Stream-VAD** because its reported false-alarm/quality results are the most interesting for the actual ctrl-b failure.

### Third arm

**TEN VAD native** for latency/efficiency comparison.

### ASR

**Parakeet TDT v3 remains unchanged initially.**

### ASR host

After VAD is proven:

**parakeet.cpp CPU vs Vulkan bake-off**.

### Alternative simple runtime

**sherpa-onnx in-process** for both VAD and Parakeet.

---

# 29. Sources / projects

Silero VAD  
https://github.com/snakers4/silero-vad

LiveKit Silero production integration  
https://docs.livekit.io/agents/logic/turns/vad/

FireRedVAD  
https://github.com/FireRedTeam/FireRedVAD

TEN VAD  
https://github.com/TEN-framework/ten-vad

sherpa-onnx  
https://github.com/k2-fsa/sherpa-onnx

parakeet.cpp  
https://github.com/mudler/parakeet.cpp

RealtimeSTT  
https://github.com/KoljaB/RealtimeSTT

CrispASR  
https://github.com/CrispStrobe/CrispASR

NVIDIA Parakeet Realtime EOU 120M  
https://huggingface.co/nvidia/parakeet_realtime_eou_120m-v1

NVIDIA NeMo Voice Agent speech-recognition guidance  
https://docs.nvidia.com/nemo/labs-voice-agent/about/core-concepts/speech-pipeline/speech-recognition/

---

# 30. Immediate coding-agent task

The next implementation should **not choose the final detector yet**.

Build the seam and an offline replay harness first.

Deliverables:

```text
VadEngine protocol
Silero v5 adapter
TurnSegmenter
pre-roll
start/end temporal policy
WAV replay tool
JSONL event/probability output
Speaches-vs-new shadow comparison
```

Then plug:

```text
FireRed
TEN
```

into the same harness.

That gives the project an evidence-based VAD choice and prevents another implementation-specific speech detector from becoming architectural debt.
