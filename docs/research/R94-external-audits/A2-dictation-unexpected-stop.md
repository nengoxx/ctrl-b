# CTRL-B Continuous Dictation Unexpected-Stop Audit

**Date:** 2026-09-28  
**Repository:** `nengoxx/ctrl-b`  
**Audited revision:** `main` @ `778b9608915af82fe8002132cfe17386c9a8cea1`  
**Scope:** phrase-streaming / continuous dictation unexpectedly stopping while `voice.stt.auto_stop` and `voice.stt.auto_send` are disabled  
**Intended reader:** coding agent working on ctrl-b voice/dictation reliability  
**Audit mode:** read-only; no repository files were modified

---

## 1. Reported symptom

During continuous microphone dictation, the recording unexpectedly stopped several times in production, including multiple stops close together.

Observed context:

- the user believed Auto-stop was disabled;
- Auto-send was also disabled;
- mobile connection showed adequate 4G reception;
- therefore the recording was expected to remain active until manually stopped.

The central audit question is:

> **What code paths can terminate continuous/streaming dictation even when the visible Auto-stop feature is disabled?**

---

## 2. Executive conclusion

The current implementation has **multiple independent stop mechanisms**. Only one of them is the old `voice.stt.auto_stop` feature.

Therefore:

> **`Auto-stop mic = OFF` does not currently mean “continuous dictation can only stop manually.”**

The two most important findings are:

1. **Locked/hands-free streaming dictation has its own 15-second idle stop**, independent of `auto_stop.enabled`.
2. **A realtime WebSocket failure after at least one phrase has already been appended deliberately stops the entire recording.**

There is also:

- a 120-second hard session limit;
- unconditional stop when the page becomes hidden during streaming dictation;
- a 1-second client backlog ceiling that can close the live leg;
- a 15-second server-side “no PCM frames” reaper;
- MediaRecorder / MediaStream failure paths;
- component unmount / call-mic handover stop paths.

So the reported production behavior is fully plausible from current code even with Auto-stop disabled.

---

# 3. Relevant current architecture

Current streaming dictation combines two paths over the same microphone stream:

```text
MediaRecorder
    │
    ├─ complete local recording / fallback clip
    │
    └─ same stream -> AudioWorklet
                      │
                      ▼
                 live WebSocket
                      │
                      ▼
                 Speaches realtime
                      │
                      ▼
                 phrase finals
                      │
                      ▼
                 composer draft
```

Important current rule:

```text
0 live phrases appended
    -> whole recorded clip can still be uploaded as fallback

>=1 live phrase appended
    -> whole clip cannot be uploaded later without duplicating text
```

That rule strongly influences what happens when the streaming leg dies.

---

# 4. Stop-path inventory

The following are distinct stop mechanisms in current `useDictation.ts` and the live relay.

| Stop mechanism | Current default | Requires Auto-stop ON? | Can end continuous dictation? |
|---|---:|---:|---:|
| Tier-0 Auto-stop | 3 s silence | Yes | Yes |
| Streaming hands-free idle stop | **15 s** | **No** | **Yes** |
| Streaming hard duration cap | **120 s** | **No** | **Yes** |
| Page becomes hidden | Immediate | **No** when streaming | **Yes** |
| Live WebSocket dies after >=1 phrase | Any time | No | **Yes** |
| Live uplink backlog exceeds ceiling | **1000 ms** | No | indirectly yes |
| Browser WS `bufferedAmount` ceiling | **1000 ms equivalent** | No | indirectly yes |
| Relay receives no PCM frames | **15 s** | No | indirectly yes |
| MediaRecorder error | n/a | No | Yes |
| MediaStream/device failure | n/a | No | potentially yes |
| Component unmount | n/a | No | Yes |
| Call takes microphone (`yieldMic`) | n/a | No | Yes |

This table is the main practical finding of the audit.

---

# 5. Finding A — a second silence auto-stop exists

## 5.1 Current code shape

In `frontend/src/hooks/useDictation.ts`, the streaming dictation timers run **before** the ordinary Auto-stop policy gate.

Conceptually:

