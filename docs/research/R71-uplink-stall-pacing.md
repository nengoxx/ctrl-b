# R71 — The uplink after a main-thread stall: what shipped realtime-voice clients do with the burst

**Date:** 2026-09-15
**Status:** Draft dossier — complete for the bounded question. Nothing is built; not a decision.
**What drove it:** S3.5 shipped a wall-clock token bucket on the DICTATION uplink
(`useDictation.ts` `DRAIN_PACE 1.5` / `BUCKET_CAP_MS 500`, lossless unbounded FIFO) because the
relay enforces a 2×-realtime rolling budget (`voice_live.py` `RATE_WINDOW_S 2.0` /
`RATE_MULTIPLIER 2`). The live CALL uplink (`useLiveCall.ts` `onFrame` → `socket.sendAudio`) still
ships raw and trips that budget after a >2 s stall. Routing the call through the same bucket is
settled; **the open question is only the BACKLOG DISCIPLINE for a live conversation.**
**Drove:** (open) — the S4-adjacent call-uplink slice.
**Reference class:** the realtime-voice client class the brief names (OpenAI reference clients,
LiveKit, pipecat, Deepgram, AssemblyAI, WhisperLive) plus our own reference project RVC. The
agent-chat peers (open-webui, LibreChat, AnythingLLM) have **no streaming uplink at all** — whole-clip
upload, already dissected in R70 §2.2–2.3 and not re-bought here.
**Confidence:** **[V]** = source read at the pinned ref · **[R]** = secondary/doc · **[U]** = not checked.

---

