# R88 — Live voice call: independent second end-to-end audit before v1.7.8

**Date:** 2026-09-26  
**Auditor:** Emma (gpt-5.6-sol)  
**Tip:** `8ab141ee4ebc03a3a2d331c05b149c855b5e559f`  
**Scope:** the committed HEAD of the Phase 24 live-call subsystem: first-run config/migrations, status and WebSocket admission, relay lifecycle, client state machine, capture/gate/audio paths, call trail, turn submission/cancellation, background behavior, rollback implications, tests, and the named documentation/config contracts. Read-only apart from this dossier.  
**Read after R86:** yes — `docs/research/R86-live-call-e2e-audit.md` was read first. LC-1…LC-8 were treated as fixed/known and are not re-reported. This audit checks the R86 fixes and looks for new failures around them.

Severity in this dossier follows the brief: **HIGH** = a concrete failure not depending on input/environment assumptions; **MED** = a real failure conditional on a named scenario; **LOW** = defence-in-depth or maintainability. Existing focused suites passed: backend **217/217** and frontend **426/426**.

---

## Findings

### E-1 · MED · confidence 0.95: the LC-1 fix treats a still-open, newly-started real utterance as proven noise, then the default mic hold can discard the rest of the owner's sentence

`frontend/src/hooks/useLiveCall.ts:917-919`, with the partial evidence accumulated at `:1310-1312`:

> `if ((s.userSpeechActive || s.waitingFinal) && !tooQuiet(sig)) {`  
> `if (db >= floor) {`  
> `  m.accruedMs += frameMs;`

`tooQuiet` means only “the above-floor duration accumulated **so far** is below `min_final_ms`”; while `userSpeechActive` is still true, that is not a completed gate verdict. **Scenario:** on the default `route: media`, `mic_hold: auto`, the owner begins speaking shortly before the first reply chunk starts. If only 40–160 ms has accrued against the 200 ms default, `tooQuiet` is true and the iron-rule kill is skipped. Playback starts; the pre-play/derived hold closes the ear for the chunk, so the rest of the owner's live sentence is uplinked as silence and its short/truncated final is dropped or errors. The tests prove only the endpoints (0 ms noise is spared; 400 ms speech kills), not this ordinary partial-speech race. **Leanest safe fix:** do not apply the quiet exemption to an open `userSpeechActive` epoch; exempt only completed `waitingFinal` evidence, retaining the conservative kill while speech is live. If active noise must also be spared, the mouth must be deferred until the epoch becomes classifiable rather than treating partial duration as a final verdict. **VERIFIED (source-inspected across reducer, meter, pre-play hold, and R86 tests; not device-timed).**

### E-2 · MED · confidence 0.98: the LC-6 idle fix protects the agent's mouth but still ends a background call while the owner is actively speaking or waiting for their final

`frontend/src/hooks/useLiveCall.ts:1213-1217`:

> `if (s.mouthLive) return { state: s, out: [] };`  
> `return terminal(s, "ended", CALL_COPY.idleBackground);`

**Scenario:** the owner configures a short valid `background_idle_s` (for example 5–30 s), backgrounds the PWA, and speaks continuously longer than that window, or the timer expires in the `speechStop → final` gap. `speechStart` re-arms the timer once, but expiry checks only `mouthLive`; it tears down the capture/socket while `userSpeechActive` or `waitingFinal` is true and loses that utterance. This contradicts the knob's “no speech and no reply” contract. The default 600 s makes this unlikely without a custom value, but the schema permits any integer from 0 upward and the mechanism is deterministic. **Leanest fix:** make the existing no-op/re-arm branch cover `s.mouthLive || s.userSpeechActive || s.waitingFinal`; `idleExpired` is already in `IDLE_EDGES`, so no new timer path is needed. **VERIFIED (source-inspected; existing reducer/wiring tests cover `mouthLive` only).**

No HIGH findings were found.

---

## Top 5 missing tests (given / when / then)

1. **E-1, active partial evidence:** *Given* `thinking + userSpeechActive` with 40 ms above-floor accrual and `min_final_ms=200`, *when* `playbackStarted` lands, *then* the still-open utterance is not classified as quiet and the mouth cannot engage a hold that truncates the owner's sentence.
2. **E-2, owner speaking:** *Given* a hidden call with a short idle window and `userSpeechActive=true`, *when* `idleExpired` lands, *then* the call remains live and the full window is re-armed.
3. **E-2, final in flight:** *Given* a hidden call in the `speechStop → transcript` gap (`waitingFinal=true`), *when* `idleExpired` lands, *then* the leg remains open until the final is consumed/discarded and the idle window restarts.
4. **Cross-contract parity:** *Given* `LiveCfg`, `GET /voice/status.live_call`, and `LiveCallWire`, *when* their server/client ownership sets are compared, *then* every delivered client field has a real browser reader and every server-only field is absent. This would expose the currently delivered-but-unused `max_session_s` and prevent docstring drift.
5. **Documentation/config parity:** *Given* the current `LiveCfg` schema/defaults, *when* the as-built §4.1 inventory and `config.example.yaml` live block are checked, *then* removed keys (`target`, `barge_threshold`, `echo_workaround`) are absent and current per-chunk/background semantics are present.

