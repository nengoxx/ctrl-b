# UPDATE_PLAN v3 — the update/migration architecture

> **Status: DESIGN v3 — owner-ratified rulings folded in. ▶ SLICES 1 + 2 + 3 BUILT 2026-07-26** — the
> runner (**[§11](#11-slice-1--as-built-2026-07-26)**), the fold's move out of the config load path
> (**[§12](#12-slice-2--as-built-2026-07-26)**), and env overrides
> (**[§13](#13-slice-3--as-built-2026-07-26-the-env-override-capability-retracted-the-retired-path-guarded)**
> — **§7 was overturned**: the provider-form overlay was ruled against and the capability RETRACTED).
> Gate 6/6, both live configs rehearsed on copies. **Slice 4 ✅ BUILT (§14) — the boot refusal is live
> and measured under systemd.** Next: slice 5 (`install.sh`).
> **Owner requirements:** after an update prod holds **zero** legacy keys · a **human with no coding
> agent** updates prod · a failed update is recoverable · **no leftover code, config or artifacts** ·
> **lean — no machinery we must maintain long-term.**
> **Evidence:** [R4](./research/R4-peer-config-migration.md) · [R5](./research/R5-migration-code-structure.md).
> **Reviews:** Fable ×3 (architecture · integration · A11 code) + Codex `gpt-5.6-sol` ×2. v1 was
> judged *"not safe to build as written"*; v2 closed the fundamentals; v3 closes the rest. Council
> record: §9. Owner rulings: §8.

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
post-migration repair hooks, ever** · no backup pruning · no cutover trap · no multi-file rollback
(§3.4 explains why the last two are unnecessary rather than merely cut).

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
  __init__.py   runner · detect() · STEPS · CLI          (~90 lines)
  VERSION       a one-line literal: 1                     (see §3.6)
  steps.py      the A11 fold, lifted from config.py       (~215 lines)
```

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
converges. Restore logic would guard an unreachable state — and a restore path can itself fail, which
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
4. CI gate: refuse red/pending unless --force. `gh` missing or unreachable ⇒ warn and proceed —
   "cannot check" is not "knowingly deploying red"
5. TARGET-VERSION PRECHECK, before checkout:
   git show <tag>:backend/app/config_migration/VERSION   (absent ⇒ 0)
   on-disk config_version > that ⇒ REFUSE, print the §Rollback CONFIG restore sequence
   and "then re-run this same command"
6. record the current tag → git checkout <tag> → bash install.sh prod
7. verify: git describe --exact-match == <tag>; /api/health version == X.Y.Z
8. on failure: print the exact go-back command AND whether prod is currently STOPPED. No auto-revert.
```

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
7. **`update.sh`** + `config_version: 1` in `config.example.yaml` + the **runbook rewrite, now
   RELEASE-BLOCKING with named content** (Fable, slice-5 review — verified against the file):
   `deploy/linux/README.md` §Rollback → CONFIG and §Release still describe the **lazy write-back deleted
   in slice 2** — a `config.yaml.bak-a11-<UTCstamp>` "dropped on the first config write" and an
   `A11: wrote…` log line (lines 231/263/268). That file will never exist; the runner's backups land in
   `$CTRLB_HOME/backups/config.yaml.<stamp>` at `--apply` time. Worse, the **code-only rollback path is
   silently insufficient across this release**: previous tag + already-migrated config = old code, no
   preflight, `extra="allow"` swallowing `providers:`, booting "healthy" with zero providers — the exact
   failure this plan exists to kill. §Rollback must state that across the migration release a CONFIG
   restore is **mandatory**, not conditional. `update.sh` itself shrinks to orchestration (tag resolve →
   pre-checkout VERSION downgrade guard → lock + `CTRLB_DEPLOY_LOCK_HELD=1` → checkout → `install.sh
   prod` → failure message), since the lock, check, apply, stop-verify and health gate all live in
   slice 5 now and must not be reimplemented. **Two riders from the slice-5 second round:** `update.sh`
   must compute `LOCK` from the **identical `$CTRLB_HOME` default chain** before exporting
   `CTRLB_DEPLOY_LOCK_HELD="$LOCK"`, or the new path-equality bypass never matches and the child blocks
   on its parent; and the **STALE marker on `README.md` §Rollback must not outlive this slice**.
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
test suites; **488 lines removed from `config.py`**. `VERSION` → 1, `STEPS = (A11,)`.

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

**NOT verified, deliberately — the gap to close before the release.** `install.sh` has **never been run
end-to-end** by this session. `install.sh prod` is a release action, not a slice-5 action. `install.sh
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
restarter, and the autostart path is the **worst** case for this slice: with no console, the pause and
the exit-code propagation do nothing, the task re-runs a guaranteed exit-78 three times, and then the
operator simply finds the dashboard absent — the silent failure this whole plan exists to kill.

No analogue can be built: Task Scheduler's restart policy is unconditional on failure and cannot be
told to stop on a particular exit code. The honest ceiling is therefore **documentation**, and
`deploy/windows/README.md` now carries the recovery line ("if the dashboard vanishes after an update,
run `start.cmd` manually — the console will show the fix"). The console path keeps the full benefit of
the two exit-code edits.

| File | Change | Why |
|---|---|---|
| `start.ps1` | `exit $LASTEXITCODE` after uvicorn | The script previously always returned **0**. So `start.cmd`'s existing `if errorlevel 1 pause` **never fired**, and the app's import-time config refusal (exit 78, §14) would print its fix instruction into a console window that then vanished. This one line is the entire parity requirement for the boot refusal. |
| `start.cmd` | capture `RC` **before** the pause, then `exit /b %RC%` | `pause` succeeds, so it overwrites `ERRORLEVEL` with 0 — capturing afterwards would have propagated "fine" out of every failure. The pause still holds the window open to read the message. |
| `setup.ps1` | `--check` → port guard → `--apply`, **before the frontend build** | The Windows half of §4. Placed before the build for the same reason as `install.sh` step 2.6 (the slice-5 ordering lesson): the build is the slowest thing there. `$ErrorActionPreference = "Stop"` does **not** trip on a native non-zero exit in PowerShell 5.1, so every code is checked explicitly. |

**The port guard is the Windows dev guard.** With no service manager, "is it running?" is "is :5433
held?" — probed with the same `Get-NetTCPConnection` idiom `start.ps1` already uses, rather than a new
mechanism. It closes the same hole as `install.sh`'s dev refusal: migrating under a live instance lets
that process write its **old in-memory settings** back afterwards, resurrecting legacy keys into a
stamped config.

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
