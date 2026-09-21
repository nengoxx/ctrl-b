# R77 — Android 10 / PreS: what Chrome still does to the route when the AEC is off

**Date: 2026-09-21 · Confidence: the Chromium half is VERIFIED at the pin below; the Android half is
VERIFIED in AOSP `android10-release` source (the owner's phone runs Magic UI 3.x on Android 10 — an
EMUI derivative, so OEM divergence is possible and is called out); the outcome on the owner's actual
phone+headset pair is UNVERIFIED and forks on ONE observable, named in §5.**

**Question (one):** on Chrome for Android 10/11 (the **PreS** communication-device selector), with a
**classic Bluetooth** headset connected and a page capture opened with `echoCancellation:false` (so
the effects mask is empty and `MODE_IN_COMMUNICATION` is never set) — what routing side effects does
Chrome *still* perform at input-stream creation, and where does the page's `AAUDIO_USAGE_MEDIA` /
`SL_ANDROID_STREAM_MEDIA` playback actually go while that capture is open?

**Occasion:** R74 §8 left exactly three open questions (a)/(b)/(c) and D73 shipped `voice.live_call.route
= speaker|headphones` + `input_device` on the strength of R74's reading. This pass closes the three
and tests that reading before the S4 phase gate spends the owner's afternoon on it.

**Relates to:** [`R74`](R74-android-call-audio-routing.md) (the parent — §1 the comm-mode trap, §2.2
the communication-device selector, §3 the SCO limits, §7-S2 the "open the mouth first" hypothesis) ·
`LIVE_VOICE_PLAN.md` §4.1/§7-S4 · `backend/app/config.py` `LiveCallCfg.route` / `.input_device` ·
`frontend/src/lib/pcmCapture.ts` · `frontend/src/hooks/useLiveCall.ts`. **Drove:** nothing yet —
evidence for the S4 phase-gate round. **Corrects:** R74 §3's route matrix (the "AEC off, default
device" row) and R74 §7-S2 (the pre-existing-output workaround).

**Source pins (all read 2026-09-21).**

| Repo / source | Pin | How read |
|---|---|---|
| `chromium/chromium` | **`e5554c0b194d113009b21e42bc133cfcc8679b23`** (main, 2026-09-21) | raw files over https |
| AOSP `platform/frameworks/base` | **`android10-release` @ `37a24f52e6be75e7f7db461e3bee465152318c99`** | `android.googlesource.com` `?format=TEXT` |
| AOSP `platform/frameworks/av` | **`android10-release` @ `0f111c8099df301d6471c3190f872f517353ebbc`** | same |
| Chromium revert CL 6774461 / CL 5970174 | commits `66c77cdee9` / `78d0de1383` | GitHub commits API |
| `issues.chromium.org/40222537` | fetched 2026-09-21 | `/action/issues/40222537` JSON (description + metadata only) |
| `google/oboe` wiki, *Bluetooth Audio* | fetched 2026-09-21 | WebFetch |
| HONOR support `en-us00411000` | fetched 2026-09-21 | WebFetch |

---

## 0. The verdict in eight lines

1. **(a) YES — `SetCommunicationDevice()` runs on EVERY `MakeLowLatencyInputStream`**, before the
   effects mask is ever consulted and whether or not the page asked for a specific device. The effects
   mask gates only the *mode* switch, which happens one stack frame later. `echoCancellation:false`
   therefore buys you exemption from `MODE_IN_COMMUNICATION` and **nothing else**. (§1.1)
2. **On the PreS path a default-device capture picks the "most unique" device, and a connected classic
   BT headset outranks the speakerphone** — so an AEC-off capture still calls
   `AudioManager.startBluetoothSco()`. (§1.2)
3. **And that is the bad arm.** When SCO actually connects, AOSP sets force-use `FOR_COMMUNICATION`
   **and** `FOR_RECORD` to `FORCE_BT_SCO`, which makes `checkA2dpSuspend()` **suspend the A2DP
   output**; a suspended output's frames are *discarded* ("Simulate write to HAL when suspended"). The
   MEDIA-usage TTS is still *routed* to A2DP — it is simply never heard. Not the speaker: **silence**.
   Chromium's own engineers hit this and described it in a commit message as the "no sound issue".
   (§1.4, §4.1)
4. **The other arm is harmless.** With no BT row, the default selection lands on Speakerphone and calls
   `setSpeakerphoneOn(true)` — which in AOSP sets force-use `FOR_COMMUNICATION` only. `STRATEGY_MEDIA`
   never reads `FOR_COMMUNICATION`. **In `MODE_NORMAL`, speakerphone-on does NOT move media audio; A2DP
   keeps the TTS at full quality.** (§1.5)
5. **The "Bluetooth headset" row is NOT permission-blocked on Android 10.** PreS gates it on
   `android.permission.BLUETOOTH`, which is `protectionLevel="normal"` (install-time) through API 30,
   and Chrome declares it unconditionally. The crbug-40222537 TODO about *prompting* for
   `BLUETOOTH_CONNECT` lives in the **PostS** class — it is an Android-12+ problem, not the owner's.
   (§1.3)