---

## Consistency

### Consistency-1 — `LIVE_VOICE_PLAN.md` §5.1 is still the pre-D76 config shape, contradicting both `LiveCfg` and the plan's own §4.1 as-built table

Plan (`docs/LIVE_VOICE_PLAN.md:410`, `:418-420`):

> `target: ""              # provider-registry reference for the realtime endpoint`  
> `barge_threshold: 0          # RMS floor for the barge-in energy gate`  
> `echo_workaround: auto   # auto | on | off`

Code (`backend/app/config.py:653-655`, `:760`):

> `A BLANK provider (and no fallbacks) resolves like voice.stt`  
> `mic_hold: Literal["auto", "on", "off"] = "auto"`

`barge_threshold` is deleted by migration step 4, `echo_workaround` was renamed to `mic_hold`, and the pointer is the inherited `provider`/`model`/`fallbacks` shape, not `target`. The surrounding §5.1 prose at `:436` also still names `echo_workaround`. This is documentation drift; the code and migration agree with §4.1/D76.

### Consistency-2 — `LIVE_VOICE_PLAN.md` §5.3 still promises foreground-only teardown although D73 and the code default to surviving backgrounding

Plan (`docs/LIVE_VOICE_PLAN.md:470-473`):

> `Page hidden / phone locked → the call ends cleanly`  
> `(R14 scope: foreground-only; no half-alive background sessions).`

Code (`frontend/src/hooks/useLiveCall.ts:2501-2506`):

> `if (!bg.current?.background) { send({ type: "hidden" }); return; }`  
> `if (bg.current.keepalive) capture.current?.setKeepalive(true);`  
> `armIdleRef.current();`

`LiveCfg.background` defaults true. The D73 block later says it amended §5.3, but the owning section was never rewritten. The current implementation is consistent with D73, not with §5.3.

### Consistency-3 — `config.example.yaml` describes the landed per-chunk leak probe as per-reply and still says it has not landed

Example (`config.example.yaml:447-448`):

> `mic_hold: auto         # ... auto = the per-reply`  
> `# leak probe (D76 S2; until it lands: held unless the track's AEC reads "all")`

Code (`frontend/src/hooks/useLiveCall.ts:930-933`):

> `A NEW chunk is audible: it starts held, whatever the last one's verdict was`  
> `chunk, not per reply).`

The probe is built and runs per chunk. The example's value/default is correct; its operational comment is stale.

### Consistency-4 — §4.1 calls its table the as-built knob list but omits the inherited live transport timeouts that the example and code expose

Table (`docs/LIVE_VOICE_PLAN.md:208`):

> ``frame_ms · max_frame_bytes · max_session_s · max_sessions · relay_queue_ms · start_timeout_s · allowed_origins``

Example (`config.example.yaml:476-477`):

> `connect_timeout_s: 3   # realtime handshake budget`  
> `timeout_s: 30          # read window once established`

`LiveCfg` inherits both from `VoiceServiceCfg` (`backend/app/config.py:648-652`). Either §4.1 should say it inventories only `LiveCfg`'s own fields and point to the inherited target/timeout block, or include `provider`/`model`/`fallbacks`, `connect_timeout_s`, `timeout_s`, and `extra_body`. Runtime code and the example agree.

### Consistency-5 — the D71 base paragraph retains the pre-close “ships OFF” wording, while its amendment and code correctly say ON

Decision base (`docs/DECISIONS.md:5186-5188`):

> ``voice.live` extends VoiceCfg with a whole-feature enabled (ships OFF until the S4 owner round closes)`

Code (`backend/app/config.py:679-684`):

> ``enabled` ships ON since v1.7.8 (S4 CLOSED 2026-09-26)`  
> `enabled: bool = True`

The conditional is historical rather than logically impossible—the S4 condition has now occurred—but it reads as current posture inside the locked decision. The R86 amendment at `DECISIONS.md:5201-5215` otherwise matches the implementation exactly.

### Consistency surfaces that agree

- `SECURITY_MODEL.md` §2.10, §3, and §6 now agree with code: call enabled ON, dictation OFF, same-host/explicit-Origin rail, configured-chain gate, one slot, uplink-idle reaper, media-only WS, bearer server-side.
- `config.example.yaml` and `LiveCfg` agree on `enabled: true`, `uplink_idle_s: 15`, its 5–120 bound, and the `tail_wait_ms` ordering requirement.
- The §7 R86 block correctly describes LC-2, LC-3, LC-4, LC-5, the mouth half of LC-6, LC-7, and LC-8 as implemented. Its LC-1 mechanics match code; E-1 is a newly exposed semantic edge in those mechanics.