```ts
if (live && !live.finishing) {
    live.elapsedMs += 100;

    if (live.elapsedMs >= maxMs) {
        stop();
        return;
    }

    if (
        handsFreeRef.current &&
        silenceFloor > 0 &&
        rms < silenceFloor
    ) {
        live.idleMs += 100;

        if (live.idleMs >= idleMs) {
            stop();
            return;
        }
    } else {
        live.idleMs = 0;
    }
}

if (!autoStopOn) return;
```

Therefore the streaming idle stop is evaluated **before**:

```ts
if (!autoStopOn) return;
```

and is not disabled by `auto_stop.enabled = false`.

## 5.2 Default

Current backend default:

```text
dictation_idle_s = 15
```

The current UI labels it:

```text
Dictation idle stop
seconds of silence that end a hands-free dictation
```

This setting belongs to:

```text
voice.live.dictation_idle_s
```

not:

```text
voice.stt.auto_stop
```

## 5.3 It reuses the Auto-stop threshold

The separate idle timer uses:

```ts
const silenceFloor = autoStop?.threshold ?? 0;
```

even if:

```text
autoStop.enabled == false
```

The backend still publishes the threshold inside the `stt_auto_stop` object when the toggle is disabled, e.g.:

```json
{
  "enabled": false,
  "silence_s": 3,
  "threshold": 0.01
}
```

So the current semantics are:

```text
auto_stop.enabled = false
    disables Tier-0 Auto-stop

BUT

auto_stop.threshold = 0.01
    still powers the separate streaming idle-stop detector
```

This is internally intentional but externally surprising.

## 5.4 Unit tests confirm it

The streaming dictation tests explicitly construct Auto-stop as disabled while still verifying hands-free idle termination.

So this is not a race or accidental side effect; it is a test-pinned policy.

## 5.5 Why it is a strong candidate for the field symptom

A quiet electric car is a plausible environment for post-browser-processing RMS to remain below `0.01` for 15 continuous seconds.

If a failure occurred roughly 15 seconds after the user stopped speaking, this is the strongest explanation.

---

# 6. Finding B — the 120-second hard cap is always active

Current default:

```text
dictation_max_s = 120
```

The code increments the streaming session clock every 100 ms and stops whenever the hard cap is reached.

This applies to both:

```text
hands-free locked dictation
and
finger-held dictation
```

It is not a silence rule and can stop while the user is actively speaking.

The test suite explicitly verifies this behavior.

Therefore:

> Any stop occurring at almost exactly 120 seconds is expected current behavior.

For a feature understood as “continuous dictation”, this product default is arguably too aggressive unless intentionally surfaced as a safety limit.

---

# 7. Finding C — live socket death after the first phrase stops the recorder

This is the most important connection-related result.

## 7.1 Socket failure before any live phrase

If the streaming socket dies and:

```text
s.finals == 0
```

current code:

```text
drops the live leg
keeps MediaRecorder running
falls back to the complete local clip
```

This is robust.

## 7.2 Socket failure after one or more live phrases

If:

```text
s.finals > 0
```

current code deliberately does the equivalent of:

```ts
s.dead = true;
s.uplink?.stop();
s.uplink = null;
setPending(false);
pushToast("Voice connection lost — the rest of that wasn't captured", "err");
stop();
```

Therefore:

> **Once one streaming phrase has already been appended to the composer, loss of the live WebSocket terminates the entire recording.**

There is no mid-session reconnect.

## 7.3 Why the code does this

The local MediaRecorder clip still contains audio from the beginning.

If some earlier phrases have already been appended live and the app later uploads the whole clip, the earlier content would be transcribed again.

The current design chooses:

```text
avoid duplication
by
ending the recording
```

rather than retaining enough audio provenance to recover only the uncommitted suffix.

The choice is coherent but brittle.

---

# 8. Good 4G does not rule out the network failure class

A phone's signal indicator does not measure realtime WebSocket health from browser to ctrl-b through the entire route.

A healthy-looking mobile connection can still experience:

- TCP/WSS stalls;
- Tailscale path changes;
- packet loss/retransmission;
- browser main-thread stalls;
- brief server stalls;
- upstream Speaches failure;
- send-buffer growth.

