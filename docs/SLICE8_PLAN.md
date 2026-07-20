# SLICE8_PLAN — Persisted approvals ("always allow") on the confirm gate (ACA Slice 8: A5) — D44

> **Status: LOCKED 2026-07-20 (the build brief).** Pipeline: ACA §5 Slice 8 sketch + §6 Q7/Q8 →
> 1 code-truth pass + 3 sourced field passes (CLI tools · agent frameworks/SDKs · mature policy
> systems: XACML, OPA, polkit, sudoers, browser/mobile grants) → owner rulings (5, 2026-07-20) →
> 2-lens adversarial review (design: GO-WITH-FIXES H1-H3/M1-M3/L1-L4 · security: GO-WITH-FIXES
> F1-F8) → the unified fix-set below → LOCK. Condensed record = DECISIONS.md D44.

## 1. Decision summary

A persisted-approval layer on the ONE action gate: owner-authored **allow-only rules** keyed by
action name (+ optional per-field arg patterns) that **downgrade a risk-derived CONFIRM to ALLOW**
— nothing else. The precedence ladder (XACML vocabulary: *ordered-deny-overrides*; an approval
discharges a *discretionary* obligation, never a *mandatory* one):

**policy DENY** (READONLY denials, `run_shell` gating — `decide()` returns DENY before any
confirm logic; structurally unreachable) **> designer forced-confirm** (`ToolSpec.confirm=True`
— un-downgradable below FULL; FULL's existing auto-run is unchanged) **> persisted approval**
(risk-derived CONFIRM→ALLOW only) **> the normal risk decision**.

The five owner rulings (2026-07-20): ① no forced-confirm bypass (Q8 closed) · ② storage =
`ToolOverride.approvals` on the unified per-tool object, NOT the ACA sketch's table · ③
structured per-field globs on typed args, any-match/OR (allow-only dissolves ordering — the OPA
incremental-allow idiom), allowlist-only (no deny matchers — sudoers `!` anti-pattern) · ④
actor-agnostic + fail-closed on miss (headless CONFIRM→DENIED conversion untouched); subject
scoping reserved, not built · ⑤ the bubble grant is args-EXACT; widening (globs / omitted
fields) is a deliberate Conf-panel act.

## 2. Schema deltas (config.py)

```python
class ApprovalRule(BaseModel):
    """One standing 'always allow' grant for a tool (D44). Allow-only by construction —
    matching NEVER produces a deny, only a CONFIRM→ALLOW downgrade in decide()."""
    model_config = {"extra": "forbid"}   # review H1: a typo'd key must 422, never silently
                                         # become a whole-action grant (args=None matches all)
    args: dict[str, str] | None = None   # {top-level field: glob}; None/{} = whole-action grant
    # values str-coerced by a field validator (review F8: unquoted YAML numbers must not
    # brick Settings.model_validate)
```

- `ToolOverride.approvals: list[ApprovalRule] | None = None` — the third dimension on the ONE
  unified per-tool object (after `description`, `agent_mode`). None/empty = no grants.
- **No other knobs.** No TTL, no subject field, no global toggle (absent list IS off). Future
  TTL/subject are declared as real optional fields when built (extra="forbid" is deliberate —
  reserved-but-unbuilt fields don't need round-trip; review H1 outranks that convenience).

## 3. Policy (core/permissions.py) — ALL of it stays in the pure module (review M2)

- **`canonical_str(value) -> str | None`**: `str` as-is · other scalars via JSON encoding
  (`true`/`false`/`5`/`1.5`) · `None` → `"null"` (review F1 — None must be pinnable) ·
  non-scalar (list/dict) → `None` (not matchable). One implementation, backend-only (the FE
  never serializes rules — §5).
- **`approval_match(rules, args) -> ApprovalRule | None`**: OR across rules; a rule matches iff
  EVERY `(field, pattern)` entry matches: field present in the **validated**
  `model_dump(mode="json")`, `canonical_str` non-None, `fnmatch.fnmatchcase(canon, pattern)`.
  Unknown field / non-scalar value → that rule is inert (fail closed). Fields a rule does NOT
  list are unconstrained **by design** — that is the documented Conf widening semantics
  (bubble-written rules list every field, §5, so exact-grants stay exact; security-lens fix (b)
  full-coverage matching REJECTED — it would break deliberate Conf partial rules).
  `fnmatchcase`, not `fnmatch` — deliberate divergence from the `core/tool.py:251` /
  `skills.py:125` sites (no OS-dependent case folding in a security matcher; review L2).
- **`decide()` gains `approved: bool = False`** (the `run_shell_allowed` parameter precedent —
  `invoke` never overrides the verdict; review M2): `spec.confirm` → FULL?ALLOW:CONFIRM
  (approved ignored — the un-downgradable rung); HIGH → ALLOW if FULL **or approved** else
  CONFIRM; MED → ALLOW if AUTO_LOW/FULL **or approved** else CONFIRM. DENY branches stay first
  and untouched (an approval can never resurrect a deny — structural).

**In `ActionService.invoke`**: before the `decide()` call, compute `rule =
approval_match(override.approvals, inp.model_dump(mode="json"))` iff the tool's override has
rules AND `not tool.spec.confirm` (skip the matcher when it can't apply); pass
`approved=rule is not None`; keep `rule` for the audit marker. Live-config consult via
`self._deps.settings.tool_overrides` — VERIFIED live by the security lens (`main.py:131` shares
the object; `runtime.apply_settings_inplace` mutates, never rebinds): a revoke wins from the
very next invoke, no caching, no TOCTOU. Approvals NEVER touch `runtime.apply_tool_overrides`
(a spec overlay would kill the confirm globally and lose args granularity).

**Rider R1 (scoped per review F4):** pin `confirm=True` on `run_shell` — verified
behavior-neutral at every call site (decide treats HIGH ≡ confirm below FULL; the `!` path is
FULL; agent DENY below FULL unless opted in) — making it un-approvable and encoding designer
intent. **No pins on config-risk tools** (`terminal_exec`/`terminal_write_file` at
`exec_risk`/`write_risk`, MCP/OpenAPI server `risk`): their HIGH is owner-configured, and the
explicit D44 stance is that owner-configured risk stays approvable (a pin would break the
deliberate `exec_risk: low` escape). Static HIGH set otherwise: reboot/shutdown already
`confirm=True`.

## 4. The grant path is SERVER-SIDE (reviews H2+H3+F1 — the one structural amendment)

`ResumeRequest.decision` gains **`"execute_always"`** (Literal extended; mirrors
opencode's Once/Always verbs). On it, the resume path — which already holds the suspended
call's validated `(tool, args)` — BEFORE executing:
1. Re-validates args through the input model and builds the args-exact rule: **every top-level
   field pinned** to `glob-escaped(canonical_str(value))` (None pinned as `"null"` — review F1:
   an omitted optional like `terminal_exec.cwd` must not silently wildcard where a destructive
   command runs). Glob-escaping (bracket `*?[`) lives beside `canonical_str` — backend-only,
   one source of truth (review H3: no FE serialization, no JS/Python float divergence).
2. If any field is non-scalar → the rule is inexpressible: skip the write, proceed as plain
   `execute`, and note it in the result summary (defense in depth behind §5's eligibility flag).
3. Otherwise appends the rule to `tool_overrides[name].approvals` **server-side under the
   settings write lock** and persists through the existing settings-apply machinery (reviews
   H2/F3: no list-through-deep-merge from a stale FE cache — the deep_merge docstring itself
   mandates dedicated handling for list sections; the bubble path is now atomic), then executes
   exactly as `execute`.

**`tool.permission` gains `always_eligible: bool`** — false when the input model has any
non-scalar top-level field (today: only `spawn_subagents`; review F2) — so the FE hides the
affordance instead of persisting a rule that can never match.

## 5. FE — the bubble affordance + the Conf panel

- **CmdBubble**: the `awaiting_confirm` row gains an "Always allow" action (rendered only when
  `always_eligible`) → `resumeCall(call_id, "execute_always")`. That is the WHOLE FE grant
  path — no settings PUT, no canonicalization, no escaping (review H3). NOTE (review L1): the
  existing `edit` action routes to the composer as a new message — there is no in-bubble
  edit-then-execute, so the grant always pins the ORIGINAL proposed args; the plan's earlier
  "captures edited args" language is void.
- **Conf panel**: the approvals editor extends **ToolCatalog** (the `tool_overrides` surface)
  and writes through **`useSaveToolOverrides`** (review M3 — the ONE existing tool-overrides
  mutation; no second write path): list rules (args summary), one-tap revoke, minimal add-rule
  form (field:pattern pairs; globs and field-omission allowed HERE — the deliberate widening
  surface). The ConfTab draft/save LWW race is the existing settings contract, accepted +
  documented (review F3; the bubble path doesn't share it).

## 6. Audit visibility (reviews M1/F6/F5)

The `Event` model has a FIXED column set (no payload, no kind field) — so the mechanism is:
every approval-fired run appends a **mandatory marker to the executed action's
`Event.summary`** (e.g. `… [auto-allowed: cmd=ls*]`). No migration, no new event kind, one
audit record per action as today. This marker is the sole visibility on the
**interactive→headless crossing** (review F5): a bubble-born grant also auto-allows AGENT and
headless-subagent re-runs of the matched call — deliberate under ruling ④, called out as its
own SECURITY_MODEL row. Rule *creation* is not evented (a visible, versionable config change).
A queryable fire-log (needed for future decay-on-disuse) would be a real events-schema
migration — reserved in §8, not built.

## 7. Invariants (amended per review)

1. An approval can never resurrect a DENY (decide()'s DENY branches precede all confirm logic).
2. An approval can never downgrade `spec.confirm=True` (decide() checks confirm before
   `approved`; run_shell pinned per R1).
3. The approval layer is allow-only — no rule shape can force a CONFIRM or DENY.
4. Approvals are consulted per-invocation from live settings (verified shared-object,
   mutate-in-place) — a revoke wins from the next call.
5. A bubble-written rule pins EVERY top-level validated field (None as "null", values
   glob-escaped) and therefore matches exactly the grant call's arg tuple and nothing else.
6. Headless approval-miss stays fail-closed (CONFIRM → DENIED conversion untouched).
7. FULL-privilege behavior is byte-identical; the `!` path is byte-identical.
8. No new routes/tables/stores/toggles; one canonicalization implementation (backend); no new
   settings-write path (bubble = resume verb; Conf = useSaveToolOverrides).

## 8. Out of scope (recorded, seams reserved)

TTL / decay-on-disuse (needs the fire-log migration) · subject/context scoping
(`allow_active`-style, additive field) · deny/ask states in the approval layer · tool-wide
one-click grain from the bubble · rule-creation events · gate-computed rule suggestions ·
in-bubble arg editing (L1) · OCC on the Conf settings draft (F3 — would be a settings-wide
mechanism, not slice-scoped). Known + documented: renaming a tool's arg field silently voids
rules listing it (fail-closed re-ask; review L3) · an orphan confirm token after an
`execute_always` race with a fresh rule is swept by TTL, grants nothing (F7).

## 9. Verification plan

`backend/tests/test_approvals_slice8.py` (fixtures: `test_privilege_7e.py` temp-config
workspace + `test_confirm_recovery_j3.py` ActionService construction):
- Ladder: READONLY+rule → DENIED · `confirm=True`+rule → needs_confirm · MED@CONFIRM+rule →
  executes · HIGH-no-confirm@CONFIRM+rule → executes · no-match → needs_confirm · FULL paths
  byte-identical.
- Matching: OR across rules · AND within a rule · unknown field → inert · non-scalar → inert ·
  unlisted field unconstrained (Conf semantics) · glob forms · escaped literals (`*` in a
  value) match exactly · canonical forms (bool/int/float/None) · a rule captured from
  `{command:X}` (cwd omitted→null-pinned) does NOT match `{command:X, cwd:"/"}` (the F1 test).
- Grant path: `execute_always` appends the exact rule + executes · non-scalar tool → executes
  without a write, summary notes it · the append survives concurrent settings writes (lock) ·
  `always_eligible` false for `spawn_subagents`, true for scalar tools.
- Liveness: revoke via settings write denies confirmation-free execution on the immediately
  next invoke.
- Audit: the summary marker present on approval-fired runs (incl. a headless-subagent run).
- R1: `run_shell` un-approvable; `decide()` outcomes for run_shell unchanged across the pin.
FE (vitest): affordance hidden when `!always_eligible` · `resumeCall` sends `execute_always` ·
Conf editor writes through `useSaveToolOverrides`.
Docs: SECURITY_MODEL rows (downgrade-only ladder · no expiry v1 · revoke=Conf/config · the
headless-crossing callout · Conf LWW note) · **DESIGN.md §3 + §14** (the gate flow — review
L4) · config.example approvals block · ACA §5 Slice 8 as-built · TODO tick · D44 as-built.

## 10. Review record (2026-07-20)

Design lens GO-WITH-FIXES: H1 extra=forbid (adopted) · H2 server-side append (adopted) · H3
server-side construction (adopted) · M1 summary marker (adopted) · M2 approved→decide()
(adopted) · M3 useSaveToolOverrides (adopted) · L1-L4 (adopted). Security lens GO-WITH-FIXES:
F1 full-field pinning + null canonical (adopted; full-coverage MATCHING rejected — breaks Conf
widening) · F2 always_eligible (adopted) · F3 accepted-as-existing-contract + doc (bubble path
made atomic) · F4 R1 scoped (adopted) · F5 mandatory marker + SECURITY_MODEL callout (adopted;
subject scoping stays reserved per ruling ④) · F6 folded into M1 · F7 noted (no action) · F8
str-coercion (adopted). Verified-by-review: deps.settings liveness · FULL/`!` byte-identity ·
run_shell pin neutrality · the DENY-first structure.
