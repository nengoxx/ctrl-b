# R66 — Character-card import/export containers, shipping importer behaviour, and character-editor form UX

**Date:** 2026-09-06 · **Author:** Opus 5 research subagent (bounded single-agent pass)
**Question (owner-directed):** the owner has ruled ctrl-b will **import V2/V3 character cards** onto
its existing per-agent system, with the roleplay prompt fields appearing as optional *marked* fields
in the agent editor. Two gaps blocked the spec: (a) the import/export **container** mechanics and how
shipping importers actually behave, (b) how the field's character **editors** present these fields.
**Consumer:** the roleplay/characters + lorebook spec (open). **Nothing here is a decision** — §9 maps
findings onto ctrl-b seams only.

**Companion dossier:** [R64](./R64-roleplay-character-prompting.md) owns card **anatomy** (what each
field means, prompt assembly, the tools reconciliation). This one owns **containers, importers,
and editor forms**. Read R64 §1 first; nothing here re-buys it.

## Confidence key

- **[V]** verified — I read the source at the pinned SHA, or the spec's normative text.
- **[R]** reported — secondary source (docs site, advisory database). Not code-verified.
- **[U]** unverified — expected but not checked.

## Sources (pinned — same clones as R64, SHAs re-verified 2026-09-06)

| Repo | SHA | Version / branch |
|---|---|---|
| SillyTavern/SillyTavern | `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8` | `release`, **1.18.0** |
| malfoyslastname/character-card-spec-v2 | `8083fb388615ccbce768e97cbbd49d2b3214632c` | 2023-06-22 (frozen) |
| kwaroran/character-card-spec-v3 | `f3a86af019fbd99f788f7a1155f399655b34ab35` | 2024-07-20 (frozen) |
| kwaroran/RisuAI | `c454df882aaf32e02a22da26d3718c8cadc97814` | HEAD 2026-09-05 |
| agnaistic/agnai | `fccee00f5f7628d150760c787c4be87e6b1a652c` | 2026-06-13 |
| LostRuins/lite.koboldai.net | `66883337de1bbc1ece06965a2c5e29ceb8dca833` | HEAD 2026-09-05 |

Docs-only [R]: `docs.openwebui.com/features/workspace/models/`, `librechat.ai/docs/features/agents`,
`advisories.gitlab.com/npm/sillytavern/CVE-2026-34522/`.

⚠ The R64 search-pollution warning still applies: this topic's SEO surface is AI-generated content
farms. Everything below is repo or spec primary.

---

## 1. Containers — what a "character card" physically is

### 1.1 PNG/APNG: a `tEXt` chunk holding base64 JSON **[V]**

**V1's normative text is one line** (`ccv2/spec_v1.md:17-21`):

```
## Embedding methods

- .json file with no image. Discouraged for user-friendliness.
- PNG/APNG: JSON string encoded in base64 inside the "Chara" EXIF metadata field.
- WEBP: **Not covered by the spec due to technical ambiguities.**
```

⚠ **The V1 spec says "EXIF metadata field" and it is wrong** — the ecosystem universally implements
it as a PNG **`tEXt` chunk with keyword `chara`**. V3 corrects the language explicitly
(`ccv3/SPEC_V3.md:24`):

> "The CharacterCardV3 object *MUST* be embedded in the PNG or APNG file as a tEXt chunk. The tEXt
> chunk *MUST* be named `ccv3` and the value of the tEXt chunk *MUST* be the JSON string of the
> CharacterCardV3 object, with utf-8 -> base64 encoding."

**V2 adds no embedding text at all** — `spec_v2.md:3` describes itself as "new JSON fields added to
the *embedded JSON* of V1 character cards". So a V2 card is a `chara` chunk whose JSON carries
`spec: 'chara_card_v2'`. There is no `ccv2` keyword.

### 1.2 Which chunk wins when both are present **[V]**

The spec rules for `ccv3` and requires a warning on the downgrade path (`ccv3/SPEC_V3.md:26,28`):

> "if the application detects both `chara` and `ccv3` chunk, the application *SHOULD* use the `ccv3`
> chunk."

> "Application *MAY* backfill Character Card V2 objects from the PNG/APNG files in `chara` chunk.
> however, Application backfilling … *SHOULD* add a warning to the user that it is backfilled on
> `creator_notes` field … like: `This character card is Character Card V3, but it is loaded as a
> Character Card V2. Please use a Character Card V3 compatible application to use this character card
> properly.` … The backfilled `chara` chunk *SHOULD* be trimmed on import."

Both shipping readers comply, **case-insensitively**:

- **ST** (`st/src/character-card-parser.js:64-74`) — `ccv3` index first, `chara` second, throws if
  neither. Keywords lowercased before compare.
- **Risu** (`risu/src/ts/characterCards.ts:178-190, 259-261`) — reads both in one streaming pass,
  then `if(readedCCv3){ readedChara = readedCCv3 }`. **Each chunk is capped at 5 MB**
  (`:180, :186` — `//For memory reason, limit to 5MB`); a chunk over the cap is silently dropped,
  not truncated.

Neither implements the spec's "add a warning to `creator_notes`" backfill notice **[V, negative]**.

### 1.3 PNG-embedded *assets* — the `chara-ext-asset_` sidecar **[V]**

V3 defines an in-PNG asset transport it simultaneously deprecates (`ccv3/SPEC_V3.md:30`):

> "PNG/APNG files *MAY* have additional tEXt chunks that works like assets embedded in CHARX files.
> the tEXt chunk *MUST* be named `chara-ext-asset_:{path}` and the value of the tEXt chunk *MUST* be
> the base64 encoded binary data. and it could be accessed by `__asset:{path}` URI. however,
> implementing this on new applications *SHOULD* be avoided, and CHARX files *SHOULD* be used
> instead."

**Risu reads and writes it; ST does neither.** Risu pre-scans the PNG counting `chara-ext-asset_`
chunks for a progress bar, then decodes each into its asset store
(`risu/src/ts/characterCards.ts:156-158, 191-235`); on V2 export it re-emits them
(`:1286, :1303, :1320` — `await writer.write("chara-ext-asset_:" + assetIndex, b64encoded)`). ST's
reader only ever looks at `ccv3`/`chara` (`character-card-parser.js:57-74`), so **a Risu V2 PNG
imported into ST loses its embedded assets** — except that ST separately materialises Risu's
*base64-in-JSON* assets, see §2.4.

### 1.4 Other image formats — what actually carries cards **[V]**

| Format | Who reads it | Mechanism |
|---|---|---|
| PNG / APNG | ST, Risu, Agnai, Lite | `tEXt` `chara` / `ccv3` |
| **WEBP** | **Agnai only** | **EXIF `UserComment`** (`agnai/web/pages/Character/card-utils.ts:33, 57-72`) |
| JPEG / JPG | **Risu only** | **not a metadata field — a CHARX zip appended to a JPEG** |
| `.json` | all | plain file, discriminated by `spec` (§1.6) |
| `.charx` | ST, Risu | zip (§1.5) |
| `.byaf` | ST only | Backyard AI archive (zip; out of scope) |

**WEBP is the one real EXIF case, and Agnai documents a historical wire change inline**
(`card-utils.ts:57-71`):

```ts
async function extractExif(buffer: Buffer): Promise<string> {
  const exif = loadExif(buffer)
  const data = (exif.UserComment as any)?.description
  if (!data) throw new Error('No data found')
  if (data.startsWith('{')) {
    // This is in the correct format of being a card but hasn't been processed by newer (>April 2023) Tavern versions
    return data
  } else {
    // This card has been processed by a recent version of Tavern so the data is stored as a byte array
    const bytes = new Uint8Array(data.split(',').map(Number))
    ...
```

