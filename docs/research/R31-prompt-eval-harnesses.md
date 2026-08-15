# R31 — How the field TESTS one prompt wording against another (and what the app must provide)

> **Question asked:** the owner wants to edit ctrl-b's prompts *in order to test whether one set of
> instructions beats another* — "ideally I would like to be able in the future to test the
> performance of the agentic workflow, and testing the prompts themselves is a main thing …
> obviously the testing is gonna be done with an LLM." So: **(a)** do in-class peers ship a
> prompt-eval / A-B / regression mechanism for their OWN prompts, and how do maintainers test a
> prompt change before shipping? **(b)** what do the established harnesses (promptfoo · Langfuse ·
> DeepEval · Braintrust · OpenAI Evals) *require from the app under test*, especially for an agent
> loop? Therefore: **what cheap seams must ctrl-b build now so an eval harness bolts on later?**
>
> **Date:** 2026-08-15 · **Method:** Opus 5 subagent, high. Primary sources only: recursive git-tree
> listings + file reads of 8 peer repos via the authenticated GitHub API (trees confirmed
> `truncated: false`), plus vendor docs read directly. No clones.
> **Drove:** the [`PROMPTS_AUDIT.md`](../PROMPTS_AUDIT.md) §5 design + the owner's prompt-testing
> goal (open). Siblings: R30 (peer prompt-system internals), R32 (prompt file formats).

---

## 1. Half (a) — what peers ship, in their own repos

**Scorecard.** "Own-prompt eval" = a mechanism that scores the project's *own* prompt wording.
All repo rows VERIFIED 2026-08-15 by full recursive tree listing at HEAD + file reads.

| Project | Own-prompt eval mechanism | What is actually in the repo |
|---|---|---|
| **goose** | ❌ none as a *product* feature — ✅ **a maintainer harness**: `evals/harbor/` | `cmd.py` `agent.py` `runner.py` `reporter.py` `config_template.yaml` `recipes/` `.agents/skills/compare-tasks/SKILL.md` |
| **aider** | ❌ refused as a feature (R27 §⑥) — ✅ **the maintainer harness that decided its prompts**: `benchmark/` | `benchmark.py`, Docker rig, `prompts.py`, `rungrid.py`, `--edit-format` sweep |
| **open-webui** | ⚠️ **✅ an in-app eval feature — but it rates MODELS, not prompts** | `routers/evaluations.py`, `models/feedbacks.py`, `admin/Evaluations/Leaderboard.svelte`, `Settings/Evaluations/ArenaModelModal.svelte` |
| **opencode** | ❌ no `evals/` — a *hosted leaderboard* table only | `packages/console/core/src/schema/benchmark.sql.ts` → columns `model`, `agent`, `result` |
| **Codex CLI** | ❌ **zero** eval/benchmark paths in 7,078 tree entries | (only `codex-rs/prompts/templates/review/rubric.md` — a review *prompt*, not a harness) |
| **LibreChat** | ❌ none for quality — `e2e/benchmarks/` is **latency** | `agent-startup.latency.spec.ts`, `mongoose-latency-hook.cjs` |
| **AnythingLLM** | ❌ **zero** (6,510 entries) | — |
| **Continue.dev** | ❌ dead stub: `eval/` contains only a `.gitignore` reading `repos`, untouched since **2024-07-29** | — |
| **Claude Code** | closed source; ships `claude plugin eval` for **user plugins/skills**, not its own prompts | docs 404 publicly at `code.claude.com/docs/en/plugin-eval` (early-access gated) — **REPORTED** |

**Premise correction (the brief guessed "goose-bench"):** there is **no `goose-bench` crate** in
`block/goose` today — the 14 crates are `goose`, `goose-agent`, `goose-cli`, … and none is a bench
crate. "GooseBench" was a 2025 blog-era vibe-check benchmark; the live tooling is `evals/harbor`.

