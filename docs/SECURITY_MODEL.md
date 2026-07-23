# Security model — the trust boundary and what upholds it

**Status: canonical (2026-07-02, PRE_DEPLOY step 2).** This is the single reference for *why* ctrl-b is
safe to run and *what must never be weakened*. It is **descriptive** — it documents the model as built,
anchored to the code that implements each claim, and flags known gaps by pointing at the
[`PRE_DEPLOY.md`](./PRE_DEPLOY.md) step that closes them. The terse enforced-rules version for agents is
[`AGENTS.md`](../AGENTS.md) §6; this doc is the model + rationale behind it.

ctrl-b is a **single-user homelab control panel**. Its entire safety story is two sentences: the network
trust boundary (Tailscale, no open ports, one trusted user) and "no SSH password / API key ever leaves in
a tool result, API response, or log." Everything below elaborates those two.

---

## 1. Trust boundary & threat model

**One user, one tailnet, full trust inside it.** There is no login, no multi-tenancy, no role separation.
The person who can reach the endpoint *is* the owner, by construction of the network.

**What the design defends against:**
- **Accidental public exposure** — the app never binds a public interface; the only ingress is the tailnet.
- **Secret leakage** — SSH passwords / API keys must never surface in a tool result, API response, log line,
  or SSE frame, even when a command echoes them.
- **Unintended destructive actions** — a medium/high-risk operation (shutdown, reboot, service stop) can't
  fire without an explicit second step (the confirm bubble), so a stray click or an over-eager agent turn
  can't silently take a machine down.

**What it explicitly does NOT defend against (accepted non-goals):**
- **A malicious actor already on the tailnet.** There are none by design — it's a personal tailnet with one
  user. **The tailnet is the authentication.** Anyone who can reach the HTTPS endpoint can drive the app;
  that is intended, not a hole to plug.
- **A malicious/compromised managed host or LLM backend.** Fleet hosts and inference endpoints are the
  owner's own boxes; we trust them.
- **Classic web attacks (CSRF, session hijacking, XSS-for-privilege).** With no auth and no other users
  there is no session to steal and no privilege to escalate to. (Confirm-tokens look CSRF-shaped but are
  not a CSRF control — see §2.3.)

If ctrl-b were ever exposed beyond a single-user tailnet, this model would not hold and would need a real
authentication layer first.

---

## 2. The layers

### 2.1 Network — tailnet + trusted-LAN ingress
- The backend's **code default** binds `127.0.0.1:5433` (`config.py` `ServerCfg.host`/`port`). **The
  deployed PROD service binds `0.0.0.0:5433` — an OWNER WAIVER (2026-07-10, revising the original
  loopback-only decision):** direct `http://emma:5433` from the LAN + tailnet, same trusted-home-LAN
  reasoning as the dev-mode exposure below (and prod is *narrower* than that long-accepted dev path —
  same API, minus Vite). HTTP has no secure context, so the mic still requires the Serve HTTPS URL.
  Nothing listens on a public interface either way. Egress to the fleet (SSH/ping/WOL) is separate and
  unaffected.
- The only remote ingress is **Tailscale Serve**, which fronts the local app as
  `https://<host>.<tailnet>.ts.net` with an auto-renewed Let's Encrypt cert (DECISIONS D1). It is
  **tailnet-only** — you must be on the tailnet to reach it; nothing is published to the public internet.
- **`debug` is off by default** (`ServerCfg.debug=False`) — an enabled debugger is a remote-code-execution
  surface. Keep it off for anything reachable.
- **Dev-mode exposure (deliberate, documented — SYS-4).** The **dev** frontend is wider than prod: Vite binds
  `0.0.0.0:5173` with `allowedHosts: true` and proxies `/api` → the loopback backend
  (`frontend/vite.config.ts:58-67`). So while the dev server runs, anyone on the **local LAN** (not just the
  tailnet) can drive the full API through the proxy — the backend's careful `127.0.0.1` bind is bypassed by
  design so the owner can reach dev by machine name / phone. This is **accepted on the trusted home LAN** and
  consistent with the trust model (§1), but it is a *decision*, not an accident: don't run the dev server on an
  untrusted network, and remember prod never has this path (uvicorn serves the built `dist` itself). Rider
  (resolved 2026-07-07, QH-11): `TailscaleCfg.target_port` now defaults to **`5433`** (the backend-served prod
  SPA) — the safe-default direction; a dev box that wants Serve fronting Vite sets `tailscale.target_port: 5173`
  in `config.yaml` or `CTRLB_TAILSCALE__TARGET_PORT=5173` in `.env`.

