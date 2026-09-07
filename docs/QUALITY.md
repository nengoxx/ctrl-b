# Code-quality harness — the standard for keeping ctrl-b clean

**Status: DEFINED (2026-07-01, deep-audited + caveat-verified). Locked as [DECISIONS D33](./DECISIONS.md#d33).
Rollout sliced in [`PRE_DEPLOY.md`](./PRE_DEPLOY.md) §1. Independently audited 2026-07-07 —
[`QH_AUDIT.md`](./QH_AUDIT.md) §R/§R-2, verdict GO (QH-1…16 fixed; this doc is the owner of the
gate's command list and test counts).** This doc is the durable *reference* for how we
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
| **FE lint** | **ESLint** flat + **typescript-eslint `recommended-type-checked`** + `eslint-plugin-react-hooks` + `-react-refresh` | floating promises, misused async/await, unsafe `any`, hook-deps, rules-of-hooks, React-Compiler diags | ✅ (1b) |
| **FE format** | **Prettier** + `eslint-config-prettier` | style drift (deterministic) | ✅ (1b) |
| **FE unit tests** | **Vitest** (D21 — 2,982 across 174 files, 2026-09-07 post-D70 §8.4a satellite placement + the S4 code-round fix wave (a malformed persisted placement MAP · the agent-roster invalidation on a settings save): the pure `composeLayout` + its healing · the parameterized never-in-two-places guard (DefaultRoot + Conf across conf/button/tab, malformed, minimal, deep boot, live flip) · the placement-flip scroll-cache clear · the Conf tail numbering across every hosted combination · gacha's キャラ at five columns) | logic regressions | ✅ |
| **FE e2e / a11y** | **Playwright** + `@axe-core/playwright` (D24) | broken user paths, a11y | ✅ (Phase 9 wires the suite) |
| **BE lint + format** | **ruff** (`E,F,I,ASYNC,B` — `backend/pyproject.toml:87`; formatter) | style, imports, dead code, async footguns, bugbear | ✅ |
| **BE type check** | **`pyright[nodejs]`** (pinned `==1.1.409`; `basic` → ratchet `strict`) | type errors across the FastAPI service | ✅ (1c) |
| **BE tests** | **pytest** (2,373 collected 2026-09-07 post-D70 S4 Build 1 + its code-round fix wave (the `GET /agents` summary map — incl. a malformed CONFIGURED default — + the prompt-registry groups) and S3 + its fix wave + the resume riders (flag + attachment-only anchor) (the lorebook subsystem: scan · budget · placement · CRUD · book import · the card hook; the wave adds the resume window, the scan-path slug guard and the position/logic downgrade hardening), temp-config safe — `conftest.py`: a module-level env guard that runs before any test module imports, plus the per-test autouse fixture; QH-10 + UPDATE_PLAN §3.7) | backend logic | ✅ |
| **CSS contracts** | **stylelint** (keyframe-prefix · anim budget · the two accent correctness rules) | theme CSS invariants | ✅ shipped 2026-07-10 (warn-first; `lint:css` in `check-all`) |
| **Runner** | one **`tools/check.py`** (stdlib chokepoint) + `npm run check-all` (FE) | "is the repo green?" in one command | ✅ (1a) |
| **Enforcement** | native **`core.hooksPath=.githooks/`** → `check.py` (fast pre-commit · full pre-push) | stops a bad commit/push at the source | ✅ (1d) |

Nothing overlaps: ruff/pyright (Python) · ESLint/Prettier/tsc (JS-TS) · stylelint (CSS) each own a disjoint
surface. `stylelint` is the adopted CSS-contract layer (Hardening v2 ⑨, 2026-07-10 — warn-first; config
`frontend/stylelint.config.mjs` + the custom accent plugin) — its rules cover CSS no JS linter can.

## Why these tools — and their caveats (verified 2026-07-01)

- **Frontend lint = type-*aware* ESLint.** The quality lever is typescript-eslint's **`recommended-type-checked`**
  (`parserOptions.projectService: true`), the tier that uses type info to catch *floating promises,
  `no-misused-promises`, unsafe `any` flows*. `eslint-plugin-react-hooks` (React-team) is the **only** source of
  React-Compiler diagnostics (future-proofs `UI_AUDIT.md` **F13**); `-react-refresh` guards Vite HMR boundaries.
  **Caveats + mitigations:** (a) *perf* — type-checked linting runs a `tsc` build first; negligible for our
  216-file FE (`.ts`/`.tsx` under `frontend/src`, 2026-08-17) and it runs pre-push/CI, not per-keystroke; keep
  `tsconfig` includes narrow (already `src`).
  (b) *false positives* — `no-unnecessary-condition` can fire "always false"; tune to `warn`. (c) *config* —
  non-project files (`vite.config.ts`, `eslint.config.js`, `frontend/scripts/*.mjs`) need a `disableTypeChecked`
  override or `projectService` errors on them. (d) *react-hooks flat-config* — the legacy `recommended` preset is
  array-format and **breaks flat config**; use **`reactHooks.configs['recommended-latest']`**. (e) pin
  `typescript-eslint` to a **TS-5.9-compatible** version.
- **Frontend format = Prettier** + `eslint-config-prettier` (turns off ESLint's formatting rules so they never
  fight). No material caveats. Lint and format stay separate concerns.
- **Backend type check = `pyright[nodejs]` (official, pinned).** We had **no type checker** — the biggest
  quality gap (ruff does *not* type-infer). **Scope note (QH deep pass 2026-07-07):** pyright's
  `include = ["app"]` means `backend/tests/` is deliberately NOT type-checked (warn-first baseline; revisit at
  the `strict` ratchet), and the repo-root Python (`tools/check.py`, `deploy/bootstrap.py`) is covered by
  **ruff only** (via the root `ruff.toml` that extends this config — QH-13); pyright over those stdlib scripts
  was evaluated and skipped (low value). We use **official pyright installed via the `nodejs` extra**
  (`pip install "pyright[nodejs]"`), which uses `nodejs-wheel` for a **reliable, hermetic bundled-Node install**
  (no flaky first-run download) and is version-pinnable (`==1.1.x` / `PYRIGHT_PYTHON_FORCE_VERSION`). Chosen over
  **basedpyright** after the caveat audit: the fork's advantages (Pylance-grade extras) we don't need, while its
  **stricter defaults cause false positives** (`reportAny` on unavoidable third-party `Any`) and it carries
  **fork-governance risk** (smaller maintainer pool). *(Alternatives kept documented: **basedpyright** — opt-in if
  we later want its extras; **Pyrefly** — Meta, pure-Rust, zero-Node; **ty** — Astral, still beta.)*
- **Runner = one stdlib `tools/check.py`.** Not twin `.sh`/`.ps1` scripts (duplicated growing logic → drift, a
  CLAUDE.md-forbidden anti-pattern). One Python file (stdlib `subprocess`/`pathlib` — **already a hard prereq**,
  zero new dep) resolves the venv python in a single OS-branch, runs a **data-driven check list**, runs in
  parallel (`concurrent.futures`), delegates the FE to `npm run check-all`, aggregates exit codes. Adding a
  check = one list entry. *(The originally-planned staged-file filter was dropped at 1d — see "Enforcement (1d)".)* *(Rejected: `nox`/`tox` — env-matrix overkill; `just`/
  `make` — global-dep + still needs the OS-venv indirection.)*
- **Enforcement = native `core.hooksPath`.** Not lefthook — the caveat audit found documented **lefthook Windows
  failures** ("can't find lefthook in PATH" with npm-global, Git-LFS + PowerShell edge cases), and our env is
  Windows-now → Linux(emma). Instead: git's native **`core.hooksPath = .githooks/`** (tracked hook dir, best
  practice since git 2.9) with tiny hooks that call **`python tools/check.py`** — `python` is always on PATH (the
  backend runtime), more reliable than calling `lefthook`, **zero new dependency**, and reuses the chokepoint.
  **Reliability split:** `pre-commit` → `check.py --fast` (the instant whole-tree subset — see
  "Enforcement (1d)" below); `pre-push` → full `check.py` (types + tests) — a slow pre-commit gets
  `--no-verify`-bypassed. **Caveats:** cloned repos can lose
  the hook's `chmod +x` (Linux) and hook names are exact/case-sensitive — both handled by the one-time setup
  (`git config core.hooksPath .githooks` + ensure the exec bit), run by `install.sh` / a documented one-liner.
  *(Alternative kept documented: **lefthook** — richer managed runner with parallel groups, if we outgrow native
  hooks; the Python **`pre-commit`** framework — battle-tested but clashes with `core.hooksPath`.)*
- **Both hooks are two lines — the shared launcher is `.githooks/_gate.sh`.** `pre-commit` and `pre-push` each
  `exec` it (with/without `--fast`), so the hook mechanics live in **one** file (rule 5). It does two things
  neither hook should repeat: it **resolves the interpreter** — backend venv first (`Scripts/python.exe` /
  `bin/python`), PATH `python3`/`python` only as a fallback, which also sidesteps the Windows "python from
  Microsoft Store" PATH stub that hijacks a bare `python` — and it **`unset GIT_DIR GIT_WORK_TREE
  GIT_INDEX_FILE`**. That unset is the **SYS-20 fix**: git exports `GIT_DIR` into hooks, *absolute* from a
  linked worktree, and an ambient `GIT_DIR` beats a `git -C <elsewhere>` in anything the gate runs — proven
  2026-08-11, when the v1.5.1 pre-push gate run from a release worktree committed test junk onto the release
  branch. The gate judges the **tree** and `check.py` itself runs no git, so dropping the hook's git context
  entirely is both safe and the fix.

## The runner contract

One command answers "is the repo green?" — every later hardening step ends by running it.

```
# Frontend  (frontend/package.json — COMPOSES existing scripts, does not re-inline)
npm run check-all   →  npm run typecheck  &&  eslint .  &&  stylelint "src/**/*.css"  &&  prettier --check .  &&  npm test
# (Playwright e2e is heavier → its own `npm run test:e2e`, run in the smoke slice / pre-push.)

# Whole repo  (one stdlib chokepoint — resolves the venv, runs a data-driven check list)
python tools/check.py            # full gate (pre-push): FE check-all + BE ruff, ruff format --check, pyright, pytest
python tools/check.py --fast     # instant subset the pre-commit hook calls: ruff (lint+format) + FE prettier
python tools/check.py --e2e      # full gate + Playwright e2e/a11y (the PRE-DEPLOY gate; heavy — build+preview+browser)
```

**e2e gate (Phase-9/step-5):** the Playwright smoke + axe-a11y suite (`frontend/e2e/`) is **opt-in via `--e2e`**,
NOT in the default/pre-push gate (it builds the dist + boots a browser, ~20-30s). It's the **pre-deploy gate** —
a hard step-0 item in `DEPLOY_EMMA.md` + a `.claude/settings.json` deploy-checklist hook (fires on
`bootstrap.py`/`install.sh`) — so it can't be skipped when shipping, while commits/pushes stay fast.
**One-time prereq:** the browser binaries are NOT installed by `npm install`/`npm ci` — the `@playwright/test`
npm package (already in `node_modules`) is just the runner; the browsers live **per-user** in
`~/.cache/ms-playwright` (Linux) / `%LOCALAPPDATA%\ms-playwright` (Windows) — NOT in the venv or the repo, so
one install serves the workspace and every worktree. On a fresh machine run, from `frontend/`:
`npx playwright install --with-deps chromium firefox` (**two** engines are needed: the config's projects are
Pixel 5 + Desktop Chrome, plus a **`firefox`** project — `playwright.config.ts:40` — scoped by `testMatch` to
the `kit-render` smoke so a second engine covers the per-theme boot sweep while total runtime stays bounded
(FRONTIER_PLAN F5 Gate C; the axe scans + the deep frontier locks stay Chromium-only). `--with-deps`
apt-installs the system libraries and needs sudo — without sudo run `npx playwright install chromium firefox`
and it prints the `install-deps` command to run separately). Re-run it after
any `@playwright/test` version bump (browsers are version-paired). **emma status: installed** (both engines in
`~/.cache/ms-playwright`, verified 2026-08-17) — a local install is only needed for LOCAL `--e2e` runs; the
tag-push CI release gate runs the same suite regardless, so a release never depends on it. A missing install
just means the suite fails with "Executable doesn't exist". One trap
(QH audit 2026-07-07): `reuseExistingServer: !CI` means a stale preview server already on **:4173** gets reused
(you'd test an old build — kill it first). **CI (updated 2026-07-09, D32 amendment):** branch pushes + PRs run
the gate WITHOUT `--e2e` (push gate, kept fast); **release-tag pushes (`v*`) DO run `--e2e` in CI** — the
machine-checked release gate (ci.yml installs both engines via `npx playwright install --with-deps chromium
firefox`).

`tools/check.py` resolves the backend interpreter as `backend/.venv/{Scripts,bin}/python` — a single
`os.name` branch (`Scripts`/`python.exe` on Windows, `bin`/`python` elsewhere), so it runs the same from
any cwd or interpreter. Wired into `AGENTS.md` §3.

**Enforcement (1d):** the pre-commit hook runs `--fast` — *whole-tree*, not staged. The instant checks (ruff
~0.1s, prettier ~2s) are already fast enough on the whole tree that `git diff --cached` scoping buys nothing
but adds machinery, so `--staged` was dropped in favour of `--fast` (decided at 1d's pre-flight from measured
timing; the locked "staged" intent in D33 was about *speed*, which `--fast` already meets). eslint (~11s) is
**not** in the commit gate — a slow pre-commit gets `--no-verify`-bypassed — it runs on pre-push via check-all.

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

## Deferred lint rules = the React-Compiler-readiness backlog (2026-07-02)

Two **react-hooks v7** rules are set to **`warn` (not `error`, not `off`)** in `eslint.config.js` on purpose —
`react-hooks/set-state-in-effect` and `react-hooks/refs`. This is a **deliberate deferral, not a false-positive
dodge** (an earlier read wrongly called them false positives; the React docs confirm they flag *real*
Rules-of-React patterns).

**The full warning accounting (re-measured 2026-08-26, mid-Phase-21):** the gate's `72 warnings / 0
errors` spans **four** warn-level rules, not just the two above — `react-hooks/refs` **32** +
`set-state-in-effect` **16** (the deferred pair) + `react-refresh/only-export-components` **23** (preset
default) + `react-hooks/exhaustive-deps` **1** (preset default). All four are part of the same F13
checklist; `rules-of-hooks` and `static-components` stay `error`. **The backlog keeps growing** — 27 at
the 2026-07-07 QH deep pass (`11`/`8`/`2`/`6`), 29 at the 2026-07-16 re-count (`12`/`8`/`2`/`7`), 43 at
the 2026-08-17 re-count, 49 at the 2026-08-20 one (`22`/`14`/`12`/`1`), 78 at the W9 one, **72** now.
The deferral is a *growing* debt, not a frozen one, and the growth is concentrated in the media
manager's own surfaces: `GalleryModal.tsx` alone carries **8** `refs` (its focus-trap and drag
latches), and the two modal surfaces `FramingSheet.tsx` (**7**) + `CropModal.tsx` (**4**) are most of
the `only-export-components` rise — each exports its pure helpers beside its component, deliberately,
because those helpers are unit-tested on their own.

> **Re-measurement note (2026-08-26, "W9"):** the 49 above had been stale since 2026-08-20 — the jump to
> 78 accumulated across the Phase 21 waves and **predates W9**, which was verified to add none (78
> before and after the change). Recorded so the delta is attributed rather than silently absorbed into
> whichever wave happened to re-measure. **No warning was fixed** — F13 stays trigger-gated.
>
> **And down six at "W10" (same day), all in `GalleryModal.tsx`** (14 `refs` → 8): its BODY was
> reordered — the picker input and the Add row moved below the grid — and the compiler stopped
> flagging that subtree. **Incidental, not a fix**: no warning was addressed, no rule was touched, and
> the wave's three new modules (`useImageJob`, `useMediaEdit`, `components/icons.tsx`) added none.
> Recorded on the same principle as the note above — the delta is attributed, in both directions.
>
> **And up 25 at D70 S4 Build 2 (2026-09-07)**, `72 → 97` (`refs` 48 · `set-state-in-effect` 23 ·
> `only-export-components` 25 · `exhaustive-deps` 1). It is the same two shapes the media manager's own
> surfaces carry, on the surfaces that REUSE them: `AgentArtRow.tsx` spreads the upload hook's handles
> in JSX exactly as `GalleryModal.tsx` does (its `inputRef` makes the compiler read the whole object as
> ref-ish), and the new component modules export their pure helpers beside their components because
> those helpers are unit-tested on their own (`roleplayFieldVisible`, `useAgentArtStudio`) — the same
> deliberate trade `FramingSheet`/`CropModal` made. **No warning was fixed and no rule was touched;
> F13 stays trigger-gated.** Attributed here on the standing principle rather than absorbed silently.

Deferral status unchanged: all 97 stay in the F13 backlog. **This paragraph is the ONLY home for the
count** (doc-truth ruling 2026-08-17) — other docs point here, no numbers.

**Why deferred (assessed thoroughly 2026-07-02, all ~19 sites reviewed):**
- Every current hit is an **intentional, correct, concurrent-safe** pattern: "sync an editable draft from
  *async-loaded* server data" (`set-state-in-effect`, in the Conf editors) and the ubiquitous **"latest ref"
  idiom** (`refs`, e.g. `Waveform`/`useFleet`/`AgentTab`/cosmos — a ref updated in render but read only later in
  rAF/effects, never for render output). **No correctness bug, no tearing, no user-visible flicker** — verified.
- The *only* real cost is **React Compiler** coverage: per React's docs a violating component is **skipped for
  optimization** (never broken), and the Compiler is itself deferred (**[UI_AUDIT](./UI_AUDIT.md) F13**). So
  fixing them now is **high-churn / near-zero benefit** — the payoff only lands *with* Compiler adoption,
  which also deletes our ~50 manual `useMemo`/`useCallback`/`memo` sites in the same pass.

**The mitigation that makes this safe:** keep them at **`warn`** so the warnings **ARE the checklist** — when F13
(React Compiler) is picked up, `npm run lint` lists exactly the components to fix, bundled with the manual-memo
deletion. **Never set to `off`** (that hides the backlog + any future genuine violation). Revisit at F13.

*Handled now (so the `warn` list is all "real-but-deferred", not polluted):* `react-hooks/static-components`
stays **`error`** — its one hit (`App.tsx` `<ActiveRoot/>`) is a genuine false positive (a stable registry
component, D29) and carries a scoped `eslint-disable` with rationale; the `exhaustive-deps` ref-in-cleanup in
`orbit.ts` was a real cheap fix (capture the Map ref before cleanup).

## Locked decisions (2026-07-01) — [DECISIONS D33](./DECISIONS.md#d33)

| # | Decision | Choice |
|---|---|---|
| 1 | Frontend lint depth | **type-aware** (`recommended-type-checked`) + react-hooks (`recommended-latest`) + react-refresh; `@eslint-react` = later ratchet |
| 2 | Backend type checker | **official `pyright[nodejs]`** (pinned, `basic` → ratchet `strict`); basedpyright/Pyrefly = documented alts; flaky plain-pyright install fixed by the `nodejs` extra |
| 3 | Runner | one stdlib **`tools/check.py`** chokepoint + npm `check-all` (composed); **no** `.sh`/`.ps1` twins |
| 4 | Enforcement | native **`core.hooksPath=.githooks/`** → `check.py`; **fast whole-tree pre-commit (`--fast`; staged dropped at 1d) / full pre-push**; lefthook = documented alt |
| 5 | Adoption mode | **baseline warn-first → burn down to clean before deploy**; Prettier reflow = own commit |

## References

- typescript-eslint — [Typed Linting](https://typescript-eslint.io/getting-started/typed-linting/) · [Performance](https://typescript-eslint.io/troubleshooting/typed-linting/performance/)
- react-hooks — [React docs](https://react.dev/reference/eslint-plugin-react-hooks) · [flat-config preset issue](https://github.com/facebook/react/issues/34679) · [`@eslint-react`](https://eslint-react.xyz/) (ratchet)
- pyright — [`pyright[nodejs]` on PyPI](https://pypi.org/project/pyright/) (nodejs-wheel) · [basedpyright caveats](https://pydevtools.com/handbook/reference/basedpyright/) · [Pyrefly 1.0](https://pydevtools.com/blog/pyrefly-1-0-is-the-obvious-mypy-upgrade/)
- git hooks — [`core.hooksPath` docs](https://git-scm.com/docs/githooks) · [husky vs lefthook vs lint-staged (2026)](https://www.pkgpulse.com/guides/husky-vs-lefthook-vs-lint-staged-git-hooks-nodejs-2026)
- In-repo: [`DECISIONS.md`](./DECISIONS.md) D21/D24/D33 · [`PRE_DEPLOY.md`](./PRE_DEPLOY.md) §1 · [`THEME_ENGINE.md`](./THEME_ENGINE.md) §14.13 · [`UI_AUDIT.md`](./UI_AUDIT.md) F13 · [`ARCHITECTURE.md`](./ARCHITECTURE.md) §6
