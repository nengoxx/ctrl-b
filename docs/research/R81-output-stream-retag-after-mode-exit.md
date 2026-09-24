# R81 — re-tagging the element's output stream after the comm-mode exit

**Date: 2026-09-24 · Confidence: the Chromium chain is VERIFIED at the pin (whole files read raw); the
Android routing half is VERIFIED in AOSP-default source but REASONED for the Honor 20 (Magic UI may
diverge); nothing here was probed on the phone.**

**Question (one):** after the page releases the EC capture (comm mode exits), what is the minimum
deterministic in-page sequence that makes the `HTMLAudioElement`'s NEXT playback open a physical output
stream tagged with the CURRENT mode (`AAUDIO_USAGE_MEDIA`), and how long does it take?

**Occasion:** owner's phone round 2026-09-24 (Honor 20, Chrome): after an EC-on → EC-off flip, TTS keeps
coming out of the phone speaker until "a longer silence"; EC-off → on re-routes at once.
**Builds on:** [`R80`](R80-comm-mode-crackle.md) §3.2/§3.3/§5 · [`R74`](R74-android-call-audio-routing.md)
§1.1–1.2 · [`R77`](R77-android10-pres-route-residual.md) §1.1/§1.5/§3. **Drove:** nothing yet.
**Corrects:** R80 §1 + §3.3 (the prime) and R80 §3.1 (which config function applies) — §2.

