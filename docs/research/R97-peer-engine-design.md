# R97 — The ASR_PLAN engine held against LiveKit Agents, Pipecat and Home Assistant/Wyoming: matches, justified divergences, what to cut, what to add

**Date:** 2026-09-30 · **Author:** research lane R97 (Opus 5.5), session 53 · **Status:** evidence dossier. Nothing is built.
**Question (owner, 2026-09-30):** "make sure that the plan is solid, the architecture clean, thought out, NOT over-engineered,
but reliable and efficient … double check other projects like Pipecat or LiveKit … something reliable and well designed for
the long term."
**Artifact under test:** [`docs/ASR_PLAN.md`](../ASR_PLAN.md) (uncommitted, read 2026-09-30 13:21 mtime; §3–§7 re-read at the
end of this pass, unchanged). Focus §3.3–§3.8, §3.5, §7.2 S8/S8b.
**Builds on, does not redo:** [R95](./R95-vad-placement.md) §7 (who places the VAD where), [R96](./R96-16khz-capture.md) §1
(capture rates), [R94-evidence/L4](./R94-evidence/L4-external-research.md) §1.3 (the first LiveKit/Pipecat/sherpa VAD table,
re-verified here at current `main`) and §2 (Deepgram/AssemblyAI ingress pacing).
**Index row owed:** this lane may create only this file. The main seat adds the `README.md` index row.

**Confidence vocabulary** (R95/R96's): **VERIFIED** = source read in a clone today. **MEASURED** = run/queried today.
**REPORTED** = docs or secondary. **REASONED** = derived from verified facts plus a stated assumption.

---

## 0. The answer in one screen

The plan's engine is **field-shaped where it matters** and **stricter than every peer on the contract** (one answer per stop,
typed reasons, a leg clock). Its divergences are mostly forced by two things the peers do not have: a **lossy TCP/WebSocket
uplink with no jitter buffer** and **30-minute dictation**. Four items (1–4) are materially under-specified against what the peers
found necessary, four more (7–10) are small, and two (5–6) are heavier than they need to be. Ranked by long-term reliability impact:

| # | Kind | Finding | Cost to fix |
|---|---|---|---|
| 1 | **ADD** | **The age-bound retraction re-arms immediately.** Probability hovering around `act` (0.55–0.65: soft speech, a TV) cycles tentative-start → 400 ms → `short` → next crossing → new id, and the mouth gate opens in every gap — the Q1 defect re-enters through the bound's back door. The golden list covers `deact ± 0.05`, not `act ± 0.05`. HA's segmenter has exactly the missing rule (`reset_seconds`: the onset counter re-arms only after a quiet run) (§2.4) | one rule + one vector |
| 2 | **ADD** | **No client watchdog on the awaited-id set.** Every peer bounds "waiting for a transcript" by time (LiveKit `transcription_timeout`, Pipecat `stt_timeout` + a 5 s `user_turn_stop_timeout`). The plan relies on "one answer per stop" by construction; one lost answer (a relay bug, a cancelled in-flight segment on a path nobody tested) wedges `mouthMayOpen` for the rest of the leg (§5.3) | a TTL = live `timeout_s` + margin, logged |
| 3 | **ADD** | **Segment end and turn end are the same number.** Both frameworks separate a short VAD silence (LiveKit 0.55 s, Pipecat 0.2 s) from a restartable turn-end delay (0.5–3.0 s / 0.6 s) and accumulate finals into one turn meanwhile. The plan uses `silence_ms` for both, so R23's 3000 ms makes ASR start 3 s late and is what forces the "above ~3.2 s the echo final lands past the 4 s window" ceiling. The client's pending queue already IS the accumulator; R20's join is a special case of it (§9.2) | a client turn-wait hold; only needed if the owner goes above ~1200 ms |
| 4 | **ADD** | **The recorder↔leg mapping is linear over 30 minutes.** `from_ms = (t_leg0 − t_rec)·1000 + boundary − silence_ms/2` assumes worklet sample count == MediaRecorder timeline for the whole dictation. Any skipped input (a render overrun, a context suspend) drifts the cut; ±350 ms of slack is not a 30-min budget. Map through the boundary frame's OWN `t` instead (§7.3) | a small index ring on the client |
| 5 | **CUT** | **The bucket's equality mirrors.** C is derived exactly (12 580 ms) and pinned by two cross-file equalities (launch-flag parse + `uplinkPacer.ts`). No peer guards the uplink at all; the pacing services (Deepgram/AssemblyAI) throttle at 1.25× and close only at gross backlog. Keep the invariant, drop the equality: a fixed generous C (e.g. 30 s) + ONE test `C ≥ Σ reservoirs` (§8) | deletes two pins |
| 6 | **CUT** | **A hand-rolled streaming polyphase FIR with ±1-sample edge mapping** on a path that is an identity at 16 kHz (K6) and runs only on the Firefox/Fennec < 148 fallback. Pipecat uses `soxr.ResampleStream`, LiveKit its native `AudioResampler` with the comment "VAD doesn't need high quality" and "latency … negligible". Use a library (python-soxr ships a cp312-abi3 wheel; PyAV — already in the `voice` extra — has one too), keep the alias golden test, relax the mapping to ≤ one 32 ms window (§4.2) | deletes a DSP module |
| 7 | ADD | **Abrupt segment tails.** A `max_segment` cut and a release-time flush end mid-air; the pass's `last + 400` crop cannot pad past the audio end. Pipecat pads every segment with 0.5 s of zeros because "models tend to drop or garble the final word when the audio ends that abruptly" — the plan's own B8 class. Pad zeros up to `PREPASS_PAD_MS` when the real tail is shorter (§6.2) | one line |
| 8 | ADD | **Smoothing is unstated.** LiveKit confirms onset over an EMA (0.35·prev + 0.65·p); the plan's inheritance (§2.3) cites LiveKit's consecutive-≥act rule but the vectors will be raw. State "raw" or make the EMA a `VadParams` variant beside M1 (§2.2) | a sentence |
| 9 | ADD | **No runtime rule when the VAD falls behind.** The budget is a measurement; the dictation queue is lossless, so a stalled worker grows it without bound. LiveKit only logs (`SLOW_INFERENCE_THRESHOLD = 0.2`). Add: lag > N s ⇒ `ear_failed` ⇒ dictation degrades into the S8 recovery that already exists (§8) | one rule |
| 10 | ADD | **Pre-roll 300 ms < the pass's 400 ms lead pad**, so the pad is never honoured. LiveKit 500, Pipecat 1000, Wyoming = the whole command. Default 500 (§4.1) | a default |

