# ctrl-b Parakeet Backend Options & Migration Handoff

**Date:** 2026-09-28  
**Repository:** `nengoxx/ctrl-b`  
**Audited ctrl-b revision:** `main` @ `778b9608915af82fe8002132cfe17386c9a8cea1`  
**Goal:** replace Speaches as the Parakeet host if useful, without losing ctrl-b live-call functionality  
**Target hardware:** Ryzen 7-class APU with Radeon 780M / RDNA3, no NVIDIA CUDA requirement  
**Preferred deployment:** local, low-latency, minimal ASR service rather than a general AI platform

---

# 1. First clarification: who owns VAD today?

## Short answer

**Speaches owns the primary Silero VAD today.**

ctrl-b does **not** currently run its own primary speech detector that decides where an utterance starts and stops.

ctrl-b *does* run several important secondary filters and protections around Speaches' decision.

The distinction is:

```text
PRIMARY VAD / ENDPOINTING
"speech started"
"speech stopped"
        ↓
     SPEACHES
       Silero
```

versus:

```text
SECONDARY ADMISSION / SAFETY
"was this loud/near enough?"
"was this an implausibly short flap?"
"was this actually the assistant echoing?"
"should the agent reply yet?"
        ↓
      CTRL-B
```

---

# 2. Current ctrl-b ownership, exactly

The current call path is:

```text
browser microphone
      │
      ▼
ctrl-b pcmCapture / AudioWorklet
      │
      ├── PCM16 frames
      └── per-frame RMS
      │
      ▼
ctrl-b backend WebSocket relay
      │
      ▼
Speaches realtime WebSocket
      │
      ▼
Speaches Silero VAD
      │
      ├── speech_started
      └── speech_stopped
      │
      ▼
Speaches commits the segment
      │
      ▼
Parakeet transcription
      │
      ▼
Speaches transcript event
      │
      ▼
ctrl-b relay
      │
      ├── item_id segment ledger
      ├── short-gap/flap cut
      │
      ▼
ctrl-b browser
      │
      ├── relative dB / proximity gate
      ├── min_final_ms
      ├── noise verdict
      ├── echo/tail filtering
      └── conversation-state logic
      │
      ▼
agent turn
```

## Evidence in ctrl-b

### `backend/app/services/voice_live.py`

The relay forwards audio to Speaches and receives:

```text
speech_started
speech_stopped
transcript
```

It does not itself calculate Silero speech probability.

It sends Speaches the server-VAD configuration through `session.update`:

```text
vad_threshold
silence_ms
prefix_padding_ms
create_response = false
```

### `backend/app/config.py`

Current defaults include:

```text
vad_threshold = 0.6
silence_ms = 700
prefix_padding_ms = 300
```

These are explicitly documented as the knobs that ride Speaches'
`session.update`.

### `frontend/src/lib/levelGate.ts`

This is ctrl-b's own **relative energy/proximity gate**, not a VAD.

It estimates:

```text
noise floor
learned owner voice level
effective dBFS floor
```

and answers approximately:

> was enough of this segment plausibly the nearby owner?

It does **not** decide the primary speech start/stop boundaries.

### `frontend/src/hooks/useLiveCall.ts`

The call state machine receives `speech_started` and `speech_stopped` from the
server.

The per-segment energy meter then accumulates evidence for the segment Speaches
already opened.

So ctrl-b can later reject a final as `tooQuiet`, but Speaches may already have:

1. opened the VAD segment;
2. ended it;
3. committed it;
4. invoked Parakeet.

### ctrl-b's gap cut

The backend additionally rejects the measured Speaches "flap" class:

```text
relay start→stop gap < silence_ms / 2
```

unless the Speaches audio clock proves a genuine stop.

At the default 700 ms silence value, the cut is:

```text
< 350 ms
```

This is a **defensive correction around Speaches' VAD**, not ctrl-b owning VAD.

---

# 3. Why replacing Speaches makes architectural sense

ctrl-b currently uses Speaches for two relevant jobs:

```text
1. realtime VAD / segmentation
2. Parakeet inference
```

Job 1 is the one we have evidence against.

Job 2 is working well enough.

Therefore the clean replacement is not necessarily:

```text
Speaches → another giant realtime voice framework
```

It can instead be:

```text
ctrl-b owns:
    streaming VAD
    segment construction
    endpointing
    existing gates
    echo/tail policy

small ASR service owns:
    Parakeet inference only
```

That boundary is easier to reason about and test.

---

# 4. Desired end-state

Recommended architecture:

```text
Android browser
      │
      │ continuous PCM
      ▼
ctrl-b backend
      │
      ├── persistent streaming Silero
      ├── speech-onset confirmation
      ├── pre-roll
      ├── silence endpointing
      └── segment buffer
      │
      ▼
complete utterance PCM/WAV
      │
      ▼
Parakeet inference service
      │
      ▼
text
      │
      ▼
existing ctrl-b:
    energy/proximity check
    echo checks
    call-state handling
    agent submission
```

The ASR service no longer gets an opinion about whether road noise was speech.

That is the main design goal.

---

# 5. Recommended test order

For this project, test in this order:

1. **parakeet.cpp**
2. **CrispASR used only as a Parakeet HTTP engine**
3. **sherpa-onnx directly**
4. **RealtimeSTT only if we decide we do NOT want ctrl-b to own VAD**
5. Keep the current Speaches fork as the baseline during the bake-off

---

# 6. Candidate 1 — parakeet.cpp

Repository:

https://github.com/mudler/parakeet.cpp

## Why it fits unusually well

`parakeet.cpp` is a C++/ggml inference implementation focused specifically on
Parakeet-family ASR.

It supports:

```text
CPU
Vulkan
HIP
CUDA
Metal
```

The project explicitly supports integrated GPUs such as Ryzen APUs through the
ggml device registry.

For the target Radeon 780M this is attractive because:

```text
Vulkan does not require CUDA
Vulkan builds are precompiled for Windows x64 and Linux x64
CPU remains available as a very strong baseline
```

It supports Parakeet TDT 0.6B v3 and multiple quantizations.

The HTTP server exposes:

```text
POST /v1/audio/transcriptions
```

and does **not** try to own live microphone VAD.

That is exactly the separation recommended for ctrl-b.

## Important limitation

The bundled `parakeet-server` is intentionally a small server:

```text
one model
WAV uploads
serialized inference
basic OpenAI transcription API
```

For one local ctrl-b user this is not much of a limitation.

Concurrency infrastructure, model galleries and assorted enterprise furniture
are not needed here.

---

## 6.1 Windows CPU test

Download from the current release:

```text
parakeet-v0.5.0-bin-win-cpu-x64.zip
```

Extract it, then run:

```powershell
.\parakeet-server.exe --model tdt-0.6b-v3 --port 8080
```

The alias downloads/caches the model on first use.

Test:

```powershell
curl.exe `
  -F "file=@test.wav" `
  -F "response_format=json" `
  http://127.0.0.1:8080/v1/audio/transcriptions
```

The input WAV can remain at its native rate; the server handles model-side
resampling.

---

## 6.2 Windows Radeon 780M / Vulkan test

Download:

```text
parakeet-v0.5.0-bin-win-vulkan-x64.zip
```

A normal current AMD graphics driver supplies the Windows Vulkan runtime.

To explicitly select a ggml device if required:

```powershell
$env:PARAKEET_DEVICE="Vulkan0"
```

Then:

```powershell
.\parakeet-server.exe --model tdt-0.6b-v3 --port 8080
```

First test without setting `PARAKEET_DEVICE`; the project automatically selects
an available GPU. Use the explicit variable only if the wrong device is picked.

### Benchmark against CPU

Use the exact same clips with:

```text
CPU build
Vulkan build
```

Measure:

```text
server startup/model load
100 ms speech
500 ms speech
1 s speech
3 s speech
10 s speech
CPU utilization
GPU utilization
wall transcription time
text equality / WER
```

Do not assume Vulkan wins merely because a GPU exists.

A 780M shares system memory with the CPU; on very short utterances CPU inference
can remain competitive because GPU dispatch has a fixed cost.

---

## 6.3 Linux CPU/Vulkan

Current release bundles:

```text
parakeet-v0.5.0-bin-linux-cpu-x64.tar.gz
parakeet-v0.5.0-bin-linux-vulkan-x64.tar.gz
```

For Vulkan on Debian/Ubuntu:

```bash
sudo apt install libvulkan1
```

Then:

```bash
./parakeet-server --model tdt-0.6b-v3 --port 8080
```

Test:

```bash
curl \
  -F file=@test.wav \
  -F response_format=json \
  http://127.0.0.1:8080/v1/audio/transcriptions
```

---

## 6.4 ctrl-b integration

This is the preferred adapter interface:

```python
class AsrEngine:
    async def transcribe(
        self,
        pcm: bytes,
        sample_rate: int,
    ) -> str:
        ...