6. **(b) Teardown restores everything — but only on the AEC-ON path.** The whole restore (stop SCO,
   clear the requested device, restore speakerphone + mic-mute, `MODE_NORMAL`) is *inside*
   `setCommunicationAudioModeOn(false)`, which `ReleaseInputStream` only calls when the mode was
   turned on. **An AEC-off capture restores nothing** — the SCO link and the speakerphone force it
   raised are leaked for the life of the audio service. (§2)
7. **(b-why) The owner's "half-leaving fixes it" is explained by our own code, not by Chrome.**
   Pre-S6, `useLiveCall`'s `visibilitychange→hidden` **ended the call**, which released the capture ⇒
   `MODE_NORMAL` + SCO stopped + speakerphone restored ⇒ A2DP back. **D73 S6 (`background: True`)
   deletes that accidental workaround.** (§2.2)
8. **(c) NO — "open the mouth before the ear" does not work on a phone.** The usage *is* latched at
   stream creation (nothing in Chromium re-tags a live stream, and the one re-creation mechanism that
   exists — `AAudioBluetoothOutputStream::SetUseSco` — is gated behind desktop-only per-stream device
   selection). But the latch is irrelevant: Android re-evaluates routing for **all** outputs on a mode
   change, and in `MODE_IN_COMMUNICATION` `STRATEGY_MEDIA` is redirected wholesale to the
   `STRATEGY_PHONE` device. A pre-existing MEDIA stream moves to the earpiece/speaker with everything
   else. (§3)

---

## 1. (a) The device selection is unconditional

### 1.1 The exact condition (VERIFIED — Chromium `e5554c0b194d`)

`media/audio/android/audio_manager_android.cc`, `MakeLowLatencyInputStream` — the whole guard is
`!UseAAudioPerStreamDeviceSelection()`; **`params.effects()` is not read here, and neither is
`device_id`'s defaultness**:

```cpp
AudioInputStream* AudioManagerAndroid::MakeLowLatencyInputStream(
    const AudioParameters& params, const std::string& device_id, const LogCallback&) {
  …
  if (!UseAAudioPerStreamDeviceSelection()) {
    // Use the device ID to select the correct communication device. If the
    // default device is requested, a communication device will be chosen based
    // on an internal selection scheme. …
    if (!GetJniDelegate().SetCommunicationDevice(device_id)) {
      LOG(ERROR) << "Unable to select communication device!";
      return nullptr;
    }
  }
```

The effects mask is consulted **only** in the caller, `MakeAudioInputStream`, *after* the stream (and
therefore the device selection) already exists:

```cpp
  bool has_input_streams = !HasNoAudioInputStreams();
  AudioInputStream* stream = AudioManagerBase::MakeAudioInputStream(…);   // ← selection happens in here
  …
  if (!stream || has_input_streams || UseAAudioPerStreamDeviceSelection()) { return stream; }
  if (params.effects() != AudioParameters::NO_EFFECTS) {
    communication_mode_is_on_ = true;
    GetJniDelegate().SetCommunicationAudioModeOn(true);
  }
```

`UseAAudioPerStreamDeviceSelection()` is false on every phone —
`media/audio/audio_features.cc` has `kAAudioPerStreamDeviceSelection` `ENABLED_BY_DEFAULT`, but the
helper adds `base::android::device_info::is_desktop()` (R74 §7-S3, re-verified at this pin). The
default device id crosses JNI as the empty string:

```cpp
  bool SetCommunicationDevice(std::string_view device_id) override {
    ScopedJavaLocalRef<jstring> j_device_id = …(
            device_id == AudioDeviceDescription::kDefaultDeviceId ? std::string() : device_id);
```

`AudioManagerAndroid.java` then requires `MODIFY_AUDIO_SETTINGS` **and** `RECORD_AUDIO` (both held —
`chrome/android/java/AndroidManifest.xml` declares them as plain `<uses-permission>`), and calls
`mCommunicationDeviceSelector.selectDevice(deviceId)`.

**⇒ `route: headphones` (= `echoCancellation:false`) changes exactly one thing on Android: the mode
switch. The route selection fires either way.**

### 1.2 What "default" selects on the Honor 20 (VERIFIED)

`CommunicationDeviceSelector.java`:

```java
        /**
         * Use a special selection scheme if the default device is selected. The "most unique"
         * device will be selected; Wired headset first, then USB audio device, then Bluetooth and
         * last the speaker phone.
         */
        public static int selectDefaultDevice(boolean[] devices) {
            if (devices[Devices.ID_WIRED_HEADSET]) { return Devices.ID_WIRED_HEADSET; }
            if (devices[Devices.ID_USB_AUDIO])     { return Devices.ID_USB_AUDIO; }
            if (devices[Devices.ID_BLUETOOTH_HEADSET]) { return Devices.ID_BLUETOOTH_HEADSET; }
            return Devices.ID_SPEAKERPHONE;
        }
```

