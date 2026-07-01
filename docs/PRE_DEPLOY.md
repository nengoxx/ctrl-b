# Pre-deploy hardening — the gate before the emma v1.0 deploy

**Status: PLANNED (2026-07-01). Not started.** The app is *feature-complete* (Phases 0–8 shipped,
incl. all of 7e workspaces/memory/skills and Phase 8 tools). What remains before shipping v1.0 to
emma is **hardening + verification**, not features. This doc is the sequenced checklist for that work.

**Read first:** [`HANDOFF.md`](./HANDOFF.md) (status), then this. Deploy itself =
[`DEPLOY_EMMA.md`](./DEPLOY_EMMA.md) — **do not execute the deploy until the MUST steps here are
checked.**

## Why these and not others

This is a **Tailscale-only, no-auth, single-user** control panel whose entire safety story is (1) the
network trust boundary and (2) "no SSH password / API key ever leaves in a tool result, API response,
or log." The MUST items harden exactly that boundary and prove the app runs end-to-end on a fresh box.
Everything not listed here is either **parked** (theme-engine hardening + Composer Surface D31;
multi-homed addressing ROADMAP D3), **inherently a deploy/cutover activity** (Phase 10 parity vs old
`wol_server`, run-alongside; 6c-1 whisper model-warm — emma-specific tuning), or **post-v1 backlog**
(privilege levels, automations, wake word, notifications). Source audit: [`external_audit/TRIAGE.md`](./external_audit/TRIAGE.md).

## Working agreement (owner directive 2026-07-01)

**Go one step at a time. Do NOT batch or momentum-continue. Explain before you execute.** For **each**
step below, in order:
0. **Explain the issue FIRST — before any code, pre-flight read, or tool call that changes anything.**
   In plain terms tell the owner: what the problem/gap is, why it matters for the deploy, what the fix
   would touch, and the rough scope. **Wait for the owner's go-ahead on the phase before proceeding.**
   The owner is reviewing every pre-deploy phase — never jump straight into execution.
1. **Pre-flight** — read the touch-points listed (they scope the read), map the seams to reuse, confirm
   no duplication / no hardcoding / no bypassed chokepoint (see [`AGENTS.md`](../AGENTS.md) §8).
2. **State scope + design in prose**, name what's reused vs built, and **confirm with the owner before coding.**
3. Build in small slices, **audit each part**, then **pause for review** before the next step.

Ordering below is a *proposal*; re-assess at each step. Steps are largely independent — reorder if a
step's pre-flight reveals a cheaper path.

---

## MUST — these gate the deploy

### 1. Dev-hygiene scripts — `lint` / `format` / `check-all`  ·  *audit T1*
- **Goal:** one command to lint+format+typecheck+test across frontend & backend, so every later step
  verifies uniformly.
- **Why:** frontend `package.json` has **no** `lint`/`format`/`check-all` scripts today; backend has
  `ruff` + `pytest` but no single entry point. Cheap, and it de-risks all steps that follow.
- **Pre-flight reads:** `frontend/package.json`, `backend/pyproject.toml` (ruff config), any existing
  `tools/` launchers. Confirm the frontend already has eslint/prettier/tsc available before adding scripts.
- **Acceptance:** `npm run check-all` (frontend) + a backend equivalent run green; documented in `AGENTS.md` run section.
- [ ] Done

### 2. `docs/SECURITY_MODEL.md` — write the trust boundary  ·  *audit S1/L3 (P1)*
- **Goal:** make the security model *executable-adjacent* documentation before exposure.
- **Why:** no such doc exists. For a no-auth app the boundary must be explicit: single-user tailnet,
  **confirm-tokens = UX gate, NOT auth**, shell/open-terminal = **opt-in RCE**, no public bind. Plus a
  safe-defaults checklist. Frames step 3.
- **Pre-flight reads:** `AGENTS.md` §6 (security model), `backend/app/` action-gate + confirm-token
  path, `core/redact.py` / `safe_output` usage, `DECISIONS.md` (D-entries on the boundary).
- **Acceptance:** doc covers threat model, what confirm-tokens do/don't guarantee, the shell escape
  hatch's risk, secret-handling rules; linked from `AGENTS.md` + the CLAUDE.md doc map.
- [ ] Done