---

## Sections checked and found sound

- **First production run / migration:** an absent `voice.live` block is untouched by steps 3/4, version-stamped, then validated through defaults; `live` becomes true only with master voice + realtime chain + TTS, and `live_ear` mirrors the route's chain + `(enabled || dictation)` gate.
- **WS admission/security:** Origin is checked pre-accept; absent/foreign origins learn no feature state; the accepted socket carries media/control only; the bearer remains backend-only; the post-accept busy response is typed.
- **Relay lifecycle:** slot acquire/release is one synchronous counter plus one route `finally`; task cancellation/gather and upstream close converge; the R86 uplink-idle clock starts only after ready and is reset by accepted frames/flush.
- **R86 LC-2:** `upstream_error` clears `waitingFinal` and remains nonterminal.
- **R86 LC-3:** an all-failed in-call chunk session ticks `mouthFailed()` before publishing `paused`; controller and wiring tests cover both sides.
- **R86 LC-4:** route/device recapture sets `priorLeg`, so an own-old-leg `busy` enters the existing bounded reconnect ladder.
- **R86 LC-5:** `openLiveSocket` latches `ready` before calling the frame handler and drops audio before that latch; the latch is per leg.
- **R86 LC-6 (agent mouth):** `idleExpired` does spare `mouthLive` and re-arms through the existing one idle timer; E-2 is the missing owner-ear half.
- **Audio teardown:** terminal/unmount teardown clears socket, pacer, capture, keepalive, timers, audio hooks, mouth, trail, marker, and wake lock; generation/leg fences cover late callbacks and route recapture.
- **Gate math:** ordinary finite PCM is converted once; silence floors at −120 dBFS; load-time clamp ordering, seeded voice-level validation, held/uplink partition, and guarded learning are coherent. No new permanent-floor failure was established.
- **Turn path:** call text bypasses sigil routing and typed draft/one-shot skills, follows sticky/thread agent routing, shares staged-attachment reservation, and uses the existing steer/turn/cancel paths. Interrupted persistence remains the explicitly documented v1 posture.
- **Call trail:** canonical UUID confinement, streaming body cap, entry/count caps, JSON-only CSRF rail, debug-off 404, one owner-text copy, append lock, retention exclusion of the current file, and best-effort failure isolation are coherent.
- **Background lifecycle:** visibility/pagehide split, wake-lock reacquisition, keepalive ownership, return-time ear-gap detection, and terminal cleanup are coherent apart from E-2.
- **Rollback:** with the documented config-backup restore, v1.7.7 does not consume v4 shape or browser-only state; `$CTRLB_HOME/calls/` is debug-only and ignored by the old build.
- **Open sweep:** none beyond E-1, E-2, and the consistency discrepancies above met the reporting bar.

---

## What I could not determine

- The Honor 20 lock-screen failure (ISS-19), car-on-clean-route arm, TV/other-room arm, and keepalive audibility/power behavior require the owed physical-device rounds; no services were started or changed.
- I did not live-dial prod Speaches or the TTS chain, so upstream timing/error frequency and real route-release latency remain field questions. The relay contract was checked from source and its fake-upstream tests.
- E-1's exact incidence on the phone depends on human/reply timing; the state transition and loss mechanism are deterministic, but this audit did not measure that race on hardware.
- The Playwright live-call spec was read but not run; the user-authorized focused pytest/vitest suites were run and passed.
- A no-file ad-hoc reducer bundle was not usable because the full frontend import graph evaluates Vite-only `import.meta.glob`; no repository file was created to work around that. Reducer conclusions above are source-verified and compared against its existing tests.

---

## VERDICT for v1.7.8: **SHIP WITH FIXES — E-1 and E-2 gate; reconcile Consistency-1 through Consistency-5 in the same release doc sweep**

The R86 wave is materially good: all eight fixes exist, focused backend/frontend suites pass, admission and secret rails hold, the new idle reaper closes the 30-minute slot problem, and first-run migration/default behavior is sound. E-1 is the release blocker: the new evidence gate mistakes a partial live utterance for a completed quiet one and, under the default media/auto-hold path, can cut off the owner's sentence exactly when reply and speech cross. E-2 is a small adjacent completion of LC-6 and should land with it. The consistency defects are stale owning sections/comments rather than runtime faults, but this release explicitly flips the call on; leaving contradictory configuration and background promises at that boundary is not production-quality documentation. No evidence supports DO NOT SHIP after those focused corrections.
