# R75 — Background-call survival: what breaks when the phone leaves the call on screen

**Date of pass: 2026-09-21.** Brief: *what does it take for a browser/PWA voice call to SURVIVE app
backgrounding and screen-off on Android, what breaks in that state, and is our proposed design
sound?* Reference class: the web-platform engines (primary, because the ceiling is theirs) plus five
OSS call/chat clients source-read at HEAD.

**Drives:** the proposed amendment to `LIVE_VOICE_PLAN.md` §5.3 (today: *"Page hidden / phone locked
→ the call ends cleanly (R14 scope: foreground-only)"*, implemented as the `hidden` arm in
`frontend/src/hooks/useLiveCall.ts:1105-1112`) and a new `voice.live.background` knob.

**Related dossiers — read with this one:** [R14](./R14-wake-word-android-browser.md) (the Android
background-sensor ceiling; **this pass CORRECTS one of its readings — §3.3 below**),
[R51](./R51-realtime-voice-chat.md), [R68](./R68-live-voice-deltas.md),
[R71](./R71-uplink-stall-pacing.md) (the pacer this pass re-judges),
[R72](./R72-session-slot-reconnect.md) (the zombie slot this pass collides with).

**Source pins.** Chromium `main` @ **`287b2c651411`** (2026-09-21 07:53 UTC) — every `//` path below
was fetched from that tree today. Field repos at the SHAs in §7.

**Confidence key** (README convention): **VERIFIED** = I read the source / ran the probe ·
**REPORTED** = secondary source · **UNVERIFIED** = expected, not checked · **REASONED** = a
conclusion I derived from verified parts, flagged as derivation rather than observation.

---

## 0. The headline, in five lines

1. **Nothing in the web platform ends a call because the page went hidden.** Our `hidden` arm is a
   policy we chose, and 5/5 field projects chose the opposite (§7). Removing it behind a knob is
   sound.
2. **Chrome for Android will nevertheless kill the ear — silently — via a path nobody in the field
   writes about: the renderer's own Android-only page FREEZING** (`kStopInBackground`, enabled by
   default, **1 minute**), whose only relevant exemption is **audibility**, not microphone capture
   (§3, §4). Freezing pauses the `AudioContext` outright, so the worklet stops producing frames.
3. **MessagePort deliveries are *not* throttled while merely hidden** (they are `kPostedMessage` →
   *pausable*, not *throttleable*), so the main-thread pacer (R71) is fine as-is until the page
   freezes — and once it freezes there is nothing to pace (§4). **No pacer relocation is owed.**
4. **The mouth is safe**: `play()` while hidden is permitted by default
   (`media-playback-while-not-visible` = `EnableForAll`) on an element already unlocked by our start
   gesture (§6).
5. **The WebSocket survives everything short of tab death** — pings are answered by the network
   service, not the renderer (§5) — which means the relay keeps holding its slot and the session cap
   keeps running while a frozen page hears nothing. The dangerous state is not "call dropped"; it is
   **"call alive, ear dead, screen says Listening"**.

---

## 1. The mechanism map — four independent gates, not one

A hidden page on Android passes through four *separate* mechanisms. Conflating them is why the
field's folklore ("Chrome kills background mics") is both true and useless.

| # | Gate | Who owns it | What it does to us | Triggered by |
|---|---|---|---|---|
| ① | **Android background-sensor rule** | the OS | denies the mic to a process with no visible activity and no `microphone`-typed foreground service | app not visible |
| ② | **Renderer throttling** (wake-up + CPU budget) | Blink `PageSchedulerImpl` | clamps `setTimeout`/`setInterval`; **leaves MessagePort/WebSocket task queues alone** | page hidden |
| ③ | **Page FREEZING** | Blink `PageSchedulerImpl` (`kStopInBackground`, Android) **and** browser-side `FreezingPolicy` | suspends *freezable* task queues, **pauses the AudioContext and media elements** | page hidden **and silent**, after a delay |
| ④ | **Tab DISCARD / process death** | Android LMK, Chrome's `DiscardEligibilityPolicy`, OEM task killers | the document is gone; return = reload | memory pressure, OEM policy |

Gates ① and ④ are where R14 already did the work. Gates ② and ③ are what this pass buys.

---

## 2. Q1 — does a backgrounded tab keep capturing?

### 2.1 The OS half (re-verified today, unchanged from R14)

`chrome/android/java/AndroidManifest.xml` (read 2026-09-21 @ `287b2c65`) still declares

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
...
<service android:name="org.chromium.chrome.browser.media.MediaCaptureNotificationService"
    android:foregroundServiceType="camera|microphone|mediaProjection|mediaPlayback"  <!-- screen-capture build -->
    android:foregroundServiceType="camera|microphone"                                <!-- otherwise -->
```

**VERIFIED.** So Chrome holds a `microphone`-typed FGS while a page captures, satisfying Android 9/11's
rule (R14 §3.1 quotes the platform docs verbatim — not re-quoted here). **The notification the owner
sees is that service's**: the persistent "… is using your microphone" entry, which also doubles as
the only ambient indicator that a background call is still live. Firefox for Android declares **no**
mic FGS at all (R14 §3.3, VERIFIED there) — background capture on Fennec is structurally impossible,
not a bug to work around.

### 2.2 The browser half

`components/performance_manager/public/freezing/cannot_freeze_reason.h` (read 2026-09-21) is
unchanged since R14 and still lists **`kCapturingAudio`** among the reasons a browsing instance
cannot be frozen; `freezing_policy.cc:961` wires it:

```cpp
void FreezingPolicy::OnIsCapturingAudioChanged(const PageNode* page_node) {
  ...                        CannotFreezeReason::kCapturingAudio);