**② goose's harness is the closest in-class thing to a prompt-variant A/B, and its shape is
instructive.** Harbor is *not* goose's — it is "a comprehensive framework from the creators of
Terminal-Bench" (`laude-institute`); goose vendors an **adapter** into it. Per
`evals/harbor/README.md` (VERIFIED), the `GooseBinaryAgent` adapter *"uploads your local goose binary
into each task container, generates a `config.yaml` from the template with the requested extensions
flipped on, runs the recipe"*; `cmd.py` exposes `run · list · show · task · compare · pull · rm`,
where **`compare` does head-to-head summary + per-task diffing of two runs**. A Harbor task =
`instruction.md` + `Dockerfile` + `tests/test.sh` (+ optional `llm_judge.py` / `rubric.md`), so the
A/B unit is **the whole run** (binary + model + extensions + recipe), compared per-task.

⚠ **A practitioner's warning about exactly our use case** (REPORTED, rmoff 2026-04): Harbor is
strong for *"tightly defined tasks"* comparing models/tools, but for iterative prompt development
*"varying prompts requires duplicating tasks/verifiers"* — the rig fights you when the prompt is the
variable. Read this as: **the task fixture and the prompt variant must be separable axes**, which is
precisely what promptfoo's `prompts × providers × tests` matrix gives and a container-per-task
benchmark does not.

**③ goose's loop is human-in-the-middle by design.** The 2026-06-17 goose post: *"The human step
keeps the loop from collapsing into benchmark tricks."* Its `.agents/skills/compare-tasks/` +
`recipes/{analyze_bench_failure,compare_bench_run}.yaml` make the *analysis* of two runs itself an
agent recipe; prompt fixes come out of that analysis, not an automatic prompt optimizer.

**④ aider is the strongest evidence that a benchmark, not opinion, should settle prompt wording.**
Its `benchmark/README.md`: the harness measures *"how effectively aider and LLMs can translate a
natural language coding request into executable code saved into files that pass unit tests."*
Variance is measured, not assumed — `benchmarks.html`: *"I ran all 133 exercises 10 times each
against `gpt-3.5-turbo-0613` with the `whole` edit format"*, and the prompt-format decision is stated
as a benchmark result: *"aider will continue to use the `whole` edit format for GPT-3.5, and `diff`
for GPT-4."* Same project that **refuses** to let users override those prompts (R27 §⑥). The
maintainer keeps the eval; the user gets an append file.

**⑤ The one in-class *product* eval feature rates models, not prompts** — open-webui's Evaluations
tab is an arena/leaderboard fed by per-message human feedback; it answers "which model is better",
never "which wording is better". **And nobody in class stamps a prompt identifier on a run:**
opencode's hosted `benchmark` table is literally `(model, agent, result)`. There is no
prompt-version column anywhere in the class — the gap the eval *tooling* (§2–§3) fills.

---

## 2. Half (b) — what the harnesses require of the app under test

