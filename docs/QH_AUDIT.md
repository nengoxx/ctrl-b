# Quality-Harness Audit (QH) — brief + report

> **What this is.** The task brief for a high-rigor audit of ctrl-b's **quality harness itself** —
> the gates, tests, hooks, CI, and executable invariants that answer *"is this repo healthy enough
> to commit, merge, or deploy?"* — run in a fresh session BEFORE the emma deploy. The audit's
> report lands in §R below (same doc, UI_AUDIT pattern). Finding ids are **QH-#** (nothing
> collides with UI_AUDIT F# · SYSTEM_AUDIT SYS-# · AGENT_CHAT_AUDIT ACA-# · ISSUES ISS-#).
>
> **Status:** BRIEF READY (2026-07-07, owner-approved) · report pending.
> **Provenance:** adapted from an externally-drafted generic prompt; grounded in this repo's canon
> so the session verifies-by-running instead of re-discovering, and cannot relitigate locked
> decisions or build items owned by scheduled phases.
>
> **How to launch:** fresh session → *"Run the quality-harness audit — read `docs/QH_AUDIT.md` and
> execute the brief."*

---

## 0. Mission

Verify that the quality harness is **reliable** (green means healthy, red means broken — no false
confidence), **single-sourced** (every gate delegates to `tools/check.py`; no parallel command
lists), and **protective of the two extensibility axes** the owner builds along:

1. **Themes** — the D28–D34 engine: adding/altering a theme must be guarded by the contracts in
   `THEME_ENGINE.md` (what exists today vs what D34 will add).
2. **Capabilities** — the `DESIGN.md` §16 extension cookbook: adding an action / utility tool /
   builtin / MCP server / skill / agent / memory backend must not be able to silently break the
   registry → gate → audit chain.

Output: the §R report + small high-confidence fixes (committed per-slice) + an explicit
**deploy-readiness verdict** feeding `PRE_DEPLOY.md` / `DEPLOY_EMMA.md`.

## 1. Ground truth — read these FIRST, in order (discovery is pre-done; verify, don't re-derive)

