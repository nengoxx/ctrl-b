# R30 — Peer-class: how agent apps STRUCTURE their prompt subsystem in code

> **Question asked:** not *whether* peers expose prompts (bought in R27) but the layer below —
> registry shape, ID scheme, where defaults physically live, how use sites consume a prompt, how
> override resolution is implemented, how placeholders are rendered/validated, whether anything
> structurally stops a developer adding an invisible prompt, and what happens to a user's override
> when the shipped default changes.
>
> **Date:** 2026-08-15 · **Method:** Opus subagent, high. Shallow clones read at HEAD —
> goose `3810898` (2026-08-14), open-webui `01f4282` (2026-07-27), LibreChat `eaef87f` (2026-08-14),
> opencode + openai/codex at 2026-08-15 HEAD. Every file path below was read, not searched; clones
> deleted after the pass. **Drove:** [`../PROMPTS_AUDIT.md`](../PROMPTS_AUDIT.md) §5 (open).

---

## 0. Three corrections to R27 — read first

**① goose is no longer file-drop-only, and it HAS built "show me the default".** It now ships a
`TEMPLATE_REGISTRY` static, an ACP API (`list`/`get`/`save`/`reset` prompt), and a Desktop **Prompts**
settings tab with `Restore Default` / `Reset to Default` / `Reset All`. **VERIFIED** (§1). R27 §④'s
"ctrl-b is ahead of the field" must narrow to open-webui + LibreChat; against goose we are *behind*,
and goose's shape is close to the sketch.

**② goose registers 11 templates, not 10** — `compaction_summary.md` is registered but absent from
the docs table, whose `compaction.md` link is already **404** (the file moved crates). Registry/doc
drift at HEAD. **VERIFIED**.

**③ LibreChat's `summaryPrompts.js` is dead code** — `SUMMARY_PROMPT`/`CUT_OFF_PROMPT` have zero
consumers; the live default lives in the out-of-tree `@librechat/agents` SDK. **VERIFIED**.

---

## 1. goose — the only real registry in the class `VERIFIED`

**Defaults are packaged `.md` files compiled into the binary**, not literals: `crates/goose/src/
prompts/*.md` (9) + `crates/goose-context-management/src/prompts/*.md` (2), via
`static CORE_PROMPTS_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/src/prompts");`

**The registry is a flat static `(filename, description)` table — the filename IS the id:**

```rust
static TEMPLATE_REGISTRY: &[(&str, &str)] = &[
    ("system.md", "Main system prompt that defines goose's personality and behavior"),
    ("compaction.md", "Prompt for summarizing conversation history when context limits are reached"),
    …11 entries…];
```

**The served record is ctrl-b's sketched shape:**
`Template { name, description, default_content, user_content: Option<String>, is_customized }`.

**Resolution is 6 lines, file-exists-wins, no merge** (`prompt_template.rs::render_template`):

```rust
let user_path = user_prompts_dir().join(name);          // Paths::config_dir().join("prompts")
let template_str = if user_path.exists() { std::fs::read_to_string(&user_path)? }
                   else { builtin_content(name)… };     // CORE_PROMPTS_DIR, else the sibling crate
render_string(&template_str, context)
```

Order: **user file → built-in**. `save_template` writes it; `reset_template` **deletes** it — restore
is `rm`, not a stored copy. `render_template`/`save_template` hard-gate on `is_registered(name)`.

**Whole subsystem: 379 lines of Rust** (`prompt_template.rs` 239 non-test, ~50 of them the table ·
`acp/server/prompts.rs` 81 · `context-management/templates.rs` 59) + 426 of UI. Shipped default text:
**15,028 chars / 11 templates**.

**Use sites call `render_template(name, &ctx)`** with a typed Rust context struct per prompt
(`SystemPromptContext`, `SubagentPromptContext`, …). Engine: **minijinja**, `trim_blocks` +
`lstrip_blocks`, one custom `code_fence` filter.

**Subsystem crates never see the override** — the composition root injects resolved text:

```rust
fn compaction_templates() -> Result<goose_context_management::Templates> {
    Ok(goose_context_management::Templates {
        compaction: crate::prompt_template::template_source("compaction.md")?,
        summary:    crate::prompt_template::template_source("compaction_summary.md")? })
}
```

### Staleness: none — and advertised as a feature `VERIFIED`

`is_customized` is *file presence*, nothing more. No hash, version stamp, diff or warning
(`grep -i "stale|outdated|version"` over the subsystem: empty). The docs sell it: *"Your
customizations persist across goose updates · Changes to defaults in the codebase don't affect your
customized templates."* Someone who copied `compaction.md` in March still runs March's contract.