| Tool | Can it drive an agent loop? | The contract | Offline + local judge | Footprint |
|---|---|---|---|---|
| **promptfoo** | ✅ — the *provider* runs the loop | `file://provider.py` → `def call_api(prompt, options, context) -> dict` with **required key `output`**; or the built-in `http` provider posting to your API | ✅ results stored locally by default; judge overridden per-assert or globally | 1 npm CLI, **80 direct deps**, `node >= 22.22` (dev-time only) |
| **Langfuse** | ✅ — you write the task fn: *"full flexibility to use your own application logic"* | `def my_task(*, item, **kwargs)` + evaluators `(*, input, output, expected_output, metadata)`; ingestion via SDK **or** OTLP | ✅ self-hostable; judge = any OpenAI-compatible connection | ❌ **6 services**: web, worker, Postgres, **ClickHouse**, Redis/Valkey, S3/blob |
| **DeepEval** | ✅ via `@observe` traces + framework integrations ("evaluate complete agent trajectories") | pytest-shaped: `LLMTestCase` / `evaluate()` / `deepeval test run` | ✅ `deepeval set-ollama --model=… --base-url=…` | pip, **28 mandatory deps** — incl. `pytest*` ×5, `opentelemetry-api`+`sdk`, and **`posthog`** |
| **Braintrust** | ✅ (SDK) | — | ❌ | ❌ **ruled out**: self-host = Terraform/Helm data plane **in AWS/GCP/Azure**, and *"Braintrust continues to host the control plane"* |
| **OpenAI Evals** | ~ via "completion functions" (its custom-provider equivalent; LangChain example given) | `docs/completion-fn-protocol.md` | ~ OpenAI-centric | **effectively dormant** — HEAD commit 2026-04-14, previous substantive 2025-11-03; not archived |
| *(adjacent)* **Arize Phoenix** | ✅ OTLP-native | OTLP spans | ✅ | **1 container**: `docker run -p 6006:6006 -p 4317:4317 arizephoenix/phoenix:latest` |

**⑦ The answer to "can it drive an agent loop" is the same in every tool: *you* drive the loop; the
harness drives *you*.** None of them re-implements an agent. promptfoo's coding-agent guide is a list
of adapters (`openai:codex-sdk`, `anthropic:claude-agent-sdk`, `opencode:sdk`, `openinterpreter`) —
each an SDK wrapper — and it states the premise plainly: *"An agent decides what to do, does it,
observes the result, and iterates—often dozens of times before producing a final answer."* The
minimum an app must expose is therefore **one callable entry point that runs a whole task and
returns a final string**, plus a way to vary the prompt without editing code.

**⑧ The cheapest possible integration is an HTTP endpoint — no plugin code at all.** promptfoo's
`http` provider needs only: `url`, `method`, `headers`, a `body` containing `{{prompt}}`,
`transformResponse: 'json.output'`, and for multi-turn a `sessionParser` reading a session id out of
the response (then `{{sessionId}}` on later requests). ctrl-b already has a chat API and a session
id; that is the whole contract.

**⑨ Prompt variants are first-class in exactly one of these, and it is a two-line config.**
promptfoo's `prompts:` is a *list*, and the eval is the cartesian product `prompts × providers ×
tests`. Files are accepted directly (`.txt .md .json .yaml .j2 .py .js`, globs, `file://gen.js:fn`)
— **the one format fact that belongs to R32 as well: if ctrl-b's prompts are individually addressable
files or served by id, each variant is a `prompts:` entry with zero glue.** `--repeat <number>`
("Number of times to run each test") covers non-determinism; `--filter-failing <path>` re-runs only
last run's failures.

**⑩ The minimal LLM-judge pattern, concretely.** promptfoo `select-best` *is* the pairwise
prompt-comparison primitive, verbatim from the docs:

```yaml
prompts:
  - 'Write a tweet about {{topic}}'
  - 'Write a very concise, funny tweet about {{topic}}'
providers: [openai:gpt-5.6]
tests:
  - vars: {topic: bananas}
    assert:
      - type: select-best
        value: 'choose the funniest tweet'
```

and the judge is repointed at a local model globally:

```yaml
defaultTest:
  options:
    provider:
      id: openai:chat:llm_judge
      config: {apiBaseUrl: http://localhost:8000/v1, apiKey: empty, temperature: 0}
```

That is llama.cpp-shaped — an OpenAI-compatible `apiBaseUrl` is all it wants. Sibling assertion types
that matter: `llm-rubric` (free-form rubric), `g-eval`, `trajectory:goal-success`,
`trajectory:tool-used` / `tool-sequence` / `step-count`, plus `cost` and `latency`.

