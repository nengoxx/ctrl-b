# R42 — System-message shaping in the field: how peer LLM clients handle "one system message, first position only"

**Date:** 2026-08-19
**Reference class:** peer agent/chat clients + the shim layer (LiteLLM · open-webui · LibreChat · opencode ·
Codex CLI · aider · AnythingLLM) and three OpenAI-compat **servers** for contrast (Ollama ·
llama-cpp-python · vLLM). Plus the two dialect specs (OpenAI chat-completions, Anthropic Messages).
**Bounded question:** ctrl-b's prompt assembly emits (a) several **consecutive leading** `system`
messages (cached static head) and (b) occasional **ephemeral tail** `system` messages (reflection /
wrap-up nudges). Qwen3.6's chat template hard-raises on any system message that is not first.
*How does the field actually solve this, in code, and is the fix always-on or per-model?*
**Drove:** (open) — the inference-adapter shaping ruling. No D-entry yet.
**Scope note:** this dossier is **client-side only**. llama.cpp / Qwen template internals were bought
by a parallel pass; nothing here re-derives server template mechanics.

---

## 0. The one-paragraph answer

**Every in-class client normalises to exactly one leading `system` message, and it is unconditional
— not per-model.** 7/7 surveyed clients structurally cannot emit two consecutive leading system
messages on an OpenAI-compat wire; five of them *never construct* multiple system messages in the
first place (their "several sources of system content" are **strings joined with `\n`/`\n\n`**, not
messages), and the two whose pipelines *can* accumulate them run an explicit coalesce step.
**Mid-thread ephemeral instructions are sent as `role: "user"`** in 5–6 of 7, usually folded into the
adjacent user message, and in the one place it is a distinct message it carries a visible marker
(`<system-update>…</system-update>`). A trailing `role: "system"` message is emitted by exactly
**one** project (aider) and **only** under a per-model registry flag whose *default is the user
form*. **Per-model gating exists in the field, but it gates *which* shaping, never *whether* to
normalise.** Servers are the opposite picture: 1/3 normalise (Ollama), 2/3 (vLLM, llama-cpp-python)
pass roles verbatim to Jinja and let the template raise — i.e. ctrl-b cannot expect the server layer
to save it.

---

## 1. Sources, pinned

