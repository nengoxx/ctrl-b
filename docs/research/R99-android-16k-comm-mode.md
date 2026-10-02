# R99 — Does a 16 kHz `AudioContext` go dead on Chrome Android in communication mode?

**Date:** 2026-10-02 · **Author:** research lane R99 (Opus 5.5), session 58 · **Status:** evidence dossier. Nothing is built.
**Question:** after K6 (`96fdc4e`), a call-route capture on the Honor 20 posted **no worklet frame for 15 s** (twice), while the
media route works and a pre-K6 (48 kHz) call-route capture worked on 2026-09-26. Is the 16 kHz context the cause in
`MODE_IN_COMMUNICATION`, and if so through which mechanism?
**Builds on:** [R96](./R96-16khz-capture.md) §2.2 · R74 §1/§7-S2 · R77 §3 · R78 §1.3/§2.3 ·
R80 §3.3/§5. **Index row owed:** the main seat adds it when this lands in `docs/research/`.

**Confidence vocabulary** (R95/R96's): **VERIFIED** = source read today at the pin below, or read off tonight's dev trails.
**REASONED** = derived from verified facts plus a stated assumption. **NOT FOUND** = searched, nothing. **UNVERIFIED** = not
checked / not checkable from here.

**Pins.** Chromium `main` @ `1bcfacc5277d` (2026-10-02 19:30Z), files read whole via gitiles `?format=TEXT`; flag history via
the GitHub mirror (`51814f89c3cc`, 2025-06-17). AOSP `frameworks/av` @ `android10-release`. Trails: `~/.ctrl-b-dev/calls/`
`edc38e0c…`, `11d95642…` (failing), `d7552e2b…` (K6 media, good), `ef512236…` (pre-K6 call, good). Only technical fields read.

---

## 0. Verdict

**The working hypothesis is refuted at its root: on Chrome Android the audio service never sees a 16 kHz output stream.**
`kWebAudioRemoveAudioDestinationResampler` is **disabled on Android only**, so `RendererWebAudioDeviceImpl` opens the sink
at the **hardware** rate and Blink resamples 16→48 kHz itself (VERIFIED, §1). Tonight's trail proves the flag was off on the
phone: `baseLatency 0.06` = 960 hardware frames ÷ 16 000 (with the flag on it would read ≈ 0.02) (VERIFIED, §1.3).
So a 16 kHz and a 48 kHz context ask the audio service for **identical** `AudioParameters`, and the communication-mode
output stream at those exact params worked pre-K6. I found **no** rate-dependent path in the renderer that can stop the graph
(§2); the input side can only zero-fill, never stall (§2.2). The evidence does **not** isolate the rate: **both failures were
mid-call media→call FLIPS, and the only good call-route baseline is a DIRECT start.** The most likely mechanism is
**rate-independent and flip-specific** (§3): the new context's sink inherits the **pooled** physical output stream (same
params ⇒ same dispatcher; idle streams kept 5 s) that was created **MEDIA-tagged before the mode switch**; entering
`MODE_IN_COMMUNICATION` re-routes MEDIA streams to the phone device (R77 §3), AAudio **disconnects** a stream whose routed
device changes, and Chrome turns that into a WebAudio **render error** ⇒ the context goes `suspended` and fires `error`,
neither of which ctrl-b listens to after start. Each link is VERIFIED in source except two on-device facts (whether the phone
device ≠ the media device on the Honor 20 at that moment, and whether the error actually fired), so the mechanism is
**REASONED, moderate confidence (~50 %)**; "the 16 kHz rate itself breaks the comm-mode output" is **low (<15 %)**.
**The one discriminating field test:** a **direct** call-route start (Conf `route: call`, start a call; no flip) on the K6
build, with the trail sampling `ctx.state`, `ctx.currentTime` and logging the context's `error`/`statechange`. Frames flow ⇒
the rate is exonerated and the flip is the bug. Then, if wanted, a flip with a ≥ 6 s gap between hang-up of the old ear and
the new context (outlives the pool) — failure gone ⇒ the pooled stream.