So:

```text
good 4G bars
!=
guaranteed healthy low-latency WSS uplink
```

This is especially important because the app deliberately kills an excessively backed-up socket.

---

# 9. Finding D — the client can kill its own live leg because of backlog

There are two related client-side protections.

## 9.1 Dictation pacer backlog

Current default:

```text
buffered_ceiling_ms = 1000
```

Streaming dictation queues audio losslessly.

If that queue grows past about one second of audio, the live leg is considered unusably stale and is abandoned/closed.

Before `ready` this represents a handshake that is taking too long.

After `ready` it represents stale live audio that cannot keep up.

## 9.2 Browser WebSocket `bufferedAmount`

`frontend/src/lib/liveSocket.ts` additionally checks:

```ts
if (ws.bufferedAmount + buf.byteLength > ceiling) {
    ws.close(4000, "uplink backpressure");
    return;
}
```

At 48 kHz mono PCM16:

```text
48,000 samples/s × 2 bytes
≈ 96 KB/s
```

so a 1000 ms ceiling is roughly one second / ~96 KB of queued raw PCM.

## 9.3 How a backlog close becomes a mic stop

If it occurs before a phrase has landed:

```text
streaming degrades
MediaRecorder continues
```

If it occurs after at least one phrase has landed:

```text
socket closes
onClose sees finals > 0
stop() is called
MediaRecorder ends
```

This is a plausible explanation for irregular stops while actively speaking.

---

# 10. Finding E — server-side no-audio reaper

Current live relay setting:

```text
uplink_idle_s = 15
```

The relay expects binary PCM frames continuously.

Importantly:

```text
acoustic silence is still PCM
```

and therefore resets this timer.

So this is not a voice-silence detector.

It means:

```text
no binary microphone frames at all for 15 seconds
```

which can indicate:

- frozen renderer;
- dead/suspended AudioContext;
- dead worklet;
- stalled/broken client path.

The relay then produces a `session_limit`-class terminal and closes the socket.

For dictation, that socket close can then stop the MediaRecorder if one or more phrases have already landed.

---

# 11. Finding F — page visibility can stop streaming dictation

Streaming dictation installs a `visibilitychange` listener whenever streaming is active.

Current behavior:

```ts
if (document.visibilityState === "hidden") stop();
```

This is independent of `voice.stt.auto_stop`.

On mobile this can correspond to:

- switching apps;
- minimizing the browser;
- locking the screen;
- otherwise backgrounding the page.

Call mode has separate background-survival machinery. Streaming dictation deliberately uses a stricter policy.

If the production stops correlated with screen/app changes, this path is a strong candidate.

---

# 12. Finding G — MediaRecorder / MediaStream failures

The hook has an explicit `MediaRecorder.onerror` path that:

- marks the recording discarded;
- drops the live leg;
- stops tracks;
- releases the mic;
- returns to idle;
- shows `Recording failed`.

The underlying MediaStream or microphone route can also fail or end for platform/device reasons.

Current diagnostics do not richly classify all such media-source termination cases.

This should be investigated after the explicit idle/network causes unless audio route/device changes coincided with the stop.

---

# 13. Finding H — unmount and microphone handover

The recorder is intentionally stopped when:

```text
the dictation hook/composer unmounts
```

or when:

```text
a live call takes ownership of the microphone
```

`yieldMic()` invokes the ordinary stop path before another capture opens.

These are valid lifecycle stops, but they should still be represented by explicit diagnostic reasons.

---

# 14. Observability defect

The current implementation discards exactly the information needed to tell these causes apart after the fact.

## 14.1 WebSocket close code and reason are discarded

`openLiveSocket` provides:

```ts
onClose(code, reason)
```

but `useDictation` currently registers a callback shaped like:

```ts
onClose: () => {
```

so the dictation layer loses distinctions such as:

```text
4000 client uplink backpressure
1011 upstream loss
1008 protocol failure
1000 clean/session-limit close
abnormal/network close
```

## 14.2 Typed relay errors are ignored

The relay already sends typed errors such as:

```text
upstream_refused
upstream_lost
session_limit
protocol
```

