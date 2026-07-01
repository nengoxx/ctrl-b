# Code-quality harness — the standard for keeping ctrl-b clean

**Status: DEFINED (2026-07-01, deep-audited + caveat-verified). Locked as [DECISIONS D33](./DECISIONS.md#d33).
Rollout sliced in [`PRE_DEPLOY.md`](./PRE_DEPLOY.md) §1.** This doc is the durable *reference* for how we
guarantee code quality: the layers, the convention picked for each, the single runner, the known caveats +
their mitigations, and the adoption/governance rules. It does **not** duplicate the step-by-step rollout —
that lives in `PRE_DEPLOY.md` §1 (each tool = its own slice with a pre-flight + review pause).

## Philosophy (owner directive 2026-07-01)

**Code quality is the top priority — via robust, reliable, conventional methods, kept as simple as they can
be *without* trading away quality.** Six principles:

1. **Convention over cleverness.** Each layer uses the tool the wider ecosystem standardized on for *our*
   stack (React 19 + Vite + TS · FastAPI + Python 3.14), not a bespoke script.
2. **Official/native primitive over extra abstraction.** When the official tool or a native git primitive
   does the job, prefer it over a fork or a wrapper framework that adds its own caveats (chosen after the
   caveat audit: official `pyright` over the basedpyright fork; native `core.hooksPath` over lefthook).
3. **Robust & reliable over minimal.** Prefer the *reproducible, hermetic* option (e.g. `pyright[nodejs]`'s
   bundled-Node wheel over a flaky first-run download). A gate that fails intermittently — or is slow enough
   to get bypassed — is worse than no gate.
4. **Enforce, don't rely on discipline.** A rule not run by a tool rots. Every gate is wired into one runner
   and a git hook — the "governance loop" locked for the theme engine (`THEME_ENGINE.md` §14.13.1). Agents
   commit autonomously here, so the machine — not memory — holds the line.
5. **One source of truth, extend additively.** No duplicated/near-duplicate runner logic (CLAUDE.md hard
   rule). The runner is **one file** with a **data-driven check list**; adding a check is appending one entry.
   OS-specifics live in **one `pathlib` chokepoint** (the ARCHITECTURE §6 spirit).
6. **Baseline, then burn down; never mix churn with logic.** Strict tooling is adopted **warn-first**, driven
   to zero incrementally. The one-time Prettier reflow lands as its **own isolated commit**.

## The layered harness

Quality is not one linter — it is a set of complementary layers, each catching what the others can't.

| Layer | Tool (the convention) | Catches | Have? |
|---|---|---|---|
| **FE type safety** | `tsc` **strict** (already on) | type errors, unused locals/params | ✅ |
| **FE lint** | **ESLint** flat + **typescript-eslint `recommended-type-checked`** + `eslint-plugin-react-hooks` + `-react-refresh` | floating promises, misused async/await, unsafe `any`, hook-deps, rules-of-hooks, React-Compiler diags | ➕ add (1b) |
| **FE format** | **Prettier** + `eslint-config-prettier` | style drift (deterministic) | ➕ add (1b) |
| **FE unit tests** | **Vitest** (D21) | logic regressions | ✅ |
| **FE e2e / a11y** | **Playwright** + `@axe-core/playwright` (D24) | broken user paths, a11y | ✅ (Phase 9 wires the suite) |
| **BE lint + format** | **ruff** (`E`/`F`/`I`, formatter) | style, imports, dead code | ✅ |
| **BE type check** | **`pyright[nodejs]`** (pinned; `basic` → ratchet `strict`) | type errors across the FastAPI service | ➕ add (1c) ← biggest gap |
| **BE tests** | **pytest** (229, temp-config safe) | backend logic | ✅ |
| **CSS contracts** | **stylelint** (keyframe-prefix · anim budget · token-only color) | theme CSS invariants | ⏸ owned by the theme-engine hardening slice (post-deploy) |
| **Runner** | one **`tools/check.py`** (stdlib chokepoint) + `npm run check-all` (FE) | "is the repo green?" in one command | ➕ add (1a) |
| **Enforcement** | native **`core.hooksPath=.githooks/`** → `check.py` (fast pre-commit · full pre-push) | stops a bad commit/push at the source | ➕ add (1d) |

Nothing overlaps: ruff/pyright (Python) · ESLint/Prettier/tsc (JS-TS) · stylelint (CSS) each own a disjoint
surface. `stylelint` stays a separate later slice (theme-engine, `THEME_ENGINE.md` §14.13) — its plugins
enforce CSS rules no JS linter has.

## Why these tools — and their caveats (verified 2026-07-01)

- **Frontend lint = type-*aware* ESLint.** The quality lever is typescript-eslint's **`recommended-type-checked`**
  (`parserOptions.projectService: true`), the tier that uses type info to catch *floating promises,
  `no-misused-promises`, unsafe `any` flows*. `eslint-plugin-react-hooks` (React-team) is the **only** source of
  React-Compiler diagnostics (future-proofs `UI_AUDIT.md` **F13**); `-react-refresh` guards Vite HMR boundaries.
  **Caveats + mitigations:** (a) *perf* — type-checked linting runs a `tsc` build first; negligible for our
  128-file FE and it runs pre-push/CI, not per-keystroke; keep `tsconfig` includes narrow (already `src`).
  (b) *false positives* — `no-unnecessary-condition` can fire "always false"; tune to `warn`. (c) *config* —
  non-project files (`vite.config.ts`, `eslint.config.js`, `tools/*.mjs`) need a `disableTypeChecked` override
  or `projectService` errors on them. (d) *react-hooks flat-config* — the legacy `recommended` preset is
  array-format and **breaks flat config**; use **`reactHooks.configs['recommended-latest']`**. (e) pin
  `typescript-eslint` to a **TS-5.9-compatible** version.
- **Frontend format = Prettier** + `eslint-config-prettier` (turns off ESLint's formatting rules so they never
  fight). No material caveats. Lint and format stay separate concerns.
- **Backend type check = `pyright[nodejs]` (official, pinned).** We have **no type checker today** — the biggest
  quality gap (ruff does *not* type-infer). We use **official pyright installed via the `nodejs` extra**
  (`pip install "pyright[nodejs]"`), which uses `nodejs-wheel` for a **reliable, hermetic bundled-Node install**
  (no flaky first-run download) and is version-pinnable (`==1.1.x` / `PYRIGHT_PYTHON_FORCE_VERSION`). Chosen over
  **basedpyright** after the caveat audit: the fork's advantages (Pylance-grade extras) we don't need, while its
  **stricter defaults cause false positives** (`reportAny` on unavoidable third-party `Any`) and it carries
  **fork-governance risk** (smaller maintainer pool). *(Alternatives kept documented: **basedpyright** — opt-in if
  we later want its extras; **Pyrefly** — Meta, pure-Rust, zero-Node; **ty** — Astral, still beta.)*
- **Runner = one stdlib `tools/check.py`.** Not twin `.sh`/`.ps1` scripts (duplicated growing logic → drift, a
  CLAUDE.md-forbidden anti-pattern). One Python file (stdlib `subprocess`/`pathlib` — **already a hard prereq**,
  zero new dep) resolves the venv python in a single OS-branch, runs a **data-driven check list**, filters staged
  files (`git diff --cached`), runs in parallel (`concurrent.futures`), delegates the FE to `npm run check-all`,
  aggregates exit codes. Adding a check = one list entry. *(Rejected: `nox`/`tox` — env-matrix overkill; `just`/
  `make` — global-dep + still needs the OS-venv indirection.)*
- **Enforcement = native `core.hooksPath`.** Not lefthook — the caveat audit found documented **lefthook Windows
  failures** ("can't find lefthook in PATH" with npm-global, Git-LFS + PowerShell edge cases), and our env is
  Windows-now → Linux(emma). Instead: git's native **`core.hooksPath = .githooks/`** (tracked hook dir, best
  practice since git 2.9) with tiny hooks that call **`python tools/check.py`** — `python` is always on PATH (the
  backend runtime), more reliable than calling `lefthook`, **zero new dependency**, and reuses the chokepoint.
  **Reliability split:** `pre-commit` → `check.py --staged` (fast, staged-file subset); `pre-push` → full
  `check.py` (types + tests) — a slow pre-commit gets `--no-verify`-bypassed. **Caveats:** cloned repos can lose
  the hook's `chmod +x` (Linux) and hook names are exact/case-sensitive — both handled by the one-time setup
  (`git config core.hooksPath .githooks` + ensure the exec bit), run by `install.sh` / a documented one-liner.
  *(Alternative kept documented: **lefthook** — richer managed runner with parallel groups, if we outgrow native
  hooks; the Python **`pre-commit`** framework — battle-tested but clashes with `core.hooksPath`.)*

