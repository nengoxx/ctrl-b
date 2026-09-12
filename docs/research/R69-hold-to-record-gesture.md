# R69 — The hold-to-record gesture: field parameters + web-platform facts

**Date:** 2026-09-12
**Status:** Draft dossier — complete for the bounded question. Nothing is built; not a decision.
**What drove it:** the owner declined a separate call button beside the mic and proposed a
**dual-mode mic button** (tap switches mic↔call; press-and-hold records; swipe-up locks/calls;
slide-left cancels) as the Phase 24 live-voice **entry affordance**
([`../LIVE_VOICE_PLAN.md`](../LIVE_VOICE_PLAN.md) §6, "The entry affordance — OPEN, under design").
The owner commissioned this pass so the spec is researched rather than guessed.
**Drove:** (open) — LIVE_VOICE_PLAN §6 entry-affordance design.

**Reference-class deviation, owner-sanctioned.** ctrl-b's research peers are agent-chat apps
(README §Reference class). This problem is owned by **messaging apps**, so the peers here are
Telegram, Signal, WhatsApp and Discord. Open-source clients were read at pinned SHAs; the closed
ones are secondary-source only and marked as such.

**Confidence markers:** **[V] VERIFIED** = source/spec read at the pinned ref, or a registry/API
queried today. **[R] REPORTED** = secondary source. **[U] UNVERIFIED** = expected but not checked.

> ### Headline — four premise corrections
>
> **① Telegram DOES use an activation delay, and it is 150 ms — not a long-press timeout.** [V]
> It applies **only when the button is dual-mode**. When the button has no second mode the code
> calls `recordAudioVideoRunnable.run()` synchronously on `ACTION_DOWN` — recording starts on
> touch-down with *zero* delay. The 150 ms window exists for exactly one reason: to leave a tap
> free to mean *switch mode*. Our design is Telegram's dual-mode case, so 150 ms is the
> directly-transferable number. **Nobody in this field uses the 400–500 ms platform long-press
> timeout for this gesture.** (§1.1)
>
> **② Signal starts recording on touch-down with no delay at all, and buys the tap back with a
> 1000 ms minimum-duration rule** — release under 1 s discards the clip and toasts
> *"Tap and hold to record a voice message, release to send"*. Two different solutions to the
> same "a tap must not send a 90 ms clip" problem. (§2)
>
> **③ A swipe-to-START-A-CALL gesture has no precedent in this field.** [V for Telegram]
> `ChatActivityEnterView.java` contains **zero** call-initiation references (`grep -c
> 'VoIPService\|startCall' → 0`); calls are launched from plain header/profile buttons in every
> peer examined. The swipe-up-to-call half of our design is **novel**, and the field gives it no
> parameters — only the lock gesture it borrows its mechanics from. (§3.3)
>
> **④ Telegram's own WEB client does NOT hold-to-record.** [V] Telegram Web A degrades to
> **tap-to-start / tap-to-stop** on a plain `<button onClick>`, Esc to cancel, and moves the
> mic↔video mode switch into a **context menu** (200 ms long-press on touch, right-click on
> desktop). The touch gesture family is an *Android-app* pattern; the reference web client
> deliberately does not ship it. (§8.1)
>
> **⑤ `navigator.vibrate()` is a silent no-op on Firefox for Android — and returns `true`.** [V]
> Disabled since Fx 79 over abuse concerns; the tracking bug is still `NEW` as of 2025-11-12. It
> cannot be feature-detected. Every haptic in this design must be decorative on Fennec. (§7)

---

## 0. Sources, pinned

| Project / doc | Ref | SHA / version | Read |
|---|---|---|---|
| **DrKLO/Telegram** (Telegram Android) | `master` | `62b56a07ca7e30e39f7fd00a6728d6bbd716ca1c` | 2026-09-12 |
| **signalapp/Signal-Android** | `main` | `b92917acdb067e83a9a79122d7496d66c5880b71` | 2026-09-12 |
| **Ajaxy/telegram-tt** (Telegram Web A) | `master` | `9cb10b20797dc09e33fcffee0ba390bb429c66d3` | 2026-09-12 |
| AOSP `frameworks/base` `ViewConfiguration.java` | `refs/heads/main` | fetched via googlesource `?format=TEXT` | 2026-09-12 |
| material-components-android motion `tokens.xml` | `master` | Version header `34.0.0` | 2026-09-12 |
| W3C **Pointer Events Level 3** | TR | `https://www.w3.org/TR/pointerevents3/` | 2026-09-12 |
| WCAG 2.2 Understanding 2.5.1 / 2.5.2 | — | w3.org/WAI/WCAG22 | 2026-09-12 |
| **mdn/browser-compat-data** | `main` | `api/Navigator.json`, `api/Element.json`, `css/properties/touch-action.json` | 2026-09-12 |
| Bugzilla REST (`/rest/bug?id=…`) | live | bugs 1481923, 1256339, 1906956, 1653318 | 2026-09-12 |
| Discord support "Voice Messages" | live | support.discord.com article 13091096725527 | 2026-09-12 [R] |
| WhatsApp lock UX | — | phonearena / uptodown / gsmarena teardowns | 2026-09-12 [R] |

Telegram paths below are all
`TMessagesProj/src/main/java/org/telegram/ui/Components/ChatActivityEnterView.java` unless stated.
Signal paths are under `app/src/main/java/org/thoughtcrime/securesms/`.

---

# EVIDENCE

## 1. Telegram Android — the gesture, dissected [V]

### 1.1 Activation: a 150 ms delay, and only because the button is dual-mode

`ChatActivityEnterView.java`, `audioVideoButtonContainer.onTouchEvent`, `ACTION_DOWN`:

```java
if (hasRecordVideo) {
    calledRecordRunnable = false;
    recordAudioVideoRunnableStarted = true;
    AndroidUtilities.runOnUIThread(recordAudioVideoRunnable, 150);
} else {
    recordAudioVideoRunnable.run();
}
```

`hasRecordVideo` is true exactly when the button can toggle mic↔round-video. So:

- **dual-mode button → 150 ms delay** before the mic opens;
- **single-mode button → recording starts synchronously on touch-down.**

This is the load-bearing correction. The delay is not a "long press" in the platform sense (AOSP's
default is 400 ms, §4.1) — it is the minimum window needed to distinguish *tap = switch mode* from
*hold = record*, and Telegram set it at 150 ms.

Inside `recordAudioVideoRunnable` the first act after permission checks is
`audioVideoButtonContainer.getParent().requestDisallowInterceptTouchEvent(true)` — the Android
equivalent of `setPointerCapture` + `touch-action: none`. The gesture takes exclusive ownership of
the touch stream the instant recording begins.

### 1.2 TAP (release before 150 ms) = switch mode, with a haptic