### 3. Secret-hygiene tests  ·  *audit K4 + N1 + L2 (all P1)*
- **Goal:** lock the "secrets never leak" invariant with tests, not discipline.
- **Why:** the boundary is currently upheld by convention. Add: **K4** centralized `safe_output()` +
  secret-leak tests (tool results / API / logs never contain `Settings.secret_values()`), **N1**
  config mask/unmask round-trip test, **L2** permission-policy table tests (each action's risk/gate is
  what's declared).
- **Pre-flight reads:** `core/redact.py`, `Settings.secret_values()`, `ActionService._record` /
  gate, the config mask path (`/api/settings` read), existing `backend/tests/` patterns. **Use a temp
  config/db (`CTRLB_CONFIG`/`CTRLB_DB`) — never the live `config.yaml`.**
- **Acceptance:** new tests fail if a secret can appear in any output surface or a policy drifts.
- [ ] Done

### 4. Robustness P1s (agent chat correctness)  ·  *audit J2 / J3 / I4*
Three distinct fixes — each is its own pre-flight/scope/review. Do NOT bundle blindly.
- **4a — J2 SSE payload guards (P1):** hand-written field validators for the wire events
  (`thread` / `message.start` / `part.added` / `tool.permission` / `tool.result` / `done` / `error`)
  so a malformed frame can't corrupt client state. *Reads:* the SSE wire protocol in `DESIGN.md`,
  frontend `store/chat.ts` event handling, backend stream emitter.
- **4b — J3 stale confirm-token recovery (P1):** a reload/restart/expiry currently leaves an unusable
  `AWAITING_CONFIRM` bubble. Add a re-mint endpoint OR a "confirmation expired — ask again / dismiss"
  affordance. *Reads:* confirm-token mint/verify path, the `.b.cmd` command bubble + confirm-resume
  flow, `AgentSession` state machine.
- **4c — I4 risk-aware retry (P1):** never one-click-retry a side-effectful failed turn. Add
  `side_effect`/`mutates` to `ToolSpec`; for a mutating tool, copy-to-draft instead of auto-resend.
  *Reads:* `ToolSpec`, the retry UI on failed turns, `ActionService.invoke`.
- [ ] 4a  ·  [ ] 4b  ·  [ ] 4c

### 5. Phase 9 smoke tests  ·  *TODO Phase 9 (unchecked)*
- **Goal:** prove the whole app runs — desktop + phone viewport + core backend actions — before it ships.
- **Why:** zero e2e/UI smoke coverage today (32 backend test files, no UI smoke suite). This is the
  end-to-end "it boots and the critical paths work" gate; it also exercises the step-4 fixes.
- **Pre-flight reads:** confirm the current **Playwright** setup (the dep string appears in
  `frontend/package.json` — verify config/harness state before adding), `docs/UI_AUDIT.md` **F24** (the
  deferred a11y/axe item folds in here), the critical user paths (Fleet action → confirm bubble →
  execute; agent turn; a WOL/service action).
- **Scope note:** consider bootstrapping just the Playwright harness *early* (alongside step 1) so
  steps 4b/4c can add a smoke case as their acceptance — decide at pre-flight.
- **Acceptance:** a small suite: desktop + 390px Android viewport happy-paths + a couple of backend
  action tests, runnable from `check-all`.
- [ ] Done

---

## CHEAP NICE — include if the per-step pre-flight shows they're small

### 6. QR-to-phone  ·  *TODO 6c-2 (last D20 piece)*
- **Goal:** `GET /api/access/qr.svg` renders the Tailscale HTTPS URL as a QR for first-run phone onboarding.
- **Why:** no QR endpoint exists; small, good first-run UX over the mic-requires-HTTPS path.
- **Pre-flight reads:** the Access/HTTPS settings panel (6c-2 core, already built), how the Serve URL is
  known server-side, existing SVG-render endpoints. Prefer a dep-free SVG QR if cheap; else assess a tiny dep.
- [ ] Done

### 7. Phase 8b tri-state access UI — eyeball @390px  ·  *TODO 8b (pending visual check)*
- **Goal:** confirm the built tri-state tool-access + descriptions UI reads correctly at phone width (D7).
- **Why:** code shipped; only the 390px visual QA is outstanding. Pure verification, no code expected.
- [ ] Done

---

## Explicitly OUT of scope here (do NOT pull forward)
- Theme-engine hardening (🟡 in TRIAGE) + **Composer Surface (D31)** — parked; resume post-deploy.
- Multi-homed addressing (**ROADMAP D3**).
- **Phase 10 cutover** (feature-parity vs `wol_server`, run-alongside) — a deploy/cutover activity.
- **6c-1 whisper model-warm** — server-side, emma-specific; tune *with* the deploy, not before.
- Post-v1 backlog (privilege levels, automations, scheduled agents, wake word, notifications, vector memory).
