# R61 — How peer chat/agent apps implement COMPOSER ATTACHMENTS end-to-end

**Date:** 2026-09-01 · **Bounded pass, one agent, no subagents.** · **Draft — main seat curates the index row.**

**The question (main seat, 2026-09-01).** ctrl-b wants to let the owner send a file — usually a
phone photo, sometimes a text/log/PDF — along with a chat message. *How does the field actually do
this end-to-end: transport, storage, retention, message schema, wire shape to the model, history
cost, capability detection, and composer UX?*

**Relationship to the already-bought passes.** This dossier deliberately does **not** re-cover
[R54](./R54-crop-upload-client.md) (client image pipeline: EXIF/`createImageBitmap`, `toBlob`
silent-PNG, HEIC refusal, `react-easy-crop`, jpeg q0.85), [R55](./R55-media-upload-backend.md)
(multipart-is-CORS-safelisted ⇒ raw-body PUT; `UploadFile` tmp buffering; streamed caps; atomic
write ladder), or [R56](./R56-gallery-management-ux.md) (gallery management UX). Where a finding
here **corrects or confirms** one of those, it is flagged **↔R54/R55**. Two such corrections are in
§0.

---

## Confidence legend

- **[V]** — I read the source file at the stated SHA and quoted it.
- **[V-doc]** — quoted from an official vendor doc I fetched on 2026-09-01.
- **[R]** — reported by a secondary source (issue title, search summary, community post).
- **[U]** — expected but unverified; called out as such.

## Sources read (SHAs, cloned + read 2026-09-01)

| Peer | Repo | SHA |
|---|---|---|
| open-webui | `open-webui/open-webui` | `2a960a59fe1dbbd35282f0556b3666d81102e781` |
| LibreChat | `danny-avila/LibreChat` | `cdfe54c3498818b21b33fb609fee02f2742b37ea` |
| AnythingLLM | `Mintplex-Labs/anything-llm` | `20f6d3546c1938bfea1ad304f58a592dddcc5948` |
| opencode | `anomalyco/opencode` | `ebece6efd7b11401cf1e7390b5a22991b6608cc4` |
| Codex CLI | `openai/codex` | `67cc3c318dc8b5532db6ade4182b1dc6f3870889` |
| goose | `aaif-goose/goose` | `67827a1754035a98c80bde84656b4691207b30f7` |
| Continue.dev | `continuedev/continue` | `5522c6f44ca0ac3528b37244818fbfa39b5af470` |
| Claude Code · claude.ai · OpenAI Responses | docs / issues only | fetched 2026-09-01 |

*(Clones were made under `/home/emma/.cache/tmp/r61` and deleted after the pass. Line numbers are
against the SHAs above and will drift.)*

---

## §0 — TL;DR: the verdict facts

1. **The field splits attachments into exactly two classes at the composer, and the split is the
   single most consistent design in the whole survey: IMAGES go inline to the model as multimodal
   parts; NON-IMAGES get text-extracted and go in as text.** No peer feeds a PDF/docx to a vision
   model as an image. AnythingLLM's code comment is the field's sentence verbatim: *"Embeds
   attachments that are eligible for embedding - basically files that are not images."* **[V]**

2. **NOBODY re-encodes on the phone by default.** LibreChat's client resize ships
   `enabled: false`; open-webui's compression ships with both `width` and `height` `None`; goose,
   AnythingLLM, Continue's paste path and every CLI send the original bytes. Where downscale
   happens it is either **opt-in** (LibreChat/open-webui user setting) or **server-side**
   (LibreChat sharp, Codex Rust `image` crate). **↔R54: our decision to always re-encode
   client-side is a deviation from the field, and it is the *right* one for a phone-first app —
   but the field's reason for not doing it is worth knowing (see §9.2 on animated PNG/WebP).** **[V ×5]**

3. **The downscale NUMBERS cluster hard, and they all trace to the two vendor APIs:**

   | Peer | Where | Max dimension | Quality |
   |---|---|---|---|
   | LibreChat (server, sharp) | `resize.js` | `low`=512×512; `high`= short 768 / long **2000** (Anthropic: **1568**) | format-preserving |
   | LibreChat (client, opt-in) | `imageResize.ts` | **1900×1900** ("Slightly less than backend maxLongSide=2000") | **0.92** |
   | Codex CLI | `utils/image/src/lib.rs` | **2048** (`MAX_DIMENSION`), patch budget 2500 | JPEG **85** |
   | Codex CLI (unified budget) | `image_preparation.rs` | **6000**, 10 000 patches | JPEG 85 |
   | Continue.dev | `imageUtils.ts` | **1024** box | JPEG **0.7** |
   | open-webui | admin/user config | `None` / `None` by default | source mime preserved |
   | goose, AnythingLLM | — | none | none |

   **Codex's JPEG quality is 85 — the exact number R54 landed on.** **[V]**

4. **Two peers DO magic-byte-validate uploads — R55's "NOBODY magic-byte-validates" is FALSE for
   the CLI class.** opencode ships `sniffAttachmentMime()` (PNG/JPEG/GIF/BMP/PDF/WebP signatures)
   and prefers the sniffed type over the extension; goose ships `has_image_magic()` and **rejects**
   a file whose first four bytes are not PNG/JPEG/GIF with *"File is not a valid image"*. **The
   correction: server-side web apps don't sniff, local agents do.** **[V ×2] ↔R55**

5. **Nobody garbage-collects chat attachments.** Neither open-webui nor LibreChat deletes an
   attachment when its conversation is deleted (verified by reading both delete paths). LibreChat
   sweeps only files whose conversation was **temporary** (`expiredAt`, application sweep every
   3 600 000 ms); open-webui has no sweep at all — files are deleted only by an explicit
   `DELETE /files/{id}` or an admin "delete all". **[V ×2]**