```

For `parakeet-server`:

1. ctrl-b finalizes one speech segment;
2. wrap the PCM as mono PCM16 WAV;
3. `POST /v1/audio/transcriptions`;
4. read `text`;
5. continue the existing turn path.

The current continuous browser WebSocket does not need to change.

Only this leg changes:

```text
OLD:
ctrl-b relay → Speaches realtime WS → VAD → Parakeet

NEW:
ctrl-b relay → ctrl-b VAD → HTTP Parakeet
```

---

# 7. Candidate 2 — CrispASR as a dumb Parakeet server

Repository:

https://github.com/CrispStrobe/CrispASR

Current inspected release:

```text
v0.8.37 — 2026-09-25
```

CrispASR supports many ASR engines, but that does not mean ctrl-b has to use the
Swiss-Army-knife functionality.

It can simply be launched as:

```text
one Parakeet model
one HTTP endpoint
no CrispASR live VAD
```

Its server exposes:

```text
POST /v1/audio/transcriptions
```

and keeps the model resident.

## Why it is interesting

It has current prebuilt AMD-friendly binaries:

```text
Windows Vulkan
Linux Vulkan
Linux HIP / ROCm
CPU
```

The Windows release contains:

```text
crispasr-windows-x86_64-cpu.zip
crispasr-windows-x86_64-vulkan.zip
```

The current Linux release contains:

```text
crispasr-linux-x86_64.tar.gz
crispasr-linux-x86_64-vulkan.tar.gz
crispasr-linux-x86_64-hip.tar.gz
```

---

## 7.1 Windows CPU

Download:

```text
crispasr-windows-x86_64-cpu.zip
```

Then:

```powershell
.\crispasr.exe `
  --server `
  --backend parakeet `
  -m auto `
  --host 127.0.0.1 `
  --port 8080
```

Test:

```powershell
curl.exe `
  -F "file=@test.wav" `
  http://127.0.0.1:8080/v1/audio/transcriptions
```

---

## 7.2 Windows Vulkan / Radeon 780M

Download:

```text
crispasr-windows-x86_64-vulkan.zip
```

Run:

```powershell
.\crispasr.exe `
  --server `
  --backend parakeet `
  --gpu-backend vulkan `
  -m auto `
  --host 127.0.0.1 `
  --port 8080
```

If multiple Vulkan devices are present, use its `-dev N` option to pin the APU.

---

## 7.3 Why not use CrispASR's whole streaming stack immediately?

CrispASR's current live system is much healthier than the Speaches path and
contains:

```text
VAD
minimum speech duration
silence finalization
utterance IDs
partials/finals
```

Its VAD default minimum speech duration is approximately:

```text
250 ms
```

However, generic Parakeet is still a batch backend inside its live framework.
Its general streaming layer uses rolling audio windows.

That is not inherently bad, but using that stack would again hand a significant
amount of speech-segmentation policy to the ASR package.

For ctrl-b, where we are specifically trying to make segmentation auditable, I
would first use CrispASR only as:

```text
final utterance → Parakeet → text
```

No `--vad` necessary in this mode because ctrl-b should already be sending one
confirmed utterance.

---

# 8. Candidate 3 — sherpa-onnx directly

Repository:

https://github.com/k2-fsa/sherpa-onnx

This is probably the simplest *runtime* if GPU acceleration is unnecessary.

The Python CPU package has precompiled wheels for:

```text
Windows x64
Linux x64
macOS
ARM platforms
```

Install:

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install sherpa-onnx sherpa-onnx-bin
```

Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install sherpa-onnx sherpa-onnx-bin
```

The Parakeet v3 model is:

```text
sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8
```

It consists principally of:

```text
encoder.int8.onnx
decoder.int8.onnx
joiner.int8.onnx
tokens.txt
```

with model type:

```text
nemo_transducer
```

The recognizer is:

```python
sherpa_onnx.OfflineRecognizer.from_transducer(...)
```

## Why it fits

For ctrl-b-owned VAD, "offline recognizer" is exactly what is needed.

Each completed utterance is intentionally a small offline ASR job.

No realtime ASR protocol is necessary.

## What is missing

There is no ready-made tiny OpenAI HTTP appliance in sherpa-onnx itself that is
as convenient as parakeet.cpp's server.

The clean solution is a small ctrl-b-owned wrapper:

```text
POST /v1/audio/transcriptions
    ↓
sherpa-onnx OfflineRecognizer
    ↓
{text: "..."}
```

That wrapper could easily be well under a few hundred lines.

## Caution

There have been historical sherpa-onnx Parakeet-v3 decoding bugs, including
missing-word and Windows-empty-decode reports, though fixes have landed over
time.