`ACTION_UP`, the branch taken when the runnable has not fired yet:

```java
if (recordAudioVideoRunnableStarted) {
    AndroidUtilities.cancelRunOnUIThread(recordAudioVideoRunnable);
    if (sendVoiceEnabled && sendRoundEnabled) {
        delegate.onSwitchRecordMode(!isInVideoMode());
        setRecordVideoButtonVisible(!isInVideoMode(), true);
    } else {
        delegate.needShowMediaBanHint();
    }
    performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
    sendAccessibilityEvent(AccessibilityEvent.TYPE_VIEW_CLICKED);
}
```

Three things ship together with the mode flip: a **haptic**, an **accessibility "clicked" event**,
and — inside `setRecordVideoButtonVisible` — **persistence and a new accessible name**:

```java
private void setRecordVideoButtonVisible(boolean visible, boolean animated) {
    isInVideoMode = visible;
    if (animated) {
        SharedPreferences preferences = MessagesController.getGlobalMainSettings();
        …
        preferences.edit().putBoolean(isChannel ? "currentModeVideoChannel" : "currentModeVideo", visible).apply();
    }
    audioVideoSendButton.setState(… State.VIDEO : State.VOICE, animated);
    audioVideoSendButton.setContentDescription(getString(isInVideoMode() ? R.string.AccDescrVideoMessage : R.string.AccDescrVoiceMessage));
    audioVideoButtonContainer.setContentDescription(…);
    audioVideoSendButton.sendAccessibilityEvent(AccessibilityEvent.TYPE_VIEW_FOCUSED);
}
```

- **Mode is remembered globally**, not per chat (one key for chats, one for channels), and only
  written when the user toggled (`animated == true`) — a programmatic restore does not re-persist.
- **The mode lives in the accessible NAME**, not in a state attribute, and the change is announced
  by re-firing a focus event.

The icon itself crossfades through a two-state Lottie:
`ChatActivityEnterViewAnimatedIconView.java` maps `VOICE_TO_VIDEO`/`VIDEO_TO_VOICE` onto one asset
`R.raw.voice_and_video`, playing frames 0→30 one way (`setCustomEndFrame(30)`) and 30→60 the other
(`setProgress(0.5f)`, `setCustomEndFrame(60)`). One clip, played forward from either half — the
cheapest possible two-state morph.

### 1.3 Slide-left to cancel — a *relative* distance, recomputed per gesture

The `distCanMove = dp(80)` field initializer is dead weight; the live value is set on the first
`ACTION_MOVE`:

```java
if (startedDraggingX == -1) {
    startedDraggingX = x;
    distCanMove = (float) (sizeNotifierLayout.getMeasuredWidth() * 0.35);
    if (distCanMove > dp(140)) {
        distCanMove = dp(140);
    }
}
x = x + audioVideoButtonContainer.getX();
float dist = (x - startedDraggingX);
float alpha = 1.0f + dist / distCanMove;
…
setSlideToCancelProgress(alpha);          // clamped to [0,1]
if (alpha == 0) { … updateRecordInterface(RECORD_STATE_CANCEL_BY_GESTURE, true); }
```

- **Full cancel distance = min(35 % of the layout width, 140 dp).** At a 360 dp-wide phone that is
  **126 dp**; at ≥400 dp it saturates at **140 dp**.
- Cancel fires **during the drag**, the moment `alpha` hits 0 — no release needed.
- `slideToCancelProgress` (= `alpha`) drives everything: the hint text alpha, the circle's
  horizontal offset (`slideDelta = -distance * (1 - progress)`), and the circle's scale
  (`slideToCancelScale = 0.7f + slideToCancelProgress * 0.3f` — the circle shrinks to 70 % as you
  drag toward cancel).

**A second, softer cancel threshold on release.** `ACTION_UP` re-runs the same maths and cancels at
`alpha < 0.45`, i.e. **dist < −0.55 × distCanMove** (≈ −69 dp at 360 dp). Letting go past ~55 % of
the way to cancel is itself a cancel.

**A third threshold gates locking:** `setLockTranslation` refuses to lock while
`slideToCancelProgress < 0.7f` — once you are ~30 % of the way to cancel (≈ 38 dp at 360 dp) the
gesture has committed to the horizontal axis and upward motion no longer locks.

### 1.4 Swipe-up to lock — 57 dp, committed on crossing

```java
public int setLockTranslation(float value) {
    if (sendButtonVisible) return 2;
    if (lockAnimatedTranslation == -1) startTranslation = value;
    lockAnimatedTranslation = value;
    invalidate();
    if (canceledByGesture || slideToCancelProgress < 0.7f) return 1;
    if (startTranslation - lockAnimatedTranslation >= dp(57)) {
        sendButtonVisible = true;
        if (controlsView != null) controlsView.showPauseHint();
        return 2;
    }
    return 1;
}
```

**57 dp of upward travel from the touch-down Y, measured continuously; the lock latches the instant
it is crossed** — the user does not release to lock. `startTranslation` is captured on the first
move, not on `ACTION_DOWN`, so the threshold is measured from where the finger actually started
moving.

The lock transition, verbatim — this is the single most transferable animation block in the file:

```java
private void startLockTransition() {
    AnimatorSet animatorSet = new AnimatorSet();
    try {
        performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP, HapticFeedbackConstants.FLAG_IGNORE_GLOBAL_SETTING);
    } catch (Exception ignored) {}

    ObjectAnimator translate = ObjectAnimator.ofFloat(this, "lockAnimatedTranslation", startTranslation);
    translate.setStartDelay(100);
    translate.setDuration(350);
    ObjectAnimator snap = ObjectAnimator.ofFloat(this, "snapAnimationProgress", 1f);
    snap.setInterpolator(CubicBezierInterpolator.EASE_OUT_QUINT);
    snap.setDuration(250);

    SharedConfig.removeLockRecordAudioVideoHint();

    animatorSet.playTogether(
            snap,
            translate,
            ObjectAnimator.ofFloat(this, "slideToCancelProgress", 1f).setDuration(200),
            ObjectAnimator.ofFloat(slideText, "cancelToProgress", 1f)
    );
    animatorSet.start();
}
```

- **haptic on the catch**, with `FLAG_IGNORE_GLOBAL_SETTING` — Telegram deliberately buzzes even
  when the user has haptic feedback off system-wide;
- **snap 250 ms** on `EASE_OUT_QUINT` = `cubic-bezier(.23, 1, .32, 1)`
  (`CubicBezierInterpolator.java:13`);
- **translate 350 ms after a 100 ms hold** — the circle visibly *settles* rather than jumping;
- the slide-to-cancel hint reverts to full (200 ms) and morphs into a **tappable CANCEL button**
  (`cancelToProgress`);
