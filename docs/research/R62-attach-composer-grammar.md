# R62 — The attach-and-caption COMPOSER GRAMMAR in phone-first messengers

**Date:** 2026-09-01 · **Bounded pass, one agent, no subagents.** · **Draft — main seat curates the index row.**

**The question (main seat, 2026-09-01).** ctrl-b wants composer attachments with the owner's
described feel: *"a small clip icon next to the send/record icon … the image goes into the text
field, and you could keep texting below or even recording … the text field will grow up with the
image thumbnails"*, named reference **Telegram**. So: **where do staged media previews live
relative to the text field, and how do caption, mic, send and the expand affordance compose?**

**Relationship to the already-bought passes.** This dossier is **composer staging/caption grammar
only**. It deliberately does not re-cover [R61](./R61-chat-attachments-field.md) (transport, wire
shape, history cost, capability detection — the end-to-end attachment plumbing), [R54](./R54-crop-upload-client.md)/[R55](./R55-media-upload-backend.md)
(client/backend image pipeline), or [R56](./R56-gallery-management-ux.md)/[R59](./R59-art-library-presentation.md)
(gallery management UX). Where R61 already settled a point it is cited, not re-derived.

---

## Confidence legend

- **[V]** — I cloned the repo at the stated SHA, read the file, and quoted it.
- **[V-doc]** — quoted from an official vendor help page fetched 2026-09-01.
- **[R]** — reported by a secondary source (vendor help summary, community post, search result).
- **[U]** — expected but unverified; called out as such.

## Sources read (SHAs, cloned + read 2026-09-01)

| App | Repo | SHA | Head date |
|---|---|---|---|
| Telegram Web A | `Ajaxy/telegram-tt` | `9cb10b20797dc09e33fcffee0ba390bb429c66d3` | 2026-08-28 |
| Telegram Android | `DrKLO/Telegram` | `62b56a07ca7e30e39f7fd00a6728d6bbd716ca1c` | 2026-08-25 |
| Signal Desktop | `signalapp/Signal-Desktop` | `dd424a9642204dfb52584e8d625e48a50dc3d137` | 2026-08-26 |
| open-webui | `open-webui/open-webui` | `2a960a59fe1dbbd35282f0556b3666d81102e781` | 2026-08-31 (same SHA as R61) |
| WhatsApp · Slack · Discord | vendor help / search only | fetched 2026-09-01 | — |

*(Clones were made under `/home/emma/.cache/tmp/r62` — never `/tmp`, which is RAM on emma — and
deleted after the pass. Line numbers are against the SHAs above and will drift.)*

---

## §0 — TL;DR: the verdict facts

1. **THE FIELD SPLIT IS REAL AND IT IS CLEAN. Two grammars, and which one an app ships is
   predicted by *what the message is*, not by phone-vs-desktop:**

   | Grammar | Staged media lives… | Caption is… | Who ships it |
   |---|---|---|---|
   | **① MODAL CAPTION SCREEN** | in a dedicated overlay/sheet that *covers* the composer | a field **inside that overlay**, below the preview grid | **Telegram** (Web A modal · Android bottom sheet) **[V]**, WhatsApp **[R]** |
   | **② IN-COMPOSER STAGED RAIL** | a thumbnail row **inside the composer box, above the text field** | the composer's **own** text field — unchanged | **Signal Desktop** **[V]**, **open-webui** **[V]**, Slack **[R]**, Discord **[R]**, and per R61 §1.9/§2.10/§3.5 LibreChat + AnythingLLM + goose |

   The discriminator is *media-first vs text-first*. Messengers where a photo IS the message
   (Telegram, WhatsApp) hand you a **media screen with a caption**. Apps where the text is the
   message and the file is an argument to it (Signal, and every LLM chat app in R61) keep the
   composer and **grow it upward with chips**. There is no phone/desktop split inside a vendor:
   Telegram uses grammar ① on *both* Web A and Android; Signal uses ② on desktop and (**[U]**, not
   read) mobile.

2. **⚠ THE OWNER'S DESCRIBED FEEL IS NOT WHAT TELEGRAM ACTUALLY DOES.** "The image goes into the
   text field … keep texting below or even recording … the field grows up with the thumbnails"
   describes grammar **②**. Telegram ships **①**: selecting media **replaces** the composer with a
   modal/sheet. In Web A the main input is literally deactivated — `isActive={!hasAttachments}`
   (`Composer.tsx:2789`) **[V]** — and the mic is unreachable behind the modal. The owner's memory
   is nonetheless *honest about the sensation*, and the mechanism is findable (§1.6): Telegram
   **hands the already-typed text across** into the caption field, and the sheet's caption pill
   sits at the bottom exactly where the composer was, with the grid growing upward above it. It
   *feels* like the field grew. It is a different widget.

3. **ONE CAPTION PER SEND is the near-universal rule, and both Telegram clients enforce it in the
   send loop, not the UI.** Web A carries a single `hasSentCaption` flag and puts the text on
   exactly one message of the batch (`messages.ts:722-778`) **[V]**. Android supports a
   *per-item* caption (`SendingMediaInfo.caption`) but degrades to the single shared field
   whenever at most one item has one — `captionForAllMedia()` returns `captionCount <= 1`
   (`ChatAttachAlertPhotoLayout.java:3590-3607`) **[V]**. Signal has exactly one caption and it
   *is* the composer draft — the image editor's caption seeds from `draftText` and writes back
   into the composer on Done (`CompositionArea.dom.tsx:1139,1199-1203`) **[V]**. WhatsApp is the
   outlier that genuinely ships per-photo captions **[R]**.