**What matches the field (keep as is):** Silero v5 on raw ONNX Runtime with per-leg state and no mid-leg reset (LiveKit,
sherpa; Pipecat's 5 s reset is still there and still the anti-pattern) · ORT session options **identical** to LiveKit's ·
`deact = act − 0.15` hysteresis while speaking · consecutive-window onset and end · a continuous pre-roll ring · one serial
FIFO batch worker per stream (all three peers) · a 10 s per-request timeout (= LiveKit's `APIConnectOptions.timeout`) · a
provider chain (= LiveKit's `FallbackAdapter`) · **the pre-ASR crop with the SAME constants as Wyoming's `--vad-clip`**
(threshold 0.5, pad 400 ms) · a debug-gated 16 kHz WAV capture (= HA's `debug_recording_dir`).

**Where it diverges with a good reason:** the **tentative start** (no peer has one; it buys 192 ms at `onset_ms` 200, and
that is what keeps D74's arrival-keyed accrual from losing half of a "yes" — provisional until R94 §7.3 (i) moves accrual
onto the leg clock, then delete it) · **split-and-join at 20 s** (peers truncate at 60 s, end at 15 s, or never bound) ·
**flush = force-endpoint** (LiveKit's flush DISCARDS the open segment; dictation's last word needs the opposite) · **one
typed answer per stop** (peers drop empty/failed segments silently and then need watchdogs) · **the leg clock + recording
recovery** (WebRTC peers lose audio across a disconnect and do not recover it; ctrl-b's 30-min dictation cannot) · **no
throttle** (throttling a TCP socket moves the kill to the client's `bufferedAmount`, L4 §2.2).

**Not over-engineered, despite looking it:** the pre-ASR pass (Wyoming ships it), the per-leg serial worker, the D9 awaited
set, the one-answer contract, receipt stamping. **Over-engineered:** items 5 and 6 only. **S8b** (IndexedDB reload survival)
has **no peer precedent at all** — it is owner-ruled (R22) product scope, not a reliability requirement the field recognises.

---

## 1. The peers, and why these three

Cloned 2026-09-30 into `~/.cache/tmp/r97/` (shallow, current default branch):

| Peer | Commit (date) | Why it is comparable |
|---|---|---|
| **livekit/agents** (`livekit-agents` + `livekit-plugins-silero`) | `d251b89` (2026-09-30) | Server-side Silero VAD in front of STT; `stt.StreamAdapter` = the exact "VAD segment → batch `recognize()`" shape the plan builds; the richest turn/interruption layer in the class |
| **pipecat-ai/pipecat** | `20999cd` (2026-09-29) | `SegmentedSTTService` = VAD-segmented clips posted to OpenAI-compatible batch endpoints (the Whisper family); raw-PCM WebSocket transport (ctrl-b's transport class, R96 §1) |
| **home-assistant/core** `assist_pipeline` (+ `stt`, `wyoming`) | `084651e` (2026-09-30) | **The third peer: a relay-owned VAD in front of a batch ASR, for remote thin clients, self-hosted, single household.** HA's `VoiceCommandSegmenter` runs on the server between a streaming satellite/browser and a Wyoming ASR that buffers the whole command and transcribes it at the end. It is the closest *topology* to ctrl-b; LiveKit/Pipecat are the closest *engines* |
| **rhasspy/wyoming-faster-whisper** | `f8e8b0e` (2026-09-29) | HA's reference batch ASR server: its `--vad-clip` is the pre-ASR crop, its `--vad-endpointing` a server-side segmenter |

Speaches' realtime router (the rescan anti-pattern) is already dissected in R94 §4 / L3 and is not redone.

---

## 2. Q1 — the onset/end state machine

### 2.1 The table

| | Onset rule | Onset thresholds | End rule | Smoothing | Tentative/retractable start? |
|---|---|---|---|---|---|
| **LiveKit** `silero/vad.py` | `min_speech_duration` **0.05 s** of consecutive windows; while not speaking only `p ≥ act` counts, any other window zeroes the accumulator (`:518-525`, `:542-544`) [VERIFIED] | `act` 0.5; `deact = max(act − 0.15, 0.01)` (`:138`) | `min_silence_duration` **0.55 s** of consecutive `p ≤ deact` while speaking; `p > deact` counts as speech (hysteresis) (`:518-520`, `:549-553`) | **EMA** `f = 0.35·f + 0.65·p` (`:234`, `:423`; `utils/exp_filter.py:45-46`) | **No.** START is emitted once, at confirmation (`:530-540`). Retraction exists one layer up, at the **consumer**: a VAD start *pauses* the agent's audio and, if no transcript follows within `false_interruption_timeout` 2.0 s, *resumes* it (`voice/turn.py:189-197`; `agent_activity.py:2357-2365`, `:4864-4890`); a turn with no transcript is never committed (`audio_recognition.py:1520-1522`) |
| **Pipecat** `vad_analyzer.py` | QUIET → STARTING → SPEAKING after `start_secs` **0.2 s** = `round(0.2/0.032)` = 6 consecutive speaking windows; one miss returns to QUIET (`:164`, `:213-227`) [VERIFIED] | `confidence` **0.7** AND smoothed `volume ≥ min_volume` 0.6 (`:25-28`, `:211`); **no hysteresis** | STOPPING → QUIET after `stop_secs` **0.2 s** consecutive; any speaking window returns to SPEAKING (`:220-232`) | volume only (factor 0.2, `:87`) | **No.** STARTING/STOPPING are never emitted (`vad_controller.py` `_handle_vad` filters them). `ProposedUserStartedSpeakingFrame` (`frames/frames.py:1355`) is an *external provider's* proposal resolved by a strategy, not a retractable VAD edge |
| **HA** `assist_pipeline/vad.py` `VoiceCommandSegmenter` | **Cumulative** 0.3 s of `p > 0.2`; the onset counter re-arms only after `reset_seconds` **1.0 s** of cumulative non-speech (`:76-89`, `:152-171`) [VERIFIED] | before-command **0.2**, in-command **0.5** (`:97-100`) — inverted vs LiveKit (easy start after a wake word) | 0.7 s cumulative silence AND ≥ 1.0 s command; the silence countdown resets only after 1.0 s of *uninterrupted* speech, so blips inside the tail do not extend it (`:172-194`) | none (micro-vad per 10 ms, `audio_enhancer.py:75-84`) | **No** |
| **Wyoming** `endpointing.py` | 0.3 s consecutive `p > 0.2` (`:62-69`) | 0.2 / 0.5 | `silence_seconds` consecutive `≤ 0.5`, min 1 s command (`:71-79`) | none | No |
| **ctrl-b plan** §3.4 | `⌈onset_ms/32⌉` = **7** consecutive `p ≥ act` (onset 200) | `act` 0.6, `deact` 0.45 | `⌈silence_ms/32⌉` consecutive `< deact` | **unstated** | **Yes** — at the first `p ≥ act`, retracted by a cumulative `< deact` hangover or a `2·onset_ms` age bound |

**No peer emits a retractable segment start.** The idea "act early, take it back" exists in the field only at the
**consumer**: LiveKit pauses (not cancels) the reply on a VAD start and resumes it after 2 s without a transcript.

### 2.2 Is ctrl-b's tentative start justified? Quantified

- **Latency it buys.** At `onset_ms` 200 the plain rule confirms at window 7; the tentative start is emitted at window 1.
  `speech_started` arrives **6 × 32 = 192 ms earlier**. Against a LiveKit-style 2-window onset it would buy only 32 ms.
  [REASONED from §3.4's table]
- **What those 192 ms protect.** Not "latency" in the owner-visible sense. The client's D74 transcript energy gate accrues
  dB **only while `m.open`**, which starts at `speech_started` *arrival* (R94 §7.3 ④, L5 §1.6, verified there). A "yes" is
  roughly 250–400 ms of voice; starting accrual 192 ms late would hand the gate about half the word, biasing exactly the
  short answers B5/B6 must keep. The mouth gate also engages 192 ms sooner. [REASONED]
- **Why no peer needs it:** LiveKit's onset is 50 ms (2 windows) — its "tentative" IS its start — and it pays for that with
  false segments that go to STT and die as empty transcripts (`stt/stream_adapter.py:148-151`). Pipecat pays 192 ms of
  onset and simply accepts it. Neither keys an energy gate to the start event's arrival.
- **Verdict: justified, provisional.** It is the price of keeping the client's accrual untouched. When R94 §7.3 (i) (accrual
  on the leg clock, deferred in §7.2) lands, **delete the tentative start and the retraction** and run the plain
  LiveKit/Pipecat shape: consecutive confirmation, pre-roll, one START.
- **Smoothing (finding 8).** The plan inherits LiveKit's consecutive-≥act onset (§2.3) but not the EMA it runs on. Seven
  consecutive raw windows at 0.6 is the strictest onset in the table (Pipecat's 6 raw at 0.7 is the only comparable one).
  The golden vectors are defined over probabilities, so "raw" vs "EMA 0.35" must be written down; the cheapest honest
  answer is an `ema_alpha` field in `VadParams` (0 = raw) A/B'd in the replay tool beside M1.

### 2.3 The end rule

All four peers end on a **silence duration** with hysteresis or its equivalent; HA and Wyoming additionally enforce a
**minimum command length** (1 s) — the plan's equivalent is "onset + `silence_ms`". HA's end rule is cumulative with a 1 s
speech-to-reset, i.e. a built-in hangover: short blips inside the trailing silence do not extend the utterance. The plan's
end is strictly consecutive, which is LiveKit's and Pipecat's choice. **Match.**

### 2.4 The defect the peers' shapes expose (finding 1)

The plan's retraction row: *"When the cumulative `< deact` count reaches ⌈onset_ms/32⌉, OR `2·onset_ms` has elapsed since
the first crossing without confirming ⇒ `stop` + empty `short` final."* Walk a probability that **hovers around `act`**
(0.55–0.65 — soft real speech, a car radio voice): the `[deact, act)` windows keep resetting the confirmation counter but
never add to the `< deact` hangover, so the only exit is the **age bound**: at 400 ms the segment retracts, the client's
awaited set empties, **the mouth gate may open**, and the next `p ≥ act` window (often the very next one) mints a new id.
The cycle repeats every ~400 ms for as long as the hover lasts. That is Q1's defect ("the mouth gate opened between an
utterance's halves") re-entering through the bound. The listed golden vector hovers at `deact ± 0.05`, which stays below
`act` after the retraction and so never exercises the re-arm. [REASONED from the plan text]

**The peer rule that closes it:** HA re-arms the onset counter only after `reset_seconds` (1.0 s) of cumulative non-speech
(`vad.py:166-171`). **Add:** after an age-bound retraction, a new tentative start requires a quiet run of
`⌈onset_ms/32⌉` windows `< deact` first (or: a crossing inside that refractory window continues the retracted id without
re-emitting). **Add the vector:** hover at `act ± 0.05` for 5 s ⇒ at most one start/retraction pair. M1 (count `≥ deact`
toward confirmation) also dissolves it, which is an argument for testing M1 hard before defaulting to strict.

---

## 3. Q2 — max segment and the long utterance

| | Bound | A 30 s utterance | Evidence |
|---|---|---|---|
| **LiveKit** | `max_buffered_speech` 60 s | Nothing happens at 30 s. At 60 s the buffer **stops filling with a warning** ("ignoring further data for the current speech input"); VAD stays in SPEAKING; the END's frames — what `StreamAdapter` sends to STT — are **truncated to the first 60 s** | `silero/vad.py:66`, `:438-450`, `:565` [VERIFIED] |
| **Pipecat** `SegmentedSTTService` | **none** | One 30 s clip (+ 0.5 s trailing zeros) posted after the VAD stop; the buffer grows without bound while `_user_speaking` | `stt_service.py:980-1005` [VERIFIED] |
| **HA** | `timeout_seconds` 15 s | The command **ends** at 15 s (`timed_out=True`); the STT stream stops; the rest is never transcribed | `vad.py:85`, `:139-147`; `default_pipeline.py:500-512` [VERIFIED] |
| sherpa-onnx (L4 §1.3) | 20 s | Raise the threshold to 0.9 and min-silence to 0.1 s until it ends — one segment, forced to end soon | L4 [VERIFIED 2026-09-28] |
| **ctrl-b plan** | 20 s, config-only | Cut at the lowest-probability window of the last 1 s; A final `reason:max_segment`; B confirmed, zero pre-roll; the client **joins** A+B into one turn/phrase (R20) | §3.4, §3.5 ⑤ |

**Verdict: a justified divergence, and the most complete answer in the set.** Every peer either loses audio (LiveKit
truncation, HA's end) or accepts an unbounded clip (Pipecat). None is acceptable for 30-min dictation with a 1.5 GB
single-mutex engine: the plan's Q4 head-of-line arithmetic is what forces a bound, and a bound without a join would split a
monologue into two turns. The join itself is **field-standard in its general form** — LiveKit accumulates every final of a
turn into `_audio_transcript` until the endpointing delay expires (`audio_recognition.py:1249-1250`) — and the client
already owns the mechanism (the pending queue, `useLiveCall.ts:84-89`, `:701-708`). Cutting at the lowest-probability
window is sherpa's instinct done better (a likely inter-word gap instead of a forced early end).

---

## 4. Q3 — pre-roll, and the pre-roll at a split

### 4.1 Pre-roll

| | Pre-roll | Evidence |
|---|---|---|
| LiveKit | `prefix_padding_duration` **0.5 s** before the START (which is itself ≥ 50 ms after the first crossing); the write cursor rewinds to keep the last 0.5 s of a continuous buffer while not speaking | `vad.py:65`, `:463-476`, `:546-547` [VERIFIED] |
| Pipecat | the last **1 s** of audio while not speaking; START comes 192 ms after the first crossing, so ≈ 0.8 s before it | `stt_service.py:863`, `:1003-1005` [VERIFIED] |
| HA / Wyoming | everything since the STT stage opened (the whole command stream); `--vad-clip` then crops to first-speech − 400 ms | `default_pipeline.py:490-517`; `wfw/vad.py:50-53` [VERIFIED] |
| ctrl-b | `prefix_padding_ms` **300** before the FIRST crossing, from a continuous ring | §3.4, §4 |

The plan's ring is continuous (never clamped at the previous segment's end) — the LiveKit property that makes B7 impossible.
**Finding 10:** 300 ms is the smallest in the set **and smaller than the pass's own 400 ms lead pad** (§3.6), so the pass's
`first − 400` crop is always clamped by the segment start. Set the default to **500** (LiveKit): 200 ms of extra ASR audio is
free, and the pass then decides the effective lead-in with one number instead of two that disagree. [REASONED]

### 4.2 At a split, and the resampler's edge mapping

No peer splits a segment, so there is no precedent for split pre-roll. **Zero pre-roll at B is logically forced** — the
audio is contiguous and any overlap re-transcribes words the join would duplicate. **Match by construction.**

**Finding 6 (over-engineering).** §3.4 specifies a numpy streaming polyphase FIR with `feed(a)+feed(b) == feed(a+b)` exactly
and "first/last-boundary mapping within ±1 input sample". The consumers of that precision are: the recovery cut (±350 ms of
slack by design), the pre-roll (300–500 ms), the client's accrual (arrival-keyed, not index-keyed), and the trail. None needs
better than one 32 ms VAD window. Meanwhile, after K6 the 16 kHz main path is an **identity**; the FIR runs only on the
Firefox/Fennec < 148 native-rate fallback. Peers buy this from a library: Pipecat's `SOXRStreamAudioResampler` (VHQ by
default; `audio/resamplers/soxr_stream_resampler.py:31-68`), LiveKit's `rtc.AudioResampler(quality=QUICK)` with *"VAD doesn't
need high quality"* and *"the resampler may have a bit of latency, but it is OK to ignore since it should be negligible"*
(`silero/vad.py:381-385`, `:395-396`). **Simplify:** `soxr.ResampleStream` (python-soxr 1.1.0, cp312-abi3 wheel on PyPI —
MEASURED via the PyPI JSON today, install not tested) or PyAV's `AudioResampler` (already in the `voice` extra; streaming
statefulness REASONED from libswresample, verify before adopting). Keep R96's alias golden test (a 9 kHz tone at 48 kHz ⇒
its 7 kHz alias ≥ 30 dB down) — that is the requirement that matters — and relax edge mapping to ≤ one window.

---

## 5. Q4 — dispatch, concurrency, timeouts, failure

### 5.1 The table

| | Feed | Serialization | Timeout / retry | A failed segment | An empty transcript |
|---|---|---|---|---|---|
| **LiveKit** `StreamAdapter` | per VAD segment, `recognize(buffer)` batch | the `_recognize` loop `await`s each call inline ⇒ serial FIFO per stream; VAD keeps running in its own task and its events queue (`stream_adapter.py:115-163`) | the wrapped STT's `APIConnectOptions`: **timeout 10 s**, `max_retry` 3, 2 s interval, first retry immediate (`types.py:124-135`; `stt.py:216-272`); the adapter's own stream has `max_retry=0` (`stream_adapter.py:16-19`) | after the retries the exception **kills the whole recognize stream**; `AudioRecognition` recreates it after 0.5 s (`audio_recognition.py:59`, `:200-231`) — a **new VAD stream, state reset**, queued segments lost; the session closes after > 3 consecutive unrecoverable STT errors (`agent_session.py:170-176`, `:1988-2008`) | skipped — no event at all (`stream_adapter.py:148-151`); the turn is not committed without a transcript (`audio_recognition.py:1520-1522`) |
| **LiveKit** `FallbackAdapter` | wraps N STTs | — | `attempt_timeout` 10 s, `max_retry_per_stt` 1, `retry_interval` 5 s; marks a provider unavailable and probes it in the background (`stt/fallback_adapter.py:52-60`, `:34-38`) | walks to the next provider | — |
| **Pipecat** `SegmentedSTTService` | per VAD segment, WAV (`wants_wav_segments`) | one `_segment_task` drains an `asyncio.Queue` in order (`stt_service.py:853`, `:958-968`) | none of its own; the Whisper-family service uses the OpenAI SDK client's default unless you pass `http_client` (`whisper/base_stt.py:158-166`, `:233`) | `push_error(...)` (non-fatal `ErrorFrame`), segment dropped, loop continues (`stt_service.py:966-968`) | dropped unless `push_empty_transcripts=True` (default False, `whisper/base_stt.py:144`, `:282-293`) |
| **HA** | one command per pipeline run, streamed to the Wyoming server which buffers to WAV and transcribes at `AudioStop` (`wyoming/stt.py:157-197`; `wfw/dispatch_handler.py:87-139`) | one command at a time | the pipeline run's 300 s overall timeout (`const.py:9`); no per-request STT timeout found (`wyoming/stt.py`, grep) | `SpeechToTextError("stt-stream-failed")` ends the run (`default_pipeline.py:458-470`) | `SpeechToTextError("stt-no-text-recognized")` (`default_pipeline.py:472-475`) |
| **ctrl-b plan** | per segment, WAV via `VoiceClient.transcribe(door="live")` | per-leg serial worker; transcripts FIFO; stops emitted immediately | live door's OWN 10 s / 3 s; D40 gate `max_concurrent_requests: 1` walks to the next hop after `connect_timeout_s`; no same-provider retry | `asr_error` final + `error{upstream_error,item_id}`, **the leg survives**; after one timeout the already-queued segments answer `asr_error` without the engine; dictation's first `asr_error` = DEGRADE | empty final with a typed `reason` |

### 5.2 Verdict

- **Serial FIFO per stream: universal. Match.**
- **10 s timeout: matches LiveKit's default** (both `APIConnectOptions.timeout` and `FallbackAdapter.attempt_timeout`).
- **Fallback chain: matches** LiveKit's `FallbackAdapter`; the D40 gate's "walk after `connect_timeout_s` instead of parking"
  is the same instinct as LiveKit marking a provider unavailable. No per-provider retry is the right call for a 1-mutex local
  engine (a retry only queues behind the same mutex).
- **Failure isolation: the plan is better than every peer.** LiveKit's batch path turns one failed segment into a torn-down
  stream and a reset VAD; Pipecat and LiveKit drop empty/failed segments silently; HA ends the run. ctrl-b's per-segment
  typed answer with a surviving leg is the strictest contract here. **Justified divergence — keep.**
- **The "after one timeout, queued segments answer `asr_error` without the engine" rule** is a per-leg circuit breaker with
  no named reset. It is fine as written (only segments queued *at that moment* skip), but say so explicitly in §3.4 so a
  builder doesn't turn it into a latched breaker.

### 5.3 The watchdog every peer has and the plan does not (finding 2)

Because peers do **not** guarantee an answer per stop, they all bound the wait by time: LiveKit's `transcription_timeout`
(`audio_recognition.py:1969-1988`; off by default, `agent_session.py:414`), Pipecat's `stt_timeout` from the provider's P99
plus `user_turn_stop_timeout` **5.0 s** (`turns/user_turn_controller.py:90`), HA's 300 s run timeout. The plan's D9 set
clears on `ready`/`socketLost`/mute and on an id-less `upstream_error` — **never on time**. "One answer per stop" is an
invariant of the relay's code; the client should not stake the mouth on it. **Add** to §3.9 ①: an id awaited longer than
`live.timeout_s` + a margin (the relay's own worst case) is dropped from the set and logged as a trail anomaly. Cheap, and it
converts a wedged call into a logged defect.

---

## 6. Q5 — the pre-ASR no-speech pass

### 6.1 Who has one

| | Second pass on the cut segment? | Evidence |
|---|---|---|
| LiveKit | No — the END's frames go straight to `recognize()` | `stream_adapter.py:130-146` [VERIFIED] |
| Pipecat | No VAD re-check; appends **0.5 s of zeros** to every segment before posting | `stt_service.py:815-817`, `:831`, `:940` [VERIFIED] |
| HA core | No | [VERIFIED by reading `default_pipeline.py`] |
| **Wyoming faster-whisper** | **Yes, two, both opt-in:** `--vad-clip` = pysilero-vad crop to `[first − pad, last + pad]`, **threshold 0.5, pad 400 ms** (*"reduces Whisper hallucinations on silence and shortens the audio"*); `--vad-filter` = faster-whisper's Silero filter (*"can reduce hallucinations"*) | `wfw/vad.py:1-53`; `__main__.py:114-161`; `dispatch_handler.py:200-212` [VERIFIED] |
| ctrl-b plan | Yes, authoritative: fresh-state Silero, 0.5 / neg 0.35 / min-silence 160 / pad 400 / split > 30 s; **no speech ⇒ skip ASR** | §3.6 |

**Verdict: keep (R5 is right).** The batch-ASR-behind-a-VAD class — the class ctrl-b is joining — ships exactly this crop with
exactly these constants. One divergence, justified: Wyoming's clip **falls back to the full audio** when it finds no speech
(`wfw/vad.py:75-78`); the plan **skips ASR** and answers `no_speech`. For ctrl-b's failure mode (phantom fillers from
non-speech) skipping is correct; the recall cost on very soft short answers is what T10's hit rate watches. Expect the pass to
fire rarely on calls (a stateful Silero at 0.6 confirmed the segment already) and to be **the** filter in dictation
(`onset_ms` 0) — §3.4 already says so.

### 6.2 Trailing context (finding 7)

Pipecat's docstring names the failure the plan lists as B8: *"A segment ends right where the VAD stopped, and models tend to
drop or garble the final word when the audio ends that abruptly, so each segment is padded with `trailing_silence_secs` of
silence before transcription"* (`stt_service.py:815-817`). An `endpoint` segment already carries `silence_ms` of real
trailing audio, so the crop's `last + 400` is honoured. **Two segment kinds are not:** A of a `max_segment` cut (it ends at
the cut) and the release-time flush (the owner taps stop right after the last word). **Add to §3.6:** when the audio after the
last speech window is shorter than `PREPASS_PAD_MS`, pad zeros to it. One line, and it covers the two places the join and the
flush most need a clean final word.

---

## 7. Q6 — a dead transport mid-utterance: recovery and reload

### 7.1 What peers do

| | Transport | Dead link mid-utterance | Recovery of the lost audio | Reload survival |
|---|---|---|---|---|
| LiveKit | WebRTC via an SFU | The SFU/ICE layer reconnects; the session closes only on `CLIENT_INITIATED`/`ROOM_DELETED`/`USER_REJECTED` (`room_io/types.py:17-21`, `:128`) | **None** — RTP audio during the outage is simply gone | none (a reload is a new participant) |
| Pipecat | WebRTC or raw-PCM WebSocket | `VADController.audio_idle_timeout` 1.0 s: no frames while SPEAKING ⇒ force `on_speech_stopped` (`vad_controller.py:74`, `:202-222`); WebSocket `session_timeout` optional (`transports/websocket/fastapi.py:65`, `:322-324`) | none | none |
| HA | satellite/browser stream | the run errors or times out | none (debug recordings are diagnostic) | none |
| Deepgram (L4 §2.1, REPORTED) | WS | — | **recommends buffering audio during a disconnect and re-sending it** — the only field precedent for "keep the audio, replay the gap" | — |
| ctrl-b plan | raw PCM over WS + the MediaRecorder clip | the recording outlives the leg; finals freeze at the last contiguous endpoint | the clip is uploaded once to the clip door with `from_ms` | S8b: IndexedDB timeslice chunks |

### 7.2 What does not transfer, and why

- **Pipecat's idle-forced stop must NOT be copied.** It is a wall-clock rule; on ctrl-b's TCP uplink a 4G stall delivers the
  audio *late, not lost*, and the leg clock (§3.2) makes the stall invisible to segmentation. A wall-clock forced stop would
  cut real utterances in exactly the conditions A1–A3 describe. The plan's sample-clock design is the correct one for this
  transport. [REASONED]
- **The WebRTC peers' "lose it" posture is fine for them** — conversational turns of seconds, where a lost word is re-asked.
  ctrl-b's dictation is 30-minute long-form; losing a minute is the owner's A1 complaint. Recovery via the already-recorded
  clip is the leanest possible mechanism (no PCM ring, no reconnect-and-resend protocol, no new decoder). **Justified
  divergence; the plan already cut it to its lean form (council 5).**
- **S8b has no precedent anywhere in the set.** It is owner scope (R22), not a field reliability norm. Its fragile part is the
  multi-tab ownership logic; keep it as small as §3.8 states and resist growth.

### 7.3 The mapping (finding 4)

§3.8: `from_ms = (t_leg0 − t_rec)·1000 + boundary − silence_ms/2`, "mapping error ≲ 100 ms ≪ the 350 ms slack". That error
budget holds **at the start of the recording**. `boundary` is a leg-clock sample index converted at the context rate, i.e. it
assumes the worklet delivered every input sample for the whole dictation, in step with the MediaRecorder's timeline of the
same track. Anything that makes the worklet skip input — a render-thread overrun, an `AudioContext` suspend/resume, a
device change — shifts every later boundary by the skipped span, silently, and the slack is **fixed** while the drift
**accumulates** over up to 30 minutes. The worklet already stamps each frame with its own `t` (§3.8 uses the first one).
**Add:** keep a small ring of `(leg_index_of_frame, frame.t)` pairs (one per frame or per second) and map the boundary through
the frame that contains it: `from_ms = (t_frame(boundary) − t_rec)·1000 + offset_within_frame − silence_ms/2`. It removes the
linearity assumption for the cost of a few kB. No peer does this because no peer recovers. [REASONED — Chrome-Android input
skipping under load is not measured here; the point is that the formula has no defence if it happens]

---

## 8. Q7 — backpressure on the uplink

| | Guard | On violation | Evidence |
|---|---|---|---|
| LiveKit | none at the agent (WebRTC jitter buffer + congestion control upstream); the VAD input channel is unbounded (`aio.Chan(maxsize=0)`); a **log** when inference runs > 0.2 s late | log only | `utils/aio/channel.py:50-56`; `silero/vad.py:38`, `:452-461` [VERIFIED] |
| Pipecat | none; `BaseInputTransport._audio_in_queue = asyncio.Queue()` unbounded | — | `transports/base_input.py:260` [VERIFIED] |
| HA | none found | — | [VERIFIED absence by grep in `assist_pipeline`] |
| Deepgram / AssemblyAI (L4 §2.1, REPORTED) | ≈ 1.25× real-time token bucket | **throttle**; AssemblyAI closes only at > 5 min buffered | L4 |
| ctrl-b plan | wall-clock audio-ms bucket + frame twin, ε 0.02, C derived = 12 580 ms, two equality pins | **1008 close** | §3.3 |

**Verdict.** The *invariant* ("a real-time source cannot be ahead of the wall clock") is sourced (L4) and correct. The
*close* posture diverges from the pacing services but is justified: C exceeds the keepalive horizon, so a stall long enough
to exceed C has already killed the socket by keepalive (K4); throttling a TCP reader only relocates the kill to the client's
`bufferedAmount` ceiling (L4 §2.2). **What is over-built is the exactness (finding 5).** A C derived to the millisecond and
held by two cross-language equality pins (`KEEPALIVE_HORIZON_MS` parsed from launch flags; `BUCKET_CAP_MS` read out of
`uplinkPacer.ts`) turns every future tweak of a client reservoir into a failing test even when it changes nothing that
matters. The pins exist to keep C *tight*; tightness buys nothing here (at 16 kHz PCM16, 30 s of audio is ~1 MB, and the VAD
drains at hundreds of × real time). **Replace with:** a constant C comfortably above the sum (e.g. 30 000 ms) and one test
asserting `C ≥ KEEPALIVE_HORIZON_MS + Σ client reservoirs`. Same guarantee (a legit client cannot trip it), no coupling. Keep
the frame-count twin (it is cheap and guards the tiny-frame flood the audio-ms bucket cannot see).

**The missing runtime rule (finding 9).** The plan has a VAD *budget* (p95 per window < 32 ms, `emit_lag_ms` p95 < 60 ms) but
no *action*. The dictation enqueue is lossless by design (Q3), so if the `vad` worker stalls (CPU contention on the shared
box, R19), the per-leg queue grows until memory says otherwise, and the mouth/finals simply stop. LiveKit logs and carries on;
that is acceptable for its 1-minute turns, not for a 30-minute dictation. **Add:** `emit_lag` above a hard ceiling (a few
seconds) ⇒ `ear_failed` ⇒ calls get the typed failure, dictation degrades into S8's recovery — both paths already exist.

---

## 9. Q8 — the structure

### 9.1 Where each draws its boundaries

| Stage | LiveKit | Pipecat | HA | ctrl-b plan |
|---|---|---|---|---|
| Model | `OnnxModel` (context + state carry) `silero/onnx_model.py:53-103` | `SileroOnnxModel` (+ 5 s reset) `silero.py:22-23`, `:214-220` | micro-vad in `AudioEnhancer` | ORT wrapper in `voice_vad.py` |
| Temporal policy | **fused** into `VADStream._main_task` with buffering + events (`silero/vad.py:295-599`) | `VADAnalyzer._run_analyzer` — policy + model call in one method (`vad_analyzer.py:194-248`) | **pure** `VoiceCommandSegmenter.process(chunk_seconds, prob) → bool` (`vad.py:131-196`) | **pure** `step(state, probs, first_index) → (state, edges)` over frozen `VadParams` |
| Segmenter / audio buffer | same `VADStream` (speech buffer, pre-roll rewind) | `SegmentedSTTService` (pre-roll, buffer, trailing zeros) | the pipeline's stream generator | `SileroSegmenter.feed/flush` |
| Events | `VADEvent` START/INFERENCE_DONE/END | `VADController` → frames | pipeline events `STT_VAD_START/END` | `speech_started/stopped/transcript/state:flushed` |
| Batch STT adapter | `StreamAdapter` | `SegmentedSTTService._segment_task_handler` | Wyoming client | per-leg ASR worker + prepass + `VoiceClient.transcribe(door)` |
| Provider fallback | `FallbackAdapter` | `ServiceSwitcher` (not read) | — | `provider_registry` chains + D40 gate |
| Turn aggregation / endpointing | `AudioRecognition` + `EndpointingOptions` + EOU model | `UserTurnController` + start/stop strategies | the pipeline (one command = one turn) | the client reducer (pending queue, D9, the R20 join) |
| Interruption | `AgentActivity` (min 0.5 s, pause/resume, false-interruption 2 s) | user-start strategies + interruption frames | — | the phone (energy-gated barge-in, D74) — unchanged |
| Transport | `room_io` (WebRTC) | transports (WebRTC/WS) | satellite protocol | `liveSocket` / `_accept_audio` + bucket |

**The plan's policy/segmenter split is the best-factored in the set** — HA's pure `process()` is the only peer with the
policy separated from the model and the buffer, and it is also the only one that is trivially unit-testable over
probabilities. The hand-authored golden vectors are the right discipline on top of it.

### 9.2 Boundaries peers found necessary that the plan lacks

1. **A turn-endpointing stage distinct from the VAD's end (finding 3).** LiveKit: VAD `min_silence_duration` 0.55 s, then
   `EndpointingOptions.min_delay` 0.5 s (max 3.0 s, `turn.py:133-145`), measured from the last speaking time so it "effectively
   behaves like max(VAD silence, min_endpointing_delay)" (`agent.py:803-810`); a new START cancels the pending end of turn
   (`audio_recognition.py:1415-1417`) and finals accumulate (`:1249-1250`). Pipecat: VAD `stop_secs` 0.2 s, then
   `user_speech_timeout` 0.6 s + transcript required (`speech_timeout_user_turn_stop_strategy.py:52`). **ctrl-b uses
   `silence_ms` for both.** Consequences today: (a) at R23's 3000 ms, ASR cannot start until 3 s after the owner stops,
   serializing the owner's patience in front of the engine's latency instead of overlapping them; (b) the "above ~3.2 s an
   echo's final would land past the 4 s echo window — hence 3000" ceiling exists *only* because segment end = turn end. With a
   short VAD end (500–700 ms) and a client-side turn-wait hold on the **existing** pending queue (restarted by `speech_started`,
   one more hold reason beside `confirmHold`/`heldUpload`, `useLiveCall.ts:690-699`), the owner gets long pauses, ASR runs
   during the wait, echo finals arrive early, and the R20 join becomes a special case (a `max_segment` final simply carries no
   remaining turn wait). **Not needed while the owner stays near the 700 default** — R23 says he tests the default first. It is
   the field's answer the moment he raises it.
2. **A time bound on awaiting a transcript** (§5.3, finding 2).

### 9.3 Boundaries the plan has that no peer needs — each justified

- **The leg sample clock + `ready.clock` capability bit + receipt stamping.** Peers either sit on WebRTC (timestamps from RTP)
  or never recover; ctrl-b's recovery and bounds need one clock across a lossy TCP link. Justified.
- **The typed `reason` on every final and the D9 set.** Peers do not promise an answer per stop. Justified (and see 5.3).
- **Two ASR doors (live vs clip) as separate engine instances.** No peer has a 30-min clip recovery competing with live turns
  for a single-mutex local engine; the plan's Q4 arithmetic justifies it.
- **The derived bucket and the hand-rolled FIR** — the two that do NOT earn their weight (§8, §4.2).

---

## 10. Verdict for the owner, in plain words

**The plan is sound, and on the things that decide whether a call or a dictation survives, it is more careful than LiveKit,
Pipecat or Home Assistant.** Those projects drop failed or empty segments silently and then need timers to un-stick
themselves; they lose audio across a network drop; one of them resets its speech model every 5 seconds. The plan does none of
that. Its engine core — the model, its settings, the thresholds, the serial worker, the crop before the ASR — is what the
field does, often with the same numbers.

**Where it is different on purpose, the reasons hold:** the early "maybe speech" signal exists to keep the phone's existing
noise check from seeing only half of a short "yes"; the 20-second cut-and-join exists because 30-minute dictation cannot
tolerate what the peers do (truncate, stop, or grow forever); re-uploading the recording after a dropped connection exists
because nobody else records 30 minutes at a time.

**Cut two things:** the millisecond-exact upload allowance with its two cross-file equality tests (use a generous fixed number
and one "is it big enough" test), and the home-made anti-aliasing filter for a fallback path (use a library; keep the one test
that proves it doesn't alias).

**Add four things before building, in this order:** (1) after the early signal is withdrawn for taking too long, don't
re-trigger until there has been a moment of quiet — otherwise a mumble or a radio voice makes the ear flicker and a reply can
start over you; (2) the phone should give up waiting for a transcript after the engine's own timeout instead of waiting
forever; (3) map the recovery cut through each audio frame's own timestamp, not a straight-line count over 30 minutes;
(4) pad the end of a cut or released segment with a little silence so its last word isn't garbled. Then four small ones: say
whether probabilities are smoothed, start 500 ms before speech instead of 300, turn a hopelessly lagging ear into the existing
"ear failed / recover the recording" path, and — only if you raise the pause setting well above its default — split "the
ear heard silence" from "your turn is over" the way LiveKit and Pipecat do.

---

## 11. Method

- **Clones** (2026-09-30, shallow, `~/.cache/tmp/r97/`, safe to delete): `livekit/agents` `d251b89`, `pipecat-ai/pipecat`
  `20999cd`, `home-assistant/core` `084651e` (sparse: `assist_pipeline`, `stt`, `wyoming`), `rhasspy/wyoming-faster-whisper`
  `f8e8b0e`.
- **Read in full:** LiveKit `livekit-plugins-silero/.../vad.py`, `onnx_model.py`, `livekit-agents/.../vad.py`,
  `stt/stream_adapter.py`; Pipecat `audio/vad/vad_analyzer.py`, `vad_controller.py`, `services/stt_service.py`
  (`SegmentedSTTService`), `turns/user_stop/speech_timeout_user_turn_stop_strategy.py` (head); HA `assist_pipeline/vad.py`,
  `default_pipeline.py` (STT stage), `audio_enhancer.py`, `run.py` (debug recording); Wyoming `vad.py`, `endpointing.py`.
  **Read in part:** LiveKit `stt/stt.py`, `stt/fallback_adapter.py`, `voice/audio_recognition.py`, `voice/agent_activity.py`,
  `voice/turn.py`, `voice/agent_session.py`, `voice/room_io/types.py`; Pipecat `audio/vad/silero.py`,
  `services/whisper/base_stt.py`, `transports/base_input.py`, `turns/user_turn_controller.py`, `frames/frames.py`.
- **MEASURED:** PyPI JSON (2026-09-30) — `soxr` 1.1.0 wheels `cp312-abi3`, `cp314-cp314t`, …; `av` 19.0.0 (uploaded
  2026-09-29) wheels `cp312-abi3`, `cp314-cp314t`. LiveKit's bundled `silero_vad.onnx` SHA-256
  `94db2e7699ae99354c5c572e77d220e7a29611b516b674a2631f4bfff691d6f0`; Pipecat's MD5 `00bdd41445da13fe3d52a5a074013aa1`.
- **Not done, and why:** no code was run against the peers; no ctrl-b code was touched; Chrome-Android worklet input-skip
  behaviour (§7.3) was not measured; Pipecat's `ServiceSwitcher` and LiveKit's adaptive-interruption model were not read
  (out of the engine's scope).

## 12. Corrections and gaps

- **Correction to ASR_PLAN §2.3 (inheritance).** "LiveKit/sherpa's … consecutive-`≥ act` confirmation" is right, but LiveKit
  applies it to an **EMA-smoothed** probability (`silero/vad.py:423`); the plan inherits the rule without the smoothing. Record
  the choice (§2.2).
- **Correction to R94 §7.2.1.** "Run it on a single-worker executor (the LiveKit/Pipecat shape)": Pipecat does
  (`vad_analyzer.py:92`); **LiveKit uses the loop's default executor** (`run_in_executor(None, …)`, `silero/vad.py:422`) and
  gets its serialization from awaiting each window. The plan's single `vad` thread with batched drain is stricter than both —
  fine.
- **Re-verified from L4 §1.3 at current main (unchanged):** LiveKit defaults 0.05 / 0.55 / 0.5 / 60 / 0.5 and `deact = act −
  0.15`; Pipecat 0.7 / 0.2 / 0.2 / 0.6 and the 5 s state reset. **Updated:** L4 recorded LiveKit's bundled model hash as
  `ebcdad74…`; today's bundled file hashes to `94db2e76…` (the model file changed since `57b3227`; its Silero version is still
  UNCONFIRMED here).
- **New to the ledger:** LiveKit's `VADStream.flush()` **discards** the open segment (docstring `vad.py:155-162`; the Silero
  stream resets on the sentinel, `silero/vad.py:357-359`) — the opposite of the plan's force-endpoint, correctly so for
  dictation. Wyoming ships the plan's exact pre-pass constants (0.5 / 400 ms) as `--vad-clip`. HA's segmenter is the only
  peer with a cumulative hangover and a re-arm delay (`reset_seconds`).
- **Gaps:** whether python-soxr's `ResampleStream` / PyAV's `AudioResampler` meet R96's alias bound and expose their delay
  for edge mapping (verify before adopting finding 6); Silero onset-lag numbers for soft onsets (would size finding 10
  precisely); the owner's actual `silence_ms` preference (decides whether finding 3 is needed at all).

## Sources (all cloned or fetched 2026-09-30)

- `livekit/agents` @ `d251b89` (2026-09-30): `livekit-plugins/livekit-plugins-silero/livekit/plugins/silero/{vad.py,onnx_model.py}`;
  `livekit-agents/livekit/agents/{vad.py,types.py,utils/exp_filter.py,utils/aio/channel.py}`;
  `livekit-agents/livekit/agents/stt/{stream_adapter.py,stt.py,fallback_adapter.py}`;
  `livekit-agents/livekit/agents/voice/{audio_recognition.py,agent_activity.py,agent_session.py,agent.py,turn.py,room_io/types.py,room_io/_input.py}`.
- `pipecat-ai/pipecat` @ `20999cd` (2026-09-29): `src/pipecat/audio/vad/{vad_analyzer.py,vad_controller.py,silero.py}`;
  `src/pipecat/services/stt_service.py`; `src/pipecat/services/whisper/base_stt.py`;
  `src/pipecat/audio/resamplers/soxr_stream_resampler.py`; `src/pipecat/transports/{base_input.py,websocket/fastapi.py}`;
  `src/pipecat/turns/{user_turn_controller.py,user_stop/speech_timeout_user_turn_stop_strategy.py,user_start/vad_user_turn_start_strategy.py}`;
  `src/pipecat/frames/frames.py`.
- `home-assistant/core` @ `084651e` (2026-09-30): `homeassistant/components/assist_pipeline/{vad.py,default_pipeline.py,audio_enhancer.py,run.py,const.py,models.py,websocket_api.py}`;
  `homeassistant/components/stt/models.py`; `homeassistant/components/wyoming/stt.py`.
- `rhasspy/wyoming-faster-whisper` @ `f8e8b0e` (2026-09-29): `wyoming_faster_whisper/{vad.py,endpointing.py,dispatch_handler.py,__main__.py}`, `README.md`.
- PyPI JSON API: https://pypi.org/pypi/soxr/json, https://pypi.org/pypi/av/json (fetched 2026-09-30).
- ctrl-b (read-only): `docs/ASR_PLAN.md` (uncommitted, 2026-09-30), `frontend/src/hooks/useLiveCall.ts` (the pending queue,
  `held()`), R94 §6–§7, R95 §7, R96 §1, R94-evidence/L4 §1.3 and §2.
