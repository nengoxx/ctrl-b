# Live voice mode ("call mode") — design draft v1

> **Status: ✏️ DESIGN DRAFT (2026-09-11) — not ratified, nothing built.** Written by the main seat
> off R51 (the standing dossier) + the as-built seams at the current tip; the R68 delta pass
> (Speaches/VAD/AEC movement since R51's 2026-08-21 pins) folds in before the council round.
> Authority once ratified: this file owns the live-voice design; ROADMAP §C4 becomes a pointer.
> D-entry lands at ratification (the first WebSocket in the codebase needs one — §5.1).

## 0. Evidence + as-built seams (verified at tip `4aa1a0b`, 2026-09-11)

**Evidence:** [R51](./research/R51-realtime-voice-chat.md) (the full field dossier: the owner's
RealtimeVoiceChat fork + upstream, RealtimeSTT/TTS, pipecat, livekit/agents, Speaches source +
live probe, the four chat peers, the browser half) · [R68](./research/R68-live-voice-deltas.md)
(the 2026-09-11 delta) · R48/R50 (chunked TTS, measured) · R14 (Android background/mic ceiling).

**The seams this lands on, as they exist today:**

| Seam | Where | What it gives us |
|---|---|---|
| The mouth | `lib/audioController.ts` (D63 + read-along) | Sentence-chunked synth on one `<audio>`, ~0.7 s first audio, an **open-session feeder** (`feedReadAlong`/`endTurnSpeak`) that speaks the reply *as it streams*, per-agent voice (D70 §8.5), and a working kill (session abort + element pause + URL revoke). **Call mode needs zero changes here.** |
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

The mic **stays open while the bot speaks** (RVC's 1–2 s deaf window is the recorded
anti-pattern). The trigger: during `speaking`, a `speech_started` from the server VAD **gated by
a client-side sustained-energy floor** — Speaches emits `speech_started` on first detection and
has no minimum-speech knob (council F2), so the ACTION waits until the capture worklet (which
already owns the samples) has seen ≥ `min_speech_ms` of sustained RMS. The ear never closes;
only the kill is gated, so a cough costs nothing and real speech costs ~300 ms of overlap.
(The recorded alternative if S4 calibration shows this floor unreliable: patch the owned
Speaches fork with a real `min_speech_duration_ms` — we already carry local commits there.)

The action, **ordered (council F4)**: ① C3 kill (pause + session abort — synchronous, the
audible part stops now) → ② scoped cancel through the §4.2 seam **and await its settlement** →
③ only then submit the buffered final — while a cancel is pending, `useLiveCall` buffers exactly
one completed utterance, and a call-origin steer the cancel harvested is consumed rather than
restored into the composer. This closes the race where a short interrupt's transcript lands as a
202 steer on the dying turn and gets silently harvested into a draft.

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
```

Delivered to the client via `GET /voice/status` (the established non-Conf-scoped voice-policy
door); Conf gets the group under the existing `voice` section. `enabled: false` or no resolvable
target → the call button is not rendered (the `VoiceClient.configured` pattern).

### 5.2 Security posture (SECURITY_MODEL lens)

- Same origin, same tailnet-only bind, `wss:` under the existing Tailscale Serve cert — no new
  ingress class, no new port.
- The Speaches bearer never leaves the backend (the A11 secret rules apply — never logged, never
  echoed in errors). **R68 §1.2 found the current Speaches posture is itself the weak point: it
  binds `0.0.0.0:9000` with a placeholder API key — an effectively-unauthenticated realtime WS on
  the LAN.** Not ctrl-b code, but the design refuses to *widen* that exposure: the relay is the
  only client, so the S0 checklist recommends re-binding Speaches to loopback (it is colocal with
  ctrl-b on emma) or setting a real key — the owner's server, the owner's call (§8).
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

## 6. The UI (VAPOR_PATTERNS governs; kit overlay contract)

A **call overlay** (the kit's overlay pattern — form-sibling mount, the `.mform` lesson): the
active agent's art as the backdrop (`useActiveBackdrop` — a call with Lynette looks like *her*),
a state indicator (the five states as one animated affordance, not five labels), the live final
transcript line, and **hang up**. Entry: a call button in the composer's voice cluster, rendered
only when `voice.live` is configured+enabled. Speaking style: minimal v1 — no waveforms, no
partials (we have none), no speed slider (playbackRate exists in the player already).
Theme-tokened; gacha/kit/frontier inherit through tokens (no per-theme bespoke work in v1).

## 7. Slice ladder (each: pinned Opus build → main-seat audit → blind Emma round → fix wave → close)

- **S0 — probes + the ear smoke (gates the design's one open branch):** the AEC device probe —
  now small (R68 §3.3): a dev-only page reading `getCapabilities()/getSettings()` under
  `echoCancellation: {ideal:"all"}` + one acoustic leak check, run by the owner on Chrome +
  Fennec (~5 min each); the Fennec mic-permission persistence check rides the same sitting; a
  server-side smoke script proving emma → Speaches `/v1/realtime?intent=transcription`
  end-to-end **against the resident Parakeet model** (VAD events, a real transcript from a real
  clip — this also exercises the fork's own `e093d8b` no-speech path). The Speaches posture
  fix (loopback bind or a real key, §5.2) rides here. **Rules `echo_workaround` and confirms the
  Speaches contract before anything is built on it.**
- **S1 — the BE relay:** `voice.live` config + `/voice/status` delivery + the WS route + the
  relay session (mock-Speaches tests: framing, resampling, backpressure, caps, error taxonomy,
  bearer never in logs).
- **S2 — the FE call loop, WITH basic barge-in (council F8 — an open-mic loop that cannot be
  interrupted is not a reviewable slice):** capture worklet + WS client + the `useLiveCall`
  machine (§4.2, incl. the new chat-store turn seam — F3) + the call overlay +
  submit-through-`runComposer` + read-along forced on + Wake Lock + degrade states + the plain
  kill: speech during `speaking` (energy floor, §4.3) stops audio and cancels a live turn.
  (End of S2 = a full interruptible conversation on the S0-ruled echo branch.)
- **S3 — interruption hardening:** the §4.3 ordered cancel-settle contract + the buffered-final
  race (F4) · the playback-would-start-while-speaking edge (F5) · the echo fallback branch if S0
  ruled dirty · reconnect/backpressure edges (F6) exercised against a flaky link.
- **S4 — the owner calibration + device round (the phase gate):** real phone, real rooms — noisy
  and quiet; the §4.1 knobs tuned by feel; the Tier 0 auto-stop threshold calibrated in the same
  sitting; `enabled` flips ON as the round's close.

## 8. Open questions for the owner (the court)

1. **§4.4 truncation — now DEFERRED to v2 by council ruling** (the persistence seam the draft
   assumed does not exist; a real fix is its own design). v1's posture: an interrupted reply
   either under-remembers (mid-turn, same as text Stop today) or over-remembers (post-terminal).
   Say the word if you want the v2 slice bought sooner rather than later.
2. **The overlay's look** — minimal state-ring v1 as specced, with the agent art backdrop? Or
   hold UI polish for a feel round after S2 (the design assumes the latter's spirit: build
   minimal, tune by eye).
3. **Browser priority** — S0 probes both; if Fennec's AEC or permission story is bad, is
   "Chrome for calls" an acceptable v1 posture (the web-push precedent)?
4. **The Speaches posture** (R68 §1.2) — it binds `0.0.0.0:9000` on the LAN with a placeholder
   API key. The design recommends loopback-binding it (ctrl-b's relay is its only intended
   client and is colocal) or setting a real key in S0. Your server, your call.

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
- *(to be appended: the owner's ratification.)*