| Source | Pin | How read |
|---|---|---|
| `chromium/chromium` | **`d07f3a393fd2cc0357a7835ccae8a07103a5c55d`** (main, 2026-09-24T19:31Z) | raw.githubusercontent.com, whole files |
| AOSP `frameworks/av` · `frameworks/base` | `android10-release` @ `0f111c8099df` · `37a24f52e6be` (R77's pins) | googlesource `?format=TEXT` |
| ctrl-b | `d0fb67c` | local |

---

## 0. The answer — unload, then 5 s of dispatcher silence

**Precondition (VERIFIED, R80 §5):** the mode has really exited. If the new EC-off capture opens its input
stream before the old one is released, `if (!stream || has_input_streams || …) return stream;` skips the
mode logic, and `ReleaseInputStream` restores only `if (HasNoAudioInputStreams() && communication_mode_is_on_)`.
The mode then stays on for the whole new capture, and no output sequence can fix that
(`audio_manager_android.cc:730, 761`).

1. **`a.pause(); a.removeAttribute("src"); a.load();`**, done straight away, **and no rewind-hold**. VERIFIED.
   `load()` → `InvokeLoadAlgorithm` → `ResetMediaPlayerAndMediaSource` → `web_media_player_->Shutdown()` +
   `DeleteSoon(…web_media_player_)` (`html_media_element.cc:4329–4333`) → `~AudioRendererImpl`:
   `sink_->Stop();` (`audio_renderer_impl.cc:279`) → `AudioRendererMixerInput::StopInternal`:
   `mixer_pool_->ReturnMixer(…)` (`audio_renderer_mixer_input.cc:116`) → ref count 0 → mixer erased →
   `~AudioRendererMixer`: `audio_sink_->Stop();` (`audio_renderer_mixer.cc:42`) → IPC `CloseStream` →
   `OutputController::Close` → proxy `Stop` + `Close` → `AudioOutputDispatcherImpl::CloseStream`:
   `CloseIdleStreams(std::max(idle_proxies_, static_cast<size_t>(1))); close_timer_.Reset();` (`:133–134`).
   Removing `src` on its own does nothing, because the reload only fires `if (!params.new_value.IsNull())`
   (`html_media_element.cc:815`). The `load()` is what tears the player down.
2. **Wait ≥ 5 s with nothing touching that dispatcher.** VERIFIED. The timer is built with
   `&AudioOutputDispatcherImpl::CloseAllIdleStreams` (`dispatcher_impl.cc:30–33`), which is
   `CloseIdleStreams(0)` (`:184`). That closes **every** idle physical stream, the "at least one" included.
   `kStreamCloseDelaySeconds = 5` (`audio_manager_base.cc:39`). `OpenStream`, `StartStream`, `CloseStream`
   and `StopPhysicalStream` all call `close_timer_.Reset()`, so any open, start, stop or close on the same
   dispatcher restarts the 5 s.
3. **Only then set `src` and play.** VERIFIED. **The stream's tag is fixed when `src` is assigned, not
   when `play()` is called.** For an unmuted element, renderer init runs `InitializeSink` → `SetVolume(volume_)`
   in state `kFlushed` → `MaybeStartRealSink` → `sink_->Start()` (`audio_renderer_impl.cc:592–597,
   922–924, 1714–1716`) → `GetMixer` → new mixer, whose constructor runs `audio_sink_->Start()` ("Start()
   results in an auto-play", `audio_renderer_mixer.cc:29–37`) → `OutputController::CreateStream` →
   proxy `Open` → `OpenStream`: `if (idle_streams_.empty() && !CreateAndOpenStream())` → `MakeLowLatencyOutputStream`
   reads `communication_mode_is_on_` → **`AAUDIO_USAGE_MEDIA`** (`audio_manager_android.cc:806–808`).

**Total: ≈ 5 s** from the `load()`, plus a few ms of IPC and task hops (budget **5.5 s**). With
`pause()` alone, or with today's `finish()` rewind, it is **≈ 15 s** after the last playback (§1).

## 1. Why pause() costs 15 s — the mixer's delay adds to the dispatcher's (VERIFIED)

Media elements always go through the mixer: `// Media element must ALWAYS go through mixer.`
(`audio_device_factory.cc:74`). A **paused** input only calls `mixer_->RemoveMixerInput(params_, this)`
(`audio_renderer_mixer_input.cc:140`). The mixer's sink **keeps playing silence** until `Render` sees
`now - last_play_time_ >= pause_delay_` with `kPauseDelay = base::Seconds(10)`, and then calls
`audio_sink_->Pause()` (`audio_renderer_mixer.cc:19, 139–144`). That becomes `OutputController::Pause` →
`stream_->Stop()` → `StopPhysicalStream` → idle, timer reset. After another 5 s the stream closes.
**The two delays run one after the other: 10 + 5 = 15 s** (plus one render period, about 21 ms). The
separate idle-suspend path (`idle_timeout_ = base::Seconds(15)`, `renderer_web_media_player_delegate.cc:44`)
is never faster.

**Our `finish()` (`audioController.ts:899`) re-`src`s chunk 0 and holds it paused.** Per step 3 that
builds a new mixer whose sink starts and takes the idle stale-tag stream, then runs silence for 10 s.
This is the owner's "longer silence".

**R80's "Start()/Stop() at every chunk gap", reconciled (VERIFIED chain; ordering REASONED).** Each
`src` swap destroys the old player. Its mixer reaches ref 0 and dies, and its proxy's
`CloseStream` keeps one idle stream. The new player's mixer opens a new proxy, and `OpenStream` reuses
that idle stream. So each chunk gets a new mixer and a new proxy on the same physical stream. The old
teardown is 1–2 task hops. The new `GetMixer` has to wait for a blob fetch, a demux and a
device-authorization IPC first, so teardown wins in practice, though no contract guarantees it. If the
new call won the race, it would reuse the old mixer, and the physical stream would be the same either way.

## 2. Corrections to R80

- **The prime opens NO output stream at all (VERIFIED).** `primeAudio` sets `muted = true` before
  `src`, so `EffectiveMediaVolume()` returns 0 (`html_media_element.cc:3487`). With `volume_ == 0` and
  `!render_muted_audio_`, `StartRendering_Locked` plays `null_sink_` and the real sink is never started.
  R80 §3.3's conclusion ("cannot poison the TTS stream") still holds, but for this reason, not for
  the "different dispatcher" reason R80 gave.
- **The mixer key ignores the sample rate (VERIFIED):** `MixerKeyCompare` compares the frame, channels,
  latency, layout, effects and device (`audio_renderer_mixer_manager.h:118–142`). The rate reaches the
  dispatcher only because a new mixer takes its first input's rate (`output_sample_rate =
  input_params.sample_rate()` under passthrough, `mixer_manager.cc:47–50`). The dispatcher then
  compares `sample_rate_` and `frames_per_buffer_` (`audio_parameters.cc:325–329`).
- **R80 §3.1 quoted the wrong branch.** A blob `src` uses `FFmpegDemuxer`, and
  `FFmpegDemuxerStream::SupportsConfigChanges() { return false; }` (`ffmpeg_demuxer.cc:781`) sets
  `use_stream_params`. That calls **`ComputeStreamOutputConfig`**, which takes the stream's own layout and
  rate. Opus still comes out at 48 kHz. A 24 kHz WAV or MP3 is passed through at 24 kHz and resampled by
  the OS, not by the renderer.
- **The duration probes are inert (VERIFIED).** `preload="metadata"` on an audio-only FFmpeg source
  starts suspended (`demuxer_manager.cc:286–296`). The pipeline calls `DestroyRenderer()` once the
  metadata is in (`pipeline_impl.cc:1316–1324`), so a probe never touches the dispatcher and never
  resets its timer.

## 3. Why the stale stream is on the SPEAKER, and why the reverse flip is immediate

**Forward (VERIFIED at AOSP-default; REASONED for the Honor).** In `MODE_NORMAL` the latched
`AUDIO_USAGE_VOICE_COMMUNICATION` stream is routed by `STRATEGY_PHONE`. Under `FORCE_SPEAKER`, Engine
tries only `AUDIO_DEVICE_OUT_BLUETOOTH_A2DP_SPEAKER`, then `AUDIO_DEVICE_OUT_SPEAKER` (`Engine.cpp:270–291`).
The EC-off capture's default selection lands on Speakerphone, and `setAudioDevice` then calls
`setSpeakerphoneOn(true)` (`CommunicationDeviceSelectorPreS.java:246`; R77 §1.5). **The phone speaker is
therefore the product of the stale tag AND the forced speakerphone.** A fresh MEDIA stream ignores
`FOR_COMMUNICATION`, which is why the later reply reaches A2DP.
**Reverse (VERIFIED, R77 §3):** `setPhoneState` re-evaluates every output, and when `isInCall()` holds,
`STRATEGY_MEDIA` takes the `STRATEGY_PHONE` device. The MEDIA stream therefore moves the moment the mode
flips.

**A route-only lever this implies (REASONED).** `setSpeakerphoneOn(false)`, which PreS issues for
`ID_EARPIECE`/`ID_WIRED_HEADSET`/`ID_USB_AUDIO` (`:249–255`), sets `FORCE_NONE` (`AudioDeviceBroker.java:190–195`).
`setForceUse` re-routes every output (`AudioPolicyManager.cpp:796–805`). Under `FORCE_NONE` and
`!isInCall()`, `STRATEGY_PHONE` tries `AUDIO_DEVICE_OUT_BLUETOOTH_A2DP` first (`Engine.cpp:238–245`).
So capturing the EC-off leg on the **earpiece row** should move even the stale stream to the headphones
at once, mid-reply included, at voice-call volume.

## 4. Mechanisms ranked

| Mechanism | Deterministic? | Silence | Risk | Lines | Verdict |
|---|---|---|---|---|---|
| **load()-and-wait** (§0) | **Yes** (VERIFIED chain) | 5–5.5 s, **only if** the next reply starts < 5 s after the unload; otherwise 0 | Another element or tab with the same params resets the timer (single-user app: negligible). A reply playing at the flip finishes on the old route | ~25–40 (`useLiveCall` flip hook + no rewind-hold in-call + a "not before T+5.5 s" gate on the first chunk) | **RECOMMENDED** |
| pause-and-wait | Yes | 15 s | Today's behaviour, as ruled by `finish()` | 0 | Worse than the one above |
| src-format switch | Conditional | 0 s, re-tags at the next chunk boundary | Needs the server to alternate rate/channels per epoch, or a client transcode. The old mixer racing past the teardown would resample into the old mixer. The alternate format's own idle stream may be stale | ~60–120 + server | Reject: cost and fragility buy only 5 s |
| WebAudio re-parent | Conditional | 0 s | `createMediaElementSource` is once per element (`"HTMLMediaElement already connected previously…"`, `media_element_audio_source_node.cc:60–64`), so each flip needs a new element and a new context. It must differ in params from any context closed < 5 s earlier (our capture context included). It brings in the low-latency class R80 §3.2 suspects unless `latencyHint:"playback"` | ~80–150 | Reject: reopens the pipe the module deliberately avoids |
| accept-and-note | — | 0 s | Up to 15 s on the speaker, at call volume | 0 | Acceptable interim |
| *earpiece-row EC-off capture* (§3) | Not VERIFIED on device | 0 s, including mid-reply | OEM engine divergence. Voice-call volume until a fresh stream. With no BT connected, the stale stream goes to the EARPIECE | ~5 (deviceId) | **Probe first. The deck may already expose the row, so it could need zero code** |

**Recommendation:** first, run the zero-code phone probe of the earpiece row, because it is the only
lever that fixes a reply already playing. Then build load()-and-wait as the deterministic re-tag. The
5 s rarely costs anything: in a call the next reply follows the user's utterance plus STT and LLM
latency, which usually takes longer than 5 s.

## 5. What I could not determine

- Whether Magic UI 3.x keeps AOSP's `STRATEGY_PHONE` `FORCE_NONE` → A2DP order, and whether the deck's
  "Headset earpiece" row is PreS's `ID_EARPIECE`. One phone probe settles both.
- Whether the audio service on Android can ever take the `managed_device_output_stream_create_callback_`
  path instead of the proxy (`output_controller.cc:310`). I assumed not, following R80 §6's compiled-out
  AEC arms, but did not re-read it.
- The exact IPC slack between `load()` and the dispatcher `CloseStream`. The 0.5 s margin is a guess.
- Whether the page can observe the mode exit (R80 §5). Without that, the precondition is a barrier plus
  hope.

## 6. The numbers that decide the design

| Number | Value | Where | Status |
|---|---|---|---|
| Mixer pause delay (no inputs → sink `Pause()`) | **10 s** | `audio_renderer_mixer.cc:19` | VERIFIED |
| Dispatcher idle close delay | **5 s** | `audio_manager_base.cc:39` | VERIFIED |
| Idle streams kept on `CloseStream` / on timer fire | 1 / **0** | `dispatcher_impl.cc:133, 184` | VERIFIED |
| `pause()` → physical close | **≈ 15 s** | 10 + 5, serial | VERIFIED chain |
| `load()` → physical close | **≈ 5 s** (+ms) | §0 step 1–2 | VERIFIED chain |
| Paused-player idle suspend | ≥ 15 s (5 s sweep) | `renderer_web_media_player_delegate.cc:43–44` | VERIFIED |
| Tag latched at | **`src` assignment** (renderer init), not `play()` | §0 step 3 | VERIFIED |
| Dispatcher key | rate · layout · channels · fpb · effects · format (not latency tag) | `audio_parameters.cc:325` | VERIFIED |
| Mixer key | frame · channels · latency · layout · effects · device (**not rate**) | `mixer_manager.h:118` | VERIFIED |
| Muted prime → physical streams | **0** | §2 | VERIFIED |
