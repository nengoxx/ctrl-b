# R49 — "Sign in with ChatGPT" (OpenAI-Codex OAuth) as a ctrl-b provider

**Date:** 2026-08-20 · **Scope:** exactly what it takes to add an OpenAI-OAuth provider to ctrl-b —
the login flow, the token lifecycle, the wire dialect the token actually buys, and the storage shape
under D48. **Lane:** `openai/codex` at HEAD (Rust, `codex-rs`), the **local** Hermes agent source
(`~/.hermes/hermes-agent`, the closest Python precedent — it holds a live device-code credential
minted 2026-08-19), LiteLLM's first-party `chatgpt/` provider, two opencode community plugins, the
vendor doc at `learn.chatgpt.com`, plus ctrl-b's own registry/adapter code. Local experiment: claim
decode of the live Hermes credential (metadata only — no token material read out or recorded here).

**Drives:** [`ROADMAP.md`](../ROADMAP.md) §A13 (owner ask 2026-08-19, re-confirmed 2026-08-20). No
D-entry yet; §A13 says the registry covers everything **except the credential type**. That premise is
half right and §3 below says why. Not yet cited by a D-entry.

**Assumed known, not re-derived:** D48's provider registry (one `providers:` map, `ProviderCfg` =
connection + catalog); the secret-handling rules (`SECURITY_MODEL.md`); the D45/D46 `api_mode` axis.

**Confidence key:** **[V]** verified — I read the primary source (repo source at a pinned SHA, local
installed source, or a live artifact) · **[R]** reported — credible secondary source · **[U]**
unverified inference.

**Pinned sources.**

| Source | Pin |
|---|---|
| `openai/codex` | SHA `37a9da9901c5fa417896af8840ba27dffe4f1ca1` (2026-08-20, `main`) — shallow clone, deleted after the pass |
| Hermes agent (local) | `/home/emma/.hermes/hermes-agent` as installed on emma, read 2026-08-20 |
| `BerriAI/litellm` | `litellm/llms/chatgpt/*` on `main`, fetched via the GitHub contents API 2026-08-20 |
| `numman-ali/opencode-openai-codex-auth` | SHA `bec2ad69b252ef4ad7dd33b9532ff8b4fdb6d016` |
| `tumf/opencode-openai-device-auth` | SHA `f5c8d246723a5e2aa3458d4060150da1a78c8433` |
| Vendor doc | `https://learn.chatgpt.com/docs/auth` (the 308 target of `developers.openai.com/codex/auth`) |

---

## 0. TL;DR

1. **Flow: device-code, decisively.** It is first-party in `codex-rs` at HEAD (`login/device_code_auth.rs`),
   documented by the vendor as the *preferred* headless method, and implemented identically by three
   independent Python/TS peers. The localhost:1455 PKCE callback is the desktop flow and would need a
   port-forward or a browser on emma — pointless when the phone is the UI. **[V]**
2. **Wire: Responses-only, on a different host.** The token is for
   `https://chatgpt.com/backend-api/codex` + `/responses` (SSE). Codex removed the chat wire API
   entirely at HEAD; LiteLLM *bridges* Chat Completions onto Responses. ctrl-b's adapter is
   `chat.completions`-only at two call sites. **This is the real cost of A13, not the credential
   type.** **[V]**
3. **Token lifecycle:** access token = a JWT with a **10-day** lifetime (verified on the live
   credential), refresh via `POST https://auth.openai.com/oauth/token` with
   `grant_type=refresh_token`; refresh **rotates** the refresh token and reuse is detected
   (`refresh_token_reused`). Refresh-before-use, not on-401, in all four implementations. **[V]**
4. **Biggest risk:** the endpoint sits behind a Cloudflare layer that gates on an
   **originator allow-list** (`codex_cli_rs`, `codex_vscode`, …) — server-hosted, non-residential
   clients get 403 `cf-mitigated: challenge` regardless of auth correctness. Every peer pins
   `originator: codex_cli_rs` + a codex-shaped `User-Agent` to get through. **[V]**

---

## 1. The flow, verified from `openai/codex` at HEAD

### 1.1 Both flows exist; the device-code one is first-party

`codex-rs/login/src/lib.rs:7-20` exports the device-code module, and `cli/src/lib.rs:21-22` exports
`run_login_with_device_code` **and** `run_login_with_device_code_fallback_to_browser`, whose doc
comment reads verbatim **[V]**:

> ```rust
> /// Prefers device-code login (with `open_browser = false`) when headless environment is detected, but keeps
> /// `codex login` working in environments where device-code may be disabled/feature-gated.
> ```
> — `codex-rs/cli/src/login.rs:364-366`

The vendor doc agrees **[V]** (`learn.chatgpt.com/docs/auth`): device code is presented as the
**preferred** headless method (`codex login --device-auth`, or "Sign in with Device Code" in the
interactive UI), with SSH port-forwarding of `localhost:1455` given as the *alternative*, and
credential copying as the third.

**Prerequisite that will bite on first try [V/R]:** device-code login is **beta and off by default**.
Vendor doc, verbatim: *"Enable device code login in your ChatGPT security settings (personal account)
or ChatGPT workspace permissions (workspace admin)."* **[V]** The opencode device-auth plugin README
names the exact toggle **[R]**: *ChatGPT → Codex → Settings → General → Security →* **"Enable device
code authentication for Codex"**. `codex-rs` turns the server's 404 into precisely this message
**[V]**:

> ```rust
> "device code login is not enabled for this Codex server. Use the browser login or verify the server URL.",
> ```
> — `codex-rs/login/src/device_code_auth.rs:82-84`

