# R29 — Sanitizing the git environment when a long-running tool shells out to `git`

**Date:** 2026-08-12 · **Question:** what is the field-proven pattern for cleaning `GIT_*` out of the
environment before invoking `git` against a specific repository, and *exactly which* variables does
the field strip? · **Drives:** the SYS-20 product-half fix (`GitMemoryBackup` → `core.proc.run_capture`)
· **Status:** evidence complete; §6 is the recommendation, not a ruling.

Peers read: **git itself** · **pre-commit** · **pip** · **Cargo** (+ libgit2) · **GitPython** (negative).
Local probes on **git 2.53.0** (emma) are marked *PROBED*.

Confidence key: **VERIFIED** = read the current upstream source / ran the probe · **REPORTED** =
secondary source · **UNVERIFIED** = expected, not checked.

---

## 1. Git itself — the canonical list and the canonical helper

### 1.1 `local_repo_env` (the list)

**VERIFIED** — `environment.h` (git/git@master, read 2026-08-12):

```c
/*
 * Repository-local GIT_* environment variables; these will be cleared
 * when git spawns a sub-process that runs inside another repository.
 * The array is NULL-terminated, which makes it easy to pass in the "env"
 * parameter of a run-command invocation, or to do a simple walk.
 */
extern const char * const local_repo_env[];
```

`environment.c` defines it; `builtin/rev-parse.c` prints exactly this array for `--local-env-vars`:

```c
if (!strcmp(arg, "--local-env-vars")) {
        int i;
        for (i = 0; local_repo_env[i]; i++)
                printf("%s\n", local_repo_env[i]);
```

**VERIFIED (PROBED, git 2.53.0)** — `git rev-parse --local-env-vars`, in order:

```
GIT_ALTERNATE_OBJECT_DIRECTORIES   GIT_CONFIG        GIT_CONFIG_PARAMETERS
GIT_CONFIG_COUNT                   GIT_OBJECT_DIRECTORY   GIT_DIR
GIT_WORK_TREE                      GIT_IMPLICIT_WORK_TREE GIT_GRAFT_FILE
GIT_INDEX_FILE                     GIT_NO_REPLACE_OBJECTS GIT_REPLACE_REF_BASE
GIT_PREFIX                         GIT_SHALLOW_FILE       GIT_COMMON_DIR
```

15 variables. The list is **version-dependent** (`GIT_CONFIG_COUNT` only exists since the git 2.31
config-from-env feature; `GIT_COMMON_DIR`/`GIT_IMPLICIT_WORK_TREE` are later additions than
`GIT_DIR`) — treat any hardcoded copy as a snapshot. *(Per-version deltas not enumerated —
see §7.)*

**Not** in the list, deliberately: `GIT_NAMESPACE`, `GIT_CEILING_DIRECTORIES`,
`GIT_DISCOVERY_ACROSS_FILESYSTEM`, `GIT_EXEC_PATH`, `GIT_SSH*`, `GIT_ASKPASS`,
`GIT_TERMINAL_PROMPT`, and **all identity vars** (`GIT_AUTHOR_*` / `GIT_COMMITTER_*`). Also not in
the list: `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>` — only the `GIT_CONFIG_COUNT` that activates
them (stripping the count neutralizes the pairs). **VERIFIED** by inspection of the array.

### 1.2 `sanitize_repo_env()` — git's own "run git in another repo" helper

**VERIFIED** — `run-command.h`:

```c
/**
 * Unset all local-repo GIT_* variables in env; see local_repo_env in
 * environment.h. GIT_CONFIG_PARAMETERS and GIT_CONFIG_COUNT are preserved
 * to pass -c and --config-env options from the parent process.
 */
void sanitize_repo_env(struct strvec *env);
```

`run-command.c`:

```c
void sanitize_repo_env(struct strvec *env)
{
        const char * const *var;

        for (var = local_repo_env; *var; var++) {
                if (strcmp(*var, CONFIG_DATA_ENVIRONMENT) &&
                    strcmp(*var, CONFIG_COUNT_ENVIRONMENT))
                        strvec_push(env, *var);
        }
}

void prepare_other_repo_env(struct strvec *env, const char *new_git_dir)
{
        sanitize_repo_env(env);
        strvec_pushf(env, "%s=%s", GIT_DIR_ENVIRONMENT, new_git_dir);
}
```

So git has **two** shapes: strip-then-**set** `GIT_DIR` (submodules — `prepare_submodule_repo_env`),
and plain strip (when the child should rediscover the repo itself).