- **the lock hint is retired forever on the first successful lock.**

### 1.5 What happens on release, before vs after lock

| Release | Outcome |
|---|---|
| before 150 ms | mode toggle + `KEYBOARD_TAP` haptic (§1.2) |
| after 150 ms, `dist > −0.55 × distCanMove` | **stop + send**, then `updateRecordInterface(RECORD_STATE_SENDING)` posted at **+500 ms** (`shouldDrawBackground ? 500 : 0`) |
| after 150 ms, `dist < −0.55 × distCanMove` | cancel (`RECORD_STATE_CANCEL_BY_GESTURE`) |
| after lock | `recordCircle.isSendButtonVisible()` → the touch handler **returns false and does nothing**; recording continues hands-free |
| `ACTION_CANCEL` mid-gesture | **`slideToCancelProgress < 0.7f` → cancel the recording; otherwise → `sendButtonVisible = true; startLockTransition()`** |

That last row is the most useful defensive pattern in the file: **an OS-level cancel is never
allowed to silently destroy a recording** — unless the user was already visibly cancelling, the
system interprets the interruption as *lock* and keeps the audio. This is the Android analogue of
`pointercancel`, and Telegram's answer to it is "promote to hands-free", not "discard".

### 1.6 Geometry and the enlarged circle

| Thing | Value | Where |
|---|---|---|
| composer button container | `DEFAULT_HEIGHT = 44` dp | `:6437` |
| drawn resting pill | 38 × 38 dp, corner r = 19 dp, 3 dp margin | `audioVideoButtonContainer.dispatchDraw` |
| record circle base radius | `circleRadius = dpf2(41)` | `:1968` |
| amplitude bulge | `circleRadiusAmplitude = dp(30)` | `:1969` |
| record overlay height | `dp(194)` | `RecordCircle.onMeasure` |
| enter scale animator | `ObjectAnimator.ofFloat(recordCircle, recordCircleScale, 1).setDuration(300)` + `recordControlsCircleScale` 300 ms, whole set `setInterpolator(new DecelerateInterpolator())`; the icon/label cross-fades run **150 ms** | `updateRecordInterface` |

So the affordance grows from a **19 dp** radius to **41 dp** (≈ 2.2×) and pulses out to ~71 dp at
full mic amplitude. The `scale` property is then re-shaped by a hand-written overshoot curve in
`onDraw` — 0→0.5 grows to 1.0, 0.5→0.75 pulls back to 0.9, 0.75→1.0 returns to 1.0:

```java
if (scale <= 0.5f)       sc = scale / 0.5f;
else if (scale <= 0.75f) sc = 1.0f - (scale - 0.5f) / 0.25f * 0.1f;
else                     sc = 0.9f + (scale - 0.75f) / 0.25f * 0.1f;
```

Exit is `exitTransition` **360 ms with a 490 ms start delay**; a gesture-cancel exit is
`slideToCancelProgress → 1` over **200 ms** on `EASE_BOTH` = `cubic-bezier(.42, 0, .58, 1)`.

### 1.7 The hint economy — teach the gesture at most 3 times, then never again

```java
public void showTooltipIfNeed() {
    if (SharedConfig.lockRecordAudioVideoHint < 3) {
        showTooltip = true;
        showTooltipStartTime = System.currentTimeMillis();
    }
}
```

- The tooltip is armed **when the enter animation ends**, appears **200 ms** later, fades in over
  **150 ms** (`tooltipAlpha += dt / 150f`), and the counter is incremented **only once it has fully
  appeared** — a hint the user never actually saw is not spent.
- It self-suppresses if the user is already moving (`moveProgress < 0.8f`), already locked, or
  exiting.
- `setMovingCords` restarts the tooltip timer when the finger moves more than
  `ViewConfiguration.getScaledTouchSlop()` (stored **squared**, compared against squared distance).
- `startLockTransition` calls `SharedConfig.removeLockRecordAudioVideoHint()` — **one successful
  lock retires the hint permanently.**
- The separate "you can pause" hint is capped at 4 shows via a plain int pref (`voicepausehint`).

The "slide to cancel" chevron pulses **±6 dp at 3 dp / 250 ms** (≈1 s each way, 2 s cycle), and only
while `cancelToProgress == 0 && slideProgress > 0.8f` — the hint animates only before you have
started the gesture it describes. On screens ≤ 320 dp the oscillation is dropped for a static 16 dp
offset.

### 1.8 The locked state gets a TAP target, not a gesture

`SlideTextView` turns the "slide to cancel" run into a hit-tested **CANCEL** button once
`cancelToProgress > 0`, with its own `cancelRect`, ripple (`createSimpleSelectorCircleDrawable(dp(60), …)`)
and `onCancelButtonPressed()`. The composer also exposes the same regions to accessibility via
explicit `AccessibilityNodeInfo` actions (`id == 3` → the cancel rect, `pauseRect`, `onceRect`).
**Every gesture-only action gains a tappable equivalent the moment the hand is free.**

### 1.9 Side effects held for the duration

`updateRecordInterface` acquires a `SCREEN_DIM_WAKE_LOCK | ON_AFTER_RELEASE` named
`"telegram:audio_record_lock"` and calls `AndroidUtilities.lockOrientation(parentActivity)`, both
released on exit.

---

## 2. Signal Android — same family, different numbers [V]

`components/MicrophoneRecorderView.java` is ~250 lines and is the whole gesture.

**State machine:** `NOT_RUNNING → RUNNING_HELD → RUNNING_LOCKED`.

**Activation: none.** `ACTION_DOWN` → permission check → mic-in-use check → `state = RUNNING_HELD;
floatingRecordButton.display(); lockDropTarget.display(); handler.onRecordPressed()`. Recording
begins immediately.

**The tap is bought back downstream**, in `components/InputPanel.java`:

```java
@Override
public void onRecordReleased() {
    long elapsedTime = onRecordHideEvent();
    if (listener != null) {
      if (elapsedTime > 1000) {
        listener.onRecorderFinished();
      } else {
        Toast.makeText(getContext(), R.string.InputPanel_tap_and_hold_to_record_a_voice_message_release_to_send, Toast.LENGTH_LONG).show();
        listener.onRecorderCanceled(true);
      }
    }
}
```

**1000 ms minimum**; under it the clip is discarded and the toast *teaches the gesture*.

**Axis commitment** — Signal's one idea Telegram does not have:

```java
void moveTo(float x, float y) {
  lastOffsetX = getXOffset(x);
  lastOffsetY = getYOffset(y);
  if (Math.abs(lastOffsetX) > Math.abs(lastOffsetY)) { lastOffsetY = 0; } else { lastOffsetX = 0; }
  …
}
```

