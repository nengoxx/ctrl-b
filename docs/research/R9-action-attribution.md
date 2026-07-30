# R9 — Actor attribution in audit logs when the action is initiated indirectly

**Date:** 2026-07-30 · **Drove:** the A3 automations attribution design (open — no D-entry yet) ·
**Status:** evidence, not a decision

**The bounded question.** ctrl-b audits every tool invocation through one chokepoint
(`ActionService.invoke(name, args, *, actor, privilege, interactive, …)`) into an `Event` row whose
`actor` is a single enum (`USER | AGENT | SYSTEM | AUTOMATION`). A3 adds cron-triggered headless
agent runs: the tool was *invoked by the agent*, but the agent was *initiated by an automation*. Two
candidate shapes: **(a)** mutate the single `actor` per initiator (`actor=AUTOMATION` on tool calls
inside an automation run), or **(b)** keep `actor=AGENT` and add a separate initiator/origin
dimension. Related future case: subagents (agent spawns agent).

**Sources.** Angle 1 (primary): AWS CloudTrail · GCP Cloud Audit Logs · Microsoft Entra
(`directoryAudit`) · Kubernetes audit v1 · Linux auditd · GitHub Actions · RFC 8693 · OpenTelemetry
semconv. Angle 2 (peer class): Claude Code · Codex CLI · goose · opencode · LiteLLM · LibreChat ·
open-webui · AnythingLLM.

**Confidence legend.** `[V]` verified — I read the source file or the official schema/spec text
myself. `[V-doc]` verified against an official doc page, extracted via WebFetch (wording faithful,
exact punctuation may differ from the rendered page). `[R]` reported / secondary. `[U]` unverified.

---

## 1. Angle 1 — what established audit systems actually record

### 1.0 Scoreboard

| System | Acting identity | Initiator kept separately? | Field(s) that carry the initiator |
|---|---|---|---|
| AWS CloudTrail | `userIdentity.type` + `arn` | **Yes — five separate ways** | `invokedBy`, `sessionContext.sessionIssuer`, `sessionContext.sourceIdentity`, `onBehalfOf`, `inScopeOf`, `invokedByDelegate` |
| GCP Cloud Audit Logs | `authenticationInfo.principalEmail` | **Yes — an ordered list** | `serviceAccountDelegationInfo[]` ("delegation history") |
| Microsoft Entra `directoryAudit` | — | **Yes — one composite object with two slots** | `initiatedBy.{app,user}` |
| Kubernetes audit v1 | `user` (UserInfo) | **Yes** | `impersonatedUser` (optional UserInfo) |
| Linux auditd | `uid` / `euid` | **Yes — since the 2.6 kernel** | `auid` (loginuid), `ses` |
| GitHub Actions | `github.triggering_actor` | **Yes** | `github.actor` (+ `event_name`) |
| RFC 8693 (JWT) | `act` (current actor) | **Yes — an explicit nested chain** | nested `act` claims; `sub` = the delegating subject |
| OpenTelemetry semconv | `user.id` / `gen_ai.agent.id` | **No** | none — correlation via `gen_ai.conversation.id` |

**Not one of these overwrites the identity field to encode the initiator.** Eight for eight, the
acting identity keeps its own field and the initiator gets additional, independently-nullable
fields. That is the single strongest result in this dossier.

### 1.1 AWS CloudTrail — the maximalist case: six independent attribution dimensions `[V-doc]`

Source: [CloudTrail `userIdentity` element](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html)
(read 2026-07-30). The `type` enum is the *acting* identity's kind:

> `Root` – The request was made with your AWS account credentials. […] `IAMUser` – The request was
> made with the credentials of an IAM user. […] `AssumedRole` – The request was made with temporary
> security credentials that were obtained with a role […] `AWSService` – The request was made by an
> AWS account that belongs to an AWS service. For example, AWS Elastic Beanstalk assumes an IAM role
> in your account to call other AWS services on your behalf. […] `IdentityCenterUser` – The request
> was made on behalf of an IAM Identity Center user. […] `Unknown` – The request was made with an
> identity type that CloudTrail can't determine.

Note `AWSService` exists as a *type* — the direct analogue of ctrl-b's `actor=SYSTEM`. But when a
service acts, CloudTrail does **not** stop there; it adds a separate field naming which service:

> **`invokedBy`** — The name of the AWS service that made the request, when a request is made by an
> AWS service such as Amazon EC2 Auto Scaling or AWS Elastic Beanstalk. This field is only present
> when a request is made by an AWS service. This includes requests made by services using forward
> access sessions (FAS), AWS service principals, service-linked roles, or service roles used by an
> AWS service.
> **Optional:** True

This is exactly the A3 case (a scheduled service acts using a role that a human configured), and
CloudTrail's answer is **type ∧ invokedBy**, not type-instead-of.

The delegation chain gets three more fields:

> **`sessionContext`** › `sessionIssuer` – If a user make a request with temporary security
> credentials, `sessionIssuer` provides information about how the user obtained credentials. For
> example, if the they obtained temporary security credentials by assuming a role, this element
> provides information about the assumed role.

> `sourceIdentity` […] The `sourceIdentity` field occurs in events when users assume an IAM role to
> perform an action. `sourceIdentity` **identifies the original user identity making the request**,
> whether that user's identity is an IAM user, an IAM role, a user authenticated through SAML-based
> federation, or a user authenticated through OpenID Connect (OIDC)-compliant web identity
> federation. *(emphasis added)*

> **`onBehalfOf`** — If the request was made by an IAM Identity Center caller, `onBehalfOf` provides
> information about the IAM Identity Center user ID and identity store ARN for which the call was
> made.

> **`inScopeOf`** — If the request was made in scope of an AWS service, such as Lambda or Amazon
> ECS, it provides information about the resource or credentials related to the request. […]
> `sourceArn` – The ARN of the resource that invoked the service-to-service request.

`inScopeOf.sourceArn` is *the specific automation instance* — "the Lambda function that caused this
call" — which is precisely the `automation:<id>` granularity A3 needs. And `sourceIdentity` survives
**role chaining**: the original human is still nameable after N hops. The observed pattern is
"append a field per delegation concept, never mutate `type`".

**Verbatim example of the acting-identity/issuer split** (from the same page):

