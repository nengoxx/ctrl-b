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
| `spec.confirm` **or** risk `HIGH` | `FULL` → ALLOW, else **CONFIRM** |
| risk `MED` | `AUTO_LOW`/`FULL` → ALLOW, else **CONFIRM** |
| risk `LOW` | **ALLOW** |

- **Privilege levels** (`domain/enums.py Privilege`): `READONLY` · `CONFIRM` · `AUTO_LOW` · `FULL`. The UI
  runs at **`CONFIRM`**; the agent runs at the privilege its `AgentDef` declares (subagents are clamped to
  the parent). So for the normal caller, every HIGH/confirm action **suspends** rather than firing.
- **Risk levels** (`Risk`): `LOW` · `MED` · `HIGH`. Risk + the `confirm` flag are declared per action on its
  `ToolSpec` — the gate is data, not scattered `if`s.
- A suspended call becomes `RunState.AWAITING_CONFIRM` and renders as the confirm bubble.

### 2.3 Confirm-tokens = a UX gate, NOT authentication
When `decide()` returns `CONFIRM`, `services/action_service.py` mints a **single-use, TTL'd token**
(`secrets.token_urlsafe(18)`, `_CONFIRM_TTL_S = 120s`) bound to the exact `(action, args)`, and returns
`needs_confirm: true`. The client re-POSTs with the token to execute (`api/actions.py`).

**This is a deliberate two-step "are you sure", not a security control.** Its own source says so. Concretely:
- It is **not** authentication — it grants nothing; it only confirms intent for one specific call.
- It is **not** a CSRF defense — there is no cross-origin session to protect in a no-auth single-user app.
- Tokens are **in-memory** and bound to `(action, args)` with a 2-minute expiry. **Anyone who can reach the
  endpoint can mint and immediately consume one** — that's fine, because the tailnet is the auth (§1).

### 2.4 Secret redaction
Secrets live in config, never in code (§4). The chokepoint that keeps them out of outputs is
**`core/redact.py` `redact(text, secrets)`** — it masks each secret value (`••••`) in any captured `output`
before it becomes a `ToolResult` / `Event` / log line / SSE frame. Secret values are enumerated by
`config.py secret_values()`, and the config API read masks them via `mask_secrets()`/`_mask()`.

Secrets are identified by **two explicit rules** (not name-substring guessing, which collided with
non-secret fields like `threshold_tokens`): (1) an **exact-name allowlist** of declared secret fields
(`api_key`, `ssh_password`) — so a non-secret field is *never* masked; (2) the arbitrary user-keyed
credential maps (`env`/`headers`) mask only entries whose own key looks secret (`Authorization`,
`X-API-Key`, `*_token`…) while routine ones (`Content-Type`) stay visible. A **drift-guard test**
introspects the whole `Settings` model and fails if a future secret-looking field is left unclassified,
so the classification can't silently rot. (Tests: `backend/tests/test_secret_hygiene.py`.)

---

## 3. Residual & accepted risks + known gaps

Honest register. "Accepted" = intended within the boundary; "gap → step N" = a real gap tracked in
[`PRE_DEPLOY.md`](./PRE_DEPLOY.md).

| Item | Status | Why / where |
|---|---|---|
| Confirm-tokens don't authenticate | **accepted** | The tailnet is the auth (§1/§2.3). By design. |
| **Confirm-tokens are in-memory** — a backend restart between mint and confirm orphans the pending bubble | **gap → step 4b** | Robustness, not a breach: recovery (re-mint / "expired → ask again") is PRE_DEPLOY step 4b (J3). |
| Secret redaction / masking correctness | **test-locked (step 3 ✓)** | `test_secret_hygiene.py` proves every real secret is masked/collected/redacted, non-secrets never are, and the policy gate can't drift. Note redaction is still *best-effort within* the `env`/`headers` maps (secret-named entries only) — by design (§2.4). |
| `paramiko` uses `AutoAddPolicy` (accepts unknown SSH host keys; no `known_hosts` pinning) | **accepted** | Acceptable only inside the trusted tailnet (`adapters/ssh.py`). Would need pinning if the boundary widened. |
| Local shell (`!`) + agent `run_shell` = remote code execution by design | **accepted, off by default** | See §5. Gated + off by default; RCE is the point when enabled. |
| `debug` = RCE surface | **accepted, off by default** | `ServerCfg.debug=False`; never enable on anything reachable. |
| Dev Vite server exposes the API on the LAN (`0.0.0.0` + `/api` proxy) | **accepted, dev-only** | §2.1 dev-mode exposure; trusted home LAN. |
| Prod backend on `0.0.0.0:5433` (LAN + tailnet, plain HTTP) | **accepted, owner waiver 2026-07-10** | §2.1; trusted home LAN; strictly narrower than the dev path above; Serve HTTPS remains for mic/secure-context. |
| MCP / OpenAPI tool providers are external surfaces | **accepted, annotated** | Risk-annotated per tool; never grant blanket `ALLOW`. |

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
- [ ] `config.yaml` present and owner-only readable on the host (`chmod 600`).

---

## References
- Enforced rules for agents: [`AGENTS.md`](../AGENTS.md) §6 · Deploy/exposure: [`DEPLOY_EMMA.md`](./DEPLOY_EMMA.md) · DECISIONS D1 (Tailscale Serve HTTPS), D3 (hybrid execution model), D32 (topology).
- Code anchors: `config.py` (`ServerCfg`, `ShellCfg`, `secret_values`/`mask_secrets`) · `core/permissions.py` (`decide`) · `core/tool.py` (registry, `ToolSpec`) · `services/action_service.py` (confirm-tokens) · `core/redact.py` · `adapters/ssh.py`.
- Hardening that closes the flagged gaps: [`PRE_DEPLOY.md`](./PRE_DEPLOY.md) steps 3 (secret-hygiene tests) + 4b (stale confirm-token recovery).
