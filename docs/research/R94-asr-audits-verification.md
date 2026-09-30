# R94 — Live voice, verified: why recordings die mid-session, why the ear invents turns, and the design that fixes both

**Status:** VERIFIED ANALYSIS + PROPOSED DESIGN. Nothing is built and nothing is ruled.
- Written for the Fable review and the owner's rulings in §11.
- The first draft of this file (earlier on 2026-09-28) was superseded by this rewrite. Every correction to it is logged in §12.

**Authorship:** the Opus 5.5 main seat, 2026-09-28.
- Five Opus 5.5 verification lanes, L1–L5, each read-only; their full reports are in [`R94-evidence/`](./R94-evidence/).
- The main seat spot-checked every load-bearing claim against the code.

**Inputs.** Five external audits by a smaller model, kept verbatim in [`R94-external-audits/`](./R94-external-audits/):

| Audit | Subject |
|---|---|
| A1 | Live-voice architecture |
| A2 | Dictation unexpected stop |
| A3 | Live-voice hallucination |
| A4 | Parakeet backend options |
| A5 | VAD/ASR architecture, revised |

The owner treated these as **hints, not instructions**, and so does this document: each claim is re-derived from code, logs or measurement.

**Ground truth used:**
- ctrl-b `778b960` (prod runs v1.7.10, same relay code).
- The deployed Speaches fork `~/github/speaches` @ `fd4b956` (`speaches.service`).
- The prod journal (`journalctl --user -u ctrl-b-dashboard` and `-u speaches`, 09-14 → 09-28).
- The D77 call trails (`~/.ctrl-b/calls`, `~/.ctrl-b-dev/calls`, and the preserved car trail `~/.cache/tmp/ctrlb-session48/prod-trail-raw.jsonl`).
- Measurements on emma (L3, L4).

**Host:** emma is an AMD Ryzen 7 8745HS with a Radeon 780M (RADV PHOENIX, Mesa 26.0.3), 16 threads, 30 GB RAM, Ubuntu (Linux 7.0), Python 3.14.4.

**Evidence tags:**
- **[CODE]** — read in source, with file:line in the lane reports.
- **[LOG]** — prod journal.
- **[TRAIL]** — call trail.
- **[MEASURED]** — run on emma.
- **[SOURCED]** — external primary source, cited in L4.
- **[INFERRED]** — follows from verified parts.
- **[OPEN]** — needs a ruling or an experiment.

> ⚠ **Before committing:** `R94-evidence/L2-trail-forensics.md` quotes lines from the owner's private call transcripts. The owner should review or redact them before commit/push.

---

## 0. How to read this

- **§1** — the one-page answer.
- **§2** — the pipeline as it is today.
- **§3** — **Problem A:** recordings and calls cut off mid-session.
- **§4** — **Problem B:** false user turns ("Yeah." / "Mm-hmm.").
- **§5** — the failure taxonomy, mapping every symptom class to its mechanism and the layer that fixes it.
- **§6** — design principles.
- **§7** — the proposed design.
- **§8** — every topic from A1–A5 with a verdict.
- **§9** — tests and acceptance.
- **§10** — sequencing.
- **§11** — decisions needed.
- **§12** — corrections log.

---

## 1. The answer in one page

### Problem A — "dictation stops by itself, sometimes after 30 s or less"

It is **not** Auto-stop, the idle timer, or the 2-minute cap.

**The evidence [LOG]:**
- On 2026-09-28 the relay itself killed **5 live legs** after 4–49 s, each logged as `session ending — protocol (uplink frame rate exceeded: more than 100 frames in 2s …)`.
- Four were dictation. One (07:37) was very likely **a call**, which ended outright.
- Two more dictation legs ended with no server line at all, which fits a client-side kill of the same family.

**The mechanism [CODE]:**
- The relay's anti-flood guard (`_note_frame`) counts frames by **the moment the server reads them**, in a rolling 2 s window.
- The phone paces what it *sends* correctly, but 4G + WireGuard + Tailscale Serve + TCP deliver in bunches after any radio or network stall. A stall of ~2 s (**~1 s in the first seconds of a dictation**, when the phone is draining its handshake backlog) arrives as "more than 100 frames in 2 s".
- The guard treats that as a flood and closes the leg with a protocol error.
- Dictation's rule "the live leg died after a phrase already landed, so stop the whole recording" then ends the mic.

**The same network hiccup has three sibling kill paths**, all of which end in the same stopped mic:
1. the client's own backlog ceiling;
2. the browser send-buffer ceiling;
3. uvicorn's 5 s + 5 s keepalive.

**The fix is two-level:**
1. **Transport:** a guard shaped like the industry's (a token bucket refilled by the wall clock, with a burst allowance that forgives stalls), plus the sibling paths re-tuned.
2. **Structure:** a failed live leg must **never own the microphone's lifetime**. The recording continues, and the words after the last confirmed phrase are recovered from retained audio.

### Problem B — "the ear hears 'Yeah.' / 'Mm-hmm.' that nobody said"

The deployed Speaches realtime VAD is a batch function re-run from zero state over the last 3 s **on every 40 ms append**. Three sub-defects follow [CODE, TRAIL]:

1. **Flaps.** A transient that one rescan calls speech and the next does not becomes a 0–201 ms "segment" (34 of 66 segments in the trails). The flap rate is **zero while the buffer is under 3 s old and switches on exactly when the window starts sliding**.
2. **The 3 s pin.** A detection that starts within 3 s of the previous stop *cannot* end until the buffer passes 3 s: 21/21 such segments stopped ≥ 3036 ms after the previous stop. This makes noise transients into ~3 s slices, which Parakeet decodes as a filler word. It also delays and clips real short answers.
3. **Onset clipping.** A new buffer starts at each stop, so a segment that starts right after one cannot pre-roll across the boundary.

A **hidden second VAD** in Speaches' HTTP transcription path currently empties ~21% of segments before Parakeet sees them. That is the only reason the situation isn't worse, and any replacement must keep an equivalent.

**Not every ~3 s false turn is the VAD:** the car's "Yeah." (3084 ms, sent) was the reply's **echo tail**, which D80's tail hold and text backstop target.

**The fix:** ctrl-b's relay owns a **stateful streaming VAD** (Silero v5 via onnxruntime, ~0.25% of a core per call) with:
- onset confirmation;
- a continuous pre-roll ring;
- hysteresis;
- a clean end rule;
- a ctrl-b-owned **pre-ASR pass** (no-speech check + crop + chunking).

