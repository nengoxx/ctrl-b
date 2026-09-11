# R68 — Live-voice deltas: what moved under R51 since 2026-08-21

**Date:** 2026-09-11
**Status:** Draft delta dossier — complete for the bounded question. **Delta pass over
[R51](./R51-realtime-voice-chat.md), not a survey.** Nothing is being built; not a decision.
**What drove it:** R51 is the baseline for the live-voice-mode design and is three weeks old, but it
pinned three fast-moving areas (the owner's Speaches server, the VAD/turn-detection model field, and
one explicitly-unverified Chromium claim it called *"the single most consequential unverified claim
in this dossier"*). This pass re-checks only those three and buys nothing R51 already established.
**Drove:** (open) — feeds the §C4 placement R51 §9.5 proposes and the §9.3 architecture ranking.

**Confidence markers:** **VERIFIED** = source read at a pinned SHA, or probed first-hand on emma
today. **REPORTED** = secondary source. **UNVERIFIED** = expected but not checked.

**Read R51 first.** Every finding below is stated as *what R51 said* → *what is true on 2026-09-11*.
Where nothing moved, the entry says how that was verified, because "unchanged" is only useful if the
check is reproducible.

> **Headline:** two of the three areas are **frozen** (Speaches upstream, the turn/VAD model
> artefacts). The third is not a delta at all but a **correction** — R51's central open question
> about Chromium echo cancellation had already been answered in shipping Chrome for ~11 months when
> R51 was written. §3 is the only section that changes a design.

---

## 0. Sources, pinned

| Project | Ref | SHA / version | Date | Read |
|---|---|---|---|---|
| speaches-ai/speaches **upstream** `master` | HEAD | `993994f7984bf3fe9655b267448328cf66fccb42` | 2026-04-18 | 2026-09-11 |
| speaches **on emma** (`~/github/speaches`) | HEAD | `e093d8b625028cce4e72b6cc331f86efde944158` | 2026-09-06 | 2026-09-11 |
| **Live probe** | emma | `GET http://127.0.0.1:9000/openapi.json` → `info.version` `0.8.3`, 16 paths | — | 2026-09-11 |
| pipecat-ai/pipecat | `v1.9.0` / `main` | `4bae10d0` | 2026-09-11 | 2026-09-11 |
| pipecat-ai/smart-turn | HEAD | `4786657e` | 2026-01-29 | 2026-09-11 |
| snakers4/silero-vad | `master` | `867c2aa6` | 2026-08-24 | 2026-09-11 |
| ricky0123/vad | `master` | `8941bbf9` | 2026-01-30 | 2026-09-11 |
| `@ricky0123/vad-web` (npm) | `latest` | **0.0.30**, published 2025-11-21 | — | 2026-09-11 |
| livekit/agents | `main` | `bbfcbceb` (rel `livekit-agents@1.8.1`, 2026-09-10) | 2026-09-11 | 2026-09-11 |
| chromium/chromium | `main` | see §3 commit list | — | 2026-09-11 |
| w3c/mediacapture-main | `main` | `e0bde220` | 2026-05-18 | 2026-09-11 |
| `@mdn/browser-compat-data` (npm) | `8.1.1` | published 2026-09-10 | — | 2026-09-11 |

Clones/tarballs lived in `/home/emma/.cache/tmp/r68/` (`TMPDIR` honoured per the tmpfs memory) and
were deleted after the pass. No repo file was modified except this dossier. The emma probe was a
single read-only unauthenticated `GET /openapi.json`; no POST was exercised and no key was sent.

---

## 1. Speaches — upstream is frozen; emma runs a **local fork**

### 1.1 Upstream has not moved at all (VERIFIED)

R51 pinned `993994f7` (2026-04-17) as HEAD. **`master` is still `993994f7`**
(`gh api repos/speaches-ai/speaches/commits/master` → `993994f7…`, committed `2026-04-18T00:30:34Z`)
— **zero commits to the default branch in the ~5 months since, and none in R51's window.** The repo's
`pushed_at` is today (2026-09-11), but that is renovate bot traffic: of 37 branches, every one with
activity newer than R51 is a `renovate/*` dependency branch, and the newest non-renovate branch tip
is `misc-changes-abc` @ `57a52113` (2026-04-18).

**Releases are older still (VERIFIED):** the newest release is **`v0.9.0-rc.3`, published
2025-12-27** — ~8.5 months before today and predating R51 itself. Nothing has been released since.

**Therefore every R51 §6.4 gap stands, re-verified in the source that actually runs on emma today:**

| R51 §6.4 finding | State on 2026-09-11 | How verified |
|---|---|---|
| Transcription is **not streaming**, no partial transcripts | **Unchanged.** `InputAudioBufferTranscriber` still buffers to an in-memory WAV and makes one `transcription_client.create(...)` call | `grep -n "delta\|partial" realtime/input_audio_buffer_event_router.py` → 0 hits; `realtime/input_audio_buffer.py:151-154` |
| `conversation.item.truncate` **not implemented** | **Unchanged** — the handler still publishes *"Handling of the 'conversation.item.truncate' event is not implemented."* | `realtime/conversation_event_router.py:120-124` |
| No server-side auto-interrupt | **Unchanged** | same router, no cancel on `speech_started` |
| Server VAD `threshold=0.9, prefix_padding_ms=0, silence_duration_ms=550`, `create_response = intent != "transcription"` | **Unchanged, byte-for-byte** | `realtime/session.py:63-69` |
| 3 s rolling Silero window + `# FIX: magic number` | **Unchanged** | `realtime/input_audio_buffer.py:36`; `input_audio_buffer_event_router.py:91` still carries the `# FIX: magic number` comment |
| `/v1/realtime` WS + WebRTC both present | **Unchanged** | `routers/realtime_ws.py:56` `@router.websocket("/v1/realtime")`; live openapi lists `POST /v1/realtime` ("Realtime Webrtc", `HTTPBearer`) |
| `/v1/audio/transcriptions` accepts `stream: bool` | **Unchanged** — present, `default: false` | live openapi, `Body_transcribe_file_…` schema |

**Reading: architecture ① in R51 §9.3 is exactly as attractive and exactly as limited as R51 said,
and the "least-exercised part of that server" risk it flagged has not been retired by anyone
upstream.** If ctrl-b wants partial transcripts from Speaches, ctrl-b writes them.

### 1.2 The emma probe — and a correction to R51's version pin

**VERIFIED (probe + local git):** emma's Speaches is **not a release install**. `speaches.service`
runs `~/.local/bin/speaches-serve`, a wrapper that `exec`s `$HOME/github/speaches/.venv/…` — i.e.
the process *is* the working tree at `/home/emma/github/speaches`, which is:

- cloned from upstream on 2026-05-16 at `993994f7` (the R51 pin), and
- **two local commits ahead**, both authored `Maia <maia@emma.local>`:
  `a95929a` *"chore: add whisper and parakeet aliases"* (2026-07-05) and `e093d8b`
  *"fix: skip Parakeet when VAD finds no speech"* (2026-09-06) — 3 files, +96/−1.
  `e093d8b` adds an early return in `executors/parakeet.py:130` so a clip whose VAD finds no
  speech returns an empty transcription instead of invoking Parakeet.
- The service has been up since **2026-09-06 20:58 CEST**, i.e. it is running `e093d8b`.

**Correction to R51 §0/§6.4 — "Speaches 0.8.3 (2026-04-17)" conflates three different things.**
`info.version` in the openapi is a **hardcoded literal**: `src/speaches/main.py:122` reads
`version="0.8.3",  # TODO: update this on release`. The actual code is *post-`v0.9.0-rc.3`* —
`git describe --tags 993994f7` → **`v0.9.0-rc.3-35-g993994f`** — and the real `v0.8.3` tag was
published **2025-09-19**, not 2026-04. **The `/openapi.json` version field is not a reliable
version signal for this server and should not be re-cited as one.** (`pyproject.toml` says
`version = "0.1.0"`, so it is no help either.) The trustworthy pin is the SHA.

**Two further probe observations R51 did not record** (both predate R51, both decision-relevant):

1. **emma's default STT is Parakeet, not Whisper (VERIFIED, wrapper script).** The wrapper sets
   `WHISPER_MODEL=istupakov/parakeet-tdt-0.6b-v3-onnx`,
   `PRELOAD_MODELS='["istupakov/parakeet-tdt-0.6b-v3-onnx"]'`, `DEFAULT_LANGUAGE=en`,
   `USE_BATCHED_MODE=True`. R51 §9.3① justified architecture ① partly as running "on a machine that
   already holds the Whisper weights" — the weights that are actually resident and preloaded are
   Parakeet's. The `faster-whisper` path is still configured (`WHISPER__INFERENCE_DEVICE=cpu`,
   `WHISPER__COMPUTE_TYPE=int8`, `WHISPER__CPU_THREADS=8` via a systemd drop-in) but is not the
   preload.