```

**VERIFIED.** So the *browser-side* freezing policy (memory-saver / battery-saver) protects a
capturing tab. This is the finding that makes everyone stop looking — and it is the wrong gate
(§3).

### 2.3 What kills it (REPORTED)

- **OEM power management.** `dontkillmyapp.com/huawei` (read 2026-09-21) on the owner's family of
  device: *"no user accessible settings can prevent the system to break background processing longer
  than 60 minutes"*, plus **PowerGenie** which *"kills all apps that are not on its whitelist"*, plus
  a documented *"Keep running after screen off"* power setting and "App Launch → Manage manually".
  **REPORTED**, and it is the single most likely cause of a background call dying on an Honor 20.
  The mitigations are settings on the phone (Chrome → unrestricted battery, protected app), not code.
- **The 2020 WebRTC report** R14 already logged (*"switching display off stops microphone and
  playback a short time after the screen is turned off"*) — **REPORTED**, 6 years old, no vendor
  explanation. §3 now offers a mechanism that fits it exactly.
- Chromium issue **331092194**, whose public title reads *"Microphone stops working 2 mins after
  Chrome is …"* — **REPORTED, title only**: `issues.chromium.org` requires sign-in, so I could not
  read the body, the platform or the resolution. Recorded because the *two minutes* is the right
  order of magnitude for §3's clock, not as evidence of it.

---

## 3. Q2 (part 1) — the gate nobody writes about: renderer-side freezing on Android

This is the load-bearing finding of the pass.

### 3.1 The feature is ON by default on Android — VERIFIED

`third_party/blink/common/features.cc:2251` (read 2026-09-21):

```cpp
BASE_FEATURE(kStopInBackground,
             "stop-in-background",
// b/248036988 - Disable this for Chromecast on Android builds to prevent apps
// that play audio in the background from stopping.
#if BUILDFLAG(IS_ANDROID) && !BUILDFLAG(IS_CAST_ANDROID) && \
    !BUILDFLAG(IS_DESKTOP_ANDROID)
             base::FEATURE_ENABLED_BY_DEFAULT
#else
             base::FEATURE_DISABLED_BY_DEFAULT
#endif
);
```

### 3.2 Its condition contains no microphone — VERIFIED

`third_party/blink/renderer/platform/scheduler/main_thread/page_scheduler_impl.cc` (read 2026-09-21):

```cpp
// The amount of time to wait before suspending shared timers, and loading
// etc. after the renderer has been backgrounded. This is used only if
// background suspension is enabled.
constexpr base::TimeDelta kDefaultDelayForBackgroundTabFreezing =
    base::Minutes(1);                                              // :55

bool PageSchedulerImpl::IsBackgrounded() const {                   // :807
  return !IsPageVisible() && !IsAudioPlaying() &&
         !main_thread_scheduler_->IsVirtualTimeEnabled();
}

