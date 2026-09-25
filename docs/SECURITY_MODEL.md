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
  **⚠ PREMISE CORRECTION (D65, 2026-08-24) — this line was never the whole answer for WRITES.**
  "No session to steal" answers *session riding*; it does not answer a **cross-origin write that needs
  no session at all**, because with no auth every request is already privileged. **That is not new and
  it is not the media path's doing:** a CORS-safelisted `POST` has always been *send-able* cross-origin
  — CORS blocks the attacker's read-back, never the send — so the state-changing safelisted POST routes
  we already ship are a **pre-existing residual**, enumerated as a class in §2.7 and owned by Phase 19.
  What D65 changes is narrower and worth stating exactly: the media path is the first surface that
  writes owner **FILES**, and the first where **the shape of the request is the whole defence**. **What
  holds that one is the CORS preflight, not the absence of a session — see §2.7**, which is the
  reference for any future unauthenticated write path.

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
  (the `server:` key in `frontend/vite.config.ts`). So while the dev server runs, anyone on the **local LAN** (not just the
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
  **One deliberate exception:** `POST /api/access/serve` invokes `tailscale_serve_enable`/`_disable` at
  `Actor.USER, Privilege.FULL` (`api/access.py:50-52`), so the two `Risk.MED` Serve actions
  (`services/actions/tailscale.py:213,229`) run without a confirm bubble — enabling/disabling the owner's
  own HTTPS front door *is* the explicit user act, and re-confirming a toggle the owner just flipped in
  Conf → Access buys nothing. The path is itself gated: the endpoint 403s unless `tailscale.enabled`
  (D20), the actions are `ui_exposed=False`/`agent_exposed=False` (unreachable from the generic action
  API and from the agent), and both are `idempotent`.
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

### 2.6 Core Memory — an agent-writable durable corpus (D57)

Tier-2 long-term memory (`services/agent/core_memory.py`, off by default — `memory.longterm.backend:
null`) is the first place **the agent writes files the owner did not author**: a markdown corpus
(`memories/core/` by default) whose routing index is injected into the system context every turn while
the slot is on. Two rails hold it, plus one framing:

- **Root confinement.** `validated_root()` (`core_memory.py:838-868`) resolves
  `memory.longterm.core.root` and **refuses** rather than clamps: a relative root must be a strict
  descendant of the memory dir (`..`/`.` escapes refused), and any root is refused if it *contains*
  `$CTRLB_HOME`, `config.yaml` or the db (the D26 `_safe_root` spirit), or if it overlaps a tier-1
  store — a `MEMORY.md`/`USER.md` file or the per-agent `agents/` tree, in **either** direction. A
  refusal turns the whole feature off (no root → no reads, no writes); tier 1 holds the same invariant
  from its side, because `AgentDef.memory_dir` makes the reserved tier-1 set dynamic.
- **The write-side secret gate.** Every create/edit gates the **complete resulting file content**
  (never the delta) through `_guard_secrets()` on `Settings.secret_values()` (§2.4) and refuses the
  write without echoing the value. It is a containment check on **known** configured values — shape
  detection is an explicit non-goal — and it is **BEST-EFFORT by construction, not a boundary:**
  values shorter than `_SECRET_MIN_CHARS = 8` are skipped (a 1-char placeholder key is a substring of
  every file and would brick the write path), so a real ≤7-char credential is *outside* the rail. Full
  reasoning: [`CORE_MEMORY_PLAN.md`](./CORE_MEMORY_PLAN.md) §14b. Two **documented no-gate carve-outs**:
  `delete` (its index write only *removes* lines — a strict subset of content that already passed, and
  gating it would make the one operation that cleans up a leak refusable by that leak) and the
  byte-identical **crash-retry** (gating a repair of content this call did not write would turn a
  self-heal into a refusal over the owner's own on-disk file).
- **Framed as fallible data, not instructions.** The injected index and every recall result are wrapped
  in the `core_memory_policy` / `core_memory_recall` prompts (`services/agent/prompts.py`), whose
  data-not-instructions clause is the only thing marking corpus text — written by **past turns**, and
  possibly copied in from another tool — as untrusted. Treat that clause as load-bearing when editing
  those prompts (Phase 18 overrides can rewrite them).

### 2.7 The media write path — typed, raw-body, registry-confined (D65)

`PUT`/`DELETE /api/media/{ns}/files/{role}/{filename}` (`api/media.py`, persist pipeline in
`core/media.py`) is the **first and only endpoint that writes owner files to disk**. It reverses
D52 §5.4's "no write API, ever" for exactly one typed shape, and the reversal is
**unconditional — there is no kill switch** (owner ruling; the standing whole-feature-toggle rule
knowingly waived, D65). What makes that safe is not a flag but four rails.

**Status (2026-08-25): BUILT and test-pinned.** The routes, the persist pipeline, the two filename
tiers, the `.part` boot sweep and the `config_version` 1 → 2 fold landed at the media-manager
phase's S1 (MEDIA_MANAGER_PLAN §12). Everything below is now DESCRIPTIVE of shipped code as well as
normative for anything that touches it — including **the two negatives, which are asserted by
`backend/tests/test_media_write_d65.py`**: no CORS middleware anywhere in the app (middleware stack
+ a source scan), and no POST/multipart route on the media surface. It also stays the reference for
any future unauthenticated write path.

- **The VERB is the CORS control.** The realistic attacker here is not a tailnet peer (there are
  none, §1) — it is **the owner's own browser on some other origin**, and the only cross-origin
  request a page can fire *without* a preflight is a **CORS-safelisted** one: `GET`/`HEAD`/`POST`
  with a safelisted content type, `multipart/form-data` included. That is why uploads are
  **raw-body `PUT`, never multipart and never POST**: a non-safelisted verb forces an `OPTIONS`
  preflight, **ctrl-b mounts no CORS middleware and answers no `Access-Control-Allow-Origin`**, so
  the write dies unsent. The attacker cannot read the response either way; the point is that the
  *write itself* never happens. **This is load-bearing: adding CORS middleware — or accepting a
  multipart/POST upload — silently removes the defence.** S1 must pin both with tests plus an
  architecture guard, and neither may be introduced without revisiting D65. **The form-body guard is
  now APP-WIDE** (R73 §8.2, 2026-09-15): this section's own walk is scoped to `/api/media`, which made
  it blind to D70's two multipart import routes on another router — so every live route is asserted
  against one allowlist, `{POST /api/voice/stt}`, in
  `test_media_write_d65.py::test_no_route_in_the_whole_app_declares_a_form_body_outside_the_allowlist`.
  The path-scoped walks stay as the per-surface half; the app-wide one is what cannot go blind again.
- **ONE URL SPACE, ONE "not there" (S4 rider, ruled 2026-08-25).** A READ of a file path whose
  namespace is not mounted — a tree that failed the boot shape check, or one the registry never had —
  answers **404 for every verb**, never a `405`. It used to answer 405: with no mount registered
  nothing FULLY matches, so Starlette falls back to the write route's PARTIAL (path matches, method
  does not) and the response carries `Allow: PUT, DELETE` — telling an unauthenticated prober that a
  write API exists at that exact URL, on a namespace this server has already refused to serve. That
  is precisely what the read side's own rule forbids: *the 404 is indistinguishable from "not
  there"*. `api/media.py#media_file_absent` is the rung below the mounts (GET **and HEAD** — FastAPI's
  `APIRoute` does not add HEAD the way Starlette's does, and a 405 with no body is the same leak),
  registered after the mount loop so it cannot shadow them and **outside** the prod-only SPA branch.
  The last part is not tidiness: the leak was reachable in **DEV ONLY**, because with `frontend/dist`
  present SYS-5's `/api/{rest:path}` GET catch-all full-matches and answers 404 — so the shipped
  answer differed by deployment profile, and the profile that leaked is the one the owner develops in.
  **No OPTIONS handler was added**, deliberately: answering a preflight is exactly what the verb rail
  above depends on this server never doing.
- **Containment by registry, not by string handling.** A write resolves only inside a registered
  `$CTRLB_HOME/media/<ns>/<role>/` directory (`MEDIA_NAMESPACES`); the filename must satisfy the
  admission predicate (NFC, no separators/`.`/`..`, no `<>:"|?*`/C0/DEL, no leading dot or trailing
  dot-space, not a DOS device name, ≤255 UTF-8 bytes, allowlisted extension) and is **rejected with
  a reason, never sanitised**. `DELETE` is deliberately WIDER (an SSH drop the app would refuse to
  mint must still be removable) with one exception: names the path API would REINTERPRET — a
  backslash, or a drive qualifier like `C:foo.png`, which `ntpath` resolves relative to a drive — are
  refused there too, whatever the server OS, or a delete could unlink a file the request never named. The read side's rules are unchanged (§ the hardened mount: closed
  extension allowlist, server-set Content-Type, `nosniff`, no symlinks, regular files only).