Therefore sherpa-onnx should be regression-tested against the current
onnx-asr/Speaches output before replacing it.

For this reason I put `parakeet.cpp` ahead of sherpa-onnx for the first test.

---

# 9. Candidate 4 — RealtimeSTT

Repository:

https://github.com/KoljaB/RealtimeSTT

This is the strongest option if the decision becomes:

> ctrl-b should NOT maintain its own VAD.

It already supports:

```text
sherpa_onnx_parakeet
Parakeet TDT 0.6B v3 INT8
CPU
```

Install:

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install "RealtimeSTT[server,sherpa-onnx]"
```

Download its pinned models:

```powershell
stt-install-sherpa-models `
  --root .\models\sherpa-onnx `
  --model all
```

The Parakeet-only engine is:

```text
sherpa_onnx_parakeet
```

Its production server runs roughly as:

```powershell
stt-server-production `
  --host 127.0.0.1 `
  --port 8010 `
  --engine sherpa_onnx_parakeet `
  --model .\models\sherpa-onnx\<parakeet-model-directory>
```

Consult the current `PRODUCTION_SERVER.md` for the exact final/realtime lane
arguments because the production server distinguishes final and realtime
engines.

## Important architectural difference

RealtimeSTT contains its own much richer microphone/turn system:

```text
WebRTC VAD
stateful Silero confirmation
pre-recording buffer
minimum recording length
post-speech silence
session state
streaming protocol
```

Its Silero code **does preserve recurrent state across chunks**, unlike the
Speaches batch-rescan design.

It is therefore a legitimate Speaches replacement.

But adopting it means ctrl-b and RealtimeSTT both own overlapping call logic.

That is why it is not the first recommendation for this project.

---

# 10. Candidate 5 — retain Speaches, but only temporarily

Speaches is still useful as the control arm.

Do not delete it during the migration.

Keep:

```text
A = current Speaches
B = ctrl-b VAD + parakeet.cpp CPU
C = ctrl-b VAD + parakeet.cpp Vulkan
D = optional CrispASR / sherpa
```

Run the same recorded corpus through all of them.

If the new path is worse, rollback is immediate.

---

# 11. Hardware strategy for the Radeon 780M

Do not make GPU support a prerequisite for the migration.

Parakeet is unusually fast on CPU.

The correct benchmark is:

```text
CPU
versus
Vulkan / 780M
```

on *actual ctrl-b utterance sizes*.

Do not benchmark only 30-second recordings.

The call mainly produces clips like:

```text
0.3 s
0.8 s
1.5 s
3 s
5 s
```

GPU acceleration often looks much better on large clips than on tiny
latency-sensitive calls.

Measure:

```text
median inference latency
p95 latency
CPU utilization
GPU utilization
model load time
RAM
shared VRAM
power
```

If CPU is already 5–20x realtime on normal utterances, a 50 ms GPU advantage may
not justify adding another driver/runtime dependency.

---

# 12. Recommended implementation boundary in ctrl-b

Create a backend interface independent of the Parakeet host:

```python
class SpeechTranscriber(Protocol):
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
SpeachesTranscriber
ParakeetCppTranscriber
CrispAsrTranscriber
SherpaOnnxTranscriber
```

Then VAD remains outside every adapter.

This gives ctrl-b this dependency graph:

```text
LiveCall
   │
   ▼
CtrlBVad
   │
   ▼
SpeechTranscriber
   ├── parakeet.cpp
   ├── CrispASR
   ├── sherpa-onnx
   └── Speaches legacy
```

That is much easier to maintain than teaching every external service about
ctrl-b's call semantics.

---

# 13. How the ctrl-b VAD can reuse existing infrastructure

A migration does **not** require rebuilding the browser side.

ctrl-b already has:

```text
continuous PCM
real sample rate
WebSocket transport
resampler
per-frame RMS
noise tracking
call lifecycle
segment IDs
debug trails
```

The backend already receives every PCM frame before Speaches.

Instead of:

```python
pcm = receive()
send_to_speaches(pcm)
```

the future path can be:

```python
pcm = receive()

event = vad.feed(pcm)

if event.started:
    begin_segment_with_preroll()

if vad.in_speech:
    append_to_segment(pcm)

if event.stopped:
    text = await asr.transcribe(segment)
    send_final(text)
