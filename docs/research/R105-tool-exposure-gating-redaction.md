# R105 — Tool exposure flags vs callability · shell gating by caller · secret masking of tool output (2026-10-22)

| | |
|---|---|
| **Question** | Q1: when a peer flags a tool "not shown to X", does its invocation path also refuse the tool, or does the flag only affect the listing? Q2: how do peers keep the human's own shell separate from the model's shell tool, and how do they gate the model's shell? Q3: where and how do peers mask secrets in tool output? |
| **Date** | 2026-10-22 (session 83, wave 2). Every finding below is dated today unless it says otherwise. |
| **Drove** | Evidence for ISS-88 (`ui_exposed` on the generic route), ISS-87 + ISS-102 (the `run_shell` gate at `full`), ISS-98 + the "redact once at the chokepoint" proposal. **Nothing decided here.** |
| **Peers read** | Codex CLI `openai/codex` @ `9a8a85bc` (2026-10-22) · opencode `sst/opencode` @ `27cdf5fb` (2026-10-22) · open-webui @ `91ea4e34` (2026-10-16) · LibreChat @ `61892206` (2026-10-22) · goose `block/goose` @ `7ba1b162` (2026-10-22) · LiteLLM @ `f2118fc7` (2026-10-22) · aider @ `5dc9490b` (2026-05-22) · Hermes agent, the local install `~/.hermes/hermes-agent` @ `0d5f31a6` (2026-10-22, `NousResearch/hermes-agent`) · Claude Code, from the official docs (`code.claude.com/docs/en/{permissions,permission-modes,interactive-mode}.md`) and `anthropics/claude-code` `CHANGELOG.md` (newest entry 2.1.308), all fetched raw today. Shallow clones under `~/.cache/tmp/r105/`. |
| **Supplements (Q3 only)** | `actions/runner` @ `4c989f2f` (the GitHub Actions secret masker) · GitHub docs `github/docs` main (`workflow-commands.md`, `secure-use.md`, `secrets.md`) · GitLab `doc/ci/variables/_index.md` (master). |
| **Skipped** | Kilo Code, Continue.dev, AnythingLLM: each question already had ≥ 3 verified peer rows, so I stopped there to keep the pass focused. Home Assistant (optional for Q1) and Vault agent (optional for Q3) skipped too: Q1 was already unanimous, and the GitHub/GitLab pair covers sink-side value masking. |
| **Not used** | `/home/emma/github/claude-code` @ `a371abbe` is **not** Anthropic's repo. It is a third-party mirror (`yasasbanukaofficial/claude-code`) of Claude Code source leaked through an npm sourcemap on 2026-03-31. I did not cite it; the Claude Code rows use the official docs and the changelog only. |
| **Prior art — do NOT re-buy** | R36 §7 (2026-08-16) covers the shape of the approval *policy* in Claude Code, Codex and opencode: rule order, modes, the policy × sandbox axes. This pass does not repeat it. It asks only who is calling, what a hidden tool does, and where masking runs. |
| **Confidence key** | **VERIFIED** = I read the source file or the official doc/changelog text myself today. **VERIFIED (absence)** = a targeted grep of the cloned tree found nothing; I did not read every file. **REPORTED** = secondary source. **UNVERIFIED** = expected, not checked. Nothing was executed: these are code reads, not probes. |

---

## 0. Verdict up front

- **Q1: hidden ⇒ also refused, 8 of 8 peers.** No peer is listing-only. Both peers that have an HTTP route for calling a tool directly refuse unlisted tools at that route: LibreChat `POST /agents/tools/:toolId/call` answers 404 "Tool not found" for anything outside a one-entry allowlist; LiteLLM's MCP `call_tool` answers 403 and names the reason. **One mode hole:** goose shows a per-tool "Never Allow" in its listing but skips it at call time in `Auto`, its default mode.
- **Q2: the human's shell and the model's shell are separated by entry point (who is calling), never by privilege level, in 5 of 5 peers that have both.** 4 of the 5 run the human's line with no approval at all. Hermes runs it through the terminal tool's guards, so its hardline blocklist and the user's deny rules apply to the human too. For the model's shell, 3 of 4 peers that have a per-tool deny keep it in their most permissive mode (Claude Code, Hermes, aider). goose `Auto` is the one exception. That exception is the same class of bug as ctrl-b's ISS-87.
- **Q3: masking runs at the SINK (logs, transcripts, exports), using pattern detection, in 6 of 8 peers. 2 of 8 mask nothing.** Only Hermes also masks per tool, on what the model sees, and only for its own tools (terminal, code execution, file read, browser); its MCP and web outputs are not masked. **0 of 8 mask configured secret values once, at a single tool-result boundary**, which is ctrl-b's proposal. Masking exact values is the CI convention (GitHub Actions, GitLab), and CI applies it at the log sink. GitHub's runner sets **no minimum length** and also masks encoded forms (Base64, JSON, URI, XML, command-line escapes). GitLab requires **≥ 8 characters** and a single line, and states that a value printed in a modified form is not masked.

