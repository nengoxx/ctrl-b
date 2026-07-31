# R14 — Wake word on Android: can a browser do it, or do we need a wrapper?

**Date:** 2026-07-31 · **Status:** DRAFT dossier (evidence, not a decision) · **Drove:** ROADMAP §C2
(Wake word) — feasibility ruling still open.

**Bounded question.** The owner wants an optional always-listening wake word ("hey ctrl-b") for the
ctrl-b PWA on an Android phone, in Firefox (build unknown — official or F-Droid/Fennec) or Chrome.
ROADMAP §C2 specifies **client-side detection** (openWakeWord / Porcupine WASM class) so no audio
leaves the device until the phrase fires, then hand off to the existing `useDictation` STT path.
**Can this be pure web, and under exactly what conditions? If not, what is the minimal native
wrapper?**

Secure context is *already solved* — the PWA is served over Tailscale Serve HTTPS
(`https://emma.lobster-vector.ts.net`), and `useDictation.ts` already models the insecure-context
case. Nothing here is blocked on HTTPS.

---

## 0. Verdict up front

| Tier | Chrome Android | Firefox Android (Gecko) |
|---|---|---|
| **(a) Foreground, screen on** ("phone docked on a stand showing the dashboard") | **SHIP-VIABLE** | **SHIP-VIABLE with a device check** (two open risks: mic-permission persistence, AudioContext sample-rate) |
| **(b) Backgrounded / screen off, pure web** | **PLAUSIBLE but unproven** — Chrome holds a `microphone`-typed Android foreground service while a page captures; must be measured on the owner's phone, and OEM battery policy can still kill it | **DEAD** — Firefox for Android's manifest declares *no* microphone foreground service, so Android's background-sensor rule mutes the mic |
| **(c) True always-listening** | Minimal **wrapper**: a small native Android app running a mic-typed foreground service with an on-device wake engine, which foregrounds the existing web app on detection. ~1 week of work. This is exactly what Home Assistant shipped in 2026. | same |

The single decision-changing fact: **the pure-web ceiling is set by an Android OS rule, not by the
web platform** — a process with no visible activity and no `microphone`-typed foreground service
cannot read the mic, and only Chrome (not Firefox) ships that service.

---

## 1. Engines that actually run in a mobile browser

### 1.1 Summary table

| Engine | Runs in browser? | Model size | Custom phrase "hey ctrl-b" | License / cost | Maintenance | Verdict |
|---|---|---|---|---|---|---|
| **Picovoice Porcupine Web** | Yes (WASM + Web Worker) | not published | Console-trained `.ppn` | **Free tier DEAD 2026-06-30**; next tier reported $899/mo | active, commercial | **RULED OUT** |
| **openWakeWord via onnxruntime-web** (community wrappers) | Yes — two working ports | ~3.7 MB (3 ONNX files) | requires training a new model (Colab, <1 h) | code Apache-2.0; **pre-trained models CC BY-NC-SA 4.0** | upstream says browser is *not on the roadmap*; ports are hobby-scale | **Best open option for a fixed phrase** |
| **sherpa-onnx KWS (WASM)** | Yes — **official `wasm/kws` build in-tree** | ~19 MB (3.3 M params, English) | **arbitrary keywords, no retraining** | Apache-2.0 | very active | **Best option for the exact phrase** — but heavy |
| **microWakeWord** | No browser build | **52–60 KB** per word (TFLite-Micro) | must train | Apache-2.0 | active (ESPHome / HA) | **Best *native* engine** (this is what HA ships on Android) |
| **TFJS `speech-commands`** | Yes | ~1 MB | 18 fixed English words + transfer learning | Apache-2.0 | **v0.5.4, last published ~4 years ago** | **Effectively unmaintained; wrong shape** |
| **Vosk-browser** | Yes | **~50 MB/language** | full ASR, so any phrase | Apache-2.0 | maintained | **Too heavy to run continuously on a phone** |

### 1.2 Porcupine — ruled out by a 2026 licence change (the biggest single finding)

- **REPORTED (Hacker News submission, quoted from a Picovoice customer email, ~late May 2026):**
  > "Picovoice is sunsetting its Free Tier and moving to a 7-day Free Trial for product teams. This
  > change will take effect on June 30, 2026."
  <https://news.ycombinator.com/item?id=48248969>
- **REPORTED (Home Assistant community thread, 2026-06-04):** Free Tier AccessKeys "will be
  disabled" after 2026-06-30 and "features using those keys will stop working"; Picovoice said
  "Going forward, we'll be focusing on our core business, enterprise deployments", with no
  non-commercial tier planned.
  <https://community.home-assistant.io/t/fyi-picovoice-confirmed-free-tier-accesskeys-will-stop-working-after-june-30-2026/1012744>
