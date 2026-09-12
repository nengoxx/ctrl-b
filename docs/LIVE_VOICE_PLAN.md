# Live voice mode ("call mode") — design draft v1

> **Status: ✏️ DESIGN RATIFIED 2026-09-11 ([D71](./DECISIONS.md)) — the owner's word, after the
> brief + the §2.1 discussion; nothing built yet. Build = Phase 24 (TODO), §7's S0–S4 ladder,
> one slice per session under the standing cadence.** Council trail = §9 (blind Emma RETHINK →
> all folded → confirm SHIP WITH CHANGES). This file owns the live-voice design; ROADMAP §C4 is
> a pointer; D71 records the WebSocket admission.

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
| Speaches | emma `:9000` — a **local fork**, `~/github/speaches` @ `e093d8b` (R68 §1: upstream frozen at the R51 pin for 5 months; +2 local commits incl. a Parakeet/VAD fix; the openapi `version` field is a hardcoded literal — pin by SHA) | `/v1/realtime` WS, **`intent=transcription`**: Silero server VAD + endpointing + whole-utterance finals. No partials, no truncate, no auto-interrupt (all three gaps re-verified unchanged, R68 §1.1). Resident STT = **Parakeet** (not Whisper). ⚠ posture: binds `0.0.0.0` with a placeholder API key (§5.2). |
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
(council F2, source-verified), so `min_speech_ms` is a CLIENT-side gate (§4.3), not a server
knob:**

| Knob | Default | Where | What it tunes |
|---|---|---|---|
| `vad_threshold` | 0.9 (Speaches') | server | Speech probability floor — **noise robustness** (higher = fewer false triggers) |
| `silence_ms` | 700 | server | End-of-utterance silence — **quiet-moment tolerance** (550 feels clipped for thinking speech; RVC's dynamic floor averaged ~0.4–2.3 s; we start mid-field and calibrate in S4) |
| `min_speech_ms` | 300 | client | The barge-in ACTION floor (§4.3) — a cough/door-slam must not kill playback |
| `barge_threshold` | 0 (= reuse Tier-0's `auto_stop_threshold`) | client | The RMS amplitude floor the §4.3 sustained-energy gate measures against (confirm-round MED 1) — same detector family as Tier 0, calibrated in the same S4 sitting |
| `frame_ms` | 40 | client | Uplink frame duration |

Client-side, the capture asks for `echoCancellation: true, noiseSuppression: true, channelCount: 1`
(today's dictation passes no constraints at all — R51 §6.1 flagged it; dictation inherits the fix).
**S4 is a dedicated owner calibration round** on the real phone in real rooms — the knobs exist so
that round turns dials instead of filing bugs. (The Tier 0 auto-stop threshold that "pends owner
calibration" since v1.7.6 gets calibrated in the same round — same detector family, one sitting.)

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
either holds, that IS a barge-in (kill before first audio, §4.3); a final arriving
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
  the track's `ended` → the call ends in `error` with a plain reason. Page-hidden already ends
  cleanly (§5.3).
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
    enabled: false          # whole-feature toggle (the standing pluggability requirement); OFF until S4 passes
    target: ""              # provider-registry reference for the realtime endpoint (empty → resolve like stt)
    vad_threshold: 0.9
    silence_ms: 700
    min_speech_ms: 300
    frame_ms: 40
    max_session_s: 1800
    max_frame_bytes: 32768
    buffered_ceiling_ms: 1000   # client outbound-buffer ceiling before close+reconnect (F6)
    barge_threshold: 0          # RMS floor for the barge-in energy gate; 0 = reuse stt.auto_stop_threshold
    max_sessions: 1             # process-wide live-session cap (F9; N=1 service)
    echo_workaround: auto   # auto | on | off  (S0 probe decides auto's meaning per UA)
    barge_in: true
    ring: true              # §6 overlay mode: true = the focal-anchored face ring; false = art-only + transcript accent
```

Delivered to the client via `GET /voice/status` (the established non-Conf-scoped voice-policy
door). **Owner ruling 2026-09-11: these are real Settings, not YAML-only — and the visual-design
round the same day sharpened the placement: live call gets its OWN Conf section ("Live call"),
not rows tucked into the existing voice group or Appearance.** The section carries the behavior
toggles (`enabled`, `barge_in`, `echo_workaround`, the §6 `ring` mode) and the tuning numerics
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
- Page hidden / phone locked → the call **ends cleanly** (R14 scope: foreground-only; no
  half-alive background sessions). Wake Lock held while the overlay is up.
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
- **S0.5 — the entry gesture (FE-only; owner-ratified early so the feel round runs on real
  dictation before the call exists):** the §6 dual-mode mic — the shared gesture hook +
  animations + the mic-mode leg live against today's `useDictation` (hold · lock · slide-left
  cancel · the 1000 ms floor · hints · the pointercancel promote-to-lock rule); call mode's
  chrome ships but stays hidden until the `live` bit exists (S1/S2). Parameters tuned by the
  owner's feel round against R69's table.
- **S1 — the BE relay:** `voice.live` config + `/voice/status` delivery + the WS route + the
  relay session (mock-Speaches tests: framing, resampling, backpressure, caps, error taxonomy,
  bearer never in logs).
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
- **S2b — the overlay's presentation + furniture:** both `ring` modes (the focal-anchor
  helper with F9's coordinate discipline + the transcript-accent arm) · mute (F3's one
  mechanism) · the in-overlay confirm row · terminal faces + back-trap · the remaining §4.5
  edge rules not already forced by S2a's loop.
- **S3 — interruption hardening:** the §4.3 ordered cancel-settle contract + the buffered-final
  race (F4) · the playback-would-start-while-speaking edge (F5) · the echo fallback branch if S0
  ruled dirty · reconnect/backpressure edges (F6) exercised against a flaky link.
- **S4 — the owner calibration + device round (the phase gate):** real phone, real rooms — noisy
  and quiet; the §4.1 knobs tuned by feel; the Tier 0 auto-stop threshold calibrated in the same
  sitting; `enabled` flips ON as the round's close.

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

Still open:

3. **Browser priority** — S0 probes both; if Fennec's AEC or permission story is bad, is
   "Chrome for calls" an acceptable v1 posture (the web-push precedent)?
4. ~~**A delta design round?**~~ **RAN (owner-ordered, 2026-09-12) — see §9's delta-round
   entry: SHIP WITH CHANGES, 4H·5M·2L, all eleven ACCEPTED and folded in place.**

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
