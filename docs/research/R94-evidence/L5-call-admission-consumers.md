# Lane 5: the live-call client and relay admission layer, audited against an owned-VAD relay (R94 §6)

READ-ONLY. Repo at `778b960` (plus the untracked R94 files). Paths are relative to `/home/emma/github/ctrl-b`.
Abbreviations: **LC** = `frontend/src/hooks/useLiveCall.ts`, **VL** = `backend/app/services/voice_live.py`, **DI** = `frontend/src/hooks/useDictation.ts`, **LS** = `frontend/src/lib/liveSocket.ts`, **LG** = `frontend/src/lib/levelGate.ts`, **CFG** = `backend/app/config.py`.

## 0. Verdict on R94 §6.2's claim ("useLiveCall, useDictation, the level gate, echo/tail logic and the segment ledger are untouched")

The claim is **true for the wire shape. It is not true for the timing and ordering guarantees that Speaches provides implicitly.** The client reads none of Speaches' audio-clock fields. It does rely on five behavioural properties, and an owned-VAD relay must reproduce each one or adapt a consumer:

1. **Early `speech_started`.** It fires about one frame after the onset, because Speaches has `min_speech_duration_ms=0`. The client accrues segment energy, starts the noise-verdict timer and gates the mouth from the start's arrival, not from its audio time (§1.2, §1.4). Onset confirmation of 150–250 ms shifts all three later.
2. **Serialised transcription.** Speaches awaits `commit_and_transcribe` inline, so `transcript(A)` always lands before `speech_stopped(B)`. `waitingFinal` is a single bit that any final clears (LC:1014/1017/1024/1044/1053). Async batch ASR breaks this (§1.3).
3. **Transcripts in segment order.** Dictation appends to the draft in arrival order (DI:979-991), and the call's pending queue joins in arrival order (LC:1050-1056).
4. **Every endpoint gets exactly one answer:** a final, possibly empty, or `error{upstream_error}` (LC:1321-1330, R86 LC-2).
5. **A flush endpoints whatever the ear has heard.** The dictation tail wait of 2000 ms is sized to Speaches' measured 530–830 ms from release to final (CFG:966-971).

The **Speaches audio clock has no client consumer.** `audio_start_ms`, `audio_end_ms`, `reason` and `gap_ms` are forwarded by VL but LS does not parse them (LS:21-30, the comment says "those are the trail's"). Their only reader is the relay's own gap-cut veto (VL:173-182, 190-204). An owned VAD may redefine them freely.

---

## 1. `useLiveCall.ts`: every consumer of the ear's events

### 1.1 Wire intake (the socket `onFrame`, LC:2433-2500)
- **`speech_started` (LC:2440-2471).** Sends `speechStart{itemId}`. Then, only if the reducer accepted it (`!was && userSpeechActive`), both knobs are > 0, and the ledger holds this segment as `meter.open`, it arms **one** `noiseTimer = setTimeout(noise_verdict_ms)`. When the timer fires it re-checks the leg, `m.open === seg` and `userSpeechActive`, then sends `segmentNoise` if `tooQuiet({energyMs: seg.accruedMs, minFinalMs})`.
- **`speech_stopped` (LC:2472-2474).** Sends `speechStop{itemId}`.
- **`transcript` (LC:2475-2496).** Frames with `!final` are ignored. The handler looks up the key `${leg}:${item_id}` (LC:1463-1467), reads `energyMs = segmentAccrual(...)` (LC:1543), and decides `inWindow = performance.now() <= echoUntil`. Inside the window it computes `echo = echoOf(text)` (LC:2392-2402). It then sends `final{text,itemId,energyMs,minFinalMs,echo?,echoMin,inEchoWindow?}`.
- **`error` (LC:2497).** Becomes `serverError{code,message}`.
- **`state` (LC:2435-2439).** `ready`, `degraded` and `ended` become reducer signals.
- **Fields read:** `type`, `item_id` (a non-empty string, else absent, LS:34-36), `text` and `final`. Nothing else.

### 1.2 The segment ledger (D80 ③): `EarMeter` (LC:1408-1461) and `meterEdge` (LC:1572-1633)
- `segments: Map<"${leg}:${item_id}", Segment>` is capped at `SEGMENT_CAP=16` (LC:1408), evicting the oldest. `open` is the one segment frames accrue to.
- **Open (LC:1581-1590).** A segment opens only on the accepted start transition (`next.userSpeechActive && !prev.userSpeechActive`). A start with no id opens nothing, and its final is then unmeasured (fail-open).
- **Freeze (LC:1592-1598).** Its own `speechStop` sets `m.open=null`. Frames after the stop belong to no segment.
- **Consume (LC:1600-1613).** Its own final deletes it and returns the utterance to the voice learner, but only if the final was taken.
- **Clear all (LC:1614-1631).** `setMuted`, `ready`, `socketLost`, and an accepted `routeChange`.
- **Accrual (`meterFrame`, LC:1476-1501).** For every uplinked frame while `open` is set: `samples.push(db)`, and if `db >= floor` then `accruedMs += frameMs`.
- **Timing assumption.** The accrual window is **[client arrival of `speech_started`, client arrival of `speech_stopped`]** on the client's own frame stream. It is not the segment's audio span. The window lags the audio by the ear's detection latency plus the network RTT. It excludes the pre-roll, and it includes the trailing `silence_ms`, which is normally below the floor.
- **Id assumptions:**
  - ids are unique within a leg; a reused key re-inserts (LC:1535);
  - the namespace is per leg, since a reconnect is a fresh session (LC:1463-1467);
  - starts and stops strictly alternate per id, because a second start while one is open does not open a segment (the `!prev.userSpeechActive` guard);
  - the id format is unconstrained, but it must be a non-empty string.