---

## 1. The ctrl-b baseline (bounded: read for comparison, not audited)

All **VERIFIED** on `main` @ `b77ba239`, 2026-10-22.

- **Exposure.** `ToolSpec.ui_exposed` (`core/tool.py:89`) is honoured only by `POST /api/tools/{name}` (`api/tools.py:36`: `spec.category == "utility" and spec.ui_exposed`). `POST /api/actions/{name}` (`api/actions.py:49-57`) sends any registered name to `svc.invoke(name, …, origin=ORIGIN_USER_CHAT, …)` and returns 404 only for unknown names (ISS-88).
- **Shell gate.** `core/permissions.py:133`: `if spec.name == "run_shell" and not run_shell_allowed and privilege != Privilege.FULL: return Decision.DENY`. The owner's `!` path calls the same action at FULL (`services/agent/exec.py:3`), and `shell.user_exec_enabled` is checked by its callers (`api/agent.py:1656`, `:799`; `session.py:2599`) (ISS-87).
- **Redaction.** `core/redact.py` replaces exact values with `••••`. It skips empty values; there is no minimum length and no handling of encoded forms. Its callers: `actions/shell.py:72`, which redacts `output` and then clips it, the right order (`_clip` comes after `redact`); the SSH actions `_common.py`, `reboot.py` and `shutdown.py`, which redact `output` and `error`; and `session_search.py:70`. **Not redacted:** the shell's `summary` (`f"$ {command} — exit {code}"`, so a secret typed into the command comes back in the summary), the shell's `error` from `str(exc)`, `data`, and every MCP, OpenAPI, open-terminal and web result (ISS-98).

---

## 2. Q1 — exposure flags vs callability

| Peer | What the flag does at invocation | Where | Confidence | Date |
|---|---|---|---|---|
| **Claude Code** | A deny rule naming the bare tool removes it from Claude's context, and calls fail from the next tool call on. A scoped deny (`Bash(rm *)`) leaves the tool listed and blocks matching calls. Deny rules apply in every mode. | `permissions.md` (Configure permissions); `permission-modes.md` | VERIFIED (docs) | 2026-10-22 |
| **Codex CLI** | MCP `enabled_tools`/`disabled_tools` → `ToolFilter`. It filters the list (`filter_tools`) **and** `validate_tool_call` refuses a filtered tool before `call_tool` runs. | `codex-rs/codex-mcp/src/tools.rs:63-103`; `connection_manager.rs:1143-1166` (called from `call_tool`) | VERIFIED | 2026-10-22 |
| **opencode** | A tool whose permission is wholly `deny` is dropped from the snapshot. The executor map is built from that same filtered set, so a call gets "No tool named … is currently available". Legacy `tools: {x: false}` is normalised to the same deny rule. | `packages/core/src/tool.ts:228-240, 274-284, 293-296`; `config/normalize.ts:549` | VERIFIED | 2026-10-22 |
| **open-webui** | `get_tools` runs the access-grant check (`AccessGrants.has_access`) when it loads the tools for a chat request. A tool the user may not read is dropped (`continue`). The middleware then refuses any call name not in the loaded dict. MCP `function_name_filter_list` filters the same dict. | `backend/open_webui/utils/tools.py:345-385, 251-257`; `utils/middleware.py:1100, 2848` | VERIFIED | 2026-10-22 |
| **LibreChat** | **Generic HTTP call route:** `directCallableTools = new Set([Tools.execute_code])`. Any other `toolId` gets **404**, and a role permission check gets 403. Agent tools are filtered per request by capability and permission. | `api/server/controllers/tools.js:31-35, 110-160`; `routes/agents/tools.js:82`; `services/ToolService.js:915-940` | VERIFIED | 2026-10-22 |
| **LiteLLM** | MCP `allowed_tools`/`disallowed_tools` filter every runtime listing. `call_tool` raises **403** with the reason named. Only an admin configuration view may list unfiltered. | `proxy/_experimental/mcp_server/mcp_server_manager.py:5929-5945, 6120-6127`; `rest_endpoints.py:774-779` | VERIFIED | 2026-10-22 |
| **Hermes** | Tools from disabled toolsets are absent from `valid_tool_names`. Each call is checked against that set and refused with "Tool 'x' does not exist". Deferred tools are also checked against the session-scoped catalog ("defense in depth"). | `agent/turn_tool_validation.py:81-112`; `agent/conversation_loop.py:923-934`; `model_tools.py:670-675` | VERIFIED | 2026-10-22 |
| **goose** | Tools of a disabled extension are not loaded, so a call gets "Tool 'x' is not available." A per-tool **Never Allow** is enforced in `Approve`/`SmartApprove`, **but `GooseMode::Auto => InspectionAction::Allow` skips the user permission entirely**. `Auto` is the `#[default]`. The ACP tool listing still reports `NeverAllow` for that tool. | `crates/goose/src/permission/permission_inspector.rs:159-170`; `goose-provider-types/src/goose_mode.rs:22-25`; `acp/server/tools.rs:21-42`; test `agents/state_machine/tests/hooks_lifecycle.rs:1206-1213` | VERIFIED (code read; not run) | 2026-10-22 |