4. **VOICE AND STAGED MEDIA ARE MUTUALLY EXCLUSIVE IN EVERY MESSENGER READ — and NOT exclusive in
   the LLM-app class.** Telegram Web A: a finished recording **overwrites** the staged set,
   `currentAttachments = [voiceAttachment]` (`Composer.tsx:1571-1583`) **[V]**, and the clip button
   is hidden while recording (`isButtonVisible={!activeRecording}`, `Composer.tsx:2709`) **[V]**.
   Signal: the mic button disappears the moment *anything* is drafted
   (`shouldShowMicrophone = … && !hasDraft({draftText, draftAttachments, …})`,
   `CompositionArea.dom.tsx:626-634`) and clicking it with attachments staged raises
   `ToastType.VoiceNoteMustBeTheOnlyAttachment` (`AudioCapture.dom.tsx:40-46`) **[V]**.
   **open-webui's Dictate button is gated only on the stream being idle and the `stt` permission —
   NOT on `files.length`** (`MessageInput.svelte:2576-2578`) **[V]**. The owner's "or even
   recording" is achievable, and grammar ② is what makes it structurally possible: a modal that
   covers the composer takes the mic with it.

5. **THE EXPAND AFFORDANCE IS A REAL, CONVERGENT PATTERN AND THREE INDEPENDENT CODEBASES PICK THE
   SAME TRIGGER: ≥3 LINES → a button at the input's TOP-RIGHT.** Telegram Web A
   (`setShouldShowRichInputButton(totalLines >= 3)`, `Composer.tsx:2130-2131`) **[V]**; Telegram
   Android's AI button (`getLineCount() > 2`, `ChatAttachAlert.java:3298`) **[V]**; open-webui
   (`{#if prompt.split('\n').length > 2}`, `MessageInput.svelte:1990`) **[V]**. Signal is the
   dissenter: a **manual, always-available** hover chevron centered on the composer's top edge
   (`CompositionArea.scss:114-124`) **[V]**. Full detail in §5.

6. **The numbers that matter** (all **[V]** unless marked): album group max **10** (both Telegram
   clients); Telegram caption cap **1024** free / **4096** premium vs message cap **4096/8192** —
   **attaching an image cuts your text budget 4×**; Signal max staged **32**, thumbnails
   **120×120**, rail **max-height 142px**, horizontally scrolling; open-webui chips **40×40**,
   wrapping; Telegram Web A modal tiles **2-up, 12rem tall, 2px gap**. Full table in §6.

---

## §1 — Telegram Web A `9cb10b2` **[V]**

### 1.1 The attach menu

`src/components/middle/composer/AttachMenu.tsx` — a round translucent `composer-action-button`
carrying `<Icon name="attach" />` (`:240`), rendered inside `message-input-wrapper` between the
bot/send-as buttons and the message input. It opens a `Menu` (`:243-`) whose items are:

| Item | Icon | Line |
|---|---|---|
| Photo or Video | `photo` | `:270` |
| Document / Music | `document` | `:277` |
| Send logs (debug builds) | `bug` | `:283` |
| Poll | `poll` | `:288` |
| To-do list | `select` | `:291` |
| Insert date | `calendar` | `:294` |
| **Article (= expand the composer)** | `article` | `:300` |
| attach-bots (mini apps) | — | `:305-` |

The button is **hidden while recording**: `isButtonVisible={!activeRecording}`
(`Composer.tsx:2709`).

### 1.2 Staged media renders in a MODAL, not the composer

`AttachmentModal.tsx` is a `<Modal>` whose openness is derived purely from the staged array:

`src/components/middle/composer/AttachmentModal.tsx:203` **[V]**
```ts
  const isOpen = Boolean(attachments.length);
```

Layout inside the modal, top to bottom: a condensed header (close ×, a pluralised title —
`AttachmentSendPhoto` / `…Video` / `…Audio` / `…File` with `count` — and a ⋯ menu), then the
preview grid, then the caption pill with the send button in it.

- Dialog `max-width: 26.25rem` (420px) desktop; on `.mobile` it is `max-width: 100% !important;
  margin: 0` and enters with `translate3d(0, 8rem, 0)` — i.e. **it slides up from the bottom like a
  sheet**, and `padding-bottom: env(safe-area-inset-bottom)` (`AttachmentModal.module.scss:12-88`).
- Preview area: `display:flex; flex-wrap:wrap; gap:0.125rem; min-height:5rem; max-height:26rem;`
  → `max-height: 80vh` under 600px (`:91-119`).
- Each tile: `flex: 1 calc(50% - 0.5rem)` with `.preview { height: 12rem; object-fit: cover }`
  → **two-up, 192px tall**; a single attachment goes full-width with `max-height: 24rem`
  (`AttachmentModalItem.module.scss:1-40`).
- Per-tile hover overlay with **edit / spoiler / delete** icons (`AttachmentModalItem.tsx:122-147`).
  **No drag-reorder** in Web A.

### 1.3 The caption field — ONE per modal, and it is the SAME editor as the composer

`AttachmentModal.tsx:106` **[V]**
```ts
const ATTACHMENT_MODAL_INPUT_ID = 'caption-input-text';
```

`AttachmentModal.tsx:844-857` **[V]**
```tsx
            <MessageInput
              ref={inputRef}
              id={ATTACHMENT_MODAL_INPUT_ID}
              …
              isAttachmentModalInput
              editableInputId={EDITABLE_INPUT_MODAL_ID}
              placeholder={lang('AttachmentCaptionPlaceholder')}
              onSend={handleSendClick}
              maxLength={captionLimit}
```

**The load-bearing detail:** `Composer.tsx` passes the *same* `richEditor` instance to both the
main input (`:2782`) and the modal (`:2589`). One editor, two mount points. So text typed before
you hit the clip is already in the caption when the modal opens, and text typed in the caption
survives cancelling the modal. That is the whole "keep texting" continuity — a shared draft, not a
shared widget.

