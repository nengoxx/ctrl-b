# ASR plan — live voice stops depending on Speaches: the relay owns the VAD, ASR is a batch provider per door, the recording outlives its leg

> **Status: ✏️ DESIGN — plan of record for Phase 26 ([TODO](./TODO.md)) / [D82](./DECISIONS.md), written 2026-09-30
> (session 53); council №1 (blind Opus 5.5 ∥ Emma, both BUILD WITH CHANGES) folded in full over six waves; **Opus CONFIRMED BUILD · Emma closed on the last wording line (§11)**. **Session A BUILT + released (v1.7.11). Session B IN PROGRESS (sessions 64–65, 2026-10-07): S6-i `1c63ce7` · S6-ii `64021d8` · S9 code `76f5db5` + the engines `5ce0536` MERGED; dev's clip door on parakeet; S7a `f44025f` BUILT + two-reviewer-CONFIRMED (session 65, 2026-10-07); the S9 bake-off's no-owner-audio rows MEASURED (§6.4.1; H8 = the source build stays). OPEN = the S9 gate's owner-audio rows, TUNE (needs the owner's captures), S7b → S8 → S8b → S10 (§7.2).**
> Order: **S5 — D82 ratified THIS session, before session A** → session **A** on dev (transport, the dictation
> rulings, 16 kHz capture) → session **B** on dev (the host on the clip door, raw-audio capture and hand tuning, then THE FLIP — ctrl-b off Speaches in one config move) → **TWO releases (owner,
> ruled at close): v1.7.11 = the six polish fixes + session A** once A's field checks pass (Speaches still the ear) — **✅ v1.7.11 LIVE 2026-10-07 (§8.1.1)** · **v1.7.12
> = session B** once B's criteria (§6.4) pass. This file owns the ASR/VAD design;
> [`LIVE_VOICE_PLAN.md`](./LIVE_VOICE_PLAN.md) keeps the call loop, the mouth and the client admission layer. Evidence:
> [R94](./research/R94-asr-audits-verification.md) · [R95](./research/R95-vad-placement.md) · [R96](./research/R96-16khz-capture.md) ·
> [R97](./research/R97-peer-engine-design.md) · [R98](./research/R98-vad-model-landscape.md) (the VAD-model landscape + the plug-in boundary — the §3.4.1 amendment, 2026-10-01).
> **Amended 2026-10-06 (R26 / [D85](./DECISIONS.md), session 61): §3.12 the owner-voice discriminator on the pre-ASR pass** — a
> speech-vs-music tagger + owner verification against a per-route enrolled template — **✏️ RULED, council-closed (§11 "Council
> №2 — D85"), NOTHING BUILT; build = the D85 wave (§7.3) after session B → v1.7.13.** Evidence:
> [R101](./research/R101-speech-vs-background-discrimination.md).

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
| R23 | The owner's longer-pause intent ("test 0.7 first; widen to 3000") — **re-shaped by R97 P-3:** `silence_ms` stays the VAD end (500–1200); a longer pause is the client `turn_hold_ms` (0–3000, default 0). **Option A RULED 2026-09-30** — R23 closed as re-shaped; S7a/S7b unblocked. **Re-ruled 2026-10-02 (session 58): the hold's core pulled forward into session A, bound 0–10000, every taken final restarts it (§3.5 ⑤ amendment)** | owner |
| R24 | **NO SHADOW MODE, NO SPEACHES BASELINE, NO SEAMS PRODUCTION WON'T USE.** Speaches is replaced because it hallucinates and fails in noise, so it is no reference. The new ear is tuned BY HAND on captured reference audio with an OFFLINE replay tool; the one runtime addition is a debug-gated raw-audio capture. The ASR host swaps on the clip door BEFORE the live flip, so the flip removes Speaches from the live and TTS routes in one move | owner |
| R25 | **The VAD is a plug-in behind ONE model boundary (§3.4.1, R98, 2026-10-01):** `VadModel`/`VadStream` + a dict of constructors; `VadParams` in ms with the EMA as a time constant; every count derived from the model's hop; a per-model calibrated `default_act`; non-causal models refused on the live door; **the default model is Silero v6.2 (v5.1.2 stays registered as the replay A/B)** — owner: "agnostic … I don't want a big refactor later"; the main seat ruled the shape on R98's evidence | owner + main seat |
| R26 | **D85, the owner-voice discriminator (§3.12, 2026-10-06):** a speech-vs-music TAGGER (no enrolment) + OWNER VERIFICATION (a speaker embedding vs an enrolled template) composed on the pre-ASR pass; the template STORED on disk (a per-route embedding, never audio — SECURITY_MODEL §2.13); enrolment PER INPUT ROUTE (~30 s of natural speech per route). **Owner:** the problem is ctrl-b's ("there are other ways to filter out background music and sounds like that" — research first, then design, council, build) · both discriminators · the template stored · per-route enrolment. **Main seat:** any learner learns ONLY from finals the discriminator accepted, and a rejected segment never restarts the turn hold (R101 §5.3) · §3.6's chars-per-voiced-ms candidate WITHDRAWN (R101 §0.9) · the council rulings (§11) | owner + main seat |
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
| **Confirmation** | `⌈onset_ms/32⌉` consecutive `p̂ ≥ act` windows. M1 (counting `≥ deact`) is a `VadParams` VARIANT the harness A/Bs, not the default |
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
   leaking post-speech audio into its D74 accrual. The Q1 `short` exemption is thereby moot. **D9 as built (2026-10-02)
   RELIES on this: every answer — `endpoint`, `flush`, `short`, `max_segment`, the §3.5 ⑨ deadline answer and an
   `upstream_error` alike — goes out in STOP order, because a known id settles every id queued ahead of it (FIFO). An answer
   sent out of order would silently settle a younger segment; the relay's ordering is therefore a contract, not a courtesy
   (D9 code round, Opus L2).
4. **Onset** — tentative start + the §3.4 bounds: client timing, accrual, the noise verdict and `min_final_ms` behave as
   today, and a flickering real onset stays ONE segment, so the mouth gate never opens between halves of one utterance.
5. **The turn hold (R20 + R97 P-3) — ONE mechanism: a held pending turn absorbs the next final.** **▲ AMENDED 2026-10-02
   (session 58, ISS-55 — the owner's hands-off ruling; pulled forward into session A on TODAY's wire): the release rule below
   is replaced — EVERY taken final (re)starts the hold, so serial pauses stay ONE turn; the turn is submitted when the hold
   expires with the ear settled (`earUnsettled` false — D9's set + no open segment), or on `socketLost`/leg end (the held
   text drains at `ready`), or a terminal/`hidden` HARVEST; `routeChange` clears the hold and keeps the queue; `unmounted`
   (hang-up) ~~discards as today~~ **AMENDED 2026-10-06 (ISS-61, owner ruling): EVERY exit — hang-up, hidden, unmounted — HARVESTS the queue to the composer draft; nothing is discarded**; MUTE keeps the already-held text (only the half-utterance in flight is condemned — a
   cough-mute must not throw away a finished monologue); a DROPPED final never extends a hold but does release a DUE one;
   the mouth never opens while a hold stands (`mouthMayOpen` gains `!turnHold`). The bound is 0–10000 (owner: "I like the
   ten seconds cap"). The `max_segment` join below stays an ADDITIVE session-B flag. The rest of this paragraph is the
   session-B wording, kept for the `max_segment`/`flush`/`asr_error` reasons it adds.** After a call's final the
   pending turn is held `turn_hold_ms` (client key, 0–3000 → **0–10000** since the amendment, default **0** = today); a `speech_started` inside the hold
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
   exactly once. *(S7a appends on every release path — H2, the owner's never-lose ruling; the discard lands with S8's recovery.)* Tests: each release path · a three-segment capped turn (`max_segment → max_segment → endpoint`) submits
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
- ~~**Candidate, unruled (ISS-58, 2026-10-06):** a chars-per-voiced-ms ACCEPTANCE after ASR — the one call's genuine finals carried 50–60 ms of
  above-floor energy per character, the hallucination that went out carried 9. Engine-agnostic, not lexical, not a logprob gate (the hard rules
  stand); measured on the corpus FIRST (R24), and only if the pass alone leaves such cases through.~~ **WITHDRAWN 2026-10-06 (D85, R26):**
  R101 §0.9 — lyrics sit inside the owner's band (owner 55–101 vs music 8–197 ms/char), so the ratio separates nothing; the
  discriminator stage (§3.12) takes its place.
- **The discriminator hand-off (D85, §3.12.1):** the pass hands its voiced span (the hops ≥ `prepass_act`, no second VAD run) and
  the leg's `GateCtx` to the §3.12 stage — tagger, then owner verification on call legs — between the VAD pre-pass and ASR, and
  returns a `Verdict` instead of `no_speech | chunks[]`.
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
- **Engines are config (D48):** CrispASR / onnx-asr = a `providers:` edit, never code. **RAM:** 2.2–2.3 GB per instance measured (§6.4.1; the pre-build estimate was ~1.5 GB);
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

1. **D9 — awaited-id set (✅ BUILT 2026-10-02, session 58; AS-BUILT amends this paragraph — the code round's rulings).**
   `waitingFinal: boolean` → `awaiting: readonly string[]` — an ORDERED list (FIFO, §3.5 ③), `""` for an id-less stop —
   with `waitingFinal` DERIVED in the reducer's normalize (`mouthMayOpen`, `CallOverlay`, `idleExpired` unchanged; no arm
   writes it). An accepted `speechStop(id)` appends. ONE `settle(id)` rule for every `final` exit (taken or not) AND for
   `error{upstream_error}`: an id IN the set removes itself and every id ahead of it (FIFO — a stop whose answer never comes
   heals on the next answer); an id NOT in the set (a late final after its id expired, §3.5 ⑨) removes only the `""`
   sentinels, never the other awaited ids (no early mouth); an id-LESS answer clears all (the Speaches-era belt).
   `upstream_error` WITH `item_id` settles that id AND sets the note; WITHOUT one clears all. **The pairing (H6, ruled
   session 65 — S7a's parser is the contract):** the new ear sends the TYPED final FIRST (`outcome:"asr_error"`, empty
   text) and THEN `error{code:"upstream_error", item_id}` — the final settles the id silently, the error alone sets the note
   (its settle then finds the id gone). Only Speaches sends the error INSTEAD of a final (and names no id — the belt). `ready`/`socketLost`/mute/`routeChange`/`terminal`/the ISS-54 ear reset clear. `earUnsettled(s)` =
   `awaiting.length > 0 || (userSpeechActive && !noiseOpen)` is the ONE predicate anything that waits on the ear reads (the
   turn hold, ⑤ below); `mouthMayOpen = !earUnsettled && !sinkWait`. `parseLiveFrame` gains `error.item_id` — today's relay
   sends none on errors, so only the belt runs until S7b (documented in code). Closes LIVE_VOICE_PLAN OPEN-2.
2. **D8 — provisional floor.** Starts from the trail (why did that call's floor sit at −60?). Until the tracker settles the
   floor seeds from `V − 2·voice_margin_db` (the exact key, else the device's other EC mode, else the last learned level);
   once settled the measured floor wins in EITHER direction; never learned from. No key.
   **As built (session 60, the D8 audit + the main seat's rulings — this corrects the premise above):** the −60 is not a
   5 s window — it is a quiet room's settled `N + noise_margin_db` clamped to `min_dbfs`, and it holds until a voice level
   is LEARNED (B4's turn was judged 33 s after settle); the exact key was already live at `V − vm` from the first frame. So
   the seed is the two BORROW tiers only — `store/voiceLevels.borrowVoiceLevel`: the same device's other EC mode(s) (the
   lower if two), else the last-WRITTEN other key (`setVoiceLevel` re-appends: blob order = recency, shape unchanged; the
   only tier for an unnamed device) — applied in `levelGate.autoFloor` as `max(base, seed − SEED_MARGINS·vm)`,
   `SEED_MARGINS` = 2, with **lifetime L2: until THIS key's own V is known** (settled or not — noise still wins UP; only
   the learned V takes it down); no `floor_dbfs` cap; never learned from, never persisted. The trail: `voiceSeed` on the
   `capture` line, `seed: "mode"|"last"` on a `final` line only when it set that floor.
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
   **As built (session 60, the D5 audit + the main seat's rulings):** `LiveSessionSlots` is an admission TABLE —
   `{holder → client_id | None}`, `acquire(cap, client_id, holder) → "admitted" | "superseded" | "busy"` (synchronous, D38),
   `release(holder)` owner-checked and idempotent (an entry leaves exactly once — the ONE release is still the route's
   `finally`). A same id is matched FIRST, at any cap (Q1: one leg per client — identical to "full AND matches" at the
   default cap 1); `None` matches nothing, so an id-less `start` (a v1.7.10 PWA, a tab without storage) gets the counted cap
   and the byte-identical busy frame + 1013 it always had. The session takes the slot itself, right after `start`
   (`_admit`); a refusal is `_fail("busy")` inside `run()` — so a busy leg now logs its leg-end line (`reason=busy`, Q9).
   The old leg ends through its OWN teardown, never a cancel: `supersede()` sets a flag that a pre-`ready` check (a leg
   superseded mid-dial finishes that dial, then ends) and `_pump`'s fourth waiter task turn into `_Superseded` →
   `ended{reason:"superseded"}` + close 1000 "superseded" (the clean-stop tail; the `stop` end stays reason-less).
   **`ended{superseded}` reaches only a running leg; a leg already closing just loses the slot.** `client_id` is validated
   with the trail id's own predicate (`valid_call_id` → 1008), is mode-agnostic (Q2), and appears in no log or trail line.
   The client: `liveClientId()` in `lib/liveSocket.ts` (`sessionStorage["ctrlb-live-client"]`, memoized per document,
   every storage access try/catch'd, no storage or no `randomUUID` ⇒ no field) and `openLiveSocket` adds it to EVERY
   `start` (Q4). The call: `ended{superseded}` ⇒ a terminal with `CALL_COPY.superseded`, never a redial (Q6); the busy arm,
   the `ctrlb-live-call` marker and the ≈14 s ladder are KEPT as the compat path (a pre-D5 relay, an id-less tab — Q5).
   Dictation: no new arm (the death rule stands; S8's recovery ships in v1.7.12, so in v1.7.11 a superseded live dictation
   leg loses its tail); "one wanted leg per tab" (Q3) is enforced by a TAB-WIDE hold in `store/micRelease.ts` (`holdLeg`,
   raised at `onstop` when a release takes the leg, settled at that leg's `close()` + a `.finally` belt): `start()`
   refuses while `legClosing()`, and `releaseMic` waits it out after the ear's own release — so a call's first leg waits
   ≤ `tail_wait_ms` (the microphone itself is still back at `onstop`), and a REMOUNTED composer or none at all sees it
   too (the release survives the composer's unmount; the id is per tab). For v1.7.11 this hold is the ONLY protection of
   a closing leg's tail — nothing recovers it. The call's `acquire` checks `alive()` the moment that wait resolves, so a
   hang-up inside it opens no microphone. Residuals: the duplicated tab (a copied `sessionStorage` carries the same id —
   SECURITY_MODEL §2.10, Q8; the call's note claims no continuity, "the call was taken over by another ctrl-b
   session"); ~10 s of two Speaches sessions while a superseded leg's close waits out a dead peer; the "old finish runs
   `maybeAutoSend` over the next recording" defect is ISS-60, not D5.
5. **K6 — 16 kHz capture (R11).** `new AudioContext({ sampleRate: 16000 })` through ONE synchronous helper,
   `openCaptureContext` in `pcmCapture.ts`, called at both context sites (`startPcmCapture` and `useDictation.ts`'s
   `armDetector`); on `NotSupportedError` from `createMediaStreamSource`, close and rebuild at the native rate
   (capability-checked, never UA-sniffed), the rebuilt context brought to `running` via the caller's own resume path
   (council 25).
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

### 3.12 The owner-voice discriminator on the pre-ASR pass (D85)

> **✏️ RULED 2026-10-06, council-closed, NOTHING BUILT; build = §7.3** (the D85 wave, after session B → v1.7.13). Ruling
> R26 (§0.1) / [D85](./DECISIONS.md); evidence = [R101](./research/R101-speech-vs-background-discrimination.md) + the three
> trails (ISS-58 · ISS-63 · ISS-65); config = §4 (seven rows) · telemetry = §5 (T14) · corpus = §6.3 (amended) · ladder =
> §7.3 (D85-S1 … D85-S4 + D85-TUNE) · at rest = SECURITY_MODEL §2.13 (§2.12 is S6-ii's captured audio). Council record = §11
> "Council №2 — D85". **Precedence:** the owner's rulings > the council's rulings (`RULINGS-D85.md`: F1–F12 · L1–L5 · E1–E4 ·
> N1–N12 · R2-A…R2-H · P1/P2/N-b · new-3 · the round-5 readback-echo note) > this text. Transcribed from the council's design v2.5.

**Why.** A level gate cannot separate the owner from a background whose peaks sit inside the margin: ISS-58 at 6–8 dB under,
ISS-63 at 0 dB under (comm-mode processing equalises the TV), ISS-65 at 3–10 dB under — the same defect at three distances
(ISS-65 a). The owner ruled BOTH discriminators (R101's ranking): a speech-vs-music **TAGGER** (no enrolment) and **OWNER
VERIFICATION** (a speaker embedding against an enrolled template), composed on this pass; the template is STORED (a per-route
embedding, never audio); enrolment is PER INPUT ROUTE. The main seat: any learner learns ONLY from finals the discriminator
accepted, and a rejected segment never restarts the turn hold (R101 §5.3); §3.6's chars-per-voiced-ms candidate is WITHDRAWN.

| Trial | Today | After D85 |
|---|---|---|
| ISS-65 music with vocals, 3–10 dB under the owner | every final taken; the learner poisoned | the tagger rejects "no speech" (3 % leak measured); the owner over music passes (99–100 %); SV rejects the rest on call legs (music max cos 0.38) |
| ISS-63 the TV at the owner's level | 14 of 30 finals were the TV | TV-only segments rejected by SV at any level; **owner-over-equal-TV stays a known hole** (segment cos ≈ the threshold) — the whole span is scored first, then two CONSECUTIVE 2 s windows may recover an owner-dominant stretch of a span > 4 s (§3.12.1 ④); the frame-level exit is a personal VAD on the `VadModel` seam (§3.4.1) when an open one exists |
| ISS-58 6–8 dB-under fakes (source unknown) | refused by the level gate only when quiet enough | SV rejects it if it was another voice; a level/density rule if it was room sound; the tagger if it was not speech |

The poisoning loop (ISS-65 b) closes: a reject arrives as an EMPTY final, which the as-built client never takes and never learns
from (R5 by construction, §3.12.5), and where the leg runs the owner check the learner learns only from `accept:"owner"` finals.
The fix for ISS-63's root (the shared level key, ISS-64) comes first, in D85-S1 (§3.12.4).

#### 3.12.1 The stage — where it sits: the pre-ASR pass, both doors (§3.6); nothing else moves

`prepass(pcm16k) → no_speech | chunks[]` becomes `prepass(pcm16k, gate: GateCtx) → Verdict`, where `GateCtx = {mode, template |
None}` (resolved once per leg, §3.12.3) and `Verdict = {outcome: "ok" | "no_speech" | "not_speech" | "not_owner", chunks, accept:
"owner" | "speech" | "unscored", speech_p, owner_cos, voiced_ms, scored: {"speech": bool, "owner": bool}}`. It runs in the per-leg
ASR worker via `to_thread` (never the `vad` executor — Q4 ⑤; the clip door's `to_thread` likewise), INSIDE the segment's one
§3.5 ⑨ `timeout_s` deadline. The order is VAD → tagger → owner → ASR. Per segment:

1. **The VAD pre-pass** as designed (§3.6) → `no_speech` ends it (no ASR). Its own per-hop probabilities give the **voiced
   span**: the hops ≥ `prepass_act`, concatenated (no second VAD run). **Both scorers see the voiced span only** — the pass's
   ±400 ms crop pad and the tail pad are never scored (a 300 ms "yes" is a ≥ 1.1 s crop of mostly padding; F4). Enrolment embeds
   the same way (§3.12.3).
2. **The minimum:** `voiced_ms < gate_min_ms` (default **1000**) ⇒ BOTH scorers are skipped, `scored` both false, `accept:
   "unscored"`, on to ASR (fail-open). R101 measured SV only from 1.0 s and nothing measured CED-tiny on the owner's short finals
   (R101 §6.5); a sub-second answer keeps today's path — so v1.7.12's short-answer recall gate (§6.4) stays met by construction.
   D85-TUNE may lower the key once R101 §6.5 is measured on the owner's short finals.
3. **The tagger** (`speech_gate` on, model loaded; both modes, both doors): 2 s windows at a 1 s step over the voiced span,
   `speech_p` = the MAX ("speech anywhere in the segment = speech present"), which lets the walk stop at the first window ≥
   `speech_act`. `speech_p < speech_act` → `not_speech` (no ASR). One window rule for every length (§3.12.2). `speech_act` 0.3 is
   PROVISIONAL (N3): R101 scored raw windows, pauses included; this input is the voiced span, so the first `--discriminate` run
   re-measures the operating point before D85-TUNE (D85-S2's acceptance).
4. **Owner verification — CALL legs only** (`mode == "call"` ∧ `GateCtx.template` valid — the same predicate as
   `ready.owner_check`, §3.12.5): embed the WHOLE voiced span; `cos ≥ threshold` ⇒ `accept: "owner"` (early). Otherwise, only
   for spans **> 4 s**: 2 s windows at a 1 s step, accept when **TWO CONSECUTIVE** windows score ≥ threshold — stricter than v1's
   max over 1 s sub-windows (~19 tries at a 10 s span, F5), but NOT a guarantee: adjacent windows overlap by 1 s, so one 2–3 s TV
   passage can raise both, and a 20 s span offers 18 pairs (R2-B). The guard is MEASURED, not claimed — `--discriminate`'s
   false-accept matrix by length bucket (§6.3). Neither ⇒ `not_owner` (no ASR). Live dictation and the clip door never run this
   step (F9): a false `not_owner` there would advance §3.8's boundary and lose the words for good, and the clip door has no route
   key anyway.
5. **ASR** as designed (§3.7). Cost on one core: **~40 ms typical; worst case ≈ 0.9 s at 20 s** (`max_segment_s`: 19 CAM++
   windows × 25–35 ms ≈ 0.5–0.65 s + the whole-span embed ≈ 0.2 s + the tagger walk ≤ 19 × ~5 ms — CED-tiny 7.3 ms per 3 s
   measured), **inside the 10 s deadline** (§3.5 ⑨), before a ~hundreds-of-ms ASR. `--discriminate` reports the stage's MEASURED
   p95 at 20 s before D85 ratifies (§6.3).

`accept` is the strongest check that passed: `"owner"` (step 4 accepted), else `"speech"` (step 3 passed, step 4 not run), else
`"unscored"` (no scorer ran).

**Fail-open, by rule (D74's posture — a UX filter, never an auth control).** A missing or failed scorer skips its step with ONE
warning per process. A template that is missing, unreadable, invalid, or model/dim-mismatched ⇒ the leg is `unscored` for the
owner step, ONE warning per process per file, and Conf's "Your voice" shows "re-enrol" for that route (F8). A malformed or
over-long route key ⇒ `unscored`, never a close (L1). Under `gate_min_ms` ⇒ both skipped. **Nothing raises past the stage:** it
wraps each scorer call; the worker never sees a gate exception, so a template problem can never become `asr_error` (in dictation
the first `asr_error` is a DEGRADE trigger, §3.5 ⑦). Nothing lexical, no logprob gate (the hard rules of §7 stand); the tagger
judges SOUND, not words.

**What a reject looks like on the wire (F1).** A `not_speech` / `not_owner` segment is answered with the ORDINARY empty final —
`{type:"transcript", final:true, text:"", item_id, reason, outcome:"no_speech", gate:{reason, speech_p, owner_cos, near}}` —
`no_speech` being a valid (reason, outcome) pair for every reason a pass runs on (`short` never reaches the pass). There is NO
`rejected` frame: one-answer-per-stop (§3.5 ②) and STOP-order delivery (§3.5 ③) hold untouched, D9's `settle` releases the id,
and a pre-D85 PWA treats it as the no-speech final it already knows. **The clip door** answers a `not_speech` clip with today's
empty text — `useDictation` (`useDictation.ts:735-740`) toasts "Didn't catch that — try again", which is accurate; the `gate`
object rides the STT JSON for the trail and debug only (E3).

#### 3.12.2 The models — the §3.4.1 shape again: Strategy behind one small Adapter, a dict of constructors

```python
class SpeechTagger(Protocol):   # services/voice_tagger.py
    name: str; sample_rate: int; default_act: float   # CED-tiny: 16000, 0.3 PROVISIONAL (R101 §2.2; re-measured on the voiced span, N3)
    def p_speech(self, pcm: NDArray[np.float32]) -> float: ...   # ONE window in, P("Speech") out; wraps sherpa_onnx.AudioTagging
class SpeakerModel(Protocol):   # services/voice_speaker.py
    name: str; sample_rate: int; dim: int
    def embed(self, pcm: NDArray[np.float32]) -> NDArray[np.float32]: ...   # L2-normalised; wraps sherpa_onnx.SpeakerEmbeddingExtractor
TAGGER_MODELS = {"ced-tiny": …}; SPEAKER_MODELS = {"campplus-en": …}   # config Literals, like VAD_MODELS
```

- **The backend is the `sherpa-onnx` wheel** (F10) — `AudioTagging` for CED-tiny, the speaker-embedding extractor for CAM++ —
  the pipeline R101 measured (sherpa-onnx 1.13.8, cp314). Still §3.4.1's Adapter: the Protocol is ours, the frontend (mel /
  fbank-80, `normalize_samples`) is theirs, so no hand-written feature code drifts from the calibration. R101 §7.4 ran CAM++
  through kaldi fbank-80 with sherpa's `normalize_samples` metadata, so D85-S2 CROSS-CHECKS R101's genuine/impostor numbers on the
  sherpa extractor path, and the golden vectors pin that path (N4). `kaldi-native-fbank` is NOT added (it is not an existing pin
  — FireRed was never adopted). `P(Speech)` = the "Speech" class's probability from the top-k (k = 40), a missing class = 0
  (R101 §7.3).
- **One window rule** (F10): every scorer window is 2 s at a 1 s step over the voiced span; a span shorter than 2 s is ONE window
  of its own length. The window policy lives in the stage (`voice_prepass.py`), not the Protocol — there is no `window_s`.
- **Weights** SHA-pinned under `assets/ced/` (the sherpa CED-tiny int8 export + its label CSV, 6.1 MB) and `assets/campplus/`
  (`3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx`, 29.6 MB) beside `assets/silero/`. Licences: Apache-2.0 weights (R101 §5.4).
- **The `voice` extra** gains `sherpa-onnx` (exact pin), wired through the same four places as S6-i's (T-12): `install.sh:116`,
  `ci.yml:80`, `deploy/bootstrap.py`, `deploy/windows/` — in D85-S2.
- **Two runtimes, one process (N8).** The sherpa-onnx wheel bundles its own onnxruntime beside the `onnxruntime` wheel Silero
  uses; D85-S2 proves both load in one process (an import-order test, both orders) before the extra ships. If they cannot coexist,
  the Silero adapter moves onto sherpa's runtime THEN (one runtime) — not now.
- **Threads** (L3): `num_threads = 1` per scorer (R101 measured on one thread, `intra_op = 1`), asserted on the built config the
  way S6-i asserts its ORT options — beside parakeet's 4+4 and PocketTTS's 8.
- **Golden vectors** per scorer: a known fixture → a pinned score ± ε against the sherpa-onnx outputs (§3.4.1 ⑥), plus the
  file's sha256 and the Literal-keys == dict-keys registry invariant (§3.4.1 ⑤'s shape).
- **In-process, NOT parakeet-server v0.6.0's `--sound-model`:** the engine is config (D48) and may be swapped; the discriminator
  must not die with it; SV has no server-side home (R101 §2.4: CLI/C-API only); and its `sound_events` arrive WITH the
  transcription, so they cannot gate ASR. One instance per model per process; `to_thread` calls only.

#### 3.12.3 Enrolment — the one owner-file write surface this adds

- **Client:** Conf › Live call › "Your voice" lists the known route keys (the device store's voice-level keys + the current
  capture's) with enrolled / not / "re-enrol" (from the `GET` below). "Enrol" opens the capture EXACTLY as a call on that route
  would (`startPcmCapture` → `openMicStream` + `openCaptureContext` with the route's `micConstraints` — same NS/AGC/EC, same 16 kHz
  PCM; the template must see the channel it will judge), shows a 30 s meter with a short reading prompt, accumulates PCM16 in
  memory (≈ 960 KB) and uploads it as WAV.
- **The capture must BE the route (E1).** `openMicStream` (`pcmCapture.ts:114`) retries WITHOUT the picked device and reports
  `fellBack: true` (`:129`); a call wants that, enrolment cannot. Enrolment ABORTS on `fellBack`, and RECOMPUTES the key from the
  effective capture readback (`MicReadback`, `:345`, through the §3.12.4 grammar): the upload goes out only under the key the
  readback produces. A mismatch with the requested route = a visible error ("the headset was not the active mic — connect it and
  retry"), nothing uploaded, nothing written. A capture death mid-meter aborts the same way.
- **Server (F3, L1):** `PUT /api/voice/enroll/{key_hash}?route_key=…` — raw-body WAV, never POST, never multipart: the VERB is the
  CORS control (SECURITY_MODEL §2.7) — a safelisted POST is a write any page in the owner's browser can fire without a preflight.
  `key_hash` = `sha256(route_key)[:16]` hex (the client's `crypto.subtle`, a secure context like the mic itself); the server
  recomputes it — a mismatch, or a `route_key` outside the §3.12.4 grammar, is 422. Bounded like the clip door: PyAV decode on
  `to_thread`, ≤ 60 s decoded / 60 s wall, 422 undecodable, 413 over `attachments.max_file_mb`. The VAD pre-pass keeps voiced
  frames only and requires ≥ 20 s of them (422 `too_short`). Embeddings per **2 s window at a 1 s step** (~19–29 windows over
  20–30 s of speech — a p10 over ~10 non-overlapping windows is the first or second lowest value, noise; R2-G) → centroid (mean,
  re-normalised) → **`genuine_p10` LEAVE-ONE-OUT** over those windows (each window vs the centroid of the OTHERS — an in-sample
  p10 is inflated, F11). Writes `$CTRLB_HOME/voice/owner/<key_hash>.json` = `{model, dim, centroid[dim], windows, genuine_p10,
  enrolled_at, route_key}` — **never a threshold** (dir 0700, file 0600, write-replace via `core/fsutil`). The audio is DISCARDED
  after embedding (the §6.1 debug capture is a separate, debug-gated path). `DELETE /api/voice/enroll/{key_hash}`; `GET
  /api/voice/enroll` = metadata only, never the vector: per file `{key_hash, route_key, model, windows, genuine_p10, enrolled_at,
  valid, threshold, floor_binds}`, `threshold`/`floor_binds` computed with the CURRENT floor. The file name is a hash, so there is
  no slug grammar, no collision and no length cap; the key itself lives in the metadata.
- **The threshold is computed at LOAD, never stored (F11):** at each call leg's start (and for the `GET`), `threshold =
  clamp(genuine_p10 − OWNER_MARGIN, cfg.owner_threshold, 0.70)`, `OWNER_MARGIN = 0.12` — a constant with R101's provenance: the
  wideband owner p10 0.61 → 0.49, above the impostor p99 0.40 and under the music-depressed genuine p10 0.51–0.56 (R101 §2.4), so
  the rooms D85 targets do not over-reject. A Conf floor edit therefore reaches every enrolled route on its next leg.
- **Template validity (F8)** — checked at the same load: JSON parses; `model == cfg.speaker_model`; `dim == the model's dim ==
  len(centroid)`; every value finite; `‖centroid‖ ≈ 1`; `genuine_p10` finite in [−1, 1]; `sha256(route_key)[:16]` = the file's
  name. Any failure ⇒ `valid: false`, the leg `unscored`, one warning per process per file — never a raise.
- **The readout** after enrolment (and in the list): `genuine_p10`, the effective threshold, and a warning ONLY when the FLOOR
  binds (`genuine_p10 − floor < OWNER_MARGIN`): "this route's scores are low — a narrowband headset or a noisy enrolment;
  re-enrol, or raise/lower the floor knowing it trades leak for loss". A healthy wideband enrolment (p10 0.61 → 0.49 > 0.42)
  shows no warning.
- **Re-enrolment replaces** (no averaging across sessions — Willow/parakeet.cpp are enrol-only; a drift fix is a re-enrol).
- **At rest — SECURITY_MODEL §2.13 (N9, N10).** The template is **a biometric identifier (a voice print), never audio.**
  `install.sh`'s backup set and the Phase 23 S9 export route (D79) EXCLUDE `$CTRLB_HOME/voice/`; `DELETE` is the ONLY removal; no
  route ever returns the vector (the `GET` is metadata only). E1's route check is CLIENT-enforced — the server cannot verify that
  the uploaded audio came from the route `route_key` names — accepted under the single-user posture, because the gate is a UX
  filter, never an auth control. **The pin is a SOURCE SCAN (R2-F):** no module except the template store reads `voice/owner` (the
  D65 registry-confinement precedent) — a test over the backup and export inventories would pin nothing, since `install.sh`'s
  backup is the SQLite snapshot (`deploy/linux/install.sh:294-296`) and the S9 routes export cards and lorebooks
  (`api/agent.py:2349`, `:2502`). D85-S3.

#### 3.12.4 The route key — ISS-64 is the prerequisite, built first (D85-S1)

Today the voice-level key is `voiceDeviceKey` (`store/voiceLevels.ts:53`): the readback `deviceId` when it is real, else the
LABEL — so on the call route the phone mic and a Bluetooth headset, which BOTH read back `deviceId:"default", label:"Default"`
(all three trails), share `Default|ec=all` (ISS-64). Appending a route alone fixes nothing (F2). The grammar:

`<device>|ec=<all|on|off>|<call|media>` — and the key must not depend on HOW a route was reached (the default, the in-call
picker, the D74 steer): one physical route under several keys means "no template found" and a silently `unscored` leg (R2-A).
ONE rule for `<device>`:

- **On a synthetic-list platform** (Chrome Android: `syntheticRoutes(listAudioInputs())` is non-null, `pcmCapture.ts:174`,
  `:255`), `<device>` is the synthetic ROW TOKEN of the row that actually OPENED — `bluetooth` (Bluetooth headset) · `wired` (Wired
  headset, USB audio) · `builtin` (Headset earpiece, Speakerphone) — never a label. Resolved in this order:
  1. **a real readback `deviceId` that equals a synthetic row's id** → that row's token — the READBACK is decisive, because every
     candidate asks for its device as `ideal`, never `exact` (`micConstraints`), so a successful open proves only that the request
     was satisfied somehow, not that the named row opened (council №3, Opus P1); pick, steer and default CONVERGE on one token
     (the headset Chrome selected by default and the headset picked in the in-call `DeviceRow` are one key);
  2. **a `default`/`""` readback after an EXPLICIT request** (a pick, a D74 steer rung) ⇒ the device is UNDETERMINED — the
     `ideal` request may have been relaxed onto another input, and a successful open is not evidence that the named row opened
     (council №4, Emma new-3) ⇒ the EXISTING unnamed path: `voiceDeviceKey` returns `null`, D8's borrow takes `null` to its `last`
     tier, nothing is persisted, the client sends NO `route_key` ⇒ `unscored`. "The candidate that opened" is NOT a key source —
     `openMicStream` returns nothing new (the trail's `capture` line still logs the candidate for the field record);
  3. **the CALL route's UNSTEERED default** (the plain default request — the steer never touches the call route) → what Chrome
     selects, the MOST UNIQUE communication device (R77 §1.2): the Bluetooth row when present, else wired, else builtin. **This
     Bluetooth-first inference is used ONLY here.** The media route's own ladder (`candidateConstraints`, `pcmCapture.ts:205-225`)
     AVOIDS the Bluetooth row — earpiece → wired → speakerphone — so a steered media capture's token comes from its readback (1) or is undetermined (2); a media
     capture that opened the plain default did so because no Bluetooth row stood, and Chrome's selection there is wired when
     present, else builtin. The list is read AFTER the open (the labels are readable then), so even the very first media capture
     before permission resolves this way (R77's default selection names the row). **A row that still cannot be determined** (no
     synthetic list readable even after the open) is the EXISTING unnamed case: `voiceDeviceKey` returns `null` ("a mode alone
     identifies nothing"), D8's borrow takes `null` to its `last` tier, nothing is persisted, and the client sends NO `route_key`
     → the relay is `unscored` by the rule it already has. No new sentinel, no new guard (council №3, Opus P2; the main seat's
     `unknown` key of R2.2-I is WITHDRAWN as a duplicate of this path).

  The list is resolved once after the open (the labels are readable then) and the token rides the readback; `voiceDeviceKey`
  stays sync. **UNVERIFIED and measured FIRST (council №5, Opus): whether Chrome Android echoes the row's id in
  `getSettings().deviceId` after an EXPLICIT request, or `default`** — every dev trail so far was unpicked (`captureReady.deviceId:
  ""`, readback `default`, no route list logged). If explicit requests read back `default`, rule (2) would leave every steered
  media capture with a Bluetooth row standing and every in-call pick permanently unnamed (no level, no enrolment). So D85-S1's
  first trail logs, on the `capture` line, the REQUESTED candidate (id + row label + the request kind: default / steer / pick), `fellBack`, the readback `deviceId` + `track.label` and the route list,
  across a FOUR-ARM phone card: call default · call pick · media with BT (steered) · media without BT. If explicit requests read
  back `default`, rule (2) is RE-RULED before D85-S2 — the named exit is an `exact` PROOF rung: on Android an unavailable row
  fails to a null stream rather than relaxing (R74 §2.2 (b)), so an `exact` success proves which row opened and becomes a key
  source.
- **On a non-synthetic platform** (desktop, Fennec): a real readback `deviceId` is the device; a `default`/`""` readback is
  resolved through `enumerateDevices` by `groupId` to the real deviceId of the same physical device (desktop Chrome's `default`
  entry shares the real device's `groupId`); only when nothing resolves is the device `default`. Without this, every desktop
  system-default mic would be `default` — ISS-64 again on desktop.
- **Labels are never part of a key** — they are localized ("Default"); the row tokens are the capability, not the words.
- **ONE grammar** for the level store, the trail's `voiceKey`, the D8 borrow tiers (which still borrow within a device:
  `lastIndexOf("|ec=")` still finds the device prefix) and the enrolment file. The client sends it in `start` as `route_key` (a new
  optional field; a v1.7.10–12 relay ignores it; a new relay with none, or a malformed/over-long one ⇒ `unscored`, never a 1008 —
  unlike `_parse_start`'s `client_id` rule, `voice_live.py:680`, L1).
- **No legacy fold (L5):** the shared `Default|ec=all` level IS the contamination ISS-64 names; copying it into the new keys would
  carry it over. D8's borrow seeds the fresh keys; the legacy entry goes through the store's existing purge (`setVoiceLevel`'s
  drop-on-write, `voiceLevels.ts:72`), whose predicate moves to the D85-S1 grammar — a key without the `|<call|media>` suffix is
  purged on the first write (N1) — and `borrowVoiceLevel` (`:101`) filters with the same predicate, so a legacy level is never
  borrowed before that first write.

#### 3.12.5 The client half

- **The final** (`LiveDown`'s `transcript` arm, `liveSocket.ts:30`, parsed at `:121`) gains two OPTIONAL fields: `accept:
  "owner" | "speech" | "unscored"` on a taken-by-the-relay final, and `gate: {reason, speech_p, owner_cos, near}` on a reject
  (§3.12.1). `near` is the RELAY's (it alone knows the threshold): `owner_cos ≥ threshold − 0.10` — TV impostors score
  ~0.15–0.35, an owner on a wrong or stale template ~0.4–0.5 (R2-D). **The ready frame** (`{type:"state", state:"ready"}`, sent at
  `voice_live.py:577`; S7b adds `clock`/`answer_ttl_ms`) gains `owner_check: bool` per leg = template valid ∧ `owner_gate` on ∧
  speaker model loaded ∧ `mode == "call"` (F6).
- **Both directions (E2):** absence = today's take/learn behaviour EXACTLY — a v1.7.10–12 relay sends neither field and no bit,
  and the new client behaves as it does today; a D85 relay's extra fields reach an old client whose `parseLiveFrame` copies only
  the fields it knows. One test per direction, both pinned (old-relay frames → the new reducer; D85 frames → today's parser).
- **The learner (R5, F6)** — at the one call site (`useLiveCall.ts:2824-2825`): when the leg's `owner_check` is true,
  `learnVoice` learns only from a taken final with `accept === "owner"`; when it is false or absent, today's rule. The bit is what
  keeps V from freezing forever when the models are missing, the gate is off, the template is stale, or the leg is a dictation.
  (With the bit true, V adapts only from finals ≥ `gate_min_ms` voiced — the INTENT (N11): short finals are the noisiest
  teachers, and a sub-`gate_min_ms` final is `unscored`.)
- **A reject is an empty final**, so the as-built empty arm (`useLiveCall.ts:1281-1285`) already does what R5 asks: it SETTLES
  the id (D9's `settle`, `:893`), never reaches `taken` — so it never restarts the turn hold (§3.5 ⑤: every TAKEN final restarts
  it; a dropped one never extends it) and never feeds the learner. Pinned by test: `stop(A) → reject(A)` releases the mouth and a
  due hold.
- **Visible, never heard (F7, R2-D).** No chirp for relay rejects (the drop cue stays the client gate's; the owner found "the
  whistle between replies" confusing). Only a NEAR miss is news to the owner: inside the empty arm, a `not_owner` with `gate.near`
  puts a silent note in the in-call NOTE slot (the `switchingRoute` "switching to call mode" precedent, `CALL_COPY`) — a new
  `CALL_COPY.notOwner` — **never on the HEARD line**, which keeps the owner's last words. After **3** consecutive NEAR `not_owner`
  in one leg (`NOT_OWNER_RUN`, a constant, not a key; STRICTLY consecutive: ANY final that is not a near-miss `not_owner` — a
  taken final, a FAR reject, a `not_speech`, an unscored one — resets it, so near misses never accumulate across the TV's own
  rejects on a narrowband headset; council №3 Opus N-b + Emma new-2) the note reads "the background filter is rejecting your
  voice — re-enrol in Conf › Your voice, or switch it off". A FAR reject (the TV, the music — the filter WORKING) is silent and
  counts toward nothing: it shows only in the debug readout and the trail, so three correct TV rejects never tell the owner to
  switch the filter off. `not_speech` stays silent, like any no-speech final. The debug readout counts rejects per reason (near /
  far).
- **Conf** › Live call › "Background filter": `speech_gate` / `owner_gate` switches + the `owner_threshold` floor (advanced:
  `speech_act`, `gate_min_ms`); "Your voice" (§3.12.3).

#### 3.12.6 Known limits, stated to the owner (R101 §6)

- **Owner over an equally loud TV** is ambiguous to a segment score; the two-consecutive-window rule recovers only clearly
  owner-dominant stretches of spans > 4 s — and, symmetrically, a 2–3 s TV passage that scores like the owner can pass it; the
  by-length matrix measures both (R2-B).
- **Narrowband is a MEASURED LIMIT (F11):** on an HFP/CVSD headset enrolled narrowband, impostors reach p99 ≈ **0.50** — above
  the 0.42 floor — so a TV or another talker leaks at a measurable per-route rate, which D85-TUNE records per route (a miss of the
  95 % gate there is this limit, not a failure, R2-C). One floor key, no per-route knob: the owner trades leak for loss on the
  floor, or re-enrols.
- **Two Bluetooth devices are one key:** Chrome's synthetic list has one Bluetooth row, so the car and the earbuds share a
  template and a level.
- Rap / spoken-word vocals can pass the tagger; a cold or a whisper lowers genuine scores (re-enrol); finals under `gate_min_ms`
  voiced are not scored at all; studio-stem numbers may move on a real room + the Honor 20 mic (D85-TUNE measures).
- **Background under `gate_min_ms` is unscored** — it reaches ASR (never the learner when the owner check runs); the matrix
  counts it as accepted, and D85-TUNE decides whether a lower tagger-only minimum (`speech_min_ms`) is warranted (R2-E, §4).
- **Rollout residue (R2-H):** a stale v1.7.12 PWA on a D85 relay still learns from `speech`/`unscored` finals (it knows no
  `owner_check`); rejects are empty finals either way, and the next PWA update closes it.
- **Dictation is tagger-only:** a tagger false reject (0–1 % of the owner over music, R101) answers `no_speech`, so §3.8's
  boundary advances past that span.

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
| **`turn_hold_ms`** | int · **0** · **0–10000** (was 0–3000; owner 2026-10-02) | client | Live call › "Thinking pause (ms)" (**✅ BUILT session 58**, pulled forward from S7a; FE row + round-trip test) | NEW (R97 P-3, amended §3.5 ⑤): the pending-turn hold — every taken final restarts it | additive |
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
| **`speech_model`** (D85) | Literal of `TAGGER_MODELS` · **`ced-tiny`** | server | **none** — config-only | NEW (D85-S2, §3.12.2): which registered `SpeechTagger` the stage runs | additive |
| **`speaker_model`** (D85) | Literal of `SPEAKER_MODELS` · **`campplus-en`** | server | **none** — config-only | NEW (D85-S2, §3.12.2): which registered `SpeakerModel` the stage runs; a template's `model` must equal it (§3.12.3) | additive |
| **`speech_gate`** (D85) | bool · **true** — the tagger, both doors, both modes | server | Live call › Background filter (D85-S4) | NEW (D85-S2, §3.12.1 ③) | additive |
| **`speech_act`** (D85) | float · **0.3** · 0.05–0.9 (the model's scale; `default_act` is the provenance, like `prepass_act`) | server | Background filter (advanced) | NEW (D85-S2): PROVISIONAL — re-measured on the voiced-span input in D85-S2, set in D85-TUNE (N3) | additive |
| **`owner_gate`** (D85) | bool · **true** — owner verification, CALL legs only | server | Background filter (D85-S4) | NEW (D85-S2, §3.12.1 ④); **dev keeps `false` in its config from D85-S3 until D85-S4 is merged** (the release default stays ON, §7.3) | additive |
| **`owner_threshold`** (D85) | float · **0.42** · **0.20–0.70** (a floor above the 0.70 ceiling would invert the clamp, N5) | server | Background filter | NEW (D85-S2): the FLOOR under every route's load-time threshold (§3.12.3); never stored in a template | additive |
| **`gate_min_ms`** (D85) | int · **1000** · 300–3000 | server | Background filter (advanced) | NEW (D85-S2): VOICED ms under which BOTH scorers are skipped (fail-open, §3.12.1 ②); replaces v1's `owner_min_ms` | additive |

**Not keys:** K6 (a capability fallback) · `UPLINK_ALLOWANCE_MS`, `KEEPALIVE_HORIZON_MS`, `BUCKET_CAP_MS` (P-6) ·
`VAD_MAX_LAG_MS` · `RECOVERY_TIMEOUT_MS` · `REC_TIMESLICE_MS` · `PREPASS_*` (Speaches-door
constants) · the Silero assets. `/voice/status` `live_call` delivers CLIENT keys only; the R88 reader-parity test gains
`dictation_idle_margin_db` (in SP) and `turn_hold_ms` (in S7a) and proves `onset_ms`, `max_segment_s` and `vad_model` are
never delivered (in S7a). **As built (S7a, session 65):** `_SERVER_ONLY` carries `vad_model` (S6-i) and now the pointer +
transport keys `LiveCfg` inherits — `provider`, `model`, `fallbacks`, `connect_timeout_s`, `timeout_s`, `extra_body` —
because `timeout_s` became load-bearing for the client and must reach it ONLY as `ready.answer_ttl_ms` (§3.5 ⑨);
`onset_ms`/`max_segment_s` join the set at S7b, the slice that adds them (R4-1).

**D85's seven keys (§3.12, D85-S2):** all server-side; **none is delivered to the client** — the R88 reader-parity test proves all
seven are NEVER delivered by `/voice/status`. **NO migration** (additive, `CONFIG_VERSION` stays 5). Gates default ON because they
are fail-open: with no models installed (`voice` extra absent) or no template, nothing changes. **No per-route knobs** (config
bloat; the owner re-enrols a route instead). **Not keys:** `OWNER_MARGIN` 0.12 · the 0.70 ceiling · `NOT_OWNER_RUN` 3 · the 2 s /
1 s window rule · the 4 s sub-window floor · the 20 s enrolment minimum · the 60 s enrolment bounds. A separate tagger minimum
(`speech_min_ms`) is D85-TUNE's call (R2-E): added THEN if warranted — additive, its own row.

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
| T7 | Relay queue drops (call) + the index gap | T1 · `seg` | always / debug | S1; gap S6-ii (✅ as built: T1 + `leg_end` `gap_ms` + one debug `gap {at_ms, ms}` trail line per overflow burst; the `seg` half is S7b's) |
| T8 | `seg {id, start_ms, end_ms, reason, outcome, confirmed_ms, retracted, split, vad_queue_ms, infer_ms, emit_lag_ms}` | relay trail | debug | S7b |
| T9 | `asr {id, door, provider, queue_ms, prepass_ms, asr_ms, chunks, ok}` | relay trail | debug | S9 (clip) · S7b (live) |
| T10 | `prepass {id, verdict, crop_ms, padded}` | relay trail | debug | S9 · S7b |
| T13 | `recover {from_ms, why: degrade / answer_ttl, trigger, attempt, outcome: ok / retry / kept / discarded, elapsed_ms}` | dictation trail | debug | S8 |
| T14 | `gate {id, reason, accept, speech_p, owner_cos, near, voiced_ms, windows, ms, scored}` — the §3.12 stage's verdict per segment, no text | relay trail | debug | D85-S2 |

Retention split (R94 §7.1.7): dictation trails in `$CTRLB_HOME/calls/dictation/` (the D77 rails; the batch envelope names
the mode), each directory keeping `trail_keep`. No transcript text ever reaches the journal.

**D85 (§3.12, D85-S2) beside T14:** T1's leg-end line (always) gains the counts `not_speech · not_owner · unscored`; the trail's
`leg_start` carries `speech_model` / `speaker_model` and the leg's `owner_check`; `ready` carries `owner_check` per leg
(§3.12.5); the clip door's `gate` rides the STT response for the dictation trail. The per-reason counts are telemetry only — a
reject has no text and the trail no labels; acceptance is the labelled replay (§6.3).

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
  - It is appended off the loop in batches via `to_thread`, like the trail — one batch in flight and at most one queued;
    a disk slower than that DEGRADES the capture (one warning, nothing more recorded, `leg_end.capture: "degraded"`),
    never the call (S6-ii wave 1).
  - The WAV header is finalized at leg end. A crash leaves a raw `.part` file, which the corpus tool can still import.
  - Size is about 1.9 MB per recorded minute, times the number of kept trails.
- **A bystander is recorded too** (the car radio, a passenger): consent applies at PROMOTION (§6.3). Unpromoted captures are
  pruned with their trail — and retention runs only when the NEXT debug leg of a new call opens its trail: with `debug`
  turned off, the last kept trails and their audio stay on disk until removed by hand (delete a stem's `.jsonl`, `.wav`
  and `.wav.part` together — a trail deleted alone orphans its audio, which no prune ever reaches; SECURITY_MODEL §2.12).
  **Worst case:** 20 kept 30-min legs × 1.9 MB/min ≈ 1.1 GB per mode per instance.
- **Why it stays after tuning:** it is how a bad car call gets diagnosed from now on. The trail says what was decided;
  the capture is what was heard.
- **SECURITY_MODEL gains §2.12, "captured audio at rest"**, in S6-ii.

### 6.2 The replay tool (`tools/vad_replay.py`, S6-ii; offline, never runtime)

`vad_replay.py <wav…> [--model silero-v6.2|silero-v5.1.2] [--set onset_ms=… act=… silence_ms=…] [--variant m1] [--asr <config.yaml> [--door stt|live]]`

- **It reuses the shipped code.** It imports the SHIPPED modules (the resampler, the `VadParams` policy,
  `VadSegmenter`, `prepass`) and re-implements nothing.
- **It runs them over captured WAVs and prints, per segment:**
  - the edges: start/end ms, reason, max probability;
  - with `--asr`, the transcript, produced through the same pass/chunk path on `parakeet-clip` — since S9 the clip door's
    own helper (`voice_clip.transcribe_wavs`) on a `VoiceClient` built from that config exactly as the app builds it
    (`runtime.build_voice_client`), so the request is the real one (T-5); `--door` picks the chain.
- **It compares.** Two parameter sets print side by side, and the M1 confirmation variant (§3.4) is compared here.
- **The owner judges the output by hand.** A change is adopted on R94 §9's Pareto reading: fewer false segments, no lost
  short answer, no clipped onset.

The hand-authored golden vectors (§3.4) are the unit tests. The tool is the ear test.

### 6.3 The corpus (R9, council 19)

- **Where it lives.** The canonical corpus is **`$CTRLB_HOME/asr-corpus/`**, normally prod's root.
- **How clips get in.** `tools/asr_corpus.py promote <call_id>-<leg> --owner-only --label … [--from <root>]` copies a
  capture from any instance's `calls/` (dev's, for example) into it:
  - `raw/<YYYYmmdd-HHMMSS>-<mode>-<route>-<lang>-<call8>-<leg>.wav` — **amended S6-ii (ruling H5):** the plan's name had
    no call identity, so two calls with the same second, mode, route, language and leg collided; `<call8>` = the call
    id's first 8 hex, the time = the leg's `leg_start` in UTC, and promotion is NO-CLOBBER on top (an existing clip is
    never replaced);
  - `labels/<clip>.json` — the SUPERSET D85-S2 only fills (ruling H9): `{kind: "positive"|"negative", tags, lang,
    route, route_key: null, intervals: []}`; the replay and its pre-pass sweep read `kind`;
  - `manifest.jsonl`.

  Permissions are 0700/0600. The root is `--home` or `CTRLB_HOME`, REQUIRED, and a destination inside a git work tree
  is refused (ruling H10 — `home_path()`'s no-`CTRLB_HOME` fallback is the project root). `promote` prints the consent
  rule below and runs only with `--owner-only` (ruling H11; D85-S2 adds `--broadcast`). Push-to-talk clips (S9, as built):
  under `debug` the clip door captures every upload, so `promote <id>-1` takes them from `calls/clip/` (a dictation's
  whole-clip fallback as `<call_id>-0` from `calls/dictation/`); any other file — a clip exported from the phone, a
  synthesized bake-off clip — goes in with `promote --file PATH --lang xx` (ruling H13), named
  `<mtime>-file-unknown-<lang>-<sha8>-0.wav` (`<sha8>` = the source's sha256 prefix, in the `<call8>` slot).
- **It is never committed to git.** Deletion is `prune --older-than`, or `rm -r` of the directory.
- **Consent:** the owner's own voice only. A clip carrying another person's voice is deleted, never promoted. **Amended by D85
  (F12, 2026-10-06):** one class is admitted — BROADCAST media (TV, radio, music) captured by the owner and labelled `background`
  is admitted as a NEGATIVE for `vad_replay.py --discriminate`; a private third party's conversational speech stays deleted,
  never promoted. Without it the replay tool's negatives are forbidden.
- **The label format (D85-S2):** `labels/<clip>.json` = `{route_key, intervals: [{start_ms, end_ms, label: "owner" |
  "background", source?: "tv" | "radio" | "music" | "other"}]}`. A replayed segment takes the label covering ≥ 80 % of its voiced
  ms; anything else is `mixed` — reported (the owner-over-TV hole lives there), never in the matrix (N7).
- **`tools/vad_replay.py --discriminate`** (D85-S2) runs the SHIPPED §3.12 stage over labelled captures and prints, per route:
  - the confusion matrix (owner accepted / rejected × background accepted / rejected), counting **EVERY background segment** —
    an `unscored` one (under `gate_min_ms`, or with no scorer) counts as ACCEPTED, on its own "unscored background" row (R2-E:
    ISS-63's TV finals at 440/600 ms and ISS-65's music near 1.1–1.4 s fall there);
  - false accepts by length bucket (F5, R2-B: the guard on the two-consecutive rule);
  - tagger hits by length bucket (the MAX walk's leak grows with length);
  - owner loss on short finals;
  - the stage's p50/p95 ms (the 20 s p95 reported before D85 ratifies).
- **D85's acceptance (E4, R2-C) = that matrix, per route, over the owner's LABELLED debug captures** — positives `owner`,
  negatives `background`. **D85-S4 accepts on WIRING + a printed BASELINE matrix** (no numeric gate: the defaults are what
  D85-TUNE tunes). **The numeric gate is D85-TUNE's**, after the tuned replay: **background hits ≥ 95 %, owner loss ≤ 2 % on
  segments ≥ 1 s voiced, with ≥ 100 owner segments per route** (fewer and "≤ 2 %" means nothing); D85-TUNE CLOSES D85. A
  NARROWBAND route that misses 95 % is the §3.12.6 measured limit, recorded per route in the TUNE record — never a slice failure.
  The trails' per-reason counts are telemetry only (R101 could not label the TV finals from them). The music and TV re-runs
  become labelled capture rounds; D85-TUNE = the owner's field rounds (music room, TV room, car; each route) with `debug` ON.
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
| **S9 → clip door on parakeet (dev)** | • the gate-walk test passes<br>• **the pre-pass sweep (§3.4.1 ⑤):** `prepass_act` swept over the corpus positives + the push-to-talk clips on the configured model — zero labelled-speech clips answered `no_speech`, the negatives' hit rate reported (T10)<br>• live-sized p95 < 1 s uncontended and < 2 s contended (requests ≤ 20 s)<br>• RSS a bounded high-water mark ≤ 3 GB per instance, no growth across runs (owner-amended 2026-10-08 from "< 2 GB" on the §6.4.1 reading: 2.2–2.3 GB steady; no unit carries a memory limit)<br>• R10 (a)–(b) hold<br>• **no language crossing:** English and Spanish short answers and car negatives never come back in the other language (T-5)<br>• the owner reads the push-to-talk clips and the replayed reference transcripts by hand and finds them acceptable — **Spanish included** (T-5) |
| **TUNE → the flip (S7b)** | • the golden vectors are green<br>• the owner's hand judgement of the replayed reference set (edges + transcripts, with the chosen `VadParams`) finds: no phantom segments on the negatives, every short answer present, no clipped onset |
| **Release v1.7.12** (R94 §9 field acceptance, on the flipped dev) | • 5 min of no-owner-speech car audio → 0 false turns<br>• 20× each short answer, **English and Spanish** → recall ≥ 95%, no first-phoneme clipping, **no answer transcribed in the other language**<br>• no perceptible added lag<br>• ASR p95 < 1 s<br>• the §3.4 VAD budget met<br>• **a ≥ 10-min 4G dictation with induced stalls → zero stops, the suffix recovered, no duplicated text**<br>• the kill-clip-engine arm (§3.8)<br>• a > 20 s call turn arrives as ONE turn (R20)<br>• a reload mid-dictation recovers (S8b) |

### 6.4.1 S9 bake-off (session 64 lane, relaunched + run in session 65) — the no-owner-audio rows

**Run:** 2026-10-07, 21:05–21:30 CEST, emma, repo `76f5db5`. **Engine:** parakeet.cpp `v0.5.0` = `1bfbebfa`, the SOURCE
build (`GGML_NATIVE=ON`, binary sha256 `68176570…1aa1`), model `tdt-0.6b-v3-f16.gguf` sha256 `8ba47343…bb22`, the two
units at 4 threads each. Box state: governor `powersave`, swap 8/8 GiB full, Speaches, PocketTTS and both ctrl-b
instances up. **Inputs, all synthetic (ruling H11, no owner audio):** English from PocketTTS (`nova`/`fable`/`echo`
in turn); Spanish from Kokoro `ef_dora`/`em_alex` through dev's `/api/voice/tts` with `prefer`, because PocketTTS is
English-only (one PocketTTS-read Spanish clip is kept as a curiosity). Sentences come from a fixed script and are joined
by seeded 0.5–1.5 s silences. The files are 16 kHz mono pcm16, except the 30-min clip and one 5-min clip, which are
Opus webm at 32 kbps (the recorder's bitrate). The noisy variants mix R98's DEMAND `TCAR` in at 0 dB SNR. Every
"door" row is `POST /api/voice/stt` on dev (:5434), which is the real `VoiceClient.transcribe(door="stt")` request
with `language`, `vad_filter` and `hotwords` (accepted, so T-5 holds); `X-Voice-Served-By` read `parakeet-clip` on
every request. Rows marked "direct" post the same fields straight to an engine. Wall time is curl's `time_total`;
`asr` is T9's `asr_ms` from the dev clip trail. Scripts, clips, raw JSONL and the full report are in the session-64
scratch `bakeoff/`.

| Input (s) | Engine · path | p50 / p95 wall (s) | RSS | Text vs script | Notes |
|---|---|---|---|---|---|
| EN 1.8–2.8 (yes/no/okay/3 s) | clip · door ×5 | 0.11–0.19 / 0.11–0.20 | — | exact | asr 86–153 ms |
| EN 8.7 · ES 10.1 | clip · door ×5 | 0.51 / 0.52 · 0.59 / 0.60 | — | exact · exact | |
| EN 16.2 | clip · door ×5 | 0.98 / 1.40 | — | exact | one 1.49 s outlier (app side; asr 868 ms) |
| EN 21.0 | clip · door ×5 | 1.21 / 1.24 | — | exact | asr 1.13 s |
| EN 59.7 · ES 62.2 | clip · door ×5 | 3.55 / 3.64 · 3.75 / 3.77 | — | exact · WER 3.7 % | the ES "errors" are mostly digits (`doce`→`12`), plus `bajar`→`vacar` |
| EN 59.7 + TCAR 0 dB | clip · door ×5 | 3.72 / 3.79 | — | WER 1.9 % (digits only) | |
| EN 299 · ES 300 · EN 299 Opus | clip · door ×5/×5/×2 | 18.0 / 18.1 · 18.2 / 18.3 · 18.4 | clip 2.09 GB after | WER 1.3 % · 3.9 % | real-time factor ≈ 0.06 |
| **EN 1802 Opus (5.9 MB) THROUGH SERVE** (:8443 from emma) | clip · door ×1 | **116.1** | clip 2.15 GB after | WER 1.4 % | decode 2.8 s · pass 5.2 s · 63 chunks, asr 106.7 s (per chunk p50 1.69 s, max 3.15 s) · the decoded bound is 1790 + 60 s, so 30 min is admitted; a 30-min WAV (57.6 MB) would hit the 25 MiB byte cap first |
| live-sized 1.4 / 1.8 / 2.8 / 8.7 / 10.1 / 16.2 / 21.0 | live · direct ×5 | p95 0.11 / 0.12 / 0.18 / 0.49 / 0.57 / 0.89 / **1.20** | live 2.17 GB after | exact | uncontended |
| **CONTENDED** (§6.4): the 30-min clip on the clip unit + PocketTTS synthesizing back to back (8 threads, ~840 % CPU) + live-sized requests back to back on :9010 | live · direct ×29 each | p95 0.50 / 0.64 / 0.86 / **2.26 / 2.23 / 2.51 / 3.85** | live 2.27 · clip 2.19 GB | exact | 30-min clip **278.7 s** (asr 252 s, decode 6.2 s, pass 18.5 s) · PocketTTS p50 1.07 s against 0.86 s idle · no errors, no walks · a saturating load, worse than any real moment |
| two concurrent 60 s door POSTs | clip · door | 6.85 · 7.42 | — | exact | the per-process gate serialises per CHUNK (queue 0–1.66 s per chunk, under `connect_timeout_s` 3 s, so no walk) |
| 60 s door POST ∥ live 21/8.7/2.8 s direct, ×3 | clip + live | clip 3.95 / 4.07 · live 1.41 / 0.61 / 0.20 | — | exact | separate units: no queueing, but a 10–30 % CPU-share slowdown each way |
| **H8:** EN 59.7 / 21.0 / 8.7, interleaved ×5 | SOURCE :9011 vs RELEASE tarball on :9019 (direct) | **source 4.10 / 1.18 / 0.49 · release 6.42 / 2.06 / 0.85** (p50) | release 2.55 GB after | identical text | the source build is 1.57–1.74× faster, so it is **kept** (H8 rule) |
| language: ES 60 s · mixed ES+EN 5 s | clip · door | — | — | Spanish · Spanish (`Tailscale`→`Tilescale`, `dashboard` kept) | no crossing on sentences |
| language: bare ES `Sí.` / `No.` (Kokoro ×2 voices) | clip · door + direct | — | — | **CROSSES:** `Sí.`→"Saying that's a very good thing." · `Sí.` (em_alex)→"Саїра." (Cyrillic) · `No.`→"No it's not a good one." · `Sí.`+TCAR→"So you're not going to be able to do that" | `Vale.` `Claro.` `Sí, claro.` `No, gracias.` are correct; `No lo sé.`→"Non lo sé." · the same weights in ONNX (onnx-asr, Speaches' runtime) give the same output, so this is the model, not the port · whisper-turbo hears "See," / "Nodes" (the synthetic monosyllables are ambiguous to it too, but it does not invent a sentence) |
| noise only, 10 s × 6 (TCAR/DKITCHEN/PCAFETER) | clip · door | 0.04 | — | 5 × `""` (no_speech, no ASR call) · **1 × "Okay."** | TCAR 30–40 s: the pass let 64 ms "voiced" through, and the engine answered with a phantom word |

**RSS:** before the run, live 1.49 / clip 1.70 GB. At the end, live 2.27 / clip 2.55 GB (`MemoryPeak` 2.33 / 2.72
GB). RSS is a high-water mark that follows the longest input the process has seen (live passed 2.1 GB after ≤ 21 s
requests). It does not come back down when idle, and it did not grow across two 30-min runs (2.15 → 2.19 GB). The clip
unit's 2.55 GB came from the H8 rows, which sent 60 s whole files straight to the engine; through the door, the clip
unit never gets more than 30 s at a time. `NRestarts` stayed 0, the engine journals logged nothing besides their listen
lines, and the dev journal showed no warnings.

**Verdicts per criterion:**
- **Latency budget: PARTLY MET.**
  - Uncontended p95 is under 1 s up to about 16 s (0.89 s direct). It is 1.20 s at the 20 s `max_segment_s` ceiling.
  - Contended p95 is under 2 s only up to about 3 s; it is 2.2–3.9 s for 10–21 s. That was under a deliberately
    saturating load (16 busy threads on 8C/16T, `powersave`).
  - Clip-door throughput is fine: 30 min took 116 s through Serve (≈ the 2-min estimate) and 279 s contended (over
    the ≈ 4-min estimate).
- **RAM: PASSES the amended criterion** (owner, 2026-10-08: "if it needs a little more RAM it can get it; 2–3 GB is not too
  much" → ≤ 3 GB bounded, no growth). Steady state through the door is 2.2–2.3 GB per unit. It is a bounded high-water
  mark, not a leak — it failed the original "< 2 GB" letter, which was a plan estimate, never a unit limit.
- **Contention: OK functionally.** Requests serialise per chunk, nothing walks, there are no errors, and the two units
  never queue on each other. The cost is CPU share only.
- **Language: SENTENCES OK; BARE MONOSYLLABLES CROSS.** This is the §10.2 watch item firing on synthetic audio.
  Multi-word Spanish stays Spanish, but a bare `sí`/`no` can come back as an invented English sentence or as Cyrillic.
  It has to be re-run on the owner's own short answers before it is treated as an engine question.
- **H8: keep the source build** (≥ the release on every bin).

**OPEN — rows that need the owner's audio (the S9 gate stays OPEN):** the pre-pass sweep (§3.4.1 ⑤, `prepass_act`
over the corpus positives and the push-to-talk clips) · the hand-read of the push-to-talk clips and the replayed
reference transcripts, Spanish included · the language rows on the owner's own EN/ES short answers and real car
negatives · the car and home rows · the 30-min row from a phone over 4G (only the from-emma leg ran) · the R10 (a)
idle-hour RSS re-check · the optional Vulkan row (not run).

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
| **K6** 16 kHz | the two context sites + the native-rate fallback via the caller's own resume path (council 25) · comment/test updates · optional `fftSize` | 16 kHz path · fallback on a thrown `createMediaStreamSource` · **fallback context reaches running** · frame size | **phone card:** trail rate 16000 · one call + one 5–10 min dictation transcribe normally · chirp lag + latency readout unchanged · level gates self-adjust · **EC-call and EC-media arms** · **one Fennec run** (the fallback) |
| **D9** | reducer awaited set · `liveSocket.ts` (`error.item_id`) · overlay selector (closes LIVE_VOICE_PLAN OPEN-2, T-11) | L5 §1.3's `stop(A)→start(B)→stop(B)→transcript(A)→transcript(B)` keeps the mouth shut until B's final · the id-less belt | — |
| **D8** | `levelGate.ts`, `useLiveCall.ts` | seed tiers · settled overrides up AND down · never learned | a call's first 5 s on a fresh route |
| **D5** (A's tail) — **BUILT 2026-10-06 (session 60), review pending** | `LiveSessionSlots` holder map + supersede · slot acquired after `start` (`LiveRelaySession._admit`; `api/voice.py` keeps the one release) · `client_id` in `sessionStorage` (`liveSocket.liveClientId`, added at the one door) · both hooks (the call's `superseded` terminal; dictation's one-wanted-leg guards) | same-tab supersede incl. after a reload · another client `busy` · `ended{superseded}` · one release per slot · as built: the table primitive (sync · transfer · owner-checked release · cap-2 match-first) · superseded mid-dial (no `ready`) · an already-ending holder just loses the slot · byte-identical busy on the legacy path · malformed id → 1008 · the id in no log/trail line · FE: id stable across opens + a reload, storage/`randomUUID` absent ⇒ today's bytes · `superseded` terminal, no redial, stale leg fenced · `start()` refused + `yieldMic` waits while a leg closes | — (the v1.7.11 prod card's "a re-dial right after a dropped leg is not busy" rides it) |

### 7.2 Session B — engine, capture, the host, hand tuning, THE FLIP, recovery

| Slice | Scope · files | Tests | Accept / field |
|---|---|---|---|
| **S6-i** engine/DSP — **✅ BUILT + REVIEWED + MERGED 2026-10-07 (session 64) `1c63ce7` (Opus CONFIRMED WITH NOTES ∥ Emma CONFIRMED SHIP)** | **Files:**<br>• the `voice` extra<br>• `assets/silero/` — v6.2 + v5.1.2, both SHA-pinned<br>• `voice_vad.py` (the `VadModel`/`VadStream` protocol + `VAD_MODELS` + the `vad_model` key and its registry-invariant test (§3.4.1 ⑤) · the Silero adapter serving v6.2 AND v5.1.2 · `VadParams` in ms + `derive(params, hop)` · the policy · `VadSegmenter` with the residual carry, the 16 kHz cursor → leg-clock mapping and the hop start/end conventions (§3.4.1 ②))<br>• `voice_prepass.py` (the pass + bounded PyAV decode)<br>• `config.py` (the `vad_model` key, §3.4.1 ⑤)<br>• the PyAV resampler wrapper<br>• hand-authored golden vectors (EMA, re-arm, both hovers; both hop conventions; two at a 10 ms hop; one native-rate fallback vector with a dropped-frame gap)<br>• the per-model conformance test (§3.4.1 ⑥)<br>• the `voice` extra wired into `install.sh:116`, `ci.yml:80`, `deploy/bootstrap.py`, `deploy/windows/` (T-12)<br>**No relay or route change.**<br>**As built (session-64 rulings H1–H13):** modules `voice_vad.py` · `voice_audio.py` (the PyAV `PcmResampler`, pcm16↔float32, the ONE `HopBuffer`) · `voice_prepass.py`, all import-safe (the extra is gate-mandatory, an import-blocked boot test pins it); golden vectors are Python literals in `tests/vad_vectors.py`, not JSON (H11); the conformance fixture is the first data file under tests/, `tests/data/silero_test_3s.wav` (upstream's MIT `test.wav`, 0–3 s; H12); `deploy/bootstrap.py` needed no change (it runs `install.sh`); `derive` refuses a cap ≤ `age_bound + cut_span + 1`, which makes "an unconfirmed segment at the cap retracts" true by construction (a tentative onset always hits its age bound first), so the policy carries no cap arm for tentative segments. | • the golden vectors<br>• the wrapper vs a recorded ONNX output (state carried)<br>• ORT options asserted<br>• the ONE alias golden test + chunked == whole<br>• the pass constants<br>• decode fixtures (webm/ogg/mp4/wav) + bounds | — |
| **S6-ii** capture + replay + corpus — **✅ BUILT + REVIEWED + MERGED 2026-10-07 (session 64) `64021d8` (Opus CONFIRMED WITH NOTES ∥ Emma CONFIRMED SHIP)** | • receipt stamping<br>• the 16 kHz resampled copy<br>• the debug-gated capture (§6.1)<br>• `tools/vad_replay.py` (`--model`, §3.4.1 ⑦)<br>• `tools/asr_corpus.py`<br>• SECURITY_MODEL §2.12<br>• a Conf privacy line on `debug`<br>**As built (session-64 rulings H1–H14):** the writer is `CallTrail.open_capture` → `CaptureWriter` (`services/call_trail.py` — the trail's mkdir/0600/warn-once rails; `_prune` takes a pruned trail's `<stem>-*.wav` + `.wav.part`); the hook is `_accept_audio`, the gate EXACTLY `_note`'s (`_trailing`); `.part` = header-first with both sizes all-ones, finalized by patching the 44 bytes + `os.replace` + `fsutil.fsync_dir` (H1); the 16 kHz copy's `PcmResampler` is built ONLY while capturing (H2, identity on 16 kHz); the trail's first lines are flushed at `leg_start` (H3) BEFORE the capture opens (wave 1: the `.jsonl` always precedes the `.part`); a `capture_open {file}` line right behind `leg_start` names the file (`null` on an `O_EXCL` hit, H12 — moved off `leg_start` by that order); `leg_end` carries `capture` (the file · `"degraded"` · `null`) and `capture_ms` = the audio actually WRITTEN, and is written in the shielded teardown after the resampler drain + finalize (wave 1); one capture flush pending at a time, at most one queued batch, past that the capture degrades (wave 1); `_prune` skips a call whose capture writer is still open (the prune guard); the receipt stamp `(leg_index, client_samples)` rides each queue item, `StampedFrame` gets its first producer, T1/`leg_end` gain `gap_ms` (H4); the ONE WAV writer is `core/audio.pcm16_wav_header` (stdlib); `scan`/`prepass` gain `act=` (H7); the replay's baseline is `LiveCfg()` + a tool-local `PRE_S7B` (H6); `.gitignore` gains `/calls/` + `/asr-corpus/`. No new config key. | • capture happens only with `debug`<br>• retention follows the trail<br>• permissions<br>• the header is finalized, and a `.part` is importable<br>• replay prints edges for a fixture WAV<br>(as built: `tests/test_voice_capture_s6ii.py`) | **Step 0: Conf › Live call › Call debug readout ON on dev** (✅ already ON on dev since 2026-10-07 — prod is OFF). Then the owner's first capture rounds build the reference set (car + home, calls + dictations, both languages). |
| **S9** the host + the clip door — **✅ code BUILT + REVIEWED + MERGED `76f5db5`, engines INSTALLED + runbook `5ce0536`, DEV CONFIG MOVED (session 64); the bake-off + the S9 gate = OPEN** | • clone parakeet.cpp next to `~/github/speaches`<br>• machine-wide units + the runbook section "The ASR engines"<br>• `VoiceClient.transcribe(door=…)`<br>• the clip door = decode + pass + per-chunk `parakeet-clip`; undecodable → 422<br>• `max_concurrent_requests: 1`<br>• the dev config: stt → `[parakeet-clip, vault-speaches]`, live PINNED to `emma-speaches`<br>• T9/T10 on the clip door<br>• the bake-off through the real `VoiceClient` request (the `vad_filter` extra accepted or dropped, T-5), the 30-min row timed end to end through Serve | • the gate-walk test<br>• no speech → "" with no ASR call<br>• > 30 s splits in order<br>• never on the event loop<br>• the bake-off table | Push-to-talk clips and the whole-clip dictation fallback run on parakeet; the owner judges them → the S9 gate. |
| ↳ *S9 as built (session-64 rulings H1–H11; the CODE lane — the engines + runbook are the OPS lane's, the dev config move + the bake-off the main seat's)* | **`door=`** (H3): `VoiceClient.transcribe(..., door="stt"\|"live")` picks `(chain, policy)` — `live` = `voice.live` under `LivePolicy`, `language` only, no extras until S7b; the D40 gate rule reads the door's own chain; `VoiceReply` gains `queue_ms`/`asr_ms` (summed over every hop tried). **The door:** `services/voice_clip.py` — `transcribe_clip` = `decode_to_pcm16k` (`dictation_max_s + 60` s decoded · 60 s wall, council 15) → `prepass` + the chunk WAVs in ONE `to_thread` → no speech ⇒ `""` with no ASR call → else `transcribe_wavs` (THE chunk → WAV → transcribe → join helper, also `vad_replay.py --asr`'s, whose copy is deleted); `UndecodableAudio` ⇒ 422 · `DecodeAborted` decoded ⇒ 413 / wall ⇒ 422 (H4); `X-Voice-Served-By` = distinct providers in serve order + `X-Voice-Degraded: 1` (the TTS convention) when a chunk walked, absent on no speech (H5). `PrepassResult` widened (`crop`, `padded`, `bounds`). **Trail + capture** (H6/H7): `LiveMode` gains `clip` (store-only — the wire's `LegMode` stays `call`/`dictation`); under `voice.live.debug` + a store every upload gets a server-minted `calls/clip/<id>.jsonl` (leg 1) — or, with a validated `?call_id=` of a dictation, THAT dictation's trail as leg 0 (its streaming leg owns `<id>-1.wav`) — with `prepass` (T10 + voiced ms, chunk bounds, decode/pass ms) · `capture_open` · `asr` (T9 + per-chunk latency; `ok:false` + `failed_chunk` on a 502) lines, never text, and the decoded 16 kHz PCM through `open_capture` (`promote <id>-1` works; `find_capture` walks every store mode). `asr_corpus.py promote --file PATH --lang xx` (H13). The S6-i H1 status-bit degrade lands here: without the `voice` extra STT reports unconfigured. `vad_replay.py --asr CONFIG [--door]` builds its client through `runtime.build_voice_client` (T-5's real request). The AST ratchet `test_arch_invariants_sys16.py` gains the ear's CPU-bound set. **The multipart CSRF gate** (the S9 security ruling, SECURITY_MODEL §2.7): `/stt` REQUIRES `X-Requested-With: ctrl-b` (`api/csrf.py`, a route dependency — 403 before any decode/trail/capture); the FE sends every form through `api/client.ts::postForm`. **Wave 1 (the review round):** the route takes `?from_ms=` (≥ 0, ≤ the decoded bound in ms; T10 records it) · a `call_id` joins ONLY a dictation trail that already exists (else a minted `clip` trail) · the D63 `prefer` pin — each chunk asks first for the hop that served the previous one, so a busy/hung primary costs the clip one `timeout_s`, not one per chunk (the clip may stay on a whisper fallback: accepted) · the decoded array is released before the ASR loop. **Known consequence (recorded, no code):** plain push-to-talk has no client duration cap (only the streaming session stops at `dictation_max_s`), so the council-15 bound `dictation_max_s + 60` also caps push-to-talk — lowering `dictation_max_s` makes a longer push-to-talk a 413 that names the bound. **Deferred to S8:** the FE passing the dictation `call_id` on the fallback upload (not a one-liner: the id lives in the leg's session, the clip travels by value). | `test_voice_clip_s9.py` (the gate walk on both doors + through the route · no speech · the in-order split · the three statuses · off-loop · the trail/capture/promote · the dictation routing · the shared helper · `promote --file` · the status degrade) · `test_voice_6a.py`'s `b"abc"` clips → real audio | the bake-off + the owner's rounds (§6.4) |
| **TUNE** (owner + main seat, no code slice) | 0. `debug` ON on dev (M-2 — ✅ ON since 2026-10-07)<br>1. more capture rounds<br>2. `promote`<br>3. `vad_replay.py` sweeps with `--asr` on `parakeet-clip`<br>4. the owner's hand judgement<br>5. `VadParams` defaults settled (a config edit or a one-line default change)<br>6. the pre-pass sweep re-checked (it settles the entry's `prepass_act`; re-run on any `vad_model` swap, §3.4.1 ⑤) | — | → the TUNE → flip gate (§6.4) |
| **S7a — client half** (N-3; ships + is reviewed first) — **✅ BUILT (session 65, 2026-10-07; review pending).** *As built (the ten H-rulings, session 65):* the PARSER is S7b's contract — `LiveDown` in `lib/liveSocket.ts` gains `ready{clock, answer_ttl_ms}` (both or neither; half a pair ⇒ no capability + an anomaly, H5/H9), `state:"flushed"` and the final's bounds/`reason`/`outcome`, validated ONCE in `openLiveSocket` behind a per-leg latch (`audio_end_ms` non-decreasing — the pre-roll crosses; the 10 valid pairs), an invalid final DELIVERED marked `anomaly` + `anomalies()` (H1) · the call: the per-leg `answerTtlMs` on `CallState`, the cap join = ONE `capJoin` flag on the existing hold (a TAKEN cap final opens it at any knob, any cap final continues it, any other final ends it; the pause never releases it, the joined id's TTL does; mute clears it and keeps the words), the TTL = one wiring timer on the `awaiting[0]` edge ⇒ `answerExpired` (a quiet `answerLate` note, no cue — H8) + a bounded expired-id memory stamping `late` (R3-2), an `asr_error`/anomalous final settles silently with no text (H6/H1), `ear_failed` note-only in `CONNECTION_NOTES` (H7), `flushed` a no-op, `turnWhy` gains `join`/`ttl` · dictation: `StreamSession.ttlMs` + `capText` — the join appends ONCE; EVERY release path appends the held text BEFORE the either/or (H2); `flushed` WAKES the release, bounded by `answer_ttl_ms` (H3; the "no completeness marker" theorem rewritten as the two-leg truth) · the R88 `_SERVER_ONLY` set gains the inherited server keys (§4) · no config key, no Conf row. — **▲ the hold's CORE (`turn_hold_ms`, the state machine, the knob, Conf row, trail) was BUILT in session A on 2026-10-02 (session 58, ISS-55; §3.5 ⑤ amendment); S7a now ADDS only what the new wire brings (`max_segment` join, `flush`/`asr_error` release reasons, the awaited-id TTL) on top of it; the row's remaining text is the session-B wording — where it says "mute discards" or "released on the last absorbed final" the §3.5 ⑤ AMENDMENT wins** | **INERT until `ready{clock:"leg"}`:** `config.py` owns `turn_hold_ms` here (EM-2) · `LiveDown` fields + validation (bounds, reason incl. `flush`, `flushed`, `answer_ttl_ms`), the awaited-id TTL, **`turn_hold_ms`** + the `max_segment` join + the N-2 release rule (call pending + dictation append), the R88 parity (`turn_hold_ms` in; no server-only key is ever delivered — asserted per key as each lands, `onset_ms`/`max_segment_s` at S7b; R4-1), Conf rows + round-trip test, `e2e/liveCall.spec.ts` fixture (T-8), **an `ear_failed` arm in the call's `serverError` — note-only, like `busy` (R2-1)**, the `outcome` field + (reason, outcome) pair validation incl. `short`/`skipped` — tested against a scripted relay | without the capability everything is today's behaviour · the TTL expiry drops an id + logs · **each N-2 release path** (the last absorbed non-`max_segment` final of every other reason incl. a gate-dropped one, `flushed`, socket loss submits, mute discards, hold expiry — EM-1/R3-1) · a 25 s turn submits ONE turn · the dictation join appends once · **`stop(A)→start(B)→final(A)→stop(B)→final(B)` ⇒ ONE turn (E-N3)** · **`ear_failed` + 1011 ⇒ a reconnect, not a terminal (R2-1)** · a three-segment capped turn ⇒ ONE turn (EM-1) · several absorbed segments release on the LAST one's final (R3-1) · a late final with text is taken, an empty one dropped (R3-2) · invalid (reason, outcome) pairs rejected (EL-1) | — |
| **S7b — THE FLIP** | the `vad` executor + batched drain + the `VAD_MAX_LAG_MS` rule, lossless dictation enqueue, typed `ear_failed` (a call → the reconnect ladder, N-6); the relay VAD produces the events (tentative + bounds + re-arm, EMA, `seg_<n>`, finals with bounds + reason, `flushed`, `ready{clock, answer_ttl_ms}`, dictation onset 0, `max_segment`); ASR = `transcribe(door="live")` on `parakeet-live` inside the ONE per-segment `timeout_s` deadline (N-1), the pass authoritative with the tail pad; T8/T9/T10 + the T1 aggregates; **the dev config move** (live → `parakeet-live` + `[parakeet-clip]`, Kokoro out of TTS — no LIVE or TTS route references `emma-speaches`/Kokoro after the flip; the pre-existing `vault-speaches` clip fallback and the `emma-speaches` provider definition (rollback) remain) · `voice_live.py`, `adapters/voice.py`, `core/provider_registry.py` (`LivePolicy` + `extra_body`, collapse log, primary warning), `config.py` (server-side VAD/deadline keys only: `onset_ms`, `max_segment_s`, `timeout_s`, `prefix_padding_ms` 500, the `vad_threshold` bounds 0.1–0.95 per §3.4.1 ④ — `ConfTab.tsx`'s slider bounds + `config.example.yaml`'s comment follow) · `_LegStats` + `model · hop_ms · act` on T1 | lossless dictation enqueue under a 10 s burst (Q3 ②) · a worker exception and a lagging worker ⇒ `ear_failed` + T1 (a call reconnects) · alternation · FIFO · stops not held · one answer per stop incl. 5xx + timeout · **a slow primary + fallback walk answers `asr_error` at `timeout_s`, never later** · queued-at-that-moment segments after a timeout answer `asr_error` · flush with a tentative onset (`reason: flush`) · split zero pre-roll + tail pad · **the Q1 flicker end-to-end: no mouth opening between halves** · the leg survives an engine death | car + home calls (no phantom turns, short answers kept, no clipped word, latency not worse) + a pause-heavy dictation; the VAD budget + event-loop lag read on the contended box |
| **Field rounds** (owner) | car + home calls and dictations on the flipped dev, `debug` ON (captures keep feeding the corpus), English and Spanish | — | no phantom turns, short answers kept, no clipped word, latency not worse; dev rollback = re-point the config + revert S7b |
| **S8** recording outlives its leg | `useDictation.ts` (degrade triggers incl. the first `asr_error`, the frozen boundary, `streamRef` kept, clocks kept, recorder↔leg mapping, the frame-timestamp ring + `from_ms`, the clip re-upload, retry once, `RECOVERY_TIMEOUT_MS`, Retry/Discard, append/auto-send once, the capability gate, R70 ③ reversed) · `api/voice.py` (`from_ms`) · T13 | **STOP-5:** the socket dies after the first final → the recording continues → the suffix recovers, no duplicated text · **the boundary advances only on the matching successful final** · a mid-leg `asr_error` degrades · **Tier-0 cannot end a dead-leg recording** · tail-wait timeout ⇒ recovery · retry then Retry/Discard · **no capability → no recovery** · no_speech × {endpoint, max_segment, flush} boundary tests (E-N1) · a delayed final past the ordinary horizon still maps (E-N4) · `max_segment(ok) → endpoint(asr_error)` recovers the text exactly once (EH-1) · both cut paths (`endpoint` − silence/2, `flush` − 0) · **ONE scripted-relay e2e** (`routeWebSocket`: `ready{clock}`, a final with bounds, a close ⇒ the release POSTs the clip with `from_ms`, T-8) | the ≥ 10-min 4G dictation with induced stalls; the kill-clip-engine arm (fallbacks off); **the real recorder↔leg mapping error measured — acceptance ≤ ±350 ms** (debug capture × clip cross-correlation, R2-2, EL-2) |
| **S8b** reload survival (R22) | `useDictation.ts` (`rec.start(REC_TIMESLICE_MS)`, the chunk append, `from_ms` persisted as finals land, delete on completion/discard) · a small IndexedDB store module (one record, try/catch'd) · the load-time "Recover the interrupted dictation" affordance + Discard · the marker fallback — reuses the §3.8 clip door + failure contract, no new upload path or decoder | chunk append · the concatenation decodes (header in the first chunk) through the clip door's PyAV path · the recovery offer after a simulated reload · delete on completion · another tab's fresh record left alone · IndexedDB unavailable / quota ⇒ memory-only + marker | a reload mid-dictation on the phone recovers the captured part |
| **S10** code off Speaches | the §3.11 deletions (the gap cut is dead from the flip) · `dictation_max_s` 1800 / `max_session_s` 2100 · **the pre-tag config report** (T-7) · docs: LIVE_VOICE_PLAN (status, §0 seams, §2 pointer + Smart Turn's changed trigger, §4.1/§5.1, §5.2), SECURITY_MODEL §2.10 + §2.1 (**the engines' and Speaches' 0.0.0.0 binds under the LAN-trust posture**, T-6 as ruled) + §3 + §6, CLAUDE.md's LIVE_VOICE_PLAN row, AGENTS.md, QUALITY.md counts. **No unit is stopped** (R18) | the full gate; a fake batch engine | — |

**Deferred (not Phase 26):** S6b (R7) · NEW-engine ASR fallbacks (R4) · a server energy gate (`quiet`) · client accrual on
the leg clock (R94 §7.3 (i)) — **when it lands, delete the tentative start and its retraction** (R97 §2.2) · future VAD-model
A/Bs through `vad_replay.py --model` (FireRed-stream, TEN — R98 §5) · streaming ASR / EOU · **Smart Turn v3** (relay-owned audio makes it possible; LIVE_VOICE_PLAN §2.1's shelved
trigger changes) · a shorter hop-1 read timeout so a HUNG primary still walks to the fallback (R2-3) · dictation reconnect-and-continue · an Opus/WebCodecs uplink (R96 §1) · R94 §8's dropped items: an NS/AGC
A/B (after T5 exists — **ISS-58 is the field case; the A/B rides the phone card, 2026-10-06**), a high-pass (measure band energy on the corpus first), RMS DC offset (diagnostic only); EMA smoothing is
now ADOPTED (P-5b). **Hard rules that stand:** no lexical filters, no logprob gate, no threshold raise to 0.9, no
absolute-dBFS VAD.

### 7.3 The D85 wave — after session B (v1.7.13)

The §3.12 discriminator (R26, D85), labelled **D85-S1 … D85-S4 + D85-TUNE** everywhere (N12 — LIVE_VOICE_PLAN owns an S11).
After S7b + S9 (the pass must exist); **v1.7.13 = this wave**, after v1.7.12 = session B. **Each slice = the Opus ∥ Emma round.**

| Slice | Scope · files | Tests | Accept / field |
|---|---|---|---|
| **D85-S1** the route key (ISS-64) | `voiceDeviceKey` grammar (`store/voiceLevels.ts`) + the purge/borrow predicate · the row token on the readback (`pcmCapture.ts`: `syntheticRoutes(listAudioInputs())`; the desktop `groupId` resolve) · the trail's `voiceKey` + the `capture` line's route list and the requested candidate (field record only) · `route_key` in `start` (`liveSocket.ts`) | **the three paths per route (R2-A)** — CALL: an explicit pick of a synthetic row ⇒ its token · a readback deviceId equal to a row's id ⇒ the same token · the unsteered default ⇒ the Bluetooth-first inference; MEDIA: a steer rung ⇒ its READBACK's token when the readback names a row, else undetermined (the `null` path; never `bluetooth` while the ladder avoids it) · an explicit pick ⇒ its token · the plain default (no Bluetooth row) ⇒ wired else builtin · pick, steer and default of ONE row ⇒ ONE key · "USB audio" ⇒ `wired`, earpiece / speakerphone ⇒ `builtin` · desktop: `default` resolved by `groupId` to the real deviceId, unresolvable ⇒ `default` · labels never in a key · borrow tiers unchanged under the suffix · a legacy `Default\|ec=all` entry purged on the first write and never borrowed · no fold | **phone card, FOUR arms FIRST (council №5, §3.12.4):** call default · call pick · media with BT (steered) · media without BT — the `capture` line logs the REQUESTED candidate (id + row label + the request kind), `fellBack`, the readback `deviceId` + `track.label` and the route list; if explicit requests read back `default`, rule (2) is RE-RULED before D85-S2 (the named exit: an `exact` proof rung, R74 §2.2 (b)) · the first trail's route list shows Chrome's pick; the phone mic and the BT headset learn separate levels |
| **D85-S2** the stage | **Docs first (the S5 ratify precedent):** DECISIONS D85 · §3.12 + the §4 rows + §5's T14 + the §6.3 amendment · TODO rows — *✏️ folded 2026-10-06 (session 61), ahead of the build*. **Code:** `voice_tagger.py` · `voice_speaker.py` (sherpa-onnx adapters) · the pass → `Verdict` (voiced span, `gate_min_ms`, the window rule, whole-span-first + two-consecutive, the empty-final reject with `gate` incl. `near`) · the `voice` extra + install/CI/bootstrap/windows (T-12) · `config.py` (the seven keys) · `route_key` in `_parse_start` (lenient) + `owner_check` on `ready` · T14 + the T1 counts · `vad_replay --discriminate` + the label format | golden vectors per scorer vs sherpa-onnx (± ε) · `num_threads = 1` asserted · registry invariants · fail-open per step · invalid / mismatched / unreadable template ⇒ `unscored`, one warning, never `asr_error` · malformed key ⇒ `unscored`, no close · voiced-only scoring · `gate_min_ms` skips both · two-consecutive vs one lucky window · `gate.near` at `threshold − 0.10` · dictation + clip door never run SV · a reject = an empty final with `gate`, in STOP order · no text in the journal · R88 parity: the seven keys never delivered · **the import-order test: sherpa-onnx's runtime and `onnxruntime` load in one process, both orders (N8)** | `--discriminate` matrix printed on the first labelled captures (every background segment counted, unscored = accepted on its own row; false accepts + tagger hits by length bucket — R2-B, R2-E) · **the stage's measured p95 at 20 s reported before D85 ratifies (R2-B)** · **the tagger's operating point re-measured on the voiced-span input — `speech_act` set from it, PROVISIONAL until D85-TUNE (N3)** · R101's CAM++ genuine/impostor numbers cross-checked on the sherpa path (N4) |
| **D85-S3** enrolment | `PUT` / `DELETE /api/voice/enroll/{key_hash}` + `GET` · the template store · Conf "Your voice" + the capture-on-route flow · **SECURITY_MODEL §2.13** (a biometric identifier, never audio · excluded from `install.sh`'s backup set and the Phase 23 S9 export route · `DELETE` the only removal · no route returns the vector · E1 client-enforced under the UX-filter posture — N9, N10) · enrolment windows 2 s at a 1 s step (R2-G) | bounded body · 422 hash mismatch / bad key · ≥ 20 s voiced · 2 s / 1 s-step windows, leave-one-out p10 over them · no threshold stored · 0600 / 0700 · replace · metadata-only GET · the PUT in the no-POST/no-multipart invariant (the `test_media_write_d65.py:684` / `test_attachments_d68.py:1454` siblings + `test_no_cors_middleware_is_mounted_anywhere`) · FE: abort on `fellBack` · abort on a recomputed-key mismatch, nothing uploaded · the floor-binds readout · Conf round-trip · **the §2.13 source scan: no module except the template store reads `voice/owner` (R2-F)** | enrol each route on dev · **dev keeps `owner_gate: false` in its config until D85-S4 is merged** (between S3 and S4 there is no near-miss note — F7's silent dead ear; the RELEASE default stays ON) (R2-C) |
| **D85-S4** the client half | `accept` / `gate` on the final + `owner_check` on `ready` (optional) · the learner rule · the near-miss `not_owner` note + the 3-near-in-a-row diagnosis, in the NOTE slot (R2-D) · readout counts · Conf "Background filter" rows | both wire directions · learner only from `owner` when the bit is true, today's rule when false/absent · a reject settles the id, releases the mouth and a due hold, never restarts it · `NOT_OWNER_RUN` counts NEAR misses only; three FAR rejects ⇒ no note; the heard line untouched by any reject (R2-D) · dev's `owner_gate` back to the default ON at merge · Conf round-trips per row · the `e2e/liveCall.spec.ts` `/voice/status` fixture (T-8) in step (no new client key; the scripted relay's `ready` gains `owner_check`) · **review brief line (N11): with `owner_check` true, V adapts only from finals ≥ `gate_min_ms` voiced — intended** | **WIRING + a printed BASELINE matrix** per route from the labelled music-room and TV-room capture rounds — no numeric gate (R2-C) |
| **D85-TUNE** (owner + main seat) — **closes D85** | the floor, `speech_act`, `gate_min_ms` from the labelled rounds (music room, TV room, car; each route); whether a separate `speech_min_ms` is warranted (added then, additive — R2-E); the narrowband leak rate recorded per route | the tuned replay | **the numeric gate (R2-C): background hits ≥ 95 %, owner loss ≤ 2 % on segments ≥ 1 s voiced, ≥ 100 owner segments per route**; a narrowband route that misses 95 % = the §3.12.6 limit, recorded per route, never a failure · the owner: "usable with the TV on" |

---

## 8. Release and rollback — two releases (R1)

### 8.1 What each release carries

#### 8.1.1 v1.7.11 = the six polish fixes + session A — **✅ RELEASED 2026-10-07 10:40Z @ `bad0c99` (session 63): CI `37606193644` + release gate `37607523443` green · `update.sh v1.7.11` exit 0 · health 1.7.11 · DB snapshot `~/.ctrl-b/backups/ctrlb-20261007-124010.db.gz` · config 5, no migration · rollback = `update.sh v1.7.10`. The gate was the owner's dictation check (§7.1), passed the same morning (trail `~/.ctrl-b-dev/calls/dictation/bec301ce-….jsonl`: 419.6 s, 57 finals, 0 drops, three pauses ≥ 21 s).**

The session-52 polish (five fixes) + polish #6 `e249f12` + the R94–R97 and plan docs + session A (S1, S2, S3, SP, K6, D9, D8,
D5). **Speaches is still the ear** — the relay still dials its realtime WebSocket. **Config migration: NONE** (session A's
keys are additive or unstored-default changes, §4; SP's interim `dictation_max_s` 1790 / `max_session_s` 1800). **DB: none.**
No new dependency (the `voice` extra arrives in B). It ships the transport fixes that stop the 2026-09-28 dictation deaths
on prod while B is tuned.

#### 8.1.2 v1.7.12 = session B

S6-i … S10: the engine, capture, the clip door on parakeet, S7a/S7b the flip, S8/S8b recovery, S10 (caps 1800 / 2100).
**Config migration: NONE** in code (§4); the flip's ONE config move is an explicit ops step at release (§8.2.2). **DB: none.**
`install.sh` installs the `voice` extra; the engines are already running machine-wide since S9 (R19).

#### 8.1.3 v1.7.13 = the D85 wave (§7.3, after v1.7.12)

D85-S1 … D85-S4 (the route key, the §3.12 stage, enrolment, the client half); D85-TUNE closes D85 on the labelled rounds. **Config
migration: NONE** — the seven keys are additive (`extra="allow"`), shape stays 5 (§4). **DB: none.** The `voice` extra gains
`sherpa-onnx` (exact pin) and the SHA-pinned weights land under `assets/ced/` + `assets/campplus/` (§3.12.2).

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
  relay ignores an unknown `client_id`, and D9 already speaks Speaches' ids. **One config check first (SP):** if Conf ever
  SAVED `voice.live.dictation_idle_s` as 0 or above 300, clear it (or set it inside 3–300) before rolling back — v1.7.10's
  bounds are 3–300 and it would refuse the config at boot; the new `dictation_idle_margin_db` key is simply ignored there
  (`LiveCfg` is `extra="allow"`).
- **Off v1.7.12 → v1.7.11 — a config re-point first.** v1.7.11's relay dials Speaches' REALTIME WebSocket, which
  parakeet-server lacks: ⓪ `systemctl --user start speaches` if the owner has stopped it, then wait for its `/health` (N-7)
  → ① stop `ctrl-b-dashboard` → ② restore `config.yaml.<UTCstamp>.pre-v1.7.12` (re-points every chain at the still-running
  Speaches) → ③ `update.sh v1.7.11` (or §Rollback's manual sequence) → ④ verify health + a call. The engines stay up (other
  consumers). A stale v1.7.12 PWA against the rolled-back relay sees no `ready.clock` and keeps today's behaviour (§3.2).
- **Off v1.7.13 → v1.7.12 — by tag.** `voice/owner/` is ignored by older builds; the keys are additive (`extra="allow"`); a new
  PWA on an old relay is today's behaviour (§3.12.5, E2). The template survives an uninstall of the `voice` extra (metadata only);
  `DELETE` removes it.

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

**Council №2 — D85 (2026-10-06, session 61; the §3.12 amendment, R26).** Blind Opus 5.5 ∥ blind Emma (Sol) on the design only;
rulings reconciled by the main seat in `RULINGS-D85.md` (session-61 scratch), every one folded into §3.12 / §4 / §5 / §6.3 / §7.3 /
§8 and SECURITY_MODEL §2.13. **Round 1 (v1):** Opus BUILD WITH CHANGES (3 HIGH · 9 MED · 5 LOW) ∥ Emma BUILD WITH CHANGES
(2 HIGH · 10 MED · 2 LOW), converging on both HIGHs (the reject must be an ordinary empty final — F1; the key still conflated the
phone mic and the headset — F2) → all ruled: F1–F12 · L1–L5 · E1 · E2 · E4 ACCEPTED, E3 MOOT after F9; then the twelve fold notes
N1–N12 ruled (v2.1). Kept as sound by both: in-process scoring over parakeet-server's `--sound-model`; the order VAD → tagger →
owner → ASR; `to_thread`; the D8 borrow tiers under the new suffix; no migration. **Round 2 (v2.1):** Opus CONFIRMED BUILD WITH
NOTES ∥ Emma NOT CONFIRMED ×3 (MED: the media-route identity · the two-consecutive rule's claim + cost · the ladder's circular
gate) → R2-A…R2-H ruled and folded (v2.2). **Round 3 (v2.2):** Opus CONFIRMED BUILD WITH NOTES (P1 the readback outranks the
requested candidate · P2 no `unknown` sentinel — the existing `null` path · N-b a FAR reject resets `NOT_OWNER_RUN`) → folded
(v2.3); Emma 3/3 round-2 MEDs RESOLVED, 2 new (new-1 the unnamed route's placement · new-2 the near-miss run's reset) → folded.
**Round 4 (Emma, v2.3):** new-1 · new-2 RESOLVED; new-3 MED (a successful `ideal` request is not evidence of which row opened)
ACCEPTED → v2.4 (the opened-candidate fallback DELETED; a `default`/`""` readback after an explicit request = the unnamed path).
**Round 5 (micro-confirms on v2.4 §5):** Opus CONFIRMED WITH NOTES — the readback echo is UNVERIFIED → v2.5 (D85-S1's four-arm
card first; the `exact` proof rung as the named exit) ∥ Emma CONFIRMED BUILD WITH NOTES (the same unverified echo; her note also
asks the `capture` line for the request kind, `fellBack`, `track.label` — RULED ACCEPTED by the main seat the same evening — debug-only trail fields, folded into §3.12.4 and the D85-S1 row). **COUNCIL CLOSED 2026-10-06.**.
Precedence: the owner's rulings > the council's rulings > the design text.

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
  [R98](./research/R98-vad-model-landscape.md) §0–§6, §8–§10 (the §3.4.1 amendment; MEASURED on emma 2026-09-30) ·
  [R101](./research/R101-speech-vs-background-discrimination.md) (the §3.12 amendment, D85; MEASURED on emma 2026-10-06).
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
