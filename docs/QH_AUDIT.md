# Quality-Harness Audit (QH) — brief + report

> **What this is.** The task brief for a high-rigor audit of ctrl-b's **quality harness itself** —
> the gates, tests, hooks, CI, and executable invariants that answer *"is this repo healthy enough
> to commit, merge, or deploy?"* — run in a fresh session BEFORE the emma deploy. The audit's
> report lands in §R below (same doc, UI_AUDIT pattern). Finding ids are **QH-#** (nothing
> collides with UI_AUDIT F# · SYSTEM_AUDIT SYS-# · AGENT_CHAT_AUDIT ACA-# · ISSUES ISS-#).
>
> **Status:** ✅ **DONE (2026-07-07)** — audit executed same day; report in **§R** below.
> **Verdict: GO** — harness trustworthy for the emma deploy; 9 findings fixed in 7 commits
> (QH-1…9), 2 owner decisions open (QH-10 conftest isolation guard · QH-11 `target_port` default),
> known product-test gaps routed to their owning SYS-15/ACA slices. pytest 250 → **254**.
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
  not dirt. Verify the count is still accurate (the 2026-07-07 SYS-13 test additions may have
  moved it — if so, that's a one-line doc fix in QUALITY/PRE_DEPLOY, not a code task); don't fix
  the warnings themselves.
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
1. `python tools/check.py --fast` (the pre-commit subset).
2. `python tools/check.py --e2e` — **one run = the full parallel batch PLUS e2e appended
   sequentially** (read `main()`: `--e2e` doesn't filter the batch), so this single run covers the
   full gate AND the PRE_DEPLOY step-0 rehearsal. Don't also run the bare full gate separately.
3. `gh run list --workflow CI --limit 3` — confirm CI mirrors the local gate and is green on HEAD
   (`gh` is authenticated on this machine).
4. Verify hooks fire: `git config core.hooksPath` + read what each hook actually invokes.

**Run-mechanics nuances (verified 2026-07-07 — don't rediscover, don't misread as findings):**
- **e2e is sandboxed by design**: `playwright.config.ts` builds the real dist and serves it via
  `vite preview` on **:4173**; `/api` is **fully mocked at the browser level** (`e2e/fixtures.ts`
  + per-test `page.route`) — NO backend boots, no real `config.yaml` is touched, no real fleet
  actions can fire. Safe to run.
- **Trap — `reuseExistingServer: !CI`**: a stale preview server already on :4173 gets REUSED, so
  you'd be testing an old build. Check/kill :4173 before the e2e run. Playwright browsers must be
  installed (`npx playwright install` on a browser-missing error).
- The owner's dev servers (backend :5433 · frontend :5173) don't collide with :4173, but a live
  backend polling the DB during pytest adds noise — prefer them stopped for the timed runs.
- **Windows noise, NOT findings**: git's "LF will be replaced by CRLF" warnings (the index is LF;
  `.gitattributes` deliberately forces eol only for deploy scripts/hooks) · pip's "new release
  available" notice · vitest duration being dominated by jsdom environment startup.
- **pytest side effects**: app-booting tests without `CTRLB_HOME` create root artifacts
  (`memories/` git init) only when those paths are absent — on this machine they exist, so no
  local effect. If you simulate a fresh checkout, stash the gitignored artifacts to the
  scratchpad and restore carefully (directory `Move-Item` onto an existing dir fails — a restore
  collision was hit and resolved 2026-07-07; verify `memories/.git log` shows the 2026-06-25 init
  commit after restoring).
- Every push during the audit triggers CI remotely AND the full pre-push gate locally (~2 min);
  budget for it.

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
- **Build-output verification**: `vite build` is exercised only via `--e2e` (its webServer builds
  the real dist — so the deploy gate DOES verify the build; the routine gate doesn't). Is a
  routine-gate build check worth its ~10s, or is e2e-at-deploy enough? Decide with evidence
  (past build-only breakage?).
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

**Time-boxing:** if the session is time-constrained, the deploy-readiness verdict outranks depth —
priority order: P1 → P2 (run everything) → P3 (drift) → P6 (security) → verdict draft, THEN P5
(invariant ladder) → P4 (new-gate evaluation), with P7 fixes woven in as found. A shallow-but-run
verdict beats a deep-but-unverified essay.

Evidence-based only — no claim without a run or a file:line. Honest blockers. No push/deploy
without approval. No secrets in output. Locked decisions stand (relitigating = out of scope; a
genuinely wrong locked decision → flag as an owner decision, don't change it). Doc edits follow
the one-source-of-truth rule (update the owner doc, point from the rest).

---

## §R — Report (2026-07-07 · audit session · VERDICT: **GO**)

### R1. Repo status

Branch `main`, started clean at `ade94af` (= origin, all pushed); audit fixes landed as 7 tight
local commits `a078bb1..34c30ac` + this report. Docs matched the tree everywhere the brief pinned:
pytest **250** ✓ (collect), vitest **212/33 files** ✓ (`vitest list`), e2e **34/3 specs** ✓
(`playwright test --list`), eslint **27 warnings / 0 errors** ✓ (count unchanged by the SYS-13
tests — no doc fix needed), hooks `core.hooksPath=.githooks` ✓, CI green on HEAD ✓. After the audit:
pytest **254** (4 new drift-guard tests).

### R2. Gate map as-run (all commands from repo root, dev servers stopped, :4173 free)

| Gate | Command | Scope | Defined in | Documented in | Enforced by | Result |
|---|---|---|---|---|---|---|
| ruff lint | `check.py` → `python -m ruff check .` | backend | `pyproject [tool.ruff]` | QUALITY.md | pre-commit + pre-push + CI | **PASS** 0.1s |
| ruff format | `… ruff format --check .` | backend | 〃 | 〃 | 〃 | **PASS** 0.1s |
| pyright (basic) | `… python -m pyright` | backend | `pyproject [tool.pyright]` | QUALITY.md | pre-push + CI | **PASS** 4.3s |
| pytest | `… python -m pytest -q` | backend (250→254) | `backend/tests/` | QUALITY/AGENTS | pre-push + CI | **PASS** 49.8s |
| FE check-all | `npm run check-all` (tsc×3 + eslint + prettier + vitest 212) | frontend | `package.json:19` | QUALITY.md | pre-push + CI | **PASS** 26.8s |
| FE prettier | `npm run format:check` | frontend | `package.json` | QUALITY.md | pre-commit (`--fast`) | **PASS** 1.8–2.5s |
| e2e + axe | `check.py --e2e` → `npm run test:e2e` (34 tests, mobile+desktop) | built dist @ :4173, `/api` mocked | `playwright.config.ts` | QUALITY/DEPLOY_EMMA | **deploy gate** (step-0 + settings hook; NOT CI — by design) | **PASS** 21.7s |

Timed runs: `--fast` **1.9s** · full+`--e2e` **1m12s** (one run = full parallel batch + e2e appended,
confirmed in `main()`). CI on HEAD: 3/3 green, ~1m35s each. No check exists that is enforced nowhere;
no gate invokes an undefined command (M5 in the drift hunt). Blockers: none.

### R3. Findings ledger (QH-#)

**Fixed this session (commit in parens):**

| # | Sev | Finding (evidence) | Fix |
|---|---|---|---|
| **QH-1** | **HIGH** | `deploy/linux/install.sh:65` installed the backend **without `[dev]`** while :92–100 enables the hook gate — on the emma **dev** tree (where agents commit) the first pre-commit dies with "No module named ruff". Same class as what CI run #1 caught. README:52 + `deploy/windows/setup.ps1:46` shared the bare-install shape; `check.py preflight()` didn't probe the toolchain. | dev role installs `-e backend[dev]`; preflight probes venv for ruff/pytest/pyright → actionable exit-2; README + setup.ps1 aligned (`a078bb1`) |
| **QH-2** | **HIGH** | `npx playwright install` (browser binaries — NOT installed by `npm ci`) was documented **nowhere**, yet `--e2e` is the mandatory deploy gate (DEPLOY_EMMA step-0, settings hook). | documented at the gate's definition (QUALITY.md, + the :4173 `reuseExistingServer` trap) and mandate (DEPLOY_EMMA step-0) (`0933227`) |
| **QH-3** | MED | `CLAUDE.md:65` "No CI gate beyond `ruff`" — stale since D33+SYS-14; agents read it every session. | states hooks + Linux CI (`51b752a`) |
| **QH-4** | LOW-MED | `--staged` documented as live in QUALITY.md ×3 (runner bullet, reliability split, D33 table) and in D33's locked letter (`DECISIONS.md:1653-54`), while the shipped gate is whole-tree `--fast` (deviation decided at 1d, recorded only in one section). | all four reconciled; D33 carries a dated amendment (`17aa0ff`) |
| **QH-5** | LOW | `PRE_DEPLOY.md:69` slice-1a record gave a superseded `check-all` composition (`typecheck && test && build`). | annotated in place with the shipped composition (`e1c3379`) |
| **QH-6** | MED | The SYS-4 dev-exposure paragraph promised for SECURITY_MODEL.md was never written (dev Vite `0.0.0.0` + `allowedHosts:true` + `/api` proxy bypasses the loopback bind on the LAN — `vite.config.ts:58-67`). | §2.1 paragraph + §3 residual-risk row, incl. the `target_port` rider (`4c30c70`) |
| **QH-7** | MED | DESIGN §12 ↔ `session.py` docstring lockstep **violated**: `notice` emitted (`session.py:630`) + inventoried (DESIGN:637) but missing from the docstring (:14–26). | docstring fixed + `test_sse_event_lockstep_qh7.py` pins docstring == emitted-literal set (`6d15136`) |
| **QH-8** | MED | `config.example.yaml` (the bootstrap path) had **no validity gate**; the read also found live template rot — the commented example taught the legacy `tool_descriptions` map (D22 unified `tool_overrides` shipped) and claimed MCP stdio "not yet wired" (both transports live-verified in 4f). | `test_config_example_qh8.py` (loads + validates + placeholder secrets masked) + template de-rot (`33e8266`) |
| **QH-9** | MED | ARCHITECTURE §6's "the **single** server-OS branch" was false: `memory._fsync_dir` (`memory.py:338`, benign no-op) is a 4th branch outside the documented allowlist; nothing guarded the rule or the core→services layering. | `test_arch_invariants_qh9.py` (closed OS-branch allowlist w/ stale-entry check · core never runtime-imports services, TYPE_CHECKING allowed) + §6/CLAUDE.md name the allowlist (`34c30ac`) |

**Open — owner decisions (flagged, not changed):**

| # | Sev | Item | Recommendation |
|---|---|---|---|
| **QH-10** | MED | **No conftest-level test isolation.** Every app-booting test file hand-rolls `_client()` setting `CTRLB_HOME/CONFIG/DB`; there is **no `backend/tests/conftest.py`**, so one forgetful future test boots against the repo root (proven 2026-07-07: root `memories/` git-init artifacts). | Build a ~8-line autouse fixture that **auto-isolates**: set `CTRLB_HOME` to `tmp_path` when unset (`load_settings` returns clean defaults on a missing file — verified `config.py:876-885`, so it can't break legit tests; explicit `_client()` envs still win). Alternative: fail-loudly instead of auto-isolate. Say which and I'll land it. |
| **QH-11** | LOW-MED | `TailscaleCfg.target_port` **defaults to 5173** (dev frontend, `config.py:459`) — the wrong safe-default direction (SYS-4 rider). Deploy scripts hardcode Serve→5433 so the emma deploy is unaffected; only the in-app `serve_https` action follows the default. | Flip the default to 5433 (prod SPA) post-decision — it's a product default, owner's call. Documented in SECURITY_MODEL §2.1 meanwhile. |

**Confirmed gaps already owned elsewhere (no new QH ids — routed, per brief §2):** Compactor
untested (SYS-15 → characterization tests **must precede ACA Slice 6**) · `mcp_client.py`/
`openapi_tools.py` zero adapter tests (SYS-15 → ride ACA Slice 1) · subagent §5.5 bounds
(depth-cap/priv-clamp/semaphore) implemented but unpinned (SYS-15 → ride ACA Slice 3) · coverage
measurement absent (SYS-15 item 1 — evaluated here: worth doing as SYS-15 specifies, *measure-only*,
but it adds deps and belongs to that item, not this audit) · memory-backend swap seam (`MemoryProvider`
registry) unexercised — named seam, build-on-demand · theme items ⑧⑨⑩ absent = **expected** (D34,
post-deploy).

**P4 candidates evaluated and NOT built (rationale):** routine-gate `vite build` — tsc (in the gate)
catches the type layer; vite-specific build breakage is rare and the mandatory `--e2e` deploy gate
builds the real dist; +10s/push not justified. Extension-cookbook dummy-registration tests — the
action/tool/builtin/skill/agent rows are already well covered by real-path tests (`test_tools_8`,
`test_tool_overrides_8b`, `test_core_builtins_7e`, `test_skills_7d`, `test_agents_7d`); the uncovered
rows are the routed adapter gaps above.

### R4. Invariant enforcement classification (P5)

| Invariant | Class (after this audit) |
|---|---|
| Secrets never leak (mask/unmask/redact/drift-guard) | **test-enforced** (`test_secret_hygiene.py`, 8) — verified run |
| Shell gating (D3: `run_shell` deny-below-FULL, `!` 403 when off, defaults off) | **test-enforced** (`test_shell_5.py`; membership≠privilege in `test_tool_overrides_8b`) |
| Confirm two-step + recovery (J3) / retry safety (I4) | **test-enforced** (`test_confirm_recovery_j3` 7, `test_retry_safety_i4`) |
| D22 unified overrides · D26 git-backup · D27 memory registry/state/reflection | **test-enforced** (decision-named drift-guards) |
| SSE wire contract ↔ docs (DESIGN §12) | **test-enforced NOW** (QH-7); was prose-only + violated |
| Server-OS branch allowlist (ARCH §6) · core→services layering | **test-enforced NOW** (QH-9); was prose-only (+1 undocumented branch) |
| config.example.yaml validity | **test-enforced NOW** (QH-8); was nothing |
| Harness single-source (gates→check.py) | **structure-enforced** (hooks/CI/deploy all delegate — drift hunt found zero parallel command lists) + CI |
| D33 harness shape | **tool/CI-enforced**; doc letter reconciled (QH-4) |
| Test isolation (temp config/db) | **convention-only** → QH-10 (owner) |
| Subagent bounds (DESIGN §5.5) / Compactor / MCP-OpenAPI adapters | **code-structured only** → routed (ACA 3 / pre-ACA 6 / ACA 1) |
| Theme contracts §14.11/§14.14 | partial FE tests; CSS rules eyeball-only until D34 ⑧⑨ (owned, post-deploy — unchanged) |
| Safe-defaults checklist (SECURITY_MODEL §6) | **operational** (deploy step-1), components test-enforced; dev-exposure now documented (QH-6) |
| "Don't duplicate patterns" / pre-flight discipline | prose+hooks by nature — correctly not machine-enforced |

### R5. Changes made (7 commits, each gate-green at commit time)

`a078bb1` QH-1 (install.sh dev `[dev]` + preflight probe + README/setup.ps1) · `0933227` QH-2
(playwright prereq docs) · `51b752a` QH-3 (CLAUDE.md CI line) · `17aa0ff` QH-4 (staged remnants +
D33 amendment) · `e1c3379` QH-5 (1a composition note) · `4c30c70` QH-6 (SECURITY_MODEL §2.1+§3) ·
`6d15136` QH-7 (docstring + lockstep guard) · `33e8266` QH-8 (template guard + de-rot) · `34c30ac`
QH-9 (arch guards + §6). **Not pushed** — push needs owner confirmation.

### R6. Commands run (verification log)

`git status/log` (clean @ ade94af) · `check.py --fast` **PASS 1.9s** · `check.py --e2e` **PASS 7/7,
1m12s** (the PRE_DEPLOY step-0 rehearsal, run before any fix) · `gh run list` (3× green, HEAD incl.)
· `git config core.hooksPath` + hook file reads (pre-commit `--fast` / pre-push full via `_gate.sh`,
venv-first) · `pytest --collect-only` (250) · `npm run lint` (27 warn/0 err) · `vitest list` (212) ·
`playwright test --list` (34) · `pytest test_secret_hygiene test_confirm_recovery_j3 -v` (15 PASS) ·
`git ls-files` secret sweep (NONE tracked) · port sweep :4173/:5433/:5173 (all free before e2e) ·
each new guard test run individually (4 PASS) · full `check.py` re-run after all fixes (PASS — see
Phase-9 TODO note). No blockers hit; Windows CRLF warnings + pip notice observed and ignored as
briefed.

### R7. Deploy-readiness verdict — **GO**

**The harness is trustworthy for the emma deploy.** Green means healthy: every gate runs real tools
over the real tree, the single-source chain (hooks → CI → deploy all delegating to `check.py`) held
under an adversarial drift hunt (zero parallel command lists), CI proves the whole gate on the
deploy OS, and the one place a red would have lied — the **emma dev tree's missing `[dev]`
toolchain (QH-1)** — is fixed, plus the runner now self-diagnoses that state. The `--e2e` rehearsal
(the exact step-0 command) passed 7/7 in 1m12s with its two operational traps (browsers,
:4173 reuse) now documented at the point of use. **Nothing further must land before
`DEPLOY_EMMA.md` executes.** Conditions already satisfied: step-0 = `check.py --e2e` green (rerun at
deploy time) + the SECURITY_MODEL §6 checklist against the live `config.yaml` (operational, at
deploy). Post-deploy watch-list: QH-10/11 owner decisions, and the routed SYS-15/ACA test gaps —
none deploy-blocking (they are product-code assurance gaps, not harness-trust gaps).