but the dictation frame switch currently does effectively:

```ts
case "error":
    break;
```

and waits for the later generic close.

This collapses distinct failures into one generic “socket closed” event.

## 14.3 Local stop reasons are also collapsed

These all ultimately call generic `stop()` / `stopNow()`:

```text
idle timer
hard cap
page hidden
call handover
unmount
socket loss
```

There is no authoritative `StopReason` propagated through the recorder lifecycle.

This should be fixed before another serious field round.

---

# 15. Conditional likelihood ranking for today's failures

Without exact trail/timing, the cause cannot be proven, but the code allows useful conditional ranking.

## If it stopped ~15 s after silence

Most likely:

```text
dictation_idle_s
```

despite:

```text
auto_stop.enabled == false
```

## If it stopped ~120 s after recording began

Very likely:

```text
dictation_max_s
```

## If it stopped unpredictably while actively speaking, after one or more phrases had already appeared

High suspicion:

```text
WebSocket / backpressure / upstream loss
```

because a socket death after `s.finals > 0` intentionally stops the recorder.

## If several failures happened close together after restarting

This raises suspicion of:

```text
network/backpressure/upstream instability
```

because the same transient condition can kill each newly started live session.

A 15-second idle timer cannot create truly immediate repeated stops unless each restarted session again remains quiet for the full idle window.

## If it happened around app switching or screen lock

Likely:

```text
visibilitychange -> stop()
```

## If none fit

Next inspect:

```text
MediaRecorder
MediaStream track
browser lifecycle
audio route/device state
```

---

# 16. Architectural problem behind the network stop

The current design gives the live transcription lane too much authority over recording lifetime.

Today:

```text
MediaRecorder
   +
live phrase stream

live phrase stream fails after phrase 1
   ↓
whole recorder stops
```

For a resilient transcription system, this ownership should be reversed.

The local/canonical audio session should be authoritative.

Live ASR should be a consumer that can degrade independently.

---

# 17. Preferred future architecture

```text
canonical Control-B audio session
            │
            ├── live VAD/ASR lane
            │       └ may fail/reconnect/degrade
            │
            └── canonical PCM/segment buffer
                        │
                        ▼
                  authoritative final ASR
```

If the live lane fails:

```text
recording continues
live captions/phrase updates degrade
canonical audio remains intact
final transcription remains possible
```

A short network problem should become:

```text
live transcription temporarily degraded
```

not:

```text
microphone stopped
```

This is fully aligned with the larger VAD/ASR-agnostic architecture audit.

---

# 18. Why the current code cannot simply upload the whole clip after a late live failure

Suppose live transcription already appended:

```text
phrase A
phrase B
```

The MediaRecorder clip still contains:

```text
A + B + later audio
```

Uploading the complete clip would duplicate A and B.

Current implementation avoids duplication by ending recording.

A robust future implementation should instead preserve **audio provenance**.

---

# 19. Recovery design options

## 19.1 Canonical audio cursor

Track the exact sample boundary covered by accepted live finals.

Example:

```text
canonical PCM:
0 -------------------------------------- 900000

committed live coverage:
0 ---------------------- 620000
```

If live ASR dies:

```text
continue recording
at finalization transcribe suffix 620000..end
```

This is much stronger than trying to deduplicate text heuristically.

## 19.2 Authoritative full-turn final

Alternative:

```text
live text = provisional UI
recording end = transcribe complete canonical audio
final result replaces/reconciles provisional text
```

This is especially attractive if the final ASR is fast.

It matches the broader design:

```text
live ASR = responsiveness
final ASR = authority
```

## 19.3 Reopen live ASR after a failure

Once Control B owns turn/audio state:

```text
live provider fails
-> recording remains alive
-> mark live lane degraded
-> final-ASR current turn
-> reopen streaming lane for the next turn/segment
```

No microphone restart is required.

---

# 20. Immediate engineering fixes

These should be implemented independently of the larger ASR/VAD redesign.

## P0 — typed stop reasons

Create an explicit type such as:

```text
user
idle
max_duration
page_hidden
socket_lost
client_backpressure
upstream_lost
uplink_idle
media_error
media_stream_ended
call_handover
unmount
cancel
```

Every automatic/manual terminal should carry a reason.

## P0 — preserve socket close information

Change dictation's close handler to retain:

```text
close code
close reason
```

Also trail:

```text
ready state
phrases/finals count
backlog depth
last relay error
```

## P0 — preserve the last typed relay error

Instead of discarding `error` frames, save:

```text
code
message
```

and associate them with the subsequent close.

---

# 21. Product-policy review: streaming idle-stop

Current semantics are surprising:

```text
Auto-stop disabled
BUT
its threshold powers another automatic stop
```

Possible improvements:

## Option A — allow `dictation_idle_s = 0`

Interpret:

```text
0 = disabled
```

Current schema forbids values below 3.

## Option B — separate explicit fields

```text
dictation_idle_enabled
dictation_idle_s
dictation_idle_threshold
```

Most explicit design.

## Option C — tie it to `auto_stop.enabled`

If Auto-stop is disabled, disable streaming idle termination too.

Simpler, but changes the original safety intent.

The correct choice is a product decision; current hidden coupling should not remain accidental.

---

# 22. Product-policy review: hard session cap

Current:

```text
dictation_max_s = 120
minimum allowed = 10
no off state
```

If “continuous dictation” is meant to mean “until I stop it”, consider separating:

```text
user-facing duration cap
```

from:

```text
technical safety/resource cap
```

Example:

```text
user cap: 0 = off
technical emergency bound: 30–60 minutes
```

Do not conflate UX policy with process safety.

---

# 23. Recommended streaming-lane failure policy

Current:

```text
socket dies after >=1 phrase
-> stop recording
```

Recommended:

```text
socket dies
-> live lane degraded
-> recording continues
-> canonical audio retained
-> final ASR at user stop / endpoint
```

This is the highest-value structural reliability change found in this audit.

---

# 24. Background policy

Streaming dictation currently treats a hidden page as a reason to stop.

This should be an explicit product mode rather than implicit behavior.

Possible policies:

```text
foreground_only
background_allowed_with_keepalive
background_best_effort
```

If the product expectation is that continuous dictation survives screen lock or app switching, the current implementation intentionally does not meet that expectation.

---

# 25. Recommended end-of-recording telemetry

One structured line should be enough to explain every future stop.

Example network failure:

```json
{
  "event": "dictation_end",
  "reason": "socket_lost",
  "duration_ms": 48321,
  "hands_free": true,
  "phrases_appended": 4,
  "last_relay_error": "upstream_lost",
  "ws_close_code": 1011,
  "ws_close_reason": "upstream lost",
  "page_visibility": "visible"
}
```

Example idle stop:

```json
{
  "event": "dictation_end",
  "reason": "idle",
  "duration_ms": 37890,
  "idle_ms": 15000,
  "silence_floor": 0.01,
  "auto_stop_enabled": false,
  "hands_free": true
}
```

Example hard cap:

```json
{
  "event": "dictation_end",
  "reason": "max_duration",
  "duration_ms": 120000
}
```

---

# 26. Recommended regression tests

## STOP-1

```text
auto_stop=false
hands-free streaming
quiet for dictation_idle_s
-> behavior is explicit and reason is idle
```

If policy changes, change this test deliberately.

## STOP-2

```text
auto_stop=false
finger-held streaming
quiet > dictation_idle_s
-> no idle stop
```

## STOP-3

```text
active speech
dictation_max_s reached
-> reason=max_duration
```

## STOP-4

```text
socket closes before first final
-> local recording continues
```

## STOP-5

Current:

```text
socket closes after first final
-> recording stops
```

Desired future:

```text
socket closes after first final
-> recording continues degraded
```

This should become a migration acceptance test.

## STOP-6

```text
client close 4000 uplink backpressure
-> reason=client_backpressure
```

## STOP-7

```text
relay error upstream_lost + close 1011
-> preserve upstream_lost
```

## STOP-8

```text
server uplink-idle session_limit
-> distinguish reason=uplink_idle from max_session
```

## STOP-9