The dominant axis wins outright and the other is zeroed, so a diagonal drag never half-cancels and
half-locks. (`getXOffset` clamps to leftward-only in LTR; `getYOffset` to upward-only.)

**Lock threshold:** `if (floatingRecordButton.lastOffsetY <= dimensionPixelSize) lockAction();` with

```xml
<dimen name="recording_voice_lock_target">-150dp</dimen>
```

— **150 dp of upward travel**, 2.6× Telegram's 57 dp. The lock target view is also *animated down to
that same offset* (`translationY(dropTargetPosition)`), so the threshold and the visual drop target
are the same number. It appears with `setStartDelay(ANIMATION_DURATION * 2)` = **400 ms** — Signal
does not show the lock affordance until you have clearly committed to holding.

**Cancel threshold — absolute, not relative:**

```java
@Override
public void onRecordMoved(float offsetX, float absoluteX) {
    slideToCancel.moveTo(offsetX);
    float position = absoluteX / recordingContainer.getWidth();
    if (ViewUtil.isLtr(this) && position <= 0.5 || ViewUtil.isRtl(this) && position >= 0.6) {
      this.microphoneRecorderView.cancelAction(true);
    }
}
```

Cancel when the **finger's raw X reaches the horizontal midpoint of the container** — "drag to the
middle of the screen", independent of where the button is. (RTL uses 0.6, not 0.4 — asymmetric, and
almost certainly deliberate slop for the reversed layout.)

**Animation:** one constant for the whole gesture —
`public static final int ANIMATION_DURATION = 200;` — with
`OvershootInterpolator` on appear, `AnticipateOvershootInterpolator(1.5f)` on hide, and a separate
`FADE_TIME = 150` for the text/timer cross-fades. Scale in from **0.5→1.0**.

**Haptics** (`conversation/v2/VoiceMessageRecordingDelegate.kt`, raw millisecond vibrations):

| Moment | Signal |
|---|---|
| record start (`beginRecording`) | `vibrator.vibrate(20)` |
| finished / sent | `vibrateAndResetOrientation(20)` |
| canceled | `vibrateAndResetOrientation(50)` |
| saved as draft | `vibrateAndResetOrientation(50)` |
| **lock caught** | **none** — only `voiceRecorderWakeLock.acquire()` + `SCREEN_ORIENTATION_LOCKED` |

**`ACTION_CANCEL` is treated exactly like `ACTION_UP`** (`case ACTION_CANCEL: case ACTION_UP:` →
`onRecordReleased()`), i.e. an interrupted hold **sends** (if >1 s). Compare Telegram, which
**locks**. Both refuse to discard; they disagree on which way to fail.

**Deltas vs Telegram, at a glance**

| | Telegram | Signal |
|---|---|---|
| activation | 150 ms (dual-mode) / 0 ms (single) | 0 ms |
| tap protection | the 150 ms window → mode switch | 1000 ms minimum duration → toast |
| lock distance | **57 dp**, latches on crossing | **150 dp**, latches on crossing |
| lock affordance appears | with the enter animation | **400 ms** after touch-down |
| cancel | relative: `min(35 % width, 140 dp)`; release-cancel at 55 % of that | absolute: finger crosses 50 % of container width |
| axis handling | cancel progress <0.7 disables lock | hard axis lock (dominant axis wins) |
| animation budget | 300 ms enter / 250 ms lock snap / 200 ms cancel | **200 ms everything**, 150 ms fades |
| haptic on lock | yes, forced past the global setting | **no** |
| haptic on start/stop/cancel | none in the composer path ([U] `MediaController` not read) | 20 / 20 / 50 ms |
| `ACTION_CANCEL` | → **lock** | → **release (send)** |
| screen/orientation | wake lock + orientation lock while recording | wake lock on **lock only**, orientation lock while recording |

---

## 3. WhatsApp, Discord, and the "swipe to call" question

### 3.1 WhatsApp [R]

Same family, and notably **the same tap-to-toggle dual mode**: reported behaviour is tap the mic
icon to switch to video-message mode, hold to record, swipe up to a padlock affordance to lock, and
slide left to cancel. Hands-free lock shipped in WhatsApp beta for Android 2.18.102 / iOS stable.
The lock affordance is described as a padlock rendered **above** the record button, and the locked
state shows a padlock badge at the bottom-right. No numeric thresholds are recoverable from the
teardowns — closed source, so nothing here is better than [R].

### 3.2 Discord [R] — the cancel is a DROP TARGET

From Discord's own support article: *"press and hold the Mic button … release the button to send"*;
*"While pressing and holding down the Mic button, swipe up to lock the recording mode in place"*;
cancel either by *"drag your finger to the Trash icon on the left side and then release"* or, once
locked, *"just tap the Trash icon on the left side."*

So Discord replaces the distance threshold with an explicit **drop target** — a third model beside
Telegram's relative distance and Signal's absolute midpoint. Discord has **no** mic↔video mode
toggle on the button.

### 3.3 Is a swipe-to-CALL gesture precedented? No. [V]

`grep -c 'VoIPService\|startCall' ChatActivityEnterView.java` → **0**. Telegram's composer has no
call entry point of any kind; calls start from header buttons, the profile, or the chat menu. The
same is true of Signal's `InputPanel`/`MicrophoneRecorderView` (no call references). Across the four
peers, **calls are always plain buttons** and the hold-swipe gesture family is reserved for voice
*messages*.

**Implication for us (not evidence):** the swipe-up-to-call half of the owner's design has no field
parameters to borrow and no user muscle memory to inherit. It borrows only the *mechanics* of the
lock gesture. This is the finding most likely to change the spec.

---

## 4. The platform conventions these apps inherit

### 4.1 Android `ViewConfiguration` [V] — the 500 ms everyone quotes is stale

AOSP `frameworks/base` @ `main`, `core/java/android/view/ViewConfiguration.java`:

```java
/** Defines the default duration in milliseconds before a press turns into a long press */
public static final int DEFAULT_LONG_PRESS_TIMEOUT = 400;
…
/** Defines the duration in milliseconds we will wait to see if a touch event is a tap or a scroll. */
private static final int TAP_TIMEOUT = 100;
…
private static final int DOUBLE_TAP_TIMEOUT = 300;
private static final int DOUBLE_TAP_MIN_TIME = 40;
…
/** Distance a touch can wander before we think the user is scrolling in dips. */
private static final int TOUCH_SLOP = 8;
private static final int PAGING_TOUCH_SLOP = TOUCH_SLOP * 2;   // 16
private static final int MIN_SCROLLBAR_TOUCH_TARGET = 48;
private static final int PRESSED_STATE_DURATION = 64;
```

- **Long press = 400 ms** on current AOSP (the widely-cited 500 ms is the historical value), and it
  is **user-overridable** — `getLongPressTimeout()` reads `Settings.Secure.LONG_PRESS_TIMEOUT`
  before falling back to the constant. An accessibility user can set it much higher.
