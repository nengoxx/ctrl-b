# R32 — The prompt as a HAND-EDITABLE artifact: file formats, metadata, placeholder syntax

> **Question asked:** owner, verbatim — *"I would like to see the prompts and edit the prompts, like,
> literally by hand if I want to."* What is the field convention for that artifact — format,
> metadata, placeholder syntax — and is any format both hand-editable **and** directly consumable by
> eval tooling with zero conversion?
>
> **Date:** 2026-08-15 · **Method:** bounded research agent (Opus, high). Primary sources: format
> specs + repo source read through the GitHub API (promptfoo `src/prompts/`, langfuse-python
> `model.py`, google/dotprompt `spec/`, microsoft/prompty `spec/spec.md`), PyPI release metadata for
> dependency/maintenance facts, official docs for the rest. Two local probes on emma's Python 3.14.
> **Drove:** [`../PROMPTS_AUDIT.md`](../PROMPTS_AUDIT.md) §5 (the shape proposal) + **PR-6** (open).
>
> Sibling passes: R30 (peer prompt-system code internals) · R31 (eval-harness requirements). The
> eval boundary here is deliberately thin — one line per tool, **format loadability only**.

---

## 1. The candidate formats

| Format | Body + placeholders | Metadata carrier | Variables DECLARED? | Missing var | Spec maturity | **Independent consumers** |
|---|---|---|---|---|---|---|
| **dotprompt** `.prompt` (Google) | Handlebars `{{var}}`, `{{role "system"}}`, partials `{{>x}}` | YAML frontmatter: `model`, `config`, `input.schema`, `output.format/schema` (Picoschema) | ✅ schema'd + defaults | empty string (Handlebars); **not covered by the conformance suite** | **Real spec**: `spec/` = YAML conformance vectors (`variables`, `picoschema`, `partials`, `whitespace`, `unicode`) run by 7 language impls | **~1** (community `dotprompt_dart`); otherwise Genkit/Firebase only |
| **Prompty** `.prompty` (Microsoft) | Jinja2 (or Mustache in 2.0) + `system:`/`user:` role markers | YAML frontmatter: `name`, `description`, `authors`, `model{api,configuration,parameters}`, `inputs`, `sample`, `tools` | ✅ `inputs` list w/ kind + default | engine default | 1.x shipped then demoted to **"legacy"**; 2.0 spec is `Version: 0.1.0-draft / Status: Draft / Date: 2026-04-04` | **1** (`langchain-prompty`); the rest are Microsoft (VS Code ext, promptflow, Semantic Kernel alpha) |
| **POML** `.poml` (Microsoft) | XML tags `<role>/<task>/<document>`, `{{ }}` exprs, `<let>`, `for`/`if` | attributes + `<let>`; no frontmatter | partial (`<let>`) | unknown | research-project shape; repo idle since 2026-01-14 (7 mo), PyPI `poml` 0.0.8 @ 2025-08-25 | **0** outside Microsoft |
| **promptfoo prompt files** | Nunjucks `{{var}}` in `.txt`/`.md`/`.j2`; `.json`/`.yaml` for chat arrays | *none in-band* — metadata lives in `promptfooconfig.yaml` (`id`, `label`, `config`) | ❌ convention-only (it can *extract* names from the text) | renders **empty**, silently (`throwOnUndefined = false`) | not a format, a **loader** | n/a (it is the consumer) |
| **Langfuse prompts** | `{{var}}` | DB row: name, version, labels, `config` JSON, tags | ❌ discovered from text (`find_variable_names`) | **`{{var}}` left literal** | product feature, stable | DB-first; file export is a **one-way** webhook writing `langfuse_prompt.json` |
| **Markdown + YAML frontmatter** (Agent Skills / SKILL.md, `.claude/commands/*.md`, goose) | plain markdown; **no engine** — Claude Code does `$ARGUMENTS`, `$ARGUMENTS[N]`, `$N`, `$name`; goose is the outlier with Jinja2 | YAML frontmatter, 6 spec'd fields | ✅ *when* declared (`arguments:` frontmatter list) | **documented both ways** (see below) | **open standard** with its own governance repo + reference validator (`skills-ref validate`) | **~45 listed clients** (Cursor, Copilot/VS Code, Gemini CLI, Codex, goose, opencode, OpenHands, Letta, Roo, Amp, Spring AI, …) |
| **LangChain** local prompt files | `template_format`: `f-string` (default) · `mustache` · `jinja2` | JSON/YAML with `_type`, `input_variables`, `template` | ✅ `input_variables` | f-string → `KeyError` | legacy-ish; hub (LangSmith) is DB-backed like Langfuse | large, but the *file* form is not what people use — `hub.pull()` is |