The caption pill also hosts a `SymbolMenuButton` (emoji/stickers) on the left and the send button
on the right, and the whole pill is `margin: 1rem; border-radius: 1.5rem`
(`AttachmentModal.module.scss:121-137`) — the same shape as the composer it replaced.

**Caption cap vs message cap** (`src/limits.ts:26-27`) **[V]**
```ts
  messageLength: [4096, 8192],
  captionLength: [1024, 4096],
```
`[free, premium]`. Attaching an image therefore **quarters** a free user's text budget, silently —
the modal's `maxLength={captionLimit}` vs the composer's `maxLength={… maxMessageLength}`
(`Composer.tsx:2804`).

### 1.4 The ⋯ menu = every per-send option, all of them modal-scoped

From `renderHeader()` (`AttachmentModal.tsx:649-736`) **[V]**: *Add* (append more files),
*Move caption up/down* (`isInvertedMedia` — put the text above the media), *Send as file(s)* /
*Send as media*, *Send in high/standard quality*, *Enable/disable spoiler*, and **Group all
media / Ungroup all media** (`shouldSendGrouped`). All except *Add* persist to
`attachmentSettings` on send.

### 1.5 Album grouping happens at SEND, and the caption lands on exactly one message

`src/config.ts:381` **[V]**
```ts
export const MAX_MEDIA_FILES_FOR_ALBUM = 10;
```

`src/global/actions/api/messages.ts:718-778` **[V]** — the staged array is first split into runs of
the same *type* (`splitAttachmentsByType`, `:3842-3859`: `audio | file | gif | media | voice`,
contiguous runs only), then each run is chunked:

```ts
        const groupedAttachments = split(group, MAX_MEDIA_FILES_FOR_ALBUM);
```

and a single `hasSentCaption` flag makes sure the text rides exactly one of the resulting messages
— the **first** message when the run is compressed media, the **last** when it is files.
**Consequence: staging 25 photos with one caption produces THREE albums and the caption appears on
album 1 only.** There is no count cap at staging time — only a per-file size check that raises
`openLimitReachedModal({ limit: 'uploadMaxFileparts' })` (`useAttachmentModal.ts:69-72`).

### 1.6 Mic vs staged media

`MainButtonState` (`Composer.tsx:343-350`) morphs one button between
`Send | Record | Edit | Schedule | Forward | SendOneTime`. The Record branch
(`Composer.tsx:1164-1168`) **[V]**:

```ts
    if ((IS_VOICE_RECORDING_SUPPORTED || IS_VIDEO_RECORDING_SUPPORTED)
      && !activeVoiceRecording && !activeVideoRecording && !isForwarding && !isRichInputExpansionActive
      && !(hasInputContent && !hasAttachments)) {
      return MainButtonState.Record;
    }
```

— but this is moot while media is staged, because the modal is on top of it. The decisive rule is
in the send path (`Composer.tsx:1571-1583`) **[V]**:

```ts
    let currentAttachments = attachments;

    if (activeVoiceRecording) {
      const record = await stopRecordingVoice();
      …
        currentAttachments = [await buildAttachment(
          VOICE_RECORDING_FILENAME, blob, { voice: { duration, waveform }, ttlSeconds },
        )];
```

**A voice note REPLACES the staged set outright.** Voice + photos in one message is not
representable. The exclusion is bidirectional: recording hides the clip (`:2709`), staging hides
the mic (behind the modal).

### 1.7 Paste and drop

- **Paste** (`hooks/useClipboardPaste.ts`) **[V]** — a capture-phase `document` listener that only
  fires when the event target is one of `EDITABLE_INPUT_ID | EDITABLE_INPUT_MODAL_ID |
  EDITABLE_STORY_INPUT_ID` **and** is `document.activeElement` (`:15,45-53`). Files are
  **appended**: `setAttachments((attachments) => attachments.concat(newAttachments))` (`:114`), so
  pasting into the caption adds to the batch. Any text on the same clipboard is inserted at the
  cursor in the *same* paste (`:117-119`).
- **Drop onto the chat** (`DropArea.tsx`) — a portal with **two** targets:
  `DropAreaState.QuickFile` (→ `shouldCompress: true`, send as media) and `DropAreaState.Document`
  (→ `shouldCompress: false`, send as file) (`:79,104`). Either opens the modal.
- **Drop onto the open modal** — the modal is itself a drop target
  (`styles.dropTarget`, `data-attach-description={lang('AttachmentDragAddItems')}`,
  `AttachmentModal.tsx:766-780`), appending to the batch.

### 1.8 The EXPAND affordance — Web A ships one

Composer state: `isRichInputExpanded` (global) → `isRichInputExpansionActive` (`Composer.tsx:536`).

**Trigger** (`Composer.tsx:2118-2137`) **[V]**
```ts
  const updateShouldShowRichInputButton = useLastCallback(() => {
    if (hasAttachments) {
      setShouldShowRichInputButton(false);
      return;
    }
    requestMeasure(() => {
      const input = inputRef.current;
      if (!input || (!hasInputContent && !input.textContent)) {
        setShouldShowRichInputButton(false);
        return;
      }
      const { totalLines } = calcTextLineHeightAndCount(input, true);
      setShouldShowRichInputButton(totalLines >= 3);
    });
  });
  …
  useResizeObserver(inputRef, updateShouldShowRichInputButton, hasAttachments);
```

**≥3 *rendered* lines** (wrapping counts — it measures line height against the element), re-measured
on every draft change *and* on resize. Note `hasAttachments` ⇒ hidden: **Telegram never offers
expand while media is staged**, because in grammar ① the composer isn't the active surface.

**Gate** (`Composer.tsx:2516-2519`) **[V]**
```ts
  const canOpenRichInput = shouldShowRichInputButton && isInMessageList && !hasAttachments && !isRichInputExpanded
    && !isComposerBlocked;
  const canCloseRichInput = Boolean(isRichInputExpansionActive && !isComposerBlocked);
  const canToggleRichInput = canOpenRichInput || canCloseRichInput;
```