- **Touch slop = 8 dp**, and the source comment says the constant is *"only used as a fallback by
  legacy/misbehaving applications"* — the real value comes from
  `config_viewConfigurationTouchSlop` and can be overlaid per device.
- Neither Telegram nor Signal uses `getLongPressTimeout()` for this gesture. Telegram uses
  `getScaledTouchSlop()` only to re-arm a tooltip.

### 4.2 iOS equivalents [R]

`UILongPressGestureRecognizer` defaults: `minimumPressDuration = 0.5` s, `allowableMovement = 10`
points. **Not verified** — Apple's documentation pages are JS-rendered and the fetcher returns only
the title; these are the values consistently reported by secondary sources. Re-buy from the SDK
headers if an iOS target ever matters.

### 4.3 Material 3 motion tokens [V]

`material-components-android` `motion/res/values/tokens.xml` (header: `Version: 34.0.0`):

```xml
<string name="m3_sys_motion_easing_standard">cubic-bezier(0.2, 0, 0, 1)</string>
<string name="m3_sys_motion_easing_standard_accelerate">cubic-bezier(0.3, 0, 1, 1)</string>
<string name="m3_sys_motion_easing_standard_decelerate">cubic-bezier(0, 0, 0, 1)</string>
<string name="m3_sys_motion_easing_emphasized_accelerate">cubic-bezier(0.3, 0, 0.8, 0.2)</string>
<string name="m3_sys_motion_easing_emphasized_decelerate">cubic-bezier(0.1, 0.7, 0.1, 1)</string>
<string name="m3_sys_motion_easing_emphasized">path(M 0,0 C 0.05, 0, 0.133333, 0.06, 0.166666, 0.4 C 0.208333, 0.82, 0.25, 1, 1, 1)</string>
<integer name="m3_sys_motion_duration_short2">100</integer>
<integer name="m3_sys_motion_duration_short3">150</integer>
<integer name="m3_sys_motion_duration_short4">200</integer>
<integer name="m3_sys_motion_duration_medium1">250</integer>
<integer name="m3_sys_motion_duration_medium2">300</integer>
<integer name="m3_sys_motion_duration_medium4">400</integer>
```

Note `emphasized` is a **two-segment path**, not a cubic-bezier — it is not expressible as a single
CSS `cubic-bezier()`. M3's current guidance has moved further, to spring tokens (`…spring_fast_spatial_damping 0.9 / stiffness 1400`,
`…spring_default_spatial 0.9 / 700`), which CSS cannot express either. Where a spec needs one CSS
easing, `standard-decelerate` `cubic-bezier(0,0,0,1)` is the closest shipped token for a
"grows and settles" entrance.

**The field's own values land inside M3's scale:** Telegram's 300 ms enter = `medium2`; its 250 ms
lock snap = `medium1`; its 150 ms cross-fades = `short3`; Signal's 200 ms = `short4` and its 150 ms
fade = `short3`.

### 4.4 Haptic conventions at "catch" moments

Both apps buzz at exactly the moments where a *threshold latches* or *state changes irreversibly*,
never continuously. Telegram: mode-switch tap, lock catch. Signal: record start, record end, cancel.
Telegram's `FLAG_IGNORE_GLOBAL_SETTING` on the lock catch is the strongest statement in either
codebase about how important that particular confirmation is — it overrides the user's system-wide
haptics-off preference. Neither app vibrates on crossing the *cancel* threshold mid-drag (Signal's
50 ms fires at the end of the cancel, not at the boundary).

---

## 5. Pointer Events on mobile browsers [V]

### 5.1 Support is not the issue

`mdn/browser-compat-data` @ `main`, read 2026-09-12:

| Feature | Chrome Android | Firefox Android | Safari iOS |
|---|---|---|---|
| `Element.setPointerCapture` | ✅ (mirrors desktop) | ✅ 79 (pre-82 threw `InvalidPointerId` instead of `NotFoundError`) | ✅ |
| `releasePointerCapture` / `hasPointerCapture` | ✅ | ✅ 79 | ✅ |
| `pointercancel` event | ✅ | ✅ 79 | ✅ |
| `gotpointercapture` | ✅ | ✅ 79 | ✅ |
| `touch-action` (incl. `none`, `pan-x`, `pan-y`, `manipulation`) | ✅ | ✅ 52 | ✅ 9.3 |

Everything this gesture needs is universally available. The risk is behavioural, not
availability-shaped.

### 5.2 Implicit pointer capture means you get capture for free on touch

Pointer Events Level 3, the `pointerdown` algorithm: when a `pointerdown` occurs on a **direct
manipulation device** targeting an element, the UA must *"**set pointer capture** for this
`pointerId` to the target element as described in **implicit pointer capture**"*.

So on touch, `pointermove`/`pointerup` keep targeting the button even after the finger leaves its
box — an explicit `setPointerCapture(e.pointerId)` in `pointerdown` is **belt-and-braces, not the
mechanism**. It is still worth calling: it makes the same code path work for mouse/pen (where
capture is *not* implicit), and it is what MDN's own slider example does.

Capture releases itself: per MDN, *"Subsequent events for the pointer will be targeted at the
capture element until capture is released (via `Element.releasePointerCapture()` or the `pointerup`
event is fired)"*, and the spec adds that on `pointercancel` the UA must *"implicitly release the
pointer capture if the pointer is currently captured."*

### 5.3 `touch-action` is the ONLY way to stop the browser stealing the gesture

The spec is explicit, and this is the single most important web fact in the dossier:

> *"Viewport manipulations (panning and zooming) … are intentionally NOT a default action of pointer
> events, meaning that these behaviors … cannot be suppressed by canceling a pointer event. Authors
> must instead use `touch-action` to explicitly declare the direct manipulation behavior for a
> region."*

`preventDefault()` on `pointerdown`/`pointermove` will **not** stop a scroll. A vertical
swipe-up on a button inside a scrollable composer will be claimed by the scroller, which fires
`pointercancel` and ends the gesture. The normative `pointercancel` list includes *"The pointer is
subsequently used by the user agent to manipulate the page viewport (e.g. panning or zooming)"*,
*"The user agent has opened a modal dialog or menu"*, *"A pointer input device is physically
disconnected"*, and *"As part of the drag operation initiation algorithm"*.

⇒ **the mic button must carry `touch-action: none`** (not `pan-y`, not `manipulation` — the gesture
uses both axes). [V]

A practical corollary worth pinning in the spec: `touch-action` is evaluated at hit-test time on
`pointerdown`, so toggling it from JS *after* the gesture starts is too late. Set it statically in
CSS on the button. [U — spec wording implies it; not separately probed.]

### 5.4 Do not assume a click follows