### Does anything stop a developer bypassing the registry? No — goose already leaks `VERIFIED`

`is_registered` guards *lookups by name*; it cannot stop new text elsewhere. At HEAD:

| Bypass | Size | Note |
|---|---|---|
| `goose-cli/…/review/default_review_prompt.md` | **4,923 ch** | packaged `.md` + `include_str!`, unregistered; its own `--prompt` flag = a *third* override mechanism |
| `agents/moim.rs` `SYSTEM_PROMPT_BLOCK_TEMPLATE` | ~800 ch | Rust const + hand-rolled `.replace("{turn_context_tag}", …)` — a second templating engine, injected into `system.md` as `{{ moim_system_prompt_block }}` |
| `prompt_manager.rs:173` `chat_mode` extra | 1 line | literal appended after the template |
| `session_naming.rs:135` background-context framing | 1 block | the *system* half is registered, the *user* half is a `format!` at the call site |
| `review/orchestrator.rs:640` | prose | `push_str("You are running an automated code review check.…")` |

**One unregistered prompt is a third of the registry's whole text.** Registration is enforced by
nothing.

### The failure mode the registry created `VERIFIED`

`render_template` returns `Result`, so **each call site invents its own degradation**:

```rust
prompt_template::render_template("system.md", &context)
    .unwrap_or_else(|_| "You are a general-purpose AI agent called goose, created by Block".to_string())
```

A broken user `system.md` silently swaps a 1,232-char system prompt for **62 chars, no log** (`|_|`
discards the error). `tool_emulation.rs:44` does the same but `tracing::warn!`s;
`permission_judge.rs` propagates with `?`. Three policies, one mechanism.

## 2. open-webui — no registry: a naming convention across five files `VERIFIED`

Each task prompt is **three module-level names + four registration sites**:

```python
TITLE_GENERATION_PROMPT_TEMPLATE = os.getenv('TITLE_GENERATION_PROMPT_TEMPLATE', '')   # env; '' = unset
DEFAULT_TITLE_GENERATION_PROMPT_TEMPLATE = """### Task: …{{MESSAGES:END:2}}…"""          # the default
'task.title.prompt_template': TITLE_GENERATION_PROMPT_TEMPLATE,                          # config dict
```
plus `TASK_CONFIG_KEYS[…]` (`routers/tasks.py:43`), a `TaskConfigForm` field, and a `<Textarea>` in
`admin/Settings/Interface.svelte`. **Adding one prompt = editing five places.**

**Resolution is a 4-line if/else copy-pasted at every call site**, empty string as sentinel:

```python
title_template = await Config.get('task.title.prompt_template')
if title_template != '':  template = title_template
else:                     template = DEFAULT_TITLE_GENERATION_PROMPT_TEMPLATE
```

Env → DB config → default, but the env only seeds the DB row at first boot; afterwards the admin
field wins and the env var is inert.

**The default is never served.** `GET /api/v1/tasks/config` returns config values only; unset returns
`''` and the UI shows an empty box with `placeholder="Leave empty to use the default prompt, or
enter a custom prompt"`. That is the code-level cause of #7024 / #14173, unchanged at HEAD.

**The registry's absence shows up as duplication:** `title_`/`follow_up_`/`tags_`/`image_prompt_`/
`query_generation_template` in `utils/task.py` have **byte-identical three-line bodies**, and
`moa_response_generation_template` re-implements `replace_prompt_variable`'s whole regex closure.

**Two of ~12 defaults have no override at all** — `DEFAULT_EMOJI_…` and `DEFAULT_MOA_…` have no env
var and no config key. The most prompt-exposing peer still ships ctrl-b's "half hardcoded" shape.

## 3. LibreChat — a bare optional string on the subsystem's config object `VERIFIED`

The whole mechanism is two lines of zod (`packages/data-provider/src/config.ts:1930`) —
`prompt: z.string().optional(), updatePrompt: z.string().optional()` inside
`summarizationConfigSchema` — and one pass-through line in `shapeSummarizationConfig`
(`packages/api/src/agents/run.ts:726`): `prompt: config?.prompt,`. No id, label, default text,
placeholder declaration or validation beyond "is a string". `undefined` flows to the SDK, which
substitutes its own default: **LibreChat cannot show you the default because it does not own it.**
Worth noting the shape though — the prompt is a *field on the subsystem's own config object*, beside
`provider`/`model`/`parameters`/`trigger`: the same one-unified-object instinct as our
extend-don't-migrate directive.

