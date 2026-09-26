# Live voice mode ("call mode") — design draft v1

> **Status: ✏️ DESIGN RATIFIED 2026-09-11 ([D71](./DECISIONS.md)) — the owner's word, after the
> brief + the §2.1 discussion. BUILD = Phase 24 (TODO), §7's S0–S4 ladder, one slice per session
> under the standing cadence: S0 · S0.5 · S1 · S2a · S2b · S2.5 · S3 · S3.5 are ALL BUILT +
> council-closed (per-slice as-built records live in §7), plus the D72 INTERMISSION wave (§7,
> between S3.5 and S4); the owner's phone round CLOSED 2026-09-14 with both verdicts PASS.
> ▶ S4 — the owner calibration + device round, the PHASE GATE — **CLOSED 2026-09-26**: the D76
> wave (the call's few controls, S0a–S3) ran inside it, and the owner's S3 round №2, read from the
> D77 trail, PASSED all three arms; `voice.live.enabled` ships **ON** since v1.7.8. Three device
> arms stay owed but non-gating (§7 S4 record: the car on the clean route · TV/other room ·
> ISS-19 lock screen). PHASE 24 IS BUILT.** Council
> trail = §9 (blind Emma RETHINK → all folded → confirm SHIP WITH CHANGES). This file owns the
> live-voice design; ROADMAP §C4 is a pointer; D71 records the WebSocket admission.

## 0. Evidence + as-built seams (verified at tip `4aa1a0b`, 2026-09-11)

**Evidence:** [R51](./research/R51-realtime-voice-chat.md) (the full field dossier: the owner's
RealtimeVoiceChat fork + upstream, RealtimeSTT/TTS, pipecat, livekit/agents, Speaches source +
live probe, the four chat peers, the browser half) · [R68](./research/R68-live-voice-deltas.md)
(the 2026-09-11 delta) · R48/R50 (chunked TTS, measured) · R14 (Android background/mic ceiling).

**The seams this lands on, as they exist today:**

| Seam | Where | What it gives us |
|---|---|---|
| The mouth | `lib/audioController.ts` (D63 + read-along) | Sentence-chunked synth on one `<audio>`, ~0.7 s first audio, an **open-session feeder** (`feedReadAlong`/`endTurnSpeak`) that speaks the reply *as it streams*, per-agent voice (D70 §8.5), and a working kill (session abort + element pause + URL revoke). **Call mode needs ONE minimal new surface here (delta round F4 — the earlier "zero changes" claim was false once priming + the forced read-along landed):** prime/unlock at call start, a call-local read-along override consulted by `useAutoTts`, and the kill-vs-drain flag — no second player, everything else reused. |
| The ear (today) | `hooks/useDictation.ts` + `POST /api/voice/stt` | Push-to-talk whole-clip STT with failover; Tier 0 auto-stop (energy detector, config-driven, default OFF, **threshold never calibrated on the owner's phone**); `auto_send` already routes a transcript into the composer send path. |
| The brain | `POST /agent/chat` · SSE turn stream · `POST /agent/turns/{id}/cancel` | Durable server-owned turns, persist-before-emit, 202-steer during a live turn (D41), idempotent scoped cancel. **Untouched by this feature** — the transcript enters through the same door dictation enters today. |
| Voice config | `VoiceCfg` (`voice.stt`/`voice.tts`) + `GET /voice/status` | The delivery pattern for client voice policy (chunk policy, auto-stop) — `voice.live` rides the same route. |
| Speaches | emma `:9000` — a **local fork**, `~/github/speaches` @ `e093d8b` (R68 §1: upstream frozen at the R51 pin for 5 months; +2 local commits incl. a Parakeet/VAD fix; the openapi `version` field is a hardcoded literal — pin by SHA) | `/v1/realtime` WS, **`intent=transcription`**: Silero server VAD + endpointing + whole-utterance finals. No partials, no truncate, no auto-interrupt (all three gaps re-verified unchanged, R68 §1.1). Resident STT = **Parakeet** (not Whisper). ⚠ posture: binds `0.0.0.0` with a placeholder API key (§5.2). **⚠ S0 (2026-09-12): realtime transcription REQUIRES `LOOPBACK_HOST_URL=http://127.0.0.1:9000` in the unit env — without it every `intent=transcription` session dies at close 1006 before any transcript (the bare-router ASGITransport defect, §7-S0 record). The owner-ruled fix lives OUTSIDE the repo: drop-in `~/.config/systemd/user/speaches.service.d/20-loopback-url.conf` (commented; delete to revert) — a Speaches reinstall MUST recreate it or live calls die.** |
| Agent art | `useActiveBackdrop` / agent summaries (D70) | The call overlay can wear the active character's art for free. |

**The gap, stated once (R51):** ctrl-b has a first-class downlink and no continuous uplink — no
always-open audio channel, no VAD, no endpointing. Everything else already exists.

## 1. Owner requirements (2026-09-11, in conversation — the bar the design is judged against)

- **Efficient and low latency** — a live *conversational* loop, not a sub-second parlor trick;
  "say the thing, get the answer" without taps.
- **Smooth to use** — start a call, talk, hang up; no per-utterance ceremony.
- **Reliable voice recognition** — robust under **noise** (no false triggers) and across **quiet
  moments** (a thinking pause must not cut the utterance; a finished sentence must not hang) —
  "not flaky or unreliable".
- Options/libraries surveyed before committing (R51 did this; R68 refreshes it).
- Scope (R51/R14, stands): **screen-on, app-foreground, Wake Lock held** — the docked/handheld
  call. Screen-off always-listening is a Capacitor-shell feature, out of scope, recorded in §C4.

## 2. The decision: architecture ① (R51 §9.3), client-submitted

**Speaches-realtime as the ear · the untouched agent loop as the brain · C3 read-along as the
mouth · the phone as the conductor.**

```
phone ── AudioWorklet pcm16 frames ──▶ wss /api/voice/live ──▶ relay ──▶ Speaches /v1/realtime
  ▲                                        (session state,            (intent=transcription:
  │  ◀── JSON: vad/state/transcript ◀──     bearer stays here)         Silero VAD + endpointing)
  │
  ├─ final transcript → the EXISTING send path (runComposer — same as dictation auto_send)
  ├─ reply text ← the EXISTING SSE turn stream
  ├─ reply audio ← C3 read-along (forced ON for the call), per-agent voice
  └─ barge-in → C3 kill + the EXISTING scoped cancel (v1 has no truncation — §4.4)
```

Why this shape wins (argued in R51 §9.3, re-affirmed with R68's corrections):
- **Zero new models, zero new hosts** — VAD/endpointing/STT (Parakeet resident, Whisper
  configured) live on the server the owner already runs; the phone ships no ONNX/WASM.
- **Supply risk, stated honestly (R68 §1):** Speaches upstream is frozen (no release in 8.5
  months) and emma already runs a locally-patched fork — choosing ① means *owning* that realtime
  path, not buying it from a maintained service. Accepted because: the surface we use is small
  (`intent=transcription`), it is source-verified, we already patch this tree, and ② is the
  recorded exit that reuses everything but the ear.
- **The agent loop is untouched** — tools, confirm gates, prompts, memory, attribution, steering
  and thread persistence are all reached through the doors that already exist.
- **Graceful degrade** — if the live socket dies, push-to-talk still works, unchanged.
- Architecture ② (client Silero + Smart Turn v3 server-side) stays the **recorded fallback** if
  ①'s endpointing proves too coarse in the owner's hands — the wire and UI built here survive
  that swap (only the ear's location moves), so nothing is thrown away.

**The load-bearing sub-decision — the CLIENT submits the turn.** The relay is a pure ear: it never
calls the agent loop. The final transcript travels down to the phone, and the phone submits it
through `runComposer` exactly as dictation `auto_send` does today. Costs one tailnet round-trip
(~10–30 ms, invisible next to Whisper + LLM TTFT); buys: attribution, steer-queueing (202), the
composer's guards, and the confirm-gate UX all byte-identical to text — and the relay needs no
auth story, no thread knowledge, no persistence.

### 2.1 The inheritance ledger — what the reference projects contributed (owner ask, 2026-09-11)

The owner's RealtimeVoiceChat fork (KoljaB upstream) was source-dissected end-to-end in R51 §2,
and pipecat/livekit in §4 — nothing here is unexamined. What each contributed, stated once:

**Taken from RealtimeVoiceChat (the reference shape):**
- The **capture/playback AudioWorklet pattern** (§3.1's capture leg — R51 called the 20+68-line
  worklet pair "the best code in the repo").
- The **interruption semantics** — kill audio first, then abort the turn, and persist honestly
  (§4.3's ordering is RVC §2.6 done with our seams).
- The **negative lesson**: RVC goes deaf for 1–2 s after every reply because it has no echo
  answer — our mic never closes (§4.3), and Chrome's `"all"` AEC mode (R68) is the fix RVC
  never had.
- The **one-knob philosophy** (RVC's speed slider) — deliberately deferred: v1 ships the raw
  knobs as Settings and S4 calibrates them with the owner; a single "pace" preset can fold over
  them later without migration.
- Its **latency headline trick — the short first clause** — we already own most of it: C3
  speaks the first sentence at ~0.7 s. The remaining lever is RVC's prompt-side half ("first
  sentence ≤ N words", which makes the first chunk close sooner). Available any time as an
  owner-editable call-mode prompt line through the Phase 18 registry — optional, S4 material.

**Deliberately NOT taken (R51 §9.3③ — the ruled-out port):** the duplex-PCM-both-ways WebSocket
(C3 already delivers audio better over HTTP), the GPU DistilBERT turn classifier + dual Whisper
(needs hardware we don't spend and partials we don't have), the thread-per-stage abort fence
(eleven Events, three timeouts — our cancel is one idempotent HTTP call), and its private
history/pipeline (would fork the agent loop — the hard constraint).

**Shelved with a named trigger (the "least latency" ceiling):** RVC's two real latency weapons —
**dynamic endpointing** (the pause length adapts to whether the sentence sounds finished) and
**speculative generation** (the LLM starts on a partial transcript) — both require PARTIAL
transcripts, which the Speaches ear does not produce (frozen upstream, R68). They are exactly
what architecture ② / v2 buys if v1's fixed `silence_ms` feels sluggish in the owner's hands:
pipecat has since formalized the speculation trick as `SpeculationGate` (R68 §2.5), and Smart
Turn v3 (8.7 MB CPU ONNX) is the endpointing half. **S4's calibration round is the decision
point: if tuned knobs feel good, v1 stands; if not, ② is designed and costed, not improvised.**

**Taken from livekit:** the interruption floor (`min_duration`/`min_words` → our
`min_speech_ms` + `barge_threshold`). **Declined for v1:** its false-interruption *resume*
(the agent un-pauses if the interruption produced no transcript within 2 s) — recorded as an S4
option if the energy gate alone proves too twitchy; our v1 interruption is deliberately simple
and irreversible.

## 3. The wire — the first WebSocket in the codebase

### 3.1 Route + framing

`WS /api/voice/live` on the existing FastAPI app (same bind, same tailnet-only trust boundary).

- **Uplink:** one JSON `start` control message, then raw **binary pcm16 mono frames**. The client
  MEASURES its real `AudioContext.sampleRate` and declares it in `start`; the relay keeps **one
  stateful resampler per session** to Speaches' 24 kHz (both are RealtimeSTT-server's stated
  rules, and the inverse of RVC's hardcoded-ratio defect, R51 §2.2). Frame size = a config-driven
  duration (default 40 ms). `stop` control message ends the session cleanly.
- **Downlink:** JSON only — `{type: "state"|"speech_started"|"speech_stopped"|"transcript"|"error", …}`.
  **No audio ever rides the WS** (C3 owns reply audio over HTTP, unchanged).
- **Backpressure, both ends (council F6):** server side, a bounded relay queue; on overflow drop
  the OLDEST audio frames and surface a `state` warning — never silently stall
  (RealtimeSTT-server's contract beats RVC's silent drop). Client side, `WebSocket.send()` has no
  awaitable backpressure — the client watches `bufferedAmount` against a ceiling
  (`buffered_ceiling_ms` of audio, config); crossing it CLOSES the socket, discards the leg, and
  reconnects as a fresh session, so a tailnet blip never drains seconds of stale speech into an
  obsolete transcript. Declared numeric bounds (testable, not vibes): accepted `start` sample
  rates 8–96 kHz, max binary frame `max_frame_bytes` (config, default 32 KiB), an ENFORCED
  message-rate ceiling (sustained excess over ~2× the nominal 1000/`frame_ms` per second is a
  protocol-error close, not a warning — confirm-round residual), max session seconds (default
  aligned to Speaches' 30 min lifetime), one live session per connection and a process-wide
  live-session cap (§5.2).

### 3.2 The D-entry (lands at ratification)

"SSE down, HTTP up" has been an implicit invariant; this route breaks it deliberately. The D-entry
records the narrow admission: **WebSockets are admitted for continuous media ingress only** —
the turn machinery, chat text, and every non-media channel stay SSE/HTTP. A future feature wanting
a WS for convenience re-argues against this entry.

### 3.3 The relay (backend)

A ~200-line session object (asyncio, no threads — RVC's eleven-Event teardown is the
counter-example, R51 §2.6/§2.8): phone WS ↔ Speaches realtime WS, translating frames to
`input_audio_buffer.append` (base64 pcm16 @ 24 kHz) and Speaches events to the typed downlink.
The **bearer key never reaches the browser** — the relay injects it server-side (provider-registry
pattern; the target rides `voice.live`, resolved like every other voice target). Speaches
unreachable/refusing → typed `error` downlink + close; the client shows it and falls back to
push-to-talk. Reconnect = a fresh session (no resume protocol in v1 — a phone that slept starts a
new call leg; the call overlay reconnects automatically while open).

## 4. The conversation loop

### 4.1 Endpointing + the flakiness knobs (requirement §1's "noise / quiet moments")

All tunables live in `voice.live` (no hardcoding; defaults = the field's numbers). The first two
pass through to the Speaches session verbatim — **and only those two: Speaches' `TurnDetection`
accepts exactly `threshold`/`prefix_padding_ms`/`silence_duration_ms`/`create_response`/`type`
(council F2, source-verified), so every other gate is a CLIENT-side knob (§4.3), not a server
knob.** The table below is the AS-BUILT list at the S4 close (2026-09-26) — `LiveCfg` in
`backend/app/config.py` is the source of truth (every field carries its provenance comment and
bounds); the D76 wave (§7) replaced the draft's `barge_threshold` + Speech slider with the
relative-dB gate, and D73/D74/D77 added the route, background, deck and trail knobs. It inventories
`LiveCfg`'s OWN fields only: the realtime pointer (`provider`/`model`/`fallbacks`) and its transport
knobs (`connect_timeout_s`/`timeout_s`/`extra_body`) are INHERITED from `VoiceServiceCfg` and configured
exactly as for stt/tts (§5.1):

| Knob | Default | Where | What it tunes |
|---|---|---|---|
| `enabled` | **true** (since v1.7.8) | server | The whole-feature toggle; `voice.enabled` outranks it |
| `vad_threshold` | 0.6 (D76 §D, R84) | server | Silero speech-probability START floor (bounded 0.5–0.8 — the END threshold is `−0.15`, and 0.9 put it at the cliff) |
| `silence_ms` | 700 | server | End-of-utterance silence — **quiet-moment tolerance** (bounded 500–1200) |
| `min_speech_ms` | 300 | client | The barge-in ACTION floor (§4.3) — a cough/door-slam must not kill playback |
| `barge_in` | false | client | Hands-free interruption master (owner re-ruling 2026-09-22: an opt-in, tap-to-interrupt is the resting state) |
| `min_final_ms` | 200 | client | D74 near-speech gate: how much of a final's audio must sit above the effective floor (0 = off) |
| `mic_hold` | auto | client | D76 §B: hold the ear while the reply plays — `on` / `off` / `auto` (= the per-chunk leak probe, S2) |
| `floor_dbfs` | −45 | client | D76 §C the relative gate's BOOTSTRAP CEILING — the floor before any noise estimate exists |
| `noise_margin_db` · `voice_margin_db` | 10 · 10 | client | Effective floor = `max(noise + noise_margin, ownVoice − voice_margin)` (the learned room, the learned voice; the latter is the "too quiet" line) |
| `playback_margin_db` | 10 | client | Added on top of the effective floor for the BARGE floor while the reply plays |
| `min_dbfs` / `max_dbfs` | −60 / −20 | client | The effective floor's clamp (load-validated `min < max`) — the Sensitivity control's range |
| `route` | media | client | D73 the sink: `media` (A2DP/loudspeaker, clean) vs `call` (comm mode, HFP, echo-cancelled) |
| `input_device` | "" | client | D73 pinned mic (`""` = the browser default), fallback-and-say-so |
| `background` · `background_keepalive` · `background_idle_s` | true · true · 600 | client | D73 S6: survive the screen-off/app-switch freeze; the idle hang-up |
| `ring` · `captions` | true · true | client | The overlay: the face ring; the reply as captions |
| `debug` | false | both | The in-call readout AND the D77 call trail (`$CTRLB_HOME/calls/`) |
| `trail_keep` | 20 | server | D77 retention (bounded 1–500) |
| `uplink_idle_s` | 15 | server | R86 LC-8: a leg with NO uplink audio this long (a frozen page, a dead ear — the client ships a frame every `frame_ms`, held/muted ones as silence) ends as a `session_limit`-class terminal instead of holding the slot to `max_session_s`; bounded 5–120, load-validated to outlast `tail_wait_ms` |
| `dictation` · `tail_wait_ms` · `dictation_idle_s` · `dictation_max_s` | false · 2000 · 15 · 120 | client | S2.5 streaming dictation on the same ear |
| `buffered_ceiling_ms` · `call_backlog_ms` | 1000 · 1000 | client | Uplink backpressure: reconnect ceiling; the lossy call pacer's backlog |
| `frame_ms` · `max_frame_bytes` · `max_session_s` · `max_sessions` · `relay_queue_ms` · `start_timeout_s` · `allowed_origins` | 40 · 32768 · 1800 · 1 · 2000 · 5.0 · [] | server | The relay's own caps + the Origin escape hatch |

Client-side, the capture asks for `echoCancellation` per the route (D73), `noiseSuppression: true,
channelCount: 1` (dictation inherits the constraints — R51 §6.1). **S4 was the owner calibration
round** on the real phone in real rooms; the knobs let it turn dials instead of filing bugs, and the
D76 wave is what the dials became (a relative floor the meter learns, not a fixed RMS number). The
Tier 0 `auto_stop_threshold` stays at its 0.01 default — the S3.5 rounds never needed it moved.

**What we deliberately do NOT get in v1:** partial transcripts — Speaches' realtime path
transcribes whole utterances (R51 §6.4 gap 1; **re-verified unchanged, R68 §1.1** — upstream is
frozen, so this will not fix itself). So no speculative generation and no text-based turn
detection (pipecat's new `SpeculationGate`, R68 §2.5, needs partials — recorded as the v2 lever,
which in practice means architecture ②'s own-the-ear path). ② is likewise the fallback if
endpointing quality disappoints; its browser leg would use Silero v6 weights directly (R68 §2.2
— the popular `vad-web` wrapper is stale, §2.3, so ② would vendor the model, not the wrapper).

### 4.2 The state machine (client-owned, rendered by the overlay)

The ear, brain and mouth run **concurrently**, so a single linear enum cannot carry the truth
(council F5). The machine is a rendered **primary phase** —
`idle → connecting → listening → thinking → speaking → listening` with `error`/`ended` terminals —
plus two **orthogonal flags**: `userSpeechActive` (between `speech_started`/`speech_stopped`)
and `waitingFinal` (speech stopped, transcript not yet arrived; cleared when the final is
consumed or discarded). One machine, one owner (a `useLiveCall` hook), the overlay renders the
phase. "Hang up" from every state. Rules the flags force: **playback may not start while
`userSpeechActive || waitingFinal`** (confirm-round MED 2 — the gap between speech-stop and the
final's arrival must not let an old reply start talking) — if the mouth would begin while
either holds, that IS a barge-in (kill before first audio, §4.3) — **on the transcript gate's
evidence, for a CLOSED utterance only (R86 LC-1, narrowed by R88 E-1):** a segment that has stopped
(`waitingFinal`, no speech live) whose epoch-matched accrual is below `min_final_ms` is noise, not a
barge-in, and the reply plays; an OPEN segment kills whatever it has accrued so far, and unmeasured
still kills (fail-open, like the gate); a final arriving
during `thinking` submits as a **steer** through the existing 202 path (D41) without touching the
phase. The machine composes existing pieces:

- final transcript → submit via `runComposer` (auto-send semantics; steer vs new turn is the
  server's existing call).
- turn stream → C3 read-along **forced ON for the call session** (the policy override is
  client-local for the call's duration; the Conf setting is untouched).
- `speaking` = C3 playback active; `listening` resumes on queue drain — observed through the
  playback store's status (`playing → idle/paused`), with the call's own kill distinguished from
  a natural drain by the machine's flag, not inferred from the store.
- **turn identity (council F3):** the chat store exposes ONE narrow seam returning the live
  `{threadId, turnId, assistantMessageId}` plus a scoped cancel with an explicit
  harvest-disposition — today's `stopTurn()` (private `lastTurnId`, streaming-status guard,
  steer-restore UX) is a text-Stop composite, not a reusable primitive. Both text Stop and the
  call take the new seam; no duplicated turn tracking.

### 4.3 Barge-in (the interruption path)

**Two triggers, ONE action (owner ruling 2026-09-12: automatic interruption is OPTIONAL).**
The ordered kill sequence below is trigger-agnostic. Trigger A — **voice** — is gated by the
`barge_in` Settings row (the `min_speech_ms`/`barge_threshold` floors are A's alone — a
deliberate tap needs no floor); OFF disables only the automatic path. Trigger B — **manual
tap** (the ChatGPT voice-mode pattern) — always exists: during `speaking`, a tap anywhere on
the overlay outside the control cluster interrupts; in ring mode the circumference is the
visual invitation, and it works identically in no-ring mode. **Outside `speaking`, overlay
taps are inert** — during `thinking` you steer by just talking; nothing cancels by accident;
mute and hang up stay the only always-live controls. With `barge_in` off, speech over the bot
is still transcribed (the mic never closes) and completed utterances join the machine's
**pending queue** (below), submitting when playback drains — walkie-talkie semantics; a tap
mid-speech fires the ordered sequence and the queue rides it.

The mic **stays open while the bot speaks** (RVC's 1–2 s deaf window is the recorded
anti-pattern). Trigger A's mechanism: during `speaking`, a `speech_started` from the server VAD **gated by
a client-side sustained-energy floor** — Speaches emits `speech_started` on first detection and
has no minimum-speech knob (council F2), so the ACTION waits until the capture worklet (which
already owns the samples) has seen ≥ `min_speech_ms` of sustained RMS. The ear never closes;
only the kill is gated, so a cough costs nothing and real speech costs ~300 ms of overlap.
(The recorded alternative if S4 calibration shows this floor unreliable: patch the owned
Speaches fork with a real `min_speech_duration_ms` — we already carry local commits there.)

The action, **ordered (council F4)**: ① C3 kill (pause + session abort — synchronous, the
audible part stops now) → ② scoped cancel through the §4.2 seam **and await its settlement** →
③ only then submit what is pending — `useLiveCall` keeps **ONE ordered pending-utterance
queue** serving both holds (the cancel-settle window AND the `barge_in`-off walkie-talkie
hold are the same mechanism): every utterance completed while the floor was held joins in
order and submits as ONE message on release — never a one-slot overwrite, never lost speech
(the coherence-sweep correction: the ratified text said "exactly one buffered utterance",
which loses the second utterance of a long walkie-talkie hold). A call-origin steer the
cancel harvested is consumed rather than restored into the composer. This closes the race
where a short interrupt's transcript lands as a 202 steer on the dying turn and gets silently
harvested into a draft. **The queue is fenced by a call-generation token (delta round F7):**
every drain/settle callback carries the generation it was armed under and no-ops against a
different one — a hang-up's own C3 kill must not fire a stale "drain" submit, and a redialed
session must not inherit the old call's callbacks. Terminal disposition: a deliberate hang-up
DISCARDS pending utterances (the user chose to leave); `error`/`ended` terminals harvest them
to the composer draft (never-lose applies to failures, not to the user's own exit).

**The turn commonly ends before the mouth does** (council F1): generation outruns synthesis, so
by the time the owner interrupts, the cancellable turn may already be terminal. Barge-in
therefore has two branches: turn live → the ordered sequence above; turn terminal → C3 kill
only (nothing to cancel), and the interrupting utterance simply becomes the next turn. Both
branches are the same user gesture and the same machine edge.

**Echo is the gate on this — and R68 §3 corrected R51's central worry:** Chrome ≥141 (stable
2025-09, Android included) ships **`echoCancellation: {exact: "all"}`** — system-loopback as the
AEC reference, i.e. same-page `<audio>` IS cancelled when the page asks for it. The capture
therefore requests `echoCancellation: {ideal: "all"}` (Chromium honors the mode; a string handed
to Firefox's boolean slot WebIDL-casts to `true`, the safe degrade — and Gecko reportedly
references all browser audio anyway). What remains genuinely open is **efficacy on the owner's
Honor 20** (Android's loopback-capture restrictions, R68 §3.4) — so S0 keeps a *short* device
probe: the capability readback (`getCapabilities().echoCancellation` lists the modes; seconds)
plus one acoustic leak check. Branches, in order of preference:
1. **`"all"` supported + leak check clean** (expected on Chrome) → constraints alone; nothing built.
2. **Dirty** → the loopback-`RTCPeerConnection` trick (~40 lines: route C3's element through a
   local peer connection so AEC treats it as remote — the folklore workaround, now the fallback,
   R68 §3.4) behind `voice.live.echo_workaround: auto|on|off`.
3. **Both fail** (worst case) → barge-in demands an ENERGY floor above the leaked-TTS level
   (config), and S4 calibrates it; the feature still ships, less magical.

### 4.4 What the model believes it said (R35 divergence ④ — designed once, for text + voice)

**DEFERRED OUT OF v1 (council F1, HIGH, code-verified — the ruling).** The draft assumed a
cancelled turn persists its generated-so-far text and could be truncated "at terminal
persistence". The code says otherwise: deltas are buffered for SSE replay only and the assistant
message is persisted **only at completion** (`session.py` ~L180, `_persist_assistant`) — a
cancelled turn persists **no partial at all** — and once persisted, the turn handle is gone
while C3 may keep speaking for many seconds, so a barge-in often arrives when there is nothing
to cancel and a full message to amend. A real fix needs BOTH a mid-turn partial-persistence
path and a message-scoped post-terminal amendment — new persistence surface, its own design.

**v1 posture, stated honestly:** mid-turn barge-in cancels the turn → no assistant text persists
(the model under-remembers: it won't reference unsaid words — the benign direction, and
identical to today's text Stop). Post-terminal barge-in kills audio only → the full text stands
(over-remembers). Both documented in the overlay's help line; neither corrupts state.

**The recorded v2 design (when bought):** an assistant-message-scoped truncate keyed by
`assistantMessageId` (works mid-turn and post-terminal alike), fed by the read-along feeder's
*(chunk count after feed, markdown prefix length)* step map — with council F7's correction: one
feed can close SEVERAL chunks, so the boundary is the **greatest feed boundary whose chunk count
≤ fully-played chunks** (under-remember inside a multi-feed batch; exact per-chunk markdown
ranges would need a range-preserving `toSpeech`, deliberately not v1 material). The `[cut off]`
marker for text Stop rides the same seam. This closes R35 divergence ④ for both modes.

### 4.5 Loop edge rules (the refinement round — owner-approved 2026-09-12, code-scouted first)

- **Transcripts are always plain messages.** Call submissions bypass the `!`/`/` sigil
  classification in the send door — a misheard transcript must never route as shell or slash.
- **The typed draft is untouched.** Dictation auto-send appends to the draft and sends the
  whole draft; the call deliberately does NOT — it submits the transcript alone, and whatever
  is typed in the composer stays there.
- **Staged attachments ride (owner-ratified):** files staged when a call turn submits are
  reserved onto that turn exactly as a typed send would — stage a photo, start the call, ask
  about it. The upload hold refuses routing while an upload is in flight (that part is
  shipped); **the retry is NOT existing code (delta round F2)** — dictation survives the hold
  only via its draft. The call machine keeps a held final in the §4.3 pending queue and
  retries once on the attachment store's uploading→settled transition.
- **Empty finals are discarded** (the no-speech path): nothing submits, `waitingFinal` clears.
- **Thread identity:** the call rides the open thread; with none, the first utterance mints one
  server-side exactly like a typed first message (the `thread` wire frame updates the client,
  unchanged).
- **A turn already streaming at call-start is not half-read aloud** — only turns that begin
  after call-start are spoken.
- **Read-along config fallback:** the call forces the read-along path client-locally for its
  duration; if TTS chunking is configured off, replies speak once complete via `endTurnSpeak` —
  the call still works, just less fluid.
- **Confirm gates in-call (owner-ratified):** a turn reaching `awaiting_confirm` renders in the
  overlay as a "needs your OK" state with **Allow / Deny buttons riding the SAME `resumeCall`
  chokepoint and single-use token** as the chat card — a tap, never a spoken confirmation (the
  privilege gate stays tap-bound; SECURITY_MODEL unchanged; the ruled-out alternative was
  "pause and peek at chat").
- **Capture loss** (permission revoked, a real phone call steals the mic, headset events) →
  the track's `ended` → the call ends in `error` with a plain reason. Page-hidden is §5.3's (it
  survives since D73 S6; `pagehide` ends cleanly).
- **Busy/limits UX copy:** a second concurrent call → "another call is active"; `max_session_s`
  reached → "call time limit reached" + one-tap redial. Settings edited mid-call apply to the
  NEXT call — sessions read config at start.
- **TTS failure mid-call is nonfatal (coherence sweep 2026-09-12):** if the mouth errors —
  synthesis fails and playback never starts, or dies mid-reply — the machine returns to
  `listening` with a "voice failed — the reply is in the chat" line; the ear keeps working and
  the call continues. Repeated mouth failure never ends the call on its own; hanging up is the
  user's move.
- **Submit failure loses nothing:** if a transcript's send fails (network/5xx from the chat
  door), the utterance drops into the composer DRAFT and the overlay says so — the
  never-lose-speech rule applied to the brain leg; no silent retry loop. **The signal must be
  BUILT (delta round F8):** `runComposer`'s boolean means "routing started" and `sendMessage`'s
  promise is discarded today, so the NL send seam grows a narrow accept/refuse result (the
  boolean wrapper preserved for existing callers); harvest on definite refusal, and a
  network loss whose acceptance is UNKNOWN is labeled on the overlay rather than re-sent —
  an invisible duplicate is worse than a manual retry.
- **Reconnect contract (the §3.3 auto-reconnect, made concrete):** bounded attempts with
  backoff, then the `error` terminal; the overlay shows `connecting` during retries. A drop
  mid-utterance LOSES that utterance — stated honestly, the audio is gone — `waitingFinal`
  clears, and playback is untouched (C3 rides HTTP, not the WS).
- **Speech during `awaiting_confirm` HOLDS in the pending queue (delta round F1 — the
  original "queues as an ordinary steer" leaned on a broken shape):** a suspended turn leaves
  chat status `idle`, so a send takes the optimistic fresh-turn path (assistant placeholder +
  streaming status) and an actual 202 against the held turn strands both. The call machine
  therefore does not submit while a confirm is outstanding — utterances join the §4.3 queue
  and submit on resolution (allow OR deny). The confirmation itself still requires its tap.
  **Recorded pre-existing defect, wider than the call:** TYPED text during `awaiting_confirm`
  hits the same 202 mis-shape today; the F3 turn-seam slice adds normalize-on-202 at the
  shared `sendMessage` seam (remove the provisional placeholder, adopt queued-steer state),
  healing both modes.

## 5. Config, security, degrade

### 5.1 `voice.live` (extends `VoiceCfg` — one unified object, the extend-don't-migrate directive)

```yaml
voice:
  live:
    enabled: true           # whole-feature toggle (the standing pluggability requirement); ON since v1.7.8 (S4 closed)
    # provider: voice       # the INHERITED pointer (`VoiceServiceCfg`): provider / model / fallbacks, plus
    # model: parakeet       #   connect_timeout_s / timeout_s / extra_body — blank provider + no fallbacks
    #                       #   resolves exactly like voice.stt (one Speaches box serves both doors)
    vad_threshold: 0.6      # server, rides session.update — D76 §D (the draft's 0.9 was Speaches' outlier; see §4.1)
    silence_ms: 700         # server, rides session.update
    min_speech_ms: 300      # client: the barge-in action floor
    min_final_ms: 200       # client: the transcript gate (D74) — and, on a CLOSED utterance, the iron rule's (R86/R88)
    barge_in: false         # ships OFF since the 2026-09-22 re-ruling (D74 addendum ⑨) — voice interrupt is an opt-in
    mic_hold: auto          # auto | on | off (D76 §B; was the draft's `echo_workaround`) — auto = never held on a
                            # track whose getSettings().echoCancellation reads "all" (measured SUBTRACTIVE on
                            # Chrome, §7-S0 — voice barge-in viable); anywhere else each CHUNK starts held and
                            # the per-chunk leak probe releases it when its held audio stays under the floor.
                            # Capability-detected per track at call start, NEVER UA-sniffed.
    route: media            # client: media (EC off, the media path) | call (platform AEC, comm mode) — D73/D76 §A
    input_device: ""        # client: the capture deviceId, "" = the system default (D73 S5)
    floor_dbfs: -45         # client: the D76 §C relative gate — bootstrap ceiling…
    noise_margin_db: 10     #   …the three margins…
    voice_margin_db: 10
    playback_margin_db: 10
    min_dbfs: -60           #   …and the clamp
    max_dbfs: -20
    background: true        # client: a hidden page KEEPS the call (D73 S6 — §5.3)
    background_keepalive: true
    background_idle_s: 600
    ring: true              # §6 overlay mode: true = the focal-anchored face ring; false = art-only + transcript accent
    captions: true          # the reply as fading captions on the call screen
    debug: false            # the in-call readout AND the D77 call trail
    trail_keep: 20          # server: D77 retention
    dictation: false        # S2.5 streaming dictation on the same ear, and its three knobs
    tail_wait_ms: 2000
    dictation_idle_s: 15
    dictation_max_s: 120
    buffered_ceiling_ms: 1000   # client outbound-buffer ceiling before close+reconnect (F6)
    call_backlog_ms: 1000       # client: the lossy call pacer's backlog (A-F2)
    frame_ms: 40            # server cap (the client paces by it too)
    max_frame_bytes: 32768
    max_session_s: 1800
    max_sessions: 1         # process-wide live-session cap (F9; N=1 service)
    relay_queue_ms: 2000
    start_timeout_s: 5
    uplink_idle_s: 15       # server: the frozen-page reaper (R86 LC-8)
    allowed_origins: []
```

Delivered to the client via `GET /voice/status` (the established non-Conf-scoped voice-policy
door). **Owner ruling 2026-09-11: these are real Settings, not YAML-only — and the visual-design
round the same day sharpened the placement: live call gets its OWN Conf section ("Live call"),
not rows tucked into the existing voice group or Appearance.** The section carries the behavior
toggles (`enabled`, `barge_in`, `mic_hold` — the draft's `echo_workaround` — the §6 `ring` mode) and the tuning numerics
(thresholds, `silence_ms`, `min_speech_ms`), same SettingRow presentation as the rest of Conf,
so interruption-and-friends are tweakable from the phone in one clearly-named place. *(The YAML
stays `voice.live` — the extend-don't-migrate shape above is untouched; only the Conf grouping
is its own section.)* `enabled: false` or no resolvable
target → the call button is not rendered (the `VoiceClient.configured` pattern).
**Refinement 2026-09-12:** the render gate is live enabled + a resolvable realtime target
**+ TTS configured** — the call needs the mouth, not just the ear — delivered as one `live`
capability bit on `GET /voice/status` (the mic's `stt` bit pattern). The `voice.enabled`
MASTER switch outranks everything here, as it does for stt/tts: master off ⇒ the `live` bit
is down regardless of `voice.live.enabled`. The entry affordance also
inherits the mic button's degraded-state presentation: greyed-with-explainer on an insecure
context, reactive `unavailable` after a server error.

### 5.2 Security posture (SECURITY_MODEL lens)

- Same origin, same tailnet-only bind, `wss:` under the existing Tailscale Serve cert — no new
  ingress class, no new port.
- The Speaches bearer never leaves the backend (the A11 secret rules apply — never logged, never
  echoed in errors). **R68 §1.2 flagged the Speaches posture (binds `0.0.0.0:9000`, placeholder
  API key). OWNER RULING 2026-09-11: leave the server exactly as it is — ctrl-b touches nothing
  outside the project.** Recorded; the design itself does not widen that exposure (the relay is
  the only new client, and the phone never talks to Speaches directly).
- The WS accepts **only** the typed control messages + bounded binary frames; anything else is a
  protocol-error close. Caps: frame bytes, session seconds, one live session per connection plus
  the process-wide `max_sessions` cap (F9). **Browser CORS does not protect WebSockets** — the
  route validates the `Origin` header against the configured ctrl-b origin(s) and rejects
  absent/foreign browser origins, so a hostile page opened on a tailnet device cannot ride the
  owner's network position into the relay (F9).
- No new execution path: the relay produces *text into the existing composer door* — every
  downstream guard (confirm tokens, privilege gate, shell toggles) applies exactly as for typing.

### 5.3 Reliability + degrade ladder

- Speaches down / relay error / WS drop → overlay shows the error state; **push-to-talk and
  read-along are untouched** (they share no runtime with the call).
- Page hidden / phone locked → **the call SURVIVES by default** (D73 S6, amending this section's
  original foreground-only scope — the S6 background wave in §7 is the record): `background`
  (default true) keeps the leg; `background_keepalive` (true) holds an inaudible-but-nonzero source
  so Chrome Android does not freeze the page and deafen the ear; `background_idle_s` (600, 0 = off)
  ends a backgrounded call with no speech, no final in flight and no reply; the ear-outage check
  redials on return; `pagehide` still ends it cleanly. `background: false` restores the old clean
  end on hide. Wake Lock held (and re-taken on return) while the overlay is up.
- The Tier 0 auto-stop path stays as-is — the call mode neither replaces nor requires it.

## 6. The UI (VAPOR_PATTERNS governs; kit overlay contract) — **visual design RATIFIED (owner, 2026-09-11 visual round)**

A **call overlay** (the kit's overlay pattern — form-sibling mount, the `.mform` lesson). Entry:
a call button in the composer's voice cluster, rendered only when `voice.live` is
configured+enabled. Minimal v1 — no waveforms, no partials (we have none), no speed slider
(playbackRate exists in the player already). Theme-tokened; gacha/kit/frontier inherit through
tokens (no per-theme bespoke work in v1).

**The backdrop never goes away (owner ruling).** In BOTH overlay modes the call screen is the
active agent's art **full-bleed** via `useActiveBackdrop` — a call with Lynette looks like
*her*. **The ladder is `useActiveBackdrop` ALONE (delta-round sweep clarification):**
background → avatar → the plain theme surface; gacha's oracle art does NOT participate — the
call wears agent identity, not fleet flavor (the chat backdrop's gacha fallback is that
surface's own business). There is explicitly NO "blank screen + portrait in a circle"
phone-call look — the owner rejected it.

**One toggle — `voice.live.ring` (a Conf row in the Live call section, §5.1):**

- **Ring mode (default — the look the owner envisioned):** a drawn **circumference** — a
  stroke, no fill, nothing masked or cropped — sits on top of the art, over the face; the art
  shows through untouched (a halo, not a frame). **Focal-anchored (owner-ratified):** the ring
  centers on where the live backdrop's stored focal point (the media-manager framing crosshair)
  lands *on screen* — a small pure helper inverting the existing cover/focal positioning math
  the backdrop already uses; no new data, no new UI, any art at any viewport. Fallback when the
  image has no focal point: centered, upper third. The anchor reads the focal POINT only,
  never `z` — zoom stays circle-window-scoped (the wave-3 rule; the ring is a halo, not a
  window). The §4.2 state animates the STROKE — the
  music-visualizer *look* without the machinery: `listening` breathes slow, `userSpeechActive`
  answers visibly (the owner's core ask: "show when I'm speaking and when I'm not"),
  `thinking` shimmers, `speaking` pulses firmer, `connecting` dim, `error` takes `--danger`.
  Transform/opacity-only (THEME_ENGINE §14.11 smoothness rule). With motion reduced (the
  existing UIState/Appearance switch, never a raw media query), state changes render as
  discrete opacity/color steps — reduced motion must never mean an unreadable call state.
  **DECLINED (owner, 2026-09-11 — do not re-propose):** audio-amplitude reactivity
  (AnalyserNode on the TTS element). The ring reacts to call state only; a wave-like animation
  is fine as a *style*, but nothing analyzes the audio signal.
- **No-ring mode:** the pure art, minimal chrome. Call state rides the **transcript line's
  accent** (a small dot/edge on the line pulsing the same state palette) — owner-approved with
  "we can tweak it as we see it"; feel-round material, not a locked geometry.

**Both modes keep the bottom cluster:** the live final-transcript line + **hang up** (reachable
from every state, §4.2). Text-over-art legibility inherits the three-state-backdrop lessons
(ROLEPLAY_PLAN §8.3a — the veil/scrim treatments, not new inventions).

**The refinement round (owner-approved 2026-09-12) — call furniture, all ratified:**

- **Mute joins hang up** — the one extra control (core call furniture: cough, doorbell,
  someone in the room). **ONE mechanism (delta round F3 — the ratified text named two
  incompatible ones):** mute = `track.enabled = false`, and the worklet KEEPS SENDING the
  now-silent frames — disabling the track silences the samples but does not stop
  transmission, and Speaches needs to OBSERVE silence to endpoint a half-utterance; starving
  it of frames would leave the utterance open to merge with post-unmute speech.
  **Mute's loop rules (coherence sweep 2026-09-12):** muting mid-utterance DISCARDS that
  utterance — the silent frames make the server endpoint the half-speech, and a final
  arriving while muted is dropped, `waitingFinal` clears (mute means "don't send that");
  `userSpeechActive` clears on mute; unmute re-enables the track, a fresh utterance. The ring/accent wears a distinct STATIC muted look — no
  pulse implies no ear, so the muted state must be visually unmistakable. Tap-to-interrupt
  still works while muted.
- **Tap to interrupt (owner-ratified 2026-09-12, the ChatGPT voice-mode pattern):** during
  `speaking`, tapping the overlay outside the control cluster fires the §4.3 sequence — the
  manual twin of voice barge-in, present in BOTH ring modes and regardless of the `barge_in`
  toggle. Whether it earns a first-run micro-hint is feel-round material.
- **The transcript line shows what the ear heard YOU say** (catch mishearings instantly); the
  reply is what you *hear*, and lands in the chat as always.
- **…and the reply as CAPTIONS above it — `voice.live.captions`, a Conf row beside the ring's,
  ships ON (owner ask 2026-09-22):** the last assistant message's text, three lines tall,
  scrollable, edge-faded and auto-following as it streams — the half of the conversation the call
  screen could not show, because re-reading it meant hanging up. Client-side from the chat store
  (no wire field); snapshotted at mount like `ring`, and scoped to turns that START after the call
  does — the §4.5 exclusion the read-along override already makes for the mouth.
- **The in-overlay confirm row** (§4.5) is part of the overlay's state set — **Allow and Deny
  ONLY** (coherence sweep: the chat card's other two stay chat-card affordances — an
  "always"-grant deserves the chat's full context, and "edit" is keyboard territory; the full
  four-button card remains in the thread, e.g. after a hang-up).
- **Terminal faces:** `error` and `ended` both carry "call again" + close; a user hang-up
  closes the overlay instantly with no terminal screen.
- **Hang up = immediate full teardown:** capture closed, WS closed, C3 killed mid-word,
  Wake Lock released, the read-along override cleared. An ended call does not keep talking.
- **The Android back button hangs up** (the kit overlay back-trap pattern), never navigates
  the app under the overlay.
- **No-art fallback:** an agent with neither background nor avatar gets the plain theme
  surface + the ring at its fallback anchor.
- **Audio priming:** the call-start tap primes the `<audio>` element (today's element has NO
  gesture priming — scouted; this kills the mobile silent-first-reply failure mode).
- **The focal→screen helper is greenfield** (scouted: everything today terminates in CSS
  percentage strings; nothing computes where the focal point lands on screen) — a small pure
  sibling in `lib/focalPosition.ts`, unit-tested. **Coordinate discipline (delta round F9):**
  the anchor is computed in OVERLAY-LOCAL coordinates from the backdrop element's own box
  (one `ResizeObserver`), never cached against the window — Android's URL-bar/keyboard
  transitions move the VISUAL viewport without a useful `window.resize` (the repo already
  listens to `visualViewport.resize` + `scroll` for exactly this); if any viewport offset
  enters the calculation, reuse that pair.
- **Second door DEFERRED (owner-ratified — do not re-propose ad hoc):** v1 has ONE entry
  point, the composer. A call door on the agent gallery's cards waits for regular use to ask.

**The entry affordance — RATIFIED 2026-09-12 (owner + [R69](./research/R69-hold-to-record-gesture.md)):
the dual-mode mic.** ONE button in the mic's existing slot in all three composer variants — no
second button (owner ruling: composer space). Every threshold/curve below is R69-sourced (its
§9 parameter table); the constants live named in one place in the gesture hook, not scattered.

- **Tap = mode switch, from IDLE only** (mic↔call icon morph + a transient "hold to
  record"/"hold to call" hint; Telegram's hint retirement: ≤3 shows, counted only when fully
  visible, retired forever on the first successful lock; hint counters are DEVICE-LOCAL — the
  ui store, not config). A locked recording owns its tap (= stop); the standing call chip
  owns its tap (= start call, the button inert until the chip expires). **No mode memory
  (owner ruling): boots mic, every load.** Call mode is offered only when §5.1's `live` bit
  is up.
- **The gesture machine** — one shared hook replacing the current press-visual wiring, consumed
  by all three variants. Pointer Events + `setPointerCapture`, `touch-action: none` on the
  button (the spec's ONLY defence against pan — R69), contextmenu suppressed (safe on Fennec
  ≥91, the old Gecko touch-stream bug is fixed), no `onClick` beside the pointer machine (a
  click still fires after `lostpointercapture` — R69 risk list). Press → **150 ms activation**
  (Telegram's tap-disambiguation window for dual-mode buttons — deliberately NOT the 400 ms
  platform long-press; 8 px movement slop).
- **Mic mode:** recording starts at activation; **release = stop, then hand to today's
  dictation pipeline unchanged** — upload → draft append → auto-send iff the existing
  `stt_auto_send` row is on (the gesture changes CAPTURE ergonomics, not send policy; with
  auto-send off, release lands the transcript in the draft for review, as dictation does
  today). **Swipe up 56 px = lock hands-free** —
  latches on crossing (Telegram); the button becomes tap-to-stop and a visible tappable cancel
  appears (the field's tap-twin rule: every gesture affordance grows a tap twin once the hand
  is free); silence auto-stop stays live in locked mode. **Slide left = cancel** — distance
  min(35% viewport, 140 px), cancel commits on release past 55% (the relative form: at 360 px
  a fixed distance leaves no travel — R69). **Recordings under 1000 ms are discarded with a
  teaching toast** (Signal's floor — kills accidental blips and teaches the hold; the check
  is client-side BEFORE upload — a blip costs no POST).
  **`pointercancel` NEVER loses audio** (the field's iron rule): an unlocked in-progress
  recording PROMOTES TO LOCKED (Telegram's answer), never silently discards.
  **Axis commit (delta round F6 — R69 said pick one; the amendment forgot to):** once
  movement leaves the 8 px slop, the gesture LOCKS TO ITS DOMINANT AXIS and only that axis
  is evaluated — a diagonal thumb arc can otherwise cross the 56 px lock line AND the cancel
  distance, leaving the outcome to handler order. **The arming latch (delta round F5, the
  R69 §10 open edge):** release while `getUserMedia` is still pending CANCELS the pending
  start — a stream resolving after the cancel is stopped immediately, never an ownerless
  recording; a `pointercancel` during acquisition latches the promote-to-lock intent
  instead.
- **Call mode:** hold raises the "slide up to call" pill; **swipe up 56 px, committing on
  RELEASE** — a recorded deliberate deviation from the lock's latch-on-crossing (R69 found NO
  field precedent for gesture-started calls; a call costs more to undo than a lock, so it gets
  the release confirmation). Release *without* the swipe leaves the pill standing ~2 s as a
  tappable "Start call" chip — the tap twin, and the single-pointer alternative WCAG 2.5.1
  requires for a path-based commit.
- **Keyboard/AT:** the Telegram-Web degradation IS the shipped alternative (R69 verified their
  web client: tap-toggle + Esc-cancel, no hold): keyboard activation runs the current mode
  toggle-style (start/stop recording · start call), Esc cancels, the mode rides the
  `aria-label`.
- **Animations** (transform/opacity only): grow 300 ms `cubic-bezier(0,0,0,1)` to ~2.2×; lock
  snap 250 ms `cubic-bezier(.23,1,.32,1)`; cancel/exit 200 ms ease-both; fades 150 ms —
  Telegram's verbatim curves, M3-consistent. Reduced motion routes through the existing
  UIState/Appearance switch, never a raw media query (the standing pattern + R69's risk list).
- **Haptics are decoration only** (`navigator.vibrate` no-ops UNDETECTABLY on Fennec — returns
  true, does nothing, R69): 20 ms on record start · a catch pulse on lock/commit · 50 ms on
  cancel, always layered over an already-visible state change.

## 7. Slice ladder (each: pinned Opus build → main-seat audit → blind Emma round → fix wave → close)

- **S0 — probes + the ear smoke (gates the design's one open branch):** the AEC device probe —
  now small (R68 §3.3): a dev-only page reading `getCapabilities()/getSettings()` under
  `echoCancellation: {ideal:"all"}` + one acoustic leak check, run by the owner on Chrome +
  Fennec (~5 min each); the Fennec mic-permission persistence check rides the same sitting; a
  server-side smoke script proving emma → Speaches `/v1/realtime?intent=transcription`
  end-to-end **against the resident Parakeet model** (VAD events, a real transcript from a real
  clip — this also exercises the fork's own `e093d8b` no-speech path; the Speaches server
  itself is NOT touched — owner ruling, §5.2). The smoke also pins **which realtime session
  fields the fork honors** (model name, language — the session's model resolves through the
  provider registry like `voice.stt` does). The same phone sitting also buys **R69 §11's owed
  gesture probes** (a dev page: `pointercancel` incidence during a captured hold+slide, and
  whether `touch-action: none` survives the address-bar collapse — Honor 20, Chrome + Fennec).
  **Rules `echo_workaround` and confirms the Speaches contract before anything is built on
  it.**

  > **S0 AS-BUILT + CLOSED (2026-09-12, owner in the loop live).** Build `da4343f` (pinned Opus):
  > `frontend/probes/aec.html` + `frontend/probes/gesture.html` (Vite dev-served at
  > `/probes/*.html`, never rollup inputs — dev-only by construction) + `tools/speaches_realtime_smoke.py`
  > (kept in-tree: it re-runs on any Speaches change and is the contract evidence S1's mock must
  > mirror). Gate 6/6, independently re-run by the main seat. Raw logs: session scratchpad
  > `s0-smoke/` + `s0-smoke-postfix/`.
  >
  > **① The ear was DEAD on emma's deployment — found, ruled, fixed, re-proven.** Every
  > `intent=transcription` session died at close **1006** (no close frame) right after commit,
  > before any transcript, 3/3. Root cause (source-verified in the fork): with `LOOPBACK_HOST_URL`
  > unset, `speaches/dependencies.py:get_transcription_client()` drives an `ASGITransport` around
  > the **bare stt `APIRouter`** (the upstream author's own comment: *"this might not work as
  > expected… TODO: verify"*) — FastAPI asserts (`fastapi_middleware_astack not found`), the
  > resulting `APIConnectionError` escapes the `except openai.APIStatusError`-only catch in
  > `input_audio_buffer_event_router.py`, and the event-listener TaskGroup tears the session down.
  > The HTTP isolation leg proved the stack healthy (same clip → exact transcript in 2.2 s), so
  > only the realtime wiring was broken. **OWNER RULING (2026-09-12, a one-item amendment to the
  > §5.2 "server untouched" posture): set `LOOPBACK_HOST_URL=http://127.0.0.1:9000`** — applied as
  > the systemd drop-in `~/.config/systemd/user/speaches.service.d/20-loopback-url.conf`
  > (commented with this mechanism; delete to revert). ⚠ **That file lives OUTSIDE every repo — a
  > Speaches reinstall must recreate it** (also flagged in the §0 seams row). Post-fix smoke:
  > **speech PASS** (session.created +8 ms · VAD `speech_started` +44 ms after stream start ·
  > endpoint ≈240 ms after the clip ends · the exact sentence back) · **silence PASS** (zero false
  > VAD triggers over 4 s; forced commit → `''` — the fork's `e093d8b` no-speech patch now proven
  > THROUGH the realtime path, not just HTTP).
  >
  > **② The pinned wire contract (source-read + live-verified; S1 builds against THIS, not the
  > OpenAI docs). ⚠ TWO R70 AMENDMENTS (2026-09-13, measured + source-verified by the main seat
  > at `input_audio_buffer.py:36/:85`): (i) the silence-case "forced commit → `''`" below is the
  > ONLY safe commit — a commit while speech is OPEN (`speech_started` without its stop) hits
  > `assert audio_end_ms is not None` and KILLS the session at 1006, words lost (reproduced
  > 2/2); the relay must hold a commit-safety invariant, and a release flush is a relay-side
  > SILENCE BURST (measured release→text 530–830 ms), never a raw commit. (ii) "one final per
  > pause" overstates the VAD: Silero runs over only the LAST 3 s of the buffer and cannot emit
  > `speech_stopped` before the buffer exceeds 3000 ms — short phrases COALESCE; the latency law
  > is `max(silence_ms, 3000 − phrase_ms) + ~0.5 s`. Both bind the CALL loop too (S2a/S4
  > expectations). Full mechanics = R70 §§4–5.** `model` is a REQUIRED query param; handshake refusals are **HTTP 403** (bad
  > key, missing model) while session death is a **bare 1006** — two different failure classes for
  > the relay's error taxonomy. Uplink is **text frames only**: one binary frame kills the session
  > (⇒ the relay re-encodes to JSON+base64, ~33 % overhead on the loopback leg — the plan's binary
  > uplink stops at the relay). Audio is base64 **PCM16 mono 24 kHz hardcoded** (no negotiation;
  > §3.1's stateful resampler is mandatory). Server VAD defaults 0.9/0/550 ms; Silero runs
  > **synchronously on the event loop per append** (S1 measures `frame_ms` 40 vs 100); sessions
  > hard-expire at **30 min** (`asyncio.timeout` — plan the reconnect); **no server-side
  > backpressure** (unbounded pubsub queues — the relay's bounded queue is the only backpressure
  > in the chain). `session.update`: **always send the full 5-field `turn_detection`** (a partial
  > object validates as `NotGiven` and is SILENTLY dropped), always swallow the unavoidable
  > spurious `prefix_padding_ms` error event (the update still applies), and `language` can never
  > be reset to null (`exclude_defaults` drops it). Honored: `model` ·
  > `input_audio_transcription.model`/`.language` · `temperature` · `voice` · `instructions`;
  > `input_audio_format` is rejected-with-error but the update is still acked. Query params
  > `language` and `transcription_model` are honored (`transcription_model` wins); alias
  > resolution happens at the loopback STT call, not the WS layer.
  >
  > **③ The echo probes (owner phone sitting, Honor 20 · Chrome 152 · Fennec 151) — the WHY
  > behind the §8.3 ruling, measured not assumed:** **Chrome honors `echoCancellation:"all"`**
  > (`getSettings()` echoes `"all"` — R68's headline claim now device-verified) **and it is a real
  > subtractive canceller**: control leak 53.7 dB → the AEC run gated the capture to digital
  > silence, and the talk-through retest proved it is NOT a mute — the owner's voice rode through
  > at −18 dBFS broadband *while playback ran*, tones down at −46 dBFS (vs −13.8 raw). The mic
  > stays alive during `speaking` ⇒ voice barge-in is viable on Chrome. **Fennec's AEC does
  > nothing against the phone's own playback**: capabilities are `[true,false]` (no string modes;
  > even `exact:"all"` silently coerces to `true` — no OverconstrainedError, exactly the WebIDL
  > degradation R68 predicted), and the leak test measured the played tones at **near-full volume
  > in the capture** (−4.3 dBFS, AGC-boosted above the 54 dB control) — R51's "Firefox cancels all
  > browser audio" hope is DISPROVEN on this hardware. An open Fennec ear during `speaking` would
  > false-trigger barge-in and transcribe the character's own words into the turn — which is why
  > the ear-hold is the honest degrade there, costing only hands-free interruption
  > (tap-to-interrupt is every browser's interrupt, §4.3). Fennec mic permission persists after
  > one grant (its Permissions API keeps reporting "prompt" — cosmetic, behaviorally fine).
  >
  > **④ The gesture probes (R69 §11's owed device evidence — S0.5 is GREEN-LIT as ratified):**
  > under the production posture (`touch-action:none` + `setPointerCapture` + `user-select:none`
  > + contextmenu prevented) **zero `pointercancel` on both browsers** — Chrome 8/8 gestures clean
  > incl. a 10.7 s hold with a 446 px up-slide and a 302 px left-slide; Fennec 4/4 incl. 277 px up
  > and 222 px left — with page scroll 0 and `visualViewport.height` delta 0 throughout: **the
  > address bar never moved during a captured hold.** The controls prove the posture is
  > load-bearing, not cargo cult: without `touch-action:none`, Chrome cancels within ~1 s at ~9 px
  > of drift (4/4), Fennec once cancelled and once scrolled 88 px while still streaming events.
  > Long-press fires contextmenu on the button (must STAY prevented) and the selection magnifier
  > appears only on unprotected text. Every §6 gesture element (hold · 56 px lock · relative
  > slide-left cancel) is deliverable exactly as designed.
  >
  > **Process note (the S0 deviation from this section's cadence header, main-seat ruled, owner
  > informed):** the blind review round deliberately rides S1 — the probe pages are throwaway
  > once the sitting closed, and S1's build re-verifies the contract table against source; S0 got
  > the pinned-Opus build + a main-seat line audit + an independent gate re-run instead.
- **S0.5 — the entry gesture (FE-only; owner-ratified early so the feel round runs on real
  dictation before the call exists):** the §6 dual-mode mic — the shared gesture hook +
  animations + the mic-mode leg live against today's `useDictation` (hold · lock · slide-left
  cancel · the 1000 ms floor · hints · the pointercancel promote-to-lock rule); call mode's
  chrome ships but stays hidden until the `live` bit exists (S1/S2). Parameters tuned by the
  owner's feel round against R69's table.

  > **S0.5 AS-BUILT + council-CLOSED (2026-09-12; the owner FEEL ROUND still owed — their word
  > closes the slice).** The full cadence ran in one session: pinned Opus build `86de7b0`
  > (useDictation widens) + `faa62b5` (the gesture) → main-seat audit rider `7a60309` → blind
  > Emma round **SHIP WITH FIXES (5 MED · 2 LOW, open sweep "none")** → fix wave `05f67b3`
  > (pinned Opus) → her confirm **BLOCKED (2 survivors)** → main-seat micro-wave `0516490` →
  > her micro-confirm **RESOLVED — SHIP** (sweep "none"). Gate 6/6 ×3 at the three tips;
  > FE 3,207/180 · BE 2,377 (counts in QUALITY.md); every claim arm red-proven by scripted
  > single-mechanism reversion.
  >
  > **Shape (per the §6 ratified design):** `kit/composer/useMicGesture.ts` — a PURE
  > `micReduce` machine + thin pointer wiring (the `useDragReorder` shape), every R69 §9
  > constant named+traced in that one file and pinned verbatim by a parameter-contract test;
  > `useDictation` WIDENED to `{status, toggle, start, stop, cancel}` — one recorder, the F5
  > arming latch as an abortable TOKEN, `cancel` as a discard flag consulted in the ONE
  > `onstop`, the 1000 ms floor client-side pre-POST; `MicGestureChrome` — ONE component
  > rendered by all three variants; hint budget = two DEVICE-LOCAL UIState fields; call chrome
  > built DARK behind `VoiceStatus.live?` (false until S1; `startCall` a named no-op stub,
  > TODO(S2a)); `aria-pressed` gone, the mode rides the accessible name; `touch-action:none` +
  > `user-select:none` STATIC on the mic class; e2e `micGesture.spec.ts` (3 arms, both
  > projects, real pointer capture on the built app).
  >
  > **The one build deviation (stop-clause, measured):** the chrome is a positioned SIBLING of
  > `.kit-composer`, not a child — sheet/line bars compute `overflow: hidden` (probe children
  > above/beside the bar were not hit-testable; stacked was) — so the 2.2× circle is painted by
  > the chrome, not by scaling the button (Telegram's own overlay-view shape), anchored to the
  > measured mic centre via `--mg-x/--mg-y/--mg-size`. Verified: un-clipped in all three
  > layouts; `--composer-h` measured invariant (92/47/50 px) before/during/after the grow.
  >
  > **The review trail's mechanisms (all folded):** main-seat audit — the chip-stage button is
  > INERT (§6's words; the chip's own tap starts the call, never a down-event) · the keyboard
  > door measures the anchor before `keyStart`. Emma F1 — a `startGen` generation guard keeps a
  > stale aborted acquisition's `false` from idling the NEXT gesture, and an aborted attempt's
  > late `getUserMedia` rejection is silent (no toast, no detector teardown). F2 — non-null
  > `recRef` OWNS the recorder lifecycle (stop/cancel flip `state` synchronously while terminal
  > events are QUEUED); `start()` refuses while owned; `onstop` is the ONE releasing terminal
  > (first statement, so the discard branch releases too; `upload(mime)` takes the mime from
  > the closure) — and per her confirm sweep, `onerror` deliberately does NOT release (the
  > platform fires the final `dataavailable`/`stop` AFTER an error; the error arms the discard
  > flag, F4, and the queued stop closes out). F3 — accepted, prescription RE-DERIVED (hers
  > would have broken the click-swallow): `armClickGuard` re-asserts the session flag and runs
  > for EVERY button pointer; the activation timer + machine send are pid-guarded; the timer
  > arms only on a real idle→press transition; `locked` adopts a stop pointer only while
  > unowned (`pid === -1`). She ruled the re-derivation sound. F5 — a `live` drop closes
  > `callArm`/`chip` AND a call-mode `press` (its snapshotted mode would re-enter `callArm`
  > off the still-armed timer) through the existing `escape` signal. F6 — the reduced-motion
  > `.mg-rail.armed` transition gate landed; F7 — the parameter pin.
  >
  > **Residuals (recorded, none owed now):** the 200 ms cancel/exit curve is NOT built — the
  > chrome unmounts instantly; feel-round material (the kit.css comment says so) · a
  > pointercancel-PROMOTED lock retires the teaching hint (accepted: the locked UI appearing
  > is itself the teaching) · the 1000 ms floor + its "hold the mic" toast copy apply to the
  > keyboard path too (deliberate one-rule scoping) · `toggle` during `sending` can surface
  > the once-per-load HTTP nudge · `.mic-gesture` z-index 6 clears the tab bar by ~2 px today
  > — re-measure if any affordance grows · wake-lock-during-a-hold deferred to S2 (R69 §9's
  > last row) · chrome geometry (track width, rail −22 px, hint −60 px) is first-pass,
  > owner-tuned. **Owed: the owner's feel round on real dictation (:5173 serves it live) —
  > hold/lock/slide-cancel/hints against R69's table; their word closes S0.5 → S1.**
  >
  > **THE FEEL-ROUND WAVE (2026-09-13, owner live in conversation — five findings OF-1..OF-5,
  > each restated + confirmed before building; the wave ran the full cadence and is
  > council-CLOSED: blind Emma SHIP WITH FIXES (2 MED, sweep "none") → fix wave → her confirm
  > RESOLVED — SHIP).** Build `c654834` (pinned Opus) + review fixes `127234a` (main seat).
  > Gate 6/6 ×2; FE 3,230/181 (counts in QUALITY.md); red-proofs: 13 scripted reversions in the
  > build + 2 in the fix wave, plus a real-engine calc-validity probe.
  > **The five rulings, as shipped:** ① grow 2.2× → **1.8×** via the ONE `--mg-grow-scale` knob
  > (keyframe + reduced-motion both consume it) · ② the lock pill COMPRESSES into a circle
  > tracking `--mg-lift` (three grid-stacked layers, transform/opacity only; recorded trade: an
  > ellipse at rest — the divisor counter-scale was rejected as Fennec-risky, and the ruled
  > target is the exact END circle; call mode's compressed circle wears a phone glyph, ships
  > dark, S2a owns its proportions) · ③ the REAL voice-level halo — metering SPLIT from the
  > auto-stop policy in `useDictation` (`armDetector` arms for every recording; the STOP
  > decision stays `autoStopOn`-gated), level flows through the assignable `meter` ref →
  > `--mg-level` written imperatively at 10 Hz (no React re-render), bulge ×0.73 = R69 §1.6
  > verbatim (the briefed 0.5 measured invisible inside the 1.8 disc — builder catch),
  > `METER_FULL_RMS = 0.12` feel-tuned · ④ the hint is a translucent borderless BUBBLE with a
  > tail pointed at the mic, right above the button (`MicAnchor.rx` measured for the
  > right-anchored tail; R69 §1.7 timings kept), and the too-short teaching moved into it via
  > the null-safe `onTooShort` ref (toast = fallback; `MIN_CLIP_MS` + the rule stayed in
  > `useDictation`) · ⑤ the locked CANCEL is the TOOLS-MENU TRIGGER morphed (owner-corrected
  > from the paperclip mid-design): sliders ⇄ ✕ cross-fade, the whole aria contract swaps, the
  > offer travels through the new `store/micCancel` single-nullable-slot store (the trigger is
  > composed once in DefaultRoot and can see no variant's gesture; last-writer safe — one
  > composer mounts at a time); the floating `.mg-cancel` DIED.
  > **The review's two MEDs (both folded `127234a`):** the metering split had dragged the
  > hidden-page stop along — locking the phone killed a default-mode recording; the visibility
  > listener is now POLICY-gated (the meter poll throttling is decoration) · an open tools
  > sheet survived the morph — the trigger now releases the `menu` overlay whenever the morph
  > is active, and nothing re-opens it mid-morph.
  > **⚠ Durable:** a "split metering from policy" refactor must enumerate EVERY decision the
  > old arming carried — the visibility stop rode along invisibly (the new tests state the
  > split from both sides, hidden-page included).
  > **Owed now: the owner's glance at the WAVE itself** (:5173 — the 1.8× circle · the pill
  > compress · the talk halo · the bubble + its tail · the ✕ morph) — their word closes
  > S0.5 → S1.
  >
  > **ROUND 2 (2026-09-13, same day — the owner's glance at the wave came back "much better" +
  > five nudges; built main-seat, council-CLOSED: Emma micro-round NOT RESOLVED on pin
  > coverage + stale comments (runtime verified fully sound — she Chromium-measured heights at
  > lift 0/.5/1 both modes, centring, snap, reduced motion, the `:has` cost) → rider →
  > RESOLVED — SHIP.** Commits `c057459` (the five nudges) + `c81780c` (the rider). Gate 6/6
  > ×2; FE 3,234/181.
  > **The five, as shipped:** grow 1.8 → **1.65** (the knob) · **the pill is a TRUE STADIUM** —
  > `.mg-rail-skin` is a real box whose HEIGHT tracks `--mg-lift` under `border-radius: 999px`
  > ("like the toggles"; the round-1 ellipse rejected by eye). ⚠ The height is a RECORDED
  > exception to §14.11's transform-only rule: height IS the mechanism (the composer auto-grow
  > precedent), 28px wide, absolutely positioned, fenced by `contain: layout`; reduced motion
  > keeps two discrete states · the hint gap 15 → **8px** · the ✕ **18px + a 2.6 stroke**
  > (scoped to the morph face) · **the composer placeholder YIELDS while recording**
  > (hold + locked) via `body:has()` off the chrome's `data-stage` (the seam-scrim precedent) —
  > the slide-to-cancel was unreadable across the "type a message" text; proven in a real
  > engine by the e2e `::placeholder` assertion.
  > **The rider (her blocks):** the height pin holds the EXACT calc expression; a
  > rules-mentioning sweep bans `scaleY`/transform-clobbers on the skin across every arm; the
  > grow knob gains a no-raw-scale-literal sweep — all three red-proven against her named
  > drift classes; three stale transform-only/1.8× comments rewritten to the height mechanism.
  > **Owed: the owner's glance at round 2 — their word closes S0.5 → S1.**
  >
  > **ROUND 3 (2026-09-13, same day — the owner live: round 2 "looks good" + four clarifications;
  > main-seat build, council-CLOSED: Emma micro-round BLOCKED (light-theme pill contrast measured
  > ~1.05:1 + two pins admitting fakes) → rider → RESOLVED — SHIP, she pixel-measured the fix) —
  > and the owner's word ("okay looks good, lets handoff") CLOSES S0.5.** Commits `484102d` +
  > rider `0d1d429`; gate 6/6 ×2; FE 3,241/181. **The four:** ① the pill's outline REMOVED (fill
  > only; the round-3 review then found the borderless pill INVISIBLE on light themes — silhouette
  > restored by the bubble's own soft shadow, borderless kept; a shadow-presence pin) · ② the
  > bubble tail is a clip-path TRIANGLE flush BELOW the translucent body (`top: 100%`, apex
  > centred via `--mg-rx − 17px`) — the rotated square double-painted the alpha and showed
  > through; pinned as the exact 3-point polygon + geometry · ③ **a WRITTEN draft lifts the
  > slide-to-cancel track above the bar** to the hint's height (the owner's own design; the draft
  > must stay visible) — `lifted` prop wired in all three variants, the exact transform arithmetic
  > pinned; Emma Chromium-verified zero track/hint overlap at 360px in all three · ④ `--mg-bulge`
  > 0.73 → **0.35** (owner: too much size difference; overrides R69's Telegram value, trace kept).
  > **⚠ Durable (her round-2/3 pin lessons, now the house bar for source pins): hold EXACT
  > expressions, sweep EVERY rule mentioning the selector, and red-proof against the named bypass
  > — fragment checks admit fakes** (a 4-point "square" polygon passed "any polygon"; a magic
  > offset passed "mentions the knob").
- **S1 — the BE relay:** `voice.live` config + `/voice/status` delivery + the WS route + the
  relay session (mock-Speaches tests: framing, resampling, backpressure, caps, error taxonomy,
  bearer never in logs). **+R70 (2026-09-13): the relay owns the COMMIT-SAFETY invariant (a
  commit while speech is open kills the session — the §7-S0 amendment) and a `flush` control
  message implemented as a relay-side silence burst (client-sent bursts would violate §3.1's
  own rate ceiling) — S2.5's release flush and the call loop's edges both ride these.**

  > **S1 AS-BUILT + council-CLOSED (2026-09-13, one session; the full standing cadence).** Build
  > `beead72` (pinned Opus, 16 files +2342/−19) → main-seat audit (gate independently re-run; all
  > nine declared deviations ACCEPTED) → blind Emma round (hermes lane, `--ignore-rules`; the
  > **S0 blind debt rode this round** — her light pass on `tools/speaches_realtime_smoke.py`
  > found nothing to fix) **SHIP WITH FIXES — 4 MED, open sweep "none"**, commit-safety /
  > resampler / teardown / secrets / registry all explicitly confirmed sound → fix wave
  > `0fb7c56` (pinned Opus) → her confirm **F1/F2/F4 RESOLVED with line proof + F3 BLOCKED on
  > the MIRROR ordering** → main-seat waves `24336eb` + `a01ae76` → her micro-confirm
  > **RESOLVED — SHIP, sweep "none"** (she re-ran the 73-arm suite herself). Gate 6/6 ×4 at the
  > four tips; **BE 2,462** (counts in QUALITY.md); red-proofs: 11 scripted reversions in the
  > build, 10 in the fix wave, and the two constant-pad arms proven RED against the pre-fix
  > relay.
  >
  > **Shape (deviations from the §5.1 letter, all main-seat ruled):** `LiveCfg(VoiceServiceCfg)`
  > takes the house `provider/model/fallbacks` pointer shape, NOT the plan's literal
  > `target: ""` — a blank provider (and no fallbacks) REUSES `stt_chain` verbatim so a
  > misconfig is reported against the section the operator actually wrote; `LivePolicy.language`
  > always comes from `voice.stt` (one ear-language knob however the chain is pointed) · **no
  > failover** — a stateful WS cannot re-dial mid-stream; `VoiceClient.live_target()` hands the
  > relay hop 1 and the degrade is push-to-talk · the `live` status bit = realtime chain AND
  > TTS AND `voice.live.enabled` (`voice.enabled` master outranks inside `configured()`);
  > `live_call` delivers the client knobs shape-only · `core/audio.Pcm16Resampler` carries its
  > read position as an EXACT RATIONAL (float phase breaks `feed(a)+feed(b) == feed(a+b)`) ·
  > `LiveSessionSlots` = the D38 no-await check-and-set on `app.state` · the Origin rail =
  > same-host + `allowed_origins` exact strings, pre-accept; busy is a typed post-accept
  > `busy` + 1013 · `websockets>=14` promoted to a direct dep · extra bounded-Field knobs:
  > `relay_queue_ms`, `start_timeout_s`, `allowed_origins`.
  >
  > **The wire AS BUILT (the S2a/S2.5 contract):** uplink = text `start
  > {sample_rate 8000..96000}` first (within `start_timeout_s`), then binary pcm16 LE mono
  > frames (≤ `max_frame_bytes` AND ≤ 2× `frame_ms` of audio at the declared rate AND under a
  > rolling 2 s window carrying BOTH a frame-count and a 2×-realtime ms budget), plus text
  > `flush`/`stop`; anything else = protocol close 1008. Downlink = `state`
  > (`ready`/`degraded`+overflow/`ended`) · `speech_started`/`speech_stopped` ·
  > `transcript {text, final: true}` · `error {code, message}`. Codes → closes: `busy`→1013 ·
  > `protocol`→1008 · `upstream_refused`/`upstream_lost`→1011 · `upstream_error`→ session
  > continues · `session_limit`→1000 ("call time limit reached"). Pre-accept refusals
  > (origin/gate) are handshake failures — a browser sees HTTP 403. **`flush` has NO ack** (the
  > endpoint's own `speech_stopped`+`transcript` are the response) and **`stop` discards
  > unendpointed audio** — S2.5's release MUST be flush → await the final (client-side
  > `tail_wait_ms`) → stop.
  >
  > **⚠ THE FLUSH AS BUILT AMENDS R70 §4's formula (two review rounds forced it):** the burst is
  > the CONSTANT `max(3000, silence_ms) + 200` ms whenever the session has ever fed audio (the
  > never-fed session is the only relay-side no-op; the `_audio_seen` bit never clears). R70's
  > `3000 − fed_ms` shortening assumed a per-buffer count the relay cannot keep — `committed`
  > events cannot be correlated with what was fed, so the count goes stale in BOTH directions
  > (processed-stale: the reset erased the next phrase's count and suppressed a needed burst;
  > unprocessed-stale, the confirm round's mirror: the count stayed high and shrank the burst
  > below the 3 s floor — words lost either way). The constant pad costs loopback appends only:
  > Silero endpoints the moment the threshold is crossed mid-burst, and the tail lands in the
  > rotated buffer as leading silence that only helps the next endpoint's 3 s floor. The flush
  > is also a **DELIVERY BARRIER** (`Queue.task_done()`/`join()`, balanced on the eviction
  > path): it returns only when the whole burst has gone upstream, so post-flush mic audio can
  > never evict queued silence. **COMMIT-SAFETY holds in the strongest form: the relay never
  > sends `input_audio_buffer.commit` on any path** (red-proven; the invariant + the R70
  > citation live at the one tempting place, `_flush`).
  >
  > **The F1 ruling (recorded honestly):** the same-host Origin rule does NOT defend against
  > DNS rebinding (the authority is attacker-selected) — but rebinding equally bypasses the
  > no-CORS defence on the app's ENTIRE unauthenticated HTTP surface on plain-HTTP paths, so
  > the WS route adds no new authority class (Emma concurred: "the re-scoping is honest"). The
  > app-wide fix is the ALREADY-RECORDED **D65-R1** (HARDENING_PLAN §8.2 / SECURITY_MODEL §2.7,
  > `TrustedHostMiddleware`) — Phase 19's court.
  >
  > **⚠ Durable lessons:** per-buffer audio accounting hung off an uncorrelatable event stream
  > is untrustworthy in BOTH stale directions — when an optimization needs state the protocol
  > cannot give you, DELETE the optimization (burst-when-uncertain; net −6 lines) · a
  > `Queue.join()` barrier needs `task_done` balanced on EVERY consume site, evictions included
  > · ops: `setsid cmd` FORKS — liveness-check the child PID, never the wrapper's.
  >
  > **Residuals riding later slices (none owed now):** whether Tailscale Serve preserves the
  > Host header is EMPIRICAL for S2a's device leg (`allowed_origins` is the designed escape) ·
  > the Vite dev proxy needs `ws: true` for `/api/voice/live` (S2a) · `tail_wait_ms` +
  > `dictation` + idle/max knobs are S2.5 client-side config (R70 §9.2–9.3) · a slow ear can
  > emit several `degraded` frames per overflow burst and lengthen the reader's occupancy —
  > S2b presentation/hysteresis material · rebinding = D65-R1, Phase 19 · the relay judges
  > frame duration at the DECLARED rate (a lying client is bounded only by the byte caps —
  > unchanged posture, undetectable).
- **S2a — the FE call loop, WITH basic barge-in (council F8 — an open-mic loop that cannot
  be interrupted is not a reviewable slice; SPLIT from the old S2 by delta-round F10 — the
  monolith was no longer one reviewable change):** capture worklet + WS client + the
  `useLiveCall` machine (§4.2, incl. the new chat-store turn seam — F3 — with the
  normalize-on-202 fix and the F8 accept/refuse send result) + a MINIMAL overlay (backdrop +
  state + transcript line + hang up) + submit-through-`runComposer` + read-along forced on
  (the F4 audioController surface: prime, call override, kill reuse) + Wake Lock + degrade
  states + the plain kill: speech during `speaking` (energy floor, §4.3) stops audio and
  cancels a live turn. (End of S2a = a full interruptible conversation on the S0-ruled echo
  branch.)

  > **S2a AS-BUILT + council-CLOSED (2026-09-13, one session; the standing cadence, twice around).**
  > Build `83d8e63` (pinned Opus, 26 files +3336/−58, 19 red-proofs) → main-seat audit (gate
  > independently re-run; all six declared deviations ACCEPTED) → blind Emma round (hermes lane,
  > `--ignore-rules`) **SHIP WITH FIXES — 6 MED, open sweep "none"** (chat seam · capture math ·
  > wire conformance · harvest-sig sharing explicitly confirmed sound) → fix wave `d40ee0d`
  > (pinned Opus: her six + the main seat's two — the once-per-call `retriedUpload` latch and
  > `cancelTurn`'s early-resolving re-entry) → main-seat rider `ff986ed` (the SECOND `playNext`
  > latch had F2's exact shape; + `transport()` accepting a gap-pause while `waiting`, preserving
  > the pinned pause-under-latch contract) → her confirm **BLOCKED** (the rider exposed the
  > pre-existing intent-only-"playing" resume arms) → main-seat micro-wave `08e3533` (resume
  > intent rides `wantPlay`; the real media `play` event is the ONLY door to "playing") → her
  > micro-confirm **BLOCKED** (a forward seek armed BEFORE the call carries the seek latch's
  > intent-"playing" in — the overlay only stops NEW seeks) → main-seat micro-wave №2 `8496c32`
  > (**the call DOOR: `startCall` = dismiss → prime → open** — answering a call silences pre-call
  > playback, so NO session and no phantom status of any kind survives into the machine's mount;
  > order load-bearing, the prime's already-playing guard would skip the unlock) → her
  > micro-confirm №3: the six-step walk closed at the door with a full generation-guard
  > verification, the auto-TTS knock-on ruled BENIGN (a bare `dismiss()` arms the feeder's
  > `abandoned` — the pre-call turn never re-docks), fix-sweep = comment drift only (folded same
  > session) — **RESOLVED — SHIP.** Gate 6/6 at every tip; final FE 3,356/189 · BE 2,462
  > (QUALITY.md).
  >
  > **Shape:** `hooks/useLiveCall.ts` — pure `callReduce` (the §4.2 phase + the two orthogonal
  > flags; the ONE pending queue serving all four holds and draining as ONE message; the ordered
  > kill awaiting `cancelTurn`'s settlement; hang-up-discards vs error-harvests) + thin wiring
  > (the leg fence beside the call-generation fence — `close()` only starts a handshake; trigger
  > A = worklet-RMS sustained ≥ `min_speech_ms`, armed only on `barge_in` AND a track reading
  > `echoCancellation: "all"` per the S0 ruling, floor 0 ⇒ disarmed until S4). `lib/liveSocket.ts`
  > — one typed leg, start-first, `bufferedAmount + frame > ceiling` ⇒ close 4000.
  > `lib/pcmCapture.ts` + `pcmWorklet.ts` — the Blob'd worklet (**`?worker&url` measured broken:
  > dev injects a bare import into the worklet scope; the build's asset is swept into the SW
  > precache**), float→pcm16 with remainder carry, `{ideal:"all"}`+noiseSuppression+mono,
  > `ctx.state` must reach "running" or the start fails loud. `store/chat.ts` — the F3 seam
  > (`getLiveTurn` from the three existing slots · `cancelTurn(ref, "draft"|"discard")` resolving
  > only when settled, re-entry sharing the in-flight promise · `stopTurn` a thin composite ·
  > `confirmOutstanding()`), **normalize-on-202 healing TYPED text during `awaiting_confirm`
  > too**, the F8 `SendOutcome` (existing callers unchanged).
  > `lib/composer.sendCallTranscript` — no sigils, no draft touch, staged attachments ride,
  > `"held"` → the machine's one-per-HOLD retry. `audioController` — `primeAudio()` (in-gesture
  > silent-WAV unlock), the call-voice override as a WAIT-UNTIL-FIRST-SETTLE GATE (not an id:
  > `message.start` adoption RENAMES the streaming message), `useMouthFailures()` (explicit tick;
  > the loading→idle inference as belt), and the HONEST mouth status: every silent wait publishes
  > `"loading"`, "playing" comes only from the real `play` event (the two catch-up latches, the
  > resume arms; the SEEK latch's out-of-call intent presentation stays pinned, in-call
  > unreachable by the door). `kit/CallOverlay` — minimal §6 (full-bleed `useActiveBackdrop` art +
  > veil · phase line · heard line · hang up; tap-outside-cluster = trigger B), z 55 (ladder
  > comment updated), focus trap via `lib/focusTrap` (Escape = hang up, deliberate), Wake Lock,
  > hidden ⇒ clean end. `store/liveCall` single-slot; mounted once in `DefaultRoot`; Vite proxy
  > `ws: true` (the §7-S1 residual, closed). e2e `liveCall.spec.ts`: a genuine AudioWorklet +
  > real binary frames + a `routeWebSocket` relay mock, both Chromium projects.
  >
  > **Main-seat rulings recorded:** tap-to-interrupt is IN S2a (§4.3's trigger B always exists —
  > and it is the only interrupt on a dirty-echo browser) · the trigger-A capability gate ships
  > here, the full Fennec EAR-HOLD stays S3 · `sendCallTranscript` does NOT spend the armed
  > one-shot composer scope (the pick belongs to the message the owner is typing; *superseded
  > 2026-09-24, D75 ruling: the agent pick is sticky, and calls follow it*) · the F2 drain
  > reclassification (loading = mouth busy; drain = playing|loading → paused/idle) accepted as
  > the ruling's completion · Emma's ttsAuto sub-claim overruled at the GATE (it only ever ADDS a
  > voice) — while the call DOOR's one-time `dismiss()` is the separate act that silences the
  > in-flight pre-call reply (micro-wave №2), the feeder's `abandoned` keeping it silent · a call
  > START silences pre-call playback by design (it would compete with the ear regardless).
  >
  > **⚠ Durable lessons:** an intent published as a playback STATUS is a lie some consumer will
  > eventually trust — status says what the element is DOING, intent rides its own flag
  > (`wantPlay`); two review rounds and two micro-waves traced every silent-"playing" window to
  > this one class · a reachability ruling must count state CARRIED ACROSS the boundary, not just
  > actions possible after it (the armed pre-call seek) · killing at the DOOR beats guarding
  > every path inside (no session survives ⇒ no phantom status can) · hermes lane ops: the CLI
  > double-forks (a premature "exited, 0 bytes" is the tell — take the OLDEST matching PID; the
  > COMPLETION signal is the output file going non-empty, a lingering same-argv worker can outlive
  > the finished run) and `-z --ignore-rules` persists no session ⇒ `--resume latest` silently
  > dies — confirm rounds must be SELF-CONTAINED (full notes in the second-opinion skill).
  >
  > **Residuals riding later slices (none owed now):** S2b — ring modes + the focal anchor ·
  > mute · the in-overlay confirm ROW (the queue-HOLD ships) · terminal "call again" faces ·
  > the Android back-trap (`useOverlayBackGuard` is the seam) · degraded-frame
  > presentation/hysteresis · the MiniPlayer's disabled pause during gaps. S3 — the Fennec
  > ear-hold · flaky-link reconnect edges · `transport()`'s uncaught bare `play()`. S2.5 —
  > `flush()` built and unused; the release choreography (flush → await final → stop). S4 —
  > `barge_threshold`/Tier-0 calibration · the Serve Host-header empiricism (`allowed_origins` =
  > the escape) · `voice.live.enabled` flips ON as that round's close. Phase 19 —
  > `confirmOutstanding` as a per-token selector scan. Deferred — dictation's own getUserMedia
  > constraints (R51 §6.1).
- **S2b — the overlay's presentation + furniture:** both `ring` modes (the focal-anchor
  helper with F9's coordinate discipline + the transcript-accent arm) · mute (F3's one
  mechanism) · the in-overlay confirm row · terminal faces + back-trap · the remaining §4.5
  edge rules not already forced by S2a's loop.

  > **S2b AS-BUILT + council-CLOSED (2026-09-14, one session; the standing cadence).** Build
  > `3461975` (pinned Opus, 26 files +1756/−163) → main-seat audit (gate independently re-run
  > 6/6; all three declared deviations ACCEPTED; **one audit finding**, fixed as rider
  > `29d7b65`) → blind Emma round (hermes lane, `--ignore-rules`, detached `setsid` + a
  > completion monitor) **SHIP WITH FIXES — 3 MED, open sweep "none"** (ring math · exit
  > paths incl. the rider · confirm row · Conf section all explicitly verified sound) →
  > main-seat fix wave `461a025` (her three, built as prescribed, each red-proven) → her
  > self-contained confirm: **all three RESOLVED with line proof, fix-sweep "none" —
  > RESOLVED — SHIP.** Gate 6/6 at every tip; liveCall e2e 16/16 both projects; final
  > FE 3,406/190 · BE 2,462 (QUALITY.md).
  >
  > **Shape:** the RING — `focalLanding` + `useFocalAnchor` (pure siblings in
  > `lib/focalPosition.ts`/`useFocalPosition.ts`; the landing derives from `focalAxis`, which
  > CLAMPS — a naive `f · box` is off on any cropped axis; the measuring half of
  > `useFocalPosition` extracted as the shared `useFocalBox`), anchored overlay-local off the
  > art box's one ResizeObserver (F9 — `.kit-call-art` is inset-0, so no viewport offset can
  > enter); JS places only the CENTER, the diameter/stroke/fallback-anchor are CSS custom
  > properties (feel-round knobs); state animates the stroke via `ph-*`/`speech`/`muted`
  > classes, `body[data-motion]`-gated, discrete steps under reduced motion; no-ring mode
  > relocates the dot to the heard line — ONE indicator per mode, the phase-line dot is gone
  > from both. MUTE — `PcmCapture.setMuted` (`track.enabled`, frames keep flowing), reducer
  > rules exactly as ratified (mute condemns the half-utterance: BOTH flags clear; finals
  > while muted drop FLAT; VAD races ignored; terminals + redial start unmuted), the muted
  > look STATIC in both modes, "Muted" outranks the listening copy. CONFIRM ROW —
  > `confirmAwaiting()` beside `confirmOutstanding` (one shared scan, reference-stable memo;
  > `awaiting_answer` holds the queue but earns NO row — typed words are the chat card's),
  > Allow/Deny ride `resumeCall` (the same chokepoint + single-use token; the overlay never
  > sees a token). TERMINAL FACES + REDIAL — the door hoisted to `store/liveCall.startCall()`
  > (dismiss → prime → open, the order still the contract; ① is load-bearing AGAIN at the
  > terminal face — auto-TTS can re-dock playback); redial = `seq` bump → the shell's `key`
  > remount, so mounting stays the only start path. BACK-TRAP — `useOverlayBackGuard` at the
  > SHELL (measured: a key remount's fresh push races the old guard's async reclaim and the
  > entry is LOST — the next Back left the app; owning the entry at the CALL's lifetime kills
  > the race by construction); `close()` is the one exit (button · Escape · Back). Plus the
  > two S2a residuals: degraded-note hysteresis (`DEGRADED_NOTE_MS` client hold — the relay
  > never signals recovery; clears only its own note) and the MiniPlayer transport riding
  > published intent (`playIntent`/`usePlayIntent`; `setIntent` is the one write door) instead
  > of disabling on "loading". And the Conf **"Live call" section** (§5.1 — a main-seat scope
  > addition: no ladder slice owned the owner-ratified Settings rows and the `ring` toggle
  > needed a home): toggles + `LiveCfg`-bounded numerics + the provider ref as a third voice
  > service; `voice.live` joins the reref rename-remap and the strict-422 `guarded` list
  > (BE-coherence deviations, accepted).
  >
  > **The audit finding + the wave (the durable lesson):** retiring the per-overlay `hangUp`
  > lost the pre-teardown GENERATION bump on the shell's `endCall` exit — `close()` only
  > starts the socket handshake, so an in-flight `final`/`killSettled`/`sent` landing one
  > task after the cleanup still passed both fences and could SUBMIT after the owner closed
  > the call. Fixed reducer-owned: the cleanup sends `unmounted` (the hangup rule with
  > `close: false` — an `endCall()` there would kill the fresh call a redial is mounting).
  > ⚠ The lesson: **an exit that skips the reducer is an exit that skips the fence** — every
  > path out of the machine must move the generation BEFORE teardown, unmount included.
  > Emma's three MEDs were the same family at other seams: mute during ACQUISITION never
  > reached the resolved track (the install now applies `ref.current.muted`); `seekChunked`
  > still derived its play flag from STATUS (a rejection's `paused`/a gap's `loading` with
  > `wantPlay` true → a drag silently cancelled the resume; a seek changes WHERE, never
  > WHETHER); `ready` cleared the note unconditionally (now the degradedOver rule: only
  > strained is connection news).
  >
  > **Residuals riding later slices (none owed now):** the general `useOverlayBackGuard`
  > unmount/remount race (any overlay remounting in one commit loses its entry — S2b
  > sidesteps it; the shared-primitive fix, hand-the-entry-over instead of reclaim-then-push,
  > is Phase 19 material) · the MiniPlayer's initial-synth window (button enabled during the
  > first synth where the controller's pinned rule still ignores taps — closing it means
  > publishing a `waiting` state or changing the latch, neither S2b's) · ring/accent geometry
  > + the tap-to-interrupt micro-hint = S4 feel-round material · a hand-tuned
  > `allowed_origins` stays the Serve escape (S4).
- **S2.5 — phrase-by-phrase streaming dictation (owner-RATIFIED 2026-09-13, §8 item 5;
  design evidence = [R70](./research/R70-phrase-streaming-dictation.md)):** the dictation
  hold/lock rides the SAME ear as calls — each utterance final appends to the composer draft
  live at every pause while the user keeps talking; **release = the relay's `flush` (a
  silence burst, 530–830 ms measured), NEVER a raw commit — R70's amendment: a commit during
  open speech kills the session.** ⚠ R70's VAD reality tempers the feel: the 3 s buffer floor
  coalesces short phrases (latency `max(silence_ms, 3000 − phrase_ms) + ~0.5 s`) — the feel
  round judges with that known. One more consumer of the S1 relay + the existing
  draft-append seam; the S0.5 gesture unchanged (capture ergonomics stay, only the transcript
  DELIVERY moves from whole-clip POST to the ear's finals when the `live` capability is up —
  degrade = today's whole-clip path). Slotted after S2a so the ear/loop mechanics are proven
  in calls first; sequencing vs S2b is the build session's call. Word-by-word explicitly NOT
  this slice (§8.5c — the S4 trigger).

  > **S2.5 AS-BUILT + council-CLOSED (2026-09-14, one session; the standing cadence, FOUR
  > confirm rounds — the longest F1 chase yet, and it ended in a deletion).** Build `801309f`
  > (pinned Opus, 22 files +2234/−82, 24 red-proofs; 5 declared deviations, 4 accepted + the
  > 5th closed as the main-seat audit rider `1de1cf0` — the guarded unmount belt the comment
  > narrated but never wrote) → blind Emma (hermes lane, `--ignore-rules`, detached + the
  > output-file monitor) **SHIP WITH FIXES — 5 MED, open sweep "none"** (fences · wire
  > vocabulary · either/or terminals · capture extraction · the BE truth table all verified
  > sound) → wave `a3c3f1e` (her five; F1 as the endpoint-ledger count, F5 as ONE wall-clock
  > token bucket replacing the per-callback ratio) → confirm **BLOCKED** (F1 survives one
  > VAD-late phrase deeper + F2's already-CLOSING socket + new N1: the queue's only pump was
  > capture delivery) → micro `192f77f` (the DYNAMIC resolve rule `owed()===0 && stops >
  > stopsAtRelease` · `flush()`/`stop()` return SENT-truth · the release drains its queue,
  > bounded + paced, through the one extracted `accrue`/`pump` bucket) → **№2 BLOCKED** (F2 +
  > N1 RESOLVED; F1 survives TWO VAD-late phrases — "the ledger can prove a new endpoint
  > completed, never that the flush processed everything") → micro `ac39675` (a settle window:
  > a satisfied condition arms 300 ms of required ledger quiet; a late `speech_started`
  > retracts it) → **№3 BLOCKED** (a queued-but-undispatched socket message loses to an
  > overdue timer — task sources carry no ordering guarantee; every finite window has a losing
  > boundary) → micro `b3d76f1` (main-seat, **+99/−299**) → **№4: F1 RESOLVED with line
  > proof, the ⑦ toast simplification ruled HONEST, wave sweep "none" — RESOLVED — SHIP**
  > (she re-ran the suite at HEAD). Gate 6/6 at every tip; final **FE 3,471/192 · BE 2,476**
  > (QUALITY.md).
  >
  > **Shape:** BE — `LiveCfg` gains `dictation` (own whole-feature toggle, OFF) ·
  > `tail_wait_ms` (500–10000, default 2000) · `dictation_idle_s` (15) · `dictation_max_s`
  > (120), delivered in `live_call`; **the new `live_ear` bit MIRRORS THE WS ROUTE GATE
  > exactly** (`configured("live") AND live.enabled`, NO TTS term — dictation fills the
  > composer and needs no mouth; the `live` bit keeps TTS for the call button) *(S3.5 AMENDED:
  > both the route gate and the mirror are now `configured("live") AND (enabled OR
  > dictation)`)*; Conf rows ride the S2b "Live call" section *(S3.5 AMENDED: the dictation
  > four render in Voice · STT — keys unmoved)*. FE — the streaming leg arms per recording on `live_ear &&
  > live_call.dictation`: `attachPcmUplink` (extracted from `startPcmCapture`, which is now
  > written in terms of it) hangs the worklet off the RECORDER's stream + `armDetector`'s
  > context — never a second `getUserMedia` or context; ONE FIFO + ONE wall-clock token bucket
  > (`DRAIN_PACE 1.5` · `BUCKET_CAP_MS 500` — cap + 1.5×window < the relay's 2×window budget,
  > the 7/8 margin at any `frame_ms`) meters every frame out, both phases, with the ceiling as
  > handshake-bound pre-`ready` and stale-speech close post-`ready`; finals append through the
  > untouched `appendDraft`; the release PARKS the clip BY VALUE (the tail wait widened F2's
  > ownership window), drains the queue paced pre-flush, then **flush → the FLAT
  > `tail_wait_ms` wait → stop → close**; the either/or (≥1 appended ⇒ clip discarded · 0 ⇒
  > today's upload, never both) + `maybeAutoSend` once at session end; mid-death decided by
  > the draft (≥1 ⇒ end + toast + discard · 0 ⇒ silent clip degrade); §9.3 all three (Tier-0
  > suspended-with-reset · hidden-page armed unconditionally while streaming · idle 15 s
  > hands-free only via the `handsFree` ref + max 120 s on the one 100 ms poll); the
  > `onPending` chrome pulse (opacity-only `::after`, motion-gated); the caret save/restore in
  > `useComposerChrome` gated on the module APPEND COUNTER (the collapse MEASURED real in the
  > new e2e probe first — R70 §5's [U] closed), snapshotting on `input` too (Gboard).
  >
  > **⚠ THE TAIL-WAIT THEOREM (three review rounds, recorded at the wait itself — nobody
  > attempts a fourth heuristic):** `flush` has NO ack and the wire carries no completeness
  > marker (the relay could only say "burst handed upstream", never "upstream processed it" —
  > and the server stays untouched, §5.2), so NO ledger event may end the release wait: "the
  > first final" · a count snapshotted at release · a dynamic condition + settle window each
  > lost at their own boundary, one round apiece (a phrase can be entirely UNOBSERVED —
  > VAD-late, or its socket message queued behind a stalled main thread — while every
  > heuristic reads done). The S1 durable lesson applied verbatim: an optimization needing
  > state the protocol cannot give gets DELETED. **The wait is `tail_wait_ms` FLAT; the one
  > sound early exit is a DELIVERED close** (in-order delivery proves nothing more can
  > arrive), which also owns the honesty toast (`finals > 0` ⇒ the possible tail is named
  > lost). Finals append instantly mid-session — the flat bound is only the RELEASE's price.
  >
  > **Main-seat rulings this slice:** `pause_flush_ms` + the three-word auto-send floor
  > OMITTED (a knob whose value does nothing is dishonest in Conf; the floor is an unratified
  > behavior change — both S4 candidates, recorded in `LiveCfg`) · no mid-session reconnect
  > (the clip fallback IS the retry; R70 §8's retry-once + circuit breaker declined) · cancel
  > keeps already-appended draft text (retraction could destroy concurrent edits — feel-round
  > item) · pre-`ready` frames BUFFER and drain paced (never-lose-speech: handshake words
  > must reach the stream).
  >
  > **⚠ Durable lessons:** (a) the theorem above — and its shape generalizes: a reviewer
  > blocking the SAME finding three times at three boundaries is usually proving the
  > mechanism class is unsound, not that the tuning is off; rule on the root, then DELETE
  > rather than tighten (net −60 source lines). (b) A wait that parks a decision open widens
  > every ownership window it spans — the clip had to leave the refs BY VALUE the moment the
  > release could outlive the next recording's arming (the F2 rule applied to data). (c) A
  > queue whose only pump is its producer's callback strands its tail on the producer's last
  > delivery (N1) — a release must drain what it accepted, bounded, before it seals the
  > session.
  >
  > **Residuals riding later slices (none owed now):** the release costs a FLAT
  > `tail_wait_ms` (default 2 s) of `sending` — the S4 sitting tunes it against the measured
  > 530–830 ms release→final, and real multi-phrase VAD lag there is the §2.1 arch-② trigger
  > · auto-send fires on that same bound (a mid-death auto-send sends the truncated draft —
  > feel material) · the hidden-page release's throttled timers can hold the SOCKET (never
  > the mic) open past the tap (in-source note; S3/feel) · ~~a hand-edited `dictation: true`
  > with `enabled: false` streams nothing until the ear exists (`live_ear` is the gate —
  > by design)~~ *(S3.5 SUPERSEDED: `dictation: true` alone now opens the ear — the owner's
  > ruling that dictation must not require the call feature)* · the e2e caret probe pins the
  > RAW collapse on the whole-clip path (the mitigation is unit-pinned).
- **S3 — interruption hardening:** the §4.3 ordered cancel-settle contract + the buffered-final
  race (F4) · the playback-would-start-while-speaking edge (F5) · the echo fallback branch if S0
  ruled dirty · reconnect/backpressure edges (F6) exercised against a flaky link.

  > **S3 AS-BUILT + council-CLOSED (2026-09-14, one session; the standing cadence, TWO confirm
  > rounds — both of the reviewer's MEDs survived their first fix at a boundary, and both roots
  > moved).** Build `fd7fee2` (pinned Opus, 10 files +849/−48, 9 red-proofs; 4 declared
  > deviations, all ACCEPTED — headline: `killNow` clears `mouthLive` at the kill because step ①
  > `dismiss()` is synchronous, so the ear-hold must not close again over the words the owner
  > interrupted with) → main-seat audit (the stranded-flag walk: a `speechStop` dropped while
  > held cannot strand `userSpeechActive` — the iron rule kills before the hold can engage over
  > active speech) → blind Emma (hermes lane, `--ignore-rules`, detached + the output-file
  > monitor) **SHIP WITH FIXES — 2 MED, open sweep "none"** (transport catch · pcmCapture's OR
  > rule · the dictation abandonment · ready/queue interactions all explicitly verified sound) →
  > wave `7a298ff` (F1: `killSettled`'s repaint consults `mouthLive` — replacement playback
  > keeps `speaking`, `held()` re-holds the queue, the REAL drain releases it; F2 re-derived
  > lean: the mouth watcher became a SYNCHRONOUS store subscription —
  > `subscribePlayback`/`getPlayStatus`, `emit` runs listeners inside the publishing `set()` —
  > with the hold applied on the signal's heels in the same task) → her confirm **BLOCKED —
  > both survive at a boundary** (F1: `playbackStarted` was the ONE arm repainting
  > `connecting → speaking` while the leg was down; F2: same-task-as-EVENT is not before-AUDIO —
  > the `play` event is a queued task, and a stalled main thread lets a captured leak frame
  > beat the handler) → micro-wave №2 `850d530` (main-seat: **the RECONNECT OWNS THE PHASE** —
  > `playbackStarted` preserves `connecting`, the flag lands, `ready` stays the arm that
  > consults it; and **the ear closes BEFORE the mouth asks to play** — `setCallPrePlay` + the
  > ONE `startEl` chokepoint over the four audible play sites, the muted silent prime excluded;
  > the tap is a bare "close now", stable in the play()→event gap because nothing can
  > transition `earHeld` there, reopened by a rejection's own status edge; deliberately NO
  > third gate slot in `PcmCapture`) → **her confirm №2: both RESOLVED with line proof,
  > micro-wave sweep "none" — RESOLVED — SHIP** (she re-ran the three suites herself). Gate
  > 6/6 at every tip; final **FE 3,513/192 · BE 2,476** (QUALITY.md); liveCall e2e 16 → 20
  > arms (the mid-utterance leg drop · the backpressure-style unannounced close).
  >
  > **Shape:** the Fennec EAR-HOLD — `PcmCapture.setHeld` beside `setMuted`, ONE effective rule
  > `track.enabled = !(muted || held)` (frames keep flowing as silence — the endpointing
  > reason, unchanged); the REDUCER owns the rule: `earHoldMode` lands once via the new
  > `captureReady` signal (`auto` → the track's AEC readback ≠ `"all"` · `on`/`off` force it;
  > per track, never UA-sniffed), and `earHeld` is DERIVED in one normalize after every reduce
  > (`mode && mouthLive && !killing`) — never maintained per-arm; the `speechStart`/
  > `speechStop`/`final` guards widened to `muted || earHeld` (a leaked-playback final must
  > never become a message); the rule reaches the track at acquisition, on every state change,
  > synchronously on playback edges, and — the confirm round's teaching — BEFORE the play call
  > itself. `mouthLive` — the observed transport truth, ORTHOGONAL to the phase: maintained
  > past every phase guard, `ready` lands on `speaking` while it holds, `barge` gates on
  > `mouthLive && !killing` (§4.3's intent, honest across the reconnect window), trigger A's
  > sustained-energy clock reads it. Plus the parked residuals closed: `transport()`'s bare
  > `play()` caught (reqSeq/playOp, the file's own generation conventions) and the dictation
  > release's hidden-page tail wait ended by ABANDONMENT (dead → skip `stop` → `close`; the
  > tail-wait theorem intact — a user departure, not a completeness claim).
  >
  > **⚠ Durable lessons:** (a) **observation cannot beat the audio thread** — a "synchronous"
  > store subscription is same-task-as-EVENT, and the media event is a queued task; anything
  > that must precede audible output must run BEFORE the API call that starts it (the pre-play
  > tap), not on any observer however fast. The reviewer holding the same boundary twice is
  > what moved the class — the S2.5 meta-lesson applied on the spot, one round early. (b) Two
  > arms disagreeing about who owns the screen is a defect even when each is locally
  > defensible — `socketLost` painted `connecting` over a live mouth while `playbackStarted`
  > repainted it back; the rule ("the reconnect owns the phase; `ready` consults the flag")
  > had to be stated once and enforced at every arm. (c) A derived flag wants a NORMALIZE
  > chokepoint, not per-arm maintenance (`earHeld` computed after every reduce — a rule spread
  > across a dozen arms is a rule with a dozen chances to be forgotten). (d) Ops: the harness
  > kills its own backgrounded shells — the Monitor tool, plus detached `setsid` work with an
  > output-file completion signal, is the surviving pattern (three plain background monitors
  > died this session before the switch).
  >
  > **Residuals riding later slices (none owed now):** dictation's streaming leg deliberately
  > does NOT hold during playback (recording over a reply is the user's own choice — parity
  > with the whole-clip path) · the pre-play tap covers element plays only, and every future
  > play site must route through `startEl` (the comment at the chokepoint pins the rule) ·
  > ring/hint feel + `tail_wait_ms`/`barge_threshold`/Tier-0 calibration = the S4 sitting ·
  > `voice.live.enabled` (+ `.dictation`) still default OFF — S4's flip closes the phase.
- **S3.5 — dictation decoupled from the call (owner-commissioned 2026-09-14, in conversation):**
  the owner's question — "is live dictation a regular-mic feature, and can its setting live in
  the STT section?" — surfaced a latent inconsistency: `LiveCfg.dictation`'s comment claimed
  independence from `enabled`, but `live_ear` and the WS route both required `enabled`, so
  streaming dictation silently demanded the CALL feature (and, with TTS configured, the call
  button). Field norm (R70 §2, already bought): composer dictation and voice/call mode are
  separate features in every peer — ChatGPT's own docs state it flatly.

  > **S3.5 AS-BUILT (main-seat build, blind-reviewed):** ① the WS route gate and `live_ear`
  > both became `configured("live") AND (enabled OR dictation)` — the mirror rule between them
  > intact (the ear opens when EITHER feature wants it; the MASTER `voice.enabled` and the
  > missing-chain refusals outrank both, unchanged); the `live` (call) bit is untouched, so
  > `dictation` alone never shows the call door. Red-proven: a new route-level test admits the
  > socket at `enabled: false, dictation: true` and fails against the reverted gate; the
  > mirror parametrize grew three S3.5 arms (dictation-alone × master-off × chain-missing).
  > ② The four dictation rows (toggle · tail wait · idle stop · time limit) moved to the
  > Conf **Voice · STT** group, beside the mic rows they modulate — GROUPING ONLY: the keys
  > stay `voice.live.*` (the recorded S2.5 one-ear rationale; same `setLive` setters, same
  > save coercion, no YAML shape change, no migration). The Live call section keeps the
  > call-only + shared-ear knobs and a pointer comment. Conf tests moved with the rows and
  > now also pin the ONE-home rule (the live group renders none of the four).
  >
  > **The council round (same session):** build `6b8b6b4` → main-seat audit sweep (one stale
  > consumer docstring found — `useVoiceStatus.live_ear` — rider `13b664c`) → blind Emma
  > (hermes lane, self-contained): **SHIP WITH FIXES — 1 MED · 3 LOW, open sweep "none"**; the
  > gate/matrix/security/save-flow/sizing all explicitly verified sound (her full 7-row
  > feature matrix is in the review). The MED: with an EXPLICIT realtime target +
  > `dictation: true` but `voice.stt` unconfigured, the toggle is dead (the mic itself gates
  > on `sttReady`) and the row desc didn't say so — fixed as she prescribed, copy only
  > (`8409bd1`, + the four-label one-home loop (F4) + QUALITY counts 2,480 (F3); F2 was the
  > rider's own catch). → **Her confirm: all four RESOLVED with line proof, fix-sweep "none" —
  > RESOLVED — SHIP.** Gate 6/6 at the tip; BE 2,476 → 2,480, FE 3,513 unchanged (tests
  > moved, not added).
  >
  > **THE WORKLET GATE (same day — the owner's live round found the phone leg dead):** on plain
  > HTTP every streaming leg died accept→close in the SAME SECOND (dev log), `start` never
  > processed, no upstream dial — while the relay probe AND a real-browser probe through the
  > whole app (:5173, synthetic stream, real worklet + WS: 224 frames, 3 endpoints, full
  > release choreography) both passed. Root cause: **`AudioWorklet` is SECURE-CONTEXT-ONLY
  > (MDN)** — a browser pref that unlocks the mic on plain HTTP does not unlock worklets, so
  > `ctx.audioWorklet` is undefined, `attachPcmUplink` rejects same-tick, and the teardown
  > races the socket's own `start`. Shipped (main-seat leaf fix, both arms red-proven by
  > scripted reversion; no blind round — rides the next one): ① `armDetector` declines the
  > leg up front when `ctx.audioWorklet` is absent (capability-checked on the context, never
  > UA-sniffed) — no doomed socket; ② the degrade notice names the reason on
  > `isSecureContext === false` ("Live dictation needs HTTPS — using standard transcription");
  > explicit-false, because a treat-as-secure origin IS secure and streams fine. FE 3,515/192.
  > **⚠ THE SERVE HOST-HEADER QUESTION (S4 §8) IS ANSWERED, measured:** `wss://` through
  > Serve → Vite(:5173) → the relay passes the SAME-HOST Origin rule with `allowed_origins`
  > EMPTY — Serve and the Vite ws proxy preserve `Host` end to end; the allowlist is not
  > needed on this topology (dev keeps the Serve origin listed as a belt). Ops for the
  > sitting: Serve flipped to :5173 (restore `tailscale serve --bg 5433` at close).
  >
  > **THE LONG-RECORDING BAR RULES (same sitting — the owner's second finding, council-CLOSED):**
  > on HTTPS the streaming worked, but the gesture chrome's MEASURE-ONCE anchor (the S0.5
  > measure-at-lift rule) painted the record circle where the bar USED to be — the premise "a
  > short hold over a static bar" died with S2.5's long recordings (the keyboard collapses at
  > record start; appended phrases flip `sendable` → send slid in and pushed the mic left under
  > the stale circle; the field auto-grows). Two rules shipped (`3780476`), then Emma's blind
  > round **SHIP WITH FIXES — 3 MED · 1 LOW, sweep "none"** → wave `34f00e4` → her confirm
  > **all four VERIFIED with line proof, fix-sweep "none" — RESOLVED — SHIP**:
  > ① **the ANCHOR TRACKS the button while the chrome stands FINGER-FREE** — tracking arms only
  > at `locked`/`chip` (her F2: while a finger owns the gesture the chrome is finger-relative BY
  > DESIGN — re-anchoring would teleport the circle away from a stationary touch), with a
  > catch-up read on arming; event-driven — visualViewport resize (keyboard) · a ResizeObserver
  > on THE BAR (her F1: the host is `.kit-main`, whose box never changes when the bottom-anchored
  > bar grows upward) + the host belt · window resize (rotation) — the S2b ring's F9 pattern,
  > one rAF coalescer, never a per-move rect loop.
  > ② **the ROW FREEZE (LineComposer; the owner's own design, generalized to a LATCH)** — while
  > `mic.status === "recording"` the trailing row may not CHANGE: `showSend` latches at record
  > start (a pre-typed draft keeps its send; an empty one doesn't summon it until release — the
  > latch can't cause the reflow it prevents), the control-stack decision freezes, and the
  > stack's hysteresis BASELINE freezes with it (her F3 — a mid-recording needs change still
  > faces the strict re-test on release). Owner-accepted trade: the D39 send→Stop morph waits
  > for release. The `lifted` cancel-track rule deliberately stays LIVE (readability over
  > stillness, the round-3 ruling). Tests: the tracking arm fires a REAL RO callback + the
  > visualViewport handler (deleting either listener fails it), holds pinned untouched, the
  > stack-engage-waits arm; F1+F2 red-proven by combined scripted reversion. FE 3,519/192.
  > **⚠ Durable:** a measure-once rule dies with its premise — when a slice makes a gesture
  > LONG, every "measured at start" value it rides must be re-audited; and an overlay anchored
  > to a moving control wants finger-relative while a hand owns it, control-relative the moment
  > the hand lets go — never one rule for both.
  >
  > **THE ROUND CLOSED (2026-09-14, the owner's verdicts, follow-up session):** both waves
  > PASSED on the phone — the bar rules verified in BOTH latch cases (a pre-typed draft keeps
  > its frozen row; an empty composer summons send only at release) and streaming dictation
  > "works well" over the Serve HTTPS chain. The one question the owner raised — does Tier-0
  > auto-stop collide with the streaming session? — was source-verified **NO COLLISION**: the
  > energy poll hard-resets Tier-0's silence run every tick while a session is live (§9.3-a,
  > `useDictation`'s poll block ③), so what ended their long-silence recording was the
  > session's OWN idle clock (`dictation_idle_s` 15 s, hands-free only, floor =
  > `stt.auto_stop_threshold`) closing via the ordinary release — appended phrases kept. Their
  > dev Tier-0 window (auto-stop ON at 5 s during the round) never firing across long pauses
  > is itself live proof of the suspension. Ambient noise can only DELAY the idle stop (above
  > the floor it resets the clock), never cause it; the floor and `dictation_idle_s` stay on
  > the S4 calibration list below. Ops: Serve RESTORED to prod :5433, verified 200/v1.7.7.
- **INTERMISSION — the cross-cutting fix wave (D72, 2026-09-15): three voice findings landed
  between S3.5 and S4, and each AMENDS a ratified slice record.** The wave ran a three-lane audit of
  everything built since v1.7.7 (voice · roleplay+attachments · fleet/cross-cutting), bought
  [R71](./research/R71-uplink-stall-pacing.md)/[R72](./research/R72-session-slot-reconnect.md)
  against its two hard questions, and put the plan itself through an adversarial review round
  (H1–H3, M4–M7, L8–L14, all ACCEPTED by the main seat). **This block post-dates every S-record
  below it: where the two differ, this is the later ruling.**

  > **W1 — the dead too-short floor (audit A-F1).** `useDictation`'s post-release floor read
  > `startedAtRef` AFTER the release had already zeroed it, so the guard that refuses to POST a clip
  > too short to carry speech could never fire on the streaming path — a stray tap's 80 ms of audio
  > went to the STT endpoint instead of teaching the user to hold. AMENDS §7-S2.5: `Clip` carries
  > `{chunks, heldMs}` and **`Clip.startedAt` is DELETED outright** (two readers existed), `onstop`
  > stamps `heldMs = startedAt > 0 ? now - startedAt : Infinity` **before** the reset, and `upload()`
  > reads the stamp. The Infinity never-discards doctrine and the floor's placement after the
  > empty-blob check are unchanged — every terminal was re-confirmed to route through
  > `stop()`→`onstop` (cancel returns pre-upload, `onerror` arms the discard), so no other path needs
  > a stamp.
  >
  > **W2 — the call's uplink is PACED and BOUNDED (audit A-F2; [R71](./research/R71-uplink-stall-pacing.md)).**
  > Dictation had a token-bucket pacer; the call's `onFrame` called `sendAudio` raw, so a phone
  > returning from a background stall burst its whole backlog at the relay — whose own
  > `relay_queue_ms` then dropped it, at the far end of the wire, as speech the owner had already
  > spoken. The pacer lifts into `lib/uplinkPacer.ts` with two BACKLOG RULES on one implementation:
  > **lossless** (dictation — behaviour byte-identical, its release drain runs through the same
  > functions, the local copies deleted rather than left as a seam) and **drop-oldest at a ms bound**
  > (the call). R71's field split is the reason the two differ rather than converge: WS voice clients
  > are lossless-unbounded, servers drop past a bound — and since our relay already drops at
  > `relay_queue_ms`, a lossless client would merely RELOCATE the loss and leave two owners of it.
  > Four PINS, each a ruling: ① Trigger-A energy measurement stays on the CAPTURE callback, never the
  > pump. ② **The pacer NEVER consults `muted`/`held`** — review M5 corrected the field's
  > flush-never-strand precedent as inapplicable here: mute is `track.enabled`, so silence frames KEEP
  > FLOWING (`pcmCapture.ts`), the one-rule ownership lives in `PcmCapture` alone, and there is
  > therefore no strandable tail and no flush-on-mute question for the call. ③ A client-side drop
  > presents the SAME degraded/"strained" note the relay's drop presents, locally triggered and
  > clearing the same way (review L11 — one loss chain, one signal). ④ A `protocol`-code error
  > terminal shows plain copy, not the relay's raw internal sentence. KNOB **`voice.live.call_backlog_ms`,
  > default 1000** (R71's recommended ≈1 s), in all five homes: `LiveCfg` · the hand-built
  > `/voice/status` dict · the exact-equality wire pin · the FE `LiveCallWire` · a Conf row beside the
  > other live knobs (the S3.5 precedent). The CallOverlay's live `ring` read is snapshotted at call
  > start, per §4.5's "next call" rule.
  >
  > **W3 — busy during a reconnect is no longer terminal (audit A-F3; [R72](./research/R72-session-slot-reconnect.md);
  > RESHAPED by review H2).** R72 probed the stack LIVE on emma: uvicorn's default 20/20 ping leaves a
  > dead socket's session slot held for a **measured 20–40 s**, so a phone that lost its network
  > reconnected into its OWN zombie and got `busy` — and `busy` ended the call. Two halves.
  > **(i) Detection:** `--ws-ping-interval 5 --ws-ping-timeout 5` at the four real launch sites (both
  > systemd units, both `run.sh` invocations, `start.ps1`), which R72 measured down to a **10 s
  > worst case**; repo-only, so prod picks it up at the next release install. **(ii) Policy:**
  > `RECONNECT_BACKOFF_MS` → `[400, 900, 1800, 3000, 4000, 4000]` (≈14.1 s > that 10 s hold; the
  > length↔max-attempts coupling stands), and the `busy` arm AMENDS §4.5's reconnect contract (and
  > S1's `busy`→terminal as-built) with the shape H2 ruled — **a busy refusal is TWO events, the frame then the 1013 close**. At
  > `attempts === 0` it stays terminal (a first-dial busy is genuinely another device; the ratified
  > behaviour and its e2e pin are untouched). At `attempts > 0` the frame is a **NOTE-ONLY NO-OP**,
  > and the close that always follows drives the ONE existing `socketLost`→reconnect arm: no double
  > burn, no second counter, one owner of the ladder. RFC 6455 §7.4.1 is the standing argument R72
  > brought — 1013 *means* "try again later", so a terminal `busy` violated our own close code.
  >
  > **Lanes + close.** W1/W2(FE)/W3(ii) rode the voice lane, W2's backend homes the backend lane;
  > the wave closes on two independent review lenses over the whole diff, the main seat's rulings and
  > the full gate. ⚠ **Owed to S4:** R71's Honor-20 app-switch backlog probe (the real burst size
  > behind `call_backlog_ms`) and R72's UNVERIFIED question — whether Tailscale Serve's proxy
  > preserves the shortened ping cadence end to end — both belong in the §4.1 calibration sitting.

- **S4 — the owner calibration + device round (the phase gate):** real phone, real rooms — noisy
  and quiet; the §4.1 knobs tuned by feel; the Tier 0 auto-stop threshold calibrated in the same
  sitting; `enabled` flips ON as the round's close.

  > **S4 CLOSED 2026-09-26 — the gate record.** The round became a WAVE: round №1 (below, 09-24)
  > surfaced ISS-18/ISS-19 and the "had to shout" car arm; the owner's two 09-25 rounds became the
  > D76 wave (the call's few controls: Media/Call · `mic_hold` · the relative-dB Sensitivity · Silero
  > 0.6 · the TTS pad trim · the voice level keyed device×echo-mode · D77 the call trail); the D76 S3
  > round №1 (09-25) was decoded to two root causes and fixed the same day; **the D76 S3 round №2
  > (09-26, read from the D77 trail, no owner narration): ALL THREE ARMS PASS** — loudspeaker/Media
  > every chunk held, no self-transcription (leak −24 dBFS vs floor −31.5); Call route/default mic
  > the first turn accepted unseeded at −8 dBFS peak; headphones/Media every chunk released, the
  > over-talk queued and sent at drain. Decision point: fixed endpointing is GOOD → v1 STANDS,
  > architecture ② stays the recorded fallback. `voice.live.enabled` default → **true** (this
  > commit); the Tier 0 threshold untouched. **Owed, non-gating (ride the owner's regular use):** the
  > car on the CLEAN route (then `min_final_ms` 200 → 300 if home-side noise words persist), the
  > TV/other-room arm, ISS-19 (the Honor battery setting first). ISS-13/14 parked won't-fix.

  > **R86 FIX WAVE (2026-09-26, pre-v1.7.8; audit `docs/research/R86-live-call-e2e-audit.md`,
  > rulings of record in the main seat's R86 block).** LC-1: `playbackStarted` carries the open epoch's
  > accrual + `min_final_ms` (one reader, `epochAccrual`, shared with the `final`; one predicate,
  > `tooQuiet`) and the iron rule stands down below the knob — knock-on: a HELD `speechStop`/`final`
  > now lowers its flag (never raises it), so a spared segment cannot strand an unmeasured kill.
  > LC-2: `upstream_error` clears `waitingFinal`. LC-3: the in-call all-failed `finish()` ticks
  > `mouthFailed()` before its `paused`. LC-4: `routeChange` sets `priorLeg` (own-leg `busy` = retry).
  > LC-5: `openLiveSocket` latches `ready`; `sendAudio` drops until it lands. LC-6: `idleExpired` is
  > a no-op while `mouthLive` and re-arms (`IDLE_EDGES`). LC-8: `uplink_idle_s` (server, 15, 5–120)
  > reaps a silent uplink as `session_limit` with its own sentence (the client now shows the relay's
  > message for that code). LC-7: the "ships OFF" sweep. Owed to the owner: whether `barge_in: false`
  > should also spare REAL speech at reply start (LC-1's interplay).
  > **Wave 2 (R88, Emma's second audit, same day).** E-1: LC-1's exemption narrowed to a CLOSED
  > utterance (`waitingFinal` and no speech live) — an OPEN segment kills as before LC-1 whatever it has
  > accrued (a partial accrual is no verdict; sparing it let the hold close the ear on the owner's
  > sentence), so **continuous noise during `thinking` still kills the reply** — the deferred-start
  > design is the owner's open question (HANDOFF). E-2: `idleExpired` also waits out
  > `userSpeechActive`/`waitingFinal`. `/voice/status.live_call` stopped delivering the two unread
  > server knobs (`max_session_s`, `vad_threshold`), pinned by a reader-parity test; the example
  > config's live keys are pinned to `LiveCfg`; §4.1/§5.1/§5.3 reconciled with the code.

  > **S4 ROUND №1 (owner, 2026-09-24, car + BT headphones + lock screen; the card = the 36th
  > session's handoff).** *The car, default route (their config's `speaker`, EC on ⇒ comm mode):*
  > the reply came out of the CAR speakers — correct (comm mode ⇒ the hands-free profile ⇒ the car,
  > at phone-call quality; the clean route would reach it over A2DP at media quality); capture was
  > the car's mic over the same profile, and the owner had to nearly SHOUT to be transcribed, with
  > cut-offs — read as the §4.3 quiet-final gate (`min_final_ms` 200 above the 0.06 barge floor,
  > calibrated on the phone mic at home) dropping ordinary speech from a narrowband, differently-gained
  > car mic; **owed: the car on the CLEAN route** (phone mic stays wideband; reply via A2DP), then the
  > Speech slider 0.90 → ~0.70 if still poor; the "too quiet — didn't take that" note is the
  > confirming signal. *Headphones:* the Mic picker rows are `default · Speakerphone · Headset
  > earpiece`, unchanged with the pair disconnected — **"Headset earpiece" is Chrome's name for the
  > phone's own earpiece; the R77 no-HFP-row premise STANDS** (the 09-23 "headset mic, I think" was
  > this row). A flip to headphones MID-REPLY kept the reply on the phone speaker until the next
  > reply after a silence; the reverse flip was immediate; a later flip was immediate too — **ISS-18**
  > (the pooled, tag-latched output stream, R74 S2 + R80 §3.3; R81 buys the fix sequence). *Lock
  > screen:* the ear went deaf within ~1–2 s and no reply was audible — **ISS-19** (device-setting
  > probe first: R75 §2.3's EMUI power management; the new boot-time discard toast is the
  > discriminator). *Noise:* background noise sometimes lands as short false words ("yeah", "mm hmm")
  > — the same gate from the other side: a noise that clears the 200 ms floor is transcribed; one fixed
  > floor cannot serve the car AND the sofa, so the car re-run decides how far apart they are
  > (`min_final_ms` → 300 is the home-side dial). *App switch:* not run this round (it worked in an
  > earlier one). *Rulings:* ISS-13/ISS-14 parked as won't-fix (scope). The reload-on-every-return on
  > dev is Vite's HMR client, not the app (ISS-19's note).

  > **THE ISS-18 SLICE — the fresh output stream after a comm-mode exit (built 2026-09-24, same
  > session; evidence [R81](./research/R81-output-stream-retag-after-mode-exit.md)).** Mechanism
  > (R74 S2 + R80 §3.3 + R81): Chrome tags a physical output stream with the Android usage of the
  > moment it OPENS, pools it per `AudioParameters`, and closes it 5 s after its last client; the
  > mouth's element is that client, and a paused/ended element holds a mixer on it for 10 s more —
  > so after a flip OUT of comm mode the next reply reused the VOICE-tagged stream (forced to the
  > loudspeaker by the mode it was born under) for up to 15 s, and `finish()`'s rewind-hold on chunk 0
  > re-armed the clock. **Built, in `lib/audioController`:** ① in a CALL a finished reply is DROPPED
  > (unloaded — `reset()` is the one unload door and stamps `unloadedAt`), not parked; the whole-clip
  > `ended` unloads too ② `markStreamRetag()` — called by `useLiveCall`'s `recapture` effect when the
  > flip LEAVES comm mode (`leavesComm = wantsAec(old) && !wantsAec(new)`, a pure edge on the reducer's
  > effect) — unloads a silent mouth NOW (idle or parked; a SYNTHESIZING or playing one is left alone)
  > and arms the hold ③ the next reply's FIRST `src` assignment waits `STREAM_RETAG_MS` (5500 = Chromium's
  > `kStreamCloseDelaySeconds` + IPC slack — a platform constant like `KEEPALIVE_GAIN`, not a knob) from
  > the unload, under the queue's honest "loading"; the play index stays at −1 for as long as the hold
  > stands (a chunk landing mid-hold re-enters through the latch and must meet the gate — without this
  > it loaded chunk 1 on the stale stream and skipped chunk 0; red-proven) and one timer only
  > (`retagArmed`; red-proven); the fired timer IS the spent window; the whole-clip path waits the same
  > way on its own clock ④ the retag belongs to the call — `setCallVoice(false)` ends it ⑤ an
  > ordinary call (no flip) pays NOTHING: no hold, no unload beyond the in-call finish. **A reply
  > PLAYING at the flip finishes on the old route** and the Sound picker's static footer says so
  > ("a change mid-reply starts with the next reply"). *Amended 2026-09-24 (owner ruling): it began
  > as a dynamic overlay note (`CALL_COPY.routeNextReply`, set by `routeChange` with `mouthLive`) —
  > "good for testing but doesn't belong in production"; the note was removed, the footer is the
  > production form.* Tests: reducer (`leavesComm` = the EC-on → EC-off edge only; the mid-reply note) ·
  > wiring (the mock counts `markStreamRetag`: once on the flip out, none on the flip back) · controller
  > (parked-outside-a-call vs unloaded-in-a-call · the hold with chunks landing mid-hold via read-along
  > feeding, both mechanisms red-proven, the spent window · a mark mid-reply · no mark no wait).
  > **Owed to the phone:** flip to headphones mid-reply → the note, the reply finishes on the speaker,
  > the NEXT reply on the headphones with at most ~5 s of "loading" before it; flip while silent → the
  > next reply on the headphones with no visible wait beyond the LLM's; the zero-code earpiece-row
  > PROBE (R81 §3, REASONED only): EC-off leg + Mic row "Headset earpiece" — does even a playing reply
  > move to the headphones at once (at voice-call volume)? **ANSWERED 2026-09-24 (owner's phone):
  > NO — changing the Mic row mid-reply moved nothing. There is no route-only lever on the Honor 20;
  > R81's deterministic sequence (this slice) is the only path (R81 §5 closed).**
  > **The slice's review round (same session): blind Maya (Luna, high) DO NOT SHIP [3 MED] ∥ Opus 5.5
  > design lens (verdict in the round's record below).** All three Maya findings ACCEPTED and fixed in
  > the same wave: **F1** `paused` is not silence — the mark reset any paused mouth, so a reply the
  > OWNER had paused mid-play was destroyed by the flip; now only an idle mouth or a PARKED (finished)
  > queue is unloaded at the mark, a user-paused reply stays resumable, and whatever is still loaded
  > when the next reply opens is unloaded by the gate itself · **F2** the whole-clip path could assign
  > onto the stale stream — a mark during the next reply's synthesis (element still holding the previous
  > clip, `beginMessage` only pauses) was left alone and the assignment measured the wait from an old
  > stamp; now `retagGate` unloads a still-loaded element AT the first assignment and the 5.5 s run from
  > that unload (both paths; `unloadEl` is the one door, `reset()` goes through it) · **F3** `leavesComm`
  > measured the REQUESTED route, so an EC-off ask that came back EC-on (`ecStuck`) — still in comm mode
  > — never counted as leaving it; the machine now carries `ecOn` (seeded on `captureReady` from the
  > track's readback, `ecEngaged`; absent ⇒ the ask, for the reducer arms) and the edge is
  > `s.ecOn && !wantsAec(next)`. Test gaps closed: the wiring arm pins the mark BEFORE the ear is
  > released (`retagAtStops`). Arms: an owner-paused reply survives the mark and resumes; the whole-clip
  > gate unloads-then-holds; `leavesComm` reads `ecOn`.
  > **The Opus design lens (same round): SHIP WITH CHANGES — all taken.** D1 the in-call drop broke the
  > wiring's drain invariant (`loading → idle` = the mouth failing; a queue can finish from the open
  > latch's "loading"): a false "voice failed" after a heard reply — the drop now publishes `paused`
  > first, on both paths (pinned: the in-call finish's last edge is `paused → idle`) · D2 ISS-16's
  > candidate (b) (a silent clip holding the stream open) would silently undo ISS-18 — amended in ISSUES,
  > with the note that the stream's in-call LIFETIME changed at `b8ebffa` (closes ~5 s after each reply
  > now; "an ordinary call pays nothing" means no hold and no unload beyond the finish — not an
  > unchanged stream) · D3 StrictMode ran the discard notice twice on dev — a once-flag · D4 R81's
  > header · S1 (recorded, accepted): hanging up an EC-on call is also a comm-mode exit, and the retag
  > belongs to the call (`setCallVoice(false)` ends it), so a bubble REPLAYED within ~5 s of hanging up
  > reuses the VOICE-tagged stream (from the earpiece with no BT connected) — narrowed from ~15 s by the
  > finish unload; not a call-mode defect.

- **THE D73 WAVE — call audio routing + background calls (owner-ruled 2026-09-21, in conversation;
  evidence = [R74](./research/R74-android-call-audio-routing.md) ·
  [R75](./research/R75-background-call-survival.md); the S4 round itself surfaced both).** The
  owner's first S4 dial found TTS on the phone speaker, distorted, with BT headphones worn — R74
  verified the communication-mode trap at Chromium source (a non-empty platform-effects mask flips
  `MODE_IN_COMMUNICATION`; `echoCancellation:false` is the whole escape on Chrome Android; plain
  `audio:true` is IN the trap, dictation included) and corrected the output-selector premise
  (platform-impossible on Android web; 0/5 peers ship one; the INPUT list is Android's route
  picker). The owner also ruled calls SURVIVE backgrounding — amending §5.3's foreground-only
  scope — and R75 ruled the one-knob shape SOUND WITH AMENDMENTS, its load-bearing find being the
  renderer freeze with NO microphone term: ~90 s of background silence and the ear goes DEAF while
  the overlay says Listening (corrects R14 §3.2/§3.4). Two slices; both feed the S4 sitting, which
  inherits R74's four-row routing probe and R75's §12.4 lock-screen freeze probe.

  > **S5 — the route wave (R74). ✅ BUILT 2026-09-21** (pinned Opus lane; commit `0388ad5` + the
  > review wave `40b6f32`; code round = blind Maya SHIP WITH FIXES 2 MED — F1 the probe latch ·
  > F2 half-accepted, the ghost option `disabled`, the auto-clear half OVERRULED with the plan
  > wording amended; FE 3,640 · BE 2,500 at close). ① `voice.live.route: "speaker" | "headphones"`
  > (**widened to a third answer, `"speaker-hifi"`, by D75 ① below** — additive; the default moved
  > to `speaker-hifi` by D75 ⑥ after the 2026-09-23 device probe) — a real Conf row. `headphones` sets the capture constraints to
  > `{echoCancellation: false, noiseSuppression: true, channelCount: 1}` (NS is software-side on
  > Android, it stays) so the phone never enters comm mode and TTS rides A2DP at media quality;
  > and it feeds ONE route-resolved capture policy (Maya F1 — the review's first HIGH): the
  > capture-ready block resolves `{earHoldMode, bargeArmed}` TOGETHER from the route — under
  > `headphones` there is no acoustic echo path (R74 §3's physical note), so ear-hold auto→OFF
  > AND `bargeArmed = knobs.barge_in` regardless of the AEC readback (the readback-`"all"` test
  > is a statement about leak, and headphones have none); under `speaker` both keep today's
  > track-readback rules. Explicit `echo_workaround: on/off` still overrides the hold half — the
  > route moves only what `auto` means, and `earHeld` stays derived in the one normalize. ② An
  > INPUT picker, labelled as what it is on Android (a route picker moving BOTH directions):
  > `voice.live.input_device` (deviceId, default "" = system default), a Conf picker fed by
  > `enumerateDevices()` — which (Maya F4) enumerates when the picker OPENS, re-enumerates after
  > the first permission-granting capture, and treats empty labels or a missing stored id as
  > never RE-PICKABLE (rendered "not available", disabled) — but the STORED preference itself is
  > kept, not auto-cleared: a headset merely off its charger vanishes from the list, and the
  > `ideal` + fallback-note mechanics already make the absent case graceful (S5 code-review F2
  > ruling — half accepted, half overruled); a picked device that fails `getUserMedia` FALLS BACK
  > to default and says so (R74 §2.2(b) — the failure is a null stream, not a constraint miss).
  > ③ Dictation rides the
  > SAME route-derived constraints + input device (closes the R51 §6.1 no-constraints residual —
  > dictation currently flips comm mode too). ④ NOT BUILT, ruled: an output dropdown on Android
  > (probe-and-hide `setSinkId` Jitsi-style where it exists — desktop), BT-mic steering (classic-BT
  > SCO caps output at mono 8/16 kHz), a native shell, any UA-sniff.
  >
  > **S6 — the background wave ✅ BUILT 2026-09-21** (pinned Opus lane; commit `7b8cd80` + the
  > review wave `4857d20`; code round = blind Maya SHIP WITH FIXES 1 HIGH · 2 MED · 1 LOW — F1
  > the acquisition-window terminal · F2 the gen-fenced wake lock · F3 accepted AS RESHAPED (her
  > mechanism wrong, the StrictMode marker-loss real — `unmounted` now carries `priorLeg`) · F4
  > OVERRULED on the fact (max_session_s's ceiling IS 7200); confirm round CONFIRMED, she re-ran
  > the pins herself; local liveCall e2e 20/20 on the production build; FE 3,643 at close.
  > ⚠ Recorded residual: a mic stolen AND returned entirely while hidden goes unreported until
  > the next wake.) **(R75, verdict SOUND WITH AMENDMENTS; all seven ACCEPTED, A3/A4
  > shaped by the main seat, A4's default the owner's).** ① `voice.live.background: true` — the
  > page going hidden no longer ends the call; the machine's `hidden` arm becomes POLICY
  > (`background` off ⇒ today's clean end), and TEARDOWN moves to `pagehide` (A7 — bfcache is
  > provably off mid-call, so pagehide is the document really dying). ② THE EAR-OUTAGE DETECTOR
  > (A2, not optional; shape = Maya F3): `pcmCapture` stamps the last worklet frame's arrival and
  > listens for the track's `mute`/`unmute` (today only `ended`); on `visibilitychange→visible` +
  > the Lifecycle `resume` event, a frame gap beyond a named threshold becomes ONE fenced
  > `earOutage` reducer signal — a NO-OP when the phase is already `connecting`/terminal or the
  > outage was handled for this `legSeq` (freeze recovery overlaps mute events and socket closes
  > by nature); otherwise the effect closes the leg and the EXISTING `socketLost` path owns the
  > single reconnect. The note says what happened in the owner's words — a resumed call must
  > never present as if it heard. ③ THE KEEPALIVE KNOB (A3; mechanism CORRECTED by Maya F2 — the
  > review's second HIGH: the worklet's outputs stay zero-filled, so raising the sink gain
  > multiplies zero): `voice.live.background_keepalive: true` — while a call is live AND the page
  > hidden, a `ConstantSourceNode` → tiny-gain (inaudible-but-nonzero) → destination node in the
  > CAPTURE context we already own emits real energy, making Blink's `IsAudible()` true, which
  > removes the freeze AND background throttling wholesale (R75 §3.5; energy > 0 is the whole
  > test). No asset, no second media element, and it NEVER touches the mouth's playback status —
  > `mouthLive` and the ear-hold cannot see it. Stopped on visible. Its Android side effects
  > (audio focus, the notification) are UNVERIFIED — the §12.4 phone probe validates before it is
  > believed; if it proves clean, MediaSession lock-screen controls unlock later (parked, not in
  > this wave). ④ THE BACKGROUND IDLE END (A4; semantics = Maya F6): `voice.live.
  > background_idle_s: 600` (0 = off; the owner's 10 minutes) — hidden + no speech + no reply for
  > the window ⇒ the reducer's own `idleExpired` lands a clean `ended` with a note saying why,
  > instead of a hot mic riding to the 30-min cap. The WIRING owns the timer; it resets on the
  > reducer-observed activity edges (`speechStart`/`final` · `playbackStarted`/`Drained`), an
  > outstanding CONFIRM GATE pauses it (ending a call while an approval waits destroys the
  > interaction the `agent_input` notification just asked for), and the keepalive never counts
  > (it exists outside the machine by construction). ⑤ A1: the wake lock re-acquires on `visible`
  > (5/5 field precedent; today's one request at mount leaves a returned call without it). ⑥ A5:
  > `turn_done` foreground notifications are SUPPRESSED while a call is live
  > (`useForegroundNotifications`' single chokepoint reads the call store; `agent_input` KEEPS
  > notifying — a voice-reached approval gate is exactly when a notification earns its keep).
  > ⑦ A6, RESHAPED TWICE (the main seat's ladder unification was OVERRULED on Maya F5 — two tabs
  > or a second device make "another call is active" a REAL story the ladder would erase): W3's
  > first-dial-terminal arm and its e2e pin STAND. The discard door gets its own narrow key: a
  > sessionStorage "live call in this tab" marker written at leg open and cleared on every clean
  > end — it survives a tab discard's reload, so a first dial that finds `busy` WITH the marker
  > standing is recovering this phone's own ≤10 s zombie and takes the note-only ladder path;
  > without the marker, terminal, today's copy. Ownership is never inferred from `attempts`.
  > ⑧ RULED NO-CHANGE (R75 §12.3): the pacer stays on the main thread (MessagePort is pausable,
  > never throttleable — no starve-then-burst exists), the ladder stays (a live track registers
  > `DisableAggressiveThrottling`; 1 s alignment ⇒ ~15 s > the 10 s slot), the mouth needs nothing.
  >
  > **The council round (2026-09-21 — blind Maya, the FIRST review on the Luna lane):** verdict
  > BUILD WITH CHANGES — 2 HIGH (F1 route/barge-arm mismatch · F2 the inert zero×gain keepalive,
  > both folded above) · 4 MED (F3 outage/ladder race · F4 picker enumeration truth · F5 the busy
  > unification overruled · F6 idle-clock semantics — all folded) · sweep "none" · the reducer/
  > normalize/reconnect fit judged sound. Main-seat rulings: all six ACCEPTED; F2's fix re-derived
  > leaner than the prescription (constant-source node over a looped clip — no asset, no second
  > element, no playback-status contamination); F5 accepted as an explicit REVERSAL of the main
  > seat's own D73 ⑥.

- **THE D74 WAVE — the in-call audio deck (owner-ruled 2026-09-21, the same evening; ruling =
  DECISIONS D74, which holds the eight rulings; evidence = [R76](./research/R76-noise-hallucination-gating.md) ·
  [R77](./research/R77-android10-pres-route-residual.md) · [R78](./research/R78-barge-arm-readback.md)).**
  The owner's D73 poke round, run live in conversation, supplied the whole docket: the S5 route
  knob sat on its `speaker` default (the fix built but OFF — proof routing cannot live in Conf),
  the by-hand `barge_threshold` walk (0.2/0.4 dead → 0.03 fires on the street → **0.06 works**)
  exposed the consecutive-frame brittleness AND R78's arithmetic finding, two noise finals
  committed as turns, and the "scratching" TTS correlated with asterisk actions.

  > **✅ BUILT 2026-09-21, same session** (two pinned Opus lanes — call machine · TTS-text/config —
  > disjoint file ownership, neither committing; blind Maya design round BUILD WITH CHANGES 3 MED ·
  > 1 LOW all folded PRE-build; blind Maya code round SHIP WITH FIXES 3 MED — F1 the m-of-n
  > `max(1, floor)` rounding · F2 the meter keyed to ACCEPTED reducer transitions (prev/next
  > threaded through `send`) · F3 split: the rung-walk accepted (`candidateConstraints` ladder,
  > owner pick → steer rungs → tail, NEVER the bare default while the BT row stands), the
  > structure-validation half overruled TWICE with the residual recorded at the decision site;
  > every fix red-proven against its named bypass; confirm round F1/F2/F3b CONFIRMED; gate 6/6
  > twice.) What landed: ① `RouteControls` on the CallOverlay — route toggle + device select,
  > reducer-owned ephemeral state, the `routeChange`→`recapture` LEG CYCLE re-running the one
  > extracted `acquire()` under the gen fence (never `applyConstraints`, never overlap) ② the R77
  > steering ladder in the ONE `openMicStream` chokepoint ③ the ONE `EarMeter` (trigger window ·
  > per-utterance epoch accrual · debug), `meterEdge` as the single edge chokepoint ④ the
  > transcript gate: `final` carries `energyMs`/`minFinalMs`, the reducer drops epoch-matched
  > too-quiet finals with `CALL_COPY.tooQuiet`, fail-OPEN without evidence, dictation out of scope
  > ⑤ `toSpeech`'s residual-`*` scrub + `voice.tts.speak_actions` (skip mode: closed spans + the
  > unclosed-opener drop + the ACTION_REWRITE stream hold — default mode holds nothing, the
  > no-stall ruling now standing on the scrub) ⑥ `store/micRelease` capture exclusivity (a call
  > awaits dictation's own stop) + the probe-latch serialization ⑦ the `CallDebug` snapshot on
  > CallView behind `voice.live.debug` (250 ms tick, overlay never touches the track) ⑧ knobs
  > `voice.live.min_final_ms` 200 · `voice.live.debug` false · `voice.tts.speak_actions` true
  > (→ **false**, owner re-ruling 2026-09-22 after the first live round — dialogue-only default) —
  > additive, no schema bump; client wire treats absence as OFF/legacy ⑨ `stt.hotwords` kept on
  > the whole-clip door only, the R76 inertness named in code. ⚠ S4 caveats inherited: the barge
  > floor is NOT portable across routes (R78 — headphones flips AGC/preset), and the owner's 0.06
  > wants one re-check on the windowed rule.
  > **Owner round 2026-09-22 (the deck's first poke; ruling = the D74 addendum ⑨/⑩):** the route
  > row moved to a TOP DECK above the ring (its own pointer-down stop, pinned) with
  > Output/Input/Speech micro-captions — the pills read identical — and the select's `all: unset`
  > top-skew centred (`line-height` = control height); `speak_actions` AND `barge_in` re-ruled
  > **false** (dialogue-only default; voice interrupt an opt-in, verified at 0.06 first); **the
  > SPEECH-THRESHOLD SLIDER landed on the deck** — the pill drops a vertical Android-volume slider,
  > release commits ONE leg redial carrying `start.vad_threshold` (the wire's one new optional
  > field, validated at `_parse_start`; the relay's one-`session.update` pin stands; per-call like
  > the route pair, `vadOverride` on CallState, `setVad`→`redialLeg`→the existing `openLeg`, gen
  > unmoved, ear untouched); `/voice/status.live_call` now carries `vad_threshold` as the slider's
  > seed; the persisting crackle + its either-control-recapture-sometimes-clears-it datapoint
  > recorded as **ISS-16** for the S4 sitting.
  > **The round's hardening pass (owner-ordered, same day):** blind Maya correctness round (SHIP
  > WITH FIXES, 3 MED) ∥ blind Opus design/UX round (SHIP WITH CHANGES, 5 MED/LOW + 3 sweep) —
  > disjoint lenses, and they CONVERGED on the one structural finding (Maya F1 ≡ design F6: the
  > base read the live query). All accepted; landed as: `vadBase` SEEDED ONCE at `captureReady`
  > (the route pair's own pattern — a mid-call Conf save moves neither the pill nor a later leg,
  > §4.5) · `meterEdge` clears trigger A's window + epoch on an accepted `setVad` (old-floor hits
  > cannot finish a kill across the redial) · explicit JSON `null` in `start.vad_threshold` is a
  > 1008, not a silent fallback · the deck is ONE flex row (RouteControls a fragment — the fourth
  > control lands as a peer) · a top scrim + `--text-2` captions (the veil's light end) · the
  > popover keeps the NavMenu contract (outside tap closes on CAPTURE, Escape closes the POPOVER —
  > it used to bubble into `modalKeyDown` and HANG UP — draft discarded at one chokepoint) ·
  > VAD_MIN/MAX/STEP named with the narrowing's why · polarity words on the track ends (up =
  > deafer; the first draft's comment had it backwards) · the pill's aria-label carries the value ·
  > keyboard commits on Enter only (no redial per arrow) · 44px drag column · the two
  > barge-gated Conf rows say "only with hands-free interruption on" · §5.1 `barge_in: false` ·
  > config.example names the verified 0.06 (speaker route, NOT portable — R78). Every fix
  > red-proven against its named bypass (the query-read, the deleted meter edge, `.get() is None`,
  > the unswallowed Escape). Declined, recorded: an explicit "(this call)" marker on the pill +
  > a Conf pointer (design F6-secondary, LOW — the next call's pill already speaks the reset);
  > an e2e slider arm (Maya LOW — the unit/wiring pins + the S4 phone round carry it). Maya
  > confirm round ruled not warranted (fixes are her prescriptions verbatim, red-proven); the
  > design lens confirmed by follow-up.

- **THE D75 WAVE — the hi-fi speaker route + the EC-release race (main seat, 2026-09-22; ruling =
  DECISIONS D75, which holds the five rulings; evidence = [R79](./research/R79-peer-call-audio-echo.md) ·
  [R80](./research/R80-comm-mode-crackle.md); the open root cause stays ISS-16).** The owner's deck
  round reported in-call TTS **crackling with echo cancellation engaged and clean with it off** — a
  correlation they isolated themselves by flipping the route mid-call, and which arrived
  state-INVERTED because the Output button named the ACTION ("Use headphones" while on speaker). Two
  commissioned dossiers settled the mechanism half: R80 read Chromium at HEAD (our playback pipe
  cannot change the route, the usage tag or the buffer class — the media element already gets the
  glitch-RESISTANT configuration; the "flipping a control sometimes clears it" latch is an ordering
  race in OUR code; software AEC and the loopback-reference trick are compiled out on Android), and
  R79 read eight peers (nobody does anything smarter that is page-reachable; the field's resting
  posture is half-duplex, Open WebUI deaf for the whole assistant turn by default; Android output
  selection re-verified dead at 0/8). Neither found the root cause — no phone in either session.

  > **✅ BUILT 2026-09-22, same day.** What landed: ① **`voice.live.route: "speaker-hifi"`** — the
  > loudspeaker with `echoCancellation: false`. ONE predicate carries it: `wantsAec(route)` beside
  > `onHeadphones`, and `micConstraints` asks `{ideal:"all"}` only where it is true. It needed **zero
  > logic** in the capture-ready block, which is the design's own proof — the ear-hold's `auto` arm
  > already reads the TRACK (`!headphones && readback !== "all"`), so an EC-off loudspeaker track
  > arms the hold and leaves `bargeArmed` false by the rules that were already there; `echo_workaround
  > on/off` still outranks. The R77 steering ladder's gate moved from "the headphones route" to "any
  > EC-off route": the SCO trap it guards is a property of EC-OFF CAPTURE (no comm-mode flip ⇒
  > `STRATEGY_MEDIA` ⇒ a default selection that starts SCO suspends the output into silence, with no
  > mode exit left to restore anything), and the new route rides the same physics. ② **The
  > readback-mismatch detector + ONE delayed re-open** (`openEcChecked`, `EC_RELEASE_RETRY_MS` = 250,
  > a named platform constant): when an EC-off ask reads back ENGAGED the stream is released, a beat
  > is waited, and the open runs once more — the only barrier the platform offers, since the mode is
  > restored asynchronously in the audio service when the LAST input stream is released (R80 §5.1) and
  > nothing surfaces "it's gone". Detection-driven, never an unconditional delay; the opposite
  > mismatch (asked AEC, got none) is a legitimate degrade and does not trip it; the second result is
  > accepted either way and `PcmCapture.ecStuck` surfaces through the `captureReady.note` seam
  > `deviceFallback` uses (**fellBack wins the one line** — it names a choice the owner made that did
  > not carry). The note is ADVISORY: a stuck track is governed by its readback, so the ear is safe
  > either way. ③ **`probeDuration` releases its throwaway element** (`removeAttribute("src")` +
  > `load()`, after the duration is read — detaching resets it to NaN): R80 §7-S1's insurance against
  > the ten-output-stream Android cap that killed a peer's TTS (open-webui#29969). ④ **The deck goes
  > STATE-FIRST**: the Output control is an icon pill showing the current route (`aria-label` =
  > "Sound: <name> — tap to change"), tapping opens a three-row `menu` of `menuitemradio`s (the
  > `PrivilegeChip` shape — review round A6; the first cut said `radiogroup`, which promises the
  > roving arrow-key selection this chip does not make) carrying each route's bargain as a hint;
  > the popover mechanics are extracted into one `useDeckPopover` the speech slider now wears too
  > (capture-phase outside close · Escape SWALLOWED — it would otherwise reach `modalKeyDown` and hang
  > up the call · focus back to the pill), with one `.kit-call-pop` surface and two anchoring variants.
  > The Input select stays NATIVE (the OS picker is the affordance where a real device list exists)
  > with a hard width cap, so the deck holds ONE LINE at a 320px viewport — `flex-wrap` stays as the
  > degenerate-viewport safety net, not as the layout.
  >
  > **The route table, as built:**
  >
  > | `route` | capture | device audio mode | TTS path | the ear under the reply |
  > |---|---|---|---|---|
  > | `speaker` (default) | `echoCancellation: {ideal:"all"}` | `MODE_IN_COMMUNICATION` | voice-communication, call quality | OPEN where the readback is `"all"` (subtractive), else the hold |
  > | `speaker-hifi` | `echoCancellation: false` | untouched | `AAUDIO_USAGE_MEDIA` | HELD while the mouth speaks; the tap is the interrupt |
  > | `headphones` | `echoCancellation: false` | untouched | `AAUDIO_USAGE_MEDIA` (A2DP) | OPEN — worn headphones have no acoustic echo path |
  >
  > **Not built, ruled (D75 ③/④):** the loopback-`RTCPeerConnection` AEC reference (zero Android
  > value at build-flag level) · a page output selector on Android (re-verified dead) · software AEC
  > on Android (compiled out) · R80 §10-②, the per-turn capture RELEASE during the mouth (AEC while
  > listening, media path while speaking) — **recorded as the designed follow-up behind a knob; it
  > needs its own slice and a device round.** ⚠ **The crackle's ROOT CAUSE stays ISS-16**, whose probe
  > ladder the S4 sitting inherits; ① is a mitigation and is recorded as one.
  >
  > **THE TRIPLE-BLIND REVIEW ROUND + FIX WAVE (owner-ordered; reviews 2026-09-22, the wave landed
  > across that session and the next — the verdicts, convergences and overrules are recorded in
  > DECISIONS D75; this is the as-built).** What the wave changed, by cluster:
  > **A (the deck)** — the popover ESCAPE handler moved to the `.kit-call-io` ROOT, gated on `open`
  > (the headline: focus sits on the PILL, the popover's sibling, so a handler on the popover node
  > never saw the keydown and Escape hung up the call — found blind by BOTH the temp e2e probe and
  > the correctness lens; with the popover closed Escape still reaches `modalKeyDown` and hangs up,
  > which is the gate's whole reason) · `aria-checked` compares the RESOLVED row, never the raw route
  > string (Maya — an unknown route now checks the plain-speaker row, the same fold `wantsAec` takes) ·
  > 44px touch targets (routebtn/device `min-height`, the icon pill 44×44, `line-height` moving with
  > it) · the picker card re-anchored to the DECK (`.pop-deck` drops the cell's own positioning; width
  > capped by the deck's content box, so "inside the viewport" is structural, not a `vw` guess) ·
  > copy: **Speaker** "echo-cancelled · phone-call sound" / **Speaker (clean)** "clear audio · mic
  > pauses while it speaks" / **Headphones** "clear audio · for when you're wearing them" (the Conf
  > Seg says "speaker (clean)" too — the stored value stays `speaker-hifi`, a rename is a migration
  > bought for nothing) · captions **Sound**/**Mic**, not Output/Input (an input pick moves BOTH
  > directions on Android — R74 §2.2) · `role="menu"`/`menuitemradio` · the outside tap closes via
  > `dismiss()` (one close, one focus rule) · the four `--text-1` ghosts → `var(--text)`.
  > **B (captions)** — the pointer-down stop fires ONLY while an edge is actually hidden (a short
  > reply stays a live interrupt target; the dead zone sat directly above the line saying "tap to
  > interrupt") · full-strength `var(--text)` (M1 — it was the most-read, least-legible thing on the
  > screen) · fade 12% · ONE `useVoiceStatus` read feeding both knob snapshots.
  > *(Superseded 2026-09-24 (DECISIONS D75 ruling): C, the spent-hold, `routedAgent`, fix-wave 2's
  > token-owned hold and the call's parked-pick note were all DELETED — the menu's agent pick is the
  > sticky session pin; only the skills stay one-shot.)*
  > **C (the armed pick)** — `useActiveBackdrop(armedPick = true)` and the CALL overlay passes
  > `false`: calls route by the ladder alone (`sendCallTranscript` never spends the one-shot), so the
  > call screen must not wear an armed face it will not route to; every CHAT reader keeps the pick ·
  > **THE SPENT-HOLD**: `takeComposerScope()` stashes the pick it spends into `spent` ATOMICALLY
  > (the `/verb` path's clear stashes nothing; the hand-clear clears both), `runComposer`'s own
  > `finally` releases it when the send settles, and the backdrop resolves armed ?? spent ?? ladder —
  > the preview holds through the armed message's own reply and reverts at settle, never mid-send
  > (H2: ordinary threads carry no pin, so the old collapse fell to the DEFAULT's art for exactly the
  > turn the preview promised) · the routing fold is ONE pure `routedAgent(pick, sticky, thread,
  > agents)` in `lib/composer` beside `effectiveAgent` — the backdrop and the tools menu's checked
  > row had each grown a copy and the copies had DIVERGED (an armed name the roster lost folded to
  > the default for one and checked no row in the other; both now take the server's own fold) · the
  > `ecStuck` docstring now states the value-dependent rule its code enforces (an `"all"` stuck track
  > lifts the hold and leaves barge armable) · the e2e `LIVE_CALL` fixture carries `captions: true` +
  > `vad_threshold: 0.4` · Conf copy ordered to the Seg.
  > **Tests** — the Escape arms fire on the PILL (the previously-unreachable focus state the old arm
  > missed is now the pinned one) + the closed-popover hang-up arm; the spent-hold arms drive the
  > REAL store and the REAL `runComposer` `finally` (red-proof: short-circuiting the `finally` fails
  > exactly one arm); the scope-free-call arms pin `useActiveBackdrop(false)`; both sides of the B1
  > bargain (short reply interrupts, scrolling reply reads). The temp visual spec re-ran with its
  > Escape assertion restored, then was deleted before commit (a capture probe, never suite).
  >
  > **FIX-WAVE ROUND 2, as built (2026-09-22 — the completed wave's own three-lane blind round;
  > verdicts + rulings in DECISIONS D75).** The spent-hold became TOKEN-OWNED in `composerScope`:
  > `takeComposerScope(stash: boolean)` returns `TakenScope {agent, skills, hold}` — it stashes only
  > when the caller says the send OWNS the turn (`runComposer` passes `getChatStatus() !==
  > "streaming"`, so a D41 steer, whose POST settles at the 202, never holds), an unarmed take
  > preserves a live hold, every stash bumps a module `holdSeq`, and `releaseSpent(hold)` (the
  > `finally`'s call, replacing `setSpentScope`) no-ops for a stale token — two same-name sends can
  > no longer release each other. `clearComposerScope` leaves the hold standing (the clear row is
  > about the NEXT message). `previewAgent(scope)` is the store's own armed-??-held expression;
  > `useActiveBackdrop` takes it. The captions floor gained the timeline belt: a `turnRan` ref set
  > while a turn is live, and until the first one the floor TRACKS `lastReply()` — a vanished
  > client-only placeholder id can no longer resurrect pre-call history (the fixture arms now route
  > call replies through a turn, the real store's only path). Deck: the Speech pill disables with
  > its siblings; the open pill is lit off `[aria-expanded="true"]`; `aria-haspopup="menu"` on the
  > Sound pill (deliberately not the Speech pill — a slider disclosure is no menu); a decorative ✓
  > on the checked row; the route fallback finds the SPEAKER row by value. New furniture: dialling
  > with a composer pick armed shows one `.kit-call-note` line ("calls run without the composer's
  > agent pick — it stays for your next typed message"), mount-snapshotted, gone on terminals.
  > Copy: Conf's route desc leads "the next call's default — the call screen changes it for a call
  > in progress" and its headphones clause names the Hands-free interruption switch; `voiceFailed`
  > says "the reply is text only". Rename `asked`→`engaged` in `openEcChecked`. **Recorded, not
  > built:** the mic-label display map (declined — the input list IS the router, R74 §2.2, and
  > "Speakerphone" is R77's trap word; the Sound-pill-vs-moved-output mismatch is platform-unfixable
  > and rides the S4 round) · the hung-transport hold + the roster-authority split + the
  > dismiss-onto-disabled-pill focus drop (residuals, D75) · release-at-settle vs
  > hold-through-the-voice (folded into the open one-shot-vs-sticky owner question). Red-proofs: the
  > gen guard, the steer gate and the floor belt each fail exactly their named arm when detached.
  > **Confirm rounds:** arch lens SHIP, all CONFIRMED with line proof; design lens CONFIRMED on
  > every landed fix, its H1 relabel WITHDRAWN (R77's trap word) and its leaner H1 form — an
  > indeterminate Sound pill after a synthetic mic pick — **deferred to S4** (needs the device's
  > synthetic-row→output truth table; an unconditional version false-dims agreeing picks). Its two
  > new LOWs landed same-wave: the lit-pill rule floors on `:not(:disabled)` (N1) and the
  > armed-pick note retires at the first heard utterance (N2). Full record: DECISIONS D75.

  > **D75 ADDENDUM — the coupling round + the BT media-path probe (owner, 2026-09-23, in
  > conversation; ruling = DECISIONS D75 ⑥).** The barge-derivation ("clean whenever interruptions
  > are off") was proposed and WALKED BACK on the walkie-talkie cost (an open EC-on speaker ear with
  > `barge_in` off queues talk-over as ONE drained message — a capability the owner keeps). Ruled:
  > all three routes stay; **Speaker (clean) becomes the shipped default for `voice.live.route`**,
  > built AFTER the probe below returns; BT auto-detection refused (the car/headphones pair defeats
  > it both ways — DECISIONS D75 ⑥ has the argument).
  >
  > **THE BT MEDIA-PATH PROBE (runs now — dev :8443; car arm whenever the owner is next in it).**
  > The claim under test: EC off rides Android's MEDIA path, which follows the system's own routing
  > — so the clean route should reach a connected BT sink (A2DP) with no page-side routing at all,
  > which is what makes the clean DEFAULT the right friction fix. Three questions, one sitting, BT
  > headphones connected, `barge_in` off, each arm = the deck's Sound pill mid-call or a fresh call:
  > **Q1** Speaker (clean): does the reply come out the HEADPHONES at media quality? (yes ⇒ the
  > claim holds ⇒ build the default flip). **Q2** Speaker (EC on): where does the reply go —
  > headset-at-phone-call-quality (SCO), loudspeaker, or earpiece? (names the D74 "doesn't switch
  > to Bluetooth" datapoint). **Q3** does the crackle track EC-on regardless of sink? Plus the R77
  > observation: with BT connected, which rows the Mic picker shows (the owner's pair is expected
  > to show NO headset row). **The car arm repeats Q1–Q3 in the car** — expected to differ exactly
  > where it matters: headset input rows present, loudspeaker acoustics, so clean-route audio via
  > A2DP with the ear held should be echo-free WITHOUT EC. Report per arm: sink · quality (clean /
  > crackle / phone-call-thin) · any latency oddity · whether the mic heard them normally after the
  > reply. If a route flip ever reads stuck, the one-line note names it (`ecStuck`).
  >
  > **PROBE RESULTS (owner, same day, BT headphones arm — the claim HOLDS; the default flip BUILT):**
  > **Q1** Speaker (clean) → the headphones, clean — the media path followed the system's routing
  > with zero page-side work. **Q2** Speaker (EC on) → the PHONE LOUDSPEAKER, crackling — comm mode
  > stays pinned to the loudspeaker on the Honor 20 rather than steering SCO, which decodes the D74
  > "doesn't switch to Bluetooth" report. **Q3** the crackle appeared ONLY on the EC-on arm; both
  > EC-off routes were indistinguishable (both → headphones, both clean). **The R77 observation
  > SHIFTED:** the Mic picker showed default · speakerphone mic · *a headset mic* ("I think") — R77
  > expected NO headset row from this pair; if that row is real, picking it would steer capture into
  > the phone-call path (the steering ladder guards it; default remains the right pick). Confirm the
  > exact label at the next sitting. **The flip (built same day):** `LiveCfg.route` default →
  > `"speaker-hifi"` + the ConfTab seed/fallback + the example-config row + the barge_in row's
  > inert-on-clean clause; the owner's own config wrote `speaker` in the D74 round, so their standing
  > default moves only by their Conf hand. **Car arm still owed** (Q1–Q3 + the mic list from the
  > car — expected: headset rows present, clean route echo-free via A2DP because the ear is held).
  >
  > **THE AFTERNOON SITTING CARD (2026-09-23, owner-requested).** *Self-serve:* ① Conf → Audio
  > route → **speaker (clean)** if they want the clean default standing (their config still says
  > `speaker`) · ② the headset-mic row's EXACT label (Mic picker, BT connected — the R77 premise
  > check; don't pick it) · ③ the CAR arm above · ④ the remaining D75 pokes if not yet done
  > (captions on a real call · backdrop: arm → instant preview → send → holds through the reply →
  > reverts at settle). *The ISS-16 probe ladder* (R80 §10-④; route = **Speaker, the EC-on one**,
  > same longish reply per arm, ONE variable at a time): **P1** Conf → Voice · TTS → chunked
  > synthesis → **off** — crackle vanishes ⇒ seam-shaped (flip back to `sentence` after; first
  > audio will be slower whole-blob on that arm, expected) · **P2** the capture context opens with
  > `latencyHint: "playback"` — a ONE-LINE dev edit at `pcmCapture.ts:588` applied live between
  > arms (a diagnostic, deliberately not a knob; reverted after) — crackle vanishes ⇒ R80 §3.2
  > answered: the LOW_LATENCY capture stream is the culprit, and a playback-hint capture during
  > calls becomes the real fix candidate (would make EC-on speaker + interruptions usable again) ·
  > **P3** (optional; needs the phone on USB at the computer) `chrome://inspect` from emma →
  > `chrome://media-internals` during a crackling reply — prints the opened output params +
  > underruns, and answers whether the Honor 20 grants LOW_LATENCY in comm mode at all. Both P1
  > and P2 "no change" is ALSO an answer: the glitch then lives below the page (P3's territory).
  >
  > **THE AFTERNOON SITTING — RECORD (2026-09-23, in conversation).** The owner arrived with the
  > crackle GONE on Speaker (EC on), BT disconnected, chunked synthesis on or off — and then caught
  > it RETURNING the moment `speak_actions` went ON: **the datapoint that re-orders the ISS-16
  > ladder** (recorded there in full — the toggle is most plausibly a LENGTH / read-along
  > catch-up proxy, so the new arms are A chunking-off · B read-along-off · C a short plain reply,
  > all with `speak_actions` ON; the capture-side `latencyHint` diagnostic drops to last). NOT run
  > this sitting: the car arm · the headset-mic label with the pair CONNECTED (the four-row Mic list
  > they saw with NOTHING connected — `System default · Default · Speakerphone · Headset earpiece`
  > — is exactly R77's predicted list: **"Headset earpiece" is Chrome's fixed name for the phone's
  > own EARPIECE**, the receiver held to the ear on a phone call, not a Bluetooth row; "System
  > default" is our empty-constraint row and "Default" is Chrome's own default entry, two names for
  > the same routing decision — a candidate for hiding Chrome's row, not done) · P3. **Rulings +
  > small fixes landed this sitting (one commit):** the Speech pill goes ROUND (wears
  > `kit-call-iconpill`: a 44px disc, the number unchanged at 13px) · the Mic select drops its drawn
  > arrow ("just the name" — the caption + the platform picker are the affordance) · the heard line
  > keeps its `…` through `waitingFinal`, so the previous final no longer surfaces during the STT
  > round-trip (`CallView.waitingFinal` exposed; the pair is the machine's own words-in-flight
  > predicate) · the chat log's ResizeObserver now also watches the log itself (the "slightly
  > scrolled up on return to the agent tab" report: content growing AFTER the one-frame tab-entry
  > pin was never re-pinned, because a scroller's own box does not change when its content does —
  > hypothesis-driven; the owner's next return to the tab verifies). Workflow ruling the same
  > sitting: the Opus workforce is **Opus 5.5** from now on (CLAUDE.md; the alias, not a pin). The
  > owner's standing route is back on Speaker (EC on) by their own Conf hand; the clean default
  > stays the shipped default.

- **THE D76 WAVE — the call's few controls: Media/Call · the self-deciding mic hold · one relative
  Sensitivity (main seat, 2026-09-25; ruling = [`D76`](./DECISIONS.md); evidence = R82 · R83 · R84 ·
  R85 over the owner's S4 round №1/№2).** The owner's rounds asked three things in one breath — "had
  to shout" in the car, short false turns at home, and "I don't want to manually pick headphones" —
  and the research settled that they are ONE structural fault (an absolute linear floor calibrated
  on one mic for a different job, plus a Silero END threshold at the cliff) and ONE naming fault
  (the picker's axis is media/call, not speaker/headphones). The design below is the ruling.
  **Council:** blind Maya (Luna, high) design round → **RETHINK** [4 HIGH · 5 MED · 1 LOW; the
  verdict keyed to F1, the one-shot probe] → all ten ACCEPTED and folded → self-contained confirm →
  **STILL BLOCKED** on two residuals (the chunk-start signal does not exist in today's playback
  contract; the cold-start fallback was still absolute) → both folded (B.3 / C.4) → micro-confirm
  (result recorded at the end of this block). **Not built at write time** — §H is the ladder.
  > *Amended after the blind Maya design round of 2026-09-25 (ten findings, all accepted; the rulings are in the round record). Evidence: R82 · R83 · R84 · R85 (+ R76). Owner rulings 2026-09-24/25: as few deck controls as matter; the mic-hold option is CONFIG ONLY; output follows Bluetooth automatically; the deaf window at chunk starts is accepted over a self-transcribed turn.*
  >
  > ## A. Output — `route: media | call` (was `speaker | speaker-hifi | headphones`)
  > The deck's Sound picker has two rows. **Media** (default): "clear audio · follows Bluetooth like music, phone speaker otherwise" = today's EC-off constraints (`echoCancellation: false`), the platform's media path. **Call**: "phone-call mode · echo-cancelled · uses a hands-free device's own mic" = today's `{ideal: "all"}` ask, which flips the device into communication mode. `wantsAec(route) ≡ route === "call"`. The Headphones row is deleted — its only content was "media + no mic pause", which B now decides. `onHeadphones` is deleted; its two consumers (the barge-arming line and `earHoldMode`) take B's answer instead. The picker footer stays ("a change mid-reply starts with the next reply").
  >
  > ## B. The mic hold — `mic_hold: auto | on | off` (was `echo_workaround`; Conf row "Mic off while it speaks"; CONFIG ONLY, not on the deck)
  > `on` = the ear is held for every reply, whatever the output. `off` = never held (a loudspeaker can transcribe its own reply — the gate in C is then the only turn boundary). `auto` = **the leak probe**:
  >
  > 1. **Held ≠ `track.enabled = false` any more.** The capture classifies every frame at the callback — `{buf, rms, uplinked: boolean}` where `uplinked = !(muted || held)` — and the HOOK substitutes at the hook→pacer boundary: a frame that is not `uplinked` goes up as ONE reusable zeroed buffer of the same byte length (the server sees exactly today's digital silence; its silence timers and endpointing are untouched). `rms` stays REAL on every frame. `muted` alone drives `track.enabled` (privacy, the OS mic indicator). The liveness stamp, the OS-mute listeners and the pacer are unchanged — they see the same frame arrivals. (Maya F7.)
  > 2. **Consumers are partitioned by `uplinked`** (Maya F2/F3, the ordering requirement): the noise tracker, the own-voice learner and the gate's energy accrual consume ONLY uplinked frames; the probe consumes ONLY held frames. Nothing reads both.
  > 3. **Per CHUNK, not per reply** (Maya F1; confirm-round residual №1 folded): at every chunk's audible start under `mic_hold = auto` on a route whose AEC readback is not `"all"`, the ear is HELD; over the next `PROBE_MS` (600 — a platform/latency safety constant, named in the hook beside `BARGE_HIT_RATIO`; S4 measures it) the probe takes the MAX held-frame level. **Leak ⇔ max ≥ the effective floor (C)**. Leak → held for the rest of this chunk. No leak → released for the rest of this chunk. The next chunk re-probes. **The chunk-start signal is NEW and comes from the controller, not from `PlayStatus`**: `useLiveCall` today sees only the idle→playing EDGE (`playbackStarted` fires on a status transition, `useLiveCall.ts` ~1905–1913), while every chunk is a fresh `src` whose `playing` event fires with the status already latched at "playing" (`audioController.ts` ~504–507). So the controller gains `setCallChunkStart(cb: ((idx: number) => void) | null)` — the exact shape of the existing `setCallPrePlay` registration (~285) — invoked from the element's `playing` listener for the live session's `playIdx`; the call wiring registers it for the call's lifetime and feeds a `chunkStarted` signal (gen-fenced) into the reducer; the probe arms on THAT signal, never on the status edge. Bluetooth output latency only exists on the paths that do not leak (A2DP to headphones/car ~100–250 ms); the loudspeaker leaks within tens of ms; a device that begins leaking mid-call is caught at the next chunk.
  > 4. **Before a noise floor exists** (C.2's provisional window) → held. **Route/device change** → the capture generation moves (the existing `gen` token); probe/release callbacks no-op against a stale generation; a recapture while the mouth is live holds at once and re-probes at the next chunk (Maya F6). **`route = call` with AEC readback `"all"`** → no probe, never held (the canceller subtracts the reply — S0's ruling stands).
  > 5. **What protects the turn** (Maya F2, stated precisely): the server transcribes whatever it is sent; the CLIENT gate in C is the turn boundary; a leak that fails the gate cannot become a turn; a leak that would pass it is what the probe holds against. Recorded fallback if S4 shows probe misses: a text backstop — a final arriving during playback whose tokens mostly match the playing reply's text is dropped as self-echo. Not built now.
  > 6. **Cost**: one max over ~15 numbers per chunk; no new audio graph; the deaf window is `PROBE_MS` per chunk on the media route (today's media row is deaf for the whole reply).
  >
  > ## C. Sensitivity — the floor goes RELATIVE and dB; ONE deck control with Auto (replaces the Speech slider)
  > 1. **dB at the chokepoint.** The hook converts once where frames arrive: `dbfs = 20·log10(max(rms, 1e-6))`.
  > 2. **Noise floor** (WebRTC's minimum-tracking shape, R83): over each window take the MIN uplinked-frame level, discarding frames < −84 dBFS; a lower window minimum replaces the floor at once, a higher one moves it halfway. **The first window is 1 s** (provisional), later windows 5 s (Maya F5). Reset on recapture. Constants (`NOISE_WINDOW_MS` 5000 · `NOISE_BOOTSTRAP_MS` 1000 · `NOISE_DISCARD_DBFS` −84) are estimator-policy constants named in the hook.
  > 3. **Own-voice level**: from an ACCEPTED final whose frames' 90th-percentile level ≥ noise + `noise_margin_db` + `voice_margin_db` (clearly above the floor — an interferer that barely passed does not teach) and none of whose frames were captured while the mouth was live → EMA (`VOICE_EMA_ALPHA` 0.3) into `voiceLevel` (Maya F4). Persisted in `UIState` keyed by the capture's **effective device** (readback `deviceId`, or the track label when the id is empty/default); a call whose device differs from the stored key starts unseeded (Maya F8).
  > 4. **Effective floor (auto)** = clamp(max(noise + `noise_margin_db`, voiceLevel − `voice_margin_db`), `min_dbfs`, `max_dbfs`) once the tracker has ONE FULL window (5 s). **Bootstrap (confirm-round residual №2 folded — permissive, never stricter than the ceiling):** until the first full window, floor = **min**(provisional noise + `noise_margin_db`, `floor_dbfs`) — i.e. `floor_dbfs` is the CEILING the floor may not exceed while the estimate is provisional, so a quiet first turn in the car is admitted; with no estimate at all (the first ~1 s, before a final can even exist) the floor is `floor_dbfs`. **The own-voice term applies as soon as `voiceLevel` is KNOWN** — seeded from `UIState` at call start or learned — including during the bootstrap (micro-confirm MED folded: a sustained interferer sitting between the eventual floor and the −45 ceiling would otherwise ride the 5 s permissive window; with a seeded voice level it fails `voiceLevel − voice_margin_db` from the first frame). Only LEARNING waits for the first full window (the learner's guard needs a settled noise term); using a known value does not. The one residual: the first-ever call on a device (no seed) keeps the 5 s hole once — recorded, accepted. voiceLevel unknown → noise + margin. Defaults: `noise_margin_db` 10 · `voice_margin_db` 10 · `floor_dbfs` −45 · `min_dbfs` −60 · `max_dbfs` −20 — all `LiveCfg` fields, delivered by `GET /voice/status`.
  > 5. **The gate** is unchanged in rule: `min_final_ms` (200) of UPLINKED frames ≥ effective floor during the utterance, else the final is dropped ("too quiet"), **plus a short sound cue on the drop** (R85; the car cannot read the note). *Corrected at S0b's brief: the call had NO sound-cue path — `voice.live.ring` is the VISUAL ring mode — so the cue is a new small `lib/callCue.ts`: a 120 ms 440 Hz sine through a gain ramp on the capture's own AudioContext (Hermes' beep shape); always on, no knob — a behaviour, not a tunable.*
  > 6. **Barge floor** (`barge_in` on) = effective floor + `playback_margin_db` (10) while `mouthLive`. `min_speech_ms` and `BARGE_HIT_RATIO` unchanged. `barge_threshold` is DELETED.
  > 7. **The deck control**: the `VadControl` popover pattern becomes a LIVE METER — a vertical bar = the current level (sampled every `METER_TICK_MS` 100 via ref, never per frame — the D74 S7 rule), a marker = the effective floor, an "Auto" caption; dragging the marker PINS a manual dBFS floor for THIS call (writes nothing; Discord's shape); tapping Auto releases the pin. Range `min_dbfs`…`max_dbfs`. Applies instantly — no leg redial.
  >
  > ## D. Silero — Conf only
  > `vad_threshold` default 0.9 → **0.6**, bounded 0.5–0.8 in Conf (R84: the END threshold `threshold − 0.15` is what cuts quiet/narrowband speech; the start threshold is not the noise lever). `silence_ms` stays 700, bounded 500–1200. The in-call Speech slider, `setVad` → `redialLeg`, and the `start.vad_threshold` wire field + its `_parse_start` arm are DELETED (no legacy seams; the relay keeps reading the Conf value for its one `session.update`).
  >
  > ## E. Config shape + migration (schema 3 → 4, one step; write-back deletes the old keys)
  > `voice.live` stays the ONE flat unified object. Additive: `floor_dbfs`, `noise_margin_db`, `voice_margin_db`, `playback_margin_db`, `min_dbfs`, `max_dbfs`. The step: `route: speaker → call · speaker-hifi → media · headphones → media`; `echo_workaround → mic_hold` (values unchanged); `barge_threshold` dropped (calibrated for a job the relative floor now does; not converted); `vad_threshold`: a stored **0.9 → 0.6** (the known bad shipped default), any other stored value clamped into [0.5, 0.8], unset stays unset (Maya F9). Unchanged: `input_device`, `min_speech_ms`, `min_final_ms`, `silence_ms`, `barge_in`, `debug`, `ring`, `captions`, `frame_ms`, …
  >
  > ## F. Constants — ownership (Maya F10)
  > Config (`LiveCfg`, in status): the margins, the clamp bounds, `floor_dbfs`, `min_final_ms`, `min_speech_ms`, `vad_threshold`, `silence_ms`. Named hook constants with a stated owner each: `PROBE_MS` 600 (platform/latency safety; S4 evidence owed) · `NOISE_WINDOW_MS`/`NOISE_BOOTSTRAP_MS`/`NOISE_DISCARD_DBFS`/`VOICE_EMA_ALPHA` (estimator policy) · `METER_TICK_MS` 100 (a property of reading, like `DEBUG_TICK_MS`). `frame_ms` stays config.
  >
  > ## G. Layering (unchanged boundaries)
  > worklet (samples → `{buf, rms}`) → capture (`uplinked` classification; `muted` → `track.enabled`) → hook (dB conversion · substitution at the pacer boundary · noise tracker · voice learner · probe · effective floor in ONE normalize, derived flags never maintained per arm) → overlay (the meter reads via ref; the picker's two rows; nothing decides here).
  >
  > ## H. The slice ladder (each slice: pinned Opus 5.5 build → main-seat audit → blind Maya code round → fix wave → self-contained confirm; the owner's phone round is the gate)
  > - **S0a — the backend shape.** `LiveCfg`: `route: Literal["media","call"]` (default media) · `mic_hold: Literal["auto","on","off"]` · the six new gate fields with bounds · `vad_threshold` bounded 0.5–0.8, default 0.6 · `silence_ms` bounded 500–1200 · `barge_threshold` and `echo_workaround` gone. Migration step 3→4 (E) with tests for every rename/drop/clamp and the 0.9→0.6 map. `GET /voice/status` carries the new fields. The `start.vad_threshold` wire field + its `_parse_start` arm deleted. Every BE test that spelled the old values updated.
  >   **✅ BUILT 2026-09-25 — `5e7b668` + the fix wave `6eeabf1`.** As designed, plus: `redialLeg` DELETED (only `setVad` ever emitted it; route/device changes use `recapture`) · `liveSocket`'s `vadThreshold` option deleted · an ABSENT route now means media (the model's default; the S0a round asked whether the legacy AEC-on reading should survive — overruled, recorded in `useDictation.ts`) · the Silero row's advice inverted ("lower it if quiet words get cut off") · `config.example.yaml` follows the model. Migration step 4 `LIVE_VOICE_D76` (46 tests; `applies` and `apply` share one fold). Blind Maya code round SHIP WITH FIXES [2 MED · 1 LOW]: the hands-free row's dead-route wording (fixed), the absent-route comment (fixed; her code change overruled), the flush pad's now-constant `max()` (documented). Dev's config migrated 3→4 by hand (`--apply`; the app refuses to start on a stale schema by design — backup `backups/config.yaml.20260924T2242…`).
  > - **S0b — the client core (no UI).** `pcmCapture`: `{buf, rms, uplinked}`; `muted` alone drives `track.enabled`; `setHeld` only flips the classification. `useLiveCall`: the substitution at the pacer boundary (one reusable zero buffer) · dBFS at the frame chokepoint · the noise tracker (1 s bootstrap, 5 s windows, −84 discard, min-tracking with instant-down/half-up) · the own-voice learner with the F4 guard and the F8 device key in `UIState` · the effective floor in ONE normalize (auto/manual pin) · the gate and the barge floor read it · the drop cue through the existing cue path. Pure-function unit tests for tracker/learner/floor; reducer tests for the gate on uplinked-only accrual.
  >   **✅ BUILT 2026-09-25 — `77fd2c2` + the fix wave `dbf3978`.** As designed, plus: `readLevel()` on `CallView` instead of `level`/`floor` fields (a ref read — the meter ticks it; a plain field would only refresh on re-render) · the own-voice term applies even before any noise estimate (the plan's clause, not the brief's pseudo-code) · the clamp covers the `floor_dbfs` case too; the pin alone is unclamped · held frames never count toward interruption · persistence via `store/persist.ts` (the `sheetSnap` shape), NOT `UIState` (synced across devices — a mic level is device-local) · the estimator constants live in `levelGate.ts`, the hook's header points there · `LiveCfg` accepts unknown extras so a leftover `barge_threshold` loads as ignored (pinned). Blind Maya code round SHIP WITH FIXES [2 MED], both folded: the tracker PAUSES while the mouth is live (R83 §8 — the canceller's residue is not the room) · the drop cue's window rides up as SILENCE (`CUE_HOLD_MS` = the tone + the output path's latency, counted in FRAMES — the ear's clock). Dev's config re-migrated from its version-3 backup so the extended step dropped `barge_threshold` (`backups/config.yaml.20260924T2310…`).
  > - **S1 — the surfaces.** The Sound picker's two rows (Media/Call) + footer · Conf: the route Seg, the "Mic off while it speaks" Seg, the bounded Silero/silence rows, the gate rows (margins/bounds/floor) · the Sensitivity control replacing `VadControl` (live meter via ref at `METER_TICK_MS`, the Auto caption, drag = per-call pin, tap Auto = release). e2e specs whose labels change (the D74/D75 deck specs) updated. Wording per the owner's ruling that the axis is media/call, not speaker/headphones.
  >   **✅ BUILT 2026-09-25 — `9de6aef` + `40569a2` (the bounds validator) + the fix wave `61ec24b`.** As designed, plus: the ONE drag mechanism is a transparent native vertical range over the whole 44×132 column (keyboard + AT for free); transforms only (`scaleY` fill, a `--f` translate marker); the caption "Auto / drag to pin" ↔ "−38 dB / tap for auto" in ONE two-line box so the column never moves under the finger (e2e-caught); Auto's release moves focus back to the range so Escape keeps working (e2e-caught); `CallView.floorAuto` (the pinned value is the control's own — it is the only pinner); polarity proven in unit + real-Chromium e2e (bottom = `min_dbfs` = more sensitive); three cells on one line at 360 px (asserted) and 320 (measured). Blind Maya code round SHIP WITH FIXES [2 MED · 1 LOW]: a close mid-drag COMMITTED the pending value (fixed: only a lift pins; the tick already commits while dragging) · `min_dbfs ≥ max_dbfs` unguarded (fixed on the BACKEND: a `LiveCfg` after-validator, the chunk-bounds precedent) · the range announced the browser's midpoint before a floor existed (fixed: "Auto").
  > - **S2 — the leak probe (`mic_hold: auto`).** Per-chunk hold at `playbackStarted` · `PROBE_MS` window of held-frame max vs the effective floor · release/hold for the chunk · generation fencing on recapture · the `call`+AEC-"all" bypass · `on`/`off` absolute. Reducer + wiring tests (a soft-onset chunk, a chunk boundary, a device change mid-reply, the first reply before the bootstrap window).
  >   **✅ BUILT 2026-09-25 — `429c3b0`.** As designed, plus: a fourth state field `probeIdx` (a verdict for another chunk needs the current index somewhere) · the pre-play tap is registered whenever the ear MAY hold (`on`, or `auto` without `"all"`) and drops any running probe · **a bug the build caught:** a probe cut short at one reply's end could finish on the NEXT reply's frames and release it — every playback status change now clears the probe directly · every chunk play holds the capture before its first sample · before a noise floor exists the probe stays held, and since the tracker pauses under the mouth a route change mid-reply keeps the rest of that reply held (B.4; S3 should know). Red-proofs: forced-leak / forced-clear / the mute + cue exclusions / the controller's duplicate-chunk check each went red with the code commented out. The controller reports a chunk once per `{reqSeq, playIdx}`. Blind Maya code round SHIP WITH FIXES [1 LOW]: the wiring tests hand-feed `chunkStarted` rather than driving the controller's `playing` listener into the hook — RULED two-sided seam coverage, intentional (the controller test pins the dedupe, the wiring test pins the registration + the reducer; jsdom plays no media, so an end-to-end test would mock the element anyway); every path she traced — release, hold, probe window, `ecAll`+`on`, recapture, dedupe, stale gen, the debug units — SOUND. Her side check of the S1 fix wave (`61ec24b`) and the bounds validator (`40569a2`): sound. **D76 S0a–S2 CLOSED; S3 = the owner's phone round.**
  > - **S3 — the owner's phone round = the gate.** Car on Media (A2DP to the car; the phone mic; the probe should HOLD) · headphones (the probe should RELEASE; duplex) · loudspeaker at home (HOLD) · the TV test (the relative floor + the guarded learner) · the meter's Auto marker vs their voice · `PROBE_MS` evidence (the debug readout logs per chunk: held-max dBFS, floor, decision). Then the S4 §4.1 close-out inherits: `LiveCfg.enabled` → ON, Phase 24 S4 checked, the plan's §4.1 table rewritten to the new knobs.
  >   **S3 ROUND №1 (2026-09-25) — two verdicts in, both traced to root cause, the fix wave BUILT the same sitting (+ D77, the call trail).** ① *Media + `mic_hold: auto` on the loudspeaker: "the agent can hear itself."* MEASURED: PocketTTS opens EVERY clip with a 10 ms −58 dBFS click and then 320–760 ms of −81 dBFS digital pad before the first sound (three sentences synthesized on dev: 760 · 320 · 640 ms), so B.3's 600 ms window heard pad, judged "no leak", released the ear, and the reply's real speech leaked into the open mic and cleared the transcript gate — the probe's PREMISE broke, not its logic. **Fix S3a:** `core/audio.py::trim_wav_silence` at the ONE TTS chokepoint (`VoiceClient.synthesize`, bytes-sniffed — PocketTTS answers WAV to any format ask), knob `voice.tts.trim_silence` (default on, server-side, not in `/voice/status`); named constants −60 dBFS · 40 ms lead · 120 ms tail · 10 ms frames · a TWO-frame onset run (the click is a lone loud frame — counted as signal it pinned the cut to sample 0); every pre-`data` chunk kept verbatim, pad-byte-correct skips, EXTENSIBLE resolved to its SubFormat, everything else passed through unchanged. On the measured clips: 810 · 270 · 590 ms removed, sound now at 40–50 ms — every sentence starts sooner everywhere (read-aloud too) and the probe window lands on speech. `PROBE_MS` stays 600. ② *Call route + the "default" Mic row: deaf until Speakerphone; the owner confirmed the "too quiet" note and escaped by dragging the Sensitivity marker down.* TRACED: C.3's learned own-voice level was keyed by device alone; the same mic opens quieter under the Call route (comm-mode processing — R83: ~4 dB into the handset, more at a distance), so the Call capture inherited Media's loud V, `V − 10` sat above the owner's voice, every final dropped; Speakerphone = a different id = unseeded = heard; the pin accepts finals and `learnVoice` relearns under it. **Fix S3b:** the key is `"<device>|ec=<all|on|off>"` from the GRANTED echo readback (not the asked route — R78 §2.3's pin), legacy flat keys purged on write, the key on the debug readout. **Recorded, not built (D76 addendum in DECISIONS):** the within-mode deadlock (V − margin above a ≥10 dB posture change; nothing accepted ⇒ V never lowers; the pin is the escape and relearns) — "drops teach downward" REJECTED (a loud TV dropped as too quiet would walk V down to itself and pass, defeating C.3's purpose); a chunk that fires `playing` and then stalls > 600 ms would still release (chunks are complete blobs — theoretical). **D77 — THE CALL TRAIL (S3c)**, from the owner's ask ("so you actually can see exactly what happened in a call"): `$CTRLB_HOME/calls/<call_id>.jsonl`, both halves write it — the relay (`leg_start` with the exact `session.update` · every `down` frame incl. the transcript text, once · `flush` · `stop` · `up_error` · `leg_end`) and the browser via `POST /api/voice/live/trail` (every reducer signal at the ONE `send()` chokepoint with phase/note moves, `textLen` not text, the `final` sig's pre-reduce hold snapshot, `genMove`, an `oversize` marker for an entry past 2 KB · a `final` line per judged final with the meter's peak/accrued ms + the floor it met · `capture` with the readback + voice key/seed + gate knobs · `probe` per verdict · `sample` at 1 Hz = the MOVING fields of the debug block's lifted record builder + phase). Gate = `voice.live.debug` (404 when off; the wire's `start` byte-identical when off); identity = a client-minted UUID + the hook's `legSeq` as `leg` on every line and in `start`; bounds 200 entries / 64 KB / 2 KB per entry; flushes at 50 entries · 32 KiB · 2 s, `keepalive` on hidden/end; retention `voice.live.trail_keep` (20). Council: blind Maya design round BUILD WITH CHANGES [4 MED · 1 LOW — leg identity, the keepalive byte cap, one copy of the transcript, the RIFF walker's contract FOLDED; the stall class RECORDED]. **Code round (blind, two lenses, same day):** Maya on the backend — SHIP WITH FIXES [5 MED: the media type must follow the sniffed container (a WAV to an `opus` ask was `audio/ogg`) · the body cap refused only after allocating the chunk · `os.write` may short-write (→ a buffered writer) · the relay's `down` line was noted outside the send lock (order ≠ wire order under two pumps) · the prune could delete the file it just created on an mtime tie — ALL FIVE FIXED main-seat, two new tests]; Opus on the frontend + design fit — SHIP WITH FIXES [2 MED: the final's peak/floor reached no line (→ the `final` line) · one oversized entry 422'd its batch (→ the `oversize` marker); 3 LOW: the sample repeated per-capture constants (→ moving fields + phase) · a gen-moving signal stamped with the new gen (→ `genMove`) · the full 64-hex voice key ran off the phone's debug block (→ its own line, id cut to 8) — ALL FIXED by a pinned-Opus fix wave + the marker keeps its `type`]. Both lenses ruled the call machine's behaviour untouched. **The main seat reads the trail after the owner's round: `ls -t ~/.ctrl-b-dev/calls | head -1`.**
  > 
  > **Micro-confirm (Maya, 2026-09-25, self-contained):** residual №1 RESOLVED (the chunk callback rides the element's
  > per-chunk lifecycle — `playNext` assigns a new `src` per chunk, `ended` advances it, read-along appends future
  > entries only; she asks that the callback be keyed to `playIdx`/generation because `playing` can recur after a
  > stall — B.3's fencing says so) · residual №2 RESOLVED (`min()` is the right combinator; a final cannot arrive
  > inside the first second — speech + 700 ms) · ONE new MED (a sustained interferer riding the 5 s permissive
  > window) → folded per her second lean fix: the own-voice term applies as soon as known (C.4). **Design CLOSED;
  > the code rounds re-review everything built.**

## 8. Open questions for the owner (the court)

**Owner rulings landed 2026-09-11 (in conversation):** ① §4.4 truncation as a follow-up slice —
AGREED · ② minimal overlay — YES, tuned by feel rounds after S2 · ④ the Speaches server —
**LEAVE AS IS; ctrl-b touches nothing outside the project** (folded into §5.2/§7-S0) · NEW
ruling: the behavior toggles and tuning knobs are real Settings rows, not YAML-only (folded
into §5.1) · the reference-project inheritance made explicit (§2.1, the owner's ask).

**The visual-design round (owner, 2026-09-11, in conversation — all folded into §5.1/§6):**
the overlay design is RATIFIED — full-bleed backdrop in BOTH modes, never a blank-backdrop
call screen (the cutout-portrait look explicitly rejected) · ring vs no-ring as a real
Settings toggle (`voice.live.ring`, default ring) · the ring is a stroke-only circumference
over the face, **focal-anchored** to the live backdrop's stored focal point · no-ring state
display = the transcript line's accent ("we can tweak it as we see it") · the ring animates
from CALL STATE only — audio-amplitude analysis **DECLINED**, no extra machinery · live call
gets its **own Conf section**, not rows inside the voice group or Appearance ("isn't that
more clear?"). The ring mode is the owner's envisioned look; the no-ring accent is the
experimental arm of the pair.

**The refinement round (owner, 2026-09-12, in conversation — "everything looks good, except
for the button placement"; all folded into §4.5/§5.1/§6/§7):** the twelve code-scouted
tightenings approved wholesale · mute button — YES · confirm gates in-call = the in-overlay
Allow/Deny row through `resumeCall` (spoken confirmation deliberately not offered) · staged
attachments ride the call turn · the agent-gallery second door DEFERRED (do not re-propose
ad hoc) · transcript line = what the ear heard. **The entry affordance, RATIFIED same round
(after the R69 field pass, owner-commissioned):** a separate call button beside the mic
REJECTED (composer space) → the §6 dual-mode mic — the owner's rulings: gesture change to
dictation blessed (hold-to-record replaces tap-to-record) · slide-left cancel IN · **no mode
memory, boots mic** · the gesture lands as its own EARLY slice (S0.5) feel-tested on
dictation first. Two recorded deviations from the field, both deliberate: call-commit on
release (no field precedent exists for gesture-started calls — R69 headline) and the ~2 s
tappable "Start call" chip as the single-pointer twin. R69 also corrected two premises we
carried: Telegram's 150 ms is tap-disambiguation, not a long-press, and Fennec's vibrate API
no-ops undetectably.

**Interruption ruling (owner, 2026-09-12, in conversation):** automatic interruption is
OPTIONAL — the `barge_in` Settings row governs only the voice trigger; a **manual
tap-to-interrupt** (the ChatGPT pattern, the owner's cite) always exists during `speaking`
(tap outside the controls, both ring modes). `barge_in` OFF = walkie-talkie: over-speech
still transcribes and buffers, submitting on drain. Folded into §4.3 + §6.

**The coherence sweep (main seat, 2026-09-12 — the owner asked for a hunt for
under-specified behaviors; all findings folded in place, flagged as "coherence sweep"):**
① the §4.3 one-slot buffer CONTRADICTED walkie-talkie mode (a long hold's second utterance
would overwrite the first) → unified into ONE ordered pending-utterance queue · ② mute's
loop rules (mid-utterance mute discards; muted finals dropped; static muted visual) · ③
overlay taps inert outside `speaking` · ④ mouth failure nonfatal, ear keeps working · ⑤
submit failure harvests to the draft, never loses speech · ⑥ the reconnect contract made
concrete (bounded backoff; a mid-utterance drop honestly loses that utterance) · ⑦ speech
during `awaiting_confirm` = an ordinary steer, the tap still owed · ⑧ the confirm row is
Allow/Deny ONLY · ⑨ terminal faces carry redial; user hang-up closes instantly · ⑩ release
composes with `stt_auto_send` (gesture ≠ send policy) · ⑪ the 1000 ms floor checks before
upload · ⑫ ring anchor never reads `z`; reduced motion keeps states readable · ⑬ hint
counters device-local · ⑭ `voice.enabled` master outranks the `live` bit. All conservative
derivations from existing rulings/patterns — the owner's review of this list is their veto
window.

**The court is CLOSED — every item below is ruled** (kept for the rationale, not as work). The
one live decision left in this phase is S4's: fixed endpointing vs architecture ②, item 5's tail.

3. ~~**Browser priority**~~ **ANSWERED BY S0 + RULED (owner, 2026-09-12): Chrome is the
   first-class call browser.** Chrome's `"all"` AEC measured genuinely subtractive on the
   owner's phone (playback cancelled, the owner's voice survives ⇒ voice barge-in viable);
   Fennec's AEC measured INEFFECTIVE against the phone's own playback (near-full-volume leak),
   so on Fennec `echo_workaround` resolves to the protective ear-hold — calls fully work,
   interruption is tap-only there. The web-push precedent (Fennec expected-partial) applied
   deliberately; capability-detected per track, never UA-sniffed; S3 builds the branch. Full
   numbers + mechanism = the §7-S0 as-built record.
4. ~~**A delta design round?**~~ **RAN (owner-ordered, 2026-09-12) — see §9's delta-round
   entry: SHIP WITH CHANGES, 4H·5M·2L, all eleven ACCEPTED and folded in place.**
5. ~~**Streaming dictation — "text fills the composer as I talk"**~~ **RULED (owner,
   2026-09-13, same conversation): PHRASE-BY-PHRASE — YES, a planned feature; research
   commissioned ([R70](./research/R70-phrase-streaming-dictation.md)) and the slice added to
   the §7 ladder as S2.5.** The capability facts that framed it (R51/R68, re-verified twice):
   the Speaches realtime ear has NO PARTIALS — one whole-utterance FINAL per pause;
   word-by-word is a server capability we lack, not a toggle. The three tiers as discussed:
   **(a)** today's shipped hold→release→text (S0.5) · **(b) phrase-by-phrase riding the S1
   ear — RATIFIED:** hold the mic, keep talking, each utterance final appends to the draft at
   every pause; reuses the S1 relay + the existing draft-append seam, one more consumer of the
   same WS · **(c)** true word-by-word = a partial-capable STT server — stays EXACTLY the §2.1
   shelved-with-trigger item (arch ② / a fork patch on ~github/speaches — our maintenance, and
   it crosses the §5.2 posture); **the S4 calibration round remains the decision point**,
   taken with the phrase-level feel in hand; partials also cost FE revise-and-repaint logic,
   never plain appends.

## 9. Council record

- **2026-09-11 — the R68 fold (main seat):** the delta dossier's three load-bearing corrections
  folded — Chrome ≥141 `echoCancellation:"all"` (§4.3 re-branched, S0 probe shrunk), the Speaches
  local-fork/frozen-upstream reality + Parakeet + the `0.0.0.0` posture (§0/§2/§5.2/§7-S0/§8.4),
  and the ②-fallback's browser leg re-based on Silero v6 weights (§4.1).
- **2026-09-11 — the blind Emma design round (hermes lane, `--ignore-rules`, R46 brief):
  verdict RETHINK — 2 HIGH · 7 MED, open sweep "none", architecture ① explicitly affirmed
  ("does not need relitigation"). All nine findings ACCEPTED by the main seat; both HIGHs
  code-verified before ruling.** F1 (HIGH 0.99): cancelled turns persist NO partial text and C3
  outlives the turn → §4.4 rewritten as deferred-v2 with the honest v1 posture. F2 (HIGH 1.0):
  Speaches `TurnDetection` has no min-speech field → the floor became a client-side
  sustained-energy gate on the barge-in ACTION (fork patch recorded as the S4 fallback). F3:
  the narrow chat-store turn seam (both Stop and call take it). F4: the ordered
  kill→cancel-settle→submit contract with the one-buffered-final rule. F5: primary phase + two
  orthogonal flags; playback-start checks `userSpeechActive`. F6: client `bufferedAmount`
  ceiling + declared numeric bounds. F7: the feed-boundary map's ≤1-sentence claim corrected
  (greatest-boundary-≤-played; folded into the v2 record). F8: basic barge-in moved INTO S2;
  S3 became hardening. F9: WS `Origin` validation + the process-wide session cap. Her summary
  notes (queue-drain observability naming) folded into §4.2.
- **2026-09-11 — her confirm round (same session resumed): F1–F9 all RESOLVED with line proof
  (F1/F6 partially — two residuals), fix-sweep 2 MED, no third — verdict SHIP WITH CHANGES; all
  four folded same session:** the stale §2 truncate phrase deleted (F1 residual) · the
  message-rate ceiling made an ENFORCED protocol-error close (F6 residual) · `barge_threshold`
  declared (0 = reuse Tier-0's `auto_stop_threshold`; MED 1) · playback gated on
  `userSpeechActive || waitingFinal` with the flag's clear condition stated (MED 2). **The
  design is council-closed pending the owner's ratification (→ D71 + the CLAUDE.md doc-map row
  at that word).**
- **2026-09-11 — RATIFIED by the owner (in conversation, "okay then")** after the plain-language
  brief + the §2.1 reference-projects discussion; their four rulings (server untouched ·
  truncation as follow-up · minimal overlay · knobs as real Settings) folded the same session.
  → **D71** + the CLAUDE.md doc-map row + the TODO Phase 24 block. §8.3 (Fennec posture) stays
  open for S0's empirical answer.
- **2026-09-12 — the blind Emma DELTA round (owner-ordered; hermes lane, `--ignore-rules`,
  R46 brief scoped to `git diff ff33b61..HEAD` on this file): verdict SHIP WITH CHANGES —
  4 HIGH · 5 MED · 2 LOW, open sweep "none" beyond one LOW, several §4.5 mechanisms
  explicitly verified sound. ALL ELEVEN ACCEPTED by the main seat (each corroborated against
  the independent code scout) and folded in place, marked "delta round F#":** F1
  `awaiting_confirm` mis-shape (→ queue-hold + the recorded PRE-EXISTING typed-text 202
  defect riding the F3 seam slice) · F2 the upload retry didn't exist (→ pending-queue
  retry-on-settle) · F3 mute's two incompatible mechanisms (→ disabled track, silent frames
  keep flowing) · F4 the §0 "zero mouth changes" claim false (→ the minimal audioController
  surface, S2a) · F5 the getUserMedia arming latch · F6 the dominant-axis commit rule · F7
  the queue's call-generation fence + terminal disposition (hang-up discards, failure
  harvests) · F8 the accept/refuse send result (runComposer's boolean is routing-only) · F9
  overlay-local ring coordinates vs the visual viewport · F10 S2 split into S2a/S2b ·
  sweep-LOW the backdrop ladder clarified (useActiveBackdrop alone, no gacha oracle). Her
  factual correction adopted: the line composer's mic is NOT draft-empty-gated at tip.
- **2026-09-12 — her confirm round (same session resumed, fold commit `024de33`): ALL ELEVEN
  RESOLVED with line proof — she rated the F1 queue-hold shape STRONGER than her own narrow
  prescription — fix-sweep "none". VERDICT: RESOLVED — SHIP. The design is council-closed
  over the FULL amended text; the build opens at §7-S0.**