The owner's account already has it on — the live Hermes credential's pool entry records
`source: "manual:device_code"` **[V]** (metadata read of `~/.hermes/auth.json`).

### 1.2 Device-code: the exact three HTTP calls

All from `codex-rs/login/src/device_code_auth.rs` **[V]**, confirmed line-for-line by Hermes
`hermes_cli/auth.py:8109-8305` **[V]**, LiteLLM `litellm/llms/chatgpt/authenticator.py:143-286`
**[V]**, and `tumf/opencode-openai-device-auth` `src/index.ts:44-231` **[V]**.

| # | Call | Body | Success shape |
|---|---|---|---|
| 1 | `POST https://auth.openai.com/api/accounts/deviceauth/usercode` (JSON) | `{"client_id": "app_EMoamEEZ73f0CkXaXp7hrann"}` | `{device_auth_id, user_code, interval}` — `interval` arrives as a **string** |
| 2 | `POST https://auth.openai.com/api/accounts/deviceauth/token` (JSON, polled) | `{"device_auth_id": …, "user_code": …}` | `200` → `{authorization_code, code_challenge, code_verifier}`; **`403`/`404` = still pending** |
| 3 | `POST https://auth.openai.com/oauth/token` (form-encoded) | `grant_type=authorization_code&code=…&redirect_uri=https://auth.openai.com/deviceauth/callback&client_id=…&code_verifier=…` | `{id_token, access_token, refresh_token}` (+ `expires_in`) |

Verbatim, the poll semantics **[V]**:

```rust
let url = format!("{auth_base_url}/deviceauth/token");
let max_wait = Duration::from_secs(15 * 60);
…
if status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND {
    if start.elapsed() >= max_wait { … "device auth timed out after 15 minutes" … }
    let sleep_for = Duration::from_secs(interval).min(max_wait - start.elapsed());
```
— `codex-rs/login/src/device_code_auth.rs:100-137`

And the user-facing prompt, which fixes the verification URL **[V]**:

```rust
Ok(DeviceCode {
    verification_url: format!("{base_url}/codex/device"),
```
— `codex-rs/login/src/device_code_auth.rs:170-172`, i.e. **`https://auth.openai.com/codex/device`**.

**PKCE detail worth noting [V]:** in the device-code variant the *server* generates the PKCE pair —
the poll response hands back `code_verifier` and `code_challenge`, and the client just replays the
verifier in the exchange (`device_code_auth.rs:190-200`). The client does **not** generate PKCE for
this flow. (`login/src/pkce.rs` is only used by the browser flow.)

Deltas between implementations, all cosmetic **[V]**:

| | poll floor | login timeout | 429 handling |
|---|---|---|---|
| codex-rs | server `interval` | 15 min | none |
| Hermes | `max(3, interval)` | 15 min | retries ×4 with `Retry-After`, then a distinct `codex_rate_limited` error (`auth.py:8118-8165`) |
| LiteLLM | `max(interval, 5)` | 15 min | 5-min device-code **cooldown** persisted in the auth file (`authenticator.py:26-28, 343-361`) |

### 1.3 The browser/PKCE flow (for completeness — not our fit)

