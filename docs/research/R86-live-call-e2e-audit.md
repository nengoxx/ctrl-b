# R86 — Live voice call: adversarial end-to-end audit before v1.7.8

**Date:** 2026-09-26
**Auditor:** Opus 5.5 (single lane, no subagents)
**Tip:** `0c8ee16` (S4 close-out, `voice.live.enabled` default → true)
**Status:** Audit dossier. Findings only; nothing in the tree was changed.
**Scope:** the Phase 24 live call end to end for its first production release. Covers the config and
first-run path (`LiveCfg`, migration step 4, `GET /voice/status`, the Conf seed), the relay
(`api/voice.py`, `services/voice_live.py`), the D77 trail (`services/call_trail.py`,
`lib/callTrail.ts`), the client machine (`hooks/useLiveCall.ts`, `store/liveCall.ts`,
`lib/liveSocket.ts`, `lib/levelGate.ts`, `lib/pcmCapture.ts`), and the mouth
(`lib/audioController.ts`). Owned Speaches source (`~/github/speaches`) was read where the relay's
contract depends on it. Items the brief already lists as known are excluded.

**How the findings were checked.** Some reducer findings are marked "VERIFIED (ran)". For those,
`callReduce` was bundled with esbuild to stdout and piped into `node`, with no file written; the
exact signal sequences are quoted with each finding. The audio-controller finding was checked the
same way, with stub `Audio` and `fetch`. The existing suites are green at the tip: BE
`test_voice_live_s1` · `test_voice_6a` · `test_config_migration_step4_live` pass (214). FE
`useLiveCall` · `useLiveCallWiring` · `audioControllerCall` · `levelGate` · `liveSocket` ·
`callTrail` pass (278).

---

## Findings (most severe first)

Severity: **HIGH** is a concrete failure that does not depend on input or environment. **MED** is real
but depends on a named scenario. **LOW** is defence-in-depth or maintainability. No HIGH was found.

### LC-1 · MED · confidence 0.8: the §4.2 "iron rule" kills the reply and cancels the turn on a raw VAD event, with no energy gate and regardless of `barge_in`, so noise can make a reply disappear

`frontend/src/hooks/useLiveCall.ts:889` and `:1690`:
```ts
if (s.userSpeechActive || s.waitingFinal) {        // playbackStarted arm
…
void cancelTurn(turn, "discard").then(() => send({ type: "killSettled", gen }));
```
`userSpeechActive` and `waitingFinal` come straight from the server VAD's `speech_started` and
`speech_stopped`. Silero is level-invariant (R76 §④), which is why D74 and D76 built the transcript
gate: noise finals are dropped as "too quiet". The iron rule fires before that gate is ever
consulted, and `barge_in` (off by default since 09-22) plays no part in it: the reducer never sees
`barge_in`, and `bargeArmed` is wiring-only.

**Scenario:** the owner asks something. During `thinking` the ear is open, and a TV, a next-room
voice or a "mm" fires `speech_started`. The reply's first read-along chunk starts while that
segment's flags are up. The iron rule then kills it: `dismiss()`, then
`cancelTurn(turn, "discard")`. Because the turn is usually still streaming at the first chunk, a
mid-turn cancel persists nothing (§4.4). The noise final then arrives and is dropped by the gate,
which plays the drop cue.

The owner hears nothing, sees "too quiet — didn't take that", and the thread has their question with
no answer. The same thing happens at any mid-reply synthesis-gap resume (`loading → playing` is a
fresh `playbackStarted`) whenever the probe has released the ear, such as on headphones or in the car.
That is the walkie-talkie over-talk the `barge_in: false` default promises not to interrupt.

Ran: `ready → final("what's the weather") → sent → speechStart → playbackStarted` gives
`[{"type":"kill"}]`. Then `speechStop → final("yeah", energyMs 0, minFinalMs 200)` gives the drop
cue, and `killSettled` gives `listening`, empty queue, nothing submitted.

**Leanest fix:** make the kill need the same evidence the final gate uses. Carry the open epoch's
`accruedMs` on `playbackStarted`, the way `final` carries `energyMs`/`minFinalMs`. Skip the kill when
an epoch-matched accrual sits below `min_final_ms`. That fails open on unmeasured epochs, exactly
like the gate. If the owner rules that the iron rule should also respect `barge_in: false`, that is
one more condition on the same line.