Which rows exist at all is `CommunicationDeviceListener.init()`:

```java
        mDeviceStates.setDeviceExistence(…ID_EARPIECE, hasEarpiece());
        mDeviceStates.setDeviceExistence(…ID_USB_AUDIO, hasUsbAudio());
        mDeviceStates.setDeviceExistence(…ID_SPEAKERPHONE, true);
```

— **Speakerphone always exists; Earpiece exists on a phone** (PreS suppresses Earpiece only when a
wired or USB device is attached). The BT row exists iff:

```java
    private boolean hasBluetoothHeadset(@Nullable BluetoothAdapter btAdapter) {
        …
        btAdapter.getProfileConnectionState(android.bluetooth.BluetoothProfile.HEADSET)
                            == android.bluetooth.BluetoothAdapter.STATE_CONNECTED;
```

i.e. **the HFP/HSP profile must be connected** — an A2DP-only sink (many BT speakers, and some
headphones whose mic profile the phone has not connected) does not produce the row. On Android 10 the
LE-Audio branch is dead (`isLeAudioSupported()` needs API 33).

**⇒ On the owner's Honor 20 the list is `Default, Speakerphone, Headset earpiece` — plus
`Bluetooth headset` iff the headphones are connected as an HFP headset. That single bit decides
everything below, and the page can read it: `enumerateDevices()` exposes exactly these labels
(R74 §2.2).**

### 1.3 The permission question — answered, and it is not the owner's problem (VERIFIED)

PreS gates the BT row on the *old* permission:

```java
    public void init() {
        mHasBluetoothPermission = hasPermission(android.Manifest.permission.BLUETOOTH);
        mDeviceListener.init(mHasBluetoothPermission);
        if (mHasBluetoothPermission) registerForBluetoothScoIntentBroadcast();
    }
```

AOSP `core/res/AndroidManifest.xml` (`android10-release`):

```xml
    <!-- Allows applications to connect to paired bluetooth devices.
         <p>Protection level: normal -->
    <permission android:name="android.permission.BLUETOOTH"
        android:protectionLevel="normal" />
```

`protectionLevel="normal"` ⇒ **install-time, auto-granted, no runtime prompt**. Chrome declares it
with no `maxSdkVersion`:

```xml
    <uses-permission-sdk-23 android:name="android.permission.BLUETOOTH"/>
```

The `crbug.com/40222537` TODO R74 cited is in **`CommunicationDeviceSelectorPostS.java`** only:

```java
    public void setCommunicationAudioModeOn(boolean on) {
        if (on) {
            // TODO(crbug.com/40222537): Prompt for BLUETOOTH_CONNECT permission at this point if we
            // don't have it.
```

`BLUETOOTH_CONNECT` is the Android-12+ *runtime* permission (Chrome declares it but cannot use it
unprompted). **On Android 10 Chrome holds BLUETOOTH unconditionally, so the BT row is NOT suppressed
by permissions — only by the headset's HFP state.**

### 1.4 Arm A — BT row present: SCO rises, A2DP is suspended, MEDIA audio is DISCARDED

`CommunicationDeviceSelectorPreS.setAudioDevice`:

```java
        // Ensure that the Bluetooth SCO audio channel is always disabled
        // unless the BT headset device is selected.
        if (device == Devices.ID_BLUETOOTH_HEADSET) { startBluetoothSco(); } else { stopBluetoothSco(); }
        switch (device) {
            case Devices.ID_BLUETOOTH_HEADSET: break;              // speakerphone untouched
            case Devices.ID_SPEAKERPHONE:  setSpeakerphoneOn(true);  break;
            case Devices.ID_WIRED_HEADSET: setSpeakerphoneOn(false); break;
            case Devices.ID_EARPIECE:      setSpeakerphoneOn(false); break;
            case Devices.ID_USB_AUDIO:     setSpeakerphoneOn(false); break;
```

Then, AOSP side, four verified steps:

**① The SCO request is accepted because we are in `MODE_NORMAL`** — `BtHelper.requestScoState`:

```java
                // Accept SCO audio activation only in NORMAL audio mode or if the mode is
                // currently controlled by the same client process.
                final int modeOwnerPid =  mDeviceBroker.getModeOwnerPid();
                if (modeOwnerPid != 0 && (modeOwnerPid != mCreatorPid)) { … return false; }
```

(Note the irony: turning the AEC *off* makes the SCO request *more* likely to succeed, because nobody
owns the mode.)

**② When SCO connects, both force-uses flip to `FORCE_BT_SCO`** — `AudioDeviceBroker.setBluetoothScoOn`,
reached from `BtHelper.receiveBtEvent` on `STATE_AUDIO_CONNECTED`:

```java
                mForcedUseForComm = AudioSystem.FORCE_BT_SCO;
            …
            AudioSystem.setParameters("BT_SCO=" + (on ? "on" : "off"));
            sendIILMsgNoDelay(MSG_IIL_SET_FORCE_USE, SENDMSG_QUEUE,
                    AudioSystem.FOR_COMMUNICATION, mForcedUseForComm, eventSource);
            sendIILMsgNoDelay(MSG_IIL_SET_FORCE_USE, SENDMSG_QUEUE,
                    AudioSystem.FOR_RECORD, mForcedUseForComm, eventSource);
```