⚠ **Agnai's `dataExtractors` maps `jpg`/`jpeg` to `extractText` — the PNG-chunk extractor**
(`card-utils.ts:29-30`). JPEG has no PNG chunks; `png-chunks-extract` on a JPEG throws. That entry
looks dead/broken, not a real JPEG card path. **[V, observed]**

**Risu's JPEG path is the real one and it is a container trick, not metadata.** `.jpg`/`.jpeg` are
routed to the **CHARX** importer alongside `.charx`
(`risu/src/ts/characterCards.ts:81` — `if(f.name.endsWith('charx') || f.name.endsWith('jpg') || f.name.endsWith('jpeg'))`),
and the writer has a matching `charxJpeg` export type that writes the JPEG first, then the zip
(`:1245-1270`, `if(writer instanceof CharXWriter && type === 'charxJpeg'){ await writer.writeJpeg(img) }`).
ST's CharX parser independently tolerates the same shape — it scans for the ZIP local-file-header
signature rather than assuming offset 0 (`st/src/charx.js:15-30`):

```js
// ZIP local file header signature: PK\x03\x04
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
function findZipStart(buffer) { ... const index = buf.indexOf(ZIP_SIGNATURE); if (index > 0) return buf.slice(index); ... }
```

So **"a card in a JPEG" means "a zip with a JPEG glued on the front"**, an SFX-archive idiom. It is
outside both specs.

### 1.5 CHARX — the zip container **[V]**

`ccv3/SPEC_V3.md:38-59`, verbatim on the load-bearing bits:

> "The CHARX file is a zip file that contains the CharacterCardV3 object as a JSON file, and with
> other assets embedded. The JSON file *MUST* be named `card.json` at the root of the zip file. …
> the assets embedded in the CHARX file can be accessed by `embeded://path/to/asset.png` URI (Not
> `embedded://`). the path is case sensitive, and sepearated by `/`."

⚠ **The typo `embeded://` is normative.** ST hard-codes tolerance for all three spellings, with the
reason in a comment (`st/src/charx.js:9-10`):

```js
// 'embeded://' is intentional - RisuAI exports use this misspelling
const CHARX_EMBEDDED_URI_PREFIXES = ['embeded://', 'embedded://', '__asset:'];
```

Asset layout is `assets/{type}/{images|audio|video|l2d|3d|ai|fonts|code|other}/`, where `{type}` is
the **use** (`icon`/`background`/`emotion`/`user_icon`/`other`), not the media kind (`:40-53`).
The spec also opens a per-app side-channel and sets container hygiene rules (`:55-59`):

> "Application specific data can be stored as a JSON file in root of the zip file."
> "Zip file *SHOULD NOT* be encrypted and *SHOULD* only use characters inside ASCII range for the
> file name and the file path inside the zip file to prevent compatibility issues."
> "Application's *MAY* reject the CHARX file if the file is too large, or the file is corrupted, or
> the file is not a valid zip file, or the file is encrypted…"

Risu uses that side-channel for its **module** file, which is where scripts ride (§3.1).

### 1.6 The `spec` / `spec_version` discriminator and V1 detection **[V]**

- V2: `"The value for this field **MUST** be `"chara_card_v2"`"` / `"2.0"` (`spec_v2.md:127, 131`).
- V3: `"chara_card_v3"` / `"3.0"`, and the version compare is **float parse, not string equality**
  (`ccv3/SPEC_V3.md:121-129`):

  > "How the `spec_version` is determined as a newer version is by parsing the string as a float. if
  > the float is bigger than `3.0`, the application *SHOULD* consider the Character Card object as a
  > newer version… the application *SHOULD* alert the user… however, the application *SHOULD* support
  > importing of it."

- **V1 detection is "no `spec` key".** Every importer does the same three-way branch on the parsed
  JSON; ST's is the clearest (`st/src/endpoints/characters.js:883-960`):
  `jsonData.spec !== undefined` → spec path; `else if (jsonData.name !== undefined)` → "v1 json";
  `else if (jsonData.char_name !== undefined)` → "gradio json" (Pygmalion notepad). Risu's V1 sniff
  is content-shaped rather than key-shaped (`characterCards.ts:68`):
  `if((da.char_name || da.name) && (da.char_persona || da.description) && (da.char_greeting || da.first_mes))`.

- **`getCharaCardV2` is the whole ladder in 12 lines** (`st/src/endpoints/characters.js:450-461`):

```js
function getCharaCardV2(jsonObject, directories, hoistDate = true) {
    if (jsonObject.spec === undefined) {
        jsonObject = convertToV2(jsonObject, directories);
        if (hoistDate && !jsonObject.create_date) jsonObject.create_date = new Date().toISOString();
    } else {
        jsonObject = readFromV2(jsonObject);
    }
    return jsonObject;
}
```

---

## 2. Importer behaviour, source-read

### 2.1 The normalisation ladder: ST keeps V1 and V2 **side by side, forever** **[V]**

This is the single most surprising structural fact. ST does **not** convert V1→V2 and discard V1;
it maintains a **flat V1 mirror alongside `data.*`** in every stored card, and re-syncs on read
(`characters.js:504-557`):

```js
function readFromV2(char) {
    if (_.isUndefined(char.data)) { console.warn(`Char ${char.name} has Spec v2 data missing`); return char; }
    _.unset(char, 'json_data');
    const fieldMappings = { name:'name', description:'description', personality:'personality',
        scenario:'scenario', first_mes:'first_mes', mes_example:'mes_example',
        talkativeness:'extensions.talkativeness', fav:'extensions.fav', tags:'tags' };
    _.forEach(fieldMappings, (v2Path, charField) => {
        const v2Value = _.get(char.data, v2Path);
        ...
        if (!_.isUndefined(char[charField]) && !_.isUndefined(v2Value) && String(char[charField]) !== String(v2Value)) {
            console.warn(`Char ${char.name} has Spec v2 data mismatch with Spec v1 for field: ${charField}`, char[charField], v2Value);
        }
        char[charField] = v2Value;   // V2 wins
    });
```

**V2 wins on conflict, and a divergence only logs a warning.** Defaults are backfilled for exactly
two ST-private extension fields (`extensions.talkativeness → 0.5`, `extensions.fav → false`,
`:492-499`); any *other* missing mapped field warns `has Spec v2 data missing for unknown field` and
is left alone.

Only **nine** fields are mirrored. `system_prompt`, `post_history_instructions`,
`alternate_greetings`, `creator_notes`, `character_book`, `creator`, `character_version` live in
`data.*` only.

### 2.2 Unknown-field preservation: the specs mandate it; the two importers split **[V]**

The V3 spec is explicit (`ccv3/SPEC_V3.md:115`):

> "For future versions of the specification, the application *SHOULD* ignore the fields that are not
> present in the specification, but not reject the import of CharacterCard object. The application
> *MAY* save the fields that are not present in the specification so it can be exported safely."

**ST complies, by an unusual mechanism: a hidden form field carrying the entire raw card.**
`charaFormatData` — the one funnel every create/edit/convert goes through — *starts from the raw
JSON* and only overwrites known keys (`characters.js:565-571`):

```js
function charaFormatData(data, directories) {
    // This is supposed to save all the foreign keys that ST doesn't care about
    const char = tryParse(data.json_data) || {};
    // Prevent erroneous 'json_data' recursive saving
    _.unset(char, 'json_data');
```

`data.json_data` is a **hidden `<input>` in the character form** holding the whole stored card
(`public/index.html:6188` — `<input id="character_json_data" name="json_data" type="hidden">`,
populated at `public/script.js:8753`). So unknown top-level fields, unknown `data.*` fields, and
foreign `extensions` namespaces survive a full ST edit round-trip. `extensions` specifically is
**deep-merged**, not replaced (`characters.js:646-650`).

**Risu does NOT preserve unknown fields.** `importCharacterCardSpec` maps the card into a fixed
`character` object field by field (`risu/src/ts/characterCards.ts:951-1019`). Only `data.extensions`
survives, and even that is filtered (`:940-948`):