**Verbatim, load-bearing:**

- dotprompt README: *"An executable prompt template file format for Generative AI. It is designed to
  be agnostic to programming language and model provider."* (VERIFIED — raw README)
- Prompty 2.0 `spec/spec.md`: *"This specification defines the runtime behavior of Prompty — a
  markdown file format and execution pipeline for LLM prompts. It is language-agnostic:
  implementations in any programming language MUST conform to the behavioral contracts defined
  here."* — header: **`Version: 0.1.0-draft`, `Status: Draft`, `Date: 2026-04-04`** (VERIFIED —
  repo read). The repo also carries `web/src/content/docs/legacy/specification/` for the 1.x shape.
  ⚠ **The format you would hand-edit today is mid-redefinition.**
- Agent Skills spec: *"The `SKILL.md` file must contain YAML frontmatter followed by Markdown
  content."* … *"The Markdown body after the frontmatter contains the skill instructions. There are
  no format restrictions."* Required fields are exactly `name` (≤64 ch, lowercase-hyphen, must match
  the directory) and `description` (≤1024 ch); optional `license`, `compatibility`, `metadata`
  (string→string map), `allowed-tools` (experimental). Governance: *"originally developed by
  Anthropic, released as an open standard … The standard is open to contributions from the broader
  ecosystem."* (VERIFIED — agentskills.io/specification)
- Claude Code's strict validator rejects unknown keys — *"Unexpected key(s) in SKILL.md frontmatter:
  argument-hint. Allowed properties are: allowed-tools, compatibility, description, license,
  metadata, name"* — i.e. **the metadata set is closed and validated**, and vendor extensions
  (`argument-hint`, `arguments`, `model`, …) are explicitly a Claude-Code-only superset. (VERIFIED)
- Claude Code missing-placeholder semantics, both directions in one paragraph: *"An indexed
  placeholder with no corresponding argument, such as `$2` when only one argument was passed, **stays
  in the content unchanged**. A named placeholder from the `arguments` frontmatter with no matching
  argument **expands to an empty string**."* Escaping is `\$1`. (VERIFIED)
- LangChain, on engine choice: prefer `template_format='f-string'` over `'jinja2'`, or *"never accept
  jinja2 templates from untrusted sources as they may lead to arbitrary Python code execution"*;
  since 0.0.329 jinja2 renders in a `SandboxedEnvironment` treated as *"best-effort … rather than a
  guarantee of security."* (REPORTED — docs via search, consistent across pages)

**Adoption, the number that decides:** markdown + YAML frontmatter is the only format in this survey
with **double-digit independent consumers**. dotprompt has ~1, Prompty has 1, POML has 0. Both
vendor formats are ~1–5 k stars and single-sponsor; Agent Skills' spec repo alone is 24 k stars with
a separate org. ⚠ Caveat that matters for us: Agent Skills is an *instruction/skill* format, not a
*prompt-with-variables* format — it wins on hand-editability, not on templating.

**Name collision (VERIFIED):** `.prompt` is not owned. Besides Google's, there are at least
`human-hooks/dot-prompt`, `dot-prompt/dotprompt` ("a compiled language for LLM prompts") and an
unrelated PyPI `dotprompt`. Adopting `.prompt` buys no interoperability by itself.

## 2. The intersection question — which formats does eval tooling load DIRECTLY?

**Answer: essentially none of the "prompt formats". The eval tools define their own loader surface.**