- **The bytes are checked before the name exists.** mkstemp `.part` in the role's app-owned
  `.parts/` scratch dir → `fchmod 0644` → stream with a byte counter (`413` past
  `media.write.max_bytes`) → fsync → **`probe_image` header probe** (`415` when the bytes and the
  extension disagree) → `os.link` no-clobber (`409`, same filesystem so it stays atomic) → unlink the
  temp → `fsync_dir`. **A rejected upload leaves zero bytes**, and a boot sweep empties those
  `.parts/` dirs (registered roles of HEALTHY namespaces only). **A `.parts` that is a symlink — or a
  file — is refused at BOTH ends**: the sweep will not walk it, and the write path will not create a
  temp through it, because `mkdir(exist_ok=True)` accepts an existing link and `mkstemp` would then
  write outside the registered tree entirely (a 500 naming the path: the request is fine, the
  server's tree is not). **Scope of the sweep, stated honestly:** the scratch DIRECTORY is what keeps
  it off owner territory — an owner may legitimately drop a `.ctrlb-upload-x.part` into a role folder
  and the sweep never looks there — while INSIDE `.parts/`, which is declared app-owned scratch, the
  naming convention is the contract; what is enforced (and test-pinned) is that deletion reaches
  exactly the convention names and nothing else in that directory. (`fchmod` is expressed as an
  `os.supports_fd` capability probe, not an OS branch: the server-OS allowlist is closed,
  ARCHITECTURE §6.)
- **Still no decoder on the server.** No Pillow, no decode, no re-encode, no thumbnails — header
  probes only. An untrusted-decoder surface was refused at D52 §10.4 and stays refused; all image
  work (crop, resize, EXIF/GPS stripping, re-encode) happens in the **client's** worker.

**Residuals this path made worth naming** (whole-API properties, not new holes; both recorded in
[`HARDENING_PLAN.md`](./HARDENING_PLAN.md) §8.2 for Phase 19):

- **DNS rebinding.** A page on an attacker domain that re-resolves to the app's LAN/tailnet address
  becomes same-origin and is no longer subject to CORS at all. This has always been true of the
  whole API; the write path only raises the value of the target. **Closed as an opt-in rail
  (2026-09-15, R73):** `server.trusted_hosts` mounts `TrustedHostMiddleware` with the deploy's real
  names — see §2.9 for the mechanics and the empty-list trap. It ships EMPTY, so the residual stands
  on any deploy that has not filled it in, and it is scoped to the cleartext bind either way (TLS
  makes the Serve front door unrebindable).
- **Safelisted-reachable POST mutations — a CLASS, and a pre-existing one.** A cross-origin page
  can *send* a CORS-safelisted `POST` (CORS withholds the read-back, not the send), so any POST route
  that executes without needing a JSON content type is reachable that way. Two shapes exist here:
  **multipart** (`POST /api/voice/stt` — writes no owner file, spends an STT call) and
  **bodyless / path-param** routes, which run regardless of what content type a form sends — e.g.
  `POST /api/automations/{id}/run-now`, `POST /api/integrations/rediscover`,
  `POST /api/agent/turns/{thread_id}/cancel`. (JSON-body POSTs are effectively content-type-guarded:
  a urlencoded form body 422s before anything runs.) **None of this is new and none of it is the
  media path's doing** — it is why §1's premise correction scopes D65's "first surface" claim to
  owner FILES. Listed so the class is enumerated rather than forgotten; **the enumeration and the
  disposition belong to Phase 19 Packet ③** (HARDENING §8.2), and the three routes above are
  examples, not the list.

**Safe-defaults fit:** nothing here is a toggle, so nothing here is a checklist item to *set*. The
checklist gains one line (§6) because the property that must survive is a **negative**: no CORS
middleware, and no upload route that a cross-origin form could post to.

### 2.8 Chat attachments — staged raw-body writes, thread-confined reads (D68)

The second owner-file write surface, deliberately the same shape as §2.7 (design:
[`ATTACHMENTS_PLAN.md`](./ATTACHMENTS_PLAN.md); the §2.7 CORS reasoning applies verbatim):

- **Writes** are raw-body `PUT /api/attachments/staging/{filename}` — non-safelisted, so the
  preflight-refusal barrier §2.7 establishes holds here too, and the D65 no-CORS/no-multipart
  test pins EXTEND to this route rather than being re-derived. The filename passes the ONE shared
  bare-name predicate at mint, before any byte streams; admission is the streamed counter
  (413 mid-body), then magic-byte sniff — SVG is never admitted as an image; text kinds (which
  bytes cannot authenticate) take an extension/MIME allowlist + bounded strict UTF-8 decode.
- **Identity is server-minted**: staging ids are unguessable random hex; the chat POST's claim is
  the ONLY writer into `$CTRLB_HOME/attachments/{thread_id}/` (test-pinned), constructs every
  persisted part itself, and refuses consumed/expired ids. The client never names a path.
- **Reads** are two confined surfaces: `GET /api/attachments/{thread_id}/{name}` (D65-mount
  serving pattern; only sniffed image types serve inline, text/PDF serve with
  `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment` — stored bytes are never
  active browser content) and the `read_attachment` typed tool (read-only, LOW; confined to the
  CURRENT thread via the server-owned `InvocationContext.thread_id`, fail-closed when absent,
  never a model-supplied argument).
- **Dereference discipline** (both surfaces): server-stored refs only, one bare-name predicate,
  regular files only (`lstat`, no symlinks), resolved-parent-equals-thread-dir check — the §2.7
  rules reused, not re-implemented.
- **pypdf parses untrusted bytes** at claim: bounds (`max_pdf_pages`/`max_extracted_chars`) are
  honest ITERATION stops, not a CPU/memory kill bound (accepted, owner-ruled — single user, the
  uploader is the owner); failure is a recorded message, never a crash; the original never leaves
  the store.
- **Retention is closed-loop**: thread delete removes the thread's directory; the boot sweep
  reclaims aged unclaimed staging and unreferenced files inside live thread dirs (the
  rename-vs-commit crash window), so no attachment bytes outlive their referent.

**Safe-defaults fit:** like §2.7, no toggle — the surviving properties are negatives (no CORS
middleware, no multipart route, no client-named paths) plus the two confinement pins above.

### 2.9 Character-card + lorebook imports — the third owner-file write surface (D70)

The third and last surface that writes owner files, and the one that shipped in the WRONG shape and
was corrected (R73, 2026-09-15 — [`research/R73-cross-origin-write-defense.md`](./research/R73-cross-origin-write-defense.md);
design of record [`ROLEPLAY_PLAN.md`](./ROLEPLAY_PLAN.md) §5/§6):

- **Writes are raw-body `PUT /api/agents/import` and `PUT /api/lorebooks/import`.** They shipped as
  multipart `POST`s, defended by the argument that they "answer with the created object". That is not
  a defence: **CORS withholds the RESPONSE, never the send.** A safelisted request — `GET`/`HEAD`/
  `POST` with `multipart/form-data`, `application/x-www-form-urlencoded` or `text/plain` — is
  *delivered and executed*; only the reply is kept from the attacker's script. So any page the owner
  opened, on any origin, could `fetch(…, {method:"POST", mode:"no-cors", body: formData})` and land
  `agents/<slug>/agent.yaml` + `SOUL.md` carrying attacker-authored persona, `greeting` and
  `post_history` in the owner's own agent surface — persistent, model-facing prompt injection,
  repeatable and never needing to read a byte back.
- **The verb IS the control, and R73 §1 is why it is sufficient against browsers.** No browser API
  can emit a cross-origin `PUT` without a preflight: `fetch`/XHR set the unsafe-request flag, so a
  non-safelisted method is *always* preflighted whatever the content type; `mode: "no-cors"` throws a
  `TypeError` on a non-safelisted method; an HTML `<form>`'s `method` attribute has exactly the
  keywords `get`/`post`/`dialog` — **there is no PUT**; `sendBeacon` and `<a ping>` are POST-only (and
  `<a ping>`'s body is the fixed string `PING`). `X-HTTP-Method-Override` is a custom header, hence
  preflighted, and this app honours no method override anywhere. The preflight is then refused by
  omission: no CORS middleware is mounted and no `OPTIONS` handler exists, so nothing ever answers one.
- **No filename rides either URL** (unlike §2.7/§2.8, which take `{filename:path}`), because neither
  handler reads one: the card CONTAINER is sniffed from magic bytes and a book's shape is read off the
  parsed value. The body streams into a counted buffer and is refused the moment it crosses its cap
  (`roleplay.card_import.max_bytes` · `lorebooks.max_import_bytes`) — the §2.7 cap+1 posture, never a
  bare `await request.body()`.
- **The pin is now APP-WIDE** (`test_media_write_d65.py::test_no_route_in_the_whole_app_declares_a_form_body_outside_the_allowlist`).
  D65's and D68's form-body walks are path-scoped (`/api/media`, `/api/attachments`), so both were
  blind to a new router by construction — which is exactly how D70 landed two multipart POSTs with
  every existing guard green. Every live route is now walked against one explicit allowlist:
  **`{POST /api/voice/stt}`**, the pre-existing residual §2.7 enumerates (it spends an STT call and
  writes no owner file). Adding a row there is a security decision, not a refactor.
- **Card content is accepted as UNTRUSTED PROSE, deliberately.** A character card is prompt text by
  definition, so importing one is consenting to model-facing text the owner did not write; what is
  refused is text with *side effects*. `strip_executable` is a recursive key denylist (scripts, hooks,
  Risu/ST extension modules) reporting every removal by exact RFC-6901 path, and the import REPORT
  surfaces `post_history` verbatim on purpose — it lands closest to generation, so it is the one field
  that must never be invisible. Readers are capped end to end (body 15 MB at cap+1, decoded JSON 2 MB,
  CHARX entry count/entry bytes/total checked against DECLARED sizes before any decompress, traversal
  refused, `RecursionError` caught at the route); an embedded avatar goes through the D65 media probe
  and closed extension allowlist and is named from the slug grammar.
- **Lorebook writes** land one YAML per book under `$CTRLB_HOME/lorebooks/`, through the same
  `edit_config_yaml` atomic write the agent editor uses; slugs are validated on the shared READ seam
  too (`load_book`), because `lorebooks.books` and an agent's own `lorebooks:` list are hand-edited
  files that never pass the API's guard and `../something` would otherwise read outside the tree. A
  book that is missing or malformed is a log line and a skip — never a failed turn.

**Belt and braces: `server.trusted_hosts`** (additive, ships EMPTY = not mounted). The verb rail has
one residual it cannot touch: **DNS rebinding** does not defeat it, it removes its premise — the
attacker's page re-resolves their own name to this machine, so the request is genuinely same-origin,
no preflight is required and `Origin`/`Sec-Fetch-Site` both say same-origin. The name in `Host` is the
one thing the attacker does not control, which is why every peer with our threat model (Ollama,
ComfyUI, Syncthing) ships a host check. Non-empty ⇒ Starlette's `TrustedHostMiddleware` is mounted at
app construction (`main._mount_trusted_hosts`) and answers `400 Invalid host header` to every other
name — on **`websocket` scopes as well as `http`**, so it also backs up the D71 WS `Origin` rail.
Scope-limited by construction: rebinding reaches only the **cleartext** bind (prod's `0.0.0.0` waiver,
§2.1, and dev's Vite), because over HTTPS the Serve cert cannot match an attacker's name. Two
mechanics are load-bearing and test-pinned (`test_trusted_hosts_r73.py`): an EMPTY list must not be
mounted (a mounted empty allowlist 400s every route, the Conf UI included — recovery is hand-editing
`config.yaml`), and a malformed pattern refuses at the config gate rather than as an `AssertionError`
at import. **No global `Origin`/`Sec-Fetch-Site` rule was added**, deliberately (R73 §5): Fetch
Metadata is not sent to a non-trustworthy origin at all, an https attacker page posting to our http
port legitimately sends `Origin: null`, and a fail-closed rule would break the owner's own `curl`.

**Safe-defaults fit:** the import surfaces add no toggle — the surviving property is the app-wide
negative above. `trusted_hosts` is the one thing here to *set*, and §6 carries its row.

### 2.10 The live-voice WebSocket — the one admitted ingress that CORS cannot reach (D71)

`WS /api/voice/live` (`api/voice.py`, relay in `services/voice_live.py`) is the **only WebSocket in
the codebase**. "SSE down, HTTP up" was an implicit invariant until live voice; D71 §3.2 admitted
exactly one exception, for the one thing neither half of that rule can carry — **continuous media
ingress**, minutes of raw pcm16 from the phone. It is **not an agent transport**: a spoken turn
still goes out over `POST /api/agent/chat` and streams back as SSE, so the socket carries audio up
and JSON status down and **no audio ever rides the downlink**. Keeping it that narrow is the whole
basis of the admission; widening it to carry agent traffic re-opens a decision, not a refactor.

**Browser CORS does not protect a WebSocket** — there is no preflight on an upgrade. So the absence
of CORS middleware, which is the entire defence for the §2.7/§2.8/§2.9 write paths, buys this route
*nothing*, and four rails stand in its place:

- **The `Origin` rail — pre-`accept()`, and the actual boundary.** `_origin_allowed(origin, host,
  allowed)` is a pure function so it can be reasoned about and tested directly. An origin must be
  **PRESENT** (a browser always sends one; absent means a non-browser client, which is what the
  tailnet trust boundary deliberately does not extend to *on this route*) and either appear
  **verbatim** in `voice.live.allowed_origins` — exact strings, never patterns, because a pattern is
  how an allowlist grows a bypass — or have an `Origin` whose `host:port` equals the request's own
  `Host`. A refusal closes **before** `accept()`, so a rejected origin cannot even learn whether the
  feature exists. The `allowed_origins` escape hatch exists for a second Serve name; leave it empty
  unless a measurement says otherwise (S3.5 measured the same-host rule passing through Serve→Vite
  with it EMPTY).
- **The feature gate — also pre-`accept()`.** `(voice.live.enabled OR voice.live.dictation)` AND a
  configured live chain AND a resolvable target/policy, else close; a browser sees a failed
  handshake (HTTP 403), matching how the mic simply is not offered when `stt` is unconfigured.
  **⚠ Read that gate exactly: `voice.live.enabled` is the CALL's switch, not the socket's.** With
  `enabled` OFF and `dictation` ON — the dev box's own configuration — the relay is reachable.
  `voice.enabled` (the master) outranks both. Do not reason about this route's off-state from
  `enabled` alone.
- **Admission is capped, and the cap is renderable.** `voice.live.max_sessions` is taken
  post-`accept()` so the client gets a **typed** `{"type":"error","code":"busy"}` plus close **1013**
  ("try again later") it can render, rather than an opaque handshake failure indistinguishable from
  a misconfiguration. The slot has exactly ONE release, latched as the single `finally` on the
  single acquire, so a failing upstream close cannot leak it.
- **The relay bounds what it will relay.** Malformed/unknown control frames, binary before `start`,
  a second `start`, or an oversized frame close 1008. The client supplies NO session parameter
  beyond `start.sample_rate` (bounds-validated at the same boundary): the server-VAD knobs in the
  relay's one `session.update` come from config alone (D76 §D deleted the in-call
  `start.vad_threshold` override; an unknown `start` key is ignored). Two budgets ride one rolling window because
  they bound two different resources: a **count** budget (per-message CPU) and an **ms-of-audio**
  budget (throughput) — together ~2× realtime, which is what stops a compliant-*looking* client from
  shipping ~100× realtime inside the count budget. A realtime client is untouched.

**Secrets:** the upstream key rides an `Authorization: Bearer` header the relay injects server-side
(`voice_live.py`); it appears in **no log record and no downlink frame** on any failure path, which
is test-pinned across the failure taxonomy (`upstream_refused` · `upstream_lost` · `session_limit` ·
the start timeout). Unrelated to secrecy but load-bearing beside it: **the relay never sends
`input_audio_buffer.commit` on any path** (R70 §1.2 arm A) — that is a correctness invariant, not a
security one, but it lives in the same code and is equally easy to "helpfully" add back.

**What this does NOT defend against: DNS rebinding.** The same-host rule compares two values the
*attacker* chose — a page served from a name they control, rebound to this machine's address, sends
a matching `Origin` and `Host` and passes. That is the app's pre-existing posture, not a new hole:
rebinding equally removes the premise of the absence-of-CORS defence on every plain-HTTP route here
(§2.7's residual). The app-wide answer is **`server.trusted_hosts`** (§2.9), which backs this route
up too — `TrustedHostMiddleware` runs on **`websocket` scopes as well as `http`**, so a `Host`
mismatch answers 400 at the handshake, before routing. It ships EMPTY, so today this residual stands
here exactly as it stands everywhere else.

**Safe-defaults fit:** `voice.live.enabled` and `voice.live.dictation` both default **OFF** (no
socket route reachable at all until one is flipped), and `allowed_origins` defaults **empty** (the
same-host rule alone). §6 carries the row.

### 2.11 The call trail — a debug-gated write endpoint (D77)

`POST /api/voice/live/trail` (`api/voice.py`; store `services/call_trail.py`) appends the browser's
half of a live call's diagnostic record; the relay writes its half in-process. Four rails:

- **Off means absent.** With `voice.live.debug` off (the default) the route is a **404**, the relay
  writes nothing, and the client sends no `call_id` in `start`.
- **JSON only — the preflight is the CSRF control** (§2.7's rule). The handler parses its own body
  and **415s anything but `application/json`** (a form, `text/plain`, a typeless body — every shape a
  cross-origin page can send unpreflighted). The `keepalive` flush keeps that type; no `sendBeacon`.
- **The id is the filename guard:** one canonical-UUID pattern (`CALL_ID_PATTERN`), shared with the
  relay's `start` parse. **Bounded:** body ≤ 64 KB counted as it streams (413), ≤ 200 entries of
  ≤ 2 KB each (422), `voice.live.trail_keep` files kept. **No read endpoint.**

Files: `$CTRLB_HOME/calls/<call_id>.jsonl` (dir 0700, files 0600) — the owner's transcripts (once, in
the relay's `transcript` frames) and gate numbers; **no secrets** (the bearer canary is test-pinned).

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
| **The media write API will have no kill switch (D65)** | **accepted, owner waiver 2026-08-24** | The whole-feature-toggle rule is knowingly waived: `PUT`/`DELETE /api/media/…` is specified unconditional. A toggle over one typed, allowlisted, registry-confined path buys nothing a rollback does not, and stays trivially additive (§2.7). *Ruled at S0; the routes land at S1.* |
| **DNS rebinding reaches the whole API** (an attacker-controlled name re-resolving to the LAN/tailnet address is same-origin, so CORS never applies — and it removes the premise of the §2.10 WS `Origin` rail the same way) | **open BY OWNER CHOICE — the rail is BUILT** | Pre-existing, whole-API. **`server.trusted_hosts` closes it (§2.9, R73/D72 ⑥) and is shipped** — but it ships **EMPTY = not mounted**, and the owner ruled 2026-09-16 that it stays empty until they opt in (the rail costs every name and address they browse by; a missing name answers 400 everywhere with a hand-edit of `config.yaml` as the only recovery). So the residual stands on this deploy, by decision rather than by omission. Scoped to the cleartext bind either way — TLS makes the Serve front door unrebindable. *(No longer a Phase 19 item: D72 closed the design question.)* |
| **The one WebSocket is an ingress CORS cannot reach** (`WS /api/voice/live`, D71) | **accepted, gated + off by default** | §2.10. No preflight exists on an upgrade, so the absence of CORS middleware protects nothing here and the pre-`accept()` `Origin` rail is the boundary instead. Bounded by: both feature toggles defaulting OFF, a `max_sessions` slot, the relay's count+ms burst budgets, and the bearer never reaching a log or the downlink. Media ingress ONLY — a spoken turn still rides `POST /api/agent/chat` + SSE. |
| **Safelisted-reachable POST mutations are a CLASS** — multipart (`POST /api/voice/stt`) plus the bodyless / path-param routes that run whatever content type a cross-origin form sends | **pre-existing, open → Phase 19** | CORS withholds a cross-origin read-back, never the send. Not introduced by D65 — surfaced by it, which is why §1's correction scopes the "first surface" claim to owner FILES. Enumeration + disposition = Packet ③ (HARDENING §8.2); §2.7 names three examples. |
| **The steer queue is in-memory (D41)** | **accepted** | A backend restart loses queued-but-undrained steers — no durability is promised (mirrors the in-memory confirm-token stance). Single-user, the queue is seconds-lived; accepted. |

---

## 4. Secret-handling rules

**The invariant:** a secret value never appears in a tool result, API response, log, SSE frame, commit, or
code. Upheld by:
- **Storage:** SSH creds + API keys live in `config.yaml` — the **only** home for a secret (gitignored,
  0600, masked on API read). `.env` carries bootstrap paths + **declared one-level scalars** and cannot
  address a credential by design (UPDATE_PLAN slice 3). `config.yaml`, `.env`, `clients/`, `*_prompt.*`
  are all gitignored — never commit or echo them.
- **Output:** anything that captures command output passes it through `redact()` before it leaves the process
  (§2.4). New execution paths **must** route captured output through `redact()`.
- **Display:** the config API read masks secret-keyed values (`mask_secrets`); a masked value round-trips back
  to the stored real secret on save, so editing config in the UI never blanks a secret. A mask with
  **nothing** to restore (a recreated/renamed provider, a hand-built PUT) is **dropped**, never written
  as the credential — `looks_masked()` judges the shape alone (D48 amendment 2026-07-27).
- **Fingerprints:** anything published *beside* masked values must not function as an **offline
  verification oracle** for the raw secret — compute it from the masked values, or key it. A digest over
  the raw secrets served next to their `ab…yz` masks lets a guess be confirmed offline, with the mask
  cutting the search space. `providers_rev` takes the first option (it hashes the masked providers
  subtree); an HMAC under a server-held key would also satisfy the rule and would additionally stay
  sensitive to a same-mask rotation, at the cost of key lifecycle we do not need here.
- **The second gitignore surface: `GitMemoryBackup`** (`services/agent/memory_backup.py`, D26) — it
  version-controls the memory directory, so it is both a secret-adjacent chokepoint and a `.gitignore`
  author. Three properties keep it safe: it is **local-only** (no remote is ever configured, nothing is
  pushed, so no credential is needed and no auth prompt can block it); the **`.gitignore` it generates**
  excludes config / `clients/` / prompt / db files in case the memory dir is ever pointed somewhere
  broader; and every `git` child runs under a **sanitized environment** (`_git_env()`) that drops every
  ambient `GIT_*` except `GIT_EXEC_PATH` — ambient repo vars override our argv (`GIT_DIR` beats `-C`,
  which is exactly how SYS-20 bit), and `GIT_CONFIG_PARAMETERS`/`GIT_CONFIG_COUNT` inject arbitrary
  config (incl. `core.hooksPath`) and are therefore a **code-execution** vector, not just a
  misdirection one.

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
- [ ] **`memory.longterm.backend` is what you intend** (§2.6; `null` = tier 2 off, the default) and, if
      on, **`memory.longterm.core.root`** points at a directory you are content for the agent to write
      files into — the confinement rails refuse a bad root, but they can't tell a *valid* wrong one from
      a right one. Remember the write-side secret gate is best-effort, not a boundary.
- [ ] **No CORS middleware is mounted, and NO route anywhere in the app accepts `multipart/form-data`
      or a form POST except `POST /api/voice/stt`** (§2.7/§2.9, D65 + R73) — every owner-file write
      path's whole defence is that a cross-origin write is forced into a preflight nobody answers.
      This is a negative to preserve, not a setting to choose; the app-wide walk in
      `test_media_write_d65.py` is what enforces it, and its allowlist is the only place to change.
- [ ] **`voice.live` is what you intend** (§2.10) — `enabled` (the call) and `dictation` (the
      streaming mic) both default **off**, and **either one alone** makes `WS /api/voice/live`
      reachable; `voice.live.allowed_origins` should stay **empty** unless a measurement proved the
      same-host rule insufficient for your ingress (each entry is an exact origin string that
      bypasses the rail — never a pattern).
- [ ] **`server.trusted_hosts` reviewed** (§2.9) — empty means the DNS-rebinding residual stands;
      non-empty means every name NOT listed answers 400 on every route, the Conf UI included. If you
      fill it in, list every name and address you actually browse by (ts.net name · bare hostname ·
      `localhost` · `127.0.0.1` · the LAN literal · the 100.x literal) and then load the panel from
      each of them once before you rely on it.
- [ ] `config.yaml` present and owner-only readable on the host (`chmod 600`).

---

## References
- Enforced rules for agents: [`AGENTS.md`](../AGENTS.md) §6 · Deploy/exposure: [`DEPLOY_EMMA.md`](./DEPLOY_EMMA.md) · DECISIONS D1 (Tailscale Serve HTTPS), D3 (hybrid execution model), D32 (topology), D44 (persisted approvals — §2.5), D65 (the media write path — §2.7; spec of record [`MEDIA_MANAGER_PLAN.md`](./MEDIA_MANAGER_PLAN.md)), D68 (chat attachments — §2.8; [`ATTACHMENTS_PLAN.md`](./ATTACHMENTS_PLAN.md)), D70 (card/lorebook imports — §2.9; [`ROLEPLAY_PLAN.md`](./ROLEPLAY_PLAN.md), dossier [`R73`](./research/R73-cross-origin-write-defense.md)), D71 (the live-voice WebSocket admission — §2.10; [`LIVE_VOICE_PLAN.md`](./LIVE_VOICE_PLAN.md) §3), D72 (the intermission wave: the app-wide form-body pin + `trusted_hosts`).
- Code anchors: `config.py` (`ServerCfg`, `ShellCfg`, `ApprovalRule`/`ToolOverride`, `secret_values`/`mask_secrets`) · `core/permissions.py` (`decide`, `canonical_str`/`glob_escape`/`exact_arg_pins`/`approval_match`) · `core/tool.py` (registry, `ToolSpec`) · `services/action_service.py` (confirm-tokens, the gate consult + the `[auto-allowed: …]` marker) · `runtime.py` (`grant_approval`, `settings_write_lock`) · `core/redact.py` · `adapters/ssh.py` · `api/voice.py` (`_origin_allowed`, the WS admission) · `services/voice_live.py` (the relay's bounds + the injected bearer) · `main.py` (`_mount_trusted_hosts`).
- Hardening that closed the flagged gaps: [`PRE_DEPLOY.md`](./PRE_DEPLOY.md) steps 3 (secret-hygiene tests) + 4b (stale confirm-token recovery) — **both shipped 2026-07-02; the §3 register carries no open "gap → step N" rows.**