```js
let ext = safeStructuredClone(data?.extensions ?? {})
for(const key in ext){
    if(key === 'risuai') delete ext[key]
    if(key === 'depth_prompt') delete ext[key]
}
```

(both are re-emitted from their unpacked homes on export, `:1632-1659`). Unknown **top-level** keys
and unknown `data.*` keys are dropped on the floor.

### 2.3 Malformed-card tolerance — what is validated vs silently defaulted **[V]**

Validated / rejected:

| Check | Where | Behaviour |
|---|---|---|
| PNG has *any* `tEXt` chunk | `character-card-parser.js:59-62` | `throw new Error('No PNG metadata.')` |
| PNG has `chara` or `ccv3` | `:76-77` | `throw new Error('No PNG metadata.')` |
| CHARX has `card.json` | `charx.js:70-72` | `throw new Error('Failed to extract card.json from CharX file')` |
| CHARX `card.json` has `spec` | `charx.js:76-78` | `throw new Error('Invalid CharX card file: missing spec field')` |
| Import `file_type` in the map | `characters.js:1575-1579` | `throw new Error('Unsupported format: …')` |
| Edit: empty/`.` name | `characters.js:1106-1111` | HTTP 400 |
| Risu: card `spec` not v2/v3 | `characterCards.ts:721-723` | returns `false` → falls through to the off-spec converter |

Silently defaulted — **every prompt-text field defaults to `''`**, so a card missing `description`
imports clean (`characters.js:580-585, 598-612`): `_.set(char, 'data.description', data.description || '')`
and so on for all six V1 fields plus `creator_notes`, `system_prompt`,
`post_history_instructions`, `creator`, `character_version`.

Type coercions worth copying:

- `alternate_greetings` accepts an **array, a bare string, or garbage** (`characters.js:573-577`):
  `if (Array.isArray(...)) return ...; if (typeof ... === 'string') return [...]; return []`.
- `tags` accepts a comma-string or an array (`:593`).
- Risu repairs a historically wrong type in place (`characterCards.ts:322-325`):
  `//fix readedChara version pointing number instead of string because of previous version` —
  `character_version` numeric → `.toString()`.
- ST's `depth_prompt` extension defaults `depth: 4`, `role: 'system'`, with `isNaN` guarding the
  number (`characters.js:620-625`).

**Names are sanitised at every entry point** — `sanitize(jsonData.data.name)` *and*
`sanitize(jsonData.name)` before the filename is derived, on all four import paths
(`characters.js:768-770, 888-891, 974-977, 736`), then `getPngName` runs `sanitize` again plus a
uniquifier with `maxTries: 10000` (`:1541-1545`). This is the mitigation class for the CVE in §3.4.

One cosmetic scrub worth noting: ST strips a known placeholder out of imported notes
(`:892-894, 1000-1002`): `jsonData.creator_notes.replace('Creator\'s notes go here.', '')`.

### 2.4 V3 assets on import — and where "the character's image" becomes a UI surface **[V]**

**This is the part with the largest UI blast radius.** Both apps turn card assets into *live app
surfaces*, not just avatars.

**ST — `CharXParser` + `persistCharXAssets`** (`st/src/charx.js:172-278, 309-398`):

1. Only `embeded://` / `embedded://` / `__asset:` URIs are collected; HTTP(S), `data:`, and
   `ccdefault:` assets are ignored on the CharX path (`getEmbeddedZipPathFromUri` returns `null`).
2. Icon pick: `type === 'icon'` with an image extension, preferring `name === 'main'`, else the first
   (`pickCharXIconAsset`, `:202-210`). That buffer becomes the character PNG itself; otherwise
   `DEFAULT_AVATAR_PATH`.
3. Everything else is bucketed into **three storage categories** (`mapCharXAssetsForStorage`, `:240-278`):

   ```js
   const CHARX_IMAGE_EXTENSIONS = new Set(['png','jpg','jpeg','webp','gif','apng','avif','bmp','jfif']);
   const CHARX_SPRITE_TYPES = new Set(['emotion', 'expression']);
   const CHARX_BACKGROUND_TYPES = new Set(['background']);
   ```
   → `emotion`/`expression` = **sprite**, `background` = **background**, anything else = **misc**.
   `icon`/`user_icon` are skipped. Non-image extensions are skipped entirely — audio, video, Live2D,
   fonts and code in a CHARX are **dropped, not stored**.

4. Written to three different live directories (`persistCharXAssets:309-398`):
   - sprite → `characters/{characterName}/` — **this is ST's expression system**, and the name is
     normalised with **hyphens on purpose**: `// Use hyphens for sprites so ST's expression label extraction works correctly (sprites.js extracts label via regex that splits on dash or dot)` (`:264-266`).
   - background → `characters/{characterName}/backgrounds/`
   - misc → `user/images/{characterName}/` — the **image gallery** (`:335`).

   Note `characterFolder = processedCard.name` (the *display* name), not the unique PNG filename —
   `// ST's sprite system looks up by character name, not PNG filename` (`characters.js:784-786`).
   Each write first deletes any same-basename file of any extension (`deleteExistingByBaseName`,
   `:287-298`), mirroring the manual sprite-upload path.

**ST also materialises Risu's V2-style base64 assets from plain JSON/PNG imports** — the one place
a foreign app's extension namespace becomes files on disk (`st/src/endpoints/sprites.js:48-114`,
called at `characters.js:891, 982`):

```js
export function importRisuSprites(directories, data) {
    const risuData = data?.data?.extensions?.risuai;
    if (!risuData || !name) return;
    let images = [];
    if (Array.isArray(risuData.additionalAssets)) images = images.concat(risuData.additionalAssets);
    if (Array.isArray(risuData.emotions))          images = images.concat(risuData.emotions);
    ...
    writeFileAtomicSync(pathToFile, fileBase64, { encoding: 'base64' });
    ...
    // Remove additionalAssets and emotions from data (they are now in the sprites folder)
    delete data.data.extensions.risuai.additionalAssets;
    delete data.data.extensions.risuai.emotions;
```

Every entry is written as `label + '.png'` **regardless of actual format**, and a label colliding
with an existing sprite is skipped with a warning rather than overwritten.

**Risu** resolves four URI schemes and routes by `type` (`characterCards.ts:838-903`):
`__asset:` and `embeded://` → the pre-extracted asset dict (**throws** `'Error while importing, asset X not found'` on a dangling reference);
`ccdefault:` → the card image itself; `data:` → decoded, **with a 50 MB cap** (`:156` —
`if(b64.length < 50 * 1024 * 1024)`, else `alertError('Data URI too large')` and skip);
anything else (including https) → `continue`, i.e. **remote assets are silently ignored**.
Routing: `emotion` → `emotions[]` (the expression screen), `x-risu-asset` → `additionalAssets[]`
(referencable from chat via `{{image::name}}` / `{{audio::name}}` / `{{bg::name}}` macros — see the
in-app help at `src/lang/en.ts:108-109`), `icon`+`main` → the avatar, everything else → `ccAssets[]`
(retained verbatim for re-export).

⚠ **A card can therefore own the user's own avatar.** `ccv3/SPEC_V3.md:179`:

> "if the application supports feature known as 'persona', the application *SHOULD* disable persona
> feature if one or more of the assets is `user_icon` type."

**Risu additionally lets a card own the chat *background* as arbitrary markup.**
`extensions.risuai.backgroundHTML` is imported straight onto the character (`characterCards.ts:1002`)
and is described in-app as "A Markdown/HTML Data that would be injected to the background of chat
screen" (`src/lang/en.ts:116-119`). It is DOMPurify-sanitised at render (§3.3), not at import.

### 2.5 Export — what a round-trip actually preserves **[V]**

