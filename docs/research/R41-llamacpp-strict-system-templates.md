# R41 — Why llama.cpp 400s ctrl-b's chat requests against Qwen3.6, and what the SERVER can do about it

**Date:** 2026-08-19 · **Scope:** server/template mechanics ONLY (the client-side "how do peers shape
messages" half is a separate parallel pass) · **Drove:** *(open — no D-entry yet)*

**Pins used for every source claim**
| Thing | Pin |
|---|---|
| llama.cpp **as corsair runs it** | tag `b9952` = `2ed3c1abbb8e155226b0b2cbeb9e9efad77fbb02` (2026-07-10) — read off `GET /props` `build_info: "b9952-2ed3c1abb"` (**VERIFIED**, probed 2026-08-19) |
| llama.cpp **master** (for "does upgrading fix it?") | `5112b9738b502abcc33b2a25077d56d36d0483e4` = `b10499-4-g5112b97` (2026-08-19) |
| Model / template | `qwen3.6-max` → `./models/Qwen_Qwen3.6-35B-A3B-Q5_K_M.gguf`, template byte-identical to `Qwen/Qwen3.6-35B-A3B` `chat_template.jinja` on HF (7,764 chars / 154 lines, both) (**VERIFIED**) |

Unless a line says otherwise, file:line cites are **master** `5112b97`; where corsair's older build
differs I give both.

---

## 1. The mechanism — verbatim, top to bottom

### 1.1 The 400 is not a parser bug. It is the ordinary prompt render, wrapped in a misleading message.

**VERIFIED** (source read, both pins). Chain, in order:

1. `common_chat_templates_apply` (`common/chat.cpp:3809`) → with `--jinja`, dispatches to
   `common_chat_templates_apply_jinja` (`common/chat.cpp:3600`).
2. That function tries a table of hand-written "specialized" template handlers
   (`common_chat_try_specialized_template`), and **if none matches** falls into a `try { … }` block
   that runs the *differential autoparser* (`common/chat.cpp:3710-3740`).
3. Inside that `try`, `autoparser::peg_generator::generate_parser`
   (`common/chat-auto-parser-generator.cpp:41`) does, as its **very first statement**:

   ```cpp
   data.prompt            = common_chat_template_direct_apply(tmpl, inputs);      // :46
   data.generation_prompt = common_chat_template_generation_prompt(tmpl, inputs); // :47
   ```

   `common_chat_template_direct_apply_impl` (`common/chat.cpp:931`) binds the **request's real
   messages** into the Jinja context and executes the template (`jinja::runtime runtime(ctx);
   runtime.execute(tmpl.prog)`, `chat.cpp:975-977`). This is not a probe — it is how the prompt
   string is produced. There is no separate "render the prompt" step elsewhere.
4. The template hits `raise_exception('System message must be at the beginning.')`. The builtin
   (`common/jinja/value.cpp:353`) throws `raised_exception("Jinja Exception: " + msg)`; each AST node
   on the way out decorates it (`common/jinja/runtime.cpp:74`,
   `"While executing " << type() << " at " << get_line_col(source, pos) << " in source:\n"`).
5. Back in `common_chat_templates_apply_jinja`, the `catch` at `common/chat.cpp:3738-3740`:

   ```cpp
   } catch (const std::exception & e) {
       throw std::invalid_argument(std::string("Unable to generate parser for this template. "
           "Automatic parser generation failed: ") + e.what());
   }
   ```
   (corsair's `b9952`: identical text, `common/chat.cpp:2782`.)
6. The server's `ex_wrapper` (`tools/server/server.cpp:58-62`) maps `std::invalid_argument` → **400
   `invalid_request_error`**; every other `std::exception` → 500.

**So: the "Unable to generate parser" prefix is a wrapper artefact.** The template did not fail to
be *analyzed*; it refused to *render this conversation*, and the refusal happened to occur inside the
autoparser's `try`. This matters for remedy selection (§4) and it corrects a widely repeated
misdiagnosis (§6).

### 1.2 Why the template is executed at request time at all

**VERIFIED.** Because `--jinja` means the prompt IS the template's output. `--jinja` additionally
makes llama.cpp *derive* the tool-call/reasoning parser from the template, which is the extra
machinery — but the raise fires on the plain prompt render, which any Jinja server must do.

Side finding (**VERIFIED**, cost not measured): on the autoparser path the template is executed a
lot per request — `analyze_template` (`common/chat-diff-analyzer.cpp:257`) runs **18
`compare_variants` probes** (≥2 renders each), plus 3 renders for the real prompt
(`direct_apply` once, `generation_prompt_impl` twice, `chat.cpp:1010-1012`). `analyze_template` is
constructed **fresh inside the request path** (`chat.cpp:3712-3713`) — no memoization. ~39+ template
executions per chat request on corsair's build.

### 1.3 There is no "multiple system messages" concept anywhere in llama.cpp

**VERIFIED.** Searched the whole `common/` tree at both pins:

* The **only** system-message normalization is `workaround::system_message_not_supported`
  (`common/chat.cpp:2966-2981`), gated on `if (!tmpl.original_caps().supports_system_role)`
  (`chat.cpp:3653`). It merges *one* leading system into the next message, and only for templates
  with **no** system support at all. Qwen3.6 reports `supports_system_role: true`
  (`/props` → `chat_template_caps`, **VERIFIED probed**), so this never fires.
* Capability detection never probes the failing shape: the `supports_system_role` probe
  (`common/jinja/caps.cpp:158-180`) renders exactly `[{system}, {user}]`. There is no
  `supports_multiple_system` / `supports_trailing_system` cap. `caps::to_map()`
  (`caps.cpp:86-97`) is the complete list of nine caps.
* `workaround::map_developer_role_to_system` (`common/chat.cpp:2955`) rewrites `developer` → `system`
  **before** rendering, so the OpenAI `developer` role is not an escape hatch — it makes the problem.
  (**VERIFIED by probe**, §1.4.)
* The **diff analyzer's 18 probe scenarios contain no `system` role at all** (`grep '"role"'
  common/chat-diff-analyzer.cpp` → 34 hits, all `user`/`assistant`/`tool`). And probe render failures
  are swallowed: `apply_template` returns `ERR_TMPL` on exception
  (`common/chat-auto-parser-helpers.cpp:315-333`). This is load-bearing for §4: **a template patch
  that touches only the system branch cannot change the derived tool-call parser.**

### 1.4 Live probes against corsair (`/apply-template`, no generation, nothing mutated)

**VERIFIED**, 2026-08-19, `model=qwen3.6-max`:

| Messages | Result |
|---|---|
| `[system, system, user]` | **400** — `Unable to generate parser … line 85, column 32 … Jinja Exception: System message must be at the beginning.` |
| `[system, user, system]` | **400**, identical error |
| `[system, user, developer]` | **400**, identical error → `developer` is mapped to `system` first |
| `[developer, user]` | **200** (rendered as `<|im_start|>system`) |
| `[system, user, system]` + `chat_template_kwargs:{enable_thinking:false}` | **400**, identical error |
| `[system(merged), user]` | **200** |
| `[system, user]` **+ 1 tool** | **200**, and the rendered prompt contains **exactly one** `<|im_start|>system` block: the tool preamble with the system content appended after `\n\n` |

The reported column (`line 85, column 32`) matches template line 85 exactly (§2).

---

## 2. The template — what it actually says

**VERIFIED.** Corsair's `/props` `chat_template` is byte-identical in length and line count to
`https://huggingface.co/Qwen/Qwen3.6-35B-A3B/raw/main/chat_template.jinja` (7,764 chars, 154 lines,
same line numbers). Nobody has patched it locally.

The three load-bearing regions, verbatim:

```jinja
45| {%- if tools and tools is iterable and tools is not mapping %}
46|     {{- '<|im_start|>system\n' }}
47|     {{- "# Tools\n\nYou have access to the following functions:\n\n<tools>" }}
        …
54|     {%- if messages[0].role == 'system' %}
55|         {%- set content = render_content(messages[0].content, false, true)|trim %}
56|         {%- if content %}
57|             {{- '\n\n' + content }}
58|         {%- endif %}
59|     {%- endif %}
60|     {{- '<|im_end|>\n' }}
61| {%- else %}
62|     {%- if messages[0].role == 'system' %}
63|         {%- set content = render_content(messages[0].content, false, true)|trim %}
64|         {{- '<|im_start|>system\n' + content + '<|im_end|>\n' }}
65|     {%- endif %}
66| {%- endif %}
```

```jinja
81| {%- for message in messages %}
82|     {%- set content = render_content(message.content, true)|trim %}
83|     {%- if message.role == "system" %}
84|         {%- if not loop.first %}
85|             {{- raise_exception('System message must be at the beginning.') }}
86|         {%- endif %}
87|     {%- elif message.role == "user" %}
```

Two structural facts fall out, and they are the whole answer to "guard or contract?":

1. **Only `messages[0]` is ever consulted for system content** (lines 54, 62). A system message at
   any other index is not merely rejected — the template has **no code path that renders it**.
2. **The main loop emits nothing for `role == "system"`.** Lines 83-86 are a pure assertion; the
   `{{- … }}` at 85 is the raise. If you deleted lines 84-86, non-first system messages would render
   as **empty output** — silently dropped, no error. That is a data-loss "fix", not a fix.

Corollary (**VERIFIED by probe**, §1.4 last row): the model's trained prompt shape has **exactly one
`<|im_start|>system` block, always first**, and with tools present the tool preamble and the system
prompt live *inside the same block*. Two separate system blocks is a token sequence the template
cannot emit.

---

## 3. Training contract, or just a template guard?

**Evidence for "genuine contract" (VERIFIED, structural):** §2's two facts. The template is Qwen's
own statement of the training format; it does not describe a shape it refuses to emit. Any remedy
that renders a second system block, or a `[System Instruction]`-tagged user block, is inventing a
token pattern the model was not trained on. Whether Qwen3.6 *degrades* on it is a separate,
unmeasured question.

**Evidence that the guard is stricter than it needs to be (VERIFIED):** the leading position is the
only thing the model needs. Merging N consecutive **leading** system messages into one produces a
prompt that is byte-identical to the in-distribution single-system case — the raise is protecting
against something the caller can trivially satisfy without leaving distribution.

**Qwen's own documentation: NEGATIVE finding (VERIFIED — searched).** The `Qwen/Qwen3.6-35B-A3B`
model card mentions system messages nowhere (grepped the README: zero substantive hits). Web search
across Qwen docs/cookbook surfaced no statement about multiple or mid-conversation system messages.
**The template's `raise_exception` is the only published statement of the rule.** Treat any
"Qwen says…" claim about this as folklore unless it cites the template.

---

## 4. Server-side remedies in current llama.cpp, with trade-offs

Measured against: **tool calling** · `--reasoning-format deepseek` · `--cache-prompt` prefix reuse.

### ✗ 4.1 Upgrade llama.cpp — does NOT fix it (and makes the error worse)
**VERIFIED by source at master `5112b97`; UNVERIFIED empirically (did not build master).**
Master added a Qwen3-Coder specialized handler that Qwen3.6 now matches (`common/chat.cpp:3589-3595`
keys on `<tool_call>` + `<function=` + `<parameter=`, all present in this template), so the
autoparser is bypassed. But the specialized handler *also* renders the template first —
`data.prompt = common_chat_template_direct_apply_impl(tmpl, inputs);` (`common/chat.cpp:1168`) — so
the raise still fires. Worse: it is no longer wrapped in `std::invalid_argument`, and
`raised_exception`/`rethrown_exception` derive from plain `std::exception`
(`common/jinja/runtime.h:705,714`), so `ex_wrapper` (`server.cpp:63-66`) would return **500
server_error** instead of 400. Net: an upgrade converts a legible 400 into an opaque 500.
*(Upside of an upgrade, unrelated: the ~39 renders/request of §1.2 collapse to 3.)*

### ✗ 4.2 `chat_template_kwargs` — cannot help
**VERIFIED** (source + probe). It only injects extra variables into the Jinja context
(`tools/server/server-common.cpp:1296-1300` → `params.extra_context`, `chat.cpp:3668-3671`). The
guard at line 84 is unconditional and reads no variable. Probe confirmed 400.

### ✗ 4.3 `developer` role — cannot help
**VERIFIED** (source + probe). Rewritten to `system` before render (`chat.cpp:2955`).

### ✗ 4.4 A built-in `--chat-template chatml` override — technically works, strategically fatal
**VERIFIED by source.** `--chat-template` accepts a builtin name or literal Jinja
(`common/arg.cpp:3691-3701`). Swapping in generic ChatML removes the raise, but it also removes the
`<tool_call>/<function=/<parameter=` tool protocol and the `<think>` scaffolding, so tool calling and
`--reasoning-format deepseek` extraction both break. Non-starter.

### ✗ 4.5 A per-request template override — does not exist
**VERIFIED.** No `chat_template` field is read from any request body; the only occurrence in the
server tree is the *read-only* `"chat_template"` key exposed on `/props`
(`tools/server/server-context.cpp:4602`). Nothing per-request can change the template.

### ✗ 4.6 An upstream option / PR that coalesces system messages — does not exist
**VERIFIED** (GitHub search of ggml-org/llama.cpp issues+PRs, 2026-08-19). No option, no open PR, no
maintainer proposal. The only system-merging code is §1.3's `supports_system_role == false` path. The
canonical issue — **[#20733](https://github.com/ggml-org/llama.cpp/issues/20733)**, *"Unable to
generate parser for this template, System message must be at the beginnin"*, opened 2026-03-18
against Qwen3.5 with the **exact same `line 85, column 32`** — was **closed by the stale bot on
2026-05-24** with no maintainer fix, and has kept accumulating "same here" reports through
2026-08-09. A reopen request ("This is a major incompatibility with OpenAI's api") went unanswered.
**REPORTED**, from the issue thread. The de-facto maintainer position is: patch the template.

### ✓ 4.7 `--chat-template-file` with a patched template — the only real server-side fix
**VERIFIED mechanics.** `--chat-template-file PATH` reads the file into `params.chat_template`
(`common/arg.cpp:3703-3712`), which is validated at startup by `common_chat_verify_template`
(`common/arg.cpp:955-961`; renders a single `[user]` message — it will **not** catch a bad system
branch) and then replaces the GGUF template for that instance. On corsair's router this is a preset
key: `common_preset::to_args` emits `opt.args.back()` (the long form) plus the value
(`common/preset.cpp:37-77`), so adding `chat-template-file = "D:\\...\\qwen3.6-patched.jinja"` to the
`[qwen3.6-max]` preset block produces `--chat-template-file <path>` verbatim.

**What it costs, dimension by dimension:**

| Dimension | Effect | Confidence |
|---|---|---|
| **Tool-call parser** | *Unaffected*, on corsair's build. The autoparser derives the tool format from 18 differential probes that contain **no system messages** (§1.3), so a patch confined to the system branch leaves the derived parser bit-identical. On master, the specialized handler keys on template *substrings* that a system-branch patch does not touch — still matches. | **VERIFIED** (source); not runtime-diffed |
| **`--reasoning-format deepseek`** | *Unaffected*. Reasoning start/end are derived from the template's `<think>` markup (lines 100-104, 147-153), untouched by a system-branch patch. | **VERIFIED** (source) |
| **Prompt cache** | *Neutral-to-good, with one trap*: the patched leading-system path must render the **same bytes** as today or every cached prefix on the box is invalidated once. A tail nudge appended as a new block is cache-safe (append-only). | **VERIFIED** (reasoning from the rendered prompt) |
| **Distribution** | *This is the real cost.* Every published patch invents a rendering the model never saw (§2/§3). | **VERIFIED** structurally; **UNVERIFIED** behaviourally |
| **Maintenance** | The file is now yours: it must be re-derived on every Qwen3.6 GGUF re-download and re-checked against every llama.cpp bump (a future specialized handler could key on a substring you edited). No test harness covers it. | **VERIFIED** (mechanics) |

**The three published patch shapes** (all **REPORTED** — read, not run):

| Shape | What lines 83-86 become | Cost |
|---|---|---|
| **(a) Delete the assertion** — recommended in #27107 as "byte-for-byte identical for valid inputs" | nothing | **Silently drops the content** of every non-first system message (§2 fact 2). The model never sees the nudge. Cheapest and quietly wrong. |
| **(b) Own system block** — `spiritbuun/buun-Qwen3.6-chat_template` line 356-357, and froggeric's `Qwen-Fixed-Chat-Templates` | `{{- '<|im_start|>system\n' + content + '<|im_end|>\n' }}` | Content preserved; emits a token pattern the template can otherwise never produce (two system blocks). |
| **(c) User-tagged instruction** — [#20733 comment, 2026-05-29] | `{{- '<|im_start|>user\n[System Instruction]\n' + content + '<|im_end|>\n' }}` | Content preserved, stays inside a role the model does see mid-conversation; the `[System Instruction]` marker is invented text. |

Both community repos bundle **many other unrelated edits** (thinking auto-disable with tools, tool
argument truncation, parallel-call delimiters, `preserve_thinking` handling). Adopting one wholesale
imports all of it. If this route is taken, apply the minimal system-branch diff to the *official*
template — do not adopt a community fork.

### ⓘ 4.8 Adjacent, non-remedy: `/v1/messages`
**VERIFIED** (source). llama-server exposes an Anthropic-shaped endpoint where `system` is a separate
top-level field, so the multi-system shape is structurally unrepresentable. Irrelevant to ctrl-b's
OpenAI-compatible client without a transport rewrite; noted only because upstream threads offer it as
"the fix".

---

## 5. Two adjacent findings worth banking

1. **The official Qwen3.6 template invalidates its own prompt cache across turns.**
   **VERIFIED** (template lines 100-104): assistant turns *after* `ns.last_query_index` render with
   `<think>…</think>`; earlier ones render without. When a new user message arrives,
   `last_query_index` moves forward and the previously-`<think>`-bearing assistant turn is re-rendered
   **without** its reasoning — the prefix changes mid-history, so `--cache-prompt` must reprocess from
   that point. `preserve_thinking = true` pins the branch and stops the churn. Independently reported
   by froggeric ("llama.cpp regularly has to go back to a much earlier cache checkpoint despite the
   context just growing") — **REPORTED**.
2. **llama.cpp has a separate, open Qwen3.6 prompt-cache defect.**
   [#22746](https://github.com/ggml-org/llama.cpp/issues/22746) — append-only request bodies
   (proxy-captured, 100% common prefix) still fall back to full/large partial re-processing. Reported
   on 27B and 35B-A3B, with opencode and Hermes. **REPORTED.** If ctrl-b ever measures poor cache
   reuse on corsair, this is a candidate cause that has nothing to do with message shaping.

---

## 6. Corrections — beliefs in circulation that the source contradicts

1. **"The autoparser probes the template with synthetic message sequences and some probes don't put a
   system message first."** (llama.cpp #27107, 2026-08-15, the most detailed public explanation.)
   **WRONG. VERIFIED:** the 18 diff-analyzer probes contain no `system` role at all, and probe
   failures are swallowed (`apply_template` → `ERR_TMPL`). The raise comes from rendering the
   **caller's real messages** (`generate_parser`'s first statement). The practical consequence: the
   bug is 100% determined by what the client sends — it is not a probabilistic upstream artefact, and
   it will not go away by changing llama.cpp's analysis.
2. **"Deleting the assertions gives byte-for-byte identical output for valid inputs."**
   True but misleading: for the *invalid* input that motivated the deletion, output is not "identical",
   it is **empty**. **VERIFIED** (§2 fact 2).
3. **"Upgrade llama.cpp — newer builds handle Qwen3.6 properly."** **VERIFIED FALSE** at master
   `5112b97`: the specialized handler renders the same template and raises the same exception, only
   with a worse HTTP code (§4.1).

---

## 7. What I could not determine

* **Behavioural cost of an out-of-distribution system rendering.** Nobody has measured whether
  Qwen3.6 degrades when fed a second `<|im_start|>system` block or a `[System Instruction]` user
  block. Needs an A/B on real ctrl-b turns; not buyable from documents.
* **Whether Qwen intends the rule as a training contract.** No Qwen documentation addresses it (§3);
  the structural argument is strong but it is an inference from the template, not a statement.
* **Empirical confirmation of §4.1's 400→500 claim.** Read from master's control flow; I did not
  build master or find a public report at that pin.
* **Whether corsair's router (llama-swap-style front end) passes preset keys through unmodified for
  `chat-template-file` specifically.** `common_preset::to_args` says yes for llama.cpp's own preset
  format; the router's own preset layer was inferred from `/v1/models` output, not read.
* **The real per-request cost of the ~39 template renders** (§1.2) — counted the call sites, did not
  profile.

---

## 8. Implications for ctrl-b *(short and separate — this ages fast)*

* **The decisive fact: there is no server-side setting that fixes this.** The only server-side fix is
  hand-maintaining a forked Jinja template on corsair — and the honest versions of that fork all
  render a shape the model was never trained on, while the cheap version silently deletes the message.
* **Merging ctrl-b's consecutive LEADING system messages costs nothing and stays in-distribution.**
  The template already concatenates everything into one `<|im_start|>system` block; merging them
  client-side produces exactly the bytes Qwen was trained on, and the prompt-cache prefix is unchanged
  from today. This half is not a compromise — it is what the format always meant.
* **The tail ephemeral nudge is the only genuinely contested case**, and it is the one the server
  cannot help with. Re-roling it (user, or folded into the last user message) keeps the prompt
  append-only and in-distribution; a template patch to render it as a system block does not.
* **Do not treat "upgrade llama.cpp" as the fix**, and do not adopt a community template fork
  wholesale (§4.7).
* If the owner ever *does* want the fork: the minimal, content-preserving diff is shape **(c)** or
  **(b)** applied to the official template, plus `preserve_thinking: true` for §5.1 — and it becomes a
  permanent maintenance item with no test coverage.

---

## 9. Summary (the bounded question, answered)

1. Qwen3.6's **official** chat template asserts `raise_exception('System message must be at the beginning.')` at line 85 — VERIFIED, byte-identical to the HF original on corsair.
2. `--jinja` means the prompt *is* the template's output, so llama.cpp executes that template on the caller's real messages on **every** request (`generate_parser`'s first statement, `chat-auto-parser-generator.cpp:46`).
3. The raise is caught by the autoparser's `catch` (`chat.cpp:3739`), re-thrown as `std::invalid_argument`, and mapped to **HTTP 400** (`server.cpp:60-62`). The "Unable to generate parser" prefix is a wrapper artefact, not a parser failure.
4. llama.cpp has **no** notion of multiple system messages: no capability, no normalization, no option, no open PR — the only merge path is for templates with *no* system support at all.
5. `chat_template_kwargs`, the `developer` role, and per-request overrides are all dead ends (probed).
6. **Upgrading does not fix it**: master's new Qwen3-Coder handler renders the same template and raises the same exception, returning a **500** instead of a 400.
7. Upstream issue **#20733** is this exact error, closed by a stale bot with no fix and still accumulating reports; the de-facto maintainer answer is "patch the template yourself".
8. The only server-side fix is `--chat-template-file` with a forked template. It leaves tool calling and deepseek reasoning intact (the tool parser is derived from probes containing no system messages), but every published variant either **silently drops** the message or emits a token shape the model never saw in training — plus permanent unversioned maintenance on corsair.
9. Structurally, the template can only ever emit **one** system block, always first, merged with the tool preamble — so single-leading-system is the trained shape, not merely a guard.
10. **Therefore: the client must shape the messages.** Merging ctrl-b's consecutive leading system messages is free, in-distribution and prompt-cache-identical; the tail nudge needs a non-system role. No server change is warranted.