---

## 1. Platform facts — the output side

### 1.1 Android opens the WebAudio sink at the hardware rate, whatever `sampleRate` the page asked for (VERIFIED)
- `media/audio/audio_features.cc:53-58`:
  ```cpp
  BASE_FEATURE(kWebAudioRemoveAudioDestinationResampler,
  #if BUILDFLAG(IS_ANDROID)
               base::FEATURE_DISABLED_BY_DEFAULT);
  #else
               base::FEATURE_ENABLED_BY_DEFAULT);
  ```
  It was turned on for non-Android only (`51814f89c3cc`, "Enable … by default"; the diff touches only the `#else` arm).
- `content/renderer/media/renderer_webaudiodevice_impl.cc:299-321`: with the flag off,
  `resolved_context_sample_rate = original_sink_params_.sample_rate()` (the hardware rate), and the sink params are
  `Reset(format, layout, resolved_context_sample_rate, output_buffer_size)`.
- `third_party/blink/renderer/platform/audio/audio_destination.cc:566-590`: with the flag off and
  `context_sample_rate_ != device rate`, Blink builds a `MediaMultiChannelResampler` and pulls the graph through it
  (`ProvideResamplerInput` → `PullFromCallback`, `:780-813`). This is the long-standing path every `{sampleRate}` page uses.