**ST, PNG export** (`characters.js:1657-1666`): read the raw chunk string, mutate only the private
fields, re-write. **The card JSON is never re-serialised through a schema** — unknown fields survive
byte-for-byte modulo `JSON.stringify`:

```js
const rawData = read(rawBuffer);
const mutatedData = mutateJsonString(rawData, unsetPrivateFields);
const mutatedBuffer = write(rawBuffer, mutatedData);
```

`unsetPrivateFields` is three lines (`:498-502`): `fav=false`, `data.extensions.fav=false`,
`unset chat`.

**ST, JSON export** (`:1667-1677`) runs `getCharaCardV2` first, so a spec'd card goes through
`readFromV2` (V1 mirror re-synced from `data.*`) and a V1 card is upconverted.

**ST's PNG writer emits BOTH chunks and stamps the second one V3** (`src/character-card-parser.js:15-46`):

```js
// Add new v2 chunk before the IEND chunk
chunks.splice(-1, 0, PNGtext.encode('chara', base64EncodedData));
// Try adding v3 chunk before the IEND chunk
try {
    const v3Data = JSON.parse(data);
    v3Data.spec = 'chara_card_v3';
    v3Data.spec_version = '3.0';
    chunks.splice(-1, 0, PNGtext.encode('ccv3', base64EncodedData /* of v3Data */));
} catch (error) { /* Ignore errors when adding v3 chunk */ }
```

⚠ **The doc comment above that function is stale and says the opposite**: *"Writes only 'chara',
'ccv3' is not supported and removed not to create a mismatch."* (`:10`). The code plainly writes it.
Trust the code. **[V]**

⚠ **And the "V3" chunk ST writes is a lie of stamping**: it is the same object with two strings
swapped. Any *editing* pass through the ST UI runs `charaFormatData`, which unconditionally sets
`spec: 'chara_card_v2'` / `spec_version: '2.0'` (`characters.js:596-597`) — so after an ST edit the
`chara` chunk says v2 and the `ccv3` chunk says v3 **over identical field content**, and V3-only
fields (`assets`, `nickname`, `group_only_greetings`, `creation_date`) survive only because they
were carried in `json_data`, never because ST understands them.

**Verdict on "does a ctrl-b-imported-then-exported card survive an ST round-trip":** on the ST side,
**yes for data, no for assets.** Unknown fields and foreign `extensions` namespaces round-trip
(§2.2); embedded PNG assets do not (§1.3); CharX assets are exploded onto disk and **never
re-exported** (ST has no `.charx` export — the format switch is `png | json` only, `:1672-1683`).

**The avatar-is-the-card duality is total in ST.** A character IS `characters/<name>.png`; there is
no separate JSON store. `/edit-avatar` reads the chunk out of the old PNG and writes it into the new
image (`characters.js:1158-1166`), and every write goes through `writeCharacterData` → `Jimp` decode
→ `applyAvatarCropResize` → `getBuffer(JimpMime.png)` → chunk re-injection (`:220-320`). **Every
imported card image is therefore re-encoded to PNG and `cover()`-fitted**, with an APNG-shaped
fallback that passes the original bytes through untouched (`tryReadImage:325-336`):

```js
} catch (error) {
    // If it's an unsupported type of image (APNG) - just read the file as buffer
    console.error(`Failed to read image: ${imgPath}`, error);
    return fs.readFileSync(imgPath);
}
```

Risu re-encodes only on PNG export (`characterCards.ts:1250` — `img = type === 'png' ? (await reencodeImage(img)) : img`)
and compresses each asset (`compressImage`) on the way into a chunk.

---

## 3. Security posture in the field

### 3.1 **Importing a card imports CODE — and the gate is one confirm dialog** **[V]**

RisuAI cards carry three distinct executable payloads, and only one of them is gated.

**Ungated** (`characterCards.ts:830-833` for v2, `:931-936` for v3 — identical block):

```js
if(risuext){
    bias = risuext.bias ?? bias
    viewScreen = risuext.viewScreen ?? viewScreen
    customScripts = risuext.customScripts ?? customScripts   // regex scripts — NO prompt
    utilityBot = risuext.utilityBot ?? utilityBot
    sdData = risuext.sdData ?? sdData
}
```

and (`:996`) `triggerscript: data?.extensions?.risuai?.triggerscript ?? []` — **trigger scripts, no
prompt.** Both are re-emitted on export (`createBaseV3:1636, 1641`).

Regex scripts are not cosmetic. Risu's own help text (`src/lang/en.ts:70-89`) lists four modes —
`Modify Input`, `Modify Output`, **`Modify Request Data` ("modifies current chat data when sent")**,
`Modify Display` — plus custom flags `<inject>`, `<move_top>`, `<move_bottom>`, `<order n>`, `<cbs>`.
**A silently-imported regex script can rewrite the outbound request.**

**A CHARX can also smuggle a whole module.** `importCharacterProcess` reads a second zip member as a
Risu *module* and folds its scripts into the card before the importer even sees it
(`characterCards.ts:98-107`):

```js
if(importer.moduleData){
    const md = await readModule(Buffer.from(importer.moduleData))
    card.data.extensions ??= {}
    card.data.extensions.risuai ??= {}
    card.data.extensions.risuai.triggerscript = md.trigger ?? []
    card.data.extensions.risuai.customScripts = md.regex ?? []
    if(md.lorebook){ lorebook = md.lorebook }
}
```

⚠ Note what is **not** copied across: `md.mcp`. See §4.

**Gated** — exactly one capability, behind a modal confirm (`characterCards.ts:915-920`):

```js
if(risuext && risuext?.lowLevelAccess){
    const conf = await alertConfirm(language.lowLevelAccessConfirm)
    if(!conf) return false
}
```

with the string (`src/lang/en.ts:1209-1210`):

> "This content uses Low Level Access. which means this content can access the AI model and your
> storage directly. Do you really want to import this content?"

`lowLevelAccess` is a per-character/per-module boolean that gates a privileged Lua/Python scripting
surface (`src/ts/process/scriptings.ts:73, 1071` — `if(lowLevelAccess){ ScriptingLowLevelIds.add(accessKey) }`),
surfaced as an editor checkbox with a red ⚠ help icon (`CharConfig.svelte:1207-1210`).

**Retired** — one script class was killed outright and the retirement is visible in both directions
(`characterCards.ts:999`, import): `virtualscript: '', //removed dude to security issue` and
(`:1643`, export): `virtualscript: '', //removed dude to security issue`. The editor field survives
with a shouty warning (`src/lang/en.ts:121`):

> "charjs: A javascript code that would run with character. … **CURRENTLY NOT RECOMMENDED FOR USE
> DUE TO SECURITY REASONS. EXPORTING WOULD NOT INCLUDE THIS.**"

**Takeaway for ctrl-b: the field's answer to "cards carry code" is (a) one confirm dialog for the
privileged tier, (b) silent import for the unprivileged tier, (c) a retired tier that is stripped on
both import and export.** Only (c) is actually safe, and it is the one Risu reached for after being
burned.

**ST imports no code.** Its extension namespaces (`extensions.talkativeness`, `extensions.fav`,
`extensions.world`, `extensions.depth_prompt`) are all data (`characters.js:614-625`). **[V, negative]**

### 3.2 Text/HTML sanitisation on import — **nobody sanitises at the boundary** **[V]**

Neither ST nor Risu runs any sanitiser over card *text* during import. Card text goes to disk
verbatim; the defence is entirely at render time.

### 3.3 Sanitisation at render — Risu's DOMPurify config is the reusable artefact **[V]**

`risu/src/ts/parser/parser.svelte.ts:46-118`, three hooks:

- **iframes are allowlisted to one host**: `if (!src.startsWith("https://www.youtube.com/embed/")) return node.parentNode.removeChild(node);`
- **every class is namespaced** to stop card CSS escaping into app styles:
  `return "x-risu-" + v` (except `hljs*` and already-`x-risu-*`).