**Placement** (`Composer.scss:704-726`) **[V]** — absolutely positioned inside the input pill:
```scss
  .rich-editor-button {
    position: absolute;
    z-index: 1;
    top: 0.4375rem;
    right: 0.625rem;
    width: 1.75rem;
    height: 1.75rem;
```
28×28px, top-right of the field, fading in/out over 150ms (`.rich-editor-button-hidden { opacity: 0 }`).
Icon swaps `expand` ⇄ `collapse` (`Composer.tsx:2774`). **A second, always-available entry point
is the attach menu's *Article* item** (`AttachMenu.tsx:299-301`) — the clip and the expand are
deliberately adjacent affordances.

**What expanded mode adds** (`Composer.tsx:2635-2745`, `Composer.scss:333-360`) **[V]**:
- The input grows to `--rich-input-height: calc(var(--vh,1vh)*100 - header - footer offsets)` —
  effectively full-viewport minus chrome.
- An **undo/redo pair** slides down into view (`.rich-editor-history`, `translateY(-125%) → 0`,
  200ms).
- A `RichEditorToolbar` is enabled (`MessageInput.tsx:875`).
- The reply/edit strip (`ComposerEmbeddedMessage isHidden`) and the link preview are **hidden**.
- The whole right-hand action-button cluster is unmounted (`isInMessageList &&
  !isRichInputExpansionActive`, `:2806`), and **`MainButtonState.Record` is excluded** — the mic is
  off in expanded mode (`:1165`).
- **Auto-expand on rich content**: pasting content that can only be expressed richly flips it open
  without a click (`MessageInput.tsx:347-358`, `shouldExpandRichInput = isMainInput &&
  !isRichInputExpanded && isRichOnlyContent && !wasRichOnlyContentRef.current`).
- Dismissal: Esc, or a `mousedown` anywhere outside a documented allow-list of surfaces
  (`.message-input-wrapper`, `.main-button`, `[data-text-formatter]`, `.Menu`, `.Modal`,
  `[aria-modal="true"]`, `.symbol-menu`, `.composer-tooltip`) (`Composer.tsx:2148-2183`).

---

## §2 — Telegram Android `62b56a0` **[V]** (the owner's actual reference device)

### 2.1 The composer's button geography confirms the owner's phrasing

`ChatActivityEnterView.java:2806` **[V]** — the clip lives **inside the text-field container**, at
its bottom-right:
```java
            messageEditTextContainer.addView(attachButton, LayoutHelper.createFrame(DEFAULT_HEIGHT, DEFAULT_HEIGHT, Gravity.BOTTOM | Gravity.RIGHT));
```
(icon `R.drawable.msg_input_attach2`, `:2804`.) The mic/round-video button is a *sibling of the
send button*, in a separate container outside the field (`:3221`):
```java
        sendButtonContainer.addView(audioVideoButtonContainer, LayoutHelper.createFrame(DEFAULT_HEIGHT, DEFAULT_HEIGHT, Gravity.RIGHT | Gravity.BOTTOM));
```
So the owner's *"a small clip icon next to the send/record icon"* is an accurate reading of the
Android composer: clip at the field's inner right edge, mic/send immediately to its right.

### 2.2 Staging = a bottom sheet, and the composer's text is HANDED ACROSS

`ChatActivity.java:13546-13560` **[V]** — `openAttachMenu()`:
```java
        if (currentChat != null && messageSuggestionParams != null || isEphemeralMessage || chatMode == MODE_WELCOME_MESSAGES) {
            chatAttachAlert.setMaxSelectedPhotos(1, true);
        } else if (currentChat != null && !ChatObject.hasAdminRights(currentChat) && currentChat.slowmode_enabled) {
            chatAttachAlert.setMaxSelectedPhotos(10, true);
        } else {
            chatAttachAlert.setMaxSelectedPhotos(-1, true);
        }
        chatAttachAlert.enableDefaultMode();
        chatAttachAlert.init();
        chatAttachAlert.getCommentView().setText(chatActivityEnterView.getFieldText());
        chatAttachAlert.parentThemeDelegate = themeDelegate;
        showDialog(chatAttachAlert);
```

**That last-but-two line is the mechanism behind the owner's remembered feel.** Whatever you had
typed is moved verbatim into the sheet's caption field. Selection is **unlimited by default**
(`-1`); 10 under slowmode; 1 for suggestions/ephemeral.

The reverse direction exists too — the photo viewer's caption writes back:
`ChatActivity.java:19929-19933` **[V]** `onApplyCaption(CharSequence caption) {
chatActivityEnterView.setFieldText(caption, true); }`.

### 2.3 The sheet's caption pill sits exactly where the composer was

`ChatAttachAlert.java:3213` **[V]** — `commentTextView.setHint(getString("AddCaption", R.string.AddCaption));`
`ChatAttachAlert.java:3303` **[V]**:
```java
        captionContainer.addView(commentTextView, LayoutHelper.createFrame(LayoutHelper.MATCH_PARENT, LayoutHelper.WRAP_CONTENT, Gravity.BOTTOM | Gravity.LEFT, 0, 0, 84, 0));
```
`Gravity.BOTTOM`, `WRAP_CONTENT` (it grows with the text), right inset 84dp to clear the send FAB
(`writeButton`, a `ChatActivityEnterView.SendButton`, `:3545`). Above it the photo grid scrolls.
The sheet even animates its top edge from the composer's old position
(`chatActivityEnterViewAnimateFromTop` → a 200ms `CubicBezierInterpolator` on
`captionEditTextTopOffset`, `:2975-2992`) — an explicit "the composer grew into this" transition.
A `moveCaptionButton` inside the caption view (`:3461`) toggles caption-above-media
(`isCaptionAbove()`), matching Web A's `isInvertedMedia`.

