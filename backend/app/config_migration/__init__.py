"""Config-shape migration — the runner, the step contract and the CLI (`docs/UPDATE_PLAN.md` §3).

The owner's requirement is *"seamless updates without leftover code, leftover configurations, leftover
things"*: after an update the operator's `config.yaml` holds **zero** legacy keys, and the legacy
knowledge that got it there lives in **one deletable place** — this package. `app/config.py` never
imports it (G5); the import goes the other way, so retiring a migration is deleting a step.

Named `config_migration` because `db.py` already owns *schema* migration (`MIGRATIONS`), whose ordered
numbered-block shape this mirrors.

What is deletable is a **step**: retiring one is deleting it from `steps.py` and bumping `VERSION`.
The package itself stays coupled to the LIVE `Settings` model on purpose — every plan is validated
against today's schema, never against a frozen copy of an old one, which is what keeps a migration
from being written twice (R5 §2).

**Steps compute; the runner writes.** A `Step` is a pure `(applies, apply)` pair over an
already-parsed `Context` — it never touches the filesystem, never resolves a path, and never sees a
typed model (raw dicts only: R5 §2 found frozen legacy models ballooned a peer project's converter to
1229 lines). The runner owns every read, every write, the backup, and the postcondition.

Two properties do the real work:

* **`applies()` is evaluated for every step, always, regardless of the file's stamp** (§3.1). The
  version marker is used only for ordering and downgrade detection, never as the trigger — a config
  migrated by some earlier lazy write-back is still checked key-by-key.
* **The postcondition** (§3.3): after applying, the runner re-reads from disk and asserts that **no
  step applies** — over `config.yaml` *and* every `agents/*/agent.yaml`. That assertion, not the
  stamp, is what actually guarantees "zero legacy keys".

Corrections ship as a **new step**, never as a runtime repair hook (R5 §5): a peer project's
`repair_flattened_dict_configs()` still runs on every boot years later.

CLI (§3.5) — `python -m app.config_migration --check | --apply`. **Output is names, never values**:
paths, counts, legacy key names, agent names, backup destinations. No diff, no config values, and
never a raw exception — a pydantic `ValidationError` renders the rejected provider dict *including its
`api_key`*, a YAML parse error renders the offending source line, ruamel's duplicate-key error inlines
both values, and a constructor error quotes the tag verbatim. Each of those four is intercepted at its
own raise site; what survives is a category, a location and a key name.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import stat
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, NamedTuple

import yaml
from pydantic import ValidationError
from ruamel.yaml.constructor import DuplicateKeyError
from ruamel.yaml.error import YAMLError as RuamelYAMLError

from app.config import (
    CONFIG_VERSION_KEY,
    Settings,
    config_path,
    deep_set,
    delete_path,
    edit_config_yaml,
    env_override_vars,
    home_path,
    load_dotenv,
    sanitise_validation_error,
    yaml_rt,
)

_HERE = Path(__file__).resolve().parent

#: The config shape this build understands. Declared in a one-line `VERSION` file rather than derived
#: from `STEPS` because `update.sh` must read the *target tag's* version **before** checkout, and
#: `git show <tag>:…/VERSION` is trivial while parsing a computed Python constant is not (§3.6).
#: A test asserts it equals `STEPS[-1].version` — declared for machines, asserted for humans.
CONFIG_VERSION: int = int((_HERE / "VERSION").read_text(encoding="utf-8").strip())

#: Comment written above the marker the one time it is inserted.
_MARKER_COMMENT = "config shape version — managed by `python -m app.config_migration`"

EXIT_OK = 0
#: An ENVIRONMENTAL failure a retry might clear: an unwritable directory, a full disk, a file that
#: changed underneath us. Worth restarting for.
EXIT_FAIL = 1
#: systemd's `RestartPreventExitStatus` value (§3.7): a config this build cannot migrate, which no
#: restart will fix — a downgrade, unparseable YAML, anchors, a symlink, a broken `agent.yaml`, a
#: step bug. **This is the DEFAULT for `MigrationRefused`**, so the unit stops with a message the
#: operator can act on instead of crash-looping on it forever (`Restart=on-failure` + `RestartSec=5`
#: with no burst limit never trips systemd's own guard). Slice 4 wires `RestartPreventExitStatus=78`;
#: the taxonomy is settled here, before three callers start branching on it.
EXIT_REFUSE = 78


class MigrationRefused(Exception):
    """A state the runner refuses to act on, carrying its own exit code and an operator remedy.

    Raised for every "do not proceed" outcome — unparseable YAML, a symlinked config, anchors/aliases,
    a bad or newer marker, a broken `agent.yaml`. The message is already sanitised at the raise site;
    callers print `str(exc)` and `exc.remedy` directly and must never render the underlying exception.
    """

    def __init__(self, message: str, *, exit_code: int = EXIT_REFUSE, remedy: str = "") -> None:
        super().__init__(message)
        self.exit_code = exit_code
        self.remedy = remedy


@dataclass(frozen=True)
class Context:
    """Everything a step is allowed to see: the resolved locations **and the parsed documents**.

    Steps get pre-parsed raw dicts so that no step ever resolves a path, opens a file, or re-implements
    the refusal preflight — the runner has already refused anything unparseable by the time a step runs
    (§3.4 step 1). `agents` is keyed by the absolute `agent.yaml` path, the same key `Plan.agent_files`
    uses, so a step's output slots straight back into the next step's input.
    """

    config_path: Path
    agents_dir: Path
    config: dict[str, Any]
    agents: Mapping[Path, dict[str, Any]] = field(default_factory=dict)
    #: sha256 of each file's bytes as parsed — the runner refuses to write a file that changed
    #: underneath it (`_assert_unchanged`). Not carried forward when a step replaces the config in the
    #: plan chain; only `context_from_env` populates it.
    digests: Mapping[Path, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Plan:
    """What a step computed — never what it wrote (it wrote nothing).

    `config` is the **whole** migrated document — the runner diffs it against the input and writes only
    what changed (`_diff`). `consumes` is the step's declaration of which paths it consumed:
    every removal the diff finds must be covered by it, so a step that drops a key by accident is
    refused before any write, and a step that forgets to strip one is caught by the postcondition.
    `agent_files` maps an absolute `agent.yaml` path to its full new content.
    """

    config: dict[str, Any]
    consumes: list[str | Sequence[str]] = field(default_factory=list)
    agent_files: dict[Path, dict[str, Any]] = field(default_factory=dict)


class Step(NamedTuple):
    """One numbered, individually idempotent config-shape migration (R5 §10).

    `applies(ctx)` and `apply(ctx)` are both **pure**: they read `ctx.config` / `ctx.agents` and return
    a bool / a `Plan`. Neither writes. `version` orders the steps and sets the stamp written after the
    last one; it is never the trigger.

    `retires` declares the `(section, key)` paths this step's shape leaves dead to the one-level env
    overlay (`CTRLB_<SECTION>__<KEY>`). It is a **declaration, not a derivation**: `Plan.consumes` is
    computed from what was removed from *this* config, so it both misses a path that only ever existed
    in the environment and includes paths whose spelling stays live after the fold. Empty for a step
    that retires nothing.
    """

    version: int
    applies: Callable[[Context], bool]
    apply: Callable[[Context], Plan]
    retires: tuple[tuple[str, str], ...] = ()


def _load_steps() -> tuple[Step, ...]:
    """The ordered migration steps.

    Imported inside a function because `steps.py` imports the types defined ABOVE it in this module —
    a plain top-level import would be circular. That is the price of keeping the runner and the legacy
    knowledge in one package while letting the legacy half be deleted wholesale; the alternative
    (types in a third module) buys nothing but a file.
    """
    from app.config_migration.steps import A11, MEDIA_V2, PRESENCE_DEVICES

    return (A11, MEDIA_V2, PRESENCE_DEVICES)


STEPS: tuple[Step, ...] = _load_steps()


@dataclass(frozen=True)
class Status:
    """What `detect()` found — the operator-facing summary, holding names only, never values."""

    config_path: Path
    exists: bool
    version: int
    pending: tuple[int, ...]  # versions of the steps whose `applies()` is True
    legacy_keys: tuple[str, ...]
    agent_names: tuple[str, ...]

    @property
    def needs_migration(self) -> bool:
        return bool(self.pending)


# ── parsing + the refusal preflight ──────────────────────────────────────────────────────────────


def _yaml_message(exc: Exception, origin: str) -> str:
    """A sanitised one-line rendering of a YAML error: the parser's `problem` plus line/column.

    Never `str(exc)` — PyYAML/ruamel marked errors embed `get_snippet()`, i.e. **the offending source
    line verbatim**, which for a config full of API keys and SSH passwords means a syntax error next to
    a secret prints that secret to the console and into the systemd journal.

    `problem` itself is structural for every parser error but one: ruamel's `DuplicateKeyError` reads
    *"found duplicate key "x" with value "b" (original value: "a")"* — i.e. it inlines **both values**,
    so a duplicated `api_key:` would print the secret. That one case is replaced by its location.
    """
    mark = getattr(exc, "problem_mark", None)
    where = f" (line {mark.line + 1}, column {mark.column + 1})" if mark is not None else ""
    if isinstance(exc, DuplicateKeyError):
        return f"{origin}: duplicate key{where} — key and values withheld, they may be secrets"
    if isinstance(exc, yaml.constructor.ConstructorError):
        # "could not determine a constructor for the tag '!…'" quotes the tag verbatim, and a tag is
        # operator-written text. Structural parser problems carry no input; this one does.
        return f"{origin}: unsupported YAML tag{where} — tag text withheld"
    problem = getattr(exc, "problem", None) or type(exc).__name__
    return f"{origin}: {str(problem).strip()}{where}"


def _refuse_anchors(text: str, origin: str) -> None:
    """Refuse ANY anchor, alias or merge key anywhere in the file (§7, blanket).

    A step rewrites a plain dict; re-serialising a document whose values were shared through an alias
    would silently duplicate or drop the shared node. Deciding *which* anchors a given step can
    actually reach is 50+ lines of ruamel node-graph analysis for a config that demonstrably has none,
    so the scan is deliberately blunt — over-refusal is acceptable and the remedy is trivial.

    Scanned as parser EVENTS rather than text: `&`, `*` and `<<` are ordinary characters inside values
    (`api_key: "a*b"`), so a textual scan would refuse valid configs.
    """
    for ev in yaml.parse(text, Loader=yaml.SafeLoader):
        if isinstance(ev, yaml.AliasEvent) or getattr(ev, "anchor", None):
            raise MigrationRefused(
                f"{origin}: YAML anchors/aliases are not supported by the config migration",
                remedy="expand the anchor into plain values and re-run",
            )
        if isinstance(ev, yaml.ScalarEvent) and ev.value == "<<":
            raise MigrationRefused(
                f"{origin}: YAML merge keys (`<<`) are not supported by the config migration",
                remedy="expand the merge into plain values and re-run",
            )


def _parse(path: Path, *, origin: str) -> tuple[dict[str, Any], str]:
    """Read + parse one YAML file into a **plain** dict, refusing anything the runner cannot act on.

    Both parsers are used, each for what it alone gives us: ruamel's round-trip loader is the strict
    gate (duplicate keys, unknown tags and multi-document streams are errors there, silently tolerated
    by `yaml.safe_load`) and is the same loader `edit_config_yaml` will use at write time, so a file
    that would explode mid-write is refused before any backup is taken; `yaml.safe_load` then produces
    the plain `dict`/`int`/`bool` values steps and the marker check need — ruamel returns `ScalarInt`
    and `ScalarBoolean` (the latter an `int` subclass that is NOT a `bool`), which would defeat
    `type(v) is int` on the marker and leak round-trip types into step logic.
    """
    data = path.read_bytes()
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise MigrationRefused(f"{origin}: not valid UTF-8") from None
    try:
        # The event scan parses too, so it lives INSIDE the handler: a syntax error on an `api_key:`
        # line would otherwise escape as a raw `ParserError`, whose `str()` prints that source line.
        _refuse_anchors(text, origin)
        yaml_rt().load(text)  # strict gate: duplicate keys + multi-document (safe_load tolerates dups)
        raw = yaml.safe_load(text)  # strict gate: unknown/`!!python` tags (ruamel round-trips them)
    except (yaml.YAMLError, RuamelYAMLError) as exc:
        raise MigrationRefused(_yaml_message(exc, origin)) from None
    except ValueError, OverflowError:
        # NOT a YAML error class — both parsers let a CONSTRUCTOR failure escape as a bare `ValueError`,
        # and its message quotes the input: `api_key: 2026-01-99` raises *"day 99 must be in range 1..31
        # for month 1 in year 2026"* (verified, both parsers), and a 4300+ digit integer raises Python's
        # int-conversion limit error. Uncaught, that traceback is a config value in the journal — and at
        # the slice-4 boot check it is also an exit 1, i.e. a crash-loop instead of a terminal stop.
        raise MigrationRefused(
            f"{origin}: a scalar could not be constructed (an impossible date, a number out of range) "
            "— text withheld, it would quote your config",
            remedy="quote the offending value so it stays a string, then re-run",
        ) from None
    digest = hashlib.sha256(data).hexdigest()
    if raw is None:
        return {}, digest
    if not isinstance(raw, dict):
        raise MigrationRefused(f"{origin}: must contain a YAML mapping at the top level")
    _refuse_nonstring_keys(raw, origin)
    return raw, digest


def _assert_unchanged(ctx: Context, path: Path, *, origin: str) -> None:
    """Refuse to write a file that changed on disk since the runner parsed it.

    The plan was computed against a snapshot; if the running service (or an operator's editor) wrote
    the file in between, applying that plan silently discards their write. The deployment path stops
    the service first and holds a flock, but a human running `--apply` by hand has neither, and this
    turns a silent lost update into a refusal. It NARROWS the race to the moment between this check
    and `edit_config_yaml`'s own re-read; it does not eliminate it. The flock `install.sh` takes
    (slice 5) is the real mutual exclusion — this is the guard for the human without it.
    """
    expected = ctx.digests.get(path)
    if expected is None:
        return
    actual = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else ""
    if actual != expected:
        raise MigrationRefused(
            f"{origin}: changed on disk since it was read",
            exit_code=EXIT_FAIL,  # transient: whoever wrote it may be done by the next run
            remedy="stop whatever is writing it (the ctrl-b service?) and re-run — re-running is safe",
        )


def _refuse_nonstring_keys(node: Any, origin: str, prefix: str = "") -> None:
    """Refuse a non-string mapping key anywhere in the document.

    YAML allows `1: x` and `[a]: x`; the entire config layer — dotted paths, env overrides, pydantic
    field names, this runner's own diff — assumes string keys, and a non-string one would take a
    silent, untested path through all of it. Refusing costs the operator one edit and removes a whole
    class of "why did that key vanish".
    """
    if isinstance(node, dict):
        for k, v in node.items():
            if not isinstance(k, str):
                raise MigrationRefused(f"{origin}: mapping key at `{prefix or '<root>'}` is not a string")
            _refuse_nonstring_keys(v, origin, f"{prefix}{k}.")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _refuse_nonstring_keys(v, origin, f"{prefix}[{i}].")


def _refuse_irregular(p: Path, *, origin: str) -> None:
    """Refuse a config/agent path that is not a plain file (§7).

    A symlink: every write here is an atomic `os.replace` of a fresh temp file, which silently
    replaces the *link itself* with a regular file and detaches whatever the operator was pointing at.
    `config.config_path()` calls `.resolve()`, which erases symlink-ness, so this must run on the path
    as the operator wrote it — hence `lstat`.

    Anything else non-regular (FIFO, socket, device): `read_bytes` on a FIFO **blocks forever**, and
    slice 4 runs this check at import time inside the systemd unit, so the service would hang rather
    than fail. A hard-linked regular file is allowed: `os.replace` detaches it the same way, but
    unlike a symlink there is no way to detect intent, and refusing one is more surprising than
    useful.
    """
    try:
        mode = os.lstat(p).st_mode
    except FileNotFoundError:
        return
    if stat.S_ISLNK(mode):
        raise MigrationRefused(
            f"{origin}: is a symlink; the migration rewrites files atomically and would replace it",
            remedy=f"point CTRLB_CONFIG at the real file, or replace the link with the file: {p}",
        )
    if not stat.S_ISREG(mode):
        raise MigrationRefused(
            f"{origin}: is not a regular file",
            remedy=f"replace it with a plain YAML file: {p}",
        )


def _unresolved_config_path() -> Path:
    """The config path exactly as the operator spelled it — `~` expanded, but NOT `.resolve()`d.

    `config.config_path()` resolves, which is right for loading and fatal for the symlink refusal
    above. Both paths must name the same file; a mismatch after the symlink check means something
    stranger than a symlink is in the way, and that is louder as an error than as a silent write to a
    different file than the one reported.
    """
    override = os.environ.get("CTRLB_CONFIG")
    if override:  # `.absolute()`, never `.resolve()`: absolute for the operator, symlink-ness intact
        return Path(override).expanduser().absolute()
    home = os.environ.get("CTRLB_HOME")
    return (Path(home).expanduser().absolute() if home else home_path()) / "config.yaml"


def agents_dir() -> Path:
    """`$CTRLB_HOME/agents/` — the same directory `Settings.agents_dir_path()` scans."""
    return home_path() / "agents"


def backups_dir() -> Path:
    """`$CTRLB_HOME/backups/` — resolved from the workspace root, never from the config file's parent,
    so a `CTRLB_CONFIG` pointing outside `$CTRLB_HOME` still backs up inside the workspace (§3.4)."""
    return home_path() / "backups"


def context_from_env() -> Context:
    """Build the `Context` from the environment, running the whole refusal preflight (§3.4 step 1).

    Path resolution is pinned to the same layering `load_settings` uses — `.env` → `CTRLB_CONFIG` /
    `CTRLB_HOME` → default — and `.env` discovery is resolved here rather than inherited from the
    caller's working directory. Every `agents/*/agent.yaml` is parsed too: an unparseable one is
    refused rather than skipped, because skipping would leave a file the new reader rejects.
    """
    load_dotenv()
    cfg = _unresolved_config_path()
    _refuse_irregular(cfg, origin="config.yaml")
    resolved = config_path()
    if cfg.exists() and resolved.exists() and not cfg.samefile(resolved):
        raise MigrationRefused(f"config.yaml: {cfg} and {resolved} are different files")
    digests: dict[Path, str] = {}
    config: dict[str, Any] = {}
    if cfg.exists():
        config, digests[cfg] = _parse(cfg, origin="config.yaml")
    adir = agents_dir()
    agents: dict[Path, dict[str, Any]] = {}
    broken: list[str] = []
    for folder in sorted(p for p in adir.glob("*") if p.is_dir()) if adir.is_dir() else []:
        f = folder / "agent.yaml"
        if not f.exists():
            continue
        _refuse_irregular(f, origin=f"agents/{folder.name}/agent.yaml")
        try:
            agents[f], digests[f] = _parse(f, origin=f"agents/{folder.name}/agent.yaml")
        except MigrationRefused as exc:
            broken.append(str(exc))
    if broken:
        raise MigrationRefused(
            "unreadable agent file(s):\n  " + "\n  ".join(broken),
            remedy="fix or remove the listed agent file(s) and re-run",
        )
    return Context(config_path=cfg, agents_dir=adir, config=config, agents=agents, digests=digests)


# ── the version marker ───────────────────────────────────────────────────────────────────────────


def read_marker(config: Mapping[str, Any]) -> int:
    """The on-disk shape version: absent → 0, negative → 0, anything not an `int` → refuse.

    `type(v) is int` rather than `isinstance` because **`bool` is an `int` in Python**: a
    `config_version: true` typo would otherwise read as version 1 and skip a migration.
    """
    if CONFIG_VERSION_KEY not in config:
        return 0
    v = config[CONFIG_VERSION_KEY]
    if type(v) is not int:  # `None` included: a PRESENT marker must be an integer (§7)
        raise MigrationRefused(
            f"config.yaml: `{CONFIG_VERSION_KEY}` must be an integer",
            remedy=f"remove the `{CONFIG_VERSION_KEY}` line and re-run --check",
        )
    return max(v, 0)


def is_stamped(config: Mapping[str, Any]) -> bool:
    """True only if the file **says** it was verified at this build's level.

    Deliberately the RAW value, not `read_marker`'s normalised one: an unstamped file has never been
    through the runner, and at `CONFIG_VERSION` 0 "absent", `null` and `-3` would otherwise all
    normalise to 0 and read as verified, so the marker would never get written and a malformed one
    would never get fixed.
    """
    return type(config.get(CONFIG_VERSION_KEY)) is int and config[CONFIG_VERSION_KEY] == CONFIG_VERSION


def _refuse_downgrade(version: int) -> None:
    """Refuse a config written by a NEWER build (§3.5, exit 78) — it may hold keys this build drops."""
    if version > CONFIG_VERSION:
        raise MigrationRefused(
            f"config.yaml was written by a newer build (config_version {version}; this build "
            f"understands {CONFIG_VERSION})",
            exit_code=EXIT_REFUSE,
            remedy=(
                "restore the config from the matching backup in "
                f"{backups_dir()} (deploy/linux/README.md §Rollback → CONFIG), then re-run this "
                "same command"
            ),
        )


# ── planning ─────────────────────────────────────────────────────────────────────────────────────


def _call_step(fn: Callable[[Context], Any], ctx: Context, step: Step, what: str) -> Any:
    """Run one half of a step, converting any unexpected exception into a sanitised refusal.

    A step reads operator-authored YAML at whatever nodes it cares about, and every review round of
    this migration found the same class of defect: an input shape the step did not anticipate at one
    of those nodes (`providers: "nonsense"`, `base_url: 7`, a port that will not parse). Guarding each
    node one at a time is a losing game and would grow the very legacy-schema machinery R5 warned
    about; catching here closes the class — present and future — in one place.

    The exception TYPE is reported and the message withheld, because these messages quote their input:
    `urlsplit` on a bad port raises *"Port could not be cast to integer value as '…'"*, and on a
    secret-bearing file that is a value we must never print. Deliberately not catching
    `MigrationRefused`: that is a step's own considered verdict and passes straight through.
    """
    try:
        return fn(ctx)
    except MigrationRefused:
        raise
    except Exception as exc:  # noqa: BLE001 — being unexpected is the whole point
        raise MigrationRefused(
            f"step {step.version} crashed in {what}: {type(exc).__name__} — details withheld, they "
            "may quote your config",
            remedy=(
                "check config.yaml for a value of the wrong type (a number or list where a string or "
                f"mapping belongs); nothing was written, and {backups_dir()} is untouched"
            ),
        ) from None


def pending_steps(ctx: Context, steps: Sequence[Step] = STEPS) -> tuple[Step, ...]:
    """The steps whose `applies()` is True **right now**, in version order — evaluated for every step
    regardless of the file's stamp (§3.1), and looking at config *and* side files, so an agent file
    still holding a legacy key can never be stamped "verified"."""
    ordered = sorted(steps, key=lambda s: s.version)
    return tuple(s for s in ordered if _call_step(s.applies, ctx, s, "applies()"))


def needs_migration(ctx: Context, steps: Sequence[Step] = STEPS) -> bool:
    return bool(pending_steps(ctx, steps))


def _refuse_empty_provider_models(config: Mapping[str, Any]) -> None:
    """Refuse a provider whose `models:` is present but not a mapping (bare `models:` — YAML null — or a
    scalar), naming the provider and the fix.

    Two paths otherwise give an unhelpful message for the same operator mistake: a hand-authored
    new-shape provider with `models:` blank fails `Settings.model_validate` as a generic
    `dict_type` error, and — when a legacy endpoint folds INTO such a provider — the fold crashes on
    `None.setdefault(...)`, which the runner can only report as `type(exc).__name__` with the detail
    withheld. Catching it here, BEFORE any step runs, turns both into one actionable refusal. The
    sanitise-don't-leak guard for genuinely unexpected exceptions is untouched; the provider NAME is
    public identity (see `sanitise_validation_error`), so naming it leaks nothing. An empty `models: {}`
    is left alone — a mapping is a valid (if unconfigured) shape the fold itself can produce.
    """
    providers = config.get("providers")
    if not isinstance(providers, dict):
        return
    for name, pcfg in providers.items():
        if isinstance(pcfg, dict) and "models" in pcfg and not isinstance(pcfg["models"], dict):
            raise MigrationRefused(
                f"provider {name!r}: `models:` is empty — add at least one model or remove the key",
                remedy="give the provider a `models:` mapping (e.g. `models: {<name>: {}}`) or drop the key",
            )


def build_plan(ctx: Context, steps: Sequence[Step] = STEPS) -> Plan | None:
    """Chain every applicable step and return the combined plan, or `None` when nothing applies.

    Each step sees the document as the previous step left it (`db.py::MIGRATIONS` ordering), so a later
    step never has to know which earlier ones ran. Nothing is written.
    """
    _refuse_empty_provider_models(ctx.config)
    cur = ctx
    ran = False
    consumes: list[str | Sequence[str]] = []
    agent_files: dict[Path, dict[str, Any]] = {}
    for step in sorted(steps, key=lambda s: s.version):
        if not _call_step(step.applies, cur, step, "applies()"):
            continue
        plan = _call_step(step.apply, cur, step, "apply()")
        ran = True
        consumes += [d for d in plan.consumes if d not in consumes]
        agent_files |= plan.agent_files
        cur = replace(cur, config=plan.config, agents={**cur.agents, **plan.agent_files})
    if not ran:
        return None
    return Plan(config=cur.config, consumes=consumes, agent_files=agent_files)


def detect(ctx: Context, steps: Sequence[Step] = STEPS) -> Status:
    """The read-only verdict: marker + which steps would run + the names involved.

    Reads and refuses; it does not validate or probe — `check()` is `detect()` plus validation plus a
    writability probe. The boot check (slice 4) wants this one: it must be cheap and must not touch
    the filesystem beyond reading.
    """
    version = read_marker(ctx.config)
    _refuse_downgrade(version)
    pending = pending_steps(ctx, steps)
    plan = build_plan(ctx, steps) if pending else None
    return Status(
        config_path=ctx.config_path,
        exists=ctx.config_path.exists(),
        version=version,
        pending=tuple(s.version for s in pending),
        legacy_keys=tuple(".".join(as_path(d)) for d in plan.consumes) if plan else (),
        agent_names=tuple(sorted(p.parent.name for p in (plan.agent_files if plan else {}))),
    )


# ── validation ───────────────────────────────────────────────────────────────────────────────────


def validate(ctx: Context, plan: Plan | None) -> Settings:
    """Validate what will be on disk after this run, before a single byte is written (§3.4 step 2).

    With a plan: the migrated config goes through `Settings.model_validate`; every rewritten
    `agent.yaml` is merged against it exactly as a live load would (`agent.defaults` + the file's
    overrides), so an agent the migration rewrote into an invalid shape is caught here rather than at
    the next boot; and every key the plan would remove must have been declared by the step that removed
    it. All of it runs in `--check` too, so a step bug surfaces while prod is still serving — and
    before any backup is taken, so a refused run leaves nothing behind.

    **Without a plan the config is still validated**, and that is not belt-and-braces. A config that is
    merely BROKEN rather than legacy — `inference: nonsense`, `voice: nonsense` — is invisible to every
    step, since they all require mappings. It would sail through `--check`, be stamped "verified", and
    then fail at `Settings.model_validate` on the next boot. During an update that sequence reads:
    preflight says go, the service is stopped, the new tree goes in, and the restart fails on a file we
    just certified. Malformed NEW-shape config is not any step's business, so the check lives here.
    """
    if plan is not None:
        stray = [p for p in plan.agent_files if p not in ctx.agents]
        if stray:
            raise MigrationRefused(
                "step bug: agent file(s) the runner never parsed: "
                + ", ".join(str(p) for p in sorted(stray))
                + " — a step may only rewrite files `context_from_env` discovered, so every write has "
                "had the refusal preflight and has a backup"
            )
        undeclared = _undeclared_removals(_diff(ctx.config, plan.config)[1], plan.consumes)
        if undeclared:
            raise MigrationRefused(
                "step bug: these keys would be removed but were not declared in the step's "
                f"consumes: {', '.join('.'.join(r) for r in undeclared)}"
            )
    try:
        settings = Settings.model_validate(plan.config if plan is not None else ctx.config)
    except ValidationError as exc:
        stage = "after migration" if plan is not None else "as written — nothing to migrate"
        raise MigrationRefused(sanitise_validation_error(exc, "config.yaml", stage)) from None
    for path, doc in (plan.agent_files if plan is not None else {}).items():
        name = path.parent.name
        try:
            # Intra-app reuse of the same merge the live loader runs (`Settings._load_agent_folder`);
            # duplicating the inheritance rules here would be a second source of truth.
            settings.agent_from(name, path.parent, doc)
        except ValidationError as exc:
            raise MigrationRefused(
                sanitise_validation_error(exc, f"agents/{name}/agent.yaml", "after migration")
            ) from None
    return settings


# ── writing ──────────────────────────────────────────────────────────────────────────────────────


def _backup(src: Path, dest_dir: Path, stamp: str) -> Path:
    """Copy `src` into `dest_dir` at 0600, fsync'd, never overwriting an existing backup.

    Written THROUGH an `O_CREAT|O_EXCL|O_WRONLY` fd opened at 0600 — never write-then-chmod, which
    would land secret-bearing bytes at the process umask first. `os.fsync(fd)` before close: the
    backup is the only thing standing between the operator and a bad migration, so it must be on the
    platter before the config is replaced. (Backup only — the parent directory is deliberately NOT
    fsync'd: that is POSIX-only and the server-OS-branch allowlist is closed, R25/QH9.)
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    data = src.read_bytes()
    base = f"{src.parent.name}--{src.name}.{stamp}" if src.name == "agent.yaml" else f"{src.name}.{stamp}"
    dest = dest_dir / base
    n = 2
    while True:
        try:
            fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            break
        except FileExistsError:
            dest = dest_dir / f"{base}-{n}"
            n += 1
    with os.fdopen(fd, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    return dest


def _stamp(doc: Any) -> None:
    """Write the shape marker, inserting it at the top of the file with a comment the first time.

    Stamping happens even when no step changed anything (§3.2): the stamp means *"verified at level
    N"*, not *"changed at level N"* — which is what closes the unstamped-forever hole for a config an
    earlier lazy write-back already migrated.
    """
    if CONFIG_VERSION_KEY in doc:
        doc[CONFIG_VERSION_KEY] = CONFIG_VERSION
    elif hasattr(doc, "insert"):  # ruamel CommentedMap
        doc.insert(0, CONFIG_VERSION_KEY, CONFIG_VERSION, comment=_MARKER_COMMENT)
    else:  # pragma: no cover — an existing non-empty file always parses to a CommentedMap
        doc[CONFIG_VERSION_KEY] = CONFIG_VERSION


def _diff(
    old: Mapping[str, Any], new: Mapping[str, Any], prefix: tuple[str, ...] = ()
) -> tuple[dict[str, Any], list[tuple[str, ...]]]:
    """Compare two parsed documents and return `(changes, removals)` — the step's *intent*, nothing else.

    **We write the diff, not the document**, and that is a correctness requirement rather than an
    optimisation. Syncing the whole migrated document onto the file would rewrite every leaf the two
    parsers disagree about, and they do disagree: `edit_config_yaml` loads with ruamel (**YAML 1.2**)
    while the plan is built from `yaml.safe_load` (**YAML 1.1**), so `enabled: yes` reads as the string
    `"yes"` on one side and `True` on the other, and `port: 012` as 12 vs 10. A whole-document sync
    would "helpfully" rewrite both — silently editing config the migration was never asked to touch.
    Diffing two documents parsed by the SAME parser cancels the dialect out entirely: an untouched
    leaf produces no change, whatever either parser thinks it means.

    It also bounds the blast radius. `sync_mapping` deletes every key absent from its target, so a step
    that returned only the sections it transformed would silently delete `hosts`, SSH credentials or an
    operator's own extension — and both `Settings.model_validate` (sections default, extras are
    allowed) and the postcondition (legacy keys are gone) would happily pass. Here a removal is an
    explicit, individually authorised act (see `_undeclared_removals`).

    Removals are key-segment **tuples**, not dotted strings: model and provider keys legitimately
    contain dots (`qwen/qwen3.5-72b` is in the live config, and the provider slug charset allows `.`),
    so a dotted path could not address them — a dotted path would split the name in half, walk into
    nothing and silently leave the key behind. Dots appear only where a human reads them.
    """
    changes: dict[str, Any] = {}
    removals: list[tuple[str, ...]] = []
    for k, v in new.items():
        if k not in old:
            changes[k] = v
        elif isinstance(v, dict) and isinstance(old[k], dict):
            sub_changes, sub_removals = _diff(old[k], v, (*prefix, k))
            if sub_changes:
                changes[k] = sub_changes
            removals += sub_removals
        elif not _same(old[k], v):
            changes[k] = v
    removals += [(*prefix, k) for k in old if k not in new]
    return changes, removals


def _same(a: Any, b: Any) -> bool:
    """Value equality that YAML can tell apart, unlike Python's.

    `True == 1 == 1.0` and `[True] == [1]` in Python, so a step that normalised `debug: yes` to
    `debug: 1` would produce NO diff: the runner would write the rest of the plan, pass the
    postcondition and stamp a document that is not the one the step computed. Types must match, and
    lists compare element-by-element for the same reason.
    """
    if type(a) is not type(b):
        return False
    if isinstance(a, list):
        return len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b, strict=True))
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(_same(a[k], b[k]) for k in a)
    return bool(a == b)


def as_path(entry: str | Sequence[str]) -> tuple[str, ...]:
    """Normalise a `consumes` declaration to key segments. A step declares the readable dotted form
    (`"inference.local"`); a step needing to name a key that itself contains a dot passes the segments
    (`("providers", "openrouter", "models", "qwen/qwen3.5-72b")`).

    An EMPTY declaration is refused, not tolerated: `()` is a prefix of every path, so a step that
    produced one would silently authorise every removal in the document and defeat the one guard that
    exists to catch a bad step.
    """
    path = tuple(entry.split(".")) if isinstance(entry, str) else tuple(entry)
    if not path or any(not seg for seg in path):
        raise MigrationRefused(f"step bug: `{entry!r}` is not a usable key path in `consumes`")
    return path


def _undeclared_removals(
    removals: Sequence[tuple[str, ...]], consumes: Sequence[str | Sequence[str]]
) -> list[tuple[str, ...]]:
    """Removals the step did not declare in its `consumes`. A declared path covers its whole subtree
    (`inference.local` covers `inference.local.base_url`), so a step declares what it consumed, not
    every leaf underneath. Anything left over is a step bug, and it is refused before any write —
    this is what makes `consumes` load-bearing rather than decorative."""
    declared = [as_path(d) for d in consumes]
    return [r for r in removals if not any(r[: len(d)] == d for d in declared)]


def _mutation(
    old: Mapping[str, Any], new: Mapping[str, Any]
) -> tuple[Callable[[Any], None], list[tuple[str, ...]]]:
    """Build the `edit_config_yaml` mutate callback that turns `old` into `new` on the live ruamel doc.

    `deep_set` writes only the changed leaves (siblings and their comments survive) and `delete_path`
    removes a consumed key with the comment-rescue recipe — the same two primitives every other config
    writer in the app composes. The marker needs no special case: `_stamp` runs after this mutation and
    always wins.
    """
    changes, removals = _diff(old, new)

    def mutate(doc: Any) -> None:
        if changes:
            deep_set(doc, changes)
        for path in removals:
            delete_path(doc, path)

    return mutate, removals


def _write_config(ctx: Context, plan: Plan | None) -> None:
    """The commit point (§3.4 step 5): one comment-preserving, atomic, 0600 rewrite of `config.yaml`.

    Routed through `edit_config_yaml`, the single YAML chokepoint, so the operator's comments, key
    order, quoting and line endings survive. Every removal was authorised by `validate` before we got
    here; the stamp rides this same write, so the file is never left migrated but unstamped.
    """

    def noop(_doc: Any) -> None:
        return None

    mutate: Callable[[Any], None] = noop
    if plan is not None:
        mutate, _removals = _mutation(ctx.config, plan.config)

    def mutate_and_stamp(doc: Any) -> None:
        mutate(doc)
        _stamp(doc)

    _assert_unchanged(ctx, ctx.config_path, origin="config.yaml")
    edit_config_yaml(mutate_and_stamp, ctx.config_path)


def _write_agent(ctx: Context, path: Path, doc: dict[str, Any]) -> None:
    """Rewrite one `agent.yaml` through the same comment-preserving chokepoint as the config.

    `edit_config_yaml` is path-agnostic; reusing it means an operator's hand-written agent notes
    survive a migration (the app's own agents editor rewrites these files with `safe_dump` and does
    not). Removals here are NOT required to be declared — `consumes` names paths in
    `config.yaml`, and an agent file is small, single-purpose and rewritten wholesale by the step that
    owns it. Side effect, deliberate: the file lands at 0600 like the config — a tightening on a
    single-user workspace, never a loosening.
    """
    mutate, _ = _mutation(ctx.agents.get(path, {}), doc)
    _assert_unchanged(ctx, path, origin=f"agents/{path.parent.name}/agent.yaml")
    edit_config_yaml(mutate, path)


# ── retired environment overrides ────────────────────────────────────────────────────────────────


def _retired_path(entry: Any, step: Step) -> tuple[str, str]:
    """Validate one `retires` declaration, refusing a step bug instead of silently never matching.

    The parser always yields exactly `(section, key)`, lower-cased, so a one- or three-segment
    declaration — or `("Embeddings", "API_KEY")`, or the dotted `("embeddings.api_key",)` — can never
    match anything. Left unchecked, that reads as "no retired variable is set" and the protection is
    silently off for a path a step believed it had retired. This is the same class as slice 1's empty
    `consumes` entry (§11): a declaration that cannot mean what it says is a step bug, not a no-op.
    """
    ok = (
        isinstance(entry, tuple)
        and len(entry) == 2
        and all(isinstance(s, str) and s and s == s.lower() for s in entry)
    )
    if not ok:
        raise MigrationRefused(
            f"step {step.version} bug: `retires` entry {entry!r} is not a lower-case "
            "(section, key) pair — the one-level env grammar can only address exactly two segments"
        )
    return (entry[0], entry[1])


def retired_env_overrides(
    steps: Sequence[Step] = STEPS, environ: Mapping[str, str] | None = None
) -> list[tuple[str, str]]:
    """The `CTRLB_*` overrides addressing a path a step retired, as `(variable, "section.key")`.

    Pure and cheap — no filesystem, no config, no parse. The grammar is not re-implemented here: it
    comes from `config.env_override_vars`, the same parser the overlay itself uses, so a variable the
    overlay would apply (`CTRLB_Embeddings__Api_Key`, lower-cased on the way in) is a variable this
    finds.

    Callers differ on purpose. `check()`/`apply()` **refuse** on a non-empty result: they run attended,
    at the update gate, with prod still serving, and that is the one moment the fix is cheap. Slice 4's
    boot check will call this same function and **log** — an old line in `.env` must not take down the
    only UI there is to fix it with, and by then the migration gate has forced onto disk any value the
    CLI could see. That caveat is the point: the two callers see **different environments** — the CLI
    sees the operator's shell and `.env`, the service additionally sees the systemd user manager's
    merged `Environment=` (unit file *and* drop-ins) — so neither check subsumes the other, and a
    credential supplied only to the service is exactly what slice 5's `install.sh` scan has to catch.
    """
    retired = {_retired_path(p, s) for s in steps for p in s.retires}
    return [
        (var, f"{section}.{key}")
        for var, section, key in env_override_vars(environ)
        if (section, key) in retired
    ]


def _refuse_retired_env(ctx: Context, steps: Sequence[Step]) -> None:
    """Refuse while the environment still carries an override this build retired (§7).

    Names only — the variable and the dead path it addresses, never a value.

    The remedy differs on the two sides of the migration, chosen by the **stamp** rather than by
    running the steps: `is_stamped` is a dict lookup, while `needs_migration` executes every step —
    and this refusal deliberately precedes planning, so that a config error cannot mask the variable.
    """
    found = retired_env_overrides(steps)
    if not found:
        return
    listing = "\n  ".join(f"{var} -> {path}" for var, path in found)
    where = (
        "on the provider that section now points at"
        if is_stamped(ctx.config)
        else "under the legacy key the variable names — the migration carries it into the provider it creates"
    )
    raise MigrationRefused(
        "environment override(s) address config paths this build retired:\n  " + listing,
        remedy=f"unset them and re-run. A value one of them supplied has to live in config.yaml, {where}",
    )


# ── check / apply ────────────────────────────────────────────────────────────────────────────────


def _probe_writable(d: Path) -> None:
    """Prove we can actually create + replace a file in `d` before promising a migration can run."""
    while not d.exists() and d.parent != d:  # `--check` writes NOTHING, not even a directory
        d = d.parent
    probe = d / f".ctrlb-migration-probe.{os.getpid()}"
    try:
        fd = os.open(probe, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
    except OSError as exc:
        raise MigrationRefused(f"{d}: not writable ({exc.strerror})", exit_code=EXIT_FAIL) from None
    finally:
        try:
            os.unlink(probe)
        except OSError:
            pass


def _path_present(config: Mapping[str, Any], path: Sequence[str]) -> bool:
    node: Any = config
    for part in path:
        if not isinstance(node, Mapping) or part not in node:
            return False
        node = node[part]
    return True


def _assert_postcondition(steps: Sequence[Step], plan: Plan | None) -> None:
    """Re-read from disk and assert that **no step applies** (§3.3) — over config AND side files.

    This, not the stamp, is what enforces "zero legacy keys after an update": it is deliberately a
    fresh parse of what actually landed, not a re-inspection of the plan the runner just trusted, so a
    step whose transform is incomplete, or a write that silently didn't take, fails loudly. Each
    consumed path the plan *declared* is asserted gone as well.
    """
    fresh = context_from_env()
    still = pending_steps(fresh, steps)
    # Only paths the FINAL plan does not itself contain: a step 3 correction may legitimately restore a
    # path step 1 declared consumed, and that is a correct migration, not a leftover.
    declared = [as_path(d) for d in (plan.consumes if plan else [])]
    final = plan.config if plan else {}
    leftovers = [d for d in declared if _path_present(fresh.config, d) and not _path_present(final, d)]
    if still or leftovers:
        detail = ", ".join(
            [f"step {s.version} still applies" for s in still] + [f"`{d}` still present" for d in leftovers]
        )
        raise MigrationRefused(f"post-migration verification FAILED: {detail}")
    if fresh.config and not is_stamped(fresh.config):
        raise MigrationRefused(f"post-migration verification FAILED: `{CONFIG_VERSION_KEY}` not stamped")


def check(ctx: Context, steps: Sequence[Step] = STEPS) -> Status:
    """`--check`: parse, plan, validate, probe writability. Writes nothing. Raises `MigrationRefused`
    for anything that would fail, so a caller (`install.sh`) can abort while prod is still serving.

    **Precedence, in three steps rather than two** (Codex, twice): the *marker* is read first, so a
    config written by a newer build is refused before anything else — this build's remediation for a
    retired variable would be advice about a shape it no longer knows to be true. Then the environment,
    then planning. Ordering `detect()` first instead would have given **every** step failure precedence
    over the environment: a config with `providers: nonsense` AND a retired variable would report the
    config error, and the operator would fix it, re-run, and only then learn about the variable.
    """
    _refuse_downgrade(read_marker(ctx.config))
    _refuse_retired_env(ctx, steps)
    status = detect(ctx, steps)
    if not status.exists or not ctx.config:
        return status
    plan = build_plan(ctx, steps)
    validate(ctx, plan)  # with a plan or without one — see `validate`
    if plan is not None or not is_stamped(ctx.config):
        _probe_writable(ctx.config_path.parent)
        _probe_writable(backups_dir())
        for parent in sorted({p.parent for p in (plan.agent_files if plan else {})}):
            _probe_writable(parent)  # a read-only agents/<name>/ must fail the CHECK, not the apply
    return status


@dataclass(frozen=True)
class Applied:
    """What `--apply` did: the plan (if any), the backups taken, and whether the file was rewritten."""

    status: Status
    backups: tuple[Path, ...] = ()
    wrote: bool = False


def apply(ctx: Context, steps: Sequence[Step] = STEPS) -> Applied:
    """`--apply`: the §3.4 write protocol — validate everything, back up, write side files, commit the
    config last, then verify.

    There is deliberately **no rollback for the agent-file writes**. They are idempotent and
    `config.yaml` is the commit point, so a crash between them leaves a state nobody can observe: the
    app refuses to boot on the still-legacy config, and re-running `--apply` re-derives the same plan
    and converges. Restore logic would guard an unreachable state — and a restore path can itself
    fail, which is a worse failure than the one it prevents. A failure *after* the commit is reported
    as its own state, naming the backup to restore.
    """
    _refuse_downgrade(read_marker(ctx.config))  # marker → environment → plan; see `check()`
    _refuse_retired_env(ctx, steps)
    status = detect(ctx, steps)
    if not status.exists or not ctx.config:
        return Applied(status=status)  # absent or empty → never created, never stamped (§3.2)
    plan = build_plan(ctx, steps)
    if plan is None and is_stamped(ctx.config):
        _assert_postcondition(steps, None)
        return Applied(status=status)  # already verified at this level → do not touch the file
    validate(ctx, plan)  # never stamp a config the app cannot load, plan or no plan
    _probe_writable(ctx.config_path.parent)
    # Every file we are about to touch, checked together BEFORE the first backup: a digest failure
    # discovered later would be raised after side writes had already happened, and the message would
    # be a lie. The per-file check before each write stays, for the narrower race.
    _assert_unchanged(ctx, ctx.config_path, origin="config.yaml")
    for p in sorted(plan.agent_files if plan else {}):
        _assert_unchanged(ctx, p, origin=f"agents/{p.parent.name}/agent.yaml")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = backups_dir()
    backups = [_backup(ctx.config_path, dest, stamp)]
    backups += [_backup(p, dest, stamp) for p in sorted(plan.agent_files) if p.exists()] if plan else []
    if plan is not None:
        for path, doc in sorted(plan.agent_files.items()):
            _write_agent(ctx, path, doc)
    _write_config(ctx, plan)  # ← THE COMMIT POINT
    try:
        _assert_postcondition(steps, plan)
    except MigrationRefused as exc:
        raise MigrationRefused(
            f"{exc}\nthe migration WAS committed",
            remedy=f"restore the pre-migration config: {backups[0]}",
        ) from None
    return Applied(status=status, backups=tuple(backups), wrote=True)


# ── CLI ──────────────────────────────────────────────────────────────────────────────────────────


def _print_status(status: Status, *, applied: Applied | None = None) -> None:
    # Neither variable set means `home_path()` fell back to the REPO ROOT — so a human running this
    # from a plain shell (the unit's environment is not exported) would be told "not needed" about a
    # config that is not the one they meant. The absolute path alone is too quiet to catch at 1am.
    fallback = (
        ""
        if (os.environ.get("CTRLB_CONFIG") or os.environ.get("CTRLB_HOME"))
        else ("  ← repo-root fallback; did you mean CTRLB_HOME=~/.ctrl-b ?")
    )
    out: list[str] = [
        f"config:         {status.config_path if status.exists else f'{status.config_path} (absent)'}"
        f"{fallback}",
        f"config_version: {status.version} (this build understands {CONFIG_VERSION})",
    ]
    if status.needs_migration:
        out.append(f"migration:      needed — step(s) {', '.join(str(v) for v in status.pending)}")
        if status.legacy_keys:
            out.append(f"legacy keys:    {', '.join(status.legacy_keys)}")
        if status.agent_names:
            out.append(f"agent files:    {', '.join(status.agent_names)}")
        if applied is None:
            out.append(f"backups to:     {backups_dir()}")
    else:
        out.append("migration:      not needed")
    if applied is not None:
        out.append(f"wrote:          {'config.yaml' if applied.wrote else 'nothing (already verified)'}")
        for b in applied.backups:
            out.append(f"backup:         {b}")
    print("\n".join(out))


def report_refusal(exc: MigrationRefused) -> int:
    """Print a refusal (already sanitised at its raise site) and return its exit code.

    Public because `main.py`'s import-time preflight reports the same refusals this CLI does, and two
    spellings of "how a refusal reaches the operator" would drift on the first message change."""
    print(f"config migration: {exc}", file=sys.stderr)
    if exc.remedy:
        print(f"  → {exc.remedy}", file=sys.stderr)
    return exc.exit_code


def main(argv: Sequence[str] | None = None, steps: Sequence[Step] = STEPS) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.config_migration",
        description="Check or apply the ctrl-b config-shape migration.",
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="report what would happen; write nothing")
    mode.add_argument("--apply", action="store_true", help="migrate the config in place")
    args = parser.parse_args(argv)
    try:
        ctx = context_from_env()
        if args.check:
            _print_status(check(ctx, steps))
        else:
            applied = apply(ctx, steps)
            _print_status(applied.status, applied=applied)
    except MigrationRefused as exc:
        return report_refusal(exc)
    except OSError as exc:
        # Disk full, a revoked permission, a vanished directory — real conditions on a box that runs
        # this during a deploy. Reported as errno + path (never content, never a traceback), and only
        # ever reached with the original file intact or the backup already on disk.
        print(f"config migration: {exc.strerror or type(exc).__name__}: {exc.filename}", file=sys.stderr)
        return EXIT_FAIL
    return EXIT_OK


__all__ = [
    "CONFIG_VERSION",
    "Context",
    "MigrationRefused",
    "Plan",
    "STEPS",
    "Status",
    "Step",
    "apply",
    "build_plan",
    "check",
    "context_from_env",
    "detect",
    "main",
    "needs_migration",
    "read_marker",
    "report_refusal",
    "retired_env_overrides",
]
