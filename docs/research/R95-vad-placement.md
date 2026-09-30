# R95 — Where the voice-activity detection should live: relay, phone, sidecar, upstream server, or a user-chosen mix

**Date:** 2026-09-30 · **Author:** research lane R (Opus 5.5), session 52 · **Status:** evidence dossier, nothing built.
**Challenges:** [R94](./R94-asr-audits-verification.md) §7.2 ("ctrl-b's relay owns a stateful Silero VAD"), per the owner's
§11.0 D3 ruling ("treat §7.2 as a proposal to attack"). **Buys on top of:** R51 §9.3 (architecture ② = client Silero),
R68 §2.3 (vad-web rated stale), R75 (background freeze), R14 (browser ONNX), R94-evidence L4 (VAD semantics, emma numbers)
and L5 (the producer contract). **Drives:** the Fable ruling on R94 D3 + the owner's "quality vs battery saver" idea.

**Confidence vocabulary.** **VERIFIED** = source read / package unpacked / run on emma today. **MEASURED** = timed on emma
today (method in §9). **REPORTED** = official docs or a credible secondary source, not source-verified. **REASONED** =
derived from verified facts plus a stated assumption. **UNMEASURED** = nobody has the number; say so.

---

## 0. The answer in one screen

1. **Detection quality does not depend on where the VAD runs.** It is the same Silero model reading the same PCM16 samples. The
   uplink is lossless PCM16, and the relay VAD sees exactly what the phone's VAD would see, minus frames the call pacer drops
   after a network stall. All three R94 §4 defects (flaps, the 3 s pin, onset clipping) are **integration** defects of
   Speaches' zero-state rescan. A stateful VAD fixes all three **by construction, wherever it runs**. None of them is a
   placement defect. **The owner's premise "the phone one is probably way better" is wrong on the quality axis** (§6).
2. **The battery axis is unmeasured and, on the numbers that exist, roughly a wash, so it cannot carry a product option.** A
   phone VAD would cost about 2% of one big core while the mic is open (REASONED from a WASM measurement on emma, §5). It would
   save some uplink bytes. But the LTE radio stays in its high-power connected state either way, because uvicorn pings every
   5 s and the radio's tail timer is about 11.6 s. **The largest phone-battery lever we have is K6 (capture at 16 kHz,
   uplink ÷3), and it needs no VAD move.**
3. **VAD placement and echo handling are separate problems.** The car's ~2.3 s Bluetooth lag and the echo-tail "Yeah." are
   handled on the phone in every candidate. The hold, the chirp, the text backstop and AEC already live there. A phone VAD
   cannot gate on the mouth any more tightly than the relay can, because held frames already reach the relay as digital
   zeros **in the sample stream**, not as a timing message (§4). Moving the VAD neither helps nor hurts the car.
4. **The phone leg has real wins, just not the ones assumed.** Its segment timing is immune to network bunching. The UI knows
   an onset with zero round trip. Silence is never sent. And if segments were POSTed over HTTP (C2-H), the whole Problem-A
   family would disappear with the WebSocket. Its costs:
   - a 14.2 MB WASM runtime + a 2.3 MB model (served uncompressed today) on first use;
   - the fast-moving `onnxruntime-web` dependency;
   - loss of the server-side full-audio shadow A/B that R94 S6 depends on;
   - main-thread/Worker plumbing on a 2019 phone;
   - Fennec variance;
   - for C2-H, a rewrite of the D71–D80 client wiring.
5. **Peer evidence splits by client type, not by quality.** Every platform with a phone or telephone client runs the VAD
   **server-side**: OpenAI Realtime, Gemini Live, LiveKit, Pipecat, Vapi, Retell, ElevenLabs, Hume, Home Assistant. Some of
   them expose a **client-owned-turns mode** as the escape hatch (OpenAI `turn_detection: null`, Gemini
   `automaticActivityDetection.disabled`, LiveKit manual turns, HA `requires_external_vad`). Browser VAD is the choice of
   **single-app hobby/companion clients**: Open-LLM-VTuber, airi, vad-web's demos. The one peer that ran both modes
   (Open-LLM-VTuber) added the server VAD **for a non-browser client**, then turned it **off by default**. airi had to add an
   energy fallback because a browser VAD whose model fails to load silently kills the ear (§7).
6. **Recommendation (§10):**
   - **Keep C1** (the relay owns a stateful Silero), but shape it so that placement is a detail. The policy is a pure function
     from probabilities to edges, with golden vectors. The producer contract speaks leg-sample indices.
   - **Do not ship a user-facing quality/battery toggle (C5) now.** It doubles the VAD codepath to serve a trade-off that has
     no quality side and an unmeasured battery side.
   - **Add a cheap, debug-gated Honor 20 probe** so the phone question is answered by measurement, not belief.
   - **Promote K6 (16 kHz capture)**, which is the real battery/data lever.

---

## 1. The question, and what "VAD placement" does and does not decide

R94 §2 splits today's responsibilities. Speaches owns *when* speech starts and stops, and *whether* a segment is
transcribed (its hidden second VAD). ctrl-b owns capture, transport, the secondary admission (energy, echo, tail), call
state and dictation. The candidates differ only in **who owns the first two**. They do **not** move:

- **AEC and output routing.** The browser's `getUserMedia` does this per route (`pcmCapture.ts` `micConstraints`; D73/D76).
  It is always on the phone.
- **The ear/tail hold, the connect chirp, `leakSeen`, and the zeroing of held frames before uplink.** These are D80 ①⑤⑦, all
  client-side on the raw mic frames (L5 §1.8). They are always on the phone.
- **The text self-echo backstop.** D80 ②: the reply text is on the phone.
- **The level gate, the voice learner and barge-in.** These are client-side and read frame energy, never ear events (L5 §1.7,
  §2).
- **ASR.** It is a batch call through the provider seam in every candidate that keeps ctrl-b in charge (R94 §7.2.5).

So the placement decision is about **segmentation ownership, the uplink shape, dependencies, testability and the phone's
CPU**. It is not about echo or the car (§4).

---

## 2. The candidates, as they actually stand on 2026-09-30

### C1 — relay-owned streaming Silero v5 via onnxruntime (R94 §7.2, the incumbent)

**Runtime [VERIFIED/MEASURED].**
- `onnxruntime` 1.30.0 has a cp314-compatible wheel (PyPI, 2026-09-10).
- It installs and runs on emma's Python 3.14. **Silero v5 costs 89.2 µs per 512-sample window on one thread** (v6: 90.7 µs),
  which is 0.28% of a core per leg. That re-confirms L4's 81 µs within noise.
- The dependency is `onnxruntime` (67 MB) + `numpy` (43 MB), plus `flatbuffers` and `protobuf`. `onnxruntime` requires numpy.