### 2.4 Android is the one Telegram client with PER-ITEM captions

`SendMessagesHelper.java:623-628` **[V]**
```java
    public static class SendingMediaInfo {
        public Uri uri;
        public String imagePath;
        public String path;
        public String caption;
```
Per-entry. But the UI collapses to one shared field unless you have actually typed more than one:
`ChatAttachAlertPhotoLayout.java:3590-3607` **[V]**
```java
    public boolean captionForAllMedia() {
        …
            if (!TextUtils.isEmpty(caption)) { captionCount++; }
        }
        return captionCount <= 1;
    }
```
and the sheet's shared caption is applied to the **first** selected item only
(`applyCaption`, `:3566-3588`; also `:1014-1019` on opening the viewer).

### 2.5 The "Media Preview" second screen — WYSIWYG albums with drag-reorder

`ChatAttachAlertPhotoLayoutPreview.java` **[V]** — a second layer inside the same sheet, titled
`R.string.AttachMediaPreview` (`:129`), reached via a `R.string.AttachMediaPreviewButton` /
`R.string.Back` toggle (`:238,269`). It runs a `GroupCalculator` (`:315-`) that computes the real
album mosaic positions (`MessageObject.GroupedMessagePosition`) so the preview matches how the
album will render in the chat, and supports dragging a photo between groups
(`draggingCell`, `:92-99`; hint string `R.string.AttachMediaDragHint`, `:931`).
**This is the strongest single idea in the pass that ctrl-b does not need: preview the *result*,
not the *inputs*.**

### 2.6 Album chunking + caption limit

`SendMessagesHelper.java:10822` **[V]** — `} else if (groupMediaFinal && count > 1 && mediaCount % 10 == 0) {` → a new `groupId`
every 10 items. Same 10 as Web A.

Caption limit is the server app-config pair `captionLengthLimitDefault` / `captionLengthLimitPremium`
(`ChatAttachAlert.java:3441,3623,4259`), with a premium-upsell bulletin fired when a free user
crosses the default and a shake + haptic on the send button when over
(`createCaptionLimitBulletin`, `:4317`; shake at `:3620-3628`).

---

## §3 — Signal Desktop `dd424a9` **[V]** — the reference implementation of grammar ②

### 3.1 The staged rail lives INSIDE the composition area, above the input row

`ts/components/CompositionArea.dom.tsx:1252-1266` **[V]** — the rail is rendered in the column that
sits *above* `CompositionArea__row` (the row that holds the input + buttons):
```tsx
        {draftAttachments.length ? (
          <div className="CompositionArea__attachment-list">
            <AttachmentList
              attachments={draftAttachments}
              canEditImages
              onAddAttachment={launchFilePicker}
              onClickAttachment={maybeEditAttachment}
              onClose={() => onClearAttachments(conversationId)}
              onCloseAttachment={attachment => { removeAttachment(conversationId, attachment); }}
            />
```

`ts/components/conversation/AttachmentList.dom.tsx` **[V]**:
- `const IMAGE_WIDTH = 120; const IMAGE_HEIGHT = 120;` (`:32-33`).
- A **close-all header** appears only when there is more than one: `{onClose && attachments.length > 1 ? …}` (`:87`).
- The rail itself is a **horizontal scroller**, not a wrap: `_modules.scss:2833-2842` **[V]**
  ```scss
  .module-attachments__rail {
    margin-top: 12px;
    margin-inline-start: 12px;
    padding-inline-end: 12px;
    overflow-x: scroll;
    max-height: 142px;
    white-space: nowrap;
    overflow-y: hidden;
    margin-bottom: 6px;
  }
  ```
  (`.module-staged-attachment { margin-inline-end: 8px }` — an 8px gutter.)
- **An "add another" tile is appended to the rail** when everything staged is visual:
  `{allVisualAttachments && onAddAttachment ? <StagedPlaceholderAttachment … /> : null}` (`:171-173`).
- Images get a hover **edit** badge (36px circle, `edit-compact.svg`, `_modules.scss:2764-2801`);
  non-visual files fall back to `StagedGenericAttachment`.

### 3.2 The staging rules — 32 max, and NO mixing

`ts/state/ducks/composer.preload.ts:1325-1358` **[V]**
```ts
  if (isFileDangerous(file.name)) { return { toastType: ToastType.DangerousFileType }; }

  if (draftAttachments.length >= 32) { return { toastType: ToastType.MaxAttachments }; }

  const haveNonImageOrVideo = draftAttachments.some((attachment) =>
    !isImageAttachment(attachment) && !isVideoAttachment(attachment));
  // You can't add another attachment if you already have a non-image staged
  if (haveNonImageOrVideo) { return { toastType: ToastType.UnsupportedMultiAttachment }; }
  …
  // You can't add a non-image attachment if you already have attachments staged
  if (!imageOrVideo && draftAttachments.length > 0) {
    return { toastType: ToastType.CannotMixMultiAndNonMultiAttachments };
  }
```
Three named toasts for three distinct refusals — a good model for our own error grammar.

### 3.3 One caption, and it IS the composer draft