- **⇒ R96 §2.2's "output resampler, < 10 ms" stands, and the brief's premise ("Chrome opens a 16 kHz output stream that the
  voice path refuses") cannot occur on default Android Chrome.** A Finch trial flipping the flag on Android is the only
  exception; §1.3 shows it was not active on the phone tonight.

### 1.2 The audio service never resamples here either (VERIFIED)
- `media/audio/android/audio_manager_android.cc:1049-1080` `GetPreferredOutputStreamParameters`: without per-stream device
  selection, `sample_rate = input_sample_rate.value_or(native)` — the requested rate is passed through, so for an
  already-hardware-rate request the `AudioOutputResampler` is an identity.
- `:786-834` `MakeLowLatencyOutputStream`: AAudio (default on, `audio_features.cc:20`) with
  `usage = communication_mode_is_on_ ? AAUDIO_USAGE_VOICE_COMMUNICATION : AAUDIO_USAGE_MEDIA`, read **once, at creation**
  (the R74 S2 / R77 §3 latch). Nothing here depends on the context's rate.

### 1.3 The trail confirms: same sink, same buffer (VERIFIED)
- `audio_context.cc:682-687`: `baseLatency = max(GetFramesPerBuffer(), renderQuantum) / sampleRate()` — **device-side frames
  over the context rate**.
- K6 contexts, both routes, every trail tonight: `baseLatency 0.06` = 960/16 000. Pre-K6 prod: 0.02 = 960/48 000. With the
  flag on, `GetOutputBufferSize` (`:143-200`) scales the buffer to the context rate (≈ 320) and it would read ≈ 0.02.
- **⇒ 960-frame, 48 kHz sink in both the K6 and the pre-K6 builds.** CARD_READ's "baseLatency moved 0.02 → 0.06" is this
  formula, not a latency change.

### 1.4 Every WebAudio context with equal params shares one pooled physical stream (VERIFIED; R80 §3.3 re-read)
- `audio_manager_base.cc:39` `kStreamCloseDelaySeconds = 5`; `:664-677` dispatchers reused when
  `params.Equals && output_params.Equals && device_id ==`. `AudioParameters::Equals` (`media/base/audio_parameters.cc:324-330`)
  compares format, rate, layout, channels, **frames_per_buffer**, effects — **not** the latency tag.
- `audio_output_dispatcher_impl.cc:76-101` `StartStream` pops an **idle** physical stream and calls `Start` on it — no health
  check; `:203-210` `StopPhysicalStream` pushes it back; `:127-134` `CloseStream` keeps ≥ 1 idle stream; `close_timer_` is
  `Reset()` on every start/stop/close, so a stream reused at < 5 s intervals **never ages out**.
- **⇒ the 16 kHz context and a device-rate fallback context land in the SAME dispatcher on Android** (identical sink params,
  §1.3). Switching the context rate cannot buy a fresh output stream.

### 1.5 A device change poisons an AAudio stream until it is closed (VERIFIED)
- AOSP `media/libaaudio/src/legacy/AudioStreamLegacy.cpp:207-229` (android10-release) `onAudioDeviceUpdate`: if the routed
  device id changes, an active stream is asked to DISCONNECT in its data callback; an inactive one is `forceDisconnect()`ed now.
- Chromium `aaudio_stream_wrapper.cc:766-771`: `AAUDIO_ERROR_DISCONNECTED` → `OnDeviceChange()`. `aaudio_output.cc:208-219`:
  sets `device_changed_ = true` (never reset) and, if a client is attached, `OnError(kDeviceChange)`; otherwise *"Report the
  device change in Start() instead"* — `:79-89`: every later `Start()` on that stream immediately calls
  `callback->OnError(kDeviceChange)` and returns.
- Error chain to the page: `audio_output_resampler.cc:571-574` → `services/audio/output_controller.cc:588-600`
  `handler_->OnControllerError()` → `output_stream.cc:399-418` → renderer `audio_output_device.cc:309-324`
  `NotifyRenderCallbackOfError` → `renderer_webaudiodevice_impl.cc:485-497` → `AudioContext::OnRenderError` →
  `HandleRenderError` (`audio_context.cc:2237-2265`): **`StopRendering()`, `DispatchEvent(error)`, state → `"suspended"`**.
- R77 §3 (VERIFIED there, AOSP android10): in `MODE_IN_COMMUNICATION`, `STRATEGY_MEDIA` is routed to the `STRATEGY_PHONE`
  device, and `setPhoneState` re-routes **all open outputs**. Whether that changes the device id of a speaker-routed MEDIA
  stream on the Honor 20 is **UNVERIFIED** (it does if the phone device is the earpiece or a "speaker for voice" port id).

## 2. Platform facts — the render/worklet side

### 2.1 What "the worklet posted nothing" can mean (VERIFIED)
- `audio_worklet_handler.cc:139-142`: a connected input is always handed to `process()` as a bus with ≥ 1 channel;
  `media_stream_audio_source_handler.cc:84-104`: the source node **always** writes its bus (data or zeros, never nothing).
- So with the graph rendering, ctrl-b's `process()` posts a frame every 40 ms even of pure silence (`pcmWorklet.ts`
  posts on `n === size` regardless of level). The trail shows the meter **bit-identical for 15 s** (`level −71.04…` /
  `−84.49…`, `levelPeak2s` carried over from the old ear) and the relay `frames 0` ⇒ **`process()` did not run**, i.e. the
  destination stopped pulling or the processor was cleared (`FinishProcessorOnRenderThread`, `:118-127/:206-225` — only on a
  thrown `process()` or a disconnected input with `process()` returning false; ours returns `true` always).
- **⇒ the input side is exonerated as a STALL cause.** `webaudio_media_stream_audio_sink.cc:229-241`: an underrun zero-fills;
  an overrun drops (`:150-165`). A silenced or not-yet-formatted track yields zero frames, which would still be POSTED.

### 2.2 No rate-dependent stall found in the renderer (NOT FOUND)
Read whole: `audio_destination.cc` (FIFO, resampler, dual-thread render, bypass), `realtime_audio_destination_handler.cc`,
`renderer_webaudiodevice_impl.cc`, `webaudio_media_stream_audio_sink.cc`, `media_stream_audio_source_handler.cc`,
`audio_worklet_handler.cc`, `audio_context.cc`, `base_audio_context.cc`. The only rate-specific objects are the two
resamplers (§1.1, R96 §2.2) and the worklet frame size (640 vs 1920). None reads the communication mode; all run on the
media route tonight (`d7552e2b…`, 793 s, 19 841 frames). The FIFO/callback sizing is in device frames and identical (§1.3).