**⑪ Methodology, from the vendor most exposed to agent evals** (Anthropic, *Demystifying evals for
AI agents*, VERIFIED quotes): start at **"20-50 simple tasks drawn from real failures"**, sourced
from the manual checks you run before each release; grade **outcomes over trajectories** — *"There is
a common instinct to check that agents followed very specific steps like a sequence of tool calls in
the right order. We've found this approach too rigid and results in overly brittle tests"*; use
*"clear, structured rubrics … and then grade each dimension with an isolated LLM-as-judge rather than
using one to grade all dimensions"*; give the judge an out (*"return 'Unknown' when it doesn't have
enough information"*); calibrate it against human grades; report `pass@k` / `pass^k`, not one run —
aider's 10-runs-per-exercise is the same lesson learned empirically.

---

## 3. The trace standard — and the headline finding for ctrl-b's design question

**⑫ OpenTelemetry GenAI semantic conventions are the converging format, and they already define the
exact three fields the owner's goal needs.** VERIFIED by reading the registry: the conventions were
split into their own repo `open-telemetry/semantic-conventions-genai` (created **2026-05-05**, pushed
the day of this pass), status **Development** — *not* stable, no releases cut. Agent spans defined:
`create_agent`, `invoke_agent` (client + internal), `invoke_workflow`, `plan`, **`execute_tool`**.
The registry contains, verbatim:

| Attribute | Registry description |
|---|---|
| **`gen_ai.prompt.name`** | *"The name of the prompt that uniquely identifies it."* — e.g. `analyze-code` |
| **`gen_ai.prompt.version`** | *"The version of the prompt template used."* — `1.0.0`; `prod`; `v2`. Note [15]: *"When a prompt management system is in use, this SHOULD match the version identifier used by that system."* |
| **`gen_ai.prompt.variable.<key>`** | the interpolated template variables (`…variable.user_name` = `"Alice"`) |
| `gen_ai.system_instructions` · `gen_ai.input.messages` · `gen_ai.output.messages` | the system prompt + full chat history in/out, as structured JSON (*"Instrumentations MUST follow JSON schema"*) |
| `gen_ai.tool.name` · `.call.arguments` · `.call.result` · `.definitions` · `gen_ai.conversation.id` | the tool half of the loop + session correlation |
| `gen_ai.evaluation.name` · `.score.value` · `.score.label` · `.explanation` | **the judge's verdict has a standard slot too** |

So the three candidate seams named in the brief — *stamp the prompt version*, *export request-level
traces*, *record judge scores* — are not speculative: they are `gen_ai.prompt.version`,
`gen_ai.input/output.messages` + `gen_ai.tool.call.*`, and `gen_ai.evaluation.*`.
**PR-6's placeholder question maps onto `gen_ai.prompt.variable.<key>` — the standard assumes an
exposed prompt is a *template with named variables*, which is an independent argument for the
PROMPTS_AUDIT §5 shape.**

**⑬ Who actually consumes it.** VERIFIED: **promptfoo** runs a *built-in OTLP receiver*
(`port: 4318`, `/v1/traces`, JSON or protobuf), passes a **W3C `traceparent` to the provider**, and
its trajectory assertions read `tool.name` + GenAI attributes (normalizing SDK spans to
`tool.name`/`tool.arguments`/`tool.output`). **Langfuse** ingests at `/api/public/otel` (Basic auth)
and is *"compliant with the OpenTelemetry GenAI semantic conventions"* — plus OpenInference and
MLflow mappings, i.e. the convention war is settled by *translation*, not agreement. **Phoenix** is
OTLP-native. **Braintrust** — not established here.

**⑭ Peer adoption of the semconv is partial and instructive.** Codex CLI ships a whole `codex-otel`
crate with an OTLP exporter and `SessionTelemetry` (incl. `user_prompt(&prompt_items)` behind a
`log_user_prompts` flag) — but its **event names are vendor-private `codex.*`**
(`codex.api_request`, `codex.turn_ttft`, `codex.conversation_starts`), while it *does* use the
semconv names for usage: `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`,
`gen_ai.usage.cache_read.input_tokens`. Read as: **adopt the attribute names even if you never
adopt the span taxonomy** — that is what the biggest peer does, and it costs nothing.