void PageSchedulerImpl::UpdateFrozenState(...) {                   // :827
  ...
  if (IsBackgrounded()) {
    ...
    } else if (base::FeatureList::IsEnabled(blink::features::kStopInBackground)) {
      ...
        freeze_time =
            std::max(page_visibility_changed_time_, audio_state_changed_time_) +
            delay_for_background_tab_freezing_;
```

`delay_for_background_tab_freezing_` is the finch-overridable
`DelayForBackgroundTabFreezingMills` param with the 1-minute default above. `IsAudioPlaying()` is
true while audible **and for 30 s after** (`kRecentAudioDelay = base::Seconds(30)`,
`page_scheduler_impl.h:159`).

**There is no `IsCapturing…` term anywhere in this path.** The browser-side `kCapturingAudio`
protection of §2.2 belongs to a *different* freezing mechanism and does not gate this one.

### 3.3 Correction to R14

R14 §3.2 read the Chromium sources and concluded *"on the renderer side, an actively capturing
ctrl-b tab is protected from freezing/discarding."* That is true of `FreezingPolicy` (a **browser**
process component, despite the sentence's "renderer side") and **false of `PageSchedulerImpl`**,
which is the renderer and the Android path. R14's overall verdict ("PLAUSIBLE, UNPROVEN — measure on
the phone") stands; its mechanism story needs this correction.

R14 §3.4 also reported the timer-throttling exemption as *"scoped to an **RTCPeerConnection**, not a
bare `getUserMedia` track"*. **That is wrong at HEAD** — see §5.2: any live `MediaStreamTrack`
registers the opt-out on its own.

### 3.4 What freezing does to us — VERIFIED, end to end

The chain, each link read today:

1. `PageSchedulerImpl::SetPageFrozenImpl` → `delegate_->OnSetPageFrozen(frozen)`
   (`page_scheduler_impl.cc:246-286`).
2. `Page::OnSetPageFrozen` → every `LocalFrame::OnPageLifecycleStateUpdated()`
   (`third_party/blink/renderer/core/page/page.cc:881`).
3. `BaseAudioContext::ContextLifecycleStateChanged`
   (`third_party/blink/renderer/modules/webaudio/base_audio_context.cc:231`):

```cpp
  if (state == mojom::blink::FrameLifecycleState::kRunning) {
    destinationNode()->GetAudioDestinationHandler().Resume();
  } else if (state == mojom::blink::FrameLifecycleState::kFrozen) {
    destinationNode()->GetAudioDestinationHandler().Pause();
  }
```

4. `HTMLMediaElement::ContextLifecycleStateChanged`
   (`third_party/blink/renderer/core/html/media/html_media_element.cc:4369`):

```cpp
  if (state == mojom::blink::FrameLifecycleState::kFrozen) {
    if (playing_) {
      PausePlayback(WebMediaPlayer::PauseReason::kFrameFrozen);
    }
```

**So a frozen page is not a slow page: the audio graph stops being pulled.** Our worklet's
`process()` is not called, no frames are minted, the pacer has nothing to pace, and the ear is
*deaf* — while `track.readyState` stays `"live"`, `getUserMedia` stays granted, the mic FGS stays
up, and our overlay keeps saying **Listening**. On unfreeze the graph resumes and frames flow again
with no event we currently observe. (The `freeze`/`resume` document events of the Page Lifecycle API
are the platform's notification; we listen for neither.)

### 3.5 Why the field's calls survive this and ours might not — REASONED

Every project in §7 is a *conferencing* client: the remote party's audio plays continuously, so
`IsAudioPlaying()` is ~always true and `IsBackgrounded()` is ~never true. **We are the opposite
shape**: our page is audible only while a reply is being spoken, and the ear's own graph is silent by
construction — `pcmCapture` terminates the worklet through `mute.gain.value = 0`
(`frontend/src/lib/pcmCapture.ts:118-121`), and Blink's audibility test is literally *any energy*:

```cpp
bool IsAudible(const AudioBus* rendered_data) {   // audio_context.cc:157
  ...
  return energy > 0;
}
```

(**VERIFIED.** The Chrome 88 doc says the same in prose: *"The page has made noises in the past 30
seconds. This can be from any of the sound-making APIs, but a silent audio track doesn't count."*)

**Consequence, stated as arithmetic:** a backgrounded ctrl-b call is frozen after
`max(hidden_at, last_audible_at) + 30 s (recently-audible) + 60 s (freeze delay)` — i.e. **~90 s of
conversational silence after the last spoken reply**, default config. A busy back-and-forth may never
reach it; a "I'll put the phone in my pocket and think" will, every time.

---

## 4. Q2 (part 2) — the uplink: is the main-thread pacer starved when hidden?

**No — not until the freeze, and the freeze removes the producer too.** The decisive fact is which
Blink task queue a MessagePort delivery lands on.

`third_party/blink/renderer/core/messaging/message_port.cc:110-113` (read 2026-09-21) — a
`MessagePort` (which is what `AudioWorkletNode.port` is, per the Web Audio spec) delivers on
`TaskType::kPostedMessage`. `frame_scheduler_impl.cc:567` maps that task type to
`PausableTaskQueueTraits()`, and the traits are defined at `frame_scheduler_impl.cc:1501-1529`:

| Trait factory | `CanBeThrottled` | `CanBeFrozen` | `CanBePaused` | used by |
|---|---|---|---|---|
| `ThrottleableTaskQueueTraits()` | **true** | true | true | `kJavascriptTimerDelayed*` (our `setTimeout` ladder) |
| `DeferrableTaskQueueTraits()` | false | **true** | true | `kWebSocket`, `kJavascriptTimerImmediate` |
| `PausableTaskQueueTraits()` | false | **true** | true | **`kPostedMessage`** (MessagePort), `kMediaElementEvent`, `kInternalMediaRealTime` |

**VERIFIED.** So:

- **Hidden but not frozen:** worklet → main-thread frame deliveries run at their normal cadence.
  `enqueueBounded`/`accrue`/`pump` (R71) keep metering in real time; nothing piles up; the relay's
  rolling 2×-realtime budget is never approached. **The pacer does not need to move off the main
  thread.** (It is still right for the reason R71 built it — a *stalled* main thread bursts on
  resume — and that reason now includes "resumed from a freeze".)
- **Frozen:** `kPostedMessage` is freezable, so deliveries would stop — but §3.4 already stopped the
  producer, so there is no backlog to burst. On resume, `accrue()` reads `performance.now()` and the
  bucket is capped at `BUCKET_CAP_MS = 500`, so even a pathological queue could not out-run the
  relay. **REASONED from verified parts; matches R71's design intent.**

**Local probe (VERIFIED, but only the baseline).** I ran a Playwright/Chromium 1228 probe on emma
(`--use-fake-device-for-media-stream`, the ctrl-b graph shape: worklet → 0-gain → destination, a live
`getUserMedia` track, a 500 ms-tick WebSocket, a chained 400 ms `setTimeout`, a looping `<audio>`):
worklet→main deliveries landed every **20–23 ms** (requested 20 ms) with a 33/11 ms jitter pair,
chained timers fired at **400–402 ms**, WS ticks at 501 ms, `play()` resolved. **I could not reach
the hidden or frozen states on this host** — see §11.

---

## 5. Q3 — timers, the reconnect ladder, and the socket

### 5.1 The throttling tiers, verbatim

From *"Heavy throttling of chained JS timers beginning in Chrome 88"* (developer.chrome.com, read
2026-09-21) — quoted exactly because the tiers are what our ladder lives in:

> **Minimal throttling.** This happens to timers that are scheduled when *any* of the following is
> true: The page is *visible*. The page has made noises in the past 30 seconds. This can be from any
> of the sound-making APIs, but a silent audio track doesn't count.
>
> **Throttling.** This happens to timers that are scheduled when *minimal throttling* doesn't apply,
> and *any* of the following is true: The *chain count* is less than 5. The page has been *hidden*
> for less than 5 minutes. WebRTC is in use. Specifically, there's an `RTCPeerConnection` with an
> 'open' `RTCDataChannel` or a 'live' `MediaStreamTrack`. **The browser will check timers in this
> group once per second.**
>
> **Intensive throttling** … happens when … *all* … are true: The page has been *hidden* for more
> than 5 minutes. The *chain count* is 5 or greater. The page has been silent for at least 30
> seconds. WebRTC is not in use. **In this case, the browser will check timers in this group once per
> minute.**

The intervals are the same two constants in source (`page_scheduler_impl.h:51-56`):
`kDefaultThrottledWakeUpInterval = base::Seconds(1)`,
`kIntensiveThrottledWakeUpInterval = base::Minutes(1)`. **VERIFIED.**

### 5.2 A live mic track alone buys the intensive-throttling exemption — VERIFIED (corrects R14)

`third_party/blink/renderer/modules/mediastream/media_stream_track_impl.cc:1204-1233`:

```cpp
void MediaStreamTrackImpl::EnsureFeatureHandleForScheduler() {
  ...
  feature_handle_for_scheduler_ =
      window->GetFrame()->GetFrameScheduler()->RegisterFeature(
          SchedulingPolicy::Feature::kWebRTC,
          {SchedulingPolicy::DisableAggressiveThrottling(),
           SchedulingPolicy::DisableAlignWakeUps()});

  feature_handle_for_scheduler_on_live_media_stream_track_ =
      GetExecutionContext()->GetScheduler()->RegisterFeature(
          SchedulingPolicy::Feature::kLiveMediaStreamTrack,
          {SchedulingPolicy::DisableBackForwardCache()});
}
```

It is called from the track's constructor whenever the state is not `kReadyStateEnded` (:305) and on
every `live`/`muted` transition (:943-948); it is released on `stop()`/`ended` (:447, :960). **No
`RTCPeerConnection` is involved.** The handle flows to
`FrameSchedulerImpl::OnStartedUsingNonStickyFeature` → `OnAddedAggressiveThrottlingOptOut()` →
`PageSchedulerImpl::opted_out_from_aggressive_throttling_`, which is read in exactly two places:

- `GetIntensiveWakeUpThrottlingInterval()` — returns the **1 s** interval instead of the 1-minute one
  (`page_scheduler_impl.cc:755-766`);
- `UpdateCPUTimeBudgetPool()` — **disables** the background CPU-time budget entirely
  (`page_scheduler_impl.cc:715-723`; the budget it would otherwise impose is 1% CPU,
  `kDefaultBackgroundBudgetAsCPUFraction = .01`, after `kThrottlingDelayAfterBackgrounding = 10 s`).

### 5.3 What our ladder actually becomes

`RECONNECT_BACKOFF_MS = [400, 900, 1800, 3000, 4000, 4000]` scheduled from a socket-close callback
(so the *chain count* is 1 — the rungs are not chained timers in Chrome's sense, which is a second,
independent reason intensive throttling cannot reach them).

Hidden, mic live, page not frozen: wake-ups are aligned to **1 s**, so each rung rounds up to the
next second boundary. Worst case **1 + 1 + 2 + 3 + 4 + 4 = 15 s** against today's 14.1 s.
**The ladder still outlasts the relay's ≤10 s slot release** (R72 + the `--ws-ping-interval 5
--ws-ping-timeout 5` deploy), with ~5 s of margin. **REASONED** from the verified alignment rule.

Frozen: the ladder does not run at all, and fires on resume.

### 5.4 The socket outlives the renderer's sleep — VERIFIED

`net/websockets/websocket_channel.cc:766-775` answers a Ping **in the network service**:

```cpp
    case WebSocketFrameHeader::kOpCodePing:
      DVLOG(1) << "Got Ping of size " << payload.size();
      if (state_ == CONNECTED) {
        ...
        return SendFrameInternal(true, WebSocketFrameHeader::kOpCodePong, ...);
```

The renderer is not consulted. So while our page is throttled *or frozen*, the relay's 5 s ping keeps
getting pongs, the session slot is **not** reaped, `max_session_s` keeps running, and Speaches sees a
silent stream. Caveat (**REASONED**): if the renderer stopped draining a *busy* downlink the mojo
pipe would eventually fill and the channel would stop reading the socket — our downlink during
silence is a few JSON frames, so this does not bite.

**The honest reconnect story in background:** there is usually nothing to reconnect. The leg does not
drop; the ear stops. Reconnect logic is the wrong tool for the background failure, which is why §12's
amendments are about *detecting* the ear outage, not about retrying the socket.

---

## 6. Q4 — the mouth while hidden

Three facts, all VERIFIED:

1. **Chrome's only visibility gate on `play()`** is in
   `third_party/blink/renderer/core/html/media/autoplay_policy.cc:289-293`:

```cpp
std::optional<DOMExceptionCode> AutoplayPolicy::RequestPlay() {
  // Block autoplay only if the media element's visibility state is known.
  if (!element_->CanPlayWhileHidden() && element_->IsFrameHidden()) {
    return DOMExceptionCode::kNotAllowedError;
  }
```

2. `HTMLMediaElement::CanPlayWhileHidden()` (`html_media_element.cc:702`) is the permissions-policy
   feature `media-playback-while-not-visible`, whose default in
   `services/network/public/cpp/permissions_policy/permissions_policy_features.json5:446-449` is
   **`feature_default: "EnableForAll"`**. So a top-level document may start playback while hidden
   unless someone explicitly turns the policy off. We never send that header.
3. The remaining gate is the ordinary gesture unlock, and we already satisfy it for the document's
   lifetime: `primeAudio()` constructs the ONE reused element inside the start tap and gets a real
   `play()` out of it (`frontend/src/lib/audioController.ts:137-160`, `ensureEl()` at :416). Every
   later `startEl(a)` is the same unlocked element.

**Reading: TTS started autonomously mid-background will play.** The failure mode to watch is not
`NotAllowedError`, it is §3 — a frozen page pauses the element with
`PauseReason::kFrameFrozen`, and our `playbackDrained`/`playbackFailed` arms would then read a paused
element as "the reply finished". (Freezing requires silence, so this can only catch a reply that
*starts* within the freeze — REASONED, narrow, but it is the one way the mouth lies.)

---

## 7. Q5 + Q6 — MediaSession, and what the field actually does

### 7.1 Field pass (source-read 2026-09-21, SHAs recorded)

| Project | SHA | Ends the call on `hidden`? | What it does with visibility |
|---|---|---|---|
| **LiveKit `client-sdk-js`** | `9b8caa12` | **No** | `Track.ts:338-366` — tracks `isInBackground` with a *delay* on hide, immediate on show, and re-`play()`s video elements on return. `Room.ts:1350-1385` keeps a hidden dummy `<audio>` with an **empty (silent) track** for iOS, and nulls its `srcObject` on hide *"in order to prevent lock screen controls to show up for it"* |
| **Element Call** | `9f7c35cd` | **No** | `src/useWakeLock.ts` — the *only* visibility handling in the repo: *"The lock is automatically released whenever the window goes invisible, so we need to reacquire it on visibility changes"* |
| **Jitsi Meet (web)** | `b4912d28` (lib) | **No** | `react/features/base/conference/middleware.web.ts:82-90` — `handleVisibilityChange()` re-requests the wake lock *"if it has been released by the OS"*. `react/features/pip/functions.ts:508-535` registers the **call action set** on MediaSession (below) |
| **open-webui (call mode)** | sparse HEAD | **No** | `CallOverlay.svelte:707-735` — wake lock requested `onMount`, re-requested on `visibilitychange → visible`. **No other hidden-page handling at all**: the recorder keeps running |
| **LibreChat** | sparse HEAD | n/a (no call mode) | `client/src/hooks/useWakeLock.ts:100-140` — requests only when visible, and documents the same re-acquire rule: *"The browser automatically releases wake locks when: User switches to a different tab / minimizes …"* |

**5/5 re-acquire the wake lock on return. 0/5 end a session because the page went hidden. 0/5 warn
the user about backgrounding anywhere in the source.** Our current `hidden`-ends-the-call arm is
unique in this class — which is defensible as a scope choice (R14) but is not what the field does.

### 7.2 MediaSession for call controls

- The action set exists: MDN's `MediaSession.setActionHandler` documents **`hangup`**,
  **`togglemicrophone`**, `togglecamera`, `togglescreenshare` alongside the transport actions, with
  the page-level banner *"Limited availability — This feature is not Baseline because it does not
  work in some of the most widely-used browsers"* and **no per-action browser table** (read
  2026-09-21). **VERIFIED that the actions are specified; UNVERIFIED which surface renders them on
  Chrome Android.**
- Field precedent is **desktop-PiP-shaped**, not notification-shaped: Jitsi registers
  `togglemicrophone` / `togglecamera` / `hangup` in its **Picture-in-Picture** feature and mirrors
  state with `setMicrophoneActive` / `setCameraActive`, guarded by feature-detection and a Safari
  exclusion (`react/features/pip/functions.ts:491-576`). LiveKit goes the other way and *hides* its
  dummy element from the lock screen.
- A MediaSession only has a surface while a media element is actually playing. Our TTS element plays
  **intermittently** — so a Chrome Android media notification would appear and vanish per reply,
  which is worse furniture than the mic-capture notification we already get for free (§2.1).

**Reading (implication, §12): MediaSession is not the right hang-up affordance for v1** unless we
also adopt a continuous keepalive element — in which case it becomes nearly free, and should then be
revisited.

---

## 8. Q7 — screen-off specifically

- **`visibilitychange → hidden` fires on lock.** Not inferred: it is measured in *this* repo. The
  S0.5 round's MED (`LIVE_VOICE_PLAN.md` §7-S0.5, 2026-09-13) records *"the metering split had
  dragged the hidden-page stop along — locking the phone killed a default-mode recording"*.
  **VERIFIED (in-repo, owner's device).** So screen-off and app-switch are the same event for us.
- **The wake lock is released by the system on hide**, MDN verbatim (read 2026-09-21): *"Only active
  documents can acquire screen wake locks and previously acquired locks are automatically released
  when document becomes inactive. Therefore make sure to re-acquire screen wake lock if necessary
  when document becomes active (listen for `visibilitychange` event)."* Our hook requests once, at
  mount (`useLiveCall.ts:1096-1104`), and never re-acquires — so a call that survives a screen-off
  comes back **without** a screen lock. Releasing "naturally" is right; not re-acquiring is a bug the
  background knob creates.
- **Nothing else distinguishes screen-off from backgrounding** at the web-platform level: the same
  hidden→throttle→freeze ladder applies. Android *audio focus* is unaffected by the screen (a
  playing media element keeps its focus), **UNVERIFIED** for our specific element/OEM.

---

## 9. Q8 — the edge inventory

1. **`pagehide` vs `visibilitychange` — and bfcache is not in play.** While a call is up we hold two
   bfcache-disabling features: `kWebSocket`
   (`modules/websockets/websocket_channel_impl.cc:309-315`, `DisableBackForwardCache()`) and
   `kLiveMediaStreamTrack` (§5.2). **VERIFIED.** So the page can never be bfcached mid-call, and
   `pagehide` during a call is always a real teardown (`persisted === false`). Teardown belongs on
   `pagehide` (the last reliably-delivered event); `visibilitychange` should carry *policy*
   (wake-lock, keepalive, "am I deaf?"), never destruction.
2. **Discard / process death is real and silent.** A frozen tab is a discard candidate (the
   `CannotFreezeReason` header's own comment: *"The reasons to not freeze a browsing instance overlap
   with the reasons to not discard a tab"*), and on Android the OEM/LMK path (§2.3) needs no
   Chromium's permission at all. On return the document is **reloaded** (`document.wasDiscarded`),
   the in-memory `store/liveCall` slot is gone, and the owner sees the ordinary chat — no error, no
   trace. **REASONED.** Worse, per §5.4 the relay may still hold the session slot for up to 10 s, so
   an immediate redial hits `serverError{code:"busy"}` with `attempts === 0`, which our reducer turns
   into the **terminal** "another call is active" (`useLiveCall.ts:626-633`) — a sentence that is
   false on a single-user install. This is exactly R72's A-F3 case arriving through a door R72 did
   not model.
3. **The app's other foreground assumptions.** Swept (`grep visibilitychange|document.hidden` over
   `frontend/src`):
   - **`useForegroundNotifications`** — `shouldNotify` returns false unless
     `env.visibility === "hidden"` (:84). A backgrounded call therefore **buzzes the phone per
     finished turn** (`cls: "turn_done"`, `store/chat.ts:336`) for a conversation the owner is having
     out loud. `cls: "agent_input"` (approval needed / the agent has a question) is the opposite —
     genuinely wanted in that state.
   - **`useDictation`** — its hidden-page arms are policy-gated (:970) and its release path already
     treats a hidden page as *abandonment*; dictation and the call do not run together, so no
     interaction, but the precedent (policy-gate, don't hard-stop) is the one to copy.
   - **Theme surfaces** (`CosmosStarfield`, `CosmosFleet`, `GachaBanner`) pause animation on hidden —
     correct and unaffected.
   - Nothing else assumes the call is foreground.
4. **Mic-hot cost.** A surviving background call holds the mic (and its notification) until hang-up,
   the 30-minute `max_session_s`, or tab death — and burns battery on a device family that fights
   back (§2.3). There is currently **no idle end** for a call, only the cap.
5. **Fennec.** With no mic FGS (§2.1) the OS takes the microphone. Firefox surfaces that as a track
   `mute` event, not necessarily `ended` — and `pcmCapture` listens only for `ended`
   (`pcmCapture.ts:188`). **REASONED:** on Fennec a backgrounded call most likely goes deaf silently
   rather than erroring. Same symptom as the freeze, different cause; one detector covers both.

---

## 10. Bounded open sweep (3, none of them asked for)

1. **`kStopInBackground` is disabled for `IS_DESKTOP_ANDROID` builds** (§3.1) — i.e. the same
   Chromium behaves differently on an Android tablet/desktop-mode build. Irrelevant to the Honor 20;
   worth knowing before anyone "reproduces" the freeze on a different Android surface. **VERIFIED.**
2. **Title/favicon updates inhibit intensive throttling for 3 s**
   (`kTimeToInhibitIntensiveThrottlingOnTitleOrFaviconUpdate`, `page_scheduler_impl.cc:64-66`) —
   documented here only so nobody invents a `document.title` heartbeat: it does nothing for
   *freezing*, which is the gate that actually hurts, and the mic track already bought the
   intensive-throttling exemption. **VERIFIED.**
3. **A frozen page's incoming IPCs are tracked and logged by Chromium**
   (`kLogUnexpectedIPCPostedToBackForwardCachedDocuments`, 15 s delay,
   `page_scheduler_impl.cc:67-68`) — a hint that "the page kept receiving while frozen" is a
   first-class, instrumented situation, consistent with §5.4's socket staying alive. **VERIFIED.**

---

## 11. What I could NOT determine

- **Whether the Android freeze actually fires on the owner's phone during a live capture, and at
  what delay.** The default is 1 minute in source; the effective value is a finch param
  (`DelayForBackgroundTabFreezingMills`) that I cannot read remotely. **This is the one measurement
  that decides the design, and it needs the phone** (see the 10-minute test in §12.4).
- **Anything empirical about the hidden/frozen states on this host.** The Playwright probe could not
  produce a hidden page: `Emulation.setPageVisibilityOverride` does not exist in this protocol
  version, `Browser.setWindowBounds{windowState:"minimized"}`, a second tab + `bringToFront`, and a
  `window.open` popup all left `document.visibilityState === "visible"` under Xvfb (no window
  manager). And freezing cannot be forced on a visible page — Blink refuses by construction:
  *"Only transitions from HIDDEN to FROZEN are allowed for pages"* (`page_scheduler_impl.cc:226-241`,
  `DCHECK(false); return;`). A real hidden/frozen measurement needs a desktop session with a WM, or
  the phone.
- **Whether an inaudible-but-nonzero keepalive (§12.3) triggers an Android media notification or
  takes audio focus** (and therefore pauses the owner's music). Blink's audibility is a pure energy
  test (§3.5); what the browser *does* with "this tab is audible" on Android was not traced.
- **Which Chrome Android surface, if any, renders the MediaSession `hangup` action** (§7.2).
- **The body of Chromium issue 331092194** (sign-in wall) — title only.
- **Whether Chrome Android applies any duration cap to an already-granted background mic permission**
  — R14 left this open (its §8 question 6); nothing found this pass either.

---

## 12. Implications for the design (short, and separate from the evidence above)

### 12.1 Verdict — **SOUND WITH AMENDMENTS**

The one-knob shape is right: nothing in the platform requires us to end the call, the field
unanimously doesn't, and every subsystem we own (pacer, socket, mouth, ladder) survives a *hidden*
page unchanged. What the proposal is missing is that on Chrome Android the call does not fail
loudly — it goes **deaf while looking alive**, and the current UI cannot tell the owner. Ship the
knob with the amendments below; A1, A2 and A5 are not optional.

### 12.2 The amendments

- **A1 — re-acquire the wake lock on `visibilitychange → visible`** (5/5 field precedent, §7.1;
  MDN's own instruction, §8). Today's single request at mount leaves a returned call without a screen
  lock. One small change in the §5.3 effect.
- **A2 — an EAR-OUTAGE detector, because the freeze is silent.** One mechanism, three causes (freeze,
  Fennec's OS mute, an OEM kill that leaves the page alive): on `resume`/`visible`, compare
  `performance.now()` against the last worklet frame's arrival; also listen for the track's
  `mute`/`unmute` events (`pcmCapture` listens only for `ended` today). A gap beyond a knob'd
  threshold means *the ear missed everything since then* — the honest response is to tear down the
  leg and redial (a fresh session, which §5.3's ladder already knows how to do) **and** to say so in
  the overlay's note line, in the owner's words. Never let a resumed call present as if it heard.
- **A3 — decide the keepalive deliberately, and make it a knob.** Raising the capture chain's sink
  gain from 0 to an inaudible-but-nonzero level (or looping a near-silent-but-nonzero clip on the
  existing element) makes `IsAudible()` true, which makes `IsBackgrounded()` false, which removes
  **both** the freeze and all background throttling at a stroke (§3.5, §5.1). It is also a deliberate
  defeat of a battery protection, and its Android side effects are UNVERIFIED (§11). Recommendation:
  `voice.live.background_keepalive`, default **ON when `background` is ON**, and measure it on the
  phone before believing it. If it proves clean, revisit MediaSession (§7.2) — with a continuously
  playing element, a lock-screen **hang up** becomes nearly free.
- **A4 — bound the background call.** The mic stays hot until hang-up / the 30-minute cap on a device
  family that kills background work anyway. Add a background-idle end (no speech + no reply for N
  minutes ⇒ clean end, overlay says why) rather than relying on `max_session_s`. Knob, not constant.
- **A5 — suppress `turn_done` notifications while a call is live.** Otherwise the background call the
  owner is *speaking to* buzzes them per reply (§9.3). Keep `agent_input` — an approval gate reached
  by voice is exactly when a notification earns its keep. The gate belongs in
  `useForegroundNotifications`'s single chokepoint, not at a producer.
- **A6 — fix the first-dial `busy` terminal for the reload case** (§9.2): after a tab discard the
  relay may hold the slot for ≤10 s, so `attempts === 0 && busy` should retry once (or twice, 2 s
  apart) before it is allowed to say "another call is active". Small reducer change; it is R72's
  lesson applied to a door R72 didn't see.
- **A7 — keep teardown on `pagehide`, policy on `visibilitychange`** (§9.1). With the knob ON, the
  `hidden` signal stops meaning "end"; something must still end the call when the document really
  goes away, and bfcache is provably not in play mid-call.

### 12.3 What needs no change

- The **uplink pacer stays on the main thread** (§4). MessagePort deliveries are not throttleable,
  and the freeze stops the producer, so there is no starve-then-burst window to engineer against.
- The **reconnect ladder stays as it is** (§5.3): 1 s alignment stretches it to ~15 s, still past the
  relay's ≤10 s slot release.
- The **mouth needs nothing** (§6) — no MediaSession, no fresh gesture, no re-prime.

### 12.4 The 10-minute phone test this pass cannot replace

With the knob ON, on the Honor 20, over the Serve HTTPS origin: start a call · say something · lock
the screen · **wait 3 minutes in silence** · unlock and speak. Instrument it so the answer is
readable: log the worklet frame counter and `performance.now()` gaps to the overlay's note, and listen
for `freeze`/`resume`. Three outcomes: it hears you (no freeze on this device/config — A3 may be
unnecessary) · it went deaf and A2 says so (the expected case) · the app reloaded (the discard case —
A6). Repeat once with `background_keepalive` ON. Everything else in §12 is already decided by the
sources.

---

## 13. The numbers that decide the design

| Quantity | Value | Where | Confidence |
|---|---|---|---|
| Android freeze delay, backgrounded tab | **60 s** (`kDefaultDelayForBackgroundTabFreezing`), finch param `DelayForBackgroundTabFreezingMills` | `page_scheduler_impl.cc:55` | VERIFIED (default), UNVERIFIED (effective) |
| "Recently audible" grace before backgrounded | **30 s** (`kRecentAudioDelay`) | `page_scheduler_impl.h:159` | VERIFIED |
| ⇒ time from last spoken reply to a deaf ear | **~90 s of silence** | derived | REASONED |
| Throttled wake-up interval (hidden) | **1 s** (`kDefaultThrottledWakeUpInterval`) | `page_scheduler_impl.h:51` | VERIFIED |
| Intensive wake-up interval | **60 s** (`kIntensiveThrottledWakeUpInterval`), after 5 min hidden + chain ≥5 + 30 s silent | `page_scheduler_impl.h:55` + Chrome 88 doc | VERIFIED |
| Background CPU budget | **1 %**, armed 10 s after backgrounding | `page_scheduler_impl.cc:43`, `:49` | VERIFIED |
| Our ladder, hidden & throttled | `[400,900,1800,3000,4000,4000]` → **~15 s** total (1 s alignment) vs relay slot ≤ **10 s** | derived from the above + R72 | REASONED |
| Audibility test | **any energy > 0** on the destination bus; 2.0 s silence hysteresis (`kSilenceThresholdSeconds`) | `audio_context.cc:157`, `:95` | VERIFIED |

| Exemption boolean | Value for a ctrl-b call | Where |
|---|---|---|
| `kStopInBackground` enabled on Android | **TRUE** | `features.cc:2251` |
| Freezing exempt because *capturing audio* (renderer path) | **FALSE** — no such term | `page_scheduler_impl.cc:807`, `:827` |
| Freezing exempt because *capturing audio* (browser `FreezingPolicy`) | **TRUE** (`kCapturingAudio`) — but it is not the Android path | `cannot_freeze_reason.h`, `freezing_policy.cc:961` |
| Freezing exempt because *audible* | **TRUE while audible + 30 s** | `page_scheduler_impl.cc:812` |
| Intensive-throttling opt-out from a bare live `MediaStreamTrack` | **TRUE** (`kWebRTC` + `DisableAggressiveThrottling`) | `media_stream_track_impl.cc:1224-1228` |
| Wake-up alignment disabled by a live track | **TRUE** (`DisableAlignWakeUps`) | same |
| MessagePort (`kPostedMessage`) throttleable / freezable | **false / true** | `frame_scheduler_impl.cc:567`, `:1523` |
| WebSocket (`kWebSocket`) throttleable / freezable | **false / true** | `frame_scheduler_impl.cc:539`, `:1513` |
| JS timers throttleable / freezable | **true / true** | `frame_scheduler_impl.cc:494`, `:1501` |
| WS Ping answered without the renderer | **TRUE** (network service) | `websocket_channel.cc:766` |
| bfcache eligible during a call | **FALSE** (`kWebSocket` + `kLiveMediaStreamTrack`) | `websocket_channel_impl.cc:309`, `media_stream_track_impl.cc:1231` |
| `play()` allowed while hidden | **TRUE** (`media-playback-while-not-visible` = `EnableForAll`) | `permissions_policy_features.json5:446` |
| Frozen ⇒ AudioContext paused | **TRUE** | `base_audio_context.cc:231-243` |
| Frozen ⇒ media element paused | **TRUE** (`PauseReason::kFrameFrozen`) | `html_media_element.cc:4369` |
| Wake lock survives hidden | **FALSE** (auto-released; re-acquire on visible) | MDN, 5/5 field |
| Fennec background capture | **FALSE** (no mic FGS) | R14 §3.3 |

---

## Sources

**Chromium `main` @ `287b2c651411`, all read 2026-09-21** — `third_party/blink/common/features.cc` ·
`third_party/blink/renderer/platform/scheduler/main_thread/page_scheduler_impl.{h,cc}` ·
`.../frame_scheduler_impl.cc` · `third_party/blink/renderer/core/messaging/message_port.cc` ·
`third_party/blink/renderer/core/page/page.cc` ·
`third_party/blink/renderer/modules/webaudio/{audio_context.cc,base_audio_context.cc}` ·
`third_party/blink/renderer/core/html/media/{html_media_element.cc,autoplay_policy.cc}` ·
`third_party/blink/renderer/modules/mediastream/media_stream_track_impl.cc` ·
`third_party/blink/renderer/modules/websockets/{dom_websocket.cc,websocket_channel_impl.cc}` ·
`net/websockets/websocket_channel.cc` ·
`components/performance_manager/public/freezing/cannot_freeze_reason.h` ·
`components/performance_manager/freezing/freezing_policy.cc` ·
`services/network/public/cpp/permissions_policy/permissions_policy_features.json5` ·
`chrome/android/java/AndroidManifest.xml`.

**Docs** — "Heavy throttling of chained JS timers beginning in Chrome 88"
<https://developer.chrome.com/blog/timer-throttling-in-chrome-88> · Page Lifecycle API
<https://developer.chrome.com/docs/web-platform/page-lifecycle-api> · MDN Screen Wake Lock API ·
MDN `MediaSession.setActionHandler` · <https://dontkillmyapp.com/huawei>.

**Field repos (2026-09-21)** — livekit/client-sdk-js `9b8caa12` · element-hq/element-call `9f7c35cd`
· jitsi/lib-jitsi-meet `b4912d28` + jitsi/jitsi-meet (sparse HEAD) · open-webui/open-webui (sparse
HEAD) · danny-avila/LibreChat (sparse HEAD).

**In-repo** — `frontend/src/hooks/useLiveCall.ts` · `frontend/src/lib/{pcmCapture,uplinkPacer,liveSocket,audioController}.ts`
· `frontend/src/hooks/useForegroundNotifications.ts` · `frontend/src/store/chat.ts` ·
`docs/LIVE_VOICE_PLAN.md` §5.3, §7-S0.5, §7-S2.5, §7-S3 · `docs/research/R14`, `R71`, `R72`.

**Local probe** — Playwright 1.61.1 / Chromium 1228 on emma, `docs/research` scratch only (baseline
cadence figures in §4; the hidden/frozen legs could not be produced — §11).
