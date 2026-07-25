# R1 — Model selection from the chat surface, endpoint capability discovery, per-message attribution

**Date:** 2026-07-25 · **Drove:** D48 interpretation call ① (composer-verb scoping); the ROADMAP
model-picker entry · **Status:** evidence, not a decision

Field pass over open-webui, LibreChat, ChatGPT, Claude.ai, Cursor, Continue.dev, Claude Code, Codex
CLI, opencode, goose, aider, AnythingLLM, Jan, LiteLLM, and five OSS Telegram/Discord bots.

---

## 1. Capability discovery — there is no portable probe

**The finding that settles the most:** the OpenAI `GET /v1/models` model object carries **exactly
four fields — `id`, `object`, `created`, `owned_by`**. No capability, type, task, or modality field.
That is the entire standard schema.
([OpenAI list-models reference](https://developers.openai.com/api/reference/resources/models/methods/list))

OpenAI's own list mixes embedding/TTS/Whisper/image models in with chat models. A request to expose
capabilities went unanswered by maintainers; the community workaround is a substring hack —
*"filter models to keep those with 'gpt' in identifier."*
([openai-python #1400](https://github.com/openai/openai-python/discussions/1400) ·
[feature request](https://community.openai.com/t/expose-model-capabilities-in-the-v1-models-api-response/1314117))

**VERIFIED against our own hardware (2026-07-25).** A probe of `http://192.168.1.137:5001/v1/models`
(the `local` llama.cpp router — ctrl-b's *primary chat endpoint*) returned **10 entries including
`Octen-Embedding-0.6B-Q8_0` and `qwen3-reranker-0.6b-q8_0`**. llama.cpp's newer `architecture` field
reports `{input_modalities: ["text"], output_modalities: ["text"]}` for the embedder and the reranker,
**byte-identical to the chat models**; `tags` was `[]` on all ten. A naive capability probe against
our own chat server would therefore offer an embedder and a reranker as chat models.

**VERIFIED — the shapes are indistinguishable across server types.** Speaches' `Model` class emits
`id`, `created`, `object: "model"`, `owned_by` — byte-for-byte the OpenAI chat shape — for Whisper
and Kokoro models. It adds a non-standard `task` field and a `?task=` filter, but no generic client
sends or reads either.
([api_types.py](https://github.com/speaches-ai/speaches/blob/master/src/speaches/api_types.py))

### Where capability info actually lives — never on `/v1/models`

| Server | Capability info? | Endpoint | Field |
|---|---|---|---|
| OpenAI | ✗ | — | — |
| Ollama | ✓ | `POST /api/show` — **native API only** | `capabilities: [completion, tools, insert, vision, embedding, thinking, image, audio]` |
| Ollama (OpenAI-compat) | ✗ | `/v1/models` | `id, object, created, owned_by` only |
| LM Studio | ✓ | `GET /api/v0/models` — **not `/v1`** | `type: llm \| vlm \| embeddings` |
| llama.cpp | partial | `GET /props` — **not `/v1/models`** | `modalities: {vision}`, `chat_template_caps` |
| llama.cpp `/v1/models` | ✗ | — | `meta: {vocab_type, n_ctx_train, n_embd, n_params, size}` — pure geometry |
| LocalAI | declared, **not exposed** | YAML `known_usecases` | `chat, embeddings, tts, transcript, rerank, …`; list endpoint returns ID+Object |
| Speaches | non-standard | `/v1/models?task=` | `task: automatic-speech-recognition \| text-to-speech \| …` |
| OpenRouter | ✓ (superset) | `/api/v1/models` | `architecture.{input,output}_modalities`, `supported_parameters[]` |
| vLLM | ✗ *(reported, not source-verified)* | `/v1/models` | `root, parent, max_model_len, permission[]` — `permission` is legacy authorization scaffolding |

**Pattern: every server that knows its models' capabilities exposes them on a proprietary endpoint
or field. None puts it on `/v1/models` portably.**

Out-of-band catalogs ([models.dev](https://models.dev/api.json) — `modalities`, `tool_call`,
`reasoning`, `limit.context`; HF `pipeline_tag`) answer *"what can `gpt-4o` do"*, **not** *"is this
arbitrary base URL a chat server."* A local Whisper build or a random fine-tune isn't in them at all,
and models.dev itself carries ~141 embedding/TTS entries that opencode does not filter out.

## 2. The dominant pattern — capability is declared by configuration section

**Across every mature app surveyed, not one determines capability by probing.** The section the user
put the URL in *is* the capability declaration.

- **Continue.dev** — the cleanest statement: `roles: [chat, autocomplete, embed, rerank, edit, apply,
  summarize]` (default `[chat, edit, apply, summarize]`), with role-gated sub-objects (`chatOptions`,
  `embedOptions`) on **one unified per-model object — not parallel `chatModels{}`/`embedModels{}`
  maps**. *"only models configured with the `chat` role display in the chat selection dropdown."*
  ([reference](https://docs.continue.dev/reference) · [model roles](https://docs.continue.dev/customize/model-roles/intro))
- **open-webui** — four independent base-URL+model settings by capability: `OPENAI_API_BASE_URLS`
  (chat) · `RAG_OPENAI_API_BASE_URL` (embeddings) · `AUDIO_STT_OPENAI_API_BASE_URL` ·
  `AUDIO_TTS_OPENAI_API_BASE_URL`, surfaced as separate admin tabs. **Decisive proof-point:**
  Speaches' own integration guide tells you to paste your OpenAI-compatible `/v1` URL into the
  **Audio** tab. Same protocol, same path shape as a chat connection — different box entirely.
  ([speaches.ai/usage/open-webui-integration](https://speaches.ai/usage/open-webui-integration/))
- **LibreChat** — chat under `endpoints.custom[]`; STT/TTS in a **separate top-level `speech` block**,
  documented as independent and *not* derived from chat endpoint configuration.
- **AnythingLLM / Jan** — three/N independent provider slots; "Generic OpenAI" chat model typed by
  hand, with an explicit *"you should not use it unless you know what you are doing"* warning.
- **LiteLLM** — makes it a first-class *declared* field: `model_info.mode: chat | embedding |
  audio_transcription | audio_speech | rerank | …`, used to route health probes.
  *(Reported by one pass, flagged unverified by another — treat as directionally right, re-verify
  before citing in a decision.)*

**Where probing exists, it is advisory only** — it populates the dropdown *within* an
already-declared role, and is always backstopped by a name filter, a user-editable allowlist, a
seed to fall back to, and a short dedicated timeout:

- **open-webui**'s only capability filter is a substring denylist (`babbage, dall-e, davinci,
  embedding, tts, whisper`) applied **only when the hostname is `api.openai.com`**. Self-hosted
  endpoints get **no filtering at all**; the escape hatch is a per-connection `model_ids` allowlist
  (when non-empty it doesn't even call `/models`).
- **LibreChat**'s filter is an allowlist regex `(text-davinci-003|gpt-|o\d+|chat-latest)` minus
  `audio|realtime`, again **only for the official OpenAI base URL**. Custom endpoints take the raw
  id list verbatim: `models = input.data.map((item) => item.id)`.
- **aider** is the one tool that hard-filters on a declared capability — drops any litellm entry
  where `mode != "chat"` (699 of 2,984). **But the filter leaks:** tab-completion bypasses it, so
  `/model text-embedding-3-small` completes happily and fails at the API.

### Implication for ctrl-b (our reading, ages faster than the evidence)

A11/D48 already implements the industry-dominant structure: a `providers:` map of connections plus
role-specific consumer sections (`inference`, `voice.stt`, `voice.tts`, `embeddings`). That is
open-webui's four tabs and LibreChat's `speech` split by another name. **Do not add a probe-based
capability check**, and do not fold role into `api_mode` (the dialect axis) — where the field models
capability explicitly it is a *separate declared field alongside* the dialect, never fused into it.

## 3. Model switching UX

### Placement — composer-adjacent has won outright

ChatGPT **moved** its picker from the header into the composer (*"Model selection now appears in the
composer, so you can find and switch models from the same place where you write your prompt"*);
Claude.ai puts model + effort + thinking next to send; Cursor sits below the input; Continue above it.
Only open-webui and LibreChat keep a header selector. **The picker is no longer one control** — budget
for a cluster of 2–3 (model + effort + routing policy).

### Scope — forward-only, universally

Nobody rewrites history. The conversation record holds a *current-selection pointer* that gets
overwritten; prior turns are re-sent in full to the newly selected model.

**Claude.ai is the cautionary tale worth knowing: it shipped fork-a-new-chat on switch, then
abandoned it for continue-in-place.** Current docs: *"You can change the model, effort level, or
thinking setting at any point in a conversation. Changes apply starting with Claude's next response."*
Former docs: *"switching Claude's model will open a new chat."*
([support.claude.com/8664678](https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings))

LibreChat's `modularChat` toggle is the honest admission that cross-provider mid-thread switching
isn't free: the default is to start a new conversation; continuing in place is opt-in.

### Mid-stream — allowed everywhere it was checkable

open-webui (no `done === false` guard), LibreChat (no `isSubmitting` guard), Codex (`Model` is
explicitly in `available_during_task()`), Claude Code (*"applies without waiting for the current
response to finish"*). Two refinements worth stealing:

- **Claude Code confirms first** when the conversation has prior output, *"since the next response
  re-reads the full history without cached context"* — i.e. the switch invalidates the prompt cache.
- **LibreChat has shipped real bugs from mid-run switches** ([PR #13697](https://github.com/danny-avila/LibreChat/pull/13697):
  in-place modular switches silently dropped ephemeral MCP selections while the badge still showed
  them). **Argues for per-run frozen state rather than read-at-submit** — which is exactly the
  per-call snapshot pattern ACA Slice 7 already landed.

### Per-message attribution — the load-bearing schema decision

| App | Stored per message? | Field |
|---|---|---|
| open-webui | ✓ | `model`, `modelName`, `modelIdx` (+ user msg carries `models: []`) |
| LibreChat | ✓ | `Message.model` + `Message.endpoint` |
| ChatGPT | ✓ | `metadata.model_slug` **and** `metadata.default_model_slug`, plus conversation-level `default_model_slug` |
| opencode | ✓ | `Assistant.model` + a first-class **`model-switched`** transcript event |
| Claude Code | ✓ | `message.model` in the session JSONL |
| Codex | ✓ | `TurnContextItem.model` per turn |
| goose | optional | `InferenceMetadata {provider, requested_model, resolved_model}` |
| Claude.ai | **✗** | export has one *nullable* conversation-level `model` |
| Cursor | ✗ (in UI) | routing recorded in local SQLite, never surfaced — staff-confirmed |
| aider | ✗ | chat history `.md` has no model field |
| OSS bots (5) | ✗ | best is dialog-level |

**Claude.ai is the counter-example to avoid:** the UI now switches mid-thread *and* renders
per-response model labels, but the export schema can represent neither — attribution you can see but
cannot recover. **Retrofitting per-message model is expensive; the column is cheap on day one.**

**Show the badge only where it carries information.** Claude.ai badges a response only when the
answering model *differs from the one requested* (its safety-classifier re-route). That reads better
than badging every bubble (open-webui) or recording it and showing nothing (Cursor).

### Two smaller transferable rules

- **Scope the selection to the conversation, not globally.** Cursor's global selection is a
  repeatedly-filed, never-answered complaint (*"changing the selected model changes across all chat
  tabs"*).
- **Keep mode and model orthogonal.** Continue uses separate shortcuts; Cursor's mode selector
  clobbering the model selection is an open bug. ctrl-b's `/agent` vs `/<provider>` split already
  gets this right.

## 4. Corrections to premises we held

- **goose's `GOOSE_LEAD_MODEL` / lead-worker feature no longer exists** — zero hits in current Rust
  source and the env-var reference; one stale mention in an archived June-2025 blog post. Current
  roles are `GOOSE_MODEL`, `GOOSE_FAST_MODEL`, `GOOSE_PLANNER_*`. D43's routing design cited this as
  a *retreat*, which remains correct, but any doc phrasing implying the feature is live is wrong.
- **`karfly/chatgpt_telegram_bot` now redirects to `father-bot/chatgpt_telegram_bot`.**
- **"Reset context on model switch" is not the norm** — 1 of 5 bots, and only because it forks the
  dialog unconditionally. The system prompt is part of the context; the model is not.
- **False claim in circulation:** aggregator blogs assert ChatGPT *"enforces a single model per chat
  thread… making native mid-conversation switches impossible."* Contradicted by OpenAI's own Help
  Center and by per-message `model_slug`. Those sites market competing multi-model products.

## 5. Open items (not bought)

- **Streaming/in-flight picker behavior for ChatGPT / Claude.ai / Cursor / Continue** is undocumented
  across all four — test empirically rather than cite.
- **LiteLLM `model_info.mode`** — reported by one pass, explicitly flagged unresearched by another.
  Re-verify before a decision leans on it.
- **vLLM `/v1/models` field list** — corroborated from docs and deployment writeups, not from the
  `ModelCard` class definition (source moved; fetch 404'd).
