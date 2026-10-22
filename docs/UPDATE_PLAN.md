# UPDATE_PLAN v3 — the update/migration architecture

> **Status: BUILT + RELEASED — every slice shipped; this doc is now the design record behind live code.**
> Slice 1 = the runner (**[§11](#11-slice-1--as-built-2026-07-26)**), slice 2 = the fold's move out of the
> config load path (**[§12](#12-slice-2--as-built-2026-07-26)**), slice 3 = env overrides
> (**[§13](#13-slice-3--as-built-2026-07-26-the-env-override-capability-retracted-the-retired-path-guarded)**
> — **§7 was overturned**: the provider-form overlay was ruled against and the capability RETRACTED),
> slice 4 = the boot refusal (**§14**, live + measured under systemd), slice 5 = `install.sh`,
> slice 6 = Windows parity, slice 7 = `update.sh` + the release runbook.
> Gate 6/6, both live configs rehearsed on copies; the chain has since been **proven over 4+ releases**
> (see the terminal-status note below).
> **Owner requirements:** after an update prod holds **zero** legacy keys · a **human with no coding
> agent** updates prod · a failed update is recoverable · **no leftover code, config or artifacts** ·
> **lean — no machinery we must maintain long-term.**
> **Evidence:** [R4](./research/R4-peer-config-migration.md) · [R5](./research/R5-migration-code-structure.md).
> **Reviews:** Fable ×3 (architecture · integration · A11 code) + Codex `gpt-5.6-sol` ×2. v1 was
> judged *"not safe to build as written"*; v2 closed the fundamentals; v3 closes the rest. Council
> record: §9. Owner rulings: §8.
> **✅ TERMINAL STATUS (noted 2026-08-12): all slices BUILT + RELEASED — first shipped in v1.3.0
> (2026-07-28); the plain-form `update.sh` proven by then with 4 clean runs (v1.4.0 · v1.4.1 ·
> v1.5.1 · v1.6.0) and by every release since, through v1.7.7 — which ran the chain's SECOND
> step for real (§12a). Living runbook: `deploy/linux/README.md` §Release; per-release records:
> [`HANDOFF_ARCHIVE.md`](./HANDOFF_ARCHIVE.md).**

---

## 1. Goals — stated honestly

| | Goal | What actually guarantees it |
|---|---|---|
| G1 | zero legacy keys after an update | the **postcondition** (§3.3): after apply, no step may still apply — over config **and** side files |
| G2 | one command, no agent | `update.sh <tag>` (§5) |
| G3 | a failed update is recoverable | **pre-cutover: prod keeps serving.** Post-cutover: prod is down until recovery, and `update.sh` says so |
| G4 | rollback detected, never silent | true into this release or later; rolling back *across* it is enforced by `update.sh`'s pre-checkout precheck, not by the old code — §6 |
| G5 | legacy knowledge in one deletable place | `app/config_migration/`; `config.py` never imports it |

**Non-goals** — no down-migration · no migration framework · no discovery/decorators · **no
post-migration repair hooks, ever** · no backup pruning · no cutover trap (§3.4 explains why it is
unnecessary rather than merely cut) · no rollback machinery (the printed restore names every file of the
run — `update.sh`'s report, §18; amended 2026-10-22 from "no multi-file rollback", owner's word).

---

## 2. Layers

```
update.sh <tag>            [NEW]  preflight + orchestration; never reimplements install.sh
  └─ install.sh [prod|dev]  [MOD]  make THIS tree live; owns the migration call sites
       └─ python -m app.config_migration --check|--apply
```

Named `config_migration` because `db.py` already owns *schema* migration; `app.migration` would read
as covering both.

---

## 3. The migration module

```
app/config_migration/
  __init__.py   runner · detect() · STEPS · CLI          (~90 lines est. → 1128 as-built)
  VERSION       a one-line literal: 1                     (see §3.6)
  steps.py      the A11 fold, lifted from config.py       (~215 lines est. → 522 as-built)
```

*(The `~lines` figures were **design-time estimates**; the as-built sizes beside them are the shipped
files — the growth is the machinery the design **specified** but did not size: the refusal preflights,
backups, the §3.3 postcondition assertion, the retired-env guard, and their docstrings, plus a
`__main__.py` shim. The layout itself is as designed.)*

Three small types, deliberately **not** a framework:

```python
@dataclass(frozen=True)
class Context:            # exists ONLY so no step ever resolves a path itself
    config_path: Path
    agents_dir: Path

@dataclass(frozen=True)
class Plan:               # ≈ what _migrate_legacy already returns, plus side files
    config: dict
    delete_list: list[str]
    agent_files: dict[Path, dict]

Step = namedtuple("Step", "version applies apply")
#   applies(ctx) -> bool          pure; sees config AND side files (Codex B1)
#   apply(ctx)   -> Plan          pure; writes nothing
STEPS = (Step(1, a11_applies, a11_apply),)
```

**Steps compute; the runner writes.** Five rules:

| Rule | Why |
|---|---|
| raw dicts only, never typed models | R5 §2 — frozen legacy models ballooned opencode's converter to 1229 lines |
| the fold stays a **pure dict transform**, persisted through the existing `sync_mapping` + delete-list machinery in `edit_config_yaml` | reuse what we own rather than near-duplicate it |
| steps are individually idempotent | R5 §10 |
| corrections ship as a **new step**, never a runtime repair | R5 §5 — open-webui's `repair_flattened_dict_configs()` runs forever |
| the runner performs all writes, in one ordered protocol | §3.4 |

### 3.1 Trigger semantics

**`applies(ctx)` is evaluated for every step, always, regardless of the file's stamp.** The version is
used only for ordering and downgrade detection.

- `needs_migration(ctx)` ⟺ any step's `applies(ctx)` is True — and `applies` inspects **config.yaml
  *and* every `agents/*/agent.yaml`**, so an agent still holding `mode:` can never be stamped
  "verified" (Codex B1).
- **Refuse** iff `needs_migration(ctx)` or `file_version > CONFIG_VERSION`.
- `needs_migration` reads the raw on-disk YAML **before env overlay** — otherwise a stale `.env`
  override re-creates a legacy key at runtime and the refusal cites something invisible in the file.

### 3.2 Stamping

`--apply` stamps `CONFIG_VERSION` on success **even when no step changed anything** — the stamp means
*"verified at level N"*, not *"changed at level N"*. This closes the unstamped-forever hole for configs
already migrated by today's lazy write-back.

Precisely (Codex B13): **only an existing, non-empty mapping is stamped, and only after config plus
side files pass the full postcondition.** An absent or empty file is never created or touched.

### 3.3 The postcondition

After apply, the runner re-reads from disk and asserts **no step applies** — over config *and* side
files. This is what actually enforces G1; failing it is a hard error.

### 3.4 The write protocol — one commit point, no rollback machinery

```
1. Parse config.yaml + EVERY agent file. Any parse failure ⇒ REFUSE, nothing written.
2. Compute the Plan. Validate EVERYTHING now — Settings.model_validate on the migrated config, and
   every rewritten agent merged against it (Codex B14). All validation happens BEFORE any write.
3. Back up config.yaml + every agent file to be touched → $CTRLB_HOME/backups/, fd-0600,
   fsync'd (§8 ruling ①).
4. Write the agent files (unique temp + os.replace each).
5. Write config.yaml LAST via edit_config_yaml, including the stamp.  ← THE COMMIT POINT
6. Re-read; assert the postcondition (§3.3).
```

**Why there is no rollback for step 4.** Agent rewrites are idempotent and config.yaml is the commit
point, so a partial rewrite leaves a state **nobody can observe**: the app cannot boot on the
still-legacy config (the check refuses), and re-running `--apply` re-derives the same plan and
converges. ⚠ Not true for derive-and-rename steps (step 5: the persona library derived from `user_name` is
lost on a re-run after a partial write) — ISS-114; until it is fixed, `update.sh`'s report says restore,
never re-run. Restore logic would guard an unreachable state — and a restore path can itself fail, which
is a worse failure than the one it prevents.

**Post-commit assertion failure** is reported as its own state: `committed, but verification failed —
restore <backup path>` (Codex B3). §3.5's "non-zero ⇒ nothing committed" is scoped to steps 1–4.

### 3.5 The CLI

| Command | Behaviour | Exit |
|---|---|---|
| `--check` | parse · plan · validate · probe writability · print the **absolute config path** and the plan | 0 ok/no-op · 1 would fail · 78 downgrade or unmigratable |
| `--apply` | the §3.4 protocol; steps 1–4 non-zero ⇒ nothing committed | 0 · non-zero |

**Output is names, never values** (Codex §C): paths, counts, legacy key names, affected agent names,
backup destinations. No diff, no values. A formatted redacted diff is unnecessary risk — the raw form
would have spilled provider keys, SSH passwords and MCP headers into scrollback.

**Errors are sanitised too** (Codex B12): a pydantic `ValidationError` renders the rejected provider
dict *including `api_key`*. The CLI never prints `ValidationError` or a raw exception — only sanitised
locations and messages.

**`--check` and `--apply` hard-fail** while the environment carries an override naming a path a
migration step **retired** (§13). Names only — the variable and the dead path — with the remedy: put
the value under the legacy key in `config.yaml` (the fold carries it into the provider it creates) and
unset the variable.

*(Rewritten in slice 3. The original wording — "add the new-form variable now; remove the legacy one
after the update completes" — described a `CTRLB_PROVIDERS__…` replacement form that slice 3 ruled
against building, and was self-contradictory even on its own terms: §7 hard-failed on the retired
variable, so keeping it through cutover was a state the runner refused. Codex found the contradiction;
the corrected remedy has no such state, because the value moves to disk rather than to another
variable.)*

**Path resolution** is explicit: `.env` → `CTRLB_CONFIG`/`CTRLB_HOME` → default, identical to
`load_settings`. The CLI **pins its `.env` discovery** rather than inheriting the caller's cwd, and
callers pass `CTRLB_HOME` explicitly.

### 3.6 The version literal

`app/config_migration/VERSION` holds the integer on one line. A test asserts it equals
`STEPS[-1].version`.

Why a file: `update.sh` must read the *target tag's* version before checkout, and
`git show <tag>:…/VERSION` is trivial while parsing a computed Python constant is not (Codex B10).
This also settles the derive-vs-declare conflict — declared for machines, asserted for humans.

### 3.7 The boot check

**At module import time in `main.py`, before `create_app()`.** Measured: `sys.exit(78)` at import
propagates as **78**; the same call inside the FastAPI lifespan is swallowed by uvicorn's
`except BaseException` and becomes **3**. The unit gains `RestartPreventExitStatus=78`.

- `config.py` never imports the migration module; `main.py` (the composition root) does. G5 holds.
- **Ordering:** `load_dotenv()` → **check (own raw parse)** → `load_settings()` → `db.connect()` →
  clients. The check must be **first**: once the fold leaves `config.py`, a legacy config *validates
  silently* into zero providers (sections are `extra="allow"`), so the app would boot "healthy" with
  chat and voice dead.
- **Test isolation** (Codex B9): `tests/conftest.py` gains **module-level** code — executed before any
  test module is imported — that **forces** a suite-private temp `CTRLB_HOME` and **neutralises
  inherited `CTRLB_CONFIG`, `CTRLB_DB` and `CTRLB_ENV`**. `setdefault` is insufficient: it preserves
  inherited values. The existing autouse fixture stays for per-test isolation.

### 3.8 `config_version` never reaches the API

`Settings` is `extra="allow"`, so the marker would ride into `model_dump` → `GET /api/settings` → and
back through a PUT, where a stale client echoing an old value would pass `prune_unchanged` and write
the stale marker down, silently weakening downgrade detection. Pop it in `load_settings` before
`model_validate`; strip it in the PUT path, reusing the existing `_pop_provider_metadata` pattern.

### 3.9 The unmigratable state — detect and refuse

`mode: local|cloud` in an agent file can only be mapped using the slot map produced while folding the
**legacy** config. If `config.yaml` is already new-shape (today's lazy write-back may have done this)
but an agent file still holds `mode:`, that map is unreconstructible and converting would invent a
dangling provider (Codex B2). Detect this exact state and **refuse** with remediation: re-save the
agent in the editor, or set `provider:` explicitly.

---

## 4. `install.sh`

```
after deps/venv:  CTRLB_HOME="$CTRLB_HOME" "$VENV/bin/python" -m app.config_migration --check || exit 1
cutover:          stop (FATAL, verify inactive) → --apply → swap dist → start → HEALTH GATE
```

`CTRLB_HOME` **must be passed explicitly** — it is an unexported shell variable (install.sh:31/35;
the only exports are `XDG_RUNTIME_DIR`/`DBUS_SESSION_BUS_ADDRESS`). Without it, `install.sh dev` would
migrate **prod's** config while the prod service was live.

Four mechanisms, each closing a named failure — and nothing else:

| Mechanism | Failure it closes |
|---|---|
| `systemctl stop` failure is **fatal**, unit verified inactive | today `\|\| true` — the migration could run while the app is still writing |
| **`/api/health` version gate** after start | `systemctl start` succeeding while lifespan actually failed |
| **`flock`**, unique temp names | two concurrent runs; a standalone `--apply` racing the service |
| check early / apply late | an early failure aborts with prod still serving |

**No cutover trap.** It could only restore `dist`; the tree is irreversibly at the new tag after
checkout, so restarting means new code against whatever config state exists — at best a restart into a
guaranteed refusal, at worst new-backend/old-frontend skew that the health gate would pass. On failure
`update.sh` prints the go-back command and states that prod is stopped.

**No keep-old-`dist` scaffolding** — it is the one piece a future release-worktree deploy (§8 ruling ②)
makes obsolete, so we do not build it to delete it.

---

## 5. `update.sh <tag>` — prod only

```
0. main() { … }; main "$@"   — bash re-reads a script mid-execution; checking out a different version
                               of update.sh while it runs could execute lines from the new file
1. refuse unless this is the prod tree; refuse if dirty        (D32)
2. take the deployment flock, export CTRLB_DEPLOY_LOCK_HELD=1  (install.sh then does NOT re-lock —
                                                                otherwise the child blocks on the parent)
3. git fetch --tags; refuse if <tag> is absent on origin
4. CI gate: refuse red/pending unless --force. [AS BUILT — superseded by §17.3: the gate FAILS CLOSED —
   `gh` missing, `gh` unable to list runs (auth/network), no push-event run matching tag + commit, or any
   conclusion but success ⇒ REFUSE (exit 1) unless --force. The design line below is history.]
   (design) `gh` missing or unreachable ⇒ warn and proceed — "cannot check" is not "knowingly deploying red"
5. TARGET-VERSION PRECHECK, before checkout:
   git show <tag>:backend/app/config_migration/VERSION   (absent ⇒ 0)
   on-disk config_version > that ⇒ REFUSE, print the §Rollback CONFIG restore sequence
   and "then re-run this same command"
6. record the current tag → git checkout <tag> → bash install.sh prod
7. verify: git describe --exact-match == <tag>; /api/health version == X.Y.Z
8. on failure: print the exact go-back command AND whether prod is currently STOPPED. No auto-revert.
```

> **As built (2026-10-22, after [ISS-90](./ISSUES.md) — the full record is §18):** step 4 fails closed (above)
> and looks the gate up per tag (`gh run list --branch <tag>`); step 5 reads the marker through the ONE reader
> (`config_shape`) and the tag's VERSION through the ONE VERSION reader (`build_version`), and its refusal
> prints the exact restore — the whole backup set of one stamp — then "re-run this same command"; step 6 (`$from`)
> is fixed BEFORE the checkout, from the git reflog on a retry, and a tree already at the tag that is serving
> it exits 0 ("nothing to update"); step 8 reports the OBSERVED unit state, never inferred from `is-active`
> (§17.3), and decides every rollback line with ONE predicate — can `$from` read the config NOW, or did this
> run back up agent files. (Until 2026-10-22 the failure branch's after-read parsed the marker without
> `marker_value`, so every stamped config read as shape 0 and the report said "the config was NOT migrated …
> the tag revert alone is sufficient" even after a run that migrated it.)

Rollback is the same command (`update.sh v1.2.1`), which is why step 5 exists.

---

## 6. The G4 honesty clause

The downgrade refusal lives in the code you roll back *to*, and v1.1.1 / v1.2.0 / v1.2.1 contain no
checker (verified). So rolling back *across* this release is enforced only by `update.sh` step 5,
running from the newer tree. This release ships the checker and the marker but does not claim enforced
rollback into older tags; the runbook keeps its manual **§Rollback → CONFIG** step for that one
boundary. From the next marker bump onward, enforcement is real in both directions.

Retirement rests on the retained runner plus a version floor — **never** on validation noticing unknown
keys, since `Settings`/`InferenceCfg`/voice/embeddings all tolerate extras.

---

## 7. Edge cases

**Config file.** absent → no-op · empty → no-op · unparseable → refuse with line/column · not a mapping
→ refuse · multi-document → parser refusal, pinned by test · duplicate keys / unknown tags → refuse ·
**partially migrated** (`providers` + `inference.local`) → migrates (⚠ behaviour change: the
`"providers" not in raw` guard goes and the existing test asserting mixed shapes are *ignored* must be
updated) · bare `providers:` → migrates · **symlink → REFUSE, and `lstat` the unresolved operator path
before `config_path().resolve()`, which erases symlink-ness** (Codex B8) · dir not writable →
temp-create probe · disk full → temp fails, original intact · 0664 → heals to 0600 · non-UTF-8 → clean
refusal · **any anchor / alias / merge key anywhere in the file + a step will run → REFUSE** (a blanket
scan; cross-tree reachability analysis is 50+ lines of ruamel node-graph code for a config that
demonstrably has none — over-refusal is acceptable and remediation is trivial) · atomic replace loses
ACLs/xattrs — documented.

**Marker.** absent → 0 · **not an int → refuse, validated with `type(v) is int` because `bool` is an
`int` in Python** · negative → 0 · `> CONFIG_VERSION` → refuse (78) naming both versions and the backup
· inserted at index 0 with a comment · never reaches the API (§3.8).

**Steps & side files.** a step raises → nothing written (validation precedes all writes) · run twice →
idempotent + postcondition · agents dir missing → no-op · **unparseable `agent.yaml` → list it and
REFUSE** (skipping would leave a `mode:` the new reader rejects) · agent write fails midway → no
restore, by design (§3.4) · stray `mode:` added later → hard `ValidationError` naming the field.

**Environment overrides. ▲ SUPERSEDED by slice 3 — see §13 for what was built and why.** This
paragraph specified a `CTRLB_PROVIDERS__<encoded-name>__<field>` overlay (scalar-field allowlist, name
normalisation, collision rejection, unknown-provider rejection) plus a **boot hard-fail** on any
retired path. Both halves were overturned by the slice-3 round table: the overlay cannot deliver its
own capability without provenance (a providers-carrying save materialises the env secret into the
YAML) and makes an env-addressed provider un-renameable; and the boot hard-fail is the wrong severity
for residue. What ships instead: the existing one-level mechanism kept, a **warning** on any
undeclared path, and a **refusal in `--check`/`--apply`** for a retired one. Evidence:
[`research/R6`](./research/R6-env-overrides-and-secret-provenance.md).

**Operator experience.** Every remediation message uses the **venv-qualified interpreter path** (plain
`python` cannot import the app) · on post-cutover failure `update.sh` states **"prod is currently
STOPPED"** · on success with a migration print `config migrated → backup: <file>` · the downgrade
refusal inlines the §Rollback → CONFIG sequence and "then re-run this same command" · **the dev
workflow is `git pull` + start the units, not `install.sh dev`**, so dev meets the boot refusal
routinely and the message is the only affordance.

**install/update.** `install.sh dev` with dev running → the flock is the only gate (no
service-active detection: it would be unreliable cross-platform machinery) · module import fails →
`|| exit 1` pointing at the venv · first install → no config, no-op · run twice → no-op · two
concurrent runs → flock · `update.sh` in the workspace → refused · tag absent / network down → refused
before checkout · already at the tag → idempotent · **Windows parity: `deploy/windows/` gets the same
`--check`/`--apply` hook** (the module is OS-agnostic; only the hook is per-platform).

---

## 8. Owner rulings (2026-07-26)

**① fsync — the backup only.** `os.fsync(fd)` on the backup file: portable (works on Windows), one
line inside a writer we are already building, no OS branch, no new abstraction. **No directory
fsync** — that is POSIX-only, needs an OS branch, and the OS-branch allowlist is closed (R25/QH9).
`edit_config_yaml` is untouched. Codex asked for both; only the portable half is taken.

**② Release-worktree deploy → ROADMAP, deferred.** Rationale recorded as **rollback speed**, not
Codex's mixed-runtime risk: today `§Rollback` needs a full rebuild (npm + pip, minutes, network);
releases-plus-symlink makes it a symlink flip in seconds, offline. Deferring costs **one line** of
rework (the keep-old-`dist` scaffolding, which §4 therefore does not build). Nothing in the migration
design changes under either layout. Codex's own risk — a lazy import of an upgraded dependency
crashing the still-running old process mid-update — is accepted and documented: its consequence is
downtime starting minutes earlier during an update already in progress, not corruption.

**③ Release precondition (unchanged):** the three pending D48 Slice-2 ratifications (voice-only verb
exclusion · `X-Voice-Served-By` = provider name · gate acquisition on finite caps) are a precondition
D48 sets for itself, outstanding since 2026-07-23.

---

## 9. Council record

**Conflicts ruled.** Boot check: Fable-1 said lifespan, Codex said a launcher, Fable-2 said import-time
→ **import-time**, settled by measurement (import ⇒ 78, lifespan ⇒ 3). Backups: Fable-1 wanted
pruning, Codex wanted none → **`backups/` dir, no pruning**. Symlinks / broken `agent.yaml` / CI gate:
my originals were **overruled by Codex** (refuse / refuse / refuse-unless-`--force`). `STEPS` list:
R5's Python pass and Codex-v2 said cut, Fable-1 and Codex-v1 said keep → **keep**, because the owner
requires a reusable mechanism, it is ~8 lines, and it mirrors `db.py::MIGRATIONS`. Version marker:
R4 §5① found markers usually decorative → **keep**, because tag rollback is a supported runbook
operation and R4's real finding (a marker only helps if code branches on it) is satisfied.

**Lean pass — mechanisms Codex asked for that were cut, not built.** The cutover trap (undefined end
states; could auto-restart into a guaranteed refusal) · multi-file restore-on-failure (guards a state
made unobservable by idempotency + the commit point) · cross-platform service-active detection (one
flock covers it and survives Windows) · the formatted redacted diff (names-not-values is leaner and
safer) · cross-tree anchor reachability analysis (blanket refusal instead) · directory fsync (OS
branch) · the release-worktree deploy (deferred). **Three of Codex's HIGH findings are answered by
deleting code rather than adding it.**

---

## 10. Slices — each audited before the next

1. **Runner + tests.** `__init__.py`, `VERSION`, the CLI, `detect()`, the write protocol, the conftest
   module-level guard. Nothing moved. Tests: `applies()`-always · side-file detection · the
   postcondition · stamp-when-unchanged · absent/empty never stamped · downgrade refusal (78) ·
   `bool`-rejecting marker validation · symlink refusal via `lstat` · anchor/alias blanket refusal ·
   **no secret in any `--check` or error output** · sanitised `ValidationError` rendering · unwritable
   dir · partial agent write converges on re-run · `VERSION` == `STEPS[-1].version`.
2. **Move the fold in.** `steps.py`; strip `config.py` + `edit_config_yaml`; the A11 tests move; the
   mixed-shape test is **updated** (behaviour change); §3.9's unmigratable-state refusal; fixtures pin
   the four item-6 defects.
3. **Env overrides.** ✅ BUILT — **§13**. Not what this line said: the provider form was ruled against
   (§13), and what shipped is the retired-path refusal in the CLI + an undeclared-path warning + the
   docs retraction.
4. **`main.py` import-time check + `RestartPreventExitStatus=78`.** ✅ BUILT — **§14**. The
   `--reload` question is **answered: it propagates 78** (measured end-to-end under systemd).
5. **`install.sh`**: ✅ BUILT — **§15**.
6. **Windows parity.** ✅ BUILT — **§16**.
7. **`update.sh`** + runbook rewrite + `config.example.yaml`. ✅ BUILT — **§17**.
8. **D48 amendment**, full gate, release.

**Verification bar per slice:** `check.py` green, plus the real-config rehearsal — prod and dev config
**copies** through the full migration, asserting zero comment loss, clean re-parse, and the
postcondition — before any release.

---

## 11. Slice 1 — AS BUILT (2026-07-26)

`app/config_migration/{__init__.py, __main__.py, VERSION}` + `tests/test_config_migration_slice1.py`
(55 tests). `STEPS` is empty and `VERSION` is **0** until slice 2 lands the fold; the §3.6 assertion
reads `CONFIG_VERSION == (STEPS[-1].version if STEPS else 0)`, and no operator ever sees 0 because
slice 8 releases at 1. Council: Codex `gpt-5.6-sol` on the design *before* the build and on the code
*after* it; Fable on design/integration. Six deltas from §3, each with its reason:

| # | As built | Why |
|---|---|---|
| 1 | **The runner writes a DIFF, not the document.** `_diff(ctx.config, plan.config)` → `deep_set` for changes + `delete_path` for removals. | Two failures, both found by Codex. A whole-document `sync_mapping` deletes every key absent from its target, so a step returning only the sections it transformed would silently delete `hosts`/credentials — and validation (sections default, extras allowed) and the postcondition (legacy keys gone) would both pass. And `edit_config_yaml` parses **YAML 1.2** while the plan is built from `safe_load`'s **1.1**, so a whole-document sync rewrites `debug: no` → `false` and `012` → `10` in lines the migration never touched. Diffing two documents parsed by the same parser cancels the dialect out. |
| 2 | `Plan.delete_list` → **`Plan.consumes`**, and it **authorises** rather than executes: every removal the diff finds must be covered by it, or the run is refused inside `validate` (so `--check` catches it, before any backup exists). | Removal now happens via the diff, so the old name lied — and the declaration turns a step bug into a refusal instead of a silent deletion. |
| 3 | Removals travel as **key-segment tuples**, not dotted strings (`consumes` accepts either). | Model and provider keys legitimately contain dots — `qwen/qwen3.5-72b` is in the live config — and a dotted path splits the name, walks into nothing, and silently leaves the key behind. |
| 4 | **`Context` carries the parsed documents** (`config`, `agents`, `digests`), not just two paths. | With paths only, every step re-reads and re-implements the refusal preflight — the very thing `Context` exists to prevent. Steps are now pure functions of parsed data. `digests` + `_assert_unchanged` refuse to write a file that changed since it was parsed (the human running `--apply` by hand has no flock). |
| 5 | **Exit taxonomy settled: 78 is the DEFAULT for `MigrationRefused`** — a config this build cannot migrate (downgrade, unparseable, anchors, symlink, broken `agent.yaml`, step bug). 1 is reserved for environmental failures a retry might clear (unwritable dir, `OSError`, file changed underneath). | Fable: slice 4 wires `RestartPreventExitStatus=78` and slices 5/7 branch on codes; reclassifying afterwards is a behavioural change across three callers. Everything in the 78 set is restart-unfixable, and the unit has no `StartLimitBurst`, so the alternative is crash-looping forever at `RestartSec=5`. |
| 6 | `is_stamped()` is key-**presence** plus equality; agent files are rewritten through `edit_config_yaml` (comments in a hand-written `agent.yaml` survive; the file lands at 0600). | "Absent" and "0" are otherwise indistinguishable and the marker would never be written. Reusing the chokepoint means no second YAML writer exists. |

**What the code review then caught** (Codex, on the built code — verdict DO-NOT-SHIP until fixed; each
now has a test):

| Sev | Defect | Fix |
|---|---|---|
| HIGH | An empty declaration (`consumes=[()]` or `[""]`) is a **prefix of every path**, so one malformed entry authorised every removal in the document — defeating the guard that exists to catch bad steps. | `as_path` refuses zero-length paths and empty segments. |
| HIGH | `_diff` compared with `!=`, and in Python `True == 1 == 1.0` and `[True] == [1]`. A step normalising a type produced **no diff**: the rest of its plan would be written, the postcondition would pass, and the stamp would go on a document the step never computed. | A type-strict `_same` comparator, recursive through lists and dicts. |
| MED | The digest check ran inside `_write_config`, i.e. **after** backups and agent writes, and its message claimed "nothing written". | All digests asserted together before the first backup; the per-file check stays for the narrower race; the false claim is gone. |
| MED | `plan.agent_files` accepted **any** path — a step could write a file that had no symlink/parse preflight, no digest and no backup, anywhere on disk. | Keys must be exact keys of `ctx.agents`. Creating new agent files is deliberately unsupported. |
| MED | `config_version:` (present, `null`) normalised to 0 and read as *verified*, so the malformed marker was never corrected. Same for a negative. | `read_marker` refuses a present non-int; `is_stamped` reads the raw value. |
| LOW | `exc.problem` is input-derived for a constructor error — `api_key: !sk-SECRET value` printed the tag verbatim, breaking the "no secret in output" claim. | Constructor errors render as category + location, like duplicate-key errors already did. |
| LOW | A **FIFO** named `config.yaml` blocks `read_bytes` forever — and slice 4 runs this at import time inside the unit, so the service would hang rather than fail. | Non-regular files refused (hard links deliberately still allowed). |

**Ruled against a reviewer:** Fable proposed `--check` exit **2** for "migration needed". Overruled — §3.5
locks `--check` 0 for ok/no-op, `install.sh` uses `--check || exit 1`, and a third code would make that
line wrong; the needed/not-needed distinction is in the printed status.

**Carried into slice 2 (Codex):** `_migrate_legacy` makes only a shallow top-level copy and then
`walk_model_refs` mutates nested refs shared with its input; `_fold_agent_yaml_modes` mutates its
argument outright. A step calling either directly would mutate its own `Context` and hide the change
from `_diff` — so slice 2 **deep-copies** the config and each agent doc before folding. The fold's
current delete-list also omits four paths the new invariant will (correctly) reject as undeclared:
`agent.defaults.model.mode`, `agent.defaults.compaction.summarizer.mode`, `agent.compaction.summarizer.mode`,
`agent.defaults.routing.lead.mode`.

**Also shipped here, out of scope but on the path:** `config.py` gained `CONFIG_VERSION_KEY` + the
`load_settings` pop and the PUT strip (§3.8 — the marker is introduced by this slice, so it must never
reach the API from this slice); `_yaml_rt`/`_delete_dotted`/`Settings._agent_from` promoted to public
(`yaml_rt`/`delete_dotted`+`delete_path`/`agent_from`) rather than reached into as privates from the
new package; `tests/conftest.py` gained the module-level guard (§3.7). One **pre-existing** pyright
error from `09ac884` (unpushed, so the full gate had never run on it) fixed in passing.

**Estimate correction:** §3's "~90 lines" for the runner is as-built ~840 including docstrings. The
extra is the refusal preflight, the diff writer and the sanitised output — not framework.

**Rehearsal (the §10 bar):** both live configs, on copies — the only diff is the added marker line;
comments, key order and 0600 intact; re-parse clean; `load_settings` still loads; re-apply a true no-op.

---

## 12. Slice 2 — AS BUILT (2026-07-26)

The fold left the config load path. `app/config_migration/steps.py` (the deletable file) + the split
test suites; **488 lines removed from `config.py`**. `VERSION` → 1, `STEPS = (A11,)` *(the state at
this slice; the chain has grown since — see §12a)*.

**Gone from `config.py`:** `_migrate_legacy` and its five helpers · `_fold_agent_yaml_modes` ·
`_SLOT_MAP` · `PendingMigration`/`_PENDING_MIGRATION` · `_materialize_migration` · the `.bak-a11-*`
backup block and delete-list loop inside `edit_config_yaml` · the double fold and FX-B warning inside
`load_settings` (now four lines) · the per-load agent fold in `_load_agent_folder` · `_MIGRATION_LOG` ·
`delete_dotted` (superseded by `delete_path`) · `_env_override_paths` (dead once FX-B went).
**Kept:** `walk_model_refs`, reimplemented over a new exported `MODEL_REF_HOMES` constant so the step
can walk the same closed list *with paths* — it must name the exact `…mode` keys it removes.

**Deliberate behaviour changes.** The `"providers" not in raw` chat guard is gone (item-6 defect: a
`providers: {}`, or a bare `providers:` parsing to `None`, blocked the chat fold **forever**, silently)
· `agent.yaml` `mode:` → `provider:` is a persisted rewrite, not a per-load in-memory fold · a stale
`mode:` in a config ref and in an agent file now behave identically (item-6 defect: the first was a
hard boot `ValidationError`, the second degraded silently) · the migration reads **disk truth only**,
so the runtime/disk double fold and its FX-B warning disappear.

**Council: three rounds, and each one found something real.**

| Sev | Found by | Defect | Fix |
|---|---|---|---|
| HIGH | Codex | `_chat_is_legacy` being true does **not** prove the named slot is reconstructible. `inference: {fallbacks: []}` is legacy-shaped, yields an EMPTY slot map, and an agent on `mode: local` became `provider: local` — syntactically valid, so validation AND the postcondition passed. The mirror image was also wrong: `mode: null`/`3`/`openrouter` were refused beside a migrated `inference`. | Stop using a proxy. Fold first, then refuse only `local`/`cloud` values **absent from the actual slot map**. The ModelRef rewrite became unconditional, and the fold's early return now also considers a stray `mode:`. |
| HIGH | Codex | A config that is merely **broken** rather than legacy (`inference: nonsense`) is invisible to every step, so it passed `--check`, was stamped "verified", and would fail at the next `Settings.model_validate`. During an update: preflight says go, service stopped, restart fails on a file we just certified. | `validate(ctx, plan \| None)` validates `plan.config` **or** `ctx.config`; `check()` and `apply()` both call it. Fable's framing: the runner issues the stamp, and a certifier must not certify what it has not checked. |
| HIGH | Codex (round 3) | A non-mapping `providers:` crashed the fold with an `AttributeError` that escaped `MigrationRefused` — so the runner's validation never ran — and a falsey one was coerced to `{}` and written over the operator's data. | The step refuses a `providers:` that is present, non-null and not a mapping. It cannot be hoisted into the runner's validation: a *legacy* config legitimately fails `Settings.model_validate` (`ModelRef` forbids `mode:`), which is why the fold ran before validation in the first place. |
| MED | Fable | `inference: {default_mode: local}` alone did not trigger `applies`, so the runner would stamp a config that still held a legacy key — invisible to the postcondition, because **the postcondition *is* `applies`**. | `default_mode` added to the chat trigger. The fold also stopped introducing an empty `providers:` key into a file that never had one. |
| MED | Codex (round 3) | The now-unconditional rewrite let a ref carrying **both** `provider:` and `mode:` have the legacy field silently win. | Pop `mode`, declare it, then keep the existing `provider` — D48 new-wins, at ref granularity, on both sides. |
| MED | me (self-audit) | The §3.9 refusal keyed on *any* legacy subtree, but only the **chat** fold produces a slot map — a legacy-voice config with migrated chat would map a stranded `mode:` to a provider named `local`. | Superseded by Codex's HIGH above (the slot-map test is strictly more precise). |
| LOW | Fable | `api_key: ""` and an absent key were different identities, splitting one endpoint into two byte-identical providers. | `or None` at both the endpoint fold and the existing-provider identity seed (round 3 caught the second half). |
| LOW | Codex | My new parametrised test had an early return that made four rows assert nothing; several ported tests still claimed identity after the fold became pure. | Explicit `expect_applies` per row; tests and docstring reworded to semantic equality. |
| MED | Fable (round 3) | `_refuse_unmappable` lacked the new-wins exemption the rewrite had just gained, so a both-shapes ref beside a migrated `inference` was refused — with a remedy telling the operator to "set `provider:` explicitly" on a ref where it already was. | The same exemption in the refusal. |
| — | **both, converging** | Codex: `base_url: 7` raises `TypeError` inside `_canonical_base_url_key`, a malformed port raises `ValueError` **whose message quotes the value**, a list `api_key` makes the identity tuple unhashable — all escaping `MigrationRefused`. Fable named the class: *the fold trusts input shape at exactly the nodes it reads, and every round found an unanticipated shape at one node.* | **The structural fix, in the runner, not the step:** `_call_step` wraps both halves of every step so any non-`MigrationRefused` exception becomes a sanitised refusal naming only the exception TYPE (the messages quote config values). Node-by-node guards would have grown the legacy-schema machinery R5 warned about. Closed empirically too, by an 11-case malformed-config corpus test asserting **refused or converged, never raised**. |

**Tests:** `test_config_migration_steps_a11.py` (55) — the ported fold assertions plus the trigger fix,
the slot-map refusal lattice, purity, an end-to-end run through the runner against a real workspace, and
a fixture pinning the env-only-secret hole for slice 3 to close. `test_config_yaml_writer.py` keeps what
stayed in `config.py`. `test_hosts_crud_write_triggers_migration_writeback_exactly_once` was **deleted**:
it pinned machinery, not a property, and the property survives in the runner's tests.

**Rehearsal:** both live configs, on copies, four times across the fix waves. Strict resolve passes,
five providers, all API keys carried, chat/stt/tts/embeddings resolve, marker at 1, re-run a no-op.

**Carried into later slices.** ① Provider names come out as `127.0.0.1-9000`, `192.168.1.137-9000`,
`192.168.1.137-7851`; per the owner's ruling (`<host>-<service>`, **no derivation logic**) he renames
them in Conf after migrating — verified in source that `runtime._cascade_provider_renames` rewrites the
flat section pointers (`inference`/`voice.stt`/`voice.tts`/`embeddings`, primary + fallbacks) as well as
the ModelRef homes, so the renames will not strand `voice.stt.provider`. ② Three operator comments sat
on consumed keys and die with them (the owner's symmetric ruling) — including one whose endpoint MOVED
rather than died; **slice 7's runbook gets a line**: skim the backup against the new file and re-add any
comment worth keeping, and never restore an agent file from a pre-migration backup without re-saving it.
③ The env-only-secret hole is pinned by a test asserting today's behaviour; slice 3 closes it.

### 12a. The step chain TODAY (transcribed from code, 2026-09-17)

The machinery above has not changed; the chain it carries has grown, and a reader of §11/§12
should not take their slice-time numbers as the live ones. **Read the code, not this list, when it
matters** — `backend/app/config_migration/`:

| `version` | Step | What it folds | Shipped in |
|---|---|---|---|
| 1 | `A11` (`retires=A11_RETIRED_ENV_PATHS`) | the provider-registry fold (D48) | v1.3.0 |
| 2 | `MEDIA_V2` | `media.<ns>` → `media.namespaces.<ns>` + `roles.<role>.order` → `files` (D65; MEDIA_MANAGER_PLAN §2.2) | v1.7.7 |
| 3 | `PRESENCE_DEVICES` (`retires=(("wake","presence_device_ips"),)`) | `wake.presence_device_ips` → `wake.presence_devices` (D69) | v1.7.8 |
| 4 | `LIVE_VOICE_D76` | `voice.live`: `route` speaker→call · speaker-hifi/headphones→media; `echo_workaround` → `mic_hold`; `vad_threshold` 0.9→0.6, else clamped to 0.5–0.8; `silence_ms` clamped to 500–1200; `barge_threshold` dropped (consumed — the relative dB gate replaces it) (D76; LIVE_VOICE_PLAN §7 the D76 block §E) | v1.7.8 |
| 5 | `PERSONAS_D78` (`retires=(("roleplay","persona"),)`) | `roleplay.persona` → a `roleplay.personas` entry + `default_persona`; `user_name` → `persona` (a library slug) in place in `agent.defaults` + every `agents/*/agent.yaml` — exact-name reuse, else minted by `card_import.mint_slug`; a blank stays blank (D78; ROLEPLAY_PLAN §14.1 A5 + §14.4 A-1/A-2) | v1.7.8 |

The number lives in the file `app/config_migration/VERSION` (**5** today), read by `update.sh`
before checkout and exposed to code as `CONFIG_VERSION`; `STEPS` is assembled in
`__init__.py::_load_steps()`, and a test asserts `CONFIG_VERSION == STEPS[-1].version`.
**Consequence for the runbook:** rolling back *across* either cutover is a CONFIG rollback first
(§Rollback → CONFIG), which is why the v1.7.7 and v1.7.8 releases both carry that note (v1.7.8 moved
prod 2 → 5 on 2026-09-26: only step 3 applied to prod's file; steps 4/5 were no-ops there).

---

## 13. Slice 3 — AS BUILT (2026-07-26): the env-override capability RETRACTED, the retired path guarded

**The slice was specified as an implementation and shipped as a retraction.** §7 asked for a
`CTRLB_PROVIDERS__<encoded-name>__<field>` overlay so provider keys could live in `.env`. A field pass
([R6](./research/R6-env-overrides-and-secret-provenance.md), 11 projects) plus a Codex + Fable round
table killed it, and the owner ruled: **Design C — retract the promise, guard the retired path.**

### Why the overlay died (each finding independently sufficient)

| Sev | Found by | Finding |
|---|---|---|
| HIGH | Codex | **It cannot deliver its own capability without provenance.** The PUT baseline is env-overlaid (`runtime.py:460-481`), so a providers-carrying save writes the env secret into `config.yaml` — for all six allowlisted fields, not just `api_key`. LiteLLM hit this exact bug and names the second-order harm: the materialised copy then *shadows the env source on every restart*. |
| HIGH | Codex | **An env-addressed provider cannot be renamed or deleted.** Rename in Conf → the old variable targets an unknown provider (boot fails); adding the new variable first also fails, since the new name isn't in the YAML yet. No valid two-phase state. Fixing it needs aliases — "which largely turns A into B". |
| HIGH | Fable | **Wrong shape regardless:** a permanent public env grammar (normalisation, collisions, allowlist, the `dash` portability caveat) in *permanent* code, serving a capability with **zero users** — no `.env` exists on either box. |
| — | R6 | Six of eight peers have **no** env→named-entry addressing; the field uses file-side references instead. The only two that do (Gitea, Grafana) needed a hex escape / shipped lossy with no collision handling, and **every** implementation examined creates unknown entries silently. |

**The file-side reference (Design B) was also declined — but only on cost, and its shape is now ruled.**
Codex confirmed `ProviderCfg.api_key` has exactly two consumers (`provider_registry.py:252-269`,
`272-337`), but B additionally needs centralized resolution, provider invalidation on a missing
variable, `_target_identity` comparing resolved credentials — and a fix to `Settings.secret_values()`,
which feeds shell-output redaction: a model holding `env:KEY` stops redacting the *real* key from tool
output. **Fable's ruling, recorded for the seam: never a magic string.** An explicit `api_key_env:`
sibling field says a different thing (where to find it vs what it is), needs **zero** changes to the
secret machinery (it isn't in `_SECRET_LEAF_KEYS`), and costs one line in the drift-guard allowlist
(`tests/test_secret_hygiene.py:142`). Recorded as [ROADMAP I2](./ROADMAP.md#i2).

### Two defects the round table found in THIS document

1. **`embeddings.model` and `inference.fallbacks` are NOT retired** (Codex, HIGH). Building `retires`
   from what the fold *consumes* was wrong: both are consumed **and still declared** by the new schema
   — same spelling, new meaning. Listing them would refuse a valid `CTRLB_EMBEDDINGS__MODEL`. The rule
   is now pinned mechanically against the live models
   (`test_no_retired_path_names_a_live_field`), so the next step cannot repeat it.
2. **§3.5's cutover contract contradicted §7** (Codex, HIGH): "add the new-form variable, keep the old
   until cutover" against "any retired variable hard-fails" — there was no successful state. Rewritten
   above; the value now moves to **disk**, not to another variable.

### The severity ruling — refuse in the CLI, warn at boot

Fable and Codex split on this (Fable: warn; Codex: keep exit 78). **Ruled with Fable, on a reason
neither gave:** the 78 taxonomy is defined over *the config file* ("a config this build cannot
migrate"), and stretching it to cover the operator's environment weakens a contract slices 4–7 branch
on. Codex's worry is answered by an asymmetry that also settles the split: **the CLI and the service
see different environments** — the CLI sees the shell + `.env`, the service additionally sees the
systemd user manager's `Environment=` — so neither check subsumes the other. Therefore: **refuse
(78) in `--check`/`--apply`**, the attended gate where prod still serves and the fix is cheap;
**log at boot** (slice 4), because an old `.env` line must not take down the only UI there is to fix it
with. `_refuse_retired_env` is deliberately **not** in `detect()`, which slice 4's boot path calls.

### Overruled: the four phantom variables

Both reviewers wanted `CTRLB_INFERENCE__CLOUD_KEY` / `CTRLB_STT__KEY` / `CTRLB_TTS__KEY` /
`CTRLB_EMBEDDINGS__KEY` (shipped in `.env.example`, naming fields that **never existed**) added to
`retires`. Overruled in favour of Fable's other proposal — a **generic warning** whenever an override
addresses a path `Settings` does not declare. It closes the whole class including future typos, lives
with the live mechanism rather than with legacy knowledge, and keeps `retires` honestly meaning "paths
the A11 fold killed", which must die with the step.

### As built

- **`config.env_override_vars()`** — the ONE parser for the grammar, returning `(var, section, key)`
  and **never values**. `_apply_env_overrides` applies what it returns; the migration matches against
  it, so a retired-path check cannot drift from the overlay it guards (it catches
  `CTRLB_Embeddings__Api_Key`, which the overlay lower-cases and applies). *(`_env_override_paths` was
  deleted as dead in slice 2 and returns here with a real consumer.)*
- **`config._env_path_is_declared()`** + the warning — derived from `Settings.model_fields`, so it
  stays true as sections gain fields. Behaviour of the overlay itself is **unchanged**.
- **`Step.retires`** (4th field, default `()`) + `steps.py::A11_RETIRED_ENV_PATHS` — six paths:
  `inference.{default_mode,local,cloud}` + `embeddings.{base_url,api_key,dim}`. Two membership rules,
  both tested: only what the one-level grammar can address (the voice slots sit two levels down and
  were never reachable), and only what the new schema no longer declares.
- **`retired_env_overrides()`** (pure, shared) + `_refuse_retired_env()` in `check`/`apply` only.
- **Docs retracted**: `README.md` §Configuration · `DESIGN.md` §9 · `.env.example` · `SECURITY_MODEL.md`
  §Storage · `config.py`'s module docstring. The `.env.example` entry names the four phantom variables
  explicitly and says they never worked, so an operator who copied them can find out why.
- **Tests**: `tests/test_config_env_overrides.py` (15) — **the overlay's first-ever coverage**, the
  warning by name-not-value, the refusal + exit 78 + nothing written, case-insensitive matching, the
  live-path regression, `detect()` staying quiet, and the two invariants. The slice-2 pin
  (`test_an_env_only_legacy_secret_is_not_carried_across`) is flipped: it now asserts the refusal and
  then walks the operator's remedy through to a migrated config carrying the key.
- Backend suite **1013** (was 998). `tests/conftest.py` also drops inherited `CTRLB_*__*` variables —
  without it, a developer with one exported fails tests that have nothing to do with it.

### 13.1 Fix-set verification (Codex, on the built code) + the ruling on its HIGH

All four original findings verified **CLOSED**. Five new; three taken, one taken in lean form, one
ruled against:

| Sev | Finding | Disposition |
|---|---|---|
| LOW | `_refuse_retired_env` ran **before** `detect()`, so a config from a newer build got A11 remediation instead of the downgrade refusal | **TAKEN** — `detect()` first in both `check()` and `apply()` |
| LOW | `_apply_env_overrides` collected names then re-read `os.environ[name]` — a torn read of process-global mutable state (`KeyError`, or applying a value we never decided to apply) | **TAKEN** — one `dict(os.environ)` snapshot, parsed and read from |
| MED | the two invariants prove **soundness, not completeness** — both pass for an empty `retires` list | **TAKEN, and strengthened**: completeness is now *derived* — `{consumed paths that are 2 segments and no longer declared} == A11_RETIRED_ENV_PATHS`. It earned itself immediately, failing on its own first run because the fixture omitted `inference.cloud`, so the fold never consumed it |
| LOW | the conftest guard was not actually pinned (the test passes without it in a clean shell); no boot-warning test | **TAKEN in lean form** — the rule is extracted as `inherited_override_names()` and tested directly, since the stripping runs before any test exists. The boot-warning half belongs to **slice 4**, where the caller will exist |
| HIGH | warning-only at boot can still strand a credential | **diagnosis accepted, prescription declined — ruled below** |

**The HIGH, and why the fix goes to `install.sh` rather than to boot.** The scenario is real: a
credential in the unit's `Environment=` is invisible to the CLI (which sees the shell + `.env`), so the
migration passes, and the service then treats it as a dead path — the provider comes up unauthenticated
with only a journal line. That is the asymmetry used to justify the split in the first place, turned
around.

Codex's fix is to make it a blocking boot error. **Declined**, for the reason the split exists: an
unauthenticated provider **fails visibly at call time** — a 401 surfaced in the chat bubble or the
voice control — while a refusing unit takes down the only UI there is to diagnose it from, on a
headless box. Trading a visible per-role failure for a total outage is the wrong direction.

**Taken instead, and better placed: `install.sh` (slice 5) scans the rendered unit's `Environment=`
lines for `CTRLB_*__*` and fails the gate.** The unit file is the one place a service-only override can
come from, `install.sh` is the code that renders it, and this closes the exact blind spot at the
**attended** gate — where prod is still serving and the remedy is one edit — rather than at the
unattended boot. Recorded as a slice-5 requirement in §10.

**Standing note for slice 4:** Codex and Fable have now split twice on this same axis (fail-closed vs
fail-visible for environment residue). The ruling is fail-visible, with the attended gates carrying the
refusals. Slice 4 logs at **ERROR** level, naming the variable and the role it no longer feeds.

### 13.2 Code review of the implemented slice (both reviewers, 2026-07-27)

Owner-requested review of the code rather than the design. **Fable: SHIP AS BUILT** — the code matches
the ruling rather than the prose flattering it, the dependency direction is right (permanent `config.py`
owns the parser; the deletable package borrows it), and **nothing is orphaned** when `steps.py` is
deleted: `Step.retires`/`retired_env_overrides`/`_refuse_retired_env` stay as generic mechanism, the six
paths die with the step. It verified the five retracted documents are mutually consistent and that no
live text anywhere still promises env-supplied secrets. **Codex: DO NOT SHIP**, with a HIGH that was
real. Both reviewers' findings are fixed in the wave recorded below.

| Sev | Found by | Defect | Fix |
|---|---|---|---|
| HIGH | Codex | **A rejected value reaches the journal.** `str(ValidationError)` renders `input_value=…` for every failing field; `load_settings` let it escape uncaught to `main.py`, so `CTRLB_PROVIDERS__X__API_KEY=<secret>` (warned about, still applied, then invalid) put that secret in a systemd traceback. Reproduced. | `load_settings` raises `ConfigValidationError` carrying the **sanitised** rendering. The sanitiser was already written — in the migration package, for this exact reason — so it moved to `config.py` and the package imports it: one implementation, correct layer. |
| — | me (fixing it) | `raise … from None` suppresses the *display* of the chained exception but the object still reaches the `ValidationError` through `__context__` — one attribute away from any logger. Caught by writing the test strictly. | The message is built inside the handler and **raised outside it**, so no active exception exists to chain and the reference is gone. |
| MED | Codex | **A malformed `retires` declaration silently disables the guard.** A future step writing `("embeddings.api_key",)`, three segments, or upper case can never match a parsed `(section, key)` — which reads exactly like "no retired variable is set". | `_retired_path` refuses it as a step bug. Same class, and the same answer, as slice 1's empty `consumes` entry (§11). |
| LOW | Codex | **The ordering fix over-corrected.** Putting `detect()` first gave *every* step failure precedence, so `providers: nonsense` + a retired variable meant fixing the config, re-running, and only then learning about the variable. | Three-step precedence: **marker/downgrade → environment → plan**. That is what the intent was; `detect()`-first was a blunt version of it. |
| LOW | Codex | Undeclared variable **names** were logged unescaped — `env(1)`/`execve` accept a newline in a name, forging a journal line at an attacker-chosen severity. | `_loggable()` escapes them. My first fix escaped only the name; a test caught that `section`/`key` are slices of that same text and were still raw. |
| MED | Fable | **The slice-5 fix as specified misses systemd drop-ins** — `systemctl --user edit` writes `<unit>.d/override.conf`, precisely where an operator adds a variable without touching the rendered file. | §10 slice 5 now says `systemctl --user show <unit> -p Environment` (the merged view). Corrected before slice 5 is briefed against the weaker wording. |
| LOW | Fable | `retired_env_overrides`'s docstring claimed the gate "has already forced the value onto disk" — untrue for exactly the blind spot §13.1 documents. | Tempered to "any value the CLI could see", and it now names the drop-in case. |
| LOW | Fable | The remedy's two-sided sentence is noise on an already-stamped config. | Chosen by `is_stamped` — a dict lookup, so the refusal still precedes planning. |
| LOW | Fable | `A11_RETIRED_ENV_PATHS`'s comment cited only the soundness test. | Names both, and says why it takes both. |
| — | Codex | `dict(os.environ)` is not atomic — a concurrent mutator can still raise `KeyError`; proposed a module-level lock around all environment mutation. | **DECLINED.** Nothing in this app mutates `os.environ` after `load_dotenv()` at startup, and the snapshot already strictly narrows the window the previous code had. A lock over process-global state to guard a mutator that does not exist is machinery we would maintain forever. Recorded, not built. |

**Tests added with the wave** (24 in the module now): the canary test for the boot path — asserting on
`__cause__` **and** `__context__`, which is what caught the reference-still-reachable bug — a hostile
variable name that tries to forge a log line, malformed `retires` declarations, the remedy differing on
each side of the migration, and a refusal test that replaces **every** writing primitive with a bomb so
"nothing was written" is pinned rather than inferred from a missing backups directory.

**Round 2 of the code review (both reviewers, on the fix wave).** **Fable: CONFIRMED** — all four of
its items applied as asked; the slice-5 rider is "strong enough to brief against"; and it ratified the
sanitiser's new home on ownership grounds rather than just direction: sanitising a `ValidationError` so
`input_value=` cannot reach a journal **is secret-hygiene machinery**, and `config.py` already owns that
family (`mask_secrets`, `secret_values`, `_SECRET_LEAF_KEYS`). Its one LOW — the forwarding shim left in
the migration package was dead code — is **taken** (both sites call the shared function; the shim is
gone). **Codex: HIGH re-raised, and split on inspection.**

| Claim | Verdict |
|---|---|
| The original HIGH (a rejected VALUE in the message) | **CLOSED**, and now pinned as a *property* across three error shapes rather than one canary: pydantic leaks the value in `str(exc)`, the sanitised rendering never does. |
| `loc` can still contain a **KEY** — e.g. a provider named `sk-…` | **DECLINED, on evidence.** A key is not a secret in this system: `mask_secrets` masks *values* under secret-named keys and passes every key through, provider names ride `GET /api/settings` unmasked, and they are advertised to the model as `/<provider>` composer verbs — a name is public identity everywhere. Our own validators interpolate provider names deliberately. Suppressing dynamic locations would reduce the message to "something in `providers` is wrong" while protecting nothing that is not already on the chat surface. Recorded in the function's docstring so the next reader does not re-open it. |
| The raising frame retains `raw` (the whole config); a locals-aware formatter would expose it | **TAKEN** — `del raw` before the raise. Verified first that this is *not* a live leak (nothing in the app logs `exc_info=True`, no locals-rendering formatter is installed), so it is defence in depth against a future logging change, and it costs one line. |
| The bomb test should pin the *intended* refusal | **TAKEN** — `match="retired"`. |

**Backend 1026, gate 6/6.** Slice 3 is closed from both lenses.

---

## 14. Slice 4 — AS BUILT (2026-07-27): the boot refusal

`main.py` gained `_preflight_config()`, called at **module scope immediately before `create_app()`**;
both systemd units gained `RestartPreventExitStatus=78`. Backend **1033**, gate 6/6.

**The plan's open question is answered for the case it asked about — and a SECOND case, which it did
not ask about, turns out to be the one that bites.** §10 flagged the `--reload` path as unverified ("a
reload worker exits through uvicorn's `ChangeReload` parent, not systemd"). Measured on emma,
2026-07-27, **uvicorn 0.48.0** (reloader semantics are version-specific — re-verify on a bump):

| Measurement | Result |
|---|---|
| `sys.exit(78)` at import, plain uvicorn | exit **78** |
| same, `uvicorn --reload` | exit **78** — the reloader parent propagates it |
| unit with `RestartPreventExitStatus=78` | `failed`, **`NRestarts=0`**, `ExecMainStatus=78` |
| the same unit **without** the directive | **5 restarts in 8 seconds** — the crash-loop the memory predicted (`Restart=on-failure`, `RestartSec=5`, no `StartLimitBurst`) |
| **end-to-end: the real app, `--reload`, a legacy config, under systemd** | `failed`, `NRestarts=0`, `status=78/CONFIG`, and the journal carries the venv-qualified `python -m app.config_migration --apply` |

**⚠ The mid-session reload path is a ZOMBIE, and it was found by review, not by me** (Fable: *"the
`ChangeReload` parent is a file-watcher loop, not a supervisor"*). My first draft of this section
claimed the `--reload` question was settled outright; it was settled only for **start-time** import.
The routine dev path is different — units already **running**, then a `git pull` brings code that
refuses the current config — and measuring it (start healthy → make a step apply → touch a `.py`)
gives:

| | |
|---|---|
| unit | `active (running)`, `NRestarts=0`, `ExecMainStatus=0` |
| the port | **DEAD** (`curl` → no response) |
| the journal | the refusal message, printed once |

So `systemctl status` reports health while the app is gone. **Dev-only** (prod runs without `--reload`,
where the measured terminal-78 behaviour holds), and **not fixed in code**: uvicorn's reloader offers no
"exit on worker failure" option, and the honest fix is the workflow — **restart the dev unit after a
pull that changes config shape**, which the on-demand start/stop-around-iteration habit already mostly
enforces. Noted in the dev unit's own header, where someone iterating will actually meet it.

Both probes ran under **scratch units against a temp `$CTRLB_HOME`**, never the real dev or prod units,
and were removed afterwards.

**What it does, in order:** `load_dotenv()` → `detect(context_from_env())` — the cheap read-only verdict
(§3.7), no writes, no writability probe → **log** any retired env override (§13.1: refusals live at the
attended gates) → exit **78** if any step applies, printing the legacy key names and the exact
venv-qualified command. `MigrationRefused` (downgrade, unparseable, symlink, anchors, broken
`agent.yaml`) reports through the CLI's own reporter and carries its own exit code; `OSError` exits 1.

**Decisions taken here:**
- **No skip flag.** An escape hatch for a boot-blocking safety check is precisely the kind of
  environment variable that silently does something — the class slice 3 spent itself removing. The
  remedy is always the one command the message prints, run by the interpreter that printed it.
- **`_report` → `report_refusal`, public.** The preflight reports the same refusals the CLI does; two
  spellings of "how a refusal reaches the operator" would drift on the first message change.
- The check runs on **every import of `app.main`**, tests included — which is what `conftest.py`'s
  module-level guard was built for in slice 1 (§3.7), and why it had to exist before this slice.

**Also fixed here:** `main.py`'s lifespan comment still described `config._PENDING_MIGRATION` — the lazy
write-back deleted in slice 2. (`runtime.py` carries the same stale reference; corrected with it.)

**Tests** (`tests/test_main_preflight.py`, 7): the wiring asserted by source order (the check must
precede `create_app()`) · legacy → 78 + the venv command + the legacy key names · downgrade routed
through the shared reporter · a migrated config boots silently · an absent config is a no-op and creates
nothing · **a retired override LOGS and does not exit**, naming the variable but never its value, and
pointing at `systemctl --user show <unit> -p Environment` where a service-only variable hides · both
units carry the directive, because the code half is useless without it.

### 14.1 Code review of slice 4 (both reviewers) — two HIGHs, both real

**Fable (systems lens): SHIP WITH CHANGES** — code as built; its finding was the `--reload` overclaim
above, plus the two slice-5 riders and the slice-6 brief now in §10. **Codex (defect lens): DO NOT
SHIP**, two HIGHs, **both reproduced before fixing**.

| Sev | Defect | Fix |
|---|---|---|
| HIGH | **A YAML *constructor* failure escapes as a bare `ValueError` whose message quotes the input.** `api_key: 2026-01-99` → *"day 99 must be in range 1..31 for month 1 in year 2026"* (verified, **both** parsers); a 4300+ digit integer trips Python's int-conversion limit the same way. `ValueError` is not a YAML error class, so `_parse`'s handler never saw it — the traceback carried a config value into the journal **and** exited 1, i.e. crash-looped. **Provenance (Fable): this predates slice 4.** `_parse`'s narrow `except (yaml.YAMLError, RuamelYAMLError)` shipped in **slice 1**, so the same unsanitised escape was reachable through the CLI's own stderr — the exact channel §3.5 advertises as *names, never values* — for two days (verified against `4761483`). Slice 4's in-unit parse exposed it at boot; it did not introduce it. | `_parse` catches `(ValueError, OverflowError)` and refuses with the category only. The remedy tells the operator to quote the value. |
| HIGH | **Migrating is not loading.** `detect()` reads the marker and asks each step whether it applies; it never validates. A stamped `server: {port: not-a-number}` — or a live `CTRLB_SERVER__PORT=not-a-number` that only the *service's* environment carries — sailed through the preflight and died in the lifespan, which uvicorn renders as **exit 3**. `RestartPreventExitStatus=78` does not cover 3, so the unit crash-looped (measured: exit 3 confirmed). | The preflight now calls **`load_settings()`** after the migration verdict. Not a re-implementation of validation — the real loader, so the check has the effective semantics including the env overlay. `ConfigValidationError` (slice 3) already renders locations without values. |
| MED | A `MigrationRefused` from `retired_env_overrides()` was raised **outside** the try, so a malformed future `retires` declaration — classified 78, terminal — escaped as exit 1 and would retry forever. | One boundary: everything from `load_dotenv()` to `load_settings()` is inside it. |
| MED | The boundary started too late in another way: the migration package is imported at module scope, and `CONFIG_VERSION` is read **from a file** at import, so a corrupt `VERSION` is a raw traceback and exit 1 before any handler exists. Bootstrap variables raise types nobody anticipated (`CTRLB_HOME=~nosuchuser` → `RuntimeError`). | The package import moved **inside** the function with its own "this build is damaged" message, and the boundary gained a catch-all that names the exception **type** only and exits 78 — the same structural answer as the runner's `_call_step` (§12), applied one layer up. |
| MED | **The import-wiring test was theatre**: a source-substring assertion passes with the call under `if False:`. | Asserted over the **AST** (a top-level call, before the top-level `app` binding) **plus** a subprocess test that genuinely `import app.main` against a legacy config and asserts process exit 78 and sanitised stderr. |
| LOW | `status.config_path`, `OSError.filename` and `sys.executable` reach stderr unescaped — a path can carry a newline and forge a journal line. | Routed through `config.loggable()`, promoted to public for its second consumer. |

**Found while fixing, worth keeping:** the first version of the step-bug test patched `cm.STEPS` — which
does nothing, because `retired_env_overrides(steps=STEPS)` binds `STEPS` as a **default argument** at
import. The test passed while exercising nothing. It now injects at the call and pins the *boundary*,
which is the actual property.

**Re-verified after the wave:** copies of both live configs — prod (still legacy) refuses with 78 and
names the command; dev (migrated) reaches "Application startup complete". Backend **1038**, gate 6/6.

**Round 2 on the fix wave (both reviewers).** **Codex: 6 of 7 CLOSED**, one LOW only partly — I had
escaped `status.config_path` but not the origin flowing into `ConfigValidationError`, so a
newline-bearing `CTRLB_CONFIG` could still forge a journal line (fixed: `loggable` there too). It also
named three tests that asserted less than they claimed, all now stronger: the subprocess test's fixture
**carries a credential** so "sanitised stderr" is asserted rather than claimed; the step-bug test proves
the refusal went through `report_refusal`, not merely that the code was 78; and the warn-once test
proves a **second, different** variable still warns. Confirmed clean: loading twice adds only idempotent
work, the catch-all does not swallow `KeyboardInterrupt`/`SystemExit`, and the local import costs
nothing after the first.

**Fable: SHIP WITH CHANGES**, and its Q4 finding is the one that mattered — recorded in the row above.
It ruled on the three shape questions: **keep the double load** (the preflight is a pure *gate* that
owns no product state; stashing `Settings` would make import-time global state authoritative and hide
the irreducible TOCTOU rather than fix it — the lifespan's read visibly winning is the honest
semantics, and this is the same verification-by-re-derivation the deploy chain already uses); the
**warn-once set stays in `config.py`** (it is observability state, the idiom Python's own `warnings`
module uses, and `_LOG` is process-global in the same file); and the preflight is **not accreting** —
its real responsibility is *"turn every config-shaped failure into a classified exit code with a
sanitised message before systemd is told the service is viable"*, observed at three stages. Its
requested stop-line is now in the docstring: **this gate decides, and never constructs or repairs.**
Its LOW is fixed too — the warn-once registry is reset by an **autouse fixture**, because one test
resetting it meant any *other* test that warned poisoned later assertions.

---

## 15. Slice 5 — AS BUILT (2026-07-27): `install.sh`

The four §4 mechanisms plus the two riders the slice-4 review added. Nothing else — `install.sh` gained
no new responsibilities, only the gates that make its existing ones honest.

| Mechanism | Where | The failure it closes |
|---|---|---|
| **`flock`** on `$CTRLB_HOME/.deploy.lock`, taken before any work; skipped when `CTRLB_DEPLOY_LOCK_HELD=1` | step 0.5 | two installs racing; slice 7's `update.sh` holds the same lock and passes the flag so the child does not block on its parent |
| **`migration --check`** early, `\|\| exit 1` | step 4.4 | a config this build cannot migrate or load aborts the run **before the build**, with the old instance still serving |
| **merged-environment scan** — `systemctl --user show <unit> -p Environment` | step 5.2 | a `CTRLB_*__*` override living only in the unit or a **drop-in**, invisible to the CLI. Asked of the *manager*, never of the rendered file (Fable) |
| **stop is FATAL and verified by STATE** (`is-active` poll, ≤10s) | step 5.5 | today's `\|\| true`: the migration could rewrite `config.yaml` under a process still writing it |
| **`migration --apply` at the cutover** | step 5.5 | the migration runs at the one moment nothing is writing the file |
| **health gate** — poll `/api/health`, then compare its version to `git describe --exact-match` | step 6 | `systemctl start` succeeding while the app is dead; and a stale venv serving code that is **not** what was deployed |
| **`ExecMainStatus=78` branch** in the gate's failure path | step 6 | a config refusal reported as a generic timeout. On 78 it prints the journal tail, which already carries the fix command |

**`CTRLB_HOME` is passed explicitly** at both call sites through one `migration()` helper: it is an
ordinary (unexported) shell variable here, so a bare `python -m app.config_migration` would resolve to
the **repo root** — and from `install.sh dev` would inspect PROD's config while the prod service was live.

**A claim that was false until the review (Fable, MED).** §15, the script's own comment and my report to
the owner all said the check ran *before the frontend build*. It did not — it sat after it, so an
unmigratable config would have aborted only after minutes of `npm ci` + the prod build. Fixed **by
moving the steps, not the prose**: config-presence and the preflight are now 2.5/2.6, above the
frontend step. Prod kept serving either way, so this was time and honesty rather than safety — but
three documents asserting an ordering the script did not have is exactly the drift this plan polices.

**Three calls, and one correction that testing forced:**
- **`--apply` runs in BOTH roles**, not just prod — the correction. `--check` exits **0** for "needed"
  as well as "not needed" (§3.5 locks that so `|| exit 1` means *would fail*), so the first draft, which
  applied at the prod cutover only, would have let `install.sh dev` report success and leave a config
  the dev units then refuse to boot on. Dev has no cutover (its units are on-demand), so it applies
  right after the check. A running dev unit is not a hazard the flock covers, and §7 already accepts
  that: the process re-reads config only on a PUT or a restart, and a PUT mid-apply trips the runner's
  digest guard, which refuses rather than clobbers.
- **The lock is per-instance**, keyed on `$CTRLB_HOME` — each role has its own, and the hazard worth
  excluding is two runs against the *same* instance.
- **The health gate fails on a version mismatch**, not just a dead port: the version comes from the tag
  at `pip install` time, so serving a different one means the venv was not rebuilt and the running code
  is not what was just deployed. Only asserted when the tree is at an exact tag, so a dev tree is unaffected.

**Verified, against real inputs rather than by inspection:** port extraction from the **real rendered
prod unit** (5433) · version extraction from the **live prod `/api/health`** (1.2.1) · the env scan
against a real unit **plus a real drop-in**, which it catches while correctly ignoring `CTRLB_HOME`
(one underscore) and printing **names only** · the lock excluding a second run and passing through for
`CTRLB_DEPLOY_LOCK_HELD=1` · the `migration()` call shape end-to-end on a copy of the prod config
(legacy → applied → stamped → `uvicorn` reaches "startup complete", zero errors) · `bash -n`.

**~~NOT verified~~ ✅ CLOSED by the v1.3.0 release (2026-07-28):** `install.sh prod` ran end-to-end in
the live cutover (clean, health ok/1.3.0, pid == MainPID). Original caveat kept for the record:
`install.sh` had **never been run end-to-end** by the authoring session. `install.sh prod` is a release action, not a slice-5 action. `install.sh
dev` would be safe in principle, but it runs `systemctl --user enable --now ctrl-b-agent@{fable,opus}` —
and this session *is* one of those agent instances, so a restart would kill the run that is testing it.
It should be exercised from a plain SSH shell (or by the owner) before slice 8's release: `bash
deploy/linux/install.sh dev` on the workspace, expecting a no-op migration on the already-stamped dev
config and no unit churn — then confirm the agent sessions' PIDs are unchanged. `shellcheck` is not
installed on the box; only `bash -n` was run.

*(Correction, Fable: the stated **reason** was wrong even though the conclusion holds. `systemctl
enable --now` on an already-**active** unit does not restart it — `start` on a running service is a
no-op — and the legacy tmux-kill block matches only the old parenthesised session names, not
`ctrl-b-opus`. So the run would very likely be harmless; not testing that theory with the session's own
lifeline is still the right call. Two warnings for whoever does run it: do **not** improvise a "scratch"
run via `REPO=`/`CTRLB_HOME=` overrides — the unit **names** are fixed, so it would overwrite the real
user units with scratch paths; and `install.sh prod` genuinely cannot be rehearsed before the release,
since the current prod tree has no migration module at all.)*

### 15.1 Code review of slice 5 (both reviewers) — three fail-open gates

**Fable (chain lens): SHIP WITH CHANGES** — the ordering error and the release-blocking runbook finding,
both above. **Codex (shell lens): DO NOT SHIP** — *"the stop gate, environment scan, and health identity
gate all fail open in realistic production conditions."* All three reproduced or confirmed on the box
before fixing.

| Sev | Defect | Fix |
|---|---|---|
| HIGH | **The stop was still not fatal.** `stop … \|\| true` swallowed a failed stop; a failed state *query* (user bus gone) produced an empty string that read as "not active" and proceeded; and `deactivating` — **the exact race this gate exists to close** — is not the literal string `active`. `$(seq 20)` failing would also have run zero iterations without tripping `set -e`. | Stop failure is fatal (with the never-installed first-install case distinguished by `is-active`, which prints `inactive` even for an unknown unit); only an **explicit terminal state** (`inactive`/`failed`) satisfies the poll; an empty query answer is fatal, never a licence to write; arithmetic loop. |
| HIGH | **The environment scan could both miss and invent.** `systemctl show --value` prints each entry **shell-quoted** and joins them with spaces, so `tr ' ' '\n'` destroys the boundaries. Demonstrated on this box with `"OTHER=x CTRLB_FAKE__TOKEN=y"` + `"CTRLB_REAL__KEY=a b"`: the old parse reported the **FAKE** (a false positive out of another variable's value) and **MISSED the real one**. `show \|\| true` also turned a bus failure into a clean scan. | `xargs -n1`, which honours the same quoting systemd emits (verified: the new parse returns `CTRLB_REAL__KEY` and only that). A failed `show` is fatal. `--output=json` is **not** supported for `show` on systemd 259, so structured parsing was not available. `EnvironmentFile=` remains out of scope — systemd never exposes its contents as a property — and that is now stated in the code. |
| HIGH | **The health gate could approve the wrong process.** Any non-empty 2xx body ended the poll, and nothing checked that the responder *was this unit* — a stale or hand-started process on the port satisfied the gate while the new unit failed to bind. | Require `"status":"ok"` in the body, then assert `ActiveState=active` **and a non-zero `MainPID`** before accepting. Verified against the live prod unit (`active`, MainPID 1161). |
| MED | The `CTRLB_DEPLOY_LOCK_HELD=1` bypass disabled locking on an accidental export, proving nothing about an inherited descriptor. | The bypass now carries **the lock path** and is honoured only when it equals this instance's. `flock`'s availability is checked *before* acquisition, so a missing `flock` reports "install util-linux" rather than "another install is running". |
| MED | Post-stop failures left several distinct outage states, unnamed. | `dist.next` is validated **before** the snapshot and the stop (a missing build must not cause an outage), and every post-stop step names the state it leaves prod in. |
| MED | The "30-second" gate could take ~120s (3s curl + 1s sleep, 30×). | A wall-clock deadline. The 78 branch also queries `ActiveState` before claiming the unit is stopped, and the `journalctl \| sed` pipeline is best-effort so `pipefail` cannot suppress the rollback hint. |
| MED | **Dev could migrate underneath its own running backend** — the digest guard catches competing *writes*, not an old process with old in-memory settings writing afterwards. | `install.sh dev` refuses while `ctrl-b-dashboard-dev` is active, naming the stop command. §7 declined general service-active detection as unreliable machinery, but the prod stop gate already depends on `is-active` on this same box, so this is consistent rather than new. |

**The principle that keeps future gate additions honest** (Fable, second round): **pre-cutover gates are
free aborts — post-cutover gates are refusals to lie.** Everything before the stop (lock · preflight ·
env scan · `dist.next` · snapshot integrity) aborts with the old service still serving, so those stops
cost nothing and more of them is strictly better. Everything after it cannot meaningfully "warn":
proceeding past a failed stop or apply corrupts, and by the health gate the outage already exists — the
abort is only refusing to report success while naming the state left behind. The one legitimate degrade,
untagged prod skipping version identity, already says so out loud.

**The dev guard NARROWS §7 rather than breaching it** (ruled, second round). §7 declined *cross-platform*
service-active detection as unreliable machinery; `install.sh` is Linux-only, already wall-to-wall
`systemctl`, and its prod path already bets correctness on `is-active`. The hole it closes is the worst
class this plan has: the digest guard protects the apply against a competing write, but an old dev
process that outlives the migration holds **old-shape settings in memory**, and its next Conf PUT dumps
them back — resurrecting legacy keys into a stamped config, precisely what the postcondition exists to
prevent. It refuses rather than stopping the unit itself (never kill a dev session silently), and the
residual — a hand-started `uvicorn` outside systemd — stays with the digest guard as its only net.

**Confirmed clean by the review:** the deliberately unquoted `printf '    %s\n' $bad` (its contents are
`[A-Za-z0-9_]` names, so nothing can word-split or glob) · fd 9 is retained by the parent and inherited
correctly by the `migration()` and `npm` subshells · `migration()` propagates a failing `cd` or Python
through `||` · `bash -n` passes.

**Round 2 on the fix wave (Codex).** 3 of 7 closed outright (stop gate · lock bypass · deadline and 78
diagnostics — `SECONDS` confirmed safe under `set -u`, the arithmetic loop exempt from `set -e`); four
were **not fully** closed, and it was right each time:

| Sev | Still open after the first wave | Fix |
|---|---|---|
| **HIGH (residual)** | **`ActiveState=active` + non-zero `MainPID` does not prove that PID served the response.** With `Type=simple` + `Restart=on-failure`, the new process can be briefly `active` before failing its bind while a **stale hand-started process answers the curl** — a state this session created repeatedly by running `uvicorn` by hand. | `/api/health` now reports **`pid`**, and the gate requires it to equal systemd's `MainPID`. The equality holds only for a single-process, non-`--reload` unit — under `--reload` the reloader *parent* is MainPID while a *worker* serves — which is stated in the code and is one more reason the gate is prod-only. A build predating the field says so instead of implying identity was proven. |
| MED | The env parser **failed open**: `xargs 2>/dev/null … \|\| true` turned a parse failure into a clean scan — the same class as the query failure fixed in round 1. | The whole assignment is now `if ! bad="$(…)"; then exit 1; fi`. An unparsed scan is not a clean scan. |
| MED | The body predicate `*'"status"'*'"ok"'*` also accepts `{"status":"degraded","db":"ok"}`. | Parsed with the venv python (guaranteed present by step 2) — `status`, `version` and `pid` in one call, replacing three fragile shell parses. |
| MED | **The dev guard failed open** exactly as the stop gate had: an empty query answer or `activating`/`deactivating` read as "not active" and permitted the migration. | Only `inactive`/`failed` licenses it; empty is fatal; anything transitional names itself. |
| MED | `enable --now` failure and a partial `rm -rf` did not name the outage they leave. | Both do now. |

*(The `pid` field is not a secret: `/api/health` already reports version and schema_version, and it is
tailnet-only.)*

---

## 16. Slice 6 — AS BUILT (2026-07-27): Windows parity

Three edits, exactly the brief the slice-4 review settled.

**⚠ Correction to the brief itself (Fable, verified in the repo).** I recorded "no
`RestartPreventExitStatus` analogue is needed: nothing on Windows restarts it." **That is false** —
`deploy/windows/autostart-enable.ps1` registers a Scheduled Task at logon with `-RestartCount 3
-RestartInterval (New-TimeSpan -Minutes 1)` and `-WindowStyle Hidden`. So Windows *does* have a
restarter, and the autostart path is the **worst** case for this slice: with no console the **pause**
has nothing to hold open, Task Scheduler will *attempt* up to three restarts of a guaranteed exit-78,
and the operator simply finds the dashboard absent — the silent failure this whole plan exists to kill.
*(Precisely, per Codex: the exit-code propagation is not useless there — it is what marks the run failed,
activating `RestartOnFailure` and recording the task result. Only the pause is inert. And `RestartCount
3` specifies three **attempts**, not three observed retries.)*

**Task Scheduler exposes no native `RestartPreventExitStatus` equivalent** — its restart policy is
unconditional on failure. A wrapper could special-case 78 and write an event, but that is new
unverifiable machinery on a path nobody runs; the honest ceiling here is **documentation**, and
`deploy/windows/README.md` now carries the recovery line ("if the dashboard vanishes after an update,
run `start.cmd` manually — the console will show the fix"). The console path keeps the full benefit of
the two exit-code edits.

| File | Change | Why |
|---|---|---|
| `start.ps1` | `exit $LASTEXITCODE` after uvicorn | A **normally completed** script discarded uvicorn's native exit code and returned 0, so `start.cmd`'s existing `if errorlevel 1 pause` never fired for the case that matters — the app's import-time config refusal (exit 78, §14) printed its fix instruction into a console window that then vanished. *(Corrected from "previously always returned 0": the port guard's own `exit 1`, and any unhandled `throw` under `-File`, already returned 1 — Codex.)* |
| `start.cmd` | `setlocal` + clear `ERRORLEVEL`, capture `RC`, `endlocal & exit /b %RC%` | Two distinct hazards. **Shadowing:** cmd resolves a *real environment variable* named `ERRORLEVEL` in preference to its own internal one, so a caller exporting `ERRORLEVEL=0` would make every failure read as success (documented behaviour — Codex). **Ordering:** later commands are not required to preserve the error level, so it is captured immediately. *(The earlier claim that `pause` specifically overwrites it with 0 is not documented by Microsoft and has been withdrawn.)* |
| `setup.ps1` | a named **mutex** around the whole setup | Windows had **no mutual exclusion at all** where Linux has `flock`: two double-clicks of `setup.cmd` could both pass `--check` and the port guard and then both enter `--apply`, and the runner's digest check narrows that race without closing it. A mutex leaves no file behind, and Windows releases it on process death — an abandoned one is handed to the next waiter, which is an acquisition rather than a failure. |
| `setup.ps1` | `--check` → port guard → `--apply`, **before the frontend build** | The Windows half of §4. Placed before the build for the same reason as `install.sh` step 2.6 (the slice-5 ordering lesson): the build is the slowest thing there. `$ErrorActionPreference = "Stop"` does **not** trip on a native non-zero exit in PowerShell 5.1, so every code is checked explicitly. |

**The port guard is the Windows dev guard.** With no service manager, "is it running?" is "is :5433
held?" — probed with the same `Get-NetTCPConnection` idiom `start.ps1` already uses, rather than a new
mechanism. It closes the same hole as `install.sh`'s dev refusal: migrating under a live instance lets
that process write its **old in-memory settings** back afterwards, resurrecting legacy keys into a
stamped config.

**One cross-platform truth the review surfaced:** `0o600` is a **POSIX** guarantee. On Windows the mode
argument to `os.open` is largely a no-op and the config and its backups inherit NTFS ACLs instead — so
every "lands at 0600" comment in the migration package should be read as POSIX-only. The primitives
themselves are fine there (`os.replace`, `os.lstat` on reparse points, `os.fsync` → `_commit()`), and
`home_path()` correctly falls back to the repo root.

**⚠ UNVERIFIED, and unverifiable from here.** There is no Windows machine in this deployment — the
corsair checkout is a **frozen plain clone** (D32; reference only, and corsair is now just a managed
fleet host) — and `pwsh` is not installed on emma, so not even a parse check was possible. These three
edits are small, idiomatic and follow patterns already in the same files, but **they have not been
executed**. Anyone reviving the Windows path should run `setup.cmd` then `start.cmd` against a legacy
config and confirm: the console stays open, the message names
`python -m app.config_migration --apply`, and `echo %ERRORLEVEL%` prints 78. **Then check the autostart
path specifically**: enable the Scheduled Task, leave a config the build refuses, and observe what the
task does with exit 78 — how many retries actually run, and whether the refusal lands anywhere an
operator would ever see.

---

## 17. Slice 7 — AS BUILT (2026-07-27): `update.sh` + the runbook

**`deploy/linux/update.sh` is orchestration only.** Everything that makes an update safe — the config
preflight, the migration, the verified stop, the dist swap, the health/identity gate — lives in
`install.sh` (§15) and is deliberately not repeated. `update.sh` adds exactly what `install.sh` cannot
know: which tag, whether CI is green on it, whether rolling back would strand a config, and what to tell
the operator when something fails.

- **`main() { … }; main "$@"`** — bash reads a script incrementally, and step 6 checks out a different
  version of *this very file*; without the wrapper the shell could resume inside the new one.
- **Refusals before anything moves:** not the prod tree (resolved with `pwd -P`, so a symlink cannot
  smuggle the workspace past it) · a dirty tree · a tag absent from origin · CI not green (`--force`
  overrides). *(This bullet first said "`gh` missing or no run found → warn and proceed"; §17.3's HIGH
  "Provenance and CI failed open" reversed that before release — **as built the gate fails closed** on a
  missing or unauthenticated `gh`, no matching run, or any non-success conclusion, `update.sh` step 4.)*
- **The lock is taken here and handed down**: `CTRLB_DEPLOY_LOCK_HELD="$lock"`, with `$lock` computed
  from the **identical `$CTRLB_HOME` default chain** `install.sh` uses — the path-equality bypass
  (§15.1) only matches if both spell it the same way, and a mismatch would deadlock the child on its
  parent (Fable's rider).
- **The downgrade precheck (G4), before the checkout.** The refusal that matters would have to live in
  the code you roll back *to*, and every tag before this release has no checker at all — so it happens
  here, from the newer tree, while it still exists: `git show <tag>:…/VERSION` (absent ⇒ 0) against the
  `config_version:` on disk. **Verified against the real artifacts**: `v1.2.1` has no VERSION file → 0,
  the migrated dev config reads 1, so that rollback refuses with exit 78 — while a legacy (unstamped)
  config correctly proceeds, since it strands nothing.
- **The failure message names the state, not a category:** it queries `is-active` to say whether prod is
  *running* (pre-cutover failure — the old version is still serving) or *STOPPED*, prints the exact
  go-back command, and — because it snapshots `backups/` before the run — if the config was migrated it
  names **the exact backup file** to restore rather than describing one. *(Superseded, verified 2026-10-14: §17.3
  replaced the `is-active` inference with the observed state and the backup check with a before/after marker
  compare; the report then printed a generic `ls -t` listing, not one named file, and the marker compare's
  after-read was broken — [ISS-90](./ISSUES.md). Since 2026-10-22 the report names the whole backup set of one
  stamp, decided by one predicate — §18.)* No automatic revert: rolling
  back is a decision, and doing it silently would hide which of those two states you are in.

**The runbook rewrite — the release-blocking half.** `deploy/linux/README.md` §Rollback → CONFIG
described the lazy write-back **deleted in slice 2**, telling the operator to restore a
`config.yaml.bak-a11-*` that will never exist (verified: zero references remain). It now describes the
truth — `install.sh` migrates at the cutover with the service stopped, writing
`~/.ctrl-b/backups/config.yaml.<UTCstamp>` first — and states plainly that across this release a CONFIG
restore is **MANDATORY, not conditional**: the older build has no preflight and its sections tolerate
unknown keys, so a migrated config makes it boot **"healthy" with zero providers**. §Release now leads
with `update.sh` and keeps the manual sequence as the fallback it orchestrates.

**Also found and fixed here:** `config.example.yaml` still carried the **retracted env-secret promise**
("to keep a specific key out of here, override it from `.env`") — a sixth document slice 3 missed. It
gains `config_version: 1`, and the example config now reports *"migration: not needed"* against the
real CLI.

**~~NOT verified~~ ✅ CLOSED by the v1.3.0 release (2026-07-28):** the **bootstrap-form** `update.sh`
ran to completion in the live cutover (first real run — clean, exit 0; the A11 fold ran on prod 0→1
with config backup + DB snapshot; the three provider renames applied after). The v1.3.1 release will
exercise the **shipped-script** (non-bootstrap) form for the first time. Original caveat kept for the
record: refusal paths and parsers were exercised pre-release; the success path first ran at v1.3.0.

### 17.1 Pre-release audit of slice 7 (Fable) — the recovery text was the defect

**SHIP WITH CHANGES**, and the first finding is the sharpest of the plan so far: **`update.sh`'s own
failure message produced the wrong action.**

| Sev | Finding | Fix |
|---|---|---|
| MED-HIGH | The failure path printed **"go back: `checkout && install.sh prod`" first**, and the ⚠ "your config was migrated, restore it first" block *after*. A cold operator executes top to bottom — so they run the tag revert alone, and the OLD `install.sh` (no preflight, no health gate) reports success over a config it cannot read: **booting "healthy" with zero providers.** The exact silent failure this whole plan exists to kill, delivered by our own recovery text. | When a backup was created, **one numbered four-step sequence** — stop → `cp -p <exact file>` → checkout → install — and the bare go-back line is **not printed at all**. It appears only when no migration happened, where it is sufficient and says so. |
| MED | The CI gate treated **"no run found" as "cannot check, proceed"**. With `gh` working, that almost always means the tag was pushed seconds ago and Actions has not registered the release gate yet — i.e. **pending**, which §Release explicitly forbids re-pinning on, and which is precisely the owner's tag-then-update flow. | "No run found" now **refuses**, printing the `gh run watch` line to wait with. Warn-and-proceed is reserved for `gh` being **absent**, which is what the original argument actually covered. |

**Checked, and NOT a defect** (Codex had also asked): the `new_backup` detection uses
`grep -vxF "$backups_before"`, and I suspected an empty "before" list would invert to match everything
and silently report *no* migration — the very state the fix above exists to warn about. Tested: `-x`
anchors the match to the whole line, so an empty pattern matches only empty lines and real filenames
survive; a multi-line "before" is handled correctly too, since `-F` treats each line as its own pattern.
Correct as written.

**Ruled sound:** the layering (`update.sh` adds only what `install.sh` cannot know and reimplements
none of it), the `main()` self-checkout wrapper, the lock-path hand-off, and — explicitly — the
downgrade precheck's raw `sed` parse of `config_version`, which is *justified* duplication because at
that moment the tree is still the old tag and may not contain the runner at all.

### 17.2 Preconditions for slice 8, in order (Fable)

0. ✅ **DONE 2026-07-27** — `config.yaml.manual-prerelease-<stamp>` (chmod 600: `cp -p` had inherited
   prod's **0664**, which the migration heals at the cutover) + a `.backup`-API DB snapshot,
   integrity-checked, both in `~/.ctrl-b/backups/`. **A manual belt, outside the tooling** — `cp -p ~/.ctrl-b/config.yaml ~/.ctrl-b/backups/config.yaml.manual-prerelease`
   plus a manual DB snapshot, so recovery does not depend on the tooling's own backups working on their
   **first ever run**.
1. ✅ **DONE 2026-07-27 — the §15 gap is CLOSED.** `install.sh dev` ran to completion, launched
   **detached via `setsid`** so the script (and its log) would survive the case both reviewers warned
   about. Result: **tmux session identities unchanged** — the agent units were not restarted, as Fable
   predicted — dev's config **byte-identical, 0600, no new backup** (a true no-op apply), on-demand
   units still not boot-enabled, agents still enabled, and prod untouched throughout. That run
   exercised the lock, the config preflight, the new dev active-guard, the apply path, unit render +
   `daemon-reload`, the env scan and the on-demand disable — the whole shared spine. What remains
   unexercised is only the **prod-only cutover block**, which the release itself is the first run of.
   *(Original wording: run it from a plain SSH shell, not an agent session.)* Expect a no-op migration on the already-stamped dev config, no unit churn, and unchanged
   agent PIDs. This exercises the lock, the preflight, the apply path, render + `daemon-reload` and the
   env scan — most of the shared spine — leaving only the prod-only cutover block unexercised.
2. ✅ **DONE** — the two §17.1 fixes are in `update.sh` (the four-step restore sequence; "no run found"
   refuses and prints the `gh run watch` line), and the slice-6 §16 corrections are all in the tree
   (`start.ps1` `exit $LASTEXITCODE` · `start.cmd` `setlocal`/`RC`/`endlocal & exit /b` · the `setup.ps1`
   mutex + the `--check`→guard→`--apply` block before the build · the Windows README recovery line).
3. ✅ **DONE 2026-07-27** — **the three D48 Slice-2 ratifications** ("all good"), ③ conditional on the
   bounded-wait fix below.
4. ✅ **DONE 2026-07-27** — the A11 pre-release fix list, in two commits. `8841386`: the MUST-FIX
   (`looks_masked()`; a mask with nothing to restore is dropped, not written as the credential).
   `4a056aa`: the MED (`EndpointGates.hold(target, wait_s=…)` — voice bounded by `connect_timeout_s`,
   embeddings by `timeout_s`, a timeout is a failed hop, chat deliberately unbounded), the LOW
   (`providers_rev` hashes the MASKED subtree — it is published beside the masks, so a raw digest was an
   offline verification oracle), and the test gaps. **Two gaps were recorded by name** (mask-as-new-key ·
   `chain_for(mode=None, model=X)`); the audit's other three were not, so the rest were reconstructed by
   pinning the untested A11 paths — the masked-rev properties, the bounded wait failing over, and the
   shared-gate claim re-pinned where voice/embeddings now acquire. The two items the list flagged as
   **release notes rather than code** stand: the migration no longer fires unattended (the updater runs
   it), and an `agent.yaml` `mode:` pinned to `cloud` is rewritten once by the slice-2 fold.
5. ✅ **DONE 2026-07-27** — the **D48 amendment** (a pre-release block on the decision: the shape-only
   mask predicate · the masked fingerprint · the bounded C4 acquire · interpretation ① corrected to the
   five-subtree strict trigger set) + doc sync (`DESIGN.md` gate paragraph · `SECURITY_MODEL.md` display
   + a new fingerprint rule).
6. ✅ **DONE 2026-07-27** — full gate **7/7 including e2e** on the release sha, plus the §10 real-config
   rehearsal on THREE inputs (prod-legacy · the dev legacy backup · the already-migrated dev config):
   clean `--check`/`--apply`, idempotent re-apply, 0600, marker 1, all four roles resolve, secrets
   set-equal, and the only comment loss is the three documented inline ones on consumed keys. *(The
   rehearsal script's own comment check was blind to inline comments and reported zero loss; a
   `diff <(grep -o '#.*' …)` per input is what actually proved it.)*
6b. ✅ **DONE 2026-07-27 — and it earned itself on the first run.** Executed exactly as specified below.
   **Result: the printed §Rollback sequence is correct and executable verbatim — and rehearsing it
   surfaced a HIGH in `install.sh` that no review had caught.** Full record: §17.4.

   *(Original brief, kept — it is the reusable spec.)* **Rehearse the RECOVERY path once before tagging
   (Fable, pre-release review).** §17.2 correctly names the first-run `install.sh prod` cutover as the highest-risk step and
   covers it with step 0 — but the path *out* of that failure has never run either. `update.sh`
   deliberately refuses to drive v1.2.1 (§17.3), so recovery is the runbook's manual sequence, which has
   been **reviewed twice, found wrong twice** (§17.1 and §17.3 each caught an ordering defect in it) and
   **executed never**. This chapter's own lesson — a fragment tested outside the environment that will
   run it is measuring a different program — applies verbatim to a runbook tested only as prose.
   **The minimum that discharges it** (Fable, asked for the cheapest sufficient subset): skip steps 1–2
   (`systemctl --user stop` is exercised constantly and is the least likely part to be wrong) and
   rehearse the part that has never run anywhere — **v1.2.1's own pre-protocol `install.sh`, run against
   a restored pre-migration config, in a tree shaped like prod's**: a scratch **sparse, tag-pinned**
   clone (checking out backwards through a sparse pinned tree is its own mechanics risk, distinct from
   the installer), the **real step-0 backup copies** (not synthetic files) restored into a scratch
   `CTRLB_HOME` on an odd port, verified with the runbook's own verification commands. **Execute the
   document literally, command by command, in printed order** — the defect class found twice here was
   ordering and prose, so the rehearsal must run the document, not the operator's mental model of it;
   any adaptation a command needs is a **finding to record, not a silent fix**. ~20 minutes, prod
   untouched.
7. Tag → CI release gate green → `update.sh vX.Y.0`, which is prod's first run of the chain.

**The highest-risk step, named:** not the migration (rehearsed many times on copies of both real
configs) but the **first end-to-end execution of `install.sh prod`'s cutover block** — snapshot →
verified stop → apply → swap → start under `set -euo pipefail` — happening on production, during the
release, through a failure-messaging path that has never run. `update.sh`'s hard `~/apps/ctrl-b`
identity check makes its success path structurally unrehearsable off-prod; accepted, but it concentrates
first-run risk, which is what step 0 exists to cover.

### 17.3 Pre-release audit of slice 7 (Codex) — DO NOT SHIP, and it was right

Ten findings. **The first two invalidate claims I made in §17 and to the owner**, and both were
reproduced before fixing.

| Sev | Finding | Fix |
|---|---|---|
| **CRITICAL** | **Slice 8 cannot invoke `update.sh` at all.** `update.sh` ships *in* the release that introduces it, and prod is pinned to `v1.2.1`, which has no copy — verified: `git cat-file -e v1.2.1:deploy/linux/update.sh` → 128. The runbook now led with a command that cannot exist on the tree it is run from. | §Release documents the one-time bootstrap: `git show vX.Y.Z:deploy/linux/update.sh \| bash -s -- vX.Y.Z`. From the next release the plain command works. |
| **HIGH** | **My "verified" downgrade guard never runs.** I tested the parsers interactively and reported the refusal working; the script sets `-euo pipefail`, under which the *absent* `v1.2.1:…/VERSION` makes `git show` exit 128, `pipefail` fails the assignment and `errexit` kills the script — **before** the `:-0` default, so the refusal and its message never happen. Reproduced. Same class for a missing `config.yaml` (`sed \| head`). | `parse_version()` — no pipeline, explicit `if raw="$(git show …)"` so absence is a *branch*, and strict `^0*[0-9]{1,9}$` validation (`tr -dc` had turned `v1.2` into 12 and `abc` into 0). Every fix re-verified under `bash -euo pipefail`. |
| HIGH | **Rollback delegated safety to an installer that does not have it.** `update.sh v1.2.1` would check out v1.2.1 and run *its* `install.sh` — swallowed stop, no health gate — then print `✓` having checked only `git describe`, while the script's own comment claimed "install.sh already gated health + identity". | The updater **refuses to drive** any tag with no `config_migration/` (i.e. predating the protocol) and prints the manual sequence instead, plus it now runs its **own** `/api/health` + version verification for the tags it does drive. |
| HIGH | **The check could inspect a config the app never loads** — the loader resolves `.env` → `CTRLB_CONFIG`/`CTRLB_HOME`; the updater always read `$CTRLB_HOME/config.yaml`. | `CTRLB_CONFIG` set, or a `.env` in the prod tree, is now a **refusal** — guessing wrong permits a rollback that strands the real config. |
| HIGH | **An unstamped new-shape config defeated the gate**: `providers:` with no marker reads as 0 and sails into an old build that tolerates the key and boots empty. | At the version-0 boundary the marker is trusted only if the *shape* agrees: a `providers:`-carrying unstamped config is refused. |
| HIGH | **Provenance and CI failed open**: a local `rev-parse` is satisfied by a stale local-only tag; `gh` errors were masked into "no run found"; missing `gh` proceeded; the run was matched on `headBranch` alone. | `git ls-remote --exit-code` proves the tag is on **origin**; the run must match tag **and** `headSha` **and** a `push` event; and every unverifiable state now requires `--force`. |
| HIGH | **§Rollback told the operator to revert the code first**, then said afterwards that the config restore must precede it — the *same* defect Fable found in the script's message, in the file I had just rewritten. | §Rollback is now a numbered execution-order sequence: stop → verify stopped → config → data → one checkout+install → verify by hand. |
| HIGH | **The failure report could state the opposite of reality**: a post-cutover health failure can leave the unit *active*, which was reported as "pre-cutover, the previous version is still serving"; transitional states and failed queries were both called "STOPPED". | The phase is never inferred: the raw state is reported (`active` + what it serves · `inactive/failed` = down · transitional · *query failed — do not assume stopped*). |
| MED | Backup presence did not prove a migration committed — the backup is written *before* the writes, and a concurrent standalone run could add one. | The **on-disk marker** is compared before and after; the "was migrated" branch fires on shape change, not on a file appearing. |
| MED | Prod-tree identity had two holes: a `REPO=/nonexistent` that is itself a checkout could match the sentinel, and a symlinked `~/apps/ctrl-b` admitted whatever it pointed at. | Both sides resolved explicitly with no sentinel. |

**The lesson worth keeping:** every parser in this script was *tested and reported working* — in an
interactive shell that did not have `set -euo pipefail`. **A shell fragment must be exercised under the
options of the script that will run it**, or the test is measuring a different program.

---

### 17.4 Step 6b — the recovery rehearsal, AS EXECUTED (2026-07-27)

Run against a scratch **sparse, tag-pinned** clone under `~/.cache/tmp/rb-rehearsal` with a scratch
`CTRLB_HOME` staged as *post-release prod* (the migrated config + the real step-0 backups), executing
§Rollback **literally, command by command, in printed order**. **Prod was verified untouched throughout
and after: `NRestarts=0`, `MainPID` unchanged (1161, active since 2026-07-24), `/api/health` = 1.2.1.**

**▶ FINDING R1 — HIGH, and it is in the installer we are about to SHIP, not just in v1.2.1.**
**`install.sh prod` cannot be rehearsed off-prod: `REPO` and `CTRLB_HOME` isolate the tree and the data
but NOT the systemd unit.** The render is an unconditional
`sed … > "$HOME/.config/systemd/user/$u"` with a **fixed unit name**, so running the installer from any
other tree **silently rewrites the LIVE prod unit** — `WorkingDirectory`, `Environment=CTRLB_HOME` and
`ExecStart` all repointed at the scratch paths. Verified by inspecting the file afterwards; the running
service survived **only** because this rehearsal had stubbed `systemctl` (so no `daemon-reload` picked
the file up). Unstubbed, the damage is latent: the service keeps running correctly until the next
`daemon-reload` or reboot, then starts prod from a scratch tree that may no longer exist.
*Restored immediately by re-rendering the unit from the prod tree with the canonical values, then
`daemon-reload` + verification of the file, systemd's loaded `ExecStart`, `is-active`, `NRestarts` and
`/api/health`.*
**✅ FIXED (owner: "yes"), one line + its uses:** `SYSTEMD_USER_DIR="${SYSTEMD_USER_DIR:-$HOME/.config/systemd/user}"`,
and every render/probe goes through it, so a rehearsal can point the units somewhere harmless. The
alternative — refusing `prod` when `REPO` is not the canonical path — is more machinery for the same
guarantee. **Residual, deliberately not papered over and stated in the script:** `daemon-reload` and
`enable --now` still address the REAL user manager (one unit namespace per user; a client cannot
redirect it), so a rehearsal must ALSO neutralise `systemctl` as this one did. The variable closes the
half that fails *silently*.
**Verified against a real criterion, not by reading:** `install.sh dev` re-run with
`SYSTEMD_USER_DIR` redirected → all three dev units rendered into the scratch dir, the real
`~/.config/systemd/user` **byte-identical by md5 across every unit**, tmux session identities
unchanged (agents not restarted), prod still active and healthy. Before the fix, that same run
rewrote three real unit files. Pinned by
`test_installer_writes_units_only_through_systemd_user_dir` (in `test_arch_invariants_qh9.py`, with
the other drift guards), which fails on any new literal write to the hardcoded path. **Note this is exactly the class the
plan already legislates against elsewhere:** `update.sh` grew a hard prod-tree identity check (§17.3)
precisely because paths that *look* canonical are not, while the installer underneath it still writes
one hardcoded path regardless of where it is invoked from.

**▶ FINDING R2 — the documented silent failure is REAL, and now proven rather than reasoned.** Booting
v1.2.1 against the **migrated** config (i.e. skipping §Rollback step 2, the case the whole ordering
exists to prevent) returns `{"status":"ok","version":"1.2.1"}` with **every endpoint blank** —
`inference.local`/`cloud` base_urls empty, `voice.stt.primary` empty, embeddings empty — and
`/api/voice/status` `{"stt":false,"tts":false}`. **Nothing is logged.** Chat and voice are silently
dead behind a healthy-looking service. The warning text in §Rollback and in `update.sh` is not
theoretical; keep it prominent.

**▶ What PASSED, verbatim** (this is the part that had never been executed anywhere):
* `ls -t …/backups/config.yaml.*` listed the migration's own backup first, and `cp -p` restored it
  **keeping 0600**; the legacy shape came back (`providers:` gone, marker gone).
* The DATA step's sidecar removal + `gunzip` + `PRAGMA integrity_check` → `ok`.
* **`git checkout v1.2.1` backwards through a sparse, tag-pinned tree** — the cone survived intact
  (`backend deploy frontend`), `git describe --exact-match` = `v1.2.1`. This was Fable's named
  "mechanics risk distinct from the installer"; it is clean.
* **v1.2.1's own pre-protocol `install.sh` completed today, exit 0** — Python 3.14 venv, `pip install
  -e`, `npm ci` and the Vite build all still work at that tag with today's toolchain, and it took its
  own DB snapshot before the (stubbed) cutover.
* **The old build BOOTS on the restored config with all four roles intact**: chat local
  `192.168.1.137:5001` + cloud OpenRouter, STT `127.0.0.1:9000` → `192.168.1.137:9000`, TTS
  `127.0.0.1:9000` → `192.168.1.137:7851`, embeddings OpenRouter — and `/api/voice/status`
  `{"stt":true,"tts":true}`. That is the question the rollback exists to answer, answered.

**Adaptations, recorded as findings rather than fixed silently** (per the brief): `systemctl` was
replaced by a logging no-op stub on `PATH` — **required**, see R1 — and the scratch instance was booted
by hand on `127.0.0.1:5499` instead of `0.0.0.0:5433`, since a rehearsal must not bind the tailnet. One
cosmetic note: v1.2.1's success banner prints `curl -s localhost:5433/api/health`, which during a
rehearsal points at the *real* prod instance; and `/api/health`'s `server.port` reports the **configured**
port (5433), not the port actually bound, so an operator verifying a hand-started instance by that field
alone would be looking at the wrong number.

---

## 18. ISS-90 — the rollback report redesign (as-built, 2026-10-22)

**Why.** `update.sh`'s failure report read the config marker at a third, hand-copied site without
`marker_value`, so every marker the migrator writes (it carries an end-of-line comment) read as shape 0 and
the report advised "the config was NOT migrated … the tag revert alone is sufficient" after a run that DID
migrate ([ISS-90](./ISSUES.md); `f1b267df` wrote the success-path read, `4b3a54d7` the failure-path one,
`0f87652b` fixed the two it knew of). The audit and a three-round council (audit → blind proposals → an
adversary ×3; council record: session 82, 2026-10-22 — this section is the durable record) found the neighbours: the two reports asked
different questions (A-2); "zero providers" is true only for pre-runner tags — every runner-era tag refuses a
newer stamp (exit 78) at its installer's preflight and at boot (A-3); the restore put back the config but not
the agent files the same run rewrote (A-4); "the newest backup" picked hand copies and stale files (A-5); a
retry lost `$from` (G1); a failure between the agent writes and the config commit read as "revert alone" (G2);
the fixed script only runs from the NEXT release (G3); bash and the migrator disagreed on odd marker spellings
(G4). Design v3.1, owner-ruled 2026-10-22 ("v3 in full": fail closed on the recovery path).

### 18.1 One reader per fact (`deploy/linux/update.sh`)
- **`config_shape <file>`** — the ONLY `config_version` read. Absent file, or no line naming the key at
  column 0 → 0 (the migrator's own meaning). A STRICT pattern accepts exactly the marker the migrator writes
  (`^config_version:[ ]+(0|[1-9][0-9]{0,8})([ ]+#.*)?[ ]*\r?$`, `LC_ALL=C`: literal SPACES only — the
  migrator refuses `config_version:5` (not a mapping) and a TAB after the colon or before the `#` (the YAML
  scanner rejects it), and a final `\r` (CRLF, which the migrator preserves) is tolerated); a
  LOOSE pattern (`^(BOM)?["']?config_version["']?[[:space:]]*:`) catches a line that names the key but is
  not that marker → **FAIL** (rc 1, prints nothing). So `5#c`, `05`, `+5`, `:5`, a TAB, a BOM, quotes, a space
  before the colon all fail closed; `Config_Version`, indented/nested keys, comments, `config_version_old`, flow style
  read 0. An existing but unreadable file FAILS (it exists: "absent → 0" would be a guess). `marker_value`
  (its only caller) cuts the `#` tail and drops `\r`; `parse_version` is unchanged.
- **`build_version <repo> <rev>`** — the ONLY `config_migration/VERSION` read, an rc ladder: 0 the number ·
  **2** `cat-file -e rev^{commit}` fails, or `ls-tree` exits non-zero (a missing tree offline is never "the
  file is absent") · **3** `ls-tree` succeeds with empty output = a pre-runner tree (shape 0) · **4** the tree
  lists the file but `git show` fails = the blob is not local in prod's `--filter=blob:none` clone (never
  "pre-runner") · **1** not a plain integer. For `$tag`: 2 and 4 refuse (exit 1, naming the `git fetch`), 3 =
  pre-runner (step 6's manual sequence), 1 = exit 78. For `$from`: 3 = pre-runner wording, 1 = treated as 0
  (restore advised), 2/4 = unknown.
- **`backup_stamps <home>`** — the migration's backup sets, oldest first, each stamp once: regular files named
  EXACTLY `config.yaml.<YYYYmmddTHHMMSSZ>` or `config.yaml.<stamp>-<N>` (`_backup`'s naming: on a same-second
  collision it appends `-N` to each FILE that already exists), so `.manual`, `manual-…`, `.pre-v…`, a
  directory or a dangling link never qualify (a non-file would read as shape 0 and win any max); fixed-width
  UTC, so name order = time order (no `ls -t`). **`latest_backup` / `config_backup <home> <stamp>`** resolve a
  set's file to its HIGHEST suffix (the latest apply of that second), per file; **`agent_backups <home>
  <stamp>`** lists `<agent>--agent.yaml.<stamp>[-N]`, the highest suffix per agent. Residual: two applies in one
  second that back up DIFFERENT agents merge into one name-grouped set (a run record lists its exact names).
  **`records` / `record_pairs` / `record_state` / `open_run` / `superseded_for`** read the migrator's run
  records (§18.3). **`q`** shell-quotes (`printf %q`)
  every path in a command the script PRINTS for a human to paste (a space in `$HOME` must not split a `cp`).

### 18.2 `$from`, fixed before the checkout
`head_tag = git describe --tags --exact-match`. **Not the target** → `from = head_tag` (else the short sha).
**At the target** → if the unit is `active` AND `/api/health` says `ok` at `${tag#v}` AND its `pid` equals the
unit's `MainPID` (a stale process answering after install.sh's identity gate failed must not pass) → "✓ already
at $tag and serving it — nothing to update", exit 0. Otherwise it is a RETRY: `from` = the newest reflog hop
`checkout: moving from X to …` whose `X^{commit}` ≠ `$tag^{commit}`, named by its tag when one points at it,
(`reflog_from`). The banner claims neither cause: "-- retrying
$tag (the tree is already at $tag but the service is not serving it — a previous run of this update did not
finish, or the service is down; you came from $from per the git reflog — if $from itself never finished
deploying, go back further: README §Rollback step 2)"; the failure report's tree line reads "tree: at $tag (not
moved by this run; the reflog's previous version: $from)". No such hop (fresh clone, expired
reflog) → `from` unknown: both reports say "the version you came from is unknown (no reflog entry) — README
§Rollback step 2" and never a self-referential "revert to $tag". No state file. `from_ver = build_version
$from`, computed once.

### 18.3 The predicate — ONE question, computed once at the top of step 8 (wave 4: the run record)
**The run record (owner-ruled 2026-10-22, option C).** The migrator's `apply`, when its plan rewrites agent
files, writes `backups/<config backup name>.run` (0600, fsync'd through `_write_new_0600`, the writer factored
out of `_backup`; the directory fsync'd with `core/fsutil.fsync_dir`) right after the backups and before the
first agent write: `stamp=<T>`, then one `backup<TAB>live` line per file, paths relative to `$CTRLB_HOME`.
Right after `_write_config`'s `os.replace` (before `_assert_postcondition`, a post-commit state) ONE atomic
rename makes it `….run.committed`; that commit also renames every OLDER open `*.run` to `….run.superseded`
(a commit without a record — a config-only plan — supersedes too). If the write phase fails while EVERY listed
file is still byte-identical to its backup (`filecmp`, the reader's own rule), the record is removed — nothing
is half-applied. A config-only plan writes none: one `os.replace` cannot half-apply. Before any write the
migrator refuses an agent folder name holding whitespace, a control character or `..` (the reader's rule), so
it never records a run the reader would call broken; the record's paths are LEXICAL relative paths (against
`home_path()`, then the unresolved `$CTRLB_HOME` the config path is built on — a symlinked home or `agents/`
still reads `agents/<x>/agent.yaml`).
**The state machine is the record's NAME — one rename each, never a sibling file:**
`.run → .run.committed (the migrator, at its commit) | .run.superseded (the migrator, a later commit) |
.run.resolved (closed without a commit)`, and `.run.superseded → .run.resolved` once its set is back (wave 6:
an offered superseded set, once restored, must never be offered again — a later edit would be lost to it).
**`update.sh`** reads each `.run`, oldest first: `broken` (not exactly what the migrator writes — `stamp=`
first and equal to its own name; the FIRST pair `backups/config.yaml.<T>[-N]` → `config.yaml`; every other
pair `backups/<x>--agent.yaml.<T>[-N]` → `agents/<x>/agent.yaml` with the SAME `<x>`; every pair of the
record's own `<T>`; no `..`, whitespace or control character; at least one agent pair — or a listed backup
missing): never closed, never turned into a `cp`, the stop line · `committed` (the LIVE config's shape is
above the record's config backup: a crash between the config's `os.replace` and the rename — the commit is
proven by the shape) → renamed `.run.committed` · `restored` (every listed live file byte-identical to its
backup) → renamed `.run.resolved` — the closure is made DURABLE at once, so a later edit to a listed file
can never reopen it (wave 5: the reviewers' HIGH — a closure left implicit in file contents did reopen, and
then every later update refused) · else `open`: the OLDEST open record is the pre-state (no commit in
between). Renames happen under the deploy lock. The printed restore of an open record ends with ONE guarded
line, `cmp -s <b1> <l1> && … && mv <record> <record>.resolved`, so a restore followed by a rollback through an
OLDER updater (which knows no records) still closes it; the operator's deliberate fix-forward is the same
`mv` (README §Rollback step 2).
`cur_ver = config_shape $cfg` (empty on FAIL).
`restore` = **yes** if a run is open (even when `$from` is unknown: its set is the pre-state) · else
**unknown** if `cur_ver` or `from_ver` is empty · **yes** if `cur_ver > from_ver` · else **no**. Step 5
refuses (78) on an open run with its set and "then re-run this same command" — on any tag, so `update.sh
v(prev)` after a half-applied run (E21) and a manual checkout away and back between attempts (E22) are both
caught.
**WHY a record, after two other rules failed (record):** a TIME window (backups since the run started, or on
a retry since the reflog's checkout into the tag) is defeated by a manual `git checkout` away and back
between attempts (the adversary reproduced it) and mislabels an old successful update as a failed attempt; a
STATE rule (an agent-bearing set whose config shape equals the current one and whose agent backup differs
from the live file) also matches a COMMITTED same-shape migration (a step that applies to side files only —
reproduced with the real migrator) and any agent edit after a correct restore, and as a step-5 refusal it
would block every later update. Only the migrator knows whether it committed; the record is its word.
**Failure report:** `no` → "config: shape N, which $from reads (M or below) — the tag revert alone is enough"
+ the revert line. `yes` + an open run → "⚠ a migration started at <T> rewrote N file(s) and never committed —
put its whole set back before anything else (a re-run does NOT repair this — ISS-114)" + the record's set —
never "re-run, it converges" ([ISS-114](./ISSUES.md)). `yes` + `cur_ver > from_ver` → "shape N now (it was D
when this run started); $from reads M or below", then for a runner-era `$from` "A tag revert ALONE fails:
$from's installer refuses this config at its preflight (exit 78) and prod stays as it is", for a pre-runner
`$from` the zero-providers wording. `unknown` → the marker cannot be read ("Do NOT revert the tag alone; … if it
is above M go back in this order") or `$from`'s shape is unknown (the reason + README §Rollback step 2; no
revert line). Every failure report with a known `$from` also prints "(if $from itself never finished
deploying, go back further: README §Rollback step 2)". Every restore block is followed by `git checkout $from
&& install.sh prod` and the health curl — or, when `$from` is unknown, by "the release to go back to is unknown
here — README §Rollback step 2".
**Success hint**, same predicate: `no` → "roll back with: bash … update.sh $from"; `yes` with `cur_ver >
from_ver` → "NOT a one-liner … 'update.sh $from' will refuse and print the exact restore first; the backup set
it will name: <restore_stamp>"; `yes` from an open run → "'update.sh <tag>' refuses until its set is back";
`unknown` → README §Rollback step 2.

### 18.4 The restore block — `print_config_restore <home> <max> [<record>] [<run_start>]`, the one printer
ONE resolver decides the set to offer when no open record is given — `offer_set` (the shape pick, or the
superseded record behind it) — and the success hint names exactly what it returns, so the hint and the later
`update.sh $from` never disagree. `<run_start>` is an argument (no dynamic scope).
An empty `<home>` or `<max>` prints "✗ update.sh bug …" and FAILS (never a silent default). With `<record>` (an
open run) it prints the record's exact pairs — per-file collision suffixes included — labelled "the set of a
migration that rewrote agent files and never committed (started <date> UTC)"; a malformed record or a listed
backup that is missing → "✗ …" and FAIL, never a `cp`;
without, **`restore_stamp`** picks the NEWEST backup set whose own config shape is ≤ `<max>` (an unreadable
backup is never offered) and labels it "taken earlier — <date> UTC, shape N: the right one if you are retrying
a failed attempt of this same update, or undoing the update that took it; otherwise check README §Rollback
step 2" ("taken during this run" when its stamp is at or after this run's start — a LABEL only, never a
decision). When a SUPERSEDED record holds the real pre-state behind that set (`superseded_for`: the OLDEST
`.run.superseded` stamped at or before it whose config backup is byte-identical to the set's — later applies
started from its half state, each backing up the same untouched config but only the agent files still to
rewrite, so the FIRST record holds every original; E27, two agents), that record's pairs are printed
instead, labelled "taken <date> UTC by a migration that rewrote agent files and
never committed (a later run committed over it — ISS-114)" (E18). Every set prints `cp -p` (paths shell-quoted) for `config.yaml` and for each `<agent>--agent.yaml.<stamp>` →
`agents/<agent>/agent.yaml`, one per line (no `&&`), with "Config + N agent file(s) — all of them, never the
config alone" or, for N = 0, "Config only — if the run that took it also rewrote agent files, their backups are
missing: README §Rollback step 2"; then "(cp -p keeps 0600. This discards any config or agent edit made after
<stamp>.)" and the `grep` check "must show <max> or less". A set whose shape is above `<max>` (or unreadable)
gets a ⚠ line. Nothing qualifies → "✗ no backup … Do not improvise: README §Rollback step 2", no `cp`, and the
printer FAILS: every caller then prints, instead of its continuation (the checkout of `$from`, or the step-5
"re-run this same command"), the one line `restore_unresolved` owns — "stop here: resolve the backup first
(README §Rollback step 2) — do not check out <rev> until the config it reads is in place".
Contexts: the step-5 refusal (max = the tag's VERSION; then "4. bash … update.sh $tag" = re-run this same
command), the unstamped-`providers:` refusal (max 0), the failure report (max = `from_ver`). The pre-runner
refusal (step 6) prints NO restore: step 5 just proved the config is at a shape that tag reads (A-5).

### 18.5 Riders
`gh run list --branch "$tag"` (an old tag's run left the unfiltered 30-run window, so `update.sh v(prev)` — the
rollback entry point — refused at the CI gate, N-1) · the unstamped-`providers:` check uses `disk_ver -eq 0`
instead of a second marker read (an explicit `config_version: 0` + `providers:` is now refused too) and quotes
`'providers:'` (A-6: backticks ran it as a command) · `install.sh`'s preflight abort says "this run has not
touched the $ROLE service" (it was "the running service is untouched", false after a failed post-cutover run) ·
the migrator's `_print_status` says `migration: stamp only (N → M) — runner-era builds below M refuse this
file; pre-runner builds (no config_migration) read it blind` when it wrote, no step applied and the marker moved (A-7) · DECISIONS' expand/contract entry
scoped to the DB (A-8) · README §Rollback step 2 is the manual method the `unknown` branch points at.

### 18.6 Deviations from design v3.1, as built
- `this_run_stamp` also excludes stamps that existed BEFORE `install.sh` ran. v3.1 accepted a same-second
  false positive as LOW; the e2e retry case (E8) hit it — two runs in one second made the first run's set
  "this run's" and printed the partial-write text. `_backup` never reuses a name (`O_EXCL`, `-2` suffix), so
  the exclusion hides nothing the run wrote.
- `config_shape` FAILS on an existing but unreadable file (v3.1: read as 0, a dead path the adversary noted).
- The explicit-stamp set prints its shape too, with a ⚠ line when it is above `<max>`; the "taken earlier" label
  adds "or undoing the update that took it" (the same printer serves the step-5 refusal, where "retrying" alone
  does not fit); the N = 0 line says "the run that took it" (it serves both labels).
- A `yes` that comes only from the agent clause while `$from` reads the current shape gets its own neutral
  wording (the runner-era "a tag revert ALONE fails" would be false there).
- `$from`'s VERSION unreadable (rc 2/4) prints one "!" line before the checkout and reports `unknown`.
- **Fix wave 1 (2026-10-22):** the printer FAILS on its ✗ path and every caller prints `restore_unresolved`'s
  stop line instead of its continuation; `UPDATE_PLAN` §3.4 carries the ISS-114 caveat.
- **Fix wave 2 (2026-10-22, the blind review):** the retry window (`update_start` from the reflog, the
  earliest set, the "attempt at" label — a retry that failed BEFORE migrating after a half-written first
  attempt said "revert alone"; E12) · the neutral retry banner and tree line · `:5` fails closed · regular-file
  backups only · printed paths quoted · `print_config_restore` refuses an empty `<max>` · the A-7 line scoped to
  runner-era builds. The partial-write test compares `cur_ver` with the SET's shape (`set_ver`), not with this
  run's start shape: on a retry after a committed first attempt they differ, and only `set_ver` is right.

- **Wave 6 (2026-10-22, the reviewers' wave-5 round; main-seat rulings):** the closure extends to SUPERSEDED
  records — the restore of a superseded set ends with the same guarded `mv` (to `….run.resolved`), and
  `open_run` renames a superseded record whose set is back `.run.resolved` (never `committed`; a broken one is
  skipped) · the agent-folder refusal moves into the SHARED preflight (`validate`, one call site), so `--check`
  refuses exactly like `--apply` · its character class equals bash's `[[:space:][:cntrl:]]` under `LC_ALL=C`,
  which `record_pairs` pins (`[\x00-\x20\x7f]` or `..` — not Python's `\s`, which over-refuses NBSP, and
  not a UTF-8 locale's class, which adds C1 and a dozen Unicode spaces; the Opus confirm round 4 measured
  both against bash — the two rules are now identical in every locale).
- **Wave 5 (2026-10-22, the reviewers' wave-4 round; main-seat rulings):** closure is a NAME state
  (`.run.resolved` by rename — `update.sh` when every file is back, the printed guarded `mv`, or the operator)
  · a shape-proven commit renames `.run.committed` · `superseded_for` picks the OLDEST · the except path uses
  the exact `filecmp` rule (the `written` counter is gone) · `_rel_home` is lexical against two bases ·
  hostile agent folder names refused before any write · `record_pairs` validates the PAIR · one resolver
  (`offer_set`) for the report and the hint · `marker_value`'s dead `\r` strip deleted (`parse_version`
  strips it) · residuals documented. **Found while building:** `home_path()` RESOLVES `$CTRLB_HOME` while the
  config path is deliberately unresolved (the symlink refusal) — so a purely lexical `_rel_home` needs both
  bases (`_unresolved_home()` factored from `_unresolved_config_path`), fixed at the source of each path.
- **Wave 4 (2026-10-22, option C, owner-ruled; both reviewers' confirm-round amendments):** the run record
  (§18.3) replaces wave 2's time window — `update_start`, the excluded-before-the-run stamps, the "attempt at"
  label and the reflog hop's time are DELETED (`reflog_from` stays for `$from`); step 5 refuses on an open run;
  superseded records still serve a rollback (`superseded_for`); a failed config-backup lookup is never read as
  shape 0 (`restore_stamp` skips it); E21/E22 un-xfailed. **Deviation from amendment 3, recorded:** the
  migrator supersedes on EVERY commit (with or without its own record), and the READER keeps offering a
  superseded record's set for a rollback (the adversary's confirm round N3) — otherwise E18's set would be the
  config-only re-apply backup and the restore would leave the agent file in the new shape.
- **Fix wave 3 (2026-10-22, the adversary):** `-N` collision names everywhere (per-file highest suffix; the
  "before this run" list by FILE) · literal spaces in the marker pattern · the chain hedge "(if $from itself
  never finished deploying, go back further: README §Rollback step 2)" on EVERY failure report, normal runs
  included · the `apply` docstring's convergence caveat · E13–E20 and two strict xfails. The predicate keeps
  wave 2's time window (the state rule was withdrawn — §18.7).

### 18.7 Residuals (accepted, LOW unless noted)
Duplicate `config_version:` lines (bash takes the first strict one; the migrator refuses the file) · flow-style
`{config_version: 5}` reads 0 · after a CHAIN of failed updates the reflog names the last failed target, not
the last version that served (the retry banner says so) · a branch name in the reflog resolves to the branch's
current commit (prod never moves a local branch) · a clock stepped backwards mid-run only mislabels a set
("taken earlier" vs "during this run") · two applies in one UTC second that back up DIFFERENT agents merge into one set
(the `-N` names are otherwise handled — an earlier version of this list said they "fail toward ✗ no backup";
the adversary reproduced the opposite, a fail-OPEN "revert alone", fixed in wave 3, E19; for a run that
rewrote agent files the record lists the exact per-file names, so the merge cannot happen there) ·
a half-applied run (agent files rewritten, the config commit not reached) left by a migrator from BEFORE the
run records (every backup on prod today) cannot be detected — none can exist on prod (no pending step touches
agent files), and from the first record-writing release on, the migrator that runs is always the TARGET tag's
(G3), so every later migration writes records · without a directory fsync on Windows (the allowlisted no-op)
a power loss can keep an agent rewrite and lose the record's name · an EMPTY or truncated record (a crash
between its creation and its fsync) is `broken` and blocks until the operator's `mv … .resolved` · TWO
migrators at once (a manual `--apply` during an update) are outside the contract: the second supersedes the
first's record, and the first's `_close_run_record` then raises after its commit — reported as a post-commit
failure (the config IS committed; no code) · a config edited between two partials matches no superseded
record's config backup → the config-only shape pick is offered · a superseded record older than an unrelated
later set with byte-identical config is still preferred for that set (its agent pre-images may predate later
agent edits — the "discards any edit made after <stamp>" line names its date) · two applies in the SAME second
merge into one name-grouped set, which can include an agent backup of a resolved run (a record-driven set
never merges) · **(MED-conditional, OP-3)** a config-only restore followed by a re-apply manufactures a
newer config-only backup that a later rollback would pick — README's "never the config alone" rule; root fix =
[ISS-114](./ISSUES.md) · a rollback of more than one release can need agent files only an intermediate run
rewrote (outside the one-release window) · the fix protects the update AFTER the release that ships it (G3 —
README §Release: the first VERSION-bumping release after v1.7.12 runs the updater with the bootstrap form) ·
§3.4's "re-running `--apply` converges" is false for derive-and-rename steps ([ISS-114](./ISSUES.md); §3.4 now
says so); the report says "restore, do not re-run" meanwhile.

### 18.8 Tests (`backend/tests/test_update_sh.py`, was `test_update_sh_marker.py`)
**Unit** (the REAL functions extracted, under `set -euo pipefail`): `config_shape` on the real writer's stamp
(fresh and re-stamped 4 → 5) and the full spelling table (35 rows incl. absent/zero/CRLF/BOM/no-space/TABs) plus
absent/unreadable files · `build_version` rc 0/1/2/3 in a plain repo, rc 4 in a real `--filter=blob:none` clone
with the origin unreachable, rc 2 from an unlistable tree (`--filter=tree:0`, commit present) ·
`restore_stamp` against the real migrator's backup set plus decoys (`.manual`, `manual-…`, `.pre-v…`, `-2`,
newer shape 9, malformed) · the run records (`records` order by stamp then numeric suffix, `-10` after
`-2`; the printed guarded `mv` does nothing until every file is back, then renames `.run.resolved`, and a
later edit does not reopen it; `open_run` renames a restored record `.resolved` and a shape-proven commit
`.committed` itself; ten hostile record lines → `broken`, never a `cp` (incl. the mismatched pair `maya →
config.yaml`, another agent's file, another run's stamp, a `..` agent name only the `..` rule catches); a
record with no agent pair → `broken`; the OLDEST of two open records is named; a listed backup missing → the
stop line) · a CRLF marker parses (pins `parse_version`'s `\r` strip) · mutants (wave 5, run in scratch, each
killed by the named test): no `..` rule → the `..--agent` hostile row; `n ≥ 1` → the no-agent-pair test;
newest open → the oldest-open test; `%d` order → the suffix-order test; newest superseded → E27 ·
`backup_stamps` skipping a directory · `print_config_restore` (whole set incl. an agent name containing `--`,
no `&&`, both labels, ✗ with no `cp` and rc 1, the N = 0 wording, a space in the home path — the printed lines
EXECUTED — and an empty `<max>` refused).
**Migrator:** the A-7 line on a stamp-only apply, no restore wording, "not needed" on the re-run · the run
record: present with its exact lines at 0600 and no `.committed` when the config write fails after an agent
write · kept after ONE agent write when the second fails · refused before any write for an agent folder named
`My Agent` · lexical lines under a symlinked home · renamed `.committed` on a normal apply · none for a plan
without agent files · removed when the first
agent write fails · superseded by the next commit · a same-second second apply writes its own `-2.run`.
**Structural:** every non-comment, non-echo line naming `config_version` is inside `config_shape`/
`marker_value`; every `git show|ls-tree|cat-file` is inside `build_version`; no `|| echo 0`; every
`print_config_restore` call has ≥ 2 arguments and is guarded (`if …` or `||` — it returns 1); no backtick inside a double-quoted echo across
`deploy/linux/*.sh` + `tools/*.sh`; `bash -n`.
**End to end** — the REAL `update.sh` in a sandbox HOME (bare origin; annotated tags vOLD/vNEW with their own
VERSION; prod a clone at vOLD; `systemctl`/`curl`/`gh` stubs FIRST on PATH, asserted with `shutil.which`; vNEW's
stub `install.sh` runs the REAL migrator `--apply` via `sys.executable` with `CTRLB_HOME`/`CTRLB_CONFIG`
explicit; a hand-built env, nothing inherited; skipped if the repo has a `.env`): **E1** a failed migrating run
(the printed `cp` lines EXECUTED → config and agent byte-identical at 0600) · **E2** nothing migrated → revert
alone · **E3** pre-runner `$from` → its wording + the shape-0 set · **E4** stamp-only from a VERSION-5 `$from`
with a config-only backup present → revert alone · **E5** `update.sh vOLD` → exit 78 past three decoys, the
lines executed, the re-run passes step 5 · **E6** success hints (migrated / not) · **E7** an unreadable marker →
unknown, and after the ✗ only the stop line (no checkout) · **E5b** a rollback refusal with no backup to
offer → exit 78, the stop line, no re-run step · **E8** a retry → the reflog `$from`, the earlier set restored · **E8b** already serving → exit 0, the
installer never runs; a stale pid ≠ MainPID → still a retry · **E8c** expired reflog → unknown, no
self-reference · **E9** the partial write (the real migrator with its config write failing after the agent
write) → the whole-set text, no "converge", both files restored · **E10** the run's backup deleted → "taken
earlier" · **E11** `--branch <tag>` in the `gh` argv (asserted on every run) · **E12** a half-written first
attempt (record open), then a retry → refused at step 5 (78) with the record's set; executed, the record
closes itself and the same command proceeds · **E13/E13b** `$from`'s VERSION blob not local / tree unreadable (a `git` shim first on PATH fails that
one invocation) → unknown, never shape 0 · **E14** a malformed marker before the run → 78, the installer never
runs · **E15** the TAG's blob not local → refused naming the fetch, never the pre-runner branch · **E16** reflog
hops from the tag's own commit under another name are skipped · **E17** active + MainPID but another version
→ a retry, not "nothing to update" · **E18** a half-written attempt, a by-hand re-apply over it (the record
superseded), a retry → not refused, and the superseded record's set restores byte-for-byte · **E19** a same-second collision (`config.yaml.<T>-2`, the real migrator at a fixed clock) with a
partial write → the `-2` set, never "revert alone" · **E20** the chain hedge on a normal failure · **E21**
`update.sh vOLD` after a half-written run → 78 with the set, restored byte-for-byte · **E22** a manual checkout
away and back → still refused (78) · **E23** a broken record → 78 + the stop line · **E24** the printed
restore executed WITH its guarded close, then a checkout + a config edit → the next update proceeds · **E25**
the restore WITHOUT the guarded line → the next run renames it `.resolved` itself and proceeds · **E26** an
agent edit + the manual `mv` + a successful re-update → `update.sh vOLD` never offers that record's set
(fixed, distinct clocks) · **E27** two agents, three applies (fail on zed · fail at the commit · commit) →
`update.sh vOLD` restores BOTH originals from the OLDEST superseded record · **E28** a crash between the
commit and the rename → the next run renames it `.committed` and proceeds · **E29** a half-write, a by-hand
re-apply (superseded), `update.sh vOLD` offers that set (its guarded line ends `.run.resolved`), put back, the
re-run proceeds and closes it, an agent edit, a successful `update.sh vNEW` → `update.sh vOLD` offers the NEW
set (holding the edit), never the old one. Wave 6 also pins: the refusal in `--check` AND `--apply` (space,
tab, a C0 control, DEL, `..`), NBSP · an ideographic space · C1 NEL recorded and read, a symlinked `agents/` dir, the first pair not
`config.yaml`, a `stamp=` disagreeing with the name, the superseded closure unit — mutants (scratch, each
killed by the named test): the first-pair check dropped → the first-pair test; `stamp=` matched by pattern →
the stamp-line test; the superseded closure removed → its unit + E29; `_rel_home` with `resolve()` → the
symlinked-`agents/` test; no `\x7f` → the DEL row; no `..` → the dotdot row. The adversary's mutation run (22 injected regressions, 7 survived)
drove E13–E17; M22 (`marker_value`'s `\r` strip, redundant with `parse_version`) and M23 (`run_start` taken
after install.sh — the stub installs in under a second) remain unpinned. A unit test also builds the collision
with the real migrator in-process (fixed clock). Every e2e case fails when pointed at
the pre-ISS-90 script (measured 2026-10-22 — several on the new wording alone; the audit's own harness reproduced the bug itself).
