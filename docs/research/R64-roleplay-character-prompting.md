# R64 — Roleplay-first character/persona prompting: card anatomy, prompt assembly, and the tool-calling reconciliation

**Date:** 2026-09-05 · **Author:** Opus 5 research subagent (bounded single-agent pass)
**Question (owner-directed):** how do roleplay-first LLM frontends structure character/persona
prompting, what formatting actually works, and how does the field reconcile roleplay with
tool-calling / agentic duties?
**Consumer:** the roleplay/persona design talk (open). **Nothing here is a decision** — §10 maps
findings onto ctrl-b seams only.

## Confidence key

- **[V]** verified — I read the source at the pinned SHA, or the shipped default file.
- **[R]** reported — secondary source (docs site, community guide, paper abstract). Not code-verified.
- **[U]** unverified — expected but not checked.

## Sources (pinned)

| Repo | SHA | Branch / version | Clone date |
|---|---|---|---|
| SillyTavern/SillyTavern | `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8` | `release`, `package.json` version **1.18.0**, commit 2026-07-07 | 2026-09-05 |
| malfoyslastname/character-card-spec-v2 | `8083fb388615ccbce768e97cbbd49d2b3214632c` | 2023-06-22 (spec frozen) | 2026-09-05 |
| kwaroran/character-card-spec-v3 | `f3a86af019fbd99f788f7a1155f399655b34ab35` | 2024-07-20 (spec frozen) | 2026-09-05 |
| kwaroran/RisuAI | `c454df882aaf32e02a22da26d3718c8cadc97814` | 2026-09-05 (HEAD, live) | 2026-09-05 |
| agnaistic/agnai | `fccee00f5f7628d150760c787c4be87e6b1a652c` | 2026-06-13 | 2026-09-05 |
| LostRuins/lite.koboldai.net | `66883337de1bbc1ece06965a2c5e29ceb8dca833` | 2026-09-05 (HEAD, live) | 2026-09-05 |

⚠ **ST caveat:** the default branch is `release`; `staging` moves faster. Everything below is the
`release` shape at 1.18.0. Clones live at `~/.cache/ctrl-b-research/{st,ccv2,ccv3,risu,agnai,lite}`
(kept, not deleted — the pass created them).

---

## 1. Card anatomy — what each field is FOR

### 1.1 V1 → V2 → V3 field set **[V]**

V1 (the base, still the wire shape everyone reads first) is six prompt-text strings
(`ccv2/spec_v2.md:32-41`):

```ts
type TavernCardV1 = {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
}
```

V2 nests all of those under `data` and adds (`ccv2/spec_v2.md:46-70`): `creator_notes`,
`system_prompt`, `post_history_instructions`, `alternate_greetings`, `character_book`, `tags`,
`creator`, `character_version`, `extensions`.

**Prompt-text vs metadata is stated normatively in the spec** — this is the single most useful
line-by-line fact for anyone building a card model:

| Field | Prompt text? | Spec language (`ccv2/spec_v2.md`) |
|---|---|---|
| `description` / `personality` / `scenario` / `mes_example` / `first_mes` | **yes** | V1 semantics, "other than being nested inside the `data` property" (`:122-123`) |
| `system_prompt` | **yes, as a REPLACEMENT** | "Frontends' default behavior **MUST** be to replace what users understand to be the 'system prompt' global setting with the value inside this field." (`:139`) |
| `post_history_instructions` | **yes, as a REPLACEMENT** | "Frontends' default behavior **MUST** be to replace what users understand to be the 'ujb/jailbreak' setting…" (`:147`) |
| `alternate_greetings` | yes (swipes) | "Frontends **MUST** offer 'swipes' on character first messages, each string inside this array being an additional 'swipe'." (`:157`) |
| `character_book` | yes (conditional) | "Frontends **MUST** use the character lorebook by default." (`:165`) |
| `creator_notes` | **NO** | "The value for this field **MUST NOT** be used inside prompts… **SHOULD** be very discoverable for bot users" (`:135`) |
| `tags` | **NO** | "This field **SHOULD NOT** be used in the prompt engineering." (`:177`) |
| `creator`, `character_version` | **NO** | "**MUST NOT** be used for prompt engineering." (`:184`, `:190`) |
| `extensions` | app-private | "**MUST** default to an empty object… Applications **SHOULD** namespace any key they use" (`:196-205`) |

**The `{{original}}` contract** is the load-bearing bit for anyone with an existing baked system
prompt (`ccv2/spec_v2.md:141`):

