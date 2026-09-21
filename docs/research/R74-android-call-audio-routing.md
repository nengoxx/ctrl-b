# R74 — Android call audio: output routing, mic selection, and the communication-mode trap

**Date: 2026-09-21 · Confidence: the mechanism is VERIFIED in Chromium + Gecko source read at the
pins below; the field pass is VERIFIED from source at the recorded SHAs; the device-level outcomes on
the owner's phone are UNVERIFIED (no phone in this session) and are called out individually.**

**Question (one):** on Android browsers (Chrome/Chromium primary, Fennec secondary) how does a web
voice-call app (a) get its TTS onto the right device (BT headphones when worn, speaker otherwise),
(b) select the microphone input including a BT headset mic, and (c) avoid the communication-audio-mode
trap — and what does the field actually ship?

**Occasion:** the owner's device round — with BT headphones connected, in-call TTS played through the
**phone speaker, badly distorted**, while the app was focused; on half-leaving the app (app switcher)
the audio flipped to the headphones and sounded good. The owner asked for "an output selector like
ChatGPT's call mode has", and ideally an input selector too.

**Relates to:** LIVE_VOICE_PLAN §4.1 (the call's constraints) · §5.1 (`echo_workaround` / the ear-hold)
· R51 §6.1 (dictation passes no constraints) · R68 (the live-voice delta pass) ·
`frontend/src/lib/pcmCapture.ts` · `frontend/src/lib/audioController.ts`. **Drove:** nothing yet — this
is evidence for the S4 phase-gate round.

**Source pins (all read 2026-09-21).**

| Repo | Pin | How read |
|---|---|---|
| `chromium/chromium` | `c52f26bf4995` (main, 2026-09-21) | raw files over https |
| `mozilla-firefox/firefox` | `ef081a87e9d3` (main, 2026-09-20) | raw files + searchfox `firefox-main` |
| `mdn/browser-compat-data` | `9718e95071e5` (2026-09-18) | raw JSON |
| `jitsi/jitsi-meet` | `efd3d3f35431` (2026-09-20) | shallow clone |
| `jitsi/lib-jitsi-meet` | `b4912d28b4da` (2026-09-18) | raw file |
| `livekit/client-sdk-js` | `9b8caa12dc3a` (2026-09-18) | shallow clone |
| `element-hq/element-call` | `9f7c35cd8f84` (2026-09-21) | shallow clone |
| `open-webui/open-webui` | `0a7c15832fb3` (2026-09-05) | shallow clone |
| `danny-avila/LibreChat` | `0cc52cd8c71e` (2026-09-20) | shallow clone |

---

## 0. The verdict in six lines

1. The working hypothesis is **CONFIRMED at source level, with one correction**: it is not "requesting
   AEC opens the mic as VOICE_COMMUNICATION"; it is that **requesting any echo cancellation that
   Chromium decides to satisfy with the device's *platform* AEC leaves `ECHO_CANCELLER` in the stream's
   effects mask, and Chromium then puts the whole device into `MODE_IN_COMMUNICATION` and re-tags its
   own output streams as `AAUDIO_USAGE_VOICE_COMMUNICATION`.** Releasing the last input stream restores
   `MODE_NORMAL` — which is exactly why stopping capture brings A2DP back.
2. `echoCancellation: false` **is** the escape, and it is enough on its own: Android's platform-effects
   mask only ever contains `ECHO_CANCELLER`, so clearing AEC empties the mask (`NO_EFFECTS`) and the
   mode switch is skipped. `noiseSuppression: true` can stay (it runs in software).
3. **`audio: true` is not neutral** — an unconstrained request resolves to `kBrowserDecides` → platform
   AEC → the same trap. Our dictation path (no constraints) is in it too.
4. **There is no output-device selection on Android Chrome, by design, and no hidden alternative.**
   `AudioOutputDevices` is explicitly disabled on Android in Chromium's own feature list, and
   `getAudioOutputDeviceNames()` on Android returns *only* "default".
5. **The input picker IS the route picker.** Android Chrome's `enumerateDevices()` audioinput list is
   the list of Android *communication devices* — "Speakerphone", "Wired headset", "Headset earpiece",
   "Bluetooth headset", "USB audio" — and selecting one calls `AudioManager.setCommunicationDevice()`,
   which the Android docs define as selecting an **output (sink)** device whose matching mic is chosen
   automatically. That is the only web-reachable routing lever on Android.
6. **The owner's premise is wrong in a useful way:** ChatGPT's voice mode has no output selector on web
   *or* on iOS — it is an open feature request dated **2026-09-14**, and the ChatGPT app has the *same*
   BT-routing bug, acknowledged by OpenAI staff in 2024. Nobody in the field ships an Android-web output
   selector; Element Call ships one only by handing the job to a native host app.

---

## 1. The mechanism, verified in Chromium source

### 1.1 The mode switch and its trigger (VERIFIED)

`media/audio/android/audio_manager_android.cc`, `MakeAudioInputStream`:

```cpp
  // Avoid changing the communication mode if there are existing input streams.
  if (!stream || has_input_streams || UseAAudioPerStreamDeviceSelection()) {
    return stream;
  }

  // By default, the audio manager for Android creates streams intended for
  // real-time VoIP sessions and therefore sets the audio mode to
  // MODE_IN_COMMUNICATION. However, the user might have asked for a special
  // mode where all audio input processing is disabled, and if that is the case
  // we avoid changing the mode.
  if (params.effects() != AudioParameters::NO_EFFECTS) {
    communication_mode_is_on_ = true;
    GetJniDelegate().SetCommunicationAudioModeOn(true);
  }
  return stream;
```

and the reverse, in `ReleaseInputStream`:

```cpp
  // Restore the audio mode which was used before the first communication-
  // mode stream was created.
  if (HasNoAudioInputStreams() && communication_mode_is_on_) {
    communication_mode_is_on_ = false;
    GetJniDelegate().SetCommunicationAudioModeOn(false);
  }
```

The Java side (`media/base/android/java/src/org/chromium/media/AudioManagerAndroid.java`) is literally
`mAudioManager.setMode(AudioManager.MODE_IN_COMMUNICATION)` / `setMode(AudioManager.MODE_NORMAL)`, with
the note that the mode change needs `MODIFY_AUDIO_SETTINGS` (*"MODIFY_AUDIO_SETTINGS is missing =>
client will run with reduced functionality"*).

### 1.2 Why that makes the TTS come out of the earpiece/speaker (VERIFIED)

Chromium tags **its own playback streams** by the mode that was live *when the stream was created* —
`MakeLowLatencyOutputStream`:

```cpp
    const aaudio_usage_t usage = communication_mode_is_on_
                                     ? AAUDIO_USAGE_VOICE_COMMUNICATION
                                     : AAUDIO_USAGE_MEDIA;
```

and, on the OpenSLES path:

```cpp
  // Set stream type which matches the current system-wide audio mode used by
  // the Android audio manager.
  const SLint32 stream_type = communication_mode_is_on_
                                  ? SL_ANDROID_STREAM_VOICE
                                  : SL_ANDROID_STREAM_MEDIA;
```

A `VOICE_COMMUNICATION`-usage stream is routed by Android's policy to the **communication** device —
earpiece/speaker, or a BT **SCO/HFP** link if one is up — never to A2DP. That is the distortion the
owner heard: voice-call-path processing and the voice-call volume curve, out of the handset speaker.

### 1.3 The constraint → effects-mask chain (VERIFIED, and it corrects the hypothesis)

The mask that `MakeAudioInputStream` tests is computed in the renderer and pushed onto the device
params. `third_party/blink/renderer/modules/mediastream/processed_local_audio_source.cc`:

```cpp
  if (processing_layout_.platform_effects() != device().input.effects()) {
    …
    blink::MediaStreamDevice modified_device(device());
    modified_device.input.set_effects(processing_layout_.platform_effects());
    SetDevice(modified_device);
  }
```

`third_party/blink/renderer/modules/mediastream/media_stream_audio_processing_layout.cc`:

```cpp
int ConfigureEchoCancellationEffects(const EchoCanceller& echo_canceller,
                                     bool ns_requested, bool agc_requested,
                                     int enabled_platform_effects) {
  if (!echo_canceller.IsPlatformProvided()) {
    // No platform processing if platform AEC is not requested.
    enabled_platform_effects &= ~media::AudioParameters::ECHO_CANCELLER;
    enabled_platform_effects &= ~media::AudioParameters::AUTOMATIC_GAIN_CONTROL;
    if (!IsIndependentSystemNsAllowed()) { … }
    return enabled_platform_effects;
  }
```

and the *available* mask on Android only ever has one bit in it —
`AudioManagerAndroid::GetInputStreamParameters`:

```cpp
  AudioParameters::PlatformEffectsMask effects =
      GetJniDelegate().AcousticEchoCancelerIsAvailable()
          ? AudioParameters::ECHO_CANCELLER
          : AudioParameters::NO_EFFECTS;
```

(`acousticEchoCancelerIsAvailable()` = `android.media.audiofx.AcousticEchoCanceler.isAvailable()`.)

**⇒ On Android the whole trap reduces to one bit.** If the selected echo canceller is
"platform-provided", the mask keeps `ECHO_CANCELLER` and the mode flips. If it is not, the mask goes to
zero — because `NOISE_SUPPRESSION`/`AUTOMATIC_GAIN_CONTROL` are never in Android's available set in the
first place — and the mode is left alone. **`noiseSuppression`/`autoGainControl` are therefore
irrelevant to the trap on Android**; they resolve to software WebRTC processing in the renderer. (That
is the correction to the hypothesis: the trigger is the *effects mask*, not the `AudioSource` constant;
Chromium's Android capture no longer has a `VOICE_COMMUNICATION`/`MIC`/`UNPROCESSED` switch at the
`AudioRecord` level at all — `AudioRecordInput.java` is gone, replaced by OpenSLES/AAudio.)

### 1.4 Which constraint picks "platform-provided" (VERIFIED)

`third_party/blink/renderer/platform/mediastream/media_stream_audio_processor_options.cc`:

```cpp
      case EchoCancellationMode::kDisabled:      return Type::kNone;
      case EchoCancellationMode::kBrowserDecides: return GetPreferredAec(available_platform_effects);
      case EchoCancellationMode::kRemoteOnly:     return Type::kPeerConnection;
      case EchoCancellationMode::kAll:            return GetSystemWideAec(available_platform_effects);
…
EchoCanceller::Type EchoCanceller::GetPreferredAec(int available_platform_effects) {
  if (media::IsSystemLoopbackAsAecReferenceForcedOn()) { return Type::kLoopbackBased; }
  if (IsPlatformAecAvailable(available_platform_effects)) {
    // Platform AEC effect is only exposed on the platforms where platform echo
    // cancellation is either a default behavior or enforced via a feature flag…
    return Type::kPlatformProvided;
  }
  if (media::IsChromeWideEchoCancellationEnabled()) { return Type::kChromeWide; }
  return Type::kPeerConnection;
}

EchoCanceller::Type EchoCanceller::GetSystemWideAec(int available_platform_effects) {
  if (media::IsSystemLoopbackAsAecReferenceEnabled()) { return Type::kLoopbackBased; }
  // See IsSystemWideAecAvailable().
  CHECK(IsPlatformAecAvailable(available_platform_effects));
  return Type::kPlatformProvided;
}
```

`media/media_options.gni` settles what is reachable on Android:

```gn
declare_args() {
  # Currently it is available on Win, Mac and Linux, since it requires the audio
  # service to run in a separate process.
  chrome_wide_echo_cancellation_supported = is_win || is_mac || is_linux
}
declare_args() {
  system_loopback_as_aec_reference_supported =
      (is_win || is_mac) && chrome_wide_echo_cancellation_supported
}
```

**⇒ On Android both `kLoopbackBased` and `kChromeWide` are compiled out.** So:

| Constraint | Resolved mode | AEC type on a phone with HW AEC | Effects mask | `MODE_IN_COMMUNICATION`? |
|---|---|---|---|---|
| `echoCancellation: {ideal:"all"}` (ours) | `kAll` | `kPlatformProvided` | `ECHO_CANCELLER` | **YES** |
| `echoCancellation: true` | `kBrowserDecides` | `kPlatformProvided` | `ECHO_CANCELLER` | **YES** |
| `audio: true` (no constraints) | `kBrowserDecides` (default pick, see below) | `kPlatformProvided` | `ECHO_CANCELLER` | **YES** |
| `echoCancellation: false` | `kDisabled` | `kNone` | `NO_EFFECTS` | **no** |
| any of the above, on a phone whose `AcousticEchoCanceler.isAvailable()` is false | — | `kPeerConnection` (software AEC3) | `NO_EFFECTS` | **no** |

The "no constraints ⇒ still AEC" arm, `media_stream_constraints_util_audio.cc`:

```cpp
      case AudioCaptureApi::kGumMicrophone:
      case AudioCaptureApi::kOther:
        if (candidates.Contains(EchoCancellationMode::kBrowserDecides)) {
          return EchoCancellationMode::kBrowserDecides;
        }
```

### 1.5 `echoCancellation: "all"` is real, stable, and gated at Chrome 141 (VERIFIED)

The string form is a genuine constraint value, not a WebIDL accident:

```cpp
const char kEchoCancellationModeAll[] = "all";
const char kEchoCancellationModeRemoteOnly[] = "remote-only";
```
```cpp
  if (ShouldSupportExtendedEchoCancellationModes(api)) {
    CHECK(constraint.HasIdealString());
    String mode = constraint.IdealString();
    …
    if (mode == kEchoCancellationModeAll) { return EchoCancellationMode::kAll; }
  }
```
gated on `RuntimeEnabledFeatures::GetUserMediaEchoCancellationModesEnabled()` and on the capture being
a gUM microphone. `runtime_enabled_features.json5`: `name: "GetUserMediaEchoCancellationModes", status:
"stable"`. chromestatus feature **5585747985563648** ("echoCancellationMode for getUserMedia()"):
`desktop: 141, android: 141, webview: 141, ios: 141`; spec
`https://www.w3.org/TR/mediacapture-streams/#dom-echocancellationmodeenum`.

Note also (`media_stream_constraints_util_audio.cc`): *"`kRemoteOnly` is not supported on mobile
platforms"* — `#if !BUILDFLAG(IS_ANDROID) && !BUILDFLAG(IS_IOS)`. On Android the candidate set is
`{kBrowserDecides, kAll (if system-wide AEC available), kDisabled}`.

**Consequence for us:** on Android Chrome ≥141 our `{ideal:"all"}` resolves to `kAll` →
`kPlatformProvided` → comm mode. On Chrome <141 the string was not parsed as a mode at all and the
request degraded to `kBrowserDecides` → *also* `kPlatformProvided` → comm mode. Both arms of our
readback are inside the trap; only `false` is outside it.

---

## 2. What a page can actually select on Android Chrome

### 2.1 Output: nothing (VERIFIED)

`runtime_enabled_features.json5`, verbatim:

```json5
    {
      name: "AudioOutputDevices",
      // Android support for switching audio output devices is not stable
      status: {"Android": "", "default": "stable"},
      public: true,
      base_feature: "none"
    },
```
```json5
      // SelectAudioOutput API
      // https://chromestatus.com/feature/5164535504437248
      name: "SelectAudioOutput",
      status: { "Android": "", "default": "test" },
```

MDN BCD (`api/HTMLMediaElement.json`) for both `setSinkId` and `sinkId`:
`chrome_android: {"version_added": false, "notes": "Not available due to a limitation in Android, see
bug 41276355"}`; `firefox_android: {"version_added": false, … "bug 1473346"}`. (BCD lists
`AudioContext.setSinkId` as `chrome_android: "mirror"` — that is BCD's *automatic* desktop mirroring,
not a measurement, and it contradicts the Chromium flag above. Treat it as wrong until probed.)

And Chromium does not even have devices to offer — `AudioManagerAndroid::GetAudioOutputDeviceNames`:

```cpp
  // We've only returned "default" here for quite some time, relying on output
  // device selection being controlled by input device selection (see
  // `GetAudioInputDeviceNames`). Populating this list with other devices has
  // prevented confusion for users; it would've given them the option to set a
  // different input and output device, which wouldn't actually work.
  AddDefaultDevice(device_names);
```

There is no `navigator.audioSession` in Chromium (no such runtime feature exists in
`runtime_enabled_features.json5`) — the Audio Session API is a WebKit thing. `SpeakerSelection`
(the `speaker-selection` permission) is `status: "experimental"` and is a permission *for* the Audio
Output Devices API, which is off on Android anyway.

### 2.2 Input: yes — and it is the *route* selector (VERIFIED)

`AudioManagerAndroid::GetAudioInputDeviceNames`, verbatim:

```cpp
  // Android devices in general do not have robust support for specifying
  // devices individually per input or output stream, and as such
  // `AAudioPerStreamDeviceSelection` is usually disabled. Instead, if a
  // specific device is requested, we set a single input/output pair (a.k.a. a
  // "communication device") to be used for streams. …
  // For compatibility with Android R-, which predates the concept of
  // Android communication devices, the externally exposed devices are
  // "synthetic" devices which abstract away the internal device IDs and
  // manufacturer-given names provided by the Android framework (e.g.
  // "Bluetooth headset" instead of "FooBuds Pro 2.0"):
  GetCommunicationDeviceNames(device_names);
```

The label set is a fixed five, `CommunicationDeviceSelector.java`:

```java
        public static final String[] DEVICE_NAMES =
                new String[] {
                    "Speakerphone",
                    "Wired headset", // With or without microphone.
                    "Headset earpiece", // Only available on mobile phones.
                    "Bluetooth headset", // Requires BLUETOOTH permission.
                    "USB audio",
                };
```

plus a "Default" entry first. Selecting one runs on **every** low-latency input stream creation,
independent of the effects mask — `MakeLowLatencyInputStream`:

```cpp
    // Use the device ID to select the correct communication device. If the
    // default device is requested, a communication device will be chosen based
    // on an internal selection scheme. Note that a communication device is an
    // output device that the system associates with an input device, and this
    // selection switches the device used for all input and output streams with
    // communication usage set.
    if (!GetJniDelegate().SetCommunicationDevice(device_id)) {
      LOG(ERROR) << "Unable to select communication device!";
      return nullptr;
    }
```

…and the "internal selection scheme" for the default request is:

```java
        /**
         * Use a special selection scheme if the default device is selected. The "most unique"
         * device will be selected; Wired headset first, then USB audio device, then Bluetooth and
         * last the speaker phone.
         */
        public static int selectDefaultDevice(boolean[] devices) { … }
```

On Android 12+ the selection is `AudioManager.setCommunicationDevice(...)`
(`CommunicationDeviceSelectorPostS.setAudioDevice`), which matches BLE headset/speaker **and** classic
`TYPE_BLUETOOTH_SCO`/`TYPE_BLUETOOTH_A2DP`. On Android ≤11 it is the deprecated pair
(`CommunicationDeviceSelectorPreS.setAudioDevice`):

```java
        // Ensure that the Bluetooth SCO audio channel is always disabled
        // unless the BT headset device is selected.
        if (device == Devices.ID_BLUETOOTH_HEADSET) { startBluetoothSco(); } else { stopBluetoothSco(); }
        switch (device) {
            case Devices.ID_SPEAKERPHONE:  setSpeakerphoneOn(true);  break;
            case Devices.ID_WIRED_HEADSET: setSpeakerphoneOn(false); break;
            …
```

**Three consequences a design must respect.** (a) An input picker on Android Chrome is a *route*
picker with human labels — this is the only lever the web has. (b) A picked device that is momentarily
unavailable makes `MakeLowLatencyInputStream` return `nullptr`, i.e. **`getUserMedia` fails**, so an
exact `deviceId` needs a fallback path. (c) On Android 12+ the Android docs say the selection only wins
if you hold the mode: *"In case of simultaneous requests by multiple applications the priority is given
to the application currently controlling the audio mode (see setMode(int)). This is the latest
application having selected mode MODE_IN_COMMUNICATION or mode MODE_IN_CALL."* Chrome only holds that
mode when the effects mask is non-empty — so **with `echoCancellation:false` on S+, Chrome's own
route request is the weak one and normal media routing (A2DP) should survive**. [Mechanism VERIFIED;
the outcome on a device is UNVERIFIED.]

---

## 3. Bluetooth: there is no "BT mic + good BT output" on classic Bluetooth

**(VERIFIED from the Android docs, `AudioManager#startBluetoothSco()`, fetched 2026-09-21):**

> Even if a SCO connection is established, the following restrictions apply on audio output streams so
> that they can be routed to SCO headset: the stream type must be STREAM_VOICE_CALL, the format must be
> mono, the sampling must be 16kHz or 8kHz. The following restrictions apply on input streams: the
> format must be mono, the sampling must be 8kHz.

> Note that the phone application always has the priority on the usage of the SCO connection for
> telephony. If this method is called while the phone is in call it will be ignored.

`startBluetoothSco()`/`stopBluetoothSco()`/`setSpeakerphoneOn(boolean)` are **deprecated in API 34**,
replaced by `setCommunicationDevice()`/`clearCommunicationDevice()`.

So the route matrix on a classic-BT headset is:

| What you ask for | Mic | Output | Quality |
|---|---|---|---|
| AEC on, default device | phone or SCO mic (route chosen by Android/Chrome) | comm device: earpiece/speaker, or SCO if it comes up | **the owner's symptom** |
| AEC on, "Bluetooth headset" picked | SCO/HFP mic | SCO/HFP | mono 8/16 kHz "phone call" audio, A2DP suspended |
| **AEC off, default device** | phone mic (most likely) | **A2DP media path** | full-quality TTS in the headphones |
| AEC off, "Speakerphone" picked | phone mic | speaker (A2DP may still win; see §2.2(c)) | — |

LE Audio (`TYPE_BLE_HEADSET`) escapes the 8/16 kHz ceiling, and Chromium already matches those types —
but LE Audio needs Android 13+ *and* LE-Audio hardware on both ends. The owner's Honor 20 (Android 10,
classic BT) cannot reach it. [Chromium's type matching VERIFIED; the LE-Audio quality claim REPORTED.]

**Physical note that matters more than any API:** when the owner is *wearing* headphones there is
almost no acoustic echo path to cancel. The AEC we are paying for with the mode switch is buying
almost nothing in exactly the configuration where it costs the most.

---

## 4. Premise correction: ChatGPT has no output selector

- **Web:** no evidence of any output-device control. There is no mechanism available to it
  (`setSinkId` / `selectAudioOutput` are off on Android Chrome — §2.1), and ChatGPT's own web voice mode
  is a WebRTC page playing remote audio into a media element, subject to the same limits. [REPORTED +
  mechanism VERIFIED.]
- **iOS app:** an *open feature request*, `community.openai.com/t/add-an-in-app-audio-output-selector-for-chatgpt-voice-on-ios/1397484`,
  dated **2026-09-14** (one week before this dossier): the user asks for "an audio-routing control
  directly inside ChatGPT Voice on iOS" because today they must "leave the conversation and change the
  audio routing through iOS controls". [REPORTED, fetched 2026-09-21.]
- **Android app:** the same class of bug as ours, reported against the *native* app:
  `community.openai.com/t/cannot-get-chatgpt-to-use-my-bluetooth-headset-for-discussion/850605` — the app
  "briefly plays a sound in the headphones while connecting to voice chat and then defaults to phone ear
  speaker", "will always use the internal Android phone's speaker, even if I connect a bluetooth
  speaker", with an OpenAI reply (2024-11-19): *"This is being looked into. No ETA as of yet but team is
  looking into it"*. Users in that thread ask for exactly what our owner asks for — "select microphone
  input devices (phone-mic or headset-mic), and voice output devices". [REPORTED.]

**⇒ The selector the owner remembers is the OS route picker (iOS AirPlay / Android media-output
chooser), not an app feature — and the app that "does it right" is having the same fight we are.**

---

## 5. Field pass — what five projects ship for Android browser call audio

| Project | gUM audio constraints | Device UI on Android | Comm-mode / BT handling |
|---|---|---|---|
| **Jitsi Meet** (the domain expert) | `echoCancellation: !disableAP && !disableAEC`, `noiseSuppression`, `autoGainControl` — **all on by default**, `channelCount: 1`; no mobile branch | **None.** The audio-settings button is `visible: !isMobileBrowser() && !isNarrowLayout`; speaker list gated on a *runtime probe* of `setSinkId` | no BT/comm-mode code anywhere in the web tree |
| **LiveKit client-sdk-js** | defaults `{deviceId:{ideal:'default'}, autoGainControl:true, echoCancellation:true, noiseSuppression:true, voiceIsolation:true}` | `switchActiveDevice('audiooutput')` **throws** `'cannot switch audio output, the current browser does not support it'` when `setSinkId` is absent ⇒ no output switching on Android | mobile-only workaround is unrelated: re-acquire the track when the app returns to the foreground (`handleAppVisibilityChanged`) |
| **Element Call** | LiveKit's (above) | **Only via a native host.** `MediaDevices` picks `AndroidControlledAudioOutput` when `controlledAudioDevices` is set, i.e. *"the hosting application (e.g. Element Mobile) is responsible for providing the list of available audio output devices"* through a `window.controls` bridge; plain browser falls back to the `setSinkId`-based `AudioOutput` | the bridge's `OutputDevice` flags are literally Android types: `isEarpiece` = `TYPE_BUILTIN_EARPIECE`, `isSpeaker` = `TYPE_BUILTIN_SPEAKER`, `isExternalHeadset` = `TYPE_BLUETOOTH_SCO` |
| **open-webui** (has a call mode) | call overlay: `{echoCancellation:true, noiseSuppression:true, autoGainControl:true}` — squarely in the trap | **None for audio.** The only picker in the call overlay is `videoinput`; no `setSinkId`, no `audiooutput` handling anywhere in `src/` | none |
| **LibreChat** | `getUserMedia({audio: true, video: false})` — unconstrained, which resolves to `kBrowserDecides` ⇒ platform AEC ⇒ the trap | **None.** No `enumerateDevices`, no `setSinkId` anywhere in `client/src` or `packages` | none (dictation only, no call mode) |

**Three things the field agrees on.** ① Nobody ships an output selector for Android *web* — the two
projects that care most (Jitsi, Element Call) resolve it by *hiding the UI on mobile* and *delegating
to a native shell* respectively. ② Feature-**probe**, never UA-sniff: lib-jitsi-meet does the probe
properly and even downgrades on a rejected call —

```js
let isAudioOutputDeviceChangeAvailable = typeof featureDetectionAudioEl.setSinkId !== 'undefined';
// The presence of the setSinkId symbol does not imply a working implementation. Probe the API once
// against the system default sink ('') and downgrade the availability flag if the probe rejects…
```

③ Every one of the five leaves echo cancellation **on** by default, i.e. every one of them ships the
comm-mode trap on Android. Nobody has a workaround, and none of the four OSS trees contains a single
mention of `MODE_IN_COMMUNICATION`, SCO or A2DP.

**The tracker entry for the symptom** (REPORTED; the description is public, the comment thread is not
fetchable without JS): **crbug.com/40222537 — "Android 12+: Chrome ignores connected bluetooth
headphones, and audio output is the speaker"**, filed against Chrome 97, components
`Blink>WebRTC>Audio`/`Internals>Media>Audio`, repro: *"(1) Connect bluetooth headphones (2) Join an RTC
call (3) Audio comes from speaker, instead of bluetooth headphones"*, reproducing on the stock
`webrtc.github.io/samples/.../peerconnection/audio/` page. It is still live enough to be cited by two
`TODO`s in today's Chromium tree (`setCommunicationAudioModeOn`, and *"TODO(crbug.com/40222537): Prompt
for BLUETOOTH_CONNECT permission at this point if we don't have it"*).

---

## 6. Fennec / Firefox Android — same family, different mechanism (VERIFIED in source)

Gecko has its own version of exactly this switch, on the same trigger:

`dom/media/GraphDriver.cpp`:
```cpp
  if (aAudioInputType == AudioInputType::Voice &&
      StaticPrefs::media_getusermedia_microphone_prefer_voice_stream_with_processing_enabled()) {
    …
    mInputDevicePreference = CUBEB_DEVICE_PREF_VOICE;
    CubebUtils::SetInCommunication(true);
```
(pref `media.getusermedia.microphone.prefer_voice_stream_with_processing.enabled` **defaults `true`**,
`StaticPrefList.yaml`.)

"Voice" means "any processing requested" — `dom/media/webrtc/MediaEngineWebRTCAudio.h`:
```cpp
  bool IsVoiceInput(MediaTrackGraph* aGraph) const override {
    // If we're passing data directly without AEC or any other process, this
    // means that all voice-processing has been disabled intentionaly. In this
    // case, consider that the device is not used for voice input.
    return !IsPassThrough(aGraph) || mPlatformProcessingSetParams != CUBEB_INPUT_PROCESSING_PARAM_NONE;
  }
```
with `IsPassThrough` = `!(aec || agc || ns)`. **So on Fennec all three must be off**, unlike Chrome
where AEC alone decides.

Two divergences from Chrome that matter:

1. **Fennec does not call `setMode()`.** `GeckoAppShell.setCommunicationAudioModeOn(boolean)` is:
   ```java
      if (on) {
        Log.e(LOGTAG, "Setting communication mode ON");
        am.startBluetoothSco();
        am.setBluetoothScoOn(true);
      } else {
        am.stopBluetoothSco();
        am.setBluetoothScoOn(false);
      }
   ```
   i.e. Fennec **forces the SCO link** rather than the comm mode. Expected symptom class: BT audio that
   *works* but sounds like a phone call (mono 8/16 kHz, §3), not "speaker + distortion". [Mechanism
   VERIFIED; the on-device outcome UNVERIFIED.]
2. **The capture preset is deliberately not `VOICE_COMMUNICATION`** — `media/libcubeb/src/cubeb_aaudio.cpp`:
   ```cpp
    // Match what the OpenSL backend does for now, we could use UNPROCESSED and
    // VOICE_COMMUNICATION here, but we'd need to make it clear that
    // application-level AEC and other voice processing should be disabled there.
    int input_preset = stm->voice_input ? AAUDIO_INPUT_PRESET_VOICE_RECOGNITION
                                        : AAUDIO_INPUT_PRESET_CAMCORDER;
   ```
   which is consistent with our own measurement in LIVE_VOICE_PLAN §7-S0 ③ that Fennec's AEC does
   nothing against the phone's own output: it never asks Android for the echo-cancelling source.

Output selection on Fennec: `setSinkId` is `version_added: false` on `firefox_android` with the same
"limitation in Android" note (bugzilla 1473346).

---

## 7. Bounded open sweep (3 findings nothing above asked for)

**S1 — the comm mode is browser-global, not page-local (VERIFIED).** `communication_mode_is_on_` is a
member of the single `AudioManagerAndroid` in the audio service, and the guard is
`HasNoAudioInputStreams()` over *all* input streams it owns. Any tab — or our own **dictation** capture
(R51 §6.1: it passes no constraints ⇒ `kBrowserDecides` ⇒ platform AEC) — flips the routing for every
sound Chrome makes, including a call's TTS. Conversely, a second capture that is already open *pins*
the mode: `if (!stream || has_input_streams || …) return stream;` means the mode is only evaluated for
the **first** input stream. Our call opens its own capture beside dictation's; whichever opened first
decides.

**S2 — the output usage is latched at stream-creation time (VERIFIED at source; exploitability
UNVERIFIED).** `MakeLowLatencyOutputStream` reads `communication_mode_is_on_` once, when the playback
stream is created, and nothing re-tags a live stream. A playback stream that already exists when the
mic opens therefore keeps `AAUDIO_USAGE_MEDIA` — and Android routes by *usage*, so a MEDIA-usage stream
should keep going to A2DP even while the mode is `MODE_IN_COMMUNICATION` (unless a SCO link suspends
A2DP outright). This is a plausible explanation for the owner's "it flips when the app half-leaves"
observation from the other direction, and it suggests a cheap probe: hold a silent looping element open
across the call so the mouth's output stream predates the ear's. It is a hack with a battery cost and
it is **not** a substitute for §9's recommendation.

**S3 — Chromium is building the real fix, and it is already on for some Android (VERIFIED).**
`media/audio/audio_features.cc`: *"Enables selection of audio devices for each individual AAudio stream
instead of using communication streams and managing the system-wide communication route. This is not
fully reliable on all Android devices."* — `kAAudioPerStreamDeviceSelection`, `ENABLED_BY_DEFAULT`, but
`UseAAudioPerStreamDeviceSelection()` additionally requires `base::android::device_info::is_desktop()`
("only enabled on Desktop devices for now"). When that gate opens for phones, `MakeAudioInputStream`
**skips the comm-mode switch entirely** (it is in the same early-return), `GetAudioInputDeviceNames`
/`GetAudioOutputDeviceNames` start returning real per-stream devices, and the whole trap — and this
dossier's recommendation — becomes obsolete. Worth a re-check each Chrome major.

---

## 8. What I could not determine

- **Whether picking "Bluetooth headset" as the audioinput on the owner's phone actually routes TTS to
  the headphones, and how bad the 8/16 kHz SCO audio sounds for our Kokoro voice.** Needs the phone.
- **Whether `echoCancellation:false` alone is sufficient on the Honor 20** (Android 10 ⇒ the PreS
  selector). PreS `setAudioDevice` calls `setSpeakerphoneOn(true)` when the default selection lands on
  Speakerphone, *regardless of the mode* — `setSpeakerphoneOn` is documented for in-call use, but OEM
  behaviour in `MODE_NORMAL` varies. If AEC-off still routes to the speaker, this is why, and the fix is
  then to also pick a non-speaker input device.
- **Why backgrounding the app fixes it.** Consistent with either capture teardown (⇒ `ReleaseInputStream`
  ⇒ `MODE_NORMAL`) or a policy re-evaluation; I could not distinguish them from source, and the
  chrome://webrtc-internals log from a repro would settle it in one look.
- **The Chromium comment thread on crbug 40222537** (status, whether it is fixed on 12+): the tracker's
  comment stream is not served without JS; only the issue description came back.
- **`AudioContext.setSinkId` on Android Chrome**: Chromium's flag table disables `AudioOutputDevices` on
  Android but marks `AudioContextSetSinkId` "stable" with no platform exception. Since the output device
  list is `["default"]` there is nothing to select even if the method exists — but I did not probe it.
- **The exact definition site of `EchoCancellationModeToBooleanOrString`** (what `getSettings()`
  reports for each mode). The mapping is obvious from `EchoCancellationModeToString` (`kAll` → `"all"`,
  `kRemoteOnly` → `"remote-only"`) and matches our own device readback, but I did not read the function.
- **Whether the ChatGPT *Android* app has since shipped a route button** (the iOS request and the
  Android complaints are both open; I found no announcement either way).

---

## 9. Implications for ctrl-b, and the recommendation

*(Short and separate, per the folder's convention. Evidence above ages slowly; this reading ages fast.)*

**Build these.**

1. **A "Bluetooth / headphones" call mode = `echoCancellation: false`.** One switch, config-backed
   (`voice.live_call.*`), that changes the capture constraints only. It empties the platform-effects
   mask, which is the single bit that decides the mode switch (§1.3), so Chrome stops re-tagging its
   own output as voice-communication and the TTS goes back down the A2DP media path. **Our design
   already handles the consequence**: an AEC-less track arms the **ear-hold** (`setHeld`,
   LIVE_VOICE_PLAN S3), which is the path pcmCapture already takes for Fennec. The only loss is
   automatic barge-in while the reply speaks; tap-to-interrupt (trigger B) is unchanged.
2. **Go further where physics allows: an "I'm wearing headphones" state, not just a codec toggle.**
   With headphones on the head there is no acoustic echo path, so the honest configuration is *AEC off
   **and** ear-hold off* — full open-mic barge-in with full-quality output, the best call we can ship
   on that phone. Model it as one owner-facing choice ("Headphones" / "Speaker") that sets both, rather
   than two knobs that can disagree: the ear-hold must stay derived in the one normalize that already
   owns it, never set per-arm.
3. **An input-device picker, labelled as what it is on Android: a route picker.** `enumerateDevices()`
   audioinput on Android Chrome returns exactly "Default / Speakerphone / Wired headset / Headset
   earpiece / Bluetooth headset / USB audio" (§2.2), and the choice moves *both* directions. It is the
   only routing lever the platform gives a web page, it degrades gracefully to a real device list on
   desktop, and it is what the owner asked for in the only form that can exist. It must handle
   `OverconstrainedError`/`nullptr`-stream failure by falling back to the default device and saying so.

**Do not build these.**

- **An output-device dropdown.** `setSinkId`, `sinkId`, `selectAudioOutput` and the whole Audio Output
  Devices API are off on Android in Chromium's own flag table, there is exactly one output device to
  choose ("default"), and no flag, permission or newer API changes that in 2026. Jitsi hides the control
  on mobile; LiveKit throws; Element Call needs a native host. Copy Jitsi: **probe `setSinkId` once and
  hide the control when it is absent** — never UA-sniff, and never show a control that cannot work.
- **A "use the Bluetooth mic" feature.** On classic BT it costs the output quality it was meant to save
  (mono 8/16 kHz, A2DP suspended — §3). Let the route picker expose it and let the owner judge; do not
  make it a mode the app steers into.
- **A native shell** to get real routing (Element Call's answer). Out of scope for a PWA, and it would
  put ctrl-b on the Play-store treadmill for one control.
- **Anything that UA-sniffs Android**, and anything that "fixes" this by changing `audioController`'s
  playback path — the element is not the problem; the capture constraints are.

**One probe to run at the S4 phase gate (owner + phone, afternoon):** with the headphones on, run the
call four ways — (a) today's `{ideal:"all"}`, (b) `echoCancellation:false`, (c) `false` + "Bluetooth
headset" picked as input, (d) `false` + "Speakerphone" picked — and record for each: where the TTS comes
out, how it sounds, `track.getSettings().echoCancellation`, and whether the ear still hears the owner.
That is a four-line table that settles the whole design, and `chrome://webrtc-internals` on the phone
will show the chosen device and effects if any row surprises us.

---

## 10. The numbers that decide the design

| Fact | Value | Confidence |
|---|---|---|
| `echoCancellation: "all"` / `"remote-only"` shipped | **Chrome 141** (desktop, Android, WebView, iOS); runtime feature `GetUserMediaEchoCancellationModes` = `stable` | VERIFIED |
| `echoCancellation: "remote-only"` on Android | **never** — excluded by `#if !BUILDFLAG(IS_ANDROID)` | VERIFIED |
| `HTMLMediaElement.setSinkId` / `.sinkId` on Chrome Android | **false** (crbug 41276355) | VERIFIED (BCD) |
| `HTMLMediaElement.setSinkId` on Firefox Android | **false** (bugzilla 1473346) | VERIFIED (BCD) |
| `AudioOutputDevices` runtime feature, Android | **`""` = disabled** (`"default": "stable"`) | VERIFIED |
| `SelectAudioOutput` runtime feature, Android | **`""` = disabled** (`"default": "test"`) | VERIFIED |
| `navigator.audioSession` in Chromium | **absent** | VERIFIED |
| Android Chrome `enumerateDevices()` audiooutput | **1 entry: "default"** | VERIFIED |
| Android Chrome `enumerateDevices()` audioinput | **≤6 entries**: Default + Speakerphone, Wired headset, Headset earpiece, Bluetooth headset, USB audio | VERIFIED |
| Effects bits Android can report | **1** (`ECHO_CANCELLER`, iff `AcousticEchoCanceler.isAvailable()`) | VERIFIED |
| Constraint that avoids `MODE_IN_COMMUNICATION` on Chrome Android | **`echoCancellation: false`** (NS/AGC irrelevant) | VERIFIED |
| Same, on Firefox Android | **all three off** (`aec && agc && ns` must all be false ⇒ pass-through) | VERIFIED |
| BT SCO output ceiling | **mono, 8 kHz or 16 kHz, STREAM_VOICE_CALL**; input mono 8 kHz | VERIFIED (AOSP docs) |
| `startBluetoothSco`/`setSpeakerphoneOn` deprecated | **API 34** → `setCommunicationDevice()` | VERIFIED |
| Android version boundary for the selector implementation | **S (API 31)**: `CommunicationDeviceSelectorPostS` vs `…PreS` | VERIFIED |
| Owner's phone | Honor 20, **Android 10 ⇒ the PreS path** (`startBluetoothSco`, `setSpeakerphoneOn`) | phone model VERIFIED (memory), OS version REPORTED |
| Per-stream device selection on Android (the real fix) | `kAAudioPerStreamDeviceSelection` **ENABLED_BY_DEFAULT but gated on `device_info::is_desktop()`** ⇒ off on phones | VERIFIED |
| Peers shipping an Android-web output selector | **0 of 5** | VERIFIED |
| Peers shipping AEC-on by default | **5 of 5** | VERIFIED |