## The runner contract

One command answers "is the repo green?" — every later hardening step ends by running it.

```
# Frontend  (frontend/package.json — COMPOSES existing scripts, does not re-inline)
npm run check-all   →  npm run typecheck  &&  eslint .  &&  prettier --check .  &&  npm test
# (Playwright e2e is heavier → its own `npm run test:e2e`, run in the smoke slice / pre-push.)

# Whole repo  (one stdlib chokepoint — resolves the venv, runs a data-driven check list)
python tools/check.py            # full gate: FE (npm run check-all) + BE (ruff, ruff format --check, pyright, pytest)
python tools/check.py --staged   # fast staged-file subset the pre-commit hook calls
```

`tools/check.py` finds the backend interpreter via `sys.executable` when run under the venv, else resolves
`backend/.venv/{Scripts,bin}/python` in its single OS-branch. Documented in [`AGENTS.md`](../AGENTS.md) §3 once 1a lands.

## Adoption & governance rules

- **Warn-first baseline.** Turn each strict tool on without blocking on the pre-existing backlog; get the runner
  *structurally* green, then burn findings to zero before the deploy. Hard errors from day one:
  `react-hooks/rules-of-hooks`, ruff, and any test failure.
- **Ratchet strictness.** Start pyright `basic` and the type-aware set as-is; tighten to `strict` (and add
  `@eslint-react`) as a *follow-up* once the baseline is clean.