2. **The bind and the bearer (VERIFIED, unit + wrapper).** The wrapper sets `UVICORN_HOST=0.0.0.0`
   (LAN-wide bind, not loopback) and the unit sets `API_KEY` to a **single-character placeholder**.
   R51 §9.3① listed *"it is bearer-gated and we must not put the key in the browser"* as a reason to
   build a relay rather than a direct phone→Speaches socket. That reason is close to vacuous as
   configured — there is no meaningful secret to protect — **but the relay argument survives on
   other grounds** (session state, not leaking the tailnet topology to the page, and the fact that
   the current posture is itself worth a look: an effectively-unauthenticated realtime WS on
   `0.0.0.0:9000`). **Flagging for the main seat; not this dossier's call.**

---

## 2. VAD + turn detection — the models are frozen, the *framework* moved

### 2.1 Smart Turn v3 — unchanged (VERIFIED)

R51 pinned `smart-turn-v3.2-cpu.onnx`, 8.7 MB, CPU, audio-domain, no transcript needed.

- **`pipecat-ai/smart-turn` has not been touched since 2026-01-29** (`4786657e`) — no new release,
  no new eval, in or before R51's window.
- pipecat **v1.9.0** still bundles **`smart-turn-v3.2-cpu.onnx`, 8,679,182 bytes (8.28 MiB)**, still
  loaded by `LocalSmartTurnAnalyzerV3` with `cpu_count: int = 1` and `_MODEL_SAMPLE_RATE = 16000`.
  Unchanged filename, unchanged size, unchanged defaults.