### 2.2 Typed-action privilege gate
Execution does not happen via arbitrary strings; it happens via **named, allowlisted actions** (`wake_host`,
`shutdown_host`, `restart_service`, …) registered in the tool registry (`core/tool.py`). Every call passes a
pure decision function, **`core/permissions.py` `decide(spec, privilege)`** → `ALLOW | CONFIRM | DENY`
(this table is a security-audience view of the gate — the code + `DESIGN.md` §3 are the source of truth):

| Condition | Decision |
|---|---|
| `run_shell` and privilege ≠ `FULL` (and not explicitly allowed) | **DENY** |
| privilege `READONLY` and it's an `action` with risk ≠ `LOW` | **DENY** |
| `spec.confirm` (designer forced-confirm) | `FULL` → ALLOW, else **CONFIRM** — *un-downgradable; a persisted approval is ignored here (§2.5)* |
| risk `HIGH` | `FULL` **or an approval matched** → ALLOW, else **CONFIRM** |
| risk `MED` | `AUTO_LOW`/`FULL` **or an approval matched** → ALLOW, else **CONFIRM** |
| risk `LOW` | **ALLOW** |

- **Privilege levels** (`domain/enums.py Privilege`): `READONLY` · `CONFIRM` · `AUTO_LOW` · `FULL`. The UI
  runs at **`CONFIRM`**; the agent runs at the privilege its `AgentDef` declares (subagents are clamped to
  the parent). So for the normal caller, every HIGH/confirm action **suspends** rather than firing.
- **Risk levels** (`Risk`): `LOW` · `MED` · `HIGH`. Risk + the `confirm` flag are declared per action on its
  `ToolSpec` — the gate is data, not scattered `if`s.
- A suspended call becomes `RunState.AWAITING_CONFIRM` and renders as the confirm bubble.
- **`read_only` is now load-bearing for ordering (D40, Slice 4).** Parallel tool dispatch runs a
  *prefix* of a batch's calls concurrently; a call is prefix-eligible **only** when its `read_only`
  flag was set by a **builtin's own `@action`/`@tool`** — never an authorization decision (each
  call still passes `decide()` independently at invoke), only an *ordering/concurrency* decision.
  Flags **derived from external annotations are untrusted for this**: MCP (`readOnlyHint`) and
  OpenAPI (method-mapping) tools are **prefix-ineligible by construction** (advisory annotations, a
  remote surface — §3), so a mislabeled remote tool can never be run out-of-order against a sibling.
  `idempotent` does not confer eligibility (re-run-safe ≠ order-independent). This promotes
  `read_only` from a pure retry-UX hint to a load-bearing builtin annotation; pinned across every
  privilege (incl. `FULL`) by the D40 classifier tests.

### 2.3 Confirm-tokens = a UX gate, NOT authentication
When `decide()` returns `CONFIRM`, `services/action_service.py` mints a **single-use, TTL'd token**
(`secrets.token_urlsafe(18)`, `_CONFIRM_TTL_S = 120s`) bound to the exact `(action, args)`, and returns
`needs_confirm: true`. The client re-POSTs with the token to execute (`api/actions.py`).

**This is a deliberate two-step "are you sure", not a security control.** Its own source says so. Concretely:
- It is **not** authentication — it grants nothing; it only confirms intent for one specific call.
- It is **not** a CSRF defense — there is no cross-origin session to protect in a no-auth single-user app.
- Tokens are **in-memory** and bound to `(action, args)` with a 2-minute expiry. **Anyone who can reach the
  endpoint can mint and immediately consume one** — that's fine, because the tailnet is the auth (§1).
- **Single-liveness on re-mint (ACA-9, owner 2026-07-16):** when the resume path re-mints a token for a
  pending action, every outstanding token for that same `(action, args)` is consumed first — exactly one
  live token per pending action, so a stale Allow from a second device fails cleanly instead of firing a
  second redemption window.