- **Isolated format commit.** The first `prettier --write` reflow is its own commit:
  `style(frontend): adopt Prettier (formatting only, no logic)`.
- **Every new rule is enforced.** New CSS invariant → a stylelint rule; new behavioral invariant → a test; new
  type/lint rule → the config. A rule with no enforcing tool is a *visible* hole (the theme-engine `enforced by:`
  marker convention, generalized).

## Locked decisions (2026-07-01) — [DECISIONS D33](./DECISIONS.md#d33)

| # | Decision | Choice |
|---|---|---|
| 1 | Frontend lint depth | **type-aware** (`recommended-type-checked`) + react-hooks (`recommended-latest`) + react-refresh; `@eslint-react` = later ratchet |
| 2 | Backend type checker | **official `pyright[nodejs]`** (pinned, `basic` → ratchet `strict`); basedpyright/Pyrefly = documented alts; flaky plain-pyright install fixed by the `nodejs` extra |
| 3 | Runner | one stdlib **`tools/check.py`** chokepoint + npm `check-all` (composed); **no** `.sh`/`.ps1` twins |
| 4 | Enforcement | native **`core.hooksPath=.githooks/`** → `check.py`; **fast staged pre-commit / full pre-push**; lefthook = documented alt |
| 5 | Adoption mode | **baseline warn-first → burn down to clean before deploy**; Prettier reflow = own commit |

## References

- typescript-eslint — [Typed Linting](https://typescript-eslint.io/getting-started/typed-linting/) · [Performance](https://typescript-eslint.io/troubleshooting/typed-linting/performance/)
- react-hooks — [React docs](https://react.dev/reference/eslint-plugin-react-hooks) · [flat-config preset issue](https://github.com/facebook/react/issues/34679) · [`@eslint-react`](https://eslint-react.xyz/) (ratchet)
- pyright — [`pyright[nodejs]` on PyPI](https://pypi.org/project/pyright/) (nodejs-wheel) · [basedpyright caveats](https://pydevtools.com/handbook/reference/basedpyright/) · [Pyrefly 1.0](https://pydevtools.com/blog/pyrefly-1-0-is-the-obvious-mypy-upgrade/)
- git hooks — [`core.hooksPath` docs](https://git-scm.com/docs/githooks) · [husky vs lefthook vs lint-staged (2026)](https://www.pkgpulse.com/guides/husky-vs-lefthook-vs-lint-staged-git-hooks-nodejs-2026)
- In-repo: [`DECISIONS.md`](./DECISIONS.md) D21/D24/D33 · [`PRE_DEPLOY.md`](./PRE_DEPLOY.md) §1 · [`THEME_ENGINE.md`](./THEME_ENGINE.md) §14.13 · [`UI_AUDIT.md`](./UI_AUDIT.md) F13 · [`ARCHITECTURE.md`](./ARCHITECTURE.md) §6
