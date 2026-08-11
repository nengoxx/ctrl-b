# R27 — Peer-class: how agent apps expose their INTERNAL prompts for editing

> **Question asked:** ctrl-b handles its main agent system prompt well (3-level chain + Conf UI +
> restore-to-default) but bakes ~12 other model-facing prompts into Python with no config, no UI and
> no way to even *see* them. How do peer projects expose the *secondary* prompt class — the
> summarizer, the steering nudges, the injected context framing — and do any of them let you edit
> **tool parameter descriptions**?
>
> **Date:** 2026-08-11 · **Method:** main-session (Opus, high) web research against primary docs +
> issue trackers. Reference class per the README: opencode · goose · LibreChat · open-webui · aider,
> plus the MCP-proxy tooling for the parameter-description half.
> **Drove:** [`../PROMPTS_AUDIT.md`](../PROMPTS_AUDIT.md) — the §5 shape proposal (open).

---

## 1. The evidence table

| Project | Main prompt | **Secondary/internal prompts** | Mechanism | Confidence |
|---|---|---|---|---|
| **goose** (Block) | `system.md` | ✅ **the whole class** — 10 templates incl. `compaction.md`, `subagent_system.md`, `session_name.md`, `permission_judge.md`, `plan.md`, `recipe.md`, `tiny_model_system.md` | drop a file named after the built-in into `~/.config/goose/prompts/`; **full replacement**; Jinja2 (`{{ extensions }}`, `{% if %}`, `{% for %}`) | verified (docs) |
| **LibreChat** | agent prompt | ✅ `summarization.prompt` + `summarization.updatePrompt` (initial fold vs re-fold) | YAML block per subsystem in `librechat.yaml`, beside `provider`/`model`/`parameters`/`trigger` | verified (docs) |
| **open-webui** | model system prompt | ✅ ~7 "task model" prompts — title · tags · retrieval query · web-search query · autocomplete · tools function-calling | one config entry **per prompt**, each with an env var (`*_PROMPT_TEMPLATE`) **and** an Admin → Settings → Interface field; `{{MESSAGES}}` selectors | verified (docs + issues) |
| **opencode** | agent `prompt`, incl. `{file:path}` substitution; `instructions` glob array | ❌ **none documented** — no override for its own summarization/compaction/title prompts | config file pointer | verified (docs) |
| **aider** | ❌ **refused by design** (issues #249, #895, #1258, #3364 all ask; none granted) | ❌ — one exception, `AIDER_COMMIT_PROMPT` env for the commit-message prompt | sanctioned path = a *conventions file* (append), not replacement | verified (docs+issues) |
| MCP proxy tooling (glama, mcpify, gitlab-mcp) | — | — | tool **description** override is common (`toolOverrides: {tool: {description}}`, `GITLAB_TOOL_{NAME}` env, per-tool UI field) | reported |

## 2. The load-bearing findings

**① Nobody exposes one prompt and stops — the class gets exposed together.** goose ships 10
overridable templates; open-webui exposes 7 task prompts. Our current state (main prompt fully
handled, ~12 siblings invisible) is precisely the shape both projects moved *away from*. This is the
strongest argument that the gap is real and not a matter of taste.

**② Full replacement is the universal semantic. Nobody merges or patches a prompt.**
goose: *"User files completely replace defaults… Changes to defaults in the codebase don't affect
your customized templates."* LibreChat, verbatim: *"Custom `prompt` and `updatePrompt` values fully
replace the built-in prompts — use with care."* Both pair replacement with an explicit warning —
goose: *"Be careful when modifying template variables, as incorrect changes can break functionality.
Test your changes in a new session."*

⚠ **Replacement has a documented cost neither project hides:** an overridden prompt is **frozen at
the version you copied**. goose says it plainly — upstream improvements never reach you again. This
is the single biggest argument for keeping an **append** axis beside any replace axis (which ctrl-b
already has for the main prompt, and aider treats as *the* answer).

**③ Once you expose an ASSEMBLED prompt you must ship templating.** goose uses Jinja2; open-webui
uses `{{MESSAGES}}` with selectors (`{{MESSAGES:END:6}}`, `{{MESSAGES:START:2}}`,
`{{MESSAGES:MIDDLETRUNCATE:6}}`). Directly relevant: several ctrl-b prompts interpolate live values
(`_reflection_nudge()` bakes in `reflection_interval` and gates a clause on `state_enabled`;
the per-tool-cap nudge interpolates the tool name and count). Exposing those *as plain strings*
would silently drop the interpolation.

**④ "Show me the default" is the unsolved UX problem across the field — and ctrl-b already solved
it.** open-webui has been asked twice (Discussion #7024, Issue #14173, the latter naming all seven
prompts). #7024 got no maintainer resolution; the community workaround is literally *"you can search
for `GENERATION_PROMPT_TEMPLATE` in the config.py and copy and customize the prompt there."* #14173
is closed with no implementation, and asked for exactly this:

> *"I'd like to tweak the behavior of the task model sometimes, but I don't want to lose the core
> functionality that's already there from the default prompts."* — proposing *"a modal that exposes
> the prompts with a 'copy' button next to each so the user can easily override them."*

**ctrl-b's `GET /api/agent/default-prompt` (serving the baked text so the UI can offer *Load default*
/ *Restore default*) is the thing the field keeps asking for and not building.** We are ahead here.
Generalizing that ONE endpoint to the whole prompt class is the cheapest high-value move available.