**VERIFIED (ran the reducer; the kill effect and the §4.4 persistence were read).**

### LC-2 · MED · confidence 0.85: an upstream transcription error strands `waitingFinal`, and the next reply is killed and its turn cancelled

Owned Speaches, `realtime/input_audio_buffer_event_router.py:164-175`: when the loopback
transcription raises `openai.APIStatusError`, it publishes an `error` event and never a `…completed`
event. The relay forwards that as `{type:"error", code:"upstream_error"}` and keeps the session
alive. The client arm, `useLiveCall.ts:1124-1126`, only sets the note:
```ts
case "upstream_error":
  // The ONE code the relay keeps the session alive through — so the client must too.
  return { state: { ...s, note: sig.message || CALL_COPY.lost }, out: [] };
```
`waitingFinal` stays `true` until some later final arrives. Meanwhile the heard line shows `…`
forever, and every `playbackStarted` hits the iron rule (LC-1's code path), so the pending reply is
killed and its live turn cancelled with nothing persisted.

Ran: `speechStart → speechStop → serverError{upstream_error}` gives `waitingFinal: true`. Then
`playbackStarted` gives `[{"type":"kill"}]`. After `killSettled`, `waitingFinal` is still `true`,
and a further `playbackStarted` gives `[{"type":"kill"}]` again.

This needs Speaches to answer a transcription with an HTTP error, for example on a too-short or empty
VAD-applied buffer or a busy or failed model. The Speaches journal since 09-01 shows no such event,
so the likelihood is unmeasured. The mechanism is certain.

**Leanest fix:** in the `upstream_error` arm also clear `waitingFinal`. If a final does come later,
the `final` arm handles it regardless of the flag, so the clear loses nothing.

**VERIFIED (ran the reducer; Speaches source read).**

### LC-3 · MED · confidence 0.85: in a call, a reply whose synthesis fails entirely is silent with no explanation (regression from ISS-18's D1 fix)

`frontend/src/lib/audioController.ts:1042-1047`, the in-call `finish()` branch, runs before the
all-failed check at `:1059`:
```ts
if (callVoice.active) {
  set({ status: "paused" });
  dropSession(s);
```
The wiring treats `loading → idle` as the mouth failing (`useLiveCall.ts:2341`) and
`loading → paused` as a drain. A synthesis failure never ticks `mouthFailed()`: only `play()`
rejection and element `error` do.

Ran against the real controller with every `/api/voice/tts` returning 502 and a read-along reply fed
and flushed:
- in a call, the status edges are `idle->loading  loading->paused  paused->idle`;
- outside a call, they are `idle->loading  loading->idle`.

So in a call the machine sees a drain from a phase that was never `speaking`, and the
`playbackDrained` arm returns quietly. The §4.5 "voice failed — the reply is text only" note never
appears. The controller's error toast is painted under the call screen (`.toasts` is z 40,
`.kit-call` is z 55, `kit.css:3539`/`:9012`), so the owner gets complete silence and a screen that
goes back to Listening. Only the chunked path regressed; `chunking: off` still goes `loading → idle`.

This matters for v1.7.8 specifically: the prod TTS flip (a new endpoint, per-agent voice names that
PocketTTS may 502 on) is exactly when every chunk failing is plausible.

**Leanest fix:** in the call branch, when no chunk was ever playable (`s.states.indexOf("ok") < 0`),
call `mouthFailed()` before the `paused` publish. That is the explicit tick the transport cannot
express, and the wiring already turns it into the note.

**VERIFIED (ran the controller; the wiring arm and the z-order were read).**

### LC-4 · MED · confidence 0.85 on the mechanism: a route/device change whose redial is refused `busy` by the call's own old leg ends the call as "another call is active"

The `routeChange` arm sets `attempts: 0` (`useLiveCall.ts:988`). The busy arm is terminal whenever
`s.attempts === 0 && !s.priorLeg` (`:1114`). `priorLeg` is only ever set from the sessionStorage
marker at mount (`:2289`). The recapture effect's own comment (`:1724`) claims:
```ts
// first (a clean close releases the relay's slot synchronously, so the redial below is
// never refused `busy` by our own leg — and the S6 ⑦ marker covers the window if it is)
```
Neither half holds:
- The slot is released in the route's `finally` (`api/voice.py:269-273`). That runs only after the
  close frame has crossed Serve, `_pump` has torn down, and `_close_upstream` has finished its
  websocket close with Speaches.