6. **The re-send question has exactly one first-class answer in the field, and it is LibreChat's:
   a per-conversation `resendFiles` toggle, defaulting to `true`.** Everyone else re-sends
   unconditionally (open-webui re-injects `image_url` parts for *every* historical user message;
   AnythingLLM's `formatChatHistory` re-expands every stored attachment on every turn). **[V ×3]**

7. **The best answer to "the model can't see images" is opencode's, and it is not a refusal — it is
   an in-band instruction to the model:**
   `ERROR: Cannot read "foo.png" (this model does not support image input). Inform the user.` **[V]**
   The field's four other answers are: refuse at the composer (open-webui, Continue), drop
   silently (Continue's history path, goose), or send anyway and let the provider 400
   (AnythingLLM).

8. **Codex ships the single most decision-relevant trick nobody else has: when it downscales, it
   TELLS the model, in a separate `developer` message.** `<image_resize_notice>Image 1 of 2 in the
   preceding user message was resized from 4000x3000 to 2048x1536 pixels.</image_resize_notice>`
   **[V]** — cheap, and it stops the model reasoning about detail that was thrown away.

9. **Capability detection has three shapes and the defaults are opposite.** Hardcoded substring
   list (LibreChat, Continue) · model-catalog modalities (opencode, goose) · admin per-model flag
   (open-webui). **open-webui defaults UNKNOWN → capable** (`capabilitiesById[id]?.[capability] ??
   true`); **opencode/goose/Continue default UNKNOWN → not capable.** **[V ×4]**

10. **PWA share-target for files is not shipped by anyone in this class.** open-webui's manifest
    ships `{'action': '/', 'method': 'GET', 'params': {'text': 'shared'}}` — **text only, no
    `files`** — so sharing a photo from the Android gallery does not work; a files PR (#17633) is
    open. **[V + R]** LibreChat ships no web manifest at all in-repo. **This is a greenfield seam
    for ctrl-b, not a copy target.**

---

## §1 — open-webui `2a960a5`

### 1.1 Transport + storage

Two entirely different paths depending on whether it is an image and whether the chat is temporary:

`src/lib/components/chat/MessageInput.svelte:1146-1170` **[V]**
```js
reader.onload = async (event) => {
    let imageUrl = event.target.result;
    imageUrl = await compressImageHandler(imageUrl, $settings, $config);
    if ($temporaryChatEnabled) {
        files = [...files, { type: 'image', url: imageUrl }];      // stays a data: URL
    } else {
        const blob = await (await fetch(imageUrl)).blob();
        const compressedFile = new File([blob], file.name, { type: file.type });
        uploadFileHandler(compressedFile, false);                   // POST /api/v1/files/
    }
};
reader.readAsDataURL(file['type'] === 'image/heic' ? await convertHeicToJpeg(file) : file);
```

- **Temporary chat ⇒ the image never touches the server as a file; it lives as a data URL in the
  message.** Persistent chat ⇒ multipart `POST /api/v1/files/` immediately on selection
  (upload-before-send), with `process=false` for images.
- **HEIC is converted client-side** via a dynamically imported `heic2any`
  (`src/lib/utils/index.ts:2064`) **[V]** — note this contrasts with ctrl-b's R54 HEIC refusal.
- Non-images go the same multipart route with `process=true`, which triggers text extraction +
  vector embedding (`routers/files.py:128-197`) **[V]**.
- Storage: `Storage.upload_file(file.file, f"{uuid}_{filename}", tags)` → `UPLOAD_DIR` (local) or
  S3/GCS/Azure. DB row in `file` table with `meta.content_type`, `meta.size`, `meta.file_hash`
  (sha256) — `models/files.py:18-31` **[V]**.

### 1.2 Limits — all OFF by default

`backend/open_webui/config.py:975-988` **[V]**
```python
RAG_FILE_MAX_COUNT = int(os.getenv('RAG_FILE_MAX_COUNT')) if os.getenv('RAG_FILE_MAX_COUNT') else None
RAG_FILE_MAX_SIZE  = int(os.getenv('RAG_FILE_MAX_SIZE'))  if os.getenv('RAG_FILE_MAX_SIZE')  else None
FILE_IMAGE_COMPRESSION_WIDTH  = int(os.getenv('FILE_IMAGE_COMPRESSION_WIDTH'))  if ... else None
FILE_IMAGE_COMPRESSION_HEIGHT = int(os.getenv('FILE_IMAGE_COMPRESSION_HEIGHT')) if ... else None
```
**Default: no count cap, no size cap, no compression.** Enforced twice when set — client
(`MessageInput.svelte:1069-1101`) and server (`routers/files.py:377-384`, after the bytes have
already been written, then `Storage.delete_file`). **[V]**

### 1.3 Message schema

A message carries `files: [{type, url, name, content_type, ...}]`. Images are `type: 'image'` with
either a `data:` URL (temporary chat) or `/api/v1/files/{id}/content`. Non-images are file refs
whose extracted text lives in the vector store, not on the message.

### 1.4 Feeding the model

`utils/middleware.py:2431-2453` — image files are lifted out of `message.files` into `content` parts
**for every user message in the replayed history**, then `files` is stripped: **[V]**
```python
for message in form_data['messages']:
    image_files = [f for f in message.get('files', [])
                   if f.get('type') == 'image' or (f.get('content_type') or '').startswith('image/')]
    if message.get('role') == 'user' and image_files:
        message['content'] = [{'type': 'text', 'text': text_content},
                              *[{'type': 'image_url', 'image_url': {'url': f['url']}} for f in image_files if f.get('url')]]
    message.pop('files', None)
```
Then `convert_url_images_to_base64()` (`middleware.py:2110-2155`, called at `:2512`) turns any
non-`data:` image URL into a base64 data URL before the outbound request, since an internal
`/api/v1/files/...` URL is unreachable by the provider. **[V]** For Ollama the parts are re-shaped
into the `images: [b64…]` array (`utils/payload.py:335-345`, base64 header stripped). **[V]**

**Non-image files reach the model through RAG, not as text parts.**
`chat_completion_files_handler` (`middleware.py:1989-2070`) generates retrieval queries with a
sub-LLM call, retrieves chunks and injects them as `<source>` context — **unless** every file is
marked `context: 'full'`, in which case the whole extracted text goes in.
`RAG_FULL_CONTEXT` defaults to `False` (`config.py:973`). **[V]**

For native function-calling models there is a *second* path: `add_file_context()`
(`middleware.py:1710-1762`) prefixes the user turn with a manifest the model can act on: **[V]**
```
<attached_files>
<file type="file" id="…" url="…" content_type="application/pdf" name="report.pdf"/>
</attached_files>
```

### 1.5 No-vision handling — refuse at the composer

`MessageInput.svelte:1105-1109` **[V]**
```js
if (file['type'].startsWith('image/')) {
    if (visionCapableModels.length === 0) {
        toast.error($i18n.t('Selected model(s) do not support image inputs'));
        return;
    }
```
The Upload-Files menu item is disabled unless **every** selected model is capable:
`fileUploadEnabled = fileUploadCapableModels.length === selectedModels.length && …`
(`InputMenu.svelte:67-70`). **[V]**

### 1.6 Capability detection — admin flag, permissive default

`MessageInput.svelte:735-748` **[V]**
```js
modelCapabilitiesById = Object.fromEntries(($models ?? []).map((m) => [m.id, m.info?.meta?.capabilities ?? {}]));
const getCapableModelIds = (modelIds, capability, capabilitiesById) =>
    modelIds.filter((id) => capabilitiesById[id]?.[capability] ?? true);
```
**`?? true` — an unconfigured model is assumed to do everything.** Capabilities are `vision`,
`file_upload`, `web_search`, `image_generation`, `code_interpreter`, `terminal`, set by an admin
per model in the Workspace UI. No probing.

### 1.7 History cost + compaction

Images from every prior user turn are re-injected on every request (§1.4) — **no toggle**.
The compactor estimates them at a flat cost:
`utils/context_compaction.py:430-434`: `elif item.get('type') in {'image', 'image_url'}: total += 1000` **[V]**

### 1.8 Retention

**None.** `Files.delete_file_by_id` is called only from `DELETE /api/v1/files/{id}` and the
knowledge-file remove path; `delete_all_files` only from the admin endpoint. Deleting a chat deletes
tags, not files (`routers/chats.py:1593-1595`). **[V]** Files outlive their conversations forever.

### 1.9 Composer UX

- Attach menu (`InputMenu.svelte`) with *Upload Files*, a camera `<input accept="image/*">`, and a
  **Screen Capture** action (`screenCaptureHandler`, `MessageInput.svelte:841`). **[V]**
- Paste: handled both on the plain textarea (`MessageInput.svelte:2138-2160`) and inside the
  ProseMirror rich input (`RichTextInput.svelte:1220-1240`), with a fallback for images that appear
  in `clipboardData.items` but not `clipboardData.files`. **[V]**
- Drag-drop with a custom `application/x-open-webui-drag` MIME to distinguish real file drags from
  SortableJS reorder drags. **[V]**
- Upload-before-send with per-file status chips (`status: 'uploaded' | 'error'`).
- **PWA share_target is GET + text only** (`backend/open_webui/main.py:2878-2882`) **[V]**; a
  files-capable share target is an open PR (#17633) **[R]**.

### 1.10 One Android gotcha worth stealing ↔R54

`src/lib/utils/index.ts:361-397` **[V]**
```js
/**
 * Draws an image to a canvas at the given dimensions and returns a data URL.
 * On mobile, the first export uses toBlob (avoids black image on Android); later exports use toDataURL.
 */
```
The **first** canvas export on an Android/iOS UA goes through `canvas.toBlob` + `FileReader`, every
later one uses `toDataURL`. This is a warm-up workaround for a **black-image** bug on the first
canvas export on Android — a *different* failure mode from R54's silent-PNG one, and one ctrl-b's
pipeline would hit on exactly the owner's device class.

---

## §2 — LibreChat `cdfe54c`

The most complete implementation in the survey, and the only one with a real retention model.

### 2.1 Transport + storage

Multipart `POST /api/files/images` (images) or `/api/files` (other), one file per request, uploaded
**immediately on selection** with a client-generated `temp_file_id` swapped for the server
`file_id` (`routes/files/images.js:56-57`). **[V]**

Multer disk storage → `{uploads}/temp/{userId}/{sanitizedFilename}`, `limits: { fileSize:
fileConfig.serverFileSizeLimit }` (`routes/files/multer.js:14-97`). **[V]** MIME is normalized from
the filename (`inferMimeType`) then checked against the endpoint's `supportedMimeTypes` regex list —
**extension/declared-type based, not magic bytes.** ↔R55 (confirms R55 for the web class).

Strategies: `local | s3 | azure_blob | firebase | cloudfront | openai | vectordb | text | code`.

### 2.2 The NUMBERS

`packages/data-provider/src/file-config.ts:445-500` **[V]**
```ts
const defaultSizeLimit = mbToBytes(512);
const defaultTokenLimit = 100000;
export const fileConfig = {
  endpoints: { default: { fileLimit: 10, fileSizeLimit: defaultSizeLimit, totalSizeLimit: defaultSizeLimit, … } },
  serverFileSizeLimit: defaultSizeLimit,
  avatarSizeLimit: mbToBytes(2),
  fileTokenLimit: defaultTokenLimit,
  clientImageResize: { enabled: false, maxWidth: 1900, maxHeight: 1900, quality: 0.92, enforced: false },
  …
};
```
- **10 files per message**, **512 MB** per file and per request total, **avatar 2 MB**.
- **`fileTokenLimit: 100 000`** — the truncation cap for extracted document text.
- **`clientImageResize.enabled: false`** — off unless the user turns it on in Settings → Chat, or
  the admin sets it in `librechat.yaml` (in which case `enforced: true` and the user setting is
  ignored: `file-config.ts:1024-1029`). **[V]**

### 2.3 Server-side resize — the resolution ladder

`api/server/services/Files/images/resize.js:16-19` **[V]**
```js
const maxLowRes = 512;
const maxShortSideHighRes = 768;
const maxLongSideHighRes = endpoint === EModelEndpoint.anthropic ? 1568 : 2000;
```
`sharp(inputBuffer).rotate().resize({fit:'inside', withoutEnlargement:true})` — **`.rotate()` with
no argument applies the EXIF orientation**, which is sharp's auto-orient. ↔R54: this is the
server-side equivalent of the `drawImage`-after-orient fix.

### 2.4 Client resize — the guards worth copying

`client/src/utils/imageResize.ts` **[V]**
- Defaults documented against the backend: *"Backend 'high' uses maxShortSide=768, maxLongSide=2000
  / We use slightly smaller values to ensure no backend resizing is triggered"* → **1900/1900/0.92**.
- Decodes through `URL.createObjectURL`, not a data URL: *"Decoding through an object URL avoids the
  ~33% larger base64 copy a data URL would hold"*.
- **Animated-container detection** (`isAnimatedImage`): parses PNG chunks for `acTL` and WebP chunks
  for `ANIM`/`ANMF` over the first 64 KB — *"Checks image containers whose animation would be
  flattened by canvas."* Animated files are not resized.
- **↔R54, the `toBlob` silent-PNG guard, handled by bailing out:**
  ```js
  const outputFormat = RESIZE_FORMAT_BY_MIME_TYPE[blob.type];
  if (blob.type !== requestedMimeType || outputFormat == null) {
      resolve({ file, /* original */ …, compressionRatio: 1 });   // keep the original
      return;
  }
  ```
  It also bails if `blob.size >= file.size` — never ship a "compressed" file that got bigger.

### 2.5 Message + file schema

Message: `files: { type: [{ type: Mixed }], default: undefined }`
(`packages/data-schemas/src/schema/message.ts:134`) — an untyped array of file refs. **[V]**

File document (`schema/file.ts`) is the richest in the survey: `user, conversationId, messageId,
file_id, temp_file_id, bytes, filename, filepath, storageKey, embedded, type, text, textFormat
('html'|'text'), status ('pending'|'ready'|'failed'), previewError (maxlength 200), previewRevision,
context, usage, source, model, width, height, metadata, expiresAt (Mongo TTL 3600s), expiredAt,
tenantId`. **[V]**

Note **`width`/`height` are the vision discriminator downstream**: `encode.js` treats a file with no
`height` as a non-image and passes it through as metadata only.

### 2.6 Feeding the model — `encodeAndFormat`

`api/server/services/Files/images/encode.js` **[V]** produces `image_urls` per provider:
- OpenAI-compatible: `{type:'image_url', image_url:{url: 'data:<mime>;base64,…' | 'http…', detail}}`
- Anthropic: `{type:'image', source:{type:'base64', media_type, data}}`
- Google generative: `{inlineData:{mimeType, data}}`; Google non-generative: `image_url` as a bare string.
- `base64Only = {google, anthropic, ollama, bedrock}` — for those providers a non-local file is
  fetched and inlined rather than passed by URL. **[V]**
- `detail = params.imageDetail ?? req.body.imageDetail ?? ImageDetail.auto`.

**Non-image files** reach the model as a fenced text block, capped by `fileTokenLimit`:
`packages/api/src/files/context.ts:63-85` **[V]**
```
Attached document(s):
```md
# "report.pdf"
<extracted text, truncated to 100 000 tokens>
```
```
Truncation is **silent** — `processTextWithTokenLimit` only writes a `logger.debug` line; no marker
is inserted in the text the model sees (`packages/api/src/utils/text.ts:42-90`). **[V]**

And the one-liner every implementer eventually needs
(`packages/api/src/files/context.ts:9-16`): **[V]**
```ts
/** Anthropic and the Assistants API both reject empty user content, and files
 *  that reach the model out-of-band (RAG, code environment) leave nothing else
 *  in the turn, so the payload needs this minimal note. */
export const ATTACHMENT_ONLY_TEXT = 'Please refer to the attached file(s).';
```
…plus `getAttachmentTitleText()` which feeds `Attached file(s): a.png, b.pdf` to the
title-generation model when the user typed nothing.

### 2.7 History behavior — the field's only real toggle

`packages/data-provider/src/schemas.ts:423-425, 701-703, …` — **`resendFiles: { default: true }`**,
declared per endpoint (openAI, anthropic, google, bedrock, agents) and settable per conversation in
the UI. **[V]**

`api/app/clients/BaseClient.js:244-245, 1808-1812` **[V]**
```js
getModelBoundStoredMessages(messages) {
  return this.options.resendFiles === false ? omitUnreplayedHistoricalFiles(messages) : messages;
}
async addPreviousAttachments(_messages) {
  if (!this.options.resendFiles) { return _messages; }
  …
}
```
`omitUnreplayedHistoricalFiles` strips `files`/`attachments` off every message **and** strips
file-bearing parts out of array contents (`BaseClient.js:44-60`). **[V]** Historical files are also
re-authorized per user before replay (`getOwnerHistoricalFiles`) — a multi-user concern ctrl-b does
not have.

### 2.8 Retention — the only real one

Two independent mechanisms (`schema/file.ts:139-155`): **[V]**
```js
expiresAt: { type: Date, expires: 3600 },   // "Short-lived upload TTL managed by MongoDB"
expiredAt: { type: Date },                  // "Retention deadline … sweep deletes the backing storage first"
```
- `expiredAt` is set only when the conversation is **temporary**, or when
  `interfaceConfig.retentionMode === RetentionMode.ALL` (`packages/api/src/files/retention.ts:100-125`). **[V]**
- The sweep runs on `DEFAULT_FILE_RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000` and deletes storage
  before the metadata row (`packages/api/src/files/sweep.ts:9`). **[V]**
- `expiresAt` (the Mongo 1 h TTL) is **declared but never written by any current code path** — I
  grepped all of `api/` and `packages/`; it appears only in the schema and in field-strip lists.
  **[V — negative result; treat as vestigial]**
- **Deleting a conversation does NOT delete its files** — `routes/convos.js` never touches the file
  services. **[V]**

### 2.9 Capability detection — a hardcoded substring list

`packages/data-provider/src/config.ts:2711-2773` **[V]**
```ts
export const visionModels = ['qwen-vl','grok-vision','grok-2-vision','grok-3','gpt-4o-mini','gpt-4o',
  'gpt-4-turbo','gpt-4-vision','o4-mini','o3','o1','gpt-5','gpt-4.1','gpt-4.5','llava','llava-13b',
  'gemini-pro-vision','claude-3','gemma','gemini-exp','gemini-1.5','gemini-2','gemini-2.5','gemini-3',
  'moondream','llama3.2-vision','llama-3.2-11b-vision', … ,'claude-opus-4','claude-sonnet-4','claude-haiku-4'];

export function validateVisionModel({ model, additionalModels = [], availableModels }) {
  if (!model) return false;
  if (model.includes('gpt-4-turbo-preview') || model.includes('o1-mini')) return false;
  if (availableModels && !availableModels.includes(model)) return false;
  return visionModels.concat(additionalModels).some((visionModel) => model.includes(visionModel));
}
```
Substring match with two hand-maintained negative exceptions. Extendable per-endpoint via
`additionalModels`. **This is the approach that generates bug reports** — LibreChat #11321
*"[Bug]: Image Upload Option Shown for Non-Vision Models"* **[R]**.

### 2.10 Composer UX

Upload-before-send with an `AbortController` per upload, a delayed "still uploading" toast
(`useDelayedUploadToast`), duplicate detection (`com_error_files_skipped_dupe`), an oversize skip
message (`com_error_files_skipped_size`), and error batching — if more than one file failed the
toast lists all reasons at once (`useFileHandling.ts:169-256`). **[V]** **No retry affordance**: a
failed file is dropped from the queue and the user re-picks it. Cancel mid-upload maps to
`com_error_files_upload_canceled`. SharePoint picker is a separate ingestion source.

---

## §3 — AnythingLLM `20f6d35`

The **simplest shipped web implementation**, and therefore the closest analogue to a single-user app.

### 3.1 The split, in twelve lines

`frontend/src/components/WorkspaceChat/ChatContainer/DnDWrapper/index.jsx:185-205` **[V]**
```jsx
for (const file of acceptedFiles) {
  if (file.type.startsWith("image/")) {
    newAccepted.push({ uid: v4(), file, contentString: await toBase64(file),
                       status: "success", error: null, type: "attachment" });
  } else {
    newAccepted.push({ uid: v4(), file, contentString: null,
                       status: "in_progress", error: null, type: "upload" });
  }
}
setFiles((prev) => [...prev, ...newAccepted]);
embedEligibleAttachments(newAccepted);
```
- **`type: "attachment"` (images)** — base64 data URL held in the browser, **never uploaded to a
  file endpoint**, shipped inside the chat POST body as
  `{name, mime, contentString}` (`parseAttachments()`, `:118-140`). **[V]**
- **`type: "upload"` (everything else)** — multipart to the collector/embed endpoint, parsed and
  embedded into the workspace vector DB. Comment: *"Embeds attachments that are eligible for
  embedding - basically files that are not images."* **[V]**
- Removing a non-image chip calls `Workspace.deleteAndUnembedFile` — the embed is undone. **[V]**
- A workspace context budget is enforced client-side before embedding:
  `Math.floor(contextWindow * Workspace.maxContextWindowLimit)` with
  `maxContextWindowLimit: 0.8` (`frontend/src/models/workspace.js:11`). **[V]**

### 3.2 Wire shape + history

`server/utils/AiProviders/openAi/index.js:89-128` **[V]**
```js
#generateContent({ userPrompt, attachments = [] }) {
    if (!attachments.length) return userPrompt;
    const content = [{ type: "input_text", text: userPrompt }];
    for (let attachment of attachments) {
        content.push({ type: "input_image", image_url: attachment.contentString });
    }
    return content.flat();
}
constructPrompt({ systemPrompt, contextTexts, chatHistory, userPrompt, attachments = [] }) {
    return [ prompt, ...formatChatHistory(chatHistory, this.#generateContent),
             { role: "user", content: this.#generateContent({ userPrompt, attachments }) } ];
}
```
`formatChatHistory` (`server/utils/helpers/chat/responses.js:370-400`) re-expands **every** stored
attachment on **every** turn — no toggle, no pruning. **[V]**

### 3.3 Storage = the chat row

`server/utils/chats/stream.js:115-127, 248-260, 328-…` **[V]**
```js
await WorkspaceChats.new({ workspaceId: workspace.id, prompt: message,
  response: { text: textResponse, sources: [], type: chatMode, attachments }, … });
```
**The full base64 data URL is persisted inside the chat history row's JSON**, then read back by
`convertToPromptHistory` on every subsequent turn. A 3 MB phone photo becomes ~4 MB of base64 in
SQLite *and* ~4 MB on the wire for every later message in the thread. **This is the anti-pattern to
avoid.**

### 3.4 No capability detection at all

Grepping `server/` for `supportsVision`/`multiModal` finds only a telemetry flag:
`multiModal: Array.isArray(attachments) && attachments?.length !== 0`
(`server/endpoints/chat.js:76`). **[V]** The frontend has no vision gate either. If the model has no
vision, the provider returns the error and the user sees it raw.

### 3.5 UX

Full-surface drag-drop overlay (*"Drop a file or image here to attach it to your…"*), paste handler,
attach button, chips with per-file status (`in_progress` spinner / `WarningOctagon` on error) and an
image lightbox on click. **[V]**

---

## §4 — opencode `ebece6e`

### 4.1 Transport

There is no upload; a `FilePart` carries either a `data:` URL or a `file://` URL, resolved at prompt
time. CLI attach (`packages/opencode/src/cli/cmd/run.ts:59, 380-412`): **[V]**
```ts
const ATTACH_FILE_MAX_BYTES = 10 * 1024 * 1024
…
if (!opened.isFile() || Number(opened.size) > ATTACH_FILE_MAX_BYTES) {
  UI.error(`Cannot attach local file larger than 10 MiB or a special file: ${filePath}`)
  process.exit(1)
}
```
Mime is decided by a **UTF-8 round-trip test** — if the bytes re-encode identically from
`toString('utf8')` it is `text/plain`, otherwise the detected type. **[V]**

### 4.2 Magic-byte sniffing ↔R55

`packages/opencode/src/util/media.ts` **[V]**
```ts
export function sniffAttachmentMime(bytes: Uint8Array, fallback: string) {
  if (startsWith(bytes, [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) return "image/png"
  if (startsWith(bytes, [0xff,0xd8,0xff])) return "image/jpeg"
  if (startsWith(bytes, [0x47,0x49,0x46,0x38])) return "image/gif"
  if (startsWith(bytes, [0x42,0x4d]))          return "image/bmp"
  if (startsWith(bytes, [0x25,0x50,0x44,0x46,0x2d])) return "application/pdf"
  if (startsWith(bytes, [0x52,0x49,0x46,0x46]) && startsWith(bytes.subarray(8), [0x57,0x45,0x42,0x50])) return "image/webp"
  return fallback
}
export function isMedia(mime: string) { return mime.startsWith("image/") || isPdfAttachment(mime) }
export function isImageAttachment(mime: string) {
  return mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"
}
```
SVG is explicitly excluded from "image" — an XSS/XXE-shaped exclusion worth noting.
`SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg","image/png","image/gif","image/webp"])`
(`tool/read.ts:19`). **[V]**

### 4.3 Non-image files → a synthetic tool transcript

The single best idea in the survey for feeding a text file to a model.
`packages/opencode/src/session/prompt.ts:786-805` **[V]**
```ts
case "data:":
  if (part.mime === "text/plain") {
    return [
      { type: "text", synthetic: true,
        text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}` },
      { type: "text", synthetic: true, text: decodeDataUrl(part.url) },
      { ...part },
    ]
  }
```
The attachment is rendered to the model as *"I called Read on this file, here is the output"* — the
shape the model already knows how to reason about, and it costs no new prompt vocabulary. The
`file://` branch does the same but actually invokes the real `read` tool (honouring
`offset`/`limit`, LSP symbol ranges from `?start=&end=` query params, and the tool's own
truncation). **[V]**