**⑮ Replayable fixtures are a product feature, not something you build.** Langfuse dataset items
carry `input`, `expected_output`, `metadata`, **`source_trace_id`** and optional
`source_observation_id`, and the documented workflow is: *"select production traces where the
application did not perform as expected. Then you let an expert add the expected output to test new
versions of your application on the same data."* i.e. the "N recorded scenarios" corpus is built by
promoting real traces — which only works if the trace was captured richly enough in the first place.

---

## 4. What I could not determine

- **Whether `claude plugin eval` is a public Claude Code feature** — `code.claude.com/docs/en/plugin-eval`
  **404s** as of 2026-08-15; only community re-implementations are public. REPORTED only.
- **How any closed peer (Claude Code, Codex) tests its own prompt changes internally.** Codex's repo
  has zero eval paths; that is evidence about the repo, not about their process.
- **Langfuse's RAM floor** — the docs *"[do] not specify any minimum RAM or CPU requirements"*.
  ClickHouse+Redis+Postgres+MinIO beside local models on 30 GB is a judgement call with no published
  number behind it.
- **Whether small local judges reliably emit the structured JSON these metrics need** — DeepEval's
  Ollama page states no caveat; UNVERIFIED, and worth a 30-minute probe before betting on it.
- **promptfoo's per-run storage shape**, beyond "eval results are stored locally by default".

---

## 5. Implications for ctrl-b (short, and separate from the evidence)

1. **The three seams are real, standardized, and cheap.** Stamp `gen_ai.prompt.name` +
   `gen_ai.prompt.version` (or an override-hash serving as the version — the registry explicitly
   allows *"any versioning scheme"*) on every model call; persist the request-level record
   (messages in/out + tool call args/results) we already half-have in SQLite; keep a slot for a
   judge score. Nothing here requires choosing a harness now (§3 ⑫).
2. **Do not adopt OTel spans yet — adopt the *names*.** Semconv is status **Development** and just
   moved repos. Codex's posture (semconv attribute names, private event names) is the low-risk copy.
   An OTLP exporter can come later; the field names are the part that's expensive to retrofit.
3. **Prefer promptfoo as the assumed future harness** for footprint reasons: an npm CLI + one YAML
   vs Langfuse's six services (§2). Its `http` provider means the integration is *"post to our chat
   endpoint, read `json.output`, carry a session id"* — which we can satisfy today (⑧).
4. **The prompt-eval story is a strong second argument for PROMPTS_AUDIT §5 Option A.** A stable
   `<prompt_id>` + a version/hash per entry is simultaneously the config key, the `GET /api/prompts`
   id, and the `gen_ai.prompt.name`/`.version` stamp; Option B (file drop) gives an id but no version
   identity without inventing one. **Templating is doubly forced** (PR-6): the standard's
   `gen_ai.prompt.variable.<key>` assumes named variables, and promptfoo varies prompts by
   substituting vars into them.
5. **Expect to grade outcomes, not tool sequences** (⑪) — the fixture corpus should record *what the
   run achieved* (host woken? automation created?), which ctrl-b's events/audit system is already
   positioned to supply; cheaper than transcript diffing. **Budget 20–50 scenarios drawn from real
   failures**, not a benchmark suite — one user, one homelab.

---

## 6. Sources