**③ That suspends the A2DP output** — `AudioPolicyManager::setForceUse` →
`checkForDeviceAndOutputChanges()` → `checkA2dpSuspend()`:

```cpp
    } else {
        if (isScoConnected &&
             ((mEngine->getForceUse(AUDIO_POLICY_FORCE_FOR_COMMUNICATION) == AUDIO_POLICY_FORCE_BT_SCO) ||
              (mEngine->getForceUse(AUDIO_POLICY_FORCE_FOR_RECORD)        == AUDIO_POLICY_FORCE_BT_SCO) ||
              (mEngine->getPhoneState() == AUDIO_MODE_IN_CALL) ||
              (mEngine->getPhoneState() == AUDIO_MODE_RINGTONE))) {
            mpClientInterface->suspendOutput(a2dpOutput);
            mA2dpSuspended = true;
        }
    }
```

**Note the four-way `||`: the phone state is only one of the triggers. `MODE_NORMAL` does not save
you — force-use `FOR_RECORD == FORCE_BT_SCO` alone is enough.**

**④ A suspended output throws its frames away** — `AudioFlinger` `Threads.cpp`:

```cpp
            if (isSuspended()) {
                // Simulate write to HAL when suspended (e.g. BT SCO phone call).
                mSleepTimeUs = suspendSleepTimeUs(); // assumes full buffer.
                …
                mSuspendedFrames += framesRemaining; // to adjust kernel HAL position
```

Meanwhile the *device selection* for `STRATEGY_MEDIA` is unchanged (`Engine.cpp` still names
`AUDIO_DEVICE_OUT_BLUETOOTH_A2DP`, and `SwAudioOutputCollection::isA2dpSupported()` is
`isA2dpOffloadedOnPrimary() || getA2dpOutput() != 0` — suspension does not remove the device). So the
TTS is faithfully delivered to an output that is dropping it.

**⇒ AEC-off + BT-headset selection = mic works (SCO, 8 kHz mono), TTS is SILENT.** That is *worse*
than today's symptom, which is at least audible.

### 1.5 Arm B — BT row absent: speakerphone-on does NOT touch media (VERIFIED)

`AudioDeviceBroker.setSpeakerphoneOn`:

```java
    /*package*/ boolean setSpeakerphoneOn(boolean on, String eventSource) {
        …
            if (on) {
                if (mForcedUseForComm == AudioSystem.FORCE_BT_SCO) {
                    setForceUse_Async(AudioSystem.FOR_RECORD, AudioSystem.FORCE_NONE, eventSource);
                }
                mForcedUseForComm = AudioSystem.FORCE_SPEAKER;
            } …
            setForceUse_Async(AudioSystem.FOR_COMMUNICATION, mForcedUseForComm, eventSource);
```

Only `FOR_COMMUNICATION`. And `Engine::getDevicesForStrategyInt`'s `STRATEGY_MEDIA` arm **never reads
`FOR_COMMUNICATION`** — the only force-use it consults is `AUDIO_POLICY_FORCE_FOR_MEDIA`:

```cpp
        if ((device2 == AUDIO_DEVICE_NONE) &&
                (getForceUse(AUDIO_POLICY_FORCE_FOR_MEDIA) != AUDIO_POLICY_FORCE_NO_BT_A2DP) &&
                 outputs.isA2dpSupported()) {
            device2 = availableOutputDevicesType & AUDIO_DEVICE_OUT_BLUETOOTH_A2DP;
```

…and A2DP is tried **before** wired, USB and speaker. The input side agrees —
`Engine::getDeviceForInputSource` for `AUDIO_SOURCE_DEFAULT`/`MIC` takes the SCO mic only when
`FOR_RECORD == FORCE_BT_SCO`, otherwise falls through to `AUDIO_DEVICE_IN_BUILTIN_MIC`.

**⇒ AEC-off with the selection on Speakerphone (or Earpiece): mic = the phone's built-in mic, TTS =
A2DP at full quality. Exactly what D73 wanted.** This is the answer R74 §8 asked for ("OEM behaviour in
`MODE_NORMAL` varies") — in AOSP it is not merely benign, it is *structurally* benign: the two
force-use slots do not intersect.

### 1.6 One more AEC-off side effect R74 did not have: the input preset (VERIFIED)

`media/audio/android/aaudio_stream_wrapper.cc` — the mask also changes what Chrome asks the *mic* for:

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
                     : fallback_preset);   // AAUDIO_INPUT_PRESET_GENERIC