- The marker reaches the reducer only through `priorLeg` at call start.

Ran: `captureReady → ready → routeChange{call}` gives `attempts 0`. Then `serverError{busy}` gives
`error | "another call is active" | teardown`.

The race is rare on a good link. It is plausible on a congested uplink: the old close frame queues
behind up to `buffered_ceiling_ms` of audio while the new connection's handshake does not. That is
the car, which is exactly where the owner flips Media/Call. The same false terminal is reachable by
a hang-up followed by an immediate re-dial, because teardown clears the marker.

**Leanest fix:** `priorLeg: true` in the `routeChange` state. This tab demonstrably owned a leg a
moment ago, so the busy arm takes the note-only ladder path the marker was built for.

**VERIFIED (ran the reducer). The timing is UNVERIFIED.**

### LC-5 · LOW · confidence 0.65: audio flows before the relay's `ready`, so a slow upstream handshake bursts through the relay's rate budget and ends the call with a protocol terminal

`lib/liveSocket.ts:88` documents "the machine feeds only between `ready` and teardown". In fact
`sendAudio` (`:180`) gates only on `readyState === OPEN`, and the pacer starts pumping at `openLeg`.

The relay does not read the client between `start` and `_pump`: it runs `_dial_upstream` and then
`_configure_upstream` (`voice_live.py:317-321`). Frames sent in that window are delivered to
`_note_frame` in one burst when `_pump` starts. Once that gap exceeds about 2 s, the burst plus the
next 2 s of realtime audio passes the 4000 ms/2 s budget (`:640`). The result is
`error{protocol}`, which the client treats as a terminal ("the connection had a problem"), not a
reconnect.

Normally the gap is milliseconds: session.created is published at once, per `realtime_ws.py:112`.
It needs a slow connect or a busy Speaches loop, bounded by `connect_timeout_s` + `timeout_s`. The
real defect is a false invariant written down at the socket seam.

**Leanest fix:** latch `ready` inside `openLiveSocket` and drop `sendAudio` until it lands, as the
comment already claims.

**REPORTED (read; timing UNVERIFIED).**

### LC-6 · LOW · confidence 0.7: the background idle clock can end a call while its reply is still playing

`IDLE_EDGES` re-arms the clock on `playbackStarted` and `playbackDrained` only (`useLiveCall.ts:1777`).
A seamless chunked reply publishes no status edge between chunks. Neither the timer (`:1895`) nor
the `idleExpired` arm (`:1165-1169`) looks at `mouthLive`:
```ts
case "idleExpired":
  return terminal(s, "ended", CALL_COPY.idleBackground);
```
At the default 600 s this cannot happen, because a single reply is capped well below that. But
`background_idle_s` is bounded `ge=0`, so an owner who sets it to, say, 120 s will have a pocketed
three-minute answer cut off. That contradicts the knob's own contract ("no speech and no reply for
the window").

**Leanest fix:** in `idleExpired`, re-arm instead of ending while `mouthLive`, or check `mouthLive`
in `armIdle`'s callback.

**REPORTED (read).**

### LC-7 · LOW · confidence 0.95: the "enabled ships OFF" statement survived the default flip in the security model, the example config and the Conf seed

`0c8ee16` updated LIVE_VOICE_PLAN, TODO, ROADMAP, CLAUDE.md and HTTPS_TAILSCALE, but not these:

**Security model (`docs/SECURITY_MODEL.md`):**
- `:533`: "`voice.live.enabled` and `voice.live.dictation` both default **OFF** (no socket route
  reachable at all until one is flipped)"
- the §3 register row at `:577`: "both feature toggles defaulting OFF"
- the §6 pre-deploy checklist at `:657-658`, which the release hook tells the operator to run for
  exactly this deploy

**Other docs:**
- `docs/SPEC.md:36` and `:501`: "ships OFF"
- `AGENTS.md:37`