- goose: [`evals/harbor/README.md`](https://github.com/block/goose/blob/main/evals/harbor/README.md) · [tree](https://github.com/block/goose/tree/main/evals/harbor) · [Self-Improving Agents Still Need Humans](https://goose-docs.ai/blog/2026/06/17/self-improving-agents-need-humans/) · [Harbor intro](https://harbor-framework-harbor.mintlify.app/introduction) · [rmoff, *Kicking the Tyres on Harbor for Agent Evals*](https://rmoff.net/2026/04/09/kicking-the-tyres-on-harbor-for-agent-evals/)
- aider: [`benchmark/README.md`](https://github.com/Aider-AI/aider/blob/main/benchmark/README.md) · [GPT code editing benchmarks](https://aider.chat/docs/benchmarks.html)
- open-webui: `backend/open_webui/routers/evaluations.py`, `src/lib/components/admin/Evaluations/Leaderboard.svelte` (tree-verified) · opencode: `packages/console/core/src/schema/benchmark.sql.ts` · Codex: [`codex-rs/otel/README.md`](https://github.com/openai/codex/blob/main/codex-rs/otel/README.md), `codex-rs/otel/src/events/session_telemetry.rs`
- promptfoo: [Python provider](https://www.promptfoo.dev/docs/providers/python/) · [HTTP provider](https://www.promptfoo.dev/docs/providers/http/) · [Model-graded metrics](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/) · [Tracing](https://www.promptfoo.dev/docs/tracing/) · [Evaluate coding agents](https://www.promptfoo.dev/docs/guides/evaluate-coding-agents/) · [CLI](https://www.promptfoo.dev/docs/usage/command-line/) · [Prompt formats](https://www.promptfoo.dev/docs/configuration/parameters/)
- Langfuse: [Self-hosting](https://langfuse.com/self-hosting) · [Link prompts to traces](https://langfuse.com/docs/prompt-management/features/link-to-traces) · [Experiments via SDK](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk) · [Datasets](https://langfuse.com/docs/evaluation/dataset-runs/datasets) · [OpenTelemetry](https://langfuse.com/integrations/native/opentelemetry)
- DeepEval: [PyPI metadata](https://pypi.org/pypi/deepeval/json) (v4.1.8, 28 deps) · [Ollama judge](https://deepeval.com/integrations/models/ollama) · Braintrust: [Self-hosting](https://www.braintrust.dev/docs/guides/self-hosting) · Phoenix: [Docker](https://arize.com/docs/phoenix/self-hosting/deployment-options/docker) · OpenAI: [`openai/evals`](https://github.com/openai/evals)
- OTel: [`open-telemetry/semantic-conventions-genai`](https://github.com/open-telemetry/semantic-conventions-genai) — `docs/registry/attributes/gen-ai.md`, `docs/gen-ai/gen-ai-agent-spans.md`
- Anthropic: [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

---

## Addendum (2026-08-15): the agent-run metrics taxonomy

> **Follow-up asked:** *"I would like to measure the efficiency, like, if a tool call fails, maybe how
> many times or how many tool calls fail, and how many LLM calls do we need for a certain task … I
> don't know if that's the correct approach or there are already things that have been thought of for
> this specific thing."* Short answer: **it is the correct approach, and two of the three counters the
> owner named are already standardized instrument names.** Extends §2–§3; does not restate them.

**⑯ There IS a named standard set, and it covers the ask almost exactly.** VERIFIED by reading
`docs/gen-ai/gen-ai-metrics.md` (status **Development**, same repo as §3). Instruments:
`gen_ai.client.token.usage` (Histogram `{token}`, split by `gen_ai.token.type`) ·
`gen_ai.client.operation.duration` (+ `.time_to_first_chunk` / `.time_per_output_chunk`) ·
`gen_ai.server.request.duration` (+ `.time_to_first_token` / `.time_per_output_token`) ·
`gen_ai.invoke_workflow.duration` · `gen_ai.invoke_agent.duration` ·
**`gen_ai.invoke_agent.inference_calls`** · **`gen_ai.invoke_agent.tool_calls`** ·
`gen_ai.execute_tool.duration`. The two bolded are the owner's question verbatim — Histograms of
*"The number of inference (model) calls a GenAI agent makes during a single invocation"* (and of tool
calls likewise), bucketed `[1, 2, 4, 8, 16, 32, 64, 128]`, **including failures**: *"SHOULD include
only the … calls the agent itself issued including failed ones; calls made by sub-agents … are
recorded against those agents' own invocations so that each … call is counted exactly once across
the call tree."*

**⑰ Failure rate is *derived*, not its own instrument.** `error.type` is Conditionally Required
(*"If the operation ended in an error"*) on `gen_ai.execute_tool.duration`,
`gen_ai.invoke_agent.duration` and `gen_ai.client.operation.duration` — tool-failure rate is the
error-typed share of that histogram's count. **VERIFIED negatives (grep of the whole 1,170-line
doc): no cost instrument, no retry/attempt instrument, no step/turn-count instrument** — the
standard leaves those to the app.

**⑱ What the field actually computes per run.** The closest published analogue to the owner's ask is
**aider's leaderboard record** — a shipped per-run YAML row (`aider/website/_data/polyglot_leaderboard.yml`,
VERIFIED by reading it) whose fields are, verbatim: `test_cases · model · edit_format · commit_hash ·
pass_rate_1 · pass_rate_2 · pass_num_1 · pass_num_2 · percent_cases_well_formed · error_outputs ·
num_malformed_responses · num_with_malformed_responses · user_asks · lazy_comments · syntax_errors ·
indentation_errors · exhausted_context_windows · test_timeouts · total_tests · command · date ·
versions · seconds_per_case · total_cost`. Note `commit_hash` + `versions`: **aider already stamps
what produced the run**, which is the §3 prompt-version seam by another name. Around it:

| Metric | Who computes it | Shape |
|---|---|---|
| success / pass rate over N attempts | aider (`pass_rate_1/2`), Terminal-Bench (89 tasks × 5 attempts → fractional success, REPORTED), Harbor (reward 0/1) | deterministic verifier |
| model-fault rate distinct from task failure | aider `percent_cases_well_formed` = *"the proportion of test case responses that were well-formed"* | deterministic |
| tokens · cost · latency · counts | aider (`*_tokens`, `total_cost`, `seconds_per_case`); Langfuse Metrics API measures `totalCost`, `totalTokens`, `latency`, `count`, `score` | aggregation |
| tool correctness | DeepEval, **deterministic**: *"(Number of Correctly Used Tools) / (Total Number of Tools Called)"* — needs `tools_called` **and** `expected_tools` | labelled |
| task completion | DeepEval, **LLM-judged, referenceless**: *"Task Completion Score = AlignmentScore(Task, Outcome)"*, both derived from the full trace | judge |
| step efficiency ("steps over optimal") | DeepEval `AlignmentScore(Task, Execution Steps)` — LLM-judged, *"will penalize any actions taken by the LLM agent that were not strictly required"* | judge |
| trajectory checks | promptfoo `trajectory:step-count` / `:tool-used` / `:tool-sequence` / `:tool-args-match` / `:goal-success`, plus `cost`, `latency`, `is-refusal`, and `trace-error-spans` — *"Identifies failures in traces by examining status codes, attributes, and messages"* | assertion |

⚠ **The academic "steps ÷ optimal steps" ratio needs a golden path per task** (REPORTED: benchmarks
define it as ground-truth steps ÷ max(ground-truth, actual), bounded [0,1]). **Every shipped tool
replaces that label with an LLM judge** — because labelling an optimal path for 50 homelab scenarios
is more work than the metric is worth.

**⑲ Post-hoc from a transcript vs live capture.** Computable **post-hoc** from messages + tool calls
+ results + timestamps: LLM calls per task, tool calls per task and per tool, wall time, every
trajectory-shaped check, and all the LLM-judged outcome/efficiency metrics (they read the transcript
and nothing else). **Cannot be reconstructed later:** ① **per-call token usage** — it comes off the
provider response, and on a *streaming* path an OpenAI-compatible server emits `usage` only when the
request sets `stream_options: {"include_usage": true}` (llama.cpp supports it, with a known
final-chunk shape quirk vs the OpenAI spec — REPORTED, ggml-org/llama.cpp #15443); without it you
are re-tokenizing a guess. ② **cost** — but storing `{model, input_tokens, output_tokens}` per call
suffices, since a price table applies later. ③ **the error taxonomy** — model-fault vs tool-fault vs
user-denial vs timeout must be classified *where it happens*; a stringly-typed result blob cannot be
reliably re-classified, and `error.type` is precisely that slot. ④ **retries/attempts**, unless the
retry loop records each attempt and not just the final outcome. **So the owner's stated set does
fall out of ctrl-b's SQLite transcript — conditional on ① and ③.**

**⑳ Guard triggers as a quality metric — yes, there is precedent.** aider publishes behavioural
counters *beside* pass rate on its public leaderboard: `user_asks` (how often the agent had to ask
the human), `lazy_comments` (placeholder `...` comments), `num_malformed_responses`,
`exhausted_context_windows`, `test_timeouts` — cheap deterministic counts of the agent misbehaving,
reported as first-class metrics rather than buried in logs; promptfoo ships `is-refusal` for the
same reason. The **standard has no guardrail concept** (VERIFIED negative: no
`guard*`/`policy*`/`refusal*` attribute in the registry; nearest is the boolean
`gen_ai.conversation.compacted`, *"a positive indicator of context compaction"* — one guard-ish
event modelled as an observable flag). ctrl-b's `_LoopGuard` counters (repeat-suppressions, denials,
per-tool-cap hits) are the same species and already computed at zero cost. ⚠ They are **ambiguity
signals**: a rise in per-tool-cap hits can mean the model is looping *or* that a prompt edit made a
tool harder to use. Diagnostics beside the outcome — never the score.

### Implications for ctrl-b (short, and separate from the evidence)

1. **Adopt the two instrument names as run-level fields now** — `inference_calls` and `tool_calls`
   per run, counted per the semconv rule (agent's own calls, failures included). Free from the loop.
2. **The one change that cannot be retrofitted: a typed outcome on every persisted tool result**
   (`ok` / `tool_error` / `model_error` / `denied` / `timeout`, `error.type`-shaped). Everything the
   owner asked about tool failures depends on it; error *text* is not a substitute.
3. **Turn on `stream_options.include_usage` and persist `{model, input_tokens, output_tokens}` per
   call**; cost then becomes a later join against a price table, not a capture requirement.
4. **Model the run record on aider's row** — outcome + counters + tokens + seconds + cost, **plus the
   prompt id/hash** (aider stamps `commit_hash`/`versions` for exactly this reason, §3 ⑫) — and
   **report loop-guard triggers as counters beside the outcome, never as the score** (⑳).
5. Efficiency only means something *paired with success*: fewer LLM calls on a failed run is not an
   improvement. Any prompt A/B reads outcome first, cost second.

### Addendum sources

- OTel [`docs/gen-ai/gen-ai-metrics.md`](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md) + `docs/registry/attributes/gen-ai.md` · aider [`polyglot_leaderboard.yml`](https://github.com/Aider-AI/aider/blob/main/aider/website/_data/polyglot_leaderboard.yml) + [Leaderboards](https://aider.chat/docs/leaderboards/)
- DeepEval [Tool Correctness](https://deepeval.com/docs/metrics-tool-correctness) · [Task Completion](https://deepeval.com/docs/metrics-task-completion) · [Step Efficiency](https://deepeval.com/docs/metrics-step-efficiency) · promptfoo [Assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/) · Langfuse [Metrics API](https://langfuse.com/docs/metrics/features/metrics-api) · [ggml-org/llama.cpp#15443](https://github.com/ggml-org/llama.cpp/issues/15443) (REPORTED)
