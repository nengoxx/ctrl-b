# ASR plan — live voice stops depending on Speaches: the relay owns the VAD, ASR is a batch provider per door, the recording outlives its leg

> **Status: ✏️ DESIGN — plan of record for Phase 26 ([TODO](./TODO.md)) / [D82](./DECISIONS.md), written 2026-09-30
> (session 53); council №1 (blind Opus 5.5 ∥ Emma, both BUILD WITH CHANGES) folded in full over six waves; **Opus CONFIRMED BUILD · Emma closed on the last wording line (§11)**. NOTHING BUILT.**
> Order: **S5 — D82 ratified THIS session, before session A** → session **A** on dev (transport, the dictation
> rulings, 16 kHz capture) → session **B** on dev (the host on the clip door, raw-audio capture and hand tuning, then THE FLIP — ctrl-b off Speaches in one config move) → **TWO releases (owner,
> ruled at close): v1.7.11 = the six polish fixes + session A** once A's field checks pass (Speaches still the ear) · **v1.7.12
> = session B** once B's criteria (§6.4) pass. This file owns the ASR/VAD design;
> [`LIVE_VOICE_PLAN.md`](./LIVE_VOICE_PLAN.md) keeps the call loop, the mouth and the client admission layer. Evidence:
> [R94](./research/R94-asr-audits-verification.md) · [R95](./research/R95-vad-placement.md) · [R96](./research/R96-16khz-capture.md) ·
> [R97](./research/R97-peer-engine-design.md) · [R98](./research/R98-vad-model-landscape.md) (the VAD-model landscape + the plug-in boundary — the §3.4.1 amendment, 2026-10-01).

## 0. How to read this

