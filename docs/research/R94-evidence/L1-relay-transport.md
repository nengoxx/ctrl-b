# Lane 1 — live-voice transport audit (relay rate guard, R94 §2)

Revision read: working tree @ `778b960` (prod runs `v1.7.10`, same relay code). Read-only. Prod facts: `~/.ctrl-b/config.yaml` `voice.live` overrides only `dictation: true, mic_hold: on, debug: false` (so every relay cap is the default, and **no call trail exists for today**). Prod unit: `uvicorn … --ws-ping-interval 5 --ws-ping-timeout 5`, uvicorn 0.48 + websockets 16.1 → the **legacy** `websockets_impl` (max_queue 32, close_timeout 10 s). Path: phone → Tailscale → **Tailscale Serve** (`https://emma…ts.net` → `proxy http://127.0.0.1:5433`, TLS terminated in tailscaled, Go reverse-proxy copy loop) → loopback TCP → uvicorn. That is why the access log shows `100.64.151.87:0` (X-Forwarded-For, port 0).

## VERDICT

**R94 §2's mechanism is CONFIRMED by the code, with two corrections that matter for the fix:**
1. The guard's clock is not even network arrival. It is the moment `_pump_client` pulls the message off uvicorn's queue (`voice_live.py:672` → `:677` → `_note_frame` `:772`). Anything that delays reads, including network bunching (TCP, Serve's proxy loop, or 4G) and server event-loop stalls, turns into a burst. The client pacer cannot prevent any of these.
2. The headroom is **not uniformly "~2 s of stall"**. Right after `ready`, dictation drains its handshake backlog at 1.5×. That uses 3000 of the 4040 ms window allowance, so for ~2 s after `ready` a **~1.0 s** compression trips the guard. This is the best explanation for the 4 s kill (§1.6).

**The proposed invariant is the right statistic.** As R94 states it, it is under-specified in four ways (slack terms, drift, T0, unbounded banking) (§4). **Two sibling client-side kill paths produce the identical owner symptom, and neither appears in the server log** (§5 D1). After the guard fix they become the leading suspects. **The 07:37:06 kill was probably a CALL, not dictation** (§3).

---

## 1. Relay receive path, end to end (`backend/app/services/voice_live.py`)

### 1.1 Lifecycle
- **Route.** `api/voice.py:231-294`. Origin check, then the feature gate, then `accept()` (`:271`), then `slots.acquire(max_sessions=1)` (`:272`; busy → typed error + 1013). Then `LiveRelaySession.run()`, with `slots.release()` in the route's `finally` (`:294`).
- **`run()`** (`:419-458`). Everything runs under `asyncio.timeout(max_session_s=1800)`, in this order:
  - `_handshake_client`: reads ONE message under `start_timeout_s=5` (`:462-476`), `_parse_start` `:478-512`.
  - `_dial_upstream` (`:526-548`).
  - `_configure_upstream`: waits for `session.created` under `policy.timeout_s`, sends the one `session.update` (`:566-618`).
  - sends `state: ready` (`:431`).
  - `_pump` (`:432`).
  - on a clean end: `ended` plus close 1000 (`:433-434`).
- **The relay does not read the client socket at all between `start` and `ready`.** Binary frames sent in that window would queue in uvicorn (legacy `max_queue=32`, then TCP backpressure) and burst at `_pump` start. **Nothing counts them before `ready`.** `_recent_frames` starts empty (`:415`), and `_note_frame` is reachable only from `_pump_client` → `_accept_audio` (`:677`, `:740`). The client now drops pre-`ready` audio at the door (`liveSocket.ts:161`, `:192`, `:206`, the R86 LC-5 latch), so **no pre-ready frame reaches the relay today.**
- **`_pump`** (`:622-651`). Three tasks under `FIRST_COMPLETED`:
  - The client reader.
  - The uplink leg (queue → Speaches, `:696-708`).
  - The downlink leg (`:710-713`).
  - The queue depth is `max(1, relay_queue_ms // frame_ms)`, which is 2000 // 40 = **50 frames** (`:636-637`).

### 1.2 `_accept_audio` (`:717-750`), per binary frame, in order
1. Byte cap: `max_frame_bytes` (32768), over it → `_ProtocolError` (`:727-730`).
2. Duration: `ms = len/2/client_rate*1000` (`:732`). The cap is `FRAME_MS_TOLERANCE (2.0) × frame_ms` = 80 ms (`:733-739`).
3. `_note_frame(ms)` (`:740`). This runs **before** resample/enqueue, so the guard is independent of Speaches' speed.
4. `_audio_seen = True`, resample to 24 kHz (`:744-749`), then `_enqueue(drop_oldest=True)` (`:750`).

### 1.3 `_note_frame` (`:752-788`), both budgets
- `now = time.monotonic()` is taken **at read time**. Entries older than `now − 2.0` are dropped from the deque (`:772-776`).
- **Count budget.** `frame_allowance = int(2 × 1000/frame_ms × 2.0)` = **100**. The guard trips when `len(deque) > 100`, i.e. on the **101st** frame (`:769-782`).
- **Ms budget.** `ms_allowance = 2 × 2.0 × 1000` = **4000**. The guard trips when `sum(ms) > 4000` (`:783-788`).
- For 40 ms frames both budgets trip on the same 101st frame (101 × 40 = 4040 > 4000). The count check runs first (`:777`), so **the logged message is always "frame rate", whichever budget was the "real" one.** The ms message can only appear for over-long frames.

### 1.4 What `_ProtocolError` does
- `run()` catches it (`:435-436`) and calls `_fail("protocol", str(exc), 1008, "protocol error")`.
- `_fail` (`:1101-1105`) does three things:
  - `log.info("live voice: session ending — protocol (<msg>)")` — the only journal line; it carries no mode, duration or frame count;
  - sends the downlink `{"type":"error","code":"protocol","message":<msg>}`;
  - calls `_close(1008, "protocol error")` (`:1107-1119`), which writes a `leg_end` trail note only if debug is on.
- `finally` → `_close_upstream` (`:1153-1163`, **no commit**, correctly) → trail flush → the route releases the slot.
- **Slot-hold subtlety (new).** `_close` awaits `ws.close()`. uvicorn legacy (`websockets_impl.py:319-322`) calls websockets `close()` (`legacy/protocol.py:748-770`). That waits up to `close_timeout` = **10 s** for the client's close frame.
  - Its `transfer_data_task` **blocks while 32 unread inbound messages sit in the queue** (`protocol.py:947-956`), because the relay stopped reading at the trip.
  - So a trip in the middle of a big burst (or on a link with a standing uplink queue) holds the only `max_sessions` slot for up to 10 s.
  - Journal: the 13:11:03 kill is followed by "connection closed" at **13:11:13**; the other four closed within the same second.

### 1.5 Queue, pacing toward Speaches, flush, idle, limits
- **`_enqueue`** (`:790-829`). Mic frames use `put_nowait`, and on a full queue the oldest frame is evicted, with `task_done` for the evicted item (`:813-821`). One `degraded` frame goes down per burst (`:824-827`). **There is no pacing toward Speaches.** The uplink leg sends as fast as the websockets client's write buffer drains (`:699-708`, `_send_up_raw` `:1075-1083`).
  - The kernel loopback buffers absorb MBs, so in practice a burst reaches Speaches whole and the relay queue rarely overflows.
  - **Zero `overflow` or `degraded` warnings in today's journal**, which rules out Speaches slowness as a factor: the guard runs before the queue anyway.
- **`_flush`** (`:831-882`). It pads constant silence: `max(3000, silence_ms) + 200` ms = 3200 ms, generated relay-side and enqueued with `drop_oldest=False`. **It never passes through `_note_frame`** (the exemption at `:766-767`). It then joins the queue as a delivery barrier (`:882`). While joining, the client reader is parked, so client frames pile up in uvicorn.
  - Harmless today: dictation stops its uplink **before** sending `flush` (`useDictation.ts:780`), and the call never flushes (no `.flush(` socket call in `useLiveCall.ts`).
  - **Latent:** any future client that keeps streaming after a flush would burst on resume.
- **`uplink_idle_s=15`** (`:667-679`). The deadline resets on every accepted frame and after a flush. On expiry it raises `_UplinkIdle` → `session_limit`, close **1000** (`:443-446`).
- **Session limits.**
  - `max_session_s=1800` → `TimeoutError` → `session_limit`, 1000 (`:441-442`).
  - `start_timeout_s=5` → protocol (`:469-473`).
  - Upstream: `session.created` must arrive within `policy.timeout_s` (`:590-600`).
- **Client gone.** `_recv_client` turns `websocket.disconnect` (or a RuntimeError) into `_ClientGone` (`:1036-1048`), which **`run()` swallows with no log** (`:447-448`). The same applies to uvicorn's keepalive-ping death (1011): websockets logs "keepalive ping timeout" at debug level only.

### 1.6 How can a leg trip only ~4 s after accept (14:08:16 → 14:08:20)?

Candidate mechanisms and whether the code permits each:

| Mechanism | Permitted? | Notes |
|---|---|---|
| Relay reads a pre-`ready` backlog in one burst | **No** (today) | The client latch drops pre-ready audio (`liveSocket.ts:161/192/206`). This was the pre-LC-5 bug. |
| Client pre-ready buffering drained after `ready` | **Yes; this cuts the headroom** | Dictation buffers ≤ `buffered_ceiling_ms` (1000) pre-ready (`useDictation.ts:1102-1110`). It resets the bucket to 0 at `ready` (`:958-963`), then drains at 1.5× (`:1119-1120`). The rolling window sees ≤3000 ms per 2 s during the ~2 s drain (vs 2000 steady). **Headroom to 4040 falls from 2040 ms to ~1040 ms.** |
| TCP / Serve / 4G bunching after `send()` | **Yes** | This is the mechanism R94 names. The pacer bounds only `ws.send()`. |
| Worklet MessagePort burst (main-thread stall) | **Yes at the port, no on the wire** | Metered by the wall-clock bucket (`uplinkPacer.ts:101-115`): at most 500 + 1.5 × 2000 = 3500 ms per 2 s is sent. A stall > ~1.5 s instead kills the leg **client-side** (§5 D1a). |
| Relay-side event-loop stall | **Yes** | The clock is read time (§1.3), so a ≥2 s loop block bunches reads with a perfect network. No evidence either way today. |
| Relay flush-join backlog | Not today | See §1.5. |

**Arithmetic for the 4 s kill.**
- Let S(t) be the audio sent by t seconds after `ready`, with a pre-ready backlog B = 1000. Then S(t) = 1.5t for t ≤ 2, and t + 1 after that.
- If the link holds from `ready` until D and then releases, the window (D, D+2] contains S(D+2). That exceeds 4.04 once D > **1.04 s**, and the trip lands at t ≈ 3.04 s after `ready`.
- Accept → `ready` is ~0.1–0.5 s, so the kill lands ≈ 3.2–3.6 s after accept. **That is the observed 4 s.**
- With B ≈ 0, the stall needed is D > 2.04 s and the trip lands at ≥ 4 s after ready. That is also consistent.
- The kill needs *some* network compression either way. The 4 s timing does not by itself distinguish B = 1000 from B ≈ 0.

**Steady state.** With the client at 1× and an empty backlog, a stall of D delivers 25·D frames at once. The worst window (burst plus the next 2 s) holds 25·(D+2), which is > 100 iff **D > 2.04 s**. That confirms R94's "≈2 s", **for steady state only.**

---

## 2. Client side

### 2.1 `lib/uplinkPacer.ts`
- The bucket earns `DRAIN_PACE=1.5` × wall-clock ms (`:40`) and is capped at `BUCKET_CAP_MS=500` (`:48`). `accrue` is at `:101-105` and `pump` at `:109-115`.
- **Send-side bound confirmed.** Over any 2 s window, sent ≤ 500 + 1.5 × 2000 = **3500 ms**, i.e. 87.5 frames, against the relay's 4000 ms / 100 frames. Frames are exactly `frame_ms` long: the worklet frame is `round(sr × frame_ms / 1000)` samples (`pcmCapture.ts:456`), which is 1920 samples @48k and 1764 @44.1k, both exactly 40 ms at the relay (`voice_live.py:732`).
- `newPacer` starts with an empty budget (`:65-67`). `enqueue` is lossless (dictation, `:73-75`). `enqueueBounded` drops the oldest past `call_backlog_ms` (the call, `:84-99`).

### 2.2 `hooks/useDictation.ts`
- **Arming.** `armDetector` (`:1157`) arms the hidden-page stop when `autoStopOn || streamWanted` (`:1179-1185`). The stream opens only when the context runs, a worklet exists, and the owner has not yet released (`:1244-1247`).
- **`armStream`** (`:917-1143`):
  - opens the socket with `mode:"dictation"` (`:943-952`);
  - on `ready`, sets `s.ready = true` and zeroes the bucket (`:958-963`);
  - on `ended`, closes the socket (`:964-967`);
  - **ignores the typed `error`** (`:994-997`).
- **Worklet `onFrame`** (`:1087-1126`):
  - `goLive` fires on the first frame (`:1090-1096`);
  - every frame is enqueued (`:1102`);
  - **pre-ready:** degrade when `backlog × frameMs > ceilingMs` (`:1105-1110`);
  - **post-ready:** `accrue` then `pump` (`:1119-1120`), then **`s.socket.close()` when `backlog × frameMs > ceilingMs`** (`:1125`).
- **`onClose`** (`:1000-1044`). The signature takes no arguments, so the code and reason are discarded.
  - `finishing` → dead, wake the tail, toast if finals > 0 (`:1003-1020`);
  - `!ready` → `degradeStream`, the once-per-page toast (`:1022-1026`);
  - `finals === 0` → `dropStream` silently; the recording continues on the clip (`:1028-1033`);
  - otherwise → dead, stop the uplink, `LIVE_LOST_MSG`, `stop()` (`:1035-1043`). **This is the symptom.**
- **`finishStream`** (`:775-909`):
  1. Stop the uplink (`:780`).
  2. If the backlog is non-empty, drain it with the same bucket, bounded by `ceilingMs/1.5 + 50` ms, else mark the leg dead (`:789-813`).
  3. `flush()`, then wait the flat `tail_wait_ms`, woken early only by a delivered close or by the page hiding (`:844-869`).
  4. `stop()` (`:869`), then **`close()` immediately** (`:888`).
  5. The either/or (`:897-906`).
- **Clocks.** On the 100 ms poll: the cap `dictation_max_s` (`:1271-1275`) and the hands-free idle stop (`:1280-1288`).

### 2.3 `lib/liveSocket.ts`
- `start` goes out on `onopen` (`:172-183`). The ready latch is at `:161` and `:192`.
- **`sendAudio`** drops while not `ready` or not OPEN (`:206`). It closes with **4000** when `bufferedAmount + byteLength > ceiling` (`:212-214`), where `ceiling = buffered_ceiling_ms × sampleRate × 2` bytes (96 000 B @48k, `:88-90`).
- `onclose` passes `(e.code, e.reason)` (`:195-199`), so R94 §5.2 is right that the plumbing exists.
- `flush` and `stop` are TEXT frames (`:166-170`). `_note_frame` counts only binary frames.

### 2.4 Can any client path send faster than the pacer?
**No.** Audio reaches `ws.send(buf)` (`liveSocket.ts:216`) only through `sendAudio`. The only callers of that are:
- `pump` for live dictation (`useDictation.ts:1120`);
- `pump` for the dictation release drain, which is the same bucket, so its first pump can spend at most the banked 500 ms (`:797-798`);
- `pump` for the call (`useLiveCall.ts:2685`).

Controls are text. The handshake backlog leaves through the same FIFO and bucket. **The send-side bound (≤3500 ms/2 s) holds on every path.** One caveat is not a violation: after `ready` the dictation client deliberately runs at 1.5× for up to ~2 s. That is legal, but it spends most of the relay's headroom exactly when a fresh 4G/TCP connection is least settled.

---

## 3. The CALL path (`hooks/useLiveCall.ts`)
- **Pacer.** A fresh `newPacer()` per leg (`:2423`). It uses `enqueueBounded(call_backlog_ms)`, then `accrue` and `pump` through `socket.current?.sendAudio` (`:2672-2685`). Pre-`ready` frames are pumped and dropped by the latch. The budget is **not** reset at `ready`, so the call can open with ≤500 ms banked, but its backlog is near-empty.
- **Reaction to the 1008 kill.** The relay sends `error{protocol}` first. That goes to `serverError`, and `case "protocol"` calls `terminal(s, "error", CALL_COPY.protocol)`, which shows "the connection had a problem" (`:1332-1337`, copy `:364`). **The call ENDS. There is no reconnect and no degrade.** The following close is dropped by the terminal guard (`onClose` → `socketLost` only while live, `:2502-2507`).
- **Asymmetry (defect).** The *same* network hiccup reaches the call in one of two ways:
  - as a relay 1008, which is terminal;
  - as a client 4000 or a keepalive 1006, which goes to `socketLost` and the reconnect ladder `[400,900,1800,3000,4000,4000]` (`:177`, `:920-944`).
- **Could today's kills have been calls? Yes, at least one probably was.**
  - Calls never send `flush` (no socket `.flush(` in `useLiveCall.ts`), so every "flushing" line is dictation.
  - Calls POST `/api/agent/chat` per turn *during* an open leg.
  - The **07:38:16** leg lived 70 s with no flush, carried chat POSTs at 07:38:27 / 07:38:41 / 07:39:20 plus TTS, and closed at 07:39:26 with no relay line. That is a call's shape.
  - The **07:36:17** leg, the first kill (07:37:06), had a chat POST at **07:36:26** mid-leg and no flush: the same shape. **The 07:37:06 kill was probably a call.**
  - The other four kills (08:10:18, 13:11:03, 13:12:06, 14:08:20) have no mid-leg chat POST, and each is followed by a flush-ended leg. That is consistent with dictation.
- **Can the relay log distinguish?** Yes. `self._mode` is set in `_handshake_client` (`:474`) *before* any `_ProtocolError` from `_pump`, so `_fail` can log it. Today it does not (`:1103`).

---

## 4. The proposed invariant (R94 §2.4)

**What the guard protects** (docstring `:757-763`): per-message CPU (base64 plus a synchronous Silero pass on Speaches' loop per append) and audio throughput.
- A cumulative invariant `audio_ms_rx ≤ (now − T0)·(1+ε) + slack_ms`, with `frames_rx ≤ (now − T0)/frame_ms·(1+ε) + slack_frames`, **preserves the sustained bounds**: long-run ≤ realtime and ≤ nominal message rate. That is also closer to D71's text: "*sustained* excess over ~2× nominal" (`LIVE_VOICE_PLAN.md:151`).
- It **gives up the burst-intensity bound.** A late burst of D seconds reaches Speaches as ~25·D back-to-back appends. The relay queue will not shave it, because loopback kernel buffers absorb it (§1.5). The cost is bounded CPU catch-up, not unbounded.

**T0 (leg start).** Take it on the relay **immediately before sending `ready`** (`:431`). Never anchor on the first frame's arrival: a stall at leg start would move T0 late, and the catch-up would then read as a flood. T0 = accept/start also works but is looser by the handshake duration (up to `connect_timeout + timeout_s`).

**What `slack` must cover** (the audio a legitimate client can deliver ahead of the relay's T0):
1. **The dictation pre-ready backlog:** ≤ `buffered_ceiling_ms` of *delivered* frames (`useDictation.ts:1109`).
2. **Frames captured before `ready` but delivered by the MessagePort after it.** This is a main-thread stall spanning `ready`. The bucket then spends up to `min(BUCKET_CAP_MS, 1.5·L)` before the post-ready ceiling check (`:1125`) would close the leg. So add **`BUCKET_CAP_MS` (500, a client constant the server doesn't see)**.
3. **Frame granularity:** 1–2 × `frame_ms`.
4. **Clock drift.** The phone's audio clock versus emma's monotonic grows with elapsed time, so it must be a **rate term (1+ε), not a constant**. At a 1000 ms slack, a 0.1 % fast audio clock trips after ~17 min, which is within a 30 min call. ε ≈ 1 % costs nothing against a real flood.
5. **The call adds nothing beyond this.** Pre-ready audio is dropped, and the backlog is ≤ `call_backlog_ms` but is drained, not banked.

So slack ≈ `buffered_ceiling_ms + 500 + 2·frame_ms` (≈1580 ms at the defaults), read from `cfg` on the relay (`LiveCfg` already carries `buffered_ceiling_ms`). The count slack is the same figure divided by `frame_ms`. **R94's "slack = handshake buffer + clock skew" misses item 2 and treats skew as a constant.**

**Ways a legitimate client could still exceed it:**
- (a) Drift without the ε term.
- (b) A Conf `frame_ms` change racing a leg. The client uses the `/voice/status` it fetched earlier (`useDictation.ts:424`), while the relay snapshots at session start. Smaller client frames would violate the **count** invariant at 2× (the current guard has the same edge).
- Nothing on the network can deliver audio *early*, so bunching can never violate it.

**Hole in R94's statement: unbounded banking.** A client (buggy or hostile, tailnet-only) that runs below realtime for minutes accumulates credit. It can then dump it at once, up to ~30 min of audio. R94's "a flood violates it within one slack's worth" is true only from a fresh leg.
- The fix is to cap the credit: a real token bucket, rate 1+ε, capacity `slack + max_catchup`.
- `max_catchup` has no natural derivation, because a congested-but-alive link can go more than 12 s behind in a 120 s dictation. It should be a bounded config knob, or be explicitly ruled unnecessary for a single-user tailnet. **This needs a ruling.**
- Side seam: `(now − T0) − audio_ms_rx` *is* a lateness estimator. A call-mode policy could drop stale audio relay-side with it, mirroring `call_backlog_ms`. Today late call audio after a stall is forwarded to the ear (the pre-existing behaviour).

**Degrade or close.** Under the invariant a legitimate client cannot violate it, except for the drift and `frame_ms` edges above. So a violation is a genuine client bug, and **closing (1008) stays honest**. The damage of a false positive is the call's terminal (§3), so the ε term and the correct T0 matter more than the choice between degrade and close.

**Survivable stall after the fix is ~5–10 s, not unbounded.** uvicorn pings every 5 s with a 5 s timeout. The phone's pong queues **behind** its own buffered audio on the uplink, so a longer stall or standing queue dies as 1011/1006. The relay logs nothing for that; the call reconnects, and dictation with finals takes the late-death stop.

**Tests and prose pinning current behaviour:**
- `backend/tests/test_voice_live_s1.py:368-406` (`test_frame_rate_ceiling_closes_a_flood_but_not_a_compliant_client`). Its "compliant" half sends **60 frames back to back** (2400 ms at elapsed ≈ 0) and expects a clean 1000. **That fails under slack ≈ 1580.** The flood half asserts `"frame rate"` in the message.
- `:409-433` (`test_the_audio_rate_ceiling_…`). The "compliant" half sends **50 × 40 ms = 2000 ms instantly**, which also fails. The flood half asserts `"audio rate"`.
- Both need a fake clock (monkeypatch `voice_live.time.monotonic`; precedent `test_multihome_d47.py:323-324`). Then they need new cases: a late burst after a stall passes, sustained 1.1× eventually trips, and credit is capped (if ruled).
- `backend/tests/test_arch_invariants_prompts.py:145` allowlists `LiveRelaySession._note_frame` **by name** as a protocol-error-text site. A rename breaks it.
- Frontend: these restate the rolling-window math. They would still pass but would pin a dead contract:
  - `frontend/tests/lib/uplinkPacer.test.ts:99-102`, which asserts `500 + 1.5×2000 < 4000`;
  - `frontend/tests/hooks/dictationStreaming.test.ts:456-570` (`RELAY_WINDOW_MS`, `RELAY_MS_BUDGET`);
  - `frontend/tests/lib/liveSocket.test.ts:126` (comment).
- Prose to update:
  - `voice_live.py:55-56`, `:118-122`, `:721-723`, `:752-767`;
  - `uplinkPacer.ts:9-15`, `:31-47` (`DRAIN_PACE`'s justification is the rolling window);
  - `liveSocket.ts:155-160`;
  - `useDictation.ts:77-82`, `:1112-1118`;
  - `useLiveCall.ts:2630-2637`;
  - `LIVE_VOICE_PLAN.md:151`, `:985`.

---

## 5. Other defects that can stop dictation or a call mid-session

**D1 — Two client-side kill paths with the SAME owner symptom, and no server log line (HIGH; next suspects once the guard is fixed).**
- **(a) Post-ready backlog close** (`useDictation.ts:1125`).
  - After a main-thread freeze of L ms, the MessagePort dispatches L of frames in one tick. The bucket can spend only `min(500, 1.5L)`, so the backlog exceeds 1000 once **L > ~1.5 s**.
  - The result is `socket.close()`, then `onClose`, then (with finals > 0) `LIVE_LOST` plus `stop()`.
  - This contradicts dictation's own LOSSLESS doctrine (`uplinkPacer.ts:18-22`). Late dictated words are not "stale speech" the way they are in a call. The rationale at `:1121-1124` is call-thinking.
- **(b) `bufferedAmount` ceiling** (`liveSocket.ts:212`), 1 s of audio. It rises once the phone's TCP send buffer is full during a radio stall or throughput deficit, and closes with 4000. Same stop.
- **(c) Keepalive ping (5 + 5 s)** kills stalls longer than ~5–10 s (see §4).
- **Journal:** 27 legs today. Of these, 5 were protocol kills and **18** were flush-ended; **R94's "(15 others)" is wrong**. **4 legs have no relay end line at all:**
  - 07:38:16: call-shaped;
  - 11:56:11 (39 s) and 13:05:51 (30 s): no flush, **no `/api/voice/stt` clip upload** (there are none all day), then a manual `/api/agent/chat` 14–20 s later. That is exactly the signature of a client-side kill-with-finals (or a cancel);
  - 14:00:22 (2 s).
- These cannot be told apart without the R94 §5.2 client stop reason and a relay end line.

**D2 — The call treats a transport artefact as terminal (MED).** A relay 1008 ends the call (`useLiveCall.ts:1332-1337`), while a 4000/1006 death reconnects (§3). Until the guard is fixed, every 4G stall longer than 2 s ends the call outright.

**D3 — Relay-initiated close holds the only slot for up to 10 s (LOW–MED).** See §1.4 (legacy `close_timeout` 10 s, plus `transfer_data` blocking on the full `max_queue=32` once the relay stops reading). Evidence: 13:11:03 → 13:11:13.
- A re-open inside that window gets **busy (1013)**.
- For dictation that goes to the pre-ready `degradeStream` plus the "Live dictation unavailable" toast.
- For a call, a first dial goes to the terminal "busy" (`useLiveCall.ts:1309`) unless the priorLeg marker is set.
- uvicorn has no CLI knob for `close_timeout`.

**D4 — Uplink bitrate is 2× what the ear needs (MED, contributing).**
- The worklet ships at `ctx.sampleRate`. That is typically 48 kHz on Android: **96 KB/s ≈ 0.77 Mbit/s** before WS, TLS, WireGuard and Serve overhead.
- The relay immediately downsamples to 24 kHz (`voice_live.py:476`, `:747`).
- On 4G, a throughput deficit creates a standing queue. It drains as a burst (the guard), fills the send buffer (D1b), and delays pongs (D1c).
- Client-side decimation to 24 kHz (or 16 kHz) halves or thirds every one of those risks.
- The phone's actual rate is unverified: the trail's `rec.rate` would show it (`useDictation.ts:1077`), but debug is off in prod.

**D5 — Telemetry gaps (confirms R94 §5.1/§5.2, plus four more):**
- `_ClientGone` and a clean `stop` log nothing (`:447-448`);
- the keepalive-ping death is logged at debug only;
- the count check always masks the ms message (§1.3);
- `onClose` drops the code (`useDictation.ts:1000`) and the typed error is ignored (`:994-997`).

**D6 — Benign log noise.** The 08:13:54 `ERROR:asyncio:ConnectionClosedOK exception in shielded future` is legacy websockets at close, most likely a pending keepalive pong waiter (`legacy/protocol.py:845`, `:1426`). It is made likelier by the release sending `stop` then `close()` synchronously (`useDictation.ts:869`, `:888`), which always races the relay's own `ended` plus 1000 close. **Not a kill.**

**D7 — Latent flush backlog.** `_flush`'s join parks the client reader (§1.5). It is safe only because both clients stop streaming before or without a flush. Worth pinning in a comment or test if the fix touches this area.

---

## 6. R94 §2 corrections (summary)

| R94 claim | Status |
|---|---|
| Rate guard on "arrival" time | Correct in effect. More precisely it is **read** time (`:672`, `:772`), which also counts relay loop stalls. |
| "A stall of ~2 s or more" trips it | **Steady state only.** Within ~2 s of `ready`, dictation's 1.5× drain leaves ~1.04 s of headroom. That fits the 4 s kill. |
| Bytes in flight "no longer counted by `bufferedAmount`" | Only until the phone's send buffer fills. Then `bufferedAmount` rises and the **client** closes with 4000 (D1b). That kill is invisible to the relay log. |
| "(15 others) flushing" | **18** flush-ended legs, plus **4** with no relay end line (§5 D1). 27 total. |
| "Every kill … re-open 10–30 s later" | Re-open gaps are 70 s (07:37 → 07:38:16), 11, 30, 32 and 15 s. |
| §2.3 "unproven whether any call died" | Journal shape says **07:37:06 was probably a call** (§3). |
| §2.4 slack = handshake buffer + skew | Add `BUCKET_CAP_MS`/MessagePort lag and frame granularity. Skew must be a **rate** term. T0 must be ready-send, not first-frame. **Credit must be capped**, or banking permits a later flood. |
| §2.4 "tighter than today's 2× bound" | Only from a fresh leg. Without a credit cap, it is looser after banking. |
| After the fix, a late burst "never violates it" | True for the relay guard, but stalls longer than ~5–10 s still die by keepalive ping, and D1a/D1b still kill client-side. |