```

So `route: headphones` also swaps the capture preset `VOICE_COMMUNICATION → GENERIC`. That is good for
us (GENERIC = `AUDIO_SOURCE_DEFAULT`, the "standard routing" branch quoted above, and it keeps AGC) and
it is one more reason the platform AEC genuinely disappears rather than half-applying.

---

## 2. (b) Teardown: full restore on one path, nothing on the other

### 2.1 The restore is inside the mode exit (VERIFIED)

`AudioManagerAndroid.java`:

```java
    private void setCommunicationAudioModeOn(boolean on) {
        …
        if (on) {
            // Store microphone mute state and speakerphone state so it can be restored when closing.
            mSavedIsSpeakerphoneOn = mCommunicationDeviceSelector.isSpeakerphoneOn();
            mSavedIsMicrophoneMute = mAudioManager.isMicrophoneMute();
            mCommunicationDeviceSelector.setCommunicationAudioModeOn(true);
            startObservingVolumeChanges();
        } else {
            stopObservingVolumeChanges();
            mCommunicationDeviceSelector.setCommunicationAudioModeOn(false);
            // Restore previously stored audio states.
            setMicrophoneMute(mSavedIsMicrophoneMute);
            mCommunicationDeviceSelector.setSpeakerphoneOn(mSavedIsSpeakerphoneOn);
        }
        setCommunicationAudioModeOnInternal(on);   // setMode(MODE_IN_COMMUNICATION / MODE_NORMAL)
    }
```

and `CommunicationDeviceSelectorPreS`:

```java
    public void setCommunicationAudioModeOn(boolean on) {
        if (!on) {
            stopBluetoothSco();
            mDeviceStates.clearRequestedDevice();
        }
    }