Signal has no separate caption field. Its `MediaEditor` is *seeded* from the composer draft and
*writes back* into it (`CompositionArea.dom.tsx:1136-1203`) **[V]**:
```tsx
          <MediaEditor
            draftBodyRanges={draftBodyRanges}
            draftText={draftText}
            …
            onDone={({ caption, captionBodyRanges, data, contentType, blurHash, … }) => {
              …
              inputApiRef.current?.setContents(
                caption ?? '',
                convertDraftBodyRangesIntoHydrated(captionBodyRanges),
                true
              );
```
So the caption and the message body are literally the same string, surfaced in two places. Cap:
`Buffer.byteLength(text) > MAX_BODY_ATTACHMENT_BYTE_LENGTH` → undo the keystroke + `onTextTooLong()`
(`CompositionInput.dom.tsx:670-673`), where `MAX_BODY_ATTACHMENT_BYTE_LENGTH = 64 * KIBIBYTE` and
`MAX_MESSAGE_BODY_BYTE_LENGTH = 2 * KIBIBYTE` is the point past which the body is split off into a
long-message attachment (`ts/util/longAttachment.std.ts:7-8`) **[V]**.

### 3.4 Mic ⇄ send morph, and mic ⇄ staged media

`CompositionArea.dom.tsx:626-634` **[V]**
```ts
  const shouldShowMicrophone =
    !large &&
    draftEditMessage == null &&
    !hasDraft({
      draft: draftText,
      draftAttachments,
      // ignore quotes, can be sent with voice message
      quotedMessageId: null,
    });
```
The mic is present **only on a completely empty composer** — typing *or* staging removes it. The
row then reads `{!dirty ? micButtonFragment : null}` / `{dirty || !shouldShowMicrophone ?
sendButtonFragment : null}` (`:1329,1346`). Belt and braces: clicking the mic with attachments
staged raises a toast rather than recording (`AudioCapture.dom.tsx:40-46`) **[V]**:
```ts
  const handleClick = useCallback(() => {
    if (draftAttachments.length) {
      showToast({ toastType: ToastType.VoiceNoteMustBeTheOnlyAttachment });
    } else {
      startRecording(conversationId);
    }
```
And a finished voice note **takes over the entire composition area** — `CompositionArea` early-returns
a dedicated draft view when the sole draft attachment is a voice message
(`CompositionArea.dom.tsx:1120-1130`) **[V]**. Signal has no way to caption a voice note.

### 3.5 Signal's expand affordance — manual, hover-revealed, top-centre