- **promptfoo** — VERIFIED by reading `src/prompts/constants.ts`:
  `VALID_FILE_EXTENSIONS = ['.cjs','.cts','.j2','.js','.json','.jsonl','.md','.mjs','.mts','.py','.ts','.txt','.yml','.yaml']`.
  **`.prompt` and `.prompty` are absent** — dotprompt and Prompty files cannot be passed as
  prompts-under-test without a shim (a `file://prompt.py:func` loader is the sanctioned escape
  hatch). `.md` **is** loadable, and `processMarkdownFile` does `fs.readFileSync` → `{raw: content}`:
  **no frontmatter stripping**, so YAML frontmatter in a `.md` prompt is sent to the model verbatim.
- **DeepEval** — loads local prompts from `.json` or `.txt` via `prompt.load(file_path=…)`, or pulls
  versioned prompts from Confident AI; interpolation defaults to `PromptInterpolationType.FSTRING`.
  No `.prompt`/`.prompty`/frontmatter support. (REPORTED — docs)
- **Langfuse experiments** — the prompt-under-test is a Langfuse prompt object (DB), fetched by
  name+label; files are an export artifact, not an input. (VERIFIED for the sync direction)
- **Azure AI Evaluation / promptflow** — the one real intersection: `Prompty.load(source=path)` loads
  a `.prompty` directly, and MS Learn's custom-evaluator path is built on it. Note the asymmetry —
  there the `.prompty` is usually the **judge**, not the prompt-under-test. (REPORTED — MS Learn)

**So the honest answer to "hand-editable AND zero-conversion A/B-testable" is:** a **plain `.md`/`.txt`
file with `{{var}}` and no frontmatter** is the only artifact that is simultaneously (a) trivially
hand-editable, (b) loaded verbatim by promptfoo, and (c) engine-compatible, because Nunjucks,
Handlebars, Jinja2 and Mustache all agree on bare `{{name}}`. **The moment you add frontmatter you
have bought a conversion step** — for promptfoo the frontmatter becomes prompt text.

## 3. Variants on disk

- **dotprompt**: a real convention — *"To create a variant, create a `[name].[variant].prompt` file"*,
  loaded with `ai.prompt('my_prompt', { variant: 'gemini25pro' })`; files prefixed `_` are partials.
  (VERIFIED — genkit.dev)
- **promptfoo**: two conventions, both VERIFIED in source. (a) **one file, many prompts** — the `.txt`
  processor splits on `PROMPT_DELIMITER = getEnvString('PROMPTFOO_PROMPT_SEPARATOR') || '---'`;
  ⚠ this is the *same* token as YAML frontmatter fences, so a frontmattered `.txt` splits into
  garbage. (b) **many files** — glob `prompts/**/*.txt` plus `{id, label}` entries in the config;
  every prompt is run against every test, which is how the comparison view is populated.
- **Langfuse**: variants are DB **versions + labels** (`production`, `latest`, custom), not files.
- **Agent Skills / Claude Code**: no variant convention at all — one file, one name, git is the history.

## 4. Templating-engine weight for a Python backend