### 4.4 No-vision handling — an in-band instruction, not a refusal

`packages/opencode/src/provider/transform.ts:409-444` **[V]**
```ts
const modality = mimeToModality(mime)     // image | audio | video | pdf
if (!modality) return part
if (model.capabilities.input[modality]) return part

const name = filename ? `"${filename}"` : modality
return { type: "text" as const,
         text: `ERROR: Cannot read ${name} (this model does not support ${modality} input). Inform the user.` }
```
And an empty-data guard just above it:
`"ERROR: Image file is empty or corrupted. Please provide a valid image."` **[V]**

### 4.5 Capability detection — catalog modalities, conservative default

`packages/opencode/src/provider/provider.ts:1516-1536` **[V]**
```ts
input: {
  text:  model.modalities?.input?.includes("text")  ?? existingModel?.capabilities.input.text  ?? true,
  audio: model.modalities?.input?.includes("audio") ?? … ?? false,
  image: model.modalities?.input?.includes("image") ?? … ?? false,
  video: … ?? false,
  pdf:   … ?? false,
},
```
Sourced from the models.dev catalog, overridable per-model in config. **Unknown ⇒ not capable.**

There is a second, orthogonal capability table for *media in tool results*
(`message-v2.ts:147-159`): Anthropic/OpenAI take anything, Bedrock images-only, xAI images-only,
Google only `gemini-3`; otherwise the media is hoisted out of the tool result and injected as a
separate user message, because *"OpenAI-compatible APIs only support string content in tool
results"*. **[V]**