```text
visibility hidden
-> explicit page_hidden reason
```

## STOP-10

```text
MediaRecorder error
-> explicit media_error reason
```

---

# 27. Suggested field diagnosis after instrumentation

Enable debug trail and record:

```text
recording start time
recording end time
whether user was speaking
whether page stayed visible
whether a phrase had already appeared
any toast/message
```

With typed termination telemetry, the next incident should immediately classify as one of:

```text
idle
max_duration
page_hidden
client_backpressure
upstream_lost
uplink_idle
media_error
user
```

Before that instrumentation exists, timing alone remains useful:

```text
~15 s after silence  -> idle stop
~120 s after start   -> hard cap
random during speech -> socket/backpressure/upstream more likely
after backgrounding  -> visibility stop
```

---

# 28. Relationship to the larger voice architecture audit

This audit strengthens one invariant from the separate VAD/ASR architecture dossier:

> **No replaceable live VAD/ASR transport should own the lifetime of the microphone recording.**

The desired architecture is:

```text
canonical audio session
  ├─ VAD consumer
  ├─ live ASR consumer
  └─ final ASR consumer
```

Provider failure should degrade a capability, not destroy user audio.

This principle should be treated as a hard requirement of the upcoming voice redesign.

---

# 29. Priority recommendation

## Immediate

1. add typed stop reasons;
2. preserve WebSocket close code/reason;
3. preserve last relay error;
4. add one `dictation_end` trail event;
5. capture one real production reproduction.

## Short-term policy

Decide whether:

```text
dictation_idle_s
dictation_max_s
```

should be mandatory in a mode called continuous dictation.

If the intended semantics are “until I stop it”, both need an explicit disable state or a redesign.

## Medium-term reliability

Decouple recording lifetime from streaming-transcription lifetime.

A live-lane failure should never call `stop()` merely because live phrases already exist.

## Long-term

Integrate dictation with the backend/VAD-agnostic voice architecture so Control B owns canonical PCM and provider failures become recoverable.

---

# 30. Source index

Primary audited paths:

```text
frontend/src/hooks/useDictation.ts
frontend/src/lib/liveSocket.ts
frontend/src/lib/uplinkPacer.ts
frontend/src/lib/pcmCapture.ts
frontend/src/hooks/useVoiceStatus.ts
frontend/src/tabs/ConfTab.tsx

backend/app/config.py
backend/app/api/voice.py
backend/app/services/voice_live.py

frontend/tests/hooks/dictationStreaming.test.ts
frontend/tests/hooks/useDictation.test.ts
backend/tests/test_voice_live_s1.py
```

Relevant design/research paths:

```text
docs/research/R70-phrase-streaming-dictation.md
docs/research/R71-uplink-stall-pacing.md
docs/research/R75-background-call-survival.md
docs/research/R86-live-call-e2e-audit.md
docs/LIVE_VOICE_PLAN.md
docs/HANDOFF.md
docs/SECURITY_MODEL.md
```

Audited ctrl-b revision:

```text
778b9608915af82fe8002132cfe17386c9a8cea1
```

---

# 31. Final verdict

The production stops are not mysterious from the current implementation.

The most important expectation mismatch is:

```text
Auto-stop OFF
```

does **not** mean:

```text
all automatic stops OFF
```

Streaming dictation currently has at least two separate automatic timers:

```text
15-second hands-free idle stop
120-second hard cap
```

plus transport and lifecycle stop paths.

The second major reliability weakness is:

```text
live WebSocket dies after >=1 phrase
-> recorder stops
```

which lets a transient network/upstream problem terminate the user's otherwise healthy microphone session.

The architectural rule going forward should be:

> **The microphone/canonical audio session is authoritative. Live transcription is a degradable consumer, never the owner of recording lifetime.**

---

## Audit status

**Current source:** audited.  
**Automatic stop paths:** enumerated and verified.  
**Network-related stop behavior:** verified.  
**Idle/hard-cap behavior with Auto-stop disabled:** verified and test-pinned.  
**Exact cause of today's individual incidents:** cannot be proven without their trail/timing; ranked above.  
**Repository changes made by this audit:** none.