```

That is a **complete** restore — SCO down, requested device cleared, speakerphone and mic-mute put
back, `MODE_NORMAL`. But its only caller is:

```cpp
void AudioManagerAndroid::ReleaseInputStream(AudioInputStream* stream) {
  AudioManagerBase::ReleaseInputStream(stream);
  // Restore the audio mode which was used before the first communication-mode stream was created.
  if (HasNoAudioInputStreams() && communication_mode_is_on_) {
    communication_mode_is_on_ = false;
    GetJniDelegate().SetCommunicationAudioModeOn(false);
  }
}
```

**⇒ `communication_mode_is_on_` gates the whole restore.** With `echoCancellation:false` that flag was
never set, so releasing the capture calls *nothing*: **the SCO link Chrome raised in §1.4 stays up, the
`setSpeakerphoneOn(true)` from §1.5 stays forced, and the requested device stays latched** — for the
lifetime of the audio-service process, i.e. until Chrome is killed. The only other SCO release in the
tree (`ReleaseScoState` → `MaybeSetBluetoothScoState(false)`) is dead on phones: its guard
`IsUsingBluetoothSco()` returns `false` outright when per-stream device selection is off ("With
per-stream device selection disabled, SCO is instead managed via the Java
`CommunicationDeviceSelector`"), and `PreS.close()` only unregisters receivers.

This is a genuine defect class, not a design: **turning the AEC off buys exemption from the mode
switch and simultaneously loses the cleanup that the mode switch pays for.** It matters for us in one
concrete way — see §7 ④.

### 2.2 Why half-leaving the app fixed it: it was OUR code (VERIFIED in this repo)

R74 §8 could not distinguish "capture teardown" from "policy re-evaluation". It is capture teardown,
and ctrl-b is the one doing it. `frontend/src/hooks/useLiveCall.ts`:

```ts
      if (document.visibilityState === "hidden") {
        // THE POLICY (S6 ①). With `background` off — or before the knobs have arrived, where there is
        // no call to keep yet — a hidden page ends it CLEANLY, exactly as it always did: …
        if (!bg.current?.background) { send({ type: "hidden" }); return; }
```

and `frontend/src/lib/pcmCapture.ts` stops the tracks on teardown (`for (const t of stream.getTracks())
t.stop();`). The owner's observation predates D73 S6, i.e. it was made under the `!background` branch:
half-leaving → `hidden` → call ends → tracks stop → `ReleaseInputStream` → §2.1's full restore →
`MODE_NORMAL`, SCO down, speakerphone restored → `STRATEGY_MEDIA` → A2DP → "it sounds good". No Android
mystery required.

**⚠ Consequence for D73: `background` now defaults to `True` (`config.py` `LiveCallCfg.background`), so
a backgrounded call KEEPS the capture — and the accidental workaround the owner discovered is gone.**
If S4 ever needs the "make it sound good again" escape hatch by hand, it is now `background: false`,
or ending the call.

*(Two candidates remain for a **non**-ctrl-b flip — an EMUI background-freeze of the capture, and an
audio-focus re-evaluation. Neither is needed to explain the observation, and neither is checked. If the
owner ever sees the flip happen while the call is still visibly alive on return, the explanation above
is falsified.)*

---

## 3. (c) The latch is real and it does not help

**The latch itself: VERIFIED.** `communication_mode_is_on_` is read exactly once per output stream, at
creation, in `MakeLowLatencyOutputStream` (`AAUDIO_USAGE_VOICE_COMMUNICATION : AAUDIO_USAGE_MEDIA`,
and `SL_ANDROID_STREAM_VOICE : SL_ANDROID_STREAM_MEDIA` on the OpenSLES path); `MakeLinearOutputStream`
is hard-coded `AAUDIO_USAGE_MEDIA`. Nothing in `audio_manager_android.cc` re-tags or re-opens a live
output on a mode or device change: the only things it does to `output_streams_` afterwards are
`SetMute` and `SetVolume`. This holds for **both** page paths (a `<audio>`/`MediaElement` sink and a
WebAudio destination both end up as one `AudioOutputStream` from this manager).

**The one re-creation mechanism that exists is desktop-only (VERIFIED).**
`media/audio/android/aaudio_bluetooth_output.h`:

```cpp
// Class which uses the AAudio library to playback output to a Bluetooth Classic
// device supporting both A2DP and SCO. It wraps two instances of
// `AAudioOutputStream`, each only functional for one of the two protocols, such
// that the correct of the two streams can be selected to play audio at a given time.
class AAudioBluetoothOutputStream : public MuteableAudioOutputStream {
  …
  void SetUseSco(bool use_sco_device);
```

It is constructed only when `device->GetAssociatedScoDevice().has_value()`, and
`GetDeviceForAAudioStream()` returns a bare `AudioDevice::Default()` (no associated SCO device)
whenever `!UseAAudioPerStreamDeviceSelection()`. On a phone `bluetooth_output_streams_` is therefore
always empty and `OnScoStateChangedOnAudioThread` returns immediately.

**But the latch buys nothing, because Android re-routes by strategy, not by when you opened the
stream (VERIFIED, AOSP `android10-release`).** `Engine::getDevicesForStrategyInt`:

```cpp
    case STRATEGY_MEDIA: {
        …
        if (isInCall() && (strategy == STRATEGY_MEDIA)) {
            device = getDeviceForStrategyInt(STRATEGY_PHONE, …);
            break;
        }
```

with `services/audiopolicy/common/include/policy.h`:

```cpp
static inline bool is_state_in_call(int state)
{
    return (state == AUDIO_MODE_IN_CALL) || (state == AUDIO_MODE_IN_COMMUNICATION);
}
```

and `AudioPolicyManager::setPhoneState` explicitly reroutes everything already open:

```cpp
    // reevaluate routing on all outputs in case tracks have been started during the call
    for (size_t i = 0; i < mOutputs.size(); i++) {
        …
        setOutputDevices(desc, newDevices, !newDevices.isEmpty(), 0 /*delayMs*/);
    }
```

**⇒ In `MODE_IN_COMMUNICATION`, a MEDIA-usage stream — however old — is routed to the `STRATEGY_PHONE`
device (earpiece, speaker if speakerphone is forced, SCO if SCO is forced). R74 §7-S2's "hold a silent
looping element open across the call" is refuted: the usage survives, the route does not. Do not build
it.**

---

## 4. Corroboration from outside my own reading

### 4.1 Chromium's own engineers hit exactly this and said so (VERIFIED — commit messages)

CL 5970174 (`78d0de1383`, landed 2024-11), *"android audio: Set communication mode when using Bluetooth
microphone"*:

> Setting communication mode is necessary to trigger the Android audio manager to switch the audio
> output from A2DP to SCO, ensuring proper audio routing to **prevent no sound issues** when using the
> Bluetooth headset.

That is §1.4 stated from the other direction: **SCO up + MEDIA usage = no sound**, and their fix was to
turn the comm mode *on* so the output follows the SCO link. It was reverted a year later (CL 6774461,
`66c77cdee9`, 2025-07-23) in favour of "`use_bt_sco_for_media`", whose public counterpart in the tree is
`AAudioBluetoothOutputStream` (§3) — i.e. **the platform's answer is "re-create the output on the SCO
device", which phones cannot reach.** *(I could not locate a `use_bt_sco_for_media` symbol in the public
Chromium tree; the referenced bug `b/426458377` is Google-internal.)*

### 4.2 Google's Oboe team, on the same failure (REPORTED — `google/oboe` wiki, *Bluetooth Audio*)

> Please call `startBluetoothSco()` and `setDeviceId()` at similar times. Not doing so will result in
> **the lack of sound**.

Same rule: raise SCO without moving the output stream onto the SCO device and you get silence. The page
also confirms the quality ordering — *"Compared to A2DP, SCO has worse audio quality but lower
latency."*

### 4.3 crbug 40222537 (REPORTED — tracker JSON, comment thread still unreadable)

The `/action/issues/40222537` JSON returns the issue: title *"Android 12+: Chrome ignores connected
bluetooth headphones, and audio output is the speaker"*, filed **2022-04-19** against Chrome
97.0.4692.98, components `Blink>WebRTC>Audio` / `Internals>Media>Audio`, assignee `tg…@chromium.org`,
**last modified 2024-03-13**, numeric status field `2` (Buganizer's `ASSIGNED`, i.e. still open —
*inferred* from the enum, no status string is served). **The comment stream is still not fetchable
without JS; the `/events` and `/comments` action endpoints 404 and the HTML page is a JS shell.** R74's
gap here stands.

### 4.4 The OEM layer (REPORTED — HONOR support `en-us00411000`)

HONOR's own troubleshooting for *"Music or video sounds are … played from the phone speaker instead of
the connected Bluetooth device"* names two things that bear directly on the table below: a **per-device
"Media audio" switch** in the Bluetooth settings that *"some devices automatically disable after
reconnecting"* (= the A2DP profile can be off while HFP is on — which would give the BT row *and* kill
A2DP), and the advice to *"close apps using voice call features, as these can disable Media audio"*
(= the OEM's own description of the SCO-suspends-A2DP behaviour of §1.4). Magic UI is an EMUI
derivative and its audio policy may diverge from AOSP; this is the one place I would expect it to.

---

## 5. THE DECISION TABLE — Honor 20, Android 10, classic BT headset connected

**The fork.** Every row below depends on one observable: **does Chrome's `enumerateDevices()` audioinput
list contain a `"Bluetooth headset"` row?** (⇔ `getProfileConnectionState(HEADSET) == STATE_CONNECTED`,
§1.2.) Call it **BT-row ON / OFF**. The page can read it in one line, before the call starts.

| # | Configuration | Mic path | TTS output path | Predicted quality | Confidence | What would falsify it |
|---|---|---|---|---|---|---|
| **1a** | `route: headphones` (AEC off) + **default** input, **BT-row ON** | SCO/HFP mic, 8 kHz mono (`FOR_RECORD=FORCE_BT_SCO`) | `AAUDIO_USAGE_MEDIA` → A2DP output → **suspended → frames discarded** | **SILENT TTS.** Mic works, nothing is heard | **HIGH** (§1.4 ①–④ all source-verified; corroborated by Chromium's own CL and the Oboe wiki) | Hearing the TTS at all. Most likely OEM divergence in `checkA2dpSuspend`, or a headset whose SCO handshake fails (then → row 1b's shape with an earpiece fallback) |
| **1b** | `route: headphones` + **default** input, **BT-row OFF** | phone built-in mic (`AUDIO_DEVICE_IN_BUILTIN_MIC`) | `MEDIA` → `STRATEGY_MEDIA` → **A2DP** | **full-quality TTS in the headphones** — the D73 target | **HIGH** (§1.5; both force-use slots verified disjoint) | TTS from the phone speaker ⇒ the OEM consults `FOR_COMMUNICATION` in `STRATEGY_MEDIA`, or HONOR's per-device **"Media audio"** switch is OFF (§4.4) |
| **2** | `route: headphones` + **"Bluetooth headset"** picked | SCO/HFP mic | same as 1a | **SILENT TTS** — strictly worse than doing nothing | **HIGH** (identical mechanism to 1a, just explicit) | as 1a |
| **3** | `route: headphones` + **"Speakerphone"** picked | phone built-in mic | `MEDIA` → **A2DP** (`FOR_COMMUNICATION=FORCE_SPEAKER` is invisible to `STRATEGY_MEDIA`) | **full-quality TTS in the headphones** | **MEDIUM-HIGH** — mechanism VERIFIED, but the label lies to the owner and it **leaks `FORCE_SPEAKER`** (§2.1), which the next phone call inherits | TTS from the phone speaker ⇒ OEM divergence; or a later phone call answering on speaker ⇒ the leak is real and user-visible |
| **3′** | `route: headphones` + **"Headset earpiece"** picked *(not in the brief; strictly better than 3)* | phone built-in mic | `MEDIA` → **A2DP** | **full-quality TTS in the headphones** | **MEDIUM-HIGH** — same mechanism as 3, and `setSpeakerphoneOn(false)` is a **no-op** when speakerphone is already off (`if (wasOn == on) return;`) ⇒ **nothing is forced and nothing leaks** | as 3; plus: if the earpiece row is absent (it is suppressed only by a wired/USB device) |
| **4** | `route: speaker` (today) — `{ideal:"all"}` | BT-row ON → SCO mic; OFF → built-in mic | `AAUDIO_USAGE_VOICE_COMMUNICATION` + `MODE_IN_COMMUNICATION` ⇒ `STRATEGY_PHONE`: **SCO** if it came up, else **SPEAKER** (if Speakerphone was selected) or **EARPIECE** | BT-row ON → tinny-but-audible **in the headphones**; OFF → **loudspeaker at call volume** = the owner's symptom | **HIGH** (R74 §1 + §3 re-verified at this pin) | — |

**Verdict for the default-headphones row (1a/1b).** `route: headphones` **on its own is a coin-flip
decided by the BT row, and the losing side is silence, not degraded audio.** But the owner's own
symptom is evidence about which side they are on: in row 4 with **BT-row ON**, the TTS would have come
out *of the headphones* over SCO — tinny, not "from the phone speaker". A failed SCO handshake would
have landed on the **earpiece**. Loud, distorted, *loudspeaker* audio is the signature of
`setSpeakerphoneOn(true)` + `MODE_IN_COMMUNICATION`, which only happens when `selectDefaultDevice`
falls through to Speakerphone — i.e. **BT-row OFF**. So the most likely reading is:

> **The owner is in row 1b, and `route: headphones` will deliver A2DP-quality TTS on their phone as
> built — but by luck, not by construction.** The input picker does not *have* to steer anywhere on
> *that* phone+headset pair; on any pair that exposes HFP it absolutely does, and then it must steer
> **away** from Bluetooth (3′ preferred, 3 acceptable), never toward it. Playback does **not** have to
> pre-exist the capture, and making it pre-exist would not help (§3).

---

## 6. What I could not determine

- **The crbug 40222537 comment thread** — still JS-only; the `/action/issues/<id>` JSON serves the
  description and metadata but no comments, and `/events`, `/comments`, `/issueUpdates` all 404. The
  "still open / `ASSIGNED`" reading is *inferred* from an undocumented numeric enum.
- **Whether Magic UI 3.x (EMUI, Android 10) follows AOSP here.** Every Android-side claim above is
  AOSP `android10-release`. HONOR's own support page (§4.4) shows the OEM has extra state (the
  per-device *Media audio* switch) that AOSP does not, and Huawei has historically patched
  `AudioPolicyManager`. **Rows 1a/1b/3/3′ are AOSP predictions, not Honor measurements.**
- **Whether the owner's headphones expose HFP at all** — the single bit the whole table forks on. One
  line of JS on the phone settles it; no probe was run (no phone in this session).
- **How long the leaked SCO link in §2.1 actually survives** on a real device: AOSP ties SCO clients to
  the caller's `IBinder`, which for Chrome is process-lived, but OEM SCO timeouts and the headset's own
  idle disconnect are unmeasured. The audible symptom, if it happens, is "media stays silent after the
  call ends until Chrome is killed" — worth watching for at S4.
- **Whether `AAUDIO_INPUT_PRESET_GENERIC` changes the mic's tonal character enough to matter for
  Whisper/Speaches accuracy.** It removes the platform's voice-comm processing chain (§1.6); AGC stays.
  Unmeasured.
- **The `use_bt_sco_for_media` flag** named in Chromium's revert CL — not present under that name in
  the public tree; its bug is Google-internal.
- **Android 11.** Everything here is the PreS class, which covers API ≤30, but the AOSP quotes are
  `android10-release` specifically. Android 11's audio policy is very close but was not read.

---

## 7. Implications for ctrl-b

*(Short and separate, per the folder's convention. Evidence above ages slowly; this reading ages fast.)*

**① Make the route picker steer, not just offer.** D73 shipped `route` and `input_device` as
independent knobs, with `input_device: ""` (system default) as the default. On Android that default is
**not neutral** — it is "let Chrome pick the most unique device", and the most unique device is the one
that kills our audio (§1.2, §1.4). The cheap, correct move at S4: when `route === "headphones"`, read
`enumerateDevices()`, and **if a `"Bluetooth headset"` audioinput row exists, resolve `input_device` to
`"Headset earpiece"` (else `"Speakerphone"`) instead of the default** — as an `ideal` deviceId, exactly
as `input_device` already does. One derived value in the one normalize that already owns the capture
constraints; no new knob, no UA sniff, and it degrades to a no-op on desktop where those labels never
appear.

**② Do not offer "Bluetooth headset" as a route the app steers into** — R74 §9 already said so for
quality reasons; this pass upgrades it from "costs quality" to **"costs the audio entirely"** on
Android 10. Leave it in the list if the picker is shown (it is the honest device list), but never
select it programmatically, and label the consequence.

**③ Delete the S2 workaround from the plan.** "Hold a silent element open so the mouth's output stream
predates the ear's" is refuted (§3): the usage is latched, the *route* is not. It would cost battery and
buy nothing.

**④ Know that D73 S6 removed the escape hatch.** `background: True` means a hidden page now keeps the
capture, so half-leaving the app no longer restores A2DP (§2.2). If S4 wants a manual "fix the audio"
lever on the phone, it is ending the call — or `background: false`. Worth one line in the S4 script so
the owner is not surprised that the trick they found stopped working.

**⑤ The S4 probe list, sharpened.** R74 proposed four rows; this pass says run **five**, and log one
extra field:

| Run | Constraints | `input_device` | Log |
|---|---|---|---|
| A | today (`{ideal:"all"}`) | default | where TTS comes out, how it sounds |
| B | `false` | default | **…and whether it is SILENT** (the 1a signature) |
| C | `false` | "Bluetooth headset" | expected silent — confirm |
| D | `false` | "Speakerphone" | expected good |
| E | `false` | "Headset earpiece" | expected good, and no speakerphone leak afterwards |

**Plus, before any of them: `navigator.mediaDevices.enumerateDevices()` and paste the audioinput
labels.** That one line decides which half of the table the owner lives in, and if `"Bluetooth
headset"` is absent, runs C/E collapse and B is expected to simply work. Afterwards, place a phone call
and check whether it answers on speakerphone — that is the §2.1 leak, and run D is what would have
caused it.