### 4.6 History pruning — swap the image for a text stub

Two places do the same substitution.
`message-v2.ts:212-224` (when `stripMedia` is on) and `compaction.ts:481-484` (on auto-continue
replay): **[V]**
```ts
part.type === "file" && MessageV2.isMedia(part.mime)
  ? { type: "text" as const, text: `[Attached ${part.mime}: ${part.filename ?? "file"}]` }
  : part
```
`stripMedia` is plumbed through `toModelMessages` but **no current call site sets it** — it is a
ready seam, not a live default. **[V]**

---

## §5 — Codex CLI `67cc3c3`

The most rigorous image pipeline of the seven.

### 5.1 The constants

`codex-rs/utils/image/src/lib.rs:24-32` **[V]**
```rust
pub const PROMPT_IMAGE_PATCH_SIZE: u32 = 32;
/// Maximum width or height used when resizing images before uploading.
pub const MAX_DIMENSION: u32 = 2048;
/// This is a high sanity guard against pathological inputs, not a protocol
/// requirement or target upload size.
pub const MAX_PROMPT_IMAGE_INPUT_BYTES: usize = 1024 * 1024 * 1024;   // 1 GiB
const MAX_IMAGE_CACHE_BYTES: usize = 64 * 1024 * 1024;
```
`codex-rs/core/src/image_preparation.rs:34-42` **[V]**
```rust
const HIGH_DETAIL_LIMITS: PromptImageResizeLimits   = PromptImageResizeLimits { max_dimension: 2048, max_patches: 2_500 };
const UNIFIED_IMAGE_LIMITS: PromptImageResizeLimits = PromptImageResizeLimits { max_dimension: 6000, max_patches: 10_000 };
```
These mirror the OpenAI docs exactly: *"32px x 32px patches"*, *"patch_count =
ceil(width/32)×ceil(height/32)"*, *"typically 2,500 patches for newer models"*, *"resized to fit a
2048-pixel maximum dimension"* **[V-doc]**.