```

The frontend can retain its existing secondary relative-energy check during the
migration.

Later, if desired, some energy evidence can move server-side to avoid calling
Parakeet for obviously invalid segments.

That optimization is not required for phase 1.

---

# 14. Suggested persistent VAD shape

Per WebSocket session:

```text
one Silero instance/state
one 16 kHz stream
one pre-roll ring
one onset accumulator
one silence accumulator
one active segment
```

Starting experiment:

```text
Silero start threshold: current 0.6 region
speech onset confirmation: 150 / 200 / 250 ms A/B
end silence: existing 700 ms
pre-roll: existing 300 ms minimum; 300–500 ms worth testing
```

The exact numbers should come from the car corpus.

Architecture is more important than picking a holy threshold.

---

# 15. Migration bake-off

Prepare one directory:

```text
test-audio/
  room-silence-5m.wav
  ev-parked-5m.wav
  ev-driving-5m.wav
  noisy-car-5m.wav
  hvac.wav
  indicator.wav
  bumps.wav
  echo-tail.wav
  yes-20x.wav
  no-20x.wav
  yeah-20x.wav
  mmhmm-20x.wav
  sentences.wav
```

For each backend record:

```text
false turns / minute
one-word recall
WER
first-word clipping
final latency
ASR latency alone
CPU %
GPU %
RAM
```

The most important metric is:

```text
FALSE COMMITTED USER TURNS / MINUTE
```

not a generic ASR benchmark.

---

# 16. What I would install first on the Ryzen machine

## Trial 1

```text
parakeet.cpp Windows CPU
```

Reason:

```text
fewest variables
simple server
same Parakeet family
no GPU dependency
```

## Trial 2

```text
parakeet.cpp Windows Vulkan
```

Same architecture, only execution device changes.

This isolates whether the 780M is useful.

## Trial 3

```text
CrispASR Windows Vulkan, Parakeet backend, HTTP final transcription only
```

This tests a second ggml implementation/server.

## Trial 4

```text
sherpa-onnx CPU INT8
```

Useful as an independent ONNX implementation.

## Trial 5

Only if we dislike maintaining VAD:

```text
RealtimeSTT
```

---

# 17. Current preference

For this exact project:

```text
BEST ARCHITECTURE:
ctrl-b persistent Silero
        +
parakeet.cpp final ASR
```

Why:

```text
+ fixes the layer where the diagnosed bug lives
+ smallest external dependency surface
+ OpenAI-compatible endpoint
+ CPU works
+ Vulkan can use the Radeon 780M
+ no CUDA
+ no duplicated conversation state
+ Parakeet host can be swapped later
+ keeps ctrl-b's existing gates/echo protections
```

Second choice:

```text
ctrl-b VAD + CrispASR Parakeet HTTP server
```

Third:

```text
ctrl-b VAD + sherpa-onnx direct
```

If ctrl-b should outsource VAD entirely:

```text
RealtimeSTT
```

---

# 18. Source links

## ctrl-b

https://github.com/nengoxx/ctrl-b

Relevant files:

```text
frontend/src/lib/pcmCapture.ts
frontend/src/lib/pcmWorklet.ts
frontend/src/lib/levelGate.ts
frontend/src/hooks/useLiveCall.ts
backend/app/services/voice_live.py
backend/app/core/audio.py
backend/app/config.py
```

## Speaches

https://github.com/nengoxx/speaches

Relevant files:

```text
src/speaches/realtime/input_audio_buffer_event_router.py
src/speaches/realtime/input_audio_buffer.py
src/speaches/executors/silero_vad_v5.py
src/speaches/executors/parakeet.py
```

## parakeet.cpp

https://github.com/mudler/parakeet.cpp

Current audited release:

```text
v0.5.0
```

## CrispASR

https://github.com/CrispStrobe/CrispASR

Current audited release:

```text
v0.8.37
```

## sherpa-onnx

https://github.com/k2-fsa/sherpa-onnx

## RealtimeSTT

https://github.com/KoljaB/RealtimeSTT

---

# 19. Agent action list

Before changing ctrl-b:

- [ ] Verify production/local Speaches source and SHA.
- [ ] Keep Speaches as a rollback backend.
- [ ] Download parakeet.cpp CPU + Vulkan bundles.
- [ ] Benchmark both on 0.3–5 s utterances.
- [ ] Define `SpeechTranscriber` behind one adapter seam.
- [ ] Implement persistent server-side Silero independently of the ASR adapter.
- [ ] Retain frontend relative-energy gate initially.
- [ ] Retain relay flap protection initially.
- [ ] Build the real car/room regression corpus.
- [ ] Compare false committed turns, not only WER.
- [ ] Switch default only after the car test passes.

No repository changes were made while preparing this handoff.