### 1.3 The headline: git adopted *strip + `-C`* in 2026, for exactly our shape

**VERIFIED** — `builtin/for-each-repo.c` (current master):

```c
static int run_command_on_repo(const char *path, const char **argv)
{
        struct child_process child = CHILD_PROCESS_INIT;
        char *abspath = interpolate_path(path, 0);

        sanitize_repo_env(&child.env);

        child.git_cmd = 1;
        strvec_pushl(&child.args, "-C", abspath, NULL);
        strvec_pushv(&child.args, argv);
```

The `sanitize_repo_env` helper was extracted for this — commit `5f031fe4` (Derrick Stolee,
2026-03-03, *"run-command: extract sanitize_repo_env helper"*), **VERIFIED** via the GitHub commit API:

> The current prepare_other_repo_env() does two distinct things:
> 1. Strip certain known environment variables that should be set by a child process based on a
>    different repository.
> 2. Set the GIT_DIR variable to avoid repository discovery.
> […] In the next change, we will see an important case where only the first item is required as
> **the GIT_DIR discovery should happen naturally from the '-C' parameter in the child process.**

And the bug it fixed (`2ef539bc`, *"for-each-repo: work correctly in a worktree"*):

> When run in a worktree, the GIT_DIR directory is set in a different way than in a typical
> repository. […] We need to be careful to **unset the local Git environment variables and let the
> child process rediscover them** […] During review of this bug fix, there were several incorrect
> patches demonstrating different bad behaviors.

That is our exact situation (repo addressed by `-C`, ambient env poisoning it), and git's answer is
the **strip list**, not a runtime query and not per-call `GIT_DIR` setting.

### 1.4 What git's docs tell hook authors

**VERIFIED (PROBED)** — `man githooks`, git 2.53.0:

> Environment variables, such as GIT_DIR, GIT_WORK_TREE, etc., are exported so that Git commands run
> by the hook can correctly locate the repository. If your hook needs to invoke Git commands in a
> foreign repository or in a different working tree of the same repository, then it should clear
> these environment variables so they do not interfere with Git operations at the foreign location.
> For example:
>
> ```
> local_desc=$(git describe)
> foreign_desc=$(unset $(git rev-parse --local-env-vars); git -C ../foreign-repo describe)
> ```

This is the origin of option (c). Note the audience: **shell** hooks, where a subshell + `unset` is
free and the git binary is already at hand.

### 1.5 PROBED: what actually leaks, git 2.53.0

Temp repos, `env | grep ^GIT` dumped from hooks (probe dirs deleted after):

