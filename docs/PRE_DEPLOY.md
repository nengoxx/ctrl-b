# Pre-deploy hardening — the gate before the emma v1.0 deploy

**Status: IN PROGRESS (2026-07-02). Steps 1 (quality harness), 2 (SECURITY_MODEL.md) + 3 (secret-hygiene
tests) COMPLETE. ▶ NEXT = step 4 (robustness P1s: 4a SSE guards · 4b stale confirm-token · 4c risk-aware
retry). Steps 5–7 not started.** The app is *feature-complete* (Phases 0–8 shipped,
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

### 1. Code-quality harness — lint / format / typecheck / `check-all` + enforcement  ·  *audit T1*
- **Goal:** stand up the full quality harness so every later step verifies uniformly and v1.0 ships clean.
  **Harness spec + conventions + locked decisions: [`QUALITY.md`](./QUALITY.md).** This section is the
  *sliced rollout* of that spec.
- **Why:** frontend has **no** lint/format/typecheck-gate config at all; backend has `ruff` + `pytest`
  but **no type checker** (the biggest single quality gap) and no single entry point. Quality-first =
  close both gaps, at convention, before exposure.
- **Design (deep-audited + caveat-verified 2026-07-01 → [DECISIONS D33](./DECISIONS.md#d33)):** type-aware
  **ESLint + Prettier** (FE) · official **`pyright[nodejs]`** (BE) · one stdlib **`tools/check.py`** runner ·
  native **`core.hooksPath`** hooks (fast pre-commit / full pre-push). Adopted **warn-first → burn down to
  clean**; the Prettier reflow is its own commit. Full rationale, caveats + mitigations, and rejected
  alternatives (twin shell scripts, basedpyright fork, lefthook Windows edges, nox/just) in `QUALITY.md`.
- **Pre-flight reads (already done for scoping):** `frontend/package.json` + `frontend/tsconfig.app.json`
  (✅ `strict` already on — modest cleanup), `backend/pyproject.toml` (ruff config, no type checker),
  `backend/app/main.py` (✅ already modern-typed → pyright `basic` ≈ near-green), `AGENTS.md` §3 (the
  anchor to update — done), `tools/` (launcher pattern), `ARCHITECTURE.md` §6 (OS-agnostic chokepoint spirit).

**Slices — each its own pre-flight + scope + review pause (do NOT batch):**
- **1a — `tools/check.py` runner + FE `check-all` (zero new deps).** One stdlib chokepoint
  (`subprocess`/`pathlib`): resolves the venv python (single OS-branch), runs a **data-driven check list**,
  delegates FE to `npm run check-all`. Frontend `check-all` **composes existing scripts**
  (`npm run typecheck && npm test && npm run build`) — no re-inlining. Wire only what is *already green* (FE
  tsc/vitest/build; BE ruff + `ruff format --check` + pytest). Document in `AGENTS.md` §3. *Everything after appends to the list.*
- **1b — Frontend ESLint + Prettier (type-aware).** Add `eslint @eslint/js typescript-eslint
  eslint-plugin-react-hooks eslint-plugin-react-refresh eslint-config-prettier prettier` (pin
  `typescript-eslint` to a **TS-5.9-compatible** version); flat `eslint.config.js` (`recommendedTypeChecked` +
  `projectService: true`; **react-hooks via `reactHooks.configs['recommended-latest']`** — NOT the legacy
  array-format `recommended`, which breaks flat config; react-refresh `warn`; **`disableTypeChecked` override
  for non-project files** — `vite.config.ts`/`eslint.config.js`/`tools/*.mjs`; `prettier` config last);
  `.prettierrc`; scripts `lint`/`lint:fix`/`format`/`format:check`. Run warn-first (tune noisy type-checked
  rules like `no-unnecessary-condition` to `warn`); **rules-of-hooks = error**; Prettier reflow = its **own
  commit**. Add `eslint .` + `prettier --check .` into the FE `check-all`. *(`@eslint-react` = post-baseline ratchet.)*
- **1c — Backend `pyright[nodejs]`. ✅ SHIPPED 2026-07-02.** Added `pyright[nodejs]==1.1.409` to a new
  `[project.optional-dependencies] dev` + `[tool.pyright]` (`basic`, `pythonVersion="3.14"`, `venvPath="."`/
  `venv=".venv"`, `include=["app"]`); wired `Check("pyright", …)` into `tools/check.py`. **76 findings → 0**,
  all root-caused (no blanket suppressions): generic `ToolFn`/`@action` decorator + one `cast` at the
  registry-erasure boundary (contravariance, ~22); `InvocationContext.require_deps()` narrowing chokepoint
  + local sub-dep guards (~32); the `MemoryBackup.guard` Protocol annotation fixed to
  `AbstractAsyncContextManager[None]` (a real bug pyright caught); `Field(<positional default>, …)` →
  `Field(default=…, …)` in the 4 config models pyright saw as having required fields (the true root of the
  "default_factory=Model" errors — *not* a lambda workaround); an openai-SDK `cast` at the inference
  boundary; and small coerce/guard fixes. Full gate green (`python tools/check.py`: ruff, pyright, 229
  pytest, FE check-all). *Original fresh-session steps below, kept for reference:* (1) pre-flight — read `backend/pyproject.toml`
  (deps + `[tool.ruff]`; note there's no `[project.optional-dependencies]` yet), a couple of `backend/app/`
  modules to gauge typing density, and `tools/check.py` (the `build_checks()` list you'll append to). (2) Add
  `pyright[nodejs]` (pinned, e.g. `==1.1.x`) to a new `[project.optional-dependencies] dev` (install via
  `backend/.venv/Scripts/python.exe -m pip install -e ".[dev]"`; the `nodejs` extra uses `nodejs-wheel` → reliable
  hermetic bundled-Node, no flaky first-run fetch). (3) `[tool.pyright]` in pyproject: `typeCheckingMode = "basic"`,
  `pythonVersion = "3.14"`, `venvPath`/`venv` pointing at `.venv`, `include = ["app"]`. (4) Run
  `.venv/Scripts/python.exe -m pyright` → **triage the findings for the owner before fixing** (same batch cadence
  as 1b: the backend is already modern-typed, so `basic` should be near-green — expect a handful; distinguish real
  fixes from FP-prone ones like `reportMissingModuleSource`/optional-dep imports, which get `[tool.pyright]`
  ignores or `# type: ignore` with rationale). (5) Append a `Check("pyright", [py, "-m", "pyright"], BACKEND, fast=False)`
  entry to `tools/check.py` `build_checks()`. Verify `python tools/check.py` green. *(Ratchet → `strict` later, not
  blocking. basedpyright/Pyrefly = documented alternatives in QUALITY.md if the owner prefers no bundled Node.)*
- **1d — Native `core.hooksPath` enforcement (fast/full split). ✅ SHIPPED 2026-07-02.** Tracked `.githooks/`
  (`pre-commit` → `check.py --fast`, `pre-push` → full `check.py`) + a shared `_gate.sh` launcher; `git config
  core.hooksPath .githooks` in `deploy/linux/install.sh` (+ the Windows one-liner in AGENTS §3). **Decision (b),
  whole-tree:** added a fast-tagged FE `prettier` check to `build_checks()` so `--fast` = ruff (lint+format) + FE
  prettier (~2s) — `--staged` was **dropped**: measured timing (ruff 0.1s / prettier 2s whole-tree) shows staged
  scoping buys nothing but adds machinery; eslint (~11s) stays on pre-push (a slow pre-commit gets bypassed). The
  `_gate.sh` launcher prefers the **backend venv python** — dodges the Windows "python from Microsoft Store" PATH
  stub that broke a bare `python`/`python3` (caught in acceptance testing). Exec bit tracked via
  `git update-index --chmod=+x`; hooks forced `eol=lf` in `.gitattributes`. Acceptance verified: a ruff violation
  blocks the commit; the full gate blocks a bad push. *Original fresh-session spec kept below for reference:*

  <details><summary>original 1d spec</summary>

  Add a tracked `.githooks/` dir + `git config core.hooksPath .githooks` (in `deploy/linux/install.sh` + a
  documented Windows one-liner; ensure the exec bit on the hook files). `pre-commit` = fast checks; `pre-push` =
  full `python tools/check.py` (types + tests). Hooks are 2-liners delegating to `check.py` (no re-listing).
  Rationale: a slow pre-commit gets `--no-verify`-bypassed; native+`python` dodges lefthook's Windows PATH edges
  (D33). check.py `--fast` was backend-ruff-only with no `--staged`; 1d either implements `--staged` OR the MVP:
  fast-tagged FE checks so `--fast` covers both halves. *(lefthook = documented alt if we want a managed runner.)*
  </details>
- **Acceptance:** `python tools/check.py` runs green across both halves; a bad commit is blocked
  (fast) pre-commit and a bad push (full) pre-push; harness documented in `AGENTS.md` §3 + `QUALITY.md` + D33.
- **Locked edge-case handling (2026-07-01):** (1) line endings → `.gitattributes` normalize-to-LF (applied
  narrowly to `deploy/linux/**`, `tools/*.sh`, `.githooks/**` — the LF-sensitive scripts); (2) partial-staged
  files → *simple* (the pre-commit lints the working tree whole, documented caveat); (3) aggregation →
  *run-all-and-summarise* (every check runs even if one fails).
**▶ SESSION HANDOFF (2026-07-02) — STEP 1 COMPLETE: 1a + 1b + 1c + 1d all SHIPPED.** The quality harness is
fully stood up + enforced: `python tools/check.py` green across both halves; `.githooks/` (pre-commit `--fast`
· pre-push full) live via `core.hooksPath`. **▶ NEXT = step 2 (`docs/SECURITY_MODEL.md`)** — see its pre-flight
reads below. (New clone / Windows dev: enable hooks once with `git config core.hooksPath .githooks`.)

- [x] **1a — SHIPPED 2026-07-01** (`a507200`, `e11f679`, `5bad302`). `tools/check.py` runner (flags: `--fast`,
  `--backend`, `--frontend`; **no `--staged` yet — see 1d**) + FE `check-all`. Caught a UTF-8 bug in itself +
  pre-existing ruff drift (fixed, inert). 229 backend tests green.
- [x] **1b — SHIPPED 2026-07-02.** Frontend ESLint (type-aware) + Prettier, incl. tests/e2e.
  - **1b-1** Prettier — `48d8d84` (reflow) + `c2f7d2c` (wire). printWidth 100, endOfLine auto, CSS excluded (D7/stylelint later).
  - **1b-2a** ESLint type-aware on `src`: **209 → 0 errors**. Switch a11y fix + drop jsx-a11y (`b45499f`/`120d52a`);
    batch (a) promises `335837e`; batch (b) hooks `f100d59`; unbound-method `a3f812b`; batch (c+d) `a714e94` + gate `a832762`.
  - **1b-2b** tests/e2e now type-checked (separate `tsc -p`) + type-aware-linted — `ebdf17b`.
  - **⚠ Left behind (intentional, documented in QUALITY.md):** **27 non-blocking eslint `warn`s** = the
    React-Compiler-prep backlog (`set-state-in-effect` 11 / `refs` 8 at `warn`) + `exhaustive-deps` 2 + react-refresh 6.
    They are the checklist to clear **at React Compiler adoption** (UI_AUDIT F13). Do NOT "fix" piecemeal now.
- [x] **1c — SHIPPED 2026-07-02.** `pyright[nodejs]==1.1.409` (basic) wired into `check.py`; 76 → 0, all
  root-caused (generic `ToolFn`+cast · `require_deps()` · `MemoryBackup` Protocol fix · `Field(default=…)` ·
  boundary casts). Ratchet to `strict` later (non-blocking). Full gate green.
- [x] **1d — SHIPPED 2026-07-02.** `.githooks/` (pre-commit `check.py --fast` · pre-push full · shared
  `_gate.sh` venv-python launcher) via `core.hooksPath`; whole-tree `--fast` (ruff + FE prettier), eslint on
  pre-push. install.sh enables it; Windows one-liner in AGENTS §3. Acceptance verified (bad commit/push blocked).
  **→ Step 1 (quality harness) COMPLETE.**

### 2. `docs/SECURITY_MODEL.md` — write the trust boundary  ·  *audit S1/L3 (P1)*
- **Goal:** make the security model *executable-adjacent* documentation before exposure.
- **Why:** no such doc exists. For a no-auth app the boundary must be explicit: single-user tailnet,
  **confirm-tokens = UX gate, NOT auth**, shell/open-terminal = **opt-in RCE**, no public bind. Plus a
  safe-defaults checklist. Frames step 3.
- **Pre-flight reads:** `AGENTS.md` §6 (security model), `backend/app/` action-gate + confirm-token
  path, `core/redact.py` / `safe_output` usage, `DECISIONS.md` (D-entries on the boundary).
- **Acceptance:** doc covers threat model, what confirm-tokens do/don't guarantee, the shell escape
  hatch's risk, secret-handling rules; linked from `AGENTS.md` + the CLAUDE.md doc map.
- [x] **Done 2026-07-02.** [`SECURITY_MODEL.md`](./SECURITY_MODEL.md) written — descriptive, single-user,
  every claim code-anchored: trust boundary + threat model (incl. non-goals), the layers (127.0.0.1 bind +
  Serve HTTPS · `permissions.decide` privilege table · confirm-tokens = UX gate not auth · `redact()`),
  residual-risk register that flags the two known gaps (in-memory tokens **→ step 4b**, redaction
  convention-not-tested **→ step 3**), secret-handling rules, and a pre-exposure safe-defaults checklist.
  Linked from AGENTS §6 (TL;DR → deep ref) + the CLAUDE.md doc map. **▶ NEXT = step 3 (secret-hygiene tests).**

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
- [x] **Done 2026-07-02.** `backend/tests/test_secret_hygiene.py` (8 tests). **K4:** two-way masking
  (every real secret masked/collected/redacted; non-secrets never), `secret_values` completeness, redact
  leak-scrub, unmask round-trip (leaf + maps), + a **Settings drift-guard** (fails if a future
  secret-looking field is unclassified). **L2:** destructive-action risk/confirm pinned + `decide()`
  outcomes per privilege. **N1** already covered by `test_settings_7a.py` (not duplicated).
  **Root fix landed in `config.py`:** secret identification moved from name-substring guessing (which
  masked `threshold_tokens`, a collision) to **two explicit rules** — exact-name leaves
  (`api_key`/`ssh_password`) + scoped hints inside the `env`/`headers` maps (masks `Authorization`,
  keeps `Content-Type`). Also *fixes* a prior false-negative (`Authorization` header now caught).
  No `safe_output()` runtime layer added — redaction stays at the existing discrete output points (no
  hot-path cost). Chose precise-over-catch-all deliberately (single-user tailnet: a false-positive can
  corrupt config, a false-negative only shows the owner their own secret in their own browser). **▶ NEXT = step 4.**

### 4. Robustness P1s (agent chat correctness)  ·  *audit J2 / J3 / I4*
Three distinct fixes — each is its own pre-flight/scope/review. Do NOT bundle blindly.
- **4a — J2 SSE payload guards (P1). ✅ SHIPPED 2026-07-02.** A hand-written validator layer in
  `store/chat.ts` (`asPart`/`asToolResult`/`str`/`nonEmpty`/`isRunState`) is the single point the wire is
  trusted — every event's `data` is checked against the `types.ts` shapes before it mutates state,
  replacing ~15 blind `as` casts. A malformed-but-valid-JSON frame (backend edge / proxy mangling) is
  **dropped** (dev-warn), never crashes the reducer, never fails the turn; unknown event types are ignored
  (forward-compat); validators are passthrough-tolerant (extra fields ignored). Hand-written not zod — the
  delta events are per-token, so a schema lib's per-call + bundle cost isn't worth it (researched: matches
  Vercel AI SDK / OpenAI / Anthropic client behaviour). Tests: 5 new cases in `tests/store/chat.test.ts`
  (garbage part/result dropped, unknown event ignored, passthrough, missing-id dropped) — 14 chat tests green.
- **4b — J3 stale confirm-token recovery (P1). ✅ SHIPPED 2026-07-02.** The durable persisted
  `AWAITING_CONFIRM` call + the explicit `execute` are now the confirmation — so the ephemeral token no
  longer has to survive. `session.resume(execute)` re-mints the confirm token **server-side** for the
  pending call via a new `ActionService.confirm_token_for(name, args)` (reuses `_mint_token` + the exact
  `invoke` args-canonicalization), so execute runs in **one click** after a backend restart / 120s expiry /
  client reload. Backend-only (frontend already sends no token post-reload); no security change (token was a
  UX gate, not auth — SECURITY_MODEL §2.3; the two-step is preserved). Chose this over a re-mint endpoint /
  "expired" affordance after researching human-in-the-loop patterns (LangGraph durable-checkpoint resume;
  opencode/Claude Code keep approvals ephemeral only because their loop is — we already persist ours).
  Tests: `tests/test_confirm_recovery_j3.py` (4) — mechanism, execute-recovers-after-token-loss, dismiss
  still works, no double-execute. 241 backend tests green.
- **4c — I4 risk-aware retry (P1):** never one-click-retry a side-effectful failed turn. Add
  `side_effect`/`mutates` to `ToolSpec`; for a mutating tool, copy-to-draft instead of auto-resend.
  *Reads:* `ToolSpec`, the retry UI on failed turns, `ActionService.invoke`.
- [x] **4a — SHIPPED 2026-07-02** (SSE payload guards; `store/chat.ts` validator layer + 5 tests).  ·  [x] **4b — SHIPPED 2026-07-02** (stale confirm-token recovery; server-side re-mint + 4 tests).  ·  [ ] 4c

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