| Project | Repo | HEAD SHA | HEAD date | How read |
|---|---|---|---|---|
| LiteLLM | `BerriAI/litellm` | `c696fdfb05c2b11d9f7f4d06b23f4e783c85ef54` | 2026-08-19 | shallow clone, source read |
| open-webui | `open-webui/open-webui` | `01f4282f1ffe0d6212f58d3afbeae21fffd0c4be` | 2026-07-27 | shallow clone, source read (+ tag bisect to date the fix) |
| LibreChat | `danny-avila/LibreChat` | `0ab3414c015bb8d4cea781b59f15237864db2239` | 2026-08-18 | shallow clone, source read |
| `@librechat/agents` | npm `3.6.6` (LibreChat's pinned dep) | — | — | `npm pack`, dist CJS read |
| opencode | `anomalyco/opencode` | `da4730e4a41dcbb2cb2d907dd2b06ac481b8f962` | 2026-08-19 | shallow clone, source read |
| Codex CLI | `openai/codex` | `3929c99a97d1aa0fb8000903a4b57b24fbabe742` | 2026-08-19 | shallow clone, source read |
| aider | `Aider-AI/aider` | `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` | 2026-05-22 | shallow clone, source read |
| AnythingLLM | `Mintplex-Labs/anything-llm` | `88e19b6df19d2578337c64faba92b0056cffdec8` | 2026-08-18 | GitHub contents API, one provider read |
| Ollama | `ollama/ollama` | `a5165c53acc5206ce90a684900e0d90b6fb0cb26` | 2026-08-19 | GitHub contents API, source read |
| llama-cpp-python | `abetlen/llama-cpp-python` | `3691546f1c9e0c1bf93323dff02230bd959cf562` (`v0.3.35`) | 2026-08-17 | shallow clone, source read |
| vLLM | `vllm-project/vllm` | `842dd8fd96650063e1ad32e6075742d457d39773` | 2026-08-19 | GitHub contents API, `chat_utils.py` read |

Clones were made under `/home/emma/.cache/tmp/r42` (never `/tmp` — tmpfs) and deleted after the pass.

---

## 2. What the DIALECT actually promises

This decides whether ctrl-b's current assembly is spec-conformant or already off-spec.

### 2.1 OpenAI chat-completions — no positional or cardinality constraint

**VERIFIED** (generated SDK types, `openai/openai-python`,
`src/openai/types/chat/chat_completion_system_message_param.py` and
`chat_completion_developer_message_param.py`, both generated from the OpenAPI spec):

> `ChatCompletionSystemMessageParam` — "Developer-provided instructions that the model should follow,
> regardless of messages sent by the user. With o1 models and newer, use `developer` messages for
> this purpose instead."

> `ChatCompletionDeveloperMessageParam` — "Developer-provided instructions that the model should
> follow, regardless of messages sent by the user. With o1 models and newer, `developer` messages
> replace the previous `system` messages."

`messages` is typed as an ordered array of a union of role-tagged objects. **There is no schema
constraint on how many `system`/`developer` messages appear, nor on their position.** No "must be
first". No "at most one".

**REPORTED** (OpenAI developer-community threads, searched 2026-08-19): the docs never state that
multiple system messages are unsupported; the convention "system first, then alternating user /
assistant" is described as the *typical* format, not a requirement. Community consensus is that the
API accepts multiple and mid-thread system messages and processes them in order.

**⇒ Ruling for ctrl-b: the current assembly (several leading `system` + tail `system`) is
spec-conformant OpenAI chat-completions.** The 400 is *not* ctrl-b violating the dialect — it is
Qwen's chat template imposing a constraint the dialect does not carry. That matters for framing: the
shaping is a **target-compatibility adaptation**, not a bug fix.

**⚠ But conformance is worth little here.** No surveyed client relies on it. The dialect permits it;
the field does not use the permission (§3).

### 2.2 Anthropic Messages — one system *slot*, many system *blocks*

**VERIFIED** (`anthropics/anthropic-sdk-python`, `src/anthropic/types/message_create_params.py`):

> (on `messages`) "Note that if you want to include a system prompt, you can use the top-level
> `system` parameter — **there is no `"system"` role for input messages in the Messages API.**"

> ```python
> system: Union[str, Iterable[TextBlockParam]]
> """System prompt. …"""
> ```

So Anthropic's shape is: **exactly one system slot, which accepts a LIST of text blocks, each able
to carry its own `cache_control`.** This is the load-bearing precedent for ctrl-b's cache motivation
— the field's answer to "I want several separately-cacheable system chunks" is *several blocks in
one system slot*, never several system messages. Two clients implement exactly that (§3.3, §3.4).

---

## 3. Per-project findings

### 3.1 LiteLLM — the reference implementation of "shape per provider", plus a per-model registry flag

LiteLLM is the shim layer, so it shows the whole taxonomy in one repo. **VERIFIED, all source-read.**

**(a) Hoist-all-system-messages-out-of-band** — for every provider whose dialect has a separate
system slot. Applied **always-on**, position-independent (it scans the *whole* list, not just the head):

`litellm/llms/anthropic/chat/transformation.py:1609` `translate_system_message()`:
```python
system_prompt_indices = []
anthropic_system_message_list = []
for idx, message in enumerate(messages):
    if message["role"] == "system":
        system_prompt_indices.append(idx)
        …
        anthropic_system_message_content = AnthropicSystemMessageContent(type="text", text=…)
        if "cache_control" in system_message_block:
            anthropic_system_message_content["cache_control"] = system_message_block["cache_control"]
        anthropic_system_message_list.append(anthropic_system_message_content)
if len(system_prompt_indices) > 0:
    for idx in reversed(system_prompt_indices):
        messages.pop(idx)
```
→ N system messages *anywhere* in the list become N **blocks** in one `system` param, each keeping
its own `cache_control`. This is the §2.2 shape realised.

Same pattern, different target:
- Gemini/Vertex — `litellm/llms/vertex_ai/gemini/transformation.py:1386` `_transform_system_message()`
  → N system messages become N `PartType(text=…)` in `system_instruction`, popped from `messages`.
- Cohere (legacy) — `litellm_core_utils/prompt_templates/factory.py:3073`,
  literally commented `## MERGE CONSECUTIVE SYSTEM CONTENT ##`, string-concatenated.
- Ollama prompt path — `factory.py:188` `_handle_ollama_system_message()`, same `## MERGE CONSECUTIVE
  SYSTEM CONTENT ##` while-loop.

**(b) Downgrade-to-user** — `factory.py:91` `map_system_message_pt()`, the only function in the survey
that implements ctrl-b's proposed "downgrade non-leading system to user":
```python
def map_system_message_pt(messages: list) -> list:
    """
    Convert 'system' message to 'user' message if provider doesn't support 'system' role.
    Enabled via `completion(...,supports_system_message=False)`
    If next message is a user message or assistant message -> merge system prompt into it
    if next message is system -> append a user message instead of the system message
    """
```
Call site — `litellm/main.py:5326`, gated on an explicit kwarg:
```python
if (supports_system_message is not None
        and isinstance(supports_system_message, bool)
        and supports_system_message is False):
    messages = map_system_message_pt(messages=messages)
```

> **⚠ Caution ctrl-b should note before copying this.** Run `[system, system, user]` through it: the
> first system sees a system next → emits `{"role":"user", …}`; the second sees a user next → merges
> into it. Result `[user(sys1), user(sys2 + user)]` — **two consecutive user messages**, which some
> strict templates reject as well. A downgrade that doesn't also coalesce trades one template error
> for another.

**(c) The per-model capability flag** — `litellm/utils.py:2241` `supports_system_messages(model,
custom_llm_provider)` reads a `supports_system_messages` key from
`model_prices_and_context_window.json`. **Measured at HEAD: 646 occurrences of the key; 625 `true`,
20 `false`.** The 20 false: `gemini/gemma-3-27b-it`, two `gemini/lyria-*`, and 17 `gpt-5*-codex`
(incl. Azure variants). Consumed by
`litellm/llms/openai/chat/o_series_transformation.py:147`:
```python
_supports_system_messages = supports_system_messages(model, "openai")
for i, message in enumerate(messages):
    if message["role"] == "system" and not _supports_system_messages:
        messages[i] = ChatCompletionUserMessage(content=message["content"], role="user")
```
**This is the closest thing in the field to ctrl-b's proposed "per-model opt-in".** Note the shape:
a **registry flag on the model**, defaulting to "supported", flipped for a small hand-curated
minority — *not* a user-facing toggle, and *not* per-endpoint.

**(d) When LiteLLM injects its OWN system prompt, it merges rather than prepends a second one** —
`litellm/main.py:5195`:
```python
if litellm_system_prompt:
    messages = add_system_prompt_to_messages(
        messages=messages, system_prompt=litellm_system_prompt, merge_with_first_system=True)
```
and `prompt_templates/common_utils.py:1448` merges into `messages[0]` when it is already `system`
(string-concat, or block-prepend when the content is a list). A deliberate choice not to grow a
second system message.

**(e) The negative — generic OpenAI-compat gets NOTHING.** `litellm/llms/hosted_vllm/chat/` and
`litellm/llms/openai_like/chat/` carry no system-message transform. A llama.cpp-shaped target routed
through LiteLLM as `openai`/`hosted_vllm`/`openai_like` passes messages **verbatim** unless the
caller sets `supports_system_message=False` themselves. **LiteLLM does not solve ctrl-b's problem
out of the box.**

### 3.2 open-webui — the exact problem, named, solved always-on (and it names Qwen)

**VERIFIED.** `backend/open_webui/utils/misc.py:527`:

```python
def merge_system_messages(messages: list[dict]) -> list[dict]:
    """
    Merge all system messages into one at position 0.

    Some chat templates (e.g. Qwen) require exactly one system
    message at the start.  Multiple pipeline stages may each
    insert their own system message; this function consolidates
    them.
    """
    system_contents: list[str] = []
    other_messages: list[dict] = []
    for message in messages:
        if message.get('role') == 'system':
            content = get_content_from_message(message)
            if content:
                system_contents.append(content)
        else:
            other_messages.append(message)
    if not system_contents:
        return other_messages
    merged = {'role': 'system', 'content': '\n'.join(system_contents)}
    return [merged, *other_messages]
```

Call site — `backend/open_webui/utils/middleware.py:2985`, the **last statement of
`process_chat_payload`** before `return`:
```python
    # Merge any duplicate system messages into a single message at position 0
    # to prevent template parsing errors with strict chat templates (e.g. Qwen)
    form_data['messages'] = merge_system_messages(form_data.get('messages', []))
    return form_data, metadata, events
```

**Always-on. Provider-agnostic. Not gated on model, endpoint, or a setting.** It runs for OpenAI,
Ollama, Anthropic, everything. Note the semantics: it is **coalesce-and-hoist-to-front** — mid-thread
system messages are *moved* to position 0, losing their temporal position, not downgraded.

**Dated** (tag bisect via the contents API): absent at `v0.8.10` (2026-03-09), present at `v0.8.11`
(2026-03-25). A recent fix — the field hit this in 2026 and reached for the simplest possible answer.

**How open-webui avoids the problem in the first place** —
`backend/open_webui/utils/misc.py:580` `add_or_update_system_message()` is idempotent at position 0:
```python
if messages and messages[0].get('role') == 'system':
    messages[0] = update_message_content(messages[0], content, append)
else:
    messages.insert(0, {'role': 'system', 'content': content})
```
There are **≥12 call sites** of it in `middleware.py` (model system prompt, memory, code interpreter,
RAG-when-`RAG_SYSTEM_CONTEXT`, …) plus `utils/memory.py:404` and `utils/payload.py:59` — every one of
them lands in the *same single* system message. `merge_system_messages` is the belt to that
suspenders, for pipeline/pipe stages that bypass the helper.

**Mid-thread ephemeral content → the LAST USER MESSAGE, by default.** `middleware.py:857`:
```python
if RAG_SYSTEM_CONTEXT:
    return add_or_update_system_message(await rag_template(...), messages, append=True)
else:
    return add_or_update_user_message(await rag_template(...), messages, append=False)
```
and `backend/open_webui/env.py:368`: `RAG_SYSTEM_CONTEXT = os.getenv('RAG_SYSTEM_CONTEXT', 'False')…`
— **default False**, so the default path prepends retrieved context into the last user message.
Legacy code-interpreter prompting likewise uses `add_or_update_user_message` (`middleware.py:2580`).

**Cache reasoning, in their words** (`middleware.py:2586`, the native-function-calling branch):
> "Appending to the system prompt (instead of the user message) keeps it in the stable cached prefix
> so providers with prefix caching don't re-bill the full conversation on every turn."

i.e. open-webui shares ctrl-b's prefix-cache concern and satisfies it by **appending into the one
system message**, not by keeping several.

**Known bypass:** background tasks (title / tags / follow-up generation) do not go through
`process_chat_payload` (`backend/open_webui/utils/chat.py:218` comment) — but those build their own
single-system-message payloads, so the invariant holds by construction there.

### 3.3 LibreChat + `@librechat/agents` — one system message, and the dynamic tail becomes a **user** message *because of* prompt caching

**VERIFIED** in both halves.

**LibreChat side** — the app never builds a list of system messages. It builds **two strings**:
- `packages/api/src/agents/context.ts:99` `buildAgentInstructions({baseInstructions, mcpInstructions})`
  → `parts.join('\n\n')`.
- `packages/api/src/agents/context.ts:115` `buildAgentAdditionalInstructions({additionalInstructions,
  sharedRunContext})` → `parts.join('\n\n')`. Its doc comment: *"Builds dynamic system-tail
  instructions for an agent."*
- `packages/api/src/agents/run.ts:1428/1430` folds tool context in:
  ```ts
  const systemContent = [toolInstructions, agent.instructions ?? ''].join('\n').trim();
  const additionalInstructions = [dynamicToolInstructions, agent.additional_instructions ?? ''].join('\n').trim();
  ```
- `api/server/controllers/agents/client.js:1812` states the split as policy:
  > "Stable agent/MCP instructions stay on `instructions`; shared runtime context is appended to
  > `additional_instructions` as the dynamic system tail."

Memory context, skill instructions (`packages/api/src/agents/skills.ts:628`), MCP instructions and
subagent handoff context all append to one or the other **string**. **LibreChat's answer to "N
sources of system content" is string concatenation, full stop.**

**Library side** — `@librechat/agents@3.6.6`, `dist/cjs/agents/AgentContext.cjs`. This is the most
directly relevant code found in the whole pass, because it decides *exactly* ctrl-b's question and
does so **for prefix-cache reasons**:

```js
buildSystemRunnable({ stableInstructions, dynamicInstructions }) {
  …
  const promptCacheProvider = this.getPromptCacheProvider();
  const shouldMoveDynamicInstructions =
      promptCacheProvider != null && stableInstructions !== "" && dynamicInstructions !== "";
  const systemMessage = this.buildSystemMessage({ stableInstructions, dynamicInstructions,
                                                  promptCacheProvider, shouldMoveDynamicInstructions });
  …
  return RunnableLambda.from((messages) => {
    const prefix = systemMessage ? [systemMessage] : [];
    const dynamicTail = this.buildPromptCacheDynamicTail({ … });
    let body = this.buildBodyWithPromptCacheDynamicTail(bodyWithSummary, dynamicTail, promptCacheProvider);
    …
    return [...prefix, ...body];
  }).withConfig({ runName: "prompt" });
}
```

Three behaviours fall out:

1. **The default / OpenAI-compat / local path** (`promptCacheProvider == null`) — `buildSystemMessage`
   falls through to its last line:
   ```js
   return new SystemMessage([stableInstructions, dynamicInstructions].filter(p => p !== "").join("\n\n"));
   ```
   **Exactly one SystemMessage. Stable head and dynamic tail joined with `\n\n`.** No second system
   message, no mid-thread system message.
2. **Anthropic / Bedrock prompt caching** — one SystemMessage whose content is a **list of blocks**,
   the stable block carrying `cache_control`, the dynamic block not:
   ```js
   if (promptCacheProvider === "anthropic") {
     const content = [];
     if (stableInstructions) content.push({ type:"text", text:stableInstructions,
                                            cache_control: buildAnthropicCacheControl(...) });
     if (dynamicInstructions && !shouldMoveDynamicInstructions) content.push({ type:"text", text:dynamicInstructions });
     return new SystemMessage({ content });
   }
   ```
   Again: **blocks inside one message**, never two messages.
3. **The dynamic tail moves to `role: user`** when caching is on and both halves are non-empty:
   ```js
   buildPromptCacheDynamicTail({ dynamicInstructions, …, shouldMoveDynamicInstructions }) {
     if (promptCacheProvider == null) return [];
     const dynamicTail = shouldMoveDynamicInstructions ? [new HumanMessage(dynamicInstructions)] : [];
     …
   }
   getPromptCacheDynamicTailIndex(messages, promptCacheProvider) {
     for (let index = lastIndex; index >= 0; index--) if (messages[index].getType() === "human") { … return index; }
     …
   }
   ```
   `HumanMessage` = `role: "user"`. It is inserted at the last human message's index, with cache
   markers applied to the stable prefix before it.

**⇒ LibreChat is the direct precedent for ctrl-b's tail nudges: they become `user`, positioned at
the tail, and the reason is prefix-cache stability — the same reason ctrl-b cites for keeping them
separate.** Note the inversion worth internalising: LibreChat treats "keep the head cacheable" as an
argument for **moving the volatile part OUT of the system message into a user message**, not for
splitting the head into more system messages.

**Legacy client**, for completeness — `api/app/clients/BaseClient.js:464` `addInstructions(messages,
instructions, beforeLast = false)` takes a **single** `instructions` object and places it at index 0
(or, in a path explicitly labelled `// Legacy behavior`, before the last message). Singular by type.
`packages/api/src/agents/responses/service.ts:208` maps inbound `developer` → `system`
("`// Map developer role to system (LibreChat convention)`") — a role *narrowing*, not a merge.

### 3.4 opencode — a first-class "mid-conversation system update" concept, lowered to `user` on 5 of 6 protocols

**VERIFIED.** opencode is the only project that models ctrl-b's case (b) as a named domain concept
and then decides per-wire how to render it. Two layers:

**Layer 1 — request prep (`packages/opencode/src/session/llm/request.ts:57`).** The head is built as
a **one-element array of one joined string**:
```ts
const system = [
  [ ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
    ...input.system,
    ...(input.user.system ? [input.user.system] : []),
  ].filter((x) => x).join("\n"),
]
const header = system[0]
yield* input.plugin.trigger("experimental.chat.system.transform", …, { system })
if (system.length > 2 && system[0] === header) {
  const rest = system.slice(1)
  system.length = 0
  system.push(header, rest.join("\n"))
}
```
Plugins may push more entries via the transform hook; **opencode then collapses back to at most two —
the cacheable header, plus everything else joined.** A head-preserving coalesce, cache-motivated.

**Layer 2 — protocol lowering (`packages/llm/src/protocols/*.ts`).**
- **`openai-chat.ts:294`** — the leading array becomes exactly **one** system message:
  ```ts
  const system: OpenAIChatMessage[] =
    request.system.length === 0 ? [] : [{ role: "system", content: ProviderShared.joinText(request.system) }]
  ```
  (`joinText` = `parts.map(p => p.text).join("\n")`, `protocols/shared.ts:109`.)
- **`openai-chat.ts:303`** — a mid-thread `role: "system"` message is **downgraded to `user`** and
  merged into the preceding user message where possible:
  ```ts
  if (message.role === "system") {
    const part = yield* ProviderShared.wrappedSystemUpdate("OpenAI Chat", message)
    …
    const previous = messages.at(-1)
    if (previous?.role === "user" && typeof previous.content === "string")
      messages[messages.length - 1] = { role: "user", content: `${previous.content}\n${part.text}` }
    …
    else messages.push({ role: "user", content: part.text })
    continue
  }
  ```
- **The marker** (`protocols/shared.ts:115`) — this comment is the design statement of the pattern:
  > ```
  > /**
  >  * Stable fallback representation for chronological `Message.system(...)`
  >  * updates on routes that do not support that privileged role natively. The
  >  * wrapper remains visibly lower-authority user text, preserves the original
  >  * temporal position, and XML-escapes content so it cannot close the wrapper.
  >  */
  > export const wrapSystemUpdate = (parts) =>
  >   `<system-update>\n${escapeSystemUpdateText(joinText(parts))}\n</system-update>`
  > ```
  with `escapeSystemUpdateText` doing `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`. And a second comment
  (line 123) pins a security rule worth stealing verbatim:
  > "Chronological system updates deliberately accept text only. Do not insert raw retrieved, tool,
  > or web content into privileged updates: keep untrusted data in ordinary user/tool messages instead."
- **Same `wrappedSystemUpdate` fallback on 5 routes**: `openai-chat.ts:304`, `openai-responses.ts:354`,
  `gemini.ts:210`, `bedrock-converse.ts:310`, `anthropic-messages.ts:416`.
- **The single native exception** (`anthropic-messages.ts:353`):
  ```ts
  // Mid-conversation system messages are a native Claude API feature only for
  // Opus 4.8. Other Anthropic models intentionally use the same visible wrapped-
  // user fallback as non-Anthropic routes rather than sending a role they reject.
  const supportsNativeSystemUpdates = (request: LLMRequest) => String(request.model.id) === "claude-opus-4-8"
  ```
  guarded further by `canUseNativeSystemUpdate()` (previous must be user/tool/server-tool-use, next
  must be assistant or absent) and `splitsLocalToolResults()` (refuses when it would separate a tool
  call from its result). **That last phrase — "rather than sending a role they reject" — is the
  field's posture in one line.**
- **Anthropic head** (`anthropic-messages.ts:525`) — the array is preserved as separate **blocks** in
  the single `system` param, each with its own `cache_control`, under a 4-breakpoint budget allocated
  "in invalidation order: tools → system → messages". §2.2 realised again.

**⇒ opencode is the precedent for per-*protocol* (not per-model) shaping, and its per-model
exception is a single hard-coded model id used to *enable* the native form — never to decide whether
to normalise.**

### 3.5 Codex CLI — left the dialect entirely

**VERIFIED.** `codex-rs/model-provider-info/src/lib.rs:60` and `:62`:
```rust
const CHAT_WIRE_API_REMOVED_ERROR: &str = "`wire_api = \"chat\"` is no longer supported.\nHow to fix: set `wire_api = \"responses\"` in your provider config.\nMore info: https://github.com/openai/codex/discussions/7782";
pub const LEGACY_OLLAMA_CHAT_PROVIDER_ID: &str = "ollama-chat";
pub const OLLAMA_CHAT_PROVIDER_REMOVED_ERROR: &str = "`ollama-chat` is no longer supported.\nHow to fix: replace `ollama-chat` with `ollama` in `model_provider`, `oss_provider`, or `--local-provider`.…";
```
```rust
pub enum WireApi {
    /// The Responses API exposed by OpenAI at `/v1/responses`.
    #[default]
    Responses,
}
```
**The enum has exactly one variant.** Codex CLI deleted its chat-completions path *including its
local/OSS-model provider* — its answer to the whole class of chat-template role problems is "don't
speak that dialect".

Where it *does* land instructions: `codex-rs/core/src/client_common.rs:30` `Prompt.base_instructions`
is a separate field (→ Responses `instructions`, one string), and turn-scoped context is emitted as
**typed slots** — `codex-rs/ext/extension-api/src/contributors/prompt.rs:4`:
```rust
pub enum PromptSlot { DeveloperPolicy, DeveloperCapabilities, ContextualUser, SeparateDeveloper }
```
resolved in `codex-rs/core/src/session/mod.rs:997` and `:3467`:
- `DeveloperPolicy` + `DeveloperCapabilities` → **coalesced into ONE** `developer` message
  (`build_developer_update_item(developer_sections)`).
- `SeparateDeveloper` → one `developer` message **per section** (deliberately un-coalesced — an opt-out).
- `ContextualUser` → one `user` message (`build_contextual_user_message`).

And `context_manager/updates.rs`:
```rust
pub(crate) fn build_developer_update_item(text_sections: Vec<String>) -> Option<ResponseItem> {
    build_text_message("developer", text_sections) }
pub(crate) fn build_contextual_user_message(text_sections: Vec<String>) -> Option<ResponseItem> {
    build_text_message("user", text_sections) }
```

**⇒ Codex's mid-thread role vocabulary is `developer` and `user` — never `system` — and its default
is to coalesce, with an explicit "separate" slot as the opt-out.** Directly transferable as a design
shape even though the wire differs.

### 3.6 aider — the per-model registry flag that decides *where the tail nudge goes*

**VERIFIED.** This is the closest structural match to ctrl-b's case (b).

`aider/models.py:137,142` — model settings, with defaults:
```python
reminder: str = "user"
examples_as_sys_msg: bool = False
…
use_system_prompt: bool = True
```

`aider/coders/base_coder.py:1318`:
```python
if self.main_model.reminder == "sys":
    chunks.reminder = reminder_message          # [{"role": "system", "content": system_reminder}]
elif self.main_model.reminder == "user" and final and final["role"] == "user":
    # stuff it into the user message
    new_content = final["content"] + "\n\n" + self.fmt_system_prompt(self.gpt_prompts.system_reminder)
    chunks.cur[-1] = dict(role=final["role"], content=new_content)
```
and `aider/coders/chat_chunks.py` `all_messages()` puts `reminder` **last**, after `cur`:
```python
return (self.system + self.examples + self.readonly_files + self.repo
        + self.done + self.chat_files + self.cur + self.reminder)
```

**So aider is the ONE project in the survey that ships ctrl-b's exact shape (b) — a trailing
`role:"system"` message — and it does so only under a per-model flag whose DEFAULT is the user
form.** `reminder = "sys"` is set for a hand-curated list (gpt-4.1, gpt-4.1-mini, 4o-family, …,
`models.py:451/458/496/528`); everything else, including every local/open-weights model, gets
`"user"` and the nudge is folded into the last user message with no extra message at all.

Two more aider mechanisms worth recording:
- **`use_system_prompt = False`** (o1-mini, o1-preview — `models.py:473,480`) → the whole system
  prompt becomes a **user + assistant priming pair** (`base_coder.py:1270`):
  ```python
  chunks.system = [dict(role="user", content=main_sys), dict(role="assistant", content="Ok.")]
  ```
- **Everything else is concatenated into that ONE system string** — `system_prompt_prefix`,
  `examples_as_sys_msg` few-shots (`main_sys += f"## {role.upper()}: {content}\n\n"`), and the
  `system_reminder`. And repo-map / file context are **user+assistant priming pairs**, not system
  messages (`get_repo_messages()` → `[{user: repo_content}, {assistant: "Ok, I won't try and edit
  those files without asking first."}]`).

### 3.7 AnythingLLM — structurally impossible to emit two

**VERIFIED** (`server/utils/AiProviders/localAi/index.js:95`, and the same `constructPrompt` shape is
copy-pasted across ≥10 providers — localAi, liteLLM, textGenWebUI, mistral, deepseek, cohere, xai,
zai, moonshotAi, minimax):
```js
constructPrompt({ systemPrompt = "", contextTexts = [], chatHistory = [], userPrompt = "", attachments = [] }) {
  const prompt = { role: "system", content: `${systemPrompt}${this.#appendContext(contextTexts)}` };
  return [prompt, ...formatChatHistory(chatHistory, this.#generateContent),
          { role: "user", content: this.#generateContent({ userPrompt, attachments }) }];
}
```
One system message, RAG context concatenated into it, then history, then the user turn. There is no
code path that produces a second system message. Zero mid-thread system injection.

### 3.8 The server contrast — do NOT expect the server layer to save you

**Ollama — normalises, hard** (`template/template.go:352`, HEAD `a5165c53`):
```go
// collate messages based on role. consecutive messages of the same role are merged
// into a single message (except for tool messages which preserve individual metadata).
// collate also collects and returns all system messages.
func collate(msgs []api.Message) (string, []*api.Message) {
	var system []string
	var collated []*api.Message
	for i := range msgs {
		if msgs[i].Role == "system" { system = append(system, msgs[i].Content) }
		if len(collated) > 0 && collated[len(collated)-1].Role == msgs[i].Role && msgs[i].Role != "tool" {
			collated[len(collated)-1].Content += "\n\n" + msgs[i].Content
		} else { collated = append(collated, &msgs[i]) }
	}
	return strings.Join(system, "\n\n"), collated
}
```
Called unconditionally at `Template.Execute` (`template.go:258`). **All** system messages, from any
position, are joined with `\n\n` into `.System`; consecutive same-role messages are merged. Ollama's
OpenAI-compat shim (`openai/openai.go`, `fromChatRequest` ~line 553-640) does **no** role
normalisation of its own — it passes roles through and the templating layer does the work. **VERIFIED.**

**llama-cpp-python — no normalisation on the modern path; silent data loss on the legacy path.**
`llama_cpp/llama_chat_format.py:194` `Jinja2ChatFormatter.__call__` renders the GGUF template with
`self._environment.render(messages=messages, …)` — messages passed verbatim, no merge, no reorder;
the template's `raise_exception` fires exactly as it does in llama.cpp. The hand-written legacy
formatters use `_get_system_message()` (line 875) whose docstring is *"Get the first system
message."* and most `_roles` maps (e.g. `format_llama2`: `dict(user="<s>[INST]",
assistant="[/INST]")`) omit `system` entirely — so **second and later system messages are silently
dropped**, not merged. **VERIFIED.**

**vLLM — no normalisation.** `vllm/entrypoints/chat_utils.py` at HEAD: `_postprocess_messages()`
only fixes assistant `tool_calls` argument encoding; grep for merge/consecutive/coalesce/normalize
across the file finds nothing role-related. Roles flow verbatim into `apply_hf_chat_template`.
**VERIFIED.**

---

## 4. The numbers

**Leading run of consecutive `system` messages — what the client emits on an OpenAI-compat wire:**

| Behaviour | Count | Projects |
|---|---|---|
| **Exactly one system message, always** | **7 / 7 clients** | open-webui (explicit `merge_system_messages`), opencode (`joinText` in `openai-chat.ts`), LibreChat/@librechat/agents (`join("\n\n")`), aider (one `main_sys` string), AnythingLLM (structural), LiteLLM (per-provider hoist/merge), Codex (`instructions` string, no chat wire at all) |
| Keeps several separate leading system **messages** | **0 / 7** | — |
| Keeps several system **blocks inside one slot** (for per-block `cache_control`) | **2 / 7**, and only on Anthropic/OpenRouter/Bedrock | LibreChat, opencode. (LiteLLM does the same when *translating into* those dialects.) |

**Mid-thread / tail ephemeral instruction — the role actually sent:**

| Role used | Count | Projects |
|---|---|---|
| **`user`** (folded into the adjacent user message) | **4** | opencode (`openai-chat`, `openai-responses`, `gemini`, `bedrock-converse`, non-Opus Anthropic), aider (`reminder="user"`, the DEFAULT), LiteLLM `map_system_message_pt`, open-webui RAG default |
| **`user`** (own message at the tail) | **2** | LibreChat/@librechat/agents (prompt-cache case), opencode (when there is no preceding user message) |
| **`user` + explicit visible marker** | **1** | opencode `<system-update>…</system-update>`, XML-escaped |
| `developer` | **1** | Codex CLI (Responses only) |
| Hoisted to front as `system`, losing temporal position | **1** | open-webui |
| Trailing `role:"system"` message | **1**, per-model-flag only, non-default | aider `reminder="sys"` |
| Native mid-thread `role:"system"` | **1**, one model id only | opencode, `claude-opus-4-8` |

**Always-on vs per-model gating:**

| Gate | Count | Detail |
|---|---|---|
| **Unconditional** (no model/endpoint check) | **5** | open-webui (provider-agnostic!), LibreChat, AnythingLLM, Ollama, Codex |
| **Per-protocol/provider, unconditional within it** | **2** | opencode (per protocol), LiteLLM (per provider transform) |
| **Per-model registry flag** | **3**, and in every case it selects *which* shape, never *whether* to normalise | LiteLLM `supports_system_messages` (20 false / 646), aider `reminder` + `use_system_prompt`, opencode's `claude-opus-4-8` id check |
| **User-facing toggle** | **0** | nobody exposes this as a setting |

**Servers:** 1/3 normalise (Ollama). 2/3 error through (vLLM, llama-cpp-python) — llama-cpp-python's
legacy path additionally *silently drops* extra system messages.

---

## 5. Implications for ctrl-b (short, and separate from the evidence)

1. **The "coalesce the leading run into one message" half has no dissent in the field — 7/7, and 5 of
   those apply it unconditionally.** open-webui, the closest peer, does it provider-agnostically as the
   last step of its payload pipeline with the docstring naming Qwen. Making this per-model opt-in
   would put ctrl-b alone in the survey. The cheap, field-standard move is to make it unconditional.
2. **The prefix-cache premise for keeping the head split does not survive contact.** Nobody splits
   the *head* into multiple system messages for cache. The two projects that care most about
   prefix-cache stability (LibreChat, opencode) express "separately cacheable chunks" as **content
   blocks inside one system slot**, and only for dialects with per-block `cache_control` (Anthropic /
   Bedrock / OpenRouter). On an OpenAI-compat wire both **join into one string**. Since llama.cpp's
   prefix cache keys on the rendered token prefix, joining a stable head is cache-neutral —
   **UNVERIFIED here** (server-side; the parallel pass owns it) but it is the assumption every peer
   is operating under.
3. **For the tail nudges, `user` is the field answer, 5–6 of 7.** The two variants worth choosing
   between: fold into the last user message (aider default, open-webui, LiteLLM) or emit a distinct
   user message with a visible marker (opencode's `<system-update>`, LibreChat's tail HumanMessage).
   opencode's marker form is the better fit for ctrl-b — it preserves the temporal position (which
   open-webui's hoist-to-front destroys, and ctrl-b's reflection nudge depends on position) and its
   escaping rule is already written down. **A trailing `role:"system"` message is the option with the
   *least* field support (1/7, non-default, per-model).**
4. **Per-model gating, if kept, should follow LiteLLM/aider's shape** — a flag on the *model registry
   entry* selecting a shaping mode, defaulting to the safe form, not a user-facing toggle and not a
   per-endpoint switch. But note that in all three projects the flag selects between two *valid*
   shapes; the baseline normalisation underneath is never gated.
5. **Don't copy `map_system_message_pt` naively** — §3.1(b): its `[system, system, user]` output is
   two consecutive user messages. Coalesce first, then downgrade what remains.
6. **Steal opencode's untrusted-content rule** (`shared.ts:123`): privileged mid-thread updates accept
   text only; retrieved/tool/web content stays in ordinary user/tool messages. ctrl-b's nudges are
   internally generated so this is currently free — worth writing down before it isn't.
7. **Codex's "leave the dialect" answer is not available to ctrl-b** (llama.cpp + OpenRouter both
   speak chat-completions), but its `PromptSlot` vocabulary is a good shape for naming ctrl-b's
   fragments if the assembly ever grows a third kind.

---

## 6. What I could NOT determine

- **Cline / Continue.dev / Kilo Code / goose** — not surveyed. Cline resisted GitHub code search
  (its SDK routes through an internal Anthropic-shaped message type and an AI-SDK-style provider
  layer; `sdk/packages/llms/src/providers/vendors/openai-compatible.ts` at HEAD `98d3e52a` contains
  no `system`/`developer` string at all, which suggests the shaping lives upstream of the vendor
  file, but I did not confirm where). No claim either way.
- **Whether ctrl-b's specific `[system, system, user]` shape actually costs prefix-cache hits on
  llama.cpp** when joined vs split — server-side, out of scope, owned by the parallel pass. Item 2
  above is an inference from peer behaviour, not a measurement.
- **Whether open-webui's `merge_system_messages` was written in response to a specific Qwen report** —
  I dated it to the v0.8.10→v0.8.11 window (2026-03-09 → 2026-03-25) by tag bisect, but did not find
  the originating issue/PR (commit search returned only changelog noise).
- **`@librechat/agents` source** — read from the published CJS dist (`3.6.6`), not from repo source;
  the package is minified-free but the repo was not cloned. Behaviour claims are VERIFIED against
  shipped code, but line numbers refer to dist output, not upstream source lines.
- **LiteLLM's `supports_system_messages` default when a model is absent from the registry** —
  `_supports_factory` behaviour on a miss was not traced; the docstring says it raises for unknown
  models, which would mean the o-series path only ever sees registry-known models. UNVERIFIED.
- **aider is the stalest pin** (HEAD 2026-05-22, ~3 months). Its `reminder`/`use_system_prompt`
  settings have been stable for years, but re-verify before citing as current.

---

## 7. ≤10-line summary

1. **Coalesce-leading-into-one is the dominant convention: 7/7 surveyed clients emit exactly one leading `system` message on an OpenAI-compat wire; 0/7 emit several.**
2. It is **unconditional** in 5 (open-webui, LibreChat, AnythingLLM, Ollama, Codex) and per-protocol/provider in 2 (opencode, LiteLLM) — **no project gates the baseline coalesce on the model**.
3. Most never *construct* multiple system messages at all: their N sources of system content are **strings joined with `\n`/`\n\n`** (LibreChat `instructions`/`additional_instructions`, opencode `system: string[]` → `joinText`, aider `main_sys`, AnythingLLM `constructPrompt`).
4. open-webui is the exact-case precedent: `merge_system_messages()` docstring reads *"Some chat templates (e.g. Qwen) require exactly one system message at the start"*, run **always-on, provider-agnostic**, as the last step of `process_chat_payload` (landed v0.8.11, 2026-03).
5. **Nobody keeps separate leading system MESSAGES for prefix-cache.** The two most cache-conscious peers express separately-cacheable chunks as **blocks inside one system slot**, and only where the dialect has per-block `cache_control` (Anthropic/Bedrock/OpenRouter); on OpenAI-compat wires both join to one string.
6. **Mid-thread/tail ephemeral instructions → `role: "user"` in 5–6 of 7**, usually folded into the adjacent user message; opencode emits it as user text wrapped in `<system-update>…</system-update>`, XML-escaped, *"visibly lower-authority… preserves the original temporal position"*; Codex uses `developer` (Responses only).
7. **A trailing `role:"system"` message — ctrl-b's shape (b) — is shipped by exactly ONE project (aider), only under a per-model flag (`reminder`), and the flag's DEFAULT is the user form.**
8. Per-model gating exists (LiteLLM `supports_system_messages`: 20 false of 646; aider `reminder`/`use_system_prompt`; opencode's `claude-opus-4-8` id check) but in all three it selects *which* shape, never *whether* to normalise; **0/7 expose it as a user setting.**
9. **The dialect is on ctrl-b's side and it doesn't help**: the OpenAI OpenAPI spec places no count/position constraint on `system` messages (so ctrl-b is spec-conformant), yet no peer relies on that permission. Anthropic's spec has *no* `system` role in `messages` at all — one `system` param taking a list of blocks.
10. **Do not expect the server to fix it**: only Ollama normalises (`collate()` joins all system content with `\n\n` and merges consecutive same-role messages); vLLM and llama-cpp-python pass roles verbatim to Jinja and let the template raise — llama-cpp-python's legacy formatters additionally *silently drop* all but the first system message. Codex CLI's answer was to delete its chat-completions wire entirely (`WireApi` now has one variant, `Responses`).
