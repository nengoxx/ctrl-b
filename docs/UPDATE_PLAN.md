# UPDATE_PLAN v3 — the update/migration architecture

> **Status: DESIGN v3 — owner-ratified rulings folded in. ▶ SLICE 1 BUILT 2026-07-26** (the runner +
> 55 tests; as-built record + the six deltas from §3 in **[§11](#11-slice-1--as-built-2026-07-26)**).
> Next: slice 2 (move the fold in).
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

**`--check` hard-fails** when a consumed legacy secret exists only in the environment with no
new-form replacement. It prints the exact replacement variable and says: **add the new-form variable
now; remove the legacy one after the update completes** — the still-running old code may need it if
anything restarts before cutover (Fable N3).

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

**Environment overrides.** Keep the existing one-level mechanism **untouched**; add only
`CTRLB_PROVIDERS__<encoded-name>__<field>` with: an explicit **scalar-field allowlist**, documented
case rules, resolution by **normalising the provider names already present in the YAML** (`-`, `.`, `+`
→ `_`), **rejection of every normalised collision**, rejection of unknown providers and unknown fields,
and never replacing a non-mapping intermediate. A `CTRLB_*` variable landing on a **retired** path
**hard-fails at boot** rather than warning — a warning ships a service running without its credential.
*(Capability gain: provider API keys become fully separable into `.env`. Structured secrets stay in
`config.yaml` by design. The app never writes `.env`.)*

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
3. **Env overrides.** The provider form only, allowlist + normalisation + collision rejection, the
   retired-path hard-fail, the FX-B check with corrected wording.
4. **`main.py` import-time check + `RestartPreventExitStatus=78`** — and **verify the terminal
   `failed` status 78 on the dev unit**, plus the `--reload` worker path (a reload worker exits through
   uvicorn's `ChangeReload` parent, not systemd — behaviour unverified).
5. **`install.sh`**: hook + fatal stop + health gate + flock.
6. **Windows parity.**
7. **`update.sh`** + runbook rewrite + `config_version: 1` in `config.example.yaml`.
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