## 4. opencode and Codex CLI — file-per-prompt, no user surface `VERIFIED`

**opencode:** each prompt is a `.txt` imported as a bundler-inlined constant
(`import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"`, 14 system prompts) and — notably — **one
`.txt` per tool description** (`src/tool/glob.txt` → `description: DESCRIPTION`). Selection is an
if-ladder on `model.api.id`; placeholders are `replaceAll("{{MODEL_NAME}}", name)` per site. No
registry, ids, list or override, and it still leaks (`session/prompt.ts` holds
`STRUCTURED_OUTPUT_SYSTEM_PROMPT` inline). **Relevant to PR-1:** opencode externalises the tool
*description* to a file and leaves **parameter** descriptions inline in the schema
(`Schema.String.annotate({ description: … })`) — the same boundary ctrl-b drew independently.

**Codex CLI:** a whole crate is the subsystem — `codex-rs/prompts/templates/<domain>/<name>.md` plus
a thin `src/<domain>.rs` doing `pub const X: &str = include_str!(…)`; `lib.rs`'s `pub use` list is a
compile-time inventory. Not exhaustive: base instructions live in `protocol/src/prompts/…` and model
instructions in `core/templates/model_instructions/`. One user override exists
(`model_instructions_file` in config.toml, per-profile). `core/src/prompt_debug.rs` (`#[doc(hidden)]`)
rebuilds the model-visible input for inspection — the *visibility* half of PR-3, built as a debug
facility, not a product feature. **Claude Code: closed source, not inspectable — UNVERIFIED.**

## 5. Q4 — precedent for serving `{id, default_text, current, placeholders}` over an API?

**Yes, exactly once: goose.** `acp/server/prompts.rs` serves all of it but placeholders —
`PromptTemplateEntry { name, description, default_content, user_content, is_customized }`, and
`on_get_prompt` returns `{name, content, default_content, is_customized}` (resolved content *and* the
default together). `list_templates()` is also folded into support-bundle diagnostics
(`session/diagnostics.rs:362`) so a bug report carries the user's actual prompts. Nobody else serves
defaults at all, and **no project ships `placeholders` over the wire.**

## 6. Q5 — placeholders: no per-prompt manifest anywhere `VERIFIED`

| Project | Engine | Unknown placeholder | Missing value |
|---|---|---|---|
| goose | minijinja, default `UndefinedBehavior::Lenient` | prints **empty**; iteration empty; **attribute access errors** → caught by the site's `unwrap_or_else` | same |
| open-webui | `str.replace` + regex, no engine | **left literal** — `{{FOO}}` reaches the model verbatim | user vars → the literal `'Unknown'`; `{{MESSAGES}}` → `''` |
| LibreChat | none in-tree | n/a | n/a |
| opencode | `replaceAll` per site | left literal | n/a |
| **Codex** | **own 442-line strict engine** (`codex-rs/utils/template`) | **`ExtraValue` error** | **`MissingValue` error** |

Allowed variables are **convention-only everywhere except Codex**, where the set is *derived, not
declared*: `Template::parse` collects it at load and exposes
`pub fn placeholders(&self) -> impl ExactSizeIterator<Item = &str>`; `render` errors in **both**
directions plus `DuplicateValue`; escaping is `{{{{`/`}}}}`. Callers `panic!` — defensible only
because its templates are compile-time assets. The asymmetry that implies for us is in §8.

The only other placeholder validation in the field is one soft check in open-webui's `rag_template`:
`if '[context]' not in template and '{{CONTEXT}}' not in template: log.debug("WARNING: …")` — a
`log.debug`, invisible in production. goose's own registry test renders `system.md` with an **empty**
`HashMap` and asserts non-empty output: it passes only because minijinja is lenient, so it proves
nothing about the real context.

## 7. Q6 — what each project got wrong `REPORTED unless marked`

- **goose #3348** (closed): the GPT-4.1 system prompt was silently never used — code referenced
  `system_gpt_4.1`, the file was `system_gpt_4.1.md`. **String-keyed lookup of a packaged file fails
  silently.** The modern equivalent is live: a miss now lands in the 62-char `unwrap_or_else` with
  the error discarded (**VERIFIED**, §1).
- **goose #7847**: `GOOSE_SYSTEM_PROMPT_FILE_PATH` pointing at a missing file **panics the CLI**. A
  *fourth* override path; goose now has four (prompts dir · recipe `system_prompt_override` · this
  env var · `--prompt` on review).