- **every non-http(s) href is blanked**: `data.attrValue = ''` (kills `javascript:`), http(s) get `target="_blank"`.
- a `hideAllImages` privacy mode swaps external `<img src>` for a placeholder *and* strips
  `background-image: url(...)` out of inline styles.

There is a comment recording a real bypass class they had to work around
(`:798-806`): *"Decoded CSS must never be handed back to the HTML sanitizer as `<style>` text:
DOMPurify drops style nodes whose CSS contains '<' (SAFE_FOR_XML)"*, and a test file
(`src/ts/parser/tests/trimMarkdownStyle.test.ts:95-112`) with cases named "sanitizes markup after a
literal closing style tag", "…smuggled through risu-style hex", "…revealed by a CSS parse error".
**Card-authored markup is an adversarial surface with a live exploit history.**

### 3.4 Size limits, path traversal, CVEs **[V] + [R]**

| Guard | Value | Where |
|---|---|---|
| ST global upload field cap | **500 MB** | `st/src/server-main.js:269` — `multer({ dest: uploadsPath, limits: { fieldSize: 500 * 1024 * 1024 } })` |
| ST per-card / per-asset cap | **none** | — |
| Risu PNG `chara`/`ccv3` chunk cap | **5 MB** (chunk silently dropped above) | `characterCards.ts:180, 186` |
| Risu `data:` asset URI cap | **50 MB** (`alertError('Data URI too large')`) | `:156-161` |
| ST accepted extensions (client) | `.json, image/png, .yaml, .yml, .charx, .byaf` | `public/index.html:6349` |
| ST format dispatch | **`request.body.file_type`, client-supplied** | `characters.js:1558-1581` |

**Zip-slip is explicitly guarded** — ST normalises every CHARX entry path and rejects escapes
(`st/src/util.js:266-289`):

```js
normalized = normalized.replace(/^\.\/+/g, '');
normalized = path.posix.normalize(normalized);
if (!normalized || normalized === '.' || normalized.startsWith('..')) return null;
if (normalized.startsWith('/')) normalized = normalized.slice(1);
```