**Example config and code:**
- `config.example.yaml:423-425`: `enabled: false` with the comment "Shipped OFF"
- `frontend/src/tabs/ConfTab.tsx:844`: `LIVE_FALLBACK.enabled: false`, under a comment saying the
  values "mirror `LiveCfg`'s own field defaults"
- `useMicGesture.ts:30`: "THE CALL HALF SHIPS DARK"

The ConfTab seed only bites on a settings document missing `voice.live`, and the live backend always
dumps it (`api/settings.py:53`), so there is no runtime effect today. The security-model lines,
though, are what the v1.7.8 operator will read: they state the WS is unreachable by default on the
exact release that makes it reachable on prod for the first time.

**Fix:** a doc and default sweep.

**VERIFIED (read; `git show --stat 0c8ee16`).**

### LC-8 · LOW · confidence 0.65: the relay never reaps a leg whose client stopped sending audio, so a frozen or deaf phone can hold the single slot for up to `max_session_s`

The client sends frames continuously (held and muted frames go up as silence), so a leg with no
uplink frames for tens of seconds means the page is frozen or its ear is dead. Examples are the
R75 freeze if the keepalive does not hold, or the ISS-19 lock-screen deafness.

Chrome answers WebSocket pings in the network stack, so uvicorn's 5 s/5 s ping never reaps such a
leg. The client's `background_idle_s` timer cannot fire inside a frozen renderer. The leg therefore
holds `max_sessions: 1` until the 30-minute `max_session_s`. Meanwhile a call from any other device
is refused "another call is active". This is not in the brief's known list: ISS-19 covers the
phone's own call dying, not the slot it strands.

**Leanest fix:** a relay-side "no binary frame for N × `frame_ms`" deadline in `_pump_client`,
closing as `session_limit`-class.

**REPORTED (read; Chrome ping handling from platform knowledge, UNVERIFIED on device).**

---

## Sections checked and found sound (one line each)

- **Q1 first run on prod.** Prod's `config.yaml` is at version 2 with no `voice.live`.
  Migration step 3 is unrelated to live voice, and step 4's `live_voice_applies` returns False on an
  absent block (test-pinned, `test_a_v3_config_without_voice_live_only_gets_the_stamp`). The `live`
  and `live_ear` bits read live settings and are up on prod: the stt chain doubles as the live chain,
  with hop 1 = emma-speaches/parakeet, the same chain dev ran. `GET /settings` dumps every default,
  so Conf shows `enabled: true`. install.sh re-renders the prod unit with `--ws-ping-interval 5
  --ws-ping-timeout 5`; the currently installed v1.7.7 unit lacks them.
- **Q2 admission.** The Origin check passes through Serve with `allowed_origins` empty (Serve keeps
  `Host`). Slot acquire and release are one `finally`. The pump teardown is cancel plus shielded
  gather. `leg_end` is latched from both `_close` and `finally`. The leg fence (`legSeq`) and the
  generation fence are both honoured on every socket callback.
- **Q3 exits.** Every terminal and exit funnels through `teardown()`: timers, the marker, socket,
  pacer, capture (which stops the keepalive), `dismiss`, `setCallVoice(false)`, the tap and
  chunk-start hooks, and the wake lock. A late capture after a hang-up stops itself
  (`alive() || isTerminal`). A late wake lock releases itself through the generation check. Double
  hang-up and Escape are idempotent through `endCall`.
- **Q4 mouth plumbing.** The retag hold is cancelled by `reset`'s `reqSeq` bump and
  `setCallVoice(false)`. The pre-play tap, chunk-start and probe ordering hold (`play` fires before
  `playing`, and same-status republishes return early before `setHeld`). No second mouth or second
  ear is reachable while the overlay covers the composer.
- **Q5 gate math.** `rmsToDbfs` floors at −120. The seeds are finiteness-checked. The clamp is
  load-validated `min < max`. `learnVoice` refuses unsettled or quiet evidence. No new permanent
  "too quiet" was found beyond the known deadlock.
- **Q7 trail.** `call_id` is checked by `fullmatch` on a canonical UUID at all three sites. The body
  is counted as it streams, entries are capped, files are 0600 in a 0700 directory, and the route
  returns 404 when off. Pruning never deletes the file it just created. The owner's words appear
  once, in the relay's `down` line: client lines carry `textLen`, and notes are relay error strings.