- **Known accepted:** the `extra_body` passthroughs (per-model `ModelCfg.extra_body`, per-service
  `VoiceServiceCfg.extra_body` — A11/D48 homes)
  are NOT secret-masked by the settings read (only the two secret-leaf rules are) — their canonical values
  (`cache_prompt`, `return_progress`, `stream_options`) carry no secrets; auth belongs in the masked
  `api_key` field, never inside `extra_body`.

### 2.4 Secret redaction
Secrets live in config, never in code (§4). The chokepoint that keeps them out of outputs is
**`core/redact.py` `redact(text, secrets)`** — it masks each secret value (`••••`) in any captured `output`
before it becomes a `ToolResult` / `Event` / log line / SSE frame. Secret values are enumerated by
`config.py secret_values()`, and the config API read masks them via `mask_secrets()`/`_mask()`.

Secrets are identified by **two explicit rules** (not name-substring guessing, which collided with
non-secret fields like `threshold_tokens`): (1) an **exact-name allowlist** of declared secret fields
(`api_key`, `ssh_password`) — so a non-secret field is *never* masked; this covers the A11/D48 unified
provider map, where each connection's credential is the `providers.*.api_key` field (same leaf rule as the
retired `inference.local.api_key`). (2) the arbitrary user-keyed credential maps (`env`/`headers`) mask
only entries whose own key looks secret (`Authorization`, `X-API-Key`, `*_token`…) while routine ones
(`Content-Type`) stay visible. Masking is **path-aware** (A11/D48 C1): the leaf/map rules fire only on a
scalar / a flat credential map, so a provider or model literally *named* `api_key`/`env`/`headers` is a
structured object that recurses (its own nested secret still masks) rather than being mis-masked; a
provider/model name colliding with a secret-sentinel key is additionally rejected at schema validation. A
**drift-guard test**
introspects the whole `Settings` model and fails if a future secret-looking field is left unclassified,
so the classification can't silently rot. (Tests: `backend/tests/test_secret_hygiene.py`.)

### 2.5 Persisted approvals — "always allow" (D44, ACA Slice 8)

The owner can make a confirm-gated call stop asking. An **approval** is an allow-only rule stored on the
tool's own override (`tool_overrides.<tool>.approvals`, a list of `ApprovalRule{args}`); when a call's args
match one, `decide()` is called with `approved=True` and a **risk-derived CONFIRM becomes ALLOW — nothing
else**. Full record: **D44** + [`SLICE8_PLAN.md`](./SLICE8_PLAN.md).

**The amended ladder** (XACML *ordered-deny-overrides*; an approval discharges a *discretionary*
obligation, never a mandatory one):

**policy DENY** (READONLY denials, `run_shell` gating — these branches run first in `decide()`, so an
approval can never resurrect a denied action) **> designer forced-confirm** (`ToolSpec.confirm=True` —
`approved` is ignored on that rung) **> persisted approval** (risk CONFIRM→ALLOW) **> the normal risk
decision**.

- **Allow-only by construction.** There are **no deny matchers** — a rule shape that could force a CONFIRM
  or a DENY is deliberately excluded (the sudoers `!`-in-a-NOPASSWD-list anti-pattern, where a
  later-matching negation is trivially defeated by ordering). Denial is policy-rung material, not
  approval-rung material. Because the layer only ever grants, first-vs-last-match ordering is
  meaningless: rules are OR'd (the OPA incremental-allow idiom).
- **Matching** is per-field `fnmatchcase` globs over the **validated** args (`canonical_str`: `str` as-is ·
  other scalars JSON-encoded · `None` → the `NONE_CANON` sentinel · list/dict → unmatchable). A rule ANDs
  its listed fields; **fields it does not list are unconstrained — by design**, that is the Tools-tab
  *widening* semantics. An unknown field or a non-scalar value makes the rule **inert (fail closed)**,
  never a wildcard. `args: null` on a rule is the **whole-action grant** (matches any call); `args: {}`
  is the **empty AND** — it matches only a call that has no args at all (a zero-field tool). The two are
  distinct: conflating them would let an "exact" grant on a zero-field tool silently widen if that tool
  ever gained a field.
  **Canonicalization exactness + its one limit.** `None` canonicalizes to a NUL-prefixed sentinel, not
  the plain string `"null"`, so a rule pinning an *omitted* optional can no longer be matched by a call
  passing the literal string `"null"` (it could before the post-audit fix — the args-exact guarantee was
  false for that pair). What remains is **type-blindness within the string form**: a field typed
  `int | str` would give `5` and `"5"` the same canonical form. **No tool has such a field today**; a tool
  that introduces one must not rely on approvals to distinguish the two. Corollary: a `None` pin is
  produced by the grant path, not hand-authored — the sentinel is not practically typeable in
  `config.yaml`.