- **open-webui #7024 / #14173**: *"nowhere does it show what the default prompt actually is"*; the
  sanctioned workaround is *"search for `GENERATION_PROMPT_TEMPLATE` in the config.py and copy"*.
  Both unresolved, and **VERIFIED** still true in the code.
- **LibreChat**: `summaryPrompts.js` survives as dead code carrying a stale comment telling
  maintainers to re-count its tokens — residue of moving prompt ownership into an external SDK.

## 8. What I could not determine

- **Claude Code's internals** — closed source, minified; not attempted.
- **Whether goose's registry+API+UI is new** — the shallow clone has no history and I did not spend a
  request dating it. R27 (4 days old) describes only the file drop, so *plausibly* recent — inference,
  not finding.
- **The real default summarization prompt in `@librechat/agents`** — out of tree, npm not fetched; its
  placeholder contract is unknown.
- **Whether any project lints/tests for "no prompt literal outside the registry"** — none found in
  goose or Codex, but I did not read every CI config; absence-of-grep-hit is weak evidence.
- **open-webui's exact env→DB seeding order** — inferred from the config dict + `Config.get` pattern,
  not read in the per-key migration.

## 9. Implications for ctrl-b (short, separate from the evidence)

1. **The sketch is the field's best-known shape, plus two upgrades from goose:** take its *record*
   (`default_text` + `current` + `is_customized` in one payload) and its *reset semantics* (delete the
   override; never store a copy of the default).
2. **Make `resolve()` infallible.** goose's `Result` let three sites invent three degradations, one
   silently swapping in 62 characters. Fall back to the baked default inside the chokepoint, log
   once, hand use sites a `str`.
3. **Nothing structural prevents bypass anywhere in the field** — goose leaks 4,923 chars past its own
   registry. The guarantee the owner wants has to be a **test**: promote the PROMPTS_AUDIT AST sweep
   (`ast.Constant` ≥80 ch + `JoinedStr`, minus docstrings) into a pytest that fails on any
   model-facing literal outside the registry. That test, not the registry, is the thing no peer has.
4. **Placeholders: derive, don't declare** (Codex). Parse the default at import, expose the derived
   set as `placeholders` in `GET /api/prompts`, validate **strictly on our defaults** (unit test, both
   directions) and **leniently on a user's override** (unknown → empty + one surfaced warning, never a
   failed turn).
5. **Staleness is unsolved by everyone and sold as a feature by goose.** Cheapest honest answer nobody
   ships: store a hash of the default current when the override was saved and badge *"the shipped
   default changed since you copied this"* with a diff; the append axis stays the mitigation (R27 §②).
6. **PR-1 gets weak new support:** opencode drew the same line independently — tool description in a
   file, parameter descriptions inline. Still nobody exposes params.

## 10. Sources (read at the HEADs in the header)

- goose: `crates/goose/src/prompt_template.rs` · `…/acp/server/prompts.rs` · `…/agents/prompt_manager.rs` ·
  `…/agents/moim.rs` · `…/session/diagnostics.rs` · `…/context_mgmt/mod.rs` ·
  `crates/goose-context-management/src/templates.rs` · `ui/desktop/src/components/settings/PromptsSettingsSection.tsx` ·
  `documentation/docs/guides/context-engineering/prompt-templates.md` ·
  [#3348](https://github.com/block/goose/issues/3348) · [#7847](https://github.com/block/goose/issues/7847)
- open-webui: `backend/open_webui/config.py` (2165–2420, 3080–3115) · `backend/open_webui/routers/tasks.py` ·
  `backend/open_webui/utils/task.py` · `src/lib/components/admin/Settings/Interface.svelte` ·
  [#7024](https://github.com/open-webui/open-webui/discussions/7024) · [#14173](https://github.com/open-webui/open-webui/issues/14173)
- LibreChat: `packages/data-provider/src/config.ts:1930` · `packages/api/src/agents/run.ts:668–733` ·
  `api/app/clients/prompts/summaryPrompts.js` (dead)
- opencode: `packages/opencode/src/session/system.ts` · `…/session/prompt/*.txt` · `…/tool/glob.ts` + `glob.txt`
- Codex: `codex-rs/prompts/src/{lib,goals,compact}.rs` · `codex-rs/utils/template/src/lib.rs` ·
  `codex-rs/core/src/prompt_debug.rs` · `codex-rs/config/src/config_toml.rs:239`
- [minijinja `UndefinedBehavior`](https://docs.rs/minijinja/latest/minijinja/enum.UndefinedBehavior.html) — Lenient is the default