- **VERIFIED (Picovoice's own FAQ, read 2026-07-31):** the company now describes itself as a
  "B2B company focused on on-device AI tools for enterprises" and states "the Free Trial is a
  one-time offer, and it doesn't renew automatically once the trial ends." No free personal tier is
  offered. <https://picovoice.ai/docs/faq/general/>
- **VERIFIED:** an AccessKey is mandatory — the Web quick-start says you must "Signup or Login to
  Picovoice Console to get your `AccessKey`". <https://picovoice.ai/docs/quick-start/porcupine-web/>
- **REPORTED:** validation happens at engine initialization, "before offline data processing"; the
  docs never claim runtime network independence. Whether initialization can succeed with no network
  is **UNVERIFIED** — and moot, because the key itself is being revoked.

> **Correction to a premise we held.** ROADMAP §C2 names "openWakeWord / Porcupine WASM" as the two
> candidate engines. **Porcupine is no longer available on any free tier as of 2026-06-30** — that
> half of the §C2 sentence is stale and should be struck. Home Assistant's ecosystem is going
> through the same forced migration right now.

### 1.3 openWakeWord in the browser — real, but community-grade

- **VERIFIED (upstream README, read 2026-07-31):** dscripka/openWakeWord is a 3-stage pipeline
  (melspectrogram ONNX → Google speech-embedding backbone → small per-word classifier). On browser
  support the README says:
  > "While the ONNX runtime does support javascript, much of the other functionality required for
  > openWakeWord models would need to be ported. This is not currently on the roadmap."
  Its documented workaround is streaming browser audio over WebSockets into a Python backend —
  **exactly what §C2 wants to avoid.** <https://github.com/dscripka/openWakeWord>
- **VERIFIED:** performance claim — *"a single core of a Raspberry Pi 3 can run 15-20 openWakeWord
  models simultaneously in real-time."* One model therefore costs roughly **5–7 % of a Cortex-A53
  @1.2 GHz core**; a modern phone big core is several times faster, so ~1–3 % of one core is the
  right order of magnitude for the inference itself. (The battery cost is *not* the inference — see
  §7.3.)
- **VERIFIED:** licences — code Apache-2.0, **pre-trained models CC BY-NC-SA 4.0**. Fine for a
  single-user homelab; would block redistribution as a commercial product.
- **VERIFIED (two independent browser ports exist, both 2025):**
  - `dnavarrom/openwakeword_wasm` — "Small browser-first wrapper around the OpenWakeWord models
    using onnxruntime-web… directly in Chrome, no native layer required." Uses **AudioWorklet**,
    1280-sample (80 ms) chunks at 16 kHz, Silero VAD gate with a 12-frame hangover. **8 commits
    total** — hobby scale, no licence declared, no perf numbers.
    <https://github.com/dnavarrom/openwakeword_wasm>
  - Deep Core Labs, "Open Wake Word on the Web", **2025-07-12** — onnxruntime-web with a hybrid
    backend: WebGPU for the classifier, **WASM forced for melspectrogram + VAD** because those
    operators are unsupported elsewhere; WebGL is unusable. Notes a minimum of **1.28 s of audio
    before the first detection** and that the pipeline must run continuously to keep its history
    buffers. A reader comment (Oct 2025) reports it "only worked in Chrome – not Firefox" due to
    **AudioContext sample-rate conflicts** (later resolved). No CPU/latency figures published.
    <https://deepcorelabs.com/open-wake-word-on-the-web/> · live demo
    <https://deepcorelabs.com/projects/openwakeword/>
- **VERIFIED model sizes** (GitHub contents API on `dnavarrom/openwakeword_wasm/models`, read
  2026-07-31) — these are the numbers that decide the download budget:

  | File | Bytes |
  |---|---|
  | `melspectrogram.onnx` | 1,087,958 |
  | `embedding_model.onnx` | 1,326,578 |
  | `hey_jarvis_v0.1.onnx` (classifier) | 1,271,370 |
  | `hey_mycroft_v0.1.onnx` | 857,691 |
  | `hey_rhasspy_v0.1.onnx` | 204,081 |
  | `silero_vad.onnx` (optional gate) | 1,807,522 |

  **≈ 3.7 MB** for a working 3-stage pipeline, **≈ 5.5 MB** with the VAD gate — plus the
  onnxruntime-web WASM binary itself (~10 MB uncompressed for the SIMD build, **UNVERIFIED** exact
  size). Cacheable by the service worker; a one-time cost, not per-launch.
- A custom "hey ctrl-b" classifier means **training a new model** — upstream provides an automated
  Colab notebook claimed to finish in "<1 hour" using synthetic speech. Only the ~1.3 MB classifier
  changes; the 2.4 MB front-end is shared. **REPORTED** (README), not exercised.

### 1.4 sherpa-onnx KWS — the sleeper, and the only one that takes an arbitrary phrase

- **VERIFIED (GitHub contents API, read 2026-07-31):** `k2-fsa/sherpa-onnx` has an in-tree
  **`wasm/kws/`** directory — `CMakeLists.txt`, `app.js`, `index.html`, `sherpa-onnx-kws.js`,
  `sherpa-onnx-wasm-main-kws.cc`, `assets/`. This is an **official, maintained** browser
  keyword-spotting build, not a third-party port.
  <https://github.com/k2-fsa/sherpa-onnx/tree/master/wasm/kws>
- **VERIFIED (sherpa KWS pretrained-models docs):** open-vocabulary KWS — a tiny ASR that can only
  decode the phrases you list. Custom keywords are a **text file, converted with
  `sherpa-onnx-cli text2token`; no retraining.** The docs say: *"Each line contains a keyword, you
  MUST provide the original keyword (starting with `@`) and the original keyword CAN NOT contain
  spaces, please replace spaces with underscores"* — i.e. `@hey_ctrl_b` is literally the input
  format. Models: `…kws-zipformer-gigaspeech-3.3M-2024-01-01` (English, 3.3 M params, **~19 MB**),
  `…wenetspeech-3.3M` (Chinese, ~18 MB), `…zh-en-3M-2025-12-20` (~38 MB).
  <https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html>
- **VERIFIED (read `wasm/kws/app.js`, 2026-07-31):** the shipped demo captures with the **deprecated
  `ScriptProcessorNode`**, not AudioWorklet:
  ```js
  var bufferSize = 4096;
  if (audioCtx.createScriptProcessor) {
    recorder = audioCtx.createScriptProcessor(bufferSize, numberOfInputChannels, numberOfOutputChannels);
  }
  audioCtx = new AudioContext({sampleRate: 16000});
  ```
  `ScriptProcessorNode` runs its callback **on the main thread**, so this demo as-shipped is exactly
  the shape that background throttling kills (§3.4). Swapping it for an AudioWorklet is our work,
  not upstream's.
- **Trade-off:** ~19 MB and a continuously-running zipformer is far heavier than openWakeWord's
  ~3.7 MB / 80 ms-frame classifier. Its payoff is that **"hey ctrl-b" needs no model training at
  all** — a decisive property for a one-user project that does not want to own a training pipeline.

### 1.5 microWakeWord — smallest by 20×, but not a browser engine

- **VERIFIED (repo README):** MixConv mixed-depthwise streaming CNN for **TensorFlow Lite for
  Microcontrollers**; spectrogram features every 10 ms, streaming inference every 30 ms. Apache-2.0.
  No browser/Android story in the repo — it targets microcontrollers.
  <https://github.com/kahrendt/microWakeWord>
- **VERIFIED model sizes** (GitHub contents API, `esphome/micro-wake-word-models/models/v2`, read
  2026-07-31): `okay_nabu.tflite` **60,264 B**, `hey_mycroft.tflite` 57,248 B, `alexa.tflite`
  55,856 B, `hey_jarvis.tflite` 52,272 B, `vad.tflite` 34,328 B. **~20× smaller than
  openWakeWord's ONNX pipeline** — which is why it is the engine Home Assistant chose for phones
  (§6).

### 1.6 Also-rans

- **TFJS `speech-commands`** — **REPORTED:** npm `@tensorflow-models/speech-commands` is at
  **0.5.4, last published ~4 years ago**. Its browser-FFT model recognises 18 fixed English words
  with transfer learning; it is not a phrase spotter. Unmaintained + wrong shape.
- **Vosk-browser** — full offline ASR; **REPORTED** per-language models ~50 MB. Running full ASR
  continuously to catch one phrase is the wrong trade on a phone.
- **DaVoice `frymanofer/Web_WakeWordDetection`** — **VERIFIED:** ONNX-based, MIT code, but custom
  wake words require emailing `info@davoice.io` and a licence key is validated before init. **22
  stars.** Same lock-in shape as Porcupine at a fraction of the maturity. Not recommended.

---

## 2. Foreground case — app open, screen on

**VERDICT: works, on both engines and both browsers, with two Firefox caveats to check on device.**

- **VERIFIED (MDN browser-compat-data `api/AudioWorklet.json`, read 2026-07-31):** AudioWorklet
  `version_added` — Chrome **66**, Firefox **76**, Safari **14.1**; `chrome_android`,
  `firefox_android`, `samsunginternet_android` and `webview_android` are all **`mirror`** entries,
  i.e. they inherit the desktop version. So **Firefox for Android has had AudioWorklet since
  Firefox 76**; there is no mobile-specific gap. Secure context required — already satisfied.
- **VERIFIED:** Picovoice's own Web docs list "Chrome & Chromium-based browsers, Edge, Firefox,
  Safari" — i.e. Gecko is a first-class target for this class of WASM audio work generally.
- **REPORTED (Deep Core Labs comment thread, Oct 2025):** the openWakeWord web demo initially
  "only worked in Chrome – not Firefox" because of **AudioContext sample-rate conflicts**. This is
  the one concrete Gecko-specific audio-capture hazard found: Gecko and Blink differ in how they
  resolve `new AudioContext({sampleRate: 16000})` against the hardware capture rate. **Mitigation:
  never assume 16 kHz — read `audioCtx.sampleRate` and resample in the worklet.** (`useDictation.ts`
  already carries an analogous lesson for container/mime negotiation.)
- **Fennec / F-Droid builds:** no evidence of any audio-capture divergence was found. F-Droid Fennec
  and official Firefox for Android share GeckoView; the known divergences in our own R10 dossier are
  about **push transport** (FCM vs UnifiedPush), which is orthogonal to `getUserMedia`. **UNVERIFIED
  but expected: no Fennec-specific audio-capture issue.**
- Practical shape for the foreground tier: **one** `getUserMedia` stream fanned out to (i) an
  AudioWorklet running the detector and (ii) the existing `MediaRecorder` when dictation starts.
  Do **not** open a second stream.

---

## 3. The hard part — backgrounded and screen-off

This section decides the whole question. The controlling constraint is **Android's**, not the web
platform's.

### 3.1 The Android platform rule (VERIFIED, primary)

> "Android 9 limits the ability for background apps to access user input and sensor data. If your
> app is running in the background on a device running Android 9, the system applies the following
> restrictions to your app:
> * Your app cannot access the microphone or camera. […]
> If your app needs to detect sensor events on devices running Android 9, use a
> [foreground service](/guide/components/services#Foreground)."

<https://developer.android.com/about/versions/pie/android-9.0-changes-all> (read 2026-07-31)

Android 11 tightened the same area (**VERIFIED**):

> "If your app starts a foreground service while running in the background, the foreground service
> cannot access the microphone or camera."

and

> "If your app targets Android 11 or higher and accesses the camera or microphone in a foreground
> service, you must include the `camera` and `microphone` foreground service types."

<https://developer.android.com/about/versions/11/privacy/foreground-services>

**So: to keep capturing with the screen off, the *browser app* must hold a `microphone`-typed
foreground service.** A web page cannot create one. Whether it exists is a property of the browser
binary — and this is where Chrome and Firefox diverge completely.

### 3.2 Chrome for Android — it *does* hold a microphone foreground service (VERIFIED, source)

From Chromium's `chrome/android/java/AndroidManifest.xml` (read 2026-07-31):

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CAMERA" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
...
<service android:name="org.chromium.chrome.browser.media.MediaCaptureNotificationService"
  {% if enable_screen_capture == "true" %}
  android:foregroundServiceType="camera|microphone|mediaProjection|mediaPlayback"
  {% else %}
  android:foregroundServiceType="camera|microphone"
  {% endif %}
  android:exported="false"/>
```

And the service's own class comment (`MediaCaptureNotificationServiceImpl.java`, read 2026-07-31):

> "Service that creates/destroys the WebRTC notification when media capture starts/stops."

It calls `startForeground()` and derives its type via `getRequiredForegroundServiceType()`, which
can include `FOREGROUND_SERVICE_TYPE_MICROPHONE`. **This is the persistent "site is using your
microphone" notification** users see on Android.

Independently, Chrome's tab-freezing policy will not freeze a capturing page. From
`components/performance_manager/public/freezing/cannot_freeze_reason.h` (read 2026-07-31), the
enum includes:

```
kVisible, kRecentlyVisible, kAudible, kRecentlyAudible, kFreezingOriginTrialOptOut,
kHoldingWebLock, kHoldingIndexedDBLock, kHoldingBlockingIndexedDBLock,
kConnectedToUsbDevice, kConnectedToBluetoothDevice, kConnectedToHidDevice,
kConnectedToSerialPort, kCapturingVideo, kCapturingAudio, kBeingMirrored,
kCapturingWindow, kCapturingDisplay, kWebRTC, kLoading, kNotificationPermission,
kOptedOut, kMostRecentlyUsed, kWebUI
```

**`kCapturingAudio` is an explicit "cannot freeze" reason.** So on the renderer side, an actively
capturing ctrl-b tab is protected from freezing/discarding.

**Counter-evidence, and it matters:**

- **REPORTED (w3c/mediacapture-main issue #670, Roman Shpount, 2020-03-23):**
  > "If you are on the call via WebRTC in Chrome on Android, switching display off stops microphone
  > and playback a short time after the screen is turned of."

  He frames it as "a frequently reported complaint from WebRTC application users on mobile".
  <https://github.com/w3c/mediacapture-main/issues/670>. The issue is about capture indicators/mute
  semantics generally and contains **no vendor explanation** of the Android behaviour; it is 6 years
  old and predates the Android 11–14 foreground-service-type regime.
- **REPORTED (Google Chrome Help, Android, read 2026-07-31):** "Sites can start to record when
  you're on the site." … "If you're using a different Chrome tab or a different app, a site can't
  start recording." Note the verb — **"start"**. This documents that a *new* capture cannot begin
  in the background; it does not say an in-flight capture stops.
- **REPORTED (multiple 2025 how-tos and OEM forum threads):** background audio in Chrome Android is
  routinely killed by **OEM battery optimisation**, and the fix is Android Settings → Apps → Chrome
  → App battery usage → **Unrestricted**. This is device-policy, not Chrome policy, and it will
  bite a Samsung/Xiaomi phone hardest.

**Reading:** the source evidence says Chrome is *architected* to keep capturing with the screen off
(mic-typed FGS + freeze exemption); the field evidence says users nonetheless lose it, largely to
OEM power management. **This is empirically resolvable in 10 minutes on the owner's actual phone and
must be, before any code is written.** Rated **PLAUSIBLE, UNPROVEN**.

### 3.3 Firefox for Android — no microphone foreground service exists (VERIFIED, source)

From Fenix's `mobile/android/fenix/app/src/main/AndroidManifest.xml` (searchfox, read 2026-07-31):

- **`RECORD_AUDIO` is declared.**
- **No `FOREGROUND_SERVICE*` `uses-permission` entry of any kind is present.**
- The only foreground-service-typed services are:

  | Service | `foregroundServiceType` |
  |---|---|
  | `MediaSessionService` | `mediaPlayback` |
  | `DownloadService` | `dataSync` |
  | `PrivateNotificationService` | `specialUse` |
  | `ProfilerService` | `specialUse` |

  `mediaPlayback` covers **playing** audio (podcasts, video). **Nothing covers capture.**

GeckoView's own manifest (`mobile/android/geckoview/src/main/AndroidManifest.xml`) declares only
`ACCESS_NETWORK_STATE`, `INTERNET`, `WAKE_LOCK`, `MODIFY_AUDIO_SETTINGS` and defines no services.

**Combine with §3.1: when Firefox for Android has no visible activity — screen locked, or the user
switched apps — its process is a background app with no `microphone`-typed FGS, and the OS denies it
the microphone.** Background wake-word listening in Firefox Android is not a bug to work around; it
is **structurally impossible** without a Firefox change.

Supporting (weaker, older) evidence in the same direction:

- **REPORTED (mozilla-mobile/fenix #9691, filed 2020-04-03, labelled `needs:gv` — i.e. requires a
  GeckoView fix):** a background tab **"stops playing media after about 40 seconds"** and the tab
  is unloaded; returning to it reloads the page from scratch. Even *playback* — the case Fenix has a
  service for — has historically been fragile in background tabs.
  <https://github.com/mozilla-mobile/fenix/issues/9691>
- **REPORTED:** Firefox for Android **does not support `display: standalone`** — installed web apps
  open in browser mode. So "install the PWA" buys nothing structural on Firefox; the ceiling is the
  same as a tab. (MDN's installable-PWA guide does state "On Android, Firefox, Chrome, Edge, Opera,
  and Samsung Internet Browser all support installing PWAs" — **VERIFIED** — but installing ≠
  standalone; Bugzilla 1285858 "Support manifest display: standalone display mode" is the tracking
  bug. Its current resolution is **UNVERIFIED**.)

### 3.4 What the web platform gives you, and what it doesn't

- **Screen Wake Lock API — VERIFIED (MDN, read 2026-07-31):** it prevents the screen dimming/locking
  and nothing more. It explicitly does **not** prevent CPU/system sleep, and:
  > "Only active documents can acquire screen wake locks and previously acquired locks are
  > automatically released when document becomes inactive."

  It is also released "if the battery power is too low or the document is not active or visible".
  **So Wake Lock is a *screen-on* tool, useless for the screen-off case — but it is exactly the
  right tool for the docked-dashboard tier (a).** Baseline since March 2025; secure context;
  `screen-wake-lock` permissions-policy.
- **Timer throttling — VERIFIED (Chrome for Developers, "Timer throttling in Chrome 88"):**
  intensive throttling (timers checked **once per minute**) applies when "The page has been hidden
  for more than 5 minutes. The chain count is 5 or greater. The page has been silent for at least
  30 seconds. WebRTC is not in use." The exemptions listed are audible playback in the last 30 s and
  *"an RTCPeerConnection with an 'open' RTCDataChannel or a 'live' MediaStreamTrack"* — note the
  exemption is scoped to an **RTCPeerConnection**, not a bare `getUserMedia` track.
  **Architectural consequence: never drive the detector from `setInterval`/`setTimeout`.** Put the
  inference in an **AudioWorklet** (real-time audio thread, pull-driven by the audio device) or in a
  Worker fed by the worklet — which is what the openWakeWord ports already do, and what the
  sherpa demo does *not* (§1.4).
- **onnxruntime-web threading — REPORTED:** multi-threaded WASM needs `SharedArrayBuffer`, which
  needs cross-origin isolation (`COOP: same-origin` + `COEP: require-corp|credentialless`). Turning
  those on for the whole ctrl-b PWA would be a large, risky change (it constrains every subresource
  and iframe). **Plan for single-threaded WASM+SIMD.** Reported figures put threads+SIMD at ~3.4×
  over plain WASM — so the single-thread budget is the one that must fit.

### 3.5 Installed PWA vs plain tab

- **Chrome:** installing creates a **WebAPK**, but **REPORTED** — "Permissions and data are managed
  by Chrome; cookies/storage are shared." Rendering and capture still happen in Chrome's process, so
  the mic-typed FGS and the freeze exemption are the same either way. Installing improves launch UX
  and gives a home-screen icon; it does **not** change the background ceiling. **UNVERIFIED** whether
  a WebAPK's Android task being "recent" changes OEM battery treatment.
- **Firefox:** no standalone mode (§3.3) — installing changes nothing.

---

## 4. Permission persistence

A wake word that re-prompts on every launch is dead on arrival, so this is a gating question.

- **Chrome Android — favourable.** **REPORTED:** the "Allow this time" / "Allow on every visit"
  one-time-permission UI shipped from Chrome 116 **desktop only**; "currently, 'Allow this time'
  will only show up on desktop Chrome. The mobile version will remain as is." So Chrome Android
  keeps the classic **Allow / Block** prompt with a **persistent per-origin grant**.
  <https://developer.chrome.com/blog/one-time-permissions>. Google's Android help page confirms the
  prompt is "tap **Allow** or **Block**" but **does not state** the retention period — so treat
  "persists indefinitely" as **REPORTED, not VERIFIED**. Also note the desktop one-time-permission
  expiry rules include *"if the page has been running in the background for more than five
  minutes"* — a hint that Chrome is willing to revoke background capture on a timer; whether any
  such rule reaches Android is **UNVERIFIED**.
- **Firefox Android — unresolved, and the evidence conflicts.**
  - **VERIFIED (mozilla-mobile/fenix issue #2403, 2019):** Fenix's camera/mic prompt *did* have a
    "Remember this decision" checkbox, and the bug was that it defaulted **checked**. So the
    mechanism exists in the product.
  - **VERIFIED (searchfox, `SitePermissionsFeature.kt`, read 2026-07-31):** on grant, the code
    branches `if (shouldStore) storeSitePermissions(...) else storage.saveTemporary(...)`, with a
    hard exclusion only for private browsing (`if (contentState.private) return`). **There is no
    special-case exclusion for microphone** in this file — but the origin of `shouldStore` is in the
    dialog layer and was not located.
  - **REPORTED (Mozilla SUMO, Firefox-for-Android answer):** Firefox "will always display a message
    asking for permission each time a site asks to … record audio" and "never records audio … unless
    you opt in each time it asks."
  - **Net: UNDETERMINED.** This must be checked on the owner's actual phone (§9).

Both browsers additionally sit behind the **Android app-level `RECORD_AUDIO` runtime permission**,
which on modern Android offers "Allow only while using the app" / "Ask every time" / "Deny" — there
is **no "Allow all the time" for the microphone**, which is itself a restatement of §3.1.

---

## 5. The wrapper ladder

### 5.1 TWA / Bubblewrap — changes nothing by itself

A Trusted Web Activity is a thin Android app that asks **Chrome** to render your origin full-screen.
The page still executes in Chrome's process, under Chrome's permissions and Chrome's foreground
service. **A TWA host app cannot add a microphone FGS that covers Chrome's capture** — an FGS
extends *its own* app's while-in-use state, not another app's. So TWA alone moves nothing in §3.

**But** — and this is the useful nuance — a TWA host app *can* run its **own** mic-typed foreground
service with its **own** wake engine, and on detection `startActivity` the TWA (or deep-link the
installed PWA) with e.g. `?wake=1`. That is a legitimate minimal wrapper and it keeps Chrome as the
renderer, so the PWA's behaviour is identical to today. Cost: two apps contend for the microphone —
the wake service must release capture before the page opens it. Android 10+ concurrent-capture rules
make this **expected to work with an explicit stop/start handoff**, but it is **UNVERIFIED**.

### 5.2 Capacitor (or a bare WebView shell) — the recommended shape

Here the WebView runs **inside your own app process**, so `getUserMedia` in the page is your app's
`RECORD_AUDIO` capture, and **your** mic-typed foreground service keeps it alive. That is the
structural difference from TWA.

Building blocks that exist and are maintained:

- **`@capawesome-team/capacitor-android-foreground-service`** — Capacitor plugin to run an Android
  foreground service (types configurable). **REPORTED** maintained.
- **`Cap-go/capacitor-audio-recorder`** — "keep active in background"; its README **REPORTED** spells
  out the requirement: `FOREGROUND_SERVICE`, **`FOREGROUND_SERVICE_MICROPHONE`**, `WAKE_LOCK`, and
  notes the plugin "does not create the service for you".
- **Porcupine Capacitor plugin (`JulienLecoq/porcupine-wake-word`)** — exists, Android+iOS, **no web
  platform**, **2 stars**, maintained-badge from **2022**. **Do not build on this** — it is
  effectively abandoned *and* its engine's free tier is gone (§1.2).
- **Picovoice's own `demo/android/Service`** shows the background-service pattern — **REPORTED** it
  "continues listening for wake words even when apps are switched or the phone is asleep" — useful
  as a *reference architecture* even though the engine is now unavailable.

**Recommended engine inside the wrapper: microWakeWord (52–60 KB, TFLite) or openWakeWord ONNX via
onnxruntime-android — not Porcupine.** microWakeWord is what HA ships for exactly this job (§6).

### 5.3 Tauri mobile — possible, thinner ecosystem

**REPORTED:** `tauri-plugin-background-service` exists and on Android "uses a Foreground Service with
persistent notification, and `START_STICKY`". Tauri v2 mobile is younger than Capacitor and would
mean writing the mic/engine bridge in Kotlin behind a Rust plugin anyway. **No advantage here**;
Capacitor has the ready-made pieces.

### 5.4 What moves, what stays, and the update story

| Layer | Where it lives |
|---|---|
| Entire ctrl-b UI, chat, dictation, STT/TTS, settings | **Unchanged — still the web app served by FastAPI over Tailscale Serve.** The wrapper's WebView points at `https://emma.lobster-vector.ts.net`. |
| Wake engine + model | Native (Kotlin), inside the wrapper |
| Mic foreground service + persistent notification | Native |
| "Wake word fired" → open dictation | Native → WebView bridge (or a deep link `?wake=1`) |
| Wake-word on/off toggle + sensitivity | Web settings (existing Conf pattern) → persisted server-side → wrapper reads it, **or** a native toggle mirrored into the notification |

**The update story is the main prize: the wrapper is a ~500-line shell that almost never changes,
while everything users see keeps shipping through the existing `update.sh` / tag-release path.** The
wrapper needs a rebuild only for Android target-SDK bumps (roughly annual) and engine changes.

### 5.5 Effort — ESTIMATE (unverified, my own sizing)

| Piece | Estimate |
|---|---|
| Capacitor shell pointing at the tailnet URL, signing, sideload/F-Droid-style install | ~1 day |
| Foreground service + `FOREGROUND_SERVICE_MICROPHONE` + notification + boot/battery-exemption UX | ~1 day |
| Wake engine integration (microWakeWord TFLite or openWakeWord ONNX on Android) + audio plumbing | ~2 days |
| Detection → foreground the WebView → auto-start dictation; mic handoff; re-arm on return | ~1 day |
| Settings, on/off, on-device testing across lock/unlock/doze, battery measurement | ~1–2 days |
| **Total** | **≈ 1 working week**, plus a recurring ~1 day/year Android-SDK maintenance tax |

Training a custom "hey ctrl-b" model (if microWakeWord/openWakeWord rather than sherpa's
no-training path) is **+0.5–1 day** of Colab time, mostly waiting, and is **iterative** — HA's own
docs warn "training a model that works well is still very difficult".

---

## 6. Field pass

### 6.1 Home Assistant — the canonical prior art, and it lands on the wrapper

**VERIFIED (home-assistant.io/voice_control/android/, doc version 2026.7.4, read 2026-07-31):**

- Engine: **microWakeWord**, "to process wake words locally on the device".
- Wake words: **Hey Nabu, Hey Jarvis, Hey Mycroft**.
- > "Wake word detection runs entirely on your Android device"
- > "Once enabled, wake word detection works even when your device is locked or the app is in the
  > background"
- Requires **Home Assistant Companion App 2026.2.3 or later** (feature announced with 2026.3); marked
  **experimental**.
- Battery: > "Wake word detection continuously monitors audio for wake words, which has a noticeable
  impact on battery life." And the reason: > "Google does not make this specialized hardware
  accessible to third-party app developers" — so HA must keep "the CPU on all the time", using more
  power than "Ok Google".
- **REPORTED (HA blog/press coverage):** the mitigation they recommend is automating *when* wake-word
  detection is on (e.g. only on home Wi-Fi).

**The load-bearing point:** Home Assistant — a project with a browser frontend, a full web Assist
pipeline, and every incentive to avoid shipping platform code — **did not do this in the browser.
They put it in the native Android companion app**, and even then it took until 2026 and is still
labelled experimental. Their server-side openWakeWord (Wyoming add-on) exists for *satellites*, not
for phones; their ESPHome satellites run microWakeWord on the microcontroller. **Nowhere in the HA
stack is a wake word detected in a web page.** That is the strongest available signal about the
pure-web ceiling.

### 6.2 Peer-class self-hosted agent-chat apps — nobody ships one

- **open-webui** — **VERIFIED:** wake-word detection is an **open feature request** (issue filed
  2024-07-02, `help wanted`, no maintainer implementation). open-webui has Whisper STT and TTS but no
  wake word.
- **LibreChat**, **AnythingLLM** — **REPORTED:** no wake-word / hands-free activation feature found.
- **Nothing in the reference class (opencode, Claude Code, Codex, Continue.dev, aider, goose,
  LiteLLM) has a voice wake word at all** — they are terminal/IDE tools.

**Reading: 0 of 5 voice-capable peers ship a browser wake word, and the one project that ships a
phone wake word at all (HA) does it natively.** If a clean browser path existed, open-webui — which
has had the request open for two years — would plausibly have taken it.

---

## 7. Verdict

### 7.1 Tier (a) — pure web, FOREGROUND only (screen on, app open; "docked on a stand")

- **Chrome Android: SHIP-VIABLE.** AudioWorklet + onnxruntime-web + Screen Wake Lock. Everything
  needed is Baseline. Model download ~3.7 MB (openWakeWord) or ~19 MB (sherpa KWS), cached by the
  existing service worker.
- **Firefox Android: SHIP-VIABLE, pending a device round.** AudioWorklet since Firefox 76 (mirrored
  to Android). Two things to confirm on the owner's phone: (i) mic permission persists across
  launches (§4), (ii) the `AudioContext({sampleRate})` behaviour (§2). Both are checkable in minutes.
- This tier is a genuinely useful product on its own: **it is exactly the "phone docked showing the
  dashboard" scenario the owner described**, and it also covers "screen on, hands dirty".
- Requires: `navigator.wakeLock.request("screen")` while armed, re-acquired on `visibilitychange`.
- **Disarm on `document.hidden`** — do not pretend to listen when you can't.

### 7.2 Tier (b) — pure web with screen off / backgrounded

- **Firefox Android: DEAD.** Not "unreliable" — structurally blocked. No `FOREGROUND_SERVICE_MICROPHONE`
  in the manifest, no mic-typed service, therefore Android's background-sensor rule applies. Nothing
  we can write in JS changes this.
- **Chrome Android: UNPROVEN — do not promise it.** The architecture is there (`camera|microphone`
  FGS + `kCapturingAudio` freeze exemption), but there is a real 2020 field report of screen-off
  capture stopping, Google's own help text is scoped to "start recording", and OEM battery policy is
  known to kill background Chrome audio. **If the owner wants this tier, the honest next step is a
  30-minute experiment on the actual phone, not a design.**
- Even if Chrome proves out, it depends on: Chrome not being battery-optimised by the OEM, the user
  never swiping Chrome out of Recents, and the tab never being discarded under memory pressure.
  That is three single points of failure for a feature whose whole value is that it *always* works.

### 7.3 Tier (c) — true always-listening → the minimal wrapper

**Recommended shape (in order of increasing commitment):**

1. **Ship tier (a) first** — pure web, foreground-only, off by default, behind a settings toggle
   with an explicit "only while the app is open and the screen is on" label. Zero new deployment
   surface; reuses the existing PWA update path.
2. **If and only if the owner still wants screen-off:** a **Capacitor WebView shell** whose WebView
   points at the existing tailnet HTTPS URL, plus a **mic-typed foreground service** running
   **microWakeWord** (52–60 KB) natively, which foregrounds the WebView and signals `?wake=1` on
   detection. **≈ 1 week** (§5.5). This is HA's architecture, one size smaller.
3. **TWA + a separate native wake service** is a legitimate variant that keeps Chrome as the renderer
   — same native work, minus the WebView, plus a cross-app mic handoff to get right.

**Battery reality per tier:**

- **Tier (a):** the inference is cheap — extrapolating openWakeWord's verified "15–20 models
  real-time on one Raspberry Pi 3 core", a single model is ~1–3 % of one modern phone core. But the
  screen is on and wake-locked, which dominates by an order of magnitude. Docked-and-charging is the
  natural mode; on battery, expect the screen to be the whole cost.
- **Tier (b)/(c):** the inference is still cheap; **what costs is preventing the SoC from reaching
  deep sleep**. That is precisely HA's warning: no access to the DSP/SoundTrigger hardware that
  "Ok Google" uses, so "the CPU on all the time". Plan for the HA mitigation — gate the wake word on
  a condition (on home Wi-Fi / on the tailnet / charging). **We already have the ingredients: R12's
  Tailscale presence signal and the D2-A monitor loop can arm/disarm it.**

### 7.4 Android 15 / 16 changes that matter

- **VERIFIED:** foreground-service **timeouts apply only to `dataSync` and `mediaProcessing`**
  (6 h per 24 h, Android 15+). **The `microphone` type has no timeout.** A wake-word FGS can run
  indefinitely. <https://developer.android.com/develop/background-work/services/fgs/timeout>
- **REPORTED:** apps targeting **Android 14+** cannot start a **microphone** FGS from a
  `BOOT_COMPLETED` receiver (Android 15 extends the same to `camera`). **Design consequence: the
  wrapper cannot auto-arm the wake word at boot** — the user must open the app once after a reboot,
  or arm it from a notification action. Worth designing for up front.
- **REPORTED (Android 16):** jobs started from a foreground service must respect their runtime
  quotas — irrelevant to a continuously-running mic FGS.

---

## 8. Implications for ctrl-b

1. **ROADMAP §C2 needs two edits.** (i) **Strike Porcupine** — its free tier was revoked
   2026-06-30 and the next tier is enterprise-priced; the remaining realistic engines are
   openWakeWord-via-onnxruntime-web (community ports, ~3.7 MB, needs a trained "hey ctrl-b"
   classifier) and **sherpa-onnx `wasm/kws`** (official build, ~19 MB, **arbitrary keyword with no
   training** — `@hey_ctrl_b` is literally its input format). (ii) The §C2 "Open" bullet's guess —
   *"tab must be foregrounded / PWA active"* — is **correct for Firefox and correct-by-default for
   Chrome**, and should be upgraded from a guess to a stated constraint with the Android FGS reason.
2. **Split §C2 into two features.** *C2a: foreground wake word* (pure web, ships against the current
   architecture, no new deployment surface) and *C2b: always-listening* (requires a native wrapper —
   a new artefact class for this project, with its own release path and Android-SDK maintenance
   tax). They are not the same feature and should not be sized together.
3. **A device round gates everything, and it is cheap.** Before any code: on the owner's phone,
   (i) which browser/build, (ii) does the mic grant survive an app restart, (iii) with a page
   capturing audio, does capture survive screen-lock for 5 minutes. That is the same "paper analysis
   ≠ device pass" lesson the frontier-theme Gate B taught us.
4. **Architecture constraints for whoever builds C2a**, all sourced above:
   - Inference **must** live in an AudioWorklet (or a Worker fed by one) — never a main-thread
     `setInterval`, which Chrome throttles to once/minute after 5 minutes hidden. Note the
     sherpa-onnx demo's `ScriptProcessorNode` is the wrong shape and must be replaced.
   - **One** `getUserMedia` stream, fanned out to the detector worklet and to the existing
     `MediaRecorder` in `useDictation.ts`. Reuse the hook's existing five-state model
     (`idle`/`recording`/`sending`/`unavailable`/`insecure`) rather than inventing a parallel one —
     a wake word is a new *trigger* for the existing dictation flow, not a new flow.
   - Plan for **single-threaded WASM+SIMD**; do not adopt COOP/COEP for the whole PWA.
   - Read `audioCtx.sampleRate` and resample; never assume the 16 kHz you asked for (Gecko).
   - Hold a **Screen Wake Lock** while armed and **disarm on `document.hidden`** — the honest UX.
   - Ship **off by default** with a sensitivity control, per §C2, and consider arming it from the
     existing presence signal (R12/D2-A) rather than leaving it on.
5. **If C2b is ever built, the wrapper must stay dumb.** WebView → the existing tailnet HTTPS URL;
   all UI keeps shipping through `update.sh`. Anything richer than "engine + service + one bridge
   call" starts a second codebase, which is exactly the cost the owner is trying to avoid.
6. **The prior-art signal should be weighted heavily.** Home Assistant put wake word in the native
   Android app in 2026 and still calls it experimental; open-webui's request has sat open since 2024.
   We should not expect to find a browser path they missed.

---

## 9. What I could not determine

1. **Whether Chrome Android actually keeps a `getUserMedia` capture alive with the screen off, in
   2026, on the owner's phone.** Source code says it should (mic-typed FGS + freeze exemption);
   a 2020 W3C report and many OEM-battery reports say users lose it. **The deciding fact for tier
   (b), and it is an experiment, not a search.**
2. **Whether Firefox for Android persists a microphone grant across app restarts.** Evidence
   conflicts: Fenix shipped a "Remember this decision" checkbox (2019 bug), `SitePermissionsFeature.kt`
   has no mic-specific exclusion from persistent storage, but Mozilla SUMO's Android answer says
   Firefox asks "each time". The `shouldStore` decision lives in a dialog-layer file I did not locate.
3. **Which Firefox build the owner has** — and therefore whether any Fennec/F-Droid divergence
   applies. No audio-capture divergence was found in either direction (unlike push, R10).
4. **Exact CPU %, RAM and battery drain** of openWakeWord or sherpa-KWS in a mobile browser. No
   published measurements exist for either port; the only hard number in the field is
   openWakeWord's Raspberry Pi 3 claim. **Must be measured.**
5. **onnxruntime-web's WASM binary size** for the single-threaded SIMD build (affects first-load
   cost more than the models do).
6. **Whether Chrome Android applies any background-duration cap to an already-granted mic
   permission** (desktop's one-time permissions expire after 5 minutes in the background — no
   evidence either way for Android's persistent grants).
7. **Bugzilla 1285858's current resolution** — i.e. whether Firefox Android has since gained
   `display: standalone`. Would not change the tier-(b) verdict either way.
8. **Android 10+ concurrent-capture behaviour** for the TWA variant (native wake service holding the
   mic, then Chrome opening it). Expected to need an explicit stop/start handoff; unverified.
9. **Whether a WebAPK's separate Android task changes OEM battery treatment** vs a Chrome tab.
10. **Picovoice's runtime network behaviour** — moot now, but never established whether AccessKey
    initialization can succeed fully offline.

---

## Primary sources

**Android platform**
- Android 9 background sensor restriction — <https://developer.android.com/about/versions/pie/android-9.0-changes-all>
- Android 11 FGS camera/mic rules — <https://developer.android.com/about/versions/11/privacy/foreground-services>
- FGS timeouts (Android 15+) — <https://developer.android.com/develop/background-work/services/fgs/timeout>
- FGS types — <https://developer.android.com/develop/background-work/services/fgs/service-types>

**Chromium**
- `chrome/android/java/AndroidManifest.xml` (FOREGROUND_SERVICE_MICROPHONE, MediaCaptureNotificationService) — <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/android/java/AndroidManifest.xml>
- `MediaCaptureNotificationServiceImpl.java` — <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/android/java/src/org/chromium/chrome/browser/media/MediaCaptureNotificationServiceImpl.java>
- `cannot_freeze_reason.h` — <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/performance_manager/public/freezing/cannot_freeze_reason.h>
- Page Lifecycle API — <https://developer.chrome.com/docs/web-platform/page-lifecycle-api>
- Timer throttling in Chrome 88 — <https://developer.chrome.com/blog/timer-throttling-in-chrome-88>
- One-time permissions — <https://developer.chrome.com/blog/one-time-permissions>
- Camera/mic on Android (help) — <https://support.google.com/chrome/answer/2693767?co=GENIE.Platform%3DAndroid>

**Mozilla**
- Fenix `AndroidManifest.xml` — <https://searchfox.org/firefox-main/source/mobile/android/fenix/app/src/main/AndroidManifest.xml>
- GeckoView `AndroidManifest.xml` — <https://searchfox.org/firefox-main/source/mobile/android/geckoview/src/main/AndroidManifest.xml>
- `SitePermissionsFeature.kt` — <https://searchfox.org/firefox-main/source/mobile/android/android-components/components/feature/sitepermissions/src/main/java/mozilla/components/feature/sitepermissions/SitePermissionsFeature.kt>
- fenix#2403 (remember-decision checkbox) — <https://github.com/mozilla-mobile/fenix/issues/2403>
- fenix#9691 (background tab media stops ~40 s) — <https://github.com/mozilla-mobile/fenix/issues/9691>
- MDN Screen Wake Lock API — <https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API>
- MDN BCD `api/AudioWorklet.json` — <https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/AudioWorklet.json>
- MDN Making PWAs installable — <https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable>

**Engines**
- openWakeWord — <https://github.com/dscripka/openWakeWord>
- openwakeword_wasm (browser port) — <https://github.com/dnavarrom/openwakeword_wasm>
- Deep Core Labs write-up (2025-07-12) — <https://deepcorelabs.com/open-wake-word-on-the-web/>
- sherpa-onnx `wasm/kws` — <https://github.com/k2-fsa/sherpa-onnx/tree/master/wasm/kws>
- sherpa-onnx KWS pretrained models — <https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html>
- microWakeWord — <https://github.com/kahrendt/microWakeWord> · models <https://github.com/esphome/micro-wake-word-models>
- Picovoice FAQ — <https://picovoice.ai/docs/faq/general/> · Web quick start <https://picovoice.ai/docs/quick-start/porcupine-web/>
- Picovoice free-tier sunset (HN) — <https://news.ycombinator.com/item?id=48248969> · (HA forum) <https://community.home-assistant.io/t/fyi-picovoice-confirmed-free-tier-accesskeys-will-stop-working-after-june-30-2026/1012744>

**Field**
- HA — Assist on Android (wake word) — <https://www.home-assistant.io/voice_control/android/>
- HA — approach to wake words — <https://www.home-assistant.io/voice_control/about_wake_word/>
- open-webui wake-word request — <https://github.com/open-webui/open-webui/issues/3584>
- w3c/mediacapture-main #670 (Chrome Android screen-off) — <https://github.com/w3c/mediacapture-main/issues/670>
- Capacitor foreground-service plugin — <https://github.com/capawesome-team/capacitor-android-foreground-service>
- Capacitor Porcupine plugin (abandoned) — <https://github.com/JulienLecoq/porcupine-wake-word>