- **The bubble grant is args-EXACT.** Tapping "always" on a confirm bubble sends the `execute_always`
  resume verb; the **server** builds the rule from the suspended call's validated args, pinning **every**
  top-level field (omitted optionals pinned as the `None` sentinel, values glob-escaped) — so it matches that one
  arg tuple and nothing else. Widening (globs, dropping fields) is a deliberate act in **Conf → Tools**.
  The frontend never serializes or canonicalizes a rule.
- **`run_shell` is un-approvable** — pinned `confirm=True` (D44 R1; behavior-neutral, since `decide()`
  already treated HIGH ≡ confirm below FULL), as are `shutdown_host`/`reboot_host`, which were already
  forced-confirm. **Owner-configured-risk tools deliberately STAY approvable**: `terminal_exec` /
  `terminal_write_file` (risk from `open_terminal.exec_risk`/`write_risk`) and MCP/OpenAPI server `risk`.
  Their HIGH is the owner's own setting, and pinning them would break the deliberate `exec_risk: low`
  escape — so the stance is explicit rather than accidental.
- **Actor-agnostic — the interactive→headless crossing is DELIBERATE.** One grant covers USER, AGENT and
  headless-subagent callers. A rule born from a chat bubble therefore also auto-allows the agent (and a
  headless subagent) re-running that exact call, with no second prompt. That is owner ruling ④, not an
  oversight; a headless call that does *not* match still fails closed (CONFIRM → DENIED, unchanged).
  Its **sole visibility is the audit marker**: every approval-fired run appends
  `[auto-allowed: <field=pattern, …>]` to the executed action's `Event.summary` (the `Event` model has a
  fixed column set — no new kind, no migration). Rule *creation* is not evented: it is a visible,
  diffable config change.
- **No expiry in v1.** A standing grant lasts until revoked — no TTL, no decay-on-disuse, no global
  toggle (an absent list IS off). **Revoke** = the approvals editor in **Conf → Tools** (one tap per
  rule, saved through the single `tool_overrides` write path) or an edit to `config.yaml`. Revocation is
  live: the gate re-reads the shared settings object per invocation, so the very next call re-asks.
- **As-built caveat (W3) — two exclusions from the editor, only one of them harmless.** The Tools-tab
  approvals editor is hidden for **(a)** `confirm=True` tools and **(b)** tools whose
  `default_agent_mode` is `disabled` (e.g. `tailscale_serve_enable`/`_disable`). A rule hand-written into
  `config.yaml` for either is **not revocable in the UI**, but the two differ:
  - **(a) inert.** The gate never consults approvals on a forced-confirm tool, so such a rule grants
    nothing — it is dead config, not a standing permission.
  - **(b) LIVE but unmanaged.** These tools are ordinary risk-gated tools: an approval there **does**
    fire and does downgrade their confirm. It simply has no editor row, so revoking it means editing
    `config.yaml`. Treat any hand-written rule on a `disabled`-default tool as a real standing grant —
    the pre-deploy checklist's `tool_overrides.<tool>.approvals` review covers it.
- **The audit marker is truncated by design.** Each `field=pattern` value in `[auto-allowed: …]` clips to
  32 characters. The marker is appended to *every* auto-allowed run's `Event.summary`, and approvable
  tools accept large or credential-bearing args (`terminal_write_file.content`, MCP tool args) — an
  untruncated pattern would copy them into the audit log on every run. Field **names** are never
  truncated: which rule matched is the point.
- **Accepted:** the Conf-panel save path shares the existing settings **last-write-wins** draft contract
  (two devices editing settings concurrently); the bubble grant path does **not** — it is server-side and
  atomic under the one settings write lock.