**Shape.**
- A ~30-line ONNX wrapper with carried `state` and 64-sample `context` (L4 §1.2).
- A LiveKit/sherpa-style policy (L4 §1.3).
- The tentative-start producer contract (R94 §7.3 (ii)).
- A pre-ASR batch pass (R94 §7.2.4).

**It keeps what exists:**
- the WS, pacer, level gate, hold, trail and wire vocabulary;
- the full-audio view the S6 shadow mode and the replay corpus need.

**It deletes** the Speaches realtime machinery (R94 §7.3.5; L5 §6).

### C2 — phone-side VAD in the PWA

**C2a: `@ricky0123/vad-web` [VERIFIED by unpacking 0.0.31].** R68 §2.3's "stale" rating needs **correcting**:
- **0.0.31 was published 2026-09-12**, after ten months without a release.
- It adds Silero **v6** (#257).
- It fixes a real v5 defect (#263, merged 2026-09-11). Before 0.0.31, `SileroV5.process` **passed the bare 512-sample frame
  without Silero's 64-sample context**, so every frame was scored "as the first frame of an utterance". The PR's own numbers
  show single-onset probabilities moving by up to +0.73 (0.0131 → 0.7408). Every v5 vad-web deployment before 2026-09-12
  carried this.

Unchanged from R68:
- `DEFAULT_MODEL = "legacy"` (96 ms frames), still the default;
- default thresholds 0.3/0.25, `minSpeechMs 400`, `redemptionMs 1400`, `preSpeechPadMs 800`;
- declared dependency `onnxruntime-web ^1.17.0`;
- the package says ISC while GitHub reports `NOASSERTION`;
- one maintainer, 2,062★, 75 open issues.

**Where inference runs (VERIFIED, `real-time-vad.js`).** On the **main thread**: the worklet posts frames, and
`port.onmessage → processFrame → model`. By default it opens its **own** `getUserMedia` with `echoCancellation: true`,
`autoGainControl: true`, `noiseSuppression: true`. That would silently bypass ctrl-b's route-derived constraints (D73 S5 /
D76 §A) unless `getStream` is overridden.

**Its policy is structurally the tentative-start design (VERIFIED, `frame-processor.js`).**
- `SpeechStart` fires on the **first** frame over threshold.
- `SpeechRealStart` fires once `minSpeechFrames` are reached.
- A segment ending under the minimum emits `VADMisfire` instead of `SpeechEnd`.
- **Model state is not reset** on a normal segment end, only on `pause()`/`endSegment()`.

**C2b: our own ~30-line wrapper on `onnxruntime-web` in a Web Worker, fed by the existing `pcmWorklet.ts` frames.** This is
what R68 §5 ④ already suggested. It avoids vad-web's own mic, its main-thread inference and its defaults.

**`onnxruntime-web` 1.30.0 [VERIFIED by unpacking, 2026-09-14]:**
- It ships **only SIMD builds**. The smallest is `ort-wasm-simd-threaded.wasm` at **14,239,897 B raw, 3,659,955 B gzip -9**;
  the `jsep` build is 28.3 MB.
- More than one thread needs cross-origin isolation (R14 §3.4), so plan for single-threaded.
- The model is `silero_vad_v5.onnx` at 2,327,524 B (md5 `ad78afa8…` = v5.1.2, matching L4).

**C2-H: a variant that matters.** Phone VAD plus **one HTTP POST per finished segment** to the existing clip door
(`/api/voice/stt` → the pre-ASR pass → the provider seam). This is R51 §9.3 ② without Smart Turn. It needs **no WebSocket
at all**: dictation and the call both get their ear events locally and their text from the POST response.

### C3 — sherpa-onnx in-process (VAD, optionally + Parakeet)

**[VERIFIED/MEASURED]**
- `sherpa-onnx` 1.13.8 (2026-09-10, Apache-2.0) has a **cp314 wheel**. It installs on emma's 3.14 **without numpy**:
  `sherpa-onnx` + `sherpa-onnx-core`, about 44 MB of site-packages.
- `VoiceActivityDetector` runs Silero v5 with persistent state at **88.6 µs per window** (0.28% of a core), the same as raw
  onnxruntime.
- Its Python surface: `VoiceActivityDetector.{accept_waveform, is_speech_detected, current_segment, front, pop, flush, reset}`
  and `VadModel.is_speech` (a **thresholded bool**).
- **No per-window probability is exposed**, and there is no tentative-start edge. `is_speech_detected` becomes true only after
  `min_speech_duration`, and the pre-roll is implicit (~320 ms, L4 §1.3).
- The cadence is healthy (last push 2026-09-22; frequent releases).

**As the ASR host it still carries the open quiet-audio mel bug [VERIFIED open today].** #3997 and its fix PR #3999 are both
open (reported WER 15.2 → 7.9% with the fix). The Windows-empty-decode #3767 is also open. That bug matters for the car (L4
§3.2).

### C4 — a maintained upstream realtime server or framework owns the VAD

[VERIFIED at the registry/repo, 2026-09-30]

| Option | State | VAD integration | Fit |
|---|---|---|---|
| **Patched Speaches** (make its realtime VAD stateful in our fork) | Upstream master's last commit is **2026-04-18**; the latest release is **v0.9.0-rc.3 (2025-12-27)**. The fork on emma already carries two local patches (L3). | The defect lives in upstream's `InputAudioBufferManager` rescan (L3). A fix = owning a divergent patch to a frozen codebase | Lowest code change, highest supply risk. The hidden second VAD, the 30-min kill and the ASR-death-kills-the-session remain |
| **FastRTC `ReplyOnPause`** | Last release 0.0.34 (**2025-11-24**); last push 2026-01-12; "Development Status :: 3 - Alpha"; depends on `gradio<6`, `aiortc`, `librosa`, `numba` | `pause_detection/silero.py`: a v4-shaped state (h/c 64) and `get_speech_timestamps` from `get_initial_state()` **on every call**, i.e. **the same zero-state batch class as Speaches' defect** | ✗ |
| **WhisperLive** v0.10.0 (2026-09-07, MIT) | Backends `faster_whisper`/`tensorrt`/`openvino` only (**no Parakeet**); torch | `vad.py`: `audio_forward` calls `reset_states()`, and `VoiceActivityDetector.__call__` = "any window over threshold" per chunk | ✗ |
| **RealtimeSTT** v1.1.2 | `requires_python <3.13,>=3.11`, so **no 3.14** | Two-stage webrtcvad + Silero | ✗ on 3.14 |
| **LiveKit `livekit-plugins-silero`** 1.8.3 (2026-09-23) | Requires the full `livekit-agents` framework (≈30 runtime deps incl. `av`, `openai`, OpenTelemetry, `sounddevice`, `livekit` rtc) | The correct semantics (state kept, onset, prefix padding, L4 §1.3), bound to `rtc.AudioFrame` streams | ✗ as a library. The design is right; the framework is not ours |
| **Pipecat `SileroVADAnalyzer`** (pipecat-ai 1.12.0) | Framework-sized; pins `onnxruntime~=1.24.3` | Resets model state **every 5 s** (L4) | ✗ |