**Load-bearing quotes**

- Claude Code, `permissions.md`: "A bare tool name like `Bash` removes the tool from Claude's context entirely, so Claude never sees it. If you add such a rule mid-session, Claude can't call the tool from its next tool call on" … "A scoped rule like `Bash(rm *)` leaves the tool available and blocks matching calls when Claude attempts them."
- Codex, `connection_manager.rs:1162-1165`: `if !view.tool_filter.allows(tool) { return Err(anyhow!("tool '{tool}' is disabled for MCP server '{server}'"));`
- LibreChat, `controllers/tools.js:31, 114-116`: `const directCallableTools = new Set([Tools.execute_code]);` … `if (!directCallableTools.has(toolId)) { … res.status(404).json({ message: 'Tool not found' });`
- LiteLLM, `mcp_server_manager.py:6121-6125`: `if not self.check_allowed_or_banned_tools(name, server): raise HTTPException(status_code=403, detail={"error": f"Tool {name} is not allowed for server {server.name}. Contact proxy admin to allow this tool."}`
- LiteLLM, `rest_endpoints.py:776-779`: "This is the admin-only configuration view; every runtime path keeps the default True so callable tools stay filtered."
- goose, `permission_inspector.rs:159-161`: `let action = match goose_mode { GooseMode::Chat => continue, GooseMode::Auto => InspectionAction::Allow,`