### 2.3 The sink is restarted when the worklet becomes ready (VERIFIED)
`base_audio_context.cc:944-975` `NotifyWorkletIsReady`: if the context is `running`, `RestartRendering()` = Stop + Start of
the platform destination (`realtime_audio_destination_handler.cc:196-201`), which in `RendererWebAudioDeviceImpl::Stop/Start`
drops and re-creates the sink (`:420-437`, `:375-395`). So one call start = **two** stream starts on the pooled dispatcher:
at construction and after `addModule`. Rate-independent; doubles the exposure to §1.5.

### 2.4 Trail evidence of a render having happened (VERIFIED)
`outputLatency` is `output_position_.hardware_output_latency`, written **only** in `HandlePreRenderTasks`
(`audio_context.cc:1591-1630`, audio thread). Failing call capture in `11d95642…` read **`0.02`** at `captureReady` ⇒ that
fresh context rendered ≥ 1 quantum before the stall. (`edc38e0c…` read `0`, which is uninformative: every media-route
capture also reads 0.) So "the sink never started" is false for at least one failure; "it started and then died" fits.

## 3. The flip mechanism, assembled (REASONED from §1.4–§2.4)

1. Media route: the old context's sink holds physical stream **P**, created while comm mode was off ⇒ `AAUDIO_USAGE_MEDIA`.
2. `recapture`: old tracks stopped; old `ctx.close()` (not awaited) ⇒ P stopped, **kept idle** (§1.4).
3. `getUserMedia({echoCancellation:{ideal:"all"}})` = the first input stream ⇒ `SetCommunicationAudioModeOn(true)`
   (`audio_manager_android.cc:727-739`) ⇒ audiopolicy re-routes every output (R77 §3).
4. The new 16 kHz context starts its sink — same params, same dispatcher ⇒ **P again**. Either P was already disconnected
   (step 3 landed first ⇒ `Start()` reports `kDeviceChange` at once) or it renders a few callbacks (the `0.02`) and the
   re-route then disconnects it; the `addModule` restart (§2.3) is a second chance for either.
5. ⇒ render error ⇒ `error` event + `state = "suspended"` (§1.5) **after** ctrl-b's one-shot `state !== "running"` check
   (`pcmCapture.ts` `startPcmCapture`). Nothing in ctrl-b watches the context after start; `earGapMs` is only consulted on the
   visibility edge (CARD_READ). The ear is dead behind a `listening` screen; the relay reaps the leg at 15 s.