**⇒ No upstream offers a lower-debt home for the VAD than ~30 lines + a policy we own.** The ones with correct semantics are
frameworks. The small servers carry the same zero-state defect class we are escaping. This agrees with A5 §2 ("two policy
layers" is exactly what made Speaches hard to reason about).

### C5 — dual mode: one producer contract fed by relay VAD **or** phone VAD (the owner's product idea)

The shape is sketched in §8. In one line: the relay's segment → pre-ASR → ASR → ordered-outbox pipeline stays single, and
only the **segmenter** is swapped. That is a relay Silero on raw frames, or a pass-through of client-stamped edges plus
speech-only frames.

---

## 3. The rubric

Scores: ✓ good · ~ mixed · ✗ poor. "Fixes by construction" means that no tuning is needed for the defect to vanish.

| Axis | **C1** relay Silero | **C2b** phone Silero (own Worker) + WS | **C2-H** phone Silero + HTTP segments | **C3** sherpa VAD in relay | **C4** best upstream (patched Speaches) | **C5** dual |
|---|---|---|---|---|---|---|
| **Flaps** (34/66 today) | ✓ stateful + hysteresis + onset | ✓ same | ✓ same | ✓ (min_speech 0.25 s) | ~ only if the fork's VAD is rewritten stateful | ✓ both legs |
| **The 3 s pin** (21/21) | ✓ no window, no rotation | ✓ | ✓ | ✓ | ~ same caveat | ✓ |
| **Onset clipping** | ✓ continuous pre-roll ring | ✓ ring on the phone | ✓ | ~ implicit ~320 ms, not a separate knob | ~ | ✓ |
| **Echo tail** ("Yeah." in the car) | not a VAD job: D80 hold + backstop (§4) | same | same | same | same | same |
| **Still needs the pre-ASR no-speech gate?** | yes (parity with today's ~21%) | yes (server-side, on the segment) | yes (the clip door) | yes | already has one (Speaches' 2nd VAD) | yes, shared |
| **Problem A** (flood guard, recording lifetime) | Untouched; S2/S3/S8 fix it (decided) | Partly: silence not sent ⇒ smaller bursts; guard must admit a pre-roll burst; `uplink_idle_s` must count keepalives | **Structurally gone** with the WS: each segment is an idempotent, retryable POST | as C1 | as today | as C1 + C2b |
| **Latency to `start`** | onset + frame + RTT (+ confirm if not tentative) | **local, 0 RTT** | local | after min_speech (no tentative edge) | as today | per leg |
| **Latency to `stop`→final** | `silence_ms` + ASR (audio already on emma) | same | `silence_ms` + **upload of the segment** (64 KB per 2 s at 16 kHz) + ASR | as C1 | as today | per leg |
| **Where CPU burns** | emma, 0.28% of a core per leg (MEASURED) | phone, ≈2% of one A76 (REASONED §5) | phone ≈2% | emma 0.28% | emma, today's ~0.7 core per leg (R94) | both |
| **New deps** | `onnxruntime`+`numpy` ≈110 MB, cp314 ✓, MIT/BSD | `onnxruntime-web` (14.2 MB WASM, MIT, monthly releases) + a 2.3 MB model in the PWA | same | `sherpa-onnx` ≈44 MB, cp314 ✓, no numpy, Apache-2.0 | none new | both sets |
| **Existing code** | keeps WS/relay; deletes the Speaches realtime client, gap cut, flush pad, pin, 24 kHz hop (L5 §6) | keeps WS; adds a client VAD module + Worker; relay segmenter becomes a pass-through | **deletes** `voice_live.py` (1,163 lines), `liveSocket.ts`, `uplinkPacer.ts`, slots, the K1–K6 family; rewires `useLiveCall`/`useDictation` onto POSTs | as C1 | keeps everything, patches the fork | C1 + C2b |
| **Blast radius on D71–D80** | Low: producer contract only (L5 §7) | Medium: the client becomes the producer of ids and edges | **High**: the D71 WS admission is unused; the leg/reconnect/slot/ear-outage machinery moves or dies | as C1 (but no tentative start ⇒ L5 §7 ① forces option (i)) | Lowest | Highest (both) |
| **Background / lock screen** (D73 S6, R75) | Unchanged: a freeze pauses the AudioContext, the ear-outage detector redials and says so | Same freeze stops the worklet **and** the frames the Worker needs (REASONED: a frozen page's dedicated workers are frozen with it); the D73 keepalive that prevents the freeze keeps both running; message events are not timer-throttled | same as C2b; a hidden page's `fetch` is not throttled | as C1 | as C1 | both |
| **Fennec vs Chrome** | Nothing new on the phone | ort-web 1.30 ships SIMD-only WASM (both browsers support WASM SIMD); speed on Fennec UNMEASURED; Fennec's AEC does nothing against the phone's own output (D71 §7-S0), so a phone VAD there hears the reply exactly as the relay does (vad-web #92 is the same symptom); background capture on Fennec is dead in every candidate (R51 §6.3) | same | as C1 | as C1 | both |
| **Testability** | ✓ **full audio at the relay**: S6 shadow vs Speaches on identical input; replay corpus from the relay | ~ the server never sees non-speech audio; corpus/shadow need a debug "uplink everything" mode | ~ same | ~ probability not exposed ⇒ trails carry booleans only | ✓ as today | ✗ two parity suites |
| **12-month debt** | Low: ~30 lines + policy + 2 wheels we already vetted | Medium: the ort-web churn (its WASM file set has broken consumers before, vad-web #175), phone perf, Fennec | Medium-low *after* the rewrite, but the rewrite is large | Low-medium: policy baked in C++, tuning surface fixed by upstream | **High**: a frozen upstream we patch | **High**: every policy change twice |
| **Can it be a C5 leg?** | yes: the natural default/"server" leg | yes: the "phone" leg | no (a different transport) | yes as the server leg | no | — |

**Ranking on hallucinations alone** (owner addendum ③: flaps, pin, clipping, and the residual that needs a pre-ASR gate):
**C1 = C2b = C2-H** (identical model and policy; all three defects fixed by construction) > **C3** (fixed, but the pre-roll
is not tunable and the tentative start is impossible) > **C2a vad-web ≥0.0.31 with `model:"v5"|"v6"`** (fixed. **Any
version <0.0.31 on v5 is not**: the missing context) > **C4 LiveKit** (correct, wrong packaging) > **patched Speaches**
(only as good as the patch) > **Pipecat** (5 s resets) > **FastRTC/WhisperLive** (the same zero-state class).

**Every** candidate still needs the pre-ASR no-speech pass. A stateful VAD removes rescan artefacts. It does not stop a TV
voice, a cabin thump that scores speech-like, or an echo residue past the hold from forming a real segment. Parakeet will
then decode it to a filler. The second pass is what today's ~21% empty rate shows is doing work (R94 §4.3).

---

## 4. The car: Bluetooth lag and the echo tail (owner addendum ②)

**The facts (D80, VERIFIED at source in that round):**
- The car plays the reply about 2.3 s after the element does. The web platform cannot report that lag: the Android BT driver
  discards delay reports of 1 s or more.
- The mic is the **phone's** (A2DP is output-only), so the "leak" is the car's speakers into the phone.
- R94 §4 / L2: the car "Yeah." (3,084 ms, sent) was the **reply's echo tail**, not a VAD artefact.

**Direct answers:**
- **(i) The BT route delay: neither placement touches it.** The delay is in the output path, and the VAD sits on the input
  path. It is measured (the connect chirp, D80 ⑦) and compensated (the tail deadline `lag + 300 ms`) **on the phone** in
  every candidate, because only the phone has the element's clock and the raw mic frames.
- **(ii) Echo-tail false turns: neither placement fixes or worsens them.** The protections are:
  1. AEC when the route is `call` (`echoCancellation: {ideal:"all"}`; browser-side);
  2. the ear/tail hold (phone);
  3. the text backstop (phone).

  All three are independent of who segments.

**Can a phone VAD be gated by the mouth "more tightly" than the relay?** **No, and this is the central technical point.**
The phone already gates the relay's VAD at **sample level**. Held and muted frames are replaced by digital zeros **before
uplink** (`useLiveCall.ts` ~2641–2671, `silenceLike`; L5 §1.8 row 12). The relay's VAD therefore sees silence in exactly the
samples the hold covered. It is not told "held" by a message that could arrive late. The gate travels **inside the
stream**, so network latency cannot loosen it. A phone VAD would read the same zeros, or it would be switched off by the
same flag. Either way the boundary is the same sample.

**What a phone VAD could add, as instrumentation not a fix:**
1. It could score the **real, unzeroed** held audio, e.g. "speech probability of the leak during the reply". That would enrich
   `leakSeen`, but D80 ⑦ already decides that bit from the noise floor.
2. It could let barge-in AND the energy gate with a local speech probability. Silero is level-invariant (R76), so a TV or a
   passenger raises it too; the gain is marginal.

Neither is a reason to move segmentation.

**Could placement make the car worse?**
- **Onset confirmation, in any placement,** makes a post-deadline echo residue *less* likely to open a segment. L5 §1.8 says
  the margin gains slack.
- **C2 alone adds main-thread or Worker CPU on the phone.** The chirp matcher already runs on the main thread over raw frames
  (L5 §1.8). vad-web's main-thread inference beside it is a jank risk on a 2019 phone. A Worker (C2b) avoids that. UNMEASURED.
- **C2-H moves the transcript onto an HTTP upload after `stop`.** The echo window (4 s) and the mouth-wait assume stop→final
  ≪ 2–3 s (L5 §7 ⑨). A 64 KB upload over car 4G should fit, but **UNMEASURED in the car**.

**Verdict for the owner:** keep "VAD placement" and "echo handling" as two decisions. The car experience is governed by
D80's hold, chirp and backstop. Those stay on the phone and stay unchanged under every candidate here.

---

## 5. Battery, concretely (owner addendum ①)

The owner's premise is right: the engine runs **only while a dictation or a call is live**. The cost scales with recording
time and is zero otherwise, because the VAD is started with the capture and torn down with it in every candidate.

**5.1 What was measured (emma, today; §9 for the method)**

| | µs per 512-sample window (32 ms of audio) | CPU-ms per second of audio | Share of one core |
|---|---|---|---|
| Silero v5, native onnxruntime 1.30, 1 thread | 89.2 | 2.8 | 0.28% |
| Silero v6, native | 90.7 | 2.8 | 0.28% |
| Silero v5, sherpa-onnx VAD (policy included) | 88.6 | 2.8 | 0.28% |
| **Silero v5, onnxruntime-web 1.30 WASM-SIMD, 1 thread (Node 24 V8)** | **250.4** | **7.8** | 0.78% |
| Silero v6, WASM-SIMD | 222.4 | 7.0 | 0.70% |

On the same CPU, **WASM costs 2.5–2.8× native**. The WASM loop includes per-window `Tensor` construction and an `await`,
roughly what a browser wrapper does.

**5.2 Scaling to the owner's Honor 20 (REASONED, not measured on the phone).**
- The phone is a Kirin 980: 2× Cortex-A76 at 2.6 GHz, 2× A76 at 1.92 GHz, 4× A55 at 1.8 GHz (GSMArena).
- Geekbench 6 single-core: Kirin 980 ≈ 885–928; Ryzen 7 8745HS ≈ 2,417–2,605 (cpu-monkey / nanoreview / Geekbench browser),
  a ratio of about 2.7–2.9×.
- ⇒ **≈ 0.6–0.7 ms per window, ≈ 19–23 ms of CPU per second of audio, about 2% of one big core.** On an A55 little core (not
  measured; assume 3–4× slower again) it would be ~7–8%.
- Chrome Android's WASM tier and thermal behaviour can move this by a factor. **UNMEASURED on the device.**

**(a) A 10-minute dictation.** 600 s × ~21 ms ≈ **13 s of CPU** (range 11–14 s).
**(b) A 30-minute call.** 1,800 s × ~21 ms ≈ **38 s of CPU** (range 34–41 s).

**5.3 Against the baseline (the worklet + WS uplink of every frame, which runs in every candidate).**
- **The worklet's own work** is a float→int16 conversion and an RMS per 40 ms frame. It is negligible next to a neural net.
  **UNMEASURED** on the phone, but it is O(samples) arithmetic.
- **The radio** is the dominant uplink cost.
  - The only sourced power model found is Huang et al., MobiSys 2012 (AT&T, one 2012 LTE handset, **dated**; read it for
    ratios, not absolutes): uplink **αu = 438.39 mW/Mbps** on top of a connected base **β = 1,288 mW**, and an RRC tail of
    **11.576 s**.
  - Today's uplink is 48 kHz PCM16 = 768 kbps ⇒ ≈ **337 mW** above base, in that model.
  - At 16 kHz (K6) = 256 kbps ⇒ ≈ **112 mW**.
  - Speech-only at 16 kHz, with the owner speaking ~30% of a call (an **assumption**) ⇒ ≈ **34 mW**.
- **The connected base does not go away with a phone VAD.** The relay's WS is pinged every **5 s** (`--ws-ping-interval 5`,
  `deploy/linux/run.sh:21` and the systemd units). That is below the ~11.6 s tail, and TTS audio downloads during replies,
  so the radio never demotes during a live call or dictation in any candidate. C2-H would drop the WS, but a dictation pause
  rarely exceeds 11.6 s.
- **The order of magnitude, with its assumptions stated.**
  - Phone VAD CPU over a 30-min call ≈ 38 s of CPU. At an **assumed ~1 W per active big core**, that is ~40 J, **~0.08%**
    of the Honor 20's 3,750 mAh (≈14.4 Wh at an assumed 3.85 V nominal).
  - The uplink-throughput saving it buys, going from 16 kHz continuous to speech-only, is ≈ 78 mW × 1,800 s ≈ 140 J in the
    2012 model.
  - The screen (IPS LCD, held on by the call's wake lock) is almost certainly larger than both. **UNMEASURED.**
  - **Net: a wash within the error bars.** "Phone VAD = battery saver" and "server VAD = battery saver" are both unsupported
    by evidence. **K6 (48→16 kHz) saves ≈225 mW in the same model and needs no VAD move.**

**5.4 The download: is it a one-time PWA cache hit? Not today; it could be.**
- `vite.config.ts` precaches only `**/*.{js,css,html}` (+ one logo). Workbox's precache ceiling defaults to **2 MiB**
  (`maximumFileSizeToCacheInBytes`, workbox-build docs), which the 14.2 MB WASM exceeds.
- The existing **runtimeCaching CacheFirst route for content-hashed woff2** is the pattern to reuse: hashed `.wasm`/`.onnx`
  would be cached on first use, i.e. **one download per `onnxruntime-web` version**, re-paid on every ort-web bump.
- ctrl-b's backend applies **no response compression** (no GZip middleware; Tailscale Serve does not compress). A first use
  therefore costs **14.2 MB + 2.3 MB over 4G** unless pre-compressed assets are served (3.7 MB gzip for the WASM).

---

## 6. "The phone one is probably way better": the verdict (owner addendum ⑤)

**The expectation is wrong on quality, and unproven on battery.**

**Quality: no.** The phone and the relay would run the **same model on the same samples**.
- The uplink is lossless PCM16.
- The phone's AEC and noise suppression are applied **before** either VAD sees a sample.
- The relay only resamples (to 24 kHz for Speaches today; to 16 kHz under C1, a no-op after K6).
- Every quality defect the owner has experienced is a Speaches integration bug (the zero-state 3 s rescan), and any stateful
  VAD fixes it wherever it sits.

The phone's genuine quality-adjacent edges are narrow:
- **Network immunity.** In a call, the pacer drops the oldest audio after a stall (`call_backlog_ms`), so a relay VAD sees a
  splice where the phone's saw continuous audio. That can split or falsely start a segment. The magnitude is **UNMEASURED**:
  the trails do not count pacer drops against segment starts, which would be a good S1 telemetry field.
- **Zero-RTT onset for the UI and the mouth-wait.** It is worth ~RTT (10–30 ms on the tailnet, R51; more on 4G).

**Battery: unproven, and the numbers in §5 say it is roughly a wash.**

**Where the phone leg would genuinely win:**
- bytes (a 4G data plan);
- network-independent segment timing;
- C2-H's structural cure for Problem A.

The last is real. But S2/S3/S8 are already decided and cheap, which shrinks its marginal value.

**So there is no "quality leg" to justify a phone VAD, and the "battery-saver leg" is not clearly either placement.** If a
toggle were ever wanted, the honest axis would be **"data saver / flaky-network mode" (phone VAD)** vs **"default"
(relay)**, and only after the probe in §10 measures the phone side.

---

## 7. Peer evidence: who puts the VAD where, and why (owner addendum ④)

| Project / product | Where the VAD runs | What the client streams | Stated reason / notes | Confidence |
|---|---|---|---|---|
| **OpenAI Realtime** (the browser client pattern, WebRTC/WS) | **Server** (`server_vad` default, `semantic_vad` option) | Continuous mic audio | `turn_detection: null` hands turns to the client ("push-to-talk … disabling VAD and using an application-level gate"; the client then sends `input_audio_buffer.commit` + `response.create`) | REPORTED (docs) |
| **ChatGPT web / app voice** | Not documented | — | No primary source on the client internals; do not cite it either way | UNVERIFIED |
| **Gemini Live API** | **Server** "automatic activity detection" by default | Continuous | `realtimeInputConfig.automaticActivityDetection.disabled = true` ⇒ "the client is responsible for detecting user speech and sending ActivityStart and ActivityEnd" | REPORTED (docs) |
| **LiveKit Agents** | **Server** (agent process; Silero plugin) | WebRTC track, continuous | Modes: turn-detector model · VAD only · STT endpointing · realtime model · **manual** (frontend calls `start_turn()`/`end_turn()` RPCs for push-to-talk) | REPORTED (docs) + VERIFIED (plugin semantics, L4) |
| **Pipecat** | **Server** bot pipeline: "VAD is configured on the user aggregator because its speech start/stop signals feed the user turn strategies" | Continuous | Placement follows the turn policy; STT providers with their own VAD (Sarvam) say not to add Silero | REPORTED (docs) + VERIFIED (5 s reset, L4) |
| **Pipecat's primer** (voiceaiandvoiceagents.com, June 2026) | Either | — | "You can run VAD on either the client-side … or on the server … Generally, though, it's a bit simpler to just run VAD as part of the voice AI agent processing loop. And if your users are connecting via telephone, you don't have a client where you can run VAD." Client-side if heavy client audio processing (e.g. wake word) already exists | REPORTED (primary opinion) |
| **Vapi · Retell · ElevenLabs Agents · Hume EVI** | **Server**, platform-owned | Continuous (ElevenLabs even sends the client a `vad_score` event: "the probability that the user is speaking") | Turn-taking is a server policy exposed as knobs (Vapi `startSpeakingPlan`/`stopSpeakingPlan`; Retell `interruption_sensitivity`/`responsiveness`; ElevenLabs turn eagerness/`turn_timeout`; Hume sends `user_interruption`) | REPORTED (docs) |
| **Home Assistant Assist** | **Server** by default: `AudioSettings.is_vad_enabled = True` ("True if VAD is used to determine the end of the voice command"), `VoiceCommandSegmenter` (0.7 s default silence; relaxed 1.25 / aggressive 0.25), `pymicro-vad` | The satellite or browser streams after wake | **STT engines may own it instead:** `SpeechAudioProcessing.requires_external_vad` ("If False, the speech-to-text entity must detect the end of speech itself"). That is the closest peer to a placement *seam*: one flag per engine, one segmenter | VERIFIED (source, core `dev` @ `ae42f4150f`) |
| **wyoming-satellite** (HA's Pi satellite; **archived**) | Optional **client** Silero (`--vad`: "audio will only start streaming once speech has been detected") | Speech-gated | A bandwidth/idle-stream gate in front of the server's own segmenter; "`--vad` is unnecessary when connecting to a local instance of openwakeword" | VERIFIED (README) |
| **open-webui** call mode | **Client**, energy only: `AnalyserNode` at `MIN_DECIBELS = -55`, 2,000 ms silence, driven by `requestAnimationFrame` | MediaRecorder clip, uploaded after silence | The same shape as ctrl-b's Tier-0; no neural VAD; rAF stops when hidden (R51 §5) | VERIFIED (`CallOverlay.svelte` @ `8bd8b4fac5`) |
| **LibreChat · AnythingLLM** | **Client**, energy | Clip upload | R51 §5 | VERIFIED (R51) |
| **Open-LLM-VTuber** (≈14k★) | **Client** (vad-web) by default; the backend Silero was added 2025-02-11 as `unity-audio-data` (renamed `raw-audio-data`), **for its Unity (non-browser) client**, and **disabled by default** on 2025-05-12 (`vad_model: null`) | Browser: speech segments (`mic-audio-data` + `mic-audio-end`). Unity: raw frames | **The only dual-mode peer found.** Its reason for the server leg is **client capability** (a client that cannot run the browser VAD), not quality or battery. Both legs feed one `mic-audio-end` conversation trigger | VERIFIED (source + commits `72859c11`, `32b3a518`, `f3f984bd`) |
| **moeru-ai/airi** | **Client** (Silero ONNX in the browser) + a user toggle "Model Based" vs volume | Segments | #1832 / PR #2129: when the ONNX model **failed to load** (HuggingFace unreachable), "the entire monitoring flow fails silently". The fix adds a volume-based fallback with its own threshold. **The browser-VAD failure class is an asset load, not the model** | VERIFIED (issues) |
| **vad-web consumers** (GitHub code search on `package.json`) | Client | Segments | AutoGPT, BasedHardware/omi, cartesia-ai/dev-showcase, MetaGLM glm-realtime-sdk, MiniCPM-V-CookBook, tenstorrent/tt-studio, Open-LLM-VTuber-Web, airi… Demos and companion apps, **no call-grade platform** | VERIFIED (search listing only) |
| **Deepgram Browser Agent SDK** | Server (`user-started-speaking` event) | Continuous | A third-party post says Deepgram's docs once described a vad-web-based client VAD **that never shipped**; barge-in is server-driven | REPORTED (secondary, low confidence) |

**Moves between placements.**
- The only documented one is **Open-LLM-VTuber**: browser VAD first, a server VAD **added** for a non-browser client, then
  **defaulted off**. It never moved from browser to server for quality.
- No project was found that moved *from* server VAD *to* browser VAD for quality or battery.
- The platforms that allow client-owned turns (OpenAI, Gemini, LiveKit, HA) frame it as **push-to-talk / explicit control**,
  not as a better detector.

**Reading (ours):** the field places the VAD by **who the clients are**. Thin, telephone or embedded clients ⇒ server.
Rich single-app clients that already run audio ML ⇒ may run it locally. ctrl-b has exactly one client (the PWA). That
permits either placement, but nothing in the field says the phone is better at detecting.

---

## 8. C5 sketched honestly: one producer contract, two segmenters

```
                    ┌──────────── phone ────────────┐                 ┌─────────────── relay ───────────────┐
 mic → worklet ──┬─▶ (mode=relay) every frame ─────────── WS ─────────▶ SileroSegmenter(frames) ─┐
                 └─▶ (mode=phone) Worker: Silero+policy                                          ├─▶ pre-ASR pass → ASR worker → ORDERED OUTBOX
                        └─ edges {start|end, at:sampleIdx} + speech frames (pre-roll burst) ─▶ EdgeSegmenter ─┘     (ids · FIFO · one answer/stop)
                                                                                                 downlink unchanged: state · speech_started · speech_stopped · transcript · error
```

- **The wire.**
  - `start` gains `vad: "relay" | "phone"` (default `relay`).
  - Phone mode adds two control frames, `{"type":"edge","edge":"start"|"end","at":<leg sample index>}`, and sends only speech
    frames (pre-roll included, sent as a burst at confirmation).
  - The downlink vocabulary is unchanged (L5 §0): the relay still mints ids and still emits `speech_started`/`stopped`, so
    `useLiveCall`/`useDictation` see one producer.
- **The single source of truth for timing** is the **leg sample clock**, defined in both modes as *samples the client captured
  since `ready`*. The client stamps indices in phone mode; the relay counts received samples in relay mode. They agree unless
  the pacer drops frames. That exact case must be stamped, so the frame header gains an index or a drop count. That is the
  one new client obligation.
- **What gets duplicated:**
  1. The **policy** (onset, hysteresis, pre-roll, max-segment): Python + TypeScript, ~150 lines each. Mitigation: a shared JSON
     golden-vector fixture (probability sequences → expected edges) run by both pytest and vitest.
  2. The **model runtime** (onnxruntime + onnxruntime-web), with different float paths. Probabilities agree only to rounding,
     so a threshold sitting exactly on a boundary can flip. The fixtures test the policy, not bit-equality.
  3. **Trails:** probabilities are logged where they are computed (relay trail vs client D77 trail).
  4. **e2e:** every live-call/dictation spec runs twice.
- **What the relay must change for phone mode:**
  - the token bucket (R94 §7.1.1) must admit the pre-roll burst (≤ 500 ms, inside capacity);
  - `uplink_idle_s` must count edge/keepalive frames, since silence is no longer uplinked;
  - the pre-ASR pass stays the **server's** second opinion in both modes, which is good.
- **Honest debt.** Roughly **+40–60% VAD surface for the life of the feature**, a parity suite forever, and a settings row
  whose effect the owner cannot perceive on quality (§6). The Open-LLM-VTuber precedent justified its second leg by a
  **client that could not run the first**. ctrl-b has no such client.
- **A degenerate C5 to rule out explicitly:** "the phone computes probabilities, the relay runs the policy". Every frame is
  still uplinked, so it saves no bytes. It only moves 0.28% of an emma core onto the phone. It is pointless.

**Could either leg be "the battery saver"?** Not on the evidence (§5.3). Relay mode costs the phone uplink bytes; phone mode
costs it CPU; the radio stays up in both. If the owner still wants a user-visible mode after the probe, the honest label is
**data/flaky-network** (phone) vs **default** (relay). It is per-device, so it belongs **device-local**: in `UIState`'s
persisted-but-not-synced group, beside `appbarMode`/`layout` (`store/ui.ts`). **Not** paired with `perf` (synced across
devices) or `motion` (an animation preference). A VAD placement is a property of *this phone's* CPU and network, and the
desktop must not inherit it. The server knob `voice.live.vad_placement` could instead set a default, per the "no YAML-only
knobs" ruling (D71).

---

## 9. Method and reproducibility (MEASURED rows)

- **Host:** emma, AMD Ryzen 7 8745HS, Python 3.14.4, Node v24.18.0. A throwaway venv under `/home/emma/.cache/tmp/r95/`
  (**deleted after**).
- **Native:**
  - `onnxruntime` 1.30.0, `SessionOptions(intra=1, inter=1)`, CPU EP;
  - input `[1, 576]` (64 context + 512), `state [2,1,128]` carried, `sr=16000`;
  - 200 warm-up windows + 3,000 timed; random ±0.05 input.
- **sherpa-onnx 1.13.8:** `VoiceActivityDetector` (silero v5, thr 0.5, min_silence 0.5, min_speech 0.25, 1 thread), 3,000
  × 512-sample `accept_waveform`. Also installed alone in a second venv: **no numpy pulled; a plain Python list accepted**.
- **WASM:** `onnxruntime-web` 1.30.0 `ort.wasm.min.mjs` in Node, `numThreads=1`, SIMD, the same loop incl. a `Tensor` per
  window and an `await`. Models are those inside `@ricky0123/vad-web` 0.0.31: v5 md5 `ad78afa8…` (= v5.1.2), v6 md5
  `302cb198…` (= v6.x master per L4).
- **Not measured, and why:** anything on the Honor 20 (no device access from this lane); Chrome-Android's WASM tier; power.

---

## 10. Recommendation, owner questions, and the slice ladder

### 10.1 Recommendation (our reading, not evidence)

**Keep C1 as the one VAD, and make placement a cheap later decision rather than a shipped option.** In prose:

**Why C1 and not the phone.**
- The owner's actual failures are all integration defects, and every stateful placement fixes them equally.
- C1 is the only placement that keeps **the full audio at the server**. That is what makes R94's S6 shadow mode (the new VAD
  vs Speaches on identical input, principle 7 "one variable at a time") and the relay-side replay corpus possible.
- C1 costs the phone nothing new.
- Its dependency (onnxruntime + numpy, or sherpa-onnx) is small, cp314-verified and slow-moving compared with shipping
  onnxruntime-web to a 2019 phone.

**The C1 shape that keeps C2 cheap later:**
1. The policy is a **pure function** `(probabilities, sample indices) → edges`, with golden-vector fixtures in JSON. A later TS
   port is then a translation checked against the same vectors, not a re-derivation.
2. The producer contract's segment bounds are **leg-sample indices** (R94 §7.2.3 already proposes this).
3. The segmenter sits behind a one-method interface, so an `EdgeSegmenter` can be added without touching the pre-ASR/ASR/outbox
   path (A5 §3's `VadEngine` seam, one level up).

**Why no user-facing quality/battery toggle.** There is no quality side (§6). The battery side is a wash on the only numbers
available (§5). And the dual path is the highest-debt option in the table (§8). The field's one dual-mode peer justified its
second leg by client capability, which ctrl-b does not have.

**The one experiment worth buying (S6b below):** measure the phone side on the Honor 20 before anyone argues it again.

**C2-H is the only phone variant with a structural prize** (deleting the WS family and Problem A with it). It is also a
D71-scale rewrite in the middle of a phase whose transport fixes are already decided. Record it as the **named exit**, the way
D71 recorded architecture ②. Revisit it only if S2/S3/S8 fail in the field or the probe shows the phone side is free.

**Dependency sub-choice (R94 D3):**
- **raw `onnxruntime` + `numpy`** (≈110 MB) exposes the per-window probability. That is what the tentative-start contract
  (R94 §7.3 (ii)), EMA smoothing, the trails and the replay harness need.
- **`sherpa-onnx`** (≈44 MB, no numpy) is smaller and maintained, but gives only a thresholded bool and a baked policy with
  no tentative edge. L5 §7 ① would then force option (i), a client change.
- **Recommend raw onnxruntime.** sherpa is a legitimate smaller alternative if the owner weighs install size above control.

### 10.2 Owner questions (with defaults)

1. **A "quality vs battery" VAD mode in Settings?** Default **no, not now.** The evidence shows no quality difference and no
   clear battery winner. If wanted after the probe, it would be a device-local "data saver / flaky network" mode (§8).
2. **Run the Honor 20 probe (S6b)?** Default **yes**. It is debug-gated with no behaviour change; one call plus one dictation
   in the car and at home.
3. **Promote K6 (16 kHz capture) from "later" to right after S3?** Default **yes, as a proposal to Fable**, since it is the
   largest measured-model battery/data lever (§5.3). It still needs its own AEC/NS field check (R94 §7.1.6). The ordering is
   Fable's call; S1–S4 are not re-litigated here.

### 10.3 The slice ladder, fitted to R94 §10 (S1–S4 unchanged and independent)

| # | Slice | Change from R94 |
|---|---|---|
| S1–S4 | Telemetry · token bucket · client kill paths · Speaches ops | **Unchanged.** Suggested S1 field: count call-pacer drops per leg and their distance to the next `speech_started` (quantifies §6's only phone-side quality edge) |
| S5 | D-entry: the relay owns the VAD; **the policy is a pure function with golden vectors; bounds on the leg sample clock; the segmenter behind an interface**; the C2-H exit recorded with its trigger | adds the placement-agnostic shape + the named exit |
| S6 | Relay VAD + pre-ASR pass in shadow + replay harness + corpus | unchanged; the golden vectors are born here |
| **S6b (new, optional, cheap)** | **Phone probe, debug-gated:** run Silero v5 on `onnxruntime-web` in a **Web Worker** over the existing worklet frames during a real call/dictation. Log per-window ms, dropped/late windows, main-thread long tasks and probabilities into the D77 trail. Record battery % at start and end. **No behaviour change**; relay authoritative | new. Answers §5 on the device. Also yields a phone-vs-relay probability comparison on identical audio for free |
| S7–S10 | Flip authority · dictation decoupling · ASR host · retire Speaches | unchanged |
| later | K6 (see Q3) · a phone leg **only** if S6b is cheap **and** a data/network need is shown, built as `EdgeSegmenter` + the TS port against the S6 vectors | — |

---

## 11. Corrections and gaps

**Corrections to earlier dossiers:**
- **R68 §2.3 "vad-web is stale" is out of date.** 0.0.31 (2026-09-12) added v6 and fixed a real v5 bug: no 64-sample context
  (#263). vad-web deployments on v5 before that date were feeding Silero degraded input.
- **R68 §2.3 "ships v5, not v6"** is no longer true (v6 is bundled).
- **R51 §9.3 ② "the phone ships no ONNX/WASM"** as a reason for ①: the WASM cost is now quantified. It is 14.2 MB raw /
  3.7 MB gzip for the smallest ort-web 1.30 build, plus 2.3 MB of model. ctrl-b serves it uncompressed today.

**Gaps (UNMEASURED / UNVERIFIED):**
- Everything on the Honor 20: per-window time, main-thread jank, thermal throttling, energy (→ S6b).
- Chrome-Android vs Fennec WASM performance. Both support WASM SIMD, which is the only build ort-web 1.30 ships; the speed
  on Fennec is not measured.
- Whether `onnxruntime-web` runs inside an `AudioWorkletGlobalScope`. It is not attempted by any peer found; the Worker is
  the documented path.
- The magnitude of pacer-drop splices in real car calls (→ S1 field).
- ChatGPT's own voice client internals (no primary source).
- Watts per A76 core: the ~1 W figure in §5.3 is an **assumption** (the AnandTech review that measured it is offline).

---

## Sources

**ctrl-b (read at `778b960` + the untracked R94 files):**
- R94 §1–§2, §4, §6–§7.5, §10–§11
- R94-evidence L4, L5
- R94-external-audits A5 (§1–§3, §12–§14)
- LIVE_VOICE_PLAN §2–§2.1
- DECISIONS D71, D73, D80
- HANDOFF (the R94 block + the car card)
- R51 §5, §6.2–§6.3, §9.3–§9.4
- R68 §2.3, §4–§5
- R75 (freeze/§12 table)
- `frontend/src/lib/pcmWorklet.ts`, `pcmCapture.ts`, `store/ui.ts`, `vite.config.ts`
- `backend/app/services/voice_live.py`, `config.py:1029`
- `deploy/linux/run.sh:21`

**Packages (unpacked or installed 2026-09-30):**
- npm `@ricky0123/vad-web` 0.0.31 (`dist/real-time-vad.js`, `frame-processor.js`, `models/silero.js`, bundled ONNX files)
- npm `onnxruntime-web` 1.30.0 (`dist/*.wasm`)
- PyPI `onnxruntime` 1.30.0, `numpy` 2.5.3, `sherpa-onnx` 1.13.8
- PyPI metadata: `fastrtc` 0.0.34, `livekit-agents`/`livekit-plugins-silero` 1.8.3, `pipecat-ai` 1.12.0, `whisper-live`
  0.10.0, `RealtimeSTT` 1.1.2, `silero-vad` 6.2.3, `onnx-asr` 0.12.0

**Repos (GitHub API / raw, 2026-09-30):**
- ricky0123/vad: PR [#263](https://github.com/ricky0123/vad/pull/263), [#257](https://github.com/ricky0123/vad/pull/257),
  issues [#115](https://github.com/ricky0123/vad/issues/115), [#92](https://github.com/ricky0123/vad/issues/92),
  [#175](https://github.com/ricky0123/vad/issues/175)
- [speaches-ai/speaches](https://github.com/speaches-ai/speaches) commits (master last 2026-04-18)
- [gradio-app/fastrtc](https://github.com/gradio-app/fastrtc) `backend/fastrtc/pause_detection/silero.py`
- [collabora/WhisperLive](https://github.com/collabora/WhisperLive) `whisper_live/vad.py`, README
- [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) issues [#3997](https://github.com/k2-fsa/sherpa-onnx/issues/3997),
  [#3999](https://github.com/k2-fsa/sherpa-onnx/pull/3999), [#3767](https://github.com/k2-fsa/sherpa-onnx/issues/3767)
- home-assistant/core `dev` @ `ae42f4150f`: `assist_pipeline/{vad.py, models.py, default_pipeline.py, manifest.json}`,
  `stt/models.py`
- [rhasspy/wyoming-satellite](https://github.com/rhasspy/wyoming-satellite) README
- open-webui/open-webui @ `8bd8b4fac5`: `src/lib/components/chat/MessageInput/CallOverlay.svelte`
- Open-LLM-VTuber/Open-LLM-VTuber: `config_templates/conf.default.yaml`, `src/open_llm_vtuber/websocket_handler.py`, commits
  `72859c11`, `32b3a518`, `f3f984bd`
- moeru-ai/airi [#1832](https://github.com/moeru-ai/airi/issues/1832), [#2129](https://github.com/moeru-ai/airi/pull/2129)

**Docs (REPORTED):**
- OpenAI [Realtime VAD](https://developers.openai.com/api/docs/guides/realtime-vad),
  [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations)
- Google [Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities),
  [Live API reference](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/multimodal-live)
- LiveKit [Turns overview](https://docs.livekit.io/agents/logic/turns/)
- Pipecat [Speech input & turn detection](https://docs.pipecat.ai/pipecat/learn/speech-input)
- [Voice AI & Voice Agents primer](https://voiceaiandvoiceagents.com/) §5.8.1
- Vapi [voice pipeline configuration](https://docs.vapi.ai/customization/voice-pipeline-configuration)
- Retell [create agent](https://docs.retellai.com/api-references/create-agent)
- ElevenLabs [client events](https://elevenlabs.io/docs/eleven-agents/customization/events/client-events)
- Hume [interruptibility](https://dev.hume.ai/docs/speech-to-speech-evi/features/interruptibility)
- [workbox-build](https://developer.chrome.com/docs/workbox/modules/workbox-build) (`maximumFileSizeToCacheInBytes` 2 MiB)
- Deepgram browser SDK correction (secondary):
  [creatorstoolbox.com](https://creatorstoolbox.com/blog/deepgram-correction-browser-agent-sdk-has-no-client-side-vad)

**Hardware / power:**
- Honor 20 spec ([GSMArena](https://www.gsmarena.com/honor_20_and_honor_20_pro_go_official_with_quad_cams_flagship_kirin_980_chipset-news-37148.php))
- Geekbench 6 single-core: [Kirin 980](https://nanoreview.net/en/soc/hisilicon-kirin-980),
  [cpu-monkey Kirin 980](https://www.cpu-monkey.com/en/benchmark-hisilicon_kirin_980-geekbench_6_single_core),
  [8745HS](https://www.cpu-monkey.com/en/benchmark-amd_ryzen_7_8745hs-geekbench_6_single_core)
- J. Huang et al., "A Close Examination of Performance and Power Characteristics of 4G LTE Networks", MobiSys 2012
  ([PDF](https://web.eecs.umich.edu/~zmao/Papers/RRC4G_mobisys2012.pdf)): Table 3 Ttail 11,576 ms; Table 4 αu 438.39
  mW/Mbps, β 1,288.04 mW. **2012 handset; ratios only.**