The spec notes that after capture is released and `lostpointercapture` is dispatched, a resulting
`click` *"would still be dispatched to the capturing target"* — so a `click` handler and a
`pointerup` handler on the same button will both run. The dual-mode design must pick one owner for
"tap" (recommendation: derive tap from `pointerup` timing inside the pointer state machine, and do
not also bind `onClick`).

### 5.5 GeckoView divergences

No Firefox-Android-specific pointer-capture defect is recorded in BCD beyond the pre-82 exception
type. One live oddity: GeckoView *"sometimes converts mouse events to touch events depending on the
`TOOL_TYPE` of the incoming event and the pref `ui.android.mouse_as_touch`"* [R, Mozilla docs/bug
discussion] — irrelevant for finger input, relevant only if a stylus or a connected mouse is used.
**A real device probe on Fennec remains owed** (§11).

---

## 6. Long-press side effects to suppress [V unless noted]

**The `contextmenu` event.** Supported on Chrome Android and Firefox Android; **not supported at all
on Safari iOS** (BCD: `version_added: false`, WebKit bug 213953). `preventDefault()` on it is the
standard suppression.

**Firefox for Android's historical trap, now fixed.** Bugzilla 1481923 — *"[Android]
preventDefault() in contextmenu listener cancels touch event generation (sends touchcancel)"* —
**RESOLVED FIXED, target milestone `91 Branch`** (queried via the Bugzilla REST API today). Before
Fx 91, cancelling the context menu on Android *killed the in-flight touch sequence*, which would
have destroyed exactly this gesture. Modern Fennec is fine. Related: bug 1256339 (FIXED, Fx 50)
documented the old sequence `touchdown, contextmenu, touchcancel`; bug **1906956** — *"Firefox
generates synthetic touchend before, instead of after, trying to open the context menu"* — is
**UNCONFIRMED**, last touched 2025-01-18, and is the one still-open ordering oddity in this area.

**What the reference web client actually does.** Telegram Web A (`src/hooks/useContextMenuHandlers.ts`)
does *not* fight the native menu on touch at all — it rolls its own:

```ts
const LONG_TAP_DURATION_MS = 200;
…
timer = window.setTimeout(() => emulateContextMenuEvent(e), LONG_TAP_DURATION_MS);
…
element.addEventListener('touchstart', startLongPressTimer, { passive: true });
element.addEventListener('touchcancel', clearLongPressTimer, true);
element.addEventListener('touchend',    clearLongPressTimer, true);
element.addEventListener('touchmove',   clearLongPressTimer, { passive: true });
```

**200 ms, and ANY `touchmove` cancels it — zero slop.** The real `contextmenu` event is
`preventDefault()`ed in `handleContextMenu`, a `no-selection` class is added to the target on
right-click, and the *next* `touchend`/`click` is swallowed with a capturing
`stopImmediatePropagation + preventDefault + stopPropagation` so the emulated menu does not
click-through. Two iOS-PWA-specific workarounds sit beside it (a 100 ms delayed listener teardown,
and swallowing `mousedown`+`click`).

**Text selection.** `user-select: none` on the button (and `-webkit-user-select: none` for older
WebKit) is required; without it Android's long-press can start a selection and raise the selection
handles/magnifier over the affordance.

**iOS, for completeness.** `-webkit-touch-callout: none` disables the touch-and-hold callout —
MDN: *"When a target is touched and held on iOS, Safari displays a callout information about the
link. This property allows disabling that behavior."* It is explicitly **non-standard**
(*"We do not recommend using non-standard features in production"*). Safari has no `contextmenu`
event to cancel, so the callout + `user-select` are the whole suppression story there.

**Drag start.** `dragstart` is in the spec's `pointercancel` trigger list (*"As part of the drag
operation initiation algorithm"*). On a `<button>` with no draggable content and
`user-select: none` this should not arise; add `draggable="false"` / `ondragstart → preventDefault`
on any `<img>`/icon inside the button. [U]

---

## 7. The Vibration API [V]

`mdn/browser-compat-data` `api/Navigator.json` → `vibrate`:

| Browser | Status |
|---|---|
| **Chrome Android** | ✅ since 32. *"Beginning in Chrome 55, this is not supported in cross-origin iframes."* *"Beginning in Chrome 60, this method requires a user gesture. Otherwise it returns `false`."* |
| **Firefox Android** | ⚠️ **`partial_implementation: true` since 79** — *"Vibration is disabled. If the window is visible, then `navigator.vibrate()` returns `true`, but no vibration takes place (regardless of hardware support). Originally, the intent was to disable it for cross-origin frames only (bug 1591113), but the feature was not re-enabled due to abuse concerns (bug 1653318)."* |
| **Firefox desktop** | ❌ `version_removed: 129` |
| **Safari / iOS** | ❌ (never shipped) |

Bugzilla **1653318** *"Decide what to do with navigator.vibrate()"* — queried today: **status `NEW`,
last changed 2025-11-12.** Still undecided; Fennec haptics are not coming back on a known schedule.

MDN adds: *"Sticky user activation is required"*; *"If the device doesn't support vibration, this
method has no effect"*; *"Some devices may not vibrate if they are in Silent mode or Do Not Disturb
(DND) mode."*

**Verdict:** usable on Chrome Android inside the gesture (which is by definition user-activated);
**a silent, undetectable no-op on the owner's Fennec**, because the return value lies. Haptics must
be *decoration on a state change the UI already shows visually*, never the only signal — which
happens to be exactly how Telegram and Signal use them (both pair every buzz with a visible
transition).

---

## 8. Accessibility

### 8.1 The web clients do NOT hold-to-record [V] — the load-bearing precedent

Telegram Web A (`Ajaxy/telegram-tt` @ `9cb10b20`):

- `src/components/middle/composer/hooks/useVoiceRecording.ts` exposes
  `startRecordingVoice` / `stopRecordingVoice` / `cancelRecordingVoice` — **no pointer handling at
  all**, no hold, no drag.
- `src/components/common/Composer.tsx` renders one `<Button>` whose state machine is
  `MainButtonState.{Forward,Edit,Record,Schedule,Send}`; in `Record` state `onClick` runs
  `void startRecordingVoice()` (or `startRecordingVideo()`). **Tap to start.**
- Cancel is the keyboard: `useEffect(() => activeVoiceRecording ? captureEscKeyListener(cancelRecordingVoice) : undefined, …)` — **Esc**.
- The mic↔video switch is `onContextMenu={mainButtonContextMenuHandler}` opening `RecordModeMenu`,
  a plain two-item `<Menu>` (`AttachAudio` / `AttachVideoMessage`). On touch that is the 200 ms
  emulated long-press of §6; on desktop it is right-click. Mode is remembered
  (`recordMode: lastRecordMessageMode ?? 'voice'`).
