# R102 — Stick-to-bottom while a reply streams: unstick on scroll-up, re-stick at the bottom — peer field pass (2026-10-06)

**Serves:** the owner's report (session 61): while the agent's reply streams the chat snaps back to the
bottom; wanted = the ChatGPT / SillyTavern behaviour (follow while at the bottom, let go the moment the
reader scrolls up, follow again when they return to the bottom).
**Status:** evidence, no decision yet. Opus 5.5 research lane, one agent, no subagents. Our own code is
audited in the session scratch file `~/.cache/tmp/ctrlb-session61/audit-scroll.md` (file:line); §0
summarises it.
**Confidence marks:** **[V]** verified by reading the source at the SHA below · **[R]** reported (an
upstream PR/issue/commit text, i.e. the authors' own account) · **[U]** expected but not checked.

## Sources (pinned)

| Project | Ref read | Date | How |
|---|---|---|---|
| SillyTavern | `release` @ `06bde939fb` | 2026-09-14 | shallow clone + `gh` (issues #335, #270; PRs #1999, #2546, #4382, #4791) |
| use-stick-to-bottom (stackblitz-labs) | `main` @ `8d6a19a0ca` = npm `1.1.6` | 2026-06-04 | shallow clone + `npm view` + `gh` (issues #8, #9, #32, #40) |
| Vercel AI Elements `Conversation` | `vercel/ai-elements` `main` @ `6a9d5b1822`, `packages/elements/src/conversation.tsx` | 2026-08-21 | `gh api` contents |
| open-webui | `main` @ `8bd8b4fac5` | 2026-09-21 | shallow clone |
| LibreChat | `main` @ `e1dfc10449` | 2026-10-06 | shallow clone + `gh` (commit `d920328bfa`, PR #14770) |
| CSS Scroll Anchoring | drafts.csswg.org/css-scroll-anchoring (editor's draft) | fetched 2026-10-06 | spec text |

Clones lived in `~/.cache/tmp/ctrlb-session61/clones/` and were deleted after the pass.
**Not bought:** LobeChat, Chatbox (skipped — the four above already span every design in the field);
ChatGPT web/app (closed source; no observation possible from this lane — see §6).

---

## 0. Ours, in one paragraph (detail + file:line in the scratch audit)

One scroller for every theme: `#app-scroll` (`theme-engine/kit/DefaultRoot.tsx:378`); `ChatThread` grabs it
by id. **"Stuck" = POSITION sampled per `scroll` event**: `ChatThread.tsx:983`
`stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;`. The pin
(`el.scrollTop = el.scrollHeight`, `:976`) fires on every streamed chunk (`useEffect(pin, [messages, active])`,
`:1004-1007` — `appendDelta` rebuilds `messages` per SSE delta) AND on every line-wrap (a `ResizeObserver(pin)`
on `#chatlog`, `:991-996`). Each pin resets the distance to ~0, so a drag only escapes if it covers
≥ 140 px inside ONE inter-chunk gap; otherwise the next chunk drags the reader back. The pin's own write also
fires `scroll` and re-asserts `stick` — no programmatic/user distinction. No "jump to latest" pill; a send
while escaped does not re-stick; no test pins any of it. **This is precisely the bug two peers fixed and
documented (§1 PR #4382, §3 LibreChat).** Correction to our own comment at `ChatThread.tsx:969-971`
("follows the bot without yanking them down if they scrolled up") — true when idle, false while streaming.

---

## 1. SillyTavern — a `scrollLock` latch set by any scroll that leaves the bottom (5 px)

**The mechanism [V]** (`public/script.js`):

- `:460` — `let scrollLock = false;` (module flag; `true` = "the user has taken over").
- `:11226-11245` — the detector, on the chat scroller's `scroll` event:

  ```js
  const scrollIsAtBottom = Math.abs(chatElementScroll.scrollHeight - chatElementScroll.clientHeight - chatElementScroll.scrollTop) < 5;
  // Resume autoscroll if the user scrolls to the bottom
  if (scrollLock && scrollIsAtBottom) { scrollLock = false; }
  // Cancel autoscroll if the user scrolls up
  if (!scrollLock && !scrollIsAtBottom) { scrollLock = true; }
  ```
- `:3741-3743` — the follow, at the end of each streaming progress tick: `if (!scrollLock) { scrollChatToBottom({ waitForFrame: true }); }`.
- `:2773-2807` — `scrollChatToBottom`: honours the user setting `power_user.auto_scroll_chat_to_bottom`
  (default `true`, `scripts/power-user.js:184`; the "Auto-scroll Chat" checkbox, `index.html:5423-5426`), sets
  `scrollTop = scrollHeight`, and with `waitForFrame` coalesces into ONE `requestAnimationFrame`
  (cancelling a pending one) — PR #4791 (2025-11-22) "prevents layout thrashing".
- Streaming progress is throttled: `new Stopwatch(1000 / power_user.streaming_fps)` (`:3873`, default 30 fps,
  `power-user.js:134`; `Stopwatch.tick` skips calls inside the interval, `scripts/utils.js:1404-1432`).
- **Re-stick on a new turn:** `generate()` sets `scrollLock = false` once the reply message exists
  (`:3860-3864`), and a sent user message goes through `addOneMessage` (`sendMessageAsUser`, `:5918`) whose
  default `scroll = true` calls `scrollChatToBottom` (`:2599-2602`) — the resulting scroll event lands at the
  bottom and clears the lock.
- **No jump-to-bottom pill** for the chat; only a keyboard shortcut (Ctrl+Shift+↓,
  `scripts/RossAscends-mods.js:1025-1029`).

**History — the same bug, three times [R]** (the authors' own words):

1. Issue **#335** (2023-05-17), verbatim our owner's report: *"When I go scroll up while the generation is
   being streamed it jumps back down to the bottom."* A collaborator proposed the "Magnetic Scrolling Lock";
   closed 2023-06-11. Interim fix: `$('#chat').on('mousewheel touchstart', () => { scrollLock = true; })`
   (intent events; PR #1999, 2024-04-01, swapped `mousewheel` → `wheel` because Firefox never fired it).
2. PR **#2546** (2024-07-23, Cohee): *"Only stop if you scroll away from the autoscrolling position. And
   resume when you manually scroll back"* — the position check above, but hooked to `wheel` + `touchmove`
   with a **1 px** tolerance.
3. PR **#4382** (2025-08-14, "Fix overly sticky auto-scroll behavior"): *"While a generated message is
   streaming in, it is almost impossible to cancel the auto-scroll behavior by scrolling up, it just snaps
   back down. The reason is that the 'wheel' and 'touchmove' events trigger before the scroll position is
   updated. So the scrollIsAtBottom value never becomes false. That is, unless the user manages to scroll up
   quick enough to beat the call to scrollChatToBottom()"* → moved the handler to `scroll`, widened to
   **5 px** ("small enough to be generally unnoticeable but significantly easier to hit"); tested on
   Chrome + Firefox, Linux + **Android**.

**Why it works for ST [V + inference]:** the band is TINY (5 px), so any real upward drag leaves it on the
first frame and latches; a programmatic pin lands exactly on the bottom so its own scroll event reads
"at bottom". **The residual hazard [U, inferred, not observed]:** ST never marks its own writes — if a chunk
grows the content ≥ 5 px between the rAF pin and the next frame's `scroll` dispatch, the pin's own event
reads "not at bottom" and latches the lock spuriously; the 30 fps throttle + rAF coalescing make this rare
rather than impossible. Our 140-px band is the opposite trade (spurious unsticks impossible, real escapes
impossible while streaming).

## 2. `use-stick-to-bottom` (StackBlitz, MIT) — direction-based escape + marked programmatic writes

**Package [V]:** npm `1.1.6` (2026-06-04), MIT (`LICENSE.txt`), **zero runtime deps**, peer
`react ^16.8 || ^17 || ^18 || ^19` (we run `^19.2.0`), unpacked 32.9 kB; source = `src/useStickToBottom.ts`
(665 lines) + `src/StickToBottom.tsx` (188). Built for bolt.new. **Used by Vercel AI Elements [V]:**
`conversation.tsx` wraps `<StickToBottom initial="smooth" resize="smooth" role="log">`, and
`ConversationScrollButton` renders `!isAtBottom && <Button onClick={() => scrollToBottom()}>` (the ↓ pill).

**The algorithm [V]** (`src/useStickToBottom.ts`):

- **State:** `escapedFromLock` (the user took over), `isAtBottom` (we are following), `isNearBottom`
  (`scrollDifference <= STICK_TO_BOTTOM_OFFSET_PX` = **70 px**, `:131`, `:271-273`).
- **Programmatic writes are marked:** the `scrollTop` setter (`:203-221`) writes, then records
  `state.ignoreScrollToTop = scrollRef.current.scrollTop`; it also forces `style.scrollBehavior = "auto"`
  around the write *"so programmatic scrollTop assignments take effect immediately and aren't intercepted by
  the browser's smooth scrolling"* and restores it.
- **Escape = DIRECTION, not position** — `handleScroll` (`:412-479`): compares `scrollTop` with
  `lastScrollTop`; work is deferred one `setTimeout(…, 1)` because *"Scroll events may come before a
  ResizeObserver event"* (`:435-441`, citing WICG/resize-observer#25). Then:
  - skip if `state.resizeDifference` is non-zero (a content resize is in flight) **or**
    `scrollTop === ignoreScrollToTop` (our own write) (`:446-448`);
  - text selection in progress (mouse down + selection inside the scroller) ⇒ escape (`:450-454`);
  - `isScrollingUp` ⇒ `escapedFromLock = true; isAtBottom = false` (`:464-467`) — **any** upward move, no
    distance band;
  - `isScrollingDown` ⇒ `escapedFromLock = false` (`:469-471`), and only if also near the bottom (≤ 70 px)
    ⇒ `isAtBottom = true` (`:473-475`) — i.e. re-stick on ARRIVAL heading down.
- **Wheel (desktop) [V]** `handleWheel` (`:481-509`): `deltaY < 0` on this scroller ⇒ escape immediately —
  *"The browser may cancel the scrolling from the mouse wheel if we update it from the animation in
  meantime."* No touch listeners at all: touch escapes ride the `scroll`-direction path.
- **Growth** — a `ResizeObserver` on the CONTENT element (`:518-594`): records `resizeDifference`; clamps an
  overscroll (`:538-540`); positive growth ⇒ `scrollToBottom({preserveScrollPosition: true, wait: true})`
  (follows only if `isAtBottom`); **negative growth** (content shrank) while near the bottom ⇒
  un-escape + re-stick (`:563-573`); `resizeDifference` is cleared after rAF + `setTimeout(1)` so the scroll
  event the resize caused is ignored (`:577-590`).
- **The "spring" [V]** (`:331-352`): per animation frame, `velocity = (damping·velocity +
  stiffness·scrollDifference) / mass`, accumulated with a 60-fps-normalised `tickDelta`; defaults
  `damping 0.7, stiffness 0.05, mass 1.25` (`:41-64`); `"instant"` bypasses it. `RETAIN_ANIMATION_DURATION_MS
  = 350` keeps a follow alive briefly after landing (`:133`, `:555-561`).
- Module side effect: global `document` `mousedown`/`mouseup`/`click` listeners at import (`:135-147`).

**Known gaps [R]** (its own tracker): **#9 "Bad on iOS"** (open; maintainer: *"since bolt.new doesn't target
iOS i haven't yet tweaked all the stuff to work correctly on iOS … I must have done like 1000 commits to get it
working well on desktop"*); **#40** (open, 2026-05-19) — the RO watches only the content, so a scroll
container that SHRINKS because a flex sibling grew (our keyboard / composer case) drifts off the bottom;
**#8** — no first-class "scroller is not my element" mode (workaround: `useImperativeHandle(scrollRef, …)`,
which *"breaks the unstick detection as it's listening for scroll events from the element"*); **#32** —
Safari zoom sub-pixel feedback loop with `smooth`.

## 3. LibreChat — direction latch, asymmetric thresholds, the send "glide" (the most battle-scarred)

`client/src/hooks/Messages/useMessageScrolling.ts` @ `e1dfc10449`, rewritten in `d920328bfa` (2026-08-13,
PR #14770) [V]:

- **One authority, `isStuckRef`** (`:35-38`): *"Driven only by what the reader does, never by the observer,
  whose zero-height sentinel flickers as content grows and was the source of the attach/detach churn."*
- **The rule, verbatim** (`:325-328`): *"Direction decides, not position. Heading up lets go at once and stays
  let go, however close to the end the reader still is; anything position-based drags them back before they
  have cleared the band, which reads as the thread refusing to be scrolled. Heading down only re-attaches on
  arrival at the end."* — this is OUR bug, named.
- **Asymmetric thresholds** (`:15-21`): `attachThreshold = 150`, `detachThreshold = 24` — *"Arriving counts
  from further out than leaving does, because while an answer streams the end is a moving target: it recedes
  between the reader's last wheel tick and the frame that measures it, so someone scrolling all the way down
  still lands tens of pixels short."*
- **The scroll handler** (`:100-148`): `movingDown = top >= previousTop`; down ⇒ re-stick if `distance <=
  150`; up ⇒ un-stick only if `distance > 24` (so a clamp that lands on the bottom is never an escape). The
  first event after mount is a baseline only (`lastScrollTopRef` seeded at −1, `:44-48`, `:113-121`) — the
  commit message records the bug: seeded at 0, *"the first scroll event on an opened thread … read as a jump
  downward … re-pinned a reader to the stream they were scrolling away from"*.
- **Programmatic writes leave a baseline** (`:87-98`, `:178-197`): `followBottom()` writes `scrollTop`
  directly **per frame** (*"correcting on every frame reads as the text simply flowing upward, while
  correcting every 145ms reads as a thread that lurches"*) and sets `lastScrollTopRef = target`, so the
  echo `scroll` event reads as "not moving up".
- **Wheel** (`:344-361`): `deltaY < 0` ⇒ un-stick at once; down-ticks clear a stale abort flag.
- **Growth** — RO on the content (`:290-299`) → `reconcileContentResize` (`:250-288`): clamp-to-content
  first; a resize caused by a reader's own `pointerdown`/`keydown` inside the content (expanding a tool card)
  is NOT followed — the stuck state becomes "where the interaction left them" (`:256-268`, `:301-317`);
  follow only while `isSubmitting && isStuckRef`.
- **Send re-attaches** (`:381-408`): a new turn starting ⇒ `isStuckRef = true` + a smooth "glide" to the
  bottom (`scrollTo({behavior:'smooth'})`, landed on `scrollend` or a 700 ms fallback, `:199-231`);
  mid-glide deltas don't follow (*"a plain follow writes scrollTop outright, which cancels an animation on
  its first frame"*); an upward gesture during the glide wins (`glideInterruptedRef`).
- **Pill** `components/Chat/Messages/ScrollButton.tsx`: an IntersectionObserver on a zero-height
  `messages-end` sentinel (threshold 0.85, 150 ms debounce) — *reports only*; it no longer decides stickiness.
- `overflowAnchor: 'none'` only while their progressive-mount window pins rows itself
  (`MessagesView.tsx:146-149`) — *"native scroll anchoring reacting to the same insertions would
  double-correct"*.
- 19 vitest cases pin it (`hooks/Messages/__tests__/useMessageScrolling.spec.tsx`), e.g. *"does not follow
  resizes after the user scrolls away from the bottom"*, *"obeys the first scroll away from a thread that was
  placed at its end"*, *"clamps the scroll position back to content after a resize shrink"*.

## 4. open-webui — position band (5 px) per scroll event + a ↓ button; send does NOT force re-stick

`src/lib/components/chat/Chat.svelte` @ `8bd8b4fac5` [V]:

- Detector (`:4386-4392`), on the messages container's `on:scroll`:
  `autoScroll = scrollHeight - scrollTop <= clientHeight + 5;` — same SHAPE as ours, a 5-px band instead of 140.
- Follow (`:2469-2482`): `autoScrollToBottom()` gated by `autoScroll && $settings.scrollOnResponseGeneration`
  (a user setting, default on — `common/InterfaceSettings.svelte:39,1157`), coalesced into one rAF; called per
  streamed delta (`:3936`) and on completion events (`:1249`). `scrollToBottom` = `scrollTo({top:
  scrollHeight, behavior})` (`:2432-2438`).
- Re-stick: `autoScroll = true` on new chat (`:2145`) and chat load (`:2358`); the ↓ button above the
  composer when `autoScroll === false` sets it true + scrolls (`MessageInput.svelte:1679-1690`).
  **A send only scrolls if already following** (`if (autoScroll) scrollToBottom()` in `sendMessage` `:3236`,
  `createMessagePair` `:2686`, `addMessages` `:2750`) — a reader who escaped stays escaped when they send.
- No programmatic/user distinction (same residual hazard as ST, [U]).

## 5. The CSS primitives — why the browser will not do this for us

- **Scroll anchoring (`overflow-anchor: auto`, the default) [V, spec]:** its stated purpose is the
  opposite case — *"Changes in DOM elements above the visible region of a scrolling box can result in the
  page moving while the user is in the middle of consuming the content."* It keeps an **anchor node inside
  the viewport** still; content appended BELOW the viewport does not move that anchor, so nothing is
  adjusted and the view does not follow. And: *"If S is not scrolled away from the origin of its scrolling
  area in its block flow direction, then do not select an anchor node for S."* It is useful to us in the
  OTHER direction — when the reader has escaped and something above them changes (the pinned plan panel, a
  disclosure), anchoring keeps their place. Note *"The scroll adjustment is a type of scrolling … and
  generates scroll events"* — anchoring corrections arrive as `scroll` events a detector must tolerate.
- **`flex-direction: column-reverse` [U]** — the classic CSS-only trick (scroll origin at the bottom, so
  appends stay in view natively and anchoring keeps an escaped reader still). Not evaluated at source here;
  not viable for us regardless: `#app-scroll` is ONE scroller shared by every section, holds the appbar,
  and gacha's oracle progress + the per-section restore read absolute `scrollTop` (audit §1).
- **`scroll-behavior: smooth`** on the scroller turns every pin into an animation; rapid appends restart it
  (LibreChat's glide notes). use-stick-to-bottom force-overrides it to `auto` around its writes (§2).
- `scroll-snap`: nobody in the field uses it for this; no evidence it helps.

## 6. ChatGPT, Claude Code

- **ChatGPT web/app [U]:** closed source, not observable from this lane. Widely described as: follows while
  at the bottom, stops when you scroll up, shows a ↓ button. Whether scrolling back to the bottom re-sticks
  without the button was NOT verified — buy it by hand on the owner's phone if the design hinges on it.
- **Claude Code terminal:** the owner reports the same snap-back; out of scope (not a web scroller).

## 7. The standard pattern, stated once

```
stuck  := ¬escaped                       (one latch; the observer never decides it)
on content growth / container shrink:   if stuck → write scrollTop = max  (instant), and MARK the write
on scroll event:
    if it is our marked write, or a clamp/anchoring echo during a resize window → update baseline, ignore
    moving UP   (top < last) and not at the bottom (distance > small ε)   → escaped := true
    moving DOWN (top > last) and distance ≤ attach band (generous)       → escaped := false
on wheel deltaY < 0 (desktop only)      → escaped := true
on a new USER turn (send)               → escaped := false; go to the bottom          (ST, LibreChat; NOT open-webui)
pill ↓ visible while escaped; tap       → escaped := false; go to the bottom          (AI Elements, open-webui, LibreChat)
```

The classic bugs, each fixed by a peer: position-band escape swallowed by per-chunk pins (ST #335/#4382,
LibreChat, **us**); our own write's `scroll` event read as the user's (use-stick-to-bottom
`ignoreScrollToTop`, LibreChat baseline); the first event after placing the thread read against 0
(LibreChat); intent events (`wheel`/`touchmove`) firing BEFORE the position updates (ST #4382); a content
SHRINK's clamp read as "scrolled up" (use-stick-to-bottom `resizeDifference`, LibreChat `detachThreshold`);
re-stick too tight to hit while the end recedes (LibreChat 150 vs 24, ST 1 → 5 px). **Android touch:** no
`wheel`; touch escapes come only from `scroll` direction (use-stick-to-bottom has no touch handler; ST's
#4382 tested Chrome + Firefox on Android with the `scroll`-event version).

**What was WRONG in the brief's premises:** ST has no "scroll-lock UI toggle" — `scrollLock` is an internal
flag; the UI setting is "Auto-scroll Chat" (`auto_scroll_chat_to_bottom`), an on/off for following at all.
"Every app re-sticks on a new user message" — open-webui does not (§4).

---

## 8. Implications for ctrl-b (the lane's reading — short, separate, not a decision)

**Seams to reuse:** the existing `stick` ref + `pin()` + the three triggers in `ChatThread.tsx:972-1018`
(keep the tab-entry jump rule and the RO on `#app-scroll`/`#composer` for keyboard/composer); the chat
derivation already passed in (`status === "streaming"`, `streamingId`, `messages` with the `fresh` +
`role: "user"` marks — key "a send re-sticks" on the LOG, since the dictation auto-send bypasses
`useComposer().send`); the `CallOverlay.tsx:721-746` copy of the rule (8 px) is a second consumer of the
same fix; the `scrollKeep.ts` module-slot pattern if an escape should survive a theme-Root remount; the
fake-scroller stand-in in `tests/themes/gachaAgent.test.tsx:255-294` for vitest.

**Ranked designs (at most two):**

1. **Own hook (~60–90 lines), direction latch — RECOMMENDED.** Replace the 140-px band with LibreChat's
   rule: `escaped` latch; up-move with distance > ~24 px ⇒ escape; down-move into a generous band (~150 px)
   ⇒ re-stick; mark our own writes (record the written `scrollTop` as the baseline); never treat a scroll
   that ends ON the bottom as an escape (covers the `ThinkBlock open={working}` collapse, audit §4); gate
   the listener on `active` (the scroller is shared). Add: re-stick on a fresh user message; a kit ↓ pill
   while escaped (tap = re-stick + jump). Serves the overlay too. No dep; fits `#app-scroll`-by-id; desktop
   wheel escape is an optional 3-line add.
2. **Adopt `use-stick-to-bottom`** (`useStickToBottom()`, feed `scrollRef(#app-scroll)` + `contentRef(#chatlog)`
   by hand, `resize: "instant"`). Buys the most-tested desktop logic (direction + resize window + selection
   escape). Costs: a dep whose mobile path is admittedly untuned (#9), which does not watch the container
   shrinking (#40 — we would keep our own scroller/composer RO anyway), whose shared-scroller wiring is the
   awkward case (#8), plus import-time global listeners and per-frame spring writes on the phone. Under
   `deps-ok-if-justified` the justification is thin: the part we need is ~5 of its ideas, not its spring.

**Edge cases the design must rule on:** a send / a mid-stream steer while escaped (peers: send re-sticks —
ST, LibreChat; a steer is unruled anywhere); the reply ending while escaped (peers: nothing happens; the
pill stays — AI Elements/open-webui/LibreChat; a "new" dot on the pill is ours to decide); the keyboard
opening (stuck ⇒ the existing scroller RO re-pins; escaped ⇒ leave alone); a theme switch mid-stream
(today: re-stuck by remount — keep, or carry `escaped` via the `scrollKeep` slot); `scroll-behavior:
smooth` if a theme ever sets it (force `auto` on our writes); tapping a disclosure inside the log while
stuck (LibreChat does not follow that one resize).

**Test plan:** vitest with the stand-in scroller (drivable `scrollTop`/`scrollHeight`/`clientHeight`,
dispatched `scroll` events, a manual RO stub): (1) stuck + growth pins; (2) a small UP move mid-stream ⇒ the
next delta does NOT pin; (3) our own pin's `scroll` echo never escapes; (4) a shrink clamp to the bottom
never escapes; (5) a DOWN move into the band re-sticks; (6) a fresh user message re-sticks; (7) tab entry
re-sticks; (8) another section's scrolls never flip the latch; (9) the pill shows while escaped and its tap
re-sticks. **Phone-only** (owner card): the feel of a slow drag + a fling during a fast stream, a fling
running into the bottom re-sticking, the keyboard opening stuck vs escaped, the band sizes on the Honor 20.