Precedence on conflict: the rulings (§0.1, incl. council №1) > the stress-test audit (folded, recorded in §3.10) >
R98 (the §3.4.1 model boundary; supersedes §3.4's v5 pin) > R97 > R96 > R94 > R95. Slices keep R94 §10's S1–S10 numbering; session A adds **SP**, **K6**, **D9**, **D8**, **D5**;
S4 is withdrawn. Session B runs S6-i → S6-ii → S9 → TUNE → S7a (client half) → S7b (the flip) → field rounds → S8 → S8b → S10 (§7.2). `R94-evidence/L2` (private transcripts) is
never cited, committed, or named in a brief. §10.1 maps the HANDOFF agenda's A7, §B and §C (A1–A6
are the polish ledger, `POLISH_LEFTOVERS`; §D is housekeeping — neither is this plan's).

### 0.1 The rulings this plan executes (2026-09-30)

| # | Ruling | By |
|---|---|---|
| R1 | **TWO releases (ruled at session close, Option B):** v1.7.11 = the six polish fixes + session A (Speaches still the ear; no config migration; rollback = plain `update.sh v1.7.10`) · v1.7.12 = session B (the flip's one config move at release; rollback = config restore + `update.sh v1.7.11`). Each built and field-checked on dev first (§8) | owner |
| R2 | D3: `onnxruntime` + `numpy` into the backend — as an optional `voice` extra (council 11) | owner |
| R3 | D4: clip-door decoding inside ctrl-b's pre-ASR pass — **PyAV** (cp314 abi3 wheel verified; council 15) | owner |
| R4 | parakeet-server primary, one instance per door; NEW-engine fallbacks later; engines = config via the registry | owner |
| R5 | D10: keep the pre-ASR no-speech pass | owner |
| R6 | Record = this file + D82 + TODO Phase 26 | owner |
| R7 | S6b (phone probe) DEFERRED | owner |
| R8 | D7: Kokoro out of the TTS chain → PocketTTS → vault-alltalk, an explicit prod ops step | owner |
| R9 | Recording + keeping the owner's raw call/dictation audio on emma: OK, outside git | owner |
| R10 | Interim Speaches ops SKIPPED; their demands (model resident · info logging) bind the new engine unit. The "127.0.0.1 only" demand is WITHDRAWN (evening ruling): engines listen on 0.0.0.0 like Speaches and the owner's other services, under SECURITY_MODEL §2.1's LAN trust | owner |
| R11 | K6 in session A: a 16 kHz `AudioContext` at both sites, native-rate capability fallback, no worklet decimation (R96) | main seat |
| R12 | D1: a guard violation closes 1008 | main seat |
| R13 | D2: tentative start (ii), client unchanged — as amended by Q1 and council 7 | main seat |
| R14 | D5: slot takeover by client identity, session A's tail | main seat |
| R15 | D9 awaited-id set REQUIRED; S1 telemetry + R95's pacer-drop field IN | main seat |
| R16 | C1 relay-owned stateful Silero, placement-agnostic; C2-H = the named exit | main seat |
| R17 | The relay's 16 kHz path is ANTI-ALIASED by a LIBRARY resampler (PyAV, verified) with one alias golden test (R96 §3; council 13; R97 P-7) | main seat |
| R18 | **Speaches is NEVER stopped or deleted by this phase** — ctrl-b only un-configures it; the fork stays at `~/github/speaches`; parakeet.cpp is cloned next to it | owner |
| R19 | **Engines are machine-wide user units, shared by dev + prod and other consumers** (PocketTTS precedent); install.sh never manages them | owner |
| R20 | **A `max_segment` cut is not a pause** — its final is JOINED with the next segment into ONE turn/phrase (both modes) | owner |
| R21 | P1 threshold = relative 10 dB over the noise tracker · P2 = 1800 s cap / 2100 s relay | owner |
| R22 | **S8b reload survival RULED IN** — a full slice right after S8 (§3.8, §7.2) | owner |
| R23 | The owner's longer-pause intent ("test 0.7 first; widen to 3000") — **re-shaped by R97 P-3:** `silence_ms` stays the VAD end (500–1200); a longer pause is the client `turn_hold_ms` (0–3000, default 0). **Option A RULED 2026-09-30** — R23 closed as re-shaped; S7a/S7b unblocked | owner |
| R24 | **NO SHADOW MODE, NO SPEACHES BASELINE, NO SEAMS PRODUCTION WON'T USE.** Speaches is replaced because it hallucinates and fails in noise, so it is no reference. The new ear is tuned BY HAND on captured reference audio with an OFFLINE replay tool; the one runtime addition is a debug-gated raw-audio capture. The ASR host swaps on the clip door BEFORE the live flip, so the flip removes Speaches from the live and TTS routes in one move | owner |
| R25 | **The VAD is a plug-in behind ONE model boundary (§3.4.1, R98, 2026-10-01):** `VadModel`/`VadStream` + a dict of constructors; `VadParams` in ms with the EMA as a time constant; every count derived from the model's hop; a per-model calibrated `default_act`; non-causal models refused on the live door; **the default model is Silero v6.2 (v5.1.2 stays registered as the replay A/B)** — owner: "agnostic … I don't want a big refactor later"; the main seat ruled the shape on R98's evidence | owner + main seat |
| Q1–Q4 | The stress-test amendments, ACCEPTED (§3.10) | main seat |
| C1–C28 | Council №1's reconciled rulings (`RULINGS-P.md`), all folded (§11 lists where) | main seat |
| M-1…M-4 · P-1…P-7 · T-1…T-12 | The main-seat read, R97's peer-engine check and the traceability audit — all folded (§11) | main seat |

Carried from R94 §11.0: **P3** foreground-only + a wake lock if clean · **D6** an unreachable ASR never refuses a call ·
**D8** a provisional early-call floor.

---

## 1. The problem (R94 §1, §3–§5)

**A — recordings and calls die mid-session.** The relay's flood guard (`_note_frame`, 100 frames / rolling 2 s on the
server's READ clock) killed five legs on 2026-09-28, one probably a call: 4G/Serve stalls deliver bunches that read as a
flood past a ~2 s stall (~1 s in dictation's post-`ready` drain). K2 (client backlog), K3 (`bufferedAmount`) and K4 (5+5 s
keepalive) turn the same hiccup into the same stopped mic; K5 holds the only slot ≤ 10 s after a relay close; K6 ships
48 kHz raw PCM. Structurally, **the live leg owns the microphone's lifetime** (R70 ③).

**B — phantom "Yeah." / "Mm-hmm." turns.** Speaches reruns a zero-state batch Silero over the last 3 s per 40 ms append:
**flaps** (34/66 segments of 0–201 ms), **the 3 s pin** (21/21), **onset clipping** (the buffer rotates per stop). A hidden
second VAD in its HTTP door empties ~21% of segments. The car "Yeah." was the echo tail (D80's domain).

| Class | Symptom → mechanism | Fixed by |
|---|---|---|
| A1 | Dictation stops ≤ 1 min → K1 1008 → finals>0 ⇒ `stop()` | S2 + S8 |
| A2 | Stops with no server line → K2/K3 | S1 · S3 · S8 |
| A3 | Stalls > 5–10 s → K4 | S8 (dictation); the reconnect ladder (calls) |
| A4 | Call ends "connection had a problem" → K1 typed protocol = terminal | S2 |
| A5 | Re-open gets `busy` → K5 | D5 |
| A6 | Idle / 120 s / hidden stops → policy timers | SP |
| B1/B2/B7 | Flap fillers · pinned ~3 s fillers · clipped first word | S7b (the flip), by construction |
| B3 | Filler right after the reply → echo tail | D80 (shipped) |
| B4 | Quiet false turn early in a call | D8 |
| B5/B6 | Distant real speech · real short answers | level gate unchanged · tests (no lexical filters) |
| B8 | Garbled/empty final → slicing, trailing silence | the §3.6 crop |

---

## 2. Principles, binding decisions, inheritance

### 2.1 Invariants (R94 §6, sharpened by R95 §10.1, the stress test and council №1)

1. **The microphone session is authoritative**; transcription lanes are degradable consumers.
2. **ctrl-b owns turn semantics**; engines answer only "is this speech?" and "what words?".
3. **A real-time source cannot be ahead of the wall clock by more than a fixed allowance** (`UPLINK_ALLOWANCE_MS`, 30 s)
   that a load-validated inequality proves covers every reservoir between mic and relay (§3.3).
4. **Every stopped segment gets exactly one answer; transcripts are FIFO per leg.** Stops are emitted when they happen;
   the client's awaited-id set (D9) carries the ordering the old boolean needed.
5. **One sample clock per leg** (§3.2) — bounds, telemetry and the recovery boundary all speak it.
6. **Reuse the seams** — batch STT through `provider_registry → ResolvedTarget → VoiceClient` (incl. the D40 gate); VAD
   config in `LiveCfg`; the existing trail, pacer, ledger, MediaRecorder clip and wire vocabulary.
7. **One variable at a time** — S9 moves only the CLIP door (the parakeet host and providers, the stt chain, decode into ctrl-b,
   the pass authoritative on clips, `transcribe(door)`; the live ear is untouched); the flip (S7b) moves the live ear as
   ONE unit — relay VAD + parakeet-live — whose two parts were each exercised first: the host on clips (S9), the VAD on the
   replayed reference set (TUNE). After the flip no LIVE or TTS route references `emma-speaches`/Kokoro after the flip; the pre-existing `vault-speaches` clip fallback and the `emma-speaches` provider definition (rollback) remain (R24, E-L2).
8. **Every automatic stop, every leg end and every worker failure carries a reason, always logged.**
9. **Placement is a detail** — a pure policy over probabilities + sample indices with hand-authored golden vectors;
   leg-sample bounds; a one-method segmenter interface.
10. **Correctness bounds are simple and tested, not tuned** — one allowance constant with one inequality (Q2 as amended by
    P-6); `max_segment_s` is a config-only ceiling, never a Conf dial.

### 2.2 Decisions that bind, and what D82 amends

| Decision | Still binds | D82 amends |
|---|---|---|
| **D71** | WS = media ingress only; client-submitted turns; C3 the mouth; `enabled OR dictation` admits | The EAR (Speaches-realtime → relay VAD + batch ASR per door); §3.1's rolling ~2× ceiling → the wall-clock bucket; §5.2's "touches nothing outside the project" → owner-ruled engine units (Speaches itself untouched, R18) |
| **D74** | The client transcript gate; its unknown-id fail-open | — (tentative start keeps its accrual exact) |
| **D76** | The few controls; `vad_threshold`/`silence_ms` Conf-only | The three VAD knobs leave `session.update` for relay config — same names, same bounds |
| **D77** | The trail: debug-gated, diagnosis not archive | New lines (§5); **keeping raw audio is the "new decision" D77 reserved** (§6.3) |
| **D80** | Tail hold, backstop, chirp, the id-keyed ledger | ④ the gap cut: dead from the flip (an owned segment is ≥ onset + `silence_ms` ≫ the cut), deleted in S10 |
| **R70 ③** | — | REVERSED: a leg death with finals > 0 recovers the suffix (§3.8) |
| **D48 / D40** | Engines are providers; chains walk; the request gate | `voice.live` becomes a batch door with its OWN timeout pair + `extra_body`; engines declare `max_concurrent_requests: 1` |

### 2.3 Inheritance

Taken: Silero `VADIterator`'s per-leg state (L4 §1.1–§1.2) · LiveKit's EMA smoothing (`p̂ = 0.35·p̂ + 0.65·p` per 32 ms window — expressed as a time constant, §3.4.1) under a
consecutive-`≥ act` onset, `deact = act − 0.15`, a 500 ms pre-roll and a segment cap (L4 §1.3; R97 §2, §4) · Home
Assistant's onset re-arm delay (R97 §2.4) · LiveKit/Pipecat's split of "speech ended" from "turn over" (R97 §9.2) ·
Pipecat's trailing-silence pad (R97 §6.2) · Deepgram/AssemblyAI's wall-clock bucket (L4 §2) · the peer class's
AudioContext rate (R96 §1) · Wyoming's `--vad-clip` pre-pass constants, identical to the plan's (R97 §6) · Home Assistant's
per-engine VAD seam (R95 §7). Not taken: Pipecat's 5 s state reset · sherpa's unbounded raise-to-0.9 · any throttle ·
Pipecat's wall-clock idle-forced stop (on this TCP link a stall is late, not lost — R97 §7.2) · LiveKit's flush that DISCARDS
the open segment (dictation needs the opposite).

**The per-peer record for any future revision starts in R97:** LiveKit — onset + EMA §2.1, segment bound §3, pre-roll §4.1,
dispatch/timeout/fallback §5.1, backpressure §8, structure and turn endpointing §9 · Pipecat — onset §2.1, §3, pre-roll and
resampler §4.1–§4.2, the segmented batch STT §5.1, the tail pad §6.2, the idle-forced stop NOT taken §7.2, turn stop §9.2 ·
Home Assistant / Wyoming — the pure segmenter §2.1 and §9.1, the re-arm delay §2.4, the 15 s end §3, the `--vad-clip` pass
§6.1, no recovery §7.1.

---

## 3. Architecture after the change

### 3.1 The pipeline, and who owns what

```
phone: getUserMedia (NS on ⇒ Chrome's track FIXED at 48 kHz) → AudioContext({sampleRate:16000}) (Chrome SincResampler;
       fallback: a native-rate context) → pcmWorklet 40 ms frames → uplinkPacer → liveSocket (K3)
       + MediaRecorder on the same stream (Opus) for the whole dictation — the recovery source (§3.8)
  ⇢ 4G/Wi-Fi → Tailscale Serve → uvicorn (keepalive 5 s + 5 s = the K4 horizon, qh9-pinned)
RELAY  _accept_audio: size caps → WALL-CLOCK BUCKET (§3.3) → leg index stamped (§3.2)
         → PyAV resampler to 16 kHz (anti-aliased; identity on the 16 kHz main path) → per-leg queue
       VAD worker (one `vad` thread/process): batch-drain → the configured `VadModel` (Silero v6.2 default; state per leg) → Segmenter → edges
       per-leg ASR worker (serial): PRE-ASR PASS (to_thread) → WAV → VoiceClient.transcribe(door="live")
       downlink: ready{clock:"leg", answer_ttl_ms} · speech_started · speech_stopped · transcript{audio_*_ms, reason} · error{item_id} · state:flushed
CLIP   POST /api/voice/stt[?from_ms=N]: PyAV decode (bounded) → trim → the SAME pass → per-chunk transcribe(door="stt")
ENGINES (machine-wide, per box, shared dev + prod): parakeet-live · parakeet-clip · PocketTTS · speaches (untouched)
```

**Capture facts (R96 §2.2, correcting R94 §2 and §7.1.6):** with `noiseSuppression` on, Chrome's mic track is fixed at
48 kHz, so today's context rate comes from the **output device's** preferred rate, not the mic. A 16 kHz context makes
Chrome resample the processed track with its windowed-sinc `SincResampler`; AEC/NS run before the context, untouched.
Where the rate cannot be honoured (Firefox/Fennec < 148 throws at `createMediaStreamSource`) the fallback is **a
native-rate context** — no worklet decimator. Every consumer already reads `ctx.sampleRate`; `MediaRecorder` records the
stream, not the context.

| Concern | Today | After D82 |
|---|---|---|
| When speech starts/stops | Speaches (rescan) | relay `VadSegmenter` (§3.4) |
| Whether a segment reaches ASR | Speaches' hidden 2nd VAD | ctrl-b's pre-ASR pass — the clip door from S9, the live door from S7b (§3.6) |
| Words | Speaches' Parakeet | any OpenAI-shaped engine via the provider seam; parakeet-server by default (§3.7) |
| Ids, order, one answer per stop | Speaches, implicitly (L5 §0) | the relay, explicitly (§3.5) |
| Capture, AEC, hold, tail, chirp, backstop, level gate, barge | phone | phone, **unchanged** (R95 §4) |
| Recording lifetime | the live leg | the microphone session (§3.8) |

### 3.2 The leg clock (R94 §7.2.3, amended by Q3)

- **Unit:** client-rate samples, converted to ms only on the wire (±1 sample at 44.1 kHz). **Origin:** the leg's first
  binary frame received after `ready` — for dictation exactly the first frame the client ENQUEUED (pre-`ready` backlog
  included; its pacer is lossless and never pumps before `ready`). The client indexes at **enqueue**, never pump/send.
- **Stamped at receipt** in `_accept_audio`, carried through the queue — a later drop is a GAP in the index, never a
  shifted boundary. Call legs drop pre-`ready` and stale frames client-side, so their index ≠ capture index; calls never
  recover, and the drops are counted (§5).
- **Declared:** `ready` carries `clock: "leg"` (council 10) and `answer_ttl_ms` (§3.5 ⑨). A client uses flushed-waits and
  recovery ONLY when the relay declares them; without the bit (a rolled-back relay, a stale PWA) it keeps today's behaviour.
  The reverse skew — an OLD client (no `client_id`, a boolean `waitingFinal`) against the new relay — transiently reopens
  the L5 §1.3 race until its service worker updates; `client_id` stays optional in `start` (T-12).

### 3.3 The uplink guard (R94 §7.1.1, amended by Q2 and R97 P-6)

- An audio-ms token bucket + a frame-count twin (the twin guards tiny-frame floods the audio bucket cannot see), refilled at
  wall rate, clock started **immediately before `ready`**, both **start full**, capacity ONE constant
  **`UPLINK_ALLOWANCE_MS = 30_000`** (the twin: / `frame_ms`). No drift term: at 0.1% phone/server drift (L1 §4) 30 s lasts
  > 8 h, past `max_session_s`'s 7200 s ceiling.
- **The Q2 proof is ONE inequality, enforced at LOAD** by a `LiveCfg` validator (the `_tail_fits_cap` precedent) and its
  test: `UPLINK_ALLOWANCE_MS ≥ KEEPALIVE_HORIZON_MS (10 000) + max(buffered_ceiling_ms, call_backlog_ms) +
  buffered_ceiling_ms + BUCKET_CAP_MS (500) + 2·frame_ms` (12 580 ms at defaults); a Conf value that breaks it is a 422.
  The two constants are named in the relay beside comments naming their sources (the launch flags; `uplinkPacer.ts`); the
  cross-file mirror pins are gone. **No `uplink_burst_ms` key.** R94 §7.1.3's K3 clause stays reversed (K3 is a term).
- **Violation → 1008 `protocol`** naming the budget; a legit client cannot trip it, so the call's terminal treatment
  stays honest (R94 §7.1.2). `_note_frame` keeps its NAME (`test_arch_invariants_prompts.py` allowlist); `RATE_WINDOW_S`,
  `RATE_MULTIPLIER` and the rolling deque go.

### 3.4 The VAD engine (C1, placement-agnostic)

- **Model/runtime (amended by R98 — §3.4.1 is the contract):** the engine speaks to a `VadModel`, never to an ONNX
  tensor. **The default model is Silero v6.2** (the official single-file `silero_vad.onnx` at tag v6.2 = v6.2.1, sha256
  `1a153a22…`, MIT, 2 327 524 B — the file LiveKit bundles), and **v5.1.2** (sha256 `2623a295…`, same IO contract) stays
  REGISTERED as the replay A/B; both vendored in `backend/app/assets/silero/`, SHA-256 test-pinned. Why v6.2 (R98 §2.3,
  MEASURED on emma, hop by hop): AUC 0.957 vs 0.925 clean and 0.952 vs 0.913 in car noise at 0 dB; under the plan's own
  policy at act 0.6 v6.2 found 126/126 labelled segments clean and 125/126 in car and babble noise, with 0 phantom
  segments/min on car, babble and kitchen noise at native level (0.7/min on quieter babble; 0.5 scored 126/126/126) where
  v5 found 120/119/118 and produced 7–9/min on babble — the speech-like-background class a
  radio or a passenger belongs to. v5 was pinned only for Speaches parity, which R24 dropped. The Silero adapter runs raw
  `onnxruntime` + `numpy` per window `[1, 64+512]` @ 16 kHz, `state [2,1,128]`, `sr`. Never the `silero-vad` package
  (torch); not `sherpa-onnx` (its Python binding is a bool, and its policy is duplicated inside every model).
  **A model swap is a re-calibration event** (R84, R98 §6): v6.2's probability scale sits higher on speech than v5's
  (thr@5 % miss 0.40 vs 0.09), so the threshold's SCALE is the model's (§3.4.1 ④).
- **Dependencies:** a `voice` optional extra (`onnxruntime`, `numpy`, `av`, exact pins, justified), installed by
  `install.sh` and CI — a wheel-less profile (Termux) still installs, and the lazy import reports the `live`/`stt` bits
  unconfigured instead of failing the boot (council 11 / O-LOW-4).
- **ORT sessions (VAD + pre-pass):** `intra_op=1`, `inter_op=1`, `allow_spinning=0`, asserted by a test (council 14).
- **The resampler (R17, R97 P-7):** PyAV's `av.audio.resampler.AudioResampler` (libswresample) — already in the `voice`
  extra. **VERIFIED on emma 2026-09-30** (av 19.0.0, Python 3.14.4): fed in 40 ms chunks it is bit-identical to one
  whole-signal pass (stateful streaming); a −6 dBFS 9 kHz tone at 48 kHz and at 44.1 kHz lands on its 7 kHz alias at −67 dBFS
  (≈ 61 dB down); 1 kHz and 6.5 kHz pass at −6.0 dBFS; it holds its filter delay internally (an impulse lands on its expected
  output index once flushed). Fallback: `python-soxr` `ResampleStream` (cp314 wheel). **ONE golden test:** the 9 kHz alias
  ≥ 30 dB down. Edges map by output-sample count, tolerance ONE hop or 32 ms, whichever is larger (§3.4.1 ②). An identity at 16 kHz; the linear
  `Pcm16Resampler` keeps only the Speaches 24 kHz hop until the flip and dies in S10.
- **Runtime:** one process-wide single-thread `vad` executor; the worker drains every queued frame per wake and runs the
  windows in ONE executor call (Q3 ②); the policy runs inline; state per leg, reset only at leg start. **Budget
  (council 14, hop-relative per §3.4.1 ③):** per-hop processing p95 < `hop_ms` and each batched `probs()` call shorter than the audio it represents, `emit_lag_ms` (edge wall time − its hop's receipt) p95 < 60 ms, no
  keepalive death, read on the contended box in the first post-flip rounds (§6.4); CPU affinity is decided only if these fail.
  **Behind is a failure (R97 P-5c):** the oldest queued frame older than `VAD_MAX_LAG_MS` (3000) ⇒ the `ear_failed` path —
  a call closes 1011 into the EXISTING reconnect ladder (a fresh leg, VAD state reset — not terminal; N-6), dictation
  degrades into §3.8's recovery.
- **Worker failures (council 22):** an unexpected exception in the VAD or ASR worker ⇒ `log.exception` + a typed
  `error{code:"ear_failed"}` + the T1 reason, never a bare 1011; after one ASR timeout the segments queued AT THAT MOMENT answer
  `asr_error` without calling the engine (not a latched breaker — R97 §5.2); in-flight ASR is cancelled at leg end; the `VoiceClient` generation is re-read
  per segment (`app.state.voice`), never captured for the leg.
- **The policy** — a pure `step(state, counts, probs, first_index) → (state, edges)` over a frozen `VadParams` (in ms)
  and a `counts` object derived ONCE per leg from the model's hop (§3.4.1 ③). Each hop's probability is first smoothed
  with LiveKit's EMA — `p̂ = α·p̂ + (1−α)·p` with `α = exp(−hop_ms/τ)`, `VadParams.ema_tau_ms` ≈ 30.5 (= LiveKit's 0.35 at
  32 ms; raw = a replay variant — R97 P-5b) — then falls in one of three bands (council 7). In the tables below "window"
  = one hop; the `/32` counts are written for the Silero hop and are DERIVED, never literal (`⌈x_ms/hop_ms⌉`):

| Band | Tentative segment | Confirmed segment |
|---|---|---|
| `p̂ ≥ act` (0.6) | counts toward confirmation (**consecutive**); inside a hangover it **continues the same `item_id`** (Q1) | speech |
| `deact ≤ p̂ < act` | resets the confirmation counter only; not quiet | speech (hysteresis) |
| `p̂ < deact` (`act − 0.15`) | resets the counter; adds to the **cumulative** hangover | adds to the end run |

| Rule | Behaviour |
|---|---|
| **Tentative start** | Emitted at the FIRST `p̂ ≥ act` (once re-armed); the segment begins `prefix_padding_ms` (500, R97 P-5d — so the pass's 400 ms lead pad is real) earlier, from a continuous pre-roll ring never clamped at the previous segment's end |
| **Confirmation** | `⌈onset_ms/32⌉` consecutive `p ≥ act` windows. M1 (counting `≥ deact`) is a `VadParams` VARIANT the harness A/Bs, not the default |
| **Retraction (Q1 + bound)** | When the cumulative `< deact` count reaches `⌈onset_ms/32⌉`, OR `2·onset_ms` has elapsed since the first crossing without confirming ⇒ `stop` + empty `short` final, no ASR. A rejected transient holds the mouth ≤ `2·onset_ms` + RTT. **Re-arm guard (R97 P-1, HA's rule):** after a retraction no new tentative start until `⌈onset_ms/32⌉` consecutive `< deact` windows (the hangover's own unit — leaner than `silence_ms`); a `≥ act` window inside that run starts nothing |
| End | `⌈silence_ms/32⌉` consecutive `< deact` windows; the segment's audio runs to the STOP SAMPLE — **`audio_end_ms` is that sample, never the pass's crop** (§3.8's cut depends on it). `silence_ms` stays 500–1200: it is the VAD end, not the turn end — a longer pause is `turn_hold_ms` (§3.5 ⑤; R97 P-3) |
| **Max segment (Q4, R20)** | `max_segment_s` (20, config-only ceiling): cut at the lowest-probability window in the last 1 s; A's final carries `reason: "max_segment"`; **B starts AT the cut with ZERO pre-roll**, already confirmed; an unconfirmed segment at the cap retracts |
| Dictation | `onset_ms = 0` — every crossing is a segment; the pre-ASR pass is the only filter (today's parity); no retraction |

  No buffer rotation, no 3 s window: B1/B2/B7 cannot occur by construction.
- **The seams:** downstream, `Segmenter.feed(StampedFrame) -> list[Edge]`, `Segmenter.flush() -> list[Edge]` (force-endpoints
  whatever is open, tentative included) — a later `EdgeSegmenter` (C2, a bool-only model's home) touches nothing downstream
  (R95 §8); upstream, the `VadModel` boundary of §3.4.1 — a second probability model touches nothing in the policy.
- **Golden vectors** — JSON `{params, hop, sample_rate, probs[], first_index, expected edges[]}` (the hop is a vector
  input, §3.4.1 ③), **hand-authored from the tables above before the implementation runs, never regenerated from its
  output** (council 11): R94 §9's VAD-1…10 · no pin · pre-roll
  crosses the previous end · the Q1 flicker stays ONE id · **hover at `deact ± 0.05` for 5 s ⇒ one retraction within the
  bound** · **hover at `act ± 0.05` for 5 s ⇒ at most one start/retraction pair** (P-1) · EMA applied (P-5b) · a `[deact, act)` dip resets confirmation but not the segment · dictation onset 0 · a split with zero pre-roll
  and `reason: max_segment` · an unconfirmed segment at the cap retracts · flush endpoints a tentative onset · **two vectors at a 10 ms hop that pin the ms→count and τ→α derivations** (R98).

#### 3.4.1 The VAD-model boundary (R25 · R98, amendment of 2026-10-01, revised the same day on review round A — binds S6-i, S6-ii, S9, S7b and the replay tool)

**Why.** The owner wants the ear model-agnostic (*"Silero today … other VAD models we might want to test … no big refactor
later"*). R98 measured every candidate and read every peer: the frameworks that fused the policy into the model paid for it
(sherpa duplicates the policy per model; LiveKit has one plugin), the ones that split model from policy still got three
things wrong — one threshold shared across models whose scales differ, the EMA and every count written for one hop, and
residual samples dropped at the frame boundary. The boundary below is the peer-converged shape (vad-web's `Model`,
Pipecat's `voice_confidence` + `num_frames_required`, LiveKit's `stream()`) plus the two facts none of them declares:
a per-model calibrated activation and a declared delay. Pattern: **Strategy** (the model) behind one small **Adapter** per
model, a plain dict of constructors — nothing more (R24).

① **The protocol** (`services/voice_vad.py`):

```python
class VadModel(Protocol):            # one per process per model; owns its ORT session; immutable
    name: str                        # the config value, the trail's `leg_start.model`, replay `--model`
    sample_rate: int                 # 16000 for every live-eligible candidate — the relay already delivers it
    hop: int                         # samples per probability (Silero 512 · TEN 256/160 · FireRed 160)
    delay_hops: int                  # 0 causal; probability j describes hop j − delay_hops (declared, see ⑤)
    default_act: float               # THIS model's calibrated activation — the replay tool's recommendation and
                                     # the config default's provenance; NOT consulted at runtime (④)
    prepass_act: float               # the pre-ASR pass's threshold on THIS model's scale (⑤) — read by the pass
    def open(self) -> VadStream: ... # fresh per-leg state ("reset" = open a new stream; reset only at leg start)

class VadStream(Protocol):
    def probs(self, pcm: NDArray[np.float32]) -> NDArray[np.float32]:
        """len(pcm) % hop == 0 → exactly len(pcm)//hop probabilities in [0, 1], in order; state carried."""

VAD_MODELS: dict[str, Callable[[], VadModel]]   # {"silero-v6.2": …, "silero-v5.1.2": …}
```

The adapter owns everything model-specific: context samples (Silero's 64), recurrent state, features (a future fbank/CMVN
or pitch frontend — with any fractional frontend lookahead normalized INSIDE the adapter to its integer `delay_hops`
ceiling and documented placeholders at start-up; if a real delayed model cannot be represented that way, `delay_hops`
becomes an `(offset_samples, drain_hops)` pair THEN, not now), and collapsing several outputs to one P(speech). `open()`
returning a stream (not `new_state()` + a pure function) is deliberate: a feature stream or a native handle is an object,
and a stream hides that without a second abstraction. A `close()` is added only when a model with a native handle is
adopted (R24). One ORT session is shared by the `vad` thread's stream and the pre-pass's `to_thread` stream: concurrent
`InferenceSession.run()` on one session is thread-safe by ORT's contract (its docs); the per-stream STATE is what is
never shared.

② **The `VadSegmenter` owns the frame↔hop mismatch and the clock mapping** — model-agnostic, ONE implementation:
- **A 16 kHz model-sample cursor** (post-resampler samples, `m`), separate from the LEG CLOCK (client-rate samples,
  §3.2). Each `StampedFrame` carries `(leg_index, client_samples)` and the Segmenter keeps frame anchors reaching back at
  least `max(prefix_padding_ms, 1000 ms) + hop` of audio (a START edge maps up to the pre-roll back, a cap cut up to
  `cut_span` back); a pre-roll that reaches before the leg's first sample clamps to it; a model boundary at cursor `m` maps back through the frame that contains it: `leg = frame.leg_index +
  round((m − frame.m_start) · client_rate / 16000)`. On the 16 kHz main path the two clocks coincide; on the native-rate
  fallback (44.1/48 kHz, R11) the mapping is the only correct one, and a DROPPED call frame (§3.2: a GAP in the leg
  index) can never shift a boundary because no boundary is ever computed by adding hops to a leg index.
- **The residual.** The relay's 40 ms frame is 640 samples; Silero's hop is 512 (1.25 per frame), TEN-256's 2.5. The
  Segmenter keeps a `< hop` residual and calls `probs()` on the largest multiple; nothing is dropped and no edge is
  quantized to the caller's frame (every peer that dropped the remainder lost 32–128 samples per frame, R98 §3).
- **The hop convention (review round A, Emma HIGH):** hop `j` covers model samples `[m_j, m_j + hop)`, `m_j = m_first +
  (j − delay_hops)·hop`. A **START** edge is at `m_j` of the first `≥ act` hop, minus the pre-roll (in SAMPLES,
  `prefix_padding_ms · 16`, independent of hop); a **max_segment cut** is at the `m_j` of the chosen lowest hop; a
  **STOP** edge — confirmation, retraction and the endpoint alike — is at the EXCLUSIVE end `m_j + hop` of the hop that
  completed the run, so `audio_end_ms` is the sample after the FULL `silence_ms` run (§3.4 End rule; §3.8's cut
  `audio_end_ms − silence_ms/2` depends on it). Both conventions are pinned in the 32 ms AND the 10 ms golden vectors.
- **Flush** zero-pads the `< hop` leftover to one hop (so the last real samples are judged) — and every edge is CLAMPED to
  the last real sample, so a stop that lands in the pad never reports an `audio_end_ms` past the recording; a delayed
  model (none registered — the drain code is written only then) would be drained with `delay_hops·hop` zeros; the pre-pass (§3.6) uses the SAME residual/pad/drain helper on a whole buffer — one
  function, no second copy.

③ **`VadParams` stays in milliseconds; counts are derived once per leg** — `counts = derive(params, hop, sample_rate)`
holds `k_onset = ⌈onset_ms/hop_ms⌉`, `k_end = ⌈silence_ms/hop_ms⌉`, `k_rearm`, `age_bound`, `α`, `max_hops`, `cut_span =
⌈1000/hop_ms⌉` — Home Assistant's time-unit lesson without its per-chunk float decrement, so the golden vectors stay
integer and exact. **The EMA** is `p̂ ← α·p̂ + (1 − α)·p` with `α = exp(−hop_ms / ema_tau_ms)`, `ema_tau_ms = 32 / ln(1/0.35)
≈ 30.48` (LiveKit's α 0.35 IS per 32 ms; a 10 ms model with the same α would smooth three times as fast), `p̂₀` = the
first `p`, and `ema_tau_ms = 0` ⇒ raw (α = 0, the replay variant). The age bound and the re-arm guard are in ms, so a
finer hop (more single-hop crossings) stays bounded in TIME; one 10 ms vector pins it. **The runtime budget is
hop-relative** (Emma MED): per-hop processing p95 < `hop_ms` AND each batched `probs()` call shorter than the audio it
represents (a 10 ms model can pass a flat 32 ms gate while falling behind), plus the `emit_lag_ms` p95 < 60 ms of §3.4.

④ **The threshold stays an explicit number; the SCALE is the model's.** `voice.live.vad_threshold` remains a required
float in Conf (D76's row, unchanged in kind — review round A rejected an optional "model default" value: nothing could
display or persist it cleanly, R88 forbids delivering server keys, and a blank Conf field would silently change meaning).
Its default becomes **0.6 for `silero-v6.2`** (R98's bake-off at 0.6: 126/126 clean, 125/126 in car and babble noise, 0
phantom segments/min on native-level noise — provisional until TUNE; 0.5 scored 126/126/126), its config BOUNDS widen to
**0.1–0.95** (D76's 0.5–0.8 was a v5 calibration; TEN's matched point is 0.44, FireRed-stream's 0.17), and the Conf
slider follows. The hysteresis gap stays the LiveKit/Silero constant `deact = act − 0.15` clamped to `≥ 0.05`; a
per-model gap is a seam no registered model needs (R24). **A model swap is a re-calibration the owner performs:** the
replay tool prints each model's `default_act` and its sweep, the runbook's swap procedure says "set `vad_threshold` to
the replay's recommendation", and the ALWAYS-ON T1 leg-end line (S7b extends S1's `_LegStats`) plus the trail's `leg_start` carry `model`,
`hop_ms` and `act`, so a mismatched operating point is visible in `journalctl` on the first leg, not only in a debug
trail.

⑤ **`voice.live.vad_model`** — a config-only key (no Conf row, the `max_segment_s` precedent), a closed `Literal` of the
registry's keys, default `silero-v6.2`, landing in **S6-i with the registry** (the S9 pre-pass reads it before S7b
does). Causality is a **registry invariant, tested, never checked at load** (building a model inside a validator would
import ORT at boot, council 11): one test asserts, for every `VAD_MODELS` entry, `delay_hops · hop_ms ≤ 32` (today: 0 for
both) and that the `Literal`'s keys equal the dict's — a non-causal model cannot be registered without failing it. **The
pre-ASR pass (§3.6) runs the SAME `vad_model` in a fresh stream** (one model per process). Its threshold is the
model's `prepass_act` (registry metadata, read by the pass — the pass never reads `vad_threshold`), 0.5 for both Silero
entries as the STARTING point on the new scale (0.5 scored 126/126/126 in R98's bake-off); because the pass becomes
authoritative on the clip door at S9 — BEFORE TUNE — **the S9 gate gains a pre-pass row** (§6.4): a threshold sweep
over the corpus positives and the push-to-talk clips with zero labelled-speech clips answered `no_speech`, the settled
value written back as the entry's `prepass_act`; TUNE re-checks it, and **a `vad_model` swap re-runs the sweep** (the
runbook's swap line: set `vad_threshold` to the replay's recommendation AND run the pre-pass sweep). A separate pre-pass model (where lookahead is free —
the only door a FireRedVAD-non-stream or MarbleNet could ever serve) is a RECORDED seam (`prepass_model`, R98 §5 ④), not
built.

⑥ **Per-model conformance test** (one per registry entry, beside the policy's golden vectors): chunk invariance (40 ms
frames vs one block ⇒ identical probabilities — measured bit-exact for Silero v5/v6.2), a short fixture WAV within 1e-5
of the upstream reference, `len(out) == len(pcm)//hop`, the file's sha256, and the first second of a leg (warm-up
behaviour is a model fact; a "not ready" output maps to 0.0).

⑦ **Replay (`vad_replay.py --model <key>`)** prints the model, its sha256, `default_act` and the effective act in the
header; two runs side by side are the A/B. Captures are model-independent by construction (raw 16 kHz post-resampler
WAV, §6.1).

**Named exits kept lean:** bool-only models (WebRTC) → `EdgeSegmenter`, not admitted to the probability path (R98's
measurements give no reason to build it); the Silero v6.2 **sequence export** (`silero_vad_16k_sequence.onnx`, release
v6.2.2, bit-exact with per-window v6.2, 42–58 µs/window batched) = a performance exit inside the Silero adapter if the
§3.4 budget ever fails — not built while 84 µs/window meets it ~380×; the `delay_hops` shift/drain code = written only
when a delayed model is registered (the attribute exists so the invariant test can read it). **What a model swap cannot
fix (R98 §2):** the phantom "Yeah."/"Mm-hmm." class is real speech (echo residue, a radio, a passenger); every generic
VAD passes it and the only research line aimed at it (foreground VAD) is unreleased. AEC, the hold, the backstop and the
pre-ASR pass stay the levers; the ranked try-next list is R98 §5 (v5.1.2 ↔ v6.2 · TEN native behind a libc++ + licence
check · FireRed-stream · non-causal models for the pre-pass only).

### 3.5 The producer contract (R94 §7.3, amended by Q1 and council 3/8)

1. **Ids** — relay-minted `seg_<n>`, on every start/stop/transcript; starts and stops strictly alternate.
2. **One answer per stop, with its bounds** — every final carries `item_id`, `audio_start_ms`, `audio_end_ms` (leg clock)
   and TWO orthogonal fields (E-N1): **`reason`** — why the segment ENDED: `endpoint` · `flush` (release-forced) ·
   `max_segment` · `short` (retraction, no ASR) — and **`outcome`** — what the pass/ASR SAID: `ok` · `no_speech` ·
   `asr_error` (+ `error{code:"upstream_error", item_id}`) · `skipped` (no pass or ASR ran — the ONLY outcome of `short`,
   and `short` is its only reason; EL-1). `quiet` is NOT wire-valid in this phase. `LiveDown` gains these fields plus
   `state:"flushed"`; the parser keeps them and validates finite, monotonic bounds and the (reason, outcome) PAIR — an
   invalid pair is a protocol anomaly, tested (council 3).
3. **Ordering** — transcripts FIFO (the serial worker); **stops go out when they happen**. R94 §7.3 ③'s "`transcript(n)`
   before `speech_stopped(n+1)`" is DELETED (council 8): with D9 required it only kept the next segment open on the client,
   leaking post-speech audio into its D74 accrual. The Q1 `short` exemption is thereby moot.
4. **Onset** — tentative start + the §3.4 bounds: client timing, accrual, the noise verdict and `min_final_ms` behave as
   today, and a flickering real onset stays ONE segment, so the mouth gate never opens between halves of one utterance.
5. **The turn hold (R20 + R97 P-3) — ONE mechanism: a held pending turn absorbs the next final.** After a call's final the
   pending turn is held `turn_hold_ms` (client key, 0–3000, default **0** = today); a `speech_started` inside the hold
   extends it until that segment's final, which joins the SAME turn. A `max_segment` final is held unconditionally until
   the next segment's final (a cap cut is not a pause, R20). **When a final opens a hold, any segment already OPEN or
   AWAITED (the ordered D9 set) is absorbed too (E-N3)** — `stop(A) → start(B) → final(A) → stop(B) → final(B)` ⇒ ONE turn
   (tested). One more reason in `held()` beside `confirmHold`/`heldUpload`.
   **ONE release rule (N-2, refined by R3-1 · EM-1 · EH-1):** an absorbed final JOINS if it carries taken text and
   otherwise only resolves its id; an absorbed `max_segment` final CONTINUES the hold (a cap cut is not a pause). The hold
   is released by whichever comes first — the final of the LAST absorbed segment that is not a `max_segment` (any other
   reason — `endpoint`, `flush`, `short` — and any outcome, incl. a final the D74 gate / echo backstop drops), `flushed`,
   leg end / socket loss (the held text is submitted), mute (discarded — "mute condemns"), or the hold's expiry
   (`turn_hold_ms`; for a `max_segment` hold, the joined id's TTL). **In DICTATION, a hold released by `asr_error` or by a
   degrade DISCARDS the held live text** before suffix recovery — that span is re-transcribed from the clip, so it lands
   exactly once. Tests: each release path · a three-segment capped turn (`max_segment → max_segment → endpoint`) submits
   ONE turn · `max_segment(ok) → endpoint(asr_error)` in dictation yields the text exactly once.
   ASR runs at segment end regardless, so a long hold adds no ASR latency, and echo finals still land `silence_ms` + ASR
   after the audible end (the audit's T-10 is moot). Dictation: phrases append; only the `max_segment` join applies.
6. **Flush** (dictation release) — a synchronous force-endpoint of the open segment and any tentative onset → its pass +
   ASR → **`{"type":"state","state":"flushed"}`** once its answer (`reason: "flush"`, any `outcome`) is out. Deletes the 3200 ms pad, its barrier and the
   "no completeness marker" theorem.
7. **Failure** — calls: per-segment `asr_error` + a note, the leg survives (D6). **Dictation: the first `asr_error` is a
   DEGRADE trigger** (§3.8, council 4). No dial-time preflight.
8. **Latency** — ASR p95 well under 2 s (echo window, tail wait, mouth-wait); §3.7 bounds it.
9. **Answer deadline + awaited-id lifetime (R97 P-2, N-1) — both from the one key.** The relay wraps each segment's WHOLE
   answer — the pre-pass, the COMPLETE chain walk (primary + fallback) and every gate wait — in ONE
   `asyncio.timeout(timeout_s)` and emits the typed final (`outcome: asr_error`) BEFORE the client's TTL expires, so
   "answered within `timeout_s`" holds by construction (E-N2 verified) (without the cap the walk's worst case is
   ≈ 33 s: gate 3 + read 10 + last-hop gate 10 + read 10). The client's `ready.answer_ttl_ms` = that cap + 1 s, timed from
   the id reaching the HEAD of the D9 set (the serial worker only starts it then); an expiry drops the id — the mouth may
   open — with a trail line and a note, and the relay counts any answer later than its cap on T1 (`late_answers`, expected
   0). **A final arriving after its id expired** (network lateness past the TTL head-start) is TAKEN the normal way if it
   carries text (a pending turn or a steer, trailed) and DROPPED if empty or `asr_error`; the client counts it on T1 via the
   trail (`late_finals`). No early mouth; no late turn from the relay (R3-2).

Unchanged (L5 §5): barge-in · ear/tail hold, chirp, leak evidence · held-frame zeroing (the hold travels IN the stream,
R95 §4) · the echo backstop · the voice learner · the overlay · the idle clock · dictation's append path.

### 3.6 The pre-ASR pass, both doors (R3, R5; R94 §7.2.4; L3 §3.4)

- **One function**, `prepass(pcm16k) → no_speech | chunks[]` (`services/voice_prepass.py`): a fresh-state batch run of the configured `vad_model` on
  its own stream of the configured `vad_model` (§3.4.1 ⑤) with the constants Speaches' HTTP door used — the model's `prepass_act` (0.5 for both Silero entries; neg = act − 0.15; settled by the S9 pre-pass sweep, §6.4), `PREPASS_MIN_SILENCE_MS = 160`,
  `PREPASS_PAD_MS = 400`, `PREPASS_MAX_CHUNK_S = 30`: no speech → `outcome: no_speech`, no ASR; else crop `[first − 400, last + 400]`
  ms, split > 30 s at speech boundaries, transcribe in order, join with spaces.
- **Authority:** authoritative on the clip door from S9 (the host swap needs it — parakeet is WAV-only and has no
  no-speech guard) and on the live door from the flip (S7b). Live door: in the per-leg ASR worker via `to_thread`, never the
  `vad` executor (Q4 ⑤).
- **Clip door:** PyAV decodes the upload (MediaRecorder webm/ogg/mp4, wav) to 16 kHz mono on `to_thread`, **bounded**: it
  aborts past `(dictation_max_s + 60) s` of decoded audio or 60 s of wall time (council 15); an optional `from_ms` query
  trims the decoded head (the S8 recovery, §3.8); then the pass → each chunk as WAV to `transcribe(door="stt")`, the chain
  walking per chunk. Undecodable → **422**; raw bytes are never forwarded.
- **Tail pad (R97 P-5a) — ONE rule:** when the audio after the last speech window is shorter than `PREPASS_PAD_MS`, zeros
  are appended up to it before ASR (a `max_segment` cut and a `flush` end mid-air); the crop covers every other case.
- **Why keep it (R5):** a stateful VAD removes rescan artefacts, not a TV voice, a speech-like thump or an echo residue
  past the hold (R95 §3); the hit rate stays measured (§5 T10).

### 3.7 ASR dispatch and the host (R4, R18, R19; R94 §7.2.5, §7.5; amended by Q4 and council 9/16/17)

- **Dispatch:** ONE `VoiceClient.transcribe(..., door: "stt" | "live")` selects `(chain, policy)`; `live_target()` dies in
  S10. The per-leg worker is serial; the generation is re-read per segment (§3.4).
- **Explicit doors (Q4 ①):** `LivePolicy` ALWAYS takes `voice.live`'s own `connect_timeout_s`/`timeout_s` (default **10 s**)
  and carries `voice.live.extra_body`, merged into live requests exactly as `SttPolicy` does (council 17). **A blank
  `voice.live.provider` collapses the doors** onto the stt chain (one instance, one mutex — a 30-min recovery would starve
  live): the registry logs the collapse once at info; it stays the fresh-install default, and emma configures both doors
  explicitly (S9 pins live to `emma-speaches` while stt moves; S7b moves live); a resolution warning fires when both doors share a PRIMARY.
- **Chains (council 16, flagged to the owner):** live = `[parakeet-live]` + `fallbacks: [parakeet-clip]` — the doors couple
  only on failure, visibly through the gate; clip = `[parakeet-clip, vault-speaches]` — that fallback pre-dates the
  phase; "fallbacks later" (R4) concerns NEW engines. Acceptance runs the recovery failure path once with fallbacks off.
  **Under the per-segment deadline a HUNG primary answers `asr_error` at the deadline without walking** (hop 1's read
  timeout equals the cap); the live fallback covers the common crash case — connection refused or a restarting unit (R2-3).
- **The D40 gate (council 9):** both engine providers declare `max_concurrent_requests: 1` (the server serializes on a
  mutex): a request queued behind a long clip waits `connect_timeout_s`, then walks to the next hop visibly
  (`X-Voice-Served-By`) instead of parking on the engine for `timeout_s`. A gate-walk test pins it. **The gate is PER PROCESS (T-3):** dev, prod and
  Hermes cannot see each other's requests, so a request behind ANOTHER process's work parks on the engine mutex up to
  `timeout_s` without walking — that wait shows in T9's `asr_ms`, not `queue_ms`. Hermes is an unmetered contender on
  `parakeet-clip`.
- **The host (L4 §3.1, §4; R19):** parakeet.cpp `parakeet-server` v0.5.0 CPU, `tdt-0.6b-v3-f16.gguf`, cloned next to
  `~/github/speaches`. **Engines are per BOX, machine-wide user units** like `pockettts.service`, shared by dev, prod and
  other consumers (Hermes may share the clip instance); `install.sh` never installs or manages them; the unit text is
  versioned in the runbook. ctrl-b's two doors = two instances: `parakeet-live`, `parakeet-clip` — `--host 0.0.0.0
  --port <p> --threads <n> --model <pinned path>`, `Restart=on-failure`, no key; binary + model SHA-256 in the runbook.
  **"One instance per door" holds per box: a dev test call contends with a prod call on the same mutex** — accepted,
  written down, visible in T9's `asr_ms` (above).
- **The request shape and language (T-5):** the bake-off goes through the REAL `VoiceClient.transcribe` request —
  `language` plus the `vad_filter`/`hotwords` extra form fields the adapter always sends — proving parakeet-server accepts
  them; if it rejects unknown fields, the adapter stops sending the faster-whisper extras to providers that do not take
  them (UNVERIFIED until the unit exists). **parakeet-server IGNORES `language`** (L4 §3.1: `verbose_json` reports a fixed
  `en` placeholder; v3 auto-detects), so `voice.stt.language: en` binds ONLY the whisper fallback — where the owner's
  cross-language hallucinations came from — and it STAYS `en` (owner). The bake-off and the Release gate carry one row
  proving parakeet's own auto-detect does not cross languages on short or noisy segments (§6.4).
- **R10 = the unit's acceptance:** (a) model resident (loaded at start, no idle unload); (b) info-level logging. The units
  listen on **0.0.0.0** (LAN + Tailscale reach for other consumers is intended — the owner's evening ruling); S10 records it,
  with Speaches' own bind, in SECURITY_MODEL §2.1's LAN-trust posture (the prod 0.0.0.0 waiver precedent) — one clause: the
  engines have no key and no Host check, so a LAN browser page can reach them via DNS rebinding; the impact is CPU
  contention only (no data, no auth surface), accepted under §2.1.
- **Threads (Q4 ②):** live 4 · clip 4 beside PocketTTS's 8 on 8C/16T; the contended reading decides affinity (§3.4
  budget). Vulkan for the clip door = an option (wins only above ~1.5 s; pin Mesa).
- **Engines are config (D48):** CrispASR / onnx-asr = a `providers:` edit, never code. **RAM:** ~1.5 GB per instance;
  Speaches keeps its 3.4–3.8 GB + swap while its unit runs — whether it keeps running is the owner's later call (R18).

### 3.8 Dictation: the recording outlives its leg (R94 §7.4, re-ruled by council 5)

- **Rule:** a dead or degraded leg **never** calls `stop()`; R70 ③ becomes "finals > 0 ⇒ recover the suffix". Degrade
  triggers: K1–K4, a socket loss, K2/K3 client closes, **and the first dictation `asr_error`** (council 4). On degrade the
  boundary freezes at the last CONTIGUOUS advancing final, later live finals are ignored, and "Live captions paused —
  still recording" replaces `LIVE_LOST_MSG`.
- **The whole streaming recording keeps its clocks (council 2):** Tier-0 auto-stop stays SUSPENDED and the P1 idle stop /
  P2 cap keep running for the entire streaming recording, leg alive or dead; the dead session object stays in `streamRef`
  until release.
- **The boundary (E-N1)** advances only on a final whose `outcome` ∈ {`ok`, `no_speech`} AND whose `reason` is
  `endpoint` — cut at `audio_end_ms − silence_ms/2`, the middle of the quiet run, ±350 ms of slack for the clock mapping —
  or `flush` — cut AT `audio_end_ms`, no back-off (a flush ends mid-air, N-4). It never advances on `max_segment` (the held
  text is discarded on recovery and re-transcribed, so dedupe stays exact) or `short` (no span); `outcome: asr_error` freezes
  it (degrade). Tests: `no_speech` × {`endpoint` advances, `max_segment` does not, `flush` advances AT its end}. **This depends
  on §3.4's End rule**: an `endpoint`'s `audio_end_ms` is the stop sample after the full `silence_ms` run, never the pass's
  crop; a change to the End rule must revisit the cut (M-4).
- **The source is the EXISTING MediaRecorder clip** (Opus at an explicit **32 kbps** — `audioBitsPerSecond`, set by SP
  (T-1): 32 kbps × 1800 s ≈ 7.2 MB + container, under the 25 MB `max_upload_bytes`; a test pins `dictation_max_s ×
  bitrate < max_upload_bytes`), recorded on the same stream for the whole dictation. At release, if degraded (or
  `flushed` did not arrive within `answer_ttl_ms` — the relay's deadline (§3.5 ⑨) answers by then; `tail_wait_ms` now bounds only the
  no-capability path), the client uploads that
  clip ONCE to the clip door with `from_ms`; the server decodes, trims, runs the pass, transcribes. Q3 ③'s sample-exactness
  is re-ruled: not needed at a VAD endpoint. **Dropped:** the PCM ring, part-cutting (M7), the worklet-after-death rule,
  the 16 kHz-ring requirement. **Stand:** receipt stamping, lossless enqueue, the error-final boundary (now the `outcome` field), split zero pre-roll.
- **Clock alignment (recorder ↔ leg, R97 P-4):** the client keeps `(leg index, worklet frame t)` pairs with ONE retention
  invariant (E-N4): **from the earliest unresolved segment until its final / error / TTL resolves it** — never a fixed-size
  ring — and **persists `from_ms` the moment a boundary advances** (then drops the older pairs); a test delays a final past
  the ordinary horizon. Per advancing final it uses the `t` of the frame containing its `audio_end_ms`; `t_rec` = `ctx.currentTime` at the recorder's
  `start` event. `from_ms = (t_frame − t_rec)·1000 + offset_in_frame − back_off`, where **`back_off` = `silence_ms/2` for an `endpoint`
  boundary and 0 for a `flush` boundary** (E-N1; both paths pinned by tests). Mapping through the boundary frame's
  OWN timestamp means nothing accumulates over 30 minutes (a skipped render or a suspend cannot shift later boundaries): the
  error is the `t_rec` stamp's jitter + one render quantum plus the recorder-clock drift below.
  **Re-anchor (N-5):** the recorder records the stream, not the context, so on every AudioContext `statechange` back to
  `running` the client records a fresh anchor pair (the context time, the recorder's elapsed time — measured as
  `performance.now()` since the recorder's `start` event, the only clock MediaRecorder allows; system-vs-audio drift ≲ 100 ppm,
  ≲ 0.2 s over 30 min, inside the slack) and maps each boundary through the latest anchor before it — a suspend cannot shift
  later cuts. The re-anchor is used only after a suspend. The UNIT test asserts only the formula and the anchor selection; the
  ACCEPTANCE bound — mapping error ≤ the ±350 ms recovery slack — is carried by the S8 FIELD measurement (a debug capture
  cross-correlated with its clip; R2-2, EL-2).
- **Failure contract (E-HIGH-3):** retry the POST once (it has no write side effect); on a second failure keep the clip
  behind ONE visible Retry / Discard outcome — never silently dropped; recovered text is appended and (if `auto_send`)
  auto-sent ONCE, never partially. **Acceptance arm:** kill the clip engine mid-recovery (fallbacks off) ⇒ nothing is
  silently discarded. **Time budget (T-9):** a 30-min clip = one ~7 MB upload + decode + ~60 chunks × ~1.8 s ≈ 2 min
  (≈ 4 min contended) behind ONE fetch through Serve — the client shows "Recovering…" and gives the POST
  `RECOVERY_TIMEOUT_MS` = 10 min, then the Retry/Discard outcome.
- **After a degrade or a tail-wait recovery** the socket is closed (`stop` sent) and any late final is ignored. A
  MediaRecorder `error` during a streaming recording ends it (`media_error` StopReason); if the leg was degraded, the clip up
  to the error is recovered as above.
- **Capability gate:** only with `ready.clock == "leg"` (§3.2); otherwise today's behaviour. Pre-`ready` degrade is
  unchanged (`finals === 0` ⇒ the whole clip, no `from_ms`).
- **Reload survival (S8b, R22).** The recorder runs with a timeslice (`REC_TIMESLICE_MS` = 5000), and each chunk is
  appended to ONE IndexedDB active-recording record: `{id, owner (the tab's `client_id`, §3.9 ④), started_at, mime,
  agent + thread context, chunk count, updated_at, from_ms}` — `from_ms` rewritten (the §3.8 mapping) each time a final
  advances the boundary. The record is deleted on successful completion or explicit discard. **On the next page load** an
  active record whose owner is this tab (a reload keeps `sessionStorage`), or whose `updated_at` is older than
  2 × the timeslice, shows a visible **"Recover the interrupted dictation"** affordance: the chunks are concatenated (the
  first carries the container header, so the whole is a valid webm/ogg) and sent through the EXISTING clip door with the
  stored `from_ms` — no new upload path, no new decoder — under the same failure contract; the text is appended to the
  recorded thread's draft, never auto-sent. **One active record, across tabs:** a fresh record owned by another tab is left
  alone; a new dictation that finds an unresolved record records memory-only until the owner recovers or discards it.
  **Bound:** a 30-min clip ≈ 7.2 MB at 32 kbps. **Unavailable IndexedDB or a quota error** (every access try/catch'd) ⇒ today's
  memory-only behaviour + an interrupted-dictation marker (set at start, cleared at completion) that reports the loss on
  return, never silently. The stale-record rule trades a possible DUPLICATE for zero loss: the affordance is manual, and a
  frozen background tab mistaken for stale yields visible duplicate text, never a lost word (M-3).

### 3.9 Client changes (session A unless marked)

1. **D9 — awaited-id set.** `waitingFinal: boolean` → `awaiting: ReadonlySet<string>`, `waitingFinal` derived
   (`mouthMayOpen`, `CallOverlay` unchanged). An accepted `speechStop(id)` adds; `final(id)` removes; `error{upstream_error}`
   WITH `item_id` sets the note only, WITHOUT one clears the set (the Speaches-era belt); `ready`/`socketLost`/mute clear.
   `parseLiveFrame` gains `error.item_id`. Speaches-compatible (D80 W3 already forwards ids).
2. **D8 — provisional floor.** Starts from the trail (why did that call's floor sit at −60?). Until the tracker settles the
   floor seeds from `V − 2·voice_margin_db` (the exact key, else the device's other EC mode, else the last learned level);
   once settled the measured floor wins in EITHER direction; never learned from. No key.
3. **SP — P1 · P2 · P3 (R21).** P1: `dictation_idle_s` 300, 0 = off, OWN threshold `dictation_idle_margin_db` 10 over the
   reused `levelGate` noise tracker (Tier-0 untouched). P2: while Speaches is the ear (its 30-min hard kill), SP ships
   `dictation_max_s` **1790** under `max_session_s` 1800 — the validator `dictation_max_s < max_session_s` holds and the
   relay's typed `session_limit` comes first (council 21); S10 raises them to **1800 / 2100**. P3: `takeWakeLock` lifted
   into `lib/wakeLock.ts` WITH its gen/phase fence parameterized — `takeWakeLock(stillWanted)` + a handover-order test (T-12);
   both hooks import it; dictation stays foreground-only. The recorder gets `audioBitsPerSecond` 32 000 (T-1).
4. **D5 — slot takeover (council 12).** `client_id` = one UUID in `sessionStorage` (per tab, survives a reload — the
   live-call marker's precedent), sent in `start` on every leg; the relay acquires the slot AFTER reading `start`. Full and
   the holder's `client_id` matches ⇒ the slot transfers at once, the old leg gets `state:ended{reason:"superseded"}` and
   closes in the background; another client gets `busy`; one release per slot.
5. **K6 — 16 kHz capture (R11).** `new AudioContext({ sampleRate: 16000 })` at `pcmCapture.ts` (~:604) and
   `useDictation.ts` (~:1195); on `NotSupportedError` from `createMediaStreamSource`, close and rebuild at the native rate
   (capability-checked, never UA-sniffed), the rebuilt context brought to `running` via `primeAudio` (council 25).
   Comment/test updates: the worklet's frame-contract prose, `chirp.ts`'s `CHIRP_MATCH_RATE` note, capture tests;
   optionally the dictation analyser's `fftSize` 1024. Through the interim Speaches hop quality is a measured wash (R96 §3).

### 3.10 The stress-test amendments (audit S — all ACCEPTED; as re-ruled by council №1)

- **Q1 (DEFECT)** — a one-window dip made R94's no-ASR retraction open the mouth gate between an utterance's halves (a held
  reply started over the owner) and restart accrual. → hangover retraction with same-id continuation, the age bound and the
  re-arm guard (§3.4) · D9 REQUIRED · dictation `onset_ms = 0`; the `short` exemption is moot (stop-hold deleted, §3.5 ③).
- **Q2** — ≈ 11.5–12.5 s of legit lateness vs R94's C 11.58 s ⇒ K1 where K4 would reconnect; "K3 ≥ C" and a free
  `uplink_burst_ms` opened K1-not-K4 windows. → AMENDED by R97 P-6: one `UPLINK_ALLOWANCE_MS` (30 s), starts full, no key,
  the Q2 sum kept as a load-validated inequality, K3 a term (§3.3).
- **Q3** — a burst through the drop-oldest queue drained per window lost audio before the VAD; an `asr_error` could be
  skipped; a split's pre-roll re-sent speech. → receipt stamping (§3.2) · lossless enqueue + batched drain (§3.4) · the
  boundary rules (§3.8) · split zero pre-roll. The ring/worklet condition was re-ruled by council 5 (the clip + `from_ms`).
- **Q4** — a blank default is one door; shared CPU ≥ doubles latency; a 30 s segment ⇒ ≈ 2 s head-of-line over the tail
  wait. → explicit doors, 10 s timeout, the gate + chains (§3.7) · disjoint threads + the contended reading ·
  `max_segment_s` 20 · the release waits `answer_ttl_ms`, then recovers (§3.8) · decode + pass off the VAD worker (§3.6).

### 3.11 Getting ctrl-b off Speaches (R94 §7.3.5, §7.6; R8, R18)

- **Deleted from ctrl-b's code in S10:** `realtime_url`, `connect_speaches`, `LiveUpstream`, `_dial_upstream`,
  `_configure_upstream` + the `session.created` wait · `_UpstreamLost`/`_UpstreamRefused` · the five-field `turn_detection`
  pin · `SPEACHES_WIRE_RATE`, the 24 kHz hop + the linear `Pcm16Resampler`, base64 TEXT frames · the commit-safety invariant
  (+ SECURITY_MODEL §2.10's paragraph) · the 3200 ms flush pad, `FLUSH_MARGIN_MS`, `VAD_WINDOW_MS`, the barrier,
  `_audio_seen`, `_speech_open` · `_adopt_pre_roll`/`_note_pre_roll_mismatch` · the gap cut · `tools/speaches_realtime_smoke.py` · the fake Speaches in `test_voice_live_s1.py` (→ a fake batch engine) · the
  `websockets>=14` direct-dep line. **Kept:** the guard, `uplink_idle_s`, slots, `mode`, the trail, the typed errors.
- **Speaches itself is untouched (R18):** never stopped, never deleted by this phase. On dev, S9 moves `voice.stt` to
  `parakeet-clip` and PINS `voice.live.provider: emma-speaches` explicitly (a blank live provider would collapse onto the new
  stt chain and aim the still-realtime relay at parakeet); **the flip (S7b) then removes the last references — `voice.live`
  and the Kokoro TTS fallback (R8, D7) — in ONE config move.** Prod does it all in one move at the v1.7.12 release (§8.2.2). The
  `providers.emma-speaches` entry stays defined, so rollback is a re-point. `vault-speaches` is unaffected.

---

## 4. Config — every new or changed key

`LiveCfg` stays the source of truth (LIVE_VOICE_PLAN §4.1 re-mirrors it at S10). **Verdict: NO config migration** — every
change is additive or a default change on an unstored key; `CONFIG_VERSION` stays **5**. The pre-tag config report is
built in S10 (T-7). Stored today (2026-09-30):
prod `voice.live` = `{debug, dictation, mic_hold}`; dev = `{allowed_origins, debug, dictation, enabled, mic_hold, route}`
(council 26). The pre-tag check **reports** every stored `voice.live`/`voice.stt`/`voice.tts` value against the new
bounds and the validator; a violation gets a clamp step (6), never a runtime repair.

| Key (`voice.live.*` unless named) | Type · default · range | Reader | Conf | Change | Verdict |
|---|---|---|---|---|---|
| `vad_threshold` · `silence_ms` · `prefix_padding_ms` | 0.6 (**0.1–0.95**, was 0.5–0.8 — the scale is the model's, §3.4.1 ④) · 700 (500–1200) · **500** (was 300; 0–1000) | server | Live call › Speech detection | leave `session.update` → `act`, the VAD end, the pre-roll ring (P-5d) | bounds widened (S7b; a stored 0.5–0.8 value stays valid); the pre-roll default is unstored |
| **`vad_model`** | Literal of `VAD_MODELS` keys · **`silero-v6.2`** | server | **none** — config-only (§3.4.1 ⑤) | NEW (R98, lands in S6-i): which registered `VadModel` both doors run; causality is a registry-invariant test, not a load check | additive |
| **`turn_hold_ms`** | int · **0** · 0–3000 | client | Live call (S7a: FE row + round-trip test) | NEW (R97 P-3): the pending-turn hold that generalizes the R20 join | additive |
| **`onset_ms`** | int · **200** · 0–500 | server | Live call › Speech detection (S7b: FE row + round-trip test) | NEW: confirmation + hangover + the tentative bound | additive |
| **`max_segment_s`** | int · **20** · 5–**20** | server | **none** — config-only ceiling (D76, council 18) | NEW | additive |
| `timeout_s` · `connect_timeout_s` (inherited) | **10** (was 30) · 3 | server | Live call › Engine (S7b: FE row + test) | always live's own, even collapsed | default change; unstored |
| `extra_body` (inherited) | map · {} | server | — | now merged into live requests (council 17) | additive |
| `provider` · `fallbacks` (inherited) | blank = stt chain | server | Live call › Engine | a BATCH door; emma: pinned `emma-speaches` at S9, then `parakeet-live` + `[parakeet-clip]` at S7b | ops edits |
| `relay_queue_ms` | 2000 | server | — | dictation lossless; call drop-oldest, counted | additive |
| `max_session_s` | int · 1800 → **2100** in S10 · 10–7200 | server | — | P2 headroom (council 21) | default change; unstored |
| `buffered_ceiling_ms` · `call_backlog_ms` | 1000 · 1000 | both | — | client ceilings + terms of the allowance inequality (a load validator) | additive |
| `tail_wait_ms` | 2000 | client | Voice · STT | the no-capability path only; with `ready.clock` the release waits `answer_ttl_ms` | additive |
| `dictation_idle_s` | int · **300** (was 15) · **0**–1800 | client | Voice · STT | P1; 0 = off | bounds widened; unstored |
| **`dictation_idle_margin_db`** | float · **10** · 0–40 | client | Voice · STT (SP: FE row + test) | NEW: P1's threshold | additive |
| `dictation_max_s` | int · **1790** → **1800** in S10 · 10–1800 | client | Voice · STT | P2 + validator `< max_session_s` | default change; unstored |
| `debug` | false | both | Live call › Debug (+ a privacy line) | now also gates the raw-audio capture (§6.1) | additive |
| `trail_keep` | 20 | server | — | now per mode; a trail's capture goes with it | additive |
| `providers.parakeet-live` · `parakeet-clip` | `base_url` 127.0.0.1 · **`max_concurrent_requests: 1`** | server | Providers | NEW (ops, council 9) | ops edit + backup |
| `voice.stt.*` · `voice.tts.fallbacks` | owner config | server | Voice | stt → `parakeet-clip` + `[vault-speaches]`; TTS − Kokoro (R8) | ops edits + backup |
| `voice.stt.language` · `hotwords` · `vad_filter` | prod + dev store `en` · a list · `true` | server | Voice · STT | inert on parakeet (it ignores `language`, L4 §3.1); bind only on the whisper fallback; `language` STAYS `en` (owner) | no change |

**Not keys:** K6 (a capability fallback) · `UPLINK_ALLOWANCE_MS`, `KEEPALIVE_HORIZON_MS`, `BUCKET_CAP_MS` (P-6) ·
`VAD_MAX_LAG_MS` · `RECOVERY_TIMEOUT_MS` · `REC_TIMESLICE_MS` · `PREPASS_*` (Speaches-door
constants) · the Silero assets. `/voice/status` `live_call` delivers CLIENT keys only; the R88 reader-parity test gains
`dictation_idle_margin_db` (in SP) and `turn_hold_ms` (in S7a) and proves `onset_ms`, `max_segment_s` and `vad_model` are
never delivered (in S7a).

---

## 5. Telemetry and trails (S1 + what Q1–Q4 and the council need observable)

| # | Field / line | Lands in | Gate | Built in |
|---|---|---|---|---|
| T1 | **Leg end on EVERY path** (`_ClientGone`, clean stop, keepalive death, `_fail`, idle reaper, supersede, `ear_failed`): `mode · duration_s · frames · audio_ms · finals · reason · close_code · last_err`; from S7b + `model · hop_ms · act` (§3.4.1 ④) and the aggregates (p50/max `asr_ms`, `asr_error`/`no_speech` counts, VAD p95 inference + `emit_lag_ms`, **event-loop lag**, `late_answers`) | relay `log.info` | always | S1; aggregates S7b |
| T2 | Budget tripped · **bucket credit** at the trip (min seen) | T1 | always | S2 |
| T3 | Client close code (4000 send_buffer · 4001 client_backlog · 1000 normal) | T1 | always | S1 |
| T4 | Dictation: `onClose(code, reason)` · `lastError` · `StopReason` (`user · idle · max_duration · page_hidden · socket_lost · client_backlog · send_buffer · media_error · call_handover · unmount · cancel`) into `stop()`; clip bytes (T-1) | dictation `end` line | debug | S1; bytes SP |
| T5 | Call `MicReadback` + NS · AGC · channels · track rate; both modes' context rate | `capture` / `rec` | debug | S1 |
| T6 | **Call pacer drops** per leg + ms to the next `speech_started` (R95 §6) | client `uplink` | debug | S1 |
| T7 | Relay queue drops (call) + the index gap | T1 · `seg` | always / debug | S1; gap S6-ii |
| T8 | `seg {id, start_ms, end_ms, reason, outcome, confirmed_ms, retracted, split, vad_queue_ms, infer_ms, emit_lag_ms}` | relay trail | debug | S7b |
| T9 | `asr {id, door, provider, queue_ms, prepass_ms, asr_ms, chunks, ok}` | relay trail | debug | S9 (clip) · S7b (live) |
| T10 | `prepass {id, verdict, crop_ms, padded}` | relay trail | debug | S9 · S7b |
| T13 | `recover {from_ms, why: degrade / answer_ttl, trigger, attempt, outcome: ok / retry / kept / discarded, elapsed_ms}` | dictation trail | debug | S8 |

Retention split (R94 §7.1.7): dictation trails in `$CTRLB_HOME/calls/dictation/` (the D77 rails; the batch envelope names
the mode), each directory keeping `trail_keep`. No transcript text ever reaches the journal.

---

## 6. Capture · replay · corpus · criteria

**The fact that shapes this section:** emma holds **no call or dictation audio today**. `~/.ctrl-b/calls/` holds 20 JSONL
trails and nothing else. There is no reference set to tune against until the capture slice (S6-ii) records one, so the
first dev rounds after it BUILD the set. There is no Speaches baseline, no shadow comparison and no parity engine (R24):
the reference is the owner's own reading of real audio.

### 6.1 Raw-audio capture (S6-ii, production code)

- **Gate and retention match the D77 trail's.**
  - `voice.live.debug` (off by default) turns the capture on beside the trail.
  - `trail_keep` deletes a trail's capture along with the trail (per mode, §5).
  - It uses the same `$CTRLB_HOME/calls/` rails: 0700/0600 and the canonical-UUID filename guard.
  - There is no endpoint, no upload and no UI, and the files sit outside install.sh's backups.
- **What is written: `<call_id>-<leg>.wav`.**
  - The content is the relay's RECEIVED stream after the §3.4 anti-aliased resampler: 16 kHz PCM16 mono.
  - Held frames are kept as the zeros they are, so the file is exactly what the VAD sees.
  - It is appended off the loop in batches via `to_thread`, like the trail.
  - The WAV header is finalized at leg end. A crash leaves a raw `.part` file, which the corpus tool can still import.
  - Size is about 1.9 MB per recorded minute, times the number of kept trails.
- **A bystander is recorded too** (the car radio, a passenger): consent applies at PROMOTION (§6.3), and unpromoted captures
  expire with their trail. **Worst case:** 20 kept 30-min legs × 1.9 MB/min ≈ 1.1 GB per mode per instance.
- **Why it stays after tuning:** it is how a bad car call gets diagnosed from now on. The trail says what was decided;
  the capture is what was heard.
- **SECURITY_MODEL gains §2.12, "captured audio at rest"**, in S6-ii.

### 6.2 The replay tool (`tools/vad_replay.py`, S6-ii; offline, never runtime)

`vad_replay.py <wav…> [--model silero-v6.2|silero-v5.1.2] [--set onset_ms=… act=… silence_ms=…] [--variant m1] [--asr http://127.0.0.1:<clip port>/v1]`

- **It reuses the shipped code.** It imports the SHIPPED modules (the resampler, the `VadParams` policy,
  `VadSegmenter`, `prepass`) and re-implements nothing.
- **It runs them over captured WAVs and prints, per segment:**
  - the edges: start/end ms, reason, max probability;
  - with `--asr`, the transcript, produced through the same pass/chunk path on `parakeet-clip`.
- **It compares.** Two parameter sets print side by side, and the M1 confirmation variant (§3.4) is compared here.
- **The owner judges the output by hand.** A change is adopted on R94 §9's Pareto reading: fewer false segments, no lost
  short answer, no clipped onset.

The hand-authored golden vectors (§3.4) are the unit tests. The tool is the ear test.

### 6.3 The corpus (R9, council 19)

- **Where it lives.** The canonical corpus is **`$CTRLB_HOME/asr-corpus/`**, normally prod's root.
- **How clips get in.** `tools/asr_corpus.py promote <call_id>-<leg> --label … [--from <root>]` copies a capture from any
  instance's `calls/` (dev's, for example) into it:
  - `raw/<date>-<mode>-<route>-<lang>-<leg>.wav`;
  - `labels/*.json`;
  - `manifest.jsonl`.

  Permissions are 0700/0600.
- **It is never committed to git.** Deletion is `prune --older-than`, or `rm -r` of the directory.
- **Consent:** the owner's own voice only. A clip carrying another person's voice is deleted, never promoted.
- **What the first dev rounds record:**
  - **negatives:** a quiet EV parked and moving, a combustion car, HVAC, the indicator, bumps, handling, the radio, the
    TTS leak, a quiet room;
  - **positives:** yes / no / yeah / mm-hmm / okay × 20 **and sí / no / vale / claro × 20 (T-5)**, plus quiet, normal, car and
    hesitant sentences in both languages;
  - calls and dictations, in English and Spanish, in the car and at home.

### 6.4 The host bake-off (S9) and the criteria

**Bake-off.** parakeet-server f16 CPU, one instance per door.
- **Clips:** corpus clips binned at 0.3 / 0.8 / 1.5 / 3 / 5 / 10 / 20 s, plus one 5-min and one 30-min clip through the
  clip door.
- **Rows:**
  - uncontended;
  - **CONTENDED:** live-sized requests on `parakeet-live` while `parakeet-clip` runs the 30-min clip AND PocketTTS
    synthesizes;
  - optionally, Vulkan for the clip door.
- **Per row:** ASR p50/p95 and RSS, every request through the REAL `VoiceClient.transcribe` shape (T-5); the 30-min row is
  also timed END TO END through Serve from a phone (T-9). The transcripts go to the owner's hand reading.
- **Not in the bake-off:** the §3.4 VAD budget, event-loop lag and keepalive deaths. The VAD runs live only from S7b, so
  these are read on the contended box during the first post-flip rounds.

| Gate | Pass |
|---|---|
| **S9 → clip door on parakeet (dev)** | • the gate-walk test passes<br>• **the pre-pass sweep (§3.4.1 ⑤):** `prepass_act` swept over the corpus positives + the push-to-talk clips on the configured model — zero labelled-speech clips answered `no_speech`, the negatives' hit rate reported (T10)<br>• live-sized p95 < 1 s uncontended and < 2 s contended (requests ≤ 20 s)<br>• RSS < 2 GB per instance<br>• R10 (a)–(b) hold<br>• **no language crossing:** English and Spanish short answers and car negatives never come back in the other language (T-5)<br>• the owner reads the push-to-talk clips and the replayed reference transcripts by hand and finds them acceptable — **Spanish included** (T-5) |
| **TUNE → the flip (S7b)** | • the golden vectors are green<br>• the owner's hand judgement of the replayed reference set (edges + transcripts, with the chosen `VadParams`) finds: no phantom segments on the negatives, every short answer present, no clipped onset |
| **Release v1.7.12** (R94 §9 field acceptance, on the flipped dev) | • 5 min of no-owner-speech car audio → 0 false turns<br>• 20× each short answer, **English and Spanish** → recall ≥ 95%, no first-phoneme clipping, **no answer transcribed in the other language**<br>• no perceptible added lag<br>• ASR p95 < 1 s<br>• the §3.4 VAD budget met<br>• **a ≥ 10-min 4G dictation with induced stalls → zero stops, the suffix recovered, no duplicated text**<br>• the kill-clip-engine arm (§3.8)<br>• a > 20 s call turn arrives as ONE turn (R20)<br>• a reload mid-dictation recovers (S8b) |

---

## 7. The slice ladder

Each slice: pinned Opus lane → main-seat audit → review → fix wave → confirm → commit; the owner's pause after each.
**Review (owner directive, 2026-09-30, superseding council 27's tiering): EVERY Phase 26 slice gets the two-reviewer
round — blind Opus 5.5 ∥ blind Emma.**
"Alone" = a self-contained diff, gate green.

### 7.1 Session A — transport, dictation rulings, 16 kHz capture (after S5; Speaches still the ear)

| Slice | Scope · files | Tests | Accept / field |
|---|---|---|---|
| **S5** ratify (this session) | D82 stamped · TODO/ROADMAP/doc-map rows applied | — | before any A code |
| **S1** telemetry | §5 T1 base, T3–T7 + the retention split + close codes (closes ISS-41, T-11) · `voice_live.py`, `call_trail.py`, `useDictation.ts`, `liveSocket.ts`, `useLiveCall.ts`, `lib/callTrail.ts` | a leg-end line per path (`caplog`), no transcript text · StopReason per R94 STOP-1…10 · pacer-drop counter | a dev dictation + call show every field |
| **S2** uplink allowance (§3.3) | `_note_frame` body + `UPLINK_ALLOWANCE_MS` + the `LiveCfg` inequality validator · T2 · fake-clock tests (`voice_live.time.monotonic`, precedent `test_multihome_d47.py`) · prose in `uplinkPacer`/`liveSocket`/`useDictation`/`useLiveCall`/`pcmWorklet`, LIVE_VOICE_PLAN §3.1, SECURITY_MODEL §2.10 · the FE tests restating the window | the inequality over every accepted config (a breaking Conf value 422s) · a late burst passes · sustained 1.1× trips · credit capped at the allowance · T0 = `ready` · start-full allowance passes, +1 frame trips | a dictation through a 3–5 s airplane blip no longer dies `protocol` |
| **S3** kill paths | dictation K2/K3 close with typed codes + StopReason (the degrade consequence arrives at S8); the K3 reversal in docs + tests; the call unchanged. **✅ ABSORBED (ruled 2026-10-01, session 55 — no build, no round):** S1 delivered the typed codes + the T4 vocabulary (4000 `send_buffer` · 4001 `client_backlog` · `deathReason` · `closeCode`/`lastError` on the `end` line — every K-path is classifiable from the trail: K1 = 1008 + `lastError.code=protocol`, K4 = 1006, K5 = 1013, relay `session_limit` = 1000); S2 rewrote every live doc/test for the K3 reversal (R94 §7.1.3's "raise K3" is provenance). A `protocol` StopReason member was REJECTED: the vocabulary is spec-pinned and S8 rewrites the death consequence. | a code per path | — |
| **S4** | **WITHDRAWN** (R10) | — | — |
| **SP** P1·P2·P3 | `config.py` (defaults, bounds, `dictation_idle_margin_db`, validator, the 1790/1800 interim) · `useDictation.ts` (`audioBitsPerSecond` 32 kbps, T4 clip bytes) · `levelGate.ts` (reuse) · `lib/wakeLock.ts` (fence parameterized) · `useLiveCall.ts` · `ConfTab.tsx` + settings type · `e2e/liveCall.spec.ts`'s `/voice/status` fixture (T-8) | validator · `dictation_max_s × bitrate < max_upload_bytes` · 0 = off · idle at the margin · cap · **Tier-0 stays suspended while streaming** · wake lock on every stop path + the handover-order test · R88 parity gains `dictation_idle_margin_db` · one Conf round-trip | a 6-min hands-free dictation with 30 s pauses survives, screen on |
| **K6** 16 kHz | the two context sites + the native-rate fallback via `primeAudio` · comment/test updates · optional `fftSize` | 16 kHz path · fallback on a thrown `createMediaStreamSource` · **fallback context reaches running** · frame size | **phone card:** trail rate 16000 · one call + one 5–10 min dictation transcribe normally · chirp lag + latency readout unchanged · level gates self-adjust · **EC-call and EC-media arms** · **one Fennec run** (the fallback) |
| **D9** | reducer awaited set · `liveSocket.ts` (`error.item_id`) · overlay selector (closes LIVE_VOICE_PLAN OPEN-2, T-11) | L5 §1.3's `stop(A)→start(B)→stop(B)→transcript(A)→transcript(B)` keeps the mouth shut until B's final · the id-less belt | — |
| **D8** | `levelGate.ts`, `useLiveCall.ts` | seed tiers · settled overrides up AND down · never learned | a call's first 5 s on a fresh route |
| **D5** (A's tail) | `LiveSessionSlots` holder map + supersede · slot acquired after `start` (`api/voice.py`) · `client_id` in `sessionStorage` · both hooks | same-tab supersede incl. after a reload · another client `busy` · `ended{superseded}` · one release per slot | — |

### 7.2 Session B — engine, capture, the host, hand tuning, THE FLIP, recovery

| Slice | Scope · files | Tests | Accept / field |
|---|---|---|---|
| **S6-i** engine/DSP | **Files:**<br>• the `voice` extra<br>• `assets/silero/` — v6.2 + v5.1.2, both SHA-pinned<br>• `voice_vad.py` (the `VadModel`/`VadStream` protocol + `VAD_MODELS` + the `vad_model` key and its registry-invariant test (§3.4.1 ⑤) · the Silero adapter serving v6.2 AND v5.1.2 · `VadParams` in ms + `derive(params, hop)` · the policy · `VadSegmenter` with the residual carry, the 16 kHz cursor → leg-clock mapping and the hop start/end conventions (§3.4.1 ②))<br>• `voice_prepass.py` (the pass + bounded PyAV decode)<br>• `config.py` (the `vad_model` key, §3.4.1 ⑤)<br>• the PyAV resampler wrapper<br>• hand-authored golden vectors (EMA, re-arm, both hovers; both hop conventions; two at a 10 ms hop; one native-rate fallback vector with a dropped-frame gap)<br>• the per-model conformance test (§3.4.1 ⑥)<br>• the `voice` extra wired into `install.sh:116`, `ci.yml:80`, `deploy/bootstrap.py`, `deploy/windows/` (T-12)<br>**No relay or route change.** | • the golden vectors<br>• the wrapper vs a recorded ONNX output (state carried)<br>• ORT options asserted<br>• the ONE alias golden test + chunked == whole<br>• the pass constants<br>• decode fixtures (webm/ogg/mp4/wav) + bounds | — |
| **S6-ii** capture + replay + corpus | • receipt stamping<br>• the 16 kHz resampled copy<br>• the debug-gated capture (§6.1)<br>• `tools/vad_replay.py` (`--model`, §3.4.1 ⑦)<br>• `tools/asr_corpus.py`<br>• SECURITY_MODEL §2.12<br>• a Conf privacy line on `debug` | • capture happens only with `debug`<br>• retention follows the trail<br>• permissions<br>• the header is finalized, and a `.part` is importable<br>• replay prints edges for a fixture WAV | **Step 0: Conf › Live call › Call debug readout ON on dev** (it is OFF on dev and prod today — M-2). Then the owner's first capture rounds build the reference set (car + home, calls + dictations, both languages). |
| **S9** the host + the clip door | • clone parakeet.cpp next to `~/github/speaches`<br>• machine-wide units + the runbook section "The ASR engines"<br>• `VoiceClient.transcribe(door=…)`<br>• the clip door = decode + pass + per-chunk `parakeet-clip`; undecodable → 422<br>• `max_concurrent_requests: 1`<br>• the dev config: stt → `[parakeet-clip, vault-speaches]`, live PINNED to `emma-speaches`<br>• T9/T10 on the clip door<br>• the bake-off through the real `VoiceClient` request (the `vad_filter` extra accepted or dropped, T-5), the 30-min row timed end to end through Serve | • the gate-walk test<br>• no speech → "" with no ASR call<br>• > 30 s splits in order<br>• never on the event loop<br>• the bake-off table | Push-to-talk clips and the whole-clip dictation fallback run on parakeet; the owner judges them → the S9 gate. |
| **TUNE** (owner + main seat, no code slice) | 0. `debug` ON on dev (M-2)<br>1. more capture rounds<br>2. `promote`<br>3. `vad_replay.py` sweeps with `--asr` on `parakeet-clip`<br>4. the owner's hand judgement<br>5. `VadParams` defaults settled (a config edit or a one-line default change)<br>6. the pre-pass sweep re-checked (it settles the entry's `prepass_act`; re-run on any `vad_model` swap, §3.4.1 ⑤) | — | → the TUNE → flip gate (§6.4) |
| **S7a — client half** (N-3; ships + is reviewed first) | **INERT until `ready{clock:"leg"}`:** `config.py` owns `turn_hold_ms` here (EM-2) · `LiveDown` fields + validation (bounds, reason incl. `flush`, `flushed`, `answer_ttl_ms`), the awaited-id TTL, **`turn_hold_ms`** + the `max_segment` join + the N-2 release rule (call pending + dictation append), the R88 parity (`turn_hold_ms` in; no server-only key is ever delivered — asserted per key as each lands, `onset_ms`/`max_segment_s` at S7b; R4-1), Conf rows + round-trip test, `e2e/liveCall.spec.ts` fixture (T-8), **an `ear_failed` arm in the call's `serverError` — note-only, like `busy` (R2-1)**, the `outcome` field + (reason, outcome) pair validation incl. `short`/`skipped` — tested against a scripted relay | without the capability everything is today's behaviour · the TTL expiry drops an id + logs · **each N-2 release path** (the last absorbed non-`max_segment` final of every other reason incl. a gate-dropped one, `flushed`, socket loss submits, mute discards, hold expiry — EM-1/R3-1) · a 25 s turn submits ONE turn · the dictation join appends once · **`stop(A)→start(B)→final(A)→stop(B)→final(B)` ⇒ ONE turn (E-N3)** · **`ear_failed` + 1011 ⇒ a reconnect, not a terminal (R2-1)** · a three-segment capped turn ⇒ ONE turn (EM-1) · several absorbed segments release on the LAST one's final (R3-1) · a late final with text is taken, an empty one dropped (R3-2) · invalid (reason, outcome) pairs rejected (EL-1) | — |
| **S7b — THE FLIP** | the `vad` executor + batched drain + the `VAD_MAX_LAG_MS` rule, lossless dictation enqueue, typed `ear_failed` (a call → the reconnect ladder, N-6); the relay VAD produces the events (tentative + bounds + re-arm, EMA, `seg_<n>`, finals with bounds + reason, `flushed`, `ready{clock, answer_ttl_ms}`, dictation onset 0, `max_segment`); ASR = `transcribe(door="live")` on `parakeet-live` inside the ONE per-segment `timeout_s` deadline (N-1), the pass authoritative with the tail pad; T8/T9/T10 + the T1 aggregates; **the dev config move** (live → `parakeet-live` + `[parakeet-clip]`, Kokoro out of TTS — no LIVE or TTS route references `emma-speaches`/Kokoro after the flip; the pre-existing `vault-speaches` clip fallback and the `emma-speaches` provider definition (rollback) remain) · `voice_live.py`, `adapters/voice.py`, `core/provider_registry.py` (`LivePolicy` + `extra_body`, collapse log, primary warning), `config.py` (server-side VAD/deadline keys only: `onset_ms`, `max_segment_s`, `timeout_s`, `prefix_padding_ms` 500, the `vad_threshold` bounds 0.1–0.95 per §3.4.1 ④ — `ConfTab.tsx`'s slider bounds + `config.example.yaml`'s comment follow) · `_LegStats` + `model · hop_ms · act` on T1 | lossless dictation enqueue under a 10 s burst (Q3 ②) · a worker exception and a lagging worker ⇒ `ear_failed` + T1 (a call reconnects) · alternation · FIFO · stops not held · one answer per stop incl. 5xx + timeout · **a slow primary + fallback walk answers `asr_error` at `timeout_s`, never later** · queued-at-that-moment segments after a timeout answer `asr_error` · flush with a tentative onset (`reason: flush`) · split zero pre-roll + tail pad · **the Q1 flicker end-to-end: no mouth opening between halves** · the leg survives an engine death | car + home calls (no phantom turns, short answers kept, no clipped word, latency not worse) + a pause-heavy dictation; the VAD budget + event-loop lag read on the contended box |
| **Field rounds** (owner) | car + home calls and dictations on the flipped dev, `debug` ON (captures keep feeding the corpus), English and Spanish | — | no phantom turns, short answers kept, no clipped word, latency not worse; dev rollback = re-point the config + revert S7b |
| **S8** recording outlives its leg | `useDictation.ts` (degrade triggers incl. the first `asr_error`, the frozen boundary, `streamRef` kept, clocks kept, recorder↔leg mapping, the frame-timestamp ring + `from_ms`, the clip re-upload, retry once, `RECOVERY_TIMEOUT_MS`, Retry/Discard, append/auto-send once, the capability gate, R70 ③ reversed) · `api/voice.py` (`from_ms`) · T13 | **STOP-5:** the socket dies after the first final → the recording continues → the suffix recovers, no duplicated text · **the boundary advances only on the matching successful final** · a mid-leg `asr_error` degrades · **Tier-0 cannot end a dead-leg recording** · tail-wait timeout ⇒ recovery · retry then Retry/Discard · **no capability → no recovery** · no_speech × {endpoint, max_segment, flush} boundary tests (E-N1) · a delayed final past the ordinary horizon still maps (E-N4) · `max_segment(ok) → endpoint(asr_error)` recovers the text exactly once (EH-1) · both cut paths (`endpoint` − silence/2, `flush` − 0) · **ONE scripted-relay e2e** (`routeWebSocket`: `ready{clock}`, a final with bounds, a close ⇒ the release POSTs the clip with `from_ms`, T-8) | the ≥ 10-min 4G dictation with induced stalls; the kill-clip-engine arm (fallbacks off); **the real recorder↔leg mapping error measured — acceptance ≤ ±350 ms** (debug capture × clip cross-correlation, R2-2, EL-2) |
| **S8b** reload survival (R22) | `useDictation.ts` (`rec.start(REC_TIMESLICE_MS)`, the chunk append, `from_ms` persisted as finals land, delete on completion/discard) · a small IndexedDB store module (one record, try/catch'd) · the load-time "Recover the interrupted dictation" affordance + Discard · the marker fallback — reuses the §3.8 clip door + failure contract, no new upload path or decoder | chunk append · the concatenation decodes (header in the first chunk) through the clip door's PyAV path · the recovery offer after a simulated reload · delete on completion · another tab's fresh record left alone · IndexedDB unavailable / quota ⇒ memory-only + marker | a reload mid-dictation on the phone recovers the captured part |
| **S10** code off Speaches | the §3.11 deletions (the gap cut is dead from the flip) · `dictation_max_s` 1800 / `max_session_s` 2100 · **the pre-tag config report** (T-7) · docs: LIVE_VOICE_PLAN (status, §0 seams, §2 pointer + Smart Turn's changed trigger, §4.1/§5.1, §5.2), SECURITY_MODEL §2.10 + §2.1 (**the engines' and Speaches' 0.0.0.0 binds under the LAN-trust posture**, T-6 as ruled) + §3 + §6, CLAUDE.md's LIVE_VOICE_PLAN row, AGENTS.md, QUALITY.md counts. **No unit is stopped** (R18) | the full gate; a fake batch engine | — |

**Deferred (not Phase 26):** S6b (R7) · NEW-engine ASR fallbacks (R4) · a server energy gate (`quiet`) · client accrual on
the leg clock (R94 §7.3 (i)) — **when it lands, delete the tentative start and its retraction** (R97 §2.2) · future VAD-model
A/Bs through `vad_replay.py --model` (FireRed-stream, TEN — R98 §5) · streaming ASR / EOU · **Smart Turn v3** (relay-owned audio makes it possible; LIVE_VOICE_PLAN §2.1's shelved
trigger changes) · a shorter hop-1 read timeout so a HUNG primary still walks to the fallback (R2-3) · dictation reconnect-and-continue · an Opus/WebCodecs uplink (R96 §1) · R94 §8's dropped items: an NS/AGC
A/B (after T5 exists), a high-pass (measure band energy on the corpus first), RMS DC offset (diagnostic only); EMA smoothing is
now ADOPTED (P-5b). **Hard rules that stand:** no lexical filters, no logprob gate, no threshold raise to 0.9, no
absolute-dBFS VAD.

---

## 8. Release and rollback — two releases (R1)

### 8.1 What each release carries

#### 8.1.1 v1.7.11 = the six polish fixes + session A

The session-52 polish (five fixes) + polish #6 `e249f12` + the R94–R97 and plan docs + session A (S1, S2, S3, SP, K6, D9, D8,
D5). **Speaches is still the ear** — the relay still dials its realtime WebSocket. **Config migration: NONE** (session A's
keys are additive or unstored-default changes, §4; SP's interim `dictation_max_s` 1790 / `max_session_s` 1800). **DB: none.**
No new dependency (the `voice` extra arrives in B). It ships the transport fixes that stop the 2026-09-28 dictation deaths
on prod while B is tuned.

#### 8.1.2 v1.7.12 = session B

S6-i … S10: the engine, capture, the clip door on parakeet, S7a/S7b the flip, S8/S8b recovery, S10 (caps 1800 / 2100).
**Config migration: NONE** in code (§4); the flip's ONE config move is an explicit ops step at release (§8.2.2). **DB: none.**
`install.sh` installs the `voice` extra; the engines are already running machine-wide since S9 (R19).

### 8.2 Prod steps

#### 8.2.1 v1.7.11 — the standard runbook, no config step

`deploy/linux/README.md` §Release end to end: pre-flight (CI + the tag's release gate green · **a local e2e run**,
`tools/check.py --e2e`, T-8 · session A's dev field checks passed, §7.1, incl. K6's phone card) → tag → `update.sh v1.7.11` →
verify (health, a dictation, a call). Nothing in `config.yaml` changes.

#### 8.2.2 v1.7.12 — symmetric with §8.3 (M-1; commands in S9's runbook section)

1. Pre-flight: CI + the tag's release gate green · **a local e2e run** (`tools/check.py --e2e`, T-8) · dev's §6.4 release
   criteria met · the S10 pre-tag config report clean.
2. `curl 127.0.0.1:<port>/health` on both engines (shared with dev since S9); R10 (a)–(b) re-checked.
3. `systemctl --user stop ctrl-b-dashboard`.
4. **Backup + the ONE config move:** `cp -p ~/.ctrl-b/config.yaml ~/.ctrl-b/backups/config.yaml.<UTCstamp>.pre-v1.7.12`;
   + the two engine providers (`max_concurrent_requests: 1`) · `voice.live.provider` = parakeet-live, `fallbacks:
   [parakeet-clip]`, `timeout_s: 10` · `voice.stt.provider` = parakeet-clip, fallbacks `[vault-speaches]` ·
   `voice.tts.fallbacks` = `[vault-alltalk]` (R8).
5. **`update.sh v1.7.12`** (installs, starts, health-checks).
6. Verify: a dictation, a call, a push-to-talk clip, a TTS failover; T1 lines in the journal.

There is no window where a v1.7.11 realtime relay meets a parakeet config, or a v1.7.12 relay meets an untested
"relay VAD + Speaches batch door" pairing. Speaches' unit is not touched (R18); whether it keeps running (its RAM, §3.7) is
the owner's later call.

### 8.3 Rollback, per release

- **Off v1.7.11 → v1.7.10:** plain `bash ~/apps/ctrl-b/deploy/linux/update.sh v1.7.10` — no config changed, no migration.
  A stale v1.7.11 PWA against the v1.7.10 relay is compatible: a 16 kHz `start` is inside the relay's 8–96 kHz bounds, the
  relay ignores an unknown `client_id`, and D9 already speaks Speaches' ids.
- **Off v1.7.12 → v1.7.11 — a config re-point first.** v1.7.11's relay dials Speaches' REALTIME WebSocket, which
  parakeet-server lacks: ⓪ `systemctl --user start speaches` if the owner has stopped it, then wait for its `/health` (N-7)
  → ① stop `ctrl-b-dashboard` → ② restore `config.yaml.<UTCstamp>.pre-v1.7.12` (re-points every chain at the still-running
  Speaches) → ③ `update.sh v1.7.11` (or §Rollback's manual sequence) → ④ verify health + a call. The engines stay up (other
  consumers). A stale v1.7.12 PWA against the rolled-back relay sees no `ready.clock` and keeps today's behaviour (§3.2).

### 8.4 The owner's prod cards

- **After v1.7.11 (session A):** a ≥ 10-min 4G dictation through a tunnel/airplane blip no longer dies `protocol` (S2) · a
  6-min hands-free dictation with long pauses survives, screen on (SP) · a call's first seconds on a fresh route: no quiet
  false turn, no deaf owner (D8) · a re-dial right after a dropped leg is not `busy` (D5) · K6's behavioural arms — one call
  + one 5–10 min dictation transcribe normally, the chirp lag and the latency readout unchanged, both EC routes behave (the
  16 kHz rate assertion stays on the DEV card, E-L1).
- **After v1.7.12 (the ear):** a car call on the clean route (no phantom "Yeah.", short answers taken) · a > 20 s monologue
  arrives as one turn · a ≥ 10-min 4G dictation through a blip (no stop, the suffix recovered) · a reload mid-dictation offers
  the recovery · a push-to-talk clip · a TTS failover · the chirp lag unchanged · Spanish short answers taken.

---

## 9. Risks and named exits

| Risk | Mitigation / exit |
|---|---|
| Cadence (R1) — **CLOSED at session close:** two releases | v1.7.11 ships session A's transport fixes to prod while B is tuned on dev |
| The relay VAD mis-segments in real rooms | golden vectors · the reference set replayed and judged by hand before the flip · field rounds after it · on dev the flip reverts by a config re-point |
| The act-based confirmation retracts a very short real answer; a hover around `act` re-arms repeatedly | vectors + the replayed short answers before S7b · the re-arm guard (P-1) · the M1 variant compared in the replay tool · `onset_ms` is a Conf row · dictation exempt |
| Shared engines: dev tests and Hermes contend with prod calls (R19) | written down; the D40 gate walks only WITHIN a process — cross-process waits show in T9 `asr_ms` (T-3) |
| Recovery upload fails or crawls over car 4G | one ~7 MB (32 kbps) upload, 2–4 min budget, retried once, `RECOVERY_TIMEOUT_MS` 10 min, then Retry/Discard — never silent |
| A page reload mid-dictation | S8b (R22): IndexedDB chunks + the recovery affordance; the marker where storage fails |
| Fennec < 148 / an unobserved Honor 20 behaviour at 16 kHz | the native-rate fallback · K6's phone card |
| cp314 wheel churn | exact pins in the `voice` extra; the lazy import degrades the ear, never the boot |
| parakeet.cpp is young | engines are config (onnx-asr/CrispASR = an ops change); the live door already falls back to the clip instance |
| Raw audio at rest | off by default · 0700/0600 · count-bounded · no endpoint · §2.12 · owner-only consent |
| No reference audio exists today | S6-ii's capture + the first dev rounds build it (§6); the flip waits for the TUNE gate |
| **Named exit C2-H** — phone VAD + one HTTP POST per segment (R95 §2, §10.1) | revisit only if S2/S3/S8 fail in the field; the seam + vectors keep it a port |
| **Named exit sherpa-onnx** | behind: no probability/tentative edge, open quiet-audio bug #3997 |
| Any later rework of the engine shape | start from R97's per-peer tables (LiveKit / Pipecat / Home Assistant, sections listed in §2.3), not from scratch |
| **A VAD-model swap** (Silero fails the TUNE gate or the release card) | R98 §5's ranked list; a swap is one registry entry + a re-calibration in the replay tool (§3.4.1); the phantom-turn class is NOT a model problem (R98 §2) |

---

## 10. The agenda, answered — and what stays open

### 10.1 HANDOFF agenda §A7 · §B · §C → where each is answered

| Item | Answer |
|---|---|
| A7 release shape | R1 — two releases (v1.7.11 = polish + A · v1.7.12 = B), ruled at close; config migration verified NONE (§4, §8.1) |
| B1 D1 guard | R12 close 1008 · `uplink_burst_ms` replaced by one allowance + inequality (Q2 as amended by P-6, §3.3) |
| B2 P1 idle stop | R21 — 300 s, 0 = off, relative 10 dB (SP) |
| B3 P2 cap | R21 — 1800 / 2100 (interim 1790 / 1800 while Speaches is the ear, council 21) |
| B4 P3 wake lock | SP (lifted with its fence parameterized, T-12) |
| B5 D7 TTS fallback | R8 — PocketTTS → vault-alltalk, in the flip's one config move (S7b) |
| B6 D8 floor | §3.9 ② in session A |
| B7 Speaches ops | R10 skipped (demands → S9) · R18 Speaches untouched |
| B8 K4 · K5 · K6 | K4 stays 5/5 (§3.3) · K5 → D5 · **K6 ANSWERED: session A (R11, R96)** |
| B9 S1 + D9 | R15 |
| B10 the four stress questions | §3.10 |
| C1 D3 | R2 + R16 (§3.4) |
| C2 D2 | R13 + Q1 + council 7 (§3.4, §3.5) |
| C3 D10 | R5 (§3.6) |
| C4 D4 | R3 — PyAV, bounded (§3.6, S6-i) |
| C5 the host | R4 + R19 (§3.7); per-door endpoint VERIFIED (`voice.stt` and `voice.live` each name a provider) |
| C6 retirement | R18 + R24 — un-configured in one move at the flip (§3.11, §8) |
| C7 corpus | R9 + R24 + council 19 — debug-gated capture → `$CTRLB_HOME/asr-corpus/` (§6); no audio exists today |
| C8 S6b | R7 — deferred |
| C9 the record | R6 |
| C10 cadence | R1 — two releases, ruled at session close (§8) |

**Residual closures (T-11):** S1 closes ISS-41 (dictation taps spending `trail_keep`); D9 closes LIVE_VOICE_PLAN OPEN-2
(the one-flag `waitingFinal`). ISS-16 (crackle) and ISS-19 (lock-screen call) are untouched; ISS-16's counter-arm (TTS
back to Kokoro on `emma-speaches`) stays runnable only while Speaches runs and its provider entry stays defined.

### 10.2 Still open

Nothing the owner has to rule. **One watch item:** parakeet ignores `language` and auto-detects; the S9 and Release gates
test English + Spanish short and noisy clips for language crossing (§6.4). If it ever crosses, it comes back as an engine
question with evidence — there is no knob to force it.

---

## 11. Council record

**Amendment of 2026-10-01 (R25, §3.4.1):** the owner asked for VAD/ASR-engine agnosticism before the build; R98 (the model landscape, measured on emma) was bought and the main seat ruled the `VadModel` boundary + the v6.2 default; reviewed blind by Opus 5.5 ∥ Emma on the amendment only (session-54 scratch `review-A-*`; both BUILD WITH CHANGES — the hop-end convention (Emma HIGH), the 16 kHz cursor → leg-clock mapping, the explicit threshold with widened bounds instead of an optional one, the registry-invariant test instead of a load-time 422, the S9 pre-pass sweep, the hop-relative budget and the naming sweep were folded the same day; confirm rounds recorded there).

**CLOSED 2026-09-30 (six waves):** Opus 5.5 — CONFIRMED BUILD (confirm round 4; `confirm-P-opus.md`). Emma (Sol) — confirm round 3 (`confirm3-P-emma.md`) closed every item but ONE wording line in S7a's test column (the release path must name the last absorbed non-`max_segment` final), applied verbatim by the main seat together with Opus's R4-1 nit and ruled closed; her only other hold was the `turn_hold_ms` owner ruling, pending BY DESIGN at the time. **Both owner items were RULED at session close (2026-09-30): the turn hold = Option A · the cadence = two releases (v1.7.11 = polish + A · v1.7.12 = B). The plan is buildable end to end.**

**Council №1 (2026-09-30) — blind Opus 5.5 ∥ blind Emma (Sol), both BUILD WITH CHANGES** (reviews `review-P-opus.md`,
`review-P-emma.md`; reconciled `RULINGS-P.md`, 28 rulings, all ACCEPTED except E-MED-12 — moot, Speaches is never
deleted). Where each landed: 1 R18/R19 §3.7 §3.11 §8 · 2 §3.8 · 3 §3.5 ② · 4 §3.5 ⑦ §3.8 · 5 §3.8 · 6 S8b · 7 §3.4 ·
8 §3.5 ③ · 9 §3.7 §4 · 10 §3.2 · 11 S5/S6-i/S6-ii §3.4 · 12 §3.9 ④ · 13 §3.4 · 14 §3.4 §6.4 · 15 §3.6 · 16 §3.7 · 17 §3.7
§4 · 18 §2.1 §4 · 19 §6.3 · 20 §2.1 §3.6 · 21 §3.9 ③ · 22 §3.4 · 23 §3.3 · 24 §6.2 §6.4 · 25 §3.9 ⑤ · 26 §4 · 27 §7 ·
28 this record. Owner rulings the same day: R18–R23 (Speaches untouched, machine-wide engines, the join, P1/P2 numbers, S8b ruled in, the `silence_ms` ceiling).
**Wave 2 (owner, R24):** no shadow mode, no Speaches baseline, no parity engine — the dual-detector relay path, every "vs
Speaches" criterion and the onnx-asr sidecar are removed; the capture, the offline replay tool and the corpus stay as
production/tool code; session B re-sequenced (the host on the clip door → hand tuning → the flip). This supersedes council
20's S7/S9a/S9b split and council 24's arrival-clock onset comparison. **Wave 3 (main seat):** the main-seat read (M-1…M-4), R97's peer-engine
check (P-1…P-7 + its record) and the traceability audit (T-1…T-12 + its 10 coherence items) — all folded; R23's `silence_ms`
widening re-shaped into `turn_hold_ms` (P-3); the derived bucket and its mirror pins replaced by one allowance + one
inequality (P-6); the hand-rolled FIR replaced by PyAV (P-7, verified). **Wave 4 (Opus confirm round: 24 earlier findings closed, 3 MED + 5 LOW new, all
ACCEPTED as N-1…N-8):** the per-segment answer deadline + TTL from one key, the one hold-release rule, S7 split into S7a/S7b,
the flush cut, the context re-anchor, `ear_failed` → the reconnect ladder, rollback step ⓪, S9's full wording, the DNS-rebinding
clause in the bind sentence. **Wave 5 (Emma confirm: 21 closed, 2 HIGH · 3 MED · 2 LOW new; Opus round 2: 1 MED + 2 LOW):**
`reason` vs `outcome` split (E-N1), the deadline wording verified (E-N2), hold absorption of open/awaited segments (E-N3),
the frame-mapping retention invariant (E-N4), the turn-hold refinement marked owner-pending (E-N5; RULED at close, Option A), the dev-only rate check
(E-L1), the precise Speaches wording (E-L2), the client `ear_failed` arm (R2-1), the recorder-time source (R2-2), the hung-
primary clause (R2-3); owner directive: every slice two-reviewer (Opus ∥ Emma). **Wave 6 (Opus round 3: CONFIRMED BUILD +
R3-1/R3-2; Emma round 2: E-N1 + EH-1, EM-1, EM-2, EL-1, EL-2):** the conditional cut, the dictation hold discard, the
continuing `max_segment` hold, release on the last absorbed final, late finals after expiry, `turn_hold_ms` in S7a, the
`skipped` outcome and pair validation, the field-card acceptance bound. Recorded contradictions the council added: R94 §7.3 ③ stop-ordering vs D9-required (resolved: the stop-hold is deleted);
"Speaches running at release" vs "stop it on dev at S10" (resolved: never stopped).

---

## 12. Sources

- **Rulings:** the session-53 rulings (the owner with the Fable seat, 2026-09-30) · the stress-test audit (Q1–Q4 against
  `34269e6`) · council №1 (`RULINGS-P.md`).
- **Research:** [R94](./research/R94-asr-audits-verification.md) §1–§7, §9–§11 · R94-evidence
  [L1](./research/R94-evidence/L1-relay-transport.md) (§1, §4, §5), [L3](./research/R94-evidence/L3-speaches-fork.md)
  (§1.7, §3.4, §4, §6), [L4](./research/R94-evidence/L4-external-research.md) (§1–§4),
  [L5](./research/R94-evidence/L5-call-admission-consumers.md) (§0, §1.3–§1.6, §5–§7) — L2 private, not cited ·
  [R95](./research/R95-vad-placement.md) §0, §2–§8, §10 · [R96](./research/R96-16khz-capture.md) §0–§6, §9 ·
  [R97](./research/R97-peer-engine-design.md) §0, §2, §4–§9, §12 · the traceability audit (audit T, 2026-09-30) ·
  [R98](./research/R98-vad-model-landscape.md) §0–§6, §8–§10 (the §3.4.1 amendment; MEASURED on emma 2026-09-30).
- **Docs:** [LIVE_VOICE_PLAN](./LIVE_VOICE_PLAN.md) §2.1, §3.1, §4.1, §5.1–§5.3, §7 (the D80 CAR ROUND block, S11), §9 ·
  DECISIONS D40, D48, D71, D74, D76, D77, D80 · [UPDATE_PLAN](./UPDATE_PLAN.md) §3, §12a ·
  [SECURITY_MODEL](./SECURITY_MODEL.md) §2.10, §2.11, §3 · [ARCHITECTURE](./ARCHITECTURE.md) §6 · `deploy/linux/README.md`
  §Release, §Rollback · [QUALITY](./QUALITY.md) · [HANDOFF](./HANDOFF.md) agenda §A–§D.
- **Corrections recorded:** R94 §7.2.1's "LiveKit runs the VAD on a single-worker executor" is wrong — LiveKit uses the
  loop's default executor (R97 §12); the plan's single `vad` thread is stricter. LiveKit applies its onset rule to an
  EMA-smoothed probability (R97 §12) — adopted (§3.4).
- **Code read:** `config.py` · `core/{provider_registry,audio}.py` · `services/voice_live.py` · `adapters/voice.py` · `api/voice.py` ·
  the qh9 test · `useLiveCall.ts` · `useDictation.ts` · `lib/{liveSocket,pcmCapture,pcmWorklet,uplinkPacer,levelGate,audioController}.ts` ·
  the `pockettts` / `speaches` user units (read-only).