`codex-rs/login/src/server.rs` **[V]**: issuer `https://auth.openai.com` (`:59`), callback port
**1455** with fallback **1457** (`:60-62`, comment: *"Keep in sync with the Codex CLI Hydra redirect
URI allow-list"*), redirect `http://localhost:1455/auth/callback`. The authorize URL is built at
`server.rs:576-611` with, verbatim:

```rust
("scope".to_string(),
 "openid profile email offline_access api.connectors.read api.connectors.invoke".to_string()),
…
("code_challenge_method".to_string(), "S256".to_string()),
("id_token_add_organizations".to_string(), "true".to_string()),
("codex_cli_simplified_flow".to_string(), "true".to_string()),
("state".to_string(), state.to_string()),
("originator".to_string(), originator().value),
```

Note the connectors scopes are **new** relative to the community plugins, which still request
`"openid profile email offline_access"` (`oc-codex-auth/lib/auth/auth.ts:11`) **[V]**. The live
device-code token carries `scp: ["openid","profile","email","offline_access"]` **[V]** — the
device-code path does not take a `scope` parameter at all, so the granted set is server-decided.

### 1.4 What comes back, and which claims matter

Token endpoint returns **`access_token`, `refresh_token`, `id_token`** (all three required by
`codex-rs` `server.rs:806-812` and LiteLLM `authenticator.py:277`) **[V]**. `expires_in` is also
present — the two TS plugins *require* it (`oc-codex-auth/lib/auth/auth.ts:100-117`) while codex-rs
and Hermes ignore it and read the JWT `exp` instead **[V]**.

Claims, from `codex-rs/login/src/token_data.rs:27-42` **[V]** — the "flat subset of useful claims":

```rust
pub struct IdTokenInfo {
    pub email: Option<String>,
    /// The ChatGPT subscription plan type
    /// (e.g., "free", "plus", "pro", "business", "enterprise", "edu").
    pub chatgpt_plan_type: Option<PlanType>,
    pub chatgpt_user_id: Option<String>,
    /// Organization/workspace identifier associated with the token, if present.
    pub chatgpt_account_id: Option<String>,
    pub chatgpt_account_is_fedramp: bool,
```

All nested under the namespaced claim `https://api.openai.com/auth` (`token_data.rs:76-79`) **[V]**.
**`chatgpt_account_id` is load-bearing** — it becomes the `ChatGPT-Account-Id` request header (§3.2),
and without it the models endpoint returns `{"models":[]}` with HTTP 200, which "masquerades as *no
models available*" (Hermes `hermes_cli/codex_models.py:98-108`) **[V]**.

**Live-credential facts (decoded from the owner's own Hermes token, metadata only) [V]:**

| Field | Value |
|---|---|
| `exp − iat` | **864 000 s = 10 days exactly** (issued 2026-08-19T08:32Z, expires 2026-08-29T08:32Z) |
| `aud` | `["https://api.openai.com/v1"]` |
| `iss` | `https://auth.openai.com` |
| `scp` | `["openid","profile","email","offline_access"]` |
| `https://api.openai.com/auth` keys | `amr`, `chatgpt_account_id`, `chatgpt_account_user_id`, `chatgpt_compute_residency`, `chatgpt_plan_type`, `chatgpt_user_id`, `poid`, `user_id` |
| `chatgpt_plan_type` | `"prolite"` — **not** in the docstring's enumerated list, which is why `PlanType` has an `Unknown(String)` arm |
| other claims | `client_id`, `jti`, `nbf`, `pwd_auth_time`, `session_id`, `sl`, `sub` |
| refresh token | **opaque**, prefix `rt.` — *not* a JWT, so its expiry is not client-readable |

---

## 2. Token lifecycle

### 2.1 Refresh request

`POST https://auth.openai.com/oauth/token` with `grant_type=refresh_token`, `refresh_token`,
`client_id` **[V]** — four independent implementations agree on the endpoint and the three fields.
They disagree on the encoding, which means **the endpoint accepts both**:

- codex-rs sends **JSON**: `.header("Content-Type", "application/json").json(&refresh_request)`
  (`login/src/auth/manager.rs:1553-1572`) **[V]**
- Hermes sends **form**: `headers={"Content-Type": "application/x-www-form-urlencoded"}, data={…}`
  (`hermes_cli/auth.py:3818-3833`) **[V]**; LiteLLM and both opencode plugins likewise.

Constants **[V]**: `REFRESH_TOKEN_URL = "https://auth.openai.com/oauth/token"` and
`REVOKE_TOKEN_URL = "https://auth.openai.com/oauth/revoke"` (`manager.rs:194-195`);
`pub const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann"` (`manager.rs:1678`). Hermes pins the
identical id (`auth.py:142`), as does LiteLLM
(`common_utils.py`: `CHATGPT_CLIENT_ID: Final = "app_EMoamEEZ73f0CkXaXp7hrann"`) and both plugins.
There is one public client id and everyone uses it.

Hermes additionally sends a `User-Agent` on the token endpoint (`CODEX_OAUTH_USER_AGENT =
f"hermes-cli/{version}"`, `auth.py:147`) — so the *auth* host, unlike the *inference* host, does not
appear to police the UA **[U]**.

### 2.2 Rotation and revocation

**Refresh rotates the refresh token.** `codex-rs`'s `RefreshResponse` carries an optional
`refresh_token` and swaps it in when present (`manager.rs:1671-1675`, `1530-1545`) **[V]**; Hermes
does the same, verbatim **[V]**:

```python
next_refresh = refresh_payload.get("refresh_token")
if isinstance(next_refresh, str) and next_refresh.strip():
    updated["refresh_token"] = next_refresh.strip()
```
— `hermes_cli/auth.py:3922-3925`

And reuse is **server-detected**. `codex-rs` classifies three terminal subtypes **[V]**:

```rust
Some("refresh_token_expired") => RefreshTokenFailedReason::Expired,
Some("refresh_token_reused") => RefreshTokenFailedReason::Exhausted,
Some("refresh_token_invalidated") => RefreshTokenFailedReason::Revoked,
```
— `manager.rs:1613-1615`, with the user-facing strings at `:188-193` (e.g. *"Your access token could
not be refreshed because your refresh token was already used. Please log out and sign in again."*).
RFC-6749-shaped `invalid_grant` on a 400 is also terminal (`manager.rs:1585-1596`).

Hermes maps the same code to an actionable message and, critically, records **why a second consumer
is dangerous** — verbatim **[V]**:

```python
if code == "refresh_token_reused":
    message = (
        "Codex refresh token was already consumed by another client "
        "(e.g. Codex CLI or VS Code extension). "
        "Run `codex` in your terminal to generate fresh tokens, "
        "then run `hermes auth` to re-authenticate."
    )
```
— `hermes_cli/auth.py:3885-3892`

…which is why Hermes keeps its **own** session rather than sharing `~/.codex/auth.json` **[V]**:

```python
# OpenAI Codex auth — tokens stored in ~/.hermes/auth.json (not ~/.codex/)
#
# Hermes maintains its own Codex OAuth session separate from the Codex CLI
# and VS Code extension. This prevents refresh token rotation conflicts
# where one app's refresh invalidates the other's session.
```
— `hermes_cli/auth.py:3599-3604`

**The §A13 field caveat is confirmed and refined:** independent *logins* are safe and expected
(Hermes and Codex CLI coexist on emma today), but a shared *token pair* is not — and an account-wide
session revocation kills every consumer at once. ctrl-b must mint its **own** credential, never read
`~/.codex/auth.json` or `~/.hermes/auth.json`. (Hermes has a one-way *import* from `~/.codex` as a
recovery path, `auth.py:3978-4009`, explicitly commented *"Does NOT write to the shared file"* **[V]**.)

### 2.3 When each implementation refreshes — all proactive, none on-401-only

| Implementation | Trigger | Skew |
|---|---|---|
| codex-rs | JWT `exp` due, **or** `last_refresh` older than 8 days | **5 min** (`CHATGPT_ACCESS_TOKEN_REFRESH_WINDOW_MINUTES: i64 = 5`, `TOKEN_REFRESH_INTERVAL: i64 = 8` days — `manager.rs:185-186, 2884-2905`) |
| Hermes | JWT `exp` due, at credential resolution | **120 s** (`CODEX_ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 120`, `auth.py:148`) |
| LiteLLM | JWT `exp` due (or `expires_at` cached in the auth file) | **60 s** (`TOKEN_EXPIRY_SKEW_SECONDS: Final = 60`) |
| opencode plugin | `auth.expires < Date.now()` — no skew at all | 0 (`lib/request/fetch-helpers.ts:29-31`) |

codex-rs *also* keeps an on-401 recovery ladder — `Reload → RefreshToken → Done`
(`manager.rs:1784-1970`) **[V]** — but that is a second line of defence behind the proactive check,
not the primary mechanism. Vendor doc, verbatim **[V]**: *"For sign in with ChatGPT sessions, Codex
refreshes tokens automatically during use before they expire, so active sessions usually continue
without requiring another browser login."*

Hermes does the refresh **under a cross-process file lock with a double-check** — re-reading the
store inside the lock before deciding to refresh (`auth.py:4126-4139`) **[V]**. With rotation +
reuse-detection, concurrent refreshes are not merely wasteful, they can **burn the credential**.
Any ctrl-b implementation needs the same single-flight discipline.

### 2.4 On-disk storage

| | Path | Shape | Perms |
|---|---|---|---|
| Codex CLI | `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`) | `{auth_mode, OPENAI_API_KEY, tokens:{id_token, access_token, refresh_token, account_id}, last_refresh, …}` — `storage.rs:38-61` | **0600** (`options.mode(0o600)`, `storage.rs:213`) **[V]** |
| Hermes | `~/.hermes/auth.json` | `{version, updated_at, providers:{…}, credential_pool:{"openai-codex":[{id,label,auth_type:"oauth",base_url,access_token,refresh_token,source,last_refresh,last_status,last_error_*,priority,request_count}]}, …}` | **0600**, dir **0700**, `O_EXCL`+`fsync`+atomic replace (`auth.py:1322-1367`) **[V]** — verified live on the file |
| LiteLLM | `$CHATGPT_TOKEN_DIR/auth.json`, default `~/.config/litellm/chatgpt/auth.json` | `{access_token, refresh_token, id_token, expires_at, account_id}` | **default umask** — plain `open(…, "w")`, no chmod (`authenticator.py:95-100`) **[V]**. A negative datapoint: don't copy this. |
| opencode plugins | opencode's own `auth.json` | `{type:"oauth", access, refresh, expires}` **beside** `{type:"api", key}` | not inspected **[U]** |

Hermes' `O_EXCL` comment is worth lifting verbatim, because it names the exact failure ctrl-b's
0600 write-replace discipline already avoids **[V]**:

> ```python
> # Create with 0o600 atomically via os.open(O_EXCL) + fdopen to close
> # the TOCTOU window where default umask (often 0o644) briefly exposed
> # OAuth tokens to other local users between open() and chmod().
> ```
> — `hermes_cli/auth.py:1339-1342`

---

## 3. The wire dialect the token buys — **this is the expensive part**

### 3.1 Host, path, protocol

`https://chatgpt.com/backend-api/codex` — `pub const CHATGPT_CODEX_BASE_URL` in
`codex-rs/model-provider-info/src/lib.rs:39` **[V]**; identical constant in Hermes
(`auth.py:124`), LiteLLM (`CHATGPT_API_BASE`), and the opencode plugin (which appends `/codex` by
rewriting `/responses` → `/codex/responses`, `fetch-helpers.ts:87-89`) **[V]**.

**It speaks the Responses API and nothing else.** At HEAD, `codex-rs`'s wire-protocol enum has
exactly one variant **[V]**:

```rust
/// Wire protocol that the provider speaks.
pub enum WireApi {
    /// The Responses API exposed by OpenAI at `/v1/responses`.
    #[default]
    Responses,
}
```
— `model-provider-info/src/lib.rs:61-67`, with the removal message at `:55`:
`"`wire_api = \"chat\"` is no longer supported.\nHow to fix: set `wire_api = \"responses\"`…"`

Corroboration from two independent directions **[V]**: LiteLLM's own docs say *"ChatGPT subscription
(OAuth) currently only supports the Responses API. Chat Completions requests are bridged to
Responses for supported models"* **[R]**, and its `ChatGPTConfig` for chat completions exists purely
to reroute onto the Responses transport; Hermes carries a dedicated `api_mode == "codex_responses"`
plus a whole `agent/codex_responses_adapter.py` whose job is converting chat-shaped history into
Responses `input[]` items — because *"the Responses API rejects [role=tool] with «Invalid value:
'tool'. Supported values are: 'assistant', 'system', 'developer', and 'user'»"*
(`agent/auxiliary_client.py:1398-1408`) **[V]**.

**ctrl-b today is Chat-Completions-only** — exactly two wire call sites,
`backend/app/adapters/inference.py:1410` and `:1577`, both
`self._client(ep).chat.completions.create(...)` **[V]**. There is no Responses path anywhere in the
backend.

### 3.2 Required headers

| Header | Value | Source |
|---|---|---|
| `Authorization` | `Bearer <access_token>` | all **[V]** |
| `ChatGPT-Account-Id` | `chatgpt_account_id` claim from the JWT | codex-rs `model-provider/src/bearer_auth_provider.rs:37-44`; Hermes `auth.py:4256-4265`; LiteLLM `get_chatgpt_default_headers` **[V]** |
| `originator` | `codex_cli_rs` | `login/src/auth/default_client.rs:40` (`DEFAULT_ORIGINATOR`); LiteLLM `DEFAULT_ORIGINATOR`; plugin `ORIGINATOR_CODEX` **[V]** |
| `User-Agent` | codex-shaped, e.g. LiteLLM's `"codex_cli_rs/0.0.0 (Unknown 0; unknown) unknown"` | **[V]** |
| `accept` | `text/event-stream` | LiteLLM + plugin **[V]** |
| `session_id` / `conversation_id` | prompt-cache scoping (optional) | LiteLLM; plugin sets both from `prompt_cache_key` **[V]** |
| `X-OpenAI-Fedramp: true` | only for FedRAMP accounts | codex-rs **[V]** |

The originator requirement is not cosmetic. Hermes documents it as a hard Cloudflare gate — verbatim
**[V]**:

> ```python
> """Headers required to avoid Cloudflare 403s on chatgpt.com/backend-api/codex.
>
> The Cloudflare layer in front of the Codex endpoint whitelists a small set of
> first-party originators (``codex_cli_rs``, ``codex_vscode``, ``codex_sdk_ts``,
> anything starting with ``Codex``). Requests from non-residential IPs (VPS,
> server-hosted agents) that don't advertise an allowed originator are served
> a 403 with ``cf-mitigated: challenge`` regardless of auth correctness.
> """
> ```
> — `agent/auxiliary_client.py:1186-1204`

### 3.3 Required / forbidden body fields

LiteLLM's Responses transform is the cleanest statement of the contract — it **allow-lists** the
request keys **[V]**:

```python
request["store"] = False
request["stream"] = True
include = list(request.get("include") or [])
if "reasoning.encrypted_content" not in include:
    include.append("reasoning.encrypted_content")
request["include"] = include

allowed_keys: Final = {
    "model", "input", "instructions", "stream", "store", "include",
    "tools", "tool_choice", "reasoning", "previous_response_id", "truncation",
}
return {k: v for k, v in request.items() if k in allowed_keys}
```
— `litellm/llms/chatgpt/responses/transformation.py`

Everything else is dropped, including `max_output_tokens`, `temperature` and `metadata`. Hermes says
the same in a comment **[V]**: *"the Codex endpoint (chatgpt.com/backend-api/codex) does NOT support
max_output_tokens or temperature — omit to avoid 400 errors"* (`agent/auxiliary_client.py:1452-1453`).
The opencode plugin adds *"ChatGPT backend REQUIRES store=false (confirmed via testing)"* and strips
every item `id` from `input[]` for "stateless mode" (`request-transformer.ts:449-451, 309-330`) **[V]**.

`store:false` has a consequence: **reasoning continuity must be carried by the client**, via
`include: ["reasoning.encrypted_content"]` and replaying the encrypted blobs in later turns. Both
peers do this **[V]**.

**Tool schemas are validated more strictly than the public API.** Hermes strips top-level
combinators, verbatim **[V]**:

> ```python
> """OpenAI's Codex backend (``chatgpt.com/backend-api/codex``) is stricter
> than the public Functions API and rejects requests with::
>
>     Invalid schema for function 'X': schema must have type 'object' and
>     not have 'oneOf'/'anyOf'/'allOf'/'enum'/'not' at the top level.
> """
> ```
> — `tools/schema_sanitizer.py:207-215`

**A "Codex-flavoured" system prompt is NOT required.** LiteLLM prepends the full Codex CLI
instruction text and the opencode plugin fetches Codex's prompt from GitHub and *replaces* the host's
— but Hermes sends its own `instructions` verbatim (`auxiliary_client.py:1410-1437`, `instructions =
"You are a helpful assistant."`) and that is the configuration running in production against this
owner's account today **[V]**. So the prompt substitution the peers do is a quality/behaviour choice,
not a wire requirement. **[V, with the caveat that "no 400" ≠ "no future gating"]**

### 3.4 Models reachable, context, and quota

**Catalog:** `GET https://chatgpt.com/backend-api/codex/models?client_version=1.0.0` with
`Authorization` + `ChatGPT-Account-Id`; returns `{"models":[{slug, visibility, context_window,
supported_in_api, …}]}` (Hermes `hermes_cli/codex_models.py:126-160`, `agent/model_metadata.py:2298-2330`)
**[V]**. Without the account header it returns `{"models":[]}` at HTTP 200 **[V]**.

**Hermes' curated fallback list (its record of what this backend actually accepts) [V]:**
`gpt-5.6-sol`, `gpt-5.6-sol-pro`, `gpt-5.6-terra`, `gpt-5.6-terra-pro`, `gpt-5.6-luna`,
`gpt-5.6-luna-pro`, `gpt-5.5`, `gpt-5.4-mini`, `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`
(Pro-entitlement only). Slugs explicitly **removed** because the backend 400s them on ChatGPT-account
auth: `gpt-5.2-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini` — *"The '<model>' model is not
supported when using Codex with a ChatGPT account." … (verified live 2026-05-27)* **[V]**.
LiteLLM's docs list a different set (`chatgpt/gpt-5.4`, `gpt-5.3-codex`, `gpt-5.3-instant`,
`gpt-5.3-chat-latest`) **[R]** — availability is per-account entitlement, so **discover, don't
hardcode**.

**Context is capped lower than the public API [V]:**

> ```python
> # Known ChatGPT Codex OAuth context windows (observed via live
> # chatgpt.com/backend-api/codex/models probe, Apr 2026). These are the
> # `context_window` values, which are what Codex actually enforces — the
> # direct OpenAI API has larger limits for the same slugs, but Codex OAuth
> # caps lower (e.g. gpt-5.5 is 1.05M on the API, 272K on Codex).
> ```
> — `agent/model_metadata.py:2216-2221`; the table gives **272 000** for the 5.4/5.5/5.6 families and
> **128 000** for `gpt-5.3-codex-spark`.

**Quota is subscription-shaped, and it is queryable [V].** `GET https://chatgpt.com/backend-api/wham/usage`
(path style: `/backend-api` → `/wham/…`, otherwise `/api/codex/…` — Hermes `agent/account_usage.py:428-445`,
mirroring codex-rs's `backend-client` `PathStyle`) returns
`rate_limit.primary_window` / `rate_limit.secondary_window`, each `{used_percent, reset_at}` —
labelled **"Session"** (5h) and **"Weekly"** in Hermes, and `5h`/weekly in the codex-rs TUI
(`tui/src/chatwidget/status_surfaces.rs:1041`). There are also
`/wham/rate-limit-reset-credits[/consume]` endpoints. A **429 on the token endpoint means quota, not
auth** — Hermes classifies it separately so the UI says "retry later" instead of "re-login"
(`auth.py:3834-3856`) **[V]**.

---

## 4. Peer precedent beyond the vendor

| Project | Status | How the credential slots in |
|---|---|---|
| **LiteLLM** (BerriAI) | **First-party `chatgpt/` provider** | Config is ordinary `model_list` (`model: chatgpt/gpt-5.4`, `model_info.mode: responses`) with **no credential in config at all** — an `Authenticator` singleton owns `auth.json` and the refresh. The provider class resolves the credential *at request-build time*: `_get_openai_compatible_provider_info` returns `(dynamic_api_base, dynamic_api_key=authenticator.get_access_token(), …)` **[V]** |
| **opencode** | Not in core; **two community plugins** | opencode's auth store already has an `oauth` credential type beside `api`: the plugin's loader branches on `if (auth.type !== "oauth") return {}` and hands the SDK `{apiKey: DUMMY_API_KEY, baseURL, fetch}` — refresh happens **inside the custom `fetch`**, before every request **[V]** (`index.ts:112-170`). Upstream issue [anomalyco/opencode#3281] requests it in core **[R]** |
| **Hermes** (local) | Full first-party support | A `ProviderConfig` registry entry (`auth_type: "oauth_external"`, `inference_base_url`) + a separate `auth.json` credential store and a `credential_pool` list per provider **[V]** |
| **Codex CLI** | The vendor | `auth.json` beside an `OPENAI_API_KEY` field in the *same* record — one object, two credential kinds (`storage.rs:40-61`) **[V]** |

**Two structural lessons for us [V]:**
1. **Nobody puts the live tokens in the user-editable config file.** All four keep a separate,
   machine-owned credential store; the config file holds only the *pointer* (provider id / base_url /
   model).
2. **Refresh-before-use sits at the transport, not at client construction.** LiteLLM resolves the
   token per request; the opencode plugin refreshes inside `fetch`; Hermes resolves per credential
   lookup. Only Codex CLI has a longer-lived in-process `AuthManager`, and even that re-checks on
   every request path.

### 4.1 Published ToS position — what actually exists

This is thin, and I will not pad it.

- **Vendor doc [V]:** the device-code flow is officially documented and shipped in the vendor's own
  CLI. There is no statement in it about third-party clients either way.
- **openai/codex Discussion #8338 [R]** — an OpenAI maintainer (`etraut-openai`), asked directly
  whether a fork used with "Sign in with ChatGPT" is allowed, answered: *"The codex CLI sources are
  licensed under a permissive Apache license, and you're welcome to fork the repo and make
  modifications to suit your own needs. The Terms of Use for OpenAI's services are covered here."*
  and later *"our terms of use and code license are quite permissive"*. The asker's follow-up — *"I
  haven't seen an explicit statement that 'Sign in with ChatGPT (OAuth)' is an approved way to use a
  third party service with codex under a ChatGPT plan"* — was **not** answered with a policy
  statement. So: no explicit permission, and no explicit prohibition.
- **OpenAI Terms of Use [R, snippet only]:** *"You may not share your account credentials or make
  your account available to anyone else and are responsible for all activities that occur under your
  account."* This speaks to *sharing with other people*, which is not the frame here (single user,
  own subscription, own hardware, tailnet-only).
- The peers self-describe the boundary the same way **[V]**: the opencode plugin's README/npm text
  says it is *"for personal development use only … for individual coding assistance with your ChatGPT
  Plus/Pro subscription. For production or multi-user applications, use the OpenAI Platform API."*

**I could not fetch `openai.com/policies/*` directly — both the Service Terms and Terms of Use return
HTTP 403 to the fetch tool.** Everything in the two bullets above marked [R] is from search-result
snippets and a rendered discussion page, not from the policy documents themselves. If the owner wants
a firm risk read, that gap has to be closed by reading the policy pages in a browser.

---

## 5. The ctrl-b shape — *our reading, not vendor fact*

### 5.1 Where it lands in existing code

| Seam | File:line | What changes |
|---|---|---|
| Credential type | `backend/app/config.py:213` `ProviderCfg` | **one additive optional field**: `oauth: ProviderOAuthCfg \| None = None` |
| Wire dialect | `backend/app/config.py:228` `api_mode` Literal | add `"codex_responses"` (or `"responses"`) — additive to a `Literal`, D46-shaped |
| Secret masking | `backend/app/config.py:92` `_SECRET_LEAF_KEYS` | add `access_token` / `refresh_token`; masking (`_mask`, `:2120`) and blank-keeps-on-PUT (`unmask_secrets`, `:2210`) then work **unchanged**, since both are path-aware scalar-leaf rules |
| Resolution | `backend/app/core/provider_registry.py:305,366` → `domain/provider.py:30` `ResolvedTarget` | carry the credential *record* (or a resolver handle), not a frozen string |
| Refresh + auth | `backend/app/adapters/inference.py:1012` `_client(ep)` | the SDK client is cached **per provider name** with the key baked in at construction — so the token must ride **per-request**, not per-client |
| Wire calls | `inference.py:1410, 1577` | the two `chat.completions.create` sites — a Responses path is a **third** and **fourth** |
| Hot-apply | `backend/app/runtime.py:331` `reconfigure` | ⚠️ any `providers`-subtree change rebuilds inference **+ voice + embeddings** and churns `providers_rev` (`config.py:1780`) |

### 5.2 Config record (recommended)

Per the 2026-06-24 shape-to-extend directive: **one optional object on the existing entry**, never a
sibling `oauth_providers:` map.

```yaml
providers:
  chatgpt:                                   # slug = the /chatgpt composer verb
    base_url: https://chatgpt.com/backend-api/codex
    api_mode: codex_responses                # new Literal member; drives the transport
    oauth:
      kind: openai_chatgpt                   # names the flow AND the dialect family
      access_token: "eyJ…"                   # masked in the API, blank-keeps on PUT
      refresh_token: "rt.…"                  # masked
      expires_at: 1756456362                 # from the JWT exp; cheaper than re-decoding
      account_id: "…"                        # NOT a secret — the ChatGPT-Account-Id header
      plan: prolite                          # NOT a secret — display only
      last_refresh: 2026-08-19T08:32:43Z
    models:
      gpt-5.6-sol: { context_window: 272000 }
    # note: no api_key on this entry
```

`kind` is what makes the next OAuth provider (Qwen-OAuth, xAI, Copilot — Hermes already carries all
three) a **data** change rather than a schema change; it is the same move `api_mode` made for wire
dialects. Two credential shapes on one object (`api_key` **or** `oauth`) is exactly the Codex CLI's
own `auth.json` shape (`OPENAI_API_KEY` beside `tokens`) **[V]**.

**One open tension the owner should rule on.** Every peer keeps live tokens *out* of the
user-editable config (§4). ctrl-b's counter-argument is strong — `config.yaml` is already 0600, already
gitignored, already the single home for `ssh_password`/`api_key`, and already has masking + blank-keeps
+ a migration lane. Splitting to a second store would duplicate all of that. **Our reading: keep it in
`config.yaml`**, and pay the one cost this creates (§5.3).

### 5.3 Refresh placement

**Recommendation: refresh-before-use at the *call* boundary, with a single-flight lock and a narrow
write-back — not at client construction, and not a background task.**

- **Not at construction**: `_client(ep)` memoises one `AsyncOpenAI` per provider name for the life of
  the client generation (`inference.py:1015-1024`), so a token refreshed an hour later would never
  reach the wire. Keep the cached client with the existing `_PLACEHOLDER_KEY` and send
  `extra_headers={"Authorization": f"Bearer {tok}", "ChatGPT-Account-Id": …, "originator": …}` on the
  call — the SDK supports per-call `extra_headers`, and it is the same shape LiteLLM/opencode use.
- **Not a background task**: a 10-day token with a 5-minute skew needs a check, not a timer; a timer
  adds a second source of truth and a second chance to double-refresh a rotating token.
- **Single-flight**: rotation + `refresh_token_reused` means two concurrent refreshes can *burn* the
  credential. One `asyncio.Lock` per provider, with the expiry re-checked inside the lock — Hermes'
  exact pattern (`auth.py:4126-4139`) **[V]**.
- **Write-back must bypass `reconfigure`**: persist via a narrow `persist_provider_oauth(name, rec)`
  that does the 0600 write-replace **and** mutates the in-memory `Settings` in place. Going through
  `PUT /api/settings` would (a) rebuild inference+voice+embeddings clients mid-turn and (b) move
  `providers_rev`, 409-ing any Conf editor the owner has open. Skew choice: **300 s**, matching
  codex-rs, since our turns can be long.
- **Skew source**: read the JWT `exp` (works whether or not `expires_in` comes back) and cache it as
  `expires_at`. LiteLLM does both **[V]**.

**Failure semantics mid-turn** — three buckets, and they must not collapse into one:

| Class | Wire signal | Behaviour |
|---|---|---|
| **Terminal / re-auth** | `invalid_grant`, `refresh_token_expired\|reused\|invalidated`, 401/403 from the token endpoint | Do **not** silently fail over and forget. Mark the provider `needs_reauth`, surface it in the Conf provider row + a chat-side notice, then fall through the D48 chain for *this* turn. §A13's own caveat. |
| **Quota** | 429 (token endpoint **or** inference) | Credentials are fine. Surface "quota exhausted, resets at …" (from `/wham/usage`), fail over for this turn, keep the provider enabled. |
| **Transient** | network / 5xx | Retry per the existing `retry_attempts` ladder, then normal failover. |

### 5.4 The Conf login flow

The server does the polling; the phone polls the *server*. Three endpoints, mirroring the three HTTP
calls of §1.2:

| Endpoint | Returns |
|---|---|
| `POST /api/providers/{name}/oauth/login` | `{login_id, verification_uri: "https://auth.openai.com/codex/device", user_code, interval, expires_at}` — the backend has already made call ①; the phone renders code + a tappable link |
| `GET /api/providers/{name}/oauth/login/{login_id}` | `{state: pending\|authorized\|expired\|error, error_code?, message?}` — backend-side polling of ②③ runs as a bounded task (15 min hard stop) |
| `DELETE /api/providers/{name}/oauth` | clears the record; optionally `POST https://auth.openai.com/oauth/revoke` first |
| `GET /api/providers` (existing) | gains a non-secret `oauth: {kind, account_id, plan, expires_at, state}` block for the provider row |

UX notes from the peers: the user code **expires in 15 minutes** and everyone says so on screen; both
codex-rs and LiteLLM print an anti-phishing line (*"Continue only if you started this login in Codex.
If a website or another person gave you this code, cancel."* — `device_code_auth.rs:149-157` **[V]**)
— worth keeping verbatim in the Conf sheet; and a login 429 needs the "OpenAI is throttling logins,
this is not a credential problem" message plus LiteLLM's 5-minute cooldown, or the owner will
re-tap and dig the hole deeper.

### 5.5 Honest cost estimate

The credential type is the **small** half — one optional model, two masking keys, a lock, a narrow
writer, three endpoints, one Conf sheet. The **large** half is a Responses transport: request builder
(`input[]` conversion incl. `function_call`/`function_call_output`, `instructions`, `store:false`,
`include:["reasoning.encrypted_content"]`, the allow-list), SSE event assembly
(`response.output_item.done` etc.), encrypted-reasoning round-tripping through ctrl-b's message store,
tool-schema sanitisation, and error mapping. That is a second wire dialect in an adapter that has only
ever spoken one — and it is the thing a D-entry must scope, not the OAuth record.

---

## 6. Three findings the brief didn't ask for

1. **The Cloudflare originator gate is an availability risk *and* a values question.** [V]
   Getting through requires advertising `originator: codex_cli_rs` and a `codex_cli_rs/...`-shaped
   `User-Agent` from a server IP — i.e. presenting as the vendor's own CLI. Hermes documents the 403
   `cf-mitigated: challenge` failure mode explicitly, and LiteLLM hardcodes
   `"codex_cli_rs/0.0.0 (Unknown 0; unknown) unknown"`. Two consequences: (a) an unadorned
   `AsyncOpenAI` client will likely fail from emma with a 403 that *looks* like an auth bug — the
   first thing to test; (b) the mitigation is fingerprint-matching a first-party client, which is a
   different posture from "we use the documented OAuth flow". The owner should see that plainly before
   a D-entry locks. Also note this can change without warning: it is edge policy, not an API contract.
2. **`store:false` makes reasoning continuity ctrl-b's problem.** [V] The backend is stateless for us,
   so multi-turn reasoning quality depends on us storing `reasoning.encrypted_content` blobs per
   message and replaying them — opaque, provider-scoped, size-unbounded payloads in the SQLite message
   store, which today holds plain text. Foreign-issuer reasoning blocks must also be *dropped* when the
   conversation later runs on a different provider (Hermes tracks an `issuer_kind` per call for
   exactly this — *"passed to the input converter so foreign-issuer reasoning blocks in history are
   dropped before the API rejects them"*, `agent/transports/codex.py:280-287`). A failover chain that mixes `chatgpt` with a local
   llama.cpp provider makes this a real, testable correctness rule, not a nicety.
3. **`/wham/usage` is a cheap, high-value UI win — and the 429 taxonomy is a correctness rule.** [V]
   One authenticated GET yields `used_percent` + `reset_at` for the 5-hour and weekly windows: a
   "38% of your 5h window, resets 14:20" chip in Conf/composer, from the same credential, no extra
   scope. It also disambiguates the failure that would otherwise be misread as broken auth — Hermes
   found this the hard way and now goes as far as *probing* `/usage` to detect that a persisted
   cooldown has been lifted upstream (`auth.py:4204-4288`). Any ctrl-b implementation that treats 429
   as an auth failure will tell the owner to re-login when the only thing wrong is that he used his
   week's quota.

---

## 7. What I could not determine

- **Refresh-token lifetime.** The refresh token is opaque (`rt.` prefix, not a JWT), so no client can
  read its expiry. codex-rs's 8-day `last_refresh` fallback implies it survives at least that long
  **[U]**; nothing states a maximum.
- **Whether refresh *always* rotates.** Every implementation treats the returned `refresh_token` as
  optional and keeps the old one when absent, which implies rotation is not guaranteed on every call
  **[U]**. I did not perform a live refresh (doing so on the owner's live credential would risk the
  Hermes session).
- **OpenAI's actual written position on third-party clients.** `openai.com/policies/service-terms/`
  and `/row-terms-of-use/` both returned **HTTP 403** to the fetch tool; §4.1's policy quotes are
  search snippets and a rendered GitHub discussion. Unresolved, and the only genuinely open risk item.
- **Whether the `deviceauth/*` endpoints are contractual.** They are not in any published API
  reference I could find — they are read out of the vendor's own client source. The vendor documents
  the *flag* (`codex login --device-auth`), not the HTTP shape. Treat the endpoints as
  implementation detail that can move.
- **Whether the Cloudflare gate actually fires from emma's tailnet-egress IP.** Untested; Hermes runs
  on emma with the originator header already set, so it has never been observed unadorned here.
- **Per-plan rate-limit numbers.** `help.openai.com` returned 403; the window *shape*
  (5h + weekly, `used_percent`) is verified from source, the *values* are not.
- **The exact `expires_in` value returned by the token endpoint.** codex-rs and Hermes discard it; I
  read the 10-day figure from the JWT `exp − iat` of a live token instead, which is the more reliable
  number anyway.
- **opencode's on-disk auth file permissions** (its plugins were read, its core store was not).

---

*Local clones (`codex-src`, `oc-codex-auth`, `oc-device-auth`) were made under
`/home/emma/.cache/tmp` and deleted after this pass. No token material was written to this file, the
scratchpad, or any log.*