### 5.2 Encode — metadata preserved, JPEG q85 ↔R54

`lib.rs:128-142, 381-390` **[V]**
```rust
// Preserve the metadata most important for rendering prompt images faithfully: the color
// profile and EXIF data, including orientation.
let metadata = ImageMetadata {
    // Only RGB profiles are safe across every re-encoding path. … Bytes 16..20 are the ICC
    // data color space signature.
    icc_profile: decoder.icc_profile().ok().flatten().filter(|p| p.get(16..20) == Some(b"RGB ")),
    exif: decoder.exif_metadata().ok().flatten(),
};
…
ImageFormat::Jpeg => { let mut encoder = JpegEncoder::new_with_quality(&mut buffer, 85); … }
```
**Codex re-attaches EXIF (including orientation) and the ICC profile to the re-encoded image, and
uses JPEG quality 85.** ↔R54: canvas cannot do the first half — a browser re-encode always strips
EXIF — which is precisely why the orientation must be *baked into the pixels* client-side. Codex's
choice is the alternative strategy, not available to us.

If the image fits, the **source bytes are passed through untouched** (`can_preserve_source_bytes`) —
no gratuitous re-encode. **[V]**

### 5.3 Wire shape + labelling

`codex-rs/protocol/src/models.rs:1797-1818` **[V]** — an image becomes a 3-item sandwich:
```
InputText  <local_image path="…">      (open tag)
InputImage image_url = data:<mime>;base64,…   detail = auto|low|high|original
InputText  </local_image>              (close tag)
```
Audio gets the same treatment (`InputAudio`, `audio_url`), with an unsupported-format placeholder:
*"Codex cannot attach audio at `{}`: unsupported audio format; use wav, mp3, m4a, webm, or ogg."*