**⑤ Addressing key: file name (goose) vs config key (LibreChat/open-webui).** goose's
convention-over-configuration (`compaction.md` overrides the compaction prompt) is elegant and needs
no schema, but it is a *second* config surface with its own precedence rules. LibreChat/open-webui
keep prompts inside the one config document that everything else already uses.

**⑥ The counter-case is real and worth respecting.** aider has refused system-prompt overrides
across four separate issues over two years, steering users to a conventions file instead. The
implicit argument: prompts are coupled to the code that consumes them (aider's edit formats parse
model output, so a rewritten prompt breaks the parser). **This maps exactly onto ctrl-b's steering
nudges**, which are coupled to `_LoopGuard` state and the confirm/resume machinery — evidence that
"visible but not editable" is a legitimate destination for that subgroup, not a cop-out.

## 3. The parameter-description question — a NEGATIVE finding

**No in-class peer overrides tool *parameter* descriptions.** Not goose, opencode, LibreChat,
open-webui or aider. The only claims come from MCP-proxy tooling, and they are thin:

- mcpify documents `toolOverrides: {"<tool>": {description, metadata}}` — **tool level only** in
  every worked example.
- glama's override feature *lists* "Input parameter descriptions — Clarify what each parameter does"
  among what "can be overridden", but — verified by reading the page — **provides no addressing
  scheme and no worked example**; its single example overrides the tool description only.

⚠ **Confidence: low, and the gap is the finding.** Everyone who overrides a tool overrides its
*description*; the parameter half is claimed but undemonstrated. Read as: parameter-description
override is not an established pattern, so ctrl-b would be inventing rather than following. That is
allowed — but it should be a deliberate call, not a "peers do this" call, because **they don't**.

## 4. Implications for ctrl-b (short, and separate from the evidence)

1. Expose the **class**, not another one-off (①).
2. **Replace + keep the existing append axis** — replacement freezes you at a snapshot (②), and our
   `system_prompt_append` / `prompt_append` precedent is already the field's mitigation.
3. **Any prompt that interpolates config values needs placeholders before it can be exposed** (③) —
   this is a real constraint on the reflection nudge and the per-tool-cap nudge, not a nicety.
4. **Generalize `GET /api/agent/default-prompt` to `GET /api/prompts`** returning
   `{id, label, default_text, current}` — we already ship the field's most-requested missing feature
   for one prompt (④); widening it is cheap and is what makes the whole thing usable.
5. **Split the class by coupling** (⑥): assembled-context prompts (summarizer, memory intro, roster,
   skills note) → editable. Guard-coupled steering nudges → *visible* first; editable only if asked.
6. **Parameter descriptions have no peer cover** (§3). If we build it, build it as an additive field
   on the existing `ToolOverride` object — never a sibling map — and justify it on our own merits.

## 5. Sources

- [goose — Customizing Prompt Templates](https://goose-docs.ai/docs/guides/context-engineering/prompt-templates/) · [goose Prompt Management (DeepWiki)](https://deepwiki.com/block/goose/4.1.4-prompt-management)
- [LibreChat — Summarization Configuration](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/summarization)
- [open-webui Discussion #7024 — expose default prompts in UI](https://github.com/open-webui/open-webui/discussions/7024) · [Issue #14173 — Expose Default Task Model Prompts](https://github.com/open-webui/open-webui/issues/14173) · [open-webui Prompts docs](https://docs.openwebui.com/features/workspace/prompts/)
- [opencode — Config](https://opencode.ai/docs/config/) · [opencode — Agents](https://opencode.ai/docs/agents/)
- [aider — Options reference](https://aider.chat/docs/config/options.html) · [aider #1258 — change the system prompts with a setting](https://github.com/Aider-AI/aider/issues/1258) · [aider #3364](https://github.com/Aider-AI/aider/issues/3364) · [aider/prompts.py](https://github.com/Aider-AI/aider/blob/main/aider/prompts.py)
- [glama — Overriding MCP tool name, description and input schema](https://glama.ai/blog/2025-09-14-overriding-mcp-tool-name-description-and-input-schema) · [mcpify — MCP Schema](https://mcpify.org/docs/mcp-schema)