- The accessible name carries the mode, same as Android:
  ```ts
  case MainButtonState.Record:
    sendButtonAriaLabel = isRecordingVideoMode ? 'AccDescrVideoMessage' : 'AccDescrVoiceMessage';
  ```
  passed as `ariaLabel={oldLang(sendButtonAriaLabel)}`. No `aria-pressed`, no `role="switch"`, no
  live region.

So the best-resourced web client of the app that *invented* this gesture ships **tap-toggle +
context-menu mode switch + Esc**, and holds nothing. [U] — WhatsApp Web / Discord web not checked
this pass.

### 8.2 There is no ARIA pattern for "press and hold"

No WAI-ARIA Authoring Practices pattern covers press-and-hold or drag-to-commit; the APG's closest
neighbours are Button, Switch and Slider (all discrete). What *does* govern this design is WCAG:

**SC 2.5.1 Pointer Gestures (A):** *"All functionality that uses multipoint or path-based gestures
for operation can be operated with a single pointer without a path-based gesture, unless a
multipoint or path-based gesture is essential."* Swiping is named explicitly as path-based. The
Understanding doc: complex gestures are fine *"so long as the functionality can also be operated by
another method, such as a tap, click, double tap, double click, long press, or click & hold"* — and
critically, *"the single pointer non-path-based alternative can't exclusively rely on a dragging
movement, as this would fail the requirements of 2.5.7 Dragging Movements."*

**SC 2.5.2 Pointer Cancellation (A):** at least one of —
*"**No Down-Event:** The down-event of the pointer is not used to execute any part of the function"*;
*"**Abort or Undo:** Completion of the function is on the up-event, and a mechanism is available to
abort the function before completion or to undo the function after completion"*;
*"**Up Reversal:** The up-event reverses any outcome of the preceding down-event"*;
*"**Essential**"*.

The field already satisfies this by construction: the *send* completes on the up-event and
slide-to-cancel **is** the abort mechanism. Telegram's post-lock tappable CANCEL button (§1.8) and
Discord's tappable trash icon are the same instinct — **every gesture gets a tap twin**.

**SC 2.5.7 Dragging Movements (AA, WCAG 2.2)** additionally demands a non-dragging single-pointer
path for anything drag-operated: cancel and lock both need button equivalents.

### 8.3 Recommended semantics for a dual-mode control (synthesis, cites §1.2/§8.1)