- **Q9 rollback.** Restoring the config backup plus v1.7.7 is clean. `calls/` exists only when
  debug is on and old builds ignore it. The browser-side keys (`ctrlb.voiceLevels`, the
  sessionStorage marker) are inert to v1.7.7.

## Top 5 missing tests (given / when / then)

1. **(LC-1)** *Given* a call in `thinking` with a noise speech-start whose epoch accrual is below
   `min_final_ms`, *when* the reply's first chunk fires `playbackStarted`, *then* there is no `kill`
   and no `cancelTurn`. The reply plays, and the noise final is dropped as usual.
2. **(LC-2)** *Given* `speechStart → speechStop`, *when* `serverError{code:"upstream_error"}` lands,
   *then* `waitingFinal` is false and a following `playbackStarted` does not emit `kill`.
3. **(LC-3)** *Given* `setCallVoice(true)` and `/api/voice/tts` answering 502 for every chunk,
   *when* a read-along reply is fed and flushed, *then* the call machine receives `playbackFailed`
   and shows the `voiceFailed` note. Today it receives `loading → paused` and drains quietly. This
   has to be a controller-plus-wiring seam test, because each side's unit tests pass on its own.
4. **(LC-4)** *Given* a settled call (`listening`, `attempts 0`, no prior leg), *when*
   `routeChange` is followed by `serverError{busy}` on the recapture's dial, *then* the phase is not
   terminal: the note is `busyRetrying` and the 1013 close drives the ladder.
5. **(LC-5/LC-8, relay)** *Given* a fake upstream that delays `session.created` by 2.5 s while the
   test client streams realtime 40 ms frames from `accept`, *when* `_pump` starts, *then* the
   session is not closed 1008. And *given* a leg that stops sending binary frames, *then* the relay
   ends it within the inactivity bound rather than at `max_session_s`.

## What I could not determine

- **Whether the keepalive actually defeats the freeze on the Honor 20.** `KEEPALIVE_GAIN = 1e-4`
  (about −80 dBFS DC) satisfies Blink's renderer-side `energy > 0`, which R75 verified. I could not
  confirm that the page scheduler's "audio playing" bit comes from that test rather than from the
  browser's power-monitored audibility, which uses a threshold of about −72 dBFS. If it is the
  latter, the keepalive is below the line and the freeze still lands about 90 s into a pocketed
  silence. The owed freeze probe decides it. A cheap hedge: raise the gain to 1e-3 (−60 dBFS). It is
  still inaudible, since DC is not reproduced, and it clears either threshold.
- **The leak probe on prod's current TTS.** Prod still speaks through Speaches Kokoro with `opus`
  chunks, and `trim_silence` only touches WAV. The S3 round №2 pass was on PocketTTS WAV. If the
  prod TTS flip does not happen with v1.7.8, the probe's 600 ms head-of-chunk premise is untested on
  Kokoro's leading silence.
- **How often LC-1, LC-2 and LC-4 actually occur.** This needs field data. The D77 trail with
  `debug` on shows it directly: look for a `sig kill` right after an unaccepted `speechStart`, an
  `up_error` with no following `transcript`, or `busy` right after `routeChange`.
- **Whether a Wi-Fi↔LTE handover on the phone leaves Serve's upstream half-open longer than the
  10 s ping bound.** Not testable here.

## Verdict for v1.7.8: **SHIP WITH FIXES**, gated on **LC-2, LC-3, LC-4 and LC-7**, with an owner ruling on LC-1

LC-2, LC-3 and LC-4 are each a one- or two-line fix in the reducer or controller, backed by a
reducer test. Each one turns an ordinary environmental hiccup (a transcription 4xx, a TTS outage
right after the prod TTS flip, a route flip on a bad link) into a lost reply or a dead call with no
explanation on the screen. LC-7 is a doc sweep, but the release checklist reads it for this exact
deploy.

LC-1 is the real design gap: noise can kill and cancel a reply even with `barge_in` off. It wants
the owner's decision (evidence-gate the iron rule, or respect `barge_in`) before or right after the
release. LC-5, LC-6 and LC-8 can ride later. Nothing found blocks the config migrations, the
rollback path, or the security rails.