### 5.4 Failure placeholders — every one is a sentence to the model

`codex-rs/core/src/image_preparation.rs:26-32` **[V]**
```rust
pub(crate) const IMAGE_PROCESSING_ERROR_PLACEHOLDER: &str = "image content omitted because it could not be processed";
const IMAGE_TOO_LARGE_PLACEHOLDER: &str = "image content omitted because it exceeded the supported size limit; use a smaller image";
const UNSUPPORTED_LOW_DETAIL_PLACEHOLDER: &str = "image content omitted because detail 'low' is not supported; use 'high', 'original', or 'auto'";
const REMOTE_IMAGE_URL_PLACEHOLDER: &str = "image content omitted because remote image URLs are not supported";
```

### 5.5 The resize notice — tell the model what you took away

`codex-rs/core/src/context/image_resize_notice.rs` **[V]**
```rust
fn role(&self) -> &'static str { "developer" }
fn requires_separate_message(&self) -> bool { true }
fn type_markers() -> (&'static str, &'static str) { ("<image_resize_notice>", "</image_resize_notice>") }
…
format!("Image {} of {} in the preceding {source} was resized from {}x{} to {}x{} pixels.",
        image_number, image_count, source_width, source_height, prepared_width, prepared_height)
```
`source` is `"user message"` or `"tool output"`. **Nobody else in the survey does this.**

### 5.6 Composer UX

`codex-rs/tui/src/clipboard_paste.rs` **[V]** — clipboard capture accepts **both** a file list and
raw image data, preferring files: *"Sometimes images on the clipboard come as files (e.g. when
copy/pasting from Finder), sometimes they come as image data (e.g. when pasting from Chrome). Accept
both, and prefer files if both are present."* Captured images are always encoded to PNG and written
to a temp file. Reported UX **[R]**: Ctrl+V (macOS/Linux) / Alt+V (Windows/WSL) inserts an
`[Image #1]` chip; drag-drop works but on some terminals only pastes the path; a bare path in the
sentence also works.

---

## §6 — goose `67827a1`

### 6.1 The attach mechanism is a PATH IN THE TEXT

`crates/goose-provider-types/src/formats/openai.rs:257-276` **[V]**
```rust
MessageContentBlock::Text(text) => {
    if !text.text.is_empty() {
        if message.role == Role::User {
            if options.supports_vision {
                if let Some(image_path) = detect_image_path(&text.text) {
                    if let Ok(image) = load_image_file(image_path.as_ref()) {
                        has_non_text_content = true;
                        content_array.push(json!({"type": "text", "text": text.text}));
                        content_array.push(convert_image(&image, image_format));
                    } else { content_array.push(json!({"type": "text", "text": text.text})); }
                } …
```
`detect_image_path` (`crates/goose-provider-types/src/images.rs:38-90`) scans the user's prose for a
`/`-anchored path ending in `.png`/`.jpg`/`.jpeg`, `MAX_PATH_LEN: usize = 4096`. **[V]**
**If `supports_vision` is false the path stays as literal text — the image is silently dropped with
no notice to user or model.**

### 6.2 Limits + magic bytes ↔R55

`crates/goose-provider-types/src/images.rs:10, 194-255` **[V]**
```rust
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;      // "exceeds the 20 MiB limit"
fn has_image_magic(bytes: &[u8]) -> bool {
    matches!(bytes.get(..4),
        Some([0x89,0x50,0x4E,0x47]) | Some([0xFF,0xD8,0xFF,_]) | Some([0x47,0x49,0x46,0x38]))
}
…
if !has_image_magic(&bytes) { return Err(ProviderError::RequestFailed("File is not a valid image".to_string())); }
```
Also guards a **sparse-file** attack: the size is checked from `metadata().len()` *and* the read is
bounded (`read_bounded(file, MAX_IMAGE_BYTES)` reads `max+1` bytes and re-checks) — there is a test
named `load_image_file_rejects_oversized_sparse_file`. **[V]** No downscale of any kind.

### 6.3 Wire shape

`images.rs:19-36` **[V]** — the plainest possible pair:
```rust
ImageFormat::OpenAi    => json!({"type":"image_url","image_url":{"url": format!("data:{};base64,{}", mime, data)}}),
ImageFormat::Anthropic => json!({"type":"image","source":{"type":"base64","media_type":mime,"data":data}}),
```

### 6.4 Capability detection

`crates/goose-provider-types/src/model.rs:146-153` **[V]**
```rust
if self.supports_vision.is_none() {
    self.supports_vision = Some(canonical.modalities.input.contains(&crate::canonical::Modality::Image))
}
```
Config-first (`"supports_vision": true` in the model config JSON), then a canonical catalog.
Unknown ⇒ false.

### 6.5 Desktop composer

`ui/desktop/src/components/ChatInput.tsx:83` **[V]** — **`const MAX_IMAGES_PER_MESSAGE = 10;`**
(the same 10 LibreChat uses), enforced on both paste and drop, with an inline error chip that
auto-clears after 5 s. Pasted images become data URLs, then are split into `{data, mimeType}` at
send. Paste also has a nice non-image branch: HTML clipboard content containing links is converted
to Markdown via `turndown` rather than dropped. **[V]**

---

## §7 — Continue.dev `5522c6f`

### 7.1 Client resize — the tightest numbers, and a bug

`gui/src/components/mainInput/TipTapEditor/utils/imageUtils.ts` **[V]**
```ts
const IMAGE_RESOLUTION = 1024;
export function getDataUrlForFile(file: File, img: HTMLImageElement): string | undefined {
  const scaleFactor = Math.min(IMAGE_RESOLUTION / img.width, IMAGE_RESOLUTION / img.height);
  const canvas = document.createElement("canvas");
  canvas.width  = img.width  * scaleFactor;
  canvas.height = img.height * scaleFactor;
  …
  const downsizedDataUrl = canvas.toDataURL("image/jpeg", 0.7);
```
- **1024 box, JPEG 0.7** — the most aggressive downscale in the field.
- **Bug worth not copying:** `scaleFactor` is not clamped to `≤ 1`, so a 200×200 image is *upscaled*
  to 1024×1024 before encoding. Every other peer guards with `withoutEnlargement`, an early return,
  or `Math.min(width, max)`.
- Accept list + size gate: `["image/jpeg","image/jpg","image/png","image/gif","image/svg","image/webp"]`
  and `filesize < 10` (MB), else the toast *"Images need to be in jpg or png format and less than
  10MB in size."* — the message contradicts the accept list. **[V]**

### 7.2 Capability detection — provider allow-list × model regex, config override