Both Telegram clients put the mode in the **accessible name** and re-announce on change; neither
uses `aria-pressed`. That is the precedent, and it is the right one here because the two modes are
not "on/off" — they are two different destinations. Concretely: one `<button>`, `aria-label` =
"Voice message" / "Voice call", updated on toggle; announce the change with a polite live region
(the web equivalent of Telegram's `TYPE_VIEW_FOCUSED` re-fire); expose the record/lock/cancel
actions as real focusable buttons whenever the hand is free; keep Esc as the cancel key.

---

# IMPLICATIONS (ages fast — evidence above ages slowly)

## 9. Recommended parameter table for ctrl-b

Every value traces to a finding. "Field split" means the peers genuinely disagree.

| Parameter | Recommend | Traces to | Note |
|---|---|---|---|
| **Activation delay (hold → record)** | **150 ms** | §1.1 [V] | Telegram's value *for the dual-mode case*, which is ours exactly. Do **not** use 400/500 ms — no peer does. |
| **Tap window (→ switch mode)** | release **< 150 ms** and movement < slop | §1.1–1.2 [V] | Same timer, two outcomes. |
| **Movement slop before a tap is disqualified** | **8 px** | §4.1 [V] AOSP `TOUCH_SLOP = 8` dp; iOS 10 pt [R] | Telegram Web uses **zero** slop for its long-press (§6) — too strict for a thumb; prefer 8 px. |
| **Cancel distance (slide left), commit** | **min(35 % of viewport width, 140 px)** → ≈126 px at 360 px | §1.3 [V] | **Field split.** Signal = absolute 50 %-of-width [V]; Discord = a drop target [R]. Telegram's relative form is the only one that gives continuous progress feedback and behaves at 360 px; recommend it. |
| **Cancel on release** | dist < **55 %** of the above (≈ −69 px @360) | §1.3 [V] | Letting go "most of the way there" must not send. |
| **Axis commitment** | disable lock once cancel progress < 0.7 (≈ −38 px) **or** hard-lock the dominant axis | §1.3 [V] / §2 [V] | Telegram does the former, Signal the latter. Signal's is simpler and strictly better for a diagonal thumb arc; Telegram's preserves a continuous cancel animation. Pick one and pin it. |
| **Lock distance (swipe up) — dictation** | **56 px** | §1.4 [V] `dp(57)` | **Field split, 2.6×.** Signal = 150 dp [V]. 57 dp is reachable in one thumb flick from a bottom-right button; 150 dp is a deliberate arm movement. |
| **Lock commit moment — dictation** | **on crossing** (latch, no release) | §1.4, §2 [V] | Both peers agree. |
| **Call-mode swipe-up commit** | **56 px threshold, but commit on RELEASE** | our deviation; rationale below | Locking is cheap to undo (§1.8 leaves a CANCEL button). Starting a call opens a mic session + a WebSocket + kills C3 on teardown. Commit-on-release keeps the "slide back down to back out" escape that the lock gesture doesn't need. **Flag this to the owner — it is a deliberate departure from the Telegram mechanic.** |
| **Minimum recording duration** | **1000 ms**, else discard + teach | §2 [V] | Signal's rule. Cheap insurance against a mis-timed hold producing a 200 ms clip. |
| **Grow animation (button → record affordance)** | **300 ms**, `cubic-bezier(0, 0, 0, 1)`; scale ≈ **2.2×** radius | §1.6 [V] (300 ms + DecelerateInterpolator; 19 dp→41 dp), §4.3 [V] (`standard-decelerate`, `medium2`) | Signal's 200 ms + overshoot is the alternative; 300 ms decelerate reads calmer and matches M3 `medium2`. |
| **Icon / label cross-fades** | **150 ms** | §1.6, §2 [V]; M3 `short3` | Both peers converge. |
| **Lock-catch snap** | **250 ms**, `cubic-bezier(.23, 1, .32, 1)` | §1.4 [V] (`EASE_OUT_QUINT`, verbatim from `CubicBezierInterpolator.java:13`) | Optionally the 100 ms-delayed 350 ms settle alongside it. |
| **Cancel/exit** | **200 ms**, `cubic-bezier(.42, 0, .58, 1)` | §1.6 [V] (`EASE_BOTH`) | |
| **Lock affordance reveal** | on record start (Telegram) **or** +400 ms (Signal) | §1.6 / §2 [V] | Split. Prefer Telegram's (immediate) — our hint budget is small and the affordance *is* the teaching. |
| **Slide-to-cancel chevron hint** | oscillate **±6 px**, ~1 s each way, only before the drag starts | §1.7 [V] | Gate behind `prefers-reduced-motion` via our `UIState`/Appearance Switch, not an OS media query (CLAUDE.md hard rule). |
| **Hint budget** | show the lock hint **≤3 times**, count only once fully visible, **retire permanently on first successful lock** | §1.7 [V] | The whole discoverability design in three rules. |
| **Haptic points** | record start **20 ms**; lock/call catch **short pulse**; cancel **50 ms**; mode-switch tap **short pulse** | §2 [V] (20/20/50), §1.2/§1.4 [V] (toggle + lock) | Merged: Signal's start/stop/cancel + Telegram's toggle/lock. **All decorative** — no-op on Fennec (§7). |
| **`touch-action`** | **`none`** on the button, set statically in CSS | §5.3 [V] | Non-negotiable; `pan-*` and `manipulation` both lose an axis. |
| **`user-select`** | `none` (+ `-webkit-user-select`) | §6 [V] | |
| **`contextmenu`** | `preventDefault()` | §6 [V] | Safe on Fennec ≥91 (bug 1481923 FIXED). |
| **Keyboard / AT path** | tap-toggles-mode + **tap-to-start / tap-to-stop** + **Esc to cancel**, and a real CANCEL button whenever the hand is free | §8.1 [V], §8.2 [V] | This is both the WCAG 2.5.1/2.5.7 alternative **and** exactly what Telegram Web ships. |
| **Accessible name** | `aria-label` = the *mode* ("Voice message" / "Voice call"), re-announced on change; no `aria-pressed` | §1.2, §8.1 [V] | Both Telegram clients, independently. |
| **Mode persistence** | remember globally; persist only on a user toggle | §1.2 [V], §8.1 [V] | Ours belongs in the existing settings/UIState seam, not a new map (CLAUDE.md 2026-06-24 directive). |
| **Screen wake during a hold** | acquire; release on exit | §1.9 [V], §2 [V] | We already have Wake Lock in the call overlay design (LIVE_VOICE_PLAN §6). |

## 10. Web-implementation risks, each with its field/spec mitigation

1. **The scroller steals the swipe-up and you get `pointercancel`.** The spec says viewport
   panning *cannot* be suppressed by cancelling a pointer event (§5.3). → `touch-action: none` on
   the button, in CSS, statically.
2. **`pointercancel` will still happen** (modal/menu opening, orientation change, device
   disconnect, drag start — §5.3) and it **silently releases capture** (§5.2). → Never treat it as
   "nothing happened". Both peers refuse to lose the recording: Telegram **promotes to lock**,
   Signal **releases (sends)** (§1.5, §2). Pick one, pin it in the spec, and test it.
3. **Firefox for Android haptics are a lie.** `navigator.vibrate()` returns `true` and does nothing
   since Fx 79; the tracking bug is still open (§7). → Every haptic must accompany a visible state
   change. No feature detection is possible; do not branch on the return value.
4. **`contextmenu` on long-press.** Cancelling it used to kill the touch stream on Android Firefox
   (bug 1481923) — **fixed in Fx 91** (§6). → `preventDefault()` is safe now; still pair it with
   `user-select: none` so the selection handles never appear, and keep bug 1906956 (touchend
   ordering, UNCONFIRMED) on the watch list.
5. **Double-firing "tap".** A `click` still dispatches to the capturing target after
   `lostpointercapture` (§5.4). → Own "tap" in the pointer state machine only; do not also bind
   `onClick`.
6. **A 150 ms hold that never becomes a recording.** `getUserMedia` permission and device open are
   async and can take far longer than the gesture. → Telegram runs the permission request *inside*
   the delayed runnable and simply returns if it must prompt (§1.1); Signal checks permission on
   `ACTION_DOWN` before entering `RUNNING_HELD` (§2). Decide explicitly what a release during
   mic-acquisition means.
7. **The mic is already in use.** Signal checks `AudioManager.getMode() == MODE_IN_COMMUNICATION ||
   MODE_IN_CALL` on touch-down and refuses (§2). Our call mode makes this a *self*-collision risk
   (hold-to-dictate while a call is live). → Gate at touch-down, with a message.
8. **Threshold reachability at 360 px.** Our owner's phone is 360 px wide (ISS/media-manager S6
   record). Telegram's cancel distance evaluates to 126 px there, Signal's to ~180 px. A 140 px
   fixed cancel distance from a right-edge button leaves almost no travel. → Use the *relative*
   form and re-measure on resize/rotation, as Telegram does per gesture (§1.3).
9. **WCAG 2.5.1 / 2.5.7 failure by omission.** Path-based gestures need a single-pointer,
   non-dragging alternative (§8.2). → The tap-toggle + tap-start/stop + Esc + visible CANCEL button
   set (§9) is not a nice-to-have; it is the conformance argument.
10. **Reduced motion.** The chevron oscillation and the grow/settle are continuous motion on a
    control the user is touching. → Gate through `UIState` + the Appearance Switch, never a raw
    `@media (prefers-reduced-motion)` block (CLAUDE.md hard rule; THEME_ENGINE §14.11).
11. **`touch-action` changed mid-gesture does nothing** (§5.3, [U]). → Never toggle it from JS to
    "enable" the gesture; ship it static.
12. **Novelty risk on the call half.** No peer starts a call with a gesture (§3.3). → Keep a plain,
    discoverable tap path to the call at all times; treat the swipe as an accelerator, and consider
    committing it on release (§9) so it is escapable.

## 11. Gaps — what this pass did NOT buy

- **Device probes on the owner's phone.** Nothing here was run on Honor 20 / Chrome / Fennec:
  actual `pointercancel` incidence, whether `touch-action: none` on a composer button survives the
  address-bar collapse gesture, whether the long-press selection magnifier still appears. **Owed
  before the spec locks.** [U]
- **Telegram's record-START haptic.** `MediaController.startRecording` was not read; the composer
  file contains no start haptic, but the vibration may live there. [U]
- **WhatsApp/Discord numeric thresholds** — closed source; [R] only, and no teardown publishes dp
  values.
- **iOS `UILongPressGestureRecognizer` defaults** — Apple's docs are JS-rendered and unfetchable;
  0.5 s / 10 pt is [R]. Irrelevant while the owner is on Android.
- **WhatsApp Web / Discord web** voice-recording behaviour — only Telegram Web was read. The
  hypothesis that *no* major web client ships hold-to-record is currently n=1. [U]
- **Telegram's `voiceOnce` / pause affordances** (the "once" bubble and pause button that appear
  above the locked circle) were seen but not dissected — out of scope.