1. `CLAUDE.md` + `AGENTS.md` — rules of engagement, doc map, run commands.
2. `docs/HANDOFF.md` **top block only** — where the project stands (deploy is next).
3. `docs/QUALITY.md` — the harness doc of record (D33): layers, conventions, deferred items.
4. `tools/check.py` — **the single quality chokepoint.** Read it fully; every gate must delegate here.
5. `.githooks/pre-commit` + `.githooks/pre-push` — the enforcement wiring (fast vs full).
6. `.github/workflows/ci.yml` — CI (born 2026-07-07; run #1 caught undeclared ruff/pytest —
   already fixed by pinning them in `backend/pyproject.toml [dev]`; run #2 green on ubuntu-latest).
7. `docs/PRE_DEPLOY.md` + `docs/DEPLOY_EMMA.md` pre-flight — the deploy gate this audit serves.
8. `docs/SYSTEM_AUDIT.md` §2 (exemplary patterns — incl. the quality-gate and test-infra rows) and
   §3–§4 (SYS findings + routing) — the read-side of this audit is largely done there; your value
   is the **run-side**, the **drift hunt**, and the **invariant upgrades**.
9. `docs/SECURITY_MODEL.md` — trust boundary + safe-defaults checklist (Phase 6 below).
10. `docs/THEME_ENGINE.md` §14.11 + §14.14 + §14.15 — the theme contracts and WHO OWNS their
    future guards (see §2).

## 2. Settled — do NOT relitigate, do NOT build early

- **D33** (harness shape: ruff · pyright[basic→strict ratchet] · pytest · ESLint type-checked ·
  Prettier · vitest · one stdlib runner · native hooks) is **locked**. Improve within it.
- **e2e is opt-in by design** (`check.py --e2e`, PRE-DEPLOY gate, serialized — flake rationale
  documented in check.py). Don't move it into the routine gate.
- **stylelint** (CSS contracts) and **`themeContract.test.ts`** are theme-hardening items ⑨ and ⑧
  (D34 / `THEME_ENGINE.md` §14.15.1, post-deploy). **Do not build them in this audit** — at most,
  note anything that changes their spec. ([[fix-in-the-owning-phase]])
- **27 ESLint warnings** = the deferred React-Compiler-prep backlog (UI_AUDIT F13). Documented,
  not dirt. Verify the count is still accurate; don't fix them.
- **pytest-asyncio migration** = TRIAGE-2 (external_audit), deferred. The `tests/_async.py`
  shared-Runner pattern is the documented-correct 3.14 approach.
- **Chat-loop robustness** belongs to ACA (TODO Phase 12). If you find chat-loop gaps, route them
  as notes against the owning ACA slice, not as new QH work.
- Known facts (don't re-derive): pytest = **250**; frontend vitest = **212/33 files**; e2e =
  render/flows/a11y specs; Windows `--reload` is forbidden (breaks subprocess ping); tests MUST
  use `CTRLB_CONFIG`/`CTRLB_DB` temp paths, never the real `config.yaml`.

## 3. Phases

### P1 — Orient (minutes, not hours)
Record: branch · HEAD SHA · tree status · uncommitted changes. Confirm the §1 docs match the tree
(any mismatch = a QH finding, not silent adaptation).

### P2 — Run the harness, map it as-run
Run, from repo root, recording exact command · cwd · result · duration · honest blockers:
1. `python tools/check.py` (full)
2. `python tools/check.py --fast` (the pre-commit subset)
3. `python tools/check.py --e2e` — **this doubles as the PRE_DEPLOY step-0 rehearsal.** It builds
   dist + boots a preview server + headless browser; needs Playwright browsers installed.
4. `gh run list --workflow CI --limit 3` — confirm CI mirrors the local gate and is green on HEAD.
5. Verify hooks fire: `git config core.hooksPath` + read what each hook actually invokes.

Produce the gate table: | Gate | Command | Scope | Defined in | Documented in | Enforced by |
Result |. **Any check that exists but is enforced nowhere, or enforced but documented nowhere, is
a finding.**

### P3 — Drift hunt (single-source-of-truth check)
Diff the command surface across: `README.md` · `AGENTS.md` §3 · `CLAUDE.md` · `QUALITY.md` ·
`PRE_DEPLOY.md` · `DEPLOY_EMMA.md` · `frontend/package.json` scripts · `.githooks/*` · `ci.yml` ·
`deploy/linux/*.sh` + `deploy/windows/*` + `deploy/bootstrap.py`. Hunt: commands documented but
nonexistent · tools invoked but not installed by the documented setup (the exact class CI run #1
caught: ruff/pytest were undeclared — hunt for MORE of that class, e.g. Playwright browsers,
`gh`, git identity for the memory-backup tests) · hooks/CI/deploy calling divergent command sets ·
package scripts duplicating what check.py owns. Fix the smallest source-of-truth issue; never add
a parallel instruction.

### P4 — Missing/weak gates (evaluate against THIS repo; justify or drop)
For each candidate: why this repo needs it · where it lives (a `Check(...)` row in check.py unless
there's a strong reason otherwise) · local invocation · hook/CI/deploy wiring · how it avoids
duplication. Candidates to evaluate (not auto-build):
- **Build-output verification**: `vite build` is exercised only via `--e2e`. Is a routine-gate
  build check worth its ~10s, or is e2e-at-deploy enough? Decide with evidence (past build-only
  breakage?).
- **`config.example.yaml` validity guard**: a test that `load_settings(config.example.yaml)`
  parses + masks cleanly, so the template can't rot (it's the owner's bootstrap path).
- **Extension-cookbook contract tests**: for each DESIGN §16 row, does at least one test prove the
  path works end-to-end (e.g. "register a dummy `@action` → it appears in `GET /api/actions`, the
  agent toolset, and the permission gate")? Inventory coverage; add at most the 1–2 cheapest
  missing ones in the repo's drift-guard-test tradition (`test_*_d#.py` names).
- **Import-discipline guard**: `core/` must not import `services/` (SYSTEM_AUDIT verified it holds
  today, prose-only). A ~20-line test walking `app/core/*` imports makes it structural.
- **OS-agnosticism guard**: server-OS branches are allowed ONLY in `fleet._ping_cmd`,
  `check.py:venv_python/npm_argv`, and `run_shell`'s per-OS shell (ARCHITECTURE §6). A grep-based
  test pins the allowlist.
- **Doc↔code lockstep guards**: DESIGN §12's event inventory promises to mirror `session.py`'s
  emitter docstring — currently prose. A test asserting the docstring's event names == the
  emitted-event set would make today's doc-consistency work self-enforcing.
- **Test-isolation guard**: booting the app in tests without `CTRLB_HOME` writes artifacts
  (memories/ git init) to the repo root — proven 2026-07-07 during the CI fresh-checkout
  simulation. Evaluate a conftest-level guard (fail or auto-isolate when a test touches the real
  root). This is the strongest candidate: it protects the owner's real files on every local run.
- **Coverage visibility** (NOT a ratchet): is a one-line coverage summary worth adding to the full
  gate so untested new code is at least *visible*? Evaluate cost honestly.

### P5 — Invariant enforcement audit (the core deliverable)
Inventory the load-bearing invariants — sources: CLAUDE.md hard rules · ARCHITECTURE §6 (the
OS-branch rule) + §7 · DESIGN §5.5 (subagent bounds) / §12 (wire contract) / §16 · SECURITY_MODEL
checklist · THEME_ENGINE §14.11 (perf/motion rules) / §14.14 (Surface routing) · the D-entry
constraints (D3 shell gating · D22 unified overrides · D26 memory git-backup · D27 memory
registry). Classify each: **code-structured · test-enforced · tool-enforced · CI/hook-enforced ·
prose-only · stale/contradicted.** The repo already has the right upgrade idiom — drift-guard
tests named for decisions (`test_memory_registry_d27.py`) that turn doc claims into gate
assertions. For every prose-only invariant: propose the cheapest executable guard, or say why
prose is genuinely enough, or note which scheduled phase owns it (D34 items ⑧⑨, ACA slices). Rank
by (breakage-likelihood × silence-of-failure).

### P6 — Security & config safety (verify, don't re-derive)
Run the secret-hygiene tests and confirm what they pin: mask-on-read, unmask-on-write carry-over,
redaction in events/SSE/logs. Check: `.gitignore` still covers every secret-bearing path ·
tests never touch the real `config.yaml`/`ctrlb.db` (P4's isolation guard) · `run_shell`/`!` gating
tests match SECURITY_MODEL's documented model · deploy scripts preserve the 127.0.0.1 +
Tailscale-Serve boundary · **SYS-4 rider** (the dev Vite proxy widens the boundary on LAN — still
lacks its promised SECURITY_MODEL paragraph/D-entry; either write the paragraph or surface the
decision). Never print secret values.

### P7 — Fix (small, per-slice, reviewed)
Only clear, low-risk, high-confidence fixes: stale command names · wiring an existing check into
check.py · one focused drift-guard/contract test per gap (P4/P5 winners) · runner preflight
message improvements · documenting known-warnings so they aren't mistaken for dirt. Each fix = its
own tight commit ([[commit-autonomously-clearly]]), audited before the next
([[audit-each-part-before-continuing]]). NO: refactors, new architecture, new deps without
justification, D34/ACA-owned items, product-behavior changes, **push without owner confirmation**.

## 4. Deliverables (write into §R below)

1. **Repo status** — branch/SHA/tree + docs-vs-tree confirmation.
2. **Gate map as-run** — the P2 table.
3. **QH-# findings ledger** — Critical / High / Medium / Low; each with evidence (file:line or
   command output), why it matters, recommended fix, fixed-or-not.
4. **Invariant enforcement table** — the P5 classification, prose-only items ranked, owner
   decisions flagged.
5. **Changes made** — per commit: files, why, why minimal.
6. **Commands run** — every verification command, result, duration, blockers.
7. **Deploy-readiness verdict** — explicit: is the harness trustworthy enough that a green
   `check.py --e2e` + the SECURITY_MODEL checklist justifies executing `DEPLOY_EMMA.md`? What (if
   anything) must land first? Update `PRE_DEPLOY.md`/`TODO.md` Phase 9 accordingly + memory.

## 5. Constraints

Evidence-based only — no claim without a run or a file:line. Honest blockers. No push/deploy
without approval. No secrets in output. Locked decisions stand (relitigating = out of scope; a
genuinely wrong locked decision → flag as an owner decision, don't change it). Doc edits follow
the one-source-of-truth rule (update the owner doc, point from the rest).

---

## §R — Report (pending)

*Filled by the audit session.*