`core/llm/autodetect.ts:114-184` **[V]**
```ts
const PROVIDER_SUPPORTS_IMAGES: string[] = ["openai","ollama","lemonade","cohere","gemini","msty",
  "anthropic","bedrock","sagemaker","openrouter","clawrouter","venice","sambanova","vertexai","azure", …];
const MODEL_SUPPORTS_IMAGES: RegExp[] = [/llava/,/gpt-4-turbo/,/gpt-4o/,/claude-3/,/sonnet/,/opus/,/haiku/,
  /pixtral/,/llama-?3\.2/,/llama-?4/, /\bgemma-?[34](?!n)/, /\b(pali|med)gemma/, /qwen(.*)vl/,
  /mistral-small/,/mistral-medium/];

function modelSupportsImages(provider, model, title, capabilities) {
  if (capabilities?.uploadImage !== undefined) return capabilities.uploadImage;   // config wins
  if (!PROVIDER_SUPPORTS_IMAGES.includes(provider)) return false;
  … lowerModel.includes("vision") || lowerTitle.includes("vision") || MODEL_SUPPORTS_IMAGES.some(rx => …)
}
```
Note `/\bgemma-?[34](?!n)/` with the comment *"gemma3/gemma4 support vision, but gemma3n doesn't!"* —
the maintenance cost of a regex list, in one line.

### 7.3 No-vision handling — composer gate + silent history flattening

Composer (`TipTapEditor.tsx:238-250`, `editorConfig.ts:159-175`): drop and paste both return early
if `!modelSupportsImages(...)` — **no toast, nothing happens.** **[V]**

Backend (`core/llm/countTokens.ts:110-118`): **[V]**
```ts
// If images not supported, convert MessagePart[] to string
if (!supportsImages) {
  for (const msg of msgsCopy) {
    if ("content" in msg && Array.isArray(msg.content)) { msg.content = renderChatMessage(msg); }
  }
}
```
`renderChatMessage` → `stripImages(content)` — image parts are dropped with no marker.

### 7.4 Token accounting

`countTokens.ts:87-91`: `function countImageTokens(content) { if (content.type === "imageUrl") return 1024; … }`
**A flat 1024 tokens per image** (open-webui uses 1000). Used by the context-pruning pass that
drops whole historical messages from the front. **[V]**

---

## §8 — Docs-only peers

### 8.1 OpenAI Responses image inputs **[V-doc, fetched 2026-09-01]**
- *"Up to 512 MB total payload per request"*; formats *"PNG (.png), JPEG (.jpeg or .jpg), WEBP
  (.webp), and non-animated GIF (.gif)"*.
- *"Up to 1,500 images per request"*; *"Up to 30,000 patches per image after applying the resizing rules"*.
- *"32px x 32px patches"*, `patch_count = ceil(width/32)×ceil(height/32)`; `high` detail ≈ **2 500
  patches**; oversized images resized to a **2048-pixel maximum dimension**.

### 8.2 Anthropic Messages API vision **[V-doc, fetched 2026-09-01]**
- Three source types: base64, URL, **`file_id` from the Files API**.
- Max images: **20/message on claude.ai**, 100/request for 200k-context models, 600 otherwise. Max
  dimensions **8000×8000 px**. Max size **10 MB base64** (5 MB on Bedrock/Vertex). Request size cap
  **32 MB**.
- If a request has **more than 20 image blocks** a stricter per-image dimension limit kicks in;
  guidance is *"resize each image so that neither dimension exceeds 2000 px, or keep the request to
  20 or fewer image and document blocks"* — **and images from earlier turns that you resend count
  toward that threshold.**
- Patch = **28×28**; cost `⌈w/28⌉ × ⌈h/28⌉`. Resolution tiers: standard **1568 px long edge / 1568
  visual tokens**; high-resolution (Claude 4.7+) **2576 px / 4784 tokens**.
- The load-bearing paragraph for ctrl-b's history design:
  > *"In multi-turn conversations and agentic workflows, each request resends the full conversation
  > history. If images are base64-encoded, the full image bytes are included in the payload on every
  > turn, which can significantly increase request size and latency as the conversation grows."*
- And the counter-fact for anyone tempted to drop images from history:
  > *"Claude has access to every image from earlier turns, so follow-up questions such as 'Are these
  > similar to the first two?' work without including the earlier images again in the new turn's
  > content."* — i.e. **on the Anthropic wire the history images are what make follow-ups work; you
  > cannot drop them and keep the behaviour.**
- *"Image uploads are ephemeral and not stored beyond the duration of the API request."*
- *"Claude does not parse or receive any metadata from images"* — EXIF is irrelevant to the model;
  orientation must be baked into pixels.