---

## 3. Residual & accepted risks + known gaps

Honest register. "Accepted" = intended within the boundary; "gap → step N" = a real gap tracked in
[`PRE_DEPLOY.md`](./PRE_DEPLOY.md).

| Item | Status | Why / where |
|---|---|---|
| Confirm-tokens don't authenticate | **accepted** | The tailnet is the auth (§1/§2.3). By design. |
| **Confirm-tokens are in-memory** — a backend restart between mint and confirm orphaned the pending bubble | **closed (step 4b ✓ 2026-07-02)** | Robustness, not a breach — and no longer a gap: PRE_DEPLOY step 4b (J3) shipped server-side re-mint. The durable persisted `AWAITING_CONFIRM` call + the explicit `execute` are the confirmation, so `session.resume(execute)` re-mints via `ActionService.confirm_token_for()` and one click still works after a restart / 120 s expiry / reload. Test-locked by `test_confirm_recovery_j3.py`. (ACA Slice 1 later ruled the *orphan* token is CONSUMED on re-mint — §2.3.) |
| Secret redaction / masking correctness | **test-locked (step 3 ✓)** | `test_secret_hygiene.py` proves every real secret is masked/collected/redacted, non-secrets never are, and the policy gate can't drift. Note redaction is still *best-effort within* the `env`/`headers` maps (secret-named entries only) — by design (§2.4). |
| `paramiko` uses `AutoAddPolicy` (accepts unknown SSH host keys; no `known_hosts` pinning) | **accepted** | Acceptable only inside the trusted tailnet (`adapters/ssh.py`). Would need pinning if the boundary widened. |
| Local shell (`!`) + agent `run_shell` = remote code execution by design | **accepted, off by default** | See §5. Gated + off by default; RCE is the point when enabled. |
| `debug` = RCE surface | **accepted, off by default** | `ServerCfg.debug=False`; never enable on anything reachable. |
| Dev Vite server exposes the API on the LAN (`0.0.0.0` + `/api` proxy) | **accepted, dev-only** | §2.1 dev-mode exposure; trusted home LAN. |
| Prod backend on `0.0.0.0:5433` (LAN + tailnet, plain HTTP) | **accepted, owner waiver 2026-07-10** | §2.1; trusted home LAN; strictly narrower than the dev path above; Serve HTTPS remains for mic/secure-context. |
| MCP / OpenAPI tool providers are external surfaces | **accepted, annotated** | Risk-annotated per tool; never grant blanket `ALLOW`. |
| **`!exec` steer gate is enforced at DRAIN, not only at enqueue (D41)** | **accepted, fail-closed** | A `!<cmd>` steered into a busy turn checks `shell.user_exec_enabled` at enqueue (UX 403) **and again, live, at drain** — the drain is the only place `run_shell`@FULL actually runs, so disabling the shell mid-queue **drops** the queued command instead of running it. **Commit-before-run:** a harvested/crashed queue **loses** the command rather than double-running it (for a shell command, lost-on-crash beats double-run). |
| **A persisted approval also auto-allows AGENT + headless re-runs of that exact call (D44)** | **accepted, deliberate** | Owner ruling ④ — approvals are actor-agnostic (§2.5). A grant given at a chat bubble silences the same call for the agent and headless subagents. Bounded by args-exact pinning, allow-only matching, the un-approvable forced-confirm rung, and the mandatory `[auto-allowed: …]` summary marker; revocable any time in Conf → Tools. Fail-closed on a miss (headless CONFIRM → DENIED, unchanged). |
| **Approvals never expire in v1 (D44)** | **accepted** | No TTL / decay-on-disuse (that needs a queryable fire-log = an events-schema migration; reserved). A grant stands until revoked in Conf → Tools or `config.yaml`; revocation is live from the next invoke. |
| **The steer queue is in-memory (D41)** | **accepted** | A backend restart loses queued-but-undrained steers — no durability is promised (mirrors the in-memory confirm-token stance). Single-user, the queue is seconds-lived; accepted. |

---

## 4. Secret-handling rules