| Scenario | Exported to the hook |
|---|---|
| `pre-commit` / `post-commit`, ordinary clone, run from repo root | `GIT_AUTHOR_DATE`, `GIT_AUTHOR_EMAIL`, `GIT_AUTHOR_NAME`, `GIT_EDITOR`, `GIT_EXEC_PATH`, `GIT_INDEX_FILE`, `GIT_PREFIX` — **no `GIT_DIR`** |
| same, but inside a **linked worktree** | the above **plus `GIT_DIR=…/.git/worktrees/wt`** and an absolute `GIT_INDEX_FILE` |
| any `git -c foo=bar …` invocation | adds `GIT_CONFIG_PARAMETERS='foo'='bar'` to the child/hook env |
| `git rebase --exec 'env'` | `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`, `GIT_EXEC_PATH`, `GIT_PREFIX` (no `GIT_DIR` in this simple case; Cargo's comment says it does get set — §4) |

Two consequences beyond SYS-20, both **VERIFIED (PROBED)**:

- **Identity/date hijack beats our `-c`.** `GIT_AUTHOR_NAME=EnvName GIT_AUTHOR_EMAIL=env@x
  GIT_COMMITTER_NAME=EnvC GIT_AUTHOR_DATE=2001-01-01 git -c user.name=CfgName -c user.email=cfg@x
  commit` produced `author=EnvName <env@x> date=Mon Jan 1 00:00:00 2001 committer=EnvC <envc@x>`;
  the identical command without the env produced `author=CfgName <cfg@x>`. Env **overrides** `-c
  user.*`. These vars are exported to every commit hook (row 1) and are **not** in
  `local_repo_env` — so git's own strip list does *not* protect against this.
- **Ambient config env is arbitrary code execution.** Both
  `GIT_CONFIG_PARAMETERS="'core.hooksPath'='/…/evil'"` and
  `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/…/evil` made a plain `git
  commit` run an attacker-placed `pre-commit` script (printed "EVIL HOOK RAN"). Git preserves these
  two on purpose (§1.2) because it *wants* the parent's `-c` to propagate; a **downstream** consumer
  that is not git usually wants the opposite.

---

## 2. pre-commit (Python) — prefix-strip + allowlist

**VERIFIED** — `pre_commit/git.py`, `main` @ 2026-08-12:

```python
def no_git_env(_env: Mapping[str, str] | None = None) -> dict[str, str]:
    # Too many bugs dealing with environment variables and GIT:
    # https://github.com/pre-commit/pre-commit/issues/300
    # In git 2.6.3 (maybe others), git exports GIT_WORK_TREE while running
    # pre-commit hooks
    # In git 1.9.1 (maybe others), git exports GIT_DIR and GIT_INDEX_FILE
    # while running pre-commit hooks in submodules.
    # GIT_DIR: Causes git clone to clone wrong thing
    # GIT_INDEX_FILE: Causes 'error invalid object ...' during commit
    _env = _env if _env is not None else os.environ
    return {
        k: v for k, v in _env.items()
        if not k.startswith('GIT_') or
        k.startswith(('GIT_CONFIG_KEY_', 'GIT_CONFIG_VALUE_')) or
        k in {
            'GIT_EXEC_PATH', 'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_SSL_CAINFO',
            'GIT_SSL_NO_VERIFY', 'GIT_CONFIG_COUNT',
            'GIT_HTTP_PROXY_AUTHMETHOD',
            'GIT_ALLOW_PROTOCOL',
            'GIT_ASKPASS',
        }
    }
```

Mechanism: **deny everything with the `GIT_` prefix, allowlist 9 names + 2 prefixes.** Note it
strips `GIT_CONFIG` and `GIT_CONFIG_PARAMETERS` (not allowlisted) but keeps the
`GIT_CONFIG_COUNT`/`KEY_`/`VALUE_` trio.

**The allowlist's regression history is the load-bearing finding** — **VERIFIED** via the GitHub
commits API for `pre_commit/git.py` (each entry is a separate bug report, one var at a time):

| Date | Commit | Added back |
|---|---|---|
| 2019-02-14 | `9cde2316` | `GIT_EXEC_PATH` ("respect GIT_EXEC_PATH env") |
| 2019-02-15 | `db04d612` | `GIT_SSH_COMMAND` ("pass GIT_SSH_COMMAND to git commands, refs #947") |
| 2019-12-26 | `8c93896c` | `GIT_SSL_CAINFO` |
| 2020-01-21 | `d9800ad9` | `GIT_SSL_NO_VERIFY` |
| 2021-11-22 | `4eb91cdd` | `GIT_CONFIG_KEY_*`/`VALUE_*`/`COUNT` ("support gitconfig from env") |
| 2022-03-04 | `07f44158` | `GIT_HTTP_PROXY_AUTHMETHOD` |
| 2022-10-27 | `8ebb7ae2` | `GIT_ASKPASS` |

Reading: the deny-by-prefix rule is stable and has never been reverted, but it **taxes you once per
transport/config feature you use** — and every single add-back above is a *network* concern (SSH,
TLS, proxy, credential prompt) or user config injection. A consumer that never talks to a remote
inherits none of that tail. (`GIT_EXEC_PATH` is the exception: it is about *finding git's own
sub-programs*, and it bit them first.)

---

## 3. pip (Python) — a tiny explicit deny list, declared per-VCS

**VERIFIED** — `src/pip/_internal/vcs/git.py`:

```python
unset_environ = ("GIT_DIR", "GIT_WORK_TREE")
```

…plus a positive setting for non-interactivity:

```python
if os.environ.get("PIP_NO_INPUT"):
    extra_environ = kwargs.get("extra_environ", {})
    extra_environ["GIT_TERMINAL_PROMPT"] = "0"
    extra_environ["GIT_SSH_COMMAND"] = "ssh -oBatchMode=yes"
    kwargs["extra_environ"] = extra_environ
```

The plumbing (**VERIFIED**, `vcs/versioncontrol.py` + `utils/subprocess.py`):

```python
# Iterable of environment variable names to pass to call_subprocess().
unset_environ: tuple[str, ...] = ()
```
```python
env = os.environ.copy()
if extra_environ:
    env.update(extra_environ)
for name in unset_environ:
    env.pop(name, None)
…
proc = subprocess.Popen(…, cwd=cwd, env=env, …)
```

Two structural points worth copying:

1. **The generic subprocess helper takes `unset_environ` / `extra_environ`; the *policy* (which
   names) lives on the VCS class next to the git commands.** The chokepoint is generic; the git
   knowledge is local.
2. pip addresses the repo with **`cwd=dest`, never `git -C`** — and `GIT_DIR` overrides `cwd`
   exactly as it overrides `-C`, which is why the two-name list still matters.

pip's list is *minimal* (`GIT_DIR`, `GIT_WORK_TREE`) — it does **not** strip `GIT_INDEX_FILE`,
`GIT_OBJECT_DIRECTORY`, `GIT_CONFIG_*` or the identity vars. pip only ever *clones/fetches* into a
fresh dir (it never commits), so index/identity hazards don't apply to it. **Do not read pip's list
as a general-purpose answer** — read it as "the two that break a clone".

---

## 4. Cargo (Rust) — set `GIT_DIR`, remove the neighbours; and the libgit2 sidestep

**VERIFIED** — `src/cargo/sources/git/utils.rs` (path `src/sources/git/utils.rs` in the repo layout),
the `git fetch` CLI path (`net.git-fetch-with-cli = true`):

```rust
    cmd.arg("--force") // handle force pushes
        .arg("--update-head-ok") // see discussion in #2078
        .arg(url)
        .args(refspecs)
        // If cargo is run by git (for example, the `exec` command in `git
        // rebase`), the GIT_DIR is set by git and will point to the wrong
        // location. This makes sure GIT_DIR is always the repository path.
        .env("GIT_DIR", repo.path())
        // The reset of these may not be necessary, but I'm including them
        // just to be extra paranoid and avoid any issues.
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_OBJECT_DIRECTORY")
        .env_remove("GIT_ALTERNATE_OBJECT_DIRECTORIES")
        .cwd(repo.path());
```

Mechanism: **positively set `GIT_DIR` + remove 4 neighbours** — i.e. git's own
`prepare_other_repo_env` shape, hand-rolled. The comment records the exact trigger (`git rebase
--exec cargo …`), and cargo pins the behaviour with a regression test, **VERIFIED**
(`tests/testsuite/git.rs`):

```rust
#[cargo_test(requires = "git")]
fn git_fetch_cli_env_clean() {
    // This tests that git-fetch-with-cli works when GIT_DIR environment
    // variable is set (for whatever reason).
```
…the test runs cargo with `.env("GIT_DIR", git_proj.root().join(".git"))`. **A ~6-line test that
sets the poison var and asserts the operation still hits the right repo is the field's standard
proof.**

**The libgit2 angle (answers "does a library sidestep this?"): yes — by default.** **VERIFIED**,
libgit2 `include/git2/repository.h`, `GIT_REPOSITORY_OPEN_FROM_ENV`:

> Find and open a git repository, respecting the environment variables used by the git command-line
> tools. If set, `git_repository_open_ext` will ignore the other flags and the `ceiling_dirs`
> argument, and will allow a NULL `path` to use `GIT_DIR` or search from the current directory. The
> search for a repository will respect $GIT_CEILING_DIRECTORIES and
> $GIT_DISCOVERY_ACROSS_FILESYSTEM. The opened repository will respect $GIT_INDEX_FILE,
> $GIT_NAMESPACE, $GIT_OBJECT_DIRECTORY, and $GIT_ALTERNATE_OBJECT_DIRECTORIES.

Env consultation is **opt-in behind a flag**, so cargo's default (libgit2) path is immune and only
its shell-out path needed the fix. Generalization: *the hazard is a property of the git CLI's
discovery rules, not of git repos* — anything that shells out inherits it, libraries don't.

---

## 5. GitPython (negative precedent)

**VERIFIED** — `git/cmd.py` has `_environment` / `update_environment()` / `custom_environment()`
(add-only helpers, `env.update(self._environment)` over a copy of `os.environ`) and **no
sanitizer at all** — no reference to `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` stripping. Worse,
`git/repo/base.py` *consumes* the ambient value as a default:

```python
epath = path or os.getenv("GIT_DIR")
…
if "GIT_WORK_TREE" in os.environ:
    self._working_tree_dir = os.getenv("GIT_WORK_TREE")
```

So a long-running process using GitPython inherits the hazard by design and must sanitize
`os.environ` itself before constructing `Repo`. Recorded as the anti-pattern: *a wrapper library is
not a sanitizer.*

*(REPORTED, low value: `crate-git-revision`'s docs describe the same policy — "path-redirecting
`GIT_*` environment variables … are stripped … so a CI runner that sets them for an outer repository
does not leak into the recorded revision", plus `GIT_TERMINAL_PROMPT=0`. Not source-verified.)*

---

## 6. Comparison table

Legend: **✗** stripped/removed · **✓** kept · **=** set explicitly · *blank* = not addressed.

| Variable | git `sanitize_repo_env` | git `prepare_other_repo_env` | pre-commit | pip (git) | Cargo (CLI fetch) |
|---|---|---|---|---|---|
| `GIT_DIR` | ✗ | = (new git dir) | ✗ | ✗ | = (`repo.path()`) |
| `GIT_WORK_TREE` | ✗ | ✗ | ✗ | ✗ | ✗ |
| `GIT_INDEX_FILE` | ✗ | ✗ | ✗ | | ✗ |
| `GIT_OBJECT_DIRECTORY` | ✗ | ✗ | ✗ | | ✗ |
| `GIT_ALTERNATE_OBJECT_DIRECTORIES` | ✗ | ✗ | ✗ | | ✗ |
| `GIT_COMMON_DIR` | ✗ | ✗ | ✗ | | |
| `GIT_IMPLICIT_WORK_TREE` | ✗ | ✗ | ✗ | | |
| `GIT_GRAFT_FILE`, `GIT_SHALLOW_FILE`, `GIT_REPLACE_REF_BASE`, `GIT_NO_REPLACE_OBJECTS`, `GIT_PREFIX` | ✗ | ✗ | ✗ | | |
| `GIT_CONFIG` | ✗ | ✗ | ✗ | | |
| `GIT_CONFIG_PARAMETERS` | **✓** (propagate parent `-c`) | **✓** | ✗ | | |
| `GIT_CONFIG_COUNT` | **✓** | **✓** | **✓** | | |
| `GIT_CONFIG_KEY_*` / `GIT_CONFIG_VALUE_*` | ✓ (not in list) | ✓ | **✓** | | |
| `GIT_EXEC_PATH` | ✓ | ✓ | **✓** | | |
| `GIT_SSH`, `GIT_SSH_COMMAND` | ✓ | ✓ | **✓** | (sets `GIT_SSH_COMMAND` under `PIP_NO_INPUT`) | |
| `GIT_SSL_CAINFO`, `GIT_SSL_NO_VERIFY`, `GIT_HTTP_PROXY_AUTHMETHOD`, `GIT_ALLOW_PROTOCOL`, `GIT_ASKPASS` | ✓ | ✓ | **✓** | | |
| `GIT_TERMINAL_PROMPT` | ✓ | ✓ | ✗ (prefix rule) | = `0` under `PIP_NO_INPUT` | |
| `GIT_AUTHOR_*` / `GIT_COMMITTER_*` | ✓ | ✓ | ✗ (prefix rule) | | |
| `GIT_NAMESPACE`, `GIT_CEILING_DIRECTORIES` | ✓ | ✓ | ✗ (prefix rule) | | |
| everything else `GIT_*` (e.g. `GIT_TRACE*`, `GIT_EDITOR`) | ✓ | ✓ | ✗ (prefix rule) | | |

Field consensus in one line: **everyone strips the location family (`GIT_DIR`, `GIT_WORK_TREE`,
`GIT_INDEX_FILE`, the object dirs); the only real disagreement is how much *else* goes with it, and
that follows from whether the tool needs git's network/config env.** Nobody queries
`--local-env-vars` at runtime except the shell snippet in git's own man page.

---

## 7. What I could not determine

- **Per-version deltas of `local_repo_env`.** I verified the git 2.53.0 output and current master's
  array (identical set); I did **not** bisect when each entry was added. Treat the 15-name list as
  "git ≥ 2.31-ish" and assume it grows.
- **Whether `git rebase --exec` sets `GIT_DIR`.** Cargo's comment says it does; my probe on 2.53.0
  showed only `GIT_EDITOR`/`GIT_SEQUENCE_EDITOR`/`GIT_EXEC_PATH`/`GIT_PREFIX` for a top-level
  non-worktree rebase. Both can be true (older git, worktree, or `--exec` inside a submodule) —
  unresolved, and irrelevant to the recommendation.
- **The pre-commit issue threads** (#300, #947) were not opened; the rationale above is from the
  in-source comments + commit subjects, which are unambiguous.
- **setuptools-scm / Homebrew** were not examined (raw path miss for setuptools-scm; not retried —
  the five peers already converge).
- `GIT_NAMESPACE`'s deliberate absence from `local_repo_env` has no recorded rationale I found.

---

## 8. Recommendation for ctrl-b (evidence → our case)

Our shape: **one** git caller (`GitMemoryBackup._run` → `core.proc.run_capture` →
`asyncio.create_subprocess_exec`), always `git -C <memory root>`, always **local** (no remote, no
auth, no clone), identity supplied via `-c user.name/-c user.email`, and we *commit* (so index and
identity both matter).

**Take (b): strip every `GIT_*` except a one-name allowlist (`GIT_EXEC_PATH`), applied at the
`run_capture` call in `memory_backup.py`.**

Why (b) over the others, in the order the evidence supports it:

1. **(c) `git rev-parse --local-env-vars` at startup — reject.** It is a *shell-script* idiom (git's
   own man page targets hook authors, §1.4); **zero** of the five code peers do it. For us it buys a
   subprocess + a failure mode + a cache, and it returns the wrong list anyway: `--local-env-vars`
   does **not** include `GIT_AUTHOR_*`/`GIT_COMMITTER_*`, so it would leave the verified
   identity/date-hijack (§1.5) wide open, and it *keeps* nothing we need.
2. **(a) hardcoded strip list — works, but it is a snapshot to maintain.** It is what git and cargo
   do, and it is defensible: they're compiled against git's own header (git) or paranoid about a
   known trigger (cargo). In Python we'd be copying 15 names that grow with upstream, and we'd still
   have to *add* the identity vars and the `GIT_CONFIG_*` family by hand — i.e. hand-maintaining a
   superset of a list that already exists as a rule.
3. **(b) prefix-deny + allowlist — the closest peer's answer, and its documented cost is a tail we
   don't have.** pre-commit's 7-year history (§2) shows the rule never got reverted; the price was
   6 add-backs, **all** of them SSH/TLS/proxy/askpass/config-from-env — concerns that exist only
   because pre-commit clones remote repos. `GitMemoryBackup` is local-only by design (module
   docstring: *"local-only (no network → no auth prompt)"*), so the only add-back that plausibly
   applies to us is the one pre-commit hit first: **`GIT_EXEC_PATH`** (a git installed in a
   non-standard prefix needs it to find its own sub-programs) — so allow exactly that one, up front.

(b) also covers, in the same three lines, two hazards a minimal `GIT_DIR`-only fix does not, both
**PROBED** on 2.53.0: ambient `GIT_AUTHOR_*`/`GIT_COMMITTER_*` **override** our `-c user.*` and
`--date` (silently mis-attributing memory commits), and ambient `GIT_CONFIG_PARAMETERS` /
`GIT_CONFIG_COUNT+KEY_/VALUE_` inject arbitrary config into our invocation — including
`core.hooksPath`, i.e. **arbitrary code execution in our subprocess**. That last one is why we
should **not** copy git's `sanitize_repo_env` exception or pre-commit's `GIT_CONFIG_*` allowances:
git preserves them so a parent's `-c` propagates; we want the opposite (nothing outside our argv
should shape our commits). Under a plain prefix rule they're dropped for free.

**Shape (follow pip's split, §3 point 1) — generic mechanism at the chokepoint, git policy next to
the git calls:**

- `core/proc.py`: add `env: Mapping[str, str] | None = None` to `run_capture`, pass it to
  `create_subprocess_exec` (`None` = inherit, so `shell.py` / `tailscale.py` are untouched — and
  `run_shell` *should* keep inheriting).
- `memory_backup.py`: one module-level constant + a one-expression helper (`{k: v for k, v in
  os.environ.items() if not k.startswith("GIT_") or k in _GIT_ENV_KEEP}`), used by `_run`. Comment
  it with the two facts that justify it (`GIT_DIR` beats `-C`; `GIT_AUTHOR_*` beats `-c user.*`) and
  the SYS-20 reference — a future reader must not "clean up" the allowlist or the rule.

**Test (cargo's proof shape, §4):** one test that runs a `GitMemoryBackup` commit with
`GIT_DIR`/`GIT_INDEX_FILE`/`GIT_AUTHOR_NAME` poisoned via `monkeypatch.setenv` and asserts (i) the
commit landed in the temp memory repo, (ii) the author is the configured one. That is the field's
standard regression pin and it is ~10 lines.

*Explicitly not recommended (avoid the subsystem): a config-driven allowlist, a shared
"git env" module, `GIT_TERMINAL_PROMPT=0` (we never touch a remote), or sanitizing `run_shell`.*