```json
"userIdentity": {
    "type": "AssumedRole",
    "principalId": "AROAIDPPEZS35WEXAMPLE:AssumedRoleSessionName",
    "arn": "arn:aws:sts::123456789012:assumed-role/RoleToBeAssumed/MySessionName",
    "sessionContext": {
        "sessionIssuer": {
            "type": "Role",
            "arn": "arn:aws:iam::123456789012:role/RoleToBeAssumed",
            "userName": "RoleToBeAssumed"
        },
        "attributes": { "mfaAuthenticated": "false", "creationDate": "20131102T010628Z" }
    }
}
```

### 1.2 GCP Cloud Audit Logs — the initiator is an *ordered list* `[V]`

Read from the canonical proto,
[`google/cloud/audit/audit_log.proto`](https://github.com/googleapis/googleapis/blob/master/google/cloud/audit/audit_log.proto)
(curled 2026-07-30). `AuthenticationInfo`:

```protobuf
  // Identity delegation history of an authenticated service account that makes
  // the request. It contains information on the real authorities that try to
  // access GCP resources by delegating on a service account. When multiple
  // authorities present, they are guaranteed to be sorted based on the original
  // ordering of the identity delegation events.
  repeated ServiceAccountDelegationInfo service_account_delegation_info = 6;
```

Three things matter here:

1. It is `repeated` — a **chain**, not a single "who really did it" slot.
2. The comment commits to **ordering** ("sorted based on the original ordering of the identity
   delegation events"), i.e. the sequence is part of the contract.
3. `principal_email` (the acting service account) stays populated regardless. The delegation history
   is *additional*.

`ServiceAccountDelegationInfo` itself models "the real authority" as a `oneof`:

```protobuf
// Identity delegation history of an authenticated service account.
message ServiceAccountDelegationInfo {
  // Entity that creates credentials for service account and assumes its
  // identity for authentication.
  oneof Authority {
    // First party (Google) identity as the real authority.
    FirstPartyPrincipal first_party_principal = 1;
    // Third party identity as the real authority.
    ThirdPartyPrincipal third_party_principal = 2;
  }
}
```

Corroborated by the rendered
[AuditLog reference](https://docs.cloud.google.com/logging/docs/reference/audit/auditlog/rest/Shared.Types/AuditLog)
`[V-doc]`, which also documents `principalSubject`: *"String representation of identity of requesting
party. Populated for both first and third party identities."*

### 1.3 Microsoft Entra `directoryAudit` — one `initiatedBy` object with two typed slots `[V-doc]`

[`auditActivityInitiator` resource type](https://learn.microsoft.com/en-us/graph/api/resources/auditactivityinitiator)
(read 2026-07-30):

> Identity the resource object that initiates the activity. **The initiator can be a user, an app, or
> a system (which is considered an app).** […] This object is configured in the **initiatedBy**
> property of `directoryAudit`.
>
> | Property | Type | Description |
> | --- | --- | --- |
> | app | appIdentity | If the resource initiating the activity is an app, this property indicates all the app related information like **appId** and name. |
> | user | userIdentity | If the resource initiating the activity is a user, this property Indicates all the user related information like user ID and **userPrincipalName**. |

```json
{
  "app": {"@odata.type": "microsoft.graph.appIdentity"},
  "user": {"@odata.type": "microsoft.graph.userIdentity"}
}
```

Two notes. First, **"a system […] is considered an app"** — Microsoft explicitly refuses to invent a
third actor kind for "the platform did it"; a system actor is just an app principal. Second, the JSON
shape permits **both slots simultaneously** — the app-acting-for-a-user case — rather than an
either/or enum. It is a pair by construction.

### 1.4 Kubernetes audit v1 — `user` and `impersonatedUser` are separate fields `[V]`

Read from
[`staging/src/k8s.io/apiserver/pkg/apis/audit/v1/types.go`](https://github.com/kubernetes/kubernetes/blob/master/staging/src/k8s.io/apiserver/pkg/apis/audit/v1/types.go)
(curled 2026-07-30):

```go
	// Authenticated user information.
	User authnv1.UserInfo `json:"user" protobuf:"bytes,6,opt,name=user"`
	// Impersonated user information.
	// +optional
	ImpersonatedUser *authnv1.UserInfo `json:"impersonatedUser,omitempty" protobuf:"bytes,7,opt,name=impersonatedUser"`
```

`UserInfo` (from `k8s.io/api/authentication/v1`) is `{username, uid, groups[], extra}` `[V]` — note it
is a *structured principal*, not a string, and it carries an open `extra map[string]ExtraValue`
("any additional information provided by the authenticator") as the extension point.

Impersonation is Kubernetes' exact "A acting for B" case, and the record keeps both. Also relevant:
the audit `Event` has an open annotation map explicitly intended for pipeline components to attach
attribution-ish facts, with a naming rule:

```go
	// Annotations is an unstructured key value map stored with an audit event that may be set by
	// plugins invoked in the request serving chain, including authentication, authorization and
	// admission plugins. […] Keys should uniquely identify the informing
	// component to avoid name collisions (e.g. podsecuritypolicy.admission.k8s.io/policy). Values
	// should be short.
```

**Where "which CronJob caused this" lives in Kubernetes** `[R]`: *not* in the audit `user` field. A
CronJob-driven action is authenticated as the controller's ServiceAccount (a `system:serviceaccount:…`
username), and the link back to the CronJob is carried on the *object* via
`metadata.ownerReferences` (CronJob → Job → Pod). I did not read the controller-identity source, so
this is reported, not verified — but the structural point is verified above: the audit event models
only *authentication* identities, and provenance is a join through object metadata.

### 1.5 Linux auditd — `auid` vs `uid`, the twenty-year-old precedent `[V]`

The audit subsystem has kept the initiator and the acting identity in separate fields since it
shipped. From the audit-userspace field dictionary
([`specs/fields/field-dictionary.csv`](https://github.com/linux-audit/audit-documentation/blob/master/specs/fields/field-dictionary.csv),
curled 2026-07-30):

```
auid,numeric decimal,login user ID,
euid,numeric decimal,effective user ID,
ses,numeric decimal,login session ID,
uid,numeric decimal,user ID,
```

And from [`docs/auditctl.8`](https://github.com/linux-audit/audit-userspace/blob/master/docs/auditctl.8) `[V]`:

> **auid**
> The original ID the user logged in with. Its an abbreviation of audit uid. Sometimes its referred
> to as loginuid. Either the user account text or number may be used.

> **`--loginuid-immutable`**
> This option tells the kernel to make loginuids unchangeable once they are set. Changing loginuids
> requires CAP_AUDIT_CONTROL. So, its not something that can be done by unprivileged users. Setting
> this makes loginuid tamper-proof, but can cause some problems in certain kinds of containers.

The design intent is unmistakable: `uid`/`euid` change as the process changes identity (`su`, `sudo`,
setuid); `auid` is pinned at the entry point and made *deliberately immutable* so the trail back to
the originating login survives every identity change. `ses` (login session ID) is the correlation key
for "everything that happened in that one session". Whether the "no login" sentinel is
`4294967295`/`-1` is widely stated but I did not verify it from a primary source — `[U]`.

### 1.6 GitHub Actions — a two-field actor pair, and an explicit privilege ruling `[V-doc]`

[Contexts reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)
(read 2026-07-30):

> **`github.actor`**: The username of the user that triggered the **initial** workflow run. If the
> workflow run is a re-run, this value may differ from `github.triggering_actor`. **Any workflow
> re-runs will use the privileges of `github.actor`, even if the actor initiating the re-run
> (`github.triggering_actor`) has different privileges.**
>
> **`github.triggering_actor`**: The username of the user that initiated the workflow run. If the
> workflow run is a re-run, this value may differ from `github.actor`. […]
>
> **`github.actor_id`**: The account ID of the person or app that triggered the initial workflow run.
> […] Note that this is different from the actor username.
>
> **`github.event_name`**: The name of the event that triggered the workflow run.

Two useful reads. (i) GitHub needed exactly two fields the moment "the run was started by something
other than the person it belongs to" became possible — and it named them *initial* vs *initiating*.
(ii) It made an explicit, documented **authorization ruling**: privileges follow `github.actor` (the
original), not the current initiator. `event_name` (`schedule`, `push`, `workflow_dispatch`, …) is a
third, orthogonal "what kind of trigger" discriminator — the analogue of the `origin` enum ctrl-b is
considering.

### 1.7 RFC 8693 — the standardized actor chain, and who authorization consults `[V]`

Read from [`rfc8693.txt`](https://www.rfc-editor.org/rfc/rfc8693.txt) (curled 2026-07-30). §1.1
defines the two semantics precisely, and the distinction maps directly onto ctrl-b's choice:

> When principal A impersonates principal B, A is given all the rights that B has within some defined
> rights context and **is indistinguishable from B in that context**. […] For all intents and
> purposes, when A is impersonating B, A is B within the context of the rights authorized by the
> token.
>
> Delegation semantics are different than impersonation semantics, though the two are closely
> related. With delegation semantics, **principal A still has its own identity separate from B**, and
> it is explicitly understood that while B may have delegated some of its rights to A, any actions
> taken are being taken by A representing B. In a sense, A is an agent for B.

> Delegation semantics are typically expressed in a token by including information about **both the
> primary subject of the token as well as the actor** to whom that subject has delegated some of its
> rights. Such a token is sometimes referred to as a **composite token** because it is composed of
> information about multiple subjects.

Restated in ctrl-b's terms: option (a) — overwriting `actor` — *is impersonation*. It makes the
automation indistinguishable from the agent (or vice versa) in the log. Option (b) is delegation, and
delegation is what the spec devotes its schema to. §4.1, the `act` claim:

> The "act" (actor) claim provides a means within a JWT to express that delegation has occurred and
> identify the acting party to whom authority has been delegated. […]
>
> **A chain of delegation can be expressed by nesting one "act" claim within another. The outermost
> "act" claim represents the current actor while nested "act" claims represent prior actors. The
> least recent actor is the most deeply nested.** The nested "act" claims serve as a history trail
> that connects the initial request and subject through the various delegation steps undertaken
> before reaching the current actor. In this sense, the current actor is considered to include the
> entire authorization/delegation history, leading naturally to the nested structure described here.
>
> **For the purpose of applying access control policy, the consumer of a token MUST only consider the
> token's top-level claims and the party identified as the current actor by the "act" claim. Prior
> actors identified by any nested "act" claims are informational only and are not to be considered in
> access control decisions.**

```json
{
  "sub":"user@example.com",
  "act":
  {
    "sub":"https://service16.example.com",
    "act":
    {
      "sub":"https://service77.example.com"
    }
  }
}
```
*(Figure 6: Nested Actor Claim — service16 is the current actor, service77 a prior actor.)*

That MUST is the most decision-relevant sentence in the whole pass: **the chain is for audit; the
authorization decision is made from the current actor plus the subject.** It also settles the
subagent case — the chain is a nesting of *actors*, one per hop, with the depth implicit in the
nesting.

§4.4 adds `may_act`, the "is this delegation permitted" claim:

> The "may_act" claim makes a statement that one party is authorized to become the actor and act on
> behalf of another party.

i.e. the standard separates *who acted*, *for whom*, and *who was allowed to act for whom* into three
distinct claims. Note also the RFC's rule that identity claims inside `act`/`may_act` are
**identity-only** — "non-identity claims (e.g., "exp", "nbf", and "aud") are not meaningful when used
within an "act" claim and are therefore not used." The chain records identity, nothing else.

### 1.8 OpenTelemetry — the clear negative `[V-doc]` / `[R]`

The GenAI semantic-convention
[registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/) (read
2026-07-30) defines the per-tool-call vocabulary:

> `gen_ai.agent.id` — "The unique identifier of the GenAI agent."
> `gen_ai.agent.name` — "Human-readable name of the GenAI agent provided by the application."
> `gen_ai.conversation.id` — "The unique identifier for a conversation (session, thread), used to
> store and correlate messages within this conversation."
> `gen_ai.tool.call.id` — "The tool call identifier."
> `gen_ai.tool.name` — "Name of the tool utilized by the agent."
> `gen_ai.tool.type` — "Type of the tool utilized by the agent"
> `gen_ai.operation.name` — "The name of the operation being performed." Allowed values: chat,
> create_agent, embeddings, **execute_tool**, generate_content, **invoke_agent**, invoke_workflow,
> retrieval, text_completion

**There is no attribute for what initiated an operation** — no scheduled-job id, no parent-agent id,
no entrypoint. `[R]` for the negative: I read the agent/tool/conversation section of the registry, not
the full attribute universe, so treat "OTel has nothing" as strong-but-not-exhaustive. The
convention's implicit answer is *correlate*: stamp `gen_ai.conversation.id` on every span and join.
Every peer that instrumented itself against OTel had to invent the initiator attributes themselves
(§2.1, §2.2) — which is itself a finding about where the standard stops.

---

## 2. Angle 2 — what peer LLM/agent apps record per tool invocation

### 2.0 Scoreboard

| Project | Per-tool-call record | Initiator on the tool row? | Origin at run scope | Subagent chain |
|---|---|---|---|---|
| **Claude Code** | OTel `claude_code.tool` span + `tool_decision`/`tool_result` events | **Yes** — `agent_id`, `parent_agent_id`, `workflow.run_id` | `app.entrypoint` (cli / sdk-cli / sdk-ts / sdk-py / claude-vscode); `query_source` (main / subagent / auxiliary) | `parent_agent_id` |
| **Codex CLI** | OTel `codex.tool_decision` etc. (envelope carries `originator`, `conversation.id`) | via the shared envelope | `SessionSource` tagged union + `ThreadSource` + `originator`, persisted in `SessionMeta` | `parent_thread_id` + `depth` |
| **goose** | tool calls are messages in the session; no per-call actor | No | `session_type` enum (`User`/`Scheduled`/`SubAgent`/…) + `schedule_id` | `parent_session_id` |
| **opencode** | `Session.Message.Assistant.Tool` part | No — the containing message carries `agent` | `agent` on the session; no schedule concept | `parentID` on the session |
| **LiteLLM** | `LiteLLM_SpendLogs` row per request (+ `mcp_namespaced_tool_name`) | user/key/team/org/end-user, `agent_id` | `LiteLLM_AuditLog.changed_by` + `changed_by_api_key` for admin mutations | none |
| **LibreChat** | `toolCall` doc — `{conversationId, messageId, toolId, user, …}` | **user only** | `auditLog.actor.{type,id,name}` with `schedule`/`agent` as sibling types — but see the caveat | none |
| **open-webui** | none — HTTP-request-level audit only | No | none | none |
| **AnythingLLM** | none | No | `event_logs.userId` nullable, nothing else | none |

### 2.1 Claude Code — the only peer that stamps the full origin onto the tool record `[V-doc]`

Source: [Monitoring usage](https://code.claude.com/docs/en/monitoring-usage) (read 2026-07-30).

**Session-scope standard attributes on every metric and event** include a typed entrypoint:

> `app.entrypoint` — "How the session was launched, such as `cli`, `sdk-cli`, `sdk-ts`, `sdk-py`, or
> `claude-vscode`"
> `session.id` — "Unique session identifier"
> `user.id` / `user.account_uuid` / `user.account_id` / `user.email` / `organization.id`
> `terminal.type` — "Terminal type, such as `iTerm.app`, `vscode`, `cursor`, or `tmux`"

**The `claude_code.tool` span** carries three initiator fields *on the tool record itself*:

> `agent_id` — "Identifier of the subagent or teammate that ran the tool. Absent on the main session"
> `parent_agent_id` — "Identifier of the agent that spawned this one. Absent for the main session and
> for agents spawned directly from it"
> `workflow.run_id` — "Run identifier of the Workflow tool run that spawned this agent, prefixed
> `wf_`. Absent for agents not spawned by a workflow"
> `workflow.name` — "Name of the workflow that spawned this agent. User-authored names are replaced
> with `custom` unless the gate is set"
> `tool_use_id` — "The model's `tool_use` block id for this call. Matches the `tool_use_id` on the
> tool_result and tool_decision events and in hook payloads, **so you can join the span to those
> records**"

This is option (b) in its most literal form: `actor`-equivalent (`tool_name` + the agent running it)
is untouched, and *what initiated the run* is three independently-nullable fields — an acting-agent
id, a parent-agent pointer, and an automation ("workflow") run id. "Absent when not applicable" is
the stated convention for all three, exactly like CloudTrail's `Optional: True`.

The `claude_code.llm_request` span repeats the same trio plus `query_source` — *"Subsystem that
issued the request, such as `repl_main_thread` or a subagent name"* — and the event-level
documentation gives its coarse form: *"Category of the subsystem that issued the request. One of
`"main"`, `"subagent"`, or `"auxiliary"`"*.

**A third dimension: who authorized it.** Claude Code splits the permission decision out of the
execution record entirely, into its own span and event:

> `claude_code.tool.blocked_on_user` — `duration_ms` "Time spent waiting for the permission
> decision"; `decision` "`accept` or `reject`"; `source` "Decision source, matching the Tool decision
> event"

and on the `claude_code.tool_decision` event:

> `decision`: Either "accept" or "reject"
> `tool_source`: Tool's provenance—"builtin", "mcp", or "sdk_host_builtin_mcp"
> `source`: Where decision came from:
>   - "config": Decided automatically without prompting
>   - "hook": A PreToolUse or PermissionRequest hook returned the decision
>   - "user_permanent": User chose "Yes, and don't ask again"
>   - "user_temporary": User chose "Yes" for one-time approval
>   - "user_abort": User dismissed permission prompt without answering
>   - "user_reject": User chose "No"

So the model is a **triple**: who ran it (`agent_id`/`parent_agent_id`), what initiated the run
(`app.entrypoint`, `workflow.run_id`), and who authorized it (`decision` + `source`). Note also
`tool_source` — the *tool's* provenance (builtin vs MCP) is yet another separate field rather than a
prefix on the tool name.

### 2.2 Codex CLI — the richest *persisted* origin model: a tagged union, written to every session file `[V]`

Read from [`codex-rs/protocol/src/protocol.rs`](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)
(curled 2026-07-30). The origin is a Rust enum serialized into the durable rollout record:

```rust
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema, TS, Default)]
#[serde(rename_all = "lowercase")]
pub enum SessionSource {
    Cli,
    #[default]
    VSCode,
    Exec,
    Mcp,
    Custom(String),
    Internal(InternalSessionSource),
    SubAgent(SubAgentSource),
    #[serde(other)]
    Unknown,
}

pub enum ThreadSource {
    User,
    Subagent,
    Feature(String),
    MemoryConsolidation,
}

pub enum SubAgentSource {
    Review,
    Compact,
    ThreadSpawn {
        parent_thread_id: ThreadId,
        depth: i32,
        #[serde(default)]
        agent_path: Option<AgentPath>,
        #[serde(default)]
        agent_nickname: Option<String>,
        #[serde(default, alias = "agent_type")]
        agent_role: Option<String>,
    },
    MemoryConsolidation,
    Other(String),
}
```

Four design details worth lifting:

1. **A payload-carrying discriminator.** `SessionSource::SubAgent(SubAgentSource::ThreadSpawn{…})` is
   the typed equivalent of a packed `"subagent:<parent-id>"` string — but it serializes to a nested
   object, so the kind stays matchable and the payload stays structured. `Custom(String)` /
   `Other(String)` are the escape hatches.
2. **Explicit `depth`.** The subagent chain records how deep it is, not just its parent.
3. **`#[serde(other)] Unknown`.** The origin enum has a forward-compatible fallback variant so an
   older reader can parse a newer record — the same instinct as CloudTrail's `Unknown` type.
4. **`#[serde(alias = "agent_type")]`.** The field was renamed and kept a read alias — origin fields
   outlive their names.

The persisted `SessionMeta` (the first line of every rollout file — Codex's durable audit record)
carries the whole set, *denormalized*:

```rust
pub struct SessionMeta {
    pub session_id: SessionId,
    pub id: ThreadId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forked_from_id: Option<ThreadId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_thread_id: Option<ThreadId>,
    pub timestamp: String,
    pub cwd: PathBuf,
    pub originator: String,
    pub cli_version: String,
    #[serde(default)]
    pub source: SessionSource,
    /// Optional analytics source classification for this thread.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_source: Option<ThreadSource>,
    /// Optional random unique nickname assigned to an AgentControl-spawned sub-agent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_nickname: Option<String>,
    /// Optional role (agent_role) assigned to an AgentControl-spawned sub-agent.
    #[serde(default, alias = "agent_type", skip_serializing_if = "Option::is_none")]
    pub agent_role: Option<String>,
    …
}
```

Note `parent_thread_id`, `agent_role`, `agent_nickname` and `agent_path` appear **both** at the top
level and inside `source`. That duplication is deliberate denormalization for cheap querying — and a
mild wart (two places to keep in sync). Worth knowing before copying it wholesale.

Codex also stamps the origin on **every** telemetry event via a macro, so no call site can forget it
([`codex-rs/otel/src/events/shared.rs`](https://github.com/openai/codex/blob/main/codex-rs/otel/src/events/shared.rs)) `[V]`:

```rust
macro_rules! log_event {
    ($self:expr, $($fields:tt)*) => {{
        tracing::event!(
            target: $crate::targets::OTEL_LOG_ONLY_TARGET,
            tracing::Level::INFO,
            $($fields)*
            event.timestamp = %$crate::events::shared::timestamp(),
            conversation.id = %$self.metadata.conversation_id,
            app.version = %$self.metadata.app_version,
            auth_mode = $self.metadata.auth_mode,
            originator = %$self.metadata.originator,
            user.account_id = $self.metadata.account_id,
            …
        );
    }};
}
```

`SessionTelemetryMetadata` holds both `originator: String` **and** `session_source: String` `[V]` —
two origin fields, not one: the *client* that launched it and the *classification* of the run.

### 2.3 goose — a typed session origin plus a schedule id, with real behavioural consumers `[V]`

Read from
[`crates/goose/src/session/session_manager.rs`](https://github.com/block/goose/blob/main/crates/goose/src/session/session_manager.rs)
(curled 2026-07-30):

```rust
pub enum SessionType {
    #[default]
    User,
    Scheduled,
    SubAgent,
    Hidden,
    Terminal,
    Gateway,
    Acp,
}

pub struct Session {
    pub id: String,
    …
    pub session_type: SessionType,
    …
    pub schedule_id: Option<String>,
    pub recipe: Option<Recipe>,
    …
    pub parent_session_id: Option<String>,
    …
}
```

This is the closest structural match to A3's needs anywhere in the peer class: **a typed origin enum
whose variants are exactly `User | Scheduled | SubAgent`, plus a nullable `schedule_id` naming which
schedule, plus a nullable `parent_session_id` for the subagent chain.** The kind and the id are
separate fields.

Crucially the typed field is not decoration — two live consumers branch on it:

```rust
    async fn list_sessions(&self) -> Result<Vec<Session>> {
        self.list_sessions_by_types(Some(&[SessionType::User, SessionType::Scheduled]))
            .await
    }
```
Default listings show only `User` and `Scheduled`; `SubAgent`/`Hidden`/`Terminal`/`Gateway`/`Acp`
sessions are filtered out of the user-facing list. Same for insights
(`get_insights(&[SessionType::User, SessionType::Scheduled])`).

```rust
        if session.session_type == SessionType::Scheduled {
            return Ok(None);
        }
```
…in `maybe_update_name` — scheduled runs are exempt from LLM-generated session titles.

**Attribution is at run scope, not per tool call.** goose's tool calls live as messages inside the
session; there is no actor field on a tool request. The join is via the session.

### 2.4 opencode — a parent pointer on the session, an agent name on the message, nothing on the tool `[V]`

Read from [`packages/schema/src/session.ts`](https://github.com/sst/opencode/blob/dev/packages/schema/src/session.ts)
and `packages/schema/src/session-message.ts` (curled 2026-07-30):

```ts
export const Info = Schema.Struct({
  id: ID,
  parentID: ID.pipe(optional),
  projectID: Project.ID,
  agent: Agent.ID.pipe(optional),
  model: Model.Ref.pipe(optional),
  …
}).annotate({ identifier: "SessionV2.Info" })
```

The tool record itself carries **no** identity:

```ts
export const AssistantTool = Schema.Struct({
  type: Schema.Literal("tool"),
  id: Schema.String,
  name: Schema.String,
  provider: Schema.Struct({ executed: Schema.Boolean, … }).pipe(optional),
  state: ToolState,
  time: Schema.Struct({ created: …, ran: …, completed: …, pruned: … }),
}).annotate({ identifier: "Session.Message.Assistant.Tool" })
```

…while the containing assistant message does:

```ts
export const Assistant = Schema.Struct({
  ...Base,
  type: Schema.Literal("assistant"),
  agent: Schema.String,
  model: Model.Ref,
  content: AssistantContent.pipe(Schema.Array),
  …
})
```

So opencode's attribution is a **two-level join**: `session.parentID` (was this a subagent run, and
of what) → `message.agent` (which agent identity produced this tool call) → the tool part. No
scheduled-run concept exists (consistent with R7 §1.7), so it has no automation dimension at all.
`fromRow` in `packages/core/src/session/info.ts` confirms `parent_id` is a real persisted column `[V]`.

### 2.5 LiteLLM — a credential/principal **pair**, and a permissioned "on behalf of" override `[V]`

Read from [`litellm/proxy/schema.prisma`](https://github.com/BerriAI/litellm/blob/main/litellm/proxy/schema.prisma)
(curled 2026-07-30). The admin audit table records two identities per row, with the comments spelling
out the split:

```prisma
model LiteLLM_AuditLog {
  id                 String   @id @default(uuid())
  updated_at         DateTime @default(now())
  changed_by         String   @default("")   // user or system that performed the action
  changed_by_api_key String   @default("")   // api key hash that performed the action
  action             String      // create, update, delete
  table_name         String      // …
  object_id          String      // id of the object being audited…
  before_value       Json?       // value of the row
  updated_values     Json?       // value of the row after change
}
```

`changed_by` is the *logical* principal ("user **or system**"), `changed_by_api_key` the *credential*
that actually authenticated. Both are always written. And the logical principal is
**client-overridable, but only with permission** —
[`litellm/proxy/management_helpers/audit_logs.py`](https://github.com/BerriAI/litellm/blob/main/litellm/proxy/management_helpers/audit_logs.py) `[V]`:

```python
def get_audit_log_changed_by(
    *,
    litellm_changed_by: Optional[str],
    user_api_key_dict: UserAPIKeyAuth,
    litellm_proxy_admin_name: Optional[str],
) -> Optional[str]:
    if litellm_changed_by and _allows_litellm_changed_by_header(user_api_key_dict):
        return litellm_changed_by
    return user_api_key_dict.user_id or litellm_proxy_admin_name
```

…gated by `ALLOW_LITELLM_CHANGED_BY_HEADER_METADATA_KEY = "allow_litellm_changed_by_header"` on the
key's or team's metadata. This is RFC 8693's `may_act` in miniature: a caller may name a different
initiator **only if** it holds that capability, and the real credential (`changed_by_api_key`) is
recorded regardless so the override is always auditable.

The per-request log (`LiteLLM_SpendLogs`) is the widest identity row in the peer class:

```prisma
model LiteLLM_SpendLogs {
  request_id          String @id
  call_type           String
  api_key             String  @default ("") // Hashed API Token…
  …
  user                String?   @default("")
  team_id             String?
  organization_id     String?
  end_user            String?
  requester_ip_address String?
  session_id          String?
  status              String?
  mcp_namespaced_tool_name String?
  agent_id            String?
  proxy_server_request Json?     @default("{}")
}
```

Note the *five* nested principal scopes (key → user → team → org → end_user) held simultaneously
rather than collapsed, plus `session_id` as the correlation key and `mcp_namespaced_tool_name` /
`agent_id` for the tool and agent. Correction to a plausible assumption: `agent_id` here is the
**A2A agent being called** (a routed agent endpoint), not the agent that initiated the call — it is a
target, not an actor `[V]`, from the `/a2a/{agent_id}` route table in `litellm/types/utils.py`.

The `StandardLoggingUserAPIKeyMetadata` TypedDict `[V]` carries the same set as
`user_api_key_hash`, `user_api_key_user_id`, `user_api_key_team_id`, `user_api_key_org_id`,
`user_api_key_end_user_id`, `user_api_key_request_route`, … — i.e. the acting credential is a
*prefix namespace*, and the on-behalf-of end user is one field within it.

### 2.6 LibreChat — the one peer that chose a single typed actor (and hasn't shipped it for tool calls) `[V]`

Read from [`packages/data-schemas/src/types/admin.ts`](https://github.com/danny-avila/LibreChat/blob/main/packages/data-schemas/src/types/admin.ts)
(curled 2026-07-30). The comment states the position explicitly:

```ts
/**
 * Who initiated the action. Non-human actors are first-class: a scheduled job,
 * an agent acting autonomously, an internal service, or a webhook are all
 * representable without forcing a `User` id.
 */
export const AUDIT_ACTOR_TYPES = [
  'user',
  'system',
  'agent',
  'service',
  'schedule',
  'webhook',
  'api',
] as const;

/** Denormalized actor identity captured at write time. */
export type AuditActor = {
  type: AuditActorType;
  /** Stable id (user id, service-account id, agent id); absent for anonymous
   * system events. */
  id?: string;
  /** Display name captured at write time so the record stays readable after the
   * underlying principal is renamed or deleted. */
  name: string;
};
```

So `agent` and `schedule` are **sibling values of one enum** — the closest thing in the peer class to
ctrl-b's option (a). Three qualifications, all important:

1. Even here the actor is a **structured triple** (`type` + `id` + `name`), not a bare enum — so
   "which schedule" is expressible as `{type:'schedule', id:'…'}`. Where the *agent inside* that
   schedule goes is unresolved by the type list.
2. The run id and trigger type are pushed into an **untyped metadata map**:
   ```ts
   /** Primitive metadata values; event-specific payload is a flat string-keyed map
    * (e.g. `{ capability }` for grants, `{ runId, triggerType }` for agent runs). */
   export type AuditMetadata = Record<string, AuditMetadataValue>;
   ```
   That is, the pair still exists — as `actor.type` + `metadata.triggerType`/`metadata.runId` — but
   the second half is unindexed JSON.
3. **It is not shipped.** `AUDIT_CATEGORIES` declares `agent_run`, `tool_call`, `mcp`, `approval`
   — but `AUDIT_ACTIONS` is `['grant.assigned', 'grant.removed']` and `recordAuditEntry` is called
   only from the admin roles/grants routes `[V]`. So the agent/schedule actor types have **no live
   writer**; the design is aspirational.

The parts LibreChat *has* shipped are worth stealing independently of the actor question — the record
is append-only by schema contract with a hash chain (`chainKey`/`seq`/`prevHash`/`hash`, every field
`immutable`, every update/delete/bulk path blocked in pre-hooks), and `outcome` is first-class:

```ts
/** Result of the audited operation. Kept first-class instead of being encoded
 * into the action so `allowed` vs `denied` vs `failed` is queryable. */
export const AUDIT_OUTCOMES = ['success', 'failure', 'denied', 'pending'] as const;
```

(ctrl-b already has this as `Event.status: RunState`.)

Its actual per-tool-call record ([`schema/toolCall.ts`](https://github.com/danny-avila/LibreChat/blob/main/packages/data-schemas/src/schema/toolCall.ts)) `[V]`
stamps **only the human**:

```ts
{ conversationId, messageId, toolId, user /* ObjectId ref 'User' */, result, attachments,
  blockIndex, partIndex, tenantId, expiredAt }
```

No agent id, no origin. If LibreChat gained scheduled agent runs tomorrow, this row could not tell an
unattended call from an interactive one.

### 2.7 open-webui — a Kubernetes-shaped HTTP audit, blind to tool calls `[V]`

[`backend/open_webui/utils/audit.py`](https://github.com/open-webui/open-webui/blob/main/backend/open_webui/utils/audit.py)
(curled 2026-07-30) is a near-transliteration of the Kubernetes audit design — same level ladder,
same field names:

```python
class AuditLogEntry:
    # `Metadata` audit level properties
    id: str
    user: Optional[dict[str, Any]]
    audit_level: str
    verb: str
    request_uri: str
    user_agent: Optional[str] = None
    source_ip: Optional[str] = None
    # `Request` audit level properties
    request_object: Any = None
    # `Request Response` level
    response_object: Any = None
    response_status_code: Optional[int] = None

class AuditLevel(str, Enum):
    NONE = 'NONE'
    METADATA = 'METADATA'
    REQUEST = 'REQUEST'
    REQUEST_RESPONSE = 'REQUEST_RESPONSE'
```

But it borrowed `user` and **not** `impersonatedUser`, and the user payload is narrow:

```python
            user = user.model_dump(include={'id', 'name', 'email', 'role'}) if user else {}
```

It is ASGI middleware (`if scope['type'] != 'http': return await self.app(...)`) that skips
unauthenticated requests outright:

```python
        # Skip logging if the request is not authenticated
        if not request.headers.get('authorization') and not request.cookies.get('token'):
            return True
```

Consequences: (i) tool calls the assistant makes inside a chat produce **no** audit row — only the
HTTP `POST /api/chat/completions` that started the turn does; (ii) an open-webui "Automation" (the
hand-rolled poll loop from R7 §1.2) runs server-side and therefore emits no audit entry at all. `[V]`
for the code; the automations-emit-nothing inference is `[R]` — I did not read the automations
runner in this pass.

### 2.8 AnythingLLM — the floor: one nullable user id `[V]`

[`server/prisma/schema.prisma`](https://github.com/Mintplex-Labs/anything-llm/blob/master/server/prisma/schema.prisma)
and [`server/models/eventLogs.js`](https://github.com/Mintplex-Labs/anything-llm/blob/master/server/models/eventLogs.js)
(curled 2026-07-30):

```prisma
model event_logs {
  id         Int      @id @default(autoincrement())
  event      String
  metadata   String?
  userId     Int?
  occurredAt DateTime @default(now())

  @@index([event])
}
```

```js
  logEvent: async function (event, metadata = {}, userId = null) {
```

No actor type; `userId = null` *is* the system actor. A GitHub code search for `logEvent` call sites
returns only HTTP endpoint files (`endpoints/admin.js`, `workspaces.js`, `chat.js`, `system.js`, …)
`[V]` — agent tool invocations are not logged here at all, even though AnythingLLM does have agent
runs and (per R7 §1.1) scheduled ones. Its `workspace_agent_invocations` table records
`{uuid, prompt, closed, user_id, thread_id, workspace_id, …}` — a nullable `user_id`, no origin
discriminator.

**This is the shape ctrl-b would land on by drifting: one nullable identity, null meaning "not a
human", and no way to answer "what did the 3am automation touch?".**

---

## 3. Synthesis — does the field converge?

**Yes, and more sharply than expected.** Fifteen systems, two independent traditions (cloud
IAM/audit; agent runtimes), and the answer is the same:

1. **Nobody encodes the initiator by overwriting the acting-identity field.** 8/8 in Angle 1 and
   6/8 in Angle 2 (the two exceptions, open-webui and AnythingLLM, don't model the case at all — they
   are not counter-examples, they are gaps). LibreChat is the only project that *chose* a single
   actor enum containing both `agent` and `schedule`, and (i) its actor is still a `{type,id,name}`
   object, (ii) it pushes the run id and trigger type into untyped metadata, and (iii) it has no live
   writer for either type. That is not a shipped counter-precedent.

2. **The initiator is modelled as a discriminator + an id, kept separate.** CloudTrail
   `type` + `invokedBy`/`inScopeOf.sourceArn`; goose `session_type` + `schedule_id`; Claude Code
   `query_source` + `workflow.run_id`; GitHub `event_name` + `actor`; LibreChat `actor.type` +
   `actor.id`. Nobody ships a packed `"automation:<id>"` string in one column. Codex comes closest
   with a payload-carrying tagged union — which serializes to a nested object, keeping the kind
   matchable.

3. **Subagent chains are a parent pointer, not a new actor value.** `parent_agent_id` (Claude Code),
   `parent_session_id` (goose), `parentID` (opencode), `parent_thread_id` + `depth` (Codex), nested
   `act` (RFC 8693), `impersonatedUser` (k8s). None of them invented an actor kind called
   "subagent-that-was-spawned-by-X"; they added one nullable pointer and let the chain be a walk.

4. **Authorization reads the *current* actor; the chain is for the audit.** RFC 8693 says it as a
   MUST. GitHub Actions is the one documented inversion (re-run privileges follow the original
   `github.actor`) — and its reason is instructive: a re-run is a *replay of the same logical run*,
   not a new delegation. For A3, an automation run is a new run, so the RFC rule applies: privilege
   is decided from the acting identity and the automation's configured grant, not from "a human once
   set this up".

5. **Origin lives at run scope; per-tool records join to it — except where filtering matters, and
   then it is denormalized.** goose/opencode/LibreChat attribute at session scope and join.
   Claude Code duplicates `agent_id`/`parent_agent_id`/`workflow.run_id` onto every tool span
   *explicitly so the span is self-sufficient*; Codex copies `parent_thread_id`/`agent_role` to the
   top level of `SessionMeta` alongside the same data inside `source`. Denormalizing the origin onto
   the leaf record is a deliberate, common choice — the cost is keeping two copies honest.

6. **A third dimension exists that the two-way framing misses: who *authorized* it.** Claude Code's
   `decision` + `source` (config / hook / user_permanent / user_temporary / user_abort / user_reject),
   RFC 8693's `may_act`, LiteLLM's permissioned `changed_by` override, LibreChat's `outcome`
   including `denied`. "The agent ran it" and "the owner pre-approved it / confirmed it live / a
   policy allowed it" are different facts, and the systems that gate execution record both.

7. **Small but repeated engineering conventions.** Origin fields are *optional/absent* rather than
   sentinel-valued ("Absent on the main session", `Optional: True`, `skip_serializing_if`); the
   discriminator carries an explicit `Unknown`/`Other` fallback for forward compatibility (CloudTrail
   `Unknown`, Codex `#[serde(other)] Unknown`, `Custom(String)`); the display name is denormalized at
   write time (*"so the record stays readable after the underlying principal is renamed or deleted"*
   — LibreChat); and the stamping is done at a chokepoint so no call site can forget it (Codex's
   `log_event!` macro).

---

## 4. Implications for ctrl-b (short, and separable from the evidence)

ctrl-b's current record, for reference (`backend/app/domain/event.py`, `backend/app/db.py` migration
1): `events(id, ts, actor, action, target, status, summary, output)`, `actor ∈ {user, agent, system,
automation}`, docstring *"Who initiated an invocation — the audit subject written to every Event."*
That docstring is the bug in miniature: it names the field "who initiated" and uses it as "the audit
subject". The evidence says those are two facts.

1. **Take shape (b).** `actor` should mean **the acting identity** — the thing that made this
   call — and keep its current semantics for every existing row (`USER` = the owner drove it,
   `AGENT` = the model chose it, `SYSTEM` = a service did). Do not overload it per initiator.
   Recommended minimal addition, all three mirroring named precedents:
   - **`origin`** — typed, NOT NULL, default `user_chat`. Suggested domain:
     `user_chat | automation | subagent | system | unknown`. (goose `session_type`; Codex
     `SessionSource`; Claude Code `app.entrypoint`/`query_source`. Include the `unknown` fallback.)
   - **`origin_id`** — nullable text: the automation id, the parent run id, or the service name.
     (goose `schedule_id`; Claude Code `workflow.run_id`; CloudTrail `invokedBy`/`inScopeOf.sourceArn`.)
   - **`run_id`** — nullable text: the agent run/turn this call belongs to, so the log can be
     reconstructed by grouping rather than by denormalizing everything onto each row. ctrl-b already
     has a `threads` table but `events` carries no correlation key at all, so *any* join-based
     approach needs this column regardless — which is why the marginal cost of doing (b) properly is
     one migration either way.
2. **`AUTOMATION` as an `actor` value stays legitimate — but only for a tool call an automation makes
   with no agent in the loop** (a cron that calls `wake_host` directly). That is exactly CloudTrail's
   `type: AWSService` — an acting service principal — while `origin`/`origin_id` are its `invokedBy`.
   An automation-driven *agent* run writes `actor=AGENT, origin=automation, origin_id=<id>`.
3. **Model the subagent case with the same two fields**, not a new actor value:
   `origin=subagent, origin_id=<parent run id>`. If depth ever matters, Codex's explicit `depth`
   is the precedent — but a walk over `origin_id` is enough for a single-user system.
4. **Don't pack `"automation:<id>"` into one column.** Nothing in the field does it; a typed
   discriminator + separate id is both the convergent shape and the one ctrl-b's own "shape data to
   extend, not to migrate" rule points at — `origin` is the dimension that will grow variants
   (webhook, wake-word, notification-reply…) and each new one is then a single enum value, not a
   parser change. LibreChat's `metadata:{runId, triggerType}` is the anti-pattern to avoid: correct
   information, unqueryable location.
5. **Privilege keeps reading the acting identity**, per RFC 8693's MUST. An automation's grant is a
   property of the automation (its configured privilege ceiling), applied to the run; the audit chain
   is not an input to the gate. Recording it and enforcing from it are separate concerns.
6. **Note for a later slice (not this one): record *why* the call was allowed.** ctrl-b already has
   confirm-tokens and `status=DENIED`; Claude Code's `decision` + `source` shows the shipped shape for
   a nullable `authorized_by`-style field (`auto | confirmed | policy`). This belongs with ACA Slice 8
   (approvals), not A3 — flagging it so the column set is designed once rather than twice.
7. **Stamp at the chokepoint.** `ActionService.invoke` is already the single door; the origin should
   ride the same context the `actor` does so no call site can omit it (Codex's macro is the
   precedent for making that structurally impossible).
8. **Migration is additive and rule-compliant.** Three columns with defaults; backfill
   `origin='user_chat'` for existing `user`/`agent` rows (every agent run to date has been
   interactive) and `origin='system'` for `system` rows; downstream reads only the new shape — no
   legacy branch, per the no-legacy-seams directive.

---

## 5. What I could not determine

- **Whether any peer has shipped an end-to-end audit trail for a *scheduled* agent's tool calls that
  distinguishes them from interactive ones at the tool-record level.** Claude Code's
  `workflow.run_id` is the closest and is documented as shipped, but "Workflow" is its own tool-run
  concept, not a cron schedule; goose has `schedule_id` on the session but nothing on the tool call;
  LibreChat declares the categories and writes none. So the *combination* A3 wants appears to be
  unbuilt in the peer class — ctrl-b would be assembling it from two verified halves, not copying one.
- **Kubernetes' controller identity string** for CronJob-driven actions (`system:serviceaccount:…`)
  and the ownerReferences join — reasoned from the verified schema, not read from the controller
  source. `[R]`
- **The auditd "no login" sentinel** (`4294967295` / `-1`) — not verified from a primary source. `[U]`
- **Whether OpenTelemetry semconv has *any* initiator attribute outside the GenAI/agent namespace**
  (e.g. under `faas.trigger`, `cloud.*`, or `user.*`). I read the GenAI registry section only. The
  negative in §1.8 is strong for the GenAI conventions and unproven for the whole registry. `[R]`
- **open-webui's automations runner** — whether it emits any audit/event row at all. Inferred from the
  middleware being HTTP-only; not read. `[R]`
- **Azure Activity Log** (`caller` + claims) was skipped once Entra `directoryAudit` gave a cleaner
  primary; if a third cloud data point is ever wanted, that is the gap.
- **Whether goose's message/tool types carry any actor field** — I verified attribution exists at
  session scope and found none on the tool path, but did not exhaustively read goose's message enum.
  `[R]` for the negative.
- **Slack Audit Logs API** (`actor: {type, user}` typed union) — a potential fourth "single typed
  actor" data point, not fetched.

---

## 6. Provenance — how to re-verify

Every Angle-2 source and the GCP/RFC/k8s/auditd sources were fetched as **raw files** and read
directly (`curl` → grep/sed), so the quotes are byte-faithful to the named path on the named date.
CloudTrail, Entra, GitHub Actions, OTel and the Claude Code monitoring docs were read through
WebFetch against the official doc URL: wording is faithful and quoted, but exact punctuation/table
rendering may differ — marked `[V-doc]` throughout.

Working files were staged under `/home/emma/.cache/tmp/r9/` (per the tmpfs rule — emma's `/tmp` is
RAM) and are disposable; re-fetch from the URLs above rather than trusting a stale copy. No repo was
cloned; GitHub's tree API plus `raw.githubusercontent.com` was enough for every peer.

Re-verify first if relying on this after **2026-10**: Codex's `SessionSource`/`SubAgentSource` (fast
churn — it already carries a renamed field alias), LibreChat's `AUDIT_ACTIONS` (the empty-registry
finding will age the moment they wire the second writer), and Claude Code's OTel attribute tables.