| Option | Runtime deps | Maintenance (VERIFIED, PyPI/GitHub 2026-08-15) | Notes |
|---|---|---|---|
| **none — hand-rolled `{{var}}` scan** | 0 | n/a | What Langfuse ships (see §5) |
| **stdlib `string.Template` subclass** | 0 | stdlib | Probe below — gives declaration + validation free |
| **Jinja2** | 2 (`jinja2` + `MarkupSafe`, C ext) | 3.1.6 @ 2025-03, healthy | **Not currently in ctrl-b's venv** (probed: `jinja2`/`markupsafe` absent). LangChain's own docs call user-supplied jinja2 an RCE surface |
| **chevron** (mustache) | 0 | 0.14.0 @ **2021-01**, last repo push 2023-08 → **dead**. LangChain **vendored** it (`langchain_core/utils/mustache.py`: *"Adapted from https://github.com/noahmorrison/chevron. MIT License."*) rather than depend on it | copy-in is the field's own answer here |
| **pystache** (mustache) | 0 on py≥3.10 | 0.6.8 @ 2025-03 (PennyDreadfulMTG fork, 19 ★) | alive but tiny |
| **pybars3** (Handlebars) | PyMeta3 | 0.9.7 @ **2019-11** → **dead** | do not adopt |
| **dotpromptz** (Google's Python impl) | **8** (`aiofiles`, `anyio`, `dotpromptz-handlebars`, `pydantic[email]`, `pyyaml`, `structlog`, 2× types-*) + a **compiled Rust wheel** (`dotpromptz-handlebars`, abi3) | 0.1.5 @ 2026-01, 4 releases total, pre-1.0 | the full dotprompt runtime is not a cheap dependency |
| **prompty** (Microsoft runtime) | 5 (`pyyaml`, `jinja2`, `python-dotenv`, `click`, `aiofiles`) | 0.1.50 @ 2025-04 stable; 2.0.0b3 @ 2026-06 | pulls Jinja2 anyway |
| **poml** | `nodejs-wheel` + pydantic | 0.0.8 @ 2025-08 | ⚠ **the Python package ships a Node runtime** (VERIFIED from `requires_dist`) |

**Local probes on emma, Python 3.14.4 (VERIFIED):**

1. `string.Template` with `delimiter = "{"` does **not** produce `{{var}}` — `{{` is consumed as the
   escape sequence: `T("Hello {{name}}").safe_substitute(name="X")` → `"Hello {name}}"` and
   `get_identifiers()` → `[]`. The naive route fails.
2. An ~8-line subclass overriding `pattern` **does** work and hands you four things for free:
   ```
   ids: ['name', 'missing']                      # get_identifiers()  → the declared set, derived
   safe: Hi X, JSON {"a": 1} and {{missing}}      # safe_substitute()  → unknown left LITERAL
   valid: True                                    # is_valid()         → validate a hand-edited file
   substitute(...) -> KeyError: 'missing'         # strict mode when you want it
   ```
   Literal braces (`{"a": 1}`) pass through untouched, whereas `str.format` on the same string raises
   `KeyError: '"json"'` — a decisive argument against single-brace `{var}` for prompts that contain
   JSON examples.

## 5. The counter-position — what SHIPPING apps actually do

Strong, and it is not close. **The format vendors publish specs; the shipping apps hand-roll
substitution over markdown.**

- **Langfuse** (33 k ★, a *prompt-management product*) ships **no template engine**. Its entire
  renderer is a ~55-line `TemplateParser` in `langfuse/model.py` — `OPENING = "{{"`, `CLOSING = "}}"`,
  `str.find` scanning, `.strip()` on the name — plus `find_variable_names()` for discovery. Missing
  variable: the literal `{{var}}` is re-emitted, by an explicit `else` branch. (VERIFIED — source read)
- **Claude Code / Agent Skills** (~45 clients): markdown + closed 6-field frontmatter, **no engine**,
  `$`-style substitution with declared names, documented escape, documented missing-value behavior.
- **LangChain** wanted mustache and **vendored chevron** rather than take the dependency; and steers
  users away from Jinja2 on security grounds.
- **promptfoo** is the only tool in the survey that adopted a real engine (Nunjucks) — because it
  needs filters and loops for *test matrices*, not for prompts.
- Known from R27 and not re-reported: open-webui's `{{MESSAGES:END:N}}` selectors are custom
  substitution in config strings; goose is the field's outlier in shipping full Jinja2.

**Reading:** the main seat's sketch — substitution-only `{{name}}`, per-prompt declared placeholder
set, served over an API — is **the field's shipping consensus, not a compromise**. The two refinements
the evidence suggests are (a) declare the placeholder set *in the artifact* (Agent Skills' `arguments:`,
dotprompt's `input.schema`) rather than only in code, and (b) **decide and document the missing-variable
semantic** — the field is genuinely split (Langfuse: leave literal · Handlebars/Nunjucks: blank ·
Claude Code: both, by placeholder kind · f-string: raise).

## 6. What I could not determine

- Whether Handlebars' missing-variable behavior is *normative* in dotprompt: `spec/variables.yaml` is
  60 lines and covers provided / default / override only — **no missing-variable case** (VERIFIED
  absence). The empty-string behavior is inherited from Handlebars, not specified.
- Prompty 1.x → 2.0 migration cost, and whether `langchain-prompty` / Semantic Kernel will follow the
  draft; `langchain-prompty`'s release cadence was not checked.
- promptfoo's undefined-variable behavior end-to-end: `throwOnUndefined` defaults to `false` at the
  engine (VERIFIED), but I did not trace every call site. DeepEval's `.txt` missing-var rule likewise.
- Any real-world example of one file serving as both a hand-edited production prompt and an
  unmodified eval input across *two different* tools. I found no such case.

## 7. Implications for ctrl-b (short, and separate)

1. **Adopting dotprompt/Prompty/POML buys nothing here.** Neither the eval tools nor any peer would
   read our files; the Python runtimes cost 5–8 deps (or a Node runtime), and Prompty's spec is a
   4-month-old draft. Interop is the only reason to take a format, and the interop isn't there.
2. **`{{name}}` is the safe token** — it is the intersection of Handlebars, Jinja2, Mustache and
   Nunjucks, so a prompt written with it renders identically wherever it lands later. Single-brace
   `{var}` is disqualified by JSON-in-prompts.
3. **Zero-dependency is the field-normal implementation**, not an under-build (Langfuse). If we want
   validation and placeholder discovery for free, the ~8-line `string.Template` subclass (§4 probe)
   gives `get_identifiers()`, `is_valid()`, strict and lenient modes with no dependency at all —
   which maps directly onto PROMPTS_AUDIT §5's `placeholders` field and onto validating a
   hand-edited override before it is saved.
4. **PR-6 needs one more ruling than it currently states:** not just *"placeholder-free or a
   documented placeholder set"*, but **what happens when a hand-edited prompt drops or misspells a
   placeholder.** Recommend Langfuse's semantic (leave `{{var}}` literal) — it is visible in the
   output, so the owner sees the mistake instead of silently losing the value.
5. **If the artifact ever becomes a file** (Option B), keep it frontmatter-free or accept that
   promptfoo will feed the frontmatter to the model. Option A (config map, `default_text` served over
   the API) sidesteps this entirely and stays consistent with §5's recommendation.
6. **Variants:** nobody in the peer class keeps prompt variants side by side on disk — promptfoo does
   it in *its* config, Langfuse in *its* DB. Don't invent a variant convention for v1; git is the
   history, and an eval harness (R31) supplies the comparison.

## 8. Sources

- [google/dotprompt](https://github.com/google/dotprompt) (README + `spec/` conformance vectors) · [Dotprompt in Genkit](https://genkit.dev/docs/dotprompt/) · [dotpromptz on PyPI](https://pypi.org/project/dotpromptz/)
- [microsoft/prompty](https://github.com/microsoft/prompty) (`spec/spec.md` v0.1.0-draft; `web/…/legacy/specification/`) · [prompty on PyPI](https://pypi.org/project/prompty/) · [langchain-prompty](https://pypi.org/project/langchain-prompty/)
- [microsoft/poml](https://github.com/microsoft/poml) · [poml on PyPI](https://pypi.org/project/poml/)
- promptfoo source: [`src/prompts/constants.ts`](https://github.com/promptfoo/promptfoo/blob/main/src/prompts/constants.ts) · [`src/prompts/processors/markdown.ts`](https://github.com/promptfoo/promptfoo/blob/main/src/prompts/processors/markdown.ts) · [`src/util/templates.ts`](https://github.com/promptfoo/promptfoo/blob/main/src/util/templates.ts) · [docs — Prompts](https://www.promptfoo.dev/docs/configuration/prompts/)
- langfuse-python source: [`langfuse/model.py` `TemplateParser`](https://github.com/langfuse/langfuse-python/blob/main/langfuse/model.py) · [Prompt version control](https://langfuse.com/docs/prompt-management/features/prompt-version-control) · [GitHub integration](https://langfuse.com/docs/prompt-management/features/github-integration)
- [Agent Skills specification](https://agentskills.io/specification) + [overview/clients](https://agentskills.io) · [Claude Code skills & commands](https://code.claude.com/docs/en/skills)
- [langchain_core `utils/mustache.py`](https://github.com/langchain-ai/langchain/blob/master/libs/core/langchain_core/utils/mustache.py) · [PromptTemplate reference](https://reference.langchain.com/python/langchain-core/prompts/prompt/PromptTemplate)
- [DeepEval — Prompts](https://deepeval.com/docs/evaluation-prompts) · [Azure AI Foundry — Custom evaluators](https://learn.microsoft.com/en-us/azure/ai-foundry/concepts/evaluation-evaluators/custom-evaluators)