ASR becomes a **plain batch call through the existing provider seam**, so the ASR host becomes a config choice. **Speaches can then be retired** (it still hosts TTS fallback #1, which needs its own decision).

### The shape of the solution

```
phone mic ─▶ worklet PCM (16 kHz) ─▶ paced WS ─▶ RELAY
                                                  ├─ ingress guard: token bucket on the wall clock
                                                  ├─ STREAMING VAD (stateful Silero, per leg, on a leg sample clock)
                                                  │    onset confirm · pre-roll ring · hysteresis · max segment
                                                  ├─ segment ─▶ PRE-ASR PASS (no-speech · crop ±400 ms · ≤30 s chunks)
                                                  │              └─▶ batch STT via provider seam (parakeet.cpp / onnx-asr / …)
                                                  └─ ORDERED OUTBOX: start · stop · transcript (one answer per segment, FIFO)
phone: same frames as today → useLiveCall / useDictation unchanged except where §7.3 says
```

---

## 2. The pipeline today, and who owns what

```
phone: getUserMedia (EC per route, NS on, AGC unset) → AudioContext (native rate, usually 48 kHz)
     → AudioWorklet: 40 ms frames, PCM16 LE + RMS → uplinkPacer (1.5× drain, 500 ms bucket cap)
     → liveSocket (bufferedAmount ceiling 1 s → close 4000)
  ⇢ 4G → WireGuard/Tailscale → Tailscale Serve (TLS) → loopback → uvicorn (ping 5 s / timeout 5 s)
RELAY (voice_live.py): _note_frame guard (2 s window, 2×) → Pcm16Resampler → 24 kHz → base64 → Speaches WS
SPEACHES: 24k→16k per-chunk interp → 3 s zero-state batch Silero per append → speech_started/stopped
        → rotate buffer → WAV → loopback POST /v1/audio/transcriptions
        → 2nd Silero (thr 0.5, pad 400) → "" or Parakeet (onnx-asr fp32, unloads after 5 min idle)
RELAY: forward events; D80 gap cut (<350 ms relay gap, unless the audio span ≥ 700)
phone: useLiveCall ledger (energy accrued from start ARRIVAL) · noise verdict · transcript gate (min_final_ms)
       · echo window + text backstop · tail/ear hold · barge (energy) · "the mouth waits"
       useDictation: finals appended in arrival order; a leg death with finals>0 ⇒ stop()
```

**Ownership today:**
- **Speaches** owns *when* speech starts and stops, and *whether* a segment is transcribed (its second VAD).
- **ctrl-b** owns capture, transport, secondary admission (energy, echo, tail), call state and dictation.

The redesign moves the first two into ctrl-b.

---

## 3. Problem A — recordings and calls cut off mid-session

### 3.1 The evidence (2026-09-28, prod) [LOG]

**27 live legs** that day (L1 §5, L2 §4):

| Outcome | Legs | What it is |
|---|---|---|
| `flushing with 3200 ms of silence` | 18 | Ordinary dictation release (only dictation sends `flush` [CODE]) |
| `session ending — protocol (uplink frame rate exceeded …)` | **5** | Relay flood guard |
| No relay end line | 4 | Client-initiated close, cancel or call end: 07:38:16 (a call), 11:56:11 (39 s), 13:05:51 (30 s), 14:00:22 (2 s) |

**The five guard kills:**

| Accepted | Killed | Lifetime | Mode [INFERRED] | Re-open after |
|---|---|---|---|---|
| 07:36:17 | 07:37:06 | 49 s | **call** (a chat POST mid-leg, no flush; the next leg is a call) | 70 s |
| 08:09:42 | 08:10:18 | 36 s | dictation | 11 s |
| 13:10:40 | 13:11:03 | 23 s | dictation (the close handshake took 10 s: a stalled link) | 30 s |
| 13:11:33 | 13:12:06 | 33 s | dictation | 32 s |
| 14:08:16 | 14:08:20 | **4 s** | dictation (the post-`ready` drain window, §3.2) | 15 s |

**The two no-line dictation legs** (11:56:11, 13:05:51) had no clip upload and no flush, and a manual chat POST followed 14–20 s later. That is the signature of a client-side kill with a phrase already in the draft (§3.3) or a cancel. They are **undeterminable** without the §7.1.6 telemetry.

- No clip upload happened all day, consistent with every killed dictation already holding ≥ 1 phrase [INFERRED].
- **Prod has no trail for 09-28** (`voice.live.debug` off), so the per-leg client story is unrecoverable.

### 3.2 Root cause: the relay flood guard reads bursts as floods [CODE, MEASURED arithmetic]

**The guard.** `voice_live.py::_note_frame`:
- keeps a deque of `(time.monotonic(), ms)` for every binary frame, taken **when `_pump_client` reads it** (not when the phone sent it);
- closes the leg with `_ProtocolError` → `_fail("protocol")` → **1008** if more than 100 frames or 4000 ms of audio fall inside any 2 s window (`RATE_WINDOW_S = 2.0`, `RATE_MULTIPLIER = 2`);
- is documented as bounding per-message CPU and throughput on Speaches' loop ("a short catch-up after a scheduler hiccup passes").

**The pacer.** `uplinkPacer.ts` bounds what the phone hands to `ws.send()`:
- at most `BUCKET_CAP_MS` 500 + `DRAIN_PACE` 1.5 × 2000 = **3500 ms per 2 s**, on every send path (L1 §2.4);
- the send-side math is right.

**Why it still trips:**
- The pacer shapes the *send* side; the guard measures the *read* side.
- Everything in between can compress time: the phone's TCP stack and radio, the WireGuard tunnel, Tailscale Serve's proxy copy loop, uvicorn's receive queue, and relay event-loop stalls.
- After a stall of D seconds the backlog is read at once.
- **Steady state:** the worst window holds 25·(D+2) frames, which exceeds 100 once **D > 2.04 s**.
- **The first ~2 s after `ready` in dictation:** the phone drains up to `buffered_ceiling_ms` (1000) of handshake backlog at 1.5×. That uses 3000 of the 4040 ms window, so **D > 1.04 s** trips it, and the trip lands ≈ 3.2–3.6 s after accept. That matches the 14:08:16 → 14:08:20 kill [INFERRED].
- On 4G, 1–2 s stalls are routine (radio state changes, handovers, retransmits, DERP path changes).

**The count message always masks the ms message**, because both trip on the 101st 40 ms frame and the count check runs first.

### 3.3 The sibling kill family (same trigger, same owner symptom) [CODE]

| Path | Where | Trigger | Logged? |
|---|---|---|---|
| **K1 relay guard** | `voice_live.py:752-788` | Burst read ≥ the window budget (§3.2) | `session ending — protocol` |
| **K2 dictation post-`ready` backlog close** | `useDictation.ts:1125` | Backlog > `buffered_ceiling_ms` (1 s); a main-thread freeze > ~1.5 s or a slow drain | **No** |
| **K3 browser send buffer** | `liveSocket.ts:212` | `bufferedAmount` > 1 s of audio (96 KB @48k) once the OS send buffer is full during a radio stall; closes 4000 | **No** |
| **K4 keepalive** | prod unit `--ws-ping-interval 5 --ws-ping-timeout 5` | A stall > ~5–10 s; the phone's pong queues behind its own buffered audio | Debug level only |

**How each death becomes a stopped recording or a dead call:**
- **Dictation:** `onClose` with `finals > 0` → "Voice connection lost — the rest of that wasn't captured" → `stop()`. With `finals === 0` the leg degrades silently to the clip.
- **Call — asymmetric** (L1 §3):
  - K1 arrives as a typed `error{protocol}` → `terminal("error")`, and **the call ends**;
  - K3/K4 arrive as a socket loss, which goes to the reconnect ladder.
  - The same hiccup therefore ends or survives a call depending on which layer noticed first.

**Also in the family:**
- **K5 — slot hold.** A relay-initiated close waits up to 10 s (legacy websockets `close_timeout`) for the phone's close frame, while reading is blocked by a full 32-message queue. The single `max_sessions` slot is held meanwhile, so an immediate re-open gets **busy (1013)** (13:11:03 → "connection closed" 13:11:13) [LOG].
- **K6 — 2× the needed uplink.** The phone ships at its native rate (48 kHz, 96 KB/s ≈ 0.77 Mbit/s), and the relay immediately halves it. The extra bitrate makes every stall and standing queue on 4G worse [CODE; the actual phone rate is unverified because the trail is off].

### 3.4 The structural inversion: the live leg owns the mic's lifetime [CODE]

- Dictation runs MediaRecorder (the fallback clip) and the live leg (phrases) off one stream.
- Once a phrase has been appended, uploading the clip would duplicate text, so R70 rule ③ **ends the recording when the leg dies**.
- There is no reconnect and no recovery. Every transport hiccup in §3.3 is therefore *fatal to the user's recording* rather than a degraded caption.
- A2's diagnosis is right, and it is the highest-value structural change for dictation.

### 3.5 The other automatic stop paths (A2, all verified) [CODE]

| Path | Default | Independent of Auto-stop? | Notes |
|---|---|---|---|
| Hands-free idle stop | 15 s (`dictation_idle_s`) | **Yes** | Evaluated before the `if (!autoStopOn) return` gate. Its floor is `auto_stop_threshold` (0.01 RMS ≈ −40 dBFS), used even when Auto-stop is OFF. Hands-free (swipe-up locked) only. Test-pinned. |
| Hard cap | 120 s (`dictation_max_s`, `ge=10`) | Yes | Fires even mid-speech. There is no off setting. |
| Page hidden | Immediate | Yes | Streaming dictation stops on screen lock or app switch. |
| Relay `uplink_idle_s` | 15 s with no PCM at all | Yes | A frozen client; silence is still PCM. |
| MediaRecorder error, unmount, call `yieldMic` | — | Yes | Legitimate lifecycle stops. |

**None of these explains 09-28:** the owner's phone was unlocked, the stops came at 4–49 s, and the log names K1.

**They are still product-policy questions** (§11 P1–P3). "Auto-stop OFF" today does **not** mean "only I stop it".

### 3.6 Observability gaps (why this took an audit to find) [CODE]

**Server side:**
- The relay logs a line only for `_fail` paths, **without mode, duration, frame count or finals**.
- `_ClientGone`, a clean `stop` and a keepalive death log nothing at info level.
- The count message masks the ms message.

**Client side:**
- Dictation's `onClose` drops the close code and reason.
- `case "error": break` discards typed relay errors.
- Every local stop (idle, cap, hidden, socket, K2, K3) funnels into one generic `stop()` with no reason.

**Trails:**
- They are opt-in and prod had them off.
- `trail_keep = 20` with sub-second dictation taps evicted the only car-call trail within ~15 h [TRAIL].

---

## 4. Problem B — false user turns ("Yeah." / "Mm-hmm.")

### 4.1 How the deployed Speaches VAD actually works [CODE]

On every `input_audio_buffer.append` (25/s):
1. The 24k→16k conversion is a per-chunk `np.interp` with no filter: a 25 Hz sawtooth time-warp with ~−20 dB error on a tone.
2. `np.append` copies the whole buffer, O(n).
3. `get_speech_timestamps` (Silero, faster-whisper's **split v5 export**) runs over `data[-3 s:]`, with state zeroed per call (`silero_vad_v5.py:108`, carried only *within* the call), thr 0.6 / neg 0.45, `min_speech_duration_ms = 0`, `min_silence = silence_ms` (700), pad 0.
4. The last timestamp decides:
   - **start:** the first pass with any timestamp;
   - **stop ①:** no timestamp in the window;
   - **stop ②:** `ts.end < 3000 and duration_ms > 3000`.
5. On stop:
   - the buffer **rotates** (a new empty buffer);
   - the slice `[audio_start − prefix_padding, buffer end]` is WAV'd;
   - the slice is POSTed to Speaches' **own** `/v1/audio/transcriptions` over loopback. The append task awaits it, but **other appends keep flowing** (each event is its own task).

**Three properties follow.**

**(a) Flaps.** Once the buffer is > 3 s old:
- each rescan sees a window whose 512-sample grid **shifts by 128 samples per append**;
- the newest chunk holds only 24 ms of real audio (zero padding + a view write that zeroes 64 samples);
- the model restarts from zero state each time.

A borderline transient can therefore be speech on one pass and gone on the next: start → stop ① within 0–201 ms.

**(b) The 3 s pin.** In a buffer < 3 s old the window starts at sample 0 on every pass and Silero is causal, so scores are **deterministic**. A found region persists (stop ① impossible), and stop ② is blocked by its `> 3000` guard. **Any detection that starts within 3 s of the previous stop is held until the buffer passes 3 s.**

**(c) Onset clipping.** The pre-roll is clamped at the rotated buffer's start. A segment that begins 0.2–0.3 s after a stop cannot reach back for its onset.

### 4.2 What the trails show [TRAIL, L2]

The corpus: 66 segments with segment data (car 38 · dev 9 · 09-27 evening 19).

**Flaps:**
- **34/66** segments are flaps, with relay gaps of 0–201 ms. The smallest non-flap gap is 1044 ms.
- Text: 25 × "", plus 9 fillers ("Yeah." ×4, "Okay.", "Really?", "Mm.", "Mm-hmm." ×2).
- **Timing:** by time since the previous stop, the flap counts are 2 / **0** / **12** / 6 / 14 for the bins 0–1 / 1–2.8 / 2.8–3.5 / 3.5–6 / > 6 s. There are no flaps while the window is fixed at sample 0, and a burst the moment it starts sliding. This confirms (a) and (b) together.

**The pin:**
- **21/21** non-flap segments that started in a fresh buffer stopped ≥ 3036 ms after the previous stop.
- 6 of them landed within 110 ms of the 3 s crossing, two confirmed on the audio clock (3040, 3080).
- Starts 0.23–0.28 s after a stop are mostly **flap-splits** (the same sound continuing), then pinned to ~3.0–3.3 s.

**The long short-text spans, one by one:**

| Span | Mechanism | Outcome |
|---|---|---|
| Car "Mm-hmm." 2478 ms | **Pin** (fresh buffer, stop at 3036) | Dropped by the energy gate |
| 09-27 evening "Yeah." 1044 relay / 1396 audio | **Pin** (`audio_end_ms` 3080). Peak −35.9 dBFS ≈ 17 dB under the owner's turns: likely false | **Sent.** The level gate's floor was still at the −60 clamp (not yet settled early in the call) |
| Car "Okay, uh" 3158 ms | Partial: pinned start, own end 0.54 s later | Taken; may be real |
| Car "Yeah." 3084 ms | **Not the VAD:** started 156 ms after `playbackDrained` (buffer 17 s old). **Echo tail** (≈ 2.3–2.7 s echo + 700 ms) | **Sent.** The D80 tail hold/backstop domain (car trail predates v1.7.10's chirp-set tail) |

**Consequences for the design:**
- Two independent mechanisms produce ~3 s false turns: the pin and the echo tail. A VAD fix removes flaps and pins; it does **not** remove echo-tail turns.
- The pin also taxes **real** speech. "No, it was nothing." was held to 3040 ms with its start clamped to 0.

### 4.3 The hidden second VAD, Parakeet, and the gap cut's real effectiveness [CODE, LOG, TRAIL]

**The hidden second VAD:**
- Speaches' HTTP door runs a fresh batch Silero over each posted slice: thr 0.5, min_silence 160, pad 400, max 30 s.
- Fork patch `e093d8b` returns `""` when it finds nothing. Patch `fdc6a27` crops to `[first−400 ms, last+400 ms]` and splits > 30 s.
- **It emptied 93 of ~452 realtime segments (~21%) and 3 of ~100 clip uploads.**
- It is why 25 of the 34 flaps came back empty. **ctrl-b depends on it without knowing** (A1–A5 all missed it).

**Parakeet behaviour:**
- ASR is not a no-speech classifier. Admitted ambiguous audio decodes as plausible short words (R92 synthetic probes).
- Today's slices carry ≥ 700 ms of trailing silence (up to ~3 s when pinned). The second VAD's crop removes most of it before Parakeet.
- An NVIDIA-reported Parakeet sensitivity to trailing silence (A3 §11.4, not re-verified) makes the crop worth keeping regardless.

**The D80 gap cut:**
- It works on the car-trail geometry: every hallucinated short ≤ 201 ms, every real one ≥ 2361 ms.
- Its **audio-span veto** assumes "audio span ≥ `silence_ms` ⇒ a real stop ②". Stop ① flaps back-date `audio_start_ms` anywhere in the 3 s window.
- On the 09-27 evening trail, **6 of 7 flaps were vetoed** (net spans 1.1–3.2 s). They were saved only because the second VAD returned "".
- The relay's arrival clock is also bunched by §3.2. Six segments show 36–53 ms relay gaps for 1.3–3.2 s of audio.
- **The gap cut is weaker than D80 assumed**, and it is a compensator for a defect the redesign deletes.

**Other ctrl-b-visible Speaches defects** (L3 §6):

| Defect | Severity |
|---|---|
| Parakeet **unloads after 5 min idle**; the first utterance after a gap pays 1.7–22 s. All 17 realtime transcriptions over 2 s coincide with reloads | HIGH, observed |
| Any non-HTTP-status error in transcription kills the whole session (1006) | HIGH, latent |
| Per-session memory never freed; `np.append` O(n); the event loop saturates after ~8–10 min without a speech stop | MED, latent |
| No timeout on the loopback transcription (600 s SDK default) | LOW |
| Transcripts can complete out of order (3 overlaps observed); dictation appends in arrival order | LOW |
| `input_audio_transcription.language` silently dropped (inert: Parakeet v3 auto-detects anyway) | LOW |
| 30-min hard session cap vs ctrl-b's `max_session_s` bound of 7200 | LOW |
| Binds `0.0.0.0:9000`, unauthenticated Gradio UI + `/docs`, placeholder API key: LAN/tailnet-reachable | **SECURITY_MODEL check** |
| `debug` log level (~206k lines/day) and an ERROR logged on every transcription | LOW |
| RSS 3.4–3.8 GB + 1.46 GB swap with only Silero loaded (the TTL unload saves no memory, and the swap makes reloads slower) | Resource |

### 4.4 What is verified clean, or not the problem [CODE, MEASURED]

- **ctrl-b's transport encoding:** the worklet PCM16 encoding and the stateful `Pcm16Resampler` are both correct. The *content* path is clean; the *timing* path is §3.
- **The Sensitivity / dBFS reading** (A1 §14, A3 §7):
  - −21 dBFS voice against a −40 floor passes by 19 dB;
  - the auto floor = `max(N+10, V−10)` clamped [−60, −20];
  - the pin ceiling `≤ V−vm` fixed the old "pin above own voice" failure.
- **Silero the model is not indicted.** The integration is.
- **RMS without DC removal** (`pcmWorklet.ts`) is real and low priority, diagnostic only. Never change uplink samples for it.
- **Call mic readback lacks NS/AGC/channels/rate.** Dictation already logs `ns`/`agc`, so the call should reuse that pattern.
- **The level gate has a real early-call weakness.** The floor clamps at −60 until the noise tracker settles (first 5 s window), which is exactly when the pin and flap artefacts are most likely. The evening "Yeah." went through this gap.

---

## 5. Failure taxonomy — every symptom, its mechanism, and the fixing layer

| Class | Symptom | Mechanism (verified) | Fixed by |
|---|---|---|---|
| **A1** | Dictation stops ≤ 1 min, "connection lost" | K1 guard 1008 → finals>0 → `stop()` | §7.1 guard + §7.4 lifetime |
| **A2** | Dictation stops, no server line | K2 backlog close / K3 send buffer | §7.1.3 |
| **A3** | Stalls > ~5–10 s | K4 keepalive | §7.1.4 |
| **A4** | Call ends "connection had a problem" | K1 → typed protocol error → terminal | §7.1.2 (+ §7.1.5 asymmetry) |
| **A5** | Re-open gets busy | K5 slot hold | §7.1.5 |
| **A6** | Idle / 120 s / hidden stops | Policy timers | §11 P1–P3 |
| **B1** | Filler on a 0–201 ms segment | Zero-state rescan flap (grid jitter, tail dilution) | §7.2 streaming VAD (+ onset confirm) |
| **B2** | Filler on a ~3 s segment soon after a stop | The 3 s pin | §7.2 (no buffer rotation, no window) |
| **B3** | Filler right after the reply ends | Echo tail (car "Yeah.") | D80 tail hold / chirp / text backstop (shipped v1.7.10, field-unverified); not the VAD |
| **B4** | Quiet false turn passes early in a call | Level-gate floor unsettled (−60 clamp) | §7.3.4 (the early-call floor) |
| **B5** | Distant real speech (radio, passenger) | VAD is correct; proximity is the question | Level gate (unchanged); later a server pre-ASR gate |
| **B6** | Real short answer | Not a bug; must survive | Tests §9 (no lexical filters) |
| **B7** | First word clipped / answer delayed | Pin + pre-roll clamped at rotation | §7.2 (continuous pre-roll ring) |
| **B8** | Garbled or empty final on real speech | Slicing / trailing silence | §7.2.4 pre-ASR crop |

---

## 6. Design principles (the invariants the design must hold)

1. **The microphone session is authoritative; every transcription lane is a degradable consumer.** No transport or ASR failure may end a recording or a call by itself.
2. **ctrl-b owns turn semantics** (when a turn starts, ends, is transcribed, is answered). External engines answer only acoustic or lexical questions. VAD = "is this frame speech?"; ASR = "what words?".
3. **A real-time source cannot be ahead of the wall clock.** Guard *that*, with a burst allowance, not the instantaneous arrival rate on a lossy link. This is industry practice (Deepgram, AssemblyAI; L4 §2).
4. **Every stopped segment gets exactly one answer, in order.** One answer means a final, possibly empty with a `reason`. In order means FIFO per leg.
5. **One sample clock per leg** (samples received since `ready`). Segment boundaries, pre-roll, recovery and telemetry all speak it; never wall-clock reconstruction.
6. **Reuse the existing seams:**
   - batch STT through `provider_registry → ResolvedTarget → VoiceClient`;
   - VAD config in `LiveCfg` (A1 §42 is right that an in-process VAD should not be forced into a `base_url/api_key` provider shape);
   - the existing trail, pacer, ledger and wire vocabulary.
7. **Change one variable at a time.** VAD architecture, VAD model, ASR runtime and ASR model never move in the same step (A1 §62, A5 §27).
8. **Every automatic stop and every leg end carries a reason, always logged** (not only when debug is on).

---

## 7. Proposed design

### 7.1 Transport hardening (Problem A — independent of the VAD work; can ship first)

**7.1.1 The ingress guard becomes a wall-clock token bucket** [SOURCED pattern, L4 §2; derivation L1 §4]
- The clock starts **immediately before the relay sends `ready`**, never at the first frame's arrival.
- Two budgets:
  - an **audio-ms bucket**, refilled at `(1 + ε) ×` wall time (ε ≈ 2%, which absorbs phone/server clock drift: L1 shows a 0.1% drift trips a constant-slack guard within ~17 min);
  - a **frame-count twin** at `(1 + ε) / frame_ms`.
- **Capacity** = `buffered_ceiling_ms` + `BUCKET_CAP_MS` (500, the client's own; mirror it server-side) + `2·frame_ms` + **`uplink_burst_ms`** (a new bounded `LiveCfg` knob for the largest forgiven stall; default ~10 s ≥ what K4 lets live).
  - Capacity caps banked credit, so a slow sender can't hoard minutes and dump them (L1's banking hole).
- **Violation:** a legitimate client cannot exceed it (network delay only makes audio *later*). A violation is therefore a genuine client bug, and **closing with 1008 remains honest**.
  - The industry throttles instead. Here K4 kills any stall beyond capacity anyway, so a throttle path would be dead code [ruling §11 D1].
- **Tests:** the two rate tests use back-to-back "compliant" sends that fail under any wall-clock rule. They need a fake clock (precedent `test_multihome_d47.py`), plus new cases: a late burst after a stall passes · sustained 1.1× trips · banked credit is capped. The arch-invariant allowlist names `_note_frame`, so rename carefully.

**7.1.2 The call stops treating a transport artefact as terminal.**
- Once 7.1.1 lands, K1 can only fire on a real bug, so terminal is correct.
- Until then, the protocol-close path is the most common call killer. The fix order (7.1.1 first) resolves it without a client change.

**7.1.3 The client kill paths match their mode's doctrine** [CODE]
- **Dictation's post-`ready` backlog close (K2)** contradicts dictation's own LOSSLESS rule (late words are still the owner's words). The dictation ceiling should become "degrade the leg, keep recording" (see 7.4), not "close the leg". That path is the same as a dead leg once 7.4 exists.
- **The `bufferedAmount` ceiling (K3)** should be at least the relay bucket capacity for dictation.
- For **calls**, stale audio is wrong audio. The existing drop-oldest `call_backlog_ms` and the reconnect ladder remain right.

**7.1.4 Keepalive (K4).** With 7.4 in place, a K4 death in dictation costs nothing (recording continues and the suffix is recovered). For calls the reconnect ladder covers it. **Leave 5/5** unless the field shows it firing; raising it lengthens K5 slot holds.

**7.1.5 Slot takeover (K5)** [OPEN]
- A new leg from the same client should **supersede** its own previous leg instead of getting busy.
- That needs a stable client identity in `start`. `call_id`/`leg` exist, but only when the trail is on; they should be sent always, and dictation would need its own id.
- The alternative is shortening the relay-initiated close wait. uvicorn has no CLI knob for it.
- A small, separate slice; ruling §11 D5.

**7.1.6 Capture at 16 kHz (K6)** [OPEN, needs a field check]
- `new AudioContext({sampleRate: 16000})` makes the browser resample the mic, cutting the uplink to **32 KB/s (3×)**. 16 kHz is also the VAD/ASR rate, so the relay resampler becomes a no-op.
- Must verify on the owner's phone:
  - AEC/NS behaviour at that context rate;
  - the chirp (1→3 kHz, fits under 8 kHz Nyquist);
  - the barge/level-gate calibration (dBFS unchanged in principle).
- If the context rate misbehaves, decimate in the worklet with a proper low-pass. Never naive drop-sampling.

**7.1.7 Telemetry (the "cheap slice"; no behaviour change) — precisely:**
- **Relay:** one `log.info` on **every** leg end (including `_ClientGone`, a clean stop, a keepalive death, `_fail`, and the uplink-idle reaper). It carries `mode · duration · frames · audio_ms · finals · reason · close code · last_err`, and the guard names *which* budget tripped.
- **Dictation client:**
  - `onClose(code, reason)` is kept;
  - `case "error"` stores `lastError`;
  - a `StopReason` union (`user | idle | max_duration | page_hidden | socket_lost | client_backlog | send_buffer | media_error | call_handover | unmount | cancel`) is threaded into `stop()` and recorded in the existing `endTrail` record.
- **Call capture readback:** `MicReadback` gains `noiseSuppression · autoGainControl · channelCount · track sampleRate` (raw, as `echoCancellation` already is).
- **Trails:** retention is split so dictation taps cannot evict call trails (separate `keep` per mode, or keep-by-age).
- This gives **permanent** classification from `journalctl` alone.

### 7.2 The relay-owned streaming VAD (Problem B core)

**7.2.1 Model and runtime** [MEASURED, SOURCED]
- **Silero v5, run directly with onnxruntime, with persistent state.** The ONNX contract:
  - input `[1, 64+512]` (the 64-sample context carried from the previous window), `state [2,1,128]`, `sr`;
  - outputs `output`, `stateN`.
- **Do not** use the `silero-vad` pip package (it hard-requires torch).
- For the first A/B use **the exact split-v5 files Speaches uses** (faster-whisper's `silero_encoder_v5.onnx` + `silero_decoder_v5.onnx`, run encoder → decoder with carried state). The comparison then isolates the *integration*.
- The single-file v5 (tag v5.1.2) is a different export: probably near-equal, **UNCONFIRMED** bit-equal. v6 is a different model and needs retuning.
- **Cost:** 70–81 µs per 32 ms window on one thread ≈ **0.25% of a core per call**, vs today's rescan at ~0.7 of a core per call (~320×). onnxruntime releases the GIL. Run it on a single-worker executor (the LiveKit/Pipecat shape) or inline; both are safe.
- **New deps:** `onnxruntime` + `numpy` (~140 MB). cp314 wheels exist and were verified installing and running on emma's 3.14.4. This is a real dependency decision (§11 D3). Note that ctrl-b's venv has neither today.
- **State lifetime:** per leg. **Never reset mid-leg** (Pipecat's 5 s reset is the anti-pattern). Reset only on leg start.

**7.2.2 The temporal policy** (all values are sourced precedent; the corpus picks the final numbers)

| Parameter | Start value | Precedent |
|---|---|---|
| Activation threshold | 0.6 (today's) | LiveKit / sherpa 0.5, Pipecat 0.7 |
| Deactivation | act − 0.15 | Silero, LiveKit, sherpa |
| Onset confirmation | 150–250 ms of consecutive speech windows, any miss resets | LiveKit 50, Pipecat 200, sherpa 250 |
| End silence | 700 ms (`silence_ms`) | LiveKit 550, sherpa 500 |
| Pre-roll ring | 300–500 ms + the confirmation window, **continuous** (never clamped at a boundary) | LiveKit 500, sherpa ~320, Pipecat 1000 |
| Max segment | 20–30 s, then raise the threshold to 0.9 until it ends (sherpa's trick), or cut at the lowest-probability point | sherpa 20 s, LiveKit 60 s |
| Probability smoothing | Optional EMA 0.35 | LiveKit |

- There is **no buffer rotation and no 3 s window**, so the pin, grid jitter and tail dilution cannot exist by construction.
- Knobs keep their `LiveCfg` names (`vad_threshold`, `silence_ms`, `prefix_padding_ms`) plus `onset_ms` and `max_segment_s`, all bounded.

**7.2.3 The leg sample clock.** Every received sample gets an index since `ready`. Segment start and end are sample indices (pre-roll-inclusive start). They ride `speech_started`/`speech_stopped`/`transcript` as `audio_start_ms`/`audio_end_ms` **redefined on this clock**, a free redefinition because no client reads them today (L5 §0).

**7.2.4 The pre-ASR pass (ctrl-b-owned; replaces Speaches' hidden second VAD)**

For each finished segment, *before* any ASR call:
1. Run a **fresh-state batch Silero** over the segment (thr 0.5, pad 400, min_silence 160: today's parity values).
2. If it finds no speech, emit an **empty final `reason:"no_speech"`** and **skip ASR**.
3. Otherwise **crop** to `[first − 400 ms, last + 400 ms]` and **split > 30 s** at speech boundaries (sequential, joined with spaces).

**The same function serves the clip door** (`voice.stt` uploads): one owner of the "what reaches the ASR" policy for both doors. Any bare ASR host (parakeet.cpp has no guard) then becomes viable.

This is **not** a duplicate of 7.2.2. It is an independent re-judgement with bidirectional context. Its hit rate in shadow mode decides whether it stays (§9).

**7.2.5 ASR dispatch**
- Batch STT through the **existing provider seam** (`VoiceClient.transcribe`), with the segment as WAV (16 kHz PCM16).
- A **per-leg serial worker**, so transcripts come out in segment order.
- A timeout from the resolved target's `timeout_s`.
- Failure (timeout, 5xx, connection) → an **empty final `reason:"asr_error"`** for that `item_id`, plus `error{upstream_error}` for the note.
- **The leg survives.** Speaches' "an ASR failure kills the session" disappears.

### 7.3 The producer contract (what the relay must guarantee so the phone stays correct) [L5 §7, spot-checked]

The wire vocabulary is unchanged. The client reads only `type`, `item_id`, `text`, `final` (L5 §0). What must be *reproduced*:

1. **Ids:** relay-minted, unique per leg, always present. **Starts and stops strictly alternate.** A max-segment split emits `stop(A)`, `start(B)`.
2. **One answer per stop:** a final, possibly empty, with a `reason` from `short | no_speech | asr_error | quiet`. The client discards every empty final uniformly and parses no `reason`, so new reasons are free.
3. **Ordering:**
   - transcripts FIFO per leg;
   - **`transcript(n)` is emitted before `speech_stopped(n+1)`** (today's implicit Speaches guarantee, which the single-bit `waitingFinal` depends on: L5 §1.3);
   - an ordered outbox in the relay costs at most the remaining ASR time on a rare overlap.
   - **Defense in depth** (recommended, cheap): the client's `waitingFinal` becomes the set of awaited `item_id`s. The ledger already keys by id.
4. **Onset timing — the one real trade-off** (L5 §1.6, verified: accrual runs only while `m.open` is set, which starts at `speech_started` *arrival*):
   - **(ii) — RECOMMENDED: tentative start.** The relay emits `speech_started` at the **first above-threshold window** (as early as Speaches does today). If onset confirmation fails, it immediately emits `speech_stopped` + an empty final `reason:"short"`, **with no ASR call**.
     - Client timing, accrual, the noise verdict and the held-boundary race stay exactly as today.
     - A rejected transient holds the mouth only ≤ the confirmation window (~250 ms + RTT), **not** `silence_ms`.
     - Cost: in dictation, the "heard you stop" pulse may blink on a rejected transient (cosmetic). Mode-gate it by not emitting tentative starts in dictation, which ignores `speech_started`.
   - **(i) — alternative:** emit on confirmation and move client accrual onto the leg sample clock via a per-sent-frame dB ring. This is more correct long-term (it accrues the true span including pre-roll), but it is a client change and alignment work. It can come later on the same clock.
5. **Flush:** a synchronous force-endpoint of the open segment **and any tentative onset** (dictation's last short word must not be discarded), then its pre-ASR pass and ASR.
   - Optionally, an additive `state:"flushed"` after the flushed segment's final makes dictation's flat `tail_wait_ms` exact. The "no completeness marker" theorem stops being true once the relay is the producer.
6. **Mode gate:** any min-duration or `short` policy that replaces the gap cut keeps dictation exempt or proves itself harmless there (D80 ④ S11).
7. **Dial-time failure class:** an unreachable ASR host is no longer detected at the realtime handshake. Either add a preflight at `ready` (a cheap `GET /health` or a models call) or accept per-segment `asr_error` [§11 D6].
8. **Latency budget:** ASR p95 must stay well under 2 s. The echo window (4 s), dictation `tail_wait_ms` (2 s) and the mouth-wait all assume it. The model must be **resident** (no idle unload).

**What survives unchanged** (L5 §5):
- barge-in;
- the ear/tail hold, chirp and leak evidence;
- held-frame zeroing (the VAD sees silence during holds, as today);
- the echo text backstop (stops come *earlier* without the pin, which adds margin);
- the voice learner;
- the overlay;
- the idle clock;
- dictation's append path (given ordering).

**7.3.4 The early-call level-gate weakness (B4)** is separate from the VAD. The floor sits at the −60 clamp until the tracker's first 5 s window. Options:
- a conservative provisional floor from the persisted voice level V (already stored per device × EC mode) until settled;
- or the bootstrap window as the provisional floor.

A small, independent ruling [§11 D8].

**7.3.5 Deleted with Speaches** (L5 §6):
- never-commit;
- the 3200 ms flush pad and its barrier machinery;
- the gap cut and `_SegmentClock` (after shadow traces show zero saves; it cannot fire under an owned VAD whose minimum segment is ≈ onset + 700 ms);
- pre-roll adoption and its sniffing;
- the five-field `turn_detection` pin;
- the 24 kHz hop and base64 text frames;
- the realtime WS client and its `_UpstreamLost` session death;
- `tools/speaches_realtime_smoke.py` and the fake Speaches in tests.

**Kept:** the ingress guard (7.1.1), `uplink_idle_s`, the session slots, `mode`, the trail, the typed errors.

### 7.4 Dictation resilience: recording lifetime decoupled from the live leg (A2's core, with a lean mechanism)

**Rule:** a dead or degraded live leg **never** calls `stop()`.

**Mechanism** (uses the leg sample clock of 7.2.3):
- Each final carries `audio_end_ms` on the leg clock.
- The client retains the **PCM it sent since the last final's `audio_end`**: a bounded ring, of which the worklet frames already exist in memory.
- On leg death, recording continues. At release, the retained suffix (plus everything captured after the death) goes to the **existing clip STT door as WAV**. It never overlaps an appended phrase, because the boundary is sample-exact and not a text dedupe.
- **R70 rule ③ changes** from "finals>0 ⇒ stop" to "finals>0 ⇒ recover the suffix". Needs a D-entry (it reverses R70 §8).
- **Later option:** reconnect-and-continue (open a new leg, keep going).

**Before 7.2 exists** (with Speaches still the ear), the same idea works on *client* bookkeeping: retain PCM since the last `speech_stopped` arrival. It is approximate (it may re-transcribe the tail of the last phrase), so the sample-exact version is preferred and waits for 7.2.

**Also covered:**
- K2 becomes "degrade" instead of "close".
- The clip door's WAV intake depends on 7.5's host decision: parakeet.cpp is WAV-only, and MediaRecorder output is webm/ogg (see 7.5).

### 7.5 The ASR host (the Speaches replacement) [MEASURED on emma, L4 §3–4]

**Candidates, all behind the provider seam:**

| Host | Facts | Verdict |
|---|---|---|
| **parakeet.cpp `parakeet-server` v0.5.0** (MIT) | Static Linux CPU/Vulkan binaries · OpenAI multipart `POST /v1/audio/transcriptions` → `{"text"}` · binds 127.0.0.1 by default · **WAV only** · **one request at a time** · ignores `language`/`model`/`prompt`. **CPU f16: 57 ms @0.3 s, 84 ms @0.8 s, 207 ms @3 s, 625 ms @10 s**; Vulkan wins only above ~1.5 s (125 ms @3 s, 251 ms @10 s); ~1.5 GB RSS; ready in 1–2 s; f16 text matched today's fp32 byte-for-byte on 2 clips (q8 dropped commas on CPU) | **Recommended primary.** Faster than today on every call-sized clip, lighter, and trivially swappable |
| **onnx-asr sidecar** (the library Speaches uses, v0.12, MIT) | The **exact current model and bytes** (point `path=` at the existing HF snapshot) · numpy + onnxruntime only, runs on 3.14 · fp32 97 ms @0.3 s, 648 ms @10 s, 2.65 GB RSS | **The zero-model-change fallback**, and the parity reference. Keep it **out of process** (RSS and crash coupling) |
| sherpa-onnx (Parakeet v3 int8) | cp314 wheels; VAD + ASR in one wheel; **open quiet-audio mel bug #3997** (reported WER 15.2 → 7.9 % with the fix), relevant to the car | Behind the others |
| CrispASR | Exists; flags as A4 said; a large multi-engine stack | Not needed |

**Deployment consequences:**
- **Serialization.** One parakeet-server serialises the live segments *and* clip uploads. A long clip transcription (say 60 s of audio, about 4 s) would delay a live segment behind it.
  - Options: two server instances (one per door, ~1.5 GB each), or live-first priority in ctrl-b's dispatcher.
  - Recommended: **one instance per door**; RAM is ample.
- **Clip format.** Clips are webm/ogg, and parakeet-server is WAV-only. Options:
  - (a) decode in ctrl-b (PyAV or ffmpeg; check cp314 availability) inside the 7.2.4 pre-pass, which needs PCM anyway;
  - (b) send clips as WAV from the phone (the worklet PCM exists, but the non-streaming recorder path would have to adopt the worklet);
  - (c) keep an onnx-asr sidecar (it decodes via PyAV in its own env) for the clip door.
  - (a) is the cleanest single owner [§11 D4].
- **Vulkan on the 780M:** "works for Parakeet today". Pin the Mesa and parakeet.cpp versions; CrispASR documents RADV-780M crashes in other ggml ops. **CPU is the default.**
- **The model stays resident.** It is a service unit like PocketTTS's, with no idle unload.
- **Parity corpus before cutover.** Today's fp32 onnx-asr output is the reference on the owner's recorded clips (short answers, sentences, car audio, both languages the owner uses).

### 7.6 Speaches retirement consequences

- **TTS fallback #1** (Kokoro on Speaches) disappears. Choose: drop it, keep Speaches for TTS only for a while, or add another fallback [§11 D7].
- `vault-speaches` (a separate whisper machine, the STT fallback) is unaffected.
- **Interim, while Speaches still serves** (ops-only, reversible):
  - `STT_MODEL_TTL=-1` (ends the 1.7–22 s reload spikes);
  - review the `0.0.0.0:9000` bind and unauthenticated UI under SECURITY_MODEL;
  - `LOG_LEVEL=info`.

---

## 8. Audit topic ledger (A1–A5, every topic, with a verdict)

| Topic (source) | Verdict | Why / where |
|---|---|---|
| Primary VAD is Speaches' (A1 §2.1, A4 §1) | ✅ Verified | §2 |
| 3 s zero-state rescan (A1 §8, A3 §5) | ✅ Verified, and **extended** (grid jitter, tail dilution, the pin) | §4.1 |
| Public vs local fork difference (A1 §9, A3 §2) | ✅ Resolved: the deployed fork is `fd4b956` (3 patches, none touching detection) | L3 §1.7 |
| D80 gap cut is good and "keep during migration" (A1 §2.4, A3 §6) | ⚠ Partially: it keeps the migration safe, but its audio veto misses back-dated flaps (6/7 vetoed on 09-27) | §4.3 |
| Long false segments are a separate class needing field evidence (A1 §2.5, A3 §6) | ⚠ Corrected: they are **two** classes, the pin (VAD) and the echo tail (not the VAD) | §4.2 |
| Parakeet not to blame first (A1 §2.6, A3 §11) | ✅ Agreed, **plus** the missed second VAD that shields it today | §4.3 |
| Transport / resampler clean (A1 §5–7, A3 §4) | ✅ for content; ❌ for **timing**: "don't touch the transport" was wrong, the transport is Problem A | §3 |
| Mic readback lacks NS/AGC (A1 §4.2, A3 §8) | ✅ Adopt | §7.1.7 |
| RMS DC offset (A1 §5.1, A3 §9) | ✅ Real, low priority, diagnostic only | §4.4 |
| `SPEACHES_WIRE_RATE` in the generic module (A1 §6.1) | ✅ Deleted with the 24 kHz hop | §7.3.5 |
| Sensitivity/dBFS not the bug (A1 §14, A3 §7) | ✅ Verified | §4.4 |
| NS/AGC A/B before changes; no extra denoiser (A1 §15, A3 §17) | ✅ Adopt (after readback exists) | §9 |
| High-pass 80–100 Hz (A3 §18) | ⏸ Defer: measure band energy on corpus audio first | §9 |
| Failure taxonomy A–F (A1 §16, A3 §25) | ✅ Adopted and extended | §5 |
| Option 1: `min_speech_duration_ms` stopgap in Speaches (A1 §17, A3 §14) | ❌ Reject: patches a component being retired; doesn't fix the pin; risks real short answers | — |
| Option 2: repair the Speaches VAD in place (A1 §17) | ❌ Reject: invests in an unmaintained dependency; turn semantics stay external | §6 |
| Option 3/4: ctrl-b VAD + Speaches / parakeet.cpp ASR (A1 §17, A4, A5) | ✅ Adopt, staged: VAD first, host second | §7, §10 |
| Option 5: in-process sherpa-onnx (A1, A5 §12) | ⏸ Behind: open quiet-audio bug #3997, no Vulkan | §7.5 |
| Option 6/7: RealtimeSTT / CrispASR whole stacks | ❌ Reject: duplicates ctrl-b's turn ownership (all audits agree) | §6 |
| Option 8: full backend/VAD-agnostic framework (A1 §28–47) | ⚖ **Adopt the principle, not the framework.** Backend-agnostic ASR comes free via the provider seam; the VAD sits behind one small class; the canonical PCM/recovery principle (A1 §35) is adopted as §7.4. `BatchAsr`/`StreamingAsr` contracts, capability registries, endpoint-mode resolver and `AudioFormatRouter` are deferred until a second engine exists | §6, §7 |
| Persistent Silero (A3 §12, A5 §5) | ✅ Adopt; use the **split v5 files** for A/B parity | §7.2.1 |
| Onset confirmation + pre-roll mandatory (A1 §39, A3 §13, A5 §17) | ✅ Adopt, with the **tentative-start** emission (a new refinement from the L5 analysis) | §7.3 |
| Pipecat state as a template (A3 §10.1, A5) | ⚠ Corrected: Pipecat resets state every 5 s; LiveKit/sherpa are the templates | §7.2.1 |
| Vapi ~200 ms voiceSeconds, OpenAI server-VAD concepts, Deepgram Flux (A3 §10) | ✅ Consistent precedent for §7.2.2; semantic EOT deferred | §7.2.2 |
| OpenWebUI as negative precedent (A1 §48, A3 §10.4) | ✅ Agreed; nothing to adopt | — |
| No word blacklist; no logprob gate; no threshold raise to 0.9; no absolute dBFS VAD (A1 §62, A3 §23) | ✅ Adopt as hard rules | §9 |
| Layered admission; the level gate stays (A1 §41, A3 §15, A5 §10) | ✅ Client-side for now; the server pre-ASR gate needs a control frame and is deferred | L5 §2 |
| Post-ASR gate inefficiency (A3 §16) | ✅ Partly solved by the pre-ASR pass (no_speech); the energy gate server-side is deferred | §7.2.4 |
| Trailing-silence sensitivity of Parakeet (A3 §11.4) | ✅ Addressed by the crop | §7.2.4 |
| Debug WAV capture, opt-in (A1 §49.3, A3 §19.4) | ✅ Adopt as relay-side, debug-only, capped, local; SECURITY_MODEL entry required | §9 |
| Replay harness + corpus + shadow mode (A1 §50, A5 §21–24) | ✅ Adopt | §9, §10 |
| FireRedVAD challenger (A5 §6) | ⏸ Defer: the 97.57 F1 is the **non-streaming** model and the test set is unpublished | L4 §5 |
| TEN VAD (A5 §7) | ⏸ Defer: the licence has an Agora non-compete; the sherpa port zeroes pitch | L4 §5 |
| WebRTC VAD / pure RMS as the primary (A5 §8–9) | ❌ Reject | — |
| Separate VAD service (A5 §14) | ❌ Reject: in-process; 0.25% of a core | §7.2.1 |
| Streaming ASR, native EOU/EOB, Parakeet EOU 120M, dual live/final lanes (A1 §28–34, 53) | ⏸ Defer: a different product feature. The design keeps the seam open (the leg clock + the batch-final authority are exactly A1 §35's prerequisites) | — |
| Silero v6 (A5 §5) | ⏸ Later A/B; needs retuning | — |
| CPU vs Vulkan (A1 §24.2, A4 §11) | ✅ Measured: crossover ~1.5 s; CPU default | §7.5 |
| Dictation stop inventory (A2 §4) | ✅ Verified; A2 **missed** K1 (the actual cause) and K5/K6 | §3 |
| Typed stop reasons, close code, relay error (A2 §20) | ✅ Adopt, extended | §7.1.7 |
| Idle/cap/background policy (A2 §21–24) | ⚖ Owner rulings | §11 P1–P3 |
| Canonical audio cursor / live lane degradable (A2 §17–19, A1 §35) | ✅ Adopt as §7.4 (sample-exact suffix recovery) | §7.4 |
| "Good 4G ≠ healthy WSS" (A2 §8) | ✅ Confirmed dramatically: that is K1 | §3.2 |

---

## 9. Testing and acceptance

**Unit/integration (backend):**
- **The guard:** fake-clock tests (a late burst passes, sustained 1.1× trips, banked credit is capped, T0 = ready).
- **The streaming VAD:** A3's VAD-1…10, adopted verbatim:
  - one transient ≠ a segment;
  - an onset break resets the count;
  - pre-roll present;
  - short answers survive;
  - state persists;
  - end hysteresis;
  - silence ends the segment;
  - no double commit;
  - no flap storm;
  - relay protections coherent.
- **Plus:**
  - no pin: a detection starting 0.3 s after a stop ends at `speech + silence_ms`, not at 3 s;
  - pre-roll crosses the previous segment's end;
  - a tentative start with a failed confirmation → stop + empty `short`, and no ASR call.
- **The producer contract:** strict alternation · FIFO transcripts · `transcript(n)` before `stop(n+1)` · one answer per stop, including an ASR timeout and a 5xx · flush endpoints a tentative onset · dictation mode exempt.
- **The pre-ASR pass:** empty → `no_speech`, no ASR call · crop ±400 · > 30 s split · the same function on the clip door.

**Frontend:**
- The `StopReason` for every stop path (A2's STOP-1…10).
- **STOP-5 becomes the §7.4 acceptance test:** the socket dies after the first final → the recording continues → the suffix is recovered, with no duplicated text.
- If adopted, `waitingFinal` as an id set.

**The corpus + replay harness** (A1 §50, A5 §21):
- Owner-recorded, labelled audio, kept **outside git**:
  - **negatives:** quiet EV parked/moving, combustion car, HVAC, indicator, bumps, phone handling, radio, assistant TTS leak, room;
  - **positives:** yes/no/yeah/mm-hmm/okay ×20, quiet/normal/car/hesitant sentences.
- The harness replays WAVs through {today's Speaches rescan logic, the new streaming VAD} and emits JSONL per window (probability, state, start/stop).
- **Metrics in priority order:**
  1. false segments per minute on negatives;
  2. short-answer recall;
  3. onset clipping;
  4. end latency;
  5. start latency;
  6. WER after segmentation.
- **Pareto rule** (A5 §23): a change is adopted only if false turns drop materially without losing short answers.
- **The debug WAV ring** (relay-side, opt-in, capped, local, auto-expiring) feeds the corpus from real calls.

**Shadow mode:**
- The streaming VAD runs beside Speaches on the live leg, logging its starts/stops against Speaches' and submitting nothing.
- It also logs the pre-ASR pass's hit rate and the gap cut's saves.

**Field acceptance** (A3 §21, kept):
- 5 min of no-owner-speech car audio → 0 accepted false turns;
- 20× each short answer → recall ≥ 95%, no first-phoneme clipping;
- normal turns add no perceptible lag beyond the onset confirmation;
- ASR p95 < 1 s (resident model);
- **a 4G dictation session of ≥ 10 min with induced stalls → zero stops.**

---

## 10. Sequencing (each step shippable and reviewable alone)

| # | Slice | Behaviour change | Depends on |
|---|---|---|---|
| **S1** | Telemetry (§7.1.7) + trail retention split | None | — |
| **S2** | Ingress guard → wall-clock token bucket (§7.1.1) + tests | Fixes K1: the owner's actual symptom and the 07:37 call death | S1 (to see it working) |
| **S3** | Client kill paths K2/K3 per mode (§7.1.3) | Dictation stops dying on phone freezes / send-buffer | S2 |
| **S4** | Ops: `STT_MODEL_TTL=-1`, Speaches bind/UI review, log level | Ends reload spikes | — |
| **S5** | D-entry: "the relay owns the VAD; ASR is a batch provider; the leg sample clock; the producer contract; the pre-ASR pass; §7.4 recovery (R70 ③ reversal)" + owner rulings | — | review |
| **S6** | Relay streaming VAD + pre-ASR pass **in shadow** (Speaches still authoritative) + the replay harness + the corpus | None (logs only) | S5, D3 (deps) |
| **S7** | Flip authority: the relay VAD produces the events; ASR = **Speaches' HTTP door** through the provider seam (same model, so only the VAD changes). Gap cut kept, counting saves | Fixes B1/B2/B7 | S6 evidence |
| **S8** | Dictation lifetime decoupling (§7.4, sample-exact) | Fixes A1 structurally | S7 |
| **S9** | ASR host bake-off → parakeet.cpp (or onnx-asr) per door, clip decoding (§7.5); parity corpus | ASR runtime only | S7 |
| **S10** | Retire Speaches (TTS fallback decision), delete the §7.3.5 machinery, remove the gap cut if it logged zero saves | Cleanup | S7–S9 field weeks |
| later | 16 kHz capture (§7.1.6) · slot takeover (§7.1.5) · the early-call floor (§7.3.4) · client accrual on the leg clock (§7.3 (i)) · server pre-ASR energy gate · FireRed/v6 A/B · streaming ASR/EOU | — | — |

**Ordering notes:**
- S2/S3 fix the reported dictation stops **without touching the VAD**, so they can ship first and fast.
- S7 changes only the VAD, and S9 changes only the ASR runtime (principle 7).
- The owner's cadence rule applies: pause after each slice for review.

---

## 11. Decisions needed

### 11.0 Owner rulings (2026-09-28 evening, in conversation with the Opus main seat)

- **P1 — idle stop: RULED.**
  - The hands-free idle stop becomes **5 minutes** of silence (default `dictation_idle_s = 300`).
  - Allow **`0 = off`**.
  - Give it **its own quiet threshold** rather than borrowing `stt_auto_stop.threshold`.
  - The owner's context: they believed "Auto-stop OFF" meant nothing stops a recording automatically. Surface the idle stop honestly in Conf as its own setting.
  - Reminder: Tier-0 Auto-stop (3 s, push-to-talk clips) stays as is, and is already suspended during streaming dictation.
- **P2 — cap: RULED.**
  - The total-length cap becomes **30 minutes** (default `dictation_max_s = 1800`), a safety net for a forgotten mic. The owner routinely dictates 5–10+ minutes, so 2 minutes had no justification.
  - **Implementation note:**
    - The relay's `max_session_s` defaults to 1800, and Speaches hard-kills at 30 min. The cap must stay **below** the relay's session limit, e.g. by raising `max_session_s` default headroom, or the leg dies first.
    - While Speaches remains, its 30-min kill binds regardless. §7.4 recovery makes that survivable.
- **P3 — background: RULED, foreground-only.**
  - Locking the screen yourself may stop dictation; TTS surviving a lock (already the case) is what matters.
  - **Screen wake lock during dictation: ACCEPTED IF CLEAN.** Reuse or extract the call's existing `takeWakeLock` (`useLiveCall.ts:2548`), not a copy, so the phone's own screen timeout can't hide the page mid-dictation.
  - The owner confirms the 09-28 stops were **not** screen timeouts: the screen stayed on and they were talking. So the two no-line legs (11:56:11, 13:05:51) stay attributed to the K2/K3 family, pending S1 telemetry.
- **D6 — ASR unreachable: RULED.** A call **does not refuse to start**. A transient ASR hiccup must not block a call. Per-segment failure shows as "couldn't transcribe" (the empty final `reason:"asr_error"` + note).
- **D7 — TTS fallback: RULED, drop it.** The Kokoro-on-Speaches TTS fallback can be removed now; PocketTTS is stable and always on. This is a config change, to be done by an explicit ops step, not silently.
- **D8 — early-call floor: RULED YES, with a condition.**
  - Until the noise tracker settles, the floor is seeded from the remembered per-device voice level.
  - It must be **only a provisional seed**. Once the tracker has measured the room, the measured floor takes over **in either direction**.
  - The seed must never pin the floor too high for a quieter phone/route, nor linger.
- **D3 — "speech detection inside ctrl-b" at all: OWNER WANTS FABLE'S INDEPENDENT VIEW FIRST.**
  - Every agent so far (the five audits, the five lanes, this seat) converged on relay-owned VAD. The owner explicitly wants Fable to challenge that convergence and research alternatives before ruling. That includes the dependency question (onnxruntime + numpy).
  - **Fable should treat §7.2 as a proposal to attack, not a conclusion.** Candidate alternatives to weigh:
    - a VAD inside the ASR sidecar;
    - a maintained upstream realtime server;
    - a phone-side VAD;
    - a sherpa-onnx in-process stack.
- **D1, D2, D4, D5, D9, D10: deferred to the Fable review** (technical).

### 11.1 Still open

**Owner (product):**
- **P1 — the hands-free idle stop.** Follow the Auto-stop toggle, · allow `0 = off`, · or become its own setting with its own threshold? Today it silently reuses Auto-stop's threshold while Auto-stop is OFF.
- **P2 — the 120 s cap.** User-facing `0 = off`, plus a separate technical bound (30–60 min)?
- **P3 — background.** Should streaming dictation survive a hidden page (as the call does via D73 S6), or stay foreground-only?
- **D7 — TTS fallback** after Speaches: drop, keep Speaches for TTS only, or replace?

**Design (Fable review + owner):**
- **D1 — Guard violation:** close (recommended; unreachable by a legitimate client) or throttle? And the `uplink_burst_ms` default.
- **D2 — Onset emission:** tentative start (ii, recommended) or confirmed start + client accrual on the leg clock (i)?
- **D3 — Dependencies:** `onnxruntime` + `numpy` into ctrl-b's backend (~140 MB, cp314 verified).
- **D4 — Clip-door decoding** for a WAV-only host: decode in ctrl-b (recommended) · phone-side WAV · an onnx-asr sidecar.
- **D5 — Slot takeover** by client identity vs the status quo.
- **D6 — ASR reachability:** a preflight at `ready`, or per-segment `asr_error` only.
- **D8 — Early-call level-gate floor** (B4).
- **D9 — The client `waitingFinal` id-set** as defense in depth (recommended), on top of relay ordering.
- **D10 — Keep or drop the pre-ASR pass** after shadow data (keep by default: parity with today's ~21%).

**Questions specifically for Fable to stress-test:**
- Is the tentative-start scheme (7.3 (ii)) free of held-boundary or barge interactions that L5 did not see?
- Does the token bucket's capacity interplay with K4's 5+5 keepalive leave any window where a legitimate stall trips K1 but not K4?
- Is sample-exact suffix recovery (7.4) sound when the client pacer dropped frames (call mode never uses it, but check the dictation pre-`ready` degrade path)?
- Does per-door parakeet-server serialization plus a per-leg serial ASR worker bound live latency under a concurrent long clip?

---

## 12. Corrections log (what earlier readings got wrong)

**This file's first draft (2026-09-28 am):**
- "Appends queue behind every Parakeet call": **wrong**. Each event is its own task (L3 W1).
- "Speaches' realtime append loop blocks on transcription": **wrong**, same reason.
- "ctrl-b already moved TTS off Speaches": **partial**. Kokoro on Speaches is TTS fallback #1.
- "(15 others) flush-ended": **18**; plus 4 legs with no relay line.
- "Re-open 10–30 s later": the actual gaps are 70 / 11 / 30 / 32 / 15 s.
- "The guard measures arrival time": more precisely **read time**, which includes relay loop stalls.
- "A ~2 s stall trips it": true in steady state; **~1 s** during dictation's post-`ready` drain.
- "Slack = handshake buffer + skew": it must add the client bucket cap and frame granularity, **skew must be a rate term**, T0 = ready, and credit must be capped.
- "The pin may explain both classes": **partly**. The pin explains "Mm-hmm." and the evening "Yeah."; the car "Yeah." is the echo tail.
- "Whether any call died is unproven": 07:37:06 was **very likely a call**.
- The pin mechanism is stronger than stated: in a fresh buffer stop ① is also impossible (a deterministic prefix).
- The main seat's own mid-session doubt about the host ("the Ryzen may be wrong") was wrong. emma *is* the Ryzen 7 8745HS / 780M, as the owner said.

**The external audits:**
- **All five missed** the actual cause of the dictation stops (K1) and the hidden second VAD.
- **A1/A3:** advised "don't touch the transport" (it is Problem A); called long segments an unexplained separate class (they are the pin plus the echo tail).
- **A2:** covered backpressure ceilings but not the relay guard, the keepalive or the slot hold.
- **A5:** "Pipecat carries state" (it resets every 5 s); promoted FireRed Stream-VAD on non-streaming numbers.
- **A1/A4:** Windows/PowerShell framing for a Linux host.
- **A4:** claims about parakeet.cpp, CrispASR and sherpa-onnx substantially **held** (L4).