- **Why the pre-K6 baseline passed:** it was a **direct** call-route start — no pooled MEDIA stream existed with those params,
  so the sink got a **fresh** stream created after the mode switch, VOICE_COMMUNICATION-tagged. Same as a K6 direct start
  would (prediction of §0's test).
- **Why the media route never fails:** EC off ⇒ no mode switch ⇒ no re-route ⇒ P stays healthy.
- **What would falsify it:** a K6 direct call start that also fails; or a failing flip with `ctx.state` still `"running"`
  and `currentTime` frozen (a silent stall, not an error); or `currentTime` advancing with no frames (worklet side).
- **Gap:** pre-K6 *flips* media→call are not in evidence (trails pruned; HANDOFF_ARCHIVE has no record either way). If one
  ever worked, step 3/4's device change does not occur on this phone and the mechanism is wrong.

## 4. The two side questions

**(1) Does `state` read `"running"` over a dead sink? Yes — `running` proves nothing about rendering. (VERIFIED)**
- Construction with sticky activation: `StartRendering()` then `ScheduleInitialTransitionToRunning()` (`audio_context.cc:
  583-586`, `:1134-1190`) — `running` is set by a **posted task** (async-transitions flag) or immediately, not by a render.
  A `resume()` on the still-`suspended` new context resolves through the same task (`ResolvePendingResumeResolvers`, `:1187`).
- Distinguishing signals:
  - **device ERROR** (§1.5): an `error` event on the `AudioContext` and `statechange` → `"suspended"` (`:2237-2265`;
    console: "The AudioContext encountered an error from the audio device or the WebAudio renderer."). Observable, unobserved.
  - **silent non-pulling sink**: state stays `"running"`; `currentTime` frozen (advanced only in render,
    `AdvanceCurrentSampleFrame`, `realtime_audio_destination_handler.cc:288`); `getOutputTimestamp().contextTime` frozen
    (`:989-1006`, from `output_position_`); `outputLatency` frozen at its last render value.
  - `sinkId` (`""` default) and `baseLatency` (fixed at construction) **do not** distinguish. A 30 s silence switch to a fake
    sink exists (`renderer_webaudiodevice_impl.cc:358`, `SilentSinkSuspender`) but keeps `currentTime` advancing.
  - Cheapest robust probe: `ctx.currentTime` advanced by ≥ ~0.5 s within 1 s of wall clock, plus the `error` listener.

**(2) Open the 16 kHz context BEFORE the EC-"all" `getUserMedia`? Not better — probably worse. (REASONED)**
- Rate: irrelevant on Android (§1.1) — the sink is 48 kHz either way.
- Usage: a sink created before the switch is MEDIA-tagged and is then re-routed by the switch — the exact hazard of §3.
  And the post-`addModule` restart (§2.3) re-acquires through the same pool. It would also make every DIRECT call start look
  like a flip. Not recommended.

## 5. External search (NOT FOUND)

- Web searches (Chrome Android × `sampleRate: 16000` × silent / AudioWorklet not called / communication mode / getUserMedia
  echoCancellation): no report of a 16 kHz-specific comm-mode stall. The only Android WebAudio live issue remains ElevenLabs
  #1021 (AnalyserNode flat on a WebRTC-published track) — different path. `issues.chromium.org` search is not served
  unauthenticated (`/action/issues/list` → 405); crbug 418159590 (why the flag was held back on desktop) is a Linux/Mac
  getDisplayMedia distortion, unrelated to Android.
- ElevenLabs Conversational AI ships a 16 kHz context on Chrome Android with the default `echoCancellation: true` (R96 §1) —
  direct starts in comm mode, at scale. Consistent with "rate fine, flip is the variable" (REASONED; their flip behaviour unknown).

## 6. What ctrl-b should do

Run §0's direct-start test first; the ranking assumes it passes (flip is the variable).

1. **Make the ear's death observable and recoverable — mechanism-agnostic, detection-driven (recommended).** In
   `startPcmCapture`, attach `onstatechange`/`onerror` to the capture context for the call's lifetime and add a **first-frame
   watchdog** (no frame within ~1.5 s of capture start, or `currentTime` not advancing) → report up as an ear outage and
   rebuild. Same shape as D75 ③'s EC-release barrier: nothing waits unless failure is observed. **The rebuild must not reuse
   the pool**: either wait out `kStreamCloseDelaySeconds` (5 s, VERIFIED) with no WebAudio stream at those params open, or
   rebuild the context with different `frames_per_buffer` (a numeric `latencyHint` → `kCategoryExact`, a different
   `AudioParameters` ⇒ a new dispatcher ⇒ a fresh stream created under comm mode; REASONED — `latencyHint` sizing on
   Android needs a phone check). Also fixes the general class "a context error leaves a silent `listening` call", which
   exists independent of K6. Trade-off: a ~1.5–6 s hiccup on a broken flip instead of a 15 s dead call; more code in the
   capture than today.
2. **Prevent it on the flip (if the test confirms the flip).** Give the call route's capture context a sink that can never
   share the media route's pool — e.g. a route-specific `latencyHint` so the two routes' sink params differ — so the media→call
   flip always opens a fresh, post-switch VOICE_COMMUNICATION stream (exactly what the passing direct start gets). Cheap and
   deterministic **if** the hint yields a distinct buffer size on the Honor 20 (REASONED; verify via `baseLatency`, which
   would move). Trade-off: a hack keyed to Chromium's pooling internals; call→media needs the mirror-image check; keep #1
   as the net under it.
3. **Device-rate context whenever `wantsAec(route)` — only if the direct-start test FAILS.** No source mechanism supports it
   (§1–§2), and on Android it would **not** escape a pooled stream (§1.4: identical sink params). It costs the call route
   K6's 3× uplink saving and puts the relay's drop-sampling resampler back on that route (R96 §3). Opening the context
   before `getUserMedia` (§4 (2)) is not a fix shape.

Instrumentation to add regardless (the trail already logs `outputLatency`/`baseLatency`): on the 1 Hz `sample` line,
`ctxState` and `ctxTime` (`currentTime`); a trail line for every capture-context `statechange`/`error`.

## 7. Corrections and gaps

- **Correction to the brief's premise:** on Android, `{sampleRate: 16000}` never reaches the output device (flag off;
  `baseLatency 0.06` proves it on the phone). R96 §2.2's output-side note is right; its "flag moves the resampler elsewhere"
  applies to desktop only.
