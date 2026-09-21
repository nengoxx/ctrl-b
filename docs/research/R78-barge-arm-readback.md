# R78 — the barge-arm readback: why automatic voice interruption is dead on the speaker route

**Date: 2026-09-21 · Confidence: the Chromium/WebRTC/AOSP mechanism is VERIFIED in source read at the
pins below; the ctrl-b configuration arithmetic is VERIFIED against the live dev `config.yaml` and the
shipped client code; the device-level cause on the owner's phone is UNDETERMINED by design — this pass
produces the *discriminator*, not the verdict (no phone in this session).**

**Question (one):** why is automatic voice barge-in dead on the speaker route on the owner's phone
(Honor 20 · Android 10 · Chrome · phone loudspeaker · no BT connected), and what should the app surface
to tell the possible causes apart *on-device, without adb*?

**Occasion:** the owner's 2026-09-21 call round. During TTS replies **nothing they said was
transcribed** — their turns only landed in the gaps between replies; tap-to-interrupt worked
throughout. The client arms trigger A only when `track.getSettings().echoCancellation === "all"`
(`useLiveCall.ts` ~1240), and closes the ear (the S3 hold) otherwise. Two weeks earlier the §7-S0
sitting measured *this same phone* granting `"all"` with a genuinely subtractive canceller (played
tones pushed to −46 dBFS while the owner's voice rode through at −18 dBFS). So either the grant
degraded, or the energy floor starves — and the two have the same symptom.

**Relates to:** R74 §1.3–§1.5 (the constraint → effects-mask chain, the parent of this pass) · R74 §8
(which explicitly left `EchoCancellationModeToBooleanOrString` unread — **this dossier closes that
gap**) · R70 §4–§5 (the Speaches endpointing law) · LIVE_VOICE_PLAN §4.3 / §7-S0 ③ / §7-S4 ·
`frontend/src/hooks/useLiveCall.ts` · `frontend/src/lib/pcmCapture.ts` · `frontend/src/lib/pcmWorklet.ts`.
**Drove:** nothing yet — this is evidence for the S4 phase-gate sitting.

**Source pins (all read 2026-09-21).**

| Repo | Pin | How read |
|---|---|---|
| `chromium/chromium` | `e5554c0b194d113009b21e42bc133cfcc8679b23` (main, 2026-09-21) | raw files over https (GitHub mirror) |
| `webrtc/src` | `23df7ef65bc831dfe10c5150146bf9e6bebe7194` (main) | gitiles `?format=TEXT` + base64 |
| `platform/frameworks/base` (AOSP) | `1cdfff555f4a21f71ccc978290e2e212e2f8b168` (main) | gitiles `?format=TEXT` + base64 |
| ctrl-b live dev config | `~/.ctrl-b-dev/config.yaml` (read 2026-09-21) | local |

---

## 0. The verdict in seven lines

1. **The readback is the GRANT of the MODE, not the request echoed back (VERIFIED).**
   `EchoCancellationModeToBooleanOrString` maps the *resolved* `EchoCancellationMode`:
   `kDisabled → false`, `kBrowserDecides → true`, `kAll → "all"`, `kRemoteOnly → "remote-only"`.
   A `{ideal:"all"}` that cannot be satisfied does **not** read back `"all"` — the solver falls through
   to `kBrowserDecides` and `getSettings().echoCancellation` is the boolean `true`. **Our arming
   predicate is sound.**
2. **On Android, `"all"` is reachable only when the device's `ECHO_CANCELLER` effect bit was present
   at the moment the constraint was resolved (VERIFIED).** `kAll` is not even a candidate otherwise.
   So under *our* constraint, a boolean `true` readback on Android means the platform-AEC bit was
   **absent** ⇒ software AEC3 (`kPeerConnection`) ⇒ **nothing cancels our TTS at all** (§3.1).
3. **There are TWO independent samples of the effects mask (VERIFIED), and they are not the same
   sample.** The *mode* (⇒ the readback) is resolved from the **enumeration-time** mask; the *actual
   canceller* and the pushed effects are computed from the **open-time** mask. Chromium has a
   commented-out `CHECK` sitting exactly on the mismatch (`crbug.com/405165917`).
4. **The likeliest cause is arithmetic, not hardware.** The live dev config carries
   `voice.live.barge_threshold: 0.2`. The worklet's RMS is normalized float RMS; the app's own
   dictation meter treats **0.12 RMS as full scale**, and S0 measured the owner's voice surviving the
   AEC at **−18 dBFS ≈ 0.126 RMS**. **The floor is set ~4 dB above the loudest thing the S0 sitting
   ever measured coming through**, and it must hold for 300 ms. Trigger A cannot fire.
5. **But the floor alone does not explain "nothing was transcribed."** The floor gates only trigger A.
   Silence during replies additionally requires either the **ear-hold** (which is the exact complement
   of a failed arm — same readback, same `!== "all"`), or **R70's endpointing law** making the finals
   arrive *after* the reply, which reads to a human as "it only heard me in the gaps."
6. **"Can AEC eat the interrupt?" — for AEC3, no, because in our configuration AEC3 never sees the
   reply (VERIFIED: its render reference is `WebRtcAudioDeviceImpl::RenderData`, the PeerConnection
   playout path; an `<audio>` element is not in it). For the *platform* canceller, the honest answer
   is UNVERIFIED-but-plausible**, and AEC3's own documented double-talk math is what a vendor DSP is
   an analogue of: below the "dominant nearend" state the suppressor gain goes **linearly to zero**
   once band echo-to-nearend reaches 0.4, and on `saturated_echo` the gain floor is **literally 0**.
7. **The one field lever that needs no instrumentation** is `getCapabilities().echoCancellation` on
   the live track: it is computed from the **open-time** mask, while `getSettings()` reports the
   **enumeration-time** resolution. Comparing the two separates "the device stopped offering it" from
   "the device offered it and we did not get it".

---

## 1. Q1 — THE READBACK CONTRACT (VERIFIED)

### 1.1 The mapper R74 §8 could not read

`third_party/blink/renderer/modules/mediastream/media_stream_constraints_util_audio.cc:1657` (declared
in `media_stream_constraints_util_audio.h:77`):

```cpp
V8UnionBooleanOrString* EchoCancellationModeToBooleanOrString(
    EchoCancellationMode mode) {
  switch (mode) {
    case EchoCancellationMode::kDisabled:
      return MakeGarbageCollected<V8UnionBooleanOrString>(false);
    case EchoCancellationMode::kBrowserDecides:
      return MakeGarbageCollected<V8UnionBooleanOrString>(true);
    case EchoCancellationMode::kAll:
      return MakeGarbageCollected<V8UnionBooleanOrString>(
          String(kEchoCancellationModeAll));
    case EchoCancellationMode::kRemoteOnly:
      return MakeGarbageCollected<V8UnionBooleanOrString>(
          String(kEchoCancellationModeRemoteOnly));
  }
}
```

It is called from exactly two places, `media_stream_track_impl.cc:492` (`getCapabilities`) and
`:661` (`getSettings`):

```cpp
  if (platform_settings.echo_cancellation) {
    auto* echo_cancellation = EchoCancellationModeToBooleanOrString(
        *platform_settings.echo_cancellation);
    settings->setEchoCancellation(echo_cancellation);
  }
```

**The domain is `EchoCancellationMode` — the constraint-resolution result — and NOT
`EchoCanceller::Type` (`kNone`/`kPlatformProvided`/`kChromeWide`/`kLoopbackBased`/`kPeerConnection`),
which is the thing actually instantiated.** That distinction is the whole of Q1 and it cuts both ways;
§1.3 and §1.4 give each direction.

The value stored in `platform_settings.echo_cancellation` traces to
`user_media_processor.cc:213–224`, which feeds the source the *properties*:

```cpp
    std::optional<AudioProcessingProperties> properties =
        source_impl->GetAudioProcessingProperties();
    if (properties) {
      source->SetAudioProcessingProperties(
          properties->echo_cancellation_mode, properties->auto_gain_control, …
```

### 1.2 Is `{ideal:"all"}` + a SOFTWARE fallback still `"all"`? — **NO (VERIFIED)**

This is the load-bearing question, and the answer is clean. Two gates stand between the request and a
`"all"` readback.

**Gate ①, the candidate set** (`media_stream_constraints_util_audio.cc:1673`):

```cpp
Vector<EchoCancellationMode> GetSupportedEchoCancellationModes(
    int platform_effects, mojom::blink::MediaStreamType type) {
  Vector<EchoCancellationMode> result = {EchoCancellationMode::kBrowserDecides,
                                         EchoCancellationMode::kDisabled};
  if (RuntimeEnabledFeatures::GetUserMediaEchoCancellationModesEnabled() &&
      type == mojom::blink::MediaStreamType::DEVICE_AUDIO_CAPTURE) {
#if !BUILDFLAG(IS_ANDROID) && !BUILDFLAG(IS_IOS)
    result.push_back(EchoCancellationMode::kRemoteOnly);
#endif
    if (EchoCanceller::IsSystemWideAecAvailable(platform_effects)) {
      result.push_back(EchoCancellationMode::kAll);
    }
  }
  return result;
}
```

`IsSystemWideAecAvailable` = `IsPlatformAecAvailable(effects) || IsSystemLoopbackAsAecReferenceEnabled()`,
and the loopback arm is compiled out on Android (R74 §1.4, `media/media_options.gni`, re-verified at
this pin). ⇒ **on Android, `kAll` is a candidate iff `effects & ECHO_CANCELLER`.**

**Gate ②, the ideal fallback** (`:686–723`, `SelectBestEcMode`):

```cpp
    std::optional<EchoCancellationMode> ideal_mode =
        IdealEchoCancellationModeFromConstraint(
            constraint_set.echo_cancellation, api_);
    if (ideal_mode && candidates.Contains(*ideal_mode)) {
      return *ideal_mode;
    }
    …
      case AudioCaptureApi::kGumMicrophone:
      case AudioCaptureApi::kOther:
        if (candidates.Contains(EchoCancellationMode::kBrowserDecides)) {
          return EchoCancellationMode::kBrowserDecides;
        }
```

`ideal` is best-effort and never throws: when `kAll` is absent from the candidate set, the resolved
mode is `kBrowserDecides` and the readback is the **boolean `true`**. (`Fitness()` scores the
unsatisfied ideal 0, which only matters for ranking devices; it never forces the value.)

**⇒ `"all"` is never reported for a request that fell back.** The readback is the grant of the mode,
not an echo of the request.

### 1.3 The terminal states, as `getSettings()` reports them

| Resolved `EchoCancellationMode` | Actual `EchoCanceller::Type` on Android | `getSettings().echoCancellation` |
|---|---|---|
| `kAll` (needs the platform bit at resolution time) | `kPlatformProvided` | **string `"all"`** |
| `kBrowserDecides`, platform bit present | `kPlatformProvided` | **boolean `true`** |
| `kBrowserDecides`, platform bit absent | `kPeerConnection` (software AEC3) | **boolean `true`** |
| `kBrowserDecides`, `kChromeWide` build | `kChromeWide` | **boolean `true`** — *not reachable on Android (compiled out)* |
| `kDisabled` | `kNone` | **boolean `false`** |
| `kRemoteOnly` | `kPeerConnection` | string `"remote-only"` — *not reachable on Android* |

**The ambiguity is confined to `true`**, which cannot by itself distinguish platform AEC from software
AEC3. But *under our constraint* the ambiguity collapses: we always ask `{ideal:"all"}` on the speaker
route, so had the platform bit been present, `kAll` would have been a candidate and the ideal would
have won. **On Android Chrome ≥141, `true` in response to `{ideal:"all"}` means software AEC3** — the
arm that cancels nothing of ours (§3.1). That inference is exact for our request shape and must not be
generalized to `audio: true` captures (dictation's old shape), where `true` is genuinely ambiguous.

`RuntimeEnabledFeatures` status at this pin (`runtime_enabled_features.json5:3465`):
`name: "GetUserMediaEchoCancellationModes", status: "stable"` — unchanged since R74. And
`ShouldSupportExtendedEchoCancellationModes` additionally requires
`capture_type == AudioCaptureApi::kGumMicrophone` (`:86`): a getDisplayMedia or screen-share capture
can never read back `"all"` regardless of hardware. Ours is always a gUM microphone.

### 1.4 `getCapabilities()` is the OTHER sample — and that is the gift

`getCapabilities().echoCancellation` runs the same mapper over
`GetSupportedEchoCancellationModes(device_parameters.effects(), device.type)`, but
`user_media_processor.cc:1865` computes it from a **different** parameters object:

```cpp
  MediaStreamSource::Capabilities capabilities;
  media::AudioParameters device_parameters = audio_source->device().input;
  capabilities.echo_cancellation = GetSupportedEchoCancellationModes(
      device_parameters.effects(), device.type);
```

`audio_source->device()` is the **opened** device — its params were sampled by
`AudioInputDeviceManager::Open` (§2.1). `getSettings()`'s mode came from the **enumeration** pass.
⇒ **`getCapabilities()` vs `getSettings()` on one live track is a free, on-device, source-pinned probe
of whether the mask changed under us.** (§5's tree uses it as the first branch.)

---

## 2. Q2 — THE GRANT CONDITIONS, AND WHERE THE MASK IS SAMPLED

### 2.1 Two samples, not one (VERIFIED)

**Sample A — enumeration.** `UserMediaProcessor::SetupAudioInput` calls
`GetMediaDevicesDispatcher()->GetAudioInputCapabilities(…)` (`:799`) → the browser asks the audio
service for each device's `GetInputStreamParameters` → the effects ride back on
`AudioDeviceCaptureCapability::Parameters()` → `GetSupportedEchoCancellationModes(platform_effects, …)`
→ the candidate set → the resolved **mode** → **the readback**.

**Sample B — open.** `AudioInputDeviceManager::Open` (`content/browser/renderer_host/media/
audio_input_device_manager.cc:107`) issues `audio_system_->GetInputDeviceInfo(device.id, …)` and
latches the answer onto the session:

```cpp
  media_stream_device.input =
      input_params.value_or(media::AudioParameters::UnavailableDeviceParams());
```

That value is what the renderer then uses to build the processing layout
(`user_media_processor.cc:1931`):

```cpp
      ? std::make_optional(MediaStreamAudioProcessingLayout(
            current_request_info_->audio_capture_settings()
                .audio_processing_properties(),
            device.input.effects(),
            current_request_info_->audio_capture_settings().num_channels()))
```

→ `EchoCanceller::From(properties, available_platform_effects)` → the **actual canceller type** and the
effects mask that `MakeAudioInputStream` later tests for the `MODE_IN_COMMUNICATION` flip (R74 §1.1).

**Both samples are live JNI calls, not cached.** `AudioManagerAndroid::GetInputStreamParameters`
(`media/audio/android/audio_manager_android.cc:679`) recomputes on every invocation:

```cpp
  AudioParameters::PlatformEffectsMask effects =
      GetJniDelegate().AcousticEchoCancelerIsAvailable()
          ? AudioParameters::ECHO_CANCELLER
          : AudioParameters::NO_EFFECTS;
```

(`input_device_cache_`/`output_device_cache_` at `:605` cache device *ids/names/sample-rates* for the
AAudio per-stream path only — **not** the effects mask.)

**⇒ A stale mask CAN race a route change, in the window between sample A and sample B.** What happens
then is *not* a silent degrade: `EchoCanceller::GetSystemWideAec` holds
`CHECK(IsPlatformAecAvailable(available_platform_effects))`, so mode `kAll` meeting an empty mask at
sample B is a **renderer CHECK failure**, not a quiet fallback. Chromium knows this seam is soft —
`media_stream_audio_processing_layout.cc:56` carries the un-landed assertion verbatim:

```cpp
  // Platform echo cancellation is requested.
  // TODO(crbug.com/405165917): CHECK(platform_effects &
  // media::AudioParameters::ECHO_CANCELLER);
```

**Practical reading for the owner's phone: the A→B race would have crashed the tab, not silently
disarmed the barge.** It did not. So the race is NOT the cause here; a degraded readback means the
mask was already absent (or pinned, §2.3) at **sample A**.

### 2.2 What makes `AcousticEchoCanceler.isAvailable()` false (VERIFIED at AOSP)

`AudioManagerAndroid.java:513`:

```java
    @CalledByNative
    private static boolean acousticEchoCancelerIsAvailable() {
        return AcousticEchoCanceler.isAvailable();
    }
```

AOSP `AcousticEchoCanceler.java:50` → `AudioEffect.isEffectTypeAvailable(EFFECT_TYPE_AEC)` →
`AudioEffect.java:643`:

```java
    public static boolean isEffectTypeAvailable(UUID type) {
        AudioEffect.Descriptor[] desc = AudioEffect.queryEffects();
        if (desc == null) { return false; }
        for (int i = 0; i < desc.length; i++) {
            if (desc[i].type.equals(type)) { return true; }
        }
        return false;
    }
```

**This is a static descriptor-table query against the effects factory. It takes no route, no mode, no
device and no session.** It is re-evaluated per call but the *answer* is device-static by construction.

⇒ **A Bluetooth connect/disconnect cannot flip it. An Honor/EMUI route change cannot flip it.** The
only realistic ways it returns false on a phone that previously said true:

| Path | Persistence | Confidence |
|---|---|---|
| `queryEffects()` returns null / an empty table because the effects factory failed to load (an **audioserver crash-restart**, a HAL wedge) | until audioserver re-inits (survives Chrome restart; a **device reboot clears it**) | REPORTED — the AOSP code admits the `null` branch; not reproduced |
| Chrome < 141: the string is not parsed as a mode at all ⇒ `kBrowserDecides` ⇒ `true` | until Chrome updates | VERIFIED mechanism (R74 §1.5); the owner was on Chrome 152 at S0 |
| The mode is **pinned by an already-open source** on the same device | until that source is released | **VERIFIED — §2.3** |

### 2.3 The pin: an existing capture on the same device decides the mode for the next one (VERIFIED)

This is the degradation path that has nothing to do with the hardware, and it is the one ctrl-b can
actually cause itself. `EchoCancellationContainer`'s constructor
(`media_stream_constraints_util_audio.cc:557`):

```cpp
    const bool is_aec_reconfiguration_supported =
#if BUILDFLAG(IS_CHROMEOS)
        true;
#else
        media::IsSystemEchoCancellationEnforced() ||
        (source_info->properties().echo_cancellation_mode !=
             EchoCancellationMode::kDisabled &&
         !EchoCanceller::From(source_info->properties(),
                              device_parameters.effects())
              .IsPlatformProvided());
#endif
    if (is_full_reconfiguration_allowed && is_aec_reconfiguration_supported) {
      return;
    }

    ec_allowed_values_ = EchoCancellationModeSet(
        {source_info->properties().echo_cancellation_mode});
```

`source_info` is "the first live `ProcessedLocalAudioSource` on the same device id"
(`user_media_processor.cc:~885`). On Android:

- an existing source at `kAll`/`kBrowserDecides` **with platform AEC** ⇒ `IsPlatformProvided()` true ⇒
  reconfiguration **not** supported ⇒ **`ec_allowed_values_` collapses to the existing mode**;
- an existing source at `kDisabled` ⇒ first conjunct false ⇒ likewise collapsed to `kDisabled`.

⇒ **whatever capture opened that device first owns the echo-cancellation mode for every later capture,
and our `{ideal:"all"}` inherits it silently.** In ctrl-b that is a live hazard: streaming dictation is
ON on dev (`voice.live.dictation: true`), dictation and the call each open their own capture through
the same `micConstraints`, and the D73 S5 route knob means a capture opened while `route: headphones`
resolves **`kDisabled`** (we request `echoCancellation: false` there). A headphones-route capture that
outlives its feature — or simply overlaps a call start — makes the next speaker-route call read back
`false`, arm nothing, and hold the ear. *(R74 §7-S1 found the comm-mode analogue of this — "whichever
opened first decides". This is the stronger constraint-level version: it changes our readback, not just
the routing.)*

The readback stays **honest** under the pin (it reports the inherited mode), which is why the
instrumentation in §6 is sufficient to catch it.

### 2.4 What "platform AEC" actually is on Chromium Android today (VERIFIED)

Worth stating because it bounds §3. Chromium does **not** instantiate an `AcousticEchoCanceler`
effect object on the modern capture path. The mask does exactly two things:

1. `MakeAudioInputStream` (`audio_manager_android.cc:739`) flips the device into
   `MODE_IN_COMMUNICATION` when `params.effects() != NO_EFFECTS` (and only for the **first** input
   stream — `has_input_streams` short-circuits, R74 §7-S1);
2. `AAudioStreamWrapper::Open` (`media/audio/android/aaudio_stream_wrapper.cc:517`) picks the capture
   preset:

```cpp
    // Set AAUDIO_INPUT_PRESET_VOICE_COMMUNICATION when we need echo
    // cancellation. Otherwise, we use AAUDIO_INPUT_PRESET_GENERIC to ensure
    // standard audio routing (e.g. prioritizing USB or wired headsets over the
    // internal phone microphone).
    //
    // We do not use AAUDIO_INPUT_PRESET_UNPROCESSED, even if
    // `params_.effects() == AudioParameters::NO_EFFECTS` because the lack of
    // automatic gain control results in quiet, sometimes silent, streams.
    AAudioStreamBuilder_setInputPreset(
        builder, params_.effects() & AudioParameters::ECHO_CANCELLER
                     ? AAUDIO_INPUT_PRESET_VOICE_COMMUNICATION
                     : fallback_preset);
```

**So "platform AEC" = "the OEM's VOICE_COMMUNICATION capture pre-processing chain, in communication
mode".** Its double-talk behaviour is entirely the vendor's (Kirin 980 / EMUI 10 here) and is not
inspectable from source. Note the second-order consequence Chromium itself flags: the preset changes
the **capture gain characteristics**, which is one of two reasons the barge floor is not portable
between our two routes (§3.4).

Also VERIFIED: `AAudioInputStream` fixes `params_` at construction and a mid-stream device change
(`HandleDeviceChange`) reopens with the **same** params. The preset and the mask cannot flip under a
live stream.

---

## 3. Q3 — CAN THE AEC EAT THE INTERRUPT?

### 3.1 In our actual configuration, AEC3 eats nothing — because it hears nothing (VERIFIED)

When the resolution lands on `kPeerConnection`, the APM runs in the renderer and its far-end reference
comes from `WebRtcAudioDeviceImpl::RenderData`
(`third_party/blink/renderer/modules/webrtc/webrtc_audio_device_impl.cc:137`):

```cpp
  // Pass the render data to the playout sinks.
  for (WebRtcPlayoutDataSource::Sink* sink : playout_sinks_) {
    sink->OnPlayoutData(audio_bus, sample_rate, audio_delay);
  }
```

`AudioProcessor::OnPlayoutData` (`media/webrtc/audio_processor.cc:421`) is the only feeder of
`AnalyzeReverseStream` (`:468`). **That path carries PeerConnection playout only.** An
`HTMLMediaElement` playing chunked TTS is not a WebRTC playout sink, and the audio-service-side APM
(`kChromeWide`) — the one that *would* see the whole browser's output — is compiled out on Android.

**⇒ software AEC3 on Android neither removes our reply from the mic nor attenuates the owner over it.
It is a no-op with respect to our echo.** This is the source-level twin of R74's Fennec finding
(§7-S0 ③: Fennec's AEC measured the phone's own playback at −4.3 dBFS in the capture) and it is exactly
why the ear-hold, not a lowered floor, is the correct degrade whenever the readback is not `"all"`.

### 3.2 What the documented double-talk math says anyway (VERIFIED, as the analogue)

AEC3's suppressor is the field's best-documented statement of "what a canceller does to the near-end",
and is the right prior for an opaque vendor chain. `modules/audio_processing/aec3/suppression_gain.cc`:

```cpp
void SuppressionGain::GainToNoAudibleEcho(…) const {
  const auto& p = dominant_nearend_detector_->IsNearendState() ? nearend_params_
                                                               : normal_params_;
  for (size_t k = 0; k < gain->size(); ++k) {
    float enr = echo[k] / (nearend[k] + 1.f);  // Echo-to-nearend ratio.
    float emr = echo[k] / (masker[k] + 1.f);   // Echo-to-masker (noise) ratio.
    float g = 1.0f;
    if (enr > p.enr_transparent_[k] && emr > p.emr_transparent_[k]) {
      g = (p.enr_suppress_[k] - enr) /
          (p.enr_suppress_[k] - p.enr_transparent_[k]);
      g = std::max(g, p.emr_transparent_[k] / emr);
    }
    (*gain)[k] = g;
  }
}
```

**The gain is applied to the mixed capture signal — near-end and residual echo together. There is no
near-end preservation term.** With `api/audio/echo_canceller3_config.h:214` defaults:

| | `enr_transparent` | `enr_suppress` | meaning |
|---|---|---|---|
| `normal_tuning` (LF) | **0.3** | **0.4** | attenuation starts when the echo reaches 30 % of the near-end; gain hits **0** at 40 % |
| `nearend_tuning` (LF) | **1.09** | **1.1** | near-transparent — but only while "dominant nearend" holds |

Entering the permissive state is deliberately hard (`dominant_nearend_detector.cc:53`, defaults at
`echo_canceller3_config.h:237`): the near-end must exceed the residual echo by **4×**
(`enr_threshold = .25`) *and* the noise floor by **30×** (`snr_threshold = 30`), sustained for
`trigger_threshold = 12` blocks. At `kNumBlocksPerSecond = 250` that is **48 ms** of *already-winning*
near-end before the tuning relaxes, and `hold_duration = 50` ⇒ 200 ms of hold, with an early exit at
`enr_exit_threshold = 10`.

And the hard floor, `GetMinGain`:

```cpp
  if (!saturated_echo) {
    const float min_echo_power = low_noise_render
        ? echo_audibility_config_.low_render_limit    // 4 * 64.f
        : echo_audibility_config_.normal_render_limit; // 64.f
    for (size_t k = 0; k < min_gain.size(); ++k) {
      min_gain[k] = weighted_residual_echo[k] > 0.f
                        ? min_echo_power / weighted_residual_echo[k] : 1.f;
      …
  } else {
    std::fill(min_gain.begin(), min_gain.end(), 0.f);
  }
```

**`saturated_echo` ⇒ the minimum gain is zero: the capture is muted.** A phone loudspeaker at call
volume, centimetres from its own mic, is the textbook producer of saturated echo. Recovery is also
rate-limited — `GetMaxGain` caps growth at `max_inc_factor = 2.0` per block from
`floor_first_increase = 0.00001f`, so even after the near-end wins, the first syllables come back
attenuated.

**Verdict (Q3):** *"the AEC can eat the interrupt"* is **true in general and documented in the
numbers**, is **false for AEC3 in our configuration** (§3.1 — no reference, so `enr ≈ 0`, so `g ≈ 1`),
and is **UNVERIFIED-but-live for the platform chain on the speaker route**, where the far-end is a
loudspeaker and the near-end is speech. S0's measurement is reassuring but not decisive: it pushed
**tones**, and a speech far-end is the case every double-talk detector finds hardest. *(§7.)*

### 3.3 The one hard number we already own

S0 (§7-S0 ③, this device, 2026-09-12): control leak 53.7 dB; under `{ideal:"all"}` the played tones
came back at **−46 dBFS** while the owner's voice rode through at **−18 dBFS broadband** (vs −13.8
dBFS raw). ⇒ the canceller gave ~28 dB of discrimination and cost the near-end ~4 dB. **−18 dBFS is
0.126 normalized RMS** — and that is a *broadband talk-through* figure, so per-40 ms frame RMS across
real speech (with its syllable gaps) sits below it much of the time. This is the number §4 measures the
configured floor against.

### 3.4 The floor is not portable between routes (VERIFIED)

Two independent reasons the same `barge_threshold` means different things on `speaker` vs `headphones`:

1. **The capture preset differs** — `VOICE_COMMUNICATION` vs `GENERIC` (§2.4), and Chromium's own
   comment says the unprocessed presets produce "quiet, sometimes silent, streams" for want of AGC.
2. **Our software AGC silently follows the EC constraint.**
   `AudioProcessingProperties` defaults are `auto_gain_control = true; noise_suppression = true`
   (`media_stream_audio_processor_options.h:68`), and
   `EchoCancellationContainer::UpdateDefaultValues` (`:639`) does
   `properties->auto_gain_control &= GetDefaultValueForAudioProperties(ec_constraint);`, which is
   **false when the ideal EC mode is `kDisabled`**. We pass no `autoGainControl` constraint, so:
   **`route: speaker` ⇒ AGC ON; `route: headphones` (`echoCancellation: false`) ⇒ AGC OFF.**
   (`noiseSuppression: true` survives, because we state it explicitly and the explicit constraint is
   applied after the default — `:1155`.)

⇒ **The S4 sitting must calibrate the floor per route**, and the overlay must show which route the
number was taken under. A single global `barge_threshold` calibrated on headphones will be wrong on
speaker and vice-versa.

---

## 4. The arithmetic on the owner's live configuration (VERIFIED, ctrl-b side)

The dev instance the 2026-09-21 round ran against (`~/.ctrl-b-dev/config.yaml`):

```yaml
  live:
    dictation: true
    enabled: true
    route: speaker
    barge_threshold: 0.2
```

Everything else defaults (`backend/app/config.py`): `barge_in: true`, `min_speech_ms: 300`,
`echo_workaround: auto`, `input_device: ""`; `stt.auto_stop_threshold` is unset ⇒ 0.01. *(Prod has no
`voice.live` block at all — this round was dev-only.)*

The floor trigger A measures against is `knobs.barge_threshold || stt_auto_stop.threshold`
(`useLiveCall.ts:1141`) ⇒ **0.2**, not the 0.01 the code's `0 = reuse` precedent describes. The value
compared to it is the capture worklet's own frame RMS over float samples
(`pcmWorklet.ts:73`, `Math.sqrt(sum / n)`), sustained for `min_speech_ms` = 300 ms.

| Quantity | Normalized RMS | dBFS |
|---|---|---|
| `stt.auto_stop_threshold` (proven in use: dictation's idle stop) | 0.01 | −40 |
| **`METER_FULL_RMS`** — the app's own "meter pegged" mark (`useDictation.ts:109`) | **0.12** | −18.4 |
| S0's measured through-AEC talk-through level | ≈0.126 | −18 |
| **the configured `barge_threshold`** | **0.20** | **−14.0** |

**The floor is set above the app's own full-scale meter mark and ~4 dB above the loudest through-AEC
speech S0 ever measured on this phone, and it must hold for 300 consecutive milliseconds.** On the
arithmetic alone, trigger A cannot fire on this configuration even with a perfect grant and a perfect
canceller. This is candidate #1, and it is free to test.

**What it does NOT explain:** silence in the transcript. `floor <= 0`/`rms < floor` only zeroes
`sustained.current` (`useLiveCall.ts:1194`); the frames still go up the uplink. So a starved floor
alone predicts *"the reply keeps talking over me, but my words still arrive"* — which is a different
symptom from the one reported, and the discriminator in §5.

---

## 5. THE DIAGNOSIS TREE — "voice barge dead on the speaker route"

Read top-down. Every branch names the observable on the owner's phone and the fix it implies. The
first split needs **no instrumentation at all**.

```
Q: during a reply, did the owner's words reach the transcript AT ALL
   (even late, landing as a turn just after the reply ended)?
│
├─ NO — nothing, ever, from that stretch ─────────────────────────► the EAR WAS SHUT
│   │   (a held track is silence; Speaches cannot endpoint silence, and the reducer
│   │    drops `speechStart`/`speechStop`/`final` flat while `earHeld` — useLiveCall.ts:562/566/589)
│   │
│   ├─ B1  getSettings().echoCancellation !== "all"   ⇒ THE GRANT DEGRADED.
│   │      Both halves fall out of the one readback: bargeArmed=false AND earHoldMode=true
│   │      (useLiveCall.ts:1240/1247). This is the single fact that explains BOTH symptoms.
│   │      Sub-split on getCapabilities().echoCancellation (§1.4 — the OPEN-time mask):
│   │
│   │      ├─ B1a  capabilities DOES include "all", settings says `false`
│   │      │        ⇒ THE MODE WAS PINNED by a live source on the same device (§2.3) —
│   │      │          almost certainly a `route: headphones` capture (EC:false) or a leaked
│   │      │          dictation stream that opened first.
│   │      │        FIX: make capture ownership exclusive — the call must not open beside a
│   │      │          live dictation source on the same device; tear the other one down first,
│   │      │          or share one capture. A constraint change cannot repair it.
│   │      │
│   │      ├─ B1b  capabilities DOES include "all", settings says `true`
│   │      │        ⇒ the ideal was not applied: either Chrome <141 (the string never parsed)
│   │      │          or the pin landed on a kBrowserDecides source.
│   │      │        FIX: check the Chrome major first (free); else as B1a.
│   │      │
│   │      └─ B1c  capabilities does NOT include "all"
│   │               ⇒ THE PLATFORM AEC BIT IS GONE at open time. Per §2.2 a route/BT transition
│   │                 cannot do this; the live candidate is an effects-factory/audioserver wedge.
│   │               DISCRIMINATOR: reboot the phone and re-read. Returns ⇒ transient HAL state;
│   │                 persists ⇒ the device genuinely no longer reports AEC and S0's measurement
│   │                 is void.
│   │               FIX: none available to the app. Accept tap-only on the speaker route
│   │                 (`barge_in` reads as unavailable, not merely off) and say so in the overlay.
│   │
│   └─ B2  getSettings().echoCancellation === "all", yet still nothing transcribed
│          ⇒ the ear was OPEN and the platform canceller ATE THE NEAR-END (§3.2's mechanism,
│            vendor chain). Speech that never clears Silero's 0.9 threshold is never endpointed.
│          DISCRIMINATOR: the live worklet RMS trace. Speak at normal volume over a reply and
│            watch the peak frame RMS: ≥ ~0.05 ⇒ the audio is there and this is not B2;
│            collapsing toward the noise floor the instant playback starts ⇒ it is.
│          FIX: lowering the floor cannot recover a signal that was suppressed to the noise
│            floor. The honest answers are (i) force `echo_workaround: on` for the speaker
│            route so the ear at least stops pretending, and (ii) treat the speaker route as
│            tap-only on this device. A "headphones" round settles whether the phone is at
│            fault or the route is.
│
└─ YES — the words arrived, but late: as a turn landing after the reply ────────► THE EAR WAS FINE
    │   (this is the branch that *feels* like "it only heard me in the gaps")
    │
    ├─ C1  THE FLOOR STARVED — the barge never fired, so the reply was never killed, and the
    │       transcript simply arrived on its own schedule.  **Ranked #1 on today's config.**
    │      DISCRIMINATOR: `barge_threshold` 0.2 vs a live peak frame RMS that S0 says tops out
    │        near 0.126. Show both numbers side by side and it is self-evident.
    │      FIX: recalibrate on-device in the S4 sitting — read the peak sustained RMS while the
    │        owner speaks over a reply, set the floor at ~40–50 % of it, PER ROUTE (§3.4).
    │        Then re-test: `min_speech_ms` 300 may also want shortening once the floor is right.
    │
    ├─ C2  R70'S ENDPOINTING LAW — the arrival was always going to be late.
    │      Silero runs over the last 3 s only and cannot emit `speech_stopped` before the buffer
    │      exceeds 3000 ms: latency = max(silence_ms, 3000 − phrase_ms) + ~0.5 s. A two-word
    │      interjection over a reply therefore cannot land for ~3.5 s — by which time the reply
    │      has finished and the turn looks like a "gap" turn.
    │      DISCRIMINATOR: measure speech-end → turn-appears. ~3.5 s for short phrases ⇒ C2.
    │      NOTE: C2 does not stop trigger A. Trigger A is client-side energy and fires in
    │        `min_speech_ms`; it never waits for a transcript. So C2 rides *on top of* C1 —
    │        it explains the feel, C1 explains the dead interrupt.
    │
    └─ C3  THE MOUTH GATE — `bargeArmed && floor>0 && mouthLive` (useLiveCall.ts:1194).
           If `mouthLive` were false while the reply was audible, trigger A would idle.
           DISCRIMINATOR: the overlay phase vs audible reply, and `mouthLive` shown raw.
           Ranked LAST: the S3 wave made `mouthLive` a synchronous store subscription off C3's
           own `play` event, and a false `mouthLive` would ALSO have left the ear-hold open —
           which contradicts the "nothing transcribed" arm. Included for completeness.
```

**Ranking of the grant-degradation candidates (B1), most to least likely:**

1. **B1a — the mode pinned by a concurrent/leaked capture** (§2.3). The only path ctrl-b can cause
   itself, and dev has both features on with a route knob that requests `false` on one of them.
2. **B1b — Chrome major / pinned-to-`kBrowserDecides`.** Free to check and would be embarrassing to
   miss.
3. **B1c — the effects table genuinely lost AEC.** Mechanically possible only via an audioserver /
   effects-factory failure; no route or BT transition reaches it (§2.2).
4. **The A→B mask race.** Ranked lowest and near-excluded: it CHECK-crashes the renderer rather than
   degrading (§2.1), and no crash was reported.

---

## 6. Q4 — FIELD PRACTICE, AND THE MINIMAL DEBUG SET

### 6.1 What the browser gives you on the phone

| Surface | What it shows | Confidence |
|---|---|---|
| **`chrome://media-internals`** (Android: yes) | For every created audio stream, `MediaInternals::AudioLogImpl::OnCreated` writes `dict.Set("effects", EffectsToString(params.effects()))` (`content/browser/media/media_internals.cc:248`) → the literal string `ECHO_CANCELLER` or `NO_EFFECTS`, plus sample rate / frames-per-buffer. **This is ground truth for sample B**, on-device, no adb. | **VERIFIED in source** |
| `chrome://webrtc-internals` → "getUserMedia Requests" | The **requested** constraints (`dict.Set("audio", audio_constraints)`, `webrtc_internals.cc:358`), plus `audio_track_info` on success and the error on failure. Useful to confirm the page asked what you think it asked; it is not the grant. | VERIFIED in source |
| `chrome://webrtc-internals` → getStats audio levels | **Not available to us** — there is no `RTCPeerConnection` in ctrl-b's voice path, so `audioLevel`/`totalAudioEnergy` do not exist. Every peer recipe that says "watch `audioLevel`" assumes a PC. | VERIFIED (by construction) |
| `blink::WebRtcLogMessage` breadcrumbs — `PLAS::EnsureSourceIsStarted() => (Modified system effect mask from [X] to [Y])` (`processed_local_audio_source.cc:191`), and the `NS will run in tandem` / `AGC will run in tandem` lines | Exactly the mask transition we care about, but these go to the WebRTC **text** log, not the live webrtc-internals view. | mechanism VERIFIED; on-device reachability UNVERIFIED |

### 6.2 What a PWA can read at runtime — the recommended minimal set

Everything below is a synchronous property read on a live track (plus one number we already compute),
so it costs nothing and needs no new capture. **Recommendation: a long-press-to-reveal diagnostics
block in the call overlay, and the same object dumped to `console.info` once per call start.**

| Field | Source | Which branch it decides |
|---|---|---|
| `settings.echoCancellation` (raw: the string or the boolean, never coerced) | `track.getSettings()` | **B1 vs B2/C** — the single top split. Print it typed: `"all"` and `true` must be visually distinguishable. |
| `capabilities.echoCancellation` (the whole array) | `track.getCapabilities()` | **B1a/b vs B1c** — the open-time mask (§1.4). The one free stale/pin probe. |
| `settings.autoGainControl`, `settings.noiseSuppression` | `track.getSettings()` | confirms §3.4's route-dependent AGC, which is why a floor calibrated on one route is wrong on the other |
| `settings.deviceId` + `track.label` + `fellBack` | already carried (`pcmCapture.ts:405`) | which route actually opened |
| `route`, `echo_workaround`, `barge_in`, `barge_threshold`, `min_speech_ms` — the **effective** values | the latched `knobs` | **C1** — the floor must be legible beside the signal, or the arithmetic stays invisible |
| **live frame RMS**: instantaneous + a rolling peak-over-2 s, with the floor drawn as a line | the worklet frame we already have | **C1 vs B2** — the whole calibration. Without a peak hold the owner cannot see a floor they never reach. |
| `bargeArmed`, `earHoldMode`, `earHeld`, `mouthLive`, `sustained` (ms accrued) | `useLiveCall` state | **C3**, and it makes the arm/hold complementarity visible |
| `track.readyState` / `track.muted` (the *browser's* muted, not ours) | `track` | catches an OS-level mic steal, which looks identical to everything above |

**Design notes.** (a) `bargeArmed`/`earHoldMode` are the same readback read twice — render them
*together* so a viewer sees they can never disagree; a screen that showed them independently would
invite a future fix that sets one without the other, which is the defect S3 already closed. (b) The
RMS/floor pair is the one thing that must be a *graph*, not a number: the whole C1 diagnosis is "the
line is above the hill". (c) Log it once at call start rather than streaming it — the per-frame
callback is on the hot path, and the S4 sitting is an eyeball round, not a telemetry run.

---

## 7. What I could not determine

- **Which branch the owner's phone is actually on.** No phone in this session. The tree is built so
  the first split needs only the transcript the owner already saw, and the rest needs only §6.2's
  read-only fields.
- **What the Honor 20 / EMUI 10 `VOICE_COMMUNICATION` chain does to the near-end under a *speech*
  far-end.** The chain is closed-source and not in AOSP; §3.2's numbers are AEC3's, offered as the
  documented analogue, not as a claim about this DSP. S0's −18 dBFS talk-through used **tones**, which
  is the easy case for a double-talk detector.
- **Whether `queryEffects()` can actually come back without AEC on a running Honor 20.** The AOSP code
  has the `null`/absent branch, but I found no reproduction and no bug report for this device class.
  The reboot probe in B1c is the cheapest way to settle it.
- **Where `barge_threshold: 0.2` came from.** The dev `config.yaml` is untracked, so there is no
  history; it is neither the schema default (0.0) nor the documented reuse value (0.01). It may be an
  owner experiment from an earlier sitting. Worth asking before overwriting it.
- **Whether `PLAS::…` `WebRtcLogMessage` breadcrumbs are readable on Android without a log upload.**
  Mechanism verified, reachability not probed; `chrome://media-internals` makes the question moot for
  the one value that matters.
- **Whether `getCapabilities()` is populated at all on the owner's Chrome for audio tracks.** The code
  path is unconditional at this pin, but MDN/BCD coverage for audio-track capabilities has historically
  been uneven; the §6.2 dump should print `undefined` honestly rather than defaulting.

---

## 8. Implications for ctrl-b

*(Short and separate, per the folder's convention. The evidence above ages slowly; this reading ages
fast. Nothing here is a ruling — these are proposals for the S4 gate.)*

**Before anything else, at the S4 sitting:**

1. **Read the floor before touching the code.** `barge_threshold: 0.2` against a 0.12 full-scale meter
   is a one-line explanation for a dead trigger A, and it is the only candidate that costs nothing to
   eliminate. Set it from a measurement, not a guess — and record which route the measurement was
   taken under (§3.4).
2. **Ship §6.2's diagnostics block before the sitting, not after.** The sitting is the owner's
   afternoon and the phone; arriving without the readback on screen spends it re-deriving what a
   `console.info` would have said in one second. It is read-only state we already hold.
3. **Run the round on BOTH routes.** The headphones route resolves `kDisabled` → no platform AEC, no
   AGC, `GENERIC` preset, and (by D73 S5) no ear-hold — a completely different signal chain. If barge
   works there and not on speaker, the answer is B2 and the speaker route is honestly tap-only.

**Two code questions this pass raises, both for the main seat to rule on:**

4. **Capture exclusivity (§2.3).** A live dictation source pins the call's echo-cancellation mode, and
   with the D73 route knob the two features can now *disagree* about what they asked for. Today
   nothing prevents a `route: headphones` capture from deciding a `route: speaker` call's AEC. The
   cheap guard is "the call refuses to open beside another live capture on the same device"; the right
   one is probably one owned capture the two features share. Either way it belongs in the design
   before it is a field bug — the readback stays honest, so the failure is silent-but-visible rather
   than loud.
5. **`barge_threshold` is one knob for two signal chains.** §3.4 shows the same number means different
   things per route. Either the floor becomes route-keyed, or the Conf row says out loud which route
   it was calibrated for. Per the standing "extend, don't migrate" directive this is an additive field
   on the existing `live` object, not a second map.

**What this pass explicitly does NOT support:**

- **Lowering the floor as a blind fix.** If the cause is B1 or B2, the frames are silence or
  suppressed-to-noise, and any floor low enough to fire on them is low enough to fire on the reply's
  own leakage — which is the exact failure the ear-hold exists to prevent.
- **Re-requesting constraints mid-call / `applyConstraints` to "get `all` back".** The mode is pinned
  by the live source for the device (§2.3) and `applyConstraints` on an AEC-using Android source
  cannot reconfigure it; the round-trip would report success on a set it never widened.
- **UA-sniffing or version-gating the arm.** The readback is the honest per-track fact and it is now
  fully source-verified. Keep arming off it.