**CVE-2026-34522 [R]** — path traversal in ST's `/api/chats/import`: an authenticated attacker writes
files outside the chats directory by injecting traversal sequences into `character_name`; fixed in
**1.17.0**. The sibling **CVE-2026-34524 [R]** is the same class via a `..` `avatar_url`. Our pinned
clone (1.18.0) is post-fix. These are *chat* import rather than *card* import, but they are exactly
the class this feature creates: **a name that came out of an untrusted file being used to build a
filesystem path.** ST's card path defends it with double `sanitize()` + `getPngName` (§2.3); the
CHARX asset path defends it with `normalizeZipEntryPath` + `sanitize` on the derived base name
(`charx.js:219-238`). ([advisories.gitlab.com/npm/sillytavern/CVE-2026-34522](https://advisories.gitlab.com/npm/sillytavern/CVE-2026-34522/))

**One more encrypted-container wrinkle [V]:** Risu supports a proprietary encrypted card,
`rcc||rccv1||<b64 ciphertext>||<hash>||<b64 metadata>`, optionally password-protected, decrypted at
import (`characterCards.ts:268-320`). A hash mismatch aborts. Out of scope for us, but it means
"the `chara` chunk is base64 JSON" is not universally true in the wild.

---

## 4. Tools-on-characters: what an imported character gets by default

**Risu — tools are NOT a card-level property. An imported character gets nothing extra. [V]**

Tool availability is the union of enabled *modules*, resolved per-turn from four scopes
(`risu/src/ts/process/modules.ts:398-427`):

```js
export function getModules(){
    let ids = db.enabledModules ?? []
    if (currentChat)                     ids = ids.concat(currentChat.modules ?? [])
    if (character && character.modules)  ids = ids.concat(character.modules)
    if (persona && persona.embeddedModule) ids = ids.concat([persona.embeddedModule?.id])
    if (db.moduleIntergration)           ids = ids.concat(intList)
```

and MCP endpoints come only from those modules (`:505-509`):

```js
export function getModuleMcps() {
    const modules = getModules()
    return modules.map((v) => v.mcp?.url).filter((v) => v)
}
```

`getMCPTools` then exposes **every tool of every reachable server, unfiltered** — there is no
per-tool allowlist anywhere (`src/ts/process/mcp/mcp.ts:231-245`).

**The decisive negative:** `importCharacterCardSpec` never sets `character.modules`
(`characterCards.ts:951-1019` — the field is absent from the constructed object), and the CHARX
module unpack copies only `md.trigger` / `md.regex` / `md.lorebook`, **never `md.mcp`**
(`:98-107`). So **a card cannot bring an MCP server with it**; an imported character inherits
exactly the user's globally-enabled tools and nothing more. That is inherit-global, with
card-originated *widening* structurally impossible.

**open-webui [R]** — the Models editor has a **Tools** binding described as *"Force-enable specific
tools"*, alongside separate toggles for Vision, Web Search, Code Interpreter, Terminal, Image
Generation, and a "Builtin Tools" category control. The docs do not state the default for a newly
created model. The framing ("force-enable") implies the binding is **additive over the user's own
tool access**, not a restriction. **[R, default unstated — a real gap]**

**LibreChat [R]** — Agents have Tools and Skills pickers, plus "Tool Approval settings" in the
advanced section. Docs describe tools as **manually added** ("Add tools" → search the catalog →
select → configure → save), i.e. **a new agent starts with none**. The docs do not state this as a
guarantee. **[R]**

**Field posture, one line:** nobody in this class ships a *card-declared* tool allowlist. The two
observable postures are **inherit-global** (Risu, and open-webui's "force-enable" additive binding)
and **start-empty, opt in by hand** (LibreChat). Nothing in the field argues against ctrl-b
defaulting an imported character to a narrow set; there is simply no precedent either way, because
no card format has a tools field to honour.

---

## 5. Editor form UX — the three roleplay editors

### 5.1 SillyTavern: a **six-item main form** and everything else behind one button **[V]**

`public/index.html:6039-6197` — the entire always-visible character panel, in order:

1. **Name** (`#character_name_pole`, placeholder *"Name this character"*) + token counter
2. **Avatar** (click-to-replace) + a 9-button action row + a "More…" dropdown
3. **Tags** (`#tagInput`, *"Search / Create tags"*)
4. **Creator's Notes** — a **collapsed `inline-drawer`**, rendered **read-only** (`#creator_notes_spoiler`, empty state *"No Creator's Notes provided."*). Editing it lives in Advanced.
5. **Description** (`#description_textarea`, *"Describe your character's physical and mental traits here."*) + token counter
6. **First message** (`#firstmessage_textarea`, *"This will be the first message from the character that starts every chat."*) + token counter + an **"Alt. Greetings"** button (*"Click to set additional greeting messages"*)

Plus `#hidden-divs` carrying `json_data`, `avatar_url`, `chat`, `create_date`, `last_mes`, `world`.

**Everything else is behind `#advanced_div`** — a single book icon, `title="Advanced Definitions"`
(`:6060`) — opening `#character_popup`, titled **"⟨name⟩ - Advanced Definitions"**. Its order
(`:6489-6656`):

| # | Section | Shape | Fields |
|---|---|---|---|
| 1 | **Prompt Overrides** <small>(For Chat Completion and Instruct Mode)</small> | collapsible drawer | Main Prompt, Post-History Instructions |
| 2 | **Creator's Metadata** <small>(Not sent with the AI Prompt)</small> | collapsible drawer | Created by, Character Version, Creator's Notes, Tags to Embed |
| 3 | *(unnamed)* | always open | Personality summary, Scenario, **Character's Note** (+ @ Depth 0–9999, Role system/user/assistant), Talkativeness slider |
| 4 | *(unnamed, after `<hr>`)* | always open | Examples of dialogue |

**The two-section header idiom is the transferable bit**: each drawer's `<h4>` is
`<span>Title</span> <small>(scope caveat)</small>` — *"(For Chat Completion and Instruct Mode)"*,
*"(Not sent with the AI Prompt)"*. **The prompt-vs-metadata distinction of R64 §1.1 is rendered as a
section subtitle**, not a per-field badge.

**Non-obvious fields are explained by placeholder, and the placeholders name the spec field**
(`:6511, 6521`):

> "Any contents here will replace the default Main Prompt used for this character.\n(v2 spec: system_prompt)"

> "Any contents here will replace the default Post-History Instructions used for this character.\n(v2 spec: post_history_instructions)"

with a section-level one-liner above both (`:6505`):

> "Insert {{original}} into either box to include the respective default prompt from system settings."

Other shipped strings worth stealing verbatim:

- Examples of dialogue, sub-heading (`:6644`): *"Important to set the character's writing style."*;
  placeholder (`:6650`): *"(Examples of chat dialog. Begin each example with &lt;START&gt; on a new line.)"*
- Character's Note (`:6600`): *"(Text to be inserted in-chat @ designated depth and role)"*
- Creator's Notes (`:6555`): *"(Describe the bot, give use tips, or list the chat models it has been
  tested on. This will be displayed in the character list.)"*
- Creator's Metadata section note (`:6538`): *"Everything here is optional"*
- Creator (`:6543`): *"(Botmaker's name / Contact info)"*; Version (`:6547`): *"(If you want to track character versions)"*

**Four fields carry a `?` deep-link** to docs.sillytavern.app (`notes-link` spans): Description,
First message, Personality summary, Scenario, Examples of dialogue (`:6149, 6172, 6572, 6584, 6645`).
No tooltips on the prompt-override fields — those rely on the placeholder.

Every long-text field gets an **"Expand the editor"** maximise icon (`editor_maximize`, `data-for="<id>"`).

### 5.2 ST's token counters: declarative, debounced, macro-substituted, with a "permanent" flag **[V]**

Markup is a data attribute pair (`index.html:6044-6046`):

```html
<div class="extension_token_counter">
  <span data-i18n="extension_token_counter">Tokens:</span>
  <span data-token-counter="character_name_pole" data-token-permanent="true">counting...</span>
</div>
```

Driver (`public/scripts/RossAscends-mods.js:203-255`): two delegated `input` listeners
(`#rm_ch_create_block`, `#character_popup`) → `countTokensDebounced()`; the counter walks every
`[data-token-counter]`, resolves the input by id, hashes the value and **skips re-tokenising
unchanged text** (`input.data('last-value-hash')`), guards against interleaving with a
`counterNonce`, and — the load-bearing line —

```js
// We substitute macro for existing characters, but not for the character being created
const valueToCount = menu_type === 'create' ? value : substituteParams(value);
```

**`data-token-permanent="true"` marks the fields that are in EVERY prompt** and feeds a separate
`permanent_tokens` running total. It is set on: name, description, personality, scenario,
depth-prompt. It is **absent** on first message, system_prompt, post_history_instructions and
mes_example — i.e. **the counter itself encodes the "always in context vs situational" distinction**,
which is the same axis a marked-field design needs.

### 5.3 RisuAI: **icon tabs**, and V1 fields hidden behind a global "unrecommended" flag **[V]**

`src/lib/SideBars/CharConfig.svelte`. Seven icon-only tabs (`:236-263`), `$CharConfigSubMenu`:
`0` User (basics) · `1` Smile (display/assets) · `3` Book (lorebook) · `5` Volume (TTS) ·
`4` Braces (scripts) · `2` Activity (**Advanced Settings**) · `6` Share (export/share).

**Tab 0 is three fields**: Character Name, **Character Description** (+ `Help` + token count),
**First Message** (+ `Help` + token count). Chat-scoped Author's Note sits below.

**Tab 2 = "Advanced Settings"** (`language.advancedSettings`), in order (`:1103-1215`):
Bias table → **Example Message** → Creator Notes (multilingual input) → **System Prompt** →
**Global Note Replacement** → Additional Description → *(conditional)* Personality → *(conditional)*
Scenario → Default Variables → Translator Note → Custom Prompt Template Toggle → Creator →
Character Version → **Nickname** → Depth Prompt (depth + text) → **Alternate Greetings** (add/↑/↓/delete table)
→ checkboxes: Low Level Access, Hide Chat Icon, Utility Bot, Escape Output.

⚠ **The one genuinely novel disclosure pattern in the field** (`:1120-1127`):

```svelte
{#if DBState.db.showUnrecommended || DBState.db.characters[$selectedCharID].personality.length > 3}
    <span class="text-textcolor">{language.personality} <Help key="personality" unrecommended/></span>
    <TextAreaInput ... bind:value={...personality}></TextAreaInput>
{/if}
{#if DBState.db.showUnrecommended || DBState.db.characters[$selectedCharID].scenario.length > 3}
    <span class="text-textcolor">{language.scenario} <Help key="scenario" unrecommended/></span>
    ...
```

**A deprecated field is hidden unless (a) the user opted into deprecated settings globally, or
(b) the loaded card already has content in it.** That is exactly the shape an "imported card fields
appear only when populated" design needs, and it ships. The global flag's own help string
(`src/lang/en.ts:131`):

> "If enabled, it will show unrecommended, deprecated settings. It is NOT RECOMMENDED to use these
> settings."

**The per-field marking convention is a one-prop icon swap** (`src/lib/Others/Help.svelte:1-29`):
a `<Help key="…" unrecommended />` button renders a **red `TriangleAlert`** instead of the default
`CircleQuestionMark` (and a red `FlaskConical` for `key === "experimental"`), and on click pops the
help text as markdown (`alertMd(language.help[key])`). One component, three visual states, keyed
into a flat `language.help` string table. That is the cheapest "this field is for X" marking
mechanism I found in any of the five.

Risu's field *names* are its own, and two are better than ST's:
`post_history_instructions` → **"Global Note Replacement"** with help *"If it's not blank, it
replaces current global note to this."* (`en.ts:115, 905`); `system_prompt` → **"System Prompt"**,
*"A prompt that replaces main prompt in settings if its not blank."* (`en.ts:100`). Both help strings
lead with the **replacement semantics**, matching the V2 MUST from R64 §1.1.

The deprecation help strings are blunt (`en.ts:102-103`):

> personality: "A brief description about character's personality. \n\n**It is not recommended to use
> this option. Describe it in character description instead.**"

### 5.4 Agnaistic: **four named tabs**, helper text under every label **[V]**

`web/pages/Character/CreateCharacterForm.tsx:323-324` — `useTabs(['Persona', 'Voice', 'Images', 'Advanced'])`.

**Persona tab** (`:441-607`), each field in its own `<Card>`: Character Name (+ dice randomiser) →
**Description / Creator's notes** with the disclaimer *"A description, label, or notes for your
character. This is will not influence your character in any way."* → Tags → Avatar →
Scenario → **Personality** (a *schema selector* — plain-text vs attribute list — carrying the only
data-loss warning in any of these forms: *"WARNING: \"Plain Text\" and \"Non-Plain Text\" schemas are
not compatible. Changing between them will cause data loss."*) → Greeting + Alternate Greetings →
Sample Conversation.

**Advanced tab** = `form/AdvancedOptions.tsx`, and its helper texts are the clearest `{{original}}`
explanation shipped anywhere (`:20-34`):

> **Character System Prompt (optional)** — "System prompt to bundle with your character. You can use
> the `{{original}}` placeholder to include the user's own system prompt, if you want to supplement
> it instead of replacing it."

> **Character Jailbreak (optional)** — "Prompt to bundle with your character, used at the bottom of
> the prompt. You can use the `{{original}}` placeholder to include the user's jailbreak (UJB), if
> you want to supplement it instead of replacing it."

then **Character Prefill (optional)**, **Insert / Depth Prompt** (*"A.k.a. Author's note. Prompt to
be placed near the bottom of the chat history, **Insert Depth** messages from the bottom."*),
**Insert Depth** (range 0–10, *"Between 1 and 5 is recommended"*), Creator, Character Version.

Note the **placeholders are full worked examples**, not hints — the system-prompt placeholder is a
complete 400-character roleplay preamble, the sample-chat placeholder is
`{{char}}: *smiles and waves back* Hello! I'm so happy you're here!`.

Agnai's token counts are **per-field callbacks** into one aggregate (`tokenCount={(v) => setTokens((prev) => ({ ...prev, greeting: v }))}`)
— same information as ST's, wired through props instead of DOM attributes.

**Agnai's import mapping is the reference for lossy-target normalisation** (`web/pages/Character/port.ts:49-141`).
It has no `personality` field, so V1/V2 `description` and `personality` are **joined with `\n`**:
`text: [[json.description, json.personality].filter(t => !!t).join('\n')]`. It stashes its own
lossless persona structure in `data.extensions.agnai.persona` and — the clever part — **detects when
the card was edited elsewhere and its stash went stale** (`:122-131`):

```
/**
 * Tests, in the case we previously saved the lossless Agnai "Persona" data,
 * whether the card has been edited in another application since then,
 * causing the saved "Persona" data to be obsolete.
 */
const isSavedPersonaMissingOrOutdated =
  json.data?.extensions.agnai?.persona === undefined ||
  formatCharacter(json.data.name, json.data?.extensions?.agnai?.persona) !== json.data.description
```

i.e. **re-render your own structured form back to the spec field and compare; if they diverge, the
spec field is newer and yours is stale.** That is the general solution to "my app has a richer model
than the interchange format".

### 5.5 The user-persona editor **[V]**

**ST** — a dedicated top-level panel, `#persona-management-block` (`index.html:5851-5960`):
left column = searchable/sortable/paginated persona grid + upload; right column = **Current Persona**
(name, rename, **Persona Lore** link, image, duplicate, delete), **Persona Description** textarea
(placeholder *"Example:\n[{{user}} is a 28-year-old Romanian cat girl.]"* — note the bracket idiom)
+ token count, a **Position** select

```html
<option value="9">None (disabled)</option>
<option value="0">In Story String / Prompt Manager</option>
<option value="2">Top of Author's Note</option>
<option value="3">Bottom of Author's Note</option>
<option value="4">In-chat @ Depth</option>
```

with Depth (0–9999) + Role (System/User/Assistant) revealed for mode 4 — and then **Connections**,
three lock buttons that are the whole binding model:

- **Default** — *"Click to select this as default persona for the new chats. Click again to remove it."*
- **Character** — *"Click to lock your selected persona to the current character. Click again to remove the lock."*
- **Chat** — *"Click to lock your selected persona to the current chat. Click again to remove the lock."*

**Persona binding is therefore three-tier: global default → per-character → per-chat**, each an
independent toggle, with a visible list of what is currently bound. There is also a
**"Convert to Persona"** item in the *character* editor's More… dropdown (`index.html:6086`) —
characters and personas are convertible.

**Risu** — `src/lib/Setting/Pages/PersonaSettings.svelte`: a persona list with `id`, name, icon
(+ `largePortrait` toggle) and one description textarea, placeholder
*"Put the description of this persona here.\nExample: [\<user\> is a 20 year old girl.]"* (`:140`).
A persona may carry an `embeddedModule` (`modules.ts:411-413`) — i.e. **the user persona can bring
lorebook/scripts of its own**, the mirror of a character doing so.

**Agnai** — `impersonating`; no dedicated persona manager (R64 §6).

---

## 6. Peer-class contrast at the FORM level — R64 §8 confirmed **[R, docs-only]**

**open-webui, Models editor** — Avatar (*"Upload a custom image. Animated GIF and WebP are
supported"*) · Name and ID · Base Model (*"The actual model that powers this agent"*) · Description
(*"Short summary shown in the model selector"*) · Tags · Visibility · **System Prompt** (one, with
`{{ CURRENT_DATE }}` / `{{ USER_NAME }}` variables) · Knowledge · **Tools** (*"Force-enable specific
tools"*) · Skills · Filters · Actions · capability toggles (Vision, Web Search, Code Interpreter,
Terminal, Image Generation, Usage, Citations, Status Updates, Memory) · Builtin Tools · File
Upload/Context · TTS Voice · **Advanced Parameters (collapsed)** — stop sequences, temperature,
top-p · **Prompt suggestions** (*"Clickable starter chips"*).

**LibreChat, Agent Builder** — Avatar · Name · Description (*"Optional details about your agent's
purpose"*) · **Instructions** (*"System instructions that define your agent's behavior"*) · Model ·
Tools · Skills; collapsed: Model Configuration, Version History, Advanced Settings (Max Agent Steps),
Tool Approval, Handoff, Agent Chain.

**Confirmed at the form level: neither has a greeting field, an example-dialogue field, a
post-history instruction slot, a user-persona editor, or a lorebook.** open-webui's "Prompt
suggestions" is the nearest thing to a greeting and it is **not** a message — it is starter chips.
Both do have progressive disclosure, but they cut it on **inference parameters and orchestration**,
never on prompt content. **The five deltas of R64 §8 hold at the UI layer as well as the data layer.**

Structural contrast worth naming: LibreChat's **Version History** ("inspect and restore saved
configurations") is a feature *no roleplay editor has* — the RP class's answer to versioning is the
card's `character_version` free-text string.

---

## 7. Corrections to premises

1. **"Card data lives in an EXIF field" — false for PNG, true only for WEBP. [V]** The V1 spec's own
   wording ("the 'Chara' EXIF metadata field") is wrong and every implementation reads a PNG `tEXt`
   chunk. V3 fixed the language. The only real EXIF path in the reference class is Agnai's WEBP
   reader (`UserComment`), which no other app implements.

2. **"ST doesn't write V3 chunks" — the comment says so, the code does the opposite. [V]**
   `character-card-parser.js:10` claims *"Writes only 'chara', 'ccv3' is not supported and removed"*;
   `:31-42` writes a `ccv3` chunk on every save. Worse, the "V3" content is the V2 object with two
   strings swapped, and `charaFormatData` stamps `spec: 'chara_card_v2'` on every edit — **ST is a V3
   reader and a V3 *stamper*, not a V3 writer.** Do not treat a ccv3 chunk as evidence the writer
   understood V3.

3. **"Importers normalise to one canonical shape" — ST deliberately keeps two. [V]** Every ST card
   carries a **flat V1 mirror alongside `data.*`** and re-syncs V2→V1 on every read, logging (not
   fixing) divergence. Any tool reading ST-written cards must know that `char.description` and
   `char.data.description` both exist and `data` is authoritative.

4. **"Unknown fields are preserved because the spec says MUST" — only one of the two importers
   complies, and it does so through a hidden form input, not a data model. [V]** ST's preservation is
   `#character_json_data`, a hidden `<input>` round-tripping the raw card through the browser. Risu
   maps into a fixed struct and drops unknown top-level and unknown `data.*` keys. **Neither
   implements the spec's `creator_notes` backfill warning.**

5. **"Importing a card is importing data" — false for RisuAI. [V]** A Risu card silently imports
   regex scripts (including a `Modify Request Data` mode that rewrites the outbound request) and
   trigger scripts, with **no prompt**; a CHARX can smuggle a whole module carrying them. Exactly one
   capability (`lowLevelAccess`) gets a confirm dialog, and exactly one script class (`virtualscript`
   / "charjs") was retired outright and is stripped on both import *and* export. **If ctrl-b imports
   `extensions` verbatim, it should know it may be storing executable payloads authored by strangers.**

6. **"`.charx` is the only zip container" — Risu also ships cards as JPEGs. [V]** `.jpg`/`.jpeg`
   route to the CHARX importer; export type `charxJpeg` writes a JPEG then appends the zip. ST
   tolerates the same shape by scanning for `PK\x03\x04` rather than assuming offset 0. So
   "extension → format" is not a safe mapping, and a magic-byte sniff is the correct discriminator.

7. **"Card assets become the avatar" — they become *four* UI surfaces. [V]** In ST a single CHARX
   import writes into the character PNG (avatar), `characters/{name}/` (the **expression/sprite**
   system, with a hyphen naming convention its regex depends on), `characters/{name}/backgrounds/`,
   and `user/images/{name}/` (the **image gallery**). In Risu, assets become emotion images, macro-
   addressable chat assets (`{{image::name}}`, `{{bg::name}}`), and — via
   `extensions.risuai.backgroundHTML` — **arbitrary markup injected as the chat background.** And per
   `ccv3/SPEC_V3.md:179`, a `user_icon` asset *"SHOULD disable persona feature"* — **a card can
   take over the user's own avatar.** "Import the avatar" is a much bigger surface than it sounds.

8. **"Agnai reads JPEG cards" — its `jpg`/`jpeg` extractors point at the PNG-chunk parser. [V]**
   `card-utils.ts:29-30` maps both to `extractText`, which runs `png-chunks-extract`. That cannot
   work on a JPEG. Recorded as apparently-dead code, not a working path.

---

## 8. Known gaps

- **ST's V3 decorator support** — still unverified, carried over from R64 §1.2. **[U]**
- **open-webui / LibreChat default tool access for a new agent** — neither docs page states it;
  reading their source was out of scope for this pass. **[U]**
- **`.byaf`** (Backyard AI) was read only incidentally; its chat/background/alt-icon import is richer
  than CharX's and was not audited. **[U]**
- **Whether any app writes the spec-mandated "loaded as V2" `creator_notes` warning** — neither ST
  nor Risu does; the other three were not checked. **[U]**
- **Risu's `CharXSkippableChecker` / account-storage dedupe path** (`characterCards.ts:88-125`) —
  read past, not analysed. **[U]**

---

## 9. Implications for ctrl-b — seams only, no decisions

Verified against `backend/app/domain/agent.py`, `backend/app/api/agent.py`,
`backend/app/api/media.py`, `backend/app/core/media.py`,
`frontend/src/components/AgentsEditor.tsx`.

- **The agents CRUD surface already has the right shape for an importer.**
  `GET/PUT/DELETE /agents/{name}` (`api/agent.py:1614, 1626, 1651`) plus the separate
  `GET/PUT /agents/{name}/soul` (`:1664, 1676`) means a card import is *one new POST that composes
  existing writes* — the AgentDef fields via the agent PUT, the persona text via the soul PUT.
  There is no need for a parallel write path.

- **`AgentDef`'s `extra="allow"` is exactly ST's `json_data` trick, done properly**
  (`domain/agent.py:181-189`). ST needed a hidden form input to satisfy the spec's
  preserve-unknown-fields MUST because its model is a fixed schema; ours is not. The seam question is
  whether the *round-trip on export* re-emits those extras — pydantic will carry them, but nothing
  today re-serialises an AgentDef back into a card.

- **`tools: list[str] | Literal["*"] = "*"` defaults to ALL** (`domain/agent.py:212`). The owner's
  "imported characters default to a minimal tool set" therefore means the importer must **write an
  explicit narrow list rather than rely on the default** — the default is the widest possible value.
  §4 says the field gives no precedent to copy (no card format has a tools field), so this is a
  free choice, not a compatibility question. `privilege: Privilege = Privilege.CONFIRM` (`:214`) is
  the second lever on the same axis.

- **The prompt-vs-metadata split of R64 §1.1 needs a UI representation, and the field ships three
  cheap ones.** ST's is a **section subtitle** (`(Not sent with the AI Prompt)`); ST's token counter
  encodes a second axis via `data-token-permanent`; Risu's is a **one-prop icon swap** on a shared
  `Help` component (red triangle = unrecommended, red flask = experimental, `?` = normal) backed by a
  flat string table. `AgentsEditor.tsx` currently uses bare `<label>` + `title=` tooltips
  (e.g. `:260`), so a Risu-style marked-help component would be net-new but small — and the
  **Phase 18 prompt registry is the natural home for the help strings** (R64 §10 already names it as
  the block catalogue).

- **Risu's `showUnrecommended || field.length > 3` predicate is the shipped precedent for "optional
  marked fields"** (`CharConfig.svelte:1120-1127`): a field appears if the user opted in **or the
  loaded object already has content in it**. That is a stronger match for the owner's brief than a
  simple advanced-section toggle, because an imported card lights up exactly the fields it actually
  populated and a hand-made agent stays clean.

- **An imported avatar enters through `PUT /media/{ns}/files/{role}/{filename}`**
  (`api/media.py:267`), with the probe/validation stack already in `core/media.py`
  (`probe_image:750`, `_probe_jpeg:814`, `_probe_webp:957`, `is_served_file:631`).
  `MEDIA_MANAGER_PLAN.md` owns that path — **naming it, not redesigning it.** Two facts from §2.4/§7
  bear on whichever design lands there: the field routes a *single* import into up to four surfaces
  (avatar, sprites, backgrounds, gallery), and CCv3 `user_icon` assets are spec'd to override the
  **user's** avatar. Also note ST re-encodes every imported card image to PNG through Jimp
  (`characters.js:283-320`) — our probe stack already covers the formats CharX admits
  (`png/jpg/jpeg/webp/gif/apng/avif/bmp/jfif`, `charx.js:11`) only partially.

- **The container work is small and self-contained.** A `chara`/`ccv3` tEXt reader is ~30 lines
  (`character-card-parser.js:54-78` is the whole thing); the discriminator ladder is 12
  (`getCharaCardV2:450-461`); CHARX is `zipfile` + `card.json` + a path normaliser we can lift the
  shape of (`util.js:266-289`). The **expensive** parts are the ones §2.4 and §3 describe: assets,
  and the fact that `extensions` may contain executable payloads.

- **`extensions` is where the security question actually lives.** §3.1 is the record that a
  RisuAI-authored card carries regex scripts (one mode of which rewrites the outbound request) and
  trigger scripts with no user prompt. ctrl-b has no scripting surface to execute them, so importing
  them is inert *today* — but `SECURITY_MODEL.md`'s trust boundary is the right lens for whether we
  store a stranger's `extensions.risuai` blob verbatim under `extra="allow"`, and the field's own
  answer to the one class it regretted (`virtualscript`) was **strip on import and on export**, not
  gate.

- **Card text is untrusted markup and the field defends it at render, not at import** (§3.2/§3.3).
  ctrl-b renders agent-authored text through the chat surface already; Risu's DOMPurify config
  (single-host iframe allowlist, `x-risu-` class namespacing, blank every non-http href) plus its
  regression tests are a ready-made checklist if card text ever reaches a markup renderer.

- **Agnai's stale-stash detector is the durable pattern for a richer-than-the-format model**
  (`port.ts:122-131`): render your structured field back into the spec field and compare; if they
  differ, the spec field was edited elsewhere and is authoritative. If ctrl-b ever exports an agent
  as a card *and* re-imports it, that is the round-trip-safety mechanism, and it needs no extra
  storage.

- **The user-persona axis is a three-tier binding in the field** (ST: global default → per-character
  → per-chat, each an independent toggle with a visible bound-list). R64 §10 already flags that
  ctrl-b has no persona object; §5.5 adds that whatever lands will be asked for at more than one
  scope, and that ST ships a **"Convert to Persona"** action treating characters and personas as
  the same substance.