- **Overlap assumption.** `start(B)` before `transcript(A)` is expected (LC:1434-1438, the wiring test's comment at `tests/hooks/useLiveCallWiring.test.ts:296-315`). `stop(X)` for a non-open X is treated as unreachable and ignored (LC:966-968).

### 1.3 Reducer arms (LC:946-1058)
- **`speechStart` (LC:946-958).** Ignored if `muted || earHeld`. Otherwise it sets `userSpeechActive=true, speechItem=itemId??null`. It is a flag only, and the barge is independent of it (the comment at LC:947-949 says "Speaches fires on first detection and has no minimum-speech knob").
- **`speechStop` (LC:960-974).** It must pair with an accepted start (`userSpeechActive`) and with the same segment (`sameSegment`, LC:735-737). If held, it lowers the flag only. Otherwise it sets `waitingFinal=true`.
- **`segmentNoise` (LC:976-980).** Sets `noiseOpen`. `callReduce` then normalises `noiseOpen` with `userSpeechActive` and `speechItem` (LC:826-854).
- **`final` (LC:995-1058), in order:**
  1. it clears `noiseOpen` if the final is for the open segment;
  2. if `muted || earHeld`, it drops the final flat and clears `waitingFinal`;
  3. **empty text is discarded and clears `waitingFinal`**; this is where the relay's gap-cut `reason:"short"` finals go, because the client knows `reason` only as empty text (LC:1016-1017);
  4. the echo backstop: `echo >= echoMin` sets the heard line to "own words" silently (LC:1018-1024);
  5. the transcript gate `tooQuiet` (LC:723-730) sets the note, plus `dropCue` only if `energyMs > 0` (LC:1037-1046);
  6. otherwise the final is taken: `pending.push`, then `drain`.

  **`waitingFinal` is a single boolean, and every exit clears it whatever the item id.**
- **`serverError upstream_error` (LC:1321-1330).** Clears `waitingFinal` because Speaches sends `error` **instead of** the final for a failed transcription (R86 LC-2). The session continues.
- **`ready` and `socketLost` (LC:903-942).** Reset `userSpeechActive` and `waitingFinal`, because the utterance in flight is lost.

**Break under async ASR.** Consider the order `stop(A) → start(B) → stop(B) → transcript(A) → transcript(B)`. `transcript(A)` clears the `waitingFinal` that `stop(B)` raised, so `mouthMayOpen` goes true while B's final is still due. That violates the §4.2 iron rule. B's words are not lost: they queue and are submitted after the reply. Speaches' inline transcription makes this order impossible today. An owned relay with concurrent or async ASR makes it possible whenever ASR latency exceeds B's span plus `silence_ms`.
- **Fix (a), client:** `waitingFinal` becomes the set of awaited ids.
- **Fix (b), relay:** strict FIFO emission, with `speech_stopped(B)` never emitted before `transcript(A)`. This stalls B's stop behind A's ASR.

(a) is the right one, and it is still cheap: the ledger already keys everything by id.

### 1.4 "The mouth waits" (`mouthMayOpen`, LC:860-862, wired at LC:2981 and poked at LC:2379)
- The rule is `!waitingFinal && (!userSpeechActive || noiseOpen)`.
- It assumes the stop reliably triggers a final or an `upstream_error`. Otherwise the mouth is blocked until mute, reconnect or the next final.
- It holds from the arrival of `speech_started` until the arrival of the final. The latency of the reply after a stop equals the ASR latency; that property is unchanged.
- **Held-boundary race (widened by onset confirmation).** The owner starts talking at the instant a reply becomes ready. `mouthMayOpen` is still true because no start has arrived yet. The mouth opens, `earHeld` goes true, the start is then ignored (LC:957), and the final is dropped flat (LC:1013-1014).
  - Window today: Speaches' detection latency (about one frame plus Silero) plus RTT.
  - With 150–250 ms of onset confirmation, the window widens by that amount.
  - The race only applies where `mayHold` (LC:421-422), i.e. `mic_hold` is on, or auto without AEC "all" (the shipped Media route).

### 1.5 The noise verdict (`noise_verdict_ms`, default 1000; CFG:770)
- It is armed at the arrival of `speech_started` (LC:2462-2468) and judges `seg.accruedMs < min_final_ms` at arrival + 1000 ms.
- It inherits §1.2's arrival alignment. A later start means the verdict comes later and accrues less onset energy. Delaying the verdict is harmless. Accruing less onset matters only against `min_final_ms`.

### 1.6 `min_final_ms` (default 200; CFG:760), the transcript gate
- Judged at final arrival, on the segment's arrival-aligned accrual.
- **Onset confirmation of 150–250 ms removes about that much voiced onset from the accrual.** A one-syllable "yes" with about 250–350 ms voiced could fall under 200 ms and be dropped as "too quiet", with a cue. **This is the largest behavioural risk of the owned VAD.**
- Fix options, least debt first:
  - **(i)** The relay puts audio-clock segment bounds on the leg's received-sample clock into `speech_started` and `speech_stopped`. The client keeps a ring of per-sent-frame dB indexed by frames actually passed to `sendAudio`, and accrues over the true span, pre-roll included.
    - The two clocks agree only if nothing is dropped between `sendAudio` and the VAD. With in-process VAD, the relay-queue drop sits after it.
    - The client pacer's drop-oldest (`call_backlog_ms`, LC:2665) and the pre-`ready` drop in `sendAudio` (LS:~160-200) happen before the count and do not break it.
  - **(ii)** Emit `speech_started` at the raw threshold crossing, as Speaches does, and let the VAD's min-duration rule end false onsets as an empty final `reason:"short"`. This preserves today's timing exactly, but a flap then holds the mouth for at least `silence_ms` (700) instead of ≤ 201 ms.
  - **(iii)** Lower `min_final_ms`. This is a knob change, not a fix.

### 1.7 Barge-in (energy-gated, windowed)
- `bargeWindow` (LC:1503-1516), `BARGE_HIT_RATIO=0.75` (LC:253), frames `ceil(min_speech_ms/frame_ms)` (LC:2609). The floor is the effective floor plus `playback_margin_db`, uplinked frames only, gated on `bargeArmed && mouthLive` (LC:2755-2772).
- **Consumes no ear event.** It survives unchanged.

### 1.8 Ear hold, tail hold, quiet-run release, chirp-measured lag (D80 ①⑤⑦)
- **Hold policy.** `mayHold` (LC:421-422). `earHeld` and `tail` are derived in `callReduce` (LC:840-844).
- **Held and muted frames are substituted with digital zeros before uplink** (LC:2649-2666, `silenceLike`), together with the cue and chirp windows (`cueFramesLeft`). The relay and its VAD therefore see silence, which is what makes a segment end under a hold.
- **Tail.**
  - `tailPlan` (LC:1755-1770): `lag` gives `max(min, lagMs+tail_lag_margin_ms)`, then `kill`, `noleak`, else quiet.
  - `tailStep` (LC:1787-1808) uses the noise floor plus `tail_quiet_margin_db`, contiguous `tail_quiet_ms`, capped by `hold_tail_max_ms`.
  - `leaked` (LC:1729-1731).
  - The chirp matcher runs on raw frames (LC:2627-2640).
- **Ear dependency.** The only indirect one is `tail_lag_margin_ms`=300, whose rationale includes "the ear's own 135–271 ms reporting delay" (CFG:842-846). With onset confirmation, a post-deadline echo residue needs a longer run to open a segment, so the margin gains slack. It needs no change.
- **Survives unchanged**, because it is all client-side on raw mic frames.

### 1.9 The text self-echo backstop (D80 ②)
- **The window** (LC:2206-2214). `echoUntil` is closed while the mouth is live. At the mouth's fall it is `+∞` if a tail is up, else fall + `echo_window_ms`. At the tail's release it is release + `echo_window_ms` (4000).
- **Timing assumption.** The echo's final lands inside the window: "an echo's final lands ~0.4 s after its stop, which comes `silence_ms` after the audible end" (CFG:857-860).
- Under owned VAD plus batch ASR, the stop time is unchanged: `silence_ms` after the end, and earlier on short phrases without Speaches' 3 s floor. The final lands at stop + ASR latency. ASR p95 must stay well under about 3 s, which the host bake-off (R94 §6.5) must confirm.
- `ECHO_MIN_CHARS=10` (`lib/echoText.ts:31`).
- **Survives**, provided ASR latency is bounded.

### 1.10 Empty finals and `reason:"short"`
- The client treats every empty final alike (LC:1016-1017, trail at LC:2360-2366). `reason` and `gap_ms` are not parsed (LS:78-86).
- An owned relay can send empty finals with any `reason` (`short`, `quiet`, `asr_error`) and no client change.

### 1.11 Other ear-event consumers
- `IDLE_EDGES` includes `speechStart` and `final` (LC:232-238); it re-arms the background idle clock.
- `CallOverlay.tsx:924,979,990` renders `userSpeechActive` and `waitingFinal` (the "speech" ring class, the phase label, "…" in place of the heard line).
- The voice learner learns from taken finals outside the echo window (LC:2367-2373 → LG:130-142).
- The trail's `final` line comes from `meter.last` (LC:2360-2366).

---

## 2. `lib/levelGate.ts`: the algorithm, and what could move before ASR

### 2.1 The algorithm
- **Conversion.** `rmsToDbfs(rms) = 20·log10(max(rms,1e-6))`, so digital zero is −120 dBFS (LG:24-32). The RMS comes from the worklet (`frame.rms`), taken on raw capture samples, even for held frames (LC:2677).
- **Noise tracker** (LG:81-92), with the minimum-tracking shape of WebRTC AGC2:
  - frames below `NOISE_DISCARD_DBFS=-84` are dropped, so held or muted zeros are excluded automatically;
  - the window is `NOISE_BOOTSTRAP_MS=1000` for the first one, then `NOISE_WINDOW_MS=5000`;
  - when a window closes: a lower minimum replaces the floor at once, a higher one moves it halfway;
  - `settled` becomes true after the first full 5 s window.
  - The wiring feeds it only `uplinked && !mouthLive` (LC:2680): it **pauses while the reply is audible** (R83 §8).
- **Voice learner** (LG:130-142):
  - p90 over the segment's samples (LG:115-119), then an EMA with α=0.3;
  - learns only if the tracker is settled, the p90 is ≥ N + `noise_margin_db` + `voice_margin_db`, and no sample fell during playback;
  - fed only by taken, non-echo-window finals (LC:2367-2373);
  - **persisted per device × granted EC mode** in browser storage (`voiceDeviceKey`, `getVoiceLevel` and `setVoiceLevel`, LC:1866-1868, 2785-2790).
- **Auto floor** (LG:174-181):
  - base `F=floor_dbfs` (−45) if N is unknown;
  - `N+nm` once settled;
  - `min(N+nm, F)` while provisional;
  - then `max(base, V−vm)` if V is known;
  - clamped to [`min_dbfs` −60, `max_dbfs` −20].
- **Pin ceiling** (LG:199-204): `max(min(max_dbfs, V−vm), autoFloor)`.
- **Effective floor** (LG:211-214): the pin (per call, client UI only, LC:1841-1844) clamped by the ceiling, else Auto.
- It is computed per frame (`gateFloor`, LC:2685).

### 2.2 When a segment is judged
Never during ASR, and never on the server. There are two judgements, both on arrival-aligned accrual:
- **During the segment**, once: at start arrival + `noise_verdict_ms`. This is the noise verdict, and it only lifts the mouth hold.
- **After the final arrives:** the transcript gate (`tooQuiet` in the `final` arm).

So the ASR has always already run on noise segments. The gate only suppresses submission.

### 2.3 What could move server-side, before ASR
The relay already receives exactly the **uplinked partition**. Held, muted, cue and chirp frames arrive as zeros, and the −84 discard would drop them from a relay-side tracker too. The relay could therefore compute per-frame RMS on the PCM it receives, and run the tracker and the segment accrual on true segment boundaries. Doing so would let it **skip ASR** for a too-quiet segment and emit `{"text":"","reason":"quiet","energy_ms":…}`, which removes the hallucination at source and saves an ASR call.

The relay cannot see:
- (a) `mouthLive`, which the tracker pauses on. C3 is HTTP and playback timing is client-side, so this would need a control frame.
- (b) the voice level V. It is per device and lives in browser storage.
- (c) the per-call pin.
- (d) frames the client pacer dropped. They were metered client-side but never sent; this is minor.
- (e) raw-sample RMS. The relay sees resampled pcm16. The DC-offset caveat in R94 §4.3 applies to both sides.

A server-side gate therefore needs a new uplink control, e.g. `{"type":"gate","floor_dbfs":x,"mouth":bool}`, sent on change. Today any unknown control is a protocol close (VL:691-694), so this is a coordinated wire bump.

**Recommendation.** Leave the gate client-side for the owned-VAD migration, as R94 §6.2 says. Fix its arrival-alignment instead, with §1.6 (i). The server-side pre-ASR gate is a separate, additive later slice.

---

## 3. The relay (`voice_live.py`): what is Speaches-shaped

### 3.1 Event translation (`_handle_upstream_event`, VL:886-935)

| Speaches event | Relay action |
|---|---|
| `input_audio_buffer.speech_started` | Sets `_speech_open=True`, opens a `_SegmentClock` (relay `monotonic` + `audio_start_ms`), sends `speech_started{item_id?,audio_start_ms?}` |
| `…speech_stopped` | Sets `_speech_open=False`, stamps the clock, sends `speech_stopped{item_id?,audio_end_ms?}` |
| `conversation.item.input_audio_transcription.completed` | Pops the clock, runs `_gap_cut`, sends `transcript{text,final:true,item_id?}`, or the empty `reason:"short",gap_ms` variant |
| `session.updated` | `_adopt_pre_roll` (the echoed `prefix_padding_ms`) plus a one-time mismatch warning |
| `error` | `_handle_upstream_error`: forwarded as `error{code:"upstream_error"}`, the session continues; also sniffs a `prefix_padding_ms` rejection |
| `committed`, `conversation.item.*`, `rate_limits.*`, `session.created` (after config) | Absorbed. `committed` deliberately updates nothing (F3) |

- `_segment_fields` (VL:207-221) forwards `item_id` if it is a non-empty str, plus exactly one clock field when it is an int (not bool).
- The only reason given for `final:true` is that there are no partials (VL:906-908).

### 3.2 The gap cut (D80 ④; VL:151-204, 937-981)
- `gap_cut_ms` judges on the **relay's arrival clock**: it cuts if the relay gap is < `silence_ms/2` (350), unless the audio gap net of the echoed pre-roll is ≥ `silence_ms`.
- Its premise is Speaches-specific: stop path ①, the 3 s zero-state rescan flap. The evidence: every hallucinated short had an arrival gap ≤ 201 ms, and every real one ≥ 2361 ms.
- It is skipped for dictation legs, but the clock is still consumed.
- The relay ledger is capped at `SEGMENT_LEDGER_CAP=32`, twice the client's 16.

### 3.3 Relay clocks
- **Relay `time.monotonic()`** at event arrival, used for the gap cut.
- **The Speaches audio clock** (`audio_start_ms`, back-dated by the pre-roll and clamped at the rotated buffer's start; `audio_end_ms`), used for the veto.
- **The uplink-idle deadline** (`uplink_idle_s`=15; VL:667-679).
- **The rate budget window** (VL:752-788).

### 3.4 Call and dictation modes
- `start.mode` accepts `call` (the default) or `dictation` (VL:136-138, 496-498).
- The **only** behavioural difference is that dictation skips the gap cut (VL:974). The mode also rides the trail's `leg_start`.
- The call client **never sends `flush`**: useLiveCall contains no `socket.flush()`. Only DI sends it.

### 3.5 Flush: why 3200 ms (VL:49-58, 831-882)
- Speaches' Silero looks only at the trailing 3 s. A stop needs either no speech in that window, or a closed segment with the buffer past 3000 ms (R70 §1.1).
- A `commit` while a segment is open trips `assert audio_end_ms is not None` (Speaches `input_audio_buffer.py:85`) and kills the session at a bare 1006 with the words lost. That is invariant 1: never commit (VL:44-48).
- Padding the buffer is therefore the only legal way to force an endpoint. The pad is `max(3000, silence_ms)+200`, a constant 3200 ms because `silence_ms ≤ 1200`.
  - It is constant rather than `3000−fed_ms` because `committed` cannot be correlated with fed audio (F3).
  - It is sent through the queue with `drop_oldest=False`, and `Queue.join()` acts as a delivery barrier (F2).
  - The burst lives relay-side because 80+ frames in about 3 ms would breach the relay's own rate ceiling.
- **With an owned VAD none of this is needed.** Flush becomes "force-close the open segment now and dispatch its ASR". It is synchronous, needs no pad and no barrier, and can even be acknowledged (§4).
- **Semantic to preserve:** at flush, audio the VAD has seen but not yet confirmed (a tentative onset inside the confirmation window, or pre-roll with speech probability above threshold) must be endpointed, not discarded. Speaches' zero-min-duration start plus the pad endpointed everything already appended.

### 3.6 `session.update` knobs (`_configure_upstream`, VL:566-618)
- The request is `turn_detection{type:server_vad, threshold=vad_threshold(0.6), prefix_padding_ms(300), silence_duration_ms(silence_ms 700), create_response:false}`.
  - **All the fields must be present**, or Speaches drops the object silently as `NotGiven`.
  - `input_audio_transcription.language` is omitted when blank, never null.
- Only one update is sent per session. It is snapshotted at session start (§4.5).
- **The Speech slider no longer exists.** D76 ④ deleted it, together with `setVad`, `redialLeg`, `start.vad_threshold` and its `_parse_start` arm (DECISIONS D76 ④; LIVE_VOICE_PLAN:2123, 2136). `vad_threshold` is Conf-only, bounded 0.5–0.8 (CFG:711). Only its rationale is Silero-specific: the end threshold is `threshold−0.15`.
- Under an owned VAD all three knobs become relay VAD config. Keep the names; `prefix_padding_ms` becomes the pre-roll ring.

### 3.7 Other Speaches-shaped code

| Code | Location | What it does |
|---|---|---|
| `realtime_url` | VL:275-289 | Builds `/realtime?model=&intent=transcription` |
| `connect_speaches` | VL:292-311 | `max_size=None`, `compression=None` |
| Waiting for `session.created` | VL:585-600 | Bounded by `policy.timeout_s` |
| `_UpstreamRefused` / `_classify_connect_failure` | VL:550-564 | Classifies the handshake (403/4xx vs unreachable) |
| `_UpstreamLost` | VL:325-326, 1050-1083 | The session dies on a WebSocket loss |
| Resampling to `SPEACHES_WIRE_RATE=24000` | `core/audio.py:27`; VL:476 | Resample target |
| base64 TEXT frames | VL:19-21, 802-804 | A binary frame kills the Speaches session |
| Relay queue | VL:636-637, 790-829 | `relay_queue_ms`, drop-oldest, plus a `degraded` frame; exists because Speaches has no backpressure |
| `_note_frame` count budget | VL:757-760 | Justified by "a synchronous Silero pass on Speaches' event loop"; under an owned VAD it is our loop, so the budget matters more (R94 Q4) |
| `max_session_s` | VL:422-424 | Rationale is Speaches' 30-minute hard expiry |
| `_speech_open` / `_audio_seen` | VL:389-398 | Exist only for the flush no-op guard and commit-safety |
| Standalone tool | `tools/speaches_realtime_smoke.py` | Speaches smoke test |
| Test scaffolding | `backend/tests/test_voice_live_s1.py` | Fake Speaches through the `LiveUpstream` Protocol (VL:261-267) |

---

## 4. `useDictation.ts`: use of the same events (DI:955-998)

- **`speech_started`** is ignored (DI:971-974).
- **`speech_stopped`** does `s.stops += 1` and `setPending(true)`, the "it heard you stop" pulse.
- **`transcript`** (`final` only): `finalsSeen += 1` for any final, including empty ones. Non-empty text goes to `appendDraft(text)` (**in arrival order**, `store/composer`'s join rule) and increments `s.finals`. Then `setPending(stops > finalsSeen)`.
- **`item_id` is not used at all.**
- **`stops` vs `finalsSeen`** drives only the pending pulse (DI:229-236). It assumes one final per stop. A Speaches transcription error sends `error` and no final, which leaves the pulse lit until release (cosmetic). The `error` case is ignored (DI:994-997).
- **`finals`** (non-empty appends) drives only rule ③'s either/or: at least one phrase discards the clip, zero uploads it (DI:891-906).
- **The release** (`finishStream`, DI:772-908) runs in this order:
  1. drain the pacer backlog, bounded by `ceilingMs/DRAIN_PACE`;
  2. `socket.flush()`; it has no ack, and the return value only reports `readyState`;
  3. wait **`tail_wait_ms` flat** (2000; CFG:966-971);
  4. `stop`, then `close`.
- **The "theorem"** (DI:815-839): no event ledger can end the tail wait early, because the wire carries no completeness marker. `stop` discards audio that has not been endpointed. The only early wake is a delivered close.
- **Assumptions:**
  - (a) the flush endpoints the trailing phrase;
  - (b) release to final ≤ `tail_wait_ms`, sized at about 2.4× Speaches' 530–830 ms;
  - (c) finals arrive in phrase order;
  - (d) no mid-dictation gap cut; the relay skips it on `mode:"dictation"`;
  - (e) the leg survives ASR hiccups, since `error` is ignored and only a close kills it.
- Also: `release_tail_ms` (400) of post-roll after a user stop (DI:100-106) is client-only. Idle and max stops run on client energy or timers (DI:1271-1290) and do not depend on the ear.
- **Under an owned VAD:**
  - (a) needs "flush endpoints tentative onsets" (§3.5).
  - (b) gets easier: release to final becomes ASR latency only.
  - (c) needs FIFO transcript emission per leg.
  - The theorem's root premise ("no completeness marker") **stops being true.** The relay is now the producer and knows when the flushed segment's final has been emitted, so an additive `{"type":"state","state":"flushed"}` after that final makes the wait exact. That is optional; the current flat wait still works unchanged.

---

## 5. Consumer → assumption → fate under an owned-VAD relay

| # | Consumer (file:line) | Assumption it relies on | Under an owned VAD |
|---|---|---|---|
| 1 | LS `parseLiveFrame` (LS:61-98) | Frame vocabulary `state/speech_started/speech_stopped/transcript/error`; `item_id` a non-empty str; `final` defaults true | **Unchanged** |
| 2 | Ledger key `${leg}:${item_id}` (LC:1463-1467, 1525-1537) | Ids unique within a leg; strict start/stop alternation; ids on all three frames | **Unchanged.** The relay mints per-leg ids, e.g. `seg_<n>`, always sent. Fail-open paths become test-only |
| 3 | Segment accrual `meterFrame` (LC:1476-1501) | Window = client arrival of start to arrival of stop; start ≈ onset + one frame + RTT | **Needs adaptation** if onset confirmation delays the start: fix (i) (audio-clock bounds plus a client dB ring) or (ii) (early start plus `short` finals) |
| 4 | Transcript gate `tooQuiet` + `min_final_ms` (LC:723-730, 1025-1046) | The accrual in row 3 | **Break risk:** short answers lose 150–250 ms of accrual and fall under 200 ms. Fixed by row 3 |
| 5 | Noise verdict (LC:2440-2471, 976-980) | Timer from start arrival; single timer; segment still open | Survives. The verdict comes later by the confirmation delay (harmless); it inherits row 3 |
| 6 | `waitingFinal` single bit (LC:433, 974, 1014-1053, 1321-1330) | `transcript(A)` before `stop(B)` (Speaches' inline, serialised ASR); one answer per stop | **Breaks** with async or concurrent ASR (§1.3). Adapt: a per-id awaited set in the reducer, **and** the relay guarantees one answer per stopped segment |
| 7 | "Mouth waits" `mouthMayOpen` (LC:860-862) | Rows 6 and 8; a start arrives promptly after the onset | Survives with row 6 fixed. **The held-boundary race widens** by the confirmation delay (§1.4) |
| 8 | ASR failure → `upstream_error` clears the wait (LC:1321-1330) | An errored transcription sends `error` instead of a final | **Must preserve.** The relay emits, per failed segment, an empty final `reason:"asr_error"` with `item_id` (discharges both ledgers precisely), optionally plus `error{upstream_error}` for the note |
| 9 | Pending queue order / `drain` (LC:1050-1056) | Finals arrive in utterance order | **Must preserve:** FIFO transcript emission per leg (serialise ASR, or reorder before emit) |
| 10 | Echo backstop window (LC:2206-2214, 1018-1024) | Final ≈ stop + ~0.4 s; stop = end + `silence_ms`; window 4 s | Survives if ASR p95 ≪ 3 s (bake-off gate). Stops come earlier (no 3 s floor), which adds margin |
| 11 | Empty final / `reason:"short"` (LC:1016-1017) | Empty text = discharge, no cue or note; `reason` not parsed | **Unchanged.** New reasons (`quiet`, `asr_error`) are free |
| 12 | Held-frame zeroing (LC:2649-2666) → VAD endpoints under the hold | The server VAD endpoints on digital silence | **Unchanged.** Silero on zeros gives low probability; the pre-roll ring holds zeros across the release |
| 13 | Barge window (LC:1503-1516, 2755-2772) | None on the ear | **Unchanged** |
| 14 | Tail plan and step, chirp, leak (LC:1729-1808, 2627-2745) | None on the ear; `tail_lag_margin_ms` rationale cites the ear's reporting delay | **Unchanged**; the margin gains slack |
| 15 | Voice learner (LC:2367-2373, LG:130-142) | Samples = arrival-aligned segment frames | Survives. Better with row 3 (i): the true span, pre-roll included |
| 16 | Idle clock `IDLE_EDGES` (LC:232-238), overlay (`CallOverlay.tsx:924, 979, 990`) | Start and final exist | **Unchanged** |
| 17 | DI pending pulse `stops/finalsSeen` (DI:975-991) | One final per stop | Survives. Becomes exact with row 8's empty `asr_error` final |
| 18 | DI `appendDraft` order (DI:983-986) | Finals in phrase order | **Must preserve** (row 9) |
| 19 | DI release: flush → flat `tail_wait_ms` → stop (DI:772-908) | Flush endpoints all heard audio; release to final ≈ 0.5–0.8 s; no completeness marker exists | Survives if flush also endpoints tentative onsets. **Becomes simpler:** an optional `flushed` marker makes the wait exact and `tail_wait_ms` can shrink |
| 20 | DI no gap cut (`mode:"dictation"`, VL:974) | The relay differentiates by mode | **Keep the mode gate** on any min-duration or `short` policy that replaces the gap cut |
| 21 | Client degrade on `upstream_refused` at dial (LC `serverError` default → terminal) | Ear refusal is known at handshake | **Needs adaptation:** with batch ASR, reachability is only known per segment. Add a dial-time health or preflight check, or accept per-segment `asr_error` |
| 22 | Relay gap cut (VL:190-204, 949-981) | Speaches' stop path ① flap geometry; relay arrival clock; pre-roll netting | **Obsolete.** An owned VAD's minimum is confirmation plus `silence_ms` (about 850 ms or more), so a < 350 ms cut never fires. Keep it until traces show zero saves (R94 §4.3), then replace it with a VAD min-speech rule (mode-gated) that **skips ASR** rather than blanking its output |
| 23 | Trail (`leg_start` session verbatim, `down`, `flush pad_ms`, `pre_roll`, `gap_cut`, `up_error`) | Speaches knobs and events | Adapt: `leg_start` carries the VAD config; add `vad`/`seg` lines (start/stop sample indices, probabilities) for the replay harness |

---

## 6. Speaches-specific workarounds an owned VAD makes deletable

| # | Workaround | Evidence that justified it | Deletable when |
|---|---|---|---|
| 1 | **Never commit** (invariant 1; VL:44-48, 834-837, 1154) | `assert audio_end_ms is not None` in Speaches `input_audio_buffer.py:85`; bare 1006, words lost; reproduced 2/2 (R70 §1.2 arm A) | Immediately: there is no commit concept |
| 2 | **The 3200 ms silence-burst flush** plus `FLUSH_MARGIN_MS`, `VAD_WINDOW_MS`, the `drop_oldest=False` path, the `Queue.join()` delivery barrier, `_audio_seen`, `_speech_open` (VL:49-58, 110-116, 389-398, 831-882) | Silero cannot stop before the buffer is past 3000 ms (R70 §1.1); `3000−fed_ms` went stale in both directions (F3, two rounds); burst-tail eviction (F2: 2760 of 3000 ms delivered) | Immediately; flush becomes a synchronous force-endpoint |
| 3 | **The D80 ④ gap cut** plus `_SegmentClock`, `gap_cut_ms`, `SEGMENT_LEDGER_CAP`, `_segments` (VL:30-40, 151-204, 937-981) | Car trail: every hallucinated short had an arrival gap ≤ 201 ms, every real one ≥ 2361 ms; stop path ① zero-state rescan flap (R92, R94 §4.1) | After shadow traces show zero saves (R94 §4.3). Replace with a VAD min-speech rule that skips ASR, mode-gated |
| 4 | **Pre-roll echo adoption and mismatch warning** (`_adopt_pre_roll`, `_note_pre_roll_mismatch`, the `prefix_padding_ms` error sniff; VL:399-407, 983-1023) | The unpatched fork rejects the field; the fork's `fd4b956` back-dates `audio_start_ms` (S11, BUG-001 H3) | Immediately; the pre-roll is our own ring |
| 5 | **The five-field `turn_detection` pin** and "language omitted, never null" (VL:566-618) | A partial object is silently dropped as `NotGiven`; `exclude_defaults` (§7-S0) | Immediately; the knobs become relay VAD config and the language rides the batch STT request |
| 6 | **`SPEACHES_WIRE_RATE` 24 kHz resample plus base64 TEXT frames** (VL:19-21, 476, 802-804; `core/audio.py:27`) | One binary frame kills the Speaches session (§7-S0 ②) | Immediately; resample to the VAD/ASR rate (16 k); keep `Pcm16Resampler` |
| 7 | **The realtime WS client:** `realtime_url`, `connect_speaches`, the `session.created` wait, the `LiveUpstream` Protocol, the `_recv_upstream`/`_send_up*` 1006 classification (VL:261-311, 585-600, 1050-1083) | The Speaches realtime protocol | When ASR moves to `POST /v1/audio/transcriptions` through the existing `VoiceClient` or provider seam |
| 8 | **The relay queue's rationale** ("Speaches has no backpressure", VL:59-63) and the count-budget rationale (VL:757-760) | Unbounded Speaches pubsub; synchronous Silero on Speaches' loop | Rationale changes, the code stays: backpressure now protects our own VAD and loop (R94 Q4) |
| 9 | **`max_session_s` rationale** (VL:422-424) | Speaches' hard 30-minute expiry | Keep the knob; rewrite the rationale |
| 10 | **`_UpstreamLost` killing the leg on an ASR death** | A stateful realtime session cannot be re-dialled (VL:69-73) | Replace with per-segment `asr_error`; the leg survives (R94 §6.2, "a dead ASR call no longer kills the leg") |
| 11 | **Client:** `upstream_error` substituting for a missing final (LC:1321-1330) | Speaches sends `error` instead of `…completed` on a failed transcription (R86 LC-2) | Keep as a belt; the precise path becomes an empty final with `item_id` |
| 12 | **Client:** DI's flat `tail_wait_ms`, the "no completeness marker" theorem (DI:815-839), and the `_reaper_outlasts_tail` validator (CFG:893-901) | `flush` has no ack; Speaches processes appends asynchronously | Optional simplification: a relay `flushed` marker. The validator stays while `tail_wait_ms` exists |
| 13 | **Tools and tests:** `tools/speaches_realtime_smoke.py`; the fake Speaches in `backend/tests/test_voice_live_s1.py` | — | With #7 |

**Not deletable** (relay-owned, independent of Speaches):
- the uplink caps and `_note_frame` (R94 §2's rate-guard fix still applies);
- `uplink_idle_s`;
- admission (`LiveSessionSlots`);
- `mode`;
- the trail;
- the typed error/close taxonomy (`upstream_refused` changes meaning, §5 row 21).

---

## 7. Assumptions an owned VAD could BREAK: the requirements list for the relay's producer contract

1. **Onset timing (HIGH).** Onset confirmation delays `speech_started` by 150–250 ms. The client accrues from arrival, so `min_final_ms`=200 starts dropping short real answers ("yes", "no"), with a cue. The noise verdict and the held-boundary race also shift.
   - *Requirement:* either (i) send `audio_start_ms`/`audio_end_ms` on a documented leg-audio clock (received client samples since `ready`, pre-roll-inclusive start) and move client accrual onto a per-sent-frame dB ring (client change), or (ii) emit the start at the raw crossing and cut false onsets at end as `short`. Decide this in the D-entry.
2. **Transcript/stop interleave (HIGH).** Async batch ASR allows `stop(B)` before `transcript(A)`, and the single-bit `waitingFinal` is then cleared early (§1.3).
   - *Requirement:* the client moves to an awaited-id set (the ledger already has ids), and the relay emits transcripts FIFO per leg.
3. **Order (HIGH for dictation).** Concurrent ASR can complete out of order and scramble `appendDraft` and the pending queue.
   - *Requirement:* serialise ASR per leg, or a reorder buffer before emitting.
4. **One answer per stop (HIGH).** An ASR failure must still discharge its segment. Otherwise the mouth is blocked until the next final, mute or reconnect.
   - *Requirement:* an empty final `{item_id, reason:"asr_error"}` (plus `error{upstream_error}` if the note is wanted); a timeout on the ASR call.
5. **Strict alternation and unique ids (MED).** A second `speech_started` without a stop leaves the new segment unmeasured (`meterEdge` opens only on the `!prev.userSpeechActive` edge). A max-segment split must emit `stop(A)` then `start(B)`, and ids must never repeat within a leg.
6. **Flush semantics (MED, dictation).** The flush must endpoint a tentative (unconfirmed) onset and any open segment. Otherwise the last short word of a dictation is dropped: `stop` discards and `tail_wait_ms` runs out.
7. **Prefix semantics (LOW).** The only consumer of Speaches' pre-roll back-dating is the relay's own gap-cut veto (VL:173-182). No client reads `audio_*_ms` (LS:21-30). An owned VAD may redefine them. Document the clock if option 1(i) is taken.
8. **Dial-time failure class (LOW).** `upstream_refused` at the handshake no longer covers an unreachable ASR host. Add a preflight or accept per-segment errors.
9. **ASR latency bound (LOW; bake-off gate).** The echo window (4 s), the mouth-wait latency and DI's `tail_wait_ms` (2 s) assume release→final and stop→final well under about 2 s at p95.
10. **Mode gate (LOW).** Any min-duration or `short` policy that replaces the gap cut must keep dictation exempt (D80 ④ S11 amendment), or be proven harmless to real words there.