> "Frontends **MUST** support the `{{original}}` placeholder, which is replaced with the 'system
> prompt' string that the frontend would have used in the absence of a character `system_prompt`
> (e.g. the user's own system prompt)."

…and the same for `post_history_instructions` (`:149`). So the spec's answer to "a card wants to
replace my system prompt but I need my technical preamble" is: the CARD opts back in by writing
`{{original}}` — replacement is the default, composition is the card author's choice.

### 1.2 V3 additions **[V]**

V3 (`ccv3/SPEC_V3.md:75-113`) is "a superset of TavernCardV2 … except the fields that are changed
or removed" (`:65`). New fields: `assets[]` (typed icon/background/user_icon/emotion with
`embeded://` / `ccdefault:` URIs, `:161-193`), `nickname` (`:143-145` — "the syntax `{{char}}`,
`<char>` and `<bot>` *SHOULD* be replaced with the value of this field in the prompt instead of the
`name` field"), `creator_notes_multilingual`, `source[]`, `group_only_greetings`, `creation_date`,
`modification_date`. New container formats: **CHARX** (a zip with `card.json` + assets, `:36-59`)
and a `ccv3` PNG tEXt chunk beside the legacy `chara` chunk (`:24-30`).

V3's real substance is the **lorebook decorator system** (`:374-562`) — `@@depth N`, `@@role
assistant|system|user`, `@@position after_desc|before_desc|personality|scenario`, `@@scan_depth`,
`@@activate` / `@@dont_activate`, `@@activate_only_after N`, `@@is_greeting N`,
`@@ignore_on_max_context`, `@@disable_ui_prompt system_prompt|post_history_instructions` — an
in-band `@@name value\n` mini-language embedded in the entry's `content`, with a `@@@fallback`
chain so a card degrades across apps (`:397-416`).

⚠ **V3 adoption is partial.** ST reads/writes `ccv3` chunks (the shipped Seraphina PNG carries
both `chara` and `ccv3` — verified by decoding `default/content/default_Seraphina.png`), but I did
**not** verify decorator support in ST **[U]**. Risu is the spec's own author's app. The V3 spec
repo's last commit is 2024-07-20 — the spec is frozen, not actively evolving.

### 1.3 `mes_example` and `<START>` **[V]**

`<START>` is a **block separator**, not a token the model sees. ST's parser
(`st/public/script.js:3442-3456`):

```js
export function parseMesExamples(examplesStr, isInstruct) {
    if (!examplesStr || examplesStr.length === 0 || examplesStr === '<START>') return [];
    if (!examplesStr.startsWith('<START>')) examplesStr = '<START>\n' + examplesStr.trim();
    const exampleSeparator = power_user.context.example_separator ? `${substituteParams(power_user.context.example_separator)}\n` : '';
    const blockHeading = (main_api === 'openai' || isInstruct) ? '<START>\n' : exampleSeparator;
    const splitExamples = examplesStr.split(/<START>/gi).slice(1).map(block => `${blockHeading}${block.trim()}\n`);
    return splitExamples;
}
```

So: split on `<START>`, then **re-head each block** — with the literal `<START>\n` for
chat-completion/instruct, or with the context template's `example_separator` for plain text
completion (`***` in the Default preset, `This is how {{char}} should talk` in OldDefault). For
chat completion the literal `<START>` is then rewritten again to `{Example Dialogue:}` before the
block is parsed into pseudo-messages (`st/public/scripts/openai.js:647-658`). Examples can be
**pinned** (always sent) or **budgeted** (`count_exm_add`) or **stripped** entirely
(`power_user.strip_examples`, `st/public/script.js:4679-4681`).

KoboldAI Lite does the same normalisation in one line — `examplemsg = "\n"+(/^<START>\r?\n/.test(examplemsg)?"":"<START>\n")+examplemsg;`
(`lite/index.html:11969`).

---

## 2. SillyTavern's prompt assembly, both API modes

### 2.1 Text completion: story string → context template → instruct template → sysprompt **[V]**

Four layers, each a separately-swappable preset:

1. **sysprompt preset** (`default/content/presets/sysprompt/*.json`) — `{name, content, post_history}`.
   `content` is the system prompt; `post_history` is the default "ujb/jailbreak".
2. **context template** (`presets/context/*.json`) — the Handlebars `story_string`,
   `example_separator`, `chat_start`, plus `story_string_position/_depth/_role`.
3. **instruct template** (`presets/instruct/*.json`) — the wrapping sequences
   (`input_sequence`/`output_sequence`/`system_sequence` + suffixes, `story_string_prefix/_suffix`).
4. The card fields themselves.

The story string is rendered with **Handlebars, then a second `{{macro}}` pass**
(`st/public/scripts/power-user.js:2244-2251`):

```js
const compiledTemplate = Handlebars.compile(storyString, { noEscape: true });
let output = compiledTemplate(params);
// substitute {{macro}} params that are not defined in the story string
output = substituteParams(output, params.user, params.char);
```

The parameters handed to it (`st/public/script.js:4644-4660`) are exactly:
`description, personality, persona, scenario, system, char, user, wiBefore, wiAfter, loreBefore,
loreAfter, anchorBefore, anchorAfter, mesExamples, mesExamplesRaw`.

**The modern default story string carries NO labels at all** (`presets/context/Default.json`,
identical in `ChatML.json`, `Llama 4 Instruct.json`, `Story.json`, `Minimalist.json`,
`Adventure.json`):

```
{{#if anchorBefore}}{{anchorBefore}}\n{{/if}}{{#if system}}{{system}}\n{{/if}}{{#if wiBefore}}{{wiBefore}}\n{{/if}}{{#if description}}{{description}}\n{{/if}}{{#if personality}}{{personality}}\n{{/if}}{{#if scenario}}{{scenario}}\n{{/if}}{{#if wiAfter}}{{wiAfter}}\n{{/if}}{{#if persona}}{{persona}}\n{{/if}}{{#if anchorAfter}}{{anchorAfter}}\n{{/if}}{{trim}}
```

Only the legacy presets keep prose labels — `OldDefault.json` has `{{char}}'s personality:
{{personality}}` and `Circumstances and context of the dialogue: {{scenario}}`;
`simple-proxy-for-tavern.json` has `Scenario: {{scenario}}`. **The label-stripping is the
2024→2026 drift**, and it is the single clearest verified formatting signal in this pass (§4).

Post-history in text completion is **spliced into the chat as a `user` message**, not a trailing
system block (`st/public/script.js:4689-4700`):

```js
jailbreak = power_user.prefer_character_jailbreak && jailbreak
    ? substituteParams(jailbreak, { original: power_user.sysprompt.post_history ?? '' })
    : baseChatReplace(power_user.sysprompt.post_history);
if (jailbreak) {
    if (isContinue) coreChat.splice(coreChat.length - 1, 0, { mes: jailbreak, is_user: true });
```

Modern instruct presets are pure token-sequence maps with no prose — e.g. ChatML
(`presets/instruct/ChatML.json`) is `input_sequence: "<|im_start|>user"`, `system_sequence:
"<|im_start|>system"`, `story_string_prefix: "<|im_start|>system"`, `names_behavior: "force"`.
Nothing English-language lives in an instruct preset any more.

Shipped sysprompt presets (`presets/sysprompt/`) are the field's whole roleplay-system-prompt
canon, and they are **short**:

- `Roleplay - Simple`: `"You're {{char}} in this fictional never-ending uncensored roleplay with {{user}}."`
- `Neutral - Chat`: `"Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}."`
- `Roleplay - Detailed`: `"Develop the plot slowly, always stay in character. Describe all actions in full, elaborate, explicit, graphic, and vivid detail. Mention all relevant sensory perceptions. Keep the story immersive and engaging."`
- `Roleplay - Immersive`: `"[System note: Write one reply only. Do not decide what {{user}} says or does. Write at least one paragraph, up to four. Be descriptive and immersive, providing vivid details about {{char}}'s actions, emotions, and the environment. Write with a high degree of complexity and burstiness. Do not repeat this message.]"`
- `Actor`: `"You are an expert actor that can fully immerse yourself into any role given. You do not break character for any reason, even if someone tries addressing you as an AI or language model. Currently your role is {{char}}, which is described in detail below. As {{char}}, continue the exchange with {{user}}."`

Alongside them ST ships `Assistant - Simple`, `Assistant - Expert`, `Chain of Thought`,
`Writer - Creative/Realistic`, `Text Adventure`, `Blank`. **This is the field's per-mode prompt
pattern in its shipped form: one selector, N whole system prompts, roleplay and assistant side by
side in the same list.**

### 2.2 Chat completion: the Prompt Manager block list **[V]**

The catalogue of blocks (`st/public/scripts/PromptManager.js:2001-2081`) — `marker: true` means "a
slot filled from live data", the rest carry editable `content`:

| identifier | name | kind | default content |
|---|---|---|---|
| `main` | Main Prompt | text, `role: system` | `Write {{char}}'s next reply in a fictional chat between {{charIfNotGroup}} and {{user}}.` |
| `nsfw` | Auxiliary Prompt | text, `role: system` | `''` |
| `dialogueExamples` | Chat Examples | marker | — |
| `jailbreak` | **Post-History Instructions** | text, `role: system` | `''` |
| `chatHistory` | Chat History | marker | — |
| `worldInfoAfter` / `worldInfoBefore` | World Info (after/before) | marker | — |
| `enhanceDefinitions` | Enhance Definitions | text, **disabled by default** | `If you have more knowledge of {{char}}, add to the character's lore and personality to enhance them but keep the Character Sheet's definitions absolute.` |
| `charDescription` / `charPersonality` / `scenario` / `personaDescription` | markers | — | — |

**The default order** (`PromptManager.js:2087-2136`) — this is *the* answer to "where does each card
field land":

```
main → worldInfoBefore → personaDescription → charDescription → charPersonality → scenario
→ enhanceDefinitions (disabled) → nsfw → worldInfoAfter → dialogueExamples → chatHistory → jailbreak
```

Note **`jailbreak` (post-history instructions) is LAST — after the whole chat history**. That
placement is the entire point of the field; ST's own docs give the rationale **[R]**
(docs.sillytavern.app/usage/prompts/): *"changing the main prompt has a limited effect on the AI's
responses"* once history exists, "since the AI treats the history as more recent than initial
instructions."

The assembly code (`st/public/scripts/openai.js:1201-1251`) reserves budget in a fixed sequence
first (`worldInfoBefore, main, worldInfoAfter, charDescription, charPersonality, scenario,
personaDescription`), then `['nsfw','jailbreak', ...userRelativePrompts]`, then
`enhanceDefinitions`, then `bias`, then relative extension prompts (`summary`, `authorsNote`,
`vectorsMemory`, `vectorsDataBank`, `smartContext`) injected relative to `main`.

Card overrides land here (`openai.js:1486-1504`):

```js
// Apply character-specific main prompt
const systemPrompt = prompts.get('main') ?? null;
const isSystemPromptDisabled = promptManager.isPromptDisabledForActiveCharacter('main');
if (systemPromptOverride && systemPrompt && systemPrompt.forbid_overrides !== true && !isSystemPromptDisabled) {
    const mainOriginalContent = systemPrompt.content;
    systemPrompt.content = systemPromptOverride;
    const mainReplacement = promptManager.preparePrompt(systemPrompt, mainOriginalContent);
```

— i.e. the card's `system_prompt` replaces the `main` block's content, and the old content is passed
along as the `{{original}}` value. There is a per-block `forbid_overrides` opt-out, and the user
must have opted in at all (`power_user.prefer_character_prompt` /
`prefer_character_jailbreak`, `st/public/script.js:3354-3362`).

Small framing prompts, all user-editable (`openai.js:104-114`):

```js
const default_impersonation_prompt = '[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style of {{user}}. Don\'t write as {{char}} or system. Don\'t describe actions of {{char}}.]';
const default_wi_format = '{0}';
const default_new_chat_prompt = '[Start a new Chat]';
const default_new_group_chat_prompt = '[Start a new group chat. Group members: {{group}}]';
const default_new_example_chat_prompt = '[Example Chat]';
const default_continue_nudge_prompt = '[Continue your last message without repeating its original content.]';
const default_personality_format = '{{personality}}';
const default_scenario_format = '{{scenario}}';
const default_group_nudge_prompt = '[Write the next reply only as {{char}}.]';
```

**`wi_format`, `personality_format` and `scenario_format` all default to the bare value** — again,
labels removed. And every mid-stream nudge is a `[bracketed instruction]`, which is the field's
consistent visual convention for "this is stage direction, not dialogue".

### 2.3 Macros — the load-bearing subset **[V]**

ST's macro registry (`st/public/scripts/macros/definitions/*.js`) exports these names:

```
addglobalvar addvar allChatRange banned char charCreatorNotes charDepthPrompt charDescription
charFirstMessage charInstruction charPersonality charPrompt charScenario charVersion currentSwipeId
date datetimeformat decglobalvar decvar deleteglobalvar deletevar else firstDisplayedMessageId
firstIncludedMessageId getglobalvar getvar group groupNotMuted hasExtension hasglobalvar hasvar
idleDuration if incglobalvar incvar input isMobile isodate isotime lastCharMessage
lastGenerationType lastMessage lastMessageId lastSwipeId maxContext maxPrompt maxResponse
mesExamples mesExamplesRaw model newline noop notChar original outlet persona pick random reverse
roll setglobalvar setvar space systemPrompt time timeDiff trim user weekday
```

The load-bearing subset for card authoring is small: **`{{char}}`, `{{user}}`, `{{persona}}`,
`{{original}}`, `{{group}}` / `{{charIfNotGroup}}`, `{{description}}`/`{{personality}}`/
`{{scenario}}`/`{{mesExamples}}`, `{{charPrompt}}`/`{{charInstruction}}`, `{{random}}`/`{{pick}}`/
`{{roll}}`, `{{if}}`/`{{else}}`, `{{getvar}}`/`{{setvar}}`.** Legacy angle-bracket aliases
`<USER>`, `<BOT>`, `<CHAR>`, `<GROUP>`, `<CHARIFNOTGROUP>` are still honoured
(`st/public/scripts/macros.js:624-628`).

CCv3 standardises a smaller set as **CBS** (`ccv3/SPEC_V3.md:564-605`): `{{char}}`, `{{user}}`,
`{{random:…}}`, `{{pick:…}}`, `{{roll:N}}`, `{{// comment}}`, `{{hidden_key:A}}`,
`{{comment: A}}`, `{{reverse:A}}` — and mandates "the CBS *SHOULD* be detected case insensitive"
and that app-added macros keep the `{{…}}` shape.

`{{original}}`'s implementation is a function slot, not a value
(`st/public/scripts/macros/definitions/env-macros.js:187-194`) — it resolves against whatever the
caller passed as the "what I would have used" string.

---

## 3. World info / lorebooks — enough to judge a v1 seam

**Trigger** **[V]**: an entry activates when one of its `keys` appears in the last `scan_depth`
messages (`ccv3/SPEC_V3.md:275`), with `selective` + `secondary_keys` as an AND-gate (`:302-308`),
`case_sensitive`, and V3's `use_regex` (`:320-324`, keys become regex patterns). `constant: true`
entries always fire. ST additionally scans the character's own definition text — the scan corpus is
built as `chatForWI` plus a `globalScanData` bundle carrying
`{personaDescription, characterDescription, characterPersonality, characterDepthPrompt, scenario,
creatorNotes, trigger}` (`st/public/script.js:4565-4576`).

**Defaults, measured** (`st/public/scripts/world-info.js`):

| setting | default | line |
|---|---|---|
| `world_info_depth` (messages scanned) | **2** | `:69` |
| `world_info_budget` (**percent of max context**) | **25** | `:73`, applied at `:4624` as `Math.round(world_info_budget * maxContext / 100) \|\| 1` |
| `world_info_recursive` | **false** | `:75` |
| `world_info_max_recursion_steps` | 0 (unlimited when recursion on) | `:82` |
| `world_info_min_activations` | 0 | `:70` |
| `DEFAULT_DEPTH` (for `atDepth` entries) | 4 | `:96` |
| `MAX_SCAN_DEPTH` | 1000 | `:98` |

**Insertion positions** (`world-info.js:855-864`) — eight, not two:

```js
export const world_info_position = {
    before: 0, after: 1, ANTop: 2, ANBottom: 3, atDepth: 4, EMTop: 5, EMBottom: 6, outlet: 7,
};
```

`before`/`after` = around the character definitions (the only two V2 knows: `'before_char' |
'after_char'`, `ccv2/spec_v2.md:109`); `ANTop`/`ANBottom` = around the Author's Note; `atDepth` =
injected N messages from the tail with a chosen role; `EMTop`/`EMBottom` = around example messages
(`st/public/script.js:4580-4596` splices WI example blocks into `mesExamplesArray`); `outlet` = a
named slot an extension owns.

**Budget/eviction:** `token_budget` per book, `insertion_order` (lower = earlier), optional
`priority` (lower = dropped first when over budget) — V3 spells out that with no `priority`,
"application *MAY* remove the lowest `insertion_order` lorebook fields first"
(`ccv3/SPEC_V3.md:334`).

**Recursion:** off by default in ST; V3 defines it as "the application *MAY* consider the lorebook
entries as a match if other lorebook entries' `content` field is a match, regardless of
`scan_depth`" (`:284`).

Verdict for a seam judgement: the *minimum viable* lorebook is
`{keys[], content, enabled, insertion_order, constant, position∈{before,after}}` + two global ints
(`scan_depth`, `budget`). Everything else (recursion, selective/secondary, regex, atDepth, decorators)
is a later dimension on the same per-entry object.

---

## 4. Formatting field-wisdom

### 4.1 The strongest verified datum: ST's own shipped card **[V]**

`st/default/content/default_Seraphina.png` carries both a `chara` (V2) and a `ccv3` tEXt chunk.
Decoded, the shipped default character is:

- `description` — **2,851 characters**, and it is **PList + Ali:Chat**, not prose and not W++:

```
[Seraphina's Personality= "caring", "protective", "compassionate", "healing", "nurturing", "magical", "watchful", "apologetic", "gentle", "worried", "dedicated", "warm", "attentive", "resilient", "kind-hearted", "serene", "graceful", "empathetic", "devoted", "strong", "perceptive", "graceful"]
[Seraphina's body= "pink hair", "long hair", "amber eyes", "white teeth", "pink lips", "white skin", "soft skin", "black sundress"]
<START>
{{user}}: "Describe your traits?"
{{char}}: *Seraphina's gentle smile widens as she takes a moment to consider the question…*
```

- `personality`, `scenario`, `mes_example`, `system_prompt`, `post_history_instructions` — **all empty**.
- `first_mes` — **785 characters** of second-person prose mixing `*asterisk action*` and `"quoted speech"`.

So the reference implementation's own reference card:
1. puts **everything in `description`** and leaves the V1 sub-fields empty;
2. uses **bracketed PLists** (`[X's Y= "a", "b"]`) for attributes;
3. embeds the **example dialogue inside `description`** after a `<START>`, in interview
   (Ali:Chat) form, rather than in `mes_example` (where it would be budgeted/strippable);
4. writes the greeting as **third-person-narrating-you prose** with the asterisk/quote convention;
5. uses **no JSON, no W++, no XML tags**.

### 4.2 PList / Ali:Chat — what the community guides actually say **[R]**

ST's own docs page links three guides (docs.sillytavern.app/usage/core-concepts/characterdesign/)
and does not itself rule on format. From those guides:

- **W++ is retracted by its own lineage.** rentry.co/pygtips: *"I apologize for recommending
  Henky!!'s W++ for chatbots. Please forgive me. W++ is no longer good or needed. Do not use it."*
  (with the aside that it was for "retarded ass models like PYG-6B").
- **Ali:Chat** (rentry.co/alichat): *"Ali:Chat's principle idea is using dialogue as the formatting
  to express and reinforce traits/characteristics."* It is a style, not a schema, and it explicitly
  composes: *"can either be used by itself or combined with another style (e.g. Plist, Boostyle,
  W++, etc.)"*. The guide also claims **"The bottom [of Description] has the strongest influence"**
  — a recency claim about the description block itself.
- **PLists, modern compressed form** (rentry.co/kingbri-chara-guide, "MinimALIstic"): a single
  bracketed semicolon-joined list —
  `[Character's persona: traits; Outfit: traits; Body: traits; Genre: genre; Tags: tags; Scenario: scenario]`
  — with two stated rules: **group entries rather than splitting them**, and **"more important
  traits toward the end"**. It recommends putting the **PList in the Character's Note (the depth
  prompt)** and Ali:Chat examples in the Description. It calls the old multi-array PList shape
  wasteful and says "dinkuses are no longer applicable to characters".
- **Token budgets, reported:** kingbri targets **< 600 permanent tokens** total, with Ali:Chat
  examples at **300–600 tokens**. AliCat's worked example allocates ~1000 tokens of character
  context out of 1600. pygtips (2023-era, 2048-context) says keep the card under ~900 tokens.
  ST's docs put it structurally **[R]**: *"If you're working with an AI model with a 2048 context
  token limit, a 1000-token character definition cuts the AI's 'memory' in half"* — and ST turns the
  definition counter red past half the context.

### 4.3 First message / greeting **[R] + [V]**

ST docs: *"An important element that defines how and in what style the character will communicate.
The model is more likely to pick up the style and length constraints from the first message than
anything else."* Corroborated structurally by the shipped Seraphina card **[V]**: `first_mes` is
785 chars and is the only place the prose *voice* is demonstrated at full length (the description's
Ali:Chat examples demonstrate it in miniature).

### 4.4 Markdown / XML usage **[V]**

- Inside character text: **markdown-ish `*action*` + `"speech"`** is the shipped convention
  (Seraphina). Risu's own retired default prompt spells it out: *"Use italics and Markdown for
  actions/emotions… emotions and expression should be inside asterisks"*
  (`risu/src/ts/storage/defaultPrompts.ts:5`).
- Around structural blocks: **the field is split.** ST uses none in its modern defaults.
  **Agnai uses XML-ish tags heavily** — `common/prompt-order.ts:87` wraps the system prompt as
  `<system>…</system>`, `:57` wraps the whole definitions bundle as `<user>{defs}</user>`, and its
  history renders each turn as `<bot>Name: msg</bot>` / `<user>Name: msg</user>`. Risu wraps MCP
  metadata as `<MCP Info>…</MCP Info>` (`risu/src/ts/process/mcp/mcp.ts:326`).
- Stage direction to the model is **`[square brackets]`** in ST (every nudge above,
  `Roleplay - Immersive`'s `[System note: …]`) and **`(parentheses)` / `(OOC: …)`** in Agnai and
  Risu (`agnai/common/mode-templates.ts:22-32`; `risu` OAI preset jailbreak). Both conventions are
  in shipping defaults; neither is dominant.

### 4.5 First-person vs third **[V]**

Every shipped default writes the character in **third person, referred to by `{{char}}`**
(`Write {{char}}'s next reply…`, `{{char}}'s personality:`, `[Seraphina's Personality= …]`). Not one
shipped prompt in ST, Risu, Agnai or Lite says "You are <name>" with a first-person body. The one
"you are" framing that ships is meta-theatrical rather than identity-collapsing: ST's `Actor`
preset — *"You are an expert actor that can fully immerse yourself into any role given… Currently
your role is {{char}}."* Risu's default is even more explicit about the frame:
*"This is role-playing. You play the roles of actor and novelist."*

### 4.6 Where "system-y" instructions go vs character voice **[V]**

The field has settled on a **three-slot separation**, and every one of the four apps implements it:

| slot | ST | Risu | Agnai | Lite |
|---|---|---|---|---|
| operator/system rules | `main` block / sysprompt preset | `plain` item with `type2:'main'` | `system_prompt` holder | prepended to Memory |
| character content | `charDescription` / `charPersonality` / `scenario` markers | `description` item (+ `innerFormat`) | `personality` / `scenario` holders | `Description: … \nPersonality: …` in Memory |
| last-word instruction | `jailbreak` (post-history), **after history** | `jailbreak` item / `globalNote`, + `postEverything` | `ujb`, rendered **inside the bot's opening parenthesis** | `[Special Instructions: …]` in Memory (**does not** move it post-history) |

Agnai's placement is the distinctive one (`common/prompt-order.ts:104`):
`post: '<bot>{{#if ujb}}({{value}}) {{/if}}{{post}}'` — the post-history instruction is delivered as
a **parenthetical at the very start of the assistant's own turn**, i.e. as a prefill, not as a
system message.

---

## 5. Roleplay × agentic duty — the differentiator question

### 5.1 Do roleplay frontends do tool calling? **Three of four do. [V]**

| App | Tool calling | Shape | Shipped tools |
|---|---|---|---|
| **SillyTavern** | yes, `function_calling` setting, Chat Completion only | native OpenAI `tools`/`tool_calls`, `RECURSE_LIMIT = 5` (`tool-calling.js:255`) | **exactly one**: `GenerateImage` from the stable-diffusion extension. Everything else is registered by extensions or by a `/tools-register` slash-command closure. |
| **RisuAI** | yes, a full **MCP client** | native tools, sent on **every** request | `internal:dice`, `internal:fs`, `internal:googlesearch`, `internal:graphmem`, `internal:aiaccess`, `internal:risuai` + arbitrary remote MCP over SSE/stdio/plugin |
| **KoboldAI Lite** | yes, **MCP client + user-defined "custom tools"** | native `submit_payload.tools` | none built in; multi-server MCP + a JSON-schema custom-tool editor |
| **Agnai** | **no** — grep for `tool_calls`/`function_call`/`tools:` across `common/` and `srv/` returns nothing | — | — |

ST's gating (`tool-calling.js:608-621, 682-688`): tool calling requires Chat Completion
(`main_api !== 'openai'` → false), a compatible `custom_prompt_post_processing`, per-source model
capability checks, and is **suppressed for `['impersonate','quiet','continue']`** generation types.
Its docs add **[R]**: *"Continuations, impersonation, background ('quiet') prompts are not allowed
to trigger a tool call."*

**None of the three gates tools on a "roleplay vs assistant mode" switch.** Risu passes
`arg.tools ?? (await getTools())` unconditionally in `requestChatData`
(`risu/src/ts/process/request/request.ts:208, 271`); Lite sends them whenever any MCP server is
active (`lite/index.html:22144-22152`). The only mode-shaped gate anywhere is ST's
generation-*type* exclusion above.

### 5.2 The reconciliation pattern the field actually uses: **the tool server is just another prompt block** **[V]**

Risu's `importMCPModule` registers a remote MCP server as a **module carrying a lorebook entry**
(`risu/src/ts/process/mcp/mcp.ts:317-334`):

```js
db.modules.push({
    name: meta.serverInfo.name,
    description: "MCP from " + x,
    mcp: { url: x },
    id: v4(),
    lorebook: [{
        comment: "MCP Info",
        content: `@@mcp\n\n<MCP Info>Name:${meta.serverInfo.name}\nVersion:${meta.serverInfo.version}\nInst:${meta.instructions ?? 'None'}</MCP Info>`,
        key: '', alwaysActive: true, secondkey: "", insertorder: 0, mode: "normal", selective: false
    }]
})
```

So the operator-side instructions for a tool server ride the **same always-on lorebook channel** as
fiction, wrapped in a distinguishing `<MCP Info>` tag, at `insertorder: 0`. There is **no separate
"operator" system block** — the mechanism is "one more block in the ordered list, marked".

ST's parallel move is the **`stealth` tool flag** (`tool-calling.js:43, 162-183, 348-358`) —
documented as: *"the tool call result is not recorded to visible chat history and no follow-up
generation is triggered"* **[R]**. That is the field's mechanism for keeping tool machinery out of
the *transcript* while still letting the model act.

And ST's in-fiction tool description is worth quoting, because it shows the field writing tool
descriptions in the roleplay register (`st/public/scripts/extensions/stable-diffusion/index.js:5458-5461`):

```js
description: [
    'Generate an image from a given text prompt.',
    'Use when a user asks to generate an image, imagine a concept or an item, send a picture of a scene, a selfie, etc.',
].join(' '),
```

### 5.3 Verified friction: an RP-shaped message model fights multi-step tool loops **[V]**

SillyTavern issue **#4250**, *"[BUG] Tool Calling Fragments a Single AI Turn into Multiple Messages,
Breaking Response Integrity and Regeneration"* (opened 2025-07-09 against 1.13.1, **still OPEN**
after an auto-close and reopen). Reporter:

> "The core issue is that the 'pause -> execute tool -> resume' cycle is not handled within a single
> message stream. Instead, each part of the AI's response before and after a tool call becomes a new
> message in the chat history… A single, coherent thought process from the AI is broken into many
> pieces, destroying the flow of conversation and immersion. Instead of User -> AI (single response),
> the flow becomes User -> AI Part 1 -> AI Part 2 -> AI Part 3…"

> "`stealth: true` is Not a Viable Workaround… this causes the AI's response to be completely
> interrupted after the tool call is made, as the result is never properly returned to the AI to
> continue its generation."

Maintainer **Wolfsblvt**: *"I think this is a pretty rigid structure in SillyTavern and with how
messages work. Will be a big undertaking to rework and restructure that."* A commenter frames it
exactly as this pass's question: *"I understand in the context of being a chat/RP-minded product,
this being a big ask. But with the rise of MCP, agents, and tools, it might be an option which will
be used more and more."* Maintainer **Cohee1207** notes it is handled for OpenRouter and
Custom-OpenAI-compatible under "Interleaved Thinking", unhandled for Gemini (ref #5160).

**Reading:** the friction the field reports is *not* "the persona makes the model call tools badly"
inside ST — it's that a **1 user turn ↔ 1 character message** transcript model (which roleplay UX
requires: swipes, regenerate, edit) cannot represent an assistant turn containing N tool round-trips.
ctrl-b already solved the storage side of this (tool calls + results round-trip inside one assistant
turn, `session.py::_assemble`), so this specific defect class does not transfer — but it is the
reason the ONLY RP frontend with a mature message model has the weakest tool story.

### 5.4 Verified evidence that persona prompting *does* degrade tool calling **[R, primary paper]**

*"Talk Less, Call Right: Enhancing Role-Play LLM Agents with Automatic Prompt Optimization and Role
Prompting"* (arXiv **2509.00482**), submitted to the **Commonsense Persona-grounded Dialogue
Challenge (CPDC) 2025, API track** — a benchmark that is *precisely* "roleplay character + tools".

Abstract: *"This report investigates approaches for prompting a tool-augmented large language model
(LLM) to act as a role-playing dialogue agent in the API track of the Commonsense Persona-grounded
Dialogue Challenge (CPDC) 2025."*

Named failure modes:

- **In-character bias** — *"Agents often respond in persona before invoking a tool, leading to
  missed or delayed calls."*
- **Over-speaking** — *"Overly long in-character responses."*
- **Redundant multi-calls** — *"Weaker prompts may invoke multiple tools in sequence for the same item."*
- **Parameter-key drift** — *"Schema mismatches such as `item_names` vs. `item_name` break execution."*

The winning method is **Rule-based Role Prompting (RRP)**: a *character-card/scene-contract* prompt
(a **Voice** section governing speech + an **Action** section enumerating legal functions and their
invocation conditions) plus a *hard-enforced function-calling* prompt. Its five rules, quoted:

1. **Action-first** — *"If the user mentions or refers to a target item/quest, attempt exactly one
   matching function call before producing any text."*
2. **Single-shot** — *"At most one tool call per turn."*
3. **Defer text** — *"Produce natural-language output only AFTER a tool return, or request
   clarification if arguments are ambiguous."*
4. **Schema-correct** — *"Use exact parameter keys; never invent fields; never call undefined functions."*
5. **Ambiguity** — *"If multiple candidates fit, request disambiguation rather than guessing."*

Scores: baseline 0.519 → role prompt 0.523 → improved role prompt 0.533 → APO-optimized 0.538 →
**RRP 0.571**. Note the ordering: naive persona prompting bought **+0.004**; separating *Voice* from
*Action* into two explicit sections bought **+0.052**.

Broader (weaker, secondary) support **[R]**: *"When 'A Helpful Assistant' Is Not Really Helpful:
Personas in System Prompts Do Not Improve Performances of Large Language Models"* (arXiv 2311.10054)
and *"Expert Personas Improve LLM Alignment but Damage Accuracy"* (arXiv 2603.18507) — the latter
reports personas improving alignment-dependent tasks (writing, roleplay, safety) while degrading
pretraining-dependent ones (MMLU, math, coding). **I read abstracts/summaries only, not the papers.**

### 5.5 Synthesis of the reconciliation patterns actually observed

1. **Separate Voice from Action as two named sections of one prompt** — RRP, verified to win by
   +0.05 on a roleplay+tools benchmark. This is the only *measured* pattern in the pass.
2. **Post-history instructions as the operational last word** — ST/Risu/Agnai all place the
   "obey this now" block after the whole history, on the stated rationale that early instructions
   lose to recency. This is where an "and you still have to actually call the tool" rule belongs.
3. **The tool server's operator text as one more ordered block, tag-marked** — Risu's `<MCP Info>`
   always-active lorebook entry.
4. **`stealth` / hidden tool results** — keep the machinery out of the transcript, at the cost
   (per issue #4250) of the model losing the result.
5. **Per-mode whole system prompts** — ST's sysprompt preset list ships roleplay and assistant
   prompts side by side; switching modes swaps the whole block, it does not merge them.
6. **OOC bracket conventions** — `[System note: …]` (ST) and `(OOC: …)` (Agnai, Risu) as the
   in-band register-shift marker. Nothing enforces it; it is purely a prompt-text convention.

---

## 6. The USER's persona **[V]**

All four RP apps model the user as a first-class object; **no** non-RP peer does (§8).

- **ST**: `power_user.persona_description`, a free-text block, with **five placement modes**
  (`st/public/scripts/personas.js:88-98`): `IN_PROMPT` (0, as the `personaDescription` block),
  `AFTER_CHAR` (1, deprecated), `TOP_AN` (2), `BOTTOM_AN` (3, i.e. folded into the Author's Note),
  `AT_DEPTH` (4, injected N messages from the tail with a chosen role), `NONE` (9). The injection
  (`st/public/script.js:3144-3166`) either prepends/appends it to the Author's Note or sets an
  `IN_CHAT` extension prompt at `persona_description_depth` with `persona_description_role`.
  In the default chat-completion order it sits **third — before the character description**
  (`PromptManager.js:2096-2099`). The persona *name* is separately `{{user}}` / `name1`.
- **Risu**: a `persona` PromptItem type with its own `innerFormat` wrapper and `role2`
  (`risu/src/ts/process/prompt.ts:36-41`), placed by the same ordered template as everything else.
- **Agnai**: `impersonating`, wrapped as `{{user}}'s personality:\n{{impersonating}}`
  (`agnai/common/prompt-order.ts:92`).
- **Lite**: `localsettings.chatname` (name only).
- **CCv3** notes an interaction: if a card ships a `user_icon` asset, *"the application *SHOULD*
  disable persona feature"* (`ccv3/SPEC_V3.md:179`) — i.e. a card may own the user's presentation.

---

## 7. What reaches the wire (chat-completion) **[V]**

For ST's OpenAI-dialect path, the message array is built from the ordered blocks above, and:

**Card fields → `role: system` messages.** `worldInfoBefore/After`, `charDescription`,
`charPersonality`, `scenario`, `impersonate`, `quietPrompt`, `groupNudge` are all constructed as
`{role:'system', content, identifier}` (`openai.js:1365-1377`); `bias` is `role:'assistant'`.

**Example dialogue → pseudo-messages with OpenAI `name` fields.** This is the notable one
(`openai.js:731-741`):

```js
function add_msg(name, role, system_name) {
    let parsed_msg = cur_msg_lines.join('\n').replace(name + ':', '').trim();
    if (appendNamesForGroup && selected_group && ['example_user', 'example_assistant'].includes(system_name)) {
        parsed_msg = `${name}: ${parsed_msg}`;
    }
    result.push({ 'role': role, 'content': parsed_msg, 'name': system_name });
```

called as `add_msg(botName, 'system', 'example_assistant')` / `add_msg(name1, 'system',
'example_user')`. So each example turn goes out as **`{role: "system", name: "example_user" |
"example_assistant", content}`** — the OpenAI few-shot convention — and each example *block* is
preceded by a `{role:'system', content:'[Example Chat]', identifier:'newChat'}` marker
(`openai.js:1099`).

**Greeting → the first assistant message.** `first_mes` is `chat[0]`, is not `is_user`, and role
maps `is_user ? 'user' : 'assistant'` (`openai.js:570`). Lite does the same by string
(`gametext_arr.push("\n"+chatopponent+": "+greeting)`, `lite/index.html:12007`).

**A `[Start a new Chat]` system marker** is inserted at the head of `chatHistory`
(`openai.js:884, 1070`).

**Post-history/jailbreak → a `role:'system'` message AFTER the whole history.**

**Merging is OFF by default.** `squash_system_messages: false` (`openai.js:488`). When enabled
(`openai.js:3827-3858`) it merges only *consecutive* system messages that have **no `name`** and are
not in `['newMainChat','newChat','groupNudge']` — which is precisely why the named
`example_user`/`example_assistant` messages survive as separate turns.

**Names in the history.** `character_names_behavior` (`openai.js:204-209`): `NONE(-1)`,
`DEFAULT(0)` = prefix `Name: ` into content only for groups/forced-avatar, `COMPLETION(1)` = use the
OpenAI `name` field, `CONTENT(2)` = always prefix into content.

**Tools round-trip natively**: an assistant message with `tool_calls` followed by `{role:'tool',
content: invocation.result || '[No content]', ...}` per invocation, inserted into `chatHistory`
(`openai.js:1041-1050`).

**KoboldAI Lite is the minimal contrast [V]** (`lite/index.html:11947-12034`): it flattens the whole
card into ONE "Memory" blob with plain labels and drops the post-history distinction entirely —

```js
let memory = obj.description?("Description: "+obj.description):"";
memory += obj.personality?("\nPersonality: "+obj.personality):"";
if(scenario!="")                  scenario = "\n[Scenario: "+scenario+"]";
if(posthistoryinstructions!="")   posthistoryinstructions = "\n[Special Instructions: "+posthistoryinstructions+"]";
if(examplemsg!="")                examplemsg = "\n"+(/^<START>\r?\n/.test(examplemsg)?"":"<START>\n")+examplemsg;
if(sysprompt!="")                 sysprompt = sysprompt+"\n";
let combinedmem = sysprompt + memory + scenario + posthistoryinstructions + examplemsg;
…
current_memory = combinedmem + "\n***";
```

— then the greeting becomes the first bot message and `character_book` becomes World Info. **That
is the entire minimum-viable card ingestion, in ~15 lines.**

---

## 8. Contrast — how NON-roleplay chat apps model a "character" **[R, docs-only, deliberately shallow]**

- **open-webui** "Models" (docs.openwebui.com/features/workspace/models/): avatar, name/ID,
  description ("Short summary shown in the model selector"), tags, base model, **one system prompt**
  with `{{ USER_NAME }}`/`{{ CURRENT_DATE }}` variables, "Prompt suggestions" ("Clickable starter
  chips that appear when a user opens a fresh chat"), knowledge bases, tools, skills, parameter
  overrides. **No** example dialogue, **no** greeting/first message, **no** user persona.
- **LibreChat**: Presets (model + params + system prompt + tools, importable/exportable JSON,
  now deprecated) → **Agents** (system instructions + tools + files). Same shape: one instruction
  string, no greeting, no examples, no user persona.

**The delta is exactly five things** the RP class has and the assistant class does not:
`first_mes`/`alternate_greetings`, `mes_example`, a **second** instruction slot placed *after* the
history (`post_history_instructions`), a **user** persona, and a keyword-triggered lorebook.
Everything else (name, avatar, description, one system prompt, tools) both classes already have.

---

## 9. Corrections to premises

1. **"Modern cards use labelled sections like `{{char}}'s personality:`" — false for ST's current
   defaults. [V]** Every non-legacy context template ships label-free concatenation, and
   `personality_format`/`scenario_format`/`wi_format` all default to the bare value
   (`openai.js:106, 112-113`). Only `OldDefault` and `simple-proxy-for-tavern` keep labels. **Agnai
   is the counter-example** and keeps labels *and* XML tags — so this is a real split, not a
   consensus. Don't state "the field dropped labels" flatly; state "ST dropped them, Agnai kept
   them, Lite kept them."

2. **"W++ is the SillyTavern card format" — the search engine says yes, the primary sources say no.
   [V]/[R]** Every top web result for "SillyTavern character card format 2026" is from
   `blog.mini-tavern.com` / `tavernsprite.com` — AI-generated SEO content farms that actively
   recommend W++ ("A 200-character system prompt with clear W++ weights outperforms a 1000-character
   novel"). Meanwhile the format's own originating guide retracts it (*"W++ is no longer good or
   needed. Do not use it."*) and **ST's own shipped default card contains zero W++** — it is PList +
   Ali:Chat. ⚠ **Flag for anyone re-running this pass: the roleplay-prompting topic has a badly
   polluted search surface. Go to repos and rentry/wiki primaries, never to blog results.**

3. **"ST has a first-class tool ecosystem" — no. [V]** ST ships **one** function tool
   (`GenerateImage`). Its tool surface is an extension/slash-command registration API, and its
   multi-step tool loop has a known open structural defect (#4250). **RisuAI and KoboldAI Lite,
   not SillyTavern, are the roleplay apps with real agentic plumbing** (both ship MCP clients).
   If the design talk wants "how does an RP app do tools", read Risu, not ST.

4. **"post_history_instructions is a jailbreak field" — it is *named* that internally but it is
   structurally the recency slot. [V]** ST's identifier is literally `jailbreak` and the spec calls
   it "ujb/jailbreak", but its function is "the instruction that must survive a long history", and
   ST's docs justify it on recency grounds, not on content grounds. Its most valuable use for a
   technical/agentic app has nothing to do with content policy.

5. **"The V2 spec is a data format" — it is also a behavioural spec, with MUSTs about prompting.
   [V]** `system_prompt` MUST *replace*; `{{original}}` MUST be supported; supplementing MUST NOT be
   the default. Any card-import feature that merges instead of replacing is spec-non-compliant.

6. **Agnai does not do tool calling at all. [V]** (Recorded negative — grep of `common/` and `srv/`
   for `tool_calls`/`function_call`/`tools:` returns nothing.) The owner's brief listed it as a
   prompt-assembly contrast; it is that, but it is not a data point for the tools question.

---

## 10. Implications for ctrl-b — seams only, no decisions

Verified against `backend/app/services/agent/session.py`, `app/domain/agent.py`,
`app/services/agent/prompts.py`, `app/adapters/inference.py`, `frontend/src/components/ChatThread.tsx`.

- **`AgentDef` is already a card, minus five fields.** It has `name`, `title`, `description`
  (routing summary), `prompt` (SOUL.md), `prompt_append`, `inherit_append`, `model`, `tools`,
  `skills`, `privilege`, and `model_config = {"extra": "allow"}` (`app/domain/agent.py:181-226`).
  The §8 delta lands as optional fields on that ONE object (the 2026-06-24 unified-object
  directive), not as sibling maps: a greeting, example turns, a post-history block, a user-persona
  block, a lorebook. `extra="allow"` means they already round-trip.
- **`prompt` vs `prompt_append` ≠ `system_prompt` vs `post_history_instructions`.** Both ctrl-b
  appends are emitted in the **static head**, before the roster/memory/history
  (`session.py:761-775`). The field's post-history slot lands *after* the history, and §5.5/§2.2
  say that placement is the whole point. There is currently **no tail slot** in `_assemble` other
  than the one-shot `reflection_nudge`. A "post-history" axis would be a new tail emission, not a
  new append.
- **`{{original}}` has a natural home.** ctrl-b's chain is already
  `AgentDef.prompt` → `inference.system_prompt` → `DEFAULT_SYSTEM_PROMPT` (`session.py:576-583`) —
  a strict replacement ladder, exactly the V2 default. `{{original}}` is the spec's mechanism for a
  persona to re-admit the ~1,700-char technical preamble it just displaced, and it costs nothing:
  ctrl-b already owns `_Placeholders(...).safe_substitute` with `{{name}}` tokens and
  leave-literal-on-miss semantics (`app/services/agent/prompts.py:53-81, 515-548`, R32). Today
  `AgentDef.prompt` gets **no** substitution pass at all — that is the seam.
- **The Phase 18 registry is the block catalogue, one level down.** `PROMPTS` already keys 24
  named `PromptDef`s with baked defaults + `prompts:` config overrides + a Conf editor. ST's
  Prompt Manager is the same idea one level up: named *slots* in an *ordered, toggleable list*.
  Anything the roleplay work needs (a `character_intro`, a `post_history`, an `example_preamble`,
  a `new_chat_marker`) is an additive registry entry, not new machinery.
- **The one-system-message wire shape is not a problem — and it is already the RP-safe shape.**
  `normalize_system_messages` (`app/adapters/inference.py:563-600`) coalesces the leading system run
  and re-roles later system messages to `user` inside `<system-update>` tags, position preserved.
  That is *precisely* what a post-history instruction needs (ST sends it as a trailing `system`;
  R42 found 6/7 peers mark it as `user` instead). ⚠ But note the collision with §7: ST's example
  dialogue survives merging *because it carries a `name`*, and ctrl-b's coalescer only preserves
  `name` on a single-message run — a genuine merge drops extras (documented at
  `inference.py:585-589`). Example-dialogue-as-named-system-messages would need to enter the array
  *after* the leading run, not inside it.
- **`first_mes` has a rendering seam but no data seam.** `ChatThread` takes an `emptyState`
  ReactNode (`frontend/src/components/ChatThread.tsx:747, 830`) and each theme supplies its own
  (`FrontierAgent.tsx`, `GachaAgent.tsx`). A greeting is either (a) a rendered-only empty-state
  bubble that never reaches the wire, or (b) a real seeded assistant message — the field does (b)
  (ST's `chat[0]`, Lite's `gametext_arr.push`), and (b) is the one that actually anchors style
  (§4.3). ctrl-b currently has no "seed a message into a new thread" path.
- **Lorebooks would slot at the injected-context layer, not the head.** ctrl-b already injects
  per-turn blocks in the static head (roster, memory, core index, skills note) and already has a
  keyword-ish retrieval subsystem in Core Memory (D57/D64, `core_memory_recall`). A v1 lorebook
  seam is `{keys[], content, enabled, insertion_order, constant, position}` + `scan_depth` +
  `budget` (§3) — and the honest question for the design talk is whether that is a *new* subsystem
  or a `keys[]`-triggered mode on the memory blocks that already exist. (Precedent warning: the
  2026-06-24 directive says don't add a second name-keyed map beside an existing one.)
- **Voice/Action separation maps onto an existing split.** §5.4's measured result is: put speech
  rules and function rules in **two named sections**, and put the "call the tool before you speak"
  rule where it survives recency. ctrl-b's `DEFAULT_SYSTEM_PROMPT` (`session.py:130-150`) is
  ~1,700 chars of pure *Action* — tool routing, no-guessing, batch-the-calls, don't-narrate-progress.
  A persona would supply *Voice*. The paper's finding is that these want to be **two labelled
  sections that both survive**, not one block replacing the other — which is what the current
  replacement ladder does today.
- **ctrl-b does not inherit ST's #4250 defect.** `_assemble` already round-trips `tool_calls` +
  `tool` results inside a single assistant turn (`session.py:778-820`), so the "one AI turn becomes
  N chat messages" fragmentation that blocks agentic RP in ST is structurally absent here. Worth
  saying out loud in the design talk: **on the tools side ctrl-b starts ahead of every roleplay
  frontend in the reference class.** The gap runs the other way — the five card fields of §8.