### 8.3 Claude Code **[R]**
Ctrl+V (macOS/Linux) / Alt+V (Windows, WSL) pastes a clipboard image as an `[Image #N]` chip in the
prompt; drag-drop from Finder/Explorer works in some terminals and pastes the raw path in others
(anthropics/claude-code#48153); a plain path in the sentence is the universal fallback. No
upload endpoint, no persistence — the same local-agent model as Codex/opencode/goose.

---

## §9 — Cross-cutting answers

### 9.1 The FIELD CONSENSUS shape (what everyone ships)

Intersect all seven and this is what is left — the minimum viable, single-user-safe design:

1. **Two classes at the composer, decided on `mime.startsWith('image/')`.** 7/7.
2. **Images go to the model as one part per image, base64 data URL, next to the text part.** 7/7.
   OpenAI shape `{type:'image_url', image_url:{url:'data:…;base64,…'}}`; Anthropic shape
   `{type:'image', source:{type:'base64', media_type, data}}`. Everyone who supports both ships a
   small per-provider switch, nothing more.
3. **Non-images become TEXT before they reach the model**, one of two ways: whole extracted text
   inline (LibreChat, opencode) or retrieved chunks (open-webui, AnythingLLM). Nobody invents a
   third.
4. **A per-message count cap around 10.** LibreChat `fileLimit: 10`, goose
   `MAX_IMAGES_PER_MESSAGE = 10`. 2/7 explicit, the rest uncapped.
5. **A per-file byte cap in the 10–20 MB band** for the local/simple implementations: opencode
   10 MiB, Continue 10 MB, goose 20 MiB, Anthropic API 10 MB. LibreChat's 512 MB is a server upload
   ceiling for the RAG path, not a chat-image number.
6. **Chips in the composer with per-file status**, remove-on-tap, image thumbnail. 5/5 GUI peers.
7. **Paste and drag-drop, both.** 5/5 GUI peers. Clipboard handling always needs the `items`
   fallback next to `files`.
8. **Attachments are re-sent from history by default.** 7/7 — even LibreChat, whose toggle defaults
   to `true`.

### 9.2 What only the big multi-user apps ship (do NOT copy)

- **A separate upload endpoint + file table + file-management UI + per-file ACL.** open-webui and
  LibreChat need it because files are shared across users, knowledge bases and assistants. For a
  single-user app it buys nothing over AnythingLLM's "the bytes ride in the chat POST".
- **RAG/vector-embedding for attached documents** (open-webui, AnythingLLM). The whole
  queries-generation + embedding + rerank + threshold apparatus exists to fit corpora, not the one
  log file the owner just pasted. LibreChat's `fileTokenLimit`-truncated inline text and opencode's
  synthetic-Read transcript are both simpler and better for a single small file.
- **Cloud storage strategies** (S3/Azure/Firebase/CloudFront) and the base64-refetch dance they
  force in `encodeAndFormat`.
- **Retention/expiry machinery** driven by temp-chat policy and a background sweep — worth
  understanding, not worth building until there is something to expire.
- **Per-user re-authorization of historical files** before replay (LibreChat
  `getOwnerHistoricalFiles`, open-webui `get_image_base64_from_file_id`'s ownership gate, whose
  comment reads *"without this check the server reads the file from disk, inlines it base64 into the
  LLM request, and the content leaks via OCR/describe"*). Irrelevant with one user; the *shape* of
  the attack (a file_id planted in an `image_url` field causing server-side read + exfil via
  description) is still worth remembering if ctrl-b ever accepts a client-supplied file id.
- **Multi-model composers** and the "all selected models must be capable" AND-gate.
- **Animated PNG/WebP container parsing before resize** (LibreChat). Real, but it is why LibreChat
  ships resize off by default; a phone-photo-first app can simply refuse to re-encode animated types.

### 9.3 Anybody who REFUSED or removed attachments? (Q8)

**No peer in this class has removed or refused chat attachments.** What the record shows instead is
a consistent pattern of *deliberate off-by-default* and *deliberate narrowing*:

- **LibreChat ships client-side image resize disabled** (`clientImageResize.enabled: false`) despite
  having written the whole pipeline — the admin or user must opt in. **[V]**
- **open-webui ships size, count and compression all unset.** **[V]**
- **opencode narrows "image" to exclude SVG** (`isImageAttachment` rejects `image/svg+xml` and
  `image/vnd.fastbidsheet`) and narrows the read-tool image set to jpeg/png/gif/webp. **[V]**
- **Codex refuses remote image URLs outright** — `REMOTE_IMAGE_URL_PLACEHOLDER: "image content
  omitted because remote image URLs are not supported"` — an SSRF-shaped refusal ctrl-b should
  copy verbatim. **[V]**
- **Codex refuses `detail: 'low'`** on the models where it is unsupported rather than silently
  upgrading. **[V]**
- The closest thing to a *reported* retreat is LibreChat's evolving upload menu (the
  "Upload Image" → "Upload to Provider" rename, and repeated reports of the non-image upload path
  disappearing between 0.7.9 and 0.8.x) — churn in the *routing* of uploads, not a removal of the
  feature. **[R]**

---

## §10 — Implications for ctrl-b *(short, advisory — the main seat rules)*

1. **Take AnythingLLM's transport shape, not open-webui's.** For a single-user app, an image that
   rides inside the chat POST as a data URL removes an entire endpoint, an entire table, an entire
   ACL surface, and the whole GC question. ↔R55's raw-body-PUT reasoning applies to the *media
   manager*, where bytes must persist; a chat image arguably does not need to.
   **But** copy AnythingLLM's *transport*, never its *storage*: do not persist the base64 into the
   message row, or every later turn in the thread re-reads and re-sends it from SQLite.
2. **If bytes do land on disk, land them under a chat-scoped path and delete on chat delete.** Both
   big apps skipped this and both leak forever. We already own `core/media.py` + the fsutil atomic
   ladder; a `chat/{chat_id}/` namespace with a delete hook is cheaper for us than for them.
3. **Copy opencode's no-vision answer, not open-webui's.** An in-band
   `ERROR: Cannot read "x.png" (this model does not support image input). Inform the user.` beats a
   composer refusal for a fleet where the owner switches between qwen3.6-max and a local Gemma
   mid-thread. A composer-side hint can still ride on top.
4. **Copy Codex's resize notice.** We *will* downscale on the client (R54), which means the model is
   reasoning about pixels the owner never saw. One `developer`-role line —
   `<image_resize_notice>…resized from 4000x3000 to 1600x1200 pixels.</image_resize_notice>` — is
   the cheapest fidelity guard in the survey and nobody else ships it.
5. **The re-send question needs a ctrl-b answer, and LibreChat's is the only shipped precedent.**
   A per-conversation `resendFiles`-style setting defaulting to `true`, with opencode's
   `[Attached image/png: foo.png]` stub as the "off" rendering, composes cleanly with our existing
   Settings/AgentDef tunables (and satisfies *prefer-configurable, no-hardcoding*). Note §8.2: on
   Anthropic, dropping history images breaks follow-up questions — so `true` must stay the default.
6. **Numbers to argue from, not invent.** Long edge **1568** if we ever talk to Anthropic directly,
   **2048** for OpenAI-compatible high detail, **1900** if we want to guarantee no server-side
   resize. JPEG **0.85** is confirmed by Codex; Continue's 0.7 is the aggressive end,
   LibreChat's 0.92 the conservative end. Per-message count **10**. Per-file byte cap **10 MiB**.
   Token budgeting: assume **~1000–1024 tokens per image** for context accounting (both web peers
   converged on that constant independently).
7. **Non-image files: take opencode's synthetic-Read transcript, not RAG.** We already have a read
   tool and a truncation convention (R53). Rendering an attached text file as
   *"Called the Read tool with the following input: {…}"* + the file's content reuses vocabulary the
   model already has and costs zero new machinery. Cap it the way LibreChat does — but unlike
   LibreChat, **mark the truncation in the text**; their silent slice is a defect, not a pattern.
8. **PWA share_target with `files` is unclaimed territory.** No peer ships it. For an
   Android-first, installed-PWA, Tailscale-only app it is the single highest-leverage composer
   affordance in this dossier — share a photo from the gallery straight into a chat. It needs a
   `POST`/`multipart-form-data` share target and a landing route, which is a different transport
   from §10.1 and should be designed together with it.
9. **Two R54/R55 corrections to fold back:** local agents *do* magic-byte-sniff (opencode, goose) —
   if ctrl-b accepts arbitrary bytes for the chat path, a 6-signature sniff is ~15 lines and is
   field-standard for our class; and open-webui's Android **first-export-black-canvas** warm-up
   (`toBlob` once, then `toDataURL`) is a device-class bug our client pipeline has not accounted for.

---

## §11 — What I could NOT determine

1. **Whether LibreChat's `expiresAt` 1-hour Mongo TTL on files is ever written.** I grepped all of
   `api/` and `packages/` and found no writer; it may be set by an ee/enterprise path outside this
   repo, or be vestigial. Treated as **not live**.
2. **Whether open-webui deletes storage bytes on any automatic path.** I verified no chat-delete
   hook and no scheduled sweep; I did not exhaustively audit every background task registration, so
   this is "verified absent in the delete paths I read", not "proven absent globally".
3. **open-webui's `visionCapableModels` for a fresh local model.** The `?? true` default means a
   model with no admin-set capabilities is treated as vision-capable, but I did not confirm whether
   the model-import path back-fills `info.meta.capabilities` from a catalog (which would change the
   effective default).
4. **Codex CLI's history behaviour for images.** Codex stores images as `ResponseItem`s in the
   rollout and prepares them per request; I did not trace whether an image from turn 1 is re-encoded
   and re-sent on turn 20, or whether the Responses `store`/`previous_response_id` path elides it.
   The `IMAGE_CACHE` (64 MB) suggests re-preparation is at least memoized.
5. **Whether any peer's `share_target` ships `files` today.** open-webui's is text-only at this SHA
   and the files PR is open; I did not check the other six for a manifest at all (LibreChat has no
   in-repo `manifest.json`; the CLIs have none by definition).
6. **AnythingLLM's behaviour when a non-vision model receives `input_image`.** I verified there is
   no gate; I did not run it to see whether the error surfaces usefully or as a raw provider 400.
7. **Retry-on-failed-upload anywhere.** I found none in LibreChat, open-webui or AnythingLLM (all
   drop the file and toast), but I did not read every GUI peer's queue code exhaustively.
8. **HEIC beyond open-webui.** Only open-webui converts (via `heic2any`). I did not determine
   whether LibreChat/AnythingLLM accept `image/heic` at all — their supported-MIME regexes would
   need a separate read.