**Convention:** *hidden ⇒ also refused*, 8/8. **Two shapes:** (a) the flag removes the tool from the list **and** the executor set (opencode, Hermes, open-webui, Claude Code with a bare deny); (b) the flag is checked again at the call site (Codex, LiteLLM, LibreChat's route). When a route exists to call tools directly, peers give it **its own allowlist** (LibreChat: one tool) rather than "everything in the registry".

---

## 3. Q2 — the human's shell vs the model's shell

| Peer | Human-typed shell | Model's shell tool | Most permissive mode vs a per-tool deny | Refusal text names the reason? | Confidence | Date |
|---|---|---|---|---|---|---|
| **Claude Code** | `!` shell mode: "Doesn't require Claude to interpret or approve the command". It runs outside the sandbox, "because the sandbox applies to the commands Claude runs". Since 2.1.271, `!` commands inlined in skills and slash commands follow default-mode permission rules, so the exemption covers only what the user types. | `Bash` tool under allow/ask/deny rules + modes (R36 §7) | `bypassPermissions` skips prompts, but "Deny rules block in every mode, including `bypassPermissions`." The docs label it: "Only use this mode in isolated environments like containers or VMs". | Names the tool, not the rule: "Permission to use mcp__workspace__bash has been denied." | VERIFIED (docs + CHANGELOG 2.1.260, 2.1.271) | 2026-10-22 |
| **Codex CLI** | `RunUserShellCommand` → `tasks/user_shell.rs`: `SandboxType::None`, `PermissionProfile::Disabled`. The comment calls it "the explicit full-access escape hatch". No approval. Its output enters the transcript as a user-shell record. | Exec under approval policy × sandbox (R36 §7) | `--dangerously-bypass-approvals-and-sandbox` (alias `--yolo`): "Skip all confirmation prompts and execute commands without sandboxing. EXTREMELY DANGEROUS." No per-tool shell deny in the same sense; not checked further. | n/a | VERIFIED | 2026-10-22 |
| **opencode** | `SessionShell.start` calls `Shell.Service.create` directly. No `Permission` call on that path. | `shell` tool → `permission.assert({ action: name, resources: parsed commands, … agent })` (`name = "shell"`) | No bypass mode checked. Rules resolve last-match-wins with default `ask` (R36 §7). | `BlockedError` → "Permission denied: shell" (or the rule's own message) | VERIFIED | 2026-10-22 |
| **Hermes** | `!<cmd>` bang shell. It is gated **by surface**: CLI only, refused for gateway/API/cron sessions ("no approving human at the keyboard"). It **still runs `_check_all_guards`**, the same guards the terminal tool uses (hardline blocklist, user deny rules, dangerous-command prompt). It also runs with a secret-filtered env. | `terminal` toolset (on/off) + `approvals.mode` `manual`/`smart`/`off` + `--yolo` / `/yolo` | Floors run "BEFORE yolo / mode=off / cron approve-mode so no session-level setting can bypass them": hardline commands + the user's `approvals.deny`. | **Yes, names the setting:** "matches the user-defined deny rule '…' (approvals.deny in config.yaml). It cannot be executed via the agent — not even with --yolo, /yolo, or approvals.mode=off." | VERIFIED | 2026-10-22 |
| **aider** | `/run` (alias `!`) runs `run_cmd` directly. The only prompt is whether to add the output to the chat. | Shell commands the model suggests in its reply → `confirm_ask("Run shell command?", explicit_yes_required=True, allow_never=True)`; `--no-suggest-shell-commands` turns them off | `--yes-always` answers **"n"** to explicit-yes prompts (`res = "n" if explicit_yes_required else "y"`), so maximum autonomy never auto-runs a model-suggested shell command. | n/a | VERIFIED | 2026-10-22 |
| **goose** | No human shell escape in the CLI (grep for a leading `!`) | developer extension `shell` under `GooseMode` + per-tool permission | `Auto` (the default) skips per-tool Never Allow (§2). | Misnames it: `DECLINED_RESPONSE` = "The user has declined to run this tool." | VERIFIED; human-shell absence = VERIFIED (absence) | 2026-10-22 |

**Load-bearing quotes**

- Claude Code, `interactive-mode.md` §Shell mode: "Doesn't require Claude to interpret or approve the command" … "commands you type in shell mode run outside the sandbox even when you've enabled sandboxing, because the sandbox applies to the commands Claude runs."
- Claude Code, CHANGELOG 2.1.271: "Changed auto mode so that a skill's or slash command's inline `!` shell commands follow default-mode permission rules instead of the classifier".
- Codex, `tasks/user_shell.rs:213-215`: "`/shell` is the explicit full-access escape hatch, so it must not inherit a managed proxy from the surrounding session or turn."
- Hermes, `hermes_cli/bang_shell.py:45-47`: "running arbitrary commands for them would be a remote-execution surface with no approving human at the keyboard."
- Hermes, `tools/approval.py:871-875` (`_floor_block` docstring): "Unconditional floors, BEFORE yolo / mode=off / cron approve-mode so no session-level setting can bypass them".
- aider, `aider/io.py:865-866`: `if self.yes is True: res = "n" if explicit_yes_required else "y"`

**Convention:** *gate by caller (entry point), not by privilege*, 5/5 peers with both shells. **No peer derives "the human is calling" from a privilege or mode level.** Each has a separate entry point for the human's line: Claude Code's prompt mode, Codex's `RunUserShellCommand` op, opencode's `SessionShell`, Hermes's `bang_shell`, aider's `/run`. Each human entry point is reachable only from the interactive composer; Hermes says so explicitly. For the model: **3/4 peers with a per-tool deny keep it in their most permissive mode** (Claude Code, Hermes, aider); goose `Auto` is the outlier. **Naming the reason:** only Hermes names the setting that refused the call; Codex and LiteLLM (§2) name the scope ("disabled for MCP server"); Claude Code and opencode name only the tool or permission; goose and Hermes's disabled-toolset path misname the cause ("the user has declined", "does not exist").

---

## 4. Q3 — secret masking of tool output

| Peer | Where masking runs | What is masked | Structured / JSON walked? | Model-facing vs persisted | Confidence | Date |
|---|---|---|---|---|---|---|
| **Hermes** | **Per producer:** terminal (`redact_terminal_output`), code execution, file read, browser. **Plus sinks:** session JSON log (`_session_log_entry`, every role), assistant content before history/state.db/gateway, a `RedactingFormatter` on logs. | **Patterns only:** ~60 vendor key prefixes, `KEY=value` with secret-like names, URL credentials, JWTs, private keys. Tokens < 18 chars are fully masked, longer ones keep 6+4 characters. Tokens split by control characters are also masked. ON by default, opt-out via `security.redact_secrets: false`, read once at import time so a model-issued `export` cannot turn it off. | Message parts: only their `text`/`content` fields. Config dumps: `redact_config_value` walks the tree. | Both, for the tools it covers. MCP/web outputs: no redaction found. | VERIFIED; MCP/web gap = VERIFIED (absence) | 2026-10-22 |
| **Claude Code** | **Sinks:** shared transcripts, debug logs, `/feedback` bundles, OTel events, MCP/OAuth debug logs, `claude mcp` CLI output, relayed permission previews. **Input side:** `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` strips provider credentials from subprocess environments (Bash, hooks, MCP stdio). | Pattern families (e.g. the GitLab token prefixes, 2.1.232); credentials in URLs and headers | Changelog mentions JSON inside shell strings (2.1.296) | Docs/changelog describe sink masking only. Whether model-facing tool results are masked: **not determined.** | VERIFIED (CHANGELOG text) | 2026-10-22 |
| **Codex CLI** | `codex_secrets::redact_secrets` on the **command display string** (`CommandExecutionPresentation::from_raw`) and on the memories pipeline. Not on exec output: no `redact` in `codex-rs/core/src`. **Input side:** `shell_environment_policy` excludes `*KEY*`/`*SECRET*`/`*TOKEN*`, **but `ignore_default_excludes` defaults to `true`, so the exclude is OFF by default.** | 4 regexes: `sk-…{20,}`, `AKIA…`, `Bearer …{16,}`, `api_key|token|secret|password = …{8,}` | no | Display + memories only | VERIFIED; exec-output absence = VERIFIED (absence) | 2026-10-22 |
| **LiteLLM** | **Sinks:** a `SecretRedactionFilter` on the log handlers; `mask_credentials_in_payload` on logging payloads (SpendLogs/OTel/Langfuse); `turn_off_message_logging` replaces message content at logger callbacks. Separately, an enterprise `secret_detection` guardrail (detect-secrets) rewrites *requests* pre-call. | Patterns (PEM, AWS, Bearer, `sk-`, URL userinfo, `password=`…) + key names | **Yes:** `_PayloadWalker` rebuilds dicts/lists/pydantic, masks values under sensitive key names, preserves non-strings, replaces past-depth or cyclic nodes with `REDACTED`. Values shorter than prefix+suffix are fully masked. | Sinks only (it is a proxy; tool output is the client's) | VERIFIED | 2026-10-22 |
| **open-webui** | Audit-log sink: `redact_passwords` on request/response bodies | `"…password": "…"` JSON pairs only | regex over the serialized body | Sink only; no tool-output masking found | VERIFIED; tool-output absence = VERIFIED (absence) | 2026-10-22 |
| **LibreChat** | Log sink (winston `redactFormat`) + error-text sanitizer `redactSecrets` | URLs, `bearer`/`basic` values | no | Sink only; no tool-output masking found | VERIFIED; tool-output absence = VERIFIED (absence) | 2026-10-22 |
| **goose** | none found for tool output (only "thinking was redacted" display, telemetry) | — | — | — | VERIFIED (absence) | 2026-10-22 |
| **aider** | none (only `analytics._redact_model_name`) | — | — | — | VERIFIED (absence) | 2026-10-22 |

**Supplements: value-based masking at the CI log sink**

| System | Rule | Where | Confidence |
|---|---|---|---|
| **GitHub Actions runner** | `::add-mask::` → `SecretMasker.AddValue`. The only check is empty/whitespace ("Can't add secret mask for empty string"). **No minimum length.** A multi-line value is also split and each line masked. Encoders register Base64 (3 shifts), command-line, expression, JSON, URI, XML, trimmed-quotes and PowerShell escapes, so encoded forms are masked too. | `src/Runner.Worker/ActionCommandManager.cs:429-447`; `src/Sdk/DTLogging/Logging/SecretMasker.cs:78-100`; `src/Runner.Common/HostContext.cs:103-113` | VERIFIED |
| **GitHub docs** | "Because there are multiple ways a secret value can be transformed, automatic redaction is not guaranteed." "Never use structured data as a secret … redaction largely relies on finding an exact match". A derived value (e.g. a JWT) or a transformed one must be registered too. | `secure-use.md:30, 39-43` | VERIFIED |
| **GitLab masked variables** | The value must "Be a single line with no spaces", "Be 8 characters or longer"; output → `[MASKED]`. "If a process outputs the value in a slightly modified way, the value can't be masked." | `doc/ci/variables/_index.md:301, 321-329` | VERIFIED |

**Load-bearing quotes**

- Hermes, `agent/redact.py:30-36`: "Snapshot at import time so runtime env mutations (e.g. an LLM-generated `export HERMES_REDACT_SECRETS=false`) cannot disable redaction mid-session. ON by default".
- Hermes, `tools/terminal_tool_result.py:221-233`: `output = _truncate_head_tail(output)` … `output = redact_terminal_output(output.strip(), command)`. Truncation runs **before** redaction (failure mode, below).
- Codex, `protocol/src/config_types.rs:234-235` + `config/src/shell_environment_policy.rs:136`: "If `ignore_default_excludes` is false, filter the map using the default exclude pattern(s), which are: `"*KEY*"`, `"*SECRET*"`, and `"*TOKEN*"`." … `let ignore_default_excludes = toml.ignore_default_excludes.unwrap_or(true);`
- LiteLLM, `sensitive_data_masker.py:171-190`: "Return a copy of ``data`` where string values under sensitive-named keys are masked but every other value … is preserved by identity … A container nested past … is replaced by ``REDACTED`` rather than returned unmasked."
- Claude Code CHANGELOG 2.1.296: "Fixed secret redaction in shared transcripts and debug logs missing some values that follow a key with no value, including in JSON written inside a shell string".

**Known failure modes (from the sources above)**

1. **Truncation splits a secret.** Hermes truncates head+tail *before* redacting, so a cut can leave a prefix too short for its pattern (`sk-…{10,}`). ctrl-b's shell already redacts first, then clips. Value-based masking has the same exposure when the clip comes first: a partial value no longer matches exactly.
2. **Short values.** Masking very short exact values over-masks: every occurrence of a common substring is replaced. Hermes fully masks tokens under 18 characters; LiteLLM fully masks values shorter than prefix+suffix. GitLab refuses to mask values under 8 characters; GitHub accepts any length. ctrl-b's `redact` has no floor.
3. **Transformed or structured values.** Exact-match masking misses escaped, encoded or JSON-embedded forms (GitHub docs, GitLab's `My\[value\]` example). The GitHub runner's mitigation is to register encoders, so each value is also masked in its escaped forms.
4. **The command line itself.** Codex masks the *displayed command*. ctrl-b's shell `summary` carries `$ {command}` unmasked. Claude Code fixed a related leak in relayed permission previews (2.1.234).
5. **Control-character splits.** Hermes matches against a control-stripped copy (`_mask_control_split_tokens`), so `sk-abc\x1bdef…` cannot slip past.

**Convention:** *mask at the sink, by pattern*, 6/8 (Hermes, Claude Code, Codex, LiteLLM, open-webui, LibreChat); 2/8 none (goose, aider). Per producer on the model-facing output: 1/8 (Hermes, its own tools only). **One central pass on every tool result, using configured values: 0/8 peers.** The nearest analogue is the CI runners, which mask configured values at the log sink. Peers prevent secrets entering the tool's environment as a separate measure: Claude Code (opt-in) and Codex (opt-in, OFF by default).

---

## 5. Implications for ctrl-b (short, separate, options not rulings: the owner decides)

- **ISS-88: honour `ui_exposed` on `POST /api/actions/{name}` (404) or keep it listing-only?** The field is unanimous: no peer treats "not shown" as listing-only, and LibreChat's equivalent route has an explicit allowlist and returns 404. *Option A:* the route refuses `not spec.ui_exposed` with 404, the same guard as `api/tools.py:36`, and the UI's high-risk host actions get their own flag if any are ui-hidden today. *Option B:* keep listing-only and say so in SECURITY_MODEL. B is a defensible minority position for a tailnet-only, single-user app, but no peer chose it. *Check before choosing A:* list which `ui_exposed=False` actions the frontend actually posts to `/api/actions` (e.g. host buttons); flipping A without that list could break a button.
- **ISS-87: gate the shell by caller.** All five peers with both shells separate the human's line by entry point. Three of four keep a per-tool deny in their most permissive mode. *Option:* carry the caller in the invocation (ctrl-b already passes `origin`/`Actor` into `invoke`). `shell.agent_exec_enabled=false` then DENIES any agent caller at every privilege, and only the `run_user_exec` entry point is gated by `shell.user_exec_enabled`. This is the ISS-87 row's own recommendation; the field supports it. goose `Auto` is the cautionary example of the opposite. *Refusal text:* follow Hermes and name the setting (`shell.agent_exec_enabled` is off) in the DENIED summary the model and UI see. That also covers ISS-102's confirm-then-refuse: check `shell.enabled` before the bubble.
- **Redact once at the chokepoint.** Peers mask at sinks, and mostly by pattern. The proposal (configured values, one pass over every `ToolResult` field including `data`) has **no peer precedent**, but it is the CI-runner model applied one step earlier, and it closes ISS-98 and the MCP/OpenAPI/web gaps that Hermes still has. *If built:* redact before any clip; walk `data` recursively and leave non-strings alone (LiteLLM's walker shape); include `summary` and `error`; decide a minimum value length (GitLab 8, GitHub none; ctrl-b's SSH passwords may be short, so a floor could leave them unmasked); consider masking the JSON-escaped form of each value (the GitHub encoder idea). A pattern pass on top (Hermes, Codex) would catch secrets ctrl-b does not hold in its config; that is a separate option.

---

## 6. What was wrong, and what I could not determine

**What was wrong (premises corrected)**

- **"GitHub Actions doesn't mask values under 4 characters."** Not found. At `actions/runner@4c989f2f`, `::add-mask::` rejects only empty/whitespace values, and `SecretMasker.AddValue` has no length floor. The documented length rule (≥ 8) is **GitLab's**, not GitHub's. *(I did not check whether GitHub's server side, as opposed to the runner, enforces a floor on repository secrets.)*
- **"Codex strips `*KEY*`/`*SECRET*`/`*TOKEN*` env vars from exec by default."** False at `9a8a85bc`: `ignore_default_excludes` defaults to `true`, so the default exclude list is skipped unless the user sets it to `false`.
- **"A per-tool deny always beats the permissive mode."** True for Claude Code, Hermes and aider; **false for goose**, whose default `Auto` mode never consults "Never Allow" (§2).
- **The local `claude-code` clone is Claude Code's source.** It is a third-party mirror of leaked sourcemap code (§header). It was not used.

**What I could not determine**

- Whether **Claude Code masks secrets in the tool results the model sees** (as distinct from transcripts and logs). Neither the docs nor the changelog say so, and I did not use the leaked mirror.
- Whether goose's `Auto`-mode skip of Never Allow is deliberate (the mode's label is "Automatically approve tool calls") or a bug. I found no doc line or issue either way, and I did not run goose to confirm the code read.
- Whether opencode has a permission-bypass mode, and its default `shell` effect. I read only the evaluator's fallback (`ask`), not the shipped agent rulesets.
- Codex's model-facing text when its approval policy refuses a shell command (R36 §7 covers the policy, not the message).
- Hermes's state.db write path for tool-role messages: I verified redaction for the session JSON log and for assistant content, not for every tool row in the DB.
- Kilo Code, Continue.dev and AnythingLLM were not read (skipped for focus, header).