- **Correction to CARD_READ:** "`baseLatency` 0.06 vs 0.02 = the handoff's ≤ 0.01 move FAILS" — the number is
  device-frames/context-rate (§1.3); the real output latency is unchanged, as the chirp showed.
- **Gaps:** whether the Honor 20's media vs phone device ids differ in comm mode (the §3 linchpin); whether an `error` event
  fired (not logged); whether any pre-K6 media→call flip ever passed; whether Chrome on this phone runs AAudio legacy or MMAP
  (both disconnect on device change — REASONED for MMAP); Finch state of the flag on other phones; numeric `latencyHint`
  sizing on Android.

## References

- Chromium `main` @ `1bcfacc5277d` (2026-10-02), `chromium.googlesource.com/chromium/src/+/refs/heads/main/<path>`:
  `media/audio/audio_features.cc` · `content/renderer/media/renderer_webaudiodevice_impl.cc` ·
  `third_party/blink/renderer/platform/audio/audio_destination.cc` ·
  `third_party/blink/renderer/modules/webaudio/{audio_context,base_audio_context,realtime_audio_destination_handler,audio_worklet_handler,media_stream_audio_source_handler}.cc` ·
  `third_party/blink/renderer/modules/mediastream/webaudio_media_stream_audio_sink.cc` ·
  `media/audio/android/{audio_manager_android,aaudio_output,aaudio_stream_wrapper}.cc` ·
  `media/audio/{audio_manager_base,audio_output_dispatcher_impl,audio_output_resampler,audio_output_device}.cc` ·
  `media/base/audio_parameters.cc` · `services/audio/{output_controller,output_stream}.cc`.
- Flag history: github.com/chromium/chromium commit `51814f89c3cc` (2025-06-17, CL 6648147); crbug 418159590.
- AOSP `platform/frameworks/av` `android10-release`: `media/libaaudio/src/legacy/AudioStreamLegacy.cpp`.
- ctrl-b: `frontend/src/lib/pcmCapture.ts` (`openCaptureContext`, `startPcmCapture`, `attachPcmUplink`) ·
  `frontend/src/lib/pcmWorklet.ts` · `frontend/src/hooks/useLiveCall.ts` (`recapture`, capture trail line) ·
  `~/.cache/tmp/ctrlb-session58/CARD_READ.md` · dev trails listed under Pins.
- Prior dossiers: R74 · R77 §3 · R78 · R80 §3.3/§5 · R96.
- ElevenLabs issue #1021: https://github.com/elevenlabs/packages/issues/1021