R51 §8.5's gap (Smart Turn v3's accuracy is unmeasured, pipecat publishes no in-repo eval) is
**still open** — nothing new was published.

### 2.2 Silero VAD — R51's "v5" pin was stale *when written*; v6 has been out since 2025-08

**Correction, VERIFIED.** R51 pinned "Silero VAD v5". **v6.0 released 2025-08-26** — a full year
*before* R51 — and the line is now at **v6.2.1 (2026-02-24)**. R51 recorded v5 because that is what
its *consumers* pinned, not because v6 did not exist. In R51's actual window, only one thing moved:
`master` advanced to `867c2aa6` (2026-08-24), a single community PR merge; **no release since
2026-02**.

The v6 release notes claim (REPORTED, maintainer's own notes, no independent eval): *"16% less
errors on noisy real-life data; 11% less errors on multi-domain validation"* over v5, plus v6.2's
retrained paradigm targeting *"unusual voices, child voices, muted speech, lower quality phone
calls"*. v6.2.1's only change is making `onnxruntime` an optional pip dependency.

**The numbers that decide designs (VERIFIED, file sizes at `snakers4/silero-vad`):**

| Artefact | Bytes | Note |
|---|---|---|
| `silero_vad.onnx` (v6) | 2,327,524 | the general model, 8 kHz + 16 kHz |
| `silero_vad_16k_op15.onnx` | 1,289,603 | **16 kHz-only, ~1.23 MiB — the browser-relevant variant** |
| `silero_vad_half.onnx` | 1,280,395 | fp16 |
| `silero_vad.jit` | 2,272,526 | torch |
| License | **MIT** | unchanged |

**The finding that makes a v5→v6 swap cheap (VERIFIED):** v5.1.2's and v6.0's `silero_vad.onnx` are
**the same byte count (2,327,524)** with **different git blob SHAs** (`b3e3a900…` vs `cb605195…`),
and a sorted `strings` diff of the two files shows **no difference in node/tensor names** — only
weight-blob bytes differ. Same graph, same `sr`/`state` inputs, retrained weights. So v6 is a
**drop-in weight swap** at the same size and the same frame contract (512 samples @ 16 kHz = 32 ms;
the README still documents 8 kHz + 16 kHz only, *"less than 1ms"* per 30 ms chunk on one CPU thread).
*UNVERIFIED: that onnxruntime-web actually runs the v6 file unmodified — nobody has been observed
doing it; the evidence above is structural, not executed.*

**pipecat v1.9.0 already ships v6 (VERIFIED, decisively):** its bundled
`src/pipecat/audio/vad/data/silero_vad.onnx` has git blob SHA **`cb605195e6975825c5fb941ad97e2e27f636d25a`**
— **byte-identical to `snakers4/silero-vad` at tag `v6.0`**. (Size alone could not have settled this,
since v5.1.2's file is the same length; the blob SHA does.) Note pipecat is on **v6.0**, not the
current v6.2.x. R51's cross-cutting table row "pipecat · Silero, `confidence 0.7`" should read **v6.0**.

### 2.3 Browser-side Silero — `@ricky0123/vad-web` is stale, and its defaults are not what R51 assumed

This is the package R51 §9.3② implicitly leaned on for client-side VAD, and it is the weakest link.

**VERIFIED by downloading and unpacking `@ricky0123/vad-web@0.0.30` (the current `latest`):**

| Fact | Value |
|---|---|
| Latest version / published | **0.0.30, 2025-11-21** — ~10 months stale |
| Repo `ricky0123/vad` last push | **2026-01-30** (`8941bbf9`, a README edit), 80 open issues |
| `@ricky0123/vad-react` latest | 0.0.36, 2025-11-21 |
| **Default model** | **`DEFAULT_MODEL = "legacy"`** (`dist/real-time-vad.js:34`) |
| `silero_vad_legacy.onnx` | 1,807,522 bytes, **1536-sample frames = 96 ms @ 16 kHz** |
| `silero_vad_v5.onnx` | 2,327,524 bytes, **512-sample frames = 32 ms**; git blob `b3e3a900…` = **Silero v5.1.2 exactly** |
| Bundle | `bundle.min.js` 69,143 B; `vad.worklet.bundle.min.js` 2,480 B (the worklet is genuinely tiny) |
| onnxruntime | declared dependency **`onnxruntime-web: ^1.17.0`**; current ort-web `latest` is **1.29.0** (published 2026-08-24) |
| License | ISC |
| Default frame-processor options | `positiveSpeechThreshold 0.3`, `negativeSpeechThreshold 0.25`, `preSpeechPadMs 800`, `redemptionMs 1400`, `minSpeechMs 400` |

**Three things a design must not get wrong here:**

1. **It defaults to the *legacy* (pre-v5) model at 96 ms frames.** You must pass `model: "v5"` to get
   the 32 ms path. R51's §7 table row "Silero, 512 samp" describes the *opt-in*, not the default.
2. **It ships v5, not v6** — so "use vad-web" and "use current Silero" are different decisions. Given
   §2.2, dropping the v6 file in its place is plausible but is work we would own and have not tested.
3. **The declared `^1.17.0` caret resolves to ort-web 1.29.0**, which the package has never been
   released against (0.0.30 predates 1.29.0 by 9 months). **UNVERIFIED whether 0.0.30 works on
   1.29.0**; a lockfile pin would be mandatory either way. R14 §3.4's "single-threaded WASM+SIMD, no
   cross-origin isolation" constraint is unchanged and still applies.

R51 §9.3② called in-browser ONNX *"real but community-grade"*. **That rating should be revised
downward for this specific package**: `vad-web` is a one-maintainer library that has had no release
in ten months and no repo activity in seven.

### 2.4 No new open endpointing model entered the field in the window (REPORTED)

Searched for post-2026-08 releases. The named lightweight open alternatives are all **older than
R51** and unchanged since: `TEN-framework/ten-vad` (last push 2026-02-02, license `NOASSERTION` —
*not* a clean OSI grant, worth noting before anyone reaches for it), `latishab/turnsense`
(SmolLM2-135M LoRA, Apache-2.0, last push 2026-03-20, 65 stars — hobby-grade), and LiveKit's
open-weights EOU model (an HF-hosted transformer downloaded at install by the `turn-detector`
plugin; it is **transcript-domain**, so it needs partials Speaches will not give us — see §1.1).
**Nothing new and nothing that displaces Smart Turn v3 as the best audio-domain, transcript-free,
CPU-sized option.** *(REPORTED, not VERIFIED: this is an absence argued from search plus repo
timestamps, which is the weakest kind of finding in this dossier.)*

### 2.5 What *did* move: pipecat formalized RVC's speculative-generation trick

R51 pinned pipecat at `6f3914f0` (2026-08-20). Since then: **v1.8.0 (2026-08-26), v1.8.1 (08-27),
v1.9.0 (2026-09-11)** — three releases inside the window. The load-bearing addition (VERIFIED, new
files absent at `v1.7.0`, present at `v1.9.0`):

**Eager end-of-turn + a speculation gate.** `src/pipecat/turns/speculation_gate.py` and
`eager_end_of_turn_mixin.py` are new, alongside `user_stop/eager_user_turn_stop_strategy.py` and
`user_stop/eager_match_policy.py`. The shape:

- An STT service that can *predict* a turn end pushes `EagerTranscriptionFrame`; if the user resumes
  it pushes `EagerEndOfTurnCancelFrame`. Gated by `enable_eager_end_of_turn` (**off by default** —
  *"it spends an inference on every prediction, including the ones the service withdraws"*).
- `SpeculationGate` is a three-state decision engine (`OPEN` / `HOLDING` / `DROPPING`) that holds
  every frame of the speculative response from its `LLMFullResponseStartFrame` onward.
  `UserStoppedSpeakingFrame` releases it; `EagerEndOfTurnCancelFrame` discards it. *"Only one
  speculation is ever in flight, since producing one takes a whole user turn."* System frames are
  never held — *"holding them would deadlock it"*.
- `EagerUserTurnStopStrategy(speculation_timeout: float = 5.0, match_policy=NormalizedMatch())`.
  **An unconfirmed turn never reaches the user or the LLM context, and tool calls are never executed
  for one.**
- The match policy is the direct analogue of RVC's 0.95 end-focused text-similarity gate
  (R51 §2.5 / §9.3③c) — but pipecat chose **equality after normalization**, not fuzzy similarity:
  `NormalizedMatch` compares *"with case, punctuation and whitespace removed"*; `ExactMatch` requires
  identity. If the committed transcript differs, the held response is discarded.

Two smaller v1.8/1.9 additions worth carrying:

- **`LatencyBreakdown.contributions`** — a named taxonomy for where voice latency actually goes,
  attributing each slice to *"VAD silence, turn detection, turn-completion markers and holds,
  sentence aggregation, and function handlers"*, and crediting time a setting governs **to that
  setting** rather than to the service it ran inside (e.g. `0.200s endpointing wait [config: VAD
  stop_secs]`). R51 §9.4's cost tiers had no such vocabulary.
- **`SpeakingObserver`** — a ready-made lifecycle vocabulary for R51 §9.2 item 4's state machine:
  `user_speech_started/stopped` *as the detector heard them* vs `user_turn_started/stopped` *as the
  strategy ruled on them*, plus `bot_speech_started/stopped` and `interruption`. The
  detector/strategy split is the useful idea: the two are not the same event.

**Also notable and out of class:** the field's hosted STT services are absorbing endpointing
(Deepgram Flux, `CartesiaTurnsSTTSettings` with `turn_start_threshold` / `turn_eager_end_threshold` /
`turn_end_threshold` / `turn_end_timeout_ms`, AssemblyAI Universal-3 Pro with built-in turn detection
and continuous partials, Meta `muse-voice-transcribe-1.0`). All are cloud services and therefore
structurally unavailable to a tailnet-only app — recorded only because it shows the direction of
travel that **Speaches has not followed** (§1.1).

### 2.6 livekit/agents — interruption/endpointing defaults unchanged (VERIFIED)

Four releases landed in the window (1.7.0, 1.7.1, 1.8.0, 1.8.1). R51 §4.3 quoted four default dicts
from `voice/turn.py`; **all four are byte-identical at `main` today** — `_INTERRUPTION_DEFAULTS`
(`min_duration 0.5`, `min_words 0`, `resume_false_interruption True`, `false_interruption_timeout
2.0`, `backchannel_boundary (1.0, 1.0)`), `_ENDPOINTING_DEFAULTS` (`min_delay 0.5`, `max_delay 3.0`,
`alpha 0.9`), `_STREAMING_ENDPOINTING_DEFAULTS` (`0.3` / `2.5` / `0.9`), and
`_PREEMPTIVE_GENERATION_DEFAULTS` (`enabled True`, `preemptive_tts False`, `max_speech_duration
10.0`, `max_retries 3`). One addition: `UserTurnLimitOptions`, a runaway-user guard that tracks
accumulated words and wall-clock across consecutive user turns and *"only reset[s] when the agent
transitions to `speaking` state"*.

**R51 §4.3 needs no revision.** The field's interruption policy has converged and stopped moving.

---

## 3. Chromium AEC — **R51's central open question was already answered before R51 was written**

This is the one section that changes a design decision, and it is a correction rather than a delta.

### 3.1 What R51 said

R51 §6.1 / §8.1: *"Chromium does not use locally-played audio (HTMLAudioElement or Web Audio) as the
AEC reference signal — only audio arriving via an `RTCPeerConnection`"*, marked REPORTED from four
secondary sources; the loopback-`RTCPeerConnection` trick as the *"well-known, cheap workaround"*;
and §8.1 naming the Android case *"the single most consequential unverified claim in this dossier…
This single fact decides whether barge-in needs the loopback-`RTCPeerConnection` trick, a WebRTC
transport, or nothing."*

### 3.2 What is actually true (VERIFIED in Chromium source + the Blink Intent to Ship)

**`echoCancellation` has accepted the string values `"all"` and `"remote-only"` in stable Chrome —
desktop *and* Android — since Chrome 141, stable 2025-09-30.** Android stable today is **154**, so
this has been shipping for ~11 months and 13 milestones.

The commit trail:

| SHA | Date | What |
|---|---|---|
| `d12c012662` | 2025-04-25 | *"Adding support for using system loopback as AEC reference behind a flag"* — introduces `SystemLoopbackListener`, a `DeviceOutputListener` that opens a **system loopback input stream** to feed the AudioProcessor a reference signal |
| `3886144eb7` | 2025-07-02 | *"Introduce EchoCancellationMode"* (replacing `EchoCancellationType`) |
| `4d93051b16` | 2025-07-10 | *"[MediaStreams] Make echoCancellation boolean or String"* — IDL plumbing; explicitly *"Still support only true/false. No Web-exposed behavior change intended."* |
| `21b468d41a` | 2025-06-27 | `use_loopback_aec_reference` in `AudioProcessingSettings` decides chrome-wide AEC vs loopback AEC |
| `0137d6b50b` | 2025-08-28 | **"Enable SystemLoopbackAsAecReference by default"** — *"loopback AEC takes precedence over platform AEC when requesting `EchoCancellationMode::kAll`"* |
| `b08014c83e` | 2025-08-28 | **"[MediaStream] Enable GetUserMediaEchoCancellationModes by default"** (I2S linked in the commit) |
| `c5c498605f` | **2026-08-28** | *in R51's window:* voiceIsolation × echoCancellation cross-constraint resolution — `exact: true` voiceIsolation with `exact: "remote-only"` echoCancellation is now an `OverconstrainedError` |
| `57511af38d` | **2026-09-09** | *in R51's window:* NFC refactor — *"EchoCancellationMode defines session identity; sources matching this can share a session and APM"* |

**The runtime flag is on (VERIFIED):** `third_party/blink/renderer/platform/runtime_enabled_features.json5`
carries `{ name: "GetUserMediaEchoCancellationModes", status: "stable" }` — Blink's `status: "stable"`
means enabled by default on all platforms.

**The Intent to Ship (REPORTED, blink-dev thread `x5nfoaUAUWY`, 2025-08-22):** milestone **141** for
Desktop, Android, WebView and iOS; *"supported on all six Blink platforms (Windows, Mac, Linux,
ChromeOS, Android, and Android WebView)"*; **`"all"`: removes all system playout from the microphone
signal**; `"remote-only"`: removes only audio received from PeerConnections. Gecko and WebKit are
formally "No signal" but **both WG representatives approved the spec change** (`w3c/mediacapture-main`
PR #1044).

**What the default maps to (VERIFIED, `media_stream_constraints_util_audio.cc` at `main`):** the enum
is `{kDisabled, kRemoteOnly, kAll, kBrowserDecides}`; `echoCancellation: true` resolves to
**`kBrowserDecides`** (lines 491-492, 513-514), and when unconstrained the preference order is
`kBrowserDecides (4) > kAll (3) > kRemoteOnly (2) > kDisabled (1)`. `"remote-only"` → `kRemoteOnly`,
`"all"` → `kAll`.

**So the precise correction is:** R51's claim was about the *default* (`echoCancellation: true` =
"the browser decides", which is exactly the MDN language R51 quoted). What R51 missed is that
**Chrome now gives the page a lever to override that decision** — `echoCancellation: {exact: "all"}`
— and that the mechanism behind it (system loopback as the AEC reference) has been default-on at the
media layer since 2025-08-28.

### 3.3 The probe R51 prescribed is now mostly a one-liner (VERIFIED)

R51 §8.1 scoped a *"~20-minute device probe: play a known TTS clip through an `<audio>` element while
recording with `echoCancellation:true`, and measure whether the clip appears in the capture."*
That acoustic probe is still the only way to confirm *efficacy*, but the *capability* question is now
a direct API query, because Chromium widened the readback surfaces too:

- `media_track_capabilities.idl:12` — `sequence<(boolean or DOMString)> echoCancellation`
  → **`track.getCapabilities().echoCancellation` enumerates the modes the device supports.**
- `media_track_settings.idl:16` — `(boolean or DOMString) echoCancellation`
  → **`track.getSettings().echoCancellation` reports the mode actually in effect.**
- `media_track_supported_constraints.idl:19` is still a plain `boolean echoCancellation` — so
  `getSupportedConstraints()` tells you nothing about modes. **Use `getCapabilities()`, not
  `getSupportedConstraints()`.**

**Revised probe (our reading):** on the owner's phone, `getUserMedia({audio:{echoCancellation:{exact:"all"}}})`
and read back `getCapabilities()` / `getSettings()`. A rejection or a `getSettings()` that does not
say `"all"` answers the question in seconds, on both Chrome and Fennec, before any clip is played.
The acoustic measurement then confirms the mode does what it claims **on that hardware**.

### 3.4 What is still genuinely unresolved

- **Whether `kAll` is effective on Android in practice.** The I2S asserts all six Blink platforms,
  but the underlying `SystemLoopbackListener` opens a *system loopback input stream* — a capture
  Android restricts heavily — and `0137d6b50b` says loopback AEC *"takes precedence over platform
  AEC"* for `kAll`, implying Android otherwise relies on the platform `AcousticEchoCanceler`.
  **REPORTED that it works; UNVERIFIED on any device, and specifically unverified on the owner's
  Honor 20.** This stays ours to probe.
- **Firefox / Fennec.** Mozilla is formally "No signal". `@mdn/browser-compat-data@8.1.1` has **no
  entry for the string modes at all** (the only echoCancellation keys in the whole dataset are
  `MediaDevices.getSupportedConstraints.return_object_property_echoCancellation` and
  `MediaStreamTrack.applyConstraints.echoCancellation_constraint`) — so this is undocumented on MDN
  and almost certainly Chromium-only today. R51 §6.1's note that *"Firefox, Safari and Edge consider
  all browser audio"* (REPORTED) is the mitigating factor, but a string passed to a Firefox
  `ConstrainBoolean` slot would WebIDL-convert to `true` — which is the safe degradation, and which
  the I2S itself relies on (*"presumably that is reduced with the property bag casting to `true`"*).
  **UNVERIFIED — I did not read Gecko's IDL.**
- **Whether the loopback-`RTCPeerConnection` hack is still the field's standard answer.** Secondary
  sources still describe it as the workaround (REPORTED, unchanged from R51), and none of them
  mention the mode constraint. That is a lag in the folklore, not evidence against §3.2 — but it
  does mean **you will keep finding the hack recommended, and should not read that as the constraint
  not working.**
- **The W3C spec has not moved in the window (VERIFIED).** `w3c/mediacapture-main` `main` is
  `e0bde220` (2026-05-18) and every commit since 2026-01 is a ReSpec version bump. The two relevant
  issues — #1035 *"Support multiple echoCancellation modes"* and #1053 *"Move normative
  echoCancellation prose out of note"* — both **closed in 2025**, i.e. the MDN text R51 quoted is
  already the post-change spec.

---

## 4. What I could not determine

1. **Whether `echoCancellation: "all"` actually suppresses local `<audio>` playback on Android
   Chrome** — §3.4. The strongest claim I can make is REPORTED-from-the-I2S. The device probe
   remains owned by us; only its shape changed.
2. **Whether Gecko accepts or coerces a string `echoCancellation` value** — inferred from WebIDL
   conversion rules and the I2S's own compat note, not read in mozilla-central.
3. **Whether `@ricky0123/vad-web@0.0.30` runs against `onnxruntime-web` 1.29.0** — the caret permits
   it, nine months separate them, and nobody has published a result either way.
4. **Whether the Silero v6 ONNX drops into `vad-web`'s v5 slot unmodified** — structurally identical
   graph (§2.2), never executed.
5. **Smart Turn v3's accuracy** — R51 §8.5's gap, still unfilled; no eval has been published.
6. **Why Speaches stalled** — 145 open issues, active renovate traffic, no maintainer commits to
   `master` in five months and no release in 8.5. I did not read the issue tracker for a statement of
   intent. **This is a supply-risk question the main seat may want answered before ranking
   architecture ① first.**
7. **What emma's Speaches realtime path does under Parakeet rather than Whisper** — §1.2 finding 1
   changes which executor a realtime transcription would hit, and `e093d8b` is a local patch to
   exactly that executor's VAD interaction. Not exercised.

---

## 5. Implications — **our reading, not evidence**

Short and separate, per the folder conventions.

1. **§3 is the only finding that moves R51 §9.3's ranking, and it moves it in ①'s favour.** R51 §9.2
   item 5 listed echo control as *"possibly nothing, possibly 40 lines of loopback peer connection,
   possibly a transport decision — **probe first**"*, and R51 §9.4 budgeted *"+2 days if it comes back
   dirty"*. On Chrome 141+ the answer is most likely **one constraint**, not a fake peer connection,
   and — critically — **it does not require WebRTC transport**. The WebSocket-transport designs (① and
   ②) lose their main platform liability. R51 §9.3③'s lesson (e) — *"do not let the echo guard eat the
   barge-in window; fix echo properly instead"* — now has a cheap way to be right.
2. **ctrl-b's `getUserMedia({audio:true})` call is leaving this on the table today.** R51 §6.1 noted
   `useDictation.ts:184` passes no constraints at all. Whatever a live mode decides, the constraint
   set is a seam that should be config-driven from the start rather than hardcoded — the
   no-hardcoding rule applies to `echoCancellation` mode exactly as it applies to VAD thresholds.
3. **Architecture ①'s supply risk went up, not down.** R51 called Speaches' realtime path *"the
   least-exercised part of that server"*. Five months of no upstream commits, no release in 8.5
   months, and an emma install that is a **two-commit local fork maintained by us** mean ① is not
   "buy it from a service the owner already runs" so much as "adopt a frozen codebase we are already
   patching". That is not disqualifying — the code works and the owner already owns the patches — but
   it should be priced honestly, and R51 §9.3①'s *"zero new models and zero new hosts"* framing
   understates it.
4. **Architecture ②'s browser leg got weaker.** §2.3: the obvious client-side VAD package is stale,
   defaults to a pre-v5 model at 96 ms frames, and pins an ancient ort-web range. Choosing ② now
   means either owning a fork of `vad-web` or writing the worklet against the ONNX directly (which
   R51 §6.2 already observes is ~20 lines of PCM plumbing plus an inference call). The *model* side
   of ② is fine — MIT, 1.23 MiB for the 16 kHz-only variant, drop-in v6 — it is the *packaging* that
   is community-grade.
5. **Steal pipecat's speculation gate shape, not RVC's.** §2.5 is the same idea as R51 §9.3③(c) but
   better specified for our concurrency model: a three-state gate over an async frame stream, with
   *"an unconfirmed turn never reaches the user or the LLM context, and tool calls are never executed
   for one"* as the invariant. For ctrl-b that invariant is the important part — it is what would let
   a speculative turn coexist with D8 confirm gates and the steer queue without either firing early.
   **Note this is only reachable if we have partial transcripts, which §1.1 says Speaches will not
   give us** — so it is a Tier-2 idea, and it argues that ② buys more than R51's ranking credits it.
6. **Nothing here disturbs R51 §9.4's Tier 0.** *"Auto-stop dictation, ~1 day"* remains the only tier
   worth building before any probe comes back, and it is unaffected by every finding above.

---

## Primary sources

- **speaches-ai/speaches** — upstream `master` `993994f7` (unchanged since 2026-04-18); releases API
  (newest `v0.9.0-rc.3`, 2025-12-27); branch listing (37 branches, all newer activity is
  `renovate/*`). Local checkout `/home/emma/github/speaches` @ `e093d8b` — `src/speaches/main.py:122`
  (the hardcoded `version="0.8.3"`), `realtime/session.py:63-69`,
  `realtime/conversation_event_router.py:120-124`, `realtime/input_audio_buffer.py:36,151-154`,
  `realtime/input_audio_buffer_event_router.py:91`, `routers/realtime_ws.py:56`,
  `executors/parakeet.py:130`; `~/.local/bin/speaches-serve`; `speaches.service` +
  `10-emma-amd-cpu.conf`. Live `GET /openapi.json` on emma, 2026-09-11.
- **pipecat-ai/pipecat** `v1.9.0` — `src/pipecat/turns/{speculation_gate.py,eager_end_of_turn_mixin.py}`,
  `src/pipecat/turns/user_stop/{eager_user_turn_stop_strategy.py,eager_match_policy.py}`,
  `src/pipecat/audio/turn/smart_turn/local_smart_turn_v3.py`,
  `src/pipecat/audio/{turn/smart_turn,vad}/data/` (blob SHAs + sizes); release notes v1.8.0–v1.9.0.
  Tree diff vs `v1.7.0`.
- **pipecat-ai/smart-turn** `4786657e` (2026-01-29, no movement).
- **snakers4/silero-vad** `867c2aa6`; releases v6.0 / v6.1 / v6.2 / v6.2.1 notes;
  `src/silero_vad/data/` file sizes; `README.md` (sample rates, per-chunk cost); LICENSE (MIT).
  Blob-SHA comparison of `silero_vad.onnx` at `v5.1.2` vs `v6.0` vs pipecat's bundle.
- **@ricky0123/vad-web 0.0.30** (npm tarball, unpacked) — `dist/real-time-vad.js:34,352,363`,
  `dist/frame-processor.js:10-16`, `dist/models/v5.js:57`, `package.json`; asset sizes;
  blob SHA of `dist/silero_vad_v5.onnx`. Repo `ricky0123/vad` `8941bbf9`.
- **livekit/agents** `bbfcbceb` / `livekit-agents@1.8.1` —
  `livekit-agents/livekit/agents/voice/turn.py:135-228`;
  `livekit-plugins/livekit-plugins-turn-detector/.../base.py`.
- **chromium/chromium** `main` — `third_party/blink/renderer/modules/mediastream/media_track_constraint_set.idl:12,23`,
  `media_track_settings.idl:16`, `media_track_capabilities.idl:12`,
  `media_track_supported_constraints.idl:19`,
  `media_stream_constraints_util_audio.cc:84,149,159-161,491-492,497,500,513-514,520,523`;
  `third_party/blink/renderer/platform/runtime_enabled_features.json5:3407-3409`.
  Commits `d12c012662`, `3886144eb7`, `21b468d41a`, `4d93051b16`, `0137d6b50b`, `b08014c83e`,
  `095cfa2194`, `c5c498605f`, `57511af38d`.
- **Blink Intent to Ship** — blink-dev thread `x5nfoaUAUWY`, *"echoCancellationMode for
  getUserMedia()"*, 2025-08-22 (REPORTED). chromestatus feature `5585747985563648`.
  chromiumdash: milestone 141 stable 2025-09-30; Android Stable today = 154.
- **w3c/mediacapture-main** `e0bde220`; issues #1035, #1053 (both closed 2025).
- **@mdn/browser-compat-data 8.1.1** — negative result: no `echoCancellationMode` entry anywhere.
- Owned dossiers cited rather than re-derived: **R51** (the entire baseline), R14 §3.4, R48, R50.