> ### Headline — three findings, one of them uncomfortable
>
> **① NOT ONE shipped WebSocket voice client paces its uplink. [V, 7 of 7]** Every one reads
> "chunk ready → `socket.send()` now". The burst-on-resume is shipped as fast as the socket takes
> it. Our token bucket has **no field precedent** — and §2.2 says why that is fine rather than
> wrong: **no other server punishes a burst.** OpenAI documents no input rate limit (only "*Each
> chunk cannot exceed 15 MB*") [R]; Gemini Live documents none [R]; AssemblyAI's only bound is
> per-MESSAGE duration, not rate [V]. Our relay's rolling 2× budget is *self-imposed*, so the pacer
> is ours to justify on our own terms — not a thing to look for in the field.
>
> **② The reference clients that look most like ours mostly aren't WebSocket at all. [V]**
> OpenAI's own `openai-realtime-console` is **WebRTC** — `pc.addTrack(ms.getTracks()[0])`, zero JS
> uplink. LiveKit publishes a `MediaStreamTrack` through `pc.addTransceiver`. In that class a
> main-thread stall **cannot** produce a backlog: no JS queue exists on the media path. The
> WebSocket clients are the ones with our problem, and they are the unpaced ones.
>
> **③ On the discipline itself the field splits by LAYER, not by project.** Clients are
> **lossless-and-unbounded**; servers are **drop-past-a-bound**. RVC drops at **50 chunks ≈ 2.1 s**
> (newest); our relay drops at `relay_queue_ms` **2000 ms** (oldest). Every project that has a bound
> puts it on the server. **AssemblyAI is the only client that names the stall case in a comment** —
> and its answer is lossless-with-a-per-message-cap (§3).

---

## 0. Sources, pinned

All read **2026-09-15** at these refs (files listed under *Primary sources* at the end):
openai-realtime-console `ab8b8f58` · openai-agents-js `8a26e309` · `wavtools@0.1.5` ·
livekit/client-sdk-js `303e9a8e` · pipecat-client-web-transports `48f13ab7` ·
assemblyai-node-sdk `1407cecaf` · deepgram-js-sdk `0cbfe097b` · WhisperLive `99cbc1c3` ·
RealtimeVoiceChat `9de323f13` · ITU-T **G.114** (05/2003, PDF) · WebRTC `src@main` · ctrl-b working tree.
Scratch under `/home/emma/.cache/tmp/r71/` (TMPDIR honoured), deleted after the pass. No repo file
written but this dossier.

---

## 1. The pattern table

| Project (transport) | Uplink discipline on a stall burst | Client backlog bound | Mute / pause disposition |
|---|---|---|---|
| **openai-realtime-console** (WebRTC) [V] | **N/A — no JS uplink.** `pc.addTrack(ms.getTracks()[0])` | none exists | track-level; nothing queued |
| **openai-agents-js** `websocket` transport [V] | **Lossless, unpaced.** `sendAudio` → `input_audio_buffer.append` immediately; **silently dropped** when `status !== 'connected'` | **none** | *"Mute is not supported for the WebSocket transport. You have to mute the audio input yourself"* — i.e. stop calling `sendAudio` |
| ↳ its browser example (`wavtools`) [V] | worklet posts **every 128-sample quantum** (5.3 ms @ 24 kHz); main thread coalesces to `chunkSize` **8192 B = 170 ms** and calls `sendAudio` per chunk. A stall's queued deliveries all land in one tick → N sends in one tick | **none** (the worklet also retains every chunk forever in `this.chunks`) | **`pause()` FLUSHES the partial chunk** before stopping |
| **LiveKit** client-sdk-js (WebRTC) [V] | **N/A — no JS uplink.** `pc.addTransceiver(mediaStreamTrack, …)` | none exists | `mute()` → `track.enabled=false` (or `stop()` for mic); nothing queued, nothing flushed |
| **pipecat** websocket transport [V] | **Lossless, unpaced,** with an **unbounded** pre-ready `audioQueue` flushed in a tight `while` loop the instant state becomes `ready`; after that fire-and-forget. Closed socket → logged drop | **none** (`audioQueue` has no cap) | `enableMic(false)` → recorder `pause()` → **FLUSHES** the partial chunk (same wavtools fork) |
| **AssemblyAI** streaming SDK [V] | **Lossless, unpaced, but split into ≤ `MAX_CHUNK_MS` messages** — the one client that names the case: *"Loop so a backlog (e.g. accumulated while a browser tab was throttled in the background) drains as multiple sends, each capped at MAX_CHUNK_MS"* | **none** on volume; a **per-message** cap (200 ms; server rejects > 1000 ms, code 3007) | `close()` → `flushMix(force=true)` — *"drain any final partial mix so the server gets the tail"*, bypassing the 50 ms floor |
| **Deepgram** js-sdk [V] | **Lossless, unpaced.** `sendMedia` = assert OPEN + `socket.send`; **throws** if closed. Its `ReconnectingWebSocket` has `maxEnqueuedMessages: **Infinity**` and replays the whole queue with `forEach(send)` on open | **none** (`Infinity`) | not modelled — caller stops sending |
| **WhisperLive** (Chrome ext) [V] | **Lossless, unpaced.** Worklet buffers **0.5 s**, main thread `socket.send` when `OPEN && isServerReady`, else **silently drops** | **none** | teardown sets `port.onmessage = null` → the partial half-second is **DROPPED**, no flush |
| **RealtimeVoiceChat** (our reference) [V] | **Lossless, unpaced.** Worklet per quantum → main thread batches to **2048 samples** (~43 ms @ 48 kHz) + an 8-byte header (client ms timestamp + `isTTSPlaying` flag) → `socket.send`, no `readyState` check | **none client-side**; the bound is the **SERVER**: `MAX_AUDIO_QUEUE_SIZE = 50` chunks ≈ **2.1 s**, then *"Audio queue full …; dropping chunk"* — **drop-NEWEST**, log-only | `flushRemainder()` zero-pads and sends the partial batch on stop and on socket close |
| **Gemini Live** [R, docs] | not read at source | — | *"When the audio stream is paused for more than a second (for example, because the user switched off the microphone), an `audioStreamEnd` event should be sent to flush any cached audio."* — the one explicit **mid-call mute = FLUSH** precedent |
| **ctrl-b today** (dictation) [V] | **Lossless, PACED** — 1.5× wall-clock bucket, cap 500 ms, unbounded FIFO | none | release drains then `flush`; the queue is pumped only by `onFrame` |
| **ctrl-b today** (call) [V] | **Raw, unpaced**, plus a `bufferedAmount` ceiling (`buffered_ceiling_ms` **1000**) that **kills the leg** rather than queueing | leg death | mute stops frame production; no drain |

**Nobody uses `bufferedAmount` for backpressure** — grepped across all seven WebSocket clients: zero
hits outside Deepgram's unused getter. Our leg-kill rule is ahead of the field, not behind it.

## 2. The two structural classes

**2.1 WebRTC clients have no uplink problem to solve.** [V for the API calls, **[R]** for the thread
claim — I did not read Chromium's audio send path.] Once a `MediaStreamTrack` is handed to
`RTCPeerConnection`, capture → APM → encode → SRTP is the UA's, off the main thread; a stalled main
thread stalls nothing. That is the honest answer to "what do the big ones do": *they made it
impossible.*

**2.2 Nobody paces because nobody is punished.** These servers accept audio faster than realtime by
design (it is how you stream a file). Every client-visible bound found is **per-message**
(AssemblyAI 50–1000 ms; OpenAI 15 MB), never **per-second**. Our relay's rolling 2× budget is a
ctrl-b invention — a sound one, it bounds Silero CPU on Speaches' event loop — so the pacer is a
local consequence, not a field pattern we are missing.

## 3. The decisive numbers

| Quantity | Value | Source |
|---|---|---|
| Client send cadence, wavtools/OpenAI | 170 ms chunks (8192 B @ 24 kHz), worklet posts every 5.3 ms | [V] |
| Client send cadence, pipecat WS | **16 ms** (512 B @ 16 kHz) | [V] |
| Client send cadence, AssemblyAI | **50 ms** worklet chunks; mixed flush every 50 ms | [V] |
| Client send cadence, WhisperLive | **500 ms** | [V] |
| Client send cadence, RVC | 2048 samples ≈ **43 ms** @ 48 kHz | [V] |
| **Per-message duration band, AssemblyAI** | **≥ 50 ms** (*"Input Duration Error"*) and **≤ 1000 ms** (server code **3007**); SDK caps at **200 ms** | [V] |
| Per-message size cap, OpenAI realtime | **15 MB** | [R] |
| **Server backlog bound, RVC** | **50 chunks ≈ 2.1 s**, drop-newest | [V] |
| **Server backlog bound, ctrl-b relay** | `relay_queue_ms` **2000 ms**, drop-**oldest**, `degraded` reported | [V] |
| Client socket-buffer ceiling, ctrl-b call | `buffered_ceiling_ms` **1000 ms** → close + reconnect | [V] |
| **WebRTC audio jitter buffer, hard cap** | `max_packets_in_buffer = **200**` (≈ **4 s** at 20 ms/packet); `max_delay_ms = 0` (no target cap); backlog is drained by **time-compression** (`kAccelerate` / `kFastAccelerate`), the exact "faster than realtime, losslessly" move our bucket makes | [V] |
| **ITU-T G.114 §4** (verbatim) | *"it is recommended to not exceed a one-way delay of 400 ms for general network planning"*; *"delays of less than 150 ms … most applications … will experience essentially transparent interactivity"*; *"delays above 400 ms are unacceptable for general network planning purposes"* | [V] |

**Read G.114 correctly.** It bounds *mouth-to-ear* delay in a two-way human conversation, where the
hazard is talker overlap and echo; it does **not** say an agent must answer within 400 ms. What it
bounds *for us* is **staleness**: with a lossless client backlog the relay's view of the owner's
speech runs `backlog` behind, so endpointing, `speech_started` and every barge-in decision are that
stale. At the brief's stall class (2–10 s) a lossless uplink puts the ear **one to two orders of
magnitude past G.114's unacceptable line**, and the bucket makes it worse before better: at
`DRAIN_PACE 1.5` the surplus is 0.5×, so a **10 s backlog takes 20 s of wall clock to clear** and the
conversation is behind for all of it.

## 4. What I could not determine

1. **[U] Whether any client-side pacer exists anywhere in the field.** Seven clients is not the whole
   field; this is a negative result from a bounded read, and negative results are the weakest kind.
2. **[U] Chromium's WebRTC audio send path under main-thread starvation** — §2.1's "cannot backlog"
   is spec/architecture reasoning plus the API calls, not Chromium source. If the WebRTC-bypass claim
   ever becomes load-bearing for a transport decision, it needs its own read.
3. **[U] What the MessagePort backlog actually looks like on the owner's Honor 20** after a 2–10 s
   app-switch — whether deliveries queue in full, get coalesced, or the `AudioContext` is suspended
   outright (which would produce *no* backlog and make this whole question moot). **This is a
   30-minute device probe and it should be run before the knob is chosen.** Chrome suspends
   background `AudioContext`s in some configurations; if ours is suspended on app-switch, the stall
   class collapses to jank-only (tens to hundreds of ms) and any of (a)/(b)/(c) is fine.
4. **[U] Gemini Live and ChatGPT's own web client** — docs only, no source read.
5. **[R only] OpenAI's absence of an input rate limit** — argued from documentation, not probed.

## 5. RECOMMENDATION — **advisory; the main seat rules**

**(c), implemented as (b) with a named cap: route the call through the shared bucket, and bound its
backlog at a config `call_backlog_ms`, dropping OLDEST past it.** Dictation keeps (a) unchanged.

1. **The code already made this argument.** `liveSocket.sendAudio` kills the leg on a backed-up socket
   with the reasoning *"Draining seconds of stale speech into the ear would transcribe it into a turn
   the owner has long since moved past"*. A lossless unbounded bucket on the same leg contradicts a
   rule we already ship. One posture, or it is a defect.
2. **The bound already exists — server-side, 2000 ms, drop-oldest.** A lossless client bucket does not
   prevent the loss; it *relocates* it to `_enqueue(drop_oldest=True)`, later and less visibly. Two
   bounds disagreeing about who owns the loss is the ownership defect class the live-voice record
   already names. Put the cap where the `degraded` signal and the UI are.
3. **The turn-taking clock is the difference from dictation.** Dictation has no clock: a phrase 8 s
   late still lands correctly in the draft, and losing words is the only failure. A call has a clock
   on both sides — so late audio is not merely late, it is **wrong**: it endpoints a turn the owner
   has moved past and makes barge-in decisions on a 10-second-old world.
4. **Suggested cap: 1000 ms, config, ≤ `relay_queue_ms`.** Matches `buffered_ceiling_ms`, keeps the
   client the tighter (and visible) bound; 1 s of dropped head-of-utterance is recoverable where 10 s
   of stale conversation is not. Drop **oldest**, matching the relay — not RVC's drop-newest, which
   discards exactly the phrase end the endpointer needs.
5. **Mute: do not strand the tail silently.** The field is unanimous that pause/stop **flushes**
   (wavtools `pause()`, pipecat's fork, AssemblyAI `flushMix(force)`, RVC `flushRemainder`, Gemini
   `audioStreamEnd`); only WhisperLive drops, and by accident (`onmessage = null`). Our queue is
   pumped only by `onFrame`, which mute stops — so mute needs an **explicit** decision, not an
   omission. **What the field cannot settle for us:** whether a mid-call mute should also *submit*
   the partial utterance (our `flush` forces an endpoint, which in a call means a turn). Precedent
   says flush the ear; whether that becomes a turn is a call-semantics ruling — flagged, not made.
6. **Do not pace harder to "catch up".** Raising `DRAIN_PACE` toward 2× sits on the relay's close
   threshold — the exact margin the S2.5 note protects. The catch-up lever is the cap, not the rate.
   (WebRTC reaches for time-compression instead; we cannot — the ear transcribes what we send.)

---

## Primary sources

- openai-realtime-console `ab8b8f58` — `client/components/App.jsx:21-35` · openai-agents-js `8a26e309` —
  `packages/agents-realtime/src/openaiRealtimeWebsocket.ts:255-258,684-688`, `openaiRealtimeBase.ts:952-966`,
  `examples/realtime-next/src/app/websocket/page.tsx:135,218-221`
- `wavtools@0.1.5` — `lib/worklets/audio_processor.js:145-157,196-201`, `lib/wav_recorder.js:334-358,413-426,434-452`
- livekit/client-sdk-js `303e9a8e` — `src/room/PCTransport.ts:538-550`, `src/room/track/LocalAudioTrack.ts:48-60,211`
- pipecat-client-web-transports `48f13ab7` — `transports/websocket-transport/src/webSocketTransport.ts:39-63,257-279,308-320`,
  `lib/src/media-mgmt/dailyMediaManager.ts:260-274,318-326`, `lib/src/wavtools/lib/mediastream_recorder.js:292-302,313`
- assemblyai-node-sdk `1407cecaf` — `src/services/streaming/service.ts:106,115,793-885,1085-1089,1100-1111`,
  `browser/dual-channel-capture.ts:12,120-141`, `browser/worklets/pcm16-encoder.ts`
- deepgram-js-sdk `0cbfe097b` — `.../v1/client/Socket.ts:71-74,130-145`, `src/core/websocket/ws.ts:68,88,261-264,480-482`
- WhisperLive `99cbc1c3` — `Audio-Transcription-Chrome/audiopreprocessor.js:5-58`, `options.js:60-90`
- RealtimeVoiceChat `9de323f13` — `code/static/app.js:34-74,108-127,323-326,338-342`,
  `code/static/pcmWorkletProcessor.js`, `code/server.py:51-57,254-288`
- ITU-T G.114 (05/2003) clause 4 · WebRTC `src/main` `api/neteq/neteq.h:134-158`
- Docs [R]: `developers.openai.com/api/docs/guides/realtime-conversations` ·
  `ai.google.dev/gemini-api/docs/live-guide` · `developers.deepgram.com/docs/lower-level-websockets`
- Owned dossiers cited, not re-derived: **R51** §2/§4 (the RVC + pipecat/livekit dissections, incl. the
  2.1 s queue bound re-verified here), **R68** §2.5/§2.6, **R70** §2.6/§4 (the flush-never-discard rule)