**The invariant:** a secret value never appears in a tool result, API response, log, SSE frame, commit, or
code. Upheld by:
- **Storage:** SSH creds + API keys live in `config.yaml` (gitignored, masked on API read); scalar overrides
  in `.env` (gitignored). `config.yaml`, `.env`, `clients/`, `*_prompt.*` are all gitignored — never commit
  or echo them.
- **Output:** anything that captures command output passes it through `redact()` before it leaves the process
  (§2.4). New execution paths **must** route captured output through `redact()`.
- **Display:** the config API read masks secret-keyed values (`mask_secrets`); a masked value round-trips back
  to the stored real secret on save, so editing config in the UI never blanks a secret.

*(Enforced by `backend/tests/test_secret_hygiene.py` — PRE_DEPLOY step 3 ✓.)*

---

## 5. The shell escape hatches (opt-in RCE)

Two independent, **off-by-default** gates in `config.py ShellCfg`:
- **`user_exec_enabled`** (default **False**) — the `!<cmd>` composer escape hatch (`POST /api/exec`): the
  owner types a shell command that runs on the backend host. Pure RCE by design; off until you turn it on.
  *(When a `!` is **steered** into a busy turn (D41), this gate is re-checked **fail-closed at drain time**
  — the only place the command runs — so disabling the shell mid-queue drops the queued command; §3.)*
- **`agent_exec_enabled`** (default **False**) — the agent's `run_shell` tool. Even when enabled, `decide()`
  **denies `run_shell` unless the caller is `FULL` privilege** — so the agent can't reach raw shell casually.
- Guardrails when enabled: cwd = `shell.workdir` (blank → `$CTRLB_HOME`), `timeout_s=60`, output capped at
  `max_output_chars=6000`, and output redacted (§2.4).

Prefer a **typed action** over widening a raw shell path. The curated open-terminal tools (with per-op risk)
are the intended way to give the agent shell-like reach, not the raw `!` escape.

---

## 6. Safe-defaults checklist (verify before exposing on the tailnet)

- [ ] Backend bind matches the §2.1 policy — code default `127.0.0.1`; the deployed PROD unit binds
      `0.0.0.0` **per the 2026-07-10 owner waiver** (trusted home LAN + tailnet; never a public interface).
- [ ] `debug` = **off** (`ServerCfg.debug=False`).
- [ ] Tailscale Serve HTTPS up; the app reachable **only** via `https://<host>.<tailnet>.ts.net`, nothing
      port-forwarded publicly.
- [ ] `shell.user_exec_enabled` / `shell.agent_exec_enabled` set to what you actually intend (default off).
- [ ] No secrets tracked in git: `config.yaml`, `.env`, `clients/`, `*_prompt.*` all gitignored.
- [ ] MCP / OpenAPI tools reviewed + risk-annotated; no blanket `ALLOW`.
- [ ] **`tool_overrides.<tool>.approvals` reviewed** (§2.5) — every standing "always allow" rule is one you
      meant to grant; no unintended widening (a rule that omits fields, or globs a destructive arg); remember
      each one also silences that call for the agent and headless subagents.
- [ ] `config.yaml` present and owner-only readable on the host (`chmod 600`).

---

## References
- Enforced rules for agents: [`AGENTS.md`](../AGENTS.md) §6 · Deploy/exposure: [`DEPLOY_EMMA.md`](./DEPLOY_EMMA.md) · DECISIONS D1 (Tailscale Serve HTTPS), D3 (hybrid execution model), D32 (topology), D44 (persisted approvals — §2.5).
- Code anchors: `config.py` (`ServerCfg`, `ShellCfg`, `ApprovalRule`/`ToolOverride`, `secret_values`/`mask_secrets`) · `core/permissions.py` (`decide`, `canonical_str`/`glob_escape`/`exact_arg_pins`/`approval_match`) · `core/tool.py` (registry, `ToolSpec`) · `services/action_service.py` (confirm-tokens, the gate consult + the `[auto-allowed: …]` marker) · `runtime.py` (`grant_approval`, `settings_write_lock`) · `core/redact.py` · `adapters/ssh.py`.
- Hardening that closed the flagged gaps: [`PRE_DEPLOY.md`](./PRE_DEPLOY.md) steps 3 (secret-hygiene tests) + 4b (stale confirm-token recovery) — **both shipped 2026-07-02; the §3 register carries no open "gap → step N" rows.**