`CompositionArea.dom.tsx:1213-1227` **[V]** — a bare `<button>` in `CompositionArea__toggle-large`,
`aria-label={i18n('icu:CompositionArea--expand')}`, plus a **cmd/ctrl-shift-x** shortcut
(`:903-926`). Styling (`stylesheets/components/CompositionArea.scss:114-135`) **[V]**:
```scss
  &__toggle-large {
    $width: 48px;
    $height: 24px;
    width: $width;
    height: $height;
    position: absolute;
    inset-inline-start: calc(50% - $width / 2);
    // 6px coming from padding-top of .module-composition-input__input__scroller
    top: calc(0px - $height / 2 - 6px);
    border-radius: 12px 12px 0 0;
    pointer-events: none;
    opacity: 0;
    transition: opacity 200ms ease-out;
    #{$comp-area}:hover & { opacity: 1; pointer-events: all; }
```
A 48×24 chevron tab straddling the composer's **top edge, horizontally centred**, revealed only on
hover — **a desktop-only affordance by construction** (`:hover` gating; ⚠ on touch there is no
hover, so this exact pattern would be dead on the owner's phone).

Heights (`stylesheets/components/CompositionInput.scss:97-110`) **[V]**: normal
`max-height: calc(72px - 2 * $border-size)` (≈3 lines); large is a **fixed** `212px` (height =
min-height = max-height). Large mode also relocates the button cluster to a **second control row
below the input** (`:1335-1347`) and forces `shouldShowMicrophone = false` (`:627`).

---

## §4 — The rest of the field

### 4.1 open-webui `2a960a5` **[V]** — grammar ② in our own reference class

Because R61 already read this repo, only the composer-grammar deltas are recorded here.

**Staged row, above the textarea, wrapping** (`src/lib/components/chat/MessageInput.svelte:1894-1897`) **[V]**
```svelte
							{#if files.length > 0}
								<div
									class="mx-2 mt-2 pb-1 flex items-center flex-wrap gap-1.5"
									dir={$settings?.chatDirection ?? 'auto'}
								>
```
Image chips are **`size-10 rounded-xl object-cover`** = **40×40px** (`:1908-1911`) with a ×-button
at `absolute -top-1 -right-1` (`:1937-1939`) and — a nice touch worth stealing — a **per-chip
warning triangle when any selected model lacks vision** (`selectedModelIds.length !==
visionCapableModels.length`, `:1912-1917`).

**The textarea below it auto-grows to `max-h-96`** (384px) and its top padding is conditioned on
whether the chip row is present (`:2004-2010`) **[V]** — the field literally re-seats itself when
thumbnails appear above it. **This is the closest shipped thing to the owner's description.**

**Count cap is a server config, not a constant** (`:1069-1078`) **[V]** —
`$config?.file?.max_count` with the toast *"You can only chat with a maximum of {{maxCount}}
file(s) at a time."*; **`null` by default ⇒ uncapped** (cf. R61 §1.2, "all limits OFF by default").

**Mic stays live with files staged** (`:2576-2578`) **[V]**
```svelte
										{#if !history?.currentId || history.messages[history.currentId]?.done == true}
											{#if $_user?.role === 'admin' || ($_user?.permissions?.chat?.stt ?? true)}
												<!-- {$i18n.t('Record voice')} -->
												<Tooltip content={$i18n.t('Dictate')}>
```
No `files.length` term. By contrast the **Voice-mode / call** button *is* gated on an empty
composer (`… && prompt === '' && files.length === 0 …`, `:2618`), and so is the stop button
(`:2550`). The distinction is exactly right and worth copying: **dictation is an input method
(always available); a hands-free call is a mode (only from rest).**

**Expand button** (`:1989-1999`) **[V]**
```svelte
							<div class="px-2 relative">
								{#if prompt.split('\n').length > 2}
									<button
										type="button"
										class="absolute top-2.5 right-3 z-20 p-1 rounded-lg hover:bg-gray-100/50 dark:hover:bg-gray-800/50"
										aria-label="Expand input"
										on:click={() => { showInputModal = true; }}
									>
										<Expand />
									</button>
								{/if}
```
`InputModal` is a **full-screen, text-only** editor bound to the same `prompt`
(`common/InputModal.svelte:26-56`: `flex h-full min-h-screen flex-col` + a sticky header with a
close ×). It carries **no attachments and no send button** — you edit and come back. Note the
trigger counts **explicit newlines**, so a long wrapped paragraph never triggers it — a weaker
heuristic than Telegram's rendered-line measure.

### 4.2 WhatsApp **[R]** — grammar ①, and the one app with true per-photo captions

Vendor help, via search summaries fetched 2026-09-01 (the FAQ pages themselves returned truncated
content to the fetcher, so this is **[R]**, not **[V-doc]**):
- Selecting media opens a **full-screen preview screen**; the caption field sits at the bottom and
  you **swipe between photos to caption each one individually**.
- **Up to 100 photos/videos at once** on WhatsApp Web (30 on some platforms; raised from 30 to 100
  for Android).
- Caption length **1,024 characters** — the same figure as Telegram's free `captionLength`.
- You can drag and drop a photo or video directly onto the text field to enter that screen.
- ⚠ *Not established*: whether the composer's already-typed text is carried into the preview
  screen's caption the way Telegram's is. **[U]**

### 4.3 Slack **[V-doc]** — grammar ②, with reorder and per-file descriptions

From *Add files to Slack* (slack.com help, fetched 2026-09-01):
- *"Drag and drop up to **10 files** into the Slack message field"* — **10**, same as Discord and
  the same as goose's `MAX_IMAGES_PER_MESSAGE` (R61 §6.5).
- Previews render **as part of the message being composed**, in the field.
- *"drag and drop the file previews to **reorder** them"* — Slack is the only grammar-② app read
  that ships reorder in the composer.
- An image can carry a **description** (alt text) — i.e. a *per-file* string that is not the
  message body.

### 4.4 Discord **[R]** — grammar ②

Support docs (fetched 2026-09-01): **up to 10 files per message**, all of which must fit inside the
account's cumulative size cap (free tier 20 MB as of Aug 2026; Nitro Basic 50 MB; Nitro 500 MB).
The staged files appear as a thumbnail strip above the text field with per-tile remove and an
"add" tile. ⚠ The strip's exact geometry was **not** verified — Discord is closed-source. **[U]**

### 4.5 The LLM-app class — already bought, cited not re-derived

R61 §1.9 / §2.10 / §3.5 / §5.6 / §6.5 establish that open-webui, LibreChat, AnythingLLM, Codex CLI
and goose all use **in-composer chips with per-file status**, upload-before-send, and no caption
screen. **5/5 of the in-class peers ship grammar ②.** Nobody in our reference class ships a modal
caption screen. That is the single most decision-relevant sentence in this dossier.

---

## §5 — The expand-to-fullscreen composer, consolidated

| App | Ships one? | Trigger | Button placement | What expanded adds | Available with media staged? |
|---|---|---|---|---|---|
| **Telegram Web A** | ✅ | **≥3 rendered lines** (`totalLines >= 3`, ResizeObserver-backed) — *plus* auto-open on rich-only content, *plus* a permanent "Article" item in the attach menu | 28×28 icon, `position:absolute; top:0.4375rem; right:0.625rem` — **inside the field, top-right** | full-viewport input · undo/redo pair slides in · rich toolbar · reply-strip + link-preview + action buttons hidden · **mic disabled** | ❌ explicitly (`hasAttachments` ⇒ hidden) |
| **Telegram Android** | ✅ (the AI-editor button, same shape) | `getLineCount() > 2` | inside the caption view | opens the AI message editor | n/a (lives in the sheet) |
| **open-webui** | ✅ | `prompt.split('\n').length > 2` — **explicit newlines only** | `absolute top-2.5 right-3` — **inside the field, top-right** | full-screen **text-only** modal on the same draft; no attachments, no send | ✅ (independent of `files.length`) |
| **Signal Desktop** | ✅ | **manual only** (+ cmd/ctrl-shift-x) | 48×24 chevron tab **centred on the composer's top edge**, `opacity:0` until `:hover` | input fixed at 212px (vs 72px) · buttons move to a second row below · **mic hidden** | ✅ |

**Three of four converge on: appears at ≥3 lines, sits at the field's top-right, is a
mode you can leave.** Signal's centred hover-tab is the outlier and is **structurally unusable on
touch**. Every implementation **hides or disables the mic in expanded mode** — expanded is a
"writing" mode, not a "composing a message" mode.

---

## §6 — The numbers

| Quantity | Telegram Web A | Telegram Android | Signal Desktop | open-webui | Others |
|---|---|---|---|---|---|
| Max items staged at once | **uncapped** (size-checked only) | **uncapped** (`-1`); 10 under slowmode; 1 for ephemeral | **32** (`ToastType.MaxAttachments`) | `$config.file.max_count`, **null ⇒ uncapped** | Slack **10** **[V-doc]** · Discord **10** **[R]** · WhatsApp **100** (30 some platforms) **[R]** |
| Album / group max | **10** (`MAX_MEDIA_FILES_FOR_ALBUM`) | **10** (`mediaCount % 10 == 0`) | n/a (one message, many attachments) | n/a | — |
| Mixing files with images | allowed; split into per-type runs at send | same | **forbidden** (2 named toasts) | allowed | — |
| Caption cap | **1024** free / **4096** premium (message: 4096/8192) | server `captionLengthLimit{Default,Premium}` | body ≤ **64 KiB** hard; > **2 KiB** ⇒ long-message attachment | model context | WhatsApp **1,024** **[R]** |
| Captions per send | **1** (`hasSentCaption`) | 1 shared, **per-item possible** (`captionForAllMedia() ⇔ count ≤ 1`) | **1** — it *is* the draft text | 1 (the prompt) | WhatsApp **per photo** **[R]** · Slack 1 body + per-file *description* **[V-doc]** |
| Thumbnail size in the staging surface | tiles **2-up**, `flex: 1 calc(50% - 0.5rem)`, **height 12rem** (single: full-width, `max-height 24rem`) | album mosaic (GroupCalculator) | **120 × 120** | **40 × 40** (`size-10`) | — |
| Staging container | `gap 0.125rem`, `min-height 5rem`, `max-height 26rem` → **80vh under 600px** | sheet, caption pinned bottom (84dp right inset) | `max-height 142px`, **`overflow-x: scroll`**, `margin-inline-end 8px` per tile | `flex-wrap gap-1.5` (6px) — **wraps, no scroll** | — |
| Text field max-height (unexpanded) | auto-grow, then scroll | `WRAP_CONTENT` | **72px** (≈3 lines) | **max-h-96** = 384px | — |
| Text field height (expanded) | `100vh − header − footer` | — | **212px fixed** | full screen | — |
| Overflow UI when many staged | none — the grid scrolls | grid scrolls; "Media Preview" sub-screen | rail scrolls horizontally; single close-all × in a 24px header when >1 | row wraps | — |

---

## §7 — Cross-cutting: which grammar maps cleanest onto a ONE-turn OpenAI-style send?

*Short and advisory — this is our reading, and it ages faster than the evidence above.*

The wire target is one user turn: `{role:"user", content:[{type:"text",…}, {type:"image_url",…} ×N]}`
(R61 §8.1). Judged against that:

1. **Grammar ② is the only one that is structurally isomorphic to the wire.** One draft string +
   an ordered array of parts = one turn. Nothing to reconcile. Grammar ① exists because Telegram's
   *transport* cannot do it: an album is N separate MTProto messages sharing a `groupedId`, which
   is exactly why Web A needs `hasSentCaption` bookkeeping and why 25 photos silently become three
   albums. **We have no such constraint, so we would be importing grammar ①'s complexity to solve
   a problem we do not have.** This is the least-future-debt reading.

2. **Signal's "the caption IS the draft" identity is the right invariant for us** — one string,
   one source of truth, surfaced wherever it needs to be. Adopting Telegram's *two* text budgets
   (1024 with an image, 4096 without) would be a pure loss here.

3. **Order is the one thing grammar ② must get right**, because the wire array is ordered and the
   model reads it in order. Slack is the only grammar-② app that ships composer reorder; Telegram
   ships it only in Android's preview sub-screen. R58 (touch drag-reorder) is already bought if we
   want it — but note it is a *second slice*, not day-one.

4. **The mic answer follows from the grammar, not from a separate decision.** Grammar ① takes the
   mic away because the modal takes the composer away; grammar ② leaves it reachable, and
   open-webui proves the field is comfortable leaving Dictate ungated while files are staged. The
   owner's "or even recording" is therefore free under ② and impossible under ①.

5. **Two guards worth copying verbatim from the field**, both cheap: Signal's *named refusals*
   (three distinct toasts for max-count / non-image-already-staged / cannot-mix, rather than one
   generic error), and open-webui's *per-chip vision warning* when the selected model can't see —
   which in ctrl-b maps onto the R61 §0.1 image-vs-text split and our own capability detection.

6. **The expand affordance is genuinely a separate slice** and the evidence supports the owner's
   instinct to defer it: 3/4 implementations trigger it at ≥3 lines from a top-right in-field
   button, all of them **suppress the mic inside it**, and Telegram additionally suppresses it
   whenever media is staged. That is a self-contained mode with its own interaction rules — it
   composes *after* attachments exist, not with them.

---

## §8 — What I could not determine

- **Signal iOS/Android composer.** Only Signal *Desktop* is open source in the form read. Whether
  Signal's phone clients keep the 120px staged rail, the 32 cap, or the mic rule is **[U]**.
- **WhatsApp anything, first-hand.** WhatsApp is closed-source and the FAQ pages returned truncated
  bodies to the fetcher; every WhatsApp figure here is **[R]** from search summaries of vendor
  help. In particular: whether typed composer text carries into the media-preview screen, the
  actual thumbnail geometry, and whether the 100-item figure is current for Web.
- **Discord's composer geometry** — thumbnail size, whether the strip wraps or scrolls, overflow
  behaviour past 10. Closed-source; **[U]**.
- **ChatGPT / Claude apps.** I could not source a citable, current description of either
  composer's staged-attachment geometry; search returned prompt-engineering listicles. Both are
  believed to be grammar ② with in-composer chips, but that belief is **[U]** here — R61 §8.3
  covers Claude Code's behaviour, which is a CLI and not comparable.
- **Telegram Web A on a real phone.** All Web A findings are source-read, not device-observed. In
  particular the `.mobile` sheet behaviour (`translate3d(0, 8rem, 0)`, `max-height: 80vh`) was read
  from SCSS, not seen; how it actually feels at 360px is unverified.
- **Whether Telegram's `AttachmentMenuArticle` label reads as "expand" to a user.** The string id
  suggests it is framed as *writing an article*, not *expanding the box* — a naming choice we may
  or may not want to copy. Not resolvable from source.
- **Per-file progress/retry in the staging surface.** Telegram builds attachments client-side and
  uploads on send, so there is nothing to show; Signal likewise. R61 §2.10 already established that
  the LLM apps upload-before-send with per-file status and **no retry affordance**. Whether any
  messenger shows staged-item upload progress is **[U]** — none of the ones read do.
